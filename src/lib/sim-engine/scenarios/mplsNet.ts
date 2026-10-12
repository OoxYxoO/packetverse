import { spClone, type SpBase, type SpLine, type SpMoment, type SpRun, type SpTok } from "@/components/sp-lab/spKit";

/**
 * MPLS + LDP Lab network — a BGP-free provider core that carries customer traffic on labels.
 *
 *                 P1 ─────── P2                    top path: metric 10 per link
 *               ╱  │           ╲                   bottom path: metric 20 per link
 *   CE1 ── PE1     │ (rung)     PE2 ── CE2         P1–P3 rung: cabled, no IS-IS / LDP yet
 *  10.1.1.10    ╲  │           ╱    10.2.2.20
 *                 P3 ─────── P4
 *
 * Loopbacks (LDP router IDs and transport addresses): PE1 1.1.1.1 · P1 2.2.2.2 · P2 3.3.3.3 · PE2 4.4.4.4 · P3 5.5.5.5 ·
 * P4 6.6.6.6 — the same routers and addresses as the guided lesson; P3 and P4 add a backup path. The IGP is IS-IS
 * Level 2 (the previous lesson). The PEs learned each other's customer prefix by iBGP between loopbacks
 * (10.2.2.0/24 via 4.4.4.4 on PE1, 10.1.1.0/24 via 1.1.1.1 on PE2); the P routers run no BGP at all.
 *
 * Modeled (RFC 3031, RFC 3032, RFC 5036 LDP, RFC 5443 LDP-IGP sync):
 * - IGP: IS-IS adjacency on a core link when it is up and both ends run IS-IS there; SPF with outgoing metrics
 *   (a link whose LDP session is down advertises the maximum metric where LDP-IGP synchronization is configured).
 * - LDP discovery: Hellos (UDP 646 to 224.0.0.2) on interfaces where LDP is enabled (Junos: protocols ldp + protocols
 *   mpls interface + family mpls on the unit). A discovery adjacency needs Hellos heard in both directions.
 * - LDP session: TCP 646 between the two transport addresses (the loopbacks). It needs a discovery adjacency AND an
 *   IGP route to the neighbor's transport address in both directions.
 * - Labels: downstream unsolicited, liberal retention. Each LDP router allocates labels for /32 loopback FECs (IOS XR:
 *   `label local allocate for host-routes`, the Junos default) and advertises implicit-null (3) — or explicit-null (0)
 *   if configured — for its own loopback. Every binding heard from every session peer is kept in the LIB.
 * - Label control follows the OS the lab is showing (all six routers run the same OS):
 *     IOS XR · independent control: a router labels every FEC in its routing table at once. If the IGP next hop gave
 *       no binding, the LFIB entry is "Unlabelled": the label is removed and the packet forwarded as plain IP.
 *       Labels come from 24000 upward.
 *     Junos · ordered control: a router advertises a label for a FEC only when it is the egress or already has a
 *       label from its IGP next hop; no outgoing label → no LFIB entry at all. BGP next hops must resolve in inet.3
 *       (the LDP table), so without an LSP the ingress PE has no usable route. Labels come from 299776 upward.
 * - Data plane: PE ingress pushes the label for the BGP next hop (customer traffic). Router-originated traffic to a
 *   loopback travels as plain IP (the Junos default; IOS XR would label it too — reachability is the same).
 *   TTL propagation on; PHP; each hop checks MTU (+4 bytes per label).
 * - LSP ping / traceroute (RFC 8029): follow the labeled path for one FEC and report where it stops being labeled.
 */

export type MpR = "PE1" | "P1" | "P2" | "PE2" | "P3" | "P4";
export type MpCe = "CE1" | "CE2";
export type MpDev = MpR | MpCe;
export const MP_ROUTERS: MpR[] = ["PE1", "P1", "P2", "PE2", "P3", "P4"];
export const MP_LO: Record<MpR, string> = { PE1: "1.1.1.1", P1: "2.2.2.2", P2: "3.3.3.3", PE2: "4.4.4.4", P3: "5.5.5.5", P4: "6.6.6.6" };
export const CE_IP: Record<MpCe, string> = { CE1: "10.1.1.10", CE2: "10.2.2.20" };
export const CE_NET: Record<MpCe, { net: string; pe: MpR; peIp: string }> = { CE1: { net: "10.1.1.0", pe: "PE1", peIp: "10.1.1.1" }, CE2: { net: "10.2.2.0", pe: "PE2", peIp: "10.2.2.1" } };
/** The order FECs were learned — fixes each router's label numbering. */
const FEC_ORDER = ["1.1.1.1", "4.4.4.4", "2.2.2.2", "3.3.3.3", "5.5.5.5", "6.6.6.6"];
export const IMPLICIT_NULL = 3;
export const EXPLICIT_NULL = 0;
export const MAX_METRIC = 16777214;
export const CORE_MTU = 9216;
export type IfName = "ge-0/0/0" | "ge-0/0/1" | "ge-0/0/2";

export interface MpLink {
  id: string;
  a: MpR;
  ai: IfName;
  aip: string;
  b: MpR;
  bi: IfName;
  bip: string;
  net: string;
  metric: number;
}
export const MP_LINKS: MpLink[] = [
  { id: "PE1-P1", a: "PE1", ai: "ge-0/0/0", aip: "192.0.2.0", b: "P1", bi: "ge-0/0/0", bip: "192.0.2.1", net: "192.0.2.0", metric: 10 },
  { id: "P1-P2", a: "P1", ai: "ge-0/0/1", aip: "192.0.2.2", b: "P2", bi: "ge-0/0/0", bip: "192.0.2.3", net: "192.0.2.2", metric: 10 },
  { id: "P2-PE2", a: "P2", ai: "ge-0/0/1", aip: "192.0.2.4", b: "PE2", bi: "ge-0/0/0", bip: "192.0.2.5", net: "192.0.2.4", metric: 10 },
  { id: "PE1-P3", a: "PE1", ai: "ge-0/0/1", aip: "192.0.2.6", b: "P3", bi: "ge-0/0/0", bip: "192.0.2.7", net: "192.0.2.6", metric: 20 },
  { id: "P3-P4", a: "P3", ai: "ge-0/0/1", aip: "192.0.2.8", b: "P4", bi: "ge-0/0/0", bip: "192.0.2.9", net: "192.0.2.8", metric: 20 },
  { id: "P4-PE2", a: "P4", ai: "ge-0/0/1", aip: "192.0.2.10", b: "PE2", bi: "ge-0/0/1", bip: "192.0.2.11", net: "192.0.2.10", metric: 20 },
  { id: "P1-P3", a: "P1", ai: "ge-0/0/2", aip: "192.0.2.12", b: "P3", bi: "ge-0/0/2", bip: "192.0.2.13", net: "192.0.2.12", metric: 10 },
];
export interface MpIfInfo {
  r: MpR;
  ifn: IfName;
  ip: string;
  peer: MpR;
  peerIf: IfName;
  peerIp: string;
  link: MpLink;
}
export function mpIfs(r: MpR): MpIfInfo[] {
  return MP_LINKS.flatMap((l) => (l.a === r ? [{ r, ifn: l.ai, ip: l.aip, peer: l.b, peerIf: l.bi, peerIp: l.bip, link: l }] : l.b === r ? [{ r, ifn: l.bi, ip: l.bip, peer: l.a, peerIf: l.ai, peerIp: l.aip, link: l }] : [])).sort((x, y) => x.ifn.localeCompare(y.ifn));
}
export const mpIf = (r: MpR, ifn: string) => mpIfs(r).find((i) => i.ifn === ifn);
export const mpIfTo = (r: MpR, peer: MpR) => mpIfs(r).find((i) => i.peer === peer);
/** The customer-facing interface of a PE (not part of the core model). */
export const CE_IF: IfName = "ge-0/0/2";
export const ceOf = (r: MpR): MpCe | undefined => (r === "PE1" ? "CE1" : r === "PE2" ? "CE2" : undefined);
export const linkOf = (id: string) => MP_LINKS.find((l) => l.id === id)!;

