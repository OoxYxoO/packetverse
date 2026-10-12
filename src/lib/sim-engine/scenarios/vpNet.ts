import { spClone, type SpBase, type SpMoment, type SpRun } from "@/components/sp-lab/spKit";

/**
 * MPLS L2VPN (VPWS) Lab network — the guided lesson's provider core with two point-to-point Ethernet services.
 *
 *   CE1A (CUST-A, VLAN 100) ─┐                                    ┌─ CE2A (CUST-A, VLAN 100)
 *                             PE1 ── P1 ── P2 ── PE2
 *   CE1B (CUST-B, VLAN 200) ─┘ 1.1.1.1 2.2.2.2 3.3.3.3 4.4.4.4    └─ CE2B (CUST-B, VLAN 200)
 *
 * Both customers number their two sites 192.168.100.1 and 192.168.100.2: the provider never looks at their IP
 * addresses. CUST-A rides pseudowire 5000 (the guided lesson's), CUST-B pseudowire 5100.
 *
 * Modeled (RFC 4447 FEC 128 / Ethernet VLAN pseudowires, RFC 4448):
 * - Attachment circuits: a sub-interface per service (IOS XR `l2transport` + `encapsulation dot1q`, Junos unit with
 *   `encapsulation vlan-ccc` + `vlan-id`). A frame enters a service only if its VLAN tag matches the AC's.
 * - Cross-connects: IOS XR `l2vpn xconnect group … p2p … interface … neighbor ipv4 … pw-id …`, Junos
 *   `protocols l2circuit neighbor … interface … virtual-circuit-id …`.
 * - Targeted LDP between the PE loopbacks, brought up by the cross-connects themselves (a PE sends targeted hellos to
 *   every pseudowire neighbor; Junos also needs `ldp interface lo0.0`). Each PE advertises a label mapping for each of
 *   its pseudowires: PW FEC = (type Ethernet, PW ID) + its own receive label, MTU and control-word bit.
 * - A pseudowire is up when the remote PE advertises the same PW ID with the same MTU and control-word setting
 *   (Junos also needs an LSP to the neighbor in inet.3). The labels are directional: each PE pushes the label the
 *   other PE chose.
 * - Transport: LDP on the core links, label control by OS as in the MPLS + LDP lesson (IOS XR independent: a hop with
 *   no label forwards unlabeled and exposes the PW label to the next router, which drops it; Junos ordered).
 * - Data plane: a tagged frame from a CE → the AC → PW label + transport label → swap, PHP → the egress PE maps the
 *   PW label to its AC and sends the frame out with that AC's VLAN. A ping needs the reply to come back.
 */

export type VpR = "PE1" | "P1" | "P2" | "PE2";
export type VpCe = "CE1A" | "CE1B" | "CE2A" | "CE2B";
export const VP_ROUTERS: VpR[] = ["PE1", "P1", "P2", "PE2"];
export const VP_PES: VpR[] = ["PE1", "PE2"];
export const VP_LO: Record<VpR, string> = { PE1: "1.1.1.1", P1: "2.2.2.2", P2: "3.3.3.3", PE2: "4.4.4.4" };
export type IfName = "ge-0/0/0" | "ge-0/0/1" | "ge-0/0/2";
export interface VpCeDef {
  pe: VpR;
  ifn: IfName;
  vlan: number;
  cust: string;
  ip: string;
  mac: string;
}
export const CES: Record<VpCe, VpCeDef> = {
  CE1A: { pe: "PE1", ifn: "ge-0/0/1", vlan: 100, cust: "CUST-A", ip: "192.168.100.1", mac: "001a.2b00.0001" },
  CE1B: { pe: "PE1", ifn: "ge-0/0/2", vlan: 200, cust: "CUST-B", ip: "192.168.100.1", mac: "001a.2b00.0011" },
  CE2A: { pe: "PE2", ifn: "ge-0/0/1", vlan: 100, cust: "CUST-A", ip: "192.168.100.2", mac: "001a.2b00.0002" },
  CE2B: { pe: "PE2", ifn: "ge-0/0/2", vlan: 200, cust: "CUST-B", ip: "192.168.100.2", mac: "001a.2b00.0012" },
};
export const VP_CES = Object.keys(CES) as VpCe[];
export interface VpLink {
  id: string;
  a: VpR;
  ai: IfName;
  aip: string;
  b: VpR;
  bi: IfName;
  bip: string;
}
export const VP_LINKS: VpLink[] = [
  { id: "PE1-P1", a: "PE1", ai: "ge-0/0/0", aip: "192.0.2.0", b: "P1", bi: "ge-0/0/0", bip: "192.0.2.1" },
  { id: "P1-P2", a: "P1", ai: "ge-0/0/1", aip: "192.0.2.2", b: "P2", bi: "ge-0/0/0", bip: "192.0.2.3" },
  { id: "P2-PE2", a: "P2", ai: "ge-0/0/1", aip: "192.0.2.4", b: "PE2", bi: "ge-0/0/0", bip: "192.0.2.5" },
];
export const PATH: VpR[] = ["PE1", "P1", "P2", "PE2"];
export const coreIfs = (r: VpR) => VP_LINKS.filter((l) => l.a === r || l.b === r).map((l) => (l.a === r ? { ifn: l.ai, ip: l.aip, peer: l.b, peerIp: l.bip, link: l } : { ifn: l.bi, ip: l.bip, peer: l.a, peerIp: l.aip, link: l }));
export const ceIfs = (r: VpR) => VP_CES.filter((c) => CES[c].pe === r).map((c) => ({ ce: c, ...CES[c] }));
export const otherPe = (r: VpR): VpR => (r === "PE1" ? "PE2" : "PE1");
export const peOfLo = (ip: string) => VP_ROUTERS.find((r) => VP_LO[r] === ip);

