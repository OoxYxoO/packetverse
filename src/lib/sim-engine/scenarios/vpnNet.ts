/**
 * VPN Lab network — the IPsec lesson's two sites, with an internet server to show what does NOT go through the
 * tunnel:
 *
 *   HOST-A 10.10.10.10 ─ GW-A ─ 198.51.100.10 ── INTERNET ── 203.0.113.10 ─ GW-B ─ HOST-B 10.20.20.20
 *   (Site A 10.10.10.0/24)        (198.51.100.1 · 203.0.113.1 · 192.0.2.1)        (Site B 10.20.20.0/24)
 *                                              │
 *                                        WEB 192.0.2.80
 *
 * The internet routes only public addresses: the gateways' WAN /30s… /24s and WEB's LAN. Site traffic can only cross
 * it inside ESP (IP protocol 50) between the gateways' public addresses.
 *
 * Everything about the tunnel is COMPUTED from both gateways' configuration as the result IKEv2 (RFC 7296) reaches
 * (GW-A initiates; both keep the tunnel up):
 *   1. IKE_SA_INIT — GW-A sends to its configured peer. No answer if that isn't GW-B, if GW-B has no gateway for
 *      GW-A's address, or if GW-B's internet link is down. Otherwise the IKE proposals must share a transform set,
 *      or GW-B answers NO_PROPOSAL_CHOSEN. Diffie-Hellman runs here; nobody is authenticated yet.
 *   2. IKE_AUTH — each side proves its identity with the pre-shared key; a different key → AUTHENTICATION_FAILED.
 *      The first CHILD SA is negotiated inside: GW-A proposes TSi = its local subnet, TSr = its remote subnet; GW-B
 *      accepts only if TSi is within its own remote subnet and TSr within its local one — else TS_UNACCEPTABLE
 *      (the IKE SA stays up).
 *   3. ESP — a CHILD SA is a pair of one-way SAs; each packet carries the SPI the RECEIVER chose and a per-SA
 *      sequence number (anti-replay). The inner packet is encrypted; the outer header carries the public addresses.
 * Steering: traffic for the remote site enters IPsec only if the gateway sends it there (Cisco: the crypto map is
 * applied on the WAN interface; Junos: a static route to st0.0). Otherwise it is routed to the internet in the clear
 * — after source NAT — where its private destination has no route.
 */

export type VpGw = "GW-A" | "GW-B";
export type VpHost = "HOST-A" | "HOST-B" | "WEB";
export type VpDev = VpGw | VpHost | "INTERNET";
export const VP_GWS: VpGw[] = ["GW-A", "GW-B"];
export const VP_HOSTS: VpHost[] = ["HOST-A", "HOST-B", "WEB"];
export const isGw = (d: string): d is VpGw => d === "GW-A" || d === "GW-B";
export const isHost = (d: string): d is VpHost => (VP_HOSTS as string[]).includes(d);
export const HOST_IP: Record<VpHost, string> = { "HOST-A": "10.10.10.10", "HOST-B": "10.20.20.20", WEB: "192.0.2.80" };
export const GW: Record<VpGw, { lan: string; lanNet: string; wan: string; wanNet: string; isp: string; host: VpHost }> = {
  "GW-A": { lan: "10.10.10.1", lanNet: "10.10.10.0/24", wan: "198.51.100.10", wanNet: "198.51.100.8/30", isp: "198.51.100.9", host: "HOST-A" },
  "GW-B": { lan: "10.20.20.1", lanNet: "10.20.20.0/24", wan: "203.0.113.10", wanNet: "203.0.113.8/30", isp: "203.0.113.9", host: "HOST-B" },
};
export const WEB_NET = "192.0.2.0/24";
export const INET_WEB = "192.0.2.1";
export const GW_OF: Record<VpHost, VpGw | undefined> = { "HOST-A": "GW-A", "HOST-B": "GW-B", WEB: undefined };
export const otherGw = (g: VpGw): VpGw => (g === "GW-A" ? "GW-B" : "GW-A");

export const ipNum = (ip: string) => ip.split(".").reduce((a, o) => a * 256 + Number(o), 0);
export const inPrefix = (ip: string, prefix: string) => {
  const [net, len] = prefix.split("/");
  const m = +len === 0 ? 0 : (0xffffffff << (32 - +len)) >>> 0;
  return ((ipNum(ip) & m) >>> 0) === ((ipNum(net) & m) >>> 0);
};
export const isIp = (s: string) => /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(s) && s.split(".").every((o) => Number(o) <= 255);
export const isCidr = (s: string) => /^\d+\.\d+\.\d+\.\d+\/\d{1,2}$/.test(s) && isIp(s.split("/")[0]) && +s.split("/")[1] <= 32;
export const cidrWithin = (inner: string, outer: string) => +inner.split("/")[1] >= +outer.split("/")[1] && inPrefix(inner.split("/")[0], outer);
const isPrivate = (ip: string) => /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(ip);

