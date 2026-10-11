"use client";

import { clsx } from "clsx";
import type { CSSProperties } from "react";
import type { CliVendor } from "@/lib/cli/types";
import { GraphTopologyViewer, type GraphNode } from "@/components/network/GraphTopologyViewer";
import { LabPacketOverlay, type LabPacketView } from "@/components/practice-lab/LabTopology";
import { HOST_AT, LC_HOSTS, LC_MEMBERS, isSw, lcMacName, lcTable, pk, type LcDecision, type LcDev, type LcMember, type LcSnap, type LcState, type LcSw } from "@/lib/sim-engine/scenarios/lacpNet";
import { LC_TRAVEL_MS, fateOf, markerColor, markerLabel, type LcMoment } from "./lcMoments";
import { lcPortName } from "./lcNames";

/**
 * The LACP Lab on the shared practice-lab stage: SW1 and SW2 with their three parallel cables drawn side by side.
 * A cable's color says what it is doing — cyan: a bundled member carrying traffic; amber dashed: blocked by spanning
 * tree; red dotted: suspended / err-disabled / silently broken; grey: a normal (unbundled) link — and the members of a
 * Port-channel are ringed at each switch. A frame between the switches rides the member the hash chose.
 */

type P = { x: number; y: number };
const POS: Record<string, P> = { SW1: { x: 34, y: 54 }, SW2: { x: 66, y: 54 }, "HOST-A": { x: 9, y: 28 }, "HOST-D": { x: 9, y: 82 }, "HOST-B": { x: 91, y: 28 }, "HOST-C": { x: 91, y: 82 } };
const COMPACT: Record<string, P> = { SW1: { x: 30, y: 52 }, SW2: { x: 70, y: 52 }, "HOST-A": { x: 10, y: 16 }, "HOST-D": { x: 10, y: 88 }, "HOST-B": { x: 90, y: 16 }, "HOST-C": { x: 90, y: 88 } };
export const OFFSET: Record<LcMember, number> = { "ge-0/0/22": -7, "ge-0/0/23": 0, "ge-0/0/24": 7 };
export type CableLook = { color: string; dash?: string; w: number; label: string; tone: "ok" | "warn" | "bad" | "muted" };
export function cableLook(s: LcState, m: LcMember): CableLook {
  if (!s.cfg.cables[m]) return { color: "#2b3348", dash: "3 5", w: 1.5, label: "no cable", tone: "muted" };
  const a = s.bundle.members[pk("SW1", m)];
  const b = s.bundle.members[pk("SW2", m)];
  if (s.silent[m] !== undefined) return { color: "#f87171", dash: "2 3", w: 2.5, label: a.state === "bundled" || b.state === "bundled" ? "silent failure — still in the bundle!" : "silent failure — removed", tone: "bad" };
  if (a.state === "down") return { color: "#3a4460", dash: "4 4", w: 2, label: "down", tone: "muted" };
  if (a.state === "errdis" || b.state === "errdis") return { color: "#f87171", dash: "2 3", w: 2, label: "err-disabled", tone: "bad" };
  if (a.state === "suspended" || b.state === "suspended") return { color: "#f87171", dash: "2 3", w: 2, label: "suspended", tone: "bad" };
  const ll = s.bundle.logical.find((l) => l.members.includes(m));
  if (!ll) return { color: "#64748b", dash: "4 4", w: 2, label: "not a working link", tone: "muted" };
  if (ll.stp === "blk") return { color: "#f59e0b", dash: "6 4", w: 2.5, label: `${ll.kind === "po" ? ll.id : "link"} blocked by STP`, tone: "warn" };
  return ll.kind === "po" ? { color: "#22d3ee", dash: undefined, w: 3, label: `${ll.id} member`, tone: "ok" } : { color: "#cbd5e1", dash: undefined, w: 2.5, label: "single link", tone: "ok" };
}
const FLAG: Record<string, string> = { bundled: "P", suspended: "s", individual: "I", down: "D", errdis: "D", hot: "H" };
const TONE = { ok: "bg-pv-success/15 text-pv-success", warn: "bg-pv-warning/20 text-pv-warning", bad: "bg-pv-danger/20 text-pv-danger", muted: "bg-black/40 text-pv-text-faint" } as const;

