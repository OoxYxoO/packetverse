import { Callout, ChecklistCard, CompareCards, DArrow, DIAGRAM as D, DNode, DiagramFrame, DiagramSvg, Glossary, GuideSection } from "@/components/lesson/GuideBlocks";
import { DRouteCard } from "@/components/lesson/EvpnGuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { ESI, ES_IMPORT_RT, MAX_ET, SERVICE_RT, VLAN, VNI, VTEP_LOOPBACK } from "@/lib/sim-engine/scenarios/evpnMultihoming";

export const EVPNMH_DEEP_DIVE_SECTIONS: LessonGuideSectionLink[] = [
  { id: "dmh-esi", label: "ESI structure" },
  { id: "dmh-type4", label: "Route Type 4 & import" },
  { id: "dmh-type1", label: "Route Type 1 forms" },
  { id: "dmh-mode", label: "All-Active vs Single-Active" },
  { id: "dmh-carving", label: "Service carving" },
  { id: "dmh-algos", label: "Other DF algorithms" },
  { id: "dmh-planes", label: "DF, unicast & split-horizon" },
  { id: "dmh-convergence", label: "Failure convergence" },
  { id: "dmh-trouble", label: "Troubleshooting" },
  { id: "dmh-verify", label: "Verification" },
  { id: "dmh-glossary", label: "Glossary" },
  { id: "dmh-mental", label: "Mental model" },
];

const ESI_TYPE = ESI.slice(0, 2);
const ESI_VALUE = ESI.slice(3);
const MAX_ET_HEX = `0x${MAX_ET.toString(16).toUpperCase()}`;

function EsiDiagram() {
  return (
    <DiagramSvg h={170} label={`ESI ${ESI}: one type octet ${ESI_TYPE} followed by a nine-octet value`}>
      <rect x={40} y={40} width={90} height={40} rx={8} fill={D.warning} fillOpacity={0.14} stroke={D.warning} />
      <text x={85} y={58} textAnchor="middle" fill={D.text} fontSize={11} fontWeight={700}>
        Type {ESI_TYPE}
      </text>
      <text x={85} y={72} textAnchor="middle" fill={D.muted} fontSize={9}>
        1 octet
      </text>
      <rect x={140} y={40} width={460} height={40} rx={8} fill={D.violet} fillOpacity={0.12} stroke={D.violet} />
      <text x={370} y={58} textAnchor="middle" fill={D.text} fontSize={11} fontWeight={700} fontFamily="monospace">
        {ESI_VALUE}
      </text>
      <text x={370} y={72} textAnchor="middle" fill={D.muted} fontSize={9}>
        9-octet ESI value
      </text>
      <text x={320} y={118} textAnchor="middle" fill={D.text} fontSize={11}>
        Type 0 = operator-configured value
      </text>
      <text x={320} y={138} textAnchor="middle" fill={D.muted} fontSize={10}>
        types 1–5 derive the value from LACP, MAC, router ID or AS — not used here
      </text>
    </DiagramSvg>
  );
}

function ImportDiagram() {
  return (
    <DiagramSvg h={190} label={`Type 4 carrying ES-Import RT ${ES_IMPORT_RT} is imported by LEAF1 and LEAF2 (same segment) and not by LEAF3`}>
      <DNode x={110} y={70} label="Type 4" sub={`ES-Import ${ES_IMPORT_RT}`} accent={D.violet} w={190} />
      <DArrow x1={206} y1={60} x2={330} y2={34} color={D.success} label="import (same ES)" />
      <DArrow x1={206} y1={70} x2={330} y2={88} color={D.success} labelDy={16} />
      <DArrow x1={206} y1={80} x2={330} y2={142} color={D.faint} dashed label="not imported" labelDy={24} />
      <DNode x={420} y={34} label="LEAF1" sub={VTEP_LOOPBACK.LEAF1} accent={D.success} w={170} />
      <DNode x={420} y={92} label="LEAF2" sub={VTEP_LOOPBACK.LEAF2} accent={D.success} w={170} />
      <DNode x={420} y={150} label="LEAF3" sub="no local ESI" accent={D.faint} w={170} />
    </DiagramSvg>
  );
}

function Type1FormsDiagram() {
  return (
    <DiagramSvg h={200} label={`Type 1 per-ES: Ethernet Tag ${MAX_ET_HEX}, MPLS label 0, ESI Label extended community with Single-Active flag. Type 1 per-EVI: Ethernet Tag 0, label carrying VNI ${VNI}, service RT ${SERVICE_RT}`}>
      <DRouteCard x={20} y={14} w={290} title="A-D per-ES" color={D.bgp} rows={[{ label: "Ethernet Tag", value: `${MAX_ET_HEX} (MAX-ET)`, strong: true }, { label: "Label field", value: "0" }, { label: "ESI Label EC", value: "Single-Active flag" }, { label: "used for", value: "mode + mass withdrawal" }]} />
      <DRouteCard x={330} y={14} w={290} title="A-D per-EVI" color={D.bgp} rows={[{ label: "Ethernet Tag", value: "0 (VLAN-based)", strong: true }, { label: "Label field", value: `VNI ${VNI}` }, { label: "RT", value: SERVICE_RT }, { label: "used for", value: "aliasing / backup path" }]} />
      <text x={320} y={170} textAnchor="middle" fill={D.muted} fontSize={10}>
        RFC 7432 §8.2.1 / §8.4.1 · RFC 8365 §5.1.3 for the VXLAN field rules
      </text>
    </DiagramSvg>
  );
}

