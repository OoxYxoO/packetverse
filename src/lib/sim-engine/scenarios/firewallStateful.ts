import type { PacketVisual, PVEvent, PVEventType, ScenarioStep } from "../types";
import type { PacketMutation, ProcessingStage } from "@/components/network3d/types";
import type { FundHop } from "@/components/lesson/fundamentalsTrace";
import { hex4 } from "./fundamentalsPackets";
import { TCP_WINDOW, flagsName, inPrefix, ip4Checksum, ip4Length, isTcp, tcpChecksum, tcpField, tcpIp, tcpLength, tcpPacket, tcpStack, tupleText, type TcpFlag, type TcpSeg, type TcpWire } from "./enterpriseEdgePackets";

/**
 * Stateful Firewall: Policy, Sessions & Source NAT — CLIENT — FW1 — ISP — WEB-SERVER.
 *
 * Vendor-neutral model (no product's pipeline is presented as universal):
 * - FW1 is a Layer-3 router first: connected trust/untrust networks and a default route. A route decides the egress
 *   interface; policy never replaces routing and routing never replaces policy.
 * - Interfaces belong to zones (trust / untrust). A security policy matches from-zone, to-zone, source, destination
 *   and service; anything no rule allows hits the implicit default deny.
 * - The first packet of a flow (a TCP SYN) misses the session table, is routed, checked against policy, source-NATed
 *   and creates a session. Later packets in either direction match that session: return traffic is allowed because
 *   it belongs to the session (after reverse translation), not because of a broad inbound rule.
 * - Source NAT (PAT) rewrites only the source address and port. The IPv4 header checksum and the TCP checksum (whose
 *   pseudo-header includes the addresses) are recomputed from the rewritten fields — the old values do not survive.
 * - TCP state is tracked conntrack-style: SYN_SENT → SYN_RECV → ESTABLISHED.
 * - The processing ORDER shown (session → route → policy → NAT) is this lesson's model. Vendors differ, e.g. in
 *   whether destination NAT is applied before policy lookup and whether policy matches pre- or post-NAT addresses.
 * Incident: SNAT-OUT is edited to translate to 198.51.100.99 — an address outside FW1's /30. Policy still allows the
 * flow, but replies to .99 have no route back to FW1, so the handshake never completes.
 */

export type FwDevice = "CLIENT" | "FW1" | "ISP" | "WEB-SERVER";
export const FW_DEVICES: FwDevice[] = ["CLIENT", "FW1", "ISP", "WEB-SERVER"];
export const FW = { client: "10.10.10.10", trust: "10.10.10.1", untrust: "198.51.100.2", ispFw: "198.51.100.1", ispWeb: "203.0.113.1", web: "203.0.113.80", badNat: "198.51.100.99" } as const;
export const FW_MAC = { CLIENT: "00:00:5E:00:53:10", FW_TRUST: "00:00:5E:00:53:01", FW_UNTRUST: "00:00:5E:00:53:02", ISP_FW: "00:00:5E:00:53:A1", ISP_WEB: "00:00:5E:00:53:A2", WEB: "00:00:5E:00:53:80" } as const;
export const WEB_PORT = 443;
export const NAT_PORT = 40001;
export const INITIAL_TTL = 64;
export const MSS = 1460;
export const CLIENT_PORT = { healthy: 51514, incident: 51515, verify: 51516 } as const;
export const ISN = { client: { healthy: 1000, incident: 2000, verify: 3000 }, server: { healthy: 5000, incident: 6000, verify: 7000 } } as const;
/** The unsolicited inbound connection attempt: a NEW SYN, not a reply. */
export const SCAN = { sport: 52000, dport: 8443, seq: 9000 } as const;

export type Zone = "trust" | "untrust";
export interface FwIface {
  name: string;
  zone?: Zone;
  addr: string;
  len: number;
  mac: string;
  peer: FwDevice;
  peerIface: string;
}
export const FW_IFACES: Record<"FW1" | "ISP", FwIface[]> = {
  FW1: [
    { name: "ge-0/0/0", zone: "trust", addr: FW.trust, len: 24, mac: FW_MAC.FW_TRUST, peer: "CLIENT", peerIface: "eth0" },
    { name: "ge-0/0/1", zone: "untrust", addr: FW.untrust, len: 30, mac: FW_MAC.FW_UNTRUST, peer: "ISP", peerIface: "ge-0/0/0" },
  ],
  ISP: [
    { name: "ge-0/0/0", addr: FW.ispFw, len: 30, mac: FW_MAC.ISP_FW, peer: "FW1", peerIface: "ge-0/0/1" },
    { name: "ge-0/0/1", addr: FW.ispWeb, len: 24, mac: FW_MAC.ISP_WEB, peer: "WEB-SERVER", peerIface: "eth0" },
  ],
};
export const zoneOf = (iface: string): Zone | undefined => FW_IFACES.FW1.find((i) => i.name === iface)?.zone;

// ---------------------------------------------------------------------------------------------------------------
// Routing (FW1 and ISP)
// ---------------------------------------------------------------------------------------------------------------
export interface FwRoute {
  prefix: string;
  len: number;
  kind: "connected" | "static" | "local";
  iface?: string;
  nextHop?: string;
}
export const FW1_ROUTES: FwRoute[] = [
  { prefix: "0.0.0.0", len: 0, kind: "static", nextHop: FW.ispFw, iface: "ge-0/0/1" },
  { prefix: "10.10.10.0", len: 24, kind: "connected", iface: "ge-0/0/0" },
  { prefix: "198.51.100.0", len: 30, kind: "connected", iface: "ge-0/0/1" },
  { prefix: FW.untrust, len: 32, kind: "local" },
];
/** The provider routes only what it has assigned: the customer /30 and its own server LAN. */
export const ISP_ROUTES: FwRoute[] = [
  { prefix: "198.51.100.0", len: 30, kind: "connected", iface: "ge-0/0/0" },
  { prefix: "203.0.113.0", len: 24, kind: "connected", iface: "ge-0/0/1" },
];
export const routeText = (r: FwRoute) => `${r.prefix}/${r.len} ${r.kind === "local" ? "local (FW1's own address)" : r.kind === "connected" ? `connected ${r.iface}` : `via ${r.nextHop} (${r.iface})`}`;
export const lookupRoute = (table: FwRoute[], dst: string) => table.filter((r) => inPrefix(dst, r.prefix, r.len)).sort((a, b) => b.len - a.len)[0];

// ---------------------------------------------------------------------------------------------------------------
// Security policy and NAT
// ---------------------------------------------------------------------------------------------------------------
export interface FwPolicy {
  name: string;
  from: string;
  to: string;
  source: string;
  destination: string;
  service: string;
  action: "allow" | "deny";
  implicit?: boolean;
}
export const FW_POLICIES: FwPolicy[] = [
  { name: "ALLOW-WEB", from: "trust", to: "untrust", source: "10.10.10.0/24", destination: "203.0.113.80/32", service: "TCP/443", action: "allow" },
  { name: "default-deny", from: "any", to: "any", source: "any", destination: "any", service: "any", action: "deny", implicit: true },
];
const cidrHas = (cidr: string, ip: string) => cidr === "any" || inPrefix(ip, cidr.split("/")[0], Number(cidr.split("/")[1]));
/** First rule that matches; the implicit default deny always matches last. */
export function matchPolicy(from: string, to: string, src: string, dst: string, dport: number): FwPolicy {
  return FW_POLICIES.find((p) => (p.from === "any" || p.from === from) && (p.to === "any" || p.to === to) && cidrHas(p.source, src) && cidrHas(p.destination, dst) && (p.service === "any" || p.service === `TCP/${dport}`))!;
}
export const policyText = (p: FwPolicy) => (p.implicit ? "implicit default deny (matches anything no rule allowed)" : `${p.name}: ${p.from} → ${p.to} · ${p.source} → ${p.destination} · ${p.service} · ${p.action.toUpperCase()}`);
export const NAT_RULE = { name: "SNAT-OUT", from: "trust", to: "untrust", source: "10.10.10.0/24", ports: "PAT, first free port from 40001" } as const;

// ---------------------------------------------------------------------------------------------------------------
// TCP segments and frames — the generic TCP/IPv4 builders live in enterpriseEdgePackets; this lesson only names its
// topology devices on top of them.
// ---------------------------------------------------------------------------------------------------------------
export { flagsName, isTcp, tcpChecksum, tcpField, tcpLength, tcpStack, tupleText, type TcpFlag, type TcpSeg };
export const WINDOW = TCP_WINDOW;
export type Wire = TcpWire;
export const ipOf = tcpIp;
export const tcpFrame = (id: string, from: FwDevice, to: FwDevice, ethSrc: string, ethDst: string, w: Wire): PacketVisual => tcpPacket(id, from, to, ethSrc, ethDst, w);

// ---------------------------------------------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------------------------------------------
export type TcpTrack = "SYN_SENT" | "SYN_RECV" | "ESTABLISHED";
export interface FwSession {
  id: number;
  state: TcpTrack;
  ingressZone: Zone;
  egressZone: Zone;
  protocol: "TCP";
  origSrc: string;
  origSport: number;
  origDst: string;
  dport: number;
  xlSrc: string;
  xlSport: number;
  policy: string;
  nat: string;
  pktsOut: number;
  pktsIn: number;
  bytesOut: number;
  bytesIn: number;
}
export interface DenyLog {
  src: string;
  sport: number;
  dst: string;
  dport: number;
  from: Zone;
  reason: string;
}
export type HostTcp = "CLOSED" | "LISTEN" | "SYN_SENT" | "SYN_RECEIVED" | "ESTABLISHED";
/** FW1's latest decision, for the panel and inspectors (never carried in the packet). */
export interface FwCheck {
  packet: string;
  session: string;
  route: string;
  policy: string;
  nat: string;
  verdict: "FORWARD" | "DROP";
}
export interface FwState {
  hops: FundHop[];
  packet?: PacketVisual;
  natAddr: string;
  sessions: FwSession[];
  nextSessionId: number;
  denyLog: DenyLog[];
  client: { state: HostTcp; sport?: number };
  web: { state: HostTcp; peer?: string; replyTo?: string };
  check?: FwCheck;
  decision?: { device: FwDevice; text: string };
  closedNote?: string;
  faultActive: boolean;
  repairAttempt?: { choice: string; correct: boolean };
  repaired: boolean;
}
export const createFwState = (): FwState => ({ hops: [], natAddr: FW.untrust, sessions: [], nextSessionId: 1001, denyLog: [], client: { state: "CLOSED" }, web: { state: "LISTEN" }, faultActive: false, repaired: false });
export const latestSession = (s: FwState) => s.sessions.at(-1);

