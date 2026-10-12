import { ChecklistCard, CompareCards, DArrow, DIAGRAM as D, DNode, DPill, DiagramFrame, DiagramSvg, FailureSignatures, FieldTable, Glossary, GuideSection, Misconceptions, Mono, TroubleshootingFlow } from "@/components/lesson/GuideBlocks";
import { DStack } from "@/components/lesson/MplsGuideSvg";
import { DHeaderColumn } from "@/components/lesson/Srv6GuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { ExplainIt, KnowledgeQuiz, PracticeBridge, type KnowledgeQuestion } from "@/components/lesson/GuideInteractive";
import { usePracticeLabOpener } from "@/components/lesson/FundamentalsLessonShell";
import { PresentationBridge } from "@/components/presentation/LessonPresentation";
import { CliPanel, FailureWalk } from "@/components/lesson/GuideCli";
import { createSvNet, svApply, type SvState } from "@/lib/sim-engine/scenarios/svNet";
import { SvResult, svBlock, svCli, svOnly, svSet, svTicketRun, svWith } from "./LessonGuideContent";

const G = { foundation: "Foundation", control: "Control plane", data: "Data plane", ops: "Operations", trouble: "Troubleshooting", master: "Master it" };
export const SRV6L_DEEP_DIVE_SECTIONS: LessonGuideSectionLink[] = [
  { id: "vd-service", label: "The L3VPN service model", group: G.foundation },
  { id: "vd-compare", label: "MPLS L3VPN vs SRv6 L3VPN", group: G.foundation },
  { id: "vd-vrf", label: "VRFs and overlapping addresses", group: G.foundation },
  { id: "vd-rdrt", label: "RD and RT", group: G.control },
  { id: "vd-bgp", label: "BGP signaling (RFC 9252)", group: G.control },
  { id: "vd-attr", label: "Inside the Prefix-SID attribute", group: G.control },
  { id: "vd-transposition", label: "SID transposition", group: G.control },
  { id: "vd-alloc", label: "Service SID allocation", group: G.control },
  { id: "vd-rr", label: "Route reflection and RT filtering", group: G.control },
  { id: "vd-resolution", label: "Two resolutions per route", group: G.data },
  { id: "vd-encap", label: "Encapsulation choices", group: G.data },
  { id: "vd-egress", label: "Egress: End.DT vs End.DX", group: G.data },
  { id: "vd-dual", label: "Dual stack: two families, two SIDs", group: G.data },
  { id: "vd-config", label: "Configuring it on IOS XR", group: G.ops },
  { id: "vd-verify", label: "How to verify", group: G.ops },
  { id: "vd-layers", label: "Eight facts that are not the same", group: G.trouble },
  { id: "vd-signatures", label: "Failure signatures", group: G.trouble },
  { id: "vd-ladder", label: "The troubleshooting ladder", group: G.trouble },
  { id: "vd-tickets", label: "Five faults, evidence to proof", group: G.trouble },
  { id: "vd-design", label: "Design notes", group: G.master },
  { id: "vd-evpn", label: "Beyond L3VPN", group: G.master },
  { id: "vd-myths", label: "Common misconceptions", group: G.master },
  { id: "vd-quiz", label: "Knowledge check", group: G.master },
  { id: "vd-explain", label: "Can you explain it?", group: G.master },
  { id: "vd-glossary", label: "Glossary", group: G.master },
  { id: "vd-mental", label: "Mental model", group: G.master },
  { id: "vd-practice", label: "Practice in the SRv6 L3VPN Lab", group: G.master },
];

// Real IOS XR output and ping results: the SRv6 L3VPN Lab's command set and model.
const V0: SvState = createSvNet(0);
const T = { locator: svTicketRun("locator"), rt: svTicketRun("rt"), nosrv6: svTicketRun("nosrv6"), redist: svTicketRun("redist"), vpnv6: svTicketRun("vpnv6") };
const PERCE = svApply(V0, svSet("per-ce", "PE2", (c) => void (c.bgp!.vrf["CUST-A"]!.af.ipv4!.mode = "per-ce")));
const PERCE_PING = svApply(PERCE, { type: "ping", src: { ce: "CE1" }, to: "10.20.2.10" });

function LabBridge() {
  const openLab = usePracticeLabOpener();
  return (
    <PracticeBridge label="Open the SRv6 L3VPN Lab" onPractice={openLab}>
      Two customers over SRv6 on IOS XR: VRFs, VPNv4/VPNv6 routes and service SIDs to inspect and change, pings between any sites, five tickets — your own copy. Nothing you do there changes your lesson progress.
    </PracticeBridge>
  );
}

