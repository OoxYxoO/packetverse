import { Callout, ChecklistCard, DArrow, DIAGRAM as D, DiagramFrame, DiagramSvg, DNode, DPill, FieldTable, FlowSteps, Glossary, GuideSection } from "@/components/lesson/GuideBlocks";
import { DFieldRow } from "@/components/lesson/FundamentalsGuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { LEASE_SECONDS } from "@/lib/sim-engine/scenarios/dhcpDns";

export const DH_DEEP_DIVE_SECTIONS: LessonGuideSectionLink[] = [
  { id: "dhd-states", label: "Client states" },
  { id: "dhd-timers", label: "T1, T2, renew, rebind" },
  { id: "dhd-offers", label: "Multiple offers & NAK" },
  { id: "dhd-relay", label: "Relay at scale" },
  { id: "dhd-recursion", label: "DNS recursion" },
  { id: "dhd-message", label: "DNS message format" },
  { id: "dhd-tcp", label: "UDP vs TCP & caching" },
  { id: "dhd-workflow", label: "Workflow" },
  { id: "dhd-glossary", label: "Glossary" },
];
const DHCP = "#f59e0b";
const DNS = "#a78bfa";

function StatesDiagram() {
  const box = (x: number, y: number, t: string, c: string) => <DNode x={x} y={y} label={t} accent={c} w={120} h={34} />;
  return (
    <DiagramSvg h={210} label="DHCP client states: INIT sends DISCOVER to SELECTING; REQUEST to REQUESTING; ACK to BOUND; at T1 to RENEWING; at T2 to REBINDING; ACK returns to BOUND; lease expiry or NAK returns to INIT">
      {box(70, 40, "INIT", D.faint)}
      {box(230, 40, "SELECTING", DHCP)}
      {box(390, 40, "REQUESTING", DHCP)}
      {box(550, 40, "BOUND", D.success)}
      {box(550, 150, "RENEWING", D.cyan)}
      {box(330, 150, "REBINDING", D.violet)}
      <DArrow x1={130} y1={40} x2={168} y2={40} color={D.muted} label="DISCOVER" />
      <DArrow x1={290} y1={40} x2={328} y2={40} color={D.muted} label="REQUEST" />
      <DArrow x1={450} y1={40} x2={488} y2={40} color={D.muted} label="ACK" />
      <DArrow x1={560} y1={57} x2={560} y2={133} color={D.cyan} label="T1" labelDy={0} />
      <DArrow x1={490} y1={150} x2={392} y2={150} color={D.violet} label="T2" />
      <DArrow x1={538} y1={133} x2={538} y2={57} color={D.success} />
      <text x={470} y={100} fill={D.success} fontSize={9.5}>
        ACK
      </text>
      <DArrow x1={270} y1={150} x2={90} y2={58} color={D.danger} width={1.4} />
      <text x={110} y={120} fill={D.danger} fontSize={9.5}>
        lease expired / NAK
      </text>
    </DiagramSvg>
  );
}

function TimersDiagram() {
  const x0 = 40;
  const w = 560;
  const px = (f: number) => x0 + f * w;
  return (
    <DiagramSvg h={150} label={`Lease timeline for ${LEASE_SECONDS} seconds: T1 at 50 percent the client unicasts a renewal to its server; T2 at 87.5 percent it broadcasts a rebind to any server; at 100 percent the lease expires`}>
      <line x1={px(0)} y1={70} x2={px(1)} y2={70} stroke={D.line} strokeWidth={3} />
      {[
        { f: 0, t: "ACK", c: D.success },
        { f: 0.5, t: `T1 ${LEASE_SECONDS / 2} s`, c: D.cyan },
        { f: 0.875, t: `T2 ${(LEASE_SECONDS * 7) / 8} s`, c: D.violet },
        { f: 1, t: "expiry", c: D.danger },
      ].map((m) => (
        <g key={m.t}>
          <line x1={px(m.f)} y1={60} x2={px(m.f)} y2={80} stroke={m.c} strokeWidth={2} />
          <text x={px(m.f)} y={50} textAnchor={m.f === 1 ? "end" : m.f === 0 ? "start" : "middle"} fill={m.c} fontSize={10} fontWeight={700}>
            {m.t}
          </text>
        </g>
      ))}
      <text x={px(0.5)} y={100} fill={D.cyan} fontSize={9.5}>
        renew: unicast to its server
      </text>
      <text x={px(0.875)} y={120} textAnchor="middle" fill={D.violet} fontSize={9.5}>
        rebind: broadcast to any server
      </text>
    </DiagramSvg>
  );
}

