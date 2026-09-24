import { Callout, ChecklistCard, CompareCards, DArrow, DIAGRAM as D, DNode, DPill, DRegion, DiagramFrame, DiagramSvg, FieldTable, FlowSteps, Glossary, GuideSection, Mono } from "@/components/lesson/GuideBlocks";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";

export const BGP_DEEP_DIVE_SECTIONS: LessonGuideSectionLink[] = [
  { id: "bd-what", label: "Path-vector routing" },
  { id: "bd-as", label: "Autonomous systems" },
  { id: "bd-ebgp", label: "eBGP vs iBGP" },
  { id: "bd-tcp", label: "Transport: TCP/179" },
  { id: "bd-fsm", label: "Session state machine" },
  { id: "bd-msgs", label: "Message types" },
  { id: "bd-update", label: "Inside an UPDATE" },
  { id: "bd-attrs", label: "Path attributes" },
  { id: "bd-bestpath", label: "Best-path selection" },
  { id: "bd-nexthop", label: "NEXT_HOP resolution" },
  { id: "bd-loops", label: "Loop prevention" },
  { id: "bd-advert", label: "Advertisement rules" },
  { id: "bd-policy", label: "Policy & filtering" },
  { id: "bd-traffic", label: "Steering traffic" },
  { id: "bd-planes", label: "Control vs forwarding" },
  { id: "bd-trouble", label: "Troubleshooting" },
  { id: "bd-verify", label: "Verification commands" },
  { id: "bd-not", label: "What BGP does NOT do" },
  { id: "bd-glossary", label: "Glossary" },
  { id: "bd-model", label: "Mental model" },
];

function AsGraph() {
  return (
    <DiagramSvg h={220} label="A prefix is advertised across three autonomous systems, each prepending its AS number">
      <DRegion x={20} y={70} w={150} h={80} label="AS 64500 (origin)" color={D.success} />
      <DRegion x={245} y={70} w={150} h={80} label="AS 64510" color={D.bgp} />
      <DRegion x={470} y={70} w={150} h={80} label="AS 64520" color={D.violet} />
      <DNode x={95} y={118} label="origin" sub="198.51.100.0/24" w={120} accent={D.success} />
      <DNode x={320} y={118} label="transit" w={90} accent={D.bgp} />
      <DNode x={545} y={118} label="receiver" w={90} accent={D.violet} />
      <DArrow x1={156} y1={118} x2={274} y2={118} color={D.bgp} label="AS_PATH: 64500" />
      <DArrow x1={366} y1={118} x2={499} y2={118} color={D.bgp} label="AS_PATH: 64510 64500" />
      <text x={320} y={190} textAnchor="middle" fill={D.muted} fontSize={10}>
        each AS prepends its own number when advertising to an eBGP neighbor
      </text>
    </DiagramSvg>
  );
}

function FsmDiagram() {
  const st: [string, string][] = [
    ["Idle", D.faint],
    ["Connect", D.tcp],
    ["Active", D.warning],
    ["OpenSent", D.bgp],
    ["OpenConfirm", D.bgp],
    ["Established", D.success],
  ];
  return (
    <DiagramSvg h={150} label="BGP finite state machine from Idle to Established">
      {st.map(([s, c], i) => (
        <g key={s}>
          <DPill x={56 + i * 106} y={50} text={s} color={c} w={96} />
          {i < st.length - 1 && <DArrow x1={104 + i * 106} y1={50} x2={112 + i * 106} y2={50} color={D.faint} width={1.6} />}
        </g>
      ))}
      <text x={162} y={88} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        TCP connecting
      </text>
      <text x={268} y={88} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        TCP retry
      </text>
      <text x={374} y={88} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        OPEN sent
      </text>
      <text x={480} y={88} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        OPEN ok, wait KEEPALIVE
      </text>
      <text x={320} y={126} textAnchor="middle" fill={D.muted} fontSize={10}>
        any error → NOTIFICATION + back to Idle · Active is only entered when a TCP attempt fails
      </text>
    </DiagramSvg>
  );
}

