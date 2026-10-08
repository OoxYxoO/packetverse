/**
 * Routing Lab network — three routers in a triangle, four hosts, routed packet by packet.
 *
 *   HOST-A 10.10.10.10 ─ R1 ge-0/0/0 10.10.10.1/24
 *   R1 ge-0/0/1 10.0.12.1/30 ── R2 ge-0/0/1 10.0.12.2/30     R2 ge-0/0/0 172.16.50.1/24 ─ SERVER-A .50 · SERVER-B .200
 *   R1 ge-0/0/2 10.0.13.1/30 ── R3 ge-0/0/1 10.0.13.2/30     R3 ge-0/0/0 172.16.60.1/24 ─ SERVER-C .10
 *   R2 ge-0/0/2 10.0.23.1/30 ── R3 ge-0/0/2 10.0.23.2/30
 *
 * The guided lesson's network (HOST-A, R1, R2, SERVER-A/B, transit 10.0.12.0/30) plus R3 and its LAN, so overlapping
 * routes on R1 can really point at different neighbors, a return path can differ from the request path, and a
 * failed link can fall back to a less specific route.
 *
 * Modeled (RFC 1812 forwarding, CIDR):
 * - Connected (and local /32) routes exist only while their interface is up. A point-to-point link is down when either
 *   end is administratively down.
 * - A static route is INSTALLED (active) only when its next hop lies inside an active connected network (next hops are
 *   resolved through connected networks only — the Junos default; this lab does the same for the Cisco view). Discard
 *   routes are always installed. Configured-but-not-installed routes stay in the configuration and are shown as such.
 * - Lookup: every installed route containing the destination; the longest prefix wins (same prefix: connected beats
 *   static). Equal-cost static routes to one prefix are not modeled (the CLI refuses a second next hop).
 * - Forwarding: destination is my own address → I answer. TTL ≤ 1 → drop + ICMP Time Exceeded to the source.
 *   No route → drop + ICMP Destination Unreachable (net, 3/0). Discard → silent drop. Otherwise TTL − 1, resolve the
 *   next hop (the destination itself for a connected route) with ARP on the egress link; nobody answers → drop + ICMP
 *   Host Unreachable (3/1). ICMP errors are never sent about ICMP errors. An ICMP error is routed like any packet.
 * - Hosts: on-link destinations directly, everything else to the default gateway. They answer Echo Requests.
 * - Each router decides alone, for the packet it has right now: a reply is looked up afresh at every router.
 * - ARP caches start empty and fill as next hops are resolved; an interface going down flushes its entries.
 */

export type RnRouter = "R1" | "R2" | "R3";
export type RnHost = "HOST-A" | "SERVER-A" | "SERVER-B" | "SERVER-C";
export type RnDev = RnRouter | RnHost;
export type RnIf = "ge-0/0/0" | "ge-0/0/1" | "ge-0/0/2";
export type RnSeg = "lan-a" | "srv-50" | "srv-60" | "t12" | "t13" | "t23";
export const RN_ROUTERS: RnRouter[] = ["R1", "R2", "R3"];
export const RN_HOSTS: RnHost[] = ["HOST-A", "SERVER-A", "SERVER-B", "SERVER-C"];
export const RN_IFS: RnIf[] = ["ge-0/0/0", "ge-0/0/1", "ge-0/0/2"];
export const isRouter = (d: string): d is RnRouter => d === "R1" || d === "R2" || d === "R3";
/** Which segment each router interface is on. */
export const RN_IF_SEG: Record<RnRouter, Record<RnIf, RnSeg>> = {
  R1: { "ge-0/0/0": "lan-a", "ge-0/0/1": "t12", "ge-0/0/2": "t13" },
  R2: { "ge-0/0/0": "srv-50", "ge-0/0/1": "t12", "ge-0/0/2": "t23" },
  R3: { "ge-0/0/0": "srv-60", "ge-0/0/1": "t13", "ge-0/0/2": "t23" },
};
export const RN_HOST_SEG: Record<RnHost, RnSeg> = { "HOST-A": "lan-a", "SERVER-A": "srv-50", "SERVER-B": "srv-50", "SERVER-C": "srv-60" };
export const RN_SEG_NAME: Record<RnSeg, string> = { "lan-a": "HOST-A LAN", "srv-50": "server LAN", "srv-60": "SERVER-C LAN", t12: "R1–R2 link", t13: "R1–R3 link", t23: "R2–R3 link" };
/** A destination nobody owns: only a default route matches it. */
export const RN_OUTSIDE = "203.0.113.80";
export const RN_TTL = 64;

// ---------------------------------------------------------------------------------------------------------------
// Addresses
// ---------------------------------------------------------------------------------------------------------------
export const ipNum = (ip: string) => ip.split(".").reduce((a, o) => a * 256 + Number(o), 0);
export const numIp = (n: number) => [24, 16, 8, 0].map((s) => Math.floor(n / 2 ** s) % 256).join(".");
export const maskOf = (len: number) => numIp(len === 0 ? 0 : (2 ** 32 - 2 ** (32 - len)));
export const lenOfMask = (mask: string) => {
  const n = ipNum(mask);
  for (let l = 0; l <= 32; l++) if (ipNum(maskOf(l)) === n) return l;
  return -1;
};
export const netOf = (ip: string, len: number) => numIp(len === 0 ? 0 : Math.floor(ipNum(ip) / 2 ** (32 - len)) * 2 ** (32 - len));
export const inPrefix = (ip: string, prefix: string, len: number) => len === 0 || netOf(ip, len) === netOf(prefix, len);
export const validIp = (s: string) => /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(s) && s.split(".").every((o) => Number(o) <= 255);
export const bits = (ip: string) => ip.split(".").map((o) => Number(o).toString(2).padStart(8, "0")).join("");

