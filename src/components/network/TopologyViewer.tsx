"use client";

import type { ReactNode } from "react";
import type { NetNode } from "@/lib/sim-engine/types";
import { DeviceCard } from "./DeviceCard";

interface TopologyViewerProps {
  nodes: NetNode[];
  activeNodeIds?: string[];
  establishedNodeIds?: string[];
  onNodeClick?: (id: string) => void;
  /** Overlay content positioned in the same coordinate space (e.g. AnimatedPacket) */
  children?: ReactNode;
}

/**
 * Generic, data-driven topology renderer (brief §38). Nodes are laid
 * out left-to-right by their `track` (0..1). This is the DOM/2D
 * implementation of the visualization layer — it reads only from
 * ScenarioEngine snapshots and never touches protocol logic. A 3D
 * (React-Three-Fiber) renderer can subscribe to the exact same engine
 * without any change to /lib/sim-engine.
 */
export function TopologyViewer({ nodes, activeNodeIds = [], establishedNodeIds = [], onNodeClick, children }: TopologyViewerProps) {
  return (
    <div className="pv-grid-bg relative h-72 w-full overflow-hidden rounded-2xl border border-pv-border bg-pv-bg-elevated sm:h-80">
      {/* connecting line */}
      <div className="absolute left-[4%] right-[4%] top-1/2 h-px -translate-y-1/2 bg-gradient-to-r from-pv-border via-pv-border-strong to-pv-border" />

      {nodes.map((node) => (
        <div
          key={node.id}
          className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2"
          style={{ left: `${node.track * 100}%` }}
        >
          <DeviceCard
            node={node}
            active={activeNodeIds.includes(node.id)}
            established={establishedNodeIds.includes(node.id)}
            onClick={onNodeClick ? () => onNodeClick(node.id) : undefined}
          />
        </div>
      ))}

      {children}
    </div>
  );
}
