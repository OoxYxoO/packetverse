import { IC_ADDR, INITIAL_TTL, ROUTER_ICMP_TTL } from "./icmpDiagnostics";

/**
 * ICMP NET — the ICMP lab's network as configuration, not as fault switches:
 *
 *   HOST-A eth0 192.0.2.10/24 ─ ge-0/0/0 R1 ge-0/0/1 ═══ ge-0/0/1 R2 ge-0/0/0 ─ eth0 HOST-B 198.51.100.20/24
 *                              192.0.2.1   203.0.113.1/30   203.0.113.2       198.51.100.1
 *
 * Every condition is a real setting on a device (interface MTU, admin state, static routes, R1's WAN-IN filter,
 * HOST-B's power and iptables rules, the hosts' path-MTU caches), and every tool — ping (Linux -M want/do/dont, -s,
 * -t), traceroute (UDP or -I ICMP), curl (a small page and a large file over TCP), and the routers' own ping and
 * traceroute — walks the same packets through the same rules (RFC 792/1122/1191/1812):
 *   - Echo Request 8/0 → Echo Reply 0/0 from the address pinged; a closed UDP port → 3/3 from that host or router.
 *   - A router about to forward with TTL ≤ 1 drops it and sends 11/0 from the interface it arrived on.
 *   - No route → 3/0. Route but no ARP answer for the next hop/host → 3/1.
 *   - Bigger than the egress interface MTU: DF → drop + 3/4 with that MTU; no DF → fragmented, reassembled at the end.
 *   - An inbound filter drops matching packets silently (counted). A host firewall drops silently.
 *   - No ICMP error about an ICMP error. Router-originated ICMP leaves with TTL 64 and is routed like any packet, so it
 *     can itself be filtered or lost on a broken return path. Router-originated packets skip outbound filters.
 *   - A host that receives 3/4 caches the path MTU for that destination (what PMTUD needs). If 3/4 never arrives, a
 *     sender that keeps DF set keeps sending packets that cannot fit: a PMTUD black hole.
 * Each walk records frames (what crossed which link, for the topology), explanations, captures at every interface
 * (both directions, with drop notes), interface counters and each router's ICMP statistics. Latency is not modeled:
 * the times printed by the tools are fixed per hop and mean nothing.
 */

// ---------------------------------------------------------------------------------------------------------------
// Topology and configuration
// ---------------------------------------------------------------------------------------------------------------
export type IcDev = "HOST-A" | "R1" | "R2" | "HOST-B";
export type IcRouter = "R1" | "R2";
export type IcHost = "HOST-A" | "HOST-B";
export type IcIf = "ge0" | "ge1";
/** Observation points: one per interface. */
export type IcPoint = "HOST-A" | "R1:ge0" | "R1:ge1" | "R2:ge1" | "R2:ge0" | "HOST-B";
export const IC_POINTS: IcPoint[] = ["HOST-A", "R1:ge0", "R1:ge1", "R2:ge1", "R2:ge0", "HOST-B"];
const PEER: Record<IcPoint, IcPoint> = { "HOST-A": "R1:ge0", "R1:ge0": "HOST-A", "R1:ge1": "R2:ge1", "R2:ge1": "R1:ge1", "R2:ge0": "HOST-B", "HOST-B": "R2:ge0" };
export const icJunosIf = (i: IcIf) => (i === "ge0" ? "ge-0/0/0" : "ge-0/0/1");
export const icCiscoIf = (i: IcIf) => (i === "ge0" ? "GigabitEthernet0/0" : "GigabitEthernet0/1");
export const icShortIf = (i: IcIf) => (i === "ge0" ? "Gi0/0" : "Gi0/1");
export const icPointLabel = (p: IcPoint, vendor: "cisco" | "juniper" = "juniper") => (p === "HOST-A" || p === "HOST-B" ? `${p} eth0` : `${p.slice(0, 2)} ${vendor === "cisco" ? icShortIf(p.slice(3) as IcIf) : icJunosIf(p.slice(3) as IcIf)}`);
const pointDev = (p: IcPoint): IcDev => (p.includes(":") ? (p.slice(0, 2) as IcRouter) : (p as IcHost));

export interface IcIfCfg {
  ip: string;
  prefix: number;
  /** IP MTU of the interface. */
  mtu: number;
  up: boolean;
}
export interface IcStatic {
  prefix: string;
  len: number;
  via: string;
}
export type IcIcmpMatch = "any" | "echo" | "echo-reply" | "unreachable" | "time-exceeded" | "packet-too-big";
export interface IcAclEntry {
  seq: number;
  /** Junos term name. */
  term: string;
  action: "permit" | "deny";
  proto: "ip" | "icmp";
  icmp?: IcIcmpMatch;
  hits: number;
}
export interface IcRouterCfg {
  ifs: Record<IcIf, IcIfCfg>;
  statics: IcStatic[];
  /** R1 only: the WAN-IN filter and where it is applied (inbound). */
  acl?: { entries: IcAclEntry[]; appliedIn?: IcIf };
}
export type IcIptType = "echo-request" | "destination-unreachable" | "fragmentation-needed" | "time-exceeded" | "all";
export interface IcIptRule {
  type: IcIptType;
  target: "DROP" | "ACCEPT";
}
export interface IcHostCfg {
  ip: string;
  prefix: number;
  gw: string;
  mtu: number;
  power: boolean;
  /** iptables INPUT rules (ICMP only), first match wins; default policy ACCEPT. */
  input: IcIptRule[];
  /** Path-MTU cache: destination → MTU learnt from ICMP 3/4. */
  pmtu: Record<string, number>;
}
export interface IcNetCfg {
  R1: IcRouterCfg;
  R2: IcRouterCfg;
  "HOST-A": IcHostCfg;
  "HOST-B": IcHostCfg;
}
export const IC_TRANSIT_SAFE = 1500;
export function icHealthy(): IcNetCfg {
  return {
    R1: {
      ifs: { ge0: { ip: IC_ADDR["R1:LAN"], prefix: 24, mtu: 1500, up: true }, ge1: { ip: IC_ADDR["R1:TRANSIT"], prefix: 30, mtu: 1500, up: true } },
      statics: [{ prefix: "198.51.100.0", len: 24, via: IC_ADDR["R2:TRANSIT"] }],
      acl: { entries: [{ seq: 10, term: "allow-all", action: "permit", proto: "ip", hits: 0 }], appliedIn: "ge1" },
    },
    R2: {
      ifs: { ge0: { ip: IC_ADDR["R2:LAN"], prefix: 24, mtu: 1500, up: true }, ge1: { ip: IC_ADDR["R2:TRANSIT"], prefix: 30, mtu: 1500, up: true } },
      statics: [{ prefix: "192.0.2.0", len: 24, via: IC_ADDR["R1:TRANSIT"] }],
    },
    "HOST-A": { ip: IC_ADDR["HOST-A"], prefix: 24, gw: IC_ADDR["R1:LAN"], mtu: 1500, power: true, input: [], pmtu: {} },
    "HOST-B": { ip: IC_ADDR["HOST-B"], prefix: 24, gw: IC_ADDR["R2:LAN"], mtu: 1500, power: true, input: [], pmtu: {} },
  };
}

