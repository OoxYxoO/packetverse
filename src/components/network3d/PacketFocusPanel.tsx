"use client";

import { clsx } from "clsx";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";

interface PacketFocusPanelProps {
  currentHopLabel?: string;
  hopIndex: number;
  totalHops: number;
  onPrevHop: () => void;
  onNextHop: () => void;
  canPrev: boolean;
  canNext: boolean;
  cameraFollow: boolean;
  onToggleCameraFollow: () => void;
}

/**
 * Follow-Packet controls (brief §3). Next/Previous Hop are thin
 * wrappers the page supplies over the SAME engine.advance()/goTo()
 * used by the ordinary step controls — a "hop" here is just a lesson
 * step that carries a packet, so no parallel simulation exists.
 */
export function PacketFocusPanel({ currentHopLabel, hopIndex, totalHops, onPrevHop, onNextHop, canPrev, canNext, cameraFollow, onToggleCameraFollow }: PacketFocusPanelProps) {
  return (
    <GlassPanel className="p-4">
      <div className="mb-2 flex items-center justify-between">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-pv-text-muted">Follow Packet</h4>
        <Badge tone="cyan">
          Hop {hopIndex} / {totalHops}
        </Badge>
      </div>
      <p className="mb-3 pv-mono text-xs text-pv-text">{currentHopLabel ?? "No packet in flight yet."}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" onClick={onPrevHop} disabled={!canPrev}>
          ← Previous Hop
        </Button>
        <Button size="sm" onClick={onNextHop} disabled={!canNext}>
          Next Hop →
        </Button>
        <button
          type="button"
          onClick={onToggleCameraFollow}
          className={clsx(
            "ml-auto rounded-full border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide transition-colors",
            cameraFollow ? "border-pv-cyan/50 bg-pv-cyan/15 text-pv-cyan-soft" : "border-pv-border text-pv-text-faint hover:text-pv-text",
          )}
        >
          {cameraFollow ? "Camera Following" : "Camera Free"}
        </button>
      </div>
    </GlassPanel>
  );
}
