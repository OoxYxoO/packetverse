"use client";

import { clsx } from "clsx";

interface AsPathTrailProps {
  asPath: number[];
  onHoverAs?: (asNumber: number | null) => void;
  highlighted?: number | null;
}

/**
 * Renders an AS_PATH as clickable/hoverable AS chips with arrows
 * between them, instead of a flat number string (brief §13). Purely
 * presentational — the path array itself is computed by the scenario
 * layer.
 */
export function AsPathTrail({ asPath, onHoverAs, highlighted }: AsPathTrailProps) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1 pv-mono text-[11px]">
      {asPath.map((as, i) => (
        <span key={`${as}-${i}`} className="inline-flex items-center gap-1">
          <button
            type="button"
            onMouseEnter={() => onHoverAs?.(as)}
            onMouseLeave={() => onHoverAs?.(null)}
            onClick={() => onHoverAs?.(as)}
            className={clsx(
              "rounded border px-1.5 py-0.5 transition-colors",
              highlighted === as ? "border-pv-cyan bg-pv-cyan/15 text-pv-cyan-soft" : "border-pv-border text-pv-text-muted hover:border-pv-cyan/40",
            )}
          >
            AS{as}
          </button>
          {i < asPath.length - 1 && <span className="text-pv-text-faint">→</span>}
        </span>
      ))}
    </span>
  );
}
