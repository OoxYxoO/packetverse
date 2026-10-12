import { Callout, ChecklistCard, CompareCards, DArrow, DIAGRAM as D, DNode, DiagramFrame, DiagramSvg, FailureSignatures, FieldTable, Glossary, GuideSection, Mono, TroubleshootingFlow } from "@/components/lesson/GuideBlocks";
import { SrTopology, type SrLink } from "@/components/lesson/SrGuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { PracticeBridge } from "@/components/lesson/GuideInteractive";
import { usePracticeLabOpener } from "@/components/lesson/FundamentalsLessonShell";
import { PresentationBridge } from "@/components/presentation/LessonPresentation";
import { CliPanel, pickLines, runGuideCli } from "@/components/lesson/GuideCli";
import { createFaNet, faApply, faTicket, faTicketState, type FaAction, type FaR, type FaRtr, type FaState } from "@/lib/sim-engine/scenarios/faNet";
import { faSets, faStaticApi } from "./fa-lab/faCli";

export const FLEX_LESSON_SECTIONS: LessonGuideSectionLink[] = [
  { id: "fl-mission", label: "What this lesson teaches" },
  { id: "fl-network", label: "The network of this lesson" },
  { id: "fl-ideas", label: "Three ideas you need" },
  { id: "fl-algo0", label: "Algorithm 0" },
  { id: "fl-fad", label: "The Flex-Algo Definition" },
  { id: "fl-spf", label: "The algorithm-128 topology" },
  { id: "fl-part", label: "Participation" },
  { id: "fl-sid", label: "Algorithm-specific SIDs" },
  { id: "fl-steer", label: "Steering the app" },
  { id: "fl-compare", label: "Same destination, two paths" },
  { id: "fl-definition", label: "A definition, not a path" },
  { id: "fl-election", label: "Who decides the definition" },
  { id: "fl-incident", label: "The algorithm-128 incident" },
  { id: "fl-working", label: "What working looks like" },
  { id: "fl-other", label: "Other ways it fails" },
  { id: "fl-model", label: "Mental model" },
  { id: "fl-glossary", label: "Glossary" },
  { id: "fl-recap", label: "Recap" },
  { id: "fl-practice", label: "Practice it" },
];

/** Real IOS XR output and test results on this page come from the SR Flex-Algo Lab — the guided lesson's network. */
const F0: FaState = createFaNet(0);
const run = (s: FaState, ...a: FaAction[]) => a.reduce((acc, x) => faApply(acc, x), s);
const set = (text: string, changes: { dev: FaR; f: (c: FaRtr) => void }[]): FaAction => ({ type: "set", text, changes });
const H6 = run(F0, { type: "ping", to: "H6" });
const H66 = run(F0, { type: "ping", to: "H66" });
const DETOUR = run(F0, set("detour", [{ dev: "R1", f: (c) => void (c.fa[128].excl = []) }, { dev: "R3", f: (c) => void (c.ifs["ge-0/0/1"]!.delay = 80000) }, { dev: "R5", f: (c) => void (c.ifs["ge-0/0/0"]!.delay = 80000) }]), { type: "ping", to: "H66" });
const CONFLICT = run(F0, set("R6 FAD", [{ dev: "R6", f: (c) => void (c.fa[128] = { prio: 200, mt: "igp", excl: [], incl: [], adv: true }) }]), { type: "ping", to: "H66" });
const INC = faTicket("participation").repro.reduce((acc, a) => faApply(acc, a), faTicketState("participation", 0));
const INC_FIX = run(INC, set("R3: flex-algo 128", [{ dev: "R3", f: (c) => void (c.fa[128] = { prio: 128, mt: "igp", excl: [], incl: [], adv: false }) }]), { type: "ping", to: "H66" });
export function faCli(s: FaState, r: FaR, command: string) {
  return runGuideCli(faSets(faStaticApi(s, r), r).cisco, command);
}
export function faOnly(s: FaState, r: FaR, command: string, match: RegExp, keep = 0) {
  const x = faCli(s, r, command);
  return { ...x, output: pickLines(x.output, match, keep) };
}
/** A block of an output: from the first line matching `start` up to the next line matching `stop`. */
export function faBlock(s: FaState, r: FaR, command: string, start: RegExp, stop: RegExp) {
  const x = faCli(s, r, command);
  const lines = x.output.split(NL);
  const i = lines.findIndex((l) => start.test(l));
  const j = lines.findIndex((l, k) => k > i && stop.test(l));
  return { ...x, output: lines.slice(i, j < 0 ? undefined : j).join(NL) };
}
const NL = String.fromCharCode(10);
/** One test, as the lab reports it. */
export function FaResult({ s, title }: { s: FaState; title: string }) {
  const t = s.tests[s.tests.length - 1];
  return (
    <Callout tone={t.ok && (t.dst !== "192.168.66.20" || t.ms <= 15) ? "success" : t.ok ? "warning" : "danger"} title={title} icon={t.ok ? "✓" : "!"}>
      {t.kind === "ping" ? `H1 → ${t.dst}` : `R1 → 10.0.0.6 with [${t.stack.join(", ")}]`}: {t.ok ? `delivered via ${t.path.join(" → ")} — pushed [${t.stack.join(", ")}] (${t.via}), ${t.ms} ms one way` : t.why}
    </Callout>
  );
}

