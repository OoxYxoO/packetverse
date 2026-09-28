import type { PacketVisual, PVEvent, PVEventType, ScenarioStep } from "../types";
import type { ProcessingStage } from "@/components/network3d/types";
import type { FundHop } from "@/components/lesson/fundamentalsTrace";
import { fieldOf, icmpLength, icmpPacket, ipToNum, packetStack, type IcmpEcho, type IcmpMessage, type Ipv4Fields } from "./fundamentalsPackets";

/**
 * ICMP & Network Diagnostics — HOST-A — R1 — R2 — HOST-B with static/connected routing only.
 *
 * Modeled exactly (RFC 792, RFC 1191, RFC 1812):
 * - ICMP rides directly in IPv4 (Protocol 1). No TCP/UDP header, no ports.
 * - Echo Request 8/0 and Echo Reply 0/0 carry Identifier + Sequence + data; the reply copies them.
 * - Each forwarding router decrements TTL by one; a destination host does not decrement on receipt.
 * - A router that would forward with TTL ≤ 1 discards the datagram and returns Time Exceeded 11/0 to the source,
 *   quoting the original IPv4 header + first 8 bytes.
 * - Traceroute here is explicitly ICMP-Echo-based (TTL 1, 2, 3 …).
 * - A 1500-byte DF datagram cannot be forwarded onto a 1400-byte IP-MTU link: the router drops it and returns
 *   Destination Unreachable 3/4 with Next-Hop MTU 1400 (RFC 1191). Fix: keep DF, send 20 + 8 + 1372 = 1400.
 * Router-generated ICMP uses an initial TTL of 64 in this model (implementations vary).
 */

export type IcDevice = "HOST-A" | "R1" | "R2" | "HOST-B";
export const IC_DEVICES: IcDevice[] = ["HOST-A", "R1", "R2", "HOST-B"];
export const IC_ADDR = { "HOST-A": "192.0.2.10", "R1:LAN": "192.0.2.1", "R1:TRANSIT": "203.0.113.1", "R2:TRANSIT": "203.0.113.2", "R2:LAN": "198.51.100.1", "HOST-B": "198.51.100.20" } as const;
export const IC_MAC = { "HOST-A": "00:00:5E:00:53:2A", "R1:LAN": "00:00:5E:00:53:21", "R1:TRANSIT": "00:00:5E:00:53:22", "R2:TRANSIT": "00:00:5E:00:53:23", "R2:LAN": "00:00:5E:00:53:24", "HOST-B": "00:00:5E:00:53:2B" } as const;
export const ECHO_IDENTIFIER = 0x04d2; // 1234
export const PING_DATA = 56;
export const BIG_DATA = 1472;
export const FIXED_DATA = 1372;
export const FAULT_MTU = 1400;
export const INITIAL_TTL = 64;
export const ROUTER_ICMP_TTL = 64;

/** Static + connected routes. Interfaces: R1 ge-0/0/0 LAN, ge-0/0/1 transit; R2 ge-0/0/1 transit, ge-0/0/0 LAN. */
export const ROUTES: Record<"R1" | "R2", { prefix: string; len: number; iface: string; via: string; nextHop?: string }[]> = {
  R1: [
    { prefix: "192.0.2.0", len: 24, iface: "ge-0/0/0", via: "connected" },
    { prefix: "203.0.113.0", len: 30, iface: "ge-0/0/1", via: "connected" },
    { prefix: "198.51.100.0", len: 24, iface: "ge-0/0/1", via: "static", nextHop: IC_ADDR["R2:TRANSIT"] },
  ],
  R2: [
    { prefix: "198.51.100.0", len: 24, iface: "ge-0/0/0", via: "connected" },
    { prefix: "203.0.113.0", len: 30, iface: "ge-0/0/1", via: "connected" },
    { prefix: "192.0.2.0", len: 24, iface: "ge-0/0/1", via: "static", nextHop: IC_ADDR["R1:TRANSIT"] },
  ],
};
const inPrefix = (ip: string, prefix: string, len: number) => Math.floor(ipToNum(ip) / 2 ** (32 - len)) === Math.floor(ipToNum(prefix) / 2 ** (32 - len));
export const lookupRoute = (r: "R1" | "R2", dst: string) => ROUTES[r].filter((x) => inPrefix(dst, x.prefix, x.len)).sort((a, b) => b.len - a.len)[0];
/** Where each router interface leads, with its source MAC and address. */
const IFACE: Record<"R1" | "R2", Record<string, { addr: string; mac: string; peer: IcDevice; peerMac: string }>> = {
  R1: { "ge-0/0/0": { addr: IC_ADDR["R1:LAN"], mac: IC_MAC["R1:LAN"], peer: "HOST-A", peerMac: IC_MAC["HOST-A"] }, "ge-0/0/1": { addr: IC_ADDR["R1:TRANSIT"], mac: IC_MAC["R1:TRANSIT"], peer: "R2", peerMac: IC_MAC["R2:TRANSIT"] } },
  R2: { "ge-0/0/0": { addr: IC_ADDR["R2:LAN"], mac: IC_MAC["R2:LAN"], peer: "HOST-B", peerMac: IC_MAC["HOST-B"] }, "ge-0/0/1": { addr: IC_ADDR["R2:TRANSIT"], mac: IC_MAC["R2:TRANSIT"], peer: "R1", peerMac: IC_MAC["R1:TRANSIT"] } },
};
export const ifaceInfo = (r: "R1" | "R2", iface: string) => IFACE[r][iface];

