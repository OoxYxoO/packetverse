import { CompareCards, DArrow, DIAGRAM as D, DiagramFrame, DiagramSvg, DNode, DPill, FlowSteps, Glossary, GuideSection } from "@/components/lesson/GuideBlocks";
import { DTable } from "@/components/lesson/FundamentalsGuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { LadderDiagram } from "@/components/lesson/TroubleshootingGuideSvg";

export const FW_DEEP_DIVE_SECTIONS: LessonGuideSectionLink[] = [
  { id: "fwd-route-zone", label: "Route lookup & zones" },
  { id: "fwd-new-flow", label: "New-flow pipeline" },
  { id: "fwd-state", label: "The state table" },
  { id: "fwd-tcp", label: "TCP state on a firewall" },
  { id: "fwd-tuple", label: "Tuple & direction" },
  { id: "fwd-asym", label: "Asymmetric routing" },
  { id: "fwd-oos", label: "Out-of-state packets" },
  { id: "fwd-logs", label: "Policy log vs session log" },
  { id: "fwd-nat", label: "NAT vs no NAT" },
  { id: "fwd-fixes", label: "Designing for symmetry" },
  { id: "fwd-workflow", label: "Workflow" },
  { id: "fwd-glossary", label: "Glossary" },
];

function RouteZoneDiagram() {
  return (
    <DiagramSvg h={140} label="The firewall determines the egress interface by route lookup, and the zone pair from the ingress and egress interfaces">
      <DPill x={100} y={45} text="ingress ge-0/0/0 → trust" color={D.cyan} w={170} />
      <DArrow x1={186} y1={45} x2={236} y2={45} color={D.muted} />
      <DPill x={320} y={45} text="route 10.20.20.20 → ge-0/0/1" color={D.ip} w={170} />
      <DArrow x1={406} y1={45} x2={456} y2={45} color={D.muted} />
      <DPill x={540} y={45} text="egress → dmz" color={D.violet} w={150} />
      <text x={320} y={96} textAnchor="middle" fill={D.text} fontSize={10.5} fontWeight={700}>
        zone pair trust → dmz selects the policy set
      </text>
      <text x={320} y={116} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        Routing decides the zone pair — so a routing change can change which policies (and which firewall) apply.
      </text>
    </DiagramSvg>
  );
}

function NewFlowDiagram() {
  const st = ["session lookup", "route → zone", "policy", "create session", "forward"];
  return (
    <DiagramSvg h={100} label="New-flow pipeline: session lookup, route and zone, policy, create session, forward">
      {st.map((t, i) => {
        const x = 75 + i * 122;
        return (
          <g key={t}>
            <DPill x={x} y={40} text={t} color={i === 2 ? D.warning : i === 3 ? D.success : D.cyan} w={112} />
            {i < st.length - 1 && <DArrow x1={x + 56} y1={40} x2={x + 66} y2={40} color={D.muted} width={1.2} />}
          </g>
        );
      })}
      <text x={320} y={82} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        Only the first packet of a flow walks the whole pipeline; the rest hit the session at step 1.
      </text>
    </DiagramSvg>
  );
}

function StateDiagram() {
  return (
    <DiagramSvg h={176} label="Fields of a session entry: five-tuple, zones, TCP state, per-direction counters, matching rule, timeout">
      <DTable
        x={40}
        y={8}
        title="A session entry"
        cols={[
          { label: "FIELD", w: 170 },
          { label: "EXAMPLE", w: 390 },
        ]}
        rows={[
          ["Five-tuple", "TCP 10.10.10.10:52000 → 10.20.20.20:443"],
          ["Zones / interfaces", "trust ge-0/0/0 → dmz ge-0/0/1"],
          ["State", "SYN seen → SYN-ACK seen → ESTABLISHED"],
          ["Counters", "packets/bytes client→server and server→client"],
          ["Rule · timeout", "ALLOW-WEB · short while half-open, longer once established"],
        ]}
      />
    </DiagramSvg>
  );
}

function TcpStateDiagram() {
  const st = ["SYN seen", "SYN-ACK seen", "ESTABLISHED", "FIN / closing", "removed"];
  return (
    <DiagramSvg h={110} label="TCP state tracked by a firewall: SYN seen, SYN-ACK seen, established, closing, removed; a half-open session times out if the reply never arrives">
      {st.map((t, i) => {
        const x = 70 + i * 125;
        return (
          <g key={t}>
            <DPill x={x} y={40} text={t} color={i === 2 ? D.success : i < 2 ? D.warning : D.faint} w={112} />
            {i < st.length - 1 && <DArrow x1={x + 56} y1={40} x2={x + 69} y2={40} color={D.muted} width={1.2} />}
          </g>
        );
      })}
      <text x={320} y={86} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        A session stuck in &quot;SYN seen&quot; with zero reverse packets is the fingerprint of a reply that went elsewhere.
      </text>
    </DiagramSvg>
  );
}

