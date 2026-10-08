"use client";

import { clsx } from "clsx";
import { GraphTopologyViewer, type GraphEdge, type GraphNode, type GraphRegion } from "@/components/network/GraphTopologyViewer";
import { LabPacketOverlay, type LabPacketView } from "@/components/practice-lab/LabTopology";
import type { CliVendor } from "@/lib/cli/types";
import { RN_HOSTS, RN_IF_SEG, RN_ROUTERS, isRouter, netOf, rnIfUp, routeKeyOf, type RnCfg, type RnDev, type RnIf, type RnSeg } from "@/lib/sim-engine/scenarios/routeNet";
import { RN_TRAVEL_MS, decisionShort, pktColor, pktLabel, type RnMoment } from "./rnMoments";
import { ifName } from "./rnCli";

/**
 * The Routing Lab network on the shared practice-lab stage (GraphTopologyViewer: subnet regions, glass device cards,
 * active glow, highlighted path) with the shared moving marker. Each link carries its interfaces and prefix; the
 * router that is deciding wears its decision (winning route → egress interface), and the link it chose lights up as
 * the packet takes it. A packet that stops, stops at the router that dropped it.
 */

const POS: Record<RnDev, { x: number; y: number }> = { "HOST-A": { x: 7, y: 50 }, R1: { x: 27, y: 50 }, R2: { x: 55, y: 24 }, R3: { x: 55, y: 77 }, "SERVER-A": { x: 89, y: 14 }, "SERVER-B": { x: 89, y: 40 }, "SERVER-C": { x: 89, y: 77 } };
const COMPACT: Record<RnDev, { x: number; y: number }> = { "HOST-A": { x: 11, y: 50 }, R1: { x: 31, y: 50 }, R2: { x: 58, y: 22 }, R3: { x: 58, y: 78 }, "SERVER-A": { x: 88, y: 12 }, "SERVER-B": { x: 88, y: 40 }, "SERVER-C": { x: 88, y: 78 } };
const REGIONS: GraphRegion[] = [
  { id: "lan-a", label: "10.10.10.0/24", x: 1, y: 28, width: 13, height: 44, tone: "cyan" },
  { id: "srv-50", label: "172.16.50.0/24", x: 79, y: 2, width: 20, height: 52, tone: "violet" },
  { id: "srv-60", label: "172.16.60.0/24", x: 79, y: 61, width: 20, height: 34, tone: "violet" },
];
/** Link id for a hop between two devices. */
export const linkId = (a: RnDev, b: RnDev) => {
  const k = [a, b].sort().join("|");
  return `l:${k}`;
};
const SEG_ENDS: Record<RnSeg, [RnDev, RnIf | undefined, RnDev, RnIf | undefined][]> = {
  "lan-a": [["R1", "ge-0/0/0", "HOST-A", undefined]],
  "srv-50": [["R2", "ge-0/0/0", "SERVER-A", undefined], ["R2", "ge-0/0/0", "SERVER-B", undefined]],
  "srv-60": [["R3", "ge-0/0/0", "SERVER-C", undefined]],
  t12: [["R1", "ge-0/0/1", "R2", "ge-0/0/1"]],
  t13: [["R1", "ge-0/0/2", "R3", "ge-0/0/1"]],
  t23: [["R2", "ge-0/0/2", "R3", "ge-0/0/2"]],
};

