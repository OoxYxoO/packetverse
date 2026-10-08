import { V4_IP, V4_MAC, V4_PREFIX, ipToNum, ipv4Checksum, maskOf, networkOf, sameSubnet } from "./ipv4Basics";

/**
 * IPv4 Lab network — the model behind the IPv4 Practice Lab. Pure data + pure functions.
 *
 *   HOST-A (.10) ─┐                                   ┌─ HOST-B (.70)
 *   HOST-C (.30) ─┴ SW-A ── ge-0/0/0 R1 ge-0/0/1 ── SW-B
 *        192.168.10.0/26        .1        .65        192.168.10.64/26
 *
 * The lesson's network (same addresses, MACs and /26s as the guided lesson) plus HOST-C on HOST-A's LAN.
 *
 *   hosts   decide LOCAL or REMOTE by ANDing their OWN address and the destination with THEIR OWN mask; the next hop is
 *           the destination (local) or the default gateway (remote); they ARP for that next hop, then frame the
 *           packet to the next hop's MAC. The IPv4 destination is always the final host.
 *   R1      accepts frames addressed to one of its MACs, removes the Ethernet header, answers packets for its own
 *           addresses, otherwise looks the destination up among its connected networks (interfaces that are up),
 *           drops a packet whose TTL would reach 0 (and tells the sender: ICMP time exceeded), decrements the TTL,
 *           recomputes the header checksum (RFC 791), ARPs for the destination on the outgoing link and builds a NEW
 *           Ethernet frame. Source/destination IPv4 never change. No route → ICMP destination net unreachable.
 *   ARP     live (caches start empty); only the owner of the target address replies and learns the asker. Switches
 *           deliver frames by MAC (they are not this lesson's subject).
 *
 * Traffic is ping (ICMP echo). Every action that sends frames is simulated completely up front and returned as a PLAN
 * of waves (the frames on the wire at one moment) plus the network at each moment; the view plays it.
 */

export type V4H = "hosta" | "hostc" | "hostb";
export type V4R1If = "ge0" | "ge1";
export type V4Dev = V4H | "r1" | "swa" | "swb";
export type V4Iface = "eth0" | V4R1If;
export const V4_BCAST = "FF:FF:FF:FF:FF:FF";
export const V4_ZERO = "00:00:00:00:00:00";

export interface V4HostCfg {
  ip: string;
  prefix: number;
  gw?: string;
}
export interface V4IfCfg {
  ip: string;
  prefix: number;
  up: boolean;
}
export interface V4HostDef {
  name: string;
  os: "windows" | "linux";
  mac: string;
  lan: "A" | "B";
  cfg: V4HostCfg;
  /** The switch port it is cabled to. */
  port: string;
}
export const V4_HOSTS: Record<V4H, V4HostDef> = {
  hosta: { name: "HOST-A", os: "linux", mac: V4_MAC["HOST-A"], lan: "A", port: "SW-A p1", cfg: { ip: V4_IP["HOST-A"], prefix: V4_PREFIX, gw: V4_IP.R1L } },
  hostc: { name: "HOST-C", os: "windows", mac: "00:1A:2B:00:00:0C", lan: "A", port: "SW-A p3", cfg: { ip: "192.168.10.30", prefix: V4_PREFIX, gw: V4_IP.R1L } },
  hostb: { name: "HOST-B", os: "linux", mac: V4_MAC["HOST-B"], lan: "B", port: "SW-B p2", cfg: { ip: V4_IP["HOST-B"], prefix: V4_PREFIX, gw: V4_IP.R1R } },
};
export const V4_HOST_IDS: V4H[] = ["hosta", "hostc", "hostb"];
export const V4_R1: Record<V4R1If, { mac: string; lan: "A" | "B"; cfg: V4IfCfg; desc: string }> = {
  ge0: { mac: V4_MAC.R1L, lan: "A", cfg: { ip: V4_IP.R1L, prefix: V4_PREFIX, up: true }, desc: "LAN A (HOST-A, HOST-C)" },
  ge1: { mac: V4_MAC.R1R, lan: "B", cfg: { ip: V4_IP.R1R, prefix: V4_PREFIX, up: true }, desc: "LAN B (HOST-B)" },
};
export const V4_DEV_NAME: Record<V4Dev, string> = { hosta: "HOST-A", hostc: "HOST-C", hostb: "HOST-B", r1: "R1", swa: "SW-A", swb: "SW-B" };
const LAN_SW: Record<"A" | "B", V4Dev> = { A: "swa", B: "swb" };
export const v4IfName = (i: V4R1If) => (i === "ge0" ? "ge-0/0/0" : "ge-0/0/1");
export const V4_TTL: Record<"windows" | "linux" | "router", number> = { windows: 128, linux: 64, router: 255 };

