import { ADDR } from "./firstConnection";

/**
 * ARP Lab network — the model behind the ARP Lab. Pure data + pure functions.
 *
 * The lesson's network (Laptop on SW1 Fa0/1, R1 on Fa0/2, Server behind R1), with two more hosts on the same LAN so
 * local ARP can be seen: PC-B on Fa0/3 and PC-C on Fa0/4 (the addresses the ARP presentation already uses).
 *
 *   hosts     decide local/remote from their OWN address and mask, pick the next hop (the destination itself, or the
 *             default gateway), look it up in their ARP cache, ARP for it on a miss, then frame the IP packet
 *   SW1       learns SOURCE MACs per port and floods broadcasts / unknown destinations; it never reads ARP
 *   R1        answers ARP for its own interface addresses, routes between its two connected subnets, and ARPs on the
 *             outgoing side for the next hop, rebuilding the Ethernet header (the IP header is unchanged)
 *   ARP rules a receiver of a request whose target IP is its own learns the sender and replies by unicast; every
 *             other receiver only refreshes an entry it already had (RFC 826 merge). Static entries never change.
 *
 * Animation: an action that sends frames is simulated completely up front and returned as a PLAN of waves (the
 * frame copies on the wire at one moment) plus the network state at each moment. The view plays the plan; every
 * table, capture and terminal reads the state of the moment shown, so the animation and the evidence always agree.
 */

export type ArpHost = "laptop" | "pcb" | "pcc" | "server";
export type ArpDev = ArpHost | "sw1" | "r1";
export type SwPort = "fa1" | "fa2" | "fa3" | "fa4";
export type RIf = "gi0" | "gi1";
export type ArpIface = "eth0" | SwPort | RIf;

export const BCAST = "FF:FF:FF:FF:FF:FF";
export const ZERO_MAC = "00:00:00:00:00:00";
export const HOST_AGING = 120;
export const ROUTER_AGING = 1200;
export const SW_AGING = 300;

export interface HostCfg {
  ip: string;
  prefix: number;
  gw?: string;
}
export interface HostDef {
  name: string;
  os: "windows" | "linux";
  mac: string;
  cfg: HostCfg;
}
export const HOSTS: Record<ArpHost, HostDef> = {
  laptop: { name: "Laptop", os: "windows", mac: ADDR.laptop.mac, cfg: { ip: ADDR.laptop.ip, prefix: 24, gw: ADDR.gateway.ip } },
  pcb: { name: "PC-B", os: "linux", mac: "02:AA:00:00:00:20", cfg: { ip: "192.168.10.20", prefix: 24, gw: ADDR.gateway.ip } },
  pcc: { name: "PC-C", os: "windows", mac: "02:AA:00:00:00:30", cfg: { ip: "192.168.10.30", prefix: 24, gw: ADDR.gateway.ip } },
  server: { name: "Server", os: "linux", mac: ADDR.server.mac, cfg: { ip: ADDR.server.ip, prefix: 24, gw: ADDR.routerWan.ip } },
};
export const ARP_HOSTS: ArpHost[] = ["laptop", "pcb", "pcc", "server"];
export const R1_IFS: Record<RIf, { ip: string; prefix: number; mac: string; net: string }> = {
  gi0: { ip: ADDR.gateway.ip, prefix: 24, mac: ADDR.gateway.mac, net: "192.168.10.0/24" },
  gi1: { ip: ADDR.routerWan.ip, prefix: 24, mac: ADDR.routerWan.mac, net: "10.20.20.0/24" },
};
export const SW_PORTS: SwPort[] = ["fa1", "fa2", "fa3", "fa4"];
/** What each SW1 port is cabled to. */
export const SW_PORT_PEER: Record<SwPort, ArpDev> = { fa1: "laptop", fa2: "r1", fa3: "pcb", fa4: "pcc" };
export const DEV_NAME: Record<ArpDev, string> = { laptop: "Laptop", pcb: "PC-B", pcc: "PC-C", server: "Server", sw1: "SW1", r1: "R1" };

// ---------------------------------------------------------------------------------------------------------------
// IPv4 helpers
// ---------------------------------------------------------------------------------------------------------------
export const ipInt = (ip: string) => ip.split(".").reduce((a, o) => (a << 8) + Number(o), 0) >>> 0;
export const intIp = (n: number) => [24, 16, 8, 0].map((s) => (n >>> s) & 255).join(".");
export const maskOf = (prefix: number) => intIp(prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0);
export const netOf = (ip: string, prefix: number) => intIp((ipInt(ip) & ipInt(maskOf(prefix))) >>> 0);
export const sameNet = (a: string, b: string, prefix: number) => netOf(a, prefix) === netOf(b, prefix);
export const isIp = (s: string) => /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(s) && s.split(".").every((o) => Number(o) <= 255);
export const prefixOfMask = (mask: string) => {
  if (!isIp(mask)) return undefined;
  const n = ipInt(mask);
  const p = n.toString(2).replace(/0+$/, "").length;
  return maskOf(p) === mask && !/0/.test(n.toString(2).padStart(32, "0").slice(0, p)) ? p : undefined;
};

