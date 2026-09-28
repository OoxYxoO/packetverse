import type { PacketVisual, PVEvent, PVEventType, ScenarioStep } from "../types";
import type { ProcessingStage } from "@/components/network3d/types";
import type { FundHop } from "@/components/lesson/fundamentalsTrace";
import { dhcpPacket, dnsPacket, fieldOf, hex4, hex8, opt, packetStack, type DhcpMessage, type DhcpMessageType, type DnsMessage } from "./fundamentalsPackets";

/**
 * DHCP + DNS: From Boot to Name Resolution. CLIENT — SW1 — R1 — SW2 — {DHCP-SRV, DNS-SRV}.
 *
 * Modeled exactly (RFC 2131/2132 DHCP, RFC 1542 relay, RFC 1035 DNS):
 * - The client starts with no IPv4 configuration: DHCPDISCOVER/REQUEST from 0.0.0.0 to 255.255.255.255, UDP 68 → 67.
 * - Routers do not forward the limited broadcast. R1 is a DHCP relay agent: it sets giaddr = 10.10.10.1 (its
 *   client-facing address), increments hops, and unicasts to 10.20.20.10 (UDP 67 → 67). The server picks the pool
 *   from giaddr and replies to the relay; the client set the BROADCAST flag, so the relay broadcasts OFFER/ACK onto
 *   the client LAN (UDP 67 → 68). One transport model, used consistently.
 * - xid is constant through one DISCOVER/OFFER/REQUEST/ACK transaction. REQUEST (SELECTING) carries Option 50
 *   (Requested IP) and Option 54 (Server Identifier).
 * - Renewal (RENEWING) is a unicast REQUEST from the client's own address straight to the server (ciaddr set, no
 *   Option 50/54), answered by a unicast ACK — routed, not relayed.
 * - DNS: A query over UDP 53000 → 53 with RD set; the response echoes the Transaction ID, sets QR and RA, and
 *   answers www.packetverse.test A 203.0.113.80 with a record TTL of 300 s (unrelated to the IPv4 TTL).
 * - Fault: DHCP Option 6 misconfigured to 10.20.20.99. Fixing the server does NOT rewrite a lease the client
 *   already holds — the client must renew to learn the corrected option.
 */

export type DhDevice = "CLIENT" | "SW1" | "R1" | "SW2" | "DHCP-SRV" | "DNS-SRV";
export const DH_DEVICES: DhDevice[] = ["CLIENT", "SW1", "R1", "SW2", "DHCP-SRV", "DNS-SRV"];
export const DH_ADDR = { "R1:CLIENT": "10.10.10.1", "R1:SERVER": "10.20.20.1", "DHCP-SRV": "10.20.20.10", "DNS-SRV": "10.20.20.53", CLIENT: "10.10.10.50", WRONG_DNS: "10.20.20.99", WEB: "203.0.113.80" } as const;
export const DH_MAC = { CLIENT: "00:00:5E:00:53:30", "R1:CLIENT": "00:00:5E:00:53:31", "R1:SERVER": "00:00:5E:00:53:32", "DHCP-SRV": "00:00:5E:00:53:33", "DNS-SRV": "00:00:5E:00:53:34" } as const;
export const BCAST_MAC = "FF:FF:FF:FF:FF:FF";
export const MASK = "255.255.255.0";
export const LEASE_SECONDS = 86400;
export const DNS_NAME = "www.packetverse.test";
export const DNS_RECORD_TTL = 300;
export const CLIENT_DNS_PORT = 53000;
export const XID1 = 0x3903f326;
export const XID2 = 0x3903f327;
export const XID3 = 0x3903f328;
export const POOL = { subnet: "10.10.10.0/24", range: "10.10.10.50 – 10.10.10.150", router: DH_ADDR["R1:CLIENT"] };

export type ClientPhase = "INIT" | "SELECTING" | "REQUESTING" | "BOUND" | "RENEWING";
export interface ClientLease {
  phase: ClientPhase;
  ip?: string;
  mask?: string;
  gateway?: string;
  dns?: string;
  lease?: number;
  serverId?: string;
  xid?: number;
  offered?: string;
}
export interface DhState {
  hops: FundHop[];
  client: ClientLease;
  /** Configured on DHCP-SRV — what future leases will carry. */
  serverOption6: string;
  serverLeases: { mac: string; ip: string; xid: number; dns: string }[];
  relayed: { xid: number; giaddr: string; type: DhcpMessageType }[];
  dnsCache: { name: string; address: string; ttl: number }[];
  lastDns?: { id: number; server: string; result: "answered" | "no response" };
  packet?: PacketVisual;
  flood: { id: string; fromId: string; toId: string; packet: PacketVisual }[];
  note?: { device: DhDevice; text: string };
  faultActive: boolean;
  repairAttempt?: { choice: string; correct: boolean };
  repaired: boolean;
}
export const createDhState = (): DhState => ({ hops: [], client: { phase: "INIT" }, serverOption6: DH_ADDR["DNS-SRV"], serverLeases: [], relayed: [], dnsCache: [], flood: [], faultActive: false, repaired: false });

// ---------------------------------------------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------------------------------------------
const serverOptions = (t: DhcpMessageType, dns: string) => [opt.type(t), opt.serverId(DH_ADDR["DHCP-SRV"]), opt.lease(LEASE_SECONDS), opt.mask(MASK), opt.router(DH_ADDR["R1:CLIENT"]), opt.dns(dns)];
export function clientMsg(type: "DHCPDISCOVER" | "DHCPREQUEST", xid: number, o: { hops?: number; giaddr?: string; renew?: boolean } = {}): DhcpMessage {
  const options = type === "DHCPDISCOVER" ? [opt.type(type)] : o.renew ? [opt.type(type)] : [opt.type(type), opt.requestedIp(DH_ADDR.CLIENT), opt.serverId(DH_ADDR["DHCP-SRV"])];
  return { type, op: 1, xid, hops: o.hops ?? 0, broadcastFlag: !o.renew, ciaddr: o.renew ? DH_ADDR.CLIENT : "0.0.0.0", yiaddr: "0.0.0.0", giaddr: o.giaddr ?? "0.0.0.0", chaddr: DH_MAC.CLIENT, options };
}
export function serverMsg(type: "DHCPOFFER" | "DHCPACK", xid: number, dns: string, o: { renew?: boolean } = {}): DhcpMessage {
  return { type, op: 2, xid, hops: 0, broadcastFlag: !o.renew, ciaddr: o.renew ? DH_ADDR.CLIENT : "0.0.0.0", yiaddr: DH_ADDR.CLIENT, giaddr: o.renew ? "0.0.0.0" : DH_ADDR["R1:CLIENT"], chaddr: DH_MAC.CLIENT, options: serverOptions(type, dns) };
}
const ipOf = (src: string, dst: string, ttl: number, id: number) => ({ src, dst, ttl, id, df: false });

