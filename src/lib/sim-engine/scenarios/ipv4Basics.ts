import type { PacketLayer, PacketVisual, PVEvent, PVEventType, ScenarioStep } from "../types";
import type { ProcessingStage } from "@/components/network3d/types";
import type { FundHop } from "@/components/lesson/fundamentalsTrace";

/**
 * IPv4 Addressing & Subnetting — the second Fundamentals lesson. HOST-A — SW-A — R1 — SW-B — HOST-B.
 *
 * Modeled exactly (RFC 791 / 1122 / 1812 / 4632, CIDR — never classful):
 * - A host decides "on-link or not" by ANDing its OWN address and the destination with ITS OWN mask.
 * - Off-link traffic is framed to the default gateway's MAC while the IPv4 destination stays the final host.
 * - R1 (no dynamic routing — only its two connected /26s) decrements TTL, recomputes the header checksum, and
 *   builds a NEW Ethernet frame for the outgoing segment. IPv4 source/destination never change.
 * - Fault: HOST-A's mask is mistyped as /24, so HOST-A believes 192.168.10.70 is on-link and ARPs for it directly.
 *   R1 does NOT run Proxy ARP, so nobody answers and HOST-A cannot send. The fix is restoring /26.
 * ARP caches for the gateway and hosts are pre-populated (a stated assumption; ARP itself is its own lesson), and
 * SW-A/SW-B have already learned their hosts' MACs.
 */

export type Ipv4Device = "HOST-A" | "SW-A" | "R1" | "SW-B" | "HOST-B";
export const IPV4_DEVICES: Ipv4Device[] = ["HOST-A", "SW-A", "R1", "SW-B", "HOST-B"];

export const V4_IP = { "HOST-A": "192.168.10.10", "HOST-B": "192.168.10.70", R1L: "192.168.10.1", R1R: "192.168.10.65" } as const;
export const V4_MAC = { "HOST-A": "00:1A:2B:00:00:0A", "HOST-B": "00:1A:2B:00:00:0B", R1L: "00:1A:2B:00:01:01", R1R: "00:1A:2B:00:01:02" } as const;
export const V4_PREFIX = 26;
export const V4_FAULT_PREFIX = 24;
export const GATEWAY = { "HOST-A": V4_IP.R1L, "HOST-B": V4_IP.R1R } as const;
export const INITIAL_TTL = 64;

// ---------------------------------------------------------------------------------------------------------------
// Pure IPv4 arithmetic (CIDR)
// ---------------------------------------------------------------------------------------------------------------
export const ipToNum = (ip: string) => ip.split(".").reduce((a, o) => a * 256 + Number(o), 0);
export const numToIp = (n: number) => [24, 16, 8, 0].map((s) => Math.floor(n / 2 ** s) % 256).join(".");
export const maskNum = (prefix: number) => (prefix === 0 ? 0 : (0xffffffff - (2 ** (32 - prefix) - 1)) >>> 0);
export const maskOf = (prefix: number) => numToIp(maskNum(prefix));
/** Bitwise AND on unsigned 32-bit values. */
export const and32 = (a: number, b: number) => (a & b) >>> 0;
export const networkOf = (ip: string, prefix: number) => numToIp(and32(ipToNum(ip), maskNum(prefix)));
export const blockSize = (prefix: number) => 2 ** (32 - prefix);
export const broadcastOf = (ip: string, prefix: number) => numToIp(and32(ipToNum(ip), maskNum(prefix)) + blockSize(prefix) - 1);
/** Ordinary host range (network and broadcast excluded) — valid for /0–/30 only; /31 and /32 are special cases. */
export function hostRange(ip: string, prefix: number): { first: string; last: string; count: number } | undefined {
  if (prefix > 30) return undefined;
  const net = and32(ipToNum(ip), maskNum(prefix));
  return { first: numToIp(net + 1), last: numToIp(net + blockSize(prefix) - 2), count: blockSize(prefix) - 2 };
}
export const sameSubnet = (a: string, b: string, prefix: number) => networkOf(a, prefix) === networkOf(b, prefix);
export const toBinary = (ip: string) => ip.split(".").map((o) => Number(o).toString(2).padStart(8, "0")).join(".");
/** Every /prefix subnet inside a parent block, e.g. the four /26s in 192.168.10.0/24. */
export function subnetsOf(parent: string, parentPrefix: number, prefix: number) {
  const base = and32(ipToNum(parent), maskNum(parentPrefix));
  const n = 2 ** (prefix - parentPrefix);
  return Array.from({ length: n }, (_, i) => {
    const net = numToIp(base + i * blockSize(prefix));
    return { network: net, prefix, broadcast: broadcastOf(net, prefix), range: hostRange(net, prefix) };
  });
}

/** RFC 791 header checksum over a 20-byte header (ones'-complement sum of 16-bit words, checksum field zero). */
export function ipv4Checksum(h: { totalLength: number; id: number; flagsFrag: number; ttl: number; protocol: number; src: string; dst: string }): number {
  const s = ipToNum(h.src);
  const d = ipToNum(h.dst);
  const words = [0x4500, h.totalLength, h.id, h.flagsFrag, (h.ttl << 8) | h.protocol, 0, Math.floor(s / 65536), s % 65536, Math.floor(d / 65536), d % 65536];
  let sum = words.reduce((a, w) => a + w, 0);
  while (sum > 0xffff) sum = (sum & 0xffff) + Math.floor(sum / 65536);
  return ~sum & 0xffff;
}
const hex4 = (n: number) => `0x${n.toString(16).toUpperCase().padStart(4, "0")}`;

// ---------------------------------------------------------------------------------------------------------------
// Packets — only real Ethernet / IPv4 / ARP fields
// ---------------------------------------------------------------------------------------------------------------
const UDP_TOTAL_LENGTH = 60; // 20 B IPv4 header + 8 B UDP header + 32 B data
const IP_ID = 0x1a2b;
const DF = 0x4000;

export function ipv4Layer(src: string, dst: string, ttl: number): PacketLayer {
  const checksum = ipv4Checksum({ totalLength: UDP_TOTAL_LENGTH, id: IP_ID, flagsFrag: DF, ttl, protocol: 17, src, dst });
  return {
    name: "IPv4 Header",
    color: "#60a5fa",
    fields: [
      { label: "Version", value: "4" },
      { label: "IHL", value: "5 (20 bytes)" },
      { label: "Total Length", value: `${UDP_TOTAL_LENGTH}` },
      { label: "TTL", value: `${ttl}` },
      { label: "Protocol", value: "17 (UDP)" },
      { label: "Header Checksum", value: hex4(checksum) },
      { label: "Source", value: src },
      { label: "Destination", value: dst },
    ],
  };
}

