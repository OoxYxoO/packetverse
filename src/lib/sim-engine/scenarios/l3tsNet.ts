import { spClone, type SpBase, type SpLine, type SpMoment, type SpRun, type SpTok } from "@/components/sp-lab/spKit";
import { ipToNum } from "./fundamentalsPackets";
import { INITIAL_TTL, L3, L3_MAC, inNet, networkOf } from "./troubleshootingLayer3";

/**
 * Layer 3 Troubleshooting lab — the guided lesson's network as a live model.
 *
 * CLIENT — SW1 — R1 ge-0/0/0 (10.10.10.1/24); R1 ge-0/0/1 192.0.2.0/31 — R2 ge-0/0/0 192.0.2.1/31; R2 ge-0/0/1
 * 10.20.20.1/24 — SERVER 10.20.20.20; R2 ge-0/0/2 10.10.20.1/24 — REMOTE-SERVER 10.10.20.20. Truth is configuration:
 * each host's addresses and default route, each router's interface addresses (and disable) and static routes.
 * Everything else is derived by walking packets exactly as the devices would: the sender's longest-prefix match picks
 * on-link or gateway, ARP is asked on the sender's segment and answered only by the owner of the address, routers
 * decrement TTL, look up the destination, and send ICMP errors (net unreachable, time exceeded) back toward the source —
 * which needs a route back too. Ping, traceroute, ARP caches and R1's “ARP requests not for me” counter all come from that
 * walk. Values match the guided lesson (10.10.10.10/24 vs /16, 10.10.20.20 vs 10.20.20.20, TTL 64).
 */

export type L3D = "CLIENT" | "SW1" | "R1" | "R2" | "SERVER" | "REMOTE";
export type L3R = "R1" | "R2";
export type L3H = "CLIENT" | "SERVER" | "REMOTE";
export const L3_HOSTS: L3H[] = ["CLIENT", "SERVER", "REMOTE"];
export const L3_RTRS: L3R[] = ["R1", "R2"];
export const DEV_LABEL: Record<L3D, string> = { CLIENT: "CLIENT", SW1: "SW1", R1: "R1", R2: "R2", SERVER: "SERVER", REMOTE: "REMOTE-SERVER" };
/** Broadcast segments: who is attached, on which interface. */
export const SEGMENTS: { id: string; members: { dev: L3D; ifn: string }[]; link: string[] }[] = [
  { id: "LAN", members: [{ dev: "CLIENT", ifn: "eth0" }, { dev: "R1", ifn: "ge-0/0/0" }], link: ["L-C-S", "L-S-R1"] },
  { id: "TRANSIT", members: [{ dev: "R1", ifn: "ge-0/0/1" }, { dev: "R2", ifn: "ge-0/0/0" }], link: ["L-R1-R2"] },
  { id: "SRV", members: [{ dev: "R2", ifn: "ge-0/0/1" }, { dev: "SERVER", ifn: "eth0" }], link: ["L-R2-S"] },
  { id: "REM", members: [{ dev: "R2", ifn: "ge-0/0/2" }, { dev: "REMOTE", ifn: "eth0" }], link: ["L-R2-RM"] },
];
export const segOf = (dev: L3D, ifn: string) => SEGMENTS.find((s) => s.members.some((m) => m.dev === dev && m.ifn === ifn))!;
export const MACS: Record<string, string> = { "CLIENT:eth0": L3_MAC.CLIENT, "R1:ge-0/0/0": L3_MAC.R1_LAN, "R1:ge-0/0/1": L3_MAC.R1_T, "R2:ge-0/0/0": L3_MAC.R2_T, "R2:ge-0/0/1": L3_MAC.R2_SRV, "R2:ge-0/0/2": L3_MAC.R2_REM, "SERVER:eth0": L3_MAC.SERVER, "REMOTE:eth0": L3_MAC.REMOTE };
export const RTR_IFS: Record<L3R, string[]> = { R1: ["ge-0/0/0", "ge-0/0/1"], R2: ["ge-0/0/0", "ge-0/0/1", "ge-0/0/2"] };