function LessonLabBridge() {
  const openLab = usePracticeLabOpener();
  return (
    <PracticeBridge label="Open the SR Flex-Algo Lab" onPractice={openLab}>
      The network of this lesson on IOS XR: Flex-Algo 128, the low-latency app and its latency, delays and affinities you can change, your own copy. Nothing you do there changes your lesson progress.
    </PracticeBridge>
  );
}


const BLUE = "#60a5fa";
const GOLD = D.warning;

/** Link attributes as the scenario defines them: IGP metric, delay metric, affinity. */
const ATTRS: (SrLink & { igp: number; delay: number; affinity?: "BLUE" | "GOLD" })[] = [
  { a: "R1", b: "R2", igp: 10, delay: 30, affinity: "BLUE" },
  { a: "R2", b: "R4", igp: 10, delay: 30, affinity: "BLUE" },
  { a: "R4", b: "R6", igp: 10, delay: 30, affinity: "BLUE" },
  { a: "R1", b: "R3", igp: 20, delay: 5, affinity: "GOLD" },
  { a: "R3", b: "R5", igp: 20, delay: 5, affinity: "GOLD" },
  { a: "R5", b: "R6", igp: 20, delay: 5, affinity: "GOLD" },
  { a: "R3", b: "R4", igp: 5, delay: 3 },
];

function TopologyDiagram() {
  return (
    <DiagramSvg h={240} label="Top links are BLUE with IGP 10 and delay 30; bottom links are GOLD with IGP 20 and delay 5; the R3-R4 cross-link has IGP 5, delay 3 and no affinity">
      <SrTopology
        links={ATTRS.map((l) => ({ a: l.a, b: l.b, label: `${l.igp} / d${l.delay}`, color: l.affinity === "BLUE" ? BLUE : l.affinity === "GOLD" ? GOLD : D.line }))}
        sub={{ R1: "headend", R6: "destination" }}
        accent={{ R1: D.mpls, R6: D.mpls }}
      />
      <text x={320} y={228} textAnchor="middle" fill={D.muted} fontSize={10}>
        labels are IGP / delay · blue = BLUE affinity · amber = GOLD · grey = no affinity
      </text>
    </DiagramSvg>
  );
}

