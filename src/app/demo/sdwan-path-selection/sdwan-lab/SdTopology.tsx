"use client";

import { clsx } from "clsx";
import type { CliVendor } from "@/lib/cli/types";
import { GraphTopologyViewer, type GraphNode } from "@/components/network/GraphTopologyViewer";
import { LabPacketOverlay, type LabPacketView } from "@/components/practice-lab/LabTopology";
import { SD_IP, SD_TUNS, TUN, selectPath, type SdDev, type SdNet, type SdTun } from "@/lib/sim-engine/scenarios/sdNet";
import { SD_TRAVEL_MS, fateOf, markerColor, markerLabel, type SdMoment } from "./sdMoments";

/**
 * The SD-WAN Lab on the shared practice-lab stage: the branch edge, two ISPs with their overlay tunnels to the hub,
 * each path colored by its state (green eligible · amber reachable but not SLA-eligible · red down) with its last
 * measurement, and which path VOICE and BULK currently use.
 */
type P = { x: number; y: number };
const POS: Record<string, P> = { CLIENT: { x: 6, y: 50 }, BRANCH: { x: 26, y: 50 }, "ISP-A": { x: 50, y: 22 }, "ISP-B": { x: 50, y: 78 }, HUB: { x: 74, y: 50 }, APP: { x: 94, y: 50 } };
const COMPACT: Record<string, P> = { CLIENT: { x: 11, y: 20 }, BRANCH: { x: 24, y: 52 }, "ISP-A": { x: 50, y: 20 }, "ISP-B": { x: 50, y: 84 }, HUB: { x: 76, y: 52 }, APP: { x: 89, y: 20 } };
const stateTone = (s: SdNet, t: SdTun) => (s.paths[t].quality === "down" ? "#f87171" : s.paths[t].eligible ? "#34d399" : "#f59e0b");
export function SdTopology({ s, moment, prev, runKey, cursor, compact, onNode, selected }: { s: SdNet; moment?: SdMoment; prev?: SdMoment; runKey: string; cursor: number; compact: boolean; onNode?: (d: SdDev) => void; selected?: SdDev; vendor: CliVendor }) {
  const pos = compact ? COMPACT : POS;
  const sub: Record<string, string> = { CLIENT: SD_IP.client, BRANCH: "branch edge", "ISP-A": TUN["TUN-A"].color, "ISP-B": TUN["TUN-B"].color, HUB: "hub edge", APP: SD_IP.app };
  const kind: Record<string, GraphNode["kind"]> = { CLIENT: "laptop", BRANCH: "router", "ISP-A": "cloud", "ISP-B": "cloud", HUB: "router", APP: "server" };
  const nodes: GraphNode[] = Object.keys(POS).map((id) => ({ id, label: id, subLabel: compact ? undefined : sub[id], kind: kind[id], ...pos[id] }));
  const at = (id: string) => nodes.find((n) => n.id === id)!;
  const voice = selectPath(s.cfg, s.paths, "VOICE");
  const bulk = selectPath(s.cfg, s.paths, "BULK");
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
      packets.push({ id: `${runKey}:${cursor}:f${i}`, path: [mk.to, mk.to], hop: 0, done: true, label: f.text, color: f.tone === "ok" ? "#10b981" : "#f87171", offset: { dx: 0, dy: 14 }, description: `${mk.to}: ${f.text}` });
    });
  moment?.decisions.filter((d) => d.drop).forEach((d, i) => packets.push({ id: `${runKey}:${cursor}:d${i}`, path: [d.dev, d.dev], hop: 0, done: true, label: "✕ dropped", color: "#f87171", offset: { dx: 0, dy: -14 }, description: `${d.dev}: ${d.drop}` }));
  const active = [...new Set([...(moment?.markers.flatMap((m) => [m.from, m.to]) ?? []), ...(moment?.decisions.map((d) => d.dev) ?? [])])];
  const lines: { a: string; b: string; c: string; w: number; dash?: string; key: string }[] = [
    { a: "CLIENT", b: "BRANCH", c: "#22d3ee", w: 2.5, key: "c" },
    { a: "HUB", b: "APP", c: "#a78bfa", w: 2.5, key: "h" },
    ...SD_TUNS.flatMap((t) => [
      { a: "BRANCH", b: TUN[t].isp, c: stateTone(s, t), w: 3, dash: s.paths[t].quality === "down" ? "3 5" : undefined, key: `${t}1` },
      { a: TUN[t].isp, b: "HUB", c: stateTone(s, t), w: 3, dash: s.paths[t].quality === "down" ? "3 5" : undefined, key: `${t}2` },
    ]),
  ];
  return (
    <div className="relative h-full">
      <GraphTopologyViewer nodes={nodes} edges={[]} regions={compact ? [] : [{ id: "br", label: "branch", x: 1, y: 30, width: 34, height: 40, tone: "cyan" }, { id: "hub", label: "hub / data center", x: 65, y: 30, width: 34, height: 40, tone: "violet" }]} activeNodeIds={active} selectedNodeIds={selected ? [selected] : []} onNodeClick={onNode ? (id) => onNode(id as SdDev) : undefined} className="h-full">
        <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
          {lines.map((l) => (
            <line key={l.key} x1={at(l.a).x} y1={at(l.a).y} x2={at(l.b).x} y2={at(l.b).y} stroke={l.c} strokeWidth={l.w} strokeDasharray={l.dash} opacity={0.85} vectorEffect="non-scaling-stroke" strokeLinecap="round" />
          ))}
        </svg>
        {!compact &&
          SD_TUNS.map((t) => (
            <span key={t} className={clsx("pointer-events-none absolute z-[5] -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded px-1.5 py-px pv-mono text-[9.5px] font-bold sm:text-[10px]", s.paths[t].quality === "down" ? "bg-pv-danger/20 text-pv-danger" : s.paths[t].eligible ? "bg-pv-success/15 text-pv-success" : "bg-pv-warning/20 text-pv-warning")} style={{ left: "50%", top: t === "TUN-A" ? "8%" : "94%" }}>
              {t} · {s.paths[t].last.rtt === null ? "down" : `${s.paths[t].last.rtt} ms · ${s.paths[t].last.jitter} ms · ${s.paths[t].last.loss}%`} · {s.paths[t].quality === "down" ? "unreachable" : s.paths[t].eligible ? "SLA ✓" : s.paths[t].sla === "PASS" ? `recovering ${s.paths[t].streak}/${s.cfg.hold}` : "SLA ✗"}
            </span>
          ))}
        <span className="pointer-events-none absolute left-1/2 top-1/2 z-[5] flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-0.5 rounded bg-black/55 px-2 py-0.5 pv-mono text-[10px]">
          <span className="text-[#fbbf24]">VOICE → {voice.tun}{voice.fallback ? " (fallback)" : ""}</span>
          <span className="text-[#34d399]">BULK → {bulk.tun}</span>
        </span>
        {packets.map((p) => (
          <LabPacketOverlay key={p.id} nodes={[...nodes, ...track]} packet={p} segmentMs={SD_TRAVEL_MS} lift={0} />
        ))}
      </GraphTopologyViewer>
    </div>
  );
}