function CompareDiagram() {
  return (
    <DiagramSvg h={190} label="MPLS L3VPN: transport label over VPN label over customer IP. SRv6 L3VPN: outer IPv6 whose DA is the Service SID over customer IP">
      <text x={170} y={20} textAnchor="middle" fill={D.mpls} fontSize={11.5} fontWeight={700}>
        MPLS L3VPN
      </text>
      <DStack x={170} y={34} labels={[{ text: "transport label", tag: "LSP" }, { text: "VPN label", color: D.warning, tag: "service" }]} payload="customer IP" w={150} />
      <text x={470} y={20} textAnchor="middle" fill={D.ip} fontSize={11.5} fontWeight={700}>
        SRv6 L3VPN
      </text>
      <DHeaderColumn
        x={470}
        y={34}
        w={200}
        rows={[
          { text: "outer IPv6 · DA = Service SID", color: D.warning, tag: "service", strong: true },
          { text: "customer IP", color: D.ip },
        ]}
      />
      <text x={320} y={150} textAnchor="middle" fill={D.muted} fontSize={10}>
        VRF, RD, RT and MP-BGP VPN routes stay the same;
      </text>
      <text x={320} y={166} textAnchor="middle" fill={D.muted} fontSize={10}>
        the Service SID is both the transport destination and the egress instruction
      </text>
    </DiagramSvg>
  );
}

function AttrDiagram() {
  const box = (y: number, x: number, w: number, t: string, s: string, c: string) => (
    <g>
      <rect x={x} y={y} width={w} height={38} rx={8} fill={c} fillOpacity={0.12} stroke={c} strokeOpacity={0.75} />
      <text x={x + 12} y={y + 16} fill={c} fontSize={10.5} fontWeight={700}>
        {t}
      </text>
      <text x={x + 12} y={y + 30} fill={D.muted} fontSize={9.5}>
        {s}
      </text>
    </g>
  );
  return (
    <DiagramSvg h={210} label="BGP Prefix-SID attribute contains the SRv6 L3 Service TLV type 5, which contains the SRv6 SID Information sub-TLV with the SID and endpoint behavior, which may contain the SID Structure sub-sub-TLV">
      {box(12, 40, 560, "BGP Prefix-SID attribute", "path attribute attached to the VPN route", D.bgp)}
      {box(60, 80, 520, "SRv6 L3 Service TLV (type 5)", "type 6 is the L2 Service TLV, used by EVPN", D.warning)}
      {box(108, 120, 480, "SRv6 SID Information sub-TLV", "the SID value + its endpoint behavior (e.g. End.DT4)", D.violet)}
      {box(156, 160, 440, "SRv6 SID Structure sub-sub-TLV", "block / node / function / argument lengths, transposition", D.cyan)}
    </DiagramSvg>
  );
}

function TranspositionDiagram() {
  return (
    <DiagramSvg h={160} label="With transposition, the function bits of the SID are carried in the MPLS label field of the NLRI and the rest of the SID in the TLV, so routes with different functions can share one attribute">
      <DHeaderColumn x={170} y={30} w={230} rows={[{ text: "locator  |  function  |  0", color: D.warning }]} caption="full SID" />
      <DArrow x1={290} y1={40} x2={334} y2={40} color={D.faint} width={1.4} label="transpose" />
      <DHeaderColumn
        x={490}
        y={30}
        w={230}
        rows={[
          { text: "TLV: locator | 0 | 0", color: D.violet, tag: "attr" },
          { text: "NLRI label field: function", color: D.mpls, tag: "NLRI" },
        ]}
      />
      <text x={320} y={130} textAnchor="middle" fill={D.muted} fontSize={10}>
        saves update space; the receiver reassembles the full SID — this lesson keeps it off
      </text>
    </DiagramSvg>
  );
}

function ResolutionDiagram() {
  return (
    <DiagramSvg h={170} label="A received VPN route needs its BGP next hop resolved through the underlay and its Service SID resolved through the remote locator route; both must succeed">
      <DNode x={320} y={30} label="received VPN route" sub="RT matched" accent={D.bgp} w={200} />
      <DArrow x1={260} y1={52} x2={170} y2={84} color={D.faint} width={1.4} />
      <DArrow x1={380} y1={52} x2={470} y2={84} color={D.faint} width={1.4} />
      <DNode x={160} y={108} label="BGP next hop" sub="→ infra loopback route" accent={D.ospf} w={200} />
      <DNode x={480} y={108} label="Service SID" sub="→ remote locator route" accent={D.warning} w={200} />
      <DPill x={320} y={154} text="both required to install" color={D.success} w={180} />
    </DiagramSvg>
  );
}

