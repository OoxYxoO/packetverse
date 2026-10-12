import { Callout, DArrow, DIAGRAM as D, DNode, DiagramFrame, DiagramSvg, FailureSignatures, FieldTable, Glossary, GuideSection, Misconceptions, Mono, TroubleshootingFlow } from "@/components/lesson/GuideBlocks";
import { DHeaderColumn } from "@/components/lesson/Srv6GuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { REQUIREMENT_MATRIX, USD_ALTERNATIVE } from "./guideModel";
import { ExplainIt, KnowledgeQuiz, PracticeBridge, type KnowledgeQuestion } from "@/components/lesson/GuideInteractive";
import { usePracticeLabOpener } from "@/components/lesson/FundamentalsLessonShell";
import { PresentationBridge } from "@/components/presentation/LessonPresentation";
import { CliPanel, FailureWalk } from "@/components/lesson/GuideCli";
import { createDNet, dApply, lossText, type DState } from "@/lib/sim-engine/scenarios/dpNet";
import { DpResult, TO_SRV6, dpBlock, dpCli, dpOnly, dpSet, dpTicketRun, dpWith } from "./LessonGuideContent";

const G2 = { foundation: "Foundation", forwarding: "Forwarding", services: "Services", protection: "Protection", design: "Design", ops: "Operations", trouble: "Troubleshooting", master: "Master it" };
export const SRCMP_DEEP_DIVE_SECTIONS: LessonGuideSectionLink[] = [
  { id: "md-arch", label: "One architecture, two encodings", group: G2.foundation },
  { id: "md-anatomy", label: "Label vs SID anatomy", group: G2.foundation },
  { id: "md-ids", label: "SID spaces: SRGB, SRLB, locators", group: G2.foundation },
  { id: "md-lfib", label: "SR-MPLS forwarding: the LFIB", group: G2.forwarding },
  { id: "md-srv6fwd", label: "SRv6 forwarding: route or execute", group: G2.forwarding },
  { id: "md-adj", label: "Adjacency scope", group: G2.forwarding },
  { id: "md-usd", label: "An extra steering SID", group: G2.forwarding },
  { id: "md-vpn", label: "VPN signaling: label vs service SID", group: G2.services },
  { id: "md-control", label: "Control plane", group: G2.services },
  { id: "md-tilfa", label: "TI-LFA in both encodings", group: G2.protection },
  { id: "md-mtu", label: "Header cost and MTU", group: G2.design },
  { id: "md-migration", label: "Coexistence and migration", group: G2.design },
  { id: "md-matrix", label: "Requirement matrix", group: G2.design },
  { id: "md-config", label: "Configuring both on IOS XR", group: G2.ops },
  { id: "md-verify", label: "How to verify", group: G2.ops },
  { id: "md-signatures", label: "Failure signatures", group: G2.trouble },
  { id: "md-ladder", label: "The troubleshooting ladder", group: G2.trouble },
  { id: "md-tickets", label: "Five faults, evidence to proof", group: G2.trouble },
  { id: "md-myths", label: "Common misconceptions", group: G2.master },
  { id: "md-quiz", label: "Knowledge check", group: G2.master },
  { id: "md-explain", label: "Can you explain it?", group: G2.master },
  { id: "md-glossary", label: "Glossary", group: G2.master },
  { id: "md-mental", label: "Mental model", group: G2.master },
  { id: "md-practice", label: "Practice in the SR-MPLS vs SRv6 Lab", group: G2.master },
];

// Real IOS XR output and traffic results: the SR-MPLS vs SRv6 Lab's command set and model.
const D0: DState = createDNet(0);
const S6: DState = dApply(D0, TO_SRV6);
const T = { locator: dpTicketRun("locator"), p2mpls: dpTicketRun("p2mpls"), p4srv6: dpTicketRun("p4srv6"), mtu: dpTicketRun("mtu"), nosid: dpTicketRun("nosid") };
const DRILLS = [false, true].map((srv6) => [100, 1460].map((size) => dApply(srv6 ? S6 : D0, { type: "drill", size }).tests[0]));
const MTU_M = [dpSet("P1 mtu", "P1", (c) => void (c.mtu["ge-0/0/2"] = 1514)), dpSet("P3 mtu", "P3", (c) => void (c.mtu["ge-0/0/0"] = 1514)), { type: "drill", size: 1460 } as const].reduce((s, a) => dApply(s, a), D0);

