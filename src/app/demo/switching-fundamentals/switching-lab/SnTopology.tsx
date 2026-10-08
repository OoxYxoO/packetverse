"use client";

import { clsx } from "clsx";
import { GraphTopologyViewer, type GraphEdge, type GraphNode, type GraphRegion } from "@/components/network/GraphTopologyViewer";
import { LabPacketOverlay, type LabPacketView } from "@/components/practice-lab/LabTopology";
import { SN_HOSTS, SN_UPLINKS, isSw, isUplink, snMacName, snPortUp, snShortMac, snTable, type SnCfg, type SnDecision, type SnDev, type SnEntry, type SnHost, type SnSnap, type SnSw } from "@/lib/sim-engine/scenarios/switchNet";
import { SN_TRAVEL_MS, fateOf, markerColor, markerLabel, type SnMoment } from "./snMoments";
import { snPortName } from "./snCli";
import type { CliVendor } from "@/lib/cli/types";

/**
 * The Switching Lab network on the shared practice-lab stage (GraphTopologyViewer: region, glass device cards, active
 * glow) with the shared moving marker (LabPacketOverlay). Each switch's OWN table is drawn right above it, so the
 * entry a frame teaches appears on the switch the frame just reached — and the other switch's table visibly doesn't
 * change. Parallel SW1↔SW2 cables are drawn apart, and each copy rides the cable it was sent on.
 */

const POS: Record<string, { x: number; y: number }> = { "HOST-A": { x: 9, y: 26 }, "HOST-D": { x: 9, y: 80 }, SW1: { x: 33, y: 63 }, SW2: { x: 67, y: 63 }, "HOST-B": { x: 91, y: 26 }, "HOST-C": { x: 91, y: 80 }, "SW1 ge-0/0/3": { x: 33, y: 90 }, "SW2 ge-0/0/3": { x: 67, y: 90 } };
const COMPACT: Record<string, { x: number; y: number }> = { "HOST-A": { x: 13, y: 18 }, "HOST-D": { x: 13, y: 82 }, SW1: { x: 33, y: 50 }, SW2: { x: 67, y: 50 }, "HOST-B": { x: 87, y: 18 }, "HOST-C": { x: 87, y: 82 }, "SW1 ge-0/0/3": { x: 40, y: 86 }, "SW2 ge-0/0/3": { x: 60, y: 86 } };
/** Where a host is drawn: by the port it is plugged into (a moved host is drawn at its new port). */
const HOME: Record<string, string> = { "SW1 ge-0/0/1": "HOST-A", "SW1 ge-0/0/2": "HOST-D", "SW2 ge-0/0/1": "HOST-B", "SW2 ge-0/0/2": "HOST-C" };
const LINK_DY: Record<string, number> = { "ge-0/0/23": -4.5, "ge-0/0/24": 4.5, "ge-0/0/22": 12 };
const REGION: GraphRegion[] = [{ id: "l2", label: "one broadcast domain", x: 2, y: 4, width: 96, height: 92, tone: "muted" }];

export function hostSpot(cfg: SnCfg, h: SnHost, compact: boolean) {
  const at = cfg.hosts[h].at;
  if (!at) return undefined;
  const key = `${at.sw} ${at.port}`;
  const pos = compact ? COMPACT : POS;
  return pos[HOME[key] ?? key];
}
const edgeId = (from: SnDev, to: SnDev, port: string) => (isSw(from) && isSw(to) ? `up-${port}` : `acc-${isSw(from) ? to : from}`);

