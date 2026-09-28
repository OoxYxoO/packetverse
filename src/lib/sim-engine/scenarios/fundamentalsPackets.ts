import type { PacketLayer, PacketVisual } from "../types";
import type { PacketStackFrame } from "@/components/network3d/types";

/**
 * Byte-accurate packet builders for the Fundamentals lessons that carry real L3/L4 payloads (Subnetting Design Lab,
 * ICMP & Network Diagnostics, DHCP + DNS). Every displayed length and checksum is computed from the bytes the
 * fields describe — RFC 791 (IPv4), RFC 792/1191 (ICMP), RFC 768 (UDP), RFC 2131 (DHCP), RFC 1035 (DNS) — so a
 * bubble never shows an invented value. Only fields that really exist in each header are displayed.
 */

export const ipToBytes = (ip: string) => ip.split(".").map(Number);
export const ipToNum = (ip: string) => ip.split(".").reduce((a, o) => a * 256 + Number(o), 0);
export const numToIp = (n: number) => [24, 16, 8, 0].map((s) => Math.floor(n / 2 ** s) % 256).join(".");
export const hex4 = (n: number) => `0x${n.toString(16).toUpperCase().padStart(4, "0")}`;
export const hex8 = (n: number) => `0x${n.toString(16).toUpperCase().padStart(8, "0")}`;
const u16 = (n: number) => [(n >> 8) & 0xff, n & 0xff];

/** RFC 1071 Internet checksum over a byte array. */
export function internetChecksum(bytes: number[]): number {
  let sum = 0;
  for (let i = 0; i < bytes.length; i += 2) sum += (bytes[i] << 8) + (bytes[i + 1] ?? 0);
  while (sum > 0xffff) sum = (sum & 0xffff) + Math.floor(sum / 65536);
  return ~sum & 0xffff;
}

// ---------------------------------------------------------------------------------------------------------------
// IPv4
// ---------------------------------------------------------------------------------------------------------------
export const IPPROTO = { ICMP: 1, UDP: 17 } as const;
export interface Ipv4Fields {
  src: string;
  dst: string;
  ttl: number;
  protocol: number;
  /** Bytes after the 20-byte header. */
  payloadLength: number;
  id: number;
  df: boolean;
}
export const ipv4TotalLength = (f: Ipv4Fields) => 20 + f.payloadLength;

/** The 20-byte header (no options) with its real checksum filled in. */
export function ipv4HeaderBytes(f: Ipv4Fields): number[] {
  const b = [0x45, 0x00, ...u16(ipv4TotalLength(f)), ...u16(f.id), f.df ? 0x40 : 0x00, 0x00, f.ttl, f.protocol, 0, 0, ...ipToBytes(f.src), ...ipToBytes(f.dst)];
  const c = internetChecksum(b);
  b[10] = c >> 8;
  b[11] = c & 0xff;
  return b;
}
export const ipv4Checksum = (f: Ipv4Fields) => {
  const b = ipv4HeaderBytes(f);
  return (b[10] << 8) | b[11];
};

export function ipv4Layer(f: Ipv4Fields): PacketLayer {
  const proto = f.protocol === 1 ? "1 (ICMP)" : f.protocol === 17 ? "17 (UDP)" : String(f.protocol);
  return {
    name: "IPv4 Header",
    color: "#60a5fa",
    fields: [
      { label: "Version", value: "4" },
      { label: "IHL", value: "5 (20 bytes)" },
      { label: "Total Length", value: String(ipv4TotalLength(f)) },
      { label: "Identification", value: hex4(f.id) },
      { label: "Flags", value: f.df ? "DF (Don't Fragment)" : "none" },
      { label: "TTL", value: String(f.ttl) },
      { label: "Protocol", value: proto },
      { label: "Header Checksum", value: hex4(ipv4Checksum(f)) },
      { label: "Source", value: f.src },
      { label: "Destination", value: f.dst },
    ],
  };
}

export function ethLayer(src: string, dst: string, etherType: "0x0800" | "0x0806" = "0x0800"): PacketLayer {
  return { name: "Ethernet II Header", color: "#94a3b8", fields: [{ label: "Destination MAC", value: dst }, { label: "Source MAC", value: src }, { label: "EtherType", value: etherType === "0x0800" ? "0x0800 (IPv4)" : "0x0806 (ARP)" }] };
}
const FCS_LAYER: PacketLayer = { name: "FCS", color: "#94a3b8", fields: [{ label: "Frame Check Sequence", value: "CRC-32 over the frame" }] };

// ---------------------------------------------------------------------------------------------------------------
// ICMP (RFC 792, RFC 1191)
// ---------------------------------------------------------------------------------------------------------------
/** Deterministic Echo data: byte i = i mod 256 (a common ping fill pattern). */
export const echoData = (len: number) => Array.from({ length: len }, (_, i) => i & 0xff);