function LabBridge() {
  const openLab = usePracticeLabOpener();
  return (
    <PracticeBridge label="Open the SR-MPLS vs SRv6 Lab" onPractice={openLab}>
      Both data planes on IOS XR: labels and SIDs, PE2&apos;s VRF plane, MTUs, P1–P2 drills, the two encodings compared from the live network, five tickets — your own copy. Nothing you do there changes your lesson progress.
    </PracticeBridge>
  );
}

const QUIZ: KnowledgeQuestion[] = [
  { id: "q1", prompt: "PE2 is index 6 and every router uses SRGB 16000. Which label does P1 swap 16006 to toward P2?", options: [{ id: "a", label: "16006" }, { id: "b", label: "a label P2 chose" }, { id: "c", label: "9002" }], correctId: "a", explanation: "Same index, same SRGB everywhere: the Node SID label is the same at every hop." },
  { id: "q2", prompt: "P2 stops running SR-MPLS but keeps IS-IS. What happens to CUST-A over SRv6 through P2?", options: [{ id: "a", label: "Nothing — P2 only routes the IPv6 destination" }, { id: "b", label: "It is dropped at P2" }, { id: "c", label: "It takes the P3/P4 path" }], correctId: "a", explanation: "SRv6 transit needs only an IPv6 route to the owner's locator." },
  { id: "q3", prompt: "Which single fact makes the TI-LFA repair need two instructions in both planes?", options: [{ id: "a", label: "P4's own shortest path to P2 runs back through P1" }, { id: "b", label: "P3 can't forward" }, { id: "c", label: "PE2 is dual-homed" }], correctId: "a", explanation: "Reach P4 first (Node SID / its locator), then force P4→P2 (Adj-SID / End.X)." },
  { id: "q4", prompt: "BGP has CUST-A's route with an SRv6 SID, the next hop pings, the RT matches — and PE1 installs nothing. First thing to check?", options: [{ id: "a", label: "A route to the SID's locator" }, { id: "b", label: "The RD" }, { id: "c", label: "PE2's MPLS labels" }], correctId: "a", explanation: "The SID is only usable if the locator that contains it is reachable." },
  { id: "q5", prompt: "A 1460-byte packet on a path whose backup link has a 1500-byte IP MTU. Which plane survives a P1–P2 cut?", options: [{ id: "a", label: `SR-MPLS (${1460 + DRILLS[0][1].walk.peakOverhead} B)` }, { id: "b", label: `SRv6 (${1460 + DRILLS[1][1].walk.peakOverhead} B)` }, { id: "c", label: "both" }], correctId: "a", explanation: "Two repair labels add 8 bytes; a repair IPv6 header adds 40." },
];

function ArchitectureDiagram() {
  return (
    <DiagramSvg h={190} label="Segment Routing (RFC 8402) is one architecture: a headend imposes an ordered list of segments; SR-MPLS encodes segments as MPLS labels, SRv6 encodes them as IPv6 SIDs">
      <DNode x={320} y={34} label="Segment Routing" sub="RFC 8402 — ordered segments at the headend" accent={D.violet} w={300} />
      <DArrow x1={260} y1={57} x2={180} y2={104} color={D.faint} width={1.5} />
      <DArrow x1={380} y1={57} x2={460} y2={104} color={D.faint} width={1.5} />
      <DNode x={160} y={128} label="SR-MPLS" sub="RFC 8660 — label stack" accent={D.mpls} w={200} />
      <DNode x={480} y={128} label="SRv6" sub="RFC 8754 / 8986 — SIDs + SRH" accent={D.ip} w={200} />
      <text x={320} y={178} textAnchor="middle" fill={D.muted} fontSize={10}>
        same concepts (Node/Prefix, Adjacency, Binding, Service segments) — different wire formats
      </text>
    </DiagramSvg>
  );
}

function AnatomyDiagram() {
  const field = (x: number, w: number, y: number, label: string, color: string) => (
    <g>
      <rect x={x} y={y} width={w} height={30} rx={5} fill={color} fillOpacity={0.16} stroke={color} strokeOpacity={0.8} />
      <text x={x + w / 2} y={y + 19} textAnchor="middle" fill={color} fontSize={10} fontWeight={700}>
        {label}
      </text>
    </g>
  );
  return (
    <DiagramSvg h={180} label="An MPLS shim is 32 bits: label 20, traffic class 3, bottom-of-stack 1, TTL 8. An SRv6 SID is a 128-bit IPv6 address: locator, function and optional argument">
      <text x={24} y={34} fill={D.mpls} fontSize={11} fontWeight={700}>
        MPLS shim · 32 bits
      </text>
      {field(170, 250, 14, "Label 20", D.mpls)}
      {field(424, 50, 14, "TC 3", D.faint)}
      {field(478, 40, 14, "S 1", D.warning)}
      {field(522, 90, 14, "TTL 8", D.faint)}
      <text x={24} y={104} fill={D.ip} fontSize={11} fontWeight={700}>
        SRv6 SID · 128 bits
      </text>
      {field(170, 220, 84, "Locator", D.ip)}
      {field(394, 120, 84, "Function", D.violet)}
      {field(518, 94, 84, "Argument", D.faint)}
      <text x={320} y={150} textAnchor="middle" fill={D.muted} fontSize={10}>
        a label is looked up in an LFIB; a SID is routed by its locator and executed in a Local SID Table
      </text>
    </DiagramSvg>
  );
}

