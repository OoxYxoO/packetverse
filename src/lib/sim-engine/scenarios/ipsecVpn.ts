import type { PacketLayer, PacketVisual, PVEvent, PVEventType, ScenarioStep } from "../types";
import type { PacketStackFrame, ProcessingStage } from "@/components/network3d/types";
import type { FundHop } from "@/components/lesson/fundamentalsTrace";
import { ethLayer, hex4, hex8, icmpChecksum, icmpLayer, icmpLength, udpLayer, type IcmpEcho } from "./fundamentalsPackets";
import { FCS_LAYER, fieldIn, inPrefix, ip4Checksum, ip4Frame, ip4Layer, ip4Length, type Ip4 } from "./enterpriseEdgePackets";

/**
 * IPsec Site-to-Site VPN: IKEv2, CHILD SAs & ESP — HOST-A — GW-A — INTERNET — GW-B — HOST-B.
 *
 * Standards modeled (RFC 7296 IKEv2, RFC 4301 architecture, RFC 4303 ESP, RFC 4106/5282 AES-GCM):
 * - IKE runs over UDP/500 (no NAT between the gateways, so no NAT-T / UDP-4500 in the main flow).
 * - IKE_SA_INIT (Exchange Type 34, Message ID 0) negotiates the IKE SA's algorithms and performs the Diffie-Hellman
 *   exchange (SA, KE, Nonce payloads, in the clear). It does NOT authenticate the peers.
 * - IKE_AUTH (35, Message ID 1) is protected by the SK payload. Inside: identities, AUTH, and the first CHILD SA
 *   (SA proposal with an SPI, TSi, TSr). The peers are authenticated here. The lesson shows those payloads only as a
 *   labelled "decrypted teaching view" — on the wire they are ciphertext. No secret is ever displayed.
 * - The IKE SA protects IKE messages. A CHILD SA (a pair of one-directional ESP SAs) protects user data. They are
 *   different SAs. Each direction has its own SPI, and the SPI carried in an ESP packet is the one the RECEIVER chose.
 * - ESP (IP protocol 50) in tunnel mode: the whole inner IPv4 packet plus the ESP trailer is encrypted with
 *   AES-GCM-16 (an AEAD cipher: integrity comes from its 16-byte ICV, there is no separate HMAC). The outer IPv4
 *   header carries the gateways' public addresses. Sequence numbers count per SA and feed the receiver's anti-replay
 *   window; they provide no confidentiality.
 * - INFORMATIONAL (37) deletes a CHILD SA; CREATE_CHILD_SA (36) creates a new one under the existing IKE SA.
 * Incident: GW-B's configured Site-A selector becomes 10.10.20.0/24. After the CHILD SA is deleted, GW-A's
 * CREATE_CHILD_SA for 10.10.10.0/24 ↔ 10.20.20.0/24 is refused with Notify TS_UNACCEPTABLE (38). The IKE SA stays up.
 */

export type VpnDevice = "HOST-A" | "GW-A" | "INTERNET" | "GW-B" | "HOST-B";
export type Gw = "GW-A" | "GW-B";
export const VPN_DEVICES: VpnDevice[] = ["HOST-A", "GW-A", "INTERNET", "GW-B", "HOST-B"];
export const VPN = { hostA: "10.10.10.10", gwaLan: "10.10.10.1", gwaPub: "198.51.100.10", gwbPub: "203.0.113.10", gwbLan: "10.20.20.1", hostB: "10.20.20.20", siteA: "10.10.10.0/24", siteB: "10.20.20.0/24", badSiteA: "10.10.20.0/24" } as const;
export const VPN_MAC = { "HOST-A": "00:00:5E:00:53:0A", "GW-A:lan": "00:00:5E:00:53:1A", "GW-A:wan": "00:00:5E:00:53:1B", "INET:a": "00:00:5E:00:53:E1", "INET:b": "00:00:5E:00:53:E2", "GW-B:wan": "00:00:5E:00:53:2B", "GW-B:lan": "00:00:5E:00:53:2A", "HOST-B": "00:00:5E:00:53:0B" } as const;
export const IKE_PORT = 500;
export const INITIAL_TTL = 64;
export const IKE_SPI_I = "0x1A2B3C4D5E6F7081";
export const IKE_SPI_R = "0x9F8E7D6C5B4A3921";
export const ZERO_SPI = "0x0000000000000000";
/** CHILD SA generations. `ab` is carried in GW-A → GW-B packets (GW-B chose it); `ba` in GW-B → GW-A (GW-A chose it). */
export const CHILD_SPIS = { first: { ab: 0xa1b2c3d4, ba: 0xb1c2d3e4 }, failed: { ba: 0xb2c3d4e5 }, repaired: { ab: 0xa3b4c5d6, ba: 0xb3c4d5e6 } } as const;
export const ECHO_ID = 0x1234;
export const EXCHANGE = { IKE_SA_INIT: 34, IKE_AUTH: 35, CREATE_CHILD_SA: 36, INFORMATIONAL: 37 } as const;
export const NOTIFY_TS_UNACCEPTABLE = 38;
export const IKE_PROPOSAL = "ENCR_AES_GCM_16 (256-bit key) · PRF_HMAC_SHA2_256 · DH group 19 (256-bit ECP)";
export const ESP_PROPOSAL = "ESP · ENCR_AES_GCM_16 (256-bit key) · no ESN";
export const spiText = (n: number) => hex8(n);

// ---------------------------------------------------------------------------------------------------------------
// Payload sizes (bytes) — used to compute every IKE / UDP / IPv4 length shown
// ---------------------------------------------------------------------------------------------------------------
const IKE_HDR = 28;
const SA_IKE = 40; // generic 4 + proposal 8 + ENCR(+key length attr) 12 + PRF 8 + DH 8
const KE_19 = 72; // generic 4 + group/reserved 4 + 64-byte P-256 public value
const NONCE = 36; // generic 4 + 32-byte nonce
const ID_V4 = 12; // generic 4 + ID type/reserved 4 + IPv4 address 4
const AUTH_PSK = 40; // generic 4 + method/reserved 4 + 32-byte PRF output
const SA_ESP = 36; // generic 4 + proposal 8 + SPI 4 + ENCR(+key length) 12 + ESN 8
const TS_ONE = 24; // generic 4 + count/reserved 4 + one IPv4 range selector 16
const DELETE_ONE = 12; // generic 4 + protocol/SPI size/count 4 + one 4-byte SPI
const NOTIFY_NO_SPI = 8; // generic 4 + protocol/SPI size/type 4
/** SK: generic 4 + 8-byte IV + inner payloads + Pad Length (no padding needed for GCM) + 16-byte ICV. */
const skLen = (inner: number) => 4 + 8 + inner + 1 + 16;

// ---------------------------------------------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------------------------------------------
export type IkePhase = "NONE" | "IKE_SA_INIT sent" | "keys derived (not authenticated)" | "IKE_AUTH sent" | "ESTABLISHED";
export interface ChildSa {
  gen: "first" | "repaired";
  tsi: string;
  tsr: string;
  ab: number;
  ba: number;
  /** Next ESP sequence number each sender will use, and each receiver's highest accepted (anti-replay). */
  seqAB: number;
  seqBA: number;
  rxAB: number;
  rxBA: number;
}
export type ChildStatus = "NONE" | "NEGOTIATING" | "INSTALLED" | "FAILED — TS_UNACCEPTABLE";
export interface VpnState {
  hops: FundHop[];
  packet?: PacketVisual;
  flood: { id: string; fromId: string; toId: string; packet: PacketVisual }[];
  ike: { phase: IkePhase; spiR?: string; lastExchange?: string; lastMsgId?: number; peersAuthenticated: boolean };
  child?: ChildSa;
  childStatus: ChildStatus;
  /** GW-B's configured selector for the remote Site-A network. */
  gwbRemote: string;
  lastNotify?: string;
  pending?: { spiBA: number; msgId: number };
  pingSeq: number;
  hostA: { sent: number; replies: number; lastResult: string };
  decision?: { device: VpnDevice; text: string };
  faultActive: boolean;
  repairAttempt?: { choice: string; correct: boolean };
  repaired: boolean;
}
export const createVpnState = (): VpnState => ({ hops: [], flood: [], ike: { phase: "NONE", peersAuthenticated: false }, childStatus: "NONE", gwbRemote: VPN.siteA, pingSeq: 0, hostA: { sent: 0, replies: 0, lastResult: "no traffic yet" }, faultActive: false, repaired: false });

/** Does GW-B accept the initiator's selector pair? (Its policy: local Site-B, remote = its configured Site-A.) */
export const cidrWithin = (inner: string, outer: string) => {
  const [ia, il] = inner.split("/");
  const [oa, ol] = outer.split("/");
  return Number(il) >= Number(ol) && inPrefix(ia, oa, Number(ol));
};
export const gwbAccepts = (s: VpnState, tsi: string, tsr: string) => cidrWithin(tsi, s.gwbRemote) && cidrWithin(tsr, VPN.siteB);

// ---------------------------------------------------------------------------------------------------------------
// Packets
// ---------------------------------------------------------------------------------------------------------------
/** Ethernet endpoints for each link, in the direction of travel. */
const ETH: Record<string, [string, string]> = {
  "HOST-A>GW-A": [VPN_MAC["HOST-A"], VPN_MAC["GW-A:lan"]],
  "GW-A>HOST-A": [VPN_MAC["GW-A:lan"], VPN_MAC["HOST-A"]],
  "GW-A>INTERNET": [VPN_MAC["GW-A:wan"], VPN_MAC["INET:a"]],
  "INTERNET>GW-A": [VPN_MAC["INET:a"], VPN_MAC["GW-A:wan"]],
  "GW-B>INTERNET": [VPN_MAC["GW-B:wan"], VPN_MAC["INET:b"]],
  "INTERNET>GW-B": [VPN_MAC["INET:b"], VPN_MAC["GW-B:wan"]],
  "GW-B>HOST-B": [VPN_MAC["GW-B:lan"], VPN_MAC["HOST-B"]],
  "HOST-B>GW-B": [VPN_MAC["HOST-B"], VPN_MAC["GW-B:lan"]],
};

export interface IkeMsg {
  exchange: keyof typeof EXCHANGE;
  msgId: number;
  response: boolean;
  spiR: string;
  /** Cleartext payload layers (IKE_SA_INIT) or the decrypted teaching view (everything else). */
  payloads: PacketLayer[];
  /** Total IKE message length in bytes. */
  length: number;
  /** First payload type after the header. */
  next: string;
  /** For encrypted messages: the SK payload's Next Payload — the first payload inside the ciphertext. */
  firstInner?: string;
}
const EXCH_NAME = (e: keyof typeof EXCHANGE) => `${EXCHANGE[e]} (${e})`;

