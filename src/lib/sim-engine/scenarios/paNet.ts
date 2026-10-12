import { spClone, type SpBase, type SpMoment, type SpRun } from "@/components/sp-lab/spKit";
import { PA, PA_MAC, SERVICE_PORT, INITIAL_TTL, REQ_LEN, RESP_LEN } from "./troubleshootingPacketAnalysis";

/**
 * Packet Analysis Lab — the guided lesson's network, live: CLIENT — SW1 — R1 — SERVER, one TCP/443 service, plus the
 * capture laptop (CAPTURE) that SW1's analyzer session feeds on ge-0/0/23.
 *
 * Addresses, MACs, the service port and the TCP numbering come from the guided model (troubleshootingPacketAnalysis):
 * CLIENT 10.10.10.10/24 (gw 10.10.10.1), R1 ge-0/0/0 10.10.10.1 / ge-0/0/1 10.20.20.1, SERVER 10.20.20.20:443.
 * Connection k uses source port 51000+k, client ISN 1000·(k+1), server ISN 5000+1000·k — the guided healthy, incident
 * and verify flows are connections 0, 1 and 2.
 *
 * Modeled:
 * - Every frame of every test, with its time, Ethernet addresses, TTL (64, 63 after R1) and IP ID, recorded at five
 *   capture points: CLIENT eth0 (host capture), SPAN (SW1 analyzer → CAPTURE), R1 ge-0/0/0, R1 ge-0/0/1, SERVER eth0.
 *   tcpdump on a host sees frames before netfilter (a host firewall drop is still captured); R1 `monitor traffic` sees
 *   frames actually received or transmitted on that interface (an egress-queue drop is never transmitted).
 * - TCP: SYN retransmissions at 1 s, then 2 s (RFC 6298 backoff); a server in SYN-RECEIVED answers a repeated SYN with
 *   the same SYN-ACK; data segments retransmit after 200 ms (Linux minimum RTO); a closed port answers RST,ACK at once.
 * - nc -z gives up after its -w timeout (5 s); curl connects, sends a 120-byte request, receives 380 bytes, closes.
 * - ARP: CLIENT resolves its gateway when its cache is empty; SERVER resolves its configured default gateway — a wrong
 *   gateway is ARPed three times at 1 s intervals and the reply never comes, so nothing is sent toward the client.
 * - Faults: R1 class-of-service shaping on ge-0/0/0 tail-drops 1 of every 6 frames offered to that egress queue
 *   (deterministic: the 1st, 7th, 13th … after it is applied); SERVER nginx stopped; SERVER iptables DROP for TCP/443;
 *   SERVER default gateway 10.20.20.254; SW1 analyzer mirroring ingress only.
 */

export type PaD = "CLIENT" | "SW1" | "R1" | "SERVER" | "CAPTURE";
export const PA_DEVS: PaD[] = ["CLIENT", "SW1", "R1", "SERVER", "CAPTURE"];
export type CapPt = "client" | "span" | "r1-0" | "r1-1" | "server";
export const CAP_PTS: { id: CapPt; label: string; where: string }[] = [
  { id: "client", label: "CLIENT eth0", where: "host capture on CLIENT" },
  { id: "span", label: "SPAN (SW1 ge-0/0/1)", where: "SW1 analyzer CAP → CAPTURE laptop" },
  { id: "r1-0", label: "R1 ge-0/0/0", where: "R1 client-facing interface" },
  { id: "r1-1", label: "R1 ge-0/0/1", where: "R1 server-facing interface" },
  { id: "server", label: "SERVER eth0", where: "host capture on SERVER" },
];
export const GOOD_GW = PA.r1Srv;
export const BAD_GW = "10.20.20.254";
export const SPAN_OUT = "ge-0/0/23";
export const DROP_EVERY = 6;
export const NC_TIMEOUT_S = 5;
export const BASE_CLOCK = 10 * 3600; // 10:00:00, the capture clock (seconds)

// ---------------------------------------------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------------------------------------------
export interface Analyzer {
  ingress: boolean;
  egress: boolean;
}
/** Junos devices' configuration (SW1 uses `analyzer`, R1 uses `shape`). */
export interface PaJCfg {
  analyzer?: Analyzer | null;
  shape?: boolean;
}
export interface PaHosts {
  nginx: boolean;
  drop443: boolean;
  gw: string;
  clientArp: boolean;
}
export function paHealthy(): { SW1: PaJCfg; R1: PaJCfg } {
  return { SW1: { analyzer: { ingress: true, egress: true } }, R1: { shape: false } };
}

// ---------------------------------------------------------------------------------------------------------------
// Frames and captures
// ---------------------------------------------------------------------------------------------------------------
export type Dir = "c2s" | "s2c" | "srv";
export interface Frame {
  n: number;
  t: number; // seconds (capture clock), time it leaves the sender
  dir: Dir;
  kind: "arp-req" | "arp-rep" | "tcp" | "icmp";
  src: string;
  dst: string;
  sport?: number;
  dport?: number;
  flags?: string; // tcpdump style: S, S., ., P., F., R.
  seq?: number;
  ack?: number;
  len: number; // TCP/ICMP payload
  ipId?: number;
  /** tcpdump text after the protocol (built per frame). */
  text: string;
  conn?: number;
  /** This sender's and the peer's initial sequence numbers (tcpdump prints relative numbers without -S). */
  isn?: number;
  peerIsn?: number;
  retx?: boolean;
  /** Where it was last seen and why it went no further. */
  lostAt?: string;
}
export interface CapRow {
  t: number;
  n: number;
  dirAt: "In" | "Out";
  ethSrc: string;
  ethDst: string;
  ttl?: number;
  frame: Frame;
}
export type Captures = Record<CapPt, CapRow[]>;
export interface Counters {
  in: number;
  out: number;
  drops: number;
}
export const IFACES: { key: string; dev: PaD; ifn: string }[] = [
  { key: "CLIENT:eth0", dev: "CLIENT", ifn: "eth0" },
  { key: "SW1:ge-0/0/1", dev: "SW1", ifn: "ge-0/0/1" },
  { key: "SW1:ge-0/0/24", dev: "SW1", ifn: "ge-0/0/24" },
  { key: "SW1:ge-0/0/23", dev: "SW1", ifn: "ge-0/0/23" },
  { key: "R1:ge-0/0/0", dev: "R1", ifn: "ge-0/0/0" },
  { key: "R1:ge-0/0/1", dev: "R1", ifn: "ge-0/0/1" },
  { key: "SERVER:eth0", dev: "SERVER", ifn: "eth0" },
  { key: "CAPTURE:eth1", dev: "CAPTURE", ifn: "eth1" },
];

