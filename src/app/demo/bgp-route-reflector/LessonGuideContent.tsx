import { Callout, ChecklistCard, DArrow, DIAGRAM as D, DLink, DNode, DPill, DRegion, DiagramFrame, DiagramSvg, FieldTable, FlowSteps, GuideSection, Mono } from "@/components/lesson/GuideBlocks";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";

export const RR_LESSON_SECTIONS: LessonGuideSectionLink[] = [
  { id: "rl-mission", label: "The mission" },
  { id: "rl-mesh", label: "Full-mesh iBGP" },
  { id: "rl-scale", label: "n(n−1)/2" },
  { id: "rl-split", label: "The rule it bends" },
  { id: "rl-rr", label: "Enter RR1" },
  { id: "rl-pipeline", label: "RR1's four stages" },
  { id: "rl-attrs", label: "ORIGINATOR_ID & CLUSTER_LIST" },
  { id: "rl-rules", label: "The four reflection rules" },
  { id: "rl-tworr", label: "A second RR" },
  { id: "rl-compare", label: "Sessions: mesh vs RR" },
  { id: "rl-not", label: "What an RR doesn't do" },
  { id: "rl-vpnv4", label: "VPNv4 through the RR" },
  { id: "rl-fault", label: "The PE3 fault" },
  { id: "rl-challenge", label: "The redesign challenge" },
  { id: "rl-recap", label: "Recap" },
];

function MeshDiagram() {
  const pos: Record<string, [number, number]> = { PE1: [170, 50], PE2: [470, 50], PE3: [170, 170], PE4: [470, 170] };
  const ids = Object.keys(pos);
  const edges: [string, string][] = [];
  ids.forEach((a, i) => ids.slice(i + 1).forEach((b) => edges.push([a, b])));
  return (
    <DiagramSvg h={220} label="Four PEs in a full iBGP mesh: six sessions">
      {edges.map(([a, b]) => (
        <DLink key={a + b} x1={pos[a][0]} y1={pos[a][1]} x2={pos[b][0]} y2={pos[b][1]} color={D.bgp} />
      ))}
      {ids.map((id) => (
        <DNode key={id} x={pos[id][0]} y={pos[id][1]} label={id} sub={{ PE1: "1.1.1.1", PE2: "4.4.4.4", PE3: "5.5.5.5", PE4: "6.6.6.6" }[id]} />
      ))}
      <text x={320} y={210} textAnchor="middle" fill={D.muted} fontSize={10}>
        AS 65000 · every PE peers with every other PE
      </text>
    </DiagramSvg>
  );
}

function SplitDiagram() {
  return (
    <DiagramSvg h={150} label="PE1 advertises to PE2, but PE2 does not re-advertise to PE3">
      <DNode x={100} y={70} label="PE1" sub="10.1.1.0/24" />
      <DNode x={320} y={70} label="PE2" />
      <DNode x={540} y={70} label="PE3" />
      <DArrow x1={152} y1={70} x2={268} y2={70} color={D.success} label="iBGP UPDATE" />
      <DArrow x1={372} y1={70} x2={450} y2={70} color={D.danger} dashed />
      <text x={462} y={77} fill={D.danger} fontSize={18} fontWeight={700}>
        ✕
      </text>
      <text x={320} y={130} textAnchor="middle" fill={D.muted} fontSize={10}>
        iBGP-learned routes are not passed to another ordinary iBGP peer
      </text>
    </DiagramSvg>
  );
}

function HubDiagram() {
  const pes: [string, number][] = [
    ["PE1", 110],
    ["PE2", 250],
    ["PE3", 390],
    ["PE4", 530],
  ];
  return (
    <DiagramSvg h={200} label="RR1 in the middle with PE1 to PE4 as its clients: four sessions">
      <DRegion x={20} y={10} w={600} h={180} label="cluster 100.100.100.100" color={D.violet} />
      {pes.map(([p, x]) => (
        <DLink key={p} x1={320} y1={70} x2={x} y2={150} color={D.violet} />
      ))}
      <DNode x={320} y={60} label="RR1" sub="9.9.9.9" accent={D.violet} />
      {pes.map(([p, x]) => (
        <DNode key={p} x={x} y={150} label={p} sub="client" w={84} />
      ))}
    </DiagramSvg>
  );
}