export interface TraceHopResult {
  ttl: number;
  from: string;
  device: IcDevice;
  message: string;
}
export interface IcmpState {
  hops: FundHop[];
  /** IP MTU of the R1 ↔ R2 link (both directions). LAN links are 1500. */
  transitMtu: number;
  probe: { dataLength: number; df: boolean };
  traceResults: TraceHopResult[];
  packet?: PacketVisual;
  flood: { id: string; fromId: string; toId: string; packet: PacketVisual }[];
  note?: { device: IcDevice; text: string };
  faultActive: boolean;
  repairAttempt?: { choice: string; correct: boolean };
  repaired: boolean;
}
export const createIcmpState = (): IcmpState => ({ hops: [], transitMtu: 1500, probe: { dataLength: PING_DATA, df: false }, traceResults: [], flood: [], faultActive: false, repaired: false });
export const mtuOf = (s: IcmpState, r: "R1" | "R2", iface: string) => (iface === "ge-0/0/1" ? s.transitMtu : 1500);

// ---------------------------------------------------------------------------------------------------------------
// Stages
// ---------------------------------------------------------------------------------------------------------------
export const ROUTER_STAGES: ProcessingStage[] = [
  { id: "rx", label: "Receive · validate IPv4 header" },
  { id: "lookup", label: "Route lookup (connected / static)" },
  { id: "ttl", label: "TTL check: must stay ≥ 1 after −1" },
  { id: "mtu", label: "Egress IP MTU check (DF?)" },
  { id: "tx", label: "Forward — or generate ICMP error to the source" },
];
export const HOST_TX_STAGES: ProcessingStage[] = [
  { id: "build", label: "Build ICMP Echo (id · seq · data)" },
  { id: "ip", label: "IPv4 header: TTL · DF · Protocol 1" },
  { id: "tx", label: "Send to default gateway" },
];
export const HOST_RX_STAGES: ProcessingStage[] = [
  { id: "rx", label: "Receive · IPv4 destination is mine" },
  { id: "icmp", label: "Read ICMP Type/Code" },
  { id: "act", label: "Reply / match / report" },
];
const withDetail = (base: ProcessingStage[], d: Partial<Record<string, string>>): ProcessingStage[] => base.map((x) => (d[x.id] ? { ...x, detail: d[x.id] } : x));
const ev = (type: PVEventType, stepId: string, message: string): PVEvent => ({ type, stepId, timestamp: Date.now(), message });
const push = (s: IcmpState, hop: FundHop, patch: Partial<IcmpState> = {}): IcmpState => ({ ...s, ...patch, hops: [...s.hops, hop] });
const idle = (s: IcmpState): IcmpState => ({ ...s, packet: undefined, flood: [], note: undefined });

// ---------------------------------------------------------------------------------------------------------------
// Reading a packet back into its fields
// ---------------------------------------------------------------------------------------------------------------
export function ipFieldsOf(p: PacketVisual): Ipv4Fields {
  return {
    src: fieldOf(p, /^IPv4/, "Source"),
    dst: fieldOf(p, /^IPv4/, "Destination"),
    ttl: Number(fieldOf(p, /^IPv4/, "TTL")),
    protocol: 1,
    payloadLength: Number(fieldOf(p, /^IPv4/, "Total Length")) - 20,
    id: parseInt(fieldOf(p, /^IPv4/, "Identification"), 16),
    df: fieldOf(p, /^IPv4/, "Flags").startsWith("DF"),
  };
}
/** The ICMP message a packet carries (echo kinds only are re-forwarded as echo; errors are re-forwarded verbatim). */
const MSG = new Map<string, IcmpMessage>();
function build(id: string, from: IcDevice, to: IcDevice, ethSrc: string, ethDst: string, ip: Omit<Ipv4Fields, "protocol" | "payloadLength">, icmp: IcmpMessage) {
  const p = icmpPacket({ id, from, to, ethSrc, ethDst, ip, icmp });
  MSG.set(p.id, icmp);
  return p;
}
const msgOf = (p: PacketVisual) => MSG.get(p.id)!;

