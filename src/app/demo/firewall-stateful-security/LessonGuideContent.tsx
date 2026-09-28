import { Callout, ChecklistCard, DIAGRAM as D, DiagramFrame, DiagramSvg, DPill, DArrow, FlowSteps, Glossary, GuideSection, Mono } from "@/components/lesson/GuideBlocks";
import { DFieldRow, DTable } from "@/components/lesson/FundamentalsGuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { CLIENT_PORT, FW, FW1_ROUTES, FW_POLICIES, ISN, NAT_PORT, SCAN, WEB_PORT, routeText } from "@/lib/sim-engine/scenarios/firewallStateful";
import { FwChain, Lanes } from "./guideSvg";

export const FW_LESSON_SECTIONS: LessonGuideSectionLink[] = [
  { id: "fwl-mission", label: "The mission" },
  { id: "fwl-topology", label: "Topology & zones" },
  { id: "fwl-routing", label: "FW1 routes first" },
  { id: "fwl-policy", label: "Policy & default deny" },
  { id: "fwl-session", label: "The first packet" },
  { id: "fwl-handshake", label: "The handshake" },
  { id: "fwl-nat", label: "Original vs translated" },
  { id: "fwl-return", label: "Stateful return" },
  { id: "fwl-table", label: "The session table" },
  { id: "fwl-inbound", label: "Unsolicited inbound" },
  { id: "fwl-incident", label: "The bad-NAT incident" },
  { id: "fwl-repair", label: "Repair & verify" },
  { id: "fwl-model", label: "Mental model" },
  { id: "fwl-glossary", label: "Glossary" },
  { id: "fwl-recap", label: "Recap" },
];

const C = `${FW.client}:${CLIENT_PORT.healthy}`;
const X = `${FW.untrust}:${NAT_PORT}`;
const W = `${FW.web}:${WEB_PORT}`;

function TopologyDiagram() {
  return (
    <DiagramSvg h={200} label="CLIENT in zone trust, FW1 between zone trust and zone untrust, then the ISP and WEB-SERVER">
      <FwChain subs={{ CLIENT: FW.client, FW1: ".1 | .2", ISP: FW.ispFw, WEB: `${FW.web}` }} labels={{ cf: "ge-0/0/0 trust", fi: "ge-0/0/1 untrust", iw: "203.0.113.0/24" }} />
      <text x={320} y={190} textAnchor="middle" fill={D.muted} fontSize={10}>
        FW1 trust 10.10.10.1/24 · untrust 198.51.100.2/30 · the ISP is 198.51.100.1
      </text>
    </DiagramSvg>
  );
}

function RouteDiagram() {
  return (
    <DiagramSvg h={170} label="FW1 routing table: default route via 198.51.100.1 plus the two connected networks and its own address">
      <DTable
        x={60}
        y={8}
        title="FW1 routes — the exit is chosen here, not by policy"
        cols={[
          { label: "PREFIX", w: 150 },
          { label: "HOW", w: 370 },
        ]}
        rows={FW1_ROUTES.map((r) => [`${r.prefix}/${r.len}`, routeText(r).replace(`${r.prefix}/${r.len} `, "")])}
        highlight={{ row: 0, color: D.success }}
      />
      <text x={320} y={160} textAnchor="middle" fill={D.muted} fontSize={10}>
        {`${FW.web} matches only 0.0.0.0/0 → ge-0/0/1 → the egress zone is untrust`}
      </text>
    </DiagramSvg>
  );
}

function PolicyDiagram() {
  const rows = FW_POLICIES.map((p, i) => [p.implicit ? "implicit" : String(i + 1), p.implicit ? "default-deny" : p.name, `${p.from} → ${p.to}`, p.source, p.destination, p.service, p.action.toUpperCase()]);
  return (
    <DiagramSvg h={150} label="Security policy: rule 1 ALLOW-WEB trust to untrust TCP/443 allow; implicit default deny catches everything else">
      <DTable
        x={14}
        y={8}
        title="FW1 security policy — first match wins"
        cols={[
          { label: "#", w: 58 },
          { label: "NAME", w: 92 },
          { label: "ZONES", w: 108 },
          { label: "SOURCE", w: 104 },
          { label: "DESTINATION", w: 118 },
          { label: "SERVICE", w: 64 },
          { label: "ACTION", w: 68 },
        ]}
        rows={rows}
        highlight={{ row: 0, color: D.success }}
      />
      <text x={320} y={140} textAnchor="middle" fill={D.muted} fontSize={10}>
        No &quot;allow any any&quot;. Anything not matched by ALLOW-WEB is dropped by the default deny.
      </text>
    </DiagramSvg>
  );
}

