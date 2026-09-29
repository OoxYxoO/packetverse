import type { PacketLayer, PacketVisual, PVEvent, PVEventType, ScenarioStep } from "../types";
import type { PacketStackFrame, ProcessingStage } from "@/components/network3d/types";
import type { FundHop } from "@/components/lesson/fundamentalsTrace";
import { hex4, icmpPacket, type IcmpEcho } from "./fundamentalsPackets";
import { withNotes, type NotebookEntry } from "./troubleshootingCommon";

/**
 * Layer 2 Troubleshooting: VLANs, MACs & Loops — HOST-A — SW1, SW1/SW2/SW3 in a triangle, HOST-B on SW3.
 *
 * Modeled exactly:
 * - IEEE 802.1Q: access ports carry untagged frames of their PVID; trunks carry tagged frames whose 12-bit VID sits in
 *   the Tag Control Information (TCI = PCP(3) · DEI(1) · VID(12), shown in hex) after TPID 0x8100. Native VLAN 1 is
 *   untagged on every trunk and never used by the lesson's traffic.
 * - Per-port VLAN membership: a trunk forwards (and accepts) only the VLANs in its allowed list. Ingress filtering
 *   drops a tagged frame whose VID is not allowed on the receiving port BEFORE its source MAC is learned.
 * - Bridging per switch: classify VLAN → ingress filter → learn source MAC in that VLAN → look up destination
 *   (known unicast / unknown unicast / broadcast → flood within the VLAN) → egress candidates must be in the VLAN AND in
 *   an RSTP forwarding state → tag on trunks, untag on access ports, or drop. MAC entries age out after 300 s.
 * - RSTP (one tree for all VLANs here): SW2 is root (priority 4096), SW3 8192, SW1 32768; link cost 20000.
 *   Roles: SW1 ge-0/0/49 Root, ge-0/0/50 Alternate (Discarding); SW2 ge-0/0/49 and ge-0/0/51 Designated; SW3
 *   ge-0/0/51 Root, ge-0/0/50 Designated. The healthy tree has no loop and HOST-A ↔ HOST-B uses SW1 → SW2 → SW3.
 * - ICMP echoes use the shared byte-accurate builders; ARP is RFC 826.
 * Incident (truth, never shown before diagnosis): VLAN 10 is missing from SW2 ge-0/0/51's trunk allowed list (the
 * SW2 ↔ SW3 trunk). Links stay up, RSTP is unchanged, VLAN 20 still crosses the same trunk.
 */

export type L2Host = "HOST-A" | "HOST-B";
export type L2Sw = "SW1" | "SW2" | "SW3";
export type L2Device = L2Host | L2Sw;
export const L2_DEVICES: L2Device[] = ["HOST-A", "SW1", "SW2", "SW3", "HOST-B"];
export const L2_SWITCHES: L2Sw[] = ["SW1", "SW2", "SW3"];
export const L2_IP = { "HOST-A": "10.10.10.11", "HOST-B": "10.10.10.12" } as const;
export const L2_MAC = { "HOST-A": "00:00:5E:00:53:0A", "HOST-B": "00:00:5E:00:53:0B" } as const;
export const MGMT = { SW1: { ip: "10.20.20.1", mac: "00:00:5E:00:53:F1" }, SW2: { ip: "10.20.20.2", mac: "00:00:5E:00:53:F2" }, SW3: { ip: "10.20.20.3", mac: "00:00:5E:00:53:F3" } } as const;
export const BCAST = "FF:FF:FF:FF:FF:FF";
export const USER_VLAN = 10;
export const MGMT_VLAN = 20;
export const NATIVE_VLAN = 1;
export const MAC_AGE_S = 300;
export const BRIDGE_PRIO: Record<L2Sw, number> = { SW2: 4096, SW3: 8192, SW1: 32768 };

export type Role = "Root" | "Designated" | "Alternate" | "Edge";
export interface L2Port {
  sw: L2Sw;
  port: string;
  mode: "access" | "trunk";
  pvid?: number;
  peer: L2Device;
  peerPort?: string;
  link: string;
  role: Role;
}
export const L2_PORTS: L2Port[] = [
  { sw: "SW1", port: "ge-0/0/1", mode: "access", pvid: USER_VLAN, peer: "HOST-A", link: "L-A", role: "Edge" },
  { sw: "SW1", port: "ge-0/0/49", mode: "trunk", peer: "SW2", peerPort: "ge-0/0/49", link: "L-12", role: "Root" },
  { sw: "SW1", port: "ge-0/0/50", mode: "trunk", peer: "SW3", peerPort: "ge-0/0/50", link: "L-13", role: "Alternate" },
  { sw: "SW2", port: "ge-0/0/49", mode: "trunk", peer: "SW1", peerPort: "ge-0/0/49", link: "L-12", role: "Designated" },
  { sw: "SW2", port: "ge-0/0/51", mode: "trunk", peer: "SW3", peerPort: "ge-0/0/51", link: "L-23", role: "Designated" },
  { sw: "SW3", port: "ge-0/0/50", mode: "trunk", peer: "SW1", peerPort: "ge-0/0/50", link: "L-13", role: "Designated" },
  { sw: "SW3", port: "ge-0/0/51", mode: "trunk", peer: "SW2", peerPort: "ge-0/0/51", link: "L-23", role: "Root" },
  { sw: "SW3", port: "ge-0/0/1", mode: "access", pvid: USER_VLAN, peer: "HOST-B", link: "L-B", role: "Edge" },
];
export const pk = (sw: L2Sw, port: string) => `${sw}:${port}`;
export const portOf = (sw: L2Sw, port: string) => L2_PORTS.find((p) => p.sw === sw && p.port === port)!;
export const portToward = (sw: L2Sw, peer: L2Device) => L2_PORTS.find((p) => p.sw === sw && p.peer === peer)!;
export const stpState = (p: L2Port) => (p.role === "Alternate" ? "Discarding" : "Forwarding");
export const HOST_ATTACH: Record<L2Host, { sw: L2Sw; port: string }> = { "HOST-A": { sw: "SW1", port: "ge-0/0/1" }, "HOST-B": { sw: "SW3", port: "ge-0/0/1" } };

// ---------------------------------------------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------------------------------------------
export interface Fdb {
  vlan: number;
  mac: string;
  port: string;
  /** Lesson clock (s) when last refreshed. */
  seen: number;
}
export interface L2State {
  hops: FundHop[];
  packet?: PacketVisual;
  flood: { id: string; fromId: string; toId: string; packet: PacketVisual }[];
  /** Truth: allowed VLANs per trunk port. */
  allowed: Record<string, number[]>;
  fdb: Record<L2Sw, Fdb[]>;
  arpA: Record<string, string>;
  clock: number;
  pings: { label: string; vlan: number; sent: number; received: number }[];
  notebook: NotebookEntry[];
  decision?: { device: L2Device; text: string };
  faultActive: boolean;
  repairAttempt?: { choice: string; correct: boolean };
  repaired: boolean;
}
export function createL2State(): L2State {
  const allowed: Record<string, number[]> = {};
  for (const p of L2_PORTS) if (p.mode === "trunk") allowed[pk(p.sw, p.port)] = [USER_VLAN, MGMT_VLAN];
  return { hops: [], flood: [], allowed, fdb: { SW1: [], SW2: [], SW3: [] }, arpA: {}, clock: 0, pings: [], notebook: [], faultActive: false, repaired: false };
}
export const permits = (s: L2State, p: L2Port, vlan: number) => (p.mode === "access" ? p.pvid === vlan : (s.allowed[pk(p.sw, p.port)] ?? []).includes(vlan));
export const liveFdb = (s: L2State, sw: L2Sw) => s.fdb[sw].filter((e) => s.clock - e.seen < MAC_AGE_S);
export const allowedText = (s: L2State, sw: L2Sw, port: string) => (s.allowed[pk(sw, port)] ?? []).join(", ") || "none";
export const vlanMembers = (s: L2State, sw: L2Sw, vlan: number) => L2_PORTS.filter((p) => p.sw === sw && permits(s, p, vlan)).map((p) => p.port);

