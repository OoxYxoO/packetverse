import type { LabModel } from "@/lib/practice-lab/types";
import { DH_ADDR, DH_MAC, DNS_NAME, DNS_RECORD_TTL, LEASE_SECONDS, MASK, CLIENT_DNS_PORT, XID1 } from "./dhcpDns";

/**
 * DHCP + DNS LAB — the client's life on the DHCP/DNS lesson network, observable from every interface:
 *
 *   CLIENT eth0 ─ ge-0/0/1 SW1 ge-0/0/24 ─ ge-0/0/0 R1 ge-0/0/1 ─ ge-0/0/24 SW2 ge-0/0/1 ─ eth0 DHCP-SRV
 *                                                     │ ge-0/0/2 (upstream)         ge-0/0/2 ─ eth0 DNS-SRV
 *                                                     └─ internet / web servers
 *
 * ONE source of truth. Every packet the lab creates records, per device, which interface it came in on, which it
 * left on and what that device did with it (`hops`), and, per interface, the frame exactly as it crossed that
 * interface (`obs`: MACs and TTL rewritten per link). Captures, interface counters, MAC tables, relay counters, ARP
 * tables, server logs and CLI output are all derived from this; nothing is drawn independently.
 *
 * Semantics (RFC 2131/2132, RFC 1542 relay, RFC 826 ARP, RFC 1122/792 ICMP, RFC 1035/2308 DNS):
 *   - DISCOVER/REQUEST (SELECTING, REBINDING) are broadcasts; routers don't forward them. Only a relay (ip helper)
 *     carries them to the server as a new unicast, setting giaddr and hops; the server picks the pool from giaddr and
 *     replies to the relay, which broadcasts to the client (the client set the BROADCAST flag).
 *   - Switches learn source MACs per port and flood broadcasts; they never look inside IP/UDP/DHCP.
 *   - Before sending off-subnet, a host needs its gateway's MAC (ARP). A router needs the next hop's MAC (ARP) before
 *     it can forward. No ARP reply → the packet is never transmitted on the next link.
 *   - A host that is up but has no service on a UDP port answers ICMP port unreachable (3/3). A stopped DHCP or DNS
 *     service is "host up, service down": pings work, the service doesn't.
 *   - The ACK carries the server's CURRENT options; an existing lease isn't rewritten until the client renews.
 *     T1 = 50 % → unicast REQUEST to the server (routed, not relayed). T2 = 87.5 % → broadcast (relayed).
 *     A manual renew tries the unicast first and falls back to a broadcast REQUEST if that gets no answer.
 *   - With no DHCP answer, many operating systems self-assign 169.254.0.0/16 (no gateway, no DNS); varies by OS.
 *   - DNS: the stub resolver checks its cache (valid for the record TTL), otherwise sends a UDP query to the DNS
 *     server from the lease. Missing name → NXDOMAIN (RCODE 3). Port unreachable → "connection refused". Silence →
 *     timeout.
 * Interface counters start at zero when the lab starts (as after "clear counters"). Nothing here touches the guided
 * lesson or progress.
 */

export type DlNode = "CLIENT" | "SW1" | "R1" | "SW2" | "DHCP-SRV" | "DNS-SRV" | "WEB";
export type DlPhase = "INIT" | "SELECTING" | "REQUESTING" | "BOUND" | "RENEWING" | "REBINDING" | "APIPA";
export const DL_T1 = LEASE_SECONDS * 0.5;
export const DL_T2 = LEASE_SECONDS * 0.875;
export const DL_APIPA = "169.254.83.17";
export const DL_WRONG = { dns: DH_ADDR.WRONG_DNS, gw: "10.10.10.254" } as const;
export const DL_WEB_OLD = DH_ADDR.WEB;
export const DL_WEB_NEW = "203.0.113.81";
export const DL_MAIL = "203.0.113.25";
const C = DH_ADDR.CLIENT;
const DL_DEFAULT_C: string = DH_ADDR.CLIENT;
const SRV = DH_ADDR["DHCP-SRV"];
const DNS = DH_ADDR["DNS-SRV"];
const RC = DH_ADDR["R1:CLIENT"];
const RS = DH_ADDR["R1:SERVER"];
export const BC = "FF:FF:FF:FF:FF:FF";
const MAC = {
  CLIENT: DH_MAC.CLIENT,
  R1C: DH_MAC["R1:CLIENT"],
  R1S: DH_MAC["R1:SERVER"],
  R1U: "00:00:5E:00:53:35",
  SRV: DH_MAC["DHCP-SRV"],
  DNS: DH_MAC["DNS-SRV"],
  ISP: "00:00:5E:00:53:40",
} as const;
export const DL_MAC = MAC;
const MAC_OWNER: Record<string, string> = { [MAC.CLIENT]: "CLIENT", [MAC.R1C]: "R1 ge-0/0/0", [MAC.R1S]: "R1 ge-0/0/1", [MAC.R1U]: "R1 ge-0/0/2", [MAC.SRV]: "DHCP-SRV", [MAC.DNS]: "DNS-SRV", [MAC.ISP]: "upstream router" };
/** "00:00:5E:00:53:33 (DHCP-SRV)". */
export const macLabel = (m: string) => (m === BC ? "broadcast" : MAC_OWNER[m] ? `${m} (${MAC_OWNER[m]})` : m);

// ---------------------------------------------------------------------------------------------------------------
// Topology: interfaces and links
// ---------------------------------------------------------------------------------------------------------------
export type DlIface = "CLIENT:eth0" | "SW1:ge-0/0/1" | "SW1:ge-0/0/24" | "R1:ge-0/0/0" | "R1:ge-0/0/1" | "R1:ge-0/0/2" | "SW2:ge-0/0/24" | "SW2:ge-0/0/1" | "SW2:ge-0/0/2" | "DHCP-SRV:eth0" | "DNS-SRV:eth0" | "WEB:eth0";
export type DlSeg = "client" | "server" | "upstream";
export interface DlIfaceInfo {
  node: DlNode;
  name: string;
  /** Cisco-style name, for the CLI. */
  cisco: string;
  peer: DlIface;
  seg: DlSeg;
  mac?: string;
  ip?: string;
  /** What the interface faces, in plain words. */
  faces: string;
}
export const DL_IFACES: Record<DlIface, DlIfaceInfo> = {
  "CLIENT:eth0": { node: "CLIENT", name: "Ethernet", cisco: "Ethernet", peer: "SW1:ge-0/0/1", seg: "client", mac: MAC.CLIENT, faces: "SW1 (client LAN)" },
  "SW1:ge-0/0/1": { node: "SW1", name: "ge-0/0/1", cisco: "Gi1/0/1", peer: "CLIENT:eth0", seg: "client", faces: "CLIENT" },
  "SW1:ge-0/0/24": { node: "SW1", name: "ge-0/0/24", cisco: "Gi1/0/24", peer: "R1:ge-0/0/0", seg: "client", faces: "R1 (uplink)" },
  "R1:ge-0/0/0": { node: "R1", name: "ge-0/0/0", cisco: "Gi0/0", peer: "SW1:ge-0/0/24", seg: "client", mac: MAC.R1C, ip: RC, faces: "client LAN 10.10.10.0/24" },
  "R1:ge-0/0/1": { node: "R1", name: "ge-0/0/1", cisco: "Gi0/1", peer: "SW2:ge-0/0/24", seg: "server", mac: MAC.R1S, ip: RS, faces: "server LAN 10.20.20.0/24" },
  "R1:ge-0/0/2": { node: "R1", name: "ge-0/0/2", cisco: "Gi0/2", peer: "WEB:eth0", seg: "upstream", mac: MAC.R1U, ip: "198.51.100.2", faces: "upstream (internet)" },
  "SW2:ge-0/0/24": { node: "SW2", name: "ge-0/0/24", cisco: "Gi1/0/24", peer: "R1:ge-0/0/1", seg: "server", faces: "R1 (uplink)" },
  "SW2:ge-0/0/1": { node: "SW2", name: "ge-0/0/1", cisco: "Gi1/0/1", peer: "DHCP-SRV:eth0", seg: "server", faces: "DHCP-SRV" },
  "SW2:ge-0/0/2": { node: "SW2", name: "ge-0/0/2", cisco: "Gi1/0/2", peer: "DNS-SRV:eth0", seg: "server", faces: "DNS-SRV" },
  "DHCP-SRV:eth0": { node: "DHCP-SRV", name: "eth0", cisco: "eth0", peer: "SW2:ge-0/0/1", seg: "server", mac: MAC.SRV, ip: SRV, faces: "SW2 (server LAN)" },
  "DNS-SRV:eth0": { node: "DNS-SRV", name: "eth0", cisco: "eth0", peer: "SW2:ge-0/0/2", seg: "server", mac: MAC.DNS, ip: DNS, faces: "SW2 (server LAN)" },
  "WEB:eth0": { node: "WEB", name: "upstream", cisco: "upstream", peer: "R1:ge-0/0/2", seg: "upstream", mac: MAC.ISP, faces: "R1" },
};
export const DL_NODE_IFACES: Record<DlNode, DlIface[]> = {
  CLIENT: ["CLIENT:eth0"],
  SW1: ["SW1:ge-0/0/1", "SW1:ge-0/0/24"],
  R1: ["R1:ge-0/0/0", "R1:ge-0/0/1", "R1:ge-0/0/2"],
  SW2: ["SW2:ge-0/0/24", "SW2:ge-0/0/1", "SW2:ge-0/0/2"],
  "DHCP-SRV": ["DHCP-SRV:eth0"],
  "DNS-SRV": ["DNS-SRV:eth0"],
  WEB: ["WEB:eth0"],
};
const isSwitch = (n: DlNode) => n === "SW1" || n === "SW2";
function linkBetween(a: DlNode, b: DlNode): [DlIface, DlIface] {
  for (const i of DL_NODE_IFACES[a]) if (DL_IFACES[DL_IFACES[i].peer].node === b) return [i, DL_IFACES[i].peer];
  throw new Error(`no link ${a}–${b}`);
}

// ---------------------------------------------------------------------------------------------------------------
// Packets: what each device did, and what each interface saw
// ---------------------------------------------------------------------------------------------------------------
export interface DlField {
  k: string;
  v: string;
  hi?: boolean;
}
export interface DlLayer {
  name: string;
  color: string;
  fields: DlField[];
}
/** What a device did with the packet. */
export type DlAct = "send" | "flood" | "forward" | "relay" | "route" | "deliver" | "drop" | "ignore" | "reject" | "unanswered";
export interface DlHop {
  node: DlNode;
  in?: DlIface;
  out: DlIface[];
  act: DlAct;
  text: string;
}
/** The frame as it crossed one interface. */
export interface DlObs {
  iface: DlIface;
  dir: "in" | "out";
  srcMac: string;
  dstMac: string;
  ttl?: number;
}
export type DlMsg = "DISCOVER" | "OFFER" | "REQUEST" | "ACK" | "RELEASE" | "DNS query" | "DNS response" | "ARP request" | "ARP reply" | "Echo request" | "Echo reply" | "Port unreachable";
export interface DlPacket {
  no: number;
  t: number;
  src: string;
  dst: string;
  proto: "DHCP" | "DNS" | "ICMP" | "ARP";
  msg: DlMsg;
  /** One logical message, possibly carried in several legs (a relayed DISCOVER is two packets, one journey). */
  journey: string;
  info: string;
  layers: DlLayer[];
  path: DlNode[];
  color: "amber" | "violet" | "green" | "cyan" | "red";
  hops: DlHop[];
  obs: DlObs[];
  /** Same as hops[].text, in order (kept for narration). */
  notes: string[];
  /** Set when the message did not achieve its purpose: why. */
  lost?: string;
}
export interface DlClient {
  phase: DlPhase;
  ip?: string;
  mask?: string;
  gw?: string;
  dns?: string;
  leaseStart?: number;
  lease?: number;
  serverId?: string;
  xid: number;
  offered?: string;
  retries: number;
}
export interface DlCacheEntry {
  name: string;
  ip: string;
  expires: number;
}
export interface DlConfig {
  option3: string;
  option6: string;
  /** Free addresses left in the pool. */
  poolFree: number;
  relay: boolean;
  /** DHCP service running on DHCP-SRV (the host itself stays up). */
  serverUp: boolean;
  /** DNS service running on DNS-SRV (the host itself stays up). */
  dnsUp: boolean;
  /** R1: where the relay agent sends client broadcasts (ip helper-address), and the interface it is configured on. */
  helper: string;
  helperIf: "ge-0/0/0" | "ge-0/0/1";
  /** DHCP-SRV: the scope for the clients' network (a /24), or null when none is declared. */
  scope: { net: string; start: string; end: string } | null;
  /** A dhcpd.conf error found when the service (re)started: it refuses to run. */
  dhcpError?: string;
}
export type DlTicketId = "no-relay" | "dns-option" | "pool" | "stale-cache" | "gateway" | "dns-service";
export type DlCause = "no-relay" | "wrong-option6" | "pool-exhausted" | "stale-cache" | "wrong-option3" | "dns-server-down" | "dhcp-server-down" | "cable";
export interface DlLog {
  id: number;
  text: string;
  kind: "info" | "learn" | "warning";
}
export interface DlCounters {
  inPkts: number;
  outPkts: number;
  inBcast: number;
  outBcast: number;
}
/** Device state an engineer can read: tables, counters, logs. Derived from the packets, plus ARP decisions. */
export interface DlNet {
  /** ARP caches: IP → MAC, or "incomplete" (asked, never answered). */
  arp: { CLIENT: Record<string, string>; R1: Record<string, string> };
  /** Switch MAC tables: MAC → port. */
  mac: { SW1: Record<string, string>; SW2: Record<string, string> };
  counters: Record<DlIface, DlCounters>;
  /** R1's DHCP relay agent counters. */
  relay: { fromClients: number; toServer: number; fromServer: number; toClients: number; byType: Record<string, number> };
  logs: { "DHCP-SRV": { t: number; text: string }[]; "DNS-SRV": { t: number; text: string }[] };
  /** DHCP-SRV lease database. */
  leases: { ip: string; mac: string; ends: number; state: "active" | "free" }[];
}
export interface DlState {
  seq: number;
  clock: number;
  client: DlClient;
  config: DlConfig;
  records: Record<string, string>;
  cache: DlCacheEntry[];
  capture: DlPacket[];
  /** Packets produced by the most recent action (for animation). */
  lastPackets: number[];
  lastResult?: { kind: "resolve" | "ping"; ok: boolean; text: string };
  ticket?: { id: DlTicketId; diagnosed?: DlCause; at?: DlNode; wrong?: DlCause; wrongAt?: DlNode; solved: boolean };
  /** The web server moved to its new address (the old one is switched off). */
  webMoved?: boolean;
  net: DlNet;
  log: DlLog[];
}