// ---------------------------------------------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------------------------------------------
export type V4CacheOwner = V4H | "r1";
export interface V4Neighbor {
  ip: string;
  mac?: string;
  state: "reachable" | "failed";
  iface: V4Iface;
}
export type V4Icmp = "echo-request" | "echo-reply" | "time-exceeded" | "net-unreachable";
export interface V4Packet {
  src: string;
  dst: string;
  ttl: number;
  id: number;
  icmp: V4Icmp;
  /** Total length (header + ICMP). */
  len: number;
  checksum: number;
}
export interface V4Frame {
  id: number;
  ethSrc: string;
  ethDst: string;
  type: "ARP" | "IPv4";
  arp?: { op: "request" | "reply"; sip: string; smac: string; tip: string; tmac: string };
  ip?: V4Packet;
}
export interface V4Capture {
  no: number;
  run: number;
  dev: V4H | "r1";
  iface: V4Iface;
  dir: "in" | "out";
  frame: V4Frame;
  note?: string;
}
export interface V4LogEntry {
  id: number;
  text: string;
  kind?: "learn" | "warn" | "info";
}
/** How a sender chose where to send an IPv4 packet. */
export interface V4Decision {
  dev: V4H | "r1";
  iface: V4Iface;
  src: string;
  dst: string;
  prefix: number;
  srcNet: string;
  dstNet: string;
  local: boolean;
  gw?: string;
  nextHop?: string;
  cache: "hit" | "miss" | "no-route";
  ethDst?: string;
  resolved: boolean;
  why: string;
}
/** What R1 did with one IPv4 packet: the forwarding pipeline, step by step. */
export interface V4RouterStep {
  inIface: V4R1If;
  inFrame: V4Frame;
  dst: string;
  forMe: boolean;
  route?: { net: string; prefix: number; iface: V4R1If };
  ttlIn: number;
  ttlOut?: number;
  csumIn: number;
  csumOut?: number;
  outcome: "forwarded" | "local" | "ttl-expired" | "no-route" | "arp-failed";
  arp?: "hit" | "resolved" | "failed";
  outFrame?: V4Frame;
}
export interface V4PingResult {
  run: number;
  src: V4H | "r1";
  dst: string;
  count: number;
  ttl: number;
  replies: { kind: "reply" | "timeout" | "host-unreachable" | "net-unreachable" | "ttl-expired" | "no-route"; from?: string; ttl?: number }[];
  decisions: V4Decision[];
  router: V4RouterStep[];
}
export type V4TicketId = "mask" | "gateway" | "return" | "r1down";
export interface V4NetState {
  seq: number;
  run: number;
  cfg: Record<V4H, V4HostCfg>;
  r1: Record<V4R1If, V4IfCfg>;
  caches: Record<V4CacheOwner, V4Neighbor[]>;
  counters: Record<V4R1If, { in: number; out: number }> & { forwarded: number; ttlExpired: number; noRoute: number };
  captures: V4Capture[];
  capNo: number;
  ipId: number;
  log: V4LogEntry[];
  last?: { type: "ping"; result: V4PingResult } | { type: "other"; text: string };
  ticket?: V4TicketId;
}
export const createV4Net = (): V4NetState => ({
  seq: 0,
  run: 0,
  cfg: { hosta: { ...V4_HOSTS.hosta.cfg }, hostc: { ...V4_HOSTS.hostc.cfg }, hostb: { ...V4_HOSTS.hostb.cfg } },
  r1: { ge0: { ...V4_R1.ge0.cfg }, ge1: { ...V4_R1.ge1.cfg } },
  caches: { hosta: [], hostc: [], hostb: [], r1: [] },
  counters: { ge0: { in: 0, out: 0 }, ge1: { in: 0, out: 0 }, forwarded: 0, ttlExpired: 0, noRoute: 0 },
  captures: [],
  capNo: 0,
  ipId: 0x1a2b,
  log: [{ id: 0, text: "Lab ready: default settings · every ARP cache empty · R1 knows its two connected networks", kind: "info" }],
});

export const v4Checksum = (p: Omit<V4Packet, "checksum">) => ipv4Checksum({ totalLength: p.len, id: p.id, flagsFrag: 0x4000, ttl: p.ttl, protocol: 1, src: p.src, dst: p.dst });
export const hex4 = (n: number) => `0x${n.toString(16).toUpperCase().padStart(4, "0")}`;
/** R1's connected routes: one per interface that is up. */
export const v4Routes = (s: V4NetState) => (["ge0", "ge1"] as V4R1If[]).filter((i) => s.r1[i].up).map((i) => ({ net: networkOf(s.r1[i].ip, s.r1[i].prefix), prefix: s.r1[i].prefix, iface: i }));
export const v4MacOwner = (mac: string): string => {
  const m = mac.toUpperCase();
  if (m === V4_BCAST) return "broadcast";
  for (const h of V4_HOST_IDS) if (V4_HOSTS[h].mac === m) return V4_HOSTS[h].name;
  if (m === V4_R1.ge0.mac) return "R1 ge-0/0/0";
  if (m === V4_R1.ge1.mac) return "R1 ge-0/0/1";
  if (m === V4_ZERO) return "unknown";
  return "nobody";
};
export const v4IpOwners = (s: V4NetState, ip: string) => [...V4_HOST_IDS.filter((h) => s.cfg[h].ip === ip).map((h) => V4_HOSTS[h].name), ...(["ge0", "ge1"] as V4R1If[]).filter((i) => s.r1[i].ip === ip).map((i) => `R1 ${v4IfName(i)}`)];
export const v4Entry = (s: V4NetState, o: V4CacheOwner, ip: string) => s.caches[o].find((e) => e.ip === ip);

