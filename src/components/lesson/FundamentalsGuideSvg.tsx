import type { ReactElement } from "react";
import { DArrow, DIAGRAM as D, DLink, DNode } from "./GuideBlocks";

/**
 * SVG building blocks for the Fundamentals lesson guides (Ethernet & Switching, IPv4, VLANs). Presentation only —
 * every value drawn is passed in by the lesson guide, which reads it from its own scenario exports.
 */

/** A header drawn as contiguous boxes, left to right (e.g. Dst MAC | Src MAC | TPID | TCI | EtherType | Payload | FCS). */
export function DFieldRow({ x, y, h = 46, fields }: { x: number; y: number; h?: number; fields: { label: string; sub?: string; w: number; color?: string; strong?: boolean }[] }) {
  const starts = fields.map((_, i) => x + fields.slice(0, i).reduce((a, f) => a + f.w, 0));
  return (
    <g>
      {fields.map((f, i) => {
        const x0 = starts[i];
        const color = f.color ?? D.eth;
        return (
          <g key={`${f.label}-${i}`}>
            <rect x={x0} y={y} width={f.w} height={h} fill={color} fillOpacity={f.strong ? 0.22 : 0.1} stroke={color} strokeOpacity={0.8} />
            <text x={x0 + f.w / 2} y={f.sub ? y + h / 2 - 3 : y + h / 2 + 4} textAnchor="middle" fill={D.text} fontSize={10.5} fontWeight={700}>
              {f.label}
            </text>
            {f.sub && (
              <text x={x0 + f.w / 2} y={y + h / 2 + 12} textAnchor="middle" fill={D.muted} fontSize={9} fontFamily="monospace">
                {f.sub}
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
}

/** A small table (e.g. an FDB or a subnet table) with an optional highlighted row. */
export function DTable({ x, y, title, cols, rows, highlight, color = D.cyan, rowH = 22 }: { x: number; y: number; title: string; cols: { label: string; w: number }[]; rows: string[][]; highlight?: { row: number; color: string }; color?: string; rowH?: number }) {
  const w = cols.reduce((a, c) => a + c.w, 0);
  const h = 44 + Math.max(1, rows.length) * rowH;
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={8} fill={D.box} stroke={color} strokeOpacity={0.6} />
      <text x={x + 10} y={y + 16} fill={color} fontSize={10} fontWeight={700}>
        {title}
      </text>
      {cols.reduce<{ x: number; els: ReactElement[] }>(
        (acc, c) => {
          acc.els.push(
            <text key={c.label} x={acc.x + 10} y={y + 34} fill={D.faint} fontSize={9} fontWeight={700}>
              {c.label}
            </text>,
          );
          return { x: acc.x + c.w, els: acc.els };
        },
        { x, els: [] },
      ).els}
      {rows.length === 0 && (
        <text x={x + 10} y={y + 56} fill={D.faint} fontSize={10} fontFamily="monospace">
          (empty)
        </text>
      )}
      {rows.map((r, i) => {
        const ry = y + 40 + i * rowH;
        const hl = highlight?.row === i;
        const colX = cols.map((_, j) => x + cols.slice(0, j).reduce((a, c) => a + c.w, 0));
        return (
          <g key={i}>
            {hl && <rect x={x + 3} y={ry} width={w - 6} height={rowH - 2} rx={4} fill={highlight.color} fillOpacity={0.16} stroke={highlight.color} strokeOpacity={0.6} />}
            {r.map((cell, j) => {
              const tx = (colX[j] ?? x) + 10;
              return (
                <text key={j} x={tx} y={ry + 15} fill={hl ? highlight.color : j === 0 ? D.text : D.muted} fontSize={10} fontFamily="monospace">
                  {cell}
                </text>
              );
            })}
          </g>
        );
      })}
    </g>
  );
}

export type SpokeMode = "in" | "out" | "idle" | "down" | "blocked";

/** One switch with devices around it; each link shows its port and whether the frame enters, leaves, or not. */
export function DSwitchStar({ sw, spokes }: { sw: { x: number; y: number; label: string; sub?: string; w?: number }; spokes: { id: string; x: number; y: number; label: string; sub?: string; port: string; mode: SpokeMode; w?: number }[] }) {
  return (
    <g>
      {spokes.map((s) => {
        const color = s.mode === "in" ? D.warning : s.mode === "out" ? D.cyan : s.mode === "blocked" ? D.danger : D.line;
        const dx = s.x - sw.x;
        const dy = s.y - sw.y;
        const len = Math.hypot(dx, dy) || 1;
        const ux = dx / len;
        const uy = dy / len;
        const a = { x: sw.x + ux * 42, y: sw.y + uy * 26 };
        const b = { x: s.x - ux * 52, y: s.y - uy * 26 };
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        return (
          <g key={s.id}>
            {s.mode === "in" ? <DArrow x1={b.x} y1={b.y} x2={a.x} y2={a.y} color={color} /> : s.mode === "out" ? <DArrow x1={a.x} y1={a.y} x2={b.x} y2={b.y} color={color} /> : <DLink x1={a.x} y1={a.y} x2={b.x} y2={b.y} color={color} dashed={s.mode === "down" || s.mode === "blocked"} />}
            <rect x={mid.x - 32} y={mid.y - 9} width={64} height={18} rx={9} fill="#0b1020" stroke={color} strokeOpacity={0.6} />
            <text x={mid.x} y={mid.y + 4} textAnchor="middle" fill={s.mode === "idle" || s.mode === "down" ? D.muted : color} fontSize={9.5} fontFamily="monospace" fontWeight={700}>
              {s.port}
            </text>
            <DNode x={s.x} y={s.y} label={s.label} sub={s.sub} accent={s.mode === "down" ? D.faint : D.cyan} w={s.w ?? 104} />
          </g>
        );
      })}
      <DNode x={sw.x} y={sw.y} label={sw.label} sub={sw.sub} accent={D.violet} w={sw.w ?? 84} />
    </g>
  );
}

/** A legend strip explaining the spoke colors. */
export function DSpokeLegend({ x, y }: { x: number; y: number }) {
  const items = [
    { c: D.warning, t: "ingress" },
    { c: D.cyan, t: "egress" },
    { c: D.line, t: "not used" },
    { c: D.danger, t: "blocked" },
  ];
  return (
    <g>
      {items.map((it, i) => (
        <g key={it.t}>
          <rect x={x + i * 92} y={y - 6} width={16} height={4} rx={2} fill={it.c} />
          <text x={x + i * 92 + 22} y={y} fill={D.muted} fontSize={9.5}>
            {it.t}
          </text>
        </g>
      ))}
    </g>
  );
}
