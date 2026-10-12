import { Callout, ChecklistCard, DArrow, DIAGRAM as D, DNode, DPill, DiagramFrame, DiagramSvg, FailureSignatures, FieldTable, Glossary, GuideSection, Misconceptions, Mono, TroubleshootingFlow } from "@/components/lesson/GuideBlocks";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { ExplainIt, KnowledgeQuiz, PracticeBridge, type KnowledgeQuestion } from "@/components/lesson/GuideInteractive";
import { usePracticeLabOpener } from "@/components/lesson/FundamentalsLessonShell";
import { PresentationBridge } from "@/components/presentation/LessonPresentation";
import { CliPair, CliPanel, FailureWalk } from "@/components/lesson/GuideCli";
import { emApply, emTicket, emTicketState, type EmOs, type EmTicketId } from "@/lib/sim-engine/scenarios/emNet";
import { ARCH_COLOR, ARCH_NAME, ArchSnapshot, type Arch } from "./evoSvg";
import { EM0, EM0_JN, EM1, EM1_JN, PingResult, emCli, emOnly } from "./LessonGuideContent";

const G = { foundation: "Foundation", control: "Control plane", data: "Data plane", beyond: "Beyond the basics", ops: "Operations", trouble: "Troubleshooting", master: "Master it" };
export const EVO_DEEP_DIVE_SECTIONS: LessonGuideSectionLink[] = [
  { id: "ed-why", label: "Why five architectures exist", group: G.foundation },
  { id: "ed-matrix", label: "The full comparison", group: G.foundation },
  { id: "ed-service", label: "Service type", group: G.foundation },
  { id: "ed-discovery", label: "Discovery and signaling", group: G.control },
  { id: "ed-routes", label: "The EVPN route types", group: G.control },
  { id: "ed-type3", label: "Type 3 in detail", group: G.control },
  { id: "ed-type2", label: "Type 2 in detail", group: G.control },
  { id: "ed-rdrt", label: "RD, RT and the route reflector", group: G.control },
  { id: "ed-pw", label: "Pseudowires, or none", group: G.data },
  { id: "ed-mac", label: "The MAC learning plane", group: G.data },
  { id: "ed-labels", label: "Service labels compared", group: G.data },
  { id: "ed-bum", label: "Flooding", group: G.data },
  { id: "ed-split", label: "Split horizon", group: G.data },
  { id: "ed-mh", label: "Multihoming", group: G.beyond },
  { id: "ed-mobility", label: "MAC mobility and ARP", group: G.beyond },
  { id: "ed-failure", label: "Failure signaling", group: G.beyond },
  { id: "ed-scale", label: "Scaling characteristics", group: G.beyond },
  { id: "ed-state", label: "Who holds which state", group: G.beyond },
  { id: "ed-planes", label: "How the control plane grew", group: G.beyond },
  { id: "ed-config", label: "Configuring EVPN-MPLS", group: G.ops },
  { id: "ed-verify", label: "How to verify", group: G.ops },
  { id: "ed-migrate", label: "Migrating from VPLS", group: G.ops },
  { id: "ed-signatures", label: "Failure signatures", group: G.trouble },
  { id: "ed-ladder", label: "The troubleshooting ladder", group: G.trouble },
  { id: "ed-tickets", label: "Five faults, evidence to proof", group: G.trouble },
  { id: "ed-choose", label: "Design is requirement-driven", group: G.master },
  { id: "ed-myths", label: "Common misconceptions", group: G.master },
  { id: "ed-quiz", label: "Knowledge check", group: G.master },
  { id: "ed-explain", label: "Can you explain it?", group: G.master },
  { id: "ed-glossary", label: "Glossary", group: G.master },
  { id: "ed-mental", label: "Mental model", group: G.master },
  { id: "ed-practice", label: "Practice in the L2VPN Evolution Lab", group: G.master },
];

// Real CLI output and ping results: the L2VPN Evolution Lab's EVPN-MPLS command set and model.
const ticket = (id: EmTicketId, os: EmOs = "xr") => emTicket(id).repro.reduce((acc, a) => emApply(acc, a), emTicketState(id, 1, os));
const T = { rt: ticket("rt"), family: ticket("family"), rr: ticket("rr"), ac: ticket("ac"), transport: ticket("transport"), transportJn: ticket("transport", "junos") };

function LabBridge() {
  const openLab = usePracticeLabOpener();
  return (
    <PracticeBridge label="Open the L2VPN Evolution Lab" onPractice={openLab}>
      The CUST-A network on EVPN-MPLS, IOS XR or Junos, compared with LDP VPLS and BGP VPLS — your own copy. Nothing you do there changes your lesson progress.
    </PracticeBridge>
  );
}

const ORDER: Arch[] = ["VPWS", "VPLS", "BGP_VPLS", "H_VPLS", "EVPN"];

function Matrix({ rows, title, h = 230 }: { rows: [string, string[]][]; title: string; h?: number }) {
  return (
    <DiagramSvg h={h} label={title}>
      {ORDER.map((a, i) => (
        <text key={a} x={190 + i * 98} y={20} textAnchor="middle" fill={ARCH_COLOR[a]} fontSize={10.5} fontWeight={700}>
          {ARCH_NAME[a]}
        </text>
      ))}
      {rows.map(([dim, vals], r) => (
        <g key={dim}>
          <text x={12} y={48 + r * 36} fill={D.text} fontSize={10.5} fontWeight={700}>
            {dim}
          </text>
          {vals.map((v, i) => (
            <g key={i}>
              <rect x={144 + i * 98} y={32 + r * 36} width={92} height={28} rx={6} fill={ARCH_COLOR[ORDER[i]]} fillOpacity={0.1} stroke={ARCH_COLOR[ORDER[i]]} strokeOpacity={0.5} />
              <text x={190 + i * 98} y={50 + r * 36} textAnchor="middle" fill={D.text} fontSize={9}>
                {v}
              </text>
            </g>
          ))}
        </g>
      ))}
    </DiagramSvg>
  );
}