export function LcTopology({ s, snap, moment, prev, landed, runKey, cursor, compact, onNode, selected, vendor, cards = true }: { s: LcState; snap: LcSnap; moment?: LcMoment; prev?: LcMoment; landed: boolean; runKey: string; cursor: number; compact: boolean; onNode?: (d: LcDev) => void; selected?: LcDev; vendor: CliVendor; cards?: boolean }) {
  const pos = compact ? COMPACT : POS;
  const nodes: GraphNode[] = [
    ...(["SW1", "SW2"] as LcSw[]).map((sw) => ({ id: sw, label: `${sw}${sw === "SW1" ? " ♛" : ""}`, subLabel: compact ? undefined : sw === "SW1" ? "STP root" : "switch", kind: "switch" as const, ...pos[sw] })),
    ...LC_HOSTS.map((h) => ({ id: h, label: compact ? h.replace("HOST-", "") : h, subLabel: compact ? undefined : `.80.${h === "HOST-A" ? 10 : h === "HOST-D" ? 11 : h === "HOST-B" ? 20 : 21}`, kind: "laptop" as const, ...pos[h] })),
  ];
  const at = (id: string) => nodes.find((n) => n.id === id)!;
  const s1 = at("SW1");
  const s2 = at("SW2");
  const k = compact ? 0.8 : 1;
  const badges: { x: number; y: number; text: string; tone: keyof typeof TONE; key: string }[] = [];
  const cables = LC_MEMBERS.map((m) => {
    const look = cableLook(s, m);
    const dy = OFFSET[m] * k;
    if (s.cfg.cables[m]) {
      for (const sw of ["SW1", "SW2"] as LcSw[]) {
        const info = s.bundle.members[pk(sw, m)];
        const x = sw === "SW1" ? s1.x + (s2.x - s1.x) * 0.2 : s2.x - (s2.x - s1.x) * 0.2;
        badges.push({ x, y: s1.y + dy, text: compact ? FLAG[info.state] : `${lcPortName(vendor, m)}(${FLAG[info.state]})`, tone: info.state === "bundled" ? "ok" : info.state === "individual" ? "muted" : "bad", key: `${sw}${m}` });
      }
      if (!compact) badges.push({ x: 50, y: s1.y + dy - 2.6, text: look.label, tone: look.tone, key: `l${m}` });
    }
    return { m, look, dy };
  });
  // Port-channel rings: around the members bundled at each switch.
  const rings = (["SW1", "SW2"] as LcSw[]).flatMap((sw) =>
    [1, 2].flatMap((g) => {
      const ms = LC_MEMBERS.filter((m) => s.cfg.sw[sw].members[m].group === g && s.bundle.members[pk(sw, m)].state === "bundled");
      if (!ms.length) return [];
      const ys = ms.map((m) => s1.y + OFFSET[m] * k);
      const x = sw === "SW1" ? s1.x + (s2.x - s1.x) * 0.2 : s2.x - (s2.x - s1.x) * 0.2;
      return [{ key: `${sw}${g}`, x, y1: Math.min(...ys) - 3, y2: Math.max(...ys) + 3, label: lcPortName(vendor, `Po${g}`), err: s.bundle.poErr.includes(pk(sw, `Po${g}`)) }];
    }),
  );
  const hostLines = LC_HOSTS.map((h) => ({ a: at(HOST_AT[h].sw), b: at(h), key: h }));
  const packets: LabPacketView[] = [];
  const track: GraphNode[] = [];
  moment?.markers.forEach((mk, i) => {
    const a = at(mk.from);
    const b = at(mk.to);
    if (!a || !b) return;
    const sw2sw = isSw(mk.from) && isSw(mk.to);
    const dy = sw2sw ? (OFFSET[mk.fromPort as LcMember] ?? 0) * k : 0;
    const f = sw2sw ? 0.24 : 0.26;
    track.push({ id: `t${i}a`, label: "", x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f }, { id: `t${i}b`, label: "", x: b.x - (b.x - a.x) * f, y: b.y - (b.y - a.y) * f });
    packets.push({ id: `${runKey}:${cursor}:${i}`, path: [`t${i}a`, `t${i}b`], hop: 0, done: false, label: markerLabel(mk, compact), color: markerColor(mk), offset: { dx: 0, dy }, description: `${markerLabel(mk, false)}: ${mk.from} → ${mk.to}${sw2sw ? ` on ${mk.fromPort}` : ""}` });
  });
  if (prev)
    prev.markers.forEach((mk, i) => {
      const f = fateOf(prev, mk);
      if (!f) return;
      packets.push({ id: `${runKey}:${cursor}:f${i}`, path: [mk.to, mk.to], hop: 0, done: true, label: f.text.replace(/ /g, " "), color: f.tone === "ok" ? "#10b981" : f.tone === "bad" ? "#f87171" : "#64748b", offset: { dx: 0, dy: isSw(mk.to) ? -16 : (at(mk.to)?.y ?? 50) > 60 ? -14 : 14 }, description: `${mk.to}: ${f.text}` });
    });
  const active = [...new Set(moment?.markers.flatMap((m) => [m.from, m.to]) ?? [])];
  const shown = landed ? moment?.decisions : prev?.decisions;
  return (
    <div className="relative h-full">
      <GraphTopologyViewer nodes={nodes} edges={[]} activeNodeIds={active} selectedNodeIds={selected ? [selected] : []} onNodeClick={onNode ? (id) => onNode(id as LcDev) : undefined} className="h-full">
        <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
          {hostLines.map((l) => (
            <line key={l.key} x1={l.a.x} y1={l.a.y} x2={l.b.x} y2={l.b.y} stroke="#34d399" strokeWidth={2.5} opacity={0.75} vectorEffect="non-scaling-stroke" />
          ))}
          {cables.map((c) => (
            <line key={c.m} x1={s1.x} y1={s1.y + c.dy} x2={s2.x} y2={s2.y + c.dy} stroke={c.look.color} strokeWidth={c.look.w} strokeDasharray={c.look.dash} opacity={0.9} vectorEffect="non-scaling-stroke" strokeLinecap="round" />
          ))}
          {rings.map((r) => (
            <rect key={r.key} x={r.x - 4.5} y={r.y1} width={9} height={r.y2 - r.y1} rx={3} fill="none" stroke={r.err ? "#f87171" : "#22d3ee"} strokeWidth={1.5} strokeDasharray={r.err ? "2 2" : undefined} vectorEffect="non-scaling-stroke" />
          ))}
        </svg>
        {rings.map((r) => (
          <span key={`l${r.key}`} className={clsx("pointer-events-none absolute z-[5] -translate-x-1/2 rounded px-1 pv-mono text-[10px] font-bold", r.err ? "bg-pv-danger/20 text-pv-danger" : "bg-pv-cyan/15 text-pv-cyan-soft")} style={{ left: `${r.x}%`, top: `${r.y2 + 0.5}%` }}>
            {r.label}
            {r.err ? " err-dis" : ""}
          </span>
        ))}
        {badges.map((b) => (
          <span key={b.key} className={clsx("pointer-events-none absolute z-[6] -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded px-1 py-px pv-mono text-[9.5px] font-bold sm:text-[10px]", TONE[b.tone])} style={{ left: `${b.x}%`, top: `${b.y}%` }}>
            {b.text}
          </span>
        ))}
        {!compact && cards && (
          <>
            <SwitchCard sw="SW1" snap={snap} vendor={vendor} decisions={shown?.filter((d) => d.sw === "SW1") ?? []} floating style={{ left: "16%", top: "2%", width: "30%" }} />
            <SwitchCard sw="SW2" snap={snap} vendor={vendor} decisions={shown?.filter((d) => d.sw === "SW2") ?? []} floating style={{ left: "54%", top: "2%", width: "30%" }} />
          </>
        )}
        {packets.map((p) => (
          <LabPacketOverlay key={p.id} nodes={[...nodes, ...track]} packet={p} segmentMs={LC_TRAVEL_MS} lift={0} />
        ))}
      </GraphTopologyViewer>
    </div>
  );
}

