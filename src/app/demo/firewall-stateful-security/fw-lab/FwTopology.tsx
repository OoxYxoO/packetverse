"use client";

import { clsx } from "clsx";
import type { CliVendor } from "@/lib/cli/types";
import { GraphTopologyViewer, type GraphNode } from "@/components/network/GraphTopologyViewer";
import { LabPacketOverlay, type LabPacketView } from "@/components/practice-lab/LabTopology";
import { FW_IF, HOST_IP, PUBLIC, snatAddr, type FwDev, type FwNet } from "@/lib/sim-engine/scenarios/fwNet";
import { FW_TRAVEL_MS, fateOf, markerColor, markerLabel, type FwMoment } from "./fwMoments";
import { ifName, zoneName } from "./fwNames";

/**
 * The Firewall Lab on the shared practice-lab stage: FW1 between three zones (trust left, dmz below, untrust → ISP →
 * internet right), every link drawn as a line with the FW1 interface and zone written at its end, and FW1's live
 * session count and NAT under it.
 */
type P = { x: number; y: number };
const POS: Record<string, P> = { CLIENT: { x: 8, y: 26 }, LAB: { x: 8, y: 66 }, FW1: { x: 36, y: 46 }, DMZ: { x: 36, y: 86 }, ISP: { x: 64, y: 46 }, WEB: { x: 92, y: 26 }, OUT: { x: 92, y: 66 } };
const COMPACT: Record<string, P> = { CLIENT: { x: 10, y: 22 }, LAB: { x: 10, y: 62 }, FW1: { x: 38, y: 42 }, DMZ: { x: 38, y: 84 }, ISP: { x: 64, y: 42 }, WEB: { x: 90, y: 22 }, OUT: { x: 90, y: 62 } };
const TONE = { ok: "bg-pv-success/15 text-pv-success", warn: "bg-pv-warning/20 text-pv-warning", bad: "bg-pv-danger/20 text-pv-danger", muted: "bg-black/45 text-pv-text-muted" } as const;
export function FwTopology({ s, moment, prev, runKey, cursor, compact, onNode, selected, vendor }: { s: FwNet; moment?: FwMoment; prev?: FwMoment; runKey: string; cursor: number; compact: boolean; onNode?: (d: FwDev) => void; selected?: FwDev; vendor: CliVendor }) {
  const pos = compact ? COMPACT : POS;
  const sub: Record<string, string> = { CLIENT: HOST_IP.CLIENT, LAB: HOST_IP.LAB, DMZ: `${HOST_IP.DMZ} :443`, WEB: `${HOST_IP.WEB} :443 :80`, OUT: HOST_IP.OUT, FW1: `${s.sessions.filter((x) => x.state !== "CLOSED").length} sessions`, ISP: ISP_SUB };
  const kind: Record<string, GraphNode["kind"]> = { CLIENT: "laptop", LAB: "laptop", DMZ: "server", WEB: "server", OUT: "laptop", FW1: "firewall", ISP: "router" };
  const nodes: GraphNode[] = Object.keys(POS).map((id) => ({ id, label: id, subLabel: compact ? undefined : sub[id], kind: kind[id], ...pos[id] }));
  const at = (id: string) => nodes.find((n) => n.id === id)!;
  const links: [string, string, string][] = [
    ["CLIENT", "FW1", "#22d3ee"],
    ["LAB", "FW1", "#22d3ee"],
    ["FW1", "DMZ", "#a78bfa"],
    ["FW1", "ISP", "#f59e0b"],
    ["ISP", "WEB", "#f59e0b"],
    ["ISP", "OUT", "#f59e0b"],
  ];
  const tags: { x: number; y: number; text: string; tone: keyof typeof TONE; key: string }[] = [];
  if (!compact) {
    tags.push({ x: 24, y: 40, text: `${ifName(vendor, FW_IF.trust.ifn)} · ${zoneName(vendor, "trust")}`, tone: "muted", key: "zt" });
    tags.push({ x: 44, y: 70, text: `${ifName(vendor, FW_IF.dmz.ifn)} · ${zoneName(vendor, "dmz")}`, tone: "muted", key: "zd" });
    tags.push({ x: 50, y: 40, text: `${ifName(vendor, FW_IF.untrust.ifn)} · ${zoneName(vendor, "untrust")} ${PUBLIC}`, tone: "muted", key: "zu" });
    const sn = snatAddr(s.cfg.snat.trust);
    tags.push({ x: 50, y: 63, text: `SNAT ${sn ?? "off"}${s.cfg.dnat ? " · DNAT :443 → DMZ" : ""}`, tone: s.cfg.snat.trust === "interface" && s.cfg.snat.dmz === "interface" && s.cfg.dnat ? "ok" : "warn", key: "nat" });
  }
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
  // A packet dropped by FW1 itself (no hop out): mark it on FW1.
  moment?.decisions.filter((d) => d.drop && d.dev === "FW1").forEach((d, i) => packets.push({ id: `${runKey}:${cursor}:d${i}`, path: ["FW1", "FW1"], hop: 0, done: true, label: "✕ dropped", color: "#f87171", offset: { dx: 0, dy: -14 }, description: `FW1: ${d.drop}` }));
  const active = [...new Set([...(moment?.markers.flatMap((m) => [m.from, m.to]) ?? []), ...(moment?.decisions.map((d) => d.dev) ?? [])])];
  return (
    <div className="relative h-full">
      <GraphTopologyViewer
        nodes={nodes}
        edges={[]}
        regions={compact ? [] : [{ id: "t", label: `zone ${zoneName(vendor, "trust")}`, x: 1, y: 10, width: 22, height: 72, tone: "cyan" }, { id: "d", label: `zone ${zoneName(vendor, "dmz")}`, x: 25, y: 74, width: 22, height: 24, tone: "violet" }, { id: "u", label: `zone ${zoneName(vendor, "untrust")} → internet`, x: 52, y: 10, width: 47, height: 72, tone: "warning" }]}
        activeNodeIds={active}
        selectedNodeIds={selected ? [selected] : []}
        onNodeClick={onNode ? (id) => onNode(id as FwDev) : undefined}
        className="h-full"
      >
        <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
          {links.map(([a, b, c]) => (
            <line key={`${a}${b}`} x1={at(a).x} y1={at(a).y} x2={at(b).x} y2={at(b).y} stroke={c} strokeWidth={2.5} opacity={0.75} vectorEffect="non-scaling-stroke" strokeLinecap="round" />
          ))}
        </svg>
        {tags.map((t) => (
          <span key={t.key} className={clsx("pointer-events-none absolute z-[5] -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded px-1 py-px pv-mono text-[9.5px] font-bold sm:text-[10px]", TONE[t.tone])} style={{ left: `${t.x}%`, top: `${t.y}%` }}>
            {t.text}
          </span>
        ))}
        {packets.map((p) => (
          <LabPacketOverlay key={p.id} nodes={[...nodes, ...track]} packet={p} segmentMs={FW_TRAVEL_MS} lift={0} />
        ))}
      </GraphTopologyViewer>
    </div>
  );
}
const ISP_SUB = "198.51.100.1 · 203.0.113.1";