export function ipFrame(id: string, from: string, to: string, ethSrc: string, ethDst: string, ip: PacketLayer): PacketVisual {
  const ttl = ip.fields.find((f) => f.label === "TTL")?.value ?? "";
  const s = ip.fields.find((f) => f.label === "Source")?.value ?? "";
  const d = ip.fields.find((f) => f.label === "Destination")?.value ?? "";
  return {
    id,
    protocol: "IP",
    from,
    to,
    badge: "IPv4",
    summary: `IPv4 ${s} → ${d} — TTL ${ttl}`,
    layers: [
      { name: "Ethernet II Header", color: "#94a3b8", fields: [{ label: "Destination MAC", value: ethDst }, { label: "Source MAC", value: ethSrc }, { label: "EtherType", value: "0x0800 (IPv4)" }] },
      ip,
      { name: "UDP Datagram", color: "#34d399", fields: [{ label: "Length", value: "40 (8 B header + 32 B data)" }] },
      { name: "FCS", color: "#94a3b8", fields: [{ label: "Frame Check Sequence", value: "CRC-32 over the frame" }] },
    ],
  };
}

export function arpRequestFrame(id: string, from: string, to: string, senderMac: string, senderIp: string, targetIp: string): PacketVisual {
  return {
    id,
    protocol: "ARP",
    from,
    to,
    broadcast: true,
    badge: "ARP",
    summary: `ARP request — who has ${targetIp}? tell ${senderIp}`,
    layers: [
      { name: "Ethernet II Header", color: "#94a3b8", fields: [{ label: "Destination MAC", value: "FF:FF:FF:FF:FF:FF" }, { label: "Source MAC", value: senderMac }, { label: "EtherType", value: "0x0806 (ARP)" }] },
      {
        name: "ARP",
        color: "#f59e0b",
        fields: [
          { label: "Operation", value: "1 (request)" },
          { label: "Sender MAC", value: senderMac },
          { label: "Sender IP", value: senderIp },
          { label: "Target MAC", value: "00:00:00:00:00:00" },
          { label: "Target IP", value: targetIp },
        ],
      },
      { name: "FCS", color: "#94a3b8", fields: [{ label: "Frame Check Sequence", value: "CRC-32 over the frame" }] },
    ],
  };
}

const f = (p: PacketVisual, layerRe: RegExp, label: string) => p.layers.find((l) => layerRe.test(l.name))?.fields.find((x) => x.label === label)?.value ?? "";
export const pktTtl = (p: PacketVisual) => f(p, /^IPv4/, "TTL");
export function v4Stack(p: PacketVisual, changed: string[] = []) {
  if (p.protocol === "ARP") {
    return [
      { id: "eth", text: `Ethernet · dst ${f(p, /^Ethernet/, "Destination MAC")} · src ${f(p, /^Ethernet/, "Source MAC")} · 0x0806`, tone: "generic" as const, justChanged: changed.includes("eth") },
      { id: "arp", text: `ARP request · who has ${f(p, /^ARP/, "Target IP")}? tell ${f(p, /^ARP/, "Sender IP")}`, tone: "vpn" as const },
    ];
  }
  return [
    { id: "eth", text: `Ethernet · dst ${f(p, /^Ethernet/, "Destination MAC")} · src ${f(p, /^Ethernet/, "Source MAC")}`, tone: "generic" as const, justChanged: changed.includes("eth") },
    { id: "ip", text: `IPv4 · ${f(p, /^IPv4/, "Source")} → ${f(p, /^IPv4/, "Destination")} · TTL ${f(p, /^IPv4/, "TTL")} · csum ${f(p, /^IPv4/, "Header Checksum")}`, tone: "ip" as const, justChanged: changed.includes("ip") },
    { id: "udp", text: "UDP datagram", tone: "transport" as const },
  ];
}

// ---------------------------------------------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------------------------------------------
export interface NextHopDecision {
  host: "HOST-A" | "HOST-B";
  prefix: number;
  myNetwork: string;
  dstNetwork: string;
  onLink: boolean;
  l2NextHop: string;
}

export interface Ipv4State {
  hops: FundHop[];
  hostAPrefix: number;
  packet?: PacketVisual;
  flood: { id: string; fromId: string; toId: string; packet: PacketVisual }[];
  /** The latest host next-hop decision (historical steps show their own). */
  decision?: NextHopDecision;
  /** Short device decision for callouts — never part of any header. */
  note?: { device: Ipv4Device; text: string };
  hostAUnresolved: boolean;
  faultActive: boolean;
  repairAttempt?: { choice: string; correct: boolean };
  repaired: boolean;
}

export const createIpv4State = (): Ipv4State => ({ hops: [], hostAPrefix: V4_PREFIX, flood: [], hostAUnresolved: false, faultActive: false, repaired: false });

export function decide(host: "HOST-A" | "HOST-B", prefix: number, dst: string): NextHopDecision {
  const me = V4_IP[host];
  const onLink = sameSubnet(me, dst, prefix);
  return { host, prefix, myNetwork: `${networkOf(me, prefix)}/${prefix}`, dstNetwork: `${networkOf(dst, prefix)}/${prefix}`, onLink, l2NextHop: onLink ? dst : GATEWAY[host] };
}

// ---------------------------------------------------------------------------------------------------------------
// Stages
// ---------------------------------------------------------------------------------------------------------------
export const HOST_STAGES: ProcessingStage[] = [
  { id: "and", label: "AND my IP and destination with MY mask" },
  { id: "compare", label: "Same network? → on-link : gateway" },
  { id: "resolve", label: "Look up the L2 next hop's MAC" },
  { id: "tx", label: "Frame and transmit" },
];
export const HOST_RX_STAGES: ProcessingStage[] = [
  { id: "l2", label: "Destination MAC = mine?" },
  { id: "l3", label: "Destination IPv4 = mine?" },
  { id: "deliver", label: "Deliver to UDP" },
];
export const ROUTER_STAGES: ProcessingStage[] = [
  { id: "rx", label: "Receive frame · dst MAC is mine" },
  { id: "decap", label: "Remove incoming Ethernet header" },
  { id: "check", label: "Validate IPv4 header" },
  { id: "lookup", label: "Longest-prefix match on destination" },
  { id: "ttl", label: "TTL − 1 · recompute header checksum" },
  { id: "rewrite", label: "Build new Ethernet frame for egress" },
  { id: "tx", label: "Transmit" },
];
export const SWITCH_STAGES: ProcessingStage[] = [
  { id: "learn", label: "Learn source MAC" },
  { id: "lookup", label: "Look up destination MAC" },
  { id: "tx", label: "Forward / flood (frame unchanged)" },
];
const withDetail = (base: ProcessingStage[], d: Partial<Record<string, string>>): ProcessingStage[] => base.map((s) => (d[s.id] ? { ...s, detail: d[s.id] } : s));

/** R1's connected routes — the only routes it has. */
export const R1_ROUTES = [
  { prefix: `${networkOf(V4_IP.R1L, V4_PREFIX)}/${V4_PREFIX}`, iface: "ge-0/0/0", via: "connected", addr: `${V4_IP.R1L}/${V4_PREFIX}` },
  { prefix: `${networkOf(V4_IP.R1R, V4_PREFIX)}/${V4_PREFIX}`, iface: "ge-0/0/1", via: "connected", addr: `${V4_IP.R1R}/${V4_PREFIX}` },
];
export function r1Lookup(dst: string) {
  return R1_ROUTES.find((r) => sameSubnet(dst, r.prefix.split("/")[0], Number(r.prefix.split("/")[1])));
}
/** Switch ports: SW-A p1 → HOST-A, p2 → R1 ge-0/0/0; SW-B p1 → R1 ge-0/0/1, p2 → HOST-B. */
export const SW_PORTS: Record<"SW-A" | "SW-B", { port: string; to: Ipv4Device; mac: string }[]> = {
  "SW-A": [
    { port: "p1", to: "HOST-A", mac: V4_MAC["HOST-A"] },
    { port: "p2", to: "R1", mac: V4_MAC.R1L },
  ],
  "SW-B": [
    { port: "p1", to: "R1", mac: V4_MAC.R1R },
    { port: "p2", to: "HOST-B", mac: V4_MAC["HOST-B"] },
  ],
};

