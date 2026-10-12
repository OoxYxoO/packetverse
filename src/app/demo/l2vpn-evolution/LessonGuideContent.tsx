import { Callout, ChecklistCard, CompareCards, DArrow, DIAGRAM as D, DPill, DiagramFrame, DiagramSvg, FailureSignatures, FieldTable, Glossary, GuideSection, Mono, TroubleshootingFlow } from "@/components/lesson/GuideBlocks";
import { DStack } from "@/components/lesson/MplsGuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { PracticeBridge } from "@/components/lesson/GuideInteractive";
import { usePracticeLabOpener } from "@/components/lesson/FundamentalsLessonShell";
import { PresentationBridge } from "@/components/presentation/LessonPresentation";
import { CliPair, CliPanel, pickLines, runGuideCli } from "@/components/lesson/GuideCli";
import type { CliVendor } from "@/lib/cli/types";
import { createVsNet, type VsCe, type VsR, type VsState } from "@/lib/sim-engine/scenarios/vsNet";
import { bvApply, createBvNet, type BvR, type BvState } from "@/lib/sim-engine/scenarios/bvNet";
import { createEmNet, emApply, emTicket, emTicketState, type EmOs, type EmR, type EmState } from "@/lib/sim-engine/scenarios/emNet";
import { vsSets, vsStaticApi } from "../mpls-vpls/vs-lab/vsCli";
import { bvSets, bvStaticApi } from "../bgp-vpls/bv-lab/bvCli";
import { emSets, emStaticApi } from "./evo-lab/emCli";
import { ARCH_COLOR, ARCH_NAME, ArchSnapshot, type Arch } from "./evoSvg";

export const EVO_LESSON_SECTIONS: LessonGuideSectionLink[] = [
  { id: "lv-mission", label: "What this lesson teaches" },
  { id: "lv-network", label: "One customer, one network" },
  { id: "lv-questions", label: "The questions to ask" },
  { id: "lv-snapshots", label: "Five architectures at a glance" },
  { id: "lv-vpws", label: "VPWS: one wire" },
  { id: "lv-vpls", label: "LDP VPLS: a bridge and a mesh" },
  { id: "lv-bgpvpls", label: "BGP VPLS: discovery moves" },
  { id: "lv-incident", label: "The missing-MAC incident" },
  { id: "lv-hvpls", label: "H-VPLS: a hierarchy" },
  { id: "lv-evpn", label: "EVPN: the segment in BGP" },
  { id: "lv-type2", label: "EVPN: the MACs in BGP" },
  { id: "lv-labels", label: "Two labels per PE" },
  { id: "lv-learning", label: "MAC reachability, compared" },
  { id: "lv-bum", label: "Flooding, compared" },
  { id: "lv-transport", label: "What never changed" },
  { id: "lv-working", label: "What working looks like" },
  { id: "lv-break", label: "When EVPN breaks" },
  { id: "lv-other", label: "Other ways it fails" },
  { id: "lv-decide", label: "How to choose" },
  { id: "lv-model", label: "Mental model" },
  { id: "lv-glossary", label: "Glossary" },
  { id: "lv-recap", label: "Recap" },
  { id: "lv-practice", label: "Practice it" },
];

/**
 * Real CLI output and ping results on this page come from the lab models — the VPLS Lab (LDP VPLS), the BGP VPLS Lab and
 * the L2VPN Evolution Lab (EVPN-MPLS) — all three on the same CUST-A network: PE1–PE3, P1–P3, RR1, CE1–CE3 on VLAN 100.
 */
const bvPing = (s: BvState, from: VsCe, dst: string) => bvApply(s, { type: "test", from, dst });
const emPing = (s: EmState, from: VsCe, dst: string) => emApply(s, { type: "test", from, dst });
const VS0 = createVsNet(0);
const VS0_JN = createVsNet(0, "junos");
const BV0 = createBvNet(0);
const BV1 = bvPing(BV0, "CE1", "192.168.100.3");
export const EM0: EmState = createEmNet(0);
export const EM0_JN: EmState = createEmNet(0, "junos");
export const EM1 = emPing(EM0, "CE1", "192.168.100.3");
export const EM1_JN = emPing(EM0_JN, "CE1", "192.168.100.3");
const EM2 = emPing(EM1, "CE1", "192.168.100.3");
const EM_CLR = emApply(EM1, { type: "clear", dev: "PE3" });
const fault = (os: EmOs) => emTicket("rt").repro.reduce((acc, a) => emApply(acc, a), emTicketState("rt", 0, os));
const EM_FAULT = fault("xr");
const EM_FAULT_JN = fault("junos");
const EM_FAULT_OK = emPing(EM_FAULT, "CE1", "192.168.100.2");
const EM_FIXED = emPing(emApply(EM_FAULT, { type: "set", text: "PE3: route target back to 65000:100", changes: [{ dev: "PE3", f: (c) => void (c.evi!.rt = "65000:100") }] }), "CE1", "192.168.100.3");
const only = (run: { output: string; prompt: string; command: string }, match: RegExp, keep = 0) => ({ ...run, output: pickLines(run.output, match, keep) });
const vsCli = (s: VsState, r: VsR, v: CliVendor, cmd: string) => runGuideCli(vsSets(vsStaticApi(s, r), r)[v], cmd);
const bvCli = (s: BvState, r: BvR, v: CliVendor, cmd: string) => runGuideCli(bvSets(bvStaticApi(s, r), r)[v], cmd);
export function emCli(s: EmState, r: EmR, vendor: CliVendor, command: string) {
  return runGuideCli(emSets(emStaticApi(s, r), r)[vendor], command);
}
export function emOnly(s: EmState, r: EmR, vendor: CliVendor, command: string, match: RegExp, keep = 0) {
  return only(emCli(s, r, vendor, command), match, keep);
}
/** One customer ping, as a lab reports it. */
export function PingResult({ s, title }: { s: { tests: { from: string; dst: string; ok: boolean; reached?: string; flooded: boolean; why?: string }[] }; title: string }) {
  const t = s.tests[s.tests.length - 1];
  return (
    <Callout tone={t.ok ? "success" : "danger"} title={title} icon={t.ok ? "✓" : "!"}>
      {t.from} → {t.dst}: {t.ok ? `delivered to ${t.reached}, and the reply came back — ${t.flooded ? "some frames flooded" : "every frame unicast"}` : t.why}
    </Callout>
  );
}

