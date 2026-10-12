import { spClone, type SpBase, type SpLine, type SpMoment, type SpRun, type SpTok } from "@/components/sp-lab/spKit";

/**
 * BGP Route Reflector Lab — iBGP in AS 65000 with two route reflectors, simulated message by message.
 *
 *          RR1 (9.9.9.9) ─────────── RR2 (10.10.10.10)        cluster 100.100.100.100 · cluster 200.200.200.200
 *          │        │    non-client   │        │
 *        PE1      PE2               PE3      PE4               clients: PE1, PE2 → RR1 · PE3, PE4 → RR2
 *      1.1.1.1  4.4.4.4           5.5.5.5  6.6.6.6
 *        CE1      CE2               CE3      CE4               customer prefixes 10.1.1.0/24 … 10.4.4.0/24 (eBGP)
 *
 * The routers, loopbacks, cluster IDs and the first prefix are the guided lesson's. Loopbacks are reachable through
 * the IS-IS / MPLS core of the previous lessons (not drawn); the customer-facing /30s are NOT in the IGP. CE1 and CE4
 * also share 10.9.9.0/24 (a dual-homed customer), so the reflectors have a real best-path choice to make.
 *
 * Modeled (RFC 4271, RFC 4456):
 * - Sessions: TCP between loopbacks; Established when both ends configure each other (address, remote-as 65000) and
 *   both loopbacks are reachable. A neighbor typed with the wrong address never connects (Active).
 * - Every router keeps an Adj-RIB-In per neighbor and picks one best path per prefix: valid next hop → highest
 *   LOCAL_PREF → locally learned (eBGP) → lowest IGP cost to the next hop → shortest CLUSTER_LIST → lowest
 *   ORIGINATOR_ID / router ID → lowest neighbor address.
 * - Advertisement: an eBGP-learned best path goes to every iBGP peer. An iBGP-learned path is never re-advertised to
 *   iBGP peers — except by a route reflector: from a client → to all clients and non-clients (not back to the sender);
 *   from a non-client → to clients only. A reflector advertises only its own best path.
 * - Reflection adds ORIGINATOR_ID (the originator's router ID, if not already set) and prepends the reflector's
 *   CLUSTER_ID to CLUSTER_LIST. A router drops a path carrying its own router ID as ORIGINATOR_ID; a reflector drops
 *   a path whose CLUSTER_LIST already contains its cluster ID.
 * - NEXT_HOP: a PE advertises eBGP routes with next-hop-self (its loopback) when configured; otherwise the CE address,
 *   which no other router can resolve. Reflectors never change the next hop.
 * - Outbound prefix filters per neighbor (IOS XR route-policy / Junos export policy).
 * - Data plane: a customer packet follows the ingress PE's best BGP route to the next-hop PE (through the MPLS core,
 *   shown as one hop) and on to that PE's customer.
 */

export type RrDev = "RR1" | "RR2" | "PE1" | "PE2" | "PE3" | "PE4";
export type RrCe = "CE1" | "CE2" | "CE3" | "CE4";
export const RR_DEVS: RrDev[] = ["RR1", "RR2", "PE1", "PE2", "PE3", "PE4"];
export const RR_PES: RrDev[] = ["PE1", "PE2", "PE3", "PE4"];
export const RR_LO: Record<RrDev, string> = { RR1: "9.9.9.9", RR2: "10.10.10.10", PE1: "1.1.1.1", PE2: "4.4.4.4", PE3: "5.5.5.5", PE4: "6.6.6.6" };
export const RR_CLUSTER: Record<"RR1" | "RR2", string> = { RR1: "100.100.100.100", RR2: "200.200.200.200" };
export const AS = 65000;
export const CE_OF: Record<string, RrCe> = { PE1: "CE1", PE2: "CE2", PE3: "CE3", PE4: "CE4" };
export const PE_OF: Record<RrCe, RrDev> = { CE1: "PE1", CE2: "PE2", CE3: "PE3", CE4: "PE4" };
export const CE_AS: Record<RrCe, number> = { CE1: 65101, CE2: 65102, CE3: 65103, CE4: 65104 };
export const CE_ADDR: Record<RrCe, { pe: string; ce: string; net: string }> = {
  CE1: { pe: "172.16.1.1", ce: "172.16.1.2", net: "172.16.1.0" },
  CE2: { pe: "172.16.2.1", ce: "172.16.2.2", net: "172.16.2.0" },
  CE3: { pe: "172.16.3.1", ce: "172.16.3.2", net: "172.16.3.0" },
  CE4: { pe: "172.16.4.1", ce: "172.16.4.2", net: "172.16.4.0" },
};
/** Customer prefixes each CE announces by eBGP. CE1 and CE4 both announce the dual-homed 10.9.9.0/24. */
export const CE_PFX: Record<RrCe, string[]> = { CE1: ["10.1.1.0/24", "10.9.9.0/24"], CE2: ["10.2.2.0/24"], CE3: ["10.3.3.0/24"], CE4: ["10.4.4.0/24", "10.9.9.0/24"] };
export const ALL_PFX = ["10.1.1.0/24", "10.2.2.0/24", "10.3.3.0/24", "10.4.4.0/24", "10.9.9.0/24"];
/** IS-IS cost between loopbacks through the core (the reflectors sit close to their own clients). */
const POSN: Record<RrDev, [number, number]> = { RR1: [1, 0], RR2: [3, 0], PE1: [0, 1], PE2: [2, 1], PE3: [2, 1.2], PE4: [4, 1] };
export const igpCost = (a: RrDev, b: RrDev) => (a === b ? 0 : 10 * Math.round(Math.abs(POSN[a][0] - POSN[b][0]) * 2 + Math.abs(POSN[a][1] - POSN[b][1]) * 2 + 2));
export const devByIp = (ip: string) => RR_DEVS.find((d) => RR_LO[d] === ip);

