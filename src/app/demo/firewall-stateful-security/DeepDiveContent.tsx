import { Callout, ChecklistCard, CompareCards, DArrow, DIAGRAM as D, DiagramFrame, DiagramSvg, DLink, DNode, DPill, FieldTable, Glossary, GuideSection, Mono } from "@/components/lesson/GuideBlocks";
import { DFieldRow, DTable } from "@/components/lesson/FundamentalsGuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";

export const FW_DEEP_DIVE_SECTIONS: LessonGuideSectionLink[] = [
  { id: "fwd-stateless", label: "Stateless vs stateful" },
  { id: "fwd-tuple", label: "5-tuple & session identity" },
  { id: "fwd-tcp", label: "TCP state tracking" },
  { id: "fwd-aging", label: "Session aging & UDP" },
  { id: "fwd-pat", label: "Source NAT & PAT" },
  { id: "fwd-dnat", label: "Destination NAT" },
  { id: "fwd-order", label: "Routing · policy · NAT order" },
  { id: "fwd-zones", label: "Zone-based policy & logging" },
  { id: "fwd-asym", label: "Asymmetric routing" },
  { id: "fwd-verify", label: "Verification" },
  { id: "fwd-model", label: "Mental model" },
  { id: "fwd-glossary", label: "Glossary" },
];

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

function TupleDiagram() {
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

export function FwDeepDiveContent() {
  return (
    <div className="space-y-12">
      <GuideSection id="fwd-stateless" eyebrow="Foundations" title="Stateless filtering vs stateful inspection" tone="violet">
        <DiagramFrame caption="Where the knowledge about replies lives.">
          <StatelessDiagram />
        </DiagramFrame>
        <p>A stateless packet filter judges each packet alone, so admitting replies needs a standing inbound rule that also admits lookalikes. A stateful firewall records each allowed flow and admits only packets that belong to it, in the direction and state expected.</p>
      </GuideSection>

      <GuideSection id="fwd-tuple" eyebrow="Identity" title="The 5-tuple and the session" tone="cyan">
        <DiagramFrame caption="Five values identify a flow.">
          <TupleDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="fwd-tcp" eyebrow="TCP" title="Tracking TCP state" tone="tcp">
        <DiagramFrame caption="The firewall follows the same handshake the endpoints do.">
          <TcpStateDiagram />
        </DiagramFrame>
        <p>Many firewalls also check that segments are plausible for the state — a bare ACK or a SYN-ACK with no session is dropped as out-of-state. Exact checks (sequence windows, RST handling) vary by product.</p>
      </GuideSection>

      <GuideSection id="fwd-aging" eyebrow="Timers" title="Session aging and UDP pseudo-state" tone="warning">
        <DiagramFrame caption="Every session ends: by protocol or by idle timer.">
          <AgingDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="fwd-pat" eyebrow="Source NAT" title="Many clients, one public address" tone="warning">
        <DiagramFrame caption="Port Address Translation (PAT, also NAPT or overload).">
          <PatDiagram />
        </DiagramFrame>
        <p>Plain (one-to-one) source NAT maps one private address to one public address. PAT adds the port so thousands of flows can share one address. Either way the destination stays the same and the checksums covering the rewritten fields are recomputed.</p>
      </GuideSection>

      <GuideSection id="fwd-dnat" eyebrow="Destination NAT" title="Publishing a server (concept)" tone="ip">
        <DiagramFrame caption="Translate where the packet goes — for inbound services.">
          <DnatDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="fwd-order" eyebrow="Processing order" title="Routing vs policy vs NAT" tone="violet">
        <DiagramFrame caption="Two examples, not a universal pipeline.">
          <OrderDiagram />
        </DiagramFrame>
        <Callout tone="warning" title="Vendor-neutral on purpose">
          This lesson&apos;s order is a teaching model. Whether a policy is written against pre-NAT or post-NAT addresses, and whether destination NAT happens before route lookup, differ between platforms. The four jobs themselves are universal; their order is documented per product.
        </Callout>
      </GuideSection>

      <GuideSection id="fwd-zones" eyebrow="Operations" title="Zone-based policy and logging" tone="cyan">
        <CompareCards
          items={[
            { title: "Zone-based policy", tone: "violet", tag: "structure", points: ["Interfaces grouped by trust: trust, untrust, DMZ…", "Rules written per zone pair, first match wins", "Implicit default deny between zones", "Specific rules; avoid allow any any"] },
            { title: "Logging", tone: "cyan", tag: "evidence", points: ["Log session start/end for allowed flows", "Log default-deny hits (like the :8443 SYN)", "A log of ALLOW proves policy, not delivery", "Counters: packets/bytes each direction"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="fwd-asym" eyebrow="Design" title="Asymmetric routing" tone="danger">
        <DiagramFrame caption="State must see both directions.">
          <AsymDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="fwd-verify" eyebrow="Verification" title="Check each job separately" tone="success">
        <FieldTable
          title="Vendor-neutral checks"
          columns={["Job", "Question", "Look at"]}
          rows={[
            ["Routing", "Is there a route to the destination, and which zone does it exit?", "Route table / route lookup"],
            ["Policy", "Which rule matched a NEW flow — allow or deny?", "Policy hit counters, deny log"],
            ["Session", "Does a session exist; what state; are packets counted both ways?", "Session table entry"],
            ["NAT", "What are the original and translated tuples? Is the public address routed back?", "NAT translations, provider routing"],
          ]}
        />
        <ChecklistCard tone="success" title="The incident, read correctly" mark="✓" items={[<>Policy hits on ALLOW-WEB: <Mono>allow</Mono></>, <>Session: <Mono>SYN_SENT</Mono>, packets in = 0</>, <>Translated source: <Mono>198.51.100.99</Mono> — not FW1&apos;s address</>, "Conclusion: a translation/return-path fault, not a policy deny"]} />
      </GuideSection>

      <GuideSection id="fwd-model" eyebrow="Mental model" title="Four questions, four tables" tone="violet">
        <p>Where does it go? (route table) May it start? (policy) Do I already know this flow? (session table) Who should it appear to be? (NAT rules). When a connection fails, ask all four — the firewall answering &quot;allow&quot; to one of them says nothing about the other three.</p>
      </GuideSection>

      <GuideSection id="fwd-glossary" eyebrow="Glossary" title="Terms" tone="cyan">
        <Glossary
          items={[
            { term: "Stateful inspection", def: "Filtering using per-flow state, admitting only packets that fit an allowed flow." },
            { term: "5-tuple", def: "Protocol, source/destination address, source/destination port." },
            { term: "Pseudo-state", def: "Session-like tracking for connectionless protocols (UDP, ICMP), ended by idle timers." },
            { term: "PAT / NAPT", def: "Source NAT that also rewrites ports so many hosts share one address." },
            { term: "Destination NAT", def: "Rewrite the destination to publish an inside service." },
            { term: "Asymmetric routing", def: "Two directions of a flow taking different paths — breaks single-box state." },
          ]}
        />
      </GuideSection>
    </div>
  );
}