// ---------------------------------------------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------------------------------------------
export interface V4WaveCopy {
  from: V4Dev;
  to: V4Dev;
  frame: V4Frame;
  outcome?: "accepted" | "discarded" | "ignored";
}
export interface V4Wave {
  copies: V4WaveCopy[];
  caption: string;
  decision?: V4Decision;
  router?: V4RouterStep;
}
export interface V4Plan {
  run: number;
  label: string;
  waves: V4Wave[];
  snaps: V4NetState[];
}

const clone = (s: V4NetState): V4NetState => ({
  ...s,
  cfg: { hosta: { ...s.cfg.hosta }, hostc: { ...s.cfg.hostc }, hostb: { ...s.cfg.hostb } },
  r1: { ge0: { ...s.r1.ge0 }, ge1: { ...s.r1.ge1 } },
  caches: { hosta: [...s.caches.hosta], hostc: [...s.caches.hostc], hostb: [...s.caches.hostb], r1: [...s.caches.r1] },
  counters: { ge0: { ...s.counters.ge0 }, ge1: { ...s.counters.ge1 }, forwarded: s.counters.forwarded, ttlExpired: s.counters.ttlExpired, noRoute: s.counters.noRoute },
  captures: [...s.captures],
  log: [...s.log],
});
type Station = { dev: V4H | "r1"; iface: V4Iface };
const lanOf = (st: Station): "A" | "B" => (st.dev === "r1" ? V4_R1[st.iface as V4R1If].lan : V4_HOSTS[st.dev].lan);
const macOf = (st: Station) => (st.dev === "r1" ? V4_R1[st.iface as V4R1If].mac : V4_HOSTS[st.dev].mac);

