import { Callout, ChecklistCard, CompareCards, DArrow, DIAGRAM as D, DiagramFrame, DiagramSvg, FailureSignatures, FieldTable, FlowSteps, Glossary, GuideSection, Mono, TroubleshootingFlow } from "@/components/lesson/GuideBlocks";
import { DHeaderColumn, SRV6_POLICY_POS, Srv6Topology, type Srv6Link } from "@/components/lesson/Srv6GuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { PracticeBridge } from "@/components/lesson/GuideInteractive";
import { usePracticeLabOpener } from "@/components/lesson/FundamentalsLessonShell";
import { PresentationBridge } from "@/components/presentation/LessonPresentation";
import { CliPanel, pickLines, runGuideCli } from "@/components/lesson/GuideCli";
import { createPNet, llPol, pApply, pTicket, pTicketState, type PAction, type PPolicy, type PR, type PState, type PTicketId } from "@/lib/sim-engine/scenarios/s6pNet";
import { p6Sets, p6StaticApi } from "./p6-lab/p6Cli";

export const SRV6P_LESSON_SECTIONS: LessonGuideSectionLink[] = [
  { id: "pl-mission", label: "What this lesson teaches" },
  { id: "pl-network", label: "The network of this lesson" },
  { id: "pl-ideas", label: "Three ideas you need" },
  { id: "pl-intent", label: "A policy is an intent" },
  { id: "pl-metrics", label: "Two metrics, two paths" },
  { id: "pl-candidates", label: "Two candidate paths" },
  { id: "pl-selection", label: "Which candidate is active" },
  { id: "pl-steering", label: "Steering: bringing traffic in" },
  { id: "pl-wire", label: "What goes on the wire" },
  { id: "pl-walk", label: "Following the packet" },
  { id: "pl-weights", label: "Weighted segment lists, briefly" },
  { id: "pl-failover", label: "When a candidate fails" },
  { id: "pl-incident", label: "The inactive-candidate incident" },
  { id: "pl-invalid", label: "No valid candidate" },
  { id: "pl-b6", label: "The binding SID at work" },
  { id: "pl-working", label: "What working looks like" },
  { id: "pl-other", label: "Other ways it fails" },
  { id: "pl-model", label: "Mental model" },
  { id: "pl-glossary", label: "Glossary" },
  { id: "pl-recap", label: "Recap" },
  { id: "pl-practice", label: "Practice it" },
];

/** Real IOS XR output and test results on this page come from the SRv6 Policy Lab. */
const NL = String.fromCharCode(10);
const P0: PState = createPNet(0);
const run = (s: PState, ...a: PAction[]) => a.reduce((acc, x) => pApply(acc, x), s);
const to66: PAction = { type: "send", to: "RX66" };
const to67: PAction = { type: "send", to: "RX67" };
export const p6Policy = (s: PState, f: (p: PPolicy) => void): PAction => {
  const p = JSON.parse(JSON.stringify(llPol(s.view)!.pol)) as PPolicy;
  f(p);
  return { type: "policy", pol: p, text: "guide" };
};
export const p6TicketRun = (id: PTicketId) => pTicket(id).repro.reduce((acc, a) => pApply(acc, a), pTicketState(id, 1));
const RX66 = run(P0, to66);
const RX67 = run(P0, to67);
const FAIL = run(P0, { type: "link", id: "R3-R5", up: false });
const FAIL66 = run(FAIL, to66);
const INC = p6TicketRun("staleendx");
const INC_FIX = run(INC, p6Policy(INC, (p) => void (p.cands[0].sids = ["2001:db8:100:3:43::"])), to66);
const EP = p6TicketRun("endpoint");
export function p6Cli(s: PState, r: PR, command: string) {
  return runGuideCli(p6Sets(p6StaticApi(s, r), r).cisco, command);
}
export function p6Only(s: PState, r: PR, command: string, match: RegExp, keep = 0) {
  const x = p6Cli(s, r, command);
  return { ...x, output: pickLines(x.output, match, keep) };
}
/** Lines from the first match of `from` up to (not including) the first later match of `stop`. */
export function p6Block(s: PState, r: PR, command: string, from: RegExp, stop?: RegExp) {
  const x = p6Cli(s, r, command);
  const lines = x.output.split(NL);
  const i = lines.findIndex((l) => from.test(l));
  if (i < 0) return x;
  let j = stop ? lines.findIndex((l, k) => k > i && stop.test(l)) : -1;
  if (j < 0) j = lines.length;
  return { ...x, output: lines.slice(i, j).join(NL) };
}
/** One test, as the lab reports it. */
export function P6Result({ s, title }: { s: PState; title: string }) {
  const t = s.tests[s.tests.length - 1];
  return (
    <Callout tone={t.ok ? "success" : "danger"} title={title} icon={t.ok ? "✓" : "!"}>
      CLIENT1 → {t.to}: {t.ok ? `${t.ms} ms via ${t.path.join(" → ")}` : t.why} · {t.via} · pushed [{t.sids.join(", ")}]
    </Callout>
  );
}

