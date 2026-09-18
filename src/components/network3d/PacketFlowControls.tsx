"use client";

import { clsx } from "clsx";
import { Button } from "@/components/ui/Button";

export type PlaySpeed = 0.5 | 1 | 2;

interface PacketFlowControlsProps {
  playing: boolean;
  onTogglePlay: () => void;
  onPrevHop: () => void;
  onNextHop: () => void;
  onReset: () => void;
  canPrevHop: boolean;
  canNextHop: boolean;
  speed: PlaySpeed;
  onSpeedChange: (s: PlaySpeed) => void;
  followPacket: boolean;
  onToggleFollowPacket?: () => void;
  showLabels?: boolean;
  onToggleShowLabels?: () => void;
  showInterfaces?: boolean;
  onToggleShowInterfaces?: () => void;
  packetXray?: boolean;
  onTogglePacketXray?: () => void;
  view3D?: boolean;
  onToggleView3D?: () => void;
}

/**
 * Reusable Focus Mode traffic controls (brief §15). A lesson only sees
 * the buttons whose corresponding capability was actually wired up —
 * every toggle is optional and simply omitted from the strip when its
 * handler is undefined, rather than rendering a dead control (brief
 * §15: "Do not show a control if the current lesson does not support
 * it").
 */
export function PacketFlowControls({
  playing,
  onTogglePlay,
  onPrevHop,
  onNextHop,
  onReset,
  canPrevHop,
  canNextHop,
  speed,
  onSpeedChange,
  followPacket,
  onToggleFollowPacket,
  showLabels,
  onToggleShowLabels,
  showInterfaces,
  onToggleShowInterfaces,
  packetXray,
  onTogglePacketXray,
  view3D,
  onToggleView3D,
}: PacketFlowControlsProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {onToggleView3D && (
        <button type="button" onClick={onToggleView3D} className="rounded-full border border-pv-border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-pv-text-faint transition-colors hover:text-pv-text" aria-label="Toggle 2D/3D view">
          {view3D ? "3D" : "2D"}
        </button>
      )}
      <Button size="sm" variant="secondary" onClick={onPrevHop} disabled={!canPrevHop} aria-label="Previous hop">
        ⏮ Prev Hop
      </Button>
      <Button size="sm" onClick={onTogglePlay} aria-label={playing ? "Pause traffic" : "Play traffic"}>
        {playing ? "⏸ Pause" : "▶ Play Traffic"}
      </Button>
      <Button size="sm" variant="secondary" onClick={onNextHop} disabled={!canNextHop} aria-label="Next hop">
        Next Hop ⏭
      </Button>
      <Button size="sm" variant="ghost" onClick={onReset} aria-label="Reset journey">
        ⟲ Reset
      </Button>

      <div className="flex gap-1 rounded-full border border-pv-border p-0.5" role="group" aria-label="Playback speed">
        {([0.5, 1, 2] as const).map((s) => (
          <button key={s} type="button" onClick={() => onSpeedChange(s)} className={clsx("rounded-full px-2.5 py-1 text-[10px] font-semibold pv-mono transition-colors", speed === s ? "bg-pv-cyan/15 text-pv-cyan-soft" : "text-pv-text-faint hover:text-pv-text")}>
            {s}x
          </button>
        ))}
      </div>

      {onToggleFollowPacket && (
        <button
          type="button"
          onClick={onToggleFollowPacket}
          aria-pressed={followPacket}
          className={clsx("rounded-full border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide transition-colors", followPacket ? "border-pv-cyan/50 bg-pv-cyan/15 text-pv-cyan-soft" : "border-pv-border text-pv-text-faint hover:text-pv-text")}
        >
          Follow Packet
        </button>
      )}
      {onToggleShowLabels && (
        <button
          type="button"
          onClick={onToggleShowLabels}
          aria-pressed={showLabels}
          className={clsx("rounded-full border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide transition-colors", showLabels ? "border-pv-cyan/50 bg-pv-cyan/15 text-pv-cyan-soft" : "border-pv-border text-pv-text-faint hover:text-pv-text")}
        >
          Show Labels
        </button>
      )}
      {onToggleShowInterfaces && (
        <button
          type="button"
          onClick={onToggleShowInterfaces}
          aria-pressed={showInterfaces}
          className={clsx("rounded-full border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide transition-colors", showInterfaces ? "border-pv-cyan/50 bg-pv-cyan/15 text-pv-cyan-soft" : "border-pv-border text-pv-text-faint hover:text-pv-text")}
        >
          Show Interfaces
        </button>
      )}
      {onTogglePacketXray && (
        <button
          type="button"
          onClick={onTogglePacketXray}
          aria-pressed={packetXray}
          className={clsx("rounded-full border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide transition-colors", packetXray ? "border-pv-violet/50 bg-pv-violet/15 text-pv-violet" : "border-pv-border text-pv-text-faint hover:text-pv-text")}
        >
          Packet X-Ray
        </button>
      )}
    </div>
  );
}
