"use client";

import { GlassPanel } from "@/components/ui/GlassPanel";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { PacketInspector } from "@/components/network/PacketInspector";
import type { PacketVisual } from "@/lib/sim-engine/types";

interface PacketDetailPanelProps {
  packet: PacketVisual;
  currentDevice: string;
  direction: string;
  focusLayerIndices?: number[];
  paused: boolean;
  onResume: () => void;
  onStepForward: () => void;
  onStepBack: () => void;
  canStepForward: boolean;
  canStepBack: boolean;
  onClose?: () => void;
}

/**
 * The packet itself, as a selectable object (brief §9). Pauses the
 * lesson's animation and exposes Step Forward/Back — thin wrappers
 * over engine.advance()/goTo() supplied by the page, exactly like
 * <PacketFocusPanel>'s hop controls.
 */
export function PacketDetailPanel({ packet, currentDevice, direction, focusLayerIndices, paused, onResume, onStepForward, onStepBack, canStepForward, canStepBack, onClose }: PacketDetailPanelProps) {
  return (
    <GlassPanel strong className="space-y-3 p-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-pv-text">Packet Inspector</h3>
        <div className="flex items-center gap-2">
          {paused && <Badge tone="warning">Paused</Badge>}
          {onClose && (
            <button type="button" onClick={onClose} className="text-xs text-pv-text-faint hover:text-pv-text">
              ✕
            </button>
          )}
        </div>
      </div>
      <div className="pv-mono text-[11px] text-pv-text-muted">
        <p>
          Current Device: <span className="text-pv-text">{currentDevice}</span>
        </p>
        <p>
          Direction: <span className="text-pv-text">{direction}</span>
        </p>
      </div>
      <PacketInspector packet={packet} focusLayerIndices={focusLayerIndices} />
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" onClick={onStepBack} disabled={!canStepBack}>
          ← Step Back
        </Button>
        <Button variant={paused ? "primary" : "secondary"} size="sm" onClick={onResume}>
          ▶ Resume
        </Button>
        <Button size="sm" onClick={onStepForward} disabled={!canStepForward}>
          Step Forward →
        </Button>
      </div>
    </GlassPanel>
  );
}