function UpdateDiagram() {
  const box = (y: number, t: string, n: string, c: string) => (
    <g>
      <rect x={120} y={y} width={400} height={38} rx={8} fill={c} fillOpacity={0.12} stroke={c} />
      <text x={136} y={y + 17} fill={c} fontSize={11.5} fontWeight={700}>
        {t}
      </text>
      <text x={136} y={y + 31} fill={D.muted} fontSize={10}>
        {n}
      </text>
    </g>
  );
  return (
    <DiagramSvg h={190} label="An UPDATE carries withdrawn routes, path attributes and NLRI">
      {box(12, "Withdrawn Routes", "prefixes that are no longer reachable via this sender", D.danger)}
      {box(66, "Path Attributes", "ORIGIN · AS_PATH · NEXT_HOP · LOCAL_PREF · MED · COMMUNITIES …", D.bgp)}
      {box(120, "NLRI", "prefixes that share exactly these attributes", D.success)}
      <text x={320} y={180} textAnchor="middle" fill={D.muted} fontSize={10}>
        one UPDATE = one set of attributes for one or more prefixes
      </text>
    </DiagramSvg>
  );
}

function BestPathDiagram() {
  const steps = [
    "Weight (Cisco-proprietary, local)",
    "Highest LOCAL_PREF",
    "Locally originated",
    "Shortest AS_PATH",
    "Lowest ORIGIN (IGP < EGP < ?)",
    "Lowest MED (same neighbor AS)",
    "eBGP over iBGP",
    "Lowest IGP metric to NEXT_HOP",
    "Oldest eBGP path / lowest Router ID / …",
  ];
  return (
    <DiagramSvg h={330} label="A common vendor best-path order from weight down to router ID tiebreakers">
      {steps.map((s, i) => (
        <g key={s}>
          <rect x={120} y={10 + i * 35} width={400} height={28} rx={7} fill={D.box} stroke={i === 0 ? D.warning : D.bgp} strokeOpacity={0.7} strokeDasharray={i === 0 ? "4 3" : undefined} />
          <text x={140} y={29 + i * 35} fill={D.text} fontSize={11.5}>
            {i + 1}. {s}
          </text>
        </g>
      ))}
    </DiagramSvg>
  );
}

function NextHopDiagram() {
  return (
    <DiagramSvg h={170} label="A BGP route's next hop is resolved recursively through the IGP to a connected interface">
      <DPill x={120} y={40} text="BGP: 203.0.113.0/24 → NH 192.0.2.2" color={D.bgp} w={220} />
      <DArrow x1={235} y1={40} x2={300} y2={40} color={D.faint} />
      <DPill x={410} y={40} text="IGP: 192.0.2.0/30 → via 10.0.12.1" color={D.ospf} w={210} />
      <DArrow x1={410} y1={54} x2={410} y2={92} color={D.faint} />
      <DPill x={410} y={106} text="connected: 10.0.12.0/30 → ge-0/0/1" color={D.ip} w={220} />
      <text x={320} y={150} textAnchor="middle" fill={D.muted} fontSize={10}>
        if any step fails, the BGP route stays in the BGP table but is not installed
      </text>
    </DiagramSvg>
  );
}

function SplitHorizonDiagram() {
  return (
    <DiagramSvg h={180} label="Routes learned from one iBGP peer are not advertised to another iBGP peer">
      <DRegion x={20} y={20} w={600} h={140} label="one AS (iBGP)" color={D.ospf} />
      <DNode x={120} y={100} label="A" />
      <DNode x={320} y={100} label="B" />
      <DNode x={520} y={100} label="C" />
      <DArrow x1={172} y1={100} x2={268} y2={100} color={D.success} label="iBGP" />
      <DArrow x1={372} y1={100} x2={440} y2={100} color={D.danger} dashed label="not re-advertised" />
      <text x={456} y={106} fill={D.danger} fontSize={16} fontWeight={700}>
        ✕
      </text>
      <text x={320} y={148} textAnchor="middle" fill={D.muted} fontSize={10}>
        hence the iBGP full mesh, or route reflectors / confederations
      </text>
    </DiagramSvg>
  );
}