// ---------------------------------------------------------------------------------------------------------------
// Step helpers
// ---------------------------------------------------------------------------------------------------------------
const ev = (type: PVEventType, stepId: string, message: string): PVEvent => ({ type, stepId, timestamp: Date.now(), message });
const push = (s: Ipv4State, hop: FundHop, patch: Partial<Ipv4State> = {}): Ipv4State => ({ ...s, ...patch, hops: [...s.hops, hop] });

function hostDecide(s: Ipv4State, stepId: string, host: "HOST-A" | "HOST-B", dst: string, prefix: number): Ipv4State {
  const d = decide(host, prefix, dst);
  const mask = maskOf(prefix);
  const hop: FundHop = {
    stepId,
    device: host,
    stages: withDetail(HOST_STAGES, { and: `${V4_IP[host]} AND ${mask} = ${d.myNetwork.split("/")[0]} · ${dst} AND ${mask} = ${d.dstNetwork.split("/")[0]}`, compare: d.onLink ? "same network → on-link" : `different → gateway ${GATEWAY[host]}` }),
    activeStageId: "compare",
    lookupType: `Same-subnet test (/${prefix})`,
    lookupKey: `${V4_IP[host]} vs ${dst} with ${mask}`,
    lookupResult: d.onLink ? `on-link (${d.myNetwork})` : `remote: ${d.myNetwork} ≠ ${d.dstNetwork}`,
    action: d.onLink ? "ON-LINK" : "VIA GATEWAY",
    reason: d.onLink ? `With /${prefix}, ${dst} falls inside ${host}'s own network ${d.myNetwork}, so ${host} will try to reach it directly on the LAN.` : `${dst} is in ${d.dstNetwork}, not ${host}'s ${d.myNetwork}. The IPv4 destination stays ${dst}; the Layer-2 next hop is the default gateway ${GATEWAY[host]}.`,
    input: `send to ${dst}`,
    output: `L2 next hop ${d.l2NextHop}`,
    nextHopId: d.onLink ? undefined : "R1",
  };
  return push(s, hop, { decision: d, packet: undefined, flood: [], note: { device: host, text: `${host}: ${d.onLink ? "on-link" : `remote → gateway ${GATEWAY[host]}`}` } });
}

function hostSend(s: Ipv4State, stepId: string, host: "HOST-A" | "HOST-B", pkt: PacketVisual): Ipv4State {
  const gw = GATEWAY[host];
  const hop: FundHop = {
    stepId,
    device: host,
    stages: withDetail(HOST_STAGES, { and: "done", compare: `remote → gateway ${gw}`, resolve: `${gw} → ${host === "HOST-A" ? V4_MAC.R1L : V4_MAC.R1R} (ARP cache)`, tx: "eth0" }),
    activeStageId: "tx",
    egressInterfaceId: "eth0",
    lookupType: "ARP cache (gateway)",
    lookupKey: gw,
    lookupResult: host === "HOST-A" ? V4_MAC.R1L : V4_MAC.R1R,
    action: "SEND VIA GATEWAY",
    reason: `The frame is addressed to the gateway's MAC so R1 accepts it; the IPv4 header still says ${f(pkt, /^IPv4/, "Destination")}.`,
    input: `IPv4 ${f(pkt, /^IPv4/, "Source")} → ${f(pkt, /^IPv4/, "Destination")}`,
    output: `frame to ${f(pkt, /^Ethernet/, "Destination MAC")} (R1)`,
    nextHopId: host === "HOST-A" ? "SW-A" : "SW-B",
    after: v4Stack(pkt),
  };
  return push(s, hop, { packet: pkt, flood: [], note: { device: host, text: `${host}: IPv4 dst ${f(pkt, /^IPv4/, "Destination")} · L2 to gateway` } });
}

function switchForward(s: Ipv4State, stepId: string, sw: "SW-A" | "SW-B", inPort: string, pkt: PacketVisual, to: Ipv4Device): Ipv4State {
  const dst = f(pkt, /^Ethernet/, "Destination MAC");
  const bcast = dst === "FF:FF:FF:FF:FF:FF";
  const out = SW_PORTS[sw].find((p) => p.to === to)?.port ?? "";
  const hop: FundHop = {
    stepId,
    device: sw,
    stages: withDetail(SWITCH_STAGES, { learn: `${f(pkt, /^Ethernet/, "Source MAC")} on ${inPort}`, lookup: bcast ? "broadcast" : `${dst} → ${out}`, tx: bcast ? `flood out ${out} (only other port)` : `out ${out}` }),
    activeStageId: "tx",
    ingressInterfaceId: inPort,
    egressInterfaceId: out,
    lookupType: "FDB (MAC table)",
    lookupKey: dst,
    lookupResult: bcast ? "broadcast — flood" : `${dst} → ${out}`,
    action: bcast ? "FLOOD" : "FORWARD",
    reason: bcast ? `A broadcast is flooded out every other port — here only ${out}.` : `Known unicast: a switch forwards by destination MAC and never looks at the IPv4 header.`,
    input: `frame dst ${dst}`,
    output: `same frame out ${out}`,
    nextHopId: to,
    before: v4Stack(pkt),
    after: v4Stack(pkt),
  };
  return push(s, hop, { packet: { ...pkt, id: `${stepId}-pkt`, from: sw, to }, flood: [], note: { device: sw, text: `${sw}: ${bcast ? "broadcast flood" : "known unicast"} out ${out}` } });
}

