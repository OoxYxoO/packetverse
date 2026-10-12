import { Callout, ChecklistCard, CompareCards, DArrow, DIAGRAM as D, DNode, DPill, DiagramFrame, DiagramSvg, FailureSignatures, FieldTable, Glossary, GuideSection, Mono, TroubleshootingFlow } from "@/components/lesson/GuideBlocks";
import { DStack } from "@/components/lesson/MplsGuideSvg";
import { SrTopology, type SrLink } from "@/components/lesson/SrGuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { PracticeBridge } from "@/components/lesson/GuideInteractive";
import { usePracticeLabOpener } from "@/components/lesson/FundamentalsLessonShell";
import { PresentationBridge } from "@/components/presentation/LessonPresentation";
import { CliPair, CliPanel, pickLines, runGuideCli } from "@/components/lesson/GuideCli";
import type { CliVendor } from "@/lib/cli/types";
import { createSrNet, srApply, srTicket, srTicketState, type SrOs, type SrR, type SrState } from "@/lib/sim-engine/scenarios/srNet";
import { srSets, srStaticApi } from "./sr-lab/srCli";

export const SRF_LESSON_SECTIONS: LessonGuideSectionLink[] = [
  { id: "sl-mission", label: "What this lesson teaches" },
  { id: "sl-network", label: "The network of this lesson" },
  { id: "sl-ideas", label: "Three ideas you need" },
  { id: "sl-srgb", label: "An index becomes a label" },
  { id: "sl-igp", label: "The IGP carries it all" },
  { id: "sl-node", label: "Following 16006" },
  { id: "sl-metric", label: "When the IGP changes" },
  { id: "sl-adj", label: "The local Adjacency SID" },
  { id: "sl-list", label: "A segment list" },
  { id: "sl-incident", label: "The failing segment list" },
  { id: "sl-customer", label: "Why customer traffic needs it" },
  { id: "sl-working", label: "What working looks like" },
  { id: "sl-break", label: "When a router has no SR" },
  { id: "sl-other", label: "Other ways it fails" },
  { id: "sl-model", label: "Mental model" },
  { id: "sl-glossary", label: "Glossary" },
  { id: "sl-recap", label: "Recap" },
  { id: "sl-practice", label: "Practice it" },
];

/**
 * Real CLI output and test results on this page come from the SR-MPLS Lab — the same six routers, SRGB, Node SIDs and
 * Adjacency SIDs as the guided lesson.
 */
export const SR0: SrState = createSrNet(0);
export const SR0_JN: SrState = createSrNet(0, "junos");
const SR_PING = srApply(SR0, { type: "ping", from: "H1" });
const SR_STEER = srApply(SR0, { type: "probe", stack: [16003, 24035, 16006] });
const SR_BAD = srApply(SR0, { type: "probe", stack: [24035, 16006] });
const SR_METRIC = srApply(srApply(SR0, { type: "set", text: "R2–R4 metric 50", changes: [{ dev: "R2", f: (c) => void (c.ifs["ge-0/0/1"]!.metric = 50) }, { dev: "R4", f: (c) => void (c.ifs["ge-0/0/0"]!.metric = 50) }] }), { type: "ping", from: "H1" });
const fault = (os: SrOs) => srTicket("srdisabled").repro.reduce((acc, a) => srApply(acc, a), srTicketState("srdisabled", 0, os));
const SR_FAULT = fault("xr");
const SR_FAULT_JN = fault("junos");
const SR_FIXED = srApply(srApply(SR_FAULT, { type: "set", text: "R4: segment routing on", changes: [{ dev: "R4", f: (c) => void (c.sr = true) }] }), { type: "ping", from: "H1" });
export function srCli(s: SrState, r: SrR, vendor: CliVendor, command: string) {
  return runGuideCli(srSets(srStaticApi(s, r), r)[vendor], command);
}
export function srOnly(s: SrState, r: SrR, vendor: CliVendor, command: string, match: RegExp, keep = 0) {
  const x = srCli(s, r, vendor, command);
  return { ...x, output: pickLines(x.output, match, keep) };
}
/** One block of an output: from the first line matching `start`, `n` lines (or up to the next unindented line). */
export function srSection(s: SrState, r: SrR, vendor: CliVendor, command: string, start: RegExp, n?: number) {
  const x = srCli(s, r, vendor, command);
  const lines = x.output.split("\n");
  const i = lines.findIndex((l) => start.test(l));
  if (i < 0) return { ...x, output: "" };
  let j = i + 1;
  if (n) j = i + n;
  else while (j < lines.length && /^\s/.test(lines[j])) j++;
  return { ...x, output: lines.slice(i, j).join("\n") };
}
/** One test, as the lab reports it. */
export function SrResult({ s, title }: { s: SrState; title: string }) {
  const t = s.tests[s.tests.length - 1];
  const what = t.kind === "ping" ? `${t.from} → ${t.dst}` : `R1 → ${t.dst} with [${t.stack?.join(", ")}]`;
  return (
    <Callout tone={t.ok ? "success" : "danger"} title={title} icon={t.ok ? "✓" : "!"}>
      {what}: {t.ok ? `delivered, path ${t.path.join(" → ")}` : t.why}
    </Callout>
  );
}

