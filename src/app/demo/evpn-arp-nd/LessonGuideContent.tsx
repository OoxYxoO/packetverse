import { Callout, ChecklistCard, CompareCards, DArrow, DIAGRAM as D, DNode, DiagramFrame, DiagramSvg, Glossary, GuideSection } from "@/components/lesson/GuideBlocks";
import { DHeaderColumn } from "@/components/lesson/Srv6GuideSvg";
import { DRouteCard, EvpnFabric } from "@/components/lesson/EvpnGuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { HOST_A_IP, HOST_A_MAC, HOST_B_IP, HOST_B_MAC, VNI, VTEP_LOOPBACK } from "@/lib/sim-engine/scenarios/evpnArpNdSuppression";

export const EVPNA_LESSON_SECTIONS: LessonGuideSectionLink[] = [
  { id: "la-mission", label: "The mission" },
  { id: "la-fabric", label: "The fabric" },
  { id: "la-cost", label: "What one ARP costs" },
  { id: "la-known", label: "What LEAF1 already knows" },
  { id: "la-binding", label: "The MAC/IP binding" },
  { id: "la-proxy", label: "The proxy reply" },
  { id: "la-compare", label: "Before vs after" },
  { id: "la-limits", label: "When it cannot answer" },
  { id: "la-nd", label: "IPv6 Neighbor Discovery" },
  { id: "la-fault", label: "The flooding incident" },
  { id: "la-glossary", label: "Glossary" },
  { id: "la-recap", label: "Mental model" },
];

function FabricDiagram() {
  return (
    <DiagramSvg h={250} label={`HOST-A (${HOST_A_IP}) on LEAF1 and HOST-B (${HOST_B_IP}) on LEAF3, all in VNI ${VNI}`}>
      <EvpnFabric
        leaves={[
          { id: "LEAF1", sub: `VTEP ${VTEP_LOOPBACK.LEAF1}`, host: "HOST-A", hostSub: HOST_A_IP },
          { id: "LEAF2", sub: `VTEP ${VTEP_LOOPBACK.LEAF2}` },
          { id: "LEAF3", sub: `VTEP ${VTEP_LOOPBACK.LEAF3}`, host: "HOST-B", hostSub: HOST_B_IP },
        ]}
      />
      <text x={320} y={244} textAnchor="middle" fill={D.muted} fontSize={10}>
        HOST-A wants HOST-B&apos;s MAC before it can send anything
      </text>
    </DiagramSvg>
  );
}

function CostDiagram() {
  return (
    <DiagramSvg h={200} label={`Without suppression, LEAF1 floods HOST-A's ARP request as BUM: one VXLAN copy to ${VTEP_LOOPBACK.LEAF2} and one to ${VTEP_LOOPBACK.LEAF3}`}>
      <DNode x={100} y={90} label="LEAF1" sub="ARP = BUM" accent={D.warning} w={130} />
      <DArrow x1={166} y1={80} x2={380} y2={40} color={D.ip} label={`copy → ${VTEP_LOOPBACK.LEAF2}`} />
      <DArrow x1={166} y1={100} x2={380} y2={140} color={D.ip} label={`copy → ${VTEP_LOOPBACK.LEAF3}`} labelDy={18} />
      <DNode x={460} y={40} label="LEAF2" sub="no HOST-B here" accent={D.faint} w={140} />
      <DNode x={460} y={140} label="LEAF3" sub="HOST-B answers" accent={D.ip} w={140} />
      <text x={320} y={190} textAnchor="middle" fill={D.muted} fontSize={10}>
        every VTEP in the VNI pays for one question
      </text>
    </DiagramSvg>
  );
}

