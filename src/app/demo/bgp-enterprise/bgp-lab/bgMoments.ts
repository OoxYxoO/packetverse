import { isRouter, type BgDecision, type BgDev, type BgPkt, type BgRun, type BgRx } from "@/lib/sim-engine/scenarios/bgpNet";

/** A run as the BGP Lab plays it: one moment per wave (one hop of a packet, or one step of the UPDATE exchange). */
export interface BgMarker {
  from: BgDev;
  to: BgDev;
  pkt: BgPkt;
}
export interface BgMoment {
  k: number;
  markers: BgMarker[];
  decisions: BgDecision[];
  rx: BgRx[];
  lines: { text: string; tone: "info" | "ok" | "bad" | "learn" }[];
}
export const BG_MOMENT_MS = 1250;
export const BG_TRAVEL_MS = 820;
export function bgMoments(run: BgRun | undefined): BgMoment[] {
  if (!run) return [];
  return run.waves
    .filter((w) => w.hops.length || w.decisions.length || w.rx.length)
    .map((w) => {
      const lines: BgMoment["lines"] = [];
      for (const d of w.decisions) lines.push(decisionLine(d));
      for (const r of w.rx) lines.push({ text: r.why, tone: r.ok ? (r.pkt.kind === "update" ? "learn" : "ok") : r.pkt.kind === "update" ? "info" : "bad" });
      return { k: w.k, markers: w.hops.map((h) => ({ from: h.from, to: h.to, pkt: h.pkt })), decisions: w.decisions, rx: w.rx, lines };
    });
}
export function decisionLine(d: BgDecision): BgMoment["lines"][number] {
  if (d.drop) return { text: `${d.r}: DROPPED ${d.pkt.dst} — ${d.drop}`, tone: "bad" };
  const rt = d.route!;
  if (rt.proto !== "B") return { text: `${d.r}: ${d.pkt.dst} is on a connected network → delivered there`, tone: "info" };
  const p = rt.path!;
  return { text: `${d.r}: ${d.pkt.dst} → BGP route ${rt.prefix} [${rt.ad}] via ${rt.nh} · AS_PATH ${p.asPath.join(" ") || "(own)"} · LOCAL_PREF ${p.localPref} · TTL ${d.pkt.ttl}`, tone: "info" };
}
export function markerLabel(m: BgMarker, compact: boolean): string {
  const p = m.pkt;
  if (p.kind === "update") return (compact ? `${p.upd!.prefixes[0].split("/")[0].split(".").slice(-2).join(".")}` : `UPDATE ${p.upd!.prefixes[0]} · ${p.upd!.asPath.join(" ") || "—"}`).replace(/ /g, " ");
  const what = p.kind === "echo" ? "ping" : "reply";
  return (compact ? what : `${what} → ${p.dst.split(".").slice(-2).join(".")} · TTL ${p.ttl}`).replace(/ /g, " ");
}
export function markerColor(m: BgMarker): string {
  if (m.pkt.kind === "update") return m.pkt.upd!.prefixes[0].startsWith("203.") ? "#f59e0b" : "#a78bfa";
  return m.pkt.kind === "echo" ? "#22d3ee" : "#34d399";
}
export function fateOf(m: BgMoment, mk: BgMarker): { text: string; tone: "ok" | "bad" | "muted" } | undefined {
  const r = m.rx.find((x) => x.dev === mk.to && x.pkt.id === mk.pkt.id);
  if (r) return r.ok ? { text: mk.pkt.kind === "update" ? "✓ best" : "✓", tone: "ok" } : { text: mk.pkt.kind === "update" ? "– kept / dropped" : "✕", tone: mk.pkt.kind === "update" ? "muted" : "bad" };
  if (isRouter(mk.to)) {
    const d = m.decisions.find((x) => x.r === mk.to && x.pkt.id === mk.pkt.id);
    if (d?.drop) return { text: "✕ dropped", tone: "bad" };
  }
  return undefined;
}
