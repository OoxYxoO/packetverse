import { DIAGRAM as D } from "./GuideBlocks";

/**
 * Shared layout for the SR-MPLS guide diagrams (Foundations, SR Policy,
 * TI-LFA, Flex-Algo): R1 headend left, R2/R4 on top, R3/R5 on the bottom,
 * R6 destination right. Each lesson passes its OWN links and metrics — this
 * helper only draws them; it never decides a path.
 */
export const SR_POS: Record<string, [number, number]> = {
  R1: [60, 110],
  R2: [220, 45],
  R4: [420, 45],
  R3: [220, 175],
  R5: [420, 175],
  R6: [580, 110],
};

export interface SrLink {
  a: string;
  b: string;
  /** Short text beside the link (a metric, an affinity…). */
  label?: string;
  color?: string;
  dashed?: boolean;
  /** Thicker stroke for a highlighted path. */
  bold?: boolean;
}

/** Label position: midpoint pushed away from the diagram's centre so it never sits on the line itself. */
function labelPos(a: [number, number], b: [number, number]): { x: number; y: number; anchor: "start" | "middle" | "end" } {
  const mx = (a[0] + b[0]) / 2;
  const my = (a[1] + b[1]) / 2;
  if (a[0] === b[0]) return { x: mx + 8, y: my + 4, anchor: "start" };
  if (a[1] === b[1]) return { x: mx, y: my + (my < 110 ? -9 : 18), anchor: "middle" };
  // Diagonal: shift outward (away from y=110) and sideways away from the line.
  const up = my < 110;
  const left = mx < 320;
  return { x: mx + (left ? -12 : 12), y: my + (up ? -8 : 14), anchor: left ? "end" : "start" };
}

export function SrTopology({ links, sub, accent, dim }: { links: SrLink[]; sub?: Partial<Record<string, string>>; accent?: Partial<Record<string, string>>; dim?: string[] }) {
  return (
    <g>
      {links.map((l) => {
        const a = SR_POS[l.a];
        const b = SR_POS[l.b];
        const p = labelPos(a, b);
        const color = l.color ?? D.line;
        return (
          <g key={`${l.a}-${l.b}`}>
            <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke={color} strokeWidth={l.bold ? 3.5 : 2} strokeDasharray={l.dashed ? "6 5" : undefined} />
            {l.label && (
              <text x={p.x} y={p.y} textAnchor={p.anchor} fill={l.color ?? D.muted} fontSize={10} fontWeight={700} fontFamily="monospace">
                {l.label}
              </text>
            )}
          </g>
        );
      })}
      {Object.entries(SR_POS).map(([id, [x, y]]) => {
        const faded = dim?.includes(id);
        const s = sub?.[id];
        return (
          <g key={id} opacity={faded ? 0.4 : 1}>
            <rect x={x - 34} y={y - 17} width={68} height={34} rx={9} fill={D.box} stroke={accent?.[id] ?? D.cyan} strokeOpacity={0.8} />
            <text x={x} y={s ? y - 2 : y + 4} textAnchor="middle" fill={D.text} fontSize={12} fontWeight={700}>
              {id}
            </text>
            {s && (
              <text x={x} y={y + 11} textAnchor="middle" fill={D.muted} fontSize={8.5} fontFamily="monospace">
                {s}
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
}