function KnownDiagram() {
  return (
    <DiagramSvg h={170} label={`LEAF1 already received HOST-B's Type 2 route: ${HOST_B_MAC} / ${HOST_B_IP} via ${VTEP_LOOPBACK.LEAF3}`}>
      <DRouteCard
        x={150}
        y={14}
        w={340}
        title="Type 2 — HOST-B (already in LEAF1's EVPN table)"
        rows={[
          { label: "MAC", value: HOST_B_MAC, strong: true },
          { label: "IP", value: HOST_B_IP, strong: true },
          { label: "BGP next hop", value: `${VTEP_LOOPBACK.LEAF3} (LEAF3)` },
        ]}
      />
      <text x={320} y={140} textAnchor="middle" fill={D.muted} fontSize={10}>
        the answer to HOST-A&apos;s question may already be sitting at the ingress VTEP
      </text>
    </DiagramSvg>
  );
}

function BindingDiagram() {
  return (
    <DiagramSvg h={180} label="Three different tables: LEAF1's MAC table, LEAF1's MAC/IP binding table, and HOST-A's own ARP cache">
      <DRouteCard x={16} y={20} w={196} title="LEAF1 MAC table" color={D.eth} rows={[{ label: "key", value: "MAC → port/VTEP" }]} />
      <DRouteCard x={222} y={20} w={196} title="LEAF1 MAC/IP binding" color={D.bgp} rows={[{ label: "key", value: "IP → MAC (+VTEP)", strong: true }]} />
      <DRouteCard x={428} y={20} w={196} title="HOST-A ARP cache" color={D.ip} rows={[{ label: "key", value: "IP → MAC" }]} />
      <text x={320} y={110} textAnchor="middle" fill={D.text} fontSize={11}>
        suppression answers from the middle table
      </text>
      <text x={320} y={132} textAnchor="middle" fill={D.muted} fontSize={10}>
        related, but three separate pieces of state on two different devices
      </text>
    </DiagramSvg>
  );
}

function ProxyDiagram() {
  return (
    <DiagramSvg h={200} label={`LEAF1 answers HOST-A locally: ${HOST_B_IP} is at ${HOST_B_MAC}, built from its own binding, not sent by HOST-B`}>
      <text x={160} y={18} textAnchor="middle" fill={D.text} fontSize={11} fontWeight={700}>
        HOST-A → LEAF1
      </text>
      <DHeaderColumn x={160} y={28} w={250} rows={[{ text: `ARP Request · who has ${HOST_B_IP}?`, color: D.warning, strong: true }, { text: "dst FF:FF:FF:FF:FF:FF", color: D.eth }]} />
      <text x={480} y={18} textAnchor="middle" fill={D.text} fontSize={11} fontWeight={700}>
        LEAF1 → HOST-A
      </text>
      <DHeaderColumn x={480} y={28} w={250} rows={[{ text: `ARP Reply · ${HOST_B_IP} is at`, color: D.success, strong: true }, { text: HOST_B_MAC, color: D.eth }, { text: `to ${HOST_A_MAC}`, color: D.eth }]} caption="answered by LEAF1" />
      <text x={320} y={176} textAnchor="middle" fill={D.muted} fontSize={10}>
        zero copies cross the fabric for discovery
      </text>
    </DiagramSvg>
  );
}

function LimitsDiagram() {
  return (
    <DiagramSvg h={170} label="If LEAF1 has a usable binding it replies locally; if not, it falls back to flooding the request to the Type 3 flood list">
      <DNode x={100} y={70} label="ARP arrives" sub="at LEAF1" accent={D.warning} w={130} />
      <DArrow x1={166} y1={60} x2={336} y2={36} color={D.success} label="usable binding" />
      <DArrow x1={166} y1={80} x2={336} y2={112} color={D.ip} label="no usable binding" labelDy={18} />
      <DNode x={440} y={36} label="Proxy reply" sub="local, no flood" accent={D.success} w={170} />
      <DNode x={440} y={112} label="Flood as BUM" sub="Type 3 flood list" accent={D.ip} w={170} />
      <text x={320} y={160} textAnchor="middle" fill={D.muted} fontSize={10}>
        a VTEP never invents an answer it does not have
      </text>
    </DiagramSvg>
  );
}

