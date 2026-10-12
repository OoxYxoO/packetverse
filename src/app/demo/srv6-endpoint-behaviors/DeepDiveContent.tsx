import { CompareCards, DArrow, DIAGRAM as D, DNode, DPill, DiagramFrame, DiagramSvg, FailureSignatures, FieldTable, Glossary, GuideSection, Misconceptions, Mono, TroubleshootingFlow } from "@/components/lesson/GuideBlocks";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { ExplainIt, KnowledgeQuiz, PracticeBridge, type KnowledgeQuestion } from "@/components/lesson/GuideInteractive";
import { usePracticeLabOpener } from "@/components/lesson/FundamentalsLessonShell";
import { PresentationBridge } from "@/components/presentation/LessonPresentation";
import { CliPanel, FailureWalk } from "@/components/lesson/GuideCli";
import { DOC, createEbNet, ebTicket, ebTicketState, ebApply, type EbState, type EbTicketId } from "@/lib/sim-engine/scenarios/ebNet";
import { EbResult, ebCli, ebOnly } from "./LessonGuideContent";

const G = { foundation: "Foundation", transit: "Transit behaviors", decap: "Decapsulation", ops: "Operations", trouble: "Troubleshooting", master: "Master it" };
export const SRV6E_DEEP_DIVE_SECTIONS: LessonGuideSectionLink[] = [
  { id: "bd-pipeline", label: "The endpoint pipeline", group: G.foundation },
  { id: "bd-catalog", label: "The behavior catalog", group: G.foundation },
  { id: "bd-alloc", label: "Who allocates which SID", group: G.foundation },
  { id: "bd-nexthop", label: "End, End.X, End.T: next-hop treatment", group: G.transit },
  { id: "bd-flavors", label: "Flavors: PSP, USP, USD", group: G.transit },
  { id: "bd-decap", label: "The decapsulation family", group: G.decap },
  { id: "bd-dtdx", label: "DT vs DX in practice", group: G.decap },
  { id: "bd-rules", label: "Validity rules", group: G.decap },
  { id: "bd-dynamic", label: "Dynamic SIDs and renumbering", group: G.decap },
  { id: "bd-config", label: "Configuring it on IOS XR", group: G.ops },
  { id: "bd-verify", label: "How to verify", group: G.ops },
  { id: "bd-signatures", label: "Failure signatures", group: G.trouble },
  { id: "bd-ladder", label: "The troubleshooting ladder", group: G.trouble },
  { id: "bd-tickets", label: "Five faults, evidence to proof", group: G.trouble },
  { id: "bd-myths", label: "Common misconceptions", group: G.master },
  { id: "bd-quiz", label: "Knowledge check", group: G.master },
  { id: "bd-explain", label: "Can you explain it?", group: G.master },
  { id: "bd-glossary", label: "Glossary", group: G.master },
  { id: "bd-mental", label: "Mental model", group: G.master },
  { id: "bd-practice", label: "Practice in the SRv6 Endpoint Behaviors Lab", group: G.master },
];

// Real IOS XR output and test results: the SRv6 Endpoint Behaviors Lab's command set and model.
const E0: EbState = createEbNet(0);
const ticket = (id: EbTicketId) => ebTicket(id).repro.reduce((acc, a) => ebApply(acc, a), ebTicketState(id, 1));
const T = { perce: ticket("perce"), dt6af: ticket("dt6af"), vrfif: ticket("vrfif"), endx: ticket("endx"), locname: ticket("locname") };
const ENDATZERO = ebApply(E0, { type: "send", sids: [DOC.endR6], inner: "10.10.2.8" });

function LabBridge() {
  const openLab = usePracticeLabOpener();
  return (
    <PracticeBridge label="Open the SRv6 Endpoint Behaviors Lab" onPractice={openLab}>
      End, End.X and R6&apos;s service SIDs on IOS XR, test traffic to three customers, VRFs to break and fix — your own copy. Nothing you do there changes your lesson progress.
    </PracticeBridge>
  );
}

