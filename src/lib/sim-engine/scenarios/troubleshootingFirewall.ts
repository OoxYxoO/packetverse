import type { PacketVisual, PVEvent, PVEventType, ScenarioStep } from "../types";
import type { PacketStackFrame, ProcessingStage } from "@/components/network3d/types";
import type { FundHop } from "@/components/lesson/fundamentalsTrace";
import { fieldIn, flagsName, ip4Frame, tcpField, tcpPacket, type TcpSeg, type TcpWire } from "./enterpriseEdgePackets";
import { withNotes, type NotebookEntry } from "./troubleshootingCommon";

/**
 * Firewall Troubleshooting: Policy, Sessions & Asymmetric Paths — CLIENT — EDGE-R1 — {FW1 | FW2} — EDGE-R2 — SERVER.
 *
 * Modeled exactly:
 * - FW1 and FW2 are independent routed stateful firewalls (each decrements TTL); there is NO state synchronization
 *   between them and NO NAT anywhere in this lesson, so addresses and ports are identical on every link.
 * - New flows: only a TCP SYN may create a session, after route lookup, zone lookup (trust → dmz) and policy lookup.
 *   Reverse traffic is admitted by matching an existing session on the reversed five-tuple — no reverse policy is
 *   consulted. A non-SYN packet with no matching session is dropped as out-of-state (wording is vendor-neutral; real
 *   products log it in different words).
 * - TCP segments use the shared RFC 9293 builder with computed checksums; the client's retransmitted SYN reuses its
 *   ISN (1 s initial RTO), and the server answers a duplicate SYN with an identical SYN-ACK.
 * Incident (truth, never shown before diagnosis): EDGE-R2's route for 10.10.10.0/24 points to FW2 instead of FW1.
 * The SYN goes out through FW1 (session created); the SYN-ACK comes back through FW2, which has no session → drop.
 */

export type FwDevice = "CLIENT" | "EDGE-R1" | "FW1" | "FW2" | "EDGE-R2" | "SERVER";
export const FW_DEVICES: FwDevice[] = ["CLIENT", "EDGE-R1", "FW1", "FW2", "EDGE-R2", "SERVER"];
export const IP = { client: "10.10.10.10", r1Lan: "10.10.10.1", server: "10.20.20.20", r2Lan: "10.20.20.1", r1Fw1: "172.18.1.0", fw1In: "172.18.1.1", r1Fw2: "172.18.2.0", fw2In: "172.18.2.1", fw1Out: "172.18.3.0", r2Fw1: "172.18.3.1", fw2Out: "172.18.4.0", r2Fw2: "172.18.4.1" } as const;
export const MAC = {
  CLIENT: "00:00:5E:00:53:01", R1_LAN: "00:00:5E:00:53:11", R1_F1: "00:00:5E:00:53:12", R1_F2: "00:00:5E:00:53:13", FW1_IN: "00:00:5E:00:53:21", FW1_OUT: "00:00:5E:00:53:22",
  FW2_IN: "00:00:5E:00:53:31", FW2_OUT: "00:00:5E:00:53:32", R2_F1: "00:00:5E:00:53:41", R2_F2: "00:00:5E:00:53:42", R2_LAN: "00:00:5E:00:53:43", SERVER: "00:00:5E:00:53:50",
} as const;
export const PORT = 443;
export const POLICY = { name: "ALLOW-WEB", from: "trust", to: "dmz", src: "10.10.10.0/24", dst: "10.20.20.20/32", service: "TCP/443", action: "permit" } as const;
export const RTO_S = 1;

export type FlowId = "healthy" | "incident" | "verify";
export const FLOW: Record<FlowId, { sport: number; isnC: number; isnS: number }> = { healthy: { sport: 52000, isnC: 4000, isnS: 8000 }, incident: { sport: 52001, isnC: 4100, isnS: 8100 }, verify: { sport: 52002, isnC: 4200, isnS: 8200 } };
export const tupleText = (f: FlowId) => `TCP ${IP.client}:${FLOW[f].sport} → ${IP.server}:${PORT}`;

export type Fw = "FW1" | "FW2";
export type SessState = "SYN seen" | "SYN-ACK seen" | "ESTABLISHED";
export interface Session {
  flow: FlowId;
  tuple: string;
  state: SessState;
  c2s: number;
  s2c: number;
  policy: string;
}
export interface DropLog {
  flow: FlowId;
  what: string;
  reason: string;
}
export interface FwState {
  hops: FundHop[];
  packet?: PacketVisual;
  flood: { id: string; fromId: string; toId: string; packet: PacketVisual }[];
  /** Truth: EDGE-R2's return route for 10.10.10.0/24. */
  r2Return: Fw;
  sessions: Record<Fw, Session[]>;
  drops: Record<Fw, DropLog[]>;
  policyLog: Record<Fw, { flow: FlowId; rule: string; action: string }[]>;
  serverRx: { flow: FlowId; what: string }[];
  serverTx: { flow: FlowId; what: string }[];
  clientTcp: Partial<Record<FlowId, string>>;
  synRetx: Partial<Record<FlowId, number>>;
  notebook: NotebookEntry[];
  decision?: { device: FwDevice; text: string };
  faultActive: boolean;
  repairAttempt?: { choice: string; correct: boolean };
  repaired: boolean;
}
export const createFwState = (): FwState => ({ hops: [], flood: [], r2Return: "FW1", sessions: { FW1: [], FW2: [] }, drops: { FW1: [], FW2: [] }, policyLog: { FW1: [], FW2: [] }, serverRx: [], serverTx: [], clientTcp: {}, synRetx: {}, notebook: [], faultActive: false, repaired: false });
export const sessionOf = (s: FwState, fw: Fw, f: FlowId) => s.sessions[fw].find((x) => x.flow === f);

