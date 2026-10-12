import { spClone, type SpBase, type SpMoment, type SpRun } from "@/components/sp-lab/spKit";

/**
 * EVPN-VXLAN Lab network — the guided lesson's fabric: two leaf VTEPs and a spine, Junos (QFX-style) configuration.
 *
 *   HOST-A 10.10.10.11 ─┐                                   ┌─ HOST-B 10.10.10.22
 *   HOST-C 10.10.10.33 ─┤ LEAF1 ── SPINE1 ── LEAF2 ├─ HOST-F 10.20.20.22 (VLAN 20)
 *   HOST-E 10.20.20.11 ─┘ VTEP 10.255.0.1   10.255.0.254   VTEP 10.255.0.2
 *
 * Modeled:
 * - Underlay: OSPF area 0 on the leaf–spine links; each leaf's lo0.0 (its VTEP address) must be in OSPF for the other
 *   leaf to reach it. SPINE1 routes the outer IP packets and never sees a tenant MAC.
 * - Overlay control plane: one iBGP session LEAF1 ↔ LEAF2 between loopbacks (AS 65000, family evpn signaling). Each leaf
 *   advertises a Type 3 (inclusive multicast) route per extended VNI — the flood list for ingress replication — and a
 *   Type 2 (MAC/IP) route for every MAC it has learned locally (with the IP once it has seen the host's ARP). Routes carry
 *   RD 10.255.0.x:10010 and the VNI's route target (vni-options vrf-target). A leaf keeps a route only if it imports the
 *   route target, and uses it only if the route's VNI is one of its own.
 * - Data plane: the leaves bridge per VLAN; the VLAN maps to a VNI (vlans … vxlan vni). Local MACs are learned from
 *   frames; remote MACs only from Type 2 routes (no data-plane learning across the fabric). Known unicast to a remote MAC
 *   is VXLAN-encapsulated to the owning VTEP; broadcast and unknown unicast go to every remote VTEP of the VNI
 *   (ingress replication, from Type 3) and out the local ports. The receiving VTEP needs the VNI, or it drops the frame.
 */

export type EvR = "LEAF1" | "SPINE1" | "LEAF2";
export type EvLeaf = "LEAF1" | "LEAF2";
export type EvHost = "HOST-A" | "HOST-C" | "HOST-E" | "HOST-B" | "HOST-F";
export const EV_ROUTERS: EvR[] = ["LEAF1", "SPINE1", "LEAF2"];
export const EV_LEAVES: EvLeaf[] = ["LEAF1", "LEAF2"];
export const OTHER: Record<EvLeaf, EvLeaf> = { LEAF1: "LEAF2", LEAF2: "LEAF1" };
export const EV_LO: Record<EvR, string> = { LEAF1: "10.255.0.1", SPINE1: "10.255.0.254", LEAF2: "10.255.0.2" };
export const AS = 65000;
export const RT10 = "65000:10010";
export type EvIf = "xe-0/0/0" | "xe-0/0/1" | "xe-0/0/2" | "xe-0/0/3";
export interface EvHostDef {
  leaf: EvLeaf;
  port: EvIf;
  ip: string;
  mac: string;
  subnet: string;
}
export const HOSTS: Record<EvHost, EvHostDef> = {
  "HOST-A": { leaf: "LEAF1", port: "xe-0/0/1", ip: "10.10.10.11", mac: "aa:aa:aa:aa:aa:11", subnet: "10.10.10" },
  "HOST-C": { leaf: "LEAF1", port: "xe-0/0/2", ip: "10.10.10.33", mac: "cc:cc:cc:cc:cc:33", subnet: "10.10.10" },
  "HOST-E": { leaf: "LEAF1", port: "xe-0/0/3", ip: "10.20.20.11", mac: "ee:ee:ee:ee:ee:11", subnet: "10.20.20" },
  "HOST-B": { leaf: "LEAF2", port: "xe-0/0/1", ip: "10.10.10.22", mac: "bb:bb:bb:bb:bb:22", subnet: "10.10.10" },
  "HOST-F": { leaf: "LEAF2", port: "xe-0/0/3", ip: "10.20.20.22", mac: "ff:ff:ff:ff:ff:22", subnet: "10.20.20" },
};
export const EV_HOSTS = Object.keys(HOSTS) as EvHost[];
export const BCAST = "ff:ff:ff:ff:ff:ff";
export interface EvLink {
  id: string;
  a: EvR;
  ai: EvIf;
  aip: string;
  b: EvR;
  bi: EvIf;
  bip: string;
}
export const EV_LINKS: EvLink[] = [
  { id: "LEAF1-SPINE1", a: "LEAF1", ai: "xe-0/0/0", aip: "192.0.2.0", b: "SPINE1", bi: "xe-0/0/0", bip: "192.0.2.1" },
  { id: "LEAF2-SPINE1", a: "LEAF2", ai: "xe-0/0/0", aip: "192.0.2.2", b: "SPINE1", bi: "xe-0/0/1", bip: "192.0.2.3" },
];
export const coreIfs = (r: EvR) => EV_LINKS.filter((l) => l.a === r || l.b === r).map((l) => (l.a === r ? { ifn: l.ai, ip: l.aip, peer: l.b, peerIp: l.bip, link: l } : { ifn: l.bi, ip: l.bip, peer: l.a, peerIp: l.aip, link: l }));
export const hostIfs = (r: EvR) => EV_HOSTS.filter((h) => HOSTS[h].leaf === r).map((h) => ({ host: h, ...HOSTS[h] }));
export const isLeaf = (r: EvR): r is EvLeaf => r !== "SPINE1";

