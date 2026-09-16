import { clsx } from "clsx";
import type { HTMLAttributes } from "react";

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: "cyan" | "success" | "warning" | "danger" | "violet" | "muted";
}

const toneClasses: Record<NonNullable<BadgeProps["tone"]>, string> = {
  cyan: "bg-pv-cyan/10 text-pv-cyan-soft border-pv-cyan/30",
  success: "bg-pv-success/10 text-pv-success border-pv-success/30",
  warning: "bg-pv-warning/10 text-pv-warning border-pv-warning/30",
  danger: "bg-pv-danger/10 text-pv-danger border-pv-danger/30",
  violet: "bg-pv-violet/10 text-pv-violet border-pv-violet/30",
  muted: "bg-white/5 text-pv-text-muted border-pv-border",
};

export function Badge({ className, tone = "muted", ...props }: BadgeProps) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide pv-mono",
        toneClasses[tone],
        className,
      )}
      {...props}
    />
  );
}
