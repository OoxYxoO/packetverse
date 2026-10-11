"use client";

import { clsx } from "clsx";
import type { CSSProperties } from "react";
import type { CliVendor } from "@/lib/cli/types";
import { GraphTopologyViewer, type GraphNode } from "@/components/network/GraphTopologyViewer";
import { LabPacketOverlay, type LabPacketView } from "@/components/practice-lab/LabTopology";
import { RTR_PORT, TRUNK, VL_HOSTS, isSw, vlMacName, vlPortUp, vlPortVlans, vlShortMac, vlTable, vlanName, type VlCfg, type VlDecision, type VlDev, type VlHost, type VlSnap, type VlSw } from "@/lib/sim-engine/scenarios/vlanNet";
import { VL_TRAVEL_MS, fateOf, markerColor, markerLabel, vlanColor, type VlMoment } from "./vlMoments";
import { r1IfName, vlPortName } from "./vlNames";

/**
 * The VLAN Lab network on the shared practice-lab stage. VLAN membership is drawn, not just written: an access link is
 * the color of its VLAN; a trunk is drawn as LANES — one per VLAN it carries — with its native (untagged) VLAN marked.
 * A frame rides the lane of its VLAN, so a VLAN 10 frame and a VLAN 20 frame visibly share one cable without mixing.
 * Each switch's own table, split by VLAN, sits above it.
 */

type P = { x: number; y: number };
const POS: Record<string, P> = { "HOST-A": { x: 9, y: 30 }, "HOST-C": { x: 9, y: 74 }, SW1: { x: 33, y: 52 }, SW2: { x: 67, y: 52 }, "HOST-B": { x: 91, y: 30 }, "HOST-D": { x: 91, y: 74 }, R1: { x: 67, y: 88 }, "SW1 ge-0/0/3": { x: 33, y: 88 }, "SW2 ge-0/0/3": { x: 89, y: 92 } };
const COMPACT: Record<string, P> = { "HOST-A": { x: 12, y: 18 }, "HOST-C": { x: 12, y: 80 }, SW1: { x: 33, y: 48 }, SW2: { x: 67, y: 48 }, "HOST-B": { x: 88, y: 18 }, "HOST-D": { x: 88, y: 80 }, R1: { x: 67, y: 86 }, "SW1 ge-0/0/3": { x: 36, y: 86 }, "SW2 ge-0/0/3": { x: 90, y: 50 } };
const HOME: Record<string, string> = { "SW1 ge-0/0/1": "HOST-A", "SW1 ge-0/0/2": "HOST-C", "SW2 ge-0/0/1": "HOST-B", "SW2 ge-0/0/2": "HOST-D" };
/** Lane spacing on a trunk (percent of the stage). */
const GAP = 2.4;

export function hostSpot(cfg: VlCfg, h: VlHost, compact: boolean): P | undefined {
  const at = cfg.hosts[h].at;
  if (!at) return undefined;
  const key = `${at.sw} ${at.port}`;
  return (compact ? COMPACT : POS)[HOME[key] ?? key];
}
interface Lane {
  vlan: number;
  /** Carried by both ends (or by SW2 + an R1 subinterface). */
  ok: boolean;
  native: boolean;
  /** Where the lane breaks, if it does. */
  why?: string;
}
/** The lanes of the SW1↔SW2 trunk: every VLAN either end carries. */
export function trunkLanes(cfg: VlCfg): Lane[] {
  const a = cfg.sw.SW1.ports[TRUNK];
  const b = cfg.sw.SW2.ports[TRUNK];
  if (a.mode !== "trunk" && b.mode !== "trunk") return [];
  const va = vlPortVlans(cfg, "SW1", TRUNK);
  const vb = vlPortVlans(cfg, "SW2", TRUNK);
  return [...new Set([...va, ...vb])].sort((x, y) => x - y).map((v) => {
    const ok = va.includes(v) && vb.includes(v) && a.mode === "trunk" && b.mode === "trunk";
    const native = a.native === v || b.native === v;
    const why = !va.includes(v) ? `SW1 doesn't carry ${v}` : !vb.includes(v) ? `SW2 doesn't carry ${v}` : a.native !== b.native && native ? "native mismatch" : undefined;
    return { vlan: v, ok: ok && !(a.native !== b.native && native), native, why };
  });
}
/** The lanes of SW2 ↔ R1: VLANs SW2 sends to R1, matched against R1's subinterface tags. */
export function routerLanes(cfg: VlCfg): Lane[] {
  const p = cfg.sw.SW2.ports[RTR_PORT];
  const sw = p.mode === "trunk" ? vlPortVlans(cfg, "SW2", RTR_PORT).filter((v) => v !== p.native) : [];
  const subs = cfg.r1.subs.filter((s) => !s.shut).map((s) => s.vid);
  return [...new Set([...sw, ...subs])].sort((x, y) => x - y).map((v) => ({ vlan: v, ok: sw.includes(v) && subs.includes(v), native: false, why: !sw.includes(v) ? `SW2 ${RTR_PORT} doesn't carry ${v}` : !subs.includes(v) ? `no R1 subinterface for VID ${v}` : undefined }));
}
const laneOffset = (i: number, n: number) => (i - (n - 1) / 2) * GAP;

