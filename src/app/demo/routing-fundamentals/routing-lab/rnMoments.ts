import { isRouter, kindName, routeKeyOf, type RnCfg, type RnDecision, type RnHop, type RnPkt, type RnRun, type RnSnap } from "@/lib/sim-engine/scenarios/routeNet";

/**
 * A test as the lab plays it: one moment per step of the simulation. In a moment, every device that holds a packet
 * decides (a router: its own lookup) and the packets it forwards cross the link. A packet bouncing in a routing loop
 * for dozens of hops is shown as its first laps, one "… N more hops" moment, and its last laps.
 */

export interface RnMoment {
  hops: RnHop[];
  decisions: RnDecision[];
  snap: RnSnap;
  lines: { text: string; tone: "info" | "ok" | "bad" | "route" }[];
  /** A compressed stretch of a loop. */
  skipped?: { hops: number; ttlFrom: number; ttlTo: number };
}
export const RN_MOMENT_MS = 1250;
export const RN_TRAVEL_MS = 820;

export function rnMoments(run: RnRun | undefined, cfg: RnCfg): RnMoment[] {
  if (!run) return [];
  const ms: RnMoment[] = run.moments.map((m) => ({ hops: m.hops, decisions: m.decisions, snap: m.snap, lines: m.decisions.map((d) => ({ text: d.text, tone: tone(d) })) }));
  if (ms.length <= 18) return ms;
  const head = ms.slice(0, 7);
  const tail = ms.slice(-7);
  const mid = ms.slice(7, -7);
  const ttls = mid.flatMap((m) => m.hops.map((h) => h.pkt.ttl));
  const skip: RnMoment = { hops: [], decisions: [], snap: mid[mid.length - 1].snap, lines: [{ text: `… ${mid.length} more hops of the same bounce: TTL ${Math.max(...ttls)} → ${Math.min(...ttls)}. Each router keeps choosing the other one.`, tone: "bad" }], skipped: { hops: mid.length, ttlFrom: Math.max(...ttls), ttlTo: Math.min(...ttls) } };
  void cfg;
  return [...head, skip, ...tail];
}
const tone = (d: RnDecision): RnMoment["lines"][number]["tone"] => (d.outcome === "forward" ? (isRouter(d.at) ? "route" : "info") : d.outcome === "deliver" || d.outcome === "local" ? "ok" : "bad");
export const pktLabel = (p: RnPkt, compact: boolean) => {
  const base = p.kind === "echo" ? "echo" : p.kind === "reply" ? "reply" : p.kind === "time-exceeded" ? "TTL exceeded" : p.kind === "net-unreach" ? "net unreach" : "host unreach";
  return compact ? base.split(" ")[0] : base;
};
export const pktColor = (p: RnPkt) => (p.kind === "echo" ? "#38bdf8" : p.kind === "reply" ? "#34d399" : "#f87171");
export const decisionShort = (d: RnDecision) =>
  d.outcome === "forward" && d.lookup?.winner ? `${routeKeyOf(d.lookup.winner)} → ${d.egress}` : d.outcome === "discard" ? "discard ✕" : d.outcome === "no-route" ? "no route ✕" : d.outcome === "arp-fail" ? `ARP ${d.nextHop}? ✕` : d.outcome === "ttl" ? "TTL 0 ✕" : d.outcome === "local" ? "mine ✓" : d.outcome === "deliver" ? "received ✓" : "";
export { kindName };