const ipNum = (ip: string) => ip.split(".").reduce((a, o) => a * 256 + Number(o), 0);
export const icInPrefix = (ip: string, p: string, len: number) => len === 0 || Math.floor(ipNum(ip) / 2 ** (32 - len)) === Math.floor(ipNum(p) / 2 ** (32 - len));
export const icNetOf = (ip: string, len: number) => {
  const n = len === 0 ? 0 : Math.floor(ipNum(ip) / 2 ** (32 - len)) * 2 ** (32 - len);
  return [24, 16, 8, 0].map((s) => Math.floor(n / 2 ** s) % 256).join(".");
};
export const icValidIp = (t: string) => /^\d{1,3}(\.\d{1,3}){3}$/.test(t) && t.split(".").every((o) => Number(o) <= 255);

export interface IcRouteRow {
  prefix: string;
  len: number;
  kind: "connected" | "local" | "static";
  iface?: IcIf;
  via?: string;
  /** A static whose next hop isn't on a connected (up) network is inactive. */
  active: boolean;
}
/** The routing table a router really has right now: connected (up interfaces), local /32s, statics. */
export function icRouteTable(c: IcRouterCfg): IcRouteRow[] {
  const out: IcRouteRow[] = [];
  for (const i of ["ge0", "ge1"] as IcIf[]) {
    const f = c.ifs[i];
    if (!f.up) continue;
    out.push({ prefix: icNetOf(f.ip, f.prefix), len: f.prefix, kind: "connected", iface: i, active: true }, { prefix: f.ip, len: 32, kind: "local", iface: i, active: true });
  }
  for (const s of c.statics) {
    const nh = (["ge0", "ge1"] as IcIf[]).find((i) => c.ifs[i].up && icInPrefix(s.via, c.ifs[i].ip, c.ifs[i].prefix));
    out.push({ prefix: s.prefix, len: s.len, kind: "static", via: s.via, iface: nh, active: !!nh });
  }
  return out;
}
function lookup(c: IcRouterCfg, dst: string) {
  return icRouteTable(c)
    .filter((r) => r.active && r.kind !== "local" && icInPrefix(dst, r.prefix, r.len))
    .sort((a, b) => b.len - a.len)[0];
}

// ---------------------------------------------------------------------------------------------------------------
// Packets, ICMP messages, evidence records
// ---------------------------------------------------------------------------------------------------------------
export type IcKind = "echo-req" | "echo-rep" | "ttl" | "net" | "host" | "port" | "frag";
export const IC_KIND: Record<IcKind, { type: number; code: number; name: string; short: string; error: boolean }> = {
  "echo-req": { type: 8, code: 0, name: "Echo Request", short: "Echo Request", error: false },
  "echo-rep": { type: 0, code: 0, name: "Echo Reply", short: "Echo Reply", error: false },
  ttl: { type: 11, code: 0, name: "Time Exceeded (TTL expired in transit)", short: "Time Exceeded", error: true },
  net: { type: 3, code: 0, name: "Destination Unreachable — Net", short: "Net Unreachable", error: true },
  host: { type: 3, code: 1, name: "Destination Unreachable — Host", short: "Host Unreachable", error: true },
  port: { type: 3, code: 3, name: "Destination Unreachable — Port", short: "Port Unreachable", error: true },
  frag: { type: 3, code: 4, name: "Destination Unreachable — Fragmentation Needed and DF set", short: "Frag Needed", error: true },
};
export interface IcPkt {
  src: string;
  dst: string;
  ttl: number;
  /** Total IP length. */
  len: number;
  df: boolean;
  proto: "icmp" | "udp" | "tcp";
  kind?: IcKind;
  /** 3/4: the next-hop MTU. */
  mtu?: number;
  /** ICMP errors quote the start of the packet that caused them. */
  quote?: { src: string; dst: string; proto: IcPkt["proto"]; kind?: IcKind; ttl: number; len: number; dport?: number };
  dport?: number;
  tcp?: "SYN" | "SYN-ACK" | "DATA";
  /** Fragments: how many pieces this packet travels as (≥ 2 once fragmented). */
  frags?: number;
}
export const icPktText = (p: IcPkt) =>
  p.proto === "icmp"
    ? `ICMP ${IC_KIND[p.kind!].type}/${IC_KIND[p.kind!].code} ${IC_KIND[p.kind!].short}${p.kind === "frag" ? ` (mtu ${p.mtu})` : ""}`
    : p.proto === "udp"
      ? `UDP → port ${p.dport}`
      : `TCP ${p.tcp}${p.tcp === "DATA" ? ` ${p.len - 40} B` : ""}`;

/**
 * What a device checked while handling a packet, in order, recorded by the walk itself (so the topology can show the
 * inside of a device without re-deciding anything). A check that failed is the last one present.
 */
export interface IcDecision {
  /** Interface the packet came in on (routers). */
  inIf?: IcIf;
  /** Inbound filter on that interface. */
  filter?: { ok: boolean; rule: string };
  /** The destination is one of the router's own addresses. */
  local?: boolean;
  /** out = 0: it would expire. */
  ttl?: { in: number; out: number };
  /** null: no route. */
  route?: { prefix: string; len: number; kind: "connected" | "static"; via?: string; out: IcIf } | null;
  /** at "ingress": a frame bigger than the receiving interface's MTU (a giant). */
  fit?: { len: number; mtu: number; df: boolean; frags?: number; ok: boolean; at?: "egress" | "ingress" };
  arp?: { nh: string; ok: boolean };
  /** Host firewall (iptables INPUT). */
  fw?: { ok: boolean; rule?: string };
  /** The device built this packet itself (a router's own ICMP, or the reply it originates). */
  originated?: boolean;
  /** An ICMP error this device generates about the packet it dropped. */
  gen?: { kind: IcKind; src: string; dst: string; mtu?: number };
}

export interface IcFrame {
  from: IcDev;
  to?: IcDev;
  /** Interfaces (observation points) at each end. */
  out?: IcPoint;
  in?: IcPoint;
  pkt: IcPkt;
  kind: "move" | "drop" | "deliver";
  text: string;
  tone: "info" | "ok" | "bad" | "icmp";
  dec?: IcDecision;
}
export interface IcCap {
  n: number;
  run: number;
  point: IcPoint;
  dir: "in" | "out";
  pkt: IcPkt;
  note?: string;
}
export interface IcCounters {
  in: number;
  out: number;
  aclDrops: number;
  giants: number;
}
export type IcIcmpStats = Record<IcRouter, { sent: Partial<Record<IcKind, number>>; rcvd: Partial<Record<IcKind, number>> }>;

