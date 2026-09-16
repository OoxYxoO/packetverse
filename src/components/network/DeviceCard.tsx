"use client";

import { clsx } from "clsx";
import { DeviceIcon } from "./DeviceIcon";
import type { NetNode } from "@/lib/sim-engine/types";

interface DeviceCardProps {
  node: NetNode;
  active?: boolean;
  established?: boolean;
  onClick?: () => void;
}

export function DeviceCard({ node, active, established, onClick }: DeviceCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        "group flex w-28 flex-col items-center gap-2 rounded-2xl border px-3 py-4 text-center transition-all duration-300 sm:w-36",
        established ? "pv-glow-success border-pv-success/40 bg-pv-success/5" : active ? "pv-glow-cyan border-pv-cyan/40 bg-pv-cyan/5" : "pv-glass",
        onClick && "cursor-pointer hover:-translate-y-0.5",
      )}
    >
      <span
        className={clsx(
          "flex h-11 w-11 items-center justify-center rounded-xl border",
          established ? "border-pv-success/50 text-pv-success" : active ? "border-pv-cyan/50 text-pv-cyan" : "border-pv-border-strong text-pv-text-muted",
        )}
      >
        <DeviceIcon kind={node.kind} className="h-6 w-6" />
      </span>
      <span className="text-xs font-medium text-pv-text sm:text-sm">{node.label}</span>
      {node.ip && <span className="pv-mono text-[10px] text-pv-text-faint">{node.ip}</span>}
      {node.mac && <span className="pv-mono text-[9px] text-pv-text-faint hidden sm:block">{node.mac}</span>}
    </button>
  );
}
