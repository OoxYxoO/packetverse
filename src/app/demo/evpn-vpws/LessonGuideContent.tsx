import { Callout, ChecklistCard, CompareCards, DArrow, DIAGRAM as D, DNode, DiagramFrame, DiagramSvg, Glossary, GuideSection } from "@/components/lesson/GuideBlocks";
import { DRouteCard } from "@/components/lesson/EvpnGuideSvg";
import { VpwsTopology } from "@/components/lesson/EvpnMultihomingSvg";
import { DHeaderColumn } from "@/components/lesson/Srv6GuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { CE_A_MAC, CE_B_MAC, CORRECT_L2_MTU, ESI, FAULT_L2_MTU, LOCAL_AC_VLAN, LOCAL_SERVICE_LABEL, PE_LOOPBACK, REMOTE_AC_VLAN, TRANSPORT_LABEL_TO, VPWS_SERVICE_ID, electSingleActivePrimary } from "@/lib/sim-engine/scenarios/evpnVpws";

export const EVPNVP_LESSON_SECTIONS: LessonGuideSectionLink[] = [
  { id: "lvp-mission", label: "The mission" },
  { id: "lvp-topology", label: "Act 1: Single-Active" },
  { id: "lvp-pes", label: "Per-ES vs per-EVI" },
  { id: "lvp-election", label: "Primary election" },
  { id: "lvp-service", label: "Act 2: VPWS-500" },
  { id: "lvp-signaling", label: "Signaling & P/B" },
  { id: "lvp-labels", label: "Labels in every direction" },
  { id: "lvp-core", label: "Core & disposition" },
  { id: "lvp-failover", label: "Service-specific failover" },
  { id: "lvp-mtu", label: "L2 MTU" },
  { id: "lvp-fault", label: "The incident" },
  { id: "lvp-glossary", label: "Glossary" },
  { id: "lvp-recap", label: "Mental model" },
];

const ESI_SHORT = ESI.slice(-8);
const PE_SUB = { PE1: PE_LOOPBACK.PE1, PE2: PE_LOOPBACK.PE2, PE3: PE_LOOPBACK.PE3 };
/** The lesson's own election, computed by the scenario's function — never retyped. */
const ELECTION = electSingleActivePrimary(
  [
    { pe: "PE1", electionValue: PE_LOOPBACK.PE1, available: true },
    { pe: "PE2", electionValue: PE_LOOPBACK.PE2, available: true },
  ],
  VPWS_SERVICE_ID,
);
const N = ELECTION.ordinals.length;
const PRIMARY = ELECTION.primaryPe ?? "PE1";
const BACKUP = ELECTION.backupPe ?? "PE2";

function TopologyDiagram() {
  return (
    <DiagramSvg h={240} label={`CE-A dual-homed to PE1 and PE2 (ESI ${ESI}, Single-Active): ${PRIMARY} Primary, ${BACKUP} Backup; CORE; PE3; CE-B`}>
      <VpwsTopology peSub={PE_SUB} ceASub={`VLAN ${LOCAL_AC_VLAN}`} ceBSub={`VLAN ${REMOTE_AC_VLAN}`} esLabel={`ESI …${ESI_SHORT} · Single-Active`} badges={{ [PRIMARY]: { text: "PRIMARY", color: D.success }, [BACKUP]: { text: "BACKUP", color: D.warning } }} />
    </DiagramSvg>
  );
}

function PerEsPerEviDiagram() {
  return (
    <DiagramSvg h={190} label="Per-ES route: Single-Active flag 1 describes the segment. Per-EVI route: P/B flags describe this PE's role for one VPWS service">
      <DRouteCard x={20} y={14} w={290} title="A-D per-ES (PE1, PE2)" color={D.bgp} rows={[{ label: "Ethernet Tag", value: "MAX-ET" }, { label: "Single-Active flag", value: "1", strong: true }, { label: "describes", value: "the whole segment" }]} />
      <DRouteCard x={330} y={14} w={290} title={`A-D per-EVI (VPWS-${VPWS_SERVICE_ID})`} color={D.bgp} rows={[{ label: "Ethernet Tag", value: `${VPWS_SERVICE_ID} (service ID)` }, { label: "P / B flags", value: "role for this service", strong: true }, { label: "describes", value: "one service instance" }]} />
      <text x={320} y={150} textAnchor="middle" fill={D.text} fontSize={11}>
        PE3 uses a PE1/PE2 per-EVI route only when its per-ES route is also present
      </text>
    </DiagramSvg>
  );
}

