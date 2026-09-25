import { Callout, ChecklistCard, CompareCards, DIAGRAM as D, DLink, DNode, DPill, DiagramFrame, DiagramSvg, FieldTable, FlowSteps, Glossary, GuideSection, Mono } from "@/components/lesson/GuideBlocks";
import { DStack } from "@/components/lesson/MplsGuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";

export const FRR_LESSON_SECTIONS: LessonGuideSectionLink[] = [
  { id: "fl-mission", label: "The mission" },
  { id: "fl-topology", label: "Topology & primary LSP" },
  { id: "fl-noprot", label: "Without protection" },
  { id: "fl-roles", label: "PLR, Merge Point, bypass" },
  { id: "fl-ready", label: "Protection READY" },
  { id: "fl-repair", label: "Local repair" },
  { id: "fl-stack", label: "The repair stack" },
  { id: "fl-reopt", label: "Reoptimization" },
  { id: "fl-node", label: "Link vs node protection" },
  { id: "fl-nodestack", label: "Node-repair stack" },
  { id: "fl-bypassfail", label: "When the bypass fails" },
  { id: "fl-planes", label: "Control vs data plane" },
  { id: "fl-fault", label: "The incident" },
  { id: "fl-glossary", label: "Glossary" },
  { id: "fl-recap", label: "Mental model" },
];

const P: Record<string, [number, number]> = { R1: [60, 60], R3: [190, 60], R5: [330, 60], R7: [470, 60], R6: [590, 60], R4: [330, 165] };

function Net({ failedLink, failedNode, bypass, primaryColor = D.success }: { failedLink?: boolean; failedNode?: boolean; bypass?: "link" | "node"; primaryColor?: string }) {
  const prim: [string, string][] = [
    ["R1", "R3"],
    ["R3", "R5"],
    ["R5", "R7"],
    ["R7", "R6"],
  ];
  const side: [string, string][] = [
    ["R3", "R4"],
    ["R4", "R5"],
    ["R4", "R7"],
  ];
  const onBypass = (a: string, b: string) => (bypass === "link" ? (a === "R3" && b === "R4") || (a === "R4" && b === "R5") : bypass === "node" ? (a === "R3" && b === "R4") || (a === "R4" && b === "R7") : false);
  return (
    <>
      {prim.map(([a, b]) => {
        const down = (failedLink && a === "R3" && b === "R5") || (failedNode && (a === "R5" || b === "R5"));
        return <DLink key={a + b} x1={P[a][0]} y1={P[a][1]} x2={P[b][0]} y2={P[b][1]} color={down ? D.danger : primaryColor} dashed={down} />;
      })}
      {side.map(([a, b]) => (
        <DLink key={a + b} x1={P[a][0]} y1={P[a][1]} x2={P[b][0]} y2={P[b][1]} color={onBypass(a, b) ? D.warning : D.line} dashed={failedNode && (a === "R5" || b === "R5")} />
      ))}
      {failedLink && (
        <text x={260} y={52} textAnchor="middle" fill={D.danger} fontSize={18} fontWeight={700}>
          ✕
        </text>
      )}
      {Object.entries(P).map(([id, [x, y]]) => (
        <DNode key={id} x={x} y={y} label={id} sub={id === "R1" ? "headend" : id === "R6" ? "tailend" : undefined} accent={failedNode && id === "R5" ? D.danger : D.mpls} w={id === "R1" || id === "R6" ? 84 : 60} h={id === "R1" || id === "R6" ? 42 : 34} />
      ))}
    </>
  );
}