function r1Route(s: Ipv4State, stepId: string, pkt: PacketVisual, stage: "lookup" | "tx"): Ipv4State {
  const src = f(pkt, /^IPv4/, "Source");
  const dst = f(pkt, /^IPv4/, "Destination");
  const ttlIn = Number(f(pkt, /^IPv4/, "TTL"));
  const route = r1Lookup(dst);
  const inIface = route?.iface === "ge-0/0/1" ? "ge-0/0/0" : "ge-0/0/1";
  const outMacs = route?.iface === "ge-0/0/1" ? { src: V4_MAC.R1R, dst: V4_MAC["HOST-B"], sw: "SW-B" as const } : { src: V4_MAC.R1L, dst: V4_MAC["HOST-A"], sw: "SW-A" as const };
  const outPkt = ipFrame(`${stepId}-out`, "R1", outMacs.sw, outMacs.src, outMacs.dst, ipv4Layer(src, dst, ttlIn - 1));
  const csIn = f(pkt, /^IPv4/, "Header Checksum");
  const csOut = f(outPkt, /^IPv4/, "Header Checksum");
  const hop: FundHop = {
    stepId,
    device: "R1",
    stages: withDetail(ROUTER_STAGES, {
      rx: `on ${inIface} · dst ${f(pkt, /^Ethernet/, "Destination MAC")}`,
      decap: "Ethernet header removed",
      check: `checksum ${csIn} OK · TTL ${ttlIn}`,
      lookup: route ? `${dst} ∈ ${route.prefix} → ${route.iface} (connected)` : "no route",
      ...(stage === "tx" ? { ttl: `TTL ${ttlIn} → ${ttlIn - 1} · checksum ${csIn} → ${csOut}`, rewrite: `src ${outMacs.src} · dst ${outMacs.dst}`, tx: `out ${route?.iface}` } : {}),
    }),
    activeStageId: stage,
    ingressInterfaceId: inIface,
    egressInterfaceId: stage === "tx" ? route?.iface : undefined,
    lookupType: "IPv4 routing table",
    lookupKey: dst,
    lookupResult: route ? `${route.prefix} via ${route.iface} (directly connected)` : "no route",
    action: stage === "lookup" ? "ROUTE LOOKUP" : "ROUTE · TTL−1 · REWRITE L2",
    reason:
      stage === "lookup"
        ? `R1 accepted the frame because it was addressed to its own MAC, removed the Ethernet header, and looked up ${dst}: it is on the directly connected ${route?.prefix}.`
        : `R1 decrements TTL (${ttlIn} → ${ttlIn - 1}), recomputes the header checksum (${csIn} → ${csOut}) because a header field changed, and wraps the SAME IPv4 source/destination in a NEW Ethernet frame for ${route?.iface}.`,
    input: `IPv4 ${src} → ${dst} · TTL ${ttlIn}`,
    output: stage === "tx" ? `IPv4 ${src} → ${dst} · TTL ${ttlIn - 1} in frame ${outMacs.src} → ${outMacs.dst}` : `route ${route?.prefix ?? "none"} via ${route?.iface ?? "—"}`,
    nextHopId: stage === "tx" ? outMacs.sw : undefined,
    before: v4Stack(pkt),
    after: stage === "tx" ? v4Stack(outPkt, ["eth", "ip"]) : undefined,
    mutations:
      stage === "tx"
        ? [
            { type: "TTL_CHANGE", detail: `${ttlIn} → ${ttlIn - 1}` },
            { type: "SA_CHANGE", detail: `→ ${outMacs.src}` },
            { type: "DA_CHANGE", detail: `→ ${outMacs.dst}` },
          ]
        : undefined,
  };
  const note = { device: "R1" as const, text: stage === "tx" ? `R1: ${route?.prefix} connected · TTL ${ttlIn}→${ttlIn - 1} · new frame` : `R1: ${dst} ∈ ${route?.prefix} (connected)` };
  if (stage === "lookup") return push(s, hop, { packet: pkt, flood: [], note });
  return push(s, hop, { packet: outPkt, flood: [], note });
}

function hostReceive(s: Ipv4State, stepId: string, host: "HOST-A" | "HOST-B", pkt: PacketVisual): Ipv4State {
  const hop: FundHop = {
    stepId,
    device: host,
    stages: withDetail(HOST_RX_STAGES, { l2: `${f(pkt, /^Ethernet/, "Destination MAC")} = mine`, l3: `${f(pkt, /^IPv4/, "Destination")} = mine`, deliver: `TTL arrived as ${f(pkt, /^IPv4/, "TTL")}` }),
    activeStageId: "deliver",
    ingressInterfaceId: "eth0",
    lookupType: "Local delivery",
    lookupKey: f(pkt, /^IPv4/, "Destination"),
    lookupResult: "local address",
    action: "DELIVER",
    reason: `Both the frame (MAC) and the packet (IPv4) are addressed to ${host}. The frame came from R1, but the packet's source is still ${f(pkt, /^IPv4/, "Source")}.`,
    input: `IPv4 ${f(pkt, /^IPv4/, "Source")} → ${f(pkt, /^IPv4/, "Destination")} · TTL ${f(pkt, /^IPv4/, "TTL")}`,
    output: "delivered to UDP",
    before: v4Stack(pkt),
  };
  return push(s, hop, { packet: undefined, flood: [], note: { device: host, text: `${host}: delivered` } });
}

const aPacket = (id: string) => ipFrame(id, "HOST-A", "SW-A", V4_MAC["HOST-A"], V4_MAC.R1L, ipv4Layer(V4_IP["HOST-A"], V4_IP["HOST-B"], INITIAL_TTL));
const bPacket = (id: string) => ipFrame(id, "HOST-B", "SW-B", V4_MAC["HOST-B"], V4_MAC.R1R, ipv4Layer(V4_IP["HOST-B"], V4_IP["HOST-A"], INITIAL_TTL));
const idle = (s: Ipv4State): Ipv4State => ({ ...s, packet: undefined, flood: [], note: undefined });
/** R1's output packet for a hop, re-derived for the next switch/host step. */
const routed = (id: string, from: "HOST-A" | "HOST-B") => {
  const inPkt = from === "HOST-A" ? aPacket(id) : bPacket(id);
  const src = f(inPkt, /^IPv4/, "Source");
  const dst = f(inPkt, /^IPv4/, "Destination");
  return from === "HOST-A" ? ipFrame(id, "R1", "SW-B", V4_MAC.R1R, V4_MAC["HOST-B"], ipv4Layer(src, dst, INITIAL_TTL - 1)) : ipFrame(id, "R1", "SW-A", V4_MAC.R1L, V4_MAC["HOST-A"], ipv4Layer(src, dst, INITIAL_TTL - 1));
};

// ---------------------------------------------------------------------------------------------------------------
// Repair
// ---------------------------------------------------------------------------------------------------------------
export const IPV4_REPAIR_OPTIONS = [
  { id: "restore-26", label: "Set HOST-A's prefix back to /26 (255.255.255.192)" },
  { id: "proxy-arp", label: "Enable Proxy ARP on R1 ge-0/0/0" },
  { id: "static-route", label: "Add a static route for 192.168.10.64/26 on R1" },
  { id: "readdress-b", label: "Change HOST-B's address to 192.168.10.20" },
] as const;
export const IPV4_REPAIR_CORRECT = "restore-26";
export function applyIpv4Repair(s: Ipv4State, choice: string): Ipv4State {
  const correct = choice === IPV4_REPAIR_CORRECT;
  if (!correct) return { ...s, repairAttempt: { choice, correct } };
  return { ...s, repairAttempt: { choice, correct }, repaired: true, faultActive: false, hostAPrefix: V4_PREFIX, hostAUnresolved: false, note: { device: "HOST-A", text: `HOST-A: prefix restored to /${V4_PREFIX}` } };
}

// ---------------------------------------------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------------------------------------------
const net = (ip: string, p: number) => `${networkOf(ip, p)}/${p}`;

