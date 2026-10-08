"use client";

import { clsx } from "clsx";
import { useState, type ReactNode } from "react";

/**
 * Build it yourself: one device, worked on directly. Overview (what it knows and did) · Configure (whatever really
 * configures this device: R1's CLI, the servers' files and services, the client's adapter, the switches' running
 * config) · Evidence (captures and tables). Configuration only takes effect the way it would on the real device:
 * on Enter in R1's config mode or on commit, on restart for dhcpd, on reload for named.
 */

export type { BuildApi } from "./buildApi";

export const Code = ({ children }: { children: string }) => <pre className="max-h-56 overflow-auto rounded-lg border border-pv-border bg-[#05080d] p-2 pv-mono text-[11px] leading-relaxed text-pv-text">{children}</pre>;
export const Note = ({ children }: { children: ReactNode }) => <p className="text-[12px] leading-snug text-pv-text-muted">{children}</p>;
export const Btn = ({ onClick, children, primary }: { onClick: () => void; children: ReactNode; primary?: boolean }) => (
  <button type="button" onClick={onClick} className={clsx("rounded-full px-3 py-1 text-[12px] font-semibold", primary ? "bg-pv-cyan text-[#03131a]" : "border border-pv-border text-pv-text-muted hover:text-pv-text")}>
    {children}
  </button>
);

/** A configuration file on a Linux server: edit, save, check, then restart/reload the service. */
export function FileEditor({ path, saved, onSave, check, apply, applyLabel, applyCmd, checkCmd, status, reference }: { path: string; saved: string; onSave: (t: string) => void; check: (t: string) => { error?: string; ok?: string }; apply: (t: string) => { error?: string; out?: string }; applyLabel: string; applyCmd: string; checkCmd: string; status: ReactNode; reference: ReactNode }) {
  const [text, setText] = useState(saved);
  const [out, setOut] = useState<{ tone: "ok" | "bad" | "info"; text: string } | undefined>(undefined);
  const dirty = text !== saved;
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center justify-between gap-1">
        <p className="pv-mono text-[11.5px] text-pv-text">
          {path} {dirty && <span className="text-pv-warning">· unsaved changes</span>}
        </p>
        <p className="text-[11.5px]">{status}</p>
      </div>
      <textarea value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} aria-label={path} rows={Math.min(18, Math.max(9, text.split("\n").length + 1))} className="w-full rounded-lg border border-pv-border bg-[#05080d] p-2 pv-mono text-[11.5px] leading-relaxed text-pv-text" />
      <div className="flex flex-wrap gap-1.5">
        <Btn onClick={() => (onSave(text), setOut({ tone: "info", text: `Saved ${path}. The service still runs its previous configuration until you ${applyLabel.toLowerCase()}.` }))}>Save file</Btn>
        <Btn onClick={() => { const r = check(text); setOut(r.error ? { tone: "bad", text: `$ ${checkCmd}\n${r.error}` } : { tone: "ok", text: `$ ${checkCmd}\n${r.ok}` }); }}>Check it</Btn>
        <Btn primary onClick={() => { if (dirty) onSave(text); const r = apply(text); setOut(r.error ? { tone: "bad", text: `$ ${applyCmd}\n${r.error}` } : { tone: "info", text: `$ ${applyCmd}\n${r.out ?? ""}\n$` }); }}>
          {dirty ? `Save and ${applyLabel.toLowerCase()}` : applyLabel}
        </Btn>
      </div>
      {out && <pre className={clsx("whitespace-pre-wrap rounded-lg border p-2 pv-mono text-[11px]", out.tone === "bad" ? "border-pv-danger/50 text-pv-danger" : out.tone === "ok" ? "border-pv-success/50 text-pv-success" : "border-pv-border text-pv-text-muted")}>{out.text}</pre>}
      <details className="rounded-lg border border-pv-border px-2 py-1">
        <summary className="cursor-pointer text-[11.5px] font-semibold text-pv-text-muted">Syntax reference</summary>
        <div className="mt-1 space-y-1 text-[11.5px] text-pv-text-muted">{reference}</div>
      </details>
    </div>
  );
}

