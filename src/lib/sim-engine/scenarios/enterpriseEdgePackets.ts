import type { PacketLayer, PacketVisual } from "../types";
import type { PacketStackFrame } from "@/components/network3d/types";
import { ethLayer, hex4, internetChecksum, ipToBytes, ipToNum } from "./fundamentalsPackets";

/**
 * Byte-accurate IPv4 helpers for the Enterprise edge lessons (Stateful Firewall, IPsec Site-to-Site VPN, SD-WAN).
 * Same rules as the Fundamentals builders (RFC 791 header, RFC 1071 checksum computed from the displayed fields),
 * plus the two things those lessons need that the Fundamentals builder does not carry: the DSCP byte (SD-WAN voice is
 * marked EF) and protocol names for TCP (6) and ESP (50). Every length and checksum shown is computed, never typed in.
 */

export const u16 = (n: number) => [(n >> 8) & 0xff, n & 0xff];
export const u32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
export const PROTO_NAME: Record<number, string> = { 1: "ICMP", 6: "TCP", 17: "UDP", 50: "ESP" };
export const DSCP_NAME: Record<number, string> = { 0: "CS0 (default)", 46: "EF (Expedited Forwarding)" };

export interface Ip4 {
  src: string;
  dst: string;
  ttl: number;
  protocol: number;
  /** Bytes after the 20-byte header. */
  payloadLength: number;
  id: number;
  df: boolean;
  dscp?: number;
}
export const ip4Length = (f: Ip4) => 20 + f.payloadLength;

/** The 20-byte header (no options) with its real checksum filled in. */
export function ip4HeaderBytes(f: Ip4): number[] {
  const b = [0x45, ((f.dscp ?? 0) << 2) & 0xff, ...u16(ip4Length(f)), ...u16(f.id), f.df ? 0x40 : 0x00, 0x00, f.ttl, f.protocol, 0, 0, ...ipToBytes(f.src), ...ipToBytes(f.dst)];
  const c = internetChecksum(b);
  b[10] = c >> 8;
  b[11] = c & 0xff;
  return b;
}
export const ip4Checksum = (f: Ip4) => {
  const b = ip4HeaderBytes(f);
  return (b[10] << 8) | b[11];
};

export function ip4Layer(f: Ip4, name = "IPv4 Header"): PacketLayer {
  const dscp = f.dscp ?? 0;
  return {
    name,
    color: "#60a5fa",
    fields: [
      { label: "Version", value: "4" },
      { label: "IHL", value: "5 (20 bytes)" },
      { label: "DSCP", value: `${dscp} — ${DSCP_NAME[dscp] ?? "custom"}` },
      { label: "Total Length", value: String(ip4Length(f)) },
      { label: "Identification", value: hex4(f.id) },
      { label: "Flags", value: f.df ? "DF (Don't Fragment)" : "none" },
      { label: "TTL", value: String(f.ttl) },
      { label: "Protocol", value: `${f.protocol} (${PROTO_NAME[f.protocol] ?? "other"})` },
      { label: "Header Checksum", value: hex4(ip4Checksum(f)) },
      { label: "Source", value: f.src },
      { label: "Destination", value: f.dst },
    ],
  };
}

export const FCS_LAYER: PacketLayer = { name: "FCS", color: "#94a3b8", fields: [{ label: "Frame Check Sequence", value: "CRC-32 over the frame" }] };

/** 4-byte-aligned plain prefix test (prefix length 0 matches everything). */
export const inPrefix = (ip: string, prefix: string, len: number) => len === 0 || Math.floor(ipToNum(ip) / 2 ** (32 - len)) === Math.floor(ipToNum(prefix) / 2 ** (32 - len));

/** Layer / field readers keyed by the layer-name prefix. */
export const layerNamed = (p: PacketVisual, re: RegExp) => p.layers.find((l) => re.test(l.name));
export const fieldIn = (p: PacketVisual, layerRe: RegExp, label: string) => layerNamed(p, layerRe)?.fields.find((f) => f.label === label)?.value ?? "";

/** IPv4 line for a device-trace frame stack. */
export const ip4Frame = (p: PacketVisual, layerRe = /^IPv4 Header$/, changed = false, prefix = "IPv4"): PacketStackFrame => ({
  id: `ip-${prefix}`,
  text: `${prefix} · ${fieldIn(p, layerRe, "Source")} → ${fieldIn(p, layerRe, "Destination")} · TTL ${fieldIn(p, layerRe, "TTL")} · proto ${fieldIn(p, layerRe, "Protocol").split(" ")[0]} · csum ${fieldIn(p, layerRe, "Header Checksum")}`,
  tone: "ip",
  justChanged: changed,
});

