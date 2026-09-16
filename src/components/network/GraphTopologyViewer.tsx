"use client";

import type { ReactNode } from "react";
import { clsx } from "clsx";
import { DeviceIcon } from "./DeviceIcon";
import type { DeviceKind } from "@/lib/sim-engine/types";

export interface GraphNode {
  id: string;
  label: string;
  x: number; // 0..100, percentage
  y: number; // 0..100, percentage
  subLabel?: string;
  /** Defaults to "router" — set "cloud" for a non-peer node like an origin AS. */
  kind?: DeviceKind;
}

export type GraphEdgeState = "down" | "forming" | "full";

export interface GraphEdge {
  id: string;
  a: string;
  b: string;
  /** Numeric cost label (OSPF-style). Omit for protocols with no per-link cost (e.g. BGP peerings) — use `label` instead. */
  cost?: number;
  /** Short text label shown at the edge midpoint instead of/alongside cost (e.g. "eBGP" / "iBGP"). */
  label?: string;
  state?: GraphEdgeState;
}

export interface GraphRegion {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  tone?: "cyan" | "violet" | "warning" | "muted";
}

interface GraphTopologyViewerProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  activeNodeIds?: string[];
  bestPathEdgeIds?: string[];
  /** Labeled boundary boxes drawn behind nodes (e.g. AS boundaries) — purely visual grouping, non-interactive. */
  regions?: GraphRegion[];
  /** Region ids to highlight, e.g. while hovering an AS_PATH hop. */
  highlightedRegionIds?: string[];
  onNodeClick?: (id: string) => void;
  onEdgeClick?: (id: string) => void;
  /** Overlay content in the same 0..100 coordinate space (e.g. <GraphPacket>) */
  children?: ReactNode;
}

const EDGE_STYLE: Record<GraphEdgeState, { stroke: string; dash?: string; opacity: number }> = {
  down: { stroke: "#3a4460", dash: "4 4", opacity: 0.6 },
  forming: { stroke: "var(--pv-warning)", dash: "2 3", opacity: 0.85 },
  full: { stroke: "var(--pv-success)", opacity: 0.9 },
};

const REGION_TONE: Record<NonNullable<GraphRegion["tone"]>, string> = {
  cyan: "border-pv-cyan/40 bg-pv-cyan/[0.04]",
  violet: "border-pv-violet/40 bg-pv-violet/[0.04]",
  warning: "border-pv-warning/40 bg-pv-warning/[0.04]",
  muted: "border-pv-border-strong bg-white/[0.02]",
};

/**
 * Generic 2D graph topology renderer — nodes placed by explicit {x,y}
 * percentage coordinates and connected by labeled edges, for
 * topologies that aren't a straight line (OSPF's diamond, BGP's
 * multi-AS map, etc). Sibling to <TopologyViewer> (which lays nodes
 * out on a single horizontal track); pick whichever shape fits the
 * scenario.
 *
 * Like <TopologyViewer>, this only renders state handed to it by a
 * ScenarioEngine snapshot — no protocol logic lives here, and nothing
 * stops a future React-Three-Fiber renderer from subscribing to the
 * same engine/state shape instead of this component.
 */
export function GraphTopologyViewer({
  nodes,
  edges,
  activeNodeIds = [],
  bestPathEdgeIds = [],
  regions = [],
  highlightedRegionIds = [],
  onNodeClick,
  onEdgeClick,
  children,
}: GraphTopologyViewerProps) {
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));

  return (
    <div className="pv-grid-bg relative h-96 w-full overflow-hidden rounded-2xl border border-pv-border bg-pv-bg-elevated sm:h-[26rem]">
      {regions.map((r) => (
        <div
          key={r.id}
          className={clsx(
            "pointer-events-none absolute rounded-xl border transition-colors duration-300",
            REGION_TONE[r.tone ?? "muted"],
            highlightedRegionIds.includes(r.id) && "!border-pv-cyan pv-glow-cyan",
          )}
          style={{ left: `${r.x}%`, top: `${r.y}%`, width: `${r.width}%`, height: `${r.height}%` }}
        >
          <span className="absolute -top-2.5 left-2.5 rounded bg-pv-bg-elevated px-1.5 text-[9px] font-semibold uppercase tracking-wide text-pv-text-faint">
            {r.label}
          </span>
        </div>
      ))}

      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
        {edges.map((edge) => {
          const a = byId[edge.a];
          const b = byId[edge.b];
          if (!a || !b) return null;
          const style = EDGE_STYLE[edge.state ?? "down"];
          const isBest = bestPathEdgeIds.includes(edge.id);
          return (
            <g key={edge.id}>
              {isBest && (
                <line
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke="var(--pv-cyan)"
                  strokeWidth={1.4}
                  strokeLinecap="round"
                  opacity={0.55}
                  vectorEffect="non-scaling-stroke"
                />
              )}
              <line
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke={style.stroke}
                strokeDasharray={style.dash}
                strokeWidth={isBest ? 0.7 : 0.4}
                opacity={style.opacity}
                vectorEffect="non-scaling-stroke"
                className="cursor-pointer"
                onClick={onEdgeClick ? () => onEdgeClick(edge.id) : undefined}
                pointerEvents="stroke"
              />
            </g>
          );
        })}
      </svg>

      {/* Edge labels rendered as HTML overlays, not SVG foreignObject —
          the viewBox is stretched non-uniformly to fill the container,
          which would distort foreignObject text sizing. */}
      {edges.map((edge) => {
        const a = byId[edge.a];
        const b = byId[edge.b];
        if (!a || !b) return null;
        const text = edge.label ?? (edge.cost !== undefined ? String(edge.cost) : undefined);
        if (!text) return null;
        const isBest = bestPathEdgeIds.includes(edge.id);
        const midX = (a.x + b.x) / 2;
        const midY = (a.y + b.y) / 2;
        return (
          <div
            key={`label-${edge.id}`}
            className={clsx(
              "absolute z-10 flex h-5 min-w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center whitespace-nowrap rounded px-1.5 pv-mono text-[10px] font-bold",
              isBest ? "bg-pv-cyan/20 text-pv-cyan-soft" : "bg-black/50 text-pv-text-faint",
            )}
            style={{ left: `${midX}%`, top: `${midY}%` }}
          >
            {text}
          </div>
        );
      })}

      {nodes.map((node) => (
        <button
          key={node.id}
          type="button"
          onClick={onNodeClick ? () => onNodeClick(node.id) : undefined}
          className={clsx(
            "absolute z-10 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1 rounded-xl border px-3 py-2.5 text-center transition-all duration-300",
            activeNodeIds.includes(node.id) ? "pv-glow-cyan border-pv-cyan/50 bg-pv-cyan/10" : "pv-glass",
            onNodeClick && "cursor-pointer hover:-translate-y-[calc(50%+2px)]",
          )}
          style={{ left: `${node.x}%`, top: `${node.y}%` }}
        >
          <span
            className={clsx(
              "flex h-9 w-9 items-center justify-center rounded-lg border",
              activeNodeIds.includes(node.id) ? "border-pv-cyan/50 text-pv-cyan" : "border-pv-border-strong text-pv-text-muted",
            )}
          >
            <DeviceIcon kind={node.kind ?? "router"} className="h-5 w-5" />
          </span>
          <span className="text-xs font-semibold text-pv-text">{node.label}</span>
          {node.subLabel && <span className="pv-mono text-[9px] text-pv-text-faint">{node.subLabel}</span>}
        </button>
      ))}

      {children}
    </div>
  );
}