function AdjScopeDiagram() {
  return (
    <DiagramSvg h={200} label="A locally significant adjacency segment only has meaning at its owner, so a Node segment must bring the packet there first; a globally routed adjacency segment reaches the owner and forces the link in one instruction">
      <text x={24} y={34} fill={D.text} fontSize={11} fontWeight={700}>
        local adjacency
      </text>
      <DHeaderColumn x={330} y={16} w={300} rows={[{ text: "Node segment → owner", color: D.mpls }, { text: "local Adj segment → link", color: D.mpls, strong: true }]} />
      <text x={24} y={124} fill={D.text} fontSize={11} fontWeight={700}>
        globally routed adjacency
      </text>
      <DHeaderColumn x={330} y={106} w={300} rows={[{ text: "one segment: reach owner + force link", color: D.ip, strong: true }]} />
      <text x={320} y={178} textAnchor="middle" fill={D.muted} fontSize={10}>
        SRv6 End.X is routed via its locator; MPLS Adj-SIDs can also be global (RFC 8402)
      </text>
    </DiagramSvg>
  );
}

function UsdDiagram() {
  return (
    <DiagramSvg h={210} label={`Advanced alternative: one additional steering outer, source ${USD_ALTERNATIVE.steeringSource}, destination ${USD_ALTERNATIVE.steeringSid} End.X plus USD, around the existing transport packet whose destination is ${USD_ALTERNATIVE.transportDa}`}>
      <DHeaderColumn
        x={330}
        y={20}
        w={380}
        rows={[
          { text: `SA ${USD_ALTERNATIVE.steeringSource} · DA ${USD_ALTERNATIVE.steeringSid}`, color: D.warning, tag: "STEERING", strong: true },
          { text: `transport outer · DA ${USD_ALTERNATIVE.transportDa}`, color: D.ip, tag: "TRANSPORT" },
          { text: "customer IPv4", color: D.eth },
        ]}
      />
      <text x={330} y={120} textAnchor="middle" fill={D.text} fontSize={11}>
        End.X + USD at P4 removes only the steering outer, then forces P4→{USD_ALTERNATIVE.forwardedTo}
      </text>
      <text x={330} y={146} textAnchor="middle" fill={D.muted} fontSize={10}>
        {USD_ALTERNATIVE.steeringSidCount} additional steering SID around {USD_ALTERNATIVE.transportSidCount} existing transport SID — not &quot;one SID total&quot;
      </text>
    </DiagramSvg>
  );
}

function ControlPlaneDiagram() {
  return (
    <DiagramSvg h={200} label="Control plane only: PE1 and PE2 peer with the route reflector RR1 over MP-BGP; the IGP distributes SIDs and labels; RR1 is never on the packet path">
      <DNode x={320} y={36} label="RR1" sub="control plane only" accent={D.bgp} w={170} />
      <DNode x={120} y={120} label="PE1" sub="VPN routes" accent={D.ip} w={130} />
      <DNode x={520} y={120} label="PE2" sub="VPN routes" accent={D.ip} w={130} />
      <DArrow x1={262} y1={62} x2={170} y2={96} color={D.bgp} both />
      <DArrow x1={378} y1={62} x2={470} y2={96} color={D.bgp} both />
      <text x={196} y={70} textAnchor="end" fill={D.bgp} fontSize={10.5} fontWeight={700}>
        MP-BGP
      </text>
      <text x={444} y={70} fill={D.bgp} fontSize={10.5} fontWeight={700}>
        MP-BGP
      </text>
      <DArrow x1={190} y1={140} x2={450} y2={140} color={D.ospf} dashed label="IGP: Node/Adj SIDs or locators" labelDy={18} />
      <text x={320} y={188} textAnchor="middle" fill={D.muted} fontSize={10}>
        customer packets never visit RR1 in either architecture
      </text>
    </DiagramSvg>
  );
}

