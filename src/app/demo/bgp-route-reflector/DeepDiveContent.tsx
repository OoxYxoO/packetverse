import { Callout, ChecklistCard, CompareCards, DArrow, DIAGRAM as D, DLink, DNode, DRegion, DiagramFrame, DiagramSvg, FieldTable, FlowSteps, Glossary, GuideSection, Mono } from "@/components/lesson/GuideBlocks";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";

export const RR_DEEP_DIVE_SECTIONS: LessonGuideSectionLink[] = [
  { id: "rd-mesh", label: "The iBGP full-mesh requirement" },
  { id: "rd-why", label: "Why split horizon exists" },
  { id: "rd-what", label: "Route reflection (RFC 4456)" },
  { id: "rd-roles", label: "RR, client, non-client" },
  { id: "rd-rules", label: "Reflection rules" },
  { id: "rd-attrs", label: "ORIGINATOR_ID & CLUSTER_LIST" },
  { id: "rd-loops", label: "Loop prevention in action" },
  { id: "rd-visibility", label: "Path visibility" },
  { id: "rd-nexthop", label: "NEXT_HOP and forwarding" },
  { id: "rd-redundancy", label: "Redundant RRs" },
  { id: "rd-hierarchy", label: "Hierarchical RRs" },
  { id: "rd-placement", label: "Placement & data path" },
  { id: "rd-confed", label: "Alternative: confederations" },
  { id: "rd-mistakes", label: "Common mistakes" },
  { id: "rd-verify", label: "Verification" },
  { id: "rd-not", label: "What an RR does NOT do" },
  { id: "rd-glossary", label: "Glossary" },
  { id: "rd-model", label: "Mental model" },
];

function GrowthDiagram() {
  const pts: [number, number][] = [
    [4, 6],
    [10, 45],
    [20, 190],
    [30, 435],
    [40, 780],
    [50, 1225],
  ];
  const x = (n: number) => 70 + (n / 50) * 520;
  const y = (s: number) => 190 - (s / 1225) * 160;
  return (
    <DiagramSvg h={220} label="Full-mesh sessions grow quadratically while RR sessions grow linearly">
      <line x1={70} y1={190} x2={600} y2={190} stroke={D.line} />
      <line x1={70} y1={20} x2={70} y2={190} stroke={D.line} />
      <polyline points={pts.map(([n, s]) => `${x(n)},${y(s)}`).join(" ")} fill="none" stroke={D.danger} strokeWidth={2.5} />
      <polyline points={pts.map(([n]) => `${x(n)},${y(n + 1)}`).join(" ")} fill="none" stroke={D.success} strokeWidth={2.5} />
      <text x={540} y={40} fill={D.danger} fontSize={11} fontWeight={700}>
        full mesh n(n−1)/2
      </text>
      <text x={540} y={176} fill={D.success} fontSize={11} fontWeight={700}>
        with RRs ≈ n
      </text>
      <text x={335} y={212} textAnchor="middle" fill={D.muted} fontSize={10}>
        routers (4 → 50)
      </text>
    </DiagramSvg>
  );
}

function RulesDiagram() {
  return (
    <DiagramSvg h={230} label="Client-learned routes go to everyone; non-client-learned routes go only to clients">
      <DNode x={320} y={115} label="RR" accent={D.violet} w={80} />
      <DNode x={100} y={50} label="client A" sub="source" w={100} />
      <DNode x={100} y={180} label="client B" w={100} />
      <DNode x={540} y={50} label="non-client X" sub="source" accent={D.warning} w={120} />
      <DNode x={540} y={180} label="non-client Y" accent={D.warning} w={120} />
      <DArrow x1={150} y1={62} x2={280} y2={105} color={D.success} />
      <DArrow x1={280} y1={125} x2={150} y2={168} color={D.success} label="A's route" labelDy={18} />
      <DArrow x1={360} y1={125} x2={480} y2={168} color={D.success} label="A's route" labelDy={18} />
      <DArrow x1={480} y1={62} x2={360} y2={105} color={D.warning} />
      <text x={420} y={100} fill={D.warning} fontSize={10} fontWeight={700}>
        X&apos;s route → clients only
      </text>
      <text x={320} y={222} textAnchor="middle" fill={D.muted} fontSize={10}>
        X&apos;s route reaches client B, but never non-client Y
      </text>
    </DiagramSvg>
  );
}