function ElectionDiagram() {
  return (
    <DiagramSvg h={200} label={`Default election: ${ELECTION.ordinals.map((o) => `${o.pe} ${o.ip} ordinal ${o.ordinal}`).join(", ")}; service ID ${VPWS_SERVICE_ID} mod ${N} = ${VPWS_SERVICE_ID % N}, so ${PRIMARY} is Primary and ${BACKUP} Backup`}>
      <text x={40} y={24} fill={D.muted} fontSize={10} fontWeight={700}>
        1 · order loopbacks numerically
      </text>
      {ELECTION.ordinals.map((o, i) => (
        <g key={o.pe}>
          <rect x={40} y={34 + i * 34} width={250} height={28} rx={7} fill={D.box} stroke={D.violet} strokeOpacity={0.7} />
          <text x={52} y={52 + i * 34} fill={D.text} fontSize={11} fontWeight={700}>
            {o.pe}
          </text>
          <text x={110} y={52 + i * 34} fill={D.muted} fontSize={10} fontFamily="monospace">
            {o.ip}
          </text>
          <text x={278} y={52 + i * 34} textAnchor="end" fill={D.violet} fontSize={10} fontWeight={700}>
            ordinal {o.ordinal}
          </text>
        </g>
      ))}
      <text x={360} y={24} fill={D.muted} fontSize={10} fontWeight={700}>
        2 · service ID mod N picks the Primary
      </text>
      <rect x={360} y={34} width={250} height={62} rx={9} fill={D.warning} fillOpacity={0.1} stroke={D.warning} strokeOpacity={0.8} />
      <text x={485} y={60} textAnchor="middle" fill={D.text} fontSize={15} fontWeight={700} fontFamily="monospace">
        {VPWS_SERVICE_ID} mod {N} = {VPWS_SERVICE_ID % N}
      </text>
      <text x={485} y={82} textAnchor="middle" fill={D.warning} fontSize={10.5} fontWeight={700}>
        {PRIMARY} Primary · next ordinal {BACKUP} Backup
      </text>
      <text x={320} y={150} textAnchor="middle" fill={D.text} fontSize={11}>
        Primary advertises P=1 B=0 · Backup advertises P=0 B=1
      </text>
      <text x={320} y={170} textAnchor="middle" fill={D.muted} fontSize={10}>
        the lower loopback only decides who holds ordinal 0
      </text>
    </DiagramSvg>
  );
}

function ServiceDiagram() {
  return (
    <DiagramSvg h={170} label={`CE-A's AC on VLAN ${LOCAL_AC_VLAN} and CE-B's AC on VLAN ${REMOTE_AC_VLAN} are joined by VPWS service ${VPWS_SERVICE_ID} — three different numbers`}>
      <DNode x={100} y={60} label="CE-A AC" sub={`VLAN ${LOCAL_AC_VLAN}`} accent={D.warning} w={140} />
      <DArrow x1={171} y1={60} x2={236} y2={60} color={D.violet} both />
      <DNode x={320} y={60} label={`VPWS-${VPWS_SERVICE_ID}`} sub="service instance ID" accent={D.violet} w={160} />
      <DArrow x1={401} y1={60} x2={466} y2={60} color={D.violet} both />
      <DNode x={540} y={60} label="CE-B AC" sub={`VLAN ${REMOTE_AC_VLAN}`} accent={D.eth} w={140} />
      <text x={320} y={128} textAnchor="middle" fill={D.text} fontSize={11}>
        a point-to-point wire — customer VLANs need not match each other or the service ID
      </text>
    </DiagramSvg>
  );
}