// ---------------------------------------------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------------------------------------------
export interface RrNbr {
  ip: string;
  remoteAs: number;
  /** route-reflector-client (XR per neighbor; Junos: member of a group with `cluster`). */
  client: boolean;
  /** next-hop-self toward this neighbor (PEs toward their reflectors). */
  nhs: boolean;
  /** Outbound policy (IOS XR route-policy / Junos export policy) naming a prefix set: only those prefixes pass. */
  policy?: string;
  /** Junos BGP group the neighbor sits in (IOS XR has no groups); derived from `client` when unset. */
  group?: string;
}
export interface RrCfg {
  /** BGP configured. */
  on: boolean;
  /** Cluster ID (reflectors; undefined = the router ID). */
  cluster?: string;
  nbrs: RrNbr[];
  /** Loopback reachable through the IGP. */
  lo: boolean;
  /** Named prefix sets used by outbound policies (IOS XR prefix-set / Junos route-filters in a policy-statement). */
  sets: Record<string, string[]>;
}
export type RrConfig = Record<RrDev, RrCfg>;
const n = (dev: RrDev, o: Partial<RrNbr> = {}): RrNbr => ({ ip: RR_LO[dev], remoteAs: AS, client: false, nhs: false, ...o });
export function rrHealthy(): RrConfig {
  return {
    RR1: { on: true, cluster: RR_CLUSTER.RR1, lo: true, sets: {}, nbrs: [n("PE1", { client: true }), n("PE2", { client: true }), n("RR2")] },
    RR2: { on: true, cluster: RR_CLUSTER.RR2, lo: true, sets: {}, nbrs: [n("PE3", { client: true }), n("PE4", { client: true }), n("RR1")] },
    PE1: { on: true, lo: true, sets: {}, nbrs: [n("RR1", { nhs: true })] },
    PE2: { on: true, lo: true, sets: {}, nbrs: [n("RR1", { nhs: true })] },
    PE3: { on: true, lo: true, sets: {}, nbrs: [n("RR2", { nhs: true })] },
    PE4: { on: true, lo: true, sets: {}, nbrs: [n("RR2", { nhs: true })] },
  };
}
export const clusterOf = (c: RrConfig, d: RrDev) => c[d].cluster ?? RR_LO[d];
/** A router reflects when at least one neighbor is configured as a client. */
export const isRr = (c: RrConfig, d: RrDev) => c[d].nbrs.some((x) => x.client);

// ---------------------------------------------------------------------------------------------------------------
// Sessions and paths
// ---------------------------------------------------------------------------------------------------------------
export interface RrSession {
  a: RrDev;
  /** The configured neighbor address on a (may be a typo). */
  ip: string;
  b?: RrDev;
  state: "Established" | "Active" | "Idle";
  why?: string;
}
export function sessions(c: RrConfig): RrSession[] {
  const out: RrSession[] = [];
  for (const a of RR_DEVS) {
    if (!c[a].on) continue;
    for (const nb of c[a].nbrs) {
      const b = devByIp(nb.ip);
      if (!b) {
        out.push({ a, ip: nb.ip, state: "Active", why: `nothing answers on ${nb.ip}` });
        continue;
      }
      const back = c[b].on ? c[b].nbrs.find((x) => x.ip === RR_LO[a]) : undefined;
      if (!c[b].on) out.push({ a, ip: nb.ip, b, state: "Active", why: `${b} runs no BGP` });
      else if (!c[a].lo || !c[b].lo) out.push({ a, ip: nb.ip, b, state: "Active", why: `no route to ${!c[b].lo ? RR_LO[b] : RR_LO[a]}` });
      else if (!back) out.push({ a, ip: nb.ip, b, state: "Active", why: `${b} has no neighbor ${RR_LO[a]} configured and refuses the connection` });
      else if (!nb.remoteAs) out.push({ a, ip: nb.ip, b, state: "Idle", why: "no remote-as configured" });
      else if (back.remoteAs !== AS || nb.remoteAs !== AS) out.push({ a, ip: nb.ip, b, state: "Idle", why: "remote-as mismatch (NOTIFICATION: Bad Peer AS)" });
      else out.push({ a, ip: nb.ip, b, state: "Established" });
    }
  }
  return out;
}
export const established = (ss: RrSession[], a: RrDev, b: RrDev) => ss.some((x) => x.a === a && x.b === b && x.state === "Established");