// ---------------------------------------------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------------------------------------------
export type IkeProp = "aes256-sha256-g19" | "aes128-sha1-g14";
export const IKE_PROPS: Record<IkeProp, { encr: string; prf: string; dh: string; cisco: string; junos: string }> = {
  "aes256-sha256-g19": { encr: "AES-GCM-256", prf: "PRF-HMAC-SHA256", dh: "DH group 19 (ECP-256)", cisco: "encryption aes-gcm-256 · prf sha256 · group 19", junos: "encryption-algorithm aes-256-gcm · dh-group group19" },
  "aes128-sha1-g14": { encr: "AES-CBC-128", prf: "PRF-HMAC-SHA1", dh: "DH group 14 (MODP-2048)", cisco: "encryption aes-cbc-128 · integrity sha1 · group 14", junos: "encryption-algorithm aes-128-cbc · authentication-algorithm sha1 · dh-group group14" },
};
export const PSKS = ["Lab-Key-2026", "Lab-Key-2025"] as const;
export interface VpGwCfg {
  peer: string;
  psk: string;
  ike: IkeProp;
  /** Traffic selectors (Cisco: the crypto ACL; Junos: traffic-selector local-ip / remote-ip). */
  local: string;
  remote: string;
  /** Traffic for the remote site is sent into IPsec (Cisco: crypto map on the WAN interface; Junos: route via st0.0). */
  steer: boolean;
}
export interface VpCfg {
  gw: Record<VpGw, VpGwCfg>;
  /** GW-B's internet link. */
  wanB: boolean;
}
export function vpHealthy(): VpCfg {
  return {
    gw: {
      "GW-A": { peer: GW["GW-B"].wan, psk: PSKS[0], ike: "aes256-sha256-g19", local: GW["GW-A"].lanNet, remote: GW["GW-B"].lanNet, steer: true },
      "GW-B": { peer: GW["GW-A"].wan, psk: PSKS[0], ike: "aes256-sha256-g19", local: GW["GW-B"].lanNet, remote: GW["GW-A"].lanNet, steer: true },
    },
    wanB: true,
  };
}
export const vpClone = <T>(c: T): T => JSON.parse(JSON.stringify(c)) as T;

// ---------------------------------------------------------------------------------------------------------------
// The tunnel — computed
// ---------------------------------------------------------------------------------------------------------------
export type IkeState = "ESTABLISHED" | "NO_RESPONSE" | "NO_PROPOSAL_CHOSEN" | "AUTHENTICATION_FAILED";
export type ChildState = "INSTALLED" | "TS_UNACCEPTABLE" | "NONE";
export interface VpTunnel {
  ike: IkeState;
  child: ChildState;
  /** Where negotiation stops, in words. */
  why?: string;
  /** Selectors agreed (when INSTALLED). */
  tsi?: string;
  tsr?: string;
}
export function vpTunnel(c: VpCfg): VpTunnel {
  const a = c.gw["GW-A"];
  const b = c.gw["GW-B"];
  if (!c.wanB) return { ike: "NO_RESPONSE", child: "NONE", why: "GW-B's internet link is down: IKE_SA_INIT gets no answer (DPD declares the peer dead)" };
  if (a.peer !== GW["GW-B"].wan) return { ike: "NO_RESPONSE", child: "NONE", why: `GW-A sends IKE_SA_INIT to ${a.peer} — nobody answers there (GW-B is ${GW["GW-B"].wan})` };
  if (b.peer !== GW["GW-A"].wan) return { ike: "NO_RESPONSE", child: "NONE", why: `GW-B has no IKE gateway for ${GW["GW-A"].wan} (it expects ${b.peer}): it ignores the request` };
  if (a.ike !== b.ike) return { ike: "NO_PROPOSAL_CHOSEN", child: "NONE", why: `IKE proposals don't overlap (GW-A ${IKE_PROPS[a.ike].encr}/${IKE_PROPS[a.ike].dh}, GW-B ${IKE_PROPS[b.ike].encr}/${IKE_PROPS[b.ike].dh}): GW-B answers NO_PROPOSAL_CHOSEN` };
  if (a.psk !== b.psk) return { ike: "AUTHENTICATION_FAILED", child: "NONE", why: "IKE_AUTH: GW-B can't verify GW-A's AUTH payload — the pre-shared keys differ: AUTHENTICATION_FAILED" };
  if (!cidrWithin(a.local, b.remote) || !cidrWithin(a.remote, b.local)) return { ike: "ESTABLISHED", child: "TS_UNACCEPTABLE", why: `CHILD SA: GW-A proposes ${a.local} ↔ ${a.remote}; GW-B allows ${b.remote} ↔ ${b.local}: TS_UNACCEPTABLE (the IKE SA stays up)` };
  return { ike: "ESTABLISHED", child: "INSTALLED", tsi: a.local, tsr: a.remote };
}
/** What the SAs depend on — steering (crypto map / st0 route) is not negotiated, so changing it keeps the SAs. */
const tunnelKey = (c: VpCfg) => JSON.stringify(vpTunnel(c)) + JSON.stringify(Object.values(c.gw).map((g) => [g.peer, g.psk, g.ike, g.local, g.remote]));

