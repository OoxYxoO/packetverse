"use client";

import { useMemo, useState } from "react";
import { clsx } from "clsx";
import { learningPaths } from "@/lib/content/learningPaths";
import { getDefaultTrackId, getLearningSummary, getNextPlayableLesson, getTrackProgress, type TrackProgress } from "@/lib/content/learningProgress";
import { useProgressStore } from "@/lib/state/useProgressStore";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { Badge } from "@/components/ui/Badge";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { ProgressNetwork, RoadmapLegend } from "@/components/dashboard/ProgressNetwork";
import { LinkButton } from "./LinkButton";

/** Accent per track — advanced/SP content uses violet, troubleshooting warning, the rest cyan. */
const TRACK_TONE: Record<string, "cyan" | "violet" | "warning"> = { "service-provider": "violet", troubleshooting: "warning" };
const toneOf = (id: string) => TRACK_TONE[id] ?? "cyan";

/**
 * /learn — guided progression. Answers: where am I, what's done, what's next, which track, what's available now,
 * what's coming later. The full lesson list lives on /lessons; this page never repeats it.
 */
export function LearningHub() {
  const completedLessons = useProgressStore((s) => s.completedLessons);
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);

  const tracks = useMemo(() => learningPaths.map((p) => getTrackProgress(p, completedLessons)), [completedLessons]);
  const summary = useMemo(() => getLearningSummary(completedLessons), [completedLessons]);
  const next = useMemo(() => getNextPlayableLesson(completedLessons), [completedLessons]);
  // Until the learner picks one, follow their progress: first track with unfinished playable lessons.
  const activeId = selectedTrackId ?? getDefaultTrackId(completedLessons);
  const active = tracks.find((t) => t.path.id === activeId) ?? tracks[0];

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-12">
      {/* HERO */}
      <section aria-labelledby="learn-heading" className="grid gap-6 lg:grid-cols-[1fr_360px] lg:items-end">
        <div>
          <Badge tone="cyan" className="mb-3">
            Learning Map
          </Badge>
          <h1 id="learn-heading" className="text-2xl font-semibold text-pv-text sm:text-3xl">
            Choose your path. Follow the packet.
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-pv-text-muted">
            Each track puts interactive lessons in a recommended order, and your completed lessons are tracked as you go. Prefer to pick a topic yourself? Browse every lesson in the catalog.
          </p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
            <LinkButton href={next ? next.lesson.simulationPath : "/lessons"} className="w-full sm:w-auto">
              {next ? "Continue Learning →" : "Explore completed lessons →"}
            </LinkButton>
            <LinkButton href="/lessons" variant="secondary" className="w-full sm:w-auto">
              Browse All Lessons
            </LinkButton>
          </div>
          <p className="mt-3 text-xs text-pv-text-faint">
            {next ? (
              <>
                Up next: <span className="text-pv-text-muted">{next.lesson.title}</span> · {learningPaths.find((p) => p.id === next.trackId)?.title}
              </>
            ) : (
              "You've completed every lesson that's currently playable. New lessons are on the way."
            )}
          </p>
        </div>

        {/* PROGRESS SUMMARY */}
        <GlassPanel className="grid grid-cols-2 gap-px overflow-hidden p-0" role="group" aria-label="Your progress">
          <Stat label="Completed" value={`${summary.completed} / ${summary.available}`} tone="success" />
          <Stat label="Tracks in progress" value={String(summary.tracksInProgress)} />
          <Stat label="Available lessons" value={String(summary.available)} tone="cyan" />
          <Stat label="Coming later" value={String(summary.comingLater)} />
        </GlassPanel>
      </section>

      {/* TRACK SELECTOR */}
      <section aria-labelledby="tracks-heading" className="mt-12">
        <h2 id="tracks-heading" className="mb-4 text-sm font-semibold uppercase tracking-wide text-pv-text-muted">
          Tracks
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" role="group" aria-label="Choose a track">
          {tracks.map((t) => (
            <TrackCard key={t.path.id} track={t} selected={t.path.id === active.path.id} onSelect={() => setSelectedTrackId(t.path.id)} />
          ))}
        </div>
      </section>

      {/* ACTIVE ROADMAP */}
      <section aria-labelledby="roadmap-heading" className="mt-8">
        <GlassPanel strong className="p-5 sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-pv-text-faint">Active track</p>
              <h2 id="roadmap-heading" className={clsx("text-lg font-semibold", toneOf(active.path.id) === "violet" ? "text-pv-violet" : toneOf(active.path.id) === "warning" ? "text-pv-warning" : "text-pv-cyan-soft")}>
                {active.path.title}
              </h2>
              <p className="mt-1 text-xs text-pv-text-muted">{active.path.description}</p>
            </div>
            <div className="w-full shrink-0 sm:w-56">
              {active.playable ? <ProgressBar value={active.percent} tone={active.completed === active.playable ? "success" : toneOf(active.path.id)} label={`${active.completed} of ${active.playable} completed`} /> : <p className="text-xs text-pv-text-muted">No playable lessons yet</p>}
              <p className="mt-1.5 text-[11px] text-pv-text-faint">{active.comingLater} coming later</p>
            </div>
          </div>
          <RoadmapLegend className="mt-5 border-t border-pv-border pt-4" />
          {active.playable === 0 && (
            <p className="mt-4 rounded-lg border border-pv-warning/30 bg-pv-warning/5 px-3 py-2 text-xs text-pv-text-muted">
              Interactive troubleshooting lessons are coming soon. The topics below show where this track is headed.
            </p>
          )}
          <div className="mt-4">
            <ProgressNetwork path={active.path} />
          </div>
        </GlassPanel>
      </section>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "success" | "cyan" }) {
  return (
    <div className="bg-pv-bg/40 p-4">
      <p className={clsx("pv-mono text-xl font-semibold", tone === "success" ? "text-pv-success" : tone === "cyan" ? "text-pv-cyan-soft" : "text-pv-text")}>{value}</p>
      <p className="mt-1 text-[11px] text-pv-text-faint">{label}</p>
    </div>
  );
}