// ---------------------------------------------------------------------------------------------------------------
// Device actions
// ---------------------------------------------------------------------------------------------------------------
function hostSendEcho(s: IcmpState, stepId: string, host: "HOST-A" | "HOST-B", o: { kind: "echo-request" | "echo-reply"; seq: number; ttl: number; dataLength: number; df: boolean }): IcmpState {
  const icmp: IcmpEcho = { kind: o.kind, identifier: ECHO_IDENTIFIER, sequence: o.seq, dataLength: o.dataLength };
  const a = host === "HOST-A";
  const ip = { src: a ? IC_ADDR["HOST-A"] : IC_ADDR["HOST-B"], dst: a ? IC_ADDR["HOST-B"] : IC_ADDR["HOST-A"], ttl: o.ttl, id: (a ? 0x3100 : 0x5200) + o.seq, df: o.df };
  const gw = a ? "R1" : "R2";
  const pkt = build(`${stepId}-${host}`, host, gw, a ? IC_MAC["HOST-A"] : IC_MAC["HOST-B"], a ? IC_MAC["R1:LAN"] : IC_MAC["R2:LAN"], ip, icmp);
  const total = 20 + icmpLength(icmp);
  const hop: FundHop = {
    stepId,
    device: host,
    stages: withDetail(HOST_TX_STAGES, { build: `${o.kind === "echo-request" ? "Echo Request 8/0" : "Echo Reply 0/0"} · id ${ECHO_IDENTIFIER} · seq ${o.seq} · ${o.dataLength} B data`, ip: `TTL ${o.ttl} · ${o.df ? "DF set" : "DF clear"} · total ${total} B`, tx: `to gateway ${a ? IC_ADDR["R1:LAN"] : IC_ADDR["R2:LAN"]}` }),
    activeStageId: "tx",
    egressInterfaceId: "eth0",
    lookupType: "Default route",
    lookupKey: ip.dst,
    lookupResult: `off-link → ${gw}`,
    action: o.kind === "echo-request" ? "ECHO REQUEST" : "ECHO REPLY",
    reason: o.kind === "echo-request" ? `${host} builds an ICMP Echo Request (id ${ECHO_IDENTIFIER}, seq ${o.seq}) directly inside IPv4 (Protocol 1) with TTL ${o.ttl}${o.df ? " and DF set" : ""}. Total length ${total} bytes.` : `${host} answers with an Echo Reply that copies the identifier, sequence and data. It is a brand-new packet with its own TTL (${o.ttl}), routed independently toward ${ip.dst}.`,
    input: o.kind === "echo-reply" ? `Echo Request seq ${o.seq}` : "(originated here)",
    output: `${ip.src} → ${ip.dst} · TTL ${o.ttl} · ${total} B`,
    nextHopId: gw,
    after: packetStack(pkt),
  };
  return push(s, hop, { packet: pkt, flood: [], note: { device: host, text: `${host}: ${o.kind === "echo-request" ? "Echo Request" : "Echo Reply"} seq ${o.seq}` } });
}

function routerForward(s: IcmpState, stepId: string, r: "R1" | "R2", inPkt: PacketVisual): IcmpState {
  const ip = ipFieldsOf(inPkt);
  const inIface = inPkt.from === (r === "R1" ? "HOST-A" : "HOST-B") ? "ge-0/0/0" : "ge-0/0/1";
  const route = lookupRoute(r, ip.dst);
  const out = ifaceInfo(r, route.iface);
  const total = ip.payloadLength + 20;
  const mtu = mtuOf(s, r, route.iface);
  const original = msgOf(inPkt);
  const routeText = `${route.prefix}/${route.len} ${route.via}${route.nextHop ? ` via ${route.nextHop}` : ""} → ${route.iface}`;
  const base = { rx: `on ${inIface} · TTL ${ip.ttl} · ${total} B`, lookup: routeText };

  // TTL expiry — discard, report Time Exceeded to the source from the interface facing it.
  if (ip.ttl <= 1) {
    const back = lookupRoute(r, ip.src);
    const bi = ifaceInfo(r, back.iface);
    const err = build(`${stepId}-${r}-te`, r, bi.peer, bi.mac, bi.peerMac, { src: bi.addr, dst: ip.src, ttl: ROUTER_ICMP_TTL, id: 0x7700 + ip.ttl, df: false }, { kind: "time-exceeded", quoted: ip, quotedEcho: original as IcmpEcho });
    const hop: FundHop = {
      stepId,
      device: r,
      stages: withDetail(ROUTER_STAGES, { ...base, ttl: `TTL ${ip.ttl} − 1 = 0 → discard`, tx: `Time Exceeded 11/0 → ${ip.src} from ${bi.addr}` }),
      activeStageId: "ttl",
      ingressInterfaceId: inIface,
      egressInterfaceId: back.iface,
      lookupType: "Routing table",
      lookupKey: ip.dst,
      lookupResult: routeText,
      action: "TTL EXPIRED · ICMP 11/0",
      reason: `The datagram arrived with TTL ${ip.ttl}. Forwarding would leave TTL 0, so ${r} discards it and sends ICMP Time Exceeded (Type 11, Code 0) back to ${ip.src}, quoting the original IPv4 header and first 8 bytes. The source address ${bi.addr} is what reveals this hop.`,
      input: `${ip.src} → ${ip.dst} · TTL ${ip.ttl}`,
      output: `ICMP 11/0 ${bi.addr} → ${ip.src}`,
      nextHopId: bi.peer,
      before: packetStack(inPkt),
      after: packetStack(err, ["ip"]),
    };
    return push(s, hop, { packet: err, flood: [], note: { device: r, text: `${r}: TTL expired → ICMP Time Exceeded` } });
  }
  // DF + too big — drop, report Fragmentation Needed with the next-hop MTU.
  if (total > mtu && ip.df) {
    const back = lookupRoute(r, ip.src);
    const bi = ifaceInfo(r, back.iface);
    const err = build(`${stepId}-${r}-fn`, r, bi.peer, bi.mac, bi.peerMac, { src: bi.addr, dst: ip.src, ttl: ROUTER_ICMP_TTL, id: 0x7800 + (total % 256), df: false }, { kind: "frag-needed", quoted: ip, quotedEcho: original as IcmpEcho, nextHopMtu: mtu });
    const hop: FundHop = {
      stepId,
      device: r,
      stages: withDetail(ROUTER_STAGES, { ...base, ttl: `TTL ${ip.ttl} → ${ip.ttl - 1} OK`, mtu: `${total} B > ${route.iface} IP MTU ${mtu} · DF set → cannot fragment`, tx: `Dest. Unreachable 3/4 (MTU ${mtu}) → ${ip.src}` }),
      activeStageId: "mtu",
      ingressInterfaceId: inIface,
      egressInterfaceId: back.iface,
      lookupType: "Routing table + egress MTU",
      lookupKey: ip.dst,
      lookupResult: `${routeText} · IP MTU ${mtu}`,
      action: "DF DROP · ICMP 3/4",
      reason: `The ${total}-byte datagram must leave on ${route.iface}, whose IP MTU is ${mtu}. It would have to be fragmented, but DF is set, so ${r} drops it and sends ICMP Destination Unreachable, Code 4 (Fragmentation Needed and DF set), carrying Next-Hop MTU ${mtu} (RFC 1191).`,
      input: `${ip.src} → ${ip.dst} · ${total} B · DF`,
      output: `ICMP 3/4 MTU ${mtu} → ${ip.src}`,
      nextHopId: bi.peer,
      before: packetStack(inPkt),
      after: packetStack(err, ["ip"]),
    };
    return push(s, hop, { packet: err, flood: [], note: { device: r, text: `${r}: ${total} B > MTU ${mtu}, DF → ICMP 3/4` } });
  }
  const fwd = build(`${stepId}-${r}`, r, out.peer, out.mac, out.peerMac, { src: ip.src, dst: ip.dst, ttl: ip.ttl - 1, id: ip.id, df: ip.df }, original);
  const hop: FundHop = {
    stepId,
    device: r,
    stages: withDetail(ROUTER_STAGES, { ...base, ttl: `TTL ${ip.ttl} → ${ip.ttl - 1}`, mtu: `${total} B ≤ ${mtu}`, tx: `out ${route.iface} → ${out.peer}` }),
    activeStageId: "tx",
    ingressInterfaceId: inIface,
    egressInterfaceId: route.iface,
    lookupType: "Routing table",
    lookupKey: ip.dst,
    lookupResult: routeText,
    action: "FORWARD",
    reason: `${r} matches ${routeText}, decrements TTL to ${ip.ttl - 1}, recomputes the header checksum and sends a new Ethernet frame. The ICMP message itself is untouched.`,
    input: `${ip.src} → ${ip.dst} · TTL ${ip.ttl}`,
    output: `${ip.src} → ${ip.dst} · TTL ${ip.ttl - 1} out ${route.iface}`,
    nextHopId: out.peer,
    before: packetStack(inPkt),
    after: packetStack(fwd, ["eth", "ip"]),
    mutations: [{ type: "TTL_CHANGE", detail: `${ip.ttl} → ${ip.ttl - 1}` }, { type: "SA_CHANGE", detail: `→ ${r} ${route.iface}` }, { type: "DA_CHANGE", detail: `→ ${out.peer}` }],
  };
  return push(s, hop, { packet: fwd, flood: [], note: { device: r, text: `${r}: forward · TTL ${ip.ttl}→${ip.ttl - 1}` } });
}

