import { Callout, ChecklistCard, CompareCards, DIAGRAM as D, DPill, DiagramFrame, DiagramSvg, FieldTable, FlowSteps, Glossary, GuideSection, Mono } from "@/components/lesson/GuideBlocks";
import { DStack } from "@/components/lesson/MplsGuideSvg";
import { SrTopology, type SrLink } from "@/components/lesson/SrGuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";

export const TILFA_LESSON_SECTIONS: LessonGuideSectionLink[] = [
  { id: "tl-mission", label: "The mission" },
  { id: "tl-topology", label: "Primary path" },
  { id: "tl-protect", label: "Protected resource and PLR" },
  { id: "tl-noprot", label: "Without protection" },
  { id: "tl-pq", label: "Post-convergence, P and Q" },
  { id: "tl-list", label: "The repair segment list" },
  { id: "tl-ready", label: "READY is not active" },
  { id: "tl-repair", label: "Local repair on the wire" },
  { id: "tl-converge", label: "Local repair vs convergence" },
  { id: "tl-node", label: "Node protection" },
  { id: "tl-limits", label: "When protection is unavailable" },
  { id: "tl-stale", label: "The stale-repair incident" },
  { id: "tl-mistakes", label: "Common mistakes" },
  { id: "tl-challenge", label: "The engineer challenge" },
  { id: "tl-glossary", label: "Glossary" },
  { id: "tl-recap", label: "Mental model" },
];

const LINKS: SrLink[] = [
  { a: "R1", b: "R2", label: "10" },
  { a: "R2", b: "R4", label: "10" },
  { a: "R4", b: "R6", label: "10" },
  { a: "R2", b: "R3", label: "15" },
  { a: "R3", b: "R5", label: "15" },
  { a: "R5", b: "R6", label: "15" },
];

function PrimaryDiagram() {
  const primary = new Set(["R1-R2", "R2-R4", "R4-R6"]);
  return (
    <DiagramSvg h={240} label="Primary path R1 R2 R4 R6 with metric 10 links; R2 is the local repair point for the protected R2-R4 link">
      <SrTopology
        links={LINKS.map((l) => {
          const id = `${l.a}-${l.b}`;
          if (id === "R2-R4") return { ...l, color: D.warning, bold: true, label: "10 · protected" };
          return primary.has(id) ? { ...l, color: D.success, bold: true } : l;
        })}
        sub={{ R1: "headend", R2: "PLR", R6: "destination" }}
        accent={{ R1: D.mpls, R2: D.warning, R6: D.mpls }}
      />
      <text x={320} y={228} textAnchor="middle" fill={D.muted} fontSize={10}>
        primary R1 → R2 → R4 → R6 (cost 30); R1 only connects to R2
      </text>
    </DiagramSvg>
  );
}

function PqDiagram() {
  return (
    <DiagramSvg h={240} label="For the R2-R4 link, P-space from R2 is R1 R3 R5, Q-space toward R6 is R3 R4 R5, and R5 is the selected PQ repair point">
      <SrTopology
        links={LINKS.map((l) => (`${l.a}-${l.b}` === "R2-R4" ? { ...l, color: D.danger, dashed: true, label: "protected" } : l))}
        sub={{ R1: "P", R2: "PLR", R3: "P ∩ Q", R4: "Q", R5: "P ∩ Q ✓", R6: "dest" }}
        accent={{ R1: D.cyan, R3: D.violet, R4: D.warning, R5: D.success }}
      />
      <text x={320} y={228} textAnchor="middle" fill={D.muted} fontSize={10}>
        P = {"{R1, R3, R5}"} · Q = {"{R3, R4, R5}"} · repair point = R5 (PQ closest to R6)
      </text>
    </DiagramSvg>
  );
}

