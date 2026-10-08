"use client";

import { clsx } from "clsx";
import { useLayoutEffect, useRef, useState } from "react";
import { GraphTopologyViewer, type GraphEdge, type GraphNode, type GraphRegion } from "@/components/network/GraphTopologyViewer";
import { LabPacketOverlay, type LabPacketView } from "@/components/practice-lab/LabTopology";
import { TN_ADDR, TN_PORT_NAME, epText, tnListener, type TcpState, type Tcb, type TnCfg, type TnDev, type TnSnap } from "@/lib/sim-engine/scenarios/tcpNet";
import { MARKER_COLOR, STATE_TONE, marker, type TcpMoment } from "./tcpMoments";

/**
 * The TCP/UDP lab's network: Laptop — R1 — Server on the shared practice-lab stage (GraphTopologyViewer: subnet
 * regions, device cards, active glow) with the shared moving marker (LabPacketOverlay). Packets toward the Server ride
 * above the links, packets back ride below, so a burst of data and the ACKs coming the other way never cover each
 * other. Each endpoint wears its TCP state for this conversation; R1 wears none — it forwards IP packets and keeps no
 * TCP state, which is the point.
 */

const POS: Record<TnDev, { x: number; y: number }> = { laptop: { x: 20, y: 50 }, r1: { x: 50, y: 50 }, server: { x: 80, y: 50 } };
const REGIONS: GraphRegion[] = [
  { id: "lan", label: "client LAN 192.168.10.0/24", x: 3, y: 14, width: 30, height: 72, tone: "cyan" },
  { id: "srv", label: "server LAN 10.20.20.0/24", x: 67, y: 14, width: 30, height: 72, tone: "violet" },
];
const COMPACT_REGIONS: GraphRegion[] = [
  { id: "lan", label: "192.168.10.0/24", x: 2, y: 14, width: 34, height: 72, tone: "cyan" },
  { id: "srv", label: "10.20.20.0/24", x: 64, y: 14, width: 34, height: 72, tone: "violet" },
];
const COMPACT_POS: Record<TnDev, { x: number; y: number }> = { laptop: { x: 19, y: 50 }, r1: { x: 50, y: 50 }, server: { x: 81, y: 50 } };
const TONE: Record<string, string> = {
  muted: "border-pv-border bg-pv-bg/80 text-pv-text-faint",
  cyan: "border-pv-cyan/60 bg-[#06222a] text-pv-cyan-soft",
  warn: "border-pv-warning/60 bg-[#2a2006] text-pv-warning",
  ok: "border-pv-success/60 bg-[#062417] text-pv-success",
  violet: "border-pv-violet/60 bg-[#160f2a] text-pv-violet",
  bad: "border-pv-danger/60 bg-[#2a0b0b] text-pv-danger",
};
export const StatePill = ({ state, className }: { state?: TcpState | "LISTEN" | "none" | "refused" | "timeout"; className?: string }) => (
  <span className={clsx("inline-flex items-center rounded-full border px-2 py-0.5 pv-mono text-[11px] font-bold", state === "none" || !state ? TONE.muted : state === "refused" || state === "timeout" ? TONE.bad : TONE[STATE_TONE[state as TcpState]], className)}>{!state || state === "none" ? "no socket" : state === "refused" ? "refused" : state === "timeout" ? "timed out" : state}</span>
);