function FirstPacketDiagram() {
  const first = ["rx · zone", "session MISS", "route", "policy", "source NAT", "new session", "tx"];
  const later = ["rx · zone", "session HIT", "apply NAT", "update state", "tx"];
  const width = (t: string) => Math.max(60, t.length * 6.6 + 20);
  const row = (items: string[], y: number, color: string, hi: string) => {
    let x = 16;
    return items.map((t, i) => {
      const w = width(t);
      const cx = x + w / 2;
      const prevEnd = x - 16;
      x += w + 16;
      return (
        <g key={`${y}-${t}`}>
          {i > 0 && <DArrow x1={prevEnd + 2} y1={y} x2={prevEnd + 14} y2={y} color={D.line} width={1.5} />}
          <DPill x={cx} y={y} text={t} color={t === hi ? color : D.muted} w={w} />
        </g>
      );
    });
  };
  return (
    <DiagramSvg h={150} label="First packet of a flow: session miss, route, policy, source NAT, new session, transmit. Later packets: session hit, apply NAT, update state, transmit">
      <text x={14} y={24} fill={D.text} fontSize={10.5} fontWeight={700}>
        First packet (the SYN) — full evaluation
      </text>
      {row(first, 48, D.warning, "session MISS")}
      <text x={14} y={92} fill={D.text} fontSize={10.5} fontWeight={700}>
        Every later packet, both directions — the session decides
      </text>
      {row(later, 116, D.success, "session HIT")}
    </DiagramSvg>
  );
}

function HandshakeDiagram() {
  return (
    <DiagramSvg h={184} label="SYN, SYN-ACK and ACK through FW1, with the session moving SYN_SENT, SYN_RECV, ESTABLISHED">
      <Lanes
        rowH={24}
        lanes={[
          { x: 70, label: "CLIENT", color: D.cyan },
          { x: 250, label: "FW1", color: D.danger },
          { x: 430, label: "WEB-SERVER", color: D.success },
        ]}
        msgs={[
          { from: 0, to: 1, label: `SYN seq ${ISN.client.healthy}` },
          { from: 1, to: 2, label: `SYN (src ${X})` },
          { from: 2, to: 1, label: `SYN-ACK seq ${ISN.server.healthy} ack ${ISN.client.healthy + 1}` },
          { from: 1, to: 0, label: `SYN-ACK (dst ${C})` },
          { from: 0, to: 1, label: `ACK ${ISN.client.healthy + 1} / ${ISN.server.healthy + 1}` },
          { from: 1, to: 2, label: "ACK (translated)" },
        ]}
      />
      <text x={560} y={34} textAnchor="middle" fill={D.faint} fontSize={9} fontWeight={700}>
        SESSION 1001
      </text>
      <DPill x={560} y={60} text="SYN_SENT" color={D.warning} w={100} />
      <DPill x={560} y={120} text="SYN_RECV" color={D.warning} w={100} />
      <DPill x={560} y={168} text="ESTABLISHED" color={D.success} w={100} />
    </DiagramSvg>
  );
}

function TupleDiagram() {
  const f = (a: string, b: string, strong?: boolean, color = D.ip) => ({ label: a, sub: b, w: 140, color, strong });
  return (
    <DiagramSvg h={190} label="Original tuple on the trust side versus translated tuple on the wire: only the source address and port change">
      <text x={20} y={22} fill={D.cyan} fontSize={10.5} fontWeight={700}>
        Trust side — the ORIGINAL tuple (what the client sent)
      </text>
      <DFieldRow x={40} y={30} fields={[f("Source IP", FW.client), f("Source port", String(CLIENT_PORT.healthy)), f("Dest IP", FW.web), f("Dest port", String(WEB_PORT))]} />
      <text x={20} y={104} fill={D.warning} fontSize={10.5} fontWeight={700}>
        Untrust side — the TRANSLATED tuple on the wire (what the server sees)
      </text>
      <DFieldRow x={40} y={112} fields={[f("Source IP", FW.untrust, true, D.warning), f("Source port", String(NAT_PORT), true, D.warning), f("Dest IP", FW.web), f("Dest port", String(WEB_PORT))]} />
      <text x={320} y={180} textAnchor="middle" fill={D.muted} fontSize={10}>
        Destination untouched · IPv4 header checksum and TCP checksum recomputed for the new source
      </text>
    </DiagramSvg>
  );
}