export function ikePacket(id: string, from: VpnDevice, to: VpnDevice, outer: { src: string; dst: string; ttl: number; ipId: number }, m: IkeMsg): PacketVisual {
  const ip: Ip4 = { src: outer.src, dst: outer.dst, ttl: outer.ttl, protocol: 17, payloadLength: 8 + m.length, id: outer.ipId, df: false };
  const [ethSrc, ethDst] = ETH[`${from}>${to}`];
  const hdr: PacketLayer = {
    name: "IKEv2 Header",
    color: "#a78bfa",
    fields: [
      { label: "Initiator SPI", value: IKE_SPI_I },
      { label: "Responder SPI", value: m.spiR },
      { label: "Next Payload", value: m.next },
      { label: "Version", value: "2.0" },
      { label: "Exchange Type", value: EXCH_NAME(m.exchange) },
      { label: "Flags", value: m.response ? "0x20 (Response)" : "0x08 (Initiator)" },
      { label: "Message ID", value: String(m.msgId) },
      { label: "Length", value: String(m.length) },
    ],
  };
  const encrypted = m.exchange !== "IKE_SA_INIT";
  const innerLen = m.length - IKE_HDR - (encrypted ? 4 + 8 + 1 + 16 : 0);
  const sk: PacketLayer[] = encrypted
    ? [
        {
          name: "SK Payload (Encrypted and Authenticated)",
          color: "#f472b6",
          fields: [
            { label: "Next Payload", value: `${m.firstInner ?? "none"} (first payload inside the ciphertext)` },
            { label: "Initialization Vector", value: "8 bytes" },
            { label: "Encrypted Payloads", value: `${innerLen + 1} bytes of ciphertext (payloads + Pad Length) — unreadable on the wire` },
            { label: "Integrity Checksum Data", value: "16 bytes (AES-GCM ICV)" },
          ],
        },
      ]
    : [];
  return {
    id,
    protocol: "IP",
    from,
    to,
    badge: m.exchange === "IKE_SA_INIT" ? "IKE_SA_INIT" : m.exchange === "IKE_AUTH" ? "IKE_AUTH" : m.exchange === "CREATE_CHILD_SA" ? "CREATE_CHILD" : "INFORMATIONAL",
    summary: `IKEv2 ${m.exchange} ${m.response ? "response" : "request"} — ${outer.src}:500 → ${outer.dst}:500 · Message ID ${m.msgId}`,
    layers: [ethLayer(ethSrc, ethDst), ip4Layer(ip), udpLayer(IKE_PORT, IKE_PORT, m.length), hdr, ...sk, ...m.payloads, FCS_LAYER],
  };
}
export const isIke = (p: PacketVisual) => p.layers.some((l) => l.name === "IKEv2 Header");
export const isEsp = (p: PacketVisual) => p.layers.some((l) => l.name === "ESP Header");
export const TEACH = "decrypted teaching view — contents are inside the encrypted SK payload on the wire";

const saInitPayloads = (resp: boolean): PacketLayer[] => [
  { name: "SA Payload", color: "#22d3ee", fields: [{ label: "Proposal #1", value: `Protocol IKE · ${IKE_PROPOSAL}` }, { label: resp ? "Chosen" : "Offered", value: resp ? "the responder accepts proposal #1" : "one proposal (the initiator may offer several)" }] },
  { name: "KE Payload", color: "#22d3ee", fields: [{ label: "DH Group", value: "19 (256-bit random ECP)" }, { label: "Key Exchange Data", value: `64 bytes — ${resp ? "GW-B" : "GW-A"}'s public Diffie-Hellman value` }] },
  { name: "Nonce Payload", color: "#22d3ee", fields: [{ label: resp ? "Nr" : "Ni", value: "32 random bytes" }] },
];
const tsText = (net: string) => `${net} · all protocols · ports 0–65535`;
const authTeach = (who: Gw, resp: boolean, spi: number, tsi: string, tsr: string): PacketLayer => ({
  name: `IKE_AUTH ${resp ? "response" : "request"} contents — ${TEACH}`,
  color: "#fbbf24",
  fields: [
    { label: resp ? "IDr" : "IDi", value: `ID_IPV4_ADDR ${who === "GW-A" ? VPN.gwaPub : VPN.gwbPub}` },
    { label: "AUTH", value: "Method 2 (Shared Key Message Integrity Code) · 32-byte proof computed from the pre-shared key — the key itself is never sent (value not shown)" },
    { label: "SA (CHILD SA)", value: `${ESP_PROPOSAL} · SPI ${spiText(spi)} (${who}'s inbound SPI)` },
    { label: "TSi", value: tsText(tsi) },
    { label: "TSr", value: tsText(tsr) },
  ],
});

export function saInitMsg(resp: boolean): IkeMsg {
  return { exchange: "IKE_SA_INIT", msgId: 0, response: resp, spiR: resp ? IKE_SPI_R : ZERO_SPI, payloads: saInitPayloads(resp), length: IKE_HDR + SA_IKE + KE_19 + NONCE, next: "33 (SA)" };
}
export function authMsg(resp: boolean, spi: number): IkeMsg {
  return { exchange: "IKE_AUTH", msgId: 1, response: resp, spiR: IKE_SPI_R, payloads: [authTeach(resp ? "GW-B" : "GW-A", resp, spi, VPN.siteA, VPN.siteB)], length: IKE_HDR + skLen(ID_V4 + AUTH_PSK + SA_ESP + TS_ONE + TS_ONE), next: "46 (SK)", firstInner: resp ? "36 (IDr)" : "35 (IDi)" };
}
export function deleteMsg(resp: boolean, spi: number): IkeMsg {
  return {
    exchange: "INFORMATIONAL",
    msgId: 2,
    response: resp,
    spiR: IKE_SPI_R,
    payloads: [{ name: `INFORMATIONAL ${resp ? "response" : "request"} contents — ${TEACH}`, color: "#fbbf24", fields: [{ label: "Delete", value: `Protocol 3 (ESP) · SPI ${spiText(spi)} (${resp ? "GW-B" : "GW-A"}'s inbound SPI of the CHILD SA)` }] }],
    length: IKE_HDR + skLen(DELETE_ONE),
    next: "46 (SK)",
    firstInner: "42 (Delete)",
  };
}
export function createChildMsg(msgId: number, spi: number): IkeMsg {
  return {
    exchange: "CREATE_CHILD_SA",
    msgId,
    response: false,
    spiR: IKE_SPI_R,
    payloads: [{ name: `CREATE_CHILD_SA request contents — ${TEACH}`, color: "#fbbf24", fields: [{ label: "SA", value: `${ESP_PROPOSAL} · SPI ${spiText(spi)} (GW-A's inbound SPI)` }, { label: "Ni", value: "32 new random bytes (fresh keys for this CHILD SA; no KE payload, so no PFS in this lesson)" }, { label: "TSi", value: tsText(VPN.siteA) }, { label: "TSr", value: tsText(VPN.siteB) }] }],
    length: IKE_HDR + skLen(SA_ESP + NONCE + TS_ONE + TS_ONE),
    next: "46 (SK)",
    firstInner: "33 (SA)",
  };
}
export function createChildRespMsg(msgId: number, spi: number): IkeMsg {
  return {
    exchange: "CREATE_CHILD_SA",
    msgId,
    response: true,
    spiR: IKE_SPI_R,
    payloads: [{ name: `CREATE_CHILD_SA response contents — ${TEACH}`, color: "#fbbf24", fields: [{ label: "SA", value: `${ESP_PROPOSAL} · SPI ${spiText(spi)} (GW-B's inbound SPI)` }, { label: "Nr", value: "32 new random bytes" }, { label: "TSi", value: tsText(VPN.siteA) }, { label: "TSr", value: tsText(VPN.siteB) }] }],
    length: IKE_HDR + skLen(SA_ESP + NONCE + TS_ONE + TS_ONE),
    next: "46 (SK)",
    firstInner: "33 (SA)",
  };
}
export function tsUnacceptableMsg(msgId: number): IkeMsg {
  return {
    exchange: "CREATE_CHILD_SA",
    msgId,
    response: true,
    spiR: IKE_SPI_R,
    payloads: [{ name: `CREATE_CHILD_SA response contents — ${TEACH}`, color: "#fb7185", fields: [{ label: "Notify", value: `Type ${NOTIFY_TS_UNACCEPTABLE} (TS_UNACCEPTABLE) · no SPI` }, { label: "Meaning", value: "the responder's policy cannot accept the requested traffic selectors — no CHILD SA is created" }] }],
    length: IKE_HDR + skLen(NOTIFY_NO_SPI),
    next: "46 (SK)",
    firstInner: "41 (Notify)",
  };
}

/** The inner (protected) IPv4 + ICMP Echo packet. */
export interface Inner {
  src: string;
  dst: string;
  ttl: number;
  ipId: number;
  echo: IcmpEcho;
}
export const innerIp = (x: Inner): Ip4 => ({ src: x.src, dst: x.dst, ttl: x.ttl, protocol: 1, payloadLength: icmpLength(x.echo), id: x.ipId, df: false });
export const innerLength = (x: Inner) => ip4Length(innerIp(x));
/** ESP trailer for AES-GCM: pad so plaintext + Pad Length + Next Header is a multiple of 4. */
export const espPad = (x: Inner) => (4 - ((innerLength(x) + 2) % 4)) % 4;
export const espLength = (x: Inner) => 4 + 4 + 8 + innerLength(x) + espPad(x) + 2 + 16;

/** A plain inner packet on a LAN (Ethernet + IPv4 + ICMP). */
export function lanPacket(id: string, from: VpnDevice, to: VpnDevice, x: Inner): PacketVisual {
  const [s, d] = ETH[`${from}>${to}`];
  const kind = x.echo.kind === "echo-request" ? "Echo Request" : "Echo Reply";
  return { id, protocol: "IP", from, to, badge: "ICMP", summary: `ICMP ${kind} — ${x.src} → ${x.dst} · seq ${x.echo.sequence}`, layers: [ethLayer(s, d), ip4Layer(innerIp(x)), icmpLayer(x.echo), FCS_LAYER] };
}

/** An ESP tunnel-mode packet on the Internet side. */
export function espPacket(id: string, from: VpnDevice, to: VpnDevice, outer: { src: string; dst: string; ttl: number; ipId: number }, spi: number, seq: number, x: Inner): PacketVisual {
  const [s, d] = ETH[`${from}>${to}`];
  const ip: Ip4 = { src: outer.src, dst: outer.dst, ttl: outer.ttl, protocol: 50, payloadLength: espLength(x), id: outer.ipId, df: false };
  const t = x.echo.kind === "echo-request" ? "Echo Request" : "Echo Reply";
  return {
    id,
    protocol: "IP",
    from,
    to,
    badge: "ESP",
    summary: `ESP — ${outer.src} → ${outer.dst} · SPI ${spiText(spi)} · seq ${seq}`,
    layers: [
      ethLayer(s, d),
      ip4Layer(ip, "IPv4 Header"),
      { name: "ESP Header", color: "#f472b6", fields: [{ label: "SPI", value: `${spiText(spi)} (chosen by the receiver, ${outer.dst === VPN.gwbPub ? "GW-B" : "GW-A"})` }, { label: "Sequence Number", value: String(seq) }] },
      { name: "ESP Encrypted Data", color: "#f472b6", fields: [{ label: "IV", value: "8 bytes (AES-GCM explicit IV)" }, { label: "Ciphertext", value: `${innerLength(x) + espPad(x) + 2} bytes — inner packet + trailer, unreadable on the wire` }, { label: "ICV", value: "16 bytes (AES-GCM tag — integrity from the AEAD cipher; no separate HMAC)" }] },
      {
        name: `Inner packet — decrypted teaching view (encrypted inside ESP on the wire)`,
        color: "#fbbf24",
        fields: [
          { label: "Inner Source", value: x.src },
          { label: "Inner Destination", value: x.dst },
          { label: "Inner TTL", value: String(x.ttl) },
          { label: "Inner Protocol", value: "1 (ICMP)" },
          { label: "Inner Total Length", value: String(innerLength(x)) },
          { label: "Inner Header Checksum", value: hex4(ip4Checksum(innerIp(x))) },
          { label: "ICMP", value: `${t} · id ${x.echo.identifier} · seq ${x.echo.sequence} · csum ${hex4(icmpChecksum(x.echo))}` },
          { label: "ESP Trailer", value: `Pad Length ${espPad(x)} · Next Header 4 (IPv4 — tunnel mode)` },
        ],
      },
      FCS_LAYER,
    ],
  };
}
export const espSpi = (p: PacketVisual) => fieldIn(p, /^ESP Header$/, "SPI").split(" ")[0];
export const espSeq = (p: PacketVisual) => fieldIn(p, /^ESP Header$/, "Sequence Number");

