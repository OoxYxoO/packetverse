import { spClone, type SpBase, type SpMoment, type SpRun } from "@/components/sp-lab/spKit";

/**
 * MPLS VPLS Lab network — the guided lesson's three PEs and three P routers, one multipoint Ethernet service.
 *
 *              CE1 (192.168.100.1)
 *               │ VLAN 100
 *              PE1 1.1.1.1
 *               │
 *              P1 10.10.10.1
 *            ╱      ╲
 *   10.10.10.2 P2    P3 10.10.10.3
 *            │        │
 *   2.2.2.2 PE2      PE3 3.3.3.3
 *          │  ┊        │
 *        CE2  CE4     CE3
 *
 * CE4 (192.168.100.4) is cabled to PE2's ge-0/0/2 but not yet part of the service (a challenge connects it).
 *
 * Modeled (RFC 4762, LDP-signaled VPLS):
 * - A VPLS instance per PE (IOS XR: l2vpn bridge group CUST-A → bridge-domain VPLS-A → vfi VPLS-A with neighbor X pw-id
 *   500; Junos: routing-instances VPLS-A instance-type vpls, protocols vpls vpls-id 500 neighbor X). Attachment
 *   circuits are VLAN sub-interfaces placed in the bridge domain / instance.
 * - A full mesh of pseudowires, each signaled over its own targeted LDP session between two PE loopbacks. A pseudowire
 *   is up when both ends list each other with the same PW ID (VPLS ID) and the same MTU (Junos also wants an LSP to the
 *   neighbor). Labels are directional, chosen by the receiver (the guided lesson's: PE1 receives 24012 from PE2 …).
 * - The PE is a bridge: it learns source MACs per port (AC or pseudowire), forwards known unicast to one port, and
 *   floods broadcast / unknown unicast to every other port — except that a frame received on a pseudowire is never
 *   sent out another pseudowire (split horizon). That is why the mesh must be full.
 * - CEs keep an ARP cache: the first ping to a host broadcasts an ARP request; later pings send unicast only.
 * - Transport: LDP on the core links, label control by OS (IOS XR independent, Junos ordered) as in earlier labs.
 */

