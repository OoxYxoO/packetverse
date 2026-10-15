import type { BriefingPhaseDef, BriefingStepNote } from "@/components/lesson/briefing";
import { Callout, CompareCards, FieldTable, Glossary, GuideSection, Misconceptions, Mono, TroubleshootingFlow } from "@/components/lesson/GuideBlocks";
import { CliPair, CliPanel } from "@/components/lesson/GuideCli";
import { ExplainIt, KnowledgeQuiz, type KnowledgeQuestion } from "@/components/lesson/GuideInteractive";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { createOdState, fullMesh, ospfDrSteps, routerId, withDr, type OdState } from "@/lib/sim-engine/scenarios/ccna/ospfDr";
import { showNeighbors } from "./OdPanel";

export const OD_BRIEFING_PHASES: BriefingPhaseDef[] = [
  { phase: { label: "Router ID", tone: "cyan" }, objective: "Name every router uniquely.", steps: ["intro", "predict-rid", "router-id", "why-dr"] },
  { phase: { label: "Election", tone: "violet" }, objective: "Watch hellos elect a DR and BDR.", steps: ["hello", "predict-election", "election", "predict-adjacencies", "adjacencies"] },
  { phase: { label: "Life on the segment", tone: "ip" }, objective: "Flooding through the DR, newcomers, and point-to-point.", steps: ["flood", "predict-late", "late-joiner", "p2p"] },
  { phase: { label: "Incident", tone: "danger" }, objective: "A replacement router. One LAN disappears.", steps: ["fault-injected", "inc-missing"] },
  { phase: { label: "Diagnose", tone: "danger" }, objective: "Diagnosis pending.", steps: ["trouble-question", "diagnostic-layers"] },
  { phase: { label: "Repair pending", tone: "warning" }, objective: "Choose the change that fixes the cause you identified.", steps: ["repair-challenge"] },
  { phase: { label: "Verify", tone: "success" }, objective: "Prove R3's LAN is back everywhere.", steps: ["verify"] },
  { phase: { label: "Complete", tone: "success" }, objective: "Router IDs, DR/BDR, FULL and 2-WAY.", steps: ["complete"] },
];
export const OD_BRIEFING_NOTES: Partial<Record<string, BriefingStepNote>> = {
  "why-dr": { takeaway: "A DR turns n(n−1)/2 adjacencies into 2n − 3." },
  hello: { takeaway: "Area, timers, subnet and authentication must match." },
  flood: { takeaway: "224.0.0.6 reaches the DR and BDR; 224.0.0.5 reaches everyone." },
  p2p: { takeaway: "Point-to-point links skip the election." },
  "fault-injected": { doingNow: "A configuration pasted from another router." },
  "trouble-question": { doingNow: "Diagnosis pending." },
  "repair-challenge": { doingNow: "Choose the change that fixes the cause you identified." },
  verify: { takeaway: "Router IDs must be unique across the OSPF domain." },
};

export const OD_LESSON_SECTIONS: LessonGuideSectionLink[] = [
  { id: "odl-mission", label: "What this lesson teaches" },
  { id: "odl-rid", label: "Choosing the router ID" },
  { id: "odl-why", label: "Why a DR" },
  { id: "odl-elect", label: "The election rules" },
  { id: "odl-states", label: "FULL and 2-WAY" },
  { id: "odl-types", label: "Network types" },
  { id: "odl-config", label: "Configure and verify" },
  { id: "odl-incident", label: "The incident and the fix" },
  { id: "odl-glossary", label: "Glossary" },
];
export const OD_DEEP_SECTIONS: LessonGuideSectionLink[] = [
  { id: "odd-states", label: "The full neighbour state machine" },
  { id: "odd-match", label: "What must match" },
  { id: "odd-myths", label: "Misconceptions" },
  { id: "odd-explain", label: "Explain it" },
  { id: "odd-quiz", label: "Check yourself" },
];

function stateAt(stepId: string): OdState {
  let s = createOdState();
  for (const st of ospfDrSteps) {
    s = st.run?.(s).state ?? s;
    if (st.id === stepId) break;
  }
  return s;
}