export function vpnStack(p: PacketVisual, changed: string[] = []): PacketStackFrame[] {
  const out: PacketStackFrame[] = [{ id: "eth", text: `Ethernet · dst ${fieldIn(p, /^Ethernet/, "Destination MAC")} · src ${fieldIn(p, /^Ethernet/, "Source MAC")}`, tone: "generic", justChanged: changed.includes("eth") }];
  out.push(ip4Frame(p, /^IPv4 Header$/, changed.includes("ip"), isEsp(p) || isIke(p) ? "Outer IPv4" : "IPv4"));
  if (isIke(p)) out.push({ id: "ike", text: `UDP 500 · IKEv2 ${fieldIn(p, /^IKEv2/, "Exchange Type")} · MsgID ${fieldIn(p, /^IKEv2/, "Message ID")} · ${fieldIn(p, /^IKEv2/, "Flags")}`, tone: "vpn", justChanged: changed.includes("ike") });
  if (isEsp(p)) {
    out.push({ id: "esp", text: `ESP · SPI ${espSpi(p)} · seq ${espSeq(p)} · encrypted inner packet + ICV`, tone: "vpn", justChanged: changed.includes("esp") });
    out.push({ id: "inner", text: `(encrypted) inner ${fieldIn(p, /^Inner packet/, "Inner Source")} → ${fieldIn(p, /^Inner packet/, "Inner Destination")}`, tone: "transport" });
  }
  if (p.layers.some((l) => l.name === "ICMP Message")) out.push({ id: "icmp", text: `ICMP · type ${fieldIn(p, /^ICMP/, "Type")} · seq ${fieldIn(p, /^ICMP/, "Sequence Number")}`, tone: "transport" });
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Stages and hop helpers
// ---------------------------------------------------------------------------------------------------------------
export const GW_STAGES: ProcessingStage[] = [
  { id: "rx", label: "Receive (LAN plaintext, or IKE / ESP from the peer)" },
  { id: "spd", label: "Protected-traffic check: traffic selectors" },
  { id: "ike", label: "IKE SA: negotiate · authenticate · create CHILD SAs" },
  { id: "sa", label: "CHILD SA lookup: SPI · sequence · anti-replay" },
  { id: "crypto", label: "ESP encrypt / decrypt + ICV (AES-GCM)" },
  { id: "tx", label: "Forward: outer header to the peer, or inner packet to the LAN" },
];
export const INET_STAGES: ProcessingStage[] = [
  { id: "rx", label: "Receive (public IPv4 only — no view inside ESP or SK)" },
  { id: "lookup", label: "Route lookup on the OUTER destination" },
  { id: "ttl", label: "Outer TTL − 1 · recompute outer checksum" },
  { id: "tx", label: "Forward toward the peer gateway" },
];
export const HOST_STAGES: ProcessingStage[] = [
  { id: "app", label: "ping: ICMP Echo Request / Reply" },
  { id: "gw", label: "Off-link destination → default gateway" },
  { id: "tx", label: "Transmit / receive on eth0" },
];
const withDetail = (base: ProcessingStage[], d: Partial<Record<string, string>>): ProcessingStage[] => base.map((x) => (d[x.id] ? { ...x, detail: d[x.id] } : x));
const ev = (type: PVEventType, stepId: string, message: string): PVEvent => ({ type, stepId, timestamp: Date.now(), message });
const idle = (s: VpnState): VpnState => ({ ...s, packet: undefined, flood: [], decision: undefined });

const hopOf = (stepId: string, device: VpnDevice, o: { active: string; details: Partial<Record<string, string>>; lookupType: string; key: string; result: string; action: string; reason: string; input: string; output: string; ingress?: string; egress?: string; next?: VpnDevice; before?: PacketVisual; after?: PacketVisual; changed?: string[] }): FundHop => ({
  stepId,
  device,
  stages: withDetail(device === "GW-A" || device === "GW-B" ? GW_STAGES : device === "INTERNET" ? INET_STAGES : HOST_STAGES, o.details),
  activeStageId: o.active,
  ingressInterfaceId: o.ingress,
  egressInterfaceId: o.egress,
  lookupType: o.lookupType,
  lookupKey: o.key,
  lookupResult: o.result,
  action: o.action,
  reason: o.reason,
  input: o.input,
  output: o.output,
  nextHopId: o.next,
  before: o.before ? vpnStack(o.before) : undefined,
  after: o.after ? vpnStack(o.after, o.changed) : undefined,
});

/** The Internet transit: routes on the outer destination, decrements the outer TTL only. */
function internetHop(stepId: string, p: PacketVisual, towards: Gw): FundHop {
  const ttl = Number(fieldIn(p, /^IPv4 Header$/, "TTL"));
  return hopOf(stepId, "INTERNET", {
    active: "tx",
    details: { rx: `${fieldIn(p, /^IPv4 Header$/, "Source")} → ${fieldIn(p, /^IPv4 Header$/, "Destination")} · proto ${fieldIn(p, /^IPv4 Header$/, "Protocol")}`, lookup: `${fieldIn(p, /^IPv4 Header$/, "Destination")} → toward ${towards}`, ttl: `outer TTL ${ttl} → ${ttl - 1}` },
    lookupType: "Internet routing (public addresses)",
    key: `outer destination ${fieldIn(p, /^IPv4 Header$/, "Destination")}`,
    result: `toward ${towards}`,
    action: "ROUTE (outer header)",
    reason: isEsp(p) ? "Transit routers see only the outer header: two gateway addresses, protocol 50, an SPI and a sequence number. The private addresses and the ICMP message are ciphertext to them." : isIke(p) && fieldIn(p, /^IKEv2/, "Exchange Type").startsWith("34") ? "IKE_SA_INIT is readable on the wire (algorithms, DH public values, nonces) — none of it is secret, and none of it proves identity." : "Only the IKE header is readable; every payload after it is inside the encrypted SK payload.",
    input: `${fieldIn(p, /^IPv4 Header$/, "Source")} → ${fieldIn(p, /^IPv4 Header$/, "Destination")} TTL ${ttl}`,
    output: `TTL ${ttl - 1} → ${towards}`,
    ingress: towards === "GW-B" ? "to-GW-A" : "to-GW-B",
    egress: towards === "GW-B" ? "to-GW-B" : "to-GW-A",
    next: towards,
    before: p,
  });
}
/** Rebuild a packet as it leaves the Internet toward a gateway: outer TTL − 1, new Ethernet header. */
const transitIke = (id: string, towards: Gw, outer: { src: string; dst: string; ttl: number; ipId: number }, m: IkeMsg) => ikePacket(id, "INTERNET", towards, { ...outer, ttl: outer.ttl - 1 }, m);
const outerAB = (ipId: number, ttl = INITIAL_TTL) => ({ src: VPN.gwaPub, dst: VPN.gwbPub, ttl, ipId });
const outerBA = (ipId: number, ttl = INITIAL_TTL) => ({ src: VPN.gwbPub, dst: VPN.gwaPub, ttl, ipId });
const pingInner = (seq: number, reply = false, ttl = INITIAL_TTL): Inner => (reply ? { src: VPN.hostB, dst: VPN.hostA, ttl, ipId: 0x4b00 + seq, echo: { kind: "echo-reply", identifier: ECHO_ID, sequence: seq, dataLength: 56 } } : { src: VPN.hostA, dst: VPN.hostB, ttl, ipId: 0x3a00 + seq, echo: { kind: "echo-request", identifier: ECHO_ID, sequence: seq, dataLength: 56 } });

// ---------------------------------------------------------------------------------------------------------------
// Repair
// ---------------------------------------------------------------------------------------------------------------
export const VPN_REPAIR_OPTIONS = [
  { id: "fix-ts", label: "Correct GW-B's remote Site-A selector to 10.10.10.0/24" },
  { id: "peer-ip", label: "Change GW-A's IKE peer address for GW-B" },
  { id: "ike-id", label: "Change the IKE authentication identities" },
  { id: "raise-ttl", label: "Increase HOST-A's IPv4 TTL" },
  { id: "bypass", label: "Allow 10.10.10.0/24 ↔ 10.20.20.0/24 to bypass IPsec in cleartext" },
] as const;
export const VPN_REPAIR_CORRECT = "fix-ts";
export function applyVpnRepair(s: VpnState, choice: string): VpnState {
  const correct = choice === VPN_REPAIR_CORRECT;
  if (!correct) return { ...s, repairAttempt: { choice, correct } };
  return { ...idle(s), gwbRemote: VPN.siteA, repairAttempt: { choice, correct }, repaired: true, faultActive: false, decision: { device: "GW-B", text: `GW-B remote selector → ${VPN.siteA}` } };
}

// ---------------------------------------------------------------------------------------------------------------
// Step builders
// ---------------------------------------------------------------------------------------------------------------
const pkt = (s: VpnState) => s.packet;
const ikeLine = (s: VpnState) => `IKE SA ${s.ike.phase}${s.ike.lastExchange ? ` · last ${s.ike.lastExchange}` : ""}`;
const childLine = (s: VpnState) => (s.child && s.childStatus === "INSTALLED" ? `CHILD SA INSTALLED · ${s.child.tsi} ↔ ${s.child.tsr} · A→B ${spiText(s.child.ab)} · B→A ${spiText(s.child.ba)}` : `CHILD SA ${s.childStatus}`);

/** A gateway sends an IKE request/response toward the Internet. */
function ikeSend(s: VpnState, stepId: string, from: Gw, m: IkeMsg, ipId: number, o: { action: string; reason: string; key: string; result: string; patch?: Partial<VpnState> }): VpnState {
  const outer = from === "GW-A" ? outerAB(ipId) : outerBA(ipId);
  const p = ikePacket(`${stepId}-ike`, from, "INTERNET", outer, m);
  const hop = hopOf(stepId, from, {
    active: "ike",
    details: { ike: `${m.exchange} ${m.response ? "response" : "request"} · Message ID ${m.msgId}${m.exchange === "IKE_SA_INIT" ? " · cleartext" : " · inside SK (IKE SA keys)"}`, tx: `UDP 500 → ${outer.dst}:500` },
    lookupType: `${from} IKE SA`,
    key: o.key,
    result: o.result,
    action: o.action,
    reason: o.reason,
    input: o.key,
    output: `IKEv2 ${m.exchange} ${m.response ? "response" : "request"} (${m.length} bytes)`,
    egress: "wan",
    next: "INTERNET",
    after: p,
  });
  return { ...idle(s), ...o.patch, hops: [...s.hops, hop], packet: p, decision: { device: from, text: `${from}: ${m.exchange} ${m.response ? "response" : "request"} · MsgID ${m.msgId}` } };
}
/** The Internet delivers an IKE message and the receiving gateway processes it. */
function ikeReceive(s: VpnState, stepId: string, to: Gw, m: IkeMsg, ipId: number, o: { action: string; reason: string; key: string; result: string; active: string; details: Partial<Record<string, string>>; patch?: Partial<VpnState> }): VpnState {
  const outer = to === "GW-B" ? outerAB(ipId) : outerBA(ipId);
  const sent = ikePacket(`${stepId}-sent`, to === "GW-B" ? "GW-A" : "GW-B", "INTERNET", outer, m);
  const arriving = transitIke(`${stepId}-ike`, to, outer, m);
  const hop = hopOf(stepId, to, { active: o.active, details: { rx: `UDP 500 from ${outer.src} · ${m.exchange} ${m.response ? "response" : "request"}`, ...o.details }, lookupType: `${to} IKE SA`, key: o.key, result: o.result, action: o.action, reason: o.reason, input: `IKEv2 ${m.exchange} MsgID ${m.msgId}`, output: o.result, ingress: "wan", before: arriving });
  return { ...idle(s), ...o.patch, hops: [...s.hops, internetHop(stepId, sent, to), hop], packet: arriving, decision: { device: to, text: `${to}: ${o.result}` } };
}

/** HOST-A → GW-A plaintext ping. */
function hostAPing(s: VpnState, stepId: string, seq: number): VpnState {
  const x = pingInner(seq);
  const p = lanPacket(`${stepId}-ping`, "HOST-A", "GW-A", x);
  const hop = hopOf(stepId, "HOST-A", { active: "tx", details: { app: `Echo Request id ${ECHO_ID} seq ${seq}`, gw: `${VPN.hostB} is off-link → gateway ${VPN.gwaLan}` }, lookupType: "HOST-A routing", key: `destination ${VPN.hostB}`, result: `via ${VPN.gwaLan}`, action: "PING", reason: "HOST-A knows nothing about IPsec. It sends an ordinary packet to HOST-B's private address through its default gateway.", input: "(originated here)", output: `${x.src} → ${x.dst} ICMP seq ${seq}`, egress: "eth0", next: "GW-A", after: p });
  return { ...idle(s), hops: [...s.hops, hop], packet: p, pingSeq: seq, hostA: { ...s.hostA, sent: s.hostA.sent + 1, lastResult: `seq ${seq} sent` }, decision: { device: "HOST-A", text: `HOST-A ping seq ${seq}` } };
}

/** GW encrypts a plaintext LAN packet into ESP on the current CHILD SA (A→B or B→A). */
function encrypt(s: VpnState, stepId: string, from: Gw, x: Inner, ipId: number): VpnState {
  const c = s.child!;
  const ab = from === "GW-A";
  const spi = ab ? c.ab : c.ba;
  const seq = ab ? c.seqAB : c.seqBA;
  const fwd: Inner = { ...x, ttl: x.ttl - 1 };
  const p = espPacket(`${stepId}-esp`, from, "INTERNET", ab ? outerAB(ipId) : outerBA(ipId), spi, seq, fwd);
  const lan = lanPacket(`${stepId}-lan`, ab ? "HOST-A" : "HOST-B", from, x);
  const hop = hopOf(stepId, from, {
    active: "crypto",
    details: { rx: `plaintext on LAN: ${x.src} → ${x.dst}`, spd: `${x.src} ∈ ${ab ? c.tsi : c.tsr} and ${x.dst} ∈ ${ab ? c.tsr : c.tsi} → PROTECT`, sa: `outbound CHILD SA SPI ${spiText(spi)} · next sequence ${seq}`, crypto: `AES-GCM over inner packet (inner TTL ${x.ttl} → ${fwd.ttl}) + trailer · 16-byte ICV`, tx: `outer ${ab ? VPN.gwaPub : VPN.gwbPub} → ${ab ? VPN.gwbPub : VPN.gwaPub} · protocol 50` },
    lookupType: `${from} traffic selectors + CHILD SA`,
    key: `${x.src} → ${x.dst}`,
    result: `PROTECT · SPI ${spiText(spi)} · seq ${seq}`,
    action: "ENCRYPT · ESP TUNNEL",
    reason: `The packet matches the CHILD SA's selectors, so it must be protected. ${from} forwards it like a router (inner TTL − 1), encrypts the whole inner packet into ESP and adds a new outer IPv4 header between the two gateways. SPI ${spiText(spi)} was chosen by ${ab ? "GW-B" : "GW-A"} — the receiver — so it can find the right SA.`,
    input: `${x.src} → ${x.dst} ICMP seq ${x.echo.sequence}`,
    output: `ESP ${ab ? VPN.gwaPub : VPN.gwbPub} → ${ab ? VPN.gwbPub : VPN.gwaPub} SPI ${spiText(spi)} seq ${seq}`,
    ingress: "lan",
    egress: "wan",
    next: "INTERNET",
    before: lan,
    after: p,
    changed: ["eth", "ip", "esp"],
  });
  const child: ChildSa = ab ? { ...c, seqAB: c.seqAB + 1 } : { ...c, seqBA: c.seqBA + 1 };
  return { ...idle(s), hops: [...s.hops, hop], packet: p, child, decision: { device: from, text: `${from}: ENCRYPT · SPI ${spiText(spi)} · seq ${seq}` } };
}

/** Internet → receiving gateway: SPI lookup, anti-replay, decrypt. The packet shown is the arriving ESP packet. */
function decrypt(s: VpnState, stepId: string, to: Gw, x: Inner, ipId: number, seq: number): VpnState {
  const c = s.child!;
  const ab = to === "GW-B";
  const spi = ab ? c.ab : c.ba;
  const sentInner: Inner = { ...x, ttl: x.ttl - 1 };
  const outer = ab ? outerAB(ipId) : outerBA(ipId);
  const sent = espPacket(`${stepId}-sent`, ab ? "GW-A" : "GW-B", "INTERNET", outer, spi, seq, sentInner);
  const arriving = espPacket(`${stepId}-esp`, "INTERNET", to, { ...outer, ttl: outer.ttl - 1 }, spi, seq, sentInner);
  const highest = ab ? c.rxAB : c.rxBA;
  const hop = hopOf(stepId, to, {
    active: "crypto",
    details: { rx: `ESP from ${outer.src} · SPI ${spiText(spi)} · seq ${seq}`, sa: `SPI ${spiText(spi)} → this gateway's inbound SA · seq ${seq} > highest ${highest} → not a replay`, crypto: "ICV verified · decrypted · Next Header 4 → inner IPv4", spd: `inner ${sentInner.src} → ${sentInner.dst} matches the SA's selectors` },
    lookupType: `${to} inbound SA (by SPI)`,
    key: `SPI ${spiText(spi)} · seq ${seq}`,
    result: `decrypted · inner ${sentInner.src} → ${sentInner.dst}`,
    action: "DECRYPT · ANTI-REPLAY OK",
    reason: `${to} chose SPI ${spiText(spi)} for its inbound SA, so the SPI finds the keys. Sequence ${seq} is new for this SA, the AES-GCM tag verifies, and the decrypted inner packet matches the negotiated selectors — only then is it forwarded.`,
    input: `ESP SPI ${spiText(spi)} seq ${seq}`,
    output: `inner ${sentInner.src} → ${sentInner.dst}`,
    ingress: "wan",
    before: arriving,
  });
  const child: ChildSa = ab ? { ...c, rxAB: Math.max(c.rxAB, seq) } : { ...c, rxBA: Math.max(c.rxBA, seq) };
  return { ...idle(s), hops: [...s.hops, internetHop(stepId, sent, to), hop], packet: arriving, child, decision: { device: to, text: `${to}: DECRYPT · SPI ${spiText(spi)} seq ${seq}` } };
}

/** Gateway forwards the decrypted inner packet on its LAN (inner TTL − 1) and the host receives it. */
function deliver(s: VpnState, stepId: string, from: Gw, x: Inner): VpnState {
  const arrived: Inner = { ...x, ttl: x.ttl - 2 };
  const to: VpnDevice = from === "GW-B" ? "HOST-B" : "HOST-A";
  const p = lanPacket(`${stepId}-lan`, from, to, arrived);
  const gwHop = hopOf(stepId, from, { active: "tx", details: { tx: `inner TTL ${x.ttl - 1} → ${arrived.ttl} · ${arrived.dst} is on the LAN` }, lookupType: `${from} LAN routing`, key: `inner destination ${arrived.dst}`, result: "connected LAN", action: "FORWARD (plaintext on LAN)", reason: "After decryption the gateway routes the ORIGINAL packet: private source and destination unchanged since HOST-A / HOST-B sent it; only the inner TTL counts the two gateway hops.", input: `inner ${arrived.src} → ${arrived.dst}`, output: `to ${to}`, ingress: "wan", egress: "lan", next: to, after: p });
  const reply = x.echo.kind === "echo-reply";
  const hostHop = hopOf(stepId, to, { active: "app", details: { app: reply ? `Echo Reply seq ${x.echo.sequence} received` : `Echo Request seq ${x.echo.sequence} received` }, lookupType: `${to} ICMP`, key: `${arrived.src} → ${arrived.dst}`, result: reply ? "reply received" : "request received", action: reply ? "PING OK" : "RECEIVE", reason: reply ? "HOST-A gets its answer from HOST-B's private address. Neither host ever saw ESP." : "HOST-B sees an ordinary packet from 10.10.10.10 — the tunnel is invisible to it.", input: `${arrived.src} → ${arrived.dst}`, output: reply ? "ping succeeded" : "will reply", ingress: "eth0" });
  return { ...idle(s), hops: [...s.hops, gwHop, hostHop], packet: p, hostA: reply ? { ...s.hostA, replies: s.hostA.replies + 1, lastResult: `seq ${x.echo.sequence} replied` } : s.hostA, decision: { device: from, text: `${from} → ${to} (plaintext)` } };
}

const auth = (resp: boolean) => authMsg(resp, resp ? CHILD_SPIS.first.ab : CHILD_SPIS.first.ba);
const firstChild = (): ChildSa => ({ gen: "first", tsi: VPN.siteA, tsr: VPN.siteB, ab: CHILD_SPIS.first.ab, ba: CHILD_SPIS.first.ba, seqAB: 1, seqBA: 1, rxAB: 0, rxBA: 0 });
const repairedChild = (): ChildSa => ({ gen: "repaired", tsi: VPN.siteA, tsr: VPN.siteB, ab: CHILD_SPIS.repaired.ab, ba: CHILD_SPIS.repaired.ba, seqAB: 1, seqBA: 1, rxAB: 0, rxBA: 0 });

// ---------------------------------------------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------------------------------------------
export const ipsecSteps: ScenarioStep<VpnState>[] = [
  {
    id: "intro",
    label: "Two sites, one untrusted Internet",
    narrative: `Site A (${VPN.siteA}) and Site B (${VPN.siteB}) must talk privately across the Internet. GW-A (public ${VPN.gwaPub}) and GW-B (public ${VPN.gwbPub}) will build an IPsec tunnel with IKEv2. The hosts will keep using their private addresses; the gateways do all the work.`,
  },
  {
    id: "sites",
    label: "What must be protected",
    narrative: `Both gateways are configured with the same intent: protect traffic between ${VPN.siteA} and ${VPN.siteB}, peer with the other gateway's public address, authenticate with a pre-shared key, and use AES-GCM. No SA exists yet — nothing has been negotiated.`,
    run: (s) => ({ state: { ...idle(s), hops: [...s.hops, hopOf("sites", "GW-A", { active: "spd", details: { spd: `protect ${VPN.siteA} ↔ ${VPN.siteB} · peer ${VPN.gwbPub}` }, lookupType: "GW-A IPsec configuration", key: `${VPN.siteA} ↔ ${VPN.siteB}`, result: "no IKE SA · no CHILD SA", action: "CONFIGURED", reason: "Configuration says WHAT to protect and WHO the peer is. Security associations — the actual keys and SPIs — only exist after IKE negotiates them.", input: "configuration", output: "idle" })] }, events: [ev("STEP_ENTERED", "sites", "Sites")] }),
  },
  {
    id: "predict-init",
    label: "Predict: the first exchange",
    narrative: "GW-A is about to send IKE_SA_INIT.",
    question: {
      prompt: "What does IKE_SA_INIT accomplish?",
      options: [
        { id: "dh", label: "It agrees the IKE SA's algorithms and runs the Diffie-Hellman exchange (SA, KE, Nonce) — but does not authenticate the peers" },
        { id: "auth", label: "It authenticates both gateways with the pre-shared key" },
        { id: "esp", label: "It creates the ESP tunnel for user traffic" },
        { id: "all", label: "Everything: keys, identities and the CHILD SA in one exchange" },
      ],
      correctOptionId: "dh",
      explanation: "IKE_SA_INIT produces shared keys that nobody watching can compute — but either side could still be an impostor. Authentication comes next, inside the protection those keys provide.",
    },
  },
  {
    id: "init-req",
    label: "IKE_SA_INIT request",
    narrative: `GW-A → GW-B, UDP/500, Exchange Type 34, Message ID 0, Initiator SPI ${IKE_SPI_I}, Responder SPI 0 (unknown yet). Payloads in the clear: SA (the proposal), KE (GW-A's DH group-19 public value) and Ni (a nonce). No NAT between the gateways, so no NAT-detection payloads and no UDP/4500.`,
    run: (s) => ({ state: ikeSend(s, "init-req", "GW-A", saInitMsg(false), 0x5a01, { action: "IKE_SA_INIT →", reason: "The initiator offers algorithms, its Diffie-Hellman public value and a nonce. All readable on the wire, none of it secret.", key: `peer ${VPN.gwbPub}`, result: "request sent · waiting", patch: { ike: { phase: "IKE_SA_INIT sent", peersAuthenticated: false, lastExchange: "IKE_SA_INIT (34) request", lastMsgId: 0 } } }), events: [ev("PACKET_SENT", "init-req", "IKE_SA_INIT")] }),
    packet: pkt,
  },
  {
    id: "init-req-rx",
    label: "GW-B picks a proposal",
    narrative: "The Internet routes the packet on its outer destination. GW-B accepts the proposal, generates its own DH value and nonce, and chooses its Responder SPI.",
    run: (s) => ({ state: ikeReceive(s, "init-req-rx", "GW-B", saInitMsg(false), 0x5a01, { active: "ike", details: { ike: `accept ${IKE_PROPOSAL} · own DH value + Nr · Responder SPI ${IKE_SPI_R}` }, action: "PROPOSAL ACCEPTED", reason: "GW-B can already compute the shared DH secret from GW-A's public value and its own private value — but it still has no idea whether GW-A is really GW-A.", key: "IKE_SA_INIT request", result: "IKE_SA_INIT response prepared" }), events: [ev("PACKET_RECEIVED", "init-req-rx", "GW-B")] }),
    packet: pkt,
  },
  {
    id: "init-resp",
    label: "IKE_SA_INIT response",
    narrative: `GW-B → GW-A: Exchange Type 34, Response flag, Message ID 0, Responder SPI ${IKE_SPI_R}, with SA (the chosen proposal), KE (GW-B's public value) and Nr.`,
    run: (s) => ({ state: ikeSend(s, "init-resp", "GW-B", saInitMsg(true), 0x6b01, { action: "IKE_SA_INIT ←", reason: "The responder returns the chosen algorithms, its DH public value and its nonce.", key: "IKE_SA_INIT response", result: "sent", patch: { ike: { ...s.ike, spiR: IKE_SPI_R } } }), events: [ev("PACKET_SENT", "init-resp", "IKE_SA_INIT response")] }),
    packet: pkt,
  },
  {
    id: "init-resp-rx",
    label: "Shared keys — not trust",
    narrative: "GW-A combines GW-B's public value with its own private value: both sides now hold the same Diffie-Hellman secret, derive SKEYSEED and the IKE SA keys (SK_d, SK_ei/SK_er, SK_pi/SK_pr). An eavesdropper saw both public values and still cannot compute them. But neither peer is authenticated yet.",
    run: (s) => ({ state: ikeReceive(s, "init-resp-rx", "GW-A", saInitMsg(true), 0x6b01, { active: "ike", details: { ike: "DH shared secret → SKEYSEED → SK_d · SK_ei/SK_er · SK_pi/SK_pr (AES-GCM needs no separate SK_a)" }, action: "KEYS DERIVED · NOT AUTHENTICATED", reason: "Diffie-Hellman gives secrecy against a passive observer. It does not prove who is on the other end — a man in the middle could have run DH with each side.", key: "IKE_SA_INIT response", result: "IKE SA keys derived · peers NOT authenticated", patch: { ike: { phase: "keys derived (not authenticated)", spiR: IKE_SPI_R, peersAuthenticated: false, lastExchange: "IKE_SA_INIT (34) response", lastMsgId: 0 } } }), events: [ev("PACKET_RECEIVED", "init-resp-rx", "Keys derived")] }),
    packet: pkt,
    whatChanged: () => ["Both gateways: same DH secret, IKE SA keys derived", "Peers NOT authenticated yet"],
  },
  {
    id: "predict-auth",
    label: "Predict: when is trust established?",
    narrative: "The next exchange is IKE_AUTH.",
    question: {
      prompt: "When are the two gateways authenticated?",
      options: [
        { id: "auth", label: "In IKE_AUTH: each proves its identity with an AUTH payload, sent inside the encrypted SK payload" },
        { id: "init", label: "Already in IKE_SA_INIT, by the Diffie-Hellman exchange" },
        { id: "esp", label: "When the first ESP packet decrypts correctly" },
        { id: "never", label: "Never — IPsec only encrypts, it doesn't authenticate" },
      ],
      correctOptionId: "auth",
      explanation: "IKE_AUTH binds each peer's identity to the IKE_SA_INIT exchange (nonces and DH values) with an AUTH value — here derived from the pre-shared key. Only after both AUTH values verify is the IKE SA established.",
    },
  },
  {
    id: "auth-req",
    label: "IKE_AUTH request (encrypted)",
    narrative: `GW-A → GW-B: Exchange Type 35, Message ID 1. After the IKE header everything is inside the SK payload — ciphertext on the wire. The inspector's teaching view shows what is inside: IDi, AUTH (a proof — the key is never sent), SA for the first CHILD SA with GW-A's inbound SPI ${spiText(CHILD_SPIS.first.ba)}, TSi ${VPN.siteA} and TSr ${VPN.siteB}.`,
    run: (s) => ({ state: ikeSend(s, "auth-req", "GW-A", auth(false), 0x5a02, { action: "IKE_AUTH →", reason: "GW-A proves its identity and, in the same message, asks for the first CHILD SA: which traffic (selectors) and which inbound SPI GW-A will recognise.", key: "IKE_AUTH request", result: "sent inside SK", patch: { ike: { ...s.ike, phase: "IKE_AUTH sent", lastExchange: "IKE_AUTH (35) request", lastMsgId: 1 }, childStatus: "NEGOTIATING" } }), events: [ev("PACKET_SENT", "auth-req", "IKE_AUTH")] }),
    packet: pkt,
  },
  {
    id: "auth-req-rx",
    label: "GW-B verifies GW-A",
    narrative: `GW-B decrypts the SK payload with the IKE SA keys, verifies GW-A's AUTH, and checks the requested selectors against its policy (local ${VPN.siteB}, remote ${VPN.siteA}): acceptable. It allocates its own inbound SPI ${spiText(CHILD_SPIS.first.ab)} for traffic from GW-A.`,
    run: (s) => ({ state: ikeReceive(s, "auth-req-rx", "GW-B", auth(false), 0x5a02, { active: "spd", details: { ike: "SK decrypted · AUTH verified → GW-A authenticated", spd: `TSi ${VPN.siteA} within remote ${s.gwbRemote} · TSr ${VPN.siteB} within local ${VPN.siteB} → accept`, sa: `inbound SPI ${spiText(CHILD_SPIS.first.ab)} allocated` }, action: "AUTHENTICATED · TS OK", reason: "Identity proven, selectors acceptable. GW-B answers with its own AUTH and the other half of the CHILD SA.", key: "IKE_AUTH request", result: "peer authenticated · selectors accepted" }), events: [ev("PACKET_RECEIVED", "auth-req-rx", "GW-B verifies")] }),
    packet: pkt,
  },
  {
    id: "auth-resp",
    label: "IKE_AUTH response",
    narrative: `GW-B → GW-A: Exchange Type 35, Message ID 1, Response. Inside SK: IDr, AUTH, SA with GW-B's inbound SPI ${spiText(CHILD_SPIS.first.ab)}, TSi, TSr.`,
    run: (s) => ({ state: ikeSend(s, "auth-resp", "GW-B", auth(true), 0x6b02, { action: "IKE_AUTH ←", reason: "GW-B proves its identity and completes the first CHILD SA.", key: "IKE_AUTH response", result: "sent inside SK" }), events: [ev("PACKET_SENT", "auth-resp", "IKE_AUTH response")] }),
    packet: pkt,
  },
  {
    id: "auth-resp-rx",
    label: "IKE SA and first CHILD SA up",
    narrative: `GW-A verifies GW-B's AUTH. The IKE SA is ESTABLISHED and the first CHILD SA is installed: GW-A → GW-B traffic uses SPI ${spiText(CHILD_SPIS.first.ab)} (GW-B's choice), GW-B → GW-A uses ${spiText(CHILD_SPIS.first.ba)} (GW-A's choice). ESP keys come from SK_d and the nonces.`,
    run: (s) => ({ state: ikeReceive(s, "auth-resp-rx", "GW-A", auth(true), 0x6b02, { active: "sa", details: { ike: "AUTH verified → GW-B authenticated · IKE SA ESTABLISHED", sa: `CHILD SA: out ${spiText(CHILD_SPIS.first.ab)} · in ${spiText(CHILD_SPIS.first.ba)}` }, action: "IKE SA UP · CHILD SA INSTALLED", reason: "Two SAs now exist and they are different things: the IKE SA protects IKE messages; the CHILD SA (a pair of one-way ESP SAs) will protect HOST traffic.", key: "IKE_AUTH response", result: "IKE SA ESTABLISHED · CHILD SA installed", patch: { ike: { phase: "ESTABLISHED", spiR: IKE_SPI_R, peersAuthenticated: true, lastExchange: "IKE_AUTH (35) response", lastMsgId: 1 }, child: firstChild(), childStatus: "INSTALLED" } }), events: [ev("PACKET_RECEIVED", "auth-resp-rx", "CHILD SA installed")] }),
    packet: pkt,
    whatChanged: (_p, n) => [ikeLine(n), childLine(n)],
  },
  {
    id: "sa-summary",
    label: "IKE SA vs CHILD SA",
    narrative: `IKE SA — SPIs ${IKE_SPI_I} / ${IKE_SPI_R}: the control channel, protecting IKE exchanges (UDP/500). CHILD SA — ESP SPIs ${spiText(CHILD_SPIS.first.ab)} (A→B) and ${spiText(CHILD_SPIS.first.ba)} (B→A): the data channel, protecting user packets (IP protocol 50). The first CHILD SA was negotiated inside IKE_AUTH; more can be created later with CREATE_CHILD_SA.`,
    run: (s) => ({ state: { ...idle(s), hops: [...s.hops, hopOf("sa-summary", "GW-A", { active: "sa", details: { ike: `IKE SA ${IKE_SPI_I} / ${IKE_SPI_R}`, sa: childLine(s) }, lookupType: "GW-A security associations", key: "SAD", result: `${ikeLine(s)} · ${childLine(s)}`, action: "TWO KINDS OF SA", reason: "Control plane: IKE (keys, identities, SA management). Data plane: ESP with the CHILD SA's keys.", input: "SA database", output: "IKE SA + CHILD SA" })] }, events: [] }),
    whatChanged: (_p, n) => [ikeLine(n), childLine(n)],
  },
  {
    id: "predict-ike-child",
    label: "Predict: one SA or two?",
    narrative: "Look at the SA panel.",
    question: {
      prompt: "Is the IKE SA the same thing as the CHILD SA?",
      options: [
        { id: "no", label: "No — the IKE SA protects IKE messages; the CHILD SA protects user data with ESP. Different keys, different SPIs" },
        { id: "yes", label: "Yes — the IKE SA is the ESP tunnel" },
        { id: "alias", label: "Yes — CHILD SA is just the IKEv2 name for the IKE SA" },
        { id: "esp", label: "No — the CHILD SA protects IKE; the IKE SA carries user data" },
      ],
      correctOptionId: "no",
      explanation: "Calling the IKE SA \"the tunnel\" is a common mix-up. Host packets never travel inside the IKE SA; they travel in ESP under a CHILD SA, which IKE created and can delete or replace.",
    },
  },
  {
    id: "predict-spi",
    label: "Predict: SPIs and direction",
    narrative: `The CHILD SA shows ${spiText(CHILD_SPIS.first.ab)} and ${spiText(CHILD_SPIS.first.ba)}.`,
    question: {
      prompt: "Are CHILD SA SPIs directional?",
      options: [
        { id: "yes", label: "Yes — each direction is its own SA with its own SPI, chosen by the receiving gateway" },
        { id: "no", label: "No — one SPI identifies the tunnel in both directions" },
        { id: "sender", label: "Yes, and each sender picks the SPI it puts in its own packets" },
        { id: "ike", label: "SPIs belong only to the IKE SA" },
      ],
      correctOptionId: "yes",
      explanation: "An IPsec SA is one-way. A CHILD SA is a pair. The SPI in an ESP packet tells the RECEIVER which of its inbound SAs (and keys) to use, so the receiver is the one that allocates it.",
    },
  },
  {
    id: "predict-inner",
    label: "Predict: the inner header",
    narrative: "HOST-A is about to ping HOST-B.",
    question: {
      prompt: "Which addresses appear in the INNER IPv4 header of the protected packet?",
      options: [
        { id: "private", label: "The hosts' own addresses: 10.10.10.10 → 10.20.20.20" },
        { id: "public", label: "The gateways' public addresses: 198.51.100.10 → 203.0.113.10" },
        { id: "mixed", label: "10.10.10.10 → 203.0.113.10" },
        { id: "none", label: "There is no inner header in tunnel mode" },
      ],
      correctOptionId: "private",
      explanation: "Tunnel mode carries the original packet unchanged inside ESP. The private endpoints stay in the inner header; the gateways add a new outer header around it.",
    },
  },
  {
    id: "ping-send",
    label: "HOST-A pings HOST-B",
    narrative: `An ordinary ICMP Echo Request ${VPN.hostA} → ${VPN.hostB}, seq 1, to the default gateway GW-A. On the Site-A LAN it is plaintext.`,
    run: (s) => ({ state: hostAPing(s, "ping-send", 1), events: [ev("PACKET_SENT", "ping-send", "Ping 1")] }),
    packet: pkt,
  },
  {
    id: "predict-outer",
    label: "Predict: the outer header",
    narrative: "GW-A will wrap the packet for the trip across the Internet.",
    packet: pkt,
    question: {
      prompt: "Which addresses appear in the OUTER (tunnel) IPv4 header?",
      options: [
        { id: "gw", label: "The gateways: 198.51.100.10 → 203.0.113.10, protocol 50 (ESP)" },
        { id: "hosts", label: "The hosts: 10.10.10.10 → 10.20.20.20" },
        { id: "udp", label: "The gateways, but carried in UDP/500" },
        { id: "nat", label: "HOST-A's address translated to 198.51.100.10" },
      ],
      correctOptionId: "gw",
      explanation: "The outer header is what the Internet routes: public gateway addresses and protocol 50. ESP is not inside UDP here — UDP/4500 encapsulation is only used when NAT traversal is needed. And this is not NAT: the inner packet is kept, just encrypted.",
    },
  },
  {
    id: "esp-encrypt",
    label: "GW-A encrypts: ESP tunnel mode",
    narrative: `GW-A matches the packet to the CHILD SA's selectors, decrements the inner TTL, encrypts the inner packet plus ESP trailer (Next Header 4 = IPv4) with AES-GCM, and adds ESP (SPI ${spiText(CHILD_SPIS.first.ab)}, sequence 1) and a new outer IPv4 header ${VPN.gwaPub} → ${VPN.gwbPub}, protocol 50.`,
    run: (s) => ({ state: encrypt(s, "esp-encrypt", "GW-A", pingInner(1), 0x5a10), events: [ev("PACKET_SENT", "esp-encrypt", "ESP seq 1")] }),
    packet: pkt,
    whatChanged: () => [`Outer ${VPN.gwaPub} → ${VPN.gwbPub} · protocol 50`, `ESP SPI ${spiText(CHILD_SPIS.first.ab)} · seq 1`, `Inner ${VPN.hostA} → ${VPN.hostB} (encrypted)`],
  },
  {
    id: "predict-observer",
    label: "Predict: what does the Internet see?",
    narrative: "The ESP packet is crossing the Internet.",
    packet: pkt,
    question: {
      prompt: "Can an observer on the Internet read the original private IP packet inside ESP?",
      options: [
        { id: "no", label: "No — they see the outer header, the SPI and the sequence number; the inner packet is AES-GCM ciphertext" },
        { id: "yes", label: "Yes — ESP only authenticates, the payload stays readable" },
        { id: "headers", label: "They can read the inner IP header but not the ICMP payload" },
        { id: "seq", label: "Only if they know the sequence number" },
      ],
      correctOptionId: "no",
      explanation: "ESP with AES-GCM gives confidentiality and integrity. The inspector's \"decrypted teaching view\" shows what GW-B will recover — it is not visible on the wire. The sequence number is visible and exists for anti-replay, not secrecy.",
    },
  },
  {
    id: "esp-decrypt",
    label: "GW-B decrypts",
    narrative: `The Internet decrements the OUTER TTL only. GW-B looks up SPI ${spiText(CHILD_SPIS.first.ab)} in its inbound SAs, checks sequence 1 against its anti-replay window, verifies the AES-GCM tag and decrypts. The inner packet matches the selectors.`,
    run: (s) => ({ state: decrypt(s, "esp-decrypt", "GW-B", pingInner(1), 0x5a10, 1), events: [ev("PACKET_RECEIVED", "esp-decrypt", "Decrypted")] }),
    packet: pkt,
  },
  {
    id: "esp-deliver",
    label: "HOST-B receives a plain packet",
    narrative: `GW-B routes the recovered inner packet onto Site B. HOST-B receives ${VPN.hostA} → ${VPN.hostB} — exactly what HOST-A sent, with the inner TTL lowered by the two gateway hops.`,
    run: (s) => ({ state: deliver(s, "esp-deliver", "GW-B", pingInner(1)), events: [ev("PACKET_RECEIVED", "esp-deliver", "HOST-B")] }),
    packet: pkt,
  },
  {
    id: "reply-send",
    label: "HOST-B replies",
    narrative: `Echo Reply ${VPN.hostB} → ${VPN.hostA}, seq 1, to GW-B.`,
    run: (s) => {
      const x = pingInner(1, true);
      const p = lanPacket("reply-send-ping", "HOST-B", "GW-B", x);
      const hop = hopOf("reply-send", "HOST-B", { active: "tx", details: { app: "Echo Reply seq 1", gw: `${VPN.hostA} off-link → ${VPN.gwbLan}` }, lookupType: "HOST-B routing", key: `destination ${VPN.hostA}`, result: `via ${VPN.gwbLan}`, action: "REPLY", reason: "HOST-B answers the private address it saw.", input: "Echo Request", output: `${x.src} → ${x.dst}`, egress: "eth0", next: "GW-B", after: p });
      return { state: { ...idle(s), hops: [...s.hops, hop], packet: p, decision: { device: "HOST-B", text: "HOST-B Echo Reply" } }, events: [ev("PACKET_SENT", "reply-send", "Reply")] };
    },
    packet: pkt,
  },
  {
    id: "reply-encrypt",
    label: "GW-B encrypts on the other SA",
    narrative: `Return traffic uses the OTHER half of the CHILD SA: SPI ${spiText(CHILD_SPIS.first.ba)} (chosen by GW-A), its own sequence counter starting at 1, outer header ${VPN.gwbPub} → ${VPN.gwaPub}.`,
    run: (s) => ({ state: encrypt(s, "reply-encrypt", "GW-B", pingInner(1, true), 0x6b10), events: [ev("PACKET_SENT", "reply-encrypt", "ESP B→A")] }),
    packet: pkt,
    whatChanged: () => [`SPI ${spiText(CHILD_SPIS.first.ba)} · seq 1 (B→A counter)`, `Outer ${VPN.gwbPub} → ${VPN.gwaPub}`],
  },
  {
    id: "reply-decrypt",
    label: "GW-A decrypts",
    narrative: `GW-A finds SPI ${spiText(CHILD_SPIS.first.ba)} among its inbound SAs, checks the sequence number, verifies and decrypts.`,
    run: (s) => ({ state: decrypt(s, "reply-decrypt", "GW-A", pingInner(1, true), 0x6b10, 1), events: [ev("PACKET_RECEIVED", "reply-decrypt", "Decrypted")] }),
    packet: pkt,
  },
  {
    id: "reply-deliver",
    label: "HOST-A gets its reply",
    narrative: "GW-A forwards the inner Echo Reply to HOST-A. The ping works end to end, and neither host ever saw ESP.",
    run: (s) => ({ state: deliver(s, "reply-deliver", "GW-A", pingInner(1, true)), events: [ev("PACKET_RECEIVED", "reply-deliver", "Ping OK")] }),
    packet: pkt,
    whatChanged: (_p, n) => [`HOST-A: ${n.hostA.lastResult}`],
  },
  {
    id: "seq-more",
    label: "Sequence numbers climb",
    narrative: "HOST-A sends two more pings. On the A→B SA they leave as ESP sequence 2 and 3; GW-B accepts each only because it is higher than anything seen before (or inside its anti-replay window and not yet received). A copy replayed by an attacker would be dropped. Sequence numbers say nothing about secrecy — the encryption does that.",
    run: (s) => {
      const c = s.child!;
      const p2 = espPacket("seq-more-2", "GW-A", "INTERNET", outerAB(0x5a12), c.ab, c.seqAB, { ...pingInner(2), ttl: INITIAL_TTL - 1 });
      const p3 = espPacket("seq-more-3", "GW-A", "INTERNET", outerAB(0x5a13), c.ab, c.seqAB + 1, { ...pingInner(3), ttl: INITIAL_TTL - 1 });
      const hop = hopOf("seq-more", "GW-A", { active: "sa", details: { sa: `SPI ${spiText(c.ab)} · sequence ${c.seqAB}, ${c.seqAB + 1}`, crypto: "each packet encrypted with a fresh IV" }, lookupType: "GW-A outbound SA", key: `SPI ${spiText(c.ab)}`, result: `seq ${c.seqAB} and ${c.seqAB + 1} sent`, action: "ENCRYPT ×2", reason: "The sender increments the sequence number for every packet on this SA. It never reuses one: with 32-bit sequence numbers the SA must be rekeyed before they run out.", input: "pings 2 and 3", output: `ESP seq ${c.seqAB}, ${c.seqAB + 1}`, ingress: "lan", egress: "wan", next: "INTERNET", after: p3 });
      const gwb = hopOf("seq-more", "GW-B", { active: "sa", details: { sa: `window: highest ${c.rxAB} → ${c.seqAB + 1} · duplicates of 1–${c.seqAB + 1} would be rejected` }, lookupType: "GW-B anti-replay window", key: `SPI ${spiText(c.ab)}`, result: `accepted ${c.seqAB}, ${c.seqAB + 1}`, action: "ANTI-REPLAY OK", reason: "The receiver remembers which sequence numbers it has already accepted. A packet with a repeated (or too old) number is discarded even if it decrypts.", input: `ESP seq ${c.seqAB}, ${c.seqAB + 1}`, output: "delivered to HOST-B" });
      return { state: { ...idle(s), hops: [...s.hops, hop, gwb], packet: p3, flood: [{ id: p2.id, fromId: "GW-A", toId: "INTERNET", packet: p2 }], child: { ...c, seqAB: c.seqAB + 2, rxAB: c.seqAB + 1, seqBA: c.seqBA + 2, rxBA: c.seqBA + 1 }, pingSeq: 3, hostA: { sent: s.hostA.sent + 2, replies: s.hostA.replies + 2, lastResult: "seq 3 replied" }, decision: { device: "GW-A", text: `GW-A: ESP seq ${c.seqAB}, ${c.seqAB + 1}` } }, events: [ev("PACKET_SENT", "seq-more", "ESP seq 2, 3")] };
    },
    packet: pkt,
    whatChanged: (_p, n) => [`A→B next sequence ${n.child?.seqAB} · GW-B highest accepted ${n.child?.rxAB}`, `B→A next sequence ${n.child?.seqBA} (replies 2 and 3)`],
  },
  {
    id: "incident-intro",
    label: "Incident: a maintenance change",
    narrative: `During maintenance an engineer edits GW-B's IPsec policy. The existing CHILD SA keeps working — SAs already installed are not renegotiated just because configuration changed. Later, users at Site A report they can no longer reach Site B, while the gateways' monitoring shows the peer as up.`,
    run: (s) => ({ state: { ...idle(s), gwbRemote: VPN.badSiteA, faultActive: true, hops: [...s.hops, hopOf("incident-intro", "GW-B", { active: "spd", details: { spd: `local ${VPN.siteB} · remote ${VPN.badSiteA}` }, lookupType: "GW-B IPsec configuration", key: "policy edit", result: `remote Site-A selector: ${VPN.badSiteA}`, action: "CONFIG CHANGED", reason: "A configuration edit on GW-B's traffic selectors. Nothing re-negotiates yet.", input: "configuration", output: "saved" })] }, events: [ev("STEP_ENTERED", "incident-intro", "GW-B policy edited")] }),
    whatChanged: () => [`GW-B remote Site-A selector: ${VPN.badSiteA}`, "Current CHILD SA unchanged (still installed)"],
  },
  {
    id: "child-delete",
    label: "The CHILD SA is deleted",
    narrative: `The CHILD SA reaches its lifetime. GW-A deletes it with an INFORMATIONAL exchange (Exchange Type 37, Message ID 2), a Delete payload naming its inbound SPI ${spiText(CHILD_SPIS.first.ba)} — inside SK. The IKE SA is not touched.`,
    run: (s) => ({ state: ikeSend(s, "child-delete", "GW-A", deleteMsg(false, CHILD_SPIS.first.ba), 0x5a20, { action: "INFORMATIONAL · DELETE →", reason: "Deleting a CHILD SA is itself an IKE exchange, protected by the IKE SA. Only the ESP SA pair goes away.", key: "CHILD SA lifetime", result: "Delete sent", patch: { ike: { ...s.ike, lastExchange: "INFORMATIONAL (37) request", lastMsgId: 2 } } }), events: [ev("PACKET_SENT", "child-delete", "Delete")] }),
    packet: pkt,
  },
  {
    id: "child-delete-rx",
    label: "Both sides drop the CHILD SA",
    narrative: `GW-B removes the pair and answers with its own Delete (for its inbound SPI ${spiText(CHILD_SPIS.first.ab)}) in the INFORMATIONAL response. Result: IKE SA ESTABLISHED, no CHILD SA. The next protected packet will need a new one.`,
    run: (s) => ({ state: ikeReceive(s, "child-delete-rx", "GW-B", deleteMsg(false, CHILD_SPIS.first.ba), 0x5a20, { active: "sa", details: { sa: `delete ${spiText(CHILD_SPIS.first.ab)} / ${spiText(CHILD_SPIS.first.ba)}`, ike: "IKE SA unchanged · INFORMATIONAL response with Delete" }, action: "CHILD SA DELETED", reason: "The control channel (IKE SA) is still healthy; only the data SAs were removed.", key: "INFORMATIONAL Delete", result: "CHILD SA removed · IKE SA ESTABLISHED", patch: { child: undefined, childStatus: "NONE", ike: { ...s.ike, lastExchange: "INFORMATIONAL (37) response", lastMsgId: 2 } } }), events: [ev("PACKET_RECEIVED", "child-delete-rx", "CHILD SA deleted")] }),
    packet: pkt,
    whatChanged: (_p, n) => [ikeLine(n), childLine(n)],
  },
  {
    id: "inc-ping",
    label: "HOST-A pings again",
    narrative: `Echo Request seq 4 to ${VPN.hostB}. GW-A's policy says this traffic must be protected, but there is no CHILD SA — so GW-A holds the packet (it must not send it in the clear) and starts CREATE_CHILD_SA.`,
    run: (s) => ({ state: hostAPing(s, "inc-ping", 4), events: [ev("PACKET_SENT", "inc-ping", "Ping 4")] }),
    packet: pkt,
  },
  {
    id: "inc-ccsa-req",
    label: "CREATE_CHILD_SA request",
    narrative: `GW-A → GW-B: Exchange Type 36, Message ID 3, encrypted under the existing IKE SA. Teaching view: SA with GW-A's new inbound SPI ${spiText(CHILD_SPIS.failed.ba)}, a fresh Ni, TSi ${VPN.siteA}, TSr ${VPN.siteB}.`,
    run: (s) => ({ state: ikeSend(s, "inc-ccsa-req", "GW-A", createChildMsg(3, CHILD_SPIS.failed.ba), 0x5a21, { action: "CREATE_CHILD_SA →", reason: "A new CHILD SA for the same subnet pair, negotiated through the IKE SA that is still up. No new IKE_SA_INIT or IKE_AUTH is needed.", key: `${VPN.siteA} ↔ ${VPN.siteB}`, result: "request sent", patch: { childStatus: "NEGOTIATING", pending: { spiBA: CHILD_SPIS.failed.ba, msgId: 3 }, ike: { ...s.ike, lastExchange: "CREATE_CHILD_SA (36) request", lastMsgId: 3 } } }), events: [ev("PACKET_SENT", "inc-ccsa-req", "CREATE_CHILD_SA")] }),
    packet: pkt,
  },
  {
    id: "inc-ccsa-rx",
    label: "GW-B checks the selectors",
    narrative: `GW-B decrypts the request with the IKE SA keys — the IKE SA is fine. Then it compares the requested TSi ${VPN.siteA} with its configured remote selector ${VPN.badSiteA}: no overlap, nothing it could narrow to. It cannot accept this selector pair.`,
    run: (s) => ({ state: ikeReceive(s, "inc-ccsa-rx", "GW-B", createChildMsg(3, CHILD_SPIS.failed.ba), 0x5a21, { active: "spd", details: { ike: "SK decrypted with the IKE SA keys — IKE SA healthy", spd: `TSi ${VPN.siteA} vs remote ${s.gwbRemote} → ${gwbAccepts(s, VPN.siteA, VPN.siteB) ? "accept" : "no overlap → reject"}` }, action: "SELECTORS REJECTED", reason: "Traffic selectors must fit the responder's policy. GW-B's policy for this peer only covers 10.10.20.0/24 on the Site-A side, so it has no policy under which to protect 10.10.10.0/24.", key: `TSi ${VPN.siteA} · TSr ${VPN.siteB}`, result: "TS_UNACCEPTABLE" }), events: [ev("PACKET_RECEIVED", "inc-ccsa-rx", "TS rejected")] }),
    packet: pkt,
  },
  {
    id: "inc-ts-resp",
    label: "TS_UNACCEPTABLE",
    narrative: `GW-B → GW-A: CREATE_CHILD_SA response, Message ID 3, carrying Notify type ${NOTIFY_TS_UNACCEPTABLE} (TS_UNACCEPTABLE) — inside SK, so the Internet sees only an encrypted IKE message on UDP/500. No CHILD SA is created.`,
    run: (s) => ({ state: ikeSend(s, "inc-ts-resp", "GW-B", tsUnacceptableMsg(3), 0x6b21, { action: "NOTIFY TS_UNACCEPTABLE ←", reason: "An error notification about the requested selectors — not about identity, reachability or keys.", key: "CREATE_CHILD_SA response", result: `Notify ${NOTIFY_TS_UNACCEPTABLE} sent`, patch: { lastNotify: `TS_UNACCEPTABLE (${NOTIFY_TS_UNACCEPTABLE})`, ike: { ...s.ike, lastExchange: "CREATE_CHILD_SA (36) response", lastMsgId: 3 } } }), events: [ev("PACKET_SENT", "inc-ts-resp", "TS_UNACCEPTABLE")] }),
    packet: pkt,
  },
  {
    id: "inc-ts-rx",
    label: "No CHILD SA — traffic can't flow",
    narrative: `GW-A receives TS_UNACCEPTABLE. IKE SA: ESTABLISHED. Peer authentication: valid. Public reachability: fine — the exchange just crossed the Internet both ways. CHILD SA for ${VPN.siteA} ↔ ${VPN.siteB}: not established. HOST-A's ping is dropped at GW-A rather than sent unprotected.`,
    run: (s) => ({ state: ikeReceive(s, "inc-ts-rx", "GW-A", tsUnacceptableMsg(3), 0x6b21, { active: "sa", details: { ike: "response decrypted · IKE SA still ESTABLISHED", sa: "no CHILD SA for 10.10.10.0/24 ↔ 10.20.20.0/24 → queued ping dropped" }, action: "CHILD SA FAILED", reason: "The peer is reachable and authenticated — it simply refused the traffic selectors. Protected traffic has no SA to use, and policy forbids sending it in cleartext.", key: `Notify ${NOTIFY_TS_UNACCEPTABLE}`, result: "CHILD SA not established · ping 4 dropped", patch: { childStatus: "FAILED — TS_UNACCEPTABLE", pending: undefined, hostA: { ...s.hostA, lastResult: "seq 4: no reply (dropped at GW-A — no CHILD SA)" } } }), events: [ev("PACKET_RECEIVED", "inc-ts-rx", "No CHILD SA")] }),
    packet: pkt,
    whatChanged: (_p, n) => [ikeLine(n), childLine(n), `HOST-A: ${n.hostA.lastResult}`],
  },
  {
    id: "predict-ts",
    label: "Diagnose: TS_UNACCEPTABLE",
    narrative: "GW-A logged Notify 38 in the CREATE_CHILD_SA response.",
    question: {
      prompt: "What does TS_UNACCEPTABLE indicate?",
      options: [
        { id: "ts", label: "The responder's policy can't accept the requested traffic selectors — which subnets to protect don't match its configuration" },
        { id: "auth", label: "The pre-shared key is wrong" },
        { id: "down", label: "The peer gateway is unreachable" },
        { id: "crypto", label: "No common encryption algorithm" },
      ],
      correctOptionId: "ts",
      explanation: "TS_UNACCEPTABLE is about WHAT to protect. A wrong key would fail authentication, an unreachable peer would never answer, and an algorithm mismatch produces NO_PROPOSAL_CHOSEN — all different symptoms.",
    },
  },
  {
    id: "predict-ike-healthy",
    label: "Diagnose: IKE SA vs CHILD SA",
    narrative: "Monitoring says \"peer up\", users say \"VPN down\".",
    question: {
      prompt: "Can the IKE SA stay healthy while the needed CHILD SA is missing?",
      options: [
        { id: "yes", label: "Yes — they are separate SAs; the control channel is up while no data SA covers these subnets" },
        { id: "no", label: "No — if the CHILD SA fails, the IKE SA must be down too" },
        { id: "rekey", label: "Only during a rekey" },
        { id: "reverse", label: "No — a missing CHILD SA always means the peer is unreachable" },
      ],
      correctOptionId: "yes",
      explanation: "Exactly this incident: IKE works, CREATE_CHILD_SA is answered, authentication holds — and still no host traffic flows. Always check both SA types.",
    },
  },
  {
    id: "diagnostic-layers",
    label: "Troubleshooting layers",
    narrative: "Check each layer separately: public reachability, IKE SA, authentication, traffic selectors, CHILD SA, ESP data.",
  },
  {
    id: "repair-challenge",
    label: "Repair the tunnel",
    narrative: "Choose the change that fixes the cause you identified.",
    action: (s, payload) => ({ state: applyVpnRepair(s, (payload as { choice: string }).choice), events: [ev("STEP_ENTERED", "repair-challenge", `Repair attempt: ${(payload as { choice: string }).choice}`)] }),
    requiresState: (s) => s.repaired,
  },
  {
    id: "ver-ccsa-req",
    label: "Verify: new CREATE_CHILD_SA",
    narrative: `HOST-A's traffic triggers another CREATE_CHILD_SA: Message ID 4, GW-A's inbound SPI ${spiText(CHILD_SPIS.repaired.ba)}, TSi ${VPN.siteA}, TSr ${VPN.siteB}.`,
    run: (s) => ({ state: ikeSend(s, "ver-ccsa-req", "GW-A", createChildMsg(4, CHILD_SPIS.repaired.ba), 0x5a22, { action: "CREATE_CHILD_SA →", reason: "Same request as before, same IKE SA.", key: `${VPN.siteA} ↔ ${VPN.siteB}`, result: "request sent", patch: { childStatus: "NEGOTIATING", pending: { spiBA: CHILD_SPIS.repaired.ba, msgId: 4 }, lastNotify: undefined, ike: { ...s.ike, lastExchange: "CREATE_CHILD_SA (36) request", lastMsgId: 4 } } }), events: [ev("PACKET_SENT", "ver-ccsa-req", "CREATE_CHILD_SA")] }),
    packet: pkt,
  },
  {
    id: "ver-ccsa-rx",
    label: "Verify: selectors accepted",
    narrative: `GW-B's remote selector is ${VPN.siteA} again, so TSi ${VPN.siteA} and TSr ${VPN.siteB} fit its policy. It allocates inbound SPI ${spiText(CHILD_SPIS.repaired.ab)}.`,
    run: (s) => ({ state: ikeReceive(s, "ver-ccsa-rx", "GW-B", createChildMsg(4, CHILD_SPIS.repaired.ba), 0x5a22, { active: "spd", details: { spd: `TSi ${VPN.siteA} within remote ${s.gwbRemote} → accept`, sa: `inbound SPI ${spiText(CHILD_SPIS.repaired.ab)} allocated` }, action: "SELECTORS ACCEPTED", reason: "The selector pair now fits GW-B's policy.", key: `TSi ${VPN.siteA} · TSr ${VPN.siteB}`, result: "CHILD SA accepted" }), events: [ev("PACKET_RECEIVED", "ver-ccsa-rx", "TS accepted")] }),
    packet: pkt,
  },
  {
    id: "ver-ccsa-resp",
    label: "Verify: CREATE_CHILD_SA response",
    narrative: `GW-B → GW-A: Message ID 4, Response, SA with SPI ${spiText(CHILD_SPIS.repaired.ab)}, Nr, TSi, TSr — inside SK.`,
    run: (s) => ({ state: ikeSend(s, "ver-ccsa-resp", "GW-B", createChildRespMsg(4, CHILD_SPIS.repaired.ab), 0x6b22, { action: "CREATE_CHILD_SA ←", reason: "The other half of the new CHILD SA.", key: "CREATE_CHILD_SA response", result: "sent" }), events: [ev("PACKET_SENT", "ver-ccsa-resp", "Response")] }),
    packet: pkt,
  },
  {
    id: "ver-ccsa-done",
    label: "Verify: new CHILD SA installed",
    narrative: `GW-A installs the new pair: A→B ${spiText(CHILD_SPIS.repaired.ab)}, B→A ${spiText(CHILD_SPIS.repaired.ba)}. Fresh keys from SK_d and the new nonces; both sequence counters start again at 1.`,
    run: (s) => ({ state: ikeReceive(s, "ver-ccsa-done", "GW-A", createChildRespMsg(4, CHILD_SPIS.repaired.ab), 0x6b22, { active: "sa", details: { sa: `out ${spiText(CHILD_SPIS.repaired.ab)} · in ${spiText(CHILD_SPIS.repaired.ba)} · seq reset to 1` }, action: "CHILD SA INSTALLED", reason: "A new CHILD SA under the same IKE SA.", key: "CREATE_CHILD_SA response", result: "CHILD SA installed", patch: { child: repairedChild(), childStatus: "INSTALLED", pending: undefined, ike: { ...s.ike, lastExchange: "CREATE_CHILD_SA (36) response", lastMsgId: 4 } } }), events: [ev("PACKET_RECEIVED", "ver-ccsa-done", "Installed")] }),
    packet: pkt,
    whatChanged: (_p, n) => [ikeLine(n), childLine(n)],
  },
  {
    id: "ver-esp",
    label: "Verify: ESP flows again",
    narrative: `HOST-A's ping seq 5 is encrypted on the new SA: SPI ${spiText(CHILD_SPIS.repaired.ab)}, ESP sequence 1 — the ICMP sequence (5) and the ESP sequence (1) are independent counters.`,
    run: (s) => {
      const sent = hostAPing(s, "ver-esp", 5);
      const enc = encrypt(sent, "ver-esp", "GW-A", pingInner(5), 0x5a30);
      return { state: enc, events: [ev("PACKET_SENT", "ver-esp", "ESP seq 1 (new SA)")] };
    },
    packet: pkt,
  },
  {
    id: "ver-esp-rx",
    label: "Verify: HOST-B receives",
    narrative: "GW-B decrypts with its new inbound SA and delivers the inner packet to HOST-B.",
    run: (s) => {
      const dec = decrypt(s, "ver-esp-rx", "GW-B", pingInner(5), 0x5a30, 1);
      const del = deliver(dec, "ver-esp-rx", "GW-B", pingInner(5));
      return { state: { ...del, packet: dec.packet, decision: dec.decision }, events: [ev("PACKET_RECEIVED", "ver-esp-rx", "Delivered")] };
    },
    packet: pkt,
  },
  {
    id: "ver-reply",
    label: "Verify: the reply returns",
    narrative: `HOST-B replies; GW-B encrypts on SPI ${spiText(CHILD_SPIS.repaired.ba)} seq 1; GW-A decrypts and HOST-A gets its answer. Site A ↔ Site B works again — through IPsec, not around it.`,
    run: (s) => {
      const enc = encrypt(s, "ver-reply", "GW-B", pingInner(5, true), 0x6b30);
      const dec = decrypt(enc, "ver-reply", "GW-A", pingInner(5, true), 0x6b30, 1);
      const del = deliver(dec, "ver-reply", "GW-A", pingInner(5, true));
      return { state: { ...del, packet: dec.packet, decision: dec.decision }, events: [ev("PACKET_RECEIVED", "ver-reply", "Ping OK")] };
    },
    packet: pkt,
    whatChanged: (_p, n) => [`HOST-A: ${n.hostA.lastResult}`, childLine(n)],
  },
  {
    id: "implementation",
    label: "Policy-based and route-based VPNs",
    narrative: "This lesson matched traffic by the negotiated selectors directly (policy-based style). Many platforms instead route traffic into a tunnel interface and negotiate broad selectors (route-based style). Either way the same IKEv2 exchanges, the same distinction between IKE SA and CHILD SA, and the same ESP packet apply — vendors' names for selectors (such as \"proxy IDs\" or \"encryption domains\") are just names for TSi/TSr.",
    run: (s) => ({ state: idle(s), events: [] }),
  },
  {
    id: "complete",
    label: "Lesson complete",
    narrative: "IKE_SA_INIT for keys, IKE_AUTH for identity and the first CHILD SA, directional ESP SAs in tunnel mode, sequence numbers for anti-replay — and a tunnel that was \"up\" at the IKE level while traffic selectors kept every host packet out.",
  },
];
