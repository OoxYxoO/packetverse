import type { ReactNode } from "react";
import { DArrow, DIAGRAM as D, DLink, DNode } from "@/components/lesson/GuideBlocks";

/**
 * Lesson-local SVG helper for the STP/RSTP guides: SW1 on top, SW2 / SW3 below, one host beside each bridge.
 * Each inter-switch link is drawn by its mode, and each end can carry a short role/state pill ("RP FWD", "ALT DISC").
 */
export type TriLink = "L12" | "L13" | "L23";
export type LinkMode = "idle" | "fwd" | "alt" | "down" | "claim" | "loop" | "ab" | "ba";

export const TP = { SW1: { x: 320, y: 52 }, SW2: { x: 176, y: 180 }, SW3: { x: 464, y: 180 }, A: { x: 170, y: 52 }, B: { x: 56, y: 180 }, C: { x: 584, y: 180 } };
const ENDS: Record<TriLink, [keyof typeof TP, keyof typeof TP]> = { L12: ["SW1", "SW2"], L13: ["SW1", "SW3"], L23: ["SW2", "SW3"] };

function seg(l: TriLink) {
  const [a, b] = ENDS[l];
  const p = TP[a];
  const q = TP[b];
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  const len = Math.hypot(dx, dy);
  const ux = dx / len;
  const uy = dy / len;
  const trimA = l === "L23" ? 64 : 36;
  const trimB = l === "L23" ? 64 : 36;
  return { x1: p.x + ux * trimA, y1: p.y + uy * trimA, x2: q.x - ux * trimB, y2: q.y - uy * trimB, ux, uy, len };
}

function Link({ l, mode, ends }: { l: TriLink; mode: LinkMode; ends?: [string, string] }) {
  const s = seg(l);
  const color = mode === "alt" ? D.warning : mode === "down" ? D.faint : mode === "loop" ? D.danger : mode === "claim" ? D.violet : mode === "ab" || mode === "ba" ? D.cyan : mode === "fwd" ? D.success : D.line;
  const pill = (t: string, f: number) => {
    const x = s.x1 + (s.x2 - s.x1) * f;
    const y = s.y1 + (s.y2 - s.y1) * f;
    const w = Math.max(52, t.length * 6.2 + 12);
    const c = /ALT|DISC/.test(t) ? D.warning : /DOWN|OFF/.test(t) ? D.danger : /RP|DP|FWD/.test(t) ? D.success : D.muted;
    return (
      <g key={`${t}-${f}`}>
        <rect x={x - w / 2} y={y - 8} width={w} height={16} rx={8} fill="#0b1020" stroke={c} strokeOpacity={0.7} />
        <text x={x} y={y + 3.5} textAnchor="middle" fill={c} fontSize={8.5} fontFamily="monospace" fontWeight={700}>
          {t}
        </text>
      </g>
    );
  };
  return (
    <g>
      {mode === "ab" ? <DArrow x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} color={color} /> : mode === "ba" ? <DArrow x1={s.x2} y1={s.y2} x2={s.x1} y2={s.y1} color={color} /> : mode === "claim" || mode === "loop" ? <DArrow x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} color={color} both width={1.8} /> : <DLink x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} color={color} dashed={mode === "alt" || mode === "down" || mode === "idle"} />}
      {mode === "down" && (
        <text x={(s.x1 + s.x2) / 2} y={(s.y1 + s.y2) / 2 + 4} textAnchor="middle" fill={D.danger} fontSize={13} fontWeight={700}>
          ✕
        </text>
      )}
      {ends && pill(ends[0], 0.22)}
      {ends && pill(ends[1], 0.78)}
    </g>
  );
}

/** The triangle with its hosts. `hostLinks` colours host links for data-path diagrams. */
export function Triangle({ modes, ends = {}, subs = {}, hostLinks = {}, children }: { modes: Partial<Record<TriLink, LinkMode>>; ends?: Partial<Record<TriLink, [string, string]>>; subs?: Partial<Record<"SW1" | "SW2" | "SW3", string>>; hostLinks?: Partial<Record<"A" | "B" | "C", "in" | "out">>; children?: ReactNode }) {
  const host = (h: "A" | "B" | "C", sw: "SW1" | "SW2" | "SW3") => {
    const p = TP[h];
    const q = TP[sw];
    const dir = q.x > p.x ? 1 : -1;
    const x1 = p.x + dir * 44;
    const x2 = q.x - dir * 44;
    const m = hostLinks[h];
    return m === "in" ? <DArrow key={h} x1={x1} y1={p.y} x2={x2} y2={q.y} color={D.cyan} /> : m === "out" ? <DArrow key={h} x1={x2} y1={q.y} x2={x1} y2={p.y} color={D.cyan} /> : <DLink key={h} x1={x1} y1={p.y} x2={x2} y2={q.y} color={D.line} />;
  };
  return (
    <g>
      {host("A", "SW1")}
      {host("B", "SW2")}
      {host("C", "SW3")}
      {(["L12", "L13", "L23"] as TriLink[]).map((l) => (
        <Link key={l} l={l} mode={modes[l] ?? "idle"} ends={ends[l]} />
      ))}
      <DNode x={TP.A.x} y={TP.A.y} label="HOST-A" accent={D.cyan} w={84} h={36} />
      <DNode x={TP.B.x} y={TP.B.y} label="HOST-B" accent={D.cyan} w={84} h={36} />
      <DNode x={TP.C.x} y={TP.C.y} label="HOST-C" accent={D.cyan} w={84} h={36} />
      <DNode x={TP.SW1.x} y={TP.SW1.y} label="SW1" sub={subs.SW1} accent={D.violet} w={124} />
      <DNode x={TP.SW2.x} y={TP.SW2.y} label="SW2" sub={subs.SW2} accent={D.violet} w={124} />
      <DNode x={TP.SW3.x} y={TP.SW3.y} label="SW3" sub={subs.SW3} accent={D.violet} w={124} />
      {children}
    </g>
  );
}