// ---------------------------------------------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------------------------------------------
export interface RnStatic {
  prefix: string;
  len: number;
  nh?: string;
  discard?: boolean;
}
export interface RnIfCfg {
  addr: string;
  len: number;
  shut: boolean;
}
export interface RnRouterCfg {
  ifs: Record<RnIf, RnIfCfg>;
  statics: RnStatic[];
}
export interface RnHostCfg {
  ip: string;
  len: number;
  gw: string;
  up: boolean;
}
export interface RnCfg {
  r: Record<RnRouter, RnRouterCfg>;
  h: Record<RnHost, RnHostCfg>;
}
const st = (p: string, nh: string): RnStatic => {
  const [prefix, len] = p.split("/");
  return { prefix, len: Number(len), nh };
};
export const RN_HEALTHY_STATICS: Record<RnRouter, RnStatic[]> = {
  R1: [st("172.16.50.0/24", "10.0.12.2"), st("172.16.0.0/16", "10.0.13.2"), st("0.0.0.0/0", "10.0.13.2")],
  R2: [st("10.10.10.0/24", "10.0.12.1"), st("172.16.60.0/24", "10.0.23.2")],
  R3: [st("10.10.10.0/24", "10.0.13.1"), st("172.16.50.0/24", "10.0.23.1")],
};
export function rnHealthy(): RnCfg {
  const ifs = (a: [string, number], b: [string, number], c: [string, number]): Record<RnIf, RnIfCfg> => ({ "ge-0/0/0": { addr: a[0], len: a[1], shut: false }, "ge-0/0/1": { addr: b[0], len: b[1], shut: false }, "ge-0/0/2": { addr: c[0], len: c[1], shut: false } });
  return {
    r: {
      R1: { ifs: ifs(["10.10.10.1", 24], ["10.0.12.1", 30], ["10.0.13.1", 30]), statics: RN_HEALTHY_STATICS.R1.map((x) => ({ ...x })) },
      R2: { ifs: ifs(["172.16.50.1", 24], ["10.0.12.2", 30], ["10.0.23.1", 30]), statics: RN_HEALTHY_STATICS.R2.map((x) => ({ ...x })) },
      R3: { ifs: ifs(["172.16.60.1", 24], ["10.0.13.2", 30], ["10.0.23.2", 30]), statics: RN_HEALTHY_STATICS.R3.map((x) => ({ ...x })) },
    },
    h: {
      "HOST-A": { ip: "10.10.10.10", len: 24, gw: "10.10.10.1", up: true },
      "SERVER-A": { ip: "172.16.50.50", len: 24, gw: "172.16.50.1", up: true },
      "SERVER-B": { ip: "172.16.50.200", len: 24, gw: "172.16.50.1", up: true },
      "SERVER-C": { ip: "172.16.60.10", len: 24, gw: "172.16.60.1", up: true },
    },
  };
}
/** Only connected networks: the Build exercise starts here. */
export function rnConnectedOnly(): RnCfg {
  const c = rnHealthy();
  for (const r of RN_ROUTERS) c.r[r].statics = [];
  return c;
}
export const rnClone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
export const staticKey = (s: RnStatic) => `${netOf(s.prefix, s.len)}/${s.len}`;
export const MAC: Record<string, string> = {
  "R1:ge-0/0/0": "00:00:5e:00:53:11", "R1:ge-0/0/1": "00:00:5e:00:53:12", "R1:ge-0/0/2": "00:00:5e:00:53:13",
  "R2:ge-0/0/0": "00:00:5e:00:53:22", "R2:ge-0/0/1": "00:00:5e:00:53:21", "R2:ge-0/0/2": "00:00:5e:00:53:23",
  "R3:ge-0/0/0": "00:00:5e:00:53:32", "R3:ge-0/0/1": "00:00:5e:00:53:31", "R3:ge-0/0/2": "00:00:5e:00:53:33",
  "HOST-A": "00:00:5e:00:53:10", "SERVER-A": "00:00:5e:00:53:50", "SERVER-B": "00:00:5e:00:53:c8", "SERVER-C": "00:00:5e:00:53:0c",
};

// ---------------------------------------------------------------------------------------------------------------
// Links and the routing table
// ---------------------------------------------------------------------------------------------------------------
/** Router interfaces on a segment. */
const segRouters = (seg: RnSeg) => RN_ROUTERS.flatMap((r) => RN_IFS.filter((i) => RN_IF_SEG[r][i] === seg).map((i) => ({ r, i })));
export function rnIfUp(cfg: RnCfg, r: RnRouter, i: RnIf): boolean {
  if (cfg.r[r].ifs[i].shut) return false;
  const seg = RN_IF_SEG[r][i];
  if (seg.startsWith("t")) return segRouters(seg).every((x) => !cfg.r[x.r].ifs[x.i].shut);
  return true;
}
export const rnIfStatus = (cfg: RnCfg, r: RnRouter, i: RnIf): "up" | "down" | "admin-down" => (cfg.r[r].ifs[i].shut ? "admin-down" : rnIfUp(cfg, r, i) ? "up" : "down");
export const rnPeerOf = (r: RnRouter, i: RnIf): { r: RnRouter; i: RnIf } | undefined => segRouters(RN_IF_SEG[r][i]).find((x) => x.r !== r);

export type RnProto = "connected" | "local" | "static";
export interface RnRoute {
  prefix: string;
  len: number;
  proto: RnProto;
  /** Egress interface (connected/local; static once resolved). */
  iface?: RnIf;
  nh?: string;
  discard?: boolean;
  active: boolean;
  /** Why a configured route is not installed. */
  why?: string;
}
export const routeKeyOf = (r: { prefix: string; len: number }) => `${r.prefix}/${r.len}`;
export function rnRib(cfg: RnCfg, r: RnRouter): RnRoute[] {
  const out: RnRoute[] = [];
  for (const i of RN_IFS) {
    const c = cfg.r[r].ifs[i];
    const up = rnIfUp(cfg, r, i);
    out.push({ prefix: netOf(c.addr, c.len), len: c.len, proto: "connected", iface: i, active: up, why: up ? undefined : `${i} is ${rnIfStatus(cfg, r, i) === "admin-down" ? "administratively down" : "down (the far end is disabled)"}` });
    out.push({ prefix: c.addr, len: 32, proto: "local", iface: i, active: up });
  }
  const connected = out.filter((x) => x.proto === "connected" && x.active);
  for (const s of cfg.r[r].statics) {
    const prefix = netOf(s.prefix, s.len);
    if (s.discard) {
      out.push({ prefix, len: s.len, proto: "static", discard: true, active: true });
      continue;
    }
    const own = RN_IFS.some((i) => cfg.r[r].ifs[i].addr === s.nh);
    const via = own ? undefined : connected.find((c) => inPrefix(s.nh!, c.prefix, c.len));
    out.push({ prefix, len: s.len, proto: "static", nh: s.nh, iface: via?.iface, active: !!via, why: via ? undefined : own ? `the next hop ${s.nh} is this router's own address` : `the next hop ${s.nh} is not inside any up, connected network` });
  }
  return out.sort((a, b) => ipNum(a.prefix) - ipNum(b.prefix) || a.len - b.len || (a.proto === "local" ? 1 : 0) - (b.proto === "local" ? 1 : 0));
}
export interface RnCandidate {
  route: RnRoute;
  matches: boolean;
  /** Leading bits the destination shares with the prefix (proof). */
  common: number;
}
export interface RnLookup {
  router: RnRouter;
  dst: string;
  candidates: RnCandidate[];
  winner?: RnRoute;
}
const commonBits = (a: string, b: string) => {
  const x = bits(a);
  const y = bits(b);
  let n = 0;
  while (n < 32 && x[n] === y[n]) n++;
  return n;
};
/** Longest-prefix match over installed routes. */
export function rnLookup(cfg: RnCfg, r: RnRouter, dst: string): RnLookup {
  const rib = rnRib(cfg, r);
  const candidates = rib.map((route) => ({ route, matches: route.active && inPrefix(dst, route.prefix, route.len), common: commonBits(dst, route.prefix) }));
  const pref = (x: RnRoute) => x.len * 10 + (x.proto === "static" ? 0 : 1);
  const winner = candidates.filter((c) => c.matches).map((c) => c.route).sort((a, b) => pref(b) - pref(a))[0];
  return { router: r, dst, candidates, winner };
}