function LessonLabBridge() {
  const openLab = usePracticeLabOpener();
  return (
    <PracticeBridge label="Open the SRv6 Policy Lab" onPractice={openLab}>
      The network of this lesson on IOS XR: policy LOW-LATENCY with its two candidates, a controller window to edit it, traffic to two receivers, links to fail and flap — your own copy. Nothing you do there changes your lesson progress.
    </PracticeBridge>
  );
}

const LINKS: Srv6Link[] = [
  { a: "R1", b: "R2", label: "10 / d20" },
  { a: "R2", b: "R4", label: "10 / d20" },
  { a: "R4", b: "R6", label: "10 / d20" },
  { a: "R1", b: "R3", label: "15 / d5" },
  { a: "R3", b: "R5", label: "15 / d5" },
  { a: "R5", b: "R6", label: "15 / d5" },
  { a: "R3", b: "R4", label: "20 / d15" },
];

function TopologyDiagram() {
  return (
    <DiagramSvg h={240} label="TOP path R1 R2 R4 R6 has IGP metric 10 and delay 20 per link; BOTTOM path R1 R3 R5 R6 has IGP metric 15 and delay 5 per link; cross-link R3-R4 has metric 20 and delay 15">
      <Srv6Topology pos={SRV6_POLICY_POS} links={LINKS} sub={{ R1: "headend", R3: "End · End.X", R5: "End", R6: "End.DX6" }} accent={{ R1: D.ip, R3: D.warning, R5: D.warning, R6: D.violet }} boxW={82} />
      <text x={320} y={230} textAnchor="middle" fill={D.muted} fontSize={10}>
        labels: IGP metric / delay · CLIENT1 sits behind R1, RECEIVER6 behind R6
      </text>
    </DiagramSvg>
  );
}

function CandidatesDiagram() {
  const card = (x: number, title: string, pref: string, kind: string, list: string, color: string) => (
    <g>
      <rect x={x} y={30} width={280} height={100} rx={12} fill={D.box} stroke={color} strokeOpacity={0.8} />
      <text x={x + 14} y={52} fill={color} fontSize={12} fontWeight={700}>
        {title}
      </text>
      <text x={x + 266} y={52} textAnchor="end" fill={D.text} fontSize={11} fontWeight={700}>
        {pref}
      </text>
      <text x={x + 14} y={74} fill={D.muted} fontSize={10}>
        {kind}
      </text>
      <text x={x + 14} y={104} fill={D.text} fontSize={10.5} fontFamily="monospace">
        {list}
      </text>
    </g>
  );
  return (
    <DiagramSvg h={160} label="CP-EXPLICIT, identity CONFIG R1 10, preference 200, list R3 End.X then R6 End.DX6; CP-DYNAMIC, identity LOCAL R1 20, preference 100, objective MIN_DELAY, list computed from the TE database">
      <text x={320} y={18} textAnchor="middle" fill={D.muted} fontSize={10}>
        policy ⟨R1, Color 100, R6⟩ — two ways to realize one intent
      </text>
      {card(30, "CP-EXPLICIT", "pref 200", "CONFIG/R1/10 · written by the operator", "⟨R3 End.X, R6 End.DX6⟩", D.mpls)}
      {card(330, "CP-DYNAMIC", "pref 100", "LOCAL/R1/20 · MIN_DELAY, recomputed", "derived from the TE database", D.violet)}
      <text x={320} y={152} textAnchor="middle" fill={D.muted} fontSize={10}>
        a candidate is identity + type + preference; its segment list is just the current contents
      </text>
    </DiagramSvg>
  );
}