function PlaneShift() {
  const rows: [Arch, string[], string[]][] = [
    ["VPWS", ["targeted LDP", "PW label"], []],
    ["VPLS", ["targeted LDP mesh", "PW labels"], ["MAC learning", "BUM flood"]],
    ["BGP_VPLS", ["BGP discovery", "label blocks"], ["MAC learning", "BUM flood"]],
    ["H_VPLS", ["spoke + mesh PWs"], ["MAC learning", "BUM flood"]],
    ["EVPN", ["BGP discovery", "labels", "MAC/IP (Type 2)", "ES / DF"], ["local learning", "BUM (Type 3 list)"]],
  ];
  return (
    <DiagramSvg h={230} label="Which functions live in the control plane versus the data plane for each architecture; EVPN moves MAC/IP reachability into the control plane">
      <text x={250} y={18} textAnchor="middle" fill={D.bgp} fontSize={10.5} fontWeight={700}>
        control plane
      </text>
      <text x={530} y={18} textAnchor="middle" fill={D.success} fontSize={10.5} fontWeight={700}>
        data plane
      </text>
      {rows.map(([a, cp, dp], i) => (
        <g key={a}>
          <text x={12} y={48 + i * 40} fill={ARCH_COLOR[a]} fontSize={10.5} fontWeight={700}>
            {ARCH_NAME[a]}
          </text>
          <text x={250} y={48 + i * 40} textAnchor="middle" fill={D.text} fontSize={9.5}>
            {cp.join(" · ")}
          </text>
          <text x={530} y={48 + i * 40} textAnchor="middle" fill={D.text} fontSize={9.5}>
            {dp.join(" · ") || "(no MAC decisions)"}
          </text>
        </g>
      ))}
    </DiagramSvg>
  );
}

function MhDiagram() {
  return (
    <DiagramSvg h={190} label="A dual-homed CE: traditional VPLS needs vendor or active/standby mechanisms; EVPN uses an Ethernet Segment with DF election and aliasing">
      <text x={160} y={20} textAnchor="middle" fill={ARCH_COLOR.VPLS} fontSize={11} fontWeight={700}>
        traditional VPLS family
      </text>
      <DNode x={160} y={150} label="CE" accent={D.ip} w={70} h={30} />
      <DNode x={90} y={70} label="PE A" accent={D.mpls} w={70} h={30} />
      <DNode x={230} y={70} label="PE B" accent={D.faint} w={70} h={30} />
      <DArrow x1={150} y1={134} x2={100} y2={86} color={D.success} />
      <DArrow x1={170} y1={134} x2={220} y2={86} color={D.faint} />
      <text x={160} y={184} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        typically active/standby, design- or vendor-specific
      </text>
      <text x={480} y={20} textAnchor="middle" fill={ARCH_COLOR.EVPN} fontSize={11} fontWeight={700}>
        EVPN
      </text>
      <DNode x={480} y={150} label="CE" accent={D.ip} w={70} h={30} />
      <DNode x={410} y={70} label="PE A · DF" accent={D.success} w={80} h={30} />
      <DNode x={550} y={70} label="PE B" accent={D.success} w={70} h={30} />
      <DArrow x1={470} y1={134} x2={420} y2={86} color={D.success} />
      <DArrow x1={490} y1={134} x2={540} y2={86} color={D.success} />
      <DPill x={480} y={110} text="ESI" color={D.success} w={50} />
      <text x={480} y={184} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        all-active or single-active, DF election, aliasing
      </text>
    </DiagramSvg>
  );
}

function FailureDiagram() {
  return (
    <DiagramSvg h={170} label="Traditional families recover MAC state by aging, relearning or optional MAC withdrawal; EVPN withdraws routes and can mass-withdraw per Ethernet Segment">
      <DPill x={160} y={40} text="PW / PE failure" color={D.danger} w={150} />
      <DArrow x1={160} y1={54} x2={160} y2={84} color={D.faint} width={1.4} />
      <DPill x={160} y={100} text="stale MACs age out or relearn" color={D.warning} w={230} />
      <text x={160} y={140} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        optional LDP MAC Address Withdrawal
      </text>
      <DPill x={480} y={40} text="link / ES failure" color={D.danger} w={150} />
      <DArrow x1={480} y1={54} x2={480} y2={84} color={D.faint} width={1.4} />
      <DPill x={480} y={100} text="route withdrawal (per-ES mass withdraw)" color={D.success} w={270} />
      <text x={480} y={140} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        remote PEs update without waiting for traffic
      </text>
    </DiagramSvg>
  );
}

function ScaleDiagram() {
  return (
    <DiagramSvg h={150} label="Five thumbnails with their dominant scaling concern">
      {ORDER.map((a, i) => (
        <g key={a}>
          <ArchSnapshot arch={a} cx={68 + i * 126} cy={55} />
          <text x={68 + i * 126} y={118} textAnchor="middle" fill={ARCH_COLOR[a]} fontSize={10} fontWeight={700}>
            {ARCH_NAME[a]}
          </text>
          <text x={68 + i * 126} y={136} textAnchor="middle" fill={D.muted} fontSize={8.5}>
            {["1 PW per service", "n(n−1)/2 PWs", "BGP state, same mesh", "core mesh + spokes", "BGP routes per MAC/IP"][i]}
          </text>
        </g>
      ))}
    </DiagramSvg>
  );
}

