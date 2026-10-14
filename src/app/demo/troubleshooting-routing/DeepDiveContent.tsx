import { Callout, DArrow, DIAGRAM as D, DiagramFrame, DiagramSvg, DNode, DPill, FlowSteps, Glossary, GuideSection } from "@/components/lesson/GuideBlocks";
import { DTable } from "@/components/lesson/FundamentalsGuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { LadderDiagram, SeqLanes } from "@/components/lesson/TroubleshootingGuideSvg";

export const RT_DEEP_DIVE_SECTIONS: LessonGuideSectionLink[] = [
  { id: "rtd-rib-fib", label: "RIB vs FIB" },
  { id: "rtd-sources", label: "Route sources" },
  { id: "rtd-lpm", label: "Longest-prefix match" },
  { id: "rtd-pref", label: "Preference" },
  { id: "rtd-recursive", label: "Recursive next hop" },
  { id: "rtd-discard", label: "Discard vs reject" },
  { id: "rtd-ospf", label: "Adjacency vs installation" },
  { id: "rtd-pipeline", label: "Lookup pipeline" },
  { id: "rtd-trace", label: "Traceroute" },
  { id: "rtd-workflow", label: "Blackhole workflow" },
  { id: "rtd-glossary", label: "Glossary" },
];

function RibFibDiagram() {
  return (
    <DiagramSvg h={170} label="Route sources feed the RIB; the best route per prefix is installed in the FIB; every packet is looked up in the FIB">
      <DNode x={90} y={40} label="connected" accent={D.success} w={110} h={34} />
      <DNode x={90} y={85} label="static" accent={D.cyan} w={110} h={34} />
      <DNode x={90} y={130} label="OSPF / BGP" accent={D.violet} w={110} h={34} />
      <DNode x={320} y={85} label="RIB" sub="all usable routes" accent={D.ip} w={130} h={60} />
      <DNode x={540} y={85} label="FIB" sub="best per prefix" accent={D.warning} w={130} h={60} />
      <DArrow x1={146} y1={40} x2={254} y2={75} color={D.muted} width={1.3} />
      <DArrow x1={146} y1={85} x2={254} y2={85} color={D.muted} width={1.3} />
      <DArrow x1={146} y1={130} x2={254} y2={95} color={D.muted} width={1.3} />
      <DArrow x1={386} y1={85} x2={474} y2={85} color={D.warning} label="install" />
      <text x={540} y={140} textAnchor="middle" fill={D.muted} fontSize={9}>
        packet lookup: longest match
      </text>
    </DiagramSvg>
  );
}

function SourcesDiagram() {
  return (
    <DiagramSvg h={150} label="Route sources and their typical preferences: connected 0, static 5 (AD 1), OSPF 10 (AD 110), BGP 170 (eBGP AD 20)">
      <DTable
        x={60}
        y={8}
        title="Route sources (Juniper-style preference · Cisco-style AD)"
        cols={[
          { label: "SOURCE", w: 170 },
          { label: "PREFERENCE", w: 130 },
          { label: "AD", w: 110 },
          { label: "ORIGIN", w: 110 },
        ]}
        rows={[
          ["Connected / local", "0", "0", "interfaces"],
          ["Static", "5", "1", "configuration"],
          ["OSPF internal", "10", "110", "LSDB + SPF"],
          ["BGP", "170", "20 eBGP / 200 iBGP", "peers"],
        ]}
      />
    </DiagramSvg>
  );
}

function LpmDiagram() {
  return (
    <DiagramSvg h={170} label="Longest-prefix match: for 172.16.20.20, routes /0, /16, /24 and /32 match; the /32 is chosen">
      <DTable
        x={60}
        y={8}
        title="Destination 172.16.20.20"
        cols={[
          { label: "ROUTE", w: 200 },
          { label: "MATCHES?", w: 110 },
          { label: "", w: 210 },
        ]}
        rows={[
          ["0.0.0.0/0", "yes", "least specific"],
          ["172.16.0.0/16", "yes", ""],
          ["172.16.20.0/24", "yes", ""],
          ["172.16.20.20/32", "yes", "← most specific: chosen"],
          ["172.16.21.0/24", "no", ""],
        ]}
        highlight={{ row: 3, color: D.success }}
      />
    </DiagramSvg>
  );
}

