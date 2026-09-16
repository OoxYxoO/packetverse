import { clsx } from "clsx";
import type { ButtonHTMLAttributes } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
}

export function Button({ className, variant = "primary", size = "md", ...props }: ButtonProps) {
  return (
    <button
      className={clsx(
        "inline-flex items-center justify-center gap-2 rounded-full font-medium transition-all duration-150",
        "disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer",
        size === "sm" && "px-3.5 py-1.5 text-xs",
        size === "md" && "px-5 py-2.5 text-sm",
        size === "lg" && "px-7 py-3.5 text-base",
        variant === "primary" &&
          "bg-pv-cyan text-[#03131a] hover:brightness-110 shadow-[0_0_24px_rgba(34,211,238,0.35)]",
        variant === "secondary" &&
          "pv-glass text-pv-text hover:border-pv-border-strong hover:bg-white/[0.04]",
        variant === "ghost" && "text-pv-text-muted hover:text-pv-text hover:bg-white/[0.04]",
        variant === "danger" && "bg-pv-danger/90 text-[#1a0508] hover:brightness-110",
        className,
      )}
      {...props}
    />
  );
}
