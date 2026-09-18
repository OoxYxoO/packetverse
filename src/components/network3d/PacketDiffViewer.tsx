"use client";

import { clsx } from "clsx";
import { GlassPanel } from "@/components/ui/GlassPanel";
import type { PacketMutation, PacketStackFrame } from "./types";

interface PacketDiffViewerProps {
  before?: PacketStackFrame[];
  after?: PacketStackFrame[];
  /** Plain-text fallback when a lesson only supplies the old opaque `packetBefore`/`packetAfter` strings (brief §40). */
  beforeText?: string;
  afterText?: string;
  mutations?: PacketMutation[];
}

const TONE_CLASS: Record<PacketStackFrame["tone"], string> = {
  transport: "border-pv-cyan/40 bg-pv-cyan/5 text-pv-text",
  vpn: "border-pv-violet/40 bg-pv-violet/5 text-pv-text",
  ip: "border-pv-border-strong bg-white/[0.02] text-pv-text-muted",
  generic: "border-pv-border bg-white/[0.02] text-pv-text-muted",
};

function Stack({ frames, highlightChanged }: { frames: PacketStackFrame[]; highlightChanged: boolean }) {
  return (
    <div className="space-y-1">
      {frames.map((f) => (
        <div
          key={f.id}
          className={clsx(
            "rounded-md border px-2.5 py-1.5 pv-mono text-[11px] transition-colors",
            TONE_CLASS[f.tone],
            highlightChanged && f.justChanged && "!border-pv-warning !bg-pv-warning/10 !text-pv-warning",
          )}
        >
          {f.text}
        </div>
      ))}
    </div>
  );
}

/**
 * Generic before/after packet-stack comparison (brief §20/§43/§44) —
 * built to hold future Ethernet/VLAN/IPv6/GRE/UDP/VXLAN/SRH/inner-frame
 * layers without redesign; it just walks whatever `PacketStackFrame[]`
 * a lesson hands it and flags changed frames. No protocol logic lives
 * here — a lesson's Scene Adapter decides which frame is "changed".
 */
export function PacketDiffViewer({ before, after, beforeText, afterText, mutations }: PacketDiffViewerProps) {
  const hasFrames = (before && before.length > 0) || (after && after.length > 0);

  return (
    <GlassPanel strong className="space-y-3 p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-pv-cyan-soft">Before / After</h3>

      {hasFrames ? (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-pv-text-faint">Before</p>
            <Stack frames={before ?? []} highlightChanged={false} />
          </div>
          <div>
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-pv-text-faint">After</p>
            <Stack frames={after ?? []} highlightChanged />
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 pv-mono text-[11px]">
          <div className="rounded-md border border-pv-border bg-white/[0.02] px-2.5 py-2 text-pv-text-muted">{beforeText ?? "—"}</div>
          <div className="rounded-md border border-pv-cyan/30 bg-pv-cyan/5 px-2.5 py-2 text-pv-cyan-soft">{afterText ?? "—"}</div>
        </div>
      )}

      {mutations && mutations.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {mutations.map((m, i) => (
            <span key={i} className="rounded-full border border-pv-warning/40 bg-pv-warning/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-pv-warning">
              {m.type}
              {m.detail ? `: ${m.detail}` : ""}
            </span>
          ))}
        </div>
      )}
    </GlassPanel>
  );
}
