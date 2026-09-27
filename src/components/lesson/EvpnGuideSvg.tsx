import { DIAGRAM as D } from "./GuideBlocks";

/**
 * Shared SVG building blocks for the EVPN lesson guides (Batch 7). Values
 * are always passed in by the caller from its own scenario exports — these
 * components only draw.
 */

export interface FabricLeaf {
  id: string;
  /** Short second line, e.g. a VTEP loopback. */
  sub?: string;
  /** Optional host drawn under the leaf. */
  host?: string;
  hostSub?: string;
  accent?: string;
}

/** A spine-leaf fabric: one spine on top, leaves in a row, optional hosts beneath. Fits a 640-wide DiagramSvg. */
export function EvpnFabric({ leaves, spineLabel = "SPINE1", spineSub = "underlay only", top = 22, highlight }: { leaves: FabricLeaf[]; spineLabel?: string; spineSub?: string; top?: number; highlight?: { from: string; to: string; color: string; label?: string } }) {
  const n = leaves.length;
  const gap = 560 / n;
  const xs = leaves.map((_, i) => 40 + gap / 2 + i * gap);
  const spineX = 320;
  const spineY = top + 20;
  const leafY = top + 108;
  const hostY = top + 186;
  const posOf = (id: string): [number, number] | undefined => {
    if (id === spineLabel) return [spineX, spineY];
    const i = leaves.findIndex((l) => l.id === id);
    if (i >= 0) return [xs[i], leafY];
    const h = leaves.findIndex((l) => l.host === id);
    return h >= 0 ? [xs[h], hostY] : undefined;
  };
  const a = highlight ? posOf(highlight.from) : undefined;
  const b = highlight ? posOf(highlight.to) : undefined;
  return (
    <g>
      {leaves.map((l, i) => (
        <g key={`links-${l.id}`}>
          <line x1={spineX} y1={spineY + 18} x2={xs[i]} y2={leafY - 18} stroke={D.line} strokeWidth={2} />
          {l.host && <line x1={xs[i]} y1={leafY + 18} x2={xs[i]} y2={hostY - 16} stroke={D.line} strokeWidth={2} />}
        </g>
      ))}
      {a && b && (
        <g>
          <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke={highlight!.color} strokeWidth={3} strokeDasharray="7 5" />
          {highlight!.label && (
            <text x={(a[0] + b[0]) / 2} y={Math.min(a[1], b[1]) + (Math.abs(a[1] - b[1]) < 4 ? -10 : 0)} textAnchor="middle" fill={highlight!.color} fontSize={10} fontWeight={700}>
              {highlight!.label}
            </text>
          )}
        </g>
      )}
      <rect x={spineX - 70} y={spineY - 18} width={140} height={36} rx={9} fill={D.box} stroke={D.cyan} strokeOpacity={0.8} />
      <text x={spineX} y={spineY - 2} textAnchor="middle" fill={D.text} fontSize={12} fontWeight={700}>
        {spineLabel}
      </text>
      <text x={spineX} y={spineY + 11} textAnchor="middle" fill={D.muted} fontSize={8.5} fontFamily="monospace">
        {spineSub}
      </text>
      {leaves.map((l, i) => (
        <g key={l.id}>
          <rect x={xs[i] - 64} y={leafY - 18} width={128} height={36} rx={9} fill={D.box} stroke={l.accent ?? D.violet} strokeOpacity={0.85} />
          <text x={xs[i]} y={leafY - 2} textAnchor="middle" fill={D.text} fontSize={12} fontWeight={700}>
            {l.id}
          </text>
          {l.sub && (
            <text x={xs[i]} y={leafY + 11} textAnchor="middle" fill={D.muted} fontSize={8.5} fontFamily="monospace">
              {l.sub}
            </text>
          )}
          {l.host && (
            <g>
              <rect x={xs[i] - 60} y={hostY - 16} width={120} height={34} rx={8} fill={D.box} stroke={D.faint} strokeOpacity={0.9} />
              <text x={xs[i]} y={hostY - 1} textAnchor="middle" fill={D.text} fontSize={11} fontWeight={700}>
                {l.host}
              </text>
              {l.hostSub && (
                <text x={xs[i]} y={hostY + 11} textAnchor="middle" fill={D.muted} fontSize={8.5} fontFamily="monospace">
                  {l.hostSub}
                </text>
              )}
            </g>
          )}
        </g>
      ))}
    </g>
  );
}

export interface RouteRow {
  label: string;
  value: string;
  /** Highlight a decisive row. */
  strong?: boolean;
}

/** A control-plane route drawn as a card of label/value rows. `w` defaults to 280. */
export function DRouteCard({ x, y, w = 280, title, rows, color = D.bgp, rowH = 18 }: { x: number; y: number; w?: number; title: string; rows: RouteRow[]; color?: string; rowH?: number }) {
  const h = 30 + rows.length * rowH + 8;
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={10} fill={D.box} stroke={color} strokeOpacity={0.85} />
      <text x={x + 12} y={y + 19} fill={color} fontSize={11} fontWeight={700}>
        {title}
      </text>
      {rows.map((r, i) => (
        <g key={`${r.label}-${i}`}>
          <text x={x + 12} y={y + 38 + i * rowH} fill={D.muted} fontSize={9.5}>
            {r.label}
          </text>
          <text x={x + w - 12} y={y + 38 + i * rowH} textAnchor="end" fill={r.strong ? color : D.text} fontSize={9.5} fontWeight={r.strong ? 700 : 400} fontFamily="monospace">
            {r.value}
          </text>
        </g>
      ))}
    </g>
  );
}
