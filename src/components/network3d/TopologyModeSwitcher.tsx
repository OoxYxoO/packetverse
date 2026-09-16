"use client";

import { clsx } from "clsx";

export interface ModeOption<T extends string> {
  value: T;
  label: string;
}

interface TopologyModeSwitcherProps<T extends string> {
  options: ModeOption<T>[];
  value: T;
  onChange: (value: T) => void;
  tone?: "cyan" | "violet";
}

/**
 * Generic pill toggle-group (brief §7/§8). Not 3D-specific in
 * behavior — used for view mode (Physical/Logical/3D), Follow-Packet,
 * X-Ray, and the existing Control/Data/Both plane toggle alike, so the
 * same five interaction-mode rows in a lesson page share one component
 * instead of five copies of the same inline pill markup.
 */
export function TopologyModeSwitcher<T extends string>({ options, value, onChange, tone = "cyan" }: TopologyModeSwitcherProps<T>) {
  return (
    <div className="flex gap-1 rounded-full border border-pv-border p-0.5 w-fit">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={clsx(
            "rounded-full px-3 py-1.5 text-xs font-semibold uppercase tracking-wide transition-colors",
            value === opt.value ? (tone === "violet" ? "bg-pv-violet/15 text-pv-violet" : "bg-pv-cyan/15 text-pv-cyan-soft") : "text-pv-text-faint hover:text-pv-text",
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
