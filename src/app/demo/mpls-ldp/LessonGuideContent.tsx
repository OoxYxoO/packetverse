import { Callout, ChecklistCard, CompareCards, DArrow, DIAGRAM as D, DLink, DNode, DPill, DRegion, DiagramFrame, DiagramSvg, FailureSignatures, FieldTable, FlowSteps, Glossary, GuideSection, Mono, TroubleshootingFlow } from "@/components/lesson/GuideBlocks";
import { DStack } from "@/components/lesson/MplsGuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { PracticeBridge } from "@/components/lesson/GuideInteractive";
import { usePracticeLabOpener } from "@/components/lesson/FundamentalsLessonShell";
import { PresentationBridge } from "@/components/presentation/LessonPresentation";
import { CliPair, CliPanel, runGuideCli } from "@/components/lesson/GuideCli";
import type { CliVendor } from "@/lib/cli/types";
import { createMpNet, mpApply, type MpAction, type MpOs, type MpR, type MpState } from "@/lib/sim-engine/scenarios/mplsNet";
import { mpSets, mpStaticApi } from "./mpls-lab/mpCli";

export const LDP_LESSON_SECTIONS: LessonGuideSectionLink[] = [
  { id: "ll-mission", label: "What this lesson teaches" },
  { id: "ll-network", label: "The network of this lesson" },
  { id: "ll-ideas", label: "Three ideas you need" },
  { id: "ll-watch", label: "What you will watch" },
  { id: "ll-problem", label: "A core that can't route customers" },
  { id: "ll-fec", label: "One FEC, one label per router" },
  { id: "ll-ldp", label: "LDP: discovery, then a session" },
  { id: "ll-mapping", label: "Labels flow upstream" },
  { id: "ll-tables", label: "LIB and LFIB" },
  { id: "ll-walk", label: "Push, swap, pop" },
  { id: "ll-php", label: "Why P2 pops" },
  { id: "ll-planes", label: "Control plane vs data plane" },
  { id: "ll-working", label: "What working looks like" },
  { id: "ll-incident", label: "The incident" },
  { id: "ll-investigate", label: "Walk the chain" },
  { id: "ll-repair", label: "Repair and prove it" },
  { id: "ll-other", label: "Other ways MPLS breaks" },
  { id: "ll-model", label: "Mental model" },
  { id: "ll-glossary", label: "Glossary" },
  { id: "ll-recap", label: "Recap" },
  { id: "ll-practice", label: "Practice it" },
];

/**
 * The lesson's network from the MPLS + LDP Lab's own model, with the lab's backup path (P3–P4) switched off: exactly
 * CE1 — PE1 — P1 — P2 — PE2 — CE2. Every CLI sample on this page is the lab's IOS XR / Junos command set run against it.
 */
const run = (s: MpState, as: MpAction[]) => as.reduce((acc, a) => mpApply(acc, a), s);
const line = (os: MpOs) => run(createMpNet(0, os), [{ type: "link", link: "PE1-P3", up: false }, { type: "link", link: "P3-P4", up: false }, { type: "link", link: "P4-PE2", up: false }]);
const breakIt = (s: MpState) => mpApply(s, { type: "set", text: "P1: LDP removed from ge-0/0/1", changes: [{ dev: "P1", f: (r) => void (r.ifs["ge-0/0/1"]!.ldp = false) }] });
export const LINE = line("xr");
export const LINE_JN = line("junos");
export const LINE_BROKEN = breakIt(LINE);
const LINE_BROKEN_JN = breakIt(LINE_JN);
const LINE_FIXED = mpApply(LINE_BROKEN, { type: "set", text: "P1: LDP back on ge-0/0/1", changes: [{ dev: "P1", f: (r) => void (r.ifs["ge-0/0/1"]!.ldp = true) }] });
export function lineCli(s: MpState, r: MpR, vendor: CliVendor, command: string) {
  return runGuideCli(mpSets(mpStaticApi(s, r), r)[vendor], command);
}

function LessonLabBridge() {
  const openLab = usePracticeLabOpener();
  return (
    <PracticeBridge label="Open the MPLS + LDP Lab" onPractice={openLab}>
      The same routers plus a backup path (P3–P4), IOS XR or Junos, your own copy. Nothing you do there changes your lesson progress.
    </PracticeBridge>
  );
}

