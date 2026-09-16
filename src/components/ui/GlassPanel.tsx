import { clsx } from "clsx";
import type { HTMLAttributes } from "react";

interface GlassPanelProps extends HTMLAttributes<HTMLDivElement> {
  strong?: boolean;
  glow?: "cyan" | "success" | "danger" | "none";
}

export function GlassPanel({ className, strong, glow = "none", ...props }: GlassPanelProps) {
  return (
    <div
      className={clsx(
        "rounded-2xl",
        strong ? "pv-glass-strong" : "pv-glass",
        glow === "cyan" && "pv-glow-cyan",
        glow === "success" && "pv-glow-success",
        glow === "danger" && "pv-glow-danger",
        className,
      )}
      {...props}
    />
  );
}