function EncapsDiagram() {
  return (
    <DiagramSvg h={220} label="H.Encaps at R1: a new outer IPv6 header with DA R3 End.X, an SRH with SL 1, LE 1, Segment List 0 R6 End.DX6 and 1 R3 End.X, and the original probe preserved inside">
      <text x={130} y={22} textAnchor="middle" fill={D.text} fontSize={11.5} fontWeight={700}>
        from CLIENT1
      </text>
      <DHeaderColumn x={130} y={36} w={170} rows={[{ text: "IPv6 → 2001:db8:cafe:6::a", color: D.ip }]} caption="original probe" />
      <DArrow x1={220} y1={46} x2={300} y2={46} color={D.faint} width={1.4} label="H.Encaps" />
      <text x={470} y={22} textAnchor="middle" fill={D.text} fontSize={11.5} fontWeight={700}>
        leaving R1
      </text>
      <DHeaderColumn
        x={470}
        y={36}
        w={250}
        rows={[
          { text: "outer DA = 2001:db8:100:3:2:: (R3 End.X)", color: D.warning, tag: "OUTER", strong: true },
          { text: "SRH · SL 1 · LE 1", color: D.violet, tag: "SRH" },
          { text: "[0] 2001:db8:100:6:10:: (R6 End.DX6)", color: D.violet },
          { text: "[1] 2001:db8:100:3:2:: (R3 End.X)", color: D.violet },
          { text: "inner probe, unchanged", color: D.ip, tag: "INNER" },
        ]}
      />
      <text x={320} y={200} textAnchor="middle" fill={D.muted} fontSize={10}>
        Color 100 selected the policy — it appears in no header field
      </text>
    </DiagramSvg>
  );
}

function WalkDiagram() {
  const cols = [
    { x: 90, head: "R1 → R3", da: "DA R3 End.X", sl: "SL 1", note: "FIB toward R3's locator" },
    { x: 250, head: "R3 → R5", da: "DA R6 End.DX6", sl: "SL 0", note: "End.X, forced R3→R5" },
    { x: 410, head: "R5 → R6", da: "DA R6 End.DX6", sl: "SL 0", note: "R5 is transit" },
    { x: 565, head: "at R6", da: "DA R6 End.DX6", sl: "SL 0", note: "before End.DX6 decap" },
  ];
  return (
    <DiagramSvg h={150} label="R1 to R3 carries DA R3 End.X with SL 1; R3 executes End.X, so R3 to R5 and R5 to R6 carry DA R6 End.DX6 with SL 0; R6 decapsulates and delivers the probe to RECEIVER6">
      {cols.map((c, i) => (
        <g key={c.head}>
          <text x={c.x} y={20} textAnchor="middle" fill={D.text} fontSize={11} fontWeight={700}>
            {c.head}
          </text>
          <DHeaderColumn x={c.x} y={32} w={128} rows={[{ text: c.da, color: D.warning, strong: true }, { text: `${c.sl} · LE 1`, color: D.violet }]} caption={c.note} />
          {i < cols.length - 1 && <DArrow x1={c.x + 66} y1={43} x2={cols[i + 1].x - 66} y2={43} color={D.faint} width={1.2} />}
        </g>
      ))}
      <text x={320} y={140} textAnchor="middle" fill={D.muted} fontSize={10}>
        End.DX6 removes the outer IPv6 + SRH and cross-connects the original probe to RECEIVER6
      </text>
    </DiagramSvg>
  );
}

function FailoverDiagram() {
  return (
    <DiagramSvg h={240} label="With R3-R5 down, CP-EXPLICIT is invalid; CP-DYNAMIC recomputes the lowest-delay path R1 R3 R4 R6, delay 40">
      <Srv6Topology
        pos={SRV6_POLICY_POS}
        links={LINKS.map((l) => {
          const id = `${l.a}-${l.b}`;
          if (id === "R3-R5") return { ...l, color: D.danger, dashed: true, label: "DOWN" };
          if (id === "R1-R3" || id === "R3-R4" || id === "R4-R6") return { ...l, color: D.violet, bold: true };
          return l;
        })}
        sub={{ R1: "headend", R6: "endpoint" }}
        accent={{ R1: D.ip, R6: D.violet }}
        boxW={82}
      />
      <text x={320} y={230} textAnchor="middle" fill={D.violet} fontSize={10.5} fontWeight={700}>
        CP-DYNAMIC active: R1 → R3 → R4 → R6 (delay 5 + 15 + 20 = 40) — headend re-selection, not TI-LFA
      </text>
    </DiagramSvg>
  );
}

