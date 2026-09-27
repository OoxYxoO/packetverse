import { Callout, ChecklistCard, DArrow, DIAGRAM as D, DiagramFrame, DiagramSvg, FieldTable, Glossary, GuideSection } from "@/components/lesson/GuideBlocks";
import { DHeaderColumn } from "@/components/lesson/Srv6GuideSvg";
import { DRouteCard, EvpnFabric } from "@/components/lesson/EvpnGuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { BROADCAST_MAC, EVPN_EXPORT_RT, HOST_A_IP, HOST_A_MAC, HOST_B_IP, HOST_C_IP, VNI, VTEP_LOOPBACK } from "@/lib/sim-engine/scenarios/evpnBum";

export const EVPNB_LESSON_SECTIONS: LessonGuideSectionLink[] = [
  { id: "lb-mission", label: "The mission" },
  { id: "lb-fabric", label: "Three sites, one VNI" },
  { id: "lb-bum", label: "B, U and M" },
  { id: "lb-why", label: "Why one lookup is not enough" },
  { id: "lb-type3", label: "Type 3 / IMET" },
  { id: "lb-floodlist", label: "Building the flood list" },
  { id: "lb-replication", label: "Head-end replication" },
  { id: "lb-spine", label: "The spine's role" },
  { id: "lb-t2t3", label: "Type 2 vs Type 3" },
  { id: "lb-fault", label: "The incident" },
  { id: "lb-glossary", label: "Glossary" },
  { id: "lb-recap", label: "Mental model" },
];

function FabricDiagram() {
  return (
    <DiagramSvg h={250} label={`Three leaves in VNI ${VNI}: LEAF1 with HOST-A, LEAF2 with HOST-B, LEAF3 with HOST-C, all behind SPINE1`}>
      <EvpnFabric
        leaves={[
          { id: "LEAF1", sub: `VTEP ${VTEP_LOOPBACK.LEAF1}`, host: "HOST-A", hostSub: HOST_A_IP },
          { id: "LEAF2", sub: `VTEP ${VTEP_LOOPBACK.LEAF2}`, host: "HOST-B", hostSub: HOST_B_IP },
          { id: "LEAF3", sub: `VTEP ${VTEP_LOOPBACK.LEAF3}`, host: "HOST-C", hostSub: HOST_C_IP },
        ]}
      />
      <text x={320} y={244} textAnchor="middle" fill={D.muted} fontSize={10}>
        one overlay segment (VNI {VNI}) spread across three VTEPs
      </text>
    </DiagramSvg>
  );
}

function Type3Diagram() {
  const leaves: ("LEAF1" | "LEAF2" | "LEAF3")[] = ["LEAF1", "LEAF2", "LEAF3"];
  return (
    <DiagramSvg h={200} label={`Each leaf advertises one Type 3 route for VNI ${VNI}: originating router IP is its own VTEP, RT ${EVPN_EXPORT_RT}`}>
      {leaves.map((l, i) => (
        <DRouteCard key={l} x={20 + i * 206} y={20} w={194} title={`${l} — Type 3 (IMET)`} rows={[{ label: "VNI", value: String(VNI) }, { label: "Orig. router IP", value: VTEP_LOOPBACK[l], strong: true }, { label: "RT", value: EVPN_EXPORT_RT }]} />
      ))}
      <text x={320} y={150} textAnchor="middle" fill={D.text} fontSize={11}>
        &quot;I participate in VNI {VNI}, reach me at my VTEP&quot;
      </text>
      <text x={320} y={172} textAnchor="middle" fill={D.muted} fontSize={10}>
        no MAC address, no host IP, no prefix — membership only
      </text>
    </DiagramSvg>
  );
}

