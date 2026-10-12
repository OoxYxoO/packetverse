import { spClone, type SpBase, type SpMoment, type SpRun } from "@/components/sp-lab/spKit";

/**
 * SR Flex-Algo Lab network — the guided lesson's six routers and R3–R4 cross-link, IS-IS with SR-MPLS on IOS XR.
 *
 *            R2 ───── R4               IGP metric · advertised delay · affinity (per interface, both ends alike)
 *   10/30ms ╱  BLUE    │╲ 10/30ms      top R1–R2, R2–R4, R4–R6: metric 10, delay 30 ms, BLUE
 *   H1 ── R1      5/3ms│  R6 ── H6  192.168.6.20  (default traffic)
 *   20/5ms ╲   GOLD    │╱ 20/5ms  └── H66 192.168.66.20 (low-latency app: BGP color 128)
 *            R3 ───── R5               bottom R1–R3, R3–R5, R5–R6: metric 20, delay 5 ms, GOLD · R3–R4: metric 5, 3 ms
 *
 * Modeled (RFC 9350 Flex-Algo, RFC 8667 SR for IS-IS, RFC 8570 delay, IOS XR):
 * - Algorithm 0: every router, IGP metric. Node SIDs 16000 + index (R6 16006).
 * - Flex-Algo N: a router participates when it has `flex-algo N` under router isis. The definition (FAD) used by
 *   everyone is the one advertised (`advertise-definition`) with the highest priority, ties to the highest system-id.
 *   Without any advertised FAD the algorithm is unusable. The algorithm's topology contains participating routers only;
 *   a link direction u→v is usable when u's interface passes the FAD's affinity rules (exclude-any / include-any on
 *   `affinity flex-algo` names) and, for metric-type delay, u advertises a delay for it (performance-measurement
 *   advertise-delay, µs). Algorithm prefix SIDs: `prefix-sid algorithm N index I` → label 16000 + I (R6: 16106).
 * - R1 is the SR-TE headend for policy LOW-LATENCY (color 128, end-point R6, dynamic delay, constraint sid-algorithm
 *   128): valid when R1 has an algorithm-128 label for R6 → [16106]. R6 colors 192.168.66.0/24 with 128; a colored
 *   route uses the policy when it is up, otherwise R6's algorithm-0 Node SID (IOS XR default). Latency in tests is the
 *   real sum of link delays.
 */

export type FaR = "R1" | "R2" | "R3" | "R4" | "R5" | "R6";
export const FA_ROUTERS: FaR[] = ["R1", "R2", "R3", "R4", "R5", "R6"];
export const FA_IDX: Record<FaR, number> = { R1: 1, R2: 2, R3: 3, R4: 4, R5: 5, R6: 6 };
export const FA_LO: Record<FaR, string> = { R1: "10.0.0.1", R2: "10.0.0.2", R3: "10.0.0.3", R4: "10.0.0.4", R5: "10.0.0.5", R6: "10.0.0.6" };
export type IfName = "ge-0/0/0" | "ge-0/0/1" | "ge-0/0/2" | "ge-0/0/3";
export const SRGB_START = 16000;
export type Aff = "BLUE" | "GOLD";
export const AFF_BIT: Record<Aff, number> = { BLUE: 0, GOLD: 1 };
export type MetricType = "igp" | "delay";
export const LL_COLOR = 128;
export type FaHost = "H1" | "H6" | "H66";
export const FA_HOSTS: Record<FaHost, { ip: string; net: string; gw: string; r: FaR; ifn: IfName; color?: number }> = {
  H1: { ip: "192.168.1.10", net: "192.168.1.0", gw: "192.168.1.1", r: "R1", ifn: "ge-0/0/2" },
  H6: { ip: "192.168.6.20", net: "192.168.6.0", gw: "192.168.6.1", r: "R6", ifn: "ge-0/0/2" },
  H66: { ip: "192.168.66.20", net: "192.168.66.0", gw: "192.168.66.1", r: "R6", ifn: "ge-0/0/3", color: LL_COLOR },
};