export type VsR = "PE1" | "P1" | "P2" | "P3" | "PE2" | "PE3";
export type VsCe = "CE1" | "CE2" | "CE3" | "CE4";
export const VS_ROUTERS: VsR[] = ["PE1", "P1", "P2", "P3", "PE2", "PE3"];
export const VS_PES: VsR[] = ["PE1", "PE2", "PE3"];
export const VS_LO: Record<VsR, string> = { PE1: "1.1.1.1", P1: "10.10.10.1", P2: "10.10.10.2", P3: "10.10.10.3", PE2: "2.2.2.2", PE3: "3.3.3.3" };
export type IfName = "ge-0/0/0" | "ge-0/0/1" | "ge-0/0/2";
export interface VsCeDef {
  pe: VsR;
  ifn: IfName;
  vlan: number;
  ip: string;
  mac: string;
}
export const CES: Record<VsCe, VsCeDef> = {
  CE1: { pe: "PE1", ifn: "ge-0/0/1", vlan: 100, ip: "192.168.100.1", mac: "00:11:11:11:11:11" },
  CE2: { pe: "PE2", ifn: "ge-0/0/1", vlan: 100, ip: "192.168.100.2", mac: "00:22:22:22:22:22" },
  CE3: { pe: "PE3", ifn: "ge-0/0/1", vlan: 100, ip: "192.168.100.3", mac: "00:33:33:33:33:33" },
  CE4: { pe: "PE2", ifn: "ge-0/0/2", vlan: 100, ip: "192.168.100.4", mac: "00:44:44:44:44:44" },
};
export const VS_CES = Object.keys(CES) as VsCe[];
export const BCAST = "ff:ff:ff:ff:ff:ff";
export interface VsLink {
  id: string;
  a: VsR;
  ai: IfName;
  aip: string;
  b: VsR;
  bi: IfName;
  bip: string;
}
export const VS_LINKS: VsLink[] = [
  { id: "PE1-P1", a: "PE1", ai: "ge-0/0/0", aip: "192.0.2.0", b: "P1", bi: "ge-0/0/0", bip: "192.0.2.1" },
  { id: "P1-P2", a: "P1", ai: "ge-0/0/1", aip: "192.0.2.2", b: "P2", bi: "ge-0/0/0", bip: "192.0.2.3" },
  { id: "P1-P3", a: "P1", ai: "ge-0/0/2", aip: "192.0.2.4", b: "P3", bi: "ge-0/0/0", bip: "192.0.2.5" },
  { id: "P2-PE2", a: "P2", ai: "ge-0/0/1", aip: "192.0.2.6", b: "PE2", bi: "ge-0/0/0", bip: "192.0.2.7" },
  { id: "P3-PE3", a: "P3", ai: "ge-0/0/1", aip: "192.0.2.8", b: "PE3", bi: "ge-0/0/0", bip: "192.0.2.9" },
];
export const coreIfs = (r: VsR) => VS_LINKS.filter((l) => l.a === r || l.b === r).map((l) => (l.a === r ? { ifn: l.ai, ip: l.aip, peer: l.b, peerIp: l.bip, link: l } : { ifn: l.bi, ip: l.bip, peer: l.a, peerIp: l.aip, link: l }));
export const ceIfs = (r: VsR) => VS_CES.filter((c) => CES[c].pe === r).map((c) => ({ ce: c, ...CES[c] }));
export const peOfLo = (ip: string) => VS_ROUTERS.find((r) => VS_LO[r] === ip);
/** The router path from a to b over the core tree. */
export function pathBetween(a: VsR, b: VsR): VsR[] {
  const prev: Partial<Record<VsR, VsR>> = {};
  const q: VsR[] = [a];
  const seen = new Set<VsR>([a]);
  while (q.length) {
    const x = q.shift()!;
    if (x === b) break;
    for (const n of coreIfs(x).map((y) => y.peer)) {
      if (seen.has(n)) continue;
      seen.add(n);
      prev[n] = x;
      q.push(n);
    }
  }
  const out: VsR[] = [b];
  while (out[0] !== a) out.unshift(prev[out[0]]!);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------------------------------------------
export interface VsAc {
  vlan?: number;
  /** Junos: unit encapsulation vlan-vpls (IOS XR: the sub-interface is l2transport). */
  vpls: boolean;
}
export interface VsBd {
  group: string;
  name: string;
  /** The bridge domain / instance MTU signaled for every pseudowire (default 1500). */
  mtu: number;
  acs: string[];
  /** IOS XR: neighbor X pw-id N under the VFI. Junos: neighbor X (the PW ID is the instance's vpls-id). */
  nbrs: { ip: string; pwid?: number }[];
  /** Junos: protocols vpls vpls-id. */
  vplsId?: number;
  /** IOS XR: the VFI exists. */
  vfi: boolean;
}
export interface VsCfg {
  acs: Record<string, VsAc>;
  bd?: VsBd;
  ldp: Partial<Record<IfName, boolean>>;
  ldpLo: boolean;
}
export type VsConfig = Record<VsR, VsCfg>;
export type VsOs = "xr" | "junos";
export const acKey = (ifn: string, unit: number) => `${ifn}.${unit}`;
export const VPLS_ID = 500;
export function vsHealthy(): VsConfig {
  const c = {} as VsConfig;
  for (const r of VS_ROUTERS) {
    const ldp: Partial<Record<IfName, boolean>> = {};
    for (const x of coreIfs(r)) ldp[x.ifn] = true;
    c[r] = { acs: {}, ldp, ldpLo: true };
  }
  for (const pe of VS_PES) {
    const ce = ceIfs(pe).find((x) => x.ce !== "CE4")!;
    const k = acKey(ce.ifn, ce.vlan);
    c[pe].acs[k] = { vlan: ce.vlan, vpls: true };
    c[pe].bd = { group: "CUST-A", name: "VPLS-A", mtu: 1500, acs: [k], nbrs: VS_PES.filter((p) => p !== pe).map((p) => ({ ip: VS_LO[p], pwid: VPLS_ID })), vplsId: VPLS_ID, vfi: true };
  }
  return c;
}
export const pwidOf = (os: VsOs, bd: VsBd, n: { pwid?: number }) => (os === "xr" ? n.pwid : bd.vplsId);

// ---------------------------------------------------------------------------------------------------------------
// The control plane
// ---------------------------------------------------------------------------------------------------------------
export const LABEL_BASE: Record<VsOs, number> = { xr: 24000, junos: 299776 };
export const IMPLICIT_NULL = 3;
const FEC_ORDER = ["1.1.1.1", "2.2.2.2", "3.3.3.3"];
export function ldpLabel(os: VsOs, r: VsR, fec: string) {
  if (VS_LO[r] === fec) return IMPLICIT_NULL;
  return LABEL_BASE[os] + (r.startsWith("PE") ? 500 : 0) + 101 * VS_ROUTERS.indexOf(r) + FEC_ORDER.indexOf(fec) + 1;
}
const PE_IDX: Record<string, number> = { PE1: 1, PE2: 2, PE3: 3 };
/** The receive label PE `pe` allocates for its pseudowire with `remote` (IOS XR: the guided lesson's 24012, 25021 …). */
export function pwLabel(os: VsOs, pe: VsR, remote: VsR) {
  return os === "xr" ? 23000 + 1000 * PE_IDX[pe] + 10 * PE_IDX[pe] + PE_IDX[remote] : LABEL_BASE.junos + 40 * PE_IDX[pe] + PE_IDX[remote];
}
export type PwWhy = "nonbr" | "nosess" | "noremote" | "mtu" | "nolsp";
export interface VsPw {
  pe: VsR;
  peer?: VsR;
  ip: string;
  pwid?: number;
  up: boolean;
  why?: PwWhy;
  local?: number;
  remote?: { label: number; mtu: number };
  mtu: number;
}
export interface VsView {
  ldp: Record<string, boolean>;
  lsp: Record<VsR, Partial<Record<string, { out?: number; nh?: VsR }>>>;
  tldp: Record<string, boolean>;
  pws: VsPw[];
}
export const ldpUp = (c: VsConfig, l: VsLink) => !!c[l.a].ldp[l.ai] && !!c[l.b].ldp[l.bi];
export const pairKey = (a: VsR, b: VsR) => [a, b].sort().join("-");
/** LDP sessions and the transport labels toward every PE loopback (IOS XR independent, Junos ordered control). */
export function vsTransport(c: Record<VsR, { ldp: Partial<Record<IfName, boolean>> }>, os: VsOs): Pick<VsView, "ldp" | "lsp"> {
  const ldp: Record<string, boolean> = Object.fromEntries(VS_LINKS.map((l) => [l.id, !!c[l.a].ldp[l.ai] && !!c[l.b].ldp[l.bi]]));
  const lsp = Object.fromEntries(VS_ROUTERS.map((r) => [r, {}])) as VsView["lsp"];
  for (const egress of VS_PES) {
    const fec = VS_LO[egress];
    for (const r of VS_ROUTERS) {
      if (r === egress) continue;
      const path = pathBetween(r, egress);
      // Walk from the router toward the egress: ordered control needs every session from r onward.
      let chain = true;
      for (let i = 0; i < path.length - 1; i++) {
        const l = VS_LINKS.find((x) => (x.a === path[i] && x.b === path[i + 1]) || (x.b === path[i] && x.a === path[i + 1]))!;
        if (!ldp[l.id]) chain = false;
      }
      const nh = path[1];
      const first = VS_LINKS.find((x) => (x.a === r && x.b === nh) || (x.b === r && x.a === nh))!;
      const has = ldp[first.id] && (os === "xr" || chain);
      lsp[r][fec] = has ? { out: ldpLabel(os, nh, fec), nh } : { nh };
    }
  }
  return { ldp, lsp };
}
export function vsCompute(c: VsConfig, os: VsOs): VsView {
  const { ldp, lsp } = vsTransport(c, os);
  const lists = (pe: VsR) => (c[pe].bd?.nbrs ?? []).map((n) => n.ip);
  const loOk = (pe: VsR) => os === "xr" || c[pe].ldpLo;
  const tldp: Record<string, boolean> = {};
  for (let i = 0; i < VS_PES.length; i++)
    for (let j = i + 1; j < VS_PES.length; j++) {
      const a = VS_PES[i];
      const b = VS_PES[j];
      tldp[pairKey(a, b)] = lists(a).includes(VS_LO[b]) && lists(b).includes(VS_LO[a]) && loOk(a) && loOk(b);
    }
  const pws: VsPw[] = [];
  for (const pe of VS_PES) {
    const bd = c[pe].bd;
    if (!bd || (os === "xr" && !bd.vfi)) continue;
    for (const n of bd.nbrs) {
      const peer = peOfLo(n.ip);
      const pwid = pwidOf(os, bd, n);
      const pw: VsPw = { pe, peer, ip: n.ip, pwid, up: false, mtu: bd.mtu };
      pws.push(pw);
      if (!peer || !VS_PES.includes(peer) || peer === pe) {
        pw.why = "nonbr";
        continue;
      }
      pw.local = pwLabel(os, pe, peer);
      if (!tldp[pairKey(pe, peer)]) {
        pw.why = "nosess";
        continue;
      }
      const rbd = c[peer].bd!;
      const rn = rbd.nbrs.find((x) => x.ip === VS_LO[pe]);
      if (!rn || pwidOf(os, rbd, rn) !== pwid || (os === "xr" && !rbd.vfi)) {
        pw.why = "noremote";
        continue;
      }
      pw.remote = { label: pwLabel(os, peer, pe), mtu: rbd.mtu };
      if (rbd.mtu !== bd.mtu) {
        pw.why = "mtu";
        continue;
      }
      if (os === "junos" && lsp[pe][n.ip]?.out === undefined) {
        pw.why = "nolsp";
        continue;
      }
      pw.up = true;
    }
  }
  return { ldp, lsp, tldp, pws };
}
export function pwWhyText(p: VsPw, os: VsOs): string {
  switch (p.why) {
    case "nonbr":
      return `nobody answers targeted hellos at ${p.ip}: no session, no label`;
    case "nosess":
      return `no targeted LDP session with ${p.ip}: ${p.peer ?? "it"} doesn't list ${VS_LO[p.pe]} as a neighbor`;
    case "noremote":
      return `${p.peer} advertises no PW ID ${p.pwid} toward ${VS_LO[p.pe]}: no remote label`;
    case "mtu":
      return `MTU mismatch: local ${p.mtu}, remote ${p.remote?.mtu}`;
    case "nolsp":
      return os === "xr" ? "no LSP to the neighbor" : `no LSP to ${p.ip} in inet.3`;
  }
  return "down";
}

// ---------------------------------------------------------------------------------------------------------------
// The bridge (data plane)
// ---------------------------------------------------------------------------------------------------------------
/** A MAC table entry: learned on an attachment circuit ("ge-0/0/1.100") or a pseudowire ("pw:2.2.2.2"). */
export interface VsMac {
  mac: string;
  port: string;
  t: number;
}
export type VsFdb = Record<VsR, VsMac[]>;
export interface VsHop {
  from: string;
  to: string;
  labels: number[];
  note: string;
  tone?: "bad" | "ok";
}
/** What the bridge needs from a lab's configuration and view — LDP-signaled (this lab) or BGP-signaled VPLS alike. */
export interface VplsCfgLike {
  acs: Record<string, { vlan?: number }>;
  bd?: { acs: string[] };
}
export interface VplsPwLike {
  pe: VsR;
  peer?: VsR;
  ip: string;
  up: boolean;
  remote?: { label: number };
}
export interface VplsViewLike {
  pws: VplsPwLike[];
  lsp: Record<VsR, Partial<Record<string, { out?: number; nh?: VsR }>>>;
}
interface Frame {
  src: VsCe;
  dstMac: string;
  what: string;
}
interface Delivery {
  hops: VsHop[];
  reached: VsCe[];
  flooded: boolean;
  drops: string[];
}
const pwPort = (ip: string) => `pw:${ip}`;
const acCe = (pe: VsR, k: string) => ceIfs(pe).find((x) => k.startsWith(`${x.ifn}.`));
/** One Ethernet frame through the VPLS: learning, lookup, flooding, split horizon, the label path. Mutates fdb. */
function bridgeFrame(c: Record<VsR, VplsCfgLike>, v: VplsViewLike, os: VsOs, fdb: VsFdb, f: Frame, clock: number): Delivery {
  const out: Delivery = { hops: [], reached: [], flooded: false, drops: [] };
  const ce = CES[f.src];
  const pe = ce.pe;
  const bd = c[pe].bd;
  const k = acKey(ce.ifn, ce.vlan);
  out.hops.push({ from: f.src, to: pe, labels: [], note: `${f.src} sends ${f.what} (to ${f.dstMac === BCAST ? "broadcast" : f.dstMac}), VLAN ${ce.vlan}` });
  const ac = c[pe].acs[k];
  if (!ac || ac.vlan !== ce.vlan || !bd || !bd.acs.includes(k)) {
    out.drops.push(`${pe} has no attachment circuit for VLAN ${ce.vlan} on ${ce.ifn} in the VPLS — the frame is dropped`);
    return out;
  }
  const learn = (r: VsR, port: string) => {
    fdb[r] = [...fdb[r].filter((m) => m.mac !== ce.mac), { mac: ce.mac, port, t: clock }];
  };
  const lookup = (r: VsR) => (f.dstMac === BCAST ? undefined : fdb[r].find((m) => m.mac === f.dstMac));
  const toLocalAc = (r: VsR, port: string) => {
    const tgt = acCe(r, port);
    const a = c[r].acs[port];
    if (!tgt) return;
    out.hops.push({ from: r, to: tgt.ce, labels: [], note: `${r}: out of ${port} (VLAN ${a?.vlan})` });
    if (a?.vlan !== tgt.vlan) return void out.drops.push(`${tgt.ce} receives the frame tagged VLAN ${a?.vlan}, but its interface uses VLAN ${tgt.vlan} — dropped`);
    if (f.dstMac === BCAST || f.dstMac === tgt.mac) out.reached.push(tgt.ce);
  };
  const remoteBridge = (r: VsR, from: VsR) => {
    // Received on a pseudowire: learn, then AC ports only (split horizon).
    learn(r, pwPort(VS_LO[from]));
    const hit = lookup(r);
    const rbd = c[r].bd!;
    if (hit) {
      if (hit.port.startsWith("pw:")) {
        out.hops.push({ from: r, to: r, labels: [], note: `${r}: ${f.dstMac} is behind ${hit.port.slice(3)} — but the frame came in on a pseudowire: split horizon, not forwarded` });
        out.drops.push(`${r} would have to relay the frame onto another pseudowire, which split horizon forbids`);
        return;
      }
      return toLocalAc(r, hit.port);
    }
    out.flooded = true;
    const acs = rbd.acs.filter((x) => c[r].acs[x]);
    out.hops.push({ from: r, to: r, labels: [], note: `${r}: ${f.dstMac === BCAST ? "broadcast" : `${f.dstMac} unknown`} → its attachment circuits only (${acs.join(", ") || "none"}); never another pseudowire (split horizon)` });
    for (const x of acs) toLocalAc(r, x);
  };
  const overPw = (from: VsR, pw: VplsPwLike) => {
    const peer = pw.peer!;
    const path = pathBetween(from, peer);
    const fec = VS_LO[peer];
    let stack = [pw.remote!.label];
    const t0 = v.lsp[from][fec];
    if (t0?.out !== undefined && t0.out !== IMPLICIT_NULL) stack = [t0.out, ...stack];
    out.hops.push({ from, to: path[1], labels: stack, note: `${from}: push PW label ${pw.remote!.label} (chosen by ${peer})${t0?.out !== undefined && t0.out !== IMPLICIT_NULL ? ` and transport label ${t0.out}` : " — no transport label (Unlabelled)"}` });
    for (let i = 1; i < path.length - 1; i++) {
      const rr = path[i];
      const nx = path[i + 1];
      const top = stack[0];
      if (top !== ldpLabel(os, rr, fec)) {
        out.drops.push(`${rr} receives label ${top} — the PW label ${peer} allocated, which ${rr} never allocated — and drops the frame`);
        return;
      }
      const t = v.lsp[rr][fec];
      if (t?.out === undefined || t.out === IMPLICIT_NULL) stack = stack.slice(1);
      else stack = [t.out, ...stack.slice(1)];
      out.hops.push({ from: rr, to: nx, labels: stack, note: t?.out === undefined ? `${rr}: no label from ${nx} for ${fec} (Unlabelled) → removes ${top}; the PW label is on top` : t.out === IMPLICIT_NULL ? `${rr}: pops ${top} (PHP) — the PW label is left` : `${rr}: swaps ${top} → ${t.out}` });
    }
    remoteBridge(peer, from);
  };
  learn(pe, k);
  const hit = lookup(pe);
  const upPws = v.pws.filter((p) => p.pe === pe && p.up);
  if (hit) {
    if (hit.port.startsWith("pw:")) {
      const pw = upPws.find((p) => pwPort(p.ip) === hit.port);
      if (!pw) return (out.drops.push(`${pe}: ${f.dstMac} is learned on ${hit.port.slice(3)}, but that pseudowire is down`), out);
      out.hops.push({ from: pe, to: pe, labels: [], note: `${pe}: ${f.dstMac} is known, behind ${hit.port.slice(3)} → that pseudowire only` });
      overPw(pe, pw);
    } else if (hit.port !== k) {
      out.hops.push({ from: pe, to: pe, labels: [], note: `${pe}: ${f.dstMac} is known, on ${hit.port} → local switching` });
      toLocalAc(pe, hit.port);
    }
    return out;
  }
  out.flooded = true;
  const localAcs = bd.acs.filter((x) => x !== k && c[pe].acs[x]);
  out.hops.push({ from: pe, to: pe, labels: [], note: `${pe}: ${f.dstMac === BCAST ? "broadcast" : `${f.dstMac} unknown`} → flood to every other port: ${[...localAcs, ...upPws.map((p) => `PW ${p.peer}`)].join(", ") || "none"}` });
  for (const x of localAcs) toLocalAc(pe, x);
  for (const pw of upPws) overPw(pe, pw);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------------------------------------------
export interface VsSnap {
  view: VsView;
  fdb: VsFdb;
}
export interface VsTest {
  id: number;
  from: VsCe;
  dst: string;
  ok: boolean;
  reached?: VsCe;
  why?: string;
  flooded: boolean;
  path: string[];
  cfgSeq: number;
  t: number;
}
export interface VsSys {
  t: number;
  dev: VsR;
  kind: "commit" | "ldp-up" | "ldp-down" | "pw-up" | "pw-down" | "clear";
  peer?: string;
  pwid?: number;
}
export interface VsState extends SpBase<VsSnap> {
  os: VsOs;
  cfg: VsConfig;
  hist: Record<VsR, VsCfg[]>;
  view: VsView;
  fdb: VsFdb;
  /** Each CE's ARP cache: IP → MAC. */
  arp: Record<VsCe, Record<string, string>>;
  sys: VsSys[];
  tests: VsTest[];
  wiped?: boolean;
  /** Clock of the last MAC table clear (for the challenge). */
  cleared?: number;
}
export type VsAction =
  | { type: "cfg"; dev: VsR; cfg: VsCfg; text: string }
  | { type: "set"; changes: { dev: VsR; f: (c: VsCfg) => void }[]; text: string }
  | { type: "test"; from: VsCe; dst: string }
  | { type: "clear"; dev?: VsR }
  | { type: "ticket"; id: VsTicketId }
  | { type: "os"; os: VsOs }
  | { type: "wipe-pe3" };

const cl = (o: VsState): VsState => ({ ...spClone(o), runs: o.runs, last: o.last });
const emptyFdb = (): VsFdb => Object.fromEntries(VS_ROUTERS.map((r) => [r, []])) as unknown as VsFdb;
export function createVsNet(seq = 0, os: VsOs = "xr"): VsState {
  const cfg = vsHealthy();
  const view = vsCompute(cfg, os);
  const s: VsState = { seq, os, cfgSeq: 0, clock: 3600, runs: [], log: [{ seq, t: 3600, text: "IS-IS and LDP are up; PE1, PE2 and PE3 are full-meshed with pseudowires (VPLS ID 500). The MAC tables are empty: nobody has sent anything yet.", tone: "info" }], cfg, hist: Object.fromEntries(VS_ROUTERS.map((r) => [r, []])) as unknown as Record<VsR, VsCfg[]>, view, fdb: emptyFdb(), arp: { CE1: {}, CE2: {}, CE3: {}, CE4: {} }, sys: [], tests: [] };
  for (const l of VS_LINKS) s.sys.push({ t: 20, dev: l.a, kind: "ldp-up", peer: VS_LO[l.b] }, { t: 20, dev: l.b, kind: "ldp-up", peer: VS_LO[l.a] });
  for (const p of view.pws) {
    s.sys.push({ t: 30, dev: p.pe, kind: "ldp-up", peer: p.ip });
    if (p.up) s.sys.push({ t: 32, dev: p.pe, kind: "pw-up", peer: p.ip, pwid: p.pwid });
  }
  return s;
}

/** The state a VPLS ping needs (and updates): MAC tables, CE ARP caches, the test log. */
export interface VplsPingState extends SpBase<{ view: VplsViewLike; fdb: VsFdb }> {
  os: VsOs;
  cfg: Record<VsR, VplsCfgLike>;
  view: VplsViewLike;
  fdb: VsFdb;
  arp: Record<VsCe, Record<string, string>>;
  tests: VsTest[];
}
/** A ping: ARP if needed (broadcast, then a unicast reply), then the echo request and the echo reply. */
export function vsTest(s0: VsState, from: VsCe, dst: string): VsState {
  return vplsPing(s0, from, dst, (pw) => pwWhyText(pw as VsPw, s0.os));
}
/** The ping engine shared by the VPLS labs; `whyOf` explains a down pseudowire in the lab's own terms. */
export function vplsPing<S extends VplsPingState>(s0: S, from: VsCe, dst: string, whyOf: (pw: VplsPwLike) => string): S {
  const s = { ...spClone(s0), runs: s0.runs, last: s0.last } as S;
  s.clock += 2;
  const snap = () => ({ view: spClone(s.view), fdb: spClone(s.fdb) });
  const moments: SpMoment<{ view: VplsViewLike; fdb: VsFdb }>[] = [];
  const target = VS_CES.find((x) => CES[x].ip === dst);
  let flooded = false;
  let why: string | undefined;
  const path: string[] = [from];
  const leg = (d: Delivery, color: string) => {
    for (const h of d.hops) {
      if (h.from !== h.to) path.push(h.to);
      moments.push({ tokens: h.from !== h.to ? [{ from: h.from, to: h.to, label: h.labels.length ? h.labels.join(" / ") : "frame", color: h.labels.length > 1 ? "violet" : h.labels.length ? "cyan" : color }] : [], lines: [{ text: h.note, tone: h.labels.length ? "learn" : "info" }], snap: snap() });
    }
    for (const x of d.drops) moments.push({ tokens: [], lines: [{ text: x, tone: "warn" }], snap: snap() });
    if (d.flooded) flooded = true;
  };
  const send = (src: VsCe, dstMac: string, what: string, color: string, want: VsCe) => {
    const d = bridgeFrame(s.cfg, s.view, s.os, s.fdb, { src, dstMac, what }, s.clock);
    leg(d, color);
    if (!d.reached.includes(want)) {
      const a = CES[src].pe;
      const b = CES[want].pe;
      const pw = s.view.pws.find((p) => p.pe === a && p.peer === b);
      const relevant = d.drops.find((x) => x.startsWith(b) || x.startsWith(want) || x.includes(`label ${pw?.remote?.label}`) || x.startsWith(a));
      const wk = acKey(CES[want].ifn, CES[want].vlan);
      const attached = !!s.cfg[b].bd?.acs.includes(wk) && !!s.cfg[b].acs[wk];
      why ??= relevant ?? (!attached ? `${what} never reaches ${want}: its port on ${b} isn't part of the VPLS` : a !== b && !pw?.up ? `${what} never reaches ${want}: ${a} has no working pseudowire to ${b} (${pw ? whyOf(pw) : "none configured"}); no other PE may relay it onto a pseudowire (split horizon)` : d.drops[d.drops.length - 1] ?? `${what} never reaches ${want}`);
    }
    return d.reached.includes(want);
  };
  let ok = false;
  if (!target || target === from) why = `nobody on the VPLS has ${dst}`;
  else {
    let mac = s.arp[from][dst];
    let step = true;
    if (!mac) {
      step = send(from, BCAST, `an ARP request for ${dst}`, "amber", target);
      if (step) {
        s.arp[target][CES[from].ip] = CES[from].mac;
        step = send(target, CES[from].mac, "the ARP reply", "amber", from);
        if (step) mac = s.arp[from][dst] = CES[target].mac;
      }
    }
    if (step && mac) step = send(from, mac, "an ICMP echo request", "green", target);
    if (step) {
      s.arp[target][CES[from].ip] ??= CES[from].mac;
      step = send(target, CES[from].mac, "the echo reply", "green", from);
    }
    ok = step;
    if (ok) why = undefined;
  }
  if (!target && !why) why = `nobody on the VPLS has ${dst}`;
  if (ok) moments.push({ tokens: [], lines: [{ text: `${from} ↔ ${dst} (${target}): success${flooded ? " — part of it flooded" : ", every frame unicast"}.`, tone: "ok" }], snap: snap() });
  else moments.push({ tokens: [], lines: [{ text: why ?? "failed", tone: "bad" }], snap: snap() });
  const t: VsTest = { id: s.tests.length + 1, from, dst, ok, reached: ok ? target : undefined, why, flooded, path, cfgSeq: s.cfgSeq, t: s.clock };
  s.tests = [...s.tests, t].slice(-40);
  const run: SpRun<{ view: VplsViewLike; fdb: VsFdb }> = { id: s.runs.length + 1 + s.seq * 1000, cmd: `ping ${dst} from ${from}`, kind: "test", moments, ok };
  s.runs = [...s.runs, run];
  s.last = run;
  s.log = [...s.log, { seq: s.seq, t: s.clock, text: `ping ${dst} from ${from}: ${ok ? `success (${target})${flooded ? ", flooded" : ""}` : why}`, tone: ok ? "ok" : "warn" }];
  return s;
}

const pwKey = (p: VsPw) => `${p.pe}|${p.ip}|${p.pwid}`;
function converge(prev: VsState, s: VsState, why: string, show = true): VsState {
  const view = vsCompute(s.cfg, s.os);
  s.view = view;
  // MACs learned on a pseudowire that went down, or on a port that left the bridge, are flushed.
  for (const pe of VS_PES) {
    const ups = new Set(view.pws.filter((p) => p.pe === pe && p.up).map((p) => pwPort(p.ip)));
    const acs = new Set(s.cfg[pe].bd?.acs ?? []);
    s.fdb[pe] = s.fdb[pe].filter((m) => (m.port.startsWith("pw:") ? ups.has(m.port) : acs.has(m.port) && !!s.cfg[pe].acs[m.port]));
  }
  const snap = { view: spClone(view), fdb: spClone(s.fdb) };
  const moments: SpMoment<VsSnap>[] = [];
  for (const l of VS_LINKS) {
    if (prev.view.ldp[l.id] !== view.ldp[l.id]) {
      moments.push({ tokens: view.ldp[l.id] ? [{ from: l.a, to: l.b, label: "LDP", color: "cyan" }] : [], lines: [{ text: `LDP ${l.a}–${l.b} ${view.ldp[l.id] ? "Operational — transport labels are exchanged again" : "goes down — the labels learned over it are withdrawn"}.`, tone: view.ldp[l.id] ? "ok" : "bad" }], snap });
      s.sys.push({ t: s.clock, dev: l.a, kind: view.ldp[l.id] ? "ldp-up" : "ldp-down", peer: VS_LO[l.b] }, { t: s.clock, dev: l.b, kind: view.ldp[l.id] ? "ldp-up" : "ldp-down", peer: VS_LO[l.a] });
    }
  }
  for (const [k, up] of Object.entries(view.tldp)) {
    if (prev.view.tldp[k] !== up) {
      const [a, b] = k.split("-") as VsR[];
      moments.push({ tokens: up ? [{ from: a, to: b, label: "targeted LDP", color: "amber" }] : [], lines: [{ text: up ? `${a} ↔ ${b}: targeted LDP session Operational.` : `${a} ↔ ${b}: the targeted LDP session goes down.`, tone: up ? "ok" : "bad" }], snap });
      s.sys.push({ t: s.clock, dev: a, kind: up ? "ldp-up" : "ldp-down", peer: VS_LO[b] }, { t: s.clock, dev: b, kind: up ? "ldp-up" : "ldp-down", peer: VS_LO[a] });
    }
  }
  const lines: { text: string; tone: "ok" | "bad" | "warn" }[] = [];
  for (const p of view.pws) {
    const was = prev.view.pws.find((x) => pwKey(x) === pwKey(p));
    if (p.up && !was?.up) {
      lines.push({ text: `${p.pe}: pseudowire to ${p.ip} (PW ID ${p.pwid}) is up — pushes ${p.remote!.label}, receives on ${p.local}.`, tone: "ok" });
      s.sys.push({ t: s.clock, dev: p.pe, kind: "pw-up", peer: p.ip, pwid: p.pwid });
    } else if (!p.up && (was?.up || !was)) {
      lines.push({ text: `${p.pe}: pseudowire to ${p.ip} is down — ${pwWhyText(p, s.os)}.`, tone: "bad" });
      if (was?.up) s.sys.push({ t: s.clock, dev: p.pe, kind: "pw-down", peer: p.ip, pwid: p.pwid });
    }
  }
  for (const p of prev.view.pws) if (p.up && !view.pws.some((x) => pwKey(x) === pwKey(p))) {
    lines.push({ text: `${p.pe}: pseudowire to ${p.ip} was removed.`, tone: "warn" });
    s.sys.push({ t: s.clock, dev: p.pe, kind: "pw-down", peer: p.ip, pwid: p.pwid });
  }
  if (lines.length) moments.push({ tokens: [], lines: lines.slice(0, 8), snap });
  if (show && moments.length) {
    const run: SpRun<VsSnap> = { id: s.runs.length + 1 + s.seq * 1000, cmd: why, kind: "converge", moments };
    s.runs = [...s.runs, run];
    s.last = run;
  }
  return s;
}

// ---------------------------------------------------------------------------------------------------------------
// Tickets
// ---------------------------------------------------------------------------------------------------------------
export type VsTicketId = "mesh" | "vplsid" | "mtu" | "vlan" | "transport";
export interface VsTicketDef {
  id: VsTicketId;
  title: string;
  report: string;
  reproLabel: string;
  repro: VsAction[];
  fault: (c: VsConfig) => void;
}
const ping = (from: VsCe, dst: string): VsAction => ({ type: "test", from, dst });
export const VS_TICKETS: VsTicketDef[] = [
  {
    id: "mesh",
    title: "Site 1 can't see site 3",
    report: "“Since PE3's VPLS configuration was cleaned up, CE1 can't reach CE3. CE1 ↔ CE2 and CE2 ↔ CE3 work fine, so the VPLS is clearly up.”",
    reproLabel: "ping 192.168.100.3 from CE1",
    repro: [ping("CE1", "192.168.100.3")],
    fault: (c) => {
      c.PE3.bd!.nbrs = c.PE3.bd!.nbrs.filter((n) => n.ip !== VS_LO.PE1);
    },
  },
  {
    id: "vplsid",
    title: "Site 2 is alone",
    report: "“After a template change on PE2, CE2 can't reach anybody. CE1 and CE3 still reach each other.”",
    reproLabel: "ping 192.168.100.1 from CE2",
    repro: [ping("CE2", "192.168.100.1")],
    fault: (c) => {
      const bd = c.PE2.bd!;
      bd.vplsId = 501;
      bd.nbrs = bd.nbrs.map((n) => ({ ...n, pwid: 501 }));
    },
  },
  {
    id: "mtu",
    title: "Jumbo frames for site 3",
    report: "“The customer asked for bigger frames at site 3, so someone raised the VPLS MTU on PE3. Now CE3 reaches nobody.”",
    reproLabel: "ping 192.168.100.3 from CE1",
    repro: [ping("CE1", "192.168.100.3")],
    fault: (c) => {
      c.PE3.bd!.mtu = 1504;
    },
  },
  {
    id: "vlan",
    title: "Every pseudowire up, site 2 silent",
    report: "“All the pseudowires show up, but CE2 reaches nobody since PE2's line card was replaced and its sub-interfaces retyped. CE1 ↔ CE3 works.”",
    reproLabel: "ping 192.168.100.2 from CE1",
    repro: [ping("CE1", "192.168.100.2")],
    fault: (c) => {
      c.PE2.acs["ge-0/0/1.100"].vlan = 200;
    },
  },
  {
    id: "transport",
    title: "After the P1 upgrade",
    report: "“Since P1 was upgraded, CE3 reaches nobody. CE1 ↔ CE2 still works, every targeted LDP session is up and PE3's loopback pings.”",
    reproLabel: "ping 192.168.100.3 from CE1",
    repro: [ping("CE1", "192.168.100.3")],
    fault: (c) => {
      c.P1.ldp["ge-0/0/2"] = false;
    },
  },
];
export const vsTicket = (id: string) => VS_TICKETS.find((t) => t.id === id)!;
export function vsTicketState(id: VsTicketId, seq = 0, os: VsOs = "xr"): VsState {
  const s = createVsNet(seq, os);
  const nx = cl(s);
  vsTicket(id).fault(nx.cfg);
  const out = converge(s, nx, "", false);
  out.ticket = id;
  out.runs = [];
  out.last = undefined;
  out.log = [...out.log, { seq, t: out.clock, text: `Ticket opened: ${vsTicket(id).title}.`, tone: "warn" }];
  return out;
}

export function vsApply(s0: VsState, a: VsAction): VsState {
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
      return vsTest(s0, a.from, a.dst);
    case "clear": {
      const s = cl(s0);
      s.clock += 1;
      for (const r of a.dev ? [a.dev] : VS_PES) s.fdb[r] = [];
      for (const ce of VS_CES) s.arp[ce] = {};
      s.cleared = s.clock;
      s.sys.push({ t: s.clock, dev: a.dev ?? "PE1", kind: "clear" });
      s.log = [...s.log, { seq: s.seq, t: s.clock, text: `${a.dev ? `${a.dev}'s MAC table` : "Every PE's MAC table"} cleared (and the CEs' ARP caches aged out).`, tone: "info" }];
      return s;
    }
    case "ticket":
      return vsTicketState(a.id, s0.seq + 1, s0.os);
    case "os":
      return createVsNet(s0.seq + 1, a.os);
    case "wipe-pe3": {
      const s = cl(s0);
      s.cfg.PE3.bd = undefined;
      s.cfg.PE3.acs = {};
      s.wiped = true;
      s.cfgSeq += 1;
      s.clock += 1;
      s.log = [...s.log, { seq: s.seq, t: s.clock, text: "PE3's VPLS was deleted: its bridge domain / instance and its sub-interface are gone.", tone: "warn" }];
      return converge(s0, s, "PE3 loses its VPLS configuration");
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Diagnosis, proofs, ladder
// ---------------------------------------------------------------------------------------------------------------
export const VS_CAUSES: { id: string; label: string }[] = [
  { id: "mesh", label: "A PE doesn't list every other PE as a VPLS neighbor (the mesh isn't full)" },
  { id: "vplsid", label: "One PE uses a different VPLS ID / PW ID" },
  { id: "mtu", label: "One PE signals a different MTU" },
  { id: "vlan", label: "An attachment circuit expects a different VLAN than its CE sends" },
  { id: "transport", label: "A transport LSP between the PEs is broken (LDP)" },
  { id: "shg", label: "Split horizon is blocking traffic that should be relayed" },
  { id: "mac", label: "The MAC tables are full or stale" },
];
const lastTest = (s: VsState) => s.tests[s.tests.length - 1];
export function vsCauseFeedback(s: VsState, cause: string): { right: boolean; text: string } {
  const t = s.ticket as VsTicketId | undefined;
  const xr = s.os === "xr";
  if (cause === t) {
    const txt: Record<VsTicketId, string> = {
      mesh: `Yes. PE3 no longer lists 1.1.1.1 as a neighbor, so there is no targeted LDP session and no pseudowire PE1–PE3. CE1 ↔ CE2 and CE2 ↔ CE3 use their own pseudowires and work. For CE1 ↔ CE3, PE2 holds both other pseudowires but may not relay between them: a frame arriving on a pseudowire never leaves on another (split horizon). That's why the mesh must be full.`,
      vplsid: `Yes. PE2's instance now uses ${xr ? "pw-id 501 on its neighbors" : "vpls-id 501"}, PE1 and PE3 still 500. Each PE advertises a PW FEC for its own ID, so PE2's pseudowires to both others never get a remote label — PE2 is cut off; the PE1–PE3 pseudowire is fine.`,
      mtu: `Yes. PE3 now signals MTU 1504 on both of its pseudowires, PE1 and PE2 signal 1500. The remote labels arrive, but the MTU check keeps both pseudowires down (${xr ? "show l2vpn bridge-domain detail shows MTU 1500 / 1504" : "Junos shows MM, mtu mismatch"}).`,
      vlan: "Yes. PE2's sub-interface toward CE2 now accepts VLAN 200, while CE2 sends and expects VLAN 100. Every pseudowire is up; but CE2's frames match no attachment circuit, and frames flooded toward CE2 leave PE2 tagged 200 and are dropped.",
      transport: xr ? "Yes. P1 no longer runs LDP toward P3, so P1 has no label for 3.3.3.3 (Unlabelled). PE1 still pushes PE3's PW label under the transport label; P1 removes the transport label and P3 receives 26031 — a label only PE3 understands — and drops it. Targeted LDP runs over plain IP, so every pseudowire stays up." : "Yes. P1 no longer runs LDP toward P3. With ordered label control there is no LSP to 3.3.3.3 from PE1 or PE2 (and none from PE3 back), and Junos keeps a VPLS pseudowire down without an LSP to its neighbor in inet.3. Targeted LDP still runs over IP.",
    };
    return { right: true, text: txt[t] };
  }
  const lt = lastTest(s);
  switch (cause) {
    case "shg":
      return { right: false, text: "Split horizon is working as designed: it never needs to relay. If a frame needs relaying, a pseudowire is missing from the mesh." };
    case "mac":
      return { right: false, text: "Unknown destinations are flooded, so an empty or stale MAC table costs efficiency, not reachability. Clear it and the next frame floods and relearns." };
    case "mesh":
      return { right: false, text: "Every PE lists both others as neighbors: the mesh is full." };
    case "vplsid":
      return { right: false, text: "All three PEs use VPLS ID 500." };
    case "mtu":
      return { right: false, text: "All three PEs signal MTU 1500." };
    case "vlan":
      return { right: false, text: "Every attachment circuit accepts VLAN 100, like its CE." };
    case "transport":
      return { right: false, text: "LDP runs on every core link: every PE has a complete LSP to the others." };
  }
  return { right: false, text: lt ? "That doesn't match the evidence." : "Run the user's test first." };
}
export function vsProofs(s: VsState): { label: string; ok: boolean; detail: string }[] {
  const t = s.ticket as VsTicketId | undefined;
  if (!t) return [];
  const fresh = s.tests.filter((x) => x.cfgSeq === s.cfgSeq);
  const p0 = vsTicket(t).repro[0] as { from: VsCe; dst: string };
  const proof = { label: `A fresh ping ${p0.dst} from ${p0.from} succeeds`, ok: fresh.some((x) => x.from === p0.from && x.dst === p0.dst && x.ok), detail: "run the test again after the fix" };
  const xr = s.os === "xr";
  const bdShow = xr ? "show l2vpn bridge-domain detail" : "show vpls connections";
  const allUp = s.view.pws.length === 6 && s.view.pws.every((p) => p.up);
  switch (t) {
    case "mesh":
      return [{ label: "All six pseudowire ends are up (a full mesh)", ok: allUp, detail: `${bdShow} on PE1 and PE3` }, proof];
    case "vplsid":
      return [{ label: "PE2 uses VPLS ID 500 and its pseudowires are up", ok: allUp, detail: `${bdShow} on PE2` }, proof];
    case "mtu":
      return [{ label: "PE3 signals the same MTU as the others and its pseudowires are up", ok: allUp, detail: `${bdShow} on PE3` }, proof];
    case "vlan":
      return [{ label: "PE2's attachment circuit accepts VLAN 100 again", ok: s.cfg.PE2.acs["ge-0/0/1.100"]?.vlan === 100, detail: xr ? "show l2vpn bridge-domain detail on PE2" : "show configuration interfaces ge-0/0/1 on PE2" }, proof];
    case "transport":
      return [{ label: "LDP runs on P1–P3", ok: s.view.ldp["P1-P3"], detail: xr ? "show mpls ldp neighbor brief on P1" : "show ldp session on P1" }, proof];
  }
}
export function vsLadder(s: VsState): { k: string; title: string; text: string }[] {
  const t = lastTest(s);
  const v = s.view;
  const acBad = VS_CES.filter((x) => x !== "CE4").filter((ce) => {
    const d = CES[ce];
    const k = acKey(d.ifn, d.vlan);
    return s.cfg[d.pe].acs[k]?.vlan !== d.vlan || !s.cfg[d.pe].bd?.acs.includes(k);
  }).map((ce) => `${CES[ce].pe}: no attachment circuit in the VPLS for ${ce}'s VLAN ${CES[ce].vlan}${s.cfg[CES[ce].pe].acs[acKey(CES[ce].ifn, 100)] ? ` (${acKey(CES[ce].ifn, 100)} accepts VLAN ${s.cfg[CES[ce].pe].acs[acKey(CES[ce].ifn, 100)].vlan ?? "none"})` : ""}`);
  const missing = VS_PES.flatMap((pe) => VS_PES.filter((p) => p !== pe && !(s.cfg[pe].bd?.nbrs ?? []).some((n) => n.ip === VS_LO[p])).map((p) => `${pe} doesn't list ${p} (${VS_LO[p]})`));
  const down = v.pws.filter((p) => !p.up).map((p) => `${p.pe} → ${p.ip}: ${pwWhyText(p, s.os)}`);
  const brokenLdp = VS_LINKS.filter((l) => !v.ldp[l.id]).map((l) => l.id);
  return [
    { k: "test", title: "What did the test show?", text: t ? `ping ${t.dst} from ${t.from}: ${t.ok ? `success (${t.reached})` : t.why}.` : "Run the user's test first." },
    { k: "ac", title: "Does every CE's VLAN land in the VPLS?", text: acBad.join(" · ") || "Yes." },
    { k: "mesh", title: "Is the mesh full — does every PE list every other PE?", text: missing.join(" · ") || "Yes: each PE lists both others." },
    { k: "pw", title: "Is every pseudowire up, with a remote label?", text: down.join(" · ") || "Yes, all six ends." },
    { k: "lsp", title: "Is the transport LSP complete?", text: brokenLdp.length ? `No LDP on ${brokenLdp.join(", ")}.` : "Yes: LDP on every core link." },
  ];
}
