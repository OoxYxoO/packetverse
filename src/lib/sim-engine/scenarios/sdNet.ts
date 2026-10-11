/**
 * SD-WAN Lab network — the SD-WAN lesson's branch, hub and two overlay paths:
 *
 *                       ┌── ISP-A (biz-internet) ── TUN-A ──┐
 *   CLIENT ── BRANCH-EDGE                                    HUB-EDGE ── APP 10.40.40.20
 *   10.30.30.10         └── ISP-B (public-internet) ─ TUN-B ┘
 *
 * The edge measures every overlay path once per interval (loss, latency, jitter over the interval's probes — Cisco:
 * BFD on each tunnel; Junos: RPM probes), compares the results with each application's SLA class and selects a path
 * per application from its installed policy:
 *   - VOICE (UDP, DSCP EF) — SLA required: only paths that meet the VOICE SLA class, in preference order. If none
 *     does: fall back to the best reachable path (Cisco fallback-to-best-path), or drop (strict).
 *   - BULK (TCP 873, nightly backup) — no SLA: any reachable path, in preference order.
 *   - A path that failed the SLA is trusted again only after `hold` consecutive passing intervals (hysteresis).
 *   - A path whose underlay is down is unreachable (its tunnel is down) — unusable for every class.
 * The WAN conditions (healthy, brownout, lossy, down) are the world, not configuration.
 */

export type SdTun = "TUN-A" | "TUN-B";
export type SdClass = "VOICE" | "BULK";
export type SdDev = "CLIENT" | "BRANCH" | "ISP-A" | "ISP-B" | "HUB" | "APP";
export const SD_TUNS: SdTun[] = ["TUN-A", "TUN-B"];
export const SD_CLASSES: SdClass[] = ["VOICE", "BULK"];
export const SD_DEVS: SdDev[] = ["CLIENT", "BRANCH", "ISP-A", "ISP-B", "HUB", "APP"];
export const SD_IP = { client: "10.30.30.10", branchLan: "10.30.30.1", hubLan: "10.40.40.1", app: "10.40.40.20", branchSys: "10.255.1.1", hubSys: "10.255.0.1" } as const;
export const TUN: Record<SdTun, { isp: "ISP-A" | "ISP-B"; color: string; local: string; remote: string; junosIf: string; ciscoIf: string }> = {
  "TUN-A": { isp: "ISP-A", color: "biz-internet", local: "192.0.2.2", remote: "203.0.113.20", junosIf: "st0.1", ciscoIf: "Tunnel1" },
  "TUN-B": { isp: "ISP-B", color: "public-internet", local: "198.51.100.6", remote: "203.0.113.24", junosIf: "st0.2", ciscoIf: "Tunnel2" },
};
export const CLASS_MATCH: Record<SdClass, string> = { VOICE: "UDP 16384–32767 · DSCP EF (46)", BULK: "TCP 873 (backup sync)" };
export type Quality = "healthy" | "brownout" | "lossy" | "down";
export const QUALITIES: Quality[] = ["healthy", "brownout", "lossy", "down"];
/** What each path delivers in each condition (per-interval averages). */
const PROFILE: Record<SdTun, Record<Exclude<Quality, "down">, { rtt: number; jitter: number; loss: number }>> = {
  "TUN-A": { healthy: { rtt: 25, jitter: 3, loss: 0.2 }, brownout: { rtt: 160, jitter: 40, loss: 2.0 }, lossy: { rtt: 30, jitter: 4, loss: 4.0 } },
  "TUN-B": { healthy: { rtt: 55, jitter: 8, loss: 0.4 }, brownout: { rtt: 170, jitter: 45, loss: 2.4 }, lossy: { rtt: 60, jitter: 9, loss: 4.4 } },
};
export const PROBES = 500;

// ---------------------------------------------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------------------------------------------
export interface SdCfg {
  /** The VOICE SLA class. */
  sla: { rtt: number; jitter: number; loss: number };
  pref: Record<SdClass, SdTun[]>;
  slaReq: Record<SdClass, boolean>;
  /** No path meets the SLA: true = use the best reachable path; false = drop (strict). */
  fallback: Record<SdClass, boolean>;
  /** Passing intervals before a recovered path is trusted again. */
  hold: number;
}
export function sdHealthy(): SdCfg {
  return { sla: { rtt: 100, jitter: 30, loss: 1 }, pref: { VOICE: ["TUN-A", "TUN-B"], BULK: ["TUN-B", "TUN-A"] }, slaReq: { VOICE: true, BULK: false }, fallback: { VOICE: true, BULK: true }, hold: 3 };
}
export const sdClone = <T>(c: T): T => JSON.parse(JSON.stringify(c)) as T;

