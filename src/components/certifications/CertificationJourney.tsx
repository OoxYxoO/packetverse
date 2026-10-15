"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { clsx } from "clsx";
import type { Certification } from "@/lib/content/certifications";
import { getCertView, type CertView, type DomainView } from "@/lib/content/certificationProgress";
import { useProgressStore } from "@/lib/state/useProgressStore";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { Badge } from "@/components/ui/Badge";
import { LinkButton } from "@/components/learn/LinkButton";
import { DOMAIN_TONE, Icon, Icons, ModuleTile, Ring } from "./certUi";
import { CheckpointDialog } from "./CheckpointDialog";

type Lens = "plan" | "blueprint";
const LENS_KEY = "packetverse.certLens.v1";
const readLens = (): Lens => {
  try {
    return localStorage.getItem(LENS_KEY) === "blueprint" ? "blueprint" : "plan";
  } catch {
    return "plan";
  }
};
const subscribeStorage = (cb: () => void) => {
  window.addEventListener("storage", cb);
  return () => window.removeEventListener("storage", cb);
};

/**
 * A certification journey (/certifications/<id>). Two lenses over the same lessons: the STUDY PLAN (stages in the
 * order that teaches best, across domains) and the EXAM BLUEPRINT (domains → objectives → lessons, with weights and
 * checkpoints). Everything shown is derived from the catalog, the certification and the learner's completed lessons.
 */