export interface RrPath {
  prefix: string;
  nh: string;
  lp: number;
  asPath: string;
  originator?: string;
  clusterList: string[];
  /** Who advertised it to this router: a neighbor device, or "ebgp" for the attached CE. */
  from: RrDev | "ebgp";
  /** Router ID of the advertising peer (or the CE's address). */
  fromIp: string;
}
export type AdjIn = Record<RrDev, Partial<Record<string, RrPath[]>>>;
export interface RrView {
  sessions: RrSession[];
  /** Per router: neighbor ip (or "ebgp") → paths received (after inbound loop checks). */
  adjIn: AdjIn;
  /** Paths dropped on receipt by the loop checks: router → reasons. */
  dropped: Record<RrDev, { prefix: string; from: RrDev; why: string }[]>;
}
const nhReachable = (c: RrConfig, r: RrDev, p: RrPath) => {
  if (p.from === "ebgp") return true;
  const d = devByIp(p.nh);
  return !!d && c[d].lo && c[r].lo;
};
export function candidates(c: RrConfig, v: RrView, r: RrDev, prefix: string): RrPath[] {
  return Object.values(v.adjIn[r]).flatMap((ps) => (ps ?? []).filter((p) => p.prefix === prefix));
}
/** BGP best-path selection (the steps that can differ in this network). */
export function bestPath(c: RrConfig, v: RrView, r: RrDev, prefix: string): { best?: RrPath; why: string; valid: RrPath[] } {
  const all = candidates(c, v, r, prefix);
  const valid = all.filter((p) => nhReachable(c, r, p));
  if (!valid.length) return { valid, why: all.length ? "no path has a reachable next hop" : "no path" };
  const cost = (p: RrPath) => (p.from === "ebgp" ? 0 : igpCost(r, devByIp(p.nh)!));
  const ipN = (ip: string) => ip.split(".").reduce((a, o) => a * 256 + Number(o), 0);
  const sorted = [...valid].sort((a, b) => b.lp - a.lp || (a.from === "ebgp" ? 0 : 1) - (b.from === "ebgp" ? 0 : 1) || cost(a) - cost(b) || a.clusterList.length - b.clusterList.length || ipN(a.originator ?? a.fromIp) - ipN(b.originator ?? b.fromIp) || ipN(a.fromIp) - ipN(b.fromIp));
  const [b, second] = sorted;
  let why = "only path";
  if (second) {
    if (b.from === "ebgp" && second.from !== "ebgp") why = "locally learned (eBGP) beats iBGP";
    else if (cost(b) !== cost(second)) why = `lower IGP cost to the next hop (${cost(b)} vs ${cost(second)})`;
    else if (b.clusterList.length !== second.clusterList.length) why = "shorter CLUSTER_LIST";
    else why = "lower originator / router ID";
  }
  return { best: b, why, valid: sorted };
}

/** What r advertises to neighbor device to (after the iBGP / reflection rules, attributes and the outbound filter). */
/** What r sends to `to` (its Adj-RIB-Out): what the receiver does with it (loop checks) is separate. */
export function advertise(c: RrConfig, v: RrView, r: RrDev, to: RrDev): RrPath[] {
  const nb = c[r].nbrs.find((x) => x.ip === RR_LO[to])!;
  const out: RrPath[] = [];
  for (const prefix of ALL_PFX) {
    const { best } = bestPath(c, v, r, prefix);
    if (!best) continue;
    if (best.from === to) continue;
    if (best.from !== "ebgp") {
      const src = c[r].nbrs.find((x) => x.ip === RR_LO[best.from as RrDev]);
      if (!src) continue;
      if (!isRr(c, r)) continue; // plain iBGP: never re-advertise an iBGP-learned path
      if (!src.client && !nb.client) continue; // from a non-client: only to clients
    }
    if (nb.policy && !(c[r].sets[nb.policy] ?? []).includes(prefix)) continue;
    const reflected = best.from !== "ebgp";
    out.push({
      prefix,
      nh: best.from === "ebgp" ? (nb.nhs ? RR_LO[r] : best.nh) : best.nh,
      lp: 100,
      asPath: best.asPath,
      originator: reflected ? (best.originator ?? best.fromIp) : undefined,
      clusterList: reflected ? [clusterOf(c, r), ...best.clusterList] : [],
      from: r,
      fromIp: RR_LO[r],
    });
  }
  return out;
}
export interface RrRound {
  /** Updates sent this round: from → to with the prefixes (and whether each was dropped on receipt). */
  sent: { from: RrDev; to: RrDev; prefixes: string[]; withdrawn: string[] }[];
  dropped: { at: RrDev; from: RrDev; prefix: string; why: string }[];
}
/** Converge BGP to a fixed point from the eBGP routes; returns the view and the update rounds that got there. */
export function rrConverge(c: RrConfig, prev?: RrView): { view: RrView; rounds: RrRound[] } {
  const ss = sessions(c);
  const adjIn = Object.fromEntries(RR_DEVS.map((d) => [d, {}])) as AdjIn;
  const dropped = Object.fromEntries(RR_DEVS.map((d) => [d, []])) as unknown as RrView["dropped"];
  for (const pe of RR_PES) {
    if (!c[pe].on) continue;
    const ce = CE_OF[pe];
    adjIn[pe].ebgp = CE_PFX[ce].map((prefix) => ({ prefix, nh: CE_ADDR[ce].ce, lp: 100, asPath: String(CE_AS[ce]), clusterList: [], from: "ebgp", fromIp: CE_ADDR[ce].ce }));
  }
  // Start from the previous Adj-RIBs-In where sessions still exist, so a change shows as the updates it causes.
  if (prev)
    for (const r of RR_DEVS)
      for (const [k, ps] of Object.entries(prev.adjIn[r])) if (k !== "ebgp" && devByIp(k) && established(ss, r, devByIp(k)!)) adjIn[r][k] = ps;
  const v: RrView = { sessions: ss, adjIn, dropped };
  const rounds: RrRound[] = [];
  for (let round = 0; round < 8; round++) {
    const next: AdjIn = spClone(adjIn);
    const sent: RrRound["sent"] = [];
    const dr: RrRound["dropped"] = [];
    for (const r of RR_DEVS) {
      if (!c[r].on) continue;
      for (const nb of c[r].nbrs) {
        const to = devByIp(nb.ip);
        if (!to || !established(ss, r, to)) continue;
        const adv = advertise(c, v, r, to);
        const accepted: RrPath[] = [];
        for (const p of adv) {
          if (p.originator === RR_LO[to]) {
            dr.push({ at: to, from: r, prefix: p.prefix, why: `ORIGINATOR_ID ${p.originator} is ${to}'s own router ID` });
            continue;
          }
          if (isRr(c, to) && p.clusterList.includes(clusterOf(c, to))) {
            dr.push({ at: to, from: r, prefix: p.prefix, why: `CLUSTER_LIST already contains ${to}'s cluster ID ${clusterOf(c, to)}` });
            continue;
          }
          accepted.push(p);
        }
        const before = JSON.stringify(adjIn[to][RR_LO[r]] ?? []);
        const after = JSON.stringify(accepted);
        if (before !== after) {
          const old = new Set((adjIn[to][RR_LO[r]] ?? []).map((p) => p.prefix));
          const now = new Set(adv.map((p) => p.prefix));
          sent.push({ from: r, to, prefixes: adv.filter((p) => JSON.stringify(p) !== JSON.stringify((adjIn[to][RR_LO[r]] ?? []).find((q) => q.prefix === p.prefix))).map((p) => p.prefix), withdrawn: [...old].filter((x) => !now.has(x)) });
          next[to][RR_LO[r]] = accepted;
        }
      }
    }
    // Remove Adj-RIBs-In of sessions that are not Established.
    for (const r of RR_DEVS) for (const k of Object.keys(next[r])) if (k !== "ebgp" && !(devByIp(k) && established(ss, r, devByIp(k)!))) delete next[r][k];
    const changed = JSON.stringify(next) !== JSON.stringify(adjIn);
    if (sent.length || dr.length) rounds.push({ sent, dropped: dr });
    for (const r of RR_DEVS) adjIn[r] = next[r];
    for (const d of dr) if (!dropped[d.at].some((x) => x.prefix === d.prefix && x.from === d.from)) dropped[d.at].push({ prefix: d.prefix, from: d.from, why: d.why });
    if (!changed) break;
  }
  return { view: v, rounds: rounds.filter((x) => x.sent.length || x.dropped.length) };
}