// ---------------------------------------------------------------------------------------------------------------
// The walk
// ---------------------------------------------------------------------------------------------------------------
interface Ctx {
  cfg: IcNetCfg;
  frames: IcFrame[];
  caps: IcCap[];
  capN: number;
  run: number;
  counters: Record<IcPoint, IcCounters>;
  stats: IcIcmpStats;
  delivered: { dev: IcDev; pkt: IcPkt }[];
  guard: number;
}
const ifPoint = (r: IcRouter, i: IcIf) => `${r}:${i}` as IcPoint;
const devIp = (cfg: IcNetCfg, d: IcDev): string[] => (d === "HOST-A" || d === "HOST-B" ? [cfg[d].ip] : (["ge0", "ge1"] as IcIf[]).filter((i) => cfg[d].ifs[i].up).map((i) => cfg[d].ifs[i].ip));
const cap = (c: Ctx, point: IcPoint, dir: "in" | "out", pkt: IcPkt, note?: string) => {
  c.caps.push({ n: ++c.capN, run: c.run, point, dir, pkt: { ...pkt }, note });
  if (dir === "out") c.counters[point].out++;
  else c.counters[point].in++;
};
/** Who answers ARP for `ip` on the far side of `point` (powered, interface up, owns the address). */
function neighborOwns(cfg: IcNetCfg, point: IcPoint, ip: string): boolean {
  const peer = PEER[point];
  const d = pointDev(peer);
  if (d === "HOST-A" || d === "HOST-B") return cfg[d].power && cfg[d].ip === ip;
  const f = cfg[d].ifs[peer.slice(3) as IcIf];
  return f.up && f.ip === ip;
}
function aclMatch(e: IcAclEntry, p: IcPkt) {
  if (e.proto === "ip") return true;
  if (p.proto !== "icmp") return false;
  const k = IC_KIND[p.kind!];
  switch (e.icmp ?? "any") {
    case "any":
      return true;
    case "echo":
      return p.kind === "echo-req";
    case "echo-reply":
      return p.kind === "echo-rep";
    case "unreachable":
      return k.type === 3;
    case "packet-too-big":
      return p.kind === "frag";
    case "time-exceeded":
      return p.kind === "ttl";
  }
}
function iptMatch(r: IcIptRule, p: IcPkt) {
  if (p.proto !== "icmp") return false;
  if (r.type === "all") return true;
  if (r.type === "echo-request") return p.kind === "echo-req";
  if (r.type === "destination-unreachable") return IC_KIND[p.kind!].type === 3;
  if (r.type === "fragmentation-needed") return p.kind === "frag";
  return p.kind === "ttl";
}

/** Put a packet on the wire from `point` and hand it to the device on the other side. */
function transmit(c: Ctx, point: IcPoint, pkt: IcPkt, dec?: IcDecision) {
  if (++c.guard > 400) return;
  const peer = PEER[point];
  const from = pointDev(point);
  const to = pointDev(peer);
  cap(c, point, "out", pkt);
  const peerMtu = to === "HOST-A" || to === "HOST-B" ? c.cfg[to].mtu : c.cfg[to].ifs[peer.slice(3) as IcIf].mtu;
  if (pkt.len > peerMtu && !pkt.frags) {
    c.counters[peer].giants++;
    cap(c, peer, "in", pkt, `dropped: ${pkt.len} B frame is larger than this interface's MTU ${peerMtu} (giant)`);
    c.frames.push({ from, to, out: point, in: peer, pkt: { ...pkt }, kind: "move", text: `${from} → ${to}: ${icPktText(pkt)} · ${pkt.len} B · TTL ${pkt.ttl}`, tone: "info", dec }, { from: to, pkt: { ...pkt }, kind: "drop", text: `${to} drops it on arrival: ${pkt.len} B is larger than its interface MTU ${peerMtu} — no ICMP is sent for this`, tone: "bad", dec: { inIf: peer.includes(":") ? (peer.slice(3) as IcIf) : undefined, fit: { len: pkt.len, mtu: peerMtu, df: pkt.df, ok: false, at: "ingress" } } });
    return;
  }
  cap(c, peer, "in", pkt);
  c.frames.push({ from, to, out: point, in: peer, pkt: { ...pkt }, kind: "move", text: `${from} → ${to}: ${icPktText(pkt)}${pkt.frags ? ` (in ${pkt.frags} fragments)` : ""} · ${pkt.len} B${pkt.df ? " DF" : ""} · TTL ${pkt.ttl}`, tone: pkt.proto === "icmp" && IC_KIND[pkt.kind!].error ? "icmp" : "info", dec });
  if (to === "HOST-A" || to === "HOST-B") hostReceive(c, to, pkt);
  else routerReceive(c, to, peer.slice(3) as IcIf, pkt);
}

function hostSend(c: Ctx, h: IcHost, pkt: IcPkt) {
  const cfg = c.cfg[h];
  if (!cfg.power) return;
  const local = icInPrefix(pkt.dst, cfg.ip, cfg.prefix);
  const nh = local ? pkt.dst : cfg.gw;
  const point: IcPoint = h;
  if (!neighborOwns(c.cfg, point, nh)) {
    c.frames.push({ from: h, pkt: { ...pkt }, kind: "drop", text: `${h} gets no ARP answer for ${local ? pkt.dst : `its gateway ${nh}`}: nothing is sent`, tone: "bad", dec: { arp: { nh, ok: false } } });
    return;
  }
  transmit(c, point, pkt);
}

function routerError(c: Ctx, r: IcRouter, inIf: IcIf | undefined, orig: IcPkt, kind: IcKind, mtu?: number) {
  if (orig.proto === "icmp" && IC_KIND[orig.kind!].error) return; // never an error about an error
  const src = c.cfg[r].ifs[inIf ?? "ge0"].ip;
  c.stats[r].sent[kind] = (c.stats[r].sent[kind] ?? 0) + 1;
  c.frames.push({ from: r, pkt: { ...orig }, kind: "drop", text: `${r} drops it and generates ICMP ${IC_KIND[kind].type}/${IC_KIND[kind].code} ${IC_KIND[kind].short}${mtu ? ` (mtu ${mtu})` : ""} back to ${orig.src}, from ${src}`, tone: "icmp", dec: { gen: { kind, src, dst: orig.src, mtu } } });
  routerOriginate(c, r, { src, dst: orig.src, ttl: ROUTER_ICMP_TTL, len: 56, df: false, proto: "icmp", kind, mtu, quote: { src: orig.src, dst: orig.dst, proto: orig.proto, kind: orig.kind, ttl: orig.ttl, len: orig.len, dport: orig.dport } });
}

function routerForward(c: Ctx, r: IcRouter, inIf: IcIf | undefined, pkt: IcPkt, originated: boolean, pre: IcDecision = {}) {
  const cfg = c.cfg[r];
  const d: IcDecision = { ...pre, inIf, originated: originated || undefined };
  if (!originated && pkt.ttl <= 1) {
    d.ttl = { in: pkt.ttl, out: 0 };
    c.frames.push({ from: r, pkt: { ...pkt }, kind: "drop", text: `${r}: TTL ${pkt.ttl} → 0 if forwarded: the packet must die here`, tone: "bad", dec: d });
    routerError(c, r, inIf, pkt, "ttl");
    return;
  }
  if (!originated) d.ttl = { in: pkt.ttl, out: pkt.ttl - 1 };
  const rt = lookup(cfg, pkt.dst);
  if (!rt || !rt.iface) {
    d.route = null;
    c.frames.push({ from: r, pkt: { ...pkt }, kind: "drop", text: `${r}: no route to ${pkt.dst}`, tone: "bad", dec: d });
    if (!originated) routerError(c, r, inIf, pkt, "net");
    return;
  }
  const out = rt.iface;
  d.route = { prefix: rt.prefix, len: rt.len, kind: rt.kind === "static" ? "static" : "connected", via: rt.via, out };
  const egress = cfg.ifs[out];
  let p: IcPkt = originated ? { ...pkt } : { ...pkt, ttl: pkt.ttl - 1 };
  if (p.len > egress.mtu && !p.frags) {
    if (p.df) {
      d.fit = { len: p.len, mtu: egress.mtu, df: true, ok: false, at: "egress" };
      c.frames.push({ from: r, pkt: { ...pkt }, kind: "drop", text: `${r}: ${p.len} B won't fit out ${icJunosIf(out)} (MTU ${egress.mtu}) and DF forbids fragmenting`, tone: "bad", dec: d });
      if (!originated) routerError(c, r, inIf, pkt, "frag", egress.mtu);
      return;
    }
    p = { ...p, frags: Math.ceil((p.len - 20) / (Math.floor((egress.mtu - 20) / 8) * 8)) };
  }
  d.fit = { len: p.len, mtu: egress.mtu, df: p.df, frags: p.frags, ok: true, at: "egress" };
  const nh = rt.kind === "connected" ? p.dst : rt.via!;
  d.arp = { nh, ok: neighborOwns(c.cfg, ifPoint(r, out), nh) };
  if (!d.arp.ok) {
    c.frames.push({ from: r, pkt: { ...pkt }, kind: "drop", text: `${r}: route out ${icJunosIf(out)}, but no ARP answer for ${nh}`, tone: "bad", dec: d });
    if (!originated) routerError(c, r, inIf, pkt, "host");
    return;
  }
  transmit(c, ifPoint(r, out), p, d);
}