function LessonLabBridge() {
  const openLab = usePracticeLabOpener();
  return (
    <PracticeBridge label="Open the L2VPN Evolution Lab" onPractice={openLab}>
      The CUST-A network on EVPN-MPLS, compared step by step with LDP VPLS and BGP VPLS, IOS XR or Junos, your own copy. Nothing you do there changes your lesson progress.
    </PracticeBridge>
  );
}

function EvpnStack() {
  return (
    <DiagramSvg h={120} label="PE1 toward CE3: transport label 24104 over PE3's EVPN unicast label 26010 over the customer frame">
      <DStack x={140} y={16} labels={[{ text: "24104", tag: "TRANSPORT" }, { text: "26010", tag: "EVPN", color: D.success }]} payload="Ethernet" w={96} />
      <text x={260} y={40} fill={D.text} fontSize={10.5}>
        TRANSPORT: LDP label toward 3.3.3.3, swapped by P1, popped by P3
      </text>
      <text x={260} y={63} fill={D.text} fontSize={10.5}>
        EVPN: PE3&apos;s unicast label, learned from its Type 2 route
      </text>
      <text x={260} y={86} fill={D.muted} fontSize={10}>
        a flooded frame carries PE3&apos;s inclusive-multicast label (26011) instead
      </text>
    </DiagramSvg>
  );
}

const ORDER: Arch[] = ["VPWS", "VPLS", "BGP_VPLS", "H_VPLS", "EVPN"];

function SnapshotsDiagram() {
  return (
    <DiagramSvg h={170} label="Five thumbnails: VPWS one wire, LDP-VPLS a PE triangle, BGP-VPLS triangle plus route reflector, H-VPLS triangle with spokes, EVPN route reflector with BGP routes">
      {ORDER.map((a, i) => (
        <g key={a}>
          <ArchSnapshot arch={a} cx={68 + i * 126} cy={70} />
          <text x={68 + i * 126} y={140} textAnchor="middle" fill={ARCH_COLOR[a]} fontSize={11} fontWeight={700}>
            {ARCH_NAME[a]}
          </text>
          {i < ORDER.length - 1 && <DArrow x1={120 + i * 126} y1={70} x2={138 + i * 126} y2={70} color={D.faint} width={1.4} />}
        </g>
      ))}
      <text x={320} y={162} textAnchor="middle" fill={D.muted} fontSize={10}>
        each step answers a new requirement; none replaces all the others
      </text>
    </DiagramSvg>
  );
}

function ChangeDiagram() {
  const rows: [Arch, string][] = [
    ["VPWS", "point-to-point transport"],
    ["VPLS", "+ multipoint bridging"],
    ["BGP_VPLS", "+ BGP discovery / signaling"],
    ["H_VPLS", "+ access hierarchy"],
    ["EVPN", "+ control-plane MAC/IP"],
  ];
  return (
    <DiagramSvg h={200} label="What each architecture changes: point-to-point transport, multipoint bridging, BGP discovery, access hierarchy, control-plane MAC/IP">
      {rows.map(([a, t], i) => (
        <g key={a}>
          <DPill x={110} y={24 + i * 36} text={ARCH_NAME[a]} color={ARCH_COLOR[a]} w={130} />
          <text x={200} y={28 + i * 36} fill={D.text} fontSize={11}>
            {t}
          </text>
        </g>
      ))}
      <text x={600} y={190} textAnchor="end" fill={D.muted} fontSize={9.5}>
        H-VPLS and BGP-VPLS change different axes and can be combined
      </text>
    </DiagramSvg>
  );
}