/** One switch: its MAC table (by logical port) and its last decision, including the hash it used. */
export function SwitchCard({ sw, snap, decisions, style, floating, className, vendor, short }: { sw: LcSw; snap: LcSnap; decisions: LcDecision[]; style?: CSSProperties; floating?: boolean; className?: string; vendor: CliVendor; short?: boolean }) {
  const rows = lcTable(snap.fdb, sw);
  const d = decisions[decisions.length - 1];
  const fresh = new Set(decisions.filter((x) => x.learn === "learned" || x.learn === "moved").map((x) => x.frame.src));
  return (
    <div className={clsx("rounded-xl border bg-pv-bg/90 p-1.5 shadow-lg backdrop-blur", floating && "absolute z-[15]", decisions.length ? "border-pv-cyan/50" : "border-pv-border", className)} style={style}>
      <p className="flex items-center justify-between gap-1 px-0.5 text-[10px] font-bold uppercase tracking-wide text-pv-text-faint">
        <span>{short ? sw : `${sw} · MAC table`}</span>
        <span className="pv-mono normal-case">{rows.length ? `${rows.length}` : "empty"}</span>
      </p>
      <p className="px-0.5 pv-mono text-[10.5px] text-pv-text-muted">
        {rows.length ? rows.map((r) => <span key={r.mac} className={clsx("mr-1", fresh.has(r.mac) && "pv-pop rounded bg-pv-success/15 px-0.5 text-pv-text")}>{`${lcMacName(r.mac).replace("HOST-", "")}→${lcPortName(vendor, r.port).replace("Gi1/0/", "").replace("ge-0/0/", "")}`}</span>) : <span className="text-pv-text-faint">—</span>}
      </p>
      {d && !short && (
        <p key={`${d.frame.id}-${d.port}`} className={clsx("pv-pop mt-1 rounded-md border px-1 py-0.5 text-[10.5px] leading-snug", d.drop ? "border-pv-danger/40 text-pv-text" : "border-pv-cyan/40 text-pv-text")}>
          {d.drop ? `dropped on ${lcPortName(vendor, d.port)}` : d.out.length ? d.out.map((o) => (o.logical !== o.member ? `→ ${lcPortName(vendor, o.logical)} via ${lcPortName(vendor, o.member)}` : `→ ${lcPortName(vendor, o.logical)}`)).join(" · ") : "filtered"}
        </p>
      )}
    </div>
  );
}
