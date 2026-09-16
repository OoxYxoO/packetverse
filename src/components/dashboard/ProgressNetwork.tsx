"use client";

import Link from "next/link";
import { clsx } from "clsx";
import type { LearningPath } from "@/lib/content/types";
import { getLessonById } from "@/lib/content/lessons";
import { useProgressStore } from "@/lib/state/useProgressStore";

/**
 * Visual progress map (brief §22): completed technologies light up
 * green, the next available node glows cyan, locked nodes stay dim.
 * Never color-only — each node also carries an icon glyph and label.
 */
export function ProgressNetwork({ path }: { path: LearningPath }) {
  const completedLessons = useProgressStore((s) => s.completedLessons);

  return (
    <div className="space-y-0">
      {path.nodes.map((node, i) => {
        const isCompleted = node.lessonId ? completedLessons.includes(node.lessonId) : false;
        const isLocked = node.status === "locked" && !node.lessonId;
        const lesson = node.lessonId ? getLessonById(node.lessonId) : undefined;
        // Only link to a simulation that actually exists — lessons
        // without one yet show as "available" but not clickable, so
        // the map never routes to a 404.
        const href = lesson?.simulationPath;

        const glyph = isCompleted ? "✓" : isLocked ? "🔒" : "○";
        const content = (
          <div className="flex items-center gap-3 py-2.5">
            <span
              className={clsx(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-xs font-semibold",
                isCompleted && "border-pv-success/60 bg-pv-success/10 text-pv-success",
                !isCompleted && !isLocked && "border-pv-cyan/50 bg-pv-cyan/10 text-pv-cyan animate-glow",
                isLocked && "border-pv-border text-pv-text-faint",
              )}
            >
              {glyph}
            </span>
            <span className={clsx("text-sm", isLocked ? "text-pv-text-faint" : "text-pv-text")}>{node.label}</span>
            {href && !isLocked && <span className="ml-auto text-xs text-pv-cyan-soft">Open →</span>}
            {!href && !isLocked && <span className="ml-auto text-[10px] uppercase tracking-wide text-pv-text-faint">Soon</span>}
          </div>
        );

        return (
          <div key={node.id} className="relative pl-4">
            {i < path.nodes.length - 1 && (
              <span
                className={clsx("absolute left-[19px] top-9 h-full w-px", isCompleted ? "bg-pv-success/40" : "bg-pv-border")}
              />
            )}
            {href && !isLocked ? (
              <Link href={href} className="block rounded-lg transition-colors hover:bg-white/[0.03]">
                {content}
              </Link>
            ) : (
              content
            )}
          </div>
        );
      })}
    </div>
  );
}