function TopologyDiagram() {
  return (
    <DiagramSvg h={210} label="Primary LSP R1-R3-R5-R7-R6 with labels 400, 300, 200; R4 sits below with links to R3, R5 and R7">
      <Net />
      <text x={125} y={36} textAnchor="middle" fill={D.success} fontSize={10} fontWeight={700}>
        400
      </text>
      <text x={260} y={36} textAnchor="middle" fill={D.success} fontSize={10} fontWeight={700}>
        300
      </text>
      <text x={400} y={36} textAnchor="middle" fill={D.success} fontSize={10} fontWeight={700}>
        200
      </text>
      <text x={530} y={36} textAnchor="middle" fill={D.success} fontSize={10} fontWeight={700}>
        IP (PHP)
      </text>
      <text x={320} y={204} textAnchor="middle" fill={D.muted} fontSize={10}>
        green = RSVP-PRIMARY, 500 Mbps · numbers = label on each primary link
      </text>
    </DiagramSvg>
  );
}

function RolesDiagram() {
  return (
    <DiagramSvg h={210} label="R3 is the PLR, R3-R5 the protected link, R5 the Merge Point, R3-R4-R5 the bypass">
      <Net failedLink bypass="link" />
      <DPill x={190} y={112} text="PLR" color={D.warning} w={56} />
      <DPill x={400} y={112} text="Merge Point" color={D.violet} w={96} />
      <DPill x={200} y={186} text="bypass R3 → R4 → R5" color={D.warning} w={150} />
      <text x={260} y={30} textAnchor="middle" fill={D.danger} fontSize={10} fontWeight={700}>
        protected link
      </text>
    </DiagramSvg>
  );
}

function RepairStackDiagram() {
  const cols: [number, string, { text: string; tag?: string; color?: string }[]][] = [
    [90, "R1 → R3", [{ text: "400 S1" }]],
    [220, "R3 → R4 (repair)", [{ text: "1000 S0", tag: "OUTER", color: D.warning }, { text: "300 S1", tag: "INNER" }]],
    [360, "R4 → R5", [{ text: "300 S1", tag: "INNER" }]],
    [480, "R5 → R7", [{ text: "200 S1" }]],
    [590, "R7 → R6", []],
  ];
  return (
    <DiagramSvg h={170} label="R1 to R3: 400 S1. R3 to R4: bypass 1000 S0 over protected 300 S1. R4 to R5: 300 S1. R5 to R7: 200 S1. R7 to R6: plain IP">
      {cols.map(([x, t, labels]) => (
        <g key={t}>
          <text x={x} y={20} textAnchor="middle" fill={t.includes("repair") ? D.warning : D.muted} fontSize={9.5} fontWeight={700}>
            {t}
          </text>
          <DStack x={x} y={32} labels={labels} w={78} />
        </g>
      ))}
      <text x={320} y={150} textAnchor="middle" fill={D.muted} fontSize={10}>
        Outer = bypass label (R4 pops it, PHP) · Inner = the label R5 already expects · only the bottom has S=1
      </text>
    </DiagramSvg>
  );
}

function NodeDiagram() {
  return (
    <DiagramSvg h={210} label="R5 fails entirely; the node-protecting bypass R3-R4-R7 skips it and merges at R7">
      <Net failedNode bypass="node" />
      <DPill x={190} y={112} text="PLR" color={D.warning} w={56} />
      <DPill x={540} y={112} text="Merge Point" color={D.violet} w={96} />
      <DPill x={200} y={186} text="bypass R3 → R4 → R7" color={D.warning} w={150} />
      <text x={330} y={30} textAnchor="middle" fill={D.danger} fontSize={10} fontWeight={700}>
        protected node
      </text>
    </DiagramSvg>
  );
}

