"use client";

import { clsx } from "clsx";
import type { CliVendor } from "@/lib/cli/types";
import { GraphTopologyViewer, type GraphNode } from "@/components/network/GraphTopologyViewer";
import { LabPacketOverlay, type LabPacketView } from "@/components/practice-lab/LabTopology";
import { HOST_IP, LINK_ENDS, OS_HOSTS, OS_LINKS, OS_ROUTERS, RID, ROUTER_OF, type OsDev, type OsLink, type OsState } from "@/lib/sim-engine/scenarios/ospfNet";
import { OS_TRAVEL_MS, fateOf, markerColor, markerLabel, type OsMoment } from "./osMoments";
import { osIfName } from "./osNames";

/**
 * The OSPF Lab diamond on the shared practice-lab stage. Each link shows its adjacency (cyan FULL · amber EXSTART ·
 * red dotted down · grey unplugged · red silent) and each end its OSPF cost; packets, Hellos and LSU floods ride the
 * links they really take.
 */
type P = { x: number; y: number };
const POS: Record<string, P> = { R1: { x: 24, y: 50 }, R2: { x: 50, y: 20 }, R3: { x: 50, y: 80 }, R4: { x: 76, y: 50 }, H1: { x: 6, y: 50 }, H2: { x: 72, y: 9 }, H3: { x: 28, y: 92 }, H4: { x: 94, y: 50 } };
const COMPACT: Record<string, P> = { R1: { x: 22, y: 50 }, R2: { x: 50, y: 18 }, R3: { x: 50, y: 82 }, R4: { x: 78, y: 50 }, H1: { x: 6, y: 26 }, H2: { x: 80, y: 8 }, H3: { x: 20, y: 92 }, H4: { x: 94, y: 74 } };
export function linkLook(s: OsState, l: OsLink): { color: string; dash?: string; w: number; label: string; tone: "ok" | "warn" | "bad" | "muted" } {
  if (!s.cfg.links[l]) return { color: "#2b3348", dash: "3 5", w: 1.5, label: "cut", tone: "muted" };
  if (s.silent[l] !== undefined) return { color: "#f87171", dash: "2 3", w: 2.5, label: s.view.adj[l].state === "FULL" ? "silent — still FULL!" : "silent — dead timer expired", tone: "bad" };
  const a = s.view.adj[l];
  if (a.state === "FULL") return { color: "#22d3ee", w: 3, label: "FULL", tone: "ok" };
  if (a.state === "EXSTART") return { color: "#f59e0b", dash: "6 4", w: 2.5, label: "stuck in EXSTART", tone: "warn" };
  return { color: "#f87171", dash: "2 3", w: 2, label: "no adjacency", tone: "bad" };
}
const TONE = { ok: "bg-pv-success/15 text-pv-success", warn: "bg-pv-warning/20 text-pv-warning", bad: "bg-pv-danger/20 text-pv-danger", muted: "bg-black/40 text-pv-text-faint" } as const;
export function OsTopology({ s, moment, prev, runKey, cursor, compact, onNode, selected, vendor }: { s: OsState; moment?: OsMoment; prev?: OsMoment; runKey: string; cursor: number; compact: boolean; onNode?: (d: OsDev) => void; selected?: OsDev; vendor: CliVendor }) {
  const pos = compact ? COMPACT : POS;
  const nodes: GraphNode[] = [...OS_ROUTERS.map((r) => ({ id: r, label: r, subLabel: compact ? undefined : RID[r], kind: "router" as const, ...pos[r] })), ...OS_HOSTS.map((h) => ({ id: h, label: h, subLabel: compact ? undefined : HOST_IP[h], kind: "laptop" as const, ...pos[h] }))];
  const at = (id: string) => nodes.find((n) => n.id === id)!;
  const lines: { a: P; b: P; color: string; dash?: string; w: number; key: string }[] = [];
  const tags: { x: number; y: number; text: string; tone: keyof typeof TONE; key: string }[] = [];
  const mid = (a: P, b: P, f: number) => ({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f });
  for (const l of OS_LINKS) {
    const [a, ai, b, bi] = LINK_ENDS[l];
    const A = at(a);
    const B = at(b);
    const look = linkLook(s, l);
    lines.push({ a: A, b: B, ...look, key: l });
    if (!s.cfg.links[l]) continue;
    const ca = s.cfg.r[a].ifs[ai];
    const cb = s.cfg.r[b].ifs[bi];
    tags.push({ ...mid(A, B, 0.22), text: compact ? String(ca.cost) : `${osIfName(vendor, ai)} · ${ca.cost}${ca.area ? ` · a${ca.area}` : ""}${ca.mtu !== 1500 ? ` · mtu ${ca.mtu}` : ""}`, tone: ca.cost === 100 || ca.area || ca.mtu !== 1500 ? "warn" : "muted", key: `${l}a` });
    tags.push({ ...mid(B, A, 0.22), text: compact ? String(cb.cost) : `${osIfName(vendor, bi)} · ${cb.cost}${cb.area ? ` · a${cb.area}` : ""}${cb.mtu !== 1500 ? ` · mtu ${cb.mtu}` : ""}`, tone: cb.area || cb.mtu !== 1500 ? "warn" : "muted", key: `${l}b` });
    if (!compact && look.tone !== "ok") tags.push({ ...mid(A, B, 0.5), text: look.label, tone: look.tone, key: `${l}m` });
  }
  for (const h of OS_HOSTS) {
    const r = ROUTER_OF[h];
    const inOspf = s.cfg.r[r].ifs["ge-0/0/0"].ospf;
    lines.push({ a: at(r), b: at(h), color: inOspf ? "#34d399" : "#64748b", dash: inOspf ? undefined : "4 4", w: 2, key: h });
    if (!inOspf && !compact) tags.push({ ...mid(at(r), at(h), 0.5), text: "LAN not in OSPF", tone: "bad", key: `${h}n` });
  }
  const packets: LabPacketView[] = [];
  const track: GraphNode[] = [];
  moment?.markers.forEach((mk, i) => {
    const a = at(mk.from);
    const b = at(mk.to);
    if (!a || !b) return;
    track.push({ id: `t${i}a`, label: "", ...mid(a, b, 0.2) }, { id: `t${i}b`, label: "", ...mid(b, a, 0.2) });
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
      <GraphTopologyViewer nodes={nodes} edges={[]} activeNodeIds={active} selectedNodeIds={selected ? [selected] : []} onNodeClick={onNode ? (id) => onNode(id as OsDev) : undefined} className="h-full">
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
        {packets.map((p) => (
          <LabPacketOverlay key={p.id} nodes={[...nodes, ...track]} packet={p} segmentMs={OS_TRAVEL_MS} lift={0} />
        ))}
      </GraphTopologyViewer>
    </div>
  );
}