function PipelineDiagram() {
  const st: [string, string][] = [
    ["ROUTE RECEIVED", D.ospf],
    ["BEST PATH SELECTED", D.success],
    ["REFLECTION DECISION", D.violet],
    ["ROUTE REFLECTED", D.bgp],
  ];
  return (
    <DiagramSvg h={120} label="RR1 pipeline: route received, best path selected, reflection decision, route reflected">
      {st.map(([s, c], i) => (
        <g key={s}>
          <DPill x={82 + i * 158} y={50} text={s} color={c} w={146} />
          {i < st.length - 1 && <DArrow x1={156 + i * 158} y1={50} x2={162 + i * 158} y2={50} color={D.faint} width={1.6} />}
        </g>
      ))}
      <text x={320} y={100} textAnchor="middle" fill={D.muted} fontSize={10}>
        only the third stage is new; the rest is ordinary BGP
      </text>
    </DiagramSvg>
  );
}

function AttrDiagram() {
  const row = (y: number, who: string, extra: string, c: string) => (
    <g>
      <text x={20} y={y + 20} fill={D.text} fontSize={11.5} fontWeight={600}>
        {who}
      </text>
      <rect x={140} y={y} width={490} height={32} rx={8} fill={c} fillOpacity={0.1} stroke={c} />
      <text x={152} y={y + 20} fill={D.text} fontSize={10} fontFamily="monospace">
        10.1.1.0/24 · NH 1.1.1.1 · LP 100{extra}
      </text>
    </g>
  );
  return (
    <DiagramSvg h={150} label="The reflected UPDATE adds ORIGINATOR_ID and CLUSTER_LIST but keeps NEXT_HOP">
      {row(14, "PE1 → RR1", "", D.ospf)}
      {row(60, "RR1 → clients", " · ORIG 1.1.1.1 · CL [100.100.100.100]", D.violet)}
      {row(106, "via RR2 too", " · ORIG 1.1.1.1 · CL [200…, 100…]", D.bgp)}
    </DiagramSvg>
  );
}

function TwoRrDiagram() {
  return (
    <DiagramSvg h={220} label="RR1 serves PE1 and PE2, RR2 serves PE3 and PE4, and RR1 and RR2 peer as non-clients">
      <DRegion x={14} y={10} w={296} h={200} label="cluster 100.100.100.100" color={D.violet} />
      <DRegion x={330} y={10} w={296} h={200} label="cluster 200.200.200.200" color={D.bgp} />
      <DLink x1={162} y1={70} x2={90} y2={160} color={D.violet} />
      <DLink x1={162} y1={70} x2={234} y2={160} color={D.violet} />
      <DLink x1={478} y1={70} x2={406} y2={160} color={D.bgp} />
      <DLink x1={478} y1={70} x2={550} y2={160} color={D.bgp} />
      <DLink x1={212} y1={60} x2={428} y2={60} color={D.warning} dashed label="non-client iBGP" />
      <DNode x={162} y={60} label="RR1" sub="9.9.9.9" accent={D.violet} />
      <DNode x={478} y={60} label="RR2" sub="10.10.10.10" accent={D.bgp} />
      <DNode x={90} y={165} label="PE1" w={80} />
      <DNode x={234} y={165} label="PE2" w={80} />
      <DNode x={406} y={165} label="PE3" w={80} />
      <DNode x={550} y={165} label="PE4" w={80} />
    </DiagramSvg>
  );
}

function PlanesDiagram() {
  return (
    <DiagramSvg h={200} label="The VPNv4 route goes through the RR; customer traffic goes directly between PEs over the MPLS core">
      <DNode x={320} y={40} label="RR1" sub="control plane only" accent={D.violet} w={150} />
      <DNode x={110} y={150} label="PE1" />
      <DNode x={530} y={150} label="PE2" />
      <DArrow x1={500} y1={126} x2={380} y2={60} color={D.violet} label="VPNv4 UPDATE" labelDy={-6} />
      <DArrow x1={260} y1={60} x2={140} y2={126} color={D.violet} label="reflected" labelDy={-6} />
      <DArrow x1={162} y1={160} x2={478} y2={160} color={D.mpls} both label="customer packets (MPLS core, never via RR)" labelDy={-8} />
    </DiagramSvg>
  );
}