export function CertificationJourney({ cert }: { cert: Certification }) {
  const completedLessons = useProgressStore((s) => s.completedLessons);
  const checkpoints = useProgressStore((s) => s.checkpoints);
  const view = useMemo(() => getCertView(cert, completedLessons, checkpoints), [cert, completedLessons, checkpoints]);
  // the learner's preferred lens is remembered in this browser (a convenience only); the server renders the study plan
  const storedLens = useSyncExternalStore(subscribeStorage, readLens, () => "plan" as Lens);
  const [pickedLens, setLens] = useState<Lens | null>(null);
  const lens = pickedLens ?? storedLens;
  const [openDomain, setOpenDomain] = useState<string | null>(null);
  const [quiz, setQuiz] = useState<DomainView | null>(null);

  const chooseLens = (l: Lens) => {
    setLens(l);
    try {
      localStorage.setItem(LENS_KEY, l);
    } catch {
      /* ignore */
    }
  };
  const showDomain = (id: string) => {
    chooseLens("blueprint");
    setOpenDomain(id);
    requestAnimationFrame(() => document.getElementById(`domain-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-12">
      <Hero view={view} onFocus={showDomain} />
      <DomainOverview view={view} onOpen={showDomain} />

      <section aria-labelledby="journey-heading" className="mt-10">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="journey-heading" className="text-lg font-semibold text-pv-text">
              Your CCNA journey
            </h2>
            <p className="mt-1 text-xs text-pv-text-muted">Same lessons, two ways to see them: in the order that teaches best, or as the exam lists them.</p>
          </div>
          <div role="tablist" aria-label="View the journey as" className="inline-flex shrink-0 rounded-full border border-pv-border bg-white/[0.02] p-1">
            {(
              [
                ["plan", "Study plan"],
                ["blueprint", "Exam blueprint"],
              ] as [Lens, string][]
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={lens === id}
                aria-controls={`lens-${id}`}
                id={`tab-${id}`}
                onClick={() => chooseLens(id)}
                className={clsx("min-h-9 rounded-full px-4 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-pv-cyan", lens === id ? "bg-pv-cyan/15 text-pv-cyan-soft" : "text-pv-text-muted hover:text-pv-text")}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        {lens === "plan" ? (
          <div role="tabpanel" id="lens-plan" aria-labelledby="tab-plan">
            <StudyPlan view={view} />
          </div>
        ) : (
          <div role="tabpanel" id="lens-blueprint" aria-labelledby="tab-blueprint">
            <Blueprint view={view} openDomain={openDomain} setOpenDomain={setOpenDomain} onQuiz={setQuiz} />
          </div>
        )}
      </section>

      <HowWeTeach />
      {quiz && <CheckpointDialog cert={cert} domain={quiz} onClose={() => setQuiz(null)} />}
    </div>
  );
}

function Hero({ view, onFocus }: { view: CertView; onFocus: (id: string) => void }) {
  const { cert, next, focus } = view;
  const hours = Math.round(view.minutesLeft / 60);
  return (
    <section aria-labelledby="cert-heading" className="grid gap-6 lg:grid-cols-[1fr_340px] lg:items-stretch">
      <div className="flex flex-col">
        <Link href="/certifications" className="mb-3 inline-flex w-fit items-center gap-1 text-xs text-pv-text-faint hover:text-pv-text-muted">
          ← Certifications
        </Link>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Badge tone="cyan">Certification</Badge>
          <span className="pv-mono text-xs text-pv-text-muted">
            {cert.vendor} · exam {cert.examCode}
          </span>
        </div>
        <h1 id="cert-heading" className="text-3xl font-semibold tracking-tight text-pv-text sm:text-4xl">
          {cert.title} <span className="text-pv-text-muted">— {cert.fullName}</span>
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-pv-text-muted">{cert.summary}</p>
        <p className="mt-2 max-w-2xl text-xs leading-relaxed text-pv-text-faint">
          The exam is Cisco&apos;s; the networking is everyone&apos;s. Lessons say when a name is Cisco-specific (HSRP, CDP, EtherChannel) and show the standard behind it (VRRP, LLDP, LACP), with Junos alongside IOS where it helps.
        </p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
          {next ? (
            <LinkButton href={next.href!} className="w-full sm:w-auto">
              {view.completed ? "Continue" : "Start"}: {next.title} →
            </LinkButton>
          ) : (
            <LinkButton href="/lessons" className="w-full sm:w-auto">
              Review lessons →
            </LinkButton>
          )}
        </div>
        {next && (
          <p className="mt-2 text-xs text-pv-text-faint">
            {next.stage.title} · {next.domain.number}.0 {next.domain.title} · objectives {next.module.covers.join(", ")}
          </p>
        )}
      </div>

      <GlassPanel strong className="flex flex-col gap-4 p-5" role="group" aria-label="Your CCNA progress">
        <div className="flex items-center gap-4">
          <Ring value={view.percent} label="ready" />
          <dl className="grid gap-1.5 text-xs">
            <div>
              <dt className="text-pv-text-faint">Lessons</dt>
              <dd className="pv-mono text-pv-text">
                {view.completed} / {view.total} completed
              </dd>
            </div>
            <div>
              <dt className="text-pv-text-faint">Exam objectives</dt>
              <dd className="pv-mono text-pv-text">
                {view.objectivesCovered} / {view.objectivesTotal} covered
              </dd>
            </div>
            <div>
              <dt className="text-pv-text-faint">Still to learn</dt>
              <dd className="pv-mono text-pv-text">{hours >= 1 ? `≈ ${hours} h of lessons` : `≈ ${view.minutesLeft} min`}</dd>
            </div>
          </dl>
        </div>
        {focus && (
          <button type="button" onClick={() => onFocus(focus.domain.id)} className={clsx("rounded-xl border p-3 text-left transition-colors hover:bg-white/[0.04] focus-visible:outline-2 focus-visible:outline-pv-cyan", DOMAIN_TONE[focus.domain.number].border)}>
            <span className="block text-[10px] font-semibold uppercase tracking-[0.18em] text-pv-text-faint">Focus next</span>
            <span className={clsx("mt-0.5 block text-sm font-semibold", DOMAIN_TONE[focus.domain.number].text)}>
              {focus.domain.number}.0 {focus.domain.title}
            </span>
            <span className="mt-0.5 block text-[11px] text-pv-text-muted">
              {focus.domain.weight} % of the exam · {Math.round(focus.readiness)} % ready{focus.checkpoint ? ` · checkpoint ${focus.checkpoint.best} %` : ""}
            </span>
          </button>
        )}
      </GlassPanel>
    </section>
  );
}

function DomainOverview({ view, onOpen }: { view: CertView; onOpen: (id: string) => void }) {
  return (
    <section aria-labelledby="domains-heading" className="mt-10">
      <h2 id="domains-heading" className="mb-3 text-sm font-semibold uppercase tracking-wide text-pv-text-muted">
        Exam domains
      </h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {view.domains.map((d) => {
          const t = DOMAIN_TONE[d.domain.number];
          const isFocus = view.focus?.domain.id === d.domain.id;
          return (
            <button key={d.domain.id} type="button" onClick={() => onOpen(d.domain.id)} className={clsx("flex flex-col rounded-2xl border p-4 text-left transition-colors hover:bg-white/[0.04] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pv-cyan", isFocus ? t.border : "border-pv-border", "bg-white/[0.02]")}>
              <span className="flex items-start justify-between gap-2">
                <span>
                  <span className={clsx("pv-mono text-xs font-semibold", t.text)}>{d.domain.number}.0</span>
                  <span className="ml-2 text-sm font-semibold text-pv-text">{d.domain.title}</span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="pv-mono block text-sm text-pv-text">{d.domain.weight}%</span>
                  <span className="block text-[10px] text-pv-text-faint">of the exam</span>
                </span>
              </span>
              <span className="mt-3 block h-2 overflow-hidden rounded-full bg-white/5" aria-hidden>
                <span className={clsx("block h-full rounded-full transition-[width] duration-700", t.bar)} style={{ width: `${d.percent}%` }} />
              </span>
              <span className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[11px] text-pv-text-muted">
                <span>
                  {d.completed} / {d.total} lessons · {d.objectivesCovered}/{d.objectivesTotal} objectives
                </span>
                <span className="text-pv-text-faint">{d.checkpoint ? `Checkpoint ${d.checkpoint.best} %` : isFocus ? "Focus next" : ""}</span>
              </span>
              <span className="sr-only">
                {Math.round(d.percent)} percent complete{isFocus ? ", suggested focus" : ""}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function StudyPlan({ view }: { view: CertView }) {
  const nextId = view.next?.module.lessonId;
  return (
    <ol className="space-y-6">
      {view.stages.map((s, i) => {
        const done = s.total > 0 && s.completed === s.total;
        return (
          <li key={s.stage.id} className="grid gap-3 sm:grid-cols-[44px_1fr]">
            <div className="hidden flex-col items-center sm:flex" aria-hidden>
              <span className={clsx("grid size-9 place-items-center rounded-full border text-sm font-semibold pv-mono", done ? "border-pv-success/50 bg-pv-success/10 text-pv-success" : s.modules.some((m) => m.module.lessonId === nextId) ? "border-pv-cyan/60 bg-pv-cyan/10 text-pv-cyan-soft" : "border-pv-border text-pv-text-muted")}>
                {done ? <Icon d={Icons.check} className="size-4" /> : i + 1}
              </span>
              {i < view.stages.length - 1 && <span className="mt-1 w-px flex-1 bg-pv-border" />}
            </div>
            <div>
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-base font-semibold text-pv-text">
                  <span className="mr-2 text-pv-text-faint sm:hidden">{i + 1}.</span>
                  {s.stage.title}
                </h3>
                <span className="pv-mono text-[11px] text-pv-text-faint">
                  {s.completed}/{s.total} lessons
                </span>
              </div>
              <p className="mb-3 text-xs text-pv-text-muted">{s.stage.summary}</p>
              <div className="grid gap-3 md:grid-cols-2">
                {s.modules.map((m) => (
                  <ModuleTile key={m.module.lessonId + m.domain.id} v={m} upNext={m.module.lessonId === nextId} />
                ))}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function Blueprint({ view, openDomain, setOpenDomain, onQuiz }: { view: CertView; openDomain: string | null; setOpenDomain: (id: string | null) => void; onQuiz: (d: DomainView) => void }) {
  return (
    <div className="space-y-4">
      {view.domains.map((d) => {
        const t = DOMAIN_TONE[d.domain.number];
        const open = openDomain === null ? d.domain.id === view.focus?.domain.id : openDomain === d.domain.id;
        const questions = view.cert.checkpoints[d.domain.id] ?? [];
        return (
          <GlassPanel key={d.domain.id} id={`domain-${d.domain.id}`} className="scroll-mt-24 overflow-hidden p-0">
            <button type="button" aria-expanded={open} aria-controls={`domain-body-${d.domain.id}`} onClick={() => setOpenDomain(open ? "" : d.domain.id)} className="flex w-full flex-col gap-3 p-4 text-left sm:flex-row sm:items-center sm:justify-between sm:p-5">
              <span className="min-w-0">
                <span className={clsx("pv-mono text-xs font-semibold", t.text)}>
                  {d.domain.number}.0 · {d.domain.weight}% of the exam
                </span>
                <span className="mt-0.5 block text-base font-semibold text-pv-text">{d.domain.title}</span>
                <span className="mt-1 block text-xs text-pv-text-muted">{d.domain.summary}</span>
              </span>
              <span className="flex w-full shrink-0 items-center gap-3 sm:w-56">
                <span className="flex-1">
                  <span className="mb-1 flex justify-between text-[11px] text-pv-text-muted">
                    <span>
                      {d.completed}/{d.total} lessons
                    </span>
                    <span className="pv-mono text-pv-text">{Math.round(d.percent)}%</span>
                  </span>
                  <span className="block h-2 overflow-hidden rounded-full bg-white/5" aria-hidden>
                    <span className={clsx("block h-full rounded-full", t.bar)} style={{ width: `${d.percent}%` }} />
                  </span>
                </span>
                <span className={clsx("text-pv-text-faint transition-transform", open && "rotate-180")} aria-hidden>
                  ▾
                </span>
              </span>
            </button>
            {open && (
              <div id={`domain-body-${d.domain.id}`} className="border-t border-pv-border p-4 sm:p-5">
                <ul className="divide-y divide-pv-border">
                  {d.objectives.map((o) => (
                    <li key={o.id} className="grid gap-2 py-3 sm:grid-cols-[52px_1fr_auto] sm:items-start">
                      <span className={clsx("pv-mono text-sm font-semibold", o.covered ? "text-pv-success" : t.text)}>{o.id}</span>
                      <span className="min-w-0">
                        <span className="block text-sm text-pv-text">{o.title}</span>
                        <span className="mt-0.5 block text-[11px] text-pv-text-faint">{o.topics.join(" · ")}</span>
                        <span className="mt-2 flex flex-wrap gap-1.5">
                          {o.lessons.map((l) =>
                            l.href ? (
                              <Link key={l.module.lessonId} href={l.href} className={clsx("inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] hover:bg-white/[0.04]", l.status === "completed" ? "border-pv-success/40 text-pv-success" : "border-pv-border text-pv-text-muted")}>
                                {l.status === "completed" && <Icon d={Icons.check} className="size-3" />}
                                {l.title}
                                {l.module.role !== "core" && <span className="text-pv-text-faint">· {l.module.role === "practice" ? "practice" : "go further"}</span>}
                              </Link>
                            ) : (
                              <span key={l.module.lessonId} className="inline-flex items-center gap-1 rounded-md border border-dashed border-pv-border px-2 py-1 text-[11px] text-pv-text-faint">
                                {l.title} · in development
                              </span>
                            ),
                          )}
                        </span>
                      </span>
                      <span className={clsx("text-[11px] font-semibold uppercase tracking-wide", o.covered ? "text-pv-success" : "text-pv-text-faint")}>{o.covered ? "Covered" : "To learn"}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-4 flex flex-col gap-3 rounded-xl border border-pv-border bg-white/[0.02] p-3 sm:flex-row sm:items-center sm:justify-between">
                  <span className="text-xs text-pv-text-muted">
                    <span className="block font-semibold text-pv-text">Domain checkpoint</span>
                    {questions.length ? `${questions.length} exam-style questions. Each wrong answer points you to the lesson to revisit.` : "Exam-style questions for this domain arrive with its lessons."}
                    {d.checkpoint && (
                      <span className="mt-1 block text-pv-text-faint">
                        Last attempt {d.checkpoint.correct}/{d.checkpoint.total} · best {d.checkpoint.best} %
                      </span>
                    )}
                  </span>
                  {questions.length > 0 && (
                    <button type="button" onClick={() => onQuiz(d)} className="min-h-10 shrink-0 rounded-full border border-pv-cyan/50 px-4 text-sm text-pv-cyan-soft hover:bg-pv-cyan/10 focus-visible:outline-2 focus-visible:outline-pv-cyan">
                      {d.checkpoint ? "Retake checkpoint" : "Take checkpoint"}
                    </button>
                  )}
                </div>
                {(d.practice.length > 0 || d.further.length > 0) && (
                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    {[...d.practice, ...d.further].map((m) => (
                      <ModuleTile key={m.module.lessonId} v={m} showDomain={false} />
                    ))}
                  </div>
                )}
              </div>
            )}
          </GlassPanel>
        );
      })}
    </div>
  );
}

const ARC = ["Understand", "See it", "Interact", "Inspect", "Configure", "Verify", "Troubleshoot"];

function HowWeTeach() {
  return (
    <section aria-labelledby="how-heading" className="mt-12">
      <GlassPanel className="p-5 sm:p-6">
        <h2 id="how-heading" className="text-sm font-semibold text-pv-text">
          How each CCNA topic is taught here
        </h2>
        <ol className="mt-3 flex flex-wrap gap-2" aria-label="Lesson arc">
          {ARC.map((s, i) => (
            <li key={s} className="inline-flex items-center gap-2 rounded-full border border-pv-border px-3 py-1 text-xs text-pv-text-muted">
              <span className="pv-mono text-pv-text-faint">{i + 1}</span>
              {s}
            </li>
          ))}
        </ol>
        <p className="mt-3 max-w-3xl text-xs leading-relaxed text-pv-text-muted">
          Not a reading list. Each lesson starts from a real problem, lets you predict what the network does, shows every packet and table change, lets you enter the devices, and ends with a fault to diagnose and repair. Labs add Cisco IOS and Junos consoles on the same network.
        </p>
      </GlassPanel>
    </section>
  );
}
