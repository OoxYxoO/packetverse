import { Callout, ChecklistCard, CompareCards, DArrow, DIAGRAM as D, DiagramFrame, DiagramSvg, DLink, DNode, DPill, FailureSignatures, FlowSteps, GuideSection, Misconceptions, Mono, TroubleshootingFlow } from "@/components/lesson/GuideBlocks";
import { DFieldRow, DTable } from "@/components/lesson/FundamentalsGuideSvg";
import { ExplainIt, KnowledgeQuiz, PracticeBridge, type KnowledgeQuestion } from "@/components/lesson/GuideInteractive";
import { usePracticeLabOpener } from "@/components/lesson/FundamentalsLessonShell";
import { PresentationBridge } from "@/components/presentation/LessonPresentation";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { CliPair, CliPanel, FailureWalk, pickLines, runGuideCli } from "@/components/lesson/GuideCli";
import type { CliVendor } from "@/lib/cli/types";
import { HOST_IP, PUBLIC, createFwNet, fwApply, fwClone, fwTicket, fwTicketState, type FwHost, type FwNet, type FwTicketId } from "@/lib/sim-engine/scenarios/fwNet";
import { fwFirewallSets, fwHostSet, type FwCliApi } from "./fw-lab/fwCli";
import { FirstPacketDiagram, HandshakeDiagram, InboundDiagram, IncidentDiagram, PolicyDiagram, RepairDiagram, ReturnDiagram, RouteDiagram, SessionTableDiagram, TopologyDiagram, TupleDiagram } from "./LessonGuideContent";

/**
 * STATEFUL FIREWALL DEEP DIVE — the complete study course, taught on the lesson's own FW1 (trust, untrust, dmz). Every
 * CLI sample is produced by running the Firewall Lab's model and its real Cisco/Junos command sets.
 * Progression: Foundation → FW1's four jobs → Address translation → Traffic → Operations → Troubleshooting → Beyond → Master it.
 */

// Real CLI output, run by the lab's own command sets against the lab's model: the guide shows exactly what the lab shows.
function cliApi(s: FwNet): FwCliApi {
  return { view: s, act: () => s, ios: { kind: "exec" }, setIos: () => undefined, junosEdit: false, setJunosEdit: () => undefined, cand: fwClone(s.cfg), setCand: () => undefined, spare: [], setSpare: () => undefined };
}
const cli = (s: FwNet, vendor: CliVendor, command: string) => runGuideCli(fwFirewallSets(cliApi(s))[vendor]!, command);
const hostCli = (s: FwNet, host: FwHost, command: string) => runGuideCli(fwHostSet(cliApi(s), host), command);
/** A ticket's network after its test ran: the state the student investigates. */
const ticketState = (id: FwTicketId) => fwTicket(id).repro.reduce((acc, a) => fwApply(acc, a), fwTicketState(id, 1));
/** The healthy network after two connections: CLIENT browsed out, an internet user opened our website. */
const WARM = fwApply(createFwNet(), { type: "traffic", sends: [{ from: "CLIENT", to: HOST_IP.WEB, kind: "connect", port: 443 }, { from: "OUT", to: PUBLIC, kind: "connect", port: 443 }] });

function StatelessDiagram() {
  return (
    <DiagramSvg h={220} label="A stateless filter needs a static inbound rule for replies; a stateful firewall admits only replies matching a session">
      <text x={160} y={20} textAnchor="middle" fill={D.warning} fontSize={11} fontWeight={700}>
        Stateless filter (per-packet ACL)
      </text>
      <DNode x={60} y={70} label="inside" accent={D.cyan} w={80} />
      <DNode x={260} y={70} label="outside" accent={D.warning} w={80} />
      <DArrow x1={102} y1={60} x2={218} y2={60} color={D.tcp} label="permit out tcp/443" labelDy={-6} />
      <DArrow x1={218} y1={82} x2={102} y2={82} color={D.warning} label="permit in src port 443" labelDy={18} />
      <text x={160} y={132} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        Replies need a standing inbound rule —
      </text>
      <text x={160} y={146} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        which also admits ANY packet from port 443
      </text>
      <line x1={320} y1={12} x2={320} y2={210} stroke={D.line} strokeDasharray="3 4" />
      <text x={480} y={20} textAnchor="middle" fill={D.success} fontSize={11} fontWeight={700}>
        Stateful firewall
      </text>
      <DNode x={380} y={70} label="inside" accent={D.cyan} w={80} />
      <DNode x={580} y={70} label="outside" accent={D.warning} w={80} />
      <DArrow x1={422} y1={60} x2={538} y2={60} color={D.tcp} label="allow → session" labelDy={-6} />
      <DArrow x1={538} y1={82} x2={422} y2={82} color={D.success} label="reply matches session" labelDy={18} />
      <text x={480} y={132} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        Only the exact reverse tuple of an
      </text>
      <text x={480} y={146} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        allowed flow gets in — no inbound rule
      </text>
      <DPill x={160} y={186} text="state lives in the rule set" color={D.warning} w={200} />
      <DPill x={480} y={186} text="state lives in the session table" color={D.success} w={220} />
    </DiagramSvg>
  );
}

function SessionIdDiagram() {
  const f = (label: string, sub: string, color = D.ip) => ({ label, sub, w: 116, color });
  return (
    <DiagramSvg h={150} label="The 5-tuple: protocol, source address, source port, destination address, destination port">
      <DFieldRow x={30} y={24} fields={[f("Protocol", "TCP (6)", D.tcp), f("Source IP", "10.10.10.10"), f("Source port", "51514"), f("Dest IP", "203.0.113.80"), f("Dest port", "443")]} />
      <text x={320} y={98} textAnchor="middle" fill={D.text} fontSize={10.5} fontWeight={700}>
        A session is keyed by the 5-tuple — twice: as sent, and as translated
      </text>
      <text x={320} y={118} textAnchor="middle" fill={D.muted} fontSize={10}>
        A packet matches if its tuple equals either key, in the right direction.
      </text>
      <text x={320} y={136} textAnchor="middle" fill={D.muted} fontSize={10}>
        Zones, NAT mapping, policy, TCP state and timers hang off the entry.
      </text>
    </DiagramSvg>
  );
}

