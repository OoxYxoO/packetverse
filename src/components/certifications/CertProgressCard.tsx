"use client";

import Link from "next/link";
import { useMemo } from "react";
import { clsx } from "clsx";
import type { Certification } from "@/lib/content/certifications";
import { getCertView } from "@/lib/content/certificationProgress";
import { useProgressStore } from "@/lib/state/useProgressStore";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { DOMAIN_TONE, Ring } from "./certUi";

/** Compact certification progress (dashboard): readiness, per-domain bars, and where to continue. */
export function CertProgressCard({ cert }: { cert: Certification }) {
  const completedLessons = useProgressStore((s) => s.completedLessons);
  const checkpoints = useProgressStore((s) => s.checkpoints);
  const v = useMemo(() => getCertView(cert, completedLessons, checkpoints), [cert, completedLessons, checkpoints]);
  return (
    <GlassPanel strong className="p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="pv-mono text-xs text-pv-text-muted">
            {cert.vendor} · {cert.examCode}
          </p>
          <h2 className="text-sm font-semibold text-pv-text">{cert.title} journey</h2>
        </div>
        <Link href={`/certifications/${cert.id}`} className="text-xs text-pv-cyan-soft hover:underline">
          Open →
        </Link>
      </div>
      <div className="mt-4 flex flex-col gap-5 sm:flex-row sm:items-center">
        <Ring value={v.percent} label="ready" size={96} stroke={8} />
        <ul className="grid flex-1 gap-1.5">
          {v.domains.map((d) => (
            <li key={d.domain.id} className="grid grid-cols-[2.2rem_1fr_2.5rem] items-center gap-2 text-[11px]">
              <span className={clsx("pv-mono font-semibold", DOMAIN_TONE[d.domain.number].text)}>{d.domain.number}.0</span>
              <span className="block h-1.5 overflow-hidden rounded-full bg-white/5" aria-hidden>
                <span className={clsx("block h-full rounded-full", DOMAIN_TONE[d.domain.number].bar)} style={{ width: `${d.percent}%` }} />
              </span>
              <span className="pv-mono text-right text-pv-text-muted">
                {d.completed}/{d.total}
                <span className="sr-only"> lessons in {d.domain.title}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
      {v.next && (
        <Link href={v.next.href!} className="mt-4 block rounded-xl border border-pv-cyan/40 bg-pv-cyan/[0.05] p-3 hover:bg-pv-cyan/[0.09]">
          <span className="block text-[10px] font-semibold uppercase tracking-[0.18em] text-pv-text-faint">Up next</span>
          <span className="block text-sm font-semibold text-pv-text">{v.next.title}</span>
          <span className="block text-[11px] text-pv-text-muted">
            {v.next.domain.number}.0 {v.next.domain.title} · {v.next.stage.title}
          </span>
        </Link>
      )}
    </GlassPanel>
  );
}