export interface IcmpEcho {
  kind: "echo-request" | "echo-reply";
  identifier: number;
  sequence: number;
  dataLength: number;
}
export interface IcmpError {
  kind: "time-exceeded" | "frag-needed";
  /** The original datagram's IPv4 header, quoted with the first 8 bytes of its payload. */
  quoted: Ipv4Fields;
  quotedEcho: IcmpEcho;
  /** Type 3 Code 4 only — RFC 1191 Next-Hop MTU. */
  nextHopMtu?: number;
}
export type IcmpMessage = IcmpEcho | IcmpError;
export const isEcho = (m: IcmpMessage): m is IcmpEcho => m.kind === "echo-request" || m.kind === "echo-reply";

export const icmpTypeCode = (m: IcmpMessage): { type: number; code: number; name: string } =>
  m.kind === "echo-request" ? { type: 8, code: 0, name: "Echo Request" } : m.kind === "echo-reply" ? { type: 0, code: 0, name: "Echo Reply" } : m.kind === "time-exceeded" ? { type: 11, code: 0, name: "Time Exceeded (TTL exceeded in transit)" } : { type: 3, code: 4, name: "Destination Unreachable (Fragmentation Needed and DF set)" };

function echoHeaderBytes(m: IcmpEcho, checksum = 0) {
  const t = icmpTypeCode(m);
  return [t.type, t.code, ...u16(checksum), ...u16(m.identifier), ...u16(m.sequence)];
}
export function icmpBytes(m: IcmpMessage): number[] {
  const t = icmpTypeCode(m);
  let b: number[];
  if (isEcho(m)) b = [...echoHeaderBytes(m), ...echoData(m.dataLength)];
  else {
    const echo = echoHeaderBytes(m.quotedEcho, icmpChecksum(m.quotedEcho));
    const rest = m.kind === "frag-needed" ? [0, 0, ...u16(m.nextHopMtu ?? 0)] : [0, 0, 0, 0];
    b = [t.type, t.code, 0, 0, ...rest, ...ipv4HeaderBytes(m.quoted), ...echo];
  }
  const c = internetChecksum(b);
  b[2] = c >> 8;
  b[3] = c & 0xff;
  return b;
}
export const icmpChecksum = (m: IcmpMessage) => {
  const b = icmpBytes(m);
  return (b[2] << 8) | b[3];
};
export const icmpLength = (m: IcmpMessage) => icmpBytes(m).length;

export function icmpLayer(m: IcmpMessage): PacketLayer {
  const t = icmpTypeCode(m);
  const base = [
    { label: "Type", value: `${t.type} (${t.name.split(" (")[0]})` },
    { label: "Code", value: `${t.code}${m.kind === "time-exceeded" ? " (TTL exceeded in transit)" : m.kind === "frag-needed" ? " (Fragmentation Needed, DF set)" : ""}` },
    { label: "Checksum", value: hex4(icmpChecksum(m)) },
  ];
  if (isEcho(m)) {
    return { name: "ICMP Message", color: "#f472b6", fields: [...base, { label: "Identifier", value: `${m.identifier} (${hex4(m.identifier)})` }, { label: "Sequence Number", value: String(m.sequence) }, { label: "Data", value: `${m.dataLength} bytes` }] };
  }
  return {
    name: "ICMP Message",
    color: "#f472b6",
    fields: [
      ...base,
      ...(m.kind === "frag-needed" ? [{ label: "Next-Hop MTU", value: String(m.nextHopMtu) }] : [{ label: "Unused", value: "0" }]),
      { label: "Quoted IPv4 Header", value: `${m.quoted.src} → ${m.quoted.dst} · Total Length ${ipv4TotalLength(m.quoted)}${m.quoted.df ? " · DF" : ""}` },
      { label: "Quoted First 8 Bytes", value: `ICMP ${icmpTypeCode(m.quotedEcho).name} · id ${m.quotedEcho.identifier} · seq ${m.quotedEcho.sequence}` },
    ],
  };
}

export function icmpPacket(o: { id: string; from: string; to: string; ethSrc: string; ethDst: string; ip: Omit<Ipv4Fields, "protocol" | "payloadLength">; icmp: IcmpMessage }): PacketVisual {
  const ip: Ipv4Fields = { ...o.ip, protocol: IPPROTO.ICMP, payloadLength: icmpLength(o.icmp) };
  const t = icmpTypeCode(o.icmp);
  return {
    id: o.id,
    protocol: "IP",
    from: o.from,
    to: o.to,
    badge: "ICMP",
    summary: `ICMP ${t.name} — ${ip.src} → ${ip.dst}`,
    layers: [ethLayer(o.ethSrc, o.ethDst), ipv4Layer(ip), icmpLayer(o.icmp), FCS_LAYER],
  };
}