// ---------------------------------------------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------------------------------------------
/** A sub-interface (attachment circuit), keyed "ge-0/0/1.100". */
export interface VpAc {
  /** dot1q VLAN the AC accepts (XR encapsulation dot1q / Junos vlan-id). */
  vlan?: number;
  /** Junos: unit encapsulation vlan-ccc (IOS XR: the sub-interface is l2transport). */
  ccc: boolean;
  /** The AC's payload MTU, as signaled for the pseudowire (default 1500). */
  mtu: number;
}
export interface VpXc {
  /** IOS XR xconnect group / p2p name (Junos: empty). */
  group: string;
  name: string;
  ac?: string;
  nbr?: string;
  pwid?: number;
  /** IOS XR: the pw-class used under the neighbor. */
  pwClass?: string;
  /** Junos: no-control-word under the l2circuit interface. */
  noCw?: boolean;
}
export interface VpCfg {
  acs: Record<string, VpAc>;
  xcs: VpXc[];
  /** IOS XR pw-classes: encapsulation mpls → control-word. */
  pwClasses: Record<string, { cw: boolean }>;
  /** LDP on the core interfaces. */
  ldp: Partial<Record<IfName, boolean>>;
  /** Junos: protocols ldp interface lo0.0 (needed for targeted sessions). */
  ldpLo: boolean;
}
export type VpConfig = Record<VpR, VpCfg>;
export type VpOs = "xr" | "junos";
export const acKey = (ifn: string, unit: number) => `${ifn}.${unit}`;

const SERVICES = [
  { cust: "CUST-A", vlan: 100, pwid: 5000, name: "VPWS-A" },
  { cust: "CUST-B", vlan: 200, pwid: 5100, name: "VPWS-B" },
];
export function vpHealthy(): VpConfig {
  const c = {} as VpConfig;
  for (const r of VP_ROUTERS) {
    const ldp: Partial<Record<IfName, boolean>> = {};
    for (const x of coreIfs(r)) ldp[x.ifn] = true;
    c[r] = { acs: {}, xcs: [], pwClasses: {}, ldp, ldpLo: true };
  }
  for (const pe of VP_PES) {
    c[pe].pwClasses.CW = { cw: true };
    for (const sv of SERVICES) {
      const ce = ceIfs(pe).find((x) => x.cust === sv.cust)!;
      const k = acKey(ce.ifn, sv.vlan);
      c[pe].acs[k] = { vlan: sv.vlan, ccc: true, mtu: 1500 };
      c[pe].xcs.push({ group: sv.cust, name: sv.name, ac: k, nbr: VP_LO[otherPe(pe)], pwid: sv.pwid, pwClass: "CW" });
    }
  }
  return c;
}
export const cwOf = (os: VpOs, c: VpCfg, x: VpXc) => (os === "xr" ? !!(x.pwClass && c.pwClasses[x.pwClass]?.cw) : !x.noCw);