function hostReceive(s: IcmpState, stepId: string, host: "HOST-A" | "HOST-B", inPkt: PacketVisual, act: string, reason: string, keepPacket = false): IcmpState {
  const ip = ipFieldsOf(inPkt);
  const m = msgOf(inPkt);
  const tc = fieldOf(inPkt, /^ICMP/, "Type");
  const hop: FundHop = {
    stepId,
    device: host,
    stages: withDetail(HOST_RX_STAGES, { rx: `from ${ip.src} · TTL ${ip.ttl} (not decremented)`, icmp: `Type ${tc}`, act }),
    activeStageId: "act",
    ingressInterfaceId: "eth0",
    lookupType: "Local delivery",
    lookupKey: ip.dst,
    lookupResult: "my address",
    action: act.toUpperCase(),
    reason,
    input: `${ip.src} → ${ip.dst} · TTL ${ip.ttl} · ${"sequence" in m ? `seq ${m.sequence}` : "error"}`,
    output: act,
    before: packetStack(inPkt),
  };
  return push(s, hop, { packet: keepPacket ? s.packet : undefined, flood: [], note: { device: host, text: `${host}: ${act}` } });
}

// ---------------------------------------------------------------------------------------------------------------
// Repair
// ---------------------------------------------------------------------------------------------------------------
export const IC_REPAIR_OPTIONS = [
  { id: "data-1372", label: "Keep DF set and reduce the ICMP data to 1372 bytes" },
  { id: "data-1400", label: "Keep DF set and reduce the ICMP data to 1400 bytes" },
  { id: "ttl", label: "Raise the probe's TTL to 128" },
  { id: "seq", label: "Change the Echo sequence number" },
  { id: "dns", label: "Point HOST-A at a different DNS server" },
] as const;
export const IC_REPAIR_CORRECT = "data-1372";
export function applyIcRepair(s: IcmpState, choice: string): IcmpState {
  const correct = choice === IC_REPAIR_CORRECT;
  if (!correct) return { ...s, repairAttempt: { choice, correct } };
  return { ...s, repairAttempt: { choice, correct }, repaired: true, probe: { dataLength: FIXED_DATA, df: true }, note: { device: "HOST-A", text: `probe data ${FIXED_DATA} B, DF kept` } };
}

