import { DIAGRAM as D } from "./GuideBlocks";

export interface StackEntry {
  /** e.g. "102 S1" */
  text: string;
  color?: string;
  /** Small role tag drawn left of the shim, e.g. "OUTER" / "INNER". */
  tag?: string;
}

/**
 * A packet drawn as a column for guide diagrams: MPLS shims (outermost on top),
 * then the payload. Centered on `x`, starting at `y`.
 */
export function DStack({ x, y, labels, payload = "IP", w = 104, rowH = 20, caption }: { x: number; y: number; labels: StackEntry[]; payload?: string; w?: number; rowH?: number; caption?: string }) {
  const left = x - w / 2;
  return (
    <g>
      {labels.map((l, i) => {
        const c = l.color ?? D.mpls;
        const top = y + i * (rowH + 3);
        return (
          <g key={`${l.text}-${i}`}>
            <rect x={left} y={top} width={w} height={rowH} rx={5} fill={c} fillOpacity={0.16} stroke={c} strokeOpacity={0.85} />
            <text x={x} y={top + rowH / 2 + 4} textAnchor="middle" fill={c} fontSize={10.5} fontWeight={700} fontFamily="monospace">
              {l.text}
            </text>
            {l.tag && (
              <text x={left - 5} y={top + rowH / 2 + 3.5} textAnchor="end" fill={D.muted} fontSize={8.5} fontWeight={700}>
                {l.tag}
              </text>
            )}
          </g>
        );
      })}
      <rect x={left} y={y + labels.length * (rowH + 3)} width={w} height={rowH} rx={5} fill={D.ip} fillOpacity={0.14} stroke={D.ip} strokeOpacity={0.8} />
      <text x={x} y={y + labels.length * (rowH + 3) + rowH / 2 + 4} textAnchor="middle" fill={D.ip} fontSize={10.5} fontWeight={700}>
        {payload}
      </text>
      {caption && (
        <text x={x} y={y + (labels.length + 1) * (rowH + 3) + 12} textAnchor="middle" fill={D.muted} fontSize={9.5}>
          {caption}
        </text>
      )}
    </g>
  );
}