export interface FaLink {
  id: string;
  a: FaR;
  ai: IfName;
  b: FaR;
  bi: IfName;
  metric: number;
  /** One-way delay in ms (what the fiber really does). */
  ms: number;
  aff: Aff[];
}
export const FA_LINKS: FaLink[] = [
  { id: "R1-R2", a: "R1", ai: "ge-0/0/0", b: "R2", bi: "ge-0/0/0", metric: 10, ms: 30, aff: ["BLUE"] },
  { id: "R2-R4", a: "R2", ai: "ge-0/0/1", b: "R4", bi: "ge-0/0/0", metric: 10, ms: 30, aff: ["BLUE"] },
  { id: "R4-R6", a: "R4", ai: "ge-0/0/1", b: "R6", bi: "ge-0/0/0", metric: 10, ms: 30, aff: ["BLUE"] },
  { id: "R1-R3", a: "R1", ai: "ge-0/0/1", b: "R3", bi: "ge-0/0/0", metric: 20, ms: 5, aff: ["GOLD"] },
  { id: "R3-R5", a: "R3", ai: "ge-0/0/1", b: "R5", bi: "ge-0/0/0", metric: 20, ms: 5, aff: ["GOLD"] },
  { id: "R5-R6", a: "R5", ai: "ge-0/0/1", b: "R6", bi: "ge-0/0/1", metric: 20, ms: 5, aff: ["GOLD"] },
  { id: "R3-R4", a: "R3", ai: "ge-0/0/2", b: "R4", bi: "ge-0/0/2", metric: 5, ms: 3, aff: [] },
];
export const faLinkIp = (l: FaLink, r: FaR) => `10.1.${FA_IDX[l.a]}${FA_IDX[l.b]}.${FA_IDX[r]}`;
export interface FaIfInfo {
  ifn: IfName;
  ip: string;
  peer: FaR;
  peerIf: IfName;
  peerIp: string;
  link: FaLink;
}
export function faIfs(r: FaR): FaIfInfo[] {
  return FA_LINKS.flatMap((l) => (l.a === r ? [{ ifn: l.ai, ip: faLinkIp(l, r), peer: l.b, peerIf: l.bi, peerIp: faLinkIp(l, l.b), link: l }] : l.b === r ? [{ ifn: l.bi, ip: faLinkIp(l, r), peer: l.a, peerIf: l.ai, peerIp: faLinkIp(l, l.a), link: l }] : [])).sort((x, y) => x.ifn.localeCompare(y.ifn));
}
export const faIfTo = (r: FaR, peer: FaR) => faIfs(r).find((i) => i.peer === peer);
export const faRouterOfLo = (ip: string) => FA_ROUTERS.find((r) => FA_LO[r] === ip);
export const sysId = (r: FaR) => `0000.0000.000${FA_IDX[r]}`;

// ---------------------------------------------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------------------------------------------
export interface FaIf {
  isis: boolean;
  metric: number;
  /** performance-measurement advertise-delay, µs; undefined = no delay advertised. */
  delay?: number;
  aff: Aff[];
}
export interface FaDef {
  prio: number;
  mt: MetricType;
  excl: Aff[];
  incl: Aff[];
  adv: boolean;
}
export interface FaRtr {
  sr: boolean;
  sid?: number;
  /** Algorithm prefix SIDs of Loopback0: algorithm → index. */
  algoSid: Record<number, number>;
  fa: Record<number, FaDef>;
  ifs: Partial<Record<IfName, FaIf>>;
}
export type FaCfg = Record<FaR, FaRtr>;
export const FAD_128: FaDef = { prio: 100, mt: "delay", excl: ["BLUE"], incl: [], adv: false };
export function faHealthy(): FaCfg {
  const c = {} as FaCfg;
  for (const r of FA_ROUTERS) {
    const ifs: Partial<Record<IfName, FaIf>> = {};
    for (const i of faIfs(r)) ifs[i.ifn] = { isis: true, metric: i.link.metric, delay: i.link.ms * 1000, aff: [...i.link.aff] };
    c[r] = { sr: true, sid: FA_IDX[r], algoSid: { 128: 100 + FA_IDX[r] }, fa: { 128: { ...spClone(FAD_128), adv: r === "R1" } }, ifs };
  }
  return c;
}