// ---------------------------------------------------------------------------------------------------------------
// UDP / DHCP (RFC 768, RFC 2131, RFC 2132)
// ---------------------------------------------------------------------------------------------------------------
export function udpLayer(srcPort: number, dstPort: number, payloadLength: number): PacketLayer {
  return { name: "UDP Header", color: "#34d399", fields: [{ label: "Source Port", value: String(srcPort) }, { label: "Destination Port", value: String(dstPort) }, { label: "Length", value: String(8 + payloadLength) }] };
}

export type DhcpMessageType = "DHCPDISCOVER" | "DHCPOFFER" | "DHCPREQUEST" | "DHCPACK";
const DHCP_TYPE_CODE: Record<DhcpMessageType, number> = { DHCPDISCOVER: 1, DHCPOFFER: 2, DHCPREQUEST: 3, DHCPACK: 5 };
export interface DhcpOption {
  code: number;
  name: string;
  value: string;
  /** Encoded data length in bytes (without code/length octets). */
  len: number;
}
export interface DhcpMessage {
  type: DhcpMessageType;
  op: 1 | 2;
  xid: number;
  hops: number;
  broadcastFlag: boolean;
  ciaddr: string;
  yiaddr: string;
  giaddr: string;
  chaddr: string;
  options: DhcpOption[];
}
/** 236-byte fixed BOOTP header + 4-byte magic cookie + options + End (255); no padding in this model. */
export const dhcpLength = (m: DhcpMessage) => 240 + m.options.reduce((a, o) => a + 2 + o.len, 0) + 1;
export const opt = {
  type: (t: DhcpMessageType): DhcpOption => ({ code: 53, name: "DHCP Message Type", value: `${DHCP_TYPE_CODE[t]} (${t})`, len: 1 }),
  requestedIp: (ip: string): DhcpOption => ({ code: 50, name: "Requested IP Address", value: ip, len: 4 }),
  serverId: (ip: string): DhcpOption => ({ code: 54, name: "Server Identifier", value: ip, len: 4 }),
  mask: (m: string): DhcpOption => ({ code: 1, name: "Subnet Mask", value: m, len: 4 }),
  router: (ip: string): DhcpOption => ({ code: 3, name: "Router", value: ip, len: 4 }),
  dns: (ip: string): DhcpOption => ({ code: 6, name: "Domain Name Server", value: ip, len: 4 }),
  lease: (sec: number): DhcpOption => ({ code: 51, name: "IP Address Lease Time", value: `${sec} s`, len: 4 }),
};

export function dhcpLayer(m: DhcpMessage): PacketLayer {
  return {
    name: `DHCP (BOOTP) — ${m.type}`,
    color: "#f59e0b",
    fields: [
      { label: "op", value: m.op === 1 ? "1 (BOOTREQUEST)" : "2 (BOOTREPLY)" },
      { label: "hops", value: String(m.hops) },
      { label: "xid", value: hex8(m.xid) },
      { label: "flags", value: m.broadcastFlag ? "0x8000 (Broadcast)" : "0x0000" },
      { label: "ciaddr", value: m.ciaddr },
      { label: "yiaddr", value: m.yiaddr },
      { label: "giaddr", value: m.giaddr },
      { label: "chaddr", value: m.chaddr },
      ...m.options.map((o) => ({ label: `Option ${o.code} — ${o.name}`, value: o.value })),
    ],
  };
}

export function dhcpPacket(o: { id: string; from: string; to: string; ethSrc: string; ethDst: string; ip: Omit<Ipv4Fields, "protocol" | "payloadLength">; srcPort: number; dstPort: number; dhcp: DhcpMessage }): PacketVisual {
  const len = dhcpLength(o.dhcp);
  const ip: Ipv4Fields = { ...o.ip, protocol: IPPROTO.UDP, payloadLength: 8 + len };
  return {
    id: o.id,
    protocol: "IP",
    from: o.from,
    to: o.to,
    broadcast: o.ethDst === "FF:FF:FF:FF:FF:FF",
    badge: "DHCP",
    summary: `${o.dhcp.type} — xid ${hex8(o.dhcp.xid)} — ${ip.src} → ${ip.dst}`,
    layers: [ethLayer(o.ethSrc, o.ethDst), ipv4Layer(ip), udpLayer(o.srcPort, o.dstPort, len), dhcpLayer(o.dhcp), FCS_LAYER],
  };
}

