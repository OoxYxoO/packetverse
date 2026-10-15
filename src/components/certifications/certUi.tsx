"use client";

import Link from "next/link";
import { clsx } from "clsx";
import type { LessonFeatures } from "@/lib/content/types";
import type { ModuleView } from "@/lib/content/certificationProgress";

/** One accent per exam domain (by domain number), from the existing palette — used consistently on every surface. */
export const DOMAIN_TONE: Record<number, { text: string; bar: string; ring: string; soft: string; border: string }> = {
  1: { text: "text-pv-cyan-soft", bar: "bg-pv-cyan", ring: "#22d3ee", soft: "bg-pv-cyan/[0.07]", border: "border-pv-cyan/40" },
  2: { text: "text-pv-violet", bar: "bg-pv-violet", ring: "#8b8cf8", soft: "bg-pv-violet/[0.07]", border: "border-pv-violet/40" },
  3: { text: "text-pv-info", bar: "bg-pv-info", ring: "#60a5fa", soft: "bg-pv-info/[0.07]", border: "border-pv-info/40" },
  4: { text: "text-pv-success", bar: "bg-pv-success", ring: "#34d399", soft: "bg-pv-success/[0.07]", border: "border-pv-success/40" },
  5: { text: "text-pv-danger", bar: "bg-pv-danger", ring: "#fb7185", soft: "bg-pv-danger/[0.07]", border: "border-pv-danger/40" },
  6: { text: "text-pv-warning", bar: "bg-pv-warning", ring: "#fbbf24", soft: "bg-pv-warning/[0.07]", border: "border-pv-warning/40" },
};

/** A progress ring with the value as text in the middle (the number is always readable, not color alone). */
export function Ring({ value, size = 120, stroke = 10, color = "#22d3ee", label }: { value: number; size?: number; stroke?: number; color?: string; label: string }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className="relative inline-grid place-items-center" style={{ width: size, height: size }} role="img" aria-label={`${label}: ${Math.round(pct)} percent`}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(148,163,184,0.15)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - pct / 100)} style={{ transition: "stroke-dashoffset 700ms ease-out" }} />
      </svg>
      <span className="absolute text-center">
        <span className="pv-mono block text-2xl font-semibold text-pv-text">{Math.round(pct)}%</span>
        <span className="block text-[10px] uppercase tracking-wide text-pv-text-faint">{label}</span>
      </span>
    </div>
  );
}

const Icon = ({ d, className }: { d: string; className?: string }) => (
  <svg viewBox="0 0 24 24" className={clsx("size-3.5 shrink-0", className)} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d={d} />
  </svg>
);
const I = {
  guided: "M5 12h14M13 6l6 6-6 6",
  lab: "M9 3h6M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3",
  video: "M4 6h11v12H4zM15 10l5-3v10l-5-3",
  deep: "M4 5h7a3 3 0 0 1 3 3v12a2 2 0 0 0-2-2H4zM20 5h-6",
  check: "M5 12l5 5L20 7",
  lock: "M6 11h12v9H6zM8 11V8a4 4 0 0 1 8 0v3",
  clock: "M12 7v5l3 2M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18",
};
export const Icons = I;
export { Icon };

/** What the lesson contains, as small labelled chips (text, not color alone). */
export function FeatureChips({ f, compact }: { f?: LessonFeatures; compact?: boolean }) {
  if (!f) return null;
  const items = [
    { on: f.guided, label: "Guided lesson", icon: I.guided },
    { on: f.lab, label: "Lab", icon: I.lab },
    { on: f.video, label: "Video", icon: I.video },
    { on: f.deepDive, label: "Deep Dive", icon: I.deep },
  ].filter((x) => x.on);
  return (
    <span className="flex flex-wrap items-center gap-1">
      {items.map((x) => (
        <span key={x.label} className="inline-flex items-center gap-1 rounded-md border border-pv-border bg-white/[0.03] px-1.5 py-0.5 text-[10.5px] text-pv-text-muted" title={x.label}>
          <Icon d={x.icon} className="size-3" />
          {compact ? <span className="sr-only">{x.label}</span> : x.label}
        </span>
      ))}
      {f.cli && f.cli.length > 0 && (
        <span className="inline-flex items-center rounded-md border border-pv-border bg-white/[0.03] px-1.5 py-0.5 text-[10.5px] text-pv-text-muted pv-mono">{f.cli.map((v) => (v === "cisco" ? "IOS" : "Junos")).join(" · ")}</span>
      )}
    </span>
  );
}

const STATUS_LABEL = { completed: "Completed", available: "Start", "in-development": "In development" } as const;

/** One lesson inside a certification: status, title, why it's here, objectives, what it contains. */
export function ModuleTile({ v, upNext, showDomain = true }: { v: ModuleView; upNext?: boolean; showDomain?: boolean }) {
  const tone = DOMAIN_TONE[v.domain.number];
  const secondary = v.module.role !== "core";
  const body = (
    <>
      <span className="flex items-start justify-between gap-2">
        <span className="min-w-0">
          {secondary && <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-[0.16em] text-pv-text-faint">{v.module.role === "practice" ? "Practice" : "Go further"}</span>}
          <span className={clsx("block text-sm font-semibold leading-snug", v.status === "in-development" ? "text-pv-text-muted" : "text-pv-text")}>{v.title}</span>
        </span>
        <span
          className={clsx(
            "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
            v.status === "completed" ? "border-pv-success/40 bg-pv-success/10 text-pv-success" : upNext ? "border-pv-cyan/50 bg-pv-cyan/10 text-pv-cyan-soft" : v.status === "in-development" ? "border-pv-border text-pv-text-faint" : "border-pv-border text-pv-text-muted",
          )}
        >
          {v.status === "completed" && <Icon d={I.check} className="size-3" />}
          {upNext && v.status === "available" ? "Up next" : STATUS_LABEL[v.status]}
        </span>
      </span>
      <span className="mt-1.5 block text-[12px] leading-snug text-pv-text-muted">{v.module.why}</span>
      <span className="mt-2.5 flex flex-wrap items-center gap-1.5">
        {showDomain && (
          <span className={clsx("inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10.5px] font-semibold", tone.border, tone.text)}>
            {v.domain.number}.0 {v.domain.title}
          </span>
        )}
        <span className="pv-mono text-[10.5px] text-pv-text-faint">{v.module.covers.join(" · ")}</span>
        {v.minutes && (
          <span className="inline-flex items-center gap-1 text-[10.5px] text-pv-text-faint">
            <Icon d={I.clock} className="size-3" />
            {v.minutes} min
          </span>
        )}
      </span>
      {v.features && (
        <span className="mt-2 block">
          <FeatureChips f={v.features} />
        </span>
      )}
    </>
  );
  const cls = clsx(
    "block h-full rounded-xl border p-3.5 text-left transition-colors",
    upNext ? "border-pv-cyan/50 bg-pv-cyan/[0.06]" : secondary ? "border-dashed border-pv-border bg-transparent" : "border-pv-border bg-white/[0.02]",
    v.href && "hover:border-pv-border-strong hover:bg-white/[0.04] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pv-cyan",
  );
  return v.href ? (
    <Link href={v.href} className={cls}>
      {body}
    </Link>
  ) : (
    <div className={clsx(cls, "opacity-80")} aria-disabled>
      {body}
    </div>
  );
}
