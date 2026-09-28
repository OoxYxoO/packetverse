import type { PacketVisual, PVEvent, PVEventType, ScenarioStep } from "../types";
import type { ProcessingStage } from "@/components/network3d/types";
import type { FundHop } from "@/components/lesson/fundamentalsTrace";
import { icmpPacket, packetStack } from "./fundamentalsPackets";

/**
 * LACP: Link Aggregation & Member Failover — HOST-A — SW1 ══ SW2 — HOST-B / HOST-C, with two parallel physical members
 * (ge-0/0/23, ge-0/0/24) bundled as LAG1.
 *
 * Modeled on IEEE 802.1AX (LACP):
 * - LACPDUs: Ethernet destination 01:80:C2:00:00:02 (Slow Protocols), EtherType 0x8809, Subtype 0x01, Version 0x01,
 *   Actor and Partner information {System Priority, System, Key, Port Priority, Port, State}. Link-local, never IP.
 * - State byte bits: Activity(0x01) Timeout(0x02, 1 = short) Aggregation(0x04) Synchronization(0x08)
 *   Collecting(0x10) Distributing(0x20) Defaulted(0x40) Expired(0x80). Long timeout is used here.
 * - A member joins LAG1 only if its local key matches the other LAG1 members on the SAME system and its partner
 *   information (partner system + partner key) matches theirs. Keys on the two systems need NOT be equal (10 vs 20).
 * - Sequence per member: Synchronization → Collecting (partner in sync) → Distributing (partner collecting).
 * - LACP decides which members are eligible; the forwarding system decides how flows map onto eligible members.
 *   PacketVerse uses a clearly labelled modeled hash: (last octet of source IPv4 + last octet of destination IPv4)
 *   mod (number of eligible members). One flow stays on one member; real platforms use their own hash inputs.
 * - A failed member leaves the bundle; LAG1 stays up on the surviving member (no minimum-links rule configured).
 */

export type LacpSide = "SW1" | "SW2";
export type LacpHost = "HOST-A" | "HOST-B" | "HOST-C";
export type LacpDevice = LacpSide | LacpHost;
export type Member = "ge-0/0/23" | "ge-0/0/24";
export const MEMBERS: Member[] = ["ge-0/0/23", "ge-0/0/24"];
export const LACP_DEVICES: LacpDevice[] = ["HOST-A", "SW1", "SW2", "HOST-B", "HOST-C"];
export const LACP_DST = "01:80:C2:00:00:02";
export const LACP_ETHERTYPE = "0x8809";
export const LAG_NAME = "LAG1";
export const SYSTEMS: Record<LacpSide, { priority: number; mac: string }> = {
  SW1: { priority: 32768, mac: "00:00:5E:00:53:11" },
  SW2: { priority: 32768, mac: "00:00:5E:00:53:22" },
};
/** The key each system uses for LAG1 (configured locally; the two systems' numbers are unrelated). */
export const LAG1_KEY: Record<LacpSide, number> = { SW1: 10, SW2: 20 };
export const PORT_PRIORITY = 32768;
export const portNumber = (m: Member) => (m === "ge-0/0/23" ? 23 : 24);
export const EDGE_OF: Record<Member, string> = { "ge-0/0/23": "lag-23", "ge-0/0/24": "lag-24" };
export const HOST_MAC: Record<LacpHost, string> = { "HOST-A": "00:11:22:33:88:0A", "HOST-B": "00:11:22:33:88:0B", "HOST-C": "00:11:22:33:88:0C" };
export const HOST_IP: Record<LacpHost, string> = { "HOST-A": "192.168.80.10", "HOST-B": "192.168.80.20", "HOST-C": "192.168.80.21" };
export const HOST_SW: Record<LacpHost, { sw: LacpSide; port: string }> = { "HOST-A": { sw: "SW1", port: "ge-0/0/1" }, "HOST-B": { sw: "SW2", port: "ge-0/0/1" }, "HOST-C": { sw: "SW2", port: "ge-0/0/2" } };
export const other = (x: LacpSide): LacpSide => (x === "SW1" ? "SW2" : "SW1");

export interface LacpBits {
  activity: boolean;
  timeout: boolean;
  aggregation: boolean;
  sync: boolean;
  collecting: boolean;
  distributing: boolean;
  defaulted: boolean;
  expired: boolean;
}
export const BIT_ORDER: [keyof LacpBits, string, number][] = [
  ["activity", "Activity", 0x01],
  ["timeout", "Timeout", 0x02],
  ["aggregation", "Aggregation", 0x04],
  ["sync", "Synchronization", 0x08],
  ["collecting", "Collecting", 0x10],
  ["distributing", "Distributing", 0x20],
  ["defaulted", "Defaulted", 0x40],
  ["expired", "Expired", 0x80],
];
export const bitsByte = (b: LacpBits) => BIT_ORDER.reduce((a, [k, , v]) => a | (b[k] ? v : 0), 0);
export const hex2 = (n: number) => `0x${n.toString(16).toUpperCase().padStart(2, "0")}`;
export const bitsText = (b: LacpBits) => {
  const on = BIT_ORDER.filter(([k]) => b[k]).map(([, n]) => n);
  return `${hex2(bitsByte(b))} (${on.length ? on.join(" · ") : "none"}${b.timeout ? "" : " · long timeout"})`;
};
const bits = (o: Partial<LacpBits> = {}): LacpBits => ({ activity: true, timeout: false, aggregation: true, sync: false, collecting: false, distributing: false, defaulted: true, expired: false, ...o });
export const DEFAULTED = () => bits();
export const SYNCED = () => bits({ sync: true, defaulted: false });
export const COLLECTING = () => bits({ sync: true, collecting: true, defaulted: false });
export const DISTRIBUTING = () => bits({ sync: true, collecting: true, distributing: true, defaulted: false });
export const OUT_OF_SYNC = () => bits({ defaulted: false });

export interface PartnerInfo {
  sysPriority: number;
  sysMac: string;
  key: number;
  portPriority: number;
  port: number;
  state: LacpBits;
}
export interface MemberLacp {
  actor: LacpBits;
  partner?: PartnerInfo;
}
export type FlowId = "F1" | "F2";
export const FLOWS: Record<FlowId, { src: LacpHost; dst: LacpHost }> = { F1: { src: "HOST-A", dst: "HOST-B" }, F2: { src: "HOST-A", dst: "HOST-C" } };
export interface LacpCopy {
  id: string;
  fromId: string;
  toId: string;
  packet: PacketVisual;
  edgeId?: string;
}
export interface LacpState {
  hops: FundHop[];
  mode: Record<LacpSide, "active" | "passive">;
  key: Record<LacpSide, Record<Member, number>>;
  up: Record<Member, boolean>;
  lacp: Record<LacpSide, Record<Member, MemberLacp>>;
  flowMap: Partial<Record<FlowId, Member>>;
  packet?: PacketVisual;
  packetEdge?: string;
  flood: LacpCopy[];
  note?: { device: LacpDevice; text: string };
  faultActive: boolean;
  repairAttempt?: { choice: string; correct: boolean };
  repaired: boolean;
}
export const createLacpState = (): LacpState => ({
  hops: [],
  mode: { SW1: "active", SW2: "active" },
  key: { SW1: { "ge-0/0/23": 10, "ge-0/0/24": 10 }, SW2: { "ge-0/0/23": 20, "ge-0/0/24": 20 } },
  up: { "ge-0/0/23": true, "ge-0/0/24": true },
  lacp: { SW1: { "ge-0/0/23": { actor: DEFAULTED() }, "ge-0/0/24": { actor: DEFAULTED() } }, SW2: { "ge-0/0/23": { actor: DEFAULTED() }, "ge-0/0/24": { actor: DEFAULTED() } } },
  flowMap: {},
  flood: [],
  faultActive: false,
  repaired: false,
});