// ---------------------------------------------------------------------------------------------------------------
// DNS (RFC 1035)
// ---------------------------------------------------------------------------------------------------------------
export interface DnsMessage {
  id: number;
  response: boolean;
  rd: boolean;
  ra: boolean;
  qname: string;
  answer?: { address: string; ttl: number };
}
/** Header 12 + QNAME labels + QTYPE/QCLASS 4 (+ answer: compression pointer 2 + type/class 4 + TTL 4 + RDLENGTH 2 + RDATA 4). */
export const dnsLength = (m: DnsMessage) => 12 + m.qname.split(".").reduce((a, l) => a + 1 + l.length, 1) + 4 + (m.answer ? 16 : 0);

export function dnsLayer(m: DnsMessage): PacketLayer {
  return {
    name: `DNS ${m.response ? "Response" : "Query"}`,
    color: "#a78bfa",
    fields: [
      { label: "Transaction ID", value: hex4(m.id) },
      { label: "QR", value: m.response ? "1 (Response)" : "0 (Query)" },
      { label: "Opcode", value: "0 (Standard query)" },
      { label: "RD", value: m.rd ? "1 (Recursion desired)" : "0" },
      ...(m.response ? [{ label: "RA", value: m.ra ? "1 (Recursion available)" : "0" }, { label: "RCODE", value: "0 (No error)" }] : []),
      { label: "QDCOUNT", value: "1" },
      { label: "ANCOUNT", value: m.answer ? "1" : "0" },
      { label: "Question", value: `${m.qname} · QTYPE A · QCLASS IN` },
      ...(m.answer ? [{ label: "Answer", value: `${m.qname} · A · IN · TTL ${m.answer.ttl} s · ${m.answer.address}` }] : []),
    ],
  };
}

export function dnsPacket(o: { id: string; from: string; to: string; ethSrc: string; ethDst: string; ip: Omit<Ipv4Fields, "protocol" | "payloadLength">; srcPort: number; dstPort: number; dns: DnsMessage }): PacketVisual {
  const len = dnsLength(o.dns);
  const ip: Ipv4Fields = { ...o.ip, protocol: IPPROTO.UDP, payloadLength: 8 + len };
  return {
    id: o.id,
    protocol: "IP",
    from: o.from,
    to: o.to,
    badge: "DNS",
    summary: `DNS ${o.dns.response ? "response" : "query"} ${hex4(o.dns.id)} — ${o.dns.qname} A`,
    layers: [ethLayer(o.ethSrc, o.ethDst), ipv4Layer(ip), udpLayer(o.srcPort, o.dstPort, len), dnsLayer(o.dns), FCS_LAYER],
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Reading packets back (for traces, callouts, re-forwarding)
// ---------------------------------------------------------------------------------------------------------------
export const layerOf = (p: PacketVisual, re: RegExp) => p.layers.find((l) => re.test(l.name));
export const fieldOf = (p: PacketVisual, layerRe: RegExp, label: string) => layerOf(p, layerRe)?.fields.find((f) => f.label === label)?.value ?? "";

/** Frame stack for device traces, from the packet's own layers. */
export function packetStack(p: PacketVisual, changed: string[] = []): PacketStackFrame[] {
  const out: PacketStackFrame[] = [{ id: "eth", text: `Ethernet · dst ${fieldOf(p, /^Ethernet/, "Destination MAC")} · src ${fieldOf(p, /^Ethernet/, "Source MAC")}`, tone: "generic", justChanged: changed.includes("eth") }];
  if (layerOf(p, /^IPv4/)) out.push({ id: "ip", text: `IPv4 · ${fieldOf(p, /^IPv4/, "Source")} → ${fieldOf(p, /^IPv4/, "Destination")} · TTL ${fieldOf(p, /^IPv4/, "TTL")} · len ${fieldOf(p, /^IPv4/, "Total Length")}`, tone: "ip", justChanged: changed.includes("ip") });
  const icmp = layerOf(p, /^ICMP/);
  if (icmp) out.push({ id: "icmp", text: `ICMP · type ${fieldOf(p, /^ICMP/, "Type")} · code ${fieldOf(p, /^ICMP/, "Code")}`, tone: "vpn" });
  if (layerOf(p, /^UDP/)) out.push({ id: "udp", text: `UDP · ${fieldOf(p, /^UDP/, "Source Port")} → ${fieldOf(p, /^UDP/, "Destination Port")}`, tone: "transport" });
  const dhcp = layerOf(p, /^DHCP/);
  if (dhcp) out.push({ id: "dhcp", text: `${dhcp.name.replace("DHCP (BOOTP) — ", "")} · xid ${fieldOf(p, /^DHCP/, "xid")} · giaddr ${fieldOf(p, /^DHCP/, "giaddr")}`, tone: "vpn" });
  const dns = layerOf(p, /^DNS/);
  if (dns) out.push({ id: "dns", text: `${dns.name} · id ${fieldOf(p, /^DNS/, "Transaction ID")}`, tone: "vpn" });
  return out;
}