class Sim {
  s: V4NetState;
  waves: V4Wave[] = [];
  snaps: V4NetState[] = [];
  fid = 0;
  constructor(s: V4NetState) {
    this.s = clone(s);
  }
  ipOf(st: Station) {
    return st.dev === "r1" ? this.s.r1[st.iface as V4R1If].ip : this.s.cfg[st.dev].ip;
  }
  up(st: Station) {
    return st.dev === "r1" ? this.s.r1[st.iface as V4R1If].up : true;
  }
  stations(lan: "A" | "B"): Station[] {
    return [...V4_HOST_IDS.filter((h) => V4_HOSTS[h].lan === lan).map((h): Station => ({ dev: h, iface: "eth0" })), ...(["ge0", "ge1"] as V4R1If[]).filter((i) => V4_R1[i].lan === lan).map((i): Station => ({ dev: "r1", iface: i }))].filter((x) => this.up(x));
  }
  log(text: string, kind?: V4LogEntry["kind"]) {
    const id = (this.s.log[this.s.log.length - 1]?.id ?? 0) + 1;
    this.s.log = [...this.s.log, { id, text, kind }].slice(-300);
  }
  capture(st: Station, dir: "in" | "out", frame: V4Frame, note?: string) {
    this.s.capNo += 1;
    this.s.captures = [...this.s.captures, { no: this.s.capNo, run: this.s.run, dev: st.dev, iface: st.iface, dir, frame, note }].slice(-600);
    if (st.dev === "r1") this.s.counters[st.iface as V4R1If][dir === "in" ? "in" : "out"] += 1;
  }
  frame(f: Omit<V4Frame, "id">): V4Frame {
    return { ...f, id: ++this.fid };
  }
  moment(w: V4Wave) {
    this.waves.push({ ...w, decision: w.decision && { ...w.decision }, router: w.router && { ...w.router } });
    this.snaps.push(clone(this.s));
  }
  setEntry(o: V4CacheOwner, e: V4Neighbor) {
    this.s.caches = { ...this.s.caches, [o]: [...this.s.caches[o].filter((x) => x.ip !== e.ip), e] };
  }
  /** One frame from `st` onto its LAN; returns the stations whose NIC accepted it (switches deliver by MAC). */
  transmit(st: Station, f: V4Frame, caption: string, extra: Partial<V4Wave> = {}): Station[] {
    const lan = lanOf(st);
    const sw = LAN_SW[lan];
    const others = this.stations(lan).filter((x) => !(x.dev === st.dev && x.iface === st.iface));
    const bcast = f.ethDst === V4_BCAST;
    const targets = bcast ? others : others.filter((x) => macOf(x) === f.ethDst);
    this.capture(st, "out", f);
    this.moment({ copies: [{ from: st.dev, to: sw, frame: f }], caption, ...extra });
    if (!targets.length) {
      this.log(`${V4_DEV_NAME[sw]}: no port leads to ${f.ethDst} — the frame goes nowhere`, "warn");
      return [];
    }
    const copies: V4WaveCopy[] = targets.map((x) => ({ from: sw, to: x.dev, frame: f, outcome: "accepted" }));
    this.moment({ copies, caption: bcast ? `${V4_DEV_NAME[sw]} floods the broadcast to every station on the LAN` : `${V4_DEV_NAME[sw]} delivers the frame to ${v4MacOwner(f.ethDst)}`, ...extra });
    return targets;
  }
  /** ARP processing at a receiver of a request: only the target learns and replies. */
  arpIn(st: Station, f: V4Frame): boolean {
    const a = f.arp!;
    const me = this.ipOf(st);
    if (a.op === "request") {
      const target = a.tip === me;
      if (target) this.setEntry(st.dev, { ip: a.sip, mac: a.smac, state: "reachable", iface: st.iface });
      this.capture(st, "in", f, target ? `ARP request for ${a.tip}: that's me → learned ${a.sip}, replying` : `ARP request for ${a.tip}: not my address → ignored${st.dev === "r1" ? " (no Proxy ARP)" : ""}`);
      return target;
    }
    this.setEntry(st.dev, { ip: a.sip, mac: a.smac, state: "reachable", iface: st.iface });
    this.capture(st, "in", f, `ARP reply: ${a.sip} is at ${a.smac} → cached`);
    this.log(`${V4_DEV_NAME[st.dev]} learned ${a.sip} → ${a.smac}`, "learn");
    return false;
  }
  /** The next hop's MAC: cache, or ARP. */
  resolve(st: Station, nextHop: string, d?: V4Decision, router?: V4RouterStep): string | undefined {
    const have = v4Entry(this.s, st.dev, nextHop);
    if (have?.state === "reachable" && have.mac) {
      if (d) d.cache = "hit";
      if (router) router.arp = "hit";
      return have.mac;
    }
    if (d) d.cache = "miss";
    const me = this.ipOf(st);
    const mac = macOf(st);
    this.log(`${V4_DEV_NAME[st.dev]}: no ARP entry for ${nextHop} → “who has ${nextHop}? tell ${me}”`);
    const req = this.frame({ ethSrc: mac, ethDst: V4_BCAST, type: "ARP", arp: { op: "request", sip: me, smac: mac, tip: nextHop, tmac: V4_ZERO } });
    const got = this.transmit(st, req, `${V4_DEV_NAME[st.dev]} broadcasts an ARP request: who has ${nextHop}?`, { decision: d, router });
    const owners = got.filter((r) => this.arpIn(r, req));
    for (const o of owners) {
      const omac = macOf(o);
      const rep = this.frame({ ethSrc: omac, ethDst: mac, type: "ARP", arp: { op: "reply", sip: nextHop, smac: omac, tip: me, tmac: mac } });
      const back = this.transmit(o, rep, `${V4_DEV_NAME[o.dev]} owns ${nextHop}: it replies, unicast`, { decision: d, router });
      for (const b of back) if (b.dev === st.dev) this.arpIn(b, rep);
    }
    const e = v4Entry(this.s, st.dev, nextHop);
    if (e?.state === "reachable") {
      if (router) router.arp = "resolved";
      return e.mac;
    }
    this.setEntry(st.dev, { ip: nextHop, state: "failed", iface: st.iface });
    if (router) router.arp = "failed";
    this.log(`${V4_DEV_NAME[st.dev]}: no ARP reply for ${nextHop} — nothing on that link owns it`, "warn");
    this.moment({ copies: [], caption: `No reply: nobody on this link owns ${nextHop}`, decision: d, router });
    return undefined;
  }
  hostDecide(h: V4H, dst: string): V4Decision {
    const c = this.s.cfg[h];
    const local = sameSubnet(c.ip, dst, c.prefix);
    const base = { dev: h, iface: "eth0" as V4Iface, src: c.ip, dst, prefix: c.prefix, srcNet: networkOf(c.ip, c.prefix), dstNet: networkOf(dst, c.prefix), local, gw: c.gw, resolved: false };
    if (local) return { ...base, nextHop: dst, cache: "miss", why: `${dst} AND ${maskOf(c.prefix)} = ${base.dstNet}, the same network as mine (${base.srcNet}/${c.prefix}): LOCAL, so I deliver it myself` };
    if (!c.gw) return { ...base, cache: "no-route", why: `${dst} is on network ${base.dstNet}, not mine (${base.srcNet}/${c.prefix}): REMOTE — and I have no default gateway` };
    return { ...base, nextHop: c.gw, cache: "miss", why: `${dst} is on network ${base.dstNet}, not mine (${base.srcNet}/${c.prefix}): REMOTE, so the frame goes to my default gateway ${c.gw}` };
  }
  packet(src: string, dst: string, icmp: V4Icmp, ttl: number, len = icmp === "time-exceeded" || icmp === "net-unreachable" ? 56 : 60): V4Packet {
    this.s.ipId = (this.s.ipId + 1) & 0xffff;
    const p = { src, dst, ttl, id: this.s.ipId, icmp, len };
    return { ...p, checksum: v4Checksum(p) };
  }
  /** A host sends a packet; follow it. Returns where it ended. */
  hostSend(h: V4H, p: V4Packet, out: V4Decision[], rsteps: V4RouterStep[], depth: number): { ok: boolean; at?: V4H | "r1"; why: string } {
    if (depth > 8) return { ok: false, why: "loop" };
    if (p.dst === this.s.cfg[h].ip) return { ok: true, at: h, why: "self" };
    const d = this.hostDecide(h, p.dst);
    out.push(d);
    if (!d.nextHop) {
      this.log(`${V4_DEV_NAME[h]}: ${d.why}`, "warn");
      return { ok: false, why: "no-route" };
    }
    const st: Station = { dev: h, iface: "eth0" };
    const mac = this.resolve(st, d.nextHop, d);
    if (!mac) return { ok: false, why: "arp" };
    d.ethDst = mac;
    d.resolved = true;
    const f = this.frame({ ethSrc: V4_HOSTS[h].mac, ethDst: mac, type: "IPv4", ip: p });
    const got = this.transmit(st, f, `${V4_DEV_NAME[h]} sends the ${label(p)}: Ethernet to ${v4MacOwner(mac)}, IPv4 to ${p.dst}`, { decision: d });
    return this.deliver(got, f, out, rsteps, depth);
  }
  /** A frame carrying an IPv4 packet arrived at these stations. */
  deliver(got: Station[], f: V4Frame, out: V4Decision[], rsteps: V4RouterStep[], depth: number): { ok: boolean; at?: V4H | "r1"; why: string } {
    const rx = got[0];
    if (!rx) return { ok: false, why: "lost" };
    const p = f.ip!;
    if (rx.dev === "r1") return this.route(rx.iface as V4R1If, f, out, rsteps, depth);
    const h = rx.dev;
    if (p.dst !== this.s.cfg[h].ip) {
      this.capture(rx, "in", f, `frame for my MAC, but the packet is for ${p.dst} — not me, and I don't route → dropped`);
      return { ok: false, why: "lost" };
    }
    this.capture(rx, "in", f, p.icmp === "echo-request" ? "echo request for me → replying" : p.icmp === "echo-reply" ? "echo reply for me" : p.icmp === "time-exceeded" ? "ICMP time exceeded for me" : "ICMP net unreachable for me");
    if (p.icmp === "echo-request") {
      const arrived = this.s.captures[this.s.captures.length - 1];
      const r = this.hostSend(h, this.packet(p.dst, p.src, "echo-reply", V4_TTL[V4_HOSTS[h].os], p.len), out, rsteps, depth + 1);
      // the reply never left: say so on the request's capture line (same moment — no frame was sent)
      if (!r.ok && r.why === "no-route") this.s.captures = this.s.captures.map((c) => (c === arrived ? { ...c, note: `echo request for me → the reply to ${p.src} is remote and I have no default gateway: not sent` } : c));
      return r;
    }
    return { ok: true, at: h, why: p.icmp };
  }
  /** R1's forwarding pipeline. */
  route(inIf: V4R1If, f: V4Frame, out: V4Decision[], rsteps: V4RouterStep[], depth: number): { ok: boolean; at?: V4H | "r1"; why: string } {
    const p = f.ip!;
    const ownIps = (["ge0", "ge1"] as V4R1If[]).filter((i) => this.s.r1[i].up).map((i) => this.s.r1[i].ip);
    const r: V4RouterStep = { inIface: inIf, inFrame: f, dst: p.dst, forMe: ownIps.includes(p.dst), ttlIn: p.ttl, csumIn: p.checksum, outcome: "forwarded" };
    rsteps.push(r);
    const inSt: Station = { dev: "r1", iface: inIf };
    if (r.forMe) {
      r.outcome = "local";
      this.capture(inSt, "in", f, `frame for my MAC; packet for my own address ${p.dst} → handled by R1 itself`);
      if (p.icmp !== "echo-request") return { ok: true, at: "r1", why: p.icmp };
      return this.routerOriginate(this.packet(p.dst, p.src, "echo-reply", V4_TTL.router, p.len), out, rsteps, depth + 1, r);
    }
    const route = v4Routes(this.s).find((x) => sameSubnet(p.dst, x.net, x.prefix));
    r.route = route;
    if (!route) {
      r.outcome = "no-route";
      this.s.counters.noRoute += 1;
      this.capture(inSt, "in", f, `frame for my MAC → Ethernet header removed · no route to ${p.dst} → dropped, “net unreachable” sent back`);
      this.log(`R1: no route to ${p.dst} — dropped; ICMP destination net unreachable to ${p.src}`, "warn");
      this.moment({ copies: [], caption: `R1 has no route to ${p.dst}: the packet is dropped`, router: r });
      if (p.icmp !== "echo-request") return { ok: false, why: "no-route" };
      this.routerOriginate(this.packet(this.s.r1[inIf].ip, p.src, "net-unreachable", V4_TTL.router), out, rsteps, depth + 1, r);
      return { ok: false, why: "unreachable" };
    }
    if (p.ttl <= 1) {
      r.outcome = "ttl-expired";
      this.s.counters.ttlExpired += 1;
      this.capture(inSt, "in", f, `frame for my MAC → Ethernet header removed · TTL ${p.ttl} would reach 0 → dropped, “time exceeded” sent back`);
      this.log(`R1: TTL ${p.ttl} expires here — packet dropped; ICMP time exceeded to ${p.src}`, "warn");
      this.moment({ copies: [], caption: `TTL ${p.ttl} − 1 = 0: R1 drops the packet`, router: r });
      if (p.icmp !== "echo-request") return { ok: false, why: "ttl" };
      this.routerOriginate(this.packet(this.s.r1[inIf].ip, p.src, "time-exceeded", V4_TTL.router), out, rsteps, depth + 1, r);
      return { ok: false, why: "ttl" };
    }
    const ttl = p.ttl - 1;
    const np: V4Packet = { ...p, ttl, checksum: v4Checksum({ ...p, ttl }) };
    r.ttlOut = ttl;
    r.csumOut = np.checksum;
    this.capture(inSt, "in", f, `frame for my MAC → Ethernet header removed · ${p.dst} ∈ ${route.net}/${route.prefix} (connected, ${v4IfName(route.iface)}) · TTL ${p.ttl} → ${ttl} · checksum ${hex4(p.checksum)} → ${hex4(np.checksum)}`);
    const egress: Station = { dev: "r1", iface: route.iface };
    const d: V4Decision = { dev: "r1", iface: route.iface, src: p.src, dst: p.dst, prefix: route.prefix, srcNet: "-", dstNet: route.net, local: true, nextHop: p.dst, cache: "miss", resolved: false, why: `${p.dst} is in ${route.net}/${route.prefix}, connected on ${v4IfName(route.iface)}: R1 delivers it there, so it needs ${p.dst}'s MAC on that link` };
    out.push(d);
    const mac = this.resolve(egress, p.dst, d, r);
    if (!mac) {
      r.outcome = "arp-failed";
      return { ok: false, why: "lost" };
    }
    d.ethDst = mac;
    d.resolved = true;
    const nf = this.frame({ ethSrc: V4_R1[route.iface].mac, ethDst: mac, type: "IPv4", ip: np });
    r.outFrame = nf;
    this.s.counters.forwarded += 1;
    this.log(`R1 forwarded ${p.src} → ${p.dst}: TTL ${p.ttl}→${ttl}, new Ethernet header ${V4_R1[route.iface].mac} → ${mac}`, "learn");
    const got = this.transmit(egress, nf, `R1 forwards it out ${v4IfName(route.iface)}: NEW Ethernet header, same IPv4 addresses, TTL ${ttl}`, { decision: d, router: r });
    return this.deliver(got, nf, out, rsteps, depth + 1);
  }
  /** A packet R1 itself originates (echo reply, ICMP error). */
  routerOriginate(p: V4Packet, out: V4Decision[], rsteps: V4RouterStep[], depth: number, cause: V4RouterStep): { ok: boolean; at?: V4H | "r1"; why: string } {
    void cause;
    const route = v4Routes(this.s).find((x) => sameSubnet(p.dst, x.net, x.prefix));
    if (!route) return { ok: false, why: "no-route" };
    const st: Station = { dev: "r1", iface: route.iface };
    const d: V4Decision = { dev: "r1", iface: route.iface, src: p.src, dst: p.dst, prefix: route.prefix, srcNet: "-", dstNet: route.net, local: true, nextHop: p.dst, cache: "miss", resolved: false, why: `R1 answers ${p.dst}, on its connected network ${route.net}/${route.prefix} (${v4IfName(route.iface)})` };
    out.push(d);
    const mac = this.resolve(st, p.dst, d);
    if (!mac) return { ok: false, why: "arp" };
    d.ethDst = mac;
    d.resolved = true;
    const f = this.frame({ ethSrc: V4_R1[route.iface].mac, ethDst: mac, type: "IPv4", ip: p });
    const got = this.transmit(st, f, `R1 sends ${label(p)} to ${p.dst}`, { decision: d });
    return this.deliver(got, f, out, rsteps, depth + 1);
  }
}
const label = (p: V4Packet) => (p.icmp === "echo-request" ? "ping (echo request)" : p.icmp === "echo-reply" ? "echo reply" : p.icmp === "time-exceeded" ? "ICMP “time exceeded”" : "ICMP “net unreachable”");

