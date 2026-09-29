import type { ReactNode } from "react";
import { DArrow, DIAGRAM as D, DLink, DNode } from "@/components/lesson/GuideBlocks";

/**
 * Lesson-local SVG helper for the SD-WAN guides: CLIENT — BRANCH-EDGE, two paths (ISP-A / TUN-A above, ISP-B / TUN-B
 * below) to HUB-EDGE — APP. Underlay circuits are solid lines through the ISP clouds; each overlay path is drawn as a
 * dashed curve beside them. Presentation only — labels and states are passed in by the guide from scenario exports.
 */
export const SP = { C: { x: 46, y: 126 }, BR: { x: 150, y: 126 }, A: { x: 320, y: 44 }, B: { x: 320, y: 208 }, HUB: { x: 490, y: 126 }, APP: { x: 596, y: 126 } };
export type PathMode = "idle" | "flow" | "probe" | "fail" | "drop";
export interface PathSpec {
  mode?: PathMode;
  /** Overlay label, e.g. "TUN-A · eligible". */
  label?: string;
  color?: string;
  /** A ✕ mark at the hub end (probe unanswered) or at the branch (flow dropped). */
  mark?: "hub" | "branch";
}

function OnePath({ which, spec }: { which: "A" | "B"; spec: PathSpec }) {
  const isp = SP[which];
  const up = which === "A";
  const mode = spec.mode ?? "idle";
  const c = spec.color ?? (mode === "fail" ? D.warning : mode === "drop" ? D.danger : mode === "probe" ? D.mpls : mode === "flow" ? D.success : D.line);
  const bx = SP.BR.x + 30;
  const hx = SP.HUB.x - 30;
  const by = SP.BR.y + (up ? -20 : 20);
  // Underlay: branch → ISP cloud → hub.
  const underlay = (
    <g>
      <DLink x1={bx} y1={by} x2={isp.x - 46} y2={isp.y + (up ? 14 : -14)} color={D.line} />
      <DLink x1={isp.x + 46} y1={isp.y + (up ? 14 : -14)} x2={hx} y2={by} color={D.line} />
    </g>
  );
  // Overlay: a dashed curve inside the underlay lines.
  const cy = up ? SP.BR.y - 44 : SP.BR.y + 44;
  const overlay = <path d={`M ${bx} ${by} Q ${SP.A.x} ${cy} ${hx} ${by}`} fill="none" stroke={c} strokeWidth={mode === "idle" ? 1.6 : 2.4} strokeDasharray="6 4" />;
  const arrowY = up ? SP.BR.y - 32 : SP.BR.y + 32;
  return (
    <g>
      {underlay}
      {overlay}
      {(mode === "flow" || mode === "probe") && <DArrow x1={300} y1={arrowY} x2={352} y2={arrowY} color={c} width={2} />}
      {spec.label && (
        <text x={SP.A.x} y={up ? SP.BR.y - 46 : SP.BR.y + 54} textAnchor="middle" fill={c === D.line ? D.muted : c} fontSize={9.5} fontFamily="monospace" fontWeight={700}>
          {spec.label}
        </text>
      )}
      {spec.mark && (
        <text x={spec.mark === "hub" ? hx - 26 : bx + 16} y={by + 5} textAnchor="middle" fill={D.danger} fontSize={15} fontWeight={800}>
          ✕
        </text>
      )}
    </g>
  );
}

export function SdTopo({ a = {}, b = {}, subs = {}, lan, children }: { a?: PathSpec; b?: PathSpec; subs?: Partial<Record<keyof typeof SP, string>>; lan?: { left?: string; right?: string; color?: string }; children?: ReactNode }) {
  const lc = lan?.color ?? D.line;
  return (
    <g>
      <OnePath which="A" spec={a} />
      <OnePath which="B" spec={b} />
      {lan?.left ? <DArrow x1={SP.C.x + 34} y1={SP.C.y} x2={SP.BR.x - 36} y2={SP.BR.y} color={lc} width={1.8} /> : <DLink x1={SP.C.x + 34} y1={SP.C.y} x2={SP.BR.x - 36} y2={SP.BR.y} />}
      {lan?.right ? <DArrow x1={SP.HUB.x + 36} y1={SP.HUB.y} x2={SP.APP.x - 30} y2={SP.APP.y} color={lc} width={1.8} /> : <DLink x1={SP.HUB.x + 36} y1={SP.HUB.y} x2={SP.APP.x - 30} y2={SP.APP.y} />}
      <DNode x={SP.C.x} y={SP.C.y} label="CLIENT" sub={subs.C} accent={D.cyan} w={66} h={40} />
      <DNode x={SP.BR.x} y={SP.BR.y} label="BRANCH" sub={subs.BR} accent={D.violet} w={72} h={48} />
      <DNode x={SP.A.x} y={SP.A.y} label="ISP-A" sub={subs.A ?? "underlay"} accent={D.warning} w={92} h={36} />
      <DNode x={SP.B.x} y={SP.B.y} label="ISP-B" sub={subs.B ?? "underlay"} accent={D.warning} w={92} h={36} />
      <DNode x={SP.HUB.x} y={SP.HUB.y} label="HUB" sub={subs.HUB} accent={D.violet} w={72} h={48} />
      <DNode x={SP.APP.x} y={SP.APP.y} label="APP" sub={subs.APP} accent={D.success} w={60} h={40} />
      {children}
    </g>
  );
}
