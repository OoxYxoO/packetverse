import { Callout, ChecklistCard, DArrow, DIAGRAM as D, DiagramFrame, DiagramSvg, DNode, DPill, FieldTable, FlowSteps, Glossary, GuideSection, Mono } from "@/components/lesson/GuideBlocks";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";

export const RT_DEEP_DIVE_SECTIONS: LessonGuideSectionLink[] = [
  { id: "rtd-rib", label: "RIB vs FIB" },
  { id: "rtd-preference", label: "Preference, then LPM" },
  { id: "rtd-recursive", label: "Recursive next hops" },
  { id: "rtd-ecmp", label: "Equal prefixes & ECMP" },
  { id: "rtd-summary", label: "Summaries & discard" },
  { id: "rtd-default", label: "Default routes" },
  { id: "rtd-dynamic", label: "Dynamic routing" },
  { id: "rtd-workflow", label: "Troubleshooting" },
  { id: "rtd-verify", label: "Verification" },
  { id: "rtd-glossary", label: "Glossary" },
];

function RibFibDiagram() {
  const src = [
    { y: 40, t: "Connected", s: "interfaces up" },
    { y: 95, t: "Static", s: "operator" },
    { y: 150, t: "Dynamic", s: "OSPF, BGP …" },
  ];
  return (
    <DiagramSvg h={200} label="Route sources — connected, static and dynamic protocols — feed the RIB, which keeps the best route per prefix; the RIB programs the forwarding table (FIB), where each packet's destination is looked up by longest prefix match">
      {src.map((x) => (
        <g key={x.t}>
          <DNode x={80} y={x.y} label={x.t} sub={x.s} accent={D.cyan} w={120} />
          <DArrow x1={142} y1={x.y} x2={236} y2={95} color={D.muted} width={1.4} />
        </g>
      ))}
      <DNode x={300} y={95} label="RIB" sub="best route per prefix" accent={D.violet} w={120} h={52} />
      <DArrow x1={362} y1={95} x2={424} y2={95} color={D.violet} />
      <DNode x={490} y={95} label="FIB" sub="forwarding table" accent={D.ip} w={120} h={52} />
      <DPill x={490} y={160} text="packet: LPM lookup" color={D.success} />
      <text x={320} y={194} textAnchor="middle" fill={D.muted} fontSize={10}>
        Control plane builds the table; the data plane only looks things up in it.
      </text>
    </DiagramSvg>
  );
}

function PreferenceDiagram() {
  return (
    <DiagramSvg h={220} label="Two separate decisions: first, when several sources offer the SAME prefix, route preference picks which one is installed; second, per packet, longest prefix match chooses among DIFFERENT installed prefixes">
      <text x={20} y={24} fill={D.violet} fontSize={10.5} fontWeight={700}>
        1 · Same prefix, several sources → preference picks ONE to install
      </text>
      <DNode x={110} y={70} label="172.16.50.0/24" sub="static" accent={D.cyan} w={150} />
      <DNode x={290} y={70} label="172.16.50.0/24" sub="learned via OSPF" accent={D.faint} w={150} />
      <DArrow x1={370} y1={70} x2={440} y2={70} color={D.violet} />
      <DNode x={530} y={70} label="installed" sub="preferred source" accent={D.violet} w={140} />
      <text x={20} y={134} fill={D.success} fontSize={10.5} fontWeight={700}>
        2 · Different installed prefixes → per packet, the LONGEST match wins
      </text>
      <DNode x={110} y={180} label="/25" accent={D.success} w={80} />
      <DNode x={210} y={180} label="/24" accent={D.muted} w={80} />
      <DNode x={310} y={180} label="/16" accent={D.muted} w={80} />
      <DNode x={410} y={180} label="/0" accent={D.muted} w={80} />
      <text x={464} y={184} fill={D.muted} fontSize={10}>
        ← most specific first
      </text>
    </DiagramSvg>
  );
}

function RecursiveDiagram() {
  return (
    <DiagramSvg h={170} label="General recursive resolution: a route whose next hop is not directly connected is resolved through another route, repeatedly, until a connected route supplies the outgoing interface">
      <DNode x={90} y={60} label="198.51.100.0/24" sub="via 192.0.2.9" accent={D.ip} w={150} />
      <DArrow x1={166} y1={60} x2={226} y2={60} color={D.muted} />
      <DNode x={300} y={60} label="192.0.2.9 ∈ …/28" sub="via 10.0.12.2" accent={D.ip} w={146} />
      <DArrow x1={374} y1={60} x2={434} y2={60} color={D.muted} />
      <DNode x={530} y={60} label="10.0.12.0/30" sub="connected ge-0/0/1" accent={D.success} w={170} />
      <text x={20} y={120} fill={D.text} fontSize={10.5} fontWeight={700}>
        Resolution walks the table until it reaches a connected route (the exit interface).
      </text>
      <text x={20} y={140} fill={D.muted} fontSize={10}>
        This lesson needed one step: 10.0.12.2 is directly on connected 10.0.12.0/30.
      </text>
      <text x={20} y={158} fill={D.muted} fontSize={10}>
        (Example addresses; if any link in the chain disappears, the route stops being usable.)
      </text>
    </DiagramSvg>
  );
}