// ---------------------------------------------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------------------------------------------
export interface MpIf {
  isis: boolean;
  metric: number;
  /** LDP enabled on the interface (IOS XR `mpls ldp → interface`, Junos `protocols ldp interface`). */
  ldp: boolean;
  /** Junos `protocols mpls interface`. */
  mplsIf: boolean;
  /** Junos `family mpls` on unit 0. */
  fam: boolean;
  /** LDP-IGP synchronization on this IS-IS interface. */
  sync: boolean;
  mtu: number;
  shut: boolean;
}
export interface MpRtr {
  /** Loopback0 in IS-IS (passive). */
  lo: boolean;
  /** The LDP process (`mpls ldp` / `protocols ldp`). */
  ldpOn: boolean;
  /** Advertise explicit-null (0) instead of implicit-null (3) for the own loopback. */
  explicitNull: boolean;
  ifs: Partial<Record<IfName, MpIf>>;
}
export type MpCfg = Record<MpR, MpRtr>;
const core = (on: boolean, metric: number): MpIf => ({ isis: on, metric, ldp: on, mplsIf: on, fam: on, sync: false, mtu: CORE_MTU, shut: false });
export function mpHealthy(): MpCfg {
  const c = {} as MpCfg;
  for (const r of MP_ROUTERS) {
    const ifs: Partial<Record<IfName, MpIf>> = {};
    for (const i of mpIfs(r)) ifs[i.ifn] = core(i.link.id !== "P1-P3", i.link.metric);
    c[r] = { lo: true, ldpOn: true, explicitNull: false, ifs };
  }
  return c;
}
/** LDP really runs on the interface: process on, interface in LDP and (Junos) in MPLS with family mpls. */
export const ldpActive = (c: MpCfg, r: MpR, ifn: IfName) => {
  const i = c[r].ifs[ifn];
  return !!i && c[r].ldpOn && i.ldp && i.mplsIf && i.fam && !i.shut;
};
export const linkUp = (s: { phys: Record<string, boolean>; cfg: MpCfg }, l: MpLink) => s.phys[l.id] && !s.cfg[l.a].ifs[l.ai]!.shut && !s.cfg[l.b].ifs[l.bi]!.shut;
export const igpAdj = (s: { phys: Record<string, boolean>; cfg: MpCfg }, l: MpLink) => linkUp(s, l) && s.cfg[l.a].ifs[l.ai]!.isis && s.cfg[l.b].ifs[l.bi]!.isis;

// ---------------------------------------------------------------------------------------------------------------
// Derived state: IGP → LDP discovery and sessions → labels → LFIB
// ---------------------------------------------------------------------------------------------------------------
export interface MpNh {
  nbr: MpR;
  ifn: IfName;
  ip: string;
}
export interface MpIgpRoute {
  p: string;
  len: number;
  metric: number;
  nh: MpNh[];
}
export interface MpSession {
  a: MpR;
  b: MpR;
  /** Discovery heard in both directions on at least one link. */
  disc: boolean;
  /** Each side has an IGP route to the other's transport address. */
  transport: boolean;
  up: boolean;
  since: number;
}
export interface MpView {
  igp: Record<MpR, MpIgpRoute[]>;
  /** Which side hears which: "R|ifn" → the neighbor whose Hellos it receives. */
  hello: Record<string, MpR>;
  sessions: MpSession[];
  /** Local labels: router → FEC → label. */
  local: Record<MpR, Record<string, number>>;
  os: MpOs;
}
export const ipNum = (ip: string) => ip.split(".").reduce((a, o) => a * 256 + Number(o), 0);
export const inPfx = (ip: string, p: string, len: number) => len === 0 || Math.floor(ipNum(ip) / 2 ** (32 - len)) === Math.floor(ipNum(p) / 2 ** (32 - len));
export const sessKey = (a: MpR, b: MpR) => [a, b].sort((x, y) => MP_ROUTERS.indexOf(x) - MP_ROUTERS.indexOf(y)).join("-");
export type MpOs = "xr" | "junos";
export const LABEL_BASE: Record<MpOs, number> = { xr: 24000, junos: 299776 };
export const labelOf = (r: MpR, fec: string, os: MpOs = "xr") => LABEL_BASE[os] + 101 * MP_ROUTERS.indexOf(r) + FEC_ORDER.indexOf(fec);

/** IS-IS SPF over the core with each direction's own metric (max metric where LDP sync says the LSP isn't ready). */
function igpSpf(c: MpCfg, phys: Record<string, boolean>, root: MpR, ldpUp: (l: MpLink) => boolean): MpIgpRoute[] {
  const st = { cfg: c, phys };
  const metric = (r: MpR, i: MpIfInfo) => (c[r].ifs[i.ifn]!.sync && !ldpUp(i.link) ? MAX_METRIC : c[r].ifs[i.ifn]!.metric);
  const dist = new Map<MpR, number>([[root, 0]]);
  const first = new Map<MpR, Map<string, MpNh>>([[root, new Map()]]);
  const done = new Set<MpR>();
  for (;;) {
    let u: MpR | undefined;
    for (const [k, d] of dist) if (!done.has(k) && (u === undefined || d < dist.get(u)!)) u = k;
    if (!u) break;
    done.add(u);
    for (const i of mpIfs(u)) {
      if (!igpAdj(st, i.link)) continue;
      const nd = dist.get(u)! + metric(u, i);
      const via = u === root ? new Map([[i.ifn, { nbr: i.peer, ifn: i.ifn, ip: i.peerIp }]]) : first.get(u)!;
      const cur = dist.get(i.peer);
      if (cur === undefined || nd < cur) {
        dist.set(i.peer, nd);
        first.set(i.peer, new Map(via));
      } else if (nd === cur && !done.has(i.peer)) via.forEach((v, k) => first.get(i.peer)!.set(k, v));
    }
  }
  const out: MpIgpRoute[] = [];
  for (const [r, d] of dist) {
    if (r === root) continue;
    const nh = [...first.get(r)!.values()].sort((a, b) => a.ifn.localeCompare(b.ifn));
    if (c[r].lo) out.push({ p: MP_LO[r], len: 32, metric: d + 10, nh });
    for (const i of mpIfs(r)) {
      if (!c[r].ifs[i.ifn]!.isis || !linkUp(st, i.link)) continue;
      if (mpIfs(root).some((x) => x.link.id === i.link.id)) continue;
      const m = d + c[r].ifs[i.ifn]!.metric;
      const ex = out.find((x) => x.p === i.link.net && x.len === 31);
      if (!ex) out.push({ p: i.link.net, len: 31, metric: m, nh: [...nh] });
      else if (m < ex.metric) Object.assign(ex, { metric: m, nh: [...nh] });
      else if (m === ex.metric) for (const h of nh) if (!ex.nh.some((y) => y.ifn === h.ifn)) ex.nh.push(h);
    }
  }
  return out.sort((a, b) => ipNum(a.p) - ipNum(b.p) || a.len - b.len);
}

