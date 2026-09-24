import { Callout, ChecklistCard, CompareCards, DArrow, DIAGRAM as D, DLink, DNode, DPill, DRegion, DiagramFrame, DiagramSvg, FieldTable, FlowSteps, Glossary, GuideSection, Mono } from "@/components/lesson/GuideBlocks";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";

export const OSPF_DEEP_DIVE_SECTIONS: LessonGuideSectionLink[] = [
  { id: "od-what", label: "Link-state IGP" },
  { id: "od-rid", label: "Router ID" },
  { id: "od-areas", label: "Areas & Area 0" },
  { id: "od-packets", label: "The five packet types" },
  { id: "od-hello", label: "Hello rules" },
  { id: "od-fsm", label: "Neighbor state machine" },
  { id: "od-nettypes", label: "Network types" },
  { id: "od-drbdr", label: "DR / BDR" },
  { id: "od-sync", label: "Database synchronization" },
  { id: "od-lsas", label: "LSA types" },
  { id: "od-lsdb", label: "LSDB & reliable flooding" },
  { id: "od-spf", label: "SPF / Dijkstra" },
  { id: "od-cost", label: "Cost" },
  { id: "od-ecmp", label: "ECMP" },
  { id: "od-rib", label: "RIB & FIB" },
  { id: "od-converge", label: "Reconvergence" },
  { id: "od-failures", label: "Adjacency failures" },
  { id: "od-verify", label: "Verification commands" },
  { id: "od-not", label: "What OSPF does NOT do" },
  { id: "od-glossary", label: "Glossary" },
  { id: "od-model", label: "Mental model" },
];

function AreasDiagram() {
  return (
    <DiagramSvg h={220} label="Area 0 backbone connected to Area 1 and Area 2 through area border routers">
      <DRegion x={220} y={20} w={200} h={120} label="Area 0 (backbone)" color={D.ospf} />
      <DRegion x={14} y={90} w={190} h={110} label="Area 1" color={D.violet} />
      <DRegion x={436} y={90} w={190} h={110} label="Area 2" color={D.success} />
      <DNode x={270} y={80} label="Core A" w={80} />
      <DNode x={370} y={80} label="Core B" w={80} />
      <DNode x={210} y={140} label="ABR 1" sub="Area 0 + 1" accent={D.warning} w={96} />
      <DNode x={430} y={140} label="ABR 2" sub="Area 0 + 2" accent={D.warning} w={96} />
      <DNode x={90} y={170} label="R-a" w={70} />
      <DNode x={550} y={170} label="R-b" w={70} />
      <DLink x1={310} y1={80} x2={330} y2={80} />
      <DLink x1={250} y1={100} x2={220} y2={118} />
      <DLink x1={390} y1={100} x2={420} y2={118} />
      <DLink x1={125} y1={170} x2={162} y2={150} />
      <DLink x1={515} y1={170} x2={478} y2={150} />
    </DiagramSvg>
  );
}

function FsmDiagram() {
  const states: [string, string][] = [
    ["DOWN", D.faint],
    ["INIT", D.warning],
    ["2-WAY", D.ospf],
    ["EXSTART", D.violet],
    ["EXCHANGE", D.violet],
    ["LOADING", D.warning],
    ["FULL", D.success],
  ];
  return (
    <DiagramSvg h={150} label="OSPF neighbor states from DOWN to FULL">
      {states.map(([s, c], i) => (
        <g key={s}>
          <DPill x={48 + i * 91} y={50} text={s} color={c} w={82} />
          {i < states.length - 1 && <DArrow x1={90 + i * 91} y1={50} x2={96 + i * 91} y2={50} color={D.faint} width={1.6} />}
        </g>
      ))}
      <text x={48} y={90} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        no Hello
      </text>
      <text x={139} y={90} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        heard them
      </text>
      <text x={230} y={90} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        they hear me
      </text>
      <text x={366} y={90} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        master/slave, then DBD headers
      </text>
      <text x={503} y={90} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        LSR / LSU
      </text>
      <text x={594} y={90} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        in sync
      </text>
      <text x={320} y={130} textAnchor="middle" fill={D.muted} fontSize={10}>
        on broadcast networks, DROTHER-to-DROTHER neighbors stop at 2-WAY (by design, not a fault)
      </text>
    </DiagramSvg>
  );
}