// ---------------------------------------------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------------------------------------------
export type V4Action =
  | { type: "ping"; src: V4H | "r1"; dst: string; count?: number; ttl?: number }
  | { type: "host-cfg"; host: V4H; cfg: V4HostCfg }
  | { type: "r1-cfg"; r1: Record<V4R1If, V4IfCfg>; line: string }
  | { type: "clear-cache"; owner: V4CacheOwner }
  | { type: "ticket"; id: V4TicketId }
  | { type: "fresh" };

function planPing(s0: V4NetState, a: Extract<V4Action, { type: "ping" }>): V4Plan {
  const sim = new Sim({ ...s0, run: s0.run + 1, seq: s0.seq + 1 });
  const count = Math.max(1, Math.min(a.count ?? 1, 10));
  const srcOs = a.src === "r1" ? "router" : V4_HOSTS[a.src].os;
  const ttl = Math.max(1, Math.min(a.ttl ?? V4_TTL[srcOs], 255));
  const decisions: V4Decision[] = [];
  const router: V4RouterStep[] = [];
  const replies: V4PingResult["replies"] = [];
  sim.log(`${V4_DEV_NAME[a.src]} pings ${a.dst}${count > 1 ? ` (${count} echoes)` : ""}${a.ttl ? ` with TTL ${ttl}` : ""}`, "info");
  for (let i = 0; i < count; i++) {
    const mark = sim.waves.length;
    const dec: V4Decision[] = [];
    const rst: V4RouterStep[] = [];
    let r: { ok: boolean; at?: V4H | "r1"; why: string };
    if (a.src === "r1") {
      const route = v4Routes(sim.s).find((x) => sameSubnet(a.dst, x.net, x.prefix));
      const srcIp = route ? sim.s.r1[route.iface].ip : sim.s.r1.ge0.ip;
      if (!route) {
        r = { ok: false, why: "no-route" };
        dec.push({ dev: "r1", iface: "ge0", src: srcIp, dst: a.dst, prefix: 0, srcNet: "-", dstNet: "-", local: false, cache: "no-route", resolved: false, why: `R1 has no route to ${a.dst}` });
      } else {
        const p = sim.packet(srcIp, a.dst, "echo-request", ttl, 100);
        r = sim.routerOriginate(p, dec, rst, 0, { inIface: route.iface, inFrame: { id: 0, ethSrc: "", ethDst: "", type: "IPv4" }, dst: a.dst, forMe: false, ttlIn: ttl, csumIn: 0, outcome: "local" });
      }
    } else {
      r = sim.hostSend(a.src, sim.packet(sim.s.cfg[a.src].ip, a.dst, "echo-request", ttl, V4_HOSTS[a.src].os === "windows" ? 60 : 84), dec, rst, 0);
    }
    if (i === 0) {
      decisions.push(...dec);
      router.push(...rst);
    } else {
      sim.waves.splice(mark);
      sim.snaps.splice(mark);
    }
    const first = dec[0];
    const err = rst.find((x) => x.outcome === "ttl-expired" || x.outcome === "no-route");
    const replyTtl = (() => {
      const c = [...sim.s.captures].reverse().find((x) => x.dev === a.src && x.dir === "in" && x.frame.ip?.icmp === "echo-reply");
      return c?.frame.ip?.ttl;
    })();
    replies.push(
      r.ok && r.at === a.src && r.why === "echo-reply"
        ? { kind: "reply", from: a.dst, ttl: replyTtl }
        : err && (r.ok || r.why === "ttl" || r.why === "unreachable")
          ? { kind: err.outcome === "ttl-expired" ? "ttl-expired" : "net-unreachable", from: sim.s.r1[err.inIface].ip }
          : first?.cache === "no-route"
            ? { kind: "no-route" }
            : r.why === "arp" && dec.length === 1
              ? { kind: "host-unreachable", from: first?.src }
              : { kind: "timeout" },
    );
  }
  const result: V4PingResult = { run: sim.s.run, src: a.src, dst: a.dst, count, ttl, replies, decisions, router };
  sim.s.last = { type: "ping", result };
  const ok = replies.filter((x) => x.kind === "reply").length;
  sim.log(`${V4_DEV_NAME[a.src]} → ${a.dst}: ${ok}/${count} replies`, ok ? "info" : "warn");
  sim.snaps.push(clone(sim.s));
  if (!sim.waves.length) sim.snaps = [clone(sim.s)];
  return { run: sim.s.run, label: `${V4_DEV_NAME[a.src]} pings ${a.dst}`, waves: sim.waves, snaps: sim.snaps };
}