export function mpView(c: MpCfg, phys: Record<string, boolean>, prev?: MpView, clock = 0, os: MpOs = "xr"): MpView {
  const st = { cfg: c, phys };
  const hello: Record<string, MpR> = {};
  for (const l of MP_LINKS) {
    if (!linkUp(st, l)) continue;
    if (ldpActive(c, l.a, l.ai) && ldpActive(c, l.b, l.bi)) {
      hello[`${l.a}|${l.ai}`] = l.b;
      hello[`${l.b}|${l.bi}`] = l.a;
    }
  }
  // Sessions depend on IGP reachability; the IGP (with sync) depends on sessions — iterate to a fixed point.
  let sessions: MpSession[] = [];
  let igp = {} as Record<MpR, MpIgpRoute[]>;
  for (let pass = 0; pass < 4; pass++) {
    const upSet = new Set(sessions.filter((x) => x.up).map((x) => sessKey(x.a, x.b)));
    const ldpUpOnLink = (l: MpLink) => upSet.has(sessKey(l.a, l.b)) && !!hello[`${l.a}|${l.ai}`];
    igp = Object.fromEntries(MP_ROUTERS.map((r) => [r, igpSpf(c, phys, r, pass === 0 ? () => true : ldpUpOnLink)])) as Record<MpR, MpIgpRoute[]>;
    const next: MpSession[] = [];
    for (const l of MP_LINKS) {
      const key = sessKey(l.a, l.b);
      if (next.some((x) => sessKey(x.a, x.b) === key)) continue;
      const disc = !!hello[`${l.a}|${l.ai}`] && !!hello[`${l.b}|${l.bi}`];
      if (!disc) continue;
      const reach = (x: MpR, y: MpR) => igp[x].some((rt) => rt.p === MP_LO[y] && rt.len === 32);
      const transport = reach(l.a, l.b) && reach(l.b, l.a);
      const p = prev?.sessions.find((x) => sessKey(x.a, x.b) === key);
      const up = disc && transport;
      next.push({ a: l.a, b: l.b, disc, transport, up, since: p && p.up === up ? p.since : clock });
    }
    const same = JSON.stringify(next.map((x) => [x.a, x.b, x.up])) === JSON.stringify(sessions.map((x) => [x.a, x.b, x.up]));
    sessions = next;
    if (same && pass > 0) break;
  }
  const local = {} as Record<MpR, Record<string, number>>;
  for (const r of MP_ROUTERS) {
    local[r] = {};
    if (!c[r].ldpOn) continue;
    if (c[r].lo) local[r][MP_LO[r]] = c[r].explicitNull ? EXPLICIT_NULL : IMPLICIT_NULL;
    if (os === "xr") for (const rt of igp[r]) if (rt.len === 32) local[r][rt.p] = labelOf(r, rt.p, os);
  }
  if (os === "junos") {
    // Ordered control: labels spread upstream from each egress, one hop at a time, only along IGP next hops.
    const upSet = new Set(sessions.filter((x) => x.up).map((x) => sessKey(x.a, x.b)));
    for (let pass = 0; pass < MP_ROUTERS.length + 1; pass++) {
      let changed = false;
      for (const r of MP_ROUTERS) {
        if (!c[r].ldpOn) continue;
        for (const rt of igp[r]) {
          if (rt.len !== 32 || local[r][rt.p] !== undefined) continue;
          if (rt.nh.some((h) => upSet.has(sessKey(r, h.nbr)) && local[h.nbr][rt.p] !== undefined)) {
            local[r][rt.p] = labelOf(r, rt.p, os);
            changed = true;
          }
        }
      }
      if (!changed) break;
    }
  }
  return { igp, hello, sessions, local, os };
}
export const sessionUp = (v: MpView, a: MpR, b: MpR) => !!v.sessions.find((x) => sessKey(x.a, x.b) === sessKey(a, b))?.up;
/** LIB: every binding this router holds for a FEC — its own and each session peer's. */
export function lib(v: MpView, r: MpR, fec: string): { local?: number; remote: { peer: MpR; label: number }[] } {
  const remote = MP_ROUTERS.filter((p) => p !== r && sessionUp(v, r, p) && v.local[p][fec] !== undefined).map((peer) => ({ peer, label: v.local[peer][fec] }));
  return { local: v.local[r][fec], remote };
}
export type OutLabel = number | "Pop" | "Unlabelled";
export interface LfibEntry {
  fec: string;
  inLabel: number;
  outs: { out: OutLabel; nh: MpNh }[];
}
export function lfib(v: MpView, r: MpR): LfibEntry[] {
  const out: LfibEntry[] = [];
  for (const [fec, inLabel] of Object.entries(v.local[r])) {
    if (fec === MP_LO[r]) continue;
    const rt = v.igp[r].find((x) => x.p === fec && x.len === 32);
    if (!rt) continue;
    const outs = rt.nh.map((nh) => ({ nh, out: outLabel(v, r, nh.nbr, fec) })).filter((o) => v.os === "xr" || o.out !== "Unlabelled");
    if (outs.length) out.push({ fec, inLabel, outs });
  }
  return out.sort((a, b) => a.inLabel - b.inLabel);
}
function outLabel(v: MpView, r: MpR, nbr: MpR, fec: string): OutLabel {
  if (!sessionUp(v, r, nbr)) return "Unlabelled";
  const l = v.local[nbr][fec];
  if (l === undefined) return "Unlabelled";
  return l === IMPLICIT_NULL ? "Pop" : l;
}
/** FTN: how this router labels IP traffic whose next hop is the FEC (ingress). */
export function ftn(v: MpView, r: MpR, fec: string): { out: OutLabel; nh: MpNh }[] {
  const rt = v.igp[r].find((x) => x.p === fec && x.len === 32);
  const outs = rt ? rt.nh.map((nh) => ({ nh, out: outLabel(v, r, nh.nbr, fec) })) : [];
  // Junos: inet.3 only holds LDP routes with a usable label (or Pop toward a directly connected egress).
  return v.os === "junos" ? outs.filter((o) => o.out !== "Unlabelled") : outs;
}

// ---------------------------------------------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------------------------------------------
export interface MpSnap {
  view: MpView;
}
export interface MpSys {
  t: number;
  dev: MpR;
  kind: "ldp-up" | "ldp-down" | "isis-up" | "isis-down" | "commit" | "disc";
  nbr?: MpR;
  ifn?: IfName;
  why?: string;
}
export interface MpHop {
  dev: MpDev;
  inIf?: string;
  outIf?: string;
  /** Labels on the packet as it LEAVES this device toward the next one (top first). */
  labels: number[];
  op?: "push" | "swap" | "pop" | "ip" | "unlabelled" | "deliver";
  ttl: number;
}
export interface MpPath {
  hops: MpHop[];
  result: "ok" | "noroute" | "mtu" | "label" | "ttl";
  at: MpDev;
  why?: string;
}
export type MpTestKind = "ce" | "ping" | "trace" | "lsp" | "lsptrace";
export interface MpTest {
  id: number;
  kind: MpTestKind;
  from: MpDev;
  src: string;
  dst: string;
  size: number;
  fwd: MpPath;
  back?: MpPath;
  ok: boolean;
  cfgSeq: number;
  /** LSP ping: what came back (XR code letter). */
  code?: string;
}
export interface MpCtr {
  pktIn: number;
  pktOut: number;
  labeledIn: number;
  labeledOut: number;
  mtuDrops: number;
  noRoute: number;
}
export interface MpState extends SpBase<MpSnap> {
  cfg: MpCfg;
  hist: Record<MpR, MpRtr[]>;
  phys: Record<string, boolean>;
  view: MpView;
  sys: MpSys[];
  tests: MpTest[];
  ctr: Record<string, MpCtr>;
  wiped?: boolean;
  os: MpOs;
}
export type MpAction =
  | { type: "cfg"; dev: MpR; cfg: MpRtr; text: string }
  | { type: "set"; changes: { dev: MpR; f: (r: MpRtr) => void }[]; text: string }
  | { type: "link"; link: string; up: boolean }
  | { type: "test"; kind: MpTestKind; from: MpDev; dst: string; src?: string; size?: number }
  | { type: "ticket"; id: MpTicketId }
  | { type: "wipe-pe1" }
  | { type: "clear-counters" }
  /** The lab is shown as IOS XR or as Junos: label control and label numbers follow it. */
  | { type: "os"; os: MpOs }
  /** Learn: LDP off everywhere, then switched on: discovery, sessions, label mappings. */
  | { type: "ldp-boot" };

const zero = (): MpCtr => ({ pktIn: 0, pktOut: 0, labeledIn: 0, labeledOut: 0, mtuDrops: 0, noRoute: 0 });
export const ctrKey = (r: MpR, ifn: string) => `${r} ${ifn}`;
const cl = (o: MpState): MpState => ({ ...spClone(o), runs: o.runs, last: o.last });

export function createMpNet(seq = 0, os: MpOs = "xr"): MpState {
  const cfg = mpHealthy();
  const phys = Object.fromEntries(MP_LINKS.map((l) => [l.id, true]));
  const view = mpView(cfg, phys, undefined, 0, os);
  const s: MpState = {
    seq,
    cfgSeq: 0,
    clock: 3600,
    runs: [],
    log: [{ seq, t: 3600, text: "Core converged: IS-IS everywhere, LDP sessions up on every core link (except the P1–P3 rung), labels exchanged.", tone: "info" }],
    cfg,
    hist: Object.fromEntries(MP_ROUTERS.map((r) => [r, []])) as unknown as Record<MpR, MpRtr[]>,
    phys,
    view,
    sys: [],
    tests: [],
    ctr: Object.fromEntries(MP_ROUTERS.flatMap((r) => [...mpIfs(r).map((i) => [ctrKey(r, i.ifn), zero()]), ...(ceOf(r) ? [[ctrKey(r, CE_IF), zero()]] : [])])),
    os,
  };
  for (const x of view.sessions) if (x.up) s.sys.push({ t: 8, dev: x.a, kind: "ldp-up", nbr: x.b }, { t: 8, dev: x.b, kind: "ldp-up", nbr: x.a });
  return s;
}