// ---------------------------------------------------------------------------------------------------------------
// Derived LAG status
// ---------------------------------------------------------------------------------------------------------------
/** Members this side distributes on right now (physically up, Collecting + Distributing). */
export const eligible = (s: LacpState, side: LacpSide): Member[] => MEMBERS.filter((m) => s.up[m] && s.lacp[side][m].actor.collecting && s.lacp[side][m].actor.distributing);
export const lagStatus = (s: LacpState) => {
  const n = eligible(s, "SW1").filter((m) => eligible(s, "SW2").includes(m)).length;
  return { members: n, text: n === 2 ? `${LAG_NAME} up · 2 of 2 members distributing` : n === 1 ? `${LAG_NAME} up · 1 of 2 members distributing` : `${LAG_NAME} not yet distributing` };
};
/** Would this member be selected into LAG1 on `side`? Local key must be LAG1's; partner info must match the other LAG1 members'. */
export function selectable(s: LacpState, side: LacpSide, m: Member): { ok: boolean; why: string } {
  if (!s.up[m]) return { ok: false, why: "physical link down" };
  if (s.key[side][m] !== LAG1_KEY[side]) return { ok: false, why: `local key ${s.key[side][m]} ≠ ${side}'s ${LAG_NAME} key ${LAG1_KEY[side]}` };
  const p = s.lacp[side][m].partner;
  if (!p) return { ok: false, why: "no partner information yet (defaulted)" };
  const others = MEMBERS.filter((o) => o !== m && s.up[o] && s.lacp[side][o].partner && s.key[side][o] === LAG1_KEY[side]);
  const clash = others.find((o) => {
    const q = s.lacp[side][o].partner!;
    return q.sysMac !== p.sysMac || q.key !== p.key;
  });
  if (clash) return { ok: false, why: `partner key ${p.key} on ${m} ≠ partner key ${s.lacp[side][clash].partner!.key} on ${clash}` };
  return { ok: true, why: `local key ${s.key[side][m]} · partner ${other(side)} key ${p.key}` };
}

// ---------------------------------------------------------------------------------------------------------------
// Frames
// ---------------------------------------------------------------------------------------------------------------
export const portMac = (side: LacpSide, m: Member) => `02:00:00:00:${side === "SW1" ? "11" : "22"}:${portNumber(m)}`;
function actorInfo(s: LacpState, side: LacpSide, m: Member) {
  return { sysPriority: SYSTEMS[side].priority, sysMac: SYSTEMS[side].mac, key: s.key[side][m], portPriority: PORT_PRIORITY, port: portNumber(m), state: s.lacp[side][m].actor };
}
/** An LACPDU as `side` sends it on member `m`: Actor = itself, Partner = what it has learned about the other end. */
export function lacpdu(s: LacpState, id: string, side: LacpSide, m: Member): PacketVisual {
  const a = actorInfo(s, side, m);
  const p = s.lacp[side][m].partner;
  const tlv = (prefix: string, x: PartnerInfo | undefined) => [
    { label: `${prefix} System Priority`, value: x ? String(x.sysPriority) : "0" },
    { label: `${prefix} System`, value: x ? x.sysMac : "00:00:00:00:00:00" },
    { label: `${prefix} Key`, value: x ? String(x.key) : "0" },
    { label: `${prefix} Port Priority`, value: x ? String(x.portPriority) : "0" },
    { label: `${prefix} Port`, value: x ? String(x.port) : "0" },
    { label: `${prefix} State`, value: x ? bitsText(x.state) : "0x00 (nothing learned yet)" },
  ];
  return {
    id,
    protocol: "ETHERNET",
    from: side,
    to: other(side),
    badge: "LACPDU",
    summary: `LACPDU — ${side} ${m} → ${LACP_DST}`,
    layers: [
      { name: "Ethernet II Header", color: "#94a3b8", fields: [{ label: "Destination MAC", value: LACP_DST }, { label: "Source MAC", value: portMac(side, m) }, { label: "EtherType", value: `${LACP_ETHERTYPE} (Slow Protocols)` }] },
      { name: "Slow Protocols", color: "#a78bfa", fields: [{ label: "Subtype", value: "0x01 (LACP)" }, { label: "Version", value: "0x01" }] },
      { name: "LACP Actor Information", color: "#22d3ee", fields: [{ label: "TLV", value: "type 0x01 · length 20" }, ...tlv("Actor", a)] },
      { name: "LACP Partner Information", color: "#34d399", fields: [{ label: "TLV", value: "type 0x02 · length 20" }, ...tlv("Partner", p)] },
      { name: "Collector / Terminator", color: "#94a3b8", fields: [{ label: "Collector Max Delay", value: "0" }, { label: "Terminator", value: "type 0x00" }] },
    ],
  };
}
export const fieldOf = (p: PacketVisual, label: string) => p.layers.flatMap((l) => l.fields).find((f) => f.label === label)?.value ?? "";
export const isLacpdu = (p: PacketVisual) => p.layers.some((l) => l.name === "Slow Protocols");
export function lacpStack(p: PacketVisual) {
  if (!isLacpdu(p)) return packetStack(p);
  return [
    { id: "eth", text: `Ethernet · dst ${LACP_DST} · src ${fieldOf(p, "Source MAC")} · ${LACP_ETHERTYPE}`, tone: "generic" as const },
    { id: "slow", text: "Slow Protocols · subtype 0x01 (LACP) · v1", tone: "generic" as const },
    { id: "actor", text: `Actor ${fieldOf(p, "Actor System")} key ${fieldOf(p, "Actor Key")} port ${fieldOf(p, "Actor Port")} state ${fieldOf(p, "Actor State").split(" ")[0]}`, tone: "vpn" as const },
    { id: "partner", text: `Partner ${fieldOf(p, "Partner System")} key ${fieldOf(p, "Partner Key")} state ${fieldOf(p, "Partner State").split(" ")[0]}`, tone: "transport" as const },
  ];
}
const IP_ID_BASE = 0x2000;
/** Ordinary customer traffic: Ethernet + IPv4 + ICMP Echo. No LACP field ever appears in it. */
export function customerFrame(id: string, flow: FlowId, from: string, to: string, seq: number): PacketVisual {
  const f = FLOWS[flow];
  return icmpPacket({ id, from, to, ethSrc: HOST_MAC[f.src], ethDst: HOST_MAC[f.dst], ip: { src: HOST_IP[f.src], dst: HOST_IP[f.dst], ttl: 64, id: IP_ID_BASE + (flow === "F1" ? 0 : 0x100) + seq, df: false }, icmp: { kind: "echo-request", identifier: 0x0808, sequence: seq, dataLength: 56 } });
}
const lastOctet = (ip: string) => Number(ip.split(".")[3]);
/** PacketVerse modeled LAG hash — NOT a standard; real platforms choose their own inputs and function. */
export function modeledHash(s: LacpState, flow: FlowId): { member?: Member; text: string } {
  const e = eligible(s, "SW1");
  if (!e.length) return { text: "no eligible member" };
  const f = FLOWS[flow];
  const sum = lastOctet(HOST_IP[f.src]) + lastOctet(HOST_IP[f.dst]);
  const idx = sum % e.length;
  return { member: e[idx], text: `(${lastOctet(HOST_IP[f.src])} + ${lastOctet(HOST_IP[f.dst])}) mod ${e.length} = ${idx} → ${e[idx]}` };
}

