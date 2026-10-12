import { Callout, ChecklistCard, CompareCards, DArrow, DIAGRAM as D, DLink, DNode, DPill, DiagramFrame, DiagramSvg, FailureSignatures, FieldTable, FlowSteps, Glossary, GuideSection, Mono, TroubleshootingFlow } from "@/components/lesson/GuideBlocks";
import { DStack } from "@/components/lesson/MplsGuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { PracticeBridge } from "@/components/lesson/GuideInteractive";
import { usePracticeLabOpener } from "@/components/lesson/FundamentalsLessonShell";
import { PresentationBridge } from "@/components/presentation/LessonPresentation";
import { CliPair, CliPanel, pickLines, runGuideCli } from "@/components/lesson/GuideCli";
import type { CliVendor } from "@/lib/cli/types";
import type { VsCe } from "@/lib/sim-engine/scenarios/vsNet";
import { bvApply, bvTicket, bvTicketState, createBvNet, type BvOs, type BvR, type BvState } from "@/lib/sim-engine/scenarios/bvNet";
import { bvSets, bvStaticApi } from "./bv-lab/bvCli";

export const BGP_VPLS_LESSON_SECTIONS: LessonGuideSectionLink[] = [
  { id: "bg-mission", label: "What this lesson teaches" },
  { id: "bg-network", label: "The network of this lesson" },
  { id: "bg-ideas", label: "Three ideas you need" },
  { id: "bg-watch", label: "What you will watch" },
  { id: "bg-session", label: "One session, one address family" },
  { id: "bg-route", label: "What each PE advertises" },
  { id: "bg-discovery", label: "Discovery through RR1" },
  { id: "bg-blocks", label: "Labels from blocks" },
  { id: "bg-mesh", label: "Six labels, the mesh up" },
  { id: "bg-nomacs", label: "What BGP does not carry" },
  { id: "bg-data", label: "The same data plane" },
  { id: "bg-grow", label: "A VE ID outside the block" },
  { id: "bg-withdraw", label: "Leaving and rejoining" },
  { id: "bg-working", label: "What working looks like" },
  { id: "bg-incident", label: "The incident" },
  { id: "bg-investigate", label: "Walk the evidence" },
  { id: "bg-fix", label: "Repair and prove it" },
  { id: "bg-other", label: "Other ways it fails" },
  { id: "bg-model", label: "Mental model" },
  { id: "bg-glossary", label: "Glossary" },
  { id: "bg-recap", label: "Recap" },
  { id: "bg-practice", label: "Practice it" },
];

/**
 * Every CLI sample and ping result on this page comes from the BGP VPLS Lab's model and its IOS XR / Junos command
 * sets: the healthy network (and its MAC tables after real pings) and the lab's "rt" ticket — the guided lesson's
 * incident (PE3's VPLS uses route target 65000:999).
 */
export const BV_HEALTHY: BvState = createBvNet(0);
export const BV_HEALTHY_JN: BvState = createBvNet(0, "junos");
const ping = (s: BvState, from: VsCe, dst: string) => bvApply(s, { type: "test", from, dst });
export const BV_LEARNED = ping(BV_HEALTHY, "CE1", "192.168.100.3");
export const BV_LEARNED_JN = ping(BV_HEALTHY_JN, "CE1", "192.168.100.3");
const BV_AGAIN = ping(BV_LEARNED, "CE1", "192.168.100.3");
const fault = (os: BvOs) => bvTicket("rt").repro.reduce((acc, a) => bvApply(acc, a), bvTicketState("rt", 0, os));
const BV_FAULT = fault("xr");
const BV_FAULT_JN = fault("junos");
const BV_FAULT_OK = ping(BV_FAULT, "CE1", "192.168.100.2");
const BV_FIXED = ping(bvApply(BV_FAULT, { type: "set", text: "PE3: route target back to 65000:100", changes: [{ dev: "PE3", f: (c) => void (c.bd!.rt = "65000:100") }] }), "CE1", "192.168.100.3");
export function bvCli(s: BvState, r: BvR, vendor: CliVendor, command: string) {
  return runGuideCli(bvSets(bvStaticApi(s, r), r)[vendor], command);
}
export function bvOnly(s: BvState, r: BvR, vendor: CliVendor, command: string, match: RegExp, keep = 0) {
  const x = bvCli(s, r, vendor, command);
  return { ...x, output: pickLines(x.output, match, keep) };
}
/** One customer ping, as the lab reports it. */
export function PingResult({ s, title }: { s: BvState; title: string }) {
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
    <PracticeBridge label="Open the BGP VPLS Lab" onPractice={openLab}>
      Three PEs and a route reflector, real BGP tables and label blocks, IOS XR or Junos, your own copy. Nothing you do there changes your lesson progress.
    </PracticeBridge>
  );
}