// ---------------------------------------------------------------------------------------------------------------
// The control plane
// ---------------------------------------------------------------------------------------------------------------
export const LABEL_BASE: Record<VpOs, number> = { xr: 24000, junos: 299776 };
const FEC_ORDER = ["1.1.1.1", "4.4.4.4", "2.2.2.2", "3.3.3.3"];
export const IMPLICIT_NULL = 3;
/** LDP local label of router r for a loopback FEC — the same numbers as the MPLS + LDP and L3VPN labs. */
export function ldpLabel(os: VpOs, r: VpR, fec: string) {
  if (VP_LO[r] === fec) return IMPLICIT_NULL;
  return LABEL_BASE[os] + (r.startsWith("PE") ? 500 : 0) + 101 * VP_ROUTERS.indexOf(r) + FEC_ORDER.indexOf(fec);
}
/** The receive label a PE allocates for its i-th pseudowire (IOS XR: PE1 24001…, PE2 25001… as in the guided lesson). */
export function pwLabel(os: VpOs, pe: VpR, i: number) {
  return os === "xr" ? (pe === "PE1" ? 24001 : 25001) + i : LABEL_BASE.junos + (pe === "PE1" ? 32 : 64) + i;
}
export type PwWhy = "noac" | "nonbr" | "nosess" | "noremote" | "mtu" | "cw" | "nolsp";
export interface VpPw {
  pe: VpR;
  idx: number;
  xc: VpXc;
  up: boolean;
  why?: PwWhy;
  local: number;
  mtu: number;
  cw: boolean;
  remote?: { label: number; mtu: number; cw: boolean; ac?: string };
}
export interface VpView {
  ldp: Record<string, boolean>;
  /** Transport labels per router for each PE loopback; undefined out = none. */
  lsp: Record<VpR, Partial<Record<string, { out?: number; nh?: VpR }>>>;
  /** Targeted LDP sessions: the pseudowire neighbors each PE tries, and whether PE1↔PE2 is up. */
  tldp: { up: boolean; tries: Record<VpR, string[]> };
  pws: VpPw[];
}
export const ldpUp = (c: VpConfig, l: VpLink) => !!c[l.a].ldp[l.ai] && !!c[l.b].ldp[l.bi];
export function vpCompute(c: VpConfig, os: VpOs): VpView {
  const ldp: Record<string, boolean> = Object.fromEntries(VP_LINKS.map((l) => [l.id, ldpUp(c, l)]));
  const lsp = Object.fromEntries(VP_ROUTERS.map((r) => [r, {}])) as VpView["lsp"];
  for (const fec of [VP_LO.PE1, VP_LO.PE2]) {
    const order = fec === VP_LO.PE2 ? PATH : [...PATH].reverse();
    let chain = true;
    for (let i = order.length - 2; i >= 0; i--) {
      const r = order[i];
      const nh = order[i + 1];
      const link = VP_LINKS.find((l) => (l.a === r && l.b === nh) || (l.b === r && l.a === nh))!;
      const has = ldp[link.id] && (os === "xr" || chain);
      if (!ldp[link.id]) chain = false;
      lsp[r][fec] = has ? { out: ldpLabel(os, nh, fec), nh } : { nh };
    }
  }
  const tries = Object.fromEntries(VP_ROUTERS.map((r) => [r, [...new Set(c[r].xcs.map((x) => x.nbr).filter((x): x is string => !!x))]])) as Record<VpR, string[]>;
  const loOk = (pe: VpR) => os === "xr" || c[pe].ldpLo;
  const tldpUp = tries.PE1.includes(VP_LO.PE2) && tries.PE2.includes(VP_LO.PE1) && loOk("PE1") && loOk("PE2");
  const pws: VpPw[] = [];
  for (const pe of VP_PES) {
    c[pe].xcs.forEach((xc, idx) => {
      const ac = xc.ac ? c[pe].acs[xc.ac] : undefined;
      const mtu = ac?.mtu ?? 1500;
      const cw = cwOf(os, c[pe], xc);
      const pw: VpPw = { pe, idx, xc, up: false, local: pwLabel(os, pe, idx), mtu, cw };
      pws.push(pw);
      if (!ac || !xc.nbr || xc.pwid === undefined) return void (pw.why = "noac");
      const peer = peOfLo(xc.nbr);
      if (!peer || peer === pe || !VP_PES.includes(peer)) return void (pw.why = "nonbr");
      if (!tldpUp) return void (pw.why = "nosess");
      const ri = c[peer].xcs.findIndex((y) => y.nbr === VP_LO[pe] && y.pwid === xc.pwid && !!y.ac && !!c[peer].acs[y.ac]);
      if (ri < 0) return void (pw.why = "noremote");
      const ry = c[peer].xcs[ri];
      pw.remote = { label: pwLabel(os, peer, ri), mtu: c[peer].acs[ry.ac!].mtu, cw: cwOf(os, c[peer], ry), ac: ry.ac };
      if (pw.remote.mtu !== mtu) return void (pw.why = "mtu");
      if (pw.remote.cw !== cw) return void (pw.why = "cw");
      if (os === "junos" && lsp[pe][xc.nbr]?.out === undefined) return void (pw.why = "nolsp");
      pw.up = true;
    });
  }
  return { ldp, lsp, tldp: { up: tldpUp, tries }, pws };
}

