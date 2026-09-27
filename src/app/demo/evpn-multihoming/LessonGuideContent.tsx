import { Callout, ChecklistCard, DArrow, DIAGRAM as D, DiagramFrame, DiagramSvg, Glossary, GuideSection } from "@/components/lesson/GuideBlocks";
import { DRouteCard } from "@/components/lesson/EvpnGuideSvg";
import { DualHomedFabric } from "@/components/lesson/EvpnMultihomingSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { ESI, ES_IMPORT_RT, HOST_B_IP, SERVER_A_IP, SERVICE_RT, VLAN, VNI, VTEP_LOOPBACK, electDesignatedForwarder } from "@/lib/sim-engine/scenarios/evpnMultihoming";

export const EVPNMH_LESSON_SECTIONS: LessonGuideSectionLink[] = [
  { id: "lmh-mission", label: "The mission" },
  { id: "lmh-fabric", label: "Single- vs multihomed" },
  { id: "lmh-es", label: "Ethernet Segment & ESI" },
  { id: "lmh-type4", label: "Type 4 & ES-Import RT" },
  { id: "lmh-type1", label: "Type 1 per-ES / per-EVI" },
  { id: "lmh-dup", label: "The duplicate-BUM problem" },
  { id: "lmh-df", label: "DF election" },
  { id: "lmh-scope", label: "DF scope" },
  { id: "lmh-bum", label: "DF forwards, NDF suppresses" },
  { id: "lmh-unicast", label: "Known unicast" },
  { id: "lmh-failure", label: "ES-attachment failure" },
  { id: "lmh-fault", label: "The incident" },
  { id: "lmh-glossary", label: "Glossary" },
  { id: "lmh-recap", label: "Mental model" },
];

const ESI_SHORT = ESI.slice(-8);
const LEAF_SUB = { LEAF1: `VTEP ${VTEP_LOOPBACK.LEAF1}`, LEAF2: `VTEP ${VTEP_LOOPBACK.LEAF2}`, LEAF3: `VTEP ${VTEP_LOOPBACK.LEAF3}` };
/** The lesson's own default election, computed by the scenario's function — never retyped. */
const ELECTION = electDesignatedForwarder(
  [
    { leaf: "LEAF1", electionValue: VTEP_LOOPBACK.LEAF1, available: true },
    { leaf: "LEAF2", electionValue: VTEP_LOOPBACK.LEAF2, available: true },
  ],
  VLAN,
);
const N = ELECTION.ordinals.length;

function FabricDiagram() {
  return (
    <DiagramSvg h={250} label={`SERVER-A (${SERVER_A_IP}) dual-homed to LEAF1 and LEAF2 on Ethernet Segment ${ESI}; HOST-B (${HOST_B_IP}) single-homed on LEAF3`}>
      <DualHomedFabric leafSub={LEAF_SUB} serverSub={`${SERVER_A_IP} · dual-homed`} hostSub={`${HOST_B_IP} · single-homed`} esLabel={`Ethernet Segment · ESI …${ESI_SHORT}`} />
    </DiagramSvg>
  );
}

function Type4Diagram() {
  return (
    <DiagramSvg h={200} label={`Type 4 route from LEAF1: ESI ${ESI}, originating router ${VTEP_LOOPBACK.LEAF1}, ES-Import Route Target ${ES_IMPORT_RT} (configured); the service RT ${SERVICE_RT} is a different attribute`}>
      <DRouteCard
        x={20}
        y={14}
        w={330}
        title="Type 4 — Ethernet Segment route (LEAF1)"
        color={D.violet}
        rows={[
          { label: "ESI", value: ESI },
          { label: "Originating router", value: VTEP_LOOPBACK.LEAF1 },
          { label: "ES-Import RT", value: ES_IMPORT_RT, strong: true },
          { label: "purpose", value: "ES peers + DF candidacy" },
        ]}
      />
      <DRouteCard x={372} y={14} w={250} title="Not on Type 4" color={D.faint} rows={[{ label: "service RT", value: SERVICE_RT }, { label: "carried by", value: "Type 1 / 2 / 3" }]} />
      <text x={320} y={150} textAnchor="middle" fill={D.text} fontSize={11}>
        only PEs configured with the same ES-Import RT import the route
      </text>
      <text x={320} y={170} textAnchor="middle" fill={D.muted} fontSize={10}>
        Type-0 ESI → the ES-Import RT is configured, not auto-derived
      </text>
    </DiagramSvg>
  );
}