// ---------------------------------------------------------------------------------------------------------------
// Configuration (Junos)
// ---------------------------------------------------------------------------------------------------------------
export interface EvVlan {
  id: number;
  vni?: number;
}
export interface EvCfg {
  /** Access ports: interface-mode access, vlan members <name>. */
  ports: Partial<Record<EvIf, { vlan?: string }>>;
  vlans: Record<string, EvVlan>;
  /** protocols ospf area 0: the fabric interfaces, and lo0.0 (passive). */
  ospf: Partial<Record<EvIf, boolean>>;
  ospfLo: boolean;
  /** switch-options. */
  vtep: boolean;
  rd?: string;
  /** protocols evpn: encapsulation vxlan, extended-vni-list, vni-options vni N vrf-target. */
  evpn?: { vxlan: boolean; extended: number[]; targets: Record<number, string> };
  /** protocols bgp group OVERLAY. */
  bgp?: { nbr?: string; evpn: boolean };
}
export type EvConfig = Record<EvR, EvCfg>;
export function evHealthy(): EvConfig {
  const c = {} as EvConfig;
  for (const r of EV_ROUTERS) {
    const ospf: Partial<Record<EvIf, boolean>> = {};
    for (const x of coreIfs(r)) ospf[x.ifn] = true;
    c[r] = { ports: {}, vlans: {}, ospf, ospfLo: true, vtep: false };
  }
  for (const l of EV_LEAVES) {
    for (const h of hostIfs(l)) c[l].ports[h.port] = { vlan: h.subnet === "10.10.10" ? "V10" : "V20" };
    c[l].vlans = { V10: { id: 10, vni: 10010 }, V20: { id: 20 } };
    c[l].vtep = true;
    c[l].rd = `${EV_LO[l]}:10010`;
    c[l].evpn = { vxlan: true, extended: [10010], targets: { 10010: RT10 } };
    c[l].bgp = { nbr: EV_LO[OTHER[l]], evpn: true };
  }
  return c;
}

// ---------------------------------------------------------------------------------------------------------------
// The control plane
// ---------------------------------------------------------------------------------------------------------------
export interface EvRoute {
  type: 2 | 3;
  leaf: EvLeaf;
  rd: string;
  vni: number;
  rt: string;
  nh: string;
  mac?: string;
  ip?: string;
}
/** A locally learned MAC: on an access port, in a VLAN, with its IP once ARP has shown it. */
export interface EvMac {
  mac: string;
  ip?: string;
  port: EvIf;
  vlan: string;
  t: number;
}
export type EvFdb = Record<EvLeaf, EvMac[]>;
export interface EvView {
  ospf: Record<string, boolean>;
  /** Can router r reach loopback `lo` over the underlay? */
  reach: Record<EvR, Record<string, boolean>>;
  bgp: { up: boolean; evpn: boolean };
  adv: EvRoute[];
  /** Received from the peer, kept (RT imported), usable (VNI is local). */
  received: Record<EvLeaf, EvRoute[]>;
  kept: Record<EvLeaf, EvRoute[]>;
  usable: Record<EvLeaf, EvRoute[]>;
}
export const routeKey = (r: EvRoute) => `${r.type}|${r.rd}|${r.vni}|${r.mac ?? ""}|${r.ip ?? ""}|${r.nh}`;
/** VNIs a leaf can actually use: mapped from a VLAN and in the extended-vni-list. */
export function localVnis(c: EvCfg): number[] {
  if (!c.evpn?.vxlan || !c.vtep) return [];
  return Object.values(c.vlans).map((v) => v.vni).filter((v): v is number => v !== undefined && c.evpn!.extended.includes(v));
}
export const vlanOfVni = (c: EvCfg, vni: number) => Object.entries(c.vlans).find(([, v]) => v.vni === vni)?.[0];
export function evCompute(c: EvConfig, fdb: EvFdb): EvView {
  const ospf: Record<string, boolean> = Object.fromEntries(EV_LINKS.map((l) => [l.id, !!c[l.a].ospf[l.ai] && !!c[l.b].ospf[l.bi]]));
  const reach = Object.fromEntries(EV_ROUTERS.map((r) => [r, {} as Record<string, boolean>])) as EvView["reach"];
  for (const r of EV_ROUTERS)
    for (const t of EV_ROUTERS) {
      if (r === t) {
        reach[r][EV_LO[t]] = true;
        continue;
      }
      // Star topology through SPINE1: every link on the path needs an adjacency, and the target must advertise lo0.
      const path = r === "SPINE1" || t === "SPINE1" ? [[r, t]] : [[r, "SPINE1"], ["SPINE1", t]];
      const links = path.map(([x, y]) => EV_LINKS.find((l) => (l.a === x && l.b === y) || (l.b === x && l.a === y))!);
      reach[r][EV_LO[t]] = links.every((l) => ospf[l.id]) && c[t].ospfLo;
    }
  const b1 = c.LEAF1.bgp;
  const b2 = c.LEAF2.bgp;
  const up = b1?.nbr === EV_LO.LEAF2 && b2?.nbr === EV_LO.LEAF1 && reach.LEAF1[EV_LO.LEAF2] && reach.LEAF2[EV_LO.LEAF1];
  const bgp = { up: !!up, evpn: !!up && !!b1?.evpn && !!b2?.evpn };
  const adv: EvRoute[] = [];
  for (const l of EV_LEAVES) {
    const cf = c[l];
    const vnis = localVnis(cf);
    if (!cf.rd) continue;
    for (const vni of vnis) {
      const rt = cf.evpn!.targets[vni];
      if (!rt) continue;
      adv.push({ type: 3, leaf: l, rd: cf.rd, vni, rt, nh: EV_LO[l] });
      const vl = vlanOfVni(cf, vni)!;
      for (const m of fdb[l].filter((x) => x.vlan === vl)) {
        adv.push({ type: 2, leaf: l, rd: cf.rd, vni, rt, nh: EV_LO[l], mac: m.mac });
        if (m.ip) adv.push({ type: 2, leaf: l, rd: cf.rd, vni, rt, nh: EV_LO[l], mac: m.mac, ip: m.ip });
      }
    }
  }
  const received = { LEAF1: [] as EvRoute[], LEAF2: [] as EvRoute[] };
  const kept = { LEAF1: [] as EvRoute[], LEAF2: [] as EvRoute[] };
  const usable = { LEAF1: [] as EvRoute[], LEAF2: [] as EvRoute[] };
  if (bgp.evpn)
    for (const l of EV_LEAVES) {
      const targets = new Set(Object.values(c[l].evpn?.targets ?? {}));
      const mine = localVnis(c[l]);
      received[l] = adv.filter((r) => r.leaf === OTHER[l]);
      kept[l] = received[l].filter((r) => targets.has(r.rt));
      usable[l] = kept[l].filter((r) => mine.includes(r.vni) && c[l].evpn!.targets[r.vni] === r.rt);
    }
  return { ospf, reach, bgp, adv, received, kept, usable };
}
/** The MAC table a leaf forwards with: local MACs, then remote ones from usable Type 2 routes. */
export function macTable(c: EvConfig, v: EvView, fdb: EvFdb, l: EvLeaf): { mac: string; vlan: string; where: string; remote?: string; ip?: string }[] {
  const out: { mac: string; vlan: string; where: string; remote?: string; ip?: string }[] = fdb[l].map((m) => ({ mac: m.mac, vlan: m.vlan, where: `${m.port}.0`, ip: m.ip }));
  for (const r of v.usable[l].filter((x) => x.type === 2 && !x.ip)) {
    const vl = vlanOfVni(c[l], r.vni);
    if (vl && !out.some((x) => x.mac === r.mac && x.vlan === vl)) out.push({ mac: r.mac!, vlan: vl, where: "vtep.32769", remote: r.nh, ip: v.usable[l].find((y) => y.type === 2 && y.mac === r.mac && y.ip)?.ip });
  }
  return out;
}
export const remoteVteps = (v: EvView, l: EvLeaf, vni: number) => v.usable[l].filter((r) => r.type === 3 && r.vni === vni).map((r) => r.nh);
/** Why a leaf has no remote VTEP for a VNI, read from the control plane. */
export function whyNoVtep(c: EvConfig, v: EvView, l: EvLeaf, vni: number): string {
  const o = OTHER[l];
  if (!v.reach[l][EV_LO[o]]) return `${l} can't even reach ${EV_LO[o]} over the underlay, so there is no BGP session`;
  if (!v.bgp.up) return "the BGP session to the other leaf is down";
  if (!v.bgp.evpn) return "the BGP session doesn't carry family evpn";
  const t3 = v.received[l].filter((r) => r.type === 3);
  if (!t3.length) return `${o} advertises no Type 3 route`;
  const k = v.kept[l].filter((r) => r.type === 3);
  if (!k.length) return `${l} drops ${o}'s Type 3 route: route target ${t3[0].rt}, but ${l} imports ${c[l].evpn?.targets[vni] ?? "nothing"} for VNI ${vni}`;
  return `${o}'s Type 3 route is for VNI ${k.map((r) => r.vni).join(", ")}, not VNI ${vni}`;
}