// ---------------------------------------------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------------------------------------------
export type CacheOwner = ArpHost | "r1";
export interface NeighborEntry {
  ip: string;
  mac?: string;
  state: "reachable" | "incomplete" | "failed";
  static?: boolean;
  /** Clock when learned or last refreshed. */
  at: number;
  /** R1: the interface it was learned on. Hosts: eth0. */
  iface: ArpIface;
}
export interface ArpFrame {
  id: number;
  ethSrc: string;
  ethDst: string;
  type: "ARP" | "IPv4";
  arp?: { op: "request" | "reply"; sip: string; smac: string; tip: string; tmac: string };
  ip?: { src: string; dst: string; icmp: "echo-request" | "echo-reply" | "net-unreachable"; ttl: number };
}
export interface ArpCapture {
  no: number;
  run: number;
  dev: ArpDev;
  iface: ArpIface;
  dir: "in" | "out";
  frame: ArpFrame;
  /** What the device did with an arriving frame. */
  note?: string;
}
export interface ArpLogEntry {
  id: number;
  clock: number;
  text: string;
  kind?: "learn" | "warn" | "info";
}
/** How a sender chose where to send an IP packet — the heart of ARP. */
export interface SendDecision {
  dev: ArpHost | "r1";
  iface: ArpIface;
  src: string;
  dst: string;
  local: boolean;
  /** The sender's own network, as its mask makes it ("192.168.10.0/24"). */
  myNet: string;
  nextHop?: string;
  why: string;
  cache: "hit" | "miss" | "static" | "no-route";
  /** The MAC the frame was addressed to, once known. */
  ethDst?: string;
  resolved: boolean;
}
export interface PingResult {
  run: number;
  src: ArpHost | "r1";
  dst: string;
  count: number;
  /** One per echo: what came back. */
  replies: { kind: "reply" | "timeout" | "host-unreachable" | "net-unreachable" | "no-route"; from?: string; ttl?: number }[];
  decisions: SendDecision[];
  /** The source ARPed (first echo). */
  arped: boolean;
}

export type ArpTicketId = "gateway" | "mask" | "static" | "dupip" | "port";
export interface ArpNetState {
  clock: number;
  seq: number;
  run: number;
  cfg: Record<ArpHost, HostCfg>;
  power: Record<ArpHost, boolean>;
  caches: Record<CacheOwner, NeighborEntry[]>;
  swMac: Record<string, { port: SwPort; at: number }>;
  swShut: SwPort[];
  captures: ArpCapture[];
  capNo: number;
  log: ArpLogEntry[];
  last?: { type: "ping"; result: PingResult } | { type: "other"; text: string };
  ticket?: ArpTicketId;
}

export const createArpNet = (): ArpNetState => ({
  clock: 0,
  seq: 0,
  run: 0,
  cfg: { laptop: { ...HOSTS.laptop.cfg }, pcb: { ...HOSTS.pcb.cfg }, pcc: { ...HOSTS.pcc.cfg }, server: { ...HOSTS.server.cfg } },
  power: { laptop: true, pcb: true, pcc: true, server: true },
  caches: { laptop: [], pcb: [], pcc: [], server: [], r1: [] },
  swMac: {},
  swShut: [],
  captures: [],
  capNo: 0,
  log: [{ id: 0, clock: 0, text: "Lab ready: every ARP cache and SW1's MAC table are empty", kind: "info" }],
});

export const ownerName = (o: CacheOwner) => DEV_NAME[o];
export const macOwner = (mac: string): string => {
  const m = mac.toUpperCase();
  if (m === BCAST) return "broadcast";
  for (const h of ARP_HOSTS) if (HOSTS[h].mac === m) return HOSTS[h].name;
  if (m === R1_IFS.gi0.mac) return "R1 Gi0/0";
  if (m === R1_IFS.gi1.mac) return "R1 Gi0/1";
  if (m === ZERO_MAC) return "unknown";
  return "nobody";
};
/** Who owns an IP right now (hosts may be misconfigured). */
export const ipOwners = (s: ArpNetState, ip: string): string[] => [...ARP_HOSTS.filter((h) => s.cfg[h].ip === ip).map((h) => HOSTS[h].name), ...(Object.keys(R1_IFS) as RIf[]).filter((i) => R1_IFS[i].ip === ip).map((i) => `R1 ${i === "gi0" ? "Gi0/0" : "Gi0/1"}`)];
export const cacheOf = (s: ArpNetState, o: CacheOwner) => s.caches[o];
export const entryFor = (s: ArpNetState, o: CacheOwner, ip: string) => s.caches[o].find((e) => e.ip === ip);
export const entryAge = (s: ArpNetState, e: NeighborEntry) => s.clock - e.at;
export const hostLinkUp = (s: ArpNetState, h: ArpHost) => s.power[h] && (h === "server" || !s.swShut.includes(hostPort(h)!));
export const hostPort = (h: ArpHost): SwPort | undefined => (h === "laptop" ? "fa1" : h === "pcb" ? "fa3" : h === "pcc" ? "fa4" : undefined);
export const portUp = (s: ArpNetState, p: SwPort) => !s.swShut.includes(p) && (SW_PORT_PEER[p] === "r1" || s.power[SW_PORT_PEER[p] as ArpHost]);