export function EvpnArpNdLessonGuideContent() {
  return (
    <>
      <GuideSection id="la-mission" eyebrow="Introduction" title="The mission: stop flooding questions we can answer" tone="cyan">
        <p>Before HOST-A can send to HOST-B it must resolve HOST-B&apos;s MAC. That ARP request is a broadcast — and broadcasts cost every VTEP in the VNI.</p>
      </GuideSection>

      <GuideSection id="la-fabric" eyebrow="Setup" title="The fabric" tone="ospf">
        <DiagramFrame caption="The same three-leaf fabric as the previous lessons.">
          <FabricDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="la-cost" eyebrow="Baseline" title="What one ARP costs" tone="warning">
        <DiagramFrame caption="The baseline, before suppression.">
          <CostDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="la-known" eyebrow="Control plane" title="What LEAF1 already knows" tone="bgp">
        <DiagramFrame caption="EVPN already distributed HOST-B's endpoint information.">
          <KnownDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="la-binding" eyebrow="State" title="The MAC/IP binding" tone="bgp">
        <DiagramFrame caption="Keep the three tables apart.">
          <BindingDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="la-proxy" eyebrow="Data plane" title="The proxy reply" tone="success">
        <DiagramFrame caption="Discovery answered at the edge.">
          <ProxyDiagram />
        </DiagramFrame>
        <Callout tone="cyan" title="Discovery only" icon="i">
          Suppression replaces the discovery exchange. HOST-A&apos;s real data traffic to HOST-B still crosses the fabric to LEAF3.
        </Callout>
      </GuideSection>

      <GuideSection id="la-compare" eyebrow="Comparison" title="Before vs after" tone="ip">
        <CompareCards
          items={[
            { title: "Without suppression", tone: "warning", tag: "flood", points: ["ARP classified as BUM", "One VXLAN copy per flood-list VTEP", "HOST-B's leaf returns the reply"] },
            { title: "With suppression", tone: "success", tag: "local", points: ["ARP intercepted at LEAF1", "Answered from the MAC/IP binding", "No discovery copies cross the fabric"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="la-limits" eyebrow="Limits" title="When it cannot answer" tone="warning">
        <DiagramFrame caption="Suppression is an optimization with a safe fallback.">
          <LimitsDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="la-nd" eyebrow="IPv6" title="IPv6 Neighbor Discovery" tone="violet">
        <CompareCards
          items={[
            { title: "IPv4 — ARP", tone: "cyan", tag: "ARP", points: ["ARP Request (broadcast)", "ARP Reply", "Proxy ARP reply from the VTEP"] },
            { title: "IPv6 — ND", tone: "violet", tag: "ICMPv6", points: ["Neighbor Solicitation (multicast)", "Neighbor Advertisement", "Proxy NA from the VTEP"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="la-fault" eyebrow="Troubleshooting" title="The flooding incident" tone="danger">
        <ChecklistCard tone="danger" title="How to reason about it (no spoilers)" mark="→" items={["Note what still works: traffic eventually gets through.", "Count the copies a single request now produces.", "Walk the layers the suppression decision depends on.", "Pick the fix only for the first layer that fails."]} />
      </GuideSection>

      <GuideSection id="la-glossary" eyebrow="Reference" title="Glossary" tone="cyan">
        <Glossary
          items={[
            { term: "ARP suppression", def: "The ingress VTEP answers ARP locally instead of flooding it." },
            { term: "MAC/IP binding", def: "An IP-to-MAC (and VTEP) fact learned via EVPN Type 2." },
            { term: "Proxy reply", def: "A reply generated by the VTEP on behalf of the real endpoint." },
            { term: "ND", def: "IPv6 Neighbor Discovery — Neighbor Solicitation / Neighbor Advertisement." },
          ]}
        />
      </GuideSection>

      <GuideSection id="la-recap" eyebrow="Recap" title="Mental model" tone="success">
        <Callout tone="success" title="One sentence" icon="✓">
          If the ingress VTEP already holds a usable MAC/IP binding, it answers ARP/ND itself; otherwise the request falls back to ordinary BUM flooding over the Type 3 flood list.
        </Callout>
      </GuideSection>
    </>
  );
}
