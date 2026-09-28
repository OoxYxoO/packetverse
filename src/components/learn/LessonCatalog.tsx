"use client";

import { useId, useMemo, useState } from "react";
import Link from "next/link";
import { clsx } from "clsx";
import { lessons } from "@/lib/content/lessons";
import type { Difficulty, Lesson, LessonCategory } from "@/lib/content/types";
import { getLessonAvailability, type LessonAvailability } from "@/lib/content/learningProgress";
import { useProgressStore } from "@/lib/state/useProgressStore";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { Badge } from "@/components/ui/Badge";
import { LinkButton } from "./LinkButton";

const CATEGORY_LABEL: Record<LessonCategory, string> = { fundamentals: "Fundamentals", enterprise: "Enterprise", "service-provider": "Service Provider", security: "Security", troubleshooting: "Troubleshooting", automation: "Automation" };
const DIFFICULTY_ORDER: Difficulty[] = ["beginner", "associate", "professional", "expert"];
const DIFFICULTY_LABEL: Record<Difficulty, string> = { beginner: "Beginner", associate: "Associate", professional: "Professional", expert: "Expert" };
const TIER_LABEL = { free: "Free", pro: "Pro" } as const;
const AVAILABILITY_LABEL: Record<LessonAvailability, string> = { available: "Available Now", "coming-soon": "Coming Soon" };

type Tier = Lesson["tier"];
interface Filters {
  category: LessonCategory | "all";
  difficulty: Difficulty | "all";
  tier: Tier | "all";
  availability: LessonAvailability | "all";
}
const NO_FILTERS: Filters = { category: "all", difficulty: "all", tier: "all", availability: "all" };

/** Values actually present in the catalog, in a stable display order — never offer a filter that can only return nothing. */
const presentCategories = (Object.keys(CATEGORY_LABEL) as LessonCategory[]).filter((c) => lessons.some((l) => l.category === c));
const presentDifficulties = DIFFICULTY_ORDER.filter((d) => lessons.some((l) => l.difficulty === d));
const presentTiers = (["free", "pro"] as Tier[]).filter((t) => lessons.some((l) => l.tier === t));
const presentAvailability = (["available", "coming-soon"] as LessonAvailability[]).filter((a) => lessons.some((l) => getLessonAvailability(l) === a));

function matchesSearch(lesson: Lesson, q: string) {
  if (!q) return true;
  const hay = [lesson.title, lesson.tagline, lesson.category, CATEGORY_LABEL[lesson.category], lesson.difficulty, TIER_LABEL[lesson.tier]].join(" ").toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => hay.includes(term));
}

/** /lessons — every lesson, searchable and filterable. Lesson data comes straight from the catalog; completion from the store (read-only). */
export function LessonCatalog() {
  const completedLessons = useProgressStore((s) => s.completedLessons);
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const searchId = useId();

  const availableCount = lessons.filter((l) => getLessonAvailability(l) === "available").length;
  const comingSoonCount = lessons.length - availableCount;

  const results = useMemo(
    () =>
      lessons.filter(
        (l) =>
          matchesSearch(l, query.trim()) &&
          (filters.category === "all" || l.category === filters.category) &&
          (filters.difficulty === "all" || l.difficulty === filters.difficulty) &&
          (filters.tier === "all" || l.tier === filters.tier) &&
          (filters.availability === "all" || getLessonAvailability(l) === filters.availability),
      ),
    [query, filters],
  );
  const active = query.trim() !== "" || Object.values(filters).some((v) => v !== "all");
  const clear = () => {
    setQuery("");
    setFilters(NO_FILTERS);
  };
  const set = <K extends keyof Filters>(key: K, value: Filters[K]) => setFilters((f) => ({ ...f, [key]: value }));

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-12">
      <Badge tone="cyan" className="mb-3">
        Lesson Catalog
      </Badge>
      <h1 className="text-2xl font-semibold text-pv-text sm:text-3xl">Explore every PacketVerse lesson</h1>
      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-pv-text-muted">
        Browse by topic, track, level, or availability. Want a recommended order instead?{" "}
        <Link href="/learn" className="text-pv-cyan-soft underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-pv-cyan">
          Follow a track on the Learning Map
        </Link>
        .
      </p>
      <p className="mt-3 flex flex-wrap gap-2 text-xs">
        <Badge tone="success">{availableCount} lessons available</Badge>
        {comingSoonCount > 0 && <Badge tone="warning">{comingSoonCount} coming later</Badge>}
      </p>

      {/* SEARCH + FILTERS */}
      <GlassPanel className="mt-8 space-y-4 p-4 sm:p-5">
        <div>
          <label htmlFor={searchId} className="mb-1.5 block text-xs font-semibold text-pv-text-muted">
            Search lessons
          </label>
          <input
            id={searchId}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Try EVPN, MPLS, SRv6, VLAN or beginner"
            className="w-full rounded-xl border border-pv-border bg-pv-bg/60 px-3.5 py-2.5 text-sm text-pv-text placeholder:text-pv-text-faint focus:border-pv-cyan/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-pv-cyan/40"
          />
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <FilterGroup label="Track" value={filters.category} onChange={(v) => set("category", v)} options={presentCategories.map((c) => ({ value: c, label: CATEGORY_LABEL[c] }))} />
          <FilterGroup label="Difficulty" value={filters.difficulty} onChange={(v) => set("difficulty", v)} options={presentDifficulties.map((d) => ({ value: d, label: DIFFICULTY_LABEL[d] }))} />
          <FilterGroup label="Tier" value={filters.tier} onChange={(v) => set("tier", v)} options={presentTiers.map((t) => ({ value: t, label: TIER_LABEL[t] }))} />
          <FilterGroup label="Availability" value={filters.availability} onChange={(v) => set("availability", v)} options={presentAvailability.map((a) => ({ value: a, label: AVAILABILITY_LABEL[a] }))} />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-pv-border pt-3">
          <p className="text-xs text-pv-text-muted" role="status" aria-live="polite">
            <span className="pv-mono text-pv-text">{results.length}</span> {results.length === 1 ? "lesson" : "lessons"} found
          </p>
          {active && (
            <button type="button" onClick={clear} className="cursor-pointer rounded-full border border-pv-border px-3 py-1 text-xs text-pv-text-muted transition-colors hover:border-pv-cyan/40 hover:text-pv-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pv-cyan">
              Clear filters
            </button>
          )}
        </div>
      </GlassPanel>

      {/* RESULTS */}
      {results.length === 0 ? (
        <GlassPanel className="mt-6 flex flex-col items-center gap-3 p-10 text-center">
          <p className="text-sm font-semibold text-pv-text">No lessons match these filters</p>
          <p className="max-w-md text-xs text-pv-text-muted">Try a broader search term or remove a filter. Every lesson is also reachable from its track on the Learning Map.</p>
          <button type="button" onClick={clear} className="mt-1 cursor-pointer rounded-full bg-pv-cyan px-4 py-2 text-xs font-medium text-[#03131a] hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pv-cyan">
            Clear filters
          </button>
        </GlassPanel>
      ) : (
        <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {results.map((lesson) => (
            <li key={lesson.id}>
              <LessonCard lesson={lesson} completed={completedLessons.includes(lesson.id)} />
            </li>
          ))}
        </ul>
      )}

      <div className="mt-10 flex justify-center">
        <LinkButton href="/learn" variant="secondary">
          ← Back to the Learning Map
        </LinkButton>
      </div>
    </div>
  );
}