export const DL_HEALTHY_CONFIG: DlConfig = { option3: RC, option6: DNS, poolFree: 100, relay: true, serverUp: true, dnsUp: true, helper: SRV, helperIf: "ge-0/0/0", scope: { net: "10.10.10.0", start: "10.10.10.50", end: "10.10.10.150" } };
/** The build network (level 7): nothing configured yet on DHCP-SRV, R1 or DNS-SRV. */
export const DL_BUILD_CONFIG: DlConfig = { option3: "", option6: "", poolFree: 0, relay: false, serverUp: false, dnsUp: true, helper: "", helperIf: "ge-0/0/0", scope: null };

// ---------------------------------------------------------------------------------------------------------------
// Configuration semantics (shared by the model, the CLI and the build checks)
// ---------------------------------------------------------------------------------------------------------------
export const isIp = (a: string) => /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/.test(a.trim());
export const ipNum = (a: string) => a.split(".").reduce((n, o) => n * 256 + Number(o), 0);
export const numIp = (n: number) => [24, 16, 8, 0].map((sh) => Math.floor(n / 2 ** sh) % 256).join(".");
export const in24 = (a: string, net: string) => isIp(a) && isIp(net) && a.split(".").slice(0, 3).join(".") === net.split(".").slice(0, 3).join(".");
/** The relay only acts on broadcasts arriving on the interface it is configured on: the clients' side. */
export const relayOn = (cfg: DlConfig) => cfg.relay && cfg.helperIf === "ge-0/0/0" && isIp(cfg.helper);
/** A scope error that stops dhcpd from starting, if any. */
export function dhcpProblem(cfg: DlConfig): string | undefined {
  if (cfg.dhcpError) return cfg.dhcpError;
  const sc = cfg.scope;
  if (!sc) return undefined;
  for (const [k, v] of [["subnet", sc.net], ["range start", sc.start], ["range end", sc.end], ...(cfg.option3 ? [["option routers", cfg.option3]] : []), ...(cfg.option6 ? [["option domain-name-servers", cfg.option6]] : [])] as [string, string][]) if (!isIp(v)) return `${k} “${v}” is not a valid IPv4 address`;
  if (sc.net.split(".")[3] !== "0") return `subnet ${sc.net} with netmask 255.255.255.0 must end in .0 (did you mean ${sc.net.split(".").slice(0, 3).join(".")}.0?)`;
  if (!in24(sc.start, sc.net) || !in24(sc.end, sc.net)) return `range ${sc.start} – ${sc.end} is not inside subnet ${sc.net}/24`;
  if (ipNum(sc.start) > ipNum(sc.end)) return `range start ${sc.start} is after range end ${sc.end}`;
  return undefined;
}
export const dhcpRunning = (cfg: DlConfig) => cfg.serverUp && !dhcpProblem(cfg);
export const scopeSize = (cfg: DlConfig) => (cfg.scope && !dhcpProblem(cfg) ? ipNum(cfg.scope.end) - ipNum(cfg.scope.start) + 1 - (in24(RC, cfg.scope.net) && ipNum(RC) >= ipNum(cfg.scope.start) && ipNum(RC) <= ipNum(cfg.scope.end) ? 1 : 0) : 0);
/** Does the server have a scope for the network a relayed request came from (giaddr)? */
const scopeFor = (cfg: DlConfig, giaddr: string) => !!cfg.scope && in24(giaddr, cfg.scope.net);
/** The address the server offers: the client's existing lease if it is in the range, else the first free one (skipping the router). */
function offerAddr(s: DlState): string {
  const sc = s.config.scope!;
  const mine = s.net.leases.find((l) => l.mac === lmac(MAC.CLIENT) && l.state === "active" && in24(l.ip, sc.net) && ipNum(l.ip) >= ipNum(sc.start) && ipNum(l.ip) <= ipNum(sc.end));
  if (mine) return mine.ip;
  for (let n = ipNum(sc.start); n <= ipNum(sc.end); n++) {
    const a = numIp(n);
    if (a !== RC && !s.net.leases.some((l) => l.ip === a && l.state === "active")) return a;
  }
  return sc.start;
}
/** The client's current (or offered) address. */
const cip = (s: DlState) => s.client.ip ?? s.client.offered ?? C;
export const DL_RECORDS: Record<string, string> = { [DNS_NAME]: DL_WEB_OLD, "mail.packetverse.test": DL_MAIL };
const zero = (): DlCounters => ({ inPkts: 0, outPkts: 0, inBcast: 0, outBcast: 0 });
export const createDlNet = (): DlNet => ({
  // R1 already knows its server-LAN neighbors and the upstream router (learned before you started watching).
  arp: { CLIENT: {}, R1: { [SRV]: MAC.SRV, [DNS]: MAC.DNS } },
  mac: { SW1: { [MAC.R1C]: "ge-0/0/24" }, SW2: { [MAC.R1S]: "ge-0/0/24", [MAC.SRV]: "ge-0/0/1", [MAC.DNS]: "ge-0/0/2" } },
  counters: Object.fromEntries((Object.keys(DL_IFACES) as DlIface[]).map((i) => [i, zero()])) as Record<DlIface, DlCounters>,
  relay: { fromClients: 0, toServer: 0, fromServer: 0, toClients: 0, byType: {} },
  logs: { "DHCP-SRV": [], "DNS-SRV": [] },
  leases: [],
});
export const createDlState = (): DlState => ({
  seq: 0,
  clock: 0,
  client: { phase: "INIT", xid: XID1, retries: 0 },
  config: { ...DL_HEALTHY_CONFIG },
  records: { ...DL_RECORDS },
  cache: [],
  capture: [],
  lastPackets: [],
  net: createDlNet(),
  log: [{ id: 0, text: "CLIENT just plugged in: no IP address, no gateway, no DNS server. Start the DHCP exchange.", kind: "info" }],
});

// ---------------------------------------------------------------------------------------------------------------
// Packet builders
// ---------------------------------------------------------------------------------------------------------------
const hex = (n: number) => `0x${n.toString(16)}`;
const lmac = (m: string) => m.toLowerCase();
const eth = (src: string, dst: string): DlLayer => ({ name: "Ethernet", color: "#94a3b8", fields: [{ k: "Destination MAC", v: dst }, { k: "Source MAC", v: src }] });
const ip = (src: string, dst: string, proto = "17 (UDP)", ttl = 64): DlLayer => ({ name: "IPv4", color: "#a78bfa", fields: [{ k: "Source", v: src, hi: src === "0.0.0.0" }, { k: "Destination", v: dst, hi: dst === "255.255.255.255" }, { k: "TTL", v: String(ttl) }, { k: "Protocol", v: proto }] });
const udp = (sp: number, dp: number): DlLayer => ({ name: "UDP", color: "#22d3ee", fields: [{ k: "Source port", v: String(sp) }, { k: "Destination port", v: String(dp) }] });
type DhcpType = "DISCOVER" | "OFFER" | "REQUEST" | "ACK" | "NAK" | "RELEASE";
const TYPE_NUM: Record<DhcpType, number> = { DISCOVER: 1, OFFER: 2, REQUEST: 3, ACK: 5, NAK: 6, RELEASE: 7 };
function dhcp(type: DhcpType, x: { xid: number; ciaddr?: string; yiaddr?: string; giaddr?: string; hops?: number; bcast?: boolean; secs?: number; opts?: DlField[] }): DlLayer {
  return {
    name: `DHCP ${type}`,
    color: "#fbbf24",
    fields: [
      { k: "op", v: ["OFFER", "ACK", "NAK"].includes(type) ? "2 BOOTREPLY" : "1 BOOTREQUEST" },
      { k: "xid", v: hex(x.xid) },
      { k: "secs", v: String(x.secs ?? 0) },
      { k: "flags", v: x.bcast ? "BROADCAST" : "0" },
      { k: "hops", v: String(x.hops ?? 0), hi: !!x.hops },
      { k: "ciaddr", v: x.ciaddr ?? "0.0.0.0" },
      { k: "yiaddr", v: x.yiaddr ?? "0.0.0.0", hi: !!x.yiaddr },
      { k: "giaddr", v: x.giaddr ?? "0.0.0.0", hi: !!x.giaddr },
      { k: "chaddr", v: MAC.CLIENT },
      { k: "opt 53 message type", v: `${TYPE_NUM[type]} (${type})`, hi: true },
      ...(x.opts ?? []),
    ],
  };
}
const leaseOpts = (cfg: DlConfig, yi: string): DlField[] => [
  { k: "opt 54 server id", v: SRV },
  { k: "opt 51 lease", v: `${LEASE_SECONDS} s` },
  { k: "opt 1 mask", v: MASK },
  { k: "opt 3 router", v: cfg.option3, hi: true },
  { k: "opt 6 DNS", v: cfg.option6, hi: true },
  { k: "your address", v: yi },
];
const arpLayer = (op: "request" | "reply", sMac: string, sIp: string, tMac: string, tIp: string): DlLayer => ({
  name: `ARP ${op}`,
  color: "#f472b6",
  fields: [
    { k: "opcode", v: op === "request" ? "1 (request)" : "2 (reply)", hi: true },
    { k: "sender MAC", v: sMac },
    { k: "sender IP", v: sIp },
    { k: "target MAC", v: tMac },
    { k: "target IP", v: tIp, hi: true },
  ],
});
const icmpLayer = (type: number, code: number, what: string, extra: DlField[] = []): DlLayer => ({ name: `ICMP ${what}`, color: "#38bdf8", fields: [{ k: "type", v: String(type), hi: true }, { k: "code", v: String(code), hi: true }, ...extra] });

type Frames = Partial<Record<DlSeg, { src: string; dst: string }>>;
interface Leg {
  path: DlNode[];
  frames: Frames;
  ttl?: number;
  end: { act: DlAct; text: string };
  texts?: Partial<Record<DlNode, string>>;
  /** What a host that only received a flooded copy does with it. */
  flooded?: (node: DlNode) => { act: DlAct; text: string };
}
/** Walk a leg through the topology: per-device actions and per-interface frames, from one description. */
function travel(leg: Leg): { hops: DlHop[]; obs: DlObs[] } {
  const hops: DlHop[] = [];
  const obs: DlObs[] = [];
  let ttl = leg.ttl;
  const see = (iface: DlIface, dir: "in" | "out") => {
    const f = leg.frames[DL_IFACES[iface].seg];
    if (!f) throw new Error(`no frame for ${iface}`);
    obs.push({ iface, dir, srcMac: f.src, dstMac: f.dst, ttl });
  };
  const p = leg.path;
  for (let i = 0; i < p.length; i++) {
    const node = p[i];
    const inIf = i > 0 ? linkBetween(p[i - 1], node)[1] : undefined;
    const next = p[i + 1];
    if (inIf) see(inIf, "in");
    if (isSwitch(node)) {
      const f = leg.frames[DL_IFACES[inIf!].seg]!;
      const bcast = f.dst === BC;
      const towardNext = next ? linkBetween(node, next)[0] : undefined;
      const outs = bcast ? DL_NODE_IFACES[node].filter((x) => x !== inIf) : towardNext ? [towardNext] : [];
      const learned = f.src !== BC ? `learns ${macLabel(f.src)} on ${DL_IFACES[inIf!].name}; ` : "";
      hops.push({
        node,
        in: inIf,
        out: outs,
        act: bcast ? "flood" : "forward",
        text: leg.texts?.[node] ?? (bcast ? `${node} ${learned}the destination is broadcast, so it floods the frame out every other port (${outs.map((o) => DL_IFACES[o].name).join(", ")}). It never looks inside the IP packet.` : `${node} ${learned}looks up ${macLabel(f.dst)} in its MAC table and forwards out ${outs.map((o) => DL_IFACES[o].name).join(", ")} only.`),
      });
      for (const o of outs) {
        see(o, "out");
        const peer = DL_IFACES[o].peer;
        const peerNode = DL_IFACES[peer].node;
        if (peerNode !== next) {
          see(peer, "in");
          const r = leg.flooded?.(peerNode) ?? { act: "ignore" as DlAct, text: `${peerNode} receives a flooded copy; it isn't meant for this host, so it discards it.` };
          hops.push({ node: peerNode, in: peer, out: [], ...r });
        }
      }
      // the next node records its own arrival
      continue;
    }
    if (i === 0) {
      const out = linkBetween(node, next)[0];
      hops.push({ node, out: [out], act: "send", text: leg.texts?.[node] ?? `${node} sends it out ${DL_IFACES[out].name}.` });
      see(out, "out");
      continue;
    }
    if (i === p.length - 1) {
      hops.push({ node, in: inIf, out: [], ...leg.end });
      continue;
    }
    // a router in the middle of a leg routes it
    const out = linkBetween(node, next)[0];
    hops.push({ node, in: inIf, out: [out], act: "route", text: leg.texts?.[node] ?? `${node} routes it: in ${DL_IFACES[inIf!].name}, out ${DL_IFACES[out].name}. TTL ${ttl} → ${(ttl ?? 1) - 1}, new Ethernet header for the next link.` });
    if (ttl !== undefined) ttl -= 1;
    see(out, "out");
  }
  return { hops, obs };
}

