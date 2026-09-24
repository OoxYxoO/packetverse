import type { ReactNode } from "react";

/**
 * Small presentational building blocks for lesson guides — sections,
 * callouts, numbered flows, comparisons and glossaries — so each lesson
 * only writes its own content and diagrams.
 */
export type GuideTone = "cyan" | "violet" | "success" | "warning" | "danger" | "arp" | "ethernet" | "ip" | "tcp";

export const GUIDE_TONE: Record<GuideTone, string> = {
  cyan: "var(--pv-cyan)",
  violet: "var(--pv-violet)",
  success: "var(--pv-success)",
  warning: "var(--pv-warning)",
  danger: "var(--pv-danger)",
  arp: "var(--pv-proto-arp)",
  ethernet: "#94a3b8",
  ip: "var(--pv-proto-ip)",
  tcp: "var(--pv-proto-tcp)",
};

const tint = (c: string, pct: number) => `color-mix(in srgb, ${c} ${pct}%, transparent)`;

export function GuideSection({ id, eyebrow, title, tone = "cyan", children }: { id: string; eyebrow: string; title: string; tone?: GuideTone; children: ReactNode }) {
  const c = GUIDE_TONE[tone];
  return (
    <section id={id} className="scroll-mt-6">
      <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.2em]" style={{ color: c }}>
        {eyebrow}
      </p>
      <h3 className="mb-4 text-xl font-semibold text-pv-text sm:text-2xl">{title}</h3>
      <div className="space-y-4 text-sm leading-relaxed text-pv-text-muted">{children}</div>
    </section>
  );
}

export function Callout({ tone = "cyan", title, icon = "i", children }: { tone?: GuideTone; title: string; icon?: string; children: ReactNode }) {
  const c = GUIDE_TONE[tone];
  return (
    <div className="flex gap-3 rounded-xl border p-4" style={{ borderColor: tint(c, 35), background: tint(c, 7) }}>
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold" style={{ background: tint(c, 20), color: c }} aria-hidden>
        {icon}
      </span>
      <div>
        <p className="mb-0.5 text-xs font-bold uppercase tracking-wide" style={{ color: c }}>
          {title}
        </p>
        <div className="text-sm text-pv-text">{children}</div>
      </div>
    </div>
  );
}

export function FlowSteps({ steps }: { steps: { title: string; body: ReactNode; tone?: GuideTone }[] }) {
  return (
    <ol className="relative space-y-3 border-l border-white/10 pl-6">
      {steps.map((s, i) => {
        const c = GUIDE_TONE[s.tone ?? "cyan"];
        return (
          <li key={s.title} className="relative">
            <span
              className="pv-mono absolute -left-[37px] top-0 flex h-6 w-6 items-center justify-center rounded-full border text-[10px] font-bold"
              style={{ borderColor: c, color: c, background: "var(--pv-bg-elevated, #0a0e18)" }}
            >
              {i + 1}
            </span>
            <p className="text-sm font-semibold text-pv-text">{s.title}</p>
            <div className="text-sm text-pv-text-muted">{s.body}</div>
          </li>
        );
      })}
    </ol>
  );
}

export function CompareCards({ items }: { items: { title: string; tone: GuideTone; tag: string; points: string[] }[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {items.map((it) => {
        const c = GUIDE_TONE[it.tone];
        return (
          <div key={it.title} className="rounded-xl border p-4" style={{ borderColor: tint(c, 30), background: tint(c, 5) }}>
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="font-semibold text-pv-text">{it.title}</p>
              <span className="pv-mono rounded-md px-2 py-0.5 text-[10px] font-bold" style={{ background: tint(c, 18), color: c }}>
                {it.tag}
              </span>
            </div>
            <ul className="space-y-1.5">
              {it.points.map((p) => (
                <li key={p} className="flex gap-2 text-xs text-pv-text-muted">
                  <span style={{ color: c }}>▸</span>
                  {p}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

export function DiagramFrame({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    <figure className="overflow-hidden rounded-xl border border-white/10 bg-black/30">
      <div className="px-3 pt-4 pb-2">{children}</div>
      <figcaption className="border-t border-white/5 px-4 py-2 text-[11px] text-pv-text-faint">{caption}</figcaption>
    </figure>
  );
}

export function Glossary({ items }: { items: { term: string; def: string }[] }) {
  return (
    <dl className="grid gap-2 sm:grid-cols-2">
      {items.map((it) => (
        <div key={it.term} className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
          <dt className="pv-mono text-xs font-bold text-pv-cyan-soft">{it.term}</dt>
          <dd className="mt-0.5 text-xs text-pv-text-muted">{it.def}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ChecklistCard({ tone, title, items, mark }: { tone: GuideTone; title: string; items: ReactNode[]; mark: string }) {
  const c = GUIDE_TONE[tone];
  return (
    <div className="rounded-xl border p-4" style={{ borderColor: tint(c, 30), background: tint(c, 5) }}>
      <p className="mb-2 text-xs font-bold uppercase tracking-wide" style={{ color: c }}>
        {title}
      </p>
      <ul className="space-y-2">
        {items.map((it, i) => (
          <li key={i} className="flex gap-2 text-sm text-pv-text">
            <span className="shrink-0 font-bold" style={{ color: c }}>
              {mark}
            </span>
            <span>{it}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Inline monospace token, e.g. an address or a header field. */
export function Mono({ children, tone }: { children: ReactNode; tone?: GuideTone }) {
  return (
    <span className="pv-mono rounded bg-white/5 px-1 py-0.5 text-[0.85em]" style={tone ? { color: GUIDE_TONE[tone] } : undefined}>
      {children}
    </span>
  );
}