function EncapChoicesDiagram() {
  const cols = [
    { x: 110, h: "shortest path", rows: [{ text: "DA = Service SID", color: D.warning, strong: true }, { text: "no SRH", color: D.faint }, { text: "customer packet", color: D.ip }] },
    { x: 320, h: "SR Policy steered", rows: [{ text: "DA = transport SID", color: D.warning, strong: true }, { text: "SRH … [0] Service SID", color: D.violet }, { text: "customer packet", color: D.ip }] },
    { x: 530, h: "reduced (Red)", rows: [{ text: "DA = first SID", color: D.warning, strong: true }, { text: "SRH without first SID", color: D.violet }, { text: "customer packet", color: D.ip }] },
  ];
  return (
    <DiagramSvg h={140} label="Shortest path: DA is the Service SID with no SRH. Policy-steered: DA is a transport SID and the SRH ends with the Service SID. Reduced mode omits the first SID from the SRH">
      {cols.map((c) => (
        <g key={c.h}>
          <text x={c.x} y={18} textAnchor="middle" fill={D.text} fontSize={11} fontWeight={700}>
            {c.h}
          </text>
          <DHeaderColumn x={c.x} y={30} w={180} rows={c.rows} />
        </g>
      ))}
      <text x={320} y={130} textAnchor="middle" fill={D.muted} fontSize={10}>
        in every case the Service SID is the final segment
      </text>
    </DiagramSvg>
  );
}


const QUIZ: KnowledgeQuestion[] = [
  { id: "q-rt", prompt: "Which attribute decides which VRF imports a VPN route?", options: [{ id: "a", label: "The route target" }, { id: "b", label: "The route distinguisher" }, { id: "c", label: "The service SID" }], correctId: "a", explanation: "RDs make prefixes unique; RTs drive import and export." },
  { id: "q-p", prompt: "What does a P router need to forward CUST-A traffic?", options: [{ id: "a", label: "A route to the egress PE's locator" }, { id: "b", label: "CUST-A's routes" }, { id: "c", label: "The VPN labels" }], correctId: "a", explanation: "The outer destination is the service SID, inside the egress PE's locator." },
  { id: "q-two", prompt: "The VPN route is received, the RT matches, the next hop is reachable — but the route isn't in the VRF. Most likely?", options: [{ id: "a", label: "The service SID's locator isn't reachable" }, { id: "b", label: "The BGP session is down" }, { id: "c", label: "The RD is wrong" }], correctId: "a", explanation: "Install also needs a reachable SID." },
  { id: "q-dt", prompt: "Two prefixes behind different CEs share one End.DT4. How does the egress PE choose the CE?", options: [{ id: "a", label: "VRF lookup of the inner destination after decapsulation" }, { id: "b", label: "An SRH segment" }, { id: "c", label: "The RD" }], correctId: "a", explanation: "DT = decapsulate and look up." },
  { id: "q-asym", prompt: "CE2 sees CE1's pings and replies, CE1 gets nothing. Where do you look?", options: [{ id: "a", label: "The return direction: does PE2 have a route back to CE1's prefix?" }, { id: "b", label: "PE1's route to CE2" }, { id: "c", label: "The P routers" }], correctId: "a", explanation: "A VPN works per direction; each PE must advertise its own prefixes." },
  { id: "q-fam", prompt: "IPv4 works, IPv6 doesn't, the session is Established. A good first check?", options: [{ id: "a", label: "Whether VPNv6 is negotiated on every session" }, { id: "b", label: "The IPv4 RT" }, { id: "c", label: "The CE's default route" }], correctId: "a", explanation: "Families are negotiated per session." },
];