// ---------------------------------------------------------------------------------------------------------------
// Plans: waves of frame copies, and the state at each moment
// ---------------------------------------------------------------------------------------------------------------
export interface WaveCopy {
  from: ArpDev;
  to: ArpDev;
  fromIf: ArpIface;
  toIf: ArpIface;
  frame: ArpFrame;
  /** What the receiver did (set when it arrives). */
  outcome?: "accepted" | "discarded" | "ignored" | "forwarded" | "flooded" | "dropped";
}
export interface Wave {
  copies: WaveCopy[];
  caption: string;
  /** The sender's decision that produced this wave (shown while it is on the wire). */
  decision?: SendDecision;
}
export interface ArpPlan {
  run: number;
  label: string;
  waves: Wave[];
  /** snaps[k] = the network while wave k is on the wire; snaps[waves.length] = after the last arrival. */
  snaps: ArpNetState[];
}

const clone = (s: ArpNetState): ArpNetState => ({
  ...s,
  cfg: { laptop: { ...s.cfg.laptop }, pcb: { ...s.cfg.pcb }, pcc: { ...s.cfg.pcc }, server: { ...s.cfg.server } },
  power: { ...s.power },
  caches: { laptop: [...s.caches.laptop], pcb: [...s.caches.pcb], pcc: [...s.caches.pcc], server: [...s.caches.server], r1: [...s.caches.r1] },
  swMac: { ...s.swMac },
  swShut: [...s.swShut],
  captures: [...s.captures],
  log: [...s.log],
});

const ifMac = (dev: ArpDev, iface: ArpIface) => (dev === "r1" ? R1_IFS[iface as RIf].mac : HOSTS[dev as ArpHost].mac);
const ifIp = (s: ArpNetState, dev: ArpHost | "r1", iface: ArpIface) => (dev === "r1" ? R1_IFS[iface as RIf].ip : s.cfg[dev].ip);
const rIfName = (i: RIf) => (i === "gi0" ? "Gi0/0" : "Gi0/1");
const portName = (p: SwPort) => `Fa0/${p.slice(2)}`;