function Type1Diagram() {
  return (
    <DiagramSvg h={190} label={`Type 1 per-ES: Ethernet Tag MAX-ET, Single-Active flag 0 (All-Active). Type 1 per-EVI: Ethernet Tag 0, VNI ${VNI} in the label field`}>
      <DRouteCard x={20} y={14} w={290} title="Type 1 — A-D per-ES" color={D.bgp} rows={[{ label: "Ethernet Tag", value: "MAX-ET 0xFFFFFFFF", strong: true }, { label: "ESI Label EC", value: "Single-Active flag 0" }, { label: "means", value: "All-Active segment" }]} />
      <DRouteCard x={330} y={14} w={290} title="Type 1 — A-D per-EVI" color={D.bgp} rows={[{ label: "Ethernet Tag", value: "0", strong: true }, { label: "Label field", value: `VNI ${VNI}` }, { label: "means", value: "this PE serves this EVI" }]} />
      <text x={320} y={140} textAnchor="middle" fill={D.text} fontSize={11}>
        Ethernet Tag 0 and VNI {VNI} are two different fields
      </text>
      <text x={320} y={160} textAnchor="middle" fill={D.muted} fontSize={10}>
        VLAN-based service (one VNI per EVI) → Ethernet Tag is 0 (RFC 8365)
      </text>
    </DiagramSvg>
  );
}

function ElectionDiagram() {
  const rows = ELECTION.ordinals;
  return (
    <DiagramSvg h={210} label={`Default DF election: candidates ordered numerically (${rows.map((o) => `${o.leaf} ${o.ip} ordinal ${o.ordinal}`).join(", ")}), VLAN ${VLAN} mod ${N} = ${VLAN % N}, so ordinal ${VLAN % N} (${ELECTION.winner}) is DF`}>
      <text x={40} y={24} fill={D.muted} fontSize={10} fontWeight={700}>
        1 · order candidate IPs numerically
      </text>
      {rows.map((o, i) => (
        <g key={o.leaf}>
          <rect x={40} y={34 + i * 34} width={250} height={28} rx={7} fill={D.box} stroke={D.violet} strokeOpacity={0.7} />
          <text x={52} y={52 + i * 34} fill={D.text} fontSize={11} fontWeight={700}>
            {o.leaf}
          </text>
          <text x={120} y={52 + i * 34} fill={D.muted} fontSize={10} fontFamily="monospace">
            {o.ip}
          </text>
          <text x={278} y={52 + i * 34} textAnchor="end" fill={D.violet} fontSize={10} fontWeight={700}>
            ordinal {o.ordinal}
          </text>
        </g>
      ))}
      <text x={360} y={24} fill={D.muted} fontSize={10} fontWeight={700}>
        2 · VLAN mod N picks the ordinal
      </text>
      <rect x={360} y={34} width={250} height={62} rx={9} fill={D.warning} fillOpacity={0.1} stroke={D.warning} strokeOpacity={0.8} />
      <text x={485} y={60} textAnchor="middle" fill={D.text} fontSize={15} fontWeight={700} fontFamily="monospace">
        {VLAN} mod {N} = {VLAN % N}
      </text>
      <text x={485} y={82} textAnchor="middle" fill={D.warning} fontSize={10.5} fontWeight={700}>
        ordinal {VLAN % N} → {ELECTION.winner} is DF
      </text>
      <text x={320} y={160} textAnchor="middle" fill={D.text} fontSize={11}>
        the lower IP only decides who holds ordinal 0 — the modulo decides the winner
      </text>
      <text x={320} y={180} textAnchor="middle" fill={D.muted} fontSize={10}>
        with a different VLAN the same two PEs could elect the other one
      </text>
    </DiagramSvg>
  );
}