// ---------------------------------------------------------------------------------------------------------------
// Measurement and selection
// ---------------------------------------------------------------------------------------------------------------
export interface Meas {
  interval: number;
  sent: number;
  received: number;
  rtt: number | null;
  jitter: number | null;
  loss: number;
}
export type SlaResult = "PASS" | "FAIL" | "DOWN";
export interface PathState {
  quality: Quality;
  last: Meas;
  sla: SlaResult;
  eligible: boolean;
  streak: number;
}
export function measure(t: SdTun, q: Quality, interval: number): Meas {
  if (q === "down") return { interval, sent: PROBES, received: 0, rtt: null, jitter: null, loss: 100 };
  const p = PROFILE[t][q];
  return { interval, sent: PROBES, received: Math.round(PROBES * (1 - p.loss / 100)), rtt: p.rtt, jitter: p.jitter, loss: p.loss };
}
export const slaChecks = (c: SdCfg, m: Meas) => (m.rtt === null ? [] : [{ k: "latency", v: m.rtt, max: c.sla.rtt, unit: "ms", ok: m.rtt <= c.sla.rtt }, { k: "jitter", v: m.jitter!, max: c.sla.jitter, unit: "ms", ok: m.jitter! <= c.sla.jitter }, { k: "loss", v: m.loss, max: c.sla.loss, unit: "%", ok: m.loss <= c.sla.loss }]);
export const slaOf = (c: SdCfg, m: Meas): SlaResult => (m.rtt === null ? "DOWN" : slaChecks(c, m).every((x) => x.ok) ? "PASS" : "FAIL");
export const reachable = (p: PathState) => p.quality !== "down";
export interface Selection {
  tun: SdTun | "NONE";
  why: string;
  fallback: boolean;
}
export function selectPath(c: SdCfg, paths: Record<SdTun, PathState>, k: SdClass): Selection {
  const pref = c.pref[k];
  if (!c.slaReq[k]) {
    const t = pref.find((x) => reachable(paths[x]));
    return t ? { tun: t, why: `no SLA required → first reachable path in preference (${pref.join(" > ")})`, fallback: false } : { tun: "NONE", why: `no reachable path among ${pref.join(", ")}`, fallback: false };
  }
  const t = pref.find((x) => reachable(paths[x]) && paths[x].eligible);
  if (t) return { tun: t, why: `first SLA-eligible path in preference (${pref.join(" > ")})`, fallback: false };
  if (!c.fallback[k]) return { tun: "NONE", why: `no path in ${pref.join(", ")} meets the ${k} SLA — strict: drop`, fallback: false };
  const cands = SD_TUNS.filter((x) => reachable(paths[x]));
  if (!cands.length) return { tun: "NONE", why: "no reachable path at all", fallback: true };
  const best = [...cands].sort((a, b) => paths[a].last.loss - paths[b].last.loss || (paths[a].last.rtt ?? 1e9) - (paths[b].last.rtt ?? 1e9) || pref.indexOf(a) - pref.indexOf(b))[0];
  return { tun: best, why: `no path meets the ${k} SLA → fallback to the best reachable path (${best}: ${paths[best].last.loss}% loss, ${paths[best].last.rtt} ms)`, fallback: true };
}
function freshPath(t: SdTun, c: SdCfg): PathState {
  const last = measure(t, "healthy", 0);
  const sla = slaOf(c, last);
  return { quality: "healthy", last, sla, eligible: sla === "PASS", streak: 0 };
}
/** Close one interval on a path. */
export function step(c: SdCfg, t: SdTun, p: PathState, interval: number): PathState {
  const last = measure(t, p.quality, interval);
  const sla = slaOf(c, last);
  if (sla !== "PASS") return { ...p, last, sla, eligible: false, streak: 0 };
  if (p.eligible) return { ...p, last, sla, streak: 0 };
  const streak = p.streak + 1;
  return { ...p, last, sla, streak, eligible: streak >= c.hold };
}