// ---------------------------------------------------------------------------------------------------------------
// The data plane
// ---------------------------------------------------------------------------------------------------------------
const flowHash = (src: string, dst: string, r: string) => (ipNum(src) * 31 + ipNum(dst) * 17 + r.length * 7 + r.charCodeAt(r.length - 1)) % 9973;
const ownsIp = (r: MpR, ip: string) => MP_LO[r] === ip || mpIfs(r).some((i) => i.ip === ip) || (ceOf(r) && CE_NET[ceOf(r)!].peIp === ip);
export const ownerOf = (ip: string): MpDev | undefined => (ip === CE_IP.CE1 ? "CE1" : ip === CE_IP.CE2 ? "CE2" : MP_ROUTERS.find((r) => ownsIp(r, ip)));
/** BGP routes the PEs learned from each other (iBGP between loopbacks): customer prefix → BGP next hop. */
export function bgpRoute(s: { view: MpView }, r: MpR, dst: string): { p: string; nh: string } | undefined {
  const far: MpCe | undefined = r === "PE1" ? "CE2" : r === "PE2" ? "CE1" : undefined;
  if (!far || !inPfx(dst, CE_NET[far].net, 24)) return undefined;
  const nh = MP_LO[CE_NET[far].pe];
  if (!s.view.igp[r].some((x) => x.p === nh && x.len === 32)) return undefined;
  return { p: `${CE_NET[far].net}/24`, nh };
}
const lpm = (rs: MpIgpRoute[], ip: string) => rs.filter((x) => inPfx(ip, x.p, x.len)).sort((a, b) => b.len - a.len)[0];
const pick = <T>(xs: T[], src: string, dst: string, r: string) => xs[flowHash(src, dst, r) % xs.length];

/**
 * Walk one packet from a device. `labelOnlyFec` = LSP ping: the packet carries the FEC's label stack from the start
 * and must stay labeled until the penultimate hop pops it.
 */
export function walk(s: MpState, from: MpDev, src: string, dst: string, size: number, opts: { lspFec?: string } = {}): MpPath {
  const v = s.view;
  const hops: MpHop[] = [];
  let ttl = 64;
  let labels: number[] = [];
  let dev: MpDev = from;
  let inIf: string | undefined;
  const mtuOk = (r: MpR, ifn: string) => size + labels.length * 4 <= (ifn === CE_IF ? 1500 : s.cfg[r].ifs[ifn as IfName]!.mtu - 14);
  for (let k = 0; k < 20; k++) {
    // Customer edge: hosts with a default route to their PE.
    if (dev === "CE1" || dev === "CE2") {
      if (CE_IP[dev] === dst && k > 0) {
        hops.push({ dev, inIf, labels: [], op: "deliver", ttl });
        return { hops, result: "ok", at: dev };
      }
      hops.push({ dev, inIf, outIf: "eth0", labels: [], op: "ip", ttl });
      inIf = CE_IF;
      dev = CE_NET[dev].pe;
      continue;
    }
    const r = dev;
    // LSP ping is started inside the ingress with the FEC's label already chosen.
    if (k === 0 && opts.lspFec) {
      const f = ftn(v, r, opts.lspFec);
      if (!f.length) {
        hops.push({ dev: r, labels: [], ttl });
        return { hops, result: "noroute", at: r, why: `no route to ${opts.lspFec}` };
      }
      const ch = pick(f, src, dst, r);
      if (ch.out === "Unlabelled") {
        hops.push({ dev: r, outIf: ch.nh.ifn, labels: [], op: "unlabelled", ttl });
        return { hops, result: "label", at: r, why: `${r} has no label from ${ch.nh.nbr} for ${opts.lspFec}` };
      }
      labels = ch.out === "Pop" ? [] : [ch.out];
      hops.push({ dev: r, outIf: ch.nh.ifn, labels: [...labels], op: "push", ttl });
      if (!mtuOk(r, ch.nh.ifn)) return { hops, result: "mtu", at: r, why: `MTU on ${r} ${ch.nh.ifn}` };
      inIf = ch.nh.ifn;
      const i = mpIf(r, ch.nh.ifn)!;
      dev = i.peer;
      inIf = i.peerIf;
      continue;
    }
    if (labels.length) {
      const top = labels[0];
      if (top === EXPLICIT_NULL) labels = labels.slice(1);
      else {
        const e = lfib(v, r).find((x) => x.inLabel === top);
        if (!e) {
          hops.push({ dev: r, inIf, labels, ttl });
          return { hops, result: "label", at: r, why: `${r} has no LFIB entry for label ${top}` };
        }
        const ch = pick(e.outs, src, dst, r);
        ttl -= 1;
        if (ttl <= 0) {
          hops.push({ dev: r, inIf, labels, ttl });
          return { hops, result: "ttl", at: r };
        }
        let op: MpHop["op"] = "swap";
        if (ch.out === "Pop") {
          labels = labels.slice(1);
          op = "pop";
        } else if (ch.out === "Unlabelled") {
          labels = labels.slice(1);
          op = "unlabelled";
          if (opts.lspFec) {
            hops.push({ dev: r, inIf, outIf: ch.nh.ifn, labels, op, ttl });
            return { hops, result: "label", at: r, why: `${r} has no label from ${ch.nh.nbr} for ${opts.lspFec} (unlabeled output interface)` };
          }
        } else labels = [ch.out, ...labels.slice(1)];
        hops.push({ dev: r, inIf, outIf: ch.nh.ifn, labels: [...labels], op, ttl });
        if (!mtuOk(r, ch.nh.ifn)) return { hops, result: "mtu", at: r, why: `${size + labels.length * 4}-byte labeled packet > MTU ${s.cfg[r].ifs[ch.nh.ifn]!.mtu - 14} on ${r} ${ch.nh.ifn}` };
        const i = mpIf(r, ch.nh.ifn)!;
        dev = i.peer;
        inIf = i.peerIf;
        continue;
      }
    }
    // IP lookup.
    if (ownsIp(r, dst) || (opts.lspFec && opts.lspFec === MP_LO[r])) {
      hops.push({ dev: r, inIf, labels: [], op: "deliver", ttl });
      return { hops, result: "ok", at: r };
    }
    const ce = ceOf(r);
    if (ce && inPfx(dst, CE_NET[ce].net, 24)) {
      ttl -= k > 0 ? 1 : 0;
      hops.push({ dev: r, inIf, outIf: CE_IF, labels: [], op: "ip", ttl });
      if (size > 1500) return { hops, result: "mtu", at: r };
      dev = ce;
      inIf = "eth0";
      continue;
    }
    if (k > 0) ttl -= 1;
    const b = bgpRoute(s, r, dst);
    if (b && v.os === "junos" && !ftn(v, r, b.nh).length) {
      hops.push({ dev: r, inIf, labels: [], ttl });
      return { hops, result: "noroute", at: r, why: `${r}'s BGP route ${b.p} is hidden: next hop ${b.nh} doesn't resolve in inet.3 (no LDP LSP)` };
    }
    if (b) {
      const f = ftn(v, r, b.nh);
      const ch = pick(f, src, dst, r);
      if (ch.out === "Unlabelled" || ch.out === "Pop") {
        labels = [];
        hops.push({ dev: r, inIf, outIf: ch.nh.ifn, labels: [], op: "ip", ttl });
      } else {
        labels = [ch.out];
        hops.push({ dev: r, inIf, outIf: ch.nh.ifn, labels: [...labels], op: "push", ttl });
      }
      if (!mtuOk(r, ch.nh.ifn)) return { hops, result: "mtu", at: r, why: `${size + labels.length * 4}-byte packet > MTU ${s.cfg[r].ifs[ch.nh.ifn]!.mtu - 14} on ${r} ${ch.nh.ifn}` };
      const i = mpIf(r, ch.nh.ifn)!;
      dev = i.peer;
      inIf = i.peerIf;
      continue;
    }
    const rt = lpm(v.igp[r], dst);
    const conn = mpIfs(r).find((i) => linkUp(s, i.link) && inPfx(dst, i.link.net, 31));
    if (conn) {
      hops.push({ dev: r, inIf, outIf: conn.ifn, labels: [], op: "ip", ttl });
      if (conn.peerIp === dst) {
        hops.push({ dev: conn.peer, inIf: conn.peerIf, labels: [], op: "deliver", ttl });
        return { hops, result: "ok", at: conn.peer };
      }
      return { hops, result: "noroute", at: r };
    }
    if (!rt) {
      hops.push({ dev: r, inIf, labels: [], ttl });
      return { hops, result: "noroute", at: r, why: `${r} has no route to ${dst}` };
    }
    const nh = pick(rt.nh, src, dst, r);
    hops.push({ dev: r, inIf, outIf: nh.ifn, labels: [], op: "ip", ttl });
    if (!mtuOk(r, nh.ifn)) return { hops, result: "mtu", at: r };
    const i = mpIf(r, nh.ifn)!;
    dev = i.peer;
    inIf = i.peerIf;
  }
  return { hops, result: "ttl", at: dev };
}

