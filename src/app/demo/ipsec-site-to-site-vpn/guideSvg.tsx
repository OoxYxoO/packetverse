import type { ReactNode } from "react";
import { DArrow, DIAGRAM as D, DLink, DNode } from "@/components/lesson/GuideBlocks";

/**
 * Lesson-local SVG helpers for the IPsec VPN guides: the HOST-A — GW-A — INTERNET — GW-B — HOST-B chain with both
 * sites and an optional logical tunnel line, and a message-sequence ("lanes") diagram. Presentation only — every
 * address, SPI and exchange name is passed in by the guide, which reads it from scenario exports.
 */
export const VP = { A: { x: 52, y: 132 }, GA: { x: 180, y: 132 }, NET: { x: 320, y: 132 }, GB: { x: 460, y: 132 }, B: { x: 588, y: 132 } };
type Seg = "al" | "aw" | "bw" | "bl";
const ENDS: Record<Seg, [keyof typeof VP, keyof typeof VP]> = { al: ["A", "GA"], aw: ["GA", "NET"], bw: ["NET", "GB"], bl: ["GB", "B"] };
const HALF = { A: 42, GA: 44, NET: 50, GB: 44, B: 42 };
export type VSeg = "idle" | "right" | "left" | "drop-right";

export function VpnChain({ segs = {}, labels = {}, colors = {}, subs = {}, tunnel, tunnelColor = D.success, tunnelDashed, children }: { segs?: Partial<Record<Seg, VSeg>>; labels?: Partial<Record<Seg, string>>; colors?: Partial<Record<Seg, string>>; subs?: Partial<Record<keyof typeof VP, string>>; tunnel?: string; tunnelColor?: string; tunnelDashed?: boolean; children?: ReactNode }) {
  return (
    <g>
      <rect x={8} y={82} width={228} height={90} rx={14} fill={D.cyan} fillOpacity={0.05} stroke={D.cyan} strokeOpacity={0.4} strokeDasharray="6 5" />
      <text x={18} y={98} fill={D.cyan} fontSize={9.5} fontWeight={700}>
        Site A · 10.10.10.0/24
      </text>
      <rect x={404} y={82} width={228} height={90} rx={14} fill={D.violet} fillOpacity={0.05} stroke={D.violet} strokeOpacity={0.4} strokeDasharray="6 5" />
      <text x={622} y={98} textAnchor="end" fill={D.violet} fontSize={9.5} fontWeight={700}>
        Site B · 10.20.20.0/24
      </text>
      {tunnel && (
        <g>
          <path d={`M ${VP.GA.x} ${VP.GA.y - 24} C ${VP.GA.x} 50, ${VP.GB.x} 50, ${VP.GB.x} ${VP.GB.y - 24}`} fill="none" stroke={tunnelColor} strokeWidth={2.2} strokeDasharray={tunnelDashed ? "6 5" : undefined} />
          <text x={320} y={52} textAnchor="middle" fill={tunnelColor} fontSize={10} fontWeight={700}>
            {tunnel}
          </text>
        </g>
      )}
      {(Object.keys(ENDS) as Seg[]).map((k) => {
        const [a, b] = ENDS[k];
        const x1 = VP[a].x + HALF[a] + 3;
        const x2 = VP[b].x - HALF[b] - 3;
        const y = VP[a].y;
        const m = segs[k] ?? "idle";
        const c = colors[k] ?? (m === "idle" ? D.line : m === "drop-right" ? D.danger : D.cyan);
        const mid = (x1 + x2) / 2;
        return (
          <g key={k}>
            {m === "idle" ? <DLink x1={x1} y1={y} x2={x2} y2={y} color={c} /> : m === "right" ? <DArrow x1={x1} y1={y} x2={x2} y2={y} color={c} /> : m === "left" ? <DArrow x1={x2} y1={y} x2={x1} y2={y} color={c} /> : <DArrow x1={x1} y1={y} x2={mid} y2={y} color={c} />}
            {m === "drop-right" && (
              <text x={mid + 10} y={y + 5} textAnchor="middle" fill={D.danger} fontSize={14} fontWeight={800}>
                ✕
              </text>
            )}
            {labels[k] && (
              <text x={mid} y={y + 32} textAnchor="middle" fill={c === D.line ? D.muted : c} fontSize={8.5} fontFamily="monospace" fontWeight={700}>
                {labels[k]}
              </text>
            )}
          </g>
        );
      })}
      <DNode x={VP.A.x} y={VP.A.y} label="HOST-A" sub={subs.A} accent={D.cyan} w={84} h={40} />
      <DNode x={VP.GA.x} y={VP.GA.y} label="GW-A" sub={subs.GA} accent={D.cyan} w={88} h={40} />
      <DNode x={VP.NET.x} y={VP.NET.y} label="INTERNET" sub={subs.NET} accent={D.warning} w={100} h={40} />
      <DNode x={VP.GB.x} y={VP.GB.y} label="GW-B" sub={subs.GB} accent={D.violet} w={88} h={40} />
      <DNode x={VP.B.x} y={VP.B.y} label="HOST-B" sub={subs.B} accent={D.violet} w={84} h={40} />
      {children}
    </g>
  );
}

/** Message-sequence lanes: vertical lifelines with horizontal messages and an optional note under each label. */
export function Lanes({ lanes, msgs, top = 26, rowH = 34 }: { lanes: { x: number; label: string; color?: string }[]; msgs: { from: number; to: number; label: string; sub?: string; color?: string; drop?: boolean; boxed?: boolean }[]; top?: number; rowH?: number }) {
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
        const x2 = m.drop ? x1 + (full - x1) * 0.62 : full;
        const dir = full > x1 ? 1 : -1;
        const c = m.drop ? D.danger : (m.color ?? D.cyan);
        const lx = (x1 + x2) / 2;
        return (
          <g key={i}>
            {m.boxed && <rect x={Math.min(x1, x2) + 8} y={y - 22} width={Math.abs(x2 - x1) - 16} height={m.sub ? 40 : 28} rx={6} fill={D.warning} fillOpacity={0.06} stroke={D.warning} strokeOpacity={0.5} strokeDasharray="4 3" />}
            <DArrow x1={x1 + dir * 4} y1={y} x2={x2 - dir * 4} y2={y} color={c} width={1.8} />
            <text x={lx} y={y - 7} textAnchor="middle" fill={c} fontSize={9.5} fontFamily="monospace" fontWeight={700}>
              {m.label}
            </text>
            {m.sub && (
              <text x={lx} y={y + 13} textAnchor="middle" fill={D.muted} fontSize={8.5} fontFamily="monospace">
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
