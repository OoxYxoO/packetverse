import { spClone, type SpBase, type SpMoment, type SpRun } from "@/components/sp-lab/spKit";
import { CES, VS_CES, VS_LINKS, VS_LO, VS_PES, VS_ROUTERS, acKey, ceIfs, coreIfs, vplsPing, vsTransport, type IfName, type VplsPwLike, type VsCe, type VsFdb, type VsR, type VsTest, type VsView } from "./vsNet";


/**
 * BGP-signaled VPLS Lab network — the VPLS Lab's three PEs and three P routers, plus route reflector RR1 (9.9.9.9,
 * cluster 100.100.100.100, the Route Reflector lesson's) which sits in the control plane only. The customer is the same
 * VPLS — VLAN 100, CE1/CE2/CE3 (and a spare CE4 on PE2) — but nobody lists neighbors any more: BGP discovers them.
 *
 * Modeled (RFC 4761, BGP auto-discovery and signaling):
 * - Each PE's VPLS has a route distinguisher, a route target (import = export here), a VE ID and a label block size
 *   (IOS XR ve-range, default 10; Junos label-block-size, default 8). It advertises one VPLS NLRI per label block:
 *   RD, VE ID, block offset (VBO), block size (VBS), label base (LB), RT, its loopback as next hop, layer-2 info (MTU).
 * - Blocks are added automatically so that every remote VE ID the PE has imported is covered (a second block once a
 *   VE ID passes the first block's range).
 * - Each PE peers with RR1 only (iBGP AS 65000) with the L2VPN VPLS family; the session must be configured on both
 *   sides and the family negotiated by both. RR1 reflects routes from clients to everyone and routes from non-clients
 *   to clients only. A PE keeps only routes whose RT it imports.
 * - A pseudowire between two PEs exists when each imported the other's NLRI. The label a PE pushes toward a peer is
 *   the peer's LB + (own VE ID − VBO) of the peer's block that covers its VE ID. Equal VE IDs on two PEs collide (both
 *   pseudowires between them down; a third PE picks the lower loopback as designated). MTUs must match. Junos wants an
 *   LSP to the peer in inet.3.
 * - The data plane is the VPLS Lab's, unchanged: MAC learning, flooding, split horizon, the two-label path.
 */

export type BvR = VsR | "RR1";
export const BV_ROUTERS: BvR[] = [...VS_ROUTERS, "RR1"];
export const BV_PES = VS_PES;
export const BV_LO: Record<BvR, string> = { ...VS_LO, RR1: "9.9.9.9" };
export const AS = 65000;
export const RR_CLUSTER = "100.100.100.100";
export const CUST_RT = "65000:100";
export type BvOs = "xr" | "junos";
export const peOfLo = (ip: string) => BV_ROUTERS.find((r) => BV_LO[r] === ip);

// ---------------------------------------------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------------------------------------------
export interface BvAc {
  vlan?: number;
  vpls: boolean;
}
export interface BvBd {
  group: string;
  name: string;
  acs: string[];
  /** IOS XR: vfi + vpn-id + autodiscovery bgp + signaling-protocol bgp. Junos: implied by instance-type vpls. */
  vfi: boolean;
  vpnId?: number;
  ad: boolean;
  sig: boolean;
  rd?: string;
  rt?: string;
  veId?: number;
  /** Junos site name (site <name> site-identifier <veId>). */
  site?: string;
  blockSize: number;
  mtu: number;
}
export interface BvCfg {
  acs: Record<string, BvAc>;
  bd?: BvBd;
  /** PE: its iBGP neighbor (RR1) and whether the L2VPN VPLS family is active toward it. */
  nbr?: { ip: string; l2vpn: boolean };
  /** RR1: its clients. */
  rr?: { clients: { ip: string; l2vpn: boolean; client: boolean }[] };
  ldp: Partial<Record<IfName, boolean>>;
  ldpLo: boolean;
}
export type BvConfig = Record<BvR, BvCfg>;
export const defaultBlock = (os: BvOs) => (os === "xr" ? 10 : 8);
const RD: Record<string, string> = { PE1: "65000:1", PE2: "65000:2", PE3: "65000:3" };
const VE: Record<string, number> = { PE1: 1, PE2: 2, PE3: 3 };
export function bvHealthy(os: BvOs): BvConfig {
  const c = {} as BvConfig;
  for (const r of BV_ROUTERS) {
    const ldp: Partial<Record<IfName, boolean>> = {};
    if (r !== "RR1") for (const x of coreIfs(r)) ldp[x.ifn] = true;
    c[r] = { acs: {}, ldp, ldpLo: false };
  }
  for (const pe of BV_PES) {
    const ce = ceIfs(pe).find((x) => x.ce !== "CE4")!;
    const k = acKey(ce.ifn, ce.vlan);
    c[pe].acs[k] = { vlan: ce.vlan, vpls: true };
    c[pe].bd = { group: "CUST-A", name: "VPLS-A", acs: [k], vfi: true, vpnId: 100, ad: true, sig: true, rd: RD[pe], rt: CUST_RT, veId: VE[pe], site: ce.ce, blockSize: defaultBlock(os), mtu: 1500 };
    c[pe].nbr = { ip: BV_LO.RR1, l2vpn: true };
  }
  c.RR1.rr = { clients: BV_PES.map((p) => ({ ip: BV_LO[p], l2vpn: true, client: true })) };
  return c;
}

