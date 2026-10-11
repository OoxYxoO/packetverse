/**
 * Firewall Lab network — the Stateful Firewall lesson's FW1, with a DMZ and more hosts:
 *
 *   CLIENT 10.10.10.10 ─┐                                            ┌─ WEB 203.0.113.80 (TCP 443, 80)
 *   LAB    10.10.10.200 ┴─ trust ge-0/0/0 10.10.10.1/24              │
 *                          FW1 ── untrust ge-0/0/1 198.51.100.2/30 ── ISP 198.51.100.1 · 203.0.113.1/24
 *   DMZ 172.16.0.10 ────── dmz   ge-0/0/2 172.16.0.1/24              └─ OUT 203.0.113.50 (an internet user)
 *   (TCP 443)
 *
 * The ISP routes only what it assigned to us — the /30 — and its own LAN. Our private networks are never routed on
 * the internet: anything leaving must carry a public source (source NAT), and anything coming in must be addressed
 * to our public address (destination NAT publishes the DMZ server's TCP/443 on 198.51.100.2).
 *
 * FW1 processes a packet in the order a stateful firewall does (Junos SRX flow; IOS zone-based firewall alike):
 *   1. ingress interface → zone      2. session lookup (either direction) → if found: translate back, forward
 *   3. no session: a TCP segment that isn't a SYN can't start one     4. destination NAT (untrust → our address)
 *   5. route lookup on the (translated) destination → egress zone      6. security policy, first match per zone
 *      pair, evaluated on the REAL destination; the implicit last rule denies      7. source NAT (to untrust)
 *   8. create the session · TTL − 1 · forward
 * Hosts answer TCP like real stacks: SYN → SYN-ACK when listening, RST when not; the client completes with an ACK.
 */

export type FwZone = "trust" | "untrust" | "dmz";
export type FwHost = "CLIENT" | "LAB" | "DMZ" | "WEB" | "OUT";
export type FwDev = FwHost | "FW1" | "ISP";
export const FW_HOSTS: FwHost[] = ["CLIENT", "LAB", "DMZ", "WEB", "OUT"];
export const FW_ZONES: FwZone[] = ["trust", "untrust", "dmz"];
export const isHost = (d: string): d is FwHost => (FW_HOSTS as string[]).includes(d);
export const HOST_IP: Record<FwHost, string> = { CLIENT: "10.10.10.10", LAB: "10.10.10.200", DMZ: "172.16.0.10", WEB: "203.0.113.80", OUT: "203.0.113.50" };
export const FW_IF: Record<FwZone, { ifn: string; ip: string; len: number; net: string }> = {
  trust: { ifn: "ge-0/0/0", ip: "10.10.10.1", len: 24, net: "10.10.10.0/24" },
  untrust: { ifn: "ge-0/0/1", ip: "198.51.100.2", len: 30, net: "198.51.100.0/30" },
  dmz: { ifn: "ge-0/0/2", ip: "172.16.0.1", len: 24, net: "172.16.0.0/24" },
};
export const PUBLIC = FW_IF.untrust.ip;
export const BAD_NAT = "198.51.100.99";
export const ISP_IP = { fw: "198.51.100.1", lan: "203.0.113.1" } as const;
export const HOST_ROLE: Record<FwHost, string> = { CLIENT: "office PC (trust)", LAB: "lab PC (trust)", DMZ: "public web server (dmz)", WEB: "internet web server", OUT: "internet user" };
export const LISTEN: Record<FwHost, number[]> = { CLIENT: [], LAB: [], DMZ: [443], WEB: [443, 80], OUT: [] };
export const ZONE_OF_HOST: Partial<Record<FwHost, FwZone>> = { CLIENT: "trust", LAB: "trust", DMZ: "dmz" };

export const ipNum = (ip: string) => ip.split(".").reduce((a, o) => a * 256 + Number(o), 0);
export const inPrefix = (ip: string, prefix: string) => {
  const [net, len] = prefix.split("/");
  const m = +len === 0 ? 0 : (0xffffffff << (32 - +len)) >>> 0;
  return ((ipNum(ip) & m) >>> 0) === ((ipNum(net) & m) >>> 0);
};
export const isIp = (s: string) => /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(s) && s.split(".").every((o) => Number(o) <= 255);

