"use client";

import Link from "next/link";
import { learningPaths } from "@/lib/content/learningPaths";
import { lessons } from "@/lib/content/lessons";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { ACHIEVEMENTS, levelForXp, xpIntoLevel, useProgressStore } from "@/lib/state/useProgressStore";

export default function DashboardPage() {
  const xp = useProgressStore((s) => s.xp);
  const streak = useProgressStore((s) => s.streak);
  const completedLessons = useProgressStore((s) => s.completedLessons);
  const achievements = useProgressStore((s) => s.achievements);
  const quizScore = useProgressStore((s) => s.quizScore);
  const packetsInspected = useProgressStore((s) => s.packetsInspected);

  const level = levelForXp(xp);
  const levelProgress = (xpIntoLevel(xp) / 250) * 100;

  const nextLesson = lessons.find((l) => !completedLessons.includes(l.id));
  const quizPct = quizScore.total > 0 ? Math.round((quizScore.correct / quizScore.total) * 100) : 0;

  return (
    <div className="mx-auto max-w-6xl px-6 py-12">
      <Badge tone="cyan" className="mb-3">
        Your Dashboard
      </Badge>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="text-2xl font-semibold text-pv-text sm:text-3xl">Your Network</h1>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <p className="pv-mono text-xs text-pv-text-faint">Level {level}</p>
            <p className="pv-mono text-sm text-pv-cyan-soft">{xp} XP</p>
          </div>
          <div className="w-28">
            <ProgressBar value={levelProgress} tone="cyan" />
          </div>
        </div>
      </div>

      {/* STAT STRIP */}
      <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Study Streak" value={`${streak} day${streak === 1 ? "" : "s"}`} />
        <StatTile label="Lessons Completed" value={String(completedLessons.length)} />
        <StatTile label="Quiz Accuracy" value={quizScore.total ? `${quizPct}%` : "—"} />
        <StatTile label="Packets Inspected" value={String(packetsInspected)} />
      </div>

      <div className="mt-10 grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          {/* TRACK PROGRESS */}
          <GlassPanel strong className="p-6">
            <h2 className="mb-4 text-sm font-semibold text-pv-text">Learning Paths</h2>
            <div className="space-y-5">
              {learningPaths.map((path) => {
                const lessonNodes = path.nodes.filter((n) => n.lessonId);
                const completedCount = lessonNodes.filter((n) => n.lessonId && completedLessons.includes(n.lessonId)).length;
                const pct = lessonNodes.length ? (completedCount / lessonNodes.length) * 100 : 0;
                return (
                  <ProgressBar
                    key={path.id}
                    label={path.title}
                    value={pct}
                    tone={path.id === "service-provider" ? "violet" : path.id === "troubleshooting" ? "warning" : "cyan"}
                  />
                );
              })}
            </div>
          </GlassPanel>

          {/* RECOMMENDED NEXT */}
          {nextLesson && (
            <GlassPanel glow="cyan" className="flex items-center justify-between gap-4 p-6">
              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-pv-cyan-soft">Recommended next</p>
                <h3 className="text-sm font-semibold text-pv-text">{nextLesson.title}</h3>
                <p className="mt-1 text-xs text-pv-text-muted">{nextLesson.tagline}</p>
              </div>
              <Link href={nextLesson.simulationPath ?? "/learn"}>
                <Button size="sm">Continue</Button>
              </Link>
            </GlassPanel>
          )}

          {/* ACHIEVEMENTS */}
          <GlassPanel strong className="p-6">
            <h2 className="mb-4 text-sm font-semibold text-pv-text">Achievements</h2>
            <div className="grid gap-3 sm:grid-cols-3">
              {ACHIEVEMENTS.map((a) => {
                const unlocked = achievements.includes(a.id);
                return (
                  <div
                    key={a.id}
                    className={`rounded-xl border p-4 ${unlocked ? "border-pv-warning/40 bg-pv-warning/5" : "border-pv-border opacity-50"}`}
                  >
                    <p className="mb-1 text-lg">{unlocked ? "🏆" : "🔒"}</p>
                    <p className="text-xs font-semibold text-pv-text">{a.title}</p>
                    <p className="mt-1 text-[11px] text-pv-text-faint">{a.description}</p>
                  </div>
                );
              })}
            </div>
          </GlassPanel>
        </div>

        {/* RECENT + WEAK AREAS */}
        <div className="space-y-4">
          <GlassPanel className="p-5">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-pv-text-muted">Recent Topics</h3>
            {completedLessons.length === 0 ? (
              <p className="text-xs text-pv-text-faint">Nothing completed yet — start with the flagship demo.</p>
            ) : (
              <ul className="space-y-2">
                {completedLessons.slice(-5).reverse().map((id) => (
                  <li key={id} className="text-xs text-pv-text-muted pv-mono">
                    {id}
                  </li>
                ))}
              </ul>
            )}
          </GlassPanel>

          <GlassPanel className="p-5">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-pv-text-muted">Troubleshooting Score</h3>
            <p className="text-xs text-pv-text-faint">Troubleshooting Arena launches in a future release — score will appear here.</p>
          </GlassPanel>
        </div>
      </div>
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <GlassPanel className="p-4">
      <p className="pv-mono text-xl font-semibold text-pv-text">{value}</p>
      <p className="mt-1 text-[11px] text-pv-text-faint">{label}</p>
    </GlassPanel>
  );
}
