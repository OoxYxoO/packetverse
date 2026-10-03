import type { PacketLayer, PacketVisual } from "../types";
import type { LabModel } from "@/lib/practice-lab/types";
import { DF, GATEWAY, INITIAL_TTL, IP_ID, UDP_TOTAL_LENGTH, V4_FAULT_PREFIX, V4_IP, V4_MAC, V4_PREFIX, arpRequestFrame, ipFrame, ipv4Checksum, maskOf, networkOf, r1Lookup, sameSubnet } from "./ipv4Basics";

/**
 * IPv4 LAB — a pure, deterministic model of the IPv4 Basics network for the IPv4 Practice Lab. It shares every
 * immutable value with the guided lesson (addresses, MACs, /26, gateways, R1's connected routes, the checksum and
 * frame builders) and has its own mutable state. The guided lesson never reads it.
 *
 *   HOST-A ─┐
 *   HOST-C ─┴ SW-A ── R1 ── SW-B ── HOST-B        (HOST-C is a lab-only host for real same-subnet traffic)
 *
 * What it models (RFC 791 / 826 / 1122 / 1812, CIDR only):
 *  - A host decides LOCAL vs REMOTE by ANDing its own address and the destination with ITS OWN mask; the next hop
 *    is the destination (local) or its default gateway (remote). The IPv4 destination never changes.
 *  - ARP resolves only that next hop's MAC, live: caches start empty; a request is flooded on the LAN; only the
 *    owner of the target address answers (and learns the requester); nobody else adds an entry; no Proxy ARP.
 *  - R1 accepts frames addressed to its MAC, matches a connected route, resolves the destination on the egress LAN,
 *    decrements the TTL, recomputes the header checksum and builds a new Ethernet frame. Source/destination IPv4,
 *    Identification, Flags and the payload are untouched.
 * Not modelled: fragmentation, ICMP, aging timers, static/dynamic routes (R1 has only its two connected /26s).
 */

// ---------------------------------------------------------------------------------------------------------------
// Network (immutable)
// ---------------------------------------------------------------------------------------------------------------
/** Practice-Lab-only host on HOST-A's LAN (SW-A p3), so local and remote forwarding can be compared for real. */
export const V4_LAB_HOST_C = { ip: "192.168.10.30", mac: "00:1A:2B:00:00:0C", gateway: V4_IP.R1L, port: "p3" } as const;
/** Free-play wrong-gateway fault: an address on HOST-A's subnet that no device owns. */
export const V4_LAB_BAD_GATEWAY = "192.168.10.2";

export type V4Host = "HOST-A" | "HOST-C" | "HOST-B";
export type V4LabDevice = V4Host | "SW-A" | "R1" | "SW-B";
export type V4Station = V4Host | "R1L" | "R1R";
export type V4ArpTable = V4Host | "R1";
export const V4_LAB_HOSTS: V4Host[] = ["HOST-A", "HOST-C", "HOST-B"];

interface StationDef {
  ip: string;
  mac: string;
  lan: "A" | "B";
  node: V4LabDevice;
  table: V4ArpTable;
  label: string;
}
export const V4_STATIONS: Record<V4Station, StationDef> = {
  "HOST-A": { ip: V4_IP["HOST-A"], mac: V4_MAC["HOST-A"], lan: "A", node: "HOST-A", table: "HOST-A", label: "HOST-A" },
  "HOST-C": { ip: V4_LAB_HOST_C.ip, mac: V4_LAB_HOST_C.mac, lan: "A", node: "HOST-C", table: "HOST-C", label: "HOST-C" },
  R1L: { ip: V4_IP.R1L, mac: V4_MAC.R1L, lan: "A", node: "R1", table: "R1", label: "R1 ge-0/0/0" },
  R1R: { ip: V4_IP.R1R, mac: V4_MAC.R1R, lan: "B", node: "R1", table: "R1", label: "R1 ge-0/0/1" },
  "HOST-B": { ip: V4_IP["HOST-B"], mac: V4_MAC["HOST-B"], lan: "B", node: "HOST-B", table: "HOST-B", label: "HOST-B" },
};
const LAN_SWITCH: Record<"A" | "B", V4LabDevice> = { A: "SW-A", B: "SW-B" };
const stationsOn = (lan: "A" | "B") => (Object.keys(V4_STATIONS) as V4Station[]).filter((k) => V4_STATIONS[k].lan === lan);
/** Name of the device that owns an address or MAC, for explanations. */
export function v4Owner(v: string): string | undefined {
  const k = (Object.keys(V4_STATIONS) as V4Station[]).find((s) => V4_STATIONS[s].ip === v || V4_STATIONS[s].mac === v);
  return k ? V4_STATIONS[k].label : undefined;
}
export const V4_LAB_PORTS: Record<"SW-A" | "SW-B", { port: string; to: V4LabDevice }[]> = {
  "SW-A": [
    { port: "p1", to: "HOST-A" },
    { port: "p2", to: "R1" },
    { port: V4_LAB_HOST_C.port, to: "HOST-C" },
  ],
  "SW-B": [
    { port: "p1", to: "R1" },
    { port: "p2", to: "HOST-B" },
  ],
};