// ---------------------------------------------------------------------------------------------------------------
// Segments and links
// ---------------------------------------------------------------------------------------------------------------
export type Link = "C-R1" | "R1-FW1" | "FW1-R2" | "R2-S" | "R1-FW2" | "FW2-R2";
const LINK_END: Record<Link, [FwDevice, FwDevice]> = { "C-R1": ["CLIENT", "EDGE-R1"], "R1-FW1": ["EDGE-R1", "FW1"], "FW1-R2": ["FW1", "EDGE-R2"], "R2-S": ["EDGE-R2", "SERVER"], "R1-FW2": ["EDGE-R1", "FW2"], "FW2-R2": ["FW2", "EDGE-R2"] };
const LINK_MAC: Record<Link, [string, string]> = { "C-R1": [MAC.CLIENT, MAC.R1_LAN], "R1-FW1": [MAC.R1_F1, MAC.FW1_IN], "FW1-R2": [MAC.FW1_OUT, MAC.R2_F1], "R2-S": [MAC.R2_LAN, MAC.SERVER], "R1-FW2": [MAC.R1_F2, MAC.FW2_IN], "FW2-R2": [MAC.FW2_OUT, MAC.R2_F2] };
/** Hops from the sender on each link (client → server order; the reverse direction counts from the server). */
const C2S_HOPS: Partial<Record<Link, number>> = { "C-R1": 0, "R1-FW1": 1, "R1-FW2": 1, "FW1-R2": 2, "FW2-R2": 2, "R2-S": 3 };
const S2C_HOPS: Partial<Record<Link, number>> = { "R2-S": 0, "FW1-R2": 1, "FW2-R2": 1, "R1-FW1": 2, "R1-FW2": 2, "C-R1": 3 };
export type Kind = "syn" | "synack" | "ack";
export function segOf(f: FlowId, k: Kind): TcpSeg {
  const F = FLOW[f];
  if (k === "syn") return { sport: F.sport, dport: PORT, seq: F.isnC, ack: 0, flags: ["SYN"], mss: 1460 };
  if (k === "synack") return { sport: PORT, dport: F.sport, seq: F.isnS, ack: F.isnC + 1, flags: ["SYN", "ACK"], mss: 1460 };
  return { sport: F.sport, dport: PORT, seq: F.isnC + 1, ack: F.isnS + 1, flags: ["ACK"] };
}
/** A segment as it exists on one link: direction decides MAC order and TTL. */
export function segOn(id: string, link: Link, f: FlowId, k: Kind, attempt = 0): PacketVisual {
  const c2s = k !== "synack";
  const [a, b] = LINK_END[link];
  const [ma, mb] = LINK_MAC[link];
  const hops = (c2s ? C2S_HOPS : S2C_HOPS)[link] ?? 0;
  const w: TcpWire = { src: c2s ? IP.client : IP.server, dst: c2s ? IP.server : IP.client, ttl: 64 - hops, ipId: (c2s ? 0x2100 : 0x6100) + (k === "ack" ? 2 : 0) + attempt, seg: segOf(f, k) };
  return c2s ? tcpPacket(id, a, b, ma, mb, w) : tcpPacket(id, b, a, mb, ma, w);
}
export function fwStack(p: PacketVisual): PacketStackFrame[] {
  return [
    { id: "eth", text: `Ethernet · ${fieldIn(p, /^Ethernet/, "Source MAC")} → ${fieldIn(p, /^Ethernet/, "Destination MAC")}`, tone: "generic" },
    ip4Frame(p),
    { id: "tcp", text: `TCP ${tcpField(p, "Source Port")} → ${tcpField(p, "Destination Port")} · ${p.badge} · seq ${tcpField(p, "Sequence Number")} · ack ${tcpField(p, "Acknowledgment Number").split(" ")[0]} · csum ${tcpField(p, "Checksum")}`, tone: "transport" },
  ];
}

// ---------------------------------------------------------------------------------------------------------------
// Stages and hops
// ---------------------------------------------------------------------------------------------------------------
export const FW_STAGES: ProcessingStage[] = [
  { id: "rx", label: "Receive on an interface (zone)" },
  { id: "session", label: "Session lookup (five-tuple, both directions)" },
  { id: "route", label: "New flow: route lookup → egress zone" },
  { id: "policy", label: "New flow: policy (zone pair, addresses, service) — SYN only" },
  { id: "create", label: "Create session / update TCP state" },
  { id: "tx", label: "Forward (TTL − 1) — or drop and log" },
];
export const ROUTER_STAGES: ProcessingStage[] = [
  { id: "rx", label: "Receive" },
  { id: "lookup", label: "Longest-prefix match" },
  { id: "tx", label: "TTL − 1 · forward to next hop" },
];
export const HOST_STAGES: ProcessingStage[] = [
  { id: "app", label: "TCP socket" },
  { id: "tx", label: "Transmit" },
  { id: "rx", label: "Receive" },
];
export const FW_ALL_STAGES: Record<FwDevice, ProcessingStage[]> = { CLIENT: HOST_STAGES, SERVER: HOST_STAGES, "EDGE-R1": ROUTER_STAGES, "EDGE-R2": ROUTER_STAGES, FW1: FW_STAGES, FW2: FW_STAGES };
const withDetail = (st: ProcessingStage[], d: Partial<Record<string, string>>) => st.map((x) => (d[x.id] ? { ...x, detail: d[x.id] } : x));
const ev = (type: PVEventType, stepId: string, message: string): PVEvent => ({ type, stepId, timestamp: Date.now(), message });
const idle = (s: FwState): FwState => ({ ...s, packet: undefined, flood: [], decision: undefined });
function hop(stepId: string, device: FwDevice, o: { active: string; details: Partial<Record<string, string>>; lookupType: string; key: string; result: string; action: string; reason: string; input: string; output: string; ingress?: string; egress?: string; next?: FwDevice; before?: PacketVisual; after?: PacketVisual }): FundHop {
  return { stepId, device, stages: withDetail(FW_ALL_STAGES[device], o.details), activeStageId: o.active, ingressInterfaceId: o.ingress, egressInterfaceId: o.egress, lookupType: o.lookupType, lookupKey: o.key, lookupResult: o.result, action: o.action, reason: o.reason, input: o.input, output: o.output, nextHopId: o.next, before: o.before ? fwStack(o.before) : undefined, after: o.after ? fwStack(o.after) : undefined };
}
const evidence = (s: FwState, stepId: string, d: FwDevice, o: { active: string; details: Partial<Record<string, string>>; action: string; reason: string; key: string; result: string }): FwState => ({ ...s, hops: [...s.hops, hop(stepId, d, { ...o, lookupType: `${d} evidence`, input: o.key, output: o.result })] });

