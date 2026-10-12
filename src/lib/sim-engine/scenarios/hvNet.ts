import { spClone, type SpBase, type SpMoment, type SpRun } from "@/components/sp-lab/spKit";

/**
 * H-VPLS Lab network — the guided lesson's hierarchy: three MTU-s access bridges, each with one spoke pseudowire to its
 * PE-rs hub, and a full mesh of pseudowires between the three PE-rs. One P router carries the core LSPs.
 *
 *   CE1 ─┐                                   10.0.0.3
 *        MTU1 10.0.0.1 ══spoke══ PE1 1.1.1.1         MTU3 ─── CE4
 *   CE2 ─┘                        │                  ║
 *                                 P1 10.10.10.1 ── PE3 3.3.3.3
 *   CE3 ─── MTU2 10.0.0.2 ══spoke══ PE2 2.2.2.2 ─┘
 *            ┊ CE5 (cabled to MTU2, not yet in the service)
 *
 * Modeled (RFC 4762 §10, LDP-signaled H-VPLS):
 * - Every MTU-s and PE-rs runs a bridge (IOS XR bridge domain HVPLS-A; Junos routing instance of type vpls).
 * - Pseudowires are signaled over targeted LDP between loopbacks: up when both ends list each other with the same PW ID
 *   (VPLS ID) and the same MTU (Junos also wants an LSP to the neighbor in inet.3), and both ends must be up.
 * - Port roles. IOS XR: pseudowires inside the VFI form a split-horizon group (the core mesh); a pseudowire configured
 *   directly under the bridge domain is an access pseudowire, outside the group (a spoke). Junos: neighbors directly
 *   under `protocols vpls` belong to the default mesh group (the core); a named mesh group with its own vpls-id holds
 *   the spokes, and `local-switching` lets its members forward to each other. Frames are never forwarded between two
 *   members of the same split-horizon group — so core to core is blocked, spoke to core and core to spoke are not.
 * - The bridges learn source MACs per port, forward known unicast to one port, flood broadcast and unknown unicast.
 *   CEs keep ARP caches. MACs learned on a pseudowire that goes down are flushed.
 * - Transport: LDP on every link (IOS XR independent control, Junos ordered control). MTU-s ↔ PE-rs are directly
 *   connected (PHP: the spoke carries only the PW label); PE-rs ↔ PE-rs cross P1 (one transport label).
 */