function MigrationDiagram() {
  return (
    <DiagramSvg h={170} label="Coexistence: one IGP can carry both MPLS SIDs and SRv6 locators, so services can move gradually from one encoding to the other">
      <DNode x={320} y={34} label="One IGP" sub="SR-MPLS SIDs + SRv6 locators" accent={D.ospf} w={260} />
      <DArrow x1={260} y1={57} x2={190} y2={100} color={D.faint} width={1.5} />
      <DArrow x1={380} y1={57} x2={450} y2={100} color={D.faint} width={1.5} />
      <DNode x={170} y={120} label="services on SR-MPLS" sub="existing" accent={D.mpls} w={210} />
      <DNode x={470} y={120} label="services on SRv6" sub="introduced gradually" accent={D.ip} w={210} />
      <text x={320} y={162} textAnchor="middle" fill={D.muted} fontSize={10}>
        a per-service choice, not a flag day
      </text>
    </DiagramSvg>
  );
}

export function SrMplsVsSrv6DeepDiveContent() {
  const rp = D0.view.repair;
  return (
    <div className="space-y-12">
      <GuideSection id="md-arch" eyebrow="Foundation" title="One architecture, two encodings" tone="violet">
        <DiagramFrame caption="Segment Routing defines what a segment means; the data plane defines how it is carried.">
          <ArchitectureDiagram />
        </DiagramFrame>
        <p>
          RFC 8402 defines Segment Routing: a headend expresses a path as an ordered list of <b className="text-pv-text">segments</b> — reach a node, cross an adjacency, apply a service — and the IGP distributes them. RFC 8660 carries segments as MPLS labels (SR-MPLS); RFC 8754 and RFC 8986 carry them as IPv6 addresses with an optional Segment Routing Header (SRv6). The computations — SPF, TI-LFA, SR policies — are the same; the wire format, and what each router has to understand, are not.
        </p>
      </GuideSection>

      <GuideSection id="md-anatomy" eyebrow="Foundation" title="Label vs SID anatomy" tone="mpls">
        <DiagramFrame caption="Different sizes, different lookups.">
          <AnatomyDiagram />
        </DiagramFrame>
        <FieldTable
          title="One instruction"
          accent="mpls"
          columns={["", "SR-MPLS label", "SRv6 SID"]}
          rows={[
            ["Size", "20-bit label in a 4-byte entry (TC, S, TTL)", "128-bit IPv6 address"],
            ["Meaning", "local to the router's label table (global by SRGB convention)", "locator = where (routed), function = what (local)"],
            ["Lookup", "exact match in the LFIB", "longest match in the IPv6 FIB; exact match in the local SID table at the owner"],
            ["Several instructions", "a stack, top first, S bit on the last", "DA + SRH segment list, Segments Left points at the active one"],
          ]}
        />
      </GuideSection>

      <GuideSection id="md-ids" eyebrow="Foundation" title="SID spaces: SRGB, SRLB, locators" tone="mpls">
        <p>
          SR-MPLS keeps global meaning by convention: every router reserves the same <b className="text-pv-text">SRGB</b> (here 16000–23999) and adds the advertised index. Adj-SIDs and service labels come from the dynamic range and only mean something on their own router (here Adj-SID = 24000 + 10·own + peer, VPN label 9002). SRv6 has no such convention to keep: a SID is globally unique because it sits inside a globally unique locator.
        </p>
        <CliPanel run={dpOnly(D0, "PE2", "show running-config segment-routing", /global-block|locator|prefix/)} caption="IOS XR · PE2 — the SRGB and the SRv6 locator in one segment-routing block" />
        <CliPanel run={dpCli(D0, "PE2", "show segment-routing srv6 locator")} caption="IOS XR · PE2 — locator MAIN" />
      </GuideSection>

      <GuideSection id="md-lfib" eyebrow="Forwarding" title="SR-MPLS forwarding: the LFIB" tone="mpls">
        <p>
          Every SR-MPLS router installs an LFIB entry per prefix-SID: incoming label → outgoing label and interface. The outgoing label is the same Node SID (swap), <b className="text-pv-text">Pop</b> when the next hop is the owner (PHP), or <b className="text-pv-text">Unlabelled</b> when the next hop has no label for it. Adj-SIDs pop and force one interface. A label is meaningless to a router that has no entry for it — the whole path depends on every hop.
        </p>
        <CliPanel run={dpCli(D0, "P2", "show mpls forwarding")} caption="IOS XR · P2 — Node SIDs, PHP toward PE2 and P1, its Adj-SIDs" />
        <CliPanel run={dpCli(T.p2mpls, "P1", "show mpls forwarding labels 16006")} caption="IOS XR · P1 — after P2 lost SR-MPLS: Unlabelled toward P2" />
      </GuideSection>

      <GuideSection id="md-srv6fwd" eyebrow="Forwarding" title="SRv6 forwarding: route or execute" tone="ip">
        <p>
          An SRv6 router does one of two things with a packet. If the destination is one of <i>its own</i> SIDs (in its local SID table), it <b className="text-pv-text">executes</b> the behavior — End.DT4, End.X, End. Otherwise it simply <b className="text-pv-text">routes</b> the destination by longest match, like any IPv6 packet. Transit routers therefore need no SR state at all — just the IGP routes to every locator.
        </p>
        <CliPanel run={dpWith(D0, "P1", "show route ipv6", /i L2 2001:db8:1[01]0:/)} caption="IOS XR · P1 — the locators it routes on" />
        <CliPanel run={dpCli(S6, "PE2", "show segment-routing srv6 sid")} caption="IOS XR · PE2 — its local SID table: End, End.X, and the End.DT4 for CUST-A" />
      </GuideSection>

      <GuideSection id="md-adj" eyebrow="Forwarding" title="Adjacency scope" tone="warning">
        <DiagramFrame caption="Why segment counts can differ for the same path.">
          <AdjScopeDiagram />
        </DiagramFrame>
        <p>A local Adj-SID only works once the packet is at its router, so it needs a Node SID in front. An End.X is routed to its owner through the owner&apos;s locator, so it reaches the router and forces the link in one SID — at 16 bytes instead of 4.</p>
      </GuideSection>

      <GuideSection id="md-usd" eyebrow="Forwarding" title="An extra steering SID" tone="warning">
        <DiagramFrame caption="Values from the guided lesson's End.X + USD alternative.">
          <UsdDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="md-vpn" eyebrow="Services" title="VPN signaling: label vs service SID" tone="bgp">
        <p>
          The VRF, RD, RT and MP-BGP machinery is identical. What differs is the service identifier in the update: an MPLS VPN label (RFC 4364), or an SRv6 SID in the Prefix-SID attribute (RFC 9252). The <b className="text-pv-text">egress PE decides</b> by how its VRF is configured; the ingress just uses what it receives. Over SR-MPLS the next hop must also have a transport label; over SRv6 the SID&apos;s locator must be reachable.
        </p>
        <CliPanel run={dpBlock(D0, "PE1", "show bgp vpnv4 unicast vrf CUST-A 10.20.1.0/24", /10\.0\.0\.6 \(metric/, /Origin/)} caption="IOS XR · PE1 — SR-MPLS: a received label" />
        <CliPanel run={dpBlock(S6, "PE1", "show bgp vpnv4 unicast vrf CUST-A 10.20.1.0/24", /10\.0\.0\.6 \(metric/, /Origin/)} caption="IOS XR · PE1 — SRv6: a service SID" />
      </GuideSection>

      <GuideSection id="md-control" eyebrow="Services" title="Control plane" tone="bgp">
        <DiagramFrame caption="A control-plane diagram — not a packet path.">
          <ControlPlaneDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="md-tilfa" eyebrow="Protection" title="TI-LFA in both encodings" tone="danger">
        <p>
          TI-LFA computes the post-convergence path with the protected link removed — here {rp.path.join(" → ")} — and encodes the shortest segment list that makes the pre-failure network follow it. P node {rp.pNode} is still reached normally from P1; {rp.pNode}&apos;s own path to Q node {rp.qNode} goes back through P1, so the adjacency {rp.pNode}→{rp.qNode} is forced. SR-MPLS: Node SID {rp.labels![0]} + Adj-SID {rp.labels![1]} above the transport label. SRv6: one End.X SID in a repair header, removed at {rp.pNode} (USD).
        </p>
        <CliPanel run={dpCli(D0, "P1", "show mpls forwarding labels 16006")} caption="IOS XR · P1 — primary entry and the (!) backup with the repair labels" />
        <CliPanel run={dpCli(D0, "P1", "show isis fast-reroute 2001:db8:100:2::/64 detail")} caption="IOS XR · P1 — the SRv6 backup for PE2's locator" />
        <FieldTable
          title="Drills in the lab (P1–P2 cut, P1 repairs, everyone else still on old tables)"
          accent="danger"
          columns={["Plane", "Packet", "Peak encapsulation", "Result"]}
          rows={DRILLS.flatMap((row) => row.map((t) => [t.enc === "mpls" ? "SR-MPLS" : "SRv6", `${t.size} B`, `${t.walk.peakOverhead} B`, t.walk.ok ? `delivered, ${lossText(t.lossMs)} lost` : t.walk.why ?? "failed"]))}
        />
      </GuideSection>

      <GuideSection id="md-mtu" eyebrow="Design" title="Header cost and MTU" tone="cyan">
        <p>
          Every SR-MPLS instruction is 4 bytes. SRv6 pays 40 bytes for the outer IPv6 header, then 8 + 16 per SID for an SRH when more than one SID is needed (reduced encapsulation puts the first SID in the DA only). Local repairs add their own header on top. Size the core MTU for the worst case — the longest policy plus a repair — not for the steady state.
        </p>
        <DpResult s={MTU_M} title="The lab: P1–P3 at mtu 1514, SR-MPLS drill with 1460 bytes" />
        <DpResult s={T.mtu} title="The lab: the same link, SRv6 drill with 1460 bytes (the mtu ticket)" />
      </GuideSection>

      <GuideSection id="md-migration" eyebrow="Design" title="Coexistence and migration" tone="ospf">
        <DiagramFrame caption="Both encodings can run on one network.">
          <MigrationDiagram />
        </DiagramFrame>
        <p>
          Both planes can run side by side on one IGP — the lab does exactly that. A migration moves services one VRF at a time by changing the egress PE&apos;s allocation. Before each move, check the <b className="text-pv-text">new</b> plane end to end: locators advertised and routed everywhere, SRv6 SIDs on the routers TI-LFA needs, MTU headroom for the bigger header. What worked under SR-MPLS proves nothing about SRv6 — the guided incident is exactly that.
        </p>
      </GuideSection>

      <GuideSection id="md-matrix" eyebrow="Design" title="Requirement matrix" tone="cyan">
        <FieldTable title="From the guided lesson's own matrix — no row names a winner" accent="cyan" columns={["Requirement", "SR-MPLS", "SRv6"]} rows={REQUIREMENT_MATRIX.map((r) => [r.requirement, r.srMpls, r.srv6])} />
      </GuideSection>

      <GuideSection id="md-config" eyebrow="Operations" title="Configuring both on IOS XR" tone="success">
        <CliPanel run={dpBlock(D0, "PE2", "show running-config router isis", /address-family ipv4 unicast/, /^ interface GigabitEthernet/)} caption="IOS XR · PE2 — IS-IS: segment-routing mpls, the SRv6 locator, the prefix-SID" />
        <CliPanel run={dpBlock(S6, "PE2", "show running-config router bgp", /^ vrf CUST-A/)} caption="IOS XR · PE2 — VRF CUST-A over SRv6 (per-VRF End.DT4)" />
        <CliPanel run={dpBlock(D0, "PE2", "show running-config router bgp", /^ vrf CUST-A/)} caption="IOS XR · PE2 — the same VRF over SR-MPLS (per-VRF label)" />
      </GuideSection>

      <GuideSection id="md-verify" eyebrow="Operations" title="How to verify" tone="success">
        <FieldTable
          title="Verification on IOS XR"
          accent="success"
          columns={["Question", "Command"]}
          rows={[
            ["Label or SID for the VPN?", <Mono key="1">show bgp vpnv4 unicast vrf CUST-A &lt;prefix&gt;</Mono>],
            ["What does the ingress push?", <Mono key="2">show cef vrf CUST-A &lt;ip&gt;</Mono>],
            ["A label for every loopback?", <Mono key="3">show isis segment-routing label table</Mono>],
            ["Label path and backup?", <Mono key="4">show mpls forwarding labels &lt;n&gt;</Mono>],
            ["Locators advertised and routed?", <Mono key="5">show isis segment-routing srv6 locators · show route ipv6</Mono>],
            ["Local SIDs?", <Mono key="6">show segment-routing srv6 sid</Mono>],
            ["Backup in each plane?", <Mono key="7">show isis fast-reroute &lt;prefix&gt; detail</Mono>],
            ["Byte budget?", <Mono key="8">show ipv6 interface brief · ping vrf CUST-A &lt;ip&gt; size 1460</Mono>],
          ]}
        />
      </GuideSection>

      <GuideSection id="md-signatures" eyebrow="Troubleshooting" title="Failure signatures" tone="danger">
        <FailureSignatures
          items={[
            { tag: "LOC", title: "Egress locator not advertised", tone: "danger", points: ["SRv6 VPN not installed", "BGP looks perfect"] },
            { tag: "LSP", title: "Transit router without SR-MPLS", tone: "danger", points: ["Unlabelled toward it", "bare VPN label dropped"] },
            { tag: "SID", title: "Egress without prefix-SID", tone: "danger", points: ["no transport label", "dropped at the first P"] },
            { tag: "FRR", title: "Repair node lacks one plane", tone: "warning", points: ["backup in one plane only", "~1 s loss in the other"] },
            { tag: "MTU", title: "Small MTU on the backup path", tone: "warning", points: ["only during repairs", "only big SRv6 packets"] },
            { tag: "RT", title: "Not this time: RT / BGP", tone: "violet", points: ["route present and imported", "so look at the data plane"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="md-ladder" eyebrow="Troubleshooting" title="The troubleshooting ladder" tone="danger">
        <TroubleshootingFlow
          steps={[
            { question: "What does the customer see?", look: "Ping and drill, small and big — which fail?" },
            { question: "Which plane does the VPN use?", look: "show bgp vpnv4 unicast vrf … — label or SID." },
            { question: "Can the ingress reach the egress in that plane?", look: "a Node SID label (label table) or a locator route (show route ipv6)." },
            { question: "Does every transit router support that plane?", look: "show mpls forwarding — Unlabelled? (SRv6: nothing to check)." },
            { question: "Is there a backup in that plane?", look: "show isis fast-reroute … detail on the PLR." },
            { question: "Do the links carry the bytes?", look: "show ipv6 interface brief along the primary and backup paths." },
          ]}
        />
      </GuideSection>

      <GuideSection id="md-tickets" eyebrow="Troubleshooting" title="Five faults, evidence to proof" tone="danger">
        <FailureWalk title="1 · Migrated to SRv6, and it broke" normal="PE2 advertises locator 2001:db8:100:2::/64 in IS-IS." change="CUST-A moved to SRv6; PE2's IS-IS no longer advertises the locator." evidence={<CliPanel run={dpCli(T.locator, "PE2", "show isis segment-routing srv6 locators")} caption="IOS XR · PE2 — no locator advertised" />} next="PE1 can't reach the End.DT4, installs nothing; SR-MPLS never needed the locator." fix={<Mono>PE2: router isis CORE → address-family ipv6 unicast → segment-routing srv6 → locator MAIN → commit</Mono>} proof="show cef on PE1 shows the SID-list; a fresh ping is delivered over SRv6." />
        <FailureWalk title="2 · CUST-A died after P2's upgrade" normal="P2 runs segment-routing mpls." change="The upgrade dropped it; IS-IS stays up." evidence={<CliPanel run={dpCli(T.p2mpls, "P1", "show mpls forwarding labels 16006")} caption="IOS XR · P1 — Unlabelled toward P2" />} next="P2 receives the bare VPN label 9002 and drops it; SRv6 customers are unaffected." fix={<Mono>P2: router isis CORE → address-family ipv4 unicast → segment-routing mpls → commit</Mono>} proof="16006 swapped at P1 again; a fresh ping is delivered over SR-MPLS." />
        <FailureWalk title="3 · SRv6 isn't protected, SR-MPLS was" normal="P1 has a backup in both planes." change="P4's IS-IS lost its SRv6 locator: no End.X on P4." evidence={<CliPanel run={dpCli(T.p4srv6, "P1", "show isis fast-reroute 2001:db8:100:2::/64 detail")} caption="IOS XR · P1 — no SRv6 backup" />} next={`A cut costs CUST-A (on SRv6) ${lossText(T.p4srv6.tests.at(-1)!.lossMs)}.`} fix={<Mono>P4: router isis CORE → address-family ipv6 unicast → segment-routing srv6 → locator MAIN → commit</Mono>} proof="P1 shows the End.X backup; a fresh SRv6 drill is repaired locally." />
        <FailureWalk title="4 · Big packets vanish during a cut" normal="Core links at mtu 9216." change="New optics on P1–P3 came with mtu 1514." evidence={<DpResult s={T.mtu} title="The lab: SRv6 drill with 1460 bytes" />} next="1460 + 80 = 1540 bytes on P1–P3 during the repair; SR-MPLS would need 1476." fix={<Mono>P1 Gi0/0/0/2 and P3 Gi0/0/0/0: mtu 9216 → commit</Mono>} proof="A fresh 1460-byte SRv6 drill is repaired locally." />
        <FailureWalk title="5 · No label to PE2" normal="PE2's Loopback0 has prefix-sid index 6 (16006)." change="A loopback clean-up removed it." evidence={<CliPanel run={dpOnly(T.nosid, "PE1", "show cef vrf CUST-A 10.20.1.10", /labels imposed/)} caption="IOS XR · PE1 — no transport label above the VPN label" />} next="P1 has no entry for 9002 and drops it; 10.0.0.6 still pings." fix={<Mono>PE2: router isis CORE → interface Loopback0 → address-family ipv4 unicast → prefix-sid index 6 → commit</Mono>} proof="labels imposed {16006 9002}; a fresh ping is delivered." />
      </GuideSection>

      <GuideSection id="md-myths" eyebrow="Master it" title="Common misconceptions" tone="warning">
        <Misconceptions
          items={[
            { myth: "SRv6 and SR-MPLS compute different paths.", correction: "Same IGP, same SPF, same TI-LFA — only the encoding differs." },
            { myth: "SRv6 needs SR support on every router.", correction: "Only on routers that own executed SIDs; transit just routes IPv6." },
            { myth: "If BGP has the route, the VPN works.", correction: "Each plane needs its own data-plane reachability: a transport label, or a locator route." },
            { myth: "SR-MPLS headers are always bigger with more segments.", correction: "Labels are 4 bytes each; SRv6 pays 40 + 16 per extra SID unless compressed." },
            { myth: "One plane is simply better.", correction: "It depends on the hardware, the operations, the MTU and the services." },
          ]}
        />
      </GuideSection>

      <GuideSection id="md-quiz" eyebrow="Master it" title="Knowledge check" tone="cyan">
        <KnowledgeQuiz questions={QUIZ} />
      </GuideSection>

      <GuideSection id="md-explain" eyebrow="Master it" title="Can you explain it?" tone="violet">
        <ExplainIt
          items={[
            { q: "Why does P1 swap 16006 to 16006?", a: "Every router uses the same SRGB and PE2's index is 6, so everyone's label for PE2 is 16006." },
            { q: "Why does SRv6 survive a P router without SR?", a: "That router only routes the IPv6 destination toward the owner's locator; only the owner executes the SID." },
            { q: "Why did SR-MPLS keep working in the incident?", a: "It reaches PE2 through the prefix-SID of 10.0.0.6/32; only SRv6 needed the missing locator route." },
            { q: "Why two instructions for one repair?", a: "P4's own path to P2 runs back through P1: reach P4, then force P4→P2." },
            { q: "Why does the MTU matter more for SRv6 repairs?", a: "The repair adds a 40-byte IPv6 header instead of 8 bytes of labels." },
          ]}
        />
      </GuideSection>

      <GuideSection id="md-glossary" eyebrow="Master it" title="Glossary" tone="cyan">
        <Glossary
          items={[
            { term: "SRGB", def: "Segment Routing Global Block: the label range every router reserves for prefix-SIDs (16000–23999)." },
            { term: "LFIB", def: "Label Forwarding Information Base: incoming label → operation, outgoing label, interface." },
            { term: "Local SID table", def: "Where an SRv6 node binds its SIDs to behaviors." },
            { term: "Prefix-SID attribute", def: "The BGP attribute that carries an SRv6 service SID (RFC 9252)." },
            { term: "Per-VRF allocation", def: "One VPN label or one End.DT4 SID for the whole VRF." },
            { term: "P node / Q node", def: "TI-LFA: the last node the PLR reaches normally, and the node reached by the forced adjacency." },
          ]}
        />
      </GuideSection>

      <GuideSection id="md-mental" eyebrow="Master it" title="Mental model" tone="violet">
        <p>One road network, two kinds of parcel labels: short codes that every depot must look up in its own book, or full street addresses any depot can route. Same roads, same detours — and during a move from codes to addresses, every street sign must already be up.</p>
        <Callout tone="success" title="Recap" icon="✓">
          Decide what the network must do — transport, TE, services, protection — then choose the encoding that fits your hardware, operations and MTU. Both carry the same Segment Routing program; each needs its own reachability.
        </Callout>
      </GuideSection>

      <GuideSection id="md-practice" eyebrow="Master it" title="Practice in the SR-MPLS vs SRv6 Lab" tone="violet">
        <p>Six Learn levels, then the workspace: every router with both planes, PE2&apos;s VRF plane switch, MTUs, IOS XR consoles, pings and drills of 100 and 1460 bytes, five challenges and the five tickets above.</p>
        <LabBridge />
        <PresentationBridge>Rewatch the SR-MPLS vs SRv6 presentation.</PresentationBridge>
      </GuideSection>
    </div>
  );
}