function LabelsDiagram() {
  const col = (x: number, title: string, t: number, s: number, src: string, dst: string) => (
    <g>
      <text x={x} y={18} textAnchor="middle" fill={D.text} fontSize={11} fontWeight={700}>
        {title}
      </text>
      <DHeaderColumn x={x} y={28} w={190} rows={[{ text: `transport ${t}`, color: D.mpls, strong: true }, { text: `service ${s}`, color: D.violet, strong: true }, { text: `Eth ${src} → ${dst}`, color: D.eth }]} />
    </g>
  );
  return (
    <DiagramSvg h={150} label={`PE1 to PE3: transport ${TRANSPORT_LABEL_TO.PE3}, service ${LOCAL_SERVICE_LABEL.PE3}. PE3 to PE1: transport ${TRANSPORT_LABEL_TO.PE1}, service ${LOCAL_SERVICE_LABEL.PE1}. PE3 to PE2 after failover: transport ${TRANSPORT_LABEL_TO.PE2}, service ${LOCAL_SERVICE_LABEL.PE2}`}>
      {col(110, "PE1 → PE3", TRANSPORT_LABEL_TO.PE3, LOCAL_SERVICE_LABEL.PE3, "CE-A", "CE-B")}
      {col(320, "PE3 → PE1", TRANSPORT_LABEL_TO.PE1, LOCAL_SERVICE_LABEL.PE1, "CE-B", "CE-A")}
      {col(530, "PE3 → PE2 (failover)", TRANSPORT_LABEL_TO.PE2, LOCAL_SERVICE_LABEL.PE2, "CE-B", "CE-A")}
      <text x={320} y={126} textAnchor="middle" fill={D.muted} fontSize={10}>
        both labels always belong to the DESTINATION PE — never the sender&apos;s own
      </text>
    </DiagramSvg>
  );
}

function FailoverDiagram() {
  return (
    <DiagramSvg h={280} label={`PE1's VPWS-${VPWS_SERVICE_ID} AC fails: PE1 withdraws its per-EVI route (per-ES stays), PE2 becomes Primary, PE3 now pushes ${TRANSPORT_LABEL_TO.PE2} / ${LOCAL_SERVICE_LABEL.PE2}`}>
      <VpwsTopology peSub={PE_SUB} ceASub={`VLAN ${LOCAL_AC_VLAN}`} ceBSub={`VLAN ${REMOTE_AC_VLAN}`} esLabel={`ESI …${ESI_SHORT} · per-ES routes stay`} failedAc="PE1" badges={{ PE1: { text: `VPWS-${VPWS_SERVICE_ID} AC down`, color: D.danger }, PE2: { text: "PRIMARY", color: D.success } }} />
      <text x={320} y={250} textAnchor="middle" fill={D.text} fontSize={10.5}>
        PE1 withdraws its per-EVI route only · PE3 → PE2: transport {TRANSPORT_LABEL_TO.PE2}, service {LOCAL_SERVICE_LABEL.PE2}
      </text>
      <text x={320} y={268} textAnchor="middle" fill={D.muted} fontSize={10}>
        PE1, its core links and BGP stay up — the segment keeps serving other services
      </text>
    </DiagramSvg>
  );
}

function MtuDiagram() {
  return (
    <DiagramSvg h={180} label={`L2 MTU check at PE3: the received non-zero MTU is compared with PE3's local MTU; healthy ${CORRECT_L2_MTU}/${CORRECT_L2_MTU} is usable, a mismatch keeps the endpoint unusable`}>
      <DRouteCard x={30} y={20} w={270} title="Primary's per-EVI route" color={D.bgp} rows={[{ label: "L2 MTU (advertised)", value: String(CORRECT_L2_MTU), strong: true }]} />
      <DRouteCard x={340} y={20} w={270} title="PE3" color={D.cyan} rows={[{ label: "local = advertised", value: `${CORRECT_L2_MTU} when healthy` }]} />
      <text x={320} y={110} textAnchor="middle" fill={D.text} fontSize={11}>
        received ≠ local (e.g. {CORRECT_L2_MTU} vs {FAULT_L2_MTU}) → remote endpoint not added → service DOWN
      </text>
      <text x={320} y={132} textAnchor="middle" fill={D.muted} fontSize={10}>
        a service-parameter check — BGP, labels and election can all be healthy
      </text>
    </DiagramSvg>
  );
}