// ---------------------------------------------------------------------------------------------------------------
// Address book, applications, configuration
// ---------------------------------------------------------------------------------------------------------------
/** The lab's address-book objects (fixed): Junos address-book entries / IOS object-groups. */
export const OBJECTS: Record<string, string> = { CLIENTS: "10.10.10.0/24", "LAB-PCS": "10.10.10.128/25", "DMZ-NET": "172.16.0.0/24", "DMZ-WEB": "172.16.0.10/32", "WEB-SRV": "203.0.113.80/32", "FW-OUTSIDE": "198.51.100.2/32" };
export const OBJECT_NAMES = Object.keys(OBJECTS);
export type FwApp = "https" | "http" | "ssh" | "icmp" | "any";
export const APPS: FwApp[] = ["https", "http", "ssh", "icmp", "any"];
export const APP_PORT: Record<FwApp, number | undefined> = { https: 443, http: 80, ssh: 22, icmp: undefined, any: undefined };
export const appOfPort = (proto: "tcp" | "icmp", port?: number): FwApp => (proto === "icmp" ? "icmp" : port === 443 ? "https" : port === 80 ? "http" : port === 22 ? "ssh" : "any");
export interface FwRule {
  name: string;
  from: FwZone;
  to: FwZone;
  /** Address-book names or "any"; matches if any entry matches. */
  src: string[];
  dst: string[];
  app: FwApp;
  action: "permit" | "deny";
}
export type SnatMode = "interface" | "bad" | "off";
export interface FwCfg {
  rules: FwRule[];
  snat: { trust: SnatMode; dmz: SnatMode };
  /** Destination NAT: 198.51.100.2 TCP/443 → DMZ 172.16.0.10:443. */
  dnat: boolean;
  /** The DMZ server's default gateway. */
  dmzGw: string;
}
const rule = (name: string, from: FwZone, to: FwZone, src: string[], dst: string[], app: FwApp, action: "permit" | "deny" = "permit"): FwRule => ({ name, from, to, src, dst, app, action });
export function fwHealthy(): FwCfg {
  return {
    rules: [
      rule("ALLOW-PING", "trust", "untrust", ["CLIENTS"], ["any"], "icmp"),
      rule("BLOCK-LAB", "trust", "untrust", ["LAB-PCS"], ["any"], "any", "deny"),
      rule("ALLOW-WEB", "trust", "untrust", ["CLIENTS"], ["any"], "https"),
      rule("ALLOW-HTTP", "trust", "untrust", ["CLIENTS"], ["any"], "http"),
      rule("TRUST-DMZ", "trust", "dmz", ["CLIENTS"], ["DMZ-WEB"], "https"),
      rule("ALLOW-UPDATES", "dmz", "untrust", ["DMZ-WEB"], ["any"], "https"),
      rule("PUBLISH-WEB", "untrust", "dmz", ["any"], ["DMZ-WEB"], "https"),
    ],
    snat: { trust: "interface", dmz: "interface" },
    dnat: true,
    dmzGw: FW_IF.dmz.ip,
  };
}
export const fwClone = <T>(c: T): T => JSON.parse(JSON.stringify(c)) as T;
const objHas = (name: string, ip: string) => name === "any" || (OBJECTS[name] !== undefined && inPrefix(ip, OBJECTS[name]));
export const appMatches = (app: FwApp, proto: "tcp" | "icmp", port?: number) => app === "any" || (app === "icmp" ? proto === "icmp" : proto === "tcp" && APP_PORT[app] === port);
export interface PolicyHit {
  rule?: FwRule;
  index: number;
  action: "permit" | "deny";
  why: string;
}
/** First matching rule for this zone pair, or the implicit default deny. */
export function fwPolicy(cfg: FwCfg, from: FwZone, to: FwZone, src: string, dst: string, proto: "tcp" | "icmp", port?: number): PolicyHit {
  const list = cfg.rules.filter((r) => r.from === from && r.to === to);
  for (let i = 0; i < list.length; i++) {
    const r = list[i];
    if (r.src.some((o) => objHas(o, src)) && r.dst.some((o) => objHas(o, dst)) && appMatches(r.app, proto, port)) return { rule: r, index: i + 1, action: r.action, why: `rule ${i + 1} ${r.name} (${r.src.join(",")} → ${r.dst.join(",")} · ${r.app}) → ${r.action.toUpperCase()}` };
  }
  return { index: list.length + 1, action: "deny", why: list.length ? `no rule of ${from}→${to} matches → implicit default deny` : `no rules at all from ${from} to ${to} → implicit default deny` };
}
export const snatAddr = (m: SnatMode) => (m === "interface" ? PUBLIC : m === "bad" ? BAD_NAT : undefined);

// ---------------------------------------------------------------------------------------------------------------
// Packets, sessions, runs, state
// ---------------------------------------------------------------------------------------------------------------
export type TcpFlags = "SYN" | "SYN-ACK" | "ACK" | "RST";
export interface FwPkt {
  id: number;
  proto: "tcp" | "icmp";
  src: string;
  dst: string;
  sport: number;
  dport: number;
  flags?: TcpFlags;
  icmp?: "echo" | "reply";
  ttl: number;
}
export type SessState = "SYN_SENT" | "SYN_RECV" | "ESTABLISHED" | "CLOSED" | "ICMP";
export interface FwSession {
  id: number;
  proto: "tcp" | "icmp";
  from: FwZone;
  to: FwZone;
  rule: string;
  /** As the initiator sent it. */
  src: string;
  sport: number;
  dst: string;
  dport: number;
  /** After NAT: where the packet really went (DNAT) and the source it carried out (SNAT). */
  realDst: string;
  realDport: number;
  xsrc: string;
  xsport: number;
  state: SessState;
  pkts: number;
  created: number;
}
export interface FwHop {
  from: FwDev;
  to: FwDev;
  pkt: FwPkt;
}
export interface FwStage {
  k: "session" | "dnat" | "route" | "policy" | "snat" | "forward" | "drop" | "reverse";
  text: string;
  ok: boolean;
}
export interface FwDecision {
  dev: FwDev;
  pkt: FwPkt;
  ingress?: FwZone;
  stages: FwStage[];
  drop?: string;
}
export interface FwRx {
  dev: FwDev;
  pkt: FwPkt;
  ok: boolean;
  why: string;
}
export interface FwWave {
  k: number;
  hops: FwHop[];
  decisions: FwDecision[];
  rx: FwRx[];
}
export type FwSendKind = "connect" | "ping" | "stray";
export interface FwSend {
  from: FwHost;
  to: string;
  kind: FwSendKind;
  /** TCP destination port for connect / stray. */
  port?: number;
}
export interface FwResult {
  send: FwSend;
  ok: boolean;
  outcome: "established" | "refused" | "timeout" | "reply" | "no-reply" | "dropped";
  fail?: string;
  path: FwDev[];
  session?: number;
}
export interface FwRun {
  id: number;
  cmd: string;
  clock: number;
  waves: FwWave[];
  results: FwResult[];
  cfgSeq: number;
}
export interface FwCap {
  n: number;
  run: number;
  wave: number;
  point: string;
  dir: "in" | "out";
  pkt: FwPkt;
}
export interface FwLog {
  clock: number;
  kind: "create" | "deny" | "nosession" | "close";
  from?: FwZone;
  to?: FwZone;
  pkt: FwPkt;
  rule?: string;
  session?: number;
  text: string;
}
export interface FwLogLine {
  seq: number;
  text: string;
  tone: "info" | "ok" | "warn";
}
export type FwTicketId = "shadow" | "badnat" | "dnatpol" | "dmzgw" | "dmzsnat";
export interface FwNet {
  cfg: FwCfg;
  sessions: FwSession[];
  nextSession: number;
  natPort: number;
  hostPort: Record<FwHost, number>;
  hits: Record<string, number>;
  clock: number;
  captures: FwCap[];
  capN: number;
  fwlog: FwLog[];
  runs: FwRun[];
  last?: FwRun;
  seq: number;
  pktSeq: number;
  cfgSeq: number;
  log: FwLogLine[];
  ticket?: FwTicketId;
  /** Junos commit history, newest first: the configuration before each commit (rollback 1, 2…). */
  rb?: string[];
}
export function createFwNet(cfg: FwCfg = fwHealthy()): FwNet {
  return { cfg, sessions: [], nextSession: 3001, natPort: 40001, hostPort: { CLIENT: 51000, LAB: 52000, DMZ: 53000, WEB: 54000, OUT: 55000 }, hits: {}, clock: 36000, captures: [], capN: 0, fwlog: [], runs: [], seq: 0, pktSeq: 0, cfgSeq: 0, log: [] };
}
export const hitKey = (from: FwZone, to: FwZone, name?: string) => `${from}>${to}>${name ?? "default-deny"}`;
export const pktText = (p: FwPkt) => (p.proto === "icmp" ? `ICMP ${p.icmp} ${p.src} → ${p.dst}` : `TCP ${p.flags} ${p.src}:${p.sport} → ${p.dst}:${p.dport}`);
export const ownerOf = (ip: string): FwDev | undefined => (FW_HOSTS.find((h) => HOST_IP[h] === ip) as FwDev | undefined) ?? (Object.values(FW_IF).some((f) => f.ip === ip) ? "FW1" : ip === ISP_IP.fw || ip === ISP_IP.lan ? "ISP" : undefined);
export const zoneOfIp = (ip: string): FwZone | undefined => FW_ZONES.find((z) => inPrefix(ip, FW_IF[z].net)) ?? undefined;
/** FW1's route lookup: the three connected networks, default via the ISP. */
export function fwRoute(ip: string): { zone: FwZone; nh: string; text: string } {
  const z = (["trust", "dmz", "untrust"] as FwZone[]).find((x) => inPrefix(ip, FW_IF[x].net));
  if (z) return { zone: z, nh: ip, text: `${FW_IF[z].net} connected (${FW_IF[z].ifn}, zone ${z})` };
  return { zone: "untrust", nh: ISP_IP.fw, text: `0.0.0.0/0 via ${ISP_IP.fw} (${FW_IF.untrust.ifn}, zone untrust)` };
}