function LessonLabBridge() {
  const openLab = usePracticeLabOpener();
  return (
    <PracticeBridge label="Open the SR-MPLS Lab" onPractice={openLab}>
      The six routers of this lesson running IS-IS with segment routing, IOS XR or Junos, your own copy. Nothing you do there changes your lesson progress.
    </PracticeBridge>
  );
}

const LINKS: SrLink[] = [
  { a: "R1", b: "R2", label: "10" },
  { a: "R2", b: "R4", label: "10" },
  { a: "R4", b: "R6", label: "10" },
  { a: "R1", b: "R3", label: "15" },
  { a: "R3", b: "R5", label: "15" },
  { a: "R5", b: "R6", label: "15" },
];

function TopologyDiagram() {
  return (
    <DiagramSvg h={220} label="R1 to R6 over a top path R2, R4 with metric 10 per link and a bottom path R3, R5 with metric 15 per link">
      <SrTopology links={LINKS.map((l) => (l.a === "R1" && l.b === "R2") || l.b === "R4" || (l.a === "R4" && l.b === "R6") ? { ...l, color: D.success, bold: true } : l)} sub={{ R1: "headend", R3: "owns 24035", R6: "destination" }} accent={{ R1: D.mpls, R6: D.mpls }} />
      <text x={320} y={214} textAnchor="middle" fill={D.muted} fontSize={10}>
        top path cost 30 (IGP shortest) · bottom path cost 45
      </text>
    </DiagramSvg>
  );
}

function SrgbDiagram() {
  const rows = [1, 2, 3, 4, 5, 6];
  return (
    <DiagramSvg h={150} label="Each router's Prefix-SID index plus the SRGB start 16000 gives its Node SID label: R1 16001 through R6 16006">
      <text x={320} y={18} textAnchor="middle" fill={D.violet} fontSize={11} fontWeight={700}>
        SRGB 16000–23999 · label = 16000 + index
      </text>
      {rows.map((i) => {
        const x = 60 + (i - 1) * 104;
        return (
          <g key={i}>
            <rect x={x - 42} y={36} width={84} height={30} rx={8} fill={D.box} stroke={D.cyan} strokeOpacity={0.7} />
            <text x={x} y={55} textAnchor="middle" fill={D.text} fontSize={11} fontWeight={700}>
              R{i} · idx {i}
            </text>
            <DArrow x1={x} y1={70} x2={x} y2={92} color={D.faint} width={1.4} />
            <rect x={x - 42} y={96} width={84} height={26} rx={6} fill={D.mpls} fillOpacity={0.14} stroke={D.mpls} strokeOpacity={0.8} />
            <text x={x} y={113} textAnchor="middle" fill={D.mpls} fontSize={11} fontWeight={700} fontFamily="monospace">
              {16000 + i}
            </text>
          </g>
        );
      })}
      <text x={320} y={142} textAnchor="middle" fill={D.muted} fontSize={10}>
        the index is what the IGP advertises; the label is what the data plane carries
      </text>
    </DiagramSvg>
  );
}

