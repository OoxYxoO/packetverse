"use client";

import { useEffect, useState } from "react";
import { clsx } from "clsx";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { Badge } from "@/components/ui/Badge";
import type { PacketVisual } from "@/lib/sim-engine/types";
import { useProgressStore } from "@/lib/state/useProgressStore";

interface PacketInspectorProps {
  packet: PacketVisual | undefined;
  /**
   * "X-ray" mode: indices (into packet.layers) of the layer(s) the
   * *current* router actually acts on — every other layer renders
   * dimmed/greyed instead of full-strength. Lets a lesson show, e.g.,
   * a P router caring only about the outer transport label while a
   * VPN label underneath sits untouched. Omit for normal behavior.
   */
  focusLayerIndices?: number[];
}

/**
 * Expandable "open the frame" inspector (brief §8/§27). Shows every
 * encapsulated layer for the currently selected/active packet —
 * including a full label *stack*, not just one label.
 */
export function PacketInspector({ packet, focusLayerIndices }: PacketInspectorProps) {
  const inspectPacket = useProgressStore((s) => s.inspectPacket);

  useEffect(() => {
    if (packet) inspectPacket();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [packet?.id]);

  if (!packet) {
    return (
      <GlassPanel className="p-5">
        <p className="text-sm text-pv-text-faint">No packet in flight — advance the scenario to see one here.</p>
      </GlassPanel>
    );
  }

  // Keyed by packet.id so local "which layer is open" state resets
  // naturally on every new packet instead of via an effect.
  return <PacketInspectorLayers key={packet.id} packet={packet} focusLayerIndices={focusLayerIndices} />;
}

function PacketInspectorLayers({ packet, focusLayerIndices }: { packet: PacketVisual; focusLayerIndices?: number[] }) {
  const [openLayer, setOpenLayer] = useState<string | null>(packet.layers[packet.layers.length - 1]?.name ?? null);
  const focusSet = focusLayerIndices ? new Set(focusLayerIndices) : null;

  return (
    <GlassPanel className="p-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-pv-text">Packet Inspector</h3>
        <Badge tone="cyan">{packet.protocol}</Badge>
      </div>
      <p className="mb-4 text-xs text-pv-text-muted">{packet.summary}</p>

      <div className="space-y-1.5">
        {packet.layers.map((layer, i) => {
          const dimmed = focusSet ? !focusSet.has(i) : false;
          return (
            <div key={layer.name} className={clsx("overflow-hidden rounded-lg border transition-opacity", dimmed ? "border-pv-border opacity-40" : "border-pv-cyan/40")}>
              <button
                type="button"
                onClick={() => setOpenLayer((cur) => (cur === layer.name ? null : layer.name))}
                className="flex w-full items-center justify-between px-3 py-2 text-left text-xs font-medium text-pv-text hover:bg-white/[0.03]"
              >
                <span className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-sm" style={{ background: layer.color }} />
                  {layer.name}
                  {!dimmed && focusSet && <span className="pv-mono text-[9px] text-pv-cyan-soft">← acted on here</span>}
                  {dimmed && focusSet && <span className="pv-mono text-[9px] text-pv-text-faint">present — not used for this hop&apos;s decision</span>}
                </span>
                <span className="text-pv-text-faint">{openLayer === layer.name ? "−" : "+"}</span>
              </button>
              {openLayer === layer.name && (
                <div className="space-y-1 border-t border-pv-border bg-black/20 px-3 py-2">
                  {layer.fields.map((f) => (
                    <div key={f.label} className="flex items-center justify-between gap-3 text-[11px]">
                      <span className="text-pv-text-faint">{f.label}</span>
                      <span className="pv-mono text-pv-text">{f.value}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </GlassPanel>
  );
}