export function VlTopology({ cfg, snap, moment, prev, landed, runKey, cursor, compact, onNode, selected, showPorts, tableCards = true, vendor, showRouter = true }: { cfg: VlCfg; snap: VlSnap; moment?: VlMoment; prev?: VlMoment; landed: boolean; runKey: string; cursor: number; compact: boolean; onNode?: (d: VlDev) => void; selected?: VlDev; showPorts: boolean; tableCards?: boolean; vendor: CliVendor; showRouter?: boolean }) {
  const pos = compact ? COMPACT : POS;
  const hosts = VL_HOSTS.filter((h) => cfg.hosts[h].at);
  const nodes: GraphNode[] = [
    { id: "SW1", label: "SW1", subLabel: compact ? undefined : "802.1Q switch", kind: "switch", ...pos.SW1 },
    { id: "SW2", label: "SW2", subLabel: compact ? undefined : "802.1Q switch", kind: "switch", ...pos.SW2 },
    ...(showRouter ? [{ id: "R1", label: "R1", subLabel: compact ? undefined : cfg.r1.subs.map((s) => `.${s.unit}`).join(" "), kind: "router" as const, ...pos.R1 }] : []),
    ...hosts.map((h) => {
      const at = cfg.hosts[h].at!;
      const pc = cfg.sw[at.sw].ports[at.port];
      return { id: h, label: compact ? h.replace("HOST-", "") : h, subLabel: compact ? undefined : `${cfg.hosts[h].ip}${pc.mode === "access" ? ` · VLAN ${pc.access}` : " · on a trunk!"}`, kind: "laptop" as const, ...hostSpot(cfg, h, compact)! };
    }),
  ];
  const at = (id: string) => nodes.find((x) => x.id === id);
  const tl = trunkLanes(cfg);
  const rl = routerLanes(cfg);
  // Lines: [from, to, color, dash, width, offset]
  const lines: { a: P; b: P; color: string; dash?: string; w: number; key: string; o: { dx: number; dy: number } }[] = [];
  const labels: { x: number; y: number; text: string; tone?: "bad" | "muted" | "native"; key: string }[] = [];
  for (const h of hosts) {
    const a0 = cfg.hosts[h].at!;
    const pc = cfg.sw[a0.sw].ports[a0.port];
    const sw = at(a0.sw)!;
    const hn = at(h)!;
    const up = vlPortUp(cfg, a0.sw, a0.port);
    const vlans = pc.mode === "access" ? [pc.access] : vlPortVlans(cfg, a0.sw, a0.port);
    vlans.forEach((v, i) => lines.push({ a: sw, b: hn, color: up ? vlanColor(v) : "#3a4460", dash: up ? undefined : "4 4", w: 3, key: `acc-${h}-${v}`, o: { dx: 0, dy: laneOffset(i, vlans.length) } }));
    if (showPorts && !compact) labels.push({ x: (sw.x * 0.62 + hn.x * 0.38), y: (sw.y * 0.62 + hn.y * 0.38) - 3, text: `${vlPortName(vendor, a0.port)} · ${pc.mode === "access" ? `V${pc.access}` : "trunk"}`, tone: up ? undefined : "muted", key: `l-${h}` });
  }
  const s1 = at("SW1")!;
  const s2 = at("SW2")!;
  const trunkUp = vlPortUp(cfg, "SW1", TRUNK);
  tl.forEach((ln, i) => lines.push({ a: s1, b: s2, color: !trunkUp ? "#3a4460" : vlanColor(ln.vlan), dash: !trunkUp ? "4 4" : !ln.ok ? "2 3" : ln.native ? "6 2" : undefined, w: ln.ok ? 3 : 2, key: `t-${ln.vlan}`, o: { dx: 0, dy: laneOffset(i, tl.length) } }));
  if (!compact) {
    labels.push({ x: (s1.x + s2.x) / 2, y: s1.y - (tl.length * GAP) / 2 - 4.5, text: showPorts ? `${vlPortName(vendor, TRUNK)} trunk · ${tl.map((l) => `${l.vlan}${l.native ? "ᴺ" : ""}`).join(" ")}` : "trunk", key: "lt" });
    const bad = tl.filter((l) => l.why);
    if (bad.length) labels.push({ x: (s1.x + s2.x) / 2, y: s1.y + (tl.length * GAP) / 2 + 4.5, text: bad.map((l) => `${l.vlan}: ${l.why}`).join(" · "), tone: "bad", key: "lt2" });
    else if (showPorts && tl.some((l) => l.native)) labels.push({ x: (s1.x + s2.x) / 2, y: s1.y + (tl.length * GAP) / 2 + 4.5, text: `native ${cfg.sw.SW1.ports[TRUNK].native} = untagged`, tone: "native", key: "lt3" });
  }
  if (showRouter) {
    const r = at("R1")!;
    const up = vlPortUp(cfg, "SW2", RTR_PORT);
    rl.forEach((ln, i) => lines.push({ a: s2, b: r, color: !up ? "#3a4460" : vlanColor(ln.vlan), dash: !up ? "4 4" : !ln.ok ? "2 3" : undefined, w: ln.ok ? 3 : 2, key: `r-${ln.vlan}`, o: { dx: laneOffset(i, rl.length) * 1.4, dy: 0 } }));
    if (!compact) {
      labels.push({ x: s2.x + 9, y: (s2.y + r.y) / 2, text: showPorts ? `${vlPortName(vendor, RTR_PORT)} ↔ ${r1IfName(vendor)}` : "trunk to R1", key: "lr" });
      const bad = rl.filter((l) => l.why);
      if (bad.length) labels.push({ x: s2.x - 13, y: (s2.y + r.y) / 2, text: bad.map((l) => l.why).join(" · "), tone: "bad", key: "lr2" });
    }
  }
  // Markers ride their VLAN's lane between two points just short of each device.
  const packets: LabPacketView[] = [];
  const track: GraphNode[] = [];
  moment?.markers.forEach((m, k) => {
    const a = at(m.from);
    const b = at(m.to);
    if (!a || !b) return;
    const sw2sw = isSw(m.from) && isSw(m.to);
    const toR = m.from === "R1" || m.to === "R1";
    const v = m.vlan ?? m.vid;
    let o = { dx: 0, dy: 0 };
    if (sw2sw) {
      const i = tl.findIndex((l) => l.vlan === v);
      o = { dx: 0, dy: laneOffset(i < 0 ? 0 : i, tl.length) };
    } else if (toR) {
      const i = rl.findIndex((l) => l.vlan === m.vid);
      o = { dx: laneOffset(i < 0 ? 0 : i, rl.length) * 1.4, dy: 0 };
    }
    const f = sw2sw ? 0.2 : 0.26;
    track.push({ id: `t${k}a`, label: "", x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f }, { id: `t${k}b`, label: "", x: b.x - (b.x - a.x) * f, y: b.y - (b.y - a.y) * f });
    packets.push({ id: `${runKey}:${cursor}:${k}`, path: [`t${k}a`, `t${k}b`], hop: 0, done: false, label: markerLabel(m, compact), color: markerColor(m), offset: o, description: `${markerLabel(m, false)}: ${m.from} → ${m.to}` });
  });
  const trackNodes = [...nodes, ...track];
  if (prev)
    prev.markers.forEach((m, k) => {
      const f = fateOf(prev, m);
      if (!f) return;
      packets.push({ id: `${runKey}:${cursor}:f${k}`, path: [m.to, m.to], hop: 0, done: true, label: f.text.replace(/ /g, " "), color: f.tone === "ok" ? "#10b981" : f.tone === "bad" ? "#f87171" : "#64748b", offset: { dx: 0, dy: (at(m.to)?.y ?? 50) > 66 ? -15 : 15 }, description: `${m.to}: ${f.text}` });
    });
  const active = [...new Set(moment?.markers.flatMap((m) => [m.from, m.to]) ?? [])];
  const shown = landed ? moment?.decisions : prev?.decisions;
  return (
    <div className="relative h-full">
      <GraphTopologyViewer nodes={nodes} edges={[]} activeNodeIds={active} selectedNodeIds={selected ? [selected] : []} onNodeClick={onNode ? (id) => onNode(id as VlDev) : undefined} className="h-full">
        <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
          {lines.map((l) => (
            <line key={l.key} x1={l.a.x + l.o.dx} y1={l.a.y + l.o.dy} x2={l.b.x + l.o.dx} y2={l.b.y + l.o.dy} stroke={l.color} strokeWidth={l.w} strokeDasharray={l.dash} opacity={0.85} vectorEffect="non-scaling-stroke" strokeLinecap="round" />
          ))}
        </svg>
        {labels.map((l) => (
          <span key={l.key} className={clsx("pointer-events-none absolute z-[5] -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded px-1.5 py-px pv-mono text-[10px] font-bold", l.tone === "bad" ? "bg-pv-danger/20 text-pv-danger" : l.tone === "native" ? "bg-black/50 text-pv-text-faint" : l.tone === "muted" ? "bg-black/40 text-pv-text-faint" : "bg-black/55 text-pv-text-muted")} style={{ left: `${l.x}%`, top: `${l.y}%` }}>
            {l.text}
          </span>
        ))}
        {!compact && tableCards && (["SW1", "SW2"] as VlSw[]).map((sw) => <VlanTableCard key={sw} sw={sw} cfg={cfg} snap={snap} vendor={vendor} decisions={shown?.filter((d) => d.sw === sw) ?? []} style={{ left: sw === "SW1" ? "15%" : "51%", top: "2%", width: "34%" }} floating />)}
        {packets.map((p) => (
          <LabPacketOverlay key={p.id} nodes={trackNodes} packet={p} segmentMs={VL_TRAVEL_MS} lift={0} />
        ))}
      </GraphTopologyViewer>
    </div>
  );
}