function routerOriginate(c: Ctx, r: IcRouter, pkt: IcPkt) {
  routerForward(c, r, undefined, pkt, true);
}

function routerReceive(c: Ctx, r: IcRouter, inIf: IcIf, pkt: IcPkt) {
  const cfg = c.cfg[r];
  const point = ifPoint(r, inIf);
  const pre: IcDecision = {};
  if (cfg.acl?.appliedIn === inIf) {
    const e = cfg.acl.entries.find((x) => aclMatch(x, pkt));
    if (e) e.hits++;
    pre.filter = { ok: !!e && e.action === "permit", rule: e ? `seq ${e.seq} ${e.action} ${e.proto}${e.icmp ? ` ${e.icmp}` : ""}` : "implicit deny" };
    if (!e || e.action === "deny") {
      c.counters[point].aclDrops++;
      const last = c.caps[c.caps.length - 1];
      if (last && last.point === point) last.note = `dropped by filter WAN-IN (${e ? `seq ${e.seq} deny` : "implicit deny"})`;
      c.frames.push({ from: r, pkt: { ...pkt }, kind: "drop", text: `${r}'s filter WAN-IN on ${icJunosIf(inIf)} discards it (${e ? `seq ${e.seq}: deny ${e.proto}${e.icmp ? ` ${e.icmp}` : ""}` : "implicit deny"}) — silently`, tone: "bad", dec: { inIf, filter: pre.filter } });
      return;
    }
  }
  if (pkt.proto === "icmp") c.stats[r].rcvd[pkt.kind!] = (c.stats[r].rcvd[pkt.kind!] ?? 0) + (devIp(c.cfg, r).includes(pkt.dst) ? 1 : 0);
  if (devIp(c.cfg, r).includes(pkt.dst)) {
    c.delivered.push({ dev: r, pkt });
    c.frames.push({ from: r, pkt: { ...pkt }, kind: "deliver", text: `${pkt.dst} is ${r}'s own address`, tone: "ok", dec: { ...pre, inIf, local: true } });
    if (pkt.proto === "icmp" && pkt.kind === "echo-req") {
      c.stats[r].sent["echo-rep"] = (c.stats[r].sent["echo-rep"] ?? 0) + 1;
      routerOriginate(c, r, { src: pkt.dst, dst: pkt.src, ttl: ROUTER_ICMP_TTL, len: pkt.len, df: pkt.df, proto: "icmp", kind: "echo-rep" });
    } else if (pkt.proto === "udp") {
      c.stats[r].sent.port = (c.stats[r].sent.port ?? 0) + 1;
      routerOriginate(c, r, { src: pkt.dst, dst: pkt.src, ttl: ROUTER_ICMP_TTL, len: 56, df: false, proto: "icmp", kind: "port", quote: { src: pkt.src, dst: pkt.dst, proto: "udp", ttl: pkt.ttl, len: pkt.len, dport: pkt.dport } });
    }
    return;
  }
  routerForward(c, r, inIf, pkt, false, pre);
}

function hostReceive(c: Ctx, h: IcHost, pkt: IcPkt) {
  const cfg = c.cfg[h];
  const rule = cfg.input.find((x) => iptMatch(x, pkt));
  if (rule?.target === "DROP") {
    const last = c.caps[c.caps.length - 1];
    if (last && last.point === h) last.note = `dropped by ${h}'s iptables (INPUT ${rule.type} DROP)`;
    c.frames.push({ from: h, pkt: { ...pkt }, kind: "drop", text: `${h}'s firewall drops it silently (iptables INPUT -p icmp --icmp-type ${rule.type} -j DROP)`, tone: "bad", dec: { fw: { ok: false, rule: `INPUT -p icmp --icmp-type ${rule.type} -j DROP` } } });
    return;
  }
  if (pkt.dst !== cfg.ip) return;
  c.delivered.push({ dev: h, pkt });
  if (pkt.proto === "icmp") {
    if (pkt.kind === "echo-req") {
      c.frames.push({ from: h, pkt: { ...pkt }, kind: "deliver", text: `${h} receives the Echo Request and answers with an Echo Reply (TTL ${INITIAL_TTL})`, tone: "ok", dec: { fw: { ok: true } } });
      hostSend(c, h, { src: cfg.ip, dst: pkt.src, ttl: INITIAL_TTL, len: pkt.len, df: pkt.df, proto: "icmp", kind: "echo-rep" });
      return;
    }
    if (pkt.kind === "frag" && pkt.quote && pkt.mtu) cfg.pmtu[pkt.quote.dst] = Math.min(cfg.pmtu[pkt.quote.dst] ?? cfg.mtu, pkt.mtu);
    c.frames.push({ from: h, pkt: { ...pkt }, kind: "deliver", text: `${h} receives ${icPktText(pkt)} from ${pkt.src}${pkt.kind === "frag" ? ` — and remembers: path MTU to ${pkt.quote?.dst} is ${pkt.mtu}` : ""}`, tone: IC_KIND[pkt.kind!].error ? "icmp" : "ok", dec: { fw: { ok: true } } });
    return;
  }
  if (pkt.proto === "udp") {
    c.frames.push({ from: h, pkt: { ...pkt }, kind: "deliver", text: `${h}: nothing listens on UDP ${pkt.dport} → ICMP 3/3 Port Unreachable`, tone: "ok", dec: { fw: { ok: true } } });
    hostSend(c, h, { src: cfg.ip, dst: pkt.src, ttl: INITIAL_TTL, len: 56, df: false, proto: "icmp", kind: "port", quote: { src: pkt.src, dst: pkt.dst, proto: "udp", ttl: pkt.ttl, len: pkt.len, dport: pkt.dport } });
    return;
  }
  c.frames.push({ from: h, pkt: { ...pkt }, kind: "deliver", text: `${h} receives TCP ${pkt.tcp}${pkt.tcp === "DATA" ? ` (${pkt.len} B)` : ""}`, tone: "ok" });
  if (pkt.tcp === "SYN") hostSend(c, h, { src: cfg.ip, dst: pkt.src, ttl: INITIAL_TTL, len: 60, df: true, proto: "tcp", tcp: "SYN-ACK" });
}