// ---------------------------------------------------------------------------------------------------------------
// Packets, runs, evidence
// ---------------------------------------------------------------------------------------------------------------
export type RnKind = "echo" | "reply" | "time-exceeded" | "net-unreach" | "host-unreach";
export interface RnPkt {
  id: number;
  kind: RnKind;
  src: string;
  dst: string;
  ttl: number;
  /** Error messages: the packet they are about. */
  about?: { src: string; dst: string; kind: RnKind };
  /** Which test probe/request this belongs to. */
  probe: number;
}
export interface RnHop {
  from: RnDev;
  fromIf: string;
  to: RnDev;
  toIf: string;
  pkt: RnPkt;
}
export type RnOutcome = "forward" | "deliver" | "local" | "discard" | "no-route" | "arp-fail" | "ttl" | "no-gateway";
export interface RnDecision {
  at: RnDev;
  ingress?: string;
  pkt: RnPkt;
  lookup?: RnLookup;
  outcome: RnOutcome;
  nextHop?: string;
  egress?: string;
  arp?: "cached" | "resolved" | "failed";
  /** The ICMP error this router generated. */
  error?: RnPkt;
  text: string;
}
export interface RnSnap {
  arp: Record<RnDev, Record<string, string>>;
  counters: Record<string, { in: number; out: number }>;
}
export interface RnMomentEv {
  hops: RnHop[];
  decisions: RnDecision[];
  snap: RnSnap;
}
export interface RnCap {
  n: number;
  run: number;
  point: string;
  dir: "in" | "out";
  pkt?: RnPkt;
  arp?: { op: "request" | "reply"; who: string; tell: string; mac?: string };
}
export type RnTool = "ping" | "traceroute";
export interface RnProbeResult {
  probe: number;
  ttl: number;
  /** Who answered and with what. */
  from?: string;
  fromDev?: RnDev;
  kind?: RnKind;
  /** Where the request (or its reply) stopped, if it did. */
  stopAt?: RnDev;
  stop?: RnOutcome;
  /** The request reached the destination (even if the answer never came back). */
  arrived: boolean;
  /** Which direction failed. */
  failedLeg?: "request" | "reply" | "error";
}
export interface RnRun {
  id: number;
  tool: RnTool;
  from: RnDev;
  dst: string;
  cmd: string;
  moments: RnMomentEv[];
  probes: RnProbeResult[];
  ok: boolean;
  output: string;
  capFrom: number;
  cfgSeq: number;
}
export interface RnLogLine {
  seq: number;
  text: string;
  tone: "info" | "ok" | "warn";
}
export type RnTicketId = "discard" | "return" | "typo" | "ifdown" | "loop";
export interface RnState {
  cfg: RnCfg;
  arp: Record<RnDev, Record<string, string>>;
  counters: Record<string, { in: number; out: number }>;
  captures: RnCap[];
  capN: number;
  runs: RnRun[];
  last?: RnRun;
  seq: number;
  cfgSeq: number;
  clock: number;
  log: RnLogLine[];
  ticket?: RnTicketId;
  /** Build exercise in progress. */
  build?: boolean;
}
const emptyArp = (): Record<RnDev, Record<string, string>> => ({ R1: {}, R2: {}, R3: {}, "HOST-A": {}, "SERVER-A": {}, "SERVER-B": {}, "SERVER-C": {} });
const emptyCounters = () => {
  const c: Record<string, { in: number; out: number }> = {};
  for (const r of RN_ROUTERS) for (const i of RN_IFS) c[`${r} ${i}`] = { in: 0, out: 0 };
  for (const h of RN_HOSTS) c[h] = { in: 0, out: 0 };
  return c;
};
export function createRouteNet(cfg: RnCfg = rnHealthy()): RnState {
  return { cfg, arp: emptyArp(), counters: emptyCounters(), captures: [], capN: 0, runs: [], seq: 0, cfgSeq: 0, clock: 0, log: [{ seq: 0, text: `Lab ready: R1, R2 and R3 with their connected networks${RN_ROUTERS.some((r) => cfg.r[r].statics.length) ? ` and ${RN_ROUTERS.reduce((a, r) => a + cfg.r[r].statics.length, 0)} static routes` : " only — no static routes yet"}`, tone: "info" }] };
}
export const rnOwner = (cfg: RnCfg, ip: string): { dev: RnDev; i?: RnIf } | undefined => {
  for (const r of RN_ROUTERS) for (const i of RN_IFS) if (cfg.r[r].ifs[i].addr === ip) return { dev: r, i };
  const h = RN_HOSTS.find((x) => cfg.h[x].ip === ip);
  return h ? { dev: h } : undefined;
};
export const rnName = (cfg: RnCfg, ip: string) => {
  const o = rnOwner(cfg, ip);
  return o ? (o.i ? `${o.dev} ${o.i}` : o.dev) : ip === RN_OUTSIDE ? "outside (nobody here)" : ip;
};
/** Who answers ARP for `ip` on `seg` (only devices whose link is up). */
function arpOwner(cfg: RnCfg, seg: RnSeg, ip: string): { dev: RnDev; i?: RnIf } | undefined {
  for (const x of segRouters(seg)) if (cfg.r[x.r].ifs[x.i].addr === ip && rnIfUp(cfg, x.r, x.i)) return { dev: x.r, i: x.i };
  const h = RN_HOSTS.find((y) => RN_HOST_SEG[y] === seg && cfg.h[y].ip === ip && cfg.h[y].up);
  return h ? { dev: h } : undefined;
}
export const kindName: Record<RnKind, string> = { echo: "Echo Request", reply: "Echo Reply", "time-exceeded": "ICMP Time Exceeded", "net-unreach": "ICMP Net Unreachable", "host-unreach": "ICMP Host Unreachable" };
const isError = (k: RnKind) => k === "time-exceeded" || k === "net-unreach" || k === "host-unreach";
const kindOf = (o: RnOutcome): RnKind | undefined => (o === "ttl" ? "time-exceeded" : o === "no-route" ? "net-unreach" : o === "arp-fail" ? "host-unreach" : undefined);