/** Hop strip: routers in a row, the packet as it leaves each hop drawn under the link it crosses. */
function HopStrip({ hops, stacks, caption, label, h = 170 }: { hops: string[]; stacks: { labels: { text: string; color?: string; tag?: string }[]; payload?: string }[]; caption: string; label: string; h?: number }) {
  const step = 540 / (hops.length - 1);
  const xs = hops.map((_, i) => 50 + i * step);
  return (
    <DiagramSvg h={h} label={label}>
      {hops.map((r, i) => (
        <g key={r}>
          <DNode x={xs[i]} y={32} label={r} w={64} h={32} accent={i === 0 || i === hops.length - 1 ? D.mpls : D.cyan} />
          {i < hops.length - 1 && <DArrow x1={xs[i] + 36} y1={32} x2={xs[i + 1] - 36} y2={32} color={D.mpls} width={1.8} />}
        </g>
      ))}
      {stacks.map((s, i) => (
        <DStack key={i} x={(xs[i] + xs[i + 1]) / 2} y={62} labels={s.labels} payload={s.payload ?? "IP"} w={96} />
      ))}
      <text x={320} y={h - 8} textAnchor="middle" fill={D.muted} fontSize={10}>
        {caption}
      </text>
    </DiagramSvg>
  );
}

function NodeSidDiagram() {
  return (
    <HopStrip
      hops={["R1", "R2", "R4", "R6"]}
      stacks={[{ labels: [{ text: "16006 S1" }] }, { labels: [{ text: "16006 S1" }] }, { labels: [], payload: "IP (after PHP)" }]}
      caption="R2 forwards 16006 unchanged; R4 is penultimate for R6 and pops it"
      label="R1 pushes 16006 toward R2, R2 forwards 16006 to R4, R4 pops it and R6 receives plain IP"
      h={150}
    />
  );
}

function WireStackDiagram() {
  const cols = [
    { x: 130, head: "R1 → R3", labels: [{ text: "24035 S0", color: D.warning, tag: "TOP" }, { text: "16006 S1", tag: "BOTTOM" }], payload: "IP" },
    { x: 330, head: "R3 → R5", labels: [{ text: "16006 S1", tag: "TOP" }], payload: "IP" },
    { x: 530, head: "R5 → R6", labels: [], payload: "IP only" },
  ];
  return (
    <DiagramSvg h={170} label="Wire stacks: R1 to R3 carries 24035 over 16006, R3 to R5 carries 16006, R5 to R6 carries plain IP">
      {cols.map((c) => (
        <g key={c.head}>
          <text x={c.x} y={20} textAnchor="middle" fill={D.text} fontSize={11.5} fontWeight={700}>
            {c.head}
          </text>
          <DStack x={c.x} y={32} labels={c.labels} payload={c.payload} w={96} />
        </g>
      ))}
      <text x={130} y={124} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        16003 done by PHP at R1
      </text>
      <text x={330} y={124} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        R3 executed its own 24035
      </text>
      <text x={530} y={124} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        16006 done by PHP at R5
      </text>
      <text x={320} y={160} textAnchor="middle" fill={D.muted} fontSize={10}>
        the logical list never changes; the wire stack only carries what the next router must read
      </text>
    </DiagramSvg>
  );
}

