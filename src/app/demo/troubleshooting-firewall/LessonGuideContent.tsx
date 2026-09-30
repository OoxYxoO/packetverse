import { Callout, ChecklistCard, DArrow, DIAGRAM as D, DiagramFrame, DiagramSvg, DLink, DNode, Glossary, GuideSection } from "@/components/lesson/GuideBlocks";
import { DTable } from "@/components/lesson/FundamentalsGuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { LadderDiagram, SeqLanes, WorkflowDiagram } from "@/components/lesson/TroubleshootingGuideSvg";
import { FLOW, IP, POLICY } from "@/lib/sim-engine/scenarios/troubleshootingFirewall";

export const FW_LESSON_SECTIONS: LessonGuideSectionLink[] = [
  { id: "fwl-mission", label: "The mission" },
  { id: "fwl-method", label: "The method" },
  { id: "fwl-topology", label: "Topology" },
  { id: "fwl-baseline", label: "A healthy handshake" },
  { id: "fwl-policy-session", label: "Policy vs session" },
  { id: "fwl-table", label: "The session table" },
  { id: "fwl-paths", label: "Two directions, two paths" },
  { id: "fwl-incident", label: "The broken handshake" },
  { id: "fwl-evidence", label: "Who saw what" },
  { id: "fwl-routes", label: "Both routes" },
  { id: "fwl-ruled-out", label: "Ruling out" },
  { id: "fwl-repairs", label: "Right vs wrong repairs" },
  { id: "fwl-ladder", label: "Evidence ladder" },
  { id: "fwl-verify", label: "Verify" },
  { id: "fwl-glossary", label: "Glossary" },
];

const I = FLOW.incident;

function Topology({ fwdColor = D.success, retVia = "FW1" as "FW1" | "FW2" }) {
  return (
    <g>
      <DNode x={50} y={95} label="CLIENT" sub={IP.client} accent={D.cyan} w={96} />
      <DNode x={180} y={95} label="EDGE-R1" accent={D.violet} w={92} />
      <DNode x={320} y={40} label="FW1" sub="stateful" accent={D.warning} w={92} />
      <DNode x={320} y={150} label="FW2" sub="stateful" accent={D.warning} w={92} />
      <DNode x={460} y={95} label="EDGE-R2" accent={D.violet} w={92} />
      <DNode x={590} y={95} label="SERVER" sub={`${IP.server}:443`} accent={D.success} w={96} />
      <DLink x1={98} y1={95} x2={134} y2={95} />
      <DLink x1={506} y1={95} x2={542} y2={95} />
      <DArrow x1={222} y1={82} x2={274} y2={50} color={fwdColor} />
      <DArrow x1={366} y1={50} x2={418} y2={82} color={fwdColor} />
      {retVia === "FW1" ? (
        <g>
          <DArrow x1={414} y1={92} x2={362} y2={60} color={D.cyan} dashed />
          <DArrow x1={278} y1={60} x2={226} y2={92} color={D.cyan} dashed />
        </g>
      ) : (
        <g>
          <DArrow x1={418} y1={108} x2={366} y2={140} color={D.danger} dashed />
          <text x={378} y={134} fill={D.danger} fontSize={14} fontWeight={800}>
            ✕
          </text>
        </g>
      )}
      <DLink x1={222} y1={108} x2={274} y2={140} color={D.line} />
    </g>
  );
}

function TopologyDiagram() {
  return (
    <DiagramSvg h={200} label="CLIENT, EDGE-R1, FW1 above and FW2 below, EDGE-R2 and SERVER; healthy: the request and the reply both cross FW1">
      <Topology />
      <text x={320} y={194} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        Solid: request (via FW1). Dashed: reply (via FW1). FW2 is an available path with no share of FW1&apos;s state.
      </text>
    </DiagramSvg>
  );
}

function BaselineDiagram() {
  return (
    <DiagramSvg h={170} label="Healthy handshake: SYN permitted by FW1 and a session is created; SYN-ACK returns through FW1 and matches the session; ACK completes">
      <SeqLanes
        lanes={[
          { x: 80, label: "CLIENT", color: D.cyan },
          { x: 320, label: "FW1", color: D.warning },
          { x: 560, label: "SERVER", color: D.success },
        ]}
        msgs={[
          { from: 0, to: 2, label: "SYN", sub: "FW1: policy permit → session created" },
          { from: 2, to: 0, label: "SYN, ACK", sub: "FW1: session match (no reverse policy)", color: D.success },
          { from: 0, to: 2, label: "ACK", sub: "FW1: session ESTABLISHED" },
        ]}
      />
    </DiagramSvg>
  );
}