function PathDiagram({ algo }: { algo: 0 | 128 }) {
  const onPath = algo === 0 ? new Set(["R1-R2", "R2-R4", "R4-R6"]) : new Set(["R1-R3", "R3-R5", "R5-R6"]);
  return (
    <DiagramSvg h={240} label={algo === 0 ? "Algorithm 0 uses IGP metric over all links: R1 R2 R4 R6, total 30" : "Algorithm 128 uses delay and excludes BLUE links: R1 R3 R5 R6, total delay 15"}>
      <SrTopology
        links={ATTRS.map((l) => {
          const id = `${l.a}-${l.b}`;
          const excluded = algo === 128 && l.affinity === "BLUE";
          const label = algo === 0 ? `${l.igp}` : excluded ? "excluded" : `d${l.delay}`;
          return { a: l.a, b: l.b, label, dashed: excluded, color: onPath.has(id) ? (algo === 0 ? D.success : D.violet) : excluded ? D.danger : D.line, bold: onPath.has(id) };
        })}
        sub={{ R1: algo === 0 ? "push 16006" : "push 16106", R6: "destination" }}
        accent={{ R1: D.mpls, R6: D.mpls }}
      />
      <text x={320} y={228} textAnchor="middle" fill={algo === 0 ? D.success : D.violet} fontSize={10.5} fontWeight={700}>
        {algo === 0 ? "ALGORITHM 0 · IGP metric · R1 → R2 → R4 → R6 · total 30" : "ALGORITHM 128 · delay, exclude BLUE · R1 → R3 → R5 → R6 · total delay 15"}
      </text>
    </DiagramSvg>
  );
}

function SidDiagram() {
  return (
    <DiagramSvg h={170} label="R6's prefix 10.0.0.6/32 has two Prefix-SIDs: 16006 for Algorithm 0 with next hop R2 at R1, and 16106 for Algorithm 128 with next hop R3">
      <DNode x={110} y={85} label="10.0.0.6/32" sub="R6's prefix" accent={D.mpls} w={140} />
      <DArrow x1={182} y1={72} x2={318} y2={42} color={D.success} />
      <DArrow x1={182} y1={98} x2={318} y2={128} color={D.violet} />
      <DNode x={420} y={42} label="16006" sub="Algo 0 · index 6" accent={D.success} w={150} />
      <DNode x={420} y={128} label="16106" sub="Algo 128 · index 106" accent={D.violet} w={150} />
      <text x={505} y={46} fill={D.muted} fontSize={10}>
        R1 → R2
      </text>
      <text x={505} y={132} fill={D.muted} fontSize={10}>
        R1 → R3
      </text>
    </DiagramSvg>
  );
}


