"use client";

import { clsx } from "clsx";
import type { CSSProperties } from "react";
import type { CliVendor } from "@/lib/cli/types";
import { GraphTopologyViewer, type GraphNode } from "@/components/network/GraphTopologyViewer";
import { LabPacketOverlay, type LabPacketView } from "@/components/practice-lab/LabTopology";
import { HOST_PORT, HOST_SW, LINK_ENDS, SPARE, ST_HOSTS, ST_LINKS, ST_SWITCHES, pk, stMacName, stPortState, stTable, type StDecision, type StDev, type StSnap, type StState, type StSw } from "@/lib/sim-engine/scenarios/stpNet";
import { ST_TRAVEL_MS, fateOf, markerColor, markerLabel, type StMoment } from "./stMoments";
import { stPortName } from "./stNames";

/**
 * The STP Lab triangle on the shared practice-lab stage. Each inter-switch link shows what spanning tree made of it:
 * solid when both ends forward, dashed amber with an ALT badge at the end that discards, red when nothing blocks a
 * loop. Every port end carries its role (RP root port · DP designated · ALT alternate · EDGE · BKN err-disabled /
 * root-inconsistent · OFF out of spanning tree), the root bridge wears a crown.
 */

type P = { x: number; y: number };
const POS: Record<string, P> = { SW1: { x: 50, y: 26 }, SW2: { x: 24, y: 70 }, SW3: { x: 76, y: 70 }, "HOST-A": { x: 22, y: 12 }, "HOST-B": { x: 7, y: 92 }, "HOST-C": { x: 93, y: 92 }, ROGUE: { x: 95, y: 48 } };
const COMPACT: Record<string, P> = { SW1: { x: 50, y: 24 }, SW2: { x: 22, y: 68 }, SW3: { x: 78, y: 68 }, "HOST-A": { x: 16, y: 10 }, "HOST-B": { x: 9, y: 92 }, "HOST-C": { x: 91, y: 92 }, ROGUE: { x: 92, y: 42 } };
export const ROLE_BADGE = (s: StState, sw: StSw, p: string): { text: string; tone: "ok" | "warn" | "bad" | "muted" } => {
  const st = stPortState(s, sw, p);
  const info = s.tree.ports[pk(sw, p)];
  if (s.errdis.includes(pk(sw, p))) return { text: "BKN", tone: "bad" };
  if (!info || info.role === "Disabled") return { text: "—", tone: "muted" };
  if (info.role === "Non-STP") return { text: "OFF", tone: "bad" };
  if (info.role === "No-STP") return { text: "noSTP", tone: "bad" };
  if (info.role === "Root-inc") return { text: "BKN·RG", tone: "bad" };
  if (info.role === "Alternate") return { text: "ALT", tone: "warn" };
  const base = info.role === "Root" ? "RP" : info.edge ? "EDGE" : "DP";
  return { text: st.state === "FWD" ? base : `${base}·${st.state}`, tone: st.state === "FWD" ? "ok" : "warn" };
};
const TONE = { ok: "bg-pv-success/15 text-pv-success", warn: "bg-pv-warning/20 text-pv-warning", bad: "bg-pv-danger/20 text-pv-danger", muted: "bg-black/40 text-pv-text-faint" } as const;