// ---------------------------------------------------------------------------------------------------------------
// Derived state
// ---------------------------------------------------------------------------------------------------------------
export interface FaNh {
  nh: FaR;
  ifn: IfName;
  ip: string;
}
export interface FaRoute {
  dst: FaR;
  cost: number;
  nh?: FaNh;
  path: FaR[];
}
export interface FaFad {
  algo: number;
  src: FaR;
  def: FaDef;
}
export interface FaEntry {
  label: number;
  algo: number;
  dst: FaR;
  own?: boolean;
  out?: number | "Pop";
  nh?: FaNh;
  cost?: number;
}
export interface FaView {
  adj: Record<string, boolean>;
  /** Shortest paths per algorithm (0 = default) per router. */
  rib: Record<number, Record<FaR, FaRoute[]>>;
  fad: Record<number, FaFad | undefined>;
  part: Record<number, FaR[]>;
  table: Record<FaR, FaEntry[]>;
  /** Why a router has no entry for a destination in an algorithm. */
  missing: Record<FaR, { algo: number; dst: FaR; why: string }[]>;
  /** Link directions usable in each flex-algorithm topology ("R1>R3"), with the reason for the others. */
  edges: Record<number, Record<string, string | true>>;
  pol: FaPol;
}
export interface FaPol {
  up: boolean;
  labels: number[];
  path?: FaR[];
  why?: string;
}
export const ALGOS = (c: FaCfg) => [...new Set(FA_ROUTERS.flatMap((r) => Object.keys(c[r].fa).map(Number)))].sort((a, b) => a - b);
const adjUp = (c: FaCfg, l: FaLink) => !!c[l.a].ifs[l.ai]?.isis && !!c[l.b].ifs[l.bi]?.isis;
export function electFad(c: FaCfg, algo: number): FaFad | undefined {
  const cands = FA_ROUTERS.filter((r) => c[r].fa[algo]?.adv).map((r) => ({ algo, src: r, def: c[r].fa[algo] }));
  return cands.sort((x, y) => y.def.prio - x.def.prio || FA_IDX[y.src] - FA_IDX[x.src])[0];
}
/** Can the direction u → v be used by this flex-algorithm? (true, or the reason it can't) */
function edgeOk(c: FaCfg, f: FaFad, u: FaR, i: FaIfInfo): true | string {
  const x = c[u].ifs[i.ifn]!;
  const hit = x.aff.find((a) => f.def.excl.includes(a));
  if (hit) return `${u}'s interface toward ${i.peer} has affinity ${hit} (excluded)`;
  if (f.def.incl.length && !x.aff.some((a) => f.def.incl.includes(a))) return `${u}'s interface toward ${i.peer} has none of ${f.def.incl.join(", ")} (include-any)`;
  if (f.def.mt === "delay" && x.delay === undefined) return `${u} advertises no delay toward ${i.peer}`;
  return true;
}
function spf(c: FaCfg, root: FaR, algo: number, fad?: FaFad, part?: FaR[]): FaRoute[] {
  const nodes = algo === 0 ? FA_ROUTERS : part ?? [];
  if (!nodes.includes(root)) return [];
  const d = new Map<FaR, { cost: number; prev?: FaR; first?: FaNh }>([[root, { cost: 0 }]]);
  const done = new Set<FaR>();
  while (true) {
    const u = nodes.filter((r) => !done.has(r) && d.has(r)).sort((a, b) => d.get(a)!.cost - d.get(b)!.cost || FA_IDX[a] - FA_IDX[b])[0];
    if (!u) break;
    done.add(u);
    for (const i of faIfs(u)) {
      if (!adjUp(c, i.link) || !nodes.includes(i.peer)) continue;
      if (algo !== 0 && edgeOk(c, fad!, u, i) !== true) continue;
      const x = c[u].ifs[i.ifn]!;
      const w = algo !== 0 && fad!.def.mt === "delay" ? x.delay! : x.metric;
      const cost = d.get(u)!.cost + w;
      if (!d.has(i.peer) || cost < d.get(i.peer)!.cost) d.set(i.peer, { cost, prev: u, first: u === root ? { nh: i.peer, ifn: i.ifn, ip: i.peerIp } : d.get(u)!.first });
    }
  }
  return nodes.filter((r) => r !== root && d.has(r)).map((r) => {
    const path: FaR[] = [r];
    let x = r;
    while (d.get(x)?.prev) path.unshift((x = d.get(x)!.prev!));
    return { dst: r, cost: d.get(r)!.cost, nh: d.get(r)!.first, path };
  });
}
export const algoLabel = (c: FaCfg, r: FaR, algo: number) => (!c[r].sr ? undefined : algo === 0 ? (c[r].sid === undefined ? undefined : SRGB_START + c[r].sid) : c[r].algoSid[algo] === undefined ? undefined : SRGB_START + c[r].algoSid[algo]);
export function faView(c: FaCfg): FaView {
  const adj: Record<string, boolean> = {};
  for (const l of FA_LINKS) adj[l.id] = adjUp(c, l);
  const algos = [0, ...ALGOS(c)];
  const rib: FaView["rib"] = {};
  const fad: FaView["fad"] = {};
  const part: FaView["part"] = {};
  const edges: FaView["edges"] = {};
  for (const a of algos) {
    if (a !== 0) {
      fad[a] = electFad(c, a);
      part[a] = FA_ROUTERS.filter((r) => c[r].fa[a] && c[r].sr);
      edges[a] = {};
      for (const u of FA_ROUTERS)
        for (const i of faIfs(u)) {
          const k = `${u}>${i.peer}`;
          edges[a][k] = !fad[a] ? "no Flex-Algo Definition is advertised" : !part[a].includes(u) ? `${u} does not participate` : !part[a].includes(i.peer) ? `${i.peer} does not participate` : !adjUp(c, i.link) ? "no IS-IS adjacency" : edgeOk(c, fad[a]!, u, i);
        }
    } else part[a] = [...FA_ROUTERS];
    rib[a] = {} as Record<FaR, FaRoute[]>;
    for (const r of FA_ROUTERS) rib[a][r] = a === 0 || fad[a] ? spf(c, r, a, fad[a], part[a]) : [];
  }
  const table = {} as FaView["table"];
  const missing = {} as FaView["missing"];
  for (const r of FA_ROUTERS) {
    table[r] = [];
    missing[r] = [];
    if (!c[r].sr) continue;
    for (const a of algos)
      for (const d of FA_ROUTERS) {
        const label = algoLabel(c, d, a);
        if (label === undefined) continue;
        if (d === r) {
          table[r].push({ label, algo: a, dst: d, own: true });
          continue;
        }
        if (a !== 0) {
          const why = !fad[a] ? "no Flex-Algo Definition is advertised" : !part[a].includes(r) ? `${r} does not participate in algorithm ${a}` : !part[a].includes(d) ? `${d} does not participate in algorithm ${a}` : undefined;
          if (why) {
            missing[r].push({ algo: a, dst: d, why });
            continue;
          }
        }
        const rt = rib[a][r].find((x) => x.dst === d);
        if (!rt?.nh) {
          missing[r].push({ algo: a, dst: d, why: `no path to ${d} in ${a === 0 ? "algorithm 0" : `algorithm ${a}'s topology`}` });
          continue;
        }
        const nhLabel = algoLabel(c, d, a);
        table[r].push({ label, algo: a, dst: d, nh: rt.nh, cost: rt.cost, out: rt.nh.nh === d ? "Pop" : nhLabel! });
      }
  }
  // Policy LOW-LATENCY on R1
  const ll = algoLabel(c, "R6", 128);
  const e = ll === undefined ? undefined : table.R1.find((x) => x.label === ll);
  const pol: FaPol = e ? { up: true, labels: [ll!], path: rib[128].R1.find((x) => x.dst === "R6")?.path } : { up: false, labels: [], why: ll === undefined ? "R6 advertises no algorithm-128 prefix SID" : missing.R1.find((m) => m.algo === 128 && m.dst === "R6")?.why ?? "no algorithm-128 path to R6" };
  return { adj, rib, fad, part, table, missing, edges, pol };
}
export const faEntry = (v: FaView, r: FaR, label: number) => v.table[r].find((e) => e.label === label);

// ---------------------------------------------------------------------------------------------------------------
// The data plane
// ---------------------------------------------------------------------------------------------------------------
export interface FaHop {
  from: string;
  to: string;
  labels: number[];
  note: string;
}
export interface FaWalk {
  hops: FaHop[];
  ok: boolean;
  path: string[];
  why?: string;
  ms: number;
}
export function faWalk(c: FaCfg, v: FaView, start: FaR, stack0: number[], dst: string): FaWalk {
  const w: FaWalk = { hops: [], ok: false, path: [start], ms: 0 };
  let r: FaR = start;
  let stack = [...stack0];
  const go = (nh: FaNh, note: string) => {
    w.hops.push({ from: r, to: nh.nh, labels: [...stack], note });
    w.ms += faIfTo(r, nh.nh)!.link.ms;
    r = nh.nh;
    w.path.push(r);
  };
  for (let ttl = 0; ttl < 20; ttl++) {
    if (stack.length) {
      const top = stack[0];
      const e = faEntry(v, r, top);
      if (!e) {
        const m = v.missing[r].find((x) => algoLabel(c, x.dst, x.algo) === top);
        w.why = `${r} has no entry for label ${top}${m ? ` (${m.why})` : c[r].sr ? "" : ` (${r} runs no segment routing)`} — dropped`;
        return w;
      }
      if (e.own) {
        stack = stack.slice(1);
        w.hops.push({ from: r, to: r, labels: [...stack], note: `${r}: ${top} is its own SID → pop` });
        continue;
      }
      const alg = e.algo === 0 ? "algorithm 0" : `algorithm ${e.algo}`;
      if (e.out === "Pop") {
        stack = stack.slice(1);
        go(e.nh!, `${r}: ${top} (${alg}) → pop toward ${e.nh!.nh}`);
      } else {
        stack = [e.out as number, ...stack.slice(1)];
        go(e.nh!, `${r}: ${top} (${alg}) → swap ${e.out}, out to ${e.nh!.nh}`);
      }
      continue;
    }
    const h = (Object.keys(FA_HOSTS) as FaHost[]).find((x) => FA_HOSTS[x].ip === dst);
    if (h && FA_HOSTS[h].r === r) {
      w.hops.push({ from: r, to: h, labels: [], note: `${r}: delivered to ${h}` });
      w.path.push(h);
      w.ok = true;
      return w;
    }
    if (faRouterOfLo(dst) === r) {
      w.ok = true;
      return w;
    }
    w.why = `${r} has no route to ${dst} (the core runs no BGP) — dropped`;
    return w;
  }
  w.why = "TTL expired";
  return w;
}
/** What R1 pushes for a customer destination behind R6. */
export function steer(c: FaCfg, v: FaView, h: FaHost): { labels: number[]; via: string; why?: string } {
  const host = FA_HOSTS[h];
  if (host.color === LL_COLOR) {
    if (v.pol.up) return { labels: v.pol.labels, via: "policy LOW-LATENCY (color 128)" };
    const l0 = algoLabel(c, "R6", 0);
    return { labels: l0 === undefined ? [] : [l0], via: "R6's algorithm-0 Node SID (policy LOW-LATENCY is down)", why: v.pol.why };
  }
  const l0 = algoLabel(c, "R6", 0);
  return { labels: l0 === undefined ? [] : [l0], via: "R6's algorithm-0 Node SID" };
}

// ---------------------------------------------------------------------------------------------------------------
// State and actions
// ---------------------------------------------------------------------------------------------------------------
export interface FaSnap {
  view: FaView;
}
export interface FaTest {
  id: number;
  kind: "ping" | "probe";
  from: string;
  dst: string;
  ok: boolean;
  path: string[];
  why?: string;
  ms: number;
  stack: number[];
  via: string;
  cfgSeq: number;
  t: number;
}
export interface FaSys {
  t: number;
  dev: FaR;
  kind: "commit" | "adj-up" | "adj-down" | "fad";
  peer?: string;
}
export interface FaState extends SpBase<FaSnap> {
  cfg: FaCfg;
  hist: Record<FaR, FaRtr[]>;
  view: FaView;
  sys: FaSys[];
  tests: FaTest[];
  wiped?: boolean;
}
export type FaTicketId = "participation" | "nofad" | "fadconflict" | "sid" | "affinity";
export type FaAction =
  | { type: "cfg"; dev: FaR; cfg: FaRtr; text: string }
  | { type: "set"; changes: { dev: FaR; f: (c: FaRtr) => void }[]; text: string }
  | { type: "ping"; to: FaHost }
  | { type: "probe"; stack: number[] }
  | { type: "ticket"; id: FaTicketId }
  | { type: "wipe-r6" };

const cl = (o: FaState): FaState => ({ ...spClone(o), runs: o.runs, last: o.last });
export function createFaNet(seq = 0): FaState {
  const cfg = faHealthy();
  const view = faView(cfg);
  const s: FaState = { seq, cfgSeq: 0, clock: 3600, runs: [], log: [{ seq, t: 3600, text: "IS-IS with SR-MPLS is up. Every router participates in Flex-Algo 128; R1 advertises its definition (delay metric, exclude BLUE). Policy LOW-LATENCY on R1 is up with [16106].", tone: "info" }], cfg, hist: Object.fromEntries(FA_ROUTERS.map((r) => [r, []])) as unknown as Record<FaR, FaRtr[]>, view, sys: [], tests: [] };
  for (const l of FA_LINKS) s.sys.push({ t: 15, dev: l.a, kind: "adj-up", peer: l.b }, { t: 15, dev: l.b, kind: "adj-up", peer: l.a });
  return s;
}
const tone = (labels: number[]) => (labels.some((l) => l >= 16100) ? "violet" : labels.length ? "cyan" : "green");
function record(s: FaState, w: FaWalk, kind: "ping" | "probe", from: string, dst: string, stack: number[], via: string, cmd: string, pre: string[]) {
  const snap = { view: s.view };
  const moments: SpMoment<FaSnap>[] = pre.map((t) => ({ tokens: [], lines: [{ text: t, tone: "info" as const }], snap }));
  for (const h of w.hops) moments.push({ tokens: h.from !== h.to ? [{ from: h.from, to: h.to, label: h.labels.length ? h.labels.join(" | ") : "IP", color: tone(h.labels) }] : [], lines: [{ text: h.note, tone: h.labels.length ? "learn" : "info" }], snap });
  if (w.why) moments.push({ tokens: [], lines: [{ text: w.why, tone: "warn" }], snap });
  moments.push({ tokens: [], lines: [{ text: w.ok ? `${cmd}: success — ${w.path.join(" → ")}, one-way latency ${w.ms} ms.` : `${cmd}: failed — ${w.why}`, tone: w.ok ? "ok" : "bad" }], snap });
  const t: FaTest = { id: s.tests.length + 1, kind, from, dst, ok: w.ok, path: w.path, why: w.why, ms: w.ms, stack, via, cfgSeq: s.cfgSeq, t: s.clock };
  s.tests = [...s.tests, t].slice(-40);
  const run: SpRun<FaSnap> = { id: s.runs.length + 1 + s.seq * 1000, cmd, kind: "test", moments, ok: w.ok };
  s.runs = [...s.runs, run];
  s.last = run;
  s.log = [...s.log, { seq: s.seq, t: s.clock, text: `${cmd}: ${w.ok ? `success, ${w.ms} ms` : w.why}`, tone: w.ok ? "ok" : "warn" }];
  return s;
}
export function faPing(s0: FaState, to: FaHost): FaState {
  const s = cl(s0);
  s.clock += 2;
  const st = steer(s.cfg, s.view, to);
  const w = faWalk(s.cfg, s.view, "R1", st.labels, FA_HOSTS[to].ip);
  w.hops.unshift({ from: "H1", to: "R1", labels: [], note: `H1 sends to ${FA_HOSTS[to].ip}` });
  w.path.unshift("H1");
  if (w.hops[1]) w.hops[1].note = `R1: ${FA_HOSTS[to].net}/24 → ${st.via}: push [${st.labels.join(", ")}] — ${w.hops[1].note.replace(/^R1: /, "")}`;
  return record(s, w, "ping", "H1", FA_HOSTS[to].ip, st.labels, st.via, `ping ${FA_HOSTS[to].ip} from H1`, st.why ? [`R1: policy LOW-LATENCY is down — ${st.why}. The colored route falls back to R6's algorithm-0 Node SID.`] : []);
}
export function faProbe(s0: FaState, stack: number[]): FaState {
  const s = cl(s0);
  s.clock += 2;
  const w = faWalk(s.cfg, s.view, "R1", stack, FA_LO.R6);
  return record(s, w, "probe", "R1", FA_LO.R6, stack, "a label stack", `R1 → 10.0.0.6 with [${stack.join(", ")}]`, []);
}
function converge(prev: FaState, s: FaState, why: string, show = true): FaState {
  const view = faView(s.cfg);
  s.view = view;
  const snap = { view };
  const lines: { text: string; tone: "ok" | "bad" | "learn" | "info" }[] = [];
  for (const l of FA_LINKS)
    if (prev.view.adj[l.id] !== view.adj[l.id]) {
      lines.push({ text: `IS-IS ${l.a}–${l.b} ${view.adj[l.id] ? "Up" : "down"}.`, tone: view.adj[l.id] ? "ok" : "bad" });
      s.sys.push({ t: s.clock, dev: l.a, kind: view.adj[l.id] ? "adj-up" : "adj-down", peer: l.b }, { t: s.clock, dev: l.b, kind: view.adj[l.id] ? "adj-up" : "adj-down", peer: l.a });
    }
  for (const a of new Set([...Object.keys(prev.view.fad), ...Object.keys(view.fad)].map(Number))) {
    const x = prev.view.fad[a];
    const y = view.fad[a];
    const k = (f?: FaFad) => (f ? `${f.src}:${f.def.prio}:${f.def.mt}:${f.def.excl}:${f.def.incl}` : "");
    if (k(x) !== k(y)) {
      lines.push({ text: y ? `Flex-Algo ${a}: definition from ${y.src} (priority ${y.def.prio}, metric ${y.def.mt}${y.def.excl.length ? `, exclude ${y.def.excl.join(", ")}` : ""}${y.def.incl.length ? `, include ${y.def.incl.join(", ")}` : ""}).` : `Flex-Algo ${a}: no definition is advertised — the algorithm is unusable.`, tone: y ? "learn" : "bad" });
      for (const r of FA_ROUTERS) s.sys.push({ t: s.clock, dev: r, kind: "fad", peer: String(a) });
    }
  }
  for (const a of Object.keys(view.part).map(Number).filter((x) => x !== 0)) {
    const p0 = prev.view.rib[a]?.R1.find((x) => x.dst === "R6")?.path.join("→") ?? "";
    const p1 = view.rib[a].R1.find((x) => x.dst === "R6")?.path.join("→") ?? "";
    if (p0 !== p1) lines.push({ text: `R1 → R6 in algorithm ${a}: ${p1 || "no path"}.`, tone: p1 ? "learn" : "bad" });
  }
  if (prev.view.pol.up !== view.pol.up) lines.push({ text: `R1: policy LOW-LATENCY ${view.pol.up ? "up — [16106]" : `down — ${view.pol.why}`}.`, tone: view.pol.up ? "ok" : "bad" });
  if (show && lines.length) {
    const run: SpRun<FaSnap> = { id: s.runs.length + 1 + s.seq * 1000, cmd: why, kind: "converge", moments: [{ tokens: [], lines: lines.slice(0, 10), snap }] };
    s.runs = [...s.runs, run];
    s.last = run;
  }
  return s;
}

// ---------------------------------------------------------------------------------------------------------------
// Tickets
// ---------------------------------------------------------------------------------------------------------------
export interface FaTicketDef {
  id: FaTicketId;
  title: string;
  report: string;
  reproLabel: string;
  repro: FaAction[];
  fault: (c: FaCfg) => void;
}
const pingLL: FaAction = { type: "ping", to: "H66" };
export const FA_TICKETS: FaTicketDef[] = [
  {
    id: "participation",
    title: "The trading app is slow again",
    report: "“Since this morning the low-latency app (H66) sees about 90 ms instead of 15. Ordinary traffic is fine, all links are up. R3 had a software upgrade overnight.”",
    reproLabel: "ping 192.168.66.20 from H1",
    repro: [pingLL],
    fault: (c) => {
      delete c.R3.fa[128];
    },
  },
  {
    id: "nofad",
    title: "Nothing is low-latency anymore",
    report: "“The low-latency app went to 90 ms after the change on R1 that ‘cleaned up the IS-IS template’. Every router still has flex-algo 128 configured — we checked.”",
    reproLabel: "ping 192.168.66.20 from H1",
    repro: [pingLL],
    fault: (c) => {
      c.R1.fa[128].adv = false;
    },
  },
  {
    id: "fadconflict",
    title: "Low-latency, but the long way",
    report: "“Policy LOW-LATENCY is up and pushes 16106, yet H66 sees 90 ms. Someone tested flex-algo on R6 last week.”",
    reproLabel: "ping 192.168.66.20 from H1",
    repro: [pingLL],
    fault: (c) => {
      c.R6.fa[128] = { prio: 200, mt: "igp", excl: [], incl: [], adv: true };
    },
  },
  {
    id: "sid",
    title: "After R6 was replaced",
    report: "“R6 was swapped for new hardware. Ordinary traffic works; the low-latency app is back on the slow path. The flex-algo section on R6 looks complete.”",
    reproLabel: "ping 192.168.66.20 from H1",
    repro: [pingLL],
    fault: (c) => {
      delete c.R6.algoSid[128];
    },
  },
  {
    id: "affinity",
    title: "A template applied to R1",
    report: "“A new interface template was pushed to R1 to tag the top links. Since then the low-latency app takes 90 ms.”",
    reproLabel: "ping 192.168.66.20 from H1",
    repro: [pingLL],
    fault: (c) => {
      c.R1.ifs["ge-0/0/1"]!.aff = ["BLUE"];
    },
  },
];
export const faTicket = (id: string) => FA_TICKETS.find((t) => t.id === id)!;
export function faTicketState(id: FaTicketId, seq = 0): FaState {
  const s = createFaNet(seq);
  const nx = cl(s);
  faTicket(id).fault(nx.cfg);
  const out = converge(s, nx, "", false);
  out.ticket = id;
  out.runs = [];
  out.last = undefined;
  out.log = [...out.log, { seq, t: out.clock, text: `Ticket opened: ${faTicket(id).title}.`, tone: "warn" }];
  return out;
}
export function faApply(s0: FaState, a: FaAction): FaState {
  switch (a.type) {
    case "cfg": {
      const s = cl(s0);
      s.hist[a.dev] = [spClone(s0.cfg[a.dev]), ...s.hist[a.dev]].slice(0, 20);
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
    case "wipe-r6": {
      const s = cl(s0);
      delete s.cfg.R6.fa[128];
      delete s.cfg.R6.algoSid[128];
      s.wiped = true;
      s.cfgSeq += 1;
      s.clock += 1;
      s.log = [...s.log, { seq: s.seq, t: s.clock, text: "R6: flex-algo 128 and its algorithm-128 prefix SID removed — rebuild them from its console.", tone: "warn" }];
      return converge(s0, s, "R6: Flex-Algo wiped");
    }
    case "ping":
      return faPing(s0, a.to);
    case "probe":
      return faProbe(s0, a.stack);
    case "ticket":
      return faTicketState(a.id, s0.seq + 1);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Diagnosis, proofs, ladder
// ---------------------------------------------------------------------------------------------------------------
export const FA_CAUSES: { id: string; label: string }[] = [
  { id: "participation", label: "A router on the low-latency path doesn't participate in Flex-Algo 128" },
  { id: "nofad", label: "No router advertises the Flex-Algo 128 definition" },
  { id: "fadconflict", label: "Another definition with a higher priority won the election" },
  { id: "sid", label: "R6 advertises no algorithm-128 prefix SID" },
  { id: "affinity", label: "A link on the low-latency path carries an excluded affinity" },
  { id: "policy", label: "Policy LOW-LATENCY's preference is too low" },
  { id: "delay", label: "The delay measurement is wrong on the bottom links" },
];
const lastLL = (s: FaState) => s.tests.filter((t) => t.kind === "ping" && t.dst === FA_HOSTS.H66.ip).at(-1);
export function faCauseFeedback(s: FaState, cause: string): { right: boolean; text: string } {
  const t = s.ticket as FaTicketId | undefined;
  if (cause === t) {
    const txt: Record<FaTicketId, string> = {
      participation: "Yes. R3 lost `flex-algo 128` in the upgrade. A router that doesn't participate is removed from the algorithm's topology — and every way from R1 to R6 that avoids BLUE goes through R3. R1 has no algorithm-128 path, policy LOW-LATENCY goes down, and the colored route falls back to R6's algorithm-0 SID over the BLUE top: 90 ms.",
      nofad: "Yes. R1 was the only router with `advertise-definition`. Without an advertised definition nobody knows what algorithm 128 means — participation alone isn't enough — so no router computes it, R1 has no 16106, and the app falls back to algorithm 0.",
      fadconflict: "Yes. R6 still advertises its test definition — priority 200, IGP metric, no exclusion — and the highest priority wins. Every router now computes algorithm 128 with the IGP metric over all links: the top path. Policy LOW-LATENCY is up, 16106 is pushed, and it follows the definition faithfully — the wrong one.",
      sid: "Yes. R6's new configuration has `flex-algo 128` but no `prefix-sid algorithm 128 index 106` on Loopback0. The algorithm topology is fine, but there is no label that means “R6 via algorithm 128”: policy LOW-LATENCY has nothing to resolve to and goes down.",
      affinity: "Yes. The template tagged R1's interface toward R3 with `affinity flex-algo BLUE`. Algorithm 128 excludes BLUE, so R1 can't leave on its bottom link — and its top link is BLUE too. No algorithm-128 path from R1, policy down, fallback to 90 ms.",
    };
    return { right: true, text: txt[t] };
  }
  switch (cause) {
    case "policy":
      return { right: false, text: "Policy LOW-LATENCY has a single candidate path; its preference compares with nothing. Look at why its path is valid or not." };
    case "delay":
      return { right: false, text: "Every bottom link advertises 5 ms (show performance-measurement interfaces). The measurement isn't the problem." };
    case "participation":
      return { right: false, text: s.view.part[128]?.length === 6 ? "All six routers participate in Flex-Algo 128." : "Participation is complete on the path that matters." };
    case "nofad":
      return { right: false, text: s.view.fad[128] ? `A definition is advertised — by ${s.view.fad[128].src}.` : "Check show isis flex-algo 128." };
    case "fadconflict":
      return { right: false, text: s.view.fad[128]?.src === "R1" ? "The winning definition is R1's (delay, exclude BLUE) — no competing definition." : "Check which definition won." };
    case "sid":
      return { right: false, text: s.cfg.R6.algoSid[128] !== undefined ? "R6 advertises index 106 for algorithm 128 (label 16106)." : "Check R6's prefix SIDs." };
    case "affinity":
      return { right: false, text: "The affinities on the bottom path are GOLD only." };
  }
  return { right: false, text: lastLL(s) ? "That doesn't match the evidence." : "Ping the low-latency app first." };
}
export function faProofs(s: FaState): { label: string; ok: boolean; detail: string }[] {
  const t = s.ticket as FaTicketId | undefined;
  if (!t) return [];
  const p = s.tests.filter((x) => x.cfgSeq === s.cfgSeq && x.kind === "ping" && x.dst === FA_HOSTS.H66.ip).at(-1);
  const fast = { label: "A fresh ping to H66: via [16106] on the bottom path, ~15 ms", ok: !!p?.ok && p.stack.join() === "16106" && p.ms <= 15, detail: "ping 192.168.66.20 again after the fix" };
  const pol = { label: "Policy LOW-LATENCY is up on R1", ok: s.view.pol.up, detail: "show segment-routing traffic-eng policy on R1" };
  switch (t) {
    case "participation":
      return [{ label: "R3 participates in Flex-Algo 128", ok: s.view.part[128]?.includes("R3") ?? false, detail: "show isis flex-algo 128 on R3" }, pol, fast];
    case "nofad":
      return [{ label: "A Flex-Algo 128 definition is advertised", ok: !!s.view.fad[128], detail: "show isis flex-algo 128" }, pol, fast];
    case "fadconflict":
      return [{ label: "The winning definition is delay, exclude BLUE", ok: s.view.fad[128]?.def.mt === "delay" && !!s.view.fad[128]?.def.excl.includes("BLUE"), detail: "show isis flex-algo 128" }, fast];
    case "sid":
      return [{ label: "R6 advertises its algorithm-128 prefix SID (16106)", ok: s.cfg.R6.algoSid[128] === 106, detail: "show isis segment-routing label table on R1" }, pol, fast];
    case "affinity":
      return [{ label: "R1's interface toward R3 carries no excluded affinity", ok: !s.cfg.R1.ifs["ge-0/0/1"]!.aff.includes("BLUE"), detail: "show running-config router isis on R1" }, pol, fast];
  }
}
export function faLadder(s: FaState): { k: string; title: string; text: string }[] {
  const v = s.view;
  const t = lastLL(s);
  const f = v.fad[128];
  const p128 = v.part[128] ?? [];
  const r16106 = v.table.R1.find((e) => e.label === 16106);
  return [
    { k: "symptom", title: "What does the low-latency app see?", text: t ? `${t.ok ? `delivered in ${t.ms} ms` : `lost — ${t.why}`} via ${t.via}, path ${t.path.join(" → ")}.` : "Ping 192.168.66.20 first." },
    { k: "policy", title: "Is policy LOW-LATENCY up on R1?", text: v.pol.up ? `Yes: [${v.pol.labels.join(", ")}].` : `No: ${v.pol.why}.` },
    { k: "fad", title: "Which Flex-Algo 128 definition won?", text: f ? `${f.src}'s: priority ${f.def.prio}, metric ${f.def.mt}${f.def.excl.length ? `, exclude-any ${f.def.excl.join(", ")}` : ", no exclusion"}${f.def.incl.length ? `, include-any ${f.def.incl.join(", ")}` : ""}.` : "None is advertised — the algorithm is unusable." },
    { k: "part", title: "Who participates?", text: `${p128.join(", ") || "nobody"}${p128.length < 6 ? ` — not ${FA_ROUTERS.filter((r) => !p128.includes(r)).join(", ")}` : ""}.` },
    { k: "sid", title: "Does R6 advertise an algorithm-128 prefix SID?", text: s.cfg.R6.algoSid[128] !== undefined ? `Yes: index ${s.cfg.R6.algoSid[128]} → ${16000 + s.cfg.R6.algoSid[128]}.` : "No." },
    { k: "path", title: "Does R1 have an algorithm-128 path and label for R6?", text: r16106 ? `Yes: 16106 → ${r16106.nh!.nh}, path ${v.rib[128].R1.find((x) => x.dst === "R6")?.path.join(" → ")}.` : `No: ${v.missing.R1.find((m) => m.algo === 128 && m.dst === "R6")?.why ?? "no algorithm-128 label for R6"}.` },
  ];
}