function PipelineDiagram() {
  return (
    <DiagramSvg h={200} label="Packet arrives; if the DA is not a local SID the node forwards it by FIB as transit; if it is, the bound behavior runs its checks and its action">
      <DNode x={90} y={50} label="packet in" sub="read IPv6 DA" accent={D.ip} w={130} />
      <DArrow x1={156} y1={50} x2={224} y2={50} color={D.faint} width={1.4} />
      <DNode x={300} y={50} label="DA in Local SID Table?" accent={D.cyan} w={150} />
      <DArrow x1={300} y1={72} x2={300} y2={120} color={D.faint} width={1.4} />
      <text x={310} y={100} fill={D.faint} fontSize={10} fontWeight={700}>
        no
      </text>
      <DNode x={300} y={144} label="transit" sub="ordinary IPv6 FIB" accent={D.faint} w={150} />
      <DArrow x1={376} y1={50} x2={444} y2={50} color={D.faint} width={1.4} label="yes" />
      <DNode x={530} y={50} label="bound behavior" sub="checks + action" accent={D.warning} w={160} />
      <DArrow x1={530} y1={72} x2={530} y2={120} color={D.faint} width={1.4} />
      <DNode x={530} y={144} label="SL / payload checks" sub="then advance or decap" accent={D.violet} w={170} />
    </DiagramSvg>
  );
}

function NextHopDiagram() {
  const cols = [
    { x: 120, t: "End", s: "FIB lookup on new DA", c: D.success },
    { x: 320, t: "End.X", s: "bound L3 adjacency", c: D.warning },
    { x: 520, t: "End.T", s: "lookup in bound table", c: D.ospf },
  ];
  return (
    <DiagramSvg h={150} label="All three advance the segment the same way; End uses the default FIB, End.X a bound adjacency, End.T a bound table">
      <DPill x={320} y={24} text="SL − 1 · DA ← Segment List[SL]  (identical for all three)" color={D.cyan} w={380} />
      {cols.map((c) => (
        <g key={c.t}>
          <DArrow x1={320} y1={38} x2={c.x} y2={74} color={D.faint} width={1.2} />
          <DNode x={c.x} y={100} label={c.t} sub={c.s} accent={c.c} w={170} />
        </g>
      ))}
    </DiagramSvg>
  );
}

function DecapDiagram() {
  const steps = [
    { t: "final segment?", c: D.danger },
    { t: "payload type ok?", c: D.warning },
    { t: "remove outer IPv6", c: D.violet },
    { t: "X: fixed neighbor / T: table", c: D.success },
  ];
  return (
    <DiagramSvg h={110} label="Decapsulation behaviors: check final segment, check payload type, remove the outer header, then cross-connect or look up">
      {steps.map((s, i) => (
        <g key={s.t}>
          <DPill x={82 + i * 158} y={40} text={s.t} color={s.c} w={148} />
          {i < steps.length - 1 && <DArrow x1={157 + i * 158} y1={40} x2={165 + i * 158} y2={40} color={D.faint} width={1.2} />}
        </g>
      ))}
      <text x={320} y={90} textAnchor="middle" fill={D.muted} fontSize={10}>
        a failed check discards the packet — the service action never runs
      </text>
    </DiagramSvg>
  );
}

function AllocationDiagram() {
  return (
    <DiagramSvg h={200} label="Per-CE allocation: one DX SID per attached CE. Per-VRF allocation: one DT SID for the whole VRF, and the lookup chooses the CE">
      <text x={160} y={20} textAnchor="middle" fill={D.warning} fontSize={11.5} fontWeight={700}>
        per-CE (DX)
      </text>
      {["CE-1", "CE-2", "CE-3"].map((ce, i) => (
        <g key={ce}>
          <DPill x={90} y={56 + i * 44} text={`SID ::${i + 1}`} color={D.warning} w={80} />
          <DArrow x1={132} y1={56 + i * 44} x2={196} y2={56 + i * 44} color={D.faint} width={1.2} />
          <DNode x={240} y={56 + i * 44} label={ce} accent={D.warning} w={80} h={30} />
        </g>
      ))}
      <text x={480} y={20} textAnchor="middle" fill={D.violet} fontSize={11.5} fontWeight={700}>
        per-VRF (DT)
      </text>
      <DPill x={380} y={100} text="one SID" color={D.violet} w={80} />
      <DArrow x1={422} y1={100} x2={460} y2={100} color={D.faint} width={1.2} />
      <DNode x={505} y={100} label="VRF" sub="lookup" accent={D.violet} w={80} />
      {["CE-1", "CE-2", "CE-3"].map((ce, i) => (
        <g key={`v-${ce}`}>
          <DArrow x1={546} y1={100} x2={570} y2={56 + i * 44} color={D.faint} width={1} />
          <text x={576} y={60 + i * 44} fill={D.text} fontSize={10}>
            {ce}
          </text>
        </g>
      ))}
      <text x={320} y={192} textAnchor="middle" fill={D.muted} fontSize={10}>
        fewer SIDs vs no lookup — an allocation choice, not a protocol requirement
      </text>
    </DiagramSvg>
  );
}

