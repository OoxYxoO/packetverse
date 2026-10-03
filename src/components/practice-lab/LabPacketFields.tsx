"use client";

import type { PacketVisual } from "@/lib/sim-engine/types";

/**
 * Read-only PDU field view for a Practice Lab (any protocol). Unlike the
 * lesson's PacketInspector it records nothing in lesson progress. `notes`
 * (field label → teaching note) lets the lesson point at the fields that
 * matter for the current event.
 */
export function LabPacketFields({ packet, notes = {} }: { packet: PacketVisual; notes?: Record<string, string> }) {
  return (
    <div className="rounded-xl border border-pv-border p-3" aria-label="Packet fields">
      {packet.layers.map((layer) => (
        <div key={layer.name} className="mb-2 last:mb-0">
          <p className="mb-1 text-[11px] font-bold" style={{ color: layer.color }}>
            {layer.name}
          </p>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 pv-mono text-[11px]">
            {layer.fields.map((f) => (
              <div key={f.label} className="contents">
                <dt className="text-pv-text-faint">{f.label}</dt>
                <dd className="min-w-0 break-words text-pv-text">
                  {f.value}
                  {notes[f.label] && <span className="ml-2 font-sans text-[10.5px] text-pv-warning">← {notes[f.label]}</span>}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </div>
  );
}
