/**
 * TCP/UDP NET — the TCP/UDP lab's network as configuration, with real endpoints:
 *
 *   LAPTOP eth0 192.168.10.10/24 ── Gi0/0 R1 Gi0/1 ── eth0 SERVER 10.20.20.20/24
 *                                   192.168.10.1   10.20.20.1
 *
 * Every condition is a real setting: the Server's services (sshd 22, nginx 80/443, named 53/udp, api 8443) and any
 * `nc -lk` listener, its iptables rules (INPUT / OUTPUT: DROP, REJECT with an ICMP port-unreachable or a TCP reset),
 * its default gateway, R1's ACL on an interface, R1's interfaces (and a damaged cable that corrupts frames), and a lab
 * impairment that loses one chosen segment. The tools — curl, nc -vz, dig, ping, sleep — run on the Laptop and the
 * network answers.
 *
 * Time is discrete: 1 ms per link, each interface sends one packet per millisecond (so bursts are serialised and
 * pipelined). Each endpoint runs its own TCP (RFC 9293), for exactly what the lab teaches:
 *   - a connection is found by its 4-tuple; a SYN to a port nobody listens on gets RST,ACK <SEQ=0><ACK=SEG.SEQ+1>;
 *   - SYN and FIN each consume one sequence number; data advances SND.NXT / RCV.NXT by its length; ACK = next byte;
 *   - the receiver acknowledges every segment at once (no delayed ACK); a segment beyond RCV.NXT is kept out of order
 *     and answered with a duplicate ACK; when the hole is filled the ACK jumps over everything buffered;
 *   - retransmission: the oldest unacknowledged segment is resent, same sequence range, when its timer expires
 *     (SYN 1 s, data 200 ms, doubling each time) or after three duplicate ACKs (fast retransmit);
 *   - SYN retries 6 (the client then reports a timeout), SYN-ACK retries 5 (the half-open entry is then dropped);
 *   - the normal close: FIN, ACK, FIN, ACK through FIN-WAIT-1/2, CLOSE-WAIT, LAST-ACK and TIME-WAIT (60 s);
 *   - an ICMP port-unreachable answering a SYN aborts the attempt ("connection refused"), as Linux does.
 * Timers keep running between tests (the lab clock moves with every test and with `sleep`): a half-open SYN-RECV or
 * a TIME-WAIT is still there a few seconds later, and gone after its time.
 * Lab-chosen values (real stacks pick random ISNs and ports; payloads are lab data) are declared below.
 * Not modeled: windows / congestion control, delayed ACK, SACK, options, checksums.
 */

// ---------------------------------------------------------------------------------------------------------------
// Network and lab-chosen values
// ---------------------------------------------------------------------------------------------------------------
export type TnDev = "laptop" | "r1" | "server";
export type TnHost = "laptop" | "server";
export type TnIf = "gi0" | "gi1";
/** Capture points: the Laptop's NIC, R1's two interfaces, the Server's NIC. */
export type TnPoint = "laptop" | "r1:gi0" | "r1:gi1" | "server";
export const TN_POINTS: TnPoint[] = ["laptop", "r1:gi0", "r1:gi1", "server"];
export const TN_ADDR = { laptop: "192.168.10.10", gw: "192.168.10.1", r1wan: "10.20.20.1", server: "10.20.20.20" } as const;
export const TN_MSS = 1000;
/** The lab's web page (headers + body), and the HTTP request curl sends. */
export const TN_HTTP = { request: 78, response: 2400, requestLine: "GET / HTTP/1.1", status: "HTTP/1.1 200 OK" } as const;
export const TN_DNS = { name: "server.lab", query: 40, answer: 56 } as const;
const T = { link: 1, synRto: 1000, dataRto: 200, synRetries: 6, synackRetries: 5, timeWait: 60_000, dnsTimeout: 5000, dnsTries: 3, settle: 300 };
export const TN_TIMERS = T;
/** First client port and ISNs: lab-chosen, increasing per connection so every conversation is distinct. */
const FIRST_PORT = 51001;
const CLIENT_ISN = 100;
const SERVER_ISN = 300;
const ISN_STEP = 1000;
/** The first connection's values (what the lesson and the presentation show). */
export const TN_FIRST = { clientPort: FIRST_PORT, clientIsn: CLIENT_ISN, serverIsn: SERVER_ISN } as const;

export type TcpState = "CLOSED" | "LISTEN" | "SYN-SENT" | "SYN-RECEIVED" | "ESTABLISHED" | "FIN-WAIT-1" | "FIN-WAIT-2" | "CLOSE-WAIT" | "CLOSING" | "LAST-ACK" | "TIME-WAIT";
export type TcpFlag = "SYN" | "ACK" | "FIN" | "RST" | "PSH";
export interface Ep {
  ip: string;
  port: number;
}
export const epText = (e: Ep) => `${e.ip}:${e.port}`;

export interface TcpHdr {
  sport: number;
  dport: number;
  seq: number;
  /** Only when ACK is set. */
  ack?: number;
  flags: TcpFlag[];
  /** Payload bytes. */
  len: number;
  /** What the bytes are (lab data). */
  data?: string;
}
export interface UdpHdr {
  sport: number;
  dport: number;
  len: number;
  data: string;
}
export interface IcmpHdr {
  type: 0 | 8 | 3;
  code: number;
  /** Errors quote the packet that caused them. */
  quote?: { proto: "tcp" | "udp"; sport: number; dport: number };
}
export interface Pkt {
  id: number;
  src: string;
  dst: string;
  ttl: number;
  proto: "tcp" | "udp" | "icmp";
  tcp?: TcpHdr;
  udp?: UdpHdr;
  icmp?: IcmpHdr;
  /** A retransmission of bytes already sent once. */
  retx?: boolean;
}
export const segLen = (h: TcpHdr) => h.len + (h.flags.includes("SYN") ? 1 : 0) + (h.flags.includes("FIN") ? 1 : 0);
export const flagsText = (f: TcpFlag[]) => f.join(", ");
/** tcpdump's flag letters: [S] [S.] [.] [P.] [F.] [R.] */
export const tcpdumpFlags = (f: TcpFlag[]) => `[${f.includes("SYN") ? "S" : ""}${f.includes("FIN") ? "F" : ""}${f.includes("RST") ? "R" : ""}${f.includes("PSH") ? "P" : ""}${f.includes("ACK") ? "." : ""}]`;
export function pktName(p: Pkt): string {
  if (p.proto === "udp") return p.udp!.dport === 53 ? "DNS query" : p.udp!.sport === 53 ? "DNS response" : "UDP datagram";
  if (p.proto === "icmp") return p.icmp!.type === 3 ? (p.icmp!.code === 3 ? "ICMP port unreachable" : "ICMP unreachable") : p.icmp!.type === 8 ? "Echo Request" : "Echo Reply";
  const f = p.tcp!.flags;
  if (f.includes("RST")) return "RST";
  if (f.includes("SYN")) return f.includes("ACK") ? "SYN-ACK" : "SYN";
  if (f.includes("FIN")) return "FIN";
  if (p.tcp!.len) return "data";
  return "ACK";
}

// ---------------------------------------------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------------------------------------------
export type TnServiceId = "sshd" | "nginx" | "named" | "api";
export interface TnService {
  id: TnServiceId;
  /** systemd unit. */
  unit: string;
  /** What the process is called in `ss -p`. */
  proc: string;
  proto: "tcp" | "udp";
  ports: number[];
  running: boolean;
  what: string;
}
export interface TnIptRule {
  chain: "INPUT" | "OUTPUT";
  proto: "tcp" | "udp" | "icmp";
  /** INPUT: destination port; OUTPUT: source port. Absent = any. */
  port?: number;
  target: "ACCEPT" | "DROP" | "REJECT" | "REJECT-RST";
  /** -i eth0: only traffic arriving on the network interface (not loopback). */
  inIf?: "eth0";
  pkts: number;
}
export interface TnAclEntry {
  seq: number;
  action: "permit" | "deny";
  proto: "ip" | "tcp" | "udp" | "icmp";
  src?: string;
  srcPort?: number;
  dst?: string;
  dstPort?: number;
  hits: number;
}
export interface TnCfg {
  laptop: { ip: string; prefix: number; gw: string };
  server: { ip: string; prefix: number; gw?: string; services: TnService[]; nc: number[]; ipt: TnIptRule[] };
  r1: { ifs: Record<TnIf, { ip: string; prefix: number; up: boolean; badCable?: boolean }>; acl: { name: string; entries: TnAclEntry[]; appliedIn?: TnIf } };
}
export function tnHealthy(): TnCfg {
  return {
    laptop: { ip: TN_ADDR.laptop, prefix: 24, gw: TN_ADDR.gw },
    server: {
      ip: TN_ADDR.server,
      prefix: 24,
      gw: TN_ADDR.r1wan,
      services: [
        { id: "sshd", unit: "ssh", proc: "sshd", proto: "tcp", ports: [22], running: true, what: "remote shell (SSH)" },
        { id: "nginx", unit: "nginx", proc: "nginx", proto: "tcp", ports: [80, 443], running: true, what: "web server (HTTP, HTTPS)" },
        { id: "named", unit: "named", proc: "named", proto: "udp", ports: [53], running: true, what: "DNS server" },
        { id: "api", unit: "api", proc: "gunicorn", proto: "tcp", ports: [8443], running: true, what: "the team's API" },
      ],
      nc: [],
      ipt: [],
    },
    r1: { ifs: { gi0: { ip: TN_ADDR.gw, prefix: 24, up: true }, gi1: { ip: TN_ADDR.r1wan, prefix: 24, up: true } }, acl: { name: "EDGE", entries: [{ seq: 10, action: "permit", proto: "ip", hits: 0 }] } },
  };
}
export const tnClone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const ipNum = (ip: string) => ip.split(".").reduce((a, o) => a * 256 + Number(o), 0);
export const tnSameNet = (a: string, b: string, len: number) => Math.floor(ipNum(a) / 2 ** (32 - len)) === Math.floor(ipNum(b) / 2 ** (32 - len));
export const tnValidIp = (t: string) => /^\d{1,3}(\.\d{1,3}){3}$/.test(t) && t.split(".").every((o) => Number(o) <= 255);
/** Who owns a listening port on the Server right now (a running service or an nc listener). */
export function tnListener(cfg: TnCfg, proto: "tcp" | "udp", port: number): string | undefined {
  const s = cfg.server.services.find((x) => x.running && x.proto === proto && x.ports.includes(port));
  if (s) return s.proc;
  if (proto === "tcp" && cfg.server.nc.includes(port)) return "nc";
  return undefined;
}
export const TN_PORT_NAME: Record<number, string> = { 22: "ssh", 53: "domain", 80: "http", 123: "ntp", 443: "https", 8080: "http-alt", 8443: "https-alt" };

