import { useId, type ReactNode } from "react";

/**
 * Small presentational building blocks for lesson guides — sections,
 * callouts, numbered flows, comparisons and glossaries — so each lesson
 * only writes its own content and diagrams.
 */
export type GuideTone = "cyan" | "violet" | "success" | "warning" | "danger" | "arp" | "ethernet" | "ip" | "tcp" | "ospf" | "bgp" | "mpls";

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
  ospf: "var(--pv-proto-ospf)",
  bgp: "var(--pv-proto-bgp)",
  mpls: "var(--pv-proto-mpls)",
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

/* ------------------------------------------------------------------------
 * Generic SVG diagram primitives — lesson guides compose these into their
 * own topology/flow diagrams (the diagrams themselves stay lesson-local).
 * ---------------------------------------------------------------------- */

/** Hex palette for SVG (CSS variables don't resolve inside every SVG attribute). */
export const DIAGRAM = {
  text: "#e8edf9",
  muted: "#8b96ac",
  faint: "#5b6478",
  box: "#121a2e",
  line: "#3a4460",
  cyan: "#22d3ee",
  violet: "#8b8cf8",
  success: "#34d399",
  warning: "#fbbf24",
  danger: "#fb7185",
  arp: "#f59e0b",
  eth: "#94a3b8",
  ip: "#60a5fa",
  tcp: "#34d399",
  bgp: "#fb7185",
  ospf: "#22d3ee",
  mpls: "#f472b6",
};

export function DiagramSvg({ h, w = 640, label, children }: { h: number; w?: number; label: string; children: ReactNode }) {
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-auto w-full" role="img" aria-label={label}>
      {children}
    </svg>
  );
}

/** A labeled device box centered on (x, y). */
export function DNode({ x, y, label, sub, accent = DIAGRAM.cyan, w = 100, h = 44 }: { x: number; y: number; label: string; sub?: string; accent?: string; w?: number; h?: number }) {
  return (
    <g>
      <rect x={x - w / 2} y={y - h / 2} width={w} height={h} rx={10} fill={DIAGRAM.box} stroke={accent} strokeOpacity={0.75} />
      <text x={x} y={sub ? y - 3 : y + 4} textAnchor="middle" fill={DIAGRAM.text} fontSize={12} fontWeight={600}>
        {label}
      </text>
      {sub && (
        <text x={x} y={y + 13} textAnchor="middle" fill={DIAGRAM.muted} fontSize={9.5} fontFamily="monospace">
          {sub}
        </text>
      )}
    </g>
  );
}

/** Straight arrow with an optional mid-point label; `both` draws heads at both ends. */
export function DArrow({ x1, y1, x2, y2, color = DIAGRAM.cyan, dashed, label, labelDy = -8, both, width = 2.2 }: { x1: number; y1: number; x2: number; y2: number; color?: string; dashed?: boolean; label?: string; labelDy?: number; both?: boolean; width?: number }) {
  const id = `pv-arrow-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return (
    <g>
      <defs>
        <marker id={id} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill={color} />
        </marker>
      </defs>
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth={width} strokeDasharray={dashed ? "5 4" : undefined} markerEnd={`url(#${id})`} markerStart={both ? `url(#${id})` : undefined} />
      {label && (
        <text x={(x1 + x2) / 2} y={(y1 + y2) / 2 + labelDy} textAnchor="middle" fill={color} fontSize={10} fontWeight={700}>
          {label}
        </text>
      )}
    </g>
  );
}

/** Plain connector line (a cable / session) with an optional label. */
export function DLink({ x1, y1, x2, y2, color = DIAGRAM.line, dashed, label, labelDy = -6 }: { x1: number; y1: number; x2: number; y2: number; color?: string; dashed?: boolean; label?: string; labelDy?: number }) {
  return (
    <g>
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth={2} strokeDasharray={dashed ? "5 4" : undefined} />
      {label && (
        <text x={(x1 + x2) / 2} y={(y1 + y2) / 2 + labelDy} textAnchor="middle" fill={color} fontSize={10} fontWeight={700}>
          {label}
        </text>
      )}
    </g>
  );
}

/** Dashed labeled region (an AS, area, cluster, subnet…). */
export function DRegion({ x, y, w, h, label, color = DIAGRAM.cyan }: { x: number; y: number; w: number; h: number; label: string; color?: string }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={14} fill={color} fillOpacity={0.05} stroke={color} strokeOpacity={0.4} strokeDasharray="6 5" />
      <text x={x + 12} y={y + 18} fill={color} fontSize={10} fontWeight={700}>
        {label}
      </text>
    </g>
  );
}

/** Rounded pill of text, e.g. a state name or a note on a diagram. */
export function DPill({ x, y, text, color = DIAGRAM.cyan, w }: { x: number; y: number; text: string; color?: string; w?: number }) {
  const width = w ?? Math.max(60, text.length * 6.6 + 20);
  return (
    <g>
      <rect x={x - width / 2} y={y - 12} width={width} height={24} rx={12} fill={color} fillOpacity={0.14} stroke={color} strokeOpacity={0.6} />
      <text x={x} y={y + 4} textAnchor="middle" fill={color} fontSize={10.5} fontWeight={700}>
        {text}
      </text>
    </g>
  );
}

/** Compact HTML table for header/field/attribute breakdowns inside a guide. */
export function FieldTable({ title, columns, rows, accent = "cyan" }: { title: string; columns: string[]; rows: ReactNode[][]; accent?: GuideTone }) {
  const c = GUIDE_TONE[accent];
  return (
    <div className="overflow-hidden rounded-xl border border-white/10">
      <div className="border-b border-white/10 bg-white/[0.03] px-4 py-2 text-[10px] font-bold uppercase tracking-wide" style={{ color: c }}>
        {title}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr>
              {columns.map((col) => (
                <th key={col} className="px-4 py-2 font-semibold text-pv-text-faint">
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {rows.map((r, i) => (
              <tr key={i}>
                {r.map((cell, j) => (
                  <td key={j} className={j === 0 ? "px-4 py-2 font-medium text-pv-text" : "px-4 py-2 text-pv-text-muted"}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