/** A firewall processes a segment arriving from `fromLink`; session truth decides. */
function fwProcess(s: FwState, stepId: string, fw: Fw, f: FlowId, k: Kind, attempt = 0): { state: FwState; forwarded: boolean } {
  const c2s = k !== "synack";
  const inLink: Link = c2s ? (fw === "FW1" ? "R1-FW1" : "R1-FW2") : fw === "FW1" ? "FW1-R2" : "FW2-R2";
  const outLink: Link = c2s ? (fw === "FW1" ? "FW1-R2" : "FW2-R2") : fw === "FW1" ? "R1-FW1" : "R1-FW2";
  const inP = segOn(`${stepId}-in`, inLink, f, k, attempt);
  const outP = segOn(`${stepId}-out`, outLink, f, k, attempt);
  const sess = sessionOf(s, fw, f);
  const inIf = c2s ? "ge-0/0/0 (trust)" : "ge-0/0/1 (dmz)";
  const outIf = c2s ? "ge-0/0/1 (dmz)" : "ge-0/0/0 (trust)";
  const name = flagsName(segOf(f, k));
  if (!sess && k === "syn") {
    const created: Session = { flow: f, tuple: tupleText(f), state: "SYN seen", c2s: 1, s2c: 0, policy: POLICY.name };
    const h = hop(stepId, fw, { active: "create", ingress: inIf, egress: outIf, details: { rx: `${name} on ${inIf}`, session: "no matching session → new flow", route: `${IP.server} → 10.20.20.0/24 via ${fw === "FW1" ? IP.r2Fw1 : IP.r2Fw2} · egress zone dmz`, policy: `trust → dmz · ${IP.client} → ${IP.server} TCP/${PORT} → rule ${POLICY.name}: permit`, create: `session ${tupleText(f)} · state SYN seen`, tx: `TTL ${fieldIn(inP, /^IPv4/, "TTL")} → ${fieldIn(outP, /^IPv4/, "TTL")}` }, lookupType: `${fw} policy`, key: tupleText(f), result: `${POLICY.name} permit · session created`, action: "ALLOW · NEW SESSION", reason: "A SYN with no existing session is a new flow: route, zones and policy are checked, and the permit creates a session that will admit the reverse traffic.", input: name, output: `${name} → EDGE-R2`, next: "EDGE-R2", before: inP, after: outP });
    return { state: { ...idle(s), hops: [...s.hops, h], packet: outP, sessions: { ...s.sessions, [fw]: [...s.sessions[fw], created] }, policyLog: { ...s.policyLog, [fw]: [...s.policyLog[fw], { flow: f, rule: POLICY.name, action: "permit" }] }, decision: { device: fw, text: `${fw}: ${POLICY.name} permit · session created` } }, forwarded: true };
  }
  if (sess) {
    const next: Session = { ...sess, state: k === "synack" ? "SYN-ACK seen" : k === "ack" && sess.state === "SYN-ACK seen" ? "ESTABLISHED" : sess.state, c2s: sess.c2s + (c2s ? 1 : 0), s2c: sess.s2c + (c2s ? 0 : 1) };
    const h = hop(stepId, fw, { active: "tx", ingress: inIf, egress: outIf, details: { rx: `${name} on ${inIf}`, session: `matches session ${sess.tuple}${c2s ? "" : " (reverse direction)"} · ${sess.state}`, create: `state → ${next.state}`, tx: `TTL ${fieldIn(inP, /^IPv4/, "TTL")} → ${fieldIn(outP, /^IPv4/, "TTL")}` }, lookupType: `${fw} session table`, key: tupleText(f), result: `session match · ${next.state}`, action: "SESSION MATCH", reason: c2s ? "Part of an existing session: forwarded without a new policy decision." : "Reverse traffic of an existing session: admitted by state, no reverse policy needed.", input: name, output: `${name} forwarded`, next: c2s ? "EDGE-R2" : "EDGE-R1", before: inP, after: outP });
    return { state: { ...idle(s), hops: [...s.hops, h], packet: outP, sessions: { ...s.sessions, [fw]: s.sessions[fw].map((x) => (x.flow === f ? next : x)) }, decision: { device: fw, text: `${fw}: session match · ${next.state}` } }, forwarded: true };
  }
  const reason = "no matching session / out-of-state reverse traffic";
  const h = hop(stepId, fw, { active: "session", ingress: inIf, details: { rx: `${name} on ${inIf}`, session: `no session for ${tupleText(f)} in either direction`, route: "not a SYN → cannot start a new session", tx: `DROP · ${reason}` }, lookupType: `${fw} session table`, key: `${name} ${IP.server}:${PORT} → ${IP.client}:${FLOW[f].sport}`, result: "no session → drop", action: "DROP · NO SESSION", reason: `${fw} never saw this connection's SYN, so it has no state for it. A SYN-ACK cannot open a new session, so it is dropped as out-of-state traffic.`, input: name, output: "nothing (dropped)", before: inP });
  return { state: { ...idle(s), hops: [...s.hops, h], packet: inP, drops: { ...s.drops, [fw]: [...s.drops[fw], { flow: f, what: `${name} ${IP.server}:${PORT} → ${IP.client}:${FLOW[f].sport}`, reason }] }, decision: { device: fw, text: `${fw}: ${reason}` } }, forwarded: false };
}
function routerHop(s: FwState, stepId: string, r: "EDGE-R1" | "EDGE-R2", link: Link, f: FlowId, k: Kind, attempt = 0): FwState {
  const p = segOn(`${stepId}-pkt`, link, f, k, attempt);
  const c2s = k !== "synack";
  const via = r === "EDGE-R1" ? (c2s ? `10.20.20.0/24 via FW1 ${IP.fw1In}` : `10.10.10.0/24 connected`) : c2s ? "10.20.20.0/24 connected" : `10.10.10.0/24 via ${s.r2Return} ${s.r2Return === "FW1" ? IP.fw1Out : IP.fw2Out}`;
  const h = hop(stepId, r, { active: "tx", details: { lookup: `${c2s ? IP.server : IP.client} → ${via}`, tx: `TTL → ${fieldIn(p, /^IPv4/, "TTL")}` }, lookupType: `${r} routing`, key: c2s ? IP.server : IP.client, result: via, action: "ROUTE", reason: r === "EDGE-R2" && !c2s ? `EDGE-R2's route for the client subnet decides which firewall the return traffic crosses: ${s.r2Return}.` : "Plain routing: longest-prefix match, TTL − 1.", input: flagsName(segOf(f, k)), output: `→ ${LINK_END[link][c2s ? 1 : 0]}`, after: p });
  return { ...idle(s), hops: [...s.hops, h], packet: p };
}
function clientTx(s: FwState, stepId: string, f: FlowId, k: "syn" | "ack", attempt = 0): FwState {
  const p = segOn(`${stepId}-pkt`, "C-R1", f, k, attempt);
  const h = hop(stepId, "CLIENT", { active: "tx", egress: "eth0", details: { app: `${tupleText(f)} · ${k === "syn" ? (attempt ? `SYN retransmission ${attempt} (same ISN ${FLOW[f].isnC})` : "connect()") : "ACK — handshake complete"}`, tx: `via gateway ${IP.r1Lan} · TTL 64 · csum ${tcpField(p, "Checksum")}` }, lookupType: "CLIENT TCP", key: tupleText(f), result: k === "syn" ? "SYN_SENT" : "ESTABLISHED", action: k === "syn" ? (attempt ? "RETRANSMIT SYN" : "TX SYN") : "TX ACK", reason: k === "syn" ? "The client opens the connection. Its view of the network ends at its gateway." : "The third segment of the handshake.", input: "socket", output: flagsName(segOf(f, k)), next: "EDGE-R1", after: p });
  return { ...idle(s), hops: [...s.hops, h], packet: p, clientTcp: { ...s.clientTcp, [f]: k === "syn" ? "SYN_SENT" : "ESTABLISHED" } };
}
function serverRx(s: FwState, stepId: string, f: FlowId, attempt = 0): FwState {
  const p = segOn(`${stepId}-pkt`, "R2-S", f, "syn", attempt);
  const h = hop(stepId, "SERVER", { active: "rx", ingress: "eth0", details: { rx: `SYN ${tupleText(f)} · TTL ${fieldIn(p, /^IPv4/, "TTL")}${attempt ? " (duplicate)" : ""}`, app: `port ${PORT} listening → SYN_RECEIVED` }, lookupType: "SERVER TCP", key: tupleText(f), result: "SYN_RECEIVED", action: "RX SYN", reason: "The SYN arrived: the path to the server, the policy and the server's port all worked.", input: "SYN", output: "SYN-ACK", before: p });
  const r = routerHop(s, stepId, "EDGE-R2", "R2-S", f, "syn", attempt);
  return { ...r, hops: [...r.hops, h], serverRx: [...s.serverRx, { flow: f, what: `SYN${attempt ? " (retransmission)" : ""}` }] };
}
function serverTx(s: FwState, stepId: string, f: FlowId, attempt = 0): FwState {
  const p = segOn(`${stepId}-pkt`, "R2-S", f, "synack", attempt);
  const h = hop(stepId, "SERVER", { active: "tx", egress: "eth0", details: { app: `SYN-ACK seq ${FLOW[f].isnS} ack ${FLOW[f].isnC + 1}${attempt ? " (same values, answering a duplicate SYN)" : ""}`, tx: `via gateway ${IP.r2Lan} · TTL 64 · csum ${tcpField(p, "Checksum")}` }, lookupType: "SERVER TCP", key: tupleText(f), result: "SYN-ACK sent", action: "TX SYN-ACK", reason: "The server answers — whatever happens to this packet after EDGE-R2 is the network's doing.", input: "SYN", output: "SYN-ACK", next: "EDGE-R2", after: p });
  return { ...idle(s), hops: [...s.hops, h], packet: p, serverTx: [...s.serverTx, { flow: f, what: `SYN-ACK${attempt ? " (again)" : ""}` }] };
}

