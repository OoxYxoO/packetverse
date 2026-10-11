import type { SdDecision, SdDev, SdPkt, SdRun, SdRx } from "@/lib/sim-engine/scenarios/sdNet";

/** A run as the SD-WAN Lab plays it: one moment per wave. */
export interface SdMarker {
  from: SdDev;
  to: SdDev;
  pkt: SdPkt;
}
export interface SdMoment {
  k: number;
  markers: SdMarker[];
  decisions: SdDecision[];
  rx: SdRx[];
  lines: { text: string; tone: "info" | "ok" | "bad" | "learn" }[];
}
export const SD_MOMENT_MS = 1150;
export const SD_TRAVEL_MS = 760;
export function sdMoments(run: SdRun | undefined): SdMoment[] {
  if (!run) return [];
  return run.waves
    .filter((w) => w.hops.length || w.decisions.length || w.rx.length)
    .map((w) => {
      const lines: SdMoment["lines"] = [];
      for (const d of w.decisions) if (d.text || d.drop) lines.push({ text: `${d.dev}: ${d.drop ? `${d.text ? `${d.text} · ` : ""}DROPPED — ${d.drop}` : d.text}`, tone: d.drop ? "bad" : /SLA FAIL|not eligible|DOWN/.test(d.text) ? "bad" : /→ TUN-|eligible/.test(d.text) ? "learn" : "info" });
      for (const r of w.rx) lines.push({ text: r.why, tone: r.ok ? "ok" : "bad" });
      return { k: w.k, markers: w.hops.map((h) => ({ from: h.from, to: h.to, pkt: h.pkt })), decisions: w.decisions, rx: w.rx, lines };
    });
}
export function markerLabel(m: SdMarker, compact: boolean): string {
  const p = m.pkt;
  const t = p.kind === "probe" ? (p.reply ? "probe reply" : "probe") : p.kind === "voice" ? "voice" : "bulk";
  return (compact ? t : `${t}${p.tun ? ` · ${p.tun}` : ""}`).replace(/ /g, " ");
}
export const markerColor = (m: SdMarker) => (m.pkt.kind === "probe" ? "#f472b6" : m.pkt.kind === "voice" ? "#fbbf24" : "#34d399");
export function fateOf(m: SdMoment, mk: SdMarker): { text: string; tone: "ok" | "bad" | "muted" } | undefined {
  const r = m.rx.find((x) => x.dev === mk.to && x.pkt.id === mk.pkt.id);
  if (r) return r.ok ? { text: "✓", tone: "ok" } : { text: "✕", tone: "bad" };
  return undefined;
}
