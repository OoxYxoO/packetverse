import { ChecklistCard, CompareCards, DIAGRAM as D, DiagramFrame, DiagramSvg, DPill, DArrow, FieldTable, FlowSteps, Glossary, GuideSection, Mono, TroubleshootingFlow } from "@/components/lesson/GuideBlocks";
import { PresentationBridge } from "@/components/presentation/LessonPresentation";
import { PracticeBridge } from "@/components/lesson/GuideInteractive";
import { usePracticeLabOpener } from "@/components/lesson/FundamentalsLessonShell";
import { DFieldRow, DTable } from "@/components/lesson/FundamentalsGuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { CLIENT_PORT, FW, FW1_ROUTES, FW_POLICIES, ISN, NAT_PORT, SCAN, WEB_PORT, routeText } from "@/lib/sim-engine/scenarios/firewallStateful";
import { FwChain, Lanes } from "./guideSvg";
import { CliPanel, runGuideCli } from "@/components/lesson/GuideCli";
import type { CliVendor } from "@/lib/cli/types";
import { HOST_IP, createFwNet, fwApply, fwClone, fwTicket, fwTicketState, type FwNet } from "@/lib/sim-engine/scenarios/fwNet";
import { fwFirewallSets, type FwCliApi } from "./fw-lab/fwCli";

export const FW_LESSON_SECTIONS: LessonGuideSectionLink[] = [
  { id: "fwl-mission", label: "What this lesson teaches" },
  { id: "fwl-network", label: "The network of this lesson" },
  { id: "fwl-ideas", label: "Three ideas you need" },
  { id: "fwl-walk", label: "What you will watch" },
  { id: "fwl-problem", label: "A router forwards anything" },
  { id: "fwl-first", label: "The first packet does the work" },
  { id: "fwl-policy", label: "Policy: first match, then deny" },
  { id: "fwl-nat", label: "Source NAT hides the office" },
  { id: "fwl-session", label: "The handshake builds a session" },
  { id: "fwl-return", label: "The reply comes home" },
  { id: "fwl-inbound", label: "A stranger knocks" },
  { id: "fwl-verify", label: "What a healthy firewall looks like" },
  { id: "fwl-incident", label: "The incident" },
  { id: "fwl-investigate", label: "Follow the reply" },
  { id: "fwl-repair", label: "Repair and prove it" },
  { id: "fwl-other", label: "Other ways firewalls break" },
  { id: "fwl-model", label: "Mental model" },
  { id: "fwl-glossary", label: "Glossary" },
  { id: "fwl-recap", label: "Recap" },
  { id: "fwl-practice", label: "Practice it" },
];

const C = `${FW.client}:${CLIENT_PORT.healthy}`;
const X = `${FW.untrust}:${NAT_PORT}`;
const W = `${FW.web}:${WEB_PORT}`;

export function TopologyDiagram() {
  return (
    <DiagramSvg h={200} label="CLIENT in zone trust, FW1 between zone trust and zone untrust, then the ISP and WEB-SERVER">
      <FwChain subs={{ CLIENT: FW.client, FW1: ".1 | .2", ISP: FW.ispFw, WEB: `${FW.web}` }} labels={{ cf: "ge-0/0/0 trust", fi: "ge-0/0/1 untrust", iw: "203.0.113.0/24" }} />
      <text x={320} y={190} textAnchor="middle" fill={D.muted} fontSize={10}>
        FW1 trust 10.10.10.1/24 · untrust 198.51.100.2/30 · the ISP is 198.51.100.1
      </text>
    </DiagramSvg>
  );
}