// ---------------------------------------------------------------------------------------------------------------
// The data plane
// ---------------------------------------------------------------------------------------------------------------
export interface VpHop {
  from: string;
  to: string;
  labels: number[];
  note: string;
}
export interface VpTrace {
  ok: boolean;
  hops: VpHop[];
  path: string[];
  dstCe?: VpCe;
  why?: string;
}
/** One direction: a frame from a CE toward an address on its wire. */
export function vpForward(c: VpConfig, v: VpView, os: VpOs, from: VpCe, dst: string): VpTrace {
  const ce = CES[from];
  const pe = ce.pe;
  const hops: VpHop[] = [{ from, to: pe, labels: [], note: `${from} sends an Ethernet frame to ${dst}, tagged VLAN ${ce.vlan}` }];
  const path: string[] = [from, pe];
  const k = acKey(ce.ifn, ce.vlan);
  const ac = c[pe].acs[k];
  if (!ac || ac.vlan !== ce.vlan) return { ok: false, hops, path, why: `${pe} has no attachment circuit for VLAN ${ce.vlan} on ${ce.ifn} — the frame is dropped` };
  const pw = v.pws.find((p) => p.pe === pe && p.xc.ac === k);
  if (!pw) return { ok: false, hops, path, why: `${pe}'s ${k} isn't part of any cross-connect — the frame is dropped` };
  if (!pw.up || !pw.remote) return { ok: false, hops, path, why: `${pe}: the pseudowire for ${k} (PW ID ${pw.xc.pwid}) is down — ${pwWhyText(pw, os)}` };
  const egress = peOfLo(pw.xc.nbr!)!;
  const fec = VP_LO[egress];
  const order = egress === "PE2" ? PATH : [...PATH].reverse();
  let stack: number[] = [pw.remote.label];
  const t0 = v.lsp[pe][fec];
  if (t0?.out !== undefined && t0.out !== IMPLICIT_NULL) stack = [t0.out, ...stack];
  hops.push({ from: pe, to: order[1], labels: stack, note: `${pe}: ${k} → PW ${pw.xc.pwid} to ${fec}; push PW label ${pw.remote.label} (chosen by ${egress})${t0?.out !== undefined && t0.out !== IMPLICIT_NULL ? ` and transport label ${t0.out}` : " — no transport label (Unlabelled)"}${pw.cw ? ", control word" : ""}` });
  path.push(order[1]);
  for (let i = 1; i < order.length - 1; i++) {
    const rr = order[i];
    const nx = order[i + 1];
    const top = stack[0];
    if (top !== ldpLabel(os, rr, fec)) return { ok: false, hops, path, why: `${rr} receives label ${top} — the PW label ${egress} allocated, which ${rr} never allocated and knows nothing about — and drops the frame` };
    const t = v.lsp[rr][fec];
    if (t?.out === undefined || t.out === IMPLICIT_NULL) stack = stack.slice(1);
    else stack = [t.out, ...stack.slice(1)];
    hops.push({ from: rr, to: nx, labels: stack, note: t?.out === undefined ? `${rr}: no label from ${nx} for ${fec} (Unlabelled) → removes ${top}; the PW label is now on top` : t.out === IMPLICIT_NULL ? `${rr}: pops ${top} (PHP) — the PW label is left` : `${rr}: swaps ${top} → ${t.out}` });
    path.push(nx);
  }
  const lbl = stack[0];
  const epw = v.pws.find((p) => p.pe === egress && p.local === lbl && p.up);
  if (!epw || stack.length !== 1) return { ok: false, hops, path, why: `${egress} receives label stack ${stack.join("/")} it can't map to a pseudowire` };
  const eac = c[egress].acs[epw.xc.ac!];
  const port = epw.xc.ac!.split(".")[0];
  const target = ceIfs(egress).find((x) => x.ifn === port);
  if (!target) return { ok: false, hops, path, why: `${egress}: PW label ${lbl} → ${epw.xc.ac}, but nothing is connected there` };
  hops.push({ from: egress, to: target.ce, labels: [], note: `${egress}: PW label ${lbl} → ${epw.xc.ac}; the frame leaves tagged VLAN ${eac.vlan}` });
  path.push(target.ce);
  if (eac.vlan !== target.vlan) return { ok: false, hops, path, why: `${target.ce} receives the frame tagged VLAN ${eac.vlan}, but its interface uses VLAN ${target.vlan} — dropped` };
  if (target.ip !== dst) return { ok: false, hops, path, why: `the frame reaches ${target.ce} (${target.ip}), not ${dst} — nobody answers` };
  return { ok: true, hops, path, dstCe: target.ce };
}
export function pwWhyText(p: VpPw, os: VpOs): string {
  const xr = os === "xr";
  switch (p.why) {
    case "noac":
      return "the cross-connect is incomplete (attachment circuit, neighbor or PW ID missing)";
    case "nonbr":
      return `nobody answers targeted hellos at ${p.xc.nbr}: no session, no label`;
    case "nosess":
      return `no targeted LDP session with ${p.xc.nbr}`;
    case "noremote":
      return `${peOfLo(p.xc.nbr!) ?? p.xc.nbr} advertises no PW ID ${p.xc.pwid} toward ${VP_LO[p.pe]}: no remote label`;
    case "mtu":
      return `MTU mismatch (local ${p.mtu}, remote ${p.remote?.mtu})`;
    case "cw":
      return `control-word mismatch (local ${p.cw ? "on" : "off"}, remote ${p.remote?.cw ? "on" : "off"})`;
    case "nolsp":
      return xr ? "no LSP to the neighbor" : `no LSP to ${p.xc.nbr} in inet.3`;
  }
  return "down";
}

// ---------------------------------------------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------------------------------------------
export interface VpSnap {
  view: VpView;
}
export interface VpTest {
  id: number;
  from: VpCe;
  dst: string;
  ok: boolean;
  path: string[];
  reached?: VpCe;
  why?: string;
  cfgSeq: number;
}
export interface VpSys {
  t: number;
  dev: VpR;
  kind: "commit" | "ldp-up" | "ldp-down" | "pw-up" | "pw-down";
  peer?: string;
  pwid?: number;
}
export interface VpState extends SpBase<VpSnap> {
  os: VpOs;
  cfg: VpConfig;
  hist: Record<VpR, VpCfg[]>;
  view: VpView;
  sys: VpSys[];
  tests: VpTest[];
  wiped?: boolean;
}
export type VpAction =
  | { type: "cfg"; dev: VpR; cfg: VpCfg; text: string }
  | { type: "set"; changes: { dev: VpR; f: (c: VpCfg) => void }[]; text: string }
  | { type: "test"; from: VpCe; dst: string }
  | { type: "ticket"; id: VpTicketId }
  | { type: "os"; os: VpOs }
  | { type: "wipe-a" };

const cl = (o: VpState): VpState => ({ ...spClone(o), runs: o.runs, last: o.last });
export function createVpNet(seq = 0, os: VpOs = "xr"): VpState {
  const cfg = vpHealthy();
  const view = vpCompute(cfg, os);
  const s: VpState = { seq, os, cfgSeq: 0, clock: 3600, runs: [], log: [{ seq, t: 3600, text: "IS-IS and LDP are up, the targeted LDP session PE1 ↔ PE2 is up, and both pseudowires (5000 for CUST-A, 5100 for CUST-B) are up.", tone: "info" }], cfg, hist: Object.fromEntries(VP_ROUTERS.map((r) => [r, []])) as unknown as Record<VpR, VpCfg[]>, view, sys: [], tests: [] };
  for (const l of VP_LINKS) s.sys.push({ t: 20, dev: l.a, kind: "ldp-up", peer: VP_LO[l.b] }, { t: 20, dev: l.b, kind: "ldp-up", peer: VP_LO[l.a] });
  s.sys.push({ t: 30, dev: "PE1", kind: "ldp-up", peer: VP_LO.PE2 }, { t: 30, dev: "PE2", kind: "ldp-up", peer: VP_LO.PE1 });
  for (const p of view.pws.filter((x) => x.up)) s.sys.push({ t: 32, dev: p.pe, kind: "pw-up", peer: p.xc.nbr, pwid: p.xc.pwid });
  return s;
}