function ReturnDiagram() {
  return (
    <DiagramSvg h={210} label="The SYN-ACK to 198.51.100.2:40001 matches session 1001 in reverse and is reverse-translated to 10.10.10.10:51514">
      <FwChain subs={{ CLIENT: FW.client, FW1: "session 1001", ISP: "routes /30", WEB: "SYN-ACK" }} segs={{ cf: "left", fi: "left", iw: "left" }} labels={{ cf: `dst ${C}`, fi: `dst ${X}`, iw: `from ${W}` }} />
      <text x={320} y={190} textAnchor="middle" fill={D.success} fontSize={10.5} fontWeight={700}>
        Allowed because it matches session 1001 in reverse — not because of an inbound rule
      </text>
      <text x={320} y={204} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        FW1 reverse-translates the destination and recomputes both checksums
      </text>
    </DiagramSvg>
  );
}

function SessionTableDiagram() {
  return (
    <DiagramSvg h={150} label="Session 1001: TCP, trust to untrust, original and translated tuples, policy ALLOW-WEB, state ESTABLISHED">
      <DTable
        x={14}
        y={8}
        title="FW1 session table"
        cols={[
          { label: "ID", w: 50 },
          { label: "ZONES", w: 106 },
          { label: "ORIGINAL", w: 150 },
          { label: "TRANSLATED SRC", w: 130 },
          { label: "POLICY", w: 82 },
          { label: "STATE", w: 94 },
        ]}
        rows={[["1001", "trust→untrust", `${C}→:443`, X, "ALLOW-WEB", "ESTABLISHED"]]}
        highlight={{ row: 0, color: D.success }}
      />
      <text x={320} y={100} textAnchor="middle" fill={D.muted} fontSize={10}>
        {`Original: ${C} → ${W}`}
      </text>
      <text x={320} y={118} textAnchor="middle" fill={D.muted} fontSize={10}>
        Also kept: protocol TCP, packet and byte counters in each direction, an idle timer.
      </text>
      <text x={320} y={136} textAnchor="middle" fill={D.faint} fontSize={9.5}>
        None of this is carried in the packet.
      </text>
    </DiagramSvg>
  );
}

function InboundDiagram() {
  return (
    <DiagramSvg h={200} label="An unsolicited SYN from 203.0.113.80 to 198.51.100.2:8443 matches no session and no rule and is dropped at FW1">
      <FwChain subs={{ CLIENT: FW.client, FW1: "default deny", ISP: "routes it", WEB: "new SYN" }} segs={{ fi: "drop-left", iw: "left" }} labels={{ fi: `dst ${FW.untrust}:${SCAN.dport}`, iw: `SYN from :${SCAN.sport}` }} />
      <text x={320} y={186} textAnchor="middle" fill={D.danger} fontSize={10.5} fontWeight={700}>
        No session · no destination-NAT rule · no inbound allow → implicit default deny
      </text>
    </DiagramSvg>
  );
}

function IncidentDiagram() {
  return (
    <DiagramSvg h={222} label="Bad NAT: the SYN leaves with source 198.51.100.99, the server replies to .99 and the ISP has no route back, so the session stays SYN_SENT">
      <Lanes
        lanes={[
          { x: 60, label: "CLIENT", color: D.cyan },
          { x: 220, label: "FW1", color: D.danger },
          { x: 390, label: "ISP", color: D.violet },
          { x: 560, label: "WEB", color: D.success },
        ]}
        msgs={[
          { from: 0, to: 1, label: "SYN" },
          { from: 1, to: 2, label: "ALLOW · src .99:40001" },
          { from: 2, to: 3, label: "SYN from .99" },
          { from: 3, to: 2, label: "SYN-ACK → .99" },
          { from: 2, to: 1, label: "no route to .99", drop: true },
        ]}
      />
      <DPill x={160} y={206} text="session 1002: stuck in SYN_SENT" color={D.warning} w={220} />
      <DPill x={470} y={206} text="policy said ALLOW every time" color={D.success} w={210} />
    </DiagramSvg>
  );
}