// ---------------------------------------------------------------------------------------------------------------
// Repair
// ---------------------------------------------------------------------------------------------------------------
export const FW_REPAIR_OPTIONS = [
  { id: "fix-route", label: "Restore EDGE-R2's return route: 10.10.10.0/24 → FW1" },
  { id: "fw2-allow", label: "Add a broad SERVER → CLIENT allow policy on FW2" },
  { id: "stateless", label: "Disable stateful inspection on FW2" },
  { id: "restart-fw1", label: "Restart FW1" },
  { id: "clear-dns", label: "Clear the DNS cache on CLIENT" },
  { id: "server-port", label: "Move the service from TCP/443 to another port" },
  { id: "nat", label: "Enable source NAT on FW1" },
] as const;
export const FW_REPAIR_CORRECT = "fix-route";
export function applyFwRepair(s: FwState, choice: string): FwState {
  const correct = choice === FW_REPAIR_CORRECT;
  if (!correct) return { ...s, repairAttempt: { choice, correct } };
  return { ...idle(s), r2Return: "FW1", faultActive: false, repaired: true, repairAttempt: { choice, correct }, decision: { device: "EDGE-R2", text: "EDGE-R2: 10.10.10.0/24 → FW1" } };
}

// ---------------------------------------------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------------------------------------------
const pkt = (s: FwState) => s.packet;
export const sessionText = (x?: Session) => (x ? `${x.tuple} · ${x.state} · pkts c→s ${x.c2s} / s→c ${x.s2c} · rule ${x.policy}` : "none");
const H: FlowId = "healthy";
const I: FlowId = "incident";
const V: FlowId = "verify";