// ---------------------------------------------------------------------------------------------------------------
// Packets, runs, state
// ---------------------------------------------------------------------------------------------------------------
export interface SdPkt {
  id: number;
  kind: "voice" | "bulk" | "probe";
  src: string;
  dst: string;
  tun?: SdTun;
  reply?: boolean;
}
export interface SdHop {
  from: SdDev;
  to: SdDev;
  pkt: SdPkt;
}
export interface SdDecision {
  dev: SdDev;
  pkt: SdPkt;
  text: string;
  drop?: string;
}
export interface SdRx {
  dev: SdDev;
  pkt: SdPkt;
  ok: boolean;
  why: string;
}
export interface SdWave {
  k: number;
  hops: SdHop[];
  decisions: SdDecision[];
  rx: SdRx[];
}
export interface SdResult {
  kind: SdClass;
  delivered: boolean;
  tun: SdTun | "NONE";
  fallback: boolean;
  fail?: string;
  quality?: string;
}
export interface SdRun {
  id: number;
  cmd: string;
  kind: "traffic" | "measure";
  clock: number;
  interval: number;
  waves: SdWave[];
  results: SdResult[];
  cfgSeq: number;
  worldSeq: number;
}
export interface SdCap {
  n: number;
  run: number;
  wave: number;
  point: string;
  dir: "in" | "out";
  pkt: SdPkt;
}
export interface SdEvent {
  clock: number;
  text: string;
  tone: "up" | "down" | "info";
}
export interface SdLogLine {
  seq: number;
  text: string;
  tone: "info" | "ok" | "warn";
}
export type SdTicketId = "pref" | "slaoff" | "loose" | "bulkpref" | "fallback";
export interface SdNet {
  cfg: SdCfg;
  paths: Record<SdTun, PathState>;
  interval: number;
  counters: Record<SdTun, Record<SdClass, number>>;
  drops: Record<SdClass, number>;
  clock: number;
  captures: SdCap[];
  capN: number;
  events: SdEvent[];
  runs: SdRun[];
  last?: SdRun;
  seq: number;
  pktSeq: number;
  cfgSeq: number;
  worldSeq: number;
  log: SdLogLine[];
  ticket?: SdTicketId;
  /** Junos commit history, newest first: the configuration before each commit (rollback 1, 2…). */
  rb?: string[];
}
export function createSdNet(cfg: SdCfg = sdHealthy()): SdNet {
  return { cfg, paths: { "TUN-A": freshPath("TUN-A", cfg), "TUN-B": freshPath("TUN-B", cfg) }, interval: 0, counters: { "TUN-A": { VOICE: 0, BULK: 0 }, "TUN-B": { VOICE: 0, BULK: 0 } }, drops: { VOICE: 0, BULK: 0 }, clock: 50400, captures: [], capN: 0, events: [], runs: [], seq: 0, pktSeq: 0, cfgSeq: 0, worldSeq: 0, log: [] };
}
export const qualityText = (s: SdNet, t: SdTun) => { const m = s.paths[t].last; return m.rtt === null ? "down — no probe replies" : `${m.rtt} ms · jitter ${m.jitter} ms · loss ${m.loss}%`; };