function DrDiagram() {
  return (
    <DiagramSvg h={200} label="On a broadcast segment, routers become fully adjacent only with the DR and BDR">
      <line x1={80} y1={100} x2={560} y2={100} stroke={D.eth} strokeWidth={4} />
      <text x={320} y={92} textAnchor="middle" fill={D.eth} fontSize={10}>
        shared Ethernet segment
      </text>
      {[
        [120, "DR", D.success],
        [250, "BDR", D.ospf],
        [390, "DROTHER", D.faint],
        [520, "DROTHER", D.faint],
      ].map(([x, l, c]) => (
        <g key={String(x)}>
          <DLink x1={Number(x)} y1={100} x2={Number(x)} y2={140} color={D.eth} />
          <DNode x={Number(x)} y={160} label={String(l)} accent={String(c)} w={96} />
        </g>
      ))}
      <text x={320} y={40} textAnchor="middle" fill={D.text} fontSize={11}>
        DROTHERs send updates to 224.0.0.6 (DR/BDR); the DR re-floods to 224.0.0.5 (all)
      </text>
      <text x={320} y={58} textAnchor="middle" fill={D.muted} fontSize={10}>
        FULL only with DR/BDR · 2-WAY between DROTHERs
      </text>
    </DiagramSvg>
  );
}

function SpfDiagram() {
  return (
    <DiagramSvg h={210} label="Dijkstra builds a shortest-path tree from the root by always expanding the cheapest known node">
      <DLink x1={100} y1={105} x2={300} y2={40} label="10" />
      <DLink x1={300} y1={40} x2={520} y2={105} label="10" />
      <DLink x1={100} y1={105} x2={300} y2={170} label="20" labelDy={16} />
      <DLink x1={300} y1={170} x2={520} y2={105} label="5" labelDy={16} />
      <DNode x={100} y={105} label="Root" sub="0" accent={D.success} w={80} />
      <DNode x={300} y={40} label="A" sub="10" w={70} />
      <DNode x={300} y={170} label="B" sub="20" w={70} />
      <DNode x={520} y={105} label="C" sub="min(20, 25) = 20" w={120} />
      <text x={320} y={204} textAnchor="middle" fill={D.muted} fontSize={10}>
        expand the cheapest tentative node, relax its neighbors, repeat until all nodes are final
      </text>
    </DiagramSvg>
  );
}

function PipelineDiagram() {
  const stages: [string, string][] = [
    ["Hello", D.ospf],
    ["Adjacency", D.violet],
    ["LSDB sync", D.violet],
    ["Flooding", D.ospf],
    ["SPF", D.success],
    ["RIB → FIB", D.ip],
  ];
  return (
    <DiagramSvg h={110} label="OSPF pipeline from Hello to forwarding table">
      {stages.map(([s, c], i) => (
        <g key={s}>
          <DPill x={60 + i * 104} y={50} text={s} color={c} w={92} />
          {i < stages.length - 1 && <DArrow x1={107 + i * 104} y1={50} x2={116 + i * 104} y2={50} color={D.faint} width={1.6} />}
        </g>
      ))}
      <text x={320} y={92} textAnchor="middle" fill={D.muted} fontSize={10}>
        control plane on the left · forwarding state on the right
      </text>
    </DiagramSvg>
  );
}