const QUIZ: KnowledgeQuestion[] = [
  {
    id: "q-bgpvpls",
    prompt: "BGP VPLS and EVPN both use BGP. What does only EVPN carry in it?",
    options: [
      { id: "a", label: "Customer MAC addresses (Type 2 routes)" },
      { id: "b", label: "The route target of the service" },
      { id: "c", label: "Which PEs belong to the service" },
    ],
    correctId: "a",
    explanation: "Both discover members from BGP routes with a route target. Only EVPN advertises the MACs themselves; BGP VPLS still learns them from frames.",
  },
  {
    id: "q-missing",
    prompt: "In a healthy BGP VPLS, PE1 has no MAC entry for CE3. What is the most likely reason?",
    options: [
      { id: "a", label: "CE3 hasn't sent a frame that crossed the pseudowire to PE1 yet" },
      { id: "b", label: "PE3 didn't advertise CE3's MAC in BGP" },
      { id: "c", label: "The label block is too small" },
    ],
    correctId: "a",
    explanation: "VPLS learns remote MACs only from frames. No BGP route for a MAC exists in BGP VPLS.",
  },
  {
    id: "q-type3",
    prompt: "What does a PE's Type 3 route give the other PEs?",
    options: [
      { id: "a", label: "Its membership in the EVI and the label to use when flooding to it" },
      { id: "b", label: "Its customers' MAC addresses" },
      { id: "c", label: "A pseudowire to build" },
    ],
    correctId: "a",
    explanation: "Type 3 (inclusive multicast) puts the PE on the others' flood lists, with its inclusive-multicast label in the PMSI tunnel attribute.",
  },
  {
    id: "q-label",
    prompt: "PE3 receives a frame carrying its inclusive-multicast label. What does it do?",
    options: [
      { id: "a", label: "Delivers it to its local attachment circuits only" },
      { id: "b", label: "Floods it to its CEs and to every other PE" },
      { id: "c", label: "Looks up the destination MAC and forwards it into the core" },
    ],
    correctId: "a",
    explanation: "The ingress PE already sent a copy to every PE. Sending it back into the core would loop.",
  },
  {
    id: "q-transport",
    prompt: "P1 loses LDP toward P3. Which architectures does that break for CE3?",
    options: [
      { id: "a", label: "All of them — every one rides the same transport LSP" },
      { id: "b", label: "Only the VPLS variants" },
      { id: "c", label: "Only EVPN" },
    ],
    correctId: "a",
    explanation: "The service label always rides under a transport label. Without an LSP to the remote PE, no architecture delivers.",
  },
];