function IncidentDiagram() {
  return (
    <DiagramSvg h={210} label="In BGP-VPLS PE1 has no FDB entry for CE3 until CE3 sends traffic: flood, learn from the reply, then known unicast. In EVPN a Type 2 route can install CE3 before any traffic.">
      <text x={160} y={20} textAnchor="middle" fill={ARCH_COLOR.BGP_VPLS} fontSize={11} fontWeight={700}>
        BGP-VPLS (the incident)
      </text>
      <FlowLine x={160} y={45} steps={["CE1 → CE3: unknown → flood", "CE3 replies → PE1 learns", "CE1 → CE3: known → PE3 only"]} color={ARCH_COLOR.BGP_VPLS} />
      <text x={480} y={20} textAnchor="middle" fill={ARCH_COLOR.EVPN} fontSize={11} fontWeight={700}>
        EVPN (for comparison)
      </text>
      <FlowLine x={480} y={45} steps={["CE3 appears at PE3", "PE3 → Type 2 → PE1 installs", "CE1 → CE3: already known"]} color={ARCH_COLOR.EVPN} />
    </DiagramSvg>
  );
}

function FlowLine({ x, y, steps, color }: { x: number; y: number; steps: string[]; color: string }) {
  return (
    <g>
      {steps.map((s, i) => (
        <g key={s}>
          <DPill x={x} y={y + i * 58} text={s} color={color} w={250} />
          {i < steps.length - 1 && <DArrow x1={x} y1={y + i * 58 + 13} x2={x} y2={y + i * 58 + 44} color={D.faint} width={1.4} />}
        </g>
      ))}
    </g>
  );
}

function LearningDiagram() {
  const rows: [Arch, string, boolean][] = [
    ["VPWS", "not needed (one remote end)", false],
    ["VPLS", "data plane: flood & learn", false],
    ["BGP_VPLS", "data plane: flood & learn", false],
    ["H_VPLS", "data plane, at both tiers", false],
    ["EVPN", "control plane: BGP Type 2", true],
  ];
  return (
    <DiagramSvg h={200} label="Where remote MAC reachability comes from in each architecture">
      {rows.map(([a, t, cp], i) => (
        <g key={a}>
          <text x={20} y={30 + i * 36} fill={ARCH_COLOR[a]} fontSize={11} fontWeight={700}>
            {ARCH_NAME[a]}
          </text>
          <DPill x={cp ? 470 : 250} y={26 + i * 36} text={t} color={cp ? D.success : D.warning} w={230} />
        </g>
      ))}
      <text x={250} y={196} textAnchor="middle" fill={D.warning} fontSize={10} fontWeight={700}>
        data plane
      </text>
      <text x={470} y={196} textAnchor="middle" fill={D.success} fontSize={10} fontWeight={700}>
        control plane
      </text>
    </DiagramSvg>
  );
}

function VpwsStack() {
  return (
    <DiagramSvg h={120} label="The VPWS recap stack: transport 102 S0 over PW 25001 S1 over Ethernet">
      <DStack x={140} y={16} labels={[{ text: "102 S0", tag: "OUTER" }, { text: "25001 S1", tag: "INNER", color: D.violet }]} payload="Ethernet" w={96} />
      <text x={260} y={40} fill={D.text} fontSize={10.5}>
        OUTER: transport to the remote PE
      </text>
      <text x={260} y={63} fill={D.text} fontSize={10.5}>
        INNER: service label owned by the remote PE
      </text>
      <text x={260} y={86} fill={D.muted} fontSize={10}>
        every architecture here keeps this outer/inner split
      </text>
    </DiagramSvg>
  );
}