// ---------------------------------------------------------------------------------------------------------------
// Packets, runs, state
// ---------------------------------------------------------------------------------------------------------------
export interface VpInner {
  src: string;
  dst: string;
  icmp: "echo" | "reply";
  seq: number;
  ttl: number;
}
export interface VpPkt {
  id: number;
  kind: "icmp" | "esp" | "ike";
  src: string;
  dst: string;
  ttl: number;
  icmp?: "echo" | "reply";
  seq?: number;
  /** ESP: the SPI the receiver chose, the per-SA sequence number, the encrypted inner packet. */
  spi?: string;
  espSeq?: number;
  inner?: VpInner;
  /** IKE: exchange, message ID, request/response, what it carries. */
  ike?: { ex: "IKE_SA_INIT" | "IKE_AUTH"; msgId: number; resp: boolean; carries: string; notify?: string };
}
export interface VpHop {
  from: VpDev;
  to: VpDev;
  pkt: VpPkt;
}
export interface VpDecision {
  dev: VpDev;
  pkt: VpPkt;
  text: string;
  drop?: string;
}
export interface VpRx {
  dev: VpDev;
  pkt: VpPkt;
  ok: boolean;
  why: string;
}
export interface VpWave {
  k: number;
  hops: VpHop[];
  decisions: VpDecision[];
  rx: VpRx[];
}
export interface VpSend {
  from: VpHost;
  to: string;
}
export interface VpResult {
  send: VpSend;
  replied: boolean;
  fail?: string;
  path: VpDev[];
  backPath?: VpDev[];
  encrypted: boolean;
}
export interface VpRun {
  id: number;
  cmd: string;
  kind: "traffic" | "ike";
  clock: number;
  waves: VpWave[];
  results: VpResult[];
  cfgSeq: number;
}
export interface VpCap {
  n: number;
  run: number;
  wave: number;
  point: string;
  dir: "in" | "out";
  pkt: VpPkt;
}
export interface VpSa {
  /** Generation: changes whenever the tunnel is renegotiated. */
  gen: number;
  ab: string;
  ba: string;
  encaps: Record<VpGw, number>;
  decaps: Record<VpGw, number>;
  seq: Record<VpGw, number>;
}
export interface VpSyslog {
  clock: number;
  gw: VpGw;
  text: string;
  tone: "up" | "down" | "err";
}
export interface VpLogLine {
  seq: number;
  text: string;
  tone: "info" | "ok" | "warn";
}
export type VpTicketId = "psk" | "proposal" | "ts" | "steer" | "peer";
export interface VpNet {
  cfg: VpCfg;
  tunnel: VpTunnel;
  sa: VpSa;
  tkey: string;
  clock: number;
  captures: VpCap[];
  capN: number;
  syslog: VpSyslog[];
  runs: VpRun[];
  last?: VpRun;
  seq: number;
  pktSeq: number;
  cfgSeq: number;
  pingSeq: number;
  log: VpLogLine[];
  ticket?: VpTicketId;
  /** Junos commit history per gateway, newest first: the gateway configuration before each commit (rollback 1, 2…). */
  rb?: Partial<Record<VpGw, string[]>>;
}
const spiFor = (gen: number, dir: "ab" | "ba") => `0x${((dir === "ab" ? 0xa1b2c3d4 : 0xb1c2d3e4) + gen * 0x01010101).toString(16).slice(-8).padStart(8, "0")}`;
const freshSa = (gen: number): VpSa => ({ gen, ab: spiFor(gen, "ab"), ba: spiFor(gen, "ba"), encaps: { "GW-A": 0, "GW-B": 0 }, decaps: { "GW-A": 0, "GW-B": 0 }, seq: { "GW-A": 0, "GW-B": 0 } });
export function createVpNet(cfg: VpCfg = vpHealthy()): VpNet {
  return { cfg, tunnel: vpTunnel(cfg), sa: freshSa(1), tkey: tunnelKey(cfg), clock: 43200, captures: [], capN: 0, syslog: [], runs: [], seq: 0, pktSeq: 0, cfgSeq: 0, pingSeq: 0, log: [] };
}
/** The SPI carried toward a gateway = the one that gateway chose. */
export const spiToward = (sa: VpSa, rx: VpGw) => (rx === "GW-B" ? sa.ab : sa.ba);

