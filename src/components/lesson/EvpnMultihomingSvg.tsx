import { DIAGRAM as D } from "./GuideBlocks";

/**
 * Shared SVG building blocks for the EVPN multihoming guides (Batch 8) — additive to EvpnGuideSvg. Every value is
 * passed in by the caller from its own scenario exports; these components only draw. Both fit a 640-wide DiagramSvg.
 */

export interface RoleBadge {
  text: string;
  color: string;
}

function Box({ x, y, w, h = 38, label, sub, accent = D.cyan, dim }: { x: number; y: number; w: number; h?: number; label: string; sub?: string; accent?: string; dim?: boolean }) {
  return (
    <g opacity={dim ? 0.55 : 1}>
      <rect x={x - w / 2} y={y - h / 2} width={w} height={h} rx={9} fill={D.box} stroke={accent} strokeOpacity={0.85} />
      <text x={x} y={sub ? y - 2 : y + 4} textAnchor="middle" fill={D.text} fontSize={12} fontWeight={700}>
        {label}
      </text>
      {sub && (
        <text x={x} y={y + 11} textAnchor="middle" fill={D.muted} fontSize={8.5} fontFamily="monospace">
          {sub}
        </text>
      )}
    </g>
  );
}

function Badge({ x, y, badge }: { x: number; y: number; badge: RoleBadge }) {
  const w = Math.max(38, badge.text.length * 6.4 + 12);
  return (
    <g>
      <rect x={x - w / 2} y={y - 8} width={w} height={16} rx={8} fill={badge.color} fillOpacity={0.18} stroke={badge.color} strokeOpacity={0.9} />
      <text x={x} y={y + 3.5} textAnchor="middle" fill={badge.color} fontSize={9} fontWeight={700}>
        {badge.text}
      </text>
    </g>
  );
}

/** SERVER-A dual-homed to LEAF1 + LEAF2 (one Ethernet Segment), HOST-B single-homed behind LEAF3, one underlay spine. */
export function DualHomedFabric({
  leafSub,
  serverSub,
  hostSub,
  esLabel,
  badges,
  failedAttachment,
}: {
  leafSub: { LEAF1: string; LEAF2: string; LEAF3: string };
  serverSub: string;
  hostSub: string;
  esLabel: string;
  badges?: Partial<Record<"LEAF1" | "LEAF2", RoleBadge>>;
  /** Draws that leaf's ES-facing link as failed (the leaf itself stays drawn healthy). */
  failedAttachment?: "LEAF1" | "LEAF2";
}) {
  const spine = { x: 320, y: 34 };
  const leaf = { LEAF1: { x: 120, y: 118 }, LEAF2: { x: 300, y: 118 }, LEAF3: { x: 520, y: 118 } };
  const server = { x: 245, y: 212 };
  const host = { x: 520, y: 212 };
  const esLink = (l: "LEAF1" | "LEAF2") => {
    const failed = failedAttachment === l;
    return (
      <g key={`es-${l}`}>
        <line x1={leaf[l].x} y1={leaf[l].y + 19} x2={server.x + (l === "LEAF1" ? -30 : 30)} y2={server.y - 19} stroke={failed ? D.danger : D.violet} strokeWidth={2.4} strokeDasharray={failed ? "6 5" : undefined} />
        {failed && (
          <text x={(leaf[l].x + server.x - 30) / 2 - 8} y={(leaf[l].y + server.y) / 2 + 4} textAnchor="middle" fill={D.danger} fontSize={14} fontWeight={700}>
            ✕
          </text>
        )}
      </g>
    );
  };
  return (
    <g>
      <rect x={52} y={150} width={316} height={92} rx={12} fill={D.violet} fillOpacity={0.06} stroke={D.violet} strokeOpacity={0.5} strokeDasharray="5 4" />
      {esLabel.split(" · ").map((line, i) => (
        <text key={line} x={62} y={196 + i * 13} fill={D.violet} fontSize={9} fontWeight={700}>
          {line}
        </text>
      ))}
      {(["LEAF1", "LEAF2", "LEAF3"] as const).map((l) => (
        <line key={`u-${l}`} x1={spine.x} y1={spine.y + 18} x2={leaf[l].x} y2={leaf[l].y - 19} stroke={D.line} strokeWidth={2} />
      ))}
      {esLink("LEAF1")}
      {esLink("LEAF2")}
      <line x1={leaf.LEAF3.x} y1={leaf.LEAF3.y + 19} x2={host.x} y2={host.y - 19} stroke={D.line} strokeWidth={2} />
      <Box x={spine.x} y={spine.y} w={140} label="SPINE1" sub="underlay only" accent={D.cyan} />
      {(["LEAF1", "LEAF2", "LEAF3"] as const).map((l) => (
        <Box key={l} x={leaf[l].x} y={leaf[l].y} w={130} label={l} sub={leafSub[l]} accent={l === "LEAF3" ? D.cyan : D.violet} />
      ))}
      {badges?.LEAF1 && <Badge x={leaf.LEAF1.x} y={leaf.LEAF1.y - 30} badge={badges.LEAF1} />}
      {badges?.LEAF2 && <Badge x={leaf.LEAF2.x} y={leaf.LEAF2.y - 30} badge={badges.LEAF2} />}
      <Box x={server.x} y={server.y} w={150} label="SERVER-A" sub={serverSub} accent={D.warning} />
      <Box x={host.x} y={host.y} w={150} label="HOST-B" sub={hostSub} accent={D.eth} />
    </g>
  );
}