function TwoTopologies() {
  return (
    <DiagramSvg h={220} label="Control plane: PE1, PE2, PE3 peer only with RR1. Service plane: PE1, PE2, PE3 fully meshed with pseudowires">
      <text x={160} y={20} textAnchor="middle" fill={D.bgp} fontSize={11} fontWeight={700}>
        control plane: hub and spoke
      </text>
      <DNode x={160} y={110} label="RR1" sub="route reflector" accent={D.bgp} w={90} />
      {[
        ["PE1", 50, 50],
        ["PE2", 50, 180],
        ["PE3", 270, 180],
      ].map(([id, x, y]) => (
        <g key={id as string}>
          <DLink x1={x as number} y1={y as number} x2={160} y2={110} color={D.bgp} />
          <DNode x={x as number} y={y as number} label={id as string} accent={D.mpls} w={60} h={32} />
        </g>
      ))}
      <text x={480} y={20} textAnchor="middle" fill={D.violet} fontSize={11} fontWeight={700}>
        service plane: full PW mesh
      </text>
      <DLink x1={390} y1={60} x2={570} y2={60} color={D.violet} />
      <DLink x1={390} y1={60} x2={480} y2={180} color={D.violet} />
      <DLink x1={570} y1={60} x2={480} y2={180} color={D.violet} />
      <DNode x={390} y={60} label="PE1" accent={D.mpls} w={60} h={32} />
      <DNode x={570} y={60} label="PE2" accent={D.mpls} w={60} h={32} />
      <DNode x={480} y={180} label="PE3" accent={D.mpls} w={60} h={32} />
      <text x={480} y={212} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        customer frames never pass through RR1
      </text>
    </DiagramSvg>
  );
}

function NlriDiagram() {
  const cells: [string, string, number, string][] = [
    ["RD", "65000:1", 80, D.bgp],
    ["VE ID", "1", 60, D.violet],
    ["VBO", "1", 55, D.mpls],
    ["VBS", "10", 55, D.mpls],
    ["Label Base", "24000", 90, D.mpls],
    ["RT", "65000:100", 95, D.violet],
    ["Next hop", "1.1.1.1", 80, D.ospf],
    ["L2 Info", "VPLS, MTU 1500", 100, D.cyan],
  ];
  let x = 12;
  return (
    <DiagramSvg h={110} label="PE1's VPLS NLRI: RD 65000:1, VE ID 1, VBO 1, VBS 10, Label Base 24000, RT 65000:100, next hop 1.1.1.1, Layer2 Info VPLS MTU 1500">
      {cells.map(([n, v, w, c]) => {
        const g = (
          <g key={n}>
            <rect x={x} y={20} width={w - 4} height={50} rx={6} fill={c} fillOpacity={0.12} stroke={c} />
            <text x={x + (w - 4) / 2} y={40} textAnchor="middle" fill={c} fontSize={9.5} fontWeight={700}>
              {n}
            </text>
            <text x={x + (w - 4) / 2} y={58} textAnchor="middle" fill={D.text} fontSize={9.5} fontFamily="monospace">
              {v}
            </text>
          </g>
        );
        x += w;
        return g;
      })}
      <text x={320} y={98} textAnchor="middle" fill={D.muted} fontSize={10}>
        PE1&apos;s advertisement (AFI 25 / SAFI 65) · nothing in it names a customer MAC
      </text>
    </DiagramSvg>
  );
}

function DiscoveryDiagram() {
  const st: [string, string, string][] = [
    ["ADVERTISE", D.bgp, "PE1 → RR1"],
    ["REFLECT", D.bgp, "RR1 → PE2, PE3"],
    ["RECEIVE", D.violet, "Adj-RIB-In"],
    ["RT IMPORT CHECK", D.warning, "RT matches?"],
    ["DISCOVERED", D.success, "remote VE known"],
  ];
  return (
    <DiagramSvg h={120} label="Advertise from PE1 to RR1, reflect to PE2 and PE3, receive, RT import check, discovered">
      {st.map(([s, c, sub], i) => (
        <g key={s}>
          <DPill x={66 + i * 127} y={40} text={s} color={c} w={118} />
          <text x={66 + i * 127} y={68} textAnchor="middle" fill={D.muted} fontSize={9.5}>
            {sub}
          </text>
          {i < st.length - 1 && <DArrow x1={126 + i * 127} y1={40} x2={134 + i * 127} y2={40} color={D.faint} width={1.4} />}
        </g>
      ))}
      <text x={320} y={104} textAnchor="middle" fill={D.muted} fontSize={10}>
        received and imported are different states: the RT decides
      </text>
    </DiagramSvg>
  );
}

