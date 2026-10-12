import { Callout, ChecklistCard, CompareCards, DArrow, DIAGRAM as D, DLink, DNode, DPill, DiagramFrame, DiagramSvg, FailureSignatures, FieldTable, FlowSteps, Glossary, GuideSection, Mono, TroubleshootingFlow } from "@/components/lesson/GuideBlocks";
import { DStack } from "@/components/lesson/MplsGuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { PracticeBridge } from "@/components/lesson/GuideInteractive";
import { usePracticeLabOpener } from "@/components/lesson/FundamentalsLessonShell";
import { PresentationBridge } from "@/components/presentation/LessonPresentation";
import { CliPair, CliPanel, pickLines, runGuideCli } from "@/components/lesson/GuideCli";
import type { CliVendor } from "@/lib/cli/types";
import { createTeNet, teApply, teTicket, teTicketState, type TeOs, type TeR, type TeState } from "@/lib/sim-engine/scenarios/teNet";
import { teSets, teStaticApi } from "./te-lab/teCli";

export const RSVP_TE_LESSON_SECTIONS: LessonGuideSectionLink[] = [
  { id: "tl-mission", label: "What this lesson teaches" },
  { id: "tl-network", label: "The network of this lesson" },
  { id: "tl-ideas", label: "Three ideas you need" },
  { id: "tl-watch", label: "What you will watch" },
  { id: "tl-problem", label: "Shortest vs constrained" },
  { id: "tl-ted", label: "The TE database" },
  { id: "tl-cspf", label: "CSPF: prune, then SPF" },
  { id: "tl-ero", label: "The ERO" },
  { id: "tl-signal", label: "PATH down, RESV up" },
  { id: "tl-labels", label: "The labels RESV installs" },
  { id: "tl-data", label: "Traffic on the engineered path" },
  { id: "tl-autoroute", label: "Routing traffic into the tunnel" },
  { id: "tl-working", label: "What working looks like" },
  { id: "tl-incident", label: "The 700 Mbps incident" },
  { id: "tl-investigate", label: "Walk the evidence" },
  { id: "tl-repair", label: "Repair and prove it" },
  { id: "tl-other", label: "Other ways RSVP-TE breaks" },
  { id: "tl-model", label: "Mental model" },
  { id: "tl-glossary", label: "Glossary" },
  { id: "tl-recap", label: "Recap" },
  { id: "tl-practice", label: "Practice it" },
];

/**
 * Every CLI sample on this page is the RSVP-TE Lab's own IOS XR / Junos command set run against the lab's model: the
 * healthy network, and the lab's "bw" ticket — the guided lesson's 700 Mbps fault (CUST-B's tunnel still holds 400 Mbps on
 * R3–R5 after the customer left; R1 reloads and can't re-signal tunnel-te1 at 700 Mbps).
 */
export const TE_HEALTHY: TeState = createTeNet(0);
export const TE_HEALTHY_JN: TeState = createTeNet(0, "junos");
const fault = (os: TeOs) => teTicket("bw").repro.reduce((acc, a) => teApply(acc, a), teTicketState("bw", 0, os));
const TE_FAULT = fault("xr");
const TE_FAULT_JN = fault("junos");
const TE_FIXED = teApply(teApply(TE_FAULT, { type: "set", text: "R3: interface tunnel-te10 shutdown", changes: [{ dev: "R3", f: (c) => void (c.tunnels[0].shut = true) }] }), { type: "test", from: "CE1", mbps: 700 });
export function teCli(s: TeState, r: TeR, vendor: CliVendor, command: string) {
  return runGuideCli(teSets(teStaticApi(s, r), r)[vendor], command);
}
export function teOnly(s: TeState, r: TeR, vendor: CliVendor, command: string, match: RegExp, keep = 0) {
  const x = teCli(s, r, vendor, command);
  return { ...x, output: pickLines(x.output, match, keep) };
}
/** The XR TED, reduced to the links whose local addresses are given (the header lines kept). */
export function teTopo(s: TeState, r: TeR, addrs: string[]) {
  const x = teCli(s, r, "cisco", "show mpls traffic-eng topology brief");
  const out: string[] = [];
  let owner = "";
  for (const b of x.output.split("\n\n")) {
    if (/^IGP Id/.test(b.trim())) owner = b.trim();
    else if (addrs.some((a) => b.includes(`Frag Id:0, Intf Address:${a},`))) {
      if (owner) out.push(owner);
      owner = "";
      out.push(b.replace(/^\n+/, ""));
    }
  }
  return { ...x, output: out.join("\n\n") };
}