// ---------------------------------------------------------------------------------------------------------------
// The data plane
// ---------------------------------------------------------------------------------------------------------------
export interface EvHop {
  from: string;
  to: string;
  label: string;
  note: string;
  vxlan?: boolean;
}
interface Delivery {
  hops: EvHop[];
  reached: EvHost[];
  flooded: boolean;
  drops: string[];
}
interface Frame {
  src: EvHost;
  dstMac: string;
  what: string;
  /** ARP carries the sender's IP: the leaf learns the MAC/IP binding. */
  arp?: boolean;
}
function sendFrame(c: EvConfig, fdb: EvFdb, f: Frame, clock: number): Delivery {
  const out: Delivery = { hops: [], reached: [], flooded: false, drops: [] };
  const h = HOSTS[f.src];
  const l = h.leaf;
  out.hops.push({ from: f.src, to: l, label: "frame", note: `${f.src} sends ${f.what} (to ${f.dstMac === BCAST ? "broadcast" : f.dstMac}) — an ordinary untagged frame on ${h.port}` });
  const vl = c[l].ports[h.port]?.vlan;
  if (!vl || !c[l].vlans[vl]) {
    out.drops.push(`${l}: ${h.port} isn't an access port in any VLAN — the frame is dropped`);
    return out;
  }
  // Learn the source locally (the Type 2 route follows from the table).
  fdb[l] = [...fdb[l].filter((m) => m.mac !== h.mac), { mac: h.mac, ip: f.arp ? h.ip : fdb[l].find((m) => m.mac === h.mac)?.ip, port: h.port, vlan: vl, t: clock }];
  const v = evCompute(c, fdb);
  const vni = c[l].vlans[vl].vni;
  const deliverLocal = (leaf: EvLeaf, vlan: string, exceptPort?: EvIf) => {
    for (const x of hostIfs(leaf)) {
      if (x.port === exceptPort || c[leaf].ports[x.port]?.vlan !== vlan) continue;
      out.hops.push({ from: leaf, to: x.host, label: "frame", note: `${leaf}: out of ${x.port} (VLAN ${vlan})` });
      if (f.dstMac === BCAST || f.dstMac === x.mac) out.reached.push(x.host);
    }
  };
  const encapTo = (from: EvLeaf, vtep: string, vniX: number, why: string) => {
    const to = EV_LEAVES.find((x) => EV_LO[x] === vtep)!;
    out.hops.push({ from, to: "SPINE1", label: `VXLAN ${vniX}`, vxlan: true, note: `${from}: ${why} → VXLAN encapsulation: outer ${EV_LO[from]} → ${vtep}, UDP 4789, VNI ${vniX}` });
    const v2 = evCompute(c, fdb);
    if (!v2.reach[from][vtep]) {
      out.drops.push(`${from} has no underlay route to ${vtep} — the VXLAN packet can't be sent`);
      return;
    }
    out.hops.push({ from: "SPINE1", to, label: `VXLAN ${vniX}`, vxlan: true, note: `SPINE1: routes on the outer destination ${vtep} (OSPF) — it never looks inside` });
    const tvl = vlanOfVni(c[to], vniX);
    if (!tvl || !localVnis(c[to]).includes(vniX)) {
      out.drops.push(`${to} receives VNI ${vniX}, which it doesn't have — the frame is dropped`);
      return;
    }
    out.hops.push({ from: to, to, label: "decap", note: `${to}: decapsulates, VNI ${vniX} → VLAN ${tvl}` });
    const known = f.dstMac === BCAST ? undefined : fdb[to].find((m) => m.mac === f.dstMac && m.vlan === tvl);
    if (known) {
      out.hops.push({ from: to, to, label: "frame", note: `${to}: ${f.dstMac} is local on ${known.port} → that port` });
      const t = hostIfs(to).find((x) => x.port === known.port);
      if (t) {
        out.hops.push({ from: to, to: t.host, label: "frame", note: `${to}: out of ${t.port}` });
        out.reached.push(t.host);
      }
      return;
    }
    // Frames from the fabric never go back into the fabric: flood to local ports only.
    out.flooded = true;
    out.hops.push({ from: to, to, label: "frame", note: `${to}: ${f.dstMac === BCAST ? "broadcast" : `${f.dstMac} unknown`} → its local ports in VLAN ${tvl} only (never back into the fabric)` });
    deliverLocal(to, tvl);
  };
  const table = macTable(c, v, fdb, l);
  const hit = f.dstMac === BCAST ? undefined : table.find((m) => m.mac === f.dstMac && m.vlan === vl);
  if (hit) {
    if (!hit.remote) {
      out.hops.push({ from: l, to: l, label: "frame", note: `${l}: ${f.dstMac} is local on ${hit.where} → switched locally, nothing enters the fabric` });
      const t = hostIfs(l).find((x) => `${x.port}.0` === hit.where);
      if (t && t.host !== f.src) {
        out.hops.push({ from: l, to: t.host, label: "frame", note: `${l}: out of ${t.port}` });
        out.reached.push(t.host);
      }
      return out;
    }
    encapTo(l, hit.remote, vni!, `${f.dstMac} is behind VTEP ${hit.remote} (EVPN Type 2)`);
    return out;
  }
  out.flooded = true;
  const rv = vni !== undefined && localVnis(c[l]).includes(vni) ? remoteVteps(v, l, vni) : [];
  out.hops.push({ from: l, to: l, label: "frame", note: `${l}: ${f.dstMac === BCAST ? "broadcast" : `${f.dstMac} unknown`} → local ports in VLAN ${vl}${vni === undefined ? " (VLAN not mapped to a VNI: it stays on this leaf)" : rv.length ? ` + one copy per remote VTEP of VNI ${vni}: ${rv.join(", ")} (ingress replication)` : ` — no remote VTEP for VNI ${vni} (no Type 3 route imported)`}` });
  deliverLocal(l, vl, h.port);
  for (const vt of rv) encapTo(l, vt, vni!, "flood copy");
  if (vni !== undefined && !rv.length && localVnis(c[l]).includes(vni)) out.drops.push(`${l} knows no remote VTEP for VNI ${vni} — ${whyNoVtep(c, v, l, vni)} — so the flood never leaves ${l}`);
  if (vni === undefined) out.drops.push(`${l}: VLAN ${vl} isn't mapped to a VNI — its frames never leave ${l}`);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------------------------------------------
export interface EvSnap {
  view: EvView;
  fdb: EvFdb;
}
export interface EvTest {
  id: number;
  from: EvHost;
  dst: string;
  ok: boolean;
  reached?: EvHost;
  why?: string;
  flooded: boolean;
  /** Did any frame cross the fabric? */
  crossed: boolean;
  path: string[];
  cfgSeq: number;
  t: number;
}
export interface EvSys {
  t: number;
  dev: EvR;
  kind: "commit" | "ospf-up" | "ospf-down" | "bgp-up" | "bgp-down" | "clear";
  peer?: string;
}
export interface EvState extends SpBase<EvSnap> {
  cfg: EvConfig;
  hist: Record<EvR, EvCfg[]>;
  view: EvView;
  fdb: EvFdb;
  arp: Record<EvHost, Record<string, string>>;
  sys: EvSys[];
  tests: EvTest[];
  wiped?: boolean;
  cleared?: number;
}
export type EvAction =
  | { type: "cfg"; dev: EvR; cfg: EvCfg; text: string }
  | { type: "set"; changes: { dev: EvR; f: (c: EvCfg) => void }[]; text: string }
  | { type: "test"; from: EvHost; dst: string }
  | { type: "clear"; dev?: EvLeaf }
  | { type: "ticket"; id: EvTicketId }
  | { type: "wipe-leaf2" };

const cl = (o: EvState): EvState => ({ ...spClone(o), runs: o.runs, last: o.last });
const emptyFdb = (): EvFdb => ({ LEAF1: [], LEAF2: [] });
export function createEvNet(seq = 0): EvState {
  const cfg = evHealthy();
  const fdb = emptyFdb();
  const view = evCompute(cfg, fdb);
  const s: EvState = { seq, cfgSeq: 0, clock: 3600, runs: [], log: [{ seq, t: 3600, text: "OSPF is up between the leaves and the spine; LEAF1 and LEAF2 have an iBGP EVPN session between their loopbacks and have exchanged their Type 3 routes for VNI 10010. The hosts haven't sent anything yet: no MAC is known anywhere.", tone: "info" }], cfg, hist: { LEAF1: [], SPINE1: [], LEAF2: [] }, view, fdb, arp: { "HOST-A": {}, "HOST-C": {}, "HOST-E": {}, "HOST-B": {}, "HOST-F": {} }, sys: [], tests: [] };
  for (const l of EV_LINKS) s.sys.push({ t: 15, dev: l.a, kind: "ospf-up", peer: EV_LO[l.b] }, { t: 15, dev: l.b, kind: "ospf-up", peer: EV_LO[l.a] });
  s.sys.push({ t: 25, dev: "LEAF1", kind: "bgp-up", peer: EV_LO.LEAF2 }, { t: 25, dev: "LEAF2", kind: "bgp-up", peer: EV_LO.LEAF1 });
  return s;
}
export function evTest(s0: EvState, from: EvHost, dst: string): EvState {
  const s = cl(s0);
  s.clock += 2;
  const snap = () => ({ view: spClone(evCompute(s.cfg, s.fdb)), fdb: spClone(s.fdb) });
  const moments: SpMoment<EvSnap>[] = [];
  const target = EV_HOSTS.find((x) => HOSTS[x].ip === dst);
  let flooded = false;
  let crossed = false;
  let why: string | undefined;
  const path: string[] = [from];
  const leg = (d: Delivery, color: string) => {
    for (const h of d.hops) {
      if (h.from !== h.to) path.push(h.to);
      if (h.vxlan) crossed = true;
      moments.push({ tokens: h.from !== h.to ? [{ from: h.from, to: h.to, label: h.label, color: h.vxlan ? "violet" : color }] : [], lines: [{ text: h.note, tone: h.vxlan ? "learn" : "info" }], snap: snap() });
    }
    for (const x of d.drops) moments.push({ tokens: [], lines: [{ text: x, tone: "warn" }], snap: snap() });
    if (d.flooded) flooded = true;
  };
  const send = (src: EvHost, dstMac: string, what: string, color: string, want: EvHost, arp?: boolean) => {
    const d = sendFrame(s.cfg, s.fdb, { src, dstMac, what, arp }, s.clock);
    s.view = evCompute(s.cfg, s.fdb);
    leg(d, color);
    if (!d.reached.includes(want)) {
      const w = HOSTS[want];
      const wv = s.cfg[w.leaf].ports[w.port]?.vlan;
      const sv = s.cfg[HOSTS[src].leaf].ports[HOSTS[src].port]?.vlan;
      const portWhy = wv !== (w.subnet === "10.10.10" ? "V10" : "V20") ? `${want}'s port ${w.port} on ${w.leaf} is in ${wv ?? "no VLAN"}` : sv && wv && HOSTS[want].leaf === HOSTS[src].leaf && wv !== sv ? `${want}'s port isn't in the same VLAN` : undefined;
      why ??= `${what} never reaches ${want}: ${portWhy ?? (d.drops.length ? d.drops[d.drops.length - 1] : "it is delivered nowhere")}`;
    }
    return d.reached.includes(want);
  };
  let ok = false;
  if (!target || target === from) why = `nobody on the fabric has ${dst}`;
  else if (HOSTS[target].subnet !== HOSTS[from].subnet) why = `${dst} is in another subnet; ${from} would need a gateway, and this lesson's fabric only bridges (routing between VNIs comes with IRB)`;
  else {
    let mac = s.arp[from][dst];
    let step = true;
    if (!mac) {
      step = send(from, BCAST, `an ARP request for ${dst}`, "amber", target, true);
      if (step) {
        s.arp[target][HOSTS[from].ip] = HOSTS[from].mac;
        step = send(target, HOSTS[from].mac, "the ARP reply", "amber", from, true);
        if (step) mac = s.arp[from][dst] = HOSTS[target].mac;
      }
    }
    if (step && mac) step = send(from, mac, "an ICMP echo request", "green", target);
    if (step) {
      s.arp[target][HOSTS[from].ip] ??= HOSTS[from].mac;
      step = send(target, HOSTS[from].mac, "the echo reply", "green", from);
    }
    ok = step;
    if (ok) why = undefined;
  }
  s.view = evCompute(s.cfg, s.fdb);
  if (ok) moments.push({ tokens: [], lines: [{ text: `${from} ↔ ${dst} (${target}): success${crossed ? " — across the fabric" : " — switched locally on the leaf"}${flooded ? ", part of it flooded" : ""}.`, tone: "ok" }], snap: snap() });
  else moments.push({ tokens: [], lines: [{ text: why ?? "failed", tone: "bad" }], snap: snap() });
  const t: EvTest = { id: s.tests.length + 1, from, dst, ok, reached: ok ? target : undefined, why, flooded, crossed, path, cfgSeq: s.cfgSeq, t: s.clock };
  s.tests = [...s.tests, t].slice(-40);
  const run: SpRun<EvSnap> = { id: s.runs.length + 1 + s.seq * 1000, cmd: `ping ${dst} from ${from}`, kind: "test", moments, ok };
  s.runs = [...s.runs, run];
  s.last = run;
  s.log = [...s.log, { seq: s.seq, t: s.clock, text: `ping ${dst} from ${from}: ${ok ? `success (${target})${crossed ? "" : ", local"}` : why}`, tone: ok ? "ok" : "warn" }];
  return s;
}

function converge(prev: EvState, s: EvState, why: string, show = true): EvState {
  // MACs on ports that left their VLAN (or VLANs that vanished) are flushed.
  for (const l of EV_LEAVES) s.fdb[l] = s.fdb[l].filter((m) => s.cfg[l].ports[m.port]?.vlan === m.vlan && !!s.cfg[l].vlans[m.vlan]);
  const view = evCompute(s.cfg, s.fdb);
  s.view = view;
  const snap = { view: spClone(view), fdb: spClone(s.fdb) };
  const moments: SpMoment<EvSnap>[] = [];
  for (const l of EV_LINKS)
    if (prev.view.ospf[l.id] !== view.ospf[l.id]) {
      moments.push({ tokens: view.ospf[l.id] ? [{ from: l.a, to: l.b, label: "OSPF", color: "cyan" }] : [], lines: [{ text: `OSPF ${l.a}–${l.b} ${view.ospf[l.id] ? "Full" : "goes down"}.`, tone: view.ospf[l.id] ? "ok" : "bad" }], snap });
      s.sys.push({ t: s.clock, dev: l.a, kind: view.ospf[l.id] ? "ospf-up" : "ospf-down", peer: EV_LO[l.b] }, { t: s.clock, dev: l.b, kind: view.ospf[l.id] ? "ospf-up" : "ospf-down", peer: EV_LO[l.a] });
    }
  if (prev.view.bgp.up !== view.bgp.up) {
    moments.push({ tokens: view.bgp.up ? [{ from: "LEAF1", to: "LEAF2", label: "BGP", color: "amber" }] : [], lines: [{ text: `LEAF1 ↔ LEAF2: BGP session ${view.bgp.up ? "Established" : "goes down"}.`, tone: view.bgp.up ? "ok" : "bad" }], snap });
    s.sys.push({ t: s.clock, dev: "LEAF1", kind: view.bgp.up ? "bgp-up" : "bgp-down", peer: EV_LO.LEAF2 }, { t: s.clock, dev: "LEAF2", kind: view.bgp.up ? "bgp-up" : "bgp-down", peer: EV_LO.LEAF1 });
  }
  const lines: { text: string; tone: "ok" | "bad" | "warn" }[] = [];
  for (const l of EV_LEAVES) {
    const was = new Set(prev.view.usable[l].map(routeKey));
    const now = new Set(view.usable[l].map(routeKey));
    const added = view.usable[l].filter((r) => !was.has(routeKey(r)) && (r.type === 3 || !r.ip));
    const gone = prev.view.usable[l].filter((r) => !now.has(routeKey(r)) && (r.type === 3 || !r.ip));
    for (const r of added) lines.push({ text: `${l} imports ${r.type === 3 ? `the Type 3 route of ${r.nh} for VNI ${r.vni}: ${r.nh} joins its flood list` : `${r.mac} behind ${r.nh} (Type 2, VNI ${r.vni})`}.`, tone: "ok" });
    for (const r of gone) lines.push({ text: `${l} loses ${r.type === 3 ? `${r.nh}'s Type 3 route for VNI ${r.vni}` : `${r.mac} behind ${r.nh}`}.`, tone: "bad" });
  }
  if (lines.length) moments.push({ tokens: [], lines: lines.slice(0, 10), snap });
  if (show && moments.length) {
    const run: SpRun<EvSnap> = { id: s.runs.length + 1 + s.seq * 1000, cmd: why, kind: "converge", moments };
    s.runs = [...s.runs, run];
    s.last = run;
  }
  return s;
}

// ---------------------------------------------------------------------------------------------------------------
// Tickets
// ---------------------------------------------------------------------------------------------------------------
export type EvTicketId = "rt" | "vni" | "family" | "underlay" | "access";
export interface EvTicketDef {
  id: EvTicketId;
  title: string;
  report: string;
  reproLabel: string;
  repro: EvAction[];
  fault: (c: EvConfig) => void;
}
const ping = (from: EvHost, dst: string): EvAction => ({ type: "test", from, dst });
export const EV_TICKETS: EvTicketDef[] = [
  {
    id: "rt",
    title: "HOST-A can't reach HOST-B",
    report: "“HOST-A can't reach HOST-B. LEAF1's access port is up, the underlay is converged, LEAF1 pings LEAF2's VTEP loopback, and the BGP EVPN session shows Established.”",
    reproLabel: "ping 10.10.10.22 from HOST-A",
    repro: [ping("HOST-A", "10.10.10.22")],
    fault: (c) => {
      c.LEAF1.evpn!.targets[10010] = "65000:99999";
    },
  },
  {
    id: "vni",
    title: "LEAF2 rebuilt from a template",
    report: "“LEAF2's overlay configuration was regenerated from a template. HOST-B reaches nobody across the fabric; LEAF2's EVPN routes still arrive at LEAF1.”",
    reproLabel: "ping 10.10.10.11 from HOST-B",
    repro: [ping("HOST-B", "10.10.10.11")],
    fault: (c) => {
      c.LEAF2.vlans.V10.vni = 10011;
      c.LEAF2.evpn = { vxlan: true, extended: [10011], targets: { 10011: RT10 } };
    },
  },
  {
    id: "family",
    title: "Established, but empty",
    report: "“After a BGP clean-up on LEAF2, nothing crosses the fabric. The LEAF1 ↔ LEAF2 session is Established and the underlay is fine.”",
    reproLabel: "ping 10.10.10.22 from HOST-A",
    repro: [ping("HOST-A", "10.10.10.22")],
    fault: (c) => {
      c.LEAF2.bgp!.evpn = false;
    },
  },
  {
    id: "underlay",
    title: "Everything down after an OSPF change",
    report: "“After an OSPF change on LEAF2, the BGP EVPN session is down and HOST-B reaches nobody across the fabric. The leaf–spine links are up.”",
    reproLabel: "ping 10.10.10.22 from HOST-A",
    repro: [ping("HOST-A", "10.10.10.22")],
    fault: (c) => {
      c.LEAF2.ospfLo = false;
    },
  },
  {
    id: "access",
    title: "HOST-B was re-patched",
    report: "“HOST-B was re-patched during maintenance and now reaches nobody. LEAF2's EVPN routes for HOST-B have disappeared from LEAF1.”",
    reproLabel: "ping 10.10.10.22 from HOST-A",
    repro: [ping("HOST-A", "10.10.10.22")],
    fault: (c) => {
      c.LEAF2.ports["xe-0/0/1"] = { vlan: "V20" };
    },
  },
];
export const evTicket = (id: string) => EV_TICKETS.find((t) => t.id === id)!;
export function evTicketState(id: EvTicketId, seq = 0): EvState {
  const s = createEvNet(seq);
  const nx = cl(s);
  evTicket(id).fault(nx.cfg);
  const out = converge(s, nx, "", false);
  out.ticket = id;
  out.runs = [];
  out.last = undefined;
  out.log = [...out.log, { seq, t: out.clock, text: `Ticket opened: ${evTicket(id).title}.`, tone: "warn" }];
  return out;
}

export function evApply(s0: EvState, a: EvAction): EvState {
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
      return evTest(s0, a.from, a.dst);
    case "clear": {
      const s = cl(s0);
      s.clock += 1;
      for (const l of a.dev ? [a.dev] : EV_LEAVES) s.fdb[l] = [];
      for (const h of EV_HOSTS) s.arp[h] = {};
      s.cleared = s.clock;
      s.sys.push({ t: s.clock, dev: a.dev ?? "LEAF1", kind: "clear" });
      s.log = [...s.log, { seq: s.seq, t: s.clock, text: `${a.dev ? `${a.dev}'s` : "Both leaves'"} locally learned MACs cleared — their Type 2 routes are withdrawn (and the hosts' ARP caches aged out).`, tone: "info" }];
      return converge(s0, s, "MAC tables cleared");
    }
    case "ticket":
      return evTicketState(a.id, s0.seq + 1);
    case "wipe-leaf2": {
      const s = cl(s0);
      s.cfg.LEAF2.evpn = undefined;
      s.cfg.LEAF2.bgp = undefined;
      s.cfg.LEAF2.vtep = false;
      s.cfg.LEAF2.rd = undefined;
      for (const v of Object.values(s.cfg.LEAF2.vlans)) v.vni = undefined;
      s.wiped = true;
      s.cfgSeq += 1;
      s.clock += 1;
      s.log = [...s.log, { seq: s.seq, t: s.clock, text: "LEAF2's overlay was deleted: protocols evpn, the BGP group, switch-options and the VLAN-to-VNI mappings are gone. Interfaces, VLANs and OSPF are untouched.", tone: "warn" }];
      return converge(s0, s, "LEAF2 loses its overlay configuration");
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Diagnosis, proofs, ladder
// ---------------------------------------------------------------------------------------------------------------
export const EV_CAUSES: { id: string; label: string }[] = [
  { id: "rt", label: "A leaf's route target for the VNI doesn't match" },
  { id: "vni", label: "The VLAN is mapped to a different VNI on one leaf" },
  { id: "family", label: "The EVPN address family isn't negotiated on the BGP session" },
  { id: "underlay", label: "A VTEP loopback isn't reachable over the underlay" },
  { id: "access", label: "A host's access port is in the wrong VLAN" },
  { id: "spine", label: "The spine doesn't know the hosts' MAC addresses" },
  { id: "mtu", label: "VXLAN's extra 50 bytes exceed the fabric MTU" },
];
const lastTest = (s: EvState) => s.tests[s.tests.length - 1];
export function evCauseFeedback(s: EvState, cause: string): { right: boolean; text: string } {
  const t = s.ticket as EvTicketId | undefined;
  if (cause === t) {
    const txt: Record<EvTicketId, string> = {
      rt: "Yes. LEAF1's VNI 10010 now uses route target 65000:99999. LEAF2 still exports 65000:10010, and LEAF1 drops those routes — Type 3 included, so LEAF2 isn't even in LEAF1's flood list; and LEAF2 drops LEAF1's routes with the odd target. The session and the underlay are fine; the policy isn't.",
      vni: "Yes. LEAF2's template mapped V10 to VNI 10011. Its routes still carry route target 65000:10010, so LEAF1 keeps them — but for a VNI it doesn't have. And LEAF1's VXLAN packets for VNI 10010 arrive at a leaf that has no VNI 10010. VLAN numbers are local; the VNI must match fabric-wide.",
      family: "Yes. LEAF2's BGP group lost family evpn signaling. The session comes up on plain inet, and not a single EVPN route — Type 2 or Type 3 — is exchanged. Without Type 3 there is no flood list; without Type 2 no remote MAC.",
      underlay: "Yes. LEAF2's lo0.0 is no longer in OSPF, so nobody can reach 10.255.0.2 — LEAF2's VTEP address and its BGP source. The session drops, the routes go with it, and VXLAN packets toward 10.255.0.2 would have no route anyway. Fix the underlay first; everything above it depends on it.",
      access: "Yes. HOST-B's port on LEAF2 is now in V20. HOST-B's frames land in VLAN 20, which isn't mapped to VNI 10010 — and LEAF2 learns HOST-B there, so its Type 2 route for VNI 10010 is withdrawn. The fabric is fine; the access edge isn't.",
    };
    return { right: true, text: txt[t] };
  }
  const lt = lastTest(s);
  switch (cause) {
    case "spine":
      return { right: false, text: "The spine never knows tenant MACs — it routes on the outer IP header. That is by design, never a fault." };
    case "mtu":
      return { right: false, text: "The fabric links carry jumbo frames here; ARP and pings are small anyway. The evidence points elsewhere." };
    case "rt":
      return { right: false, text: "Both leaves use route target 65000:10010 for VNI 10010." };
    case "vni":
      return { right: false, text: "VLAN V10 maps to VNI 10010 on both leaves." };
    case "family":
      return { right: false, text: "The session negotiates family evpn signaling on both sides." };
    case "underlay":
      return { right: false, text: "Both VTEP loopbacks are in OSPF and reachable." };
    case "access":
      return { right: false, text: "Every host's port is in its VLAN." };
  }
  return { right: false, text: lt ? "That doesn't match the evidence." : "Run the user's test first." };
}
const overlayOk = (s: EvState) => s.view.bgp.evpn && EV_LEAVES.every((l) => s.view.usable[l].some((r) => r.type === 3 && r.vni === 10010));
export function evProofs(s: EvState): { label: string; ok: boolean; detail: string }[] {
  const t = s.ticket as EvTicketId | undefined;
  if (!t) return [];
  const fresh = s.tests.filter((x) => x.cfgSeq === s.cfgSeq);
  const p0 = evTicket(t).repro[0] as { from: EvHost; dst: string };
  const proof = { label: `A fresh ping ${p0.dst} from ${p0.from} succeeds`, ok: fresh.some((x) => x.from === p0.from && x.dst === p0.dst && x.ok), detail: "run the test again after the fix" };
  switch (t) {
    case "rt":
      return [{ label: "Both leaves import each other's VNI 10010 routes", ok: s.cfg.LEAF1.evpn?.targets[10010] === RT10 && overlayOk(s), detail: "show route table bgp.evpn.0 on LEAF1" }, proof];
    case "vni":
      return [{ label: "V10 maps to VNI 10010 on LEAF2, extended and targeted", ok: s.cfg.LEAF2.vlans.V10?.vni === 10010 && overlayOk(s), detail: "show configuration vlans on LEAF2" }, proof];
    case "family":
      return [{ label: "The session carries family evpn", ok: s.view.bgp.evpn, detail: "show bgp summary on LEAF2" }, proof];
    case "underlay":
      return [{ label: "LEAF1 reaches 10.255.0.2 over OSPF and the session is up", ok: s.view.reach.LEAF1[EV_LO.LEAF2] && s.view.bgp.up, detail: "show route 10.255.0.2 on LEAF1" }, proof];
    case "access":
      return [{ label: "HOST-B's port is in V10 again", ok: s.cfg.LEAF2.ports["xe-0/0/1"]?.vlan === "V10", detail: "show ethernet-switching interface xe-0/0/1 on LEAF2" }, proof];
  }
}
export function evLadder(s: EvState): { k: string; title: string; text: string }[] {
  const t = lastTest(s);
  const v = s.view;
  const access = EV_HOSTS.filter((h) => {
    const d = HOSTS[h];
    const want = d.subnet === "10.10.10" ? "V10" : "V20";
    return s.cfg[d.leaf].ports[d.port]?.vlan !== want;
  }).map((h) => `${HOSTS[h].leaf}: ${h}'s port ${HOSTS[h].port} is in ${s.cfg[HOSTS[h].leaf].ports[HOSTS[h].port]?.vlan ?? "no VLAN"}`);
  const under = EV_LEAVES.filter((l) => !v.reach[OTHER[l]][EV_LO[l]]).map((l) => `${OTHER[l]} can't reach ${EV_LO[l]} (${l}'s VTEP)`);
  const bgp = !v.bgp.up ? "The LEAF1 ↔ LEAF2 session is down." : !v.bgp.evpn ? "Established, but family evpn isn't negotiated: no EVPN routes." : "";
  const map = EV_LEAVES.filter((l) => s.cfg[l].vlans.V10?.vni !== 10010 || !localVnis(s.cfg[l]).includes(10010)).map((l) => `${l}: V10 → VNI ${s.cfg[l].vlans.V10?.vni ?? "none"}${s.cfg[l].evpn?.extended.includes(10010) ? "" : ", 10010 not in extended-vni-list"}`);
  const imp = v.bgp.evpn ? EV_LEAVES.filter((l) => !v.usable[l].some((r) => r.type === 3 && r.vni === 10010)).map((l) => `${l} has no usable Type 3 route for VNI 10010 from ${OTHER[l]} (${v.received[l].length} received, ${v.kept[l].length} kept)`) : [];
  return [
    { k: "test", title: "What did the test show?", text: t ? `ping ${t.dst} from ${t.from}: ${t.ok ? `success (${t.reached})` : t.why}.` : "Run the user's test first." },
    { k: "access", title: "Is every host's port in the right VLAN?", text: access.join(" · ") || "Yes." },
    { k: "underlay", title: "Can each VTEP reach the other over the underlay?", text: under.join(" · ") || "Yes: both loopbacks in OSPF." },
    { k: "bgp", title: "Is the EVPN session up with family evpn?", text: bgp || "Yes." },
    { k: "vni", title: "Does V10 map to VNI 10010 on both leaves?", text: map.join(" · ") || "Yes." },
    { k: "import", title: "Has each leaf imported the other's routes for VNI 10010?", text: imp.join(" · ") || (v.bgp.evpn ? "Yes: each knows the other as a remote VTEP." : "Not until the session carries EVPN.") },
  ];
}