function FlavorsDiagram() {
  const rows = [
    { y: 42, t: "PSP", s: "penultimate endpoint removes the SRH after SL reaches 0", c: D.warning },
    { y: 82, t: "USP", s: "ultimate endpoint removes the SRH, then processes the next header", c: D.violet },
    { y: 122, t: "USD", s: "ultimate endpoint removes the outer header and processes the inner packet", c: D.success },
  ];
  return (
    <DiagramSvg h={160} label="Flavors: PSP removes the SRH at the penultimate endpoint, USP at the ultimate endpoint, USD decapsulates the outer header at the ultimate endpoint">
      <text x={320} y={18} textAnchor="middle" fill={D.muted} fontSize={10}>
        flavors modify End, End.X and End.T
      </text>
      {rows.map((r) => (
        <g key={r.t}>
          <DPill x={70} y={r.y} text={r.t} color={r.c} w={64} />
          <text x={116} y={r.y + 4} fill={D.text} fontSize={10.5}>
            {r.s}
          </text>
        </g>
      ))}
    </DiagramSvg>
  );
}


const QUIZ: KnowledgeQuestion[] = [
  { id: "q-x", prompt: "What does End.X change compared with End?", options: [{ id: "a", label: "Only the outgoing interface — the rewrite is the same" }, { id: "b", label: "It keeps Segments Left" }, { id: "c", label: "It decapsulates" }], correctId: "a", explanation: "Both decrement SL and copy the next SID into the DA; End.X forces the adjacency." },
  { id: "q-dt", prompt: "One End.DT4 SID, two customers in the VRF. How is the customer chosen?", options: [{ id: "a", label: "By looking the inner destination up in the VRF" }, { id: "b", label: "By the SID's function bits" }, { id: "c", label: "By the SRH tag" }], correctId: "a", explanation: "DT means decapsulate and look up." },
  { id: "q-dx", prompt: "A packet for 10.10.2.8 arrives with CE4-A's End.DX4 SID. Where does it go?", options: [{ id: "a", label: "To CE4-A" }, { id: "b", label: "To CE4-B" }, { id: "c", label: "Dropped by the lookup" }], correctId: "a", explanation: "DX does no lookup; the SID decides." },
  { id: "q-last", prompt: "End.DT4 SID with Segments Left 1. What does R6 do?", options: [{ id: "a", label: "Drop it" }, { id: "b", label: "Decapsulate" }, { id: "c", label: "Forward to the next segment" }], correctId: "a", explanation: "Decapsulation behaviors are valid only as the last segment." },
  { id: "q-alloc", prompt: "On IOS XR, what makes BGP allocate End.DX4 instead of End.DT4?", options: [{ id: "a", label: "alloc mode per-ce under the VRF address family" }, { id: "b", label: "A different locator" }, { id: "c", label: "IS-IS configuration" }], correctId: "a", explanation: "per-vrf → DT, per-ce → DX." },
  { id: "q-endx", prompt: "An IS-IS adjacency goes down. Its End.X SID…", options: [{ id: "a", label: "is withdrawn" }, { id: "b", label: "keeps working via another link" }, { id: "c", label: "becomes an End SID" }], correctId: "a", explanation: "End.X SIDs live and die with their adjacency." },
];

