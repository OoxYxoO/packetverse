import { DIAGRAM as D } from "./GuideBlocks";

/**
 * Shared topology drawing for the SRv6 guide diagrams (Foundations, Endpoint
 * Behaviors, SRv6 Policy, SRv6 L3VPN). Each lesson passes its OWN node
 * positions, links and metrics — this helper only draws them; it never
 * decides a path.
 */
export type Srv6Pos = Record<string, [number, number]>;

/** Foundations / Endpoint Behaviors hexagon: top R1-R2-R3-R6, bottom R1-R4-R5-R6 (same sides as the lesson canvas). */
export const SRV6_HEX_POS: Srv6Pos = {
  R1: [60, 110],
  R2: [220, 45],
  R3: [420, 45],
  R4: [220, 175],
  R5: [420, 175],
  R6: [580, 110],
};

/** SRv6 Policy: TOP R1-R2-R4-R6, BOTTOM R1-R3-R5-R6 (same sides as the lesson canvas). */
export const SRV6_POLICY_POS: Srv6Pos = {
  R1: [60, 110],
  R2: [220, 45],
  R4: [420, 45],
  R3: [220, 175],
  R5: [420, 175],
  R6: [580, 110],
};

export interface Srv6Link {
  a: string;
  b: string;
  /** Short text beside the link (a metric, a delay…). */
  label?: string;
  color?: string;
  dashed?: boolean;
  /** Thicker stroke for a highlighted path. */
  bold?: boolean;
}

/** Label position: midpoint pushed away from the diagram's centre so it never sits on the line itself. */
function labelPos(a: [number, number], b: [number, number], cx: number, cy: number): { x: number; y: number; anchor: "start" | "middle" | "end" } {
  const mx = (a[0] + b[0]) / 2;
  const my = (a[1] + b[1]) / 2;
  if (a[0] === b[0]) return { x: mx + 8, y: my + 4, anchor: "start" };
  if (a[1] === b[1]) return { x: mx, y: my + (my <= cy ? -9 : 18), anchor: "middle" };
  const up = my < cy;
  const left = mx < cx;
  return { x: mx + (left ? -12 : 12), y: my + (up ? -8 : 14), anchor: left ? "end" : "start" };
}

export function Srv6Topology({ pos, links, sub, accent, dim, boxW = 68 }: { pos: Srv6Pos; links: Srv6Link[]; sub?: Partial<Record<string, string>>; accent?: Partial<Record<string, string>>; dim?: string[]; boxW?: number }) {
  const xs = Object.values(pos).map((p) => p[0]);
  const ys = Object.values(pos).map((p) => p[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  return (
    <g>
      {links.map((l) => {
        const a = pos[l.a];
        const b = pos[l.b];
        const p = labelPos(a, b, cx, cy);
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
      {Object.entries(pos).map(([id, [x, y]]) => {
        const faded = dim?.includes(id);
        const s = sub?.[id];
        return (
          <g key={id} opacity={faded ? 0.4 : 1}>
            <rect x={x - boxW / 2} y={y - 17} width={boxW} height={34} rx={9} fill={D.box} stroke={accent?.[id] ?? D.cyan} strokeOpacity={0.8} />
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

export interface HeaderRow {
  text: string;
  color: string;
  /** Small role tag drawn left of the row, e.g. "DA" / "SRH". */
  tag?: string;
  /** Highlight (e.g. the row that is currently the active segment). */
  strong?: boolean;
}

/** A packet as a column of header rows (outermost on top), centered on `x`. */
export function DHeaderColumn({ x, y, rows, w = 150, rowH = 20, caption }: { x: number; y: number; rows: HeaderRow[]; w?: number; rowH?: number; caption?: string }) {
  const left = x - w / 2;
  return (
    <g>
      {rows.map((r, i) => {
        const top = y + i * (rowH + 3);
        return (
          <g key={`${r.text}-${i}`}>
            <rect x={left} y={top} width={w} height={rowH} rx={5} fill={r.color} fillOpacity={r.strong ? 0.3 : 0.13} stroke={r.color} strokeOpacity={r.strong ? 1 : 0.7} strokeWidth={r.strong ? 1.6 : 1} />
            <text x={x} y={top + rowH / 2 + 4} textAnchor="middle" fill={r.color} fontSize={10} fontWeight={700} fontFamily="monospace">
              {r.text}
            </text>
            {r.tag && (
              <text x={left - 5} y={top + rowH / 2 + 3.5} textAnchor="end" fill={D.muted} fontSize={8.5} fontWeight={700}>
                {r.tag}
              </text>
            )}
          </g>
        );
      })}
      {caption && (
        <text x={x} y={y + rows.length * (rowH + 3) + 12} textAnchor="middle" fill={D.muted} fontSize={9.5}>
          {caption}
        </text>
      )}
    </g>
  );
}