// ---------------------------------------------------------------------------------------------------------------
// Stages and hop helpers
// ---------------------------------------------------------------------------------------------------------------
export const FW_STAGES: ProcessingStage[] = [
  { id: "rx", label: "Receive · ingress interface → zone" },
  { id: "session", label: "Session lookup (5-tuple, either direction)" },
  { id: "route", label: "Route lookup → egress interface / zone" },
  { id: "policy", label: "Security policy: zones · addresses · service" },
  { id: "nat", label: "NAT: translate or reverse-translate" },
  { id: "state", label: "Create / update session · TCP state" },
  { id: "tx", label: "TTL − 1 · recompute checksums · transmit" },
];
export const ISP_STAGES: ProcessingStage[] = [
  { id: "rx", label: "Receive frame · dst MAC is mine" },
  { id: "lookup", label: "Longest-prefix route lookup" },
  { id: "ttl", label: "TTL − 1 · recompute IPv4 checksum" },
  { id: "tx", label: "New Ethernet frame for the next link" },
];
export const CLIENT_STAGES: ProcessingStage[] = [
  { id: "socket", label: "TCP socket: pick source port · build segment" },
  { id: "gw", label: "203.0.113.80 is off-link → default gateway 10.10.10.1" },
  { id: "tx", label: "Transmit / receive on eth0" },
  { id: "tcp", label: "TCP state machine" },
];
export const WEB_STAGES: ProcessingStage[] = [
  { id: "rx", label: "Receive · dst 203.0.113.80 is mine" },
  { id: "listen", label: "TCP/443 listener: match the segment" },
  { id: "tcp", label: "TCP state machine · reply to the source it saw" },
  { id: "tx", label: "Transmit via default gateway 203.0.113.1" },
];
const withDetail = (base: ProcessingStage[], d: Partial<Record<string, string>>): ProcessingStage[] => base.map((x) => (d[x.id] ? { ...x, detail: d[x.id] } : x));
const ev = (type: PVEventType, stepId: string, message: string): PVEvent => ({ type, stepId, timestamp: Date.now(), message });
const idle = (s: FwState): FwState => ({ ...s, packet: undefined, decision: undefined });
const wireText = (w: Wire) => `${flagsName(w.seg)} ${tupleText(w.src, w.seg.sport)} → ${tupleText(w.dst, w.seg.dport)}`;
const csums = (w: Wire) => `IPv4 csum ${hex4(ip4Checksum(ipOf(w)))} · TCP csum ${hex4(tcpChecksum(w.seg, w.src, w.dst))}`;

/** Healthy / incident / verify flows share one shape: the client's segment and the server's reply. */
export interface Flow {
  sport: number;
  cIsn: number;
  sIsn: number;
  ipBase: number;
}
export const FLOWS: Record<"healthy" | "incident" | "verify", Flow> = {
  healthy: { sport: CLIENT_PORT.healthy, cIsn: ISN.client.healthy, sIsn: ISN.server.healthy, ipBase: 0x1a01 },
  incident: { sport: CLIENT_PORT.incident, cIsn: ISN.client.incident, sIsn: ISN.server.incident, ipBase: 0x1b01 },
  verify: { sport: CLIENT_PORT.verify, cIsn: ISN.client.verify, sIsn: ISN.server.verify, ipBase: 0x1c01 },
};
const SERVER_IP_BASE = 0x2b01;
export const segs = (f: Flow) => ({
  syn: { sport: f.sport, dport: WEB_PORT, seq: f.cIsn, ack: 0, flags: ["SYN"] as TcpFlag[], mss: MSS },
  /** The server replies to whatever source port it SAW — the translated one. */
  synAck: (natPort: number): TcpSeg => ({ sport: WEB_PORT, dport: natPort, seq: f.sIsn, ack: f.cIsn + 1, flags: ["SYN", "ACK"], mss: MSS }),
  ack: { sport: f.sport, dport: WEB_PORT, seq: f.cIsn + 1, ack: f.sIsn + 1, flags: ["ACK"] as TcpFlag[] },
});

function hostHop(stepId: string, device: "CLIENT" | "WEB-SERVER", o: { active: string; details: Partial<Record<string, string>>; action: string; reason: string; key: string; result: string; input: string; output: string; next?: FwDevice; ingress?: string; egress?: string; before?: PacketVisual; after?: PacketVisual }): FundHop {
  return {
    stepId,
    device,
    stages: withDetail(device === "CLIENT" ? CLIENT_STAGES : WEB_STAGES, o.details),
    activeStageId: o.active,
    ingressInterfaceId: o.ingress,
    egressInterfaceId: o.egress,
    lookupType: device === "CLIENT" ? "CLIENT TCP socket" : "WEB-SERVER TCP/443 listener",
    lookupKey: o.key,
    lookupResult: o.result,
    action: o.action,
    reason: o.reason,
    input: o.input,
    output: o.output,
    nextHopId: o.next,
    before: o.before ? tcpStack(o.before) : undefined,
    after: o.after ? tcpStack(o.after) : undefined,
  };
}

/** ISP routes one frame (or drops it for lack of a route). */
function ispHop(stepId: string, inFrame: PacketVisual, w: Wire, ingress: string): { hop: FundHop; out?: { w: Wire; egress: string; next: FwDevice } } {
  const r = lookupRoute(ISP_ROUTES, w.dst);
  if (!r) {
    return {
      hop: {
        stepId,
        device: "ISP",
        stages: withDetail(ISP_STAGES, { rx: `on ${ingress}`, lookup: `${w.dst}: no matching route (only ${ISP_ROUTES.map((x) => `${x.prefix}/${x.len}`).join(", ")})` }),
        activeStageId: "lookup",
        ingressInterfaceId: ingress,
        lookupType: "ISP routing table",
        lookupKey: `destination ${w.dst}`,
        lookupResult: "no route",
        action: "DROP · NO ROUTE",
        reason: `${w.dst} is not in any prefix the ISP routes. The customer /30 is 198.51.100.0/30 (FW1 is .2); .99 is outside it, so the provider has nowhere to send this reply. A real router would usually return ICMP Destination Unreachable to the sender — not drawn here.`,
        input: wireText(w),
        output: "dropped",
        before: tcpStack(inFrame),
      },
    };
  }
  const egress = r.iface!;
  const nw: Wire = { ...w, ttl: w.ttl - 1 };
  const peer = FW_IFACES.ISP.find((i) => i.name === egress)!;
  return {
    hop: {
      stepId,
      device: "ISP",
      stages: withDetail(ISP_STAGES, { rx: `on ${ingress}`, lookup: `${w.dst} → ${routeText(r)}`, ttl: `TTL ${w.ttl} → ${nw.ttl} · IPv4 csum ${hex4(ip4Checksum(ipOf(w)))} → ${hex4(ip4Checksum(ipOf(nw)))}`, tx: `out ${egress} to ${peer.peer}` }),
      activeStageId: "tx",
      ingressInterfaceId: ingress,
      egressInterfaceId: egress,
      lookupType: "ISP routing table",
      lookupKey: `destination ${w.dst}`,
      lookupResult: routeText(r),
      action: "ROUTE",
      reason: `Ordinary IP routing: ${w.dst} is inside ${r.prefix}/${r.len}, connected on ${egress}. The ISP neither knows nor cares about FW1's sessions or NAT.`,
      input: wireText(w),
      output: `${wireText(nw)} · TTL ${nw.ttl}`,
      nextHopId: peer.peer,
      before: tcpStack(inFrame),
      mutations: [{ type: "TTL_CHANGE", detail: `${w.ttl} → ${nw.ttl}` }, { type: "MAC_CHANGE", detail: "new Ethernet header for the next link" }],
    },
    out: { w: nw, egress, next: peer.peer },
  };
}
const ispFrame = (id: string, out: { w: Wire; egress: string; next: FwDevice }) => {
  const i = FW_IFACES.ISP.find((x) => x.name === out.egress)!;
  const dstMac = out.next === "FW1" ? FW_MAC.FW_UNTRUST : FW_MAC.WEB;
  return tcpFrame(id, "ISP", out.next, i.mac, dstMac, out.w);
};

/** FW1: first packet of a new outbound flow — session miss, route, policy, source NAT, session created, forwarded. */
export function outboundNew(s: FwState, inW: Wire) {
  const route = lookupRoute(FW1_ROUTES, inW.dst);
  const egress = route.iface!;
  const toZone = zoneOf(egress)!;
  const pol = matchPolicy("trust", toZone, inW.src, inW.dst, inW.seg.dport);
  const natPort = NAT_PORT;
  const out: Wire = { ...inW, src: s.natAddr, ttl: inW.ttl - 1, seg: { ...inW.seg, sport: natPort } };
  return { route, egress, toZone, pol, natPort, out };
}

/** Frames CLIENT→FW1 and FW1→ISP for a wire. */
const clientFrame = (id: string, w: Wire) => tcpFrame(id, "CLIENT", "FW1", FW_MAC.CLIENT, FW_MAC.FW_TRUST, w);
const fwOutFrame = (id: string, w: Wire) => tcpFrame(id, "FW1", "ISP", FW_MAC.FW_UNTRUST, FW_MAC.ISP_FW, w);
const fwInFrame = (id: string, w: Wire) => tcpFrame(id, "FW1", "CLIENT", FW_MAC.FW_TRUST, FW_MAC.CLIENT, w);
const webFrame = (id: string, w: Wire) => tcpFrame(id, "WEB-SERVER", "ISP", FW_MAC.WEB, FW_MAC.ISP_WEB, w);