export function EvoLessonGuideContent() {
  return (
    <div className="space-y-12">
      <GuideSection id="lv-mission" eyebrow="This lesson" title="What this lesson teaches" tone="violet">
        <p>
          You have now built a Layer 2 service for CUST-A several times: a single wire (VPWS), a bridge with a full mesh of pseudowires (LDP VPLS), the same bridge discovered by BGP (BGP VPLS), a two-tier version of it (H-VPLS) and, in the data center, EVPN over VXLAN. Each lesson answered one problem. This capstone puts them side by side on <b className="text-pv-text">one customer and one network</b>, and asks the same questions of each — so that the only thing that changes is the architecture.
        </p>
        <p>The story ends with the architecture the others led to: <b className="text-pv-text">EVPN over MPLS</b>, built on the very routers that ran LDP VPLS and BGP VPLS. You will see what it kept, what it threw away, and why a missing MAC means something different there.</p>
        <ChecklistCard tone="violet" title="By the end of this lesson you can" mark="→" items={["say which problem each architecture solved, and which it left", "tell discovery, signaling and MAC learning apart in any of them", "explain why a VPLS PE may not know a MAC — and why that is often normal", "read an EVPN service: Type 3 routes, Type 2 routes, two labels per PE", "find a fault in an EVPN service from evidence, fix it and prove it", "choose an architecture from a set of requirements"]} />
      </GuideSection>

      <GuideSection id="lv-network" eyebrow="This lesson" title="One customer, one network" tone="cyan">
        <p>CE1, CE2 and CE3 share <Mono>192.168.100.0/24</Mono>. They hang off PE1, PE2 and PE3 on VLAN 100 (<Mono>ge-0/0/1.100</Mono>, IOS XR <Mono>Gi0/0/0/1.100</Mono>). The core is P1, P2 and P3 running IS-IS and LDP; RR1 (9.9.9.9) sits beside P1 as a route reflector for whichever architecture needs BGP. CE4 waits, unconnected, on PE2.</p>
        <FieldTable
          title="The PEs, as the three labs configure them"
          accent="violet"
          columns={["PE", "Loopback", "LDP VPLS", "BGP VPLS", "EVPN-MPLS"]}
          rows={[
            ["PE1", <Mono key="0">1.1.1.1</Mono>, "neighbors 2.2.2.2, 3.3.3.3", "RD 65000:1 · VE 1", "EVI 100 · RD 65000:1"],
            ["PE2", <Mono key="1">2.2.2.2</Mono>, "neighbors 1.1.1.1, 3.3.3.3", "RD 65000:2 · VE 2", "EVI 100 · RD 65000:2"],
            ["PE3", <Mono key="2">3.3.3.3</Mono>, "neighbors 1.1.1.1, 2.2.2.2", "RD 65000:3 · VE 3", "EVI 100 · RD 65000:3"],
          ]}
        />
        <Callout tone="cyan" title="Every output on this page is real" icon="i">
          The LDP VPLS output comes from the VPLS Lab, the BGP VPLS output from the BGP VPLS Lab, the EVPN output from this lesson&apos;s L2VPN Evolution Lab — the same routers in all three. Route target 65000:100 is CUST-A in both BGP-based architectures.
        </Callout>
      </GuideSection>

      <GuideSection id="lv-questions" eyebrow="Method" title="The questions to ask" tone="cyan">
        <p>An architecture is a set of answers. To compare two of them, ask both the same questions:</p>
        <CompareCards
          items={[
            { title: "Who is a member?", tone: "bgp", tag: "discovery", points: ["configured by hand, or", "found from BGP routes"] },
            { title: "Which label?", tone: "mpls", tag: "signaling", points: ["targeted LDP per pseudowire", "BGP label blocks, or BGP routes"] },
            { title: "Where is a MAC?", tone: "success", tag: "learning", points: ["learned from frames (data plane)", "or advertised in BGP (control plane)"] },
          ]}
        />
        <p>Add two more — how broadcast and unknown frames are replicated, and how loops are prevented — and you can place every architecture in this lesson.</p>
      </GuideSection>

      <GuideSection id="lv-snapshots" eyebrow="Overview" title="Five architectures at a glance" tone="violet">
        <DiagramFrame caption="Switch between these in the lesson with the architecture selector.">
          <SnapshotsDiagram />
        </DiagramFrame>
        <DiagramFrame caption="What each step changed. BGP VPLS and H-VPLS change different things and can be combined.">
          <ChangeDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="lv-vpws" eyebrow="Architecture 1" title="VPWS: one wire" tone="mpls">
        <p>The story starts with two sites. CE1 and CE2 need a wire between them, and VPWS gives them exactly that: one pseudowire, signaled by targeted LDP, with one remote end. There is nothing to look up — every frame from CE1 goes to PE2.</p>
        <DiagramFrame caption="The two-label split every architecture here keeps: a transport label to reach the PE, a service label the PE owns.">
          <VpwsStack />
        </DiagramFrame>
        <p>Then CE3 joins. A second pseudowire would give CE1 two separate wires, not one LAN: someone has to decide which site each frame goes to. That needs a bridge.</p>
      </GuideSection>

      <GuideSection id="lv-vpls" eyebrow="Architecture 2" title="LDP VPLS: a bridge and a mesh" tone="violet">
        <p>VPLS puts a bridge on every PE and connects the bridges with a <b className="text-pv-text">full mesh</b> of pseudowires. Each PE names every other PE as a neighbor; targeted LDP signals a label per pseudowire. The bridges learn MACs from the frames they receive, flood what they don&apos;t know, and never relay a frame from one pseudowire into another (split horizon).</p>
        <CliPair cisco={only(vsCli(VS0, "PE1", "cisco", "show running-config l2vpn"), /bridge-domain|vfi|neighbor/)} junos={only(vsCli(VS0_JN, "PE1", "juniper", "show configuration routing-instances"), /instance-type|vpls-id|neighbor/)} ciscoCaption="IOS XR · PE1 in the VPLS Lab — every other PE named by hand" junosCaption="Junos · PE1 — the same list" />
        <CliPanel run={only(vsCli(VS0, "PE1", "cisco", "show l2vpn bridge-domain"), /PWs: \d|Neighbor/)} caption="IOS XR · PE1 — two pseudowires up, one per other PE" />
        <p>
          It works. But three PEs need three pseudowires — <Mono>n(n−1)/2</Mono> — and every new site means touching every existing PE. Two pressures follow: the <b className="text-pv-text">configuration and signaling</b> burden, and the <b className="text-pv-text">size of the mesh</b> at the access edge.
        </p>
      </GuideSection>

      <GuideSection id="lv-bgpvpls" eyebrow="Architecture 3" title="BGP VPLS: discovery moves" tone="bgp">
        <p>BGP VPLS answers the first pressure. Each PE advertises one BGP route to RR1 — its RD, route target 65000:100, its VE ID and a label block — and imports the others&apos; routes. Importing a route <b className="text-pv-text">is</b> discovering a member; the labels come from the blocks. No neighbor statements, one session per PE.</p>
        <CliPanel run={only(bvCli(BV0, "PE1", "cisco", "show bgp l2vpn vpls"), /Network|Route Distinguisher|\*>/)} caption="IOS XR · PE1 in the BGP VPLS Lab — one route per PE, each with its label base" />
        <Callout tone="warning" title="What BGP VPLS does not carry" icon="!">
          Those routes name PEs, not customers. The pseudowire mesh is the same as before, and the MAC tables are still filled from the frames themselves.
        </Callout>
      </GuideSection>

      <GuideSection id="lv-incident" eyebrow="Incident" title="The missing-MAC incident" tone="danger">
        <p>An engineer checks PE1 in the BGP VPLS network: the session to RR1 is up, PE3&apos;s route is imported, the pseudowire to PE3 is up with labels both ways. Yet PE1&apos;s MAC table has no entry for CE3. The engineer opens a ticket: &quot;BGP is missing CE3&apos;s route.&quot;</p>
        <CliPanel run={only(bvCli(BV0, "PE1", "cisco", "show l2vpn forwarding bridge-domain mac-address location 0/0/CPU0"), /Mac Address|----/)} caption="IOS XR · PE1 in the BGP VPLS Lab — an empty MAC table on a healthy network" />
        <DiagramFrame caption="Before deciding what is broken, ask how this architecture learns a remote MAC.">
          <IncidentDiagram />
        </DiagramFrame>
        <p>Walk the ladder and every rung is healthy: session, address family, route target, membership, labels, pseudowire. The last question is the one that matters — how is PE1 supposed to learn CE3? From a frame <b className="text-pv-text">sent by CE3</b>, arriving on the pseudowire from PE3. CE3 hasn&apos;t sent anything yet. <b className="text-pv-text">Nothing is broken</b>; there is no BGP route to look for, because BGP VPLS never carries one.</p>
        <PingResult s={BV1} title="The BGP VPLS Lab: CE1 pings CE3 — and only now does PE1 learn it" />
        <CliPanel run={bvCli(BV1, "PE1", "cisco", "show l2vpn forwarding bridge-domain mac-address location 0/0/CPU0")} caption="IOS XR · PE1 after the ping — CE3 learned behind the pseudowire to 3.3.3.3" />
        <Callout tone="cyan" title="Keep this incident in mind" icon="→">
          The same symptom — &quot;PE1 doesn&apos;t know CE3&quot; — will mean something quite different once MACs travel in BGP.
        </Callout>
      </GuideSection>

      <GuideSection id="lv-hvpls" eyebrow="Architecture 4" title="H-VPLS: a hierarchy" tone="warning">
        <p>H-VPLS answers the second pressure. Small access switches (MTUs) attach to a core PE with a single spoke pseudowire each, and only the core PEs are fully meshed. Split horizon is refined — spoke to mesh and mesh to spoke are allowed, mesh to mesh is not — and MAC learning is still data plane, now at both tiers.</p>
        <FieldTable
          title="Ten access sites (from the lesson)"
          accent="warning"
          columns={["Design", "Pseudowires"]}
          rows={[
            ["Flat full mesh", "45"],
            ["H-VPLS, 3-PE core", "13 (3 mesh + 10 spokes)"],
          ]}
        />
        <p>H-VPLS changes the shape of the service, not how members are found: its core can be LDP- or BGP-signaled.</p>
      </GuideSection>

      <GuideSection id="lv-evpn" eyebrow="Architecture 5" title="EVPN: the segment in BGP" tone="success">
        <p>
          The VPLS family left one thing untouched: learning. EVPN (RFC 7432) moves it into BGP. Back on CUST-A&apos;s routers, each PE now runs <b className="text-pv-text">EVI 100</b> — an EVPN instance with an RD and route target 65000:100 — and its session to RR1 carries the <b className="text-pv-text">L2VPN EVPN</b> family. There are no pseudowires.
        </p>
        <p>Before any customer frame, each PE advertises an <b className="text-pv-text">inclusive-multicast route</b> (Type 3): &quot;I am in this segment; send me broadcast and unknown frames with this label.&quot; The PEs whose Type 3 route a PE keeps form its flood list.</p>
        <CliPair cisco={emOnly(EM0, "RR1", "cisco", "show bgp l2vpn evpn", /Network|Route Distinguisher|\*>|^\s+\d|Processed/)} junos={emOnly(EM0_JN, "PE1", "juniper", "show evpn instance EVPN-A extensive", /Instance|label|neighbors|Address|^    \d|Inclusive/)} ciscoCaption="IOS XR · RR1 — three Type 3 routes, and nothing else yet" junosCaption="Junos · PE1 — two neighbors, each with its multicast label" />
        <CliPanel run={emCli(EM0, "PE1", "cisco", "show evpn evi vpn-id 100 inclusive-multicast")} caption="IOS XR · PE1 — the flood list: itself, PE2 and PE3" />
      </GuideSection>

      <GuideSection id="lv-type2" eyebrow="Architecture 5" title="EVPN: the MACs in BGP" tone="success">
        <p>CE1 pings CE3. PE1 learns CE1&apos;s MAC on its attachment circuit and PE3 learns CE3&apos;s — exactly as any bridge would. Then each advertises a <b className="text-pv-text">MAC/IP route</b> (Type 2): the MAC, the RD and RT, its unicast label — and, once it has seen the host&apos;s ARP, the IP as well.</p>
        <p>Now look at PE2. It knows where CE1 and CE3 are, although CE3&apos;s reply never passed through it:</p>
        <CliPair cisco={emCli(EM1, "PE2", "cisco", "show evpn evi vpn-id 100 mac")} junos={emOnly(EM1_JN, "PE2", "juniper", "show evpn database instance EVPN-A", /Instance|VLAN|^100/)} ciscoCaption="IOS XR · PE2 — both MACs, from Type 2 routes (next hop and label)" junosCaption="Junos · PE2 — the same, active source = the advertising PE" />
        <p>That is <b className="text-pv-text">control-plane learning</b>. And it works in reverse: when PE3 forgets CE3, it withdraws the route and every PE forgets CE3 at once.</p>
        <CliPanel run={emCli(EM_CLR, "PE1", "cisco", "show evpn evi vpn-id 100 mac")} caption="IOS XR · PE1 after PE3's MAC table is cleared — CE3 gone with its route" />
      </GuideSection>

      <GuideSection id="lv-labels" eyebrow="Data plane" title="Two labels per PE" tone="mpls">
        <p>Each PE allocates two EVPN labels: a <b className="text-pv-text">unicast</b> label carried in its Type 2 routes and an <b className="text-pv-text">inclusive-multicast</b> label carried in its Type 3 route. The label on an arriving frame tells the PE whether it was flooded — a flooded frame goes to its own CEs only, never back into the core.</p>
        <FieldTable
          title="EVPN labels in the lab (IOS XR numbering)"
          accent="mpls"
          columns={["PE", "Unicast (Type 2)", "Inclusive multicast (Type 3)"]}
          rows={[
            ["PE1", <Mono key="a">24010</Mono>, <Mono key="b">24011</Mono>],
            ["PE2", <Mono key="c">25010</Mono>, <Mono key="d">25011</Mono>],
            ["PE3", <Mono key="e">26010</Mono>, <Mono key="f">26011</Mono>],
          ]}
        />
        <DiagramFrame caption="The two-label split, again: only the inner label changed meaning.">
          <EvpnStack />
        </DiagramFrame>
        <CliPanel run={emOnly(EM1, "PE1", "cisco", "show mpls forwarding", /Local|Label  |----|EVPN|\/32/)} caption="IOS XR · PE1 — its own two EVPN labels, and the LDP labels toward PE2 and PE3" />
        <PingResult s={EM1} title="The lab: the first ping CE1 → CE3" />
        <PingResult s={EM2} title="The lab: the same ping again" />
        <Callout tone="cyan" title="Junos numbers" icon="i">
          The lab&apos;s Junos routers allocate the EVPN labels 301010/301011 (PE1), 301020/301021 (PE2) and 301030/301031 (PE3), and LDP labels from 299776.
        </Callout>
      </GuideSection>

      <GuideSection id="lv-learning" eyebrow="Comparison" title="MAC reachability, compared" tone="violet">
        <DiagramFrame caption="Only EVPN moves remote-MAC knowledge into the control plane.">
          <LearningDiagram />
        </DiagramFrame>
        <p>That one change explains the rest of EVPN&apos;s features. A CE attached to two PEs, both forwarding (all-active multihoming), confuses data-plane learning — its MAC would flap between them — but is easy to describe in routes (Ethernet segments, route types 1 and 4). A host that moves gets a new Type 2 route with a higher sequence number instead of a stale entry. A PE that knows a MAC/IP pair can answer ARP itself.</p>
      </GuideSection>

      <GuideSection id="lv-bum" eyebrow="Comparison" title="Flooding, compared" tone="warning">
        <FieldTable
          title="Replication and loop prevention"
          accent="warning"
          columns={["Architecture", "Broadcast and unknown frames", "Loop prevention"]}
          rows={[
            ["VPWS", "n/a (one remote end)", "n/a"],
            ["LDP VPLS", "a copy over every pseudowire", "pseudowire → pseudowire forbidden"],
            ["BGP VPLS", "the same", "the same"],
            ["H-VPLS", "replicated at both tiers", "only mesh → mesh forbidden"],
            ["EVPN", "a copy to every PE on the flood list (Type 3)", "a flooded frame never re-enters the core; ESI split horizon for multihoming"],
          ]}
        />
        <Callout tone="warning" title="EVPN still floods" icon="!">
          Broadcasts and frames for MACs nobody has advertised yet are still replicated. What shrinks is the unknown unicast: a MAC is known everywhere as soon as one PE has learned it.
        </Callout>
      </GuideSection>

      <GuideSection id="lv-transport" eyebrow="Constant" title="What never changed" tone="mpls">
        <p>Across all five, the core is the same: IS-IS and LDP give every PE an LSP to every other PE&apos;s loopback, P routers swap and pop the transport label and never look at the service label or a customer MAC. A broken LSP hurts every architecture the same way — which is why the transport is the last rung of every troubleshooting ladder in this path.</p>
      </GuideSection>

      <GuideSection id="lv-working" eyebrow="Evidence" title="What working looks like" tone="success">
        <FieldTable
          title="A healthy EVPN service, in five questions"
          accent="success"
          columns={["Question", "IOS XR", "Junos", "Healthy answer"]}
          rows={[
            ["Does every PE exchange EVPN routes with RR1?", <Mono key="1">show bgp l2vpn evpn summary</Mono>, <Mono key="2">show bgp summary</Mono>, "one neighbor, routes received"],
            ["Does every PE flood to every other?", <Mono key="3">show evpn evi vpn-id 100 inclusive-multicast</Mono>, <Mono key="4">show evpn instance EVPN-A extensive</Mono>, "both other PEs listed"],
            ["Do the MACs arrive as Type 2 routes?", <Mono key="5">show evpn evi vpn-id 100 mac</Mono>, <Mono key="6">show evpn database instance EVPN-A</Mono>, "remote MACs with next hop and label"],
            ["Is the transport complete?", <Mono key="7">show mpls forwarding</Mono>, <Mono key="8">show route table inet.3</Mono>, "an LSP to every PE loopback"],
            ["Does every pair of sites work?", "fresh pings", "fresh pings", "CE1↔CE2, CE1↔CE3, CE2↔CE3"],
          ]}
        />
      </GuideSection>

      <GuideSection id="lv-break" eyebrow="Incident" title="When EVPN breaks" tone="danger">
        <p>PE3 was the last PE migrated to EVPN. Its EVI is configured and its session to RR1 is up, but CE3 reaches nobody; CE1 ↔ CE2 works.</p>
        <PingResult s={EM_FAULT} title="The lab: CE1 pings 192.168.100.3" />
        <PingResult s={EM_FAULT_OK} title="The lab: CE1 pings 192.168.100.2 — still fine" />
        <p>Unlike the BGP VPLS incident, a missing remote MAC here is not normal for long — and the flood list tells you more than the MAC table:</p>
        <TroubleshootingFlow
          steps={[
            { question: "Which pairs fail?", look: "Every pair that includes CE3." },
            { question: "Is PE3's session up, with the EVPN family?", look: "Yes — Established, EVPN negotiated." },
            { question: "Does PE1 flood to PE3?", look: "No: PE3 is missing from PE1's flood list." },
            { question: "Does PE1 receive PE3's Type 3 route?", look: "Yes — with route target 65000:999. Received, not imported." },
          ]}
        />
        <CliPanel run={emCli(EM_FAULT, "PE1", "cisco", "show evpn evi vpn-id 100 inclusive-multicast")} caption="IOS XR · PE1 — PE3 (3.3.3.3) missing from the flood list" />
        <CliPanel run={emOnly(EM_FAULT, "PE3", "cisco", "show evpn evi vpn-id 100 detail", /VPN-ID|^100 |RD Config|Route Targets|Import|Export/)} caption="IOS XR · PE3 — the EVI imports and exports 65000:999" />
        <CliPanel run={emOnly(EM_FAULT_JN, "PE1", "juniper", "show evpn instance EVPN-A extensive", /Instance|neighbors|Address|^    \d|Inclusive/)} caption="Junos · PE1 — one neighbor: PE2 only" />
        <CliPair cisco={{ prompt: "RP/0/RP0/CPU0:PE3(config)#", command: "evpn", output: "RP/0/RP0/CPU0:PE3(config-evpn)#evi 100\nRP/0/RP0/CPU0:PE3(config-evpn-instance)#bgp\nRP/0/RP0/CPU0:PE3(config-evpn-instance-bgp)#route-target import 65000:100\nRP/0/RP0/CPU0:PE3(config-evpn-instance-bgp)#route-target export 65000:100\nRP/0/RP0/CPU0:PE3(config-evpn-instance-bgp)#commit" }} junos={{ prompt: "admin@PE3# ", command: "set routing-instances EVPN-A vrf-target target:65000:100", output: "\n[edit]\nadmin@PE3# commit and-quit\ncommit complete\nExiting configuration mode" }} ciscoCaption="IOS XR · PE3" junosCaption="Junos · PE3" />
        <PingResult s={EM_FIXED} title="The lab: a fresh ping after the fix" />
        <ChecklistCard tone="success" title="Proved, not assumed" mark="✓" items={["PE3's EVI uses 65000:100 again", "every PE has both others on its flood list", "PE1 learns CE3 from PE3's Type 2 route", "a fresh ping from CE1 reaches CE3"]} />
      </GuideSection>

      <GuideSection id="lv-other" eyebrow="Beyond this incident" title="Other ways it fails" tone="warning">
        <FailureSignatures
          items={[
            { tag: "AF", title: "EVPN family missing", tone: "danger", points: ["session Established", "zero EVPN routes, empty flood list"] },
            { tag: "RR", title: "PEs not route-reflector clients", tone: "danger", points: ["RR1 holds every route", "every flood list empty"] },
            { tag: "AC", title: "CE's VLAN not in the EVI", tone: "violet", points: ["control plane perfect", "that one CE cut off"] },
            { tag: "LSP", title: "Transport broken", tone: "warning", points: ["XR: routes fine, drops in the core", "Junos: routes unusable"] },
          ]}
        />
        <p className="text-sm text-pv-text-muted">Each is a ticket in the L2VPN Evolution Lab, together with this incident.</p>
      </GuideSection>

      <GuideSection id="lv-decide" eyebrow="Design" title="How to choose" tone="cyan">
        <p>No architecture wins everywhere. Start from the requirements:</p>
        <FieldTable
          title="Requirement → the simplest architecture that meets it"
          accent="cyan"
          columns={["Requirement", "Fits"]}
          rows={[
            ["Two sites, a transparent wire", "VPWS"],
            ["A few sites, one LAN, small and stable", "LDP VPLS"],
            ["Many sites, PEs added often", "BGP VPLS"],
            ["Many small access sites behind a few core PEs", "H-VPLS (LDP or BGP core)"],
            ["Dual-homed sites, MAC mobility, control-plane reachability", "EVPN"],
          ]}
        />
        <p>The guided lesson ends with five decision labs and an engineering challenge built on exactly this table.</p>
      </GuideSection>

      <GuideSection id="lv-model" eyebrow="Mental model" title="Mental model" tone="cyan">
        <p>
          Picture three office buildings that must share one internal mail service. First, one courier between two buildings: no sorting needed (VPWS). Then a sorting room in every building, connected by private courier lines to every other building; each room keeps a hand-written list of the others and learns who sits where by reading the return address on incoming envelopes (LDP VPLS). Then a central noticeboard where each building pins one card — &quot;I&apos;m in this club, here&apos;s how to call me&quot; — so nobody keeps lists any more; but rooms still learn people only from the envelopes they receive (BGP VPLS). Finally, the noticeboard also carries a card for every person: &quot;Alice works in building 3.&quot; Every room reads the board and knows where everyone sits before receiving a single envelope from them; when Alice leaves, her card comes down and everyone forgets her at once. The couriers between buildings never changed (the MPLS core).
        </p>
        <Callout tone="cyan" title="When it breaks, ask in this order" icon="→">
          Which pairs of sites fail? Does every CE&apos;s VLAN land in the service? Does every PE exchange the right BGP family? Does every PE know every other PE — imported routes, pseudowires or flood lists? Are the MACs where the architecture says they come from? Is the transport complete?
        </Callout>
      </GuideSection>

      <GuideSection id="lv-glossary" eyebrow="Reference" title="Glossary" tone="cyan">
        <Glossary
          items={[
            { term: "VPWS", def: "A point-to-point Layer 2 service: one pseudowire, one remote end." },
            { term: "VPLS", def: "A multipoint Layer 2 service: a bridge per PE, a mesh of pseudowires, data-plane MAC learning." },
            { term: "BGP VPLS", def: "VPLS whose members are discovered and whose labels are signaled by BGP (RFC 4761)." },
            { term: "H-VPLS", def: "VPLS with access switches attached by spoke pseudowires to a meshed core." },
            { term: "EVPN", def: "Ethernet VPN (RFC 7432): MAC reachability and segment membership advertised in BGP." },
            { term: "EVI", def: "EVPN instance: one customer's Layer 2 segment on a PE (EVI 100 in the lab)." },
            { term: "Type 3 route", def: "Inclusive multicast Ethernet tag route: a PE's membership and its label for flooded frames." },
            { term: "Type 2 route", def: "MAC/IP advertisement route: a MAC (and optionally its IP) behind a PE, with the PE's unicast label." },
            { term: "Flood list", def: "The PEs whose Type 3 route a PE keeps — where it sends a copy of each flooded frame." },
            { term: "Ingress replication", def: "The ingress PE sends one copy of a flooded frame to every PE on its flood list." },
          ]}
        />
      </GuideSection>

      <GuideSection id="lv-recap" eyebrow="Reference" title="Recap" tone="success">
        <ChecklistCard tone="success" title="You can now" mark="✓" items={["place each architecture by discovery, signaling and learning", "explain the missing-MAC incident in a VPLS — and why EVPN differs", "read Type 3 and Type 2 routes and the flood list", "name the two EVPN labels a PE allocates", "find, fix and prove a fault in an EVPN service", "choose an architecture from requirements"]} />
      </GuideSection>

      <GuideSection id="lv-practice" eyebrow="Next" title="Practice it" tone="violet">
        <p>The Deep Dive tab compares the five architectures in depth — discovery and signaling, pseudowires, learning, flooding, split horizon, multihoming, failure handling, scale — and covers EVPN-MPLS configuration and verification on IOS XR and Junos. The lab lets you operate it.</p>
        <LessonLabBridge />
        <PresentationBridge>Rewatch the L2VPN Evolution presentation.</PresentationBridge>
      </GuideSection>
    </div>
  );
}