/** CE-A dual-homed to PE1 + PE2, an MPLS core, and single-homed CE-B behind PE3. */
export function VpwsTopology({
  peSub,
  badges,
  ceASub,
  ceBSub,
  esLabel,
  failedAc,
}: {
  peSub: { PE1: string; PE2: string; PE3: string };
  badges?: Partial<Record<"PE1" | "PE2", RoleBadge>>;
  ceASub: string;
  ceBSub: string;
  esLabel: string;
  failedAc?: "PE1" | "PE2";
}) {
  const ceA = { x: 62, y: 120 };
  const pe = { PE1: { x: 196, y: 62 }, PE2: { x: 196, y: 178 }, PE3: { x: 470, y: 120 } };
  const core = { x: 334, y: 120 };
  const ceB = { x: 590, y: 120 };
  const ac = (p: "PE1" | "PE2") => {
    const failed = failedAc === p;
    return (
      <g key={`ac-${p}`}>
        <line x1={ceA.x + 38} y1={ceA.y} x2={pe[p].x - 58} y2={pe[p].y} stroke={failed ? D.danger : D.violet} strokeWidth={2.4} strokeDasharray={failed ? "6 5" : undefined} />
        {failed && (
          <text x={(ceA.x + pe[p].x) / 2 - 4} y={(ceA.y + pe[p].y) / 2 + 2} textAnchor="middle" fill={D.danger} fontSize={14} fontWeight={700}>
            ✕
          </text>
        )}
      </g>
    );
  };
  return (
    <g>
      <rect x={16} y={24} width={264} height={196} rx={12} fill={D.violet} fillOpacity={0.05} stroke={D.violet} strokeOpacity={0.45} strokeDasharray="5 4" />
      <text x={20} y={16} fill={D.violet} fontSize={9.5} fontWeight={700}>
        {esLabel}
      </text>
      {ac("PE1")}
      {ac("PE2")}
      <line x1={pe.PE1.x + 58} y1={pe.PE1.y} x2={core.x - 48} y2={core.y} stroke={D.line} strokeWidth={2} />
      <line x1={pe.PE2.x + 58} y1={pe.PE2.y} x2={core.x - 48} y2={core.y} stroke={D.line} strokeWidth={2} />
      <line x1={core.x + 48} y1={core.y} x2={pe.PE3.x - 58} y2={pe.PE3.y} stroke={D.line} strokeWidth={2} />
      <line x1={pe.PE3.x + 58} y1={pe.PE3.y} x2={ceB.x - 38} y2={ceB.y} stroke={D.line} strokeWidth={2} />
      <Box x={ceA.x} y={ceA.y} w={76} label="CE-A" sub={ceASub} accent={D.warning} />
      <Box x={pe.PE1.x} y={pe.PE1.y} w={116} label="PE1" sub={peSub.PE1} accent={D.violet} />
      <Box x={pe.PE2.x} y={pe.PE2.y} w={116} label="PE2" sub={peSub.PE2} accent={D.violet} />
      {badges?.PE1 && <Badge x={pe.PE1.x} y={pe.PE1.y - 30} badge={badges.PE1} />}
      {badges?.PE2 && <Badge x={pe.PE2.x} y={pe.PE2.y + 30} badge={badges.PE2} />}
      <Box x={core.x} y={core.y} w={96} label="CORE" sub="transport only" accent={D.mpls} />
      <Box x={pe.PE3.x} y={pe.PE3.y} w={116} label="PE3" sub={peSub.PE3} accent={D.cyan} />
      <Box x={ceB.x} y={ceB.y} w={76} label="CE-B" sub={ceBSub} accent={D.eth} />
    </g>
  );
}