function TcpStateDiagram() {
  const states = [
    { x: 62, w: 100, t: "SYN_SENT", c: D.warning },
    { x: 186, w: 100, t: "SYN_RECV", c: D.warning },
    { x: 316, w: 112, t: "ESTABLISHED", c: D.success },
    { x: 464, w: 136, t: "FIN_WAIT / CLOSING", c: D.violet },
    { x: 592, w: 76, t: "CLOSED", c: D.faint },
  ];
  return (
    <DiagramSvg h={150} label="Firewall TCP tracking: SYN_SENT, SYN_RECV, ESTABLISHED, closing, closed, with timeouts at each stage">
      {states.map((s, i) => (
        <g key={s.t}>
          {i > 0 && <DArrow x1={states[i - 1].x + states[i - 1].w / 2 + 2} y1={50} x2={s.x - s.w / 2 - 2} y2={50} color={D.line} width={1.5} />}
          <DPill x={s.x} y={50} text={s.t} color={s.c} w={s.w} />
        </g>
      ))}
      <text x={124} y={82} textAnchor="middle" fill={D.muted} fontSize={9}>
        SYN-ACK seen
      </text>
      <text x={248} y={82} textAnchor="middle" fill={D.muted} fontSize={9}>
        final ACK
      </text>
      <text x={384} y={82} textAnchor="middle" fill={D.muted} fontSize={9}>
        FIN / RST
      </text>
      <text x={320} y={116} textAnchor="middle" fill={D.text} fontSize={10}>
        Short timers while opening or closing; a long idle timer once ESTABLISHED.
      </text>
      <text x={320} y={134} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        State names vary by product; the idea (don&apos;t trust a half-open flow for long) does not.
      </text>
    </DiagramSvg>
  );
}

function AgingDiagram() {
  return (
    <DiagramSvg h={170} label="Session aging: a TCP session is removed after FIN or its idle timer; a UDP pseudo-session exists only as long as its short idle timer">
      <text x={20} y={26} fill={D.tcp} fontSize={10.5} fontWeight={700}>
        TCP session
      </text>
      <rect x={120} y={14} width={330} height={18} rx={4} fill={D.tcp} fillOpacity={0.25} stroke={D.tcp} />
      <text x={285} y={27} textAnchor="middle" fill={D.text} fontSize={9}>
        ESTABLISHED — refreshed by traffic
      </text>
      <rect x={450} y={14} width={70} height={18} rx={4} fill={D.violet} fillOpacity={0.2} stroke={D.violet} />
      <text x={485} y={27} textAnchor="middle" fill={D.text} fontSize={9}>
        FIN
      </text>
      <text x={530} y={27} fill={D.muted} fontSize={9}>
        → removed
      </text>
      <text x={20} y={74} fill={D.warning} fontSize={10.5} fontWeight={700}>
        UDP flow
      </text>
      <rect x={120} y={62} width={90} height={18} rx={4} fill={D.warning} fillOpacity={0.2} stroke={D.warning} />
      <text x={165} y={75} textAnchor="middle" fill={D.text} fontSize={9}>
        query / reply
      </text>
      <rect x={210} y={62} width={140} height={18} rx={4} fill="none" stroke={D.warning} strokeDasharray="4 3" />
      <text x={280} y={75} textAnchor="middle" fill={D.muted} fontSize={9}>
        idle timer running
      </text>
      <text x={360} y={75} fill={D.muted} fontSize={9}>
        → removed (no FIN exists in UDP)
      </text>
      <text x={320} y={120} textAnchor="middle" fill={D.text} fontSize={10}>
        UDP has no handshake, so the &quot;session&quot; is a pseudo-state: first packet out, replies in,
      </text>
      <text x={320} y={138} textAnchor="middle" fill={D.text} fontSize={10}>
        until nothing is seen for the idle timeout. Then late replies are just unsolicited packets.
      </text>
    </DiagramSvg>
  );
}

function PatDiagram() {
  return (
    <DiagramSvg h={200} label="PAT: three private clients share one public address, distinguished by translated source ports">
      {["10.10.10.10:51514", "10.10.10.11:51514", "10.10.10.12:60002"].map((t, i) => (
        <g key={t}>
          <DNode x={80} y={40 + i * 50} label={t.split(":")[0]} sub={`port ${t.split(":")[1]}`} accent={D.cyan} w={128} h={40} />
          <DArrow x1={146} y1={40 + i * 50} x2={216} y2={90} color={D.line} width={1.5} />
        </g>
      ))}
      <DNode x={260} y={90} label="FW1" sub="SNAT + PAT" accent={D.danger} w={84} />
      <DTable
        x={330}
        y={30}
        title="Translations (one public address)"
        cols={[
          { label: "PRIVATE", w: 150 },
          { label: "PUBLIC", w: 146 },
        ]}
        rows={[
          ["10.10.10.10:51514", "198.51.100.2:40001"],
          ["10.10.10.11:51514", "198.51.100.2:40002"],
          ["10.10.10.12:60002", "198.51.100.2:40003"],
        ]}
      />
      <text x={320} y={186} textAnchor="middle" fill={D.muted} fontSize={10}>
        Same private port twice is fine — the public port keeps every flow unique.
      </text>
    </DiagramSvg>
  );
}

function DnatDiagram() {
  return (
    <DiagramSvg h={190} label="Destination NAT concept: a connection to 198.51.100.2:443 is translated to an inside server 10.10.10.50:443, and policy must still allow it">
      <DNode x={70} y={80} label="Internet client" sub="new SYN" accent={D.warning} w={116} />
      <DArrow x1={130} y1={80} x2={232} y2={80} color={D.tcp} label="dst 198.51.100.2:443" />
      <DNode x={290} y={80} label="FW1" sub="DNAT rule" accent={D.danger} w={100} />
      <DArrow x1={342} y1={80} x2={452} y2={80} color={D.tcp} label="dst 10.10.10.50:443" />
      <DNode x={530} y={80} label="inside server" sub="10.10.10.50" accent={D.cyan} w={120} />
      <text x={320} y={140} textAnchor="middle" fill={D.text} fontSize={10}>
        &quot;Publishing&quot; a server = a destination-NAT rule AND a policy allowing untrust → the server.
      </text>
      <text x={320} y={158} textAnchor="middle" fill={D.muted} fontSize={10}>
        In this lesson neither exists, which is why the unsolicited SYN to :8443 was dropped.
      </text>
    </DiagramSvg>
  );
}

function OrderDiagram() {
  const col = (x: number, title: string, items: string[], color: string) => (
    <g>
      <text x={x} y={20} textAnchor="middle" fill={color} fontSize={10.5} fontWeight={700}>
        {title}
      </text>
      {items.map((t, i) => (
        <g key={t}>
          {i > 0 && <DArrow x1={x} y1={44 + i * 32 - 20} x2={x} y2={44 + i * 32 - 13} color={D.line} width={1.5} />}
          <DPill x={x} y={44 + i * 32} text={t} color={color} w={210} />
        </g>
      ))}
    </g>
  );
  return (
    <DiagramSvg h={220} label="Two example processing orders: this lesson's model and a variant where destination NAT happens before route and policy lookup">
      {col(165, "This lesson's model", ["session lookup", "route lookup", "policy (pre-NAT addresses)", "source NAT", "create session · forward"], D.cyan)}
      {col(475, "A common variant", ["session lookup", "destination NAT", "route (post-DNAT dst)", "policy", "source NAT · forward"], D.violet)}
      <text x={320} y={212} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        Products differ in where DNAT happens and which addresses policies match. Read your platform&apos;s order.
      </text>
    </DiagramSvg>
  );
}