export function RrLessonGuideContent() {
  return (
    <>
      <GuideSection id="rl-mission" eyebrow="Introduction" title="The mission: scale iBGP inside AS 65000" tone="violet">
        <p>
          Four PE routers (PE1–PE4) in provider <b className="text-pv-text">AS 65000</b> run iBGP in a full mesh. It works, but the lesson asks what happens as the provider grows, and shows how a <b className="text-pv-text">Route Reflector</b> bends one iBGP rule to cut the mesh down to hub-and-spoke.
        </p>
        <Callout tone="cyan" title="Scope of this simulation" icon="i">
          iBGP only, one AS, one prefix (<Mono>10.1.1.0/24</Mono> originated by PE1). No eBGP, no MPLS forwarding, no label allocation. Confederations, Add-Path and advanced RR redundancy designs are only mentioned, not simulated.
        </Callout>
      </GuideSection>

      <GuideSection id="rl-mesh" eyebrow="The problem" title="Full-mesh iBGP" tone="bgp">
        <DiagramFrame caption="Every PE learns every other PE's routes directly, because it has a session to each of them.">
          <MeshDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="rl-scale" eyebrow="The problem" title="Why it doesn't scale: n(n−1)/2" tone="danger">
        <FieldTable
          title="Full-mesh sessions"
          accent="danger"
          columns={["Routers", "Sessions"]}
          rows={[
            ["4", "6"],
            ["10", "45"],
            ["50", "1,225"],
            ["100", "4,950"],
          ]}
        />
        <p>Every session is configuration, memory, CPU and something to monitor, and adding one router means touching every existing one.</p>
      </GuideSection>

      <GuideSection id="rl-split" eyebrow="Root cause" title="The rule a Route Reflector bends" tone="bgp">
        <p>
          PE1 advertises <Mono>10.1.1.0/24</Mono> to PE2. By <b className="text-pv-text">iBGP split horizon</b>, PE2 won&apos;t pass that iBGP-learned route on to PE3, another ordinary iBGP peer. Inside one AS, AS_PATH doesn&apos;t change, so this rule is what prevents loops. It is also why every PE needs a direct session to every other PE.
        </p>
        <DiagramFrame caption="Split horizon prevents loops, and forces the full mesh.">
          <SplitDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="rl-rr" eyebrow="The fix" title="Enter RR1" tone="violet">
        <p>
          Same four PEs, same AS, but now each PE peers only with <b className="text-pv-text">RR1</b>. RR1 is still plain BGP; it is simply allowed to re-advertise (reflect) iBGP routes for its <b className="text-pv-text">clients</b>.
        </p>
        <DiagramFrame caption="Four sessions instead of six, and the gap widens quickly as PEs are added.">
          <HubDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="rl-pipeline" eyebrow="Walkthrough" title="What RR1 does with PE1's UPDATE" tone="violet">
        <DiagramFrame caption="The lesson steps through these four stages one at a time.">
          <PipelineDiagram />
        </DiagramFrame>
        <FlowSteps
          steps={[
            { title: "Route received", body: "PE1 (a client) sends a normal iBGP UPDATE: prefix, NEXT_HOP, LOCAL_PREF.", tone: "cyan" },
            { title: "Best path selected", body: "Ordinary best-path selection runs; with one candidate it wins trivially.", tone: "success" },
            { title: "Reflection decision", body: "The route came from a client, so it is reflected to all other clients and to non-client peers.", tone: "violet" },
            { title: "Route reflected", body: "RR1 sends it to PE2, PE3 and PE4, adding two attributes first.", tone: "violet" },
          ]}
        />
      </GuideSection>

      <GuideSection id="rl-attrs" eyebrow="Loop prevention" title="ORIGINATOR_ID and CLUSTER_LIST" tone="warning">
        <p>
          Reflecting removes split horizon&apos;s protection, so the RR adds replacement safety: <b className="text-pv-text">ORIGINATOR_ID</b> = the originator&apos;s router ID (<Mono>1.1.1.1</Mono>), and its own cluster ID appended to <b className="text-pv-text">CLUSTER_LIST</b> (<Mono>100.100.100.100</Mono>). NEXT_HOP, LOCAL_PREF and the prefix are unchanged.
        </p>
        <DiagramFrame caption="The route gains attributes as it is reflected; it never gains an AS_PATH hop inside the AS.">
          <AttrDiagram />
        </DiagramFrame>
        <ChecklistCard
          tone="warning"
          mark="↺"
          title="How they stop loops"
          items={["A router that sees its own router ID as ORIGINATOR_ID ignores the route.", "An RR that sees its own cluster ID in CLUSTER_LIST ignores the route. This works like AS_PATH, but between clusters."]}
        />
      </GuideSection>

      <GuideSection id="rl-rules" eyebrow="Rules" title="The four reflection rules" tone="violet">
        <FieldTable
          title="What the RR does with a route learned from…"
          accent="violet"
          columns={["Learned from", "Sent to clients?", "Sent to non-clients?"]}
          rows={[
            ["A client", "Yes (all other clients)", "Yes"],
            ["A non-client iBGP peer", "Yes", "No: ordinary split horizon still applies"],
          ]}
        />
        <p>Clients and non-clients send routes to the RR exactly as to any iBGP peer; nothing changes on their side.</p>
      </GuideSection>

      <GuideSection id="rl-tworr" eyebrow="Redundancy" title="A second route reflector" tone="bgp">
        <p>
          One RR is a single point of failure, so the lesson adds <b className="text-pv-text">RR2</b> (cluster <Mono>200.200.200.200</Mono>) with PE3 and PE4 as its clients. RR1 and RR2 peer as ordinary non-client iBGP. PE1&apos;s route reaches RR1, which reflects it to PE2 and to RR2 (it&apos;s client-learned); RR2 reflects it to its own clients and appends its cluster ID.
        </p>
        <DiagramFrame caption="The route arriving at PE3/PE4 carries a two-entry CLUSTER_LIST.">
          <TwoRrDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="rl-compare" eyebrow="Numbers" title="Sessions: full mesh vs reflection" tone="success">
        <p>
          For these 4 PEs a full mesh needs 6 sessions; the two-RR design needs 5 (two clients per RR plus RR1↔RR2). That&apos;s a small win at 4 routers, but at 100 routers the mesh needs 4,950 while a two-RR design needs roughly one session per PE.
        </p>
      </GuideSection>

      <GuideSection id="rl-not" eyebrow="Boundaries" title="What a Route Reflector does NOT do" tone="danger">
        <ChecklistCard
          tone="danger"
          mark="✕"
          title="Not an RR's job"
          items={["It isn't a new protocol. It's BGP with a re-advertisement exception.", "It doesn't replace the IGP.", "It doesn't forward MPLS or customer packets.", "It doesn't allocate VPN labels.", "It doesn't change NEXT_HOP by default."]}
        />
      </GuideSection>

      <GuideSection id="rl-vpnv4" eyebrow="Tie-in" title="The VPNv4 route through the RR" tone="violet">
        <p>
          The same mechanism carries MPLS L3VPN routes. PE2 advertises <Mono>10.2.2.0/24</Mono> (RD <Mono>65001:102</Mono>, RT <Mono>65001:100</Mono>, VPN label <Mono>24002</Mono>) to RR1, which reflects it to PE1, touching only ORIGINATOR_ID and CLUSTER_LIST. It never interprets the RD, RT or label.
        </p>
        <DiagramFrame caption="Control plane through the RR; data plane directly between PEs.">
          <PlanesDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="rl-fault" eyebrow="Troubleshooting" title="The PE3 fault" tone="danger">
        <p>
          An engineer reconfigures PE3&apos;s session on RR2 without the client flag. The session is Established, the IGP, TCP/179 and best-path selection are all healthy, yet <Mono>10.1.1.0/24</Mono> is missing from PE3&apos;s BGP table.
        </p>
        <Callout tone="warning" title="How to reason about it" icon="?">
          Trace the route&apos;s journey hop by hop: where did RR2 learn it from, and what does the rules table say RR2 may do with a route from that kind of peer, toward that kind of peer?
        </Callout>
      </GuideSection>

      <GuideSection id="rl-challenge" eyebrow="Engineer challenge" title="The 6-PE redesign: how to evaluate a design" tone="violet">
        <p>Six PEs in a full mesh need 15 sessions. The engine checks each candidate design against four criteria:</p>
        <ChecklistCard
          tone="violet"
          mark="→"
          title="Evaluation criteria (no spoilers)"
          items={[
            "Coverage: is every PE a client of some RR?",
            "Distribution: can a route from one cluster reach clients of the other? (Check how the RRs are connected.)",
            "Redundancy: does losing one RR take down all reflection?",
            "Scale: are there fewer sessions than the 15-session mesh?",
          ]}
        />
      </GuideSection>

      <GuideSection id="rl-recap" eyebrow="Recap" title="What you saw" tone="violet">
        <div className="rounded-2xl border border-pv-violet/30 bg-gradient-to-br from-pv-violet/10 to-pv-bgp/5 p-5 text-sm leading-relaxed text-pv-text">
          iBGP split horizon keeps routes from looping inside an AS but forces a full mesh that grows as n(n−1)/2. A Route Reflector is plain BGP allowed to re-advertise for its clients; it compensates with ORIGINATOR_ID and CLUSTER_LIST. The four rules decide who hears what, and a misclassified peer (client vs non-client) silently loses routes even though its session is up.
        </div>
      </GuideSection>
    </>
  );
}
