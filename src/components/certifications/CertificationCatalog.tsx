"use client";

import Link from "next/link";
import { useMemo } from "react";
import { clsx } from "clsx";
import { CERTIFICATIONS } from "@/lib/content/certifications";
import { getCertView } from "@/lib/content/certificationProgress";
import { useProgressStore } from "@/lib/state/useProgressStore";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { Badge } from "@/components/ui/Badge";
import { DOMAIN_TONE, Ring } from "./certUi";

/** /certifications — choose what you are studying for. Only certifications with domains are open; the next one is shown so students see the path continues. */
export function CertificationCatalog() {
  const completedLessons = useProgressStore((s) => s.completedLessons);
  const checkpoints = useProgressStore((s) => s.checkpoints);
  const views = useMemo(() => CERTIFICATIONS.filter((c) => c.domains.length).map((c) => getCertView(c, completedLessons, checkpoints)), [completedLessons, checkpoints]);
  const upcoming = CERTIFICATIONS.filter((c) => !c.domains.length);

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-12">
      <Badge tone="cyan" className="mb-3">
        Certifications
      </Badge>
      <h1 className="text-2xl font-semibold text-pv-text sm:text-3xl">What are you studying for?</h1>
      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-pv-text-muted">
        Pick a certification and PacketVerse lays out every exam topic as a journey of interactive lessons — in an order that teaches, with your progress and weak spots tracked per exam domain. The lessons teach the networking itself, so what you learn carries across vendors.
      </p>

      <div className="mt-8 grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        {views.map((v) => (
          <Link key={v.cert.id} href={`/certifications/${v.cert.id}`} className="group block rounded-3xl focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-pv-cyan">
            <GlassPanel strong className="h-full p-5 transition-colors group-hover:border-pv-border-strong sm:p-6">
              <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
                <Ring value={v.percent} label="ready" size={104} stroke={9} />
                <div className="min-w-0 flex-1">
                  <p className="pv-mono text-xs text-pv-text-muted">
                    {v.cert.vendor} · {v.cert.examCode}
                  </p>
                  <h2 className="mt-0.5 text-xl font-semibold text-pv-text">
                    {v.cert.title} <span className="text-sm font-normal text-pv-text-muted">{v.cert.fullName}</span>
                  </h2>
                  <p className="mt-2 text-sm leading-relaxed text-pv-text-muted">{v.cert.summary}</p>
                  <p className="mt-3 text-xs text-pv-text-faint">
                    {v.total} lessons · {v.objectivesTotal} exam objectives · {v.domains.length} domains
                  </p>
                </div>
              </div>
              <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {v.domains.map((d) => (
                  <div key={d.domain.id} className="rounded-xl border border-pv-border bg-white/[0.02] p-2.5">
                    <p className="flex items-baseline justify-between gap-2 text-[11px]">
                      <span className={clsx("pv-mono font-semibold", DOMAIN_TONE[d.domain.number].text)}>{d.domain.number}.0</span>
                      <span className="pv-mono text-pv-text-faint">{d.domain.weight}%</span>
                    </p>
                    <p className="mt-0.5 truncate text-xs text-pv-text">{d.domain.title}</p>
                    <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-white/5" aria-hidden>
                      <span className={clsx("block h-full rounded-full", DOMAIN_TONE[d.domain.number].bar)} style={{ width: `${d.percent}%` }} />
                    </span>
                  </div>
                ))}
              </div>
              <p className="mt-5 text-sm font-semibold text-pv-cyan-soft">{v.completed ? "Continue the CCNA journey →" : "Start the CCNA journey →"}</p>
            </GlassPanel>
          </Link>
        ))}

        <div className="grid content-start gap-4">
          {upcoming.map((c) => (
            <GlassPanel key={c.id} className="p-5">
              <div className="flex items-center justify-between gap-2">
                <p className="pv-mono text-xs text-pv-text-muted">
                  {c.vendor} · {c.examCode}
                </p>
                <Badge tone="muted">{c.status === "next" ? "Next" : "Planned"}</Badge>
              </div>
              <h2 className="mt-1 text-base font-semibold text-pv-text">{c.title}</h2>
              <p className="mt-1 text-xs leading-relaxed text-pv-text-muted">{c.summary}</p>
            </GlassPanel>
          ))}
          <GlassPanel className="p-5">
            <h2 className="text-sm font-semibold text-pv-text">Learning by role, or by vendor?</h2>
            <p className="mt-1 text-xs leading-relaxed text-pv-text-muted">The career tracks — Fundamentals, Enterprise, Service Provider and Troubleshooting — and the Junos-first material are still here, using the same lessons.</p>
            <div className="mt-3 flex flex-wrap gap-3 text-sm">
              <Link href="/learn" className="text-pv-cyan-soft hover:underline">
                Career tracks →
              </Link>
              <Link href="/lessons" className="text-pv-cyan-soft hover:underline">
                All lessons →
              </Link>
            </div>
          </GlassPanel>
        </div>
      </div>
    </div>
  );
}