function TupleDiagram() {
  return (
    <DiagramSvg h={130} label="The reply's five-tuple is the reverse of the request's; the firewall matches either direction to the same session">
      <DTable
        x={40}
        y={8}
        title="One session, two directions"
        cols={[
          { label: "DIRECTION", w: 150 },
          { label: "SRC → DST", w: 300 },
          { label: "MATCHES", w: 110 },
        ]}
        rows={[
          ["client → server", "10.10.10.10:52000 → 10.20.20.20:443", "forward key"],
          ["server → client", "10.20.20.20:443 → 10.10.10.10:52000", "reverse key"],
        ]}
      />
    </DiagramSvg>
  );
}

function AsymDiagram() {
  return (
    <DiagramSvg h={170} label="Asymmetric routing: the request crosses firewall A and creates state; the reply crosses firewall B, which has no state, and is dropped">
      <DNode x={90} y={85} label="host A" accent={D.cyan} w={90} />
      <DNode x={320} y={35} label="FW-A" sub="has state" accent={D.success} w={100} />
      <DNode x={320} y={135} label="FW-B" sub="no state" accent={D.danger} w={100} />
      <DNode x={550} y={85} label="host B" accent={D.cyan} w={90} />
      <DArrow x1={135} y1={75} x2={270} y2={42} color={D.success} label="request" />
      <DArrow x1={370} y1={42} x2={505} y2={75} color={D.success} />
      <DArrow x1={505} y1={95} x2={370} y2={128} color={D.danger} dashed label="reply" labelDy={16} />
      <text x={230} y={142} fill={D.danger} fontSize={13} fontWeight={800}>
        ✕
      </text>
    </DiagramSvg>
  );
}

function OosDiagram() {
  return (
    <DiagramSvg h={150} label="Kinds of out-of-state packets and their usual causes">
      <DTable
        x={30}
        y={8}
        title="Out-of-state drops and what they usually mean"
        cols={[
          { label: "DROPPED PACKET", w: 200 },
          { label: "USUAL CAUSE", w: 380 },
        ]}
        rows={[
          ["SYN-ACK, no session", "asymmetric path: the SYN crossed another firewall"],
          ["ACK / data, no session", "session timed out, or asymmetric path mid-flow"],
          ["Data after RST/FIN", "late packets of a closed session"],
          ["SYN on an existing session", "port reuse too soon (TIME_WAIT)"],
        ]}
      />
    </DiagramSvg>
  );
}

function LogsDiagram() {
  return (
    <DiagramSvg h={140} label="Policy logs record decisions about new flows; session logs and tables record what the flow actually did">
      <DTable
        x={40}
        y={8}
        title="Two different logs"
        cols={[
          { label: "", w: 150 },
          { label: "POLICY LOG", w: 200 },
          { label: "SESSION VIEW", w: 210 },
        ]}
        rows={[
          ["Written when", "a new flow is permitted/denied", "the flow progresses / ends"],
          ["Answers", "was the first packet allowed?", "did the connection work?"],
          ["In this incident", "permit (misleadingly fine)", "SYN seen, 0 reverse packets"],
        ]}
      />
    </DiagramSvg>
  );
}

function NatDiagram() {
  return (
    <DiagramSvg h={140} label="With NAT the firewall rewrites addresses or ports and must see both directions to translate them back; without NAT, addresses are identical on every link">
      <DTable
        x={40}
        y={8}
        title="NAT vs no NAT (this lesson has none)"
        cols={[
          { label: "", w: 170 },
          { label: "NO NAT (here)", w: 190 },
          { label: "WITH SOURCE NAT", w: 200 },
        ]}
        rows={[
          ["Addresses on the server side", "10.10.10.10 (real)", "translated address/port"],
          ["Tuple at client vs server", "identical", "differs"],
          ["Asymmetry impact", "state lost → drop", "state and translation lost"],
        ]}
      />
    </DiagramSvg>
  );
}