export interface V4HostConfig {
  prefix: number;
  gateway: string;
}
const DEFAULT_CONFIG: Record<V4Host, V4HostConfig> = {
  "HOST-A": { prefix: V4_PREFIX, gateway: GATEWAY["HOST-A"] },
  "HOST-C": { prefix: V4_PREFIX, gateway: V4_LAB_HOST_C.gateway },
  "HOST-B": { prefix: V4_PREFIX, gateway: GATEWAY["HOST-B"] },
};

// ---------------------------------------------------------------------------------------------------------------
// The host decision
// ---------------------------------------------------------------------------------------------------------------
export interface V4Decision {
  src: V4Host;
  srcIp: string;
  dst: string;
  prefix: number;
  mask: string;
  srcNet: string;
  dstNet: string;
  local: boolean;
  /** The Layer-3 next hop: the destination itself (local) or the default gateway (remote). */
  nextHop: string;
}
export function v4Decide(src: V4Host, cfg: V4HostConfig, dst: string): V4Decision {
  const srcIp = V4_STATIONS[src].ip;
  const local = sameSubnet(srcIp, dst, cfg.prefix);
  return { src, srcIp, dst, prefix: cfg.prefix, mask: maskOf(cfg.prefix), srcNet: networkOf(srcIp, cfg.prefix), dstNet: networkOf(dst, cfg.prefix), local, nextHop: local ? dst : cfg.gateway };
}

// ---------------------------------------------------------------------------------------------------------------
// Packets — every IPv4 header field the lesson models, with a real RFC 791 checksum
// ---------------------------------------------------------------------------------------------------------------
const hex4 = (n: number) => `0x${n.toString(16).toUpperCase().padStart(4, "0")}`;
export function v4LabChecksum(src: string, dst: string, ttl: number) {
  return ipv4Checksum({ totalLength: UDP_TOTAL_LENGTH, id: IP_ID, flagsFrag: DF, ttl, protocol: 17, src, dst });
}
export function v4LabIpLayer(src: string, dst: string, ttl: number): PacketLayer {
  return {
    name: "IPv4 Header",
    color: "#60a5fa",
    fields: [
      { label: "Version", value: "4" },
      { label: "IHL", value: "5 (20 bytes)" },
      { label: "DSCP / ECN", value: "0 / 0" },
      { label: "Total Length", value: `${UDP_TOTAL_LENGTH}` },
      { label: "Identification", value: hex4(IP_ID) },
      { label: "Flags", value: "DF (Don't Fragment)" },
      { label: "Fragment Offset", value: "0" },
      { label: "TTL", value: `${ttl}` },
      { label: "Protocol", value: "17 (UDP)" },
      { label: "Header Checksum", value: hex4(v4LabChecksum(src, dst, ttl)) },
      { label: "Source", value: src },
      { label: "Destination", value: dst },
    ],
  };
}
function arpReplyFrame(id: string, from: string, to: string, senderMac: string, senderIp: string, targetMac: string, targetIp: string): PacketVisual {
  return {
    id,
    protocol: "ARP",
    from,
    to,
    badge: "ARP",
    summary: `ARP reply — ${senderIp} is at ${senderMac}`,
    layers: [
      { name: "Ethernet II Header", color: "#94a3b8", fields: [{ label: "Destination MAC", value: targetMac }, { label: "Source MAC", value: senderMac }, { label: "EtherType", value: "0x0806 (ARP)" }] },
      {
        name: "ARP",
        color: "#f59e0b",
        fields: [
          { label: "Operation", value: "2 (reply)" },
          { label: "Sender MAC", value: senderMac },
          { label: "Sender IP", value: senderIp },
          { label: "Target MAC", value: targetMac },
          { label: "Target IP", value: targetIp },
        ],
      },
      { name: "FCS", color: "#94a3b8", fields: [{ label: "Frame Check Sequence", value: "CRC-32 over the frame" }] },
    ],
  };
}
export const fieldOf = (p: PacketVisual, layerRe: RegExp, label: string) => p.layers.find((l) => layerRe.test(l.name))?.fields.find((x) => x.label === label)?.value ?? "";

