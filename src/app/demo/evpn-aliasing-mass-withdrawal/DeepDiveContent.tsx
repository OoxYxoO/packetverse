import { Callout, ChecklistCard, CompareCards, DArrow, DIAGRAM as D, DNode, DiagramFrame, DiagramSvg, Glossary, GuideSection } from "@/components/lesson/GuideBlocks";
import { DRouteCard } from "@/components/lesson/EvpnGuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { ESI, SERVER_A_MAC, VNI, VTEP_LOOPBACK } from "@/lib/sim-engine/scenarios/evpnAliasingMassWithdrawal";

export const EVPNAL_DEEP_DIVE_SECTIONS: LessonGuideSectionLink[] = [
  { id: "dal-rule", label: "The §8.4 rule" },
  { id: "dal-resolve", label: "Type 2 + A-D resolution" },
  { id: "dal-mode", label: "Why All-Active matters" },
  { id: "dal-scale", label: "Mass withdrawal at scale" },
  { id: "dal-history", label: "Route history vs usability" },
  { id: "dal-timeline", label: "RFC convergence timeline" },
  { id: "dal-three", label: "DF vs aliasing vs mass withdrawal" },
  { id: "dal-flows", label: "The flow abstraction" },
  { id: "dal-trouble", label: "Troubleshooting" },
  { id: "dal-verify", label: "Verification" },
  { id: "dal-glossary", label: "Glossary" },
  { id: "dal-mental", label: "Mental model" },
];

const ESI_SHORT = ESI.slice(-8);

function RuleDiagram() {
  return (
    <DiagramSvg h={170} label="A per-EVI route received before the per-ES routes must not be used for forwarding; once the per-ES route arrives the PE becomes usable">
      <DNode x={110} y={60} label="per-EVI received" sub="per-ES not yet" accent={D.warning} w={180} />
      <DArrow x1={201} y1={60} x2={300} y2={60} color={D.faint} label="wait" />
      <DNode x={390} y={60} label="per-ES received" sub="Single-Active flag 0" accent={D.bgp} w={170} />
      <DArrow x1={476} y1={60} x2={520} y2={60} color={D.success} />
      <DNode x={575} y={60} label="usable" accent={D.success} w={90} />
      <text x={320} y={128} textAnchor="middle" fill={D.muted} fontSize={10}>
        RFC 7432 §8.4 — avoids installing paths during races or a mass-withdraw period
      </text>
    </DiagramSvg>
  );
}

function ResolveDiagram() {
  return (
    <DiagramSvg h={200} label={`Resolution at LEAF3: ${SERVER_A_MAC} → Type 2 → ESI → PEs with per-EVI and All-Active per-ES routes → VTEPs ${VTEP_LOOPBACK.LEAF1} and ${VTEP_LOOPBACK.LEAF2}`}>
      <DNode x={80} y={50} label="dst MAC" sub={SERVER_A_MAC} accent={D.eth} w={150} />
      <DArrow x1={156} y1={50} x2={206} y2={50} color={D.faint} />
      <DNode x={270} y={50} label="Type 2" sub={`ESI …${ESI_SHORT}`} accent={D.bgp} w={120} />
      <DArrow x1={331} y1={50} x2={381} y2={50} color={D.faint} />
      <DNode x={480} y={50} label="A-D check" sub="per-EVI ∧ per-ES(0)" accent={D.violet} w={190} />
      <DArrow x1={480} y1={73} x2={480} y2={110} color={D.faint} />
      <DNode x={380} y={140} label="LEAF1" sub={VTEP_LOOPBACK.LEAF1} accent={D.success} w={140} />
      <DNode x={560} y={140} label="LEAF2" sub={VTEP_LOOPBACK.LEAF2} accent={D.success} w={140} />
      <text x={130} y={140} textAnchor="middle" fill={D.muted} fontSize={10}>
        next hops = the VTEPs
      </text>
      <text x={130} y={156} textAnchor="middle" fill={D.muted} fontSize={10}>
        never the ESI itself
      </text>
    </DiagramSvg>
  );
}