function FloodListDiagram() {
  return (
    <DiagramSvg h={160} label={`LEAF1's flood list for VNI ${VNI}: LEAF2 ${VTEP_LOOPBACK.LEAF2} and LEAF3 ${VTEP_LOOPBACK.LEAF3}, built from imported Type 3 routes`}>
      <DRouteCard x={150} y={16} w={340} title={`LEAF1 — flood list for VNI ${VNI}`} color={D.violet} rows={[{ label: "LEAF2", value: `${VTEP_LOOPBACK.LEAF2} (Type 3 imported)`, strong: true }, { label: "LEAF3", value: `${VTEP_LOOPBACK.LEAF3} (Type 3 imported)`, strong: true }]} />
      <text x={320} y={130} textAnchor="middle" fill={D.muted} fontSize={10}>
        a VTEP whose Type 3 route is not imported is simply not on the list
      </text>
    </DiagramSvg>
  );
}

function ReplicationDiagram() {
  return (
    <DiagramSvg h={250} label={`One broadcast frame from HOST-A becomes two independent VXLAN packets at LEAF1: one to ${VTEP_LOOPBACK.LEAF2}, one to ${VTEP_LOOPBACK.LEAF3}`}>
      <text x={110} y={20} textAnchor="middle" fill={D.text} fontSize={11.5} fontWeight={700}>
        into LEAF1
      </text>
      <DHeaderColumn x={110} y={32} w={180} rows={[{ text: `dst ${BROADCAST_MAC}`, color: D.warning, strong: true }, { text: `src ${HOST_A_MAC}`, color: D.eth }]} caption="exactly one frame" />
      <DArrow x1={205} y1={60} x2={265} y2={60} color={D.faint} label="replicate" />
      <text x={440} y={20} textAnchor="middle" fill={D.text} fontSize={11.5} fontWeight={700}>
        out of LEAF1 — copy 1
      </text>
      <DHeaderColumn x={440} y={32} w={260} rows={[{ text: `Outer IP ${VTEP_LOOPBACK.LEAF1} → ${VTEP_LOOPBACK.LEAF2}`, color: D.ip, strong: true }, { text: `VXLAN · VNI ${VNI}`, color: D.violet }, { text: "original broadcast frame", color: D.eth }]} />
      <text x={440} y={124} textAnchor="middle" fill={D.text} fontSize={11.5} fontWeight={700}>
        out of LEAF1 — copy 2
      </text>
      <DHeaderColumn x={440} y={136} w={260} rows={[{ text: `Outer IP ${VTEP_LOOPBACK.LEAF1} → ${VTEP_LOOPBACK.LEAF3}`, color: D.ip, strong: true }, { text: `VXLAN · VNI ${VNI}`, color: D.violet }, { text: "original broadcast frame", color: D.eth }]} />
      <text x={320} y={236} textAnchor="middle" fill={D.muted} fontSize={10}>
        each copy is its own packet with ONE outer destination VTEP
      </text>
    </DiagramSvg>
  );
}

function Type2VsType3Diagram() {
  return (
    <DiagramSvg h={170} label="Type 2 answers where an endpoint is; Type 3 answers which VTEPs are in the broadcast domain">
      <DRouteCard x={30} y={20} w={270} title="Type 2 — MAC/IP" color={D.bgp} rows={[{ label: "question", value: "Where is this endpoint?", strong: true }, { label: "key", value: "one MAC (+ IP)" }, { label: "used for", value: "known unicast" }]} />
      <DRouteCard x={340} y={20} w={270} title="Type 3 — IMET" color={D.violet} rows={[{ label: "question", value: "Who is in this VNI?", strong: true }, { label: "key", value: "one VTEP per VNI" }, { label: "used for", value: "BUM flood list" }]} />
      <text x={320} y={140} textAnchor="middle" fill={D.muted} fontSize={10}>
        different questions, different routes — one can fail while the other stays healthy
      </text>
    </DiagramSvg>
  );
}