export function OdLessonGuideContent() {
  const s0 = createOdState();
  return (
    <>
      <GuideSection id="odl-mission" eyebrow="Mission" title="What this lesson teaches">
        <p>Four routers on one Ethernet segment: choose their router IDs, watch them elect a designated router and a backup, see who becomes FULL with whom — and fix a pasted configuration that made one router invisible.</p>
        <Callout tone="violet" title="CCNA 3.4">Configure and verify single-area OSPFv2: neighbour adjacencies, point-to-point, broadcast (DR/BDR selection) and router ID.</Callout>
      </GuideSection>
      <GuideSection id="odl-rid" eyebrow="Router ID" title="Choosing the router ID">
        <FieldTable
          title="Computed for the lesson's routers"
          columns={["Router", "router-id cmd", "Loopback", "Interfaces", "Router ID"]}
          rows={s0.routers.slice(0, 4).map((r) => [r.id, r.routerIdCfg ?? "—", r.loopback ?? "—", r.ifaces.join(", "), `${routerId(r).rid} (${routerId(r).how})`])}
        />
        <p>The router ID is chosen when the OSPF process starts; changing addresses later doesn&apos;t change it until the process restarts (<Mono>clear ip ospf process</Mono>).</p>
      </GuideSection>
      <GuideSection id="odl-why" eyebrow="Scale" title="Why a DR">
        <FieldTable
          title="Adjacencies on one segment"
          columns={["Routers", "Full mesh n(n−1)/2", "With DR + BDR (2n − 3)"]}
          rows={[2, 4, 6, 10, 20].map((k) => [String(k), String(fullMesh(k)), String(withDr(k))])}
        />
      </GuideSection>
      <GuideSection id="odl-elect" eyebrow="Election" title="The election rules">
        <ol className="list-decimal space-y-1 pl-5">
          <li>Highest interface priority wins (default 1, range 0–255).</li>
          <li>Tie: highest router ID.</li>
          <li>Priority 0: never DR or BDR.</li>
          <li>Non-preemptive: an elected DR stays until it fails.</li>
        </ol>
      </GuideSection>
      <GuideSection id="odl-states" eyebrow="States" title="FULL and 2-WAY">
        <CliPair cisco={showNeighbors(stateAt("adjacencies"), "R1")} junos={showNeighbors(stateAt("adjacencies"), "R4")} ciscoCaption="R1 (DR) sees everyone FULL" junosCaption="R4 (DROTHER): FULL to DR/BDR, 2-WAY to R3" />
      </GuideSection>
      <GuideSection id="odl-types" eyebrow="Types" title="Network types">
        <CompareCards
          items={[
            { title: "Broadcast", tone: "violet", tag: "Ethernet default", points: ["DR/BDR election", "Hello 10 s, dead 40 s", "224.0.0.5 and 224.0.0.6"] },
            { title: "Point-to-point", tone: "success", tag: "serial, or configured on Ethernet", points: ["No election", "FULL with the single neighbour", "Common on router-to-router Ethernet links"] },
          ]}
        />
      </GuideSection>
      <GuideSection id="odl-config" eyebrow="Configure" title="Configure and verify">
        <CliPair
          cisco={{ prompt: "R3(config)#", command: "router ospf 1", output: " router-id 3.3.3.3\n network 10.0.0.0 0.0.0.255 area 0\n network 192.168.30.0 0.0.0.255 area 0\ninterface GigabitEthernet0/0\n ip ospf priority 1\n!\nR3# show ip ospf interface brief\nR3# show ip ospf neighbor" }}
          junos={{ prompt: "admin@R4# ", command: "set routing-options router-id 4.4.4.4", output: "set protocols ospf area 0 interface ge-0/0/0 priority 0\nset protocols ospf area 0 interface ge-0/0/1 passive\nadmin@R4> show ospf neighbor" }}
        />
      </GuideSection>
      <GuideSection id="odl-incident" eyebrow="Incident" title="The incident and the fix" tone="danger">
        <TroubleshootingFlow
          steps={[
            { question: "Is the neighbour listed at all?", look: <Mono>show ip ospf neighbor</Mono> },
            { question: "What do the logs say?", look: "%OSPF-4-DUP_RTRID_NBR — duplicate router ID." },
            { question: "Which router IDs are in use?", look: <Mono>show ip protocols</Mono> },
          ]}
        />
        <CliPanel run={{ prompt: "R3(config-router)#", command: "router-id 3.3.3.3", output: "% OSPF: Reload or use \"clear ip ospf process\" command, for this to take effect\nR3# clear ip ospf process\nReset ALL OSPF processes? [no]: yes" }} />
      </GuideSection>
      <GuideSection id="odl-glossary" eyebrow="Words" title="Glossary">
        <Glossary
          items={[
            { term: "Router ID", def: "A unique 32-bit name for an OSPF router, written like an IPv4 address." },
            { term: "DR / BDR", def: "Designated router and its backup on a multi-access segment." },
            { term: "DROTHER", def: "Any router on the segment that isn't DR or BDR." },
            { term: "FULL / 2-WAY", def: "Databases synchronised / hellos seen in both directions only." },
            { term: "224.0.0.5 / 224.0.0.6", def: "All OSPF routers / DR and BDR." },
          ]}
        />
      </GuideSection>
    </>
  );
}

