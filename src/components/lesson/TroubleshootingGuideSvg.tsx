import { DArrow, DIAGRAM as D } from "./GuideBlocks";

/**
 * Guide diagrams shared by the Troubleshooting-track lessons (Packet Analysis, Layer 1, Layer 2, Layer 3):
 * the workflow, the evidence ladder and a message-sequence ("lanes") diagram with drop markers and time labels.
 * Presentation only — every label is passed in by the lesson's guide.
 */

const WORKFLOW = ["Define", "Scope", "Gather Evidence", "Form Hypothesis", "Test", "Repair", "Verify"];

/** Define → Scope → Gather Evidence → Form Hypothesis → Test → Repair → Verify, with the anti-pattern crossed out. */
export function WorkflowDiagram({ y = 20, notes }: { y?: number; notes?: string[] }) {
  const w = 82;
  const gap = 6;
  const x0 = (640 - (WORKFLOW.length * w + (WORKFLOW.length - 1) * gap)) / 2;
  return (
    <g>
      {WORKFLOW.map((label, i) => {
        const x = x0 + i * (w + gap);
        const tone = i === 5 ? D.warning : i === 6 ? D.success : i >= 2 && i <= 4 ? D.violet : D.cyan;
        return (
          <g key={label}>
            <rect x={x} y={y} width={w} height={34} rx={8} fill={tone} fillOpacity={0.12} stroke={tone} strokeOpacity={0.6} />
            <text x={x + w / 2} y={y + 21} textAnchor="middle" fill={tone} fontSize={label.length > 12 ? 8.5 : 9.5} fontWeight={700}>
              {label}
            </text>
            {notes?.[i] && (
              <text x={x + w / 2} y={y + 50} textAnchor="middle" fill={D.muted} fontSize={8}>
                {notes[i]}
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
}

export type LadderStatus = "ok" | "fail" | "skip" | "suspect";
const LADDER_TONE: Record<LadderStatus, string> = { ok: D.success, fail: D.danger, skip: D.faint, suspect: D.warning };
const LADDER_MARK: Record<LadderStatus, string> = { ok: "✓", fail: "✕", skip: "·", suspect: "?" };

/** The evidence ladder, bottom rung first; each rung carries a status and the evidence behind it. */
export function LadderDiagram({ rows, x = 40, y = 12, w = 560, rowH = 24 }: { rows: { rung: string; evidence: string; status: LadderStatus }[]; x?: number; y?: number; w?: number; rowH?: number }) {
  return (
    <g>
      {[...rows].reverse().map((r, i) => {
        const yy = y + i * rowH;
        const c = LADDER_TONE[r.status];
        return (
          <g key={r.rung}>
            <rect x={x} y={yy} width={w} height={rowH - 4} rx={5} fill={c} fillOpacity={r.status === "skip" ? 0.03 : 0.08} stroke={c} strokeOpacity={0.45} />
            <text x={x + 12} y={yy + 14} fill={c} fontSize={10.5} fontWeight={800}>
              {LADDER_MARK[r.status]}
            </text>
            <text x={x + 28} y={yy + 14} fill={r.status === "skip" ? D.faint : D.text} fontSize={9.5} fontWeight={700}>
              {r.rung}
            </text>
            <text x={x + 200} y={yy + 14} fill={r.status === "skip" ? D.faint : D.muted} fontSize={9} fontFamily="monospace">
              {r.evidence}
            </text>
          </g>
        );
      })}
    </g>
  );
}

/** Message-sequence lanes with optional time labels (left) and drop markers (a message that stops short with ✕). */
export function SeqLanes({ lanes, msgs, top = 26, rowH = 32, timeX }: { lanes: { x: number; label: string; color?: string }[]; msgs: { from: number; to: number; label: string; sub?: string; color?: string; drop?: boolean; time?: string }[]; top?: number; rowH?: number; timeX?: number }) {
  const bottom = top + 14 + msgs.length * rowH;
  return (
    <g>
      {lanes.map((l) => (
        <g key={l.label}>
          <text x={l.x} y={top - 8} textAnchor="middle" fill={l.color ?? D.text} fontSize={10.5} fontWeight={700}>
            {l.label}
          </text>
          <line x1={l.x} y1={top} x2={l.x} y2={bottom} stroke={D.line} strokeDasharray="3 4" />
        </g>
      ))}
      {msgs.map((m, i) => {
        const y = top + 24 + i * rowH;
        const x1 = lanes[m.from].x;
        const full = lanes[m.to].x;
        const x2 = m.drop ? x1 + (full - x1) * 0.55 : full;
        const dir = full > x1 ? 1 : -1;
        const c = m.drop ? D.danger : (m.color ?? D.cyan);
        return (
          <g key={i}>
            {m.time && timeX !== undefined && (
              <text x={timeX} y={y + 3} textAnchor="end" fill={D.faint} fontSize={8.5} fontFamily="monospace">
                {m.time}
              </text>
            )}
            <DArrow x1={x1 + dir * 4} y1={y} x2={x2 - dir * 4} y2={y} color={c} width={1.8} />
            <text x={(x1 + x2) / 2} y={y - 6} textAnchor="middle" fill={c} fontSize={9} fontFamily="monospace" fontWeight={700}>
              {m.label}
            </text>
            {m.sub && (
              <text x={(x1 + x2) / 2} y={y + 12} textAnchor="middle" fill={D.muted} fontSize={8} fontFamily="monospace">
                {m.sub}
              </text>
            )}
            {m.drop && (
              <text x={x2 + dir * 12} y={y + 5} textAnchor="middle" fill={D.danger} fontSize={13} fontWeight={800}>
                ✕
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
}