function FixesDiagram() {
  return (
    <DiagramSvg h={140} label="Designs that avoid asymmetric-state problems: symmetric routing, clusters with state sync, flow-aware load balancing">
      <DTable
        x={40}
        y={8}
        title="Designing for stateful paths"
        cols={[
          { label: "APPROACH", w: 210 },
          { label: "HOW IT KEEPS STATE CONSISTENT", w: 350 },
        ]}
        rows={[
          ["Symmetric routing", "both directions prefer the same firewall"],
          ["Cluster with state sync", "sessions replicated to the peer"],
          ["Flow-aware balancing", "each flow pinned to one firewall both ways"],
        ]}
      />
    </DiagramSvg>
  );
}

export function FwDeepDiveContent() {
  return (
    <div className="space-y-12">
      <GuideSection id="fwd-route-zone" eyebrow="Pipeline" title="Route lookup and zones" tone="ip">
        <DiagramFrame caption="Zones come from interfaces; interfaces come from routing.">
          <RouteZoneDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="fwd-new-flow" eyebrow="Pipeline" title="The new-flow path" tone="warning">
        <DiagramFrame caption="Policy is evaluated once per flow.">
          <NewFlowDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="fwd-state" eyebrow="State" title="The state table" tone="success">
        <DiagramFrame caption="The single most useful troubleshooting view on a firewall.">
          <StateDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="fwd-tcp" eyebrow="State" title="TCP state on a firewall" tone="success">
        <DiagramFrame caption="Half-open sessions age out quickly.">
          <TcpStateDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="fwd-tuple" eyebrow="State" title="Tuple and direction" tone="violet">
        <DiagramFrame caption="Replies match the reversed tuple.">
          <TupleDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="fwd-asym" eyebrow="Paths" title="Asymmetric routing" tone="danger">
        <DiagramFrame caption="Harmless for routers, fatal for independent stateful devices.">
          <AsymDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="fwd-oos" eyebrow="Drops" title="Out-of-state packets" tone="danger">
        <DiagramFrame caption="The dropped packet's type hints at the cause.">
          <OosDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="fwd-logs" eyebrow="Evidence" title="Policy log vs session log" tone="warning">
        <DiagramFrame caption="Why ALLOW alone is insufficient evidence.">
          <LogsDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="fwd-nat" eyebrow="Context" title="NAT vs no NAT" tone="cyan">
        <DiagramFrame caption="This lesson deliberately has no NAT.">
          <NatDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="fwd-fixes" eyebrow="Design" title="Designing for symmetry" tone="success">
        <DiagramFrame caption="Keep each flow on one firewall — or share the state.">
          <FixesDiagram />
        </DiagramFrame>
        <CompareCards
          items={[
            { title: "Fix the path", tone: "success", tag: "right", points: ["restore symmetric routes", "keep policy tight", "verify with session counters"] },
            { title: "Fix the symptom", tone: "danger", tag: "wrong", points: ["broad reverse rules", "disabling state checks", "hides the next incident"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="fwd-workflow" eyebrow="Workflow" title="A firewall troubleshooting workflow" tone="cyan">
        <DiagramFrame caption="Evidence first, per direction.">
          <DiagramSvg h={150} label="Firewall troubleshooting ladder">
            <LadderDiagram
              rows={[
                { rung: "Did the first packet arrive?", evidence: "interface counters / capture", status: "ok" },
                { rung: "Policy decision", evidence: "policy log: permit / deny", status: "ok" },
                { rung: "Session progress", evidence: "state + per-direction counters", status: "suspect" },
                { rung: "Return path", evidence: "routes toward the client on the far side", status: "suspect" },
                { rung: "Other firewalls", evidence: "drop logs: no session / out-of-state", status: "skip" },
              ]}
            />
          </DiagramSvg>
        </DiagramFrame>
        <FlowSteps
          steps={[
            { title: "Session first", body: "Find the flow's session and read its counters.", tone: "cyan" },
            { title: "Both directions", body: "Trace the reply's path, not just the request's.", tone: "violet" },
            { title: "Every firewall", body: "Check drop logs on the paths that should not be used.", tone: "warning" },
            { title: "Fix the path", body: "Then confirm with a new handshake.", tone: "success" },
          ]}
        />
      </GuideSection>

      <GuideSection id="fwd-glossary" eyebrow="Glossary" title="Terms" tone="cyan">
        <Glossary
          items={[
            { term: "Half-open session", def: "A session that saw the SYN but not yet the SYN-ACK." },
            { term: "Session timeout", def: "How long an idle (or half-open) session is kept." },
            { term: "Policy hit count", def: "How many new flows matched a rule — not how many succeeded." },
            { term: "State sync", def: "Replicating sessions between clustered firewalls." },
            { term: "ECMP", def: "Equal-cost multipath: can split directions across devices unless flow-aware." },
          ]}
        />
      </GuideSection>
    </div>
  );
}