export function TopologyDiagram() {
  const nodes: [string, number, string, string][] = [
    ["CE1", 50, "10.1.1.10", D.ip],
    ["PE1", 160, "1.1.1.1 · LER", D.mpls],
    ["P1", 268, "2.2.2.2 · LSR", D.mpls],
    ["P2", 376, "3.3.3.3 · LSR", D.mpls],
    ["PE2", 484, "4.4.4.4 · LER", D.mpls],
    ["CE2", 592, "10.2.2.20", D.ip],
  ];
  return (
    <DiagramSvg h={150} label="CE1, PE1, P1, P2, PE2, CE2 in a line; PE1 to PE2 is the MPLS domain">
      <DRegion x={108} y={14} w={430} h={96} label="MPLS domain (IS-IS + LDP)" color={D.mpls} />
      {nodes.slice(0, -1).map(([id, x], i) => (
        <DLink key={id} x1={x + 40} y1={66} x2={nodes[i + 1][1] - 40} y2={66} color={i === 0 || i === 4 ? D.line : D.mpls} />
      ))}
      {nodes.map(([id, x, sub, c]) => (
        <DNode key={id} x={x} y={66} label={id} sub={sub} accent={c} w={80} />
      ))}
      <text x={320} y={136} textAnchor="middle" fill={D.muted} fontSize={10}>
        CEs never see a label · PEs push the first and remove the last · Ps only switch labels
      </text>
    </DiagramSvg>
  );
}

export function LdpSequenceDiagram() {
  return (
    <DiagramSvg h={230} label="PE1 and P1 exchange Hellos over UDP, then P1 opens a TCP 646 session, then label mappings flow">
      <DNode x={110} y={30} label="PE1" sub="1.1.1.1:0" accent={D.mpls} />
      <DNode x={530} y={30} label="P1" sub="2.2.2.2:0" accent={D.mpls} />
      <line x1={110} y1={54} x2={110} y2={220} stroke={D.line} strokeDasharray="3 4" />
      <line x1={530} y1={54} x2={530} y2={220} stroke={D.line} strokeDasharray="3 4" />
      <DArrow x1={114} y1={80} x2={526} y2={80} color={D.mpls} both dashed label="1 · Hello (UDP 646, multicast) — discovery" />
      <DArrow x1={526} y1={122} x2={114} y2={122} color={D.violet} label="2 · TCP 646 connection (P1 opens it)" />
      <DArrow x1={114} y1={160} x2={526} y2={160} color={D.violet} both label="3 · Initialization + KeepAlive → OPERATIONAL" />
      <DArrow x1={526} y1={202} x2={114} y2={202} color={D.success} label="4 · Label Mapping: FEC 4.4.4.4/32 = 102" />
    </DiagramSvg>
  );
}

export function DistributionDiagram() {
  const r: [string, number][] = [
    ["PE1", 110],
    ["P1", 250],
    ["P2", 390],
    ["PE2", 530],
  ];
  return (
    <DiagramSvg h={200} label="Label mappings travel upstream from PE2 to PE1 while traffic travels downstream">
      {r.slice(0, -1).map(([id, x], i) => (
        <DLink key={id} x1={x + 50} y1={50} x2={r[i + 1][1] - 50} y2={50} color={D.mpls} />
      ))}
      {r.map(([id, x]) => (
        <DNode key={id} x={x} y={50} label={id} accent={D.mpls} />
      ))}
      <DArrow x1={486} y1={104} x2={434} y2={104} color={D.violet} label="implicit-null" />
      <DArrow x1={346} y1={104} x2={294} y2={104} color={D.violet} label="203" />
      <DArrow x1={206} y1={104} x2={154} y2={104} color={D.violet} label="102" />
      <text x={320} y={132} textAnchor="middle" fill={D.violet} fontSize={10} fontWeight={700}>
        control plane: Label Mappings travel upstream (toward the ingress)
      </text>
      <DArrow x1={110} y1={168} x2={530} y2={168} color={D.success} label="data plane: traffic toward 4.4.4.4/32 travels downstream" labelDy={-8} />
    </DiagramSvg>
  );
}

