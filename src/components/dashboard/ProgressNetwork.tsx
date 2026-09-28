"use client";

import Link from "next/link";
import { clsx } from "clsx";
import type { LearningPath } from "@/lib/content/types";
import { getTrackProgress, type RoadmapNode } from "@/lib/content/learningProgress";
import { useProgressStore } from "@/lib/state/useProgressStore";

/**
 * Visual progress map (brief §22): completed lessons light up green with "Review", playable ones glow cyan with
 * "Start", unbuilt-but-planned topics say "Soon", and locked topics stay dim with a lock. Never color-only — every
 * node carries a glyph and a text state. Only nodes with a real simulation route are links.
 */
export function ProgressNetwork({ path }: { path: LearningPath }) {
  const completedLessons = useProgressStore((s) => s.completedLessons);
  const { nodes } = getTrackProgress(path, completedLessons);

  return (
    <ol className="space-y-0">
      {nodes.map((n, i) => (
        <li key={n.node.id} className="relative pl-4">
          {i < nodes.length - 1 && <span aria-hidden className={clsx("absolute left-[31px] top-10 h-[calc(100%-1rem)] w-px", n.state === "completed" ? "bg-pv-success/40" : "bg-pv-border")} />}
          {n.href ? (
            <Link href={n.href} className="block rounded-lg transition-colors hover:bg-white/[0.03] focus-visible:bg-white/[0.04] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pv-cyan">
              <NodeRow n={n} />
            </Link>
          ) : (
            <NodeRow n={n} />
          )}
        </li>
      ))}
    </ol>
  );
}

const GLYPH: Record<RoadmapNode["state"], string> = { completed: "✓", available: "○", soon: "…", locked: "🔒" };

function NodeRow({ n }: { n: RoadmapNode }) {
  const { state, lesson } = n;
  const dim = state === "locked" || state === "soon";
  return (
    <div className="flex items-center gap-3 px-1 py-2.5">
      <span
        aria-hidden
        className={clsx(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-xs font-semibold",
          state === "completed" && "border-pv-success/60 bg-pv-success/10 text-pv-success",
          state === "available" && "animate-glow border-pv-cyan/50 bg-pv-cyan/10 text-pv-cyan",
          state === "soon" && "border-dashed border-pv-warning/50 text-pv-warning",
          state === "locked" && "border-pv-border text-pv-text-faint",
        )}
      >
        {GLYPH[state]}
      </span>
      <span className="min-w-0 flex-1">
        <span className={clsx("block text-sm", dim ? "text-pv-text-faint" : "text-pv-text")}>{n.node.label}</span>
        {lesson && n.href && (
          <span className="mt-0.5 block text-[11px] text-pv-text-faint">
            <span className="capitalize">{lesson.difficulty}</span> · {lesson.estimatedMinutes} min · {lesson.tier === "pro" ? "Pro" : "Free"}
          </span>
        )}
      </span>
      {state === "completed" && (
        <span className="shrink-0 text-xs font-medium text-pv-success">
          <span className="sr-only">Completed — </span>Review →
        </span>
      )}
      {state === "available" && <span className="shrink-0 text-xs font-medium text-pv-cyan-soft">Start →</span>}
      {state === "soon" && <span className="shrink-0 rounded-full border border-pv-warning/40 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-pv-warning">Soon</span>}
      {state === "locked" && <span className="shrink-0 text-[10px] uppercase tracking-wide text-pv-text-faint">Locked</span>}
    </div>
  );
}

/** Compact legend for the roadmap states. */
export function RoadmapLegend({ className }: { className?: string }) {
  const items = [
    { glyph: "✓", label: "Completed", cls: "border-pv-success/60 text-pv-success" },
    { glyph: "○", label: "Available", cls: "border-pv-cyan/50 text-pv-cyan" },
    { glyph: "…", label: "Soon", cls: "border-dashed border-pv-warning/50 text-pv-warning" },
    { glyph: "🔒", label: "Locked", cls: "border-pv-border text-pv-text-faint" },
  ];
  return (
    <ul className={clsx("flex flex-wrap gap-x-4 gap-y-2 text-[11px] text-pv-text-muted", className)} aria-label="Roadmap legend">
      {items.map((it) => (
        <li key={it.label} className="flex items-center gap-1.5">
          <span aria-hidden className={clsx("flex h-5 w-5 items-center justify-center rounded-full border text-[10px]", it.cls)}>
            {it.glyph}
          </span>
          {it.label}
        </li>
      ))}
    </ul>
  );
}