type NewPacket = Omit<DlPacket, "no" | "t" | "hops" | "obs" | "notes"> & { leg: Leg };
function build(p: NewPacket): Omit<DlPacket, "no" | "t"> {
  const { leg, ...rest } = p;
  const { hops, obs } = travel(leg);
  return { ...rest, hops, obs, notes: hops.map((h) => h.text) };
}

// ---------------------------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------------------------
function addPackets(s: DlState, ps: Omit<DlPacket, "no" | "t">[]): DlState {
  let n = s.capture.length ? s.capture[s.capture.length - 1].no : 0;
  const added = ps.map((p) => ({ ...p, no: ++n, t: s.clock }));
  const net: DlNet = { ...s.net, counters: { ...s.net.counters }, mac: { SW1: { ...s.net.mac.SW1 }, SW2: { ...s.net.mac.SW2 } }, relay: { ...s.net.relay, byType: { ...s.net.relay.byType } } };
  for (const p of added) {
    for (const o of p.obs) {
      const c = { ...net.counters[o.iface] };
      const b = o.dstMac === BC ? 1 : 0;
      if (o.dir === "in") {
        c.inPkts++;
        c.inBcast += b;
      } else {
        c.outPkts++;
        c.outBcast += b;
      }
      net.counters[o.iface] = c;
      const nd = DL_IFACES[o.iface].node;
      if (o.dir === "in" && (nd === "SW1" || nd === "SW2") && o.srcMac !== BC) net.mac[nd][o.srcMac] = DL_IFACES[o.iface].name;
    }
    for (const h of p.hops)
      if (h.node === "R1" && h.act === "relay") {
        if (h.in === "R1:ge-0/0/0") {
          net.relay.fromClients++;
          net.relay.toServer++;
        } else {
          net.relay.fromServer++;
          net.relay.toClients++;
        }
        net.relay.byType[p.msg] = (net.relay.byType[p.msg] ?? 0) + 1;
      }
  }
  return { ...s, net, capture: [...s.capture, ...added].slice(-80), lastPackets: added.map((p) => p.no) };
}
function push(s: DlState, entries: Omit<DlLog, "id">[], patch: Partial<DlState> = {}): DlState {
  let id = s.log.length ? s.log[s.log.length - 1].id : 0;
  return { ...s, ...patch, seq: s.seq + 1, log: [...s.log, ...entries.map((e) => ({ ...e, id: ++id }))] };
}
function srvLog(s: DlState, who: "DHCP-SRV" | "DNS-SRV", ...lines: string[]): DlState {
  return { ...s, net: { ...s.net, logs: { ...s.net.logs, [who]: [...s.net.logs[who], ...lines.map((text) => ({ t: s.clock, text }))].slice(-40) } } };
}
function setArp(s: DlState, who: "CLIENT" | "R1", entries: Record<string, string>): DlState {
  return { ...s, net: { ...s.net, arp: { ...s.net.arp, [who]: { ...s.net.arp[who], ...entries } } } };
}
export const configured = (c: DlClient) => ["BOUND", "RENEWING", "REBINDING"].includes(c.phase) && !!c.ip;
export const leaseLeft = (s: DlState) => (s.client.leaseStart === undefined ? 0 : Math.max(0, s.client.leaseStart + (s.client.lease ?? 0) - s.clock));
const inClientLan = (a: string) => a.startsWith("10.10.10.");
const inServerLan = (a: string) => a.startsWith("10.20.20.");
const cmac = lmac(MAC.CLIENT);

// Frames per link for the usual journeys
const F = {
  clientBcast: { client: { src: MAC.CLIENT, dst: BC } },
  relayToSrv: { server: { src: MAC.R1S, dst: MAC.SRV } },
  srvToRelay: { server: { src: MAC.SRV, dst: MAC.R1S } },
  relayToClientBcast: { client: { src: MAC.R1C, dst: BC } },
  clientToServerLan: (dstMac: string): Frames => ({ client: { src: MAC.CLIENT, dst: MAC.R1C }, server: { src: MAC.R1S, dst: dstMac } }),
  serverLanToClient: (srcMac: string): Frames => ({ server: { src: srcMac, dst: MAC.R1S }, client: { src: MAC.R1C, dst: MAC.CLIENT } }),
  clientToUpstream: { client: { src: MAC.CLIENT, dst: MAC.R1C }, upstream: { src: MAC.R1U, dst: MAC.ISP } } as Frames,
  upstreamToClient: { upstream: { src: MAC.ISP, dst: MAC.R1U }, client: { src: MAC.R1C, dst: MAC.CLIENT } } as Frames,
};

// ---------------------------------------------------------------------------------------------------------------
// ARP: before a host or a router can send to an IP, it needs that next hop's MAC
// ---------------------------------------------------------------------------------------------------------------
/** The client resolves `target` (its gateway, or an on-link address). Returns the state and whether it got a MAC. */
function clientArp(s: DlState, target: string, j: string): { s: DlState; ok: boolean } {
  const C = cip(s);
  const known = s.net.arp.CLIENT[target];
  if (known && known !== "incomplete") return { s, ok: true };
  const owner = target === RC ? "R1" : undefined;
  const req = build({
    src: C, dst: target, proto: "ARP", msg: "ARP request", journey: `${j}:arp`, info: `ARP Who has ${target}? Tell ${C}`, color: "cyan",
    layers: [eth(MAC.CLIENT, BC), arpLayer("request", MAC.CLIENT, C, "00:00:00:00:00:00", target)], path: ["CLIENT", "SW1", "R1"],
    leg: {
      path: ["CLIENT", "SW1", "R1"], frames: F.clientBcast,
      texts: { CLIENT: `CLIENT needs the MAC address of ${target} before it can send anything to it, so it broadcasts an ARP request.` },
      end: owner ? { act: "deliver", text: `R1 owns ${target}: it records the client's MAC from the request and answers.` } : { act: "ignore", text: `R1 receives the broadcast, but ${target} is not one of its addresses, so it stays silent. Nobody on this LAN owns ${target}.` },
    },
    lost: owner ? undefined : `nobody owns ${target}: the ARP request gets no reply`,
  });
  if (!owner) {
    const s1 = addPackets(s, [req]);
    return { s: setArp(s1, "CLIENT", { [target]: "incomplete" }), ok: false };
  }
  const rep = build({
    src: RC, dst: C, proto: "ARP", msg: "ARP reply", journey: `${j}:arp-reply`, info: `ARP ${RC} is at ${MAC.R1C}`, color: "green",
    layers: [eth(MAC.R1C, MAC.CLIENT), arpLayer("reply", MAC.R1C, RC, MAC.CLIENT, C)], path: ["R1", "SW1", "CLIENT"],
    leg: { path: ["R1", "SW1", "CLIENT"], frames: { client: { src: MAC.R1C, dst: MAC.CLIENT } }, texts: { R1: `R1 answers with a unicast ARP reply: ${RC} is at ${MAC.R1C}.` }, end: { act: "deliver", text: `CLIENT stores ${RC} → ${MAC.R1C} in its ARP cache. Now it can build frames for its gateway.` } },
  });
  const s1 = addPackets(s, [req, rep]);
  const s2 = setArp(s1, "CLIENT", { [target]: MAC.R1C });
  return { s: setArp(s2, "R1", { [C]: MAC.CLIENT }), ok: true };
}
/** R1 resolves a server-LAN address it doesn't know yet. Nobody owns it → incomplete. */
function r1ArpServerLan(s: DlState, target: string, j: string): { s: DlState; ok: boolean; packet: Omit<DlPacket, "no" | "t"> | undefined } {
  const known = s.net.arp.R1[target];
  if (known && known !== "incomplete") return { s, ok: true, packet: undefined };
  const owner = target === SRV ? MAC.SRV : target === DNS ? MAC.DNS : undefined;
  const req = build({
    src: RS, dst: target, proto: "ARP", msg: "ARP request", journey: `${j}:r1arp`, info: `ARP Who has ${target}? Tell ${RS}`, color: owner ? "cyan" : "red",
    layers: [eth(MAC.R1S, BC), arpLayer("request", MAC.R1S, RS, "00:00:00:00:00:00", target)], path: ["R1", "SW2"],
    leg: {
      path: ["R1", "SW2"], frames: { server: { src: MAC.R1S, dst: BC } },
      texts: { R1: `R1 has a connected route for 10.20.20.0/24 but no MAC for ${target}, so it broadcasts an ARP request on ge-0/0/1.` },
      end: { act: "flood", text: "" },
      flooded: (n) => ({ act: "ignore", text: `${n} receives the ARP request; ${target} is not its address, so it doesn't answer.` }),
    },
    lost: owner ? undefined : `nobody on the server LAN owns ${target}: R1's ARP request gets no reply`,
  });
  return { s: owner ? setArp(s, "R1", { [target]: owner }) : setArp(s, "R1", { [target]: "incomplete" }), ok: !!owner, packet: req };
}

// ---------------------------------------------------------------------------------------------------------------
// The DHCP exchange, one message at a time
// ---------------------------------------------------------------------------------------------------------------
const SECS = [0, 4, 12];
const discoverLeg = (end: Leg["end"]): Leg => ({
  path: ["CLIENT", "SW1", "R1"],
  frames: F.clientBcast,
  ttl: 64,
  texts: { CLIENT: "CLIENT has no address, so it sends from 0.0.0.0:68 to the broadcast 255.255.255.255:67." },
  end,
});
const RELAY_IN = (m: string, to: string = SRV) => `R1's relay agent (ip helper ${to}) receives the ${m} broadcast on ge-0/0/0 and sends a NEW unicast to ${to}, writing giaddr ${RC} (where the client is) and hops 1.`;
const NO_RELAY = "R1 receives the broadcast on ge-0/0/0. No ip helper-address is configured there, and routers never forward broadcasts, so R1 discards it. Nothing leaves ge-0/0/1.";
const noRelayText = (cfg: DlConfig) => (cfg.relay && cfg.helperIf === "ge-0/0/1" ? "R1 receives the broadcast on ge-0/0/0. Its relay is configured on ge-0/0/1 (the servers' side), where no client broadcasts ever arrive, so on ge-0/0/0 R1 treats it like any broadcast and discards it." : NO_RELAY);
/** Where R1's relayed copy goes, given the helper address. */
type RelayTarget = "srv" | "dns" | "nobody" | "upstream";
const relayTarget = (cfg: DlConfig): RelayTarget => (cfg.helper === SRV ? "srv" : cfg.helper === DNS ? "dns" : in24(cfg.helper, "10.20.20.0") ? "nobody" : "upstream");
/** The relay's copy for anything other than the real DHCP server: what the network does with it. */
function strayRelay(s: DlState, j: string, msg: "DISCOVER" | "REQUEST", layers: DlLayer[], first: Omit<DlPacket, "no" | "t">): DlState {
  const cfg = s.config;
  const H = cfg.helper;
  const t = relayTarget(cfg);
  if (t === "dns") {
    const rel = build({ src: RS, dst: H, proto: "DHCP", msg, journey: j, info: `DHCP ${msg === "DISCOVER" ? "Discover" : "Request"} (relayed to ${H})`, color: "red", layers: [eth(MAC.R1S, MAC.DNS), ip(RS, H), udp(67, 67), ...layers.slice(3)], path: ["R1", "SW2", "DNS-SRV"], lost: `the helper address ${H} is the DNS server, which runs no DHCP service`, leg: { path: ["R1", "SW2", "DNS-SRV"], frames: { server: { src: MAC.R1S, dst: MAC.DNS } }, ttl: 64, end: { act: "reject", text: `DNS-SRV receives a DHCP request it has no program for (nothing listens on UDP 67 there): it answers ICMP port unreachable. The relay sent it to the wrong server.` } } });
    const icmp = build({ src: DNS, dst: RS, proto: "ICMP", msg: "Port unreachable", journey: `${j}:icmp`, info: "ICMP Destination unreachable (Port unreachable) about UDP 67", color: "red", layers: [eth(MAC.DNS, MAC.R1S), ip(DNS, RS, "1 (ICMP)"), icmpLayer(3, 3, "port unreachable", [{ k: "about", v: `DHCP ${msg} from ${RS}` }])], path: ["DNS-SRV", "SW2", "R1"], leg: { path: ["DNS-SRV", "SW2", "R1"], frames: { server: { src: MAC.DNS, dst: MAC.R1S } }, ttl: 64, end: { act: "deliver", text: "R1 receives the ICMP error; the client hears nothing." } } });
    return addPackets(s, [first, rel, icmp]);
  }
  if (t === "nobody") {
    const r = r1ArpServerLan(s, H, j);
    return addPackets(r.s, [first, ...(r.packet ? [r.packet] : [])]);
  }
  const rel = build({ src: "198.51.100.2", dst: H, proto: "DHCP", msg, journey: j, info: `DHCP ${msg === "DISCOVER" ? "Discover" : "Request"} (relayed to ${H})`, color: "red", layers: [eth(MAC.R1U, MAC.ISP), ip("198.51.100.2", H), udp(67, 67), ...layers.slice(3)], path: ["R1", "WEB"], lost: `${H} isn't on the servers' network: R1 sent the relayed request out to the internet, where nothing answers`, leg: { path: ["R1", "WEB"], frames: { upstream: { src: MAC.R1U, dst: MAC.ISP } }, ttl: 64, end: { act: "unanswered", text: `Nothing on the internet answers DHCP for this network: the helper address ${H} is not the DHCP server.` } } });
  return addPackets(s, [first, rel]);
}
/** The relay's first leg ends at R1 differently when the helper is wrong. */
const relayInText = (cfg: DlConfig, m: string) => (relayTarget(cfg) === "nobody" ? `R1's relay agent wants to send the ${m} to its helper ${cfg.helper}, but nobody on the servers' network answers ARP for that address, so the relayed copy is never sent.` : RELAY_IN(m, cfg.helper));
const SRV_DOWN = "DHCP-SRV receives it on eth0, but no DHCP service is listening on UDP 67: the host answers with ICMP port unreachable.";