function BlockMath() {
  return (
    <DiagramSvg h={200} label="PE2's block, offset 1, base 25000: sender VE 1 uses 25000, VE 2 25001, VE 3 25002, VE 4 25003; PE1 with VE 1 uses 25000 to send to PE2">
      <text x={320} y={20} textAnchor="middle" fill={D.mpls} fontSize={11} fontWeight={700}>
        PE2 advertises: VBO 1 · Label Base 25000 (the first four slots)
      </text>
      {[1, 2, 3, 4].map((ve, i) => (
        <g key={ve}>
          <rect x={120 + i * 105} y={40} width={95} height={50} rx={8} fill={ve === 1 ? D.success : D.mpls} fillOpacity={ve === 1 ? 0.2 : 0.08} stroke={ve === 1 ? D.success : D.mpls} />
          <text x={167 + i * 105} y={60} textAnchor="middle" fill={D.muted} fontSize={9.5}>
            sender VE {ve}
          </text>
          <text x={167 + i * 105} y={79} textAnchor="middle" fill={D.text} fontSize={11} fontWeight={700} fontFamily="monospace">
            {25000 + ve - 1}
          </text>
        </g>
      ))}
      <DArrow x1={167} y1={135} x2={167} y2={96} color={D.success} />
      <DNode x={167} y={155} label="PE1 (VE 1)" accent={D.success} w={110} h={34} />
      <text x={400} y={150} fill={D.text} fontSize={10.5}>
        label = 25000 + 1 − 1 = <tspan fontWeight={700} fill={D.success}>25000</tspan>
      </text>
      <text x={400} y={170} fill={D.muted} fontSize={10}>
        the receiver owns the block; the sender picks its slot
      </text>
    </DiagramSvg>
  );
}

function StackDiagram() {
  return (
    <DiagramSvg h={150} label="Forward copy PE1 to PE2 carries a transport label over 25000; reply PE2 to PE1 carries a transport label over 24001">
      <text x={180} y={20} textAnchor="middle" fill={D.warning} fontSize={10.5} fontWeight={700}>
        CE1 → CE2 copy (PE1 → PE2)
      </text>
      <DStack x={180} y={32} labels={[{ text: "24103 S0", tag: "OUTER" }, { text: "25000 S1", tag: "INNER", color: D.violet }]} payload="Ethernet" w={90} />
      <text x={460} y={20} textAnchor="middle" fill={D.success} fontSize={10.5} fontWeight={700}>
        CE2 → CE1 known unicast (PE2 → PE1)
      </text>
      <DStack x={460} y={32} labels={[{ text: "24203 S0", tag: "OUTER" }, { text: "24001 S1", tag: "INNER", color: D.violet }]} payload="Ethernet" w={90} />
      <text x={320} y={140} textAnchor="middle" fill={D.muted} fontSize={10}>
        inner labels come from the blocks; the stack is the same shape as in LDP VPLS
      </text>
    </DiagramSvg>
  );
}

function RtFaultDiagram() {
  return (
    <DiagramSvg h={170} label="RR1 reflects PE3's route to PE1 and PE2, which receive it but do not import it because the RT does not match">
      <DNode x={320} y={40} label="RR1" accent={D.bgp} w={80} />
      <DNode x={110} y={130} label="PE1" sub="import 65000:100" accent={D.mpls} w={130} />
      <DNode x={320} y={130} label="PE2" sub="import 65000:100" accent={D.mpls} w={130} />
      <DNode x={530} y={130} label="PE3" sub="RT 65000:999" accent={D.danger} w={130} />
      <DArrow x1={490} y1={110} x2={360} y2={55} color={D.bgp} />
      <DArrow x1={280} y1={55} x2={150} y2={110} color={D.bgp} />
      <text x={440} y={70} fill={D.bgp} fontSize={10} fontWeight={700}>
        route, RT 65000:999
      </text>
      <text x={200} y={70} textAnchor="end" fill={D.bgp} fontSize={10} fontWeight={700}>
        reflected
      </text>
      <DArrow x1={320} y1={62} x2={320} y2={106} color={D.bgp} />
      <text x={320} y={166} textAnchor="middle" fill={D.danger} fontSize={10.5} fontWeight={700}>
        RECEIVED ≠ IMPORTED
      </text>
    </DiagramSvg>
  );
}

