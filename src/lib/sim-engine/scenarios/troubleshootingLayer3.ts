import type { PacketVisual, PVEvent, PVEventType, ScenarioStep } from "../types";
import type { PacketStackFrame, ProcessingStage } from "@/components/network3d/types";
import type { FundHop } from "@/components/lesson/fundamentalsTrace";
import { fieldOf, icmpPacket, ipToNum, numToIp, packetStack, type IcmpEcho } from "./fundamentalsPackets";
import { withNotes, type NotebookEntry } from "./troubleshootingCommon";

/**
 * Layer 3 Troubleshooting: ARP, Addressing & Forwarding — CLIENT — SW1 — R1 — R2, with SERVER (10.20.20.0/24) and
 * REMOTE-SERVER (10.10.20.0/24) behind R2.
 *
 * Modeled exactly:
 * - A host decides local vs remote from ITS OWN routing table: configuring 10.10.10.10 with a prefix length creates a
 *   connected route for that network; the default gateway is a 0.0.0.0/0 route. The longest matching prefix wins, so the
 *   default route is consulted only when no connected route matches.
 * - On-link destination → ARP for the destination itself. Off-link → ARP for the gateway, then send the IPv4 packet in
 *   an Ethernet frame addressed to the GATEWAY's MAC while the IPv4 destination stays the final host.
 * - ARP (RFC 826): requests are Ethernet broadcasts with an all-zero Target Hardware Address; a host or router answers
 *   only for its own addresses (proxy ARP disabled on R1).
 * - Routers: longest-prefix match, TTL − 1 per routing hop (switches never change TTL), IPv4 header checksum recomputed,
 *   new Ethernet addresses per hop. ICMP echoes use the shared byte-accurate builders (RFC 791/792 checksums computed).
 * Incident (truth, never shown before diagnosis): CLIENT is configured 10.10.10.10/16 instead of /24. Its connected
 * 10.10.0.0/16 route swallows 10.10.20.20, so it ARPs for that address on its own segment; nobody answers, and no IPv4
 * packet for it is ever sent. 10.20.20.20 is outside 10.10.0.0/16 and keeps working through the gateway.
 */

export type L3Device = "CLIENT" | "SW1" | "R1" | "R2" | "SERVER" | "REMOTE-SERVER";
export const L3_DEVICES: L3Device[] = ["CLIENT", "SW1", "R1", "R2", "SERVER", "REMOTE-SERVER"];
export const L3 = { client: "10.10.10.10", gw: "10.10.10.1", r1T: "192.0.2.0", r2T: "192.0.2.1", r2Srv: "10.20.20.1", r2Rem: "10.10.20.1", server: "10.20.20.20", remote: "10.10.20.20" } as const;
export const L3_MAC = { CLIENT: "00:00:5E:00:53:C0", R1_LAN: "00:00:5E:00:53:01", R1_T: "00:00:5E:00:53:12", R2_T: "00:00:5E:00:53:21", R2_SRV: "00:00:5E:00:53:22", R2_REM: "00:00:5E:00:53:23", SERVER: "00:00:5E:00:53:D0", REMOTE: "00:00:5E:00:53:E0" } as const;
export const BCAST = "FF:FF:FF:FF:FF:FF";
export const ZERO_MAC = "00:00:00:00:00:00";
export const GOOD_PREFIX = 24;
export const FAULT_PREFIX = 16;
export const INITIAL_TTL = 64;

export const maskNum = (len: number) => (len === 0 ? 0 : (0xffffffff - (2 ** (32 - len) - 1)) >>> 0);
export const maskOf = (len: number) => numToIp(maskNum(len));
export const networkOf = (ip: string, len: number) => numToIp((ipToNum(ip) & maskNum(len)) >>> 0);
export const inNet = (ip: string, net: string, len: number) => networkOf(ip, len) === networkOf(net, len);

export interface HostRoute {
  prefix: string;
  len: number;
  kind: "connected" | "default";
  via?: string;
}
export const clientRoutes = (len: number): HostRoute[] => [
  { prefix: networkOf(L3.client, len), len, kind: "connected" },
  { prefix: "0.0.0.0", len: 0, kind: "default", via: L3.gw },
];
export const routeText = (r: HostRoute) => (r.kind === "connected" ? `${r.prefix}/${r.len} connected eth0 (on-link)` : `0.0.0.0/0 via ${r.via}`);
/** Longest-prefix match on the client's own table. */
export function clientLookup(len: number, dst: string): { route: HostRoute; matches: HostRoute[]; onLink: boolean; nextHop: string } {
  const matches = clientRoutes(len)
    .filter((r) => r.len === 0 || inNet(dst, r.prefix, r.len))
    .sort((a, b) => b.len - a.len);
  const route = matches[0];
  const onLink = route.kind === "connected";
  return { route, matches, onLink, nextHop: onLink ? dst : route.via! };
}

export interface RtRoute {
  prefix: string;
  len: number;
  iface: string;
  via?: string;
}
export const R1_ROUTES: RtRoute[] = [
  { prefix: "10.10.10.0", len: 24, iface: "ge-0/0/0" },
  { prefix: "192.0.2.0", len: 31, iface: "ge-0/0/1" },
  { prefix: "10.10.20.0", len: 24, iface: "ge-0/0/1", via: L3.r2T },
  { prefix: "10.20.20.0", len: 24, iface: "ge-0/0/1", via: L3.r2T },
];
export const R2_ROUTES: RtRoute[] = [
  { prefix: "192.0.2.0", len: 31, iface: "ge-0/0/0" },
  { prefix: "10.20.20.0", len: 24, iface: "ge-0/0/1" },
  { prefix: "10.10.20.0", len: 24, iface: "ge-0/0/2" },
  { prefix: "10.10.10.0", len: 24, iface: "ge-0/0/0", via: L3.r1T },
];
export const rtLookup = (t: RtRoute[], dst: string) => t.filter((r) => inNet(dst, r.prefix, r.len)).sort((a, b) => b.len - a.len)[0];
export const rtText = (r: RtRoute) => `${r.prefix}/${r.len} ${r.via ? `via ${r.via}` : "connected"} ${r.iface}`;
export const R1_ADDRS = [L3.gw, L3.r1T];

// ---------------------------------------------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------------------------------------------
export interface L3State {
  hops: FundHop[];
  packet?: PacketVisual;
  flood: { id: string; fromId: string; toId: string; packet: PacketVisual }[];
  /** Truth: CLIENT's configured prefix length. */
  clientPrefix: number;
  clientArp: Record<string, string>;
  /** CLIENT's pending (unanswered) ARP resolutions. */
  arpPending: Record<string, number>;
  r1Stats: { arpForOthers: Record<string, number>; ipFromClient: Record<string, number> };
  pings: { label: string; dst: string; sent: number; received: number; note?: string }[];
  notebook: NotebookEntry[];
  decision?: { device: L3Device; text: string };
  faultActive: boolean;
  repairAttempt?: { choice: string; correct: boolean };
  repaired: boolean;
}
export const createL3State = (): L3State => ({ hops: [], flood: [], clientPrefix: GOOD_PREFIX, clientArp: {}, arpPending: {}, r1Stats: { arpForOthers: {}, ipFromClient: {} }, pings: [], notebook: [], faultActive: false, repaired: false });

