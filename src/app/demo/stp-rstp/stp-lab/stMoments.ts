import { BCAST, bidName, isSw, stMacName, type StDecision, type StDev, type StFrame, type StRun, type StRx, type StSnap } from "@/lib/sim-engine/scenarios/stpNet";

/**
 * A run as the STP Lab plays it: one moment per wave (every frame crossing a link at the same time moves together),
 * with the tables as they were once those frames had arrived. Copies of one frame on one link are drawn once, with
 * their count — so a loop shows as the same markers coming round again and again.
 */

export interface StMarker {
  from: StDev;
  to: StDev;
  fromPort: string;
  toPort: string;
  frame: StFrame;
  n: number;
}
export interface StMoment {
  k: number;
  markers: StMarker[];
  decisions: StDecision[];
  rx: StRx[];
  lines: { text: string; tone: "info" | "ok" | "bad" | "learn" }[];
  snap: StSnap;
}
export const ST_MOMENT_MS = 1250;
export const ST_TRAVEL_MS = 820;

export function stMoments(run: StRun | undefined): StMoment[] {
  if (!run) return [];
  return run.waves.map((w) => {
    const lines: StMoment["lines"] = [];
    for (const n of w.notes) lines.push({ text: n.text, tone: n.tone });
    for (const d of w.decisions) lines.push(decisionLine(d));
    for (const r of w.rx) lines.push({ text: r.why, tone: r.ok ? (r.frame.kind === "bpdu" ? "learn" : "ok") : "info" });
    return { k: w.k, markers: w.hops.map((h) => ({ from: h.from, to: h.to, fromPort: h.fromPort, toPort: h.toPort, frame: h.frame, n: h.n })), decisions: w.decisions, rx: w.rx, lines, snap: w.snap };
  });
}
const times = (n: number) => (n > 1 ? ` (×${n.toLocaleString("en-US")})` : "");
export function decisionLine(d: StDecision): StMoment["lines"][number] {
  const src = stMacName(d.frame.src);
  if (d.drop) return { text: `${d.sw} (in on ${d.port})${times(d.n)}: DROPPED — ${d.drop}${d.learn === "learning-only" ? ` · learns ${src}` : ""}`, tone: "bad" };
  const learn = d.learn === "learned" ? `learns ${src} → ${d.port}` : d.learn === "moved" ? `MOVES ${src}: ${d.movedFrom} → ${d.port}` : `already knows ${src}`;
  const dst = d.frame.dst === BCAST ? "broadcast" : stMacName(d.frame.dst);
  const look = d.kind === "broadcast" ? `broadcast → floods its forwarding ports: ${d.out.join(", ") || "none"}` : d.kind === "unknown" ? `${dst} unknown → floods ${d.out.join(", ") || "nowhere"}` : d.kind === "known" ? `${dst} → ${d.out.join(", ") || "a port that isn't forwarding (dropped)"}` : `${dst} is behind the port it came in on → filtered`;
  return { text: `${d.sw} (in on ${d.port})${times(d.n)}: ${learn} · ${look}`, tone: d.learn === "moved" ? "bad" : d.kind === "known" ? "info" : "learn" };
}
export function markerLabel(m: StMarker, compact: boolean): string {
  const f = m.frame;
  const what = f.kind === "bpdu" ? (compact ? `R:${bidName(f.bpdu!.root).replace("ROGUE", "RG")}` : `BPDU root ${bidName(f.bpdu!.root)} · ${f.bpdu!.cost}`) : f.kind === "arp-req" ? (compact ? "ARP?" : "ARP who-has") : f.kind === "arp-rep" ? "ARP" : f.kind === "echo" ? "ping" : compact ? "rep" : "reply";
  return `${what}${m.n > 1 ? ` ×${m.n > 999 ? `${Math.round(m.n / 1000)}k` : m.n}` : ""}`.replace(/ /g, " ");
}
export function markerColor(m: StMarker): string {
  if (m.frame.kind === "bpdu") return m.frame.bpdu!.root.mac.endsWith("99") ? "#f87171" : "#a78bfa";
  if (m.n > 1) return "#f87171";
  return m.frame.kind.startsWith("arp") ? "#f59e0b" : "#22d3ee";
}
export function fateOf(m: StMoment, mk: StMarker): { text: string; tone: "ok" | "bad" | "muted" } | undefined {
  if (!isSw(mk.to)) {
    const r = m.rx.find((x) => x.dev === mk.to && x.frame.id === mk.frame.id);
    if (!r) return undefined;
    return r.ok ? { text: mk.frame.kind === "bpdu" ? "✓ processed" : "✓ accepted", tone: "ok" } : { text: "– ignored", tone: "muted" };
  }
  const d = m.decisions.find((x) => x.sw === mk.to && x.frame.id === mk.frame.id && x.port === mk.toPort);
  if (d?.drop) return { text: "✕ discarded", tone: "bad" };
  const r = m.rx.find((x) => x.dev === mk.to && x.frame.id === mk.frame.id);
  if (r) return r.ok ? { text: "✓ BPDU", tone: "ok" } : { text: "✕ ignored", tone: "bad" };
  return undefined;
}