// ---------------------------------------------------------------------------------------------------------------
// Stages & helpers
// ---------------------------------------------------------------------------------------------------------------
export const LACP_STAGES: ProcessingStage[] = [
  { id: "rx", label: "Receive LACPDU (01:80:C2:00:00:02 · 0x8809) — link-local" },
  { id: "record", label: "Record Partner information (what the peer says about itself)" },
  { id: "select", label: "Select aggregator: local key + partner info consistent with LAG1" },
  { id: "mux", label: "Synchronization → Collecting → Distributing" },
];
export const FWD_STAGES: ProcessingStage[] = [
  { id: "rx", label: "Receive customer frame" },
  { id: "lookup", label: "FDB: destination is behind LAG1 (one logical port)" },
  { id: "hash", label: "Choose an eligible member (PacketVerse modeled hash)" },
  { id: "tx", label: "Transmit on that member" },
];
export const HOST_STAGES: ProcessingStage[] = [
  { id: "build", label: "Build Ethernet + IPv4 frame" },
  { id: "tx", label: "Send / receive on eth0" },
];
const withDetail = (base: ProcessingStage[], d: Partial<Record<string, string>>): ProcessingStage[] => base.map((x) => (d[x.id] ? { ...x, detail: d[x.id] } : x));
const ev = (type: PVEventType, stepId: string, message: string): PVEvent => ({ type, stepId, timestamp: Date.now(), message });
/** A flow pinned to a member that is no longer eligible has no mapping until its next packet is hashed again. */
const pruneFlows = (s: LacpState): LacpState => {
  const e = eligible(s, "SW1");
  const flowMap = Object.fromEntries(Object.entries(s.flowMap).filter(([, m]) => m && e.includes(m))) as LacpState["flowMap"];
  return { ...s, flowMap };
};
const push = (s: LacpState, hops: FundHop[], patch: Partial<LacpState> = {}): LacpState => pruneFlows({ ...s, ...patch, hops: [...s.hops, ...hops] });
const idle = (s: LacpState): LacpState => ({ ...s, packet: undefined, packetEdge: undefined, flood: [], note: undefined });
const setActor = (s: LacpState, side: LacpSide, m: Member, actor: LacpBits): LacpState => ({ ...s, lacp: { ...s.lacp, [side]: { ...s.lacp[side], [m]: { ...s.lacp[side][m], actor } } } });
const memberLine = (s: LacpState, side: LacpSide, m: Member) => `${side} ${m}: ${s.up[m] ? "up" : "DOWN"} · key ${s.key[side][m]} · ${bitsText(s.lacp[side][m].actor)}`;

/** `from` sends an LACPDU on `m`; the receiver records the Partner info and runs selection + mux for that member. */
function exchange(s: LacpState, stepId: string, from: LacpSide, m: Member, receiverActor: (sel: { ok: boolean; why: string }, partner: PartnerInfo) => LacpBits, action: string, reason: string): LacpState {
  const f = lacpdu(s, `${stepId}-${from}-${portNumber(m)}`, from, m);
  const to = other(from);
  const partner: PartnerInfo = actorInfo(s, from, m);
  let next: LacpState = { ...s, lacp: { ...s.lacp, [to]: { ...s.lacp[to], [m]: { ...s.lacp[to][m], partner } } } };
  const sel = selectable(next, to, m);
  next = setActor(next, to, m, receiverActor(sel, partner));
  const hop: FundHop = {
    stepId,
    device: to,
    stages: withDetail(LACP_STAGES, { rx: `on ${m}`, record: `Partner = ${from} ${SYSTEMS[from].priority}/${SYSTEMS[from].mac} key ${partner.key} port ${partner.port} ${hex2(bitsByte(partner.state))}`, select: sel.ok ? `selected into ${LAG_NAME} (${sel.why})` : `NOT selected: ${sel.why}`, mux: bitsText(next.lacp[to][m].actor) }),
    activeStageId: "mux",
    ingressInterfaceId: m,
    lookupType: `${to} LACP (Actor/Partner)`,
    lookupKey: `LACPDU from ${from} on ${m}`,
    lookupResult: sel.ok ? `${m} selected into ${LAG_NAME}` : `${m} not selected: ${sel.why}`,
    action,
    reason,
    input: `Actor ${from} key ${partner.key} ${hex2(bitsByte(partner.state))} · Partner ${fieldOf(f, "Partner Key")} ${fieldOf(f, "Partner State").split(" ")[0]}`,
    output: memberLine(next, to, m),
    nextHopId: from,
    before: lacpStack(f),
  };
  return push(next, [hop], { packet: f, packetEdge: EDGE_OF[m], flood: [], note: { device: to, text: `${to} ${m}: ${hex2(bitsByte(next.lacp[to][m].actor))}${sel.ok ? "" : " · not in LAG1"}` } });
}

function hostSend(s: LacpState, stepId: string, flow: FlowId, seq: number): LacpState {
  const f = FLOWS[flow];
  const pkt = customerFrame(`${stepId}-${flow}`, flow, f.src, "SW1", seq);
  const hop: FundHop = {
    stepId,
    device: f.src,
    stages: withDetail(HOST_STAGES, { build: `${HOST_IP[f.src]} → ${HOST_IP[f.dst]} · Ethernet dst ${HOST_MAC[f.dst]}`, tx: "eth0 → SW1 ge-0/0/1" }),
    activeStageId: "tx",
    egressInterfaceId: "eth0",
    lookupType: "Same IPv4 subnet",
    lookupKey: HOST_IP[f.dst],
    lookupResult: `on-link → Ethernet to ${f.dst}'s MAC`,
    action: "SEND",
    reason: `${f.src} sends an ordinary Ethernet/IPv4 frame to ${f.dst}. It knows nothing about LAG1 or its members.`,
    input: "(originated here)",
    output: `${HOST_IP[f.src]} → ${HOST_IP[f.dst]}`,
    nextHopId: "SW1",
    after: packetStack(pkt),
  };
  return push(s, [hop], { packet: pkt, packetEdge: undefined, flood: [], note: { device: f.src, text: `${flow}: ${f.src} → ${f.dst}` } });
}