// ---------------------------------------------------------------------------------------------------------------
// The data plane
// ---------------------------------------------------------------------------------------------------------------
interface Work {
  s: FwNet;
  waves: FwWave[];
  captures: FwCap[];
  capN: number;
  runId: number;
  pktSeq: number;
  sessions: FwSession[];
  nextSession: number;
  natPort: number;
  hits: Record<string, number>;
  fwlog: FwLog[];
}
export const capPointOf = (dev: FwDev, zone?: FwZone) => (dev === "FW1" && zone ? `FW1 ${zone}` : dev);
function capture(w: Work, k: number, h: FwHop, outZone?: FwZone, inZone?: FwZone) {
  w.captures.push({ n: ++w.capN, run: w.runId, wave: k, point: capPointOf(h.from, outZone), dir: "out", pkt: h.pkt }, { n: ++w.capN, run: w.runId, wave: k, point: capPointOf(h.to, inZone), dir: "in", pkt: h.pkt });
}
const reverseOf = (x: FwSession, p: FwPkt) => p.proto === x.proto && p.src === x.realDst && p.sport === x.realDport && p.dst === x.xsrc && p.dport === x.xsport;
const forwardOf = (x: FwSession, p: FwPkt) => p.proto === x.proto && p.src === x.src && p.sport === x.sport && p.dst === x.dst && p.dport === x.dport;
/** FW1: one packet in, at most one packet out. */
function firewall(w: Work, p: FwPkt, ingress: FwZone, d: FwDecision): { out?: FwPkt; zone?: FwZone; self?: boolean } {
  const cfg = w.s.cfg;
  d.ingress = ingress;
  const st = (k: FwStage["k"], text: string, ok = true) => d.stages.push({ k, text, ok });
  const drop = (text: string, log?: Omit<FwLog, "clock" | "pkt" | "text">) => {
    d.drop = text;
    st("drop", text, false);
    if (log) w.fwlog.push({ clock: w.s.clock, pkt: p, text, ...log });
    return {};
  };
  // 2. Session lookup.
  const fwd = w.sessions.find((x) => x.state !== "CLOSED" && forwardOf(x, p));
  const rev = fwd ? undefined : w.sessions.find((x) => x.state !== "CLOSED" && reverseOf(x, p));
  const sess = fwd ?? rev;
  if (sess) {
    sess.pkts++;
    if (p.proto === "tcp") {
      if (p.flags === "RST") sess.state = "CLOSED";
      else if (rev && p.flags === "SYN-ACK" && sess.state === "SYN_SENT") sess.state = "SYN_RECV";
      else if (fwd && p.flags === "ACK" && sess.state === "SYN_RECV") sess.state = "ESTABLISHED";
    }
    if (sess.state === "CLOSED") w.fwlog.push({ clock: w.s.clock, kind: "close", pkt: p, session: sess.id, from: sess.from, to: sess.to, text: `session ${sess.id} closed by RST` });
    const out: FwPkt = fwd ? { ...p, dst: sess.realDst, dport: sess.realDport, src: sess.xsrc, sport: sess.xsport } : { ...p, src: sess.dst, sport: sess.dport, dst: sess.src, dport: sess.sport };
    st("session", `matches session ${sess.id} (${fwd ? "initiator → responder" : "reply"}, ${sess.state}) — no policy check needed`);
    if (out.src !== p.src || out.dst !== p.dst || out.sport !== p.sport || out.dport !== p.dport) st(fwd ? "snat" : "reverse", fwd ? `translated as the session says: ${p.src}:${p.sport} → ${out.src}:${out.sport}${out.dst !== p.dst ? `, ${p.dst} → ${out.dst}` : ""}` : `translated back: ${p.src}:${p.sport} → ${out.src}:${out.sport}, ${p.dst}:${p.dport} → ${out.dst}:${out.dport}`);
    const zone = fwRoute(out.dst).zone;
    st("forward", `route ${fwRoute(out.dst).text} · TTL ${p.ttl} → ${p.ttl - 1}`);
    return { out: { ...out, ttl: p.ttl - 1 }, zone };
  }
  st("session", "no session matches", true);
  // 3. Only a SYN (or an echo request) may create a session.
  if ((p.proto === "tcp" && p.flags !== "SYN") || (p.proto === "icmp" && p.icmp !== "echo")) return drop(`no session for this ${p.proto === "tcp" ? `TCP ${p.flags}` : "ICMP reply"} — only ${p.proto === "tcp" ? "a SYN" : "an echo request"} can start one: dropped`, { kind: "nosession", from: ingress });
  // 4. Destination NAT / traffic to FW1 itself.
  let dst = p.dst;
  const dport = p.dport;
  if (ingress === "untrust" && p.dst === PUBLIC && p.proto === "tcp" && p.dport === 443 && cfg.dnat) {
    dst = HOST_IP.DMZ;
    st("dnat", `destination NAT PUBLISH-WEB: ${PUBLIC}:443 → ${HOST_IP.DMZ}:443`);
  } else if (Object.values(FW_IF).some((f) => f.ip === p.dst)) {
    if (p.proto === "icmp" && ingress !== "untrust") {
      st("forward", `${p.dst} is FW1's own address — ping is allowed to FW1 from ${ingress}`);
      return { self: true };
    }
    return drop(`${p.dst} is FW1's own address and nothing publishes ${p.proto === "tcp" ? `TCP/${p.dport}` : "ping"} there from ${ingress}${ingress === "untrust" && p.dst === PUBLIC && p.dport === 443 ? " (destination NAT is off)" : ""} — dropped`, { kind: "deny", from: ingress, rule: "self" });
  } else if (ingress === "untrust" && zoneOfIp(p.dst) && zoneOfIp(p.dst) !== "untrust") {
    // Private addresses never arrive from the internet in this lab (the ISP doesn't route them); kept for safety.
  }
  // 5. Route lookup.
  const rt = fwRoute(dst);
  st("route", `route lookup ${dst}: ${rt.text}`);
  // 6. Policy.
  const pol = fwPolicy(cfg, ingress, rt.zone, p.src, dst, p.proto, p.proto === "tcp" ? dport : undefined);
  w.hits[hitKey(ingress, rt.zone, pol.rule?.name)] = (w.hits[hitKey(ingress, rt.zone, pol.rule?.name)] ?? 0) + 1;
  if (pol.action === "deny") {
    st("policy", `policy ${ingress} → ${rt.zone}: ${pol.why}`, false);
    return drop(`denied by ${pol.rule ? pol.rule.name : "the implicit default deny"} (${ingress} → ${rt.zone})`, { kind: "deny", from: ingress, to: rt.zone, rule: pol.rule?.name ?? "default-deny" });
  }
  st("policy", `policy ${ingress} → ${rt.zone}: ${pol.why}`);
  // 7. Source NAT.
  let xsrc = p.src;
  let xsport = p.sport;
  if (rt.zone === "untrust" && (ingress === "trust" || ingress === "dmz")) {
    const m = cfg.snat[ingress];
    const a = snatAddr(m);
    if (a) {
      xsrc = a;
      xsport = w.natPort++;
      st("snat", `source NAT ${ingress === "trust" ? "SNAT-TRUST" : "SNAT-DMZ"}: ${p.src}:${p.sport} → ${xsrc}:${xsport}${m === "bad" ? " (BAD-POOL)" : ""}`);
    } else st("snat", `no source NAT for ${ingress} → untrust: the packet leaves with its private source ${p.src}`, false);
  }
  // 8. Create the session.
  const s: FwSession = { id: w.nextSession++, proto: p.proto, from: ingress, to: rt.zone, rule: pol.rule!.name, src: p.src, sport: p.sport, dst: p.dst, dport: p.dport, realDst: dst, realDport: dport, xsrc, xsport, state: p.proto === "icmp" ? "ICMP" : "SYN_SENT", pkts: 1, created: w.s.clock };
  w.sessions.push(s);
  w.fwlog.push({ clock: w.s.clock, kind: "create", from: ingress, to: rt.zone, pkt: p, rule: s.rule, session: s.id, text: `session ${s.id} created by ${s.rule}` });
  st("forward", `session ${s.id} created · TTL ${p.ttl} → ${p.ttl - 1} · out ${FW_IF[rt.zone].ifn}`);
  return { out: { ...p, src: xsrc, sport: xsport, dst, dport, ttl: p.ttl - 1 }, zone: rt.zone };
}
/** Carry one packet hop by hop until it is delivered or dropped. */
function carry(w: Work, from: FwDev, p0: FwPkt, onDeliver: (dev: FwDev, p: FwPkt) => void): FwDev[] {
  const s = w.s;
  const path: FwDev[] = [from];
  let cur: FwDev = from;
  let p = p0;
  let inZone: FwZone | undefined;
  for (let guard = 0; guard < 12; guard++) {
    const k = w.waves.length;
    const wave: FwWave = { k, hops: [], decisions: [], rx: [] };
    w.waves.push(wave);
    let next: FwDev | undefined;
    let outZone: FwZone | undefined;
    let nextIn: FwZone | undefined;
    if (isHost(cur)) {
      if (cur !== from) {
        const mine = HOST_IP[cur] === p.dst;
        wave.rx.push({ dev: cur, pkt: p, ok: mine, why: mine ? `${cur}: for me` : `${cur}: not my address — ignored` });
        if (mine) onDeliver(cur, p);
        return path;
      }
      // Sending host: on-link or gateway.
      const zone = ZONE_OF_HOST[cur];
      if (zone) {
        const onLink = inPrefix(p.dst, FW_IF[zone].net);
        const gw = cur === "DMZ" ? s.cfg.dmzGw : FW_IF[zone].ip;
        const hopIp = onLink ? p.dst : gw;
        const owner = ownerOf(hopIp);
        const d: FwDecision = { dev: cur, pkt: p, stages: [] };
        wave.decisions.push(d);
        if (!owner || (owner !== "FW1" && !isHost(owner)) || (isHost(owner) && ZONE_OF_HOST[owner] !== zone)) {
          d.drop = `ARP for ${hopIp}: no answer — nobody owns that address on ${FW_IF[zone].net}`;
          d.stages.push({ k: "drop", text: d.drop, ok: false });
          return path;
        }
        d.stages.push({ k: "route", text: onLink ? `${p.dst} is on my subnet → direct` : `${p.dst} is off-link → default gateway ${gw}`, ok: true });
        next = owner;
        if (owner === "FW1") nextIn = zone;
      } else {
        // WEB / OUT behind the ISP.
        const d: FwDecision = { dev: cur, pkt: p, stages: [{ k: "route", text: inPrefix(p.dst, "203.0.113.0/24") ? `${p.dst} is on my subnet → direct` : `${p.dst} is off-link → default gateway ${ISP_IP.lan}`, ok: true }] };
        wave.decisions.push(d);
        next = inPrefix(p.dst, "203.0.113.0/24") ? (ownerOf(p.dst) as FwDev) : "ISP";
        if (!next) {
          d.drop = `ARP for ${p.dst}: no answer`;
          return path;
        }
      }
    } else if (cur === "ISP") {
      const d: FwDecision = { dev: "ISP", pkt: p, stages: [] };
      wave.decisions.push(d);
      if (p.dst === ISP_IP.fw || p.dst === ISP_IP.lan) {
        wave.rx.push({ dev: "ISP", pkt: p, ok: true, why: "ISP: my own address" });
        onDeliver("ISP", p);
        return path;
      }
      if (inPrefix(p.dst, "198.51.100.0/30")) {
        if (p.dst !== PUBLIC) {
          d.drop = `ARP for ${p.dst} on 198.51.100.0/30: no answer`;
          d.stages.push({ k: "drop", text: d.drop, ok: false });
          return path;
        }
        d.stages.push({ k: "route", text: `${p.dst}: 198.51.100.0/30 connected → FW1 · TTL ${p.ttl} → ${p.ttl - 1}`, ok: true });
        next = "FW1";
        nextIn = "untrust";
      } else if (inPrefix(p.dst, "203.0.113.0/24")) {
        const o = ownerOf(p.dst);
        if (!o || !isHost(o)) {
          d.drop = `ARP for ${p.dst} on 203.0.113.0/24: no answer`;
          d.stages.push({ k: "drop", text: d.drop, ok: false });
          return path;
        }
        d.stages.push({ k: "route", text: `${p.dst}: 203.0.113.0/24 connected · TTL ${p.ttl} → ${p.ttl - 1}`, ok: true });
        next = o;
      } else {
        d.drop = `no route to ${p.dst} — the ISP only routes 198.51.100.0/30 (assigned to us) and its own 203.0.113.0/24; ${/^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(p.dst) ? "private addresses are never routed on the internet" : "nobody announced that address"}`;
        d.stages.push({ k: "drop", text: d.drop, ok: false });
        return path;
      }
      p = { ...p, ttl: p.ttl - 1 };
    } else {
      // FW1.
      const d: FwDecision = { dev: "FW1", pkt: p, stages: [] };
      wave.decisions.push(d);
      // A packet FW1 itself originates (its ping replies) is only routed — the policy governs transit traffic.
      const r = cur === from && guard === 0 ? ((d.stages.push({ k: "route", text: `FW1 answers from itself: ${fwRoute(p.dst).text}`, ok: true }), { out: p, zone: fwRoute(p.dst).zone }) as ReturnType<typeof firewall>) : firewall(w, p, inZone!, d);
      if (r.self) {
        wave.rx.push({ dev: "FW1", pkt: p, ok: true, why: `FW1: ${p.dst} is my own address` });
        onDeliver("FW1", p);
        return path;
      }
      if (!r.out) return path;
      p = r.out;
      outZone = r.zone;
      const z = r.zone!;
      if (z === "untrust") next = "ISP";
      else {
        const o = ownerOf(p.dst);
        if (!o || !isHost(o) || ZONE_OF_HOST[o] !== z) {
          d.drop = `ARP for ${p.dst} on ${FW_IF[z].net}: no answer`;
          d.stages.push({ k: "drop", text: d.drop, ok: false });
          return path;
        }
        next = o;
      }
    }
    const h: FwHop = { from: cur, to: next!, pkt: p };
    wave.hops.push(h);
    capture(w, k, h, outZone, nextIn);
    path.push(next!);
    cur = next!;
    inZone = nextIn;
  }
  return path;
}
const hostOfIp = (ip: string) => FW_HOSTS.find((h) => HOST_IP[h] === ip);
function simulate(s0: FwNet, sends: FwSend[], cmd: string): FwNet {
  const s: FwNet = { ...s0, clock: s0.clock + 2, hostPort: { ...s0.hostPort } };
  const runId = s.runs.length + 1;
  const w: Work = { s, waves: [], captures: [...s.captures], capN: s.capN, runId, pktSeq: s.pktSeq, sessions: s.sessions.map((x) => ({ ...x })), nextSession: s.nextSession, natPort: s.natPort, hits: { ...s.hits }, fwlog: [...s.fwlog] };
  const results: FwResult[] = [];
  for (const x of sends) {
    const src = HOST_IP[x.from];
    const r: FwResult = { send: x, ok: false, outcome: "timeout", path: [] };
    results.push(r);
    const sport = s.hostPort[x.from]++;
    if (x.kind === "ping") {
      let got: FwDev | undefined;
      const req: FwPkt = { id: ++w.pktSeq, proto: "icmp", icmp: "echo", src, dst: x.to, sport, dport: sport, ttl: 64 };
      const before = w.sessions.length;
      r.path = carry(w, x.from, req, (dev) => (got = dev));
      if (w.sessions.length > before) r.session = w.sessions.at(-1)!.id;
      if (!got) {
        r.outcome = "no-reply";
        r.fail = lastDrop(w) ?? "the echo request was lost";
        continue;
      }
      const reqAt = w.waves.at(-1)!.rx.at(-1)!.pkt;
      let back = false;
      carry(w, got, { id: ++w.pktSeq, proto: "icmp", icmp: "reply", src: reqAt.dst, dst: reqAt.src, sport: reqAt.dport, dport: reqAt.sport, ttl: 64 }, (dev) => (back = dev === x.from));
      r.ok = back;
      r.outcome = back ? "reply" : "no-reply";
      if (!back) r.fail = `the reply was lost: ${lastDrop(w) ?? "never came back"}`;
      continue;
    }
    if (x.kind === "stray") {
      const p: FwPkt = { id: ++w.pktSeq, proto: "tcp", flags: "ACK", src, dst: x.to, sport, dport: x.port ?? 40001, ttl: 64 };
      r.path = carry(w, x.from, p, () => undefined);
      r.outcome = "dropped";
      r.ok = true;
      r.fail = lastDrop(w);
      continue;
    }
    // TCP connect: SYN → (SYN-ACK | RST) → ACK.
    const port = x.port ?? 443;
    let synAt: FwPkt | undefined;
    let server: FwDev | undefined;
    const before = w.sessions.length;
    r.path = carry(w, x.from, { id: ++w.pktSeq, proto: "tcp", flags: "SYN", src, dst: x.to, sport, dport: port, ttl: 64 }, (dev, p) => ((server = dev), (synAt = p)));
    if (w.sessions.length > before) r.session = w.sessions.at(-1)!.id;
    if (!server || !synAt) {
      r.fail = `the SYN never arrived: ${lastDrop(w) ?? "lost"}`;
      continue;
    }
    const srvHost = isHost(server) ? server : undefined;
    const listening = !!srvHost && LISTEN[srvHost].includes(synAt.dport);
    const replyFlags: TcpFlags = listening ? "SYN-ACK" : "RST";
    if (srvHost) w.waves.at(-1)!.rx.at(-1)!.why = `${srvHost}: SYN from ${synAt.src}:${synAt.sport} to port ${synAt.dport} → ${listening ? "listening → SYN-ACK" : "nothing listens → RST"}`;
    let back: FwPkt | undefined;
    carry(w, server, { id: ++w.pktSeq, proto: "tcp", flags: replyFlags, src: synAt.dst, dst: synAt.src, sport: synAt.dport, dport: synAt.sport, ttl: 64 }, (dev, p) => dev === x.from && (back = p));
    if (!back) {
      r.fail = `the ${replyFlags} never came back: ${lastDrop(w) ?? "lost"}`;
      continue;
    }
    if (replyFlags === "RST") {
      r.outcome = "refused";
      r.fail = `${srvHost ?? server} answered RST: nothing listens on TCP/${port}`;
      continue;
    }
    carry(w, x.from, { id: ++w.pktSeq, proto: "tcp", flags: "ACK", src, dst: x.to, sport, dport: port, ttl: 64 }, () => undefined);
    r.ok = true;
    r.outcome = "established";
  }
  void hostOfIp;
  const run: FwRun = { id: runId, cmd, clock: s.clock, waves: w.waves, results, cfgSeq: s.cfgSeq };
  const seq = s.seq + 1;
  const summary = results.map((x) => `${x.send.from} → ${x.send.to}${x.send.kind === "ping" ? " ping" : x.send.kind === "stray" ? ` stray ACK :${x.send.port ?? 40001}` : ` TCP/${x.send.port ?? 443}`}: ${x.outcome}${x.fail && x.outcome !== "dropped" ? ` — ${x.fail}` : ""}`).join(" · ");
  return { ...s, sessions: w.sessions.slice(-60), nextSession: w.nextSession, natPort: w.natPort, hits: w.hits, fwlog: w.fwlog.slice(-200), captures: w.captures.slice(-1500), capN: w.capN, runs: [...s.runs, run].slice(-40), last: run, seq, pktSeq: w.pktSeq, log: [...s.log, { seq, text: `${cmd}: ${summary}`, tone: results.every((x) => x.ok) ? "ok" : "warn" }] };
}
function lastDrop(w: Work): string | undefined {
  for (let i = w.waves.length - 1; i >= 0; i--) {
    const d = w.waves[i].decisions.find((x) => x.drop);
    if (d) return `${d.dev}: ${d.drop}`;
  }
  return undefined;
}