function LessonLabBridge() {
  const openLab = usePracticeLabOpener();
  return (
    <PracticeBridge label="Open the RSVP-TE Lab" onPractice={openLab}>
      The same six routers with real traffic on every link (plus an R4–R5 link), IOS XR or Junos, your own copy. Nothing you do there changes your lesson progress.
    </PracticeBridge>
  );
}

const POS: Record<string, [number, number]> = { R1: [70, 110], R2: [240, 40], R4: [400, 40], R3: [240, 180], R5: [400, 180], R6: [570, 110] };

function Fabric({ pruned, highlight, labels }: { pruned?: boolean; highlight?: "top" | "bottom"; labels: Record<string, string> }) {
  const links: [string, string, "top" | "bottom"][] = [
    ["R1", "R2", "top"],
    ["R2", "R4", "top"],
    ["R4", "R6", "top"],
    ["R1", "R3", "bottom"],
    ["R3", "R5", "bottom"],
    ["R5", "R6", "bottom"],
  ];
  return (
    <>
      {links.map(([a, b, side]) => {
        const id = `${a}-${b}`;
        const cut = pruned && id === "R2-R4";
        const on = highlight === side && !cut;
        const [x1, y1] = POS[a];
        const [x2, y2] = POS[b];
        return <DLink key={id} x1={x1} y1={y1} x2={x2} y2={y2} color={cut ? D.danger : on ? D.success : side === "top" ? D.cyan : D.warning} dashed={cut} label={labels[id]} labelDy={side === "top" ? -8 : 16} />;
      })}
      {pruned && (
        <text x={320} y={62} textAnchor="middle" fill={D.danger} fontSize={18} fontWeight={700}>
          ✕
        </text>
      )}
      {Object.entries(POS).map(([id, [x, y]]) => (
        <DNode key={id} x={x} y={y} label={id} sub={id === "R1" ? "headend" : id === "R6" ? "tailend" : undefined} accent={D.mpls} w={id === "R1" || id === "R6" ? 92 : 64} h={id === "R1" || id === "R6" ? 44 : 34} />
      ))}
    </>
  );
}

function TopologyDiagram() {
  return (
    <DiagramSvg h={220} label="Top path R1-R2-R4-R6 metric 10 per link, R2-R4 only 200 Mbps reservable; bottom path R1-R3-R5-R6 metric 15 per link, 1000 Mbps">
      <Fabric labels={{ "R1-R2": "10 · 1000", "R2-R4": "10 · 200 rsv", "R4-R6": "10 · 1000", "R1-R3": "15 · 1000", "R3-R5": "15 · 1000", "R5-R6": "15 · 1000" }} />
      <text x={320} y={214} textAnchor="middle" fill={D.muted} fontSize={10}>
        labels: IGP/TE metric · max reservable Mbps · top links BLUE, bottom links GOLD
      </text>
    </DiagramSvg>
  );
}

function CspfDiagram() {
  return (
    <DiagramSvg h={220} label="For 500 Mbps, R2-R4 fails and is pruned; the only remaining path is R1-R3-R5-R6">
      <Fabric pruned highlight="bottom" labels={{ "R2-R4": "200 < 500: FAIL", "R3-R5": "1000 ≥ 500", "R1-R3": "1000 ≥ 500", "R5-R6": "1000 ≥ 500" }} />
      <DPill x={320} y={110} text="then SPF on what's left (TE metric)" color={D.violet} w={230} />
    </DiagramSvg>
  );
}

