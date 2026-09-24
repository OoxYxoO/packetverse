import { Callout, ChecklistCard, DArrow, DIAGRAM as D, DLink, DNode, DPill, DiagramFrame, DiagramSvg, FieldTable, FlowSteps, GuideSection, Mono } from "@/components/lesson/GuideBlocks";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";

export const OSPF_LESSON_SECTIONS: LessonGuideSectionLink[] = [
  { id: "ol-mission", label: "The mission" },
  { id: "ol-topology", label: "The diamond topology" },
  { id: "ol-hello", label: "First Hello → INIT" },
  { id: "ol-2way", label: "2-WAY" },
  { id: "ol-p2p", label: "Why no DR here" },
  { id: "ol-exstart", label: "EXSTART: master/slave" },
  { id: "ol-sync", label: "EXCHANGE → LOADING → FULL" },
  { id: "ol-mesh", label: "The other adjacencies" },
  { id: "ol-flood", label: "Flooding area-wide" },
  { id: "ol-spf", label: "SPF picks a path" },
  { id: "ol-cost", label: "A cost change" },
  { id: "ol-fault", label: "The area-mismatch fault" },
  { id: "ol-repair", label: "Repair and re-form" },
  { id: "ol-challenge", label: "The cost challenge" },
  { id: "ol-recap", label: "Recap" },
];

const P = { R1: [110, 120], R2: [320, 44], R3: [320, 196], R4: [530, 120] } as const;
type R = keyof typeof P;

/** The lesson's four-router diamond with its default costs (R1–R2 10, R2–R4 10, R1–R3 20, R3–R4 5). */
function Diamond({ highlight = [], costs = {}, note, h = 240 }: { highlight?: [R, R][]; costs?: Partial<Record<string, string>>; note?: string; h?: number }) {
  const links: [R, R, string][] = [
    ["R1", "R2", costs["R1-R2"] ?? "10"],
    ["R2", "R4", costs["R2-R4"] ?? "10"],
    ["R1", "R3", costs["R1-R3"] ?? "20"],
    ["R3", "R4", costs["R3-R4"] ?? "5"],
  ];
  const lit = (a: R, b: R) => highlight.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
  return (
    <DiagramSvg h={h} label="Four routers in a diamond: R1 to R2 cost 10, R2 to R4 cost 10, R1 to R3 cost 20, R3 to R4 cost 5">
      {links.map(([a, b, c]) => (
        <DLink key={a + b} x1={P[a][0]} y1={P[a][1]} x2={P[b][0]} y2={P[b][1]} color={lit(a, b) ? D.ospf : D.line} label={`cost ${c}`} labelDy={a === "R1" && b === "R3" ? 16 : a === "R3" ? 16 : -8} />
      ))}
      <DNode x={P.R1[0]} y={P.R1[1]} label="R1" sub="1.1.1.1" />
      <DNode x={P.R2[0]} y={P.R2[1]} label="R2" sub="2.2.2.2" />
      <DNode x={P.R3[0]} y={P.R3[1]} label="R3" sub="3.3.3.3" />
      <DNode x={P.R4[0]} y={P.R4[1]} label="R4" sub="4.4.4.4" />
      {note && (
        <text x={320} y={h - 8} textAnchor="middle" fill={D.muted} fontSize={10.5}>
          {note}
        </text>
      )}
    </DiagramSvg>
  );
}

function HelloDiagram() {
  return (
    <DiagramSvg h={200} label="R1 Hello lists no neighbors, so R2 goes to INIT; R2 Hello lists R1, so R1 goes to 2-WAY">
      <text x={110} y={20} textAnchor="middle" fill={D.text} fontSize={12} fontWeight={600}>
        R1 (1.1.1.1)
      </text>
      <text x={530} y={20} textAnchor="middle" fill={D.text} fontSize={12} fontWeight={600}>
        R2 (2.2.2.2)
      </text>
      <line x1={110} y1={30} x2={110} y2={190} stroke={D.line} strokeDasharray="3 4" />
      <line x1={530} y1={30} x2={530} y2={190} stroke={D.line} strokeDasharray="3 4" />
      <DArrow x1={112} y1={46} x2={526} y2={70} color={D.ospf} label="Hello · neighbors seen: (none)" labelDy={-10} />
      <DPill x={586} y={88} text="INIT" color={D.warning} w={64} />
      <DArrow x1={528} y1={108} x2={114} y2={132} color={D.ospf} label="Hello · neighbors seen: 1.1.1.1" labelDy={-10} />
      <DPill x={60} y={152} text="2-WAY" color={D.success} w={64} />
      <text x={320} y={182} textAnchor="middle" fill={D.muted} fontSize={10}>
        sent to 224.0.0.5 · IP protocol 89 · TTL 1 · Hello 10s / Dead 40s
      </text>
    </DiagramSvg>
  );
}