function EcmpDiagram() {
  return (
    <DiagramSvg h={206} label="Equal-cost multipath: two installed routes for the same prefix with equal preference; the router spreads flows across both next hops, typically by hashing header fields so each flow stays on one path">
      <DNode x={90} y={95} label="R1" sub="10.9.0.0/16 ×2" accent={D.ip} w={120} />
      <DArrow x1={152} y1={85} x2={290} y2={45} color={D.cyan} />
      <DArrow x1={152} y1={105} x2={290} y2={145} color={D.violet} />
      <DNode x={360} y={40} label="next hop A" accent={D.cyan} w={120} />
      <DNode x={360} y={150} label="next hop B" accent={D.violet} w={120} />
      <text x={440} y={86} fill={D.text} fontSize={10}>
        flow hash
      </text>
      <text x={440} y={102} fill={D.muted} fontSize={10}>
        (src/dst IP, ports…)
      </text>
      <text x={20} y={198} fill={D.muted} fontSize={10}>
        Equal prefixes never compete on length — preference decides, and exact ties can share the load.
      </text>
    </DiagramSvg>
  );
}

function SummaryDiagram() {
  return (
    <DiagramSvg h={200} label="Legitimate discard use: a router advertising the summary 172.16.0.0/16 installs 172.16.0.0/16 discard locally; traffic to a more-specific existing subnet follows the longer route, while traffic to an unused part of the summary is dropped instead of looping">
      <DNode x={110} y={50} label="172.16.50.0/24" sub="real subnet → forward" accent={D.success} w={160} />
      <DNode x={110} y={120} label="172.16.60.0/24" sub="real subnet → forward" accent={D.success} w={160} />
      <DNode x={400} y={85} label="172.16.0.0/16" sub="summary · discard" accent={D.warning} w={170} h={50} />
      <DArrow x1={192} y1={50} x2={312} y2={78} color={D.muted} width={1.4} />
      <DArrow x1={192} y1={120} x2={312} y2={92} color={D.muted} width={1.4} />
      <text x={20} y={170} fill={D.text} fontSize={10.5} fontWeight={700}>
        Longer routes still win for real subnets; the /16 discard catches only the unused space.
      </text>
      <text x={20} y={190} fill={D.muted} fontSize={10}>
        That prevents packets for non-existent subnets from bouncing along a default route. The lesson&apos;s /25 was the same tool, misapplied.
      </text>
    </DiagramSvg>
  );
}

function DefaultChainDiagram() {
  return (
    <DiagramSvg h={170} label="Default routes chain hop by hop: each router's default only moves the packet to the next router; somewhere a router must hold a specific route or the packet is dropped">
      {["BRANCH", "R1", "R2", "EDGE"].map((t, i) => (
        <g key={t}>
          <DNode x={80 + i * 160} y={60} label={t} sub={i < 3 ? "0/0 → next" : "specific routes"} accent={i < 3 ? D.warning : D.success} w={120} />
          {i < 3 && <DArrow x1={142 + i * 160} y1={60} x2={178 + i * 160} y2={60} color={D.warning} />}
        </g>
      ))}
      <text x={20} y={120} fill={D.text} fontSize={10.5} fontWeight={700}>
        Every default is just &quot;hand it to the next router&quot;.
      </text>
      <text x={20} y={140} fill={D.muted} fontSize={10}>
        Reachability exists only if some router on the way knows a specific route — and the reply path works too.
      </text>
      <text x={20} y={158} fill={D.muted} fontSize={10}>
        Two routers pointing their defaults at each other bounce a packet until its TTL runs out.
      </text>
    </DiagramSvg>
  );
}

function DynamicDiagram() {
  return (
    <DiagramSvg h={150} label="Dynamic routing: a routing protocol such as OSPF exchanges routes and installs them in the same routing table; the forwarding decision per packet is still longest prefix match">
      <DNode x={100} y={60} label="OSPF / BGP" sub="exchange routes" accent={D.ospf} w={140} />
      <DArrow x1={172} y1={60} x2={262} y2={60} color={D.ospf} />
      <DNode x={330} y={60} label="Routing table" sub="+ connected + static" accent={D.violet} w={130} />
      <DArrow x1={397} y1={60} x2={467} y2={60} color={D.ip} />
      <DNode x={540} y={60} label="Forwarding" sub="longest prefix" accent={D.ip} w={130} />
      <text x={320} y={120} textAnchor="middle" fill={D.muted} fontSize={10}>
        Protocols automate how routes get in. They don&apos;t change how a packet picks one.
      </text>
    </DiagramSvg>
  );
}

