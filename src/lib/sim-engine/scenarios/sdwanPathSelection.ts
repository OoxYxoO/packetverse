import type { PacketLayer, PacketVisual, PVEvent, PVEventType, ScenarioStep } from "../types";
import type { PacketStackFrame, ProcessingStage } from "@/components/network3d/types";
import type { FundHop } from "@/components/lesson/fundamentalsTrace";
import { ethLayer, icmpLayer, icmpLength, udpLayer, type IcmpEcho } from "./fundamentalsPackets";
import { FCS_LAYER, fieldIn, ip4Frame, ip4Layer, tcpPacket, tcpStack, tupleText, type Ip4, type TcpWire } from "./enterpriseEdgePackets";

/**
 * SD-WAN: SLA-Based Path Selection & Failover — CLIENT — BRANCH-EDGE ═ (ISP-A / TUN-A, ISP-B / TUN-B) ═ HUB-EDGE — APP.
 *
 * This is the PacketVerse generic SD-WAN model. SD-WAN products differ in architecture, overlay encapsulation,
 * measurement mechanism and policy semantics; none of that is presented here as a standard. What is modeled:
 * - Underlay = the ISP circuits (physical/IP transport). Overlay = the logical paths TUN-A / TUN-B built across them.
 *   Physical UP, overlay reachable and SLA-eligible are three different facts.
 * - PacketVerse SLA measurement model: ordinary ICMP Echo probes from the branch loopback 10.255.1.1 to the hub
 *   monitoring loopback, forced onto each overlay path; 500 probes per measurement interval; RTT = mean of the
 *   replies, jitter = mean absolute difference between consecutive RTTs, loss = unanswered / sent. Real products may
 *   use other (proprietary or standards-based) measurements — ICMP is not mandatory.
 * - Probe and customer packets are drawn as the inner packet (Ethernet, IPv4, ICMP / UDP / TCP only). The overlay's
 *   encapsulation is vendor-specific and is not drawn; no SD-WAN header is invented.
 * - Application policy (installed on BRANCH-EDGE, e.g. distributed by a controller): VOICE is SLA-required and
 *   prefers TUN-A then TUN-B; BULK has no SLA requirement and prefers TUN-B then TUN-A. The edge decides locally for
 *   every packet from installed policy + current path state; no controller round-trip per packet.
 * - Eligibility (modeled hysteresis): one failing interval (or no valid result) makes a path ineligible at once; it
 *   becomes eligible again only after 3 consecutive passing intervals. This rule is the lesson's model, not a standard.
 * - Configured VOICE outcome when no path is eligible: do not forward (drop). Other products/policies may fall back.
 * Incident: TUN-B's probe target is mistyped as 10.255.0.99. ISP-B and TUN-B stay up; the monitor gets no valid
 * replies, so TUN-B has no SLA result — and when TUN-A degrades again VOICE has no eligible path.
 */

export type SdDevice = "CLIENT" | "BRANCH-EDGE" | "ISP-A" | "ISP-B" | "HUB-EDGE" | "APP";
export type TunId = "TUN-A" | "TUN-B";
export type AppClass = "VOICE" | "BULK";
export const SD_DEVICES: SdDevice[] = ["CLIENT", "BRANCH-EDGE", "ISP-A", "ISP-B", "HUB-EDGE", "APP"];
export const SD = { client: "10.30.30.10", branchLan: "10.30.30.1", branchLo: "10.255.1.1", hubLo: "10.255.0.1", badTarget: "10.255.0.99", hubLan: "10.40.40.1", app: "10.40.40.20" } as const;
export const SD_MAC = { CLIENT: "00:00:5E:00:53:30", "BR:lan": "00:00:5E:00:53:31", "BR:wan-a": "00:00:5E:00:53:3A", "BR:wan-b": "00:00:5E:00:53:3B", "ISP-A": "00:00:5E:00:53:A0", "ISP-B": "00:00:5E:00:53:B0", "HUB:wan-a": "00:00:5E:00:53:4A", "HUB:wan-b": "00:00:5E:00:53:4B", "HUB:lan": "00:00:5E:00:53:41", APP: "00:00:5E:00:53:42" } as const;
export const TUNNELS: Record<TunId, { isp: "ISP-A" | "ISP-B"; branchWan: string; hubWan: string; ispAddr: string; echoId: number }> = {
  "TUN-A": { isp: "ISP-A", branchWan: "192.0.2.2/30", hubWan: "203.0.113.20", ispAddr: "192.0.2.1", echoId: 0x0a01 },
  "TUN-B": { isp: "ISP-B", branchWan: "198.51.100.6/30", hubWan: "203.0.113.24", ispAddr: "198.51.100.5", echoId: 0x0b01 },
};
export const TUN_IDS: TunId[] = ["TUN-A", "TUN-B"];
export const VOICE_SLA = { rtt: 100, jitter: 30, loss: 1.0 } as const;
export const HYSTERESIS_INTERVALS = 3;
export const PROBES_PER_INTERVAL = 500;
export const INTERVAL_SECONDS = 10;
export const APP_POLICY: Record<AppClass, { match: string; slaRequired: boolean; prefer: TunId[]; noPath: string }> = {
  VOICE: { match: "UDP dst 16384–32767 · DSCP EF (46)", slaRequired: true, prefer: ["TUN-A", "TUN-B"], noPath: "drop (configured: SLA required)" },
  BULK: { match: "TCP dst 873 (backup sync)", slaRequired: false, prefer: ["TUN-B", "TUN-A"], noPath: "drop" },
};
export const VOICE_FLOW = { sport: 16400, dport: 16400, payload: 172, dscp: 46 } as const;
export const BULK_FLOW = { sport: 49152, dport: 873, seq: 100001, ack: 200001, payload: 1200 } as const;
export const INITIAL_TTL = 64;

// ---------------------------------------------------------------------------------------------------------------
// PacketVerse SLA measurement model
// ---------------------------------------------------------------------------------------------------------------
export type Quality = "healthy" | "degraded";
interface Profile {
  lo: number;
  hi: number;
  lost: number[];
}
/** Deterministic per-path conditions. RTTs alternate lo/hi so the mean and jitter are exact; losses remove samples. */
const PROFILES: Record<string, Profile> = {
  "TUN-A:healthy": { lo: 23.5, hi: 26.5, lost: [499] },
  "TUN-B:healthy": { lo: 51, hi: 59, lost: [250, 251] },
  "TUN-A:degraded": { lo: 140, hi: 180, lost: [100, 101, 200, 201, 300, 301, 400, 401, 450, 451] },
  "TUN-B:degraded": { lo: 140, hi: 180, lost: [100, 101, 200, 201, 300, 301, 400, 401, 450, 451] },
};
/** One interval's replies: RTT per probe, or null when no valid Echo Reply came back. */
export function probeSamples(tun: TunId, quality: Quality, target: string): (number | null)[] {
  const p = PROFILES[`${tun}:${quality}`];
  return Array.from({ length: PROBES_PER_INTERVAL }, (_, i) => (target !== SD.hubLo || p.lost.includes(i) ? null : i % 2 === 0 ? p.lo : p.hi));
}
export interface Measurement {
  interval: number;
  target: string;
  sent: number;
  received: number;
  rtt: number | null;
  jitter: number | null;
  loss: number;
  /** The first few samples, kept for inspection. */
  firstSamples: (number | null)[];
}
const r1 = (n: number) => Math.round(n * 10) / 10;
export function summarize(interval: number, target: string, samples: (number | null)[]): Measurement {
  const got = samples.filter((x): x is number => x !== null);
  const rtt = got.length ? r1(got.reduce((a, b) => a + b, 0) / got.length) : null;
  const jitter = got.length > 1 ? r1(got.slice(1).reduce((a, b, i) => a + Math.abs(b - got[i]), 0) / (got.length - 1)) : null;
  return { interval, target, sent: samples.length, received: got.length, rtt, jitter, loss: r1(((samples.length - got.length) / samples.length) * 100), firstSamples: samples.slice(0, 6) };
}
export type SlaResult = "PASS" | "FAIL" | "NO VALID RESULT";
export interface SlaCheck {
  metric: "RTT" | "Jitter" | "Loss";
  value: string;
  threshold: string;
  pass: boolean;
}
export function slaChecks(m: Measurement): SlaCheck[] {
  if (m.received === 0 || m.rtt === null || m.jitter === null) return [];
  return [
    { metric: "RTT", value: `${m.rtt} ms`, threshold: `≤ ${VOICE_SLA.rtt} ms`, pass: m.rtt <= VOICE_SLA.rtt },
    { metric: "Jitter", value: `${m.jitter} ms`, threshold: `≤ ${VOICE_SLA.jitter} ms`, pass: m.jitter <= VOICE_SLA.jitter },
    { metric: "Loss", value: `${m.loss.toFixed(1)}%`, threshold: `≤ ${VOICE_SLA.loss.toFixed(1)}%`, pass: m.loss <= VOICE_SLA.loss },
  ];
}
export const slaResult = (m: Measurement): SlaResult => (m.received === 0 ? "NO VALID RESULT" : slaChecks(m).every((c) => c.pass) ? "PASS" : "FAIL");
export const metricText = (m?: Measurement) => (!m ? "not measured" : m.received === 0 ? `0/${m.sent} replies — no valid measurement` : `${m.rtt} ms / ${m.jitter} ms / ${m.loss.toFixed(1)}%`);