function NodeStackDiagram() {
  const cols: [number, string, { text: string; tag?: string; color?: string }[]][] = [
    [110, "R1 → R3", [{ text: "400 S1" }]],
    [260, "R3 → R4 (repair)", [{ text: "1020 S0", tag: "OUTER", color: D.warning }, { text: "200 S1", tag: "INNER" }]],
    [410, "R4 → R7", [{ text: "200 S1", tag: "INNER" }]],
    [550, "R7 → R6", []],
  ];
  return (
    <DiagramSvg h={170} label="Node repair: bypass 1020 S0 over 200 S1, the label R7 expects; R4 pops the outer; R7 pops for PHP">
      {cols.map(([x, t, labels]) => (
        <g key={t}>
          <text x={x} y={20} textAnchor="middle" fill={t.includes("repair") ? D.warning : D.muted} fontSize={9.5} fontWeight={700}>
            {t}
          </text>
          <DStack x={x} y={32} labels={labels} w={78} />
        </g>
      ))}
      <text x={320} y={150} textAnchor="middle" fill={D.muted} fontSize={10}>
        the inner label skips R5&apos;s swap: it&apos;s the label R7 (the new Merge Point) expects
      </text>
    </DiagramSvg>
  );
}

function TimelineDiagram() {
  const ev: [number, string, string][] = [
    [80, "failure", D.danger],
    [220, "PLR detects", D.warning],
    [360, "local repair", D.warning],
    [500, "headend reoptimizes", D.violet],
  ];
  return (
    <DiagramSvg h={120} label="Failure, detection at the PLR, local repair, then later headend reoptimization">
      <line x1={40} y1={50} x2={600} y2={50} stroke={D.line} strokeWidth={2} />
      {ev.map(([x, t, c]) => (
        <g key={t}>
          <circle cx={x} cy={50} r={7} fill={c} />
          <text x={x} y={80} textAnchor="middle" fill={c} fontSize={10.5} fontWeight={700}>
            {t}
          </text>
        </g>
      ))}
      <text x={290} y={30} textAnchor="middle" fill={D.warning} fontSize={10}>
        local, no signaling needed
      </text>
      <text x={500} y={104} textAnchor="middle" fill={D.muted} fontSize={10}>
        later: new end-to-end LSP
      </text>
    </DiagramSvg>
  );
}