function srvUnreachable(j: string, to: "R1" | "CLIENT", about: string, C = DL_DEFAULT_C): Omit<DlPacket, "no" | "t"> {
  const toR1 = to === "R1";
  return build({
    src: SRV, dst: toR1 ? RS : C, proto: "ICMP", msg: "Port unreachable", journey: `${j}:icmp`, info: `ICMP Destination unreachable (Port unreachable) about UDP 67`, color: "red",
    layers: [eth(MAC.SRV, MAC.R1S), ip(SRV, toR1 ? RS : C, "1 (ICMP)"), icmpLayer(3, 3, "port unreachable", [{ k: "about", v: about }])], path: toR1 ? ["DHCP-SRV", "SW2", "R1"] : ["DHCP-SRV", "SW2", "R1", "SW1", "CLIENT"],
    leg: toR1
      ? { path: ["DHCP-SRV", "SW2", "R1"], frames: F.srvToRelay, ttl: 64, texts: { "DHCP-SRV": "DHCP-SRV's kernel answers: nothing listens on UDP 67 (ICMP type 3, code 3)." }, end: { act: "deliver", text: "R1 receives the ICMP error. A relay doesn't pass errors on to the client, which simply hears nothing." } }
      : { path: ["DHCP-SRV", "SW2", "R1", "SW1", "CLIENT"], frames: F.serverLanToClient(MAC.SRV), ttl: 64, texts: { "DHCP-SRV": "DHCP-SRV's kernel answers: nothing listens on UDP 67 (ICMP type 3, code 3)." }, end: { act: "deliver", text: "CLIENT receives the port-unreachable: the server is up, the DHCP service isn't." } },
  });
}

function sendDiscover(s: DlState): DlState {
  const xid = s.client.xid;
  const cfg = s.config;
  const j = `${s.seq}:discover`;
  const secs = SECS[Math.min(s.client.retries, 2)];
  const base = { src: "0.0.0.0", dst: "255.255.255.255", proto: "DHCP" as const, msg: "DISCOVER" as const, journey: j, info: `DHCP Discover · xid ${hex(xid)}${s.client.retries ? " (retransmit)" : ""}`, color: "amber" as const, layers: [eth(MAC.CLIENT, BC), ip("0.0.0.0", "255.255.255.255"), udp(68, 67), dhcp("DISCOVER", { xid, bcast: true, secs })], path: ["CLIENT", "SW1", "R1"] as DlNode[] };
  if (!relayOn(cfg)) {
    const s1 = addPackets(s, [build({ ...base, lost: cfg.relay && cfg.helperIf === "ge-0/0/1" ? "R1's relay is configured on the servers' interface (ge-0/0/1), not where the clients' broadcasts arrive" : "R1 is a router: it does not forward broadcasts, and no relay (ip helper) is configured", leg: discoverLeg({ act: "drop", text: noRelayText(cfg) }) })]);
    return waitOrGiveUp(s1, "no relay forwarded the Discover");
  }
  if (relayTarget(cfg) !== "srv") {
    const first0 = build({ ...base, lost: relayTarget(cfg) === "nobody" ? `nobody owns the helper address ${cfg.helper}` : undefined, leg: discoverLeg({ act: relayTarget(cfg) === "nobody" ? "drop" : "relay", text: relayInText(cfg, "DISCOVER") }) });
    return waitOrGiveUp(strayRelay(s, j, "DISCOVER", base.layers, first0), `the relay sent it to ${cfg.helper}, not to the DHCP server`);
  }
  const first = build({ ...base, leg: discoverLeg({ act: "relay", text: RELAY_IN("DISCOVER") }) });
  const relayedBase = { src: RS, dst: SRV, proto: "DHCP" as const, msg: "DISCOVER" as const, journey: j, info: `DHCP Discover (relayed) · giaddr ${RC}`, color: "amber" as const, layers: [eth(MAC.R1S, MAC.SRV), ip(RS, SRV), udp(67, 67), dhcp("DISCOVER", { xid, bcast: true, giaddr: RC, hops: 1, secs })], path: ["R1", "SW2", "DHCP-SRV"] as DlNode[] };
  const relayLeg = (end: Leg["end"]): Leg => ({ path: ["R1", "SW2", "DHCP-SRV"], frames: F.relayToSrv, ttl: 64, texts: { R1: `R1 sends the relayed DISCOVER from ${RS}:67 to ${SRV}:67 out ge-0/0/1.` }, end });
  if (!dhcpRunning(cfg)) {
    const s1 = addPackets(s, [first, build({ ...relayedBase, lost: "the DHCP service on DHCP-SRV isn't running: the host rejects UDP 67", leg: relayLeg({ act: "reject", text: SRV_DOWN }) }), srvUnreachable(j, "R1", `DHCP DISCOVER from ${RS}`)]);
    return waitOrGiveUp(s1, "the DHCP service didn't answer");
  }
  if (!scopeFor(cfg, RC)) {
    const s1 = srvLog(addPackets(s, [first, build({ ...relayedBase, lost: `DHCP-SRV has no scope for the network the request came from (giaddr ${RC}, 10.10.10.0/24)`, leg: relayLeg({ act: "unanswered", text: `DHCP-SRV receives the DISCOVER, looks for a scope containing giaddr ${RC}, and finds none${cfg.scope ? ` (its scope is ${cfg.scope.net}/24)` : ""}: it doesn't know this network, so it sends nothing back.` }) })]), "DHCP-SRV", `DHCPDISCOVER from ${cmac} via ${RC}: unknown network segment`);
    return waitOrGiveUp(s1, "the server has no scope for the clients' network");
  }
  if (cfg.poolFree <= 0) {
    const s1 = srvLog(addPackets(s, [first, build({ ...relayedBase, lost: "DHCP-SRV has no free address in the 10.10.10.0/24 pool: it makes no offer", leg: relayLeg({ act: "unanswered", text: "DHCP-SRV receives the DISCOVER and picks the 10.10.10.0/24 scope from giaddr, but every address is leased: it sends nothing back." }) })]), "DHCP-SRV", `DHCPDISCOVER from ${cmac} via ${RC}: network 10.10.10.0/24: no free leases`);
    return waitOrGiveUp(s1, "the server had no free address to offer");
  }
  const C = offerAddr(s);
  const offerLayer = dhcp("OFFER", { xid, yiaddr: C, giaddr: RC, hops: 1, bcast: true, opts: leaseOpts(cfg, C) });
  const s1 = addPackets(s, [
    first,
    build({ ...relayedBase, leg: relayLeg({ act: "deliver", text: `DHCP-SRV receives the DISCOVER on UDP 67, picks the ${cfg.scope!.net}/24 scope because giaddr is ${RC}, and reserves ${C}.` }) }),
    build({ src: SRV, dst: RC, proto: "DHCP", msg: "OFFER", journey: `${s.seq}:offer`, info: `DHCP Offer · ${C}`, color: "violet", layers: [eth(MAC.SRV, MAC.R1S), ip(SRV, RC), udp(67, 67), offerLayer], path: ["DHCP-SRV", "SW2", "R1"], leg: { path: ["DHCP-SRV", "SW2", "R1"], frames: F.srvToRelay, ttl: 64, texts: { "DHCP-SRV": `DHCP-SRV sends the OFFER of ${C} back to the relay address in giaddr (${RC}).` }, end: { act: "relay", text: "R1's relay agent receives the server's reply and, because the client set the BROADCAST flag, broadcasts it onto the client LAN out ge-0/0/0." } } }),
    build({ src: RC, dst: "255.255.255.255", proto: "DHCP", msg: "OFFER", journey: `${s.seq}:offer`, info: `DHCP Offer (to client) · ${C}`, color: "violet", layers: [eth(MAC.R1C, BC), ip(RC, "255.255.255.255"), udp(67, 68), offerLayer], path: ["R1", "SW1", "CLIENT"], leg: { path: ["R1", "SW1", "CLIENT"], frames: F.relayToClientBcast, ttl: 64, texts: { R1: "R1 broadcasts the OFFER from 10.10.10.1:67 to 255.255.255.255:68." }, end: { act: "deliver", text: `CLIENT matches the xid to its DISCOVER and considers the offer of ${C}. Nothing is configured yet.` } } }),
  ]);
  const s2 = srvLog(s1, "DHCP-SRV", `DHCPDISCOVER from ${cmac} via ${RC}`, `DHCPOFFER on ${C} to ${cmac} via ${RC}`);
  return push(s2, [{ text: `DISCOVER relayed by R1 → OFFER ${C} from ${SRV}`, kind: "learn" }], { client: { ...s.client, phase: "SELECTING", offered: C, retries: 0 } });
}
function waitOrGiveUp(s: DlState, why: string): DlState {
  const retries = s.client.retries + 1;
  if (retries < 3) return push(s, [{ text: `No OFFER (${why}). The client waits and will retransmit the Discover.`, kind: "warning" }], { client: { ...s.client, phase: "INIT", retries } });
  return push(s, [{ text: `Still no OFFER after ${retries} tries (${why}). The client self-assigns ${DL_APIPA} (link-local): no gateway, no DNS. Behavior varies by OS.`, kind: "warning" }], { client: { phase: "APIPA", xid: s.client.xid, retries, ip: DL_APIPA, mask: "255.255.0.0" } });
}
function sendRequest(s: DlState): DlState {
  const xid = s.client.xid;
  const j = `${s.seq}:request`;
  const reqOpts = [{ k: "opt 50 requested IP", v: s.client.offered!, hi: true }, { k: "opt 54 server id", v: SRV, hi: true }];
  const base = { src: "0.0.0.0", dst: "255.255.255.255", proto: "DHCP" as const, msg: "REQUEST" as const, journey: j, info: `DHCP Request · requested ${s.client.offered} · server ${SRV}`, color: "amber" as const, layers: [eth(MAC.CLIENT, BC), ip("0.0.0.0", "255.255.255.255"), udp(68, 67), dhcp("REQUEST", { xid, bcast: true, opts: reqOpts })], path: ["CLIENT", "SW1", "R1"] as DlNode[] };
  const leg = (end: Leg["end"]): Leg => ({ path: ["CLIENT", "SW1", "R1"], frames: F.clientBcast, ttl: 64, texts: { CLIENT: "CLIENT broadcasts its choice (still from 0.0.0.0): option 50 = the address it wants, option 54 = the server it chose." }, end });
  if (!relayOn(s.config) || relayTarget(s.config) !== "srv") {
    const s1 = addPackets(s, [build({ ...base, lost: "no working relay on R1", leg: leg({ act: "drop", text: noRelayText(s.config) }) })]);
    return push(s1, [{ text: "REQUEST didn't reach the server: no ACK will come, the client starts over.", kind: "warning" }], { client: { phase: "INIT", xid: s.client.xid + 1, retries: 0 } });
  }
  const first = build({ ...base, leg: leg({ act: "relay", text: RELAY_IN("REQUEST") }) });
  const relayed = { src: RS, dst: SRV, proto: "DHCP" as const, msg: "REQUEST" as const, journey: j, info: "DHCP Request (relayed)", color: "amber" as const, layers: [eth(MAC.R1S, MAC.SRV), ip(RS, SRV), udp(67, 67), dhcp("REQUEST", { xid, bcast: true, giaddr: RC, hops: 1, opts: reqOpts.map((o) => ({ ...o, hi: false })) })], path: ["R1", "SW2", "DHCP-SRV"] as DlNode[] };
  const rleg = (end: Leg["end"]): Leg => ({ path: ["R1", "SW2", "DHCP-SRV"], frames: F.relayToSrv, ttl: 64, end });
  if (!dhcpRunning(s.config)) {
    const s1 = addPackets(s, [first, build({ ...relayed, lost: "DHCP service not running", leg: rleg({ act: "reject", text: SRV_DOWN }) }), srvUnreachable(j, "R1", `DHCP REQUEST from ${RS}`)]);
    return push(s1, [{ text: "REQUEST unanswered (DHCP service down): the client starts over.", kind: "warning" }], { client: { phase: "INIT", xid: s.client.xid + 1, retries: 0 } });
  }
  const s1 = addPackets(s, [first, build({ ...relayed, leg: rleg({ act: "deliver", text: `DHCP-SRV receives the REQUEST: option 54 names this server, so it will commit the lease for ${s.client.offered}.` }) })]);
  return push(srvLog(s1, "DHCP-SRV", `DHCPREQUEST for ${s.client.offered} (${SRV}) from ${cmac} via ${RC}`), [{ text: "REQUEST sent (broadcast, relayed)", kind: "info" }], { client: { ...s.client, phase: "REQUESTING" } });
}
function bindClient(s: DlState, xid: number, how: string): DlState {
  const cfg = s.config;
  const C = cip(s);
  const client: DlClient = { phase: "BOUND", ip: C, mask: MASK, gw: cfg.option3, dns: cfg.option6, leaseStart: s.clock, lease: LEASE_SECONDS, serverId: SRV, xid, retries: 0 };
  const leases = [...s.net.leases.filter((l) => l.ip !== C), { ip: C, mac: cmac, ends: s.clock + LEASE_SECONDS, state: "active" as const }];
  // A new gateway value means the old ARP knowledge no longer matters for routing decisions; keep the cache itself.
  return push({ ...s, net: { ...s.net, leases } }, [{ text: `ACK: BOUND ${C}/24, gateway ${cfg.option3}, DNS ${cfg.option6}, lease ${LEASE_SECONDS} s${how ? ` (${how})` : ""}`, kind: "learn" }], { client });
}
/** ACK through the relay (selecting, rebinding, broadcast renew). */
function relayedAck(s: DlState, xid: number, how: string, ciaddr?: string): DlState {
  const cfg = s.config;
  const C = cip(s);
  const ack = dhcp("ACK", { xid, yiaddr: C, giaddr: RC, hops: 1, ciaddr, bcast: true, opts: leaseOpts(cfg, C) });
  const j = `${s.seq}:ack`;
  const s1 = addPackets(s, [
    build({ src: SRV, dst: RC, proto: "DHCP", msg: "ACK", journey: j, info: "DHCP ACK", color: "green", layers: [eth(MAC.SRV, MAC.R1S), ip(SRV, RC), udp(67, 67), ack], path: ["DHCP-SRV", "SW2", "R1"], leg: { path: ["DHCP-SRV", "SW2", "R1"], frames: F.srvToRelay, ttl: 64, texts: { "DHCP-SRV": `DHCP-SRV records the lease and sends the ACK, with its CURRENT options (router ${cfg.option3}, DNS ${cfg.option6}), to the relay.` }, end: { act: "relay", text: "R1's relay agent broadcasts the ACK onto the client LAN out ge-0/0/0." } } }),
    build({ src: RC, dst: "255.255.255.255", proto: "DHCP", msg: "ACK", journey: j, info: "DHCP ACK (to client)", color: "green", layers: [eth(MAC.R1C, BC), ip(RC, "255.255.255.255"), udp(67, 68), ack], path: ["R1", "SW1", "CLIENT"], leg: { path: ["R1", "SW1", "CLIENT"], frames: F.relayToClientBcast, ttl: 64, end: { act: "deliver", text: `CLIENT accepts the ACK and configures ${C}/24, gateway ${cfg.option3}, DNS ${cfg.option6}. Only now is it BOUND.` } } }),
  ]);
  const s2 = srvLog(s1, "DHCP-SRV", `DHCPACK on ${C} to ${cmac} via ${RC}`);
  const fresh = how === "" ? { config: { ...s2.config, poolFree: s2.config.poolFree - 1 } } : {};
  return bindClient({ ...s2, ...fresh }, xid, how);
}
function sendAck(s: DlState): DlState {
  return relayedAck(s, s.client.xid, "");
}