function PrefDiagram() {
  return (
    <DiagramSvg h={150} label="Preference in action: a static and an OSPF route for the same prefix 172.16.20.0/24; the static route with the better preference is installed">
      <DTable
        x={60}
        y={8}
        title="Same prefix, two sources — preference decides"
        cols={[
          { label: "CANDIDATE FOR 172.16.20.0/24", w: 260 },
          { label: "PREF / AD", w: 120 },
          { label: "RESULT", w: 140 },
        ]}
        rows={[
          ["static via 192.0.2.5", "5 / 1", "installed"],
          ["OSPF via 192.0.2.1", "10 / 110", "kept as backup"],
        ]}
        highlight={{ row: 0, color: D.warning }}
      />
      <text x={320} y={100} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        Floating statics use a WORSE preference on purpose so they appear only when the dynamic route disappears.
      </text>
    </DiagramSvg>
  );
}

function RecursiveDiagram() {
  return (
    <DiagramSvg h={140} label="Recursive next hop: a route via 10.0.0.9 is resolved by looking up 10.0.0.9 itself, which yields the outgoing interface">
      <DPill x={120} y={40} text="203.0.113.0/24 via 10.0.0.9" color={D.cyan} w={200} />
      <DArrow x1={222} y1={40} x2={318} y2={40} color={D.muted} />
      <DPill x={455} y={40} text="lookup 10.0.0.9 → via 192.0.2.1 ge-0/0/1" color={D.violet} w={270} />
      <text x={320} y={86} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        A route is usable only if its next hop resolves. BGP routes typically resolve through the IGP.
      </text>
      <text x={320} y={104} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        An unresolvable next hop leaves the route in the RIB but inactive.
      </text>
    </DiagramSvg>
  );
}

function DiscardDiagram() {
  return (
    <DiagramSvg h={170} label="Discard drops silently; reject drops and returns ICMP destination unreachable">
      <text x={160} y={18} textAnchor="middle" fill={D.warning} fontSize={10.5} fontWeight={700}>
        discard (null route)
      </text>
      <text x={480} y={18} textAnchor="middle" fill={D.danger} fontSize={10.5} fontWeight={700}>
        reject
      </text>
      <line x1={320} y1={10} x2={320} y2={160} stroke={D.line} strokeDasharray="3 4" />
      <SeqLanes
        top={44}
        lanes={[
          { x: 60, label: "host", color: D.cyan },
          { x: 260, label: "router", color: D.violet },
        ]}
        msgs={[
          { from: 0, to: 1, label: "packet" },
          { from: 1, to: 0, label: "(nothing)", color: D.faint },
        ]}
      />
      <SeqLanes
        top={44}
        lanes={[
          { x: 380, label: "host", color: D.cyan },
          { x: 580, label: "router", color: D.violet },
        ]}
        msgs={[
          { from: 0, to: 1, label: "packet" },
          { from: 1, to: 0, label: "ICMP unreachable", color: D.danger },
        ]}
      />
    </DiagramSvg>
  );
}

function OspfInstallDiagram() {
  return (
    <DiagramSvg h={170} label="An OSPF adjacency being Full does not guarantee the route is installed or used: filters, better sources and more-specific routes can all intervene">
      <DTable
        x={30}
        y={8}
        title="OSPF Full, yet traffic does not follow the OSPF route — why?"
        cols={[
          { label: "REASON", w: 230 },
          { label: "EVIDENCE", w: 350 },
        ]}
        rows={[
          ["More specific route elsewhere", "lookup of the exact address shows another entry"],
          ["Better-preference source, same prefix", "RIB shows OSPF route inactive"],
          ["Route filtered from the RIB", "in LSDB, absent from the routing table"],
          ["Next hop unresolved / down", "route inactive or hidden"],
        ]}
      />
    </DiagramSvg>
  );
}

function PipelineDiagram() {
  const st = ["receive", "match all", "longest prefix", "action", "TTL − 1", "L2 rewrite"];
  return (
    <DiagramSvg h={100} label="Packet lookup pipeline: receive, collect matches, longest prefix, action forward or discard, TTL decrement, Layer 2 rewrite">
      {st.map((t, i) => {
        const x = 70 + i * 100;
        return (
          <g key={t}>
            <DPill x={x} y={40} text={t} color={i === 3 ? D.warning : D.cyan} w={92} />
            {i < st.length - 1 && <DArrow x1={x + 46} y1={40} x2={x + 54} y2={40} color={D.muted} width={1.2} />}
          </g>
        );
      })}
      <text x={320} y={82} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        A discard action ends the pipeline at step 4: no TTL change, no transmit.
      </text>
    </DiagramSvg>
  );
}

