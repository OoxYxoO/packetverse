"use client";

import { clsx } from "clsx";
import type { CliVendor } from "@/lib/cli/types";
import { GraphTopologyViewer, type GraphNode } from "@/components/network/GraphTopologyViewer";
import { LabPacketOverlay, type LabPacketView } from "@/components/practice-lab/LabTopology";
import { ASN, BG_HOSTS, BG_ROUTERS, BG_SESSIONS, HOST_IP, LAN, ROUTER_OF, SESSIONS, type BgDev, type BgNet } from "@/lib/sim-engine/scenarios/bgpNet";
import { BG_TRAVEL_MS, fateOf, markerColor, markerLabel, type BgMoment } from "./bgMoments";

/**
 * The BGP Lab on the shared practice-lab stage: three autonomous systems drawn as regions, every BGP session as a line
 * (cyan Established · red dotted Active/Idle · grey link down), and the enterprise's current exit (where R1 and R2
 * send internet traffic) and entry (how AS65030 comes back) written under the network.
 */
type P = { x: number; y: number };
const POS: Record<string, P> = { R5: { x: 50, y: 17 }, SRV: { x: 78, y: 17 }, R3: { x: 22, y: 45 }, R4: { x: 78, y: 45 }, R1: { x: 22, y: 72 }, R2: { x: 78, y: 72 }, H1: { x: 7, y: 86 }, H2: { x: 93, y: 86 } };
const COMPACT: Record<string, P> = { R5: { x: 48, y: 14 }, SRV: { x: 84, y: 14 }, R3: { x: 18, y: 42 }, R4: { x: 82, y: 42 }, R1: { x: 18, y: 68 }, R2: { x: 82, y: 68 }, H1: { x: 10, y: 86 }, H2: { x: 90, y: 86 } };
const TONE = { ok: "bg-pv-success/15 text-pv-success", warn: "bg-pv-warning/20 text-pv-warning", bad: "bg-pv-danger/20 text-pv-danger", muted: "bg-black/40 text-pv-text-faint" } as const;
export function BgTopology({ s, moment, prev, runKey, cursor, compact, onNode, selected }: { s: BgNet; moment?: BgMoment; prev?: BgMoment; runKey: string; cursor: number; compact: boolean; onNode?: (d: BgDev) => void; selected?: BgDev; vendor: CliVendor }) {
  const pos = compact ? COMPACT : POS;
  const label: Record<string, string> = { R1: "R1", R2: "R2", R3: compact ? "ISP-A" : "R3 ISP-A", R4: compact ? "ISP-B" : "R4 ISP-B", R5: compact ? "R5" : "R5" };
  const nodes: GraphNode[] = [...BG_ROUTERS.map((r) => ({ id: r, label: label[r], subLabel: compact ? undefined : `AS${ASN[r]}`, kind: "router" as const, ...pos[r] })), ...BG_HOSTS.map((h) => ({ id: h, label: h, subLabel: compact ? undefined : HOST_IP[h], kind: (h === "SRV" ? "server" : "laptop") as "server" | "laptop", ...pos[h] }))];
  const at = (id: string) => nodes.find((n) => n.id === id)!;
  const lines: { a: P; b: P; color: string; dash?: string; w: number; key: string }[] = [];
  const tags: { x: number; y: number; text: string; tone: keyof typeof TONE; key: string }[] = [];
  for (const x of BG_SESSIONS) {
    const { a, b, link, type } = SESSIONS[x];
    const st = s.view.sess[x];
    const up = s.cfg.links[link];
    lines.push({ a: at(a), b: at(b), color: !up ? "#2b3348" : st.state === "Established" ? (type === "iBGP" ? "#a78bfa" : "#22d3ee") : "#f87171", dash: !up ? "3 5" : st.state === "Established" ? undefined : "2 3", w: st.state === "Established" ? 3 : 2, key: x });
    if (!compact && (st.state !== "Established" || type === "iBGP")) tags.push({ x: (at(a).x + at(b).x) / 2, y: (at(a).y + at(b).y) / 2 - 3, text: `${type} ${up ? st.state : "link down"}`, tone: st.state === "Established" ? "muted" : "bad", key: `t${x}` });
  }
  for (const h of BG_HOSTS) lines.push({ a: at(ROUTER_OF[h]), b: at(h), color: "#34d399", w: 2, key: h });
  // Exit / entry summary.
  const exitR2 = s.view.paths.R2.find((p) => p.prefix === LAN.R5.prefix && p.best);
  const entry = s.view.paths.R5.find((p) => p.prefix === LAN.R1.prefix && p.best);
  const packets: LabPacketView[] = [];
  const track: GraphNode[] = [];
  moment?.markers.forEach((mk, i) => {
    const a = at(mk.from);
    const b = at(mk.to);
    if (!a || !b) return;
    track.push({ id: `t${i}a`, label: "", x: a.x + (b.x - a.x) * 0.2, y: a.y + (b.y - a.y) * 0.2 }, { id: `t${i}b`, label: "", x: b.x - (b.x - a.x) * 0.2, y: b.y - (b.y - a.y) * 0.2 });
    packets.push({ id: `${runKey}:${cursor}:${i}`, path: [`t${i}a`, `t${i}b`], hop: 0, done: false, label: markerLabel(mk, compact), color: markerColor(mk), description: `${markerLabel(mk, false)}: ${mk.from} → ${mk.to}` });
  });
  if (prev)
    prev.markers.forEach((mk, i) => {
      const f = fateOf(prev, mk);
      if (!f) return;
      packets.push({ id: `${runKey}:${cursor}:f${i}`, path: [mk.to, mk.to], hop: 0, done: true, label: f.text.replace(/ /g, " "), color: f.tone === "ok" ? "#10b981" : f.tone === "bad" ? "#f87171" : "#64748b", offset: { dx: 0, dy: (at(mk.to)?.y ?? 50) > 60 ? -13 : 13 }, description: `${mk.to}: ${f.text}` });
    });
  const active = [...new Set(moment?.markers.flatMap((m) => [m.from, m.to]) ?? [])];
  return (
    <div className="relative h-full">
      <GraphTopologyViewer
        nodes={nodes}
        edges={[]}
        regions={compact ? [] : [{ id: "e", label: "AS65001 · enterprise", x: 2, y: 60, width: 96, height: 37, tone: "cyan" }, { id: "d", label: "AS65030", x: 38, y: 4, width: 50, height: 26, tone: "warning" }]}
        activeNodeIds={active}
        selectedNodeIds={selected ? [selected] : []}
        onNodeClick={onNode ? (id) => onNode(id as BgDev) : undefined}
        className="h-full"
      >
        <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
          {lines.map((l) => (
            <line key={l.key} x1={l.a.x} y1={l.a.y} x2={l.b.x} y2={l.b.y} stroke={l.color} strokeWidth={l.w} strokeDasharray={l.dash} opacity={0.85} vectorEffect="non-scaling-stroke" strokeLinecap="round" />
          ))}
        </svg>
        {tags.map((t) => (
          <span key={t.key} className={clsx("pointer-events-none absolute z-[5] -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded px-1 py-px pv-mono text-[9.5px] font-bold sm:text-[10px]", TONE[t.tone])} style={{ left: `${t.x}%`, top: `${t.y}%` }}>
            {t.text}
          </span>
        ))}
        {!compact && (
          <span className="pointer-events-none absolute left-2 top-2 z-[5] flex max-w-[34%] flex-col rounded bg-black/55 px-2 py-0.5 pv-mono text-[10px] leading-snug text-pv-text-muted">
            <span>exit (R2 → internet):</span> <b className={exitR2?.from === "R1" ? "text-pv-success" : "text-pv-warning"}>{exitR2 ? (exitR2.from === "R1" ? "via R1 → ISP-A" : exitR2.from === "R4" ? "via ISP-B" : String(exitR2.from)) : "none"}</b>
            <span>entry (AS65030 → us):</span> <b className={entry?.from === "R3" ? "text-pv-success" : "text-pv-warning"}>{entry ? (entry.from === "R3" ? "via ISP-A" : "via ISP-B") : "none"}</b>
          </span>
        )}
        {packets.map((p) => (
          <LabPacketOverlay key={p.id} nodes={[...nodes, ...track]} packet={p} segmentMs={BG_TRAVEL_MS} lift={0} />
        ))}
      </GraphTopologyViewer>
    </div>
  );
}