export function OspfDeepDiveContent() {
  return (
    <>
      <GuideSection id="od-what" eyebrow="Fundamentals" title="OSPF is a link-state IGP" tone="ospf">
        <p>
          <b className="text-pv-text">OSPF (Open Shortest Path First)</b> is an interior gateway protocol: it routes <em>inside</em> one organization&apos;s network. It is <b className="text-pv-text">link-state</b>: every router describes its own links in LSAs, floods them so all routers share one map (the LSDB), and then each router independently computes shortest paths with SPF.
        </p>
        <DiagramFrame caption="Every OSPF behavior fits somewhere in this pipeline.">
          <PipelineDiagram />
        </DiagramFrame>
        <CompareCards
          items={[
            { title: "Link-state (OSPF, IS-IS)", tone: "cyan", tag: "map", points: ["Every router knows the whole area topology", "Each computes its own tree", "Fast, loop-free convergence"] },
            { title: "Distance-vector (RIP)", tone: "violet", tag: "rumor", points: ["Routers only know neighbors' distances", "Routes learned second-hand", "Slower convergence, loop-prevention hacks"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="od-rid" eyebrow="Identity" title="The Router ID" tone="cyan">
        <p>
          Each OSPF router has a 32-bit <b className="text-pv-text">Router ID</b> written like an IPv4 address (e.g. <Mono>2.2.2.2</Mono>). It identifies the router in every packet and LSA, breaks ties such as master/slave and DR election, and must be unique in the domain. It is usually configured explicitly; otherwise implementations derive it from an interface address, typically the highest loopback.
        </p>
      </GuideSection>

      <GuideSection id="od-areas" eyebrow="Hierarchy" title="Areas and the Area 0 backbone" tone="ospf">
        <p>
          Large OSPF domains are split into <b className="text-pv-text">areas</b>. Full topology detail (Router- and Network-LSAs) stays inside each area; <b className="text-pv-text">ABRs</b> (Area Border Routers) summarize it into other areas. Every non-backbone area must attach to <b className="text-pv-text">Area 0</b>, and inter-area traffic passes through the backbone.
        </p>
        <DiagramFrame caption="Smaller LSDBs and SPF runs per area; changes in one area don't trigger full SPF in the others.">
          <AreasDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="od-packets" eyebrow="On the wire" title="The five OSPF packet types" tone="violet">
        <p>OSPF runs directly over IP as <b className="text-pv-text">protocol 89</b> (no TCP or UDP), usually multicast to <Mono>224.0.0.5</Mono> (all OSPF routers) or <Mono>224.0.0.6</Mono> (DR/BDR).</p>
        <FieldTable
          title="Packet types"
          accent="ospf"
          columns={["Type", "Name", "Purpose"]}
          rows={[
            ["1", "Hello", "Discover neighbors, check parameters, keepalive"],
            ["2", "DBD (Database Description)", "Summarize the LSDB with LSA headers"],
            ["3", "LSR (Link State Request)", "Ask for specific LSAs that are missing or outdated"],
            ["4", "LSU (Link State Update)", "Carry full LSAs, for sync and for flooding"],
            ["5", "LSAck", "Acknowledge received LSAs (reliable flooding)"],
          ]}
        />
        <Callout tone="warning" title="Don't mix them up" icon="!">
          Packet types (1–5) are how routers talk. <b>LSA types</b> (1, 2, 3, 4, 5, 7…) are what they talk about, carried inside LSUs.
        </Callout>
      </GuideSection>

      <GuideSection id="od-hello" eyebrow="Adjacency" title="What Hellos must agree on" tone="ospf">
        <ChecklistCard
          tone="cyan"
          mark="="
          title="Must match for neighbors to form"
          items={[
            "Area ID (the fault in this lesson)",
            "Hello and Dead intervals (commonly 10 s / 40 s on broadcast and point-to-point)",
            "Subnet/mask on broadcast networks",
            "Authentication type and key",
            "Area type flags (stub / NSSA)",
            "Unique Router IDs",
          ]}
        />
        <Callout tone="warning" title="MTU is different" icon="!">
          An MTU mismatch doesn&apos;t stop Hellos. Neighbors typically get stuck in EXSTART/EXCHANGE instead, because the DBD packets are rejected.
        </Callout>
      </GuideSection>

      <GuideSection id="od-fsm" eyebrow="State machine" title="The neighbor state machine" tone="violet">
        <DiagramFrame caption="Each state is a checkpoint; where a neighbor gets stuck points at the cause.">
          <FsmDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="od-nettypes" eyebrow="Network types" title="Point-to-point vs broadcast" tone="cyan">
        <CompareCards
          items={[
            { title: "Point-to-point", tone: "cyan", tag: "2 routers", points: ["No DR/BDR election", "Every neighbor becomes FULL", "Typical for routed links (and this lesson)"] },
            { title: "Broadcast (e.g. Ethernet)", tone: "violet", tag: "many routers", points: ["DR and BDR elected", "FULL only with DR/BDR", "DR originates the segment's Network-LSA (Type 2)"] },
          ]}
        />
        <p>Other types exist (NBMA, point-to-multipoint), mainly for non-broadcast WANs.</p>
      </GuideSection>

      <GuideSection id="od-drbdr" eyebrow="Multi-access" title="DR and BDR" tone="violet">
        <p>
          With N routers on one segment, a full mesh of adjacencies would need N(N−1)/2 sync relationships. Instead a <b className="text-pv-text">Designated Router</b> and a <b className="text-pv-text">Backup DR</b> are elected (highest interface priority, then highest Router ID, and the election is non-preemptive). Everyone syncs with the DR/BDR only.
        </p>
        <DiagramFrame caption="The DR acts as the segment's hub for flooding.">
          <DrDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="od-sync" eyebrow="Database sync" title="How two LSDBs synchronize" tone="ospf">
        <FlowSteps
          steps={[
            { title: "EXSTART", body: "Negotiate master/slave (the higher Router ID becomes master) and the DD sequence number.", tone: "violet" },
            { title: "EXCHANGE", body: "Trade DBDs listing LSA headers (type, advertising router, sequence, age).", tone: "violet" },
            { title: "LOADING", body: "Request anything missing or newer with an LSR; receive it in an LSU.", tone: "warning" },
            { title: "FULL", body: "Everything requested has arrived and been acknowledged.", tone: "success" },
          ]}
        />
      </GuideSection>

      <GuideSection id="od-lsas" eyebrow="LSAs" title="LSA types (overview)" tone="ospf">
        <FieldTable
          title="Common OSPFv2 LSA types"
          accent="ospf"
          columns={["Type", "Name", "Originated by", "Scope"]}
          rows={[
            ["1", "Router-LSA", "Every router: its own links and costs", "Area"],
            ["2", "Network-LSA", "The DR: routers on a broadcast segment", "Area"],
            ["3", "Summary-LSA", "ABR: prefixes from other areas", "Area"],
            ["4", "ASBR-Summary", "ABR: how to reach an ASBR", "Area"],
            ["5", "AS-External", "ASBR: redistributed external routes", "Whole domain (not stub areas)"],
            ["7", "NSSA-External", "ASBR inside an NSSA; translated to Type 5 by the ABR", "NSSA"],
          ]}
        />
        <Callout tone="cyan" title="In this lesson" icon="i">
          Only Type-1 Router-LSAs are modeled, because a single area of point-to-point links needs nothing else.
        </Callout>
      </GuideSection>

      <GuideSection id="od-lsdb" eyebrow="LSDB" title="The LSDB and reliable flooding" tone="ospf">
        <p>
          The LSDB is the set of all LSAs a router holds for an area, and it must be identical on every router in that area. Flooding is <b className="text-pv-text">reliable</b>: every LSA in an LSU is acknowledged and retransmitted until it is. Each LSA carries a <b className="text-pv-text">sequence number</b> (a newer instance replaces an older one) and an <b className="text-pv-text">age</b>. Originators refresh their LSAs periodically (every 30 minutes by default), and an LSA that reaches MaxAge (1 hour) is flushed.
        </p>
      </GuideSection>

      <GuideSection id="od-spf" eyebrow="Path calculation" title="SPF: Dijkstra's algorithm" tone="success">
        <p>Each router places itself at the root and builds a shortest-path tree over the LSDB. The best path to every destination is the branch of that tree with the lowest cumulative cost.</p>
        <DiagramFrame caption="Same structure as the lesson's diamond: C is reached via A at 20, not via B at 25.">
          <SpfDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="od-cost" eyebrow="Metric" title="Cost" tone="warning">
        <p>
          Cost is a per-interface, <b className="text-pv-text">outbound</b> metric; a path&apos;s cost is the sum of the outgoing interface costs along it. Many implementations derive a default from bandwidth (<Mono>reference bandwidth ÷ interface bandwidth</Mono>, with a classic default reference of 100 Mbps, which makes all links ≥100 Mbps cost 1 unless the reference is raised). Engineers usually set costs deliberately.
        </p>
        <Callout tone="warning" title="Asymmetry is allowed" icon="!">
          The two ends of a link can have different costs, so the forward and return paths can differ.
        </Callout>
      </GuideSection>

      <GuideSection id="od-ecmp" eyebrow="Load sharing" title="ECMP" tone="success">
        <p>
          When two or more paths have exactly the <b className="text-pv-text">same lowest cost</b>, OSPF can install them all (Equal-Cost Multi-Path). Traffic is then usually spread per flow by hashing packet headers, so a single flow stays on one path.
        </p>
      </GuideSection>

      <GuideSection id="od-rib" eyebrow="Forwarding" title="From SPF to RIB and FIB" tone="ip">
        <p>
          SPF results become OSPF routes offered to the <b className="text-pv-text">RIB</b> (routing table). If OSPF&apos;s route is preferred over other sources (administrative distance / preference), it is programmed into the <b className="text-pv-text">FIB</b>, the forwarding table the hardware uses per packet. OSPF itself never forwards user traffic.
        </p>
      </GuideSection>

      <GuideSection id="od-converge" eyebrow="Failure" title="Reconvergence" tone="danger">
        <FlowSteps
          steps={[
            { title: "Detect", body: "The link goes down, the Dead interval expires, or BFD reports a failure.", tone: "danger" },
            { title: "Originate", body: "Affected routers issue new LSAs with higher sequence numbers.", tone: "warning" },
            { title: "Flood", body: "The new LSAs replace stale copies everywhere in the area.", tone: "ospf" },
            { title: "Recompute", body: "Each router reruns SPF (throttled by SPF timers).", tone: "success" },
            { title: "Reprogram", body: "Changed routes are updated in the RIB and FIB.", tone: "ip" },
          ]}
        />
      </GuideSection>

      <GuideSection id="od-failures" eyebrow="Troubleshooting" title="Common adjacency failures" tone="danger">
        <FieldTable
          title="Where it gets stuck → usual cause"
          accent="danger"
          columns={["Symptom", "Usual cause"]}
          rows={[
            ["No neighbor at all", "Area ID, Hello/Dead, mask, auth or stub-flag mismatch; ACL blocking protocol 89; passive interface"],
            ["Stuck in INIT", "One-way communication: the other side isn't receiving our Hellos"],
            ["2-WAY between DROTHERs", "Normal on broadcast networks, not a fault"],
            ["Stuck in EXSTART/EXCHANGE", "MTU mismatch, or duplicate Router IDs"],
            ["Stuck in LOADING", "Corrupted or unacknowledged LSAs"],
            ["FULL but route missing", "Wrong network statements, filtering, or a better route from another source"],
          ]}
        />
      </GuideSection>

      <GuideSection id="od-verify" eyebrow="Operations" title="Verification commands" tone="cyan">
        <FieldTable
          title="Common checks (Cisco IOS · Junos)"
          accent="cyan"
          columns={["Question", "Cisco IOS", "Junos"]}
          rows={[
            ["Who are my neighbors, and in what state?", <Mono key="1">show ip ospf neighbor</Mono>, <Mono key="2">show ospf neighbor</Mono>],
            ["What's in my LSDB?", <Mono key="3">show ip ospf database</Mono>, <Mono key="4">show ospf database</Mono>],
            ["Which interfaces run OSPF, with what area/cost?", <Mono key="5">show ip ospf interface</Mono>, <Mono key="6">show ospf interface</Mono>],
            ["Which OSPF routes were installed?", <Mono key="7">show ip route ospf</Mono>, <Mono key="8">show route protocol ospf</Mono>],
          ]}
        />
      </GuideSection>

      <GuideSection id="od-not" eyebrow="Clear the myths" title="What OSPF does NOT do" tone="danger">
        <ChecklistCard
          tone="danger"
          mark="✕"
          title="Not OSPF's job"
          items={[
            "It doesn't exchange routes between organizations. That's BGP.",
            "It doesn't forward packets itself. The FIB does.",
            "It doesn't run over TCP or UDP. It's IP protocol 89.",
            "It doesn't carry full topology across area boundaries. ABRs summarize.",
            "It doesn't use hop count. It uses cumulative cost.",
          ]}
        />
      </GuideSection>

      <GuideSection id="od-glossary" eyebrow="Reference" title="Glossary" tone="cyan">
        <Glossary
          items={[
            { term: "LSA", def: "Link-State Advertisement: one piece of the topology map." },
            { term: "LSDB", def: "All LSAs a router holds for an area; identical area-wide." },
            { term: "SPF", def: "Shortest Path First (Dijkstra), run by each router on the LSDB." },
            { term: "Adjacency", def: "A neighbor relationship that has synchronized (FULL)." },
            { term: "ABR", def: "Area Border Router, attached to Area 0 and at least one other area." },
            { term: "ASBR", def: "Router that injects external routes into OSPF." },
            { term: "DR / BDR", def: "Designated / Backup Designated Router on multi-access segments." },
            { term: "Dead interval", def: "How long without Hellos before a neighbor is declared down." },
          ]}
        />
      </GuideSection>

      <GuideSection id="od-model" eyebrow="In one breath" title="Mental model" tone="violet">
        <div className="rounded-2xl border border-pv-ospf/30 bg-gradient-to-br from-pv-ospf/10 to-pv-violet/5 p-5 text-sm leading-relaxed text-pv-text">
          OSPF routers <b>say hello</b>, <b>agree they can hear each other</b>, <b>swap and sync their maps</b>, <b>flood every change</b> so all maps stay identical, and then <b>each router does its own navigation</b> with Dijkstra. Costs are the only thing that decides the route.
        </div>
      </GuideSection>
    </>
  );
}