function testRun(s: VpState, t: VpTest, fwd: VpTrace, back?: VpTrace): SpRun<VpSnap> {
  const snap = { view: spClone(s.view) };
  const moments: SpMoment<VpSnap>[] = [];
  const leg = (tr: VpTrace, reply: boolean) => {
    for (const h of tr.hops) moments.push({ tokens: [{ from: h.from, to: h.to, label: h.labels.length ? h.labels.join(" / ") : reply ? "reply" : "frame", color: reply ? "amber" : h.labels.length > 1 ? "violet" : h.labels.length ? "cyan" : "green" }], lines: [{ text: h.note, tone: h.labels.length ? "learn" : "info" }], snap });
    if (!tr.ok) moments.push({ tokens: [], lines: [{ text: tr.why ?? "dropped", tone: "bad" }], views: { [tr.path[tr.path.length - 1]]: { ring: "bad", bubble: { text: "dropped", tone: "bad" } } }, snap });
  };
  leg(fwd, false);
  if (back) leg(back, true);
  if (t.ok) moments.push({ tokens: [], lines: [{ text: `${t.from} ↔ ${t.dst} (${t.reached}): success.`, tone: "ok" }], snap });
  return { id: s.runs.length + 1 + s.seq * 1000, cmd: `ping ${t.dst} from ${t.from}`, kind: "test", moments, ok: t.ok };
}
export function vpTest(s0: VpState, from: VpCe, dst: string): VpState {
  const s = cl(s0);
  s.clock += 2;
  const fwd = vpForward(s.cfg, s.view, s.os, from, dst);
  let back: VpTrace | undefined;
  let ok = fwd.ok;
  if (fwd.ok && fwd.dstCe) {
    back = vpForward(s.cfg, s.view, s.os, fwd.dstCe, CES[from].ip);
    ok = back.ok && back.dstCe === from;
    if (back.ok && back.dstCe !== from) back = { ...back, ok: false, why: `the reply reaches ${back.dstCe}, not ${from}` };
  }
  const t: VpTest = { id: s.tests.length + 1, from, dst, ok, path: fwd.path, reached: fwd.dstCe, why: !fwd.ok ? fwd.why : back && !back.ok ? `the reply fails — ${back.why}` : undefined, cfgSeq: s.cfgSeq };
  s.tests = [...s.tests, t].slice(-40);
  const run = testRun(s, t, fwd, back);
  s.runs = [...s.runs, run];
  s.last = run;
  s.log = [...s.log, { seq: s.seq, t: s.clock, text: `ping ${dst} from ${from}: ${ok ? `success (${fwd.dstCe})` : t.why}`, tone: ok ? "ok" : "warn" }];
  return s;
}

const pwKey = (p: VpPw) => `${p.pe}|${p.xc.ac}|${p.xc.pwid}|${p.xc.nbr}`;
function converge(prev: VpState, s: VpState, why: string, show = true): VpState {
  const view = vpCompute(s.cfg, s.os);
  s.view = view;
  const snap = { view: spClone(view) };
  const moments: SpMoment<VpSnap>[] = [];
  for (const l of VP_LINKS) {
    if (prev.view.ldp[l.id] !== view.ldp[l.id]) {
      moments.push({ tokens: view.ldp[l.id] ? [{ from: l.a, to: l.b, label: "LDP", color: "cyan" }] : [], lines: [{ text: `LDP ${l.a}–${l.b} ${view.ldp[l.id] ? "Operational — transport labels are exchanged again" : "goes down — the labels learned over it are withdrawn"}.`, tone: view.ldp[l.id] ? "ok" : "bad" }], snap });
      s.sys.push({ t: s.clock, dev: l.a, kind: view.ldp[l.id] ? "ldp-up" : "ldp-down", peer: VP_LO[l.b] }, { t: s.clock, dev: l.b, kind: view.ldp[l.id] ? "ldp-up" : "ldp-down", peer: VP_LO[l.a] });
    }
  }
  if (prev.view.tldp.up !== view.tldp.up) {
    moments.push({ tokens: view.tldp.up ? [{ from: "PE1", to: "PE2", label: "targeted LDP", color: "amber" }] : [], lines: [{ text: view.tldp.up ? "PE1 ↔ PE2: targeted hellos answered, the targeted LDP session is Operational." : "The targeted LDP session PE1 ↔ PE2 goes down: every pseudowire label is withdrawn.", tone: view.tldp.up ? "ok" : "bad" }], snap });
    for (const pe of VP_PES) s.sys.push({ t: s.clock, dev: pe, kind: view.tldp.up ? "ldp-up" : "ldp-down", peer: VP_LO[otherPe(pe)] });
  }
  const lines: { text: string; tone: "ok" | "bad" | "learn" | "warn" }[] = [];
  const tokens: { from: string; to: string; label: string; color: string }[] = [];
  for (const p of view.pws) {
    const was = prev.view.pws.find((x) => pwKey(x) === pwKey(p));
    if (p.up && !was?.up) {
      lines.push({ text: `${p.pe}: pseudowire ${p.xc.pwid} to ${p.xc.nbr} is up — it pushes ${p.remote!.label}, receives on ${p.local}.`, tone: "ok" });
      tokens.push({ from: p.pe, to: otherPe(p.pe), label: `Label Mapping PW ${p.xc.pwid}: ${p.local}`, color: "violet" });
      s.sys.push({ t: s.clock, dev: p.pe, kind: "pw-up", peer: p.xc.nbr, pwid: p.xc.pwid });
    } else if (!p.up && (was?.up || !was)) {
      lines.push({ text: `${p.pe}: pseudowire ${p.xc.pwid ?? "?"}${p.xc.nbr ? ` to ${p.xc.nbr}` : ""} is down — ${pwWhyText(p, s.os)}.`, tone: "bad" });
      if (was?.up) s.sys.push({ t: s.clock, dev: p.pe, kind: "pw-down", peer: p.xc.nbr, pwid: p.xc.pwid });
    }
  }
  for (const p of prev.view.pws) if (p.up && !view.pws.some((x) => pwKey(x) === pwKey(p))) {
    lines.push({ text: `${p.pe}: pseudowire ${p.xc.pwid} was removed.`, tone: "warn" });
    s.sys.push({ t: s.clock, dev: p.pe, kind: "pw-down", peer: p.xc.nbr, pwid: p.xc.pwid });
  }
  if (lines.length) moments.push({ tokens: tokens.slice(0, 2), lines: lines.slice(0, 6), snap });
  if (show && moments.length) {
    const run: SpRun<VpSnap> = { id: s.runs.length + 1 + s.seq * 1000, cmd: why, kind: "converge", moments };
    s.runs = [...s.runs, run];
    s.last = run;
  }
  return s;
}