/** Unicast renewal straight to the server (T1, or the first try of a manual renew). */
function unicastRenew(s: DlState, xid: number): { s: DlState; ok: boolean } {
  const j = `${s.seq}:renew`;
  const C = cip(s);
  const arp = clientArp(s, s.client.gw!, j);
  if (!arp.ok) return { s: arp.s, ok: false };
  let st = arp.s;
  const req = { src: C, dst: SRV, proto: "DHCP" as const, msg: "REQUEST" as const, journey: j, info: "DHCP Request (RENEWING, unicast)", color: "amber" as const, layers: [eth(MAC.CLIENT, MAC.R1C), ip(C, SRV), udp(68, 67), dhcp("REQUEST", { xid, ciaddr: C })], path: ["CLIENT", "SW1", "R1", "SW2", "DHCP-SRV"] as DlNode[] };
  const leg = (end: Leg["end"]): Leg => ({ path: ["CLIENT", "SW1", "R1", "SW2", "DHCP-SRV"], frames: F.clientToServerLan(MAC.SRV), ttl: 64, texts: { CLIENT: `CLIENT already has an address, so it renews with a normal unicast from ${C}:68 to ${SRV}:67, via its gateway.`, R1: `R1 simply ROUTES this unicast (ge-0/0/0 → ge-0/0/1, TTL 64 → 63). The relay agent only handles broadcasts.` }, end });
  if (!dhcpRunning(st.config) || !scopeFor(st.config, C)) {
    if (dhcpRunning(st.config)) {
      st = srvLog(addPackets(st, [build({ ...req, lost: "the server has no scope for this address any more", leg: leg({ act: "unanswered", text: `DHCP-SRV has no scope containing ${C}: it ignores the renewal.` }) })]), "DHCP-SRV", `DHCPREQUEST for ${C} from ${cmac}: unknown network segment`);
      return { s: st, ok: false };
    }
    st = addPackets(st, [build({ ...req, lost: "DHCP service not running", leg: leg({ act: "reject", text: SRV_DOWN }) }), srvUnreachable(j, "CLIENT", `DHCP REQUEST from ${C}`, C)]);
    return { s: st, ok: false };
  }
  const ack = dhcp("ACK", { xid, yiaddr: C, ciaddr: C, opts: leaseOpts(st.config, C) });
  st = addPackets(st, [
    build({ ...req, leg: leg({ act: "deliver", text: `DHCP-SRV receives the renewal for ${C} and extends the lease.` }) }),
    build({ src: SRV, dst: C, proto: "DHCP", msg: "ACK", journey: `${j}:ack`, info: "DHCP ACK (unicast renewal)", color: "green", layers: [eth(MAC.SRV, MAC.R1S), ip(SRV, C), udp(67, 68), ack], path: ["DHCP-SRV", "SW2", "R1", "SW1", "CLIENT"], leg: { path: ["DHCP-SRV", "SW2", "R1", "SW1", "CLIENT"], frames: F.serverLanToClient(MAC.SRV), ttl: 64, texts: { "DHCP-SRV": `DHCP-SRV answers straight to ${C}, with its CURRENT options (router ${st.config.option3}, DNS ${st.config.option6}).` }, end: { act: "deliver", text: "CLIENT applies the ACK: the lease restarts and any changed options take effect now." } } }),
  ]);
  st = srvLog(st, "DHCP-SRV", `DHCPREQUEST for ${C} from ${cmac} (unicast renewal)`, `DHCPACK on ${C} to ${cmac}`);
  return { s: bindClient(st, xid, "renewed"), ok: true };
}
/** Broadcast REQUEST from a client that still has its address (T2 rebinding, or a manual renew's fallback). */
function broadcastRenew(s: DlState, xid: number, how: string): { s: DlState; ok: boolean } {
  const j = `${s.seq}:rebind`;
  const C = cip(s);
  const layers = [eth(MAC.CLIENT, BC), ip(C, "255.255.255.255"), udp(68, 67), dhcp("REQUEST", { xid, ciaddr: C, bcast: true })];
  const base = { src: C, dst: "255.255.255.255", proto: "DHCP" as const, msg: "REQUEST" as const, journey: j, info: `DHCP Request (${how}, broadcast)`, color: "amber" as const, layers, path: ["CLIENT", "SW1", "R1"] as DlNode[] };
  const leg = (end: Leg["end"]): Leg => ({ path: ["CLIENT", "SW1", "R1"], frames: F.clientBcast, ttl: 64, texts: { CLIENT: `CLIENT broadcasts a REQUEST for its current address ${C} to any DHCP server.` }, end });
  if (!relayOn(s.config)) return { s: addPackets(s, [build({ ...base, lost: "no relay on R1", leg: leg({ act: "drop", text: noRelayText(s.config) }) })]), ok: false };
  if (relayTarget(s.config) !== "srv") return { s: strayRelay(s, j, "REQUEST", layers, build({ ...base, lost: relayTarget(s.config) === "nobody" ? `nobody owns the helper address ${s.config.helper}` : undefined, leg: leg({ act: relayTarget(s.config) === "nobody" ? "drop" : "relay", text: relayInText(s.config, "REQUEST") }) })), ok: false };
  const first = build({ ...base, leg: leg({ act: "relay", text: RELAY_IN("REQUEST") }) });
  const rel = { src: RS, dst: SRV, proto: "DHCP" as const, msg: "REQUEST" as const, journey: j, info: "DHCP Request (relayed)", color: "amber" as const, layers: [eth(MAC.R1S, MAC.SRV), ip(RS, SRV), udp(67, 67), dhcp("REQUEST", { xid, ciaddr: C, bcast: true, giaddr: RC, hops: 1 })], path: ["R1", "SW2", "DHCP-SRV"] as DlNode[] };
  const rleg = (end: Leg["end"]): Leg => ({ path: ["R1", "SW2", "DHCP-SRV"], frames: F.relayToSrv, ttl: 64, end });
  if (!dhcpRunning(s.config)) return { s: addPackets(s, [first, build({ ...rel, lost: "DHCP service not running", leg: rleg({ act: "reject", text: SRV_DOWN }) }), srvUnreachable(j, "R1", `DHCP REQUEST from ${RS}`)]), ok: false };
  if (!scopeFor(s.config, RC)) return { s: srvLog(addPackets(s, [first, build({ ...rel, lost: "no scope for the clients' network", leg: rleg({ act: "unanswered", text: `DHCP-SRV has no scope for giaddr ${RC}: it sends nothing back.` }) })]), "DHCP-SRV", `DHCPREQUEST for ${C} from ${cmac} via ${RC}: unknown network segment`), ok: false };
  const s1 = addPackets(s, [first, build({ ...rel, leg: rleg({ act: "deliver", text: `DHCP-SRV receives the REQUEST for ${C} and extends the lease.` }) })]);
  return { s: relayedAck(srvLog(s1, "DHCP-SRV", `DHCPREQUEST for ${C} from ${cmac} via ${RC}`), xid, how.toLowerCase(), C), ok: true };
}
function autoRenew(s: DlState, how: "renew" | "rebind"): DlState {
  const xid = s.client.xid + 1;
  const st = { ...s, client: { ...s.client, xid } };
  const r = how === "renew" ? unicastRenew(st, xid) : broadcastRenew(st, xid, "REBINDING");
  if (r.ok) return r.s;
  return push(r.s, [{ text: `${how === "renew" ? "Renewal (T1)" : "Rebind (T2)"} unanswered: the client keeps its address until the lease expires`, kind: "warning" }], { client: { ...r.s.client, phase: how === "renew" ? "RENEWING" : "REBINDING" } });
}
/** "Renew now" (like ipconfig /renew): unicast first; if that gets no answer, a broadcast REQUEST through the relay. */
function manualRenew(s: DlState): DlState {
  const xid = s.client.xid + 1;
  const st = { ...s, client: { ...s.client, xid } };
  const u = unicastRenew(st, xid);
  if (u.ok) return u.s;
  const b = broadcastRenew(u.s, xid, "RENEW");
  if (b.ok) return push(b.s, [{ text: "The unicast renewal got no answer, so the client fell back to a broadcast REQUEST, which the relay carried.", kind: "info" }]);
  return push(b.s, [{ text: "Renewal failed both ways: the client keeps its current lease (and its current options) until it expires.", kind: "warning" }]);
}

