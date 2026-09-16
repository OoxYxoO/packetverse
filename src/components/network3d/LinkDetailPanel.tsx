"use client";

import { GlassPanel } from "@/components/ui/GlassPanel";
import { Badge } from "@/components/ui/Badge";
import type { LinkDetail } from "./types";

/** Panel shown for a clicked link (brief §10). Pure renderer over a LinkDetail the lesson's adapter computed. */
export function LinkDetailPanel({ detail, onClose }: { detail: LinkDetail; onClose?: () => void }) {
  return (
    <GlassPanel strong className="space-y-3 p-5">
      <div className="flex items-center justify-between">
        <h3 className="pv-mono text-sm font-bold text-pv-text">
          {detail.aLabel} ───── {detail.bLabel}
        </h3>
        <div className="flex items-center gap-2">
          <Badge tone={detail.status === "up" ? "success" : "danger"}>{detail.status.toUpperCase()}</Badge>
          {onClose && (
            <button type="button" onClick={onClose} className="text-xs text-pv-text-faint hover:text-pv-text">
              ✕
            </button>
          )}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 pv-mono text-[11px]">
        <div className="rounded-lg border border-pv-border p-2.5">
          <p className="mb-0.5 text-pv-text-faint">{detail.aLabel} interface</p>
          <p className="text-pv-text">
            {detail.aInterface.name} — {detail.aInterface.ip ?? "no IP"}
          </p>
        </div>
        <div className="rounded-lg border border-pv-border p-2.5">
          <p className="mb-0.5 text-pv-text-faint">{detail.bLabel} interface</p>
          <p className="text-pv-text">
            {detail.bInterface.name} — {detail.bInterface.ip ?? "no IP"}
          </p>
        </div>
      </div>
      {detail.mtu && (
        <p className="pv-mono text-[11px] text-pv-text-muted">
          MTU: <span className="text-pv-text">{detail.mtu}</span>
        </p>
      )}
      <div className="flex flex-wrap gap-1.5">
        {detail.protocols.map((p) => (
          <Badge key={p.label} tone="muted">
            {p.label}: {p.value}
          </Badge>
        ))}
      </div>
      {detail.currentTraffic && (
        <div className="rounded-lg border border-pv-cyan/30 bg-pv-cyan/5 p-2.5">
          <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-pv-cyan-soft">Current Traffic</p>
          <p className="pv-mono text-xs text-pv-text">{detail.currentTraffic}</p>
        </div>
      )}
    </GlassPanel>
  );
}