// ---------------------------------------------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------------------------------------------
interface Work {
  s: SdNet;
  waves: SdWave[];
  captures: SdCap[];
  capN: number;
  runId: number;
  pktSeq: number;
}
function capture(w: Work, k: number, h: SdHop) {
  w.captures.push({ n: ++w.capN, run: w.runId, wave: k, point: h.from, dir: "out", pkt: h.pkt }, { n: ++w.capN, run: w.runId, wave: k, point: h.to, dir: "in", pkt: h.pkt });
}
const wave = (w: Work, hops: SdHop[], decisions: SdDecision[] = [], rx: SdRx[] = []) => {
  const k = w.waves.length;
  w.waves.push({ k, hops, decisions, rx });
  for (const h of hops) capture(w, k, h);
};
function sendApp(s: SdNet, kinds: SdClass[]): SdNet {
  const n: SdNet = { ...s, clock: s.clock + 2, counters: sdClone(s.counters), drops: { ...s.drops } };
  const w: Work = { s: n, waves: [], captures: [...s.captures], capN: s.capN, runId: s.runs.length + 1, pktSeq: s.pktSeq };
  const results: SdResult[] = [];
  for (const k of kinds) {
    const p: SdPkt = { id: ++w.pktSeq, kind: k === "VOICE" ? "voice" : "bulk", src: SD_IP.client, dst: SD_IP.app };
    wave(w, [{ from: "CLIENT", to: "BRANCH", pkt: p }], [{ dev: "CLIENT", pkt: p, text: `${k === "VOICE" ? "RTP voice UDP 16400 → 16400, DSCP EF" : "rsync TCP 49152 → 873"} to ${SD_IP.app} → default gateway ${SD_IP.branchLan}` }]);
    const sel = selectPath(n.cfg, n.paths, k);
    const states = SD_TUNS.map((t) => `${t} ${reachable(n.paths[t]) ? (n.paths[t].eligible ? "SLA-eligible" : n.paths[t].sla === "PASS" ? `recovering ${n.paths[t].streak}/${n.cfg.hold}` : "SLA ✗") : "DOWN"}`).join(", ");
    const r: SdResult = { kind: k, delivered: false, tun: sel.tun, fallback: sel.fallback };
    results.push(r);
    if (sel.tun === "NONE") {
      wave(w, [], [{ dev: "BRANCH", pkt: p, text: `classify: ${k} (${CLASS_MATCH[k]}) · paths: ${states}`, drop: sel.why }]);
      n.drops[k]++;
      r.fail = `BRANCH: ${sel.why}`;
      continue;
    }
    const t = sel.tun;
    const isp = TUN[t].isp;
    const pt: SdPkt = { ...p, tun: t };
    wave(w, [{ from: "BRANCH", to: isp, pkt: pt }], [{ dev: "BRANCH", pkt: p, text: `classify: ${k} (${CLASS_MATCH[k]}) · paths: ${states} · ${sel.why} → ${t} (${TUN[t].color})` }]);
    wave(w, [{ from: isp, to: "HUB", pkt: pt }], [{ dev: isp, pkt: pt, text: `outer ${TUN[t].local} → ${TUN[t].remote}: routed on the underlay (the inner packet is untouched)` }]);
    wave(w, [{ from: "HUB", to: "APP", pkt: p }], [{ dev: "HUB", pkt: pt, text: `from ${t}: inner ${SD_IP.client} → ${SD_IP.app} → APP LAN` }], []);
    wave(w, [], [], [{ dev: "APP", pkt: p, ok: true, why: `APP: ${k === "VOICE" ? "voice media received" : "backup data received"}` }]);
    n.counters[t][k]++;
    r.delivered = true;
    const q = n.paths[t].quality;
    r.quality = q === "healthy" ? "good" : q === "brownout" ? "poor (high latency / jitter)" : "poor (loss)";
  }
  const run: SdRun = { id: w.runId, cmd: kinds.map((k) => `CLIENT sends ${k.toLowerCase()}`).join(", then "), kind: "traffic", clock: n.clock, interval: n.interval, waves: w.waves, results, cfgSeq: n.cfgSeq, worldSeq: n.worldSeq };
  const seq = n.seq + 1;
  return { ...n, captures: w.captures.slice(-1500), capN: w.capN, runs: [...n.runs, run].slice(-40), last: run, seq, pktSeq: w.pktSeq, log: [...n.log, { seq, text: `${run.cmd}: ${results.map((x) => (x.delivered ? `${x.kind} via ${x.tun}${x.fallback ? " (fallback)" : ""}${x.quality !== "good" ? ` — ${x.quality}` : ""}` : `${x.kind} DROPPED — ${x.fail}`)).join(" · ")}`, tone: results.every((x) => x.delivered && x.quality === "good") ? "ok" : "warn" }] };
}
/** Close `count` measurement intervals; the last one is played (one probe per path, then the verdicts). */
function measureRun(s: SdNet, count: number): SdNet {
  let n: SdNet = { ...s, paths: sdClone(s.paths), events: [...s.events] };
  for (let i = 0; i < count; i++) {
    const interval = n.interval + 1;
    const before = sdClone(n.paths);
    for (const t of SD_TUNS) n.paths[t] = step(n.cfg, t, n.paths[t], interval);
    n = { ...n, interval, clock: n.clock + 10 };
    for (const t of SD_TUNS) {
      if (before[t].eligible && !n.paths[t].eligible) n.events.push({ clock: n.clock, text: `${t}: ${n.paths[t].sla === "DOWN" ? "BFD/probes down — path unreachable" : "SLA ✗ — removed from the VOICE paths"}`, tone: "down" });
      if (!before[t].eligible && n.paths[t].eligible) n.events.push({ clock: n.clock, text: `${t}: SLA met for ${n.cfg.hold} interval${n.cfg.hold > 1 ? "s" : ""} — eligible again`, tone: "up" });
    }
  }
  const w: Work = { s: n, waves: [], captures: [...n.captures], capN: n.capN, runId: n.runs.length + 1, pktSeq: n.pktSeq };
  const probes = SD_TUNS.map((t) => ({ t, p: { id: ++w.pktSeq, kind: "probe" as const, src: SD_IP.branchSys, dst: SD_IP.hubSys, tun: t } }));
  wave(w, probes.filter(({ t }) => n.paths[t].quality !== "down").map(({ t, p }) => ({ from: "BRANCH", to: TUN[t].isp, pkt: p })), probes.map(({ t, p }) => ({ dev: "BRANCH", pkt: p, text: `interval ${n.interval}: probing ${t} (${PROBES} probes)` })));
  wave(w, probes.filter(({ t }) => n.paths[t].quality !== "down").map(({ t, p }) => ({ from: TUN[t].isp, to: "HUB", pkt: p })), probes.filter(({ t }) => n.paths[t].quality === "down").map(({ t, p }) => ({ dev: TUN[t].isp, pkt: p, text: "", drop: `${TUN[t].isp} circuit down: ${t} unreachable` })));
  wave(w, probes.filter(({ t }) => n.paths[t].quality !== "down").map(({ t, p }) => ({ from: "HUB", to: TUN[t].isp, pkt: { ...p, src: SD_IP.hubSys, dst: SD_IP.branchSys, reply: true } })));
  wave(
    w,
    probes.filter(({ t }) => n.paths[t].quality !== "down").map(({ t, p }) => ({ from: TUN[t].isp, to: "BRANCH", pkt: { ...p, src: SD_IP.hubSys, dst: SD_IP.branchSys, reply: true } })),
    SD_TUNS.map((t) => {
      const ps = n.paths[t];
      const chk = slaChecks(n.cfg, ps.last);
      return { dev: "BRANCH" as SdDev, pkt: probes[0].p, text: `${t}: ${qualityText(n, t)} → ${ps.sla === "DOWN" ? "DOWN" : `SLA ${ps.sla}${chk.filter((c) => !c.ok).map((c) => ` (${c.k} ${c.v}${c.unit} > ${c.max}${c.unit})`).join("")}`} · ${ps.eligible ? "eligible" : ps.sla === "PASS" ? `recovering ${ps.streak}/${n.cfg.hold}` : "not eligible"}` };
    }),
  );
  const sel = { VOICE: selectPath(n.cfg, n.paths, "VOICE"), BULK: selectPath(n.cfg, n.paths, "BULK") };
  const run: SdRun = { id: w.runId, cmd: count > 1 ? `${count} measurement intervals` : "One measurement interval", kind: "measure", clock: n.clock, interval: n.interval, waves: w.waves, results: [], cfgSeq: n.cfgSeq, worldSeq: n.worldSeq };
  const seq = n.seq + 1;
  return { ...n, captures: w.captures.slice(-1500), capN: w.capN, runs: [...n.runs, run].slice(-40), last: run, seq, pktSeq: w.pktSeq, log: [...n.log, { seq, text: `Interval ${n.interval}: ${SD_TUNS.map((t) => `${t} ${n.paths[t].sla}${n.paths[t].eligible ? "" : " (not eligible)"}`).join(", ")} → VOICE ${sel.VOICE.tun}, BULK ${sel.BULK.tun}`, tone: "info" }] };
}
/** A configuration change re-evaluates the last measurement against the new SLA (eligibility recomputed, hysteresis kept). */
function applyCfg(s: SdNet, cfg: SdCfg, text: string): SdNet {
  const paths = sdClone(s.paths);
  for (const t of SD_TUNS) {
    const p = paths[t];
    const sla = slaOf(cfg, p.last);
    // Failing now → out at once. Passing only because the thresholds changed → in at once (hysteresis is about
    // measured recovery, not about a new policy). Passing before and after → unchanged (a path still recovering
    // keeps counting).
    paths[t] = sla !== "PASS" ? { ...p, sla, eligible: false, streak: 0 } : p.sla !== "PASS" ? { ...p, sla, eligible: true, streak: 0 } : { ...p, sla };
  }
  const seq = s.seq + 1;
  return { ...s, cfg, paths, seq, cfgSeq: s.cfgSeq + 1, log: [...s.log, { seq, text, tone: "info" }] };
}

