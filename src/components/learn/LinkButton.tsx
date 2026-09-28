import Link from "next/link";
import { clsx } from "clsx";
import type { ComponentProps } from "react";

/**
 * A navigation link styled like the shared <Button> (primary / secondary). Navigation stays a real <a>, so there is
 * no <button> nested inside a link.
 */
export function LinkButton({ variant = "primary", className, ...props }: ComponentProps<typeof Link> & { variant?: "primary" | "secondary" }) {
  return (
    <Link
      className={clsx(
        "inline-flex items-center justify-center gap-2 rounded-full px-5 py-2.5 text-sm font-medium transition-all duration-150",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pv-cyan",
        variant === "primary" && "bg-pv-cyan text-[#03131a] shadow-[0_0_24px_rgba(34,211,238,0.35)] hover:brightness-110",
        variant === "secondary" && "pv-glass text-pv-text hover:border-pv-border-strong hover:bg-white/[0.04]",
        className,
      )}
      {...props}
    />
  );
}