export const fwSteps: ScenarioStep<FwState>[] = [
  // ---- Define / Scope ---
  {
    id: "intro",
    label: "Two firewalls, one server",
    narrative: `CLIENT (${IP.client}) reaches SERVER (${IP.server}) on TCP/${PORT}. Between the edge routers sit two independent stateful firewalls, FW1 and FW2, with the same policy but no shared session state. There is no NAT anywhere: every address and port you see is the real one.`,
    run: (s) => ({ state: withNotes(idle(s), "intro", [{ kind: "observation", text: `Service: ${IP.client} → ${IP.server}:${PORT}/TCP through FW1 or FW2 (no NAT)`, source: "design" }]), events: [ev("STEP_ENTERED", "intro", "scope")] }),
  },
  {
    id: "design",
    label: "Routes and policy",
    narrative: `EDGE-R1 routes 10.20.20.0/24 via FW1 (${IP.fw1In}); EDGE-R2 routes 10.10.10.0/24 via FW1 (${IP.fw1Out}). Both firewalls: zones trust (client side) and dmz (server side); rule ${POLICY.name}: trust → dmz, ${POLICY.src} → ${POLICY.dst}, ${POLICY.service}, permit. No rule permits dmz → trust — the session handles replies.`,
    run: (s) => ({ state: evidence(idle(s), "design", "FW1", { active: "policy", details: { policy: `${POLICY.name}: ${POLICY.from} → ${POLICY.to} ${POLICY.src} → ${POLICY.dst} ${POLICY.service} ${POLICY.action}`, route: `EDGE-R1 10.20.20.0/24 → FW1 · EDGE-R2 10.10.10.0/24 → ${s.r2Return}` }, action: "DESIGN", reason: "Stateful design: allow the new flow in one direction; replies are admitted by the session it creates.", key: "policy + routes", result: `${POLICY.name} permit` }), events: [ev("STEP_ENTERED", "design", "design")] }),
  },
  // ---- Baseline ---
  {
    id: "base-syn",
    label: "Baseline: CLIENT sends SYN",
    narrative: `CLIENT opens ${tupleText(H)}: SYN, seq ${FLOW[H].isnC}, TTL 64.`,
    run: (s) => ({ state: clientTx(s, "base-syn", H, "syn"), events: [ev("PACKET_SENT", "base-syn", "SYN")] }),
    packet: pkt,
  },
  {
    id: "base-r1",
    label: "Baseline: EDGE-R1 → FW1",
    narrative: "EDGE-R1: 10.20.20.0/24 via FW1. TTL 64 → 63.",
    run: (s) => ({ state: routerHop(s, "base-r1", "EDGE-R1", "R1-FW1", H, "syn"), events: [ev("PACKET_SENT", "base-r1", "route")] }),
    packet: pkt,
  },
  {
    id: "base-fw1",
    label: "Baseline: FW1 allows, creates a session",
    narrative: `FW1: no session exists → new flow. Route → dmz; policy ${POLICY.name} permits; FW1 creates a session for ${tupleText(H)} and forwards the SYN (TTL 63 → 62).`,
    run: (s) => ({ state: fwProcess(s, "base-fw1", "FW1", H, "syn").state, events: [ev("PACKET_SENT", "base-fw1", "allow")] }),
    packet: pkt,
  },
  {
    id: "base-server",
    label: "Baseline: SERVER receives the SYN",
    narrative: "EDGE-R2 delivers the SYN (TTL 61). SERVER is listening on 443 → SYN_RECEIVED.",
    run: (s) => ({ state: serverRx(s, "base-server", H), events: [ev("PACKET_SENT", "base-server", "SYN at server")] }),
    packet: pkt,
  },
  {
    id: "base-synack",
    label: "Baseline: SERVER answers",
    narrative: `SYN-ACK: seq ${FLOW[H].isnS}, ack ${FLOW[H].isnC + 1}.`,
    run: (s) => ({ state: serverTx(s, "base-synack", H), events: [ev("PACKET_SENT", "base-synack", "SYN-ACK")] }),
    packet: pkt,
  },
  {
    id: "base-r2",
    label: "Baseline: EDGE-R2 returns via FW1",
    narrative: "EDGE-R2: 10.10.10.0/24 via FW1. The reply takes the same firewall as the request.",
    run: (s) => ({ state: routerHop(s, "base-r2", "EDGE-R2", "FW1-R2", H, "synack"), events: [ev("PACKET_SENT", "base-r2", "return route")] }),
    packet: pkt,
  },
  {
    id: "base-fw1-return",
    label: "Baseline: FW1 matches the session",
    narrative: "FW1 finds the session on the reversed five-tuple and forwards the SYN-ACK — no dmz → trust policy is consulted.",
    run: (s) => ({ state: fwProcess(s, "base-fw1-return", "FW1", H, "synack").state, events: [ev("PACKET_SENT", "base-fw1-return", "session match")] }),
    packet: pkt,
  },
  {
    id: "q-reverse",
    label: "Question: why no reverse policy?",
    narrative: "There is no rule permitting dmz → trust, yet the SYN-ACK passed.",
    question: {
      prompt: "Why doesn't FW1 need a policy for the SYN-ACK?",
      options: [
        { id: "state", label: "The session created by the permitted SYN admits its reverse traffic; policy is evaluated only for new flows" },
        { id: "any", label: "Firewalls allow everything from the server side" },
        { id: "port", label: "Port 443 is always allowed in both directions" },
        { id: "nat", label: "NAT translated it" },
      ],
      correctOptionId: "state",
      explanation: "That is what 'stateful' means — and why the reverse packet must come back through the firewall that holds the state.",
    },
  },
  {
    id: "base-ack",
    label: "Baseline: ACK — established",
    narrative: `CLIENT sends the ACK; FW1's session becomes ESTABLISHED (packets both directions). The application exchange follows normally.`,
    run: (s) => {
      let n = clientTx(s, "base-ack", H, "ack");
      const sess = sessionOf(n, "FW1", H)!;
      n = { ...n, sessions: { ...n.sessions, FW1: n.sessions.FW1.map((x) => (x.flow === H ? { ...sess, state: "ESTABLISHED" as const, c2s: sess.c2s + 1 } : x)) } };
      return { state: withNotes(n, "base-ack", [{ kind: "observation", text: `Baseline FW1 session: ${sessionText(sessionOf(n, "FW1", H))}`, source: "FW1 session table" }]), events: [ev("PACKET_SENT", "base-ack", "ACK")] };
    },
    packet: pkt,
  },
  // ---- Incident ---
  {
    id: "incident-intro",
    label: "Incident: connections time out",
    narrative: "After overnight work on the server-side edge ('prepare FW2 for load sharing'), users report that the web service never loads. Scope it: which hosts, which service, which devices see what?",
    run: (s) => ({ state: withNotes({ ...idle(s), r2Return: "FW2", faultActive: true }, "incident-intro", [{ kind: "symptom", text: "Connections to 10.20.20.20:443 hang after overnight edge work", source: "user report" }]), events: [ev("STEP_ENTERED", "incident-intro", "incident")] }),
  },
  {
    id: "inc-syn",
    label: "CLIENT sends SYN",
    narrative: `New connection ${tupleText(I)}: SYN, seq ${FLOW[I].isnC}.`,
    run: (s) => ({ state: routerHop(clientTx(s, "inc-syn", I, "syn"), "inc-syn", "EDGE-R1", "R1-FW1", I, "syn"), events: [ev("PACKET_SENT", "inc-syn", "SYN")] }),
    packet: pkt,
  },
  {
    id: "inc-fw1",
    label: "FW1: allow, session created",
    narrative: "Inspect FW1's pipeline: session lookup, route, policy, session creation.",
    run: (s) => {
      const n = fwProcess(s, "inc-fw1", "FW1", I, "syn").state;
      return { state: withNotes(n, "inc-fw1", [{ kind: "observation", text: `FW1: ${POLICY.name} permit, session created (${sessionText(sessionOf(n, "FW1", I))})`, source: "FW1 policy + session log", rung: "Policy / service-specific" }]), events: [ev("PACKET_SENT", "inc-fw1", "allow")] };
    },
    packet: pkt,
  },
  {
    id: "inc-server",
    label: "SERVER receives the SYN",
    narrative: "The SYN reaches SERVER (TTL 61); a capture on SERVER shows it.",
    run: (s) => {
      const n = serverRx(s, "inc-server", I);
      return { state: withNotes(n, "inc-server", [{ kind: "observation", text: "SERVER capture: SYN from 10.10.10.10:52001 received", source: "SERVER capture", rung: "Transport" }]), events: [ev("PACKET_SENT", "inc-server", "SYN at server")] };
    },
    packet: pkt,
  },
  {
    id: "inc-synack",
    label: "SERVER sends SYN-ACK",
    narrative: `SERVER answers: SYN-ACK, seq ${FLOW[I].isnS}, ack ${FLOW[I].isnC + 1}. The port is open.`,
    run: (s) => ({ state: withNotes(serverTx(s, "inc-synack", I), "inc-synack", [{ kind: "observation", text: "SERVER capture: SYN-ACK transmitted", source: "SERVER capture", rung: "Transport" }]), events: [ev("PACKET_SENT", "inc-synack", "SYN-ACK")] }),
    packet: pkt,
  },
  {
    id: "inc-r2",
    label: "EDGE-R2 routes the SYN-ACK",
    narrative: "Inspect EDGE-R2's lookup for 10.10.10.10.",
    run: (s) => ({ state: withNotes(routerHop(s, "inc-r2", "EDGE-R2", "FW2-R2", I, "synack"), "inc-r2", [{ kind: "observation", text: `EDGE-R2 lookup 10.10.10.10 → 10.10.10.0/24 via ${s.r2Return}`, source: "EDGE-R2 routing", rung: "Routing / forwarding" }]), events: [ev("PACKET_SENT", "inc-r2", "return route")] }),
    packet: pkt,
  },
  {
    id: "inc-fw2",
    label: "FW2 receives the SYN-ACK",
    narrative: "Inspect FW2's pipeline for this packet.",
    run: (s) => {
      const n = fwProcess(s, "inc-fw2", "FW2", I, "synack").state;
      return { state: withNotes(n, "inc-fw2", [{ kind: "observation", text: "FW2 log: SYN-ACK 10.20.20.20:443 → 10.10.10.10:52001 dropped — no matching session", source: "FW2 drop log", rung: "Policy / service-specific" }]), events: [ev("PACKET_SENT", "inc-fw2", "drop")] };
    },
    packet: pkt,
  },
  {
    id: "inc-retx",
    label: "The client retries",
    narrative: `CLIENT hears nothing and retransmits the SYN after 1 s (same seq ${FLOW[I].isnC}). FW1 matches its existing session and forwards it; SERVER answers the duplicate SYN with the same SYN-ACK; EDGE-R2 sends it to FW2 again; FW2 drops it again.`,
    run: (s) => {
      let n = clientTx(s, "inc-retx", I, "syn", 1);
      n = fwProcess(routerHop(n, "inc-retx", "EDGE-R1", "R1-FW1", I, "syn", 1), "inc-retx", "FW1", I, "syn", 1).state;
      n = serverRx(n, "inc-retx", I, 1);
      n = serverTx(n, "inc-retx", I, 1);
      n = routerHop(n, "inc-retx", "EDGE-R2", "FW2-R2", I, "synack", 1);
      n = fwProcess(n, "inc-retx", "FW2", I, "synack", 1).state;
      return { state: withNotes({ ...n, synRetx: { ...n.synRetx, [I]: 1 } }, "inc-retx", [{ kind: "observation", text: `SYN retransmitted (same ISN); FW1 session still ${sessionOf(n, "FW1", I)!.state}, s→c packets ${sessionOf(n, "FW1", I)!.s2c}; FW2 drops ${n.drops.FW2.filter((d) => d.flow === I).length}`, source: "captures + firewall logs" }]), events: [ev("PACKET_SENT", "inc-retx", "retransmission")] };
    },
    packet: pkt,
  },
  {
    id: "q-server-syn",
    label: "Question: did the SYN arrive?",
    narrative: "The client retransmitted its SYN.",
    question: {
      prompt: "What proves SERVER received the SYN?",
      options: [
        { id: "capture", label: "SERVER's own capture shows the SYN arriving — and SERVER answered with a SYN-ACK" },
        { id: "retx", label: "The client retransmitted it" },
        { id: "policy", label: "FW1's policy log" },
        { id: "ping", label: "A ping to SERVER works" },
      ],
      correctOptionId: "capture",
      explanation: "FW1's log proves the SYN was permitted and forwarded; only the server side proves arrival. The retransmission proves only that the client got no answer.",
    },
  },
  {
    id: "inc-fw1-session",
    label: "FW1's session table",
    narrative: `FW1: session ${tupleText(I)} — state SYN seen, packets client→server 2, server→client 0. The permit is logged. FW1 never saw a single reply.`,
    run: (s) => ({ state: withNotes(evidence(idle(s), "inc-fw1-session", "FW1", { active: "create", details: { create: sessionText(sessionOf(s, "FW1", I)), policy: `policy log: ${s.policyLog.FW1.filter((x) => x.flow === I).map((x) => `${x.rule} ${x.action}`).join(", ")}` }, action: "SESSION TABLE", reason: "A session stuck waiting for the reply, with zero reverse packets, means the reply never reached this firewall.", key: `show session ${IP.client}:${FLOW[I].sport}`, result: sessionText(sessionOf(s, "FW1", I)) }), "inc-fw1-session", [{ kind: "observation", text: `FW1 session ${sessionOf(s, "FW1", I)!.state}: c→s ${sessionOf(s, "FW1", I)!.c2s}, s→c ${sessionOf(s, "FW1", I)!.s2c}`, source: "FW1 session table", rung: "Policy / service-specific" }, { kind: "inference", text: "The SYN-ACK is returning by a path that does not include FW1" }]), events: [ev("STEP_ENTERED", "inc-fw1-session", "session")] }),
  },
  {
    id: "q-allow",
    label: "Question: ALLOW = working?",
    narrative: `FW1 logged ${POLICY.name} permit.`,
    question: {
      prompt: "Does FW1's policy ALLOW prove the whole connection works?",
      options: [
        { id: "no", label: "No — it proves the first packet was permitted; the connection also needs the reply to return through the state-holding firewall" },
        { id: "yes", label: "Yes — an allowed connection always completes" },
        { id: "bytes", label: "Yes, if the rule's hit counter increments" },
        { id: "dns", label: "Only if DNS works too" },
      ],
      correctOptionId: "no",
      explanation: "A policy log is written when a session is CREATED. The session log (state, reverse packets) tells you whether the connection progressed.",
    },
  },
  {
    id: "q-fw1-state",
    label: "Question: FW1's state",
    narrative: "Look at FW1's session.",
    question: {
      prompt: "What session state exists on FW1?",
      options: [
        { id: "syn", label: "A half-open session: SYN seen, waiting for the SYN-ACK, zero server→client packets" },
        { id: "est", label: "ESTABLISHED" },
        { id: "none", label: "No session at all" },
        { id: "closed", label: "A closed session with a RST" },
      ],
      correctOptionId: "syn",
      explanation: "FW1 did its job and is waiting for a reply that will never arrive there — until the session times out.",
    },
  },
  {
    id: "q-fw2",
    label: "Question: why FW2 drops",
    narrative: "FW2 has the same policy as FW1.",
    question: {
      prompt: "Why does FW2 reject the SYN-ACK?",
      options: [
        { id: "state", label: "FW2 never saw the SYN, so it has no session; a SYN-ACK cannot start a new session, so it is out-of-state and dropped" },
        { id: "policy", label: "FW2's policy is different from FW1's" },
        { id: "port", label: "Port 443 is closed on FW2" },
        { id: "down", label: "FW2 is down" },
      ],
      correctOptionId: "state",
      explanation: "FW2 is behaving correctly. With no state sync, FW1's session is invisible to FW2.",
    },
  },
  {
    id: "inc-routes",
    label: "Compare the two directions",
    narrative: `EDGE-R1: 10.20.20.0/24 via FW1. EDGE-R2: 10.10.10.0/24 via FW2 (${IP.fw2Out}). The request crosses FW1; the reply is routed through FW2.`,
    run: (s) => ({ state: withNotes(evidence(idle(s), "inc-routes", "EDGE-R2", { active: "lookup", details: { lookup: `EDGE-R1 10.20.20.0/24 → FW1 · EDGE-R2 10.10.10.0/24 → ${s.r2Return}` }, action: "ROUTES", reason: "Compare the route for each direction on each side of the firewalls.", key: "show route (both edges)", result: `forward FW1 · return ${s.r2Return}` }), "inc-routes", [{ kind: "observation", text: `Forward path via FW1; EDGE-R2 return route 10.10.10.0/24 via ${s.r2Return}`, source: "EDGE routers", rung: "Routing / forwarding" }, { kind: "hypothesis", text: "EDGE-R2's return route sends replies through FW2, which holds no session" }]), events: [ev("STEP_ENTERED", "inc-routes", "routes")] }),
  },
  {
    id: "q-fw1-never",
    label: "Question: why FW1 sees nothing",
    narrative: "FW1's session shows zero reverse packets.",
    question: {
      prompt: "Why does FW1 never see the broken return packet?",
      options: [
        { id: "route", label: "EDGE-R2 routes 10.10.10.0/24 to FW2, so the SYN-ACK never reaches FW1" },
        { id: "drop", label: "FW1 drops it silently" },
        { id: "server", label: "The server never sends it" },
        { id: "nat", label: "NAT changed its address" },
      ],
      correctOptionId: "route",
      explanation: "The server capture shows the SYN-ACK leaving; EDGE-R2's lookup sends it toward FW2; FW2 logs it. FW1 is simply not on the return path.",
    },
  },
  {
    id: "q-asym",
    label: "Question: two paths, one state table",
    narrative: "Forward through FW1, return through FW2.",
    question: {
      prompt: "What happens to a stateful firewall flow when the reply takes a different path from the request?",
      options: [
        { id: "break", label: "The return traffic arrives at a firewall without the session, and is dropped as out-of-state — unless state is shared or the paths are symmetric" },
        { id: "none", label: "It has no effect — firewalls only check policy" },
        { id: "faster", label: "It makes connections faster" },
        { id: "nat", label: "It only matters with NAT" },
      ],
      correctOptionId: "break",
      explanation: "Stateful devices need to see both directions of a flow. Clusters solve this with state synchronization; independent firewalls need symmetric routing.",
    },
  },
  {
    id: "hypotheses",
    label: "Rule out the other ideas",
    narrative: "Each plausible cause makes a prediction the evidence contradicts.",
    run: (s) => ({ state: withNotes(idle(s), "hypotheses", [
      { kind: "ruled-out", text: "TCP/443 closed — SERVER sent SYN-ACKs, never a RST" },
      { kind: "ruled-out", text: "Server never received the SYN — SERVER capture shows it" },
      { kind: "ruled-out", text: "FW1 outbound policy denied — ALLOW logged, session created" },
      { kind: "ruled-out", text: "DNS — the client connects by IP and its SYN is on the wire" },
      { kind: "ruled-out", text: "Client subnet mask — the SYN reaches the gateway and beyond" },
      { kind: "ruled-out", text: "NAT failure — there is no NAT configured anywhere" },
    ]), events: [ev("STEP_ENTERED", "hypotheses", "ruled out")] }),
    question: {
      prompt: "Why is NAT irrelevant here?",
      options: [
        { id: "none", label: "No NAT is configured: addresses and ports are identical on every link, so there is no translation to fail" },
        { id: "fw2", label: "Because FW2 does the NAT" },
        { id: "443", label: "NAT never applies to port 443" },
        { id: "fix", label: "NAT would be the fix" },
      ],
      correctOptionId: "none",
      explanation: "Keeping NAT out makes the evidence unambiguous: the same five-tuple appears at the client, FW1, SERVER and FW2.",
    },
  },
  {
    id: "q-broad-policy",
    label: "Question: a broad allow on FW2?",
    narrative: "Someone proposes 'just allow dmz → trust from the server on FW2'.",
    question: {
      prompt: "Why is adding a broad reverse policy on FW2 the wrong repair?",
      options: [
        { id: "wrong", label: "It weakens security without fixing the asymmetry: FW2 still has no state, and FW1's half-open session never completes" },
        { id: "right", label: "It is the correct fix" },
        { id: "slow", label: "Policies take too long to apply" },
        { id: "dns", label: "Because DNS would break" },
      ],
      correctOptionId: "wrong",
      explanation: "The later client ACK would still go through FW1, which never saw the SYN-ACK. Fix the path, not the rulebase.",
    },
  },
  {
    id: "diagnostic-layers",
    label: "Walk the evidence ladder",
    narrative: "Start where the evidence already points: the SYN reaches the server, so the lower rungs are proven.",
  },
  {
    id: "predict-cause",
    label: "Predict: root cause",
    narrative: "Put it together.",
    question: {
      prompt: "What is the root cause?",
      options: [
        { id: "route", label: "EDGE-R2 routes 10.10.10.0/24 via FW2, so the return traffic bypasses FW1's session and FW2 drops it as out-of-state" },
        { id: "policy", label: "FW1's policy blocks port 443" },
        { id: "server", label: "SERVER is not listening" },
        { id: "fw2", label: "FW2 is misconfigured and must accept all traffic" },
      ],
      correctOptionId: "route",
      explanation: "FW1 allowed, SERVER answered, EDGE-R2 sent the answer to FW2, FW2 had no state. One route broke path symmetry.",
    },
    run: (s) => ({ state: withNotes(idle(s), "predict-cause", [{ kind: "root-cause", text: "EDGE-R2 return route 10.10.10.0/24 → FW2 (asymmetric path; FW2 has no session)", source: "routes + FW1/FW2 logs + SERVER capture" }]), events: [] }),
  },
  // ---- Repair ---
  {
    id: "repair-challenge",
    label: "Repair the path",
    narrative: "Choose the change that fixes the cause you identified.",
    action: (s, payload) => ({ state: applyFwRepair(s, (payload as { choice: string }).choice), events: [ev("STEP_ENTERED", "repair-challenge", `Repair attempt: ${(payload as { choice: string }).choice}`)] }),
    requiresState: (s) => s.repaired,
  },
  // ---- Verify ---
  {
    id: "ver-syn",
    label: "Verify: new SYN through FW1",
    narrative: `A fresh connection ${tupleText(V)}: SYN → EDGE-R1 → FW1 (permit, new session) → EDGE-R2 → SERVER.`,
    run: (s) => {
      let n = routerHop(clientTx(s, "ver-syn", V, "syn"), "ver-syn", "EDGE-R1", "R1-FW1", V, "syn");
      n = fwProcess(n, "ver-syn", "FW1", V, "syn").state;
      return { state: n, events: [ev("PACKET_SENT", "ver-syn", "SYN")] };
    },
    packet: pkt,
  },
  {
    id: "ver-server",
    label: "Verify: SERVER answers",
    narrative: "SERVER receives the SYN and sends the SYN-ACK.",
    run: (s) => ({ state: serverTx(serverRx(s, "ver-server", V), "ver-server", V), events: [ev("PACKET_SENT", "ver-server", "SYN-ACK")] }),
    packet: pkt,
  },
  {
    id: "ver-r2",
    label: "Verify: EDGE-R2 returns via FW1",
    narrative: "EDGE-R2: 10.10.10.0/24 via FW1 again. The reply follows the request's path.",
    run: (s) => ({ state: routerHop(s, "ver-r2", "EDGE-R2", "FW1-R2", V, "synack"), events: [ev("PACKET_SENT", "ver-r2", "return")] }),
    packet: pkt,
  },
  {
    id: "ver-fw1",
    label: "Verify: FW1 finds its session",
    narrative: "FW1 matches the reverse direction of its session and forwards the SYN-ACK to the client side.",
    run: (s) => ({ state: fwProcess(s, "ver-fw1", "FW1", V, "synack").state, events: [ev("PACKET_SENT", "ver-fw1", "match")] }),
    packet: pkt,
    question: {
      prompt: "What proves path symmetry was restored?",
      options: [
        { id: "both", label: "EDGE-R2's lookup for 10.10.10.10 selects FW1, and FW1's session now counts server→client packets" },
        { id: "config", label: "The route configuration was accepted" },
        { id: "fw2", label: "FW2 is idle" },
        { id: "ping", label: "CLIENT can ping EDGE-R1" },
      ],
      correctOptionId: "both",
      explanation: "Symmetry is proven by the traffic itself: the reverse packets appear on the firewall that holds the state.",
    },
  },
  {
    id: "ver-ack",
    label: "Verify: ESTABLISHED",
    narrative: `CLIENT receives the SYN-ACK and sends the ACK; FW1's session becomes ESTABLISHED with packets in both directions. FW2's drop count has not grown since the repair.`,
    run: (s) => {
      let n = clientTx(s, "ver-ack", V, "ack");
      const sess = sessionOf(n, "FW1", V)!;
      n = { ...n, sessions: { ...n.sessions, FW1: n.sessions.FW1.map((x) => (x.flow === V ? { ...sess, state: "ESTABLISHED" as const, c2s: sess.c2s + 1 } : x)) } };
      return { state: withNotes(n, "ver-ack", [{ kind: "verified", text: `FW1 session ${sessionText(sessionOf(n, "FW1", V))}; FW2 drops unchanged (${n.drops.FW2.length})`, source: "FW1 session table + FW2 log" }]), events: [ev("PACKET_SENT", "ver-ack", "ACK")] };
    },
    packet: pkt,
    question: {
      prompt: "What proves the TCP session is now healthy?",
      options: [
        { id: "est", label: "The three-way handshake completes: the client sends its ACK and FW1's session is ESTABLISHED with traffic in both directions" },
        { id: "syn", label: "The SYN was permitted" },
        { id: "server", label: "SERVER received the SYN" },
        { id: "log", label: "No new FW2 logs appear" },
      ],
      correctOptionId: "est",
      explanation: "The SYN was permitted and received during the incident too. Completion — the client's ACK and an ESTABLISHED session — is what changed.",
    },
  },
  // ---- Complete ---
  {
    id: "operations",
    label: "On real firewalls",
    narrative: "Session and path evidence, vendor-neutral: show the session table filtered by the client address and port (state, packet/byte counters per direction); show the traffic/drop log (reasons such as 'no session' or 'out-of-state'); check the route toward the client on the router behind each firewall; and capture on the server to prove arrival. Exact commands and log wording differ per vendor.",
  },
  {
    id: "complete",
    label: "Lesson complete",
    narrative: "Policy allowed the SYN, the server answered — and one return route sent the answer to a firewall with no state. Found by comparing session counters, drop logs and both directions' routes; fixed by restoring path symmetry, not by weakening policy; proven by an ESTABLISHED session with traffic both ways.",
  },
];
