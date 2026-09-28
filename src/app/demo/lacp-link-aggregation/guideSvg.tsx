import type { ReactNode } from "react";
import { DArrow, DIAGRAM as D, DLink, DNode } from "@/components/lesson/GuideBlocks";

/**
 * Lesson-local SVG helper for the LACP guides: HOST-A — SW1 ══ SW2 — HOST-B / HOST-C, two parallel members.
 * Presentation only — member names and keys are passed in by the guide from scenario exports.
 */
export type MemberMode = "idle" | "dist" | "down" | "neg" | "out" | "right" | "left" | "both" | "flow";
export const LP = { A: { x: 60, y: 110 }, SW1: { x: 200, y: 110 }, SW2: { x: 440, y: 110 }, B: { x: 580, y: 54 }, C: { x: 580, y: 166 } };
const MY = { m23: 96, m24: 124 };
const X1 = LP.SW1.x + 44;
const X2 = LP.SW2.x - 44;

function Member({ which, mode, label }: { which: "m23" | "m24"; mode: MemberMode; label?: string }) {
  const y = MY[which];
  const color = mode === "down" ? D.faint : mode === "out" ? D.danger : mode === "neg" ? D.warning : mode === "dist" ? D.success : mode === "flow" ? D.cyan : mode === "idle" ? D.line : D.violet;
  return (
    <g>
      {mode === "right" || mode === "flow" ? <DArrow x1={X1} y1={y} x2={X2} y2={y} color={color} width={1.8} /> : mode === "left" ? <DArrow x1={X2} y1={y} x2={X1} y2={y} color={color} width={1.8} /> : mode === "both" ? <DArrow x1={X1} y1={y} x2={X2} y2={y} color={color} both width={1.8} /> : <DLink x1={X1} y1={y} x2={X2} y2={y} color={color} dashed={mode === "down" || mode === "out" || mode === "neg" || mode === "idle"} />}
      {mode === "down" && (
        <text x={X1 + 18} y={y + 4} textAnchor="middle" fill={D.danger} fontSize={12} fontWeight={700}>
          ✕
        </text>
      )}
      {label && (
        <text x={(X1 + X2) / 2} y={which === "m23" ? y - 6 : y + 15} textAnchor="middle" fill={mode === "idle" ? D.muted : mode === "down" ? D.danger : color} fontSize={9} fontFamily="monospace" fontWeight={700}>
          {label}
        </text>
      )}
    </g>
  );
}

/** Both switches, the two members and the three hosts. `lag` draws the logical-bundle outline. */
export function LagPair({ m23, m24, labels = {}, lag, subs = {}, hosts = {}, children }: { m23: MemberMode; m24: MemberMode; labels?: { m23?: string; m24?: string }; lag?: string; subs?: Partial<Record<"SW1" | "SW2", string>>; hosts?: Partial<Record<"A" | "B" | "C", "in" | "out">>; children?: ReactNode }) {
  const host = (h: "A" | "B" | "C") => {
    const p = LP[h];
    const q = h === "A" ? LP.SW1 : LP.SW2;
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    const l = Math.hypot(dx, dy);
    const a = { x: p.x + (dx / l) * 44, y: p.y + (dy / l) * 20 };
    const b = { x: q.x - (dx / l) * 46, y: q.y - (dy / l) * 22 };
    const m = hosts[h];
    return m === "in" ? <DArrow key={h} x1={a.x} y1={a.y} x2={b.x} y2={b.y} color={D.cyan} /> : m === "out" ? <DArrow key={h} x1={b.x} y1={b.y} x2={a.x} y2={a.y} color={D.cyan} /> : <DLink key={h} x1={a.x} y1={a.y} x2={b.x} y2={b.y} color={D.line} />;
  };
  return (
    <g>
      {lag && (
        <g>
          <rect x={X1 - 6} y={MY.m23 - 22} width={X2 - X1 + 12} height={MY.m24 - MY.m23 + 44} rx={12} fill={D.cyan} fillOpacity={0.05} stroke={D.cyan} strokeOpacity={0.5} strokeDasharray="5 4" />
          <text x={(X1 + X2) / 2} y={MY.m23 - 27} textAnchor="middle" fill={D.cyan} fontSize={9.5} fontWeight={700}>
            {lag}
          </text>
        </g>
      )}
      {host("A")}
      {host("B")}
      {host("C")}
      <Member which="m23" mode={m23} label={labels.m23} />
      <Member which="m24" mode={m24} label={labels.m24} />
      <DNode x={LP.A.x} y={LP.A.y} label="HOST-A" accent={D.cyan} w={84} h={36} />
      <DNode x={LP.B.x} y={LP.B.y} label="HOST-B" accent={D.cyan} w={84} h={36} />
      <DNode x={LP.C.x} y={LP.C.y} label="HOST-C" accent={D.cyan} w={84} h={36} />
      <DNode x={LP.SW1.x} y={LP.SW1.y} label="SW1" sub={subs.SW1} accent={D.violet} w={88} h={56} />
      <DNode x={LP.SW2.x} y={LP.SW2.y} label="SW2" sub={subs.SW2} accent={D.violet} w={88} h={56} />
      {children}
    </g>
  );
}
