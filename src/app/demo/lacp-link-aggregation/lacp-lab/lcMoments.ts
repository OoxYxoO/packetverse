import { BCAST, isSw, lcMacName, type LcDecision, type LcDev, type LcFrame, type LcRun, type LcRx, type LcSnap } from "@/lib/sim-engine/scenarios/lacpNet";

/**
 * A run as the LACP Lab plays it: one moment per wave. A marker between the switches rides the MEMBER cable the hash
 * picked, so two flows visibly take two different cables of one bundle.
 */
export interface LcMarker {
  from: LcDev;
  to: LcDev;
  fromPort: string;
  toPort: string;
  frame: LcFrame;
}
export interface LcMoment {
  k: number;
  markers: LcMarker[];
  decisions: LcDecision[];
  rx: LcRx[];
  lines: { text: string; tone: "info" | "ok" | "bad" | "learn" }[];
  snap: LcSnap;
}
export const LC_MOMENT_MS = 1250;
export const LC_TRAVEL_MS = 820;
export function lcMoments(run: LcRun | undefined): LcMoment[] {
  if (!run) return [];
  return run.waves.map((w) => {
    const lines: LcMoment["lines"] = [];
    for (const d of w.decisions) lines.push(decisionLine(d));
    for (const r of w.rx) lines.push({ text: r.why, tone: r.ok ? (r.frame.kind === "lacpdu" ? "learn" : "ok") : "info" });
    return { k: w.k, markers: w.hops.map((h) => ({ from: h.from, to: h.to, fromPort: h.fromPort, toPort: h.toPort, frame: h.frame })), decisions: w.decisions, rx: w.rx, lines, snap: w.snap };
  });
}
export function decisionLine(d: LcDecision): LcMoment["lines"][number] {
  const where = `${d.sw} (in on ${d.port}${d.logical !== d.port ? ` = ${d.logical}` : ""})`;
  if (d.drop) return { text: `${where}: DROPPED — ${d.drop}`, tone: "bad" };
  const src = lcMacName(d.frame.src);
  const learn = d.learn === "learned" ? `learns ${src} → ${d.logical}` : d.learn === "moved" ? `MOVES ${src} → ${d.logical}` : `knows ${src}`;
  const outs = d.out.map((o) => (o.logical !== o.member ? `${o.logical} via ${o.member}${o.hash ? ` [hash ${o.hash}]` : ""}` : o.logical)).join(", ");
  const dst = d.frame.dst === BCAST ? "broadcast" : lcMacName(d.frame.dst);
  const look = d.kind === "broadcast" ? `broadcast → ${outs || "nowhere"}` : d.kind === "unknown" ? `${dst} unknown → floods ${outs || "nowhere"}` : d.kind === "known" ? `${dst} → ${outs || "a port that isn't forwarding"}` : `${dst} is behind the port it came in on → filtered`;
  return { text: `${where}: ${learn} · ${look}`, tone: d.kind === "known" ? "info" : "learn" };
}
export function markerLabel(m: LcMarker, compact: boolean): string {
  const f = m.frame;
  if (f.kind === "lacpdu") return compact ? "LACP" : "LACPDU";
  const flow = f.flow ? f.flow.replace("-", "→") : "";
  const what = f.kind === "arp-req" ? (compact ? "ARP?" : "ARP who-has") : f.kind === "arp-rep" ? "ARP" : f.kind === "echo" ? "ping" : compact ? "rep" : "reply";
  return `${what}${compact || !flow ? "" : ` .${flow.replace("→", "→.")}`}`.replace(/ /g, " ");
}
const FLOW_COLORS = ["#22d3ee", "#f59e0b", "#a78bfa", "#34d399"];
export function markerColor(m: LcMarker): string {
  if (m.frame.kind === "lacpdu") return "#a78bfa";
  const [a, b] = (m.frame.flow ?? "0-0").split("-").map(Number);
  return FLOW_COLORS[(Math.min(a, b) + Math.max(a, b)) % FLOW_COLORS.length];
}
export function fateOf(m: LcMoment, mk: LcMarker): { text: string; tone: "ok" | "bad" | "muted" } | undefined {
  if (!isSw(mk.to)) {
    const r = m.rx.find((x) => x.dev === mk.to && x.frame.id === mk.frame.id);
    if (!r) return undefined;
    return r.ok ? { text: "✓ accepted", tone: "ok" } : { text: "– not mine", tone: "muted" };
  }
  const d = m.decisions.find((x) => x.sw === mk.to && x.frame.id === mk.frame.id && x.port === mk.toPort);
  if (d?.drop) return { text: "✕ dropped", tone: "bad" };
  const r = m.rx.find((x) => x.dev === mk.to && x.frame.id === mk.frame.id);
  if (r) return r.ok ? { text: "✓ in sync", tone: "ok" } : { text: "✕ ignored", tone: "bad" };
  return undefined;
}