function PolicySessionDiagram() {
  return (
    <DiagramSvg h={150} label="A new SYN goes through route, zone and policy checks and creates a session; every later packet in either direction is matched against the session">
      <DTable
        x={40}
        y={8}
        title="What a stateful firewall checks"
        cols={[
          { label: "PACKET", w: 170 },
          { label: "SESSION EXISTS?", w: 130 },
          { label: "WHAT HAPPENS", w: 260 },
        ]}
        rows={[
          ["SYN (new flow)", "no", "route → zone → policy → create session"],
          ["SYN-ACK / ACK / data", "yes", "forward by session, update state"],
          ["SYN-ACK / ACK / data", "no", "drop: out-of-state"],
        ]}
        highlight={{ row: 2, color: D.danger }}
      />
    </DiagramSvg>
  );
}

function SessionTableDiagram() {
  return (
    <DiagramSvg h={130} label="FW1's baseline session: five-tuple, state ESTABLISHED, packets in both directions, rule ALLOW-WEB">
      <DTable
        x={40}
        y={8}
        title="FW1 session (baseline)"
        cols={[
          { label: "FIVE-TUPLE", w: 250 },
          { label: "STATE", w: 110 },
          { label: "C→S / S→C", w: 90 },
          { label: "RULE", w: 110 },
        ]}
        rows={[[`TCP ${IP.client}:${FLOW.healthy.sport} → ${IP.server}:443`, "ESTABLISHED", "2 / 1", POLICY.name]]}
      />
    </DiagramSvg>
  );
}

function PathsDiagram() {
  return (
    <DiagramSvg h={200} label="During the incident the request crosses FW1 while EDGE-R2 sends the reply to FW2, where it is dropped">
      <Topology retVia="FW2" />
      <text x={320} y={194} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        Request via FW1 (session created) · reply routed to FW2 (no session → drop).
      </text>
    </DiagramSvg>
  );
}

function IncidentDiagram() {
  return (
    <DiagramSvg h={200} label="Broken handshake: SYN through FW1 to SERVER; SYN-ACK from SERVER to FW2, dropped; client retransmits SYN; FW2 drops the repeated SYN-ACK">
      <SeqLanes
        lanes={[
          { x: 70, label: "CLIENT", color: D.cyan },
          { x: 220, label: "FW1", color: D.warning },
          { x: 420, label: "FW2", color: D.warning },
          { x: 580, label: "SERVER", color: D.success },
        ]}
        msgs={[
          { from: 0, to: 3, label: `SYN seq ${I.isnC}`, sub: "FW1: permit · session created" },
          { from: 3, to: 2, label: `SYN, ACK ack ${I.isnC + 1}`, sub: "FW2: no matching session → drop", color: D.danger },
          { from: 0, to: 3, label: `SYN seq ${I.isnC} (retransmission)`, color: D.warning },
          { from: 3, to: 2, label: "SYN, ACK (same)", sub: "dropped again", color: D.danger },
        ]}
      />
    </DiagramSvg>
  );
}

function EvidenceDiagram() {
  return (
    <DiagramSvg h={150} label="Evidence per device: FW1 half-open session with zero reverse packets, SERVER capture shows SYN in and SYN-ACK out, FW2 logs no-session drops">
      <DTable
        x={30}
        y={8}
        title={`Flow :${I.sport} — who saw what`}
        cols={[
          { label: "DEVICE", w: 110 },
          { label: "EVIDENCE", w: 470 },
        ]}
        rows={[
          ["FW1", "policy permit · session SYN seen · c→s 2 / s→c 0"],
          ["SERVER", "capture: SYN received ×2 · SYN-ACK sent ×2"],
          ["FW2", "SYN-ACK 10.20.20.20:443 → 10.10.10.10:52001 dropped ×2 — no matching session"],
          ["CLIENT", "SYN_SENT · 1 SYN retransmission · no SYN-ACK received"],
        ]}
      />
    </DiagramSvg>
  );
}