// ---------------------------------------------------------------------------------------------------------------
// Endpoint state
// ---------------------------------------------------------------------------------------------------------------
interface Unacked {
  seq: number;
  len: number;
  flags: TcpFlag[];
  data?: string;
}
/** What the application on top of a socket does. */
type App = { kind: "curl" } | { kind: "nc-z" } | { kind: "nginx" } | { kind: "accept" };
export interface Tcb {
  id: number;
  host: TnHost;
  local: Ep;
  remote?: Ep;
  state: TcpState;
  /** Process that owns the socket (`ss -p`). */
  proc: string;
  iss?: number;
  sndUna?: number;
  sndNxt?: number;
  irs?: number;
  rcvNxt?: number;
  unacked: Unacked[];
  /** Segments received beyond RCV.NXT, waiting for the hole to be filled. */
  ooo: { seq: number; len: number; data?: string }[];
  rtoAt?: number;
  rto: number;
  tries: number;
  dupAcks: number;
  twAt?: number;
  /** Application bytes delivered in order. */
  delivered: number;
  app: App;
  error?: "refused" | "timeout" | "reset";
  /** The run (test) that created it. */
  run: number;
}
export interface TnUdpSock {
  host: TnHost;
  local: Ep;
  proc: string;
  run: number;
}

// ---------------------------------------------------------------------------------------------------------------
// Evidence: captures, counters, the timeline of a test
// ---------------------------------------------------------------------------------------------------------------
export interface TnCap {
  n: number;
  run: number;
  /** Lab clock, ms. */
  t: number;
  point: TnPoint;
  dir: "in" | "out";
  pkt: Pkt;
  note?: string;
}
export interface TnCounters {
  in: number;
  out: number;
  crc: number;
  aclDrops: number;
}
export type TnEvent =
  /** A packet crossing one link, arriving at `t`. */
  | { k: "hop"; t: number; from: TnDev; to: TnDev; pkt: Pkt }
  | { k: "drop"; t: number; at: TnDev; pkt: Pkt; why: "acl" | "crc" | "lab-loss" | "ipt" | "no-route" | "if-down"; text: string }
  | { k: "state"; t: number; host: TnHost; tcb: number; from: TcpState; to: TcpState; local: Ep; remote?: Ep; why: string }
  | { k: "note"; t: number; host?: TnDev; text: string; tone?: "info" | "bad" | "ok" }
  | { k: "out"; t: number; text: string };
export interface TnRun {
  id: number;
  tool: "curl" | "nc" | "dig" | "ping" | "sleep";
  cmd: string;
  /** What the tool printed. */
  output: string;
  ok: boolean;
  result?: "ok" | "refused" | "timeout" | "reset" | "unreachable";
  start: number;
  end: number;
  port?: number;
  events: TnEvent[];
  /** Snapshots of every socket after each event (same index as events), so any moment of the test can be shown. */
  snaps: TnSnap[];
  capFrom: number;
}
export interface TnSnap {
  tcbs: Tcb[];
  udp: TnUdpSock[];
}

// ---------------------------------------------------------------------------------------------------------------
// Tickets
// ---------------------------------------------------------------------------------------------------------------
export type TnTicketId = "refused" | "synack-drop" | "host-fw" | "no-gw" | "dns-down" | "bad-cable";
export type TnCause = "no-listener" | "return-filter" | "host-firewall" | "no-return-route" | "dns-stopped" | "link-errors" | "server-down" | "tcp-broken" | "wrong-port" | "client-firewall";
export const TN_CAUSES: { id: TnCause; label: string }[] = [
  { id: "no-listener", label: "Nothing is listening on the service's port" },
  { id: "return-filter", label: "A filter on the path drops the Server's replies" },
  { id: "host-firewall", label: "The Server's own firewall drops the connection attempts" },
  { id: "no-return-route", label: "The Server has no route back to the client network" },
  { id: "dns-stopped", label: "The DNS service on the Server is stopped" },
  { id: "link-errors", label: "A damaged link corrupts frames (loss → retransmissions)" },
  { id: "server-down", label: "The Server is down" },
  { id: "tcp-broken", label: "TCP itself is malfunctioning" },
  { id: "wrong-port", label: "The application uses the wrong port" },
  { id: "client-firewall", label: "The Laptop's firewall blocks the traffic" },
];
export interface TnTicket {
  id: TnTicketId;
  title: string;
  report: string;
  cause: TnCause;
  setup: (c: TnCfg) => void;
  /** The test that reproduces the user's symptom. */
  repro: TnAction;
}
export const TN_TICKETS: TnTicket[] = [
  { id: "refused", title: "“Connection refused” on the intranet site", report: "“Since this morning the intranet site says connection refused — instantly. The server answers ping.”", cause: "no-listener", setup: (c) => (c.server.services.find((s) => s.id === "nginx")!.running = false), repro: { type: "curl", port: 80 } },
  {
    id: "synack-drop",
    title: "The site spins, then times out",
    report: "“The site just spins and then times out. The server team swears nginx is running — they even see our connection attempts arriving.”",
    cause: "return-filter",
    setup: (c) => (c.r1.acl = { name: "EDGE", entries: [{ seq: 5, action: "deny", proto: "tcp", src: TN_ADDR.server, srcPort: 80, hits: 0 }, { seq: 10, action: "permit", proto: "ip", hits: 0 }], appliedIn: "gi1" }),
    repro: { type: "curl", port: 80, timeout: 10 },
  },
  { id: "host-fw", title: "The new API times out", report: "“The new API on port 8443 times out from every client. On the server itself it answers fine, and the process is up.”", cause: "host-firewall", setup: (c) => (c.server.ipt = [{ chain: "INPUT", proto: "tcp", port: 8443, target: "DROP", inIf: "eth0", pkts: 0 }]), repro: { type: "nc", port: 8443, timeout: 10 } },
  { id: "no-gw", title: "Nothing works after maintenance", report: "“After last night's maintenance nobody can reach the server: SSH and the site both time out. The server team says every service is up.”", cause: "no-return-route", setup: (c) => (c.server.gw = undefined), repro: { type: "nc", port: 22, timeout: 10 } },
  { id: "dns-down", title: "Name lookups fail at once", report: "“Lookups against the lab DNS server fail immediately. The website works if we type its IP address.”", cause: "dns-stopped", setup: (c) => (c.server.services.find((s) => s.id === "named")!.running = false), repro: { type: "dig" } },
  { id: "bad-cable", title: "The site is slow and stalls", report: "“The site loads — but slowly, and sometimes it hangs for a moment before the rest appears. Nothing is down.”", cause: "link-errors", setup: (c) => (c.r1.ifs.gi1.badCable = true), repro: { type: "curl", port: 80 } },
];
export const tnTicket = (id: TnTicketId) => TN_TICKETS.find((t) => t.id === id)!;

// ---------------------------------------------------------------------------------------------------------------
// State and actions
// ---------------------------------------------------------------------------------------------------------------
export interface TnLog {
  seq: number;
  text: string;
  tone: "info" | "ok" | "warn";
}
export interface TnState {
  seq: number;
  clock: number;
  cfg: TnCfg;
  tcbs: Tcb[];
  udp: TnUdpSock[];
  captures: TnCap[];
  capN: number;
  counters: Record<TnPoint, TnCounters>;
  /** Frames R1 has received on Gi0/1 (the damaged cable corrupts every third). */
  gi1Frames: number;
  /** Lab impairment: lose the next segment matching this, once. */
  loss?: { dir: "c2s" | "s2c"; what: "data" | "syn" | "synack" | "ack"; nth: number };
  nextPort: number;
  nextIsn: number;
  /** Server-side ISN counter (one per accepted connection). */
  nextSrvIsn: number;
  nextPkt: number;
  nextTcb: number;
  runs: TnRun[];
  last?: TnRun;
  changeSeq: number;
  ticket?: TnTicketId;
  log: TnLog[];
}
export type TnAction =
  | { type: "curl"; port?: number; timeout?: number }
  | { type: "nc"; port: number; timeout?: number }
  | { type: "dig"; name?: string }
  | { type: "ping"; count?: number }
  | { type: "sleep"; seconds: number }
  | { type: "cfg"; cfg: TnCfg; text: string }
  | { type: "loss"; dir: "c2s" | "s2c"; what: "data" | "syn" | "synack" | "ack"; nth?: number }
  | { type: "ticket"; id: TnTicketId }
  | { type: "fresh" };