const QUIZ: KnowledgeQuestion[] = [
  { id: "odd-q1", prompt: "Two routers on Ethernet stay in EXSTART. Most common cause?", options: [{ id: "mtu", label: "Interface MTU mismatch" }, { id: "prio", label: "Both have priority 0" }, { id: "rid", label: "Router IDs too low" }], correctId: "mtu", explanation: "Database description packets carry the MTU; if they differ, the exchange never completes." },
  { id: "odd-q2", prompt: "All routers on a segment have priority 0. What happens?", options: [{ id: "none", label: "No DR is elected; DROTHERs stay 2-WAY and no full adjacencies form" }, { id: "rid", label: "The highest router ID wins" }], correctId: "none", explanation: "With nobody eligible there is no DR, so routers never synchronise on that segment." },
];

export function OdDeepDiveContent() {
  return (
    <>
      <GuideSection id="odd-states" eyebrow="States" title="The full neighbour state machine">
        <p>Down → Init (heard a hello) → 2-Way (saw my RID in their hello; election happens here) → ExStart (master/slave) → Exchange (DBDs) → Loading (LSRs/LSUs) → Full.</p>
      </GuideSection>
      <GuideSection id="odd-match" eyebrow="Match" title="What must match">
        <FieldTable
          title="Neighbour requirements"
          columns={["Must match", "Symptom when it doesn't"]}
          rows={[
            ["Area ID", "No neighbour; log shows mismatched area"],
            ["Hello / dead timers", "No neighbour"],
            ["Subnet and mask (broadcast)", "No neighbour"],
            ["Authentication", "No neighbour"],
            ["MTU", "Stuck in EXSTART/EXCHANGE"],
            ["Unique router ID", "Duplicate warnings, missing routes"],
            ["Network type", "FULL but routes missing or odd next hops"],
          ]}
        />
      </GuideSection>
      <GuideSection id="odd-myths" eyebrow="Misconceptions" title="Misconceptions">
        <Misconceptions
          items={[
            { myth: "2-WAY means a broken adjacency.", correction: "Between DROTHERs it is the correct final state." },
            { myth: "The highest router ID always becomes DR.", correction: "Priority comes first; router ID only breaks ties — and the election isn't preemptive." },
          ]}
        />
      </GuideSection>
      <GuideSection id="odd-explain" eyebrow="Explain" title="Explain it">
        <ExplainIt items={[{ q: "Why does R5, with priority 255, not become DR?", a: "The election already happened; OSPF doesn't preempt an existing DR. R5 waits until the DR and BDR fail." }]} />
      </GuideSection>
      <GuideSection id="odd-quiz" eyebrow="Quiz" title="Check yourself">
        <KnowledgeQuiz questions={QUIZ} />
      </GuideSection>
    </>
  );
}
