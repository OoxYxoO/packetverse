"use client";

import Link from "next/link";
import { useMemo } from "react";
import { clsx } from "clsx";
import { certificationsForLesson } from "@/lib/content/certifications";
import { getCertView } from "@/lib/content/certificationProgress";
import { useProgressStore } from "@/lib/state/useProgressStore";
import { DOMAIN_TONE } from "./certUi";

/**
 * Where this lesson sits in a certification, shown once, quietly, under the lesson's badge: "CCNA · 2.0 Network
 * Access · 2.1 · 2.2". Practice / go-further lessons say so. Lessons outside any certification render nothing.
 */
export function CertTrail({ lessonId, className }: { lessonId: string; className?: string }) {
  const refs = certificationsForLesson(lessonId);
  if (!refs.length) return null;
  // one line per certification: its core placement if any, otherwise the first reference
  const byCert = new Map<string, (typeof refs)[number]>();
  for (const r of refs) if (!byCert.has(r.cert.id) || r.module.role === "core") byCert.set(r.cert.id, r);
  return (
    <p className={clsx("flex flex-wrap items-center gap-x-2 gap-y-1 text-xs", className)}>
      {[...byCert.values()].map(({ cert, domain, module }) => (
        <Link key={cert.id} href={`/certifications/${cert.id}`} className="inline-flex flex-wrap items-center gap-x-1.5 rounded-md text-pv-text-muted hover:text-pv-text focus-visible:outline-2 focus-visible:outline-pv-cyan">
          <span className="sr-only">Part of </span>
          <span className="font-semibold text-pv-text">{cert.title}</span>
          <span aria-hidden className="text-pv-text-faint">
            ›
          </span>
          <span className={DOMAIN_TONE[domain.number].text}>
            {domain.number}.0 {domain.title}
          </span>
          <span aria-hidden className="text-pv-text-faint">
            ›
          </span>
          <span className="sr-only">, objectives </span>
          <span className="pv-mono text-pv-text-muted">{module.covers.join(" · ")}</span>
          {module.role !== "core" && <span className="rounded border border-pv-border px-1 text-[10px] uppercase tracking-wide text-pv-text-faint">{module.role === "practice" ? "practice" : "go further"}</span>}
        </Link>
      ))}
    </p>
  );
}

/** On lesson completion: the next lesson in each certification journey this lesson belongs to. */
export function CertNextStep({ lessonId }: { lessonId: string }) {
  const completedLessons = useProgressStore((s) => s.completedLessons);
  const refs = certificationsForLesson(lessonId);
  const certs = useMemo(() => [...new Map(refs.map((r) => [r.cert.id, r.cert])).values()], [refs]);
  const views = useMemo(() => certs.map((c) => getCertView(c, completedLessons)), [certs, completedLessons]);
  if (!views.length) return null;
  return (
    <div className="grid w-full max-w-md gap-2">
      {views.map((v) =>
        v.next && v.next.module.lessonId !== lessonId ? (
          <Link key={v.cert.id} href={v.next.href!} className="rounded-xl border border-pv-cyan/40 bg-pv-cyan/[0.05] p-3 text-left hover:bg-pv-cyan/[0.09] focus-visible:outline-2 focus-visible:outline-pv-cyan">
            <span className="block text-[10px] font-semibold uppercase tracking-[0.18em] text-pv-text-faint">Next in your {v.cert.title} journey</span>
            <span className="block text-sm font-semibold text-pv-text">{v.next.title} →</span>
            <span className="block text-[11px] text-pv-text-muted">
              {v.next.domain.number}.0 {v.next.domain.title} · {Math.round(v.percent)} % of {v.cert.title} complete
            </span>
          </Link>
        ) : (
          <Link key={v.cert.id} href={`/certifications/${v.cert.id}`} className="rounded-xl border border-pv-border p-3 text-left text-sm text-pv-text-muted hover:bg-white/[0.04]">
            Back to the {v.cert.title} journey · {Math.round(v.percent)} % complete →
          </Link>
        ),
      )}
    </div>
  );
}