function SignalDiagram() {
  const hop: [string, number][] = [
    ["R1", 80],
    ["R3", 240],
    ["R5", 400],
    ["R6", 560],
  ];
  return (
    <DiagramSvg h={220} label="PATH goes R1 to R3 to R5 to R6; RESV comes back R6 to R5 to R3 to R1 advertising implicit-null, 300 and 200">
      {hop.map(([id, x]) => (
        <DNode key={id} x={x} y={110} label={id} sub={id === "R1" ? "headend" : id === "R6" ? "tailend" : undefined} accent={D.mpls} w={84} />
      ))}
      {hop.slice(0, -1).map(([id, x], i) => (
        <DArrow key={`p${id}`} x1={x + 46} y1={60} x2={hop[i + 1][1] - 46} y2={60} color={D.cyan} label="PATH" />
      ))}
      {hop.slice(0, -1).map(([id, x], i) => (
        <DArrow key={`r${id}`} x1={hop[i + 1][1] - 46} y1={160} x2={x + 46} y2={160} color={D.violet} label={["label 200", "label 300", "implicit-null"][i]} labelDy={16} />
      ))}
      <text x={320} y={26} textAnchor="middle" fill={D.cyan} fontSize={10.5} fontWeight={700}>
        PATH ↓ downstream: headend → tailend (ERO, bandwidth request)
      </text>
      <text x={320} y={206} textAnchor="middle" fill={D.violet} fontSize={10.5} fontWeight={700}>
        RESV ↑ upstream: tailend → headend (labels, reservation)
      </text>
    </DiagramSvg>
  );
}

function DataDiagram() {
  const n: [string, number][] = [
    ["R1", 70],
    ["R3", 240],
    ["R5", 410],
    ["R6", 570],
  ];
  const ops = ["PUSH 200", "SWAP 200 → 300", "POP (PHP)", "deliver"];
  return (
    <DiagramSvg h={150} label="Plain IP enters R1, carries 200 to R3, 300 to R5, plain IP to R6">
      {n.slice(0, -1).map(([id, x], i) => (
        <DLink key={id} x1={x + 36} y1={28} x2={n[i + 1][1] - 36} y2={28} color={D.success} />
      ))}
      {n.map(([id, x], i) => (
        <g key={id}>
          <DNode x={x} y={28} label={id} w={70} h={36} accent={D.mpls} />
          <text x={x} y={62} textAnchor="middle" fill={D.warning} fontSize={9.5} fontWeight={700}>
            {ops[i]}
          </text>
        </g>
      ))}
      <DStack x={155} y={78} labels={[{ text: "200 S1" }]} w={76} />
      <DStack x={325} y={78} labels={[{ text: "300 S1" }]} w={76} />
      <DStack x={490} y={78} labels={[]} w={76} />
    </DiagramSvg>
  );
}

function FaultDiagram() {
  return (
    <DiagramSvg h={220} label="For 700 Mbps the top path bottleneck is 200 and the bottom path R3-R5 has only 600 available because another tunnel holds 400">
      <Fabric labels={{ "R2-R4": "200 available", "R3-R5": "1000 − 400 = 600", "R1-R3": "1000", "R5-R6": "1000", "R1-R2": "1000", "R4-R6": "1000" }} />
      <DPill x={320} y={110} text="request: 700 Mbps" color={D.danger} w={150} />
      <text x={320} y={214} textAnchor="middle" fill={D.muted} fontSize={10}>
        CUST-B (an unrelated LSP) already reserves 400 Mbps on R3-R5
      </text>
    </DiagramSvg>
  );
}

