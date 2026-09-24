"use client";

import type { ReactNode } from "react";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { Badge } from "@/components/ui/Badge";
import { PacketInspector } from "@/components/network/PacketInspector";
import type { PacketVisual } from "@/lib/sim-engine/types";
import type { NodeExplanation } from "./types";

interface NodeInspectorPanelProps {
  explanation: NodeExplanation | undefined;
  /** The packet as it exists at/through this node, for the X-ray strip — undefined when no packet is in flight here yet. */
  packet?: PacketVisual;
  /** Which packet layer(s) this node actually acts on, when X-ray mode is on. */
  focusLayerIndices?: number[];
  xrayEnabled?: boolean;
  /** Action row (e.g. an "Enter Device →" button) — this is Quick Inspect, so the page decides what else is offered. */
  children?: ReactNode;
}

/**
 * Reusable clicked-node "Quick Inspect" (brief §1/§2). Renders
 * whatever `NodeExplanation` the lesson page computed — it has no
 * idea what a VRF or a transport label is, it just lays out the
 * fields.
 */
export function NodeInspectorPanel({ explanation, packet, focusLayerIndices, xrayEnabled, children }: NodeInspectorPanelProps) {
  if (!explanation) {
    return (
      <GlassPanel className="p-5">
        <p className="text-sm text-pv-text-faint">Click any device in the 3D scene to inspect it.</p>
      </GlassPanel>
    );
  }

  return (
    <GlassPanel strong className="space-y-3 p-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="pv-mono text-lg font-bold text-pv-text">{explanation.name}</h3>
          <p className="text-[11px] uppercase tracking-wide text-pv-text-faint">{explanation.deviceType}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone="cyan">{explanation.role}</Badge>
          {children}
        </div>
      </div>

      <div className="rounded-lg border border-pv-cyan/30 bg-pv-cyan/5 p-3">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-pv-cyan-soft">Current Action</p>
        <p className="text-sm text-pv-text">{explanation.currentAction}</p>
      </div>

      {(explanation.controlPlaneRole || explanation.dataPlaneRole) && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {explanation.controlPlaneRole && (
            <div className="rounded-lg border border-pv-border p-2.5">
              <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-pv-text-faint">Control Plane</p>
              <p className="text-xs text-pv-text-muted">{explanation.controlPlaneRole}</p>
            </div>
          )}
          {explanation.dataPlaneRole && (
            <div className="rounded-lg border border-pv-border p-2.5">
              <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-pv-text-faint">Data Plane</p>
              <p className="text-xs text-pv-text-muted">{explanation.dataPlaneRole}</p>
            </div>
          )}
        </div>
      )}

      {(explanation.packetBefore || explanation.packetAfter) && (
        <div className="rounded-lg border border-pv-border p-2.5 pv-mono text-[11px]">
          {explanation.packetBefore && (
            <p className="text-pv-text-muted">
              Before: <span className="text-pv-text">{explanation.packetBefore}</span>
            </p>
          )}
          {explanation.packetAfter && (
            <p className="text-pv-text-muted">
              After: <span className="text-pv-cyan-soft">{explanation.packetAfter}</span>
            </p>
          )}
        </div>
      )}

      {explanation.note && <p className="rounded-lg border border-pv-warning/30 bg-pv-warning/5 p-2.5 text-xs text-pv-text-muted">{explanation.note}</p>}

      {explanation.tables?.map((t) => (
        <div key={t.title} className="rounded-lg border border-pv-border p-2.5">
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-pv-text-faint">{t.title}</p>
          <div className="space-y-0.5 pv-mono text-[11px]">
            {t.rows.map((r, rowIndex) => (
              // Labels are not unique (an MTU-s has several "AC" bridge ports), so the sibling index disambiguates these static rows.
              <div key={`${r.label}-${r.value}-${rowIndex}`} className="flex justify-between gap-3">
                <span className="text-pv-text-faint">{r.label}</span>
                <span className="text-pv-text">{r.value}</span>
              </div>
            ))}
          </div>
        </div>
      ))}

      {xrayEnabled && packet && (
        <div>
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-pv-cyan-soft">X-Ray — Packet At This Node</p>
          <PacketInspector packet={packet} focusLayerIndices={focusLayerIndices} />
        </div>
      )}
    </GlassPanel>
  );
}