function LoopDiagram() {
  return (
    <DiagramSvg h={200} label="A route that returns to a cluster it already passed through is rejected by its CLUSTER_LIST">
      <DNode x={120} y={60} label="RR-a" sub="cluster 1" accent={D.violet} w={110} />
      <DNode x={520} y={60} label="RR-b" sub="cluster 2" accent={D.bgp} w={110} />
      <DNode x={320} y={160} label="RR-c" sub="cluster 3" accent={D.ospf} w={110} />
      <DArrow x1={176} y1={60} x2={464} y2={60} color={D.faint} label="CL [1]" />
      <DArrow x1={500} y1={82} x2={370} y2={140} color={D.faint} label="CL [2, 1]" labelDy={-4} />
      <DArrow x1={270} y1={140} x2={140} y2={82} color={D.danger} dashed label="CL [3, 2, 1]" labelDy={-4} />
      <text x={120} y={120} textAnchor="middle" fill={D.danger} fontSize={11} fontWeight={700}>
        contains 1 → drop
      </text>
    </DiagramSvg>
  );
}

function RedundancyDiagram() {
  return (
    <DiagramSvg h={200} label="Clients peer with two RRs so that losing one RR doesn't stop reflection">
      <DRegion x={20} y={10} w={600} h={180} label="redundant RR pair" color={D.violet} />
      <DNode x={220} y={60} label="RR1" accent={D.violet} w={80} />
      <DNode x={420} y={60} label="RR2" accent={D.violet} w={80} />
      <DLink x1={260} y1={60} x2={380} y2={60} color={D.warning} dashed label="iBGP" />
      {[120, 270, 370, 520].map((x) => (
        <g key={x}>
          <DLink x1={220} y1={82} x2={x} y2={140} color={D.violet} />
          <DLink x1={420} y1={82} x2={x} y2={140} color={D.violet} />
          <DNode x={x} y={150} label="client" w={80} />
        </g>
      ))}
    </DiagramSvg>
  );
}

function HierarchyDiagram() {
  return (
    <DiagramSvg h={210} label="Top-level RRs serve lower-level RRs as clients, which in turn serve PEs">
      <DNode x={320} y={36} label="Top RR" accent={D.violet} w={100} />
      <DNode x={180} y={110} label="Region RR-1" accent={D.bgp} w={120} />
      <DNode x={460} y={110} label="Region RR-2" accent={D.bgp} w={120} />
      <DLink x1={290} y1={56} x2={200} y2={90} color={D.violet} />
      <DLink x1={350} y1={56} x2={440} y2={90} color={D.violet} />
      {[90, 180, 270].map((x) => (
        <g key={x}>
          <DLink x1={180} y1={132} x2={x} y2={170} color={D.bgp} />
          <DNode x={x} y={180} label="PE" w={60} h={34} />
        </g>
      ))}
      {[370, 460, 550].map((x) => (
        <g key={x}>
          <DLink x1={460} y1={132} x2={x} y2={170} color={D.bgp} />
          <DNode x={x} y={180} label="PE" w={60} h={34} />
        </g>
      ))}
    </DiagramSvg>
  );
}

