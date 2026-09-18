"use client";

import { GlassPanel } from "@/components/ui/GlassPanel";
import { Badge } from "@/components/ui/Badge";
import type { DeviceInterfaceData, DeviceProcessingTrace } from "./types";

interface HopInspectorPanelProps {
  trace: DeviceProcessingTrace;
  deviceName: string;
  interfaces?: DeviceInterfaceData[];
  onFocusNextHop?: (deviceId: string) => void;
}

function ifaceLabel(id: string | undefined, interfaces: DeviceInterfaceData[] | undefined) {
  if (!id) return undefined;
  return interfaces?.find((i) => i.id === id)?.name ?? id;
}

function Row({ label, value, tone }: { label: string; value: string; tone?: "cyan" | "muted" }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-pv-border/60 py-1.5 last:border-b-0">
      <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-pv-text-faint">{label}</span>
      <span className={`pv-mono text-right text-[12px] ${tone === "cyan" ? "text-pv-cyan-soft" : "text-pv-text"}`}>{value}</span>
    </div>
  );
}

/**
 * Generic Hop Inspector (brief §17/§19) — the "what happened at THIS
 * device, at THIS hop" panel. Every value it renders comes straight
 * off `DeviceProcessingTrace`; it computes nothing (brief §38). Falls
 * back gracefully to the pre-existing `forwardingAction`/`packetBefore`/
 * `packetAfter` fields when a lesson hasn't populated the newer
 * ingress/egress/lookup/nextHop/reason fields (brief §40).
 */
export function HopInspectorPanel({ trace, deviceName, interfaces, onFocusNextHop }: HopInspectorPanelProps) {
  const ingress = ifaceLabel(trace.ingressInterfaceId, interfaces);
  const egress = ifaceLabel(trace.egressInterfaceId, interfaces);
  const hasRichFields = trace.lookupType || trace.lookupKey || trace.lookupResult || trace.reason || trace.nextHopLabel;

  return (
    <GlassPanel strong className="space-y-3 p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-pv-cyan-soft">Hop Inspector</h3>
        <Badge tone="cyan">{deviceName}</Badge>
      </div>

      <div className="space-y-0.5">
        {ingress && <Row label="Ingress" value={ingress} />}
        {trace.lookupType && <Row label="Lookup" value={trace.lookupType} />}
        {trace.lookupKey && <Row label="Match" value={trace.lookupKey} tone="cyan" />}
        {(trace.lookupResult || trace.forwardingAction) && <Row label="Action" value={trace.lookupResult ?? trace.forwardingAction ?? "—"} tone="cyan" />}
        {egress && <Row label="Egress" value={egress} />}
        {trace.nextHopLabel && <Row label="Next Hop" value={trace.nextHopLabel} />}
        {!hasRichFields && trace.forwardingAction && !egress && !ingress && <Row label="Forwarding Action" value={trace.forwardingAction} />}
      </div>

      {trace.reason && (
        <div className="rounded-lg border border-pv-cyan/25 bg-pv-cyan/5 p-2.5">
          <p className="mb-0.5 text-[9px] font-semibold uppercase tracking-wide text-pv-cyan-soft">Why</p>
          <p className="text-[11px] leading-snug text-pv-text-muted">{trace.reason}</p>
        </div>
      )}

      {trace.nextHopId && onFocusNextHop && (
        <button
          type="button"
          onClick={() => onFocusNextHop(trace.nextHopId!)}
          className="w-full rounded-full border border-pv-border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-pv-text-faint transition-colors hover:border-pv-cyan/40 hover:text-pv-cyan-soft"
        >
          Inspect {trace.nextHopLabel ?? trace.nextHopId} →
        </button>
      )}

      {!ingress && !egress && !hasRichFields && !trace.forwardingAction && <p className="text-[11px] text-pv-text-faint">No forwarding activity recorded at this device yet.</p>}
    </GlassPanel>
  );
}