function FaultDiagram() {
  return (
    <DiagramSvg h={240} label="An incorrect list starting with R3's local Adj-SID is rejected at R1 because R1 does not own 24035">
      <SrTopology links={LINKS} sub={{ R1: "active: 24035", R3: "owns 24035" }} accent={{ R1: D.danger, R3: D.warning }} />
      <DPill x={320} y={222} text="R1 cannot execute a SID that only R3 owns → dropped at R1" color={D.danger} w={380} />
    </DiagramSvg>
  );
}

export function SrFoundationsLessonGuideContent() {
  return (
    <div className="space-y-12">
      <GuideSection id="sl-mission" eyebrow="This lesson" title="What this lesson teaches" tone="mpls">
        <p>
          In the LDP lesson, labels followed the IGP shortest path and nothing else. In the RSVP-TE lessons, you could steer traffic — but every engineered path was an LSP that each router along the way had to signal and remember. This lesson asks a simpler question: can the headend steer traffic with a short list of instructions written into the packet, while the core keeps <b className="text-pv-text">no state for the path at all</b>?
        </p>
        <p>That is <b className="text-pv-text">segment routing</b>. You will watch IS-IS hand out the labels, follow a Node SID through the network, move it with a metric, use an Adjacency SID to force one link, and build a segment list — then meet the mistake the guided lesson ends on, and a router that forgot segment routing.</p>
        <ChecklistCard tone="violet" title="By the end of this lesson you can" mark="→" items={["explain where SR labels come from: SRGB + index, carried by the IGP", "follow a Node SID hop by hop — swap, then PHP", "explain why a Node SID moves when a metric changes", "say where an Adjacency SID is valid, and where it isn't", "build a segment list that forces a path", "find a segment-routing fault from evidence, fix it and prove it"]} />
      </GuideSection>

      <GuideSection id="sl-network" eyebrow="This lesson" title="The network of this lesson" tone="cyan">
        <DiagramFrame caption="Numbers are IS-IS metrics. The green top path is the shortest path, cost 30; the bottom path costs 45.">
          <TopologyDiagram />
        </DiagramFrame>
        <p>R1 to R6 over two paths. Loopbacks are <Mono>10.0.0.1</Mono> … <Mono>10.0.0.6</Mono>; links are <Mono>10.1.XY.0/24</Mono> (R1–R2 is 10.1.12.0/24, R1 on .1). Host H1 (<Mono>192.168.1.10</Mono>) sits behind R1, host H6 (<Mono>192.168.6.20</Mono>) behind R6. R1 and R6 exchange those two prefixes by iBGP; R2–R5 run no BGP and no LDP at all.</p>
        <Callout tone="cyan" title="The lab uses the same network" icon="i">
          IS-IS Level 2, SRGB 16000–23999 on every router, Prefix-SID index = router number. Every output on this page comes from the SR-MPLS Lab, in IOS XR or Junos form.
        </Callout>
      </GuideSection>

      <GuideSection id="sl-ideas" eyebrow="This lesson" title="Three ideas you need" tone="violet">
        <CompareCards
          items={[
            { title: "Node SID", tone: "mpls", tag: "global", points: ["“reach this router”", "along the IGP shortest path"] },
            { title: "Adjacency SID", tone: "warning", tag: "local", points: ["“use this link”", "only at the router that owns it"] },
            { title: "Segment list", tone: "violet", tag: "the path", points: ["written once, by the headend", "executed top label first"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="sl-srgb" eyebrow="Control plane" title="An index becomes a label" tone="violet">
        <DiagramFrame caption="The index is advertised; the label is computed by each router from its SRGB.">
          <SrgbDiagram />
        </DiagramFrame>
        <p>Each router reserves a block of labels for global segments, the <b className="text-pv-text">SRGB</b> — 16000–23999 here, the IOS XR default. R6 advertises one fact about its loopback: <b className="text-pv-text">Prefix-SID index 6</b>. Every router turns that into a label with its own SRGB: 16000 + 6 = <Mono>16006</Mono>. Since every SRGB is the same, every router lands on the same number.</p>
        <CliPair cisco={srOnly(SR0, "R1", "cisco", "show isis segment-routing label table", /Label|----|^\d/)} junos={srOnly(SR0_JN, "R1", "juniper", "show route table inet.3", /inet\.3|\/32|Push|>/)} ciscoCaption="IOS XR · R1 — one label per Node SID, its own (16001) on Loopback0" junosCaption="Junos · R1 — the SR routes to every loopback, with the label R1 pushes" />
        <Callout tone="cyan" title="Index, not label" icon="i">
          If R4 used 17000–24999, its label for index 6 would be 17006 — and every neighbor sending to R4 would use 17006. Same SRGBs only make the labels easy to read.
        </Callout>
      </GuideSection>

      <GuideSection id="sl-igp" eyebrow="Control plane" title="The IGP carries it all" tone="ospf">
        <p>There is no label protocol beside the IGP. IS-IS itself (RFC 8667) carries each router&apos;s SRGB in its Router Capability TLV, the Prefix-SID index on its loopback prefix, and an Adjacency SID for each neighbor. One flooding mechanism, one database:</p>
        <CliPanel run={srSection(SR0, "R1", "cisco", "show isis database verbose", /^R6\.00-00/)} caption="IOS XR · R1 — R6's LSP: SRGB, neighbors with Adjacency SIDs, loopback with index 6" />
        <p>Each router then programs its own label table from its own shortest paths. Nothing is negotiated with neighbors, nothing is signaled per path.</p>
      </GuideSection>

      <GuideSection id="sl-node" eyebrow="Data plane" title="Following 16006" tone="mpls">
        <DiagramFrame caption="The packet as it leaves each router.">
          <NodeSidDiagram />
        </DiagramFrame>
        <p>R1 pushes <Mono>16006</Mono> and sends it to R2 — its shortest path to R6. R2 looks up 16006: next hop R4, whose label for index 6 is also 16006, so R2 swaps 16006 → 16006. R4&apos;s next hop is R6, the owner: R4 pops the label (penultimate-hop popping), and R6 receives plain IP.</p>
        <CliPair cisco={srOnly(SR0, "R2", "cisco", "show mpls forwarding", /Local|Label  |----|^16006|^16004/)} junos={srSection(SR0_JN, "R4", "juniper", "show route table mpls.0", /^16006 /, 2)} ciscoCaption="IOS XR · R2 — 16006 swapped to 16006 toward R4; 16004 popped (R4 is the owner)" junosCaption="Junos · R4 — 16006: Pop toward R6" />
        <CliPanel run={srCli(SR0, "R1", "cisco", "traceroute sr-mpls 10.0.0.6/32")} caption="IOS XR · R1 — the labeled path, hop by hop" />
      </GuideSection>

      <GuideSection id="sl-metric" eyebrow="Data plane" title="When the IGP changes" tone="warning">
        <p>The guided lesson raises the R2–R4 metric from 10 to 50. The top path now costs 70, the bottom 45. Every router reruns SPF — and nothing else happens. R1 still pushes <Mono>16006</Mono>, but now sends it to R3; R3 and R5 do the swapping, R5 is now the penultimate hop.</p>
        <SrResult s={SR_PING} title="The lab: H1 → H6 with the original metrics" />
        <SrResult s={SR_METRIC} title="The lab: the same ping after R2–R4 goes to 50" />
        <p>A Node SID promises a destination, not a path: <b className="text-pv-text">the IGP decides the path</b>. That is a feature — no re-signaling after a failure — and a limit: to force a path, you need more than Node SIDs.</p>
      </GuideSection>

      <GuideSection id="sl-adj" eyebrow="Control plane" title="The local Adjacency SID" tone="violet">
        <FieldTable
          title="The segments this lesson uses"
          accent="violet"
          columns={["SID", "Type", "Owner · scope", "Meaning"]}
          rows={[
            [<Mono key="a">16003</Mono>, "Node (Prefix-SID)", "R3 · global", "reach R3 by the shortest path"],
            [<Mono key="b">16006</Mono>, "Node (Prefix-SID)", "R6 · global", "reach R6 by the shortest path"],
            [<Mono key="c">24035</Mono>, "Adjacency SID", "R3 · local", "at R3: pop, out of the R3→R5 link"],
          ]}
        />
        <p>Each router allocates one label per IS-IS adjacency. R3&apos;s label for its link to R5 is <Mono>24035</Mono> (in the lab, Junos numbers it 299811). Only R3 programs it:</p>
        <CliPair cisco={srOnly(SR0, "R3", "cisco", "show isis adjacency detail", /^R5|Adjacency SID|^R1/)} junos={srOnly(SR0, "R1", "cisco", "show mpls forwarding", /Local|Label  |----|SR Adj/)} ciscoCaption="IOS XR · R3 — Adjacency SID 24035 toward R5" junosCaption="IOS XR · R1 — R1's own Adjacency SIDs: 24012 and 24013, no 24035" />
      </GuideSection>

      <GuideSection id="sl-list" eyebrow="Data plane" title="A segment list" tone="mpls">
        <DiagramFrame caption="The wire stack on each link of the steered path.">
          <WireStackDiagram />
        </DiagramFrame>
        <p>To force the bottom path, R1 sends <Mono>[16003, 24035, 16006]</Mono>: reach R3, take R3&apos;s link to R5, reach R6. R1 executes the first segment itself — R3 is its neighbor, so 16003 is popped right away and the packet leaves with <Mono>24035 | 16006</Mono>. R3 executes its own Adjacency SID, R5 pops 16006 for R6.</p>
        <SrResult s={SR_STEER} title="The lab: R1 sends [16003, 24035, 16006]" />
        <p>R3 and R5 didn&apos;t learn about this path, store it or refresh it. That is the whole point: <b className="text-pv-text">the path lives in the packet</b>.</p>
      </GuideSection>

      <GuideSection id="sl-incident" eyebrow="Incident" title="The failing segment list" tone="danger">
        <DiagramFrame caption="R1 is asked to execute a segment it doesn't own.">
          <FaultDiagram />
        </DiagramFrame>
        <p>The guided lesson&apos;s engineer wants the R3→R5 link and writes <Mono>[24035, 16006]</Mono>. Traffic dies at R1.</p>
        <SrResult s={SR_BAD} title="The lab: R1 sends [24035, 16006]" />
        <TroubleshootingFlow
          steps={[
            { question: "Where does the packet stop?", look: "At R1, before it leaves." },
            { question: "What is R1 asked to execute?", look: "The top label: 24035." },
            { question: "Does R1 have 24035?", look: "No — R1's Adjacency SIDs are 24012 and 24013. 24035 is R3's." },
            { question: "What is missing?", look: "A segment that brings the packet to R3 first." },
          ]}
        />
        <ChecklistCard tone="success" title="The repair" mark="✓" items={["put R3's Node SID in front: [16003, 24035, 16006]", "R1 executes 16003, R3 executes 24035, R5 executes 16006", "a fresh test arrives via R3 and R5"]} />
      </GuideSection>

      <GuideSection id="sl-customer" eyebrow="Data plane" title="Why customer traffic needs it" tone="mpls">
        <p>H1&apos;s packets for <Mono>192.168.6.20</Mono> don&apos;t use a segment list — they use R6&apos;s Node SID. R1 knows 192.168.6.0/24 by iBGP, next hop 10.0.0.6, and resolves that next hop over the SR label. The core routers don&apos;t know 192.168.6.0/24 at all: a packet that reaches them unlabeled is dropped.</p>
        <CliPair cisco={srOnly(SR0, "R1", "cisco", "show cef 192.168.6.0/24", /^192|via 10\.0\.0\.6|labels imposed/)} junos={srOnly(SR0_JN, "R1", "juniper", "show route 192.168.6.20", /^192|Push|BGP/)} ciscoCaption="IOS XR · R1 — via 10.0.0.6, labels imposed {16006}" junosCaption="Junos · R1 — BGP route, Push 16006" />
      </GuideSection>

      <GuideSection id="sl-working" eyebrow="Evidence" title="What working looks like" tone="success">
        <FieldTable
          title="Healthy, in five questions"
          accent="success"
          columns={["Question", "IOS XR", "Junos", "Healthy answer"]}
          rows={[
            ["Is IS-IS up, which path is shortest?", <Mono key="1">show isis adjacency</Mono>, <Mono key="2">show isis adjacency</Mono>, "two adjacencies per router; R1→R6 via R2, R4"],
            ["Is every router SR-capable?", <Mono key="3">show isis database verbose</Mono>, <Mono key="4">show isis database extensive</Mono>, "SRGB 16000–23999 in every LSP"],
            ["Does every loopback have its own index?", <Mono key="5">show isis segment-routing label table</Mono>, <Mono key="6">show route table inet.3</Mono>, "16001–16006, one each"],
            ["Is 16006 programmed hop by hop?", <Mono key="7">show mpls forwarding</Mono>, <Mono key="8">show route table mpls.0</Mono>, "swap on R2, pop on R4"],
            ["Does R1 push it for the customer?", <Mono key="9">show cef 192.168.6.0/24</Mono>, <Mono key="10">show route 192.168.6.20</Mono>, "labels imposed / Push 16006"],
          ]}
        />
      </GuideSection>

      <GuideSection id="sl-break" eyebrow="Incident" title="When a router has no SR" tone="danger">
        <p>R4 was rebuilt from a backup. Its IS-IS adjacencies are up and every loopback is in every routing table — but H1 can&apos;t reach H6.</p>
        <SrResult s={SR_FAULT} title="The lab: H1 pings H6" />
        <TroubleshootingFlow
          steps={[
            { question: "Is IS-IS up?", look: "Yes: every adjacency, every loopback route." },
            { question: "Is every router SR-capable?", look: "No: R4's LSP has no SRGB." },
            { question: "What does R2 do with 16006?", look: "IOS XR: Unlabelled toward R4. Junos: no entry at all." },
            { question: "Why does that kill the packet?", look: "R4 receives plain IP for 192.168.6.20 and runs no BGP." },
          ]}
        />
        <CliPair cisco={srOnly(SR_FAULT, "R2", "cisco", "show mpls forwarding", /Local|Label  |----|^16006|^16004/)} junos={srOnly(SR_FAULT_JN, "R2", "juniper", "show route table mpls.0", /mpls\.0|^16\d+/)} ciscoCaption="IOS XR · R2 — 16006 Unlabelled toward R4" junosCaption="Junos · R2 — no entry for 16006" />
        <CliPair cisco={{ prompt: "RP/0/RP0/CPU0:R4(config)#", command: "router isis CORE", output: "RP/0/RP0/CPU0:R4(config-isis)#address-family ipv4 unicast\nRP/0/RP0/CPU0:R4(config-isis-af)#segment-routing mpls\nRP/0/RP0/CPU0:R4(config-isis-af)#commit" }} junos={{ prompt: "admin@R4# ", command: "set protocols isis source-packet-routing srgb start-label 16000 index-range 8000", output: "\n[edit]\nadmin@R4# set protocols isis source-packet-routing node-segment ipv4-index 4\n\n[edit]\nadmin@R4# commit and-quit\ncommit complete\nExiting configuration mode" }} ciscoCaption="IOS XR · R4" junosCaption="Junos · R4" />
        <SrResult s={SR_FIXED} title="The lab: a fresh ping after the fix" />
      </GuideSection>

      <GuideSection id="sl-other" eyebrow="Beyond this incident" title="Other ways it fails" tone="warning">
        <FailureSignatures
          items={[
            { tag: "SRGB", title: "SRGB too small", tone: "danger", points: ["indexes beyond the range", "no label for them on that router"] },
            { tag: "SID", title: "No Prefix-SID", tone: "danger", points: ["IS-IS route, no label", "customer traffic unlabeled"] },
            { tag: "DUP", title: "Duplicate index", tone: "violet", points: ["conflict in the database", "the lower prefix keeps it"] },
            { tag: "IGP", title: "Wrong metric", tone: "warning", points: ["everything works", "the Node SID takes the long way"] },
          ]}
        />
        <p className="text-sm text-pv-text-muted">Each is a ticket in the SR-MPLS Lab, together with this incident.</p>
      </GuideSection>

      <GuideSection id="sl-model" eyebrow="Mental model" title="Mental model" tone="cyan">
        <p>
          Think of the network as a city where every crossroads has the same street map (the IGP). Each landmark has a number everyone agrees on — R6&apos;s is 6 — and every driver turns a landmark number into a route by reading their own map: that is a Node SID. Each crossroads also has numbered exits that only make sense standing at that crossroads — &quot;take exit 35 here&quot; — those are Adjacency SIDs. A traveller (the packet) carries a little card of instructions written by the first driver: &quot;go to landmark 3, take exit 35, then go to landmark 6&quot;. Each driver along the way reads only the top line, does it, and tears it off. No driver needs to remember the traveller. And if the first line says &quot;take exit 35&quot; while you&apos;re still standing at the first crossroads — there is no exit 35 here.
        </p>
        <Callout tone="cyan" title="When it breaks, ask in this order" icon="→">
          Where does the packet stop? Is IS-IS up, and which path is shortest? Is every router SR-capable, with an SRGB that fits? Does every loopback have its own index? Is the label programmed hop by hop? Does the headend push it?
        </Callout>
      </GuideSection>

      <GuideSection id="sl-glossary" eyebrow="Reference" title="Glossary" tone="cyan">
        <Glossary
          items={[
            { term: "Segment", def: "One instruction in a packet; in SR-MPLS, one MPLS label." },
            { term: "SID", def: "Segment identifier: the number that names a segment." },
            { term: "SRGB", def: "Segment Routing Global Block: the label range a router reserves for global segments." },
            { term: "Prefix-SID", def: "A global segment attached to a prefix, advertised as an index into the SRGB." },
            { term: "Node SID", def: "The Prefix-SID of a router's loopback: reach that router by the shortest path." },
            { term: "Adjacency SID", def: "A local segment: at its owner, pop and send out of one specific link." },
            { term: "Segment list", def: "The ordered segments the headend imposes; the top label is the active segment." },
            { term: "PHP", def: "Penultimate-hop popping: the hop before the owner removes the Node SID." },
          ]}
        />
      </GuideSection>

      <GuideSection id="sl-recap" eyebrow="Reference" title="Recap" tone="success">
        <ChecklistCard tone="success" title="You can now" mark="✓" items={["derive a Node SID label from SRGB and index", "follow 16006 hop by hop and say who pops it", "explain why a metric change moves a Node SID", "say where an Adjacency SID is valid", "build and repair a segment list", "find, fix and prove a router without segment routing"]} />
      </GuideSection>

      <GuideSection id="sl-practice" eyebrow="Next" title="Practice it" tone="violet">
        <p>The Deep Dive tab covers SR-MPLS in full: the architecture, SID types, SRGB and SRLB, the IS-IS extensions, ECMP, conflicts, PHP and explicit-null, configuration on IOS XR and Junos, verification and every failure signature with real evidence. The lab lets you operate it.</p>
        <LessonLabBridge />
        <PresentationBridge>Rewatch the SR-MPLS presentation.</PresentationBridge>
      </GuideSection>
    </div>
  );
}