/** Each leg of a DHCP exchange as a real packet. */
export const dhcpLeg = {
  clientBroadcast: (id: string, m: DhcpMessage) => dhcpPacket({ id, from: "CLIENT", to: "SW1", ethSrc: DH_MAC.CLIENT, ethDst: BCAST_MAC, ip: ipOf("0.0.0.0", "255.255.255.255", 64, 0x0100 + (m.xid & 0xff)), srcPort: 68, dstPort: 67, dhcp: m }),
  relayToServer: (id: string, m: DhcpMessage, from: DhDevice, to: DhDevice) => dhcpPacket({ id, from, to, ethSrc: DH_MAC["R1:SERVER"], ethDst: DH_MAC["DHCP-SRV"], ip: ipOf(DH_ADDR["R1:SERVER"], DH_ADDR["DHCP-SRV"], 64, 0x0200 + (m.xid & 0xff)), srcPort: 67, dstPort: 67, dhcp: { ...m, hops: m.hops + 1, giaddr: DH_ADDR["R1:CLIENT"] } }),
  serverToRelay: (id: string, m: DhcpMessage, from: DhDevice, to: DhDevice) => dhcpPacket({ id, from, to, ethSrc: DH_MAC["DHCP-SRV"], ethDst: DH_MAC["R1:SERVER"], ip: ipOf(DH_ADDR["DHCP-SRV"], DH_ADDR["R1:CLIENT"], 64, 0x0300 + (m.xid & 0xff)), srcPort: 67, dstPort: 67, dhcp: m }),
  relayToClient: (id: string, m: DhcpMessage, from: DhDevice, to: DhDevice) => dhcpPacket({ id, from, to, ethSrc: DH_MAC["R1:CLIENT"], ethDst: BCAST_MAC, ip: ipOf(DH_ADDR["R1:CLIENT"], "255.255.255.255", 64, 0x0400 + (m.xid & 0xff)), srcPort: 67, dstPort: 68, dhcp: m }),
  renewRequest: (id: string, m: DhcpMessage, from: DhDevice, to: DhDevice, ttl: number, ethSrc: string, ethDst: string) => dhcpPacket({ id, from, to, ethSrc, ethDst, ip: ipOf(DH_ADDR.CLIENT, DH_ADDR["DHCP-SRV"], ttl, 0x0500), srcPort: 68, dstPort: 67, dhcp: m }),
  renewAck: (id: string, m: DhcpMessage, from: DhDevice, to: DhDevice, ttl: number, ethSrc: string, ethDst: string) => dhcpPacket({ id, from, to, ethSrc, ethDst, ip: ipOf(DH_ADDR["DHCP-SRV"], DH_ADDR.CLIENT, ttl, 0x0600), srcPort: 67, dstPort: 68, dhcp: m }),
};
export function dnsQuery(id: number): DnsMessage {
  return { id, response: false, rd: true, ra: false, qname: DNS_NAME };
}
export function dnsAnswer(id: number): DnsMessage {
  return { id, response: true, rd: true, ra: true, qname: DNS_NAME, answer: { address: DH_ADDR.WEB, ttl: DNS_RECORD_TTL } };
}
/** DNS legs. Client side: CLIENT ↔ R1 ge-0/0/0. Server side: R1 ge-0/0/1 ↔ DNS-SRV. */
export const dnsLeg = {
  query: (id: string, q: DnsMessage, server: string, side: "client" | "server", from: DhDevice, to: DhDevice) =>
    dnsPacket({ id, from, to, ethSrc: side === "client" ? DH_MAC.CLIENT : DH_MAC["R1:SERVER"], ethDst: side === "client" ? DH_MAC["R1:CLIENT"] : DH_MAC["DNS-SRV"], ip: ipOf(DH_ADDR.CLIENT, server, side === "client" ? 64 : 63, 0x0700 + (q.id & 0xff)), srcPort: CLIENT_DNS_PORT, dstPort: 53, dns: q }),
  answer: (id: string, a: DnsMessage, side: "server" | "client", from: DhDevice, to: DhDevice) =>
    dnsPacket({ id, from, to, ethSrc: side === "server" ? DH_MAC["DNS-SRV"] : DH_MAC["R1:CLIENT"], ethDst: side === "server" ? DH_MAC["R1:SERVER"] : DH_MAC.CLIENT, ip: ipOf(DH_ADDR["DNS-SRV"], DH_ADDR.CLIENT, side === "server" ? 64 : 63, 0x0800 + (a.id & 0xff)), srcPort: 53, dstPort: CLIENT_DNS_PORT, dns: a }),
};

// ---------------------------------------------------------------------------------------------------------------
// Stages + generic hops
// ---------------------------------------------------------------------------------------------------------------
export const CLIENT_STAGES: ProcessingStage[] = [
  { id: "state", label: "DHCP client state" },
  { id: "build", label: "Build message (DHCP or DNS)" },
  { id: "tx", label: "Transmit / receive" },
];
export const SWITCH_STAGES: ProcessingStage[] = [
  { id: "learn", label: "Learn source MAC" },
  { id: "lookup", label: "Look up destination MAC" },
  { id: "tx", label: "Forward / flood (frame unchanged)" },
];
export const RELAY_STAGES: ProcessingStage[] = [
  { id: "rx", label: "Receive on interface" },
  { id: "classify", label: "Limited broadcast → relay agent, unicast → route" },
  { id: "rewrite", label: "Relay: set giaddr, hops+1 · Route: TTL−1" },
  { id: "tx", label: "Send toward server / client" },
];
export const SERVER_STAGES: ProcessingStage[] = [
  { id: "rx", label: "Receive request" },
  { id: "select", label: "Select pool / look up record" },
  { id: "reply", label: "Build reply" },
];
const withDetail = (base: ProcessingStage[], d: Partial<Record<string, string>>): ProcessingStage[] => base.map((x) => (d[x.id] ? { ...x, detail: d[x.id] } : x));
const ev = (type: PVEventType, stepId: string, message: string): PVEvent => ({ type, stepId, timestamp: Date.now(), message });
const push = (s: DhState, hop: FundHop, patch: Partial<DhState> = {}): DhState => ({ ...s, ...patch, hops: [...s.hops, hop] });
const idle = (s: DhState): DhState => ({ ...s, packet: undefined, flood: [], note: undefined });

const summaryOf = (p: PacketVisual) => (fieldOf(p, /^DHCP/, "xid") ? `${p.layers.find((l) => /^DHCP/.test(l.name))!.name.replace("DHCP (BOOTP) — ", "")} xid ${fieldOf(p, /^DHCP/, "xid")}` : `DNS ${fieldOf(p, /^DNS/, "Transaction ID")}`);