const zeroCounters = () => Object.fromEntries(TN_POINTS.map((p) => [p, { in: 0, out: 0, crc: 0, aclDrops: 0 }])) as Record<TnPoint, TnCounters>;
export function createTcpNet(): TnState {
  return { seq: 0, clock: 0, cfg: tnHealthy(), tcbs: [], udp: [], captures: [], capN: 0, counters: zeroCounters(), gi1Frames: 0, nextPort: FIRST_PORT, nextIsn: 0, nextSrvIsn: 0, nextPkt: 1, nextTcb: 1, runs: [], changeSeq: 0, log: [] };
}

function logged(s: TnState, patch: Partial<TnState>, text: string, tone: TnLog["tone"] = "info", changed = false): TnState {
  const seq = s.seq + 1;
  return { ...s, ...patch, seq, changeSeq: changed ? seq : (patch.changeSeq ?? s.changeSeq), log: [...s.log.slice(-80), { seq, text, tone }] };
}

export function tnApply(s: TnState, a: TnAction): TnState {
  switch (a.type) {
    case "fresh":
      return { ...createTcpNet(), seq: s.seq + 1, log: [...s.log, { seq: s.seq + 1, text: "Fresh network: healthy configuration, no sockets, no captures", tone: "info" }] };
    case "ticket": {
      const t = tnTicket(a.id);
      const cfg = tnHealthy();
      t.setup(cfg);
      return logged({ ...createTcpNet(), seq: s.seq, log: s.log }, { cfg, ticket: a.id }, `Ticket opened: ${t.title}`, "warn", true);
    }
    case "cfg":
      return logged(s, { cfg: tnClone(a.cfg) }, a.text, "info", true);
    case "loss":
      return logged(s, { loss: { dir: a.dir, what: a.what, nth: a.nth ?? 1 } }, `Lab impairment armed: R1 will lose the ${ordinal(a.nth ?? 1)} ${a.what} segment travelling ${a.dir === "s2c" ? "Server → Laptop" : "Laptop → Server"}`, "warn");
    default:
      return runTool(s, a);
  }
}
const ordinal = (n: number) => (n === 1 ? "next" : n === 2 ? "second" : n === 3 ? "third" : `${n}th`);

// ---------------------------------------------------------------------------------------------------------------
// The simulation of one test
// ---------------------------------------------------------------------------------------------------------------
interface Flight {
  t: number;
  from: TnDev;
  to: TnDev;
  pkt: Pkt;
}
interface Sim {
  s: TnState;
  cfg: TnCfg;
  tcbs: Tcb[];
  udp: TnUdpSock[];
  caps: TnCap[];
  capN: number;
  counters: Record<TnPoint, TnCounters>;
  gi1Frames: number;
  loss?: TnState["loss"];
  flights: Flight[];
  /** When each interface (device:if) is next free to send. */
  freeAt: Record<string, number>;
  events: TnEvent[];
  snaps: TnSnap[];
  now: number;
  run: number;
  nextPkt: number;
  nextTcb: number;
  nextIsn: number;
  nextSrvIsn: number;
  /** The tool's own pending deadline and finish. */
  tool: ToolState;
}
interface ToolState {
  kind: TnRun["tool"];
  done: boolean;
  doneAt?: number;
  output: string[];
  result?: TnRun["result"];
  tcb?: number;
  deadline?: number;
  /** curl: bytes of response received. */
  got: number;
  dns?: { sport: number; tries: number; nextAt: number; answered: boolean; refused: boolean };
  ping?: { count: number; sent: number; nextAt: number; replies: { seq: number; t: number }[]; sentAt: Record<number, number> };
}

const record = (m: Sim, e: TnEvent) => {
  m.events.push(e);
  m.snaps.push({ tcbs: tnClone(m.tcbs), udp: tnClone(m.udp) });
};
const cap = (m: Sim, point: TnPoint, dir: "in" | "out", pkt: Pkt, t: number, note?: string) => {
  m.caps.push({ n: ++m.capN, run: m.run, t, point, dir, pkt: tnClone(pkt), note });
  if (dir === "in") m.counters[point].in++;
  else m.counters[point].out++;
};
const pointOf = (d: TnDev, toward: TnDev): TnPoint => (d === "laptop" ? "laptop" : d === "server" ? "server" : toward === "laptop" ? "r1:gi0" : "r1:gi1");

/** Send a packet out of a device toward the next device. The interface is busy 1 ms per packet. */
function emit(m: Sim, from: TnDev, to: TnDev, pkt: Pkt, t: number) {
  const key = `${from}>${to}`;
  const depart = Math.max(t, m.freeAt[key] ?? 0);
  m.freeAt[key] = depart + 1;
  cap(m, pointOf(from, to), "out", pkt, depart);
  m.flights.push({ t: depart + T.link, from, to, pkt });
}
/** A host originates a packet: its routing decides whether it can leave at all. */
function hostSend(m: Sim, h: TnHost, pkt: Pkt, t: number): boolean {
  if (h === "server") {
    const c = m.cfg.server;
    // OUTPUT chain: a dropped packet never reaches the wire (tcpdump on the NIC doesn't see it).
    const r = outputRule(m, pkt);
    if (r && r.target !== "ACCEPT") {
      r.pkts++;
      record(m, { k: "drop", t, at: "server", pkt, why: "ipt", text: `The Server's firewall (OUTPUT ${r.proto}${r.port ? ` --sport ${r.port}` : ""} -j ${r.target === "REJECT-RST" ? "REJECT" : r.target}) discards its own ${pktName(pkt)} before it leaves` });
      return false;
    }
    if (!tnSameNet(pkt.dst, c.ip, c.prefix) && !c.gw) {
      record(m, { k: "drop", t, at: "server", pkt, why: "no-route", text: `The Server has no route to ${pkt.dst} (no default gateway): its ${pktName(pkt)} can't be sent — "Network is unreachable"` });
      return false;
    }
    emit(m, "server", "r1", pkt, t);
    return true;
  }
  emit(m, "laptop", "r1", pkt, t);
  return true;
}
const newPkt = (m: Sim, src: string, dst: string, body: Pick<Pkt, "proto" | "tcp" | "udp" | "icmp" | "retx">): Pkt => ({ id: m.nextPkt++, src, dst, ttl: 64, ...body });

function aclMatch(e: TnAclEntry, p: Pkt): boolean {
  if (e.proto !== "ip" && e.proto !== p.proto) return false;
  if (e.src && e.src !== p.src) return false;
  if (e.dst && e.dst !== p.dst) return false;
  const sp = p.tcp?.sport ?? p.udp?.sport;
  const dp = p.tcp?.dport ?? p.udp?.dport;
  if (e.srcPort !== undefined && e.srcPort !== sp) return false;
  if (e.dstPort !== undefined && e.dstPort !== dp) return false;
  return true;
}
function inputRule(m: Sim, p: Pkt) {
  return m.cfg.server.ipt.find((r) => r.chain === "INPUT" && r.proto === p.proto && (r.port === undefined || r.port === (p.tcp?.dport ?? p.udp?.dport)));
}
function outputRule(m: Sim, p: Pkt) {
  return m.cfg.server.ipt.find((r) => r.chain === "OUTPUT" && r.proto === p.proto && (r.port === undefined || r.port === (p.tcp?.sport ?? p.udp?.sport)));
}
function lossMatch(m: Sim, dir: "c2s" | "s2c", p: Pkt): boolean {
  const l = m.loss;
  if (!l || l.dir !== dir || p.proto !== "tcp") return false;
  const h = p.tcp!;
  const what = h.flags.includes("SYN") ? (h.flags.includes("ACK") ? "synack" : "syn") : h.len ? "data" : h.flags.includes("FIN") || h.flags.includes("RST") ? "other" : "ack";
  if (what !== l.what) return false;
  if (l.nth > 1) {
    m.loss = { ...l, nth: l.nth - 1 };
    return false;
  }
  m.loss = undefined;
  return true;
}