// ---------------------------------------------------------------------------------------------------------------
// The control plane
// ---------------------------------------------------------------------------------------------------------------
const BASE: Record<BvOs, Record<string, number>> = { xr: { PE1: 24000, PE2: 25000, PE3: 26000 }, junos: { PE1: 262145, PE2: 262401, PE3: 262657 } };
export interface BvBlock {
  vbo: number;
  vbs: number;
  base: number;
}
export interface BvNlri {
  pe: VsR;
  rd: string;
  veId: number;
  block: BvBlock;
  rt: string;
  nh: string;
  mtu: number;
}
export type PwWhy = "noimport" | "collision" | "notdesignated" | "mtu" | "nolsp" | "remotedown";
export interface BvPw extends VplsPwLike {
  pe: VsR;
  peer: VsR;
  ip: string;
  up: boolean;
  why?: PwWhy;
  /** The label this PE receives on from the peer, and the label it pushes toward it. */
  local?: number;
  remote?: { label: number; mtu: number };
  veLocal: number;
  vePeer: number;
  mtu: number;
}
export interface BvView extends Pick<VsView, "ldp" | "lsp"> {
  /** PE ↔ RR1 sessions: established, and whether the L2VPN family is negotiated. */
  bgp: Record<string, { up: boolean; l2vpn: boolean }>;
  /** The NLRIs each PE originates. */
  nlris: BvNlri[];
  /** What RR1 holds, and what each PE has received and imported. */
  rrTable: BvNlri[];
  received: Record<string, BvNlri[]>;
  imported: Record<string, BvNlri[]>;
  pws: BvPw[];
}
const blockFor = (blocks: BvBlock[], ve: number) => blocks.find((b) => ve >= b.vbo && ve < b.vbo + b.vbs);
const blocksCovering = (os: BvOs, pe: VsR, size: number, ves: number[]): BvBlock[] => {
  const idx = [...new Set(ves.filter((v) => v > 0).map((v) => Math.floor((v - 1) / size)))].sort((a, b) => a - b);
  return idx.map((k) => ({ vbo: k * size + 1, vbs: size, base: BASE[os][pe] + k * (os === "xr" ? 100 : size) }));
};
export function bvCompute(c: BvConfig, os: BvOs): BvView {
  const { ldp, lsp } = vsTransport(c, os);
  const rr = c.RR1.rr;
  const bgp: BvView["bgp"] = {};
  for (const pe of BV_PES) {
    const cl = rr?.clients.find((x) => x.ip === BV_LO[pe]);
    const up = c[pe].nbr?.ip === BV_LO.RR1 && !!cl;
    bgp[pe] = { up, l2vpn: up && !!c[pe].nbr?.l2vpn && !!cl?.l2vpn };
  }
  const isClient = (pe: VsR) => !!rr?.clients.find((x) => x.ip === BV_LO[pe])?.client;
  const live = (pe: VsR) => {
    const b = c[pe].bd;
    return !!b && b.rd !== undefined && b.rt !== undefined && b.veId !== undefined && (os === "junos" || (b.vfi && b.ad && b.sig));
  };
  // Pass 1: which PEs' advertisements reach which PEs (reflection rules, RT import) — by VE ID.
  const reaches = (from: VsR, to: VsR) => from !== to && bgp[from].l2vpn && bgp[to].l2vpn && (isClient(from) || isClient(to));
  const importsFrom = (pe: VsR, from: VsR) => live(from) && live(pe) && reaches(from, pe) && c[from].bd!.rt === c[pe].bd!.rt;
  const nlris: BvNlri[] = [];
  for (const pe of BV_PES) {
    if (!live(pe)) continue;
    const b = c[pe].bd!;
    // Blocks cover the remote VE IDs this PE imported (one default block when it has imported nobody yet).
    const ves = BV_PES.filter((x) => importsFrom(pe, x)).map((x) => c[x].bd!.veId!);
    for (const blk of blocksCovering(os, pe, b.blockSize, ves.length ? ves : [1])) nlris.push({ pe, rd: b.rd!, veId: b.veId!, block: blk, rt: b.rt!, nh: BV_LO[pe], mtu: b.mtu });
  }
  const rrTable = nlris.filter((n) => bgp[n.pe].l2vpn);
  const received: Record<string, BvNlri[]> = {};
  const imported: Record<string, BvNlri[]> = {};
  for (const pe of BV_PES) {
    received[pe] = rrTable.filter((n) => reaches(n.pe, pe));
    imported[pe] = received[pe].filter((n) => live(pe) && n.rt === c[pe].bd!.rt);
  }
  const pws: BvPw[] = [];
  for (const pe of BV_PES) {
    if (!live(pe)) continue;
    const mine = c[pe].bd!;
    const peers = [...new Set(imported[pe].map((n) => n.pe))];
    for (const peer of peers) {
      const theirs = c[peer].bd!;
      const pw: BvPw = { pe, peer, ip: BV_LO[peer], up: false, veLocal: mine.veId!, vePeer: theirs.veId!, mtu: mine.mtu };
      pws.push(pw);
      if (!imported[peer]?.some((n) => n.pe === pe)) {
        pw.why = "noimport";
        continue;
      }
      if (mine.veId === theirs.veId) {
        pw.why = "collision";
        continue;
      }
      const rivals = BV_PES.filter((x) => x !== peer && x !== pe && imported[pe].some((n) => n.pe === x) && c[x].bd!.veId === theirs.veId);
      if (rivals.some((x) => BV_LO[x] < BV_LO[peer])) {
        pw.why = "notdesignated";
        continue;
      }
      const tb = blockFor(imported[pe].filter((n) => n.pe === peer).map((n) => n.block), mine.veId!);
      const mb = blockFor(nlris.filter((n) => n.pe === pe).map((n) => n.block), theirs.veId!);
      if (!tb || !mb) {
        pw.why = "noimport";
        continue;
      }
      pw.local = mb.base + theirs.veId! - mb.vbo;
      pw.remote = { label: tb.base + mine.veId! - tb.vbo, mtu: theirs.mtu };
      if (theirs.mtu !== mine.mtu) {
        pw.why = "mtu";
        continue;
      }
      if (os === "junos" && lsp[pe][BV_LO[peer]]?.out === undefined) {
        pw.why = "nolsp";
        continue;
      }
      pw.up = true;
    }
  }
  // A pseudowire carries traffic only when both ends are up: an end whose peer keeps its own end down goes down too.
  const upNow = new Set(pws.filter((p) => p.up).map((p) => `${p.pe}>${p.peer}`));
  for (const p of pws) if (p.up && !upNow.has(`${p.peer}>${p.pe}`)) Object.assign(p, { up: false, why: "remotedown" as PwWhy });
  return { ldp, lsp, bgp, nlris, rrTable, received, imported, pws };
}
export function bvWhyText(p: BvPw, os: BvOs): string {
  switch (p.why) {
    case "noimport":
      return `${p.peer} doesn't import ${p.pe}'s VPLS route (no label toward ${p.pe})`;
    case "collision":
      return `VE ID collision: ${p.pe} and ${p.peer} both use VE ID ${p.veLocal}`;
    case "notdesignated":
      return `${p.peer}'s VE ID ${p.vePeer} is also advertised by a PE with a lower loopback, which ${p.pe} chose instead`;
    case "mtu":
      return `MTU mismatch: local ${p.mtu}, remote ${p.remote?.mtu}`;
    case "nolsp":
      return os === "xr" ? "no LSP to the neighbor" : `no LSP to ${p.ip} in inet.3`;
    case "remotedown":
      return `${p.peer} keeps its end of this pseudowire down`;
  }
  return "down";
}
/** Why a PE has no pseudowire to a peer at all (nothing imported). */
export function bvMissingWhy(v: BvView, c: BvConfig, pe: VsR, peer: VsR): string {
  if (!c[pe].bd || !c[peer].bd) return `${!c[pe].bd ? pe : peer} has no VPLS configured`;
  if (!v.bgp[pe].up) return `${pe}'s BGP session to RR1 is down`;
  if (!v.bgp[pe].l2vpn) return `${pe} doesn't exchange L2VPN VPLS routes with RR1: the family isn't negotiated`;
  if (!v.bgp[peer].l2vpn) return `${peer} doesn't exchange L2VPN VPLS routes with RR1`;
  if (!v.rrTable.some((n) => n.pe === peer)) return `RR1 has no VPLS route from ${peer}`;
  if (!v.received[pe].some((n) => n.pe === peer)) return `RR1 doesn't reflect ${peer}'s route to ${pe}`;
  if (!v.imported[pe].some((n) => n.pe === peer)) return `${pe} receives ${peer}'s route with RT ${v.received[pe].find((n) => n.pe === peer)?.rt} but imports ${c[pe].bd!.rt}`;
  return "no pseudowire";
}