function switchHop(s: DhState, stepId: string, sw: "SW1" | "SW2", inPort: string, outPort: string, pkt: PacketVisual, to: DhDevice, flood = false): DhState {
  const dst = fieldOf(pkt, /^Ethernet/, "Destination MAC");
  const hop: FundHop = {
    stepId,
    device: sw,
    stages: withDetail(SWITCH_STAGES, { learn: `${fieldOf(pkt, /^Ethernet/, "Source MAC")} on ${inPort}`, lookup: dst === BCAST_MAC ? "broadcast" : `${dst} → ${outPort}`, tx: flood ? `flood → ${outPort} (only other port in the LAN)` : `out ${outPort}` }),
    activeStageId: "tx",
    ingressInterfaceId: inPort,
    egressInterfaceId: outPort,
    lookupType: "FDB (MAC table)",
    lookupKey: dst,
    lookupResult: dst === BCAST_MAC ? "broadcast — flood" : `${dst} → ${outPort}`,
    action: flood ? "FLOOD" : "FORWARD",
    reason: dst === BCAST_MAC ? `A broadcast frame is flooded to every other port in this LAN. ${sw} never looks inside the IPv4/UDP/${fieldOf(pkt, /^DHCP/, "xid") ? "DHCP" : "DNS"} payload.` : `Known unicast by destination MAC; ${sw} doesn't read the IP header.`,
    input: summaryOf(pkt),
    output: `same frame out ${outPort}`,
    nextHopId: to,
    before: packetStack(pkt),
    after: packetStack(pkt),
  };
  return push(s, hop, { packet: { ...pkt, id: `${pkt.id}-${sw}`, from: sw, to }, flood: [], note: { device: sw, text: `${sw}: ${flood ? "broadcast flood" : "forward"}` } });
}
function clientHop(stepId: string, action: string, detail: { state: string; build: string; tx: string }, reason: string, input: string, output: string, pkt?: PacketVisual): FundHop {
  return { stepId, device: "CLIENT", stages: withDetail(CLIENT_STAGES, detail), activeStageId: "tx", egressInterfaceId: "eth0", lookupType: "DHCP client / resolver", lookupKey: detail.state, lookupResult: detail.build, action, reason, input, output, nextHopId: "SW1", after: pkt ? packetStack(pkt) : undefined };
}
function r1Hop(stepId: string, mode: "relay" | "route" | "drop", inIface: string, outIface: string | undefined, detail: Partial<Record<string, string>>, lookup: string, reason: string, input: string, output: string, before?: PacketVisual, after?: PacketVisual, mutations?: FundHop["mutations"]): FundHop {
  return { stepId, device: "R1", stages: withDetail(RELAY_STAGES, detail), activeStageId: mode === "drop" ? "classify" : "tx", ingressInterfaceId: inIface, egressInterfaceId: outIface, lookupType: mode === "relay" ? "DHCP relay agent" : "IPv4 routing", lookupKey: input, lookupResult: lookup, action: mode === "relay" ? "RELAY" : mode === "route" ? "ROUTE" : "DROP", reason, input, output, nextHopId: outIface === "ge-0/0/0" ? "SW1" : outIface ? "SW2" : undefined, before: before ? packetStack(before) : undefined, after: after ? packetStack(after, ["eth", "ip"]) : undefined, mutations };
}
function serverHop(stepId: string, device: "DHCP-SRV" | "DNS-SRV", detail: Partial<Record<string, string>>, lookup: string, action: string, reason: string, input: string, output: string, pkt?: PacketVisual): FundHop {
  return { stepId, device, stages: withDetail(SERVER_STAGES, detail), activeStageId: "reply", ingressInterfaceId: "eth0", egressInterfaceId: "eth0", lookupType: device === "DHCP-SRV" ? "Scope selection" : "DNS records", lookupKey: input, lookupResult: lookup, action, reason, input, output, nextHopId: "SW2", after: pkt ? packetStack(pkt) : undefined };
}

// ---------------------------------------------------------------------------------------------------------------
// Repair
// ---------------------------------------------------------------------------------------------------------------
export const DH_REPAIR_OPTIONS = [
  { id: "fix-and-renew", label: "Set DHCP Option 6 to 10.20.20.53, then renew the client's lease" },
  { id: "fix-only", label: "Set DHCP Option 6 to 10.20.20.53 (nothing else)" },
  { id: "gateway", label: "Change the client's default gateway" },
  { id: "flush-fdb", label: "Flush SW1's MAC table" },
  { id: "restart-dns", label: "Restart DNS-SRV without changing Option 6" },
  { id: "web-ip", label: "Change the web server's IP address" },
] as const;
export const DH_REPAIR_CORRECT = "fix-and-renew";
export function applyDhRepair(s: DhState, choice: string): DhState {
  const correct = choice === DH_REPAIR_CORRECT;
  if (!correct) return { ...s, repairAttempt: { choice, correct } };
  return { ...s, repairAttempt: { choice, correct }, repaired: true, serverOption6: DH_ADDR["DNS-SRV"], note: { device: "DHCP-SRV", text: "Option 6 → 10.20.20.53 · client renewal next" } };
}

// ---------------------------------------------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------------------------------------------
const pkt = (s: DhState) => s.packet!;
const DISCOVER = clientMsg("DHCPDISCOVER", XID1);
const REQUEST = clientMsg("DHCPREQUEST", XID1);
const QID1 = 0x6c2a;
const QID_FAULT = 0x6c2b;
const QID_DIG = 0x6c2c;
const QID_VERIFY = 0x6c2d;