// ---------------------------------------------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------------------------------------------
export interface RrSnap {
  view: RrView;
}
export interface RrSys {
  t: number;
  dev: RrDev;
  kind: "up" | "down" | "commit";
  peer?: string;
  why?: string;
}
export interface RrTest {
  id: number;
  from: RrCe;
  dst: string;
  ok: boolean;
  path: string[];
  why?: string;
  cfgSeq: number;
}
export interface RrState extends SpBase<RrSnap> {
  cfg: RrConfig;
  hist: Record<RrDev, RrCfg[]>;
  view: RrView;
  sys: RrSys[];
  tests: RrTest[];
  /** Sessions up since (for uptime columns). */
  since: Record<string, number>;
  wiped?: boolean;
}
export type RrAction =
  | { type: "cfg"; dev: RrDev; cfg: RrCfg; text: string }
  | { type: "set"; changes: { dev: RrDev; f: (c: RrCfg) => void }[]; text: string }
  | { type: "test"; from: RrCe; dst: string }
  | { type: "ticket"; id: RrTicketId }
  | { type: "boot"; design: "mesh" | "rr" }
  | { type: "down" }
  | { type: "wipe-rr2" };

const cl = (o: RrState): RrState => ({ ...spClone(o), runs: o.runs, last: o.last });
export const sessKey = (a: RrDev, ip: string) => `${a}>${ip}`;
export function createRrNet(seq = 0): RrState {
  const cfg = rrHealthy();
  const { view } = rrConverge(cfg);
  const s: RrState = { seq, cfgSeq: 0, clock: 3600, runs: [], log: [{ seq, t: 3600, text: "AS 65000 converged: four clients, two reflectors, every PE has every customer prefix.", tone: "info" }], cfg, hist: Object.fromEntries(RR_DEVS.map((d) => [d, []])) as unknown as Record<RrDev, RrCfg[]>, view, sys: [], tests: [], since: {} };
  for (const x of view.sessions) if (x.state === "Established") {
    s.since[sessKey(x.a, x.ip)] = 30;
    s.sys.push({ t: 30, dev: x.a, kind: "up", peer: x.ip });
  }
  return s;
}

// ---------------------------------------------------------------------------------------------------------------
// The data plane: customer to customer
// ---------------------------------------------------------------------------------------------------------------
export const hostOf = (prefix: string) => prefix.replace(/\.0\/24$/, ".10");
export function ownerCe(prefix: string): RrCe[] {
  return (Object.keys(CE_PFX) as RrCe[]).filter((ce) => CE_PFX[ce].includes(prefix));
}
export function rrForward(s: RrState, from: RrCe, dst: string): { ok: boolean; path: string[]; why?: string } {
  const pe = PE_OF[from];
  const prefix = ALL_PFX.find((p) => hostOf(p) === dst) ?? dst;
  if (CE_PFX[from].includes(prefix)) return { ok: true, path: [from], why: "local" };
  const { best } = bestPath(s.cfg, s.view, pe, prefix);
  if (!best) return { ok: false, path: [from, pe], why: `${pe} has no usable route to ${prefix}` };
  const egress = best.from === "ebgp" ? pe : devByIp(best.nh)!;
  const ce = CE_OF[egress];
  return { ok: true, path: egress === pe ? [from, pe, ce] : [from, pe, egress, ce] };
}

