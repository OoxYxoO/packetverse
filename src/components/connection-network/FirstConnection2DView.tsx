"use client";

import { AnimatePresence, motion } from "framer-motion";
import { GraphTopologyViewer, type GraphEdge } from "@/components/network/GraphTopologyViewer";
import type { PacketVisual } from "@/lib/sim-engine/types";
import { GRAPH_LINKS, GRAPH_NODES, linksOnPath } from "@/lib/sim-engine/scenarios/firstConnection";
import { packetColor, packetKindLabel } from "./presentation";

interface FirstConnection2DViewProps {
  activePacket?: PacketVisual;
  activeNodeIds: string[];
  visitedLinkIds: Set<string>;
  onSelectNode: (id: string) => void;
  onSelectLink: (id: string) => void;
  onSelectPacket: () => void;
  /** Fill the parent's height (Focus Mode) instead of the viewer's default fixed height. */
  fill?: boolean;
}

/** Bubble rides this far above the node row, so it never covers a device card. */
const BUBBLE_Y = 22;
/** Keeps the centered bubble inside the viewer when an endpoint sits at the edge (the Laptop is at x=8%). */
const clampX = (x: number) => Math.min(80, Math.max(20, x));

/**
 * Flat 2D view of the first-connection topology built on the shared
 * <GraphTopologyViewer>. The in-flight packet is a readable bubble
 * (kind, one-line summary, broadcast/unicast scope) moving above the
 * devices along the actual path, so it can't hide behind a chassis.
 */
export function FirstConnection2DView({ activePacket, activeNodeIds, visitedLinkIds, onSelectNode, onSelectLink, onSelectPacket, fill }: FirstConnection2DViewProps) {
  const activeLinks = activePacket ? linksOnPath(activePacket.from, activePacket.to) : [];
  const edges: GraphEdge[] = GRAPH_LINKS.map((l) => ({ id: l.id, a: l.a, b: l.b, label: l.label, state: activeLinks.includes(l.id) || visitedLinkIds.has(l.id) ? "full" : "down" }));
  const from = activePacket ? GRAPH_NODES.find((n) => n.id === activePacket.from) : undefined;
  const to = activePacket ? GRAPH_NODES.find((n) => n.id === activePacket.to) : undefined;
  const color = activePacket ? packetColor(activePacket) : undefined;
  const scope = activePacket?.broadcast ? "Broadcast · FF:FF:FF:FF:FF:FF" : activePacket?.protocol === "ARP" ? `Unicast · ${from?.label} → ${to?.label}` : `${from?.label} → ${to?.label}`;
  const switchNode = GRAPH_NODES.find((n) => n.id === "switch");

  return (
    <div className={fill ? "h-full [&>div]:!h-full [&>div]:rounded-none [&>div]:border-0" : undefined}>
      <GraphTopologyViewer nodes={GRAPH_NODES} edges={edges} activeNodeIds={activeNodeIds} bestPathEdgeIds={activeLinks} onNodeClick={onSelectNode} onEdgeClick={onSelectLink}>
        {activePacket && from && to && color && (
          <>
            {/* Trail from source to destination at bubble height. */}
            <div className="pointer-events-none absolute z-10 h-0.5 -translate-y-1/2 rounded-full" style={{ left: `${Math.min(from.x, to.x)}%`, width: `${Math.abs(to.x - from.x)}%`, top: `${BUBBLE_Y + 6}%`, background: `linear-gradient(90deg, transparent, ${color}88, transparent)` }} />
            {activePacket.broadcast && switchNode && (
              <span className="pointer-events-none absolute z-10 -translate-x-1/2 rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider" style={{ left: `${switchNode.x}%`, top: `${switchNode.y + 17}%`, color, borderColor: `${color}88`, background: "rgba(8,12,22,0.9)" }}>
                floods all ports
              </span>
            )}
            <AnimatePresence mode="wait">
              <motion.button
                key={activePacket.id}
                type="button"
                onClick={onSelectPacket}
                initial={{ left: `${clampX(from.x)}%`, opacity: 0, scale: 0.85 }}
                animate={{ left: `${clampX(to.x)}%`, opacity: 1, scale: 1 }}
                transition={{ duration: 1.6, ease: "easeInOut" }}
                className="group absolute z-20 -translate-x-1/2 -translate-y-1/2 cursor-pointer text-left"
                style={{ top: `${BUBBLE_Y}%` }}
                aria-label={`${packetKindLabel(activePacket)}: ${activePacket.summary}`}
              >
                <span className="block w-max max-w-[13rem] rounded-xl border px-3 py-2 shadow-xl backdrop-blur-sm transition-transform group-hover:scale-105" style={{ borderColor: color, background: "rgba(8,12,22,0.94)", boxShadow: `0 0 22px ${color}44` }}>
                  <span className="flex items-center gap-1.5 text-[11px] font-bold" style={{ color }}>
                    <span className="h-1.5 w-1.5 shrink-0 animate-packet-pulse rounded-full" style={{ background: color }} />
                    {packetKindLabel(activePacket)}
                  </span>
                  <span className="mt-0.5 block text-[11px] leading-snug text-pv-text">{activePacket.summary}</span>
                  <span className="pv-mono mt-1 block text-[9px] uppercase tracking-wide text-pv-text-faint">{scope}</span>
                </span>
                <span className="mx-auto block h-3 w-px" style={{ background: color }} />
              </motion.button>
            </AnimatePresence>
          </>
        )}
      </GraphTopologyViewer>
    </div>
  );
}