export function StTopology({ s, snap, moment, prev, landed, runKey, cursor, compact, onNode, selected, showPorts, cards = true, vendor }: { s: StState; snap: StSnap; moment?: StMoment; prev?: StMoment; landed: boolean; runKey: string; cursor: number; compact: boolean; onNode?: (d: StDev) => void; selected?: StDev; showPorts: boolean; cards?: boolean; vendor: CliVendor }) {
  const cfg = s.cfg;
  const pos = compact ? COMPACT : POS;
  const rootOf = s.tree.bridges.SW1?.root;
  const nodes: GraphNode[] = [
    ...ST_SWITCHES.map((sw) => {
      const b = s.tree.bridges[sw];
      const isRoot = b?.root === sw;
      const sub = cfg.sw[sw].proto === "none" ? "no spanning tree" : `${cfg.sw[sw].proto === "stp" ? "STP" : "RSTP"} · pri ${cfg.sw[sw].priority}${isRoot ? " · ROOT" : b ? ` · cost ${b.cost}` : ""}`;
      return { id: sw, label: `${isRoot ? "♛ " : ""}${sw}`, subLabel: compact ? (isRoot ? "root" : undefined) : sub, kind: "switch" as const, ...pos[sw] };
    }),
    ...ST_HOSTS.filter((h) => cfg.hosts[h]).map((h) => ({ id: h, label: compact ? h.replace("HOST-", "") : h, subLabel: compact ? undefined : `.70.${h === "HOST-A" ? 10 : h === "HOST-B" ? 20 : 30}`, kind: "laptop" as const, ...pos[h] })),
    ...(cfg.rogue ? [{ id: "ROGUE", label: compact ? "RG" : "small switch", subLabel: compact ? undefined : "pri 4096", kind: "switch" as const, ...pos.ROGUE }] : []),
  ];
  const at = (id: string) => nodes.find((n) => n.id === id);
  const lines: { a: P; b: P; color: string; dash?: string; w: number; key: string }[] = [];
  const badges: { x: number; y: number; text: string; tone: keyof typeof TONE; key: string }[] = [];
  const labels: { x: number; y: number; text: string; key: string; tone?: "bad" }[] = [];
  const end = (a: P, b: P, f: number) => ({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f });
  for (const l of ST_LINKS) {
    const [a, ap, b, bp] = LINK_ENDS[l];
    const A = at(a)!;
    const Bn = at(b)!;
    if (!cfg.links[l]) {
      lines.push({ a: A, b: Bn, color: "#3a4460", dash: "3 5", w: 2, key: l });
      if (!compact) labels.push({ ...end(A, Bn, 0.5), text: "cable unplugged", key: `${l}u`, tone: "bad" });
      continue;
    }
    const ba = ROLE_BADGE(s, a, ap);
    const bb = ROLE_BADGE(s, b, bp);
    const fa = stPortState(s, a, ap).state === "FWD";
    const fb = stPortState(s, b, bp).state === "FWD";
    const loopish = fa && fb && (ba.text === "OFF" || bb.text === "OFF" || ba.text === "noSTP" || bb.text === "noSTP");
    lines.push({ a: A, b: Bn, color: loopish ? "#f87171" : fa && fb ? "#22d3ee" : "#f59e0b", dash: fa && fb ? undefined : "6 4", w: fa && fb ? 3 : 2, key: l });
    if (showPorts) {
      badges.push({ ...end(A, Bn, 0.24), text: compact ? ba.text : `${stPortName(vendor, ap).replace("GigabitEthernet", "Gi")} ${ba.text}`, tone: ba.tone, key: `${l}a` });
      badges.push({ ...end(Bn, A, 0.24), text: compact ? bb.text : `${stPortName(vendor, bp)} ${bb.text}`, tone: bb.tone, key: `${l}b` });
    }
  }
  for (const h of ST_HOSTS.filter((x) => cfg.hosts[x])) {
    const sw = HOST_SW[h];
    const bd = ROLE_BADGE(s, sw, HOST_PORT);
    const ok = stPortState(s, sw, HOST_PORT).state === "FWD";
    lines.push({ a: at(sw)!, b: at(h)!, color: ok ? "#34d399" : "#f59e0b", dash: ok ? undefined : "6 4", w: 2.5, key: h });
    if (showPorts && (!compact || bd.text !== "EDGE")) badges.push({ ...end(at(sw)!, at(h)!, 0.35), text: compact ? bd.text : `${stPortName(vendor, HOST_PORT)} ${bd.text}`, tone: bd.tone, key: `${h}b` });
  }
  if (cfg.rogue) {
    const bd = ROLE_BADGE(s, "SW3", SPARE);
    const ok = stPortState(s, "SW3", SPARE).state === "FWD";
    lines.push({ a: at("SW3")!, b: at("ROGUE")!, color: ok ? "#f87171" : "#3a4460", dash: ok ? undefined : "4 4", w: 2.5, key: "rg" });
    badges.push({ ...end(at("SW3")!, at("ROGUE")!, 0.4), text: compact ? bd.text : `${stPortName(vendor, SPARE)} ${bd.text}`, tone: bd.tone, key: "rgb" });
  }
  if (!compact && rootOf && rootOf !== "SW1") labels.push({ x: 50, y: 4, text: `root bridge: ${rootOf === "ROGUE" ? "the small switch!" : rootOf}`, key: "root", tone: "bad" });

  const packets: LabPacketView[] = [];
  const track: GraphNode[] = [];
  moment?.markers.forEach((m, k) => {
    const a = at(m.from);
    const b = at(m.to);
    if (!a || !b) return;
    const f = 0.22;
    track.push({ id: `t${k}a`, label: "", x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f }, { id: `t${k}b`, label: "", x: b.x - (b.x - a.x) * f, y: b.y - (b.y - a.y) * f });
    packets.push({ id: `${runKey}:${cursor}:${k}`, path: [`t${k}a`, `t${k}b`], hop: 0, done: false, label: markerLabel(m, compact), color: markerColor(m), description: `${markerLabel(m, false)}: ${m.from} → ${m.to}` });
  });
  if (prev)
    prev.markers.forEach((m, k) => {
      const f = fateOf(prev, m);
      if (!f) return;
      packets.push({ id: `${runKey}:${cursor}:f${k}`, path: [m.to, m.to], hop: 0, done: true, label: f.text.replace(/ /g, " "), color: f.tone === "ok" ? "#10b981" : f.tone === "bad" ? "#f87171" : "#64748b", offset: { dx: 0, dy: (at(m.to)?.y ?? 50) > 60 ? -14 : 14 }, description: `${m.to}: ${f.text}` });
    });
  const active = [...new Set(moment?.markers.flatMap((m) => [m.from, m.to]) ?? [])];
  const shown = landed ? moment?.decisions : prev?.decisions;
  return (
    <div className="relative h-full">
      <GraphTopologyViewer nodes={nodes} edges={[]} activeNodeIds={active} selectedNodeIds={selected ? [selected] : []} onNodeClick={onNode ? (id) => onNode(id as StDev) : undefined} className="h-full">
        <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
          {lines.map((l) => (
            <line key={l.key} x1={l.a.x} y1={l.a.y} x2={l.b.x} y2={l.b.y} stroke={l.color} strokeWidth={l.w} strokeDasharray={l.dash} opacity={0.85} vectorEffect="non-scaling-stroke" strokeLinecap="round" />
          ))}
        </svg>
        {badges.map((b) => (
          <span key={b.key} className={clsx("pointer-events-none absolute z-[5] -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded px-1 py-px pv-mono text-[9.5px] font-bold sm:text-[10px]", TONE[b.tone])} style={{ left: `${b.x}%`, top: `${b.y}%` }}>
            {b.text}
          </span>
        ))}
        {labels.map((l) => (
          <span key={l.key} className={clsx("pointer-events-none absolute z-[5] -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded px-1.5 py-px pv-mono text-[10px] font-bold", l.tone === "bad" ? "bg-pv-danger/20 text-pv-danger" : "bg-black/55 text-pv-text-muted")} style={{ left: `${l.x}%`, top: `${l.y}%` }}>
            {l.text}
          </span>
        ))}
        {!compact && cards && (
          <>
            <BridgeCard sw="SW1" s={s} snap={snap} vendor={vendor} decisions={shown?.filter((d) => d.sw === "SW1") ?? []} floating style={{ left: "64%", top: "3%", width: "24%" }} />
            <BridgeCard sw="SW2" s={s} snap={snap} vendor={vendor} decisions={shown?.filter((d) => d.sw === "SW2") ?? []} floating style={{ left: "1%", top: "30%", width: "22%" }} />
            <BridgeCard sw="SW3" s={s} snap={snap} vendor={vendor} decisions={shown?.filter((d) => d.sw === "SW3") ?? []} floating style={{ left: "62%", top: "30%", width: "22%" }} />
          </>
        )}
        {packets.map((p) => (
          <LabPacketOverlay key={p.id} nodes={[...nodes, ...track]} packet={p} segmentMs={ST_TRAVEL_MS} lift={0} />
        ))}
      </GraphTopologyViewer>
    </div>
  );
}