// ---------------------------------------------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------------------------------------------
export type IcPmtuMode = "want" | "do" | "dont";
export interface IcProbe {
  /** What came back to the sender (the first answer), if anything. */
  answer?: IcPkt;
  /** Device that generated the answer. */
  answerFrom?: IcDev;
  frames: IcFrame[];
  /** Locally refused before sending (ping -M do bigger than the known path MTU). */
  localError?: string;
  /** The probe's own starting TTL / size / DF. */
  ttl: number;
  len: number;
  df: boolean;
  frags?: number;
}
export interface IcRun {
  id: number;
  dev: IcDev;
  tool: "ping" | "traceroute" | "curl";
  dst: string;
  args: { count?: number; data?: number; mode?: IcPmtuMode; ttl?: number; icmp?: boolean; max?: number; file?: "small" | "big"; vendorSize?: number };
  probes: IcProbe[];
  /** Per traceroute hop: the probes of that TTL. */
  hops?: IcProbe[][];
  received: number;
  errors: number;
  curl?: { ok: boolean; reason?: "timeout" | "no-route" | "unreach"; bytes: number; total: number; retried?: number };
  /** First capture number of this run (for "this run only" views). */
  capFrom: number;
}

const ownerOf = (cfg: IcNetCfg, ip: string): IcDev | undefined => (["HOST-A", "R1", "R2", "HOST-B"] as IcDev[]).find((d) => devIp(cfg, d).includes(ip));
const freshCtx = (s: IcState, run: number): Ctx => ({ cfg: s.cfg, frames: [], caps: s.captures, capN: s.capN, run, counters: s.counters, stats: s.stats, delivered: [], guard: 0 });

/** One probe from a device: walks it and reports the first answer the sender received. */
function sendProbe(c: Ctx, from: IcDev, pkt: IcPkt): IcProbe {
  c.frames = [];
  c.delivered = [];
  c.guard = 0;
  if (from === "HOST-A" || from === "HOST-B") hostSend(c, from, pkt);
  else routerOriginate(c, from, pkt);
  const mine = devIp(c.cfg, from);
  const got = c.delivered.find((d) => d.dev === from && mine.includes(d.pkt.dst) && d.pkt !== pkt && (d.pkt.proto === "icmp" || d.pkt.tcp === "SYN-ACK"));
  const firstFrag = c.frames.find((f) => f.pkt.frags)?.pkt.frags;
  return { answer: got?.pkt, answerFrom: got ? ownerOf(c.cfg, got.pkt.src) : undefined, frames: c.frames, ttl: pkt.ttl, len: pkt.len, df: pkt.df, frags: firstFrag };
}

function srcIpFor(cfg: IcNetCfg, dev: IcDev, dst: string): string {
  if (dev === "HOST-A" || dev === "HOST-B") return cfg[dev].ip;
  const rt = lookup(cfg[dev], dst);
  return cfg[dev].ifs[rt?.iface ?? "ge0"].ip;
}

export function icPing(s: IcState, dev: IcDev, dst: string, o: { count: number; data: number; mode: IcPmtuMode; ttl: number }, id: number, c: Ctx): IcRun {
  const probes: IcProbe[] = [];
  const total = o.data + 28;
  for (let i = 0; i < o.count; i++) {
    const host = dev === "HOST-A" || dev === "HOST-B" ? s.cfg[dev] : undefined;
    const pmtu = host ? Math.min(host.mtu, host.pmtu[dst] ?? host.mtu) : 1500;
    if (host && o.mode === "do" && total > pmtu) {
      probes.push({ frames: [{ from: dev, pkt: { src: host.ip, dst, ttl: o.ttl, len: total, df: true, proto: "icmp", kind: "echo-req" }, kind: "drop", text: `${dev} refuses to send it: ${total} B is bigger than the path MTU it knows (${pmtu}) and -M do forbids fragmenting`, tone: "bad" }], localError: `ping: local error: message too long, mtu=${pmtu}`, ttl: o.ttl, len: total, df: true });
      continue;
    }
    // want: DF set while the packet fits what the host knows; bigger ones are fragmented by the host itself.
    const localFrag = host && o.mode !== "do" && total > pmtu;
    const df = o.mode === "dont" ? false : !localFrag;
    const pkt: IcPkt = { src: srcIpFor(s.cfg, dev, dst), dst, ttl: o.ttl, len: total, df, proto: "icmp", kind: "echo-req", frags: localFrag ? Math.ceil((total - 20) / (Math.floor((pmtu - 20) / 8) * 8)) : undefined };
    probes.push(sendProbe(c, dev, pkt));
  }
  const received = probes.filter((p) => p.answer?.kind === "echo-rep").length;
  const errors = probes.filter((p) => p.answer && p.answer.kind !== "echo-rep").length;
  return { id, dev, tool: "ping", dst, args: { ...o }, probes, received, errors, capFrom: 0 };
}

export function icTrace(s: IcState, dev: IcDev, dst: string, o: { icmp: boolean; max: number }, id: number, c: Ctx): IcRun {
  const hops: IcProbe[][] = [];
  let port = 33434;
  for (let t = 1; t <= o.max; t++) {
    const hop: IcProbe[] = [];
    for (let q = 0; q < 3; q++) {
      const pkt: IcPkt = o.icmp ? { src: srcIpFor(s.cfg, dev, dst), dst, ttl: t, len: 60, df: false, proto: "icmp", kind: "echo-req" } : { src: srcIpFor(s.cfg, dev, dst), dst, ttl: t, len: 60, df: false, proto: "udp", dport: port++ };
      hop.push(sendProbe(c, dev, pkt));
    }
    hops.push(hop);
    const a = hop.find((p) => p.answer)?.answer;
    if (a && (a.kind === "echo-rep" || a.kind === "port" || a.kind === "host" || a.kind === "net")) break;
  }
  const probes = hops.flat();
  return { id, dev, tool: "traceroute", dst, args: { ...o }, probes, hops, received: probes.filter((p) => p.answer?.kind === "echo-rep" || p.answer?.kind === "port").length, errors: 0, capFrom: 0 };
}

export const IC_FILES = { small: { path: "/index.html", bytes: 900 }, big: { path: "/files/big.iso", bytes: 52_428_800 } } as const;
/** curl from HOST-A: TCP connect, a small request, then the server's data at full segment size with DF (TCP does PMTUD). */
export function icCurl(s: IcState, file: "small" | "big", id: number, c: Ctx): IcRun {
  const A = s.cfg["HOST-A"];
  const B = s.cfg["HOST-B"];
  const total = IC_FILES[file].bytes;
  const probes: IcProbe[] = [];
  const syn = sendProbe(c, "HOST-A", { src: A.ip, dst: B.ip, ttl: INITIAL_TTL, len: 60, df: true, proto: "tcp", tcp: "SYN" });
  probes.push(syn);
  const fail = (reason: "timeout" | "no-route" | "unreach"): IcRun => ({ id, dev: "HOST-A", tool: "curl", dst: B.ip, args: { file }, probes, received: 0, errors: 0, curl: { ok: false, reason, bytes: 0, total }, capFrom: 0 });
  if (syn.answer?.proto === "icmp") return fail(syn.answer.kind === "host" || syn.answer.kind === "net" ? "no-route" : "timeout");
  if (syn.answer?.tcp !== "SYN-ACK") return fail("timeout");
  // Server → client data: a full segment, or the whole small page.
  const seg = (mtu: number) => Math.min(mtu, 40 + total);
  let mtuB = Math.min(B.mtu, B.pmtu[A.ip] ?? B.mtu, 40 + 1460);
  let retried = 0;
  for (let attempt = 0; attempt < 3; attempt++) {
    const p = sendProbe(c, "HOST-B", { src: B.ip, dst: A.ip, ttl: INITIAL_TTL, len: seg(mtuB), df: true, proto: "tcp", tcp: "DATA" });
    probes.push(p);
    const arrived = c.delivered.some((d) => d.dev === "HOST-A" && d.pkt.tcp === "DATA");
    if (arrived) return { id, dev: "HOST-A", tool: "curl", dst: B.ip, args: { file }, probes, received: 1, errors: 0, curl: { ok: true, bytes: total, total, retried }, capFrom: 0 };
    const learnt = B.pmtu[A.ip];
    if (learnt && learnt < mtuB) {
      mtuB = learnt;
      retried++;
      continue;
    }
    break;
  }
  return fail("timeout");
}