// ---------------------------------------------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------------------------------------------
export interface BvSnap {
  view: BvView;
  fdb: VsFdb;
}
export interface BvSys {
  t: number;
  dev: BvR;
  kind: "commit" | "ldp-up" | "ldp-down" | "bgp-up" | "bgp-down" | "pw-up" | "pw-down" | "clear";
  peer?: string;
  ve?: number;
}
export interface BvState extends SpBase<BvSnap> {
  os: BvOs;
  cfg: BvConfig;
  hist: Record<BvR, BvCfg[]>;
  view: BvView;
  fdb: VsFdb;
  arp: Record<VsCe, Record<string, string>>;
  sys: BvSys[];
  tests: VsTest[];
  wiped?: boolean;
  cleared?: number;
}
export type BvAction =
  | { type: "cfg"; dev: BvR; cfg: BvCfg; text: string }
  | { type: "set"; changes: { dev: BvR; f: (c: BvCfg) => void }[]; text: string }
  | { type: "test"; from: VsCe; dst: string }
  | { type: "clear"; dev?: VsR }
  | { type: "ticket"; id: BvTicketId }
  | { type: "os"; os: BvOs }
  | { type: "wipe-pe3" };

const cl = (o: BvState): BvState => ({ ...spClone(o), runs: o.runs, last: o.last });
const emptyFdb = (): VsFdb => Object.fromEntries(VS_ROUTERS.map((r) => [r, []])) as unknown as VsFdb;
export function createBvNet(seq = 0, os: BvOs = "xr"): BvState {
  const cfg = bvHealthy(os);
  const view = bvCompute(cfg, os);
  const s: BvState = { seq, os, cfgSeq: 0, clock: 3600, runs: [], log: [{ seq, t: 3600, text: "IS-IS and LDP are up; PE1, PE2 and PE3 peer with RR1 for L2VPN VPLS, discovered each other through their routes and built a full mesh of pseudowires. The MAC tables are empty.", tone: "info" }], cfg, hist: Object.fromEntries(BV_ROUTERS.map((r) => [r, []])) as unknown as Record<BvR, BvCfg[]>, view, fdb: emptyFdb(), arp: { CE1: {}, CE2: {}, CE3: {}, CE4: {} }, sys: [], tests: [] };
  for (const l of VS_LINKS) s.sys.push({ t: 20, dev: l.a, kind: "ldp-up", peer: VS_LO[l.b] }, { t: 20, dev: l.b, kind: "ldp-up", peer: VS_LO[l.a] });
  for (const pe of BV_PES) s.sys.push({ t: 25, dev: pe, kind: "bgp-up", peer: BV_LO.RR1 }, { t: 25, dev: "RR1", kind: "bgp-up", peer: BV_LO[pe] });
  for (const p of view.pws.filter((x) => x.up)) s.sys.push({ t: 32, dev: p.pe, kind: "pw-up", peer: p.ip, ve: p.vePeer });
  return s;
}
export function bvTest(s0: BvState, from: VsCe, dst: string): BvState {
  return vplsPing(s0, from, dst, (pw) => {
    const p = s0.view.pws.find((x) => x.pe === pw.pe && x.peer === pw.peer);
    return p ? bvWhyText(p, s0.os) : bvMissingWhy(s0.view, s0.cfg, pw.pe, pw.peer!);
  });
}
/** A ping, with a clearer reason when a PE has no pseudowire to the other at all (nothing discovered). */
function testWithDiscovery(s0: BvState, from: VsCe, dst: string): BvState {
  const out = bvTest(s0, from, dst);
  const t = out.tests[out.tests.length - 1];
  const target = VS_CES.find((x) => CES[x].ip === dst);
  if (!t.ok && target && t.why && /none configured/.test(t.why)) {
    const a = CES[from].pe;
    const b = CES[target].pe;
    t.why = t.why.replace("none configured", bvMissingWhy(out.view, out.cfg, a, b));
    if (out.last) out.last = { ...out.last, moments: out.last.moments.map((m) => ({ ...m, lines: m.lines.map((l) => ({ ...l, text: l.text.replace("none configured", bvMissingWhy(out.view, out.cfg, a, b)) })) })) };
    out.runs = [...out.runs.slice(0, -1), out.last!];
    out.log = [...out.log.slice(0, -1), { ...out.log[out.log.length - 1], text: `ping ${dst} from ${from}: ${t.why}` }];
  }
  return out;
}

