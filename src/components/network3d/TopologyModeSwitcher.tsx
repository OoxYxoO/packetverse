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
  /** Option values to render disabled (e.g. "Device" while historical timeline inspection is active) — click is a no-op, no styling implies it's selectable. Optional; every existing caller is unaffected. */
  disabledValues?: T[];
}

/**
 * Generic pill toggle-group (brief §7/§8). Not 3D-specific in
 * behavior — used for view mode (Physical/Logical/3D), Follow-Packet,
 * X-Ray, the existing Control/Data/Both plane toggle, and the Hop/Device
 * inspector-surface switch alike, so the same interaction-mode rows in a
 * lesson page share one component instead of copies of the same inline
 * pill markup.
 */
export function TopologyModeSwitcher<T extends string>({ options, value, onChange, tone = "cyan", disabledValues }: TopologyModeSwitcherProps<T>) {
  return (
    <div className="flex gap-1 rounded-full border border-pv-border p-0.5 w-fit">
      {options.map((opt) => {
        const disabled = disabledValues?.includes(opt.value) ?? false;
        return (
          <button
            key={opt.value}
            type="button"
            disabled={disabled}
            onClick={() => !disabled && onChange(opt.value)}
            className={clsx(
              "rounded-full px-3 py-1.5 text-xs font-semibold uppercase tracking-wide transition-colors",
              disabled
                ? "cursor-not-allowed text-pv-text-faint/40"
                : value === opt.value
                  ? tone === "violet"
                    ? "bg-pv-violet/15 text-pv-violet"
                    : "bg-pv-cyan/15 text-pv-cyan-soft"
                  : "text-pv-text-faint hover:text-pv-text",
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