/** A packet arrives at a device. */
function arrive(m: Sim, f: Flight) {
  const { pkt, to, from, t } = f;
  if (to === "r1") {
    const inIf: TnIf = from === "laptop" ? "gi0" : "gi1";
    const outIf: TnIf = inIf === "gi0" ? "gi1" : "gi0";
    const point = pointOf("r1", from);
    const ifc = m.cfg.r1.ifs[inIf];
    if (!ifc.up) return record(m, { k: "drop", t, at: "r1", pkt, why: "if-down", text: `R1 ${inIf === "gi0" ? "Gi0/0" : "Gi0/1"} is shut down: the frame is never received` });
    if (inIf === "gi1" && ifc.badCable) {
      m.gi1Frames++;
      if (m.gi1Frames % 3 === 0) {
        m.counters[point].crc++;
        return record(m, { k: "drop", t, at: "r1", pkt, why: "crc", text: `The damaged cable corrupts the frame: R1 Gi0/1 counts a CRC error and discards it — no device reports it` });
      }
    }
    cap(m, point, "in", pkt, t);
    const acl = m.cfg.r1.acl;
    if (acl.appliedIn === inIf) {
      const e = acl.entries.find((x) => aclMatch(x, pkt));
      if (e) e.hits++;
      if (!e || e.action === "deny") {
        m.counters[point].aclDrops++;
        const last = m.caps[m.caps.length - 1];
        last.note = `dropped by ACL ${acl.name} (${e ? `seq ${e.seq} deny` : "implicit deny"})`;
        return record(m, { k: "drop", t, at: "r1", pkt, why: "acl", text: `R1's ACL ${acl.name} on ${inIf === "gi0" ? "Gi0/0" : "Gi0/1"} (in) discards it (${e ? `seq ${e.seq} deny` : "implicit deny"}) — silently` });
      }
    }
    if (lossMatch(m, inIf === "gi0" ? "c2s" : "s2c", pkt)) {
      const last = m.caps[m.caps.length - 1];
      last.note = "lost at R1 (lab impairment)";
      return record(m, { k: "drop", t, at: "r1", pkt, why: "lab-loss", text: `Lost at R1 (the lab's impairment): the ${pktName(pkt)} never leaves R1` });
    }
    if (!m.cfg.r1.ifs[outIf].up) return record(m, { k: "drop", t, at: "r1", pkt, why: "if-down", text: `R1's outgoing interface is down` });
    record(m, { k: "hop", t, from, to, pkt });
    emit(m, "r1", outIf === "gi0" ? "laptop" : "server", { ...pkt, ttl: pkt.ttl - 1 }, t);
    return;
  }
  const h = to as TnHost;
  cap(m, h, "in", pkt, t);
  record(m, { k: "hop", t, from, to, pkt });
  if (h === "server") {
    const r = inputRule(m, pkt);
    if (r && r.target !== "ACCEPT") {
      r.pkts++;
      const last = m.caps[m.caps.length - 1];
      last.note = `the Server's firewall: INPUT -j ${r.target === "REJECT-RST" ? "REJECT --reject-with tcp-reset" : r.target}`;
      record(m, { k: "drop", t, at: "server", pkt, why: "ipt", text: `The Server's firewall (INPUT ${r.proto}${r.port ? ` --dport ${r.port}` : ""} -j ${r.target === "REJECT-RST" ? "REJECT --reject-with tcp-reset" : r.target}) ${r.target === "DROP" ? "drops it silently" : r.target === "REJECT-RST" ? "answers with a TCP reset" : "answers with ICMP port unreachable"}` });
      if (r.target === "REJECT-RST" && pkt.proto === "tcp") sendRst(m, "server", pkt, t);
      if (r.target === "REJECT" && pkt.proto !== "icmp") portUnreachable(m, pkt, t);
      return;
    }
  }
  if (pkt.proto === "tcp") return tcpInput(m, h, pkt, t);
  if (pkt.proto === "udp") return udpInput(m, h, pkt, t);
  return icmpInput(m, h, pkt, t);
}

// ---------------------------------------------------------------------------------------------------------------
// TCP
// ---------------------------------------------------------------------------------------------------------------
const tcbOf = (m: Sim, id: number | undefined) => m.tcbs.find((x) => x.id === id);
function setState(m: Sim, tcb: Tcb, to: TcpState, t: number, why: string) {
  const from = tcb.state;
  tcb.state = to;
  record(m, { k: "state", t, host: tcb.host, tcb: tcb.id, from, to, local: tcb.local, remote: tcb.remote, why });
}
function closeTcb(m: Sim, tcb: Tcb, t: number, why: string, error?: Tcb["error"]) {
  if (error) tcb.error = error;
  if (tcb.state !== "CLOSED") setState(m, tcb, "CLOSED", t, why);
  m.tcbs = m.tcbs.filter((x) => x.id !== tcb.id);
  record(m, { k: "note", t, host: tcb.host, text: `${tcb.host === "laptop" ? "Laptop" : "Server"}: the socket ${epText(tcb.local)} ↔ ${tcb.remote ? epText(tcb.remote) : "*"} is gone` });
  if (m.tool.tcb === tcb.id && !m.tool.done && error) finishTcp(m, t, error);
}
function segment(m: Sim, tcb: Tcb, flags: TcpFlag[], seq: number, len = 0, data?: string, retx = false): Pkt {
  return newPkt(m, tcb.local.ip, tcb.remote!.ip, { proto: "tcp", retx, tcp: { sport: tcb.local.port, dport: tcb.remote!.port, seq, ack: flags.includes("ACK") ? tcb.rcvNxt : undefined, flags, len, data } });
}
/** Send new sequence space (SYN, data, FIN): it goes on the retransmission queue and starts the timer. */
function sendNew(m: Sim, tcb: Tcb, flags: TcpFlag[], len: number, data: string | undefined, t: number) {
  const seq = tcb.sndNxt!;
  const p = segment(m, tcb, flags, seq, len, data);
  tcb.unacked.push({ seq, len: segLen(p.tcp!), flags, data });
  tcb.sndNxt = seq + segLen(p.tcp!);
  if (tcb.rtoAt === undefined) tcb.rtoAt = t + tcb.rto;
  hostSend(m, tcb.host, p, t);
}
function sendAck(m: Sim, tcb: Tcb, t: number) {
  hostSend(m, tcb.host, segment(m, tcb, ["ACK"], tcb.sndNxt!), t);
}
function sendRst(m: Sim, host: TnHost, to: Pkt, t: number) {
  const h = to.tcp!;
  const rst: TcpHdr = h.flags.includes("ACK") ? { sport: h.dport, dport: h.sport, seq: h.ack!, flags: ["RST"], len: 0 } : { sport: h.dport, dport: h.sport, seq: 0, ack: h.seq + segLen(h), flags: ["RST", "ACK"], len: 0 };
  hostSend(m, host, newPkt(m, to.dst, to.src, { proto: "tcp", tcp: rst }), t);
}
function portUnreachable(m: Sim, to: Pkt, t: number) {
  const q = { proto: to.proto as "tcp" | "udp", sport: to.tcp?.sport ?? to.udp!.sport, dport: to.tcp?.dport ?? to.udp!.dport };
  hostSend(m, "server", newPkt(m, to.dst, to.src, { proto: "icmp", icmp: { type: 3, code: 3, quote: q } }), t);
}
const findTcb = (m: Sim, host: TnHost, local: Ep, remote: Ep) => m.tcbs.find((x) => x.host === host && x.state !== "LISTEN" && x.local.port === local.port && x.local.ip === local.ip && x.remote?.ip === remote.ip && x.remote.port === remote.port);

/** Apply an acknowledgment to the sender side of a TCB. */
function onAck(m: Sim, tcb: Tcb, ack: number, t: number): boolean {
  if (ack <= tcb.sndUna! || ack > tcb.sndNxt!) return false;
  tcb.sndUna = ack;
  tcb.unacked = tcb.unacked.filter((u) => u.seq + u.len > ack);
  tcb.dupAcks = 0;
  tcb.tries = 0;
  tcb.rto = T.dataRto;
  tcb.rtoAt = tcb.unacked.length ? t + tcb.rto : undefined;
  return true;
}
const finAcked = (tcb: Tcb) => tcb.unacked.every((u) => !u.flags.includes("FIN")) && tcb.sndUna === tcb.sndNxt;

