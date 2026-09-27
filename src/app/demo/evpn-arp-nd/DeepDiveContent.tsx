import { Callout, ChecklistCard, DArrow, DIAGRAM as D, DNode, DiagramFrame, DiagramSvg, Glossary, GuideSection } from "@/components/lesson/GuideBlocks";
import { DRouteCard } from "@/components/lesson/EvpnGuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { HOST_B_IP, HOST_B_MAC, VNI, VTEP_LOOPBACK } from "@/lib/sim-engine/scenarios/evpnArpNdSuppression";

export const EVPNA_DEEP_DIVE_SECTIONS: LessonGuideSectionLink[] = [
  { id: "da-pipeline", label: "The suppression pipeline" },
  { id: "da-type2", label: "What a Type 2 route can carry" },
  { id: "da-t2t3", label: "Type 2 and Type 3 together" },
  { id: "da-nd", label: "ND in more detail" },
  { id: "da-stale", label: "Stale bindings & mobility" },
  { id: "da-scale", label: "Why it matters at scale" },
  { id: "da-trouble", label: "Troubleshooting" },
  { id: "da-verify", label: "Verification" },
  { id: "da-glossary", label: "Glossary" },
  { id: "da-mental", label: "Mental model" },
];

function PipelineDiagram() {
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
    <DiagramSvg h={150} label="Suppression pipeline: intercept ARP/ND, look up target IP, check binding usable, reply locally or flood">
      {box(14, "Intercept", "ARP / NS at ingress", D.warning)}
      <DArrow x1={156} y1={65} x2={172} y2={65} color={D.faint} width={1.4} />
      {box(174, "Look up", "target IP", D.bgp)}
      <DArrow x1={316} y1={65} x2={332} y2={65} color={D.faint} width={1.4} />
      {box(334, "Usable?", "complete binding", D.violet)}
      <DArrow x1={476} y1={65} x2={492} y2={65} color={D.faint} width={1.4} />
      {box(494, "Reply / flood", "proxy or BUM", D.success)}
      <text x={320} y={126} textAnchor="middle" fill={D.muted} fontSize={10}>
        the decision is made entirely at the ingress VTEP
      </text>
    </DiagramSvg>
  );
}

function Type2FieldsDiagram() {
  return (
    <DiagramSvg h={190} label={`A Type 2 route can carry a MAC only, or a MAC plus an IP; only the MAC plus IP form lets a VTEP answer an ARP for ${HOST_B_IP}`}>
      <DRouteCard x={30} y={20} w={270} title="Type 2 — MAC only" color={D.eth} rows={[{ label: "MAC", value: HOST_B_MAC }, { label: "IP", value: "(absent)" }, { label: "supports", value: "L2 forwarding", strong: true }]} />
      <DRouteCard x={340} y={20} w={270} title="Type 2 — MAC + IP" color={D.bgp} rows={[{ label: "MAC", value: HOST_B_MAC }, { label: "IP", value: HOST_B_IP }, { label: "supports", value: "L2 forwarding + ARP/ND answers", strong: true }]} />
      <text x={320} y={150} textAnchor="middle" fill={D.muted} fontSize={10}>
        RFC 7432 allows both forms of the route
      </text>
    </DiagramSvg>
  );
}

function T2T3Diagram() {
  return (
    <DiagramSvg h={170} label={`Type 2 supplies endpoint knowledge for suppression; Type 3 supplies the VNI ${VNI} flood list used as fallback`}>
      <DRouteCard x={30} y={20} w={270} title="Type 2 → suppress" color={D.bgp} rows={[{ label: "knows", value: "the endpoint", strong: true }, { label: "enables", value: "local proxy reply" }]} />
      <DRouteCard x={340} y={20} w={270} title="Type 3 → fallback" color={D.cyan} rows={[{ label: "knows", value: `the VNI ${VNI} members`, strong: true }, { label: "enables", value: "BUM flooding" }]} />
      <text x={320} y={130} textAnchor="middle" fill={D.muted} fontSize={10}>
        suppression reduces flooding — it never removes the need for Type 3
      </text>
    </DiagramSvg>
  );
}