// ---------------------------------------------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------------------------------------------
export type SdAction = { type: "traffic"; kinds: SdClass[] } | { type: "measure"; count?: number } | { type: "world"; tun: SdTun; q: Quality } | { type: "cfg"; cfg: SdCfg; text: string; junosCommit?: boolean } | { type: "ticket"; id: SdTicketId } | { type: "fresh" };
export function sdApply(s: SdNet, a: SdAction): SdNet {
  switch (a.type) {
    case "traffic":
      return sendApp(s, a.kinds);
    case "measure":
      return measureRun(s, a.count ?? 1);
    case "world": {
      const paths = sdClone(s.paths);
      paths[a.tun] = { ...paths[a.tun], quality: a.q };
      const seq = s.seq + 1;
      return { ...s, paths, seq, worldSeq: s.worldSeq + 1, log: [...s.log, { seq, text: `${a.tun} (${TUN[a.tun].isp}) is now ${a.q} — the edge notices at the next measurement`, tone: "warn" }] };
    }
    case "cfg": {
      const next = applyCfg(s, a.cfg, a.text);
      return a.junosCommit ? { ...next, rb: [JSON.stringify(s.cfg), ...(s.rb ?? [])].slice(0, 49) } : next;
    }
    case "ticket":
      return sdTicketState(a.id, s.seq + 1);
    case "fresh":
      return { ...createSdNet(), seq: s.seq + 1 };
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Tickets
// ---------------------------------------------------------------------------------------------------------------
export type SdCause = SdTicketId | "underlay" | "dscp" | "hub";
export const SD_CAUSES: { id: SdCause; label: string }[] = [
  { id: "underlay", label: "An ISP circuit is down" },
  { id: "dscp", label: "Voice isn't classified as voice" },
  { id: "pref", label: "Voice prefers the wrong path" },
  { id: "slaoff", label: "Voice doesn't require an SLA" },
  { id: "loose", label: "The voice SLA thresholds are too loose to catch a brownout" },
  { id: "fallback", label: "Voice is dropped when no path meets the SLA (strict)" },
  { id: "bulkpref", label: "The backup traffic may only use one path" },
  { id: "hub", label: "The hub or the application is down" },
];
export interface SdTicket {
  id: SdTicketId;
  title: string;
  report: string;
  repro: SdAction[];
  reproLabel: string;
  cause: SdCause;
  /** What the fresh test must show. */
  good: (r: SdResult) => boolean;
}
export const SD_TICKETS: SdTicket[] = [
  { id: "pref", title: "Calls go over the expensive line", report: "“Finance says all our voice calls run over ISP-B (public internet, metered) although ISP-A — our business line — is perfectly healthy. Bulk backups are where they should be.”", repro: [{ type: "measure" }, { type: "traffic", kinds: ["VOICE"] }], reproLabel: "Measure, then CLIENT places a call", cause: "pref", good: (r) => r.delivered && r.tun === "TUN-A" && !r.fallback },
  { id: "slaoff", title: "Choppy calls during ISP-A's brownouts", report: "“Whenever ISP-A has one of its evening brownouts, calls become choppy and stay that way. ISP-B is fine at those times — why don't calls move?”", repro: [{ type: "world", tun: "TUN-A", q: "brownout" }, { type: "measure" }, { type: "traffic", kinds: ["VOICE"] }], reproLabel: "ISP-A browns out, measure, then a call", cause: "slaoff", good: (r) => r.delivered && r.tun === "TUN-B" && r.quality === "good" },
  { id: "loose", title: "Choppy calls — the SLA policy is on", report: "“Calls are choppy again whenever ISP-A browns out. The voice SLA policy is enabled — someone ‘tuned’ the SLA class last week because it raised too many alarms.”", repro: [{ type: "world", tun: "TUN-A", q: "brownout" }, { type: "measure" }, { type: "traffic", kinds: ["VOICE"] }], reproLabel: "ISP-A browns out, measure, then a call", cause: "loose", good: (r) => r.delivered && r.tun === "TUN-B" && r.quality === "good" },
  { id: "bulkpref", title: "Nightly backup failed", report: "“ISP-B was down for maintenance last night and the nightly backup to the hub failed — although ISP-A was up the whole time.”", repro: [{ type: "world", tun: "TUN-B", q: "down" }, { type: "measure" }, { type: "traffic", kinds: ["BULK"] }], reproLabel: "ISP-B goes down, measure, then the backup runs", cause: "bulkpref", good: (r) => r.delivered && r.tun === "TUN-A" },
  { id: "fallback", title: "Total silence on the bad day", report: "“On the day both ISPs had trouble, not a single call connected — not even a bad one. The business would rather have poor calls than none.”", repro: [{ type: "world", tun: "TUN-A", q: "brownout" }, { type: "world", tun: "TUN-B", q: "brownout" }, { type: "measure" }, { type: "traffic", kinds: ["VOICE"] }], reproLabel: "Both ISPs brown out, measure, then a call", cause: "fallback", good: (r) => r.delivered && r.fallback },
];
export const sdTicket = (id: SdTicketId) => SD_TICKETS.find((t) => t.id === id)!;
export function sdTicketState(id: SdTicketId, seq: number): SdNet {
  const cfg = sdHealthy();
  if (id === "pref") cfg.pref.VOICE = ["TUN-B", "TUN-A"];
  if (id === "slaoff") cfg.slaReq.VOICE = false;
  if (id === "loose") cfg.sla = { rtt: 250, jitter: 60, loss: 3 };
  if (id === "bulkpref") cfg.pref.BULK = ["TUN-B"];
  if (id === "fallback") cfg.fallback.VOICE = false;
  const s = createSdNet(cfg);
  return { ...s, seq, ticket: id, log: [{ seq, text: `Ticket opened: ${sdTicket(id).title}`, tone: "info" }] };
}
export function sdLastRepro(s: SdNet): SdRun | undefined {
  if (!s.ticket) return undefined;
  const t = sdTicket(s.ticket);
  const want = (t.repro.at(-1) as Extract<SdAction, { type: "traffic" }>).kinds;
  return [...s.runs].reverse().find((r) => r.kind === "traffic" && r.results.length === want.length && r.results.every((x, i) => x.kind === want[i]));
}
export interface SdProof {
  label: string;
  ok: boolean;
  detail: string;
}
export function sdProofs(s: SdNet): SdProof[] {
  if (!s.ticket) return [];
  const t = sdTicket(s.ticket);
  const run = sdLastRepro(s);
  const repro = t.repro.filter((a) => a.type === "world") as Extract<SdAction, { type: "world" }>[];
  const worldOk = repro.every((a) => s.paths[a.tun].quality === a.q);
  const fresh = !!run && run.cfgSeq === s.cfgSeq && run.interval === s.interval;
  const r = run?.results[0];
  const c = s.cfg;
  const intent: SdProof =
    s.ticket === "slaoff" || s.ticket === "pref" || s.ticket === "loose" || s.ticket === "fallback"
      ? { label: "Voice still requires a real SLA (≈100 ms / 30 ms / 1 %), prefers ISP-A and falls back to the best path", ok: c.slaReq.VOICE && c.sla.rtt <= 150 && c.sla.rtt >= 50 && c.sla.jitter <= 35 && c.sla.loss <= 1.5 && c.pref.VOICE[0] === "TUN-A" && c.fallback.VOICE, detail: `SLA ${c.slaReq.VOICE ? "required" : "NOT required"} · ${c.sla.rtt} ms / ${c.sla.jitter} ms / ${c.sla.loss}% · preference ${c.pref.VOICE.join(" > ")}` }
      : { label: "Backups still prefer ISP-B and may use both paths", ok: c.pref.BULK[0] === "TUN-B" && c.pref.BULK.length === 2, detail: `BULK preference ${c.pref.BULK.join(" > ")}` };
  return [intent, { label: `A fresh test: ${t.reproLabel} — and it works as designed`, ok: worldOk && fresh && !!r && t.good(r), detail: !run ? "not run yet" : !worldOk ? "the WAN conditions of the test changed — reproduce them" : !fresh ? "the configuration or the measurements changed since the last test — measure, then send again" : r!.delivered ? `${r!.kind} via ${r!.tun}${r!.fallback ? " (fallback)" : ""}, quality ${r!.quality}` : `dropped: ${r!.fail}` }];
}
export function sdCauseFeedback(s: SdNet, cause: SdCause): { right: boolean; consequence?: boolean; text: string } {
  const c = s.cfg;
  const t = s.ticket ? sdTicket(s.ticket) : undefined;
  const right = !!t && t.cause === cause;
  const q = (x: SdTun) => `${x} ${s.paths[x].quality} (${qualityText(s, x)}, SLA ${s.paths[x].sla}${s.paths[x].eligible ? ", eligible" : ""})`;
  const text: Record<SdCause, string> = {
    underlay: `${SD_TUNS.map((x) => `${x}: ${s.paths[x].quality === "down" ? "DOWN" : "up"}`).join(", ")}. ${SD_TUNS.some((x) => s.paths[x].quality === "down") ? "A circuit is down as part of the scenario — the question is why the policy doesn't use the other one." : "Both circuits are up: probes come back on both tunnels."}`,
    dscp: "The traffic is classified correctly: the edge's decision line says “classify: VOICE (UDP … DSCP EF)” or “BULK (TCP 873)” — the class is right, the path choice is the question.",
    pref: right ? `Yes. VOICE's preference is ${c.pref.VOICE.join(" > ")}. Both paths meet the SLA, so the edge takes the FIRST eligible one in the list — ISP-B. Nothing is broken; the order is wrong. Put TUN-A (biz-internet) first.` : `VOICE prefers ${c.pref.VOICE.join(" > ")} — ISP-A first, as designed; the call's path follows from the measurements: ${q("TUN-A")}.`,
    slaoff: right ? "Yes. VOICE no longer requires an SLA class: like the backups, it just takes the first REACHABLE path in its preference — TUN-A, browned out (160 ms, 40 ms jitter, 2 % loss) but still up. With the SLA required, TUN-A would be removed from the voice paths and calls would move to TUN-B." : `VOICE ${c.slaReq.VOICE ? "requires its SLA class — only SLA-eligible paths are used" : "does NOT require an SLA"}. Look at what the SLA class lets through: ${q("TUN-A")}.`,
    loose: right ? `Yes. The SLA is required, but the VOICE class now allows ${c.sla.rtt} ms latency, ${c.sla.jitter} ms jitter and ${c.sla.loss} % loss. ISP-A's brownout (160 ms, 40 ms, 2 %) PASSES that — so TUN-A stays eligible and first in preference, and calls stay on it, choppy. A voice SLA must reflect what voice tolerates (≈100 ms / 30 ms / 1 %), not what keeps alarms quiet.` : `The VOICE SLA class is ${c.sla.rtt} ms / ${c.sla.jitter} ms / ${c.sla.loss} % — strict enough that a brownout fails it (${q("TUN-A")}).`,
    fallback: right ? "Yes. Both paths really fail the voice SLA today (brownouts), and the policy is strict: with no SLA-compliant path, voice is DROPPED. With fallback-to-best-path, calls would use the least bad reachable path — poor, but connected." : `VOICE ${c.fallback.VOICE ? "falls back to the best reachable path" : "is dropped (strict)"} when no path meets the SLA — and right now ${SD_TUNS.some((x) => s.paths[x].eligible) ? "an SLA-compliant path exists, so fallback isn't even used" : "no path is compliant"}.`,
    bulkpref: right ? `Yes. BULK may only use ${c.pref.BULK.join(", ")}. With ISP-B down there is no reachable path in its list, so the backup is dropped — although TUN-A is up. Backups need no SLA; give them both paths (TUN-B > TUN-A).` : `BULK may use ${c.pref.BULK.join(" > ")} with no SLA — any reachable path in that list; the ticket is about voice.`,
    hub: "The hub and APP answer: probes come back over every reachable path, and traffic that is sent arrives at APP.",
  };
  return { right, text: text[cause] };
}