export function FrrLessonGuideContent() {
  return (
    <>
      <GuideSection id="fl-mission" eyebrow="Introduction" title="The mission: survive a failure without waiting for the headend" tone="mpls">
        <p>
          RSVP-PRIMARY carries 500 Mbps from R1 to R6. When a link or router on it fails, end-to-end recovery (the headend recomputing and re-signaling) takes time. <b className="text-pv-text">Fast Reroute</b> prepares a local detour <i>before</i> the failure so the router next to it can switch immediately.
        </p>
        <Callout tone="cyan" title="Scope of this simulation" icon="i">
          Facility backup (bypass tunnels) with link and node protection, one primary LSP. Detection is a deterministic local link-down. BFD, timing numbers and one-to-one backup are described, not simulated. The FRR lifecycle names are a PacketVerse teaching abstraction.
        </Callout>
      </GuideSection>

      <GuideSection id="fl-topology" eyebrow="Setup" title="Topology and the primary LSP" tone="cyan">
        <DiagramFrame caption="R4 isn't on the primary path; it exists to provide detours.">
          <TopologyDiagram />
        </DiagramFrame>
        <FieldTable
          title="Primary LSP forwarding (normal)"
          accent="mpls"
          columns={["Router", "In", "Action", "Out"]}
          rows={[
            ["R1", "IP", "PUSH", <Mono key="a">400</Mono>],
            ["R3", <Mono key="b">400</Mono>, "SWAP", <Mono key="c">300</Mono>],
            ["R5", <Mono key="d">300</Mono>, "SWAP", <Mono key="e">200</Mono>],
            ["R7", <Mono key="f">200</Mono>, "POP (PHP)", "IP → R6"],
          ]}
        />
      </GuideSection>

      <GuideSection id="fl-noprot" eyebrow="Baseline" title="Without protection" tone="danger">
        <FlowSteps
          steps={[
            { title: "R3-R5 fails", body: "R3's next hop on the LSP is gone and R3 has nothing prepared.", tone: "danger" },
            { title: "Traffic is dropped", body: "Packets arriving at R3 for the LSP have nowhere to go.", tone: "danger" },
            { title: "Headend recovery", body: "R1 eventually learns of the failure, re-runs CSPF and re-signals PATH/RESV. Real recovery, but not instant.", tone: "warning" },
          ]}
        />
      </GuideSection>

      <GuideSection id="fl-roles" eyebrow="Concepts" title="PLR, Merge Point and bypass" tone="violet">
        <DiagramFrame caption="Link protection of R3-R5.">
          <RolesDiagram />
        </DiagramFrame>
        <FieldTable
          title="Four core terms"
          accent="violet"
          columns={["Term", "In this lesson (link protection)"]}
          rows={[
            ["Protected resource", "The R3-R5 link"],
            ["PLR (Point of Local Repair)", "R3: attached to the resource, detects the failure, activates repair"],
            ["Merge Point (MP)", "R5: where the detour rejoins RSVP-PRIMARY"],
            ["Bypass tunnel", "R3 → R4 → R5: a separate, pre-signaled RSVP LSP"],
          ]}
        />
        <Callout tone="warning" title="PLR ≠ headend, MP ≠ tailend" icon="!">
          The PLR is whichever router sits next to the protected resource, very often not the headend.
        </Callout>
      </GuideSection>

      <GuideSection id="fl-ready" eyebrow="Control plane" title="Protection READY" tone="mpls">
        <FlowSteps
          steps={[
            { title: "Compute", body: "R3 finds a bypass path that avoids the R3-R5 link itself: R3 → R4 → R5.", tone: "violet" },
            { title: "Signal", body: "Signaled like any small RSVP LSP: R5 advertises implicit-null to R4, R4 advertises label 1000 to R3.", tone: "mpls" },
            { title: "Reserve", body: "500 Mbps is reserved on R3-R4 and R4-R5, yet 0 Mbps of customer traffic flows on it.", tone: "warning" },
            { title: "READY", body: "Normal traffic still uses the primary path. R1 doesn't even know the bypass exists.", tone: "success" },
          ]}
        />
      </GuideSection>

      <GuideSection id="fl-repair" eyebrow="Failure" title="Local repair" tone="warning">
        <DiagramFrame caption="Local repair comes first; reoptimization comes later, separately.">
          <TimelineDiagram />
        </DiagramFrame>
        <p>
          R3 detects the link-down locally, finds the bypass already associated with that exact resource and already READY, and starts using it. No CSPF runs and no message goes to R1 first.
        </p>
      </GuideSection>

      <GuideSection id="fl-stack" eyebrow="Data plane" title="The repair stack" tone="mpls">
        <p>
          At R3, a repaired packet gets <b className="text-pv-text">two</b> operations: SWAP 400 → 300 (the label R5 already expects), then PUSH the bypass label on top.
        </p>
        <DiagramFrame caption="FRR Repair · Outer: bypass label · Inner: protected LSP label.">
          <RepairStackDiagram />
        </DiagramFrame>
        <FieldTable
          title="Who acts on what"
          accent="mpls"
          columns={["Router", "Acts on", "Result"]}
          rows={[
            ["R1", "IP", "PUSH 400: unaware of the failure"],
            ["R3 (PLR)", "400", <Mono key="a">SWAP 300 + PUSH 1000 → 1000 S0 / 300 S1</Mono>],
            ["R4", "outer 1000 only", "POP (bypass PHP): 300 S1 continues"],
            ["R5 (MP)", "300", "Ordinary SWAP 300 → 200, as if nothing happened"],
          ]}
        />
      </GuideSection>

      <GuideSection id="fl-reopt" eyebrow="After repair" title="Reoptimization" tone="violet">
        <p>
          FRR is a bridge, not the destination. R1 later learns the topology changed, runs CSPF for a new end-to-end path avoiding the failure, and re-signals it. Once that LSP is UP, the detour is no longer why traffic arrives.
        </p>
      </GuideSection>

      <GuideSection id="fl-node" eyebrow="Protection types" title="Link vs node protection" tone="danger">
        <DiagramFrame caption="Node protection: the bypass must avoid the router, and merges at the hop after it.">
          <NodeDiagram />
        </DiagramFrame>
        <CompareCards
          items={[
            { title: "Link protection", tone: "warning", tag: "R3-R5", points: ["Bypass R3 → R4 → R5", "Merge Point R5", "Survives the R3-R5 link failing"] },
            { title: "Node protection", tone: "danger", tag: "R5", points: ["Bypass R3 → R4 → R7", "Merge Point R7 (next-next hop)", "Survives R3-R5 or all of R5 failing"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="fl-nodestack" eyebrow="Data plane" title="The node-repair stack" tone="mpls">
        <DiagramFrame caption="R3 must use the label R7 expects, because R5 won't be there to swap.">
          <NodeStackDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="fl-bypassfail" eyebrow="Operations" title="When the bypass itself fails" tone="warning">
        <p>
          If R4-R7 (part of the node bypass, not the primary) fails, RSVP-PRIMARY keeps forwarding normally. What&apos;s lost is <b className="text-pv-text">protection</b>, not service: the LSP is UP but UNPROTECTED until the bypass recovers.
        </p>
      </GuideSection>

      <GuideSection id="fl-planes" eyebrow="Big picture" title="Control plane vs data plane" tone="violet">
        <CompareCards
          items={[
            { title: "Control plane", tone: "violet", tag: "before failure", points: ["Compute the bypass path", "Signal it: labels + reservation", "Associate it with the protected resource", "Later: headend reoptimization"] },
            { title: "Data plane", tone: "success", tag: "at failure", points: ["PLR swaps + pushes the bypass label", "Bypass transit acts on the outer label only", "MP resumes ordinary forwarding"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="fl-fault" eyebrow="Troubleshooting" title="The incident" tone="danger">
        <p>
          RSVP-PRIMARY was UP and FRR was reported READY. After the loss of router R5, traffic didn&apos;t recover locally, even though R3, R4 and R7 are all reachable.
        </p>
        <ChecklistCard
          tone="danger"
          mark="→"
          title="How to reason about it (no spoilers)"
          items={["What resource actually failed: a link or a whole router?", "What resource was the existing bypass built to protect?", "Where does that bypass end, and is that router still alive?", "Pick the fix that makes protection match the failure."]}
        />
      </GuideSection>

      <GuideSection id="fl-glossary" eyebrow="Reference" title="Glossary" tone="cyan">
        <Glossary
          items={[
            { term: "FRR", def: "Fast Reroute: local protection pre-established before a failure." },
            { term: "PLR", def: "Point of Local Repair: detects the failure and redirects into the bypass." },
            { term: "Merge Point", def: "Where bypass traffic rejoins the protected LSP." },
            { term: "Bypass tunnel", def: "Pre-signaled RSVP LSP around one resource (facility backup)." },
            { term: "Link protection", def: "Bypass avoids one link; MP = next hop." },
            { term: "Node protection", def: "Bypass avoids a router; MP = next-next hop." },
            { term: "Repair stack", def: "Outer bypass label (S=0) over the inner protected-LSP label (S=1)." },
            { term: "Reoptimization", def: "Headend later moves the LSP to a new end-to-end path." },
          ]}
        />
      </GuideSection>

      <GuideSection id="fl-recap" eyebrow="Recap" title="Mental model" tone="mpls">
        <div className="rounded-2xl border border-pv-mpls/30 bg-gradient-to-br from-pv-mpls/10 to-pv-violet/5 p-5 text-sm leading-relaxed text-pv-text">
          FRR is a detour sign put up before the road closes. The PLR, next to the protected resource, swaps to the label the Merge Point expects, pushes the bypass label on top, and lets the bypass carry it around. The Merge Point never notices. Link protection merges at the next hop, node protection at the one after. The headend cleans up later.
        </div>
      </GuideSection>
    </>
  );
}