function PlanesDiagram() {
  return (
    <DiagramSvg h={150} label="BGP feeds the RIB, and the RIB programs the FIB that forwards packets">
      <DNode x={100} y={70} label="BGP table" sub="all paths" accent={D.bgp} w={130} />
      <DArrow x1={166} y1={70} x2={250} y2={70} color={D.faint} label="best + resolvable" />
      <DNode x={320} y={70} label="RIB" sub="all protocols" accent={D.ospf} w={120} />
      <DArrow x1={381} y1={70} x2={460} y2={70} color={D.faint} label="preferred" />
      <DNode x={540} y={70} label="FIB" sub="forwards packets" accent={D.ip} w={130} />
      <text x={320} y={130} textAnchor="middle" fill={D.muted} fontSize={10}>
        BGP never touches user packets; it only decides which routes the FIB gets
      </text>
    </DiagramSvg>
  );
}

export function BgpDeepDiveContent() {
  return (
    <>
      <GuideSection id="bd-what" eyebrow="Fundamentals" title="BGP is a path-vector protocol" tone="bgp">
        <p>
          <b className="text-pv-text">BGP (Border Gateway Protocol, BGP-4)</b> exchanges reachability between <b className="text-pv-text">autonomous systems</b>. Each route carries the <b className="text-pv-text">path</b> of ASes it crossed (AS_PATH), not just a metric, so every AS can apply its own policy and detect loops.
        </p>
        <DiagramFrame caption="The AS_PATH grows as a route crosses AS boundaries.">
          <AsGraph />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="bd-as" eyebrow="Identity" title="Autonomous systems and AS numbers" tone="bgp">
        <p>
          An AS is a network under one administration with one routing policy. AS numbers are 16-bit or 32-bit (4-byte). Private ranges such as <Mono>64512–65534</Mono> (16-bit) are for internal use, like the <Mono>650xx</Mono> numbers used in these lessons.
        </p>
      </GuideSection>

      <GuideSection id="bd-ebgp" eyebrow="Session types" title="eBGP vs iBGP" tone="violet">
        <CompareCards
          items={[
            { title: "eBGP", tone: "bgp", tag: "between ASes", points: ["Peers in different ASes, usually directly connected", "Own AS is prepended to AS_PATH", "NEXT_HOP set to the sender's address", "Loop check: reject routes that contain your own AS"] },
            { title: "iBGP", tone: "cyan", tag: "inside an AS", points: ["Peers in the same AS, often via loopbacks", "AS_PATH and NEXT_HOP unchanged by default", "LOCAL_PREF carried", "Routes from one iBGP peer aren't sent to another"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="bd-tcp" eyebrow="Transport" title="TCP port 179" tone="tcp">
        <p>BGP runs over TCP port 179, relying on TCP for reliable, ordered delivery, so BGP itself has no retransmission logic. Sessions are explicitly configured per neighbor; BGP has no automatic neighbor discovery.</p>
      </GuideSection>

      <GuideSection id="bd-fsm" eyebrow="State machine" title="The session state machine" tone="bgp">
        <DiagramFrame caption="Stuck in Active or Connect means TCP isn't coming up; stuck at OpenSent/OpenConfirm points at OPEN parameters.">
          <FsmDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="bd-msgs" eyebrow="On the wire" title="The four core message types" tone="bgp">
        <FieldTable
          title="BGP messages"
          accent="bgp"
          columns={["Message", "Purpose"]}
          rows={[
            ["OPEN", "Start a session: version, AS number, Hold Time, BGP Identifier, capabilities (e.g. 4-byte ASN, MP-BGP)"],
            ["KEEPALIVE", "Confirm the OPEN and keep the session alive within the Hold Time"],
            ["UPDATE", "Advertise new routes and/or withdraw old ones"],
            ["NOTIFICATION", "Report an error and close the session"],
          ]}
        />
        <p>A fifth type, ROUTE-REFRESH, asks a peer to resend its routes after a policy change.</p>
      </GuideSection>

      <GuideSection id="bd-update" eyebrow="On the wire" title="Inside an UPDATE" tone="bgp">
        <DiagramFrame caption="Withdrawals and advertisements can travel in the same message.">
          <UpdateDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="bd-attrs" eyebrow="Attributes" title="Key path attributes" tone="violet">
        <FieldTable
          title="Common attributes"
          accent="violet"
          columns={["Attribute", "Category", "Meaning"]}
          rows={[
            ["ORIGIN", "Well-known mandatory", "How the route entered BGP: IGP, EGP or incomplete"],
            ["AS_PATH", "Well-known mandatory", "Sequence of ASes crossed; loop check and length metric"],
            ["NEXT_HOP", "Well-known mandatory", "Where to send traffic for this prefix"],
            ["LOCAL_PREF", "Well-known discretionary (iBGP only)", "AS-wide exit preference; higher wins"],
            ["MED", "Optional non-transitive", "Hint to a neighbor AS about which entry point to use; lower wins"],
            ["COMMUNITIES", "Optional transitive", "Tags that trigger policy elsewhere"],
          ]}
        />
        <Callout tone="warning" title="Weight is not a BGP attribute" icon="!">
          &quot;Weight&quot; is a Cisco-proprietary, router-local value. It is never sent to peers.
        </Callout>
      </GuideSection>

      <GuideSection id="bd-bestpath" eyebrow="Decision" title="Best-path selection" tone="success">
        <p>A router may learn many paths for one prefix but installs and advertises only one best path by default. The order below is a common vendor (Cisco-style) sequence. Exact steps differ between implementations, so treat it as typical, not universal.</p>
        <DiagramFrame caption="The first step that separates the candidates decides; later steps are never consulted.">
          <BestPathDiagram />
        </DiagramFrame>
        <Callout tone="cyan" title="In the enterprise lesson" icon="i">
          The lesson uses a simplified subset: LOCAL_PREF → AS_PATH length → MED → eBGP over iBGP → lowest Router ID.
        </Callout>
      </GuideSection>

      <GuideSection id="bd-nexthop" eyebrow="Usability" title="NEXT_HOP must resolve" tone="ip">
        <p>A route is only eligible if its NEXT_HOP is reachable via the routing table. Resolution is often <b className="text-pv-text">recursive</b>: the BGP next hop is reached through an IGP route, which is reached through a connected interface.</p>
        <DiagramFrame caption="This is why iBGP designs use next-hop-self or advertise external link subnets into the IGP.">
          <NextHopDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="bd-loops" eyebrow="Safety" title="Loop prevention" tone="danger">
        <FlowSteps
          steps={[
            { title: "Between ASes: AS_PATH", body: "A router rejects any route whose AS_PATH already contains its own AS number.", tone: "bgp" },
            { title: "Inside an AS: iBGP split horizon", body: "Routes learned from an iBGP peer are not re-advertised to other iBGP peers, because AS_PATH doesn't change inside the AS.", tone: "cyan" },
            { title: "With route reflectors", body: "ORIGINATOR_ID and CLUSTER_LIST replace split horizon's safety (see the Route Reflector lesson).", tone: "violet" },
          ]}
        />
        <DiagramFrame caption="The iBGP rule that makes a full mesh (or reflection) necessary.">
          <SplitHorizonDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="bd-advert" eyebrow="Propagation" title="What gets advertised" tone="bgp">
        <ChecklistCard
          tone="cyan"
          mark="•"
          title="Default advertisement rules"
          items={["Only the best path per prefix is advertised (unless Add-Path is used).", "eBGP-learned best paths go to all peers, iBGP and eBGP.", "iBGP-learned best paths go to eBGP peers, but not to other iBGP peers.", "Outbound policy can filter or modify anything before it is sent."]}
        />
      </GuideSection>

      <GuideSection id="bd-policy" eyebrow="Control" title="Policy and prefix filtering" tone="violet">
        <p>
          BGP is a policy protocol. Inbound policy decides what you accept and with which attributes (for example setting LOCAL_PREF); outbound policy decides what you announce (for example only your own prefixes, never a full table from one ISP to another). Prefix lists, AS-path filters, communities and route-maps/policy-statements are the usual tools. RPKI origin validation adds a check that the originating AS is authorized.
        </p>
      </GuideSection>

      <GuideSection id="bd-traffic" eyebrow="Traffic engineering" title="Steering traffic in and out" tone="violet">
        <CompareCards
          items={[
            { title: "Outbound (you choose your exit)", tone: "violet", tag: "strong", points: ["LOCAL_PREF across your AS", "Weight on a single router (vendor)"] },
            { title: "Inbound (others choose)", tone: "warning", tag: "influence only", points: ["AS-path prepending on your announcements", "MED toward one neighbor AS", "More-specific prefixes, communities agreed with the ISP"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="bd-planes" eyebrow="Architecture" title="Control plane vs forwarding" tone="ip">
        <DiagramFrame caption="Only the FIB touches packets.">
          <PlanesDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="bd-trouble" eyebrow="Troubleshooting" title="Common problems" tone="danger">
        <FieldTable
          title="Symptom → usual cause"
          accent="danger"
          columns={["Symptom", "Usual cause"]}
          rows={[
            ["Stuck in Active/Connect", "No TCP: wrong neighbor IP, no route to it, ACL/firewall on 179, wrong update-source"],
            ["NOTIFICATION after OPEN", "Wrong remote AS, bad BGP ID, unsupported capability or auth mismatch"],
            ["Established, 0 prefixes", "Inbound filter, nothing advertised, or wrong address family"],
            ["Route in BGP table but not in RIB", "NEXT_HOP unreachable, or a better route from another protocol"],
            ["Unexpected exit path", "LOCAL_PREF/weight policy, or tie-breakers you didn't expect"],
          ]}
        />
      </GuideSection>

      <GuideSection id="bd-verify" eyebrow="Operations" title="Verification commands" tone="cyan">
        <FieldTable
          title="Common checks (Cisco IOS · Junos)"
          accent="cyan"
          columns={["Question", "Cisco IOS", "Junos"]}
          rows={[
            ["Session states and prefix counts", <Mono key="1">show ip bgp summary</Mono>, <Mono key="2">show bgp summary</Mono>],
            ["All paths for a prefix, with the best marked", <Mono key="3">show ip bgp 203.0.113.0</Mono>, <Mono key="4">show route 203.0.113.0/24 detail</Mono>],
            ["What a neighbor sent me", <Mono key="5">show ip bgp neighbors X received-routes</Mono>, <Mono key="6">show route receive-protocol bgp X</Mono>],
            ["What I send a neighbor", <Mono key="7">show ip bgp neighbors X advertised-routes</Mono>, <Mono key="8">show route advertising-protocol bgp X</Mono>],
          ]}
        />
      </GuideSection>

      <GuideSection id="bd-not" eyebrow="Clear the myths" title="What BGP does NOT do" tone="danger">
        <ChecklistCard
          tone="danger"
          mark="✕"
          title="Not BGP's job"
          items={["It doesn't discover neighbors automatically.", "It doesn't compute shortest paths by link cost. It's policy-first.", "It doesn't forward packets itself.", "It doesn't replace the IGP. It relies on it to reach next hops inside the AS.", "It doesn't guarantee how other ASes route toward you."]}
        />
      </GuideSection>

      <GuideSection id="bd-glossary" eyebrow="Reference" title="Glossary" tone="cyan">
        <Glossary
          items={[
            { term: "NLRI", def: "Network Layer Reachability Information: the prefixes in an UPDATE." },
            { term: "AS_PATH", def: "Ordered list of ASes a route has crossed." },
            { term: "LOCAL_PREF", def: "AS-internal preference for choosing an exit; higher wins." },
            { term: "MED", def: "Multi-Exit Discriminator: a hint to one neighbor AS; lower wins." },
            { term: "next-hop-self", def: "Rewrite NEXT_HOP to yourself when advertising to iBGP peers." },
            { term: "Hold Time", def: "How long without KEEPALIVE/UPDATE before the session is declared dead." },
            { term: "Prepending", def: "Repeating an AS number to make a path look longer." },
            { term: "RIB / FIB", def: "Routing table / forwarding table." },
          ]}
        />
      </GuideSection>

      <GuideSection id="bd-model" eyebrow="In one breath" title="Mental model" tone="violet">
        <div className="rounded-2xl border border-pv-bgp/30 bg-gradient-to-br from-pv-bgp/10 to-pv-violet/5 p-5 text-sm leading-relaxed text-pv-text">
          BGP is <b>diplomacy between networks</b>: configured peers talk over TCP, trade offers (UPDATEs) stamped with the route&apos;s travel history (AS_PATH), and each network picks one favorite per destination by walking an ordered list of preferences that its <b>own policy</b> can tilt. It chooses routes but never forwards packets.
        </div>
      </GuideSection>
    </>
  );
}