function FilterGroup<T extends string>({ label, value, options, onChange }: { label: string; value: T | "all"; options: { value: T; label: string }[]; onChange: (v: T | "all") => void }) {
  const all = [{ value: "all" as const, label: "All" }, ...options];
  return (
    <fieldset>
      <legend className="mb-1.5 text-xs font-semibold text-pv-text-muted">{label}</legend>
      <div className="flex flex-wrap gap-1.5">
        {all.map((o) => {
          const pressed = value === o.value;
          return (
            <button
              key={o.value}
              type="button"
              aria-pressed={pressed}
              onClick={() => onChange(o.value)}
              className={clsx(
                "cursor-pointer rounded-full border px-3 py-1 text-xs transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pv-cyan",
                pressed ? "border-pv-cyan/60 bg-pv-cyan/15 font-medium text-pv-cyan-soft" : "border-pv-border text-pv-text-muted hover:border-pv-border-strong hover:text-pv-text",
              )}
            >
              {pressed && o.value !== "all" && <span aria-hidden>✓ </span>}
              {o.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

function LessonCard({ lesson, completed }: { lesson: Lesson; completed: boolean }) {
  const available = getLessonAvailability(lesson) === "available";
  const body = (
    <GlassPanel className={clsx("flex h-full flex-col p-5 transition-colors", available ? "group-hover:border-pv-border-strong" : "border-dashed opacity-80")}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Badge tone={lesson.tier === "pro" ? "violet" : "success"}>{TIER_LABEL[lesson.tier]}</Badge>
        <Badge tone="muted">{DIFFICULTY_LABEL[lesson.difficulty]}</Badge>
        {completed && available && <Badge tone="success">✓ Completed</Badge>}
        {!available && <Badge tone="warning">Coming Soon</Badge>}
      </div>
      <h2 className="text-sm font-semibold text-pv-text">{lesson.title}</h2>
      <p className="mt-1.5 text-xs leading-relaxed text-pv-text-muted">{lesson.tagline}</p>
      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-4">
        <p className="text-[11px] text-pv-text-faint">
          {lesson.estimatedMinutes} min · {CATEGORY_LABEL[lesson.category]}
        </p>
        {available ? (
          <span className={clsx("text-xs font-medium", completed ? "text-pv-success" : "text-pv-cyan-soft")}>{completed ? "Review Lesson →" : "Start Lesson →"}</span>
        ) : (
          <span className="text-xs text-pv-text-faint">Not yet available</span>
        )}
      </div>
    </GlassPanel>
  );
  return available ? (
    <Link href={lesson.simulationPath!} className="group block h-full rounded-2xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pv-cyan">
      {body}
    </Link>
  ) : (
    <div aria-disabled="true" className="h-full">
      {body}
    </div>
  );
}