// ---------------------------------------------------------------------------------------------------------------
// Data plane
// ---------------------------------------------------------------------------------------------------------------
interface Work {
  s: VpNet;
  waves: VpWave[];
  captures: VpCap[];
  capN: number;
  runId: number;
  pktSeq: number;
  sa: VpSa;
}
export const capPoint = (dev: VpDev, side?: "lan" | "wan") => (isGw(dev) && side ? `${dev} ${side}` : dev);
function capture(w: Work, k: number, h: VpHop, outSide?: "lan" | "wan", inSide?: "lan" | "wan") {
  w.captures.push({ n: ++w.capN, run: w.runId, wave: k, point: capPoint(h.from, outSide), dir: "out", pkt: h.pkt }, { n: ++w.capN, run: w.runId, wave: k, point: capPoint(h.to, inSide), dir: "in", pkt: h.pkt });
}
const ownerOf = (ip: string): VpDev | undefined => (VP_HOSTS.find((h) => HOST_IP[h] === ip) as VpDev | undefined) ?? VP_GWS.find((g) => GW[g].lan === ip || GW[g].wan === ip);
/** Next hop on the internet for a destination. */
function internet(c: VpCfg, dst: string): { dev?: VpDev; drop?: string; text?: string } {
  if (inPrefix(dst, GW["GW-A"].wanNet)) return dst === GW["GW-A"].wan ? { dev: "GW-A", text: `${dst}: 198.51.100.8/30 → GW-A` } : { drop: `ARP for ${dst}: no answer` };
  if (inPrefix(dst, GW["GW-B"].wanNet)) return !c.wanB ? { drop: "the link to GW-B is down" } : dst === GW["GW-B"].wan ? { dev: "GW-B", text: `${dst}: 203.0.113.8/30 → GW-B` } : { drop: `ARP for ${dst} on 203.0.113.8/30: no answer` };
  if (inPrefix(dst, WEB_NET)) return dst === HOST_IP.WEB ? { dev: "WEB", text: `${dst}: 192.0.2.0/24 → WEB` } : { drop: `ARP for ${dst}: no answer` };
  return { drop: `no route to ${dst} — ${isPrivate(dst) ? "private addresses are never routed on the internet" : "nobody announces it"}` };
}
/** Carry one packet hop by hop. Gateways encrypt / decrypt as configured. */
function carry(w: Work, from: VpDev, p0: VpPkt, onDeliver: (d: VpDev, p: VpPkt) => void): { path: VpDev[]; encrypted: boolean } {
  const s = w.s;
  const c = s.cfg;
  const path: VpDev[] = [from];
  let cur: VpDev = from;
  let p = p0;
  let enc = false;
  let inSide: "lan" | "wan" | undefined;
  for (let guard = 0; guard < 10; guard++) {
    const k = w.waves.length;
    const wave: VpWave = { k, hops: [], decisions: [], rx: [] };
    w.waves.push(wave);
    let next: VpDev | undefined;
    let outSide: "lan" | "wan" | undefined;
    let nextIn: "lan" | "wan" | undefined;
    const dec = (text: string, drop?: string) => wave.decisions.push({ dev: cur, pkt: p, text, drop });
    if (isHost(cur)) {
      if (cur !== from) {
        const mine = HOST_IP[cur] === p.dst;
        wave.rx.push({ dev: cur, pkt: p, ok: mine, why: mine ? `${cur}: for me` : `${cur}: not for me` });
        if (mine) onDeliver(cur, p);
        return { path, encrypted: enc };
      }
      const g = GW_OF[cur];
      if (g) {
        dec(`${p.dst} is off-link → default gateway ${GW[g].lan}`);
        next = g;
        nextIn = "lan";
      } else {
        dec(`${p.dst} is off-link → default gateway ${INET_WEB}`);
        next = "INTERNET";
      }
    } else if (cur === "INTERNET") {
      const r = internet(c, p.dst);
      if (!r.dev) {
        dec(r.drop!, r.drop);
        return { path, encrypted: enc };
      }
      dec(`${r.text} · TTL ${p.ttl} → ${p.ttl - 1}`);
      p = { ...p, ttl: p.ttl - 1 };
      next = r.dev;
      if (isGw(next)) nextIn = "wan";
    } else {
      const g = cur as VpGw;
      const gc = c.gw[g];
      const peer = otherGw(g);
      if (p.dst === GW[g].wan || p.dst === GW[g].lan) {
        if (p.kind === "esp") {
          // Decrypt.
          const want = spiToward(w.sa, g);
          if (s.tunnel.child !== "INSTALLED" || p.spi !== want) {
            dec(`ESP SPI ${p.spi}: no inbound SA with that SPI`, `ESP SPI ${p.spi}: no inbound SA with that SPI — dropped`);
            return { path, encrypted: enc };
          }
          const inner = p.inner!;
          w.sa.decaps[g]++;
          dec(`ESP SPI ${p.spi} (mine) · seq ${p.espSeq} accepted · decrypted: inner ${inner.src} → ${inner.dst} matches ${gc.remote} ↔ ${gc.local}`);
          p = { id: p.id, kind: "icmp", src: inner.src, dst: inner.dst, icmp: inner.icmp, seq: inner.seq, ttl: inner.ttl - 1 };
          if (p.dst === GW[g].lan) {
            wave.rx.push({ dev: g, pkt: p, ok: true, why: `${g}: for me` });
            onDeliver(g, p);
            return { path, encrypted: enc };
          }
          next = GW[g].host;
          outSide = "lan";
        } else {
          wave.rx.push({ dev: g, pkt: p, ok: true, why: `${g}: ${p.dst} is my own address` });
          onDeliver(g, p);
          return { path, encrypted: enc };
        }
      } else if (inPrefix(p.dst, GW[g].lanNet)) {
        // Toward my LAN (a reply from the internet after source NAT is reversed).
        dec(`${p.dst} is on my LAN ${GW[g].lanNet}`);
        next = GW[g].host;
        outSide = "lan";
        p = { ...p, ttl: p.ttl - 1 };
      } else {
        const toRemote = inPrefix(p.dst, GW[peer].lanNet) || inPrefix(p.dst, gc.remote);
        if (toRemote && gc.steer) {
          if (!inPrefix(p.src, gc.local) || !inPrefix(p.dst, gc.remote)) {
            dec(`${p.src} → ${p.dst} is outside the traffic selectors ${gc.local} ↔ ${gc.remote}`, `${p.src} → ${p.dst} doesn't match ${gc.local} ↔ ${gc.remote}: not protected, dropped`);
            return { path, encrypted: enc };
          }
          if (s.tunnel.child !== "INSTALLED") {
            dec(`${p.dst} → IPsec, but there is no CHILD SA (${s.tunnel.ike === "ESTABLISHED" ? `IKE SA up, CHILD SA ${s.tunnel.child}` : `IKE ${s.tunnel.ike}`})`, `no IPsec SA for ${gc.local} ↔ ${gc.remote} (${s.tunnel.ike === "ESTABLISHED" ? s.tunnel.child : s.tunnel.ike}) — dropped`);
            return { path, encrypted: enc };
          }
          const seq = ++w.sa.seq[g];
          w.sa.encaps[g]++;
          const spi = spiToward(w.sa, peer);
          dec(`${p.src} → ${p.dst} matches ${gc.local} ↔ ${gc.remote} → ESP: SPI ${spi} (${peer}'s), seq ${seq}, outer ${GW[g].wan} → ${GW[peer].wan}`);
          p = { id: p.id, kind: "esp", src: GW[g].wan, dst: GW[peer].wan, ttl: 64, spi, espSeq: seq, inner: { src: p.src, dst: p.dst, icmp: p.icmp!, seq: p.seq!, ttl: p.ttl } };
          enc = true;
          next = "INTERNET";
          outSide = "wan";
        } else {
          // Internet-bound in the clear: source NAT if the source is my LAN.
          const nat = inPrefix(p.src, GW[g].lanNet);
          dec(`${p.dst}${toRemote ? " (the other site!)" : ""} → default route via ${GW[g].isp}, in the clear${nat ? ` · source NAT ${p.src} → ${GW[g].wan}` : ""}${toRemote ? (c.gw[g].steer ? "" : ` — ${g} isn't sending the other site's traffic into IPsec`) : ""}`);
          p = { ...p, src: nat ? GW[g].wan : p.src, ttl: p.ttl - 1 };
          next = "INTERNET";
          outSide = "wan";
        }
      }
    }
    const h: VpHop = { from: cur, to: next!, pkt: p };
    wave.hops.push(h);
    capture(w, k, h, outSide, nextIn);
    path.push(next!);
    cur = next!;
    inSide = nextIn;
    void inSide;
  }
  return { path, encrypted: enc };
}
/** Source NAT state for internet pings (GW translates back by echo id). */
function simulate(s0: VpNet, sends: VpSend[], cmd: string): VpNet {
  const s: VpNet = { ...s0, clock: s0.clock + 2 };
  const runId = s.runs.length + 1;
  const w: Work = { s, waves: [], captures: [...s.captures], capN: s.capN, runId, pktSeq: s.pktSeq, sa: { ...s.sa, encaps: { ...s.sa.encaps }, decaps: { ...s.sa.decaps }, seq: { ...s.sa.seq } } };
  const results: VpResult[] = [];
  let pingSeq = s.pingSeq;
  for (const x of sends) {
    const r: VpResult = { send: x, replied: false, path: [], encrypted: false };
    results.push(r);
    const src = HOST_IP[x.from];
    const seq = ++pingSeq;
    let got: VpDev | undefined;
    let gotPkt: VpPkt | undefined;
    const out = carry(w, x.from, { id: ++w.pktSeq, kind: "icmp", icmp: "echo", src, dst: x.to, seq, ttl: 64 }, (d, p) => ((got = d), (gotPkt = p)));
    r.path = out.path;
    r.encrypted = out.encrypted;
    if (!got || !gotPkt) {
      r.fail = lastDrop(w) ?? "the echo request was lost";
      continue;
    }
    // The reply goes back to the source the receiver saw (after any NAT); the gateway reverses its NAT.
    const replyTo = gotPkt.src;
    let back = false;
    const natGw = VP_GWS.find((g) => GW[g].wan === replyTo && inPrefix(src, GW[g].lanNet));
    const ret = carry(w, got, { id: ++w.pktSeq, kind: "icmp", icmp: "reply", src: gotPkt.dst, dst: replyTo, seq, ttl: 64 }, (d, p) => {
      if (natGw && d === natGw) {
        // Reverse NAT on the gateway, then deliver to the host.
        const k = w.waves.length;
        const p2 = { ...p, dst: src, ttl: p.ttl - 1 };
        const h: VpHop = { from: natGw, to: x.from, pkt: p2 };
        w.waves.push({ k, hops: [h], decisions: [{ dev: natGw, pkt: p, text: `reply to ${GW[natGw].wan}: matches the NAT translation → ${src}` }], rx: [{ dev: x.from, pkt: p2, ok: true, why: `${x.from}: for me` }] });
        capture(w, k, h, "lan", undefined);
        back = true;
      } else back = d === x.from;
    });
    r.backPath = ret.path;
    r.replied = back;
    if (!back) r.fail = `the reply was lost: ${lastDrop(w) ?? "never came back"}`;
  }
  const run: VpRun = { id: runId, cmd, kind: "traffic", clock: s.clock, waves: w.waves, results, cfgSeq: s.cfgSeq };
  const seq = s.seq + 1;
  const summary = results.map((x) => `${x.send.from} → ${x.send.to}: ${x.replied ? `reply${x.encrypted ? " (through the tunnel)" : " (in the clear)"}` : `FAILED — ${x.fail}`}`).join(" · ");
  return { ...s, sa: w.sa, pingSeq, captures: w.captures.slice(-1500), capN: w.capN, runs: [...s.runs, run].slice(-40), last: run, seq, pktSeq: w.pktSeq, log: [...s.log, { seq, text: `${cmd}: ${summary}`, tone: results.every((x) => x.replied) ? "ok" : "warn" }] };
}
function lastDrop(w: Work): string | undefined {
  for (let i = w.waves.length - 1; i >= 0; i--) {
    const d = w.waves[i].decisions.find((x) => x.drop);
    if (d) return `${d.dev}: ${d.drop}`;
  }
  return undefined;
}
/** The IKEv2 exchange as it happens with this configuration (GW-A initiates). */
function negotiate(s0: VpNet): VpNet {
  const s: VpNet = { ...s0, clock: s0.clock + 2 };
  const c = s.cfg;
  const t = s.tunnel;
  const a = c.gw["GW-A"];
  const runId = s.runs.length + 1;
  const w: Work = { s, waves: [], captures: [...s.captures], capN: s.capN, runId, pktSeq: s.pktSeq, sa: s.sa };
  const A = GW["GW-A"].wan;
  const B = GW["GW-B"].wan;
  const send = (from: VpGw, to: string, ike: VpPkt["ike"], fate: { ok: boolean; why: string } | undefined) => {
    const p: VpPkt = { id: ++w.pktSeq, kind: "ike", src: GW[from].wan, dst: to, ttl: 64, ike };
    const k1 = w.waves.length;
    const h1: VpHop = { from, to: "INTERNET", pkt: p };
    w.waves.push({ k: k1, hops: [h1], decisions: [{ dev: from, pkt: p, text: `${ike!.ex} ${ike!.resp ? "response" : "request"} (Message ID ${ike!.msgId}) · UDP 500 → ${to} · ${ike!.carries}` }], rx: [] });
    capture(w, k1, h1, "wan", undefined);
    const r = internet(c, to);
    const k2 = w.waves.length;
    if (!r.dev) {
      w.waves.push({ k: k2, hops: [], decisions: [{ dev: "INTERNET", pkt: p, text: r.drop!, drop: r.drop }], rx: [] });
      return;
    }
    const h2: VpHop = { from: "INTERNET", to: r.dev, pkt: { ...p, ttl: 63 } };
    w.waves.push({ k: k2, hops: [h2], decisions: [{ dev: "INTERNET", pkt: p, text: r.text! }], rx: fate ? [{ dev: r.dev, pkt: h2.pkt, ok: fate.ok, why: `${r.dev}: ${fate.why}` }] : [] });
    capture(w, k2, h2, undefined, isGw(r.dev) ? "wan" : undefined);
  };
  const props = IKE_PROPS[a.ike];
  if (t.ike === "NO_RESPONSE") {
    for (let i = 0; i < 2; i++) send("GW-A", a.peer, { ex: "IKE_SA_INIT", msgId: 0, resp: false, carries: `SA (${props.encr}, ${props.dh}), KE, Ni${i ? " — retransmission" : ""}` }, ownerOf(a.peer) === "GW-B" ? { ok: false, why: "no IKE gateway configured for this initiator — ignored" } : undefined);
  } else {
    send("GW-A", B, { ex: "IKE_SA_INIT", msgId: 0, resp: false, carries: `SA (${props.encr}, ${props.prf}, ${props.dh}), KE, Ni — in the clear` }, { ok: t.ike !== "NO_PROPOSAL_CHOSEN", why: t.ike === "NO_PROPOSAL_CHOSEN" ? `none of these transforms is in my proposal (${IKE_PROPS[c.gw["GW-B"].ike].encr}, ${IKE_PROPS[c.gw["GW-B"].ike].dh})` : "proposal accepted · Diffie-Hellman: KE received" });
    if (t.ike === "NO_PROPOSAL_CHOSEN") send("GW-B", A, { ex: "IKE_SA_INIT", msgId: 0, resp: true, carries: "Notify NO_PROPOSAL_CHOSEN", notify: "NO_PROPOSAL_CHOSEN" }, { ok: false, why: "NO_PROPOSAL_CHOSEN — no IKE SA" });
    else {
      send("GW-B", A, { ex: "IKE_SA_INIT", msgId: 0, resp: true, carries: `SA (chosen), KE, Nr — both sides now derive SKEYSEED; nobody is authenticated yet` }, { ok: true, why: "keys derived — the next messages are encrypted (SK payload)" });
      send("GW-A", B, { ex: "IKE_AUTH", msgId: 1, resp: false, carries: `SK { IDi ${A}, AUTH (PSK), SA (ESP, SPI ${s.sa.ba}), TSi ${a.local}, TSr ${a.remote} }` }, { ok: t.ike === "ESTABLISHED", why: t.ike === "AUTHENTICATION_FAILED" ? "AUTH payload doesn't verify with my pre-shared key" : t.child === "TS_UNACCEPTABLE" ? `GW-A authenticated · but TSi ${a.local} / TSr ${a.remote} aren't within ${c.gw["GW-B"].remote} / ${c.gw["GW-B"].local}` : `GW-A authenticated · TSi/TSr within my selectors` });
      if (t.ike === "AUTHENTICATION_FAILED") send("GW-B", A, { ex: "IKE_AUTH", msgId: 1, resp: true, carries: "SK { Notify AUTHENTICATION_FAILED }", notify: "AUTHENTICATION_FAILED" }, { ok: false, why: "AUTHENTICATION_FAILED — the IKE SA is deleted" });
      else if (t.child === "TS_UNACCEPTABLE") send("GW-B", A, { ex: "IKE_AUTH", msgId: 1, resp: true, carries: "SK { IDr, AUTH, Notify TS_UNACCEPTABLE }", notify: "TS_UNACCEPTABLE" }, { ok: false, why: "IKE SA ESTABLISHED · CHILD SA refused: TS_UNACCEPTABLE" });
      else send("GW-B", A, { ex: "IKE_AUTH", msgId: 1, resp: true, carries: `SK { IDr ${B}, AUTH, SA (ESP, SPI ${s.sa.ab}), TSi, TSr }` }, { ok: true, why: `IKE SA ESTABLISHED · CHILD SA installed (outbound SPI ${s.sa.ab}, inbound ${s.sa.ba})` });
    }
  }
  const run: VpRun = { id: runId, cmd: "IKEv2 negotiation (GW-A initiates)", kind: "ike", clock: s.clock, waves: w.waves, results: [], cfgSeq: s.cfgSeq };
  const seq = s.seq + 1;
  return { ...s, captures: w.captures.slice(-1500), capN: w.capN, runs: [...s.runs, run].slice(-40), last: run, seq, pktSeq: w.pktSeq, log: [...s.log, { seq, text: `IKEv2: ${t.ike === "ESTABLISHED" ? `IKE SA up, CHILD SA ${t.child}` : t.ike}`, tone: t.child === "INSTALLED" ? "ok" : "warn" }] };
}
function recompute(s: VpNet, cfg: VpCfg, text: string): VpNet {
  const tunnel = vpTunnel(cfg);
  const key = tunnelKey(cfg);
  const changed = key !== s.tkey;
  const syslog = [...s.syslog];
  if (changed) {
    const o = s.tunnel;
    for (const g of VP_GWS) {
      if (o.child === "INSTALLED" && tunnel.child !== "INSTALLED") syslog.push({ clock: s.clock, gw: g, text: "CHILD SA deleted", tone: "down" });
      if (o.ike === "ESTABLISHED" && tunnel.ike !== "ESTABLISHED") syslog.push({ clock: s.clock, gw: g, text: "IKE SA down", tone: "down" });
      if (tunnel.ike !== "ESTABLISHED") syslog.push({ clock: s.clock, gw: g, text: tunnel.ike, tone: "err" });
      else if (tunnel.child === "TS_UNACCEPTABLE") syslog.push({ clock: s.clock, gw: g, text: "TS_UNACCEPTABLE", tone: "err" });
      if (tunnel.child === "INSTALLED" && o.child !== "INSTALLED") syslog.push({ clock: s.clock, gw: g, text: "IKE SA up · CHILD SA installed", tone: "up" });
    }
  }
  const seq = s.seq + 1;
  return { ...s, cfg, tunnel, tkey: key, sa: changed ? freshSa(s.sa.gen + 1) : s.sa, syslog: syslog.slice(-200), seq, cfgSeq: s.cfgSeq + 1, log: [...s.log, { seq, text, tone: "info" }] };
}