function OffersDiagram() {
  return (
    <DiagramSvg h={210} label="Two servers send offers; the client's broadcast REQUEST names server A in Option 54, so server B releases its offer; if server A cannot honour the request it sends DHCPNAK and the client restarts">
      <DNode x={90} y={95} label="CLIENT" w={110} />
      <DNode x={520} y={35} label="Server A" sub="chosen (opt 54)" accent={D.success} w={140} />
      <DNode x={520} y={160} label="Server B" sub="offer withdrawn" accent={D.faint} w={140} />
      <DArrow x1={448} y1={40} x2={148} y2={84} color={D.success} label="OFFER" />
      <DArrow x1={448} y1={156} x2={148} y2={106} color={D.faint} label="OFFER" labelDy={18} />
      <DPill x={290} y={95} text="REQUEST (bcast) · opt 54 = A" color={DHCP} w={200} />
      <text x={20} y={202} fill={D.muted} fontSize={10}>
        A DHCPNAK (e.g. the address is no longer valid) sends the client back to INIT.
      </text>
    </DiagramSvg>
  );
}

function RelayScaleDiagram() {
  return (
    <DiagramSvg h={190} label="One central DHCP server serves many client subnets; each router interface acts as a relay stamping its own giaddr, and the server maps each giaddr to the matching scope">
      {["10.10.10.1", "10.30.30.1", "10.40.40.1"].map((g, i) => (
        <g key={g}>
          <DNode x={100} y={40 + i * 55} label={`relay giaddr ${g}`} accent={D.ip} w={180} h={36} />
          <DArrow x1={192} y1={40 + i * 55} x2={420} y2={95} color={DHCP} width={1.4} />
        </g>
      ))}
      <DNode x={510} y={95} label="DHCP-SRV" sub="scope per giaddr" accent={D.violet} w={160} />
    </DiagramSvg>
  );
}

function RecursionDiagram() {
  return (
    <DiagramSvg h={220} label="A stub resolver asks a recursive resolver with RD set; the recursive resolver iterates through a root server, the .test TLD servers and the authoritative server, then returns the answer and caches it">
      <DNode x={80} y={105} label="Stub (CLIENT)" accent={D.cyan} w={130} />
      <DNode x={260} y={105} label="Recursive" sub="resolver" accent={DNS} w={120} />
      <DNode x={500} y={30} label="Root" accent={D.faint} w={120} />
      <DNode x={500} y={105} label="TLD (.test)" accent={D.faint} w={120} />
      <DNode x={500} y={170} label="Authoritative" accent={D.success} w={120} />
      <DArrow x1={145} y1={98} x2={198} y2={98} color={DNS} label="RD=1" />
      <DArrow x1={198} y1={114} x2={145} y2={114} color={D.success} labelDy={18} label="answer" />
      <DArrow x1={320} y1={95} x2={438} y2={38} color={D.muted} width={1.4} />
      <DArrow x1={320} y1={105} x2={438} y2={105} color={D.muted} width={1.4} />
      <DArrow x1={320} y1={115} x2={438} y2={165} color={D.muted} width={1.4} />
      <text x={20} y={212} fill={D.muted} fontSize={10}>
        In the lesson, DNS-SRV plays the recursive resolver. The upstream iteration isn&apos;t simulated.
      </text>
    </DiagramSvg>
  );
}

function MessageDiagram() {
  return (
    <DiagramSvg h={160} label="DNS message: 12-byte header with ID, flags QR Opcode AA TC RD RA RCODE and four counts; then Question, Answer, Authority and Additional sections">
      <DFieldRow x={20} y={30} h={40} fields={[{ label: "ID", w: 70, color: DNS, strong: true }, { label: "Flags", sub: "QR·Op·AA·TC·RD·RA·RCODE", w: 190, color: DNS }, { label: "QD·AN·NS·AR", sub: "counts", w: 120, color: DNS }]} />
      <DFieldRow x={20} y={90} h={34} fields={[{ label: "Question", w: 140, color: D.cyan }, { label: "Answer", w: 140, color: D.success }, { label: "Authority", w: 140, color: D.faint }, { label: "Additional", w: 140, color: D.faint }]} />
      <text x={410} y={56} fill={D.muted} fontSize={10}>
        12-byte header
      </text>
    </DiagramSvg>
  );
}