export function BgpVplsLessonGuideContent() {
  return (
    <div className="space-y-12">
      <GuideSection id="bg-mission" eyebrow="This lesson" title="What this lesson teaches" tone="bgp">
        <p>
          Same customer, same three sites, same physical network as the VPLS lesson: CE1, CE2 and CE3 share <Mono>192.168.100.0/24</Mono> across PE1, PE2 and PE3. Last time every PE listed every other PE and opened a targeted LDP session per pair. This lesson keeps the bridges and the full mesh, and hands the two control-plane jobs to <b className="text-pv-text">BGP</b> (RFC 4761): finding the members, and agreeing on the labels.
        </p>
        <p>You will watch each PE advertise one route to the route reflector RR1, RR1 hand it to the others, and each PE compute its pseudowire labels from the others&apos; label blocks. Then the familiar data plane takes over — and finally an incident where PE3&apos;s BGP session is perfectly up, yet CE3 reaches nobody.</p>
        <Callout tone="warning" title="This is not EVPN" icon="!">
          BGP here carries membership and labels only. Customer MAC addresses are still learned from the Ethernet frames themselves, exactly as in the VPLS lesson.
        </Callout>
        <ChecklistCard tone="violet" title="By the end of this lesson you can" mark="→" items={["explain what BGP auto-discovery and signaling replace", "read a VPLS route: RD, VE ID, label block, RT", "follow a route through the route reflector and tell received from imported", "compute a pseudowire label from a block", "explain what happens when a VE ID leaves its block — or is duplicated", "find a membership fault from evidence, fix it and prove it"]} />
      </GuideSection>

      <GuideSection id="bg-network" eyebrow="This lesson" title="The network of this lesson" tone="cyan">
        <DiagramFrame caption="RR1 exists only in the control plane.">
          <TwoTopologies />
        </DiagramFrame>
        <FieldTable
          title="Per-PE identity"
          accent="violet"
          columns={["PE", "Loopback", "RD", "RT (import and export)", "VE ID"]}
          rows={[
            ["PE1", <Mono key="0">1.1.1.1</Mono>, <Mono key="1">65000:1</Mono>, <Mono key="2">65000:100</Mono>, "1"],
            ["PE2", <Mono key="3">2.2.2.2</Mono>, <Mono key="4">65000:2</Mono>, <Mono key="5">65000:100</Mono>, "2"],
            ["PE3", <Mono key="6">3.3.3.3</Mono>, <Mono key="7">65000:3</Mono>, <Mono key="8">65000:100</Mono>, "3"],
          ]}
        />
        <Callout tone="cyan" title="The lab uses the same network" icon="i">
          AS 65000; RR1 is 9.9.9.9, attached to P1, with cluster ID 100.100.100.100. P1 connects PE1 to P2 (toward PE2) and P3 (toward PE3); IS-IS and LDP run in the core. The attachment circuits are <Mono>ge-0/0/1.100</Mono> (IOS XR <Mono>Gi0/0/0/1.100</Mono>), VLAN 100, and a fourth site, CE4, waits unconnected on PE2. Every output on this page comes from the lab.
        </Callout>
      </GuideSection>

      <GuideSection id="bg-ideas" eyebrow="This lesson" title="Three ideas you need" tone="violet">
        <CompareCards
          items={[
            { title: "Advertise yourself", tone: "bgp", tag: "one route", points: ["RD, VE ID, label block, RT", "to the route reflector only"] },
            { title: "Import is discovery", tone: "violet", tag: "the RT", points: ["a route with your RT names a member", "no neighbor statements"] },
            { title: "Labels from blocks", tone: "mpls", tag: "VE IDs", points: ["label = base + VE ID − offset", "VE IDs unique per VPLS"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="bg-watch" eyebrow="This lesson" title="What you will watch" tone="cyan">
        <FlowSteps
          steps={[
            { title: "Sessions", body: "Three PEs peer with RR1 for L2VPN VPLS.", tone: "bgp" },
            { title: "Routes", body: "Each PE advertises; RR1 reflects.", tone: "violet" },
            { title: "Labels", body: "Six labels computed from three blocks.", tone: "mpls" },
            { title: "Frames", body: "Flood, learn, unicast — as before.", tone: "warning" },
            { title: "The incident", body: "PE3's route carries the wrong RT.", tone: "danger" },
            { title: "Repair", body: "One RT, a fresh ping.", tone: "success" },
          ]}
        />
      </GuideSection>

      <GuideSection id="bg-session" eyebrow="Control plane" title="One session, one address family" tone="bgp">
        <p>The transport underneath is unchanged: IS-IS and LDP give every PE an LSP to every other PE&apos;s loopback. On top, each PE opens one iBGP session — to RR1 — and activates the <b className="text-pv-text">L2VPN VPLS</b> family on it (AFI 25 / SAFI 65; IOS XR <Mono>address-family l2vpn vpls-vpws</Mono>, Junos <Mono>family l2vpn signaling</Mono>). An Established session without that family carries no VPLS routes at all.</p>
        <CliPair cisco={bvOnly(BV_HEALTHY, "PE1", "cisco", "show bgp l2vpn vpls summary", /Neighbor  |^9\.9\.9\.9/)} junos={bvOnly(BV_HEALTHY_JN, "PE1", "juniper", "show bgp summary", /Peer  |^9\.9\.9\.9|bgp\.l2vpn/)} ciscoCaption="IOS XR · PE1 — one neighbor, RR1, two VPLS routes received" junosCaption="Junos · PE1 — Established, bgp.l2vpn.0: 2 routes accepted" />
      </GuideSection>

      <GuideSection id="bg-route" eyebrow="Control plane" title="What each PE advertises" tone="bgp">
        <DiagramFrame caption="One route carries identity (RD, VE ID), membership (RT) and signaling (the label block).">
          <NlriDiagram />
        </DiagramFrame>
        <p>The <b className="text-pv-text">RD</b> only keeps the three routes distinct. The <b className="text-pv-text">RT</b> decides membership. The <b className="text-pv-text">VE ID</b> is a site number inside this one VPLS — not a router ID, a loopback or a VLAN. The <b className="text-pv-text">label block</b> is a base label, a size and an offset. Each PE configures only itself:</p>
        <CliPair cisco={bvOnly(BV_HEALTHY, "PE1", "cisco", "show running-config l2vpn", /vfi|vpn-id|autodiscovery|rd |route-target|signaling|ve-id/)} junos={bvCli(BV_HEALTHY_JN, "PE1", "juniper", "show configuration routing-instances")} ciscoCaption="IOS XR · PE1 — a VFI with BGP auto-discovery and BGP signaling" junosCaption="Junos · PE1 — instance-type vpls, RD, vrf-target, site and site-identifier" />
        <CliPanel run={bvOnly(BV_HEALTHY, "RR1", "cisco", "show bgp l2vpn vpls rd 65000:1 1:1/32", /entry|Extended|Block/)} caption="IOS XR · RR1 — PE1's route: RT, MTU, a block of 10 labels from 24000 for VE IDs 1–10" />
        <Callout tone="cyan" title="Block sizes" icon="i">
          The guided lesson draws blocks of 4 labels to keep the picture small. Routers use bigger defaults: IOS XR 10 (<Mono>ve-range</Mono>), Junos 8 (<Mono>label-block-size</Mono>). The labels this lesson uses are the same either way.
        </Callout>
      </GuideSection>

      <GuideSection id="bg-discovery" eyebrow="Control plane" title="Discovery through RR1" tone="bgp">
        <DiagramFrame caption="RR1 reflects client to client, exactly as in the route reflector lesson.">
          <DiscoveryDiagram />
        </DiagramFrame>
        <p>PE1 advertises; RR1 — whose PEs are <b className="text-pv-text">route-reflector clients</b> — reflects it to PE2 and PE3; each compares the RT with its own and, on a match, imports it: PE1 is discovered. Received and imported are different states, and the RT is the only thing between them.</p>
        <CliPair cisco={bvOnly(BV_HEALTHY, "RR1", "cisco", "show bgp l2vpn vpls", /Network|Route Distinguisher|\*>/)} junos={bvCli(BV_HEALTHY_JN, "PE1", "juniper", "show route table bgp.l2vpn.0")} ciscoCaption="IOS XR · RR1 — all three routes, each with its label base" junosCaption="Junos · PE1 — the two routes PE1 received and kept" />
      </GuideSection>

      <GuideSection id="bg-blocks" eyebrow="Signaling" title="Labels from blocks" tone="mpls">
        <DiagramFrame caption="Label = receiver's base + sender's VE ID − block offset.">
          <BlockMath />
        </DiagramFrame>
        <p>Nobody sends a per-pseudowire label. PE2 owns its block; PE1, VE 1, takes slot 1 — <Mono>25000</Mono> — to send to PE2, and PE3, VE 3, takes <Mono>25002</Mono>. PE2 therefore still receives each neighbor on its own label, which is what MAC learning and split horizon need.</p>
      </GuideSection>

      <GuideSection id="bg-mesh" eyebrow="State" title="Six labels, the mesh up" tone="success">
        <FieldTable
          title="Computed labels (IOS XR numbering; the sender pushes, the receiver owns)"
          accent="mpls"
          columns={["Direction", "Receiver's block", "Label"]}
          rows={[
            ["PE1 → PE2", "PE2 · base 25000", <Mono key="a">25000</Mono>],
            ["PE2 → PE1", "PE1 · base 24000", <Mono key="b">24001</Mono>],
            ["PE1 → PE3", "PE3 · base 26000", <Mono key="c">26000</Mono>],
            ["PE3 → PE1", "PE1 · base 24000", <Mono key="d">24002</Mono>],
            ["PE2 → PE3", "PE3 · base 26000", <Mono key="e">26001</Mono>],
            ["PE3 → PE2", "PE2 · base 25000", <Mono key="f">25002</Mono>],
          ]}
        />
        <p>A pseudowire comes up only when both PEs have imported each other, have different VE IDs, each has a slot in the other&apos;s block, and the MTUs carried in the routes match.</p>
        <CliPair cisco={bvOnly(BV_HEALTHY, "PE1", "cisco", "show l2vpn bridge-domain detail", /PW: neighbor|VE-ID local|MPLS  |Label  /)} junos={bvOnly(BV_HEALTHY_JN, "PE1", "juniper", "show vpls connections", /Local site|rmt|Remote PE|Incoming label/)} ciscoCaption="IOS XR · PE1 — receives on 24001 / 24002, pushes 25000 / 26000" junosCaption="Junos · PE1 — the same mesh with Junos labels (262146 / 262147 in, 262401 / 262657 out)" />
      </GuideSection>

      <GuideSection id="bg-nomacs" eyebrow="Key distinction" title="What BGP does not carry" tone="danger">
        <ChecklistCard tone="danger" mark="✕" title="The BGP VPLS table never contains" items={["CE1, CE2 or CE3's MAC address", "which PE a customer MAC sits behind", "anything that stops unknown-unicast flooding"]} />
        <p>When the mesh comes up, every MAC table is still empty.</p>
      </GuideSection>

      <GuideSection id="bg-data" eyebrow="Data plane" title="The same data plane" tone="warning">
        <DiagramFrame caption="Two-label stacks; the inner label comes from the receiver's block.">
          <StackDiagram />
        </DiagramFrame>
        <p>CE1&apos;s first frame toward CE3 is a broadcast ARP request. PE1 learns CE1 on its attachment circuit and floods over both pseudowires; PE2 and PE3 learn CE1 behind their pseudowire to PE1, and split horizon keeps them from relaying to each other. CE3&apos;s reply is unicast and teaches PE1 where CE3 lives. BGP takes no part in any of it.</p>
        <CliPair cisco={bvCli(BV_LEARNED, "PE1", "cisco", "show l2vpn forwarding bridge-domain mac-address location 0/0/CPU0")} junos={bvCli(BV_LEARNED_JN, "PE1", "juniper", "show vpls mac-table")} ciscoCaption="IOS XR · PE1 after one ping — CE1 on the AC, CE3 behind 3.3.3.3" junosCaption="Junos · PE1 — CE3 behind the lsi interface toward PE3" />
        <PingResult s={BV_LEARNED} title="The lab: the first ping CE1 → CE3" />
        <PingResult s={BV_AGAIN} title="The lab: the same ping again" />
        <Callout tone="cyan" title="The numbers on this page" icon="i">
          The pseudowire labels are the same in the guided lesson and the lab. For transport the guided lesson uses short labels (102, 201); the lab allocates like IOS XR: PE1 pushes 24103 toward PE2 and 24104 toward PE3. Junos numbers its label blocks from 262145 and its LDP labels from 299776.
        </Callout>
      </GuideSection>

      <GuideSection id="bg-grow" eyebrow="Edge case" title="A VE ID outside the block" tone="warning">
        <p>In the guided lesson PE3 renumbers to VE ID 7 while every block covers only VE IDs 1–4: there is no slot for PE3 in PE1&apos;s and PE2&apos;s blocks, so the pseudowires toward PE3 stay down until those blocks grow. The guided lesson widens the existing blocks to keep the picture simple.</p>
        <p>Real routers add a <b className="text-pv-text">second block</b> instead: as soon as PE1 imports a VE ID beyond its first block, it advertises another route with a new offset and a new base. With the routers&apos; default sizes VE 7 still fits, so the lab moves PE3 to VE 12 — and PE1 and PE2 each advertise a block at offset 11 (Junos: 9). Nothing has to be configured by hand.</p>
        <Callout tone="danger" title="Unique, always" icon="!">
          A duplicated VE ID is a different story: two PEs claiming the same slot. They see a collision and bring nothing up between them, and a third PE keeps only the one with the lower loopback.
        </Callout>
      </GuideSection>

      <GuideSection id="bg-withdraw" eyebrow="Control plane" title="Leaving and rejoining" tone="danger">
        <p>When PE3 withdraws its route, PE1 and PE2 lose PE3 as a member and tear down their pseudowires to it; PE1 ↔ PE2 keeps working. When PE3 advertises again, everything is rebuilt from the fresh route — the same mechanism that made the mesh in the first place.</p>
      </GuideSection>

      <GuideSection id="bg-working" eyebrow="Evidence" title="What working looks like" tone="success">
        <FieldTable
          title="Healthy, in five questions"
          accent="success"
          columns={["Question", "IOS XR", "Healthy answer"]}
          rows={[
            ["Does every PE exchange VPLS routes with RR1?", <Mono key="1">show bgp l2vpn vpls summary</Mono>, "one neighbor, routes received"],
            ["Does RR1 hold and reflect every route?", <Mono key="2">show bgp l2vpn vpls</Mono>, "three RDs on RR1, three on each PE"],
            ["Is every pseudowire up?", <Mono key="3">show l2vpn bridge-domain</Mono>, "PWs: 2 (2 up) on each PE"],
            ["Are VE IDs unique and labels both ways?", <Mono key="4">show l2vpn bridge-domain detail</Mono>, "VE-ID local / remote, local and remote label"],
            ["Does every pair of sites work?", "fresh pings", "CE1↔CE2, CE1↔CE3, CE2↔CE3"],
          ]}
        />
      </GuideSection>

      <GuideSection id="bg-incident" eyebrow="Incident" title="The incident" tone="danger">
        <DiagramFrame caption="The session is fine; the question is whether the route is imported.">
          <RtFaultDiagram />
        </DiagramFrame>
        <p>After a change on PE3, CE3 reaches nobody. PE3&apos;s BGP session to RR1 is Established, its VPLS is configured, and CE1 ↔ CE2 works.</p>
        <PingResult s={BV_FAULT} title="The lab: CE1 pings 192.168.100.3 (the ticket)" />
        <PingResult s={BV_FAULT_OK} title="The lab: CE1 pings 192.168.100.2 — still fine" />
      </GuideSection>

      <GuideSection id="bg-investigate" eyebrow="Incident" title="Walk the evidence" tone="danger">
        <TroubleshootingFlow
          steps={[
            { question: "Which pairs fail?", look: "Every pair that includes CE3." },
            { question: "Is PE3's session up, with the family?", look: "Yes — Established, L2VPN VPLS negotiated." },
            { question: "Does RR1 hold PE3's route?", look: "Yes — with RT 65000:999." },
            { question: "Did PE1 import it?", look: "No: PE1 imports 65000:100. Received, not imported." },
          ]}
        />
        <CliPanel run={bvOnly(BV_FAULT, "RR1", "cisco", "show bgp l2vpn vpls rd 65000:3 3:1/32", /entry|Extended|Block/)} caption="IOS XR · RR1 — PE3's route is there, with RT 65000:999" />
        <CliPanel run={bvOnly(BV_FAULT, "PE1", "cisco", "show bgp l2vpn vpls", /Network|Route Distinguisher|\*>|Processed/)} caption="IOS XR · PE1 — no route from 65000:3 kept" />
        <CliPanel run={bvOnly(BV_FAULT_JN, "PE1", "juniper", "show vpls connections", /Local site|rmt|Remote PE/)} caption="Junos · PE1 — only remote site 2: PE3 was never discovered" />
      </GuideSection>

      <GuideSection id="bg-fix" eyebrow="Incident" title="Repair and prove it" tone="success">
        <CliPair cisco={{ prompt: "RP/0/RP0/CPU0:PE3(config)#", command: "l2vpn", output: "RP/0/RP0/CPU0:PE3(config-l2vpn)#bridge group CUST-A\nRP/0/RP0/CPU0:PE3(config-l2vpn-bg)#bridge-domain VPLS-A\nRP/0/RP0/CPU0:PE3(config-l2vpn-bg-bd)#vfi VPLS-A\nRP/0/RP0/CPU0:PE3(config-l2vpn-bg-bd-vfi)#autodiscovery bgp\nRP/0/RP0/CPU0:PE3(config-l2vpn-bg-bd-vfi-ad)#route-target 65000:100\nRP/0/RP0/CPU0:PE3(config-l2vpn-bg-bd-vfi-ad)#commit" }} junos={{ prompt: "admin@PE3# ", command: "set routing-instances VPLS-A vrf-target target:65000:100", output: "\n[edit]\nadmin@PE3# commit and-quit\ncommit complete\nExiting configuration mode" }} ciscoCaption="IOS XR · PE3" junosCaption="Junos · PE3" />
        <PingResult s={BV_FIXED} title="The lab: a fresh ping after the fix" />
        <ChecklistCard tone="success" title="Proved, not assumed" mark="✓" items={["PE3 re-advertises with RT 65000:100; PE1 and PE2 import it, PE3 imports theirs", "all six pseudowire ends are up with labels from the blocks", "a fresh ping from CE1 reaches CE3"]} />
      </GuideSection>

      <GuideSection id="bg-other" eyebrow="Beyond this incident" title="Other ways it fails" tone="warning">
        <FailureSignatures
          items={[
            { tag: "AF", title: "L2VPN family missing", tone: "danger", points: ["session Established", "zero VPLS routes either way"] },
            { tag: "RR", title: "PEs not route-reflector clients", tone: "danger", points: ["RR1 holds every route", "no PE receives any"] },
            { tag: "VE", title: "Duplicate VE ID", tone: "violet", points: ["collision between two PEs", "one site isolated"] },
            { tag: "LSP", title: "Transport broken", tone: "warning", points: ["XR: PWs up, drops in the core", "Junos: PWs down"] },
          ]}
        />
        <p className="text-sm text-pv-text-muted">Each is a ticket in the BGP VPLS Lab, together with this incident.</p>
      </GuideSection>

      <GuideSection id="bg-model" eyebrow="Mental model" title="Mental model" tone="cyan">
        <p>
          Picture the same three office buildings with their receptionists and direct phone lines. Last time, each receptionist kept a hand-written list of the other buildings and called each one to agree on a line. Now there is a noticeboard in a central office (the route reflector). Each receptionist pins one card: &quot;I belong to club 65000:100 (the RT), I&apos;m desk number 1 (the VE ID), and to reach me, dial my base number plus your desk number.&quot; Every receptionist reads the cards for their own club, ignores the rest, and works out the number to dial for each colleague. A card for the wrong club is still on the board — nobody reads it. Once the lines exist, envelopes are handled exactly as before: learn who is where, send a copy everywhere when unsure, never pass an envelope from one line to another.
        </p>
        <Callout tone="cyan" title="When it breaks, ask in this order" icon="→">
          Which pairs of sites fail? Is every site&apos;s attachment circuit in the VPLS? Does every PE exchange L2VPN VPLS routes with RR1? Has every PE imported every other PE&apos;s route? Is every pseudowire up — unique VE IDs, same MTU? Is the transport LSP complete?
        </Callout>
      </GuideSection>

      <GuideSection id="bg-glossary" eyebrow="Reference" title="Glossary" tone="cyan">
        <Glossary
          items={[
            { term: "BGP VPLS", def: "VPLS whose members are discovered and whose pseudowires are signaled by BGP (RFC 4761)." },
            { term: "VE ID", def: "VPLS Edge identifier: a PE's site number inside one VPLS (Junos: site-identifier)." },
            { term: "Label block", def: "A base label, a size (VBS) and an offset (VBO) a PE advertises for the others to pick from." },
            { term: "VBO / VBS", def: "VE Block Offset (first VE ID served) and VE Block Size (how many)." },
            { term: "RD", def: "Route distinguisher: keeps each PE's route unique in BGP." },
            { term: "RT", def: "Route target: the membership test — a PE imports routes carrying its RT." },
            { term: "AFI 25 / SAFI 65", def: "The L2VPN VPLS address family: IOS XR l2vpn vpls-vpws, Junos family l2vpn signaling." },
            { term: "Route-reflector client", def: "A peer whose routes RR1 reflects to everyone, and to which it reflects everyone's." },
          ]}
        />
      </GuideSection>

      <GuideSection id="bg-recap" eyebrow="Reference" title="Recap" tone="success">
        <ChecklistCard tone="success" title="You can now" mark="✓" items={["say what BGP took over from targeted LDP — and what it didn't", "read a VPLS route and its label block", "follow a route through RR1 and tell received from imported", "compute every pseudowire label", "explain new blocks and VE ID collisions", "find, fix and prove a membership fault"]} />
      </GuideSection>

      <GuideSection id="bg-practice" eyebrow="Next" title="Practice it" tone="violet">
        <p>The Deep Dive tab covers BGP VPLS in full: why BGP, the NLRI and its layer-2 information, route reflection, the label-block arithmetic, multiple blocks, VE ID collisions and designated forwarding, the BGP-AD variant, IOS XR and Junos configuration, and every failure signature with real evidence. The lab lets you operate it.</p>
        <LessonLabBridge />
        <PresentationBridge>Rewatch the BGP VPLS presentation.</PresentationBridge>
      </GuideSection>
    </div>
  );
}