export function SnTopology({ cfg, snap, moment, prev, landed, runKey, cursor, compact, onNode, selected, showPorts, tableCards = true, vendor = "juniper" }: { vendor?: CliVendor; cfg: SnCfg; snap: SnSnap; moment?: SnMoment; prev?: SnMoment; landed: boolean; runKey: string; cursor: number; compact: boolean; onNode?: (d: SnDev) => void; selected?: SnDev; showPorts: boolean; tableCards?: boolean }) {
  const pos = compact ? COMPACT : POS;
  const hosts = SN_HOSTS.filter((h) => cfg.hosts[h].at);
  const nodes: GraphNode[] = [
    { id: "SW1", label: "SW1", subLabel: compact ? undefined : `${snTable(cfg, snap.fdb, "SW1").length} MACs`, kind: "switch", ...pos.SW1 },
    { id: "SW2", label: "SW2", subLabel: compact ? undefined : `${snTable(cfg, snap.fdb, "SW2").length} MACs`, kind: "switch", ...pos.SW2 },
    ...hosts.map((h) => ({ id: h, label: compact ? h.replace("HOST-", "") : h, subLabel: compact ? undefined : snShortMac(cfg.hosts[h].mac), kind: "laptop" as const, ...hostSpot(cfg, h, compact)! })),
  ];
  const edges: GraphEdge[] = [
    ...hosts.map((h) => {
      const at = cfg.hosts[h].at!;
      return { id: `acc-${h}`, a: at.sw, b: h, label: showPorts && !compact ? snPortName(vendor, at.port) : undefined, state: snPortUp(cfg, at.sw, at.port) ? ("full" as const) : ("down" as const) };
    }),
    ...SN_UPLINKS.filter((p) => cfg.cables[p]).map((p) => ({ id: `up-${p}`, a: "SW1", b: "SW2", label: compact ? undefined : showPorts ? `${snPortName(vendor, p)}${snPortUp(cfg, "SW1", p) ? "" : " · off"}` : p === "ge-0/0/23" ? "uplink" : snPortUp(cfg, "SW1", p) ? "2nd link" : "2nd cable · off", state: snPortUp(cfg, "SW1", p) ? ("full" as const) : ("down" as const), offset: { dx: 0, dy: LINK_DY[p] } })),
  ];
  const packets: LabPacketView[] = [];
  // Markers ride the cable between two points just short of each device, so they never sit on a device card.
  const track: GraphNode[] = [];
  const at = (id: string) => nodes.find((x) => x.id === id);
  moment?.markers.forEach((m, k) => {
    const id = edgeId(m.from, m.to, m.fromPort);
    const dy = isUplink(m.fromPort) && isSw(m.to) ? LINK_DY[m.fromPort] : 0;
    const a = at(m.from);
    const b = at(m.to);
    if (!a || !b) return;
    const f = isSw(m.from) && isSw(m.to) ? 0.22 : 0.26;
    track.push({ id: `t${k}a`, label: "", x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f }, { id: `t${k}b`, label: "", x: b.x - (b.x - a.x) * f, y: b.y - (b.y - a.y) * f });
    packets.push({ id: `${runKey}:${cursor}:${k}`, path: [`t${k}a`, `t${k}b`], hop: 0, done: false, label: markerLabel(cfg, m, compact), color: markerColor(m.frame), offset: { dx: 0, dy }, description: `${markerLabel(cfg, m, false)}: ${m.from} → ${m.to} (${id})` });
  });
  const trackNodes = [...nodes, ...track];
  // What each copy's arrival meant (accepted, discarded, filtered) stays on the device during the next moment.
  if (prev)
    prev.markers.forEach((m, k) => {
      const f = fateOf(prev, m);
      if (!f) return;
      packets.push({ id: `${runKey}:${cursor}:f${k}`, path: [m.to, m.to], hop: 0, done: true, label: f.text.replace(/ /g, " "), color: f.tone === "ok" ? "#10b981" : f.tone === "bad" ? "#f87171" : "#64748b", offset: { dx: 0, dy: (at(m.to)?.y ?? 50) > 66 ? -15 : 15 }, description: `${m.to}: ${f.text}` });
    });
  const active = [...new Set(moment?.markers.flatMap((m) => [m.from, m.to]) ?? [])];
  const shownDecisions = landed ? moment?.decisions : prev?.decisions;
  return (
    <div className="relative h-full">
      <GraphTopologyViewer nodes={nodes} edges={edges} regions={REGION} activeNodeIds={active} selectedNodeIds={selected ? [selected] : []} onNodeClick={onNode ? (id) => onNode(id as SnDev) : undefined} className="h-full">
        {!compact && tableCards && (["SW1", "SW2"] as SnSw[]).map((sw) => <FdbCard key={sw} sw={sw} vendor={vendor} cfg={cfg} snap={snap} decisions={shownDecisions?.filter((d) => d.sw === sw) ?? []} style={{ left: sw === "SW1" ? "17%" : "51%", top: "3%", width: "32%" }} floating />)}
        {packets.map((p) => (
          <LabPacketOverlay key={p.id} nodes={trackNodes} packet={p} segmentMs={SN_TRAVEL_MS} lift={0} />
        ))}
      </GraphTopologyViewer>
    </div>
  );
}