function B6Diagram() {
  return (
    <DiagramSvg h={180} label="End.B6.Encaps: an incoming packet whose active segment is R1's BSID is advanced like End, then a new outer IPv6 header and SRH for the bound policy are pushed, with the advanced original packet nested inside">
      <text x={140} y={20} textAnchor="middle" fill={D.text} fontSize={11} fontWeight={700}>
        incoming
      </text>
      <DHeaderColumn x={140} y={32} w={200} rows={[{ text: "DA = R1 BSID ::9000", color: D.warning, strong: true }, { text: "SRH SL 1 · [0] R6 End.DX6", color: D.violet }]} />
      <DArrow x1={245} y1={55} x2={325} y2={55} color={D.faint} width={1.4} label="End.B6.Encaps" />
      <text x={480} y={20} textAnchor="middle" fill={D.text} fontSize={11} fontWeight={700}>
        leaving R1
      </text>
      <DHeaderColumn
        x={480}
        y={32}
        w={220}
        rows={[
          { text: "NEW outer DA = R3 End.X", color: D.warning, tag: "NEW", strong: true },
          { text: "NEW SRH · SL 1 · LE 1", color: D.violet },
          { text: "nested: DA R6 End.DX6 · SL 0", color: D.ip, tag: "NESTED" },
        ]}
      />
      <text x={320} y={160} textAnchor="middle" fill={D.muted} fontSize={10}>
        the incoming SRH is advanced first, then encapsulated — never a bare DA = BSID packet
      </text>
    </DiagramSvg>
  );
}