// ---------------------------------------------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------------------------------------------
const pkt = (s: IcmpState) => s.packet!;
const traceAdd = (s: IcmpState, r: TraceHopResult): IcmpState => ({ ...s, traceResults: [...s.traceResults, r] });

export const icmpDiagnosticsSteps: ScenarioStep<IcmpState>[] = [
  {
    id: "intro",
    label: "Two routers, one question",
    narrative: `HOST-A (${IC_ADDR["HOST-A"]}) and HOST-B (${IC_ADDR["HOST-B"]}) sit on different networks joined by R1 and R2 (static routes, no routing protocol). You'll use ICMP to test reachability, map the path, and diagnose a problem that only hits large packets.`,
  },
  {
    id: "icmp-in-ip",
    label: "ICMP lives inside IPv4",
    narrative: "ICMP is IP's own control and error messenger. An ICMP message sits directly after the IPv4 header, which says Protocol = 1. There is no TCP or UDP header, and therefore no port numbers.",
  },
  {
    id: "predict-ports",
    label: "Predict: ports?",
    narrative: "People sometimes say ping 'uses port 7'.",
    question: {
      prompt: "Does an ICMP Echo (ping) use UDP port 7?",
      options: [
        { id: "no", label: "No — ICMP is carried directly in IPv4 (Protocol 1) and has no ports" },
        { id: "udp7", label: "Yes — ping is UDP port 7" },
        { id: "tcp7", label: "It uses TCP port 7" },
        { id: "random", label: "It picks a random high port" },
      ],
      correctOptionId: "no",
      explanation: "Port 7 is the separate TCP/UDP 'echo' service. ICMP Echo has no transport header at all. What keeps pings apart is the ICMP Identifier and Sequence Number.",
    },
  },
  {
    id: "echo-anatomy",
    label: "Echo Request anatomy",
    narrative: `Echo Request is Type 8, Code 0; Echo Reply is Type 0, Code 0. Both carry a checksum, an Identifier (here ${ECHO_IDENTIFIER}), a Sequence Number and data (here ${PING_DATA} bytes). 20 (IPv4) + 8 (ICMP) + ${PING_DATA} = ${20 + 8 + PING_DATA} bytes.`,
  },
  {
    id: "ping-send",
    label: "HOST-A pings HOST-B",
    narrative: `HOST-A sends Echo Request seq 1 with TTL ${INITIAL_TTL} toward ${IC_ADDR["HOST-B"]} via its gateway R1.`,
    run: (s) => ({ state: hostSendEcho(idle(s), "ping-send", "HOST-A", { kind: "echo-request", seq: 1, ttl: INITIAL_TTL, dataLength: PING_DATA, df: false }), events: [ev("PACKET_SENT", "ping-send", "Echo Request seq 1")] }),
    packet: pkt,
  },
  {
    id: "r1-forward",
    label: "R1 forwards: TTL 63",
    narrative: `R1 matches its static route 198.51.100.0/24 via ${IC_ADDR["R2:TRANSIT"]}, decrements TTL to 63 and forwards onto the transit link.`,
    run: (s) => ({ state: routerForward(s, "r1-forward", "R1", pkt(s)), events: [ev("PACKET_SENT", "r1-forward", "R1 forwards")] }),
    packet: pkt,
  },
  {
    id: "predict-ttl",
    label: "Predict: arrival TTL",
    narrative: "The Echo Request is now on the transit link with TTL 63.",
    packet: pkt,
    question: {
      prompt: "What TTL will HOST-B see in this Echo Request?",
      options: [
        { id: "62", label: "62 — R2 decrements once more; HOST-B doesn't decrement on receipt" },
        { id: "61", label: "61 — HOST-B also decrements it" },
        { id: "64", label: "64 — TTL is restored at the destination" },
        { id: "63", label: "63 — only the first router decrements" },
      ],
      correctOptionId: "62",
      explanation: "Each forwarding router subtracts one: R1 (64→63), R2 (63→62). A destination host just receives the datagram; it doesn't forward it, so it doesn't decrement.",
    },
  },
  {
    id: "r2-forward",
    label: "R2 delivers: TTL 62",
    narrative: "R2's connected 198.51.100.0/24 matches. TTL 63 → 62, new Ethernet frame to HOST-B.",
    run: (s) => ({ state: routerForward(s, "r2-forward", "R2", pkt(s)), events: [ev("PACKET_SENT", "r2-forward", "R2 forwards")] }),
    packet: pkt,
  },
  {
    id: "b-receives",
    label: "HOST-B receives",
    narrative: "HOST-B sees an Echo Request for itself with TTL 62 and prepares a reply.",
    run: (s) => ({ state: hostReceive(s, "b-receives", "HOST-B", pkt(s), "reply with Echo Reply", "The Echo Request is addressed to HOST-B. It will reply with the same identifier, sequence and data."), events: [ev("PACKET_RECEIVED", "b-receives", "HOST-B receives")] }),
  },
  {
    id: "b-reply",
    label: "HOST-B sends Echo Reply",
    narrative: `Echo Reply (0/0), id ${ECHO_IDENTIFIER}, seq 1, same ${PING_DATA} bytes of data — a new packet with TTL 64, routed on its own via HOST-B's gateway R2. Nothing forces it to retrace the request's path.`,
    run: (s) => ({ state: hostSendEcho(s, "b-reply", "HOST-B", { kind: "echo-reply", seq: 1, ttl: INITIAL_TTL, dataLength: PING_DATA, df: false }), events: [ev("PACKET_SENT", "b-reply", "Echo Reply seq 1")] }),
    packet: pkt,
  },
  {
    id: "reply-r2",
    label: "R2 routes the reply",
    narrative: `R2's static route 192.0.2.0/24 via ${IC_ADDR["R1:TRANSIT"]}: TTL 64 → 63.`,
    run: (s) => ({ state: routerForward(s, "reply-r2", "R2", pkt(s)), events: [ev("PACKET_SENT", "reply-r2", "R2 forwards reply")] }),
    packet: pkt,
  },
  {
    id: "reply-r1",
    label: "R1 delivers the reply",
    narrative: "R1's connected 192.0.2.0/24: TTL 63 → 62, delivered to HOST-A.",
    run: (s) => ({ state: routerForward(s, "reply-r1", "R1", pkt(s)), events: [ev("PACKET_SENT", "reply-r1", "R1 delivers reply")] }),
    packet: pkt,
  },
  {
    id: "predict-match",
    label: "Predict: matching the reply",
    narrative: "HOST-A may have several pings in flight.",
    packet: pkt,
    question: {
      prompt: "How does HOST-A know this reply answers its request?",
      options: [
        { id: "idseq", label: "The Identifier and Sequence Number match the request's" },
        { id: "port", label: "The reply arrives on the same source port" },
        { id: "ttl", label: "The TTL matches the request's TTL" },
        { id: "mac", label: "It comes from R1's MAC address" },
      ],
      correctOptionId: "idseq",
      explanation: "The Echo Reply copies the Identifier and Sequence Number. There are no ports, TTLs differ by design, and every packet from another network arrives from R1's MAC.",
    },
  },
  {
    id: "a-matches",
    label: "Ping succeeds",
    narrative: `HOST-A matches id ${ECHO_IDENTIFIER} / seq 1: "reply from ${IC_ADDR["HOST-B"]}: ttl=62". Round trip complete.`,
    run: (s) => ({ state: hostReceive(s, "a-matches", "HOST-A", pkt(s), "matched id + seq · reachable", `Identifier ${ECHO_IDENTIFIER} and sequence 1 match the outstanding request, so ping reports success and the round-trip time.`), events: [ev("PACKET_RECEIVED", "a-matches", "ping ok")] }),
  },
  {
    id: "trace-intro",
    label: "ICMP-based traceroute",
    narrative: "Now map the path. This lesson models ICMP-Echo-based traceroute (the style of Windows tracert): Echo Requests sent with TTL 1, then 2, then 3… Each router that sees TTL run out reports itself with Time Exceeded. (Other tools use UDP or TCP probes — see the Deep Dive.)",
    run: (s) => ({ state: { ...idle(s), traceResults: [] }, events: [] }),
  },
  {
    id: "predict-hop1",
    label: "Predict: the TTL=1 probe",
    narrative: "The first probe leaves HOST-A with TTL 1.",
    question: {
      prompt: "Which device generates the reply to the TTL=1 probe?",
      options: [
        { id: "r1", label: "R1 — it can't forward with TTL 0, so it sends Time Exceeded" },
        { id: "b", label: "HOST-B — the probe's destination" },
        { id: "r2", label: "R2 — the last router" },
        { id: "none", label: "Nobody — TTL 1 probes are silently dropped" },
      ],
      correctOptionId: "r1",
      explanation: "R1 would have to forward the probe with TTL 0, so it discards it and returns ICMP Time Exceeded (11/0) from its own address — exposing hop 1.",
    },
  },
  {
    id: "probe1-send",
    label: "Probe 1: TTL 1",
    narrative: `Echo Request seq 2, TTL 1, toward ${IC_ADDR["HOST-B"]}.`,
    run: (s) => ({ state: hostSendEcho(s, "probe1-send", "HOST-A", { kind: "echo-request", seq: 2, ttl: 1, dataLength: PING_DATA, df: false }), events: [ev("PACKET_SENT", "probe1-send", "probe TTL 1")] }),
    packet: pkt,
  },
  {
    id: "probe1-expire",
    label: "R1: Time Exceeded",
    narrative: `R1 discards the probe and returns Time Exceeded (11/0) from ${IC_ADDR["R1:LAN"]}. Hop 1 = ${IC_ADDR["R1:LAN"]}.`,
    run: (s) => {
      const st = routerForward(s, "probe1-expire", "R1", pkt(s));
      return { state: traceAdd(st, { ttl: 1, from: IC_ADDR["R1:LAN"], device: "R1", message: "Time Exceeded 11/0" }), events: [ev("PACKET_DROPPED", "probe1-expire", "TTL expired at R1")] };
    },
    packet: pkt,
  },
  {
    id: "probe2-send",
    label: "Probe 2: TTL 2",
    narrative: "Echo Request seq 3, TTL 2.",
    run: (s) => ({ state: hostSendEcho(idle(s), "probe2-send", "HOST-A", { kind: "echo-request", seq: 3, ttl: 2, dataLength: PING_DATA, df: false }), events: [ev("PACKET_SENT", "probe2-send", "probe TTL 2")] }),
    packet: pkt,
  },
  {
    id: "probe2-r1",
    label: "R1 forwards with TTL 1",
    narrative: "TTL 2 − 1 = 1 is still valid, so R1 forwards the probe to R2.",
    run: (s) => ({ state: routerForward(s, "probe2-r1", "R1", pkt(s)), events: [ev("PACKET_SENT", "probe2-r1", "R1 forwards TTL 1")] }),
    packet: pkt,
  },
  {
    id: "probe2-expire",
    label: "R2: Time Exceeded",
    narrative: `R2 receives TTL 1, can't forward it, and returns Time Exceeded from ${IC_ADDR["R2:TRANSIT"]} — the interface facing HOST-A's route.`,
    run: (s) => {
      const st = routerForward(s, "probe2-expire", "R2", pkt(s));
      return { state: traceAdd(st, { ttl: 2, from: IC_ADDR["R2:TRANSIT"], device: "R2", message: "Time Exceeded 11/0" }), events: [ev("PACKET_DROPPED", "probe2-expire", "TTL expired at R2")] };
    },
    packet: pkt,
  },
  {
    id: "probe2-return",
    label: "The error travels home",
    narrative: "The Time Exceeded message is an ordinary IPv4 packet: R1 forwards it to HOST-A (TTL 64 → 63). Hop 2 recorded.",
    run: (s) => ({ state: routerForward(s, "probe2-return", "R1", pkt(s)), events: [ev("PACKET_SENT", "probe2-return", "R1 forwards ICMP error")] }),
    packet: pkt,
  },
  {
    id: "probe3-send",
    label: "Probe 3: TTL 3",
    narrative: "Echo Request seq 4, TTL 3.",
    run: (s) => ({ state: hostSendEcho(idle(s), "probe3-send", "HOST-A", { kind: "echo-request", seq: 4, ttl: 3, dataLength: PING_DATA, df: false }), events: [ev("PACKET_SENT", "probe3-send", "probe TTL 3")] }),
    packet: pkt,
  },
  {
    id: "probe3-arrives",
    label: "Probe 3 reaches HOST-B",
    narrative: "R1 (3 → 2) and R2 (2 → 1) both forward it. It arrives at HOST-B with TTL 1 — a destination doesn't need TTL left to accept a packet.",
    run: (s) => {
      const a = routerForward(s, "probe3-arrives", "R1", pkt(s));
      return { state: routerForward(a, "probe3-arrives", "R2", pkt(a)), events: [ev("PACKET_SENT", "probe3-arrives", "probe reaches HOST-B")] };
    },
    packet: pkt,
  },
  {
    id: "probe3-reply",
    label: "HOST-B answers",
    narrative: `HOST-B replies with an Echo Reply (0/0), seq 4. A reply instead of Time Exceeded means the destination was reached: hop 3 = ${IC_ADDR["HOST-B"]}.`,
    run: (s) => {
      const st = hostSendEcho(s, "probe3-reply", "HOST-B", { kind: "echo-reply", seq: 4, ttl: INITIAL_TTL, dataLength: PING_DATA, df: false });
      return { state: traceAdd(st, { ttl: 3, from: IC_ADDR["HOST-B"], device: "HOST-B", message: "Echo Reply 0/0" }), events: [ev("PACKET_SENT", "probe3-reply", "Echo Reply seq 4")] };
    },
    packet: pkt,
  },
  {
    id: "trace-result",
    label: "The path, hop by hop",
    narrative: `1 ${IC_ADDR["R1:LAN"]} (R1) · 2 ${IC_ADDR["R2:TRANSIT"]} (R2) · 3 ${IC_ADDR["HOST-B"]} (HOST-B). Each hop was revealed by the device that ran out of TTL, or by the destination itself.`,
    run: (s) => ({ state: idle(s), events: [] }),
  },
  {
    id: "mtu-intro",
    label: "MTU and DF",
    narrative: "Every link has an IP MTU: the largest IPv4 packet (header + payload) it can carry. A router may fragment a bigger packet — unless the sender set DF (Don't Fragment). Path MTU Discovery deliberately sets DF and listens for ICMP errors.",
    question: {
      prompt: "An Ethernet link has an IP MTU of 1500. What does 1500 measure?",
      options: [
        { id: "ip", label: "The IPv4 packet: IPv4 header + everything after it" },
        { id: "frame", label: "The whole Ethernet frame including MAC header and FCS" },
        { id: "payload", label: "Only the ICMP/TCP/UDP payload" },
        { id: "bits", label: "The link speed in bits" },
      ],
      correctOptionId: "ip",
      explanation: "IP MTU counts the IPv4 datagram. The 14-byte Ethernet header and 4-byte FCS are extra, outside the IP MTU.",
    },
  },
  {
    id: "break-intro",
    label: "Incident: large probes fail",
    narrative: "After overnight maintenance on the R1–R2 link, monitoring reports that HOST-A's large DF test pings to HOST-B fail, while normal pings still succeed.",
    run: (s) => ({ state: idle(s), events: [] }),
  },
  {
    id: "fault-injected",
    label: "The maintenance change",
    narrative: "The R1–R2 link was reconfigured during maintenance. Links are up and routes are unchanged. Gather evidence.",
    run: (s) => ({ state: { ...idle(s), transitMtu: FAULT_MTU, faultActive: true, probe: { dataLength: BIG_DATA, df: true } }, events: [ev("STEP_ENTERED", "fault-injected", "transit reconfigured")] }),
  },
  {
    id: "small-ping",
    label: "Evidence: small pings work",
    narrative: `A normal ${20 + 8 + PING_DATA}-byte ping still crosses the transit link: reachability and routing are fine.`,
    run: (s) => {
      const a = hostSendEcho(s, "small-ping", "HOST-A", { kind: "echo-request", seq: 5, ttl: INITIAL_TTL, dataLength: PING_DATA, df: false });
      return { state: routerForward(a, "small-ping", "R1", pkt(a)), events: [ev("PACKET_SENT", "small-ping", "small ping ok")] };
    },
    packet: pkt,
  },
  {
    id: "big-ping-send",
    label: "The large DF probe",
    narrative: `HOST-A sends Echo Request seq 6 with ${BIG_DATA} bytes of data and DF set: 20 + 8 + ${BIG_DATA} = 1500 bytes.`,
    run: (s) => ({ state: hostSendEcho(idle(s), "big-ping-send", "HOST-A", { kind: "echo-request", seq: 6, ttl: INITIAL_TTL, dataLength: s.probe.dataLength, df: s.probe.df }), events: [ev("PACKET_SENT", "big-ping-send", "1500-byte DF probe")] }),
    packet: pkt,
  },
  {
    id: "big-ping-drop",
    label: "R1 answers with ICMP",
    narrative: "R1 does not forward the probe. It sends an ICMP error back to HOST-A instead. Inspect it.",
    run: (s) => ({ state: routerForward(s, "big-ping-drop", "R1", pkt(s)), events: [ev("PACKET_DROPPED", "big-ping-drop", "ICMP 3/4 returned")] }),
    packet: pkt,
  },
  {
    id: "trouble-question",
    label: "Diagnose",
    narrative: "Small pings work; the 1500-byte DF ping draws an ICMP Type 3 Code 4 from R1 carrying Next-Hop MTU 1400.",
    question: {
      prompt: "Why can R1 not forward the 1500-byte DF packet onto the transit link?",
      options: [
        { id: "mtu", label: "It exceeds the link's 1400-byte IP MTU and DF forbids fragmenting it" },
        { id: "ttl", label: "Its TTL expired at R1" },
        { id: "route", label: "R1 has no route to 198.51.100.0/24" },
        { id: "port", label: "ICMP port 7 is blocked" },
      ],
      correctOptionId: "mtu",
      explanation: "Type 3 Code 4 means 'Fragmentation Needed and DF set'. R1 reports the next-hop MTU (1400), so the sender knows exactly how large a DF packet may be. TTL was 64 and routing works (small pings pass).",
    },
  },
  {
    id: "diagnostic-layers",
    label: "Troubleshooting layers",
    narrative: "Separate what works from what fails: links, routes, TTL, and packet size versus MTU.",
  },
  {
    id: "repair-challenge",
    label: "Fix the probe",
    narrative: "The link MTU is a provider constraint you can't change. Choose the change that makes the DF probe fit.",
    action: (s, payload) => ({ state: applyIcRepair(s, (payload as { choice: string }).choice), events: [ev("STEP_ENTERED", "repair-challenge", `repair ${(payload as { choice: string }).choice}`)] }),
    requiresState: (s) => s.repaired,
  },
  {
    id: "verify-send",
    label: "Verify: 1400-byte DF probe",
    narrative: `Echo Request seq 7, DF set, ${FIXED_DATA} bytes of data: 20 + 8 + ${FIXED_DATA} = 1400 bytes.`,
    run: (s) => ({ state: hostSendEcho(idle(s), "verify-send", "HOST-A", { kind: "echo-request", seq: 7, ttl: INITIAL_TTL, dataLength: s.probe.dataLength, df: s.probe.df }), events: [ev("PACKET_SENT", "verify-send", "1400-byte DF probe")] }),
    packet: pkt,
  },
  {
    id: "verify-forward",
    label: "Fits exactly",
    narrative: "1400 ≤ 1400: R1 forwards it onto the transit link unfragmented (TTL 63).",
    run: (s) => ({ state: routerForward(s, "verify-forward", "R1", pkt(s)), events: [ev("PACKET_SENT", "verify-forward", "R1 forwards 1400 B")] }),
    packet: pkt,
  },
  {
    id: "verify-deliver",
    label: "Delivered to HOST-B",
    narrative: "R2 forwards it onto its 1500-byte LAN (TTL 62).",
    run: (s) => ({ state: routerForward(s, "verify-deliver", "R2", pkt(s)), events: [ev("PACKET_SENT", "verify-deliver", "R2 delivers")] }),
    packet: pkt,
  },
  {
    id: "verify-reply",
    label: "The reply comes back",
    narrative: "HOST-B's 1400-byte Echo Reply also fits the transit MTU in the other direction. R2 → R1 → HOST-A.",
    run: (s) => {
      const a = hostSendEcho(s, "verify-reply", "HOST-B", { kind: "echo-reply", seq: 7, ttl: INITIAL_TTL, dataLength: s.probe.dataLength, df: s.probe.df });
      const b = routerForward(a, "verify-reply", "R2", pkt(a));
      return { state: routerForward(b, "verify-reply", "R1", pkt(b)), events: [ev("PACKET_SENT", "verify-reply", "Echo Reply 1400 B home")] };
    },
    packet: pkt,
  },
  {
    id: "complete",
    label: "Lesson complete",
    narrative: "Echo for reachability, TTL + Time Exceeded for the path, DF + Fragmentation Needed for the path MTU — all read straight from ICMP Type/Code.",
  },
];