function ModeDiagram() {
  return (
    <DiagramSvg h={170} label="The per-ES Single-Active flag decides how a remote PE uses the A-D routes: flag 0 means aliasing across all eligible PEs, flag 1 means one primary plus backup paths">
      <DRouteCard x={30} y={20} w={270} title="Single-Active flag 0" color={D.success} rows={[{ label: "segment mode", value: "All-Active" }, { label: "remote PE does", value: "aliasing (load-share)", strong: true }]} />
      <DRouteCard x={340} y={20} w={270} title="Single-Active flag 1" color={D.warning} rows={[{ label: "segment mode", value: "Single-Active" }, { label: "remote PE does", value: "primary + backup path", strong: true }]} />
      <text x={320} y={130} textAnchor="middle" fill={D.muted} fontSize={10}>
        read from the per-ES route&apos;s ESI Label community — the per-EVI route cannot tell you
      </text>
    </DiagramSvg>
  );
}

function ScaleDiagram() {
  return (
    <DiagramSvg h={180} label="Without mass withdrawal, N MAC routes behind the segment converge one by one; with it, one per-ES withdrawal updates all N next-hop sets">
      <DRouteCard x={30} y={20} w={270} title="Per-MAC convergence" color={D.warning} rows={[{ label: "signals", value: "one per MAC (N)" }, { label: "time grows with", value: "number of MACs" }]} />
      <DRouteCard x={340} y={20} w={270} title="Mass withdrawal" color={D.success} rows={[{ label: "signals", value: "one per-ES withdrawal" }, { label: "updates", value: "every dependent MAC" }]} />
      <text x={320} y={140} textAnchor="middle" fill={D.muted} fontSize={10}>
        a dependency comparison, not a claim about exact timings
      </text>
    </DiagramSvg>
  );
}

function HistoryDiagram() {
  return (
    <DiagramSvg h={170} label="After the processed per-ES withdrawal, LEAF1's Type 2 route may still exist in the table, but LEAF1 is not a usable next hop">
      <DRouteCard x={30} y={20} w={270} title="Route table (may remain)" color={D.faint} rows={[{ label: "Type 2", value: `${SERVER_A_MAC}` }, { label: "originator", value: "LEAF1" }]} />
      <DRouteCard x={340} y={20} w={270} title="Forwarding eligibility" color={D.success} rows={[{ label: "LEAF1", value: "NOT usable" }, { label: "LEAF2", value: "usable", strong: true }]} />
      <text x={320} y={130} textAnchor="middle" fill={D.muted} fontSize={10}>
        a route existing is not a next hop being usable
      </text>
    </DiagramSvg>
  );
}

function TimelineDiagram() {
  const box = (x: number, t: string, s: string, c: string) => (
    <g>
      <rect x={x} y={34} width={190} height={62} rx={10} fill={c} fillOpacity={0.12} stroke={c} strokeOpacity={0.75} />
      <text x={x + 95} y={58} textAnchor="middle" fill={D.text} fontSize={11} fontWeight={700}>
        {t}
      </text>
      <text x={x + 95} y={78} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        {s}
      </text>
    </g>
  );
  return (
    <DiagramSvg h={160} label="RFC 7432 example: T1 MAC route plus A-D routes from both PEs, traffic to both; T2 PE1 withdraws per-ES, traffic to PE2 only; a withdrawn MAC route alone would make the destination unknown">
      {box(14, "T1", "MAC route + A-D from both → both", D.success)}
      <DArrow x1={206} y1={65} x2={222} y2={65} color={D.faint} width={1.4} />
      {box(224, "T2", "PE1 per-ES withdrawn → PE2 only", D.warning)}
      <DArrow x1={416} y1={65} x2={432} y2={65} color={D.faint} width={1.4} />
      {box(434, "T2″ (contrast)", "MAC route withdrawn → unknown", D.faint)}
      <text x={320} y={128} textAnchor="middle" fill={D.muted} fontSize={10}>
        paraphrased from RFC 7432 §9.2.2
      </text>
    </DiagramSvg>
  );
}