// ---------------------------------------------------------------------------------------------------------------
// Packets
// ---------------------------------------------------------------------------------------------------------------
export function arpPacket(id: string, from: L3Device, to: L3Device, o: { op: "request" | "reply"; senderMac: string; senderIp: string; targetMac: string; targetIp: string; ethDst: string }): PacketVisual {
  const req = o.op === "request";
  return {
    id,
    protocol: "ARP",
    from,
    to,
    broadcast: o.ethDst === BCAST,
    badge: "ARP",
    summary: req ? `ARP request — who has ${o.targetIp}? tell ${o.senderIp}` : `ARP reply — ${o.senderIp} is at ${o.senderMac}`,
    layers: [
      { name: "Ethernet II Header", color: "#94a3b8", fields: [{ label: "Destination MAC", value: o.ethDst }, { label: "Source MAC", value: o.senderMac }, { label: "EtherType", value: "0x0806 (ARP)" }] },
      { name: "ARP", color: "#f59e0b", fields: [{ label: "Hardware / Protocol", value: "1 (Ethernet) / 0x0800 (IPv4)" }, { label: "Operation", value: req ? "1 (request)" : "2 (reply)" }, { label: "Sender MAC", value: o.senderMac }, { label: "Sender IP", value: o.senderIp }, { label: "Target MAC", value: o.targetMac }, { label: "Target IP", value: o.targetIp }] },
      { name: "FCS", color: "#94a3b8", fields: [{ label: "Frame Check Sequence", value: "CRC-32 over the frame" }] },
    ],
  };
}
export const isArp = (p: PacketVisual) => p.layers.some((l) => l.name === "ARP");
export const ECHO_ID = 0x0303;
const echo = (kind: IcmpEcho["kind"], seq: number): IcmpEcho => ({ kind, identifier: ECHO_ID, sequence: seq, dataLength: 56 });
export function pingPkt(id: string, from: L3Device, to: L3Device, o: { kind: IcmpEcho["kind"]; seq: number; src: string; dst: string; ttl: number; ethSrc: string; ethDst: string }): PacketVisual {
  return icmpPacket({ id, from, to, ethSrc: o.ethSrc, ethDst: o.ethDst, ip: { src: o.src, dst: o.dst, ttl: o.ttl, id: (o.kind === "echo-request" ? 0x4c00 : 0x7e00) + o.seq, df: false }, icmp: echo(o.kind, o.seq) });
}
export function l3Stack(p: PacketVisual): PacketStackFrame[] {
  if (isArp(p))
    return [
      { id: "eth", text: `Ethernet · dst ${fieldOf(p, /^Ethernet/, "Destination MAC")} · src ${fieldOf(p, /^Ethernet/, "Source MAC")} · 0x0806`, tone: "generic" },
      { id: "arp", text: `ARP ${fieldOf(p, /^ARP$/, "Operation")} · target IP ${fieldOf(p, /^ARP$/, "Target IP")} · target MAC ${fieldOf(p, /^ARP$/, "Target MAC")}`, tone: "vpn" },
    ];
  return packetStack(p);
}

// ---------------------------------------------------------------------------------------------------------------
// Stages and hop helpers
// ---------------------------------------------------------------------------------------------------------------
export const HOST_STAGES: ProcessingStage[] = [
  { id: "route", label: "Own routing table: longest-prefix match (connected vs default)" },
  { id: "decide", label: "On-link → ARP for the destination · off-link → ARP for the gateway" },
  { id: "arp", label: "ARP cache / ARP request" },
  { id: "tx", label: "Frame to the next-hop MAC; IPv4 destination = final host" },
  { id: "rx", label: "Receive" },
];
export const SWITCH_STAGES: ProcessingStage[] = [
  { id: "rx", label: "Receive frame" },
  { id: "fwd", label: "Forward by MAC (broadcast → flood); TTL untouched" },
];
export const ROUTER_STAGES: ProcessingStage[] = [
  { id: "rx", label: "Receive frame addressed to this router (or broadcast)" },
  { id: "arp", label: "ARP: answer only for own addresses (proxy ARP off)" },
  { id: "lookup", label: "IPv4 longest-prefix match" },
  { id: "ttl", label: "TTL − 1 · header checksum recomputed" },
  { id: "tx", label: "Next-hop MAC · rewrite Ethernet · transmit" },
];
export const L3_STAGES: Record<L3Device, ProcessingStage[]> = { CLIENT: HOST_STAGES, SERVER: HOST_STAGES, "REMOTE-SERVER": HOST_STAGES, SW1: SWITCH_STAGES, R1: ROUTER_STAGES, R2: ROUTER_STAGES };
const withDetail = (st: ProcessingStage[], d: Partial<Record<string, string>>) => st.map((x) => (d[x.id] ? { ...x, detail: d[x.id] } : x));
const ev = (type: PVEventType, stepId: string, message: string): PVEvent => ({ type, stepId, timestamp: Date.now(), message });
const idle = (s: L3State): L3State => ({ ...s, packet: undefined, flood: [], decision: undefined });
function hop(stepId: string, device: L3Device, o: { active: string; details: Partial<Record<string, string>>; lookupType: string; key: string; result: string; action: string; reason: string; input: string; output: string; ingress?: string; egress?: string; next?: L3Device; before?: PacketVisual; after?: PacketVisual }): FundHop {
  return { stepId, device, stages: withDetail(L3_STAGES[device], o.details), activeStageId: o.active, ingressInterfaceId: o.ingress, egressInterfaceId: o.egress, lookupType: o.lookupType, lookupKey: o.key, lookupResult: o.result, action: o.action, reason: o.reason, input: o.input, output: o.output, nextHopId: o.next, before: o.before ? l3Stack(o.before) : undefined, after: o.after ? l3Stack(o.after) : undefined };
}
const evidence = (s: L3State, stepId: string, d: L3Device, o: { active: string; details: Partial<Record<string, string>>; action: string; reason: string; key: string; result: string }): L3State => ({ ...s, hops: [...s.hops, hop(stepId, d, { ...o, lookupType: `${d} evidence`, input: o.key, output: o.result })] });