export function RoutingDeepDiveContent() {
  return (
    <div className="space-y-12">
      <GuideSection id="rtd-rib" eyebrow="Mental model" title="RIB and forwarding table" tone="violet">
        <DiagramFrame caption="Where routes come from vs where packets are looked up.">
          <RibFibDiagram />
        </DiagramFrame>
        <p>Routers usually keep a Routing Information Base (every usable route, best per prefix) and program a forwarding table from it. The lesson shows one combined table, which is enough to reason about forwarding.</p>
      </GuideSection>

      <GuideSection id="rtd-preference" eyebrow="Two decisions" title="Route preference first, longest prefix per packet" tone="cyan">
        <DiagramFrame caption="Preference compares routes for the SAME prefix. Prefix length compares DIFFERENT prefixes.">
          <PreferenceDiagram />
        </DiagramFrame>
        <p>Preference goes by different names: administrative distance, route preference. Only when several sources offer the <em>same</em> prefix does it decide which one gets installed. It never lets a /16 beat a /24 for a destination both contain.</p>
      </GuideSection>

      <GuideSection id="rtd-recursive" eyebrow="Recursion" title="Next hops that aren't directly connected" tone="arp">
        <DiagramFrame caption="Resolved route by route until a connected network gives the exit.">
          <RecursiveDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="rtd-ecmp" eyebrow="Equal candidates" title="Equal prefixes and ECMP" tone="violet">
        <DiagramFrame caption="Same prefix, same preference: both paths can be used.">
          <EcmpDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="rtd-summary" eyebrow="Summaries" title="Summary routes and legitimate discard routes" tone="warning">
        <DiagramFrame caption="A covering summary plus a local discard is a standard loop-avoidance pattern.">
          <SummaryDiagram />
        </DiagramFrame>
        <Callout tone="warning" title="Vendor names">
          The same idea appears as a &quot;discard&quot; or &quot;blackhole&quot; route, or a route to a null interface (for example <Mono>Null0</Mono>). Some platforms also offer &quot;reject&quot;, which drops the packet and sends ICMP unreachable. In every form the packet stops at this router when that route wins.
        </Callout>
      </GuideSection>

      <GuideSection id="rtd-default" eyebrow="Default routes" title="Gateway of last resort" tone="warning">
        <DiagramFrame caption="Defaults chain; reachability needs a specific route somewhere.">
          <DefaultChainDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="rtd-dynamic" eyebrow="Beyond static" title="Where dynamic routing fits" tone="ospf">
        <DiagramFrame caption="Same table, same lookup — protocols just fill it.">
          <DynamicDiagram />
        </DiagramFrame>
        <p>Static routes don&apos;t react to failures and don&apos;t scale well. OSPF (its own lesson) learns routes automatically. The forwarding decision you practised here stays exactly the same.</p>
      </GuideSection>

      <GuideSection id="rtd-workflow" eyebrow="Workflow" title="Troubleshooting a routing problem" tone="danger">
        <FlowSteps
          steps={[
            { title: "Which destinations fail?", body: "One host, one subnet, half a subnet, everything off-net? The pattern points at a prefix.", tone: "cyan" },
            { title: "Look up like the router", body: "For a failing destination, list every matching route on each router along the path and pick the longest.", tone: "violet" },
            { title: "Check the winner's action", body: "Forward (to which next hop / exit?), discard, or no route at all?", tone: "warning" },
            { title: "Check both directions", body: "Does the reply have a route back on every router?", tone: "ip" },
            { title: "Fix the table, then re-test both good and bad destinations", body: "Remove or correct the offending route; confirm nothing that worked broke.", tone: "success" },
          ]}
        />
        <FieldTable
          title="Lookups in this lesson"
          columns={["Destination", "Matching routes on R1", "Winner"]}
          rows={[
            ["172.16.50.50 (healthy)", "/24, /16, /0", "/24 via 10.0.12.2"],
            ["203.0.113.80", "/0", "/0 via 10.0.12.2"],
            ["172.16.50.50 (fault)", "/25, /24, /16, /0", "/25 discard"],
            ["172.16.50.200 (fault)", "/24, /16, /0", "/24 via 10.0.12.2"],
          ]}
        />
      </GuideSection>

      <GuideSection id="rtd-verify" eyebrow="Verification" title="What healthy looks like" tone="success">
        <ChecklistCard tone="success" title="Healthy routing" mark="✓" items={["Every destination's longest match forwards to a reachable next hop", "Return routes exist on every router along the path", "No unintended more-specific or discard routes", "TTL drops by exactly one per router in traces"]} />
      </GuideSection>

      <GuideSection id="rtd-glossary" eyebrow="Glossary" title="Deep-dive terms" tone="cyan">
        <Glossary
          items={[
            { term: "RIB", def: "Routing Information Base: the routes a router knows." },
            { term: "FIB", def: "Forwarding table programmed from the RIB; used per packet." },
            { term: "Route preference", def: "Tie-breaker between sources offering the same prefix (e.g. administrative distance)." },
            { term: "Recursive next hop", def: "A next hop resolved through another route." },
            { term: "ECMP", def: "Equal-cost multipath: several equal routes share traffic." },
            { term: "Summary route", def: "One shorter prefix covering several longer ones." },
          ]}
        />
      </GuideSection>
    </div>
  );
}