function tcpInput(m: Sim, host: TnHost, p: Pkt, t: number) {
  const h = p.tcp!;
  const local: Ep = { ip: p.dst, port: h.dport };
  const remote: Ep = { ip: p.src, port: h.sport };
  const who = host === "laptop" ? "Laptop" : "Server";
  const tcb = findTcb(m, host, local, remote);
  if (!tcb) {
    if (h.flags.includes("RST")) return record(m, { k: "note", t, host, text: `${who}: a RST for a connection it doesn't have — ignored` });
    if (host === "server" && h.flags.includes("SYN") && !h.flags.includes("ACK")) {
      const owner = tnListener(m.cfg, "tcp", h.dport);
      if (owner) {
        const isn = SERVER_ISN + m.nextSrvIsn++ * ISN_STEP;
        const n: Tcb = { id: m.nextTcb++, host: "server", local, remote, state: "LISTEN", proc: owner, irs: h.seq, rcvNxt: h.seq + 1, iss: isn, sndUna: isn, sndNxt: isn, unacked: [], ooo: [], rto: T.synRto, tries: 0, dupAcks: 0, delivered: 0, app: owner === "nginx" || owner === "gunicorn" ? { kind: "nginx" } : { kind: "accept" }, run: m.run };
        m.tcbs.push(n);
        setState(m, n, "SYN-RECEIVED", t, `a SYN for listening port ${h.dport} (${owner}): a new connection, remembering the client's ISN ${h.seq}`);
        sendNew(m, n, ["SYN", "ACK"], 0, undefined, t);
        return;
      }
      record(m, { k: "note", t, host, text: `Server: nothing listens on TCP ${h.dport} — its TCP answers RST,ACK (no connection is created)`, tone: "bad" });
      return sendRst(m, host, p, t);
    }
    // Anything else for a connection that doesn't exist (e.g. a late SYN-ACK to a client that gave up): reset it.
    record(m, { k: "note", t, host, text: `${who}: ${pktName(p)} for a connection it doesn't have — answers RST`, tone: "bad" });
    return sendRst(m, host, p, t);
  }

  if (tcb.state === "SYN-SENT") {
    const acceptable = h.ack !== undefined && h.ack > tcb.sndUna! && h.ack <= tcb.sndNxt!;
    if (h.flags.includes("RST")) {
      if (!acceptable) return record(m, { k: "note", t, host, text: `${who}: RST with an unacceptable ACK — ignored` });
      return closeTcb(m, tcb, t, "RST,ACK answers its SYN: the port is closed — connection refused", "refused");
    }
    if (h.flags.includes("SYN") && acceptable) {
      onAck(m, tcb, h.ack!, t);
      tcb.irs = h.seq;
      tcb.rcvNxt = h.seq + 1;
      setState(m, tcb, "ESTABLISHED", t, `the SYN-ACK acknowledges its SYN (ack=${h.ack}); it now knows the Server's ISN ${h.seq}`);
      sendAck(m, tcb, t);
      return established(m, tcb, t);
    }
    return record(m, { k: "note", t, host, text: `${who}: ${pktName(p)} without SYN while SYN-SENT — dropped` });
  }
  if (h.flags.includes("RST")) return closeTcb(m, tcb, t, "the peer reset the connection", "reset");
  if (tcb.state === "SYN-RECEIVED" && h.flags.includes("SYN") && !h.flags.includes("ACK")) {
    // The client's SYN again: our SYN-ACK must have been lost — send it again.
    record(m, { k: "note", t, host, text: `${who}: the same SYN again (seq=${h.seq}) — its SYN-ACK must have been lost: sends it again` });
    const u = tcb.unacked[0];
    return void hostSend(m, host, { ...segment(m, tcb, u.flags, u.seq), retx: true }, t);
  }

  // Sequence check (synchronized states)
  const segEnd = h.seq + segLen(h);
  if (segLen(h) > 0 && h.seq !== tcb.rcvNxt) {
    if (h.seq > tcb.rcvNxt!) {
      // Beyond what we expect: keep it, and tell the sender which byte is still missing (duplicate ACK).
      if (h.ack !== undefined && h.flags.includes("ACK")) onAck(m, tcb, h.ack, t);
      if (!tcb.ooo.some((o) => o.seq === h.seq)) tcb.ooo.push({ seq: h.seq, len: h.len, data: h.data });
      record(m, { k: "note", t, host, text: `${who}: bytes ${h.seq}–${h.seq + h.len - 1} arrive but byte ${tcb.rcvNxt} is still missing — kept out of order; it repeats ack=${tcb.rcvNxt} (a duplicate ACK)`, tone: "bad" });
      return sendAck(m, tcb, t);
    }
    if (segEnd <= tcb.rcvNxt!) {
      record(m, { k: "note", t, host, text: `${who}: a duplicate (bytes it already has) — re-acknowledges ack=${tcb.rcvNxt}` });
      return sendAck(m, tcb, t);
    }
  }
  // ACK field
  if (h.flags.includes("ACK") && h.ack !== undefined) {
    const advanced = onAck(m, tcb, h.ack, t);
    if (!advanced && h.ack === tcb.sndUna && tcb.unacked.length && segLen(h) === 0 && tcb.state === "ESTABLISHED") {
      tcb.dupAcks++;
      if (tcb.dupAcks === 3) {
        const u = tcb.unacked[0];
        record(m, { k: "note", t, host, text: `${who}: a third duplicate ACK for byte ${h.ack} — fast retransmit of seq=${u.seq} without waiting for the timer`, tone: "bad" });
        hostSend(m, host, { ...segment(m, tcb, u.flags, u.seq, u.len - (u.flags.includes("FIN") ? 1 : 0) - (u.flags.includes("SYN") ? 1 : 0), u.data), retx: true }, t);
      }
    }
    if (tcb.state === "SYN-RECEIVED" && advanced) {
      setState(m, tcb, "ESTABLISHED", t, `the ACK acknowledges its SYN-ACK (ack=${h.ack})`);
      established(m, tcb, t);
    } else if (tcb.state === "FIN-WAIT-1" && finAcked(tcb)) setState(m, tcb, "FIN-WAIT-2", t, "its FIN is acknowledged; waiting for the peer's FIN");
    else if (tcb.state === "CLOSING" && finAcked(tcb)) {
      setState(m, tcb, "TIME-WAIT", t, "its FIN is acknowledged");
      tcb.twAt = t + T.timeWait;
    } else if (tcb.state === "LAST-ACK" && finAcked(tcb)) return closeTcb(m, tcb, t, "its FIN is acknowledged: the connection is fully closed");
  }
  // Data
  let ackNeeded = false;
  if (h.len > 0 && h.seq === tcb.rcvNxt) {
    tcb.rcvNxt += h.len;
    tcb.delivered += h.len;
    // the hole is filled: everything buffered behind it is now in order too
    let moved = true;
    while (moved) {
      moved = false;
      const o = tcb.ooo.find((x) => x.seq === tcb.rcvNxt);
      if (o) {
        tcb.rcvNxt += o.len;
        tcb.delivered += o.len;
        tcb.ooo = tcb.ooo.filter((x) => x !== o);
        moved = true;
      }
    }
    // The kernel acknowledges at once — except a server that answers immediately: its reply carries the ACK.
    if (tcb.app.kind === "nginx") {
      const before = tcb.sndNxt;
      appData(m, tcb, h, t);
      if (tcb.sndNxt === before) ackNeeded = true;
    } else {
      sendAck(m, tcb, t);
      appData(m, tcb, h, t);
    }
  }
  // FIN
  if (h.flags.includes("FIN") && h.seq + h.len === tcb.rcvNxt) {
    tcb.rcvNxt += 1;
    ackNeeded = true;
    if (tcb.state === "ESTABLISHED") setState(m, tcb, "CLOSE-WAIT", t, "the peer's FIN: it has finished sending");
    else if (tcb.state === "FIN-WAIT-1") setState(m, tcb, "CLOSING", t, "the peer's FIN crossed its own");
    else if (tcb.state === "FIN-WAIT-2") {
      setState(m, tcb, "TIME-WAIT", t, "the peer's FIN: both directions are closed; it waits 60 s before forgetting the connection");
      tcb.twAt = t + T.timeWait;
    }
  }
  if (ackNeeded) sendAck(m, tcb, t);
  if (h.flags.includes("FIN") && tcb.state === "CLOSE-WAIT" && tcb.app.kind !== "curl" && tcb.app.kind !== "nc-z") {
    // the server application sees end-of-file and closes its side at once
    record(m, { k: "note", t: t + 1, host, text: `${tcb.proc} reads end-of-file and closes its side` });
    setState(m, tcb, "LAST-ACK", t + 1, "its application closed: it sends its own FIN");
    sendNew(m, tcb, ["FIN", "ACK"], 0, undefined, t + 1);
  }
}

/** What the application does once its connection is ESTABLISHED. */
function established(m: Sim, tcb: Tcb, t: number) {
  if (tcb.host === "laptop" && m.tool.tcb === tcb.id) {
    if (tcb.app.kind === "nc-z") {
      m.tool.output.push(`Connection to ${tcb.remote!.ip} ${tcb.remote!.port} port [tcp/${TN_PORT_NAME[tcb.remote!.port] ?? "*"}] succeeded!`);
      m.tool.result = "ok";
      activeClose(m, tcb, t + 1, "nc -z only tests the connection: it closes it at once");
    } else if (tcb.app.kind === "curl") {
      record(m, { k: "note", t, host: "laptop", text: `curl sends its HTTP request (${TN_HTTP.request} bytes) on the connection` });
      sendNew(m, tcb, ["PSH", "ACK"], TN_HTTP.request, TN_HTTP.requestLine, t + 1);
    }
  }
}
function activeClose(m: Sim, tcb: Tcb, t: number, why: string) {
  record(m, { k: "note", t, host: tcb.host, text: why });
  // the client program has its answer and exits; its kernel finishes the close on its own
  if (m.tool.tcb === tcb.id && !m.tool.done) {
    m.tool.done = true;
    m.tool.doneAt = t;
  }
  setState(m, tcb, "FIN-WAIT-1", t, "its application closed: it sends FIN");
  sendNew(m, tcb, ["FIN", "ACK"], 0, undefined, t);
}
function appData(m: Sim, tcb: Tcb, h: TcpHdr, t: number) {
  if (tcb.app.kind === "nginx" && tcb.delivered >= TN_HTTP.request && !tcb.unacked.some((u) => u.len > 1) && tcb.sndNxt === tcb.iss! + 1) {
    record(m, { k: "note", t, host: "server", text: `${tcb.proc} has the whole request (${TN_HTTP.requestLine}) and sends the page: ${TN_HTTP.response} bytes, in ${Math.ceil(TN_HTTP.response / TN_MSS)} segments of at most ${TN_MSS}` });
    let left = TN_HTTP.response;
    let k = 0;
    while (left > 0) {
      const n = Math.min(TN_MSS, left);
      left -= n;
      sendNew(m, tcb, left === 0 ? ["PSH", "ACK"] : ["ACK"], n, k === 0 ? TN_HTTP.status : "page bytes", t + 1);
      k++;
    }
  }
  if (tcb.app.kind === "curl" && tcb.host === "laptop") {
    m.tool.got = tcb.delivered;
    if (m.tool.got >= TN_HTTP.response && !m.tool.done && tcb.state === "ESTABLISHED") {
      m.tool.output.push(PAGE);
      m.tool.result = "ok";
      activeClose(m, tcb, t + 1, "curl has the whole page and exits: it closes the connection");
    }
  }
  void h;
}
const PAGE = `<!doctype html>\n<html><head><title>PacketVerse lab server</title></head>\n<body><h1>It works over TCP.</h1><p>Served by nginx on 10.20.20.20:80</p></body></html>`;