const pwKey = (p: BvPw) => `${p.pe}|${p.peer}`;
function converge(prev: BvState, s: BvState, why: string, show = true): BvState {
  const view = bvCompute(s.cfg, s.os);
  s.view = view;
  for (const pe of BV_PES) {
    const ups = new Set(view.pws.filter((p) => p.pe === pe && p.up).map((p) => `pw:${p.ip}`));
    const acs = new Set(s.cfg[pe].bd?.acs ?? []);
    s.fdb[pe] = s.fdb[pe].filter((m) => (m.port.startsWith("pw:") ? ups.has(m.port) : acs.has(m.port) && !!s.cfg[pe].acs[m.port]));
  }
  const snap = { view: spClone(view), fdb: spClone(s.fdb) };
  const moments: SpMoment<BvSnap>[] = [];
  for (const l of VS_LINKS) {
    if (prev.view.ldp[l.id] !== view.ldp[l.id]) {
      moments.push({ tokens: view.ldp[l.id] ? [{ from: l.a, to: l.b, label: "LDP", color: "cyan" }] : [], lines: [{ text: `LDP ${l.a}–${l.b} ${view.ldp[l.id] ? "Operational — transport labels are exchanged again" : "goes down — the labels learned over it are withdrawn"}.`, tone: view.ldp[l.id] ? "ok" : "bad" }], snap });
      s.sys.push({ t: s.clock, dev: l.a, kind: view.ldp[l.id] ? "ldp-up" : "ldp-down", peer: VS_LO[l.b] }, { t: s.clock, dev: l.b, kind: view.ldp[l.id] ? "ldp-up" : "ldp-down", peer: VS_LO[l.a] });
    }
  }
  for (const pe of BV_PES) {
    const a = prev.view.bgp[pe];
    const b = view.bgp[pe];
    if (a.up !== b.up || a.l2vpn !== b.l2vpn) {
      moments.push({ tokens: b.up ? [{ from: pe, to: "RR1", label: "OPEN", color: "amber" }] : [], lines: [{ text: !b.up ? `${pe} ↔ RR1: the BGP session goes down.` : b.l2vpn ? `${pe} ↔ RR1: Established, L2VPN VPLS negotiated.` : `${pe} ↔ RR1: Established, but the L2VPN VPLS family isn't negotiated — no VPLS routes.`, tone: b.l2vpn ? "ok" : "bad" }], snap });
      if (a.up !== b.up) s.sys.push({ t: s.clock, dev: pe, kind: b.up ? "bgp-up" : "bgp-down", peer: BV_LO.RR1 }, { t: s.clock, dev: "RR1", kind: b.up ? "bgp-up" : "bgp-down", peer: BV_LO[pe] });
    }
  }
  const nk = (n: BvNlri) => `${n.pe}|${n.rd}|${n.veId}|${n.block.vbo}|${n.block.base}|${n.rt}|${n.mtu}`;
  const added = view.rrTable.filter((n) => !prev.view.rrTable.some((x) => nk(x) === nk(n)));
  const gone = prev.view.rrTable.filter((n) => !view.rrTable.some((x) => nk(x) === nk(n)));
  if (added.length) moments.push({ tokens: added.slice(0, 3).map((n) => ({ from: n.pe, to: "RR1", label: `UPDATE VE ${n.veId} block ${n.block.vbo}/${n.block.vbs}`, color: "violet" })), lines: added.map((n) => ({ text: `${n.pe} advertises ${n.rd}: VE ID ${n.veId}, label block offset ${n.block.vbo} size ${n.block.vbs} base ${n.block.base}, RT ${n.rt}.`, tone: "learn" as const })).slice(0, 6), snap });
  if (gone.length) moments.push({ tokens: [], lines: gone.map((n) => ({ text: `${n.pe} withdraws ${n.rd}: VE ID ${n.veId}, block ${n.block.vbo}/${n.block.vbs}.`, tone: "warn" as const })).slice(0, 6), snap });
  const lines: { text: string; tone: "ok" | "bad" | "warn" }[] = [];
  for (const p of view.pws) {
    const was = prev.view.pws.find((x) => pwKey(x) === pwKey(p));
    if (p.up && !was?.up) {
      lines.push({ text: `${p.pe}: pseudowire to ${p.peer} (VE ${p.vePeer}) is up — pushes ${p.remote!.label}, receives on ${p.local}.`, tone: "ok" });
      s.sys.push({ t: s.clock, dev: p.pe, kind: "pw-up", peer: p.ip, ve: p.vePeer });
    } else if (!p.up && (was?.up || !was)) {
      lines.push({ text: `${p.pe}: pseudowire to ${p.peer} is down — ${bvWhyText(p, s.os)}.`, tone: "bad" });
      if (was?.up) s.sys.push({ t: s.clock, dev: p.pe, kind: "pw-down", peer: p.ip, ve: p.vePeer });
    }
  }
  for (const p of prev.view.pws) if (p.up && !view.pws.some((x) => pwKey(x) === pwKey(p))) {
    lines.push({ text: `${p.pe}: pseudowire to ${p.peer} is gone — ${bvMissingWhy(view, s.cfg, p.pe, p.peer)}.`, tone: "warn" });
    s.sys.push({ t: s.clock, dev: p.pe, kind: "pw-down", peer: p.ip, ve: p.vePeer });
  }
  if (lines.length) moments.push({ tokens: [], lines: lines.slice(0, 8), snap });
  if (show && moments.length) {
    const run: SpRun<BvSnap> = { id: s.runs.length + 1 + s.seq * 1000, cmd: why, kind: "converge", moments };
    s.runs = [...s.runs, run];
    s.last = run;
  }
  return s;
}