// ---------------------------------------------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------------------------------------------
export type FwAction = { type: "traffic"; sends: FwSend[]; cmd?: string } | { type: "cfg"; cfg: FwCfg; text: string; junosCommit?: boolean } | { type: "clear" } | { type: "ticket"; id: FwTicketId } | { type: "fresh" };
export const targetName = (ip: string) => {
  const h = FW_HOSTS.find((x) => HOST_IP[x] === ip);
  return h ?? (ip === PUBLIC ? "FW1's public address" : ip);
};
export const sendText = (x: FwSend) => (x.kind === "ping" ? `${x.from} pings ${x.to}` : x.kind === "stray" ? `${x.from} sends an unsolicited TCP ACK to ${x.to}:${x.port ?? 40001}` : `${x.from} opens TCP/${x.port ?? 443} to ${x.to}`);
export function fwApply(s: FwNet, a: FwAction): FwNet {
  switch (a.type) {
    case "traffic":
      return simulate(s, a.sends, a.cmd ?? a.sends.map(sendText).join(", then "));
    case "cfg": {
      const seq = s.seq + 1;
      return { ...s, cfg: a.cfg, seq, cfgSeq: s.cfgSeq + 1, log: [...s.log, { seq, text: a.text, tone: "info" }], ...(a.junosCommit ? { rb: [JSON.stringify(s.cfg), ...(s.rb ?? [])].slice(0, 49) } : {}) };
    }
    case "clear": {
      const seq = s.seq + 1;
      return { ...s, sessions: [], seq, log: [...s.log, { seq, text: "Session table cleared", tone: "info" }] };
    }
    case "ticket":
      return fwTicketState(a.id, s.seq + 1);
    case "fresh":
      return { ...createFwNet(), seq: s.seq + 1 };
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Tickets
// ---------------------------------------------------------------------------------------------------------------
export type FwCause = FwTicketId | "route" | "server" | "replyrule";
export const FW_CAUSES: { id: FwCause; label: string }[] = [
  { id: "route", label: "FW1 has no route toward the internet" },
  { id: "shadow", label: "A deny rule above the allow matches first" },
  { id: "replyrule", label: "Replies need their own inbound allow rule" },
  { id: "badnat", label: "Source NAT translates to an address the ISP doesn't route back to us" },
  { id: "dmzsnat", label: "Traffic leaves without source NAT (a private source on the internet)" },
  { id: "dnatpol", label: "The inbound rule names the public address instead of the server's real one" },
  { id: "dmzgw", label: "The server sends its replies to the wrong gateway" },
  { id: "server", label: "The server isn't listening on the port" },
];
export interface FwTicket {
  id: FwTicketId;
  title: string;
  report: string;
  repro: FwAction[];
  reproLabel: string;
  cause: FwCause;
  good: (s: FwNet, run: FwRun) => { ok: boolean; why: string };
}
const established = (run: FwRun) => {
  const r = run.results[0];
  return { ok: !!r && r.outcome === "established", why: r ? (r.outcome === "established" ? `established via ${r.path.join(" → ")}` : `${r.outcome}: ${r.fail}`) : "not run" };
};
export const FW_TICKETS: FwTicket[] = [
  {
    id: "shadow",
    title: "Nobody can browse since this morning",
    report: "“Since the change window nobody in the office can open HTTPS sites. Ping to the internet still works, so it's not the line. The change was meant to block the lab PCs only.”",
    repro: [{ type: "traffic", sends: [{ from: "CLIENT", to: HOST_IP.WEB, kind: "connect", port: 443 }] }],
    reproLabel: "CLIENT opens HTTPS to WEB",
    cause: "shadow",
    good: (_s, run) => established(run),
  },
  {
    id: "badnat",
    title: "HTTPS hangs — the logs say ALLOWED",
    report: "“The office can't reach any website: connections just hang. The firewall log shows every attempt allowed by ALLOW-WEB and a session created. Someone ‘tidied up’ the NAT config.”",
    repro: [{ type: "traffic", sends: [{ from: "CLIENT", to: HOST_IP.WEB, kind: "connect", port: 443 }] }],
    reproLabel: "CLIENT opens HTTPS to WEB",
    cause: "badnat",
    good: (_s, run) => established(run),
  },
  {
    id: "dnatpol",
    title: "Our website is unreachable from the internet",
    report: "“Customers can't reach our website (198.51.100.2, HTTPS). From the office, the server works fine on its real address. A new firewall rule for it was added yesterday.”",
    repro: [{ type: "traffic", sends: [{ from: "OUT", to: PUBLIC, kind: "connect", port: 443 }] }],
    reproLabel: "OUT opens HTTPS to 198.51.100.2",
    cause: "dnatpol",
    good: (_s, run) => established(run),
  },
  {
    id: "dmzgw",
    title: "Website down after the server rebuild",
    report: "“The DMZ web server was rebuilt last night. Since then customers' connections hang. The firewall shows their sessions created by PUBLISH-WEB — nothing denied.”",
    repro: [{ type: "traffic", sends: [{ from: "OUT", to: PUBLIC, kind: "connect", port: 443 }] }],
    reproLabel: "OUT opens HTTPS to 198.51.100.2",
    cause: "dmzgw",
    good: (_s, run) => established(run),
  },
  {
    id: "dmzsnat",
    title: "The DMZ server can't download updates",
    report: "“The web server in the DMZ can't reach the update site (203.0.113.80, HTTPS) — connections time out. The office browses fine. The firewall log shows ALLOW-UPDATES permitting it.”",
    repro: [{ type: "traffic", sends: [{ from: "DMZ", to: HOST_IP.WEB, kind: "connect", port: 443 }] }],
    reproLabel: "DMZ opens HTTPS to WEB",
    cause: "dmzsnat",
    good: (_s, run) => established(run),
  },
];
export const fwTicket = (id: FwTicketId) => FW_TICKETS.find((t) => t.id === id)!;
export function fwTicketState(id: FwTicketId, seq: number): FwNet {
  const cfg = fwHealthy();
  if (id === "shadow") cfg.rules.find((r) => r.name === "BLOCK-LAB")!.src = ["CLIENTS"];
  if (id === "badnat") cfg.snat.trust = "bad";
  if (id === "dnatpol") cfg.rules.find((r) => r.name === "PUBLISH-WEB")!.dst = ["FW-OUTSIDE"];
  if (id === "dmzgw") cfg.dmzGw = "172.16.0.254";
  if (id === "dmzsnat") cfg.snat.dmz = "off";
  const s = createFwNet(cfg);
  return { ...s, seq, ticket: id, log: [{ seq, text: `Ticket opened: ${fwTicket(id).title}`, tone: "info" }] };
}
export function fwLastRepro(s: FwNet): FwRun | undefined {
  if (!s.ticket) return undefined;
  const want = (fwTicket(s.ticket).repro[0] as Extract<FwAction, { type: "traffic" }>).sends[0];
  return [...s.runs].reverse().find((r) => r.results.length === 1 && r.results[0].send.from === want.from && r.results[0].send.to === want.to && r.results[0].send.kind === want.kind && (r.results[0].send.port ?? 443) === (want.port ?? 443));
}
export interface FwProof {
  label: string;
  ok: boolean;
  detail: string;
}
export function fwProofs(s: FwNet): FwProof[] {
  if (!s.ticket) return [];
  const t = fwTicket(s.ticket);
  const run = fwLastRepro(s);
  const fresh = !!run && run.cfgSeq === s.cfgSeq;
  const g = run ? t.good(s, run) : undefined;
  const test: FwProof = { label: `A fresh test: ${t.reproLabel} — and it connects`, ok: !!g?.ok && fresh, detail: !run ? "not run yet" : !fresh ? "the configuration changed since the last test — run it again" : g!.why };
  const c = s.cfg;
  switch (s.ticket) {
    case "shadow": {
      const lab = fwPolicy(c, "trust", "untrust", HOST_IP.LAB, HOST_IP.WEB, "tcp", 443);
      return [{ label: "The lab PCs are still kept off the internet (the change's intent)", ok: lab.action === "deny", detail: `LAB → WEB HTTPS: ${lab.why}` }, test];
    }
    case "badnat":
      return [{ label: "Office traffic is translated to FW1's untrust address", ok: c.snat.trust === "interface", detail: `SNAT-TRUST → ${snatAddr(c.snat.trust) ?? "none"}` }, test];
    case "dnatpol": {
      const p = fwPolicy(c, "untrust", "dmz", HOST_IP.OUT, HOST_IP.DMZ, "tcp", 443);
      const wide = fwPolicy(c, "untrust", "dmz", HOST_IP.OUT, HOST_IP.DMZ, "tcp", 22);
      return [{ label: "Only HTTPS to the DMZ server is allowed in (nothing broader)", ok: p.action === "permit" && wide.action === "deny", detail: `HTTPS: ${p.why} · SSH: ${wide.why}` }, test];
    }
    case "dmzgw":
      return [{ label: "The DMZ server's gateway is FW1 (172.16.0.1)", ok: c.dmzGw === FW_IF.dmz.ip, detail: `default via ${c.dmzGw}` }, test];
    case "dmzsnat":
      return [{ label: "DMZ traffic to the internet is translated to FW1's untrust address", ok: c.snat.dmz === "interface", detail: `SNAT-DMZ → ${snatAddr(c.snat.dmz) ?? "none"}` }, test];
  }
}
export function fwCauseFeedback(s: FwNet, cause: FwCause): { right: boolean; consequence?: boolean; text: string } {
  const c = s.cfg;
  const t = s.ticket ? fwTicket(s.ticket) : undefined;
  const right = !!t && t.cause === cause;
  const lastSess = s.sessions.at(-1);
  const text: Record<FwCause, string> = {
    route: "FW1's default route via 198.51.100.1 is there (show route / show ip route): the SYN leaves through ge-0/0/1 toward the ISP.",
    shadow: right ? "Yes. BLOCK-LAB was meant for LAB-PCS (10.10.10.128/25), but its source is CLIENTS (10.10.10.0/24) — the whole office. Rules are evaluated top-down and the first match wins: ALLOW-PING sits above it (ping still works), ALLOW-WEB below it is never reached. The hit counters show BLOCK-LAB counting the office's HTTPS attempts." : `BLOCK-LAB matches ${c.rules.find((r) => r.name === "BLOCK-LAB")?.src.join(",") ?? "—"}: the office's traffic reaches ALLOW-WEB.`,
    replyrule: "No — a stateful firewall admits replies because they match the session the first packet created (in reverse). An inbound allow-any would only open the network to unsolicited traffic.",
    badnat: right ? `Yes. SNAT-TRUST translates the office to BAD-POOL ${BAD_NAT} instead of FW1's untrust address. The SYN goes out with source ${BAD_NAT}; WEB answers to ${BAD_NAT}; the ISP only routes 198.51.100.0/30 to us — ${BAD_NAT} is outside it, so the SYN-ACK is dropped at the ISP. Policy really did allow it: the session sits in SYN_SENT forever.` : `Office traffic is translated to ${snatAddr(c.snat.trust) ?? "nothing"}${c.snat.trust === "interface" ? " — FW1's own untrust address, which the ISP routes to us" : ""}.`,
    dmzsnat: right ? "Yes. SNAT-DMZ is missing: the DMZ server's SYN leaves with its private source 172.16.0.10. WEB answers to 172.16.0.10, and the ISP drops the SYN-ACK: private addresses are never routed on the internet. ALLOW-UPDATES did permit it — policy and NAT are separate steps." : `DMZ traffic leaves as ${snatAddr(c.snat.dmz) ?? "its private address"}.`,
    dnatpol: right ? "Yes. PUBLISH-WEB names FW-OUTSIDE (198.51.100.2) as its destination. Destination NAT happens BEFORE the policy lookup: by then the packet is addressed to the real server 172.16.0.10, so PUBLISH-WEB doesn't match and the implicit default deny drops it (untrust → dmz). Write inbound rules for the REAL address (DMZ-WEB) — on Junos and on the IOS zone-based firewall alike." : `PUBLISH-WEB names ${c.rules.find((r) => r.name === "PUBLISH-WEB")?.dst.join(",") ?? "—"} — the real address the policy sees after destination NAT.`,
    dmzgw: right ? `Yes. The rebuilt server's default gateway is ${c.dmzGw}, an address nobody owns on 172.16.0.0/24. The customer's SYN arrives (destination NAT and PUBLISH-WEB work — session ${lastSess?.id ?? ""} is created), the server answers, but its SYN-ACK goes to a gateway that never answers ARP. FW1 never sees the reply: the session stays SYN_SENT.` : `The DMZ server's gateway is ${c.dmzGw} — FW1's dmz interface.`,
    server: "The server does listen: a connection that reaches it gets a SYN-ACK (a closed port would answer RST — “connection refused”, not a hang).",
  };
  return { right, consequence: cause === "replyrule" ? false : undefined, text: text[cause] };
}