function testRun(s: RrState, t: RrTest, back?: { ok: boolean; path: string[]; why?: string }): SpRun<RrSnap> {
  const snap = { view: spClone(s.view) };
  const moments: SpMoment<RrSnap>[] = [];
  const leg = (path: string[], ok: boolean, why: string | undefined, label: string, reply: boolean) => {
    for (let k = 0; k < path.length - 1; k++) {
      const a = path[k];
      const b = path[k + 1];
      const core = RR_PES.includes(a as RrDev) && RR_PES.includes(b as RrDev);
      moments.push({ tokens: [{ from: a, to: b, label: core ? `${label} (LSP)` : label, color: reply ? "amber" : "green" }], lines: [{ text: core ? `${a}: best BGP route → next hop ${RR_LO[b as RrDev]} (${b}); the MPLS core carries it there.` : RR_PES.includes(a as RrDev) ? `${a}: ${reply ? t.from : t.dst} is behind its own CE → delivers it.` : `${a} sends to its PE.`, tone: "info" }], snap });
    }
    if (!ok) moments.push({ tokens: [], lines: [{ text: why ?? "dropped", tone: "bad" }], views: { [path[path.length - 1]]: { ring: "bad", bubble: { text: "no route", tone: "bad" } } }, snap });
  };
  leg(t.path, t.ok || !!back, t.why, "packet", false);
  if (back) leg(back.path, back.ok, back.why, "reply", true);
  if (t.ok && back?.ok) moments.push({ tokens: [], lines: [{ text: `${t.from} ↔ ${t.dst}: success.`, tone: "ok" }], snap });
  return { id: s.runs.length + 1 + s.seq * 1000, cmd: `ping ${t.dst} from ${t.from}`, kind: "test", moments, ok: t.ok && !!back?.ok };
}
export function rrTest(s0: RrState, from: RrCe, dst: string): RrState {
  const s = cl(s0);
  s.clock += 2;
  const fwd = rrForward(s, from, dst);
  let back: ReturnType<typeof rrForward> | undefined;
  let ok = fwd.ok;
  if (fwd.ok) {
    const dstCe = fwd.path[fwd.path.length - 1] as RrCe;
    back = rrForward(s, dstCe, hostOf(CE_PFX[from][0]));
    ok = back.ok;
  }
  const t: RrTest = { id: s.tests.length + 1, from, dst, ok, path: fwd.path, why: fwd.why === "local" ? undefined : fwd.why, cfgSeq: s.cfgSeq };
  s.tests = [...s.tests, t].slice(-40);
  const run = testRun(s, t, back);
  s.runs = [...s.runs, run];
  s.last = run;
  s.log = [...s.log, { seq: s.seq, t: s.clock, text: `ping ${dst} from ${from}: ${ok ? "success" : fwd.ok ? `the reply fails — ${back?.why}` : fwd.why}`, tone: ok ? "ok" : "warn" }];
  return s;
}

// ---------------------------------------------------------------------------------------------------------------
// Changes: sessions, then the UPDATE rounds
// ---------------------------------------------------------------------------------------------------------------
function converge(prev: RrState, s: RrState, why: string, show = true): RrState {
  const { view, rounds } = rrConverge(s.cfg, prev.view);
  s.view = view;
  const moments: SpMoment<RrSnap>[] = [];
  const lines: SpLine[] = [];
  const toks: SpTok[] = [];
  for (const x of view.sessions) {
    const k = sessKey(x.a, x.ip);
    const was = prev.view.sessions.find((y) => y.a === x.a && y.ip === x.ip);
    if (x.state === "Established" && was?.state !== "Established") {
      s.since[k] = s.clock;
      s.sys.push({ t: s.clock, dev: x.a, kind: "up", peer: x.ip });
      if (x.b && RR_DEVS.indexOf(x.a) < RR_DEVS.indexOf(x.b)) {
        lines.push({ text: `${x.a} ↔ ${x.b}: TCP 179 between loopbacks, OPEN, KEEPALIVE → Established.`, tone: "ok" });
        toks.push({ from: x.a, to: x.b, label: "OPEN", color: "amber" });
      }
    } else if (x.state !== "Established" && was?.state === "Established") {
      s.sys.push({ t: s.clock, dev: x.a, kind: "down", peer: x.ip, why: x.why });
      if (!x.b || RR_DEVS.indexOf(x.a) < RR_DEVS.indexOf(x.b)) lines.push({ text: `${x.a} → ${x.ip}: session down — ${x.why}. Every route learned over it is withdrawn.`, tone: "bad" });
    }
  }
  for (const x of prev.view.sessions) if (!view.sessions.some((y) => y.a === x.a && y.ip === x.ip) && x.state === "Established") {
    s.sys.push({ t: s.clock, dev: x.a, kind: "down", peer: x.ip, why: "neighbor removed" });
    lines.push({ text: `${x.a}: neighbor ${x.ip} removed — the session is torn down.`, tone: "bad" });
  }
  if (lines.length) moments.push({ tokens: toks, lines, snap: { view: spClone(view) } });
  // Re-run the rounds from the previous view for the animation's intermediate snapshots.
  for (const [i, rd] of rounds.entries()) {
    const rt: SpTok[] = [];
    const rl: SpLine[] = [];
    for (const u of rd.sent.slice(0, 10)) {
      const reflect = isRr(s.cfg, u.from) && u.prefixes.some((p) => bestPath(s.cfg, view, u.from, p).best?.from !== "ebgp");
      if (u.prefixes.length) rt.push({ from: u.from, to: u.to, label: `UPDATE ${u.prefixes.length > 1 ? `${u.prefixes.length} prefixes` : u.prefixes[0]}`, color: reflect ? "violet" : "cyan" });
      if (u.withdrawn.length) rt.push({ from: u.from, to: u.to, label: `WITHDRAW ${u.withdrawn.length > 1 ? `${u.withdrawn.length}` : u.withdrawn[0]}`, color: "red" });
      rl.push({ text: `${u.from} → ${u.to}: ${u.prefixes.length ? `${u.prefixes.join(", ")}${reflect ? ` (reflected: ORIGINATOR_ID set, CLUSTER_LIST + ${clusterOf(s.cfg, u.from)})` : ""}` : ""}${u.withdrawn.length ? `${u.prefixes.length ? " · " : ""}withdraws ${u.withdrawn.join(", ")}` : ""}.`, tone: u.withdrawn.length && !u.prefixes.length ? "bad" : reflect ? "learn" : "info" });
    }
    for (const d of rd.dropped.slice(0, 4)) rl.push({ text: `${d.at} drops ${d.prefix} from ${d.from}: ${d.why}.`, tone: "warn" });
    if (rt.length || rl.length) moments.push({ tokens: rt, lines: rl.slice(0, 8), snap: { view: spClone(view) }, views: Object.fromEntries(rd.dropped.map((d) => [d.at, { ring: "hit" as const, bubble: { text: "loop check: drop", tone: "warn" as const } }])) });
    if (i > 6) break;
  }
  if (show && moments.length) {
    const run: SpRun<RrSnap> = { id: s.runs.length + 1 + s.seq * 1000, cmd: why, kind: "converge", moments };
    s.runs = [...s.runs, run];
    s.last = run;
  }
  return s;
}