function RoutesDiagram() {
  return (
    <DiagramSvg h={130} label="The two directions' routes: EDGE-R1 sends 10.20.20.0/24 via FW1; EDGE-R2 sends 10.10.10.0/24 via FW2 during the incident">
      <DTable
        x={50}
        y={8}
        title="Compare both directions"
        cols={[
          { label: "ROUTER", w: 120 },
          { label: "DESTINATION", w: 150 },
          { label: "INCIDENT", w: 130 },
          { label: "DESIGN", w: 130 },
        ]}
        rows={[
          ["EDGE-R1", "10.20.20.0/24", "via FW1", "via FW1"],
          ["EDGE-R2", "10.10.10.0/24", "via FW2", "via FW1"],
        ]}
        highlight={{ row: 1, color: D.danger }}
      />
    </DiagramSvg>
  );
}

function RuledOutDiagram() {
  return (
    <DiagramSvg h={190} label="Hypotheses ruled out by evidence: port closed, server never received SYN, FW1 policy denied, DNS, client mask, NAT failure">
      <DTable
        x={20}
        y={8}
        title="Every suspect tested against evidence"
        cols={[
          { label: "SUSPECT", w: 190 },
          { label: "EVIDENCE AGAINST IT", w: 410 },
        ]}
        rows={[
          ["TCP/443 closed", "SERVER sent SYN-ACKs; no RST anywhere"],
          ["Server never got the SYN", "SERVER capture shows it"],
          ["FW1 policy denied", "ALLOW-WEB permit logged, session created"],
          ["DNS", "the client connects by IP; its SYN is on the wire"],
          ["Client subnet mask", "the SYN reaches EDGE-R1, FW1 and SERVER"],
          ["NAT failure", "no NAT is configured anywhere"],
        ]}
      />
    </DiagramSvg>
  );
}

function RepairsDiagram() {
  return (
    <DiagramSvg h={150} label="Wrong repairs weaken security or change nothing; the right repair restores the return route through FW1">
      <DTable
        x={30}
        y={8}
        title="Repairs compared"
        cols={[
          { label: "CHANGE", w: 230 },
          { label: "EFFECT", w: 350 },
        ]}
        rows={[
          ["Broad reverse allow on FW2", "opens a hole; FW1 still never sees the SYN-ACK"],
          ["Disable stateful inspection", "removes the protection; asymmetry stays"],
          ["Enable NAT", "irrelevant to which firewall EDGE-R2 chooses"],
          ["EDGE-R2 10.10.10.0/24 → FW1", "reply meets its session; handshake completes"],
        ]}
        highlight={{ row: 3, color: D.success }}
      />
    </DiagramSvg>
  );
}

function VerifyDiagram() {
  return (
    <DiagramSvg h={150} label="Before and after: EDGE-R2 route via FW2 to via FW1, FW1 reverse packets 0 to 1, session SYN seen to ESTABLISHED, FW2 drops stop growing">
      <DTable
        x={40}
        y={8}
        title="Same evidence, before and after"
        cols={[
          { label: "CHECK", w: 220 },
          { label: "INCIDENT", w: 150 },
          { label: "AFTER REPAIR", w: 170 },
        ]}
        rows={[
          ["EDGE-R2 → 10.10.10.0/24", "via FW2", "via FW1"],
          ["FW1 session s→c packets", "0", "≥ 1"],
          ["FW1 session state", "SYN seen", "ESTABLISHED"],
          ["FW2 no-session drops", "growing", "unchanged"],
        ]}
        highlight={{ row: 2, color: D.success }}
      />
    </DiagramSvg>
  );
}