interface Work {
  cfg: RnCfg;
  arp: Record<RnDev, Record<string, string>>;
  counters: Record<string, { in: number; out: number }>;
  captures: RnCap[];
  capN: number;
  run: number;
  pid: number;
}
const cloneArp = (a: Record<RnDev, Record<string, string>>) => rnClone(a);
type Flight = { at: RnDev; ingress?: string; pkt: RnPkt };

/** ARP on a segment: cached, resolved now (request + reply captured), or failed (request captured, nobody answers). */
function resolveArp(w: Work, dev: RnDev, egress: string, seg: RnSeg, ip: string): { owner?: { dev: RnDev; i?: RnIf }; how: "cached" | "resolved" | "failed" } {
  const owner = arpOwner(w.cfg, seg, ip);
  const point = isRouter(dev) ? `${dev} ${egress}` : dev;
  if (w.arp[dev][ip] && w.arp[dev][ip] !== "incomplete" && owner) return { owner, how: "cached" };
  const myIp = isRouter(dev) ? w.cfg.r[dev].ifs[egress as RnIf].addr : w.cfg.h[dev].ip;
  w.captures.push({ n: ++w.capN, run: w.run, point, dir: "out", arp: { op: "request", who: ip, tell: myIp } });
  if (!owner) {
    w.arp[dev][ip] = "incomplete";
    return { how: "failed" };
  }
  const mac = MAC[owner.i ? `${owner.dev} ${owner.i}`.replace(" ", ":") : owner.dev];
  w.arp[dev][ip] = mac;
  w.captures.push({ n: ++w.capN, run: w.run, point, dir: "in", arp: { op: "reply", who: ip, tell: myIp, mac } });
  return { owner, how: "resolved" };
}

/** What one device does with one packet. Returns the next flight (if any) and the decision. */
function process(w: Work, f: Flight, originate: boolean): { d: RnDecision; next?: { hop: RnHop; flight: Flight }; spawn?: RnPkt; deliveredTo?: RnDev } {
  const cfg = w.cfg;
  const p = f.pkt;
  const dev = f.at;
  if (!isRouter(dev)) {
    const h = cfg.h[dev];
    if (!originate) {
      if (p.dst === h.ip) return { d: { at: dev, ingress: "eth0", pkt: p, outcome: "deliver", text: `${dev} receives the ${kindName[p.kind]}${p.kind === "echo" ? " and answers it" : ""}` }, deliveredTo: dev };
      return { d: { at: dev, pkt: p, outcome: "deliver", text: `${dev} ignores a packet for ${p.dst}` } };
    }
    // A host sends: on-link directly, otherwise to its default gateway.
    const onLink = inPrefix(p.dst, h.ip, h.len);
    const target = onLink ? p.dst : h.gw;
    const seg = RN_HOST_SEG[dev];
    if (!h.up) return { d: { at: dev, pkt: p, outcome: "no-gateway", text: `${dev}'s network card is down` } };
    const a = resolveArp(w, dev, "eth0", seg, target);
    if (!a.owner) return { d: { at: dev, pkt: p, outcome: onLink ? "arp-fail" : "no-gateway", nextHop: target, arp: "failed", text: onLink ? `${dev}: ${p.dst} is on its own network, but nobody answers ARP for it` : `${dev}: its gateway ${target} doesn't answer ARP (the router's interface is down?)` } };
    return { d: { at: dev, pkt: p, outcome: "forward", nextHop: target, egress: "eth0", arp: a.how, text: onLink ? `${dev}: ${p.dst} is on-link → sends it directly` : `${dev}: ${p.dst} is not on ${netOf(h.ip, h.len)}/${h.len} → hands it to its gateway ${target}` }, next: { hop: { from: dev, fromIf: "eth0", to: a.owner.dev, toIf: a.owner.i ?? "eth0", pkt: p }, flight: { at: a.owner.dev, ingress: a.owner.i, pkt: p } } };
  }
  const r = dev;
  // Is it for me?
  const mine = RN_IFS.find((i) => cfg.r[r].ifs[i].addr === p.dst && rnIfUp(cfg, r, i));
  if (mine && !originate) return { d: { at: r, ingress: f.ingress, pkt: p, outcome: "local", text: `${p.dst} is ${r}'s own address (${mine}): ${r} ${p.kind === "echo" ? "answers" : "receives it"}` }, deliveredTo: r };
  const lk = rnLookup(cfg, r, p.dst);
  const errSrc = f.ingress ? cfg.r[r].ifs[f.ingress as RnIf].addr : undefined;
  const fail = (outcome: RnOutcome, text: string, extra: Partial<RnDecision> = {}) => {
    const k = kindOf(outcome);
    const err: RnPkt | undefined = k && !isError(p.kind) && errSrc ? { id: ++w.pid, kind: k, src: errSrc, dst: p.src, ttl: 255, about: { src: p.src, dst: p.dst, kind: p.kind }, probe: p.probe } : undefined;
    return { d: { at: r, ingress: f.ingress, pkt: p, lookup: lk, outcome, error: err, text: `${text}${err ? ` → sends ${kindName[err.kind]} to ${p.src}` : outcome === "discard" ? " (silently — a discard route sends nothing back)" : ""}`, ...extra }, spawn: err };
  };
  if (!originate && p.ttl <= 1) return fail("ttl", `${r}: TTL ${p.ttl} would reach 0 → drops it`);
  if (!lk.winner) return fail("no-route", `${r}: no installed route matches ${p.dst} → drops it`);
  const w0 = lk.winner;
  if (w0.discard) return fail("discard", `${r}: best match ${routeKeyOf(w0)} is a DISCARD route → drops it`);
  const nh = w0.proto === "static" ? w0.nh! : p.dst;
  const egress = w0.iface!;
  const seg = RN_IF_SEG[r][egress];
  const a = resolveArp(w, r, egress, seg, nh);
  if (!a.owner) return fail("arp-fail", `${r}: best match ${routeKeyOf(w0)} → out ${egress}, but nobody answers ARP for ${nh}`, { nextHop: nh, egress, arp: "failed" });
  const out: RnPkt = originate ? p : { ...p, ttl: p.ttl - 1 };
  return {
    d: { at: r, ingress: f.ingress, pkt: p, lookup: lk, outcome: "forward", nextHop: nh, egress, arp: a.how, text: `${r}: best match ${routeKeyOf(w0)}${w0.proto === "static" ? ` via ${nh}` : " (connected)"} → out ${egress}${originate ? "" : ` · TTL ${p.ttl} → ${p.ttl - 1}`}` },
    next: { hop: { from: r, fromIf: egress, to: a.owner.dev, toIf: a.owner.i ?? "eth0", pkt: out }, flight: { at: a.owner.dev, ingress: a.owner.i, pkt: out } },
  };
}