class Sim {
  s: ArpNetState;
  waves: Wave[] = [];
  snaps: ArpNetState[] = [];
  fid = 0;
  constructor(s: ArpNetState) {
    this.s = clone(s);
  }
  log(text: string, kind?: ArpLogEntry["kind"]) {
    const id = (this.s.log[this.s.log.length - 1]?.id ?? 0) + 1;
    this.s.log = [...this.s.log, { id, clock: this.s.clock, text, kind }].slice(-300);
  }
  capture(dev: ArpDev, iface: ArpIface, dir: "in" | "out", frame: ArpFrame, note?: string) {
    this.s.capNo += 1;
    this.s.captures = [...this.s.captures, { no: this.s.capNo, run: this.s.run, dev, iface, dir, frame, note }].slice(-600);
  }
  frame(f: Omit<ArpFrame, "id">): ArpFrame {
    return { ...f, id: ++this.fid };
  }
  /** Put copies on the wire (captured as they leave) and record the moment. */
  flight(copies: WaveCopy[], caption: string, decision?: SendDecision) {
    for (const c of copies) if (c.from !== "sw1") this.capture(c.from, c.fromIf, "out", c.frame);
    // the decision as it stands at this moment (it is completed later, when the reply arrives)
    this.waves.push({ copies, caption, decision: decision && { ...decision } });
    this.snaps.push(clone(this.s));
  }
  setEntry(o: CacheOwner, e: NeighborEntry) {
    this.s.caches = { ...this.s.caches, [o]: [...this.s.caches[o].filter((x) => x.ip !== e.ip), e] };
  }
  /** One frame from `dev` out of `iface`; returns the devices that accepted it (with the interface it arrived on). */
  transmit(dev: ArpDev, iface: ArpIface, frame: ArpFrame, caption: string, decision?: SendDecision): { dev: ArpDev; iface: ArpIface }[] {
    const s = this.s;
    // the link at the sender's end
    let peer: { dev: ArpDev; iface: ArpIface } | undefined;
    if (dev === "server") peer = s.power.server ? { dev: "r1", iface: "gi1" } : undefined;
    else if (dev === "r1" && iface === "gi1") peer = s.power.server ? { dev: "server", iface: "eth0" } : undefined;
    else if (dev === "r1") peer = s.swShut.includes("fa2") ? undefined : { dev: "sw1", iface: "fa2" };
    else {
      const p = hostPort(dev as ArpHost)!;
      peer = hostLinkUp(s, dev as ArpHost) ? { dev: "sw1", iface: p } : undefined;
    }
    if (!peer) {
      this.capture(dev as ArpDev, iface, "out", frame, "no link: the frame went nowhere");
      this.log(`${DEV_NAME[dev]} has no link on ${iface}: the frame went nowhere`, "warn");
      return [];
    }
    const first: WaveCopy = { from: dev, to: peer.dev, fromIf: iface, toIf: peer.iface, frame };
    this.flight([first], caption, decision);
    if (peer.dev !== "sw1") return this.receive(first) ? [{ dev: peer.dev, iface: peer.iface }] : [];
    // SW1: learn the source, then flood or forward
    const ingress = peer.iface as SwPort;
    const known = this.s.swMac[frame.ethSrc];
    if (known && known.port !== ingress) this.log(`SW1: ${frame.ethSrc} moved from ${portName(known.port)} to ${portName(ingress)}`, "warn");
    this.s.swMac = { ...this.s.swMac, [frame.ethSrc]: { port: ingress, at: this.s.clock } };
    if (!known) this.log(`SW1 learned ${frame.ethSrc} on ${portName(ingress)} (from the frame's SOURCE MAC)`, "learn");
    const dst = this.s.swMac[frame.ethDst];
    const bcast = frame.ethDst === BCAST;
    const egress = bcast || !dst ? SW_PORTS.filter((p) => p !== ingress && portUp(this.s, p)) : dst.port !== ingress && portUp(this.s, dst.port) ? [dst.port] : [];
    const how = bcast ? "broadcast → flood" : !dst ? "unknown destination → flood" : egress.length ? `known → ${portName(dst.port)}` : dst.port === ingress ? "destination is behind the ingress port → filter" : `known → ${portName(dst.port)}, but that port is down → drop`;
    this.capture("sw1", ingress, "in", frame, `learned source on ${portName(ingress)} · ${how}`);
    first.outcome = egress.length ? (bcast || !dst ? "flooded" : "forwarded") : "dropped";
    if (!egress.length) return [];
    for (const p of egress) this.capture("sw1", p, "out", frame);
    const copies: WaveCopy[] = egress.map((p) => {
      const to = SW_PORT_PEER[p];
      return { from: "sw1", to, fromIf: p, toIf: to === "r1" ? "gi0" : "eth0", frame };
    });
    this.flight(copies, bcast ? "SW1 floods the broadcast out every other port" : !dst ? "SW1 doesn't know that MAC: it floods" : `SW1 knows that MAC on ${portName(dst.port)}: it forwards out that port only`, decision);
    return copies.filter((c) => this.receive(c)).map((c) => ({ dev: c.to, iface: c.toIf }));
  }
  /** A copy arrives at an end device: the NIC filter. */
  receive(c: WaveCopy): boolean {
    const mine = ifMac(c.to, c.toIf);
    const ok = c.frame.ethDst === BCAST || c.frame.ethDst === mine;
    if (!ok) {
      c.outcome = "discarded";
      this.capture(c.to, c.toIf, "in", c.frame, `destination MAC isn't ${mine}: discarded by the NIC`);
      return false;
    }
    c.outcome = "accepted";
    return true;
  }
  /** ARP processing at a receiver of a request. Returns true when it is the target (and replies). */
  arpIn(dev: ArpHost | "r1", iface: ArpIface, f: ArpFrame): boolean {
    const a = f.arp!;
    const owner: CacheOwner = dev;
    const myIp = ifIp(this.s, dev, iface);
    const have = entryFor(this.s, owner, a.sip);
    const isTarget = a.op === "request" ? a.tip === myIp : true;
    if (have?.static) {
      this.capture(dev, iface, "in", f, `${a.op}: ${isTarget && a.op === "request" ? "for me" : "not for me"} · static entry for ${a.sip} kept unchanged`);
      return a.op === "request" && isTarget;
    }
    if (isTarget || have) {
      this.setEntry(owner, { ip: a.sip, mac: a.smac, state: "reachable", at: this.s.clock, iface: dev === "r1" ? iface : "eth0" });
      if (!have || have.mac !== a.smac || have.state !== "reachable") this.log(`${DEV_NAME[dev]} ${have?.state === "reachable" && have.mac !== a.smac ? "CHANGED" : "learned"} ${a.sip} → ${a.smac} (from the ARP ${a.op}'s sender fields)`, have?.state === "reachable" && have.mac !== a.smac ? "warn" : "learn");
    }
    if (a.op === "request")
      this.capture(dev, iface, "in", f, isTarget ? `ARP request for ${a.tip}: that's me → learned the sender, replying` : `ARP request for ${a.tip}: not me → ignored${have ? " (refreshed my existing entry for the sender)" : ""}`);
    else this.capture(dev, iface, "in", f, `ARP reply: ${a.sip} is at ${a.smac} → cached`);
    return a.op === "request" && isTarget;
  }
  /** Resolve `nextHop` from `dev` out of `iface`: cache, or ARP. Returns the MAC, or undefined when nobody answered. */
  resolve(dev: ArpHost | "r1", iface: ArpIface, nextHop: string, d: SendDecision): string | undefined {
    const have = entryFor(this.s, dev, nextHop);
    if (have?.state === "reachable" && have.mac) {
      d.cache = have.static ? "static" : "hit";
      return have.mac;
    }
    d.cache = "miss";
    const myMac = ifMac(dev, iface);
    const myIp = ifIp(this.s, dev, iface);
    this.setEntry(dev, { ip: nextHop, state: "incomplete", at: this.s.clock, iface: dev === "r1" ? iface : "eth0" });
    this.log(`${DEV_NAME[dev]}: no ARP entry for ${nextHop} → broadcast "who has ${nextHop}? tell ${myIp}"`);
    const req = this.frame({ ethSrc: myMac, ethDst: BCAST, type: "ARP", arp: { op: "request", sip: myIp, smac: myMac, tip: nextHop, tmac: ZERO_MAC } });
    const got = this.transmit(dev, iface, req, `${DEV_NAME[dev]} broadcasts an ARP Request: who has ${nextHop}?`, d);
    const targets: { dev: ArpHost | "r1"; iface: ArpIface }[] = [];
    for (const r of got) if (r.dev !== "sw1" && this.arpIn(r.dev as ArpHost | "r1", r.iface, req)) targets.push({ dev: r.dev as ArpHost | "r1", iface: r.iface });
    for (const t of targets) {
      const tMac = ifMac(t.dev, t.iface);
      const rep = this.frame({ ethSrc: tMac, ethDst: myMac, type: "ARP", arp: { op: "reply", sip: nextHop, smac: tMac, tip: myIp, tmac: myMac } });
      const back = this.transmit(t.dev, t.iface, rep, `${DEV_NAME[t.dev]} owns ${nextHop}: it replies by unicast, straight to ${DEV_NAME[dev]}`);
      for (const b of back) if (b.dev === dev) this.arpIn(dev, b.iface, rep);
    }
    const e = entryFor(this.s, dev, nextHop);
    if (e?.state === "reachable") {
      if (targets.length > 1) this.log(`${DEV_NAME[dev]} got ${targets.length} replies for ${nextHop} — the last one won (${e.mac})`, "warn");
      return e.mac;
    }
    this.setEntry(dev, { ip: nextHop, state: "failed", at: this.s.clock, iface: dev === "r1" ? iface : "eth0" });
    this.log(`${DEV_NAME[dev]}: no reply for ${nextHop} — resolution failed (entry incomplete)`, "warn");
    this.flightNote(`No reply: nobody owns ${nextHop} on this link`, d);
    return undefined;
  }
  /** A moment with nothing on the wire (a timeout), so the view can say it. */
  flightNote(caption: string, decision?: SendDecision) {
    this.waves.push({ copies: [], caption, decision: decision && { ...decision } });
    this.snaps.push(clone(this.s));
  }
  /** Decide where an IP packet goes from a host. */
  hostDecide(h: ArpHost, dst: string): SendDecision {
    const c = this.s.cfg[h];
    const local = sameNet(c.ip, dst, c.prefix);
    const myNet = `${netOf(c.ip, c.prefix)}/${c.prefix}`;
    const base = { dev: h, iface: "eth0" as ArpIface, src: c.ip, dst, local, myNet, resolved: false };
    if (local) return { ...base, nextHop: dst, why: `${dst} is inside ${myNet} (my address ${c.ip} with mask ${maskOf(c.prefix)}): it is on my LAN, so I deliver it myself`, cache: "miss" };
    if (!c.gw) return { ...base, why: `${dst} is outside ${myNet} and I have no default gateway`, cache: "no-route" };
    return { ...base, nextHop: c.gw, why: `${dst} is outside ${myNet}: it is not on my LAN, so the frame goes to my default gateway ${c.gw}`, cache: "miss" };
  }
  /** Send one IP packet from a host or R1; follows it to its destination. Returns where it ended. */
  sendIp(dev: ArpHost | "r1", ip: NonNullable<ArpFrame["ip"]>, decisions: SendDecision[], depth = 0): { ok: boolean; at?: ArpHost | "r1"; why: "delivered" | "arp" | "lost" | "no-route" | "unreachable" } {
    if (depth > 6) return { ok: false, why: "lost" };
    if (dev !== "r1" && ip.dst === this.s.cfg[dev].ip) {
      this.log(`${DEV_NAME[dev]}: ${ip.dst} is my own address — answered inside the host, nothing goes on the wire`);
      return { ok: true, at: dev, why: "delivered" };
    }
    let d: SendDecision;
    if (dev === "r1") {
      const out = (Object.keys(R1_IFS) as RIf[]).find((i) => sameNet(R1_IFS[i].ip, ip.dst, R1_IFS[i].prefix));
      if (!out) {
        d = { dev, iface: "gi0", src: ip.src, dst: ip.dst, local: false, myNet: "-", why: `R1 has no route to ${ip.dst}`, cache: "no-route", resolved: false };
        decisions.push(d);
        this.log(`R1: no route to ${ip.dst} → sends "Destination net unreachable" back to ${ip.src}`, "warn");
        if (ip.icmp !== "echo-request") return { ok: false, why: "no-route" };
        this.sendIp("r1", { src: R1_IFS.gi0.ip, dst: ip.src, icmp: "net-unreachable", ttl: 255 }, decisions, depth + 1);
        return { ok: false, why: "unreachable" };
      }
      const r = R1_IFS[out];
      d = { dev, iface: out, src: ip.src, dst: ip.dst, local: true, myNet: r.net, nextHop: ip.dst, why: `${ip.dst} is in ${r.net}, connected on ${rIfName(out)}: R1 delivers it there, so it needs ${ip.dst}'s MAC on that link`, cache: "miss", resolved: false };
    } else {
      d = this.hostDecide(dev, ip.dst);
    }
    decisions.push(d);
    if (!d.nextHop) {
      this.log(`${DEV_NAME[dev]}: ${d.why}`, "warn");
      return { ok: false, why: "no-route" };
    }
    const mac = this.resolve(dev, d.iface, d.nextHop, d);
    if (!mac) return { ok: false, why: "arp" };
    d.ethDst = mac;
    d.resolved = true;
    const f = this.frame({ ethSrc: ifMac(dev, d.iface), ethDst: mac, type: "IPv4", ip });
    const label = ip.icmp === "echo-request" ? "ping (echo request)" : ip.icmp === "echo-reply" ? "echo reply" : "ICMP net unreachable";
    const got = this.transmit(dev, d.iface, f, `${DEV_NAME[dev]} sends the ${label}: Ethernet to ${macOwner(mac)}, IP to ${ip.dst}`, d);
    const rx = got.find((g) => g.dev !== "sw1");
    if (!rx) {
      this.log(`The ${label} to ${ip.dst} reached nobody who kept it`, "warn");
      return { ok: false, why: "lost" };
    }
    const at = rx.dev as ArpHost | "r1";
    const myIp = ifIp(this.s, at, rx.iface);
    if (at === "r1" && ip.dst !== myIp && !(Object.keys(R1_IFS) as RIf[]).some((i) => R1_IFS[i].ip === ip.dst)) {
      this.capture("r1", rx.iface, "in", f, `frame for my MAC, IP for ${ip.dst} → route it`);
      return this.sendIp("r1", { ...ip, ttl: ip.ttl - 1 }, decisions, depth + 1);
    }
    if (ip.dst !== myIp && !(at === "r1" && Object.values(R1_IFS).some((x) => x.ip === ip.dst))) {
      this.capture(at, rx.iface, "in", f, `frame for my MAC, but the IP packet is for ${ip.dst}, not me → dropped`);
      this.log(`${DEV_NAME[at]} kept the frame (its MAC) but dropped the packet: it is for ${ip.dst}`, "warn");
      return { ok: false, why: "lost" };
    }
    this.capture(at, rx.iface, "in", f, ip.icmp === "echo-request" ? "echo request for me → replying" : ip.icmp === "echo-reply" ? "echo reply for me" : "ICMP for me");
    if (ip.icmp === "echo-request") {
      const back = this.sendIp(at, { src: ip.dst, dst: ip.src, icmp: "echo-reply", ttl: at === "r1" ? 255 : HOSTS[at].os === "windows" ? 128 : 64 }, decisions, depth + 1);
      return back;
    }
    return { ok: true, at, why: "delivered" };
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------------------------------------------
export type ArpAction =
  | { type: "ping"; src: ArpHost | "r1"; dst: string; count?: number }
  | { type: "time"; seconds: number }
  | { type: "clear-cache"; owner: CacheOwner; ip?: string }
  | { type: "static"; owner: ArpHost; ip: string; mac?: string }
  | { type: "host-cfg"; host: ArpHost; cfg: HostCfg }
  | { type: "power"; host: ArpHost; on: boolean }
  | { type: "sw-shut"; port: SwPort; shut: boolean }
  | { type: "sw-clear" }
  | { type: "ticket"; id: ArpTicketId }
  | { type: "fresh" };

const replyTtl = (s: ArpNetState, dst: string, viaRouter: boolean) => {
  const h = ARP_HOSTS.find((x) => s.cfg[x].ip === dst);
  const base = h ? (HOSTS[h].os === "windows" ? 128 : 64) : 255;
  // R1 originates its own replies (255, nothing forwards them); only a host's reply routed through R1 loses one.
  return h && viaRouter ? base - 1 : base;
};

/** Run one ping (count echoes). The first echo is animated wave by wave; the rest are added in the final moment. */
function planPing(s0: ArpNetState, a: Extract<ArpAction, { type: "ping" }>): ArpPlan {
  const base = { ...s0, run: s0.run + 1, seq: s0.seq + 1 };
  if (a.src !== "r1" && !s0.power[a.src]) {
    const off: PingResult = { run: base.run, src: a.src, dst: a.dst, count: 1, replies: [{ kind: "no-route" }], decisions: [], arped: false };
    return { run: base.run, label: "ping", waves: [], snaps: [{ ...base, last: { type: "ping", result: off }, log: pushLog(base, `${DEV_NAME[a.src]} is powered off`, "warn") }] };
  }
  const sim = new Sim(base);
  const count = Math.max(1, Math.min(a.count ?? 1, 10));
  const srcIp = a.src === "r1" ? (sameNet(R1_IFS.gi1.ip, a.dst, 24) ? R1_IFS.gi1.ip : R1_IFS.gi0.ip) : sim.s.cfg[a.src].ip;
  sim.log(`${DEV_NAME[a.src]} pings ${a.dst}${count > 1 ? ` (${count} echoes)` : ""}`, "info");
  const replies: PingResult["replies"] = [];
  const decisions: SendDecision[] = [];
  let arped = false;
  for (let i = 0; i < count; i++) {
    const mark = sim.waves.length;
    const before = sim.s.capNo;
    const dec: SendDecision[] = [];
    const r = sim.sendIp(a.src, { src: srcIp, dst: a.dst, icmp: "echo-request", ttl: a.src === "r1" ? 255 : HOSTS[a.src].os === "windows" ? 128 : 64 }, dec);
    if (i === 0) {
      decisions.push(...dec);
      arped = sim.s.captures.some((c) => c.no > before && c.dev === a.src && c.dir === "out" && c.frame.type === "ARP" && c.frame.arp?.op === "request");
    } else {
      // later echoes: no wave of their own (their captures and learning land in the final moment)
      sim.waves.splice(mark);
      sim.snaps.splice(mark);
    }
    const viaRouter = dec.some((d) => d.dev === "r1" && d.cache !== "no-route");
    const unreach = dec.some((d) => d.dev === "r1" && d.cache === "no-route");
    const first = dec[0];
    replies.push(
      r.ok && r.at === a.src
        ? { kind: "reply", from: a.dst, ttl: replyTtl(sim.s, a.dst, viaRouter) }
        : unreach
          ? { kind: "net-unreachable", from: R1_IFS.gi0.ip }
          : first?.cache === "no-route"
            ? { kind: "no-route" }
            : r.why === "arp" && dec.length === 1
              ? { kind: "host-unreachable", from: srcIp }
              : { kind: "timeout" },
    );
  }
  const result: PingResult = { run: sim.s.run, src: a.src, dst: a.dst, count, replies, decisions, arped };
  sim.s.last = { type: "ping", result };
  const ok = replies.filter((r) => r.kind === "reply").length;
  sim.log(`${DEV_NAME[a.src]} → ${a.dst}: ${ok}/${count} replies`, ok ? "info" : "warn");
  sim.snaps.push(clone(sim.s));
  if (!sim.waves.length) sim.snaps = [clone(sim.s)];
  return { run: sim.s.run, label: `${DEV_NAME[a.src]} pings ${a.dst}`, waves: sim.waves, snaps: sim.snaps };
}

function pushLog(s: ArpNetState, text: string, kind?: ArpLogEntry["kind"]): ArpLogEntry[] {
  const id = (s.log[s.log.length - 1]?.id ?? 0) + 1;
  return [...s.log, { id, clock: s.clock, text, kind }].slice(-300);
}

/** Instant actions (no frames). */
function applyInstant(s: ArpNetState, a: Exclude<ArpAction, { type: "ping" }>): ArpNetState {
  const n = { ...clone(s), seq: s.seq + 1 };
  switch (a.type) {
    case "time": {
      const to = s.clock + a.seconds;
      const gone: string[] = [];
      for (const o of [...ARP_HOSTS, "r1"] as CacheOwner[]) {
        const limit = o === "r1" ? ROUTER_AGING : HOST_AGING;
        n.caches[o] = n.caches[o].filter((e) => {
          const keep = e.static || (e.state === "reachable" ? to - e.at < limit : to - e.at < 20);
          if (!keep) gone.push(`${DEV_NAME[o]} ${e.ip}${e.state !== "reachable" ? ` (${e.state})` : ""}`);
          return keep;
        });
      }
      const swGone: string[] = [];
      n.swMac = Object.fromEntries(
        Object.entries(n.swMac).filter(([mac, e]) => {
          const keep = to - e.at < SW_AGING;
          if (!keep) swGone.push(mac);
          return keep;
        }),
      );
      n.clock = to;
      n.log = pushLog({ ...n, clock: to }, `${a.seconds} s pass (t = ${to} s)${gone.length ? ` · ARP entries expired: ${gone.join(", ")}` : ""}${swGone.length ? ` · SW1 MAC entries aged out: ${swGone.join(", ")}` : ""}`, "info");
      n.last = { type: "other", text: `${a.seconds} s passed` };
      return n;
    }
    case "clear-cache": {
      const removed = n.caches[a.owner].filter((e) => (a.ip ? e.ip === a.ip : !e.static) && (!e.static || a.ip));
      n.caches[a.owner] = n.caches[a.owner].filter((e) => !removed.includes(e));
      n.log = pushLog(n, `${DEV_NAME[a.owner]} cleared ${a.ip ? `its ARP entry for ${a.ip}` : "its ARP cache"}${removed.length ? ` (${removed.map((e) => e.ip).join(", ")})` : " (nothing to remove)"}`, "info");
      n.last = { type: "other", text: "ARP cache cleared" };
      return n;
    }
    case "static": {
      n.caches[a.owner] = n.caches[a.owner].filter((e) => e.ip !== a.ip);
      if (a.mac) n.caches[a.owner] = [...n.caches[a.owner], { ip: a.ip, mac: a.mac.toUpperCase(), state: "reachable", static: true, at: n.clock, iface: "eth0" }];
      n.log = pushLog(n, a.mac ? `${DEV_NAME[a.owner]}: static ARP entry ${a.ip} → ${a.mac.toUpperCase()} added` : `${DEV_NAME[a.owner]}: ARP entry for ${a.ip} deleted`, "info");
      n.last = { type: "other", text: "static entry changed" };
      return n;
    }
    case "host-cfg": {
      n.cfg[a.host] = { ...a.cfg };
      // a host whose address changes forgets what it had learned (its interface was reconfigured)
      if (s.cfg[a.host].ip !== a.cfg.ip || s.cfg[a.host].prefix !== a.cfg.prefix) n.caches[a.host] = n.caches[a.host].filter((e) => e.static);
      n.log = pushLog(n, `${DEV_NAME[a.host]} IPv4 settings: ${a.cfg.ip}/${a.cfg.prefix} (mask ${maskOf(a.cfg.prefix)}), gateway ${a.cfg.gw ?? "none"}`, "info");
      n.last = { type: "other", text: "settings changed" };
      return n;
    }
    case "power": {
      n.power[a.host] = a.on;
      if (!a.on) {
        n.caches[a.host] = n.caches[a.host].filter((e) => e.static);
        const p = hostPort(a.host);
        if (p) n.swMac = Object.fromEntries(Object.entries(n.swMac).filter(([, e]) => e.port !== p));
      }
      n.log = pushLog(n, `${DEV_NAME[a.host]} powered ${a.on ? "on" : "off"}${!a.on && hostPort(a.host) ? ` · SW1 ${portName(hostPort(a.host)!)} link down (its MAC entries flushed)` : ""}`, a.on ? "info" : "warn");
      n.last = { type: "other", text: "power changed" };
      return n;
    }
    case "sw-shut": {
      n.swShut = a.shut ? [...new Set([...n.swShut, a.port])] : n.swShut.filter((p) => p !== a.port);
      if (a.shut) n.swMac = Object.fromEntries(Object.entries(n.swMac).filter(([, e]) => e.port !== a.port));
      n.log = pushLog(n, `SW1 ${portName(a.port)} ${a.shut ? "shut down (administratively down; MAC entries on it flushed)" : "enabled"}`, a.shut ? "warn" : "info");
      n.last = { type: "other", text: "port changed" };
      return n;
    }
    case "sw-clear": {
      n.swMac = {};
      n.log = pushLog(n, "SW1 cleared its MAC address table (ARP caches are untouched: they live in the hosts)", "info");
      n.last = { type: "other", text: "MAC table cleared" };
      return n;
    }
    case "ticket": {
      let t = { ...createArpNet(), seq: s.seq + 1, run: s.run, capNo: s.capNo, log: s.log };
      t = runAll(t, TICKET_SETUP[a.id]);
      return { ...t, captures: [], ticket: a.id, last: { type: "other", text: "ticket" }, log: pushLog(t, `Ticket: ${ARP_TICKETS[a.id].title}`, "warn") };
    }
    case "fresh": {
      const f = createArpNet();
      return { ...f, seq: s.seq + 1, run: s.run, capNo: s.capNo, log: pushLog(s, "A fresh network: every cache and table empty, default settings", "info") };
    }
  }
}

/** Plan an action. Instant actions get a plan with no waves. */
export function planArp(s: ArpNetState, a: ArpAction): ArpPlan {
  if (a.type === "ping") return planPing(s, a);
  const n = applyInstant(s, a);
  return { run: s.run, label: a.type, waves: [], snaps: [n] };
}
/** The final state of an action (what the plan ends in). */
export const applyArp = (s: ArpNetState, a: ArpAction): ArpNetState => {
  const p = planArp(s, a);
  return p.snaps[p.snaps.length - 1];
};
export const runAll = (s: ArpNetState, as: ArpAction[]) => as.reduce(applyArp, s);

// ---------------------------------------------------------------------------------------------------------------
// Tickets — each built from real mechanisms
// ---------------------------------------------------------------------------------------------------------------
const OLD_MAC = "02:AA:00:00:00:99";
const TICKET_SETUP: Record<ArpTicketId, ArpAction[]> = {
  gateway: [{ type: "host-cfg", host: "laptop", cfg: { ip: ADDR.laptop.ip, prefix: 24, gw: "192.168.10.254" } }],
  mask: [{ type: "host-cfg", host: "laptop", cfg: { ip: ADDR.laptop.ip, prefix: 28, gw: ADDR.gateway.ip } }],
  static: [{ type: "static", owner: "laptop", ip: "192.168.10.20", mac: OLD_MAC }],
  dupip: [{ type: "host-cfg", host: "pcc", cfg: { ip: "192.168.10.20", prefix: 24, gw: ADDR.gateway.ip } }],
  port: [{ type: "sw-shut", port: "fa3", shut: true }],
};
export const ARP_TICKETS: Record<ArpTicketId, { title: string; report: string }> = {
  gateway: { title: "The Server is unreachable from the Laptop", report: "“I can reach PC-B and PC-C, but nothing outside our LAN. The Server is up — others reach it.”" },
  mask: { title: "Laptop traffic to PC-B crosses the router", report: "“Ping to PC-B works, but R1's counters show every Laptop ↔ PC-B packet passing through it. They're on the same switch!”" },
  static: { title: "PC-B is unreachable, only from the Laptop", report: "“PC-C can ping PC-B. The Laptop can't — Request timed out. PC-B had its network card replaced last month.”" },
  dupip: { title: "PC-B answers, but isn't really there", report: "“Ping to 192.168.10.20 works from the Laptop, yet PC-B's own capture never sees the Laptop. PC-C was reinstalled yesterday.”" },
  port: { title: "PC-B unreachable from everyone", report: "“Nobody can reach PC-B. Its user says the PC is on and its settings haven't changed.”" },
};
export const ARP_OLD_MAC = OLD_MAC;