// ---------------------------------------------------------------------------------------------------------------
// Tickets
// ---------------------------------------------------------------------------------------------------------------
export type IcTicketId = "blackhole" | "host-down" | "return" | "firewall" | "loop" | "hidden-hop";
export type IcCause = "mtu-small" | "pmtud-filtered" | "hostb-down" | "no-return" | "hostb-fw" | "r2-lan-down" | "loop" | "ttl-filtered" | "r2-down" | "dns";
export const IC_CAUSES: { id: IcCause; label: string }[] = [
  { id: "mtu-small", label: "A link's MTU is smaller than the packets" },
  { id: "pmtud-filtered", label: "Fragmentation Needed (3/4) is being filtered: a PMTUD black hole" },
  { id: "hostb-down", label: "HOST-B is down" },
  { id: "no-return", label: "The return path is missing (R2 has no route back)" },
  { id: "hostb-fw", label: "HOST-B's firewall drops Echo Requests; the path is fine" },
  { id: "r2-lan-down", label: "R2's LAN interface is down" },
  { id: "loop", label: "A routing loop between R1 and R2" },
  { id: "ttl-filtered", label: "Time Exceeded messages are being filtered" },
  { id: "r2-down", label: "R2 is down" },
  { id: "dns", label: "Name resolution is broken" },
];
export interface IcTicket {
  id: IcTicketId;
  title: string;
  report: string;
  cause: IcCause;
  /** Mutates a healthy configuration into the broken one. */
  setup: (c: IcNetCfg) => void;
}
export const IC_TICKETS: IcTicket[] = [
  {
    id: "blackhole",
    title: "Big downloads hang",
    report: "“The status page on HOST-B loads instantly. Downloading the big file just sits at 0 bytes and never fails with an error.” The provider says the R1–R2 circuit carries 1400-byte packets, and the server team blocks ICMP unreachables on HOST-B.",
    cause: "pmtud-filtered",
    setup: (c) => {
      c.R1.ifs.ge1.mtu = 1400;
      c.R2.ifs.ge1.mtu = 1400;
      c["HOST-B"].input = [{ type: "fragmentation-needed", target: "DROP" }];
    },
  },
  {
    id: "host-down",
    title: "HOST-B stopped responding",
    report: "“HOST-B has been unreachable since this morning.”",
    cause: "hostb-down",
    setup: (c) => {
      c["HOST-B"].power = false;
    },
  },
  {
    id: "return",
    title: "Only R1 answers",
    report: "“From HOST-A we can reach R1, but nothing beyond it. R2's team insists R2 is up and fine.”",
    cause: "no-return",
    setup: (c) => {
      c.R2.statics = c.R2.statics.filter((x) => x.prefix !== "192.0.2.0");
    },
  },
  {
    id: "firewall",
    title: "Monitoring says HOST-B is down",
    report: "“Monitoring pings HOST-B and says it's down. Users say the web app on HOST-B works fine.”",
    cause: "hostb-fw",
    setup: (c) => {
      c["HOST-B"].input = [{ type: "echo-request", target: "DROP" }];
    },
  },
  {
    id: "loop",
    title: "Pings die of old age",
    report: "“After maintenance on R2 last night, HOST-B is unreachable and ping prints ‘Time to live exceeded’.”",
    cause: "r2-lan-down",
    setup: (c) => {
      c.R2.ifs.ge0.up = false;
      c.R2.statics = [...c.R2.statics, { prefix: "0.0.0.0", len: 0, via: IC_ADDR["R1:TRANSIT"] }];
    },
  },
  {
    id: "hidden-hop",
    title: "Traceroute shows a dead router",
    report: "“Traceroute to HOST-B shows * * * at hop 2. R2 must be dead!” — but the app on HOST-B works.",
    cause: "ttl-filtered",
    setup: (c) => {
      c.R1.acl = { entries: [{ seq: 10, term: "block-ttl", action: "deny", proto: "icmp", icmp: "time-exceeded", hits: 0 }, { seq: 20, term: "allow-all", action: "permit", proto: "ip", hits: 0 }], appliedIn: "ge1" };
    },
  },
];
export const icTicket = (id: IcTicketId) => IC_TICKETS.find((t) => t.id === id)!;

// ---------------------------------------------------------------------------------------------------------------
// State and actions
// ---------------------------------------------------------------------------------------------------------------
export interface IcLog {
  seq: number;
  text: string;
  tone: "info" | "ok" | "warn";
}
export interface IcState {
  seq: number;
  cfg: IcNetCfg;
  captures: IcCap[];
  capN: number;
  counters: Record<IcPoint, IcCounters>;
  stats: IcIcmpStats;
  runs: IcRun[];
  last?: IcRun;
  /** Seq of the last configuration change (verification runs must come after it). */
  changeSeq: number;
  ticket?: IcTicketId;
  log: IcLog[];
}
const zeroCounters = () => Object.fromEntries(IC_POINTS.map((p) => [p, { in: 0, out: 0, aclDrops: 0, giants: 0 }])) as Record<IcPoint, IcCounters>;
const zeroStats = (): IcIcmpStats => ({ R1: { sent: {}, rcvd: {} }, R2: { sent: {}, rcvd: {} } });
export function createIcNet(): IcState {
  return { seq: 0, cfg: icHealthy(), captures: [], capN: 0, counters: zeroCounters(), stats: zeroStats(), runs: [], changeSeq: 0, log: [] };
}
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

export type IcAction =
  | { type: "ping"; dev: IcDev; dst: string; count?: number; data?: number; mode?: IcPmtuMode; ttl?: number }
  | { type: "trace"; dev: IcDev; dst: string; icmp?: boolean; max?: number }
  | { type: "curl"; file: "small" | "big" }
  | { type: "cfg"; cfg: IcNetCfg; text: string }
  | { type: "flush-pmtu"; dev: IcHost }
  | { type: "clear-captures" }
  | { type: "ticket"; id: IcTicketId }
  | { type: "fresh" };

function logged(s: IcState, patch: Partial<IcState>, text: string, tone: IcLog["tone"] = "info", changed = false): IcState {
  const seq = s.seq + 1;
  return { ...s, ...patch, seq, changeSeq: changed ? seq : (patch.changeSeq ?? s.changeSeq), log: [...s.log.slice(-60), { seq, text, tone }] };
}