export function EvoDeepDiveContent() {
  return (
    <div className="space-y-12">
      <GuideSection id="ed-why" eyebrow="Foundation" title="Why five architectures exist" tone="violet">
        <p>Each architecture in this lesson exists because the one before it hit a limit. VPWS gives two sites a wire. VPLS (RFC 4762) adds a bridge per PE and a full mesh to make a LAN of many sites. BGP VPLS (RFC 4761) removes the per-pair configuration by letting BGP discover members and signal labels. H-VPLS shrinks the mesh by adding a tier. EVPN (RFC 7432) moves MAC learning into BGP, which makes multihoming, mobility and ARP suppression possible.</p>
        <p>None of them is obsolete: a two-site customer still needs only VPWS, and a small, stable LAN runs fine on LDP VPLS. What changes is which problems each one solves — and at what cost.</p>
      </GuideSection>

      <GuideSection id="ed-matrix" eyebrow="Foundation" title="The full comparison" tone="violet">
        <DiagramFrame caption="The lesson's comparison dimensions, condensed.">
          <Matrix
            title="Comparison matrix of five architectures across service type, discovery, signaling, MAC plane and multihoming"
            rows={[
              ["Service", ["point-to-point", "multipoint", "multipoint", "multipoint", "multipoint*"]],
              ["Discovery", ["manual", "manual", "BGP (RT)", "manual†", "BGP (RT)"]],
              ["Signaling", ["targeted LDP", "targeted LDP", "BGP blocks", "spoke+mesh", "BGP EVPN"]],
              ["MAC plane", ["n/a", "data", "data", "data", "control"]],
              ["Multihoming", ["—", "not native", "not native", "not native", "native (ES)"]],
            ]}
          />
        </DiagramFrame>
        <p className="text-xs text-pv-text-faint">* EVPN also has a point-to-point form (EVPN-VPWS, RFC 8214). † H-VPLS can be combined with a BGP-signaled core.</p>
      </GuideSection>

      <GuideSection id="ed-service" eyebrow="Foundation" title="Service type" tone="mpls">
        <p>VPWS is point-to-point: no bridging, no MAC table — every frame goes to the one remote end. Every VPLS variant and EVPN provide a multipoint bridge domain. EVPN also covers point-to-point (EVPN-VPWS) and runs over VXLAN as well as MPLS (RFC 8365): one control plane for several services and encapsulations.</p>
      </GuideSection>

      <GuideSection id="ed-discovery" eyebrow="Control plane" title="Discovery and signaling" tone="bgp">
        <FieldTable
          title="How PEs find each other and exchange service labels"
          accent="bgp"
          columns={["Architecture", "Discovery", "Signaling"]}
          rows={[
            ["VPWS", "remote PE configured", "targeted LDP (PW ID FEC)"],
            ["LDP VPLS", "every pair configured", "targeted LDP per pair"],
            ["BGP VPLS", "BGP, RT import", "label blocks in the VPLS route"],
            ["BGP-AD VPLS (RFC 6074)", "BGP, RT import", "targeted LDP"],
            ["H-VPLS", "configured per tier", "spoke and mesh pseudowires"],
            ["EVPN", "BGP, RT import (Type 3)", "labels in EVPN routes (Types 2 and 3)"],
          ]}
        />
        <p>Discovery and signaling are separate jobs. BGP-AD VPLS shows it best: BGP finds the members, LDP still signals the pseudowires.</p>
      </GuideSection>

      <GuideSection id="ed-routes" eyebrow="Control plane" title="The EVPN route types" tone="bgp">
        <FieldTable
          title="EVPN NLRI route types (AFI 25 / SAFI 70)"
          accent="bgp"
          columns={["Type", "Name", "What it says", "In the lab"]}
          rows={[
            ["1", "Ethernet auto-discovery", "this PE is attached to this Ethernet segment (multihoming, mass withdrawal, aliasing)", "—"],
            ["2", "MAC/IP advertisement", "this MAC (and IP) is behind this PE, with this label", "✓"],
            ["3", "Inclusive multicast Ethernet tag", "this PE is in this EVI; flood to it with this label", "✓"],
            ["4", "Ethernet segment", "discover the PEs sharing a segment; elect the designated forwarder", "—"],
            ["5", "IP prefix (RFC 9136)", "an IP prefix behind this PE (routing between subnets)", "—"],
          ]}
        />
        <Callout tone="cyan" title="Single-homed sites need two types" icon="i">
          With every CE attached to one PE, as in the lab, Types 2 and 3 do all the work. Types 1 and 4 appear as soon as a CE is attached to two PEs.
        </Callout>
      </GuideSection>

      <GuideSection id="ed-type3" eyebrow="Control plane" title="Type 3 in detail" tone="bgp">
        <p>The inclusive-multicast route carries the RD, an Ethernet tag (0 in a VLAN-based service) and the originating router&apos;s IP. Its <b className="text-pv-text">PMSI tunnel attribute</b> says how to flood to it: with ingress replication (tunnel type 6), it carries the PE&apos;s inclusive-multicast label. Every PE that imports the route adds the originator to its flood list.</p>
        <CliPair cisco={emOnly(EM0, "PE1", "cisco", "show bgp l2vpn evpn", /Network|Route Distinguisher|\*>|Processed/)} junos={emOnly(EM0_JN, "PE1", "juniper", "show route table bgp.evpn.0", /bgp\.evpn|IM|BGP\/170|Push/)} ciscoCaption="IOS XR · PE1 before any traffic — only Type 3 routes: [3][0][32][originator]" junosCaption="Junos · PE1 — the two remote Type 3 routes, each usable over an LSP" />
      </GuideSection>

      <GuideSection id="ed-type2" eyebrow="Control plane" title="Type 2 in detail" tone="bgp">
        <FieldTable
          title="MAC/IP advertisement route fields"
          accent="bgp"
          columns={["Field", "Meaning"]}
          rows={[
            ["RD", "keeps the route unique (65000:3 for PE3)"],
            ["ESI", "the Ethernet segment (0 for a single-homed CE)"],
            ["Ethernet tag", "0 in a VLAN-based service"],
            ["MAC address", "the host's MAC"],
            ["IP address", "optional: the host's IPv4 or IPv6 address, once seen"],
            ["MPLS label 1", "the label to push to reach this MAC (the lab: the PE's unicast label)"],
            ["MPLS label 2", "optional: a label for routing (integrated routing and bridging)"],
          ]}
        />
        <p>A PE advertises a MAC-only route when it learns a MAC, and a MAC+IP route once it has seen the host&apos;s ARP. Both carry the route target, so import works exactly as for Type 3.</p>
        <CliPanel run={emOnly(EM1, "RR1", "cisco", "show bgp l2vpn evpn", /Route Distinguisher|\[2\]|\[3\]|Processed/)} caption="IOS XR · RR1 after one ping — MAC-only (/104) and MAC+IP (/136) routes for CE1 and CE3" />
      </GuideSection>

      <GuideSection id="ed-rdrt" eyebrow="Control plane" title="RD, RT and the route reflector" tone="bgp">
        <p>Nothing new here — and that is the point. The RD keeps each PE&apos;s routes distinct, the route target decides import, the route reflector reflects client routes to every client. An EVPN service fails on a wrong route target, a missing address family or a non-reflecting RR exactly as a BGP VPLS or an L3VPN does.</p>
        <CliPanel run={emOnly(EM0, "RR1", "cisco", "show running-config router bgp", /^router bgp|neighbor|address-family|route-reflector/)} caption="IOS XR · RR1 — every PE a client for the l2vpn evpn family" />
      </GuideSection>

      <GuideSection id="ed-pw" eyebrow="Data plane" title="Pseudowires, or none" tone="violet">
        <FieldTable
          title="Service relationships for N sites"
          accent="violet"
          columns={["Architecture", "What has to be up"]}
          rows={[
            ["VPWS", "one pseudowire per point-to-point service"],
            ["LDP / BGP VPLS", "N(N−1)/2 pseudowires (BGP VPLS signals them automatically)"],
            ["H-VPLS", "a core mesh among hubs + one spoke per access site"],
            ["EVPN-MPLS", "no pseudowires: BGP sessions (usually to RRs) and labels from routes"],
          ]}
        />
        <CliPanel run={emOnly(EM0, "PE1", "cisco", "show l2vpn bridge-domain", /bridge-domain|ACs:|EVPNs|EVPN,/)} caption="IOS XR · PE1 — PWs: 0, one EVPN in the bridge domain" />
      </GuideSection>

      <GuideSection id="ed-mac" eyebrow="Data plane" title="The MAC learning plane" tone="success">
        <p>In every VPLS variant a PE learns a remote MAC only after a frame from it crosses a pseudowire. An EVPN PE learns <i>local</i> MACs from frames in exactly the same way, but advertises them; remote PEs learn them from routes and never from the core. Withdrawing the route removes the MAC everywhere.</p>
        <CliPair cisco={emCli(EM1, "PE2", "cisco", "show evpn evi vpn-id 100 mac")} junos={emCli(EM1_JN, "PE2", "juniper", "show evpn mac-table")} ciscoCaption="IOS XR · PE2 — CE1 and CE3, neither ever sent a frame to PE2" junosCaption="Junos · PE2 — flags DC: dynamic, control plane" />
        <Callout tone="warning" title="BGP is not control-plane learning" icon="!">
          BGP VPLS uses BGP, yet learns MACs in the data plane. The protocol name doesn&apos;t decide the learning plane; what the routes carry does.
        </Callout>
      </GuideSection>

      <GuideSection id="ed-labels" eyebrow="Data plane" title="Service labels compared" tone="mpls">
        <FieldTable
          title="Who allocates the inner label, and per what"
          accent="mpls"
          columns={["Architecture", "Inner label", "Allocated per"]}
          rows={[
            ["VPWS / LDP VPLS", "pseudowire label (targeted LDP)", "pseudowire"],
            ["BGP VPLS", "base + sender's VE ID − offset", "label block, slot per remote VE"],
            ["EVPN (unicast)", "label 1 of the Type 2 route", "EVI (the lab), or MAC"],
            ["EVPN (flooded)", "label in the Type 3 route's PMSI attribute", "EVI"],
          ]}
        />
        <p>The lab allocates one unicast label per EVI on each PE (per-EVI allocation, what Junos shows as the &quot;per-instance MAC route label&quot;); per-MAC allocation also exists. Either way, the label on the frame tells the egress PE which EVI, and whether the frame was flooded.</p>
        <CliPanel run={emOnly(EM0_JN, "PE1", "juniper", "show route table mpls.0", /mpls\.0:|^\d+\s|to table/)} caption="Junos · PE1 — the two EVPN labels in mpls.0: 301010 (MAC routes), 301011 (ingress IM)" />
      </GuideSection>

      <GuideSection id="ed-bum" eyebrow="Data plane" title="Flooding" tone="warning">
        <FieldTable
          title="Broadcast, unknown unicast, multicast"
          accent="warning"
          columns={["Architecture", "Who gets a copy", "How"]}
          rows={[
            ["LDP / BGP VPLS", "every PE with a pseudowire", "ingress replication over the pseudowires"],
            ["H-VPLS", "local ACs and spokes, then mesh peers", "replicated at each tier"],
            ["EVPN", "every PE with a usable Type 3 route", "ingress replication or a multicast tree"],
          ]}
        />
        <p>EVPN reduces unknown unicast — a MAC is known everywhere once one PE has learned it — and can answer ARP locally, but broadcasts themselves remain.</p>
      </GuideSection>

      <GuideSection id="ed-split" eyebrow="Data plane" title="Split horizon" tone="danger">
        <FieldTable
          title="Loop prevention"
          accent="danger"
          columns={["Architecture", "Rule"]}
          rows={[
            ["VPWS", "not applicable (one remote end)"],
            ["LDP / BGP VPLS", "pseudowire → pseudowire forbidden"],
            ["H-VPLS", "only mesh → mesh forbidden; spokes behave like ACs"],
            ["EVPN", "a flooded frame (IM label) never re-enters the core; ESI-based split horizon and DF election for multihomed segments"],
          ]}
        />
      </GuideSection>

      <GuideSection id="ed-mh" eyebrow="Beyond the basics" title="Multihoming" tone="success">
        <DiagramFrame caption="Native multihoming is one of EVPN's defining additions.">
          <MhDiagram />
        </DiagramFrame>
        <p>A CE attached to two PEs forms an <b className="text-pv-text">Ethernet segment</b> with an ESI. Type 4 routes let the PEs find each other and elect a designated forwarder for flooded traffic; Type 1 routes let remote PEs load-balance toward both (aliasing) and drop every MAC of the segment with one withdrawal when a link fails (mass withdrawal). Data-plane learning has none of these tools: in a VPLS, the second PE must stay standby.</p>
      </GuideSection>

      <GuideSection id="ed-mobility" eyebrow="Beyond the basics" title="MAC mobility and ARP" tone="success">
        <p>When a host moves to another site, its new PE advertises the MAC with a <b className="text-pv-text">MAC mobility</b> extended community and a higher sequence number; every PE switches to the new route at once, and a MAC that flaps too often is flagged as a duplicate. A VPLS PE would keep sending to the old pseudowire until the entry aged out or a frame from the new location arrived.</p>
        <p>MAC+IP routes let a PE answer ARP for remote hosts itself (proxy ARP / ARP suppression, RFC 9161), cutting broadcast across the core.</p>
      </GuideSection>

      <GuideSection id="ed-failure" eyebrow="Beyond the basics" title="Failure signaling" tone="danger">
        <DiagramFrame caption="Data-plane state recovers through traffic; control-plane state recovers through routes.">
          <FailureDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="ed-scale" eyebrow="Beyond the basics" title="Scaling characteristics" tone="cyan">
        <DiagramFrame caption="Each architecture moves the scaling pressure somewhere else; none removes it.">
          <ScaleDiagram />
        </DiagramFrame>
        <p>EVPN trades pseudowire state for BGP state: one route per PE per EVI (Type 3) plus one or two per MAC (Type 2). Route reflectors and RT constraint keep that manageable; the MAC count is now visible in the control plane — which is also where you can limit it.</p>
      </GuideSection>

      <GuideSection id="ed-state" eyebrow="Beyond the basics" title="Who holds which state" tone="violet">
        <FieldTable
          title="State ownership"
          accent="violet"
          columns={["Node", "Customer MACs", "Pseudowire / VPLS route state", "EVPN routes"]}
          rows={[
            ["P router (any)", "✕", "✕ transport labels only", "✕"],
            ["LDP VPLS PE", "✓", "✓ pseudowires", "✕"],
            ["BGP VPLS route reflector", "✕", "VPLS routes only", "✕"],
            ["BGP VPLS PE", "✓", "✓ pseudowires + VPLS routes", "✕"],
            ["EVPN route reflector", "✕ (only as routes)", "✕", "✓ reflects them"],
            ["EVPN PE", "✓", "✕", "✓"],
          ]}
        />
      </GuideSection>

      <GuideSection id="ed-planes" eyebrow="Beyond the basics" title="How the control plane grew" tone="bgp">
        <DiagramFrame caption="Functions move from the data plane to the control plane only in the last step.">
          <PlaneShift />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="ed-config" eyebrow="Operations" title="Configuring EVPN-MPLS" tone="mpls">
        <p>On IOS XR the EVI, the bridge domain and BGP are three separate blocks: <Mono>evpn evi 100</Mono> holds the RD, the route targets and <Mono>advertise-mac</Mono>; the bridge domain references the EVI with <Mono>evi 100</Mono>; BGP activates <Mono>address-family l2vpn evpn</Mono> globally and per neighbor. On Junos one routing instance of type <Mono>evpn</Mono> holds all of it, the attachment unit uses <Mono>encapsulation vlan-bridge</Mono>, and BGP carries <Mono>family evpn signaling</Mono>.</p>
        <CliPair cisco={emOnly(EM0, "PE1", "cisco", "show running-config", /^interface GigabitEthernet0\/0\/0\/1\.100|dot1q|^evpn|evi 100|bgp$|rd |route-target|advertise-mac|^l2vpn|bridge|interface GigabitEthernet0\/0\/0\/1\.100$|^router bgp|neighbor 9|address-family l2vpn evpn/)} junos={emCli(EM0_JN, "PE1", "juniper", "show configuration routing-instances")} ciscoCaption="IOS XR · PE1 — EVI, bridge domain, BGP family" junosCaption="Junos · PE1 — the EVPN routing instance" />
        <CliPanel run={emCli(EM0_JN, "PE1", "juniper", "show configuration interfaces ge-0/0/1")} caption="Junos · PE1 — the attachment unit: vlan-bridge, VLAN 100" />
        <Callout tone="warning" title="Two IOS XR details that bite" icon="!">
          A bridge domain without <Mono>evi 100</Mono> is a local bridge only — nothing is advertised. And without <Mono>advertise-mac</Mono> the PE sends Type 3 routes but no Type 2 routes: everything still works, by flooding.
        </Callout>
      </GuideSection>

      <GuideSection id="ed-verify" eyebrow="Operations" title="How to verify" tone="success">
        <FieldTable
          title="Verification, bottom to top"
          accent="success"
          columns={["Question", "IOS XR", "Junos"]}
          rows={[
            ["Transport to every PE?", <Mono key="1">show mpls forwarding</Mono>, <Mono key="2">show route table inet.3</Mono>],
            ["EVPN family with the RR?", <Mono key="3">show bgp l2vpn evpn summary</Mono>, <Mono key="4">show bgp summary</Mono>],
            ["Which routes, from whom?", <Mono key="5">show bgp l2vpn evpn</Mono>, <Mono key="6">show route table bgp.evpn.0</Mono>],
            ["The EVI: labels, RT, flood list?", <Mono key="7">show evpn evi vpn-id 100 detail · inclusive-multicast</Mono>, <Mono key="8">show evpn instance EVPN-A extensive</Mono>],
            ["MACs, local and remote?", <Mono key="9">show evpn evi vpn-id 100 mac</Mono>, <Mono key="10">show evpn database instance EVPN-A</Mono>],
          ]}
        />
        <CliPair cisco={emOnly(EM0, "PE1", "cisco", "show evpn evi vpn-id 100 detail", /VPN-ID|^100 |Unicast|Multicast Label|Advertise|RD Config|Import|Export/)} junos={emOnly(EM0_JN, "PE1", "juniper", "show evpn instance EVPN-A extensive", /Instance|Route Dist|label|neighbors|Address|^    \d|Inclusive/)} ciscoCaption="IOS XR · PE1 — labels 24010 / 24011, RT 65000:100" junosCaption="Junos · PE1 — labels 301010 / 301011, two neighbors" />
      </GuideSection>

      <GuideSection id="ed-migrate" eyebrow="Operations" title="Migrating from VPLS" tone="warning">
        <p>The lesson&apos;s first ticket is a migration: PEs moved one at a time from BGP VPLS to EVPN. During such a migration, PEs running VPLS and PEs running EVPN must still form one LAN. RFC 8560 (seamless integration) describes how: a PE running both keeps its VPLS pseudowires to VPLS-only PEs and uses EVPN routes toward EVPN PEs, until the last VPLS PE is gone.</p>
        <ChecklistCard tone="warning" mark="→" title="What usually goes wrong" items={["a migrated PE keeps an old or mistyped route target", "the neighbor configuration doesn't activate the EVPN family", "a rebuilt route reflector isn't reflecting the new family", "a port changes and the CE's VLAN no longer lands in the EVI"]} />
      </GuideSection>

      <GuideSection id="ed-signatures" eyebrow="Troubleshooting" title="Failure signatures" tone="danger">
        <FailureSignatures
          items={[
            { tag: "RT", title: "Wrong route target", tone: "danger", points: ["RR1 holds the routes", "the others don't import them"] },
            { tag: "AF", title: "EVPN family missing", tone: "danger", points: ["session Established", "no EVPN route either way"] },
            { tag: "RR", title: "Not reflecting", tone: "danger", points: ["RR1 has every route", "every flood list empty"] },
            { tag: "AC", title: "VLAN not in the EVI", tone: "violet", points: ["control plane perfect", "one CE's frames dropped at its PE"] },
            { tag: "LSP", title: "Transport broken", tone: "warning", points: ["XR: drops in the core", "Junos: routes unusable"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="ed-ladder" eyebrow="Troubleshooting" title="The troubleshooting ladder" tone="danger">
        <TroubleshootingFlow
          steps={[
            { question: "Which pairs of sites fail?", look: "A pattern: one site, one PE, everyone." },
            { question: "Does every CE's VLAN land in the EVI?", look: "Sub-interface VLAN and bridge-domain / instance membership." },
            { question: "Does every PE exchange EVPN routes with the RR?", look: "Established is not enough: the family must be negotiated." },
            { question: "Does every PE keep every other PE's Type 3 route?", look: "The flood lists; received versus imported." },
            { question: "Do the MACs arrive as Type 2 routes?", look: "Remote MACs with next hop and label." },
            { question: "Is the transport LSP complete?", look: "A label to every PE loopback, on every hop." },
          ]}
        />
      </GuideSection>

      <GuideSection id="ed-tickets" eyebrow="Troubleshooting" title="Five faults, evidence to proof" tone="danger">
        <FailureWalk
          title="1 · PE3 after the migration"
          normal="Every PE's EVI imports and exports 65000:100."
          change="PE3's EVI uses 65000:999."
          evidence={<CliPanel run={emCli(T.rt, "PE1", "cisco", "show evpn evi vpn-id 100 inclusive-multicast")} caption="IOS XR · PE1 — no 3.3.3.3 on the flood list" />}
          next="PE1 and PE2 drop PE3's routes, PE3 drops theirs: no flooding to PE3, no MACs from it."
          fix={<Mono>PE3: evpn → evi 100 → bgp → route-target import / export 65000:100 → commit</Mono>}
          proof="Both other PEs on every flood list; a fresh ping from CE1 reaches CE3."
        />
        <FailureWalk
          title="2 · PE2 hears nothing"
          normal="Every PE activates the EVPN family toward RR1."
          change="PE2's copied neighbor configuration has no address-family l2vpn evpn."
          evidence={<CliPanel run={emOnly(T.family, "PE2", "cisco", "show bgp l2vpn evpn summary", /Neighbor|^9\.9\.9\.9/)} caption="IOS XR · PE2 — Established, 0 routes" />}
          next="No route crosses the session: PE2's flood list is empty and nobody floods to PE2."
          fix={<Mono>PE2: router bgp 65000 → neighbor 9.9.9.9 → address-family l2vpn evpn → commit</Mono>}
          proof="PE2 receives routes again; a fresh ping from CE2 reaches CE1."
        />
        <FailureWalk
          title="3 · A new route reflector"
          normal="Every PE is a route-reflector client of RR1."
          change="The rebuilt RR1 has no route-reflector-client statements."
          evidence={<CliPanel run={emOnly(T.rr, "PE1", "cisco", "show bgp l2vpn evpn", /Route Distinguisher|\*>|Processed/)} caption="IOS XR · PE1 — only its own routes" />}
          next="RR1 holds every route and reflects none: every PE is alone."
          fix={<Mono>RR1: neighbor 1.1.1.1 / 2.2.2.2 / 3.3.3.3 → address-family l2vpn evpn → route-reflector-client → commit</Mono>}
          proof="Every flood list complete; a fresh ping from CE1 reaches CE2."
        />
        <FailureWalk
          title="4 · The control plane looks perfect"
          normal="CE2's VLAN 100 lands in PE2's bridge domain."
          change="PE2's sub-interface toward CE2 now accepts VLAN 200."
          evidence={<CliPanel run={emOnly(T.ac, "PE2", "cisco", "show running-config", /^interface GigabitEthernet0\/0\/0\/1\.100|dot1q/)} caption="IOS XR · PE2 — encapsulation dot1q 200" />}
          next="CE2's frames are dropped at PE2's attachment circuit, while every route is in place."
          fix={<Mono>PE2: interface Gi0/0/0/1.100 l2transport → encapsulation dot1q 100 → commit</Mono>}
          proof="A fresh ping from CE2 reaches CE1."
        />
        <FailureWalk
          title="5 · After the P1 upgrade"
          normal="LDP runs on every core link."
          change="P1 no longer runs LDP toward P3."
          evidence={<CliPanel run={emOnly(T.transport, "P1", "cisco", "show mpls forwarding", /Local|Label  |----|3\.3\.3\.3/)} caption="IOS XR · P1 — Unlabelled toward 3.3.3.3" />}
          next="IOS XR: P3 receives PE3's EVPN label and drops it. Junos: PE3's routes become unusable without an LSP."
          fix={<Mono>P1: mpls ldp → interface GigabitEthernet0/0/0/2 → commit</Mono>}
          proof="A complete LSP to 3.3.3.3; a fresh ping from CE1 reaches CE3."
        />
        <PingResult s={T.transportJn} title="Junos, the same fault: what the ping reports" />
      </GuideSection>

      <GuideSection id="ed-choose" eyebrow="Master it" title="Design is requirement-driven" tone="cyan">
        <ChecklistCard
          tone="cyan"
          mark="→"
          title="Operational complexity cuts both ways"
          items={["VPWS: minimal state, but only two endpoints.", "LDP VPLS: simple concepts, heavy mesh configuration at scale.", "BGP VPLS: automation, but requires an L2VPN BGP design and route reflectors.", "H-VPLS: a smaller core mesh, but more tiers and roles to get right.", "EVPN: the richest features, but the most control-plane state and concepts."]}
        />
        <p>Start from the service and operational requirements, check each architecture against all of them, and prefer the simplest design that meets every one.</p>
      </GuideSection>

      <GuideSection id="ed-myths" eyebrow="Master it" title="Common misconceptions" tone="warning">
        <Misconceptions
          items={[
            { myth: "BGP VPLS advertises customer MACs.", correction: "It advertises PEs: RD, RT, VE ID, label block. MACs are learned from frames." },
            { myth: "A missing remote MAC in a VPLS is always a fault.", correction: "Often it just means that host hasn't sent anything across yet." },
            { myth: "EVPN removes flooding.", correction: "Broadcasts still go to every PE on the flood list; what shrinks is unknown unicast." },
            { myth: "EVPN needs pseudowires.", correction: "EVPN-MPLS has none: labels come from Type 2 and Type 3 routes." },
            { myth: "An Established session proves the service.", correction: "Check the family, the routes kept and the flood lists." },
          ]}
        />
      </GuideSection>

      <GuideSection id="ed-quiz" eyebrow="Master it" title="Knowledge check" tone="cyan">
        <KnowledgeQuiz questions={QUIZ} />
      </GuideSection>

      <GuideSection id="ed-explain" eyebrow="Master it" title="Can you explain it?" tone="violet">
        <ExplainIt
          items={[
            { q: "What did BGP VPLS change compared with LDP VPLS, and what did it leave alone?", a: "It moved discovery and label signaling into BGP. The pseudowire mesh and data-plane MAC learning stayed." },
            { q: "What do Type 3 and Type 2 routes each tell a PE?", a: "Type 3: this PE is in the EVI — flood to it with this label. Type 2: this MAC (and IP) is behind this PE — use this label." },
            { q: "Why can PE2 know CE3 although no frame from CE3 ever reached PE2?", a: "PE3 learned CE3 locally and advertised a Type 2 route; RR1 reflected it to PE2." },
            { q: "Why does an egress PE never flood an IM-labelled frame back into the core?", a: "The ingress PE already replicated it to every PE. Re-flooding would loop or duplicate." },
            { q: "What breaks all five architectures at once?", a: "A broken transport LSP: every service label rides under a transport label." },
          ]}
        />
      </GuideSection>

      <GuideSection id="ed-glossary" eyebrow="Master it" title="Glossary" tone="cyan">
        <Glossary
          items={[
            { term: "EVI", def: "EVPN instance: one customer's Layer 2 segment on a PE." },
            { term: "IMET", def: "Inclusive multicast Ethernet tag route (EVPN Type 3)." },
            { term: "PMSI tunnel attribute", def: "Carried by Type 3: how to flood to the PE (ingress replication: with this label)." },
            { term: "ESI", def: "Ethernet segment identifier: names a CE's set of links to one or more PEs." },
            { term: "DF election", def: "Choosing which PE of a multihomed segment forwards flooded traffic to it." },
            { term: "Aliasing", def: "Load-balancing toward every PE of a multihomed segment." },
            { term: "Mass withdrawal", def: "Withdrawing every MAC of an Ethernet segment with one route." },
            { term: "MAC mobility", def: "A sequence number on Type 2 routes so that the newest location wins." },
            { term: "Flood and learn", def: "Data-plane MAC learning: flood the unknown, learn from source addresses." },
            { term: "RT constraint", def: "Limits which VPN routes a route reflector sends to each PE." },
          ]}
        />
      </GuideSection>

      <GuideSection id="ed-mental" eyebrow="Master it" title="Mental model" tone="violet">
        <p>Line the five up and change one thing at a time: the number of endpoints, who configures the wires, how big the mesh gets, and finally whether MAC knowledge comes from traffic or from routes. Each change solves a real problem and adds its own cost; the right answer is whichever set of trade-offs your requirements can afford.</p>
      </GuideSection>

      <GuideSection id="ed-practice" eyebrow="Master it" title="Practice in the L2VPN Evolution Lab" tone="violet">
        <p>Six Learn levels compare EVPN-MPLS with LDP VPLS and BGP VPLS on the same routers; the workspace gives you every router&apos;s window and console, five challenges and the five tickets above.</p>
        <LabBridge />
        <PresentationBridge>Rewatch the L2VPN Evolution presentation.</PresentationBridge>
      </GuideSection>
    </div>
  );
}