export const clientSynWire = (f: Flow): Wire => ({ src: FW.client, dst: FW.web, ttl: INITIAL_TTL, ipId: f.ipBase, seg: segs(f).syn });
export const clientAckWire = (f: Flow): Wire => ({ src: FW.client, dst: FW.web, ttl: INITIAL_TTL, ipId: f.ipBase + 1, seg: segs(f).ack });
export const serverSynAckWire = (f: Flow, replyTo: string, natPort: number): Wire => ({ src: FW.web, dst: replyTo, ttl: INITIAL_TTL, ipId: SERVER_IP_BASE + (f.cIsn / 1000 - 1), seg: segs(f).synAck(natPort) });

function clientSendHop(stepId: string, frame: PacketVisual, w: Wire, kind: "SYN" | "ACK"): FundHop {
  return hostHop(stepId, "CLIENT", {
    active: "tx",
    details: { socket: `source port ${w.seg.sport} · ${kind} seq ${w.seg.seq}${kind === "ACK" ? ` ack ${w.seg.ack}` : ""}`, gw: `next hop ${FW.trust} (FW1 ge-0/0/0)`, tx: `eth0 → FW1 · ${csums(w)}`, tcp: kind === "SYN" ? "CLOSED → SYN_SENT" : "SYN_SENT → ESTABLISHED" },
    action: kind === "SYN" ? "SEND SYN" : "SEND ACK",
    reason: kind === "SYN" ? `The client opens a TCP connection to ${tupleText(FW.web, WEB_PORT)} from its own address ${FW.client}. It has no idea NAT exists — it addresses the real server and hands the frame to its default gateway.` : "The SYN-ACK acknowledged the client's ISN, so the client completes the handshake with an ACK and considers the connection ESTABLISHED.",
    key: `${tupleText(FW.client, w.seg.sport)} → ${tupleText(FW.web, WEB_PORT)}`,
    result: kind === "SYN" ? "new connection · SYN_SENT" : "handshake complete · ESTABLISHED",
    input: kind === "SYN" ? "(originated here)" : "SYN-ACK received",
    output: wireText(w),
    next: "FW1",
    egress: "eth0",
    after: frame,
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Repair
// ---------------------------------------------------------------------------------------------------------------
export const FW_REPAIR_OPTIONS = [
  { id: "restore-nat", label: "Change SNAT-OUT's translated source back to 198.51.100.2 (FW1's untrust address)" },
  { id: "allow-any", label: "Add an allow-any rule from trust to untrust" },
  { id: "clear-arp", label: "Clear FW1's ARP cache" },
  { id: "raise-ttl", label: "Increase the client's IPv4 TTL" },
  { id: "port-80", label: "Move WEB-SERVER to TCP port 80" },
] as const;
export const FW_REPAIR_CORRECT = "restore-nat";
export function applyFwRepair(s: FwState, choice: string): FwState {
  const correct = choice === FW_REPAIR_CORRECT;
  if (!correct) return { ...s, repairAttempt: { choice, correct } };
  // Changing a NAT rule does not rewrite existing sessions: the half-open session built on the bad translation is
  // cleared so the retry builds a fresh one.
  return { ...idle(s), natAddr: FW.untrust, sessions: s.sessions.filter((x) => x.xlSrc === FW.untrust), repairAttempt: { choice, correct }, repaired: true, faultActive: false, check: undefined, client: { state: "CLOSED" }, web: { state: "LISTEN" }, decision: { device: "FW1", text: "SNAT-OUT → 198.51.100.2 · stale half-open session cleared" } };
}

// ---------------------------------------------------------------------------------------------------------------
// Step builders shared by the healthy walk, the incident and the verification
// ---------------------------------------------------------------------------------------------------------------
function stepClientSyn(s: FwState, stepId: string, f: Flow): FwState {
  const w = clientSynWire(f);
  const frame = clientFrame(`${stepId}-syn`, w);
  return { ...idle(s), hops: [...s.hops, clientSendHop(stepId, frame, w, "SYN")], packet: frame, client: { state: "SYN_SENT", sport: f.sport }, decision: { device: "CLIENT", text: "CLIENT → gateway FW1" } };
}

/** FW1 forwards the first packet: creates the session with its NAT mapping. `phase` picks the active stage text. */
function stepFwOutboundNew(s: FwState, stepId: string, f: Flow, detailAll: boolean): FwState {
  const inW = clientSynWire(f);
  const inFrame = clientFrame(`${stepId}-in`, inW);
  const x = outboundNew(s, inW);
  const outFrame = fwOutFrame(`${stepId}-out`, x.out);
  const sess: FwSession = { id: s.nextSessionId, state: "SYN_SENT", ingressZone: "trust", egressZone: x.toZone, protocol: "TCP", origSrc: inW.src, origSport: inW.seg.sport, origDst: inW.dst, dport: inW.seg.dport, xlSrc: x.out.src, xlSport: x.natPort, policy: x.pol.name, nat: NAT_RULE.name, pktsOut: 1, pktsIn: 0, bytesOut: ip4Length(ipOf(x.out)), bytesIn: 0 };
  const badNat = s.natAddr !== FW.untrust;
  const mutations: PacketMutation[] = [
    { type: "SA_CHANGE", detail: `source ${tupleText(inW.src, inW.seg.sport)} → ${tupleText(x.out.src, x.natPort)}` },
    { type: "TTL_CHANGE", detail: `${inW.ttl} → ${x.out.ttl}` },
    { type: "MAC_CHANGE", detail: `${FW_MAC.FW_UNTRUST} → ${FW_MAC.ISP_FW}` },
  ];
  const hop: FundHop = {
    stepId,
    device: "FW1",
    stages: withDetail(FW_STAGES, {
      rx: "ge-0/0/0 → zone trust",
      session: "miss — no session for this 5-tuple; first packet (SYN) takes the full path",
      route: `${inW.dst} → ${routeText(x.route)} → zone ${x.toZone}`,
      policy: `trust → ${x.toZone} · ${inW.src} → ${inW.dst} TCP/${inW.seg.dport} → ${x.pol.name} (${x.pol.action.toUpperCase()})`,
      nat: `${NAT_RULE.name}: ${tupleText(inW.src, inW.seg.sport)} → ${tupleText(x.out.src, x.natPort)} · destination unchanged`,
      state: `session ${sess.id} created · SYN_SENT`,
      tx: `TTL ${inW.ttl} → ${x.out.ttl} · IPv4 csum ${hex4(ip4Checksum(ipOf(inW)))} → ${hex4(ip4Checksum(ipOf(x.out)))} · TCP csum ${hex4(tcpChecksum(inW.seg, inW.src, inW.dst))} → ${hex4(tcpChecksum(x.out.seg, x.out.src, x.out.dst))}`,
    }),
    activeStageId: "tx",
    ingressInterfaceId: "ge-0/0/0",
    egressInterfaceId: x.egress,
    lookupType: "FW1 session → route → policy → NAT",
    lookupKey: `${tupleText(inW.src, inW.seg.sport)} → ${tupleText(inW.dst, inW.seg.dport)} TCP`,
    lookupResult: `${x.pol.name} ALLOW · SNAT ${tupleText(x.out.src, x.natPort)}`,
    action: badNat ? "ALLOW · SNAT 198.51.100.99" : "ALLOW · SNAT · FORWARD",
    reason: detailAll
      ? `Session miss, route via ${FW.ispFw} (zone ${x.toZone}), ${x.pol.name} allows it, and ${NAT_RULE.name} rewrites the source to ${tupleText(x.out.src, x.natPort)}. Only the source changed; both checksums were recomputed from the new fields. Session ${sess.id} records both tuples so replies can be matched and reversed.`
      : `${NAT_RULE.name} rewrites ONLY the source: ${tupleText(inW.src, inW.seg.sport)} → ${tupleText(x.out.src, x.natPort)}. The destination stays ${tupleText(inW.dst, inW.seg.dport)}. FW1 also decrements TTL, recomputes the IPv4 header checksum (the source address changed) and the TCP checksum (its pseudo-header includes the source address, and the source port changed). Session ${sess.id} is created in SYN_SENT holding both tuples.`,
    input: `${wireText(inW)} · ${csums(inW)}`,
    output: `${wireText(x.out)} · ${csums(x.out)}`,
    nextHopId: "ISP",
    before: tcpStack(inFrame),
    after: tcpStack(outFrame, ["eth", "ip", "tcp"]),
    mutations,
  };
  const check: FwCheck = { packet: wireText(inW), session: "miss → new session", route: routeText(x.route), policy: x.pol.name, nat: `${tupleText(inW.src, inW.seg.sport)} → ${tupleText(x.out.src, x.natPort)}`, verdict: "FORWARD" };
  return { ...idle(s), hops: [...s.hops, hop], packet: outFrame, sessions: [...s.sessions, sess], nextSessionId: s.nextSessionId + 1, check, decision: { device: "FW1", text: `FW1: ${x.pol.name} ALLOW · SNAT from ${tupleText(inW.src, inW.seg.sport)}` } };
}

/** ISP carries FW1's outbound segment to the server, and the server reacts. */
function stepIspToWeb(s: FwState, stepId: string, w: Wire, frameIdIn: string): FwState {
  const inFrame = tcpFrame(frameIdIn, "FW1", "ISP", FW_MAC.FW_UNTRUST, FW_MAC.ISP_FW, w);
  const r = ispHop(stepId, inFrame, w, "ge-0/0/0");
  const out = ispFrame(`${stepId}-out`, r.out!);
  const kind = flagsName(w.seg);
  const webHop = hostHop(stepId, "WEB-SERVER", {
    active: kind === "SYN" ? "listen" : "tcp",
    ingress: "eth0",
    details: { rx: `from ${tupleText(r.out!.w.src, r.out!.w.seg.sport)}`, listen: kind === "SYN" ? "TCP/443 is listening → accept the SYN" : "matches the half-open connection", tcp: kind === "SYN" ? "LISTEN → SYN_RECEIVED" : "SYN_RECEIVED → ESTABLISHED" },
    action: kind === "SYN" ? "SYN RECEIVED" : "ESTABLISHED",
    reason: kind === "SYN" ? `The server sees the translated tuple ${tupleText(r.out!.w.src, r.out!.w.seg.sport)} → ${tupleText(FW.web, WEB_PORT)}. It never learns the client's private address 10.10.10.10, and it will reply to exactly the source it saw.` : "The ACK completes the handshake on the server side.",
    key: `${tupleText(r.out!.w.src, r.out!.w.seg.sport)} → ${tupleText(FW.web, WEB_PORT)}`,
    result: kind === "SYN" ? "new connection · SYN_RECEIVED" : "ESTABLISHED",
    input: wireText(r.out!.w),
    output: kind === "SYN" ? "reply will go to the source it saw" : "connection open",
  });
  const web = kind === "SYN" ? { state: "SYN_RECEIVED" as HostTcp, peer: tupleText(r.out!.w.src, r.out!.w.seg.sport), replyTo: tupleText(r.out!.w.src, r.out!.w.seg.sport) } : { ...s.web, state: "ESTABLISHED" as HostTcp };
  return { ...idle(s), hops: [...s.hops, r.hop, webHop], packet: out, web, decision: { device: "WEB-SERVER", text: kind === "SYN" ? `WEB-SERVER sees ${tupleText(r.out!.w.src, r.out!.w.seg.sport)}` : "WEB-SERVER: ESTABLISHED" } };
}

function stepWebSynAck(s: FwState, stepId: string, f: Flow): FwState {
  const sess = latestSession(s)!;
  const w = serverSynAckWire(f, sess.xlSrc, sess.xlSport);
  const frame = webFrame(`${stepId}-synack`, w);
  const hop = hostHop(stepId, "WEB-SERVER", {
    active: "tx",
    egress: "eth0",
    details: { tcp: `SYN-ACK seq ${w.seg.seq} ack ${w.seg.ack} (client ISN + 1)`, tx: `to ${tupleText(w.dst, w.seg.dport)} via 203.0.113.1 · ${csums(w)}` },
    action: "SEND SYN-ACK",
    reason: `The reply is addressed to the tuple the server saw: ${tupleText(w.dst, w.seg.dport)}. Nothing in it refers to 10.10.10.10 — only FW1's session knows the mapping back.`,
    key: `reply to ${tupleText(w.dst, w.seg.dport)}`,
    result: "SYN_RECEIVED · reply sent",
    input: "SYN received",
    output: wireText(w),
    next: "ISP",
    after: frame,
  });
  return { ...idle(s), hops: [...s.hops, hop], packet: frame, decision: { device: "WEB-SERVER", text: `WEB-SERVER replies to ${tupleText(w.dst, w.seg.dport)}` } };
}

/** ISP routes the SYN-ACK toward FW1 — or drops it when the NAT address has no route back. */
function stepIspReturn(s: FwState, stepId: string, f: Flow): FwState {
  const sess = latestSession(s)!;
  const w = serverSynAckWire(f, sess.xlSrc, sess.xlSport);
  const inFrame = webFrame(`${stepId}-in`, w);
  const r = ispHop(stepId, inFrame, w, "ge-0/0/1");
  if (!r.out) return { ...idle(s), hops: [...s.hops, r.hop], decision: { device: "ISP", text: `ISP: no route to ${w.dst} — SYN-ACK dropped` } };
  return { ...idle(s), hops: [...s.hops, r.hop], packet: ispFrame(`${stepId}-out`, r.out), decision: { device: "ISP", text: `ISP → FW1 (${w.dst} is in 198.51.100.0/30)` } };
}

/** FW1 receives the SYN-ACK on untrust: session hit in the reverse direction, reverse NAT, forward to the client. */
function stepFwReturn(s: FwState, stepId: string, f: Flow, hops: FundHop[] = []): FwState {
  const sess = latestSession(s)!;
  const arrived: Wire = { ...serverSynAckWire(f, sess.xlSrc, sess.xlSport), ttl: INITIAL_TTL - 1 };
  const inFrame = tcpFrame(`${stepId}-in`, "ISP", "FW1", FW_MAC.ISP_FW, FW_MAC.FW_UNTRUST, arrived);
  const out: Wire = { ...arrived, dst: sess.origSrc, ttl: arrived.ttl - 1, seg: { ...arrived.seg, dport: sess.origSport } };
  const outFrame = fwInFrame(`${stepId}-out`, out);
  const route = lookupRoute(FW1_ROUTES, out.dst);
  const updated: FwSession = { ...sess, state: "SYN_RECV", pktsIn: sess.pktsIn + 1, bytesIn: sess.bytesIn + ip4Length(ipOf(arrived)) };
  const hop: FundHop = {
    stepId,
    device: "FW1",
    stages: withDetail(FW_STAGES, {
      rx: "ge-0/0/1 → zone untrust",
      session: `HIT session ${sess.id} (reverse direction): ${tupleText(arrived.src, arrived.seg.sport)} → ${tupleText(arrived.dst, arrived.seg.dport)} is the reply to ${tupleText(sess.xlSrc, sess.xlSport)} → ${tupleText(sess.origDst, sess.dport)}`,
      policy: "not re-evaluated — the packet belongs to an existing, permitted session",
      nat: `reverse-translate destination ${tupleText(arrived.dst, arrived.seg.dport)} → ${tupleText(out.dst, out.seg.dport)}`,
      route: `${out.dst} → ${routeText(route)}`,
      state: `SYN-ACK acknowledges ${sess.origSrc}'s ISN → SYN_SENT → SYN_RECV`,
      tx: `TTL ${arrived.ttl} → ${out.ttl} · IPv4 csum ${hex4(ip4Checksum(ipOf(arrived)))} → ${hex4(ip4Checksum(ipOf(out)))} · TCP csum ${hex4(tcpChecksum(arrived.seg, arrived.src, arrived.dst))} → ${hex4(tcpChecksum(out.seg, out.src, out.dst))}`,
    }),
    activeStageId: "tx",
    ingressInterfaceId: "ge-0/0/1",
    egressInterfaceId: "ge-0/0/0",
    lookupType: "FW1 session table",
    lookupKey: `${tupleText(arrived.src, arrived.seg.sport)} → ${tupleText(arrived.dst, arrived.seg.dport)} TCP`,
    lookupResult: `session ${sess.id} (return) · reverse NAT → ${tupleText(out.dst, out.seg.dport)}`,
    action: "SESSION MATCH · REVERSE NAT",
    reason: `This SYN-ACK is allowed because it matches session ${sess.id} as the reply to a flow ALLOW-WEB already permitted — not because of any inbound rule, and not because the server is "trusted". FW1 restores the original destination ${tupleText(out.dst, out.seg.dport)}, recomputes both checksums and forwards on trust.`,
    input: `${wireText(arrived)} · ${csums(arrived)}`,
    output: `${wireText(out)} · ${csums(out)}`,
    nextHopId: "CLIENT",
    before: tcpStack(inFrame),
    after: tcpStack(outFrame, ["eth", "ip", "tcp"]),
    mutations: [{ type: "DA_CHANGE", detail: `destination ${tupleText(arrived.dst, arrived.seg.dport)} → ${tupleText(out.dst, out.seg.dport)}` }, { type: "TTL_CHANGE", detail: `${arrived.ttl} → ${out.ttl}` }, { type: "MAC_CHANGE", detail: `${FW_MAC.FW_TRUST} → ${FW_MAC.CLIENT}` }],
  };
  const check: FwCheck = { packet: wireText(arrived), session: `hit ${sess.id} (return direction)`, route: routeText(route), policy: "not re-evaluated (existing session)", nat: `reverse ${tupleText(arrived.dst, arrived.seg.dport)} → ${tupleText(out.dst, out.seg.dport)}`, verdict: "FORWARD" };
  return { ...idle(s), hops: [...s.hops, ...hops, hop], packet: outFrame, sessions: s.sessions.map((x) => (x.id === sess.id ? updated : x)), check, decision: { device: "FW1", text: `FW1: session ${sess.id} return · ${tupleText(arrived.dst, arrived.seg.dport)} → ${tupleText(out.dst, out.seg.dport)}` } };
}

/** The client's ACK, and FW1 forwarding it on the existing session (session → ESTABLISHED). */
function stepClientAckThroughFw(s: FwState, stepId: string, f: Flow): FwState {
  const sess = latestSession(s)!;
  const w = clientAckWire(f);
  const cFrame = clientFrame(`${stepId}-c`, w);
  const clientHop: FundHop = { ...clientSendHop(stepId, cFrame, w, "ACK"), ingressInterfaceId: "eth0" };
  const out: Wire = { ...w, src: sess.xlSrc, ttl: w.ttl - 1, seg: { ...w.seg, sport: sess.xlSport } };
  const outFrame = fwOutFrame(`${stepId}-out`, out);
  const updated: FwSession = { ...sess, state: "ESTABLISHED", pktsOut: sess.pktsOut + 1, bytesOut: sess.bytesOut + ip4Length(ipOf(out)) };
  const hop: FundHop = {
    stepId,
    device: "FW1",
    stages: withDetail(FW_STAGES, {
      rx: "ge-0/0/0 → zone trust",
      session: `HIT session ${sess.id} (original direction)`,
      policy: "not re-evaluated — existing session",
      nat: `${tupleText(w.src, w.seg.sport)} → ${tupleText(out.src, out.seg.sport)} (same mapping as the SYN)`,
      route: `${w.dst} → ${routeText(lookupRoute(FW1_ROUTES, w.dst))}`,
      state: "final ACK of the handshake → ESTABLISHED",
      tx: `TTL ${w.ttl} → ${out.ttl} · IPv4 csum ${hex4(ip4Checksum(ipOf(w)))} → ${hex4(ip4Checksum(ipOf(out)))} · TCP csum ${hex4(tcpChecksum(w.seg, w.src, w.dst))} → ${hex4(tcpChecksum(out.seg, out.src, out.dst))}`,
    }),
    activeStageId: "state",
    ingressInterfaceId: "ge-0/0/0",
    egressInterfaceId: "ge-0/0/1",
    lookupType: "FW1 session table",
    lookupKey: `${tupleText(w.src, w.seg.sport)} → ${tupleText(w.dst, w.seg.dport)} TCP`,
    lookupResult: `session ${sess.id} · ESTABLISHED`,
    action: "SESSION MATCH · ESTABLISHED",
    reason: `The ACK completes the three-way handshake FW1 has been tracking: SYN out, SYN-ACK back, ACK out. Session ${sess.id} is now ESTABLISHED, and every later packet of this connection — both directions — is handled by the session.`,
    input: `${wireText(w)} · ${csums(w)}`,
    output: `${wireText(out)} · ${csums(out)}`,
    nextHopId: "ISP",
    before: tcpStack(cFrame),
    after: tcpStack(outFrame, ["eth", "ip", "tcp"]),
    mutations: [{ type: "SA_CHANGE", detail: `source ${tupleText(w.src, w.seg.sport)} → ${tupleText(out.src, out.seg.sport)}` }, { type: "TTL_CHANGE", detail: `${w.ttl} → ${out.ttl}` }],
  };
  const check: FwCheck = { packet: wireText(w), session: `hit ${sess.id} (original direction)`, route: routeText(lookupRoute(FW1_ROUTES, w.dst)), policy: "not re-evaluated (existing session)", nat: `${tupleText(w.src, w.seg.sport)} → ${tupleText(out.src, out.seg.sport)}`, verdict: "FORWARD" };
  return { ...idle(s), hops: [...s.hops, clientHop, hop], packet: outFrame, client: { state: "ESTABLISHED", sport: f.sport }, sessions: s.sessions.map((x) => (x.id === sess.id ? updated : x)), check, decision: { device: "FW1", text: `FW1: session ${sess.id} ESTABLISHED` } };
}

const pkt = (s: FwState) => s.packet;
const sessLine = (s: FwState) => {
  const x = latestSession(s);
  return x ? `Session ${x.id}: ${x.state} · ${tupleText(x.origSrc, x.origSport)} ⇄ ${tupleText(x.xlSrc, x.xlSport)} → ${tupleText(x.origDst, x.dport)}` : "No sessions";
};

// ---------------------------------------------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------------------------------------------
const H = FLOWS.healthy;
const I = FLOWS.incident;
const V = FLOWS.verify;
const fwNote = (s: FwState, stepId: string, o: { active: string; details: Partial<Record<string, string>>; action: string; reason: string; key: string; result: string; ingress?: string }): FwState => {
  const hop: FundHop = { stepId, device: "FW1", stages: withDetail(FW_STAGES, o.details), activeStageId: o.active, ingressInterfaceId: o.ingress, lookupType: "FW1 configuration", lookupKey: o.key, lookupResult: o.result, action: o.action, reason: o.reason, input: o.key, output: o.result };
  return { ...s, hops: [...s.hops, hop] };
};

export const firewallSteps: ScenarioStep<FwState>[] = [
  {
    id: "intro",
    label: "A client, a firewall, a web server",
    narrative: `CLIENT (${FW.client}/24) wants https://${FW.web}. Between them sit FW1 — the site's firewall and default gateway — and the ISP. FW1 will route the traffic, decide whether policy allows it, remember it as a session, and translate the client's private source address. Four jobs, four different tables.`,
  },
  {
    id: "zones",
    label: "Interfaces belong to zones",
    narrative: `FW1 ge-0/0/0 (${FW.trust}/24) is in zone trust, facing the client LAN. ge-0/0/1 (${FW.untrust}/30) is in zone untrust, facing the ISP at ${FW.ispFw}. Security policy is written between zones, so every packet's ingress and egress zones come from the interfaces it uses.`,
    run: (s) => ({ state: fwNote(idle(s), "zones", { active: "rx", details: { rx: "ge-0/0/0 = trust · ge-0/0/1 = untrust" }, action: "ZONES", reason: "Zones group interfaces by trust level. A policy says which zone may start connections to which other zone.", key: "interface → zone", result: "ge-0/0/0 trust · ge-0/0/1 untrust" }), events: [ev("STEP_ENTERED", "zones", "Zones")] }),
  },
  {
    id: "routes",
    label: "FW1 is still a router",
    narrative: `FW1's routing table: ${FW1_ROUTES.map(routeText).join(" · ")}. Without the default route FW1 could not forward to ${FW.web} at all — however permissive its policy. And a route alone permits nothing: routing picks the exit, policy decides whether the packet may use it.`,
    run: (s) => ({ state: fwNote(idle(s), "routes", { active: "route", details: { route: FW1_ROUTES.map(routeText).join(" · ") }, action: "ROUTING TABLE", reason: "A firewall is a Layer-3 forwarding device first. The route lookup gives the egress interface, and with it the egress zone the policy is matched against.", key: "FW1 routes", result: `${FW1_ROUTES.length} routes` }), events: [ev("ROUTE_LOOKUP", "routes", "FW1 routes")] }),
  },
  {
    id: "policy-table",
    label: "The security policy",
    narrative: `Rule 1, ALLOW-WEB: from trust to untrust, source 10.10.10.0/24, destination 203.0.113.80, service TCP/443 → allow. After the last rule sits the implicit default deny: anything no rule allows is dropped. There is deliberately no "allow any any".`,
    run: (s) => ({ state: fwNote(idle(s), "policy-table", { active: "policy", details: { policy: FW_POLICIES.map(policyText).join(" · ") }, action: "POLICY TABLE", reason: "Rules are evaluated top-down; the first match decides. The implicit default deny catches everything else, including anything unsolicited from untrust.", key: "security policy", result: "ALLOW-WEB · default deny" }), events: [ev("STEP_ENTERED", "policy-table", "Policy")] }),
  },
  {
    id: "predict-allow",
    label: "Predict: does ALLOW mean it works?",
    narrative: "ALLOW-WEB matches exactly the connection the client is about to open.",
    question: {
      prompt: "Does an allow policy guarantee end-to-end connectivity?",
      options: [
        { id: "no", label: "No — the packet still needs a route, a correct translation and a working return path; policy is only one check" },
        { id: "yes", label: "Yes — once a rule says allow, the firewall guarantees delivery" },
        { id: "reverse", label: "Yes, provided a second rule also allows the reverse direction" },
        { id: "udp", label: "No — allow rules only apply to UDP" },
      ],
      correctOptionId: "no",
      explanation: "Policy answers one question: may this flow pass? Delivery also depends on routing, on NAT producing an address that replies can reach, and on the far end answering. Keep that in mind — it matters later.",
    },
  },
  {
    id: "nat-rule",
    label: "The source-NAT rule",
    narrative: `SNAT-OUT: traffic from trust to untrust sourced from 10.10.10.0/24 leaves with FW1's untrust address ${FW.untrust} and a translated source port (PAT) — first free port from ${NAT_PORT}. 10.10.10.0/24 is private space: the Internet cannot route replies to it, so outbound connections must carry an address the ISP routes back to FW1.`,
    run: (s) => ({ state: fwNote(idle(s), "nat-rule", { active: "nat", details: { nat: `${NAT_RULE.name}: trust → untrust · ${NAT_RULE.source} → ${s.natAddr} · ${NAT_RULE.ports}` }, action: "NAT RULE", reason: "Source NAT with port translation lets many private clients share one public address; the session remembers which private tuple each public port belongs to.", key: NAT_RULE.name, result: `translate to ${s.natAddr}` }), events: [ev("STEP_ENTERED", "nat-rule", "NAT rule")] }),
  },
  {
    id: "predict-dst",
    label: "Predict: what does source NAT touch?",
    narrative: "SNAT-OUT is a SOURCE translation.",
    question: {
      prompt: "Does source NAT change the destination IP address?",
      options: [
        { id: "no", label: "No — it rewrites only the source address and port; the destination stays 203.0.113.80:443" },
        { id: "isp", label: "Yes — the destination becomes the ISP's address" },
        { id: "fw", label: "Yes — the destination becomes 198.51.100.2" },
        { id: "swap", label: "It swaps the source and destination" },
      ],
      correctOptionId: "no",
      explanation: "Source NAT changes who the packet appears to come from. The server's address is untouched — otherwise the packet would never reach the server. (Changing the destination is destination NAT, a different rule type.)",
    },
  },
  {
    id: "syn-send",
    label: "CLIENT sends SYN",
    narrative: `The client opens TCP: SYN from ${tupleText(FW.client, H.sport)} to ${tupleText(FW.web, WEB_PORT)}, sequence ${H.cIsn}, MSS ${MSS}. 203.0.113.80 is off-link, so the frame goes to the default gateway — FW1.`,
    run: (s) => ({ state: stepClientSyn(s, "syn-send", H), events: [ev("TCP_STATE_CHANGED", "syn-send", "CLIENT SYN_SENT")] }),
    packet: pkt,
    whatChanged: () => ["CLIENT: SYN_SENT", `Original tuple ${tupleText(FW.client, H.sport)} → ${tupleText(FW.web, WEB_PORT)}`],
  },
  {
    id: "fw-session-miss",
    label: "FW1: session lookup",
    narrative: "FW1 receives the SYN on ge-0/0/0 (zone trust) and first looks for an existing session with this 5-tuple — TCP, 10.10.10.10:51514 → 203.0.113.80:443 — in either direction. There is none: this is the first packet of a new connection, so it takes the full path through route, policy and NAT.",
    run: (s) => {
      const w = clientSynWire(H);
      const hop: FundHop = { stepId: "fw-session-miss", device: "FW1", stages: withDetail(FW_STAGES, { rx: "ge-0/0/0 → zone trust", session: "miss — no entry for this 5-tuple" }), activeStageId: "session", ingressInterfaceId: "ge-0/0/0", lookupType: "FW1 session table", lookupKey: `TCP ${tupleText(w.src, w.seg.sport)} → ${tupleText(w.dst, w.seg.dport)}`, lookupResult: "miss", action: "SESSION MISS", reason: "No session exists yet, and the packet is a SYN — a legitimate first packet — so FW1 evaluates it fully instead of dropping it as out-of-state.", input: wireText(w), output: "continue to route lookup", before: tcpStack(s.packet!) };
      return { state: { ...s, hops: [...s.hops, hop], check: { packet: wireText(w), session: "miss", route: "…", policy: "…", nat: "…", verdict: "FORWARD" }, decision: { device: "FW1", text: "FW1: session miss — first packet" } }, events: [ev("STEP_ENTERED", "fw-session-miss", "Session miss")] };
    },
    packet: pkt,
  },
  {
    id: "fw-route",
    label: "FW1: route lookup",
    narrative: `Destination ${FW.web} matches only the default route: next hop ${FW.ispFw} out ge-0/0/1. That interface is in zone untrust, so this flow is trust → untrust.`,
    run: (s) => {
      const w = clientSynWire(H);
      const r = lookupRoute(FW1_ROUTES, w.dst);
      const hop: FundHop = { stepId: "fw-route", device: "FW1", stages: withDetail(FW_STAGES, { rx: "ge-0/0/0 → zone trust", session: "miss", route: `${w.dst} → ${routeText(r)} → zone untrust` }), activeStageId: "route", ingressInterfaceId: "ge-0/0/0", egressInterfaceId: r.iface, lookupType: "FW1 routing table", lookupKey: `destination ${w.dst}`, lookupResult: routeText(r), action: "ROUTE → untrust", reason: "Routing decides the exit. The exit's zone is what the policy lookup needs next.", input: wireText(w), output: `egress ${r.iface} · zone untrust`, before: tcpStack(s.packet!) };
      return { state: { ...s, hops: [...s.hops, hop], check: { ...s.check!, route: routeText(r) }, decision: { device: "FW1", text: "FW1: route 0.0.0.0/0 → untrust" } }, events: [ev("ROUTE_LOOKUP", "fw-route", "Default route")] };
    },
    packet: pkt,
  },
  {
    id: "fw-policy",
    label: "FW1: policy match",
    narrative: "Policy lookup with trust → untrust, 10.10.10.10 → 203.0.113.80, TCP/443: rule ALLOW-WEB matches, action allow. The implicit default deny is never reached for this packet.",
    run: (s) => {
      const w = clientSynWire(H);
      const p = matchPolicy("trust", "untrust", w.src, w.dst, w.seg.dport);
      const hop: FundHop = { stepId: "fw-policy", device: "FW1", stages: withDetail(FW_STAGES, { rx: "ge-0/0/0 → zone trust", session: "miss", route: "0.0.0.0/0 → ge-0/0/1 (untrust)", policy: `trust → untrust · ${w.src} → ${w.dst} TCP/${w.seg.dport} → ${p.name} ALLOW` }), activeStageId: "policy", ingressInterfaceId: "ge-0/0/0", egressInterfaceId: "ge-0/0/1", lookupType: "FW1 security policy", lookupKey: `trust → untrust · TCP/${w.seg.dport}`, lookupResult: `${p.name} (${p.action})`, action: `POLICY ${p.name} · ALLOW`, reason: "The first matching rule decides. ALLOW-WEB permits this flow; the policy name is recorded in the session, not written into the packet.", input: wireText(w), output: "allowed → NAT", before: tcpStack(s.packet!) };
      return { state: { ...s, hops: [...s.hops, hop], check: { ...s.check!, policy: p.name }, decision: { device: "FW1", text: `FW1: ${p.name} ALLOW` } }, events: [ev("STEP_ENTERED", "fw-policy", "ALLOW-WEB")] };
    },
    packet: pkt,
  },
  {
    id: "predict-tuple",
    label: "Predict: what will the server see?",
    narrative: "Policy allowed the SYN. SNAT-OUT is next.",
    packet: pkt,
    question: {
      prompt: "After source NAT, which tuple does WEB-SERVER see?",
      options: [
        { id: "xl", label: "198.51.100.2:40001 → 203.0.113.80:443" },
        { id: "orig", label: "10.10.10.10:51514 → 203.0.113.80:443" },
        { id: "both", label: "198.51.100.2:51514 → 198.51.100.1:443" },
        { id: "gw", label: "10.10.10.1:40001 → 203.0.113.80:443" },
      ],
      correctOptionId: "xl",
      explanation: "The source becomes FW1's untrust address with a translated port; the destination is unchanged. The original tuple exists only on the trust side and inside FW1's session.",
    },
  },
  {
    id: "fw-nat",
    label: "FW1: source NAT and a new session",
    narrative: `SNAT-OUT rewrites the source ${tupleText(FW.client, H.sport)} → ${tupleText(FW.untrust, NAT_PORT)}; the destination stays ${tupleText(FW.web, WEB_PORT)}. FW1 decrements TTL, recomputes the IPv4 header checksum and the TCP checksum, creates session 1001 in SYN_SENT holding both tuples, and forwards out ge-0/0/1.`,
    run: (s) => ({ state: stepFwOutboundNew(s, "fw-nat", H, false), events: [ev("PACKET_SENT", "fw-nat", "SNAT + forward")] }),
    packet: pkt,
    whatChanged: (_p, n) => [`Wire tuple ${tupleText(FW.untrust, NAT_PORT)} → ${tupleText(FW.web, WEB_PORT)}`, sessLine(n), "IPv4 and TCP checksums recomputed"],
  },
  {
    id: "predict-checksum",
    label: "Predict: the checksums",
    narrative: "Compare the SYN before and after FW1 in the inspector: the source address, source port and TTL changed.",
    packet: pkt,
    question: {
      prompt: "What happens to the IPv4 and TCP checksums when FW1 translates the source?",
      options: [
        { id: "both", label: "Both are recomputed: the IPv4 checksum covers the new source (and TTL); the TCP checksum covers a pseudo-header with the addresses plus the new source port" },
        { id: "none", label: "Neither changes — checksums are end-to-end and NAT must preserve them" },
        { id: "tcp-only", label: "Only the TCP checksum changes; the IPv4 checksum is fixed by the client" },
        { id: "strip", label: "NAT removes the checksums" },
      ],
      correctOptionId: "both",
      explanation: "Any field a checksum covers changing means the checksum must change too, or the receiver would discard the packet. NAT devices recompute (or incrementally adjust) both.",
    },
  },
  {
    id: "isp-syn",
    label: "ISP delivers the SYN",
    narrative: `The ISP routes ${FW.web} on its connected 203.0.113.0/24 and delivers the SYN. WEB-SERVER sees ${tupleText(FW.untrust, NAT_PORT)} → ${tupleText(FW.web, WEB_PORT)}: it never sees 10.10.10.10.`,
    run: (s) => {
      const x = outboundNew(s, clientSynWire(H));
      return { state: stepIspToWeb(s, "isp-syn", x.out, "isp-syn-in"), events: [ev("PACKET_RECEIVED", "isp-syn", "SYN delivered")] };
    },
    packet: pkt,
    whatChanged: (_p, n) => [`WEB-SERVER: SYN_RECEIVED from ${n.web.peer}`],
  },
  {
    id: "web-synack",
    label: "WEB-SERVER answers SYN-ACK",
    narrative: `WEB-SERVER replies SYN-ACK: ${tupleText(FW.web, WEB_PORT)} → ${tupleText(FW.untrust, NAT_PORT)}, sequence ${H.sIsn}, acknowledgment ${H.cIsn + 1}. It replies to exactly the source it saw.`,
    run: (s) => ({ state: stepWebSynAck(s, "web-synack", H), events: [ev("PACKET_SENT", "web-synack", "SYN-ACK")] }),
    packet: pkt,
  },
  {
    id: "isp-synack",
    label: "ISP routes the reply to FW1",
    narrative: `${FW.untrust} is inside the customer /30 the ISP routes to FW1, so the SYN-ACK heads back to FW1's untrust interface.`,
    run: (s) => ({ state: stepIspReturn(s, "isp-synack", H), events: [ev("PACKET_SENT", "isp-synack", "ISP → FW1")] }),
    packet: pkt,
  },
  {
    id: "predict-return",
    label: "Predict: why is the reply allowed?",
    narrative: "The SYN-ACK arrives on untrust. The policy table has no rule from untrust to trust.",
    packet: pkt,
    question: {
      prompt: "Why will FW1 pass this SYN-ACK without a broad inbound allow rule?",
      options: [
        { id: "session", label: "It matches session 1001 in reverse (203.0.113.80:443 → 198.51.100.2:40001); replies of a permitted session are allowed by the session" },
        { id: "trusted", label: "Once ALLOW-WEB exists, all traffic from WEB-SERVER is trusted" },
        { id: "implicit", label: "FW1 has an implicit allow for every inbound TCP packet" },
        { id: "skip", label: "SYN-ACK packets are never inspected" },
      ],
      correctOptionId: "session",
      explanation: "State is the whole point of a stateful firewall: the session remembers the permitted flow, so only its matching replies get back in. A different port, a different tuple or a brand-new SYN from the same server does not match.",
    },
  },
  {
    id: "fw-return",
    label: "FW1: session hit, reverse NAT",
    narrative: `Session lookup hits session 1001 in the return direction. Policy is not re-evaluated. FW1 reverse-translates the destination ${tupleText(FW.untrust, NAT_PORT)} → ${tupleText(FW.client, H.sport)}, recomputes the checksums and forwards on trust. The session moves to SYN_RECV — not yet ESTABLISHED.`,
    run: (s) => ({ state: stepFwReturn(s, "fw-return", H), events: [ev("TCP_STATE_CHANGED", "fw-return", "SYN_RECV")] }),
    packet: pkt,
    whatChanged: (_p, n) => [`Reverse NAT ${tupleText(FW.untrust, NAT_PORT)} → ${tupleText(FW.client, H.sport)}`, sessLine(n)],
  },
  {
    id: "client-ack",
    label: "CLIENT completes the handshake",
    narrative: `The client receives a SYN-ACK from ${tupleText(FW.web, WEB_PORT)} to its own ${tupleText(FW.client, H.sport)} — as if NAT never happened — and sends the final ACK (seq ${H.cIsn + 1}, ack ${H.sIsn + 1}). FW1 matches it to session 1001, applies the same translation, and the session becomes ESTABLISHED.`,
    run: (s) => ({ state: stepClientAckThroughFw(s, "client-ack", H), events: [ev("TCP_STATE_CHANGED", "client-ack", "ESTABLISHED")] }),
    packet: pkt,
    whatChanged: (_p, n) => ["CLIENT: ESTABLISHED", sessLine(n)],
  },
  {
    id: "web-established",
    label: "WEB-SERVER: ESTABLISHED",
    narrative: "The ISP delivers the ACK. Both ends and FW1's session agree: ESTABLISHED. TLS and HTTP would now run inside this connection, matched by the same session.",
    run: (s) => {
      const sess = latestSession(s)!;
      const w: Wire = { ...clientAckWire(H), src: sess.xlSrc, ttl: INITIAL_TTL - 1, seg: { ...segs(H).ack, sport: sess.xlSport } };
      return { state: stepIspToWeb(s, "web-established", w, "web-est-in"), events: [ev("TCP_STATE_CHANGED", "web-established", "Server ESTABLISHED")] };
    },
    packet: pkt,
  },
  {
    id: "session-table",
    label: "Read the session table",
    narrative: "Session 1001 now holds everything FW1 needs for this connection: ingress trust, egress untrust, the original tuple 10.10.10.10:51514 → 203.0.113.80:443, the translated source 198.51.100.2:40001, the policy that allowed it and packet/byte counters. None of this travels in any packet.",
    run: (s) => ({ state: fwNote(idle(s), "session-table", { active: "state", details: { state: sessLine(s) }, action: "SESSION TABLE", reason: "The session is the firewall's memory of an allowed flow. Return traffic, NAT reversal and TCP state checks all key off it.", key: "session 1001", result: sessLine(s) }), events: [] }),
    whatChanged: (_p, n) => [sessLine(n)],
  },
  {
    id: "predict-unsolicited",
    label: "Predict: a SYN from outside",
    narrative: `Next, WEB-SERVER itself opens a NEW connection toward FW1's public address: SYN ${tupleText(FW.web, SCAN.sport)} → ${tupleText(FW.untrust, SCAN.dport)}. There is no destination-NAT (publishing) rule for that address and port.`,
    question: {
      prompt: "Why is this unsolicited inbound SYN handled differently from the SYN-ACK earlier?",
      options: [
        { id: "new", label: "It starts a NEW connection: no session matches it, no destination-NAT rule publishes 198.51.100.2:8443 and no inbound policy allows it — so default deny drops it" },
        { id: "same", label: "It isn't — anything from 203.0.113.80 is now return traffic" },
        { id: "known", label: "It is allowed, because the client already talked to that server" },
        { id: "never", label: "It is dropped because inbound SYNs are always dropped, even with a policy" },
      ],
      correctOptionId: "new",
      explanation: "Same server, different flow. The SYN-ACK matched session 1001's reverse tuple exactly. This SYN has a different tuple and is itself a first packet — so it must be permitted on its own merits, and nothing permits it.",
    },
  },
  {
    id: "scan-send",
    label: "WEB-SERVER sends an unsolicited SYN",
    narrative: `A brand-new SYN: ${tupleText(FW.web, SCAN.sport)} → ${tupleText(FW.untrust, SCAN.dport)}, sequence ${SCAN.seq}. It is not a reply to anything.`,
    run: (s) => {
      const w: Wire = { src: FW.web, dst: FW.untrust, ttl: INITIAL_TTL, ipId: 0x2c01, seg: { sport: SCAN.sport, dport: SCAN.dport, seq: SCAN.seq, ack: 0, flags: ["SYN"], mss: MSS } };
      const frame = webFrame("scan-syn", w);
      const hop = hostHop("scan-send", "WEB-SERVER", { active: "tx", egress: "eth0", details: { tcp: `new connection · SYN seq ${SCAN.seq}`, tx: `to ${tupleText(w.dst, w.seg.dport)}` }, action: "SEND SYN (NEW)", reason: "An inbound connection attempt toward FW1's public address. Unrelated to session 1001 even though the source host is the same.", key: `${tupleText(w.src, w.seg.sport)} → ${tupleText(w.dst, w.seg.dport)}`, result: "new outbound connection attempt", input: "(originated here)", output: wireText(w), next: "ISP", after: frame });
      return { state: { ...idle(s), hops: [...s.hops, hop], packet: frame, decision: { device: "WEB-SERVER", text: "WEB-SERVER: new SYN to 198.51.100.2:8443" } }, events: [ev("PACKET_SENT", "scan-send", "Unsolicited SYN")] };
    },
    packet: pkt,
  },
  {
    id: "scan-isp",
    label: "ISP routes it to FW1",
    narrative: "The ISP routes 198.51.100.2 to FW1 like any other packet. Routing is not a security decision.",
    run: (s) => {
      const w: Wire = { src: FW.web, dst: FW.untrust, ttl: INITIAL_TTL, ipId: 0x2c01, seg: { sport: SCAN.sport, dport: SCAN.dport, seq: SCAN.seq, ack: 0, flags: ["SYN"], mss: MSS } };
      const r = ispHop("scan-isp", webFrame("scan-in", w), w, "ge-0/0/1");
      return { state: { ...idle(s), hops: [...s.hops, r.hop], packet: ispFrame("scan-isp-out", r.out!), decision: { device: "ISP", text: "ISP → FW1" } }, events: [ev("PACKET_SENT", "scan-isp", "ISP → FW1")] };
    },
    packet: pkt,
  },
  {
    id: "fw-deny",
    label: "FW1: no session, no rule — drop",
    narrative: "FW1: session lookup misses (this tuple is not the reverse of session 1001, and it is a SYN, not a reply). No destination-NAT rule publishes 198.51.100.2:8443, so the destination is FW1's own address. Policy lookup from untrust finds no allow rule → implicit default deny. Dropped and logged. The session table is unchanged.",
    run: (s) => {
      const w: Wire = { src: FW.web, dst: FW.untrust, ttl: INITIAL_TTL - 1, ipId: 0x2c01, seg: { sport: SCAN.sport, dport: SCAN.dport, seq: SCAN.seq, ack: 0, flags: ["SYN"], mss: MSS } };
      const inFrame = tcpFrame("fw-deny-in", "ISP", "FW1", FW_MAC.ISP_FW, FW_MAC.FW_UNTRUST, w);
      const sess = latestSession(s)!;
      const hop: FundHop = {
        stepId: "fw-deny",
        device: "FW1",
        stages: withDetail(FW_STAGES, { rx: "ge-0/0/1 → zone untrust", session: `miss — not the reverse of session ${sess.id} (${tupleText(sess.xlSrc, sess.xlSport)} ⇄ ${tupleText(sess.origDst, sess.dport)}); a new SYN`, route: `${w.dst} → ${routeText(lookupRoute(FW1_ROUTES, w.dst))} · no destination-NAT rule`, policy: "untrust → FW1 itself · TCP/8443 → no allow rule → implicit default deny" }),
        activeStageId: "policy",
        ingressInterfaceId: "ge-0/0/1",
        lookupType: "FW1 session table + security policy",
        lookupKey: `${tupleText(w.src, w.seg.sport)} → ${tupleText(w.dst, w.seg.dport)} SYN`,
        lookupResult: "no session · default deny",
        action: "DROP · DEFAULT DENY",
        reason: "Nothing permits this new inbound connection: it belongs to no session, nothing publishes that address/port, and no policy allows untrust-originated traffic. Default deny drops it and logs the attempt.",
        input: wireText(w),
        output: "dropped · logged",
        before: tcpStack(inFrame),
      };
      const log: DenyLog = { src: w.src, sport: w.seg.sport, dst: w.dst, dport: w.seg.dport, from: "untrust", reason: "no session · no DNAT · default deny" };
      return { state: { ...idle(s), hops: [...s.hops, hop], denyLog: [...s.denyLog, log], check: { packet: wireText(w), session: "miss (new SYN)", route: `${w.dst} local · no DNAT`, policy: "implicit default deny", nat: "none", verdict: "DROP" }, decision: { device: "FW1", text: "FW1: DROP — default deny" } }, events: [ev("PACKET_DROPPED", "fw-deny", "Default deny")] };
    },
    whatChanged: (_p, n) => ["Unsolicited SYN dropped by default deny", `Deny log entries: ${n.denyLog.length}`, sessLine(n)],
  },
  {
    id: "incident-intro",
    label: "Incident: a change window",
    narrative: `Session 1001 has since finished normally (FIN exchange, not stepped) and left the table. During a change window an administrator edits SNAT-OUT: the translated source becomes ${FW.badNat}. The policy, the routes and the server are untouched. Shortly after, users report that https://${FW.web} times out.`,
    run: (s) => ({ state: fwNote({ ...idle(s), natAddr: FW.badNat, sessions: [], faultActive: true, client: { state: "CLOSED" }, web: { state: "LISTEN" }, check: undefined, closedNote: "session 1001 closed normally" }, "incident-intro", { active: "nat", details: { nat: `${NAT_RULE.name}: ${NAT_RULE.source} → ${FW.badNat}` }, action: "NAT RULE CHANGED", reason: "A configuration change to the source-NAT rule's translated address.", key: NAT_RULE.name, result: `translate to ${FW.badNat}` }), events: [ev("STEP_ENTERED", "incident-intro", "SNAT-OUT edited")] }),
    whatChanged: () => [`SNAT-OUT translated source: ${FW.badNat}`, "Policy and routes unchanged"],
  },
  {
    id: "inc-syn",
    label: "CLIENT tries again",
    narrative: `SYN from ${tupleText(FW.client, I.sport)} to ${tupleText(FW.web, WEB_PORT)}.`,
    run: (s) => ({ state: stepClientSyn(s, "inc-syn", I), events: [ev("TCP_STATE_CHANGED", "inc-syn", "CLIENT SYN_SENT")] }),
    packet: pkt,
  },
  {
    id: "inc-fw",
    label: "FW1: allowed, translated, forwarded",
    narrative: `Session miss, default route, ALLOW-WEB matches — ALLOW. SNAT-OUT now produces ${tupleText(FW.badNat, NAT_PORT)}. Session 1002 is created in SYN_SENT and the SYN leaves ge-0/0/1. As far as FW1's policy is concerned, everything is fine.`,
    run: (s) => ({ state: stepFwOutboundNew(s, "inc-fw", I, true), events: [ev("PACKET_SENT", "inc-fw", "SNAT .99")] }),
    packet: pkt,
    whatChanged: (_p, n) => ["Policy: ALLOW-WEB (allow)", sessLine(n)],
  },
  {
    id: "inc-isp",
    label: "The server sees .99",
    narrative: `The ISP routes by destination only, so the SYN still reaches WEB-SERVER — now from ${tupleText(FW.badNat, NAT_PORT)}.`,
    run: (s) => {
      const x = outboundNew(s, clientSynWire(I));
      return { state: stepIspToWeb(s, "inc-isp", x.out, "inc-isp-in"), events: [ev("PACKET_RECEIVED", "inc-isp", "SYN from .99")] };
    },
    packet: pkt,
    whatChanged: (_p, n) => [`WEB-SERVER sees ${n.web.peer}`],
  },
  {
    id: "inc-synack",
    label: "WEB-SERVER replies to .99",
    narrative: `The server answers SYN-ACK to the source it saw: ${tupleText(FW.badNat, NAT_PORT)}.`,
    run: (s) => ({ state: stepWebSynAck(s, "inc-synack", I), events: [ev("PACKET_SENT", "inc-synack", "SYN-ACK to .99")] }),
    packet: pkt,
  },
  {
    id: "inc-isp-drop",
    label: "The reply has nowhere to go",
    narrative: `The ISP looks up ${FW.badNat}. It routes only 198.51.100.0/30 toward FW1 (addresses .0–.3), and .99 is not in it — no route. The SYN-ACK is dropped long before FW1. (A real router would usually send ICMP Destination Unreachable back to the server.)`,
    run: (s) => ({ state: stepIspReturn(s, "inc-isp-drop", I), events: [ev("PACKET_DROPPED", "inc-isp-drop", "No route to .99")] }),
    whatChanged: () => [`ISP: no route to ${FW.badNat}`, "SYN-ACK never reaches FW1"],
  },
  {
    id: "inc-stuck",
    label: "The session never completes",
    narrative: "FW1's session 1002 waits in SYN_SENT: no reply ever arrives to match it. The client retransmits its SYN; each retry is allowed and translated to .99 again, and fails the same way. Eventually the half-open session times out. Policy allowed every single attempt.",
    run: (s) => ({ state: fwNote(idle(s), "inc-stuck", { active: "state", details: { state: sessLine(s) }, action: "SESSION STUCK · SYN_SENT", reason: "The session exists, policy said allow, but no matching return packet ever arrives — the handshake cannot finish.", key: `session ${latestSession(s)?.id}`, result: sessLine(s) }), events: [] }),
    whatChanged: (_p, n) => [sessLine(n), "Client: SYN_SENT (retransmitting)"],
  },
  {
    id: "trouble-question",
    label: "Diagnose the incident",
    narrative: "Clues: ALLOW-WEB matched every attempt; the server received the SYNs; the session never left SYN_SENT; the source the server saw was 198.51.100.99.",
    question: {
      prompt: "Why does the wrong NAT address break the connection even though policy says ALLOW?",
      options: [
        { id: "nat", label: "The server replies to 198.51.100.99, which doesn't route back to FW1 — the SYN-ACK never reaches the session, so it stays SYN_SENT" },
        { id: "policy", label: "ALLOW-WEB is actually denying the traffic" },
        { id: "server", label: "The server refuses source addresses ending in .99" },
        { id: "route", label: "FW1's default route is missing" },
      ],
      correctOptionId: "nat",
      explanation: "Policy was never the problem. Source NAT must produce an address that replies are routed back to — FW1's own untrust address here. With .99, the request goes out but the reply has no path home.",
    },
  },
  {
    id: "diagnostic-layers",
    label: "Troubleshooting layers",
    narrative: "Walk the checks separately: routing, policy, translation, return path, session state.",
  },
  {
    id: "repair-challenge",
    label: "Repair the translation",
    narrative: "Choose the change that fixes the cause you identified.",
    action: (s, payload) => ({ state: applyFwRepair(s, (payload as { choice: string }).choice), events: [ev("STEP_ENTERED", "repair-challenge", `Repair attempt: ${(payload as { choice: string }).choice}`)] }),
    requiresState: (s) => s.repaired,
  },
  {
    id: "verify-syn",
    label: "Verify: CLIENT SYN",
    narrative: `SYN from ${tupleText(FW.client, V.sport)} to ${tupleText(FW.web, WEB_PORT)}.`,
    run: (s) => ({ state: stepClientSyn(s, "verify-syn", V), events: [ev("TCP_STATE_CHANGED", "verify-syn", "CLIENT SYN_SENT")] }),
    packet: pkt,
  },
  {
    id: "verify-fw",
    label: "Verify: FW1 translates to .2",
    narrative: `Session miss, default route, ALLOW-WEB, and SNAT-OUT now gives ${tupleText(FW.untrust, NAT_PORT)} again. Session 1003 starts in SYN_SENT.`,
    run: (s) => ({ state: stepFwOutboundNew(s, "verify-fw", V, true), events: [ev("PACKET_SENT", "verify-fw", "SNAT .2")] }),
    packet: pkt,
    whatChanged: (_p, n) => [sessLine(n)],
  },
  {
    id: "verify-isp",
    label: "Verify: the server sees .2",
    narrative: `WEB-SERVER receives the SYN from ${tupleText(FW.untrust, NAT_PORT)}.`,
    run: (s) => {
      const x = outboundNew(s, clientSynWire(V));
      return { state: stepIspToWeb(s, "verify-isp", x.out, "verify-isp-in"), events: [ev("PACKET_RECEIVED", "verify-isp", "SYN delivered")] };
    },
    packet: pkt,
  },
  {
    id: "verify-synack",
    label: "Verify: SYN-ACK",
    narrative: `SYN-ACK to ${tupleText(FW.untrust, NAT_PORT)} — an address the ISP routes to FW1.`,
    run: (s) => ({ state: stepWebSynAck(s, "verify-synack", V), events: [ev("PACKET_SENT", "verify-synack", "SYN-ACK")] }),
    packet: pkt,
  },
  {
    id: "verify-return",
    label: "Verify: the reply gets home",
    narrative: "The ISP routes the SYN-ACK to FW1; FW1 matches session 1003 in reverse, reverse-translates to 10.10.10.10:51516 and forwards to the client.",
    run: (s) => {
      const routed = stepIspReturn(s, "verify-return", V);
      const ispHops = routed.hops.slice(s.hops.length);
      return { state: stepFwReturn(s, "verify-return", V, ispHops), events: [ev("TCP_STATE_CHANGED", "verify-return", "SYN_RECV")] };
    },
    packet: pkt,
    whatChanged: (_p, n) => [sessLine(n)],
  },
  {
    id: "verify-ack",
    label: "Verify: final ACK",
    narrative: "The client ACKs; FW1 matches session 1003 and marks it ESTABLISHED.",
    run: (s) => ({ state: stepClientAckThroughFw(s, "verify-ack", V), events: [ev("TCP_STATE_CHANGED", "verify-ack", "ESTABLISHED")] }),
    packet: pkt,
    whatChanged: (_p, n) => [sessLine(n)],
  },
  {
    id: "verify-established",
    label: "Verify: connection established",
    narrative: "WEB-SERVER receives the ACK. SYN, SYN-ACK, ACK — session 1003 ESTABLISHED with original 10.10.10.10:51516 and translated 198.51.100.2:40001. The policy was never changed.",
    run: (s) => {
      const sess = latestSession(s)!;
      const w: Wire = { ...clientAckWire(V), src: sess.xlSrc, ttl: INITIAL_TTL - 1, seg: { ...segs(V).ack, sport: sess.xlSport } };
      return { state: stepIspToWeb(s, "verify-established", w, "verify-est-in"), events: [ev("TCP_STATE_CHANGED", "verify-established", "Server ESTABLISHED")] };
    },
    packet: pkt,
    whatChanged: (_p, n) => [sessLine(n), "HTTPS works again"],
  },
  {
    id: "processing-order",
    label: "Four jobs, kept apart",
    narrative: "Routing chose the exit. Policy decided whether a new flow may start. The session remembered the flow and let exactly its replies back. NAT rewrote the source and reversed it. This lesson applied them in one clear order; real products differ in details — for example whether destination NAT happens before policy lookup, or whether policy is written against pre- or post-NAT addresses. Check your platform's documented order.",
    run: (s) => ({ state: idle(s), events: [] }),
  },
  {
    id: "complete",
    label: "Lesson complete",
    narrative: "Zones and policy, sessions and TCP state, source NAT with recomputed checksums, stateful return traffic, default deny for unsolicited connections — and an outage caused by a translation, not by policy.",
  },
];
