"use client";

import { GlassPanel } from "@/components/ui/GlassPanel";
import { Badge } from "@/components/ui/Badge";
import type { FocusableObjectKind } from "./types";

const KIND_LABEL: Record<FocusableObjectKind, string> = {
  stage: "Processing Stage",
  packetLayer: "Packet Layer",
  interface: "Interface",
  link: "Link",
};

interface ObjectFocusPanelProps {
  kind: FocusableObjectKind;
  title: string;
  /** Plain label/value pairs — only fields the caller actually has data for ("3D Inspection & Selection UX Pass" §7/§8/§9: "only show fields actually supplied"). */
  fields: { label: string; value: string }[];
  onBack: () => void;
  onOverview: () => void;
  backLabel?: string;
}

/**
 * Generic detail card shown while a 3D sub-object (forwarding-pipeline
 * stage, packet/header layer, interface anchor) is camera-focused
 * ("3D Inspection & Selection UX Pass" §7/§8/§9/§19). It renders only
 * `title` + `fields` handed to it — no protocol knowledge, no lookup of
 * its own. The caller is responsible for deriving `fields` from real
 * domain data (`DeviceProcessingTrace`, `PacketStackFrame`,
 * `DeviceInterfaceData`) and omitting anything not actually modeled.
 * Link focus reuses <LinkDetailPanel> instead of this component (brief
 * §10: "do not duplicate link-state logic").
 */
export function ObjectFocusPanel({ kind, title, fields, onBack, onOverview, backLabel }: ObjectFocusPanelProps) {
  return (
    <GlassPanel strong className="space-y-3 p-4">
      <div className="flex items-center justify-between">
        <h3 className="pv-mono text-sm font-bold text-pv-text">{title}</h3>
        <Badge tone="violet">{KIND_LABEL[kind]}</Badge>
      </div>
      <div className="space-y-0.5">
        {fields.map((f) => (
          <div key={f.label} className="flex items-baseline justify-between gap-3 border-b border-pv-border/60 py-1.5 last:border-b-0">
            <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-pv-text-faint">{f.label}</span>
            <span className="pv-mono text-right text-[12px] text-pv-text">{f.value}</span>
          </div>
        ))}
        {fields.length === 0 && <p className="text-[11px] text-pv-text-faint">No further detail modeled for this object yet.</p>}
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={onBack} className="rounded-full border border-pv-border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-pv-text-faint transition-colors hover:border-pv-cyan/40 hover:text-pv-cyan-soft">
          ← {backLabel ?? "Back to Device"}
        </button>
        <button type="button" onClick={onOverview} className="rounded-full border border-pv-border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-pv-text-faint transition-colors hover:border-pv-cyan/40 hover:text-pv-cyan-soft">
          Overview
        </button>
      </div>
    </GlassPanel>
  );
}
