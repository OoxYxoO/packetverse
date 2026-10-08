import { BCAST, isSw, snMacName, snShortMac, type SnCfg, type SnDecision, type SnDev, type SnFrame, type SnHop, type SnHost, type SnRun, type SnRx, type SnSnap, type SnSw } from "@/lib/sim-engine/scenarios/switchNet";

/**
 * A run as the lab plays it: one moment per wave (every copy crossing a link at the same time moves together), each
 * carrying both tables as they were once its copies had arrived — so the topology, the tables, the counters and the
 * captures all agree with the frames on the wire. What a switch decided is shown on the switch's own table card the
 * moment the copy lands there.
 */

export interface SnMarker {
  from: SnDev;
  to: SnDev;
  fromPort: string;
  toPort: string;
  frame: SnFrame;
  n: number;
  /** The copy left its switch because of a flood (broadcast or unknown destination). */
  flooded: boolean;
}
export interface SnMoment {
  k: number;
  markers: SnMarker[];
  decisions: SnDecision[];
  rx: SnRx[];
  lines: { text: string; tone: "info" | "ok" | "bad" | "learn" }[];
  snap: SnSnap;
}
export const SN_MOMENT_MS = 1150;
export const SN_TRAVEL_MS = 780;

export function snMoments(run: SnRun | undefined, cfg: SnCfg): SnMoment[] {
  if (!run) return [];
  return run.waves.map((w, i) => {
    const prev = run.waves[i - 1];
    const markers: SnMarker[] = w.hops.map((h: SnHop) => {
      const d = isSw(h.from) ? prev?.decisions.find((x) => x.sw === h.from && x.frame.id === h.frame.id && x.out.includes(h.fromPort as never)) : undefined;
      return { from: h.from, to: h.to, fromPort: h.fromPort, toPort: h.toPort, frame: h.frame, n: h.n, flooded: !!d && (d.kind === "broadcast" || d.kind === "unknown") };
    });
    const lines: SnMoment["lines"] = [];
    for (const f of w.sent) lines.push({ text: `${f.from} sends ${frameWords(cfg, f)} — source ${snShortMac(f.src)}, destination ${f.dst === BCAST ? "FF:FF:FF:FF:FF:FF" : snShortMac(f.dst)}`, tone: "info" });
    for (const d of w.decisions) lines.push(...decisionLines(cfg, d));
    for (const r of w.rx) lines.push({ text: rxLine(cfg, r), tone: r.accepted && !r.wrongHost ? "ok" : r.wrongHost ? "bad" : "info" });
    return { k: w.k, markers, decisions: w.decisions, rx: w.rx, lines: compress(lines), snap: w.snap };
  });
}
/** In a storm the same sentence repeats: say it once with a count. */
function compress(lines: SnMoment["lines"]): SnMoment["lines"] {
  const out: (SnMoment["lines"][number] & { n: number })[] = [];
  for (const l of lines) {
    const p = out.find((x) => x.text === l.text);
    if (p) p.n++;
    else out.push({ ...l, n: 1 });
  }
  return out.map((l) => ({ text: l.n > 1 ? `${l.text} (×${l.n})` : l.text, tone: l.tone }));
}