export function RouteDiagram() {
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

export function PolicyDiagram() {
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

export function FirstPacketDiagram() {
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

export function HandshakeDiagram() {
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

export function TupleDiagram() {
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

export function ReturnDiagram() {
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

export function SessionTableDiagram() {
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

export function InboundDiagram() {
  return (
    <DiagramSvg h={200} label="An unsolicited SYN from 203.0.113.80 to 198.51.100.2:8443 matches no session and no rule and is dropped at FW1">
      <FwChain subs={{ CLIENT: FW.client, FW1: "default deny", ISP: "routes it", WEB: "new SYN" }} segs={{ fi: "drop-left", iw: "left" }} labels={{ fi: `dst ${FW.untrust}:${SCAN.dport}`, iw: `SYN from :${SCAN.sport}` }} />
      <text x={320} y={186} textAnchor="middle" fill={D.danger} fontSize={10.5} fontWeight={700}>
        No session · no destination-NAT rule · no inbound allow → implicit default deny
      </text>
    </DiagramSvg>
  );
}

export function IncidentDiagram() {
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

export function RepairDiagram() {
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

function LessonLabBridge() {
  const openLab = usePracticeLabOpener();
  return (
    <PracticeBridge label="Open the Firewall Lab" onPractice={openLab}>
      Same FW1 and addresses, plus a DMZ — your own copy. Nothing you do there changes your lesson progress.
    </PracticeBridge>
  );
}

/** The lab's own command sets, run against lab states: what this page shows is what the Firewall Lab prints. */
function lessonCli(s: FwNet, vendor: CliVendor, command: string) {
  const api: FwCliApi = { view: s, act: () => s, ios: { kind: "exec" }, setIos: () => undefined, junosEdit: false, setJunosEdit: () => undefined, cand: fwClone(s.cfg), setCand: () => undefined, spare: [], setSpare: () => undefined };
  return runGuideCli(fwFirewallSets(api)[vendor]!, command);
}
const HEALTHY = fwApply(createFwNet(), { type: "traffic", sends: [{ from: "CLIENT", to: HOST_IP.WEB, kind: "connect", port: 443 }] });
const BROKEN = fwTicket("badnat").repro.reduce((acc, a) => fwApply(acc, a), fwTicketState("badnat", 1));

export function FwLessonGuideContent() {
  return (
    <div className="space-y-12">
      <GuideSection id="fwl-mission" eyebrow="This lesson" title="What this lesson teaches" tone="cyan">
        <p>
          An office connects to the internet through one box, FW1. CLIENT must be able to browse to WEB over HTTPS; the internet must never open connections to the office; and the office&apos;s private address must never appear on the internet. A <strong>stateful firewall</strong> does all three.
        </p>
        <p>You will follow CLIENT&apos;s first packet through FW1&apos;s four jobs (route, policy, NAT, session), watch the reply come back without an inbound rule, and see a connection from outside refused. Then, after a change window, HTTPS hangs, and you find out why, fix it, and prove it.</p>
        <ChecklistCard
          tone="cyan"
          title="By the end of this lesson you can"
          mark="→"
          items={[
            "name FW1's four jobs and the order the first packet meets them",
            "read the rule that allows CLIENT out, and the default deny behind it",
            "explain why WEB's reply gets in with no inbound rule",
            "say what source NAT changes in CLIENT's packet, and what it leaves alone",
            "find why HTTPS hangs after the change window, repair it and prove a full handshake",
          ]}
        />
      </GuideSection>

      <GuideSection id="fwl-network" eyebrow="This lesson" title="The network of this lesson" tone="cyan">
        <DiagramFrame caption="CLIENT in zone trust, FW1 between trust and untrust, then the ISP and WEB-SERVER.">
          <TopologyDiagram />
        </DiagramFrame>
        <FieldTable
          title="Addresses"
          columns={["Device", "Zone", "Address"]}
          rows={[
            ["CLIENT", "trust", FW.client],
            ["FW1 inside (ge-0/0/0)", "trust", "10.10.10.1"],
            ["FW1 outside (ge-0/0/1)", "untrust", `${FW.untrust} (the only public address)`],
            ["WEB-SERVER", "internet", FW.web],
          ]}
        />
        <p className="text-sm text-pv-text-muted">The Firewall Lab adds a third zone, dmz, with a public web server (172.16.0.10, published on {FW.untrust}:443), a lab PC in trust (LAB) and an internet user (OUT). It calls WEB-SERVER simply WEB.</p>
      </GuideSection>

      <GuideSection id="fwl-ideas" eyebrow="This lesson" title="Three ideas you need" tone="cyan">
        <FlowSteps
          steps={[
            { title: "The first packet does the work", body: "A new connection's SYN is routed, checked against the rules (first match wins, then the default deny), translated, and recorded as a session.", tone: "violet" },
            { title: "Replies come back on the session", body: "WEB's SYN-ACK is the exact reverse of CLIENT's session, so it is admitted without any inbound rule. A new connection from outside is not.", tone: "success" },
            { title: "Source NAT hides the office", body: `Leaving, CLIENT's private source becomes ${FW.untrust} and a port. Only the source changes.`, tone: "warning" },
          ]}
        />
      </GuideSection>

      <GuideSection id="fwl-walk" eyebrow="This lesson" title="What you will watch, step by step" tone="warning">
        <FlowSteps
          steps={[
            { title: "Policy", body: "Read ALLOW-WEB and the source NAT rule FW1 enforces.", tone: "violet" },
            { title: "Session", body: "CLIENT's SYN misses the session table, is routed, matches ALLOW-WEB and creates a session.", tone: "ip" },
            { title: "NAT", body: `The source tuple changes to ${FW.untrust}:${NAT_PORT}.`, tone: "warning" },
            { title: "Handshake and return", body: "The SYN-ACK matches the session in reverse and is translated back to CLIENT.", tone: "success" },
            { title: "Inbound test", body: "A brand-new SYN from outside matches nothing and is dropped by the default deny.", tone: "danger" },
            { title: "The incident", body: "After a change window HTTPS hangs. You find the cause and fix it.", tone: "cyan" },
          ]}
        />
        <p className="text-sm text-pv-text-muted">The sections below walk through each step on FW1, in the same order.</p>
      </GuideSection>

      <GuideSection id="fwl-problem" eyebrow="The problem" title="A router forwards anything it has a route for" tone="danger">
        <p>A router decides only <em>where</em> a packet goes, never <em>whether</em> it should. As a plain router, FW1 would let any internet host open connections to CLIENT, and the office&apos;s private address (10.10.10.10) would leave as it is, where no internet router can send a reply back. A stateful firewall allows what we mean, denies the rest, admits exactly the replies to connections we started, and translates the address at the edge.</p>
      </GuideSection>

      <GuideSection id="fwl-first" eyebrow="The first packet" title="The first packet does the work" tone="cyan">
        <p>FW1 first looks in its <strong>session table</strong>. A packet that belongs to a known session is forwarded at once. CLIENT&apos;s SYN to WEB:443 is new, so FW1 runs its jobs in order: route (WEB is behind ge-0/0/1, zone untrust), policy (trust → untrust), source NAT, and only then does it create a session.</p>
        <DiagramFrame caption="The first packet runs every job; later packets just match the session.">
          <FirstPacketDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="fwl-policy" eyebrow="Policy" title="Policy: first match, then the default deny" tone="violet">
        <p>The rules of the zone pair trust → untrust are checked top-down, and the first match decides. ALLOW-WEB permits the office to TCP 443. Anything that matches no rule falls to the implicit default deny, always last. A route alone permits nothing: the route only picks the exit, the policy decides whether the packet may use it.</p>
        <DiagramFrame caption="First match wins; the implicit default deny is always last.">
          <PolicyDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="fwl-nat" eyebrow="Source NAT" title="Source NAT hides the office" tone="warning">
        <p>Leaving to untrust, CLIENT&apos;s private source becomes FW1&apos;s public address and a port: {FW.untrust}:{NAT_PORT}. The destination is untouched, and the checksums are recomputed. The translated address must be one the ISP routes back to FW1. Keep that in mind: it is the key to the incident.</p>
        <DiagramFrame caption="Original tuple vs translated tuple: only the source changes.">
          <TupleDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="fwl-session" eyebrow="Session" title="The handshake builds a session" tone="ip">
        <p>FW1 follows the TCP handshake: the SYN creates the session, WEB&apos;s SYN-ACK matches it in reverse, and the session becomes ESTABLISHED once CLIENT&apos;s final ACK passes. The session remembers both tuples (as sent, and as translated), the rule that allowed it, and its state.</p>
        <DiagramFrame caption="FW1 follows the handshake; ESTABLISHED only after the final ACK.">
          <HandshakeDiagram />
        </DiagramFrame>
        <DiagramFrame caption="Everything FW1 remembers about one connection.">
          <SessionTableDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="fwl-return" eyebrow="The reply" title="The reply comes home on the session" tone="success">
        <p>There is no rule from untrust to trust. WEB&apos;s SYN-ACK to {FW.untrust}:{NAT_PORT} is the exact reverse of the session&apos;s translated flow, so FW1 admits it and translates the destination back to CLIENT. That does <em>not</em> mean everything from WEB is trusted: only packets that belong to this session get in.</p>
        <DiagramFrame caption="The session admits exactly its own replies.">
          <ReturnDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="fwl-inbound" eyebrow="Inbound" title="A stranger knocks" tone="danger">
        <p>A new SYN from the internet to the office matches no session, so it must be permitted on its own merits, and nothing permits it: the default deny drops it, and FW1 logs the deny.</p>
        <DiagramFrame caption="A new SYN must be permitted on its own merits, and nothing permits it.">
          <InboundDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="fwl-verify" eyebrow="Verification" title="What a healthy firewall looks like on FW1" tone="success">
        <p>Each of FW1&apos;s jobs has one table that proves it did its part:</p>
        <FieldTable
          title="Read the lesson on FW1"
          columns={["Question", "Cisco IOS", "Junos", "What the answer proves"]}
          rows={[
            ["Which rule matched?", <Mono key="1">show policy-map type inspect zone-pair</Mono>, <Mono key="2">show security policies hit-count</Mono>, "ALLOW-WEB counted the connection"],
            ["Which sessions exist, in which state?", <Mono key="3">show policy-map type inspect zone-pair sessions</Mono>, <Mono key="4">show security flow session</Mono>, "Both tuples, and packets counted both ways"],
            ["What was translated?", <Mono key="5">show ip nat translations</Mono>, <Mono key="6">show security nat source rule all</Mono>, `CLIENT leaves as ${FW.untrust}`],
          ]}
        />
        <p>On a healthy FW1, CLIENT&apos;s session has both halves: the request (In) and the reply (Out, to {FW.untrust}:{NAT_PORT}) with a packet counted:</p>
        <CliPanel run={lessonCli(HEALTHY, "juniper", "show security flow session")} caption="FW1 · Junos · healthy" />
        <p className="text-sm text-pv-text-muted">The lab&apos;s CLIENT picked source port 51000 for this connection; the diagrams show the guided lesson&apos;s 51514. A client picks a new port for every connection; the translated port, 40001, is the same in both.</p>
      </GuideSection>

      <GuideSection id="fwl-incident" eyebrow="Incident" title="The incident: HTTPS hangs after a change window" tone="danger">
        <p>Someone &quot;tidied up&quot; the NAT configuration. Since then the office can&apos;t reach any website: connections just hang. FW1&apos;s log shows every attempt allowed by ALLOW-WEB, with a session created.</p>
        <DiagramFrame caption="The SYN leaves with source 198.51.100.99; the server replies to .99 and nobody routes it back to FW1.">
          <IncidentDiagram />
        </DiagramFrame>
        <CompareCards
          items={[
            { title: "Why it fails", tone: "danger", tag: "cause", points: ["Source NAT now translates to 198.51.100.99, not FW1's address", "WEB replies to .99, which the ISP doesn't route to FW1", "The session stays half-open: the reply never arrives"] },
            { title: "What it can't be", tone: "warning", tag: "red herrings", points: ["A policy deny: the log shows ALLOW-WEB and a session", "A routing problem on FW1: the SYN leaves on ge-0/0/1", "WEB being down: the SYN reaches it and it answers"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="fwl-investigate" eyebrow="Investigation" title="Follow the first packet, then the reply" tone="danger">
        <TroubleshootingFlow
          steps={[
            { question: "Denied, hanging, or refused?", look: "Hanging: the first packet passed somewhere, the reply never came back." },
            { question: "Which rule matched?", look: "The log: ALLOW-WEB. Policy is not the problem." },
            { question: "Did the session reach ESTABLISHED, and what was translated?", look: "show security flow session: half-open, the reply half points at 198.51.100.99, nothing counted back." },
          ]}
        />
        <CliPanel run={lessonCli(BROKEN, "juniper", "show security flow session")} caption="FW1 · Junos · during the incident" />
      </GuideSection>

      <GuideSection id="fwl-repair" eyebrow="Repair" title="Repair, and prove a full handshake" tone="success">
        <CompareCards
          items={[
            { title: "Junos · FW1", tone: "violet", tag: "back to the interface address", points: ["set security nat source rule-set trust-to-untrust rule SNAT-TRUST then source-nat interface", "commit"] },
            { title: "Cisco IOS · FW1", tone: "cyan", tag: "back to the interface address", points: ["no ip nat inside source list NAT-INSIDE pool BAD-POOL overload", "ip nat inside source list NAT-INSIDE interface GigabitEthernet0/1 overload"] },
          ]}
        />
        <DiagramFrame caption="Translation back to 198.51.100.2: SYN, SYN-ACK and ACK complete; the session is ESTABLISHED.">
          <RepairDiagram />
        </DiagramFrame>
        <ChecklistCard
          tone="success"
          title="The proof"
          mark="✓"
          items={[
            `A fresh connection leaves as ${FW.untrust}`,
            "The session reaches ESTABLISHED, with packets counted in both directions",
            "CLIENT's page loads",
            "Nothing else was opened: the internet still can't reach CLIENT",
          ]}
        />
      </GuideSection>

      <GuideSection id="fwl-other" eyebrow="Troubleshooting" title="Other ways firewalls break" tone="warning">
        <p>An unrouted NAT address is one way to break the reply. The lab&apos;s tickets add four more, each with its own evidence. The Deep Dive walks through all five with real Cisco and Junos output.</p>
        <CompareCards
          items={[
            { title: "A rule above takes the traffic", tone: "danger", tag: "denied", points: ["The deny log names the rule above", "Hit counts rise on the wrong rule"] },
            { title: "An inbound rule for the public address", tone: "violet", tag: "denied", points: ["The published server is unreachable from outside", "Policies see the address after destination NAT"] },
            { title: "The server's reply bypasses FW1", tone: "ip", tag: "hanging", points: ["Half-open session, nothing counted back", "The DMZ server's gateway isn't FW1"] },
            { title: "No source NAT for one zone", tone: "warning", tag: "hanging", points: ["The DMZ's updates fail", "Its private source leaves untranslated"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="fwl-model" eyebrow="Mental model" title="A doorman with a guest list and a notebook" tone="violet">
        <p>The policy is the guest list: who may go out, and to where. The session table is the doorman&apos;s notebook: &quot;apartment 10 went out to see the web server via door 40001&quot;. When the web server comes back to door 40001, the notebook says whose visitor it is. A stranger knocking with no entry in the notebook and no name on the list is turned away. Write the wrong return address on the form (.99) and the visitor can never find the door.</p>
      </GuideSection>

      <GuideSection id="fwl-glossary" eyebrow="Glossary" title="Terms used in this lesson" tone="cyan">
        <Glossary
          items={[
            { term: "Zone", def: "A group of interfaces with the same trust level; rules are written between zones." },
            { term: "Security policy", def: "Ordered rules per zone pair; first match wins; implicit default deny last." },
            { term: "Session", def: "A tracked connection with both tuples and a state; its replies need no rule." },
            { term: "Source NAT (PAT)", def: "Leaving: the private source becomes a public address and port." },
            { term: "Half-open", def: "A session whose reply never came back through the firewall." },
          ]}
        />
      </GuideSection>

      <GuideSection id="fwl-recap" eyebrow="Recap" title="What you can now explain" tone="success">
        <ChecklistCard tone="cyan" title="Stateful firewall in this lesson" mark="→" items={["CLIENT's SYN is routed, allowed by ALLOW-WEB, translated and recorded as a session", "WEB's reply enters on that session, with no inbound rule", `Source NAT turns ${FW.client} into ${FW.untrust} and a port`, "A new connection from outside is dropped by the default deny", "Allowed is not the same as working: follow the reply"]} />
      </GuideSection>

      <GuideSection id="fwl-practice" eyebrow="Practice" title="Practice it" tone="cyan">
        <p>You now know what each of FW1&apos;s tables should say and how to prove a connection works. The Firewall Lab gives you FW1 with three zones, as a Cisco zone-based firewall or a Junos SRX:</p>
        <FlowSteps
          steps={[
            { title: "Learn (6 levels)", body: "The same steps as this page, one decision at a time, plus publishing a server.", tone: "violet" },
            { title: "Challenges", body: "See source NAT on both sides of FW1, prove the firewall is stateful, allow HTTPS but not HTTP, catch the default deny.", tone: "warning" },
            { title: "Troubleshoot (5 tickets)", body: "This lesson's incident and the four other faults above, reported as users report them.", tone: "danger" },
          ]}
        />
        <PresentationBridge>See zones, rule order, sessions, both kinds of NAT and a half-open session in the firewall presentation.</PresentationBridge>
        <LessonLabBridge />
        <p className="text-sm text-pv-text-muted">For the full course (stateless vs stateful, TCP tracking, destination NAT, processing order, real device output for every fault, a knowledge check), open the Deep Dive tab.</p>
      </GuideSection>
    </div>
  );
}