// ---------------------------------------------------------------------------------------------------------------
// Tickets
// ---------------------------------------------------------------------------------------------------------------
export type VpTicketId = "pwid" | "mtu" | "nbr" | "vlan" | "transport";
export interface VpTicketDef {
  id: VpTicketId;
  title: string;
  report: string;
  reproLabel: string;
  repro: VpAction[];
  fault: (c: VpConfig) => void;
}
const ping = (from: VpCe, dst: string): VpAction => ({ type: "test", from, dst });
const xcOf = (c: VpCfg, cust: string) => c.xcs.find((x) => x.group === cust || x.ac?.endsWith(cust === "CUST-A" ? ".100" : ".200"))!;
export const VP_TICKETS: VpTicketDef[] = [
  {
    id: "pwid",
    title: "CUST-A's wire is dead",
    report: "“CUST-A's two sites lost each other after last night's change on PE2. The provider core is fine, the targeted LDP session is up, both customer ports are up. CUST-B is fine.”",
    reproLabel: "ping 192.168.100.2 from CE1A",
    repro: [ping("CE1A", "192.168.100.2")],
    fault: (c) => {
      xcOf(c.PE2, "CUST-A").pwid = 6000;
    },
  },
  {
    id: "mtu",
    title: "Jumbo-ready, and down",
    report: "“To make room for an extra tag, someone raised the MTU of CUST-A's service on PE2. Since then CUST-A's sites can't see each other. Nothing else was touched.”",
    reproLabel: "ping 192.168.100.2 from CE1A",
    repro: [ping("CE1A", "192.168.100.2")],
    fault: (c) => {
      c.PE2.acs[xcOf(c.PE2, "CUST-A").ac!].mtu = 1504;
    },
  },
  {
    id: "nbr",
    title: "CUST-B never came up",
    report: "“CUST-B's service was re-provisioned on PE1 from a ticket this morning and never came back. PE1 pings PE2's loopback fine. CUST-A works.”",
    reproLabel: "ping 192.168.100.2 from CE1B",
    repro: [ping("CE1B", "192.168.100.2")],
    fault: (c) => {
      xcOf(c.PE1, "CUST-B").nbr = "4.4.4.14";
    },
  },
  {
    id: "vlan",
    title: "The wire is up, nothing passes",
    report: "“Every pseudowire shows up — the NOC checked — but CUST-A's sites still can't reach each other since PE2's line card was replaced and its sub-interfaces retyped. The customer swears they changed nothing.”",
    reproLabel: "ping 192.168.100.2 from CE1A",
    repro: [ping("CE1A", "192.168.100.2")],
    fault: (c) => {
      const k = xcOf(c.PE2, "CUST-A").ac!;
      c.PE2.acs[k].vlan = 200;
    },
  },
  {
    id: "transport",
    title: "After the core upgrade",
    report: "“Since P1 was upgraded, neither customer's wire carries traffic. The targeted LDP session between the PEs is up and PE1 pings PE2's loopback.”",
    reproLabel: "ping 192.168.100.2 from CE1A",
    repro: [ping("CE1A", "192.168.100.2")],
    fault: (c) => {
      c.P1.ldp["ge-0/0/1"] = false;
    },
  },
];
export const vpTicket = (id: string) => VP_TICKETS.find((t) => t.id === id)!;
export function vpTicketState(id: VpTicketId, seq = 0, os: VpOs = "xr"): VpState {
  const s = createVpNet(seq, os);
  const nx = cl(s);
  vpTicket(id).fault(nx.cfg);
  const out = converge(s, nx, "", false);
  out.ticket = id;
  out.runs = [];
  out.last = undefined;
  out.log = [...out.log, { seq, t: out.clock, text: `Ticket opened: ${vpTicket(id).title}.`, tone: "warn" }];
  return out;
}