// ---------------------------------------------------------------------------------------------------------------
// Changes and the runs that show them
// ---------------------------------------------------------------------------------------------------------------
const tokFor = (labels: number[], ip: string) => (labels.length ? `[${labels.join("|")}] ${ip}` : ip);
function viewSnap(v: MpView): MpSnap {
  return { view: spClone(v) };
}
/** Recompute the control plane after a change and show what LDP and the LFIBs did. */
function converge(prev: MpState, s: MpState, why: string, show = true): MpState {
  const old = prev.view;
  const v = mpView(s.cfg, s.phys, old, s.clock, s.os);
  s.view = v;
  const moments: SpMoment<MpSnap>[] = [];
  // IGP adjacencies.
  const igpChanges: SpLine[] = [];
  for (const l of MP_LINKS) {
    const a = igpAdj(prev, l);
    const b = igpAdj(s, l);
    if (a !== b) {
      igpChanges.push({ text: `IS-IS adjacency ${l.a}–${l.b} ${b ? "Up" : "Down"}${!linkUp(s, l) ? " (link down)" : ""}.`, tone: b ? "ok" : "bad" });
      s.sys.push({ t: s.clock, dev: l.a, kind: b ? "isis-up" : "isis-down", nbr: l.b, ifn: l.ai }, { t: s.clock, dev: l.b, kind: b ? "isis-up" : "isis-down", nbr: l.a, ifn: l.bi });
    }
  }
  if (igpChanges.length) moments.push({ tokens: [], lines: igpChanges, bad: MP_LINKS.filter((l) => !igpAdj(s, l) && igpAdj(prev, l)).map((l) => l.id), snap: viewSnap(v) });
  // LDP sessions.
  const sessLines: SpLine[] = [];
  const toks: SpTok[] = [];
  const hot: string[] = [];
  const bad: string[] = [];
  const keys = new Set([...old.sessions, ...v.sessions].map((x) => sessKey(x.a, x.b)));
  for (const k of keys) {
    const a = old.sessions.find((x) => sessKey(x.a, x.b) === k);
    const b = v.sessions.find((x) => sessKey(x.a, x.b) === k);
    const [ra, rb] = k.split("-") as [MpR, MpR];
    const l = MP_LINKS.find((x) => sessKey(x.a, x.b) === k)!;
    if (!a?.up && b?.up) {
      sessLines.push({ text: `LDP ${ra}–${rb}: Hellos (UDP 646) heard both ways → TCP 646 between ${MP_LO[ra]} and ${MP_LO[rb]} → session Operational.`, tone: "ok" });
      toks.push({ from: ra, to: rb, label: "LDP Hello", color: "cyan", lane: -2.4 }, { from: rb, to: ra, label: "TCP 646 · Init", color: "amber", lane: 2.4 });
      hot.push(l.id);
      s.sys.push({ t: s.clock, dev: ra, kind: "ldp-up", nbr: rb }, { t: s.clock, dev: rb, kind: "ldp-up", nbr: ra });
    } else if (a?.up && !b?.up) {
      const reason = !b ? (!linkUp(s, l) ? "the link is down" : "Hellos are no longer heard in both directions") : !b.transport ? `no IGP route to the neighbor's transport address (${!v.igp[ra].some((x) => x.p === MP_LO[rb]) ? MP_LO[rb] : MP_LO[ra]})` : "the session failed";
      sessLines.push({ text: `LDP ${ra}–${rb} session down: ${reason}. Every label learned from that neighbor is gone from the LFIB.`, tone: "bad" });
      bad.push(l.id);
      s.sys.push({ t: s.clock, dev: ra, kind: "ldp-down", nbr: rb, why: reason }, { t: s.clock, dev: rb, kind: "ldp-down", nbr: ra, why: reason });
    } else if (b && !b.up && (!a || a.disc !== b.disc)) {
      sessLines.push({ text: `LDP ${ra}–${rb}: discovery up but no session — ${!b.transport ? "no route to the neighbor's transport address" : "waiting"}.`, tone: "warn" });
      s.sys.push({ t: s.clock, dev: ra, kind: "disc", nbr: rb, why: "no route to transport address" });
    }
  }
  if (sessLines.length) moments.push({ tokens: toks, lines: sessLines, hot, bad, snap: viewSnap(v) });
  // Label mappings: what changed in the LFIBs (PEs first).
  const lfLines: SpLine[] = [];
  const mapToks: SpTok[] = [];
  for (const r of ["PE1", "PE2", "P1", "P2", "P3", "P4"] as MpR[]) {
    const fa = lfib(old, r);
    const fb = lfib(v, r);
    const fmt = (e?: LfibEntry) => (e ? e.outs.map((o) => `${o.out} → ${o.nh.nbr}`).join(" + ") : "none");
    for (const fec of ["4.4.4.4", "1.1.1.1"]) {
      if (fec === MP_LO[r]) continue;
      const ea = fa.find((x) => x.fec === fec);
      const eb = fb.find((x) => x.fec === fec);
      if (fmt(ea) !== fmt(eb)) {
        lfLines.push({ text: `${r} LFIB ${fec}/32: ${eb ? `in ${eb.inLabel}, out ${fmt(eb)}` : "removed"} (was ${ea ? `out ${fmt(ea)}` : "none"}).`, tone: eb && !eb.outs.some((o) => o.out === "Unlabelled") ? "learn" : "bad" });
        if (eb)
          for (const o of eb.outs)
            if (o.out !== "Unlabelled") mapToks.push({ from: o.nh.nbr, to: r, label: `${fec} = ${o.out === "Pop" ? "imp-null" : o.out}`, color: "violet" });
      }
    }
  }
  if (lfLines.length) moments.push({ tokens: mapToks.slice(0, 8), lines: lfLines.slice(0, 8), snap: viewSnap(v) });
  if (show && moments.length) {
    const run: SpRun<MpSnap> = { id: s.runs.length + 1 + s.seq * 1000, cmd: why, kind: "converge", moments };
    s.runs = [...s.runs, run];
    s.last = run;
  }
  return s;
}