/** CLIENT's decision for a destination, recorded as a hop (the evidence a learner can inspect). */
function clientDecides(s: L3State, stepId: string, dst: string, p?: PacketVisual): FundHop {
  const d = clientLookup(s.clientPrefix, dst);
  const cached = s.clientArp[d.nextHop];
  return hop(stepId, "CLIENT", {
    active: p && !isArp(p) ? "tx" : "arp",
    egress: "eth0",
    details: {
      route: `${dst}: matches ${d.matches.map(routeText).join(" and ")} → longest = ${routeText(d.route)}`,
      decide: d.onLink ? `on-link → next hop is ${dst} itself` : `off-link → next hop is the gateway ${d.nextHop}`,
      arp: cached ? `${d.nextHop} → ${cached} (cached)` : `${d.nextHop}: not in cache → ARP request (broadcast)`,
      ...(p && !isArp(p) ? { tx: `Ethernet dst ${fieldOf(p, /^Ethernet/, "Destination MAC")} · IPv4 dst ${fieldOf(p, /^IPv4/, "Destination")} · TTL ${fieldOf(p, /^IPv4/, "TTL")}` } : {}),
    },
    lookupType: "CLIENT routing table",
    key: `destination ${dst}`,
    result: d.onLink ? `on-link via ${routeText(d.route)}` : `via gateway ${d.nextHop}`,
    action: d.onLink ? "ON-LINK" : "VIA GATEWAY",
    reason: d.onLink ? `The longest matching route is the connected ${d.route.prefix}/${d.route.len}, so CLIENT treats ${dst} as a neighbor on its own segment and resolves ${dst} itself. The default route is never consulted.` : `Only the default route matches, so the packet goes to the gateway: ARP for ${d.nextHop}, frame to the gateway's MAC, IPv4 destination still ${dst}.`,
    input: `send to ${dst}`,
    output: d.onLink ? `ARP for ${dst}` : `frame to ${d.nextHop}'s MAC`,
    next: "SW1",
    after: p,
  });
}
const sw1 = (stepId: string, p: PacketVisual, out: string): FundHop => hop(stepId, "SW1", { active: "fwd", ingress: out === "ge-0/0/1" ? "ge-0/0/24" : "ge-0/0/1", egress: out, details: { fwd: `${fieldOf(p, /^Ethernet/, "Destination MAC") === BCAST ? "broadcast → flood" : `dst ${fieldOf(p, /^Ethernet/, "Destination MAC")} → ${out}`} · frame unchanged` }, lookupType: "SW1 MAC table", key: fieldOf(p, /^Ethernet/, "Destination MAC"), result: out, action: fieldOf(p, /^Ethernet/, "Destination MAC") === BCAST ? "FLOOD" : "FORWARD", reason: "A switch forwards by Ethernet address and never touches IP or TTL.", input: "frame", output: "same frame", before: p, after: p });
function routerFwd(stepId: string, r: "R1" | "R2", p: PacketVisual, out: PacketVisual, inIf: string): FundHop {
  const dst = fieldOf(p, /^IPv4/, "Destination");
  const route = rtLookup(r === "R1" ? R1_ROUTES : R2_ROUTES, dst)!;
  const ttlIn = Number(fieldOf(p, /^IPv4/, "TTL"));
  return hop(stepId, r, { active: "tx", ingress: inIf, egress: route.iface, details: { rx: `frame to ${fieldOf(p, /^Ethernet/, "Destination MAC")} (this router)`, lookup: `${dst} → ${rtText(route)}`, ttl: `TTL ${ttlIn} → ${ttlIn - 1} · checksum ${fieldOf(p, /^IPv4/, "Header Checksum")} → ${fieldOf(out, /^IPv4/, "Header Checksum")}`, tx: `Ethernet ${fieldOf(out, /^Ethernet/, "Source MAC")} → ${fieldOf(out, /^Ethernet/, "Destination MAC")}` }, lookupType: `${r} IPv4 FIB`, key: dst, result: rtText(route), action: "ROUTE", reason: "Longest-prefix match, TTL − 1, new Ethernet addresses for the next link. Source and destination IP stay the same end to end.", input: `IPv4 → ${dst} · TTL ${ttlIn}`, output: `TTL ${ttlIn - 1} → ${route.via ?? dst}`, before: p, after: out });
}
const hostRx = (stepId: string, d: L3Device, p: PacketVisual, result: string, reason: string): FundHop => hop(stepId, d, { active: "rx", ingress: "eth0", details: { rx: `${p.summary} · TTL ${fieldOf(p, /^IPv4/, "TTL") || "—"}` }, lookupType: `${d} host`, key: p.summary, result, action: "RX", reason, input: p.summary, output: result, before: p });

// Frames along the REMOTE-SERVER path (seq decides IP IDs; TTLs are per link)
const toRemote = (seq: number) => ({
  c: (id: string) => pingPkt(id, "CLIENT", "SW1", { kind: "echo-request", seq, src: L3.client, dst: L3.remote, ttl: 64, ethSrc: L3_MAC.CLIENT, ethDst: L3_MAC.R1_LAN }),
  sw: (id: string) => pingPkt(id, "SW1", "R1", { kind: "echo-request", seq, src: L3.client, dst: L3.remote, ttl: 64, ethSrc: L3_MAC.CLIENT, ethDst: L3_MAC.R1_LAN }),
  r1: (id: string) => pingPkt(id, "R1", "R2", { kind: "echo-request", seq, src: L3.client, dst: L3.remote, ttl: 63, ethSrc: L3_MAC.R1_T, ethDst: L3_MAC.R2_T }),
  r2: (id: string) => pingPkt(id, "R2", "REMOTE-SERVER", { kind: "echo-request", seq, src: L3.client, dst: L3.remote, ttl: 62, ethSrc: L3_MAC.R2_REM, ethDst: L3_MAC.REMOTE }),
  rep: (id: string) => pingPkt(id, "REMOTE-SERVER", "R2", { kind: "echo-reply", seq, src: L3.remote, dst: L3.client, ttl: 64, ethSrc: L3_MAC.REMOTE, ethDst: L3_MAC.R2_REM }),
  repCl: (id: string) => pingPkt(id, "SW1", "CLIENT", { kind: "echo-reply", seq, src: L3.remote, dst: L3.client, ttl: 62, ethSrc: L3_MAC.R1_LAN, ethDst: L3_MAC.CLIENT }),
});
const arpFor = (target: string) => (from: L3Device, to: L3Device, id: string) => arpPacket(id, from, to, { op: "request", senderMac: L3_MAC.CLIENT, senderIp: L3.client, targetMac: ZERO_MAC, targetIp: target, ethDst: BCAST });
const gwReply = (id: string) => arpPacket(id, "SW1", "CLIENT", { op: "reply", senderMac: L3_MAC.R1_LAN, senderIp: L3.gw, targetMac: L3_MAC.CLIENT, targetIp: L3.client, ethDst: L3_MAC.CLIENT });
const ping = (s: L3State, label: string, dst: string, received: number, note?: string): L3State => ({ ...s, pings: [...s.pings, { label, dst, sent: 5, received, note }] });

// ---------------------------------------------------------------------------------------------------------------
// Repair
// ---------------------------------------------------------------------------------------------------------------
export const L3_REPAIR_OPTIONS = [
  { id: "prefix-24", label: "Restore CLIENT's prefix length to /24 (mask 255.255.255.0)" },
  { id: "r1-default", label: "Change R1's default route" },
  { id: "clear-r2-arp", label: "Clear R2's ARP cache" },
  { id: "restart-sw", label: "Restart SW1" },
  { id: "server-port", label: "Change REMOTE-SERVER's service port" },
  { id: "disable-stp", label: "Disable spanning tree on SW1" },
] as const;
export const L3_REPAIR_CORRECT = "prefix-24";
export function applyL3Repair(s: L3State, choice: string): L3State {
  const correct = choice === L3_REPAIR_CORRECT;
  if (!correct) return { ...s, repairAttempt: { choice, correct } };
  // Re-addressing the interface flushes the host's neighbor cache for that interface.
  return { ...idle(s), clientPrefix: GOOD_PREFIX, clientArp: {}, arpPending: {}, faultActive: false, repaired: true, repairAttempt: { choice, correct }, decision: { device: "CLIENT", text: `CLIENT eth0: ${L3.client}/${GOOD_PREFIX}` } };
}

