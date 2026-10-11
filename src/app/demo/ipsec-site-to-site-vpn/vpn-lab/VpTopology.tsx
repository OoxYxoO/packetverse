"use client";

import { clsx } from "clsx";
import type { CliVendor } from "@/lib/cli/types";
import { GraphTopologyViewer, type GraphNode } from "@/components/network/GraphTopologyViewer";
import { LabPacketOverlay, type LabPacketView } from "@/components/practice-lab/LabTopology";
import { GW, HOST_IP, type VpDev, type VpNet } from "@/lib/sim-engine/scenarios/vpnNet";
import { VP_TRAVEL_MS, fateOf, markerColor, markerLabel, type VpMoment } from "./vpMoments";

/**
 * The VPN Lab on the shared practice-lab stage: two sites joined across the internet, the IPsec tunnel drawn as an
 * arc between the gateways (green: CHILD SA installed · amber: IKE SA only · red dotted: no IKE SA), with the tunnel
 * state written on it, and WEB on the internet for traffic that must NOT go through the tunnel.
 */
type P = { x: number; y: number };
const POS: Record<string, P> = { "HOST-A": { x: 6, y: 60 }, "GW-A": { x: 28, y: 60 }, INTERNET: { x: 50, y: 60 }, "GW-B": { x: 72, y: 60 }, "HOST-B": { x: 94, y: 60 }, WEB: { x: 50, y: 90 } };
const COMPACT: Record<string, P> = { "HOST-A": { x: 11, y: 30 }, "GW-A": { x: 27, y: 62 }, INTERNET: { x: 50, y: 62 }, "GW-B": { x: 73, y: 62 }, "HOST-B": { x: 89, y: 30 }, WEB: { x: 50, y: 90 } };
export function VpTopology({ s, moment, prev, runKey, cursor, compact, onNode, selected }: { s: VpNet; moment?: VpMoment; prev?: VpMoment; runKey: string; cursor: number; compact: boolean; onNode?: (d: VpDev) => void; selected?: VpDev; vendor: CliVendor }) {
  const pos = compact ? COMPACT : POS;
  const sub: Record<string, string> = { "HOST-A": HOST_IP["HOST-A"], "HOST-B": HOST_IP["HOST-B"], WEB: HOST_IP.WEB, "GW-A": GW["GW-A"].wan, "GW-B": GW["GW-B"].wan, INTERNET: "public routing" };
  const kind: Record<string, GraphNode["kind"]> = { "HOST-A": "laptop", "HOST-B": "laptop", WEB: "server", "GW-A": "router", "GW-B": "router", INTERNET: "cloud" };
  const nodes: GraphNode[] = Object.keys(POS).map((id) => ({ id, label: id, subLabel: compact ? undefined : sub[id], kind: kind[id], ...pos[id] }));
  const at = (id: string) => nodes.find((n) => n.id === id)!;
  const t = s.tunnel;
  const tone = t.child === "INSTALLED" ? "#34d399" : t.ike === "ESTABLISHED" ? "#f59e0b" : "#f87171";
  const label = t.child === "INSTALLED" ? `IPsec up · ${s.sa.encaps["GW-A"]}↑ ${s.sa.decaps["GW-A"]}↓ ESP` : t.ike === "ESTABLISHED" ? `IKE SA up · no CHILD SA (${t.child})` : `no IKE SA (${t.ike})`;
  const links: [string, string, string, boolean?][] = [
    ["HOST-A", "GW-A", "#22d3ee"],
    ["GW-A", "INTERNET", "#94a3b8"],
    ["INTERNET", "GW-B", "#94a3b8", !s.cfg.wanB],
    ["GW-B", "HOST-B", "#a78bfa"],
    ["INTERNET", "WEB", "#94a3b8"],
  ];
  const a = at("GW-A");
  const b = at("GW-B");
  const lift = compact ? 26 : 30;
  const packets: LabPacketView[] = [];
  const track: GraphNode[] = [];
  moment?.markers.forEach((mk, i) => {
    const p = at(mk.from);
    const q = at(mk.to);
    if (!p || !q) return;
    track.push({ id: `t${i}a`, label: "", x: p.x + (q.x - p.x) * 0.2, y: p.y + (q.y - p.y) * 0.2 }, { id: `t${i}b`, label: "", x: q.x - (q.x - p.x) * 0.2, y: q.y - (q.y - p.y) * 0.2 });
    packets.push({ id: `${runKey}:${cursor}:${i}`, path: [`t${i}a`, `t${i}b`], hop: 0, done: false, label: markerLabel(mk, compact), color: markerColor(mk), description: `${markerLabel(mk, false)}: ${mk.from} → ${mk.to}` });
  });
  if (prev)
    prev.markers.forEach((mk, i) => {
      const f = fateOf(prev, mk);
      if (!f) return;
      packets.push({ id: `${runKey}:${cursor}:f${i}`, path: [mk.to, mk.to], hop: 0, done: true, label: f.text.replace(/ /g, " "), color: f.tone === "ok" ? "#10b981" : "#f87171", offset: { dx: 0, dy: 14 }, description: `${mk.to}: ${f.text}` });
    });
  moment?.decisions.filter((d) => d.drop).forEach((d, i) => packets.push({ id: `${runKey}:${cursor}:d${i}`, path: [d.dev, d.dev], hop: 0, done: true, label: "✕ dropped", color: "#f87171", offset: { dx: 0, dy: -14 }, description: `${d.dev}: ${d.drop}` }));
  const active = [...new Set([...(moment?.markers.flatMap((m) => [m.from, m.to]) ?? []), ...(moment?.decisions.map((d) => d.dev) ?? [])])];
  return (
    <div className="relative h-full">
      <GraphTopologyViewer
        nodes={nodes}
        edges={[]}
        regions={compact ? [] : [{ id: "a", label: `Site A · ${GW["GW-A"].lanNet}`, x: 1, y: 40, width: 33, height: 36, tone: "cyan" }, { id: "b", label: `Site B · ${GW["GW-B"].lanNet}`, x: 66, y: 40, width: 33, height: 36, tone: "violet" }]}
        activeNodeIds={active}
        selectedNodeIds={selected ? [selected] : []}
        onNodeClick={onNode ? (id) => onNode(id as VpDev) : undefined}
        className="h-full"
      >
        <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
          {links.map(([p, q, c, down]) => (
            <line key={`${p}${q}`} x1={at(p).x} y1={at(p).y} x2={at(q).x} y2={at(q).y} stroke={down ? "#2b3348" : c} strokeDasharray={down ? "3 5" : undefined} strokeWidth={2.5} opacity={0.75} vectorEffect="non-scaling-stroke" strokeLinecap="round" />
          ))}
          <path d={`M ${a.x} ${a.y - 6} Q 50 ${a.y - lift - 14} ${b.x} ${b.y - 6}`} fill="none" stroke={tone} strokeWidth={3} strokeDasharray={t.child === "INSTALLED" ? undefined : "4 4"} vectorEffect="non-scaling-stroke" opacity={0.9} />
        </svg>
        <span className={clsx("pointer-events-none absolute z-[5] -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded px-1.5 py-px pv-mono text-[9.5px] font-bold sm:text-[10.5px]", t.child === "INSTALLED" ? "bg-pv-success/15 text-pv-success" : t.ike === "ESTABLISHED" ? "bg-pv-warning/20 text-pv-warning" : "bg-pv-danger/20 text-pv-danger")} style={{ left: "50%", top: `${a.y - lift - 9}%` }}>
          {label}
        </span>
        {packets.map((p) => (
          <LabPacketOverlay key={p.id} nodes={[...nodes, ...track]} packet={p} segmentMs={VP_TRAVEL_MS} lift={0} />
        ))}
      </GraphTopologyViewer>
    </div>
  );
}