/** One bridge at a glance: its root, cost and Root Port, its MAC table, and its last decision. */
export function BridgeCard({ sw, s, snap, decisions, style, floating, className, vendor, short }: { sw: StSw; s: StState; snap: StSnap; decisions: StDecision[]; style?: CSSProperties; floating?: boolean; className?: string; vendor: CliVendor; short?: boolean }) {
  const b = s.tree.bridges[sw];
  const rows = stTable(snap.fdb, sw);
  const d = decisions[decisions.length - 1];
  const fresh = new Set(decisions.filter((x) => x.learn === "learned" || x.learn === "moved").map((x) => x.frame.src));
  return (
    <div className={clsx("rounded-xl border bg-pv-bg/90 p-1.5 shadow-lg backdrop-blur", floating && "absolute z-[15]", decisions.length ? "border-pv-cyan/50" : "border-pv-border", className)} style={style}>
      <p className="flex items-center justify-between gap-1 px-0.5 text-[10px] font-bold uppercase tracking-wide text-pv-text-faint">
        <span>{sw}</span>
        <span className="pv-mono normal-case">{s.cfg.sw[sw].proto === "none" ? "no STP" : b?.root === sw ? "root" : `root ${b?.root} · cost ${b?.cost}`}</span>
      </p>
      {!short && b && b.root !== sw && <p className="px-0.5 text-[10.5px] text-pv-text-muted">RP {b.rootPort ? stPortName(vendor, b.rootPort) : "—"}</p>}
      <p className="px-0.5 pv-mono text-[10.5px] text-pv-text-muted">
        {rows.length ? rows.map((r) => <span key={r.mac} className={clsx("mr-1", fresh.has(r.mac) && "pv-pop rounded bg-pv-success/15 px-0.5 text-pv-text")}>{`${stMacName(r.mac).replace("HOST-", "")}→${stPortName(vendor, r.port).replace("ge-0/0/", "").replace("Gi1/0/", "")}`}</span>) : <span className="text-pv-text-faint">MAC table empty</span>}
      </p>
      {d && !short && (
        <p key={`${d.frame.id}-${d.port}`} className={clsx("pv-pop mt-1 rounded-md border px-1 py-0.5 text-[10.5px] leading-snug", d.drop ? "border-pv-danger/40 text-pv-text" : d.learn === "moved" ? "border-pv-danger/40 text-pv-text" : "border-pv-cyan/40 text-pv-text")}>
          in {stPortName(vendor, d.port)}
          {d.n > 1 ? ` ×${d.n}` : ""} · {d.drop ? "discarded (port not forwarding)" : d.learn === "moved" ? "MAC moved!" : d.kind === "known" ? `→ ${d.out.map((p) => stPortName(vendor, p)).join(", ")}` : `flood ${d.out.map((p) => stPortName(vendor, p)).join(", ") || "—"}`}
        </p>
      )}
    </div>
  );
}