function CarvingDiagram() {
  const vlans = [VLAN, VLAN + 1, VLAN + 2, VLAN + 3];
  const leafs = ["LEAF1", "LEAF2"];
  return (
    <DiagramSvg h={200} label={`Service carving across VLANs with two candidates: each VLAN mod 2 selects an ordinal, spreading the DF role; this lesson's VLAN is ${VLAN}`}>
      <text x={320} y={22} textAnchor="middle" fill={D.muted} fontSize={10}>
        N = 2 · LEAF1 = ordinal 0 · LEAF2 = ordinal 1 (illustrative VLANs besides {VLAN})
      </text>
      {vlans.map((v, i) => {
        const k = v % leafs.length;
        const own = v === VLAN;
        return (
          <g key={v}>
            <rect x={40 + i * 145} y={40} width={130} height={92} rx={9} fill={own ? D.warning : D.box} fillOpacity={own ? 0.12 : 1} stroke={own ? D.warning : D.line} />
            <text x={105 + i * 145} y={64} textAnchor="middle" fill={D.text} fontSize={12} fontWeight={700}>
              VLAN {v}
            </text>
            <text x={105 + i * 145} y={88} textAnchor="middle" fill={D.muted} fontSize={10.5} fontFamily="monospace">
              {v} mod 2 = {k}
            </text>
            <text x={105 + i * 145} y={112} textAnchor="middle" fill={D.success} fontSize={11} fontWeight={700}>
              DF {leafs[k]}
            </text>
          </g>
        );
      })}
      <text x={320} y={166} textAnchor="middle" fill={D.text} fontSize={11}>
        carving spreads BUM work across the PEs of one segment
      </text>
    </DiagramSvg>
  );
}

function PlanesDiagram() {
  return (
    <DiagramSvg h={190} label="Three traffic cases toward or from a multihomed segment: BUM toward the ES uses the DF; known unicast uses any eligible PE; BUM from the ES is not sent back to it (split-horizon)">
      <DRouteCard x={14} y={20} w={196} title="BUM → segment" color={D.warning} rows={[{ label: "who delivers", value: "DF only" }]} />
      <DRouteCard x={222} y={20} w={196} title="Known unicast" color={D.success} rows={[{ label: "who delivers", value: "any eligible PE" }]} />
      <DRouteCard x={430} y={20} w={196} title="BUM from segment" color={D.violet} rows={[{ label: "rule", value: "never back to same ES" }]} />
      <text x={320} y={112} textAnchor="middle" fill={D.text} fontSize={11}>
        split-horizon: VXLAN overlays use the source VTEP (local bias), MPLS uses the ESI label
      </text>
      <text x={320} y={132} textAnchor="middle" fill={D.muted} fontSize={10}>
        conceptual context — the lesson does not simulate split-horizon mechanics
      </text>
    </DiagramSvg>
  );
}

function ConvergenceDiagram() {
  const box = (x: number, t: string, s: string, c: string) => (
    <g>
      <rect x={x} y={36} width={140} height={58} rx={10} fill={c} fillOpacity={0.12} stroke={c} strokeOpacity={0.75} />
      <text x={x + 70} y={60} textAnchor="middle" fill={D.text} fontSize={11} fontWeight={700}>
        {t}
      </text>
      <text x={x + 70} y={78} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        {s}
      </text>
    </g>
  );
  return (
    <DiagramSvg h={160} label="ES attachment down, the PE withdraws its Type 4 route, the remaining PEs re-run the election, the new DF unblocks BUM toward the segment">
      {box(14, "Attachment down", "one PE, one ES", D.danger)}
      <DArrow x1={156} y1={65} x2={172} y2={65} color={D.faint} width={1.4} />
      {box(174, "Type 4 withdrawn", "leaves candidacy", D.bgp)}
      <DArrow x1={316} y1={65} x2={332} y2={65} color={D.faint} width={1.4} />
      {box(334, "Re-election", "survivors re-carve", D.warning)}
      <DArrow x1={476} y1={65} x2={492} y2={65} color={D.faint} width={1.4} />
      {box(494, "New DF", "BUM unblocked", D.success)}
      <text x={320} y={128} textAnchor="middle" fill={D.muted} fontSize={10}>
        DF re-election is one part of convergence — aliasing and mass withdrawal are the others
      </text>
    </DiagramSvg>
  );
}