/** SW1 forwards a flow onto LAG1: the modeled hash picks an eligible member. */
function sw1Forward(s: LacpState, stepId: string, flow: FlowId, seq: number): LacpState {
  const f = FLOWS[flow];
  const h = modeledHash(s, flow);
  const m = h.member!;
  const pkt = customerFrame(`${stepId}-${flow}-lag`, flow, "SW1", "SW2", seq);
  const hop: FundHop = {
    stepId,
    device: "SW1",
    stages: withDetail(FWD_STAGES, { rx: "on ge-0/0/1", lookup: `${f.dst} → ${LAG_NAME}`, hash: `eligible [${eligible(s, "SW1").join(", ")}] · ${h.text}`, tx: `out ${m}` }),
    activeStageId: "tx",
    ingressInterfaceId: "ge-0/0/1",
    egressInterfaceId: m,
    lookupType: "FDB → LAG1 → member (PacketVerse modeled hash)",
    lookupKey: `${HOST_IP[f.src]} → ${HOST_IP[f.dst]}`,
    lookupResult: `${LAG_NAME} member ${m}`,
    action: `${LAG_NAME} → ${m}`,
    reason: `SW1's FDB points ${f.dst} at the logical port ${LAG_NAME}. LACP says which members are eligible (${eligible(s, "SW1").join(", ")}); SW1's forwarding logic then pins this flow to one of them with the PacketVerse modeled hash ${h.text}. Every packet of the flow takes the same member.`,
    input: `${HOST_IP[f.src]} → ${HOST_IP[f.dst]} on ge-0/0/1`,
    output: `same frame out ${m}`,
    nextHopId: "SW2",
    before: packetStack(pkt),
    after: packetStack(pkt),
  };
  return push(s, [hop], { packet: pkt, packetEdge: EDGE_OF[m], flood: [], flowMap: { ...s.flowMap, [flow]: m }, note: { device: "SW1", text: `${flow} → ${m} (modeled hash)` } });
}

function sw2Deliver(s: LacpState, stepId: string, flow: FlowId, seq: number): LacpState {
  const f = FLOWS[flow];
  const m = s.flowMap[flow]!;
  const at = HOST_SW[f.dst];
  const pkt = customerFrame(`${stepId}-${flow}-out`, flow, "SW2", f.dst, seq);
  const hop: FundHop = {
    stepId,
    device: "SW2",
    stages: withDetail(FWD_STAGES, { rx: `on ${m} (member of ${LAG_NAME})`, lookup: `${f.dst} → ${at.port}`, hash: "not needed — access port", tx: `out ${at.port}` }),
    activeStageId: "tx",
    ingressInterfaceId: m,
    egressInterfaceId: at.port,
    lookupType: "FDB",
    lookupKey: HOST_MAC[f.dst],
    lookupResult: `${f.dst} → ${at.port}`,
    action: "FORWARD",
    reason: `SW2 receives on ${m}, which it counts as ${LAG_NAME}: source learning records ${f.src} behind ${LAG_NAME}, not behind one member.`,
    input: `${HOST_IP[f.src]} → ${HOST_IP[f.dst]} on ${m}`,
    output: `out ${at.port} to ${f.dst}`,
    nextHopId: f.dst,
    before: packetStack(pkt),
  };
  return push(s, [hop], { packet: pkt, packetEdge: undefined, flood: [], note: { device: "SW2", text: `SW2: from ${LAG_NAME} (${m}) → ${f.dst}` } });
}

function memberEvent(s: LacpState, stepId: string, m: Member, up: boolean): LacpState {
  const next: LacpState = up
    ? { ...s, up: { ...s.up, [m]: true }, lacp: { SW1: { ...s.lacp.SW1, [m]: { actor: DEFAULTED() } }, SW2: { ...s.lacp.SW2, [m]: { actor: DEFAULTED() } } } }
    : { ...s, up: { ...s.up, [m]: false }, lacp: { SW1: { ...s.lacp.SW1, [m]: { actor: DEFAULTED() } }, SW2: { ...s.lacp.SW2, [m]: { actor: DEFAULTED() } } } };
  const hops: FundHop[] = (["SW1", "SW2"] as LacpSide[]).map((side) => ({
    stepId,
    device: side,
    stages: withDetail(LACP_STAGES, { rx: `${m} physical ${up ? "UP" : "DOWN"}`, record: up ? "no partner information yet" : "partner information discarded", select: up ? "waiting for LACPDUs" : `${m} removed from ${LAG_NAME}`, mux: bitsText(next.lacp[side][m].actor) }),
    activeStageId: up ? "record" : "select",
    ingressInterfaceId: m,
    lookupType: `${side} LACP`,
    lookupKey: `${m} link ${up ? "up" : "down"}`,
    lookupResult: up ? `${m} not yet distributing` : `${m} not collecting / not distributing · ${lagStatus(next).text}`,
    action: up ? "MEMBER LINK UP" : "MEMBER LINK DOWN",
    reason: up ? `${m} has link again, but it carries no customer traffic until LACP has synchronized it with the partner and both ends are Collecting and Distributing.` : `${m} lost link. It stops collecting and distributing at once. ${lagStatus(next).text}: the other member keeps the bundle running.`,
    input: `${m} physical`,
    output: memberLine(next, side, m),
  }));
  return push(next, hops, { packet: undefined, packetEdge: undefined, flood: [], note: { device: "SW1", text: `${m} ${up ? "up — negotiating" : "down"} · ${lagStatus(next).text}` } });
}

// ---------------------------------------------------------------------------------------------------------------
// Repair
// ---------------------------------------------------------------------------------------------------------------
export const LACP_REPAIR_OPTIONS = [
  { id: "sw2-key-20", label: "Set SW2 ge-0/0/24's local LACP key back to 20 (SW2's LAG1 key)" },
  { id: "sw1-key-20", label: "Change SW1's LAG1 key from 10 to 20 to match SW2" },
  { id: "clear-fdb", label: "Clear the MAC tables on SW1 and SW2" },
  { id: "stp-priority", label: "Change the STP root bridge priority" },
  { id: "shut-23", label: "Shut the healthy ge-0/0/23 member" },
] as const;
export const LACP_REPAIR_CORRECT = "sw2-key-20";
export function applyLacpRepair(s: LacpState, choice: string): LacpState {
  const correct = choice === LACP_REPAIR_CORRECT;
  if (!correct) return { ...s, repairAttempt: { choice, correct } };
  return { ...s, repairAttempt: { choice, correct }, repaired: true, faultActive: false, key: { ...s.key, SW2: { ...s.key.SW2, "ge-0/0/24": 20 } }, packet: undefined, packetEdge: undefined, flood: [], note: { device: "SW2", text: "SW2 ge-0/0/24 key 20 — renegotiation next" } };
}

// ---------------------------------------------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------------------------------------------
const pkt = (s: LacpState) => s.packet;
const M23: Member = "ge-0/0/23";
const M24: Member = "ge-0/0/24";
const syncIfSelected = (sel: { ok: boolean }) => (sel.ok ? SYNCED() : OUT_OF_SYNC());
const collectIfPartnerSync = (sel: { ok: boolean }, p: PartnerInfo) => (!sel.ok ? OUT_OF_SYNC() : p.state.sync ? COLLECTING() : SYNCED());
const distIfPartnerCollecting = (sel: { ok: boolean }, p: PartnerInfo) => (!sel.ok ? OUT_OF_SYNC() : p.state.collecting ? DISTRIBUTING() : p.state.sync ? COLLECTING() : SYNCED());