export type HvR = "PE1" | "PE2" | "PE3" | "MTU1" | "MTU2" | "MTU3" | "P1";
export type HvCe = "CE1" | "CE2" | "CE3" | "CE4" | "CE5";
export const HV_ROUTERS: HvR[] = ["PE1", "PE2", "PE3", "MTU1", "MTU2", "MTU3", "P1"];
export const HV_PES: HvR[] = ["PE1", "PE2", "PE3"];
export const HV_MTUS: HvR[] = ["MTU1", "MTU2", "MTU3"];
export const HV_VPLS: HvR[] = [...HV_PES, ...HV_MTUS];
export const HV_LO: Record<HvR, string> = { PE1: "1.1.1.1", PE2: "2.2.2.2", PE3: "3.3.3.3", MTU1: "10.0.0.1", MTU2: "10.0.0.2", MTU3: "10.0.0.3", P1: "10.10.10.1" };
export const HUB: Record<string, HvR> = { MTU1: "PE1", MTU2: "PE2", MTU3: "PE3" };
export const ACCESS: Record<string, HvR> = { PE1: "MTU1", PE2: "MTU2", PE3: "MTU3" };
export type IfName = "ge-0/0/0" | "ge-0/0/1" | "ge-0/0/2";
export interface HvCeDef {
  dev: HvR;
  ifn: IfName;
  vlan: number;
  ip: string;
  mac: string;
}
export const CES: Record<HvCe, HvCeDef> = {
  CE1: { dev: "MTU1", ifn: "ge-0/0/1", vlan: 100, ip: "192.168.100.1", mac: "00:11:11:11:11:11" },
  CE2: { dev: "MTU1", ifn: "ge-0/0/2", vlan: 100, ip: "192.168.100.2", mac: "00:22:22:22:22:22" },
  CE3: { dev: "MTU2", ifn: "ge-0/0/1", vlan: 100, ip: "192.168.100.3", mac: "00:33:33:33:33:33" },
  CE4: { dev: "MTU3", ifn: "ge-0/0/1", vlan: 100, ip: "192.168.100.4", mac: "00:44:44:44:44:44" },
  CE5: { dev: "MTU2", ifn: "ge-0/0/2", vlan: 100, ip: "192.168.100.5", mac: "00:55:55:55:55:55" },
};
export const HV_CES = Object.keys(CES) as HvCe[];
export const BCAST = "ff:ff:ff:ff:ff:ff";
export interface HvLink {
  id: string;
  a: HvR;
  ai: IfName;
  aip: string;
  b: HvR;
  bi: IfName;
  bip: string;
}
export const HV_LINKS: HvLink[] = [
  { id: "PE1-P1", a: "PE1", ai: "ge-0/0/0", aip: "192.0.2.0", b: "P1", bi: "ge-0/0/0", bip: "192.0.2.1" },
  { id: "PE2-P1", a: "PE2", ai: "ge-0/0/0", aip: "192.0.2.2", b: "P1", bi: "ge-0/0/1", bip: "192.0.2.3" },
  { id: "PE3-P1", a: "PE3", ai: "ge-0/0/0", aip: "192.0.2.4", b: "P1", bi: "ge-0/0/2", bip: "192.0.2.5" },
  { id: "MTU1-PE1", a: "MTU1", ai: "ge-0/0/0", aip: "192.0.2.6", b: "PE1", bi: "ge-0/0/1", bip: "192.0.2.7" },
  { id: "MTU2-PE2", a: "MTU2", ai: "ge-0/0/0", aip: "192.0.2.8", b: "PE2", bi: "ge-0/0/1", bip: "192.0.2.9" },
  { id: "MTU3-PE3", a: "MTU3", ai: "ge-0/0/0", aip: "192.0.2.10", b: "PE3", bi: "ge-0/0/1", bip: "192.0.2.11" },
];
export const coreIfs = (r: HvR) => HV_LINKS.filter((l) => l.a === r || l.b === r).map((l) => (l.a === r ? { ifn: l.ai, ip: l.aip, peer: l.b, peerIp: l.bip, link: l } : { ifn: l.bi, ip: l.bip, peer: l.a, peerIp: l.aip, link: l }));
export const ceIfs = (r: HvR) => HV_CES.filter((c) => CES[c].dev === r).map((c) => ({ ce: c, ...CES[c] }));
export const devOfLo = (ip: string) => HV_ROUTERS.find((r) => HV_LO[r] === ip);
export const isVpls = (r: HvR) => HV_VPLS.includes(r);
export const isPe = (r: HvR) => HV_PES.includes(r);
export const isMtu = (r: HvR) => HV_MTUS.includes(r);
export function pathBetween(a: HvR, b: HvR): HvR[] {
  const prev: Partial<Record<HvR, HvR>> = { [a]: a };
  const q: HvR[] = [a];
  while (q.length) {
    const x = q.shift()!;
    if (x === b) break;
    for (const y of coreIfs(x).map((i) => i.peer)) if (!prev[y]) {
      prev[y] = x;
      q.push(y);
    }
  }
  const out: HvR[] = [b];
  while (out[0] !== a) out.unshift(prev[out[0]]!);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------------------------------------------
export interface HvAc {
  vlan?: number;
  vpls: boolean;
}
export interface HvNbr {
  ip: string;
  /** IOS XR: the pw-id on the neighbor statement. Junos takes the vpls-id of the neighbor's mesh group. */
  pwid?: number;
}
export interface HvBd {
  group: string;
  name: string;
  mtu: number;
  acs: string[];
  /** IOS XR: the VFI exists (its neighbors are `mesh`). */
  vfi: boolean;
  /** Junos: the default mesh group's vpls-id. */
  vplsId?: number;
  /** IOS XR: VFI neighbors. Junos: neighbors directly under protocols vpls (the default mesh group). The core. */
  mesh: HvNbr[];
  /** IOS XR: access pseudowires (neighbor … pw-id … directly under the bridge domain). Junos: the spoke mesh group. */
  spokes: HvNbr[];
  /** Junos: the named mesh group holding the spokes. */
  spokeGroup?: { name: string; vplsId?: number; local: boolean };
}
export interface HvCfg {
  acs: Record<string, HvAc>;
  bd?: HvBd;
  ldp: Partial<Record<IfName, boolean>>;
  /** Junos: protocols ldp interface lo0.0 (targeted sessions). */
  ldpLo: boolean;
}
export type HvConfig = Record<HvR, HvCfg>;
export type HvOs = "xr" | "junos";
export const acKey = (ifn: string, unit: number) => `${ifn}.${unit}`;
export const PW_ID = 100;
export function hvHealthy(os: HvOs): HvConfig {
  const c = {} as HvConfig;
  for (const r of HV_ROUTERS) {
    const ldp: Partial<Record<IfName, boolean>> = {};
    for (const x of coreIfs(r)) ldp[x.ifn] = true;
    c[r] = { acs: {}, ldp, ldpLo: isVpls(r) };
  }
  for (const m of HV_MTUS) {
    const acs = ceIfs(m).filter((x) => x.ce !== "CE5").map((x) => acKey(x.ifn, x.vlan));
    for (const k of acs) c[m].acs[k] = { vlan: 100, vpls: true };
    const up = { ip: HV_LO[HUB[m]], pwid: os === "xr" ? PW_ID : undefined };
    // IOS XR: an access pseudowire to the hub. Junos: the hub as an ordinary neighbor of the instance.
    c[m].bd = { group: "CUST-A", name: "HVPLS-A", mtu: 1500, acs, vfi: false, vplsId: os === "junos" ? PW_ID : undefined, mesh: os === "junos" ? [up] : [], spokes: os === "xr" ? [up] : [] };
  }
  for (const pe of HV_PES) {
    const mesh = HV_PES.filter((x) => x !== pe).map((x) => ({ ip: HV_LO[x], pwid: os === "xr" ? PW_ID : undefined }));
    const spokes = [{ ip: HV_LO[ACCESS[pe]], pwid: os === "xr" ? PW_ID : undefined }];
    c[pe].bd = { group: "CUST-A", name: "HVPLS-A", mtu: 1500, acs: [], vfi: true, vplsId: os === "junos" ? PW_ID : undefined, mesh, spokes, spokeGroup: os === "junos" ? { name: "SPOKES", vplsId: PW_ID, local: true } : undefined };
  }
  return c;
}
export type Role = "mesh" | "spoke";
export const pwidOf = (os: HvOs, bd: HvBd, role: Role, n: HvNbr) => (os === "xr" ? n.pwid : role === "mesh" ? bd.vplsId : bd.spokeGroup?.vplsId);
/** Every neighbor of a bridge with the role this device gives it. IOS XR ignores mesh neighbors without a VFI. */
export function nbrsOf(os: HvOs, bd: HvBd | undefined): { n: HvNbr; role: Role }[] {
  if (!bd) return [];
  return [...(os === "junos" || bd.vfi ? bd.mesh.map((n) => ({ n, role: "mesh" as Role })) : []), ...bd.spokes.map((n) => ({ n, role: "spoke" as Role }))];
}

// ---------------------------------------------------------------------------------------------------------------
// The control plane
// ---------------------------------------------------------------------------------------------------------------
export const IMPLICIT_NULL = 3;
const FEC_ORDER = HV_VPLS.map((r) => HV_LO[r]);
export function ldpLabel(os: HvOs, r: HvR, fec: string) {
  if (HV_LO[r] === fec) return IMPLICIT_NULL;
  return os === "xr" ? 24100 + 100 * HV_ROUTERS.indexOf(r) + FEC_ORDER.indexOf(fec) + 1 : 299776 + 10 * HV_ROUTERS.indexOf(r) + FEC_ORDER.indexOf(fec) + 1;
}
const IDX: Record<string, number> = { PE1: 1, PE2: 2, PE3: 3, MTU1: 1, MTU2: 2, MTU3: 3 };
/** The receive label `dev` allocates for its pseudowire with `peer` (IOS XR: the guided lesson's 24012 … mesh, 34011 / 44011 … spokes). */
export function pwLabel(os: HvOs, dev: HvR, peer: HvR) {
  if (os === "junos") return 299900 + 10 * HV_VPLS.indexOf(dev) + HV_VPLS.indexOf(peer);
  const i = IDX[dev];
  const j = IDX[peer];
  if (isPe(dev) && isPe(peer)) return 23000 + 1000 * i + 10 * i + j;
  if (isPe(dev)) return 34000 + 10 * i + j;
  return isPe(peer) ? 44000 + 10 * i + j : 45000 + 10 * i + j;
}
export type PwWhy = "nonbr" | "nosess" | "noremote" | "mtu" | "nolsp" | "remotedown";
export interface HvPw {
  dev: HvR;
  peer?: HvR;
  ip: string;
  role: Role;
  pwid?: number;
  up: boolean;
  why?: PwWhy;
  local?: number;
  remote?: { label: number; mtu: number };
  mtu: number;
}
export interface HvView {
  ldp: Record<string, boolean>;
  lsp: Record<HvR, Partial<Record<string, { out?: number; nh?: HvR }>>>;
  tldp: Record<string, boolean>;
  pws: HvPw[];
}
export const pairKey = (a: HvR, b: HvR) => [a, b].sort().join("~");
export function hvTransport(c: HvConfig, os: HvOs): Pick<HvView, "ldp" | "lsp"> {
  const ldp: Record<string, boolean> = Object.fromEntries(HV_LINKS.map((l) => [l.id, !!c[l.a].ldp[l.ai] && !!c[l.b].ldp[l.bi]]));
  const linkOf = (x: HvR, y: HvR) => HV_LINKS.find((l) => (l.a === x && l.b === y) || (l.b === x && l.a === y))!;
  const lsp = Object.fromEntries(HV_ROUTERS.map((r) => [r, {}])) as HvView["lsp"];
  for (const egress of HV_VPLS) {
    const fec = HV_LO[egress];
    for (const r of HV_ROUTERS) {
      if (r === egress) continue;
      const path = pathBetween(r, egress);
      let chain = true;
      for (let i = 0; i < path.length - 1; i++) if (!ldp[linkOf(path[i], path[i + 1]).id]) chain = false;
      const nh = path[1];
      const has = ldp[linkOf(r, nh).id] && (os === "xr" || chain);
      lsp[r][fec] = has ? { out: ldpLabel(os, nh, fec), nh } : { nh };
    }
  }
  return { ldp, lsp };
}
export function hvCompute(c: HvConfig, os: HvOs): HvView {
  const { ldp, lsp } = hvTransport(c, os);
  const lists = (r: HvR) => nbrsOf(os, c[r].bd).map((x) => x.n.ip);
  const loOk = (r: HvR) => os === "xr" || c[r].ldpLo;
  const tldp: Record<string, boolean> = {};
  for (const a of HV_VPLS)
    for (const ip of lists(a)) {
      const b = devOfLo(ip);
      if (!b || !isVpls(b) || b === a) continue;
      tldp[pairKey(a, b)] = lists(b).includes(HV_LO[a]) && loOk(a) && loOk(b);
    }
  const pws: HvPw[] = [];
  for (const dev of HV_VPLS) {
    const bd = c[dev].bd;
    for (const { n, role } of nbrsOf(os, bd)) {
      const peer = devOfLo(n.ip);
      const pwid = pwidOf(os, bd!, role, n);
      const pw: HvPw = { dev, peer, ip: n.ip, role, pwid, up: false, mtu: bd!.mtu };
      pws.push(pw);
      if (!peer || !isVpls(peer) || peer === dev) {
        pw.why = "nonbr";
        continue;
      }
      pw.local = pwLabel(os, dev, peer);
      if (!tldp[pairKey(dev, peer)]) {
        pw.why = "nosess";
        continue;
      }
      const rbd = c[peer].bd!;
      const rn = nbrsOf(os, rbd).find((x) => x.n.ip === HV_LO[dev]);
      if (!rn || pwidOf(os, rbd, rn.role, rn.n) !== pwid || pwid === undefined) {
        pw.why = "noremote";
        continue;
      }
      pw.remote = { label: pwLabel(os, peer, dev), mtu: rbd.mtu };
      if (rbd.mtu !== bd!.mtu) {
        pw.why = "mtu";
        continue;
      }
      if (os === "junos" && lsp[dev][n.ip]?.out === undefined) {
        pw.why = "nolsp";
        continue;
      }
      pw.up = true;
    }
  }
  const upNow = new Set(pws.filter((p) => p.up).map((p) => `${p.dev}>${p.peer}`));
  for (const p of pws) if (p.up && !upNow.has(`${p.peer}>${p.dev}`)) Object.assign(p, { up: false, why: "remotedown" as PwWhy });
  return { ldp, lsp, tldp, pws };
}
export function pwWhyText(p: HvPw, os: HvOs): string {
  switch (p.why) {
    case "nonbr":
      return `nobody answers targeted hellos at ${p.ip}: no session, no label`;
    case "nosess":
      return `no targeted LDP session with ${p.ip}: ${p.peer ?? "it"} doesn't list ${HV_LO[p.dev]} as a neighbor`;
    case "noremote":
      return `${p.peer} advertises no ${os === "xr" ? "PW ID" : "VPLS ID"} ${p.pwid ?? "?"} toward ${HV_LO[p.dev]}: no remote label`;
    case "mtu":
      return `MTU mismatch: local ${p.mtu}, remote ${p.remote?.mtu}`;
    case "nolsp":
      return os === "xr" ? "no LSP to the neighbor" : `no LSP to ${p.ip} in inet.3`;
    case "remotedown":
      return `${p.peer} keeps its end of this pseudowire down`;
  }
  return "down";
}
/** The split-horizon group a pseudowire port belongs to on its device (undefined: none, forwards freely). */
export function shGroup(os: HvOs, bd: HvBd, role: Role): string | undefined {
  if (role === "mesh") return os === "xr" ? "VFI" : "__ves__";
  return os === "junos" && !bd.spokeGroup?.local ? bd.spokeGroup?.name ?? "spokes" : undefined;
}

// ---------------------------------------------------------------------------------------------------------------
// The bridges (data plane)
// ---------------------------------------------------------------------------------------------------------------
/** A MAC table entry: learned on an attachment circuit ("ge-0/0/1.100") or a pseudowire ("pw:1.1.1.1"). */
export interface HvMac {
  mac: string;
  port: string;
  t: number;
}
export type HvFdb = Record<HvR, HvMac[]>;
export interface HvHop {
  from: string;
  to: string;
  labels: number[];
  note: string;
}
interface Frame {
  src: HvCe;
  dstMac: string;
  what: string;
}
interface Delivery {
  hops: HvHop[];
  reached: HvCe[];
  flooded: boolean;
  drops: string[];
}
export const pwPort = (ip: string) => `pw:${ip}`;
const acCe = (r: HvR, k: string) => ceIfs(r).find((x) => k.startsWith(`${x.ifn}.`));
function bridgeFrame(c: HvConfig, v: HvView, os: HvOs, fdb: HvFdb, f: Frame, clock: number): Delivery {
  const out: Delivery = { hops: [], reached: [], flooded: false, drops: [] };
  const ce = CES[f.src];
  const first = ce.dev;
  const k0 = acKey(ce.ifn, ce.vlan);
  out.hops.push({ from: f.src, to: first, labels: [], note: `${f.src} sends ${f.what} (to ${f.dstMac === BCAST ? "broadcast" : f.dstMac}), VLAN ${ce.vlan}` });
  const ac0 = c[first].acs[k0];
  if (!ac0 || ac0.vlan !== ce.vlan || !c[first].bd?.acs.includes(k0)) {
    out.drops.push(`${first} has no attachment circuit for VLAN ${ce.vlan} on ${ce.ifn} in the bridge — the frame is dropped`);
    return out;
  }
  const seen = new Set<HvR>();
  const ports = (r: HvR) => {
    const bd = c[r].bd!;
    const acs = bd.acs.filter((x) => c[r].acs[x]).map((x) => ({ id: x, pw: undefined as HvPw | undefined, group: undefined as string | undefined }));
    const pws = v.pws.filter((p) => p.dev === r && p.up).map((p) => ({ id: pwPort(p.ip), pw: p as HvPw | undefined, group: shGroup(os, bd, p.role) }));
    return [...acs, ...pws];
  };
  const toAc = (r: HvR, port: string) => {
    const tgt = acCe(r, port);
    const a = c[r].acs[port];
    if (!tgt) return;
    out.hops.push({ from: r, to: tgt.ce, labels: [], note: `${r}: out of ${port} (VLAN ${a?.vlan})` });
    if (a?.vlan !== tgt.vlan) return void out.drops.push(`${tgt.ce} receives the frame tagged VLAN ${a?.vlan}, but its interface uses VLAN ${tgt.vlan} — dropped`);
    if (f.dstMac === BCAST || f.dstMac === tgt.mac) out.reached.push(tgt.ce);
  };
  const overPw = (from: HvR, pw: HvPw) => {
    const peer = pw.peer!;
    const path = pathBetween(from, peer);
    const fec = HV_LO[peer];
    let stack = [pw.remote!.label];
    const t0 = v.lsp[from][fec];
    const pushT = t0?.out !== undefined && t0.out !== IMPLICIT_NULL;
    if (pushT) stack = [t0!.out!, ...stack];
    out.hops.push({ from, to: path[1], labels: stack, note: `${from}: push PW label ${pw.remote!.label} (chosen by ${peer})${pushT ? ` and transport label ${t0!.out}` : t0?.out === IMPLICIT_NULL ? ` — ${peer} is the next hop, so no transport label (PHP)` : " — no transport label (Unlabelled)"}` });
    for (let i = 1; i < path.length - 1; i++) {
      const rr = path[i];
      const nx = path[i + 1];
      const top = stack[0];
      if (top !== ldpLabel(os, rr, fec)) {
        out.drops.push(`${rr} receives label ${top} — the PW label ${peer} allocated, which ${rr} never allocated — and drops the frame`);
        return;
      }
      const t = v.lsp[rr][fec];
      stack = t?.out === undefined || t.out === IMPLICIT_NULL ? stack.slice(1) : [t.out, ...stack.slice(1)];
      out.hops.push({ from: rr, to: nx, labels: stack, note: t?.out === undefined ? `${rr}: no label from ${nx} for ${fec} (Unlabelled) → removes ${top}; the PW label is on top` : t.out === IMPLICIT_NULL ? `${rr}: pops ${top} (PHP) — the PW label is left` : `${rr}: swaps ${top} → ${t.out}` });
    }
    const back = v.pws.find((p) => p.dev === peer && p.peer === from && p.up);
    if (!back) return void out.drops.push(`${peer} has no working pseudowire back to ${from} for label ${pw.remote!.label} — dropped`);
    bridge(peer, pwPort(HV_LO[from]));
  };
  const bridge = (r: HvR, inPort: string) => {
    if (seen.has(r)) {
      out.drops.push(`${r} receives a second copy of the same frame — a forwarding loop (in a real network, a broadcast storm)`);
      return;
    }
    seen.add(r);
    const all = ports(r);
    const ingress = all.find((p) => p.id === inPort);
    fdb[r] = [...fdb[r].filter((m) => m.mac !== ce.mac), { mac: ce.mac, port: inPort, t: clock }];
    const allowed = (p: (typeof all)[number]) => p.id !== inPort && !(ingress?.group && p.group === ingress.group);
    // An MTU-s has one pseudowire, its spoke (on Junos it sits in the default mesh group, which changes nothing there).
    const name = (p: (typeof all)[number]) => (p.pw ? `${p.pw.role === "mesh" && !isMtu(r) ? "mesh" : "spoke"} PW ${p.pw.peer ?? p.pw.ip}` : p.id);
    const hit = f.dstMac === BCAST ? undefined : fdb[r].find((m) => m.mac === f.dstMac);
    const send = (p: (typeof all)[number]) => (p.pw ? overPw(r, p.pw) : toAc(r, p.id));
    if (hit) {
      const p = all.find((x) => x.id === hit.port);
      if (!p) return void out.drops.push(`${r}: ${f.dstMac} is learned on ${hit.port}, which is no longer a working port`);
      if (p.id === inPort) return void out.hops.push({ from: r, to: r, labels: [], note: `${r}: ${f.dstMac} is behind the port the frame came from — filtered` });
      if (!allowed(p)) {
        out.hops.push({ from: r, to: r, labels: [], note: `${r}: ${f.dstMac} is behind ${name(p)} — but the frame came in on ${ingress ? name(ingress) : inPort}, in the same split-horizon group (${ingress?.group}): not forwarded` });
        return void out.drops.push(`${r} would have to forward the frame from ${ingress ? name(ingress) : inPort} to ${name(p)}, both in its split-horizon group ${ingress?.group} — forbidden`);
      }
      out.hops.push({ from: r, to: r, labels: [], note: `${r}: ${f.dstMac} is known, behind ${name(p)} → that port only` });
      return send(p);
    }
    out.flooded = true;
    const cand = all.filter((p) => p.id !== inPort);
    const egress = cand.filter(allowed);
    const blocked = cand.filter((p) => !allowed(p));
    out.hops.push({ from: r, to: r, labels: [], note: `${r}: ${f.dstMac === BCAST ? "broadcast" : `${f.dstMac} unknown`} → ${egress.length ? `flood to ${egress.map(name).join(", ")}` : "no port it may flood to"}${blocked.length ? `; not to ${blocked.map(name).join(", ")} (same split-horizon group as the ingress)` : ""}` });
    if (!egress.length && blocked.length) out.drops.push(`${r} received the frame on ${ingress ? name(ingress) : inPort}, in its split-horizon group ${ingress?.group}, so it may not flood it to ${blocked.map(name).join(" or ")}`);
    for (const p of egress) send(p);
  };
  bridge(first, k0);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------------------------------------------
export interface HvSnap {
  view: HvView;
  fdb: HvFdb;
}
export interface HvTest {
  id: number;
  from: HvCe;
  dst: string;
  ok: boolean;
  reached?: HvCe;
  why?: string;
  flooded: boolean;
  path: string[];
  /** Devices whose MAC tables learned something in this test. */
  touched: HvR[];
  cfgSeq: number;
  t: number;
}
export interface HvSys {
  t: number;
  dev: HvR;
  kind: "commit" | "ldp-up" | "ldp-down" | "pw-up" | "pw-down" | "clear";
  peer?: string;
  pwid?: number;
}
export interface HvState extends SpBase<HvSnap> {
  os: HvOs;
  cfg: HvConfig;
  hist: Record<HvR, HvCfg[]>;
  view: HvView;
  fdb: HvFdb;
  arp: Record<HvCe, Record<string, string>>;
  sys: HvSys[];
  tests: HvTest[];
  wiped?: boolean;
  cleared?: number;
}
export type HvAction =
  | { type: "cfg"; dev: HvR; cfg: HvCfg; text: string }
  | { type: "set"; changes: { dev: HvR; f: (c: HvCfg) => void }[]; text: string }
  | { type: "test"; from: HvCe; dst: string }
  | { type: "clear"; dev?: HvR }
  | { type: "ticket"; id: HvTicketId }
  | { type: "os"; os: HvOs }
  | { type: "wipe-mtu3" };

const cl = (o: HvState): HvState => ({ ...spClone(o), runs: o.runs, last: o.last });
const emptyFdb = (): HvFdb => Object.fromEntries(HV_ROUTERS.map((r) => [r, []])) as unknown as HvFdb;
export function createHvNet(seq = 0, os: HvOs = "xr"): HvState {
  const cfg = hvHealthy(os);
  const view = hvCompute(cfg, os);
  const s: HvState = { seq, os, cfgSeq: 0, clock: 3600, runs: [], log: [{ seq, t: 3600, text: "IS-IS and LDP are up; PE1, PE2 and PE3 are full-meshed, and each MTU-s has its spoke pseudowire to its hub (PW ID 100). The MAC tables are empty.", tone: "info" }], cfg, hist: Object.fromEntries(HV_ROUTERS.map((r) => [r, []])) as unknown as Record<HvR, HvCfg[]>, view, fdb: emptyFdb(), arp: { CE1: {}, CE2: {}, CE3: {}, CE4: {}, CE5: {} }, sys: [], tests: [] };
  for (const l of HV_LINKS) s.sys.push({ t: 20, dev: l.a, kind: "ldp-up", peer: HV_LO[l.b] }, { t: 20, dev: l.b, kind: "ldp-up", peer: HV_LO[l.a] });
  for (const p of view.pws) {
    s.sys.push({ t: 30, dev: p.dev, kind: "ldp-up", peer: p.ip });
    if (p.up) s.sys.push({ t: 32, dev: p.dev, kind: "pw-up", peer: p.ip, pwid: p.pwid });
  }
  return s;
}
/** Why a frame from `a` never reached `b`: the first broken pseudowire on the hierarchy's path between them. */
function chainWhy(s: HvState, from: HvCe, to: HvCe): string | undefined {
  const a = CES[from].dev;
  const b = CES[to].dev;
  const k = acKey(CES[to].ifn, CES[to].vlan);
  if (!s.cfg[b].bd?.acs.includes(k) || !s.cfg[b].acs[k]) return `${to}'s port on ${b} isn't part of the bridge`;
  if (a === b) return undefined;
  const chain = [a, HUB[a], HUB[b], b].filter((x, i, arr) => x && arr.indexOf(x) === i);
  for (let i = 0; i < chain.length - 1; i++) {
    const pw = s.view.pws.find((p) => p.dev === chain[i] && p.peer === chain[i + 1]);
    if (!pw) return `${chain[i]} has no pseudowire to ${chain[i + 1]}`;
    if (!pw.up) return `${chain[i]}'s pseudowire to ${chain[i + 1]} is down (${pwWhyText(pw, s.os)})`;
  }
  return undefined;
}
export function hvTest(s0: HvState, from: HvCe, dst: string): HvState {
  const s = cl(s0);
  s.clock += 2;
  const snap = () => ({ view: spClone(s.view), fdb: spClone(s.fdb) });
  const before = spClone(s.fdb);
  const moments: SpMoment<HvSnap>[] = [];
  const target = HV_CES.find((x) => CES[x].ip === dst);
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
  const send = (src: HvCe, dstMac: string, what: string, color: string, want: HvCe) => {
    const d = bridgeFrame(s.cfg, s.view, s.os, s.fdb, { src, dstMac, what }, s.clock);
    leg(d, color);
    if (!d.reached.includes(want)) {
      const relevant = d.drops.find((x) => /split-horizon|label|VLAN|loop|attachment circuit/.test(x));
      const chain = chainWhy(s, src, want);
      why ??= relevant ? `${what} never reaches ${want}: ${relevant}` : chain ? `${what} never reaches ${want}: ${chain}` : `${what} never reaches ${want}${d.drops.length ? `: ${d.drops[d.drops.length - 1]}` : ""}`;
    }
    return d.reached.includes(want);
  };
  let ok = false;
  if (!target || target === from) why = `nobody on the service has ${dst}`;
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
  if (ok) moments.push({ tokens: [], lines: [{ text: `${from} ↔ ${dst} (${target}): success${flooded ? " — part of it flooded" : ", every frame unicast"}.`, tone: "ok" }], snap: snap() });
  else moments.push({ tokens: [], lines: [{ text: why ?? "failed", tone: "bad" }], snap: snap() });
  const touched = HV_VPLS.filter((r) => JSON.stringify(s.fdb[r].map((m) => [m.mac, m.port])) !== JSON.stringify(before[r].map((m) => [m.mac, m.port])));
  const t: HvTest = { id: s.tests.length + 1, from, dst, ok, reached: ok ? target : undefined, why, flooded, path, touched, cfgSeq: s.cfgSeq, t: s.clock };
  s.tests = [...s.tests, t].slice(-40);
  const run: SpRun<HvSnap> = { id: s.runs.length + 1 + s.seq * 1000, cmd: `ping ${dst} from ${from}`, kind: "test", moments, ok };
  s.runs = [...s.runs, run];
  s.last = run;
  s.log = [...s.log, { seq: s.seq, t: s.clock, text: `ping ${dst} from ${from}: ${ok ? `success (${target})${flooded ? ", flooded" : ""}` : why}`, tone: ok ? "ok" : "warn" }];
  return s;
}

const pwKey = (p: HvPw) => `${p.dev}|${p.ip}|${p.role}|${p.pwid}`;
function converge(prev: HvState, s: HvState, why: string, show = true): HvState {
  const view = hvCompute(s.cfg, s.os);
  s.view = view;
  for (const r of HV_VPLS) {
    const ups = new Set(view.pws.filter((p) => p.dev === r && p.up).map((p) => pwPort(p.ip)));
    const acs = new Set(s.cfg[r].bd?.acs ?? []);
    s.fdb[r] = s.fdb[r].filter((m) => (m.port.startsWith("pw:") ? ups.has(m.port) : acs.has(m.port) && !!s.cfg[r].acs[m.port]));
  }
  const snap = { view: spClone(view), fdb: spClone(s.fdb) };
  const moments: SpMoment<HvSnap>[] = [];
  for (const l of HV_LINKS) {
    if (prev.view.ldp[l.id] !== view.ldp[l.id]) {
      moments.push({ tokens: view.ldp[l.id] ? [{ from: l.a, to: l.b, label: "LDP", color: "cyan" }] : [], lines: [{ text: `LDP ${l.a}–${l.b} ${view.ldp[l.id] ? "Operational — transport labels are exchanged again" : "goes down — the labels learned over it are withdrawn"}.`, tone: view.ldp[l.id] ? "ok" : "bad" }], snap });
      s.sys.push({ t: s.clock, dev: l.a, kind: view.ldp[l.id] ? "ldp-up" : "ldp-down", peer: HV_LO[l.b] }, { t: s.clock, dev: l.b, kind: view.ldp[l.id] ? "ldp-up" : "ldp-down", peer: HV_LO[l.a] });
    }
  }
  for (const k of new Set([...Object.keys(view.tldp), ...Object.keys(prev.view.tldp)])) {
    const up = !!view.tldp[k];
    if (!!prev.view.tldp[k] !== up) {
      const [a, b] = k.split("~") as HvR[];
      moments.push({ tokens: up ? [{ from: a, to: b, label: "targeted LDP", color: "amber" }] : [], lines: [{ text: up ? `${a} ↔ ${b}: targeted LDP session Operational.` : `${a} ↔ ${b}: the targeted LDP session goes down.`, tone: up ? "ok" : "bad" }], snap });
      s.sys.push({ t: s.clock, dev: a, kind: up ? "ldp-up" : "ldp-down", peer: HV_LO[b] }, { t: s.clock, dev: b, kind: up ? "ldp-up" : "ldp-down", peer: HV_LO[a] });
    }
  }
  const lines: { text: string; tone: "ok" | "bad" | "warn" }[] = [];
  for (const p of view.pws) {
    const was = prev.view.pws.find((x) => pwKey(x) === pwKey(p));
    if (p.up && !was?.up) {
      lines.push({ text: `${p.dev}: ${p.role} pseudowire to ${p.ip} (PW ID ${p.pwid}) is up — pushes ${p.remote!.label}, receives on ${p.local}.`, tone: "ok" });
      s.sys.push({ t: s.clock, dev: p.dev, kind: "pw-up", peer: p.ip, pwid: p.pwid });
    } else if (!p.up && (was?.up || !was)) {
      lines.push({ text: `${p.dev}: pseudowire to ${p.ip} is down — ${pwWhyText(p, s.os)}.`, tone: "bad" });
      if (was?.up) s.sys.push({ t: s.clock, dev: p.dev, kind: "pw-down", peer: p.ip, pwid: p.pwid });
    }
  }
  for (const p of prev.view.pws) if (p.up && !view.pws.some((x) => x.dev === p.dev && x.ip === p.ip && x.up)) {
    if (!view.pws.some((x) => pwKey(x) === pwKey(p))) {
      lines.push({ text: `${p.dev}: pseudowire to ${p.ip} was removed.`, tone: "warn" });
      s.sys.push({ t: s.clock, dev: p.dev, kind: "pw-down", peer: p.ip, pwid: p.pwid });
    }
  }
  if (lines.length) moments.push({ tokens: [], lines: lines.slice(0, 10), snap });
  if (show && moments.length) {
    const run: SpRun<HvSnap> = { id: s.runs.length + 1 + s.seq * 1000, cmd: why, kind: "converge", moments };
    s.runs = [...s.runs, run];
    s.last = run;
  }
  return s;
}

// ---------------------------------------------------------------------------------------------------------------
// Tickets
// ---------------------------------------------------------------------------------------------------------------
export type HvTicketId = "spoke" | "pwid" | "mesh" | "vlan" | "transport";
export interface HvTicketDef {
  id: HvTicketId;
  title: string;
  report: string;
  reproLabel: string;
  repro: HvAction[];
  fault: (c: HvConfig, os: HvOs) => void;
}
const ping = (from: HvCe, dst: string): HvAction => ({ type: "test", from, dst });
export const HV_TICKETS: HvTicketDef[] = [
  {
    id: "spoke",
    title: "MTU1's sites are on an island",
    report: "“After PE1's VPLS configuration was tidied up, CE1 and CE2 still reach each other, but neither reaches CE3 or CE4. Every pseudowire on PE1 shows up.”",
    reproLabel: "ping 192.168.100.3 from CE1",
    repro: [ping("CE1", "192.168.100.3")],
    fault: (c, os) => {
      const bd = c.PE1.bd!;
      const n = bd.spokes.find((x) => x.ip === HV_LO.MTU1)!;
      bd.spokes = bd.spokes.filter((x) => x !== n);
      bd.mesh.push(os === "xr" ? n : { ip: n.ip });
    },
  },
  {
    id: "pwid",
    title: "Site 3 after a software refresh",
    report: "“MTU2 came back from a software refresh with a regenerated configuration. CE3 reaches nobody; the other sites are fine.”",
    reproLabel: "ping 192.168.100.1 from CE3",
    repro: [ping("CE3", "192.168.100.1")],
    fault: (c, os) => {
      if (os === "xr") c.MTU2.bd!.spokes[0].pwid = 101;
      else c.MTU2.bd!.vplsId = 101;
    },
  },
  {
    id: "mesh",
    title: "Two sites can't see each other",
    report: "“CE3 and CE4 can't reach each other. Both reach CE1 and CE2 without trouble.”",
    reproLabel: "ping 192.168.100.4 from CE3",
    repro: [ping("CE3", "192.168.100.4")],
    fault: (c) => {
      c.PE3.bd!.mesh = c.PE3.bd!.mesh.filter((x) => x.ip !== HV_LO.PE2);
    },
  },
  {
    id: "vlan",
    title: "CE2 is alone — even next door",
    report: "“CE2 was moved to a new port on MTU1 and now reaches nobody — not even CE1 on the same MTU.”",
    reproLabel: "ping 192.168.100.1 from CE2",
    repro: [ping("CE2", "192.168.100.1")],
    fault: (c) => {
      c.MTU1.acs["ge-0/0/2.100"].vlan = 200;
    },
  },
  {
    id: "transport",
    title: "After PE3's maintenance",
    report: "“Since PE3's maintenance window, CE4 reaches nobody. CE1, CE2 and CE3 are fine, and MTU3's spoke to PE3 is up.”",
    reproLabel: "ping 192.168.100.4 from CE1",
    repro: [ping("CE1", "192.168.100.4")],
    fault: (c) => {
      c.PE3.ldp["ge-0/0/0"] = false;
    },
  },
];
export const hvTicket = (id: string) => HV_TICKETS.find((t) => t.id === id)!;
export function hvTicketState(id: HvTicketId, seq = 0, os: HvOs = "xr"): HvState {
  const s = createHvNet(seq, os);
  const nx = cl(s);
  hvTicket(id).fault(nx.cfg, os);
  const out = converge(s, nx, "", false);
  out.ticket = id;
  out.runs = [];
  out.last = undefined;
  out.log = [...out.log, { seq, t: out.clock, text: `Ticket opened: ${hvTicket(id).title}.`, tone: "warn" }];
  return out;
}

export function hvApply(s0: HvState, a: HvAction): HvState {
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
      return hvTest(s0, a.from, a.dst);
    case "clear": {
      const s = cl(s0);
      s.clock += 1;
      for (const r of a.dev ? [a.dev] : HV_VPLS) s.fdb[r] = [];
      for (const ce of HV_CES) s.arp[ce] = {};
      s.cleared = s.clock;
      s.sys.push({ t: s.clock, dev: a.dev ?? "PE1", kind: "clear" });
      s.log = [...s.log, { seq: s.seq, t: s.clock, text: `${a.dev ? `${a.dev}'s MAC table` : "Every MAC table"} cleared (and the CEs' ARP caches aged out).`, tone: "info" }];
      return s;
    }
    case "ticket":
      return hvTicketState(a.id, s0.seq + 1, s0.os);
    case "os":
      return createHvNet(s0.seq + 1, a.os);
    case "wipe-mtu3": {
      const s = cl(s0);
      s.cfg.MTU3.bd = undefined;
      s.cfg.MTU3.acs = {};
      s.wiped = true;
      s.cfgSeq += 1;
      s.clock += 1;
      s.log = [...s.log, { seq: s.seq, t: s.clock, text: "MTU3's service was deleted: its bridge domain / instance, its spoke pseudowire and its sub-interface are gone. Nothing else changed.", tone: "warn" }];
      return converge(s0, s, "MTU3 loses its H-VPLS configuration");
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Diagnosis, proofs, ladder
// ---------------------------------------------------------------------------------------------------------------
export const HV_CAUSES: { id: string; label: string }[] = [
  { id: "spoke", label: "A spoke pseudowire is configured as a core mesh member on its hub" },
  { id: "pwid", label: "A spoke's PW ID / VPLS ID doesn't match its hub's" },
  { id: "mesh", label: "A PE-rs is missing a core mesh neighbor" },
  { id: "vlan", label: "An attachment circuit is on the wrong VLAN" },
  { id: "transport", label: "A transport LSP between the PE-rs is broken (LDP)" },
  { id: "split", label: "Split horizon should be disabled in the core" },
  { id: "mac", label: "A MAC table is full or stale" },
];
const lastTest = (s: HvState) => s.tests[s.tests.length - 1];
export function hvCauseFeedback(s: HvState, cause: string): { right: boolean; text: string } {
  const t = s.ticket as HvTicketId | undefined;
  const xr = s.os === "xr";
  if (cause === t) {
    const txt: Record<HvTicketId, string> = {
      spoke: xr
        ? "Yes. PE1 now has MTU1's pseudowire inside its VFI — the split-horizon group of the core mesh. The pseudowire is up, but frames from MTU1 may no longer be flooded to PE2 and PE3 (VFI to VFI), and frames from the core may not go down to MTU1. MTU1 still switches CE1 ↔ CE2 locally, which hid the problem."
        : "Yes. PE1 now lists MTU1 directly under protocols vpls — the default mesh group, together with PE2 and PE3. The pseudowire is up, but members of one mesh group never forward to each other, so MTU1's frames stay at PE1. MTU1 still switches CE1 ↔ CE2 locally, which hid the problem.",
      pwid: xr ? "Yes. MTU2's regenerated access pseudowire uses pw-id 101; PE2 expects 100. No matching label mapping, so the spoke stays down and CE3 has no way into the service." : "Yes. MTU2's regenerated instance uses vpls-id 101; PE2's SPOKES mesh group uses 100. No matching label mapping, so the spoke stays down and CE3 has no way into the service.",
      mesh: "Yes. PE3 no longer lists PE2 in the core mesh, so the PE2–PE3 pseudowire is down. PE1 can't relay between them: it receives the frame on a mesh pseudowire and may not send it out another (split horizon). The core mesh must be full.",
      vlan: "Yes. MTU1's sub-interface toward CE2 now accepts VLAN 200, while CE2 sends VLAN 100. CE2's frames match no attachment circuit, and MTU1's floods toward CE2 leave tagged 200 and are dropped. Every pseudowire is fine — this is the access edge.",
      transport: xr ? "Yes. PE3 no longer runs LDP toward P1, so PE3 has no transport label to the other PE-rs (Unlabelled) and P1 has none from PE3. PE3's frames toward PE1 and PE2 arrive at P1 with only the PW label on top, which P1 never allocated. The targeted sessions run over plain IP and stay up." : "Yes. PE3 no longer runs LDP toward P1; with ordered control nobody has an LSP to or from 3.3.3.3, and Junos keeps the mesh pseudowires to PE3 down (VC-Dn). MTU3's spoke is directly connected and unaffected.",
    };
    return { right: true, text: txt[t] };
  }
  const lt = lastTest(s);
  switch (cause) {
    case "split":
      return { right: false, text: "Split horizon between core pseudowires is what keeps the mesh loop-free. It is never the thing to remove — the fix is to give each port its right role, or to complete the mesh." };
    case "mac":
      return { right: false, text: "The MAC tables only hold what traffic taught them; clearing them costs a round of flooding, never reachability." };
    case "spoke":
      return { right: false, text: "Every spoke is configured as a spoke on its hub (an access pseudowire / the SPOKES mesh group)." };
    case "pwid":
      return { right: false, text: "Every spoke uses PW ID 100 at both ends." };
    case "mesh":
      return { right: false, text: "Each PE-rs lists both other PE-rs in its core mesh." };
    case "vlan":
      return { right: false, text: "Every attachment circuit accepts VLAN 100, like its CE." };
    case "transport":
      return { right: false, text: "LDP runs on every link: every PE-rs has an LSP to every other." };
  }
  return { right: false, text: lt ? "That doesn't match the evidence." : "Run the user's test first." };
}
const allUp = (s: HvState) => s.view.pws.length === 12 && s.view.pws.every((p) => p.up);
export function hvProofs(s: HvState): { label: string; ok: boolean; detail: string }[] {
  const t = s.ticket as HvTicketId | undefined;
  if (!t) return [];
  const fresh = s.tests.filter((x) => x.cfgSeq === s.cfgSeq);
  const p0 = hvTicket(t).repro[0] as { from: HvCe; dst: string };
  const proof = { label: `A fresh ping ${p0.dst} from ${p0.from} succeeds`, ok: fresh.some((x) => x.from === p0.from && x.dst === p0.dst && x.ok), detail: "run the test again after the fix" };
  const xr = s.os === "xr";
  const bd = xr ? "show l2vpn bridge-domain" : "show vpls connections";
  switch (t) {
    case "spoke":
      return [{ label: "PE1 has MTU1's pseudowire as a spoke again (outside the core's split-horizon group)", ok: s.cfg.PE1.bd!.spokes.some((x) => x.ip === HV_LO.MTU1) && !s.cfg.PE1.bd!.mesh.some((x) => x.ip === HV_LO.MTU1) && allUp(s), detail: `${bd} on PE1` }, proof];
    case "pwid":
      return [{ label: "MTU2's spoke is up", ok: s.view.pws.some((p) => p.dev === "MTU2" && p.up) && allUp(s), detail: `${bd} on MTU2` }, proof];
    case "mesh":
      return [{ label: "The core mesh is full: all twelve pseudowire ends are up", ok: allUp(s), detail: `${bd} on PE3` }, proof];
    case "vlan":
      return [{ label: "MTU1's attachment circuit toward CE2 accepts VLAN 100", ok: s.cfg.MTU1.acs["ge-0/0/2.100"]?.vlan === 100, detail: xr ? "show l2vpn bridge-domain detail on MTU1" : "show configuration interfaces ge-0/0/2 on MTU1" }, proof];
    case "transport":
      return [{ label: "LDP runs on PE3–P1", ok: s.view.ldp["PE3-P1"], detail: xr ? "show mpls ldp neighbor brief on PE3" : "show ldp session on PE3" }, proof];
  }
}
export function hvLadder(s: HvState): { k: string; title: string; text: string }[] {
  const t = lastTest(s);
  const v = s.view;
  const acBad = HV_CES.filter((x) => x !== "CE5").filter((ce) => {
    const d = CES[ce];
    const k = acKey(d.ifn, d.vlan);
    return s.cfg[d.dev].acs[k]?.vlan !== d.vlan || !s.cfg[d.dev].bd?.acs.includes(k);
  }).map((ce) => `${CES[ce].dev}: no attachment circuit in the bridge for ${ce}'s VLAN ${CES[ce].vlan}`);
  const spokes = HV_MTUS.map((m) => {
    const a = v.pws.find((p) => p.dev === m && p.peer === HUB[m]);
    const b = v.pws.find((p) => p.dev === HUB[m] && p.peer === m);
    return !a || !b ? `${m} ↔ ${HUB[m]}: not configured at both ends` : !a.up ? `${m} ↔ ${HUB[m]}: down (${pwWhyText(a, s.os)})` : "";
  }).filter(Boolean);
  const mesh: string[] = [];
  for (let i = 0; i < HV_PES.length; i++)
    for (let j = i + 1; j < HV_PES.length; j++) {
      const a = HV_PES[i];
      const b = HV_PES[j];
      const p = v.pws.find((x) => x.dev === a && x.peer === b) ?? v.pws.find((x) => x.dev === b && x.peer === a);
      if (!p) mesh.push(`${a} ↔ ${b}: no pseudowire`);
      else if (!p.up) mesh.push(`${a} ↔ ${b}: down (${pwWhyText(p, s.os)})`);
    }
  const roles = HV_PES.flatMap((pe) => v.pws.filter((p) => p.dev === pe && p.peer && (isMtu(p.peer) ? p.role !== "spoke" : p.role !== "mesh")).map((p) => `${pe} treats its pseudowire to ${p.peer} as ${p.role === "mesh" ? "a core mesh member" : "a spoke"}`));
  const brokenLdp = HV_LINKS.filter((l) => !v.ldp[l.id]).map((l) => l.id);
  return [
    { k: "test", title: "What did the test show?", text: t ? `ping ${t.dst} from ${t.from}: ${t.ok ? `success (${t.reached})` : t.why}.` : "Run the user's test first." },
    { k: "ac", title: "Does every CE's VLAN land in its MTU-s bridge?", text: acBad.join(" · ") || "Yes." },
    { k: "spoke", title: "Is every spoke up?", text: spokes.join(" · ") || "Yes: three spokes, both ends." },
    { k: "mesh", title: "Is the core mesh full?", text: mesh.join(" · ") || "Yes: three mesh pseudowires." },
    { k: "role", title: "Does every PE-rs give each pseudowire the right role?", text: roles.join(" · ") || "Yes: spokes outside the core's split-horizon group, mesh inside." },
    { k: "lsp", title: "Is the transport LSP complete?", text: brokenLdp.length ? `No LDP on ${brokenLdp.join(", ")}.` : "Yes: LDP on every link." },
  ];
}