export const ipv4BasicsSteps: ScenarioStep<Ipv4State>[] = [
  {
    id: "intro",
    label: "Two subnets, one router",
    narrative: `HOST-A (${V4_IP["HOST-A"]}/${V4_PREFIX}) and HOST-B (${V4_IP["HOST-B"]}/${V4_PREFIX}) sit on different subnets, joined by R1. You'll see how a host decides where to send a packet, and what a router changes on the way.`,
  },
  {
    id: "address-anatomy",
    label: "An IPv4 address is 32 bits",
    narrative: `${V4_IP["HOST-A"]} is dotted-decimal shorthand for 32 bits: ${toBinary(V4_IP["HOST-A"])}. Each of the four octets is 8 bits (0–255).`,
  },
  {
    id: "prefix-mask",
    label: "Prefix length and mask",
    narrative: `/${V4_PREFIX} means the first ${V4_PREFIX} bits are the NETWORK part and the remaining ${32 - V4_PREFIX} bits identify a host. Written as a mask, that is ${maskOf(V4_PREFIX)} (${toBinary(maskOf(V4_PREFIX))}).`,
  },
  {
    id: "predict-mask",
    label: "Predict: the /26 boundary",
    narrative: `The mask marks where the network bits end.`,
    question: {
      prompt: "How many host bits does /26 leave, and how many addresses does each /26 block hold?",
      options: [
        { id: "6-64", label: "6 host bits → 64 addresses per block" },
        { id: "8-256", label: "8 host bits → 256 addresses per block" },
        { id: "2-4", label: "2 host bits → 4 addresses per block" },
        { id: "6-62", label: "6 host bits → 62 addresses per block" },
      ],
      correctOptionId: "6-64",
      explanation: `32 − 26 = 6 host bits, and 2⁶ = 64 addresses per block. Of those 64, the all-zeros address (network) and all-ones address (broadcast) are reserved, leaving 62 ordinary host addresses. Mask: ${maskOf(V4_PREFIX)}.`,
    },
  },
  {
    id: "subnet-chamber",
    label: "Subnet chamber",
    narrative: "Use the chamber below: pick an address and a prefix and watch the network address, broadcast address and host range fall out of the binary boundary. Try .10, .63, .64 and .70 with /26.",
  },
  {
    id: "predict-block",
    label: "Predict: which /26?",
    narrative: `192.168.10.0/24 splits into four /26 blocks of 64 (borrowing 2 bits).`,
    question: {
      prompt: `Which /26 subnet contains ${V4_IP["HOST-B"]}?`,
      options: [
        { id: "64", label: "192.168.10.64/26 (hosts .65–.126)" },
        { id: "0", label: "192.168.10.0/26 (hosts .1–.62)" },
        { id: "128", label: "192.168.10.128/26 (hosts .129–.190)" },
        { id: "70", label: "192.168.10.70/26 — every address starts its own subnet" },
      ],
      correctOptionId: "64",
      explanation: "Blocks start at multiples of 64: .0, .64, .128, .192. 70 falls between 64 and 127, so it is in 192.168.10.64/26 (70 AND 192 = 64).",
    },
  },
  {
    id: "four-subnets",
    label: "The four /26 subnets",
    narrative: subnetsOf("192.168.10.0", 24, V4_PREFIX)
      .map((x) => `${x.network}/26 → hosts ${x.range?.first.split(".")[3]}–${x.range?.last.split(".")[3]}, broadcast .${x.broadcast.split(".")[3]}`)
      .join(" · "),
  },
  {
    id: "host-a-subnet",
    label: "HOST-A's subnet",
    narrative: `${V4_IP["HOST-A"]}/${V4_PREFIX} → network ${networkOf(V4_IP["HOST-A"], V4_PREFIX)}, broadcast ${broadcastOf(V4_IP["HOST-A"], V4_PREFIX)}, hosts ${hostRange(V4_IP["HOST-A"], V4_PREFIX)?.first}–${hostRange(V4_IP["HOST-A"], V4_PREFIX)?.last}. Its gateway, R1 ge-0/0/0 ${V4_IP.R1L}, is in the same subnet — a gateway must be on-link.`,
  },
  {
    id: "host-b-subnet",
    label: "HOST-B's subnet",
    narrative: `${V4_IP["HOST-B"]}/${V4_PREFIX} → network ${networkOf(V4_IP["HOST-B"], V4_PREFIX)}, broadcast ${broadcastOf(V4_IP["HOST-B"], V4_PREFIX)}, hosts ${hostRange(V4_IP["HOST-B"], V4_PREFIX)?.first}–${hostRange(V4_IP["HOST-B"], V4_PREFIX)?.last}. Its gateway is R1 ge-0/0/1 ${V4_IP.R1R}.`,
  },
  {
    id: "predict-local",
    label: "Predict: local or remote?",
    narrative: `HOST-A wants to send a UDP packet to ${V4_IP["HOST-B"]}.`,
    question: {
      prompt: `Is ${V4_IP["HOST-B"]} local to ${V4_IP["HOST-A"]}/${V4_PREFIX}?`,
      options: [
        { id: "remote", label: "No — it is in 192.168.10.64/26, a different network" },
        { id: "local", label: "Yes — both start with 192.168.10" },
        { id: "classC", label: "Yes — 192.168.x.x is a Class C, so it's one network" },
        { id: "gw", label: "Only if the gateway says so" },
      ],
      correctOptionId: "remote",
      explanation: "The prefix length decides, not the first three octets and not classful rules. With /26, HOST-A's network is 192.168.10.0 and HOST-B's is 192.168.10.64 — different networks.",
    },
  },
  {
    id: "and-math",
    label: "HOST-A does the AND",
    narrative: `HOST-A ANDs both addresses with its own mask ${maskOf(V4_PREFIX)}: ${V4_IP["HOST-A"]} → ${networkOf(V4_IP["HOST-A"], V4_PREFIX)}, ${V4_IP["HOST-B"]} → ${networkOf(V4_IP["HOST-B"], V4_PREFIX)}. Different results → remote → send via the default gateway ${V4_IP.R1L}.`,
    run: (s) => ({ state: hostDecide(s, "and-math", "HOST-A", V4_IP["HOST-B"], s.hostAPrefix), events: [ev("ROUTE_LOOKUP", "and-math", "HOST-A: destination is remote")] }),
    whatChanged: (_p, n) => [`HOST-A network ${n.decision?.myNetwork} vs destination ${n.decision?.dstNetwork}`, `L2 next hop: ${n.decision?.l2NextHop} (default gateway)`],
  },
  {
    id: "predict-l2-next-hop",
    label: "Predict: which MAC?",
    narrative: `The IPv4 destination will be ${V4_IP["HOST-B"]}. Now HOST-A must put a destination MAC on the Ethernet frame.`,
    question: {
      prompt: "Which Layer-2 next hop does HOST-A address the frame to?",
      options: [
        { id: "r1", label: `R1 ge-0/0/0 (${V4_MAC.R1L}) — the default gateway` },
        { id: "b", label: `HOST-B (${V4_MAC["HOST-B"]})` },
        { id: "bcast", label: "FF:FF:FF:FF:FF:FF" },
        { id: "swa", label: "SW-A's own MAC" },
      ],
      correctOptionId: "r1",
      explanation: "Off-link packets go to the gateway at Layer 2. The frame's destination MAC is R1's; the IPv4 destination stays HOST-B. A switch is transparent — hosts never address frames to it.",
    },
  },
  {
    id: "a-sends",
    label: "HOST-A sends",
    narrative: `IPv4 ${V4_IP["HOST-A"]} → ${V4_IP["HOST-B"]}, TTL ${INITIAL_TTL}, inside an Ethernet frame to ${V4_MAC.R1L} (R1). HOST-A already has R1's MAC in its ARP cache — resolving it is the ARP lesson's job.`,
    run: (s) => ({ state: hostSend(s, "a-sends", "HOST-A", aPacket("a-sends-pkt")), events: [ev("PACKET_SENT", "a-sends", "HOST-A sends via gateway")] }),
    packet: (s) => s.packet,
    whatChanged: () => [`IPv4 dst ${V4_IP["HOST-B"]} (HOST-B)`, `Ethernet dst ${V4_MAC.R1L} (R1)`],
  },
  {
    id: "swa-forwards",
    label: "SW-A forwards to R1",
    narrative: "SW-A switches the frame by its destination MAC to the port facing R1. It does not read or change the IPv4 header.",
    run: (s) => ({ state: switchForward(s, "swa-forwards", "SW-A", "p1", aPacket("a-sends-pkt"), "R1"), events: [ev("PACKET_SENT", "swa-forwards", "SW-A → R1")] }),
    packet: (s) => s.packet,
    whatChanged: () => ["Frame unchanged by SW-A"],
  },
  {
    id: "r1-lookup",
    label: "R1 receives and looks up",
    narrative: `The destination MAC is R1's own, so R1 accepts the frame, removes the Ethernet header and validates the IPv4 header. It looks up ${V4_IP["HOST-B"]}: R1 has two connected routes, and ${net(V4_IP["HOST-B"], V4_PREFIX)} on ge-0/0/1 matches. No routing protocol is involved.`,
    run: (s) => ({ state: r1Route(s, "r1-lookup", ipFrame("r1-in", "SW-A", "R1", V4_MAC["HOST-A"], V4_MAC.R1L, ipv4Layer(V4_IP["HOST-A"], V4_IP["HOST-B"], INITIAL_TTL)), "lookup"), events: [ev("ROUTE_LOOKUP", "r1-lookup", "R1 matches connected /26")] }),
    packet: (s) => s.packet,
    whatChanged: () => [`Match: ${R1_ROUTES[1].prefix} → ge-0/0/1 (connected)`],
  },
  {
    id: "predict-ttl",
    label: "Predict: what does R1 change?",
    narrative: "R1 is about to forward the packet onto HOST-B's segment.",
    packet: (s) => s.packet,
    question: {
      prompt: "What changes as the packet leaves R1?",
      options: [
        { id: "ttl-l2", label: "TTL −1 and the header checksum; plus a brand-new Ethernet header" },
        { id: "src", label: "The IPv4 source becomes R1's address" },
        { id: "dst", label: "The IPv4 destination becomes the gateway" },
        { id: "none", label: "Nothing — routers forward packets unchanged" },
      ],
      correctOptionId: "ttl-l2",
      explanation: "A router decrements TTL (and so must update the header checksum), and it builds a new Layer-2 frame for the outgoing link. The IPv4 source and destination are untouched (no NAT here).",
    },
  },
  {
    id: "r1-forwards",
    label: "R1 forwards: TTL 63, new frame",
    narrative: `TTL ${INITIAL_TTL} → ${INITIAL_TTL - 1}, header checksum recomputed, and a new Ethernet frame: source ${V4_MAC.R1R} (R1 ge-0/0/1), destination ${V4_MAC["HOST-B"]} (HOST-B, from R1's ARP cache).`,
    run: (s) => ({ state: r1Route(s, "r1-forwards", ipFrame("r1-in", "SW-A", "R1", V4_MAC["HOST-A"], V4_MAC.R1L, ipv4Layer(V4_IP["HOST-A"], V4_IP["HOST-B"], INITIAL_TTL)), "tx"), events: [ev("PACKET_SENT", "r1-forwards", "R1 routes to ge-0/0/1")] }),
    packet: (s) => s.packet,
    whatChanged: (_p, n) => [`TTL ${INITIAL_TTL} → ${n.packet ? pktTtl(n.packet) : ""}`, `Checksum now ${n.packet ? f(n.packet, /^IPv4/, "Header Checksum") : ""}`, "Ethernet source and destination both replaced"],
  },
  {
    id: "swb-forwards",
    label: "SW-B delivers to HOST-B",
    narrative: "SW-B forwards the new frame by destination MAC out the port to HOST-B.",
    run: (s) => ({ state: switchForward(s, "swb-forwards", "SW-B", "p1", routed("r1-forwards-out", "HOST-A"), "HOST-B"), events: [ev("PACKET_SENT", "swb-forwards", "SW-B → HOST-B")] }),
    packet: (s) => s.packet,
    whatChanged: () => ["Frame unchanged by SW-B"],
  },
  {
    id: "b-receives",
    label: "HOST-B receives",
    narrative: `HOST-B sees its own MAC and its own IPv4 address. The packet still says source ${V4_IP["HOST-A"]} — only TTL shows it crossed a router.`,
    run: (s) => ({ state: hostReceive(s, "b-receives", "HOST-B", routed("b-receives-pkt", "HOST-A")), events: [ev("PACKET_RECEIVED", "b-receives", "HOST-B receives")] }),
    whatChanged: () => [`Delivered with TTL ${INITIAL_TTL - 1}`],
  },
  {
    id: "b-decides",
    label: "HOST-B replies: its own AND",
    narrative: `HOST-B runs the same test with ITS mask: ${V4_IP["HOST-B"]} → ${networkOf(V4_IP["HOST-B"], V4_PREFIX)}, ${V4_IP["HOST-A"]} → ${networkOf(V4_IP["HOST-A"], V4_PREFIX)}. Remote → gateway ${V4_IP.R1R}.`,
    run: (s) => ({ state: hostDecide(s, "b-decides", "HOST-B", V4_IP["HOST-A"], V4_PREFIX), events: [ev("ROUTE_LOOKUP", "b-decides", "HOST-B: destination remote")] }),
    whatChanged: (_p, n) => [`L2 next hop ${n.decision?.l2NextHop}`],
  },
  {
    id: "b-sends",
    label: "Reply to the gateway",
    narrative: `IPv4 ${V4_IP["HOST-B"]} → ${V4_IP["HOST-A"]}, TTL ${INITIAL_TTL}, framed to ${V4_MAC.R1R} (R1 ge-0/0/1).`,
    run: (s) => ({ state: hostSend(s, "b-sends", "HOST-B", bPacket("b-sends-pkt")), events: [ev("PACKET_SENT", "b-sends", "HOST-B replies")] }),
    packet: (s) => s.packet,
  },
  {
    id: "reply-to-r1",
    label: "SW-B to R1",
    narrative: "SW-B forwards the reply to R1 by destination MAC.",
    run: (s) => ({ state: switchForward(s, "reply-to-r1", "SW-B", "p2", bPacket("b-sends-pkt"), "R1"), events: [ev("PACKET_SENT", "reply-to-r1", "SW-B → R1")] }),
    packet: (s) => s.packet,
  },
  {
    id: "reply-routed",
    label: "R1 routes the reply",
    narrative: `${V4_IP["HOST-A"]} matches ${R1_ROUTES[0].prefix} on ge-0/0/0. TTL ${INITIAL_TTL} → ${INITIAL_TTL - 1}, checksum recomputed, new frame ${V4_MAC.R1L} → ${V4_MAC["HOST-A"]}.`,
    run: (s) => ({ state: r1Route(s, "reply-routed", ipFrame("r1-in-b", "SW-B", "R1", V4_MAC["HOST-B"], V4_MAC.R1R, ipv4Layer(V4_IP["HOST-B"], V4_IP["HOST-A"], INITIAL_TTL)), "tx"), events: [ev("PACKET_SENT", "reply-routed", "R1 routes to ge-0/0/0")] }),
    packet: (s) => s.packet,
    whatChanged: () => [`TTL ${INITIAL_TTL} → ${INITIAL_TTL - 1}`, "New Ethernet header toward HOST-A"],
  },
  {
    id: "reply-delivered",
    label: "Reply delivered",
    narrative: "SW-A forwards the frame to HOST-A, which accepts it. Round trip complete.",
    run: (s) => {
      const pkt = routed("reply-delivered-pkt", "HOST-B");
      const fwd = switchForward(s, "reply-delivered", "SW-A", "p2", pkt, "HOST-A");
      const done = hostReceive(fwd, "reply-delivered", "HOST-A", pkt);
      return { state: { ...done, packet: fwd.packet }, events: [ev("PACKET_RECEIVED", "reply-delivered", "HOST-A receives the reply")] };
    },
    packet: (s) => s.packet,
  },
  {
    id: "header-recap",
    label: "What changed, hop by hop",
    narrative: "Layer 2 (Ethernet) changed on every routed hop — it only ever describes ONE link. Layer 3 (IPv4 source/destination) stayed end-to-end; only TTL and, therefore, the header checksum changed at R1.",
    run: (s) => ({ state: idle(s), events: [] }),
  },
  {
    id: "cidr-note",
    label: "CIDR, not classes",
    narrative: "Old 'Class A/B/C' rules tied a network's size to its first octet. They have not been used for routing since CIDR (RFC 4632). The prefix length alone — /26 here — defines the network boundary.",
  },
  {
    id: "break-intro",
    label: "Incident: a ticket arrives",
    narrative: "After someone edited HOST-A's network settings, HOST-A can no longer reach HOST-B. HOST-B, R1 and both switches are unchanged.",
  },
  {
    id: "fault-injected",
    label: "HOST-A's new settings",
    narrative: `HOST-A's address is still ${V4_IP["HOST-A"]} and its gateway is still ${V4_IP.R1L}, but its prefix now reads /${V4_FAULT_PREFIX} (${maskOf(V4_FAULT_PREFIX)}).`,
    run: (s) => ({ state: { ...idle(s), hostAPrefix: V4_FAULT_PREFIX, faultActive: true, note: { device: "HOST-A", text: `HOST-A: ${V4_IP["HOST-A"]}/${V4_FAULT_PREFIX}` } }, events: [ev("STEP_ENTERED", "fault-injected", "HOST-A prefix changed")] }),
    whatChanged: () => [`HOST-A: ${V4_IP["HOST-A"]}/${V4_FAULT_PREFIX}`],
  },
  {
    id: "fault-decision",
    label: "HOST-A decides again",
    narrative: `HOST-A ANDs with ${maskOf(V4_FAULT_PREFIX)}: ${V4_IP["HOST-A"]} → ${networkOf(V4_IP["HOST-A"], V4_FAULT_PREFIX)}, ${V4_IP["HOST-B"]} → ${networkOf(V4_IP["HOST-B"], V4_FAULT_PREFIX)}. Same result — so HOST-A now believes ${V4_IP["HOST-B"]} is on its own LAN.`,
    run: (s) => ({ state: hostDecide(s, "fault-decision", "HOST-A", V4_IP["HOST-B"], s.hostAPrefix), events: [ev("ROUTE_LOOKUP", "fault-decision", "HOST-A: destination on-link")] }),
    whatChanged: (_p, n) => [`HOST-A decision: ${n.decision?.onLink ? "on-link" : "remote"}`, `L2 next hop: ${n.decision?.l2NextHop}`],
  },
  {
    id: "fault-arp",
    label: "HOST-A asks for HOST-B directly",
    narrative: `On-link destinations are resolved directly, so HOST-A broadcasts an ARP request: who has ${V4_IP["HOST-B"]}?`,
    run: (s) => {
      const pkt = arpRequestFrame("fault-arp-pkt", "HOST-A", "SW-A", V4_MAC["HOST-A"], V4_IP["HOST-A"], V4_IP["HOST-B"]);
      const hop: FundHop = {
        stepId: "fault-arp",
        device: "HOST-A",
        stages: withDetail(HOST_STAGES, { and: `/${s.hostAPrefix}: both → ${networkOf(V4_IP["HOST-A"], s.hostAPrefix)}`, compare: "same network → on-link", resolve: `no ARP entry for ${V4_IP["HOST-B"]} → ARP request`, tx: "broadcast" }),
        activeStageId: "resolve",
        egressInterfaceId: "eth0",
        lookupType: "ARP cache",
        lookupKey: V4_IP["HOST-B"],
        lookupResult: "miss — send ARP request",
        action: "ARP REQUEST",
        reason: "HOST-A treats the destination as a neighbour on its own LAN, so it must learn that neighbour's MAC before it can send.",
        input: `send to ${V4_IP["HOST-B"]} (on-link)`,
        output: `ARP who-has ${V4_IP["HOST-B"]} to FF:FF:FF:FF:FF:FF`,
        nextHopId: "SW-A",
        after: v4Stack(pkt),
      };
      return { state: push(s, hop, { packet: pkt, flood: [], note: { device: "HOST-A", text: `HOST-A: believes ${V4_IP["HOST-B"]} is on-link` } }), events: [ev("ARP_REQUEST_SENT", "fault-arp", "HOST-A ARPs for HOST-B")] };
    },
    packet: (s) => s.packet,
  },
  {
    id: "fault-flood",
    label: "SW-A floods the broadcast",
    narrative: "SW-A floods the broadcast out every other port — here, only toward R1 ge-0/0/0. HOST-B is on a different LAN behind R1, and routers do not forward Layer-2 broadcasts.",
    run: (s) => ({ state: switchForward(s, "fault-flood", "SW-A", "p1", arpRequestFrame("fault-arp-pkt", "HOST-A", "SW-A", V4_MAC["HOST-A"], V4_IP["HOST-A"], V4_IP["HOST-B"]), "R1"), events: [ev("PACKET_SENT", "fault-flood", "SW-A floods ARP")] }),
    packet: (s) => s.packet,
  },
  {
    id: "fault-r1-silent",
    label: "R1 stays silent",
    narrative: `R1 receives the ARP request on ge-0/0/0. The target ${V4_IP["HOST-B"]} is not one of R1's addresses, and R1 does not run Proxy ARP, so it sends no reply — and it never forwards the broadcast onto ge-0/0/1.`,
    run: (s) => {
      const hop: FundHop = {
        stepId: "fault-r1-silent",
        device: "R1",
        stages: [
          { id: "rx", label: "Receive ARP request (broadcast)", detail: "on ge-0/0/0" },
          { id: "target", label: "Is the target IP mine?", detail: `${V4_IP["HOST-B"]} ≠ ${V4_IP.R1L}` },
          { id: "proxy", label: "Proxy ARP enabled?", detail: "no" },
          { id: "drop", label: "No reply · broadcast not routed", detail: "request ends here" },
        ],
        activeStageId: "drop",
        ingressInterfaceId: "ge-0/0/0",
        lookupType: "ARP target check",
        lookupKey: V4_IP["HOST-B"],
        lookupResult: "not a local address · Proxy ARP off",
        action: "NO REPLY",
        reason: "A router answers ARP only for its own addresses (unless Proxy ARP is configured). Broadcasts stay inside their LAN.",
        input: `ARP who-has ${V4_IP["HOST-B"]}`,
        output: "nothing sent",
      };
      return { state: push(s, hop, { packet: undefined, flood: [], note: { device: "R1", text: "R1: not my address · no Proxy ARP · no reply" } }), events: [ev("PACKET_DROPPED", "fault-r1-silent", "R1 ignores ARP for HOST-B")] };
    },
  },
  {
    id: "fault-unresolved",
    label: "Resolution fails",
    narrative: "HOST-A retries its ARP request, hears nothing, and gives up: the UDP packet is never sent. The application sees 'host unreachable'. Nothing is wrong with R1, the switches or HOST-B.",
    run: (s) => {
      const hop: FundHop = {
        stepId: "fault-unresolved",
        device: "HOST-A",
        stages: withDetail(HOST_STAGES, { compare: "on-link (wrong)", resolve: `ARP for ${V4_IP["HOST-B"]}: no reply after retries`, tx: "packet discarded" }),
        activeStageId: "resolve",
        lookupType: "ARP cache",
        lookupKey: V4_IP["HOST-B"],
        lookupResult: "INCOMPLETE — no reply",
        action: "UNREACHABLE",
        reason: "The packet can only be framed once the next hop's MAC is known. With the wrong mask, the next hop is HOST-B itself, which is not on this LAN.",
        input: `send to ${V4_IP["HOST-B"]}`,
        output: "host unreachable",
      };
      return { state: push(s, hop, { hostAUnresolved: true, packet: undefined, note: { device: "HOST-A", text: "HOST-A: ARP incomplete — unreachable" } }), events: [ev("PACKET_DROPPED", "fault-unresolved", "HOST-A cannot resolve HOST-B")] };
    },
    whatChanged: () => [`HOST-A ARP entry for ${V4_IP["HOST-B"]}: INCOMPLETE`],
  },
  {
    id: "trouble-question",
    label: "Diagnose the incident",
    narrative: "R1's routes, both switches, and HOST-B are unchanged. HOST-A's ARP for HOST-B never completes.",
    question: {
      prompt: "What is the root cause?",
      options: [
        { id: "mask", label: "HOST-A's wrong /24 mask makes it treat HOST-B as on-link" },
        { id: "r1", label: "R1 has no route to 192.168.10.64/26" },
        { id: "dns", label: "DNS cannot resolve HOST-B's name" },
        { id: "switch", label: "SW-A dropped HOST-A's frames" },
      ],
      correctOptionId: "mask",
      explanation: "With /24, 192.168.10.70 ANDs to the same network as 192.168.10.10, so HOST-A skips its gateway and ARPs for HOST-B directly — which can never be answered across a router without Proxy ARP. R1's connected routes are fine, and no names are involved.",
    },
  },
  {
    id: "diagnostic-layers",
    label: "Troubleshooting layers",
    narrative: "Check each layer: links, switching, R1's routing, and HOST-A's own addressing.",
  },
  {
    id: "repair-challenge",
    label: "Repair HOST-A",
    narrative: "Choose the change that fixes the cause you identified.",
    action: (s, payload) => ({ state: applyIpv4Repair(s, (payload as { choice: string }).choice), events: [ev("STEP_ENTERED", "repair-challenge", `Repair attempt: ${(payload as { choice: string }).choice}`)] }),
    requiresState: (s) => s.repaired,
  },
  {
    id: "verify-decision",
    label: "Verify: the AND again",
    narrative: `With /${V4_PREFIX} restored, HOST-A computes ${networkOf(V4_IP["HOST-A"], V4_PREFIX)} vs ${networkOf(V4_IP["HOST-B"], V4_PREFIX)} — remote — and chooses its gateway ${V4_IP.R1L} as the Layer-2 next hop.`,
    run: (s) => ({ state: hostDecide(s, "verify-decision", "HOST-A", V4_IP["HOST-B"], s.hostAPrefix), events: [ev("ROUTE_LOOKUP", "verify-decision", "HOST-A: remote → gateway")] }),
    whatChanged: (_p, n) => [`L2 next hop ${n.decision?.l2NextHop}`],
  },
  {
    id: "verify-send",
    label: "Verify: framed to R1",
    narrative: `IPv4 destination ${V4_IP["HOST-B"]}, Ethernet destination ${V4_MAC.R1L}.`,
    run: (s) => ({ state: hostSend(s, "verify-send", "HOST-A", aPacket("verify-pkt")), events: [ev("PACKET_SENT", "verify-send", "HOST-A sends via gateway")] }),
    packet: (s) => s.packet,
  },
  {
    id: "verify-routed",
    label: "Verify: R1 routes it",
    narrative: `SW-A delivers the frame to R1, which routes it out ge-0/0/1 with TTL ${INITIAL_TTL - 1}.`,
    run: (s) => {
      const fwd = switchForward(s, "verify-routed", "SW-A", "p1", aPacket("verify-pkt"), "R1");
      return { state: r1Route(fwd, "verify-routed", ipFrame("verify-in", "SW-A", "R1", V4_MAC["HOST-A"], V4_MAC.R1L, ipv4Layer(V4_IP["HOST-A"], V4_IP["HOST-B"], INITIAL_TTL)), "tx"), events: [ev("PACKET_SENT", "verify-routed", "R1 routes")] };
    },
    packet: (s) => s.packet,
  },
  {
    id: "verify-delivered",
    label: "Verify: HOST-B reached",
    narrative: "SW-B delivers it; HOST-B accepts. Service restored by fixing one number — the prefix length.",
    run: (s) => {
      const pkt = routed("verify-out", "HOST-A");
      const fwd = switchForward(s, "verify-delivered", "SW-B", "p1", pkt, "HOST-B");
      const done = hostReceive(fwd, "verify-delivered", "HOST-B", pkt);
      return { state: { ...done, packet: fwd.packet }, events: [ev("PACKET_RECEIVED", "verify-delivered", "HOST-B receives")] };
    },
    packet: (s) => s.packet,
  },
  {
    id: "complete",
    label: "Lesson complete",
    narrative: "Address, prefix, mask, network, broadcast, host range, the AND test, gateway vs destination, TTL and checksum at the router — and a wrong-mask incident.",
  },
];