export function RnTopology({ cfg, moment, prev, runKey, cursor, compact, onNode, selected, vendor, showIfs }: { cfg: RnCfg; moment?: RnMoment; prev?: RnMoment; runKey: string; cursor: number; compact: boolean; onNode?: (d: RnDev) => void; selected?: RnDev; vendor: CliVendor; showIfs: boolean }) {
  const pos = compact ? COMPACT : POS;
  const nodes: GraphNode[] = [
    ...RN_ROUTERS.map((r) => ({ id: r, label: r, subLabel: compact ? undefined : "router", kind: "router" as const, ...pos[r] })),
    ...RN_HOSTS.map((h) => ({ id: h, label: compact ? h.replace("SERVER-", "SRV-") : h, subLabel: compact ? undefined : cfg.h[h].ip, kind: h === "HOST-A" ? ("laptop" as const) : ("server" as const), ...pos[h] })),
  ];
  const edges: GraphEdge[] = (Object.keys(SEG_ENDS) as RnSeg[]).flatMap((seg) =>
    SEG_ENDS[seg].map(([a, ai, b, bi]) => {
      const up = rnIfUp(cfg, a as "R1", ai!) && (!bi || rnIfUp(cfg, b as "R1", bi)) && (isRouter(b) || cfg.h[b as "HOST-A"].up);
      const c = cfg.r[a as "R1"].ifs[ai!];
      const net = `${netOf(c.addr, c.len)}/${c.len}`;
      const label = compact ? undefined : !showIfs ? (seg.startsWith("t") ? net : undefined) : bi ? `${ifName(vendor, ai!)} · ${net} · ${ifName(vendor, bi)}` : seg === "srv-50" && b === "SERVER-B" ? undefined : `${ifName(vendor, ai!)}`;
      return { id: linkId(a, b), a, b, label, state: up ? ("full" as const) : ("down" as const) };
    }),
  );
  const track: GraphNode[] = [];
  const at = (id: string) => nodes.find((n) => n.id === id);
  const packets: LabPacketView[] = [];
  moment?.hops.forEach((h, k) => {
    const a = at(h.from);
    const b = at(h.to);
    if (!a || !b) return;
    const f = 0.24;
    track.push({ id: `t${k}a`, label: "", x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f }, { id: `t${k}b`, label: "", x: b.x - (b.x - a.x) * f, y: b.y - (b.y - a.y) * f });
    packets.push({ id: `${runKey}:${cursor}:${k}`, path: [`t${k}a`, `t${k}b`], hop: 0, done: false, label: `${pktLabel(h.pkt, compact)}${compact ? "" : ` · TTL ${h.pkt.ttl}`}`.replace(/ /g, " "), color: pktColor(h.pkt), description: `${pktLabel(h.pkt, false)} ${h.from} → ${h.to}` });
  });
  // Where a packet stopped (or arrived) stays on the device for one moment.
  const stops = (moment ?? prev)?.decisions.filter((d) => d.outcome !== "forward") ?? [];
  stops.forEach((d, k) => {
    const n = at(d.at);
    if (!n) return;
    const arrived = d.outcome === "deliver" || d.outcome === "local";
    const err = d.pkt.kind !== "echo" && d.pkt.kind !== "reply";
    const good = arrived && !err;
    const text = arrived ? (err ? `⚠ ${pktLabel(d.pkt, false)} received` : d.pkt.kind === "echo" ? "✓ echo arrived" : "✓ reply back") : `✕ ${decisionShort(d).replace(" ✕", "")}`;
    packets.push({ id: `${runKey}:${cursor}:s${k}`, path: [d.at, d.at], hop: 0, done: true, label: text.replace(/ /g, " "), color: good ? "#10b981" : err && arrived ? "#f59e0b" : "#f87171", offset: { dx: 0, dy: n.y > 60 ? -15 : 15 }, description: d.text });
  });
  const trackNodes = [...nodes, ...track];
  const lit = moment?.hops.map((h) => linkId(h.from, h.to)) ?? [];
  const active = [...new Set(moment?.decisions.map((d) => d.at) ?? [])];
  const deciding = moment?.decisions.filter((d) => isRouter(d.at) && d.lookup) ?? [];
  return (
    <div className="relative h-full">
      <GraphTopologyViewer nodes={nodes} edges={edges} regions={compact ? [] : REGIONS} activeNodeIds={active} bestPathEdgeIds={lit} selectedNodeIds={selected ? [selected] : []} onNodeClick={onNode ? (id) => onNode(id as RnDev) : undefined} className="h-full">
        {!compact &&
          deciding.map((d, k) => {
            const p = pos[d.at];
            const above = d.at === "R3";
            const left = d.at === "R1";
            return (
              <span key={`${runKey}${cursor}${k}`} className={clsx("pv-pop pointer-events-none absolute z-20 whitespace-nowrap", left ? "-translate-x-full" : "-translate-x-1/2", " rounded-md border px-1.5 py-0.5 pv-mono text-[10.5px] font-bold shadow-lg", d.outcome === "forward" ? "border-pv-cyan/60 bg-[#06222a] text-pv-cyan-soft" : "border-pv-danger/60 bg-[#2a0b0b] text-pv-danger")} style={{ left: left ? `calc(${p.x}% + 36px)` : `${p.x}%`, top: above ? `calc(${p.y}% - 66px)` : `calc(${p.y}% + ${left ? 70 : 46}px)` }}>
                {d.pkt.dst} → {decisionShort(d).replace(/ge-0\/0\/(\d)/, (_, n) => ifName(vendor, `ge-0/0/${n}` as RnIf))}
              </span>
            );
          })}
        {packets.map((p) => (
          <LabPacketOverlay key={p.id} nodes={trackNodes} packet={p} segmentMs={RN_TRAVEL_MS} lift={0} />
        ))}
      </GraphTopologyViewer>
    </div>
  );
}
export { RN_IF_SEG, routeKeyOf };