// ---------------------------------------------------------------------------------------------------------------
// TCP (RFC 9293 header; checksum over the pseudo-header {src, dst, 0, 6, TCP length} per RFC 1071). Protocol only —
// no product, policy, session or NAT semantics live here.
// ---------------------------------------------------------------------------------------------------------------
export type TcpFlag = "SYN" | "ACK" | "PSH" | "FIN";
export interface TcpSeg {
  sport: number;
  dport: number;
  seq: number;
  ack: number;
  flags: TcpFlag[];
  /** MSS option (SYN / SYN-ACK only). */
  mss?: number;
  /** Payload bytes carried after the header (0 for a pure handshake segment). */
  payloadLength?: number;
}
export const TCP_WINDOW = 64240;
const TCP_FLAG_BITS: Record<TcpFlag, number> = { FIN: 0x01, PSH: 0x08, SYN: 0x02, ACK: 0x10 };
/** Header length only (20 bytes, +4 for the MSS option). */
export const tcpHeaderLength = (seg: TcpSeg) => 20 + (seg.mss ? 4 : 0);
/** Header + payload — the "TCP length" of the pseudo-header and the IPv4 payload length. */
export const tcpLength = (seg: TcpSeg) => tcpHeaderLength(seg) + (seg.payloadLength ?? 0);
export const tcpFlagByte = (seg: TcpSeg) => seg.flags.reduce((a, f) => a | TCP_FLAG_BITS[f], 0);
export const flagsName = (seg: TcpSeg) => (seg.flags.includes("SYN") && seg.flags.includes("ACK") ? "SYN-ACK" : seg.flags.includes("SYN") ? "SYN" : seg.flags.includes("FIN") ? (seg.flags.includes("ACK") ? "FIN-ACK" : "FIN") : seg.flags.includes("PSH") ? "PSH-ACK" : "ACK");
/** Deterministic payload bytes (i mod 256) so checksums over data segments are reproducible. */
export const tcpPayload = (len: number) => Array.from({ length: len }, (_, i) => i & 0xff);
function tcpBytes(seg: TcpSeg, checksum: number): number[] {
  return [...u16(seg.sport), ...u16(seg.dport), ...u32(seg.seq), ...u32(seg.ack), (tcpHeaderLength(seg) / 4) << 4, tcpFlagByte(seg), ...u16(TCP_WINDOW), ...u16(checksum), 0, 0, ...(seg.mss ? [2, 4, ...u16(seg.mss)] : []), ...tcpPayload(seg.payloadLength ?? 0)];
}
export function tcpChecksum(seg: TcpSeg, src: string, dst: string): number {
  return internetChecksum([...ipToBytes(src), ...ipToBytes(dst), 0, 6, ...u16(tcpLength(seg)), ...tcpBytes(seg, 0)]);
}
/** One TCP segment on the wire: the IPv4 fields plus the segment. */
export interface TcpWire {
  src: string;
  dst: string;
  ttl: number;
  ipId: number;
  seg: TcpSeg;
  dscp?: number;
}
export const tcpIp = (w: TcpWire): Ip4 => ({ src: w.src, dst: w.dst, ttl: w.ttl, protocol: 6, payloadLength: tcpLength(w.seg), id: w.ipId, df: true, ...(w.dscp ? { dscp: w.dscp } : {}) });
export const tupleText = (addr: string, port: number) => `${addr}:${port}`;

export function tcpLayer(w: TcpWire): PacketLayer {
  return {
    name: "TCP Header",
    color: "#34d399",
    fields: [
      { label: "Source Port", value: String(w.seg.sport) },
      { label: "Destination Port", value: String(w.seg.dport) },
      { label: "Sequence Number", value: String(w.seg.seq) },
      { label: "Acknowledgment Number", value: w.seg.flags.includes("ACK") ? String(w.seg.ack) : "0 (ACK flag not set)" },
      { label: "Data Offset", value: `${tcpHeaderLength(w.seg) / 4} (${tcpHeaderLength(w.seg)} bytes)` },
      { label: "Flags", value: `${hex4(tcpFlagByte(w.seg)).replace("0x00", "0x0")} (${w.seg.flags.join(", ")})` },
      { label: "Window", value: String(TCP_WINDOW) },
      { label: "Checksum", value: hex4(tcpChecksum(w.seg, w.src, w.dst)) },
      { label: "Urgent Pointer", value: "0" },
      ...(w.seg.mss ? [{ label: "Options", value: `MSS ${w.seg.mss}` }] : []),
      ...(w.seg.payloadLength ? [{ label: "Payload", value: `${w.seg.payloadLength} bytes` }] : []),
    ],
  };
}

/** Ethernet II + IPv4 + TCP + FCS. `from`/`to` are the topology node ids of the link the frame is on. */
export function tcpPacket(id: string, from: string, to: string, ethSrc: string, ethDst: string, w: TcpWire): PacketVisual {
  const kind = flagsName(w.seg);
  return {
    id,
    protocol: "TCP",
    from,
    to,
    badge: kind,
    summary: `TCP ${kind} — ${tupleText(w.src, w.seg.sport)} → ${tupleText(w.dst, w.seg.dport)}`,
    layers: [ethLayer(ethSrc, ethDst), ip4Layer(tcpIp(w)), tcpLayer(w), FCS_LAYER],
  };
}
export const isTcp = (p: PacketVisual) => p.layers.some((l) => l.name === "TCP Header");
export const tcpField = (p: PacketVisual, label: string) => fieldIn(p, /^TCP Header$/, label);
/** Frame stack (Ethernet · IPv4 · TCP) for device traces. */
export function tcpStack(p: PacketVisual, changed: string[] = []): PacketStackFrame[] {
  return [
    { id: "eth", text: `Ethernet · dst ${fieldIn(p, /^Ethernet/, "Destination MAC")} · src ${fieldIn(p, /^Ethernet/, "Source MAC")}`, tone: "generic", justChanged: changed.includes("eth") },
    ip4Frame(p, /^IPv4 Header$/, changed.includes("ip")),
    { id: "tcp", text: `TCP · ${tcpField(p, "Source Port")} → ${tcpField(p, "Destination Port")} · ${p.badge} · seq ${tcpField(p, "Sequence Number")} · ack ${tcpField(p, "Acknowledgment Number").split(" ")[0]} · csum ${tcpField(p, "Checksum")}`, tone: "transport", justChanged: changed.includes("tcp") },
  ];
}