export function TcpTopology({ cfg, moment, prev, runKey, cursor, client, server, compact, onNode, selected }: { cfg: TnCfg; moment?: TcpMoment; prev?: TcpMoment; runKey: string; cursor: number; client?: Tcb; server?: Tcb; compact: boolean; onNode?: (d: TnDev) => void; selected?: TnDev }) {
  const stage = useRef<HTMLDivElement | null>(null);
  const [h, setH] = useState(300);
  useLayoutEffect(() => {
    const el = stage.current;
    if (!el) return;
    const upd = () => setH(el.clientHeight || 300);
    upd();
    const ro = new ResizeObserver(upd);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const pos = compact ? COMPACT_POS : POS;
  const nodes: GraphNode[] = [
    { id: "laptop", label: "Laptop", subLabel: cfg.laptop.ip, kind: "laptop", ...pos.laptop },
    { id: "r1", label: "R1", subLabel: "router", kind: "router", ...pos.r1 },
    { id: "server", label: "Server", subLabel: cfg.server.ip, kind: "server", ...pos.server },
  ];
  const ifc = cfg.r1.ifs;
  const edges: GraphEdge[] = [
    { id: "a", a: "laptop", b: "r1", label: compact ? undefined : "eth0 ↔ Gi0/0", state: ifc.gi0.up ? "full" : "down" },
    { id: "b", a: "r1", b: "server", label: compact ? undefined : `Gi0/1 ↔ eth0${ifc.gi1.badCable ? " · damaged cable" : ""}`, state: ifc.gi1.up ? (ifc.gi1.badCable ? "forming" : "full") : "down" },
  ];
  // Toward the Server: above the link (the marker's own lift). Back toward the Laptop: below it.
  const below = { dx: 0, dy: ((46 + 60) / h) * 100 };
  const packets: LabPacketView[] = [];
  moment?.copies.forEach((c, k) => {
    const back = c.from === "server" || (c.from === "r1" && c.to === "laptop");
    packets.push({ id: `${runKey}:${cursor}:${k}`, path: [c.from, c.to], hop: 0, done: false, label: compact ? marker(c.pkt).split(" ")[0] : marker(c.pkt), color: MARKER_COLOR(c.pkt), offset: back ? below : undefined, description: `${marker(c.pkt).replace(/ /g, " ")}: ${c.from} → ${c.to}` });
  });
  // What happened to packets that died on arrival in the previous moment stays on the device for one moment.
  prev?.copies
    .filter((c) => c.dropped)
    .forEach((c, k) => {
      const back = c.from === "server";
      packets.push({ id: `${runKey}:${cursor}:d${k}`, path: [c.from, c.to], hop: 1, done: true, label: c.dropped!.replace(/ /g, " "), color: "#f87171", offset: back ? below : undefined, description: c.dropped });
    });
  const stuck = moment?.stuck ?? prev?.stuck;
  if (stuck) packets.push({ id: `${runKey}:${cursor}:s`, path: [stuck.at, stuck.at], hop: 0, done: true, label: stuck.text.replace(/ /g, " "), color: "#f87171", offset: below, description: stuck.text });
  const active = [...new Set(moment?.copies.flatMap((c) => [c.from, c.to]) ?? [])];
  const chip = (d: "laptop" | "server", tcb?: Tcb) => {
    const state = tcb?.state ?? (d === "server" ? "LISTEN" : undefined);
    if (compact) return null;
    return (
      <span key={d} className={clsx("pointer-events-none absolute z-20 flex -translate-y-1/2 flex-col gap-0.5", d === "laptop" ? "-translate-x-full items-end" : "items-start")} style={{ left: d === "laptop" ? `calc(${pos.laptop.x}% - 64px)` : `calc(${pos.server.x}% + 64px)`, top: `${pos[d].y}%` }}>
        <span className="text-[9.5px] font-bold uppercase tracking-wide text-pv-text-faint">TCP state</span>
        <StatePill state={state ?? "none"} />
        {tcb && <span className="pv-mono text-[10px] text-pv-text-faint">:{tcb.local.port}</span>}
      </span>
    );
  };
  return (
    <div ref={stage} className="relative h-full">
      <GraphTopologyViewer nodes={nodes} edges={edges} regions={compact ? COMPACT_REGIONS : REGIONS} activeNodeIds={active} selectedNodeIds={selected ? [selected] : []} onNodeClick={onNode ? (id) => onNode(id as TnDev) : undefined} className="h-full">
        {chip("laptop", client)}
        {chip("server", server)}
        {packets.map((p) => (
          <LabPacketOverlay key={p.id} nodes={nodes} packet={p} segmentMs={850} />
        ))}
      </GraphTopologyViewer>
    </div>
  );
}

/** Under the stage: the conversation as two endpoints, R1's role, and the Server's ports. */
export function EndpointBar({ cfg, client, server, port, proto, result }: { cfg: TnCfg; client?: Tcb; server?: Tcb; port?: number; proto?: "tcp" | "udp"; result?: string }) {
  const listeners: { proto: "tcp" | "udp"; port: number }[] = [
    { proto: "tcp", port: 22 },
    { proto: "tcp", port: 80 },
    { proto: "tcp", port: 443 },
    { proto: "tcp", port: 8443 },
    { proto: "udp", port: 53 },
    ...cfg.server.nc.map((p) => ({ proto: "tcp" as const, port: p })),
  ];
  const clientState = client?.state ?? (result === "refused" ? "refused" : result === "timeout" ? "timeout" : undefined);
  return (
    <div className="space-y-1.5 text-[12px]">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-pv-text-faint">Laptop</span>
        <span className="pv-mono text-pv-text">{client ? epText(client.local) : `${TN_ADDR.laptop}:—`}</span>
        <StatePill state={clientState ?? "none"} />
        <span className="text-pv-text-faint" aria-hidden>
          ⇄
        </span>
        <span className="text-pv-text-faint">Server</span>
        <span className="pv-mono text-pv-text">
          {TN_ADDR.server}:{port ?? "—"}
        </span>
        <StatePill state={server?.state ?? (port && proto !== "udp" && tnListener(cfg, "tcp", port) ? "LISTEN" : "none")} />
        <span className="ml-auto rounded-full border border-pv-border px-2 py-0.5 text-[11px] text-pv-text-faint" title="Routers forward IP packets. TCP state lives only in the two endpoints.">
          R1: forwards IP packets · no TCP state
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-1" aria-label="Ports on the Server">
        <span className="text-[11px] text-pv-text-faint">One IP, many services — 10.20.20.20:</span>
        {listeners.map((l) => {
          const owner = tnListener(cfg, l.proto, l.port);
          const used = port === l.port && (proto ?? "tcp") === l.proto;
          return (
            <span key={`${l.proto}${l.port}`} className={clsx("rounded-md border px-1.5 py-0.5 pv-mono text-[11px]", used ? "border-pv-cyan bg-pv-cyan/15 text-pv-text" : "border-pv-border text-pv-text-muted", !owner && "line-through opacity-60")} title={owner ? `${owner} listens` : "nothing listens"}>
              {l.proto.toUpperCase()} {l.port} {TN_PORT_NAME[l.port] ?? owner ?? ""}
              <span className={clsx("ml-1 inline-block h-1.5 w-1.5 rounded-full align-middle", owner ? "bg-pv-success" : "bg-pv-danger")} />
            </span>
          );
        })}
      </div>
    </div>
  );
}

/** One endpoint's bookkeeping in plain words (with the RFC names underneath). */
export function NumbersCard({ who, tcb }: { who: string; tcb?: Tcb }) {
  if (!tcb || tcb.iss === undefined) return <div className="rounded-xl border border-pv-border p-2 text-[12px] text-pv-text-faint">{who}: no connection yet</div>;
  const row = (k: string, v: number | undefined, sub: string) => (
    <div className="rounded-md border border-pv-border px-1.5 py-1">
      <p className="text-[9.5px] font-bold uppercase tracking-wide text-pv-text-faint">{k}</p>
      <p className="pv-mono text-[13px] font-bold text-pv-text">{v ?? "—"}</p>
      <p className="text-[10px] text-pv-text-muted">{sub}</p>
    </div>
  );
  return (
    <div className="space-y-1 rounded-xl border border-pv-border p-2">
      <p className="flex items-center gap-2 text-[12px] font-semibold text-pv-text">
        {who} <StatePill state={tcb.state} />
      </p>
      <div className="grid grid-cols-3 gap-1">
        {row("next byte I send", tcb.sndNxt, "SND.NXT")}
        {row("oldest not yet acked", tcb.sndUna, `SND.UNA · ${tcb.unacked.length} waiting`)}
        {row("next byte I expect", tcb.rcvNxt, "RCV.NXT = the ACK I send")}
      </div>
      {tcb.ooo.length > 0 && <p className="text-[11px] text-pv-warning">holding bytes {tcb.ooo.map((o) => `${o.seq}–${o.seq + o.len - 1}`).join(", ")} out of order — a hole before them</p>}
    </div>
  );
}

export type { TnSnap };