function runTool(s: IcState, a: Extract<IcAction, { type: "ping" | "trace" | "curl" }>): IcState {
  const cfg = clone(s.cfg);
  const work: IcState = { ...s, cfg, captures: [...s.captures], counters: clone(s.counters), stats: clone(s.stats) };
  const id = s.seq + 1;
  const c = freshCtx(work, id);
  const capFrom = s.capN + 1;
  let run: IcRun;
  if (a.type === "ping") run = icPing(work, a.dev, a.dst, { count: Math.max(1, Math.min(10, a.count ?? 4)), data: Math.max(0, Math.min(1600, a.data ?? 56)), mode: a.mode ?? "want", ttl: Math.max(1, Math.min(255, a.ttl ?? (a.dev === "HOST-A" || a.dev === "HOST-B" ? INITIAL_TTL : 255))) }, id, c);
  else if (a.type === "trace") run = icTrace(work, a.dev, a.dst, { icmp: !!a.icmp, max: Math.max(1, Math.min(30, a.max ?? 30)) }, id, c);
  else run = icCurl(work, a.file, id, c);
  run = { ...run, capFrom };
  const text = run.tool === "curl" ? `curl ${IC_FILES[a.type === "curl" ? a.file : "small"].path}: ${run.curl!.ok ? "complete" : run.curl!.reason}` : `${run.dev}: ${run.tool} ${run.dst} → ${run.tool === "ping" ? `${run.received}/${run.probes.length} replies${run.errors ? `, ${run.errors} ICMP errors` : ""}` : `${run.hops!.length} hops`}`;
  return logged({ ...work, captures: c.caps.slice(-800), capN: c.capN }, { runs: [...s.runs.slice(-30), run], last: run }, text, run.received || run.curl?.ok ? "ok" : "warn");
}

function apply(s: IcState, a: IcAction): IcState {
  switch (a.type) {
    case "ping":
    case "trace":
      if (!icValidIp(a.dst)) return logged(s, {}, `“${a.dst}” is not an IPv4 address`, "warn");
      return runTool(s, a);
    case "curl":
      return runTool(s, a);
    case "cfg":
      return logged(s, { cfg: clone(a.cfg) }, a.text, "info", true);
    case "flush-pmtu": {
      const cfg = clone(s.cfg);
      cfg[a.dev].pmtu = {};
      return logged(s, { cfg }, `${a.dev}: route cache flushed (path-MTU entries forgotten)`, "info", true);
    }
    case "clear-captures":
      return logged(s, { captures: [] }, "Captures cleared");
    case "ticket": {
      const t = icTicket(a.id);
      const cfg = icHealthy();
      t.setup(cfg);
      return logged({ ...createIcNet(), seq: s.seq }, { cfg, ticket: a.id }, `Ticket: ${t.title}. ${t.report}`, "warn", true);
    }
    case "fresh":
      return logged({ ...createIcNet(), seq: s.seq }, {}, "Healthy network: every setting back to normal.", "info", true);
  }
}
export const icApply = (s: IcState, a: IcAction) => apply(s, a);
export const icRun = (s: IcState, ...as: IcAction[]) => as.reduce(apply, s);
export const icClone = clone;

// ---------------------------------------------------------------------------------------------------------------
// Reading the evidence
// ---------------------------------------------------------------------------------------------------------------
/** Follow one probe: did each observation point see the request, and did a response come back through it? */
export function icFollow(p: IcProbe): { point: IcPoint; sawRequest: boolean; sawResponse: boolean; note?: string }[] {
  const req = p.frames.length ? p.frames[0].pkt : undefined;
  const reqKey = (f: IcFrame) => req && f.pkt.src === req.src && f.pkt.dst === req.dst && f.pkt.proto === req.proto && f.pkt.kind === req.kind;
  return IC_POINTS.map((point) => {
    const seenReq = p.frames.some((f) => f.kind === "move" && reqKey(f) && (f.out === point || f.in === point));
    const seenResp = p.frames.some((f) => f.kind === "move" && !reqKey(f) && (f.out === point || f.in === point));
    return { point, sawRequest: seenReq, sawResponse: seenResp };
  });
}

/** Plain explanation of one probe: who answered (or what went silent), why, and what it lets you conclude. */
export function icExplain(cfg: IcNetCfg, p: IcProbe): { title: string; who?: IcDev; meaning: string; conclude: string; ok: boolean } {
  if (p.localError) return { ok: false, title: "Refused locally", meaning: `The host itself refused: ${p.localError.replace(/^ping: /, "")}. It already knows a smaller path MTU (learnt from an earlier ICMP 3/4) and -M do forbids fragmenting.`, conclude: "Nothing left the host. The limit came from a Fragmentation Needed message received earlier." };
  const a = p.answer;
  const lastDrop = [...p.frames].reverse().find((f) => f.kind === "drop");
  if (!a) {
    return {
      ok: false,
      title: "Silence — nothing came back",
      meaning: lastDrop ? `The last thing that happened: ${lastDrop.text}.` : "The probe disappeared.",
      conclude: "Silence is evidence, not an answer. Find the last place the probe (or its reply) was seen — a capture, a counter, an ICMP message from an earlier hop — and look just beyond it.",
    };
  }
  const who = p.answerFrom;
  const k = IC_KIND[a.kind ?? "echo-rep"];
  if (a.proto === "tcp") return { ok: true, who, title: "TCP answered", meaning: "The server completed the handshake.", conclude: "The path works both ways for TCP." };
  if (a.kind === "echo-rep") return { ok: true, who, title: `Echo Reply from ${who}`, meaning: `${who} received the Echo Request and its reply came all the way back. The reply arrived with TTL ${a.ttl}: it started at ${who === "R1" || who === "R2" ? ROUTER_ICMP_TTL : INITIAL_TTL}, so ${(who === "R1" || who === "R2" ? ROUTER_ICMP_TTL : INITIAL_TTL) - a.ttl} router(s) forwarded it back.${p.frags ? ` It traveled in ${p.frags} fragments.` : ""}`, conclude: "Proven: IP reachability both ways for this packet size and type. Not proven: other ports or applications, bigger packets, DNS, or the absence of occasional loss." };
  const why =
    a.kind === "ttl"
      ? `The probe's TTL ran out at ${who}: routers subtract 1 before forwarding and a packet that would leave with TTL 0 is dropped${p.ttl >= 8 ? ". Starting at TTL " + p.ttl + ", only a loop can use up that many hops" : ""}.`
      : a.kind === "frag"
        ? `The packet (${a.quote?.len} B, DF set) is bigger than the MTU of ${who}'s next link (${a.mtu}). DF forbids splitting it, so ${who} dropped it and reported the limit.`
        : a.kind === "host"
          ? `${who} has a route to the destination's network, but nothing on that link answered ARP for ${a.quote?.dst}.`
          : a.kind === "net"
            ? `${who} has no route to ${a.quote?.dst}.`
            : `${who === ownerOf(cfg, a.quote?.dst ?? "") ? `${who} itself` : who} received the probe, but nothing listens on UDP port ${a.quote?.dport}.`;
  const conclude =
    a.kind === "ttl"
      ? "The probe reached as far as this router. Traceroute uses exactly this: each TTL reveals the next hop."
      : a.kind === "frag"
        ? `Size, not reachability: packets up to ${a.mtu} B fit. A smaller packet would pass.`
        : a.kind === "port"
          ? "The destination was reached (that's how UDP traceroute knows it arrived)."
          : `Delivery failed at ${who}, and ${who} told you why. The problem is at or just beyond ${who}.`;
  return { ok: a.kind === "port", who, title: `ICMP ${k.type}/${k.code} ${k.short} from ${who} (${a.src})`, meaning: why, conclude };
}