export function WalkDiagram() {
  const n: [string, number][] = [
    ["CE1", 40],
    ["PE1", 155],
    ["P1", 270],
    ["P2", 385],
    ["PE2", 500],
    ["CE2", 600],
  ];
  const ops: [number, string][] = [
    [155, "PUSH 102"],
    [270, "SWAP 102 → 203"],
    [385, "POP (PHP)"],
    [500, "IP lookup"],
  ];
  const mid = (i: number) => (n[i][1] + n[i + 1][1]) / 2;
  return (
    <DiagramSvg h={150} label="The packet is plain IP, then carries 102, then 203, then is plain IP again after P2">
      {n.slice(0, -1).map(([id, x], i) => (
        <DLink key={id} x1={x + 34} y1={28} x2={n[i + 1][1] - 34} y2={28} color={D.line} />
      ))}
      {n.map(([id, x]) => (
        <DNode key={id} x={x} y={28} label={id} w={68} h={36} accent={id.startsWith("CE") ? D.ip : D.mpls} />
      ))}
      {ops.map(([x, t]) => (
        <text key={t} x={x} y={62} textAnchor="middle" fill={D.warning} fontSize={9.5} fontWeight={700}>
          {t}
        </text>
      ))}
      <DStack x={mid(0)} y={78} labels={[]} w={70} />
      <DStack x={mid(1)} y={78} labels={[{ text: "102 S1" }]} w={70} />
      <DStack x={mid(2)} y={78} labels={[{ text: "203 S1" }]} w={70} />
      <DStack x={mid(3)} y={78} labels={[]} w={70} />
      <DStack x={mid(4)} y={78} labels={[]} w={70} />
    </DiagramSvg>
  );
}

export function PhpDiagram() {
  return (
    <DiagramSvg h={170} label="Without PHP the egress PE does two lookups; with PHP it receives plain IP and does one">
      <text x={20} y={30} fill={D.danger} fontSize={10.5} fontWeight={700}>
        Without PHP
      </text>
      <DNode x={170} y={55} label="P2" accent={D.mpls} w={80} />
      <DArrow x1={212} y1={55} x2={350} y2={55} color={D.danger} />
      <DPill x={281} y={36} text="label + IP" color={D.danger} />
      <DNode x={392} y={55} label="PE2" accent={D.mpls} w={80} />
      <text x={440} y={59} fill={D.text} fontSize={10}>
        LFIB lookup, then IP lookup
      </text>
      <text x={20} y={112} fill={D.success} fontSize={10.5} fontWeight={700}>
        With PHP
      </text>
      <DNode x={170} y={137} label="P2" sub="POP" accent={D.mpls} w={80} />
      <DArrow x1={212} y1={137} x2={350} y2={137} color={D.success} />
      <DPill x={281} y={118} text="IP only" color={D.success} />
      <DNode x={392} y={137} label="PE2" sub="imp-null" accent={D.mpls} w={80} />
      <text x={440} y={141} fill={D.text} fontSize={10}>
        one IP lookup
      </text>
    </DiagramSvg>
  );
}


function BgpFreeDiagram() {
  return (
    <DiagramSvg h={190} label="PE1 and PE2 know the customer prefixes through BGP; P1 and P2 only know loopbacks through IS-IS; a plain IP packet for 10.2.2.20 dies at P1">
      <DRegion x={108} y={14} w={430} h={110} label="core: IS-IS only — no customer routes" color={D.mpls} />
      <DNode x={50} y={70} label="CE1" sub="10.1.1.10" accent={D.ip} w={80} />
      <DNode x={160} y={70} label="PE1" sub="BGP: 10.2.2.0/24 → 4.4.4.4" accent={D.success} w={120} />
      <DNode x={320} y={70} label="P1" sub="10.2.2.20 → ?" accent={D.danger} w={96} />
      <DNode x={470} y={70} label="P2" sub="loopbacks only" accent={D.mpls} w={96} />
      <DNode x={592} y={70} label="PE2" sub="4.4.4.4" accent={D.success} w={80} />
      <DLink x1={90} y1={70} x2={100} y2={70} />
      <DArrow x1={222} y1={70} x2={270} y2={70} color={D.ip} label="IP" />
      <DLink x1={368} y1={70} x2={422} y2={70} color={D.mpls} />
      <DLink x1={518} y1={70} x2={552} y2={70} color={D.mpls} />
      <text x={320} y={150} textAnchor="middle" fill={D.danger} fontSize={10.5} fontWeight={700}>
        Without labels: P1 has no route to 10.2.2.20 → dropped
      </text>
      <text x={320} y={170} textAnchor="middle" fill={D.muted} fontSize={10}>
        With a label meaning “toward 4.4.4.4”, P1 only needs its IS-IS route to PE2
      </text>
    </DiagramSvg>
  );
}