function RepairWireDiagram() {
  const cols = [
    { x: 120, head: "R2 → R3", labels: [{ text: "16005 S0", color: D.warning, tag: "REPAIR" }, { text: "16006 S1", tag: "ORIGINAL" }], note: "R2 pushes the repair" },
    { x: 330, head: "R3 → R5", labels: [{ text: "16005 S0", color: D.warning }, { text: "16006 S1" }], note: "R3: transit for R5's SID" },
    { x: 530, head: "R5 → R6", labels: [{ text: "16006 S1" }], note: "R5 completed 16005" },
  ];
  return (
    <DiagramSvg h={180} label="R2 pushes R5's Node SID 16005 on top of the original 16006; R3 forwards 16005 unchanged toward R5; R5 completes it and forwards 16006 to R6">
      {cols.map((c) => (
        <g key={c.head}>
          <text x={c.x} y={20} textAnchor="middle" fill={D.text} fontSize={11.5} fontWeight={700}>
            {c.head}
          </text>
          <DStack x={c.x} y={32} labels={c.labels} payload="IP" w={96} />
          <text x={c.x} y={128} textAnchor="middle" fill={D.muted} fontSize={9.5}>
            {c.note}
          </text>
        </g>
      ))}
      <text x={320} y={170} textAnchor="middle" fill={D.muted} fontSize={10}>
        no PHP is modeled in this lesson: R6 receives 16006 and completes it itself
      </text>
    </DiagramSvg>
  );
}

function StaleDiagram() {
  return (
    <DiagramSvg h={200} label="After R2-R3 becomes 25, R2's shortest path to R5 goes through R2-R4, so R5 is no longer in P-space and the old repair via R5 fails; R3 is still reachable safely">
      <rect x={20} y={20} width={290} height={140} rx={12} fill={D.box} stroke={D.danger} strokeOpacity={0.7} />
      <text x={36} y={42} fill={D.danger} fontSize={11.5} fontWeight={700}>
        Old repair (computed at R2-R3 = 15)
      </text>
      <text x={36} y={66} fill={D.text} fontSize={10.5} fontFamily="monospace">
        push 16005 (R5)
      </text>
      <text x={36} y={88} fill={D.muted} fontSize={10}>
        R2 → R5 now: via R2-R4 = 35
      </text>
      <text x={36} y={106} fill={D.muted} fontSize={10}>
        via R2-R3-R5 = 40
      </text>
      <text x={36} y={130} fill={D.danger} fontSize={10.5} fontWeight={700}>
        R5 left P-space → repair fails
      </text>
      <rect x={330} y={20} width={290} height={140} rx={12} fill={D.box} stroke={D.success} strokeOpacity={0.7} />
      <text x={346} y={42} fill={D.success} fontSize={11.5} fontWeight={700}>
        Against the current topology
      </text>
      <text x={346} y={66} fill={D.text} fontSize={10.5} fontFamily="monospace">
        repair point R3 → 16003
      </text>
      <text x={346} y={88} fill={D.muted} fontSize={10}>
        R2 → R3 direct = 25 (no R2-R4)
      </text>
      <text x={346} y={106} fill={D.muted} fontSize={10}>
        R3 → R6 via R5 = 30
      </text>
      <text x={346} y={130} fill={D.success} fontSize={10.5} fontWeight={700}>
        16003 S0 / 16006 S1
      </text>
      <text x={320} y={188} textAnchor="middle" fill={D.muted} fontSize={10}>
        the primary path never used R2-R3, so nothing looked broken until the failure
      </text>
    </DiagramSvg>
  );
}

function NodeProtectionDiagram() {
  return (
    <DiagramSvg h={240} label="Node protection excludes R4 entirely; in this topology the repair still goes via R5 because R2's path to R5 never touched R4">
      <SrTopology
        links={LINKS.map((l) => {
          const id = `${l.a}-${l.b}`;
          if (id === "R2-R4" || id === "R4-R6") return { ...l, color: D.danger, dashed: true };
          if (id === "R2-R3" || id === "R3-R5") return { ...l, color: D.warning, bold: true };
          return l;
        })}
        sub={{ R2: "PLR", R4: "protected node", R5: "repair point" }}
        accent={{ R2: D.warning, R4: D.danger, R5: D.success }}
        dim={["R4"]}
      />
      <DPill x={320} y={222} text="repair stack still 16005 S0 / 16006 S1" color={D.warning} w={260} />
    </DiagramSvg>
  );
}