function BumDiagram() {
  const ndf = ELECTION.ordinals.find((o) => o.leaf !== ELECTION.winner)?.leaf;
  return (
    <DiagramSvg h={250} label={`HOST-B's broadcast: LEAF3 sends one VXLAN copy to each flood-list VTEP; the DF delivers onto the segment and the NDF suppresses its copy`}>
      <DualHomedFabric
        leafSub={LEAF_SUB}
        serverSub="receives ONE copy"
        hostSub="sends a broadcast"
        esLabel={`ESI …${ESI_SHORT} · VLAN ${VLAN} / VNI ${VNI}`}
        badges={{ [ELECTION.winner ?? "LEAF1"]: { text: "DF · forwards", color: D.success }, ...(ndf ? { [ndf]: { text: "NDF · suppresses", color: D.warning } } : {}) }}
      />
    </DiagramSvg>
  );
}

function FailureDiagram() {
  return (
    <DiagramSvg h={286} label={`LEAF1's ES attachment fails: LEAF1 withdraws its Type 4 route, LEAF2 becomes DF (VLAN ${VLAN} mod 1 = 0); LEAF1 stays a VTEP in VNI ${VNI}'s flood list`}>
      <DualHomedFabric
        leafSub={LEAF_SUB}
        serverSub="still reachable via LEAF2"
        hostSub="same broadcast again"
        esLabel="ES attachment · LEAF1 down"
        failedAttachment="LEAF1"
        badges={{ LEAF1: { text: "ES attachment down", color: D.danger }, LEAF2: { text: "DF (only candidate)", color: D.success } }}
      />
      <text x={320} y={262} textAnchor="middle" fill={D.text} fontSize={10.5}>
        LEAF1 withdraws Type 4 → candidates = {"{"}LEAF2{"}"} → VLAN {VLAN} mod 1 = 0 → LEAF2 is DF
      </text>
      <text x={320} y={280} textAnchor="middle" fill={D.muted} fontSize={10}>
        LEAF1 is still in VNI {VNI}&apos;s flood list — it receives its copy but cannot deliver it
      </text>
    </DiagramSvg>
  );
}

function ScopeDiagram() {
  return (
    <DiagramSvg h={150} label={`DF scope: one ESI plus one EVI (VLAN ${VLAN} / VNI ${VNI}), and only BUM traffic toward the segment`}>
      <DRouteCard x={40} y={20} w={260} title="DF controls" color={D.success} rows={[{ label: "traffic", value: "BUM toward the ES" }, { label: "scope", value: `ESI …${ESI_SHORT} + VLAN ${VLAN}` }]} />
      <DRouteCard x={340} y={20} w={260} title="DF does NOT control" color={D.faint} rows={[{ label: "traffic", value: "known unicast" }, { label: "scope", value: "other ESIs / other EVIs" }]} />
      <DArrow x1={302} y1={50} x2={338} y2={50} color={D.faint} both width={1.2} />
    </DiagramSvg>
  );
}

