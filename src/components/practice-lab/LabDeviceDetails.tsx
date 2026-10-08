"use client";

import type { ReactNode } from "react";

/** Small contextual inspection card for a clicked lab device — the lesson supplies every fact (no giant panels). */
export function LabDeviceDetails({ title, rows, action, onClose, label }: { title: string; rows: [string, string][]; action?: ReactNode; onClose: () => void; label?: string }) {
  return (
    <div className="relative rounded-xl border border-pv-border bg-pv-bg-elevated/80 p-2.5 text-[12px] text-pv-text-muted" role="region" aria-label={label ?? `${title} details`}>
      <button type="button" onClick={onClose} aria-label="Close device details" className="absolute right-2 top-1.5 text-pv-text-faint hover:text-pv-text">
        ×
      </button>
      <p className="mb-1 pr-5 text-[12.5px] font-semibold text-pv-text">{title}</p>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-[11.5px]">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-pv-text-faint">{k}</dt>
            <dd className="min-w-0 break-words pv-mono text-pv-text">{v}</dd>
          </div>
        ))}
      </dl>
      {action && <div className="mt-1.5">{action}</div>}
    </div>
  );
}

/** Standard "Inspect in CLI →" action for device cards. */
export function InspectInCliButton({ onClick, label = "Inspect in CLI →" }: { onClick: () => void; label?: string }) {
  return (
    <button type="button" onClick={onClick} className="rounded-md border border-pv-cyan/40 px-2 py-0.5 text-[11px] font-semibold text-pv-cyan-soft hover:bg-pv-cyan/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-pv-cyan">
      {label}
    </button>
  );
}