export function EvpnMultihomingDeepDiveContent() {
  return (
    <>
      <GuideSection id="dmh-esi" eyebrow="Identity" title="ESI structure" tone="violet">
        <DiagramFrame caption="The 10-octet Ethernet Segment Identifier.">
          <EsiDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="dmh-type4" eyebrow="Control plane" title="Route Type 4 & the ES-Import RT" tone="bgp">
        <DiagramFrame caption="The ES-Import RT keeps Type 4 routes on the PEs of one segment.">
          <ImportDiagram />
        </DiagramFrame>
        <Callout tone="cyan" title="Two different route targets" icon="i">
          The ES-Import RT ({ES_IMPORT_RT}, configured for this Type-0 ESI) steers Type 4 routes. The service RT ({SERVICE_RT}) steers the EVI&apos;s Type 1, 2 and 3 routes. RFC 7432 only auto-derives an ES-Import RT for ESI types 1–3.
        </Callout>
      </GuideSection>

      <GuideSection id="dmh-type1" eyebrow="Control plane" title="Route Type 1 forms" tone="bgp">
        <DiagramFrame caption="Per-ES and per-EVI carry different fields.">
          <Type1FormsDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="dmh-mode" eyebrow="Redundancy" title="All-Active vs Single-Active" tone="violet">
        <CompareCards
          items={[
            { title: "All-Active", tone: "success", tag: "this lesson", points: ["Single-Active flag 0 on per-ES", "All PEs may forward known unicast", "DF still governs BUM toward the ES"] },
            { title: "Single-Active", tone: "warning", tag: "VPWS lesson", points: ["Single-Active flag 1 on per-ES", "One PE forwards per service", "Backup PE stands by"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="dmh-carving" eyebrow="Election" title="Default service carving" tone="warning">
        <DiagramFrame caption="The same candidates, different VLANs, different DFs.">
          <CarvingDiagram />
        </DiagramFrame>
        <p>RFC 7432 §8.5: after a short timer, each PE lists the originating IPs from the segment&apos;s Type 4 routes in increasing numeric order, numbers them from 0, and the PE with ordinal (V mod N) is DF for VLAN V.</p>
      </GuideSection>

      <GuideSection id="dmh-algos" eyebrow="Context" title="Other DF algorithms" tone="violet">
        <p>RFC 8584 adds a framework for alternative elections — for example highest random weight (HRW) and preference-based election. They are context only; this lesson runs the default modulo procedure.</p>
      </GuideSection>

      <GuideSection id="dmh-planes" eyebrow="Model" title="DF, unicast & split-horizon" tone="ip">
        <DiagramFrame caption="Three different rules for three kinds of traffic.">
          <PlanesDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="dmh-convergence" eyebrow="Failure" title="Failure convergence" tone="danger">
        <DiagramFrame caption="The control-plane chain after an attachment failure.">
          <ConvergenceDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="dmh-trouble" eyebrow="Operations" title="Troubleshooting" tone="warning">
        <ChecklistCard tone="warning" title="Ladder" mark="→" items={["Physical links to the segment.", "Underlay and BGP EVPN sessions.", "Same ESI configured on each PE.", "Type 4 routes imported by the segment's PEs.", "Type 1 per-ES and per-EVI routes present.", "Election result per ESI and EVI on each PE.", "BUM copies delivered onto the segment."]} />
      </GuideSection>

      <GuideSection id="dmh-verify" eyebrow="Operations" title="Verification" tone="success">
        <ChecklistCard tone="success" title="Evidence" mark="✓" items={["Each PE lists the other as an ES peer.", "Both PEs report the same DF for the same scope.", "A test broadcast arrives exactly once.", "Known unicast still flows through either PE."]} />
      </GuideSection>

      <GuideSection id="dmh-glossary" eyebrow="Reference" title="Glossary" tone="cyan">
        <Glossary
          items={[
            { term: "MAX-ET", def: `Reserved Ethernet Tag ${MAX_ET_HEX} carried by A-D per-ES routes.` },
            { term: "ESI Label EC", def: "Extended community on per-ES routes: Single-Active flag and ESI label." },
            { term: "Service carving", def: "Default DF election: numeric ordering plus VLAN mod N." },
            { term: "Local bias", def: "VXLAN split-horizon using the source VTEP address." },
            { term: "HRW", def: "Highest random weight — an alternative DF algorithm (RFC 8584)." },
          ]}
        />
      </GuideSection>

      <GuideSection id="dmh-mental" eyebrow="Recap" title="Mental model" tone="success">
        <Callout tone="success" title="Recap" icon="✓">
          Discovery (Type 4, ES-Import RT) finds the peers; signaling (Type 1) states mode and reachability; the default election carves BUM duty by VLAN; failures withdraw routes and the election re-runs.
        </Callout>
      </GuideSection>
    </>
  );
}
