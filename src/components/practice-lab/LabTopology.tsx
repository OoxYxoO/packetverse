"use client";

import type { CSSProperties, ReactNode } from "react";
import { GraphTopologyViewer, type GraphEdge, type GraphNode, type GraphRegion } from "@/components/network/GraphTopologyViewer";

/**
 * Practice Lab topology host built on the shared GraphTopologyViewer, so a
 * lab renders the lesson's EXISTING node/edge/region definitions (same
 * network identity) from its own lab state. Adds what a lab needs on top:
 * a multi-hop packet overlay synced to the lab runner, small per-node tags
 * ("+ learned"), and a cue strip under the drawing. Protocol meaning (what
 * the packet is, what a tag says) always comes from the lesson.
 */

export interface LabPacketView {
  /** Changes per transmission/replay so the animation restarts. */
  id: number | string;
  /** Node ids the event travels through, in order. */
  path: string[];
  /** Index in `path` of the node the event has reached. */
  hop: number;
  done: boolean;
  /** Short label on the moving marker ("Hello", "UPDATE", "ARP Req", "L=16003"). */
  label: string;
  /** Accent colour (lesson-chosen; e.g. a protocol colour). */
  color: string;
  /** Accessible description, e.g. the PDU summary. */
  description?: string;
  onSelect?: () => void;
}

const nodePos = (nodes: GraphNode[], id: string) => nodes.find((n) => n.id === id);
const OVERLAY_KEYFRAMES = `@keyframes pv-lab-overlay-hop { from { left: var(--fx); top: var(--fy); } to { left: var(--tx); top: var(--ty); } } @media (prefers-reduced-motion: reduce) { .pv-lab-overlay { animation-duration: 1ms !important; } }`;

/** Animated event marker that rides above the path, one hop per `segmentMs`, resting at the last node reached. */
export function LabPacketOverlay({ nodes, packet, segmentMs = 1200, lift = 46 }: { nodes: GraphNode[]; packet: LabPacketView; segmentMs?: number; lift?: number }) {
  const from = nodePos(nodes, packet.path[packet.hop]);
  const to = !packet.done ? nodePos(nodes, packet.path[packet.hop + 1]) : undefined;
  if (!from) return null;
  const style: CSSProperties = to
    ? ({
        ["--fx" as string]: `${from.x}%`,
        ["--fy" as string]: `${from.y}%`,
        ["--tx" as string]: `${to.x}%`,
        ["--ty" as string]: `${to.y}%`,
        animation: `pv-lab-overlay-hop ${segmentMs}ms ease-in-out forwards`,
        transform: `translate(-50%, calc(-50% - ${lift}px))`,
      } as CSSProperties)
    : { left: `${from.x}%`, top: `${from.y}%`, transform: `translate(-50%, calc(-50% - ${lift}px))` };
  return (
    <>
      <style>{OVERLAY_KEYFRAMES}</style>
      <button
        key={`${packet.id}-${packet.hop}-${packet.done ? "rest" : "move"}`}
        type="button"
        onClick={packet.onSelect}
        disabled={!packet.onSelect}
        aria-label={packet.description ? `Inspect: ${packet.description}` : packet.label}
        className="pv-lab-overlay absolute z-20 rounded-full px-3 py-1 text-[12px] font-extrabold text-pv-bg shadow-lg disabled:cursor-default"
        style={{ ...style, background: packet.color, opacity: packet.done ? 0.55 : 0.95, boxShadow: `0 0 14px ${packet.color}88` }}
      >
        {packet.label}
      </button>
    </>
  );
}

export interface LabTopologyProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  regions?: GraphRegion[];
  highlightedRegionIds?: string[];
  activeNodeIds?: string[];
  selectedNodeId?: string;
  dimmedNodeIds?: string[];
  onNodeClick?: (id: string) => void;
  packet?: LabPacketView;
  /** Several events in flight at once (e.g. copies of one frame leaving different ports). Each advances and completes on its own; rendered in addition to `packet`. */
  packets?: LabPacketView[];
  segmentMs?: number;
  /** Small tag under a node, e.g. "+ MAC learned" — appears when the lesson says something just changed there. */
  nodeTags?: Record<string, string>;
  /** Cue chips under the drawing (decisions, boundaries…). */
  cues?: ReactNode[];
  className?: string;
}

export function LabTopology({ nodes, edges, regions, highlightedRegionIds, activeNodeIds, selectedNodeId, dimmedNodeIds, onNodeClick, packet, packets, segmentMs, nodeTags, cues, className = "h-full" }: LabTopologyProps) {
  return (
    <div className="flex h-full w-full flex-col">
      <div className="min-h-0 flex-1">
        <GraphTopologyViewer
          nodes={nodes}
          edges={edges}
          regions={regions}
          highlightedRegionIds={highlightedRegionIds}
          activeNodeIds={activeNodeIds}
          selectedNodeIds={selectedNodeId ? [selectedNodeId] : []}
          dimmedNodeIds={dimmedNodeIds}
          onNodeClick={onNodeClick}
          className={className}
        >
          {nodeTags &&
            Object.entries(nodeTags).map(([id, text]) => {
              const n = nodePos(nodes, id);
              if (!n) return null;
              return (
                <span key={`${id}-${text}`} className="pointer-events-none absolute z-20 -translate-x-1/2 rounded-full border border-pv-success/60 bg-pv-success/15 px-2 py-0.5 text-[10.5px] font-bold text-pv-success" style={{ left: `${n.x}%`, top: `calc(${n.y}% + 44px)` }}>
                  {text}
                </span>
              );
            })}
          {packet && <LabPacketOverlay nodes={nodes} packet={packet} segmentMs={segmentMs} />}
          {packets?.map((p) => <LabPacketOverlay key={p.id} nodes={nodes} packet={p} segmentMs={segmentMs} />)}
        </GraphTopologyViewer>
      </div>
      {cues && cues.length > 0 && (
        <ul className="mt-1 flex flex-wrap gap-1" aria-live="polite">
          {cues.map((c, i) => (
            <li key={i} className="rounded-full border border-pv-border px-2 py-0.5 text-[11px] font-semibold text-pv-text-muted">
              {c}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