export function EvpnVpwsLessonGuideContent() {
  return (
    <>
      <GuideSection id="lvp-mission" eyebrow="Introduction" title="The mission: a protected virtual wire" tone="cyan">
        <p>CE-A and CE-B need a point-to-point Ethernet service. CE-A is dual-homed for protection, but only one PE carries the service at a time. Act 1 builds that redundancy; Act 2 builds the EVPN-VPWS service on top.</p>
      </GuideSection>

      <GuideSection id="lvp-topology" eyebrow="Act 1" title="Single-Active multihoming" tone="ospf">
        <DiagramFrame caption="One active PE per service; the other is healthy and standing by.">
          <TopologyDiagram />
        </DiagramFrame>
        <CompareCards
          items={[
            { title: "All-Active (earlier lessons)", tone: "success", tag: "multihoming", points: ["Several PEs forward at once", "Per-flow use of eligible paths", "Single-Active flag 0"] },
            { title: "Single-Active (this lesson)", tone: "warning", tag: "VPWS", points: ["One Primary per service", "Backup ready to take over", "Single-Active flag 1"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="lvp-pes" eyebrow="Act 1" title="Per-ES vs per-EVI" tone="bgp">
        <DiagramFrame caption="Two signals that are related but not the same.">
          <PerEsPerEviDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="lvp-election" eyebrow="Act 1" title="Primary election" tone="warning">
        <DiagramFrame caption="Numeric ordering assigns ordinals; the service ID mod N selects one.">
          <ElectionDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="lvp-service" eyebrow="Act 2" title="VPWS-500" tone="violet">
        <DiagramFrame caption="Customer VLANs versus the service instance identifier.">
          <ServiceDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="lvp-signaling" eyebrow="Act 2" title="Signaling & P/B flags" tone="bgp">
        <p>
          Each PE advertises an Ethernet A-D per-EVI route with Ethernet Tag {VPWS_SERVICE_ID}, its own downstream service label, and the Layer-2 Attributes community (P/B flags and L2 MTU). No Type-2 MAC route is involved: the service comes up when PE3 and the usable Primary hold each other&apos;s route.
        </p>
        <Callout tone="cyan" title="Control plane only" icon="i">
          P/B flags, L2 MTU and the Single-Active flag live in BGP routes. None of them appears in the customer frame or the MPLS labels.
        </Callout>
      </GuideSection>

      <GuideSection id="lvp-labels" eyebrow="Act 2" title="Labels in every direction" tone="mpls">
        <DiagramFrame caption="Destination-specific transport label over the destination's service label.">
          <LabelsDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="lvp-core" eyebrow="Act 2" title="Core & disposition" tone="ip">
        <p>
          The CORE swaps only the top transport label. At the destination the service label identifies VPWS-{VPWS_SERVICE_ID} and its attachment circuit, and the customer frame ({CE_A_MAC} ↔ {CE_B_MAC}) leaves unchanged. The service label is not an L3VPN VPN label — there is no VRF.
        </p>
      </GuideSection>

      <GuideSection id="lvp-failover" eyebrow="Failover" title="Service-specific failover" tone="danger">
        <DiagramFrame caption="Only this service's attachment on PE1 fails.">
          <FailoverDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="lvp-mtu" eyebrow="Parameters" title="L2 MTU" tone="warning">
        <DiagramFrame caption="Local MTU versus the MTU received from the far end.">
          <MtuDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="lvp-fault" eyebrow="Troubleshooting" title="The incident" tone="danger">
        <ChecklistCard tone="danger" title="How to reason about it (no spoilers)" mark="→" items={["Describe the symptom: which direction fails, and since when?", "Walk the layers: sessions, per-ES and per-EVI routes, roles, service parameters, labels, forwarding.", "Compare what each end advertises with what it expects locally.", "Pick the fix only for the first layer that fails."]} />
      </GuideSection>

      <GuideSection id="lvp-glossary" eyebrow="Reference" title="Glossary" tone="cyan">
        <Glossary
          items={[
            { term: "VPWS", def: "Virtual Private Wire Service — a point-to-point Ethernet service." },
            { term: "Service instance ID", def: "Carried in the per-EVI route's Ethernet Tag; not a customer VLAN." },
            { term: "P / B flags", def: "Primary / Backup role in the Layer-2 Attributes community." },
            { term: "Service label", def: "Downstream label identifying the VPWS endpoint at the disposition PE." },
            { term: "Transport label", def: "Provider label that carries the packet to one specific destination PE." },
          ]}
        />
      </GuideSection>

      <GuideSection id="lvp-recap" eyebrow="Recap" title="Mental model" tone="success">
        <Callout tone="success" title="One sentence" icon="✓">
          Per-ES routes declare the segment Single-Active, the default election picks the Primary, per-EVI routes signal the service and its labels, and traffic always carries the destination PE&apos;s transport and service labels — so a service failover changes both.
        </Callout>
      </GuideSection>
    </>
  );
}