export function EvpnBumLessonGuideContent() {
  return (
    <>
      <GuideSection id="lb-mission" eyebrow="Introduction" title="The mission: frames with no single destination" tone="cyan">
        <p>Unicast to a known MAC is solved by Type 2. A broadcast, an unknown unicast or a multicast frame has no single destination VTEP to look up — yet it must reach every site in the segment.</p>
      </GuideSection>

      <GuideSection id="lb-fabric" eyebrow="Setup" title="Three sites, one VNI" tone="ospf">
        <DiagramFrame caption="The same fabric as the previous lesson, with a third leaf.">
          <FabricDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="lb-bum" eyebrow="Traffic classes" title="B, U and M" tone="warning">
        <FieldTable
          title="BUM traffic"
          accent="warning"
          columns={["Letter", "Meaning", "Example"]}
          rows={[
            ["B", "Broadcast", "ARP request, destination FF:FF:FF:FF:FF:FF"],
            ["U", "Unknown unicast", "a destination MAC not yet in the table"],
            ["M", "Multicast", "a group destination MAC"],
          ]}
        />
      </GuideSection>

      <GuideSection id="lb-why" eyebrow="Motivation" title="Why one lookup is not enough" tone="warning">
        <p>A Type 2 lookup returns one VTEP for one MAC. A BUM frame needs the full set of VTEPs that participate in the VNI — a different fact, so a different route type provides it.</p>
      </GuideSection>

      <GuideSection id="lb-type3" eyebrow="Control plane" title="Type 3 / IMET" tone="bgp">
        <DiagramFrame caption="Inclusive Multicast Ethernet Tag routes announce VNI membership.">
          <Type3Diagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="lb-floodlist" eyebrow="Control plane" title="Building the flood list" tone="violet">
        <DiagramFrame caption="The replication set is derived from imported Type 3 routes.">
          <FloodListDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="lb-replication" eyebrow="Data plane" title="Head-end replication" tone="ip">
        <DiagramFrame caption="The ingress VTEP makes the copies — this lesson's model.">
          <ReplicationDiagram />
        </DiagramFrame>
        <Callout tone="cyan" title="One mechanism, not the only one" icon="i">
          This lesson models ingress (head-end) replication. Some EVPN designs instead let the underlay replicate BUM traffic with multicast.
        </Callout>
      </GuideSection>

      <GuideSection id="lb-spine" eyebrow="Roles" title="The spine's role" tone="ospf">
        <p>SPINE1 receives two ordinary IP/UDP packets and routes each on its own outer destination. It does not see that the inner frame is a broadcast, and it performs no EVPN replication.</p>
      </GuideSection>

      <GuideSection id="lb-t2t3" eyebrow="Mental model" title="Type 2 vs Type 3" tone="bgp">
        <DiagramFrame caption="Keep the two questions apart.">
          <Type2VsType3Diagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="lb-fault" eyebrow="Troubleshooting" title="The incident" tone="danger">
        <ChecklistCard tone="danger" title="How to reason about it (no spoilers)" mark="→" items={["Note which traffic still works and which does not.", "Walk the layers bottom-up: underlay, BGP session, EVPN routes, flood list, copies sent.", "At each layer, look for evidence rather than assumptions.", "Pick the fix only for the first layer that fails."]} />
      </GuideSection>

      <GuideSection id="lb-glossary" eyebrow="Reference" title="Glossary" tone="cyan">
        <Glossary
          items={[
            { term: "BUM", def: "Broadcast, Unknown-unicast, Multicast traffic." },
            { term: "IMET", def: "Inclusive Multicast Ethernet Tag — EVPN Route Type 3." },
            { term: "Flood list", def: "The remote VTEPs a VTEP replicates BUM traffic to, per VNI." },
            { term: "Ingress replication", def: "The ingress VTEP creates one unicast VXLAN copy per remote VTEP." },
          ]}
        />
      </GuideSection>

      <GuideSection id="lb-recap" eyebrow="Recap" title="Mental model" tone="success">
        <Callout tone="success" title="One sentence" icon="✓">
          Type 3 tells every VTEP who else is in the VNI; the ingress VTEP turns one BUM frame into one VXLAN copy per member; the spine just routes each copy.
        </Callout>
      </GuideSection>
    </>
  );
}