export function vpApply(s0: VpState, a: VpAction): VpState {
  switch (a.type) {
    case "cfg": {
      const s = cl(s0);
      s.hist[a.dev] = [spClone(s0.cfg[a.dev]), ...s.hist[a.dev]].slice(0, 20);
      s.cfg[a.dev] = spClone(a.cfg);
      s.cfgSeq += 1;
      s.clock += 1;
      s.sys.push({ t: s.clock, dev: a.dev, kind: "commit" });
      s.log = [...s.log, { seq: s.seq, t: s.clock, text: `${a.dev}: ${a.text}`, tone: "info", dev: a.dev }];
      return converge(s0, s, `${a.dev}: ${a.text}`);
    }
    case "set": {
      const s = cl(s0);
      for (const ch of a.changes) ch.f(s.cfg[ch.dev]);
      s.cfgSeq += 1;
      s.clock += 1;
      s.log = [...s.log, { seq: s.seq, t: s.clock, text: a.text, tone: "info" }];
      return converge(s0, s, a.text);
    }
    case "test":
      return vpTest(s0, a.from, a.dst);
    case "ticket":
      return vpTicketState(a.id, s0.seq + 1, s0.os);
    case "os":
      return createVpNet(s0.seq + 1, a.os);
    case "wipe-a": {
      const s = cl(s0);
      const x = xcOf(s.cfg.PE2, "CUST-A");
      if (x?.ac) delete s.cfg.PE2.acs[x.ac];
      s.cfg.PE2.xcs = s.cfg.PE2.xcs.filter((y) => y !== x);
      s.wiped = true;
      s.cfgSeq += 1;
      s.clock += 1;
      s.log = [...s.log, { seq: s.seq, t: s.clock, text: "PE2's CUST-A service was deleted: its sub-interface and its cross-connect are gone.", tone: "warn" }];
      return converge(s0, s, "PE2 loses CUST-A's attachment circuit and cross-connect");
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Diagnosis, proofs, ladder
// ---------------------------------------------------------------------------------------------------------------
export const VP_CAUSES: { id: string; label: string }[] = [
  { id: "pwid", label: "The two PEs use different PW IDs for the service" },
  { id: "mtu", label: "The two ends signal different MTUs" },
  { id: "nbr", label: "A cross-connect points at the wrong neighbor address" },
  { id: "vlan", label: "An attachment circuit expects a different VLAN than its CE sends" },
  { id: "transport", label: "The transport LSP between the PEs is broken (LDP)" },
  { id: "mac", label: "The PEs haven't learned the customers' MAC addresses" },
  { id: "ip", label: "Both customers use the same IP subnet" },
];
const lastTest = (s: VpState) => s.tests[s.tests.length - 1];
export function vpCauseFeedback(s: VpState, cause: string): { right: boolean; text: string } {
  const t = s.ticket as VpTicketId | undefined;
  const xr = s.os === "xr";
  if (cause === t) {
    const txt: Record<VpTicketId, string> = {
      pwid: `Yes. PE2's cross-connect for CUST-A now uses PW ID 6000, PE1's uses 5000. Each PE advertises a label mapping for its own PW FEC (Ethernet, PW ID); neither receives one for the PW ID it configured, so neither has a remote label and the pseudowire stays down — ${xr ? "IOS XR shows it down ( local ready ) with the remote label unknown" : "Junos shows OL (no outgoing label)"}. The targeted LDP session, the transport and both attachment circuits are fine.`,
      mtu: `Yes. PE2 now signals MTU 1504 for CUST-A, PE1 signals 1500. Pseudowire MTUs must match, so both ends keep it down (${xr ? "the MPLS table of show l2vpn xconnect detail shows MTU 1500 / 1504" : "Junos shows MM, mtu mismatch"}). The remote label is known; the MTU check refuses it.`,
      nbr: `Yes. PE1's cross-connect for CUST-B now points at 4.4.4.14 instead of PE2's loopback 4.4.4.4. PE1 sends targeted hellos to an address nobody owns (show mpls ldp discovery: no reply), so no label mapping for PW 5100 ever arrives — and PE2's side waits for a mapping from 1.1.1.1 that PE1 sends nowhere. CUST-A's pseudowire, to the right address, stays up.`,
      vlan: "Yes. PE2's sub-interface for CUST-A now accepts VLAN 200, while CE2A still sends and expects VLAN 100. The pseudowire is up — both PEs agree on PW 5000 — but frames from CE1A leave PE2 tagged 200 and CE2A drops them, and CE2A's own frames (VLAN 100) match no attachment circuit on PE2.",
      transport: xr ? "Yes. P1 no longer runs LDP toward P2, so P1 has no label for 4.4.4.4 (Unlabelled). PE1 still pushes PW label 25001 and transport label 24102; P1 removes the transport label — P2 now sees 25001, a label only PE2 understands, and drops it. The targeted LDP session runs over plain IP and stays up, so the pseudowire looks up." : "Yes. P1 no longer runs LDP toward P2. With ordered label control no LSP to 4.4.4.4 is built back to PE1, and Junos keeps an l2circuit down while there is no LSP to its neighbor in inet.3. The targeted LDP session runs over plain IP and stays up.",
    };
    return { right: true, text: txt[t] };
  }
  const lt = lastTest(s);
  switch (cause) {
    case "mac":
      return { right: false, text: "VPWS never learns MAC addresses: whatever enters the attachment circuit goes into the pseudowire. MAC learning belongs to VPLS." };
    case "ip":
      return { right: false, text: "The PEs never look at the customers' IP addresses — that's why both customers can use 192.168.100.0/24." };
    case "pwid":
      return { right: false, text: "Both ends of every cross-connect use the same PW ID (5000 for CUST-A, 5100 for CUST-B)." };
    case "mtu":
      return { right: false, text: "Both ends of every pseudowire signal the same MTU (1500)." };
    case "nbr":
      return { right: false, text: "Every cross-connect points at the other PE's loopback, and the targeted LDP session is up." };
    case "vlan":
      return { right: false, text: "Every attachment circuit accepts the VLAN its CE uses (100 for CUST-A, 200 for CUST-B)." };
    case "transport":
      return { right: false, text: "LDP runs on every core link: the PEs push complete transport labels toward each other." };
  }
  return { right: false, text: lt ? "That doesn't match the evidence." : "Run the user's test first." };
}
export function vpProofs(s: VpState): { label: string; ok: boolean; detail: string }[] {
  const t = s.ticket as VpTicketId | undefined;
  if (!t) return [];
  const fresh = s.tests.filter((x) => x.cfgSeq === s.cfgSeq);
  const p0 = vpTicket(t).repro[0] as { from: VpCe; dst: string };
  const proof = { label: `A fresh ping ${p0.dst} from ${p0.from} succeeds`, ok: fresh.some((x) => x.from === p0.from && x.dst === p0.dst && x.ok), detail: "run the test again after the fix" };
  const xr = s.os === "xr";
  const pwShow = xr ? "show l2vpn xconnect detail" : "show l2circuit connections";
  const upFor = (pe: VpR, vlan: number) => s.view.pws.some((p) => p.pe === pe && p.xc.ac?.endsWith(`.${vlan}`) && p.up);
  switch (t) {
    case "pwid":
      return [{ label: "Both ends of CUST-A's pseudowire use PW ID 5000, and it is up", ok: upFor("PE1", 100) && upFor("PE2", 100), detail: `${pwShow} on PE2` }, proof];
    case "mtu":
      return [{ label: "Both ends of CUST-A's pseudowire signal the same MTU, and it is up", ok: upFor("PE1", 100) && upFor("PE2", 100), detail: `${pwShow} on PE2` }, proof];
    case "nbr":
      return [{ label: "PE1's CUST-B cross-connect points at 4.4.4.4, and the pseudowire is up", ok: upFor("PE1", 200) && s.cfg.PE1.xcs.some((x) => x.ac?.endsWith(".200") && x.nbr === VP_LO.PE2), detail: `${pwShow} on PE1` }, proof];
    case "vlan":
      return [{ label: "PE2's CUST-A attachment circuit accepts VLAN 100 again", ok: Object.entries(s.cfg.PE2.acs).some(([k, a]) => k.startsWith("ge-0/0/1.") && a.vlan === 100 && s.cfg.PE2.xcs.some((x) => x.ac === k)), detail: xr ? "show l2vpn xconnect detail on PE2 (VLAN ranges)" : "show configuration interfaces ge-0/0/1 on PE2" }, proof];
    case "transport":
      return [{ label: "LDP runs on P1–P2", ok: s.view.ldp["P1-P2"], detail: xr ? "show mpls ldp neighbor brief on P1" : "show ldp session on P1" }, proof];
  }
}
export function vpLadder(s: VpState): { k: string; title: string; text: string }[] {
  const t = lastTest(s);
  const v = s.view;
  const acBad = VP_CES.filter((ce) => {
    const d = CES[ce];
    const ac = s.cfg[d.pe].acs[acKey(d.ifn, d.vlan)];
    return !ac || ac.vlan !== d.vlan || !s.cfg[d.pe].xcs.some((x) => x.ac === acKey(d.ifn, d.vlan));
  }).map((ce) => {
    const d = CES[ce];
    const other = Object.entries(s.cfg[d.pe].acs).find(([k]) => k.startsWith(`${d.ifn}.`));
    return `${d.pe} has no attachment circuit for ${ce}'s VLAN ${d.vlan}${other ? ` (${other[0]} accepts VLAN ${other[1].vlan ?? "none"})` : ""}`;
  });
  const down = v.pws.filter((p) => !p.up).map((p) => `${p.pe} PW ${p.xc.pwid ?? "?"}: ${pwWhyText(p, s.os)}`);
  const brokenLdp = VP_LINKS.filter((l) => !v.ldp[l.id]).map((l) => l.id);
  return [
    { k: "test", title: "What did the test show?", text: t ? `ping ${t.dst} from ${t.from}: ${t.ok ? `success (${t.reached})` : t.why}.` : "Run the user's test first." },
    { k: "ac", title: "Does every CE's VLAN land in an attachment circuit?", text: acBad.join(" · ") || "Yes." },
    { k: "tldp", title: "Is the targeted LDP session up?", text: v.tldp.up ? "Yes: PE1 ↔ PE2 Operational." : `No. PE1 tries ${v.tldp.tries.PE1.join(", ") || "nobody"}; PE2 tries ${v.tldp.tries.PE2.join(", ") || "nobody"}.` },
    { k: "pw", title: "Is every pseudowire up, with a remote label?", text: down.join(" · ") || "Yes, on both PEs." },
    { k: "lsp", title: "Is the transport LSP complete?", text: brokenLdp.length ? `No LDP on ${brokenLdp.join(", ")}.` : "Yes: LDP on every core link." },
  ];
}