export function RrDeepDiveContent() {
  return (
    <>
      <GuideSection id="rd-mesh" eyebrow="Background" title="The iBGP full-mesh requirement" tone="bgp">
        <p>
          By default, every iBGP speaker in an AS must peer with every other one, because routes learned over iBGP are not re-advertised to other iBGP peers. The number of sessions grows as <b className="text-pv-text">n(n−1)/2</b>.
        </p>
        <DiagramFrame caption="Quadratic vs roughly linear growth.">
          <GrowthDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="rd-why" eyebrow="Background" title="Why iBGP split horizon exists" tone="bgp">
        <p>
          eBGP detects loops with AS_PATH, but inside one AS no AS number is added, so AS_PATH can&apos;t reveal a loop between iBGP speakers. The simple rule &quot;never pass an iBGP route to another iBGP peer&quot; makes loops impossible, at the cost of the full mesh.
        </p>
      </GuideSection>

      <GuideSection id="rd-what" eyebrow="Mechanism" title="Route reflection (RFC 4456)" tone="violet">
        <p>
          A <b className="text-pv-text">Route Reflector</b> is an iBGP speaker configured to relax split horizon for designated <b className="text-pv-text">clients</b>. It runs normal best-path selection, then reflects its best path according to fixed rules, adding attributes that restore loop safety. Clients need no special configuration; they just peer with the RR.
        </p>
      </GuideSection>

      <GuideSection id="rd-roles" eyebrow="Roles" title="RR, client, non-client" tone="violet">
        <FieldTable
          title="Roles"
          accent="violet"
          columns={["Role", "Description"]}
          rows={[
            ["Route Reflector", "Reflects routes for its clients; also a normal BGP speaker"],
            ["Client", "Peers only with its RR(s); unaware it is a client"],
            ["Non-client", "Ordinary iBGP peer of the RR (often another RR); full-mesh rules apply"],
            ["Cluster", "An RR (or RR pair) plus its clients, identified by a cluster ID"],
          ]}
        />
      </GuideSection>

      <GuideSection id="rd-rules" eyebrow="Rules" title="The reflection rules" tone="violet">
        <DiagramFrame caption="The asymmetry is the key: a route from a non-client never goes to another non-client.">
          <RulesDiagram />
        </DiagramFrame>
        <FlowSteps
          steps={[
            { title: "From a client", body: "Reflect to all other clients and to all non-client peers.", tone: "success" },
            { title: "From a non-client", body: "Reflect to clients only.", tone: "warning" },
            { title: "From an eBGP peer", body: "Advertise to everyone (clients and non-clients), as any BGP speaker would.", tone: "bgp" },
          ]}
        />
      </GuideSection>

      <GuideSection id="rd-attrs" eyebrow="Loop safety" title="ORIGINATOR_ID, CLUSTER_ID, CLUSTER_LIST" tone="warning">
        <FieldTable
          title="RR attributes"
          accent="warning"
          columns={["Attribute", "Set by", "Loop rule"]}
          rows={[
            ["ORIGINATOR_ID", "The first RR that reflects the route: the originator's router ID", "A router ignores routes carrying its own router ID"],
            ["CLUSTER_ID", "Configured per RR/cluster (defaults to the RR's router ID)", "Identifies the cluster"],
            ["CLUSTER_LIST", "Each reflecting RR prepends its cluster ID", "An RR ignores routes that already contain its cluster ID"],
          ]}
        />
        <Callout tone="cyan" title="Both are optional non-transitive" icon="i">
          They are only meaningful inside the AS and are stripped when a route is sent to an eBGP peer.
        </Callout>
      </GuideSection>

      <GuideSection id="rd-loops" eyebrow="Loop safety" title="Loop prevention in action" tone="danger">
        <DiagramFrame caption="CLUSTER_LIST is to clusters what AS_PATH is to autonomous systems.">
          <LoopDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="rd-visibility" eyebrow="Trade-off" title="Path visibility" tone="warning">
        <p>
          An RR reflects only its <b className="text-pv-text">own best path</b> per prefix. Clients therefore lose visibility of alternative exits, which can mean less-optimal exit choices (the RR picks from its topological position) and slower failover. Add-Path and optimal route reflection (ORR) are the usual remedies.
        </p>
      </GuideSection>

      <GuideSection id="rd-nexthop" eyebrow="Forwarding" title="NEXT_HOP and forwarding" tone="ip">
        <p>
          An RR does <b className="text-pv-text">not</b> change NEXT_HOP by default. Clients forward traffic toward the original next hop (usually the egress PE&apos;s loopback) using the IGP/MPLS transport, so reflection never inserts the RR into the traffic path.
        </p>
      </GuideSection>

      <GuideSection id="rd-redundancy" eyebrow="Design" title="Redundant route reflectors" tone="violet">
        <p>Production designs use at least two RRs. Clients peer with both, and the RRs peer with each other.</p>
        <DiagramFrame caption="Losing one RR leaves every client with a working reflection path.">
          <RedundancyDiagram />
        </DiagramFrame>
        <CompareCards
          items={[
            { title: "Same cluster ID", tone: "violet", tag: "shared", points: ["The RRs drop each other's reflections of the same routes", "Less redundant state", "But a client that loses its session to one RR can miss routes"] },
            { title: "Different cluster IDs", tone: "cyan", tag: "per RR", points: ["More state (each RR accepts the other's reflections)", "More robust against partial failures", "Common modern default"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="rd-hierarchy" eyebrow="Design" title="Hierarchical route reflection" tone="bgp">
        <p>Very large networks nest RRs: regional RRs are clients of top-level RRs. CLUSTER_LIST keeps the multi-level design loop-free.</p>
        <DiagramFrame caption="Each level only peers with the level above and its own clients.">
          <HierarchyDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="rd-placement" eyebrow="Design" title="Placement and the data path" tone="cyan">
        <p>
          RRs are often dedicated control-plane boxes (even virtual) placed out of the forwarding path. Because reflection selects a best path from the RR&apos;s own viewpoint, placement affects which exit clients are told about. That is the problem ORR addresses.
        </p>
      </GuideSection>

      <GuideSection id="rd-confed" eyebrow="Alternative" title="Alternative: BGP confederations" tone="violet">
        <p>
          Confederations split one AS into sub-ASes that run eBGP-like sessions between them, with confederation segments in AS_PATH preventing loops. They also remove the full mesh, but require more re-configuration, so route reflection is far more common.
        </p>
      </GuideSection>

      <GuideSection id="rd-mistakes" eyebrow="Troubleshooting" title="Common mistakes" tone="danger">
        <ChecklistCard
          tone="danger"
          mark="!"
          title="Frequent problems"
          items={[
            "Forgetting the route-reflector-client flag: the session is up, but routes are only partly distributed (the lesson's fault).",
            "RRs in different clusters not peering with each other: routes don't cross clusters.",
            "A single RR with no redundancy: one failure stops all route distribution.",
            "Expecting the RR to change NEXT_HOP: clients can't resolve external next hops.",
            "Assuming clients see all paths: the RR sends only its best, unless Add-Path is used.",
          ]}
        />
      </GuideSection>

      <GuideSection id="rd-verify" eyebrow="Operations" title="Verification" tone="cyan">
        <FieldTable
          title="Common checks"
          accent="cyan"
          columns={["Question", "Example (Cisco IOS)"]}
          rows={[
            ["Is this neighbor a client?", <Mono key="1">show ip bgp neighbors X | include client</Mono>],
            ["What did the RR reflect, with which attributes?", <Mono key="2">show ip bgp 10.1.1.0</Mono>],
            ["ORIGINATOR_ID / CLUSTER_LIST on a received route", <Mono key="3">show ip bgp 10.1.1.0 (Originator, Cluster list lines)</Mono>],
            ["Session and prefix counts", <Mono key="4">show ip bgp summary</Mono>],
          ]}
        />
      </GuideSection>

      <GuideSection id="rd-not" eyebrow="Clear the myths" title="What a Route Reflector does NOT do" tone="danger">
        <ChecklistCard
          tone="danger"
          mark="✕"
          title="Not an RR's job"
          items={["It doesn't forward customer or MPLS traffic.", "It doesn't allocate labels or interpret VPN RDs/RTs.", "It doesn't replace the IGP or BGP.", "It doesn't add an AS_PATH hop.", "It doesn't reflect every path. Only its best."]}
        />
      </GuideSection>

      <GuideSection id="rd-glossary" eyebrow="Reference" title="Glossary" tone="cyan">
        <Glossary
          items={[
            { term: "Route Reflector", def: "iBGP speaker allowed to re-advertise iBGP routes to its clients." },
            { term: "Client", def: "iBGP peer designated as served by an RR." },
            { term: "Non-client", def: "Ordinary iBGP peer of an RR." },
            { term: "Cluster ID", def: "Identifier of an RR's cluster, stored in CLUSTER_LIST." },
            { term: "ORIGINATOR_ID", def: "Router ID of the route's originator inside the AS." },
            { term: "CLUSTER_LIST", def: "Cluster IDs a route has been reflected through." },
            { term: "Add-Path", def: "Extension to advertise more than one path per prefix." },
            { term: "Confederation", def: "Splitting an AS into sub-ASes to avoid the iBGP full mesh." },
          ]}
        />
      </GuideSection>

      <GuideSection id="rd-model" eyebrow="In one breath" title="Mental model" tone="violet">
        <div className="rounded-2xl border border-pv-violet/30 bg-gradient-to-br from-pv-violet/10 to-pv-bgp/5 p-5 text-sm leading-relaxed text-pv-text">
          A Route Reflector is a <b>trusted relay</b> in a room where normally everyone must speak to everyone. Clients tell the relay; the relay repeats what it thinks is best, stamping who said it first (ORIGINATOR_ID) and which relays passed it on (CLUSTER_LIST), so nothing echoes forever. It carries messages, never the traffic.
        </div>
      </GuideSection>
    </>
  );
}