export function frameWords(cfg: SnCfg, f: SnFrame): string {
  if (f.kind === "arp-req") return `a broadcast (ARP: who has ${f.target}'s IP?)`;
  if (f.kind === "arp-rep") return `an ARP reply to ${snMacName(cfg, f.dst)}`;
  if (f.kind === "data-rep") return `a ping reply to ${snMacName(cfg, f.dst)}`;
  return `${f.wantReply ? "a ping" : "a frame"} to ${f.target}`;
}
export const kindWords: Record<SnDecision["kind"], string> = { broadcast: "broadcast → flood", unknown: "unknown → flood", known: "known → forward", filter: "known on the ingress port → filter", blackhole: "known, but that port is down → dropped" };
export function decisionLines(cfg: SnCfg, d: SnDecision): SnMoment["lines"] {
  const src = snMacName(cfg, d.frame.src);
  const dst = d.frame.dst === BCAST ? "FF:FF:FF:FF:FF:FF" : snMacName(cfg, d.frame.dst);
  const learn =
    d.learn === "learned" ? `learns ${src} → ${d.port}` : d.learn === "moved" ? `MOVES ${src}: ${d.movedFrom} → ${d.port}` : d.learn === "refreshed" ? `already knows ${src} on ${d.port}` : `${src} has a static entry: nothing learned`;
  const look =
    d.kind === "broadcast"
      ? `destination is broadcast → floods out ${d.out.join(", ") || "nothing"}`
      : d.kind === "unknown"
        ? `${dst} is NOT in its table → floods out ${d.out.join(", ") || "nothing"}`
        : d.kind === "known"
          ? `${dst} → ${d.hit!.port}${d.hit!.type === "static" ? " (static)" : ""} → forwards out that one port`
          : d.kind === "filter"
            ? `${dst} → ${d.hit!.port}, the port it came in on → filters (sends nothing)`
            : `${dst} → ${d.hit!.port}, which is down → the frame is dropped`;
  return [{ text: `${d.sw} (in on ${d.port}${d.n > 1 ? `, ×${d.n}` : ""}): ${learn} · ${look}`, tone: d.learn === "moved" || d.kind === "filter" || d.kind === "blackhole" ? "bad" : d.learn === "learned" ? "learn" : "info" }];
}
function rxLine(cfg: SnCfg, r: SnRx): string {
  const dst = r.frame.dst === BCAST ? "broadcast" : snMacName(cfg, r.frame.dst);
  if (r.wrongHost) return `${r.host} accepts it — the destination MAC is its own MAC — but the packet is for ${r.frame.target}: the wrong host got it`;
  if (!r.accepted) return `${r.host} discards it: destination ${dst} is not ${r.host}`;
  return `${r.host} accepts ${r.frame.dst === BCAST ? "the broadcast" : "it"}${r.n > 1 ? ` (${r.n} copies at once)` : ""}`;
}

/** Marker text: what the frame is, for whom. */
export function markerLabel(cfg: SnCfg, m: SnMarker, compact: boolean): string {
  const f = m.frame;
  const to = f.dst === BCAST ? "" : snMacName(cfg, f.dst).replace("HOST-", "");
  const base = f.kind === "arp-req" ? (compact ? "BC" : "broadcast") : f.kind === "arp-rep" ? (compact ? `→${to}` : `ARP reply → ${to}`) : f.kind === "data-rep" ? (compact ? `→${to}` : `reply → ${to}`) : compact ? `→${to}` : `to ${to}`;
  return `${base}${m.flooded && f.dst !== BCAST && !compact ? " · flood" : ""}${m.n > 1 ? ` ×${m.n > 999 ? `${Math.round(m.n / 1000)}k` : m.n}` : ""}`.replace(/ /g, " ");
}
export const markerColor = (f: SnFrame) => (f.kind === "arp-req" ? "#f59e0b" : f.kind === "arp-rep" ? "#a78bfa" : f.kind === "data-rep" ? "#34d399" : "#38bdf8");
/** What a copy's arrival meant, shown at the device for one moment. */
export function fateOf(m: SnMoment, mk: SnMarker): { text: string; tone: "ok" | "bad" | "muted" } | undefined {
  if (!isSw(mk.to)) {
    const r = m.rx.find((x) => x.host === mk.to && x.frame.id === mk.frame.id);
    if (!r) return undefined;
    return r.wrongHost ? { text: "✓ wrong host!", tone: "bad" } : r.accepted ? { text: r.n > 1 ? `✓ ×${r.n}` : "✓ accepted", tone: "ok" } : { text: "✕ discarded", tone: "muted" };
  }
  const d = m.decisions.find((x) => x.sw === mk.to && x.frame.id === mk.frame.id && x.port === mk.toPort);
  if (d?.kind === "filter") return { text: "✕ filtered", tone: "bad" };
  if (d?.kind === "blackhole") return { text: "✕ port down", tone: "bad" };
  return undefined;
}
export const SN_HOST_LETTER = (h: SnHost) => h.slice(-1);
export type { SnSw };
