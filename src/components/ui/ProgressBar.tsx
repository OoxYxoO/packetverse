import { clsx } from "clsx";

interface ProgressBarProps {
  value: number; // 0..100
  label?: string;
  tone?: "cyan" | "success" | "warning" | "violet";
  className?: string;
}

const toneClasses: Record<NonNullable<ProgressBarProps["tone"]>, string> = {
  cyan: "bg-pv-cyan",
  success: "bg-pv-success",
  warning: "bg-pv-warning",
  violet: "bg-pv-violet",
};

export function ProgressBar({ value, label, tone = "cyan", className }: ProgressBarProps) {
  const pct = Math.min(100, Math.max(0, value));
  return (
    <div className={clsx("w-full", className)}>
      {label && (
        <div className="mb-1.5 flex items-center justify-between text-xs">
          <span className="text-pv-text-muted">{label}</span>
          <span className="pv-mono text-pv-text">{Math.round(pct)}%</span>
        </div>
      )}
      <div className="h-2 w-full overflow-hidden rounded-full bg-white/5">
        <div
          className={clsx("h-full rounded-full transition-[width] duration-700 ease-out", toneClasses[tone])}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