// ---------------------------------------------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------------------------------------------
export type TestKind = "nc" | "curl" | "ping";
export interface TestResult {
  id: number;
  kind: TestKind;
  conn?: number;
  sport?: number;
  t0: number;
  outcome: "ok" | "refused" | "timeout" | "partial";
  /** nc/curl: seconds until the client saw the SYN-ACK (connect time); curl: total time. */
  connect?: number;
  total?: number;
  synRetx: number;
  dataRetx: number;
  pingSent?: number;
  pingRecv?: number;
  frames: number[];
  cfgSeq: number;
  /** SPAN showed the server's answer for this test. */
  spanSawReply: boolean;
}
export interface PaSnap {
  frames: Frame[];
}
export interface PaSys {
  t: number;
  dev: PaD;
  text: string;
}
export interface PaState extends SpBase<PaSnap> {
  cfg: { SW1: PaJCfg; R1: PaJCfg };
  hist: { SW1: PaJCfg[]; R1: PaJCfg[] };
  hosts: PaHosts;
  frames: Frame[];
  caps: Captures;
  counters: Record<string, Counters>;
  /** Counter baselines taken by `clear interfaces statistics` (Junos) — what `show interfaces` subtracts. */
  cleared: Record<string, Counters>;
  /** Frames offered to R1 ge-0/0/0 egress while shaping is configured. */
  shapeOffered: number;
  iptDropPkts: number;
  tests: TestResult[];
  conns: number;
  /** SERVER half-open sockets (SYN-RECV) left by connections whose SYN-ACK never left. */
  synRecv: number[];
  clientSock?: { sport: number; state: "TIME-WAIT" | "SYN-SENT" | "CLOSED" };
  serverArpFailed: boolean;
  sys: PaSys[];
  /** Counter snapshot taken from the lab's Counters tool (for deltas). */
  snapshot?: Record<string, Counters>;
  wiped?: boolean;
  /** SERVER's ARP resolution for a wrong gateway is in progress until this clock value. */
  srvArpUntil?: number;
  /** Interface statistics were cleared at least once (the counters tool's baseline). */
  clearedOnce: boolean;
}
export type PaTicketId = "retdrop" | "closed" | "hostfw" | "gateway" | "spanrx";
export type PaAction =
  | { type: "cfg"; dev: "SW1" | "R1"; cfg: PaJCfg; text: string }
  | { type: "host"; f: (h: PaHosts) => void; text: string; dev: PaD }
  | { type: "set"; changes: { dev: "SW1" | "R1"; f: (c: PaJCfg) => void }[]; host?: (h: PaHosts) => void; text: string }
  | { type: "nc" }
  | { type: "curl" }
  | { type: "ping"; count: number }
  | { type: "clear-caps" }
  | { type: "clear-stats"; ifn?: string }
  | { type: "snapshot" }
  | { type: "flush-arp" }
  | { type: "wipe-analyzer" }
  | { type: "ticket"; id: PaTicketId };