function pushLog(s: V4NetState, text: string, kind?: V4LogEntry["kind"]) {
  const id = (s.log[s.log.length - 1]?.id ?? 0) + 1;
  return [...s.log, { id, text, kind }].slice(-300);
}
const TICKET_SETUP: Record<V4TicketId, V4Action[]> = {
  mask: [{ type: "host-cfg", host: "hosta", cfg: { ip: V4_IP["HOST-A"], prefix: 24, gw: V4_IP.R1L } }],
  gateway: [{ type: "host-cfg", host: "hosta", cfg: { ip: V4_IP["HOST-A"], prefix: V4_PREFIX, gw: "192.168.10.2" } }],
  return: [{ type: "host-cfg", host: "hostb", cfg: { ip: V4_IP["HOST-B"], prefix: V4_PREFIX } }],
  r1down: [{ type: "r1-cfg", r1: { ge0: { ...V4_R1.ge0.cfg }, ge1: { ...V4_R1.ge1.cfg, up: false } }, line: "interface ge-0/0/1 disabled" }],
};
export const V4_TICKETS: Record<V4TicketId, { title: string; report: string; target: { src: V4H; dst: string } }> = {
  mask: { title: "HOST-A can't reach HOST-B", report: "“HOST-A reaches HOST-C fine, but pings to HOST-B say Destination Host Unreachable. Someone touched HOST-A's network settings yesterday.”", target: { src: "hosta", dst: V4_IP["HOST-B"] } },
  gateway: { title: "HOST-A can't leave its LAN", report: "“HOST-A can ping HOST-C, never HOST-B. HOST-C reaches HOST-B without problems.”", target: { src: "hosta", dst: V4_IP["HOST-B"] } },
  return: { title: "Pings to HOST-B time out", report: "“HOST-A's pings to HOST-B just time out — no error, nothing. HOST-B's owner swears HOST-B sees the pings arrive.”", target: { src: "hosta", dst: V4_IP["HOST-B"] } },
  r1down: { title: "Nobody on LAN A reaches LAN B", report: "“HOST-A and HOST-C both get ‘Destination Net Unreachable’ for HOST-B. They can still ping R1 at 192.168.10.1.”", target: { src: "hosta", dst: V4_IP["HOST-B"] } },
};