// ---------------------------------------------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------------------------------------------
export interface Tun {
  id: TunId;
  underlay: "UP";
  overlay: "REACHABLE";
  quality: Quality;
  target: string;
  probesSent: number;
  last: Measurement;
  sla: SlaResult;
  eligible: boolean;
  /** Consecutive passing intervals counted while the path is ineligible (modeled hysteresis). */
  streak: number;
}
export interface SdState {
  hops: FundHop[];
  packet?: PacketVisual;
  flood: { id: string; fromId: string; toId: string; packet: PacketVisual }[];
  tun: Record<TunId, Tun>;
  interval: number;
  selection: Record<AppClass, TunId | "NONE">;
  app: { voice: number; bulk: number };
  lastProbe?: { tun: TunId; seq: number; target: string; rtt: number | null };
  decision?: { device: SdDevice; text: string };
  faultActive: boolean;
  repairAttempt?: { choice: string; correct: boolean };
  repaired: boolean;
}
function freshTun(id: TunId): Tun {
  const last = summarize(0, SD.hubLo, probeSamples(id, "healthy", SD.hubLo));
  return { id, underlay: "UP", overlay: "REACHABLE", quality: "healthy", target: SD.hubLo, probesSent: PROBES_PER_INTERVAL, last, sla: slaResult(last), eligible: true, streak: 0 };
}
export function createSdState(): SdState {
  const s: SdState = { hops: [], flood: [], tun: { "TUN-A": freshTun("TUN-A"), "TUN-B": freshTun("TUN-B") }, interval: 0, selection: { VOICE: "TUN-A", BULK: "TUN-B" }, app: { voice: 0, bulk: 0 }, faultActive: false, repaired: false };
  return { ...s, selection: selectAll(s) };
}

/** SLA-required classes use only eligible paths; others use any reachable path — each in its preference order. */
export function selectPath(s: SdState, c: AppClass): TunId | "NONE" {
  const p = APP_POLICY[c];
  return p.prefer.find((t) => s.tun[t].underlay === "UP" && s.tun[t].overlay === "REACHABLE" && (!p.slaRequired || s.tun[t].eligible)) ?? "NONE";
}
export const selectAll = (s: SdState): Record<AppClass, TunId | "NONE"> => ({ VOICE: selectPath(s, "VOICE"), BULK: selectPath(s, "BULK") });
export const eligibleSet = (s: SdState) => TUN_IDS.filter((t) => s.tun[t].eligible);

/** Close one measurement interval on a path and apply the modeled eligibility/hysteresis rule. */
export function measureInterval(t: Tun, interval: number): Tun {
  const last = summarize(interval, t.target, probeSamples(t.id, t.quality, t.target));
  const sla = slaResult(last);
  if (sla !== "PASS") return { ...t, last, sla, eligible: false, streak: 0, probesSent: t.probesSent + PROBES_PER_INTERVAL };
  if (t.eligible) return { ...t, last, sla, streak: 0, probesSent: t.probesSent + PROBES_PER_INTERVAL };
  const streak = t.streak + 1;
  return { ...t, last, sla, streak, eligible: streak >= HYSTERESIS_INTERVALS, probesSent: t.probesSent + PROBES_PER_INTERVAL };
}
export const tunStatus = (t: Tun) => (t.eligible ? "SLA-eligible" : t.sla === "NO VALID RESULT" ? "reachable · no valid SLA result" : t.sla === "FAIL" ? "reachable but SLA-ineligible" : `reachable · recovering ${t.streak}/${HYSTERESIS_INTERVALS}`);

// ---------------------------------------------------------------------------------------------------------------
// Packets (Ethernet + IPv4 + ICMP / UDP / TCP only)
// ---------------------------------------------------------------------------------------------------------------
type Hop = `${SdDevice}>${SdDevice}`;
const ETH: Partial<Record<Hop, [string, string]>> = {
  "CLIENT>BRANCH-EDGE": [SD_MAC.CLIENT, SD_MAC["BR:lan"]],
  "BRANCH-EDGE>ISP-A": [SD_MAC["BR:wan-a"], SD_MAC["ISP-A"]],
  "ISP-A>HUB-EDGE": [SD_MAC["ISP-A"], SD_MAC["HUB:wan-a"]],
  "HUB-EDGE>ISP-A": [SD_MAC["HUB:wan-a"], SD_MAC["ISP-A"]],
  "ISP-A>BRANCH-EDGE": [SD_MAC["ISP-A"], SD_MAC["BR:wan-a"]],
  "BRANCH-EDGE>ISP-B": [SD_MAC["BR:wan-b"], SD_MAC["ISP-B"]],
  "ISP-B>HUB-EDGE": [SD_MAC["ISP-B"], SD_MAC["HUB:wan-b"]],
  "HUB-EDGE>ISP-B": [SD_MAC["HUB:wan-b"], SD_MAC["ISP-B"]],
  "ISP-B>BRANCH-EDGE": [SD_MAC["ISP-B"], SD_MAC["BR:wan-b"]],
  "HUB-EDGE>APP": [SD_MAC["HUB:lan"], SD_MAC.APP],
};
const eth = (from: SdDevice, to: SdDevice) => ETH[`${from}>${to}`]!;