// ---------------------------------------------------------------------------------------------------------------
// Tickets
// ---------------------------------------------------------------------------------------------------------------
export type BvTicketId = "rt" | "family" | "rr" | "veid" | "transport";
export interface BvTicketDef {
  id: BvTicketId;
  title: string;
  report: string;
  reproLabel: string;
  repro: BvAction[];
  fault: (c: BvConfig) => void;
}
const ping = (from: VsCe, dst: string): BvAction => ({ type: "test", from, dst });
export const BV_TICKETS: BvTicketDef[] = [
  {
    id: "rt",
    title: "Site 3 dropped out",
    report: "“Since last night's change on PE3, CE3 reaches nobody. PE3's BGP session to the route reflector is up and its VPLS is configured. CE1 ↔ CE2 works.”",
    reproLabel: "ping 192.168.100.3 from CE1",
    repro: [ping("CE1", "192.168.100.3")],
    fault: (c) => {
      c.PE3.bd!.rt = "65000:999";
    },
  },
  {
    id: "family",
    title: "PE2 stopped discovering",
    report: "“PE2's BGP configuration was regenerated from a template. Its session to RR1 is Established, but CE2 reaches nobody. CE1 ↔ CE3 is fine.”",
    reproLabel: "ping 192.168.100.1 from CE2",
    repro: [ping("CE2", "192.168.100.1")],
    fault: (c) => {
      c.PE2.nbr!.l2vpn = false;
    },
  },
  {
    id: "rr",
    title: "Every session up, nothing works",
    report: "“After RR1 was replaced, no site reaches any other. Every PE's BGP session to RR1 is Established, and RR1 shows all three VPLS routes.”",
    reproLabel: "ping 192.168.100.2 from CE1",
    repro: [ping("CE1", "192.168.100.2")],
    fault: (c) => {
      for (const x of c.RR1.rr!.clients) x.client = false;
    },
  },
  {
    id: "veid",
    title: "A copy-paste at PE3",
    report: "“PE3's VPLS was re-provisioned by copying PE2's configuration and changing the RD. Now CE3 reaches nobody, and CE2 ↔ CE1 still works.”",
    reproLabel: "ping 192.168.100.3 from CE1",
    repro: [ping("CE1", "192.168.100.3")],
    fault: (c) => {
      c.PE3.bd!.veId = 2;
    },
  },
  {
    id: "transport",
    title: "After the P1 upgrade",
    report: "“Since P1 was upgraded, CE3 reaches nobody. Every BGP session is up, RR1 reflects every route, and PE3's loopback pings.”",
    reproLabel: "ping 192.168.100.3 from CE1",
    repro: [ping("CE1", "192.168.100.3")],
    fault: (c) => {
      c.P1.ldp["ge-0/0/2"] = false;
    },
  },
];
export const bvTicket = (id: string) => BV_TICKETS.find((t) => t.id === id)!;
export function bvTicketState(id: BvTicketId, seq = 0, os: BvOs = "xr"): BvState {
  const s = createBvNet(seq, os);
  const nx = cl(s);
  bvTicket(id).fault(nx.cfg);
  const out = converge(s, nx, "", false);
  out.ticket = id;
  out.runs = [];
  out.last = undefined;
  out.log = [...out.log, { seq, t: out.clock, text: `Ticket opened: ${bvTicket(id).title}.`, tone: "warn" }];
  return out;
}

