import { DIAGRAM as D } from "@/components/lesson/GuideBlocks";

export type Arch = "VPWS" | "VPLS" | "BGP_VPLS" | "H_VPLS" | "EVPN";

export const ARCH_NAME: Record<Arch, string> = { VPWS: "VPWS", VPLS: "LDP-VPLS", BGP_VPLS: "BGP-VPLS", H_VPLS: "H-VPLS", EVPN: "EVPN" };
export const ARCH_COLOR: Record<Arch, string> = { VPWS: D.mpls, VPLS: D.violet, BGP_VPLS: D.bgp, H_VPLS: D.warning, EVPN: D.success };

const dot = (x: number, y: number, c: string, r = 7) => <circle cx={x} cy={y} r={r} fill={D.box} stroke={c} strokeWidth={1.6} />;

/** A tiny architecture thumbnail centered on (cx, cy), ~100×80: PEs as dots, PWs/sessions as lines. */
export function ArchSnapshot({ arch, cx, cy }: { arch: Arch; cx: number; cy: number }) {
  const c = ARCH_COLOR[arch];
  const tri: [number, number][] = [
    [cx - 32, cy + 22],
    [cx + 32, cy + 22],
    [cx, cy - 20],
  ];
  const mesh = (color: string) =>
    tri.map((p, i) => {
      const q = tri[(i + 1) % 3];
      return <line key={i} x1={p[0]} y1={p[1]} x2={q[0]} y2={q[1]} stroke={color} strokeWidth={1.8} />;
    });
  return (
    <g>
      {arch === "VPWS" && (
        <>
          <line x1={cx - 36} y1={cy} x2={cx + 36} y2={cy} stroke={c} strokeWidth={2} />
          {dot(cx - 36, cy, c)}
          {dot(cx + 36, cy, c)}
        </>
      )}
      {arch === "VPLS" && (
        <>
          {mesh(c)}
          {tri.map(([x, y], i) => (
            <g key={i}>{dot(x, y, c)}</g>
          ))}
        </>
      )}
      {(arch === "BGP_VPLS" || arch === "EVPN") && (
        <>
          {mesh(arch === "EVPN" ? D.line : ARCH_COLOR.VPLS)}
          {tri.map(([x, y], i) => (
            <line key={`r${i}`} x1={x} y1={y} x2={cx} y2={cy + 4} stroke={c} strokeWidth={1.4} strokeDasharray="3 3" />
          ))}
          <rect x={cx - 9} y={cy - 4} width={18} height={14} rx={3} fill={D.box} stroke={c} />
          <text x={cx} y={cy + 7} textAnchor="middle" fill={c} fontSize={7} fontWeight={700}>
            RR
          </text>
          {tri.map(([x, y], i) => (
            <g key={i}>{dot(x, y, ARCH_COLOR.VPLS)}</g>
          ))}
        </>
      )}
      {arch === "H_VPLS" && (
        <>
          {mesh(ARCH_COLOR.VPLS)}
          {tri.map(([x, y], i) => {
            const mx = x + (x - cx) * 0.55;
            const my = y + (y - cy) * 0.55;
            return (
              <g key={i}>
                <line x1={x} y1={y} x2={mx} y2={my} stroke={c} strokeWidth={1.6} strokeDasharray="3 2" />
                {dot(mx, my, c, 5)}
                {dot(x, y, ARCH_COLOR.VPLS)}
              </g>
            );
          })}
        </>
      )}
    </g>
  );
}