function AsymDiagram() {
  return (
    <DiagramSvg h={200} label="Asymmetric routing: the SYN leaves through FW1 but the reply returns through FW2, which has no session and drops it">
      <DNode x={70} y={100} label="CLIENT" accent={D.cyan} w={90} />
      <DNode x={280} y={50} label="FW1" sub="session exists" accent={D.success} w={120} />
      <DNode x={280} y={150} label="FW2" sub="no session" accent={D.danger} w={120} />
      <DNode x={540} y={100} label="SERVER" accent={D.success} w={90} />
      <DArrow x1={116} y1={90} x2={218} y2={58} color={D.tcp} label="SYN" />
      <DArrow x1={342} y1={58} x2={494} y2={90} color={D.tcp} label="SYN" />
      <DArrow x1={494} y1={110} x2={342} y2={142} color={D.danger} label="SYN-ACK" labelDy={18} />
      <DLink x1={218} y1={142} x2={180} y2={130} color={D.danger} dashed />
      <text x={200} y={124} textAnchor="middle" fill={D.danger} fontSize={14} fontWeight={800}>
        ✕
      </text>
      <text x={320} y={194} textAnchor="middle" fill={D.muted} fontSize={10}>
        Each firewall only knows the flows it saw. Keep both directions through the same state (or synchronize state).
      </text>
    </DiagramSvg>
  );
}

/** What a healthy firewall looks like, read from FW1 — the state every later section refers to. */
function NormalState() {
  const nat = cli(WARM, "juniper", "show security nat source rule all");
  return (
    <div className="space-y-5">
      <p>
        Before anything breaks, learn what a healthy firewall looks like on FW1. This is the lab&apos;s FW1 with three zones: trust (CLIENT, LAB), dmz (the public web server 172.16.0.10) and untrust (the ISP, WEB 203.0.113.80, an internet user OUT). Two connections have just run: CLIENT browsed to WEB over HTTPS, and OUT opened our website on 198.51.100.2. Below are the verification questions, asked on the real FW1, with the state described above in the answers. Every output is exactly what the Firewall Lab prints, and in the five faults below you will compare broken output with it.
      </p>
      <div className="space-y-2">
        <h4 className="text-sm font-bold text-pv-text">1 · Which rules exist, and which ones matched?</h4>
        <CliPair cisco={cli(WARM, "cisco", "show zone-pair security")} junos={cli(WARM, "juniper", "show security policies hit-count")} ciscoCaption="FW1 · Cisco IOS (zone-based firewall)" junosCaption="FW1 · Junos (SRX)" />
        <p className="text-sm text-pv-text-muted">
          Rules live between zone pairs and are checked top-down. The first match decides, and anything unmatched falls to the implicit default deny. CLIENT&apos;s connection hit <Mono>ALLOW-WEB</Mono>. OUT&apos;s hit <Mono>PUBLISH-WEB</Mono> from untrust to dmz. <Mono>BLOCK-LAB</Mono> sits above ALLOW-WEB on purpose: it must catch the lab PCs before the general rule lets them out. On Cisco, each zone pair carries a policy-map whose classes (CM-…) match ACLs (ACL-…), in the same order.
        </p>
      </div>
      <div className="space-y-2">
        <h4 className="text-sm font-bold text-pv-text">2 · Which connections are tracked, and in which state?</h4>
        <CliPair cisco={cli(WARM, "cisco", "show policy-map type inspect zone-pair sessions")} junos={cli(WARM, "juniper", "show security flow session")} ciscoCaption="FW1 · Cisco IOS" junosCaption="FW1 · Junos" />
        <p className="text-sm text-pv-text-muted">
          Each session has two halves. <Mono>In</Mono> is the flow as the initiator sent it. <Mono>Out</Mono> is the reply FW1 expects, already translated: WEB answers 198.51.100.2:40001 (CLIENT behind source NAT), and the DMZ server answers OUT directly (destination NAT reversed). Packets counted in both directions, and <Mono>SIS_OPEN</Mono> on Cisco, mean the handshake completed through FW1. The reply enters on the session alone: there is no rule from untrust to trust.
        </p>
      </div>
      <div className="space-y-2">
        <h4 className="text-sm font-bold text-pv-text">3 · What was translated?</h4>
        <CliPanel run={{ ...nat, output: pickLines(nat.output, /source NAT rule|From zone|Source addresses|Action|Pool address|Translation hits/) }} />
        <CliPanel run={cli(WARM, "cisco", "show ip nat translations")} />
        <p className="text-sm text-pv-text-muted">
          Leaving to untrust, private sources become FW1&apos;s own public address, 198.51.100.2 (<Mono>source-nat interface</Mono> · <Mono>ip nat inside source list … interface GigabitEthernet0/1 overload</Mono>). The ISP routes only that /30 to us, so replies can only come back to that address. The static entry publishes 172.16.0.10:443 on 198.51.100.2:443.
        </p>
      </div>
      <Callout tone="success" title="And the traffic proves it" icon="✓">
        CLIENT&apos;s <Mono>curl -k https://203.0.113.80</Mono> and OUT&apos;s <Mono>curl -k https://198.51.100.2</Mono> both complete. The traffic that must stay blocked stays blocked: LAB (10.10.10.200) to the internet hits BLOCK-LAB, and nothing from the internet reaches CLIENT. Proving a fix means checking both lists: what must work, and what must stay blocked.
      </Callout>
    </div>
  );
}