// ---------------------------------------------------------------------------------------------------------------
// Time, DNS, ping
// ---------------------------------------------------------------------------------------------------------------
function advance(s: DlState, to: number): DlState {
  let st: DlState = { ...s };
  const target = Math.max(s.clock, to);
  const c = s.client;
  if (configured(c) && c.leaseStart !== undefined && c.lease) {
    const t1 = c.leaseStart + DL_T1;
    const t2 = c.leaseStart + DL_T2;
    const exp = c.leaseStart + c.lease;
    if (st.clock < t1 && target >= t1) {
      st = autoRenew({ ...st, clock: t1 }, "renew");
      if (st.client.phase === "BOUND") return push({ ...st, clock: target }, [{ text: `Clock → ${fmtT(target)}`, kind: "info" }]);
    }
    if (st.clock < t2 && target >= t2 && st.client.phase !== "BOUND") {
      st = autoRenew({ ...st, clock: t2 }, "rebind");
      if (st.client.phase === "BOUND") return push({ ...st, clock: target }, [{ text: `Clock → ${fmtT(target)}`, kind: "info" }]);
    }
    if (target >= exp && st.client.phase !== "BOUND") {
      st = push({ ...st, clock: exp }, [{ text: `Lease expired at ${fmtT(exp)}: the client must stop using ${cip(st)} and start over (INIT)`, kind: "warning" }], { client: { phase: "INIT", xid: st.client.xid + 1, retries: 0 } });
    }
  }
  return push({ ...st, clock: target, cache: st.cache }, [{ text: `Clock → ${fmtT(target)}`, kind: "info" }]);
}
export const fmtT = (t: number) => `${Math.floor(t / 3600)}h${String(Math.floor((t % 3600) / 60)).padStart(2, "0")}`;

/** Before anything leaves the client for another subnet: an address, a gateway, and the gateway's MAC. */
function offLink(s: DlState, j: string): { s: DlState; ok: boolean; why?: string; local?: boolean } {
  const c = s.client;
  if (c.phase === "APIPA") return { s, ok: false, local: true, why: `${DL_APIPA} is link-local only: no gateway, nothing off the LAN is reachable` };
  if (!configured(c)) return { s, ok: false, local: true, why: "the client has no IP address yet" };
  const a = clientArp(s, c.gw!, j);
  if (!a.ok) return { s: a.s, ok: false, why: `the default gateway ${c.gw} doesn't answer ARP, so the client can't build a frame for it: nothing is sent` };
  return { s: a.s, ok: true };
}

/** Resolve a name. `direct` is what nslookup does: always ask the DNS server, and leave the resolver cache alone. */
function resolve(s: DlState, nameRaw: string, direct = false): DlState {
  const name = nameRaw.trim().toLowerCase().replace(/\.$/, "");
  if (!name) return s;
  const hit = direct ? undefined : s.cache.find((e) => e.name === name && e.expires > s.clock);
  if (hit) return push({ ...s, lastPackets: [] }, [{ text: `${name} → ${hit.ip} from the local cache (${hit.expires - s.clock} s left): no packet sent`, kind: "learn" }], { lastResult: { kind: "resolve", ok: true, text: `${name} → ${hit.ip} (from cache, ${hit.expires - s.clock} s left)` } });
  const c = s.client;
  if (!c.dns) return push({ ...s, lastPackets: [] }, [{ text: `Can't resolve ${name}: no DNS server configured`, kind: "warning" }], { lastResult: { kind: "resolve", ok: false, text: c.phase === "APIPA" ? "No DNS server: the client only has a self-assigned address" : "No DNS server: the client has no lease" } });
  const j = `${s.seq}:dns`;
  const id = 0x5a00 + (s.seq % 200);
  if (configured(c) && inClientLan(c.dns) && c.dns !== RC) {
    // An on-link DNS address: the client ARPs for it directly, and nobody owns it.
    const a = clientArp({ ...s, lastPackets: [] }, c.dns, j);
    const st0 = { ...a.s, lastPackets: a.s.capture.filter((p) => p.journey.startsWith(j)).map((p) => p.no) };
    return push(st0, [{ text: `DNS query for ${name} never left the client: nobody owns ${c.dns}`, kind: "warning" }], { lastResult: { kind: "resolve", ok: false, text: `;; connection timed out; no servers could be reached (${c.dns})` } });
  }
  const ol = offLink({ ...s, lastPackets: [] }, j);
  if (!ol.ok) {
    const st = { ...ol.s, lastPackets: ol.s.capture.filter((p) => p.journey.startsWith(j)).map((p) => p.no) };
    return push(st, [{ text: `DNS query for ${name} never left the client: ${ol.why}`, kind: "warning" }], { lastResult: { kind: "resolve", ok: false, text: `;; connection timed out; no servers could be reached (${ol.why})` } });
  }
  let st = ol.s;
  const C = cip(st);
  const qLayers = [eth(MAC.CLIENT, MAC.R1C), ip(C, c.dns), udp(CLIENT_DNS_PORT, 53), { name: "DNS query", color: "#34d399", fields: [{ k: "Transaction ID", v: hex(id), hi: true }, { k: "Flags", v: "RD (recursion desired)" }, { k: "Question", v: `${name} A IN`, hi: true }] }];
  const q = { src: `${C}:${CLIENT_DNS_PORT}`, dst: `${c.dns}:53`, proto: "DNS" as const, msg: "DNS query" as const, journey: j, info: `Standard query ${hex(id)} A ${name}`, color: "cyan" as const, layers: qLayers };
  const qTexts = { CLIENT: `CLIENT sends a UDP query from port ${CLIENT_DNS_PORT} to ${c.dns}:53 (the DNS server from its lease), framed to its gateway's MAC.` };
  const arpBefore = st.capture.filter((p) => p.journey.startsWith(j)).map((p) => p.no);
  if (c.dns === SRV || c.dns === RC) {
    // A real host, but not a DNS server: it refuses the query.
    const onR1 = c.dns === RC;
    const path: DlNode[] = onR1 ? ["CLIENT", "SW1", "R1"] : ["CLIENT", "SW1", "R1", "SW2", "DHCP-SRV"];
    const query = build({ ...q, path, lost: `${c.dns} is ${onR1 ? "the router" : "the DHCP server"}, which runs no DNS service`, leg: { path, frames: onR1 ? { client: { src: MAC.CLIENT, dst: MAC.R1C } } : F.clientToServerLan(MAC.SRV), ttl: 64, texts: qTexts, end: { act: "reject", text: `${onR1 ? "R1" : "DHCP-SRV"} receives the DNS query, but no DNS program runs there (nothing listens on UDP 53): it answers ICMP port unreachable. Option 6 points at the wrong server.` } } });
    const back: DlNode[] = onR1 ? ["R1", "SW1", "CLIENT"] : ["DHCP-SRV", "SW2", "R1", "SW1", "CLIENT"];
    const icmp = build({ src: c.dns, dst: C, proto: "ICMP", msg: "Port unreachable", journey: `${j}:icmp`, info: "ICMP Destination unreachable (Port unreachable) about UDP 53", color: "red", layers: [eth(onR1 ? MAC.R1C : MAC.SRV, onR1 ? MAC.CLIENT : MAC.R1S), ip(c.dns, C, "1 (ICMP)"), icmpLayer(3, 3, "port unreachable", [{ k: "about", v: `DNS query ${hex(id)} from ${C}` }])], path: back, leg: { path: back, frames: onR1 ? { client: { src: MAC.R1C, dst: MAC.CLIENT } } : F.serverLanToClient(MAC.SRV), ttl: 64, end: { act: "deliver", text: "CLIENT's resolver receives the port-unreachable and reports “connection refused”." } } });
    st = addPackets(st, [query, icmp]);
    st = { ...st, lastPackets: [...arpBefore, ...st.lastPackets] };
    return push(st, [{ text: `DNS query sent to ${c.dns}, which runs no DNS service (refused)`, kind: "warning" }], { lastResult: { kind: "resolve", ok: false, text: `;; communications error to ${c.dns}#53: connection refused` } });
  }
  if (!inServerLan(c.dns) && c.dns !== DNS) {
    const query = build({ ...q, path: ["CLIENT", "SW1", "R1", "WEB"], lost: `nothing answers DNS at ${c.dns}`, leg: { path: ["CLIENT", "SW1", "R1", "WEB"], frames: F.clientToUpstream, ttl: 64, texts: { ...qTexts, R1: `${c.dns} isn't on either of R1's networks: R1 routes the query out to the internet.` }, end: { act: "unanswered", text: `No DNS server answers at ${c.dns}.` } } });
    st = addPackets(st, [query]);
    st = { ...st, lastPackets: [...arpBefore, ...st.lastPackets] };
    return push(st, [{ text: `DNS query to ${c.dns} timed out`, kind: "warning" }], { lastResult: { kind: "resolve", ok: false, text: `;; connection timed out; no servers could be reached (${c.dns})` } });
  }
  if (c.dns !== DNS) {
    // The configured server is on the server LAN but nobody owns that address: R1 can't resolve it with ARP.
    const r = r1ArpServerLan(st, c.dns, j);
    const query = build({ ...q, path: ["CLIENT", "SW1", "R1"], lost: `nothing answers at ${c.dns}`, leg: { path: ["CLIENT", "SW1", "R1"], frames: { client: { src: MAC.CLIENT, dst: MAC.R1C } }, ttl: 64, texts: qTexts, end: { act: "drop", text: `R1 has a connected route for 10.20.20.0/24, but nobody answers its ARP for ${c.dns}. Without a MAC it can't build the frame on ge-0/0/1, so it drops the query.` } } });
    st = addPackets(r.s, [query, ...(r.packet ? [r.packet] : [])]);
    st = { ...st, lastPackets: [...arpBefore, ...st.lastPackets] };
    return push(st, [{ text: `DNS query to ${c.dns} timed out: R1 can't find any host at that address`, kind: "warning" }], { lastResult: { kind: "resolve", ok: false, text: `;; connection timed out; no servers could be reached (${c.dns})` } });
  }
  const qPath: DlNode[] = ["CLIENT", "SW1", "R1", "SW2", "DNS-SRV"];
  if (!st.config.dnsUp) {
    const query = build({ ...q, path: qPath, lost: "the DNS service on DNS-SRV isn't running: the host rejects UDP 53", leg: { path: qPath, frames: F.clientToServerLan(MAC.DNS), ttl: 64, texts: qTexts, end: { act: "reject", text: "DNS-SRV receives the query on eth0, but nothing listens on UDP 53: the host answers ICMP port unreachable." } } });
    const icmp = build({ src: DNS, dst: C, proto: "ICMP", msg: "Port unreachable", journey: `${j}:icmp`, info: "ICMP Destination unreachable (Port unreachable) about UDP 53", color: "red", layers: [eth(MAC.DNS, MAC.R1S), ip(DNS, C, "1 (ICMP)"), icmpLayer(3, 3, "port unreachable", [{ k: "about", v: `DNS query ${hex(id)} from ${C}` }])], path: ["DNS-SRV", "SW2", "R1", "SW1", "CLIENT"], leg: { path: ["DNS-SRV", "SW2", "R1", "SW1", "CLIENT"], frames: F.serverLanToClient(MAC.DNS), ttl: 64, texts: { "DNS-SRV": "DNS-SRV's kernel answers: nothing listens on UDP 53 (ICMP type 3, code 3)." }, end: { act: "deliver", text: "CLIENT's resolver receives the port-unreachable: the server is up, the DNS service isn't. It reports “connection refused”." } } });
    st = addPackets(st, [query, icmp]);
    st = { ...st, lastPackets: [...arpBefore, ...st.lastPackets] };
    return push(st, [{ text: `DNS query reached ${DNS}, but the DNS service is down (port unreachable)`, kind: "warning" }], { lastResult: { kind: "resolve", ok: false, text: `;; communications error to ${DNS}#53: connection refused` } });
  }
  const ans = st.records[name];
  const resp = build({
    src: `${DNS}:53`, dst: `${C}:${CLIENT_DNS_PORT}`, proto: "DNS", msg: "DNS response", journey: `${j}:resp`, info: ans ? `Standard query response ${hex(id)} A ${name} A ${ans}` : `Standard query response ${hex(id)} No such name`, color: ans ? "green" : "red",
    layers: [eth(MAC.DNS, MAC.R1S), ip(DNS, C), udp(53, CLIENT_DNS_PORT), { name: "DNS response", color: "#34d399", fields: [{ k: "Transaction ID", v: hex(id), hi: true }, { k: "Flags", v: `QR=1, AA, RA${ans ? "" : ", RCODE 3 NXDOMAIN"}`, hi: !ans }, ...(ans ? [{ k: "Answer", v: `${name} A ${ans}`, hi: true }, { k: "TTL", v: `${DNS_RECORD_TTL} s` }] : [])] }],
    path: ["DNS-SRV", "SW2", "R1", "SW1", "CLIENT"],
    leg: { path: ["DNS-SRV", "SW2", "R1", "SW1", "CLIENT"], frames: F.serverLanToClient(MAC.DNS), ttl: 64, texts: { "DNS-SRV": ans ? `DNS-SRV answers with the same Transaction ID: ${name} A ${ans}, TTL ${DNS_RECORD_TTL} s.` : `DNS-SRV has no record for ${name}: it answers NXDOMAIN (a real answer: the server works, the name doesn't exist).` }, end: { act: "deliver", text: ans ? `CLIENT matches the Transaction ID, caches ${name} → ${ans} for ${DNS_RECORD_TTL} s and hands the address to the application.` : "CLIENT receives NXDOMAIN and reports that the name doesn't exist." } },
  });
  st = addPackets(st, [build({ ...q, path: qPath, leg: { path: qPath, frames: F.clientToServerLan(MAC.DNS), ttl: 64, texts: qTexts, end: { act: "deliver", text: `DNS-SRV receives the query on UDP 53 and looks up ${name} in its zone.` } } }), resp]);
  st = { ...st, lastPackets: [...arpBefore, ...st.lastPackets] };
  st = srvLog(st, "DNS-SRV", `client ${C}#${CLIENT_DNS_PORT}: query: ${name} IN A +`, ans ? `answer: ${name} A ${ans} (ttl ${DNS_RECORD_TTL})` : `answer: ${name} NXDOMAIN`);
  if (!ans) return push(st, [{ text: `${name}: NXDOMAIN (no such name)`, kind: "warning" }], { lastResult: { kind: "resolve", ok: false, text: `${name}: NXDOMAIN (the DNS server answered: no such name)` } });
  if (direct) return push(st, [{ text: `${name} → ${ans} (asked the server directly; the laptop's cache is unchanged)`, kind: "learn" }], { lastResult: { kind: "resolve", ok: true, text: `${name} → ${ans}` } });
  const cache = [...st.cache.filter((e) => e.name !== name), { name, ip: ans, expires: st.clock + DNS_RECORD_TTL }];
  return push(st, [{ text: `${name} → ${ans} (cached for ${DNS_RECORD_TTL} s)`, kind: "learn" }], { cache, lastResult: { kind: "resolve", ok: true, text: `${name} → ${ans}` } });
}