export const dhcpDnsSteps: ScenarioStep<DhState>[] = [
  {
    id: "intro",
    label: "From power-on to a name",
    narrative: `A laptop (CLIENT) boots on the 10.10.10.0/24 LAN. By the end it must have an IPv4 address, a gateway, a DNS server — and be able to turn ${DNS_NAME} into an address. DHCP-SRV and DNS-SRV live on another subnet, behind R1.`,
  },
  {
    id: "why-dhcp",
    label: "Why DHCP exists",
    narrative: "Typing an address, mask, gateway and DNS server into every device doesn't scale and invites mistakes. DHCP leases all four from a central server — to a client that, at first, has no usable IPv4 configuration at all.",
  },
  {
    id: "client-init",
    label: "CLIENT: INIT",
    narrative: `CLIENT is in the INIT state: no address, no gateway, no DNS. It knows only its MAC address (${DH_MAC.CLIENT}).`,
    run: (s) => ({ state: push(idle(s), clientHop("client-init", "INIT", { state: "INIT — no IPv4 config", build: "nothing configured yet", tx: "prepare DHCPDISCOVER" }, "With no address and no idea where a DHCP server is, the client can only broadcast.", "power on", "INIT")), events: [] }),
  },
  {
    id: "predict-src",
    label: "Predict: the Discover's addresses",
    narrative: "The client is about to send its first DHCP message.",
    question: {
      prompt: "Which IPv4 source and destination does the DHCPDISCOVER use?",
      options: [
        { id: "zero-bcast", label: "Source 0.0.0.0 → destination 255.255.255.255" },
        { id: "gw", label: "Its future address → the gateway" },
        { id: "server", label: "0.0.0.0 → the DHCP server's address" },
        { id: "apipa", label: "169.254.x.x → 10.20.20.10" },
      ],
      correctOptionId: "zero-bcast",
      explanation: "The client has no address yet (0.0.0.0) and doesn't know where any server is, so it sends to the limited broadcast 255.255.255.255, over UDP from port 68 to port 67.",
    },
  },
  {
    id: "discover-send",
    label: "DHCPDISCOVER",
    narrative: `CLIENT broadcasts DHCPDISCOVER: op 1, xid ${hex8(XID1)}, chaddr ${DH_MAC.CLIENT}, ciaddr/yiaddr/giaddr 0.0.0.0, the BROADCAST flag set, Option 53 = Discover. It moves to SELECTING.`,
    run: (s) => {
      const p = dhcpLeg.clientBroadcast("discover", DISCOVER);
      return { state: push({ ...idle(s), client: { phase: "SELECTING", xid: XID1 }, packet: p, note: { device: "CLIENT", text: "CLIENT: INIT → SELECTING" } }, clientHop("discover-send", "DHCPDISCOVER", { state: "INIT → SELECTING", build: `DHCPDISCOVER xid ${hex8(XID1)}`, tx: "broadcast 0.0.0.0 → 255.255.255.255, UDP 68 → 67" }, "The client asks any DHCP server on its broadcast domain for an offer.", "no configuration", "DHCPDISCOVER (broadcast)", p)), events: [ev("PACKET_SENT", "discover-send", "DHCPDISCOVER")] };
    },
    packet: pkt,
  },
  {
    id: "discover-flood",
    label: "SW1 floods the broadcast",
    narrative: "SW1 floods the broadcast frame out every other port of the client LAN — here, only toward R1.",
    run: (s) => ({ state: switchHop(s, "discover-flood", "SW1", "p1", "p2", pkt(s), "R1", true), events: [ev("PACKET_SENT", "discover-flood", "SW1 floods")] }),
    packet: pkt,
  },
  {
    id: "predict-relay",
    label: "Predict: crossing R1",
    narrative: "DHCP-SRV is on 10.20.20.0/24, on the other side of R1.",
    packet: pkt,
    question: {
      prompt: "Why doesn't the DHCPDISCOVER simply cross R1 as a broadcast?",
      options: [
        { id: "relay", label: "Routers don't forward limited broadcasts — R1 must act as a DHCP relay agent" },
        { id: "ttl", label: "Its TTL is 1" },
        { id: "port", label: "UDP 67 is blocked by R1" },
        { id: "vlan", label: "Because the server is in another VLAN tag" },
      ],
      correctOptionId: "relay",
      explanation: "255.255.255.255 is confined to its own link. A relay agent on R1 receives it on UDP 67 and re-sends the DHCP message as unicast to the configured server.",
    },
  },
  {
    id: "relay-discover",
    label: "R1 relays the Discover",
    narrative: `R1's relay agent sets giaddr = ${DH_ADDR["R1:CLIENT"]} (its client-facing address), increments hops to 1, and unicasts the message to ${DH_ADDR["DHCP-SRV"]} from ${DH_ADDR["R1:SERVER"]}, UDP 67 → 67. The original broadcast frame stops at R1.`,
    run: (s) => {
      const out = dhcpLeg.relayToServer("relay-discover", DISCOVER, "R1", "SW2");
      return {
        state: push({ ...s, packet: out, flood: [], relayed: [...s.relayed, { xid: XID1, giaddr: DH_ADDR["R1:CLIENT"], type: "DHCPDISCOVER" }], note: { device: "R1", text: `R1 relay: giaddr ${DH_ADDR["R1:CLIENT"]} → ${DH_ADDR["DHCP-SRV"]}` } }, r1Hop("relay-discover", "relay", "ge-0/0/0", "ge-0/0/1", { rx: "ge-0/0/0 · broadcast to UDP 67", classify: "limited broadcast → relay agent", rewrite: `giaddr ${DH_ADDR["R1:CLIENT"]} · hops 0 → 1`, tx: `unicast → ${DH_ADDR["DHCP-SRV"]}` }, `helper ${DH_ADDR["DHCP-SRV"]}`, "The relay turns the local broadcast into a unicast to the server and records which subnet it came from in giaddr.", "DHCPDISCOVER (broadcast)", `DHCPDISCOVER → ${DH_ADDR["DHCP-SRV"]}`, pkt(s), out)),
        events: [ev("PACKET_SENT", "relay-discover", "relayed DISCOVER")],
      };
    },
    packet: pkt,
  },
  {
    id: "discover-server",
    label: "The Discover reaches DHCP-SRV",
    narrative: "SW2 switches the relayed unicast to DHCP-SRV.",
    run: (s) => ({ state: switchHop(s, "discover-server", "SW2", "p1", "p2", pkt(s), "DHCP-SRV"), events: [ev("PACKET_RECEIVED", "discover-server", "server receives")] }),
    packet: pkt,
  },
  {
    id: "predict-giaddr",
    label: "Predict: which pool?",
    narrative: "DHCP-SRV serves many subnets.",
    packet: pkt,
    question: {
      prompt: "Which field lets DHCP-SRV know which client subnet the request came from?",
      options: [
        { id: "giaddr", label: "giaddr — the relay's client-facing address, 10.10.10.1" },
        { id: "ciaddr", label: "ciaddr — the client's current address" },
        { id: "srcip", label: "The IPv4 source address 10.20.20.1" },
        { id: "chaddr", label: "chaddr — the client's MAC address" },
      ],
      correctOptionId: "giaddr",
      explanation: "giaddr = 10.10.10.1 falls in 10.10.10.0/24, so the server uses that scope. ciaddr is 0.0.0.0, and the IP source is the relay's server-side interface.",
    },
  },
  {
    id: "server-offer",
    label: "DHCPOFFER",
    narrative: `giaddr ${DH_ADDR["R1:CLIENT"]} selects scope ${POOL.subnet}. DHCP-SRV offers yiaddr ${DH_ADDR.CLIENT} with Option 53 Offer, 54 Server Identifier ${DH_ADDR["DHCP-SRV"]}, 51 Lease ${LEASE_SECONDS} s, 1 Mask ${MASK}, 3 Router ${DH_ADDR["R1:CLIENT"]}, 6 DNS ${s0dns()} — sent back to the relay (UDP 67 → 67).`,
    run: (s) => {
      const out = dhcpLeg.serverToRelay("offer", serverMsg("DHCPOFFER", XID1, s.serverOption6), "DHCP-SRV", "SW2");
      return { state: push({ ...s, packet: out, flood: [], note: { device: "DHCP-SRV", text: `offer ${DH_ADDR.CLIENT} from scope ${POOL.subnet}` } }, serverHop("server-offer", "DHCP-SRV", { rx: `DHCPDISCOVER · giaddr ${DH_ADDR["R1:CLIENT"]}`, select: `scope ${POOL.subnet} → ${DH_ADDR.CLIENT}`, reply: `DHCPOFFER → relay ${DH_ADDR["R1:CLIENT"]}` }, `scope ${POOL.subnet} (${POOL.range})`, "DHCPOFFER", "The server matches giaddr to a scope, picks a free address, and replies to the relay because giaddr is set.", `DHCPDISCOVER xid ${hex8(XID1)}`, `DHCPOFFER yiaddr ${DH_ADDR.CLIENT}`, out)), events: [ev("PACKET_SENT", "server-offer", "DHCPOFFER")] };
    },
    packet: pkt,
  },
  {
    id: "offer-relay",
    label: "R1 relays the Offer",
    narrative: `The client set the BROADCAST flag and has no address yet, so R1 broadcasts the Offer onto 10.10.10.0/24: ${DH_ADDR["R1:CLIENT"]} → 255.255.255.255, UDP 67 → 68.`,
    run: (s) => {
      const sw = switchHop(s, "offer-relay", "SW2", "p2", "p1", pkt(s), "R1");
      const out = dhcpLeg.relayToClient("offer-relay", serverMsg("DHCPOFFER", XID1, s.serverOption6), "R1", "SW1");
      return { state: push({ ...sw, packet: out, note: { device: "R1", text: "R1 relay: broadcast flag → broadcast to client LAN" } }, r1Hop("offer-relay", "relay", "ge-0/0/1", "ge-0/0/0", { rx: "ge-0/0/1 · unicast to UDP 67 (from server)", classify: "server reply → relay agent", rewrite: "broadcast flag set → deliver as broadcast", tx: "255.255.255.255 on ge-0/0/0" }, "BROADCAST flag 1", "The relay delivers the server's reply on the client's LAN. With the BROADCAST flag set it uses the limited broadcast rather than unicasting to an address the client hasn't configured.", "DHCPOFFER from server", "DHCPOFFER broadcast to client LAN", pkt(sw), out)), events: [ev("PACKET_SENT", "offer-relay", "relay → client LAN")] };
    },
    packet: pkt,
  },
  {
    id: "offer-client",
    label: "CLIENT receives the Offer",
    narrative: "SW1 floods the broadcast to CLIENT. CLIENT matches xid and chaddr and considers the offer (it could have received several).",
    run: (s) => {
      const sw = switchHop(s, "offer-client", "SW1", "p2", "p1", pkt(s), "CLIENT", true);
      return { state: push({ ...sw, client: { ...s.client, offered: DH_ADDR.CLIENT, serverId: DH_ADDR["DHCP-SRV"] } }, clientHop("offer-client", "OFFER RECEIVED", { state: "SELECTING", build: `offer ${DH_ADDR.CLIENT} from ${DH_ADDR["DHCP-SRV"]}`, tx: "received on UDP 68" }, "xid and chaddr match this client, so the offer is for it. The address is not configured yet — it's only an offer.", "DHCPOFFER", `offered ${DH_ADDR.CLIENT}`)), events: [ev("PACKET_RECEIVED", "offer-client", "offer received")] };
    },
    packet: pkt,
  },
  {
    id: "predict-request",
    label: "Predict: accepting the offer",
    narrative: "CLIENT will now broadcast a DHCPREQUEST.",
    question: {
      prompt: "Why does the DHCPREQUEST carry Option 54 (Server Identifier)?",
      options: [
        { id: "choose", label: "It names the server whose offer was chosen, so other offering servers can withdraw" },
        { id: "own", label: "It is the client's own new address" },
        { id: "gw", label: "It tells the relay which gateway to use" },
        { id: "dns", label: "It selects the DNS server" },
      ],
      correctOptionId: "choose",
      explanation: "In the SELECTING state the REQUEST is broadcast with Option 54 = the chosen server and Option 50 = the requested (offered) address. The client's own address isn't bound yet — ciaddr stays 0.0.0.0.",
    },
  },
  {
    id: "request-send",
    label: "DHCPREQUEST",
    narrative: `Broadcast DHCPREQUEST, same xid ${hex8(XID1)}: Option 53 Request, Option 50 Requested IP ${DH_ADDR.CLIENT}, Option 54 Server Identifier ${DH_ADDR["DHCP-SRV"]}. CLIENT → REQUESTING.`,
    run: (s) => {
      const p = dhcpLeg.clientBroadcast("request", REQUEST);
      return { state: push({ ...idle(s), client: { ...s.client, phase: "REQUESTING" }, packet: p, note: { device: "CLIENT", text: "CLIENT: SELECTING → REQUESTING" } }, clientHop("request-send", "DHCPREQUEST", { state: "SELECTING → REQUESTING", build: `Option 50 ${DH_ADDR.CLIENT} · Option 54 ${DH_ADDR["DHCP-SRV"]}`, tx: "broadcast, UDP 68 → 67" }, "The REQUEST is broadcast so every server that made an offer learns which one was accepted.", `offer ${DH_ADDR.CLIENT}`, "DHCPREQUEST (broadcast)", p)), events: [ev("PACKET_SENT", "request-send", "DHCPREQUEST")] };
    },
    packet: pkt,
  },
  {
    id: "request-relay",
    label: "R1 relays the Request",
    narrative: `SW1 floods it to R1; the relay again sets giaddr ${DH_ADDR["R1:CLIENT"]}, hops 1, and unicasts to ${DH_ADDR["DHCP-SRV"]}.`,
    run: (s) => {
      const sw = switchHop(s, "request-relay", "SW1", "p1", "p2", pkt(s), "R1", true);
      const out = dhcpLeg.relayToServer("relay-request", REQUEST, "R1", "SW2");
      return { state: push({ ...sw, packet: out, relayed: [...s.relayed, { xid: XID1, giaddr: DH_ADDR["R1:CLIENT"], type: "DHCPREQUEST" }], note: { device: "R1", text: `R1 relay: giaddr ${DH_ADDR["R1:CLIENT"]}` } }, r1Hop("request-relay", "relay", "ge-0/0/0", "ge-0/0/1", { rx: "ge-0/0/0 · broadcast to UDP 67", classify: "limited broadcast → relay agent", rewrite: `giaddr ${DH_ADDR["R1:CLIENT"]} · hops 0 → 1`, tx: `unicast → ${DH_ADDR["DHCP-SRV"]}` }, `helper ${DH_ADDR["DHCP-SRV"]}`, "Same relay treatment as the Discover.", "DHCPREQUEST (broadcast)", `DHCPREQUEST → ${DH_ADDR["DHCP-SRV"]}`, pkt(sw), out)), events: [ev("PACKET_SENT", "request-relay", "relayed REQUEST")] };
    },
    packet: pkt,
  },
  {
    id: "server-ack",
    label: "DHCPACK",
    narrative: `DHCP-SRV sees its own Server Identifier in Option 54, commits the lease (${DH_ADDR.CLIENT} → ${DH_MAC.CLIENT}) and sends DHCPACK with the same options, back to the relay.`,
    run: (s) => {
      const sw = switchHop(s, "server-ack", "SW2", "p1", "p2", pkt(s), "DHCP-SRV");
      const out = dhcpLeg.serverToRelay("ack", serverMsg("DHCPACK", XID1, s.serverOption6), "DHCP-SRV", "SW2");
      return { state: push({ ...sw, packet: out, serverLeases: [{ mac: DH_MAC.CLIENT, ip: DH_ADDR.CLIENT, xid: XID1, dns: s.serverOption6 }], note: { device: "DHCP-SRV", text: `lease committed ${DH_ADDR.CLIENT}` } }, serverHop("server-ack", "DHCP-SRV", { rx: `DHCPREQUEST · Option 54 ${DH_ADDR["DHCP-SRV"]}`, select: `commit ${DH_ADDR.CLIENT} for ${LEASE_SECONDS} s`, reply: "DHCPACK → relay" }, `lease ${DH_ADDR.CLIENT}`, "DHCPACK", "Option 54 names this server, so it commits the binding and acknowledges.", `DHCPREQUEST xid ${hex8(XID1)}`, "DHCPACK", out)), events: [ev("PACKET_SENT", "server-ack", "DHCPACK")] };
    },
    packet: pkt,
  },
  {
    id: "ack-relay",
    label: "R1 relays the ACK",
    narrative: "Relayed to the client LAN as a broadcast (the same model as the Offer).",
    run: (s) => {
      const sw = switchHop(s, "ack-relay", "SW2", "p2", "p1", pkt(s), "R1");
      const out = dhcpLeg.relayToClient("ack-relay", serverMsg("DHCPACK", XID1, s.serverOption6), "R1", "SW1");
      return { state: push({ ...sw, packet: out, note: { device: "R1", text: "R1 relay: broadcast to client LAN" } }, r1Hop("ack-relay", "relay", "ge-0/0/1", "ge-0/0/0", { rx: "ge-0/0/1 · from server", classify: "server reply → relay agent", rewrite: "broadcast flag set", tx: "255.255.255.255 on ge-0/0/0" }, "BROADCAST flag 1", "Consistent with the Offer: the client still has no configured address, so the ACK is broadcast on its LAN.", "DHCPACK from server", "DHCPACK broadcast", pkt(sw), out)), events: [ev("PACKET_SENT", "ack-relay", "relay → client LAN")] };
    },
    packet: pkt,
  },
  {
    id: "client-bound",
    label: "CLIENT: BOUND",
    narrative: `CLIENT applies the lease: ${DH_ADDR.CLIENT}/24 (mask ${MASK}), gateway ${DH_ADDR["R1:CLIENT"]}, DNS ${s0dns()}, lease ${LEASE_SECONDS} s (renewal normally begins at T1 = 50 %).`,
    run: (s) => {
      const sw = switchHop(s, "client-bound", "SW1", "p2", "p1", pkt(s), "CLIENT", true);
      const lease: ClientLease = { phase: "BOUND", ip: DH_ADDR.CLIENT, mask: MASK, gateway: DH_ADDR["R1:CLIENT"], dns: s.serverOption6, lease: LEASE_SECONDS, serverId: DH_ADDR["DHCP-SRV"], xid: XID1, offered: DH_ADDR.CLIENT };
      return { state: push({ ...sw, client: lease }, clientHop("client-bound", "BOUND", { state: "REQUESTING → BOUND", build: `${DH_ADDR.CLIENT}/24 · gw ${DH_ADDR["R1:CLIENT"]} · DNS ${s.serverOption6}`, tx: "DHCPACK received on UDP 68" }, "The ACK confirms the lease; the client configures everything the options carried.", "DHCPACK", `BOUND ${DH_ADDR.CLIENT}`)), events: [ev("PACKET_RECEIVED", "client-bound", "BOUND")] };
    },
    packet: pkt,
  },
  {
    id: "dora-summary",
    label: "DORA",
    narrative: "Discover → Offer → Request → Ack. 'DORA' is only a memory aid — the packets are DHCPDISCOVER, DHCPOFFER, DHCPREQUEST and DHCPACK, all sharing one xid.",
    run: (s) => ({ state: idle(s), events: [] }),
  },
  {
    id: "dns-why",
    label: "Why DNS?",
    narrative: `People remember names; packets need addresses. CLIENT now asks its DNS server (${s0dns()}, learned from Option 6) for the A record of ${DNS_NAME}.`,
  },
  {
    id: "dns-query",
    label: "DNS query",
    narrative: `UDP ${CLIENT_DNS_PORT} → 53 to ${s0dns()}: Transaction ID ${hex4(QID1)}, QR 0 (query), Opcode 0, RD 1, Question ${DNS_NAME} A IN. There's no answer in it yet.`,
    run: (s) => {
      const p = dnsLeg.query("q1", dnsQuery(QID1), s.client.dns!, "client", "CLIENT", "SW1");
      return { state: push({ ...idle(s), packet: p, note: { device: "CLIENT", text: `query to ${s.client.dns}` } }, clientHop("dns-query", "DNS QUERY", { state: "BOUND", build: `A ${DNS_NAME} · id ${hex4(QID1)}`, tx: `UDP ${CLIENT_DNS_PORT} → ${s.client.dns}:53 via ${s.client.gateway}` }, `The resolver asks the DNS server from its lease (${s.client.dns}). It's off-link, so the frame goes to the gateway.`, DNS_NAME, `query ${hex4(QID1)}`, p)), events: [ev("PACKET_SENT", "dns-query", "DNS query")] };
    },
    packet: pkt,
  },
  {
    id: "dns-route",
    label: "R1 routes the query",
    narrative: "SW1 forwards it to R1. This time R1 simply routes (a unicast IP packet): TTL 64 → 63, new Ethernet frame toward DNS-SRV.",
    run: (s) => {
      const sw = switchHop(s, "dns-route", "SW1", "p1", "p2", pkt(s), "R1");
      const out = dnsLeg.query("q1-r", dnsQuery(QID1), s.client.dns!, "server", "R1", "SW2");
      return { state: push({ ...sw, packet: out, note: { device: "R1", text: "R1: route (TTL 64 → 63)" } }, r1Hop("dns-route", "route", "ge-0/0/0", "ge-0/0/1", { rx: "ge-0/0/0 · unicast", classify: "unicast → route", rewrite: "TTL 64 → 63", tx: "ge-0/0/1 → DNS-SRV" }, "10.20.20.0/24 connected on ge-0/0/1", "An ordinary unicast query is routed like any IP packet — no relay involved.", `DNS query → ${s.client.dns}`, "forwarded, TTL 63", pkt(sw), out, [{ type: "TTL_CHANGE", detail: "64 → 63" }])), events: [ev("PACKET_SENT", "dns-route", "R1 routes query")] };
    },
    packet: pkt,
  },
  {
    id: "dns-server",
    label: "DNS-SRV answers",
    narrative: `SW2 delivers the query. DNS-SRV looks up ${DNS_NAME} and replies with the same Transaction ID ${hex4(QID1)}: QR 1, RA 1, answer A ${DH_ADDR.WEB}, TTL ${DNS_RECORD_TTL} s. UDP 53 → ${CLIENT_DNS_PORT}.`,
    run: (s) => {
      const sw = switchHop(s, "dns-server", "SW2", "p1", "p3", pkt(s), "DNS-SRV");
      const out = dnsLeg.answer("a1", dnsAnswer(QID1), "server", "DNS-SRV", "SW2");
      return { state: push({ ...sw, packet: out, lastDns: { id: QID1, server: DH_ADDR["DNS-SRV"], result: "answered" }, note: { device: "DNS-SRV", text: `answer ${DH_ADDR.WEB}` } }, serverHop("dns-server", "DNS-SRV", { rx: `query ${hex4(QID1)} for ${DNS_NAME}`, select: `A ${DH_ADDR.WEB} · TTL ${DNS_RECORD_TTL}`, reply: `response ${hex4(QID1)}` }, `${DNS_NAME} A ${DH_ADDR.WEB}`, "DNS RESPONSE", "The resolver answers the question, echoing the Transaction ID so the client can match it.", `query ${hex4(QID1)}`, `answer ${DH_ADDR.WEB}`, out)), events: [ev("PACKET_SENT", "dns-server", "DNS response")] };
    },
    packet: pkt,
  },
  {
    id: "dns-response-route",
    label: "The response comes back",
    narrative: "R1 routes the response back onto the client LAN (TTL 64 → 63).",
    run: (s) => {
      const sw = switchHop(s, "dns-response-route", "SW2", "p3", "p1", pkt(s), "R1");
      const out = dnsLeg.answer("a1-r", dnsAnswer(QID1), "client", "R1", "SW1");
      return { state: push({ ...sw, packet: out, note: { device: "R1", text: "R1: route (TTL 64 → 63)" } }, r1Hop("dns-response-route", "route", "ge-0/0/1", "ge-0/0/0", { rx: "ge-0/0/1 · unicast", classify: "unicast → route", rewrite: "TTL 64 → 63", tx: "ge-0/0/0 → CLIENT" }, "10.10.10.0/24 connected on ge-0/0/0", "Routed back like any unicast packet.", `DNS response ${hex4(QID1)}`, "forwarded, TTL 63", pkt(sw), out, [{ type: "TTL_CHANGE", detail: "64 → 63" }])), events: [ev("PACKET_SENT", "dns-response-route", "R1 routes response")] };
    },
    packet: pkt,
  },
  {
    id: "dns-resolved",
    label: "Name resolved",
    narrative: `CLIENT matches Transaction ID ${hex4(QID1)} and caches ${DNS_NAME} → ${DH_ADDR.WEB} for ${DNS_RECORD_TTL} s. It can now connect to the web server by name.`,
    run: (s) => {
      const sw = switchHop(s, "dns-resolved", "SW1", "p2", "p1", pkt(s), "CLIENT");
      return { state: push({ ...sw, dnsCache: [{ name: DNS_NAME, address: DH_ADDR.WEB, ttl: DNS_RECORD_TTL }] }, clientHop("dns-resolved", "RESOLVED", { state: "BOUND", build: `id ${hex4(QID1)} matches`, tx: `cache ${DNS_NAME} → ${DH_ADDR.WEB} (${DNS_RECORD_TTL} s)` }, "Same Transaction ID as the query, so this answer belongs to it.", `response ${hex4(QID1)}`, `${DNS_NAME} → ${DH_ADDR.WEB}`)), events: [ev("PACKET_RECEIVED", "dns-resolved", "resolved")] };
    },
    packet: pkt,
  },
  {
    id: "predict-dns-ttl",
    label: "Predict: two TTLs",
    narrative: `The answer carried "TTL 300", and the IPv4 header of the same packet carried TTL 63.`,
    question: {
      prompt: "Is the DNS record TTL the same thing as the IPv4 TTL?",
      options: [
        { id: "no", label: "No — DNS TTL is how long to cache the answer (seconds); IPv4 TTL is a hop limit" },
        { id: "yes", label: "Yes — both count router hops" },
        { id: "sum", label: "The DNS TTL is the sum of all IPv4 TTLs on the path" },
        { id: "sec", label: "Both are measured in seconds" },
      ],
      correctOptionId: "no",
      explanation: "The record's TTL (300) tells resolvers how many seconds they may cache the answer. The IPv4 TTL is decremented by each router to stop looping packets. They just share a name.",
    },
  },
  {
    id: "break-intro",
    label: "Incident: names stop working",
    narrative: "Next morning: after a DHCP scope edit and a laptop reboot, users on 10.10.10.0/24 can't open www.packetverse.test by name.",
    run: (s) => ({ state: idle(s), events: [] }),
  },
  {
    id: "fault-injected",
    label: "The scope edit",
    narrative: "Someone edited the DHCP scope for 10.10.10.0/24 overnight. Gather evidence before guessing.",
    run: (s) => ({ state: { ...idle(s), faultActive: true, serverOption6: DH_ADDR.WRONG_DNS, dnsCache: [] }, events: [ev("STEP_ENTERED", "fault-injected", "scope edited")] }),
  },
  {
    id: "fault-reacquire",
    label: "CLIENT re-acquires a lease",
    narrative: `After the reboot, CLIENT runs DISCOVER/OFFER/REQUEST/ACK again (xid ${hex8(XID2)}); shown is the final relayed DHCPACK. It still gets ${DH_ADDR.CLIENT}/24 and gateway ${DH_ADDR["R1:CLIENT"]}. Inspect every option.`,
    run: (s) => {
      const out = dhcpLeg.relayToClient("ack2", serverMsg("DHCPACK", XID2, s.serverOption6), "R1", "SW1");
      const lease: ClientLease = { phase: "BOUND", ip: DH_ADDR.CLIENT, mask: MASK, gateway: DH_ADDR["R1:CLIENT"], dns: s.serverOption6, lease: LEASE_SECONDS, serverId: DH_ADDR["DHCP-SRV"], xid: XID2, offered: DH_ADDR.CLIENT };
      const a = push({ ...idle(s), serverLeases: [{ mac: DH_MAC.CLIENT, ip: DH_ADDR.CLIENT, xid: XID2, dns: s.serverOption6 }] }, serverHop("fault-reacquire", "DHCP-SRV", { rx: `DHCPREQUEST xid ${hex8(XID2)}`, select: `scope ${POOL.subnet} → ${DH_ADDR.CLIENT}`, reply: "DHCPACK with the scope's current options" }, `lease ${DH_ADDR.CLIENT}`, "DHCPACK", "The server hands out whatever its scope currently says.", `DHCPREQUEST xid ${hex8(XID2)}`, "DHCPACK"));
      const b = push({ ...a, packet: out, client: lease, note: { device: "R1", text: "R1 relay: DHCPACK to client LAN" } }, r1Hop("fault-reacquire", "relay", "ge-0/0/1", "ge-0/0/0", { rx: "ge-0/0/1 · from server", classify: "server reply → relay agent", rewrite: "broadcast flag set", tx: "255.255.255.255 on ge-0/0/0" }, "BROADCAST flag 1", "Relayed exactly as before.", "DHCPACK from server", "DHCPACK broadcast", undefined, out));
      return { state: b, events: [ev("PACKET_SENT", "fault-reacquire", "new lease")] };
    },
    packet: pkt,
  },
  {
    id: "fault-query",
    label: "A name lookup",
    narrative: `CLIENT queries its configured DNS server for ${DNS_NAME} (Transaction ID ${hex4(QID_FAULT)}).`,
    run: (s) => {
      const p = dnsLeg.query("qf", dnsQuery(QID_FAULT), s.client.dns!, "client", "CLIENT", "SW1");
      return { state: push({ ...idle(s), packet: p, note: { device: "CLIENT", text: `query to ${s.client.dns}` } }, clientHop("fault-query", "DNS QUERY", { state: "BOUND", build: `A ${DNS_NAME} · id ${hex4(QID_FAULT)}`, tx: `UDP ${CLIENT_DNS_PORT} → ${s.client.dns}:53` }, "The resolver uses the DNS server from its current lease.", DNS_NAME, `query ${hex4(QID_FAULT)}`, p)), events: [ev("PACKET_SENT", "fault-query", "DNS query")] };
    },
    packet: pkt,
  },
  {
    id: "fault-lost",
    label: "No answer",
    narrative: `R1 routes the query toward ${DH_ADDR.WRONG_DNS} on 10.20.20.0/24, but no device answers ARP for that address. R1 discards the packet. CLIENT retries, then gives up: "server can't be reached".`,
    run: (s) => {
      const sw = switchHop(s, "fault-lost", "SW1", "p1", "p2", pkt(s), "R1");
      const hop = r1Hop("fault-lost", "drop", "ge-0/0/0", undefined, { rx: "ge-0/0/0 · unicast", classify: `route to ${DH_ADDR.WRONG_DNS} (10.20.20.0/24 connected)`, rewrite: `ARP for ${DH_ADDR.WRONG_DNS}: no reply`, tx: "discarded" }, `ARP ${DH_ADDR.WRONG_DNS}: incomplete`, `The route exists, but nothing on 10.20.20.0/24 owns ${DH_ADDR.WRONG_DNS}, so R1 can't build the frame and drops the query.`, `DNS query → ${DH_ADDR.WRONG_DNS}`, "dropped", pkt(sw));
      return { state: push({ ...sw, packet: undefined, lastDns: { id: QID_FAULT, server: DH_ADDR.WRONG_DNS, result: "no response" }, note: { device: "R1", text: `no ARP reply from ${DH_ADDR.WRONG_DNS}` } }, hop), events: [ev("PACKET_DROPPED", "fault-lost", "query unanswered")] };
    },
  },
  {
    id: "fault-evidence",
    label: "Evidence: direct query",
    narrative: `A technician runs a query aimed explicitly at ${DH_ADDR["DNS-SRV"]} (Transaction ID ${hex4(QID_DIG)}). It's answered immediately: CLIENT's address, gateway and routing all work, and so does DNS-SRV.`,
    run: (s) => {
      const out = dnsLeg.answer("adig", dnsAnswer(QID_DIG), "client", "R1", "SW1");
      const sw = switchHop({ ...idle(s), packet: out }, "fault-evidence", "SW1", "p2", "p1", out, "CLIENT");
      return { state: push({ ...sw, lastDns: { id: QID_DIG, server: DH_ADDR["DNS-SRV"], result: "answered" } }, clientHop("fault-evidence", "DIRECT QUERY OK", { state: "BOUND", build: `@${DH_ADDR["DNS-SRV"]} id ${hex4(QID_DIG)}`, tx: `answer ${DH_ADDR.WEB}` }, `Asking ${DH_ADDR["DNS-SRV"]} directly works, so IP connectivity and the DNS service are fine.`, `query ${hex4(QID_DIG)} @${DH_ADDR["DNS-SRV"]}`, `answer ${DH_ADDR.WEB}`)), events: [ev("PACKET_RECEIVED", "fault-evidence", "direct query answered")] };
    },
    packet: pkt,
  },
  {
    id: "trouble-question",
    label: "Diagnose",
    narrative: "Address, mask, gateway and routing all work; a query sent explicitly to DNS-SRV is answered; normal lookups get no answer.",
    question: {
      prompt: "Why can IP connectivity work while hostname resolution fails?",
      options: [
        { id: "opt6", label: "The lease's DNS server (Option 6) is 10.20.20.99, which doesn't exist" },
        { id: "gw", label: "The default gateway is wrong" },
        { id: "mask", label: "The subnet mask is wrong" },
        { id: "sw", label: "SW1 is dropping frames" },
      ],
      correctOptionId: "opt6",
      explanation: "Every IP check passes. The only thing that differs between the working and failing queries is the destination: the resolver uses the DNS server from its lease — 10.20.20.99, from the edited Option 6.",
    },
  },
  {
    id: "diagnostic-layers",
    label: "Troubleshooting layers",
    narrative: "Compare each layer of CLIENT's configuration against what actually works.",
  },
  {
    id: "repair-challenge",
    label: "Repair",
    narrative: "Choose the change that fixes the cause for CLIENT — remember what the client actually holds.",
    action: (s, payload) => ({ state: applyDhRepair(s, (payload as { choice: string }).choice), events: [ev("STEP_ENTERED", "repair-challenge", `repair ${(payload as { choice: string }).choice}`)] }),
    requiresState: (s) => s.repaired,
  },
  {
    id: "renew-request",
    label: "Renew: unicast DHCPREQUEST",
    narrative: `Fixing the scope doesn't change the lease CLIENT already holds. CLIENT renews (RENEWING): a unicast DHCPREQUEST from ${DH_ADDR.CLIENT} to ${DH_ADDR["DHCP-SRV"]}, ciaddr ${DH_ADDR.CLIENT}, no Option 50/54, new xid ${hex8(XID3)}. R1 simply routes it — no relay needed.`,
    run: (s) => {
      const m = clientMsg("DHCPREQUEST", XID3, { renew: true });
      const c = dhcpLeg.renewRequest("renew-c", m, "CLIENT", "SW1", 64, DH_MAC.CLIENT, DH_MAC["R1:CLIENT"]);
      const out = dhcpLeg.renewRequest("renew-r", m, "R1", "SW2", 63, DH_MAC["R1:SERVER"], DH_MAC["DHCP-SRV"]);
      const a = push({ ...idle(s), client: { ...s.client, phase: "RENEWING", xid: XID3 } }, clientHop("renew-request", "DHCPREQUEST (renew)", { state: "BOUND → RENEWING", build: `ciaddr ${DH_ADDR.CLIENT} · xid ${hex8(XID3)}`, tx: `unicast → ${DH_ADDR["DHCP-SRV"]}` }, "A bound client renews directly with its server by unicast, using its own address.", "renew", "DHCPREQUEST unicast", c));
      const b = switchHop({ ...a, packet: c }, "renew-request", "SW1", "p1", "p2", c, "R1");
      return { state: push({ ...b, packet: out, note: { device: "R1", text: "R1: route (TTL 64 → 63) — not relayed" } }, r1Hop("renew-request", "route", "ge-0/0/0", "ge-0/0/1", { rx: "ge-0/0/0 · unicast", classify: "unicast to 10.20.20.10 → route", rewrite: "TTL 64 → 63", tx: "ge-0/0/1 → DHCP-SRV" }, "10.20.20.0/24 connected", "The request is unicast IP to the server, so R1 routes it; the relay agent is only for broadcasts.", "DHCPREQUEST unicast", "forwarded", c, out, [{ type: "TTL_CHANGE", detail: "64 → 63" }])), events: [ev("PACKET_SENT", "renew-request", "renew REQUEST")] };
    },
    packet: pkt,
  },
  {
    id: "renew-ack",
    label: "Renew: DHCPACK with the corrected option",
    narrative: `DHCP-SRV ACKs by unicast to ${DH_ADDR.CLIENT} with its current options — now Option 6 = ${DH_ADDR["DNS-SRV"]}. CLIENT returns to BOUND with the corrected DNS server.`,
    run: (s) => {
      const m = serverMsg("DHCPACK", XID3, s.serverOption6, { renew: true });
      const out = dhcpLeg.renewAck("renew-ack", m, "R1", "SW1", 63, DH_MAC["R1:CLIENT"], DH_MAC.CLIENT);
      const a = push({ ...idle(s), serverLeases: [{ mac: DH_MAC.CLIENT, ip: DH_ADDR.CLIENT, xid: XID3, dns: s.serverOption6 }] }, serverHop("renew-ack", "DHCP-SRV", { rx: `DHCPREQUEST (renew) ciaddr ${DH_ADDR.CLIENT}`, select: `extend lease · Option 6 ${s.serverOption6}`, reply: `DHCPACK unicast → ${DH_ADDR.CLIENT}` }, `lease ${DH_ADDR.CLIENT}`, "DHCPACK", "The server extends the lease and includes its current options.", `DHCPREQUEST xid ${hex8(XID3)}`, "DHCPACK unicast"));
      const b = push({ ...a, packet: out, client: { ...s.client, phase: "BOUND", dns: s.serverOption6, xid: XID3 }, faultActive: false, note: { device: "R1", text: "R1: route to client" } }, r1Hop("renew-ack", "route", "ge-0/0/1", "ge-0/0/0", { rx: "ge-0/0/1 · unicast", classify: "unicast to 10.10.10.50 → route", rewrite: "TTL 64 → 63", tx: "ge-0/0/0 → CLIENT" }, "10.10.10.0/24 connected", "Routed back to the client's real address.", "DHCPACK unicast", "forwarded", undefined, out, [{ type: "TTL_CHANGE", detail: "64 → 63" }]));
      return { state: b, events: [ev("PACKET_SENT", "renew-ack", "renew ACK")] };
    },
    packet: pkt,
  },
  {
    id: "verify-query",
    label: "Verify: query again",
    narrative: `CLIENT now queries ${DH_ADDR["DNS-SRV"]} (Transaction ID ${hex4(QID_VERIFY)}).`,
    run: (s) => {
      const p = dnsLeg.query("qv", dnsQuery(QID_VERIFY), s.client.dns!, "client", "CLIENT", "SW1");
      return { state: push({ ...idle(s), packet: p, note: { device: "CLIENT", text: `query to ${s.client.dns}` } }, clientHop("verify-query", "DNS QUERY", { state: "BOUND", build: `A ${DNS_NAME} · id ${hex4(QID_VERIFY)}`, tx: `UDP ${CLIENT_DNS_PORT} → ${s.client.dns}:53` }, "The resolver now uses the corrected server from the renewed lease.", DNS_NAME, `query ${hex4(QID_VERIFY)}`, p)), events: [ev("PACKET_SENT", "verify-query", "DNS query")] };
    },
    packet: pkt,
  },
  {
    id: "verify-answer",
    label: "Verify: resolved",
    narrative: `Answered: ${DNS_NAME} A ${DH_ADDR.WEB} (TTL ${DNS_RECORD_TTL} s), Transaction ID ${hex4(QID_VERIFY)} matches. Names work again.`,
    run: (s) => {
      const out = dnsLeg.answer("av", dnsAnswer(QID_VERIFY), "client", "R1", "SW1");
      const a = push({ ...s, lastDns: { id: QID_VERIFY, server: DH_ADDR["DNS-SRV"], result: "answered" } }, serverHop("verify-answer", "DNS-SRV", { rx: `query ${hex4(QID_VERIFY)}`, select: `A ${DH_ADDR.WEB}`, reply: `response ${hex4(QID_VERIFY)}` }, `${DNS_NAME} A ${DH_ADDR.WEB}`, "DNS RESPONSE", "Answered as before.", `query ${hex4(QID_VERIFY)}`, `answer ${DH_ADDR.WEB}`));
      const b = switchHop({ ...a, packet: out }, "verify-answer", "SW1", "p2", "p1", out, "CLIENT");
      return { state: push({ ...b, dnsCache: [{ name: DNS_NAME, address: DH_ADDR.WEB, ttl: DNS_RECORD_TTL }] }, clientHop("verify-answer", "RESOLVED", { state: "BOUND", build: `id ${hex4(QID_VERIFY)} matches`, tx: `${DNS_NAME} → ${DH_ADDR.WEB}` }, "Transaction ID matches; answer cached.", `response ${hex4(QID_VERIFY)}`, `${DNS_NAME} → ${DH_ADDR.WEB}`)), events: [ev("PACKET_RECEIVED", "verify-answer", "resolved")] };
    },
    packet: pkt,
  },
  {
    id: "complete",
    label: "Lesson complete",
    narrative: "DHCP gave CLIENT an address, mask, gateway and DNS server through a relay; DNS turned a name into an address. And a bad Option 6 showed that working IP doesn't mean working names.",
  },
];

/** Narrative helper: the healthy DNS server (narratives are static strings computed once). */
function s0dns() {
  return DH_ADDR["DNS-SRV"];
}