const addrOf = (cfg: RnCfg, d: RnDev) => (isRouter(d) ? cfg.r[d].ifs["ge-0/0/0"].addr : cfg.h[d].ip);

/** Send one probe and follow everything it causes (the answer, ICMP errors) until nothing is in flight. */
function probe(w: Work, from: RnDev, dst: string, ttl: number, probeNo: number, moments: RnMomentEv[], srcIp?: string): RnProbeResult {
  const src = srcIp ?? addrOf(w.cfg, from);
  const res: RnProbeResult = { probe: probeNo, ttl, arrived: false };
  let flights: { f: Flight; originate: boolean }[] = [{ f: { at: from, pkt: { id: ++w.pid, kind: "echo", src, dst, ttl, probe: probeNo } }, originate: true }];
  for (let guard = 0; guard < 300 && flights.length; guard++) {
    const m: RnMomentEv = { hops: [], decisions: [], snap: { arp: w.arp, counters: w.counters } };
    const next: { f: Flight; originate: boolean }[] = [];
    let crossed = false;
    for (const { f, originate } of flights) {
      const r = process(w, f, originate);
      m.decisions.push(r.d);
      if (r.deliveredTo) {
        const p = f.pkt;
        if (p.kind === "echo") {
          res.arrived = true;
          next.push({ f: { at: r.deliveredTo, pkt: { id: ++w.pid, kind: "reply", src: p.dst, dst: p.src, ttl: 64, probe: probeNo } }, originate: true });
        } else if (r.deliveredTo === from && p.dst === src) {
          res.kind = p.kind;
          res.from = p.src;
          res.fromDev = rnOwner(w.cfg, p.src)?.dev;
        }
      }
      if (r.spawn) next.push({ f: { at: f.at, pkt: r.spawn }, originate: true });
      if (r.next) {
        const hp = r.next.hop;
        m.hops.push(hp);
        crossed = true;
        w.counters[isRouter(hp.from) ? `${hp.from} ${hp.fromIf}` : hp.from].out++;
        w.counters[isRouter(hp.to) ? `${hp.to} ${hp.toIf}` : hp.to].in++;
        w.captures.push({ n: ++w.capN, run: w.run, point: isRouter(hp.from) ? `${hp.from} ${hp.fromIf}` : hp.from, dir: "out", pkt: hp.pkt });
        w.captures.push({ n: ++w.capN, run: w.run, point: isRouter(hp.to) ? `${hp.to} ${hp.toIf}` : hp.to, dir: "in", pkt: hp.pkt });
        next.push({ f: r.next.flight, originate: false });
      } else if (!r.deliveredTo && r.d.outcome !== "forward") {
        if (!res.stop) {
          res.stop = r.d.outcome;
          res.stopAt = f.at;
          res.failedLeg = f.pkt.kind === "echo" ? "request" : f.pkt.kind === "reply" ? "reply" : "error";
        }
      }
    }
    m.snap = { arp: cloneArp(w.arp), counters: rnClone(w.counters) };
    // A moment is drawn when something crossed a link, or when a device decided something final.
    if (crossed || m.decisions.some((d) => d.outcome !== "forward")) moments.push(m);
    else if (moments.length) {
      const prev = moments[moments.length - 1];
      prev.decisions.push(...m.decisions);
      prev.snap = m.snap;
    } else moments.push(m);
    // Decisions with a hop belong with the hop that follows; keep the order simple: hops of this round move now.
    flights = next;
  }
  return res;
}