function TrackCard({ track, selected, onSelect }: { track: TrackProgress; selected: boolean; onSelect: () => void }) {
  const tone = toneOf(track.path.id);
  const done = track.playable > 0 && track.completed === track.playable;
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={clsx(
        "flex h-full cursor-pointer flex-col rounded-2xl border p-4 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pv-cyan",
        selected ? "border-pv-cyan/60 bg-pv-cyan/[0.07]" : "border-pv-border bg-white/[0.02] hover:border-pv-border-strong hover:bg-white/[0.04]",
      )}
    >
      <span className="flex items-start justify-between gap-2">
        <span className="text-sm font-semibold text-pv-text">{track.path.title}</span>
        {selected && <span className="shrink-0 rounded-full border border-pv-cyan/40 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-pv-cyan-soft">Viewing</span>}
      </span>
      <span className="mt-1 text-[11px] leading-snug text-pv-text-faint">{track.path.description}</span>
      <span className="mt-auto pt-4">
        <span className="mb-1.5 flex items-center justify-between text-[11px]">
          <span className="text-pv-text-muted">{track.playable ? `${track.completed} of ${track.playable} available lessons completed` : "No playable lessons yet"}</span>
          <span className="pv-mono text-pv-text">{track.playable ? `${Math.round(track.percent)}%` : "—"}</span>
        </span>
        {track.playable > 0 ? <ProgressBar value={track.percent} tone={done ? "success" : tone} /> : <span className="block h-2 rounded-full border border-dashed border-pv-border" aria-hidden />}
        <span className="mt-1.5 block text-[11px] text-pv-text-faint">
          {done ? "✓ All available lessons completed · " : ""}
          {track.comingLater} coming later
        </span>
      </span>
    </button>
  );
}