export function DhcpDnsDeepDiveContent() {
  return (
    <div className="space-y-12">
      <GuideSection id="dhd-states" eyebrow="RFC 2131" title="The DHCP client state machine" tone="warning">
        <DiagramFrame caption="The lesson covered INIT → SELECTING → REQUESTING → BOUND and RENEWING.">
          <StatesDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="dhd-timers" eyebrow="Lease timers" title="T1, T2, renew and rebind" tone="cyan">
        <DiagramFrame caption="Defaults: T1 = 0.5 × lease, T2 = 0.875 × lease.">
          <TimersDiagram />
        </DiagramFrame>
        <Callout tone="warning" title="Renew vs rebind">
          Renewing (T1) unicasts to the server that granted the lease. Rebinding (T2) broadcasts to any server, in case the original is gone.
        </Callout>
      </GuideSection>

      <GuideSection id="dhd-offers" eyebrow="Selection" title="Multiple offers and DHCPNAK" tone="violet">
        <DiagramFrame caption="Option 54 in the broadcast REQUEST tells every server which offer won.">
          <OffersDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="dhd-relay" eyebrow="RFC 1542" title="Relays make one server enough" tone="ip">
        <DiagramFrame caption="giaddr turns one server into a server for every subnet.">
          <RelayScaleDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="dhd-recursion" eyebrow="RFC 1035" title="Recursive vs authoritative" tone="violet">
        <DiagramFrame caption="Stubs ask recursive resolvers; recursive resolvers iterate toward authoritative servers.">
          <RecursionDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="dhd-message" eyebrow="Wire format" title="The DNS message" tone="cyan">
        <DiagramFrame caption="The same format serves both queries and responses. QR tells them apart.">
          <MessageDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="dhd-tcp" eyebrow="Transport" title="UDP, TCP and caching" tone="success">
        <FieldTable
          title="DNS over port 53"
          columns={["Transport", "Used for"]}
          rows={[
            ["UDP 53", "Ordinary queries and responses (this lesson)"],
            ["TCP 53", "Responses too large for UDP (TC bit set), and zone transfers"],
          ]}
        />
        <p>Resolvers cache each answer for its record TTL. Changing a record doesn&apos;t reach clients whose cached copy hasn&apos;t expired. It&apos;s the same shape of problem as a DHCP lease that hasn&apos;t renewed.</p>
      </GuideSection>

      <GuideSection id="dhd-workflow" eyebrow="Workflow" title="Diagnosing boot-to-name problems" tone="danger">
        <FlowSteps
          steps={[
            { title: "Lease", body: "Does the client have an address, mask, gateway and DNS? From which server and xid?", tone: "warning" },
            { title: "IP path", body: "Can it reach its gateway and the server subnet by IP?", tone: "cyan" },
            { title: "Resolver", body: "Query the intended DNS server directly. Does that work when the default lookup fails?", tone: "violet" },
            { title: "Fix at the source", body: "Correct the DHCP option or DNS record, then renew the lease or wait for the cache TTL.", tone: "success" },
          ]}
        />
        <ChecklistCard tone="warning" title="Common traps" mark="!" items={["Blaming the gateway when only names fail", "Expecting a scope change to update existing leases instantly", "Confusing DNS record TTL with IPv4 TTL"]} />
      </GuideSection>

      <GuideSection id="dhd-glossary" eyebrow="Glossary" title="Deep-dive terms" tone="violet">
        <Glossary
          items={[
            { term: "T1 / T2", def: "Renewal and rebinding times (default 50 % and 87.5 % of the lease)." },
            { term: "DHCPNAK", def: "Server refusal of a REQUEST. The client restarts at INIT." },
            { term: "Recursive resolver", def: "Does the full lookup on a client's behalf and caches results." },
            { term: "Authoritative server", def: "Holds the official records for a zone." },
            { term: "TC bit", def: "Truncated. Retry the query over TCP." },
          ]}
        />
      </GuideSection>
    </div>
  );
}