/** A full negotiation on one member (four LACPDUs) in one step, ending with both ends Distributing. */
function negotiate(s: LacpState, stepId: string, m: Member): LacpState {
  let x = exchange(s, stepId, "SW1", m, syncIfSelected, "PARTNER LEARNED · SYNC", `SW2 learns SW1 as Partner on ${m}; its local key fits ${LAG_NAME}, so it selects the member and synchronizes.`);
  x = exchange(x, stepId, "SW2", m, collectIfPartnerSync, "PARTNER LEARNED · COLLECTING", `SW1 learns SW2 as Partner on ${m}, selects it and — its partner being in sync — starts Collecting.`);
  x = exchange(x, stepId, "SW1", m, distIfPartnerCollecting, "DISTRIBUTING", `SW2 sees SW1 collecting on ${m} and starts Distributing.`);
  return exchange(x, stepId, "SW2", m, distIfPartnerCollecting, "DISTRIBUTING", `SW1 sees SW2 collecting on ${m} and starts Distributing: both ends are Synchronized, Collecting and Distributing.`);
}

export const lacpSteps: ScenarioStep<LacpState>[] = [
  {
    id: "intro",
    label: "Two cables between two switches",
    narrative: "SW1 and SW2 are joined by two parallel Ethernet links, ge-0/0/23 and ge-0/0/24. As two independent links they would form a Layer-2 loop — spanning tree would have to hold one of them Discarding. The goal here is different: make both cables act as ONE logical link, LAG1, so both can carry traffic at once.",
  },
  {
    id: "topology",
    label: "Systems, members and keys",
    narrative: `SW1 LACP System ID ${SYSTEMS.SW1.priority} / ${SYSTEMS.SW1.mac}, SW2 ${SYSTEMS.SW2.priority} / ${SYSTEMS.SW2.mac}. On SW1 both members carry local key ${LAG1_KEY.SW1}; on SW2 both carry local key ${LAG1_KEY.SW2}. Both ends run LACP in Active mode. Before any LACPDU, each member is up but Defaulted: it knows nothing about its partner.`,
  },
  {
    id: "predict-lacp-dst",
    label: "Predict: where LACPDUs go",
    narrative: "LACP runs between the two directly connected switches on each member link.",
    question: {
      prompt: "Which destination MAC carries LACP control frames?",
      options: [
        { id: "slow", label: `${LACP_DST} — the Slow Protocols address, EtherType ${LACP_ETHERTYPE}, never forwarded` },
        { id: "bcast", label: "FF:FF:FF:FF:FF:FF so every switch hears them" },
        { id: "bpdu", label: "01:80:C2:00:00:00, the same address as spanning-tree BPDUs" },
        { id: "peer", label: "The partner switch's IPv4 address" },
      ],
      correctOptionId: "slow",
      explanation: `LACPDUs are Slow Protocol frames: destination ${LACP_DST}, EtherType ${LACP_ETHERTYPE}, subtype 0x01. They stay on one link and are never carried in IP or forwarded like customer traffic.`,
    },
  },
  {
    id: "m23-sw1-pdu",
    label: "SW1 speaks on ge-0/0/23",
    narrative: `SW1 (Active) sends an LACPDU on ge-0/0/23: Actor = SW1, key ${LAG1_KEY.SW1}, port 23, state 0x45 (Activity · Aggregation · Defaulted). Partner fields are still zero. SW2 records SW1 as its Partner, checks that ge-0/0/23 fits LAG1 (its own key ${LAG1_KEY.SW2}, partner SW1 key ${LAG1_KEY.SW1}) and becomes Synchronized.`,
    run: (s) => ({ state: exchange(idle(s), "m23-sw1-pdu", "SW1", M23, syncIfSelected, "PARTNER LEARNED · SYNC", `SW2 stores what SW1 says about itself as Partner information. ge-0/0/23 has SW2's LAG1 key ${LAG1_KEY.SW2}, so SW2 selects it into LAG1 and sets Synchronization.`), events: [ev("PACKET_SENT", "m23-sw1-pdu", "LACPDU SW1 → SW2")] }),
    packet: pkt,
  },
  {
    id: "m23-sw2-pdu",
    label: "SW2 answers",
    narrative: `SW2's LACPDU carries Actor = SW2 (key ${LAG1_KEY.SW2}, state 0x0D: Activity · Aggregation · Synchronization) and Partner = what SW2 learned about SW1 (key ${LAG1_KEY.SW1}, port 23). SW1 records SW2 as its Partner, selects ge-0/0/23, and — seeing its partner in sync — starts Collecting.`,
    run: (s) => ({ state: exchange(idle(s), "m23-sw2-pdu", "SW2", M23, collectIfPartnerSync, "PARTNER LEARNED · COLLECTING", `SW1 now has Partner information for ge-0/0/23. Local key ${LAG1_KEY.SW1} matches its LAG1 key, and the partner is in sync, so SW1 is Synchronized and Collecting (0x1D).`), events: [ev("PACKET_SENT", "m23-sw2-pdu", "LACPDU SW2 → SW1")] }),
    packet: pkt,
  },
  {
    id: "predict-keys",
    label: "Predict: keys 10 and 20",
    narrative: `SW1 advertises key ${LAG1_KEY.SW1}; SW2 advertises key ${LAG1_KEY.SW2}. The member was still selected on both ends.`,
    question: {
      prompt: `Do SW1's key ${LAG1_KEY.SW1} and SW2's key ${LAG1_KEY.SW2} need to be numerically equal?`,
      options: [
        { id: "no", label: "No — each system's key only has to be consistent across its OWN members of the bundle" },
        { id: "yes", label: "Yes — mismatched keys always block aggregation" },
        { id: "sum", label: "They must add up to the number of members" },
        { id: "higher", label: "The higher key must be on the Active side" },
      ],
      correctOptionId: "no",
      explanation: `An operational key is local: it tells the system which of its own ports can aggregate together. SW1 uses ${LAG1_KEY.SW1} on both members, SW2 uses ${LAG1_KEY.SW2} on both. What matters across the link is that each member reports the same partner system and partner key as the others.`,
    },
  },
  {
    id: "m23-sw1-pdu2",
    label: "SW1 reports Collecting",
    narrative: "SW1's next LACPDU says state 0x1D (… Synchronization · Collecting). SW2 sees its partner collecting, so SW2 moves to Collecting and Distributing (0x3D).",
    run: (s) => ({ state: exchange(idle(s), "m23-sw1-pdu2", "SW1", M23, distIfPartnerCollecting, "COLLECTING · DISTRIBUTING", "The partner is Collecting, so SW2 can safely start Distributing on ge-0/0/23 — frames it sends will be accepted."), events: [ev("PACKET_SENT", "m23-sw1-pdu2", "LACPDU SW1 → SW2")] }),
    packet: pkt,
  },
  {
    id: "predict-dist",
    label: "Predict: when can customer data flow?",
    narrative: "SW2 is now Distributing on ge-0/0/23; SW1 is Collecting but not yet Distributing.",
    question: {
      prompt: "Which state must a member reach before a switch sends customer traffic on it?",
      options: [
        { id: "dist", label: "Distributing — reached after Synchronization and Collecting, with the partner collecting" },
        { id: "up", label: "Physical link up is enough" },
        { id: "defaulted", label: "Defaulted" },
        { id: "activity", label: "Activity (Active mode)" },
      ],
      correctOptionId: "dist",
      explanation: "A switch sends customer frames only on members where it is Distributing. That comes after Synchronization and Collecting, so the far end is guaranteed to accept them.",
    },
  },
  {
    id: "m23-sw2-pdu2",
    label: "ge-0/0/23 fully up",
    narrative: "SW2's LACPDU (0x3D) shows its partner collecting and distributing; SW1 starts Distributing too. ge-0/0/23 is an active LAG1 member on both ends.",
    run: (s) => ({ state: exchange(idle(s), "m23-sw2-pdu2", "SW2", M23, distIfPartnerCollecting, "DISTRIBUTING", "Both ends are now Synchronized, Collecting and Distributing on ge-0/0/23."), events: [ev("PACKET_SENT", "m23-sw2-pdu2", "LACPDU SW2 → SW1")] }),
    packet: pkt,
    whatChanged: (_p, n) => [memberLine(n, "SW1", M23), memberLine(n, "SW2", M23)],
  },
  {
    id: "m24-negotiate",
    label: "ge-0/0/24 negotiates too",
    narrative: `The same four-LACPDU exchange runs independently on ge-0/0/24: same systems, same local keys (${LAG1_KEY.SW1} on SW1, ${LAG1_KEY.SW2} on SW2), consistent partner information. Both ends select it into LAG1 and reach 0x3D.`,
    run: (s) => ({ state: negotiate(idle(s), "m24-negotiate", M24), events: [ev("PACKET_SENT", "m24-negotiate", "ge-0/0/24 negotiated")] }),
    packet: pkt,
    whatChanged: (_p, n) => [memberLine(n, "SW1", M24), memberLine(n, "SW2", M24), lagStatus(n).text],
  },
  {
    id: "lag-formed",
    label: "LAG1: one logical link",
    narrative: `Both members are Distributing: LAG1 is one logical port on each switch, made of two physical members. Everything above LACP — the MAC table, spanning tree, VLAN trunking — sees LAG1, not ge-0/0/23 and ge-0/0/24. Spanning tree treats LAG1 as a single path, so it has no reason to hold one member Discarding.`,
    run: (s) => ({ state: idle(s), events: [] }),
    whatChanged: (_p, n) => [lagStatus(n).text, `Eligible on SW1: ${eligible(n, "SW1").join(", ")}`],
  },
  {
    id: "predict-active-passive",
    label: "Predict: Active and Passive",
    narrative: "Both switches here are Active. LACP also has a Passive mode, which answers LACPDUs but does not start sending them on its own.",
    question: {
      prompt: "Which pairing would NOT form a negotiated LACP bundle?",
      options: [
        { id: "pp", label: "Passive / Passive — neither side initiates, so no LACPDUs are exchanged" },
        { id: "ap", label: "Active / Passive" },
        { id: "aa", label: "Active / Active" },
        { id: "none", label: "All three form — mode only changes the timers" },
      ],
      correctOptionId: "pp",
      explanation: "An Active port sends LACPDUs; a Passive port only responds. Active/Active and Active/Passive both negotiate. Passive/Passive links stay up physically but never exchange LACPDUs, so no bundle forms. Passive does not mean disabled.",
    },
  },
  {
    id: "flow1-send",
    label: "Flow 1: HOST-A → HOST-B",
    narrative: "HOST-A sends ordinary Ethernet/IPv4 traffic to HOST-B. The frame carries no LACP information at all.",
    run: (s) => ({ state: hostSend(idle(s), "flow1-send", "F1", 1), events: [ev("PACKET_SENT", "flow1-send", "Flow 1")] }),
    packet: pkt,
  },
  {
    id: "flow1-hash",
    label: "SW1 picks a member for Flow 1",
    narrative: "SW1's MAC table points HOST-B at LAG1. The PacketVerse modeled LAG hash — (source last octet + destination last octet) mod eligible members — maps Flow 1 to ge-0/0/23. Real switches use their own hash inputs; this one is only the lesson's model.",
    run: (s) => ({ state: sw1Forward(s, "flow1-hash", "F1", 1), events: [ev("PACKET_SENT", "flow1-hash", "Flow 1 on ge-0/0/23")] }),
    packet: pkt,
    whatChanged: (_p, n) => [`Flow 1 → ${n.flowMap.F1}`],
  },
  {
    id: "flow1-sw2",
    label: "SW2 delivers Flow 1",
    narrative: "SW2 receives the frame on ge-0/0/23, which it treats as LAG1, and forwards it to HOST-B.",
    run: (s) => ({ state: sw2Deliver(s, "flow1-sw2", "F1", 1), events: [ev("PACKET_SENT", "flow1-sw2", "SW2 → HOST-B")] }),
    packet: pkt,
  },
  {
    id: "flow2",
    label: "Flow 2: HOST-A → HOST-C",
    narrative: "HOST-A also talks to HOST-C. For this flow the modeled hash gives ge-0/0/24: both members now carry traffic at the same time.",
    run: (s) => ({ state: sw1Forward(hostSend(idle(s), "flow2", "F2", 1), "flow2", "F2", 1), events: [ev("PACKET_SENT", "flow2", "Flow 2 on ge-0/0/24")] }),
    packet: pkt,
    whatChanged: (_p, n) => [`Flow 1 → ${n.flowMap.F1} · Flow 2 → ${n.flowMap.F2}`],
  },
  {
    id: "flow2-sw2",
    label: "SW2 delivers Flow 2",
    narrative: "SW2 receives Flow 2 on ge-0/0/24 — still LAG1 — and forwards it to HOST-C.",
    run: (s) => ({ state: sw2Deliver(s, "flow2-sw2", "F2", 1), events: [ev("PACKET_SENT", "flow2-sw2", "SW2 → HOST-C")] }),
    packet: pkt,
  },
  {
    id: "predict-single-flow",
    label: "Predict: one flow, two members?",
    narrative: "Flow 1 keeps sending packets.",
    question: {
      prompt: "Can one stable flow normally use both members packet by packet?",
      options: [
        { id: "no", label: "No — a flow stays on one member to avoid reordering; more flows spread the load" },
        { id: "yes", label: "Yes — packets alternate between the members, doubling that flow's speed" },
        { id: "lacp", label: "LACP decides per packet which member to use" },
        { id: "random", label: "Each packet picks a random member" },
      ],
      correctOptionId: "no",
      explanation: "The hash keeps a flow on one member, so its packets arrive in order. A two-member LAG gives more total capacity across many flows, not double speed for one flow. And LACP only says which members are eligible; the forwarding hardware picks one per flow.",
    },
  },
  {
    id: "predict-fail",
    label: "Predict: a member fails",
    narrative: "Someone is about to pull the ge-0/0/23 cable.",
    question: {
      prompt: "What happens to LAG1 if ge-0/0/23 fails?",
      options: [
        { id: "survive", label: "ge-0/0/23 stops collecting/distributing; LAG1 stays up on ge-0/0/24 with less capacity" },
        { id: "down", label: "LAG1 goes down until the cable is replaced" },
        { id: "stp", label: "Spanning tree reconverges to a different root" },
        { id: "both-down", label: "ge-0/0/24 also goes down to keep the bundle symmetric" },
      ],
      correctOptionId: "survive",
      explanation: "A LAG stays up while it has at least one usable member (unless a minimum-links rule is configured — there isn't one here). The failed member is simply removed from the eligible set.",
    },
  },
  {
    id: "fail-23",
    label: "ge-0/0/23 fails",
    narrative: "ge-0/0/23 loses link on both switches. It stops collecting and distributing immediately and its partner information is dropped. LAG1 stays up on ge-0/0/24 — one member, less capacity, no redundancy left.",
    run: (s) => ({ state: memberEvent(idle(s), "fail-23", M23, false), events: [ev("STEP_ENTERED", "fail-23", "ge-0/0/23 down")] }),
    whatChanged: (_p, n) => [lagStatus(n).text, `Eligible on SW1: ${eligible(n, "SW1").join(", ")}`],
  },
  {
    id: "flow1-moved",
    label: "Flow 1 moves to ge-0/0/24",
    narrative: "HOST-A → HOST-B continues. With only ge-0/0/24 eligible, SW1's forwarding logic recomputes the modeled hash over one member, and Flow 1 now rides ge-0/0/24 alongside Flow 2. LACP didn't pick the member — it only removed ge-0/0/23 from the eligible set.",
    run: (s) => ({ state: sw1Forward(hostSend(idle(s), "flow1-moved", "F1", 2), "flow1-moved", "F1", 2), events: [ev("PACKET_SENT", "flow1-moved", "Flow 1 on ge-0/0/24")] }),
    packet: pkt,
    whatChanged: (_p, n) => [`Flow 1 → ${n.flowMap.F1}`, `Flow 2 → ${n.flowMap.F2} (unchanged member, recomputed hash)`],
  },
  {
    id: "restore-23-up",
    label: "ge-0/0/23 comes back",
    narrative: "The cable is replaced: ge-0/0/23 has link again. It is Defaulted, not synchronized and carries no customer traffic yet.",
    run: (s) => ({ state: memberEvent(idle(s), "restore-23-up", M23, true), events: [ev("STEP_ENTERED", "restore-23-up", "ge-0/0/23 up")] }),
    whatChanged: (_p, n) => [memberLine(n, "SW1", M23), `Eligible on SW1: ${eligible(n, "SW1").join(", ")}`],
  },
  {
    id: "restore-23-sync",
    label: "ge-0/0/23 renegotiates",
    narrative: "LACPDUs flow again on ge-0/0/23: each end relearns its Partner, reselects the member into LAG1 and becomes Synchronized; SW1 starts Collecting.",
    run: (s) => {
      const a = exchange(idle(s), "restore-23-sync", "SW1", M23, syncIfSelected, "PARTNER LEARNED · SYNC", "SW2 relearns SW1 as Partner on ge-0/0/23 and resynchronizes.");
      return { state: exchange(a, "restore-23-sync", "SW2", M23, collectIfPartnerSync, "PARTNER LEARNED · COLLECTING", "SW1 relearns SW2 as Partner; the partner is in sync, so SW1 is Collecting — but not yet Distributing."), events: [ev("PACKET_SENT", "restore-23-sync", "Renegotiation")] };
    },
    packet: pkt,
    whatChanged: (_p, n) => [memberLine(n, "SW1", M23), memberLine(n, "SW2", M23), `Eligible on SW1: ${eligible(n, "SW1").join(", ")}`],
  },
  {
    id: "restore-23-dist",
    label: "ge-0/0/23 distributing again",
    narrative: "Two more LACPDUs: each side sees its partner collecting and moves to Distributing. Only now is ge-0/0/23 eligible for customer traffic again.",
    run: (s) => {
      const a = exchange(idle(s), "restore-23-dist", "SW1", M23, distIfPartnerCollecting, "DISTRIBUTING", "SW2 sees SW1 collecting and starts Distributing.");
      return { state: exchange(a, "restore-23-dist", "SW2", M23, distIfPartnerCollecting, "DISTRIBUTING", "SW1 sees SW2 collecting and starts Distributing: ge-0/0/23 is back in LAG1."), events: [ev("PACKET_SENT", "restore-23-dist", "Distributing")] };
    },
    packet: pkt,
    whatChanged: (_p, n) => [lagStatus(n).text, `Eligible on SW1: ${eligible(n, "SW1").join(", ")}`],
  },
  {
    id: "flows-rebalanced",
    label: "Flows spread again",
    narrative: "With two eligible members the modeled hash maps Flow 1 back to ge-0/0/23. Both members carry traffic again.",
    run: (s) => ({ state: sw1Forward(hostSend(idle(s), "flows-rebalanced", "F1", 3), "flows-rebalanced", "F1", 3), events: [ev("PACKET_SENT", "flows-rebalanced", "Flow 1 on ge-0/0/23")] }),
    packet: pkt,
    whatChanged: (_p, n) => [`Flow 1 → ${n.flowMap.F1} · Flow 2 → ${n.flowMap.F2}`],
  },
  {
    id: "incident-intro",
    label: "Incident: one member stops carrying traffic",
    narrative: "After a configuration clean-up on SW2, monitoring shows LAG1 running on one member. Both cables still have link and LACPDUs still flow. Investigate.",
    run: (s) => {
      const next: LacpState = { ...idle(s), key: { ...s.key, SW2: { ...s.key.SW2, [M24]: 99 } }, faultActive: true };
      const hop: FundHop = {
        stepId: "incident-intro",
        device: "SW2",
        stages: withDetail(LACP_STAGES, { select: `${M24} local key now 99` }),
        activeStageId: "select",
        ingressInterfaceId: M24,
        lookupType: "SW2 configuration",
        lookupKey: `${M24} LACP key`,
        lookupResult: "configuration changed",
        action: "CONFIG CHANGE",
        reason: "Something in SW2's member configuration changed during the clean-up.",
        input: `${M24} key 20`,
        output: `${M24} key 99`,
      };
      return { state: push(next, [hop]), events: [ev("STEP_ENTERED", "incident-intro", "SW2 member reconfigured")] };
    },
    whatChanged: () => ["Both member links still physically up"],
  },
  {
    id: "incident-sw2",
    label: "SW2 re-evaluates ge-0/0/24",
    narrative: "SW2 re-runs selection on ge-0/0/24: its local key is now 99, but SW2's other LAG1 member uses 20. ge-0/0/24 no longer fits LAG1, so SW2 drops Synchronization, Collecting and Distributing on it and advertises key 99 in its next LACPDU.",
    run: (s) => {
      const sel = selectable(s, "SW2", M24);
      const a = setActor(idle(s), "SW2", M24, OUT_OF_SYNC());
      const hop: FundHop = {
        stepId: "incident-sw2",
        device: "SW2",
        stages: withDetail(LACP_STAGES, { select: `NOT selected: ${sel.why}`, mux: bitsText(OUT_OF_SYNC()) }),
        activeStageId: "select",
        ingressInterfaceId: M24,
        lookupType: "SW2 LACP selection",
        lookupKey: `${M24} local key ${s.key.SW2[M24]}`,
        lookupResult: `${M24} not selected into ${LAG_NAME}`,
        action: "DETACH FROM LAG1",
        reason: `SW2's two candidate ports no longer advertise a consistent local key for the same aggregator (20 on ${M23}, 99 on ${M24}). ${M24} can't stay in ${LAG_NAME}.`,
        input: memberLine(s, "SW2", M24),
        output: memberLine(a, "SW2", M24),
      };
      const b = push(a, [hop]);
      return { state: { ...b, packet: lacpdu(b, "incident-sw2-pdu", "SW2", M24), packetEdge: EDGE_OF[M24], note: { device: "SW2", text: `SW2 ${M24}: key 99 · ${hex2(bitsByte(OUT_OF_SYNC()))}` } }, events: [ev("PACKET_SENT", "incident-sw2", "LACPDU key 99")] };
    },
    packet: pkt,
    whatChanged: (_p, n) => [memberLine(n, "SW2", M24)],
  },
  {
    id: "incident-sw1",
    label: "SW1 sees inconsistent partner info",
    narrative: "SW1 receives that LACPDU on ge-0/0/24: Partner key 99. On ge-0/0/23 the same partner system reports key 20. Two members with different partner keys can't be the same aggregate, so SW1 drops ge-0/0/24 out of LAG1 as well. LAG1 stays up on ge-0/0/23.",
    run: (s) => ({ state: exchange(idle(s), "incident-sw1", "SW2", M24, distIfPartnerCollecting, "PARTNER KEY MISMATCH", `SW1's two members now report different partner keys (20 on ${M23}, 99 on ${M24}). ${M24} cannot join the same aggregator as ${M23}; it leaves LAG1 while ${M23} keeps working.`), events: [ev("PACKET_SENT", "incident-sw1", "SW1 detaches ge-0/0/24")] }),
    packet: pkt,
    whatChanged: (_p, n) => [memberLine(n, "SW1", M24), lagStatus(n).text],
  },
  {
    id: "incident-traffic",
    label: "Both flows squeeze onto one member",
    narrative: "Flow 2 (HOST-A → HOST-C) now hashes over the single eligible member ge-0/0/23. Service works, but with half the bundle's capacity and no redundancy — even though both cables are up.",
    run: (s) => ({ state: sw1Forward(hostSend(idle(s), "incident-traffic", "F2", 2), "incident-traffic", "F2", 2), events: [ev("PACKET_SENT", "incident-traffic", "Flow 2 on ge-0/0/23")] }),
    packet: pkt,
    whatChanged: (_p, n) => [`Flow 1 → ${n.flowMap.F1} · Flow 2 → ${n.flowMap.F2}`],
  },
  {
    id: "trouble-question",
    label: "Diagnose the incident",
    narrative: "Both links are up and LACPDUs are exchanged on both.",
    question: {
      prompt: "Why does SW2 key 99 on ge-0/0/24 stop that member joining LAG1?",
      options: [
        { id: "local", label: "SW2's own LAG1 members no longer share one local key (20 vs 99), and SW1 sees different partner keys on the two links" },
        { id: "equal", label: "Key 99 doesn't equal SW1's key 10" },
        { id: "down", label: "ge-0/0/24 is physically down" },
        { id: "stp", label: "Spanning tree blocked ge-0/0/24" },
      ],
      correctOptionId: "local",
      explanation: "Keys never had to equal the partner's (10 vs 20 worked all along). What broke is consistency: SW2 put its two ports under different keys, so they can't share an aggregator, and SW1 sees two different partner keys across its members. The link is up and no spanning-tree decision is involved.",
    },
  },
  {
    id: "diagnostic-layers",
    label: "Troubleshooting layers",
    narrative: "Walk the layers: physical members, LACP exchange, aggregation selection, and distribution.",
  },
  {
    id: "repair-challenge",
    label: "Repair the bundle",
    narrative: "Choose the change that fixes the cause you identified.",
    action: (s, payload) => ({ state: applyLacpRepair(s, (payload as { choice: string }).choice), events: [ev("STEP_ENTERED", "repair-challenge", `Repair attempt: ${(payload as { choice: string }).choice}`)] }),
    requiresState: (s) => s.repaired,
  },
  {
    id: "verify-sync",
    label: "Verify: renegotiate ge-0/0/24",
    narrative: "With key 20 back on SW2 ge-0/0/24, SW2 reselects it into LAG1 and advertises key 20; SW1 sees consistent partner keys again, reselects the member and becomes Synchronized and Collecting.",
    run: (s) => {
      const a = setActor(idle(s), "SW2", M24, SYNCED());
      return { state: exchange(a, "verify-sync", "SW2", M24, collectIfPartnerSync, "RESELECTED · COLLECTING", "Partner key 20 on both SW1 members again: ge-0/0/24 fits LAG1. SW1 is Synchronized and Collecting."), events: [ev("PACKET_SENT", "verify-sync", "LACPDU key 20")] };
    },
    packet: pkt,
    whatChanged: (_p, n) => [memberLine(n, "SW1", M24), memberLine(n, "SW2", M24)],
  },
  {
    id: "verify-dist",
    label: "Verify: Collecting and Distributing",
    narrative: "Two more LACPDUs bring both ends of ge-0/0/24 to Distributing (0x3D). Only now is the member restored to LAG1.",
    run: (s) => {
      const a = exchange(idle(s), "verify-dist", "SW1", M24, distIfPartnerCollecting, "DISTRIBUTING", "SW2 sees SW1 collecting and starts Distributing.");
      return { state: exchange(a, "verify-dist", "SW2", M24, distIfPartnerCollecting, "DISTRIBUTING", "SW1 sees SW2 collecting and starts Distributing: ge-0/0/24 is a LAG1 member again."), events: [ev("PACKET_SENT", "verify-dist", "ge-0/0/24 distributing")] };
    },
    packet: pkt,
    whatChanged: (_p, n) => [lagStatus(n).text],
  },
  {
    id: "verify-flows",
    label: "Verify: both members in use",
    narrative: "Flow 2 hashes onto ge-0/0/24 again while Flow 1 stays on ge-0/0/23. Full capacity and redundancy restored.",
    run: (s) => ({ state: sw1Forward(hostSend(idle(s), "verify-flows", "F2", 3), "verify-flows", "F2", 3), events: [ev("PACKET_SENT", "verify-flows", "Flow 2 on ge-0/0/24")] }),
    packet: pkt,
    whatChanged: (_p, n) => [`Flow 1 → ${n.flowMap.F1} · Flow 2 → ${n.flowMap.F2}`],
  },
  {
    id: "lacp-vs-stp",
    label: "LACP and spanning tree together",
    narrative: "LACP makes parallel links between the SAME two switches one logical link and keeps its members healthy. Spanning tree still runs above it, treating LAG1 as one path when it builds a loop-free topology between switches. They solve different problems and work together.",
    run: (s) => ({ state: idle(s), events: [] }),
  },
  {
    id: "complete",
    label: "Lesson complete",
    narrative: "Actor and Partner, local keys, Synchronization → Collecting → Distributing, per-flow member choice, a surviving member, careful renegotiation — and a key that only had to be consistent on its own switch.",
  },
];

export const bitsFlags = (b: LacpBits) => BIT_ORDER.map(([k, n]) => `${n[0]}${b[k] ? "+" : "-"}`).join(" ");