export function FlexAlgoLessonGuideContent() {
  return (
    <div className="space-y-12">
      <GuideSection id="fl-mission" eyebrow="This lesson" title="What this lesson teaches" tone="mpls">
        <p>
          So far every prefix SID has meant the same thing: &quot;shortest path by the IGP metric&quot;. When some traffic needs a different notion of &quot;best&quot; — lowest delay, or avoiding certain links — you could write an explicit path on the headend, as in the SR Policy lesson. This lesson takes the other road: let the IGP itself compute a <b className="text-pv-text">second topology</b>, with its own rules and its own labels. That is <b className="text-pv-text">Flexible Algorithm</b>.
        </p>
        <p>You will see one low-latency application ride Flex-Algo 128 at 15 ms while everything else stays on the 90 ms default path, change the network and watch the same label find a new path, see a stray definition take over — and end with an incident where one router quietly left the algorithm.</p>
        <ChecklistCard tone="violet" title="By the end of this lesson you can" mark="→" items={["say what algorithm 0 is, and what a Flex-Algo adds", "read a Flex-Algo Definition: metric type, affinity rules, priority", "build an algorithm's topology from participation and link attributes", "explain algorithm-specific prefix SIDs and how traffic is steered onto one", "predict how link changes and competing definitions move the path", "find a Flex-Algo fault from evidence, fix it and prove it"]} />
      </GuideSection>

      <GuideSection id="fl-network" eyebrow="This lesson" title="The network of this lesson" tone="cyan">
        <DiagramFrame caption="IGP metric · delay · affinity per link.">
          <TopologyDiagram />
        </DiagramFrame>
        <p>The SR-MPLS lesson&apos;s six routers plus a cross-link R3–R4. The top links (R1–R2, R2–R4, R4–R6) are cheap for the IGP (metric 10) but run over a long-haul route: <b className="text-pv-text">30 ms</b> each, tagged <b className="text-pv-text">BLUE</b>. The bottom links cost 20 but take <b className="text-pv-text">5 ms</b>, tagged <b className="text-pv-text">GOLD</b>. R3–R4 costs 5, takes 3 ms and has no tag. Behind R6: H6 (<Mono>192.168.6.20</Mono>, ordinary traffic) and H66 (<Mono>192.168.66.20</Mono>, a low-latency application).</p>
        <Callout tone="cyan" title="IOS XR in the lab" icon="i">
          The SR Flex-Algo Lab runs IOS XR on every router: <Mono>router isis CORE flex-algo 128</Mono>, link affinities, delay from <Mono>performance-measurement</Mono>, and policy LOW-LATENCY on R1. Junos implements the same RFC 9350 ideas (<Mono>routing-options flex-algorithm</Mono>); this lesson shows IOS XR only.
        </Callout>
      </GuideSection>

      <GuideSection id="fl-ideas" eyebrow="This lesson" title="Three ideas you need" tone="violet">
        <CompareCards
          items={[
            { title: "Definition", tone: "violet", tag: "the rule", points: ["metric type + affinity rules", "advertised in IS-IS"] },
            { title: "Participation", tone: "mpls", tag: "who computes", points: ["routers with flex-algo 128", "everyone else is cut out"] },
            { title: "Algorithm SID", tone: "warning", tag: "how traffic picks it", points: ["one prefix SID per algorithm", "16106 = R6 via algorithm 128"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="fl-algo0" eyebrow="The starting point" title="Algorithm 0" tone="success">
        <DiagramFrame caption="Algorithm 0: IGP metric, every link.">
          <PathDiagram algo={0} />
        </DiagramFrame>
        <p>Algorithm 0 is what IS-IS always does: SPF on the IGP metric over every link. To R6 that is R1 → R2 → R4 → R6, cost 30 — and 90 ms. R1 pushes R6&apos;s Node SID <Mono>16006</Mono> for H6&apos;s traffic.</p>
        <FaResult s={H6} title="The lab: H1 → H6 (ordinary traffic)" />
        <p>Delay is advertised by every router, but algorithm 0 never looks at it. Lowering the bottom metrics would move <i>all</i> traffic, not just the application that needs it.</p>
      </GuideSection>

      <GuideSection id="fl-fad" eyebrow="The definition" title="The Flex-Algo Definition" tone="violet">
        <p>R1 advertises a <b className="text-pv-text">Flex-Algo Definition</b> (FAD) for algorithm 128 in its IS-IS LSP: <b className="text-pv-text">metric-type delay</b> (minimize the advertised link delay), <b className="text-pv-text">affinity exclude-any BLUE</b> (don&apos;t use BLUE links at all), priority 100. Every router reads it and agrees on what &quot;128&quot; means.</p>
        <CliPanel run={faOnly(F0, "R1", "show running-config router isis", /^router isis|flex-algo 128|priority|metric-type|advertise-definition|affinity exclude|affinity-map/)} caption="IOS XR · R1 — the definition it advertises" />
        <CliPanel run={faCli(F0, "R2", "show isis flex-algo 128")} caption="IOS XR · R2 — the definition it uses: source R1, delay, exclude bit 0 (BLUE)" />
      </GuideSection>

      <GuideSection id="fl-spf" eyebrow="Computing it" title="The algorithm-128 topology" tone="mpls">
        <DiagramFrame caption="Algorithm 128: BLUE links removed, delay summed.">
          <PathDiagram algo={128} />
        </DiagramFrame>
        <p>Remove the BLUE links and what is left is R1–R3, R3–R5, R5–R6 and R3–R4. Sum the delay: R1 → R3 → R5 → R6 is 15 ms. The cross-link doesn&apos;t help — from R4 the only way to R6 is BLUE. Metric type decides cost; affinity decides <i>whether a link exists</i> for this algorithm.</p>
        <Callout tone="warning" title="Delay must be advertised" icon="!">
          A delay-based algorithm can only use links whose delay is advertised. On IOS XR that comes from <Mono>performance-measurement</Mono> (here a static <Mono>advertise-delay</Mono> in microseconds). A link without it is left out.
        </Callout>
      </GuideSection>

      <GuideSection id="fl-part" eyebrow="Computing it" title="Participation" tone="warning">
        <p>A router takes part in algorithm 128 by configuring <Mono>flex-algo 128</Mono> under IS-IS; it then advertises algorithm 128 in its SR capabilities. Every participant runs the algorithm itself — it is a distributed SPF, not a headend calculation — and any router that doesn&apos;t participate is removed from the algorithm&apos;s topology together with its links.</p>
        <p>R2 participates, but every one of its links is BLUE: in algorithm 128 it has no neighbors and installs no algorithm-128 label for R6. That is correct, and harmless — no algorithm-128 traffic is sent to R2.</p>
      </GuideSection>

      <GuideSection id="fl-sid" eyebrow="Labels" title="Algorithm-specific SIDs" tone="violet">
        <DiagramFrame caption="One prefix, one SID per algorithm.">
          <SidDiagram />
        </DiagramFrame>
        <p>R6&apos;s loopback carries two prefix SIDs: index 6 for algorithm 0 and index 106 for algorithm 128 (<Mono>prefix-sid algorithm 128 index 106</Mono>). With SRGB 16000 they are <Mono>16006</Mono> and <Mono>16106</Mono>. Each router installs each label along that algorithm&apos;s tree.</p>
        <CliPanel run={faOnly(F0, "R1", "show mpls forwarding", /Local|Label  |----|^1600[46]|^1610[46]/)} caption="IOS XR · R1 — 16006 toward R2 (algorithm 0), 16106 toward R3 (algorithm 128)" />
      </GuideSection>

      <GuideSection id="fl-steer" eyebrow="Steering" title="Steering the app" tone="cyan">
        <p>Something has to put H66&apos;s traffic onto 16106. R6 exports 192.168.66.0/24 with BGP color <b className="text-pv-text">128</b>; R1 has SR policy LOW-LATENCY (color 128, end-point R6) whose dynamic path carries the constraint <Mono>segments sid-algorithm 128</Mono>. It resolves to one label — R6&apos;s algorithm-128 prefix SID — and the colored route is steered into it.</p>
        <CliPanel run={faOnly(F0, "R1", "show segment-routing traffic-eng policy", /Color:|Operational|Dynamic|Metric Type|SID Algorithm|16106/)} caption="IOS XR · R1 — LOW-LATENCY up, SID algorithm 128, [16106]" />
      </GuideSection>

      <GuideSection id="fl-compare" eyebrow="Labels" title="Same destination, two paths" tone="success">
        <FaResult s={H66} title="The lab: H1 → H66 (low-latency app)" />
        <p>R1 pushes 16106 toward R3; R3 swaps it toward R5 on its own algorithm-128 tree; R5 pops it. One label, no per-flow state in the core, 15 ms. H6 still takes the top at 90 ms.</p>
      </GuideSection>

      <GuideSection id="fl-definition" eyebrow="Behavior" title="A definition, not a path" tone="mpls">
        <p>Algorithm 128 names a rule. Lift the BLUE exclusion and let R3–R5 advertise 80 ms (say the transport network rerouted that wavelength): every participant recomputes. Now R1 → R3 → R4 → R6 is best at 5 + 3 + 30 = 38 ms. The label stays 16106; R1&apos;s configuration is untouched.</p>
        <FaResult s={DETOUR} title="The lab: H1 → H66 after the change" />
      </GuideSection>

      <GuideSection id="fl-election" eyebrow="Behavior" title="Who decides the definition" tone="warning">
        <p>Any router may advertise a definition. Everyone must use the same one, so IS-IS picks the advertised definition with the <b className="text-pv-text">highest priority</b>, then the highest system-id. If R6 advertises a test definition — priority 200, IGP metric, no exclusion — it wins, and algorithm 128 becomes &quot;IGP over every link&quot;: the top path. The policy stays up, 16106 is pushed, and the app gets 90 ms.</p>
        <FaResult s={CONFLICT} title="The lab: R6's definition wins" />
        <CliPanel run={faOnly(CONFLICT, "R1", "show isis flex-algo 128", /Definition|Local Priority/)} caption="IOS XR · R1 — source R6.00, priority 200, IGP, not equal to local" />
      </GuideSection>

      <GuideSection id="fl-incident" eyebrow="Incident" title="The algorithm-128 incident" tone="danger">
        <p>The guided lesson&apos;s incident: default traffic is fine, IS-IS is healthy, but the low-latency traffic no longer follows the low-delay path. R3 had a software upgrade overnight.</p>
        <FaResult s={INC} title="The lab: H1 → H66 (the ticket)" />
        <TroubleshootingFlow
          steps={[
            { question: "Which label does the app get?", look: "16006 — the algorithm-0 SID. The policy is down." },
            { question: "Why is the policy down?", look: "No algorithm-128 path from R1 to R6." },
            { question: "Which definition is in use?", look: "R1's — unchanged." },
            { question: "Who participates?", look: "Everyone but R3. And every non-BLUE way to R6 crosses R3." },
          ]}
        />
        <CliPanel run={faOnly(INC, "R1", "show segment-routing traffic-eng policy", /Operational|Dynamic|Reason/)} caption="IOS XR · R1 — LOW-LATENCY down: no path to R6 in algorithm 128's topology" />
        <CliPanel run={{ prompt: "RP/0/RP0/CPU0:R3(config)#", command: "router isis CORE", output: "RP/0/RP0/CPU0:R3(config-isis)#flex-algo 128\nRP/0/RP0/CPU0:R3(config-isis-flex-algo)#commit" }} caption="IOS XR · R3 — the repair" />
        <FaResult s={INC_FIX} title="The lab: a fresh ping after the fix" />
        <ChecklistCard tone="success" title="Proved, not assumed" mark="✓" items={["R3 participates again (show isis flex-algo 128 on R3)", "policy LOW-LATENCY is up with [16106]", "the app is back on R1 → R3 → R5 → R6 at 15 ms"]} />
      </GuideSection>

      <GuideSection id="fl-working" eyebrow="Evidence" title="What working looks like" tone="success">
        <FieldTable
          title="Healthy, in five questions (IOS XR)"
          accent="success"
          columns={["Question", "Command", "Healthy answer"]}
          rows={[
            ["Which definition won?", <Mono key="1">show isis flex-algo 128</Mono>, "source R1.00 · delay · exclude bit 0"],
            ["Who participates, with which SIDs?", <Mono key="2">show isis database verbose</Mono>, "Algorithm: 128 in every LSP · R6 index 106"],
            ["Does R1 have the label?", <Mono key="3">show mpls forwarding labels 16106</Mono>, "16106 toward R3"],
            ["Is the app steered?", <Mono key="4">show segment-routing traffic-eng policy</Mono>, "up · [16106]"],
            ["Does it work?", "a ping to 192.168.66.20", "R1 → R3 → R5 → R6, 15 ms"],
          ]}
        />
      </GuideSection>

      <GuideSection id="fl-other" eyebrow="Beyond this incident" title="Other ways it fails" tone="warning">
        <FailureSignatures
          items={[
            { tag: "FAD", title: "No definition advertised", tone: "danger", points: ["Definition: none received", "policy down, 90 ms"] },
            { tag: "PRIO", title: "Another definition wins", tone: "warning", points: ["policy up, 16106", "but the top path, 90 ms"] },
            { tag: "SID", title: "No algorithm SID on R6", tone: "violet", points: ["no 16106 anywhere", "policy down"] },
            { tag: "AFF", title: "Excluded affinity on the path", tone: "danger", points: ["link left out of 128", "policy down"] },
          ]}
        />
        <p className="text-sm text-pv-text-muted">Each is a ticket in the SR Flex-Algo Lab, together with this incident.</p>
      </GuideSection>

      <GuideSection id="fl-model" eyebrow="Mental model" title="Mental model" tone="cyan">
        <p>
          Picture a city with one road map but several route planners. The ordinary planner (algorithm 0) finds the shortest drive for everyone. A second planner is published on the town notice board (the definition): &quot;fastest time, no toll roads&quot;. Every taxi company that signs up (participation) runs that planner itself on the same map and gets the same answers. Parcels get a sticker naming the planner and the destination (the algorithm SID), and every depot routes them by that planner. Change a road&apos;s travel time and the express parcels reroute on their own. If two notices are posted, the one with the higher priority wins — and if a company on the only express route drops out, the express parcels go back to the ordinary roads, slower but still delivered.
        </p>
        <Callout tone="cyan" title="When it breaks, ask in this order" icon="→">
          Which label does the traffic get, and what latency? Is the policy up? Which definition won, from whom? Who participates? Does the egress advertise its algorithm SID? Does the headend have a path and label for it?
        </Callout>
      </GuideSection>

      <GuideSection id="fl-glossary" eyebrow="Reference" title="Glossary" tone="cyan">
        <Glossary
          items={[
            { term: "Algorithm 0", def: "The default SPF on the IGP metric, run by every router." },
            { term: "Flex-Algo", def: "An extra IGP algorithm (128–255) defined by a FAD (RFC 9350)." },
            { term: "FAD", def: "Flex-Algo Definition: metric type, affinity rules, priority — advertised in IS-IS." },
            { term: "Participation", def: "A router computes and forwards for an algorithm only if it is configured for it." },
            { term: "Affinity", def: "An administrative color on a link; the FAD can exclude or require it." },
            { term: "Algorithm prefix SID", def: "A prefix SID that means “reach this prefix via algorithm N”." },
            { term: "sid-algorithm", def: "An SR policy constraint that resolves the path to SIDs of one algorithm." },
          ]}
        />
      </GuideSection>

      <GuideSection id="fl-recap" eyebrow="Reference" title="Recap" tone="success">
        <ChecklistCard tone="success" title="You can now" mark="✓" items={["tell algorithm 0 from a Flex-Algo", "read a definition and its election", "build an algorithm topology from participation and attributes", "use and explain algorithm prefix SIDs", "predict how link changes move an algorithm's path", "find, fix and prove a participation fault"]} />
      </GuideSection>

      <GuideSection id="fl-practice" eyebrow="Next" title="Practice it" tone="violet">
        <p>The Deep Dive tab covers Flex-Algo in full: algorithm numbers, the FAD and its sub-TLVs, metric types including delay measurement, affinity rules and ASLA, FAD election, participation, algorithm SIDs, steering with SR policies, Flex-Algo with TI-LFA, configuration and verification on IOS XR, and every failure signature with real evidence. The lab lets you operate it.</p>
        <LessonLabBridge />
        <PresentationBridge>Rewatch the SR Flex-Algo presentation.</PresentationBridge>
      </GuideSection>
    </div>
  );
}
