import type { PacketLayer, PacketVisual, PVEvent, PVEventType, ScenarioStep } from "../types";
import type { PacketStackFrame, ProcessingStage } from "@/components/network3d/types";
import type { FundHop } from "@/components/lesson/fundamentalsTrace";
import { dnsPacket, fieldOf, type DnsMessage } from "./fundamentalsPackets";
import { fieldIn, flagsName, ip4Frame, payloadLen, tcpField, tcpPacket, type TcpSeg } from "./enterpriseEdgePackets";
import { withNotes, type NotebookEntry } from "./troubleshootingCommon";

/**
 * Application Troubleshooting: DNS, TCP & HTTP — CLIENT — NETWORK — {DNS, WEB-OLD, WEB-NEW}.
 *
 * Modeled exactly:
 * - DNS (RFC 1035) query/response for an A record, UDP/53, via the shared builder (lengths computed). The server
 *   10.40.40.53 answers authoritatively for example.test. The client caches each answer for its TTL; the remaining
 *   TTL is derived from the lesson clock, never typed in.
 * - TCP (RFC 9293) segments via the shared builder; HTTP is PLAIN TEXT on port 80 (no TLS anywhere in this lesson),
 *   so the request/response bytes are real, Content-Length is computed from the body, and the TCP checksum covers the
 *   exact bytes shown. Sequence/acknowledgment numbers advance by the payload lengths.
 * - An HTTP 503 is a complete, successful exchange at the network and transport layers: the application answered.
 * Incident (truth, never shown before diagnosis): the authoritative A record for portal.example.test is stale
 * (10.40.40.20, the retired WEB-OLD) instead of 10.40.40.30 (WEB-NEW). WEB-OLD still accepts TCP/80 and answers 503.
 * The repair is the authoritative record; flushing a client cache only makes that one client see the repair sooner.
 */

export type ApDevice = "CLIENT" | "NETWORK" | "DNS" | "WEB-OLD" | "WEB-NEW";
export const AP_DEVICES: ApDevice[] = ["CLIENT", "NETWORK", "DNS", "WEB-OLD", "WEB-NEW"];
export const NAME = "portal.example.test";
export const IP = { client: "10.30.1.10", gwClient: "10.30.1.1", gwServers: "10.40.40.1", dns: "10.40.40.53", old: "10.40.40.20", new: "10.40.40.30" } as const;
export const MAC = { CLIENT: "00:00:5E:00:53:61", NET_C: "00:00:5E:00:53:62", NET_S: "00:00:5E:00:53:63", DNS: "00:00:5E:00:53:64", OLD: "00:00:5E:00:53:65", NEW: "00:00:5E:00:53:66" } as const;
export const RECORD_TTL = 300;
export const HTTP_PORT = 80;

// ---------------------------------------------------------------------------------------------------------------
// HTTP bodies (plain text; lengths computed)
// ---------------------------------------------------------------------------------------------------------------
const enc = (s: string) => Array.from(new TextEncoder().encode(s));
export const httpRequest = (host: string) => `GET / HTTP/1.1\r\nHost: ${host}\r\nUser-Agent: pv-lab/1.0\r\nAccept: */*\r\nConnection: close\r\n\r\n`;
const body200 = "portal: healthy\r\n";
const body503 = "portal retired on this host\r\n";
export const http200 = () => `HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: ${enc(body200).length}\r\nConnection: close\r\n\r\n${body200}`;
export const http503 = () => `HTTP/1.1 503 Service Unavailable\r\nContent-Type: text/plain\r\nContent-Length: ${enc(body503).length}\r\nRetry-After: 120\r\nConnection: close\r\n\r\n${body503}`;

// ---------------------------------------------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------------------------------------------
export interface CacheEntry {
  name: string;
  address: string;
  ttl: number;
  /** Lesson clock (s) when cached. */
  at: number;
}
export type Web = "WEB-OLD" | "WEB-NEW";
export interface HttpResult {
  label: string;
  target: string;
  host: string;
  resolved?: string;
  tcp: "connected";
  status: string;
}
export interface ApState {
  hops: FundHop[];
  packet?: PacketVisual;
  flood: { id: string; fromId: string; toId: string; packet: PacketVisual }[];
  /** Truth: the authoritative A record. */
  authA: string;
  cache: CacheEntry[];
  clock: number;
  dnsLog: { label: string; answer: string; ttl: number }[];
  http: HttpResult[];
  notebook: NotebookEntry[];
  decision?: { device: ApDevice; text: string };
  faultActive: boolean;
  repairAttempt?: { choice: string; correct: boolean };
  repaired: boolean;
}
export const createApState = (): ApState => ({ hops: [], flood: [], authA: IP.new, cache: [], clock: 0, dnsLog: [], http: [], notebook: [], faultActive: false, repaired: false });
export const cached = (s: ApState, at = s.clock) => s.cache.find((c) => c.name === NAME && at - c.at < c.ttl);
export const remaining = (s: ApState) => {
  const c = cached(s);
  return c ? c.ttl - (s.clock - c.at) : 0;
};
export const webFor = (addr: string): Web => (addr === IP.old ? "WEB-OLD" : "WEB-NEW");
export const statusOf = (w: Web) => (w === "WEB-OLD" ? "503 Service Unavailable" : "200 OK");