// ---------------------------------------------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------------------------------------------
export type VpAction = { type: "traffic"; sends: VpSend[]; cmd?: string } | { type: "ike" } | { type: "cfg"; cfg: VpCfg; text: string; junosCommit?: VpGw } | { type: "clear" } | { type: "wan"; up: boolean } | { type: "ticket"; id: VpTicketId } | { type: "fresh" };
export const sendText = (x: VpSend) => `${x.from} pings ${x.to}`;
export function vpApply(s: VpNet, a: VpAction): VpNet {
  switch (a.type) {
    case "traffic":
      return simulate(s, a.sends, a.cmd ?? a.sends.map(sendText).join(", then "));
    case "ike":
      return negotiate(s);
    case "cfg": {
      const next = recompute(s, a.cfg, a.text);
      const g = a.junosCommit;
      return g ? { ...next, rb: { ...s.rb, [g]: [JSON.stringify(s.cfg.gw[g]), ...(s.rb?.[g] ?? [])].slice(0, 49) } } : next;
    }
    case "wan":
      return recompute(s, { ...vpClone(s.cfg), wanB: a.up }, `GW-B's internet link ${a.up ? "restored" : "cut"}`);
    case "clear": {
      const seq = s.seq + 1;
      return { ...s, sa: freshSa(s.sa.gen + 1), seq, log: [...s.log, { seq, text: "SAs cleared — renegotiated with new SPIs", tone: "info" }] };
    }
    case "ticket":
      return vpTicketState(a.id, s.seq + 1);
    case "fresh":
      return { ...createVpNet(), seq: s.seq + 1 };
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Tickets
// ---------------------------------------------------------------------------------------------------------------
export type VpCause = VpTicketId | "nat" | "mtu" | "isp";
export const VP_CAUSES: { id: VpCause; label: string }[] = [
  { id: "peer", label: "A gateway points to the wrong peer address" },
  { id: "proposal", label: "The IKE proposals don't match" },
  { id: "psk", label: "The pre-shared keys differ" },
  { id: "ts", label: "The traffic selectors (protected subnets) don't match" },
  { id: "steer", label: "Site traffic isn't sent into the tunnel" },
  { id: "isp", label: "The internet blocks IKE or ESP" },
  { id: "nat", label: "NAT breaks the tunnel" },
  { id: "mtu", label: "The packets are too big for the tunnel (MTU)" },
];
export interface VpTicket {
  id: VpTicketId;
  title: string;
  report: string;
  repro: VpAction[];
  reproLabel: string;
  cause: VpCause;
}
const PING_AB: VpAction = { type: "traffic", sends: [{ from: "HOST-A", to: HOST_IP["HOST-B"] }] };
export const VP_TICKETS: VpTicket[] = [
  { id: "psk", title: "New tunnel never comes up", report: "“Site B's gateway was replaced yesterday. The tunnel to Site A never comes up — the engineer says ‘IKE starts, then stops’. Both gateways reach each other's public address.”", repro: [{ type: "ike" }, PING_AB], reproLabel: "Negotiate, then HOST-A pings HOST-B", cause: "psk" },
  { id: "proposal", title: "Tunnel down after the ‘security hardening’", report: "“After someone ‘hardened the crypto’ on GW-B, Site A can't reach Site B. GW-A's log shows the very first IKE message rejected.”", repro: [{ type: "ike" }, PING_AB], reproLabel: "Negotiate, then HOST-A pings HOST-B", cause: "proposal" },
  { id: "ts", title: "IKE is up — and nothing passes", report: "“Monitoring says the VPN peer is up (IKE SA established), but Site A can't reach a single host in Site B. GW-B's config was edited during a migration.”", repro: [{ type: "ike" }, PING_AB], reproLabel: "Negotiate, then HOST-A pings HOST-B", cause: "ts" },
  { id: "steer", title: "Tunnel up, counters at zero", report: "“The IPsec SA is up on both sides, yet HOST-A can't ping HOST-B and the ESP counters never move. Browsing the internet from Site A works fine.”", repro: [PING_AB], reproLabel: "HOST-A pings HOST-B", cause: "steer" },
  { id: "peer", title: "IKE gets no answer", report: "“After an address change on GW-A's configuration the tunnel stays down. GW-A says it keeps sending IKE_SA_INIT and never hears back. The internet works from both sites.”", repro: [{ type: "ike" }, PING_AB], reproLabel: "Negotiate, then HOST-A pings HOST-B", cause: "peer" },
];
export const vpTicket = (id: VpTicketId) => VP_TICKETS.find((t) => t.id === id)!;
export function vpTicketState(id: VpTicketId, seq: number): VpNet {
  const cfg = vpHealthy();
  if (id === "psk") cfg.gw["GW-B"].psk = PSKS[1];
  if (id === "proposal") cfg.gw["GW-B"].ike = "aes128-sha1-g14";
  if (id === "ts") cfg.gw["GW-B"].remote = "10.10.20.0/24";
  if (id === "steer") cfg.gw["GW-A"].steer = false;
  if (id === "peer") cfg.gw["GW-A"].peer = "203.0.113.11";
  const s = createVpNet(cfg);
  return { ...s, seq, ticket: id, log: [{ seq, text: `Ticket opened: ${vpTicket(id).title}`, tone: "info" }] };
}
export function vpLastPing(s: VpNet): VpRun | undefined {
  return [...s.runs].reverse().find((r) => r.kind === "traffic" && r.results.length === 1 && r.results[0].send.from === "HOST-A" && r.results[0].send.to === HOST_IP["HOST-B"]);
}
export interface VpProof {
  label: string;
  ok: boolean;
  detail: string;
}
export function vpProofs(s: VpNet): VpProof[] {
  if (!s.ticket) return [];
  const run = vpLastPing(s);
  const fresh = !!run && run.cfgSeq === s.cfgSeq;
  const r = run?.results[0];
  const t = s.tunnel;
  return [
    { label: "IKE SA established and CHILD SA installed", ok: t.ike === "ESTABLISHED" && t.child === "INSTALLED", detail: t.child === "INSTALLED" ? `${t.tsi} ↔ ${t.tsr} · SPIs ${s.sa.ab} / ${s.sa.ba}` : (t.why ?? "") },
    { label: "A fresh test: HOST-A pings HOST-B — through the tunnel", ok: fresh && !!r?.replied && r.encrypted, detail: !run ? "not run yet" : !fresh ? "the configuration changed since the last test — run it again" : r!.replied ? (r!.encrypted ? `reply · ESP encaps GW-A ${s.sa.encaps["GW-A"]}, decaps GW-B ${s.sa.decaps["GW-B"]}` : "reply, but NOT encrypted") : `failed: ${r!.fail}` },
  ];
}
export function vpCauseFeedback(s: VpNet, cause: VpCause): { right: boolean; consequence?: boolean; text: string } {
  const c = s.cfg;
  const a = c.gw["GW-A"];
  const b = c.gw["GW-B"];
  const t = s.ticket ? vpTicket(s.ticket) : undefined;
  const right = !!t && t.cause === cause;
  const text: Record<VpCause, string> = {
    peer: right ? `Yes. GW-A sends IKE_SA_INIT to ${a.peer}, but GW-B is ${GW["GW-B"].wan}. Nobody answers at ${a.peer}: GW-A retransmits and gives up. Nothing about proposals, keys or selectors is ever reached — the first message never meets the peer.` : `Both gateways point at each other (${a.peer} ↔ ${b.peer}): IKE_SA_INIT ${s.tunnel.ike === "NO_RESPONSE" ? "gets no answer for another reason" : "is answered"}.`,
    proposal: right ? `Yes. GW-B's IKE proposal is now ${IKE_PROPS[b.ike].encr} / ${IKE_PROPS[b.ike].prf} / ${IKE_PROPS[b.ike].dh}; GW-A offers ${IKE_PROPS[a.ike].encr} / ${IKE_PROPS[a.ike].dh}. No transform set in common: GW-B answers the very first message with NO_PROPOSAL_CHOSEN — no keys, no IKE SA.` : `The IKE proposals match (${IKE_PROPS[a.ike].encr}, ${IKE_PROPS[a.ike].dh}) — IKE_SA_INIT completes.`,
    psk: right ? "Yes. IKE_SA_INIT completes (proposals match, Diffie-Hellman done) — then in IKE_AUTH GW-B can't verify GW-A's AUTH payload: the pre-shared keys differ. AUTHENTICATION_FAILED; the half-built IKE SA is deleted. “IKE starts, then stops.”" : `The pre-shared keys match: IKE_AUTH ${s.tunnel.ike === "ESTABLISHED" ? "authenticates both peers" : "isn't reached"}.`,
    ts: right ? `Yes. IKE is fine (keys, authentication: the IKE SA is ESTABLISHED). But GW-B's selector for Site A is ${b.remote}; GW-A asks to protect ${a.local} ↔ ${a.remote}. GW-B refuses the CHILD SA with TS_UNACCEPTABLE — no ESP SA, so every site packet is dropped at GW-A. Monitoring that only checks the IKE SA says “up”.` : `The selectors fit (GW-A ${a.local} ↔ ${a.remote}, GW-B ${b.remote} ↔ ${b.local}).`,
    steer: right ? "Yes. The SAs are up, but GW-A doesn't send Site B's traffic into IPsec (Cisco: the crypto map isn't applied on the WAN interface; Junos: no route to 10.20.20.0/24 via st0.0). The ping follows the default route to the internet in the clear — source-NATed to 198.51.100.10, destination still 10.20.20.20 — and the internet drops it: no route to a private address. ESP counters stay at zero." : `GW-A sends Site B's traffic into IPsec (${a.steer ? "steered" : "NOT steered"}).`,
    isp: "The internet carries IKE (UDP 500) between the gateways — the captures show the IKE messages arriving at the peer's public address.",
    nat: "There is no NAT between the gateways: the outer addresses are the gateways' own public ones (no NAT-T / UDP 4500 needed). Source NAT only applies to internet-bound traffic.",
    mtu: "The test is a small ping: it fits in an ESP packet easily. Nothing reaches the point where size matters.",
  };
  return { right, text: text[cause] };
}