function finishTcp(m: Sim, t: number, why: Tcb["error"]) {
  const tl = m.tool;
  const tcb = tcbOf(m, tl.tcb);
  void tcb;
  tl.result = why === "refused" ? "refused" : why === "timeout" ? "timeout" : "reset";
  tl.done = true;
  tl.doneAt = t;
}

// ---------------------------------------------------------------------------------------------------------------
// UDP and ICMP
// ---------------------------------------------------------------------------------------------------------------
function udpInput(m: Sim, host: TnHost, p: Pkt, t: number) {
  const u = p.udp!;
  if (host === "server") {
    const owner = tnListener(m.cfg, "udp", u.dport);
    if (!owner) {
      record(m, { k: "note", t, host, text: `Server: no process has UDP port ${u.dport} open — it answers ICMP port unreachable (3/3)`, tone: "bad" });
      return portUnreachable(m, p, t);
    }
    record(m, { k: "note", t, host, text: `named (UDP ${u.dport}) gets the query and answers it — no connection, no state kept`, tone: "ok" });
    hostSend(m, "server", newPkt(m, p.dst, p.src, { proto: "udp", udp: { sport: u.dport, dport: u.sport, len: TN_DNS.answer, data: `${TN_DNS.name} A ${TN_ADDR.server}` } }), t);
    return;
  }
  const d = m.tool.dns;
  const sock = m.udp.find((x) => x.host === "laptop" && x.local.port === u.dport);
  if (!d || !sock) return record(m, { k: "note", t, host, text: "Laptop: a UDP datagram for a port no process has open — discarded" });
  d.answered = true;
  m.tool.output.push(digAnswer(d.tries));
  m.tool.result = "ok";
  m.udp = m.udp.filter((x) => x !== sock);
  record(m, { k: "note", t, host, text: `dig gets its answer: ${TN_DNS.name} is ${TN_ADDR.server}. Its UDP socket is closed — there was never a connection to close`, tone: "ok" });
  m.tool.done = true;
  m.tool.doneAt = t;
}
function icmpInput(m: Sim, host: TnHost, p: Pkt, t: number) {
  const ic = p.icmp!;
  if (ic.type === 8) {
    if (host === "server") return void hostSend(m, "server", newPkt(m, p.dst, p.src, { proto: "icmp", icmp: { type: 0, code: 0 } }), t);
    return;
  }
  if (ic.type === 0 && host === "laptop" && m.tool.ping) {
    const pg = m.tool.ping;
    const seqNo = pg.replies.length + 1;
    pg.replies.push({ seq: seqNo, t });
    return;
  }
  if (ic.type === 3 && host === "laptop" && ic.quote) {
    if (ic.quote.proto === "tcp") {
      const tcb = m.tcbs.find((x) => x.host === "laptop" && x.local.port === ic.quote!.sport && x.remote?.port === ic.quote!.dport);
      if (tcb && tcb.state === "SYN-SENT") return closeTcb(m, tcb, t, "ICMP port unreachable answers its SYN: the attempt is aborted — connection refused", "refused");
      return;
    }
    const d = m.tool.dns;
    if (d && d.sport === ic.quote.sport && !d.answered) {
      d.refused = true;
      m.tool.output.push(`;; communications error to ${TN_ADDR.server}#53: connection refused`);
      m.tool.output.push(";; no servers could be reached");
      m.tool.result = "refused";
      m.udp = m.udp.filter((x) => !(x.host === "laptop" && x.local.port === d.sport));
      record(m, { k: "note", t, host, text: "dig: the ICMP error says nothing listens on UDP 53 at the Server — it reports “connection refused” (even though UDP has no connections)", tone: "bad" });
      m.tool.done = true;
      m.tool.doneAt = t;
    }
  }
}
function digAnswer(tries: number) {
  return [
    `; <<>> DiG 9.18.18 <<>> @${TN_ADDR.server} ${TN_DNS.name}`,
    ";; global options: +cmd",
    ";; Got answer:",
    `;; ->>HEADER<<- opcode: QUERY, status: NOERROR, id: 4711`,
    "",
    ";; QUESTION SECTION:",
    `;${TN_DNS.name}.\t\t\tIN\tA`,
    "",
    ";; ANSWER SECTION:",
    `${TN_DNS.name}.\t\t300\tIN\tA\t${TN_ADDR.server}`,
    "",
    `;; SERVER: ${TN_ADDR.server}#53(${TN_ADDR.server}) (UDP)`,
    `;; MSG SIZE  rcvd: ${TN_DNS.answer}${tries > 1 ? `\n;; (answered on try ${tries})` : ""}`,
  ].join("\n");
}

// ---------------------------------------------------------------------------------------------------------------
// Timers
// ---------------------------------------------------------------------------------------------------------------
/** The earliest timer of any socket or of the tool. */
function nextTimer(m: Sim): number | undefined {
  const ts: number[] = [];
  for (const x of m.tcbs) {
    if (x.rtoAt !== undefined) ts.push(x.rtoAt);
    if (x.twAt !== undefined) ts.push(x.twAt);
  }
  const tl = m.tool;
  if (!tl.done) {
    if (tl.deadline !== undefined) ts.push(tl.deadline);
    if (tl.dns && !tl.dns.answered) ts.push(tl.dns.nextAt);
    if (tl.ping && tl.ping.sent < tl.ping.count) ts.push(tl.ping.nextAt);
    if (tl.ping && tl.ping.sent >= tl.ping.count) ts.push(tl.ping.nextAt);
  }
  return ts.length ? Math.min(...ts) : undefined;
}
function fireTimers(m: Sim, t: number) {
  for (const x of [...m.tcbs]) {
    if (x.twAt !== undefined && x.twAt <= t) {
      closeTcb(m, x, t, "TIME-WAIT is over (60 s): the connection is forgotten");
      continue;
    }
    if (x.rtoAt !== undefined && x.rtoAt <= t) {
      const u = x.unacked[0];
      if (!u) {
        x.rtoAt = undefined;
        continue;
      }
      const isSyn = u.flags.includes("SYN");
      const limit = isSyn ? (x.host === "laptop" ? T.synRetries : T.synackRetries) : 15;
      if (x.tries >= limit) {
        if (x.host === "laptop") closeTcb(m, x, t, `no answer after ${limit} retransmissions — the attempt times out`, "timeout");
        else closeTcb(m, x, t, `its SYN-ACK was never acknowledged after ${limit} retransmissions — it gives up on the half-open connection`);
        continue;
      }
      x.tries++;
      record(m, { k: "note", t, host: x.host, text: `${x.host === "laptop" ? "Laptop" : "Server"}: no acknowledgment after ${x.rto} ms — its retransmission timer fires: it resends ${isSyn ? (u.flags.includes("ACK") ? "the SYN-ACK" : "the SYN") : `seq=${u.seq}`} (the same bytes) and doubles the timer to ${x.rto * 2} ms`, tone: "bad" });
      const dataLen = u.len - (u.flags.includes("FIN") ? 1 : 0) - (isSyn ? 1 : 0);
      hostSend(m, x.host, { ...segment(m, x, u.flags, u.seq, dataLen, u.data), retx: true }, t);
      x.rto *= 2;
      x.rtoAt = t + x.rto;
    }
  }
  const tl = m.tool;
  if (tl.done) return;
  if (tl.kind !== "sleep" && tl.deadline !== undefined && tl.deadline <= t) {
    const x = tcbOf(m, tl.tcb);
    if (x && x.state === "SYN-SENT") {
      record(m, { k: "note", t, host: "laptop", text: `The tool's own timeout (${(tl.deadline - m.s.clock) / 1000} s) expires: it gives up and closes the socket (nothing is sent)`, tone: "bad" });
      closeTcb(m, x, t, "the application gave up", "timeout");
    }
    tl.deadline = undefined;
  }
  if (tl.dns && !tl.dns.answered && !tl.dns.refused && tl.dns.nextAt <= t) {
    const d = tl.dns;
    if (d.tries >= T.dnsTries) {
      tl.output.push(`;; connection timed out; no servers could be reached`);
      tl.result = "timeout";
      m.udp = m.udp.filter((x) => !(x.host === "laptop" && x.local.port === d.sport));
      record(m, { k: "note", t, host: "laptop", text: `dig: no answer after ${T.dnsTries} tries of ${T.dnsTimeout / 1000} s — it gives up. UDP itself never retried: dig did`, tone: "bad" });
      tl.done = true;
      tl.doneAt = t;
    } else {
      d.tries++;
      record(m, { k: "note", t, host: "laptop", text: `dig: no answer in ${T.dnsTimeout / 1000} s — the application (not UDP) sends the query again (try ${d.tries})`, tone: "bad" });
      sendQuery(m, t);
    }
  }
  if (tl.ping) {
    const pg = tl.ping;
    if (pg.sent < pg.count && pg.nextAt <= t) {
      pg.sent++;
      pg.sentAt[pg.sent] = t;
      hostSend(m, "laptop", newPkt(m, m.cfg.laptop.ip, m.cfg.server.ip, { proto: "icmp", icmp: { type: 8, code: 0 } }), t);
      pg.nextAt = t + 1000;
    } else if (pg.sent >= pg.count && pg.nextAt <= t) {
      const lines = Array.from({ length: pg.count }, (_, i) => {
        const r = pg.replies[i];
        return r ? `64 bytes from ${TN_ADDR.server}: icmp_seq=${i + 1} ttl=63 time=${(r.t - pg.sentAt[i + 1]).toFixed(1)} ms` : undefined;
      }).filter(Boolean) as string[];
      const loss = Math.round((1 - pg.replies.length / pg.count) * 100);
      tl.output.push([`PING ${TN_ADDR.server} (${TN_ADDR.server}) 56(84) bytes of data.`, ...lines, "", `--- ${TN_ADDR.server} ping statistics ---`, `${pg.count} packets transmitted, ${pg.replies.length} received, ${loss}% packet loss`].join("\n"));
      tl.result = pg.replies.length ? "ok" : "timeout";
      tl.done = true;
      tl.doneAt = t;
    }
  }
}
function sendQuery(m: Sim, t: number) {
  const d = m.tool.dns!;
  d.nextAt = t + T.dnsTimeout;
  hostSend(m, "laptop", newPkt(m, m.cfg.laptop.ip, m.cfg.server.ip, { proto: "udp", udp: { sport: d.sport, dport: 53, len: TN_DNS.query, data: `${TN_DNS.name} A?` } }), t);
}