export function Srv6PolicyLessonGuideContent() {
  return (
    <div className="space-y-12">
      <GuideSection id="pl-mission" eyebrow="This lesson" title="What this lesson teaches" tone="ip">
        <p>
          Endpoint Behaviors showed what a SID does once a packet reaches it. This lesson answers the question before that one: which SIDs should a packet carry, who decides, and how does the right traffic end up with them? The answer is the <b className="text-pv-text">SR policy</b> (RFC 9256), here on the SRv6 data plane.
        </p>
        <p>You will meet one intent — “low latency to R6” — written as a policy on R1, give it two candidate paths, watch R1 pick one, steer one receiver into it and leave another out, and then break it: a failed link, a candidate that never comes back, and a policy that is up but carries nothing.</p>
        <ChecklistCard tone="violet" title="By the end of this lesson you can" mark="→" items={["say what ⟨headend, color, end-point⟩ means", "tell explicit from dynamic candidates and say which one is active", "explain how a route's color steers traffic into a policy", "read the SID list R1 pushes and follow it hop by hop", "explain candidate failover — and why it isn't fast reroute", "find a policy fault from evidence, fix it and prove it"]} />
      </GuideSection>

      <GuideSection id="pl-network" eyebrow="This lesson" title="The network of this lesson" tone="cyan">
        <DiagramFrame caption="Every link carries an IGP metric and a delay.">
          <TopologyDiagram />
        </DiagramFrame>
        <p>
          Six routers in a diamond with a cross-link. The top (R1–R2–R4–R6) is cheap for the IGP and slow; the bottom (R1–R3–R5–R6) is expensive for the IGP and fast. CLIENT1 sits behind R1; behind R6 are two receivers: <b className="text-pv-text">RX66</b> (2001:db8:66::6), a latency-sensitive application, and <b className="text-pv-text">RX67</b> (2001:db8:67::7), which doesn&apos;t care.
        </p>
        <Callout tone="cyan" title="The lesson and the lab" icon="i">
          The guided lesson writes its SIDs by hand so they are easy to read: R3&apos;s End.X toward R5 is <Mono>…:3:2::</Mono>, the final SID is R6&apos;s End.DX6 <Mono>…:6:10::</Mono>, the binding SID <Mono>…:1:9000::</Mono>, and it shows the full SRH. The lab runs IOS XR, which allocates SIDs dynamically and uses reduced encapsulation: End.X toward R5 is <Mono>…:3:41::</Mono>, R6&apos;s service SID is End.DT6 <Mono>…:6:42::</Mono> for its global IPv6 table, the binding SID <Mono>…:1:42::</Mono>. Same network, same policy, same decisions — the outputs below come from the lab.
        </Callout>
      </GuideSection>

      <GuideSection id="pl-ideas" eyebrow="This lesson" title="Three ideas you need" tone="violet">
        <CompareCards
          items={[
            { title: "Intent", tone: "violet", tag: "the policy", points: ["⟨headend, color, end-point⟩", "lives on R1, the headend"] },
            { title: "Candidates", tone: "mpls", tag: "how", points: ["explicit SIDs or a computation", "valid first, then preference"] },
            { title: "Steering", tone: "cyan", tag: "what goes in", points: ["a route's color + next hop", "no match, no policy"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="pl-intent" eyebrow="The policy" title="A policy is an intent" tone="violet">
        <p>
          A policy is identified by three things: the <b className="text-pv-text">headend</b> that holds it (R1), a <b className="text-pv-text">color</b> (100), and an <b className="text-pv-text">end-point</b> (R6&apos;s loopback 2001:db8::6). Color is just a number the operators agreed on — “100 means low latency”. It names the intent; it never appears in a packet.
        </p>
        <CliPanel run={p6Only(P0, "R1", "show segment-routing traffic-eng policy", /^Color|Name: srte|Operational|Binding SID/)} caption="IOS XR · R1 — policy ⟨color 100, end-point 2001:db8::6⟩, up, with a binding SID" />
        <p>In the lab a controller (PCE) creates the policy on R1 over PCEP; it is called LOW-LATENCY. The guided lesson configures it locally. Either way, R1 owns it.</p>
      </GuideSection>

      <GuideSection id="pl-metrics" eyebrow="The problem" title="Two metrics, two paths" tone="ospf">
        <p>
          IS-IS adds metrics: top 10 + 10 + 10 = 30, bottom 15 + 15 + 15 = 45. Every ordinary packet goes over the top. But each link also advertises its <b className="text-pv-text">delay</b> (performance measurement): 20 ms per top link, 5 ms per bottom link. By delay the top costs 60 ms and the bottom 15 ms — the IGP&apos;s favorite is the slowest path.
        </p>
        <CliPanel run={p6Only(P0, "R1", "show performance-measurement interfaces", /Interface Name|Advertised delay/)} caption="IOS XR · R1 — 20 ms toward R2, 5 ms toward R3" />
        <P6Result s={RX67} title="The lab: RX67, no policy — the IGP path" />
      </GuideSection>

      <GuideSection id="pl-candidates" eyebrow="The policy" title="Two candidate paths" tone="mpls">
        <DiagramFrame caption="Candidates are alternatives inside one policy.">
          <CandidatesDiagram />
        </DiagramFrame>
        <p>
          The policy can be realized in more than one way, so it holds <b className="text-pv-text">candidate paths</b>, each with a preference. The <b className="text-pv-text">explicit</b> candidate (preference 200) is a fixed list: one SID, R3&apos;s End.X toward R5. The packet reaches R3 by ordinary routing toward R3&apos;s locator — R1&apos;s shortest path to R3 is the direct link — and R3 sends it out to R5; from there the service SID takes it to R6. No R3 End SID is needed in front.
        </p>
        <p>
          The <b className="text-pv-text">dynamic</b> candidate (preference 100) is an objective: minimum delay to R6. The PCE runs SPF on delay, finds R1 → R3 → R5 → R6 and encodes it with as few SIDs as possible: R5&apos;s End, because R1&apos;s ordinary route to R5 already passes R3.
        </p>
        <CliPanel run={p6Only(P0, "R1", "show segment-routing traffic-eng policy", /Preference|Explicit|Dynamic|Metric Type|SID\[/)} caption="IOS XR · R1 — explicit [R3 End.X→R5] and dynamic [R5 End], both from the PCE" />
        <FlowSteps
          steps={[
            { title: "Explicit: validate", body: "Every SID must exist (someone advertises it) and the first must be reachable.", tone: "cyan" },
            { title: "Dynamic: compute", body: "TE database → lowest-delay path → the smallest SID list that reproduces it.", tone: "violet" },
          ]}
        />
      </GuideSection>

      <GuideSection id="pl-selection" eyebrow="The policy" title="Which candidate is active" tone="warning">
        <p>
          Selection is a two-step rule: throw away every invalid candidate, then take the highest preference among the rest. Both are valid now, so 200 — explicit — is active and the dynamic one waits. Selection runs again whenever anything it reads changes: the topology, the SIDs that exist, the policy itself.
        </p>
        <Callout tone="warning" title="Preference never rescues an invalid candidate" icon="!">
          A candidate with preference 1000 that names a missing SID loses to a valid candidate with preference 1.
        </Callout>
      </GuideSection>

      <GuideSection id="pl-steering" eyebrow="Steering" title="Steering: bringing traffic in" tone="cyan">
        <p>
          A policy that is up carries nothing until traffic is <b className="text-pv-text">steered</b> into it. Here R6 advertises RX66&apos;s prefix with the BGP extended community <b className="text-pv-text">Color:100</b>. R1 sees color 100 and next hop 2001:db8::6, finds the policy ⟨color 100, end-point 2001:db8::6⟩ and resolves the route onto it — automated steering. RX67&apos;s prefix has no color: it stays on the IGP.
        </p>
        <CliPanel run={p6Only(P0, "R1", "show bgp ipv6 unicast 2001:db8:66::/64", /C:100|Sid:|Color:|SR policy/)} caption="IOS XR · R1 — color 100, R6's service SID, and the policy it resolves onto" />
        <CliPanel run={p6Only(P0, "R6", "show running-config", /^route-policy|destination in|set extcommunity|route-policy SET/)} caption="IOS XR · R6 — the export policy that sets the color" />
        <p>The policy also has a <b className="text-pv-text">binding SID</b> on R1 (<Mono>…:1:42::</Mono>, End.B6.Encaps): a SID that means “this policy”. CEF shows RX66&apos;s prefix resolving through it.</p>
      </GuideSection>

      <GuideSection id="pl-wire" eyebrow="The data plane" title="What goes on the wire" tone="ip">
        <DiagramFrame caption="The guided lesson's view: the active candidate's list becomes a new outer header and SRH (full SRH).">
          <EncapsDiagram />
        </DiagramFrame>
        <p>
          R1 encapsulates the customer&apos;s packet: the policy&apos;s SIDs, then R6&apos;s service SID learned from BGP. The guided lesson keeps every SID in the SRH so you can see it. IOS XR uses <b className="text-pv-text">H.Encaps.Red</b>: the first SID sits only in the outer destination address, the SRH holds the rest — one SID shorter on the wire.
        </p>
        <CliPanel run={p6Only(P0, "R1", "show cef ipv6 2001:db8:66::/64", /via|next hop|SID-list/)} caption="IOS XR · R1 — RX66's prefix: via the policy, SID list {R3 End.X→R5, R6 End.DT6}" />
      </GuideSection>

      <GuideSection id="pl-walk" eyebrow="The data plane" title="Following the packet" tone="ip">
        <DiagramFrame caption="The guided lesson's probe: R1 → R3 → R5 → R6 → the receiver.">
          <WalkDiagram />
        </DiagramFrame>
        <p>
          R1 → R3: DA = R3&apos;s End.X SID, Segments Left 1. R3 finds it in its SID table, decrements Segments Left to 0, copies R6&apos;s service SID into the DA and sends the packet out of its link to R5. R5 has nothing to execute — it routes toward R6&apos;s locator. R6 finds its End.DT6 SID, removes the outer header and looks RX66 up in its global IPv6 table.
        </p>
        <P6Result s={RX66} title="The lab: RX66, steered into LOW-LATENCY" />
      </GuideSection>

      <GuideSection id="pl-weights" eyebrow="Briefly" title="Weighted segment lists, briefly" tone="violet">
        <p>A candidate can hold more than one segment list, each with a weight; flows are hashed across them (80/20 means 80 % of flows, never every fifth packet). The guided lesson shows it read-only; the lab&apos;s candidates have one list each. A candidate is its identity and preference — not the list it currently resolves to.</p>
      </GuideSection>

      <GuideSection id="pl-failover" eyebrow="Resilience" title="When a candidate fails" tone="danger">
        <DiagramFrame caption="The policy stays up; only the active candidate changes.">
          <FailoverDiagram />
        </DiagramFrame>
        <p>
          R3–R5 fails. R3 withdraws its End.X toward R5, so the explicit list names a SID that nobody advertises: the candidate is <b className="text-pv-text">invalid</b>. The PCE recomputes the dynamic candidate on the new topology — lowest delay is now R1 → R3 → R4 → R6, 5 + 15 + 20 = 40 ms, encoded as R3&apos;s End — and preference 100 becomes active. The policy never went down.
        </p>
        <CliPanel run={p6Only(FAIL, "R1", "show segment-routing traffic-eng policy", /Preference|Explicit|Reason|Dynamic|Accumulated|SID\[/)} caption="IOS XR · R1 — explicit invalid (its SID is gone), dynamic recomputed and active" />
        <P6Result s={FAIL66} title="The lab: RX66 after R3–R5 failed" />
        <Callout tone="cyan" title="Not fast reroute" icon="i">
          This switch happens on the headend, after the IGP and the PCE have learned about the failure. Protection at the point of failure, within 50 ms, is TI-LFA — a later lesson.
        </Callout>
      </GuideSection>

      <GuideSection id="pl-incident" eyebrow="Incident" title="The inactive-candidate incident" tone="danger">
        <p>
          In the guided lesson R3–R5 comes back, R3 shows its End.X SID, IPv6 is healthy end to end — and the dynamic candidate stays active. There, the cause is that R1&apos;s SR database has not re-verified the SID. The lab tells the same story with a cause you will meet in real networks: when the link flapped, R3 <b className="text-pv-text">re-allocated</b> its End.X toward R5 as <Mono>…:3:43::</Mono>. The explicit list still says <Mono>…:3:41::</Mono>.
        </p>
        <P6Result s={INC} title="The lab: RX66 during the incident (the ticket)" />
        <TroubleshootingFlow
          steps={[
            { question: "Does the app's traffic arrive?", look: "Yes, 15 ms — this is about which path, not reachability." },
            { question: "Which candidate is active, and why not 200?", look: "200 is invalid: SID …:3:41:: is not in the SR database." },
            { question: "Who should own that SID?", look: "R3 — its End.X toward R5." },
            { question: "What does R3 have now?", look: "End.X toward R5 = …:3:43::." },
          ]}
        />
        <CliPanel run={p6Only(INC, "R1", "show segment-routing traffic-eng policy", /Preference|Explicit|Reason|Dynamic|SID\[/)} caption="IOS XR · R1 — the explicit candidate and why it is invalid" />
        <CliPanel run={p6Only(INC, "R3", "show segment-routing srv6 sid", /End\.X/)} caption="IOS XR · R3 — End.X toward R5 (Gi0/0/0/1) is now …:3:43::" />
        <p>The repair is on the controller: update the explicit segment list to <Mono>2001:db8:100:3:43::</Mono> and push it to R1. Raising the preference would change nothing — the candidate is invalid, not outranked.</p>
        <P6Result s={INC_FIX} title="The lab: a fresh test after the fix" />
        <ChecklistCard tone="success" title="Proved, not assumed" mark="✓" items={["the explicit candidate (200) is valid and active again", "a fresh packet to RX66 carries […:3:43::, …:6:42::] and arrives in 15 ms", "the lesson: hard-coded SIDs must follow dynamic allocation — or let the PCE build the list from the adjacency"]} />
      </GuideSection>

      <GuideSection id="pl-invalid" eyebrow="Resilience" title="No valid candidate" tone="danger">
        <p>
          When no candidate is valid, the policy goes down. What happens to steered traffic is a choice: by default it falls back to its ordinary route (the IGP path), or, if the policy is configured to drop upon invalidation, it is dropped rather than rerouted — for traffic that must never take the wrong path.
        </p>
        <CompareCards
          items={[
            { title: "Default", tone: "warning", tag: "fallback", points: ["policy down → the route resolves normally", "traffic takes the IGP path"] },
            { title: "Drop upon invalid", tone: "danger", tag: "optional", points: ["steering stays on the dead policy", "traffic is dropped"] },
          ]}
        />
        <p>The lab&apos;s end-point ticket shows the default: the controller re-created the policy with end-point 2001:db8::66, which is no router — neither candidate can be valid, the route finds no matching policy, and RX66 falls back to 60 ms.</p>
        <P6Result s={EP} title="The lab: RX66 with the wrong end-point (the ticket)" />
      </GuideSection>

      <GuideSection id="pl-b6" eyebrow="Advanced" title="The binding SID at work" tone="violet">
        <DiagramFrame caption="H.Encaps starts from classified traffic; End.B6.Encaps starts from a packet whose active SID is the BSID.">
          <B6Diagram />
        </DiagramFrame>
        <p>A packet that arrives at R1 with the binding SID as its destination is pushed into the policy: R1 advances it like End and wraps it in the policy&apos;s own header. Another domain, or another policy, can use LOW-LATENCY with one SID and never know its path.</p>
        <CliPanel run={p6Only(P0, "R1", "show segment-routing srv6 sid", /^SID|^---|End\.B6/)} caption="IOS XR · R1 — the binding SID is a local SID like any other" />
      </GuideSection>

      <GuideSection id="pl-working" eyebrow="Evidence" title="What working looks like" tone="success">
        <FieldTable
          title="Healthy, in five questions (IOS XR)"
          accent="success"
          columns={["Question", "Command", "Healthy answer"]}
          rows={[
            ["Is the route colored and matched?", <Mono key="1">show bgp ipv6 unicast 2001:db8:66::/64</Mono>, "C:100, SR policy color 100, up, registered"],
            ["Is the policy up, which candidate?", <Mono key="2">show segment-routing traffic-eng policy</Mono>, "up · preference 200 (active)"],
            ["Do the SIDs exist?", <Mono key="3">show segment-routing srv6 sid</Mono>, "R3: End.X …:3:41:: toward R5"],
            ["What does R1 push?", <Mono key="4">show cef ipv6 2001:db8:66::/64</Mono>, "{…:3:41:: …:6:42::}"],
            ["Does it work?", "a test to RX66", "15 ms via R3 → R5"],
          ]}
        />
      </GuideSection>

      <GuideSection id="pl-other" eyebrow="Beyond this incident" title="Other ways it fails" tone="warning">
        <FailureSignatures
          items={[
            { tag: "SRv6", title: "SRv6 off on R3", tone: "danger", points: ["R3 has no SIDs", "explicit invalid, dynamic still 15 ms"] },
            { tag: "COL", title: "Color removed", tone: "warning", points: ["policy up, explicit active", "the app on the IGP: 60 ms"] },
            { tag: "EP", title: "Wrong end-point", tone: "danger", points: ["policy down", "nothing steered: 60 ms"] },
            { tag: "PREF", title: "Preference typo", tone: "violet", points: ["both valid", "the dynamic one wins"] },
          ]}
        />
        <p className="text-sm text-pv-text-muted">Each is a ticket in the SRv6 Policy Lab, together with this incident.</p>
      </GuideSection>

      <GuideSection id="pl-model" eyebrow="Mental model" title="Mental model" tone="cyan">
        <p>
          Think of the policy as a standing order at a travel agency (R1): “customers flagged <i>express</i> going to city R6 travel the fastest way”. The agency keeps two itineraries on file — a specific route someone wrote down, and “ask the planner for the fastest one” — and uses the best itinerary that is still bookable. The flag on the ticket (the color) decides who gets the standing order; a traveller without it gets the normal route. If someone rebuilds a station and changes its name, the written itinerary quietly stops being bookable — the planner&apos;s still works, and nobody notices until they ask why the preferred itinerary isn&apos;t used.
        </p>
        <Callout tone="cyan" title="When it breaks, ask in this order" icon="→">
          What does the app see? Is its route colored, and does color + next hop match a policy? Is the policy up — which candidate, and why is each valid or not? Do the SIDs in the list exist where they should? What does R1 actually push?
        </Callout>
      </GuideSection>

      <GuideSection id="pl-glossary" eyebrow="Reference" title="Glossary" tone="cyan">
        <Glossary
          items={[
            { term: "SR policy", def: "⟨headend, color, end-point⟩ with candidate paths (RFC 9256)." },
            { term: "Color", def: "A number naming an intent; carried by BGP routes, never in packets." },
            { term: "Candidate path", def: "One way to realize the policy: explicit or dynamic, with a preference." },
            { term: "Automated steering", def: "A BGP route with color C and next hop E uses the policy ⟨C, E⟩." },
            { term: "Binding SID", def: "A local SID meaning “this policy” (End.B6.Encaps)." },
            { term: "H.Encaps.Red", def: "Encapsulation with the first SID only in the outer DA." },
            { term: "PCE / PCEP", def: "The controller that computes paths, and the protocol it uses with the headend." },
          ]}
        />
      </GuideSection>

      <GuideSection id="pl-recap" eyebrow="Reference" title="Recap" tone="success">
        <ChecklistCard tone="success" title="You can now" mark="✓" items={["read a policy's identity, candidates and binding SID", "explain valid-then-preference selection", "explain steering by color", "follow the SID list from R1 to R6", "explain candidate failover and stale SIDs", "find, fix and prove a policy fault"]} />
      </GuideSection>

      <GuideSection id="pl-practice" eyebrow="Next" title="Practice it" tone="violet">
        <p>The Deep Dive tab covers SR policies on SRv6 in full: the architecture, candidate sources, validity and selection rules, dynamic computation and SID encoding, automated steering, binding SIDs, encapsulation modes, IOS XR configuration and verification, and every failure signature with real evidence. The lab lets you edit the policy yourself.</p>
        <LessonLabBridge />
        <PresentationBridge>Rewatch the SRv6 Policy presentation.</PresentationBridge>
      </GuideSection>
    </div>
  );
}