export function TiLfaLessonGuideContent() {
  return (
    <>
      <GuideSection id="tl-mission" eyebrow="Introduction" title="The mission: repair locally, instantly" tone="mpls">
        <p>RSVP-TE FRR protects with a pre-signaled bypass tunnel. TI-LFA protects with SR instructions the local repair point computes itself from the topology — nothing is signaled in advance, and the headend is not involved in the repair.</p>
        <Callout tone="cyan" title="Scope of this simulation" icon="i">
          SRGB 16000 + index, as in SR-MPLS Foundations. This lesson models no PHP: every Node SID travels to its target, which completes it. Link-down detection is deterministic and local; no universal recovery time is claimed.
        </Callout>
      </GuideSection>

      <GuideSection id="tl-topology" eyebrow="Setup" title="Primary path" tone="ospf">
        <DiagramFrame caption="Numbers are IGP metrics. Green is the primary path.">
          <PrimaryDiagram />
        </DiagramFrame>
        <p>
          R1 pushes <Mono>16006</Mono> (R6&apos;s Node SID, 16000 + 6). R2 and R4 forward it along their own shortest paths and R6 completes it.
        </p>
      </GuideSection>

      <GuideSection id="tl-protect" eyebrow="Protection" title="Protected resource and PLR" tone="warning">
        <p>The first protected resource is the R2-R4 link. The router directly upstream of it — R2 — is the point of local repair (PLR). The headend R1 is not the repair point and never learns that a repair happened.</p>
      </GuideSection>

      <GuideSection id="tl-noprot" eyebrow="Protection" title="Without protection" tone="danger">
        <p>With nothing precomputed, R2 has no substitute next hop when R2-R4 fails, so in-flight traffic waits for global convergence: IGP flooding, SPF everywhere, and new forwarding state. That wait is exactly what local repair removes.</p>
      </GuideSection>

      <GuideSection id="tl-pq" eyebrow="Computation" title="Post-convergence, P and Q" tone="violet">
        <DiagramFrame caption="Computed by the domain layer from real shortest paths, not hand-picked.">
          <PqDiagram />
        </DiagramFrame>
        <FlowSteps
          steps={[
            { title: "Post-convergence path", body: "R2's shortest path to R6 with R2-R4 removed: R2 → R3 → R5 → R6.", tone: "violet" },
            { title: "P-Space (from R2)", body: "Nodes R2 reaches without its shortest path crossing R2-R4: R1, R3, R5.", tone: "cyan" },
            { title: "Q-Space (toward R6)", body: "Nodes whose own shortest path to R6 avoids R2-R4: R3, R4, R5.", tone: "warning" },
            { title: "Repair point", body: "P ∩ Q = R3, R5; the one closest to the destination is R5.", tone: "success" },
          ]}
        />
      </GuideSection>

      <GuideSection id="tl-list" eyebrow="Computation" title="The repair segment list" tone="mpls">
        <p>
          The list extends a Node SID as far as the path already matches and only falls back to an Adj-SID where it doesn&apos;t. R2&apos;s own shortest path to R5 is R2 → R3 → R5, so one Node SID, <Mono>16005</Mono>, is enough here. The lesson&apos;s separate multi-SID example shows a case that needs a Node SID plus an Adj-SID.
        </p>
      </GuideSection>

      <GuideSection id="tl-ready" eyebrow="State" title="READY is not active" tone="success">
        <p>READY means the repair is computed and installed at R2. Until R2-R4 actually fails, traffic keeps using the primary path and the repair carries nothing. R1 pushes exactly the same <Mono>16006</Mono> as before.</p>
      </GuideSection>

      <GuideSection id="tl-repair" eyebrow="Data plane" title="Local repair on the wire" tone="mpls">
        <FieldTable
          title="Repair stack at R2 (top first)"
          accent="mpls"
          columns={["Position", "Label", "Meaning", "S"]}
          rows={[
            ["TOP · repair", <Mono key="a">16005</Mono>, "R5 Node SID — the repair segment", "0"],
            ["BOTTOM · original", <Mono key="b">16006</Mono>, "R6 Node SID — the original instruction", "1"],
          ]}
        />
        <DiagramFrame caption="The repair SID sits on top of the original; the original survives underneath.">
          <RepairWireDiagram />
        </DiagramFrame>
        <p>R3 is ordinary SR transit: the active SID is R5&apos;s <Mono>16005</Mono>, so R3 forwards it unchanged toward R5 without knowing a repair happened. R5 is the repair segment&apos;s target and completes it; <Mono>16006</Mono> becomes active again and ordinary forwarding resumes.</p>
      </GuideSection>

      <GuideSection id="tl-converge" eyebrow="Timeline" title="Local repair vs convergence" tone="cyan">
        <CompareCards
          items={[
            { title: "Local repair", tone: "success", tag: "R2, immediately", points: ["Detect R2-R4 down locally", "Push the precomputed repair", "Traffic continues"] },
            { title: "Global convergence", tone: "violet", tag: "everyone, later", points: ["IGP floods the failure", "Every router runs SPF", "R2's own path to R6 becomes R2 → R3 → R5 → R6", "Repair labels are no longer needed"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="tl-node" eyebrow="Protection" title="Node protection" tone="violet">
        <DiagramFrame caption="Node protection is a stronger constraint, computed independently.">
          <NodeProtectionDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="tl-limits" eyebrow="Protection" title="When protection is unavailable" tone="warning">
        <p>Failing R3-R5 — a link the repair depends on — leaves the primary UP but protection UNAVAILABLE. Failing R2-R4 and R3-R5 together leaves no surviving path at all: no local-repair method can create connectivity that does not exist.</p>
      </GuideSection>

      <GuideSection id="tl-stale" eyebrow="Troubleshooting" title="The stale-repair incident" tone="danger">
        <DiagramFrame caption="Metric change R2-R3: 15 → 25, elsewhere in the network.">
          <StaleDiagram />
        </DiagramFrame>
        <ChecklistCard
          tone="danger"
          title="How to reason about it"
          mark="→"
          items={["The primary path and forwarding are healthy — the failure is in protection.", "Ask which topology the installed repair was computed against.", "Recheck P-Space: is the repair point still reachable without the protected link?", "After any fix, fail R2-R4 again and follow a real packet."]}
        />
      </GuideSection>

      <GuideSection id="tl-mistakes" eyebrow="Troubleshooting" title="Common mistakes" tone="warning">
        <ChecklistCard tone="warning" title="Avoid these" mark="!" items={["Thinking the headend performs the repair.", "Treating READY as carrying traffic.", "Assuming every repair is one Node SID.", "Forgetting the original SID stays underneath the repair SID.", "Believing a repair stays correct after unrelated metric changes."]} />
      </GuideSection>

      <GuideSection id="tl-challenge" eyebrow="Challenge" title="The engineer challenge" tone="violet">
        <p>Protect R1 → R6 against both an R2-R4 link failure and a complete R4 node failure. The checklist replays everything you inspected: the PLR, the post-convergence SPF, P and Q, the repair list, READY, the repair stack, and convergence.</p>
      </GuideSection>

      <GuideSection id="tl-glossary" eyebrow="Reference" title="Glossary" tone="cyan">
        <Glossary
          items={[
            { term: "TI-LFA", def: "Topology-Independent Loop-Free Alternate — local repair expressed as SR segments." },
            { term: "PLR", def: "Point of local repair; the router just upstream of the protected resource (R2)." },
            { term: "Post-convergence path", def: "The path SPF will choose once the failure is known everywhere." },
            { term: "P-Space", def: "Nodes the PLR reaches without crossing the protected resource." },
            { term: "Q-Space", def: "Nodes that reach the destination without crossing it." },
            { term: "PQ node", def: "A node in both; a safe repair point." },
            { term: "Repair segment", def: "The SID(s) the PLR pushes on top of the original instruction." },
          ]}
        />
      </GuideSection>

      <GuideSection id="tl-recap" eyebrow="Recap" title="Mental model" tone="success">
        <Callout tone="success" title="One sentence" icon="✓">
          Before anything fails, the PLR computes where the network will converge and which safe point gets it there; when the link fails it pushes that point&apos;s SID on top of the original instruction — until global convergence makes the repair unnecessary.
        </Callout>
      </GuideSection>
    </>
  );
}