export function rnTrace(s0: RnState, from: RnDev, dst: string, tool: RnTool, opts: { count?: number; ttl?: number; source?: string } = {}): RnState {
  const s: RnState = { ...s0, seq: s0.seq + 1, clock: s0.clock + 1 };
  const w: Work = { cfg: s.cfg, arp: cloneArp(s.arp), counters: rnClone(s.counters), captures: [...s.captures], capN: s.capN, run: s.seq, pid: s.seq * 1000 };
  const moments: RnMomentEv[] = [];
  const probes: RnProbeResult[] = [];
  const egressIf = isRouter(from) ? rnLookup(s.cfg, from, dst).winner?.iface : undefined;
  const src = opts.source ?? (isRouter(from) && egressIf ? s.cfg.r[from].ifs[egressIf].addr : addrOf(s.cfg, from));
  const name = (ip?: string) => (ip ? `${ip}${rnOwner(s.cfg, ip) ? ` (${rnName(s.cfg, ip)})` : ""}` : "*");
  let output = "";
  let ok = false;
  if (tool === "ping") {
    const n = opts.count ?? 3;
    const lines: string[] = [];
    for (let k = 0; k < n; k++) {
      const pr = probe(w, from, dst, opts.ttl ?? RN_TTL, k + 1, k === 0 ? moments : [], src);
      probes.push(pr);
      if (pr.kind === "reply") lines.push(`64 bytes from ${dst}: icmp_seq=${k + 1} ttl=${64 - hopsBetween(moments)} time=${(1.2 + k * 0.1).toFixed(1)} ms`);
      else if (pr.kind) lines.push(`From ${pr.from} icmp_seq=${k + 1} ${pr.kind === "time-exceeded" ? "Time to live exceeded" : pr.kind === "net-unreach" ? "Destination Net Unreachable" : "Destination Host Unreachable"}`);
    }
    const rx = probes.filter((x) => x.kind === "reply").length;
    ok = rx === n;
    output = [`PING ${dst} (${dst}) 56(84) bytes of data.`, ...lines, "", `--- ${dst} ping statistics ---`, `${n} packets transmitted, ${rx} received${probes.some((x) => x.kind && x.kind !== "reply") ? `, +${probes.filter((x) => x.kind && x.kind !== "reply").length} errors` : ""}, ${Math.round(((n - rx) / n) * 100)}% packet loss`].join("\n");
  } else {
    const lines = [`traceroute to ${dst} (${dst}), 8 hops max, 60 byte packets`];
    for (let t = 1; t <= 8; t++) {
      const pm: RnMomentEv[] = [];
      const pr = probe(w, from, dst, t, t, pm, src);
      moments.splice(0, moments.length, ...pm);
      probes.push(pr);
      lines.push(`${String(t).padStart(2)}  ${pr.kind ? `${name(pr.from)}  ${(t * 0.6 + 0.4).toFixed(3)} ms${pr.kind === "net-unreach" ? " !N" : pr.kind === "host-unreach" ? " !H" : ""}` : "* * *"}`);
      if (pr.kind === "reply") {
        ok = true;
        break;
      }
      if (pr.kind === "net-unreach" || pr.kind === "host-unreach") break;
      if (!pr.kind && t >= 3 && probes.slice(-3).every((x) => !x.kind)) break;
    }
    output = lines.join("\n");
  }
  const cmd = tool === "ping" ? `${from}: ping ${dst}` : `${from}: traceroute ${dst}`;
  const run: RnRun = { id: s.seq, tool, from, dst, cmd, moments, probes, ok, output, capFrom: s0.capN + 1, cfgSeq: s.cfgSeq };
  const first = probes[0];
  const summary = ok ? `${cmd}: ✓ ${tool === "ping" ? "replies came back" : "reached"}` : `${cmd}: ✕ ${first?.failedLeg === "reply" ? `the request ARRIVED, but the reply stopped at ${first.stopAt} (${first.stop})` : first?.stopAt ? `stopped at ${first.stopAt} (${first.stop})` : "no answer"}`;
  return { ...s, arp: w.arp, counters: w.counters, captures: w.captures.slice(-1200), capN: w.capN, runs: [...s.runs.slice(-30), run], last: run, log: [...s.log, { seq: s.seq, text: summary, tone: ok ? "ok" : "warn" }] };
}
/** Router hops the first echo crossed (for the reply TTL shown by ping). */
function hopsBetween(m: RnMomentEv[]): number {
  return m.flatMap((x) => x.decisions).filter((d) => d.pkt.kind === "reply" && isRouter(d.at) && d.outcome === "forward" && d.ingress).length;
}

// ---------------------------------------------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------------------------------------------
export type RnAction =
  | { type: "ping"; from: RnDev; dst: string; count?: number; source?: string }
  | { type: "traceroute"; from: RnDev; dst: string }
  | { type: "cfg"; cfg: RnCfg; text: string }
  | { type: "clear-arp"; dev: RnDev }
  | { type: "ticket"; id: RnTicketId }
  | { type: "build" }
  | { type: "fresh"; cfg?: RnCfg };

function applyCfg(s: RnState, cfg: RnCfg, text: string): RnState {
  const arp = cloneArp(s.arp);
  const notes: string[] = [];
  for (const r of RN_ROUTERS)
    for (const i of RN_IFS) {
      const was = rnIfUp(s.cfg, r, i);
      const now = rnIfUp(cfg, r, i);
      if (was && !now) {
        const net = netOf(cfg.r[r].ifs[i].addr, cfg.r[r].ifs[i].len);
        for (const ip of Object.keys(arp[r])) if (inPrefix(ip, net, cfg.r[r].ifs[i].len)) delete arp[r][ip];
        notes.push(`${r} ${i} went down: its connected route ${net}/${cfg.r[r].ifs[i].len} is withdrawn, and so is every static route whose next hop was reached through it`);
      } else if (!was && now) notes.push(`${r} ${i} came up: connected route ${netOf(cfg.r[r].ifs[i].addr, cfg.r[r].ifs[i].len)}/${cfg.r[r].ifs[i].len} installed`);
    }
  const seq = s.seq + 1;
  return { ...s, cfg, arp, seq, cfgSeq: s.cfgSeq + 1, clock: s.clock + 1, log: [...s.log, { seq, text, tone: "info" }, ...notes.map((t) => ({ seq, text: t, tone: "warn" as const }))] };
}