function TraceDiagram() {
  return (
    <DiagramSvg h={170} label="Reading traceroute output: stars, the last answering hop, ICMP unreachable codes and asymmetric return paths">
      <DTable
        x={20}
        y={8}
        title="Interpreting traceroute"
        cols={[
          { label: "YOU SEE", w: 220 },
          { label: "USUALLY MEANS", w: 380 },
        ]}
        rows={[
          ["* * * after hop N", "dropped at/after hop N: discard, filter, rate-limit"],
          ["!N / !H at hop N", "hop N returned net/host unreachable (reject route, no route)"],
          ["stars mid-path, later hops answer", "that router just does not reply — not a failure"],
          ["hops differ from expected", "a different route is selected; check the lookup there"],
        ]}
      />
    </DiagramSvg>
  );
}

export function RtDeepDiveContent() {
  return (
    <div className="space-y-12">
      <GuideSection id="rtd-rib-fib" eyebrow="Tables" title="RIB vs FIB" tone="ip">
        <DiagramFrame caption="The routing protocol proposes; the FIB decides.">
          <RibFibDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="rtd-sources" eyebrow="Sources" title="Connected, static and dynamic routes" tone="cyan">
        <DiagramFrame caption="Values are typical defaults; exact numbers are vendor-specific.">
          <SourcesDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="rtd-lpm" eyebrow="Selection" title="Longest-prefix match" tone="success">
        <DiagramFrame caption="Specificity first, always.">
          <LpmDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="rtd-pref" eyebrow="Selection" title="Preference among equal prefixes" tone="warning">
        <DiagramFrame caption="Preference ranks sources for one prefix — nothing more.">
          <PrefDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="rtd-recursive" eyebrow="Resolution" title="Recursive next hops" tone="violet">
        <DiagramFrame caption="A route is only as usable as its next hop.">
          <RecursiveDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="rtd-discard" eyebrow="Special routes" title="Discard vs reject" tone="danger">
        <DiagramFrame caption="Silence vs an explicit error.">
          <DiscardDiagram />
        </DiagramFrame>
        <Callout tone="cyan" title="Legitimate uses">
          Discard routes are normal for aggregate summaries (to prevent loops for unused parts of a summary) and for deliberate blackholing during attacks or migrations. The danger is forgetting to remove a temporary one.
        </Callout>
      </GuideSection>

      <GuideSection id="rtd-ospf" eyebrow="Control plane" title="Adjacency vs route installation" tone="violet">
        <DiagramFrame caption="Full adjacency is only the first requirement.">
          <OspfInstallDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="rtd-pipeline" eyebrow="Data plane" title="The packet lookup pipeline" tone="ip">
        <DiagramFrame caption="What a router does with every packet.">
          <PipelineDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="rtd-trace" eyebrow="Tools" title="Traceroute interpretation" tone="warning">
        <DiagramFrame caption="Stars are evidence, not a verdict.">
          <TraceDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="rtd-workflow" eyebrow="Workflow" title="Isolating a blackhole" tone="cyan">
        <DiagramFrame caption="Scope, then follow the exact address.">
          <DiagramSvg h={150} label="Blackhole isolation ladder">
            <LadderDiagram
              rows={[
                { rung: "Scope", evidence: "which destinations fail? which work?", status: "ok" },
                { rung: "Control plane", evidence: "adjacencies, LSDB, route present?", status: "ok" },
                { rung: "Exact lookup", evidence: "show route <failing address>", status: "suspect" },
                { rung: "Counters / captures", evidence: "where do packets stop?", status: "suspect" },
                { rung: "Verify", evidence: "same tests after one change", status: "skip" },
              ]}
            />
          </DiagramSvg>
        </DiagramFrame>
        <FlowSteps
          steps={[
            { title: "Compare", body: "A working and a failing destination.", tone: "cyan" },
            { title: "Look up", body: "The failing address, on each hop.", tone: "violet" },
            { title: "Count", body: "Where packets appear and disappear.", tone: "warning" },
            { title: "Change one thing", body: "Then re-run the same tests.", tone: "success" },
          ]}
        />
      </GuideSection>

      <GuideSection id="rtd-glossary" eyebrow="Glossary" title="Terms" tone="cyan">
        <Glossary
          items={[
            { term: "Floating static", def: "A static route with a deliberately worse preference, used as a backup." },
            { term: "Null / discard route", def: "A route that silently drops matching traffic." },
            { term: "Reject route", def: "A route that drops traffic and returns ICMP unreachable." },
            { term: "Recursive lookup", def: "Resolving a route's next hop through another lookup." },
            { term: "CEF / FIB", def: "Vendor names for the forwarding table built from the RIB." },
          ]}
        />
      </GuideSection>
    </div>
  );
}