/** One switch's table, grouped by VLAN: the same switch, a separate list per VLAN. */
export function VlanTableCard({ sw, cfg, snap, decisions, style, floating, className, vendor, short }: { sw: VlSw; cfg: VlCfg; snap: VlSnap; decisions: VlDecision[]; style?: CSSProperties; floating?: boolean; className?: string; vendor: CliVendor; short?: boolean }) {
  const rows = vlTable(snap.fdb, sw);
  const vlans = [...new Set(rows.map((r) => r.vlan))];
  const fresh = new Set(decisions.filter((d) => d.learn === "learned" || d.learn === "moved").map((d) => `${d.vlan}|${d.frame.src}`));
  const d = decisions[decisions.length - 1];
  return (
    <div className={clsx("rounded-xl border bg-pv-bg/90 p-1.5 shadow-lg backdrop-blur", floating && "absolute z-[15]", decisions.length ? "border-pv-cyan/50" : "border-pv-border", className)} style={style}>
      <p className="flex items-center justify-between gap-1 px-0.5 text-[10px] font-bold uppercase tracking-wide text-pv-text-faint">
        <span>{short ? `${sw} table` : `${sw} · MAC table by VLAN`}</span>
        <span className="pv-mono normal-case">{rows.length ? `${rows.length} entr${rows.length === 1 ? "y" : "ies"}` : "empty"}</span>
      </p>
      {rows.length === 0 ? (
        <p className="px-0.5 py-1 text-[11px] text-pv-text-faint">No entries yet.</p>
      ) : (
        <div className="space-y-0.5">
          {vlans.map((v) => (
            <div key={v} className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0">
              <span className="pv-mono rounded px-1 text-[10px] font-bold" style={{ color: vlanColor(v), background: `color-mix(in srgb, ${vlanColor(v)} 16%, transparent)` }}>
                V{v}
              </span>
              {rows
                .filter((r) => r.vlan === v)
                .map((r) => (
                  <span key={`${v}${r.mac}${fresh.has(`${v}|${r.mac}`) ? `-${d?.frame.id}` : ""}`} className={clsx("pv-mono text-[10.5px]", fresh.has(`${v}|${r.mac}`) ? "pv-pop rounded bg-pv-success/15 px-0.5 text-pv-text" : "text-pv-text-muted")}>
                    {vlMacName(cfg, r.mac).replace("HOST-", "")}→{vlPortName(vendor, r.port).replace("ge-0/0/", "")}
                  </span>
                ))}
            </div>
          ))}
        </div>
      )}
      {d && (
        <p key={`${d.frame.id}-${d.port}`} className={clsx("pv-pop mt-1 rounded-md border px-1 py-0.5 text-[10.5px] leading-snug", d.drop || (d.out.length === 0 && d.kind !== "filter") ? "border-pv-danger/40 text-pv-text" : d.kind === "known" ? "border-pv-success/40 text-pv-text" : "border-pv-warning/40 text-pv-text")}>
          <span className="text-pv-text-faint">in {vlPortName(vendor, d.port)} {d.tagIn === undefined ? "untagged" : `VID ${d.tagIn}`} · </span>
          {d.drop ? "dropped" : `VLAN ${d.vlan} (${vlanName(d.vlan!)}) · ${d.kind === "known" ? `→ ${vlPortName(vendor, d.out[0].port)}` : d.out.length ? `flood ${d.out.map((o) => vlPortName(vendor, o.port)).join(", ")}` : "no port carries it"}`}
          {decisions.length > 1 ? <span className="text-pv-text-faint"> · +{decisions.length - 1} more</span> : null}
        </p>
      )}
    </div>
  );
}
export { vlShortMac };