export function rnApply(s: RnState, a: RnAction): RnState {
  switch (a.type) {
    case "fresh":
      return { ...createRouteNet(a.cfg ?? rnHealthy()), seq: s.seq + 1 };
    case "build":
      return { ...createRouteNet(rnConnectedOnly()), seq: s.seq + 1, build: true, log: [{ seq: s.seq + 1, text: "Build: R1, R2 and R3 know only their connected networks", tone: "info" }] };
    case "ticket":
      return rnTicketState(a.id, s.seq + 1);
    case "ping":
      return rnTrace(s, a.from, a.dst, "ping", { count: a.count, source: a.source });
    case "traceroute":
      return rnTrace(s, a.from, a.dst, "traceroute");
    case "cfg":
      return applyCfg(s, a.cfg, a.text);
    case "clear-arp": {
      const arp = cloneArp(s.arp);
      arp[a.dev] = {};
      return { ...s, arp, seq: s.seq + 1, log: [...s.log, { seq: s.seq + 1, text: `${a.dev}: ARP cache cleared`, tone: "info" }] };
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Tickets
// ---------------------------------------------------------------------------------------------------------------
export type RnCause = "more-specific-discard" | "missing-return" | "wrong-next-hop" | "inactive-route" | "default-loop" | "missing-forward" | "server-down" | "host-gateway" | "arp-stale";
export const RN_CAUSES: { id: RnCause; label: string }[] = [
  { id: "missing-forward", label: "A router on the way has no route to the destination network" },
  { id: "missing-return", label: "The request arrives, but a router on the way back has no route to the client's network" },
  { id: "more-specific-discard", label: "A more specific route wins the lookup — and discards the packets" },
  { id: "wrong-next-hop", label: "The route's next hop is an address nobody owns, so ARP never resolves" },
  { id: "inactive-route", label: "The route is configured, but not installed: its next hop's link is down" },
  { id: "default-loop", label: "An interface is down and a default route sends the packets back the way they came: a loop" },
  { id: "server-down", label: "The destination host itself is down" },
  { id: "host-gateway", label: "HOST-A's default gateway is wrong" },
  { id: "arp-stale", label: "A stale ARP cache on a router" },
];
export interface RnTicket {
  id: RnTicketId;
  title: string;
  report: string;
  test: { from: RnDev; dst: string; label: string };
  cause: RnCause;
}
export const RN_TICKETS: RnTicket[] = [
  { id: "discard", title: "One server gone", report: "“After last night's change on R1, nobody can reach SERVER-A (172.16.50.50). SERVER-B, on the same LAN, works fine.”", test: { from: "HOST-A", dst: "172.16.50.50", label: "HOST-A pings SERVER-A" }, cause: "more-specific-discard" },
  { id: "return", title: "The server says it replies", report: "“HOST-A can't ping SERVER-A. The server team captured the Echo Requests arriving — and swear they answer every one.”", test: { from: "HOST-A", dst: "172.16.50.50", label: "HOST-A pings SERVER-A" }, cause: "missing-return" },
  { id: "typo", title: "Since this morning's change", report: "“Since a route change on R1 this morning, HOST-A can't reach the server LAN. R2 itself answers pings just fine.”", test: { from: "HOST-A", dst: "172.16.50.200", label: "HOST-A pings SERVER-B" }, cause: "wrong-next-hop" },
  { id: "ifdown", title: "SERVER-C unreachable", report: "“Nobody can reach SERVER-C (172.16.60.10). HOST-A gets ‘Destination Net Unreachable’ straight away. The route on R1 hasn't been touched.”", test: { from: "HOST-A", dst: "172.16.60.10", label: "HOST-A pings SERVER-C" }, cause: "inactive-route" },
  { id: "loop", title: "Pings “die of old age”", report: "“After maintenance on R2, the server LAN is unreachable. Ping says ‘Time to live exceeded’, and traceroute bounces between two addresses.”", test: { from: "HOST-A", dst: "172.16.50.50", label: "HOST-A pings SERVER-A" }, cause: "default-loop" },
];
export const rnTicket = (id: RnTicketId) => RN_TICKETS.find((t) => t.id === id)!;
export function rnTicketCfg(id: RnTicketId): RnCfg {
  const c = rnHealthy();
  if (id === "discard") c.r.R1.statics.push({ prefix: "172.16.50.0", len: 25, discard: true });
  if (id === "return") c.r.R2.statics = c.r.R2.statics.filter((x) => x.prefix !== "10.10.10.0");
  if (id === "typo") c.r.R1.statics = c.r.R1.statics.map((x) => (x.prefix === "172.16.50.0" ? { ...x, nh: "10.0.12.3" } : x));
  if (id === "ifdown") c.r.R3.ifs["ge-0/0/1"].shut = true;
  if (id === "loop") {
    c.r.R2.ifs["ge-0/0/0"].shut = true;
    c.r.R2.statics.push({ prefix: "0.0.0.0", len: 0, nh: "10.0.12.1" });
  }
  return c;
}
export function rnTicketState(id: RnTicketId, seq: number): RnState {
  return { ...createRouteNet(rnTicketCfg(id)), seq, ticket: id, log: [{ seq, text: `Ticket opened: ${rnTicket(id).title}`, tone: "info" }] };
}
export function rnLastTest(s: RnState): RnRun | undefined {
  if (!s.ticket) return undefined;
  const t = rnTicket(s.ticket).test;
  return [...s.runs].reverse().find((r) => r.tool === "ping" && r.from === t.from && r.dst === t.dst);
}
export interface RnProof {
  label: string;
  ok: boolean;
  detail: string;
}
export function rnProofs(s: RnState): RnProof[] {
  if (!s.ticket) return [];
  const t = rnTicket(s.ticket);
  const c = s.cfg;
  const run = rnLastTest(s);
  const fresh = !!run && run.cfgSeq === s.cfgSeq;
  const test: RnProof = { label: `A fresh test: ${t.test.label}, and the replies come back`, ok: !!run && fresh && run.ok, detail: !run ? "not run yet" : !fresh ? "the network changed since the last test — run it again" : run.ok ? "every Echo Reply came back" : run.probes[0]?.failedLeg === "reply" ? `request arrived, reply stopped at ${run.probes[0].stopAt}` : `stopped at ${run.probes[0]?.stopAt ?? "?"} (${run.probes[0]?.stop ?? "no answer"})` };
  const win = (r: RnRouter, ip: string) => rnLookup(c, r, ip).winner;
  switch (s.ticket) {
    case "discard": {
      const w = win("R1", "172.16.50.50");
      return [{ label: "R1's longest match for 172.16.50.50 forwards it (no discard wins)", ok: !!w && !w.discard, detail: w ? `${routeKeyOf(w)}${w.discard ? " discard" : w.nh ? ` via ${w.nh}` : ""}` : "no route" }, test, (() => {
        const b = [...s.runs].reverse().find((r) => r.tool === "ping" && r.from === "HOST-A" && r.dst === "172.16.50.200" && r.cfgSeq === s.cfgSeq);
        return { label: "SERVER-B still works after your change (fresh test)", ok: !!b?.ok, detail: b ? (b.ok ? "replies came back" : "fails") : "ping SERVER-B too" };
      })()];
    }
    case "return": {
      const w = win("R2", "10.10.10.10");
      return [{ label: "R2 has an installed route that covers 10.10.10.10", ok: !!w && !w.discard, detail: w ? `${routeKeyOf(w)}${w.nh ? ` via ${w.nh}` : ""}` : "no route" }, test];
    }
    case "typo": {
      const r1 = c.r.R1.statics.find((x) => x.prefix === "172.16.50.0" && x.len === 24);
      return [{ label: "R1's route to 172.16.50.0/24 points at a next hop that exists", ok: !!r1 && !!r1.nh && !!rnOwner(c, r1.nh) && r1.nh !== "10.0.12.3", detail: r1 ? `via ${r1.nh}${r1.nh && rnOwner(c, r1.nh) ? ` (${rnName(c, r1.nh)})` : " (nobody owns it)"}` : "removed" }, test];
    }
    case "ifdown":
      return [{ label: "R1 has an installed route for 172.16.60.10", ok: !!win("R1", "172.16.60.10"), detail: win("R1", "172.16.60.10") ? routeKeyOf(win("R1", "172.16.60.10")!) : "nothing installed matches" }, test];
    case "loop": {
      const tx = run && fresh ? run.probes.some((p) => p.kind === "time-exceeded") : true;
      return [{ label: "R2 delivers 172.16.50.0/24 itself (its server interface is up)", ok: rnIfUp(c, "R2", "ge-0/0/0"), detail: rnIfStatus(c, "R2", "ge-0/0/0") }, test, { label: "No Time Exceeded in that test", ok: !!run && fresh && !tx, detail: run && fresh ? (tx ? "packets still expire" : "none") : "run the test" }];
    }
  }
}

/** Feedback on a diagnosis, from this network's evidence. */
export function rnCauseFeedback(s: RnState, cause: RnCause): { right: boolean; consequence?: boolean; text: string } {
  const t = s.ticket ? rnTicket(s.ticket) : undefined;
  const right = !!t && t.cause === cause;
  const c = s.cfg;
  const run = rnLastTest(s);
  const p0 = run?.probes[0];
  const w = (r: RnRouter, ip: string) => rnLookup(c, r, ip).winner;
  const rt = (x?: RnRoute) => (x ? `${routeKeyOf(x)}${x.discard ? " (discard)" : x.nh ? ` via ${x.nh}` : " (connected)"}` : "no route");
  const texts: Record<RnCause, string> = {
    "more-specific-discard": right ? "Yes. R1 has 172.16.50.0/25 → discard. 172.16.50.50 falls inside that /25 (25 matching bits beat the /24's 24), so R1 drops it silently. 172.16.50.200 is in the other half (.128–.255): only the /24 matches, and it works." : `R1's best match for the destination is ${rt(w("R1", t?.test.dst ?? "172.16.50.50"))}${c.r.R1.statics.some((x) => x.discard) ? "" : " — R1 has no discard route at all"}.`,
    "missing-return": right ? "Yes. The Echo Request reaches SERVER-A (its capture shows it, and it answers). The reply is a new packet to 10.10.10.10: R2 looks it up — and has no route that covers 10.10.10.0/24 (no default either). It drops the reply and sends Net Unreachable to SERVER-A." : p0?.failedLeg === "reply" ? "The reply is the leg that fails here — but check which router drops it and why." : `The request itself didn't reach its destination${p0?.stopAt ? ` (it stopped at ${p0.stopAt})` : ""}. A return route can't be the first problem.`,
    "wrong-next-hop": right ? "Yes. R1's 172.16.50.0/24 points at 10.0.12.3. That address is inside R1's connected 10.0.12.0/30, so the route is installed — but nobody owns it. R1 sends ARP requests for 10.0.12.3 that nobody answers (show ip arp: Incomplete), drops the packet and returns Host Unreachable." : `${p0?.stop === "arp-fail" ? "An ARP failure is involved — find which address can't be resolved and why it was chosen." : "No ARP resolution failed in the last test."}`,
    "inactive-route": right ? "Yes. R1's 172.16.0.0/16 and default both point at 10.0.13.2 — reached through ge-0/0/2. R3 disabled its end of that link, so R1's connected 10.0.13.0/30 is gone and both routes are configured but NOT installed. Nothing installed matches 172.16.60.10: R1 answers Net Unreachable at once." : `${RN_ROUTERS.flatMap((r) => rnRib(c, r).filter((x) => x.proto === "static" && !x.active).map((x) => `${r} ${routeKeyOf(x)}`)).join(", ") || "Every configured static route is installed"}${RN_ROUTERS.some((r) => rnRib(c, r).some((x) => x.proto === "static" && !x.active)) ? " is not installed — but is that the route this traffic needs?" : "."}`,
    "default-loop": right ? "Yes. R2's ge-0/0/0 is down, so its connected 172.16.50.0/24 is gone. For 172.16.50.50 the only match left on R2 is its new default via 10.0.12.1 — back to R1, whose /24 sends it to R2 again. The packet bounces until its TTL runs out; R1 or R2 returns Time Exceeded." : `${p0?.kind === "time-exceeded" || p0?.stop === "ttl" ? "TTL ran out, so something loops — find the two routers and why each sends it to the other." : "Nothing expired in the last test: no loop."}`,
    "missing-forward": `Read each router's best match for ${t?.test.dst ?? "the destination"}: R1 ${rt(w("R1", t?.test.dst ?? ""))}, R2 ${rt(w("R2", t?.test.dst ?? ""))}, R3 ${rt(w("R3", t?.test.dst ?? ""))}. ${p0?.stop === "no-route" && p0.stopAt ? `${p0.stopAt} really has no usable route — but ask whether one is configured and why it isn't installed.` : "Every router on the path has a route for it."}`,
    "server-down": `Every host's network card is up${run?.probes.some((p) => p.arrived) ? ", and the request did arrive at the destination — it answered" : ""}. The server is not the problem.`,
    "host-gateway": `HOST-A's gateway is ${c.h["HOST-A"].gw} — R1's own ge-0/0/0 address. It ARPs for it and hands every off-link packet to R1, as it should.`,
    "arp-stale": "ARP entries are only learned from real replies, and an interface going down flushes them. A stale entry would still deliver to the old owner — that's not what the evidence shows.",
  };
  // "No route" seen at a router that HAS one configured (not installed) is true — but it's the consequence.
  const consequence = !right && cause === "missing-forward" && p0?.stop === "no-route" && t?.cause === "inactive-route";
  return { right, consequence, text: texts[cause] };
}

/** Build exercise: the reachability that must work, both ways. */
export const RN_BUILD_PAIRS: { from: RnDev; dst: string; label: string }[] = [
  { from: "HOST-A", dst: "172.16.50.50", label: "HOST-A ↔ SERVER-A" },
  { from: "HOST-A", dst: "172.16.50.200", label: "HOST-A ↔ SERVER-B" },
  { from: "HOST-A", dst: "172.16.60.10", label: "HOST-A ↔ SERVER-C" },
  { from: "SERVER-C", dst: "172.16.50.50", label: "SERVER-C ↔ SERVER-A" },
];
/** The latest test of a pair, as long as nothing changed since. */
export const rnPairTest = (s: RnState, p: { from: RnDev; dst: string }) => [...s.runs].reverse().find((r) => r.tool === "ping" && r.from === p.from && r.dst === p.dst && r.cfgSeq === s.cfgSeq);