// ---------------------------------------------------------------------------------------------------------------
// Frames
// ---------------------------------------------------------------------------------------------------------------
export const tci = (vid: number, pcp = 0, dei = 0) => ((pcp & 7) << 13) | ((dei & 1) << 12) | (vid & 0xfff);
function dot1q(vid: number): PacketLayer {
  return { name: "802.1Q Tag", color: "#a78bfa", fields: [{ label: "TPID", value: "0x8100" }, { label: "TCI", value: `${hex4(tci(vid))} (PCP 0 · DEI 0 · VID ${vid})` }, { label: "VID (12 bits)", value: String(vid) }] };
}
export type Payload = { kind: "arp-request" | "arp-reply"; senderMac: string; senderIp: string; targetMac: string; targetIp: string } | { kind: "icmp"; echo: IcmpEcho; src: string; dst: string };
export interface L2Frame {
  src: string;
  dst: string;
  vlan: number;
  payload: Payload;
}
function arpLayer(p: Extract<Payload, { kind: "arp-request" | "arp-reply" }>): PacketLayer {
  return { name: "ARP", color: "#f59e0b", fields: [{ label: "Operation", value: p.kind === "arp-request" ? "1 (request)" : "2 (reply)" }, { label: "Sender MAC", value: p.senderMac }, { label: "Sender IP", value: p.senderIp }, { label: "Target MAC", value: p.targetMac }, { label: "Target IP", value: p.targetIp }] };
}
/** The frame as it exists on one link: tagged on trunks, untagged on access ports. */
export function l2Packet(id: string, f: L2Frame, from: L2Device, to: L2Device, tagged: boolean): PacketVisual {
  const eth: PacketLayer[] = tagged
    ? [{ name: "Ethernet Addresses", color: "#94a3b8", fields: [{ label: "Destination MAC", value: f.dst }, { label: "Source MAC", value: f.src }] }, dot1q(f.vlan), { name: "EtherType", color: "#94a3b8", fields: [{ label: "EtherType", value: f.payload.kind === "icmp" ? "0x0800 (IPv4)" : "0x0806 (ARP)" }] }]
    : [{ name: "Ethernet II Header", color: "#94a3b8", fields: [{ label: "Destination MAC", value: f.dst }, { label: "Source MAC", value: f.src }, { label: "EtherType", value: f.payload.kind === "icmp" ? "0x0800 (IPv4)" : "0x0806 (ARP)" }] }];
  const bc = f.dst === BCAST;
  const fcs: PacketLayer = { name: "FCS", color: "#94a3b8", fields: [{ label: "Frame Check Sequence", value: "CRC-32 over the frame (recomputed when a tag is added or removed)" }] };
  if (f.payload.kind === "icmp") {
    const ip = icmpPacket({ id, from, to, ethSrc: f.src, ethDst: f.dst, ip: { src: f.payload.src, dst: f.payload.dst, ttl: 64, id: 0x0a00 + f.payload.echo.sequence, df: false }, icmp: f.payload.echo });
    const body = ip.layers.filter((l) => l.name !== "Ethernet II Header" && l.name !== "FCS");
    return { id, protocol: "IP", from, to, badge: tagged ? `VID ${f.vlan}` : "ICMP", summary: `ICMP ${f.payload.echo.kind === "echo-request" ? "Echo Request" : "Echo Reply"} ${f.payload.src} → ${f.payload.dst}${tagged ? ` · 802.1Q VID ${f.vlan}` : " · untagged"}`, layers: [...eth, ...body, fcs] };
  }
  return { id, protocol: "ARP", from, to, broadcast: bc, badge: tagged ? `VID ${f.vlan}` : "ARP", summary: `ARP ${f.payload.kind === "arp-request" ? `request who-has ${f.payload.targetIp}` : `reply ${f.payload.senderIp} is-at ${f.payload.senderMac}`}${tagged ? ` · 802.1Q VID ${f.vlan}` : " · untagged"}`, layers: [...eth, arpLayer(f.payload), fcs] };
}
export const vidOf = (p: PacketVisual) => p.layers.find((l) => l.name === "802.1Q Tag")?.fields.find((x) => x.label === "VID (12 bits)")?.value;
const fld = (p: PacketVisual, label: string) => p.layers.flatMap((l) => l.fields).find((x) => x.label === label)?.value ?? "";
export function l2Stack(p: PacketVisual): PacketStackFrame[] {
  const vid = vidOf(p);
  const out: PacketStackFrame[] = [{ id: "eth", text: `Ethernet · dst ${fld(p, "Destination MAC")} · src ${fld(p, "Source MAC")}`, tone: "generic" }];
  out.push(vid ? { id: "tag", text: `802.1Q · TPID 0x8100 · VID ${vid}`, tone: "vpn" } : { id: "tag", text: "untagged (access port)", tone: "generic" });
  out.push(p.protocol === "ARP" ? { id: "arp", text: `ARP · ${fld(p, "Operation")} · target ${fld(p, "Target IP")}`, tone: "vpn" } : { id: "ip", text: `IPv4 · ${fld(p, "Source")} → ${fld(p, "Destination")} · ICMP seq ${fld(p, "Sequence Number")}`, tone: "ip" });
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Bridging
// ---------------------------------------------------------------------------------------------------------------
export const SW_STAGES: ProcessingStage[] = [
  { id: "rx", label: "Receive frame on port" },
  { id: "classify", label: "Classify VLAN (access PVID / 802.1Q VID) · ingress filter" },
  { id: "learn", label: "Learn source MAC in that VLAN" },
  { id: "lookup", label: "Destination lookup: known unicast / unknown / broadcast" },
  { id: "egress", label: "Egress candidates: in the VLAN? RSTP forwarding?" },
  { id: "tx", label: "Tag (trunk) / untag (access) and transmit — or drop" },
];
export const HOST_STAGES: ProcessingStage[] = [
  { id: "app", label: "ping / ARP" },
  { id: "tx", label: "Build untagged Ethernet frame, transmit" },
  { id: "rx", label: "Receive untagged frame" },
];
export const L2_STAGES: Record<L2Device, ProcessingStage[]> = { "HOST-A": HOST_STAGES, "HOST-B": HOST_STAGES, SW1: SW_STAGES, SW2: SW_STAGES, SW3: SW_STAGES };
export interface BridgeResult {
  vlan: number;
  ingressDropped?: string;
  learned: boolean;
  lookup: "broadcast" | "known" | "unknown";
  knownPort?: string;
  candidates: string[];
  forwarded: string[];
  dropped: { port: string; reason: string }[];
}
export function bridge(s: L2State, sw: L2Sw, ingress: string, f: L2Frame): { state: L2State; r: BridgeResult } {
  const inP = portOf(sw, ingress);
  const vlan = f.vlan;
  if (stpState(inP) !== "Forwarding") return { state: s, r: { vlan, ingressDropped: `${ingress} is RSTP ${inP.role}/${stpState(inP)}: it neither forwards nor learns`, learned: false, lookup: f.dst === BCAST ? "broadcast" : "unknown", candidates: [], forwarded: [], dropped: [] } };
  if (inP.mode === "trunk" && !permits(s, inP, vlan)) return { state: s, r: { vlan, ingressDropped: `VLAN ${vlan} is not in ${ingress}'s allowed list (${allowedText(s, sw, ingress)})`, learned: false, lookup: f.dst === BCAST ? "broadcast" : "unknown", candidates: [], forwarded: [], dropped: [] } };
  const fdb = [...s.fdb[sw].filter((e) => !(e.vlan === vlan && e.mac === f.src)), { vlan, mac: f.src, port: ingress, seen: s.clock }];
  const st = { ...s, fdb: { ...s.fdb, [sw]: fdb } };
  const hit = f.dst === BCAST ? undefined : liveFdb(st, sw).find((e) => e.vlan === vlan && e.mac === f.dst);
  const lookup = f.dst === BCAST ? "broadcast" : hit ? "known" : "unknown";
  const candidates = hit ? [hit.port] : L2_PORTS.filter((p) => p.sw === sw && p.port !== ingress).map((p) => p.port);
  const forwarded: string[] = [];
  const dropped: { port: string; reason: string }[] = [];
  for (const c of candidates) {
    const p = portOf(sw, c);
    if (c === ingress) dropped.push({ port: c, reason: "never back out the ingress port" });
    else if (!permits(s, p, vlan)) dropped.push({ port: c, reason: `VLAN ${vlan} not in ${c}'s egress permitted set (${p.mode === "access" ? `access PVID ${p.pvid}` : `allowed ${allowedText(s, sw, c)}`})` });
    else if (stpState(p) !== "Forwarding") dropped.push({ port: c, reason: `RSTP ${p.role} / ${stpState(p)}` });
    else forwarded.push(c);
  }
  return { state: st, r: { vlan, learned: true, lookup, knownPort: hit?.port, candidates, forwarded, dropped } };
}

const withDetail = (st: ProcessingStage[], d: Partial<Record<string, string>>) => st.map((x) => (d[x.id] ? { ...x, detail: d[x.id] } : x));
const ev = (type: PVEventType, stepId: string, message: string): PVEvent => ({ type, stepId, timestamp: Date.now(), message });
const idle = (s: L2State): L2State => ({ ...s, packet: undefined, flood: [], decision: undefined });
function hop(stepId: string, device: L2Device, o: { active: string; details: Partial<Record<string, string>>; lookupType: string; key: string; result: string; action: string; reason: string; input: string; output: string; ingress?: string; egress?: string; egressAll?: string[]; next?: L2Device; before?: PacketVisual; after?: PacketVisual }): FundHop {
  return { stepId, device, stages: withDetail(L2_STAGES[device], o.details), activeStageId: o.active, ingressInterfaceId: o.ingress, egressInterfaceId: o.egress, egressInterfaceIds: o.egressAll, lookupType: o.lookupType, lookupKey: o.key, lookupResult: o.result, action: o.action, reason: o.reason, input: o.input, output: o.output, nextHopId: o.next, before: o.before ? l2Stack(o.before) : undefined, after: o.after ? l2Stack(o.after) : undefined };
}
const frameText = (f: L2Frame) => (f.payload.kind === "icmp" ? `ICMP ${f.payload.echo.kind === "echo-request" ? "echo" : "reply"} seq ${f.payload.echo.sequence}` : f.payload.kind === "arp-request" ? `ARP who-has ${f.payload.targetIp}` : `ARP reply ${f.payload.senderIp}`);

/** One switch processes a frame arriving from `from`; the animation shows it on the link it arrived on (or left on). */
function switchStep(s0: L2State, stepId: string, sw: L2Sw, from: L2Device, f: L2Frame, show: "in" | "out"): { state: L2State; r: BridgeResult } {
  const inPort = portToward(sw, from);
  const { state, r } = bridge(idle(s0), sw, inPort.port, f);
  const inPkt = l2Packet(`${stepId}-in`, f, from, sw, inPort.mode === "trunk");
  const outPort = r.forwarded[0] ? portOf(sw, r.forwarded[0]) : undefined;
  const outPkt = outPort ? l2Packet(`${stepId}-out`, f, sw, outPort.peer, outPort.mode === "trunk") : undefined;
  const dropLine = r.ingressDropped ?? (r.dropped.length ? r.dropped.map((d) => `${d.port}: ${d.reason}`).join(" · ") : "");
  const h = hop(stepId, sw, {
    active: r.ingressDropped ? "classify" : r.forwarded.length ? "tx" : "egress",
    ingress: inPort.port,
    egress: r.forwarded[0],
    egressAll: r.forwarded.length > 1 ? r.forwarded : undefined,
    details: {
      rx: `${frameText(f)} on ${inPort.port} (${inPort.mode}${inPort.mode === "trunk" ? `, tagged VID ${f.vlan}` : ", untagged"})`,
      classify: inPort.mode === "access" ? `access PVID ${inPort.pvid} → VLAN ${f.vlan}` : `802.1Q VID ${f.vlan} · ${inPort.port} allowed ${allowedText(s0, sw, inPort.port)}${r.ingressDropped ? " → INGRESS FILTER DROP" : " → accepted"}`,
      learn: r.learned ? `VLAN ${f.vlan} · ${f.src} → ${inPort.port}` : "not learned (dropped before learning)",
      lookup: r.ingressDropped ? "—" : r.lookup === "broadcast" ? "broadcast → flood within VLAN" : r.lookup === "known" ? `known unicast → ${r.knownPort}` : "unknown unicast → flood within VLAN",
      egress: r.ingressDropped ? "—" : `candidates ${r.candidates.join(", ") || "none"}${r.dropped.length ? ` · removed: ${r.dropped.map((d) => `${d.port} (${d.reason})`).join("; ")}` : ""}`,
      tx: r.forwarded.length ? r.forwarded.map((p) => `${p} ${portOf(sw, p).mode === "trunk" ? `tagged VID ${f.vlan}` : "untagged"}`).join(" · ") : "no egress port remains → frame dropped",
    },
    lookupType: `${sw} bridging, VLAN ${f.vlan}`,
    key: `${f.dst === BCAST ? "broadcast" : f.dst} in VLAN ${f.vlan}`,
    result: r.forwarded.length ? `forward ${r.forwarded.join(", ")}` : `DROP — ${dropLine}`,
    action: r.forwarded.length ? (r.lookup === "known" ? "FORWARD" : "FLOOD") : "DROP",
    reason: r.ingressDropped ? `The frame's VLAN is not allowed on the receiving trunk, so the switch discards it before learning its source MAC. ${r.ingressDropped}.` : r.forwarded.length ? `${r.lookup === "known" ? "Known unicast" : r.lookup === "broadcast" ? "Broadcast" : "Unknown unicast"} in VLAN ${f.vlan}: sent on ${r.forwarded.join(", ")}${r.dropped.length ? `; not on ${r.dropped.map((d) => `${d.port} (${d.reason})`).join(", ")}` : ""}.` : `Every egress candidate was removed: ${dropLine}. The destination MAC ${r.lookup === "known" ? "is known — the drop is about VLAN permission, not an unknown address" : "was not the issue by itself"}.`,
    input: `${frameText(f)} · VLAN ${f.vlan}`,
    output: r.forwarded.length ? `${frameText(f)} → ${r.forwarded.join(", ")}` : "nothing (dropped)",
    next: outPort?.peer,
    before: inPkt,
    after: outPkt,
  });
  const packet = show === "out" && outPkt ? outPkt : inPkt;
  return { state: { ...state, hops: [...s0.hops, h], packet, decision: { device: sw, text: r.forwarded.length ? `${sw}: VLAN ${f.vlan} → ${r.forwarded.join(", ")}` : `${sw}: ${dropLine}` } }, r };
}
function hostTx(s0: L2State, stepId: string, h: L2Host, f: L2Frame, action: string, reason: string): L2State {
  const at = HOST_ATTACH[h];
  const p = l2Packet(`${stepId}-pkt`, f, h, at.sw, false);
  const hp = hop(stepId, h, { active: "tx", egress: "eth0", details: { app: frameText(f), tx: `untagged · dst ${f.dst} · src ${f.src}` }, lookupType: `${h} host`, key: frameText(f), result: "transmitted untagged", action, reason, input: frameText(f), output: "frame on the wire", next: at.sw, after: p });
  return { ...idle(s0), hops: [...s0.hops, hp], packet: p };
}
function hostRx(s: L2State, stepId: string, h: L2Host, f: L2Frame, result: string, reason: string): L2State {
  const hp = hop(stepId, h, { active: "rx", ingress: "eth0", details: { rx: `${frameText(f)} · untagged · for ${f.dst === BCAST ? "everyone" : f.dst}` }, lookupType: `${h} host`, key: frameText(f), result, action: "RX", reason, input: frameText(f), output: result });
  return { ...s, hops: [...s.hops, hp] };
}

// Frame catalog
export const ECHO_ID = 0x0a0a;
const echo = (kind: IcmpEcho["kind"], seq: number): IcmpEcho => ({ kind, identifier: ECHO_ID, sequence: seq, dataLength: 56 });
export const F = {
  arpReq: (): L2Frame => ({ src: L2_MAC["HOST-A"], dst: BCAST, vlan: USER_VLAN, payload: { kind: "arp-request", senderMac: L2_MAC["HOST-A"], senderIp: L2_IP["HOST-A"], targetMac: "00:00:00:00:00:00", targetIp: L2_IP["HOST-B"] } }),
  arpRep: (): L2Frame => ({ src: L2_MAC["HOST-B"], dst: L2_MAC["HOST-A"], vlan: USER_VLAN, payload: { kind: "arp-reply", senderMac: L2_MAC["HOST-B"], senderIp: L2_IP["HOST-B"], targetMac: L2_MAC["HOST-A"], targetIp: L2_IP["HOST-A"] } }),
  echo: (seq: number): L2Frame => ({ src: L2_MAC["HOST-A"], dst: L2_MAC["HOST-B"], vlan: USER_VLAN, payload: { kind: "icmp", echo: echo("echo-request", seq), src: L2_IP["HOST-A"], dst: L2_IP["HOST-B"] } }),
  reply: (seq: number): L2Frame => ({ src: L2_MAC["HOST-B"], dst: L2_MAC["HOST-A"], vlan: USER_VLAN, payload: { kind: "icmp", echo: echo("echo-reply", seq), src: L2_IP["HOST-B"], dst: L2_IP["HOST-A"] } }),
  mgmt: (seq: number): L2Frame => ({ src: MGMT.SW1.mac, dst: MGMT.SW3.mac, vlan: MGMT_VLAN, payload: { kind: "icmp", echo: { kind: "echo-request", identifier: 0x2020, sequence: seq, dataLength: 56 }, src: MGMT.SW1.ip, dst: MGMT.SW3.ip } }),
};

/**
 * Silently run a frame through the switches (used for traffic that is summarized rather than animated), following
 * EVERY flooded copy. Returns whether any copy reached an access port facing the destination host (or, for VLAN 20,
 * reached SW3, which owns the destination management address).
 */
function carry(s: L2State, origin: L2Host | "SW1-MGMT", f: L2Frame): { state: L2State; delivered: boolean } {
  let st = s;
  let delivered = false;
  const queue: { sw: L2Sw; from: L2Device }[] = origin === "SW1-MGMT" ? [{ sw: "SW2", from: "SW1" }] : [{ sw: HOST_ATTACH[origin].sw, from: origin }];
  const seen = new Set<string>();
  while (queue.length) {
    const { sw, from } = queue.shift()!;
    const inPort = portToward(sw, from).port;
    if (seen.has(`${sw}:${inPort}`)) continue;
    seen.add(`${sw}:${inPort}`);
    const { state, r } = bridge(st, sw, inPort, f);
    st = state;
    if (f.vlan === MGMT_VLAN && sw === "SW3" && !r.ingressDropped) {
      delivered = true;
      continue;
    }
    for (const out of r.forwarded) {
      const p = portOf(sw, out);
      if (p.peer === "HOST-A" || p.peer === "HOST-B") {
        if (f.dst === BCAST || f.dst === L2_MAC[p.peer as L2Host]) delivered = true;
      } else queue.push({ sw: p.peer as L2Sw, from: sw });
    }
  }
  return { state: st, delivered };
}
const tick = (s: L2State, sec: number): L2State => ({ ...s, clock: s.clock + sec });

// ---------------------------------------------------------------------------------------------------------------
// Repair
// ---------------------------------------------------------------------------------------------------------------
export const L2_REPAIR_OPTIONS = [
  { id: "allow-10", label: "Add VLAN 10 to the allowed VLAN list on SW2 ge-0/0/51 (the SW2 ↔ SW3 trunk)" },
  { id: "host-ip", label: "Change HOST-A's IP address" },
  { id: "restart-stp", label: "Restart spanning tree on all three switches" },
  { id: "clear-arp", label: "Clear the ARP caches on HOST-A and HOST-B" },
  { id: "native", label: "Change the native VLAN on the SW2 ↔ SW3 trunk to 10" },
  { id: "cable", label: "Replace the SW2 ↔ SW3 cable" },
] as const;
export const L2_REPAIR_CORRECT = "allow-10";
export function applyL2Repair(s: L2State, choice: string): L2State {
  const correct = choice === L2_REPAIR_CORRECT;
  if (!correct) return { ...s, repairAttempt: { choice, correct } };
  const k = pk("SW2", "ge-0/0/51");
  return { ...idle(s), allowed: { ...s.allowed, [k]: [...new Set([...s.allowed[k], USER_VLAN])].sort((a, b) => a - b) }, faultActive: false, repaired: true, repairAttempt: { choice, correct }, decision: { device: "SW2", text: "SW2 ge-0/0/51: allowed VLANs 10, 20" } };
}

// ---------------------------------------------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------------------------------------------
const pkt = (s: L2State) => s.packet;
export const fdbText = (s: L2State, sw: L2Sw, vlan: number) =>
  liveFdb(s, sw)
    .filter((e) => e.vlan === vlan)
    .map((e) => `${e.mac === L2_MAC["HOST-A"] ? "HOST-A" : e.mac === L2_MAC["HOST-B"] ? "HOST-B" : e.mac} → ${e.port}`)
    .join(", ") || "no entries";
const evidence = (s: L2State, stepId: string, sw: L2Sw, o: { active: string; details: Partial<Record<string, string>>; action: string; reason: string; key: string; result: string }): L2State => ({ ...s, hops: [...s.hops, hop(stepId, sw, { ...o, lookupType: `${sw} evidence`, input: o.key, output: o.result })] });
const ping = (s: L2State, label: string, vlan: number, sent: number, received: number): L2State => ({ ...s, pings: [...s.pings, { label, vlan, sent, received }] });

export const l2Steps: ScenarioStep<L2State>[] = [
  // ---- Define / Scope ---
  {
    id: "intro",
    label: "Three switches, two VLANs",
    narrative: `HOST-A (${L2_IP["HOST-A"]}) on SW1 and HOST-B (${L2_IP["HOST-B"]}) on SW3 are both in VLAN ${USER_VLAN}. The switches form a triangle of 802.1Q trunks for redundancy; each trunk carries VLAN ${USER_VLAN} (users) and VLAN ${MGMT_VLAN} (switch management, 10.20.20.0/24). Native VLAN ${NATIVE_VLAN} is untagged and unused by this traffic.`,
    run: (s) => ({ state: withNotes(idle(s), "intro", [{ kind: "observation", text: `Service: HOST-A ↔ HOST-B, VLAN ${USER_VLAN}, same subnet 10.10.10.0/24 (no router)`, source: "design" }]), events: [ev("STEP_ENTERED", "intro", "scope")] }),
  },
  {
    id: "vlan-design",
    label: "Access ports and trunks",
    narrative: `Access ports (SW1 ge-0/0/1, SW3 ge-0/0/1) carry untagged frames of their PVID, ${USER_VLAN}. Trunks carry tagged frames: an 802.1Q tag (TPID 0x8100) with a 12-bit VLAN ID — ${USER_VLAN} is TCI ${hex4(tci(USER_VLAN))}. A trunk forwards only the VLANs in its allowed list; today every trunk allows ${USER_VLAN} and ${MGMT_VLAN}.`,
    run: (s) => ({ state: evidence(idle(s), "vlan-design", "SW2", { active: "classify", details: { classify: L2_PORTS.filter((p) => p.sw === "SW2").map((p) => `${p.port} ${p.mode} · allowed ${allowedText(s, "SW2", p.port)} · native ${NATIVE_VLAN}`).join(" | ") }, action: "VLAN CONFIG", reason: "VLAN membership is per port, on every switch along the path. A trunk that does not list a VLAN neither sends nor accepts it.", key: "show vlan / show interfaces trunk", result: `VLAN ${USER_VLAN} on every trunk` }), events: [ev("STEP_ENTERED", "vlan-design", "vlans")] }),
  },
  {
    id: "q-tag",
    label: "Question: the 802.1Q tag",
    narrative: `A frame on the SW1 → SW2 trunk carries TPID 0x8100 and TCI ${hex4(tci(USER_VLAN))}.`,
    question: {
      prompt: "What does the 802.1Q tag identify?",
      options: [
        { id: "vlan", label: `The VLAN the frame belongs to (VID ${USER_VLAN} in the low 12 bits of the TCI), so the next switch keeps it in the right broadcast domain` },
        { id: "dst", label: "The destination switch" },
        { id: "ip", label: "The destination IP subnet" },
        { id: "stp", label: "The spanning-tree instance only" },
      ],
      correctOptionId: "vlan",
      explanation: "The tag carries the VLAN ID (plus 3 priority bits and a DEI bit). Switches add it when a frame leaves on a trunk and remove it on an access port.",
    },
  },
  {
    id: "rstp-state",
    label: "RSTP: a loop-free tree",
    narrative: "Three switches in a triangle would loop forever without spanning tree. RSTP elects SW2 root (priority 4096). SW3's root port is ge-0/0/51 (toward SW2); SW1's root port is ge-0/0/49. On the SW1 ↔ SW3 link, SW3 is designated and SW1's ge-0/0/50 is Alternate, Discarding. The active tree is SW1 — SW2 — SW3.",
    run: (s) => ({ state: withNotes(evidence(idle(s), "rstp-state", "SW1", { active: "egress", details: { egress: L2_PORTS.filter((p) => p.mode === "trunk").map((p) => `${p.sw} ${p.port} ${p.role}/${stpState(p)}`).join(" · ") }, action: "RSTP ROLES", reason: "Exactly one port on the triangle discards, which breaks the loop while keeping the link ready as a backup.", key: "show spanning-tree", result: "root SW2 · SW1 ge-0/0/50 Alternate/Discarding" }), "rstp-state", [{ kind: "observation", text: "RSTP: root SW2; SW1 ge-0/0/50 Alternate/Discarding; path HOST-A → SW1 → SW2 → SW3 → HOST-B", source: "show spanning-tree", rung: "Ethernet / VLAN" }]), events: [ev("STEP_ENTERED", "rstp-state", "stp")] }),
  },
  {
    id: "q-stp-path",
    label: "Question: which path?",
    narrative: "SW1 ge-0/0/50 (to SW3) is Discarding.",
    question: {
      prompt: "Which path does VLAN 10 traffic between HOST-A and HOST-B take?",
      options: [
        { id: "via-sw2", label: "SW1 → SW2 → SW3: the direct SW1 ↔ SW3 link is discarding on SW1's side" },
        { id: "direct", label: "SW1 → SW3 directly" },
        { id: "both", label: "Both paths at once, for load sharing" },
        { id: "none", label: "None — a discarding port blocks the whole VLAN" },
      ],
      correctOptionId: "via-sw2",
      explanation: "Spanning tree leaves one path. Traffic between SW1 and SW3 goes through the root, SW2 — so the SW2 ↔ SW3 trunk is on the path.",
    },
  },
  // ---- Baseline ---
  {
    id: "base-arp",
    label: "Baseline: ARP broadcast",
    narrative: `HOST-A needs HOST-B's MAC and broadcasts an ARP request, untagged. SW1 classifies it into VLAN ${USER_VLAN} (access PVID), learns HOST-A, and floods it within VLAN ${USER_VLAN}: out ge-0/0/49 tagged VID ${USER_VLAN}; not out ge-0/0/50, which RSTP keeps Discarding.`,
    run: (s) => {
      const f = F.arpReq();
      const n = hostTx(s, "base-arp", "HOST-A", f, "ARP REQUEST", "Same subnet: HOST-A resolves HOST-B's MAC directly.");
      const { state } = switchStep(n, "base-arp", "SW1", "HOST-A", f, "in");
      return { state: { ...state, packet: l2Packet("base-arp-pkt", f, "HOST-A", "SW1", false) }, events: [ev("PACKET_SENT", "base-arp", "ARP")] };
    },
    packet: pkt,
  },
  {
    id: "base-arp-sw2",
    label: "Baseline: SW2 floods to SW3",
    narrative: `SW2 receives VID ${USER_VLAN} on ge-0/0/49 (allowed), learns HOST-A there, and floods: the only other VLAN ${USER_VLAN} port is ge-0/0/51 toward SW3, allowed and Forwarding — sent tagged VID ${USER_VLAN}.`,
    run: (s) => {
      const { state } = switchStep(s, "base-arp-sw2", "SW2", "SW1", F.arpReq(), "out");
      return { state, events: [ev("PACKET_SENT", "base-arp-sw2", "ARP flood")] };
    },
    packet: pkt,
  },
  {
    id: "base-arp-sw3",
    label: "Baseline: SW3 delivers untagged",
    narrative: `SW3 accepts VID ${USER_VLAN} on ge-0/0/51, learns HOST-A behind it, and floods: ge-0/0/1 (access, PVID ${USER_VLAN}) gets the frame untagged; ge-0/0/50 is a trunk in VLAN ${USER_VLAN} and Forwarding on SW3's side, so a copy goes to SW1 too — where SW1's ge-0/0/50, Alternate/Discarding, drops it. No loop.`,
    run: (s) => {
      const { state } = switchStep(s, "base-arp-sw3", "SW3", "SW2", F.arpReq(), "out");
      const n = hostRx(state, "base-arp-sw3", "HOST-B", F.arpReq(), "ARP request for my IP → reply", "HOST-B owns 10.10.10.12 and answers with a unicast ARP reply.");
      return { state: { ...n, packet: l2Packet("base-arp-sw3-pkt", F.arpReq(), "SW3", "HOST-B", false) }, events: [ev("PACKET_SENT", "base-arp-sw3", "ARP delivered")] };
    },
    packet: pkt,
  },
  {
    id: "base-reply",
    label: "Baseline: unicast ARP reply",
    narrative: "HOST-B replies unicast to HOST-A's MAC. SW3 learned HOST-A on ge-0/0/51 a moment ago — known unicast, sent tagged VID 10 to SW2; SW2 knows HOST-A on ge-0/0/49 → SW1 → HOST-A. Each switch now also learns HOST-B.",
    run: (s) => {
      const f = F.arpRep();
      let n = hostTx(s, "base-reply", "HOST-B", f, "ARP REPLY", "Unicast back to the asker.");
      n = switchStep(n, "base-reply", "SW3", "HOST-B", f, "out").state;
      n = switchStep(n, "base-reply", "SW2", "SW3", f, "out").state;
      n = switchStep(n, "base-reply", "SW1", "SW2", f, "out").state;
      return { state: { ...n, packet: l2Packet("base-reply-pkt", f, "SW3", "SW2", true), arpA: { [L2_IP["HOST-B"]]: L2_MAC["HOST-B"] } }, events: [ev("PACKET_SENT", "base-reply", "ARP reply")] };
    },
    packet: pkt,
  },
  {
    id: "base-ping",
    label: "Baseline: ping crosses SW2 ↔ SW3",
    narrative: "HOST-A pings HOST-B. The echo is a known unicast at every switch; on the SW2 → SW3 trunk it carries VID 10. 5/5 replies.",
    run: (s) => {
      let n = tick(idle(s), 2);
      for (let q = 1; q <= 5; q++) {
        n = carry(n, "HOST-A", F.echo(q)).state;
        n = carry(n, "HOST-B", F.reply(q)).state;
      }
      n = switchStep(n, "base-ping", "SW2", "SW1", F.echo(1), "out").state;
      return { state: withNotes(ping(n, "baseline", USER_VLAN, 5, 5), "base-ping", [{ kind: "observation", text: "Baseline: HOST-A → HOST-B 5/5 replies", source: "ping" }]), events: [ev("PACKET_SENT", "base-ping", "echo")] };
    },
    packet: pkt,
  },
  {
    id: "base-mac",
    label: "Baseline: MAC tables",
    narrative: "Every switch knows both hosts in VLAN 10: SW1 (A → ge-0/0/1, B → ge-0/0/49), SW2 (A → ge-0/0/49, B → ge-0/0/51), SW3 (A → ge-0/0/51, B → ge-0/0/1). That symmetric picture is the baseline.",
    run: (s) => ({ state: withNotes(evidence(idle(s), "base-mac", "SW2", { active: "learn", details: { learn: L2_SWITCHES.map((sw) => `${sw}: ${fdbText(s, sw, USER_VLAN)}`).join(" | ") }, action: "MAC TABLES", reason: "A switch learns a MAC on the port where frames FROM it arrive. The table shows the path each switch uses toward each host.", key: "show ethernet-switching table vlan 10", result: "both hosts on all three switches" }), "base-mac", [{ kind: "observation", text: `Baseline MAC tables, VLAN 10 — ${L2_SWITCHES.map((sw) => `${sw}: ${fdbText(s, sw, USER_VLAN)}`).join(" | ")}`, source: "MAC tables", rung: "Ethernet / VLAN" }]), events: [ev("STEP_ENTERED", "base-mac", "fdb")] }),
  },
  // ---- Incident ---
  {
    id: "incident-intro",
    label: "Incident: HOST-A cannot reach HOST-B",
    narrative: "After last night's change window, HOST-A reports it cannot reach HOST-B. Nothing else is reported as broken. Scope first: which hosts, which VLAN, which path?",
    run: (s) => ({ state: withNotes({ ...tick(idle(s), 60), allowed: { ...s.allowed, [pk("SW2", "ge-0/0/51")]: [MGMT_VLAN] }, faultActive: true }, "incident-intro", [{ kind: "symptom", text: "HOST-A cannot reach HOST-B (VLAN 10); no other complaints", source: "user report" }]), events: [ev("STEP_ENTERED", "incident-intro", "incident")] }),
  },
  {
    id: "inc-echo",
    label: "Echo leaves HOST-A",
    narrative: "HOST-A still has HOST-B's MAC in its ARP cache, so it sends the echo straight to 00:00:5E:00:53:0B, untagged. SW1 knows that MAC on ge-0/0/49 — known unicast, sent tagged VID 10 toward SW2.",
    run: (s) => {
      const f = F.echo(11);
      const n = hostTx(s, "inc-echo", "HOST-A", f, "TX ECHO", "ARP entry still cached: unicast to HOST-B's MAC.");
      const { state } = switchStep(n, "inc-echo", "SW1", "HOST-A", f, "out");
      return { state, events: [ev("PACKET_SENT", "inc-echo", "echo")] };
    },
    packet: pkt,
  },
  {
    id: "inc-sw2",
    label: "SW2 processes the echo",
    narrative: "SW2 accepts VID 10 on ge-0/0/49, looks up HOST-B's MAC — known, on ge-0/0/51 — and then checks whether VLAN 10 may leave ge-0/0/51. Inspect SW2's pipeline for this frame.",
    run: (s) => {
      const { state } = switchStep(s, "inc-sw2", "SW2", "SW1", F.echo(11), "in");
      return { state, events: [ev("PACKET_SENT", "inc-sw2", "SW2 decision")] };
    },
    packet: pkt,
  },
  {
    id: "inc-ping-summary",
    label: "Ping: 0/5",
    narrative: "HOST-A's ping: 5 sent, 0 received. The frames never reached SW3.",
    run: (s) => {
      let n = tick(idle(s), 4);
      for (let q = 12; q <= 15; q++) n = carry(n, "HOST-A", F.echo(q)).state;
      return { state: withNotes(ping(n, "incident", USER_VLAN, 5, 0), "inc-ping-summary", [{ kind: "observation", text: "HOST-A → HOST-B: 0/5 replies", source: "ping" }, { kind: "observation", text: "SW2: echo to HOST-B (known on ge-0/0/51) not transmitted — VLAN 10 not in ge-0/0/51's egress permitted set", source: "SW2 pipeline", rung: "Ethernet / VLAN" }]), events: [ev("STEP_ENTERED", "inc-ping-summary", "ping")] };
    },
  },
  {
    id: "q-link-up",
    label: "Question: link UP?",
    narrative: "Someone checks SW2 ge-0/0/51: up/up.",
    question: {
      prompt: "Does 'link UP' on the SW2 ↔ SW3 trunk prove all VLANs work across it?",
      options: [
        { id: "no", label: "No — link state is physical; each VLAN also needs membership (allowed lists) and a forwarding STP state" },
        { id: "yes", label: "Yes — if the link is up, every VLAN passes" },
        { id: "native", label: "Only the native VLAN needs checking" },
        { id: "speed", label: "Only if the speed is 1 Gb/s" },
      ],
      correctOptionId: "no",
      explanation: "A trunk can be perfectly healthy physically and still carry only some VLANs.",
    },
  },
  {
    id: "inc-link-stp",
    label: "Links and RSTP: unchanged",
    narrative: "All three trunks: up/up, no errors. RSTP: root still SW2; every role and state identical to the baseline — SW2 ge-0/0/51 Designated/Forwarding, SW3 ge-0/0/51 Root/Forwarding, SW1 ge-0/0/50 Alternate/Discarding. No topology change was recorded.",
    run: (s) => ({ state: withNotes(evidence(idle(s), "inc-link-stp", "SW2", { active: "egress", details: { egress: L2_PORTS.filter((p) => p.mode === "trunk").map((p) => `${p.sw} ${p.port} up/up · ${p.role}/${stpState(p)}`).join(" · ") }, action: "LINK + RSTP", reason: "Same roles, same states, no topology change: spanning tree is not what changed.", key: "show interfaces · show spanning-tree", result: "unchanged from baseline" }), "inc-link-stp", [{ kind: "observation", text: "Trunks up/up, no errors; RSTP roles/states identical to baseline", source: "interfaces + RSTP", rung: "Physical / interface" }, { kind: "ruled-out", text: "Physical link fault (all trunks up, error-free)" }, { kind: "ruled-out", text: "Spanning tree (no role/state change; SW2 ge-0/0/51 Forwarding)" }]), events: [ev("STEP_ENTERED", "inc-link-stp", "stp")] }),
  },
  {
    id: "q-stp",
    label: "Question: blame STP?",
    narrative: "The topology is redundant, and a colleague suspects spanning tree.",
    question: {
      prompt: "Why is STP not the culprit here?",
      options: [
        { id: "evidence", label: "Every role and state is identical to the baseline and SW2 ge-0/0/51 is Forwarding; SW2 removed the port for a VLAN reason, not an STP one" },
        { id: "never", label: "STP can never cause connectivity problems" },
        { id: "rstp", label: "RSTP converges too fast to matter" },
        { id: "redundant", label: "Because the topology is redundant" },
      ],
      correctOptionId: "evidence",
      explanation: "Redundancy makes STP a plausible suspect, not a proven one. The evidence — unchanged roles, a Forwarding port, and SW2's own drop reason — rules it out.",
    },
  },
  {
    id: "inc-vlan20",
    label: "VLAN 20 still crosses the same trunk",
    narrative: "Management ping SW1 (10.20.20.1) → SW3 (10.20.20.3), VLAN 20: 5/5. On the SW2 → SW3 trunk the frame carries VID 20 — the same physical trunk, the same Forwarding ports.",
    run: (s) => {
      let n = tick(idle(s), 2);
      for (let q = 1; q <= 5; q++) n = carry(n, "SW1-MGMT", F.mgmt(q)).state;
      // SW3's echo replies (VLAN 20, SW3 → SW2 → SW1) teach both switches where SW3's management MAC lives.
      const learn3 = (sw: L2Sw, port: string): Fdb[] => [...n.fdb[sw].filter((e) => !(e.vlan === MGMT_VLAN && e.mac === MGMT.SW3.mac)), { vlan: MGMT_VLAN, mac: MGMT.SW3.mac, port, seen: n.clock }];
      n = { ...n, fdb: { ...n.fdb, SW2: learn3("SW2", "ge-0/0/51"), SW1: learn3("SW1", "ge-0/0/49") } };
      n = switchStep(n, "inc-vlan20", "SW2", "SW1", F.mgmt(1), "out").state;
      return { state: withNotes(ping(n, "mgmt SW1 → SW3", MGMT_VLAN, 5, 5), "inc-vlan20", [{ kind: "observation", text: "VLAN 20 SW1 → SW3 across SW2 ↔ SW3: 5/5", source: "management ping", rung: "Ethernet / VLAN" }, { kind: "inference", text: "The trunk carries VLAN 20 but not VLAN 10: the problem is VLAN-specific" }]), events: [ev("PACKET_SENT", "inc-vlan20", "VID 20")] };
    },
    packet: pkt,
  },
  {
    id: "q-other-vlans",
    label: "Question: why does VLAN 20 work?",
    narrative: "VLAN 20 crosses the SW2 ↔ SW3 trunk; VLAN 10 does not.",
    question: {
      prompt: "Why would other VLANs still work over the same trunk?",
      options: [
        { id: "perlan", label: "VLAN membership is checked per VLAN, per port: VLAN 20 is still allowed on the trunk even if VLAN 10 is not" },
        { id: "priority", label: "VLAN 20 has a higher priority" },
        { id: "stp", label: "VLAN 20 uses a different physical cable" },
        { id: "luck", label: "Coincidence — it will fail soon too" },
      ],
      correctOptionId: "perlan",
      explanation: "An allowed list is a per-VLAN permit. A problem limited to one VLAN on a working trunk points at membership, not at the link.",
    },
  },
  {
    id: "inc-mac-age",
    label: "MAC tables, five minutes later",
    narrative: "After the 300 s aging time: SW2 has HOST-A (on ge-0/0/49) but no HOST-B; SW3 has HOST-B (on ge-0/0/1) but no HOST-A. HOST-B's frames never make it into SW2, and HOST-A's never reach SW3. The picture is asymmetric — incomplete for VLAN 10 only.",
    run: (s) => {
      let n = tick(idle(s), MAC_AGE_S);
      n = carry(n, "HOST-A", F.arpReq()).state;
      n = carry(n, "HOST-B", F.reply(99)).state;
      return { state: withNotes(evidence(n, "inc-mac-age", "SW2", { active: "learn", details: { learn: L2_SWITCHES.map((sw) => `${sw}: ${fdbText(n, sw, USER_VLAN)}`).join(" | ") }, action: "MAC TABLES", reason: "Entries refresh only when frames FROM a MAC arrive. What never arrives ages out.", key: "show ethernet-switching table vlan 10", result: "asymmetric: SW2 lacks HOST-B, SW3 lacks HOST-A" }), "inc-mac-age", [{ kind: "observation", text: `VLAN 10 MAC tables — ${L2_SWITCHES.map((sw) => `${sw}: ${fdbText(n, sw, USER_VLAN)}`).join(" | ")}`, source: "MAC tables", rung: "Ethernet / VLAN" }, { kind: "inference", text: "VLAN 10 frames stop at the SW2 ↔ SW3 boundary in both directions" }]), events: [ev("STEP_ENTERED", "inc-mac-age", "fdb")] };
    },
  },
  {
    id: "q-missing-mac",
    label: "Question: a missing MAC",
    narrative: "SW2's VLAN 10 table no longer lists HOST-B.",
    question: {
      prompt: "Does a missing remote MAC prove the remote host is down?",
      options: [
        { id: "no", label: "No — it proves only that no frame from it has arrived at that switch recently; HOST-B is up and learned on SW3" },
        { id: "yes", label: "Yes — a switch always knows every live host" },
        { id: "cable", label: "It proves HOST-B's cable is unplugged" },
        { id: "ip", label: "It proves HOST-B has no IP address" },
      ],
      correctOptionId: "no",
      explanation: "MAC tables are built from traffic that arrives. SW3 still learns HOST-B locally; the missing entry on SW2 locates the break between them.",
    },
  },
  {
    id: "inc-unknown",
    label: "Unknown unicast at SW2",
    narrative: "HOST-A tries again. SW1 no longer knows HOST-B either, so it floods the unknown unicast within VLAN 10 (ge-0/0/49 only). At SW2 it is unknown too: flood candidates are the VLAN 10 ports except the ingress — and ge-0/0/51 is not one of them. Nothing leaves SW2.",
    run: (s) => {
      const { state } = switchStep(s, "inc-unknown", "SW2", "SW1", F.echo(21), "in");
      return { state, events: [ev("PACKET_SENT", "inc-unknown", "unknown unicast")] };
    },
    packet: pkt,
  },
  {
    id: "inc-vlan-table",
    label: "Compare both ends of the trunk",
    narrative: `SW2 ge-0/0/51 (trunk, native 1): allowed VLANs 20. SW3 ge-0/0/51 (trunk, native 1): allowed VLANs 10, 20. 'show vlan 10' on SW2 lists ge-0/0/49 — not ge-0/0/51. The two ends of one trunk disagree about VLAN 10.`,
    run: (s) => ({ state: withNotes(evidence(idle(s), "inc-vlan-table", "SW2", { active: "classify", details: { classify: `SW2 ge-0/0/51 allowed ${allowedText(s, "SW2", "ge-0/0/51")} · SW3 ge-0/0/51 allowed ${allowedText(s, "SW3", "ge-0/0/51")} · VLAN 10 members on SW2: ${vlanMembers(s, "SW2", USER_VLAN).join(", ")}` }, action: "ALLOWED LISTS", reason: "Check membership on BOTH ends of every trunk along the path — a VLAN must be allowed on each side.", key: "show interfaces trunk (both ends)", result: `SW2 ${allowedText(s, "SW2", "ge-0/0/51")} vs SW3 ${allowedText(s, "SW3", "ge-0/0/51")}` }), "inc-vlan-table", [{ kind: "observation", text: `SW2 ge-0/0/51 allowed ${allowedText(s, "SW2", "ge-0/0/51")}; SW3 ge-0/0/51 allowed ${allowedText(s, "SW3", "ge-0/0/51")}`, source: "trunk config, both ends", rung: "Ethernet / VLAN" }, { kind: "hypothesis", text: "VLAN 10 missing from SW2 ge-0/0/51's allowed list" }]), events: [ev("STEP_ENTERED", "inc-vlan-table", "vlan")] }),
  },
  {
    id: "q-where-check",
    label: "Question: where to check membership",
    narrative: "SW2's side omits VLAN 10; SW3's side includes it.",
    question: {
      prompt: "Where should VLAN membership be checked?",
      options: [
        { id: "both", label: "On every port along the path — both ends of each trunk, plus the access ports" },
        { id: "access", label: "Only on the hosts' access ports" },
        { id: "root", label: "Only on the spanning-tree root" },
        { id: "one", label: "On one end of each trunk; the other end follows automatically" },
      ],
      correctOptionId: "both",
      explanation: "Allowed lists are configured independently on each side. A VLAN must be permitted on every port it crosses.",
    },
  },
  {
    id: "q-isolate",
    label: "Question: isolating the trunk",
    narrative: "You have MAC tables, pipelines, RSTP state, allowed lists and a VLAN 20 test.",
    question: {
      prompt: "Which evidence isolates the failing trunk?",
      options: [
        { id: "combo", label: "SW2 drops VLAN 10 at ge-0/0/51's egress check, SW2 ge-0/0/51 omits VLAN 10 while SW3's side has it, and VLAN 20 crosses fine" },
        { id: "ping", label: "The failed ping alone" },
        { id: "arp", label: "HOST-A's ARP cache" },
        { id: "stp", label: "The fact that the topology has a loop" },
      ],
      correctOptionId: "combo",
      explanation: "The ping shows the symptom. The switch's own drop reason, the allowed lists on both ends, and a working VLAN on the same trunk pin it to one port's VLAN membership.",
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
    narrative: "Combine the evidence.",
    question: {
      prompt: "What is the root cause?",
      options: [
        { id: "allowed", label: "VLAN 10 is missing from SW2 ge-0/0/51's trunk allowed list" },
        { id: "stp", label: "RSTP is blocking the SW2 ↔ SW3 trunk" },
        { id: "native", label: "Native VLAN mismatch on the SW2 ↔ SW3 trunk" },
        { id: "host", label: "HOST-B is down" },
      ],
      correctOptionId: "allowed",
      explanation: "Both native VLANs are 1 (they match), RSTP forwards on that trunk, and HOST-B is learned on SW3. SW2's own pipeline names the reason: VLAN 10 not permitted on ge-0/0/51.",
    },
    run: (s) => ({ state: withNotes(idle(s), "predict-cause", [{ kind: "root-cause", text: "VLAN 10 missing from the allowed list on SW2 ge-0/0/51 (SW2 ↔ SW3 trunk)", source: "SW2 pipeline + trunk config" }]), events: [] }),
  },
  // ---- Repair ---
  {
    id: "repair-challenge",
    label: "Repair the trunk",
    narrative: "Choose the change that fixes the cause you identified.",
    action: (s, payload) => ({ state: applyL2Repair(s, (payload as { choice: string }).choice), events: [ev("STEP_ENTERED", "repair-challenge", `Repair attempt: ${(payload as { choice: string }).choice}`)] }),
    requiresState: (s) => s.repaired,
  },
  // ---- Verify ---
  {
    id: "ver-arp",
    label: "Verify: VLAN 10 crosses SW2 → SW3",
    narrative: "HOST-A's ARP request (its cache expired meanwhile) is flooded again. At SW2, ge-0/0/51 is now in VLAN 10: the frame leaves tagged VID 10 toward SW3. RSTP was not touched.",
    run: (s) => {
      const f = F.arpReq();
      let n = tick(idle(s), 5);
      n = carry(n, "HOST-A", f).state;
      n = switchStep(n, "ver-arp", "SW2", "SW1", f, "out").state;
      return { state: n, events: [ev("PACKET_SENT", "ver-arp", "ARP")] };
    },
    packet: pkt,
  },
  {
    id: "ver-sw3",
    label: "Verify: SW3 delivers, learns HOST-A",
    narrative: "SW3 accepts VID 10 on ge-0/0/51, learns HOST-A again, and delivers the request untagged to HOST-B.",
    run: (s) => {
      const f = F.arpReq();
      const { state } = switchStep(s, "ver-sw3", "SW3", "SW2", f, "out");
      return { state: { ...hostRx(state, "ver-sw3", "HOST-B", f, "reply", "HOST-B answers."), packet: l2Packet("ver-sw3-pkt", f, "SW3", "HOST-B", false) }, events: [ev("PACKET_SENT", "ver-sw3", "delivered")] };
    },
    packet: pkt,
  },
  {
    id: "ver-reply",
    label: "Verify: reply accepted by SW2",
    narrative: "HOST-B's reply reaches SW2 on ge-0/0/51 tagged VID 10 — now allowed — so SW2 learns HOST-B and forwards it to SW1 and HOST-A.",
    run: (s) => {
      const f = F.arpRep();
      let n = hostTx(s, "ver-reply", "HOST-B", f, "ARP REPLY", "Unicast back to HOST-A.");
      n = switchStep(n, "ver-reply", "SW3", "HOST-B", f, "out").state;
      n = switchStep(n, "ver-reply", "SW2", "SW3", f, "in").state;
      n = carry({ ...n }, "HOST-B", F.reply(0)).state;
      return { state: { ...n, packet: l2Packet("ver-reply-pkt", f, "SW3", "SW2", true), arpA: { [L2_IP["HOST-B"]]: L2_MAC["HOST-B"] } }, events: [ev("PACKET_SENT", "ver-reply", "reply")] };
    },
    packet: pkt,
  },
  {
    id: "ver-summary",
    label: "Verify: MAC tables and ping",
    narrative: "MAC tables converge back to the baseline picture: all three switches know both hosts in VLAN 10. HOST-A → HOST-B: 5/5. RSTP roles unchanged throughout.",
    run: (s) => {
      let n = tick(idle(s), 2);
      for (let q = 31; q <= 35; q++) {
        n = carry(n, "HOST-A", F.echo(q)).state;
        n = carry(n, "HOST-B", F.reply(q)).state;
      }
      return { state: withNotes(evidence(ping(n, "after repair", USER_VLAN, 5, 5), "ver-summary", "SW2", { active: "learn", details: { learn: L2_SWITCHES.map((sw) => `${sw}: ${fdbText(n, sw, USER_VLAN)}`).join(" | ") }, action: "VERIFY", reason: "The same tests that showed the fault: MAC tables symmetric again, and the end-to-end ping succeeds.", key: "MAC tables + ping", result: "both hosts everywhere · 5/5" }), "ver-summary", [{ kind: "verified", text: `VLAN 10 MAC tables symmetric (${L2_SWITCHES.map((sw) => `${sw}: ${fdbText(n, sw, USER_VLAN)}`).join(" | ")}); HOST-A → HOST-B 5/5; RSTP unchanged`, source: "MAC tables + ping" }]), events: [ev("STEP_ENTERED", "ver-summary", "verify")] };
    },
    question: {
      prompt: "What proves the fix?",
      options: [
        { id: "e2e", label: "VLAN 10 frames now cross SW2 ge-0/0/51, MAC tables are symmetric again, and HOST-A ↔ HOST-B succeeds — with RSTP unchanged" },
        { id: "config", label: "The allowed list now shows 10" },
        { id: "link", label: "The trunk is up" },
        { id: "vlan20", label: "VLAN 20 still works" },
      ],
      correctOptionId: "e2e",
      explanation: "The configuration line is the change; the proof is the service working again under the same test, with the rest of the network (RSTP, VLAN 20) undisturbed.",
    },
  },
  // ---- Complete ---
  {
    id: "operations",
    label: "On real switches",
    narrative: "Juniper-style: show vlans, show ethernet-switching table vlan-id 10, show interfaces ge-0/0/51 (family ethernet-switching: interface-mode trunk, vlan members), show spanning-tree interface. Cisco-style: show vlan brief, show interfaces trunk (compare 'allowed' and 'allowed and active' on both ends), show mac address-table vlan 10, show spanning-tree vlan 10.",
  },
  {
    id: "complete",
    label: "Lesson complete",
    narrative: "Access vs trunk, the 802.1Q tag, per-VLAN membership, MAC learning and aging, RSTP roles — and a VLAN missing from one side of one trunk, found from the switch's own drop reason and fixed without touching spanning tree.",
  },
];