function SyncDiagram() {
  const row = (y: number, dir: "r" | "l", label: string, color: string) =>
    dir === "r" ? <DArrow x1={112} y1={y} x2={526} y2={y + 14} color={color} label={label} labelDy={-8} /> : <DArrow x1={528} y1={y} x2={114} y2={y + 14} color={color} label={label} labelDy={-8} />;
  return (
    <DiagramSvg h={250} label="Database synchronization between R1 and R2: DBD negotiation, DBD exchange, LSR, LSU and LSAck">
      <text x={110} y={20} textAnchor="middle" fill={D.text} fontSize={12} fontWeight={600}>
        R1 (slave)
      </text>
      <text x={530} y={20} textAnchor="middle" fill={D.text} fontSize={12} fontWeight={600}>
        R2 (master, higher RID)
      </text>
      <line x1={110} y1={30} x2={110} y2={240} stroke={D.line} strokeDasharray="3 4" />
      <line x1={530} y1={30} x2={530} y2={240} stroke={D.line} strokeDasharray="3 4" />
      <DPill x={320} y={40} text="EXSTART" color={D.violet} w={80} />
      {row(58, "l", "empty DBD (I, M, MS) · negotiate master", D.violet)}
      <DPill x={320} y={96} text="EXCHANGE" color={D.violet} w={86} />
      {row(112, "l", "DBD with LSA headers", D.ospf)}
      <DPill x={320} y={150} text="LOADING" color={D.warning} w={80} />
      {row(166, "r", "LSR: send me R2's Router-LSA", D.warning)}
      {row(196, "l", "LSU: R2's Router-LSA", D.ospf)}
      {row(222, "r", "LSAck → FULL", D.success)}
    </DiagramSvg>
  );
}

function FloodDiagram() {
  return (
    <DiagramSvg h={240} label="R1's Router-LSA floods to R2 and R3, which re-flood it to R4">
      <DLink x1={110} y1={120} x2={320} y2={44} />
      <DLink x1={320} y1={44} x2={530} y2={120} />
      <DLink x1={110} y1={120} x2={320} y2={196} />
      <DLink x1={320} y1={196} x2={530} y2={120} />
      <DArrow x1={150} y1={96} x2={270} y2={54} color={D.ospf} label="LSU" labelDy={-6} />
      <DArrow x1={150} y1={144} x2={270} y2={186} color={D.ospf} label="LSU" labelDy={18} />
      <DArrow x1={370} y1={54} x2={490} y2={96} color={D.ospf} dashed label="re-flood" labelDy={-6} />
      <DArrow x1={370} y1={186} x2={490} y2={144} color={D.ospf} dashed label="re-flood" labelDy={18} />
      <DNode x={110} y={120} label="R1" sub="originates LSA" />
      <DNode x={320} y={44} label="R2" />
      <DNode x={320} y={196} label="R3" />
      <DNode x={530} y={120} label="R4" sub="learns R1's LSA" />
    </DiagramSvg>
  );
}

function AreaMismatchDiagram() {
  return (
    <DiagramSvg h={170} label="R1's Hello carries Area 0 but R2's interface is in Area 1, so R2 discards it">
      <DNode x={110} y={70} label="R1" sub="iface area 0" />
      <DNode x={530} y={70} label="R2" sub="iface area 1" accent={D.danger} />
      <DArrow x1={162} y1={70} x2={440} y2={70} color={D.ospf} label="Hello · Area 0.0.0.0" />
      <text x={462} y={76} fill={D.danger} fontSize={18} fontWeight={700}>
        ✕
      </text>
      <text x={320} y={120} textAnchor="middle" fill={D.danger} fontSize={11} fontWeight={700}>
        Area ID mismatch → Hello discarded → no neighbor entry, no adjacency
      </text>
      <text x={320} y={142} textAnchor="middle" fill={D.muted} fontSize={10}>
        the cable, IPs and the rest of the area are fine; only this adjacency is gone
      </text>
    </DiagramSvg>
  );
}