// ---------------------------------------------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------------------------------------------
const pkt = (s: L3State) => s.packet;
export const clientTableText = (s: L3State) => clientRoutes(s.clientPrefix).map(routeText).join(" · ");

export const l3Steps: ScenarioStep<L3State>[] = [
  // ---- Define / Scope ---
  {
    id: "intro",
    label: "One client, two remote servers",
    narrative: `CLIENT (${L3.client}/${GOOD_PREFIX}, gateway ${L3.gw}) sits on 10.10.10.0/24 behind SW1. R1 and R2 are joined by 192.0.2.0/31. Behind R2: SERVER ${L3.server} (10.20.20.0/24) and REMOTE-SERVER ${L3.remote} (10.10.20.0/24). Both servers are remote from CLIENT; both are reached through R1 and R2.`,
    run: (s) => ({ state: withNotes(idle(s), "intro", [{ kind: "observation", text: `Design: CLIENT ${L3.client}/${GOOD_PREFIX} gw ${L3.gw}; servers ${L3.server} and ${L3.remote} behind R2`, source: "IP plan" }]), events: [ev("STEP_ENTERED", "intro", "scope")] }),
  },
  {
    id: "host-decision",
    label: "Local or remote? The host decides",
    narrative: `Configuring ${L3.client}/${GOOD_PREFIX} gives CLIENT a connected route ${networkOf(L3.client, GOOD_PREFIX)}/${GOOD_PREFIX}; the gateway gives it 0.0.0.0/0 via ${L3.gw}. For ${L3.remote}: ${L3.remote} AND ${maskOf(GOOD_PREFIX)} = ${networkOf(L3.remote, GOOD_PREFIX)} ≠ ${networkOf(L3.client, GOOD_PREFIX)}, so only the default route matches → remote → send via the gateway.`,
    run: (s) => ({ state: { ...idle(s), hops: [...s.hops, clientDecides(s, "host-decision", L3.remote)] }, events: [ev("STEP_ENTERED", "host-decision", "decision")] }),
  },
  {
    id: "q-local-remote",
    label: "Question: local vs remote",
    narrative: "Every IPv4 host makes this decision before sending anything.",
    question: {
      prompt: "How does a host decide whether a destination is local or remote?",
      options: [
        { id: "lpm", label: "It looks the destination up in its own routing table: a matching connected route (from its address + prefix length) means on-link; otherwise it uses the gateway" },
        { id: "router", label: "It asks the default gateway every time" },
        { id: "dns", label: "DNS tells it" },
        { id: "arp", label: "It ARPs for the destination and waits to see who answers" },
      ],
      correctOptionId: "lpm",
      explanation: "The prefix length defines which addresses the host believes share its segment. That belief — right or wrong — decides everything that follows.",
    },
  },
  // ---- Baseline ---
  {
    id: "base-table",
    label: "Baseline: CLIENT's routing table",
    narrative: `CLIENT: ${clientRoutes(GOOD_PREFIX).map(routeText).join("; ")}.`,
    run: (s) => ({ state: withNotes(evidence(idle(s), "base-table", "CLIENT", { active: "route", details: { route: clientTableText(s) }, action: "ROUTE TABLE", reason: "The connected route comes from the interface's address and prefix length; the default route from the configured gateway.", key: "ip route (CLIENT)", result: clientTableText(s) }), "base-table", [{ kind: "observation", text: `Baseline CLIENT table: ${clientTableText(s)}`, source: "CLIENT", rung: "IP addressing" }]), events: [ev("STEP_ENTERED", "base-table", "table")] }),
  },
  {
    id: "base-arp-gw",
    label: "Baseline: ARP for the gateway",
    narrative: `To reach ${L3.remote}, CLIENT needs the MAC of its NEXT HOP — the gateway ${L3.gw} — not of ${L3.remote}. It broadcasts: who has ${L3.gw}? Target MAC 00:00:00:00:00:00 (unknown).`,
    run: (s) => {
      const p = arpFor(L3.gw)("CLIENT", "SW1", "base-arp-gw-pkt");
      return { state: { ...idle(s), hops: [...s.hops, clientDecides(s, "base-arp-gw", L3.remote, p)], packet: p }, events: [ev("PACKET_SENT", "base-arp-gw", "ARP gw")] };
    },
    packet: pkt,
  },
  {
    id: "q-arp-who",
    label: "Question: whose MAC?",
    narrative: `CLIENT is about to send to ${L3.remote}.`,
    question: {
      prompt: `Whose MAC address does CLIENT resolve to reach ${L3.remote}?`,
      options: [
        { id: "gw", label: `The gateway's (${L3.gw}) — ${L3.remote} is remote, and Ethernet only carries the frame to the next hop` },
        { id: "final", label: `${L3.remote}'s own MAC` },
        { id: "r2", label: "R2's MAC" },
        { id: "none", label: "No MAC is needed for IP traffic" },
      ],
      correctOptionId: "gw",
      explanation: "A frame only travels one link. For a remote destination that link ends at the gateway, so the frame is addressed to the gateway's MAC while the IPv4 destination stays the final host.",
    },
  },
  {
    id: "base-arp-reply",
    label: "Baseline: gateway answers",
    narrative: `R1 owns ${L3.gw} and replies unicast: ${L3.gw} is at ${L3_MAC.R1_LAN}. CLIENT caches it.`,
    run: (s) => {
      const req = arpFor(L3.gw)("SW1", "R1", "req");
      const p = gwReply("base-arp-reply-pkt");
      const hr = hop("base-arp-reply", "R1", { active: "arp", ingress: "ge-0/0/0", egress: "ge-0/0/0", details: { arp: `target ${L3.gw} is my address → reply ${L3_MAC.R1_LAN}` }, lookupType: "R1 ARP", key: `who-has ${L3.gw}`, result: "own address → reply", action: "ARP REPLY", reason: "A router answers ARP for its own interface addresses.", input: "ARP request (broadcast)", output: "ARP reply (unicast)", before: req, after: p });
      return { state: { ...idle(s), hops: [...s.hops, hr, hostRx("base-arp-reply", "CLIENT", p, `cache ${L3.gw} → ${L3_MAC.R1_LAN}`, "Gateway resolved.")], packet: p, clientArp: { ...s.clientArp, [L3.gw]: L3_MAC.R1_LAN } }, events: [ev("PACKET_SENT", "base-arp-reply", "ARP reply")] };
    },
    packet: pkt,
  },
  {
    id: "base-echo",
    label: "Baseline: echo to the gateway's MAC",
    narrative: `The echo leaves CLIENT with Ethernet destination ${L3_MAC.R1_LAN} (R1) and IPv4 destination ${L3.remote}, TTL 64. Two different destinations, two different layers.`,
    run: (s) => {
      const f = toRemote(1);
      const p = f.c("base-echo-pkt");
      return { state: { ...idle(s), hops: [...s.hops, clientDecides(s, "base-echo", L3.remote, p), sw1("base-echo", p, "ge-0/0/24")], packet: p, r1Stats: { ...s.r1Stats, ipFromClient: { ...s.r1Stats.ipFromClient, [L3.remote]: (s.r1Stats.ipFromClient[L3.remote] ?? 0) + 1 } } }, events: [ev("PACKET_SENT", "base-echo", "echo")] };
    },
    packet: pkt,
  },
  {
    id: "base-r1",
    label: "Baseline: R1 routes",
    narrative: `R1: ${L3.remote} → ${rtText(rtLookup(R1_ROUTES, L3.remote)!)}. TTL 64 → 63, new MACs ${L3_MAC.R1_T} → ${L3_MAC.R2_T}; IP addresses unchanged.`,
    run: (s) => {
      const f = toRemote(1);
      const out = f.r1("base-r1-pkt");
      return { state: { ...idle(s), hops: [...s.hops, routerFwd("base-r1", "R1", f.sw("in"), out, "ge-0/0/0")], packet: out }, events: [ev("PACKET_SENT", "base-r1", "R1")] };
    },
    packet: pkt,
  },
  {
    id: "base-r2",
    label: "Baseline: R2 delivers",
    narrative: `R2: ${L3.remote} → ${rtText(rtLookup(R2_ROUTES, L3.remote)!)}. TTL 63 → 62; frame to REMOTE-SERVER's MAC.`,
    run: (s) => {
      const f = toRemote(1);
      const out = f.r2("base-r2-pkt");
      return { state: { ...idle(s), hops: [...s.hops, routerFwd("base-r2", "R2", f.r1("in"), out, "ge-0/0/0"), hostRx("base-r2", "REMOTE-SERVER", out, "echo reply", "For me: answer.")], packet: out }, events: [ev("PACKET_SENT", "base-r2", "R2")] };
    },
    packet: pkt,
  },
  {
    id: "base-reply",
    label: "Baseline: reply comes back",
    narrative: "REMOTE-SERVER replies (TTL 64, to its own gateway 10.10.20.1). R2 and R1 each route it (TTL 63, then 62), and it reaches CLIENT with TTL 62. Pings to REMOTE-SERVER and SERVER: 5/5 each.",
    run: (s) => {
      const f = toRemote(1);
      const p = f.repCl("base-reply-pkt");
      return { state: withNotes(ping(ping({ ...idle(s), hops: [...s.hops, hostRx("base-reply", "CLIENT", p, "echo reply received", "TTL 62: two routers on the way back.")], packet: p }, "baseline", L3.remote, 5), "baseline", L3.server, 5), "base-reply", [{ kind: "observation", text: `Baseline: ${L3.remote} 5/5, ${L3.server} 5/5; replies arrive with TTL 62`, source: "ping" }]), events: [ev("PACKET_SENT", "base-reply", "reply")] };
    },
    packet: pkt,
  },
  // ---- Incident ---
  {
    id: "incident-intro",
    label: "Incident: one server unreachable",
    narrative: `After CLIENT's network settings were re-entered during a laptop reimage, the user says ${L3.remote} is unreachable. Scope before touching anything: which destinations fail, and which still work?`,
    run: (s) => ({ state: withNotes({ ...idle(s), clientPrefix: FAULT_PREFIX, clientArp: {}, faultActive: true }, "incident-intro", [{ kind: "symptom", text: `CLIENT cannot reach ${L3.remote} (after a reimage)`, source: "user report" }]), events: [ev("STEP_ENTERED", "incident-intro", "incident")] }),
  },
  {
    id: "inc-server-ok",
    label: `${L3.server} still works`,
    narrative: `Ping ${L3.server}: 5/5. The echo leaves CLIENT addressed to R1's MAC with IPv4 destination ${L3.server} — the gateway path works.`,
    run: (s) => {
      const p = pingPkt("inc-server-ok-pkt", "CLIENT", "SW1", { kind: "echo-request", seq: 1, src: L3.client, dst: L3.server, ttl: 64, ethSrc: L3_MAC.CLIENT, ethDst: L3_MAC.R1_LAN });
      const n = { ...idle(s), clientArp: { ...s.clientArp, [L3.gw]: L3_MAC.R1_LAN }, hops: [...s.hops, clientDecides({ ...s, clientArp: { ...s.clientArp, [L3.gw]: L3_MAC.R1_LAN } }, "inc-server-ok", L3.server, p)], packet: p, r1Stats: { ...s.r1Stats, ipFromClient: { ...s.r1Stats.ipFromClient, [L3.server]: (s.r1Stats.ipFromClient[L3.server] ?? 0) + 5 } } };
      return { state: withNotes(ping(n, "incident", L3.server, 5), "inc-server-ok", [{ kind: "observation", text: `${L3.server}: 5/5 via the gateway`, source: "ping", rung: "Routing / forwarding" }, { kind: "inference", text: "CLIENT's gateway, R1 and R2 forward — the failure is specific to some destinations" }]), events: [ev("PACKET_SENT", "inc-server-ok", "echo")] };
    },
    packet: pkt,
  },
  {
    id: "q-scope",
    label: "Question: scoping",
    narrative: `${L3.server} works; ${L3.remote} does not. Both are behind R2.`,
    question: {
      prompt: "What does 'one remote destination works, another fails' suggest first?",
      options: [
        { id: "compare", label: "Compare how CLIENT handles each destination — the difference is in something destination-specific, not in the shared path" },
        { id: "r1", label: "R1 is down" },
        { id: "sw1", label: "SW1 is looping" },
        { id: "dns", label: "DNS is broken" },
      ],
      correctOptionId: "compare",
      explanation: "The shared path (CLIENT → SW1 → R1 → R2) demonstrably works. Look at what differs between the two destinations — starting at the first device that makes a per-destination decision: CLIENT.",
    },
  },
  {
    id: "inc-decision",
    label: `CLIENT evaluates ${L3.remote}`,
    narrative: `Inspect CLIENT's pipeline for ${L3.remote}. Its routing table now reads: ${clientRoutes(FAULT_PREFIX).map(routeText).join("; ")}. Which route matches ${L3.remote}, and which is longest?`,
    run: (s) => ({ state: withNotes({ ...idle(s), hops: [...s.hops, clientDecides(s, "inc-decision", L3.remote)] }, "inc-decision", [{ kind: "observation", text: `CLIENT table: ${clientTableText(s)}`, source: "CLIENT", rung: "IP addressing" }, { kind: "observation", text: `CLIENT treats ${L3.remote} as on-link (${routeText(clientLookup(s.clientPrefix, L3.remote).route)})`, source: "CLIENT route lookup" }]), events: [ev("STEP_ENTERED", "inc-decision", "decision")] }),
  },
  {
    id: "inc-arp",
    label: `ARP: who has ${L3.remote}?`,
    narrative: `CLIENT broadcasts an ARP request for ${L3.remote} itself — not for its gateway. Ethernet destination FF:FF:FF:FF:FF:FF, target MAC 00:00:00:00:00:00.`,
    run: (s) => {
      const p = arpFor(L3.remote)("CLIENT", "SW1", "inc-arp-pkt");
      return { state: { ...idle(s), hops: [...s.hops, clientDecides(s, "inc-arp", L3.remote, p), sw1("inc-arp", p, "ge-0/0/24")], packet: p, arpPending: { [L3.remote]: 1 } }, events: [ev("PACKET_SENT", "inc-arp", "ARP remote")] };
    },
    packet: pkt,
  },
  {
    id: "inc-arp-r1",
    label: "R1 hears the broadcast",
    narrative: `SW1 floods the broadcast; R1 receives it on ge-0/0/0. ${L3.remote} is not one of R1's addresses and proxy ARP is off, so R1 stays silent. Nobody on 10.10.10.0/24 owns ${L3.remote}.`,
    run: (s) => {
      const p = arpFor(L3.remote)("SW1", "R1", "inc-arp-r1-pkt");
      const hr = hop("inc-arp-r1", "R1", { active: "arp", ingress: "ge-0/0/0", details: { rx: "ARP broadcast on ge-0/0/0", arp: `target ${L3.remote} ∉ {${R1_ADDRS.join(", ")}} · proxy ARP off → no reply` }, lookupType: "R1 ARP", key: `who-has ${L3.remote}`, result: "not mine → ignored", action: "IGNORE", reason: "A router answers ARP only for its own addresses (unless proxy ARP is enabled). The request is not an IPv4 packet, so R1 has nothing to route.", input: "ARP request (broadcast)", output: "no reply", before: p });
      return { state: { ...idle(s), hops: [...s.hops, hr], packet: p, arpPending: { [L3.remote]: 1 }, r1Stats: { ...s.r1Stats, arpForOthers: { ...s.r1Stats.arpForOthers, [L3.remote]: (s.r1Stats.arpForOthers[L3.remote] ?? 0) + 1 } } }, events: [ev("PACKET_SENT", "inc-arp-r1", "ARP at R1")] };
    },
    packet: pkt,
  },
  {
    id: "inc-arp-fail",
    label: "No reply: host unreachable",
    narrative: `CLIENT retries the ARP (3 requests in total) and gives up: its own stack reports 'Destination Host Unreachable' for ${L3.remote}. Ping: 0/5. No IPv4 packet for ${L3.remote} ever left CLIENT.`,
    run: (s) => {
      const n = { ...idle(s), arpPending: { [L3.remote]: 3 }, r1Stats: { ...s.r1Stats, arpForOthers: { ...s.r1Stats.arpForOthers, [L3.remote]: 3 } } };
      return { state: withNotes(evidence(ping(n, "incident", L3.remote, 0, "Destination Host Unreachable (from CLIENT itself)"), "inc-arp-fail", "CLIENT", { active: "arp", details: { arp: `${L3.remote}: 3 ARP requests, no reply → incomplete → ICMP 'host unreachable' generated locally` }, action: "ARP FAILED", reason: "When ARP for an on-link next hop fails, the host itself reports the destination unreachable — the IPv4 packet is never transmitted.", key: `ARP ${L3.remote}`, result: "incomplete · 0/5" }), "inc-arp-fail", [{ kind: "observation", text: `ARP for ${L3.remote}: 3 requests, 0 replies; ping 0/5 'Destination Host Unreachable' from CLIENT itself`, source: "CLIENT", rung: "ARP / neighbor" }]), events: [ev("STEP_ENTERED", "inc-arp-fail", "ARP failed")] };
    },
  },
  {
    id: "q-r1-silent",
    label: "Question: R1 sees nothing",
    narrative: "A colleague captures on R1 ge-0/0/0 during the failed ping: ARP broadcasts, but no IPv4 packet from 10.10.10.10 to 10.10.20.20.",
    question: {
      prompt: "Why is R1 seeing no IPv4 packet for the failing attempt?",
      options: [
        { id: "never-sent", label: "CLIENT never sent one: it considered 10.10.20.20 on-link, its ARP failed, so the packet was never transmitted" },
        { id: "r1-drop", label: "R1 dropped it silently" },
        { id: "sw1", label: "SW1 filtered it" },
        { id: "ttl", label: "Its TTL expired before R1" },
      ],
      correctOptionId: "never-sent",
      explanation: "No next-hop MAC, no frame. The only traffic R1 can see is the ARP broadcast — which is not for R1.",
    },
  },
  {
    id: "inc-r1-stats",
    label: "R1's view",
    narrative: `R1 during the failed attempt: ARP requests heard for ${L3.remote} (not its address): 3. IPv4 packets from ${L3.client} to ${L3.remote}: 0. R1's route to 10.10.20.0/24 is present and correct.`,
    run: (s) => ({ state: withNotes(evidence(idle(s), "inc-r1-stats", "R1", { active: "lookup", details: { arp: `ARP for ${L3.remote} heard ${s.r1Stats.arpForOthers[L3.remote] ?? 0}× (not mine)`, lookup: `route ${rtText(rtLookup(R1_ROUTES, L3.remote)!)} · IPv4 ${L3.client} → ${L3.remote} seen in this attempt: 0` }, action: "COUNTERS + ROUTE", reason: "R1 is healthy and ready — nothing was ever sent to it to route.", key: `R1 for ${L3.remote}`, result: "ARP heard 3 · IPv4 0 · route OK" }), "inc-r1-stats", [{ kind: "observation", text: `R1: ${s.r1Stats.arpForOthers[L3.remote] ?? 0} ARP requests for ${L3.remote}, 0 IPv4 packets to it; route ${rtText(rtLookup(R1_ROUTES, L3.remote)!)}`, source: "R1", rung: "Routing / forwarding" }, { kind: "ruled-out", text: "R1 routing (route present; no packet ever arrived to route)" }]), events: [ev("STEP_ENTERED", "inc-r1-stats", "R1")] }),
  },
  {
    id: "q-which-route",
    label: "Question: which route wins?",
    narrative: `CLIENT's table: 10.10.0.0/16 connected; 0.0.0.0/0 via ${L3.gw}. Destination ${L3.remote}.`,
    question: {
      prompt: `Which route wins on CLIENT for ${L3.remote}?`,
      options: [
        { id: "connected", label: "10.10.0.0/16 connected — both routes match, and /16 is longer than /0" },
        { id: "default", label: "0.0.0.0/0 — the default route always wins for remote hosts" },
        { id: "neither", label: "Neither matches" },
        { id: "first", label: "Whichever route was configured first" },
      ],
      correctOptionId: "connected",
      explanation: "Longest-prefix match: 10.10.20.20 is inside 10.10.0.0/16, and 16 > 0.",
    },
  },
  {
    id: "q-default",
    label: "Question: the default route",
    narrative: "The default route via 10.10.10.1 is present and correct.",
    question: {
      prompt: "Why doesn't the default route save this?",
      options: [
        { id: "never", label: "It is never selected: the more specific connected /16 matches first, so the gateway is not consulted" },
        { id: "broken", label: "The default route is broken" },
        { id: "down", label: "The gateway is down" },
        { id: "arp", label: "Default routes cannot be used for ICMP" },
      ],
      correctOptionId: "never",
      explanation: "A default gateway is used only for destinations the host does not consider on-link. The default route is fine — it just never gets a chance.",
    },
  },
  {
    id: "inc-remote-ok",
    label: "REMOTE-SERVER is healthy",
    narrative: `From R2, ping ${L3.remote}: 5/5 (source ${L3.r2Rem}). The server, its segment and R2's route are all fine.`,
    run: (s) => {
      const p = pingPkt("inc-remote-ok-pkt", "R2", "REMOTE-SERVER", { kind: "echo-request", seq: 1, src: L3.r2Rem, dst: L3.remote, ttl: 64, ethSrc: L3_MAC.R2_REM, ethDst: L3_MAC.REMOTE });
      const h = hop("inc-remote-ok", "R2", { active: "tx", egress: "ge-0/0/2", details: { lookup: `${L3.remote} → ${rtText(rtLookup(R2_ROUTES, L3.remote)!)}`, tx: `echo from ${L3.r2Rem}` }, lookupType: "R2 FIB", key: L3.remote, result: "connected ge-0/0/2 · 5/5", action: "TEST PING", reason: "Testing from the far side proves the destination and its segment are healthy.", input: "ping", output: "5/5", after: p });
      return { state: withNotes(ping({ ...idle(s), hops: [...s.hops, h], packet: p }, "from R2", L3.remote, 5), "inc-remote-ok", [{ kind: "observation", text: `R2 → ${L3.remote}: 5/5`, source: "R2 test ping" }, { kind: "ruled-out", text: "REMOTE-SERVER / its segment / R2 routing" }]), events: [ev("PACKET_SENT", "inc-remote-ok", "R2 ping")] };
    },
    packet: pkt,
  },
  {
    id: "q-router-route",
    label: "Question: fix it on a router?",
    narrative: "Someone proposes adding or changing routes on R1.",
    question: {
      prompt: "Why does changing a router's routes not solve the root cause?",
      options: [
        { id: "client", label: "The decision that fails is made on CLIENT, before any packet reaches a router; routers never see the traffic" },
        { id: "slow", label: "Router changes take too long to converge" },
        { id: "works", label: "It would solve it" },
        { id: "static", label: "Routers cannot have static routes" },
      ],
      correctOptionId: "client",
      explanation: "(Proxy ARP on R1 could mask the symptom by answering for 10.10.20.20 — but that hides a host misconfiguration instead of fixing it.)",
    },
  },
  {
    id: "inc-client-config",
    label: "Compare with the IP plan",
    narrative: `CLIENT eth0: ${L3.client}, mask ${maskOf(FAULT_PREFIX)} (/${FAULT_PREFIX}). IP plan for 10.10.10.0/24: mask ${maskOf(GOOD_PREFIX)} (/${GOOD_PREFIX}), gateway ${L3.gw}. The address and gateway match the plan; the prefix length does not.`,
    run: (s) => ({ state: withNotes(evidence(idle(s), "inc-client-config", "CLIENT", { active: "route", details: { route: `configured ${L3.client}/${s.clientPrefix} (${maskOf(s.clientPrefix)}) · plan /${GOOD_PREFIX} (${maskOf(GOOD_PREFIX)}) · gateway ${L3.gw} (matches)` }, action: "CONFIG vs PLAN", reason: "Compare the device's actual configuration with the intended design — field by field.", key: "CLIENT eth0 config", result: `/${s.clientPrefix} vs plan /${GOOD_PREFIX}` }), "inc-client-config", [{ kind: "observation", text: `CLIENT configured /${s.clientPrefix} (${maskOf(s.clientPrefix)}); IP plan /${GOOD_PREFIX}`, source: "CLIENT config vs IP plan", rung: "IP addressing" }, { kind: "hypothesis", text: `CLIENT's /${FAULT_PREFIX} makes ${L3.remote} look on-link` }]), events: [ev("STEP_ENTERED", "inc-client-config", "config")] }),
  },
  {
    id: "q-mask-arp",
    label: "Question: mask and ARP",
    narrative: "The address is right; only the prefix length changed.",
    question: {
      prompt: "Why does a wrong mask change ARP behavior?",
      options: [
        { id: "onlink", label: "The mask defines which destinations are on-link; on-link destinations are ARPed for directly, off-link ones via the gateway" },
        { id: "arp-mask", label: "ARP packets carry the mask" },
        { id: "broadcast", label: "The mask changes the broadcast MAC address" },
        { id: "none", label: "It doesn't — ARP ignores masks" },
      ],
      correctOptionId: "onlink",
      explanation: `With /${FAULT_PREFIX}, everything in 10.10.0.0/16 looks like a neighbor. ${L3.server} (10.20.x.x) is outside it — which is why that server still works.`,
    },
  },
  {
    id: "diagnostic-layers",
    label: "Walk the evidence ladder",
    narrative: "The lowest failing rung is the one to fix.",
  },
  {
    id: "predict-cause",
    label: "Predict: root cause",
    narrative: "Put it together.",
    question: {
      prompt: "What is the root cause?",
      options: [
        { id: "mask", label: `CLIENT's prefix length is /${FAULT_PREFIX} instead of /${GOOD_PREFIX}, so ${L3.remote} is treated as on-link` },
        { id: "gw", label: "CLIENT's default gateway is wrong" },
        { id: "r1", label: "R1 lacks a route to 10.10.20.0/24" },
        { id: "server", label: "REMOTE-SERVER is down" },
      ],
      correctOptionId: "mask",
      explanation: "The gateway works (SERVER reachable), R1's route exists, and REMOTE-SERVER answers R2. Only CLIENT's own on-link decision is wrong.",
    },
    run: (s) => ({ state: withNotes(idle(s), "predict-cause", [{ kind: "root-cause", text: `CLIENT configured /${FAULT_PREFIX}; connected 10.10.0.0/16 overrides the default route for ${L3.remote}`, source: "CLIENT table + config" }]), events: [] }),
  },
  // ---- Repair ---
  {
    id: "repair-challenge",
    label: "Repair the host",
    narrative: "Choose the change that fixes the cause you identified.",
    action: (s, payload) => ({ state: applyL3Repair(s, (payload as { choice: string }).choice), events: [ev("STEP_ENTERED", "repair-challenge", `Repair attempt: ${(payload as { choice: string }).choice}`)] }),
    requiresState: (s) => s.repaired,
  },
  // ---- Verify ---
  {
    id: "ver-table",
    label: "Verify: routing table",
    narrative: `CLIENT: ${clientRoutes(GOOD_PREFIX).map(routeText).join("; ")}. ${L3.remote} now matches only the default route → remote → via ${L3.gw}.`,
    run: (s) => ({ state: { ...idle(s), hops: [...s.hops, clientDecides(s, "ver-table", L3.remote)] }, events: [ev("STEP_ENTERED", "ver-table", "table")] }),
  },
  {
    id: "ver-arp-gw",
    label: "Verify: ARP for the gateway",
    narrative: `Re-addressing flushed CLIENT's neighbor cache, so it broadcasts: who has ${L3.gw}? — the gateway, not ${L3.remote}.`,
    run: (s) => {
      const p = arpFor(L3.gw)("CLIENT", "SW1", "ver-arp-gw-pkt");
      return { state: { ...idle(s), hops: [...s.hops, clientDecides(s, "ver-arp-gw", L3.remote, p)], packet: p }, events: [ev("PACKET_SENT", "ver-arp-gw", "ARP gw")] };
    },
    packet: pkt,
  },
  {
    id: "ver-arp-reply",
    label: "Verify: gateway answers",
    narrative: `R1 replies: ${L3.gw} is at ${L3_MAC.R1_LAN}.`,
    run: (s) => {
      const p = gwReply("ver-arp-reply-pkt");
      return { state: { ...idle(s), hops: [...s.hops, hostRx("ver-arp-reply", "CLIENT", p, `cache ${L3.gw} → ${L3_MAC.R1_LAN}`, "Gateway resolved.")], packet: p, clientArp: { [L3.gw]: L3_MAC.R1_LAN } }, events: [ev("PACKET_SENT", "ver-arp-reply", "ARP reply")] };
    },
    packet: pkt,
  },
  {
    id: "ver-echo",
    label: "Verify: gateway MAC, remote IP",
    narrative: `The echo leaves CLIENT: Ethernet destination ${L3_MAC.R1_LAN} (R1), IPv4 destination ${L3.remote}, TTL 64. This is the packet the broken configuration never produced.`,
    run: (s) => {
      const f = toRemote(7);
      const p = f.c("ver-echo-pkt");
      return { state: { ...idle(s), hops: [...s.hops, clientDecides(s, "ver-echo", L3.remote, p), sw1("ver-echo", p, "ge-0/0/24")], packet: p, r1Stats: { ...s.r1Stats, ipFromClient: { ...s.r1Stats.ipFromClient, [L3.remote]: (s.r1Stats.ipFromClient[L3.remote] ?? 0) + 1 } } }, events: [ev("PACKET_SENT", "ver-echo", "echo")] };
    },
    packet: pkt,
  },
  {
    id: "ver-r1",
    label: "Verify: R1 routes (TTL 63)",
    narrative: "R1 now receives an IPv4 packet for 10.10.20.20 and routes it to R2. TTL 64 → 63.",
    run: (s) => {
      const f = toRemote(7);
      const out = f.r1("ver-r1-pkt");
      return { state: { ...idle(s), hops: [...s.hops, routerFwd("ver-r1", "R1", f.sw("in"), out, "ge-0/0/0")], packet: out }, events: [ev("PACKET_SENT", "ver-r1", "R1")] };
    },
    packet: pkt,
  },
  {
    id: "ver-r2",
    label: "Verify: R2 delivers (TTL 62)",
    narrative: "R2 delivers to REMOTE-SERVER on ge-0/0/2. TTL 63 → 62.",
    run: (s) => {
      const f = toRemote(7);
      const out = f.r2("ver-r2-pkt");
      return { state: { ...idle(s), hops: [...s.hops, routerFwd("ver-r2", "R2", f.r1("in"), out, "ge-0/0/0"), hostRx("ver-r2", "REMOTE-SERVER", out, "echo reply", "Answer.")], packet: out }, events: [ev("PACKET_SENT", "ver-r2", "R2")] };
    },
    packet: pkt,
  },
  {
    id: "ver-reply",
    label: "Verify: reply and 5/5",
    narrative: `The reply returns with TTL 62. Ping ${L3.remote}: 5/5; ${L3.server}: still 5/5.`,
    run: (s) => {
      const p = toRemote(7).repCl("ver-reply-pkt");
      return { state: withNotes(ping(ping({ ...idle(s), hops: [...s.hops, hostRx("ver-reply", "CLIENT", p, "echo reply received", "Service restored.")], packet: p }, "after repair", L3.remote, 5), "after repair", L3.server, 5), "ver-reply", [{ kind: "verified", text: `CLIENT /${GOOD_PREFIX}: ARP for ${L3.gw}, echo to R1's MAC with IPv4 dst ${L3.remote}, routed by R1 and R2; ${L3.remote} 5/5, ${L3.server} 5/5`, source: "CLIENT + ping" }]), events: [ev("PACKET_SENT", "ver-reply", "reply")] };
    },
    packet: pkt,
    question: {
      prompt: "What packet proves the repaired behavior?",
      options: [
        { id: "echo", label: `An IPv4 echo leaving CLIENT with Ethernet destination = R1's MAC and IPv4 destination = ${L3.remote}, arriving at R1 and answered` },
        { id: "arp-remote", label: `An ARP reply from ${L3.remote}` },
        { id: "config", label: "The new mask in CLIENT's configuration" },
        { id: "server", label: `A successful ping to ${L3.server}` },
      ],
      correctOptionId: "echo",
      explanation: `${L3.server} worked all along, and a configuration line is not traffic. The proof is the frame the broken host never produced — to the gateway's MAC, for the remote IP — and the reply that follows.`,
    },
  },
  {
    id: "q-headers",
    label: "Question: what stayed the same?",
    narrative: `Broken: CLIENT sent ARP for ${L3.remote} and no IPv4 packet. Repaired: ARP for ${L3.gw}, then the IPv4 packet.`,
    question: {
      prompt: "Comparing CLIENT's broken and repaired attempts, what stayed unchanged?",
      options: [
        { id: "ips", label: `Source MAC ${L3_MAC.CLIENT}, source IP ${L3.client} and the target IPv4 destination ${L3.remote} — what changed is the next hop (and so the ARP target and the Ethernet destination)` },
        { id: "arp", label: "The ARP target IP" },
        { id: "ethdst", label: "The Ethernet destination MAC" },
        { id: "ttl", label: "Nothing — every field changed" },
      ],
      correctOptionId: "ips",
      explanation: "The application still wants 10.10.20.20. Only CLIENT's choice of next hop changed: from 10.10.20.20 itself (unreachable on this segment) to the gateway 10.10.10.1.",
    },
  },
  // ---- Complete ---
  {
    id: "operations",
    label: "On real hosts and routers",
    narrative: "Linux: ip addr show, ip route get 10.10.20.20 (shows the chosen route and next hop), ip neigh (ARP cache: INCOMPLETE/FAILED entries). Windows: ipconfig, route print, arp -a. Routers — Juniper-style: show route 10.10.20.20, show arp; Cisco-style: show ip route 10.10.20.20, show ip arp. Capture ARP with 'arp' as the filter: a host ARPing for a remote address is the fingerprint of a wrong prefix.",
  },
  {
    id: "complete",
    label: "Lesson complete",
    narrative: "Connected routes from address + prefix, longest-prefix match on the host, ARP for the next hop, gateway MAC with remote IP, TTL decreasing only at routers — and a wrong mask that made a remote server look local, found on the client and proven fixed by the packet it never used to send.",
  },
];