export function EvpnAliasingDeepDiveContent() {
  return (
    <>
      <GuideSection id="dal-rule" eyebrow="Standard" title="The §8.4 rule" tone="bgp">
        <DiagramFrame caption="Per-EVI routes wait for the per-ES routes.">
          <RuleDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="dal-resolve" eyebrow="Control → data" title="Type 2 + A-D resolution" tone="violet">
        <DiagramFrame caption={`How LEAF3 turns one MAC into VTEP next hops (VNI ${VNI}).`}>
          <ResolveDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="dal-mode" eyebrow="Redundancy" title="Why All-Active matters" tone="warning">
        <DiagramFrame caption="The per-ES flag chooses aliasing or backup path.">
          <ModeDiagram />
        </DiagramFrame>
        <p>The per-ES route&apos;s ESI Label community carries the Single-Active flag. With the flag at 0 (All-Active) the remote PE load-balances across all eligible PEs (aliasing). With the flag at 1 it installs one primary and keeps the others as backup paths instead.</p>
      </GuideSection>

      <GuideSection id="dal-scale" eyebrow="Convergence" title="Mass withdrawal at scale" tone="success">
        <DiagramFrame caption="One signal instead of N.">
          <ScaleDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="dal-history" eyebrow="Model" title="Route history vs usability" tone="violet">
        <DiagramFrame caption="Keep the two views apart.">
          <HistoryDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="dal-timeline" eyebrow="Standard" title="RFC convergence timeline" tone="bgp">
        <DiagramFrame caption="The standard's own worked example.">
          <TimelineDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="dal-three" eyebrow="Model" title="DF vs aliasing vs mass withdrawal" tone="ip">
        <CompareCards
          items={[
            { title: "DF election", tone: "warning", tag: "BUM", points: ["Who delivers BUM onto the segment", "Driven by Type 4 routes", "Per ESI and EVI"] },
            { title: "Aliasing", tone: "success", tag: "known unicast", points: ["Which PEs may carry known unicast", "Per-EVI + All-Active per-ES", "Independent of the DF role"] },
            { title: "Mass withdrawal", tone: "danger", tag: "failure", points: ["Rapidly prunes a failed PE", "One per-ES withdrawal", "Applies to every MAC on the segment"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="dal-flows" eyebrow="Model" title="The flow abstraction" tone="violet">
        <Callout tone="cyan" title="A teaching device" icon="i">
          Real PEs hash per flow using packet fields; this lesson labels two flows A and B and maps them deterministically so the effect is visible. It is not any specific ASIC&apos;s algorithm, and packets of one flow do not alternate between PEs.
        </Callout>
      </GuideSection>

      <GuideSection id="dal-trouble" eyebrow="Operations" title="Troubleshooting" tone="warning">
        <ChecklistCard tone="warning" title="Ladder" mark="→" items={["Each PE's attachment to the segment.", "Underlay and BGP EVPN sessions.", "Type 2 route carrying the ESI.", "Per-EVI and per-ES routes from each PE.", "Single-Active flag on the per-ES routes.", "Eligible next-hop set actually applied in forwarding.", "Flows delivered through each eligible PE."]} />
      </GuideSection>

      <GuideSection id="dal-verify" eyebrow="Operations" title="Verification" tone="success">
        <ChecklistCard tone="success" title="Evidence" mark="✓" items={["Remote MAC entry lists every eligible VTEP.", "After a failure, the failed PE is gone from that list.", "Test flows reach the destination through the survivors."]} />
      </GuideSection>

      <GuideSection id="dal-glossary" eyebrow="Reference" title="Glossary" tone="cyan">
        <Glossary
          items={[
            { term: "Backup path", def: "Single-Active counterpart of aliasing — one primary, standby alternatives." },
            { term: "Eligible set", def: "The PEs a remote PE may currently forward known unicast to." },
            { term: "Next-hop adjacency", def: "The forwarding entry a withdrawal updates." },
          ]}
        />
      </GuideSection>

      <GuideSection id="dal-mental" eyebrow="Recap" title="Mental model" tone="success">
        <Callout tone="success" title="Recap" icon="✓">
          Aliasing needs both A-D forms, the per-ES route decides the mode, and its withdrawal — once applied — is the one signal that prunes a failed PE for the whole segment.
        </Callout>
      </GuideSection>
    </>
  );
}