export interface IcProof {
  label: string;
  ok: boolean;
  detail: string;
}
const after = (s: IcState) => s.runs.filter((r) => r.id > s.changeSeq);
const okPingB = (r: IcRun) => r.tool === "ping" && r.dev === "HOST-A" && r.dst === IC_ADDR["HOST-B"] && r.received > 0 && r.received === r.probes.length;
/** Proofs for the active ticket, from the configuration as it is now and the tests run after the last change. */
export function icProofs(s: IcState): IcProof[] {
  if (!s.ticket) return [];
  const runs = after(s);
  const t = s.ticket;
  const sym: IcProof =
    t === "blackhole"
      ? { label: "The big download completes", ok: runs.some((r) => r.tool === "curl" && r.args.file === "big" && r.curl?.ok), detail: "curl -o /dev/null http://198.51.100.20/files/big.iso from HOST-A" }
      : t === "hidden-hop"
        ? { label: "Traceroute shows R2 at hop 2", ok: runs.some((r) => r.tool === "traceroute" && r.dev === "HOST-A" && r.hops?.[1]?.some((p) => p.answerFrom === "R2")), detail: "traceroute from HOST-A to 198.51.100.20" }
        : { label: "HOST-A pings HOST-B with no loss", ok: runs.some(okPingB), detail: "ping 198.51.100.20 from HOST-A, every probe answered" };
  const more: IcProof =
    t === "blackhole" || t === "firewall"
      ? { label: "The small page still loads", ok: runs.some((r) => r.tool === "curl" && r.args.file === "small" && r.curl?.ok), detail: "curl http://198.51.100.20/index.html" }
      : { label: "The whole path answers traceroute", ok: runs.some((r) => r.tool === "traceroute" && r.dev === "HOST-A" && r.dst === IC_ADDR["HOST-B"] && r.hops?.some((h) => h.some((p) => p.answerFrom === "HOST-B")) && (t !== "hidden-hop" || !!r.hops?.[1]?.some((p) => p.answerFrom === "R2"))), detail: "traceroute to HOST-B reaches HOST-B" };
  const changed = s.changeSeq > 0 && s.log.some((l) => l.seq === s.changeSeq && !/^Ticket/.test(l.text));
  return [
    { label: "A configuration change was made on a device", ok: changed, detail: changed ? s.log.find((l) => l.seq === s.changeSeq)!.text : "change the setting that causes it (a device window or its CLI)" },
    sym,
    more,
  ];
}

/** Feedback on a diagnosis, from the configuration and evidence as they are now. Only the root cause is confirmed. */
export function icCauseFeedback(s: IcState, cause: IcCause): { right: boolean; consequence?: boolean; text: string } {
  const t = s.ticket;
  const c = s.cfg;
  const right = !!t && icTicket(t).cause === cause;
  const W = (text: string, consequence = false) => ({ right: false, consequence, text });
  const R = (text: string) => ({ right: true, text: `Right. ${text}` });
  const transit = Math.min(c.R1.ifs.ge1.mtu, c.R2.ifs.ge1.mtu);
  switch (cause) {
    case "pmtud-filtered":
      if (right) return R(`The R1–R2 link carries ${transit} B, so R2 must drop HOST-B's full-size (1500 B, DF) data segments and send ICMP 3/4 back to HOST-B — and HOST-B's own iptables drops every Fragmentation Needed message. HOST-B never learns the path MTU, keeps resending 1500-byte segments, and the transfer hangs silently. Small replies fit, so small things work.`);
      return W(c["HOST-B"].input.some((r) => r.type === "fragmentation-needed" || r.type === "destination-unreachable" || r.type === "all") ? "HOST-B does drop ICMP unreachables — but that isn't what this ticket is about." : "No device filters 3/4 here: HOST-B's iptables has no such rule and R1's WAN-IN permits it.");
    case "mtu-small":
      if (t === "blackhole") return W(`True: the R1–R2 link is ${transit} B (the provider can't change it), and a DF ping bigger than ${transit - 28} B from HOST-A gets a 3/4 back. But a small MTU alone doesn't hang transfers — PMTUD handles it as long as 3/4 messages arrive. Why doesn't HOST-B adapt?`, true);
      return W(`Every link carries ${transit} B or more${transit >= 1500 ? " (1500 everywhere)" : ""}; size isn't what's failing here.`);
    case "hostb-down":
      if (right) return R("R2 has a route to 198.51.100.0/24, but nothing answers ARP for 198.51.100.20: R2 reports ICMP 3/1 Host Unreachable, and traceroute ends with !H at R2. R2's LAN interface is up and R2 answers its own pings — the problem is the host itself.");
      return W(c["HOST-B"].power ? "HOST-B is powered on and answers ARP on its LAN." : "HOST-B is off — but that's not this ticket.");
    case "no-return":
      if (right) return R("R2 has no route to 192.0.2.0/24. Your requests reach R2 and even HOST-B (captures show them arriving), but every reply — HOST-B's Echo Reply, R2's own ICMP — dies at R2. Only R1 answers, because R1's reply never needs R2.");
      return W(c.R2.statics.some((x) => x.prefix === "192.0.2.0") ? "R2 has a route back to 192.0.2.0/24 via 203.0.113.1." : "R2 has no route back — but that's not this ticket.");
    case "hostb-fw":
      if (right) return R("HOST-B's iptables drops ICMP Echo Requests (and hosts send no error for what their firewall drops). The path is fine: traceroute (UDP) reaches HOST-B and gets Port Unreachable, R2 answers ping, and curl works. Monitoring was measuring the firewall, not the server.");
      return W(c["HOST-B"].input.some((r) => r.type === "echo-request" || r.type === "all") ? "HOST-B drops Echo Requests — but that's not this ticket." : "HOST-B's firewall accepts Echo Requests (iptables -L shows no such rule).");
    case "r2-lan-down":
      if (right) return R("R2's ge-0/0/0 is administratively down, so its connected route to 198.51.100.0/24 disappeared. R2's default route (0.0.0.0/0 via R1) then sends HOST-B's traffic back to R1, which sends it to R2 again… until the TTL runs out.");
      return W(c.R2.ifs.ge0.up ? "R2's LAN interface is up (show interfaces terse)." : "R2's LAN interface is down — but that's not this ticket.");
    case "loop":
      if (t === "loop") return W("The loop is real — traceroute alternates R1, R2, R1, R2 and ping gets Time Exceeded — but it's a consequence. Why does R2 send HOST-B's traffic back to R1? Look at R2's interfaces and its routing table.", true);
      return W("No loop: traceroute never revisits a router.");
    case "ttl-filtered":
      if (right) return R("R1's WAN-IN filter (inbound on ge-0/0/1) denies ICMP Time Exceeded. R2 does send 11/0 for TTL-2 probes, but R1 discards it, so hop 2 prints * * *. Hop 3 (HOST-B) answers, R2 answers ping: nothing is down.");
      return W(c.R1.acl?.entries.some((e) => e.action === "deny" && e.icmp === "time-exceeded") ? "R1 does filter Time Exceeded — but that's not this ticket." : "Nothing filters Time Exceeded: WAN-IN permits it.");
    case "r2-down":
      return W(`R2 answers: ${t === "return" ? "R2 is up (its own team confirms, and R2 forwards your requests — captures on R2 show them). It just can't send anything back." : "ping its transit address 203.0.113.2, or look at hop 2 of a UDP traceroute."}`);
    case "dns":
      return W("Every test here uses IP addresses, never names — DNS can't be involved.");
  }
}

/** A short "what this ticket's evidence ladder is about" helper: the run a learner should look at next. */
export const icLastProbe = (r?: IcRun) => (r ? (r.tool === "traceroute" ? r.hops![r.hops!.length - 1][0] : r.probes[r.probes.length - 1]) : undefined);