function testRun(s: MpState, t: MpTest): SpRun<MpSnap> {
  const snap = viewSnap(s.view);
  const moments: SpMoment<MpSnap>[] = [];
  const leg = (p: MpPath, back: boolean) => {
    for (let k = 0; k < p.hops.length; k++) {
      const h = p.hops[k];
      const nx = p.hops[k + 1];
      const ipLabel = back ? "reply" : t.kind === "lsp" || t.kind === "lsptrace" ? "LSP echo" : t.kind === "ce" ? `IP ${t.size} B` : "IP";
      if (!nx) {
        if (p.result === "ok") moments.push({ tokens: [], lines: [{ text: `${h.dev}: ${back ? "the reply arrives" : t.kind === "lsp" ? `the FEC ${t.dst} is mine → echo reply (success)` : `${t.dst} is mine → reply`}.`, tone: "ok" }], views: { [h.dev]: { ring: "target" } }, snap });
        else moments.push({ tokens: [], lines: [{ text: `${h.dev}: ${p.why ?? (p.result === "noroute" ? `no route to ${back ? t.src : t.dst}` : p.result)} → dropped.`, tone: "bad" }], views: { [h.dev]: { ring: "bad", bubble: { text: p.result === "mtu" ? "too big" : p.result === "label" ? "unlabeled" : "no route", tone: "bad" } } }, snap });
        break;
      }
      const opText =
        h.op === "push" ? `${h.dev}: ${t.kind === "lsp" ? "LSP ping: " : `${t.dst} → BGP next hop ${t.kind === "ce" ? (back ? MP_LO.PE1 : MP_LO.PE2) : ""} → `}PUSH ${h.labels[0]} toward ${nx.dev}`
          : h.op === "swap" ? `${h.dev}: label ${p.hops[k - 1]?.labels[0]} → SWAP ${h.labels[0]} toward ${nx.dev} (LFIB, no IP lookup)`
            : h.op === "pop" ? `${h.dev}: label ${p.hops[k - 1]?.labels[0]} → POP (implicit-null from ${nx.dev}) — penultimate-hop popping`
              : h.op === "unlabelled" ? `${h.dev}: label ${p.hops[k - 1]?.labels[0]} → outgoing "Unlabelled" (no binding from ${nx.dev}) → label removed, forwarded as plain IP`
                : `${h.dev}: IP lookup ${back ? t.src : t.dst} → ${nx.dev}`;
      const i = MP_LINKS.find((l) => (l.a === h.dev && l.b === nx.dev) || (l.b === h.dev && l.a === nx.dev));
      moments.push({ tokens: [{ from: h.dev, to: nx.dev, label: tokFor(h.labels, ipLabel), color: back ? "amber" : h.labels.length ? "violet" : "green" }], lines: [{ text: opText + ".", tone: h.op === "unlabelled" ? "warn" : "info" }], hot: i ? [i.id] : [], snap });
    }
  };
  leg(t.fwd, false);
  if (t.back) leg(t.back, true);
  const name = t.kind === "ce" ? `ping ${t.dst} from ${t.from} (${t.size} bytes)` : t.kind === "lsp" ? `ping mpls ${t.dst}/32 from ${t.from}` : t.kind === "lsptrace" ? `traceroute mpls ${t.dst}/32 from ${t.from}` : `${t.kind === "trace" ? "traceroute" : "ping"} ${t.dst} from ${t.from}`;
  return { id: s.runs.length + 1 + s.seq * 1000, cmd: name, kind: t.kind, moments, ok: t.ok };
}
export function mpTest(s0: MpState, kind: MpTestKind, from: MpDev, dst: string, src?: string, size = 100): MpState {
  const s = cl(s0);
  s.clock += 2;
  const source = src ?? (from === "CE1" || from === "CE2" ? CE_IP[from] : MP_LO[from as MpR]);
  const lspFec = kind === "lsp" || kind === "lsptrace" ? dst : undefined;
  const fwd = walk(s, from, source, lspFec ? "127.0.0.1" : dst, size, { lspFec });
  let back: MpPath | undefined;
  if (fwd.result === "ok" && !lspFec) back = walk(s, fwd.at, dst, source, size);
  if (fwd.result === "ok" && lspFec) back = walk(s, fwd.at, dst, source, 100);
  const ok = fwd.result === "ok" && back?.result === "ok";
  const code = lspFec ? (ok ? "!" : fwd.result === "label" ? "B" : fwd.result === "noroute" ? "Q" : ".") : undefined;
  const t: MpTest = { id: s.tests.length + 1, kind, from, src: source, dst, size, fwd, back, ok, cfgSeq: s.cfgSeq, code };
  s.tests = [...s.tests, t].slice(-40);
  for (const p of [fwd, back])
    for (const h of p?.hops ?? []) {
      if (h.dev === "CE1" || h.dev === "CE2") continue;
      if (h.outIf && s.ctr[ctrKey(h.dev, h.outIf)]) {
        const c = s.ctr[ctrKey(h.dev, h.outIf)];
        c.pktOut++;
        if (h.labels.length) c.labeledOut++;
      }
      if (h.inIf && s.ctr[ctrKey(h.dev, h.inIf)]) s.ctr[ctrKey(h.dev, h.inIf)].pktIn++;
    }
  if (fwd.result === "mtu" && fwd.at !== "CE1" && fwd.at !== "CE2") {
    const h = fwd.hops[fwd.hops.length - 1];
    if (h.outIf && s.ctr[ctrKey(fwd.at, h.outIf)]) s.ctr[ctrKey(fwd.at, h.outIf)].mtuDrops++;
  }
  if (fwd.result === "noroute" && fwd.at !== "CE1" && fwd.at !== "CE2") {
    const h = fwd.hops[fwd.hops.length - 1];
    if (h.inIf && s.ctr[ctrKey(fwd.at, h.inIf)]) s.ctr[ctrKey(fwd.at, h.inIf)].noRoute++;
  }
  const run = testRun(s, t);
  s.runs = [...s.runs, run];
  s.last = run;
  s.log = [...s.log, { seq: s.seq, t: s.clock, text: `${run.cmd}: ${ok ? "success" : `failed at ${fwd.result === "ok" ? back?.at : fwd.at}${(fwd.result === "ok" ? back?.why : fwd.why) ? ` — ${fwd.result === "ok" ? back?.why : fwd.why}` : ""}`}`, tone: ok ? "ok" : "warn" }];
  return s;
}

// ---------------------------------------------------------------------------------------------------------------
// Tickets
// ---------------------------------------------------------------------------------------------------------------
export type MpTicketId = "ldpif" | "transport" | "mtu" | "oneway" | "backup";
export interface MpTicketDef {
  id: MpTicketId;
  title: string;
  report: string;
  reproLabel: string;
  repro: MpAction[];
  fault: (c: MpCfg, phys: Record<string, boolean>) => void;
}
const ceTest = (size = 100): MpAction => ({ type: "test", kind: "ce", from: "CE1", dst: CE_IP.CE2, size });
export const MP_TICKETS: MpTicketDef[] = [
  {
    id: "ldpif",
    title: "Customers down, loopbacks fine",
    report: "“CE1 can't reach CE2 since this morning's change on P1. The NOC says every core router answers pings on its loopback and IS-IS looks perfect.”",
    reproLabel: "ping CE2 from CE1",
    repro: [ceTest()],
    fault: (c) => {
      c.P1.ifs["ge-0/0/1"]!.ldp = false;
    },
  },
  {
    id: "transport",
    title: "LDP neighbors that never become neighbors",
    report: "“After P2's loopback was ‘cleaned up’ in IS-IS, customer traffic across the top path stopped. P1 says it sees P2's LDP Hellos — but no session ever comes up.”",
    reproLabel: "ping CE2 from CE1",
    repro: [ceTest()],
    fault: (c) => {
      c.P2.lo = false;
    },
  },
  {
    id: "mtu",
    title: "Small works, big doesn't",
    report: "“Since P1–P2 was swapped to a new card, CE1 → CE2 pings work but file transfers hang. Our 1500-byte pings with don't-fragment fail every time.”",
    reproLabel: "ping CE2 from CE1 with 1500-byte packets",
    repro: [ceTest(100), ceTest(1500)],
    fault: (c) => {
      c.P1.ifs["ge-0/0/1"]!.mtu = 1514;
      c.P2.ifs["ge-0/0/0"]!.mtu = 1514;
    },
  },
  {
    id: "oneway",
    title: "PE2 after its maintenance",
    report: "“Since last night's maintenance on PE2, CE1 can't reach CE2. PE2's core links are up, IS-IS is happy, and PE2 answers pings on its loopback.”",
    reproLabel: "ping CE2 from CE1",
    repro: [ceTest()],
    fault: (c) => {
      c.PE2.ldpOn = false;
    },
  },
  {
    id: "backup",
    title: "The backup path that wasn't",
    report: "“The P1–P2 fiber was cut an hour ago. IS-IS moved everything to the P3–P4 path as designed, the loopbacks all answer — but no customer traffic gets through.”",
    reproLabel: "ping CE2 from CE1",
    repro: [ceTest()],
    fault: (c, phys) => {
      phys["P1-P2"] = false;
      c.P3.ifs["ge-0/0/1"]!.ldp = false;
      c.P4.ifs["ge-0/0/0"]!.ldp = false;
    },
  },
];
export const mpTicket = (id: string) => MP_TICKETS.find((t) => t.id === id)!;
export function mpTicketState(id: MpTicketId, seq = 0, os: MpOs = "xr"): MpState {
  const s = createMpNet(seq, os);
  const n = cl(s);
  mpTicket(id).fault(n.cfg, n.phys);
  const out = converge(s, n, "", false);
  out.ticket = id;
  out.runs = [];
  out.last = undefined;
  out.log = [...out.log, { seq, t: out.clock, text: `Ticket opened: ${mpTicket(id).title}.`, tone: "warn" }];
  return out;
}