// ---------------------------------------------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------------------------------------------
export interface HostCfg {
  addrs: { ip: string; len: number }[];
  gw?: string;
}
export interface RIf {
  addr?: string;
  len?: number;
  disable?: boolean;
}
export interface RStatic {
  prefix: string;
  len: number;
  nh: string;
}
export interface RCfg {
  ifs: Record<string, RIf>;
  statics: RStatic[];
}
export function l3Healthy(): { hosts: Record<L3H, HostCfg>; rtrs: Record<L3R, RCfg> } {
  return {
    hosts: {
      CLIENT: { addrs: [{ ip: L3.client, len: 24 }], gw: L3.gw },
      SERVER: { addrs: [{ ip: L3.server, len: 24 }], gw: L3.r2Srv },
      REMOTE: { addrs: [{ ip: L3.remote, len: 24 }], gw: L3.r2Rem },
    },
    rtrs: {
      R1: { ifs: { "ge-0/0/0": { addr: L3.gw, len: 24 }, "ge-0/0/1": { addr: L3.r1T, len: 31 } }, statics: [{ prefix: "10.10.20.0", len: 24, nh: L3.r2T }, { prefix: "10.20.20.0", len: 24, nh: L3.r2T }] },
      R2: { ifs: { "ge-0/0/0": { addr: L3.r2T, len: 31 }, "ge-0/0/1": { addr: L3.r2Srv, len: 24 }, "ge-0/0/2": { addr: L3.r2Rem, len: 24 } }, statics: [{ prefix: "10.10.10.0", len: 24, nh: L3.r1T }, { prefix: "0.0.0.0", len: 0, nh: L3.r1T }] },
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Routing tables (derived)
// ---------------------------------------------------------------------------------------------------------------
export interface Route {
  prefix: string;
  len: number;
  kind: "Direct" | "Local" | "Static" | "kernel" | "default";
  ifn?: string;
  nh?: string;
}
const ifUp = (c: RCfg, ifn: string) => !c.ifs[ifn]?.disable;
/** A router's inet.0: Direct + Local for each up interface with an address, Static whose next hop is reachable. */
export function rtrRoutes(c: RCfg): Route[] {
  const out: Route[] = [];
  for (const [ifn, i] of Object.entries(c.ifs)) {
    if (!i.addr || i.len === undefined || !ifUp(c, ifn)) continue;
    out.push({ prefix: networkOf(i.addr, i.len), len: i.len, kind: "Direct", ifn });
    out.push({ prefix: i.addr, len: 32, kind: "Local", ifn });
  }
  const direct = out.filter((r) => r.kind === "Direct");
  for (const st of c.statics) {
    const via = direct.find((r) => inNet(st.nh, r.prefix, r.len));
    if (via) out.push({ prefix: st.prefix, len: st.len, kind: "Static", nh: st.nh, ifn: via.ifn });
  }
  return out.sort((a, b) => ipToNum(a.prefix) - ipToNum(b.prefix) || a.len - b.len);
}
export function hostRoutes(h: HostCfg): Route[] {
  const out: Route[] = h.addrs.map((a) => ({ prefix: networkOf(a.ip, a.len), len: a.len, kind: "kernel" as const, ifn: "eth0" }));
  if (h.gw && out.some((r) => inNet(h.gw!, r.prefix, r.len))) out.unshift({ prefix: "0.0.0.0", len: 0, kind: "default", nh: h.gw, ifn: "eth0" });
  return out;
}
export const lpm = (routes: Route[], dst: string) => routes.filter((r) => r.kind !== "Local" && (r.len === 0 || inNet(dst, r.prefix, r.len))).sort((a, b) => b.len - a.len)[0];
const devAddrs = (s: Pick<L3State, "hosts" | "rtrs">, dev: L3D): { ip: string; ifn: string }[] => {
  if (dev === "SW1") return [];
  if (dev === "R1" || dev === "R2")
    return Object.entries(s.rtrs[dev].ifs)
      .filter(([ifn, i]) => i.addr && ifUp(s.rtrs[dev], ifn))
      .map(([ifn, i]) => ({ ip: i.addr!, ifn }));
  return s.hosts[dev].addrs.map((a) => ({ ip: a.ip, ifn: "eth0" }));
};
export const ownerOf = (s: Pick<L3State, "hosts" | "rtrs">, ip: string): L3D | undefined => (["CLIENT", "R1", "R2", "SERVER", "REMOTE"] as L3D[]).find((d) => devAddrs(s, d).some((a) => a.ip === ip));
const primaryIp = (s: Pick<L3State, "hosts" | "rtrs">, dev: L3D, ifn: string) => devAddrs(s, dev).find((a) => a.ifn === ifn)?.ip ?? devAddrs(s, dev)[0]?.ip ?? "0.0.0.0";

// ---------------------------------------------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------------------------------------------
export interface ArpEntry {
  mac?: string;
  state: "REACHABLE" | "FAILED";
  ifn: string;
}
export interface L3Test {
  id: number;
  kind: "ping" | "trace";
  from: L3D;
  dst: string;
  sent: number;
  recv: number;
  /** What the sender printed instead of replies (Destination Host Unreachable, Net Unreachable, TTL exceeded…). */
  error?: string;
  errorFrom?: string;
  /** traceroute: hop addresses (undefined = no reply). */
  hops?: (string | undefined)[];
  reached?: boolean;
  t0: number;
  cfgSeq: number;
}
export interface L3Sys {
  t: number;
  dev: L3D;
  text: string;
}
export interface L3State extends SpBase {
  hosts: Record<L3H, HostCfg>;
  rtrs: Record<L3R, RCfg>;
  hist: Record<L3R, RCfg[]>;
  arp: Record<L3D, Record<string, ArpEntry>>;
  /** ARP requests each router received for addresses that aren't its own (Junos "requests not for me"). */
  arpNotForMe: Record<L3R, number>;
  arpRx: Record<L3R, number>;
  tests: L3Test[];
  sys: L3Sys[];
  /** SW1's MAC table (it is a plain switch). */
  sw1: Record<string, string>;
}
export type L3TicketId = "mask" | "gateway" | "noroute" | "return" | "loop";
export type L3Action =
  | { type: "cfg"; dev: L3R; cfg: RCfg; text: string }
  | { type: "host"; dev: L3H; cfg: HostCfg; text: string }
  | { type: "set"; text: string; f: (s: L3State) => void }
  | { type: "ping"; from: L3D; dst: string; count: number }
  | { type: "trace"; from: L3D; dst: string }
  | { type: "clear-arp"; dev: L3D }
  | { type: "ticket"; id: L3TicketId };

export function createL3Net(seq = 0): L3State {
  const h = l3Healthy();
  return {
    seq,
    cfgSeq: 0,
    clock: 0,
    runs: [],
    log: [{ seq, t: 0, text: "Healthy network: CLIENT 10.10.10.10/24 via R1 reaches SERVER (10.20.20.20) and REMOTE-SERVER (10.10.20.20) behind R2.", tone: "info" }],
    hosts: h.hosts,
    rtrs: h.rtrs,
    hist: { R1: [], R2: [] },
    arp: { CLIENT: {}, SW1: {}, R1: {}, R2: {}, SERVER: {}, REMOTE: {} },
    arpNotForMe: { R1: 0, R2: 0 },
    arpRx: { R1: 0, R2: 0 },
    tests: [],
    sys: [],
    sw1: {},
  };
}

// ---------------------------------------------------------------------------------------------------------------
// The walk
// ---------------------------------------------------------------------------------------------------------------
export interface WalkHop {
  from: L3D;
  to: L3D;
  label: string;
  kind: "arp" | "ip" | "icmp-err";
  drop?: string;
  ttl?: number;
}
const LINK_PATH: Record<string, L3D[]> = { LAN: ["CLIENT", "SW1", "R1"], TRANSIT: ["R1", "R2"], SRV: ["R2", "SERVER"], REM: ["R2", "REMOTE"] };
/** The physical hops between two members of a segment (CLIENT ↔ R1 crosses SW1). */
function segHops(seg: string, a: L3D, b: L3D): [L3D, L3D][] {
  const p = LINK_PATH[seg];
  const i = p.indexOf(a);
  const j = p.indexOf(b);
  const path = i <= j ? p.slice(i, j + 1) : p.slice(j, i + 1).reverse();
  return path.slice(0, -1).map((x, k) => [x, path[k + 1]]);
}
export const routesOf = (s: Pick<L3State, "hosts" | "rtrs">, dev: L3D): Route[] => (dev === "R1" || dev === "R2" ? rtrRoutes(s.rtrs[dev]) : dev === "SW1" ? [] : hostRoutes(s.hosts[dev]));
interface Deliver {
  ok: boolean;
  /** The device the packet reached (or where it died). */
  at: L3D;
  hops: WalkHop[];
  /** An ICMP error generated on the way (and whether it reached the source). */
  err?: { type: "net-unreach" | "ttl" | "host-unreach"; from: string; back: boolean };
  /** A local failure at the sender (no route, ARP failed on the first hop). */
  local?: string;
}
/** ARP on a segment: who answers for `ip`? Records caches and router counters. */
function arpResolve(s: L3State, dev: L3D, ifn: string, ip: string, hops: WalkHop[]): L3D | undefined {
  const seg = segOf(dev, ifn);
  const cached = s.arp[dev][ip];
  if (cached?.state === "REACHABLE") return SEGMENTS.find((x) => x.id === seg.id)!.members.find((m) => devAddrs(s, m.dev).some((a) => a.ip === ip && a.ifn === m.ifn))?.dev;
  let owner: L3D | undefined;
  for (const m of seg.members) {
    if (m.dev === dev) continue;
    if (m.dev === "R1" || m.dev === "R2") {
      s.arpRx[m.dev] += 1;
      if (!devAddrs(s, m.dev).some((a) => a.ip === ip && a.ifn === m.ifn)) s.arpNotForMe[m.dev] += 1;
    }
    if (devAddrs(s, m.dev).some((a) => a.ip === ip && a.ifn === m.ifn)) owner = m.dev;
  }
  for (const [a, b] of segHops(seg.id, dev, seg.members.find((m) => m.dev !== dev)!.dev)) hops.push({ from: a, to: b, label: `ARP who-has ${ip}`, kind: "arp", drop: owner ? undefined : b === seg.members.find((m) => m.dev !== dev)!.dev ? "nobody owns this address on the segment" : undefined });
  if (dev === "CLIENT" || owner === "CLIENT") s.sw1[MACS["CLIENT:eth0"]] = "ge-0/0/1";
  if (owner) {
    const oi = seg.members.find((m) => m.dev === owner)!.ifn;
    for (const [a, b] of segHops(seg.id, owner, dev)) hops.push({ from: a, to: b, label: "ARP reply", kind: "arp" });
    s.arp[dev][ip] = { mac: MACS[`${owner}:${oi}`], state: "REACHABLE", ifn };
    s.arp[owner][primaryIp(s, dev, ifn)] = { mac: MACS[`${dev}:${ifn}`], state: "REACHABLE", ifn: oi };
    if (seg.id === "LAN") {
      s.sw1[MACS["CLIENT:eth0"]] = "ge-0/0/1";
      s.sw1[MACS["R1:ge-0/0/0"]] = "ge-0/0/24";
    }
  } else s.arp[dev][ip] = { state: "FAILED", ifn };
  return owner;
}
/** Send one IPv4 packet from `from` (source address `src`) toward `dst`, hop by hop. */
function deliver(s: L3State, from: L3D, src: string, dst: string, ttl: number, label: string, depth = 0): Deliver {
  const hops: WalkHop[] = [];
  let at = from;
  let t = ttl;
  let first = true;
  // ICMP errors are sourced from the interface the packet arrived on (what traceroute shows).
  let inIf: string | undefined;
  for (let guard = 0; guard < 300; guard++) {
    if (at !== from && devAddrs(s, at).some((a) => a.ip === dst)) return { ok: true, at, hops };
    if (at !== from && (at === "R1" || at === "R2")) {
      if (t <= 1) {
        const me = primaryIp(s, at, inIf ?? lpm(routesOf(s, at), src)?.ifn ?? RTR_IFS[at][0]);
        const back = depth === 0 ? deliver(s, at, me, src, INITIAL_TTL, "TTL exceeded", depth + 1) : undefined;
        return { ok: false, at, hops: [...hops, ...(back?.hops ?? []).map((h) => ({ ...h, kind: "icmp-err" as const }))], err: { type: "ttl", from: me, back: !!back?.ok } };
      }
      t -= 1;
    }
    const r = lpm(routesOf(s, at), dst);
    if (!r) {
      if (at === from) return { ok: false, at, hops, local: "Network is unreachable" };
      // A router without a route answers with ICMP destination net unreachable.
      const me = primaryIp(s, at, inIf ?? lpm(routesOf(s, at), src)?.ifn ?? RTR_IFS[at as L3R][0]);
      const back = depth === 0 ? deliver(s, at, me, src, INITIAL_TTL, "Net unreachable", depth + 1) : undefined;
      return { ok: false, at, hops: [...hops, ...(back?.hops ?? []).map((h) => ({ ...h, kind: "icmp-err" as const }))], err: { type: "net-unreach", from: me, back: !!back?.ok } };
    }
    const nh = r.nh ?? dst;
    const ifn = r.ifn!;
    const next = arpResolve(s, at, ifn, nh, hops);
    if (!next) {
      if (at === from && first) return { ok: false, at, hops, local: "Destination Host Unreachable" };
      return { ok: false, at, hops: [...hops], err: { type: "host-unreach", from: primaryIp(s, at, ifn), back: false } };
    }
    for (const [a, b] of segHops(segOf(at, ifn).id, at, next)) hops.push({ from: a, to: b, label, kind: "ip", ttl: t });
    inIf = segOf(at, ifn).members.find((m) => m.dev === next)!.ifn;
    at = next;
    first = false;
  }
  return { ok: false, at, hops };
}

// ---------------------------------------------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------------------------------------------
const cl = (o: L3State): L3State => ({ ...spClone(o), runs: o.runs, last: o.last });
const tokens = (hops: WalkHop[], color: string): SpTok[] => hops.map((h, i) => ({ from: h.from, to: h.to, label: h.drop ? `✗ ${h.label}` : h.label, color: h.drop ? "red" : h.kind === "arp" ? "#fbbf24" : h.kind === "icmp-err" ? "#f87171" : color, stay: !!h.drop, delay: i * 200 }));
export const srcIpOf = (s: Pick<L3State, "hosts" | "rtrs">, from: L3D, dst: string) => {
  const r = lpm(routesOf(s, from), dst);
  return primaryIp(s, from, r?.ifn ?? "eth0");
};
function runPing(s0: L3State, from: L3D, dst: string, count: number): L3State {
  const s = cl(s0);
  const t0 = s.clock;
  const src = srcIpOf(s, from, dst);
  const req = deliver(s, from, src, dst, INITIAL_TTL, "echo request");
  const moments: SpMoment[] = [];
  const lines: SpLine[] = [];
  let recv = 0;
  let error: string | undefined;
  let errorFrom: string | undefined;
  let rep: Deliver | undefined;
  if (req.ok) {
    rep = deliver(s, req.at, dst, src, INITIAL_TTL, "echo reply");
    if (rep.ok) recv = count;
    else lines.push({ text: `The echo request reached ${DEV_LABEL[req.at]}, but its reply died at ${DEV_LABEL[rep.at]}${rep.err?.type === "net-unreach" ? " (no route back)" : rep.local ? ` (${rep.local})` : ""}.`, tone: "bad" });
  } else if (req.local) {
    error = req.local;
    errorFrom = src;
  } else if (req.err) {
    if (req.err.back) {
      error = req.err.type === "net-unreach" ? "Destination Net Unreachable" : req.err.type === "ttl" ? "Time to live exceeded" : "Destination Host Unreachable";
      errorFrom = req.err.from;
    }
  }
  moments.push({ tokens: tokens(req.hops.slice(0, 24), "#22d3ee"), lines: [{ text: `${DEV_LABEL[from]} (${src}) → ${dst}: ${req.ok ? `the echo request reaches ${DEV_LABEL[req.at]}` : req.local ? `${req.local} — nothing leaves ${DEV_LABEL[from]}` : req.err ? `${DEV_LABEL[req.at]} can't deliver it (${req.err.type === "net-unreach" ? "no route" : req.err.type === "ttl" ? "TTL expired" : "ARP failed"})${req.err.back ? ` and reports back from ${req.err.from}` : ""}` : `lost at ${DEV_LABEL[req.at]}`}.`, tone: req.ok ? "info" : "bad" }] });
  if (rep) moments.push({ tokens: tokens(rep.hops.slice(0, 24), "#a78bfa"), lines: [{ text: rep.ok ? `${DEV_LABEL[req.at]} replies; the reply reaches ${DEV_LABEL[from]}.` : `The reply from ${DEV_LABEL[req.at]} never reaches ${DEV_LABEL[from]}.`, tone: rep.ok ? "ok" : "bad" }, ...lines] });
  s.clock += count;
  const test: L3Test = { id: s.tests.length + 1, kind: "ping", from, dst, sent: count, recv, error, errorFrom, t0, cfgSeq: s.cfgSeq };
  s.tests = [...s.tests, test].slice(-40);
  const sum = `${DEV_LABEL[from]} ping ${dst}: ${recv}/${count}${error ? ` — ${error}${errorFrom ? ` (from ${errorFrom})` : ""}` : ""}`;
  moments.push({ tokens: [], lines: [{ text: sum, tone: recv === count ? "ok" : "bad" }] });
  const run: SpRun = { id: s.runs.length + 1 + s.seq * 1000, cmd: `ping ${dst}`, kind: "ping", moments, ok: recv === count };
  s.runs = [...s.runs, run];
  s.last = run;
  s.log = [...s.log, { seq: s.seq, t: s.clock, text: sum, tone: recv === count ? "ok" : "warn", dev: from }];
  return s;
}
function runTrace(s0: L3State, from: L3D, dst: string): L3State {
  const s = cl(s0);
  const t0 = s.clock;
  const src = srcIpOf(s, from, dst);
  const hopsOut: (string | undefined)[] = [];
  let reached = false;
  const allHops: WalkHop[] = [];
  let error: string | undefined;
  for (let ttl = 1; ttl <= 8; ttl++) {
    const d = deliver(s, from, src, dst, ttl, `probe TTL ${ttl}`);
    if (ttl === 1 || ttl === 2 || d.ok) allHops.push(...d.hops);
    if (d.local) {
      error = d.local;
      break;
    }
    if (d.ok) {
      const back = deliver(s, d.at, dst, src, INITIAL_TTL, "port unreachable");
      hopsOut.push(back.ok ? dst : undefined);
      reached = back.ok;
      // No reply comes back: traceroute keeps probing (up to its hop limit — 8 in this lab), printing * * *.
      if (reached) break;
      continue;
    }
    hopsOut.push(d.err?.back ? d.err.from : undefined);
    if (d.err?.type === "net-unreach" && d.err.back) {
      error = `!N from ${d.err.from}`;
      break;
    }
    if (d.err?.type === "host-unreach") {
      hopsOut.push(undefined);
      break;
    }
  }
  s.clock += 5;
  const test: L3Test = { id: s.tests.length + 1, kind: "trace", from, dst, sent: hopsOut.length, recv: hopsOut.filter(Boolean).length, hops: hopsOut, reached, error, t0, cfgSeq: s.cfgSeq };
  s.tests = [...s.tests, test].slice(-40);
  const sum = `${DEV_LABEL[from]} traceroute ${dst}: ${error && !hopsOut.length ? error : hopsOut.map((h, i) => `${i + 1} ${h ?? "*"}`).join(" · ")}${reached ? " (reached)" : ""}`;
  const run: SpRun = { id: s.runs.length + 1 + s.seq * 1000, cmd: `traceroute ${dst}`, kind: "trace", moments: [{ tokens: tokens(allHops.slice(0, 24), "#22d3ee"), lines: [{ text: sum, tone: reached ? "ok" : "bad" }] }], ok: reached };
  s.runs = [...s.runs, run];
  s.last = run;
  s.log = [...s.log, { seq: s.seq, t: s.clock, text: sum, tone: reached ? "ok" : "warn", dev: from }];
  return s;
}

// ---------------------------------------------------------------------------------------------------------------
// Tickets
// ---------------------------------------------------------------------------------------------------------------
export interface L3TicketDef {
  id: L3TicketId;
  title: string;
  report: string;
  reproLabel: string;
  repro: L3Action[];
  apply: (s: L3State) => void;
}
const pS: L3Action = { type: "ping", from: "CLIENT", dst: L3.server, count: 4 };
const pR: L3Action = { type: "ping", from: "CLIENT", dst: L3.remote, count: 4 };
export const L3_TICKETS: L3TicketDef[] = [
  {
    id: "mask",
    title: "REMOTE-SERVER unreachable, SERVER fine",
    report: "“Since CLIENT was re-installed, it can't reach REMOTE-SERVER (10.10.20.20). SERVER (10.20.20.20), behind the same router, works perfectly. Nothing changed on the routers.”",
    reproLabel: "ping SERVER + ping REMOTE-SERVER",
    repro: [pS, pR],
    apply: (s) => void (s.hosts.CLIENT.addrs = [{ ip: L3.client, len: 16 }]),
  },
  {
    id: "gateway",
    title: "CLIENT can't reach anything beyond its own LAN",
    report: "“CLIENT can't reach either server any more. A colleague ‘tidied up’ its network settings. Other machines on the same LAN can reach the servers.”",
    reproLabel: "ping SERVER + ping REMOTE-SERVER",
    repro: [pS, pR],
    apply: (s) => void (s.hosts.CLIENT.gw = "10.10.10.254"),
  },
  {
    id: "noroute",
    title: "SERVER unreachable — and the router says so",
    report: "“Nobody on the CLIENT LAN can reach SERVER since this morning's change on R1. REMOTE-SERVER works. CLIENT gets an error back immediately.”",
    reproLabel: "ping SERVER + ping REMOTE-SERVER",
    repro: [pS, pR],
    apply: (s) => void (s.rtrs.R1.statics = s.rtrs.R1.statics.filter((r) => r.prefix !== "10.20.20.0")),
  },
  {
    id: "return",
    title: "Pings vanish without an error",
    report: "“Since R2 was ‘cleaned up’, CLIENT can't reach either server — no error, the pings just time out. The server team says they see the requests arrive.”",
    reproLabel: "ping SERVER + traceroute SERVER",
    repro: [pS, { type: "trace", from: "CLIENT", dst: L3.server }],
    apply: (s) => void (s.rtrs.R2.statics = s.rtrs.R2.statics.filter((r) => r.prefix !== "10.10.10.0" && r.len !== 0)),
  },
  {
    id: "loop",
    title: "“Time to live exceeded” for REMOTE-SERVER",
    report: "“REMOTE-SERVER is unreachable since its switch port on R2 was re-cabled; CLIENT gets ‘Time to live exceeded’. SERVER is fine.”",
    reproLabel: "ping REMOTE-SERVER + traceroute",
    repro: [pR, { type: "trace", from: "CLIENT", dst: L3.remote }],
    apply: (s) => void (s.rtrs.R2.ifs["ge-0/0/2"] = { ...s.rtrs.R2.ifs["ge-0/0/2"], disable: true }),
  },
];
export const l3Ticket = (id: string) => L3_TICKETS.find((t) => t.id === id)!;
export function l3TicketState(id: L3TicketId, seq = 0): L3State {
  const s = createL3Net(seq);
  s.clock = 5;
  l3Ticket(id).apply(s);
  if (id === "loop") s.sys.push({ t: s.clock, dev: "R2", text: "mib2d[1650]: SNMP_TRAP_LINK_DOWN: ifIndex 518, ifAdminStatus down(2), ifOperStatus down(2), ifName ge-0/0/2" });
  s.clock = 10;
  s.ticket = id;
  s.log = [...s.log, { seq, t: s.clock, text: `Ticket opened: ${l3Ticket(id).title}.`, tone: "warn" }];
  return s;
}

// ---------------------------------------------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------------------------------------------
/** Configuration changes flush ARP entries that no longer make sense (the kernel/router does the same on address changes). */
const flushArp = (s: L3State) => {
  for (const d of Object.keys(s.arp) as L3D[]) s.arp[d] = Object.fromEntries(Object.entries(s.arp[d]).filter(([, e]) => e.state === "REACHABLE"));
};
export function l3Apply(s0: L3State, a: L3Action): L3State {
  switch (a.type) {
    case "cfg": {
      const s = cl(s0);
      s.hist[a.dev] = [spClone(s0.rtrs[a.dev]), ...s.hist[a.dev]].slice(0, 20);
      for (const ifn of RTR_IFS[a.dev]) {
        const was = !s0.rtrs[a.dev].ifs[ifn]?.disable;
        const is = !a.cfg.ifs[ifn]?.disable;
        if (was !== is) s.sys.push({ t: s.clock + 1, dev: a.dev, text: `mib2d[1650]: ${is ? "SNMP_TRAP_LINK_UP" : "SNMP_TRAP_LINK_DOWN"}: ifIndex ${516 + RTR_IFS[a.dev].indexOf(ifn)}, ifAdminStatus ${is ? "up(1)" : "down(2)"}, ifOperStatus ${is ? "up(1)" : "down(2)"}, ifName ${ifn}` });
      }
      s.rtrs[a.dev] = spClone(a.cfg);
      s.cfgSeq += 1;
      s.clock += 1;
      s.sys.push({ t: s.clock, dev: a.dev, text: "mgd[2211]: UI_COMMIT: User 'admin' requested 'commit' operation" });
      s.arp[a.dev] = {};
      flushArp(s);
      s.log = [...s.log, { seq: s.seq, t: s.clock, text: `${a.dev}: ${a.text}`, tone: "info", dev: a.dev }];
      return s;
    }
    case "host": {
      const s = cl(s0);
      s.hosts[a.dev] = spClone(a.cfg);
      s.cfgSeq += 1;
      s.clock += 1;
      s.arp[a.dev] = {};
      flushArp(s);
      s.log = [...s.log, { seq: s.seq, t: s.clock, text: `${DEV_LABEL[a.dev]}: ${a.text}`, tone: "info", dev: a.dev }];
      return s;
    }
    case "set": {
      const s = cl(s0);
      a.f(s);
      s.cfgSeq += 1;
      s.clock += 1;
      flushArp(s);
      s.log = [...s.log, { seq: s.seq, t: s.clock, text: a.text, tone: "info" }];
      return s;
    }
    case "ping":
      return runPing(s0, a.from, a.dst, a.count);
    case "trace":
      return runTrace(s0, a.from, a.dst);
    case "clear-arp": {
      const s = cl(s0);
      s.arp[a.dev] = {};
      s.log = [...s.log, { seq: s.seq, t: s.clock, text: `${DEV_LABEL[a.dev]}: ARP cache cleared.`, tone: "info", dev: a.dev }];
      return s;
    }
    case "ticket":
      return l3TicketState(a.id, s0.seq + 1);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------------------------------------------
export const lastTest = (s: L3State) => s.tests[s.tests.length - 1];
export function testText(t: L3Test): string {
  if (t.kind === "trace") return `traceroute ${t.dst}: ${t.error && !t.hops?.length ? t.error : (t.hops ?? []).map((h, i) => `${i + 1} ${h ?? "*"}`).join(" · ")}${t.error && t.hops?.length ? ` ${t.error}` : ""}${t.reached ? " — reached" : ""}`;
  return `ping ${t.dst}: ${t.recv}/${t.sent}${t.error ? ` — ${t.error}${t.errorFrom ? ` from ${t.errorFrom}` : ""}` : t.recv ? "" : " — no reply"}`;
}
export const testOk = (t: L3Test) => (t.kind === "ping" ? t.recv === t.sent : !!t.reached);
export const L3_CAUSES: { id: string; label: string }[] = [
  { id: "mask", label: "CLIENT's prefix length is wrong (/16 instead of /24)" },
  { id: "gateway", label: "CLIENT's default gateway is wrong" },
  { id: "noroute", label: "R1 has no route to 10.20.20.0/24" },
  { id: "return", label: "R2 has no route back to 10.10.10.0/24" },
  { id: "loop", label: "A routing loop between R1 and R2 for 10.10.20.0/24" },
  { id: "arp", label: "R1's ARP table is corrupt" },
  { id: "server", label: "The server's firewall drops ICMP" },
  { id: "dns", label: "Name resolution fails" },
];
export function l3CauseFeedback(s: L3State, cause: string): { right: boolean; text: string } {
  const t = s.ticket as L3TicketId | undefined;
  const c = s.hosts.CLIENT;
  const yes: Record<L3TicketId, string> = {
    mask: "Yes. CLIENT is 10.10.10.10/16: its connected route 10.10.0.0/16 also matches 10.10.20.20, and a /16 beats the default route — so CLIENT ARPs for 10.10.20.20 on its own LAN. Nobody there owns it (R1 counts the request as “not for me”), the ARP fails, no IPv4 packet is ever sent. 10.20.20.20 is outside 10.10.0.0/16 and still goes via the gateway.",
    gateway: "Yes. CLIENT's default route points at 10.10.10.254. Every off-subnet destination is sent to that next hop, CLIENT ARPs for it, nobody answers: Destination Host Unreachable from CLIENT itself. Hosts on the LAN, including R1 at 10.10.10.1, still answer.",
    noroute: "Yes. R1 has no route to 10.20.20.0/24 any more: it receives CLIENT's packet, finds no match in inet.0 and sends back ICMP destination net unreachable from 10.10.10.1 — an immediate, explicit error. 10.10.20.0/24 still has its static route.",
    return: "Yes. R2 delivers CLIENT's requests to SERVER, but has no route back to 10.10.10.0/24 (and no default): every reply dies at R2, silently. traceroute shows R1 at hop 1 and nothing after — R2 can't even send its time-exceeded message back.",
    loop: "Yes. R2 ge-0/0/2 is disabled, so its connected route to 10.10.20.0/24 is gone and R2's default route sends that traffic back to R1 — which sends it to R2 again. The packet bounces until its TTL runs out at R2, which reports Time to live exceeded from 192.0.2.1; traceroute shows R1, R2, R1, R2…",
  };
  if (cause === t) return { right: true, text: yes[t] };
  const r1 = rtrRoutes(s.rtrs.R1);
  const r2 = rtrRoutes(s.rtrs.R2);
  const no: Record<string, string> = {
    mask: c.addrs[0]?.len === 24 ? "CLIENT is 10.10.10.10/24 — its connected route is 10.10.10.0/24." : "CLIENT's prefix is wrong — but does this ticket's evidence point there?",
    gateway: c.gw === L3.gw ? "CLIENT's default route is via 10.10.10.1, which answers ARP." : "The gateway is wrong — but look at this ticket's evidence.",
    noroute: r1.some((r) => r.prefix === "10.20.20.0") ? "R1 has a static route to 10.20.20.0/24 via 192.0.2.1." : "R1 lacks that route — but is it this ticket?",
    return: r2.some((r) => r.prefix === "10.10.10.0" || r.len === 0) ? "R2 has a route back to 10.10.10.0/24." : "R2 can't route back — but look at this ticket's evidence.",
    loop: r2.some((r) => r.prefix === "10.10.20.0" && r.kind === "Direct") ? "R2 has 10.10.20.0/24 as a directly connected route — no loop." : "There is a loop — but is it this ticket?",
    arp: "R1's ARP entries are complete and correct (show arp no-resolve); the evidence points elsewhere.",
    server: "Other destinations behind the same router answer, and a firewall drop wouldn't produce this evidence (ARP failures, ICMP errors from routers, or replies dying at R2).",
    dns: "Every test uses IP addresses; no name is ever resolved.",
  };
  return { right: false, text: no[cause] ?? "That doesn't match the evidence." };
}
export function l3Proofs(s: L3State): { label: string; ok: boolean; detail: string }[] {
  const t = s.ticket as L3TicketId | undefined;
  if (!t) return [];
  const fresh = s.tests.filter((x) => x.cfgSeq === s.cfgSeq);
  const ping = (dst: string) => fresh.some((x) => x.kind === "ping" && x.from === "CLIENT" && x.dst === dst && x.recv === x.sent);
  const both = { label: "Fresh pings from CLIENT to SERVER and REMOTE-SERVER: all replies", ok: ping(L3.server) && ping(L3.remote), detail: "ping both after the fix" };
  switch (t) {
    case "mask":
      return [{ label: "CLIENT is 10.10.10.10/24 with its default route via 10.10.10.1", ok: s.hosts.CLIENT.addrs.length === 1 && s.hosts.CLIENT.addrs[0].len === 24 && hostRoutes(s.hosts.CLIENT).some((r) => r.kind === "default" && r.nh === L3.gw), detail: "ip addr · ip route" }, both];
    case "gateway":
      return [{ label: "CLIENT's default route is via 10.10.10.1", ok: hostRoutes(s.hosts.CLIENT).some((r) => r.kind === "default" && r.nh === L3.gw), detail: "ip route" }, both];
    case "noroute":
      return [{ label: "R1 has a route to 10.20.20.0/24", ok: rtrRoutes(s.rtrs.R1).some((r) => r.prefix === "10.20.20.0" && r.len === 24), detail: "show route 10.20.20.20 on R1" }, both];
    case "return":
      return [{ label: "R2 routes 10.10.10.0/24 back via R1", ok: !!lpm(rtrRoutes(s.rtrs.R2), L3.client)?.nh, detail: "show route 10.10.10.10 on R2" }, both];
    case "loop":
      return [{ label: "R2 has 10.10.20.0/24 directly connected (ge-0/0/2 up)", ok: rtrRoutes(s.rtrs.R2).some((r) => r.prefix === "10.10.20.0" && r.kind === "Direct"), detail: "show route 10.10.20.20 on R2" }, both];
  }
}
export function l3Ladder(s: L3State): { k: string; title: string; text: string }[] {
  const t = lastTest(s);
  const c = s.hosts.CLIENT;
  const look = (dst: string) => {
    const r = lpm(hostRoutes(c), dst);
    return r ? (r.kind === "default" ? `${dst} → via ${r.nh}` : `${dst} → on-link (${r.prefix}/${r.len})`) : `${dst} → no route`;
  };
  const fail = Object.entries(s.arp.CLIENT).filter(([, e]) => e.state === "FAILED").map(([ip]) => ip);
  const rt = (r: L3R, dst: string) => {
    const x = lpm(rtrRoutes(s.rtrs[r]), dst);
    return x ? `${x.prefix}/${x.len} ${x.nh ? `via ${x.nh}` : `direct ${x.ifn}`}` : "no route";
  };
  return [
    { k: "symptom", title: "What fails, and how — error or silence?", text: t ? testText(t) : "Run a ping first." },
    { k: "host", title: "What does CLIENT decide for each destination?", text: `${c.addrs.map((a) => `${a.ip}/${a.len}`).join(", ")} · ${look(L3.server)} · ${look(L3.remote)}` },
    { k: "arp", title: "Did ARP succeed for the next hop?", text: fail.length ? `FAILED: ${fail.join(", ")}` : "every resolution answered" },
    { k: "r1", title: "Does R1 have a route onward?", text: `10.20.20.20: ${rt("R1", L3.server)} · 10.10.20.20: ${rt("R1", L3.remote)}` },
    { k: "r2", title: "Does R2 deliver — and route back?", text: `10.10.20.20: ${rt("R2", L3.remote)} · back to 10.10.10.10: ${rt("R2", L3.client)}` },
    { k: "proof", title: "Fresh evidence after the change?", text: s.ticket ? `${l3Proofs(s).filter((p) => p.ok).length}/${l3Proofs(s).length} proofs met` : "open a ticket to prove a repair" },
  ];
}