const zero = (): Counters => ({ in: 0, out: 0, drops: 0 });
export function createPaNet(seq = 0): PaState {
  const counters: Record<string, Counters> = {};
  const cleared: Record<string, Counters> = {};
  for (const i of IFACES) {
    counters[i.key] = zero();
    cleared[i.key] = zero();
  }
  return {
    seq,
    cfgSeq: 0,
    clock: BASE_CLOCK,
    runs: [],
    log: [{ seq, t: BASE_CLOCK, text: "Healthy network: CLIENT reaches SERVER:443 through SW1 and R1. Captures are running at all five points.", tone: "info" }],
    cfg: paHealthy(),
    hist: { SW1: [], R1: [] },
    hosts: { nginx: true, drop443: false, gw: GOOD_GW, clientArp: false },
    frames: [],
    caps: { client: [], span: [], "r1-0": [], "r1-1": [], server: [] },
    counters,
    cleared,
    shapeOffered: 0,
    iptDropPkts: 0,
    tests: [],
    conns: 0,
    synRecv: [],
    serverArpFailed: false,
    sys: [],
    clearedOnce: false,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// The data path
// ---------------------------------------------------------------------------------------------------------------
const US = 1e-6;
const HOP = { cSw: 10 * US, swR: 20 * US, rFwd: 30 * US, rS: 20 * US };
const MAC = { CLIENT: PA_MAC.CLIENT, R1_LAN: PA_MAC.R1_LAN, R1_SRV: PA_MAC.R1_SRV, SERVER: PA_MAC.SERVER, BCAST: "ff:ff:ff:ff:ff:ff" };
const lc = (m: string) => m.toLowerCase();

interface Ctx {
  s: PaState;
  frames: Frame[];
}
function cnt(s: PaState, key: string, f: keyof Counters, by = 1) {
  s.counters[key][f] += by;
}
function cap(s: PaState, pt: CapPt, t: number, f: Frame, dirAt: "In" | "Out", ethSrc: string, ethDst: string, ttl?: number) {
  if (pt === "span") {
    const a = s.cfg.SW1.analyzer;
    if (!a) return;
    if (dirAt === "In" && !a.ingress) return; // frames received on ge-0/0/1 (from CLIENT)
    if (dirAt === "Out" && !a.egress) return; // frames sent out of ge-0/0/1 (to CLIENT)
    cnt(s, "SW1:ge-0/0/23", "out");
    cnt(s, "CAPTURE:eth1", "in");
  }
  const rows = [...s.caps[pt], { t, n: f.n, dirAt, ethSrc: lc(ethSrc), ethDst: lc(ethDst), ttl, frame: f }];
  // A capture file is in arrival order, even when the model generates a later frame first (ARP retries).
  if (rows.length > 1 && rows[rows.length - 2].t > t) rows.sort((a, b) => a.t - b.t);
  s.caps[pt] = rows.slice(-400);
}
/** R1 ge-0/0/0 egress: the shaper (when configured) tail-drops 1 of every DROP_EVERY frames offered. */
function r1EgressLan(s: PaState): boolean {
  if (!s.cfg.R1.shape) return true;
  const k = s.shapeOffered++;
  if (k % DROP_EVERY === 0) {
    cnt(s, "R1:ge-0/0/0", "drops");
    return false;
  }
  return true;
}
function addFrame(c: Ctx, f: Omit<Frame, "n" | "text"> & { text?: string }): Frame {
  const fr = { ...f, n: c.s.frames.length + c.frames.length + 1, text: f.text ?? "" } as Frame;
  c.frames.push(fr);
  return fr;
}
/** CLIENT → SERVER for an IPv4 frame; returns the arrival time at SERVER (or undefined). */
function c2s(c: Ctx, f: Frame): number | undefined {
  const s = c.s;
  let t = f.t;
  cnt(s, "CLIENT:eth0", "out");
  cap(s, "client", t, f, "Out", MAC.CLIENT, MAC.R1_LAN, INITIAL_TTL);
  t += HOP.cSw;
  cnt(s, "SW1:ge-0/0/1", "in");
  cap(s, "span", t, f, "In", MAC.CLIENT, MAC.R1_LAN, INITIAL_TTL);
  cnt(s, "SW1:ge-0/0/24", "out");
  t += HOP.swR;
  cnt(s, "R1:ge-0/0/0", "in");
  cap(s, "r1-0", t, f, "In", MAC.CLIENT, MAC.R1_LAN, INITIAL_TTL);
  t += HOP.rFwd;
  cnt(s, "R1:ge-0/0/1", "out");
  cap(s, "r1-1", t, f, "Out", MAC.R1_SRV, MAC.SERVER, INITIAL_TTL - 1);
  t += HOP.rS;
  cnt(s, "SERVER:eth0", "in");
  cap(s, "server", t, f, "In", MAC.R1_SRV, MAC.SERVER, INITIAL_TTL - 1);
  return t;
}
/** SERVER → CLIENT; returns the arrival time at CLIENT, or undefined if it was lost (and where). */
function s2c(c: Ctx, f: Frame): number | undefined {
  const s = c.s;
  let t = f.t;
  cnt(s, "SERVER:eth0", "out");
  cap(s, "server", t, f, "Out", MAC.SERVER, MAC.R1_SRV, INITIAL_TTL);
  t += HOP.rS;
  cnt(s, "R1:ge-0/0/1", "in");
  cap(s, "r1-1", t, f, "In", MAC.SERVER, MAC.R1_SRV, INITIAL_TTL);
  t += HOP.rFwd;
  if (!r1EgressLan(s)) {
    f.lostAt = "R1 ge-0/0/0 egress queue (shaper tail drop)";
    return undefined;
  }
  cnt(s, "R1:ge-0/0/0", "out");
  cap(s, "r1-0", t, f, "Out", MAC.R1_LAN, MAC.CLIENT, INITIAL_TTL - 1);
  t += HOP.swR;
  cnt(s, "SW1:ge-0/0/24", "in");
  cnt(s, "SW1:ge-0/0/1", "out");
  cap(s, "span", t, f, "Out", MAC.R1_LAN, MAC.CLIENT, INITIAL_TTL - 1);
  t += HOP.cSw;
  cnt(s, "CLIENT:eth0", "in");
  cap(s, "client", t, f, "In", MAC.R1_LAN, MAC.CLIENT, INITIAL_TTL - 1);
  return t;
}
export const tcpText = (f: { src: string; dst: string; sport?: number; dport?: number; flags?: string; seq?: number; ack?: number; len: number; isn?: number; peerIsn?: number }, mss: boolean, rel = false) => {
  const fl = f.flags!;
  // Relative numbering (tcpdump's default): the handshake segments keep absolute values, later ones count from the ISNs.
  const handshake = fl === "S" || fl === "S." || fl === "R.";
  const sq = rel && !handshake && f.isn !== undefined ? f.seq! - f.isn : f.seq!;
  const ak = rel && !handshake && f.peerIsn !== undefined ? f.ack! - f.peerIsn : f.ack!;
  const seqTxt = fl === "." ? (f.len ? `seq ${sq}:${sq + f.len}, ` : "") : f.len ? `seq ${sq}:${sq + f.len}, ` : `seq ${sq}, `;
  const ackTxt = fl === "S" ? "" : `ack ${ak}, `;
  const win = fl === "R." ? "win 0" : fl === "S" ? "win 64240" : fl === "S." ? "win 65160" : "win 502";
  const opts = mss ? ", options [mss 1460,sackOK,TS val 1 ecr 0,nop,wscale 7]" : "";
  return `${f.src}.${f.sport} > ${f.dst}.${f.dport}: Flags [${fl}], ${seqTxt}${ackTxt}${win}${opts}, length ${f.len}`;
};
/** SERVER needs to send toward CLIENT: resolve its next hop (the configured default gateway). */
function serverNextHop(c: Ctx, t: number): boolean {
  const s = c.s;
  if (s.hosts.gw === GOOD_GW) return true;
  // ARP for the wrong gateway: three requests, 1 s apart; nobody owns that address, so no reply.
  // While a resolution is in progress (INCOMPLETE), later packets queue behind it and trigger no new requests.
  if (s.srvArpUntil !== undefined && t < s.srvArpUntil) {
    s.serverArpFailed = true;
    return false;
  }
  s.srvArpUntil = t + 3;
  for (let k = 0; k < 3; k++) {
    const f = addFrame(c, { t: t + k, dir: "srv", kind: "arp-req", src: PA.server, dst: s.hosts.gw, len: 28, text: `Request who-has ${s.hosts.gw} tell ${PA.server}, length 28` });
    cnt(s, "SERVER:eth0", "out");
    cap(s, "server", f.t, f, "Out", MAC.SERVER, MAC.BCAST);
    cnt(s, "R1:ge-0/0/1", "in");
    cap(s, "r1-1", f.t + HOP.rS, f, "In", MAC.SERVER, MAC.BCAST);
    f.lostAt = `no host answers for ${s.hosts.gw}`;
  }
  s.serverArpFailed = true;
  return false;
}
function clientArp(c: Ctx, t: number): number {
  const s = c.s;
  if (s.hosts.clientArp) return t;
  for (let attempt = 0; attempt < 3; attempt++) {
    const ta = t + attempt;
    const rq = addFrame(c, { t: ta, dir: "c2s", kind: "arp-req", src: PA.client, dst: PA.gw, len: 28, text: `Request who-has ${PA.gw} tell ${PA.client}, length 28` });
    cnt(s, "CLIENT:eth0", "out");
    cap(s, "client", ta, rq, "Out", MAC.CLIENT, MAC.BCAST);
    cnt(s, "SW1:ge-0/0/1", "in");
    cap(s, "span", ta + HOP.cSw, rq, "In", MAC.CLIENT, MAC.BCAST);
    cnt(s, "SW1:ge-0/0/24", "out");
    cnt(s, "R1:ge-0/0/0", "in");
    cap(s, "r1-0", ta + HOP.cSw + HOP.swR, rq, "In", MAC.CLIENT, MAC.BCAST);
    const rp = addFrame(c, { t: ta + HOP.cSw + HOP.swR + HOP.rFwd, dir: "s2c", kind: "arp-rep", src: PA.gw, dst: PA.client, len: 28, text: `Reply ${PA.gw} is-at ${lc(MAC.R1_LAN)}, length 28` });
    if (!r1EgressLan(s)) {
      rp.lostAt = "R1 ge-0/0/0 egress queue (shaper tail drop)";
      continue;
    }
    cnt(s, "R1:ge-0/0/0", "out");
    cap(s, "r1-0", rp.t, rp, "Out", MAC.R1_LAN, MAC.CLIENT);
    cnt(s, "SW1:ge-0/0/24", "in");
    cnt(s, "SW1:ge-0/0/1", "out");
    cap(s, "span", rp.t + HOP.swR, rp, "Out", MAC.R1_LAN, MAC.CLIENT);
    cnt(s, "CLIENT:eth0", "in");
    cap(s, "client", rp.t + HOP.swR + HOP.cSw, rp, "In", MAC.R1_LAN, MAC.CLIENT);
    s.hosts.clientArp = true;
    return rp.t + HOP.swR + HOP.cSw + 50 * US;
  }
  return -1;
}

/** One TCP connection attempt from CLIENT; `curl` also exchanges a request and response. */
function connect(c: Ctx, kind: "nc" | "curl"): Omit<TestResult, "id" | "cfgSeq" | "kind" | "frames"> {
  const s = c.s;
  const k = s.conns++;
  const sport = 51000 + k;
  const isnC = 1000 * (k + 1);
  const isnS = 5000 + 1000 * k;
  const t0 = s.clock;
  const res = { conn: k, sport, t0, outcome: "timeout" as TestResult["outcome"], synRetx: 0, dataRetx: 0, spanSawReply: false, connect: undefined as number | undefined, total: undefined as number | undefined };
  const capSpanBefore = s.caps.span.length;
  const t = clientArp(c, t0);
  if (t < 0) {
    s.clientSock = { sport, state: "CLOSED" };
    return { ...res, outcome: "timeout" };
  }
  const tcp = (dir: "c2s" | "s2c", tt: number, flags: string, seq: number, ack: number, len: number, retx = false) => {
    const src = dir === "c2s" ? PA.client : PA.server;
    const dst = dir === "c2s" ? PA.server : PA.client;
    const sp = dir === "c2s" ? sport : SERVICE_PORT;
    const dp = dir === "c2s" ? SERVICE_PORT : sport;
    const f = addFrame(c, { t: tt, dir, kind: "tcp", src, dst, sport: sp, dport: dp, flags, seq, ack, len, conn: k, retx, isn: dir === "c2s" ? isnC : isnS, peerIsn: dir === "c2s" ? isnS : isnC, ipId: (dir === "c2s" ? 0x1a00 : 0x5b00) + c.frames.length + k * 64 });
    f.text = tcpText(f, flags === "S" || flags === "S.");
    return f;
  };
  // SYN attempts at 0, +1 s, +2 s (backoff) until the client gives up (nc -w 5).
  const synTimes = [0, 1, 3, 7].map((d) => t + d).filter((x) => x - t0 < NC_TIMEOUT_S);
  let established: number | undefined;
  let serverHalfOpen = false;
  for (let i = 0; i < synTimes.length && established === undefined; i++) {
    const syn = tcp("c2s", synTimes[i], "S", isnC, 0, 0, i > 0);
    if (i > 0) res.synRetx++;
    s.clientSock = { sport, state: "SYN-SENT" };
    const at = c2s(c, syn)!;
    if (s.hosts.drop443) {
      s.iptDropPkts++;
      syn.lostAt = "SERVER netfilter INPUT (iptables DROP tcp dpt:443)";
      continue;
    }
    if (!s.hosts.nginx) {
      if (!serverNextHop(c, at)) {
        syn.lostAt = undefined;
        continue;
      }
      const rst = tcp("s2c", at + 40 * US, "R.", 0, isnC + 1, 0);
      const back = s2c(c, rst);
      if (back !== undefined) {
        res.outcome = "refused";
        res.connect = back - t0;
        s.clientSock = { sport, state: "CLOSED" };
        res.spanSawReply = s.caps.span.slice(capSpanBefore).some((r) => r.frame === rst);
        return res;
      }
      continue;
    }
    serverHalfOpen = true;
    if (!serverNextHop(c, at)) {
      if (!s.synRecv.includes(sport)) s.synRecv = [...s.synRecv, sport];
      continue;
    }
    const sa = tcp("s2c", at + 50 * US, "S.", isnS, isnC + 1, 0, i > 0);
    const back = s2c(c, sa);
    if (back !== undefined) established = back;
  }
  if (established === undefined) {
    s.clientSock = { sport, state: "CLOSED" };
    void serverHalfOpen;
    return res;
  }
  s.synRecv = s.synRecv.filter((p) => p !== sport);
  res.connect = established - t0;
  res.spanSawReply = s.caps.span.slice(capSpanBefore).some((r) => r.frame.dir === "s2c" && r.frame.conn === k);
  let tc = established + 20 * US;
  c2s(c, tcp("c2s", tc, ".", isnC + 1, isnS + 1, 0));
  let cSeq = isnC + 1;
  let sSeq = isnS + 1;
  /** Server → client segment with retransmission after 200 ms until delivered (max 6 tries). */
  const deliver = (tt: number, flags: string, len: number): number => {
    for (let r = 0; r < 6; r++) {
      const seg = tcp("s2c", tt + r * 0.2, flags, sSeq, cSeq, len, r > 0);
      if (r > 0) res.dataRetx++;
      const back = s2c(c, seg);
      if (back !== undefined) return back;
    }
    return tt + 1.2;
  };
  if (kind === "curl") {
    const req = tcp("c2s", tc + 100 * US, "P.", cSeq, sSeq, REQ_LEN);
    const atS = c2s(c, req)!;
    cSeq += REQ_LEN;
    const got = deliver(atS + 400 * US, "P.", RESP_LEN);
    sSeq += RESP_LEN;
    tc = got + 30 * US;
    c2s(c, tcp("c2s", tc, ".", cSeq, sSeq, 0));
  }
  // Client closes: FIN, the server answers FIN,ACK, the client ACKs.
  const fin = tcp("c2s", tc + 50 * US, "F.", cSeq, sSeq, 0);
  const atF = c2s(c, fin)!;
  cSeq += 1;
  const gotFin = deliver(atF + 40 * US, "F.", 0);
  sSeq += 1;
  c2s(c, tcp("c2s", gotFin + 20 * US, ".", cSeq, sSeq, 0));
  s.clientSock = { sport, state: "TIME-WAIT" };
  res.outcome = "ok";
  res.total = gotFin + 20 * US - t0;
  return res;
}
function ping(c: Ctx, count: number) {
  const s = c.s;
  const t0 = s.clock;
  const t = clientArp(c, t0);
  let recv = 0;
  if (t < 0) return { t0, sent: count, recv: 0 };
  for (let q = 1; q <= count; q++) {
    const tq = t + (q - 1);
    const rq = addFrame(c, { t: tq, dir: "c2s", kind: "icmp", src: PA.client, dst: PA.server, len: 64, text: `${PA.client} > ${PA.server}: ICMP echo request, id 4242, seq ${q}, length 64`, ipId: 0x2a00 + q });
    const at = c2s(c, rq)!;
    if (!serverNextHop(c, at)) continue;
    const rp = addFrame(c, { t: at + 30 * US, dir: "s2c", kind: "icmp", src: PA.server, dst: PA.client, len: 64, text: `${PA.server} > ${PA.client}: ICMP echo reply, id 4242, seq ${q}, length 64`, ipId: 0x6a00 + q });
    if (s2c(c, rp) !== undefined) recv++;
  }
  void t;
  return { t0, sent: count, recv };
}

// ---------------------------------------------------------------------------------------------------------------
// State changes
// ---------------------------------------------------------------------------------------------------------------
const cl = (o: PaState): PaState => ({ ...spClone(o), runs: o.runs, last: o.last });
const tokColor = (f: Frame) => (f.lostAt ? "red" : f.kind.startsWith("arp") ? "amber" : f.flags === "R." ? "red" : f.retx ? "amber" : f.dir === "s2c" ? "violet" : "cyan");
const hopsOf = (f: Frame): { from: string; to: string }[] => {
  if (f.dir === "srv") return [{ from: "SERVER", to: "R1" }];
  // ARP stays on the client LAN: CLIENT's request reaches R1 (broadcast), R1's reply comes back.
  if (f.kind === "arp-req") return [{ from: "CLIENT", to: "SW1" }, { from: "SW1", to: "R1" }];
  if (f.kind === "arp-rep") return f.lostAt ? [] : [{ from: "R1", to: "SW1" }, { from: "SW1", to: "CLIENT" }];
  const path = f.dir === "c2s" ? ["CLIENT", "SW1", "R1", "SERVER"] : ["SERVER", "R1", "SW1", "CLIENT"];
  if (f.lostAt?.startsWith("R1")) return [{ from: "SERVER", to: "R1" }];
  if (f.lostAt?.startsWith("SERVER")) return path.slice(0, -1).map((x, i) => ({ from: x, to: path[i + 1] }));
  return path.slice(0, -1).map((x, i) => ({ from: x, to: path[i + 1] }));
};
/** Who sends a frame to whom, as the moment caption says it. */
const frameWho = (f: Frame) => (f.kind === "arp-req" ? `${f.dir === "srv" ? "SERVER" : "CLIENT"} → broadcast` : f.kind === "arp-rep" ? "R1 → CLIENT" : f.dir === "c2s" ? "CLIENT → SERVER" : f.dir === "s2c" ? "SERVER → CLIENT" : "SERVER");
export const frameLabel = (f: Frame) => (f.kind === "tcp" ? `${f.flags === "S" ? "SYN" : f.flags === "S." ? "SYN-ACK" : f.flags === "R." ? "RST" : f.flags === "F." ? "FIN" : f.flags === "P." ? `${f.len} B` : "ACK"}${f.retx ? " ⟲" : ""}` : f.kind === "icmp" ? (f.text.includes("request") ? "echo req" : "echo reply") : f.kind === "arp-req" ? `ARP who-has ${f.dst}` : "ARP reply");
function runTest(s0: PaState, kind: TestKind, count = 4): PaState {
  const s = cl(s0);
  s.clock = Math.max(s.clock, Math.ceil(s.clock / 10) * 10) + 10;
  const c: Ctx = { s, frames: [] };
  let res: TestResult;
  if (kind === "ping") {
    const p = ping(c, count);
    res = { id: s.tests.length + 1, kind, t0: p.t0, outcome: p.recv === p.sent ? "ok" : p.recv === 0 ? "timeout" : "partial", synRetx: 0, dataRetx: 0, pingSent: p.sent, pingRecv: p.recv, frames: [], cfgSeq: s.cfgSeq, spanSawReply: false };
  } else {
    const r = connect(c, kind);
    res = { ...r, id: s.tests.length + 1, kind, frames: [], cfgSeq: s.cfgSeq };
  }
  res.frames = c.frames.map((f) => f.n);
  s.frames = [...s.frames, ...c.frames].slice(-600);
  s.tests = [...s.tests, res].slice(-40);
  const last = c.frames.length ? Math.max(...c.frames.map((f) => f.t)) : s.clock;
  s.clock = Math.max(s.clock, last) + 1;
  const label = kind === "ping" ? `ping -c ${count} ${PA.server}` : kind === "nc" ? `nc -vz -w ${NC_TIMEOUT_S} ${PA.server} ${SERVICE_PORT}` : `curl https://${PA.server}/`;
  const snap: PaSnap = { frames: c.frames };
  const moments: SpMoment<PaSnap>[] = c.frames.map((f) => ({
    tokens: hopsOf(f).map((h) => ({ from: h.from, to: h.to, label: frameLabel(f), color: tokColor(f) })),
    lines: [{ text: `${(f.t - res.t0).toFixed(6)} s · ${frameWho(f)} · ${frameLabel(f)}${f.lostAt ? ` — lost: ${f.lostAt}` : ""}`, tone: f.lostAt ? "warn" : "info" }],
    snap,
  }));
  moments.push({ tokens: [], lines: [{ text: `${label}: ${outcomeText(res)}`, tone: res.outcome === "ok" ? "ok" : "bad" }], snap });
  const run: SpRun<PaSnap> = { id: s.runs.length + 1 + s.seq * 1000, cmd: label, kind: "test", moments, ok: res.outcome === "ok" };
  s.runs = [...s.runs, run];
  s.last = run;
  s.log = [...s.log, { seq: s.seq, t: s.clock, text: `${label}: ${outcomeText(res)}`, tone: res.outcome === "ok" ? "ok" : "warn" }];
  return s;
}
export function outcomeText(r: TestResult): string {
  if (r.kind === "ping") return `${r.pingRecv}/${r.pingSent} replies`;
  if (r.outcome === "refused") return "connection refused (RST)";
  if (r.outcome === "timeout") return `timed out after ${NC_TIMEOUT_S} s${r.synRetx ? ` (${r.synRetx} SYN retransmission${r.synRetx > 1 ? "s" : ""})` : ""}`;
  return `connected in ${fmtS(r.connect!)}${r.synRetx ? ` after ${r.synRetx} SYN retransmission${r.synRetx > 1 ? "s" : ""}` : ""}${r.dataRetx ? `, ${r.dataRetx} data retransmission${r.dataRetx > 1 ? "s" : ""}` : ""}`;
}
export const fmtS = (x: number) => (x >= 1 ? `${x.toFixed(3)} s` : `${(x * 1000).toFixed(3)} ms`);

// ---------------------------------------------------------------------------------------------------------------
// Tickets
// ---------------------------------------------------------------------------------------------------------------
export interface PaTicketDef {
  id: PaTicketId;
  title: string;
  report: string;
  reproLabel: string;
  repro: PaAction[];
  apply: (s: PaState) => void;
}
export const PA_TICKETS: PaTicketDef[] = [
  {
    id: "retdrop",
    title: "Sometimes it takes a second to connect",
    report: "“Opening the portal on 10.20.20.20 is usually instant, but every few attempts it hangs for about a second before it loads. Nothing is ever refused. Nobody changed the servers.”",
    reproLabel: "three connection tests",
    repro: [{ type: "nc" }, { type: "nc" }, { type: "nc" }],
    apply: (s) => {
      s.cfg.R1.shape = true;
      s.shapeOffered = 0;
      s.hosts.clientArp = true;
    },
  },
  {
    id: "closed",
    title: "The portal is down",
    report: "“Since this morning's patching the portal fails immediately — the browser says the connection was refused. The server answers pings.”",
    reproLabel: "connection test + ping",
    repro: [{ type: "nc" }, { type: "ping", count: 4 }],
    apply: (s) => {
      s.hosts.nginx = false;
      s.hosts.clientArp = true;
    },
  },
  {
    id: "hostfw",
    title: "The portal just spins",
    report: "“The portal page spins and then times out. Ping to 10.20.20.20 works fine. The server team says the web service is running.”",
    reproLabel: "connection test + ping",
    repro: [{ type: "nc" }, { type: "ping", count: 4 }],
    apply: (s) => {
      s.hosts.drop443 = true;
      s.hosts.clientArp = true;
    },
  },
  {
    id: "gateway",
    title: "Nothing reaches the server any more",
    report: "“After the server's network config was ‘cleaned up’, the portal times out and ping fails too. The server team swears the service is listening and the firewall is off.”",
    reproLabel: "connection test + ping",
    repro: [{ type: "nc" }, { type: "ping", count: 4 }],
    apply: (s) => {
      s.hosts.gw = BAD_GW;
      s.hosts.clientArp = true;
    },
  },
  {
    id: "spanrx",
    title: "The capture says the server never answers",
    report: "“A colleague captured on the client's switch port: every connection shows a SYN and never a SYN-ACK. He wants to open a case with the server vendor. Users haven't complained, though.”",
    reproLabel: "connection test",
    repro: [{ type: "nc" }],
    apply: (s) => {
      s.cfg.SW1.analyzer = { ingress: true, egress: false };
      s.hosts.clientArp = true;
    },
  },
];
export const paTicket = (id: string) => PA_TICKETS.find((t) => t.id === id)!;
export function paTicketState(id: PaTicketId, seq = 0): PaState {
  const s = createPaNet(seq);
  paTicket(id).apply(s);
  s.ticket = id;
  s.log = [...s.log, { seq, t: s.clock, text: `Ticket opened: ${paTicket(id).title}.`, tone: "warn" }];
  return s;
}

export function paApply(s0: PaState, a: PaAction): PaState {
  switch (a.type) {
    case "cfg": {
      const s = cl(s0);
      s.hist[a.dev] = [spClone(s0.cfg[a.dev]), ...s.hist[a.dev]].slice(0, 20);
      s.cfg[a.dev] = spClone(a.cfg);
      if (a.dev === "R1" && a.cfg.shape && !s0.cfg.R1.shape) s.shapeOffered = 0;
      s.cfgSeq += 1;
      s.clock += 1;
      s.sys = [...s.sys, { t: s.clock, dev: a.dev, text: "UI_COMMIT: User 'admin' requested 'commit' operation" }];
      s.log = [...s.log, { seq: s.seq, t: s.clock, text: `${a.dev}: ${a.text}`, tone: "info", dev: a.dev }];
      return s;
    }
    case "host": {
      const s = cl(s0);
      a.f(s.hosts);
      if (s.hosts.gw === GOOD_GW) s.serverArpFailed = false;
      s.cfgSeq += 1;
      s.clock += 1;
      s.sys = [...s.sys, { t: s.clock, dev: a.dev, text: a.text }];
      s.log = [...s.log, { seq: s.seq, t: s.clock, text: `${a.dev}: ${a.text}`, tone: "info", dev: a.dev }];
      return s;
    }
    case "set": {
      const s = cl(s0);
      for (const ch of a.changes) ch.f(s.cfg[ch.dev]);
      if (a.host) a.host(s.hosts);
      if (s.cfg.R1.shape && !s0.cfg.R1.shape) s.shapeOffered = 0;
      s.cfgSeq += 1;
      s.clock += 1;
      s.log = [...s.log, { seq: s.seq, t: s.clock, text: a.text, tone: "info" }];
      return s;
    }
    case "nc":
      return runTest(s0, "nc");
    case "curl":
      return runTest(s0, "curl");
    case "ping":
      return runTest(s0, "ping", a.count);
    case "clear-caps": {
      const s = cl(s0);
      s.caps = { client: [], span: [], "r1-0": [], "r1-1": [], server: [] };
      s.log = [...s.log, { seq: s.seq, t: s.clock, text: "All capture buffers cleared.", tone: "info" }];
      return s;
    }
    case "clear-stats": {
      const s = cl(s0);
      for (const i of IFACES) if ((i.dev === "R1" || i.dev === "SW1") && (!a.ifn || `${i.dev}:${a.ifn}` === i.key || a.ifn === i.key)) s.cleared[i.key] = { ...s.counters[i.key] };
      s.clearedOnce = true;
      s.log = [...s.log, { seq: s.seq, t: s.clock, text: `Interface statistics cleared${a.ifn ? ` on ${a.ifn}` : ""}.`, tone: "info" }];
      return s;
    }
    case "snapshot": {
      const s = cl(s0);
      s.snapshot = spClone(s.counters);
      s.log = [...s.log, { seq: s.seq, t: s.clock, text: "Counter snapshot taken.", tone: "info" }];
      return s;
    }
    case "flush-arp": {
      const s = cl(s0);
      s.hosts.clientArp = false;
      s.log = [...s.log, { seq: s.seq, t: s.clock, text: "CLIENT: ip neigh flush dev eth0", tone: "info", dev: "CLIENT" }];
      return s;
    }
    case "wipe-analyzer": {
      const s = cl(s0);
      s.hist.SW1 = [spClone(s.cfg.SW1), ...s.hist.SW1].slice(0, 20);
      s.cfg.SW1.analyzer = null;
      s.wiped = true;
      s.cfgSeq += 1;
      s.log = [...s.log, { seq: s.seq, t: s.clock, text: "SW1: the analyzer session CAP was deleted.", tone: "warn", dev: "SW1" }];
      return s;
    }
    case "ticket":
      return paTicketState(a.id, s0.seq + 1);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Reading the evidence
// ---------------------------------------------------------------------------------------------------------------
export const frameById = (s: PaState, n: number) => s.frames.find((f) => f.n === n);
export const lastTest = (s: PaState) => s.tests[s.tests.length - 1];
/** For the frames of a test: at which capture points each one appears. */
export function bracket(s: PaState, t: TestResult): { f: Frame; seen: Record<CapPt, boolean> }[] {
  return t.frames.map((n) => {
    const f = frameById(s, n)!;
    const seen = {} as Record<CapPt, boolean>;
    for (const p of CAP_PTS) seen[p.id] = s.caps[p.id].some((r) => r.n === n);
    return { f, seen };
  }).filter((x) => x.f);
}
export const ctr = (s: PaState, key: string): Counters => ({ in: s.counters[key].in - s.cleared[key].in, out: s.counters[key].out - s.cleared[key].out, drops: s.counters[key].drops - s.cleared[key].drops });

export const PA_CAUSES: { id: string; label: string }[] = [
  { id: "retdrop", label: "R1 drops frames on its client-facing egress (ge-0/0/0)" },
  { id: "closed", label: "Nothing is listening on SERVER TCP/443" },
  { id: "hostfw", label: "SERVER's host firewall silently drops TCP/443" },
  { id: "gateway", label: "SERVER's default gateway is wrong" },
  { id: "spanrx", label: "The SPAN session mirrors only one direction" },
  { id: "dns", label: "Name resolution fails" },
  { id: "mask", label: "CLIENT has the wrong subnet mask" },
  { id: "mtu", label: "An MTU mismatch drops large packets" },
];
export function paCauseFeedback(s: PaState, cause: string): { right: boolean; text: string } {
  const t = s.ticket as PaTicketId | undefined;
  const txt: Record<PaTicketId, string> = {
    retdrop: "Yes. The first SYN-ACK leaves SERVER and is captured arriving on R1 ge-0/0/1, but it is never transmitted on ge-0/0/0 — and R1's ge-0/0/0 output drops rise by exactly the number of missing frames. A class-of-service shaper on ge-0/0/0 tail-drops one in six frames; the client's retransmitted SYN gets a second SYN-ACK through, one second late.",
    closed: "Yes. SERVER answers every SYN at once with RST,ACK — the port is reachable, nothing listens on it. `ss -tln` on SERVER shows no :443 and nginx is inactive. Refusal is fast and explicit; loss would be silent and slow.",
    hostfw: "Yes. The SYN is in SERVER's own capture, yet SERVER never answers and no half-open socket appears: the packet is discarded before TCP sees it. iptables INPUT has a DROP for tcp dpt:443 whose packet counter rises with every SYN. Ping works because only TCP/443 is dropped.",
    gateway: "Yes. SERVER receives the SYN (and the echo requests), keeps a SYN-RECV socket, and then ARPs for 10.20.20.254 — three requests, no reply. Its default route points at an address nobody owns, so no answer is ever sent. R1 sees the ARP requests arriving on ge-0/0/1 but has no reason to answer them.",
    spanrx: "Yes. The connection works (nc succeeds, CLIENT's own capture shows the SYN-ACK), but the SPAN copy only contains frames CLIENT sent. SW1's analyzer mirrors ingress only, so the capture can never show a reply — the evidence was incomplete, not the network.",
  };
  if (cause === t) return { right: true, text: txt[t] };
  const no: Record<string, string> = {
    retdrop: s.cfg.R1.shape ? "R1 does drop frames on ge-0/0/0 — but is that what this ticket's evidence shows?" : "R1's ge-0/0/0 output drops are zero and every frame that arrives on ge-0/0/1 leaves on ge-0/0/0.",
    closed: s.hosts.nginx ? "nginx is running and SERVER listens on 0.0.0.0:443; a closed port would answer RST at once." : "Nothing listens on 443 — but check what the evidence for this ticket says.",
    hostfw: s.hosts.drop443 ? "There is a DROP rule — does the evidence for this ticket point there?" : "iptables INPUT has no DROP rule; its policy is ACCEPT.",
    gateway: s.hosts.gw === GOOD_GW ? `SERVER's default route is via ${GOOD_GW}, which answers ARP.` : "The gateway is wrong — but look at what this ticket's evidence shows.",
    spanrx: s.cfg.SW1.analyzer?.egress ? "SW1's analyzer mirrors both directions of ge-0/0/1." : "The mirror is ingress-only — but is that this ticket's problem?",
    dns: "No name lookup appears in any capture; the client connects to 10.20.20.20 directly.",
    mask: "CLIENT's 10.10.10.10/24 with gateway 10.10.10.1 is correct — its SYNs reach SERVER.",
    mtu: "The frames that go missing are small (a 0-byte SYN-ACK or a 64-byte echo); size is not the discriminator.",
  };
  return { right: false, text: no[cause] ?? "That doesn't match the evidence." };
}
export function paProofs(s: PaState): { label: string; ok: boolean; detail: string }[] {
  const t = s.ticket as PaTicketId | undefined;
  if (!t) return [];
  const fresh = s.tests.filter((x) => x.cfgSeq === s.cfgSeq);
  const okConn = fresh.some((x) => x.kind !== "ping" && x.outcome === "ok" && x.synRetx === 0);
  switch (t) {
    case "retdrop":
      return [
        { label: "No shaper on R1 ge-0/0/0", ok: !s.cfg.R1.shape, detail: "show class-of-service interface ge-0/0/0" },
        { label: "Three fresh connections, none with a SYN retransmission", ok: fresh.filter((x) => x.kind !== "ping" && x.outcome === "ok" && x.synRetx === 0 && x.dataRetx === 0).length >= 3, detail: "repeat the test after the fix" },
      ];
    case "closed":
      return [
        { label: "SERVER listens on TCP/443", ok: s.hosts.nginx, detail: "ss -tln on SERVER" },
        { label: "A fresh connection succeeds", ok: okConn, detail: "nc or curl after the fix" },
      ];
    case "hostfw":
      return [
        { label: "No DROP rule for TCP/443", ok: !s.hosts.drop443, detail: "iptables -L INPUT -n -v" },
        { label: "A fresh connection succeeds", ok: okConn, detail: "nc or curl after the fix" },
      ];
    case "gateway":
      return [
        { label: `SERVER's default route via ${GOOD_GW}`, ok: s.hosts.gw === GOOD_GW, detail: "ip route on SERVER" },
        { label: "A fresh connection succeeds", ok: okConn, detail: "nc or curl after the fix" },
        { label: "Fresh ping: 4/4", ok: fresh.some((x) => x.kind === "ping" && x.pingRecv === x.pingSent), detail: "ping after the fix" },
      ];
    case "spanrx":
      return [
        { label: "SW1 mirrors ge-0/0/1 in both directions", ok: !!s.cfg.SW1.analyzer?.ingress && !!s.cfg.SW1.analyzer?.egress, detail: "show forwarding-options analyzer" },
        { label: "A fresh SPAN capture shows the server's SYN-ACK", ok: fresh.some((x) => x.kind !== "ping" && x.outcome === "ok" && x.spanSawReply), detail: "connect again and read the SPAN capture" },
      ];
  }
}
export function paLadder(s: PaState): { k: string; title: string; text: string }[] {
  const t = [...s.tests].reverse().find((x) => x.cfgSeq === s.cfgSeq && x.outcome !== "ok") ?? lastTest(s);
  const b = t ? bracket(s, t) : [];
  const firstReply = b.find((x) => x.f.dir === "s2c" && x.f.kind === "tcp");
  const synAtServer = b.some((x) => x.f.flags === "S" && x.seen.server);
  const lostAt = b.find((x) => x.f.lostAt)?.f.lostAt;
  const r10 = ctr(s, "R1:ge-0/0/0");
  return [
    { k: "symptom", title: "What does the user see?", text: t ? `${t.kind === "ping" ? `ping ${PA.server}` : `TCP ${PA.server}:443`}: ${outcomeText(t)}.` : "Run a test first." },
    { k: "request", title: "Did the request reach SERVER?", text: !t ? "—" : t.kind === "ping" ? (b.some((x) => x.f.kind === "icmp" && x.f.text.includes("request") && x.seen.server) ? "yes — the echo requests are in SERVER's capture." : "no.") : synAtServer ? "yes — the SYN is in SERVER's own capture." : "no SYN in SERVER's capture." },
    { k: "answer", title: "Did SERVER answer?", text: !t ? "—" : firstReply ? `yes — ${frameLabel(firstReply.f)} left SERVER.` : b.some((x) => x.f.kind === "arp-req" && x.f.dir === "srv") ? `no answer — SERVER is ARPing for ${s.hosts.gw} instead.` : "no answer appears in SERVER's capture." },
    { k: "where", title: "Where does the answer disappear?", text: !t ? "—" : lostAt ? lostAt : firstReply ? (firstReply.seen.client ? "nowhere — it reached CLIENT." : "between the last capture that has it and the first that doesn't.") : "there is no answer to follow." },
    { k: "counters", title: "What do the counters say?", text: `R1 ge-0/0/0 output drops ${r10.drops}; iptables DROP packets ${s.iptDropPkts}.` },
    { k: "trust", title: "Is every capture complete?", text: s.cfg.SW1.analyzer ? (s.cfg.SW1.analyzer.ingress && s.cfg.SW1.analyzer.egress ? "SPAN mirrors both directions of ge-0/0/1." : `SPAN mirrors only ${s.cfg.SW1.analyzer.ingress ? "ingress (frames from CLIENT)" : "egress (frames to CLIENT)"} — its silence proves nothing.`) : "SW1 has no analyzer session — no SPAN capture." },
  ];
}

// ---------------------------------------------------------------------------------------------------------------
// tcpdump-style rendering
// ---------------------------------------------------------------------------------------------------------------
/** Wall-clock stamps for logs and service status (the PA clock is absolute: 36000 = 10:00:00 on Oct 11). */
export function paStamp(t: number) {
  const x = Math.floor(t);
  const hms = `${String(Math.floor(x / 3600) % 24).padStart(2, "0")}:${String(Math.floor(x / 60) % 60).padStart(2, "0")}:${String(x % 60).padStart(2, "0")}`;
  return { hms, junos: `Oct 11 ${hms}` };
}
/** Uptime-style age between two PA clock values, whole seconds. */
export const paAge = (now: number, since: number) => paStamp(Math.max(0, Math.floor(now) - Math.floor(since))).hms;
/** When the lab's links came up and nginx was started (09:00:03 / 09:00:05). */
export const PA_BOOT = { link: 9 * 3600 + 3, nginx: 9 * 3600 + 5 };
export const clockText = (t: number) => {
  const h = Math.floor(t / 3600) % 24;
  const m = Math.floor(t / 60) % 60;
  const sec = t - Math.floor(t / 60) * 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${sec.toFixed(6).padStart(9, "0")}`;
};
export function rowLine(r: CapRow, o: { e?: boolean; v?: boolean; dir?: boolean; rel?: boolean } = {}): string {
  const f = r.frame;
  const isArp = f.kind.startsWith("arp");
  const ethLen = isArp ? 42 : f.kind === "icmp" ? 98 : 54 + f.len + (f.flags === "S" || f.flags === "S." ? 20 : 12);
  const eth = o.e ? `${r.ethSrc} > ${r.ethDst}, ethertype ${isArp ? "ARP (0x0806)" : "IPv4 (0x0800)"}, length ${ethLen}: ` : "";
  const ipLen = ethLen - 14;
  const v = o.v && !isArp ? `(tos 0x0, ttl ${r.ttl}, id ${f.ipId ?? 0}, offset 0, flags [DF], proto ${f.kind === "tcp" ? "TCP (6)" : "ICMP (1)"}, length ${ipLen})\n    ` : "";
  const body = isArp ? `ARP, ${f.text}` : `IP ${v}${f.kind === "tcp" ? tcpText(f, f.flags === "S" || f.flags === "S.", !!o.rel) : f.text}`;
  return `${clockText(r.t)}${o.dir ? ` ${r.dirAt}` : ""} ${eth}${body}`;
}
/** A tiny pcap-filter: `host A`, `src|dst host A`, `port N`, `tcp`, `arp`, `icmp`, combined with `and` / `not`. */
export function pcapFilter(expr: string): ((r: CapRow) => boolean) | string {
  const toks = expr.trim().split(/\s+/).filter(Boolean);
  if (!toks.length) return () => true;
  const preds: ((r: CapRow) => boolean)[] = [];
  let i = 0;
  let neg = false;
  const ip = (x: string) => /^(\d{1,3}\.){3}\d{1,3}$/.test(x);
  while (i < toks.length) {
    const w = toks[i];
    let p: ((r: CapRow) => boolean) | undefined;
    if (w === "and" || w === "&&") {
      i++;
      continue;
    }
    if (w === "not" || w === "!") {
      neg = !neg;
      i++;
      continue;
    }
    if (w === "tcp") p = (r) => r.frame.kind === "tcp";
    else if (w === "arp") p = (r) => r.frame.kind.startsWith("arp");
    else if (w === "icmp") p = (r) => r.frame.kind === "icmp";
    else if (w === "host" && ip(toks[i + 1] ?? "")) {
      const a = toks[++i];
      p = (r) => r.frame.src === a || r.frame.dst === a;
    } else if ((w === "src" || w === "dst") && toks[i + 1] === "host" && ip(toks[i + 2] ?? "")) {
      const a = toks[i + 2];
      i += 2;
      p = w === "src" ? (r) => r.frame.src === a : (r) => r.frame.dst === a;
    } else if (w === "port" && /^\d+$/.test(toks[i + 1] ?? "")) {
      const n = +toks[++i];
      p = (r) => r.frame.sport === n || r.frame.dport === n;
    } else return `tcpdump: syntax error in filter expression: syntax error near '${w}'`;
    const q = p;
    const ng = neg;
    preds.push(ng ? (r) => !q(r) : q);
    neg = false;
    i++;
  }
  return (r) => preds.every((x) => x(r));
}