export function mpApply(s0: MpState, a: MpAction): MpState {
  switch (a.type) {
    case "cfg": {
      const s = cl(s0);
      s.hist = { ...s.hist, [a.dev]: [spClone(s0.cfg[a.dev]), ...s0.hist[a.dev]].slice(0, 5) };
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
    case "link": {
      const s = cl(s0);
      s.phys = { ...s.phys, [a.link]: a.up };
      s.clock += 1;
      s.cfgSeq += 1;
      s.log = [...s.log, { seq: s.seq, t: s.clock, text: `Link ${a.link} ${a.up ? "restored" : "failed"}.`, tone: a.up ? "ok" : "warn" }];
      return converge(s0, s, `Link ${a.link} ${a.up ? "comes back up" : "fails"}`);
    }
    case "test":
      return mpTest(s0, a.kind, a.from, a.dst, a.src, a.size);
    case "ticket":
      return mpTicketState(a.id, s0.seq + 1, s0.os);
    case "os": {
      if (a.os === s0.os) return s0;
      const s = cl(s0);
      s.os = a.os;
      s.view = mpView(s.cfg, s.phys, s0.view, s.clock, a.os);
      return s;
    }
    case "wipe-pe1": {
      const s = cl(s0);
      s.cfg.PE1 = { ...s.cfg.PE1, ldpOn: false, explicitNull: false, ifs: Object.fromEntries(Object.entries(s.cfg.PE1.ifs).map(([k, v]) => [k, { ...v!, ldp: false, mplsIf: false, fam: false, sync: false }])) };
      s.wiped = true;
      s.cfgSeq += 1;
      s.clock += 1;
      s.log = [...s.log, { seq: s.seq, t: s.clock, text: "PE1's MPLS and LDP configuration was removed.", tone: "warn" }];
      return converge(s0, s, "PE1 loses its MPLS / LDP configuration");
    }
    case "clear-counters": {
      const s = cl(s0);
      s.ctr = Object.fromEntries(Object.keys(s.ctr).map((k) => [k, zero()]));
      return s;
    }
    case "ldp-boot": {
      const off = cl(s0);
      for (const r of MP_ROUTERS) off.cfg[r].ldpOn = false;
      off.view = mpView(off.cfg, off.phys, undefined, off.clock, off.os);
      const s = cl(off);
      for (const r of MP_ROUTERS) s.cfg[r].ldpOn = true;
      s.clock += 1;
      s.cfgSeq += 1;
      return bootRun(off, s);
    }
  }
}
/** Learn: LDP comes up from nothing — Hellos, sessions, label mappings flowing upstream, LFIBs. */
function bootRun(off: MpState, s: MpState): MpState {
  const v = mpView(s.cfg, s.phys, off.view, s.clock, s.os);
  s.view = v;
  const empty = viewSnap(off.view);
  const half: MpView = { ...spClone(v), sessions: v.sessions.map((x) => ({ ...x, up: false })) };
  const moments: SpMoment<MpSnap>[] = [];
  const pairs = v.sessions.filter((x) => x.up);
  moments.push({ tokens: pairs.flatMap((x) => [{ from: x.a, to: x.b, label: "Hello", color: "cyan", lane: -2.4 }, { from: x.b, to: x.a, label: "Hello", color: "cyan", lane: 2.4 }]), lines: [{ text: "Every LDP interface sends Hellos (UDP 646, to 224.0.0.2): “I speak LDP, my transport address is my loopback”. Each router now knows its neighbors — discovery only, no labels yet.", tone: "info" }], snap: { view: { ...half, local: empty.view.local } } });
  moments.push({ tokens: pairs.map((x) => ({ from: x.b, to: x.a, label: "TCP 646", color: "amber" })), lines: [{ text: "For each neighbor, the router with the higher transport address opens TCP port 646 to the other's loopback — the route comes from IS-IS. Initialization and Keepalive: the session is Operational.", tone: "info" }], snap: { view: { ...spClone(v), local: empty.view.local } } });
  const fec = "4.4.4.4";
  const order: MpR[][] = [["PE2"], ["P2", "P4"], ["P1", "P3"], ["PE1"]];
  const local = {} as Record<MpR, Record<string, number>>;
  for (const r of MP_ROUTERS) local[r] = {};
  for (const grp of order) {
    const toks: SpTok[] = [];
    const lines: SpLine[] = [];
    for (const r of grp) {
      local[r] = v.local[r];
      const lab = v.local[r][fec];
      for (const p of MP_ROUTERS) if (p !== r && sessionUp(v, r, p)) toks.push({ from: r, to: p, label: `${fec} = ${lab === IMPLICIT_NULL ? "imp-null (3)" : lab}`, color: "violet" });
      lines.push({ text: r === "PE2" ? "PE2 owns 4.4.4.4: it advertises implicit-null (label 3) — “pop the label before you hand it to me”." : `${r} allocates its own label ${lab} for 4.4.4.4/32 and advertises it to every LDP neighbor (downstream unsolicited).`, tone: "learn" });
    }
    moments.push({ tokens: toks, lines, snap: { view: { ...spClone(v), local: spClone(local) } } });
  }
  moments.push({ tokens: [], lines: [{ text: `PE1's LFIB for 4.4.4.4/32: out ${ftn(v, "PE1", fec).map((x) => `${x.out} via ${x.nh.nbr}`).join(", ")} — the binding from the IS-IS next hop. Bindings from other neighbors are kept too (liberal retention), ready if the path changes.`, tone: "ok" }], snap: viewSnap(v) });
  const run: SpRun<MpSnap> = { id: s.runs.length + 1 + s.seq * 1000, cmd: "LDP starts on every router", kind: "converge", moments };
  s.runs = [...s.runs, run];
  s.last = run;
  for (const x of pairs) s.sys.push({ t: s.clock, dev: x.a, kind: "ldp-up", nbr: x.b }, { t: s.clock, dev: x.b, kind: "ldp-up", nbr: x.a });
  return s;
}

// ---------------------------------------------------------------------------------------------------------------
// Diagnosis
// ---------------------------------------------------------------------------------------------------------------
export const MP_CAUSES: { id: string; label: string }[] = [
  { id: "ldpif", label: "LDP is not enabled on a core interface that the IGP uses" },
  { id: "transport", label: "A router's LDP transport address (its loopback) isn't reachable" },
  { id: "mtu", label: "A core link's MTU is too small for labeled packets" },
  { id: "oneway", label: "One PE gives no labels at all (LDP off), so one direction isn't labeled" },
  { id: "backup", label: "LDP was never enabled on the backup path the IGP now uses" },
  { id: "igp", label: "IS-IS lost a route or an adjacency" },
  { id: "bgp", label: "The PEs lost their BGP routes for the customer prefixes" },
  { id: "php", label: "Penultimate-hop popping is broken (the egress PE should receive a label)" },
];
const lastCe = (s: MpState) => [...s.tests].reverse().find((t) => t.kind === "ce");
export function mpCauseFeedback(s: MpState, cause: string): { right: boolean; consequence?: boolean; text: string } {
  const t = s.ticket as MpTicketId | undefined;
  if (cause === t) {
    const xr = s.os === "xr";
    const txt: Record<MpTicketId, string> = {
      ldpif: xr
        ? "Yes. P1's ge-0/0/1 (toward P2) is no longer an LDP interface, so P1 and P2 have no discovery and no session. IS-IS still sends 4.4.4.4 that way, but P1 has no label from P2: its LFIB says Unlabelled, it removes the label and hands P2 a plain IP packet for 10.2.2.20 — and P2, in a BGP-free core, has no route for it."
        : "Yes. P1's ge-0/0/1 (toward P2) is no longer an LDP interface, so P1 and P2 have no session. With ordered label control, P1 can't advertise a label for 4.4.4.4 it never received, so PE1 has no LDP route to 4.4.4.4 in inet.3 — and its BGP route to 10.2.2.0/24 is hidden: PE1 drops CE1's traffic itself.",
      transport: xr
        ? "Yes. P2's loopback 3.3.3.3 is no longer in IS-IS. The LDP Hellos still arrive (they are link-local), but the session is a TCP connection between loopbacks — and P1 has no route to 3.3.3.3. No session, no labels from P2, so P1's LFIB is Unlabelled toward P2."
        : "Yes. P2's loopback 3.3.3.3 is no longer in IS-IS. Hellos still arrive, but the session is TCP between loopbacks and P1 has no route to 3.3.3.3. No session means no label from P2, so (ordered control) none from P1 either: PE1's BGP route to 10.2.2.0/24 can't resolve in inet.3.",
      mtu: "Yes. P1–P2 runs MTU 1514 on both ends (1500 bytes of IP) — fine for IP, but a 1500-byte customer packet plus a 4-byte label is 1504 bytes, and P1 drops it. Small packets fit, big ones don't: core links need room for the label stack.",
      oneway: xr
        ? "Yes. LDP is off on PE2, so PE2 advertises no labels and has none to push. CE1 → CE2 still arrives (P2 removes the label and PE2 routes plain IP to its own CE), but CE2's reply leaves PE2 as plain IP toward 10.1.1.10 — and P2 has no route to a customer prefix. LSPs are one-way: each direction needs its own."
        : "Yes. LDP is off on PE2, so PE2 advertises no label for 4.4.4.4 (nothing upstream gets one either, with ordered control) and has no LDP route back to 1.1.1.1. Both PEs' BGP routes become hidden: neither direction has an LSP.",
      backup: xr
        ? "Yes. LDP was never enabled on P3–P4. While P1–P2 was up nobody noticed; after the cut, IS-IS sends everything over P3–P4, P3 has no label from P4, removes the label and P4 gets plain IP for a customer prefix it can't route."
        : "Yes. LDP was never enabled on P3–P4. After the cut IS-IS sends everything over P3–P4, P3 never gets a label from P4, so with ordered control no label reaches PE1 either: PE1's BGP route to 10.2.2.0/24 can't resolve in inet.3.",
    };
    return { right: true, text: txt[t] };
  }
  const ce = lastCe(s);
  switch (cause) {
    case "igp":
      return { right: false, consequence: t === "transport", text: t === "transport" ? "IS-IS did lose something — 3.3.3.3 — but only P2's loopback, which carries no customer traffic. The question is what that missing route breaks: look at what LDP needs it for." : "IS-IS is healthy: every adjacency is Up and every router has a route to every loopback (show route isis / show isis neighbors)." };
    case "bgp":
      return { right: false, text: "PE1 still has 10.2.2.0/24 via 4.4.4.4 and PE2 10.1.1.0/24 via 1.1.1.1 (show route <prefix>). The routes are there; the problem is how the packets travel to the next hop." };
    case "php":
      return { right: false, text: "Penultimate-hop popping is normal: PE2 asked for it with implicit-null. A plain IP packet arriving at PE2 is exactly what should happen." };
    case "ldpif":
      return { right: false, text: t === "backup" ? "Every interface on the path IS-IS used before the cut runs LDP — but check the path it uses NOW." : "Every core interface IS-IS uses has LDP enabled at both ends (show mpls ldp interface / show ldp interface)." };
    case "transport":
      return { right: false, text: "Every router has an IS-IS route to every loopback, so every transport address is reachable." };
    case "mtu":
      return { right: false, text: ce ? `MTUs match and there's room: the last test was ${ce.size} bytes and didn't hit an MTU drop.` : "Every core link runs a 9216-byte MTU; nothing counts MTU drops." };
    case "oneway":
      return { right: false, text: "Both PEs run LDP and advertise labels for their loopbacks." };
    case "backup":
      return { right: false, text: "The backup path P3–P4 runs LDP end to end." };
  }
  return { right: false, text: "That doesn't match the evidence." };
}
export function mpProofs(s: MpState): { label: string; ok: boolean; detail: string }[] {
  const t = s.ticket as MpTicketId | undefined;
  if (!t) return [];
  const fresh = s.tests.filter((x) => x.cfgSeq === s.cfgSeq);
  const ceOk = (size = 100) => fresh.some((x) => x.kind === "ce" && x.ok && x.size >= size);
  const pe1 = ftn(s.view, "PE1", "4.4.4.4").map((x) => `${x.out} via ${x.nh.nbr}`).join(", ");
  switch (t) {
    case "ldpif":
      return [
        { label: "LDP session P1–P2 Operational", ok: sessionUp(s.view, "P1", "P2"), detail: sessionUp(s.view, "P1", "P2") ? "up" : "no session" },
        { label: "P1's LFIB swaps 4.4.4.4/32 to P2's label", ok: lfib(s.view, "P1").find((e) => e.fec === "4.4.4.4")?.outs.every((o) => typeof o.out === "number") ?? false, detail: lfib(s.view, "P1").find((e) => e.fec === "4.4.4.4")?.outs.map((o) => `${o.out}`).join(", ") ?? "none" },
        { label: "A fresh CE1 → CE2 ping succeeds", ok: ceOk(), detail: "run the test again after the fix" },
      ];
    case "transport":
      return [
        { label: "3.3.3.3/32 is back in IS-IS", ok: s.view.igp.P1.some((x) => x.p === "3.3.3.3"), detail: s.view.igp.P1.some((x) => x.p === "3.3.3.3") ? "P1 has a route" : "P1 has no route to 3.3.3.3" },
        { label: "LDP session P1–P2 Operational", ok: sessionUp(s.view, "P1", "P2"), detail: sessionUp(s.view, "P1", "P2") ? "up" : "discovery only" },
        { label: "A fresh CE1 → CE2 ping succeeds", ok: ceOk(), detail: "run the test again after the fix" },
      ];
    case "mtu":
      return [
        { label: "P1–P2 can carry a 1500-byte packet plus labels", ok: s.cfg.P1.ifs["ge-0/0/1"]!.mtu - 14 >= 1508 && s.cfg.P2.ifs["ge-0/0/0"]!.mtu - 14 >= 1508, detail: `P1 ${s.cfg.P1.ifs["ge-0/0/1"]!.mtu} · P2 ${s.cfg.P2.ifs["ge-0/0/0"]!.mtu} (bytes, including the 14-byte Ethernet header)` },
        { label: "A fresh 1500-byte CE1 → CE2 ping succeeds", ok: ceOk(1500), detail: "run the test again after the fix" },
      ];
    case "oneway":
      return [
        { label: "PE2 runs LDP and has sessions", ok: s.cfg.PE2.ldpOn && sessionUp(s.view, "PE2", "P2"), detail: s.cfg.PE2.ldpOn ? "LDP on" : "LDP off on PE2" },
        { label: "PE2 labels traffic toward 1.1.1.1", ok: ftn(s.view, "PE2", "1.1.1.1").every((x) => typeof x.out === "number"), detail: ftn(s.view, "PE2", "1.1.1.1").map((x) => `${x.out} via ${x.nh.nbr}`).join(", ") || "no route" },
        { label: "A fresh CE1 → CE2 ping succeeds (both directions)", ok: ceOk(), detail: "run the test again after the fix" },
      ];
    case "backup":
      return [
        { label: "LDP session P3–P4 Operational", ok: sessionUp(s.view, "P3", "P4"), detail: sessionUp(s.view, "P3", "P4") ? "up" : "no session" },
        { label: "PE1 labels 4.4.4.4 over the bottom path", ok: !!pe1 && !pe1.includes("Unlabelled"), detail: pe1 || "no route" },
        { label: "A fresh CE1 → CE2 ping succeeds with P1–P2 still down", ok: ceOk() && !s.phys["P1-P2"], detail: s.phys["P1-P2"] ? "repair the LSP, not the fiber: keep P1–P2 down for the proof" : "run the test again after the fix" },
      ];
  }
}
export function mpLadder(s: MpState): { k: string; title: string; text: string }[] {
  const ce = lastCe(s);
  const v = s.view;
  const downSess = MP_LINKS.filter((l) => l.id !== "P1-P3" && igpAdj(s, l) && !sessionUp(v, l.a, l.b));
  const igpAll = MP_ROUTERS.every((r) => MP_ROUTERS.filter((x) => x !== r && s.cfg[x].lo).every((x) => v.igp[r].some((rt) => rt.p === MP_LO[x])));
  const missingLo = MP_ROUTERS.filter((r) => !s.cfg[r].lo);
  return [
    { k: "test", title: "What did the test show, and where did it stop?", text: ce ? `CE1 → CE2 (${ce.size} B): ${ce.ok ? "success" : `failed at ${ce.fwd.result === "ok" ? ce.back?.at : ce.fwd.at}${ce.fwd.result === "ok" ? " on the way back" : ""} — ${(ce.fwd.result === "ok" ? ce.back?.why : ce.fwd.why) ?? (ce.fwd.result === "ok" ? ce.back?.result : ce.fwd.result)}`}.` : "Run the user's test first." },
    { k: "igp", title: "Does the IGP reach every loopback?", text: igpAll ? "Yes: every router has an IS-IS route to every advertised loopback." : `No: ${missingLo.length ? `${missingLo.map((r) => MP_LO[r]).join(", ")} is not advertised in IS-IS` : "some routers lack loopback routes"}.` },
    { k: "ldp", title: "Is there an LDP session on every link the IGP uses?", text: downSess.length ? `IS-IS adjacency but no LDP session on: ${downSess.map((l) => `${l.id}${v.hello[`${l.a}|${l.ai}`] ? " (Hellos heard, no session)" : " (no discovery)"}`).join(", ")}.` : "Yes: every IS-IS link carries an Operational LDP session." },
    { k: "lfib", title: "What do the LFIBs do with 4.4.4.4/32 and 1.1.1.1/32?", text: (["PE1", "P1", "P2", "P3", "P4", "PE2"] as MpR[]).map((r) => {
      const fec = r === "PE2" ? "1.1.1.1" : "4.4.4.4";
      const f = r === "PE1" || r === "PE2" ? ftn(v, r, fec) : lfib(v, r).find((e) => e.fec === fec)?.outs ?? [];
      return `${r} → ${fec}: ${f.map((x) => `${x.out}${x.nh ? ` (${x.nh.nbr})` : ""}`).join(" + ") || "—"}`;
    }).join(" · ") },
    { k: "mtu", title: "Can every core link carry a full-size labeled packet?", text: MP_LINKS.filter((l) => s.cfg[l.a].ifs[l.ai]!.mtu - 14 < 1504 || s.cfg[l.b].ifs[l.bi]!.mtu - 14 < 1504).map((l) => `${l.id}: MTU ${s.cfg[l.a].ifs[l.ai]!.mtu}/${s.cfg[l.b].ifs[l.bi]!.mtu}`).join(", ") || "Yes: every core link has room for 1500 bytes plus labels." },
  ];
}
