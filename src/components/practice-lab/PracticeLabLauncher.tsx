"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { GlassPanel } from "@/components/ui/GlassPanel";

/**
 * Lesson-level Practice Lab entry points (generic). Every lab is optional
 * and sandboxed: opening one never completes a lesson, awards XP or gates
 * the guided lesson.
 */

/**
 * Open/mounted flags for one lesson's lab. The lab mounts on first open and
 * stays mounted so its session survives closing. Callbacks are stable, so
 * they can be captured by memoised content (e.g. guide bridges).
 */
export function usePracticeLab(onBeforeOpen?: () => void) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const before = useRef(onBeforeOpen);
  useEffect(() => {
    before.current = onBeforeOpen;
  });
  const openLab = useCallback(() => {
    before.current?.();
    setMounted(true);
    setOpen(true);
  }, []);
  const closeLab = useCallback(() => setOpen(false), []);
  return { open, mounted, openLab, closeLab };
}

export interface PracticeLabEntry {
  /** e.g. "ARP Lab", "VLAN Lab". */
  title: string;
  /** One sentence: what the learner can do in the lab. */
  description: ReactNode;
  /** Header button label, e.g. "Practice ARP". */
  buttonLabel: string;
  /** Card button label; defaults to "Open <title>". */
  openLabel?: string;
}

/** Compact header button next to the Lesson Guide. */
export function PracticeLabButton({ label, onOpen }: { label: string; onOpen: () => void }) {
  return (
    <Button variant="secondary" size="sm" onClick={onOpen}>
      ⚗ {label}
    </Button>
  );
}

/** Compact card near the lesson controls. `contextNote` (e.g. "Want to experiment instead of only watching?") is shown only when the lesson says it is relevant. */
export function PracticeLabCard({ entry, contextNote, onOpen }: { entry: PracticeLabEntry; contextNote?: string; onOpen: () => void }) {
  return (
    <GlassPanel className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-pv-text">
          {entry.title} <span className="ml-1 rounded-full border border-pv-border px-2 py-0.5 align-middle text-[10px] font-normal text-pv-text-faint">optional</span>
        </p>
        <p className="mt-0.5 text-xs text-pv-text-muted">
          {contextNote ? `${contextNote} ` : ""}
          {entry.description}
        </p>
      </div>
      <Button size="sm" onClick={onOpen} className="shrink-0">
        {entry.openLabel ?? `Open ${entry.title}`} →
      </Button>
    </GlassPanel>
  );
}
