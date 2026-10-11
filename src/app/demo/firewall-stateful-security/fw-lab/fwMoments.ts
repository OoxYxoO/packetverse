import { pktText, type FwDecision, type FwDev, type FwPkt, type FwRun, type FwRx } from "@/lib/sim-engine/scenarios/fwNet";

/** A run as the Firewall Lab plays it: one moment per wave (one hop of one packet). */
export interface FwMarker {
  from: FwDev;
  to: FwDev;
  pkt: FwPkt;
}
export interface FwMoment {
  k: number;
  markers: FwMarker[];
  decisions: FwDecision[];
  rx: FwRx[];
  lines: { text: string; tone: "info" | "ok" | "bad" | "learn" }[];
}
export const FW_MOMENT_MS = 1150;
export const FW_TRAVEL_MS = 760;
export function fwMoments(run: FwRun | undefined): FwMoment[] {
  if (!run) return [];
  return run.waves
    .filter((w) => w.hops.length || w.decisions.length || w.rx.length)
    .map((w) => {
      const lines: FwMoment["lines"] = [];
      for (const d of w.decisions) for (const st of d.stages) lines.push({ text: `${d.dev}: ${st.text}`, tone: st.k === "drop" ? "bad" : !st.ok ? "bad" : st.k === "session" && /matches session/.test(st.text) ? "learn" : "info" });
      for (const r of w.rx) lines.push({ text: r.why, tone: r.ok ? "ok" : "bad" });
      return { k: w.k, markers: w.hops.map((h) => ({ from: h.from, to: h.to, pkt: h.pkt })), decisions: w.decisions, rx: w.rx, lines };
    });
}
export function markerLabel(m: FwMarker, compact: boolean): string {
  const p = m.pkt;
  const what = p.proto === "icmp" ? (p.icmp === "echo" ? "ping" : "reply") : p.flags!;
  return (compact ? what : `${what} ${p.src}${p.proto === "tcp" ? `:${p.sport}` : ""} → ${p.dst}${p.proto === "tcp" ? `:${p.dport}` : ""}`).replace(/ /g, " ");
}
export function markerColor(m: FwMarker): string {
  const p = m.pkt;
  if (p.proto === "icmp") return p.icmp === "echo" ? "#22d3ee" : "#34d399";
  return p.flags === "SYN" ? "#22d3ee" : p.flags === "SYN-ACK" ? "#34d399" : p.flags === "RST" ? "#f87171" : "#a78bfa";
}
export function fateOf(m: FwMoment, mk: FwMarker): { text: string; tone: "ok" | "bad" | "muted" } | undefined {
  const r = m.rx.find((x) => x.dev === mk.to && x.pkt.id === mk.pkt.id);
  if (r) return r.ok ? { text: "✓", tone: "ok" } : { text: "✕", tone: "bad" };
  const d = m.decisions.find((x) => x.dev === mk.to && x.pkt.id === mk.pkt.id);
  if (d?.drop) return { text: "✕ dropped", tone: "bad" };
  return undefined;
}
export const decisionText = (d: FwDecision) => `${d.dev} ← ${pktText(d.pkt)}${d.drop ? ` — DROPPED: ${d.drop}` : ""}`;