function echo(dst: string, j: string, path: DlNode[], frames: Frames, reply: boolean, texts: Partial<Record<DlNode, string>>, lost?: string, C = DL_DEFAULT_C): Omit<DlPacket, "no" | "t"> {
  const src = reply ? dst : C;
  const to = reply ? C : dst;
  return build({
    src, dst: to, proto: "ICMP", msg: reply ? "Echo reply" : "Echo request", journey: `${j}:${reply ? "rep" : "req"}`, info: `Echo (ping) ${reply ? "reply" : "request"} ${src} → ${to}`, color: lost ? "red" : reply ? "green" : "cyan",
    layers: [eth(frames.client?.src ?? MAC.CLIENT, frames.client?.dst ?? MAC.R1C), ip(src, to, "1 (ICMP)"), icmpLayer(reply ? 0 : 8, 0, reply ? "echo reply" : "echo request")],
    path, lost,
    leg: { path, frames, ttl: 64, texts, end: reply ? { act: "deliver", text: `CLIENT receives the Echo reply from ${dst}: IP connectivity in both directions works.` } : lost ? { act: "unanswered", text: lost } : { act: "deliver", text: `${dst} receives the Echo request and answers.` } },
  });
}
function pingIp(s: DlState, dst: string): DlState {
  const c = s.client;
  const C = cip(s);
  const ech = (d: string, jj: string, path: DlNode[], frames: Frames, reply: boolean, texts: Partial<Record<DlNode, string>>, lost?: string) => echo(d, jj, path, frames, reply, texts, lost, C);
  const j = `${s.seq}:ping`;
  const start = { ...s, lastPackets: [] };
  const mark = (st: DlState) => ({ ...st, lastPackets: st.capture.filter((p) => p.journey.startsWith(j)).map((p) => p.no) });
  if (configured(c) && inClientLan(dst)) {
    // On-link: ARP for the destination itself; the gateway setting doesn't matter.
    const a = clientArp(start, dst, j);
    if (!a.ok) return push(mark(a.s), [{ text: `ping ${dst}: no ARP reply`, kind: "warning" }], { lastResult: { kind: "ping", ok: false, text: `Reply from ${C}: Destination host unreachable (no ARP reply from ${dst})` } });
    const fr = { client: { src: MAC.CLIENT, dst: MAC.R1C } };
    const back = { client: { src: MAC.R1C, dst: MAC.CLIENT } };
    const st = addPackets(a.s, [ech(dst, j, ["CLIENT", "SW1", "R1"], fr, false, { CLIENT: `${dst} is on the client's own subnet: it is sent directly to that address's MAC, without using the gateway setting.` }), ech(dst, j, ["R1", "SW1", "CLIENT"], back, true, { R1: `R1 (${dst}) answers.` })]);
    return push(mark(st), [{ text: `ping ${dst}: reply`, kind: "learn" }], { lastResult: { kind: "ping", ok: true, text: `Reply from ${dst}: bytes=32 TTL=64` } });
  }
  const ol = offLink(start, j);
  if (!ol.ok) return push(mark(ol.s), [{ text: `ping ${dst}: fails (${ol.why})`, kind: "warning" }], { lastResult: { kind: "ping", ok: false, text: ol.local ? `PING: transmit failed: ${ol.why}` : `Reply from ${C}: Destination host unreachable (${ol.why})` } });
  let st = ol.s;
  if (inServerLan(dst)) {
    const owner = dst === SRV ? MAC.SRV : dst === DNS ? MAC.DNS : undefined;
    const node: DlNode | undefined = dst === SRV ? "DHCP-SRV" : dst === DNS ? "DNS-SRV" : undefined;
    if (!owner || !node) {
      const r = r1ArpServerLan(st, dst, j);
      st = addPackets(r.s, [ech(dst, j, ["CLIENT", "SW1", "R1"], { client: { src: MAC.CLIENT, dst: MAC.R1C } }, false, {}, `R1 can't find ${dst} with ARP: the echo request is dropped`), ...(r.packet ? [r.packet] : [])]);
      return push(mark(st), [{ text: `ping ${dst}: no reply`, kind: "warning" }], { lastResult: { kind: "ping", ok: false, text: `Request timed out (${dst})` } });
    }
    st = addPackets(st, [ech(dst, j, ["CLIENT", "SW1", "R1", "SW2", node], F.clientToServerLan(owner), false, {}), ech(dst, j, [node, "SW2", "R1", "SW1", "CLIENT"], F.serverLanToClient(owner), true, { [node]: `${node} answers the ping. That proves the host and the path are up; it says nothing about its DHCP or DNS service.` })]);
    return push(mark(st), [{ text: `ping ${dst}: reply`, kind: "learn" }], { lastResult: { kind: "ping", ok: true, text: `Reply from ${dst}: bytes=32 TTL=63` } });
  }
  const live = (st.webMoved ? [DL_WEB_NEW] : [DL_WEB_OLD]).includes(dst) || dst === DL_MAIL;
  const reqP = ech(dst, j, ["CLIENT", "SW1", "R1", "WEB"], F.clientToUpstream, false, { R1: `R1 routes it towards the internet out ge-0/0/2 (default route).` }, live ? undefined : `${dst} doesn't answer (that server is switched off)`);
  st = addPackets(st, live ? [reqP, ech(dst, j, ["WEB", "R1", "SW1", "CLIENT"], F.upstreamToClient, true, { WEB: `${dst} answers.` })] : [reqP]);
  return push(mark(st), [{ text: `ping ${dst}: ${live ? "reply" : "no reply"}`, kind: live ? "learn" : "warning" }], { lastResult: { kind: "ping", ok: live, text: live ? `Reply from ${dst}: bytes=32 TTL=56 (IP connectivity works)` : `Request timed out (no reply from ${dst})` } });
}

// ---------------------------------------------------------------------------------------------------------------
// Tickets
// ---------------------------------------------------------------------------------------------------------------
export const DL_CAUSES: { id: DlCause; label: string }[] = [
  { id: "no-relay", label: "R1 isn't relaying DHCP (no ip helper), so DISCOVERs die at the router" },
  { id: "dhcp-server-down", label: "The DHCP service on DHCP-SRV isn't running" },
  { id: "pool-exhausted", label: "The DHCP pool has no free addresses left" },
  { id: "wrong-option3", label: "The DHCP scope hands out a wrong default gateway (Option 3)" },
  { id: "wrong-option6", label: "The DHCP scope hands out a wrong DNS server (Option 6)" },
  { id: "dns-server-down", label: "The DNS service on DNS-SRV isn't running" },
  { id: "stale-cache", label: "The client's DNS cache still holds the old address" },
  { id: "cable", label: "The client's cable / switch port is broken" },
];
/** Where the user's traffic stops, as an engineer would prove it. */
export const DL_LOCATIONS: { id: DlNode; label: string }[] = [
  { id: "CLIENT", label: "CLIENT: the traffic never leaves it, or never needs to" },
  { id: "SW1", label: "SW1: the client's access switch" },
  { id: "R1", label: "R1: it arrives at the router, but doesn't go on" },
  { id: "SW2", label: "SW2: the server-side switch" },
  { id: "DHCP-SRV", label: "DHCP-SRV: it arrives at the server, which doesn't give an address" },
  { id: "DNS-SRV", label: "DNS-SRV: it arrives at the server, which doesn't answer the name" },
];
export interface DlTicket {
  title: string;
  report: string;
  cause: DlCause;
  /** The last device the failing traffic provably reaches. */
  at: DlNode;
  setup: (s: DlState) => DlState;
  solved: (s: DlState) => boolean;
}
export const DL_TICKETS: Record<DlTicketId, DlTicket> = {
  "no-relay": {
    title: "No address at all",
    report: "“My new laptop shows 169.254-something and nothing works.”",
    cause: "no-relay",
    at: "R1",
    setup: (s) => ({ ...s, config: { ...s.config, relay: false } }),
    solved: (s) => s.client.phase === "BOUND" && s.lastResult?.kind === "resolve" && s.lastResult.ok,
  },
  "dns-option": {
    title: "Names fail, IPs work",
    report: "“Websites don't open by name, but our IT person says pinging 203.0.113.80 works.”",
    cause: "wrong-option6",
    at: "R1",
    setup: (s) => ({ ...s, config: { ...s.config, option6: DL_WRONG.dns } }),
    solved: (s) => s.client.dns === DNS && s.lastResult?.kind === "resolve" && s.lastResult.ok,
  },
  pool: {
    title: "New laptops get nothing, old ones are fine",
    report: "“Everyone who was already here works. Every new laptop today gets 169.254.x.x.”",
    cause: "pool-exhausted",
    at: "DHCP-SRV",
    setup: (s) => ({ ...s, config: { ...s.config, poolFree: 0 } }),
    solved: (s) => s.client.phase === "BOUND",
  },
  "stale-cache": {
    title: "Some users still reach the old web server",
    report: "“We moved www.packetverse.test to a new server (203.0.113.81) a minute ago. This laptop still lands on the old one, which is now off.”",
    cause: "stale-cache",
    at: "CLIENT",
    setup: (s) => ({ ...s, records: { ...s.records, [DNS_NAME]: DL_WEB_NEW }, webMoved: true }),
    solved: (s) => s.lastResult?.kind === "resolve" && s.lastResult.ok && s.lastResult.text.includes(DL_WEB_NEW),
  },
  gateway: {
    title: "Has an address, but nothing works",
    report: "“My laptop got 10.10.10.50, but no website opens, by name or by IP.”",
    cause: "wrong-option3",
    at: "CLIENT",
    setup: (s) => ({ ...s, config: { ...s.config, option3: DL_WRONG.gw } }),
    solved: (s) => s.client.gw === RC && s.lastResult?.ok === true,
  },
  "dns-service": {
    title: "Nobody can open anything by name",
    report: "“Since this morning, no website opens by name. Pinging the DNS server works fine, so it can't be the server.”",
    cause: "dns-server-down",
    at: "DNS-SRV",
    setup: (s) => ({ ...s, config: { ...s.config, dnsUp: false } }),
    solved: (s) => s.config.dnsUp && s.lastResult?.kind === "resolve" && s.lastResult.ok,
  },
};

/** Bring a fresh state to the moment the ticket is reported. */
function prepareTicket(id: DlTicketId): DlState {
  let s = createDlState();
  if (id === "stale-cache") {
    s = sendAck(sendRequest(sendDiscover(s)));
    s = resolve(s, DNS_NAME);
    s = DL_TICKETS[id].setup(s);
    s = { ...s, clock: s.clock + 60 };
  } else if (id === "gateway" || id === "dns-option" || id === "dns-service") {
    s = DL_TICKETS[id].setup(s);
    s = sendAck(sendRequest(sendDiscover(s)));
  } else {
    s = DL_TICKETS[id].setup(s);
  }
  // The ticket starts from what the user has now; earlier traffic and counters belong to before the report.
  return { ...s, capture: [], lastPackets: [], lastResult: undefined, net: { ...s.net, counters: createDlNet().counters, relay: createDlNet().relay } };
}

// ---------------------------------------------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------------------------------------------
export type DlAction =
  | { type: "dhcp-next" }
  | { type: "dhcp-all" }
  | { type: "renew" }
  | { type: "release" }
  | { type: "time"; to: number }
  | { type: "resolve"; name: string; direct?: boolean }
  | { type: "ping"; dst: string }
  | { type: "flush" }
  | { type: "config"; patch: Partial<DlConfig> }
  | { type: "migrate" }
  | { type: "ticket"; id: DlTicketId }
  | { type: "diagnose"; cause: DlCause; at?: DlNode }
  | { type: "healthy" }
  /** Level 7: load the learner's own build network (their configuration so far). */
  | { type: "build-start"; config: DlConfig; records: Record<string, string> }
  /** Level 7: apply one device's configuration (DHCP-SRV restarts dhcpd, DNS-SRV reloads its zone). */
  | { type: "build-apply"; device: "DHCP-SRV" | "R1" | "DNS-SRV"; config?: Partial<DlConfig>; records?: Record<string, string>; zoneError?: string }
  /** A brand-new laptop plugs in (no settings, empty caches); its old lease is released on the server. */
  | { type: "new-client" }
  /** Ping whatever gateway the client was given. */
  | { type: "ping-gateway" }
  /** ping <name>: resolve it (cache first), then ping the address. */
  | { type: "ping-name"; name: string }
  /** Put back a whole earlier state (returning to an investigation after a detour). */
  | { type: "restore"; state: DlState };

