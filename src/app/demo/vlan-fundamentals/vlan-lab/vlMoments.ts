import { BCAST, isSw, vlMacName, vlShortMac, type VlCfg, type VlDecision, type VlDev, type VlFrame, type VlRun, type VlRx, type VlSnap } from "@/lib/sim-engine/scenarios/vlanNet";

/**
 * A run as the VLAN Lab plays it: one moment per wave (every frame crossing a link at the same time moves together),
 * each carrying the tables as they were once its frames had arrived. A marker shows what is on the wire — including
 * the 802.1Q tag (or its absence) on that very link, so the same frame visibly gains a tag on the trunk and loses it on
 * the access port.
 */

export interface VlMarker {
  from: VlDev;
  to: VlDev;
  fromPort: string;
  toPort: string;
  frame: VlFrame;
  /** The tag on this link (undefined = untagged). */
  vid?: number;
  /** The VLAN the sending switch forwarded it in. */
  vlan?: number;
  flooded: boolean;
}
export interface VlMoment {
  k: number;
  markers: VlMarker[];
  decisions: VlDecision[];
  rx: VlRx[];
  lines: { text: string; tone: "info" | "ok" | "bad" | "learn" }[];
  snap: VlSnap;
}
export const VL_MOMENT_MS = 1250;
export const VL_TRAVEL_MS = 820;

export function vlMoments(run: VlRun | undefined, cfg: VlCfg): VlMoment[] {
  if (!run) return [];
  return run.waves.map((w, i) => {
    const prev = run.waves[i - 1];
    const markers: VlMarker[] = w.hops.map((h) => {
      const d = isSw(h.from) ? prev?.decisions.find((x) => x.sw === h.from && x.frame.id === h.frame.id && x.out.some((o) => o.port === h.fromPort)) : undefined;
      return { from: h.from, to: h.to, fromPort: h.fromPort, toPort: h.toPort, frame: h.frame, vid: h.vid, vlan: h.vlan, flooded: !!d && (d.kind === "broadcast" || d.kind === "unknown") };
    });
    const lines: VlMoment["lines"] = [];
    for (const n of w.notes) lines.push({ text: n.text, tone: n.tone });
    for (const d of w.decisions) lines.push(decisionLine(cfg, d));
    for (const r of w.rx) lines.push({ text: rxLine(r), tone: r.accepted && !/no answer|dropped|ignored/.test(r.why) ? "ok" : r.accepted ? "info" : /VID|untagged|TAGGED/.test(r.why) ? "bad" : "info" });
    return { k: w.k, markers, decisions: w.decisions, rx: w.rx, lines, snap: w.snap };
  });
}

const tagWords = (vid?: number) => (vid === undefined ? "untagged" : `tagged VID ${vid}`);
export function decisionLine(cfg: VlCfg, d: VlDecision): VlMoment["lines"][number] {
  const arrived = `${d.sw} (in on ${d.port}, ${tagWords(d.tagIn)})`;
  if (d.drop) return { text: `${arrived}: DROPPED — ${d.drop}`, tone: "bad" };
  const why = d.how === "access" ? `access port → VLAN ${d.vlan}` : d.how === "native" ? `untagged on a trunk → its native VLAN ${d.vlan}` : `tag → VLAN ${d.vlan}`;
  const src = vlMacName(cfg, d.frame.src);
  const learn = d.learn === "learned" ? `learns ${src} in VLAN ${d.vlan} → ${d.port}` : d.learn === "moved" ? `MOVES ${src} (VLAN ${d.vlan}): ${d.movedFrom} → ${d.port}` : `already knows ${src} in VLAN ${d.vlan}`;
  const dst = d.frame.dst === BCAST ? "broadcast" : vlMacName(cfg, d.frame.dst);
  const outs = d.out.map((o) => `${o.port} (${tagWords(o.vid)})`).join(", ");
  const pruned = d.pruned.length ? ` · not on ${d.pruned.join(", ")} (doesn't carry VLAN ${d.vlan})` : "";
  const look =
    d.kind === "broadcast"
      ? `broadcast → floods VLAN ${d.vlan} only: ${outs || "no other port is in VLAN " + d.vlan}`
      : d.kind === "unknown"
        ? `${dst} not in VLAN ${d.vlan}'s table → floods VLAN ${d.vlan}: ${outs || "nowhere — no other port is in VLAN " + d.vlan}`
        : d.kind === "known"
          ? `${dst} → ${outs}`
          : d.kind === "filter"
            ? `${dst} is behind the port it came in on → filtered`
            : `${dst} → ${d.hit}, which doesn't carry VLAN ${d.vlan} now → dropped`;
  return { text: `${arrived}: ${why} · ${learn} · ${look}${pruned}`, tone: d.kind === "known" ? "info" : d.out.length === 0 ? "bad" : d.learn === "learned" ? "learn" : "info" };
}
function rxLine(r: VlRx): string {
  const where = r.dev === "R1" ? `R1${r.unit !== undefined ? ` (.${r.unit})` : ""}` : r.dev;
  return `${where}: ${r.why}`;
}

/** Marker text: what the frame is, and its tag on this link. */
export function markerLabel(m: VlMarker, compact: boolean): string {
  const f = m.frame;
  const what = f.kind === "arp-req" ? (compact ? "ARP?" : "ARP who-has") : f.kind === "arp-rep" ? (compact ? "ARP" : "ARP reply") : f.kind === "echo" ? (compact ? "ping" : `ping → ${f.dip.split(".").slice(-2).join(".")}`) : compact ? "rep" : "ping reply";
  const tag = m.vid === undefined ? (compact ? "" : " · untagged") : ` · VID ${m.vid}`;
  return `${what}${tag}`.replace(/ /g, " ");
}
/** Marker color: the VLAN it is in (or its kind when it has none yet). */
export function markerColor(m: VlMarker): string {
  const v = m.vlan ?? m.vid;
  if (v === 10) return "#22d3ee";
  if (v === 20) return "#a78bfa";
  if (v === 1) return "#f87171";
  return m.frame.kind.startsWith("arp") ? "#f59e0b" : "#34d399";
}
export const VLAN_COLOR: Record<number, string> = { 1: "#94a3b8", 10: "#22d3ee", 20: "#a78bfa", 30: "#f59e0b" };
export const vlanColor = (v?: number) => (v === undefined ? "#94a3b8" : (VLAN_COLOR[v] ?? "#f59e0b"));
/** What a frame's arrival meant, shown at the device for one moment. */
export function fateOf(m: VlMoment, mk: VlMarker): { text: string; tone: "ok" | "bad" | "muted" } | undefined {
  if (!isSw(mk.to)) {
    const r = m.rx.find((x) => x.dev === mk.to && x.frame.id === mk.frame.id);
    if (!r) return undefined;
    if (!r.accepted) return /TAGGED|VID|untagged/.test(r.why) ? { text: "✕ dropped", tone: "bad" } : { text: "✕ not mine", tone: "muted" };
    return /no answer|ignored/.test(r.why) ? { text: "– not for me", tone: "muted" } : { text: "✓ accepted", tone: "ok" };
  }
  const d = m.decisions.find((x) => x.sw === mk.to && x.frame.id === mk.frame.id && x.port === mk.toPort);
  if (d?.drop) return { text: "✕ dropped", tone: "bad" };
  if (d && d.out.length === 0 && d.kind !== "filter") return { text: "✕ nowhere to go", tone: "bad" };
  return undefined;
}
export const shortMac = vlShortMac;