function applyInstant(s: V4NetState, a: Exclude<V4Action, { type: "ping" }>): V4NetState {
  const n = { ...clone(s), seq: s.seq + 1 };
  switch (a.type) {
    case "host-cfg": {
      const o = s.cfg[a.host];
      n.cfg[a.host] = { ...a.cfg };
      if (o.ip !== a.cfg.ip || o.prefix !== a.cfg.prefix) n.caches[a.host] = [];
      n.log = pushLog(n, `${V4_HOSTS[a.host].name} settings: ${a.cfg.ip}/${a.cfg.prefix} (mask ${maskOf(a.cfg.prefix)}), gateway ${a.cfg.gw ?? "none"}`, "info");
      n.last = { type: "other", text: "host settings changed" };
      return n;
    }
    case "r1-cfg": {
      n.r1 = { ge0: { ...a.r1.ge0 }, ge1: { ...a.r1.ge1 } };
      for (const i of ["ge0", "ge1"] as V4R1If[]) if (!a.r1[i].up || a.r1[i].ip !== s.r1[i].ip || a.r1[i].prefix !== s.r1[i].prefix) n.caches.r1 = n.caches.r1.filter((e) => e.iface !== i);
      n.log = pushLog(n, `R1 configuration: ${a.line}`, "info");
      n.last = { type: "other", text: "R1 configuration changed" };
      return n;
    }
    case "clear-cache":
      n.caches[a.owner] = [];
      n.log = pushLog(n, `${V4_DEV_NAME[a.owner]}'s ARP cache cleared`, "info");
      n.last = { type: "other", text: "ARP cache cleared" };
      return n;
    case "ticket": {
      let t: V4NetState = { ...createV4Net(), seq: s.seq + 1, run: s.run, capNo: s.capNo, log: s.log };
      t = v4RunAll(t, TICKET_SETUP[a.id]);
      return { ...t, captures: [], counters: createV4Net().counters, ticket: a.id, last: { type: "other", text: "ticket" }, log: pushLog(t, `Ticket: ${V4_TICKETS[a.id].title}`, "warn") };
    }
    case "fresh": {
      const f = createV4Net();
      return { ...f, seq: s.seq + 1, run: s.run, capNo: s.capNo, log: pushLog(s, "A fresh network: default settings, every ARP cache empty", "info") };
    }
  }
}
export function v4Plan(s: V4NetState, a: V4Action): V4Plan {
  if (a.type === "ping") return planPing(s, a);
  return { run: s.run, label: a.type, waves: [], snaps: [applyInstant(s, a)] };
}
export const v4Apply = (s: V4NetState, a: V4Action) => {
  const p = v4Plan(s, a);
  return p.snaps[p.snaps.length - 1];
};
export const v4RunAll = (s: V4NetState, as: V4Action[]) => as.reduce(v4Apply, s);
export const v4IpNum = ipToNum;