export function bvApply(s0: BvState, a: BvAction): BvState {
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
      return testWithDiscovery(s0, a.from, a.dst);
    case "clear": {
      const s = cl(s0);
      s.clock += 1;
      for (const r of a.dev ? [a.dev] : BV_PES) s.fdb[r] = [];
      for (const ce of VS_CES) s.arp[ce] = {};
      s.cleared = s.clock;
      s.sys.push({ t: s.clock, dev: a.dev ?? "PE1", kind: "clear" });
      s.log = [...s.log, { seq: s.seq, t: s.clock, text: `${a.dev ? `${a.dev}'s MAC table` : "Every PE's MAC table"} cleared (and the CEs' ARP caches aged out).`, tone: "info" }];
      return s;
    }
    case "ticket":
      return bvTicketState(a.id, s0.seq + 1, s0.os);
    case "os":
      return createBvNet(s0.seq + 1, a.os);
    case "wipe-pe3": {
      const s = cl(s0);
      s.cfg.PE3.bd = undefined;
      s.cfg.PE3.acs = {};
      s.wiped = true;
      s.cfgSeq += 1;
      s.clock += 1;
      s.log = [...s.log, { seq: s.seq, t: s.clock, text: "PE3's VPLS was deleted: its bridge domain / instance and its sub-interface are gone. Nothing else changed.", tone: "warn" }];
      return converge(s0, s, "PE3 loses its VPLS configuration");
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Diagnosis, proofs, ladder
// ---------------------------------------------------------------------------------------------------------------
export const BV_CAUSES: { id: string; label: string }[] = [
  { id: "rt", label: "A PE's route target doesn't match the VPLS's" },
  { id: "family", label: "A PE doesn't exchange the L2VPN VPLS family with the route reflector" },
  { id: "rr", label: "The route reflector doesn't reflect (its PEs aren't route-reflector clients)" },
  { id: "veid", label: "Two PEs use the same VE ID" },
  { id: "transport", label: "A transport LSP between the PEs is broken (LDP)" },
  { id: "block", label: "A label block is too small for the VE IDs in use" },
  { id: "nbr", label: "A PE is missing a VPLS neighbor statement" },
];
const lastTest = (s: BvState) => s.tests[s.tests.length - 1];
export function bvCauseFeedback(s: BvState, cause: string): { right: boolean; text: string } {
  const t = s.ticket as BvTicketId | undefined;
  const xr = s.os === "xr";
  if (cause === t) {
    const txt: Record<BvTicketId, string> = {
      rt: `Yes. PE3's VPLS now uses route target 65000:999. RR1 still reflects everything, but PE1 and PE2 drop PE3's route (its RT isn't theirs) and PE3 drops theirs. No import, no label, no pseudowire to PE3 — the BGP session itself is fine. RR1's table shows the odd RT.`,
      family: `Yes. PE2's regenerated neighbor configuration no longer activates ${xr ? "address-family l2vpn vpls-vpws" : "family l2vpn signaling"}. The session comes up, but no VPLS route is exchanged in either direction: PE2 neither advertises its VE ID nor hears the others'.`,
      rr: `Yes. The new RR1 treats its neighbors as ordinary iBGP peers (${xr ? "no route-reflector-client" : "no cluster in the group"}). iBGP doesn't pass routes from one iBGP peer to another, so RR1 holds all three VPLS routes and gives them to nobody. Every PE is alone.`,
      veid: "Yes. PE3's copied configuration kept VE ID 2 — PE2's. The two PEs see a VE ID collision and bring nothing up between them; PE1 receives VE ID 2 twice and uses only the PE with the lower loopback (PE2). PE3 ends up with no working pseudowire.",
      transport: xr ? "Yes. P1 no longer runs LDP toward P3, so P1 has no label for 3.3.3.3 (Unlabelled). PE1 pushes PE3's VPLS label under the transport label; P1 removes the transport label and P3 receives PE3's label — which means nothing to P3 — and drops the frame. BGP runs over plain IP and is unaffected." : "Yes. P1 no longer runs LDP toward P3; with ordered control there is no LSP to 3.3.3.3 from PE1 or PE2, and Junos keeps the VPLS pseudowires to PE3 down without an LSP in inet.3. BGP itself is unaffected.",
    };
    return { right: true, text: txt[t] };
  }
  const lt = lastTest(s);
  switch (cause) {
    case "block":
      return { right: false, text: "Label blocks grow on their own: when a PE imports a VE ID outside its block, it advertises another block. Block size is never what isolates a site." };
    case "nbr":
      return { right: false, text: "BGP-signaled VPLS has no neighbor statements — the PEs discover each other from their routes." };
    case "rt":
      return { right: false, text: "Every PE uses route target 65000:100." };
    case "family":
      return { right: false, text: "Every PE exchanges L2VPN VPLS routes with RR1." };
    case "rr":
      return { right: false, text: "RR1 reflects: every PE is a route-reflector client." };
    case "veid":
      return { right: false, text: "Each PE has its own VE ID (1, 2, 3)." };
    case "transport":
      return { right: false, text: "LDP runs on every core link: the PEs have complete LSPs to each other." };
  }
  return { right: false, text: lt ? "That doesn't match the evidence." : "Run the user's test first." };
}
export function bvProofs(s: BvState): { label: string; ok: boolean; detail: string }[] {
  const t = s.ticket as BvTicketId | undefined;
  if (!t) return [];
  const fresh = s.tests.filter((x) => x.cfgSeq === s.cfgSeq);
  const p0 = bvTicket(t).repro[0] as { from: VsCe; dst: string };
  const proof = { label: `A fresh ping ${p0.dst} from ${p0.from} succeeds`, ok: fresh.some((x) => x.from === p0.from && x.dst === p0.dst && x.ok), detail: "run the test again after the fix" };
  const xr = s.os === "xr";
  const meshUp = s.view.pws.length === 6 && s.view.pws.every((p) => p.up);
  const bd = xr ? "show l2vpn bridge-domain detail" : "show vpls connections";
  switch (t) {
    case "rt":
      return [{ label: "PE3 uses RT 65000:100 and all six pseudowire ends are up", ok: meshUp, detail: `${bd} on PE3` }, proof];
    case "family":
      return [{ label: "PE2 exchanges L2VPN VPLS routes with RR1 and its pseudowires are up", ok: s.view.bgp.PE2.l2vpn && meshUp, detail: xr ? "show bgp l2vpn vpls summary on PE2" : "show bgp summary on PE2" }, proof];
    case "rr":
      return [{ label: "RR1 reflects to every PE and the mesh is up", ok: meshUp, detail: xr ? "show bgp l2vpn vpls on PE1" : "show route table bgp.l2vpn.0 on PE1" }, proof];
    case "veid":
      return [{ label: "Every PE has its own VE ID and the mesh is up", ok: new Set(BV_PES.map((p) => s.cfg[p].bd?.veId)).size === 3 && meshUp, detail: `${bd} on PE3` }, proof];
    case "transport":
      return [{ label: "LDP runs on P1–P3", ok: s.view.ldp["P1-P3"], detail: xr ? "show mpls ldp neighbor brief on P1" : "show ldp session on P1" }, proof];
  }
}
export function bvLadder(s: BvState): { k: string; title: string; text: string }[] {
  const t = lastTest(s);
  const v = s.view;
  const acBad = VS_CES.filter((x) => x !== "CE4").filter((ce) => {
    const d = CES[ce];
    const k = acKey(d.ifn, d.vlan);
    return s.cfg[d.pe].acs[k]?.vlan !== d.vlan || !s.cfg[d.pe].bd?.acs.includes(k);
  }).map((ce) => `${CES[ce].pe}: no attachment circuit in the VPLS for ${ce}'s VLAN ${CES[ce].vlan}`);
  const bgpBad = BV_PES.filter((pe) => !v.bgp[pe].l2vpn).map((pe) => `${pe} ↔ RR1: ${v.bgp[pe].up ? "Established, no L2VPN VPLS family" : "down"}`);
  const disc = BV_PES.flatMap((pe) => BV_PES.filter((x) => x !== pe && !v.imported[pe].some((n) => n.pe === x)).map((x) => `${pe} has not imported ${x}: ${bvMissingWhy(v, s.cfg, pe, x)}`));
  const down = v.pws.filter((p) => !p.up).map((p) => `${p.pe} → ${p.peer}: ${bvWhyText(p, s.os)}`);
  const brokenLdp = VS_LINKS.filter((l) => !v.ldp[l.id]).map((l) => l.id);
  return [
    { k: "test", title: "What did the test show?", text: t ? `ping ${t.dst} from ${t.from}: ${t.ok ? `success (${t.reached})` : t.why}.` : "Run the user's test first." },
    { k: "ac", title: "Does every CE's VLAN land in the VPLS?", text: acBad.join(" · ") || "Yes." },
    { k: "bgp", title: "Does every PE exchange L2VPN VPLS routes with RR1?", text: bgpBad.join(" · ") || "Yes: three sessions, family negotiated." },
    { k: "disc", title: "Has every PE discovered (imported) every other PE?", text: disc.join(" · ") || "Yes." },
    { k: "pw", title: "Is every pseudowire up, with labels both ways?", text: down.join(" · ") || (v.pws.length === 6 ? "Yes, all six ends." : `The ${v.pws.length} ends that exist are up; the others were never discovered (step 4).`) },
    { k: "lsp", title: "Is the transport LSP complete?", text: brokenLdp.length ? `No LDP on ${brokenLdp.join(", ")}.` : "Yes: LDP on every core link." },
  ];
}