export function EvpnMultihomingLessonGuideContent() {
  return (
    <>
      <GuideSection id="lmh-mission" eyebrow="Introduction" title="The mission: one server, two leafs" tone="cyan">
        <p>Every earlier endpoint hung off exactly one leaf. SERVER-A is attached to two, for redundancy. That raises two questions: how do the leafs know they share one attachment, and how do they avoid delivering the same broadcast twice?</p>
      </GuideSection>

      <GuideSection id="lmh-fabric" eyebrow="Setup" title="Single-homed vs multihomed" tone="ospf">
        <DiagramFrame caption="The lesson's fabric: SERVER-A multihomed, HOST-B single-homed.">
          <FabricDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="lmh-es" eyebrow="Identity" title="Ethernet Segment & ESI" tone="violet">
        <p>
          The Ethernet Segment is the shared attachment between SERVER-A and its PEs. The ESI (<span className="pv-mono">{ESI}</span>) identifies that segment — not a host, not a cable, not a VNI. It is configured identically on LEAF1 and LEAF2. Mode: <b>All-Active</b> — both PEs may forward at the same time.
        </p>
      </GuideSection>

      <GuideSection id="lmh-type4" eyebrow="Control plane" title="Type 4 & the ES-Import Route Target" tone="bgp">
        <DiagramFrame caption="Type 4 answers “who else is attached to this segment?”.">
          <Type4Diagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="lmh-type1" eyebrow="Control plane" title="Type 1 per-ES and per-EVI" tone="bgp">
        <DiagramFrame caption="One route type, two forms, two purposes.">
          <Type1Diagram />
        </DiagramFrame>
        <Callout tone="cyan" title="Type 4 vs Type 1" icon="i">
          Type 4 is ES peer discovery and DF candidacy. Type 1 is multihoming reachability and failure signaling. Neither is Type 2 (endpoint MAC/IP) or Type 3 (BUM membership).
        </Callout>
      </GuideSection>

      <GuideSection id="lmh-dup" eyebrow="Problem" title="The duplicate-BUM problem" tone="warning">
        <p>LEAF3 replicates a broadcast to every VTEP in the VNI&apos;s flood list, so both LEAF1 and LEAF2 receive a copy. If both delivered it onto the segment, SERVER-A would see every broadcast twice.</p>
      </GuideSection>

      <GuideSection id="lmh-df" eyebrow="Election" title="DF election — the default algorithm" tone="warning">
        <DiagramFrame caption="Numeric ordering assigns ordinals; VLAN mod N selects one.">
          <ElectionDiagram />
        </DiagramFrame>
        <Callout tone="warning" title="Not “lowest IP wins”" icon="!">
          Ordering by IP only numbers the candidates. The modulo of the service value picks which number wins — so different VLANs can spread the DF role across PEs.
        </Callout>
      </GuideSection>

      <GuideSection id="lmh-scope" eyebrow="Election" title="DF scope" tone="violet">
        <DiagramFrame caption="The role is per ESI and per EVI — never router-wide.">
          <ScopeDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="lmh-bum" eyebrow="Data plane" title="DF forwards, NDF suppresses" tone="ip">
        <DiagramFrame caption="Both PEs receive a copy; only one delivers it onto the segment.">
          <BumDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="lmh-unicast" eyebrow="Data plane" title="Known unicast is different" tone="success">
        <p>In All-Active mode the NDF is a fully working PE for ordinary unicast. Its role only suppresses BUM delivery toward the segment.</p>
      </GuideSection>

      <GuideSection id="lmh-failure" eyebrow="Failure" title="ES-attachment failure and re-election" tone="danger">
        <DiagramFrame caption="Only the attachment fails — the leaf, its VTEP and its flood membership stay up.">
          <FailureDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="lmh-fault" eyebrow="Troubleshooting" title="The incident" tone="danger">
        <ChecklistCard tone="danger" title="How to reason about it (no spoilers)" mark="→" items={["Describe the symptom precisely: what does SERVER-A receive?", "Walk the layers: links, underlay, BGP EVPN, ESI, Type 4, Type 1, election outcome, forwarding.", "At each layer, look for evidence rather than assumptions.", "Pick the fix only for the first layer that fails."]} />
      </GuideSection>

      <GuideSection id="lmh-glossary" eyebrow="Reference" title="Glossary" tone="cyan">
        <Glossary
          items={[
            { term: "Ethernet Segment", def: "The shared attachment between a multihomed device and its PEs." },
            { term: "ESI", def: "10-octet Ethernet Segment Identifier — identifies the segment itself." },
            { term: "ES-Import RT", def: "Route target that limits Type 4 import to PEs on the same segment." },
            { term: "DF / NDF", def: "Designated / non-designated forwarder for BUM toward one segment and one EVI." },
            { term: "Ordinal", def: "A candidate's position after numeric IP ordering, starting at 0." },
          ]}
        />
      </GuideSection>

      <GuideSection id="lmh-recap" eyebrow="Recap" title="Mental model" tone="success">
        <Callout tone="success" title="One sentence" icon="✓">
          The ESI names the shared attachment, Type 4 lets its PEs find each other, the default election numbers them by IP and picks VLAN mod N as DF for BUM, and an attachment failure withdraws Type 4 so the survivors re-elect.
        </Callout>
      </GuideSection>
    </>
  );
}