// ---------------------------------------------------------------------------------------------------------------
// Tickets
// ---------------------------------------------------------------------------------------------------------------
export type RrTicketId = "client" | "cluster" | "typo" | "nhs" | "filter";
export interface RrTicketDef {
  id: RrTicketId;
  title: string;
  report: string;
  reproLabel: string;
  repro: RrAction[];
  fault: (c: RrConfig) => void;
}
const ping = (from: RrCe, prefix: string): RrAction => ({ type: "test", from, dst: hostOf(prefix) });
export const RR_TICKETS: RrTicketDef[] = [
  {
    id: "client",
    title: "PE3 only sees half the network",
    report: "“After last night's cleanup on RR2, CE3 can reach CE4 but nothing in the other cluster (10.1.1.0/24, 10.2.2.0/24). PE3's BGP session to RR2 is up.”",
    reproLabel: "ping CE1's network from CE3",
    repro: [ping("CE3", "10.1.1.0/24")],
    fault: (c) => {
      c.RR2.nbrs.find((x) => x.ip === RR_LO.PE3)!.client = false;
    },
  },
  {
    id: "cluster",
    title: "The clusters stopped talking",
    report: "“Since RR2 was rebuilt from a template, nobody in RR2's cluster reaches RR1's cluster and vice versa. Every session is Established.”",
    reproLabel: "ping CE1's network from CE4",
    repro: [ping("CE4", "10.1.1.0/24")],
    fault: (c) => {
      c.RR2.cluster = RR_CLUSTER.RR1;
    },
  },
  {
    id: "typo",
    title: "PE4 is an island",
    report: "“PE4 was re-addressed on paper last week. Since the change was applied, CE4 reaches nobody and nobody reaches CE4.”",
    reproLabel: "ping CE4's network from CE3",
    repro: [ping("CE3", "10.4.4.0/24")],
    fault: (c) => {
      c.RR2.nbrs.find((x) => x.ip === RR_LO.PE4)!.ip = "6.6.6.7";
    },
  },
  {
    id: "nhs",
    title: "Everyone has PE2's route — and nobody uses it",
    report: "“After PE2's config was migrated, nothing outside PE2 can reach CE2. RR1 lists 10.2.2.0/24 from PE2 in its BGP table — the other PEs don't have it at all.”",
    reproLabel: "ping CE2's network from CE1",
    repro: [ping("CE1", "10.2.2.0/24")],
    fault: (c) => {
      c.PE2.nbrs.find((x) => x.ip === RR_LO.RR1)!.nhs = false;
    },
  },
  {
    id: "filter",
    title: "One prefix missing across the clusters",
    report: "“CE3 and CE4 reach CE1 fine, but not CE2 — although PE1 and PE2 are both clients of RR1 and everything was fine before RR1's policy update.”",
    reproLabel: "ping CE2's network from CE3",
    repro: [ping("CE3", "10.2.2.0/24")],
    fault: (c) => {
      c.RR1.sets["RR1-TO-RR2"] = ["10.1.1.0/24", "10.9.9.0/24"];
      c.RR1.nbrs.find((x) => x.ip === RR_LO.RR2)!.policy = "RR1-TO-RR2";
    },
  },
];
export const rrTicket = (id: string) => RR_TICKETS.find((t) => t.id === id)!;
export function rrTicketState(id: RrTicketId, seq = 0): RrState {
  const s = createRrNet(seq);
  const nx = cl(s);
  rrTicket(id).fault(nx.cfg);
  const out = converge(s, nx, "", false);
  out.ticket = id;
  out.runs = [];
  out.last = undefined;
  out.log = [...out.log, { seq, t: out.clock, text: `Ticket opened: ${rrTicket(id).title}.`, tone: "warn" }];
  return out;
}