export function LdpLessonGuideContent() {
  return (
    <div className="space-y-12">
      <GuideSection id="ll-mission" eyebrow="This lesson" title="What this lesson teaches" tone="mpls">
        <p>
          PE1 and PE2 sit at the edge of a provider core and know each other&apos;s customer networks through BGP. The core routers P1 and P2 run only IS-IS — they know every loopback and no customer route. So how does CE1&apos;s packet for CE2 get across? This lesson builds the answer: <b className="text-pv-text">MPLS</b> labels, distributed by <b className="text-pv-text">LDP</b>.
        </p>
        <p>You will watch LDP find neighbors and spread labels upstream from PE2, then follow one customer packet as it is pushed, swapped and popped across the core. Then one interface stops running LDP: every loopback still answers, and the customers are cut off. You find out why, fix it and prove it.</p>
        <ChecklistCard
          tone="violet"
          title="By the end of this lesson you can"
          mark="→"
          items={["explain why a BGP-free core needs labels", "describe LDP discovery and the session between loopbacks", "follow a label mapping upstream from the egress", "read a LIB and an LFIB and tell them apart", "walk a packet through push, swap and pop (and say why the penultimate hop pops)", "prove an LSP with LSP ping, and find why IP works while labels don't"]}
        />
      </GuideSection>

      <GuideSection id="ll-network" eyebrow="This lesson" title="The network of this lesson" tone="cyan">
        <DiagramFrame caption="CE1 and CE2 are customer hosts; PE1–P1–P2–PE2 is the provider's MPLS core, running IS-IS and LDP.">
          <TopologyDiagram />
        </DiagramFrame>
        <FieldTable
          title="Who knows what"
          accent="mpls"
          columns={["Router", "Loopback (LDP router ID)", "Routes it has", "Role"]}
          rows={[
            ["PE1", <Mono key="1">1.1.1.1</Mono>, "IS-IS loopbacks + BGP 10.2.2.0/24 via 4.4.4.4", "ingress: pushes the first label"],
            ["P1", <Mono key="2">2.2.2.2</Mono>, "IS-IS loopbacks only", "core: swaps labels"],
            ["P2", <Mono key="3">3.3.3.3</Mono>, "IS-IS loopbacks only", "penultimate hop: pops"],
            ["PE2", <Mono key="4">4.4.4.4</Mono>, "IS-IS loopbacks + BGP 10.1.1.0/24 via 1.1.1.1", "egress: routes plain IP to CE2"],
          ]}
        />
        <p className="text-sm text-pv-text-muted">The IGP is IS-IS — the previous lesson — and the PEs&apos; BGP routes come from the BGP lesson. The MPLS + LDP Lab adds P3 and P4 as a backup path; the outputs on this page come from the lab&apos;s model with that path switched off.</p>
      </GuideSection>

      <GuideSection id="ll-ideas" eyebrow="This lesson" title="Three ideas you need" tone="violet">
        <CompareCards
          items={[
            { title: "A BGP-free core", tone: "cyan", tag: "why", points: ["only the PEs know customer prefixes", "the core forwards toward the BGP next hop: PE2's loopback"] },
            { title: "A label means a FEC", tone: "violet", tag: "what", points: ["“everything for 4.4.4.4/32”", "each router picks its own label number for it"] },
            { title: "LDP rides on the IGP", tone: "success", tag: "how", points: ["sessions run between loopbacks", "labels follow the IGP next hop"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="ll-watch" eyebrow="This lesson" title="What you will watch" tone="cyan">
        <FlowSteps
          steps={[
            { title: "The problem", body: "A plain IP packet dies at P1.", tone: "danger" },
            { title: "LDP", body: "Hellos, then TCP sessions between loopbacks.", tone: "mpls" },
            { title: "Labels", body: "Mappings for 4.4.4.4/32 flow upstream from PE2.", tone: "violet" },
            { title: "Forwarding", body: "PUSH at PE1, SWAP at P1, POP at P2.", tone: "success" },
            { title: "The incident", body: "LDP off on one link: IP works, customers don't.", tone: "danger" },
            { title: "Repair", body: "Restore LDP, prove the LSP and the customer path.", tone: "success" },
          ]}
        />
      </GuideSection>

      <GuideSection id="ll-problem" eyebrow="Why MPLS" title="A core that can't route customers" tone="warning">
        <DiagramFrame caption="The core is BGP-free on purpose: no customer routes, small and stable.">
          <BgpFreeDiagram />
        </DiagramFrame>
        <p>
          Keeping customer routes out of the core is a design choice: the core stays small, converges fast and never feels a customer&apos;s routing churn. The price is that a core router can&apos;t forward a packet by its customer destination. PE1 must hand the core something it <b className="text-pv-text">can</b> forward: a label that means &quot;toward 4.4.4.4&quot;.
        </p>
      </GuideSection>

      <GuideSection id="ll-fec" eyebrow="The idea" title="One FEC, one label per router" tone="violet">
        <p>
          A <b className="text-pv-text">Forwarding Equivalence Class</b> groups packets that are forwarded the same way. Every customer packet whose BGP next hop is 4.4.4.4 belongs to the FEC <Mono>4.4.4.4/32</Mono>. For that FEC each router chooses a label of its own and tells its neighbors: &quot;send me packets for 4.4.4.4 with this label&quot;. The number only means something to the router that chose it.
        </p>
        <Callout tone="cyan" title="The numbers on this page" icon="i">
          The guided walkthrough uses short labels so you can follow them: P1 = <b>102</b>, P2 = <b>203</b>. Real routers allocate from large ranges, so the lab&apos;s P1 uses <b>24102</b> and P2 <b>24203</b> on IOS XR (299878 and 299979 on Junos). The meaning is identical: whoever receives the packet chose the label.
        </Callout>
      </GuideSection>

      <GuideSection id="ll-ldp" eyebrow="LDP" title="LDP: discovery, then a session" tone="mpls">
        <DiagramFrame caption="Hellos discover; the TCP session between loopbacks carries the labels.">
          <LdpSequenceDiagram />
        </DiagramFrame>
        <p>
          Each LDP interface sends <b className="text-pv-text">Hellos</b> (UDP 646 to 224.0.0.2) carrying the router&apos;s transport address — its loopback. Two routers that hear each other then open <b className="text-pv-text">TCP 646</b> between their loopbacks; that needs IS-IS routes to them. After Initialization and Keepalive, the session is Operational and label mappings can flow.
        </p>
        <CliPanel run={lineCli(LINE, "P1", "cisco", "show mpls ldp neighbor brief")} caption="IOS XR · P1 — two LDP sessions" />
      </GuideSection>

      <GuideSection id="ll-mapping" eyebrow="LDP" title="Labels flow upstream" tone="violet">
        <DiagramFrame caption="Label mappings travel against the direction the traffic will take.">
          <DistributionDiagram />
        </DiagramFrame>
        <p>
          PE2 owns 4.4.4.4 and advertises <b className="text-pv-text">implicit-null</b> for it: &quot;don&apos;t put a label on packets you send me&quot;. P2 then advertises its own label to P1, and P1 its own label to PE1. Each router advertises to <b className="text-pv-text">every</b> LDP neighbor, without being asked (downstream unsolicited).
        </p>
        <CliPanel run={lineCli(LINE, "P1", "cisco", "show mpls ldp bindings 4.4.4.4/32")} caption="IOS XR · P1 — its own label and the ones it heard" />
      </GuideSection>

      <GuideSection id="ll-tables" eyebrow="Two tables" title="LIB and LFIB" tone="cyan">
        <CompareCards
          items={[
            { title: "LIB", tone: "violet", tag: "control plane", points: ["every binding heard from every LDP neighbor", "kept even when not used (liberal retention)"] },
            { title: "LFIB", tone: "success", tag: "data plane", points: ["in label → out label, next hop", "uses only the binding from the IGP next hop"] },
          ]}
        />
        <CliPanel run={lineCli(LINE, "P1", "cisco", "show mpls forwarding prefix 4.4.4.4/32")} caption="IOS XR · P1's LFIB entry — in 24102, out 24203 toward P2" />
      </GuideSection>

      <GuideSection id="ll-walk" eyebrow="Forwarding" title="Push, swap, pop" tone="success">
        <DiagramFrame caption="The packet carries one label across the core and none on either side of it.">
          <WalkDiagram />
        </DiagramFrame>
        <p>
          PE1 resolves 10.2.2.20 → BGP next hop 4.4.4.4 → P1&apos;s label, and <b className="text-pv-text">pushes</b> it. P1 reads only the label and <b className="text-pv-text">swaps</b> it for P2&apos;s. P2 <b className="text-pv-text">pops</b>, and PE2 routes the plain IP packet to CE2. No core router ever looks up 10.2.2.20.
        </p>
        <CliPanel run={lineCli(LINE, "PE1", "cisco", "traceroute 10.2.2.20")} caption="IOS XR · PE1 — each hop reports the label it received" />
      </GuideSection>

      <GuideSection id="ll-php" eyebrow="Forwarding" title="Why P2 pops" tone="warning">
        <DiagramFrame caption="Penultimate-hop popping: the egress does one lookup instead of two.">
          <PhpDiagram />
        </DiagramFrame>
        <p>Without PHP, PE2 would look up the label only to learn &quot;this is for me&quot;, then look up the IP header. Implicit-null lets P2 remove the label instead. If the egress needs to see a label (for example to keep the traffic-class bits), it advertises explicit-null (label 0) — you can try it in the lab.</p>
      </GuideSection>

      <GuideSection id="ll-planes" eyebrow="The big picture" title="Control plane vs data plane" tone="violet">
        <CompareCards
          items={[
            { title: "Control plane", tone: "violet", tag: "builds state", points: ["IS-IS: how to reach 4.4.4.4/32", "LDP: which label means that FEC on each link", "BGP (on the PEs): which customer prefixes sit behind 4.4.4.4"] },
            { title: "Data plane", tone: "success", tag: "uses state", points: ["PUSH at PE1, SWAP at P1, POP at P2", "uses only the FIB / LFIB", "never runs a protocol per packet"] },
          ]}
        />
        <p className="text-sm text-pv-text-muted">LDP only labels FECs the IGP can reach. If IS-IS loses 4.4.4.4, the labels for it are withdrawn too.</p>
      </GuideSection>

      <GuideSection id="ll-working" eyebrow="Evidence" title="What working looks like" tone="success">
        <FieldTable
          title="Healthy, in five questions"
          accent="success"
          columns={["Question", "IOS XR", "Healthy answer"]}
          rows={[
            ["LDP session on every core link?", <Mono key="1">show mpls ldp neighbor brief</Mono>, "P1 sees 1.1.1.1:0 and 3.3.3.3:0"],
            ["Which label did each neighbor give?", <Mono key="2">show mpls ldp bindings 4.4.4.4/32</Mono>, "P2 gave 24203 to P1"],
            ["What does P1 do with label 24102?", <Mono key="3">show mpls forwarding</Mono>, "swap to 24203 toward P2"],
            ["What does PE1 push?", <Mono key="4">show cef 10.2.2.20</Mono>, "labels imposed {24102}"],
            ["Does the LSP work end to end?", <Mono key="5">ping mpls ipv4 4.4.4.4/32</Mono>, "!!!!!"],
          ]}
        />
        <CliPanel run={lineCli(LINE, "PE1", "cisco", "show cef 10.2.2.20")} caption="IOS XR · PE1 — the BGP route resolves through 4.4.4.4 and gets label 24102" />
        <CliPair cisco={lineCli(LINE, "PE1", "cisco", "ping mpls ipv4 4.4.4.4/32")} junos={lineCli(LINE_JN, "PE1", "juniper", "ping mpls ldp 4.4.4.4")} ciscoCaption="IOS XR · PE1" junosCaption="Junos · PE1" />
      </GuideSection>

      <GuideSection id="ll-incident" eyebrow="Incident" title="The incident" tone="danger">
        <p>After a change on P1, customers report that CE1 can no longer reach CE2. The NOC checks the core: every router answers pings on its loopback, and IS-IS is perfectly converged. Somebody removed LDP from P1&apos;s interface toward P2.</p>
        <CompareCards
          items={[
            { title: "What it is", tone: "danger", tag: "cause", points: ["no LDP on P1–P2: no discovery, no session", "P1 has no label from P2 for 4.4.4.4", "on IOS XR, P1 removes the label and hands P2 plain IP for 10.2.2.20 — P2 has no route for it"] },
            { title: "What it can't be", tone: "success", tag: "ruled out", points: ["IS-IS: every loopback is reachable", "BGP: PE1 still has 10.2.2.0/24 via 4.4.4.4", "the link: IS-IS runs over it"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="ll-investigate" eyebrow="Incident" title="Walk the chain" tone="danger">
        <TroubleshootingFlow
          steps={[
            { question: "Does IP work in the core?", look: "PE1 pings 4.4.4.4: yes. The IGP is fine; the problem is in MPLS." },
            { question: "Does the LSP work?", look: "LSP ping to 4.4.4.4/32 fails with B — a hop had to forward without a label." },
            { question: "Which hop?", look: "P1 has no LDP session with P2; its LFIB says Unlabelled toward P2." },
            { question: "Why no session?", look: "P1's interface toward P2 isn't an LDP interface any more: no Hellos, no discovery." },
          ]}
        />
        <CliPanel run={lineCli(LINE_BROKEN, "PE1", "cisco", "ping 4.4.4.4")} caption="IOS XR · PE1 — plain IP to the loopback still works" />
        <CliPanel run={lineCli(LINE_BROKEN, "PE1", "cisco", "ping mpls ipv4 4.4.4.4/32")} caption="IOS XR · PE1 — the LSP doesn't (B = unlabeled output interface)" />
        <CliPanel run={lineCli(LINE_BROKEN, "P1", "cisco", "show mpls ldp neighbor brief")} caption="IOS XR · P1 — only PE1 left" />
        <CliPanel run={lineCli(LINE_BROKEN, "P1", "cisco", "show mpls forwarding prefix 4.4.4.4/32")} caption="IOS XR · P1 — Unlabelled toward P2" />
        <Callout tone="warning" title="The same fault on Junos" icon="!">
          Junos uses ordered label control: P1 never advertises a label for 4.4.4.4 it didn&apos;t receive, so PE1 has no LDP route to 4.4.4.4 in <Mono>inet.3</Mono>, its BGP route to 10.2.2.0/24 becomes hidden, and PE1 drops the traffic itself. Same cause, different place to look.
        </Callout>
        <CliPanel run={lineCli(LINE_BROKEN_JN, "PE1", "juniper", "show route 10.2.2.20 hidden")} caption="Junos · PE1 — the BGP route is unusable" />
      </GuideSection>

      <GuideSection id="ll-repair" eyebrow="Incident" title="Repair and prove it" tone="success">
        <p>Put P1&apos;s interface back into LDP and commit:</p>
        <CliPanel run={{ prompt: "RP/0/RP0/CPU0:P1(config)#", command: "mpls ldp", output: "RP/0/RP0/CPU0:P1(config-ldp)#interface GigabitEthernet0/0/0/1\nRP/0/RP0/CPU0:P1(config-ldp-if)#commit\nRP/0/RP0/CPU0:P1(config-ldp-if)#end" }} caption="IOS XR · P1" />
        <CliPanel run={lineCli(LINE_FIXED, "P1", "cisco", "show mpls forwarding prefix 4.4.4.4/32")} caption="IOS XR · P1 — swapping to P2's label again" />
        <ChecklistCard tone="success" title="Proved, not assumed" mark="✓" items={["LDP session P1–P2 Operational", "P1's LFIB swaps 24102 → 24203 toward P2", "LSP ping to 4.4.4.4/32 succeeds", "a fresh CE1 → CE2 ping succeeds"]} />
      </GuideSection>

      <GuideSection id="ll-other" eyebrow="Beyond this incident" title="Other ways MPLS breaks" tone="warning">
        <FailureSignatures
          items={[
            { tag: "TA", title: "Transport address unreachable", tone: "warning", points: ["Hellos heard, no session", "a loopback missing from the IGP"] },
            { tag: "MTU", title: "No room for the label", tone: "danger", points: ["small packets work, 1500-byte ones don't", "a core link with a 1500-byte MTU"] },
            { tag: "1W", title: "One direction unlabeled", tone: "violet", points: ["LSPs are one-way: each direction needs its own labels", "a PE without LDP breaks the return path"] },
            { tag: "BKP", title: "Backup path without LDP", tone: "warning", points: ["fine until a failure moves the IGP", "fixed by LDP everywhere, or LDP–IGP sync"] },
          ]}
        />
        <p className="text-sm text-pv-text-muted">Each is a ticket in the MPLS + LDP Lab.</p>
      </GuideSection>

      <GuideSection id="ll-model" eyebrow="Mental model" title="Mental model" tone="cyan">
        <p>
          Picture a parcel system where only the depots at the edge read addresses. PE1 looks at CE2&apos;s address once and puts the parcel in a bag tagged &quot;to depot PE2&quot;. Every sorting center in between reads only the tag, swaps it for its neighbor&apos;s tag for the same depot, and passes the bag on. The tags were agreed in advance, neighbor by neighbor (LDP), along the roads the map already shows (IS-IS).
        </p>
        <Callout tone="cyan" title="When it breaks, ask in this order" icon="→">
          Does IP reach the loopbacks (IGP)? Is there an LDP session on every link the IGP uses? Did the next hop give a label? What does the LFIB do with it? Does the LSP work end to end (LSP ping)?
        </Callout>
      </GuideSection>

      <GuideSection id="ll-glossary" eyebrow="Reference" title="Glossary" tone="cyan">
        <Glossary
          items={[
            { term: "FEC", def: "Forwarding Equivalence Class: the packets forwarded the same way — here, everything for 4.4.4.4/32." },
            { term: "LSP", def: "Label Switched Path: the one-way path labeled packets take for a FEC." },
            { term: "LDP", def: "Label Distribution Protocol: Hellos (UDP 646) discover, a TCP 646 session between loopbacks carries label mappings." },
            { term: "LIB / LFIB", def: "Every label heard / the labels actually used for forwarding." },
            { term: "Implicit-null", def: "Label 3, advertised by the egress: “pop before you send it to me”." },
            { term: "PHP", def: "Penultimate-hop popping: the router before the egress removes the label." },
            { term: "LER / LSR", def: "Label Edge Router (push/pop at the edge) / Label Switching Router (swap in the core)." },
          ]}
        />
      </GuideSection>

      <GuideSection id="ll-recap" eyebrow="Reference" title="Recap" tone="success">
        <ChecklistCard tone="success" title="You can now" mark="✓" items={["explain why a BGP-free core needs labels", "describe LDP discovery and sessions between loopbacks", "follow labels upstream and packets downstream", "read the LIB and the LFIB", "walk push, swap and pop and explain PHP", "find why IP works but customers don't — and prove the repair"]} />
      </GuideSection>

      <GuideSection id="ll-practice" eyebrow="Next" title="Practice it" tone="violet">
        <p>The Deep Dive tab teaches MPLS and LDP in full: the shim header and label stacks, reserved labels, LDP sessions and modes, independent vs ordered control, LDP–IGP sync, MTU, LSP ping and every failure signature with real evidence. The lab lets you operate it.</p>
        <LessonLabBridge />
        <PresentationBridge>Rewatch the MPLS presentation.</PresentationBridge>
      </GuideSection>
    </div>
  );
}
