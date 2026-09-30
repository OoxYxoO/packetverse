"use client";

import { clsx } from "clsx";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { NOTE_LABEL, type NoteKind, type NotebookEntry } from "@/lib/sim-engine/scenarios/troubleshootingCommon";

/**
 * Troubleshooting notebook for the Troubleshooting-track lessons: the reasoning chain (symptom → observation →
 * inference → hypothesis → confirmed root cause → verified) exactly as it stood at the SHOWN step. Read-only — it
 * renders the entries the lesson's own state carries; nothing is persisted.
 */
const TONE: Record<NoteKind, string> = {
  symptom: "border-pv-warning/40 text-pv-warning",
  observation: "border-pv-cyan/40 text-pv-cyan-soft",
  inference: "border-pv-violet/40 text-pv-violet",
  hypothesis: "border-pv-text-faint/40 text-pv-text-muted",
  "ruled-out": "border-pv-text-faint/30 text-pv-text-faint line-through decoration-1",
  "root-cause": "border-pv-danger/50 text-pv-danger",
  verified: "border-pv-success/50 text-pv-success",
};

export function EvidenceNotebook({ entries, max = 9, title = "Troubleshooting notebook" }: { entries: NotebookEntry[]; max?: number; title?: string }) {
  const shown = entries.slice(-max);
  return (
    <GlassPanel className="p-4 text-[11px]">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-pv-cyan-soft">{title}</p>
        <p className="text-[10px] text-pv-text-faint">{entries.length ? `${entries.length} entr${entries.length === 1 ? "y" : "ies"}${entries.length > max ? ` · latest ${max}` : ""}` : "empty"}</p>
      </div>
      {shown.length === 0 ? (
        <p className="text-pv-text-faint">Nothing recorded yet — evidence first, conclusions later.</p>
      ) : (
        <ol className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
          {shown.map((e, i) => (
            <li key={`${e.stepId}-${i}`} className="flex gap-2">
              <span className={clsx("h-fit shrink-0 rounded border px-1.5 py-px text-[9.5px] font-semibold uppercase tracking-wide", TONE[e.kind])}>{NOTE_LABEL[e.kind]}</span>
              <span className="min-w-0 break-words text-pv-text">
                {e.text}
                {e.source && <span className="text-pv-text-faint"> · {e.source}</span>}
              </span>
            </li>
          ))}
        </ol>
      )}
    </GlassPanel>
  );
}