export function Srv6EndpointDeepDiveContent() {
  return (
    <div className="space-y-12">
      <GuideSection id="bd-pipeline" eyebrow="Foundation" title="The endpoint pipeline" tone="mpls">
        <DiagramFrame caption="Match the DA in the local SID table, check the rules, execute.">
          <PipelineDiagram />
        </DiagramFrame>
        <p>When a packet arrives, a node matches its destination address in the local SID table. No match: it is either ordinary transit (another node&apos;s locator) or, inside its own locator, an error. A match selects the behavior; the behavior checks its preconditions (Segments Left, the next header) and then executes: rewrite and forward, or decapsulate and deliver.</p>
      </GuideSection>

      <GuideSection id="bd-catalog" eyebrow="Foundation" title="The behavior catalog" tone="violet">
        <FieldTable
          title="RFC 8986 endpoint behaviors (selection)"
          accent="violet"
          columns={["Behavior", "Does", "Typical source"]}
          rows={[
            ["End", "next segment, route on it", "IGP (node SID)"],
            ["End.X", "next segment, send out an adjacency", "IGP (per adjacency)"],
            ["End.T", "next segment, look it up in a given table", "rarely deployed"],
            ["End.DT4 / DT6 / DT46", "decapsulate, look up in a VRF", "BGP L3VPN, per VRF"],
            ["End.DX4 / DX6", "decapsulate, send to one CE", "BGP L3VPN, per CE"],
            ["End.DX2 / DT2U / DT2M", "decapsulate, L2 cross-connect / bridge", "EVPN"],
            ["End.B6.Encaps(.Red)", "binding SID: apply an SR policy", "SR-TE"],
          ]}
        />
      </GuideSection>

      <GuideSection id="bd-alloc" eyebrow="Foundation" title="Who allocates which SID" tone="cyan">
        <DiagramFrame caption="The IGP owns topology SIDs, services own service SIDs.">
          <AllocationDiagram />
        </DiagramFrame>
        <p>On IOS XR every SID is a function under a locator. IS-IS allocates End and End.X when the locator is enabled in IS-IS; BGP allocates DT and DX SIDs for VRFs; EVPN allocates its own. The owner column of the SID table says who:</p>
        <CliPanel run={ebCli(E0, "R6", "show segment-routing srv6 sid")} caption="IOS XR · R6 — owners isis-CORE and bgp-65000" />
      </GuideSection>

      <GuideSection id="bd-nexthop" eyebrow="Transit behaviors" title="End, End.X, End.T: next-hop treatment" tone="success">
        <DiagramFrame caption="Same SL/DA rewrite, three ways to pick the next hop.">
          <NextHopDiagram />
        </DiagramFrame>
        <p>All three decrement Segments Left and copy the next SID into the DA. End then routes the new DA in the main table; End.X sends it out of the adjacency bound to the SID; End.T looks it up in another table. With no segment left, End and End.X have nothing to move on to — the packet would have to be for the node itself:</p>
        <EbResult s={ENDATZERO} title="The lab: R6's End SID as the only segment, with a customer packet inside" />
      </GuideSection>

      <GuideSection id="bd-flavors" eyebrow="Transit behaviors" title="Flavors: PSP, USP, USD" tone="warning">
        <DiagramFrame caption="Where the SRH and the outer header are removed.">
          <FlavorsDiagram />
        </DiagramFrame>
        <p>IOS XR allocates End and End.X with PSP and USD: the node that brings Segments Left to 0 removes the SRH, and End at the last segment can decapsulate. Service behaviors always decapsulate.</p>
      </GuideSection>

      <GuideSection id="bd-decap" eyebrow="Decapsulation" title="The decapsulation family" tone="violet">
        <DiagramFrame caption="Remove the outer header, then look up or send.">
          <DecapDiagram />
        </DiagramFrame>
        <FieldTable
          title="Decapsulation behaviors"
          accent="violet"
          columns={["Behavior", "Inner", "Then"]}
          rows={[
            ["End.DT4", "IPv4", "look up in the VRF's IPv4 table"],
            ["End.DT6", "IPv6", "look up in the VRF's IPv6 table"],
            ["End.DT46", "IPv4 or IPv6", "look up in the matching table"],
            ["End.DX4", "IPv4", "send to the bound CE next hop"],
            ["End.DX6", "IPv6", "send to the bound CE next hop"],
            ["End.DX2", "Ethernet", "send out the bound attachment circuit"],
          ]}
        />
      </GuideSection>

      <GuideSection id="bd-dtdx" eyebrow="Decapsulation" title="DT vs DX in practice" tone="warning">
        <CompareCards
          items={[
            { title: "DT (per VRF)", tone: "mpls", tag: "one SID per VRF", points: ["fewer SIDs, more lookups", "the VRF table decides"] },
            { title: "DX (per CE)", tone: "warning", tag: "one SID per CE", points: ["no lookup on egress", "the SID decides — even if wrong"] },
          ]}
        />
        <p>Per-VRF is the usual choice; per-CE saves the egress lookup and can carry CE-specific treatment, at the cost of one SID per CE and no safety net if the wrong SID is used.</p>
        <EbResult s={T.perce} title="The lab: the documented CUST4 SID after the switch to per-CE" />
      </GuideSection>

      <GuideSection id="bd-rules" eyebrow="Decapsulation" title="Validity rules" tone="danger">
        <FieldTable
          title="What makes R6 drop instead of execute"
          accent="danger"
          columns={["Check", "Fails when"]}
          rows={[
            ["Final segment", "a DT/DX SID arrives with Segments Left > 0"],
            ["Next header", "the inner packet isn't the family the behavior handles"],
            ["Lookup", "DT: the VRF has no route for the inner destination"],
            ["Local SID", "the DA is in the node's locator but matches no SID"],
          ]}
        />
      </GuideSection>

      <GuideSection id="bd-dynamic" eyebrow="Decapsulation" title="Dynamic SIDs and renumbering" tone="cyan">
        <p>IOS XR allocates functions dynamically, in order. A change that removes or adds SIDs — an adjacency, a VRF mode, a locator name — can shift the numbers of the others. In production headends learn service SIDs from BGP updates, so this is invisible; a runbook or a static list breaks. The lab&apos;s locator-name ticket shows it: CUST4 lost its SID and CUST6&apos;s End.DT6 took …:6:42::.</p>
        <CliPanel run={ebCli(T.locname, "R6", "show segment-routing srv6 sid")} caption="IOS XR · R6 — after VRF CUST4 lost its locator: End.DT6 now at …:6:42::" />
      </GuideSection>

      <GuideSection id="bd-config" eyebrow="Operations" title="Configuring it on IOS XR" tone="mpls">
        <CliPanel run={ebOnly(E0, "R6", "show running-config router bgp", /router bgp|vrf CUST|rd |address-family|segment-routing srv6|locator|alloc mode|redistribute/)} caption="IOS XR · R6 — SRv6 under each VRF address family" />
        <FieldTable
          title="The statements"
          accent="mpls"
          columns={["Statement", "Where", "Effect"]}
          rows={[
            [<Mono key="1">segment-routing srv6 locator MAIN</Mono>, "router isis → address-family ipv6", "End and End.X SIDs"],
            [<Mono key="2">segment-routing srv6 → locator MAIN</Mono>, "router bgp → vrf → address-family", "service SIDs for the VRF"],
            [<Mono key="3">alloc mode per-vrf</Mono>, "same", "one End.DT4/DT6 per VRF"],
            [<Mono key="4">alloc mode per-ce</Mono>, "same", "one End.DX4/DX6 per CE"],
            [<Mono key="5">vrf CUST4</Mono>, "the CE interface", "put the customer in the VRF table"],
          ]}
        />
      </GuideSection>

      <GuideSection id="bd-verify" eyebrow="Operations" title="How to verify" tone="success">
        <FieldTable
          title="Verification on IOS XR"
          accent="success"
          columns={["Question", "Command"]}
          rows={[
            ["Every SID and behavior", <Mono key="1">show segment-routing srv6 sid</Mono>],
            ["One SID's context", <Mono key="2">show segment-routing srv6 sid &lt;sid&gt; detail</Mono>],
            ["VRF allocation", <Mono key="3">show bgp vrf &lt;vrf&gt; ipv4|ipv6 unicast</Mono>],
            ["VRF contents", <Mono key="4">show route vrf &lt;vrf&gt; · show vrf all</Mono>],
            ["Adjacencies behind End.X", <Mono key="5">show isis adjacency</Mono>],
          ]}
        />
        <CliPanel run={ebCli(E0, "R6", "show bgp vrf CUST4 ipv4 unicast")} caption="IOS XR · R6 — CUST4's routes and their SID" />
      </GuideSection>

      <GuideSection id="bd-signatures" eyebrow="Troubleshooting" title="Failure signatures" tone="danger">
        <FailureSignatures
          items={[
            { tag: "CE", title: "Per-CE by mistake", tone: "danger", points: ["documented SID is a DX", "wrong customer"] },
            { tag: "AF", title: "VRF without SRv6", tone: "danger", points: ["no service SID"] },
            { tag: "VRF", title: "CE out of VRF", tone: "warning", points: ["DT runs, no route"] },
            { tag: "X", title: "Adjacency down", tone: "violet", points: ["End.X SID withdrawn"] },
            { tag: "LOC", title: "Missing locator", tone: "warning", points: ["no SID, others shift"] },
            { tag: "SL", title: "Service SID not last", tone: "danger", points: ["dropped at the service node"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="bd-ladder" eyebrow="Troubleshooting" title="The troubleshooting ladder" tone="danger">
        <TroubleshootingFlow
          steps={[
            { question: "Where did the packet die — or who received it?", look: "The test result and headers." },
            { question: "Which behavior is each SID now?", look: "show segment-routing srv6 sid on each owner." },
            { question: "Is the service SID last?", look: "Read the segment list." },
            { question: "Does the inner family match?", look: "IPv4 for DT4/DX4, IPv6 for DT6/DX6." },
            { question: "What does the VRF allocate, and what is in it?", look: "show bgp vrf, show route vrf." },
            { question: "Are the adjacencies behind End.X up?", look: "show isis adjacency." },
          ]}
        />
      </GuideSection>

      <GuideSection id="bd-tickets" eyebrow="Troubleshooting" title="Five faults, evidence to proof" tone="danger">
        <FailureWalk title="1 · The wrong customer" normal="VRF CUST4 allocates per VRF: End.DT4 at …:6:42::." change="A template set alloc mode per-ce." evidence={<CliPanel run={ebOnly(T.perce, "R6", "show segment-routing srv6 sid", /End\.D/)} caption="IOS XR · R6 — End.DX4 per CE; …:42:: is CE4-A's" />} next="The documented SID now cross-connects to CE4-A." fix={<Mono>R6: router bgp 65000 vrf CUST4 address-family ipv4 unicast segment-routing srv6 → alloc mode per-vrf → commit</Mono>} proof="…:6:42:: is End.DT4 again; 10.10.2.8 reaches CE4-B." />
        <FailureWalk title="2 · No SID for CUST6" normal="CUST6 allocates End.DT6." change="The re-created VRF has no SRv6 under its address family." evidence={<CliPanel run={ebOnly(T.dt6af, "R6", "show bgp vrf CUST6 ipv6 unicast", /SRv6 locator/)} caption="IOS XR · R6 — no SRv6 locator for CUST6" />} next="No End.DT6; the address is dropped at R6." fix={<Mono>R6: … vrf CUST6 address-family ipv6 unicast segment-routing srv6 → locator MAIN → commit</Mono>} proof="End.DT6 exists; CE6 is reached." />
        <FailureWalk title="3 · CE4-B outside the VRF" normal="CE4-B's interface is in VRF CUST4." change="The port move lost vrf CUST4." evidence={<CliPanel run={ebOnly(T.vrfif, "R6", "show vrf all", /Interfaces|Gigabit/)} caption="IOS XR · R6 — Gi0/0/0/4 in the default table" />} next="End.DT4 runs and finds no route for 10.10.2.8." fix={<Mono>R6: interface Gi0/0/0/4 → vrf CUST4 → commit</Mono>} proof="10.10.2.0/24 in CUST4; CE4-B reached." />
        <FailureWalk title="4 · End.X gone with its link" normal="R3 has End.X toward R4." change="R3's interface to R4 left IS-IS." evidence={<CliPanel run={ebOnly(T.endx, "R3", "show segment-routing srv6 sid", /End\.X/)} caption="IOS XR · R3 — no End.X toward R4" />} next="The first segment no longer exists; dropped at R3." fix={<Mono>R3: router isis CORE → interface Gi0/0/0/2 → address-family ipv6 unicast → commit</Mono>} proof="End.X toward R4 back; the cross-link path works." />
        <FailureWalk title="5 · A locator that isn't there" normal="CUST4 allocates from MAIN." change="It now says locator MAIN6." evidence={<CliPanel run={ebOnly(T.locname, "R6", "show bgp vrf CUST4 ipv4 unicast", /SRv6 locator/)} caption="IOS XR · R6 — locator MAIN6 does not exist" />} next="No CUST4 SID; CUST6's End.DT6 shifted onto the documented number." fix={<Mono>R6: … vrf CUST4 … segment-routing srv6 → locator MAIN → commit</Mono>} proof="End.DT4 at …:6:42:: again; CE4-A reached." />
      </GuideSection>

      <GuideSection id="bd-myths" eyebrow="Master it" title="Common misconceptions" tone="warning">
        <Misconceptions
          items={[
            { myth: "The function bits mean the same everywhere.", correction: "Only the owner's local SID table gives them meaning." },
            { myth: "End.X is a different kind of rewrite.", correction: "Same rewrite as End; only the next hop is fixed." },
            { myth: "A DX SID checks the destination.", correction: "It never looks; the SID alone picks the CE." },
            { myth: "A service SID can sit anywhere in the list.", correction: "Decapsulation must be the last segment." },
            { myth: "SIDs are stable numbers.", correction: "Dynamic SIDs can be renumbered by configuration changes." },
          ]}
        />
      </GuideSection>

      <GuideSection id="bd-quiz" eyebrow="Master it" title="Knowledge check" tone="cyan">
        <KnowledgeQuiz questions={QUIZ} />
      </GuideSection>

      <GuideSection id="bd-explain" eyebrow="Master it" title="Can you explain it?" tone="violet">
        <ExplainIt
          items={[
            { q: "Why does [R3 End.X → R4, CUST4] take the cross-link?", a: "End.X sends the rewritten packet out of R3's adjacency to R4, regardless of routing." },
            { q: "Why can one DT4 SID serve CE4-A and CE4-B?", a: "It decapsulates and looks the inner destination up in VRF CUST4." },
            { q: "How did a packet for CE4-B end up at CE4-A?", a: "Per-CE allocation renumbered the SIDs; the documented one became CE4-A's End.DX4, which never looks." },
            { q: "Why is [CUST4, R3 End] dropped?", a: "The DT4 SID arrived with a segment left; decapsulation must be last." },
            { q: "What is the difference between a missing SID and a missing route behind a SID?", a: "Missing SID: dropped as an unknown address in the locator. Missing route: the behavior runs, the VRF lookup fails." },
          ]}
        />
      </GuideSection>

      <GuideSection id="bd-glossary" eyebrow="Master it" title="Glossary" tone="cyan">
        <Glossary
          items={[
            { term: "Local SID table", def: "A node's SIDs and their behaviors." },
            { term: "End.X", def: "Next segment, out a bound adjacency." },
            { term: "End.DT4/DT6/DT46", def: "Decapsulate and look up in a VRF." },
            { term: "End.DX4/DX6/DX2", def: "Decapsulate and send to a bound CE / circuit." },
            { term: "Per-VRF / per-CE", def: "IOS XR allocation modes for VRF SIDs." },
            { term: "Dynamic SID", def: "A function allocated from a pool, in order; may renumber." },
          ]}
        />
      </GuideSection>

      <GuideSection id="bd-mental" eyebrow="Master it" title="Mental model" tone="violet">
        <p>The locator is the building, the function is an extension number, and the local SID table is the reception desk&apos;s list: forward the call, forward it down a particular corridor, put it through to a company switchboard, or ring one desk directly.</p>
      </GuideSection>

      <GuideSection id="bd-practice" eyebrow="Master it" title="Practice in the SRv6 Endpoint Behaviors Lab" tone="violet">
        <p>Six Learn levels, then the workspace: every router&apos;s SID table, R6&apos;s VRFs and alloc mode, an IOS XR console, test traffic to three customers, five challenges and the five tickets above.</p>
        <LabBridge />
        <PresentationBridge>Rewatch the SRv6 Endpoint Behaviors presentation.</PresentationBridge>
      </GuideSection>
    </div>
  );
}