// ---------------------------------------------------------------------------------------------------------------
// Packets
// ---------------------------------------------------------------------------------------------------------------
export type Flow = "healthy" | "incident" | "direct" | "verify";
export const FLOW: Record<Flow, { sport: number; isnC: number; isnS: number; dnsId: number; dnsPort: number }> = {
  healthy: { sport: 49152, isnC: 1000, isnS: 3000, dnsId: 0x1a01, dnsPort: 53001 },
  incident: { sport: 49153, isnC: 1100, isnS: 3100, dnsId: 0x1a02, dnsPort: 53002 },
  direct: { sport: 49154, isnC: 1200, isnS: 3200, dnsId: 0, dnsPort: 0 },
  verify: { sport: 49155, isnC: 1300, isnS: 3300, dnsId: 0x1a04, dnsPort: 53004 },
};
export function dnsQuery(id: string, f: Flow): PacketVisual {
  const m: DnsMessage = { id: FLOW[f].dnsId, response: false, rd: true, ra: false, qname: NAME };
  return dnsPacket({ id, from: "CLIENT", to: "NETWORK", ethSrc: MAC.CLIENT, ethDst: MAC.NET_C, ip: { src: IP.client, dst: IP.dns, ttl: 64, id: 0x4400 + (FLOW[f].dnsId & 0xff), df: false }, srcPort: FLOW[f].dnsPort, dstPort: 53, dns: m });
}
export function dnsAnswer(id: string, f: Flow, address: string): PacketVisual {
  const m: DnsMessage = { id: FLOW[f].dnsId, response: true, rd: true, ra: true, qname: NAME, answer: { address, ttl: RECORD_TTL } };
  return dnsPacket({ id, from: "DNS", to: "NETWORK", ethSrc: MAC.DNS, ethDst: MAC.NET_S, ip: { src: IP.dns, dst: IP.client, ttl: 64, id: 0x5500 + (FLOW[f].dnsId & 0xff), df: false }, srcPort: 53, dstPort: FLOW[f].dnsPort, dns: m });
}
export type TcpKind = "syn" | "synack" | "get" | "resp";
function segFor(f: Flow, k: TcpKind, web: Web, host: string): TcpSeg {
  const F = FLOW[f];
  const req = enc(httpRequest(host));
  if (k === "syn") return { sport: F.sport, dport: HTTP_PORT, seq: F.isnC, ack: 0, flags: ["SYN"], mss: 1460 };
  if (k === "synack") return { sport: HTTP_PORT, dport: F.sport, seq: F.isnS, ack: F.isnC + 1, flags: ["SYN", "ACK"], mss: 1460 };
  if (k === "get") return { sport: F.sport, dport: HTTP_PORT, seq: F.isnC + 1, ack: F.isnS + 1, flags: ["PSH", "ACK"], payload: req };
  return { sport: HTTP_PORT, dport: F.sport, seq: F.isnS + 1, ack: F.isnC + 1 + req.length, flags: ["PSH", "ACK"], payload: enc(web === "WEB-OLD" ? http503() : http200()) };
}
function httpLayer(text: string, request: boolean): PacketLayer {
  const [head] = text.split("\r\n\r\n");
  const lines = head.split("\r\n");
  const body = text.slice(head.length + 4);
  return {
    name: request ? "HTTP Request" : "HTTP Response",
    color: "#fbbf24",
    fields: [
      { label: request ? "Request line" : "Status line", value: lines[0] },
      ...lines.slice(1).map((l) => ({ label: l.split(": ")[0], value: l.split(": ").slice(1).join(": ") })),
      ...(body ? [{ label: "Body", value: JSON.stringify(body).slice(1, -1) }] : []),
      { label: "Bytes (plain text)", value: String(enc(text).length) },
    ],
  };
}
/** A TCP segment shown on the client-side or server-side link. */
export function tcpSeg(id: string, f: Flow, k: TcpKind, web: Web, host = NAME): PacketVisual {
  const c2s = k === "syn" || k === "get";
  const seg = segFor(f, k, web, host);
  const srv = web === "WEB-OLD" ? IP.old : IP.new;
  const p = c2s
    ? tcpPacket(id, "CLIENT", "NETWORK", MAC.CLIENT, MAC.NET_C, { src: IP.client, dst: srv, ttl: 64, ipId: 0x6100 + (k === "get" ? 2 : 0), seg })
    : tcpPacket(id, web, "NETWORK", web === "WEB-OLD" ? MAC.OLD : MAC.NEW, MAC.NET_S, { src: srv, dst: IP.client, ttl: 64, ipId: 0x7100 + (k === "resp" ? 1 : 0), seg });
  if (k !== "get" && k !== "resp") return p;
  const text = new TextDecoder().decode(new Uint8Array(seg.payload!));
  const layers = [...p.layers];
  layers.splice(3, 0, httpLayer(text, k === "get"));
  return { ...p, protocol: "TCP", badge: k === "get" ? "HTTP GET" : `HTTP ${text.split(" ")[1]}`, summary: k === "get" ? `HTTP GET / Host: ${host} → ${srv}:80` : `HTTP ${text.split("\r\n")[0].slice(9)} from ${srv}`, layers };
}
export const isDns = (p: PacketVisual) => p.layers.some((l) => l.name.startsWith("DNS"));
export const isHttp = (p: PacketVisual) => p.layers.some((l) => l.name.startsWith("HTTP"));
export function apStack(p: PacketVisual): PacketStackFrame[] {
  const out: PacketStackFrame[] = [{ id: "eth", text: `Ethernet · ${fieldIn(p, /^Ethernet/, "Source MAC")} → ${fieldIn(p, /^Ethernet/, "Destination MAC")}`, tone: "generic" }, ip4Frame(p)];
  if (isDns(p)) out.push({ id: "udp", text: `UDP ${fieldOf(p, /^UDP/, "Source Port")} → ${fieldOf(p, /^UDP/, "Destination Port")}`, tone: "transport" }, { id: "dns", text: `${p.layers.find((l) => l.name.startsWith("DNS"))!.name} · ${fieldOf(p, /^DNS/, "Answer") || fieldOf(p, /^DNS/, "Question")}`, tone: "vpn" });
  else out.push({ id: "tcp", text: `TCP ${tcpField(p, "Source Port")} → ${tcpField(p, "Destination Port")} · ${p.badge} · seq ${tcpField(p, "Sequence Number")} · ack ${tcpField(p, "Acknowledgment Number").split(" ")[0]} · csum ${tcpField(p, "Checksum")}`, tone: "transport" });
  const http = p.layers.find((l) => l.name.startsWith("HTTP"));
  if (http) out.push({ id: "http", text: `${http.name} · ${http.fields[0].value}`, tone: "vpn" });
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Stages and hops
// ---------------------------------------------------------------------------------------------------------------
export const CLIENT_STAGES: ProcessingStage[] = [
  { id: "cache", label: "DNS cache: fresh entry? (remaining TTL)" },
  { id: "dns", label: "DNS query / answer → address" },
  { id: "tcp", label: "TCP connect to address:80" },
  { id: "http", label: "HTTP request (Host header) / response status" },
];
export const DNS_STAGES: ProcessingStage[] = [
  { id: "rx", label: "Receive query (UDP/53)" },
  { id: "zone", label: "Authoritative zone example.test: A record" },
  { id: "tx", label: "Answer with address and TTL" },
];
export const WEB_STAGES: ProcessingStage[] = [
  { id: "tcp", label: "TCP/80 accept" },
  { id: "vhost", label: "HTTP: match Host header to a site" },
  { id: "app", label: "Application status" },
  { id: "tx", label: "HTTP response" },
];
export const NET_STAGES: ProcessingStage[] = [
  { id: "rx", label: "Receive" },
  { id: "route", label: "Route 10.30.1.0/24 ↔ 10.40.40.0/24" },
  { id: "tx", label: "Forward (TTL − 1)" },
];
export const AP_STAGES: Record<ApDevice, ProcessingStage[]> = { CLIENT: CLIENT_STAGES, NETWORK: NET_STAGES, DNS: DNS_STAGES, "WEB-OLD": WEB_STAGES, "WEB-NEW": WEB_STAGES };
const withDetail = (st: ProcessingStage[], d: Partial<Record<string, string>>) => st.map((x) => (d[x.id] ? { ...x, detail: d[x.id] } : x));
const ev = (type: PVEventType, stepId: string, message: string): PVEvent => ({ type, stepId, timestamp: Date.now(), message });
const idle = (s: ApState): ApState => ({ ...s, packet: undefined, flood: [], decision: undefined });
function hop(stepId: string, device: ApDevice, o: { active: string; details: Partial<Record<string, string>>; lookupType: string; key: string; result: string; action: string; reason: string; input: string; output: string; ingress?: string; egress?: string; next?: ApDevice; before?: PacketVisual; after?: PacketVisual }): FundHop {
  return { stepId, device, stages: withDetail(AP_STAGES[device], o.details), activeStageId: o.active, ingressInterfaceId: o.ingress, egressInterfaceId: o.egress, lookupType: o.lookupType, lookupKey: o.key, lookupResult: o.result, action: o.action, reason: o.reason, input: o.input, output: o.output, nextHopId: o.next, before: o.before ? apStack(o.before) : undefined, after: o.after ? apStack(o.after) : undefined };
}
const evidence = (s: ApState, stepId: string, d: ApDevice, o: { active: string; details: Partial<Record<string, string>>; action: string; reason: string; key: string; result: string }): ApState => ({ ...s, hops: [...s.hops, hop(stepId, d, { ...o, lookupType: `${d} evidence`, input: o.key, output: o.result })] });
const tick = (s: ApState, sec: number): ApState => ({ ...s, clock: s.clock + sec });

// Step builders ------------------------------------------------------------------------------------------------------
function queryStep(s: ApState, stepId: string, f: Flow): ApState {
  const p = dnsQuery(`${stepId}-pkt`, f);
  const c = cached(s);
  const h = hop(stepId, "CLIENT", { active: "dns", egress: "eth0", details: { cache: c ? `${NAME} → ${c.address} (${remaining(s)} s left)` : `${NAME}: no fresh entry → query`, dns: `A ${NAME}? → ${IP.dns} · id 0x${FLOW[f].dnsId.toString(16)} · UDP ${FLOW[f].dnsPort} → 53` }, lookupType: "CLIENT resolver", key: NAME, result: "query sent", action: "DNS QUERY", reason: "No fresh cached answer, so the client asks its DNS server.", input: NAME, output: "A query", next: "NETWORK", after: p });
  return { ...idle(s), hops: [...s.hops, h], packet: p };
}
function answerStep(s: ApState, stepId: string, f: Flow, label: string): ApState {
  const p = dnsAnswer(`${stepId}-pkt`, f, s.authA);
  const hd = hop(stepId, "DNS", { active: "tx", ingress: "eth0", egress: "eth0", details: { zone: `example.test: ${NAME} A ${s.authA} TTL ${RECORD_TTL}`, tx: `answer ${s.authA} TTL ${RECORD_TTL} (authoritative)` }, lookupType: "DNS zone example.test", key: `A ${NAME}`, result: `${s.authA} TTL ${RECORD_TTL}`, action: "DNS ANSWER", reason: "The authoritative zone decides what every resolver will be told.", input: "A query", output: `A ${s.authA}`, next: "NETWORK", after: p });
  const hc = hop(stepId, "CLIENT", { active: "cache", ingress: "eth0", details: { dns: `answer ${NAME} → ${s.authA}`, cache: `cached ${s.authA} for ${RECORD_TTL} s` }, lookupType: "CLIENT resolver", key: NAME, result: s.authA, action: "CACHE", reason: `The client will reuse ${s.authA} for up to ${RECORD_TTL} s without asking again.`, input: "DNS response", output: `${NAME} = ${s.authA}`, before: p });
  return { ...idle(s), hops: [...s.hops, hd, hc], packet: p, cache: [{ name: NAME, address: s.authA, ttl: RECORD_TTL, at: s.clock }], dnsLog: [...s.dnsLog, { label, answer: s.authA, ttl: RECORD_TTL }] };
}
function tcpStep(s: ApState, stepId: string, f: Flow, k: TcpKind, web: Web, host = NAME): ApState {
  const p = tcpSeg(`${stepId}-pkt`, f, k, web, host);
  const srv = web === "WEB-OLD" ? IP.old : IP.new;
  const clientSide = k === "syn" || k === "get";
  const h = clientSide
    ? hop(stepId, "CLIENT", { active: k === "syn" ? "tcp" : "http", egress: "eth0", details: k === "syn" ? { tcp: `connect ${srv}:80 from :${FLOW[f].sport} · SYN seq ${FLOW[f].isnC} · csum ${tcpField(p, "Checksum")}` } : { http: `GET / · Host: ${host} · ${payloadLen(segFor(f, k, web, host))} bytes · seq ${tcpField(p, "Sequence Number")}` }, lookupType: "CLIENT socket", key: `${IP.client}:${FLOW[f].sport} → ${srv}:80`, result: k === "syn" ? "SYN sent" : "request sent", action: k === "syn" ? "TCP SYN" : "HTTP GET", reason: k === "syn" ? `The client connects to whatever address the name resolved to: ${srv}.` : `The Host header carries the NAME the user asked for (${host}); the IP header carries the address DNS returned.`, input: k === "syn" ? "connect()" : "request", output: flagsName(segFor(f, k, web, host)), next: "NETWORK", after: p })
    : hop(stepId, web, { active: k === "synack" ? "tcp" : "tx", egress: "eth0", details: k === "synack" ? { tcp: `port 80 open → SYN-ACK seq ${FLOW[f].isnS} ack ${FLOW[f].isnC + 1}` } : { vhost: `Host: ${host}`, app: web === "WEB-OLD" ? "portal retired on this host" : "portal healthy", tx: `${statusOf(web)} · ${payloadLen(segFor(f, k, web, host))} bytes` }, lookupType: `${web} ${k === "synack" ? "TCP" : "HTTP"}`, key: `:80 from ${IP.client}:${FLOW[f].sport}`, result: k === "synack" ? "SYN-ACK" : statusOf(web), action: k === "synack" ? "TCP ACCEPT" : `HTTP ${statusOf(web).split(" ")[0]}`, reason: k === "synack" ? "TCP/80 accepts connections: the transport works end to end." : web === "WEB-OLD" ? "The application itself answered: 503 Service Unavailable. Nothing was lost; the request reached a host that no longer serves the portal." : "The intended service answers 200 OK.", input: k === "synack" ? "SYN" : "HTTP request", output: k === "synack" ? "SYN-ACK" : statusOf(web), next: "NETWORK", after: p });
  return { ...idle(s), hops: [...s.hops, h], packet: p };
}
const httpResult = (s: ApState, r: HttpResult): ApState => ({ ...s, http: [...s.http, r] });

// ---------------------------------------------------------------------------------------------------------------
// Repair
// ---------------------------------------------------------------------------------------------------------------
export const AP_REPAIR_OPTIONS = [
  { id: "fix-a", label: `Update the authoritative A record for ${NAME} to ${IP.new}` },
  { id: "flush-cache", label: "Flush the client's DNS cache" },
  { id: "restart-switch", label: "Restart the access switch" },
  { id: "gateway", label: "Change the client's default gateway" },
  { id: "fw-80", label: "Open TCP/80 on the firewall" },
  { id: "clear-arp", label: "Clear the client's ARP cache" },
  { id: "mtu", label: "Increase the MTU" },
  { id: "restart-old", label: "Restart WEB-OLD" },
] as const;
export const AP_REPAIR_CORRECT = "fix-a";
export function applyApRepair(s: ApState, choice: string): ApState {
  const correct = choice === AP_REPAIR_CORRECT;
  if (!correct) return { ...s, repairAttempt: { choice, correct } };
  return { ...idle(s), authA: IP.new, faultActive: false, repaired: true, repairAttempt: { choice, correct }, decision: { device: "DNS", text: `DNS: ${NAME} A ${IP.new}` } };
}

// ---------------------------------------------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------------------------------------------
const pkt = (s: ApState) => s.packet;
const H: Flow = "healthy";
const I: Flow = "incident";
const Dr: Flow = "direct";
const V: Flow = "verify";

export const apSteps: ScenarioStep<ApState>[] = [
  // ---- Define / Scope ---
  {
    id: "intro",
    label: "A name, a resolver, two web servers",
    narrative: `Users open http://${NAME}/. CLIENT (${IP.client}) asks DNS (${IP.dns}) for the address, then talks plain HTTP on TCP/80. Two web servers sit on 10.40.40.0/24: WEB-OLD (${IP.old}, being retired) and WEB-NEW (${IP.new}). Plain HTTP is used on purpose so every byte is readable — there is no TLS in this lesson.`,
    run: (s) => ({ state: withNotes(idle(s), "intro", [{ kind: "observation", text: `Service: http://${NAME}/ (TCP/80, plain HTTP)`, source: "service definition" }]), events: [ev("STEP_ENTERED", "intro", "scope")] }),
  },
  {
    id: "design",
    label: "The intended record",
    narrative: `Design: ${NAME} → ${IP.new} (WEB-NEW), TTL ${RECORD_TTL} s, served authoritatively by ${IP.dns}. The TTL tells every resolver and client how long it may keep using an answer without asking again.`,
    run: (s) => ({ state: evidence(idle(s), "design", "DNS", { active: "zone", details: { zone: `example.test: ${NAME} A ${s.authA} TTL ${RECORD_TTL}` }, action: "ZONE", reason: "The authoritative zone is the source of truth for the name.", key: `zone example.test`, result: `A ${s.authA}` }), events: [ev("STEP_ENTERED", "design", "design")] }),
  },
  // ---- Baseline ---
  {
    id: "base-query",
    label: "Baseline: DNS query",
    narrative: `CLIENT's cache has no entry for ${NAME}, so it sends a DNS query: A ${NAME}, UDP ${FLOW[H].dnsPort} → 53.`,
    run: (s) => ({ state: queryStep(s, "base-query", H), events: [ev("PACKET_SENT", "base-query", "DNS query")] }),
    packet: pkt,
  },
  {
    id: "base-answer",
    label: "Baseline: DNS answer",
    narrative: `DNS answers: ${NAME} A ${IP.new}, TTL ${RECORD_TTL}. CLIENT caches it.`,
    run: (s) => ({ state: answerStep(tick(s, 1), "base-answer", H, "baseline"), events: [ev("PACKET_SENT", "base-answer", "DNS answer")] }),
    packet: pkt,
  },
  {
    id: "base-syn",
    label: "Baseline: TCP to WEB-NEW",
    narrative: `CLIENT connects to ${IP.new}:80: SYN, seq ${FLOW[H].isnC}.`,
    run: (s) => ({ state: tcpStep(s, "base-syn", H, "syn", "WEB-NEW"), events: [ev("PACKET_SENT", "base-syn", "SYN")] }),
    packet: pkt,
  },
  {
    id: "base-synack",
    label: "Baseline: WEB-NEW accepts",
    narrative: `WEB-NEW: SYN-ACK, seq ${FLOW[H].isnS}, ack ${FLOW[H].isnC + 1}. CLIENT completes the handshake with an ACK.`,
    run: (s) => ({ state: tcpStep(s, "base-synack", H, "synack", "WEB-NEW"), events: [ev("PACKET_SENT", "base-synack", "SYN-ACK")] }),
    packet: pkt,
  },
  {
    id: "base-get",
    label: "Baseline: HTTP GET",
    narrative: `CLIENT sends the request: 'GET / HTTP/1.1' with 'Host: ${NAME}'. The Host header names the site; the IP header names the server.`,
    run: (s) => ({ state: tcpStep(s, "base-get", H, "get", "WEB-NEW"), events: [ev("PACKET_SENT", "base-get", "GET")] }),
    packet: pkt,
  },
  {
    id: "base-200",
    label: "Baseline: 200 OK",
    narrative: "WEB-NEW answers 'HTTP/1.1 200 OK' with a short health body. The connection closes normally.",
    run: (s) => ({ state: withNotes(httpResult(tcpStep(s, "base-200", H, "resp", "WEB-NEW"), { label: "baseline", target: `http://${NAME}/`, host: NAME, resolved: IP.new, tcp: "connected", status: "200 OK" }), "base-200", [{ kind: "observation", text: `Baseline: ${NAME} → ${IP.new} → 200 OK`, source: "client" }]), events: [ev("PACKET_SENT", "base-200", "200")] }),
    packet: pkt,
  },
  // ---- Incident ---
  {
    id: "incident-intro",
    label: "Incident: '503 Service Unavailable'",
    narrative: "After the weekend's migration, users opening the portal see '503 Service Unavailable'. The network team is paged. The client's earlier cache entry expired long ago. Start with what the client actually did.",
    run: (s) => ({ state: withNotes({ ...tick(idle(s), 3600), authA: IP.old, faultActive: true }, "incident-intro", [{ kind: "symptom", text: `Portal returns '503 Service Unavailable' after a migration`, source: "user report" }]), events: [ev("STEP_ENTERED", "incident-intro", "incident")] }),
  },
  {
    id: "inc-query",
    label: "DNS query",
    narrative: `No fresh cache entry: CLIENT queries A ${NAME}.`,
    run: (s) => ({ state: queryStep(s, "inc-query", I), events: [ev("PACKET_SENT", "inc-query", "query")] }),
    packet: pkt,
  },
  {
    id: "inc-answer",
    label: "DNS answer",
    narrative: "Inspect the answer section: which address, which TTL?",
    run: (s) => {
      const n = answerStep(tick(s, 1), "inc-answer", I, "incident");
      return { state: withNotes(n, "inc-answer", [{ kind: "observation", text: `DNS answer: ${NAME} A ${n.authA} TTL ${RECORD_TTL}`, source: "DNS response", rung: "Application" }]), events: [ev("PACKET_SENT", "inc-answer", "answer")] };
    },
    packet: pkt,
  },
  {
    id: "q-dns-addr",
    label: "Question: which address?",
    narrative: "Look at the DNS response in the packet inspector.",
    question: {
      prompt: "What address did DNS return for portal.example.test?",
      options: [
        { id: "old", label: `${IP.old} — the address of WEB-OLD, not the intended ${IP.new}` },
        { id: "new", label: `${IP.new}` },
        { id: "none", label: "No address (NXDOMAIN)" },
        { id: "dns", label: `${IP.dns}` },
      ],
      correctOptionId: "old",
      explanation: "Every later packet goes to whatever address this answer contains.",
    },
  },
  {
    id: "inc-syn",
    label: "TCP SYN to the returned address",
    narrative: `CLIENT connects to ${IP.old}:80.`,
    run: (s) => ({ state: tcpStep(s, "inc-syn", I, "syn", "WEB-OLD"), events: [ev("PACKET_SENT", "inc-syn", "SYN")] }),
    packet: pkt,
  },
  {
    id: "inc-synack",
    label: "SYN-ACK: the port is open",
    narrative: `WEB-OLD answers SYN-ACK (seq ${FLOW[I].isnS}, ack ${FLOW[I].isnC + 1}); the handshake completes.`,
    run: (s) => ({ state: withNotes(tcpStep(s, "inc-synack", I, "synack", "WEB-OLD"), "inc-synack", [{ kind: "observation", text: `TCP handshake to ${IP.old}:80 completed`, source: "capture", rung: "Transport" }]), events: [ev("PACKET_SENT", "inc-synack", "SYN-ACK")] }),
    packet: pkt,
  },
  {
    id: "q-tcp",
    label: "Question: what TCP proves",
    narrative: "The three-way handshake completed.",
    question: {
      prompt: "What does a successful TCP handshake prove?",
      options: [
        { id: "path", label: "The path works both ways, routing and any filters allow it, and something is listening on that address and port" },
        { id: "app", label: "The application is healthy" },
        { id: "right", label: "It is the right server" },
        { id: "dns", label: "DNS is correct" },
      ],
      correctOptionId: "path",
      explanation: "TCP proves reachability and a listener — not which application answered, and not whether it is the one you wanted.",
    },
  },
  {
    id: "inc-get",
    label: "HTTP GET",
    narrative: `CLIENT sends 'GET /' with 'Host: ${NAME}' to ${IP.old}.`,
    run: (s) => ({ state: tcpStep(s, "inc-get", I, "get", "WEB-OLD"), events: [ev("PACKET_SENT", "inc-get", "GET")] }),
    packet: pkt,
  },
  {
    id: "inc-503",
    label: "HTTP 503",
    narrative: "WEB-OLD answers: 'HTTP/1.1 503 Service Unavailable', Retry-After 120, body 'portal retired on this host'. Every byte of the request arrived and every byte of the answer came back.",
    run: (s) => ({ state: withNotes(httpResult(tcpStep(s, "inc-503", I, "resp", "WEB-OLD"), { label: "incident", target: `http://${NAME}/`, host: NAME, resolved: IP.old, tcp: "connected", status: "503 Service Unavailable" }), "inc-503", [{ kind: "observation", text: `HTTP response from ${IP.old}: 503 Service Unavailable (complete response)`, source: "capture", rung: "Application" }]), events: [ev("PACKET_SENT", "inc-503", "503")] }),
    packet: pkt,
  },
  {
    id: "q-503",
    label: "Question: what 503 proves",
    narrative: "The response line is 'HTTP/1.1 503 Service Unavailable'.",
    question: {
      prompt: "What does HTTP 503 prove?",
      options: [
        { id: "app", label: "An HTTP server received and parsed the request and chose to answer 'service unavailable' — the network delivered everything" },
        { id: "net", label: "The network dropped packets" },
        { id: "tcp", label: "The TCP connection failed" },
        { id: "dns", label: "DNS returned no answer" },
      ],
      correctOptionId: "app",
      explanation: "A status code only exists if the application layer answered.",
    },
  },
  {
    id: "q-503-net",
    label: "Question: packet loss?",
    narrative: "Someone insists 'the network is broken'.",
    question: {
      prompt: "Does 503 mean the network dropped the packet?",
      options: [
        { id: "no", label: "No — the response itself travelled back over the network; a 503 is an application answer, not a transport error" },
        { id: "yes", label: "Yes — 5xx codes are network errors" },
        { id: "maybe", label: "Only on port 80" },
        { id: "mtu", label: "It means an MTU problem" },
      ],
      correctOptionId: "no",
      explanation: "Transport failures look like timeouts, resets or ICMP errors — not like a well-formed HTTP response.",
    },
  },
  {
    id: "inc-direct-get",
    label: "Test the intended service directly",
    narrative: `Bypass DNS: send the same request straight to WEB-NEW's address with the right Host header — curl -H 'Host: ${NAME}' http://${IP.new}/.`,
    run: (s) => {
      const n = tcpStep(tcpStep(tcpStep(s, "inc-direct-get", Dr, "syn", "WEB-NEW"), "inc-direct-get", Dr, "synack", "WEB-NEW"), "inc-direct-get", Dr, "get", "WEB-NEW");
      return { state: n, events: [ev("PACKET_SENT", "inc-direct-get", "GET direct")] };
    },
    packet: pkt,
  },
  {
    id: "inc-direct-200",
    label: "WEB-NEW: 200 OK",
    narrative: `WEB-NEW answers 200 OK. The intended service works; the network path to it works. A direct request to ${IP.old} still gets 503.`,
    run: (s) => {
      let n = httpResult(tcpStep(s, "inc-direct-200", Dr, "resp", "WEB-NEW"), { label: "direct → WEB-NEW", target: `http://${IP.new}/`, host: NAME, tcp: "connected", status: "200 OK" });
      n = httpResult(n, { label: "direct → WEB-OLD", target: `http://${IP.old}/`, host: NAME, tcp: "connected", status: "503 Service Unavailable" });
      return { state: withNotes(n, "inc-direct-200", [{ kind: "observation", text: `Direct: ${IP.new} → 200 OK; ${IP.old} → 503`, source: "curl by IP with Host header", rung: "Application" }, { kind: "inference", text: "The service and the network work; the name leads to the wrong server" }]), events: [ev("PACKET_SENT", "inc-direct-200", "200 direct")] };
    },
    packet: pkt,
  },
  {
    id: "q-direct",
    label: "Question: why test by IP?",
    narrative: "Direct to WEB-NEW: 200. By name: 503.",
    question: {
      prompt: "Why test the intended service directly by IP?",
      options: [
        { id: "split", label: "It separates 'is the service healthy and reachable?' from 'does the name lead to it?' — here the first is yes, so the name mapping is suspect" },
        { id: "faster", label: "IP is faster than names" },
        { id: "dns", label: "To test DNS" },
        { id: "tcp", label: "To test TCP" },
      ],
      correctOptionId: "split",
      explanation: "Change one variable at a time: same request, same Host header, different address source.",
    },
  },
  {
    id: "q-host",
    label: "Question: the Host header",
    narrative: `Both requests carried 'Host: ${NAME}'.`,
    question: {
      prompt: "What does the Host header represent?",
      options: [
        { id: "name", label: "The name the client asked for, so one server (or load balancer) can host several sites — it does not choose which server the packets reach" },
        { id: "ip", label: "The destination IP address" },
        { id: "dns", label: "The DNS server to use" },
        { id: "client", label: "The client's own hostname" },
      ],
      correctOptionId: "name",
      explanation: "DNS chooses the server (IP destination); the Host header tells that server which site you want.",
    },
  },
  {
    id: "inc-authoritative",
    label: "Ask the authoritative server",
    narrative: `dig @${IP.dns} ${NAME} A: ${IP.old}, TTL ${RECORD_TTL}, authoritative answer. The migration plan says ${IP.new}. The zone was never updated.`,
    run: (s) => ({ state: withNotes(evidence(idle(s), "inc-authoritative", "DNS", { active: "zone", details: { zone: `example.test: ${NAME} A ${s.authA} TTL ${RECORD_TTL} (plan: ${IP.new})` }, action: "AUTHORITATIVE", reason: "Asking the authoritative server directly rules out a stale intermediate cache: the source of truth itself is wrong.", key: `dig @${IP.dns} ${NAME}`, result: `A ${s.authA}` }), "inc-authoritative", [{ kind: "observation", text: `Authoritative ${IP.dns}: ${NAME} A ${s.authA}; migration plan says ${IP.new}`, source: "dig @authoritative + change plan", rung: "Application" }, { kind: "hypothesis", text: `The authoritative A record is stale (${IP.old})` }]), events: [ev("STEP_ENTERED", "inc-authoritative", "dig")] }),
  },
  {
    id: "q-arp",
    label: "Question: clear ARP?",
    narrative: "A colleague wants to clear ARP caches 'just in case'.",
    question: {
      prompt: "Why is clearing ARP irrelevant here?",
      options: [
        { id: "irrelevant", label: "ARP only maps next-hop IPs to MACs on one link; every packet reached its destination and got answered — the wrong destination came from DNS" },
        { id: "relevant", label: "Stale ARP causes 503 errors" },
        { id: "dns", label: "ARP stores DNS answers" },
        { id: "tcp", label: "ARP controls TCP ports" },
      ],
      correctOptionId: "irrelevant",
      explanation: "Evidence already proves Layers 1–4 work end to end. Start where the evidence points, not at the bottom of the stack.",
    },
  },
  {
    id: "diagnostic-layers",
    label: "Walk the evidence ladder",
    narrative: "The evidence scopes this high in the stack: the lowest broken dependency is the name-to-service mapping.",
  },
  {
    id: "predict-cause",
    label: "Predict: root cause",
    narrative: "Put it together.",
    question: {
      prompt: "What is the root cause?",
      options: [
        { id: "a", label: `The authoritative A record for ${NAME} still points to ${IP.old} (WEB-OLD) instead of ${IP.new}` },
        { id: "net", label: "Packet loss between the client and the web servers" },
        { id: "port", label: "TCP/80 is blocked" },
        { id: "new", label: "WEB-NEW is down" },
      ],
      correctOptionId: "a",
      explanation: "TCP works, HTTP works, WEB-NEW answers 200 when asked directly — the name sends clients to the retired server.",
    },
    run: (s) => ({ state: withNotes(idle(s), "predict-cause", [{ kind: "root-cause", text: `Stale authoritative A record: ${NAME} → ${IP.old} (should be ${IP.new})`, source: "DNS answer + direct tests + authoritative zone" }]), events: [] }),
  },
  // ---- Repair ---
  {
    id: "repair-challenge",
    label: "Repair the name",
    narrative: "Choose the change that fixes the cause you identified.",
    action: (s, payload) => ({ state: applyApRepair(s, (payload as { choice: string }).choice), events: [ev("STEP_ENTERED", "repair-challenge", `Repair attempt: ${(payload as { choice: string }).choice}`)] }),
    requiresState: (s) => s.repaired,
  },
  // ---- Verify ---
  {
    id: "ver-stale",
    label: "Verify: the client still says 503",
    narrative: `Right after the zone update, the client retries — and still gets 503. Its cache holds ${IP.old} with time left on the TTL, so it does not ask DNS at all. The repair is correct; this client simply has not consumed it yet.`,
    run: (s) => {
      const n = tick(idle(s), 86);
      const c = cached(n)!;
      const h = hop("ver-stale", "CLIENT", { active: "cache", details: { cache: `${NAME} → ${c.address} (cached, ${remaining(n)} s left) · no query sent`, http: `GET → ${c.address} → ${statusOf(webFor(c.address))}` }, lookupType: "CLIENT resolver cache", key: NAME, result: `${c.address} from cache`, action: "CACHE HIT", reason: `A cached answer is used until its TTL expires. The authoritative change is invisible to this client for ${remaining(n)} more seconds.`, input: NAME, output: c.address });
      return { state: withNotes(httpResult({ ...n, hops: [...n.hops, h] }, { label: "right after repair (cached)", target: `http://${NAME}/`, host: NAME, resolved: c.address, tcp: "connected", status: statusOf(webFor(c.address)) }), "ver-stale", [{ kind: "observation", text: `Client cache still ${c.address} (${remaining(n)} s left) → 503; authoritative now ${n.authA}`, source: "client cache + dig" }]), events: [ev("STEP_ENTERED", "ver-stale", "cache")] };
    },
  },
  {
    id: "q-old-answer",
    label: "Question: why the old answer?",
    narrative: "The zone says .30; this client still uses .20.",
    question: {
      prompt: "Why might the old answer remain after authoritative DNS is corrected?",
      options: [
        { id: "cache", label: "Resolvers and clients cache answers for the record's TTL; they keep using the old address until it expires or is flushed" },
        { id: "wrong", label: "The fix did not work" },
        { id: "arp", label: "ARP still points to the old server" },
        { id: "tcp", label: "TCP remembers old connections" },
      ],
      correctOptionId: "cache",
      explanation: "Propagation of a DNS change is really expiry of cached copies — bounded by the TTL that was served with the old answer.",
    },
  },
  {
    id: "q-ttl",
    label: "Question: what TTL controls",
    narrative: `The answer carried TTL ${RECORD_TTL}.`,
    question: {
      prompt: "What does the DNS TTL control?",
      options: [
        { id: "cache", label: "How long resolvers and clients may reuse the answer without asking again" },
        { id: "ip", label: "The IPv4 TTL of the web traffic" },
        { id: "tcp", label: "How long the TCP connection may stay open" },
        { id: "zone", label: "How long the zone file is valid" },
      ],
      correctOptionId: "cache",
      explanation: "Lowering a record's TTL well before a migration shortens this window; it does not help after the fact.",
    },
  },
  {
    id: "ver-flush",
    label: "Verify: flush this lab client's cache",
    narrative: "For verification only, flush this lab client's DNS cache so it asks again now instead of waiting for the TTL. This is not the repair — the authoritative record was — it only lets this client see the repair immediately.",
    run: (s) => ({ state: withNotes(evidence({ ...idle(s), cache: [] }, "ver-flush", "CLIENT", { active: "cache", details: { cache: "cache flushed (verification aid; the root-cause fix is the zone)" }, action: "FLUSH (VERIFY)", reason: "Waiting out the TTL would give the same result; flushing just saves time on one client.", key: "flush DNS cache", result: "empty" }), "ver-flush", [{ kind: "observation", text: "Lab client's DNS cache flushed for verification (not the repair)", source: "client" }]), events: [ev("STEP_ENTERED", "ver-flush", "flush")] }),
  },
  {
    id: "ver-query",
    label: "Verify: fresh DNS query",
    narrative: `CLIENT queries A ${NAME} again.`,
    run: (s) => ({ state: queryStep(s, "ver-query", V), events: [ev("PACKET_SENT", "ver-query", "query")] }),
    packet: pkt,
  },
  {
    id: "ver-answer",
    label: "Verify: answer .30",
    narrative: `DNS answers ${IP.new}, TTL ${RECORD_TTL}.`,
    run: (s) => ({ state: answerStep(tick(s, 1), "ver-answer", V, "after repair"), events: [ev("PACKET_SENT", "ver-answer", "answer")] }),
    packet: pkt,
  },
  {
    id: "ver-syn",
    label: "Verify: TCP to WEB-NEW",
    narrative: `CLIENT connects to ${IP.new}:80; WEB-NEW accepts.`,
    run: (s) => ({ state: tcpStep(tcpStep(s, "ver-syn", V, "syn", "WEB-NEW"), "ver-syn", V, "synack", "WEB-NEW"), events: [ev("PACKET_SENT", "ver-syn", "handshake")] }),
    packet: pkt,
  },
  {
    id: "ver-get",
    label: "Verify: HTTP GET",
    narrative: `'GET /' with 'Host: ${NAME}' to ${IP.new}.`,
    run: (s) => ({ state: tcpStep(s, "ver-get", V, "get", "WEB-NEW"), events: [ev("PACKET_SENT", "ver-get", "GET")] }),
    packet: pkt,
  },
  {
    id: "ver-200",
    label: "Verify: 200 OK by name",
    narrative: `http://${NAME}/ → ${IP.new} → 200 OK.`,
    run: (s) => ({ state: withNotes(httpResult(tcpStep(s, "ver-200", V, "resp", "WEB-NEW"), { label: "after repair", target: `http://${NAME}/`, host: NAME, resolved: IP.new, tcp: "connected", status: "200 OK" }), "ver-200", [{ kind: "verified", text: `Authoritative A ${IP.new}; fresh lookup → ${IP.new}; http://${NAME}/ → 200 OK`, source: "DNS + HTTP" }]), events: [ev("PACKET_SENT", "ver-200", "200")] }),
    packet: pkt,
    question: {
      prompt: "What proves the final repair?",
      options: [
        { id: "chain", label: "The authoritative server answers .30, a fresh lookup returns .30, and the request by NAME now gets 200 OK from WEB-NEW" },
        { id: "flush", label: "Flushing the client cache" },
        { id: "direct", label: "The direct request to .30 returns 200" },
        { id: "tcp", label: "The TCP handshake succeeds" },
      ],
      correctOptionId: "chain",
      explanation: "The direct test and TCP worked during the incident too. The proof is the original symptom's test — by name — succeeding, with the authoritative record fixed.",
    },
  },
  // ---- Complete ---
  {
    id: "operations",
    label: "On real systems",
    narrative: `Name resolution: dig ${NAME} (answer + TTL), dig @<authoritative> ${NAME} (source of truth), and the OS resolver's cache view. Application: curl -v http://${NAME}/ (resolved address, request, status), curl -v -H 'Host: ${NAME}' http://<ip>/ to test one server directly. Before a migration, lower the TTL in advance; after changing a record, remember every cache that already holds the old answer.`,
  },
  {
    id: "complete",
    label: "Lesson complete",
    narrative: "Every layer worked — and the name still sent clients to a retired server. Found by reading the DNS answer and comparing a direct test by IP; repaired at the authoritative record; verified with a fresh lookup and a 200 by name, with caching handled explicitly.",
  },
];