export function Srv6L3vpnDeepDiveContent() {
  return (
    <div className="space-y-12">
      <GuideSection id="vd-service" eyebrow="Foundation" title="The L3VPN service model" tone="ip">
        <p>A BGP/MPLS IP VPN (RFC 4364) gives each customer a private IP network across a shared provider. Its building blocks — CE routers that only do plain IP, PE routers that hold a VRF per customer and exchange VPN routes over multiprotocol BGP, a core that knows nothing about customers — are independent of the data plane. RFC 9252 keeps all of that and changes one thing: the egress PE advertises an <b className="text-pv-text">SRv6 service SID</b> instead of an MPLS VPN label, and the core is plain IPv6 instead of an MPLS network.</p>
        <FieldTable
          title="Who does what"
          accent="ip"
          columns={["Role", "Knows", "Does"]}
          rows={[
            ["CE", "its LAN, a default route", "plain IP routing; unaware of VPNs"],
            ["PE", "VRFs, VPN routes, its locator and SIDs", "lookups per VRF, encapsulation, End.DT/DX execution"],
            ["P", "IGP: loopbacks and locators", "routes IPv6 packets on the outer destination"],
            ["RR", "every VPN route", "reflects routes between PEs; never in the data path"],
          ]}
        />
      </GuideSection>

      <GuideSection id="vd-compare" eyebrow="Foundation" title="MPLS L3VPN vs SRv6 L3VPN" tone="ip">
        <DiagramFrame caption="The service model is unchanged; the egress instruction moves into the IPv6 DA.">
          <CompareDiagram />
        </DiagramFrame>
        <p>In MPLS the ingress pushes two labels: a transport label to reach the egress PE and a VPN label that the egress uses to pick the VRF. In SRv6 one IPv6 address does both jobs: its locator part is routed to the egress PE, its function part selects End.DT4 in the right VRF. P routers lose their LFIB entirely.</p>
      </GuideSection>

      <GuideSection id="vd-vrf" eyebrow="Foundation" title="VRFs and overlapping addresses" tone="violet">
        <p>A VRF is a separate routing and forwarding table on the PE. Interfaces are assigned to VRFs; a packet is looked up in the VRF of the interface it arrived on. Because each VRF is independent, two customers can use the same prefixes without conflict — the lab&apos;s CUST-A and CUST-B both use 10.10.1.0/24 and 10.20.1.0/24.</p>
        <CliPanel run={svCli(V0, "PE2", "show vrf CUST-A detail")} caption="IOS XR · PE2 — CUST-A's interfaces and route targets per family" />
        <CliPanel run={svOnly(V0, "PE1", "show route vrf CUST-B", /^[BS]\s/)} caption="IOS XR · PE1 — CUST-B's 10.20.1.0/24 is a different route from CUST-A's" />
      </GuideSection>

      <GuideSection id="vd-rdrt" eyebrow="Control plane" title="RD and RT" tone="bgp">
        <CompareCards
          items={[
            { title: "Route distinguisher", tone: "mpls", tag: "uniqueness", points: ["prepended to the prefix: RD:prefix", "makes overlapping customer prefixes distinct in BGP", "no role in import"] },
            { title: "Route target", tone: "bgp", tag: "policy", points: ["an extended community on the route", "export: attached by the originating VRF", "import: a VRF accepts routes carrying one of its import RTs"] },
          ]}
        />
        <p>RTs also build more than simple any-to-any VPNs: hub-and-spoke (different import and export RTs), extranets (a VRF imports a second customer&apos;s RT), shared services. Each PE in the lab uses its own RD per VRF (65000:1/65000:2 for CUST-A), a common practice that keeps paths distinct when a site is multihomed.</p>
      </GuideSection>

      <GuideSection id="vd-bgp" eyebrow="Control plane" title="BGP signaling (RFC 9252)" tone="bgp">
        <FieldTable
          title="What an SRv6 VPN route carries"
          accent="bgp"
          columns={["Field", "Purpose", "Lab value (10.20.1.0/24)"]}
          rows={[
            ["AFI/SAFI", "VPNv4 (IPv4 routes, IPv6 next hop — RFC 8950) or VPNv6", "VPNv4"],
            ["NLRI", "RD:prefix — globally unique", <Mono key="1">65000:2:10.20.1.0/24</Mono>],
            ["Route target", "which VRFs import it", <Mono key="2">65000:100</Mono>],
            ["NEXT_HOP", "the egress PE's BGP address (loopback)", <Mono key="3">2001:db8:ffff::2</Mono>],
            ["Prefix-SID → SRv6 L3 Service TLV", "the service SID and its behavior", <Mono key="4">2001:db8:100:2:41:: End.DT4</Mono>],
          ]}
        />
        <CliPanel run={svOnly(V0, "PE1", "show bgp vpnv4 unicast rd 65000:2 10.20.1.0/24", /entry for|metric 40|valid|community|Originator|PSID|SubTLV/)} caption="IOS XR · PE1 — the received VPNv4 route, imported into CUST-A" />
      </GuideSection>

      <GuideSection id="vd-attr" eyebrow="Control plane" title="Inside the Prefix-SID attribute" tone="warning">
        <DiagramFrame caption="Nested TLVs; the same attribute family carries L2 services for EVPN.">
          <AttrDiagram />
        </DiagramFrame>
        <p>The BGP Prefix-SID attribute (type 40) holds an SRv6 L3 Service TLV (type 5) with one or more SRv6 SID Information Sub-TLVs: the SID, its endpoint behavior and flags, and an optional SID Structure Sub-Sub-TLV describing how the bits split into locator block, node, function and argument. IOS XR prints these as PSID-Type, SubTLV and SubSubTLV lines.</p>
      </GuideSection>

      <GuideSection id="vd-transposition" eyebrow="Control plane" title="SID transposition" tone="mpls">
        <DiagramFrame caption="An optimization, not a return to MPLS labels on the wire.">
          <TranspositionDiagram />
        </DiagramFrame>
        <p>With transposition, the function bits of the SID travel in the MPLS label field of the NLRI and only the common part of the SID in the attribute — so routes with different SIDs can share one attribute set and pack into fewer BGP updates. The receiver reassembles the full SID using the SID structure. On the wire, the packet still carries the full IPv6 SID; the lab shows SIDs untransposed for clarity.</p>
      </GuideSection>

      <GuideSection id="vd-alloc" eyebrow="Control plane" title="Service SID allocation" tone="violet">
        <FieldTable
          title="Allocation modes"
          accent="violet"
          columns={["Mode", "Behavior", "Trade-off"]}
          rows={[
            ["Per VRF, per family", <Mono key="1">End.DT4 / End.DT6</Mono>, "few SIDs; egress lookup needed"],
            ["Per VRF, dual stack", <Mono key="2">End.DT46</Mono>, "one SID for both families"],
            ["Per CE", <Mono key="3">End.DX4 / End.DX6</Mono>, "no egress lookup; one SID per CE next hop"],
          ]}
        />
        <p>IOS XR allocates service SIDs dynamically from the locator named under <Mono>segment-routing srv6</Mono> in the VRF address family, after End (:1) and the End.X SIDs. Changing the allocation renumbers them — harmless, because ingress PEs learn SIDs from BGP. With <Mono>alloc mode per-ce</Mono>, PE2 allocates an End.DX4 per CE next hop; connected routes keep a per-VRF End.DT4.</p>
        <CliPanel run={svOnly(PERCE, "PE2", "show segment-routing srv6 sid", /^SID|^---|End\.D/)} caption="IOS XR · PE2 with CUST-A IPv4 per-CE — End.DT4 for connected routes, End.DX4 per CE" />
        <SvResult s={PERCE_PING} title="The lab: CE1 → 10.20.2.10 through CE3's End.DX4" />
      </GuideSection>

      <GuideSection id="vd-rr" eyebrow="Control plane" title="Route reflection and RT filtering" tone="bgp">
        <p>PEs don&apos;t need a full mesh: each peers with route reflectors that pass routes along, adding ORIGINATOR_ID and CLUSTER_LIST but keeping the next hop and the SID. The RR keeps every VPN route; a PE keeps only routes whose RT one of its VRFs imports (RT filtering, on by default on IOS XR PEs). That is why a wrong RT makes a route vanish from the PE entirely — it is still on the RR.</p>
        <CliPanel run={svOnly(V0, "RR1", "show bgp vpnv4 unicast", /^Route Distinguisher|^\*/)} caption="IOS XR · RR1 — every VPN route of both customers" />
        <CliPanel run={svWith(V0, "RR1", "show bgp vpnv6 unicast summary", /^Neighbor/, 2)} caption="IOS XR · RR1 — both PEs, VPNv6 negotiated, prefixes received" />
      </GuideSection>

      <GuideSection id="vd-resolution" eyebrow="Data plane" title="Two resolutions per route" tone="ospf">
        <DiagramFrame caption="Route received ≠ route usable.">
          <ResolutionDiagram />
        </DiagramFrame>
        <p>The BGP next hop and the service SID usually sit in different prefixes: a loopback and a locator. The next hop is what BGP tracks; the SID is what packets are routed to. Each can fail on its own, and the ingress PE installs the route only when both resolve. In the lab&apos;s locator ticket the next hop resolves and the SID doesn&apos;t:</p>
        <CliPanel run={svCli(T.locator, "PE1", "show route ipv6 2001:db8:ffff::2")} caption="IOS XR · PE1 — the next hop resolves" />
        <CliPanel run={svCli(T.locator, "PE1", "show route ipv6 2001:db8:100:2:41::")} caption="IOS XR · PE1 — the SID doesn't" />
      </GuideSection>

      <GuideSection id="vd-encap" eyebrow="Data plane" title="Encapsulation choices" tone="ip">
        <DiagramFrame caption="The ingress PE picks the transport; the service SID stays last.">
          <EncapChoicesDiagram />
        </DiagramFrame>
        <p>On the shortest path a single SID is enough: H.Encaps.Red puts it in the outer destination and adds no SRH. With colored VPN routes the ingress PE can steer a route into an SRv6 policy ⟨PE, color, egress PE⟩ and append the service SID after the policy&apos;s segments.</p>
        <CliPanel run={svCli(V0, "PE1", "show cef vrf CUST-A ipv6 2001:db8:ca:20::a")} caption="IOS XR · PE1 — an IPv6 destination: one SID, End.DT6" />
      </GuideSection>

      <GuideSection id="vd-egress" eyebrow="Data plane" title="Egress: End.DT vs End.DX" tone="success">
        <CompareCards
          items={[
            { title: "End.DT4 / DT6", tone: "success", tag: "per VRF", points: ["decapsulate", "look up the inner destination in the SID's VRF", "the table picks the CE — a wrong destination simply fails"] },
            { title: "End.DX4 / DX6", tone: "warning", tag: "per CE", points: ["decapsulate", "send to the bound CE next hop, no lookup", "the SID picks the CE — even if the destination isn't there"] },
          ]}
        />
        <p>Both are valid only as the final segment and only for their inner family; anything else is dropped (the Endpoint Behaviors lesson covers the rules).</p>
      </GuideSection>

      <GuideSection id="vd-dual" eyebrow="Data plane" title="Dual stack: two families, two SIDs" tone="ip">
        <p>A dual-stack VRF has two address families: separate RTs (usually the same values), separate VPNv4 and VPNv6 routes, separate SIDs (End.DT4 and End.DT6, or one End.DT46), and separate negotiation on every BGP session. Failures follow those lines: in the lab, one family losing <Mono>segment-routing srv6</Mono> or one session losing VPNv6 breaks exactly one family.</p>
        <CliPanel run={svWith(T.vpnv6, "RR1", "show bgp vpnv6 unicast summary", /^Neighbor/, 2)} caption="IOS XR · RR1 during the VPNv6 ticket — PE2's session Established, VPNv6 not negotiated" />
      </GuideSection>

      <GuideSection id="vd-config" eyebrow="Operations" title="Configuring it on IOS XR" tone="mpls">
        <CliPanel run={svBlock(V0, "PE2", "show running-config", /^vrf CUST-A/, /^vrf CUST-B/)} caption="IOS XR · PE2 — the VRF and its route targets" />
        <CliPanel run={svBlock(V0, "PE2", "show running-config", /^router bgp/, /^ vrf CUST-B/)} caption="IOS XR · PE2 — BGP: VPN families toward RR1, the VRF's RD, SRv6 locator and allocation" />
        <FieldTable
          title="The statements"
          accent="mpls"
          columns={["Statement", "Where", "Effect"]}
          rows={[
            [<Mono key="1">import / export route-target</Mono>, "vrf → address-family", "which VPN routes come in and go out"],
            [<Mono key="2">vrf CUST-A</Mono>, "the CE interface", "puts the customer in the VRF"],
            [<Mono key="3">rd 65000:2</Mono>, "router bgp → vrf", "makes the VRF's prefixes unique"],
            [<Mono key="4">segment-routing srv6 → locator MAIN</Mono>, "router bgp → vrf → address-family", "allocates the service SID"],
            [<Mono key="5">alloc mode per-vrf | per-ce</Mono>, "same", "End.DT vs End.DX"],
            [<Mono key="6">redistribute static | connected</Mono>, "same", "turns customer routes into VPN routes"],
            [<Mono key="7">address-family vpnv4 | vpnv6 unicast</Mono>, "router bgp → neighbor", "negotiates the VPN families"],
            [<Mono key="8">segment-routing srv6 → locator MAIN</Mono>, "router isis → address-family ipv6", "advertises the locator: makes the SIDs reachable"],
          ]}
        />
      </GuideSection>

      <GuideSection id="vd-verify" eyebrow="Operations" title="How to verify" tone="success">
        <FieldTable
          title="Verification on IOS XR"
          accent="success"
          columns={["Question", "Command"]}
          rows={[
            ["VRFs, RDs, RTs", <Mono key="1">show vrf all · show vrf &lt;vrf&gt; detail</Mono>],
            ["A VRF's routes", <Mono key="2">show route vrf &lt;vrf&gt; [ipv6]</Mono>],
            ["VPN routes, sessions", <Mono key="3">show bgp vpnv4|vpnv6 unicast [summary | vrf &lt;vrf&gt;]</Mono>],
            ["One route's RT, next hop, SID", <Mono key="4">show bgp vpnv4 unicast rd &lt;rd&gt; &lt;prefix&gt;</Mono>],
            ["SIDs and locator", <Mono key="5">show segment-routing srv6 sid · locator · show isis segment-routing srv6 locators</Mono>],
            ["Reachability of a SID or next hop", <Mono key="6">show route ipv6 &lt;address&gt;</Mono>],
            ["What will be pushed", <Mono key="7">show cef vrf &lt;vrf&gt; [ipv6] &lt;destination&gt;</Mono>],
            ["Does it work?", <Mono key="8">ping vrf &lt;vrf&gt; &lt;destination&gt;</Mono>],
          ]}
        />
      </GuideSection>

      <GuideSection id="vd-layers" eyebrow="Troubleshooting" title="Eight facts that are not the same" tone="danger">
        <p>An L3VPN can fail between any two of these. Each is checked separately — and each of the lab&apos;s tickets breaks a different one while the others stay true.</p>
        <FieldTable
          title="From the customer route to the customer packet"
          accent="danger"
          columns={["Fact", "Checked with", "Broken by (lab)"]}
          rows={[
            ["The egress PE has the customer route", "show route vrf (egress)", "—"],
            ["It is a VPN route", "show bgp … rd … (egress, RR)", "redist"],
            ["It carries a service SID", "PSID lines", "nosrv6"],
            ["The sessions carry its family", "show bgp … summary", "vpnv6"],
            ["The ingress PE imports it", "show bgp … rd … (ingress)", "rt"],
            ["The next hop resolves", "show route ipv6 <loopback>", "—"],
            ["The SID resolves", "show route ipv6 <sid>", "locator"],
            ["Packets arrive — both ways", "ping from the CE", "all of them"],
          ]}
        />
      </GuideSection>

      <GuideSection id="vd-signatures" eyebrow="Troubleshooting" title="Failure signatures" tone="danger">
        <FailureSignatures
          items={[
            { tag: "LOC", title: "Locator not in the IGP", tone: "danger", points: ["route received with its SID, not installed", "next hop reachable, SID not"] },
            { tag: "RT", title: "Export/import RT mismatch", tone: "danger", points: ["route on RR1, absent on the PE", "both families affected"] },
            { tag: "SID", title: "No SRv6 in one family", tone: "warning", points: ["route without PSID", "one family down"] },
            { tag: "RED", title: "Not redistributed", tone: "warning", points: ["request delivered, reply dropped", "the prefix is not on RR1"] },
            { tag: "AF", title: "Family not negotiated", tone: "violet", points: ["session Established", "NoNeg for that family"] },
            { tag: "IF", title: "CE port not in the VRF", tone: "danger", points: ["traffic enters the global table", "dropped at the ingress PE"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="vd-ladder" eyebrow="Troubleshooting" title="The troubleshooting ladder" tone="danger">
        <TroubleshootingFlow
          steps={[
            { question: "What does the customer see — request or reply, which family?", look: "A ping from the CE, both families." },
            { question: "Does the egress PE have the customer route?", look: "show route vrf <vrf> on the egress PE." },
            { question: "Is it advertised as a VPN route, with RT and SID?", look: "show bgp … rd <rd> <prefix> on the egress PE or RR." },
            { question: "Do the sessions carry that family?", look: "show bgp vpnv4|vpnv6 unicast summary." },
            { question: "Does the ingress PE import it?", look: "show bgp … rd <rd> <prefix> on the ingress PE." },
            { question: "Do the next hop and the SID resolve?", look: "show route ipv6 <loopback> / <sid>." },
            { question: "Is there a way back?", look: "The same ladder for the reverse direction." },
          ]}
        />
      </GuideSection>

      <GuideSection id="vd-tickets" eyebrow="Troubleshooting" title="Five faults, evidence to proof" tone="danger">
        <FailureWalk title="1 · Site 2 unreachable, BGP looks fine" normal="PE2's locator 2001:db8:100:2::/64 is in IS-IS." change="PE2's IS-IS lost segment-routing srv6 locator MAIN." evidence={<CliPanel run={svCli(T.locator, "PE2", "show isis segment-routing srv6 locators")} caption="IOS XR · PE2 — no locator advertised" />} next="PE1 receives the routes with their SIDs, but no route to the SIDs: nothing installed, both families." fix={<Mono>PE2: router isis CORE → address-family ipv6 unicast → segment-routing srv6 → locator MAIN → commit</Mono>} proof="The locator is back on PE1; fresh pings succeed on IPv4 and IPv6." />
        <FailureWalk title="2 · New template, site 2 gone" normal="PE2 exports CUST-A with RT 65000:100." change="A template set export RT 65000:999." evidence={<CliPanel run={svOnly(T.rt, "RR1", "show bgp vpnv4 unicast rd 65000:2 10.20.1.0/24", /entry for|community/)} caption="IOS XR · RR1 — the route carries RT 65000:999" />} next="PE1 imports only 65000:100 and keeps no copy." fix={<Mono>PE2: vrf CUST-A → address-family ipv4|ipv6 unicast → export route-target → no 65000:999 · 65000:100 → commit</Mono>} proof="PE1 installs site 2's routes; fresh pings succeed." />
        <FailureWalk title="3 · IPv6 works, IPv4 doesn't" normal="Both CUST-A families have segment-routing srv6." change="The IPv4 af lost it in an upgrade." evidence={<CliPanel run={svOnly(T.nosrv6, "PE1", "show bgp vpnv4 unicast rd 65000:2 10.20.1.0/24", /entry for|community|PSID|Sid/)} caption="IOS XR · PE1 — the IPv4 route arrives with no SID" />} next="PE1 has nothing to encapsulate to; IPv6 keeps its End.DT6." fix={<Mono>PE2: router bgp 65000 → vrf CUST-A → address-family ipv4 unicast → segment-routing srv6 → locator MAIN → commit</Mono>} proof="10.20.1.0/24 carries End.DT4 again; IPv4 pings succeed." />
        <FailureWalk title="4 · Packets arrive, nothing comes back" normal="PE1 redistributes CE1's static route." change="PE1's CUST-A IPv4 lost redistribute static." evidence={<SvResult s={T.redist} title="The lab: request delivered, reply dropped at PE2" />} next="PE2 has no route back to 10.10.1.0/24." fix={<Mono>PE1: router bgp 65000 → vrf CUST-A → address-family ipv4 unicast → redistribute static → commit</Mono>} proof="PE2 installs 10.10.1.0/24; the ping completes." />
        <FailureWalk title="5 · Only IPv6 is broken" normal="PE2's session to RR1 carries VPNv4 and VPNv6." change="The re-created session lacks address-family vpnv6 unicast." evidence={<CliPanel run={svWith(T.vpnv6, "RR1", "show bgp vpnv6 unicast summary", /^Neighbor/, 2)} caption="IOS XR · RR1 — PE2 NoNeg for VPNv6" />} next="No IPv6 VPN routes in either direction; IPv4 fine." fix={<Mono>PE2: router bgp 65000 → neighbor 2001:db8:ffff::99 → address-family vpnv6 unicast → commit</Mono>} proof="VPNv6 negotiated; IPv6 pings succeed." />
      </GuideSection>

      <GuideSection id="vd-design" eyebrow="Master it" title="Design notes" tone="warning">
        <ChecklistCard
          tone="warning"
          title="Things to plan for"
          mark="!"
          items={[
            "Locators must be reachable from every ingress PE; summarizing them across areas saves FIB space but can hide the loss of one PE's locator.",
            "Keep the SID block filtered at the SR domain edge.",
            "Choose per-VRF or per-CE allocation deliberately — it changes egress behavior.",
            "Keep the BGP next hop and the locator in the same failure domain you expect to track.",
            "Use a unique RD per PE per VRF so multihomed sites keep distinct paths.",
          ]}
        />
      </GuideSection>

      <GuideSection id="vd-evpn" eyebrow="Master it" title="Beyond L3VPN" tone="cyan">
        <CompareCards
          items={[
            { title: "L3 services", tone: "ip", tag: "L3 Service TLV", points: ["IPv4 / IPv6 VPN", "Global IPv4 / IPv6 over SRv6"] },
            { title: "L2 services", tone: "ethernet", tag: "L2 Service TLV", points: ["EVPN over SRv6", "End.DX2 / End.DT2U / End.DT2M"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="vd-myths" eyebrow="Master it" title="Common misconceptions" tone="warning">
        <Misconceptions
          items={[
            { myth: "SRv6 replaces the BGP VPN machinery.", correction: "VRFs, RD, RT and MP-BGP stay; only the service instruction changes." },
            { myth: "The service SID is the BGP next hop.", correction: "Two fields, two prefixes, two reachability checks." },
            { myth: "P routers need customer routes.", correction: "They route on the egress PE's locator only." },
            { myth: "The RD decides which VRF imports a route.", correction: "The RT does." },
            { myth: "If BGP is Established, the VPN works.", correction: "Families, RTs, SIDs and locators can each still fail." },
          ]}
        />
      </GuideSection>

      <GuideSection id="vd-quiz" eyebrow="Master it" title="Knowledge check" tone="cyan">
        <KnowledgeQuiz questions={QUIZ} />
      </GuideSection>

      <GuideSection id="vd-explain" eyebrow="Master it" title="Can you explain it?" tone="violet">
        <ExplainIt
          items={[
            { q: "How can CUST-A and CUST-B both use 10.20.1.0/24?", a: "Separate VRFs on each PE, different RDs in BGP, different RTs for import — and the ingress interface decides which VRF a packet uses." },
            { q: "What happens at PE2 when a packet for …:2:41:: arrives?", a: "The DA matches End.DT4 for CUST-A: PE2 removes the outer header and looks the inner destination up in CUST-A." },
            { q: "Why was nothing installed although BGP and the next hop were fine?", a: "The SID's locator was missing from the IGP, so the SID could not be resolved." },
            { q: "Why can IPv6 break while IPv4 works?", a: "Each family has its own af, SID and session negotiation." },
            { q: "Why does an RT mistake make the route disappear from PE1, not just from its VRF?", a: "RT filtering: a PE keeps only routes that one of its VRFs imports." },
          ]}
        />
      </GuideSection>

      <GuideSection id="vd-glossary" eyebrow="Master it" title="Glossary" tone="cyan">
        <Glossary
          items={[
            { term: "RFC 4364 / RFC 9252", def: "BGP/MPLS IP VPNs; BGP overlay services over SRv6." },
            { term: "VPNv4 / VPNv6", def: "BGP families carrying RD:prefix customer routes." },
            { term: "Prefix-SID attribute", def: "BGP attribute carrying the SRv6 service SID (L3 Service TLV)." },
            { term: "End.DT4 / DT6 / DT46", def: "Decapsulate and look up in a VRF." },
            { term: "End.DX4 / DX6", def: "Decapsulate and send to one CE next hop." },
            { term: "RT filtering", def: "A PE drops VPN routes no local VRF imports." },
            { term: "SID transposition", def: "Carrying part of the SID in the label field to pack BGP updates." },
          ]}
        />
      </GuideSection>

      <GuideSection id="vd-mental" eyebrow="Master it" title="Mental model" tone="violet">
        <p>BGP is the address book, the service SID is the label on the parcel, and the locator is the depot&apos;s place on the road map. The address book can be perfect and the label correct — if the depot isn&apos;t on the map, no truck gets there.</p>
      </GuideSection>

      <GuideSection id="vd-practice" eyebrow="Master it" title="Practice in the SRv6 L3VPN Lab" tone="violet">
        <p>Six Learn levels, then the workspace: PE, P, RR1 and CE windows, IOS XR consoles, pings between two customers with overlapping addresses, five challenges and the five tickets above.</p>
        <LabBridge />
        <PresentationBridge>Rewatch the SRv6 L3VPN presentation.</PresentationBridge>
      </GuideSection>
    </div>
  );
}