// ---------------------------------------------------------------------------------------------------------------
// Running a tool
// ---------------------------------------------------------------------------------------------------------------
export const tnCommand = (a: TnAction): string => {
  switch (a.type) {
    case "curl":
      return `curl${a.timeout ? ` --connect-timeout ${a.timeout}` : ""} http://${TN_ADDR.server}${a.port && a.port !== 80 ? `:${a.port}` : ""}/`;
    case "nc":
      return `nc -vz${a.timeout ? ` -w ${a.timeout}` : ""} ${TN_ADDR.server} ${a.port}`;
    case "dig":
      return `dig @${TN_ADDR.server} ${a.name ?? TN_DNS.name}`;
    case "ping":
      return `ping -c ${a.count ?? 1} ${TN_ADDR.server}`;
    case "sleep":
      return `sleep ${a.seconds}`;
    default:
      return a.type;
  }
};

function runTool(s: TnState, a: TnAction): TnState {
  const cfg = tnClone(s.cfg);
  const id = s.seq + 1;
  const m: Sim = {
    s,
    cfg,
    tcbs: tnClone(s.tcbs),
    udp: tnClone(s.udp),
    caps: [...s.captures],
    capN: s.capN,
    counters: tnClone(s.counters),
    gi1Frames: s.gi1Frames,
    loss: s.loss,
    flights: [],
    freeAt: {},
    events: [],
    snaps: [],
    now: s.clock,
    run: id,
    nextPkt: s.nextPkt,
    nextTcb: s.nextTcb,
    nextIsn: s.nextIsn,
    nextSrvIsn: s.nextSrvIsn,
    tool: { kind: a.type === "curl" ? "curl" : a.type === "nc" ? "nc" : a.type === "dig" ? "dig" : a.type === "ping" ? "ping" : "sleep", done: false, output: [], got: 0 },
  };
  let nextPort = s.nextPort;
  const t0 = s.clock;
  const capFrom = s.capN + 1;
  if (a.type === "curl" || a.type === "nc") {
    const port = a.type === "curl" ? (a.port ?? 80) : a.port;
    const isn = CLIENT_ISN + m.nextIsn * ISN_STEP;
    m.nextIsn++;
    const tcb: Tcb = { id: m.nextTcb++, host: "laptop", local: { ip: cfg.laptop.ip, port: nextPort++ }, remote: { ip: cfg.server.ip, port }, state: "CLOSED", proc: a.type, iss: isn, sndUna: isn, sndNxt: isn, unacked: [], ooo: [], rto: T.synRto, tries: 0, dupAcks: 0, delivered: 0, app: a.type === "curl" ? { kind: "curl" } : { kind: "nc-z" }, run: id };
    m.tcbs.push(tcb);
    m.tool.tcb = tcb.id;
    if (a.timeout) m.tool.deadline = t0 + a.timeout * 1000;
    record(m, { k: "note", t: t0, host: "laptop", text: `${a.type} opens a TCP socket: the Laptop picks a free source port, ${tcb.local.port}, for ${epText(tcb.remote!)}` });
    setState(m, tcb, "SYN-SENT", t0, `it sends a SYN with its initial sequence number ${isn}`);
    sendNew(m, tcb, ["SYN"], 0, undefined, t0);
  } else if (a.type === "dig") {
    const sport = nextPort++;
    m.udp.push({ host: "laptop", local: { ip: cfg.laptop.ip, port: sport }, proc: "dig", run: id });
    m.tool.dns = { sport, tries: 1, nextAt: t0, answered: false, refused: false };
    record(m, { k: "note", t: t0, host: "laptop", text: `dig opens a UDP socket on port ${sport} and sends one query to ${TN_ADDR.server}:53 — no handshake first` });
    sendQuery(m, t0);
  } else if (a.type === "ping") {
    m.tool.ping = { count: a.count ?? 1, sent: 0, nextAt: t0, replies: [], sentAt: {} };
  } else if (a.type === "sleep") {
    m.tool.deadline = t0 + a.seconds * 1000;
  }

  // ---- event loop
  let guard = 0;
  const horizon = (): number => {
    // after the tool is done, keep going only for what follows immediately (ACKs, FINs, short retransmissions)
    return m.tool.done ? (m.tool.doneAt ?? m.now) + T.settle : Infinity;
  };
  while (guard++ < 20000) {
    const nf = m.flights.length ? Math.min(...m.flights.map((f) => f.t)) : undefined;
    const nt = nextTimer(m);
    const next = Math.min(nf ?? Infinity, nt ?? Infinity);
    if (a.type === "sleep" && !m.tool.done && (next === Infinity || next > m.tool.deadline!)) {
      m.now = m.tool.deadline!;
      fireTimers(m, m.now);
      m.tool.done = true;
      m.tool.doneAt = m.now;
      break;
    }
    if (next === Infinity) break;
    if (next > horizon() && !m.flights.length) break;
    m.now = Math.max(m.now, next);
    // arrivals first, then timers, at the same millisecond
    const due = m.flights.filter((f) => f.t <= m.now).sort((x, y) => x.t - y.t || x.pkt.id - y.pkt.id);
    m.flights = m.flights.filter((f) => f.t > m.now);
    for (const f of due) arrive(m, f);
    fireTimers(m, m.now);
    if (a.type === "sleep" && m.tool.deadline !== undefined && m.now >= m.tool.deadline) {
      m.tool.done = true;
      m.tool.doneAt = m.now;
    }
    if (m.tool.done && !m.flights.length && (nextTimer(m) ?? Infinity) > horizon()) break;
  }
  // ---- what the tool printed
  const tl = m.tool;
  const port = a.type === "curl" ? (a.port ?? 80) : a.type === "nc" ? a.port : undefined;
  const ms = (tl.doneAt ?? m.now) - t0;
  if ((a.type === "curl" || a.type === "nc") && tl.result !== "ok") {
    const r = tl.result ?? "timeout";
    const svc = TN_PORT_NAME[port!] ?? "*";
    if (a.type === "curl") tl.output.push(r === "refused" ? `curl: (7) Failed to connect to ${TN_ADDR.server} port ${port} after ${ms} ms: Connection refused` : r === "reset" ? `curl: (56) Recv failure: Connection reset by peer` : a.timeout ? `curl: (28) Connection timed out after ${a.timeout * 1000 + 1} milliseconds` : `curl: (28) Failed to connect to ${TN_ADDR.server} port ${port} after ${ms} ms: Connection timed out`);
    else tl.output.push(r === "refused" ? `nc: connect to ${TN_ADDR.server} port ${port} (tcp) failed: Connection refused` : a.timeout ? `nc: connect to ${TN_ADDR.server} port ${port} (tcp) timed out: Operation now in progress` : `nc: connect to ${TN_ADDR.server} port ${port} (tcp) failed: Connection timed out`);
    void svc;
  }
  const result = a.type === "sleep" ? "ok" : (tl.result ?? "timeout");
  const runRec: TnRun = { id, tool: tl.kind, cmd: tnCommand(a), output: tl.output.join("\n"), ok: result === "ok", result, start: t0, end: m.now, port, events: m.events, snaps: m.snaps, capFrom };
  const text = a.type === "sleep" ? `sleep ${a.seconds}: the lab clock moves on ${a.seconds} s` : `${runRec.cmd} → ${result === "ok" ? "success" : result}`;
  return logged(s, { cfg, tcbs: m.tcbs, udp: m.udp, captures: m.caps.slice(-600), capN: m.capN, counters: m.counters, gi1Frames: m.gi1Frames, loss: m.loss, clock: m.now, nextPort, nextIsn: m.nextIsn, nextSrvIsn: m.nextSrvIsn, nextPkt: m.nextPkt, nextTcb: m.nextTcb, runs: [...s.runs.slice(-30), runRec], last: runRec }, text, result === "ok" ? "ok" : "warn");
}