export function OspfLessonGuideContent() {
  return (
    <>
      <GuideSection id="ol-mission" eyebrow="Introduction" title="The mission: R1 learns the network by itself" tone="ospf">
        <p>
          At the start R1 only knows its directly connected links. It has no idea what lies behind R2, R3 or R4, and hand-typing static routes on every router doesn&apos;t scale. In this lesson you watch <b className="text-pv-text">OSPF</b> build that knowledge automatically: routers discover neighbors, synchronize one shared map, and each computes its own best paths.
        </p>
        <Callout tone="cyan" title="Scope of this simulation" icon="i">
          The lesson deliberately models a bounded case: a single area (Area 0), point-to-point links, Type-1 Router-LSAs only, and one troubleshooting fault. DR/BDR, other LSA types, ABRs and authentication are covered in the OSPF Deep Dive, not simulated here.
        </Callout>
      </GuideSection>

      <GuideSection id="ol-topology" eyebrow="Topology" title="The diamond topology" tone="ospf">
        <DiagramFrame caption="Router IDs 1.1.1.1 – 4.4.4.4, all interfaces in Area 0, every link point-to-point. All four adjacencies start DOWN.">
          <Diamond />
        </DiagramFrame>
        <FieldTable
          title="Point-to-point interface addresses"
          accent="ospf"
          columns={["Link", "Addresses", "Cost (outbound)"]}
          rows={[
            ["R1 ↔ R2", <Mono key="a">10.0.12.1 / 10.0.12.2</Mono>, "10"],
            ["R1 ↔ R3", <Mono key="b">10.0.13.1 / 10.0.13.2</Mono>, "20"],
            ["R2 ↔ R4", <Mono key="c">10.0.24.1 / 10.0.24.2</Mono>, "10"],
            ["R3 ↔ R4", <Mono key="d">10.0.34.1 / 10.0.34.2</Mono>, "5"],
          ]}
        />
      </GuideSection>

      <GuideSection id="ol-hello" eyebrow="Adjacency" title="The first Hello puts R2 in INIT" tone="ospf">
        <p>
          R1 sends a Hello toward R2 to the AllSPFRouters group. R1 hasn&apos;t heard from anyone yet, so its Hello lists <b className="text-pv-text">no neighbors</b>. R2 has now heard R1, so it isn&apos;t DOWN any more, but it can&apos;t yet prove R1 hears <em>it</em>. That one-way state is <b className="text-pv-text">INIT</b>.
        </p>
        <DiagramFrame caption="The neighbor list inside the Hello is what proves two-way communication.">
          <HelloDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="ol-2way" eyebrow="Adjacency" title="Seeing yourself listed means 2-WAY" tone="success">
        <p>
          R2 replies with a Hello that lists R1&apos;s Router ID (1.1.1.1). The moment R1 sees itself in a neighbor&apos;s Hello, two-way communication is proven, so R1 goes straight to <b className="text-pv-text">2-WAY</b> without passing through INIT. R2 follows as soon as R1&apos;s next Hello lists R2.
        </p>
      </GuideSection>

      <GuideSection id="ol-p2p" eyebrow="Network type" title="Why there is no DR/BDR election here" tone="violet">
        <p>
          DR/BDR elections exist to reduce flooding on multi-access segments such as Ethernet LANs with many routers. A point-to-point link has exactly two routers, so every 2-WAY neighbor here goes on to become <b className="text-pv-text">fully adjacent</b>, starting with EXSTART.
        </p>
      </GuideSection>

      <GuideSection id="ol-exstart" eyebrow="Database sync" title="EXSTART: who leads the exchange?" tone="violet">
        <p>
          Both routers send empty Database Description (DBD) packets to negotiate a master and an initial DD sequence number. The higher Router ID wins: <b className="text-pv-text">R2 (2.2.2.2) becomes master</b> and R1 (1.1.1.1) the slave. The master drives the sequence numbers for the rest of the exchange.
        </p>
      </GuideSection>

      <GuideSection id="ol-sync" eyebrow="Database sync" title="EXCHANGE → LOADING → FULL" tone="ospf">
        <DiagramFrame caption="Headers first (DBD), then only the missing LSAs are requested (LSR), delivered (LSU) and acknowledged (LSAck).">
          <SyncDiagram />
        </DiagramFrame>
        <FlowSteps
          steps={[
            { title: "EXCHANGE", body: "DBDs now carry LSA headers, so each side learns what the other already has.", tone: "ospf" },
            { title: "LOADING", body: "R1 notices it has no copy of R2's Router-LSA and sends a Link State Request for it.", tone: "warning" },
            { title: "LSU", body: "R2 answers with a Link State Update containing the full Router-LSA; the same happens in the other direction.", tone: "ospf" },
            { title: "FULL", body: "R1 acknowledges. Both databases now match for what they exchanged, and the adjacency is FULL.", tone: "success" },
          ]}
        />
      </GuideSection>

      <GuideSection id="ol-mesh" eyebrow="Meanwhile" title="The other three adjacencies" tone="ospf">
        <p>The same Hello → 2-WAY → EXSTART → EXCHANGE → LOADING → FULL sequence runs independently on R1↔R3, R2↔R4 and R3↔R4. The lesson fast-forwards these, since the mechanics are identical.</p>
      </GuideSection>

      <GuideSection id="ol-flood" eyebrow="Flooding" title="Every LSA reaches every router" tone="ospf">
        <p>
          Once adjacencies are FULL, each router&apos;s Router-LSA is flooded hop by hop across the area. R4 has no direct link to R1, yet it learns R1&apos;s LSA because R2 and R3 re-flood it. The result: <b className="text-pv-text">every LSDB in the area is identical</b>, the same four Router-LSAs everywhere.
        </p>
        <DiagramFrame caption="Flooding is reliable: each LSU is acknowledged, and duplicates are recognized by their sequence numbers.">
          <FloodDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="ol-spf" eyebrow="Path calculation" title="SPF picks R1's path to R4" tone="success">
        <p>With an identical LSDB, each router runs Dijkstra&apos;s SPF on its own. For R1 → R4 there are two candidate paths, and SPF compares their <b className="text-pv-text">cumulative</b> cost:</p>
        <DiagramFrame caption="R1 → R2 → R4 = 10 + 10 = 20 beats R1 → R3 → R4 = 20 + 5 = 25, so R1 installs the path via R2.">
          <Diamond highlight={[["R1", "R2"], ["R2", "R4"]]} note="best path: R1 → R2 → R4 (total 20)" h={260} />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="ol-cost" eyebrow="Change" title="A cost change re-floods and re-runs SPF" tone="warning">
        <p>
          R1&apos;s outbound cost toward R2 changes from 10 to <b className="text-pv-text">50</b>. R1 originates a new Router-LSA with a higher sequence number, floods it so every router replaces its stale copy, and reruns SPF. Now R1 → R2 → R4 costs 60 while R1 → R3 → R4 still costs 25.
        </p>
        <DiagramFrame caption="Nothing was disabled. The best path moved purely because one number in the LSDB changed.">
          <Diamond costs={{ "R1-R2": "50" }} highlight={[["R1", "R3"], ["R3", "R4"]]} note="after the change: R1 → R3 → R4 (total 25) wins" h={260} />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="ol-fault" eyebrow="Troubleshooting" title="The fault: an area mismatch" tone="danger">
        <p>
          Someone moves R2&apos;s interface toward R1 from Area 0 into Area 1, while R1 stays in Area 0. The adjacency drops: R1 keeps sending Hellos, but R2 never forms a neighbor with it.
        </p>
        <DiagramFrame caption="The Hello carries the sending interface's Area ID. A mismatch means the Hello is discarded before any neighbor state is created.">
          <AreaMismatchDiagram />
        </DiagramFrame>
        <Callout tone="warning" title="How to investigate" icon="?">
          Compare what each side puts in its Hellos and what each interface is configured with. The fields that must agree are listed in the OSPF Deep Dive.
        </Callout>
      </GuideSection>

      <GuideSection id="ol-repair" eyebrow="Recovery" title="Repair and re-form" tone="success">
        <p>Putting R2&apos;s interface back into Area 0 makes the Hellos acceptable again, and the adjacency re-forms through exactly the same states to FULL.</p>
      </GuideSection>

      <GuideSection id="ol-challenge" eyebrow="Engineer challenge" title="The cost challenge: how to think about it" tone="violet">
        <p>
          The cost is reset to 10, so R1 → R2 → R4 is best again. Your task is to make R1 prefer R1 → R3 → R4 by changing <b className="text-pv-text">only</b> R1&apos;s outbound cost toward R2.
        </p>
        <ChecklistCard
          tone="violet"
          mark="→"
          title="Method (no spoilers)"
          items={[
            "Add up each path's cost from R1's point of view, using outbound costs.",
            "Keep the R3 path's total fixed, and work out what the R2 path's total must exceed.",
            "Remember that equal totals are a tie, not a win for R3.",
            "After you apply a value, check R1's routing table: the next hop to R4 tells you whether it worked.",
          ]}
        />
      </GuideSection>

      <GuideSection id="ol-recap" eyebrow="Recap" title="What you saw" tone="violet">
        <div className="rounded-2xl border border-pv-violet/30 bg-gradient-to-br from-pv-violet/10 to-pv-cyan/5 p-5 text-sm leading-relaxed text-pv-text">
          Hellos proved two-way reachability (INIT → 2-WAY). On point-to-point links every neighbor went on to sync (EXSTART → EXCHANGE → LOADING → FULL). Router-LSAs flooded until every LSDB matched, and SPF on each router turned that shared map into its own best paths. One changed cost re-flooded and moved the path; one mismatched Area ID silently broke an adjacency.
        </div>
      </GuideSection>
    </>
  );
}