function NdDiagram() {
  return (
    <DiagramSvg h={170} label="IPv6 host sends a Neighbor Solicitation to a solicited-node multicast address; the VTEP answers with a proxy Neighbor Advertisement from its binding">
      <DNode x={110} y={60} label="IPv6 host" sub="Neighbor Solicitation" accent={D.violet} w={170} />
      <DArrow x1={196} y1={60} x2={296} y2={60} color={D.violet} label="NS" />
      <DNode x={380} y={60} label="Ingress VTEP" sub="binding lookup" accent={D.bgp} w={160} />
      <DArrow x1={461} y1={60} x2={520} y2={60} color={D.success} />
      <DNode x={580} y={60} label="Proxy NA" sub="local" accent={D.success} w={100} />
      <text x={320} y={130} textAnchor="middle" fill={D.muted} fontSize={10}>
        NS goes to the solicited-node multicast group · ICMPv6, not ARP — same suppression idea
      </text>
    </DiagramSvg>
  );
}

function StaleDiagram() {
  return (
    <DiagramSvg h={170} label={`If HOST-B moves, a binding pointing at ${VTEP_LOOPBACK.LEAF3} must be updated by the newer Type 2 route, or proxy replies would still be answered from stale information`}>
      <DRouteCard x={30} y={20} w={270} title="Old binding" color={D.faint} rows={[{ label: HOST_B_IP, value: `via ${VTEP_LOOPBACK.LEAF3}` }]} />
      <DRouteCard x={340} y={20} w={270} title="After a move" color={D.warning} rows={[{ label: HOST_B_IP, value: "via the new VTEP", strong: true }]} />
      <DArrow x1={302} y1={50} x2={338} y2={50} color={D.faint} />
      <text x={320} y={120} textAnchor="middle" fill={D.muted} fontSize={10}>
        MAC Mobility keeps the binding current — suppression is only as fresh as its data
      </text>
    </DiagramSvg>
  );
}

export function EvpnArpNdDeepDiveContent() {
  return (
    <>
      <GuideSection id="da-pipeline" eyebrow="Mechanism" title="The suppression pipeline" tone="bgp">
        <DiagramFrame caption="What happens inside the ingress VTEP.">
          <PipelineDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="da-type2" eyebrow="Control plane" title="What a Type 2 route can carry" tone="bgp">
        <DiagramFrame caption="Two valid forms of the same route type.">
          <Type2FieldsDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="da-t2t3" eyebrow="Model" title="Type 2 and Type 3 together" tone="cyan">
        <DiagramFrame caption="Knowledge and fallback.">
          <T2T3Diagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="da-nd" eyebrow="IPv6" title="ND in more detail" tone="violet">
        <DiagramFrame caption="Neighbor Discovery suppression.">
          <NdDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="da-stale" eyebrow="Operations" title="Stale bindings & mobility" tone="warning">
        <DiagramFrame caption="How the previous lesson connects to this one.">
          <StaleDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="da-scale" eyebrow="Design" title="Why it matters at scale" tone="ip">
        <p>Every flooded request costs one copy per member VTEP. With many leaves and many endpoints repeatedly resolving neighbors, answering at the edge removes a large share of BUM load.</p>
      </GuideSection>

      <GuideSection id="da-trouble" eyebrow="Operations" title="Troubleshooting" tone="warning">
        <ChecklistCard tone="warning" title="Ladder" mark="→" items={["Suppression enabled on the VNI?", "Type 2 route for the target received?", "Binding present on the ingress VTEP?", "Binding complete enough to answer?", "Request answered locally, or flooded?", "Copy count for one request?"]} />
      </GuideSection>

      <GuideSection id="da-verify" eyebrow="Operations" title="Verification" tone="success">
        <ChecklistCard tone="success" title="Evidence" mark="✓" items={["Proxy reply received by the host.", "Zero remote copies for a known target.", "Unknown targets still flood correctly."]} />
      </GuideSection>

      <GuideSection id="da-glossary" eyebrow="Reference" title="Glossary" tone="cyan">
        <Glossary
          items={[
            { term: "Solicited-node multicast", def: "The IPv6 multicast group a Neighbor Solicitation is sent to." },
            { term: "Proxy NA", def: "A Neighbor Advertisement generated by the VTEP on the endpoint's behalf." },
            { term: "Stale binding", def: "A MAC/IP binding that no longer reflects the endpoint's location." },
          ]}
        />
      </GuideSection>

      <GuideSection id="da-mental" eyebrow="Recap" title="Mental model" tone="success">
        <Callout tone="success" title="Recap" icon="✓">
          Type 2 knowledge lets the edge answer; Type 3 membership catches everything the edge cannot answer. Suppression is an optimization that must stay accurate.
        </Callout>
      </GuideSection>
    </>
  );
}