export function probePacket(id: string, from: SdDevice, to: SdDevice, tun: TunId, seq: number, target: string, reply: boolean): PacketVisual {
  const echo: IcmpEcho = { kind: reply ? "echo-reply" : "echo-request", identifier: TUNNELS[tun].echoId, sequence: seq, dataLength: 32 };
  const ip: Ip4 = reply ? { src: target, dst: SD.branchLo, ttl: INITIAL_TTL, protocol: 1, payloadLength: icmpLength(echo), id: 0x7000 + (seq % 0x1000), df: false } : { src: SD.branchLo, dst: target, ttl: INITIAL_TTL, protocol: 1, payloadLength: icmpLength(echo), id: 0x6000 + (seq % 0x1000), df: false };
  const [s, d] = eth(from, to);
  return { id, protocol: "IP", from, to, badge: reply ? "ECHO REPLY" : "ECHO", summary: `ICMP ${reply ? "Echo Reply" : "Echo Request"} — ${ip.src} → ${ip.dst} · id ${echo.identifier} seq ${seq}`, layers: [ethLayer(s, d), ip4Layer(ip), icmpLayer(echo), FCS_LAYER] };
}
export function voicePacket(id: string, from: SdDevice, to: SdDevice, ttl: number, ipId: number): PacketVisual {
  const [s, d] = eth(from, to);
  const ip: Ip4 = { src: SD.client, dst: SD.app, ttl, protocol: 17, payloadLength: 8 + VOICE_FLOW.payload, id: ipId, df: false, dscp: VOICE_FLOW.dscp };
  const payload: PacketLayer = { name: "UDP Payload", color: "#fbbf24", fields: [{ label: "Application data", value: `${VOICE_FLOW.payload} bytes (voice media)` }] };
  return { id, protocol: "IP", from, to, badge: "VOICE", summary: `UDP — ${tupleText(SD.client, VOICE_FLOW.sport)} → ${tupleText(SD.app, VOICE_FLOW.dport)} · DSCP EF`, layers: [ethLayer(s, d), ip4Layer(ip), udpLayer(VOICE_FLOW.sport, VOICE_FLOW.dport, VOICE_FLOW.payload), payload, FCS_LAYER] };
}
export function bulkPacket(id: string, from: SdDevice, to: SdDevice, ttl: number, ipId: number): PacketVisual {
  const [s, d] = eth(from, to);
  const w: TcpWire = { src: SD.client, dst: SD.app, ttl, ipId, seg: { sport: BULK_FLOW.sport, dport: BULK_FLOW.dport, seq: BULK_FLOW.seq, ack: BULK_FLOW.ack, flags: ["PSH", "ACK"], payloadLength: BULK_FLOW.payload } };
  return tcpPacket(id, from, to, s, d, w);
}
export const isProbe = (p: PacketVisual) => p.layers.some((l) => l.name === "ICMP Message");
export const isVoice = (p: PacketVisual) => p.badge === "VOICE";
export function sdStack(p: PacketVisual): PacketStackFrame[] {
  if (p.layers.some((l) => l.name === "TCP Header")) return tcpStack(p);
  const out: PacketStackFrame[] = [{ id: "eth", text: `Ethernet · dst ${fieldIn(p, /^Ethernet/, "Destination MAC")} · src ${fieldIn(p, /^Ethernet/, "Source MAC")}`, tone: "generic" }, ip4Frame(p)];
  if (isProbe(p)) out.push({ id: "icmp", text: `ICMP · type ${fieldIn(p, /^ICMP/, "Type")} · id ${fieldIn(p, /^ICMP/, "Identifier").split(" ")[0]} · seq ${fieldIn(p, /^ICMP/, "Sequence Number")}`, tone: "transport" });
  else out.push({ id: "udp", text: `UDP · ${fieldIn(p, /^UDP/, "Source Port")} → ${fieldIn(p, /^UDP/, "Destination Port")} · DSCP ${fieldIn(p, /^IPv4/, "DSCP").split(" ")[0]}`, tone: "transport" });
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Stages and hop helpers
// ---------------------------------------------------------------------------------------------------------------
export const EDGE_STAGES: ProcessingStage[] = [
  { id: "rx", label: "Receive on LAN" },
  { id: "classify", label: "Classify: application class" },
  { id: "policy", label: "Installed application policy (local)" },
  { id: "paths", label: "Current path state: reachable · SLA · eligible" },
  { id: "select", label: "Select path by preference" },
  { id: "tx", label: "Send into the overlay (encapsulation not drawn)" },
];
export const PROBE_STAGES: ProcessingStage[] = [
  { id: "probe", label: "Send ICMP Echo probe on one path" },
  { id: "reply", label: "Match Echo Reply → RTT sample" },
  { id: "window", label: "Interval: RTT · jitter · loss from 500 samples" },
  { id: "sla", label: "Compare with the Voice SLA" },
  { id: "eligible", label: "Eligibility (modeled 3-interval recovery)" },
];
export const HUB_STAGES: ProcessingStage[] = [
  { id: "rx", label: "Receive from the overlay path" },
  { id: "lookup", label: "Inner destination: loopback, APP LAN or nothing" },
  { id: "tx", label: "Answer the probe / forward to APP" },
];
export const ISP_STAGES: ProcessingStage[] = [
  { id: "rx", label: "Receive encapsulated overlay traffic" },
  { id: "route", label: "Route on the underlay (outer) addresses" },
  { id: "tx", label: "Forward — the inner packet is untouched" },
];
export const CLIENT_STAGES: ProcessingStage[] = [
  { id: "app", label: "Application sends" },
  { id: "tx", label: "To default gateway 10.30.30.1" },
];
export const APP_STAGES: ProcessingStage[] = [
  { id: "rx", label: "Receive" },
  { id: "app", label: "Deliver to the service" },
];
const STAGES: Record<SdDevice, ProcessingStage[]> = { CLIENT: CLIENT_STAGES, "BRANCH-EDGE": EDGE_STAGES, "ISP-A": ISP_STAGES, "ISP-B": ISP_STAGES, "HUB-EDGE": HUB_STAGES, APP: APP_STAGES };
export const stagesFor = (d: SdDevice) => STAGES[d];
const withDetail = (base: ProcessingStage[], d: Partial<Record<string, string>>): ProcessingStage[] => base.map((x) => (d[x.id] ? { ...x, detail: d[x.id] } : x));
const ev = (type: PVEventType, stepId: string, message: string): PVEvent => ({ type, stepId, timestamp: Date.now(), message });
const idle = (s: SdState): SdState => ({ ...s, packet: undefined, flood: [], decision: undefined });

function hop(stepId: string, device: SdDevice, o: { stages?: ProcessingStage[]; active: string; details: Partial<Record<string, string>>; lookupType: string; key: string; result: string; action: string; reason: string; input: string; output: string; ingress?: string; egress?: string; next?: SdDevice; before?: PacketVisual; after?: PacketVisual }): FundHop {
  return { stepId, device, stages: withDetail(o.stages ?? STAGES[device], o.details), activeStageId: o.active, ingressInterfaceId: o.ingress, egressInterfaceId: o.egress, lookupType: o.lookupType, lookupKey: o.key, lookupResult: o.result, action: o.action, reason: o.reason, input: o.input, output: o.output, nextHopId: o.next, before: o.before ? sdStack(o.before) : undefined, after: o.after ? sdStack(o.after) : undefined };
}
const wanOf = (t: TunId) => (t === "TUN-A" ? "wan-a" : "wan-b");
const pathLine = (s: SdState, t: TunId) => `${t}: ISP ${s.tun[t].underlay} · overlay ${s.tun[t].overlay} · ${metricText(s.tun[t].last)} · SLA ${s.tun[t].sla} · ${tunStatus(s.tun[t])}`;
const ispHop = (stepId: string, t: TunId, dir: "to-hub" | "to-branch", p: PacketVisual): FundHop =>
  hop(stepId, TUNNELS[t].isp, { active: "tx", details: { rx: `${t} traffic on the ${TUNNELS[t].isp} circuit`, route: dir === "to-hub" ? `outer destination hub ${TUNNELS[t].hubWan}` : `outer destination branch ${TUNNELS[t].branchWan.split("/")[0]}` }, lookupType: `${TUNNELS[t].isp} underlay routing`, key: dir === "to-hub" ? `→ ${TUNNELS[t].hubWan}` : `→ ${TUNNELS[t].branchWan.split("/")[0]}`, result: "forward", action: "UNDERLAY TRANSIT", reason: `${TUNNELS[t].isp} carries ${t}'s encapsulated packets between the branch and hub WAN addresses. It never sees the SD-WAN policy, and it does not route 10.x addresses — those are inside the overlay.`, input: `${t} (encapsulated)`, output: dir === "to-hub" ? "toward HUB-EDGE" : "toward BRANCH-EDGE", ingress: dir === "to-hub" ? "branch" : "hub", egress: dir === "to-hub" ? "hub" : "branch", next: dir === "to-hub" ? "HUB-EDGE" : "BRANCH-EDGE", before: p });

// ---------------------------------------------------------------------------------------------------------------
// Step builders
// ---------------------------------------------------------------------------------------------------------------
/** A probe request reaching the hub over one path; the hub answers only if the target is its loopback. */
function probeOut(s: SdState, stepId: string, t: TunId): SdState {
  const x = s.tun[t];
  const seq = x.probesSent + 1;
  const sent = probePacket(`${stepId}-req0`, "BRANCH-EDGE", TUNNELS[t].isp, t, seq, x.target, false);
  const arriving = probePacket(`${stepId}-req`, TUNNELS[t].isp, "HUB-EDGE", t, seq, x.target, false);
  const answered = x.target === SD.hubLo;
  const br = hop(stepId, "BRANCH-EDGE", { stages: PROBE_STAGES, active: "probe", details: { probe: `Echo Request id ${TUNNELS[t].echoId} seq ${seq} → ${x.target}, forced onto ${t}` }, lookupType: "BRANCH-EDGE SLA monitor", key: `${t} probe target`, result: x.target, action: `PROBE ${t}`, reason: `PacketVerse SLA measurement model: an ordinary ICMP Echo from the branch loopback ${SD.branchLo} to the configured target, sent on ${t} only. The packet carries nothing about SLA — the results live on BRANCH-EDGE.`, input: `monitor ${t}`, output: `Echo Request → ${x.target}`, egress: wanOf(t), next: TUNNELS[t].isp, after: sent });
  const hub = hop(stepId, "HUB-EDGE", answered ? { active: "tx", details: { rx: `from ${t}`, lookup: `${x.target} = monitoring loopback`, tx: "Echo Reply back on the same path" }, lookupType: "HUB-EDGE local addresses", key: `destination ${x.target}`, result: "local loopback → reply", action: "PROBE ANSWERED", reason: `${SD.hubLo} is HUB-EDGE's monitoring loopback, so it answers — on the path the probe arrived on.`, input: `Echo Request seq ${seq}`, output: "Echo Reply", ingress: wanOf(t), egress: wanOf(t), before: arriving } : { active: "lookup", details: { rx: `from ${t}`, lookup: `${x.target}: not a local address, no route` }, lookupType: "HUB-EDGE local addresses", key: `destination ${x.target}`, result: "no such address — no Echo Reply", action: "NO VALID REPLY", reason: `Nothing at HUB-EDGE owns ${x.target}. In this model the probe is dropped silently; even an ICMP error would not be the Echo Reply the monitor waits for. The tunnel itself delivered the probe fine.`, input: `Echo Request seq ${seq}`, output: "dropped", ingress: wanOf(t), before: arriving });
  return { ...idle(s), hops: [...s.hops, br, ispHop(stepId, t, "to-hub", sent), hub], packet: arriving, lastProbe: { tun: t, seq, target: x.target, rtt: null }, decision: { device: "HUB-EDGE", text: answered ? `HUB-EDGE: ${x.target} is my loopback → reply` : `HUB-EDGE: ${x.target} unknown → no reply` } };
}
/** The Echo Reply arriving back at BRANCH-EDGE: one RTT sample. */
function probeBack(s: SdState, stepId: string, t: TunId): SdState {
  const x = s.tun[t];
  const seq = x.probesSent + 1;
  const sample = probeSamples(t, x.quality, x.target)[0]!;
  const sent = probePacket(`${stepId}-rep0`, "HUB-EDGE", TUNNELS[t].isp, t, seq, x.target, true);
  const arriving = probePacket(`${stepId}-rep`, TUNNELS[t].isp, "BRANCH-EDGE", t, seq, x.target, true);
  const br = hop(stepId, "BRANCH-EDGE", { stages: PROBE_STAGES, active: "reply", details: { probe: `seq ${seq} → ${x.target}`, reply: `Echo Reply matched (id ${TUNNELS[t].echoId}, seq ${seq}) · RTT sample ${sample} ms` }, lookupType: "BRANCH-EDGE SLA monitor", key: `${t} seq ${seq}`, result: `RTT ${sample} ms`, action: "RTT SAMPLE", reason: "One reply is one sample. The SLA decision is made on a whole interval of samples, never on a single probe.", input: "Echo Reply", output: `sample ${sample} ms`, ingress: wanOf(t), before: arriving });
  return { ...idle(s), hops: [...s.hops, ispHop(stepId, t, "to-branch", sent), br], packet: arriving, lastProbe: { tun: t, seq, target: x.target, rtt: sample }, decision: { device: "BRANCH-EDGE", text: `BRANCH-EDGE: ${t} sample ${sample} ms` } };
}
/** Close an interval on the listed paths, re-run selection and record the monitor hop. */
function intervalStep(s: SdState, stepId: string, which: TunId[], patch: Partial<Record<TunId, Partial<Tun>>> = {}): SdState {
  const interval = s.interval + 1;
  const tun = { ...s.tun };
  for (const t of TUN_IDS) tun[t] = { ...tun[t], ...(patch[t] ?? {}) };
  for (const t of which) tun[t] = measureInterval(tun[t], interval);
  const next: SdState = { ...idle(s), tun, interval };
  const selection = selectAll(next);
  const detail = which.map((t) => `${t} ${metricText(tun[t].last)} → ${tun[t].sla}`).join(" · ");
  const h = hop(stepId, "BRANCH-EDGE", {
    stages: PROBE_STAGES,
    active: "eligible",
    details: { window: `interval ${interval}: ${detail}`, sla: which.map((t) => `${t}: ${slaChecks(tun[t].last).map((c) => `${c.metric} ${c.value} ${c.pass ? "✓" : "✗"}`).join(", ") || "no valid result"}`).join(" · "), eligible: TUN_IDS.map((t) => `${t} ${tunStatus(tun[t])}`).join(" · ") },
    lookupType: "BRANCH-EDGE SLA monitor",
    key: `interval ${interval}`,
    result: `eligible: ${TUN_IDS.filter((t) => tun[t].eligible).join(", ") || "none"} · VOICE → ${selection.VOICE} · BULK → ${selection.BULK}`,
    action: `INTERVAL ${interval}`,
    reason: "Each interval turns 500 probe results into RTT, jitter and loss, compares them with the Voice SLA, and applies the modeled eligibility rule: fail → ineligible at once; recover → only after 3 passing intervals in a row.",
    input: which.map((t) => `${t}: ${PROBES_PER_INTERVAL} probes`).join(" · "),
    output: TUN_IDS.map((t) => `${t} ${tunStatus(tun[t])}`).join(" · "),
  });
  return { ...next, selection, hops: [...s.hops, h], decision: { device: "BRANCH-EDGE", text: `VOICE → ${selection.VOICE} · BULK → ${selection.BULK}` } };
}

/** CLIENT sends one flow's packet to BRANCH-EDGE. */
function clientSend(s: SdState, stepId: string, c: AppClass, ipId: number): SdState {
  const p = c === "VOICE" ? voicePacket(`${stepId}-c`, "CLIENT", "BRANCH-EDGE", INITIAL_TTL, ipId) : bulkPacket(`${stepId}-c`, "CLIENT", "BRANCH-EDGE", INITIAL_TTL, ipId);
  const h = hop(stepId, "CLIENT", { active: "tx", details: { app: c === "VOICE" ? `voice call media · UDP ${VOICE_FLOW.sport} → ${VOICE_FLOW.dport} · DSCP EF` : `backup sync · TCP ${BULK_FLOW.sport} → ${BULK_FLOW.dport}`, tx: `to ${SD.branchLan}` }, lookupType: "CLIENT routing", key: `destination ${SD.app}`, result: `via ${SD.branchLan}`, action: `SEND ${c}`, reason: "An ordinary application packet. The client knows nothing about tunnels, probes or SLAs.", input: "(originated here)", output: `${SD.client} → ${SD.app}`, egress: "eth0", next: "BRANCH-EDGE", after: p });
  return { ...idle(s), hops: [...s.hops, h], packet: p, decision: { device: "CLIENT", text: `CLIENT → BRANCH-EDGE (${c})` } };
}

/** BRANCH-EDGE classifies and steers one packet (or drops it under the configured SLA-required policy). */
function edgeSteer(s: SdState, stepId: string, c: AppClass, ipId: number, extraHops: FundHop[] = []): SdState {
  const pol = APP_POLICY[c];
  const chosen = selectPath(s, c);
  const inP = c === "VOICE" ? voicePacket(`${stepId}-in`, "CLIENT", "BRANCH-EDGE", INITIAL_TTL, ipId) : bulkPacket(`${stepId}-in`, "CLIENT", "BRANCH-EDGE", INITIAL_TTL, ipId);
  const pathsDetail = pol.prefer.map((t) => `${t} ${s.tun[t].overlay.toLowerCase()} · ${pol.slaRequired ? (s.tun[t].eligible ? "SLA-eligible" : tunStatus(s.tun[t])) : "no SLA needed"}`).join(" · ");
  if (chosen === "NONE") {
    const h = hop(stepId, "BRANCH-EDGE", { active: "select", details: { rx: `${SD.client} → ${SD.app}`, classify: `${c} (${pol.match})`, policy: `SLA required · prefer ${pol.prefer.join(" → ")} · no eligible path: ${pol.noPath}`, paths: pathsDetail, select: "no eligible path → DROP (configured policy outcome)" }, lookupType: "BRANCH-EDGE application policy", key: `${c} flow`, result: "no eligible path · dropped", action: `${c} · NO ELIGIBLE PATH · DROP`, reason: `This lesson's VOICE policy is configured SLA-required with no fallback: with zero eligible paths the flow is not forwarded. That is the configured PacketVerse outcome — other products or policies may instead fall back to the best available path.`, input: `${c} ${SD.client} → ${SD.app}`, output: "dropped", ingress: "lan", before: inP });
    return { ...idle(s), hops: [...s.hops, ...extraHops, h], packet: inP, selection: selectAll(s), decision: { device: "BRANCH-EDGE", text: `BRANCH-EDGE: ${c} — no eligible path · DROP (configured)` } };
  }
  const isp = TUNNELS[chosen].isp;
  const out = c === "VOICE" ? voicePacket(`${stepId}-out`, "BRANCH-EDGE", isp, INITIAL_TTL - 1, ipId) : bulkPacket(`${stepId}-out`, "BRANCH-EDGE", isp, INITIAL_TTL - 1, ipId);
  const h = hop(stepId, "BRANCH-EDGE", { active: "tx", details: { rx: `${SD.client} → ${SD.app}`, classify: `${c} (${pol.match})`, policy: `${pol.slaRequired ? "SLA required" : "no SLA requirement"} · prefer ${pol.prefer.join(" → ")}`, paths: pathsDetail, select: `${chosen}${chosen !== pol.prefer[0] ? ` (preferred ${pol.prefer[0]} not usable)` : " (first preference)"}`, tx: `into ${chosen} via ${isp} · inner TTL ${INITIAL_TTL} → ${INITIAL_TTL - 1}` }, lookupType: "BRANCH-EDGE application policy", key: `${c} flow`, result: `→ ${chosen}`, action: `${c} → ${chosen}`, reason: `Decided locally on BRANCH-EDGE from installed policy and current path state — no controller round-trip for this packet. ${pol.slaRequired ? `VOICE may only use SLA-eligible paths.` : "BULK only needs a reachable path."}`, input: `${c} ${SD.client} → ${SD.app}`, output: `${chosen} (${isp})`, ingress: "lan", egress: wanOf(chosen), next: isp, before: inP, after: out });
  return { ...idle(s), hops: [...s.hops, ...extraHops, h], packet: out, selection: selectAll(s), decision: { device: "BRANCH-EDGE", text: `BRANCH-EDGE: ${c} → ${chosen}${pol.slaRequired ? " (SLA-eligible)" : ""}` } };
}
/** The flow crosses its ISP, HUB-EDGE decapsulates and forwards to APP. `show` picks which leg is animated. */
function toApp(s: SdState, stepId: string, c: AppClass, ipId: number, show: "hub" | "app"): SdState {
  const t = s.selection[c] as TunId;
  const isp = TUNNELS[t].isp;
  const mk = (id: string, from: SdDevice, to: SdDevice, ttl: number) => (c === "VOICE" ? voicePacket(id, from, to, ttl, ipId) : bulkPacket(id, from, to, ttl, ipId));
  const leg1 = mk(`${stepId}-isp0`, "BRANCH-EDGE", isp, INITIAL_TTL - 1);
  const atHub = mk(`${stepId}-hub`, isp, "HUB-EDGE", INITIAL_TTL - 1);
  const toAppP = mk(`${stepId}-app`, "HUB-EDGE", "APP", INITIAL_TTL - 2);
  const hub = hop(stepId, "HUB-EDGE", { active: "tx", details: { rx: `${c} from ${t}`, lookup: `${SD.app} on the APP LAN`, tx: `inner TTL ${INITIAL_TTL - 1} → ${INITIAL_TTL - 2} → APP` }, lookupType: "HUB-EDGE forwarding", key: `destination ${SD.app}`, result: "APP LAN", action: `${c} from ${t} → APP`, reason: "The hub removes the overlay encapsulation (vendor-specific, not drawn) and routes the original packet. Both paths lead to this same site.", input: `${c} via ${t}`, output: "to APP", ingress: wanOf(t), egress: "lan", next: "APP", before: atHub, after: toAppP });
  const app = hop(stepId, "APP", { active: "app", details: { rx: `${SD.client} → ${SD.app}`, app: c === "VOICE" ? "voice media received" : "backup data received" }, lookupType: "APP", key: `${c} flow`, result: "delivered", action: "RECEIVE", reason: "The application sees an ordinary packet — it cannot tell which WAN path carried it.", input: `${c}`, output: "delivered", ingress: "eth0" });
  const counts = c === "VOICE" ? { ...s.app, voice: s.app.voice + 1 } : { ...s.app, bulk: s.app.bulk + 1 };
  return { ...idle(s), hops: [...s.hops, ispHop(stepId, t, "to-hub", leg1), hub, app], packet: show === "hub" ? atHub : toAppP, app: counts, decision: { device: show === "hub" ? "HUB-EDGE" : "APP", text: `${c} via ${t} → APP` } };
}

// ---------------------------------------------------------------------------------------------------------------
// Repair
// ---------------------------------------------------------------------------------------------------------------
export const SD_REPAIR_OPTIONS = [
  { id: "fix-target", label: "Set TUN-B's SLA probe target back to 10.255.0.1 (the hub monitoring loopback)" },
  { id: "raise-rtt", label: "Raise the Voice RTT threshold to 500 ms" },
  { id: "shut-ispa", label: "Shut down the ISP-A circuit" },
  { id: "change-dns", label: "Change the branch DNS servers" },
  { id: "clear-arp", label: "Clear CLIENT's ARP cache" },
] as const;
export const SD_REPAIR_CORRECT = "fix-target";
export function applySdRepair(s: SdState, choice: string): SdState {
  const correct = choice === SD_REPAIR_CORRECT;
  if (!correct) return { ...s, repairAttempt: { choice, correct } };
  return { ...idle(s), tun: { ...s.tun, "TUN-B": { ...s.tun["TUN-B"], target: SD.hubLo } }, repairAttempt: { choice, correct }, repaired: true, faultActive: false, decision: { device: "BRANCH-EDGE", text: `TUN-B probe target → ${SD.hubLo}` } };
}

// ---------------------------------------------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------------------------------------------
const pkt = (s: SdState) => s.packet;
const note = (s: SdState, stepId: string, o: { active: string; details: Partial<Record<string, string>>; action: string; reason: string; key: string; result: string; stages?: ProcessingStage[] }): SdState => ({ ...s, hops: [...s.hops, hop(stepId, "BRANCH-EDGE", { ...o, lookupType: "BRANCH-EDGE", input: o.key, output: o.result })] });
const selLine = (s: SdState) => `VOICE → ${s.selection.VOICE} · BULK → ${s.selection.BULK}`;

export const sdwanSteps: ScenarioStep<SdState>[] = [
  {
    id: "intro",
    label: "One branch, two ISPs, one hub",
    narrative: `CLIENT (${SD.client}) at a branch uses APP (${SD.app}) at the hub site. BRANCH-EDGE has two Internet circuits — ISP-A and ISP-B — and builds one overlay path across each: TUN-A and TUN-B, both ending at HUB-EDGE. This lesson is the PacketVerse generic SD-WAN model: real products differ, and no SD-WAN wire format is invented here.`,
  },
  {
    id: "underlay-overlay",
    label: "Underlay, overlay, application",
    narrative: "Three layers to keep apart. Underlay: the ISP circuits (physical and IP transport). Overlay: TUN-A and TUN-B, logical paths built across that transport (their encapsulation is vendor-specific and not drawn). Application flows: customer traffic that BRANCH-EDGE steers onto one overlay path at a time.",
    run: (s) => ({ state: note(idle(s), "underlay-overlay", { active: "paths", details: { paths: TUN_IDS.map((t) => `${t} over ${TUNNELS[t].isp}: circuit ${s.tun[t].underlay} · overlay ${s.tun[t].overlay}`).join(" · ") }, action: "PATHS", reason: "A circuit being up and a tunnel being reachable are facts about transport. Whether a path is GOOD ENOUGH for an application is a separate, measured fact.", key: "underlay / overlay", result: "2 circuits UP · 2 overlays reachable" }), events: [ev("STEP_ENTERED", "underlay-overlay", "Paths")] }),
  },
  {
    id: "policies",
    label: "Application policy",
    narrative: `Installed on BRANCH-EDGE (in real deployments often distributed by a controller or orchestrator): VOICE — ${APP_POLICY.VOICE.match} — SLA required (RTT ≤ ${VOICE_SLA.rtt} ms, jitter ≤ ${VOICE_SLA.jitter} ms, loss ≤ ${VOICE_SLA.loss.toFixed(1)}%), prefer TUN-A then TUN-B. BULK — ${APP_POLICY.BULK.match} — no SLA requirement, prefer TUN-B then TUN-A.`,
    run: (s) => ({ state: note(idle(s), "policies", { active: "policy", details: { policy: `VOICE: SLA required · ${APP_POLICY.VOICE.prefer.join(" → ")} · BULK: ${APP_POLICY.BULK.prefer.join(" → ")}` }, action: "POLICY INSTALLED", reason: "Two traffic classes, two different preferences: path choice depends on the application, not on one global default route.", key: "application policy", result: "VOICE · BULK" }), events: [ev("STEP_ENTERED", "policies", "Policy")] }),
  },
  {
    id: "predict-physical",
    label: "Predict: is UP good enough?",
    narrative: "Both ISP circuits are UP and both overlays are reachable.",
    question: {
      prompt: "Does a physically UP circuit guarantee that its path is SLA-eligible for Voice?",
      options: [
        { id: "no", label: "No — eligibility depends on measured RTT, jitter and loss; an UP circuit can still be too slow or lossy" },
        { id: "yes", label: "Yes — if the circuit is up, the path is good" },
        { id: "overlay", label: "Yes, as long as the tunnel is also reachable" },
        { id: "never", label: "No — UP circuits are never eligible until a controller approves them" },
      ],
      correctOptionId: "no",
      explanation: "Link state answers \"is it connected?\". The SLA answers \"is it good enough for this application right now?\" — which only measurement can tell.",
    },
  },
  {
    id: "probe-a",
    label: "Probe TUN-A",
    narrative: `PacketVerse SLA measurement model: BRANCH-EDGE sends ordinary ICMP Echo Requests from ${SD.branchLo} to the hub monitoring loopback ${SD.hubLo}, forced onto TUN-A. The packet is plain Ethernet + IPv4 + ICMP; the SLA result will live on BRANCH-EDGE, not in any header. (ICMP is this lesson's choice — real products may measure differently.)`,
    run: (s) => ({ state: probeOut(s, "probe-a", "TUN-A"), events: [ev("PACKET_SENT", "probe-a", "Probe TUN-A")] }),
    packet: pkt,
  },
  {
    id: "probe-a-reply",
    label: "TUN-A answers",
    narrative: "HUB-EDGE owns 10.255.0.1 and answers on the same path. BRANCH-EDGE matches the Echo Reply to its request and records one RTT sample.",
    run: (s) => ({ state: probeBack(s, "probe-a-reply", "TUN-A"), events: [ev("PACKET_RECEIVED", "probe-a-reply", "Sample")] }),
    packet: pkt,
  },
  {
    id: "probe-b",
    label: "Probe TUN-B",
    narrative: `The same probe, forced onto TUN-B over ISP-B, to the same target ${SD.hubLo}.`,
    run: (s) => ({ state: probeOut(s, "probe-b", "TUN-B"), events: [ev("PACKET_SENT", "probe-b", "Probe TUN-B")] }),
    packet: pkt,
  },
  {
    id: "probe-b-reply",
    label: "TUN-B answers",
    narrative: "Another reply, another sample — longer, because ISP-B's path is longer.",
    run: (s) => ({ state: probeBack(s, "probe-b-reply", "TUN-B"), events: [ev("PACKET_RECEIVED", "probe-b-reply", "Sample")] }),
    packet: pkt,
  },
  {
    id: "measure-healthy",
    label: "An interval of measurements",
    narrative: `Each ${INTERVAL_SECONDS}-second interval collects ${PROBES_PER_INTERVAL} probes per path. RTT = mean of the replies, jitter = mean difference between consecutive RTTs, loss = unanswered / sent. TUN-A: 25 ms / 3 ms / 0.2%. TUN-B: 55 ms / 8 ms / 0.4%. Both inside the Voice SLA — both eligible.`,
    run: (s) => ({ state: intervalStep(s, "measure-healthy", ["TUN-A", "TUN-B"]), events: [ev("STEP_ENTERED", "measure-healthy", "Interval")] }),
    whatChanged: (_p, n) => TUN_IDS.map((t) => pathLine(n, t)),
  },
  {
    id: "voice-send",
    label: "A voice packet",
    narrative: `CLIENT sends voice media: UDP ${VOICE_FLOW.sport} → ${VOICE_FLOW.dport}, DSCP EF, to ${SD.app}.`,
    run: (s) => ({ state: clientSend(s, "voice-send", "VOICE", 0x5001), events: [ev("PACKET_SENT", "voice-send", "Voice")] }),
    packet: pkt,
  },
  {
    id: "classify-voice",
    label: "BRANCH-EDGE classifies it",
    narrative: `The packet matches VOICE (${APP_POLICY.VOICE.match}). The class exists only on BRANCH-EDGE — nothing is written into the packet.`,
    run: (s) => ({ state: { ...s, hops: [...s.hops, hop("classify-voice", "BRANCH-EDGE", { active: "classify", details: { rx: `${SD.client} → ${SD.app}`, classify: `UDP ${VOICE_FLOW.dport} + DSCP EF → VOICE` }, lookupType: "BRANCH-EDGE classifier", key: "UDP dst port · DSCP", result: "VOICE", action: "CLASSIFY VOICE", reason: "Classification uses fields the packet really has (protocol, port, DSCP). The result is local state.", input: "voice packet", output: "class VOICE", ingress: "lan", before: s.packet })], decision: { device: "BRANCH-EDGE", text: "BRANCH-EDGE: class VOICE" } }, events: [ev("STEP_ENTERED", "classify-voice", "VOICE")] }),
    packet: pkt,
  },
  {
    id: "predict-voice-path",
    label: "Predict: Voice's path",
    narrative: "Both paths are SLA-eligible right now.",
    packet: pkt,
    question: {
      prompt: "Which path does VOICE use while both TUN-A and TUN-B meet the SLA?",
      options: [
        { id: "a", label: "TUN-A — both are eligible, so the policy's first preference wins" },
        { id: "b", label: "TUN-B — it has more headroom" },
        { id: "both", label: "Both, alternating packets (ECMP)" },
        { id: "ctrl", label: "Whichever path the controller picks for this packet" },
      ],
      correctOptionId: "a",
      explanation: "The SLA decides which paths are allowed; the preference order decides among the allowed ones. This is application-policy steering, not ECMP.",
    },
  },
  {
    id: "select-voice",
    label: "VOICE → TUN-A",
    narrative: "Eligible: TUN-A, TUN-B. Preference: TUN-A first. BRANCH-EDGE sends the packet into TUN-A over ISP-A.",
    run: (s) => ({ state: edgeSteer(s, "select-voice", "VOICE", 0x5001), events: [ev("ROUTE_SELECTED", "select-voice", "VOICE → TUN-A")] }),
    packet: pkt,
    whatChanged: (_p, n) => [selLine(n)],
  },
  {
    id: "voice-hub",
    label: "Across ISP-A to the hub",
    narrative: "ISP-A carries TUN-A's traffic between the WAN addresses; HUB-EDGE removes the overlay encapsulation and routes the original packet toward APP.",
    run: (s) => ({ state: toApp(s, "voice-hub", "VOICE", 0x5001, "hub"), events: [ev("PACKET_RECEIVED", "voice-hub", "Hub")] }),
    packet: pkt,
  },
  {
    id: "bulk-send",
    label: "A bulk packet",
    narrative: `At the same time CLIENT's backup job sends data: TCP ${BULK_FLOW.sport} → ${BULK_FLOW.dport}, ${BULK_FLOW.payload} bytes.`,
    run: (s) => ({ state: clientSend(s, "bulk-send", "BULK", 0x5101), events: [ev("PACKET_SENT", "bulk-send", "Bulk")] }),
    packet: pkt,
  },
  {
    id: "predict-bulk",
    label: "Predict: Bulk's path",
    narrative: "VOICE is on TUN-A. BULK has its own policy.",
    packet: pkt,
    question: {
      prompt: "Why does BULK take TUN-B while VOICE is on TUN-A?",
      options: [
        { id: "policy", label: "Its own policy prefers TUN-B (and needs no SLA) — keeping bulk transfers off the low-latency path voice prefers" },
        { id: "full", label: "TUN-A is full" },
        { id: "ecmp", label: "The edge load-balances every other flow" },
        { id: "down", label: "TUN-A is down for TCP" },
      ],
      correctOptionId: "policy",
      explanation: "Path selection is per application class. Two classes, two preference orders, two different paths at the same moment — deliberately, not by hashing.",
    },
  },
  {
    id: "bulk-forward",
    label: "BULK → TUN-B",
    narrative: "BULK needs only a reachable path; its first preference TUN-B is reachable, so the data goes out over ISP-B. Two applications, two WAN paths, simultaneously.",
    run: (s) => ({ state: edgeSteer(s, "bulk-forward", "BULK", 0x5101), events: [ev("ROUTE_SELECTED", "bulk-forward", "BULK → TUN-B")] }),
    packet: pkt,
    whatChanged: (_p, n) => [selLine(n)],
  },
  {
    id: "bulk-app",
    label: "Both flows reach APP",
    narrative: "HUB-EDGE delivers the bulk data from TUN-B to APP — the same destination site the voice packet reached over TUN-A.",
    run: (s) => ({ state: toApp(s, "bulk-app", "BULK", 0x5101, "app"), events: [ev("PACKET_RECEIVED", "bulk-app", "APP")] }),
    packet: pkt,
    whatChanged: (_p, n) => [`APP received: voice ${n.app.voice} · bulk ${n.app.bulk}`],
  },
  {
    id: "predict-controller",
    label: "Predict: who decides per packet?",
    narrative: "Many SD-WAN designs include a central controller or orchestrator.",
    question: {
      prompt: "Does a central controller have to choose the path for every packet?",
      options: [
        { id: "no", label: "No — it may distribute policy, configuration and topology, but the edge decides locally from installed policy and live path state" },
        { id: "yes", label: "Yes — every packet waits for the controller's answer" },
        { id: "first", label: "Yes, but only the first packet of each second" },
        { id: "none", label: "No — SD-WAN never uses controllers" },
      ],
      correctOptionId: "no",
      explanation: "A per-packet controller round-trip would add latency and make forwarding depend on the controller being reachable. The edge holds the policy and the measurements and forwards on its own.",
    },
  },
  {
    id: "local-decision",
    label: "Local decisions",
    narrative: "Controller / orchestrator (generic role): push policy, configuration and topology to the edges. BRANCH-EDGE: classify, check its own current measurements, pick an eligible path — for every packet, locally, even if the controller is briefly unreachable. Vendors split these roles differently.",
    run: (s) => ({ state: note(idle(s), "local-decision", { active: "select", details: { policy: "installed locally", paths: TUN_IDS.map((t) => `${t} ${tunStatus(s.tun[t])}`).join(" · "), select: selLine(s) }, action: "LOCAL DECISION", reason: "Control plane: policy distribution. Data plane: per-packet steering on the edge. Measurement: an input to that steering.", key: "decision point", result: selLine(s) }), events: [] }),
  },
  {
    id: "degrade-a",
    label: "ISP-A starts to struggle",
    narrative: "Congestion somewhere in ISP-A's network. The circuit stays UP and TUN-A stays reachable — but its packets are getting slower, jittery and occasionally lost. A brownout, not a blackout.",
    run: (s) => ({ state: note({ ...idle(s), tun: { ...s.tun, "TUN-A": { ...s.tun["TUN-A"], quality: "degraded" } } }, "degrade-a", { stages: PROBE_STAGES, active: "probe", details: { probe: "ISP-A circuit UP · TUN-A reachable" }, action: "UNDERLAY QUALITY CHANGES", reason: "Nothing has failed from a link-state point of view.", key: "ISP-A", result: "UP · reachable" }), events: [ev("STEP_ENTERED", "degrade-a", "Brownout")] }),
  },
  {
    id: "probe-a-bad",
    label: "A slow TUN-A reply",
    narrative: "Probes on TUN-A still get answers — the path is reachable — but the samples are much slower now.",
    run: (s) => {
      const out = probeOut(s, "probe-a-bad", "TUN-A");
      const back = probeBack(out, "probe-a-bad", "TUN-A");
      return { state: back, events: [ev("PACKET_RECEIVED", "probe-a-bad", "Slow sample")] };
    },
    packet: pkt,
  },
  {
    id: "predict-degrade",
    label: "Predict: the SLA check",
    narrative: "The next interval will show TUN-A at 160 ms RTT, 40 ms jitter and 2.0% loss. Voice SLA: RTT ≤ 100 ms, jitter ≤ 30 ms, loss ≤ 1.0%.",
    question: {
      prompt: "Which Voice thresholds does TUN-A fail at 160 ms / 40 ms / 2.0%?",
      options: [
        { id: "all", label: "All three: 160 > 100 ms RTT, 40 > 30 ms jitter, 2.0% > 1.0% loss" },
        { id: "rtt", label: "Only RTT" },
        { id: "loss", label: "Only loss — RTT and jitter are within limits" },
        { id: "none", label: "None — the path is still reachable" },
      ],
      correctOptionId: "all",
      explanation: "Each metric is compared against its own threshold; the edge records every failure, not one unexplained yes/no. Any single failure would already make the path ineligible for Voice.",
    },
  },
  {
    id: "predict-down",
    label: "Predict: down or not?",
    narrative: "TUN-A is about to fail the Voice SLA.",
    question: {
      prompt: "Is TUN-A down once it fails the Voice SLA?",
      options: [
        { id: "inelig", label: "No — it is reachable but SLA-ineligible for Voice; traffic without that SLA could still use it" },
        { id: "down", label: "Yes — failing an SLA takes the tunnel down" },
        { id: "isp", label: "Yes — ISP-A's circuit is down" },
        { id: "gone", label: "It is removed from the configuration" },
      ],
      correctOptionId: "inelig",
      explanation: "Eligibility is per SLA policy. The tunnel still carries packets; it just isn't good enough for Voice right now. Calling it \"down\" sends troubleshooting to the wrong place.",
    },
  },
  {
    id: "measure-bad",
    label: "TUN-A fails the Voice SLA",
    narrative: "Interval result — TUN-A: 160 ms / 40 ms / 2.0%: RTT ✗, jitter ✗, loss ✗ → SLA FAIL → not eligible for Voice (reachable but SLA-ineligible). TUN-B: 55 / 8 / 0.4% → still eligible. VOICE's selection moves to TUN-B; BULK stays on TUN-B.",
    run: (s) => ({ state: intervalStep(s, "measure-bad", ["TUN-A", "TUN-B"]), events: [ev("ROUTE_SELECTED", "measure-bad", "VOICE → TUN-B")] }),
    whatChanged: (_p, n) => [pathLine(n, "TUN-A"), pathLine(n, "TUN-B"), selLine(n)],
  },
  {
    id: "voice-after",
    label: "The next voice packet",
    narrative: "CLIENT keeps sending voice media, unaware of anything.",
    run: (s) => ({ state: clientSend(s, "voice-after", "VOICE", 0x5002), events: [ev("PACKET_SENT", "voice-after", "Voice")] }),
    packet: pkt,
  },
  {
    id: "voice-failover",
    label: "VOICE fails over to TUN-B",
    narrative: "BRANCH-EDGE: class VOICE → policy SLA-required, prefer TUN-A → TUN-A reachable but SLA-ineligible → TUN-B eligible → send into TUN-B. No SLA value, policy name or path score is written into the packet — it is the same UDP packet as before.",
    run: (s) => ({ state: edgeSteer(s, "voice-failover", "VOICE", 0x5002), events: [ev("ROUTE_SELECTED", "voice-failover", "VOICE → TUN-B")] }),
    packet: pkt,
    whatChanged: (_p, n) => [selLine(n)],
  },
  {
    id: "voice-after-hub",
    label: "Voice arrives via TUN-B",
    narrative: "ISP-B carries it, HUB-EDGE forwards to APP. The call continues on the second path while TUN-A is still up.",
    run: (s) => ({ state: toApp(s, "voice-after-hub", "VOICE", 0x5002, "hub"), events: [ev("PACKET_RECEIVED", "voice-after-hub", "Hub")] }),
    packet: pkt,
  },
  {
    id: "restore-a",
    label: "ISP-A recovers",
    narrative: "The congestion in ISP-A clears; TUN-A's samples are back to normal. TUN-A is still marked ineligible — nothing has been measured yet.",
    run: (s) => ({ state: note({ ...idle(s), tun: { ...s.tun, "TUN-A": { ...s.tun["TUN-A"], quality: "healthy" } } }, "restore-a", { stages: PROBE_STAGES, active: "probe", details: { probe: "TUN-A underlay quality healthy again" }, action: "QUALITY RESTORED", reason: "The monitor will only believe it once intervals show it.", key: "ISP-A", result: "awaiting measurements" }), events: [ev("STEP_ENTERED", "restore-a", "Recovered")] }),
  },
  {
    id: "predict-hysteresis",
    label: "Predict: switch back now?",
    narrative: "The next TUN-A interval will pass the SLA.",
    question: {
      prompt: "Why shouldn't VOICE move back to TUN-A after a single healthy measurement?",
      options: [
        { id: "flap", label: "A path that just recovered may degrade again; waiting for several good intervals avoids flapping calls back and forth" },
        { id: "slow", label: "Because moving flows is always slow" },
        { id: "never", label: "It should never move back once it failed over" },
        { id: "ctrl", label: "Because only the controller may approve it" },
      ],
      correctOptionId: "flap",
      explanation: "Hysteresis (dampening) trades a little delay for stability. This lesson models it as 3 consecutive passing intervals — the PacketVerse lesson's rule, not a universal SD-WAN standard; products let you tune it.",
    },
  },
  {
    id: "recover-1",
    label: "Healthy interval 1/3",
    narrative: `TUN-A: 25 / 3 / 0.2% → PASS. Recovery counter 1/${HYSTERESIS_INTERVALS} (PacketVerse modeled hysteresis). Still not eligible; VOICE stays on TUN-B.`,
    run: (s) => ({ state: intervalStep(s, "recover-1", ["TUN-A", "TUN-B"]), events: [ev("STEP_ENTERED", "recover-1", "1/3")] }),
    whatChanged: (_p, n) => [pathLine(n, "TUN-A"), selLine(n)],
  },
  {
    id: "recover-2",
    label: "Healthy interval 2/3",
    narrative: `Another passing interval: counter 2/${HYSTERESIS_INTERVALS}. Still on TUN-B.`,
    run: (s) => ({ state: intervalStep(s, "recover-2", ["TUN-A", "TUN-B"]), events: [ev("STEP_ENTERED", "recover-2", "2/3")] }),
    whatChanged: (_p, n) => [pathLine(n, "TUN-A"), selLine(n)],
  },
  {
    id: "recover-3",
    label: "Healthy interval 3/3 — eligible",
    narrative: `Third consecutive passing interval: ${HYSTERESIS_INTERVALS}/${HYSTERESIS_INTERVALS}. TUN-A is SLA-eligible again, and VOICE returns to its preferred path.`,
    run: (s) => ({ state: intervalStep(s, "recover-3", ["TUN-A", "TUN-B"]), events: [ev("ROUTE_SELECTED", "recover-3", "VOICE → TUN-A")] }),
    whatChanged: (_p, n) => [pathLine(n, "TUN-A"), selLine(n)],
  },
  {
    id: "voice-back",
    label: "VOICE back on TUN-A",
    narrative: "The next voice packet leaves on TUN-A again. BULK never moved.",
    run: (s) => {
      const sent = clientSend(s, "voice-back", "VOICE", 0x5003);
      return { state: edgeSteer(sent, "voice-back", "VOICE", 0x5003, sent.hops.slice(s.hops.length)), events: [ev("ROUTE_SELECTED", "voice-back", "VOICE → TUN-A")] };
    },
    packet: pkt,
    whatChanged: (_p, n) => [selLine(n)],
  },
  {
    id: "incident-intro",
    label: "Incident: a monitoring change",
    narrative: `During a monitoring clean-up someone edits TUN-B's SLA probe target to ${SD.badTarget}. ISP-B, TUN-B and all forwarding are untouched. Later, users report that calls fail completely whenever ISP-A has a bad day — even though ISP-B seems fine.`,
    run: (s) => ({ state: note({ ...idle(s), tun: { ...s.tun, "TUN-B": { ...s.tun["TUN-B"], target: SD.badTarget } }, faultActive: true }, "incident-intro", { stages: PROBE_STAGES, active: "probe", details: { probe: `TUN-B probe target: ${SD.badTarget}` }, action: "MONITOR CONFIG CHANGED", reason: "A configuration edit to the SLA monitor — not to routing, tunnels or circuits.", key: "TUN-B monitor", result: `target ${SD.badTarget}` }), events: [ev("STEP_ENTERED", "incident-intro", "Monitor edited")] }),
    whatChanged: () => [`TUN-B probe target: ${SD.badTarget}`, "ISP-B UP · TUN-B reachable"],
  },
  {
    id: "probe-b-wrong",
    label: "TUN-B probes go unanswered",
    narrative: `The probe crosses TUN-B normally — the tunnel works — and arrives at HUB-EDGE, which owns no address ${SD.badTarget}. No Echo Reply comes back.`,
    run: (s) => ({ state: probeOut(s, "probe-b-wrong", "TUN-B"), events: [ev("PACKET_DROPPED", "probe-b-wrong", "No reply")] }),
    packet: pkt,
  },
  {
    id: "measure-b-invalid",
    label: "TUN-B: no valid SLA result",
    narrative: "Interval result — TUN-B: 0 of 500 probes answered → no valid measurement → not SLA-eligible for Voice. ISP-B is UP and TUN-B is reachable; BULK, which needs no SLA, keeps using it. VOICE is still fine on TUN-A — for now.",
    run: (s) => ({ state: intervalStep(s, "measure-b-invalid", ["TUN-A", "TUN-B"]), events: [ev("STEP_ENTERED", "measure-b-invalid", "TUN-B no result")] }),
    whatChanged: (_p, n) => [pathLine(n, "TUN-B"), selLine(n)],
  },
  {
    id: "degrade-a-again",
    label: "ISP-A struggles again",
    narrative: "ISP-A's congestion returns. Next interval — TUN-A: 160 / 40 / 2.0% → SLA FAIL. TUN-B: still no valid result. Eligible paths for VOICE: none.",
    run: (s) => ({ state: intervalStep(s, "degrade-a-again", ["TUN-A", "TUN-B"], { "TUN-A": { quality: "degraded" } }), events: [ev("STEP_ENTERED", "degrade-a-again", "No eligible path")] }),
    whatChanged: (_p, n) => [pathLine(n, "TUN-A"), pathLine(n, "TUN-B"), selLine(n)],
  },
  {
    id: "voice-blocked",
    label: "VOICE has nowhere to go",
    narrative: "A voice packet arrives. VOICE is SLA-required and this lesson configures no fallback: zero eligible paths → the flow is not forwarded. That is the configured PacketVerse policy outcome — not how every SD-WAN product behaves. Both circuits are UP and both tunnels are reachable the whole time.",
    run: (s) => {
      const sent = clientSend(s, "voice-blocked", "VOICE", 0x5004);
      return { state: edgeSteer(sent, "voice-blocked", "VOICE", 0x5004, sent.hops.slice(s.hops.length)), events: [ev("PACKET_DROPPED", "voice-blocked", "VOICE dropped")] };
    },
    packet: pkt,
    whatChanged: (_p, n) => [selLine(n), "ISP-A UP · ISP-B UP · TUN-A and TUN-B reachable"],
  },
  {
    id: "predict-monitor",
    label: "Diagnose the incident",
    narrative: `Clues: both circuits UP; both overlays reachable; TUN-A probes answered but slow; TUN-B probes: 0 replies; TUN-B target ${SD.badTarget}; hub monitoring loopback ${SD.hubLo}.`,
    question: {
      prompt: "Why does the wrong probe target make an otherwise usable TUN-B unavailable to VOICE?",
      options: [
        { id: "monitor", label: "Probes to 10.255.0.99 never get valid replies, so TUN-B has no SLA result — and an SLA-required policy only uses paths with a passing result" },
        { id: "isp", label: "ISP-B's circuit is down" },
        { id: "dns", label: "DNS can no longer resolve APP" },
        { id: "app", label: "APP stopped accepting voice traffic" },
      ],
      correctOptionId: "monitor",
      explanation: "The transport works — BULK proves it. The monitor is asking the wrong question to a host that doesn't exist, so the policy engine never gets evidence that TUN-B meets the SLA.",
    },
  },
  {
    id: "diagnostic-layers",
    label: "Troubleshooting layers",
    narrative: "Check each layer separately: circuits, overlays, measurements, monitor configuration, eligibility, application forwarding.",
  },
  {
    id: "repair-challenge",
    label: "Repair the monitoring",
    narrative: "Choose the change that fixes the cause you identified.",
    action: (s, payload) => ({ state: applySdRepair(s, (payload as { choice: string }).choice), events: [ev("STEP_ENTERED", "repair-challenge", `Repair attempt: ${(payload as { choice: string }).choice}`)] }),
    requiresState: (s) => s.repaired,
  },
  {
    id: "ver-probe-b",
    label: "Verify: TUN-B probes answered",
    narrative: `Probes on TUN-B go to ${SD.hubLo} again, and HUB-EDGE answers.`,
    run: (s) => {
      const out = probeOut(s, "ver-probe-b", "TUN-B");
      return { state: probeBack(out, "ver-probe-b", "TUN-B"), events: [ev("PACKET_RECEIVED", "ver-probe-b", "Reply")] };
    },
    packet: pkt,
  },
  {
    id: "ver-b-eligible",
    label: "Verify: TUN-B earns eligibility",
    narrative: `Three consecutive valid, passing intervals on TUN-B (55 / 8 / 0.4%) satisfy the same modeled ${HYSTERESIS_INTERVALS}-interval rule: 1/3, 2/3, 3/3 → eligible. TUN-A is still degraded and ineligible. VOICE's only eligible path is TUN-B.`,
    run: (s) => {
      const i1 = intervalStep(s, "ver-b-eligible", ["TUN-A", "TUN-B"]);
      const i2 = intervalStep(i1, "ver-b-eligible", ["TUN-A", "TUN-B"]);
      const i3 = intervalStep(i2, "ver-b-eligible", ["TUN-A", "TUN-B"]);
      return { state: i3, events: [ev("ROUTE_SELECTED", "ver-b-eligible", "VOICE → TUN-B")] };
    },
    whatChanged: (_p, n) => [pathLine(n, "TUN-B"), pathLine(n, "TUN-A"), selLine(n)],
  },
  {
    id: "ver-voice",
    label: "Verify: VOICE flows on TUN-B",
    narrative: "The next voice packet: VOICE → TUN-A ineligible → TUN-B eligible → forwarded.",
    run: (s) => {
      const sent = clientSend(s, "ver-voice", "VOICE", 0x5005);
      return { state: edgeSteer(sent, "ver-voice", "VOICE", 0x5005, sent.hops.slice(s.hops.length)), events: [ev("ROUTE_SELECTED", "ver-voice", "VOICE → TUN-B")] };
    },
    packet: pkt,
    whatChanged: (_p, n) => [selLine(n)],
  },
  {
    id: "ver-voice-app",
    label: "Verify: calls work",
    narrative: "HUB-EDGE delivers the voice packet to APP. The call works on TUN-B while TUN-A recovers — and when TUN-A passes three intervals again, VOICE will return to it.",
    run: (s) => ({ state: toApp(s, "ver-voice-app", "VOICE", 0x5005, "app"), events: [ev("PACKET_RECEIVED", "ver-voice-app", "APP")] }),
    packet: pkt,
    whatChanged: (_p, n) => [`APP received: voice ${n.app.voice} · bulk ${n.app.bulk}`],
  },
  {
    id: "sdwan-wrap",
    label: "What was generic, what varies",
    narrative: "Generic: underlay vs overlay, measuring paths, per-application SLAs and preferences, local steering, failover and hysteresis, and monitors that must point at something that answers. Varies by product: overlay encapsulation, measurement method, how SLAs are scored, fallback behaviour when nothing is eligible, and the default dampening. Check your platform's documentation for each.",
    run: (s) => ({ state: idle(s), events: [] }),
  },
  {
    id: "complete",
    label: "Lesson complete",
    narrative: "Two underlays, two overlays, measured SLAs, per-application steering, failover to TUN-B, a modeled 3-interval return to TUN-A — and a path lost to Voice not by the network but by its own monitor.",
  },
];