export function rrApply(s0: RrState, a: RrAction): RrState {
  switch (a.type) {
    case "cfg": {
      const s = cl(s0);
      s.hist = { ...s.hist, [a.dev]: [spClone(s0.cfg[a.dev]), ...s0.hist[a.dev]].slice(0, 5) };
      s.cfg[a.dev] = spClone(a.cfg);
      s.cfgSeq += 1;
      s.clock += 1;
      s.sys.push({ t: s.clock, dev: a.dev, kind: "commit" });
      s.log = [...s.log, { seq: s.seq, t: s.clock, text: `${a.dev}: ${a.text}`, tone: "info", dev: a.dev }];
      return converge(s0, s, `${a.dev}: ${a.text}`);
    }
    case "set": {
      const s = cl(s0);
      for (const ch of a.changes) ch.f(s.cfg[ch.dev]);
      s.cfgSeq += 1;
      s.clock += 1;
      s.log = [...s.log, { seq: s.seq, t: s.clock, text: a.text, tone: "info" }];
      return converge(s0, s, a.text);
    }
    case "test":
      return rrTest(s0, a.from, a.dst);
    case "ticket":
      return rrTicketState(a.id, s0.seq + 1);
    case "wipe-rr2": {
      const s = cl(s0);
      s.cfg.RR2 = { on: false, lo: true, nbrs: [], sets: {} };
      s.wiped = true;
      s.cfgSeq += 1;
      s.clock += 1;
      s.log = [...s.log, { seq: s.seq, t: s.clock, text: "RR2's BGP configuration was removed.", tone: "warn" }];
      return converge(s0, s, "RR2 loses its whole BGP configuration");
    }
    case "down": {
      // Learn: the starting point before BGP is brought up — no BGP process anywhere, no sessions, no runs.
      const s = cl(s0);
      for (const d of RR_DEVS) s.cfg[d] = { on: false, lo: true, nbrs: [], sets: {} };
      s.view = rrConverge(s.cfg).view;
      s.since = {};
      s.sys = [];
      s.log = [{ seq: s.seq, t: 0, text: "BGP is not running yet: only the IGP (IS-IS) between the loopbacks.", tone: "info" }];
      return s;
    }
    case "boot": {
      // Learn: from no sessions, bring BGP up — as a full mesh (no reflectors) or with the two reflectors.
      const empty = cl(s0);
      for (const d of RR_DEVS) empty.cfg[d] = { on: false, lo: true, nbrs: [], sets: {} };
      empty.view = rrConverge(empty.cfg).view;
      const s = cl(empty);
      s.cfg = a.design === "rr" ? rrHealthy() : meshConfig();
      s.cfgSeq += 1;
      s.clock = 0;
      return converge(empty, s, a.design === "rr" ? "BGP starts: four clients, two reflectors" : "BGP starts as a full mesh of the four PEs");
    }
  }
}
/** The four PEs fully meshed, no reflectors (the design route reflection replaces). */
export function meshConfig(): RrConfig {
  const c = rrHealthy();
  c.RR1 = { on: false, lo: true, nbrs: [], sets: {} };
  c.RR2 = { on: false, lo: true, nbrs: [], sets: {} };
  for (const pe of RR_PES) c[pe].nbrs = RR_PES.filter((x) => x !== pe).map((x) => n(x, { nhs: true }));
  return c;
}