export function RsvpTeLessonGuideContent() {
  return (
    <div className="space-y-12">
      <GuideSection id="tl-mission" eyebrow="This lesson" title="What this lesson teaches" tone="mpls">
        <p>
          R1 has to send a <b className="text-pv-text">500 Mbps</b> video stream to R6. IS-IS knows one answer: the cheapest path, R1–R2–R4–R6. But R2–R4 is already busy, and the bottom path has plenty of room. This lesson shows how <b className="text-pv-text">RSVP-TE</b> lets R1 choose a path that has room, reserve it hop by hop, and send the video over it.
        </p>
        <p>You will watch CSPF prune a link that can&apos;t carry 500 Mbps, PATH and RESV signal in opposite directions, labels flow upstream and bandwidth get reserved. Then the tunnel grows to 700 Mbps and won&apos;t come up — with every link and every protocol healthy. You find out why, fix it and prove it.</p>
        <ChecklistCard
          tone="violet"
          title="By the end of this lesson you can"
          mark="→"
          items={["explain why the IGP shortest path can be the wrong path", "read a Traffic Engineering Database", "follow CSPF: prune, then shortest path", "follow PATH downstream and RESV upstream, and say who chooses each label", "route traffic into a tunnel (autoroute announce / IS-IS shortcuts)", "find why an LSP won't come up when nothing is broken — and prove the fix"]}
        />
      </GuideSection>

      <GuideSection id="tl-network" eyebrow="This lesson" title="The network of this lesson" tone="cyan">
        <DiagramFrame caption="Top links cost 10, bottom links 15. R2–R4 is 1 Gbps but offers only 200 Mbps for reservations.">
          <TopologyDiagram />
        </DiagramFrame>
        <FieldTable
          title="Who is who"
          accent="mpls"
          columns={["Router", "TE router ID", "Role"]}
          rows={[
            ["R1", <Mono key="1">1.1.1.1</Mono>, "headend of tunnel-te1 (the video), customer CE1 behind it"],
            ["R2, R4", <Mono key="2">2.2.2.2, 4.4.4.4</Mono>, "top path; R2–R4 carries 800 Mbps of other traffic"],
            ["R3, R5", <Mono key="3">3.3.3.3, 5.5.5.5</Mono>, "bottom path; R3 is also the headend of CUST-B's 400 Mbps tunnel to R5"],
            ["R6", <Mono key="4">6.6.6.6</Mono>, "tailend, customer CE6 behind it"],
          ]}
        />
        <p className="text-sm text-pv-text-muted">IS-IS (the first lesson of this path) carries the topology and, with TE extensions, the TE database. The labels are MPLS as in the previous lesson. The RSVP-TE Lab adds an R4–R5 link (metric 25) so tunnels can reroute; the outputs on this page come from the lab.</p>
      </GuideSection>

      <GuideSection id="tl-ideas" eyebrow="This lesson" title="Three ideas you need" tone="violet">
        <CompareCards
          items={[
            { title: "Constraints", tone: "cyan", tag: "what", points: ["bandwidth, colors, explicit hops", "a path must satisfy all of them"] },
            { title: "Headend decides", tone: "violet", tag: "who", points: ["R1 computes the whole path (CSPF)", "the other routers just follow the ERO"] },
            { title: "Reserve, then forward", tone: "success", tag: "how", points: ["RSVP reserves along the path", "labels make traffic follow it"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="tl-watch" eyebrow="This lesson" title="What you will watch" tone="cyan">
        <FlowSteps
          steps={[
            { title: "The problem", body: "IS-IS sends the stream over the busy top path.", tone: "danger" },
            { title: "CSPF", body: "R2–R4 is pruned; R1–R3–R5–R6 is chosen.", tone: "violet" },
            { title: "PATH / RESV", body: "Down with the ERO, up with labels and reservations.", tone: "mpls" },
            { title: "Traffic", body: "Push, swap, pop on the engineered path.", tone: "success" },
            { title: "The incident", body: "700 Mbps: no path, although nothing is broken.", tone: "danger" },
            { title: "Repair", body: "Release the stale reservation, prove the stream.", tone: "success" },
          ]}
        />
      </GuideSection>

      <GuideSection id="tl-problem" eyebrow="Why TE" title="Shortest vs constrained" tone="warning">
        <p>
          IS-IS compares metrics. It doesn&apos;t know how full a link is or how big a flow is. R1–R2–R4–R6 costs 30, R1–R3–R5–R6 costs 45, so every flow to R6 takes the top — and R2–R4, already at 800 Mbps, would need 1300 Mbps. A quarter of the video would be dropped.
        </p>
        <CompareCards
          items={[
            { title: "Change IS-IS metrics", tone: "danger", tag: "blunt", points: ["moves every flow toward R6 at once", "the bottom path overflows instead"] },
            { title: "Engineer one LSP", tone: "success", tag: "precise", points: ["this flow gets a path with room", "everything else stays on IS-IS"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="tl-ted" eyebrow="Control plane" title="The TE database" tone="violet">
        <p>With TE extensions, IS-IS floods per link: the TE metric, the <b className="text-pv-text">maximum reservable bandwidth</b> (the RSVP interface bandwidth), the <b className="text-pv-text">unreserved bandwidth</b> at each of 8 priorities, and the link&apos;s colors. Every router builds the same TED.</p>
        <CliPanel run={teTopo(TE_HEALTHY, "R1", ["192.0.2.2", "192.0.2.8"])} caption="IOS XR · R1's TED — R2→R4 offers 200 Mbps, R3→R5 has 100 Mbps left (CUST-B 400 + tunnel-te1 500)" />
      </GuideSection>

      <GuideSection id="tl-cspf" eyebrow="Control plane" title="CSPF: prune, then shortest path" tone="violet">
        <DiagramFrame caption="For 500 Mbps, R2–R4 is removed first; SPF then runs on what is left.">
          <CspfDiagram />
        </DiagramFrame>
        <p>
          <b className="text-pv-text">Constrained SPF</b> runs at the headend. Step 1: remove every link direction that can&apos;t carry the LSP — not enough unreserved bandwidth at the LSP&apos;s setup priority, wrong colors, not in the TED. Step 2: ordinary SPF on the rest, by TE metric. For 500 Mbps only R1–R3–R5–R6 survives.
        </p>
      </GuideSection>

      <GuideSection id="tl-ero" eyebrow="Control plane" title="The ERO" tone="mpls">
        <p>
          CSPF&apos;s answer becomes the <b className="text-pv-text">Explicit Route Object</b>: the hops PATH must visit, here 192.0.2.7 (R3), 192.0.2.9 (R5), 192.0.2.11 (R6), all strict. The ERO is the plan; the <b className="text-pv-text">Record Route Object</b> in the RESV is what was actually signaled. The guided lesson&apos;s CSPF Lab lets you change the constraints — affinity, explicit paths — and watch the ERO change.
        </p>
      </GuideSection>

      <GuideSection id="tl-signal" eyebrow="Control plane" title="PATH goes down, RESV comes back up" tone="mpls">
        <DiagramFrame caption="PATH follows the ERO downstream; RESV returns upstream with a label from each hop.">
          <SignalDiagram />
        </DiagramFrame>
        <p>
          R1 sends <b className="text-pv-text">PATH</b> with the ERO, the requested bandwidth and the priorities. Each hop checks its outgoing interface can admit 500 Mbps and passes it on. R6 replies with <b className="text-pv-text">RESV</b>: going upstream, each hop <b className="text-pv-text">reserves</b> the bandwidth and tells its upstream neighbor which label to use.
        </p>
        <CliPair cisco={teOnly(TE_HEALTHY, "R1", "cisco", "show mpls traffic-eng tunnels 1", /Name:|Admin:|path option|Bandwidth Requested|Outgoing Interface|Explicit Route|Strict/)} junos={teOnly(TE_HEALTHY_JN, "R1", "juniper", "show mpls lsp extensive", /^6\.6\.6\.6|State:|Priorities|Bandwidth:|Computed ERO| S /)} ciscoCaption="IOS XR · R1 — up, 500 Mbps, the ERO" junosCaption="Junos · R1 — the same LSP" />
      </GuideSection>

      <GuideSection id="tl-labels" eyebrow="Control plane → data plane" title="The labels RESV installs" tone="mpls">
        <Callout tone="cyan" title="The numbers on this page" icon="i">
          The guided lesson uses short labels you can follow: R3 asks for <b>200</b>, R5 for <b>300</b>. Real routers allocate from large ranges, so in the lab R3 asks for <b>24201</b> and R5 for <b>24401</b> on IOS XR (299977 and 300177 on Junos). The rule is the same: each router chooses the label it receives.
        </Callout>
        <CliPair cisco={teCli(TE_HEALTHY, "R3", "cisco", "show mpls forwarding")} junos={teCli(TE_HEALTHY, "R5", "cisco", "show mpls forwarding")} ciscoCaption="IOS XR · R3 — swaps 24201 → 24401 toward R5" junosCaption="IOS XR · R5 — pops 24401 (R6 asked for implicit-null)" />
      </GuideSection>

      <GuideSection id="tl-data" eyebrow="Data plane" title="Traffic on the engineered path" tone="success">
        <DiagramFrame caption="Plain IP in, one label across the core, plain IP out.">
          <DataDiagram />
        </DiagramFrame>
        <p>R1 pushes R3&apos;s label, R3 swaps it for R5&apos;s, R5 pops it and R6 routes plain IP to CE6. The forwarding is ordinary MPLS; only the path was chosen by R1 instead of IS-IS. R3–R5 now carries 50 + 400 + 500 Mbps — within its 1 Gbps.</p>
        <CliPanel run={teCli(TE_HEALTHY, "R1", "cisco", "traceroute mpls traffic-eng tunnel-te 1")} caption="IOS XR · R1 — every hop of the LSP and the label it expects" />
      </GuideSection>

      <GuideSection id="tl-autoroute" eyebrow="Data plane" title="Routing traffic into the tunnel" tone="warning">
        <p>
          An LSP that is up carries nothing until routing points at it. <Mono>autoroute announce</Mono> (IOS XR) or IS-IS <Mono>traffic-engineering shortcuts</Mono> (Junos) make IS-IS use the tunnel for R6&apos;s loopback and everything behind it. Without it, the reservation sits unused and the video still crosses R2–R4.
        </p>
        <CliPair cisco={teCli(TE_HEALTHY, "R1", "cisco", "show route 10.6.6.20")} junos={teCli(TE_HEALTHY_JN, "R1", "juniper", "show route 10.6.6.20")} ciscoCaption="IOS XR · R1 — via tunnel-te1" junosCaption="Junos · R1 — via label-switched-path TO-R6" />
        <p className="text-sm text-pv-text-muted">An LSP is one-way: CE6&apos;s traffic back to CE1 follows IS-IS unless R6 builds its own tunnel.</p>
      </GuideSection>

      <GuideSection id="tl-working" eyebrow="Evidence" title="What working looks like" tone="success">
        <FieldTable
          title="Healthy, in five questions"
          accent="success"
          columns={["Question", "IOS XR", "Healthy answer"]}
          rows={[
            ["Is the LSP up, on which path?", <Mono key="1">show mpls traffic-eng tunnels 1</Mono>, "Oper up, ERO via R3, R5"],
            ["Is every link in the TED?", <Mono key="2">show mpls traffic-eng topology</Mono>, "all seven links, both directions"],
            ["Where is the bandwidth?", <Mono key="3">show rsvp interface</Mono>, "500M allocated on R1's link to R3"],
            ["Is traffic routed into it?", <Mono key="4">show route 10.6.6.20</Mono>, "via tunnel-te1"],
            ["Does the stream get through?", "a 500 Mbps flow from CE1", "delivered, nothing dropped"],
          ]}
        />
        <CliPair cisco={teCli(TE_HEALTHY, "R1", "cisco", "show rsvp interface")} junos={teCli(TE_HEALTHY, "R3", "cisco", "show mpls traffic-eng tunnels brief")} ciscoCaption="IOS XR · R1 — 500 Mbps allocated toward R3" junosCaption="IOS XR · R3 — head of CUST-B, midpoint of R1's tunnel" />
      </GuideSection>

      <GuideSection id="tl-incident" eyebrow="Incident" title="The 700 Mbps incident" tone="danger">
        <p>
          The video is upgraded to 700 Mbps and tunnel-te1 is resized; in the same window R1 reloads. Since then tunnel-te1 is down and the stream breaks up. Every link is up, IS-IS is converged, RSVP runs everywhere. CUST-B — R3 to R5 — was decommissioned last week.
        </p>
        <DiagramFrame caption="Top: 200 Mbps reservable. Bottom: R3–R5 has 600 Mbps unreserved, because CUST-B's tunnel still holds 400.">
          <FaultDiagram />
        </DiagramFrame>
        <CompareCards
          items={[
            { title: "What it is", tone: "danger", tag: "cause", points: ["CUST-B's tunnel on R3 still reserves 400 Mbps", "no path has 700 Mbps unreserved", "CSPF fails → no LSP → the video falls back to IS-IS over R2–R4"] },
            { title: "What it can't be", tone: "success", tag: "ruled out", points: ["links: all up", "IS-IS: R1 reaches 6.6.6.6", "RSVP: CUST-B is signaled fine"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="tl-investigate" eyebrow="Incident" title="Walk the evidence" tone="danger">
        <TroubleshootingFlow
          steps={[
            { question: "Is the LSP up?", look: "tunnel-te1: Oper down, PCALC error — no path to 6.6.6.6 (bw)." },
            { question: "Is every link in the TED?", look: "Yes, both directions — this isn't a topology problem." },
            { question: "Where is the bandwidth?", look: "R3–R5: 400 Mbps held by tunnel-te10 (CUST-B) — the customer that left." },
            { question: "Where does the video go now?", look: "R1's route to 10.6.6.0/24 is the IS-IS route via R2: over the busy link." },
          ]}
        />
        <CliPanel run={teOnly(TE_FAULT, "R1", "cisco", "show mpls traffic-eng tunnels 1", /Name:|Admin:|path option|PCALC|Info:|Bandwidth:/)} caption="IOS XR · R1 — down; CSPF finds no path" />
        <CliPanel run={teCli(TE_FAULT, "R3", "cisco", "show rsvp interface")} caption="IOS XR · R3 — 400M allocated toward R5 by CUST-B" />
        <CliPanel run={teCli(TE_FAULT, "R1", "cisco", "show route 10.6.6.20")} caption="IOS XR · R1 — the video is back on IS-IS, via R2" />
        <CliPanel run={teOnly(TE_FAULT_JN, "R1", "juniper", "show mpls lsp extensive", /^6\.6\.6\.6|State:|Bandwidth:|CSPF/)} caption="Junos · R1 — the same fault: CSPF failed: no route toward 6.6.6.6" />
      </GuideSection>

      <GuideSection id="tl-repair" eyebrow="Incident" title="Repair and prove it" tone="success">
        <p>The fix is the stale reservation, not the video tunnel: shut down (or remove) CUST-B&apos;s tunnel on R3.</p>
        <CliPair cisco={{ prompt: "RP/0/RP0/CPU0:R3(config)#", command: "interface tunnel-te10", output: "RP/0/RP0/CPU0:R3(config-if)#shutdown\nRP/0/RP0/CPU0:R3(config-if)#commit\nRP/0/RP0/CPU0:R3(config-if)#end" }} junos={{ prompt: "admin@R3# ", command: "set protocols mpls label-switched-path CUST-B disable", output: "\n[edit]\nadmin@R3# commit and-quit\ncommit complete\nExiting configuration mode" }} ciscoCaption="IOS XR · R3" junosCaption="Junos · R3" />
        <CliPanel run={teOnly(TE_FIXED, "R1", "cisco", "show mpls traffic-eng tunnels 1", /Name:|Admin:|path option|Bandwidth Requested|Strict/)} caption="IOS XR · R1 — up again, 700 Mbps over R3, R5" />
        <ChecklistCard tone="success" title="Proved, not assumed" mark="✓" items={["CUST-B's reservation is gone from R3–R5", "tunnel-te1 is up with 700 Mbps reserved", "a fresh 700 Mbps flow from CE1 is delivered through the tunnel"]} />
      </GuideSection>

      <GuideSection id="tl-other" eyebrow="Beyond this incident" title="Other ways RSVP-TE breaks" tone="warning">
        <FailureSignatures
          items={[
            { tag: "TED", title: "A link missing from the TED", tone: "danger", points: ["link up, IS-IS fine, LSP down", "an interface not configured for TE on one end"] },
            { tag: "ERO", title: "An impossible explicit path", tone: "warning", points: ["a strict hop that isn't adjacent", "no dynamic fallback configured"] },
            { tag: "AFF", title: "A color that no longer matches", tone: "violet", points: ["tunnel includes GOLD", "a link was recolored"] },
            { tag: "AR", title: "Up, reserved, unused", tone: "warning", points: ["no autoroute announce / shortcuts", "traffic still on the IS-IS path"] },
          ]}
        />
        <p className="text-sm text-pv-text-muted">Each is a ticket in the RSVP-TE Lab, together with this incident.</p>
      </GuideSection>

      <GuideSection id="tl-model" eyebrow="Mental model" title="Mental model" tone="cyan">
        <p>
          Think of booking a convoy route. The dispatcher (R1) looks at a shared map that shows every road&apos;s free capacity (the TED), crosses out the roads that are too full (CSPF), and sends a booking request down the chosen roads (PATH). Each checkpoint confirms on the way back and hands out a lane number (RESV with labels). The booking is real — but it is only a booking. Trucks still need directions to use it (autoroute), and a road that is physically full stays full whatever the bookings say.
        </p>
        <Callout tone="cyan" title="When it breaks, ask in this order" icon="→">
          Is the LSP up, and why not (the headend&apos;s CSPF error)? Is every link in the TED, both ways? Who holds the bandwidth on the links that matter? Do the constraints (colors, explicit hops) leave a path? Is traffic routed into the tunnel? Does a fresh flow get through?
        </Callout>
      </GuideSection>

      <GuideSection id="tl-glossary" eyebrow="Reference" title="Glossary" tone="cyan">
        <Glossary
          items={[
            { term: "TED", def: "Traffic Engineering Database: every TE link with its TE metric, reservable and unreserved bandwidth and colors, flooded by IS-IS." },
            { term: "CSPF", def: "Constrained SPF: prune what can't carry the LSP, then shortest path on the rest." },
            { term: "ERO / RRO", def: "Explicit Route Object (the hops PATH must follow) / Record Route Object (the hops actually signaled)." },
            { term: "PATH / RESV", def: "RSVP messages: PATH travels downstream with the request, RESV upstream with labels and reservations." },
            { term: "Headend / tailend", def: "The router that computes and signals the LSP / the router where it ends." },
            { term: "Setup / hold priority", def: "0 best, 7 worst: a better setup priority can preempt LSPs with a worse hold priority." },
            { term: "Autoroute announce", def: "IOS XR: IS-IS uses the tunnel for the tail and what is behind it (Junos: IS-IS shortcuts)." },
          ]}
        />
      </GuideSection>

      <GuideSection id="tl-recap" eyebrow="Reference" title="Recap" tone="success">
        <ChecklistCard tone="success" title="You can now" mark="✓" items={["explain why the shortest path can be the wrong one", "read the TED and follow CSPF", "follow PATH and RESV and name who picks each label", "route traffic into a tunnel", "find a stale reservation behind an LSP that won't come up — and prove the fix"]} />
      </GuideSection>

      <GuideSection id="tl-practice" eyebrow="Next" title="Practice it" tone="violet">
        <p>The Deep Dive tab covers RSVP-TE in full: the RSVP objects, admission control and soft state, priorities and preemption, make-before-break, explicit paths and affinities, metrics, autoroute and forwarding adjacencies, IOS XR and Junos configuration, and every failure signature with real evidence. The lab lets you operate it.</p>
        <LessonLabBridge />
        <PresentationBridge>Rewatch the RSVP-TE presentation.</PresentationBridge>
      </GuideSection>
    </div>
  );
}