/** The five faults the lab can break, each walked from normal state to proof. */
function FaultWalks() {
  const shadow = ticketState("shadow");
  const badnat = ticketState("badnat");
  const dnat = ticketState("dnatpol");
  const gw = ticketState("dmzgw");
  const snat = ticketState("dmzsnat");
  const shRun = cli(shadow, "cisco", "show running-config");
  const bnNat = cli(badnat, "juniper", "show security nat source rule all");
  const dnPol = cli(dnat, "juniper", "show security policies from-zone untrust to-zone dmz");
  const snNat = cli(snat, "juniper", "show security nat source rule all");
  return (
    <div className="space-y-4">
      <p>These are the five faults of the lab&apos;s tickets. Each one starts from the healthy evidence above and changes one thing. Read the evidence first and compare it with the healthy output, because the difference is the clue. Follow the first packet through FW1&apos;s jobs (session, destination NAT, route, policy, source NAT), then follow the reply. Then see how the investigation questions lead to the cause, how to repair it on both vendors, and what proves the repair.</p>
      <FailureWalk
        title="1 · A rule above takes the traffic (shadowing)"
        normal={<>BLOCK-LAB matches only the lab PCs (LAB-PCS, 10.10.10.128/25). ALLOW-WEB below it lets the rest of the office out.</>}
        change={<>A change meant to block the lab PCs writes BLOCK-LAB with the whole office (CLIENTS) as its source. It sits above ALLOW-WEB, so it now matches everyone first.</>}
        evidence={
          <>
            <p>Nobody can browse, and ping still works (ALLOW-PING is above BLOCK-LAB). The hit counts show BLOCK-LAB taking CLIENT&apos;s connection while ALLOW-WEB counts nothing, and the deny log names the rule:</p>
            <CliPanel run={cli(shadow, "juniper", "show security policies hit-count")} />
            <CliPanel run={cli(shadow, "juniper", "show log messages")} />
            <CliPanel run={{ ...shRun, output: pickLines(shRun.output, /ACL-BLOCK-LAB$|permit ip object-group CLIENTS/) }} note={<>On Cisco the same mistake sits in the class&apos;s ACL.</>} />
          </>
        }
        next={<>A deny that names a rule: read that rule&apos;s match conditions, not the rule you expected. Hit counts that rise above the rule that should match mean shadowing. To test one flow without sending traffic: <Mono>show security match-policies</Mono>.</>}
        fix={<>BLOCK-LAB back to the lab PCs only. Junos <Mono>delete security policies from-zone trust to-zone untrust policy BLOCK-LAB match source-address CLIENTS</Mono>, then the same with <Mono>set</Mono> and <Mono>LAB-PCS</Mono>, then <Mono>commit</Mono> · Cisco <Mono>ip access-list extended ACL-BLOCK-LAB</Mono>, <Mono>no permit ip object-group CLIENTS any</Mono>, <Mono>permit ip object-group LAB-PCS any</Mono>.</>}
        proof={<>CLIENT browses again, and LAB is still denied: both halves of the proof.</>}
      />
      <FailureWalk
        title="2 · Source NAT to an address nobody routes back"
        normal={<>CLIENT&apos;s connections leave with source 198.51.100.2, FW1&apos;s own address, which the ISP routes to FW1.</>}
        change={<>SNAT-TRUST is edited to translate to a pool, 198.51.100.99. The ISP routes only 198.51.100.0/30 to FW1, so replies to .99 are dropped before they ever reach FW1.</>}
        evidence={
          <>
            <p>Connections hang, and the log shows every attempt allowed by ALLOW-WEB with a session created. This is not a policy problem. The session expects the reply at .99, and nothing has come back:</p>
            <CliPanel run={cli(badnat, "juniper", "show security flow session")} />
            <CliPanel run={{ ...bnNat, output: pickLines(bnNat.output, /SNAT-TRUST|Action|Pool address/) }} />
            <DiagramFrame caption="The translation produced an address replies can't reach.">
              <IncidentDiagram />
            </DiagramFrame>
          </>
        }
        next={<>Allowed, session created, no reply counted: follow the reply. Where must it go? It goes to the translated source. Does the next router route that address back to FW1? Compare the NAT pool with what the ISP assigned (the ISP&apos;s looking glass: <Mono>show ip route</Mono>).</>}
        fix={<>Translation back to the interface address. Junos <Mono>set security nat source rule-set trust-to-untrust rule SNAT-TRUST then source-nat interface</Mono>, then <Mono>commit</Mono> · Cisco <Mono>no ip nat inside source list NAT-INSIDE pool BAD-POOL overload</Mono>, <Mono>ip nat inside source list NAT-INSIDE interface GigabitEthernet0/1 overload</Mono>.</>}
        proof={
          <>
            <p>A fresh connection reaches ESTABLISHED with packets counted both ways.</p>
            <DiagramFrame caption="Same policy as before the incident; only the NAT rule changed back.">
              <RepairDiagram />
            </DiagramFrame>
          </>
        }
      />
      <FailureWalk
        title="3 · An inbound rule written for the public address"
        normal={<>PUBLISH-WEB allows untrust → dmz to DMZ-WEB (172.16.0.10), the server&apos;s real address.</>}
        change={<>A new version of the rule is written with destination FW-OUTSIDE (198.51.100.2), the address customers type. But FW1 translates the destination <em>before</em> the policy lookup, so the policy only ever sees 172.16.0.10.</>}
        evidence={
          <>
            <p>Customers can&apos;t reach the website, though the server works from the office. The deny log shows the default deny for untrust → dmz: no rule matched the real destination.</p>
            <CliPanel run={cli(dnat, "juniper", "show log messages")} />
            <CliPanel run={{ ...dnPol, output: pickLines(dnPol.output, /Policy:|Destination addresses|Action/) }} />
          </>
        }
        next={<>Inbound traffic denied by the default deny although a rule seems to exist: compare the rule&apos;s destination with the address <em>after</em> destination NAT (<Mono>show security nat destination rule all</Mono> · <Mono>show ip nat translations</Mono>). Policies are written for real addresses.</>}
        fix={<>PUBLISH-WEB back to the real address. Junos <Mono>delete security policies from-zone untrust to-zone dmz policy PUBLISH-WEB match destination-address FW-OUTSIDE</Mono>, then the same with <Mono>set</Mono> and <Mono>DMZ-WEB</Mono>, then <Mono>commit</Mono> · Cisco: in <Mono>ip access-list extended ACL-PUBLISH-WEB</Mono>, <Mono>no permit tcp any object-group FW-OUTSIDE eq 443</Mono>, <Mono>permit tcp any object-group DMZ-WEB eq 443</Mono>.</>}
        proof={<>OUT&apos;s <Mono>curl -k https://198.51.100.2</Mono> completes.</>}
      />
      <FailureWalk
        title="4 · The server's reply never comes back through FW1"
        normal={<>The DMZ server&apos;s default gateway is FW1 (172.16.0.1), so its replies go back through the session they belong to.</>}
        change={<>The server is rebuilt with the wrong default gateway, 172.16.0.254. Its replies leave toward an address that doesn&apos;t exist.</>}
        evidence={
          <>
            <p>Customers&apos; connections hang, and FW1 shows sessions created by PUBLISH-WEB with nothing denied. The sessions are half-open: the SYN went in, and no reply was ever counted.</p>
            <CliPanel run={cli(gw, "juniper", "show security flow session")} />
            <CliPanel run={cli(gw, "cisco", "show policy-map type inspect zone-pair sessions")} note={<>Half-open, SIS_OPENING, and zero bytes from the responder.</>} />
            <CliPanel run={hostCli(gw, "DMZ", "ip route")} />
          </>
        }
        next={<>A half-open session means the firewall did its job and the reply died beyond it. Follow the reply from the server: its own routing table first (<Mono>ip route</Mono> on the server), then a capture on FW1&apos;s DMZ interface. FW1 can&apos;t fix a reply it never receives.</>}
        fix={<>Not on FW1: in the DMZ server&apos;s shell, <Mono>sudo ip route replace default via 172.16.0.1</Mono>.</>}
        proof={<>The server&apos;s gateway is FW1 again. A fresh connection from OUT reaches ESTABLISHED / SIS_OPEN.</>}
      />
      <FailureWalk
        title="5 · No source NAT for one zone"
        normal={<>Traffic from the dmz to the internet is translated to 198.51.100.2 by SNAT-DMZ, like traffic from trust.</>}
        change={<>The dmz-to-untrust source NAT rule is removed. ALLOW-UPDATES still permits the DMZ server&apos;s connections, but they leave with the private source 172.16.0.10, which no internet router can answer.</>}
        evidence={
          <>
            <p>The DMZ server can&apos;t reach the update site, while the office browses fine. The session exists and was permitted, but its reply half still points at 172.16.0.10 and nothing came back. Only one source NAT rule is left:</p>
            <CliPanel run={cli(snat, "juniper", "show security flow session")} />
            <CliPanel run={{ ...snNat, output: pickLines(snNat.output, /Total rules|source NAT rule|From zone/) }} />
          </>
        }
        next={<>Allowed, but the reply never comes: read the session&apos;s reply half. A private address there means the packet left without translation. Check that every zone leaving to the internet has a source NAT rule.</>}
        fix={<>Source NAT for the dmz again. Junos <Mono>set security nat source rule-set dmz-to-untrust rule SNAT-DMZ then source-nat interface</Mono>, then <Mono>commit</Mono> · Cisco <Mono>ip nat inside source list NAT-DMZ interface GigabitEthernet0/1 overload</Mono>.</>}
        proof={<>The session&apos;s reply half shows 198.51.100.2 and the download completes.</>}
      />
    </div>
  );
}

function LabBridge() {
  const openLab = usePracticeLabOpener();
  return (
    <PracticeBridge label="Open the Firewall Lab" onPractice={openLab}>
      Same FW1 and addresses, plus a DMZ — your own copy. Nothing you do there changes your lesson progress.
    </PracticeBridge>
  );
}

const G = { foundation: "Foundation", jobs: "FW1's four jobs", nat: "Address translation", traffic: "Traffic", ops: "Operations", trouble: "Troubleshooting", beyond: "Beyond this lesson", master: "Master it" };

export const FW_DEEP_DIVE_SECTIONS: LessonGuideSectionLink[] = [
  { id: "fwd-why", label: "Why a stateful firewall exists", group: G.foundation },
  { id: "fwd-network", label: "Zones: the network you will study", group: G.foundation },
  { id: "fwd-stateless", label: "Stateless vs stateful", group: G.foundation },
  { id: "fwd-route", label: "Route: where it goes", group: G.jobs },
  { id: "fwd-policy", label: "Policy: whether it may start", group: G.jobs },
  { id: "fwd-session", label: "Session: the first packet decides", group: G.jobs },
  { id: "fwd-tcp", label: "Tracking TCP state", group: G.jobs },
  { id: "fwd-aging", label: "Session aging and UDP", group: G.jobs },
  { id: "fwd-snat", label: "Source NAT and PAT", group: G.nat },
  { id: "fwd-dnat", label: "Destination NAT", group: G.nat },
  { id: "fwd-traffic", label: "Out, back, and in", group: G.traffic },
  { id: "fwd-order", label: "Processing order", group: G.traffic },
  { id: "fwd-state", label: "The state FW1 keeps", group: G.ops },
  { id: "fwd-verify", label: "How to verify: one table per job", group: G.ops },
  { id: "fwd-normal", label: "What healthy looks like", group: G.ops },
  { id: "fwd-signatures", label: "Denied, hanging or refused", group: G.trouble },
  { id: "fwd-workflow", label: "Investigation workflow", group: G.trouble },
  { id: "fwd-faults", label: "Five faults, evidence to proof", group: G.trouble },
  { id: "fwd-prove", label: "Prove the repair", group: G.trouble },
  { id: "fwd-asym", label: "Asymmetric routing", group: G.beyond },
  { id: "fwd-logging", label: "Policy design and logging", group: G.beyond },
  { id: "fwd-myths", label: "Common misconceptions", group: G.master },
  { id: "fwd-quiz", label: "Knowledge check", group: G.master },
  { id: "fwd-explain", label: "Can you explain it?", group: G.master },
  { id: "fwd-practice", label: "Practice in the Firewall Lab", group: G.master },
];

const QUIZ: KnowledgeQuestion[] = [
  {
    id: "q-reply",
    prompt: "There is no rule from untrust to trust. Why does WEB's SYN-ACK still reach CLIENT?",
    options: [
      { id: "a", label: "Replies are always allowed" },
      { id: "b", label: "It matches CLIENT's session in reverse, so it is admitted without a policy check" },
      { id: "c", label: "The default deny only applies to TCP SYNs" },
      { id: "d", label: "Source NAT opens the port permanently" },
    ],
    correctId: "b",
    explanation: "The SYN created a session. A packet that is the exact reverse of the session's translated flow belongs to it and is forwarded at once. Anything else from WEB is not trusted.",
  },
  {
    id: "q-order",
    prompt: "Rules are BLOCK-LAB (deny LAB-PCS) above ALLOW-WEB (permit CLIENTS, HTTPS). LAB is also inside CLIENTS. What happens to LAB's HTTPS?",
    options: [
      { id: "a", label: "Permitted: the more specific rule wins" },
      { id: "b", label: "Denied: rules are checked top-down and the first match decides" },
      { id: "c", label: "Permitted: permit rules are checked first" },
      { id: "d", label: "It depends on the session table" },
    ],
    correctId: "b",
    explanation: "First match wins. BLOCK-LAB matches LAB before ALLOW-WEB is reached. Allowing LAB's HTTPS needs a rule above BLOCK-LAB.",
  },
  {
    id: "q-snat",
    prompt: "Leaving to untrust, CLIENT's SYN (10.10.10.10, an ephemeral source port → 203.0.113.80:443) is translated. What changes?",
    options: [
      { id: "a", label: "Only the destination address" },
      { id: "b", label: "The source address and port: 198.51.100.2 and a new port" },
      { id: "c", label: "Both addresses" },
      { id: "d", label: "Nothing; only the TTL" },
    ],
    correctId: "b",
    explanation: "Source NAT with PAT rewrites the private source into FW1's public address and a port. The destination is never touched by source NAT, and the checksums are recomputed.",
  },
  {
    id: "q-dnat",
    prompt: "OUT connects to our public address 198.51.100.2:443, published to the DMZ server 172.16.0.10. Which destination must the inbound rule match?",
    options: [
      { id: "a", label: "198.51.100.2, the public address" },
      { id: "b", label: "172.16.0.10, the real address: destination NAT happens before policy" },
      { id: "c", label: "Any: published servers need no rule" },
      { id: "d", label: "203.0.113.50, OUT's address" },
    ],
    correctId: "b",
    explanation: "In this lesson's order (and on SRX), destination NAT runs before route and policy lookup, so the policy sees the translated, real address of the server.",
  },
  {
    id: "q-hang",
    prompt: "A connection hangs: the log shows ALLOW and a session in SYN_SENT with nothing counted back. What does that rule out?",
    options: [
      { id: "a", label: "Nothing: the policy may still deny it" },
      { id: "b", label: "A policy deny: the first packet was allowed; the reply never came back through FW1" },
      { id: "c", label: "A routing problem anywhere" },
      { id: "d", label: "A NAT problem" },
    ],
    correctId: "b",
    explanation: "ALLOW and a session prove the first packet passed policy. Half-open means the reply never returned: look at the translated source, the ISP's route back, or the server's gateway.",
  },
  {
    id: "q-stray",
    prompt: "An internet host sends a bare ACK to 198.51.100.2:443 with no session. What does FW1 do?",
    options: [
      { id: "a", label: "Forwards it to CLIENT" },
      { id: "b", label: "Drops it: a packet that is not a new SYN and matches no session is out of state" },
      { id: "c", label: "Creates a session for it" },
      { id: "d", label: "Replies with a SYN-ACK" },
    ],
    correctId: "b",
    explanation: "Only a SYN (or a new ping) can start a session. A stray segment without a session is dropped and logged; that is what proves the firewall is stateful.",
  },
];

export function FwDeepDiveContent() {
  return (
    <div className="space-y-12">
      <GuideSection id="fwd-why" eyebrow="Foundation" title="Why a stateful firewall exists" tone="cyan">
        <p>
          A router decides only <em>where</em> a packet goes, never <em>whether</em> it should. If FW1 were a plain router, any internet host could open a connection to CLIENT as easily as CLIENT opens one to WEB, and the office&apos;s private addresses would leave as they are, where no internet router can send a reply back to them.
        </p>
        <FlowSteps
          steps={[
            { title: "No decision", body: "Everything with a route is forwarded, in both directions. Nothing separates the office from the internet.", tone: "danger" },
            { title: "Opening the reverse direction for replies opens everything", body: "To let WEB's replies in, a simple filter would have to allow all traffic from WEB, including connections WEB starts itself.", tone: "warning" },
            { title: "Private addresses can't travel", body: "Replies to 10.10.10.10 have nowhere to go on the internet.", tone: "violet" },
          ]}
        />
        <p>A <strong>stateful firewall</strong> allows what we mean, denies the rest, admits exactly the replies to connections we started, and translates addresses at the edge.</p>
      </GuideSection>

      <GuideSection id="fwd-network" eyebrow="Foundation" title="Zones: the network you will study" tone="cyan">
        <p>
          FW1 puts each interface in a <strong>zone</strong>: trust (the office, ge-0/0/0 · 10.10.10.1), untrust (the ISP, ge-0/0/1 · 198.51.100.2, our only public address) and dmz (the public web server 172.16.0.10, ge-0/0/2 · 172.16.0.1). Rules are written between zones, and anything not allowed between two zones is denied.
        </p>
        <DiagramFrame caption="Interfaces belong to zones; policy is written between zones.">
          <TopologyDiagram />
        </DiagramFrame>
        <p className="text-sm text-pv-text-muted">The guided lesson uses two zones. The Firewall Lab adds dmz with the public web server, a lab PC in trust (LAB, 10.10.10.200) and an internet user (OUT, 203.0.113.50). The lab calls WEB-SERVER simply WEB.</p>
      </GuideSection>

      <GuideSection id="fwd-stateless" eyebrow="Foundation" title="Stateless filtering vs stateful inspection" tone="violet">
        <DiagramFrame caption="Where the knowledge about replies lives.">
          <StatelessDiagram />
        </DiagramFrame>
        <p>A stateless packet filter judges each packet alone, so admitting replies needs a standing inbound rule that also admits lookalikes. A stateful firewall records each allowed flow and admits only packets that belong to it, in the direction and state expected.</p>
      </GuideSection>

      <GuideSection id="fwd-route" eyebrow="FW1's four jobs" title="Route: where it goes" tone="ip">
        <p>FW1 is still a router: the egress interface it finds gives the destination zone, and so which rules apply. A permissive policy can&apos;t forward a packet FW1 has no route for, and a route alone permits nothing.</p>
        <DiagramFrame caption="Routing picks the exit; policy decides whether the packet may use it.">
          <RouteDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="fwd-policy" eyebrow="FW1's four jobs" title="Policy: whether it may start" tone="violet">
        <p>The rules of a zone pair are checked top-down, and the first match decides. Nothing matching means the implicit default deny, always last. Order matters: in the lab BLOCK-LAB sits above ALLOW-WEB, so it catches the lab PCs before the general rule lets the office out.</p>
        <DiagramFrame caption="First match wins; the implicit default deny is always last.">
          <PolicyDiagram />
        </DiagramFrame>
        <CompareCards
          items={[
            { title: "Cisco IOS zone-based firewall", tone: "cyan", tag: "zone-pair", points: ["zone security TRUST / UNTRUST / DMZ", "zone-member security on each interface", "class-map type inspect (what) + policy-map type inspect (inspect / drop)", "zone-pair security … service-policy type inspect"] },
            { title: "Junos SRX", tone: "violet", tag: "from-zone → to-zone", points: ["security-zone with its interfaces", "security policies from-zone trust to-zone untrust policy ALLOW-WEB", "match source-address / destination-address / application", "then permit | deny, evaluated in order"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="fwd-session" eyebrow="FW1's four jobs" title="Session: the first packet decides" tone="cyan">
        <p>
          FW1 processes every packet in a fixed order. First it looks in its <strong>session table</strong>. A packet that belongs to a known session is forwarded at once, translated as the session says, with no policy check. A packet with no session can only start one if it is a TCP SYN (or a new ping), and then FW1 runs its jobs: destination NAT, route, policy, source NAT, then it creates the session.
        </p>
        <DiagramFrame caption="This lesson's order. Real platforms differ in details (see Processing order).">
          <FirstPacketDiagram />
        </DiagramFrame>
        <DiagramFrame caption="Five values identify a flow.">
          <SessionIdDiagram />
        </DiagramFrame>
        <DiagramFrame caption="Everything FW1 remembers about one connection: both tuples, the rule, the state.">
          <SessionTableDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="fwd-tcp" eyebrow="FW1's four jobs" title="Tracking TCP state" tone="tcp">
        <p>FW1 follows the TCP handshake: the SYN creates the session, the SYN-ACK from the server matches it in reverse, and the session becomes ESTABLISHED once the client&apos;s final ACK passes.</p>
        <DiagramFrame caption="FW1 follows the handshake; ESTABLISHED only after the final ACK.">
          <HandshakeDiagram />
        </DiagramFrame>
        <DiagramFrame caption="The firewall follows the same handshake the endpoints do.">
          <TcpStateDiagram />
        </DiagramFrame>
        <p>Many firewalls also check that segments are plausible for the state: a bare ACK or a SYN-ACK with no session is dropped as out-of-state. Exact checks (sequence windows, RST handling) vary by product.</p>
      </GuideSection>

      <GuideSection id="fwd-aging" eyebrow="FW1's four jobs" title="Session aging and UDP pseudo-state" tone="warning">
        <DiagramFrame caption="Every session ends: by protocol or by idle timer.">
          <AgingDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="fwd-snat" eyebrow="Address translation" title="Source NAT and PAT: many clients, one public address" tone="warning">
        <p>Leaving to untrust, the private source becomes FW1&apos;s public address and a port (PAT). Only the source changes; the destination is never touched by source NAT, and the checksums covering the rewritten fields are recomputed. The session remembers both tuples, so the reply can be translated back.</p>
        <DiagramFrame caption="Original tuple vs translated tuple.">
          <TupleDiagram />
        </DiagramFrame>
        <DiagramFrame caption="Port Address Translation (PAT, also NAPT or overload).">
          <PatDiagram />
        </DiagramFrame>
        <p className="text-sm text-pv-text-muted">The diagrams show the guided lesson&apos;s connection, where CLIENT uses source port 51514. In the lab CLIENT picks 51000: a client chooses a new ephemeral port for every connection. FW1&apos;s translated port, 40001, is the same in both.</p>
        <p>The translated address must be one the ISP routes back to FW1. Translate to an address nobody routes, and the first packet leaves fine while every reply is lost.</p>
      </GuideSection>

      <GuideSection id="fwd-dnat" eyebrow="Address translation" title="Destination NAT: publishing a server" tone="ip">
        <p>A new connection from the internet to our public address on a published port is translated to the real server (198.51.100.2:443 → 172.16.0.10:443), <em>before</em> the route and policy lookups. Inbound rules are therefore written for the server&apos;s <strong>real</strong> address.</p>
        <DiagramFrame caption="Translate where the packet goes, for inbound services.">
          <DnatDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="fwd-traffic" eyebrow="Traffic" title="Out, back, and in" tone="warning">
        <p><strong>Out.</strong> CLIENT&apos;s SYN to WEB:443 has no session, so FW1 routes it to untrust, matches ALLOW-WEB, translates the source to 198.51.100.2:40001 and creates a session.</p>
        <p><strong>Back.</strong> There is no rule from untrust to trust. WEB&apos;s SYN-ACK is the exact reverse of the session&apos;s translated flow, so it is allowed and reverse-translated to CLIENT. This does <em>not</em> mean everything from WEB is trusted.</p>
        <DiagramFrame caption="The session admits exactly its own replies.">
          <ReturnDiagram />
        </DiagramFrame>
        <p><strong>In.</strong> A new SYN from the internet must be permitted on its own merits. To CLIENT, nothing permits it: the default deny drops it. To our public address on 443, destination NAT sends it to the DMZ server and PUBLISH-WEB allows it.</p>
        <DiagramFrame caption="A new SYN must be permitted on its own merits, and nothing permits it.">
          <InboundDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="fwd-order" eyebrow="Traffic" title="Processing order: routing, policy, NAT" tone="violet">
        <DiagramFrame caption="Two examples, not a universal pipeline.">
          <OrderDiagram />
        </DiagramFrame>
        <Callout tone="warning" title="Check your platform">
          This lesson&apos;s order is a teaching model close to the SRX. Whether a policy is written against pre-NAT or post-NAT addresses, and whether destination NAT happens before route lookup, differ between platforms. The four jobs themselves are universal; their order is documented per product.
        </Callout>
      </GuideSection>

      <GuideSection id="fwd-state" eyebrow="Operations" title="The state FW1 keeps" tone="cyan">
        <FlowSteps
          steps={[
            { title: "Policies and their hit counts", body: "Every rule per zone pair, in order, and how many connections each one matched.", tone: "violet" },
            { title: "The session table", body: "Each allowed connection with both tuples (as sent, and as translated), its state (SYN_SENT, ESTABLISHED) and packets counted each way.", tone: "success" },
            { title: "NAT rules and translations", body: "Which sources are translated to what, which public port is published to which server, and the translations in use.", tone: "warning" },
            { title: "Routes and the log", body: "Where each zone is reached, and every deny or stray segment that was dropped.", tone: "ip" },
          ]}
        />
      </GuideSection>

      <GuideSection id="fwd-verify" eyebrow="Operations" title="How to verify: one table per job" tone="success">
        <FlowSteps
          steps={[
            { title: "Which rules exist, and which one matched?", body: <>Cisco <Mono>show zone-pair security</Mono>, <Mono>show policy-map type inspect zone-pair</Mono> · Junos <Mono>show security policies hit-count</Mono>, <Mono>show security match-policies …</Mono> to test one flow.</>, tone: "violet" },
            { title: "Which connections are tracked, in which state?", body: <>Cisco <Mono>show policy-map type inspect zone-pair sessions</Mono> · Junos <Mono>show security flow session</Mono>.</>, tone: "success" },
            { title: "What was translated?", body: <>Cisco <Mono>show ip nat translations</Mono> · Junos <Mono>show security nat source rule all</Mono>, <Mono>show security nat destination rule all</Mono>.</>, tone: "warning" },
            { title: "What was dropped, and where does each zone go?", body: <>Cisco <Mono>show logging</Mono>, <Mono>show ip route</Mono> · Junos <Mono>show log messages</Mono>, <Mono>show route</Mono>.</>, tone: "ip" },
          ]}
        />
        <p>Then prove it with traffic: a fresh connection that completes, and the traffic that must stay blocked still blocked.</p>
      </GuideSection>

      <GuideSection id="fwd-normal" eyebrow="Operations" title="What a healthy firewall looks like on the device" tone="success">
        <NormalState />
      </GuideSection>

      <GuideSection id="fwd-signatures" eyebrow="Troubleshooting" title="What failure looks like: denied, hanging, or refused" tone="danger">
        <p>A connection that fails through a firewall fails in one of three ways. <strong>Denied</strong>: a rule or the default deny dropped it, and the log says so. <strong>Hanging</strong>: it was allowed, but the reply never came back. <strong>Refused</strong>: it arrived and nothing listens (a TCP RST). These are the families you will meet:</p>
        <FailureSignatures
          items={[
            { tag: "shadow", title: "A broad rule above the right one", tone: "danger", points: ["Denied, with a rule name in the log", "Hit counts rise on the rule above, not on the rule you expected", "show security match-policies names the matching rule"] },
            { tag: "nat", title: "Source NAT to an unrouted address", tone: "warning", points: ["Hangs, while the log shows ALLOW and a session", "The session's reply half points at the bad address, nothing counted back", "Fix the pool, not the policy"] },
            { tag: "dnat", title: "An inbound rule for the public address", tone: "violet", points: ["Denied by the default deny for untrust → dmz", "The rule's destination is the public address", "Policies see the address after destination NAT"] },
            { tag: "return", title: "A reply that never reaches FW1", tone: "ip", points: ["Hangs, half-open session (SYN_SENT / SIS_OPENING)", "Nothing counted from the responder", "The server's gateway, or no source NAT for its zone"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="fwd-workflow" eyebrow="Troubleshooting" title="Investigation workflow: follow the first packet, then the reply" tone="danger">
        <TroubleshootingFlow
          steps={[
            { question: "Denied, hanging, or refused?", look: "Timeout = silently dropped somewhere; connection refused = it arrived and nothing listens (RST)." },
            { question: "Did the first packet reach FW1, and in which zone?", look: "Capture on the ingress interface; the session table and logs only see what arrived." },
            { question: "Which rule matched?", look: "Deny logs name the rule (default-deny = nothing allowed it); hit counts show a rule above taking the traffic; show security match-policies tests one flow." },
            { question: "What was translated?", look: "Source NAT out (to an address the ISP routes back?), destination NAT in (policy written for the real address?)." },
            { question: "Was a session created, and did it reach ESTABLISHED?", look: "Half-open = the reply never came back through FW1: check the server's gateway, the ISP's route to the translated address." },
          ]}
        />
      </GuideSection>

      <GuideSection id="fwd-faults" eyebrow="Troubleshooting" title="Five faults, from evidence to proof" tone="danger">
        <FaultWalks />
      </GuideSection>

      <GuideSection id="fwd-prove" eyebrow="Troubleshooting" title="Prove the repair with fresh traffic" tone="success">
        <ChecklistCard
          tone="success"
          title="The proof, every time"
          mark="✓"
          items={[
            "Repeat the exact connection that failed, and see it complete",
            "The expected rule counts the hit; the expected translation is used",
            "The session reaches ESTABLISHED with packets counted in both directions",
            "What must stay blocked is still blocked (LAB to the internet, the internet to CLIENT)",
            "Nothing else was opened to make it work: no allow-any rule",
          ]}
        />
        <p>The lab&apos;s tickets check exactly this: a ticket only closes when FW1&apos;s state is right <em>and</em> a fresh run of the user&apos;s test succeeds.</p>
      </GuideSection>

      <GuideSection id="fwd-asym" eyebrow="Beyond this lesson" title="Asymmetric routing" tone="danger">
        <DiagramFrame caption="State must see both directions.">
          <AsymDiagram />
        </DiagramFrame>
        <p>A stateful firewall must see both directions of a flow. If the reply returns through another path (a second firewall, a second ISP), FW1 sees a SYN-ACK for a session it never created, or never sees the reply at all. Designs keep flows symmetric, or synchronize state between firewalls in a cluster.</p>
      </GuideSection>

      <GuideSection id="fwd-logging" eyebrow="Beyond this lesson" title="Policy design and logging" tone="cyan">
        <CompareCards
          items={[
            { title: "Zone-based policy", tone: "violet", tag: "structure", points: ["Interfaces grouped by trust: trust, untrust, DMZ…", "Rules written per zone pair, first match wins", "Implicit default deny between zones", "Specific rules; avoid allow any any"] },
            { title: "Logging", tone: "cyan", tag: "evidence", points: ["Log session start/end for allowed flows", "Log default-deny hits", "A log of ALLOW proves policy, not delivery", "Counters: packets/bytes each direction"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="fwd-myths" eyebrow="Master it" title="Common misconceptions" tone="warning">
        <Misconceptions
          items={[
            { myth: "Replies need an inbound rule.", correction: "Replies enter on their session. An inbound rule would also admit connections the outside starts." },
            { myth: "A more specific rule wins over a broader one.", correction: "Rules are checked top-down and the first match decides. A broad rule above takes the traffic." },
            { myth: "ALLOW in the log means the connection works.", correction: "It proves the first packet passed policy. The reply can still be lost: a half-open session is the evidence." },
            { myth: "Source NAT changes the destination too.", correction: "Source NAT rewrites only the source address and port. Destination NAT is a separate job." },
            { myth: "Inbound rules are written for the public address.", correction: "In this lesson's order destination NAT happens before policy, so rules use the server's real address." },
            { myth: "A route to a network permits traffic to it.", correction: "Routing picks the exit; policy decides whether the packet may use it." },
          ]}
        />
      </GuideSection>

      <GuideSection id="fwd-quiz" eyebrow="Master it" title="Knowledge check" tone="success">
        <KnowledgeQuiz questions={QUIZ} />
      </GuideSection>

      <GuideSection id="fwd-explain" eyebrow="Master it" title="Can you explain it?" tone="success">
        <ExplainIt
          items={[
            { q: "Why can CLIENT browse to WEB while WEB can't open a connection to CLIENT?", a: "CLIENT's SYN matches ALLOW-WEB and creates a session; WEB's replies match that session. A new SYN from WEB matches no session and no untrust → trust rule, so the default deny drops it." },
            { q: "Why does a wrong source NAT pool make connections hang instead of fail?", a: "The first packet is allowed and leaves with the bad source address. The server replies to that address, which nobody routes back to FW1, so the session stays half-open until it times out." },
            { q: "Why must the rule publishing the DMZ server match 172.16.0.10, not 198.51.100.2?", a: "Destination NAT translates the public address to the real server before the policy lookup, so the policy only ever sees 172.16.0.10." },
            { q: "Why does a stray ACK from the internet prove the firewall is stateful?", a: "It is not a new SYN and matches no session, so FW1 drops and logs it. A stateless filter with an 'allow replies' rule would have let it through." },
          ]}
        />
      </GuideSection>

      <GuideSection id="fwd-practice" eyebrow="Practice" title="Practice in the Firewall Lab" tone="cyan">
        <ChecklistCard
          tone="cyan"
          title="In the lab you will"
          mark="→"
          items={[
            "See source NAT on both sides of FW1, and prove the firewall is stateful",
            "Allow HTTPS but not HTTP, and keep the office away from the DMZ",
            "Let the lab PCs browse HTTPS only, and catch the default deny",
            "Solve five tickets from evidence, on a Cisco zone-based firewall or a Junos SRX, and prove each repair",
          ]}
        />
        <PresentationBridge>See zones, rule order, sessions, both kinds of NAT and a half-open session in the firewall presentation.</PresentationBridge>
        <LabBridge />
      </GuideSection>
    </div>
  );
}