function RepairDiagram() {
  return (
    <DiagramSvg h={200} label="After restoring the translation to 198.51.100.2 the SYN, SYN-ACK and ACK complete and the session is ESTABLISHED">
      <Lanes
        lanes={[
          { x: 70, label: "CLIENT", color: D.cyan },
          { x: 250, label: "FW1", color: D.danger },
          { x: 430, label: "WEB-SERVER", color: D.success },
        ]}
        msgs={[
          { from: 0, to: 1, label: "SYN" },
          { from: 1, to: 2, label: `src ${FW.untrust}:${NAT_PORT}` },
          { from: 2, to: 1, label: "SYN-ACK → .2 (routed back)" },
          { from: 1, to: 0, label: `→ ${FW.client}:${CLIENT_PORT.verify}` },
          { from: 0, to: 1, label: "ACK" },
        ]}
      />
      <DPill x={560} y={160} text="ESTABLISHED" color={D.success} w={110} />
    </DiagramSvg>
  );
}

export function FwLessonGuideContent() {
  return (
    <div className="space-y-12">
      <GuideSection id="fwl-mission" eyebrow="Mission" title="Four jobs in one box" tone="cyan">
        <p>
          FW1 routes packets, enforces a zone-based security policy, tracks every allowed connection as a session, and translates the client&apos;s private source address. They are separate jobs with separate tables. This lesson keeps them apart so that when something breaks you know which one to look at.
        </p>
        <FlowSteps
          steps={[
            { title: "Route", body: "Which interface — and so which zone — does the packet leave by?", tone: "ip" },
            { title: "Policy", body: "May a NEW flow from this zone to that zone start?", tone: "violet" },
            { title: "Session", body: "Is this packet part of a flow already allowed? Which state is it in?", tone: "success" },
            { title: "NAT", body: "Which source should the outside world see, and how is it reversed?", tone: "warning" },
          ]}
        />
      </GuideSection>

      <GuideSection id="fwl-topology" eyebrow="Topology" title="Two zones, one firewall" tone="cyan">
        <DiagramFrame caption="Interfaces belong to zones; policy is written between zones.">
          <TopologyDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="fwl-routing" eyebrow="Layer 3" title="FW1 is still a router" tone="ip">
        <DiagramFrame caption="Routing picks the exit; policy decides whether the packet may use it.">
          <RouteDiagram />
        </DiagramFrame>
        <p>A permissive policy cannot forward a packet FW1 has no route for, and a route alone permits nothing. The egress interface found here gives the egress zone the policy lookup needs.</p>
      </GuideSection>

      <GuideSection id="fwl-policy" eyebrow="Security policy" title="Allow what you mean, deny the rest" tone="violet">
        <DiagramFrame caption="First match wins; the implicit default deny is always last.">
          <PolicyDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="fwl-session" eyebrow="Sessions" title="The first packet does the work" tone="success">
        <DiagramFrame caption="This lesson's order. Real platforms differ in details — see the Deep Dive.">
          <FirstPacketDiagram />
        </DiagramFrame>
        <p>The SYN misses the session table, so FW1 routes it, checks policy, translates it and creates session 1001. Everything after that — in both directions — is matched to the session.</p>
      </GuideSection>

      <GuideSection id="fwl-handshake" eyebrow="TCP" title="SYN, SYN-ACK, ACK — tracked" tone="tcp">
        <DiagramFrame caption="FW1 follows the handshake; ESTABLISHED only after the final ACK.">
          <HandshakeDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="fwl-nat" eyebrow="Source NAT" title="Original tuple vs translated tuple" tone="warning">
        <DiagramFrame caption="Only the source changes. The destination is never touched by source NAT.">
          <TupleDiagram />
        </DiagramFrame>
        <Callout tone="warning" title="Checksums follow the fields">
          The IPv4 header checksum covers the source address (and TTL); the TCP checksum covers a pseudo-header with both addresses plus the TCP header, including the source port. Change them and both checksums must be recomputed — the client&apos;s original values do not survive translation.
        </Callout>
      </GuideSection>

      <GuideSection id="fwl-return" eyebrow="Stateful return" title="Why the reply gets in" tone="success">
        <DiagramFrame caption="The session admits exactly its own replies.">
          <ReturnDiagram />
        </DiagramFrame>
        <p>
          There is no rule from untrust to trust. The SYN-ACK <Mono>{`${W} → ${X}`}</Mono> is the exact reverse of session 1001&apos;s translated flow, so it is allowed and reverse-translated to <Mono>{C}</Mono>. This does NOT mean everything from WEB-SERVER is trusted.
        </p>
      </GuideSection>

      <GuideSection id="fwl-table" eyebrow="State" title="The session table" tone="cyan">
        <DiagramFrame caption="Everything FW1 remembers about the connection.">
          <SessionTableDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="fwl-inbound" eyebrow="Inbound test" title="Same server, new connection" tone="danger">
        <DiagramFrame caption="A new SYN must be permitted on its own merits — and nothing permits it.">
          <InboundDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="fwl-incident" eyebrow="Incident" title="ALLOW in the logs, timeouts for users" tone="danger">
        <DiagramFrame caption="The translation produced an address replies can't reach.">
          <IncidentDiagram />
        </DiagramFrame>
        <p>SNAT-OUT was edited to translate to 198.51.100.99. The ISP routes only 198.51.100.0/30 to FW1, so replies to .99 are dropped before they reach FW1. Every attempt matched ALLOW-WEB; this is not a policy deny.</p>
      </GuideSection>

      <GuideSection id="fwl-repair" eyebrow="Repair" title="Restore the translation, then verify" tone="success">
        <DiagramFrame caption="Same policy as before the incident; only the NAT rule changed back.">
          <RepairDiagram />
        </DiagramFrame>
        <ChecklistCard tone="success" title="Verified" mark="✓" items={["SNAT-OUT translates to 198.51.100.2 (FW1's untrust address)", "Server sees 198.51.100.2:40001 and replies there", "Session 1003: SYN_SENT → SYN_RECV → ESTABLISHED", "No policy change was needed"]} />
        <p>An allow-any rule, clearing ARP, raising TTL or moving the server to port 80 would not give the replies a way home.</p>
      </GuideSection>

      <GuideSection id="fwl-model" eyebrow="Mental model" title="A doorman with a guest list and a notebook" tone="violet">
        <p>The policy is the guest list: who may go out, to where. The session table is the doorman&apos;s notebook: &quot;apartment 10 went out to see the web server via door 40001&quot;. When the web server comes back to door 40001, the notebook says whose visitor it is. A stranger knocking with no entry in the notebook and no name on the list is turned away. Write the wrong return address on the form (.99) and the visitor can never find the door.</p>
      </GuideSection>

      <GuideSection id="fwl-glossary" eyebrow="Glossary" title="Terms" tone="cyan">
        <Glossary
          items={[
            { term: "Zone", def: "A group of interfaces sharing a trust level; policies are written between zones." },
            { term: "Session", def: "FW1's state for one flow: tuples, NAT mapping, zones, policy, TCP state, counters." },
            { term: "Source NAT / PAT", def: "Rewrite the source address (and port) of outbound traffic; reversed for replies." },
            { term: "Default deny", def: "The implicit last rule: anything no rule allows is dropped." },
            { term: "Stateful return", def: "Replies admitted because they match an existing session in reverse." },
          ]}
        />
      </GuideSection>

      <GuideSection id="fwl-recap" eyebrow="Recap" title="What you saw" tone="success">
        <FlowSteps
          steps={[
            { title: "Evaluate", body: "The SYN missed the session table, was routed, allowed by ALLOW-WEB and source-NATed.", tone: "violet" },
            { title: "Remember", body: "Session 1001 held both tuples and followed SYN_SENT → SYN_RECV → ESTABLISHED.", tone: "success" },
            { title: "Admit replies", body: "The SYN-ACK matched the session in reverse and was reverse-translated.", tone: "ip" },
            { title: "Deny the rest", body: "A new inbound SYN matched nothing and hit the default deny.", tone: "danger" },
            { title: "Diagnose", body: "A NAT address with no route back broke the handshake while policy kept saying ALLOW.", tone: "warning" },
          ]}
        />
      </GuideSection>
    </div>
  );
}