// ---------------------------------------------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------------------------------------------
export type V4FrameKind = "arp-request" | "arp-reply" | "ipv4";
export interface V4Copy {
  from: V4LabDevice;
  to: V4LabDevice;
  frame: number;
}
export type V4Effect =
  | { type: "arp-learn"; table: V4ArpTable; ip: string; mac: string }
  | { type: "arp-incomplete"; table: V4ArpTable; ip: string }
  | { type: "r1-forwarded" }
  | { type: "delivered"; host: V4Host }
  | { type: "at-router"; frame: number }
  | { type: "log"; text: string; kind?: V4LogEntry["kind"] };
export interface V4Wave {
  copies: V4Copy[];
  effects: V4Effect[];
}
export interface V4ArpUse {
  /** Who resolved, for which next-hop address, and how. */
  by: V4Station;
  ip: string;
  outcome: "cache" | "resolved" | "no-reply";
  mac?: string;
}
/** One action's traffic. Created once, complete; never changed afterwards. */
export interface V4Record {
  id: number;
  kind: "send" | "route";
  src: V4Host | "R1";
  dst: string;
  decision?: V4Decision;
  frames: PacketVisual[];
  frameKinds: V4FrameKind[];
  waves: V4Wave[];
  arp: V4ArpUse[];
  result: "delivered" | "at-router" | "arp-failed" | "no-route";
  /** R1's forwarding of an IPv4 packet: the frame it received and the frame it sent. */
  routing?: { route: string; egress: string; inFrame: number; outFrame: number };
  /** The IPv4 frame a host put on the wire (index into frames). */
  ipFrame?: number;
}
export interface V4LogEntry {
  id: number;
  tag: string;
  text: string;
  kind?: "learn" | "info" | "warning";
}
export type V4LabAction =
  | { type: "decide"; src: V4Host; dst: string }
  /** `throughRouter`: continue at R1 in the same action (free play); otherwise the packet waits at R1 for `route`. */
  | { type: "send"; src: V4Host; dst: string; throughRouter?: boolean }
  | { type: "route" }
  | { type: "set-prefix"; prefix: number }
  | { type: "set-gateway"; gateway: string }
  | { type: "incident" }
  | { type: "repair"; choice: string }
  | { type: "clear-arp" };
export type V4LabEvent =
  | { type: "decide" }
  | { type: "traffic"; rec: number }
  | { type: "config"; what: "prefix" | "gateway" | "arp" }
  | { type: "incident" }
  | { type: "repair"; choice: string; correct: boolean }
  | { type: "noop"; reason: string };

export interface V4LabState {
  seq: number;
  config: Record<V4Host, V4HostConfig>;
  arp: Record<V4ArpTable, Record<string, string>>;
  /** IPv4 packets R1 has routed (forwarded out another interface). */
  r1Forwarded: number;
  delivered: Record<V4Host, number>;
  records: V4Record[];
  tx?: { rec: number; wave: number };
  /** IPv4 frame waiting at R1 for the `route` action. */
  r1Queue?: { rec: number; frame: number };
  decision?: V4Decision;
  incident: { active: boolean; repaired: boolean };
  last?: V4LabEvent;
  log: V4LogEntry[];
}