// ---------------------------------------------------------------------------------------------------------------
// Diagnosis
// ---------------------------------------------------------------------------------------------------------------
export const RR_CAUSES: { id: string; label: string }[] = [
  { id: "client", label: "A PE is configured as a non-client on its reflector" },
  { id: "cluster", label: "Two reflectors in different clusters share a cluster ID" },
  { id: "typo", label: "A neighbor is configured with the wrong address" },
  { id: "nhs", label: "A PE advertises its customer routes without next-hop-self" },
  { id: "filter", label: "An outbound policy on a reflector filters a prefix" },
  { id: "split", label: "iBGP split horizon blocks the routes (a full mesh is needed)" },
  { id: "igp", label: "The IGP lost a loopback" },
];
const lastTest = (s: RrState) => s.tests[s.tests.length - 1];
export function rrCauseFeedback(s: RrState, cause: string): { right: boolean; consequence?: boolean; text: string } {
  const t = s.ticket as RrTicketId | undefined;
  if (cause === t) {
    const txt: Record<RrTicketId, string> = {
      client: "Yes. RR2 still has the session to PE3 but no longer treats it as a client. RR2 learns 10.1.1.0/24 and 10.2.2.0/24 from RR1 — a non-client — and reflects non-client routes to clients only: PE4 gets them, PE3 (now a non-client) does not.",
      cluster: "Yes. RR2 now uses cluster ID 100.100.100.100 — RR1's. Every route RR1 reflects carries CLUSTER_LIST 100.100.100.100, and RR2 drops it as a loop. The same happens in the other direction for RR2's reflected routes at RR1.",
      typo: "Yes. RR2 is configured with neighbor 6.6.6.7, which doesn't exist; PE4 (6.6.6.6) tries to connect but RR2 has no neighbor with that address and refuses. PE4 has no session at all, so its routes go nowhere and it learns none.",
      nhs: "Yes. PE2 no longer sets next-hop-self toward RR1, so 10.2.2.0/24 arrives at RR1 with next hop 172.16.2.2 — CE2's address on a link that isn't in the IGP. RR1 can't resolve it, so the path is never best — and a reflector only reflects its best path. Nobody else even receives it.",
      filter: "Yes. RR1's outbound policy toward RR2 permits only 10.1.1.0/24 and 10.9.9.0/24. 10.2.2.0/24 never leaves cluster 1, so RR2 has nothing to reflect to PE3 and PE4.",
    };
    return { right: true, text: txt[t] };
  }
  const lt = lastTest(s);
  switch (cause) {
    case "split":
      return { right: false, text: "Split horizon is exactly what the reflectors are there to relax: with clients configured, routes from clients are reflected to everyone. The design works — something in it is misconfigured." };
    case "igp":
      return { right: false, text: "Every loopback is reachable (every BGP session that should exist toward a real address is Established or refused for a configuration reason, not for lack of a route)." };
    case "client":
      return { right: false, text: "Every PE is configured as route-reflector-client on its reflector (show bgp neighbors / the Junos client group)." };
    case "cluster":
      return { right: false, text: `RR1 uses ${clusterOf(s.cfg, "RR1")} and RR2 uses ${clusterOf(s.cfg, "RR2")}: different clusters, no loop drops.` };
    case "typo":
      return { right: false, text: "Every configured neighbor address belongs to a real router, and every session is Established." };
    case "nhs":
      return { right: false, text: "Every PE advertises its customer routes with its own loopback as next hop (show bgp <prefix> on any router)." };
    case "filter":
      return { right: false, text: "No reflector has an outbound policy that removes a prefix (compare advertised-routes with the BGP table)." };
  }
  return { right: false, text: lt ? "That doesn't match the evidence." : "Run the user's test first." };
}
export function rrProofs(s: RrState): { label: string; ok: boolean; detail: string }[] {
  const t = s.ticket as RrTicketId | undefined;
  if (!t) return [];
  const fresh = s.tests.filter((x) => x.cfgSeq === s.cfgSeq);
  const has = (r: RrDev, p: string) => !!bestPath(s.cfg, s.view, r, p).best;
  const pingOk = (from: RrCe, p: string) => fresh.some((x) => x.from === from && x.dst === hostOf(p) && x.ok);
  switch (t) {
    case "client":
      return [
        { label: "RR2 treats PE3 as a client again", ok: !!s.cfg.RR2.nbrs.find((x) => x.ip === RR_LO.PE3)?.client, detail: "route-reflector-client toward 5.5.5.5" },
        { label: "PE3 has 10.1.1.0/24 and 10.2.2.0/24", ok: has("PE3", "10.1.1.0/24") && has("PE3", "10.2.2.0/24"), detail: "show bgp on PE3" },
        { label: "A fresh ping from CE3 to CE1's network succeeds", ok: pingOk("CE3", "10.1.1.0/24"), detail: "run the test again after the fix" },
      ];
    case "cluster":
      return [
        { label: "RR1 and RR2 use different cluster IDs", ok: clusterOf(s.cfg, "RR1") !== clusterOf(s.cfg, "RR2"), detail: `${clusterOf(s.cfg, "RR1")} / ${clusterOf(s.cfg, "RR2")}` },
        { label: "PE4 learns 10.1.1.0/24 from RR2", ok: has("PE4", "10.1.1.0/24"), detail: "CLUSTER_LIST 200.200.200.200, 100.100.100.100 at PE4" },
        { label: "A fresh ping from CE4 to CE1's network succeeds", ok: pingOk("CE4", "10.1.1.0/24"), detail: "run the test again after the fix" },
      ];
    case "typo":
      return [
        { label: "RR2 ↔ PE4 session Established", ok: established(s.view.sessions, "RR2", "PE4") && established(s.view.sessions, "PE4", "RR2"), detail: s.cfg.RR2.nbrs.map((x) => x.ip).join(", ") },
        { label: "PE3 has 10.4.4.0/24", ok: has("PE3", "10.4.4.0/24"), detail: "show bgp on PE3" },
        { label: "A fresh ping from CE3 to CE4's network succeeds", ok: pingOk("CE3", "10.4.4.0/24"), detail: "run the test again after the fix" },
      ];
    case "nhs":
      return [
        { label: "PE2 advertises 10.2.2.0/24 with next hop 4.4.4.4", ok: candidates(s.cfg, s.view, "PE1", "10.2.2.0/24").some((p) => p.nh === RR_LO.PE2), detail: candidates(s.cfg, s.view, "PE1", "10.2.2.0/24").map((p) => p.nh).join(", ") || "PE1 has no path" },
        { label: "PE1 uses the route (valid next hop)", ok: has("PE1", "10.2.2.0/24"), detail: "best path present" },
        { label: "A fresh ping from CE1 to CE2's network succeeds", ok: pingOk("CE1", "10.2.2.0/24"), detail: "run the test again after the fix" },
      ];
    case "filter":
      return [
        { label: "RR1 advertises 10.2.2.0/24 to RR2", ok: candidates(s.cfg, s.view, "RR2", "10.2.2.0/24").some((p) => p.from === "RR1"), detail: "show bgp neighbors 10.10.10.10 advertised-routes on RR1" },
        { label: "PE3 has 10.2.2.0/24", ok: has("PE3", "10.2.2.0/24"), detail: "show bgp on PE3" },
        { label: "A fresh ping from CE3 to CE2's network succeeds", ok: pingOk("CE3", "10.2.2.0/24"), detail: "run the test again after the fix" },
      ];
  }
}
export function rrLadder(s: RrState): { k: string; title: string; text: string }[] {
  const t = lastTest(s);
  const notEst = s.view.sessions.filter((x) => x.state !== "Established");
  const missing = RR_PES.flatMap((pe) => ALL_PFX.filter((p) => !bestPath(s.cfg, s.view, pe, p).best).map((p) => `${pe}: ${p}`));
  const unusable = RR_PES.flatMap((pe) => ALL_PFX.filter((p) => !bestPath(s.cfg, s.view, pe, p).best && candidates(s.cfg, s.view, pe, p).length).map((p) => `${pe}: ${p} (next hop ${candidates(s.cfg, s.view, pe, p)[0].nh})`));
  const drops = RR_DEVS.flatMap((d) => s.view.dropped[d].map((x) => `${d} dropped ${x.prefix} from ${x.from}`));
  return [
    { k: "test", title: "What did the test show?", text: t ? `ping ${t.dst} from ${t.from}: ${t.ok ? "success" : `failed — ${t.why ?? "the reply failed"}`}.` : "Run the user's test first." },
    { k: "sess", title: "Is every BGP session Established?", text: notEst.length ? notEst.map((x) => `${x.a} → ${x.ip}: ${x.state} (${x.why})`).join(" · ") : "Yes: every configured session is Established." },
    { k: "rib", title: "Which PE is missing which prefix?", text: missing.length ? missing.join(" · ") : "Every PE has a best path to every customer prefix." },
    { k: "nh", title: "Are there paths that exist but can't be used?", text: unusable.length ? unusable.join(" · ") : "No: every received path has a reachable next hop." },
    { k: "loops", title: "Did any router drop routes as loops?", text: drops.length ? drops.slice(0, 6).join(" · ") : "No ORIGINATOR_ID or CLUSTER_LIST drops." },
  ];
}
