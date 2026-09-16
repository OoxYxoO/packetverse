"use client";

import { motion, AnimatePresence } from "framer-motion";
import type { PacketVisual } from "@/lib/sim-engine/types";
import { PROTOCOL_META } from "./AnimatedPacket";

interface GraphPacketProps {
  packet: PacketVisual;
  from: { x: number; y: number };
  to: { x: number; y: number };
  onSelect?: () => void;
}

/**
 * <AnimatedPacket>'s counterpart for <GraphTopologyViewer> — tweens
 * between two {x,y} percentage points instead of a single horizontal
 * track. Same clickable, protocol-labeled packet chip either way.
 */
export function GraphPacket({ packet, from, to, onSelect }: GraphPacketProps) {
  const meta = PROTOCOL_META[packet.protocol];

  return (
    <AnimatePresence mode="wait">
      <motion.button
        key={packet.id}
        type="button"
        onClick={onSelect}
        initial={{ left: `${from.x}%`, top: `${from.y}%`, opacity: 0, scale: 0.6 }}
        animate={{ left: `${to.x}%`, top: `${to.y}%`, opacity: 1, scale: 1 }}
        transition={{ duration: 1.6, ease: "easeInOut" }}
        className="group absolute z-20 -translate-x-1/2 -translate-y-1/2 cursor-pointer"
        aria-label={`${packet.protocol} packet: ${packet.summary}`}
      >
        <span
          className="flex items-center gap-1.5 rounded-full border px-2.5 py-1 pv-mono text-[10px] font-bold shadow-lg backdrop-blur-sm transition-transform group-hover:scale-110"
          style={{
            borderColor: meta.color,
            color: meta.color,
            background: "rgba(8,12,22,0.9)",
            boxShadow: `0 0 16px ${meta.color}55`,
          }}
        >
          <span className="h-1.5 w-1.5 rounded-full animate-packet-pulse" style={{ background: meta.color }} />
          {packet.badge ?? meta.glyph}
          {packet.broadcast && <span className="text-pv-text-faint">•MCAST</span>}
        </span>
      </motion.button>
    </AnimatePresence>
  );
}