/**
 * One switch's own MAC table, at the moment on screen: which port leads to each MAC, from THIS switch's position — a
 * host on another switch sits behind the uplink. Rows taught by the frame that just arrived light up; the decision
 * the switch just made is written under it.
 */
export function FdbCard({ sw, cfg, snap, decisions, style, floating, className, vendor = "juniper", short }: { short?: boolean; vendor?: CliVendor; sw: SnSw; cfg: SnCfg; snap: SnSnap; decisions: SnDecision[]; style?: React.CSSProperties; floating?: boolean; className?: string }) {
  const rows = snTable(cfg, snap.fdb, sw);
  const fresh = new Map(decisions.filter((d) => d.learn === "learned" || d.learn === "moved").map((d) => [d.frame.src, d]));
  const d = decisions[decisions.length - 1];
  const total = decisions.reduce((a, x) => a + x.n, 0);
  return (
    <div className={clsx("rounded-xl border bg-pv-bg/90 p-1.5 shadow-lg backdrop-blur", floating && "absolute z-[15]", decisions.length ? "border-pv-cyan/50" : "border-pv-border", className)} style={style}>
      <p className="flex items-center justify-between gap-1 px-0.5 text-[10px] font-bold uppercase tracking-wide text-pv-text-faint">
        <span>{short ? `${sw} table` : `${sw} · its own MAC table`}</span>
        <span className="pv-mono normal-case">{rows.length ? `${rows.length} entr${rows.length === 1 ? "y" : "ies"}` : "empty"}</span>
      </p>
      {rows.length === 0 ? (
        <p className="px-0.5 py-1 text-[11px] text-pv-text-faint">No entries yet: {sw} has not received a frame.</p>
      ) : (
        <table className="w-full text-left text-[11px]">
          <tbody className="pv-mono">
            {rows.map((e: SnEntry) => {
              const f = fresh.get(e.mac);
              const local = !isUplink(e.port);
              return (
                <tr key={`${e.mac}${f ? `-${d?.frame.id}` : ""}`} className={clsx(f && "pv-pop", f?.learn === "moved" ? "bg-pv-danger/15" : f ? "bg-pv-success/15" : "")}>
                  <td className="px-0.5 font-semibold text-pv-text">{snMacName(cfg, e.mac).replace("HOST-", "")}</td>
                  <td className="px-0.5 text-pv-text-faint">{snShortMac(e.mac)}</td>
                  <td className={clsx("px-0.5", local ? "text-pv-text" : "text-pv-violet")}>{snPortName(vendor, e.port)}</td>
                  <td className="px-0.5 font-sans text-[10px] text-pv-text-muted">
                    {e.type === "static" ? <b className="text-pv-warning">static</b> : local ? "here" : "uplink"}
                    {f?.learn === "moved" ? <b className="text-pv-danger"> moved</b> : f ? <b className="text-pv-success"> new</b> : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {d && (
        <p key={`${d.frame.id}-${d.port}-${total}`} className={clsx("pv-pop mt-1 rounded-md border px-1 py-0.5 text-[10.5px] leading-snug", d.kind === "known" ? "border-pv-success/40 text-pv-text" : d.kind === "filter" || d.kind === "blackhole" ? "border-pv-danger/40 text-pv-text" : "border-pv-warning/40 text-pv-text")}>
          <span className="text-pv-text-faint">in {snPortName(vendor, d.port)}{total > 1 ? ` ×${total}` : ""} · </span>
          {d.frame.dst === "FF:FF:FF:FF:FF:FF" ? "broadcast → flood" : d.kind === "unknown" ? `${snMacName(cfg, d.frame.dst).replace("HOST-", "")}? not in table → flood` : d.kind === "known" ? `${snMacName(cfg, d.frame.dst).replace("HOST-", "")} → ${snPortName(vendor, d.hit!.port)} → 1 port` : d.kind === "filter" ? `${snMacName(cfg, d.frame.dst).replace("HOST-", "")} is behind ${snPortName(vendor, d.port)} → filter` : "port down → drop"}
          {decisions.length > 1 ? <span className="text-pv-text-faint"> · +{decisions.length - 1} more</span> : null}
        </p>
      )}
    </div>
  );
}
