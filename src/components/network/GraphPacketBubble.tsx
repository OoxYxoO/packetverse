"use client";

import { AnimatePresence, motion } from "framer-motion";
import type { PacketVisual } from "@/lib/sim-engine/types";
import { PROTOCOL_HEX, packetMessageLabel } from "@/components/lesson/packetCallout";

interface GraphPacketBubbleProps {
  packet: PacketVisual;
  from: { x: number; y: number };
  to: { x: number; y: number };
  /** Third line, e.g. "multicast 224.0.0.5" or "R1 → R3". */
  scope?: string;
  onSelect?: () => void;
  /** Title only, for several simultaneous copies (floods/reflections). */
  compact?: boolean;
  /** Overrides the derived title, e.g. "Reflected UPDATE" for a copy. */
  title?: string;
}

const START = 0.2;
const END = 0.82;
const lerp = (a: { x: number; y: number }, b: { x: number; y: number }, t: number) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
/** Keeps the centered bubble inside the viewer when an endpoint sits near an edge. */
const clampX = (x: number) => Math.min(80, Math.max(20, x));

/**
 * Readable in-flight packet for <GraphTopologyViewer>: a small marker moving
 * along the link plus a labeled bubble (message type, one-line detail,
 * scope) that rides beside it. The marker stops short of the destination
 * card, and the bubble flips below the path near the top edge, so neither
 * hides behind a device.
 */
export function GraphPacketBubble({ packet, from, to, scope, onSelect, compact, title: titleOverride }: GraphPacketBubbleProps) {
  const color = PROTOCOL_HEX[packet.protocol];
  const derived = packetMessageLabel(packet);
  const title = titleOverride ?? derived.title;
  const detail = derived.detail;
  const a = lerp(from, to, START);
  const b = lerp(from, to, END);
  const below = b.y < 35;
  const bubbleShift = below ? "-50% 16px" : "-50% calc(-100% - 16px)";

  return (
    <AnimatePresence mode="wait">
      <motion.div key={packet.id} className="pointer-events-none absolute inset-0 z-20" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
        <motion.span
          className="absolute h-3 w-3 rounded-full"
          style={{ background: color, boxShadow: `0 0 12px ${color}`, translate: "-50% -50%" }}
          initial={{ left: `${a.x}%`, top: `${a.y}%` }}
          animate={{ left: `${b.x}%`, top: `${b.y}%` }}
          transition={{ duration: 1.6, ease: "easeInOut" }}
        />
        <motion.button
          type="button"
          onClick={onSelect}
          disabled={!onSelect}
          className="pointer-events-auto absolute text-left disabled:cursor-default"
          style={{ translate: bubbleShift }}
          initial={{ left: `${clampX(a.x)}%`, top: `${a.y}%` }}
          animate={{ left: `${clampX(b.x)}%`, top: `${b.y}%` }}
          transition={{ duration: 1.6, ease: "easeInOut" }}
          aria-label={`${title}${detail ? `: ${detail}` : ""}`}
        >
          <span className="block w-max max-w-[13rem] rounded-xl border px-3 py-1.5 shadow-xl backdrop-blur-sm" style={{ borderColor: color, background: "rgba(8,12,22,0.94)", boxShadow: `0 0 20px ${color}44` }}>
            <span className="flex items-center gap-1.5 text-[11px] font-bold" style={{ color }}>
              <span className="h-1.5 w-1.5 shrink-0 animate-packet-pulse rounded-full" style={{ background: color }} />
              {title}
            </span>
            {!compact && detail && <span className="mt-0.5 block text-[11px] leading-snug text-pv-text">{detail}</span>}
            {!compact && scope && <span className="pv-mono mt-0.5 block text-[9px] uppercase tracking-wide text-pv-text-faint">{scope}</span>}
          </span>
        </motion.button>
      </motion.div>
    </AnimatePresence>
  );
}
