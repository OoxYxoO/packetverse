import type { ReactNode } from "react";
import { DArrow, DIAGRAM as D, DLink, DNode } from "@/components/lesson/GuideBlocks";

/**
 * Lesson-local SVG helpers for the Stateful Firewall guides: the CLIENT — FW1 — ISP — WEB-SERVER chain with its two
 * zones, and a simple message-sequence ("lanes") diagram. Presentation only — every address and name is passed in
 * by the guide, which reads it from scenario exports.
 */
export const FP = { CLIENT: { x: 70, y: 112 }, FW1: { x: 240, y: 112 }, ISP: { x: 410, y: 112 }, WEB: { x: 572, y: 112 } };
export type SegMode = "idle" | "right" | "left" | "both" | "drop-left" | "drop-right";
type Seg = "cf" | "fi" | "iw";
const ENDS: Record<Seg, [keyof typeof FP, keyof typeof FP]> = { cf: ["CLIENT", "FW1"], fi: ["FW1", "ISP"], iw: ["ISP", "WEB"] };
const HALF = { CLIENT: 48, FW1: 52, ISP: 44, WEB: 56 };

function Segment({ seg, mode, label, color }: { seg: Seg; mode: SegMode; label?: string; color?: string }) {
  const [a, b] = ENDS[seg];
  const x1 = FP[a].x + HALF[a] + 4;
  const x2 = FP[b].x - HALF[b] - 4;
  const y = FP[a].y;
  const c = color ?? (mode === "idle" ? D.line : mode.startsWith("drop") ? D.danger : D.tcp);
  const mid = (x1 + x2) / 2;
  return (
    <g>
      {mode === "idle" ? <DLink x1={x1} y1={y} x2={x2} y2={y} color={c} /> : mode === "right" ? <DArrow x1={x1} y1={y} x2={x2} y2={y} color={c} /> : mode === "left" ? <DArrow x1={x2} y1={y} x2={x1} y2={y} color={c} /> : mode === "both" ? <DArrow x1={x1} y1={y} x2={x2} y2={y} color={c} both /> : mode === "drop-left" ? <DArrow x1={x2} y1={y} x2={mid} y2={y} color={c} /> : <DArrow x1={x1} y1={y} x2={mid} y2={y} color={c} />}
      {mode.startsWith("drop") && (
        <text x={mode === "drop-left" ? mid - 10 : mid + 10} y={y + 5} textAnchor="middle" fill={D.danger} fontSize={15} fontWeight={800}>
          ✕
        </text>
      )}
      {label && (
        <text x={mid} y={y + 38} textAnchor="middle" fill={c === D.line ? D.muted : c} fontSize={9} fontFamily="monospace" fontWeight={700}>
          {label}
        </text>
      )}
    </g>
  );
}

/** The four devices, both zones, and one mode/label per segment. */
export function FwChain({ subs = {}, segs = {}, labels = {}, colors = {}, zones = true, children }: { subs?: Partial<Record<keyof typeof FP, string>>; segs?: Partial<Record<Seg, SegMode>>; labels?: Partial<Record<Seg, string>>; colors?: Partial<Record<Seg, string>>; zones?: boolean; children?: ReactNode }) {
  return (
    <g>
      {zones && (
        <g>
          <rect x={10} y={56} width={226} height={112} rx={14} fill={D.cyan} fillOpacity={0.05} stroke={D.cyan} strokeOpacity={0.45} strokeDasharray="6 5" />
          <text x={22} y={73} fill={D.cyan} fontSize={10} fontWeight={700}>
            zone trust · 10.10.10.0/24
          </text>
          <rect x={244} y={56} width={386} height={112} rx={14} fill={D.warning} fillOpacity={0.04} stroke={D.warning} strokeOpacity={0.4} strokeDasharray="6 5" />
          <text x={618} y={73} textAnchor="end" fill={D.warning} fontSize={10} fontWeight={700}>
            zone untrust → Internet
          </text>
        </g>
      )}
      {(Object.keys(ENDS) as Seg[]).map((k) => (
        <Segment key={k} seg={k} mode={segs[k] ?? "idle"} label={labels[k]} color={colors[k]} />
      ))}
      <DNode x={FP.CLIENT.x} y={FP.CLIENT.y} label="CLIENT" sub={subs.CLIENT} accent={D.cyan} w={96} />
      <DNode x={FP.FW1.x} y={FP.FW1.y} label="FW1" sub={subs.FW1} accent={D.danger} w={104} />
      <DNode x={FP.ISP.x} y={FP.ISP.y} label="ISP" sub={subs.ISP} accent={D.violet} w={88} />
      <DNode x={FP.WEB.x} y={FP.WEB.y} label="WEB-SERVER" sub={subs.WEB} accent={D.success} w={112} />
      {children}
    </g>
  );
}

/** Message-sequence lanes: vertical lifelines with horizontal messages. */
export function Lanes({ lanes, msgs, top = 26, rowH = 30 }: { lanes: { x: number; label: string; color?: string }[]; msgs: { from: number; to: number; label: string; note?: string; color?: string; drop?: boolean; dashed?: boolean }[]; top?: number; rowH?: number }) {
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
        const y = top + 22 + i * rowH;
        const x1 = lanes[m.from].x;
        const x2full = lanes[m.to].x;
        const x2 = m.drop ? x1 + (x2full - x1) * 0.6 : x2full;
        const c = m.color ?? D.tcp;
        const dir = x2full > x1 ? 1 : -1;
        return (
          <g key={i}>
            <DArrow x1={x1 + dir * 4} y1={y} x2={x2 - dir * 4} y2={y} color={m.drop ? D.danger : c} dashed={m.dashed} width={1.8} />
            <text x={(x1 + x2) / 2} y={y - 6} textAnchor="middle" fill={m.drop ? D.danger : c} fontSize={9.5} fontFamily="monospace" fontWeight={700}>
              {m.label}
            </text>
            {m.drop && (
              <text x={x2 + dir * 16} y={y + 5} textAnchor="middle" fill={D.danger} fontSize={14} fontWeight={800}>
                ✕
              </text>
            )}
            {m.note && (
              <text x={dir > 0 ? Math.max(x1, x2) + 12 : Math.max(x1, x2) + 12} y={y + 4} fill={D.muted} fontSize={9}>
                {m.note}
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
}