// ---------------------------------------------------------------------------------------------------------------
// Socket tables (what ss prints) and verdicts
// ---------------------------------------------------------------------------------------------------------------
export const SS_STATE: Record<TcpState, string> = { CLOSED: "CLOSED", LISTEN: "LISTEN", "SYN-SENT": "SYN-SENT", "SYN-RECEIVED": "SYN-RECV", ESTABLISHED: "ESTAB", "FIN-WAIT-1": "FIN-WAIT-1", "FIN-WAIT-2": "FIN-WAIT-2", "CLOSE-WAIT": "CLOSE-WAIT", CLOSING: "CLOSING", "LAST-ACK": "LAST-ACK", "TIME-WAIT": "TIME-WAIT" };
export interface TnSockRow {
  proto: "tcp" | "udp";
  state: string;
  local: string;
  peer: string;
  proc?: string;
  tcb?: Tcb;
}
/** A host's sockets: listeners (from its configuration) and connections (from its TCBs). */
export function tnSockets(cfg: TnCfg, tcbs: Tcb[], udp: TnUdpSock[], host: TnHost): TnSockRow[] {
  const rows: TnSockRow[] = [];
  if (host === "server") {
    for (const sv of cfg.server.services)
      if (sv.running)
        for (const p of sv.ports) rows.push({ proto: sv.proto, state: sv.proto === "tcp" ? "LISTEN" : "UNCONN", local: `0.0.0.0:${p}`, peer: "0.0.0.0:*", proc: sv.proc });
    for (const p of cfg.server.nc) rows.push({ proto: "tcp", state: "LISTEN", local: `0.0.0.0:${p}`, peer: "0.0.0.0:*", proc: "nc" });
  }
  for (const x of tcbs.filter((t) => t.host === host)) rows.push({ proto: "tcp", state: SS_STATE[x.state], local: epText(x.local), peer: x.remote ? epText(x.remote) : "*", proc: x.state === "TIME-WAIT" ? undefined : x.proc, tcb: x });
  for (const u of udp.filter((x) => x.host === host)) rows.push({ proto: "udp", state: "UNCONN", local: epText(u.local), peer: "0.0.0.0:*", proc: u.proc });
  return rows;
}

/** Everything a ticket needs to be proven fixed — read from the network. */
export function tnProofs(s: TnState): { label: string; ok: boolean; detail: string }[] {
  if (!s.ticket) return [];
  const t = tnTicket(s.ticket);
  const fresh = s.runs.filter((r) => r.id > s.changeSeq);
  const c = s.cfg;
  const repro = t.repro;
  const test = fresh.find((r) => r.ok && (repro.type === "curl" ? r.tool === "curl" : repro.type === "nc" ? r.tool === "nc" && r.port === repro.port : r.tool === "dig"));
  const fixed: Record<TnTicketId, [boolean, string]> = {
    refused: [!!tnListener(c, "tcp", 80), "something listens on TCP 80 again (ss -tlnp on the Server)"],
    "synack-drop": [!c.r1.acl.appliedIn || !c.r1.acl.entries.some((e) => e.action === "deny" && e.proto !== "udp" && (e.srcPort === undefined || e.srcPort === 80)), "R1 no longer drops the Server's TCP replies (show access-lists)"],
    "host-fw": [!c.server.ipt.some((r) => r.chain === "INPUT" && r.target !== "ACCEPT" && (r.port === undefined || r.port === 8443)), "the Server's INPUT chain lets TCP 8443 in (iptables -L INPUT)"],
    "no-gw": [!!c.server.gw, "the Server has a default route again (ip route)"],
    "dns-down": [!!tnListener(c, "udp", 53), "named listens on UDP 53 again (ss -ulnp)"],
    "bad-cable": [!c.r1.ifs.gi1.badCable, "R1 Gi0/1's cable is replaced: no new CRC errors"],
  };
  const [ok, detail] = fixed[t.id];
  return [
    { label: "Fixed on the device", ok, detail },
    { label: "Proven with a fresh test", ok: !!test && (t.id !== "bad-cable" || !test.events.some((e) => e.k === "drop")), detail: `${tnCommand(repro)} succeeds after the change${t.id === "bad-cable" ? " with no retransmissions" : ""}` },
  ];
}
export function tnCauseFeedback(s: TnState, c: TnCause): { right: boolean; consequence?: boolean; text: string } {
  if (!s.ticket) return { right: false, text: "Open a ticket first." };
  const t = tnTicket(s.ticket);
  if (c === t.cause) {
    const why: Record<TnTicketId, string> = {
      refused: "Right. The SYN reaches the Server and its TCP answers RST,ACK at once: the host is fine, but no socket listens on 80/443 — nginx is stopped (ss -tlnp shows no :80 or :443).",
      "synack-drop": "Right. SYN in at the Server, SYN-ACK out of the Server, SYN-ACK in on R1 Gi0/1 — and never out of Gi0/0. R1's ACL EDGE (in on Gi0/1) denies TCP from 10.20.20.20 port 80. The Server sits in SYN-RECV, the Laptop in SYN-SENT.",
      "host-fw": "Right. The SYN reaches the Server's NIC (its capture shows it), gunicorn listens on 8443, yet no SYN-ACK is ever sent: the Server's own INPUT chain drops TCP 8443 before TCP sees it.",
      "no-gw": "Right. The SYN reaches the Server and a SYN-RECV entry appears, but nothing ever leaves the Server: it has no route back to 192.168.10.0/24 (ip route shows no default). An IP problem, not TCP.",
      "dns-down": "Right. The query reaches the Server and comes back as ICMP port unreachable: no process has UDP 53 open. dig words it “connection refused”, but UDP has no connections — named is stopped.",
      "bad-cable": "Right. Every test succeeds, but the captures show retransmissions and duplicate ACKs, and R1 Gi0/1 counts CRC errors: frames are corrupted on that cable. TCP is doing its job — recovering — while the physical link loses data.",
    };
    return { right: true, text: why[t.id] };
  }
  // Each wrong cause is ruled out by something the learner can look at, read from the lab as it is now.
  const cfg = s.cfg;
  const r = t.repro;
  const dns = r.type === "dig";
  const port = r.type === "curl" || r.type === "nc" ? (r.port ?? 80) : 53;
  const proto = dns ? "udp" : "tcp";
  const listener = tnListener(cfg, proto, port);
  const drops = cfg.r1.acl.appliedIn ? cfg.r1.acl.entries.filter((e) => e.action === "deny") : [];
  const inputDrops = cfg.server.ipt.filter((x) => x.chain === "INPUT" && x.target !== "ACCEPT");
  const wrong: Partial<Record<TnCause, string>> = {
    "no-listener": listener
      ? `Something does listen: ${listener} has ${proto.toUpperCase()} ${port} open (ss -${proto === "tcp" ? "t" : "u"}lnp on the Server). And a port with no listener answers at once — RST for TCP, ICMP port unreachable for UDP — it doesn't stay silent.`
      : `True — nothing has ${proto.toUpperCase()} ${port} open. But name the cause precisely: which service owns that port, and is it running?`,
    "return-filter": drops.length ? `R1's ${cfg.r1.acl.name} does have deny lines — but compare its hit counters and the captures: are the Server's replies the packets it catches?` : `Nothing on the path filters: R1's ${cfg.r1.acl.name} ${cfg.r1.acl.appliedIn ? "has no deny line" : "isn't applied to any interface"} (show access-lists, show ip interface).`,
    "host-firewall": inputDrops.length ? "The Server's INPUT chain has DROP rules — check whether they match this test's port (sudo iptables -L INPUT -n)." : "The Server's INPUT chain drops nothing (sudo iptables -L INPUT -n): its own firewall isn't involved.",
    "no-return-route": cfg.server.gw ? `The Server has a default route via ${cfg.server.gw} (ip route): its replies have a way back.` : "True, the Server has no default route — but is that what this symptom shows? Compare where each capture point lost the traffic.",
    "dns-stopped": dns ? "The query does reach the Server — look at what comes back and which process owns UDP 53." : `This test doesn't use DNS at all: it connects to ${r.type === "curl" ? "the web server" : `TCP ${port}`} by IP address.`,
    "link-errors": cfg.r1.ifs.gi1.badCable ? "The link does lose frames — but is that what this test shows? Compare the captures." : "R1's interfaces count no CRC errors (show interfaces) and no capture shows a retransmission: the links are clean.",
    "server-down": "A down server answers nothing at all. Here the evidence shows the Server (or its NIC) really receives traffic.",
    "tcp-broken": "TCP behaves exactly by the book in every capture. Find what makes it behave that way.",
    "wrong-port": "The client uses the service's standard port; check what is (or isn't) listening there instead.",
    "client-firewall": "The Laptop's SYNs leave its NIC and arrive at R1 — nothing on the Laptop blocks them.",
  };
  const consequence = c === "tcp-broken" || c === "server-down" || (c === "no-listener" && !listener);
  return { right: false, consequence, text: wrong[c] ?? "That doesn't match the evidence: compare what each capture point saw, and what each endpoint's socket table says." };
}
