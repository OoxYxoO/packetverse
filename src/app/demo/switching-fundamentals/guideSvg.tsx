import type { ReactNode } from "react";
import { DArrow, DIAGRAM as D, DLink, DNode } from "@/components/lesson/GuideBlocks";
import { PRIMARY_PORT, SECONDARY_PORT } from "@/lib/sim-engine/scenarios/switchingFundamentals";

/**
 * Lesson-local SVG helper for the Switching guides: HOST-A/HOST-D on SW1, HOST-B/HOST-C on SW2, two parallel
 * SW1↔SW2 links. Presentation only — every port name comes from the scenario exports.
 */
export type HostKey = "A" | "D" | "B" | "C";
export type HostMode = "idle" | "in" | "out";
export type TrunkMode = "idle" | "down" | "right" | "left" | "both";

export const POS = { A: { x: 80, y: 46 }, D: { x: 80, y: 194 }, SW1: { x: 240, y: 120 }, SW2: { x: 400, y: 120 }, B: { x: 560, y: 46 }, C: { x: 560, y: 194 } };
const SW_OF: Record<HostKey, "SW1" | "SW2"> = { A: "SW1", D: "SW1", B: "SW2", C: "SW2" };
const PORT_OF: Record<HostKey, string> = { A: "ge-0/0/1", D: "ge-0/0/2", B: "ge-0/0/1", C: "ge-0/0/2" };
const TRUNK_Y = { primary: 110, secondary: 131 };
const X1 = POS.SW1.x + 42;
const X2 = POS.SW2.x - 42;

function trim(p: { x: number; y: number }, q: { x: number; y: number }, a: number, b: number) {
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  const l = Math.hypot(dx, dy) || 1;
  return { x1: p.x + (dx / l) * a, y1: p.y + (dy / l) * a, x2: q.x - (dx / l) * b, y2: q.y - (dy / l) * b };
}

function HostLink({ h, mode }: { h: HostKey; mode: HostMode }) {
  const s = trim(POS[h], POS[SW_OF[h]], 56, 50);
  const color = mode === "in" ? D.warning : mode === "out" ? D.cyan : D.line;
  const mid = { x: (s.x1 + s.x2) / 2, y: (s.y1 + s.y2) / 2 };
  return (
    <g>
      {mode === "in" ? <DArrow x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} color={color} /> : mode === "out" ? <DArrow x1={s.x2} y1={s.y2} x2={s.x1} y2={s.y1} color={color} /> : <DLink x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} color={color} />}
      <rect x={mid.x - 28} y={mid.y - 8} width={56} height={16} rx={8} fill="#0b1020" stroke={color} strokeOpacity={0.6} />
      <text x={mid.x} y={mid.y + 3.5} textAnchor="middle" fill={mode === "idle" ? D.muted : color} fontSize={9} fontFamily="monospace" fontWeight={700}>
        {PORT_OF[h]}
      </text>
    </g>
  );
}

function Trunk({ which, mode }: { which: "primary" | "secondary"; mode: TrunkMode }) {
  const y = TRUNK_Y[which];
  const color = mode === "down" ? D.faint : mode === "idle" ? D.line : D.violet;
  return (
    <g>
      {mode === "right" ? <DArrow x1={X1} y1={y} x2={X2} y2={y} color={color} width={1.8} /> : mode === "left" ? <DArrow x1={X2} y1={y} x2={X1} y2={y} color={color} width={1.8} /> : mode === "both" ? <DArrow x1={X1} y1={y} x2={X2} y2={y} color={color} both width={1.8} /> : <DLink x1={X1} y1={y} x2={X2} y2={y} color={color} dashed={mode === "down"} />}
      {mode === "down" && (
        <text x={(X1 + X2) / 2} y={y + 4} textAnchor="middle" fill={D.danger} fontSize={12} fontWeight={700}>
          ✕
        </text>
      )}
    </g>
  );
}

/** Both switches, four hosts, two parallel inter-switch links; each link coloured for one frame. */
export function TwoSwitches({ hosts = {}, primary = "idle", secondary = "down", subs = {}, hostSubs = {}, children }: { hosts?: Partial<Record<HostKey, HostMode>>; primary?: TrunkMode; secondary?: TrunkMode; subs?: Partial<Record<"SW1" | "SW2", string>>; hostSubs?: Partial<Record<HostKey, string>>; children?: ReactNode }) {
  return (
    <g>
      {(["A", "D", "B", "C"] as HostKey[]).map((h) => (
        <HostLink key={h} h={h} mode={hosts[h] ?? "idle"} />
      ))}
      <Trunk which="primary" mode={primary} />
      <Trunk which="secondary" mode={secondary} />
      <text x={(X1 + X2) / 2} y={TRUNK_Y.primary - 6} textAnchor="middle" fill={D.muted} fontSize={8.5} fontFamily="monospace">
        {PRIMARY_PORT.slice(-2)}
      </text>
      <text x={(X1 + X2) / 2} y={TRUNK_Y.secondary + 14} textAnchor="middle" fill={D.muted} fontSize={8.5} fontFamily="monospace">
        {SECONDARY_PORT.slice(-2)}
      </text>
      {(["A", "D", "B", "C"] as HostKey[]).map((h) => (
        <DNode key={h} x={POS[h].x} y={POS[h].y} label={`HOST-${h}`} sub={hostSubs[h] ?? `…:55:0${h}`} accent={D.cyan} />
      ))}
      <DNode x={POS.SW1.x} y={POS.SW1.y} label="SW1" sub={subs.SW1} accent={D.violet} w={84} />
      <DNode x={POS.SW2.x} y={POS.SW2.y} label="SW2" sub={subs.SW2} accent={D.violet} w={84} />
      {children}
    </g>
  );
}

/** A short annotation centred above (dy < 0) or below (dy > 0) a switch. */
export function SwNote({ sw, dy, text, color = D.text }: { sw: "SW1" | "SW2"; dy: number; text: string; color?: string }) {
  return (
    <text x={POS[sw].x} y={POS[sw].y + dy} textAnchor="middle" fill={color} fontSize={10} fontWeight={700}>
      {text}
    </text>
  );
}

/** A short annotation under a host box. */
export function HostNote({ h, text, color }: { h: HostKey; text: string; color: string }) {
  const below = POS[h].y > 120;
  return (
    <text x={POS[h].x} y={POS[h].y + (below ? 38 : -30)} textAnchor="middle" fill={color} fontSize={10} fontWeight={700}>
      {text}
    </text>
  );
}
