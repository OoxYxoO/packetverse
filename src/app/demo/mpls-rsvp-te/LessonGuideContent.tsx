import { Callout, ChecklistCard, CompareCards, DArrow, DIAGRAM as D, DLink, DNode, DPill, DiagramFrame, DiagramSvg, FieldTable, FlowSteps, Glossary, GuideSection, Mono } from "@/components/lesson/GuideBlocks";
import { DStack } from "@/components/lesson/MplsGuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";

export const RSVP_TE_LESSON_SECTIONS: LessonGuideSectionLink[] = [
  { id: "rl-mission", label: "The mission" },
  { id: "rl-topology", label: "Topology, metrics, bandwidth" },
  { id: "rl-question", label: "Shortest vs constrained" },
  { id: "rl-ted", label: "The TE database" },
  { id: "rl-cspf", label: "CSPF: prune, then SPF" },
  { id: "rl-ero", label: "ERO (and RRO)" },
  { id: "rl-signal", label: "PATH down, RESV up" },
  { id: "rl-labels", label: "Labels RESV installs" },
  { id: "rl-data", label: "Real traffic" },
  { id: "rl-planes", label: "Control vs data plane" },
  { id: "rl-lab", label: "CSPF Lab, affinity, explicit" },
  { id: "rl-fault", label: "The 700 Mbps fault" },
  { id: "rl-glossary", label: "Glossary" },
  { id: "rl-recap", label: "Mental model" },
];

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
    <>
      <GuideSection id="rl-mission" eyebrow="Introduction" title="The mission: when the shortest path is the wrong path" tone="mpls">
        <p>
          R1 needs a <b className="text-pv-text">guaranteed 500 Mbps</b> tunnel to R6. The IGP only knows how to find the shortest path. <b className="text-pv-text">RSVP-TE</b> finds a path that satisfies constraints, reserves bandwidth on it hop by hop, and installs labels to forward along it.
        </p>
        <Callout tone="cyan" title="Scope of this simulation" icon="i">
          One tunnel (R1 → R6) with bandwidth and affinity constraints. The IGP is protocol-neutral (OSPF-TE or IS-IS-TE). The LSP lifecycle DOWN → CSPF → SIGNALING → UP is a PacketVerse teaching abstraction, not an official RSVP state machine. Soft-state refresh is described, not timed.
        </Callout>
      </GuideSection>

      <GuideSection id="rl-topology" eyebrow="Setup" title="Topology, metrics and bandwidth" tone="cyan">
        <DiagramFrame caption="Two real paths. The top one is cheaper; one of its links has a low bandwidth ceiling.">
          <TopologyDiagram />
        </DiagramFrame>
        <FieldTable
          title="Path totals"
          accent="cyan"
          columns={["Path", "Metric per link", "Total", "Tightest max-reservable link"]}
          rows={[
            ["Top R1-R2-R4-R6", "10", "30", <Mono key="a">R2-R4: 200 Mbps</Mono>],
            ["Bottom R1-R3-R5-R6", "15", "45", <Mono key="b">1000 Mbps</Mono>],
          ]}
        />
      </GuideSection>

      <GuideSection id="rl-question" eyebrow="The idea" title="Shortest vs constrained" tone="violet">
        <CompareCards
          items={[
            { title: "IGP SPF", tone: "ospf", tag: "reachability", points: ["What is the shortest path?", "One criterion: cost", "No idea about bandwidth"] },
            { title: "TE / CSPF", tone: "violet", tag: "constraints", points: ["What path satisfies my constraints?", "Bandwidth, affinity, explicit hops, TE metric", "Then shortest among the survivors"] },
          ]}
        />
        <Callout tone="warning" title="A ceiling isn't load" icon="!">
          Max reservable bandwidth is a TE policy limit. An idle 200 Mbps-reservable link still can&apos;t admit a 500 Mbps reservation.
        </Callout>
      </GuideSection>

      <GuideSection id="rl-ted" eyebrow="Control plane" title="The Traffic Engineering Database (TED)" tone="violet">
        <p>IGP TE extensions flood extra per-link attributes, and every TE router builds the same TED from them:</p>
        <FieldTable
          title="Per-link TED attributes (see the TE Database panel)"
          accent="violet"
          columns={["Attribute", "Meaning"]}
          rows={[
            ["IGP metric", "What plain SPF uses"],
            ["TE metric", "What CSPF uses to rank surviving paths"],
            ["Max bandwidth", "Physical speed; not what CSPF checks"],
            ["Max reservable", "Policy ceiling for RSVP reservations"],
            ["Reserved / available", "Already booked vs still bookable"],
            ["Affinity", "Administrative color (BLUE / GOLD here)"],
          ]}
        />
      </GuideSection>

      <GuideSection id="rl-cspf" eyebrow="Control plane" title="CSPF: prune, then shortest path" tone="violet">
        <FlowSteps
          steps={[
            { title: "Evaluate every link", body: "Not just the links on one candidate path: every link in the TED is tested against the constraint.", tone: "violet" },
            { title: "Prune", body: "Links that fail are removed from the graph entirely, not just deprioritized.", tone: "danger" },
            { title: "SPF on the survivors", body: "An ordinary shortest-path run using the TE metric picks the path.", tone: "success" },
          ]}
        />
        <DiagramFrame caption="The 500 Mbps run: one link fails and disappears; the surviving topology decides the path.">
          <CspfDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="rl-ero" eyebrow="Control plane" title="ERO (and RRO)" tone="mpls">
        <p>
          CSPF&apos;s result becomes the <b className="text-pv-text">Explicit Route Object</b>: <Mono>R3 → R5 → R6</Mono> (the headend itself is implicit). The ERO tells RSVP which hops to signal. It never forwards a data packet. After signaling, the <b className="text-pv-text">Record Route Object</b> records the path actually taken.
        </p>
      </GuideSection>

      <GuideSection id="rl-signal" eyebrow="Control plane" title="PATH goes down, RESV comes back up" tone="mpls">
        <DiagramFrame caption="The single most important directionality in RSVP-TE.">
          <SignalDiagram />
        </DiagramFrame>
        <FlowSteps
          steps={[
            { title: "PATH (headend → tailend)", body: "R1 sends PATH with the ERO, sender info and the 500 Mbps request. Each hop records its previous hop and forwards along the ERO. No labels yet.", tone: "cyan" },
            { title: "Tailend decides", body: "R6 checks the request and answers with RESV.", tone: "mpls" },
            { title: "RESV (tailend → headend)", body: "Each hop reserves bandwidth on its downstream link, allocates a label, installs forwarding state and advertises the label upstream.", tone: "violet" },
          ]}
        />
        <Callout tone="danger" title="RSVP never carries customer traffic" icon="✕">
          PATH and RESV are control-plane signaling. They build the LSP; the customer packets that later use it are ordinary labeled data-plane packets.
        </Callout>
      </GuideSection>

      <GuideSection id="rl-labels" eyebrow="Control plane → data plane" title="The forwarding state RESV installs" tone="mpls">
        <FieldTable
          title="Downstream-assigned labels for LSP R1 → R6"
          accent="mpls"
          columns={["Router", "Advertised upstream", "Forwarding action"]}
          rows={[
            ["R6 (tailend)", <Mono key="a">implicit-null</Mono>, "Receives plain IP (PHP)"],
            ["R5", <Mono key="b">300</Mono>, "300 → POP → R6"],
            ["R3", <Mono key="c">200</Mono>, "200 → SWAP 300 → R5"],
            ["R1 (headend)", "—", "IP → PUSH 200 → R3"],
          ]}
        />
      </GuideSection>

      <GuideSection id="rl-data" eyebrow="Data plane" title="Real traffic through the tunnel" tone="success">
        <DiagramFrame caption="No CSPF, no PATH, no RESV per packet. Only the state RESV installed.">
          <DataDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="rl-planes" eyebrow="Big picture" title="Control plane vs data plane" tone="violet">
        <CompareCards
          items={[
            { title: "Control plane", tone: "violet", tag: "builds the LSP", points: ["IGP-TE floods link attributes into the TED", "CSPF computes the path", "PATH ↓ / RESV ↑ reserve and install labels"] },
            { title: "Data plane", tone: "success", tag: "uses the LSP", points: ["PUSH 200 at R1", "SWAP 200 → 300 at R3", "POP (PHP) at R5, delivery at R6"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="rl-lab" eyebrow="Explore" title="CSPF Lab, affinity and explicit paths" tone="cyan">
        <ChecklistCard
          tone="cyan"
          mark="→"
          title="Things to try in the CSPF Lab"
          items={[
            "Request 100 Mbps and compare with 500 or 800: does the top path survive pruning?",
            "Add Include: GOLD and watch which links fail the affinity test.",
            "Switch to an explicit path through the top: explicit hops don't bypass admission control.",
          ]}
        />
        <Callout tone="cyan" title="Soft state" icon="↻">
          RSVP state is refreshed periodically. If it isn&apos;t refreshed it times out, unlike static configuration. This lesson describes that behavior but doesn&apos;t simulate the timers.
        </Callout>
      </GuideSection>

      <GuideSection id="rl-fault" eyebrow="Troubleshooting" title="The 700 Mbps fault" tone="danger">
        <DiagramFrame caption="Links, IGP, TED and RSVP are all healthy. Only the numbers changed.">
          <FaultDiagram />
        </DiagramFrame>
        <ChecklistCard
          tone="danger"
          mark="→"
          title="How to reason about it (no spoilers)"
          items={[
            "Confirm the lower layers first: links, IGP, TE extensions, RSVP.",
            "For each candidate path, find its bottleneck: available (not maximum) bandwidth.",
            "Ask what is consuming bandwidth on that bottleneck, and which change would actually create room.",
          ]}
        />
      </GuideSection>

      <GuideSection id="rl-glossary" eyebrow="Reference" title="Glossary" tone="cyan">
        <Glossary
          items={[
            { term: "Headend / tailend", def: "Ingress (R1) and egress (R6) of the TE tunnel." },
            { term: "TED", def: "Traffic Engineering Database: per-link TE attributes from IGP-TE." },
            { term: "CSPF", def: "Constrained SPF: prune links that fail constraints, then SPF on TE metric." },
            { term: "ERO", def: "Explicit Route Object: the hops PATH must follow." },
            { term: "RRO", def: "Record Route Object: the path actually signaled." },
            { term: "PATH", def: "RSVP message, headend → tailend: path + bandwidth request." },
            { term: "RESV", def: "RSVP message, tailend → headend: reservation + label." },
            { term: "Affinity", def: "Administrative group (color) CSPF can include or exclude." },
            { term: "Soft state", def: "State that expires unless refreshed." },
          ]}
        />
      </GuideSection>

      <GuideSection id="rl-recap" eyebrow="Recap" title="Mental model" tone="mpls">
        <div className="rounded-2xl border border-pv-mpls/30 bg-gradient-to-br from-pv-mpls/10 to-pv-violet/5 p-5 text-sm leading-relaxed text-pv-text">
          The TED describes what each link can offer. CSPF removes every link that can&apos;t meet the request, then picks the shortest survivor. PATH walks that path downstream, RESV walks back upstream, reserving and handing out labels. After that the data plane just pushes, swaps and pops, never knowing a constraint was involved.
        </div>
      </GuideSection>
    </>
  );
}
