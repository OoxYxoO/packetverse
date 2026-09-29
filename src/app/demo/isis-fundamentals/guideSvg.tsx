import type { ReactNode } from "react";
import { DArrow, DIAGRAM as D, DLink, DNode } from "@/components/lesson/GuideBlocks";

/**
 * Lesson-local SVG helpers for the IS-IS guides: the PE1 — P1 — P2 — PE2 chain and a message-sequence ("lanes")
 * diagram. Presentation only — every address, System ID and sequence number is passed in by the guide from scenario
 * exports.
 */
export const CX = { PE1: 76, P1: 236, P2: 404, PE2: 564 } as const;
export type ChainRouter = keyof typeof CX;
type Seg = "a" | "b" | "c";
const ENDS: Record<Seg, [ChainRouter, ChainRouter]> = { a: ["PE1", "P1"], b: ["P1", "P2"], c: ["P2", "PE2"] };
export type SegMode = "idle" | "right" | "left" | "both" | "down";

export function IsisChain({ y = 100, subs = {}, segs = {}, labels = {}, below = {}, colors = {}, accents = {}, children }: { y?: number; subs?: Partial<Record<ChainRouter, string>>; segs?: Partial<Record<Seg, SegMode>>; labels?: Partial<Record<Seg, string>>; below?: Partial<Record<Seg, string>>; colors?: Partial<Record<Seg, string>>; accents?: Partial<Record<ChainRouter, string>>; children?: ReactNode }) {
  return (
    <g>
      {(Object.keys(ENDS) as Seg[]).map((k) => {
        const [a, b] = ENDS[k];
        const x1 = CX[a] + 54;
        const x2 = CX[b] - 54;
        const m = segs[k] ?? "idle";
        const c = colors[k] ?? (m === "idle" ? D.line : m === "down" ? D.danger : D.cyan);
        const mid = (x1 + x2) / 2;
        return (
          <g key={k}>
            {m === "idle" ? <DLink x1={x1} y1={y} x2={x2} y2={y} color={c} /> : m === "down" ? <DLink x1={x1} y1={y} x2={x2} y2={y} color={D.success} /> : m === "right" ? <DArrow x1={x1} y1={y} x2={x2} y2={y} color={c} /> : m === "left" ? <DArrow x1={x2} y1={y} x2={x1} y2={y} color={c} /> : <DArrow x1={x1} y1={y} x2={x2} y2={y} color={c} both />}
            {labels[k] && (
              <text x={mid} y={y - 32} textAnchor="middle" fill={m === "down" ? D.danger : c === D.line ? D.muted : c} fontSize={9} fontFamily="monospace" fontWeight={700}>
                {labels[k]}
              </text>
            )}
            {below[k] && (
              <text x={mid} y={y + 38} textAnchor="middle" fill={D.muted} fontSize={8.5} fontFamily="monospace">
                {below[k]}
              </text>
            )}
          </g>
        );
      })}
      {(Object.keys(CX) as ChainRouter[]).map((r) => (
        <DNode key={r} x={CX[r]} y={y} label={r} sub={subs[r]} accent={accents[r] ?? (r.startsWith("PE") ? D.violet : D.cyan)} w={104} h={subs[r] ? 44 : 36} />
      ))}
      {children}
    </g>
  );
}

/** Message-sequence lanes: vertical lifelines with horizontal messages and an optional note under each label. */
export function Lanes({ lanes, msgs, top = 26, rowH = 34 }: { lanes: { x: number; label: string; color?: string }[]; msgs: { from: number; to: number; label: string; sub?: string; color?: string; drop?: boolean }[]; top?: number; rowH?: number }) {
  const bottom = top + 14 + msgs.length * rowH;
  return (
    <g>
      {lanes.map((l) => (
        <g key={l.label}>
          <text x={l.x} y={top - 8} textAnchor="middle" fill={l.color ?? D.text} fontSize={11} fontWeight={700}>
            {l.label}
          </text>
          <line x1={l.x} y1={top} x2={l.x} y2={bottom} stroke={D.line} strokeDasharray="3 4" />
        </g>
      ))}
      {msgs.map((m, i) => {
        const y = top + 26 + i * rowH;
        const x1 = lanes[m.from].x;
        const full = lanes[m.to].x;
        const x2 = m.drop ? x1 + (full - x1) * 0.6 : full;
        const dir = full > x1 ? 1 : -1;
        const c = m.drop ? D.danger : (m.color ?? D.cyan);
        return (
          <g key={i}>
            <DArrow x1={x1 + dir * 4} y1={y} x2={x2 - dir * 4} y2={y} color={c} width={1.8} />
            <text x={(x1 + x2) / 2} y={y - 7} textAnchor="middle" fill={c} fontSize={9.5} fontFamily="monospace" fontWeight={700}>
              {m.label}
            </text>
            {m.sub && (
              <text x={(x1 + x2) / 2} y={y + 13} textAnchor="middle" fill={D.muted} fontSize={8.5} fontFamily="monospace">
                {m.sub}
              </text>
            )}
            {m.drop && (
              <text x={x2 + dir * 16} y={y + 5} textAnchor="middle" fill={D.danger} fontSize={14} fontWeight={800}>
                ✕
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
}