export function FwLessonGuideContent() {
  return (
    <div className="space-y-12">
      <GuideSection id="fwl-mission" eyebrow="Mission" title="Allowed is not the same as working" tone="cyan">
        <p>A stateful firewall writes a policy log the moment it permits a new flow — long before anyone knows whether the connection will complete. This lesson troubleshoots a connection that was permitted, reached the server, was answered, and still never completed.</p>
      </GuideSection>

      <GuideSection id="fwl-method" eyebrow="Method" title="Follow both directions" tone="violet">
        <DiagramFrame caption="The request and the reply are two separate routing decisions.">
          <DiagramSvg h={82} label="Troubleshooting workflow">
            <WorkflowDiagram notes={["which flow?", "which devices?", "logs, captures", "one route", "compare dirs", "one change", "new handshake"]} />
          </DiagramSvg>
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="fwl-topology" eyebrow="Topology" title="Two firewalls, no shared state" tone="cyan">
        <DiagramFrame caption="No NAT: every address and port is real on every link.">
          <TopologyDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="fwl-baseline" eyebrow="Baseline" title="A healthy handshake" tone="success">
        <DiagramFrame caption="One firewall sees all three segments.">
          <BaselineDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="fwl-policy-session" eyebrow="Concepts" title="Policy vs session" tone="warning">
        <DiagramFrame caption="Policy decides new flows; state decides everything after.">
          <PolicySessionDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="fwl-table" eyebrow="Baseline" title="The session table" tone="success">
        <DiagramFrame caption="Counters per direction tell you what the firewall has actually seen.">
          <SessionTableDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="fwl-paths" eyebrow="Incident" title="Two directions, two paths" tone="danger">
        <DiagramFrame caption="The reply meets a firewall that never saw the request.">
          <PathsDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="fwl-incident" eyebrow="Incident" title="The broken handshake" tone="danger">
        <DiagramFrame caption="Permitted, delivered, answered — and dropped on the way back.">
          <IncidentDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="fwl-evidence" eyebrow="Evidence" title="Who saw what" tone="violet">
        <DiagramFrame caption="Each device testifies about its own part.">
          <EvidenceDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="fwl-routes" eyebrow="Evidence" title="Compare both directions' routes" tone="ip">
        <DiagramFrame caption="One route breaks path symmetry.">
          <RoutesDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="fwl-ruled-out" eyebrow="Hypotheses" title="Ruling out the usual suspects" tone="violet">
        <DiagramFrame caption="Each suspect predicts something the evidence contradicts.">
          <RuledOutDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="fwl-repairs" eyebrow="Repair" title="Right vs wrong repairs" tone="warning">
        <DiagramFrame caption="Fix the path, not the rulebase.">
          <RepairsDiagram />
        </DiagramFrame>
        <Callout tone="warning" title="Tempting but wrong">
          A broad dmz → trust rule on FW2 &quot;makes the drops go away&quot; while opening the network and still leaving FW1 with a half-open session.
        </Callout>
      </GuideSection>

      <GuideSection id="fwl-ladder" eyebrow="Ladder" title="Start where the evidence points" tone="cyan">
        <DiagramFrame caption="The SYN reached the server — the lower rungs are already proven.">
          <DiagramSvg h={130} label="Evidence ladder for this incident">
            <LadderDiagram
              rows={[
                { rung: "Physical / IP", evidence: "SYN reaches SERVER", status: "ok" },
                { rung: "FW1 policy", evidence: "permit, session created", status: "ok" },
                { rung: "Return routing", evidence: "EDGE-R2 → FW2", status: "fail" },
                { rung: "FW2 state", evidence: "no session → drop (consequence)", status: "suspect" },
                { rung: "Transport / app", evidence: "handshake never completes", status: "suspect" },
              ]}
            />
          </DiagramSvg>
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="fwl-verify" eyebrow="Verify" title="Symmetry restored, session established" tone="success">
        <DiagramFrame caption="Proof is traffic in both directions on the same firewall.">
          <VerifyDiagram />
        </DiagramFrame>
        <ChecklistCard tone="success" title="Verified" mark="✓" items={["EDGE-R2: 10.10.10.0/24 via FW1", "New SYN permitted; SYN-ACK matches FW1's session", "Client ACK → FW1 session ESTABLISHED", "FW2 drop count unchanged; no policy was loosened"]} />
      </GuideSection>

      <GuideSection id="fwl-glossary" eyebrow="Glossary" title="Terms" tone="cyan">
        <Glossary
          items={[
            { term: "Stateful firewall", def: "Tracks each flow in a session table and admits reverse traffic by state." },
            { term: "Zone", def: "A group of interfaces sharing a trust level (trust, dmz, untrust…)." },
            { term: "Out-of-state", def: "A packet that matches no session and cannot start one — e.g. a SYN-ACK." },
            { term: "Asymmetric routing", def: "Request and reply taking different paths." },
            { term: "State synchronization", def: "Sharing sessions between firewalls (clusters) so either can carry the reply." },
          ]}
        />
      </GuideSection>
    </div>
  );
}
