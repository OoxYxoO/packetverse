"use client";

import { useState } from "react";
import { clsx } from "clsx";
import { GlassPanel } from "@/components/ui/GlassPanel";

export interface CliVendorOutput {
  cmd: string;
  output: string;
}

export interface CliCommandEntry {
  id: string;
  label: string;
  cisco: CliVendorOutput;
  juniper: CliVendorOutput;
}

interface CLIOutputPanelProps {
  commands: CliCommandEntry[];
}

/**
 * Read-only, vendor-tabbed CLI panel (brief §10 — "a read-only
 * realistic CLI panel is enough for this stage"). The command output
 * strings are computed by the caller from live scenario state, so
 * this component itself carries no protocol knowledge and no
 * hardcoded vendor docs — it just renders {cmd, output} pairs. The
 * same shape supports a later interactive CLITerminal without
 * changing how a lesson supplies its commands.
 */
export function CLIOutputPanel({ commands }: CLIOutputPanelProps) {
  const [vendor, setVendor] = useState<"cisco" | "juniper">("cisco");
  const [activeId, setActiveId] = useState(commands[0]?.id);
  const active = commands.find((c) => c.id === activeId) ?? commands[0];
  const entry = active ? active[vendor] : undefined;

  return (
    <GlassPanel className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-pv-text-muted">CLI</h4>
        <div className="flex gap-1 rounded-full border border-pv-border p-0.5">
          {(["cisco", "juniper"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setVendor(v)}
              className={clsx(
                "rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide transition-colors",
                vendor === v ? "bg-pv-cyan/15 text-pv-cyan-soft" : "text-pv-text-faint hover:text-pv-text",
              )}
            >
              {v === "cisco" ? "Cisco IOS" : "Junos"}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-2 flex flex-wrap gap-1.5">
        {commands.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setActiveId(c.id)}
            className={clsx(
              "rounded-md border px-2 py-1 text-[10px] pv-mono transition-colors",
              c.id === active?.id ? "border-pv-cyan/40 bg-pv-cyan/10 text-pv-cyan-soft" : "border-pv-border text-pv-text-faint hover:text-pv-text",
            )}
          >
            {c.label}
          </button>
        ))}
      </div>

      <div className="rounded-lg border border-pv-border bg-black/40 p-3">
        {entry && (
          <>
            <p className="pv-mono text-[11px] text-pv-cyan-soft">
              <span className="text-pv-text-faint">{"> "}</span>
              {entry.cmd}
            </p>
            <pre className="mt-2 overflow-x-auto whitespace-pre pv-mono text-[10.5px] leading-relaxed text-pv-text-muted">{entry.output}</pre>
          </>
        )}
      </div>
    </GlassPanel>
  );
}