export function dhcpNextLabel(c: DlClient): string {
  if (c.phase === "INIT") return c.retries ? "Retransmit DHCPDISCOVER" : "Send DHCPDISCOVER";
  if (c.phase === "SELECTING") return "Send DHCPREQUEST";
  if (c.phase === "REQUESTING") return "Receive DHCPACK";
  if (c.phase === "APIPA") return "Try DHCP again (DISCOVER)";
  return "Lease active";
}

function step(s: DlState): DlState {
  const c = s.client;
  if (c.phase === "INIT") return sendDiscover(s);
  if (c.phase === "APIPA") return sendDiscover({ ...s, client: { phase: "INIT", xid: c.xid + 1, retries: 0 } });
  if (c.phase === "SELECTING") return sendRequest(s);
  if (c.phase === "REQUESTING") return sendAck(s);
  return s;
}

function afterAction(prev: DlState, s: DlState): DlState {
  const t = s.ticket;
  if (!t || t.solved || t.diagnosed !== DL_TICKETS[t.id].cause) return s;
  if (s.seq === prev.seq) return s;
  if (DL_TICKETS[t.id].solved(s)) return push(s, [{ text: `Ticket “${DL_TICKETS[t.id].title}” resolved and verified`, kind: "learn" }], { ticket: { ...t, solved: true } });
  return s;
}

function apply(s: DlState, a: DlAction): DlState {
  switch (a.type) {
    case "dhcp-next":
      return afterAction(s, step(s));
    case "dhcp-all": {
      let st = s;
      for (let i = 0; i < 6 && !configured(st.client) && !(i > 0 && st.client.phase === "APIPA"); i++) st = step(st);
      return afterAction(s, st);
    }
    case "renew":
      if (!configured(s.client)) return push(s, [{ text: "Nothing to renew: the client has no lease. Run the DHCP exchange.", kind: "warning" }]);
      return afterAction(s, manualRenew(s));
    case "release": {
      if (!configured(s.client)) return s;
      const C = cip(s);
      const j = `${s.seq}:release`;
      const a1 = clientArp(s, s.client.gw!, j);
      let st = a1.s;
      if (a1.ok) {
        const leg: Leg = { path: ["CLIENT", "SW1", "R1", "SW2", "DHCP-SRV"], frames: F.clientToServerLan(MAC.SRV), ttl: 64, texts: { CLIENT: "CLIENT tells its server it no longer needs the address (unicast)." }, end: dhcpRunning(st.config) ? { act: "deliver", text: "DHCP-SRV marks the lease free again." } : { act: "reject", text: SRV_DOWN } };
        st = addPackets(st, [build({ src: C, dst: SRV, proto: "DHCP", msg: "RELEASE", journey: j, info: "DHCP Release", color: "amber", layers: [eth(MAC.CLIENT, MAC.R1C), ip(C, SRV), udp(68, 67), dhcp("RELEASE", { xid: s.client.xid + 1, ciaddr: C })], path: leg.path, leg })]);
        if (dhcpRunning(st.config)) st = srvLog({ ...st, net: { ...st.net, leases: st.net.leases.map((l) => (l.ip === C ? { ...l, state: "free" as const } : l)) }, config: { ...st.config, poolFree: st.config.poolFree + 1 } }, "DHCP-SRV", `DHCPRELEASE of ${C} from ${cmac}`);
      }
      return push(st, [{ text: `Released ${C}: back to INIT${a1.ok ? "" : " (the RELEASE itself couldn't be sent: the gateway doesn't answer ARP)"}`, kind: "info" }], { client: { phase: "INIT", xid: s.client.xid + 2, retries: 0 } });
    }
    case "time":
      return afterAction(s, advance(s, a.to));
    case "resolve":
      return afterAction(s, resolve(s, a.name, a.direct));
    case "ping":
      return afterAction(s, pingIp(s, a.dst));
    case "flush":
      return afterAction(s, push(s, [{ text: "Client DNS cache flushed", kind: "info" }], { cache: [], lastResult: undefined }));
    case "config": {
      const config = { ...s.config, ...a.patch };
      const what = Object.entries(a.patch).map(([k, v]) => `${k} = ${v}`).join(", ");
      return afterAction(s, push(s, [{ text: `Configuration changed: ${what}.${"option3" in a.patch || "option6" in a.patch ? " Existing leases are NOT rewritten; clients pick it up when they renew or re-acquire." : ""}`, kind: "info" }], { config }));
    }
    case "migrate":
      return push(s, [{ text: `DNS record changed: ${DNS_NAME} A ${DL_WEB_NEW} (the old server ${DL_WEB_OLD} is switched off). Cached answers stay valid until their TTL runs out.`, kind: "warning" }], { records: { ...s.records, [DNS_NAME]: DL_WEB_NEW }, webMoved: true });
    case "ticket": {
      const t = DL_TICKETS[a.id];
      const prepared = prepareTicket(a.id);
      return push({ ...prepared, log: s.log, seq: s.seq }, [{ text: `Ticket “${t.title}”: ${t.report}`, kind: "warning" }], { ticket: { id: a.id, solved: false } });
    }
    case "diagnose": {
      if (!s.ticket) return s;
      const tk = DL_TICKETS[s.ticket.id];
      const causeOk = tk.cause === a.cause;
      const atOk = a.at === undefined || a.at === tk.at;
      const right = causeOk && atOk;
      return push(
        s,
        [{ text: right ? "Diagnosis fits the evidence. Fix it, then prove it from the client." : !atOk ? "The evidence doesn't stop where you said. Follow the failing traffic again, point by point." : "That cause doesn't fit the evidence yet: compare what each observation point saw.", kind: right ? "learn" : "warning" }],
        { ticket: { ...s.ticket, diagnosed: right ? a.cause : s.ticket.diagnosed, at: right ? (a.at ?? tk.at) : s.ticket.at, wrong: causeOk ? undefined : a.cause, wrongAt: atOk ? undefined : a.at } },
      );
    }
    case "healthy":
      return push({ ...createDlState(), log: s.log, seq: s.seq }, [{ text: "Healthy network, fresh client", kind: "info" }]);
    case "build-start": {
      const base = createDlState();
      return push({ ...base, config: { ...a.config, poolFree: scopeSize(a.config) }, records: { ...a.records }, log: s.log, seq: s.seq }, [{ text: "Build network loaded: your configuration so far on DHCP-SRV, R1 and DNS-SRV. A new laptop is plugged in.", kind: "info" }]);
    }
    case "build-apply": {
      if (a.device === "DNS-SRV" && a.zoneError) return push(srvLog(s, "DNS-SRV", "received control channel command 'reload'", `zone packetverse.test/IN: ${a.zoneError}`, "zone packetverse.test/IN: not loaded due to errors."), [{ text: "DNS-SRV: named was asked to reload; the zone file has an error, so named keeps serving the version it loaded before.", kind: "warning" }]);
      if (a.device === "DNS-SRV") {
        const records = { ...(a.records ?? s.records) };
        return push(srvLog({ ...s, records }, "DNS-SRV", `zone packetverse.test/IN: loaded serial ${s.seq + 1} (${Object.keys(records).length} A record${Object.keys(records).length === 1 ? "" : "s"})`), [{ text: `DNS-SRV: zone packetverse.test reloaded with ${Object.keys(records).length} record(s). Cached answers on clients keep their old values until they expire.`, kind: "info" }]);
      }
      const config = { ...s.config, ...a.config };
      if (a.device === "R1") return push({ ...s, config }, [{ text: config.relay ? `R1: ip helper-address ${config.helper} on ${config.helperIf}` : "R1: no DHCP relay configured", kind: "info" }]);
      const started = { ...config, serverUp: true };
      const problem = dhcpProblem(started);
      const active = s.net.leases.filter((l) => l.state === "active").length;
      const next = { ...started, poolFree: Math.max(0, scopeSize(started) - active) };
      const lines = problem ? [`Configuration error: ${problem}.`, "Not starting: fix /etc/dhcp/dhcpd.conf and restart."] : ["Server starting: listening on eth0 (10.20.20.0/24)", next.scope ? `Serving subnet ${next.scope.net}/24: range ${next.scope.start} – ${next.scope.end}, routers ${next.option3 || "(none)"}, DNS ${next.option6 || "(none)"}` : "No subnet declared for any client network: requests from relays will be ignored."];
      return push(srvLog({ ...s, config: next }, "DHCP-SRV", ...lines), [{ text: problem ? `DHCP-SRV: dhcpd failed to start (${problem})` : "DHCP-SRV: dhcpd restarted with your configuration. Existing leases keep their old options until they renew.", kind: problem ? "warning" : "info" }]);
    }
    case "restore":
      return { ...a.state, seq: Math.max(s.seq, a.state.seq) + 1 };
    case "new-client": {
      const freed = s.net.leases.filter((l) => l.mac === cmac && l.state === "active").length;
      const leases = s.net.leases.filter((l) => l.mac !== cmac);
      const arpR1 = Object.fromEntries(Object.entries(s.net.arp.R1).filter(([ip]) => !inClientLan(ip)));
      return push({ ...s, client: { phase: "INIT", xid: s.client.xid + 7, retries: 0 }, cache: [], lastResult: undefined, net: { ...s.net, leases, arp: { CLIENT: {}, R1: arpR1 } }, config: { ...s.config, poolFree: s.config.poolFree + freed } }, [{ text: "A new laptop is plugged in: no address, no settings, empty caches.", kind: "info" }]);
    }
    case "ping-gateway":
      if (!configured(s.client)) return push(s, [{ text: "No gateway to ping: the laptop has no settings.", kind: "warning" }], { lastResult: { kind: "ping", ok: false, text: "No default gateway: the laptop has no settings" } });
      return afterAction(s, pingIp(s, s.client.gw!));
    case "ping-name": {
      const name = a.name.trim().toLowerCase();
      const hit = s.cache.find((e) => e.name === name && e.expires > s.clock);
      const r = hit ? s : resolve(s, name);
      const ipFor = r.cache.find((e) => e.name === name && e.expires > r.clock)?.ip;
      if (!ipFor) return push(r, [{ text: `ping ${name}: could not resolve the name`, kind: "warning" }], { lastResult: { kind: "ping", ok: false, text: `Ping request could not find host ${name}. Please check the name and try again.` } });
      const before = r.capture.length ? r.capture[r.capture.length - 1].no : 0;
      const pr = pingIp(r, ipFor);
      const newer = pr.capture.filter((p) => p.no > before).map((p) => p.no);
      return afterAction(s, { ...pr, lastPackets: [...(hit ? [] : r.lastPackets), ...newer], lastResult: pr.lastResult ? { ...pr.lastResult, text: `ping ${name} [${ipFor}]: ${pr.lastResult.text}` } : undefined });
    }
  }
}

/** Every packet an action produced counts as that action's packets (a renewal is REQUEST + ACK, not just the ACK). */
function applyAction(s: DlState, a: DlAction): DlState {
  if (a.type === "restore") return apply(s, a);
  const prevMax = s.capture.length ? s.capture[s.capture.length - 1].no : 0;
  const n = apply(s, a);
  if (n === s) return s;
  const fresh = a.type === "healthy" || a.type === "ticket";
  const sent = n.capture.filter((p) => (fresh ? true : p.no > prevMax)).map((p) => p.no);
  // An action that sends nothing and leaves the last result on screen (a diagnosis, a setting) keeps that result's
  // packets: otherwise "what just happened" would describe the lookup as "no packet was sent".
  if (!fresh && !sent.length && n.lastResult === s.lastResult && n.lastPackets === s.lastPackets) return n;
  return { ...n, lastPackets: sent };
}
export const DL_LAB_MODEL: LabModel<DlState, DlAction> = { initial: createDlState, hops: () => 0, start: applyAction, arrive: (s) => s, revision: (s) => s.seq };
export const DL_ADDR = { C, SRV, DNS, RC, RS };

// ---------------------------------------------------------------------------------------------------------------
// Observation helpers (read-only views over the same packets)
// ---------------------------------------------------------------------------------------------------------------
/** Every frame that crossed one interface, oldest first. */
export function dlCaptureAt(s: DlState, iface: DlIface): { p: DlPacket; o: DlObs; hop?: DlHop }[] {
  const node = DL_IFACES[iface].node;
  const rows: { p: DlPacket; o: DlObs; hop?: DlHop }[] = [];
  for (const p of s.capture) for (const o of p.obs) if (o.iface === iface) rows.push({ p, o, hop: p.hops.find((h) => h.node === node && (o.dir === "in" ? h.in === iface : h.out.includes(iface))) });
  return rows;
}
/** All packets of one logical message (e.g. the client's DISCOVER and its relayed copy). */
export function dlJourney(s: DlState, journey: string): DlPacket[] {
  return s.capture.filter((p) => p.journey === journey);
}
/** The frame's headers as they were on one interface (MACs and TTL differ per link). */
export function dlLayersAt(p: DlPacket, o: DlObs): DlLayer[] {
  return p.layers.map((l) => {
    if (l.name === "Ethernet") return eth(o.srcMac, o.dstMac);
    if (l.name === "IPv4" && o.ttl !== undefined) return { ...l, fields: l.fields.map((f) => (f.k === "TTL" ? { ...f, v: String(o.ttl) } : f)) };
    return l;
  });
}
