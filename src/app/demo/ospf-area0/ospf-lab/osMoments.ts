import { isRouter, routeText, type OsDecision, type OsDev, type OsPkt, type OsRun, type OsRx } from "@/lib/sim-engine/scenarios/ospfNet";

/** A run as the OSPF Lab plays it: one moment per wave (one hop of one packet, or one round of Hellos / one flood step). */
export interface OsMarker {
  from: OsDev;
  to: OsDev;
  pkt: OsPkt;
}
export interface OsMoment {
  k: number;
  markers: OsMarker[];
  decisions: OsDecision[];
  rx: OsRx[];
  lines: { text: string; tone: "info" | "ok" | "bad" | "learn" }[];
}
export const OS_MOMENT_MS = 1150;
export const OS_TRAVEL_MS = 780;
export function osMoments(run: OsRun | undefined): OsMoment[] {
  if (!run) return [];
  return run.waves
    .filter((w) => w.hops.length || w.decisions.length || w.rx.length)
    .map((w) => {
      const lines: OsMoment["lines"] = [];
      for (const d of w.decisions) lines.push(decisionLine(d));
      for (const r of w.rx) lines.push({ text: r.why, tone: r.ok ? (r.pkt.kind === "hello" || r.pkt.kind === "lsu" ? "learn" : "ok") : "bad" });
      return { k: w.k, markers: w.hops.map((h) => ({ from: h.from, to: h.to, pkt: h.pkt })), decisions: w.decisions, rx: w.rx, lines };
    });
}
export function decisionLine(d: OsDecision): OsMoment["lines"][number] {
  if (d.drop) return { text: `${d.r}: DROPPED ${d.pkt.dst} — ${d.drop}`, tone: "bad" };
  const rt = d.route!;
  const how = rt.proto === "O" ? `OSPF route ${routeText(rt)} [110/${rt.metric}]` : rt.proto === "S" ? `STATIC route ${routeText(rt)} [1/0]` : `connected ${routeText(rt)}`;
  return { text: `${d.r}: ${d.pkt.dst} → ${how} → ${d.outIf}${d.nh ? ` (next hop ${d.nh})` : ""}${d.ecmp ? ` · ${d.ecmp}` : ""} · TTL ${d.pkt.ttl}`, tone: rt.proto === "S" ? "bad" : "info" };
}
export function markerLabel(m: OsMarker, compact: boolean): string {
  const p = m.pkt;
  if (p.kind === "hello") return compact ? "Hello" : `Hello ${p.info?.rid} · area ${p.info?.area}`;
  if (p.kind === "lsu") return compact ? "LSU" : `LSU: ${p.info?.origin}'s LSA`;
  const what = p.kind === "echo" ? "ping" : p.kind === "echo-rep" ? "reply" : "ttl!";
  return (compact ? what : `${what} → ${p.dst.split(".").slice(-2).join(".")} · TTL ${p.ttl}`).replace(/ /g, " ");
}
export function markerColor(m: OsMarker): string {
  if (m.pkt.kind === "hello") return "#a78bfa";
  if (m.pkt.kind === "lsu") return "#f59e0b";
  return m.pkt.kind === "echo" ? "#22d3ee" : "#34d399";
}
export function fateOf(m: OsMoment, mk: OsMarker): { text: string; tone: "ok" | "bad" | "muted" } | undefined {
  const r = m.rx.find((x) => x.dev === mk.to && x.pkt.id === mk.pkt.id);
  if (r) return r.ok ? { text: mk.pkt.kind === "hello" ? "✓ neighbor" : mk.pkt.kind === "lsu" ? "✓ installed" : "✓", tone: "ok" } : { text: "✕", tone: "bad" };
  if (isRouter(mk.to)) {
    const d = m.decisions.find((x) => x.r === mk.to && x.pkt.id === mk.pkt.id);
    if (d?.drop) return { text: "✕ dropped", tone: "bad" };
  }
  return undefined;
}