export const INCOMPLETE = "INCOMPLETE";
export function createV4LabState(): V4LabState {
  return {
    seq: 0,
    config: structuredClone(DEFAULT_CONFIG),
    arp: { "HOST-A": {}, "HOST-C": {}, "HOST-B": {}, R1: {} },
    r1Forwarded: 0,
    delivered: { "HOST-A": 0, "HOST-C": 0, "HOST-B": 0 },
    records: [],
    incident: { active: false, repaired: false },
    log: [{ id: 0, tag: "#0", text: "Lab ready: ARP caches empty · R1 knows only its two connected /26 networks · HOST-C is a Practice-Lab-only host on HOST-A's LAN", kind: "info" }],
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Planning — builds a whole action's frames and waves deterministically from the current state
// ---------------------------------------------------------------------------------------------------------------
interface Plan {
  frames: PacketVisual[];
  kinds: V4FrameKind[];
  waves: V4Wave[];
  arp: V4ArpUse[];
  /** Simulated ARP caches, so later legs of the same action see what earlier legs learned. */
  sim: V4LabState["arp"];
  id: number;
}
const addFrame = (p: Plan, f: PacketVisual, k: V4FrameKind) => (p.frames.push(f), p.kinds.push(k), p.frames.length - 1);

/** Unicast across one LAN: sender → switch → receiver (two waves; effects land on arrival). */
function unicast(p: Plan, from: V4Station, to: V4Station, frame: number, effects: V4Effect[]) {
  const sw = LAN_SWITCH[V4_STATIONS[from].lan];
  p.waves.push({ copies: [{ from: V4_STATIONS[from].node, to: sw, frame }], effects: [] });
  p.waves.push({ copies: [{ from: sw, to: V4_STATIONS[to].node, frame }], effects });
}

/** ARP for `ip` on `by`'s LAN, unless `by`'s cache already has it. Returns the MAC, or undefined (no reply). */
function resolve(p: Plan, by: V4Station, ip: string): string | undefined {
  const me = V4_STATIONS[by];
  const cached = p.sim[me.table][ip];
  if (cached && cached !== INCOMPLETE) {
    p.arp.push({ by, ip, outcome: "cache", mac: cached });
    return cached;
  }
  const sw = LAN_SWITCH[me.lan];
  const others = stationsOn(me.lan).filter((s) => s !== by);
  const owner = others.find((s) => V4_STATIONS[s].ip === ip);
  const req = addFrame(p, arpRequestFrame(`${p.id}-arpq-${p.frames.length}`, me.node, sw, me.mac, me.ip, ip), "arp-request");
  const reqEffects: V4Effect[] = others.map((s): V4Effect =>
    s === owner
      ? { type: "log", text: `${V4_STATIONS[s].label}: the ARP request is for MY address ${ip} → learns ${me.ip} → ${me.mac} and replies`, kind: "learn" }
      : { type: "log", text: `${V4_STATIONS[s].label}: ARP request for ${ip} is not for one of its addresses → ignored${V4_STATIONS[s].node === "R1" ? " (no Proxy ARP)" : ""}` },
  );
  p.waves.push({ copies: [{ from: me.node, to: sw, frame: req }], effects: [] });
  if (!owner) {
    p.waves.push({ copies: others.map((s) => ({ from: sw, to: V4_STATIONS[s].node, frame: req })), effects: [...reqEffects, { type: "arp-incomplete", table: me.table, ip }, { type: "log", text: `${me.label}: no ARP reply for ${ip} — entry stays INCOMPLETE; nothing can be sent to that next hop`, kind: "warning" }] });
    p.sim[me.table] = { ...p.sim[me.table], [ip]: INCOMPLETE };
    p.arp.push({ by, ip, outcome: "no-reply" });
    return undefined;
  }
  const o = V4_STATIONS[owner];
  p.waves.push({ copies: others.map((s) => ({ from: sw, to: V4_STATIONS[s].node, frame: req })), effects: [{ type: "arp-learn", table: o.table, ip: me.ip, mac: me.mac }, ...reqEffects] });
  p.sim[o.table] = { ...p.sim[o.table], [me.ip]: me.mac };
  const rep = addFrame(p, arpReplyFrame(`${p.id}-arpr-${p.frames.length}`, o.node, me.node, o.mac, o.ip, me.mac, me.ip), "arp-reply");
  unicast(p, owner, by, rep, [{ type: "arp-learn", table: me.table, ip, mac: o.mac }, { type: "log", text: `${me.label}: learns ${ip} → ${o.mac} from the ARP reply`, kind: "learn" }]);
  p.sim[me.table] = { ...p.sim[me.table], [ip]: o.mac };
  p.arp.push({ by, ip, outcome: "resolved", mac: o.mac });
  return o.mac;
}

/** The station that owns a MAC on a LAN (the frame's receiver). */
const stationByMac = (lan: "A" | "B", mac: string) => stationsOn(lan).find((s) => V4_STATIONS[s].mac === mac);

/** R1 routes an IPv4 packet it received (frame `inFrame`). Appends waves; returns routing info and result. */
function planRoute(p: Plan, inFrame: number): { result: V4Record["result"]; routing?: V4Record["routing"] } {
  const f = p.frames[inFrame];
  const src = fieldOf(f, /^IPv4/, "Source");
  const dst = fieldOf(f, /^IPv4/, "Destination");
  const ttlIn = Number(fieldOf(f, /^IPv4/, "TTL"));
  const route = r1Lookup(dst);
  if (!route) {
    p.waves.push({ copies: [], effects: [{ type: "log", text: `R1: no route for ${dst} — packet dropped`, kind: "warning" }] });
    return { result: "no-route" };
  }
  const egress: V4Station = route.iface === "ge-0/0/1" ? "R1R" : "R1L";
  // Connected route: the next hop is the destination itself, on the egress LAN.
  const mac = resolve(p, egress, dst);
  if (!mac) return { result: "arp-failed", routing: { route: route.prefix, egress: route.iface, inFrame, outFrame: -1 } };
  const e = V4_STATIONS[egress];
  const to = stationByMac(e.lan, mac)!;
  const out = addFrame(p, ipFrame(`${p.id}-ip-${p.frames.length}`, "R1", LAN_SWITCH[e.lan], e.mac, mac, v4LabIpLayer(src, dst, ttlIn - 1)), "ipv4");
  const sw = LAN_SWITCH[e.lan];
  p.waves.push({ copies: [{ from: "R1", to: sw, frame: out }], effects: [{ type: "r1-forwarded" }, { type: "log", text: `R1: ${dst} ∈ ${route.prefix} (connected, ${route.iface}) · TTL ${ttlIn} → ${ttlIn - 1} · checksum recomputed · new Ethernet header ${e.mac} → ${mac}`, kind: "learn" }] });
  const host = to as V4Host;
  p.waves.push({ copies: [{ from: sw, to: V4_STATIONS[to].node, frame: out }], effects: [{ type: "delivered", host }, { type: "log", text: `${host}: destination MAC and IPv4 ${dst} are its own → delivered (source still ${src}, TTL ${ttlIn - 1})`, kind: "learn" }] });
  return { result: "delivered", routing: { route: route.prefix, egress: route.iface, inFrame, outFrame: out } };
}

function planSend(s: V4LabState, src: V4Host, dst: string, throughRouter: boolean): V4Record {
  const p: Plan = { frames: [], kinds: [], waves: [], arp: [], sim: structuredClone(s.arp), id: s.records.length + 1 };
  const d = v4Decide(src, s.config[src], dst);
  const mac = resolve(p, src, d.nextHop);
  const base = { id: p.id, kind: "send" as const, src, dst, decision: d };
  if (!mac) return { ...base, frames: p.frames, frameKinds: p.kinds, waves: p.waves, arp: p.arp, result: "arp-failed" };
  const me = V4_STATIONS[src];
  const to = stationByMac(me.lan, mac)!;
  const ipf = addFrame(p, ipFrame(`${p.id}-ip-${p.frames.length}`, me.node, LAN_SWITCH[me.lan], me.mac, mac, v4LabIpLayer(me.ip, dst, INITIAL_TTL)), "ipv4");
  if (V4_STATIONS[to].node === "R1") {
    unicast(p, src, to, ipf, [{ type: "log", text: `R1 ${to === "R1L" ? "ge-0/0/0" : "ge-0/0/1"}: frame addressed to its own MAC → accepted for routing (IPv4 destination ${dst})` }, ...(throughRouter ? [] : [{ type: "at-router", frame: ipf } as V4Effect])]);
    if (!throughRouter) return { ...base, frames: p.frames, frameKinds: p.kinds, waves: p.waves, arp: p.arp, result: "at-router", ipFrame: ipf };
    const r = planRoute(p, ipf);
    return { ...base, frames: p.frames, frameKinds: p.kinds, waves: p.waves, arp: p.arp, result: r.result, routing: r.routing, ipFrame: ipf };
  }
  const host = to as V4Host;
  unicast(p, src, to, ipf, [{ type: "delivered", host }, { type: "log", text: `${host}: destination MAC and IPv4 ${dst} are its own → delivered directly (no router involved)`, kind: "learn" }]);
  return { ...base, frames: p.frames, frameKinds: p.kinds, waves: p.waves, arp: p.arp, result: "delivered", ipFrame: ipf };
}

// ---------------------------------------------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------------------------------------------
function pushLog(s: V4LabState, entries: { text: string; kind?: V4LogEntry["kind"] }[]): V4LogEntry[] {
  let id = s.log[s.log.length - 1]?.id ?? 0;
  return [...s.log, ...entries.map((e) => ({ id: ++id, tag: `#${s.seq}`, text: e.text, kind: e.kind }))];
}
const decisionText = (d: V4Decision) => `${d.src} → ${d.dst}: ${d.srcIp} AND ${d.mask} = ${d.srcNet} · ${d.dst} AND ${d.mask} = ${d.dstNet} → ${d.local ? "LOCAL" : "REMOTE"} · next hop ${d.nextHop}`;

/** Text that never names a mask: used for HOST-A while the incident is unresolved (the learner finds the cause). */
const neutralDecisionText = (d: V4Decision) => `${d.src} → ${d.dst}: decision ${d.local ? "LOCAL" : "REMOTE"} · next hop ${d.nextHop}`;

function start(s0: V4LabState, a: V4LabAction): V4LabState {
  const s: V4LabState = { ...s0, seq: s0.seq + 1, tx: undefined };
  const conceal = s.incident.active && !s.incident.repaired;
  const dtext = (d: V4Decision) => (conceal && d.src === "HOST-A" ? neutralDecisionText(d) : decisionText(d));
  const noop = (reason: string): V4LabState => ({ ...s, last: { type: "noop", reason }, log: pushLog(s, [{ text: reason, kind: "info" }]) });

  switch (a.type) {
    case "decide": {
      const d = v4Decide(a.src, s.config[a.src], a.dst);
      return { ...s, decision: d, last: { type: "decide" }, log: pushLog(s, [{ text: dtext(d) }]) };
    }
    case "send": {
      if (s.r1Queue) return noop("A packet is waiting at R1 — let R1 route it first");
      if (a.dst === V4_STATIONS[a.src].ip) return noop("Pick a destination other than the source");
      const rec = planSend(s, a.src, a.dst, !!a.throughRouter);
      return { ...s, decision: rec.decision, records: [...s.records, rec], tx: { rec: s.records.length, wave: 0 }, last: { type: "traffic", rec: s.records.length }, log: pushLog(s, [{ text: dtext(rec.decision!) }]) };
    }
    case "route": {
      if (!s.r1Queue) return noop("No packet is waiting at R1");
      const q = s.r1Queue;
      const prev = s.records[q.rec];
      const p: Plan = { frames: [prev.frames[q.frame]], kinds: ["ipv4"], waves: [], arp: [], sim: structuredClone(s.arp), id: s.records.length + 1 };
      const r = planRoute(p, 0);
      const rec: V4Record = { id: p.id, kind: "route", src: "R1", dst: fieldOf(prev.frames[q.frame], /^IPv4/, "Destination"), frames: p.frames, frameKinds: p.kinds, waves: p.waves, arp: p.arp, result: r.result, routing: r.routing };
      return { ...s, r1Queue: undefined, records: [...s.records, rec], tx: { rec: s.records.length, wave: 0 }, last: { type: "traffic", rec: s.records.length }, log: pushLog(s, [{ text: `R1 looks up ${rec.dst} in its routing table` }]) };
    }
    case "set-prefix":
      return { ...s, config: { ...s.config, "HOST-A": { ...s.config["HOST-A"], prefix: a.prefix } }, last: { type: "config", what: "prefix" }, log: pushLog(s, [{ text: `HOST-A prefix set to /${a.prefix} (${maskOf(a.prefix)})`, kind: "warning" }]) };
    case "set-gateway":
      return { ...s, config: { ...s.config, "HOST-A": { ...s.config["HOST-A"], gateway: a.gateway } }, last: { type: "config", what: "gateway" }, log: pushLog(s, [{ text: `HOST-A default gateway set to ${a.gateway}`, kind: "warning" }]) };
    case "clear-arp":
      return { ...s, arp: { "HOST-A": {}, "HOST-C": {}, "HOST-B": {}, R1: {} }, last: { type: "config", what: "arp" }, log: pushLog(s, [{ text: "All ARP caches cleared", kind: "warning" }]) };
    case "incident":
      // The same wrong /24 as the guided lesson. The log deliberately does not name it.
      return { ...s, config: { ...s.config, "HOST-A": { ...s.config["HOST-A"], prefix: V4_FAULT_PREFIX } }, incident: { active: true, repaired: false }, last: { type: "incident" }, log: pushLog(s, [{ text: "Ticket: HOST-A can reach HOST-C but cannot reach HOST-B. A network setting was recently changed.", kind: "warning" }]) };
    case "repair": {
      const correct = a.choice === V4_LAB_REPAIR_CORRECT;
      const label = V4_LAB_REPAIRS.find((r) => r.id === a.choice)?.label ?? a.choice;
      if (!correct) return { ...s, last: { type: "repair", choice: a.choice, correct }, log: pushLog(s, [{ text: `Tried: ${label} — nothing about HOST-A's forwarding decision changes`, kind: "warning" }]) };
      return { ...s, config: { ...s.config, "HOST-A": { ...s.config["HOST-A"], prefix: V4_PREFIX } }, incident: { active: true, repaired: true }, last: { type: "repair", choice: a.choice, correct }, log: pushLog(s, [{ text: `Repair: HOST-A prefix restored to /${V4_PREFIX} (${maskOf(V4_PREFIX)}). Not verified yet — send traffic.`, kind: "warning" }]) };
    }
  }
}

function arrive(s: V4LabState): V4LabState {
  if (!s.tx) return s;
  const rec = s.records[s.tx.rec];
  if (s.tx.wave >= rec.waves.length) return s;
  const wave = rec.waves[s.tx.wave];
  let next: V4LabState = { ...s, tx: { ...s.tx, wave: s.tx.wave + 1 } };
  const logs: { text: string; kind?: V4LogEntry["kind"] }[] = [];
  for (const e of wave.effects) {
    if (e.type === "arp-learn") next = { ...next, arp: { ...next.arp, [e.table]: { ...next.arp[e.table], [e.ip]: e.mac } } };
    else if (e.type === "arp-incomplete") next = { ...next, arp: { ...next.arp, [e.table]: { ...next.arp[e.table], [e.ip]: INCOMPLETE } } };
    else if (e.type === "r1-forwarded") next = { ...next, r1Forwarded: next.r1Forwarded + 1 };
    else if (e.type === "delivered") next = { ...next, delivered: { ...next.delivered, [e.host]: next.delivered[e.host] + 1 } };
    else if (e.type === "at-router") next = { ...next, r1Queue: { rec: s.tx.rec, frame: e.frame } };
    else logs.push({ text: e.text, kind: e.kind });
  }
  return logs.length ? { ...next, log: pushLog(next, logs) } : next;
}

export const V4_LAB_MODEL: LabModel<V4LabState, V4LabAction> = {
  initial: createV4LabState,
  hops: (s, a) => {
    const n = start(s, a);
    return n.tx ? n.records[n.tx.rec].waves.length : 0;
  },
  start,
  arrive,
  /** What R1's CLI can see: its ARP cache (routes and interfaces never change in this lab). */
  revision: (s) => JSON.stringify(s.arp.R1),
};

export const v4IsInFlight = (s: V4LabState) => !!s.tx && s.tx.wave < s.records[s.tx.rec].waves.length;
export const v4CurrentRecord = (s: V4LabState) => (s.tx ? s.records[s.tx.rec] : undefined);

// ---------------------------------------------------------------------------------------------------------------
// Incident repairs (lab) — Proxy ARP is deliberately not offered: it would make traffic flow while hiding the fault.
// ---------------------------------------------------------------------------------------------------------------
export const V4_LAB_REPAIRS = [
  { id: "gateway-65", label: "Change HOST-A's default gateway to 192.168.10.65" },
  { id: "r1-route", label: "Add a route for 192.168.10.64/26 on R1" },
  { id: "restore-26", label: `Set HOST-A's prefix back to /${V4_PREFIX} (${maskOf(V4_PREFIX)})` },
  { id: "restart-b", label: "Restart HOST-B" },
] as const;
export const V4_LAB_REPAIR_CORRECT = "restore-26";
