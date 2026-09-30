import { Callout, ChecklistCard, DIAGRAM as D, DiagramFrame, DiagramSvg, DLink, DNode, Glossary, GuideSection } from "@/components/lesson/GuideBlocks";
import { DTable } from "@/components/lesson/FundamentalsGuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { LadderDiagram, SeqLanes, WorkflowDiagram } from "@/components/lesson/TroubleshootingGuideSvg";
import { FLOW, IP, NAME, RECORD_TTL } from "@/lib/sim-engine/scenarios/troubleshootingApplication";

export const AP_LESSON_SECTIONS: LessonGuideSectionLink[] = [
  { id: "apl-mission", label: "The mission" },
  { id: "apl-method", label: "The method" },
  { id: "apl-topology", label: "Topology" },
  { id: "apl-baseline", label: "A healthy request" },
  { id: "apl-layers", label: "What each layer proves" },
  { id: "apl-incident", label: "The failing request" },
  { id: "apl-evidence", label: "Reading the evidence" },
  { id: "apl-direct", label: "Direct-IP comparison" },
  { id: "apl-authoritative", label: "The source of truth" },
  { id: "apl-ruled-out", label: "Ruling out" },
  { id: "apl-repairs", label: "Right vs wrong repairs" },
  { id: "apl-cache", label: "Caches after the fix" },
  { id: "apl-ladder", label: "Evidence ladder" },
  { id: "apl-verify", label: "Verify" },
  { id: "apl-glossary", label: "Glossary" },
];

const B = FLOW.healthy;
const I = FLOW.incident;

function TopologyDiagram() {
  return (
    <DiagramSvg h={210} label="CLIENT connects through NETWORK to the server LAN holding DNS, WEB-OLD and WEB-NEW">
      <DNode x={70} y={105} label="CLIENT" sub={IP.client} accent={D.cyan} w={110} />
      <DNode x={250} y={105} label="NETWORK" sub="gateway" accent={D.violet} w={100} />
      <DNode x={500} y={35} label="DNS" sub={`${IP.dns} · UDP/53`} accent={D.violet} w={170} />
      <DNode x={500} y={105} label="WEB-OLD" sub={`${IP.old} · TCP/80`} accent={D.warning} w={170} />
      <DNode x={500} y={175} label="WEB-NEW" sub={`${IP.new} · TCP/80`} accent={D.success} w={170} />
      <DLink x1={125} y1={105} x2={200} y2={105} />
      <DLink x1={300} y1={98} x2={415} y2={42} />
      <DLink x1={300} y1={105} x2={415} y2={105} />
      <DLink x1={300} y1={112} x2={415} y2={168} />
    </DiagramSvg>
  );
}

function BaselineDiagram() {
  return (
    <DiagramSvg h={240} label={`Healthy request: DNS query and answer ${IP.new} TTL ${RECORD_TTL}, TCP handshake with WEB-NEW, GET with Host header, 200 OK`}>
      <SeqLanes
        lanes={[
          { x: 80, label: "CLIENT", color: D.cyan },
          { x: 320, label: "DNS", color: D.violet },
          { x: 560, label: "WEB-NEW", color: D.success },
        ]}
        msgs={[
          { from: 0, to: 1, label: `A ${NAME}?`, sub: "cache empty → query" },
          { from: 1, to: 0, label: `A ${IP.new} TTL ${RECORD_TTL}`, color: D.violet },
          { from: 0, to: 2, label: `SYN seq ${B.isnC}` },
          { from: 2, to: 0, label: `SYN,ACK seq ${B.isnS} ack ${B.isnC + 1}`, color: D.success },
          { from: 0, to: 2, label: `GET / · Host: ${NAME}`, color: D.warning },
          { from: 2, to: 0, label: "HTTP/1.1 200 OK", color: D.success },
        ]}
      />
    </DiagramSvg>
  );
}

function LayersDiagram() {
  return (
    <DiagramSvg h={140} label="What each observation proves: a DNS answer proves the resolver replied, a TCP handshake proves reachability and a listener, an HTTP status proves the application answered">
      <DTable
        x={30}
        y={8}
        title="Each observation proves one thing"
        cols={[
          { label: "OBSERVATION", w: 170 },
          { label: "PROVES", w: 240 },
          { label: "DOES NOT PROVE", w: 170 },
        ]}
        rows={[
          ["DNS answer", "the resolver replied with an address", "the address is right"],
          ["TCP handshake", "path both ways + a listener", "the right server"],
          ["HTTP status", "the application answered", "the answer is useful"],
        ]}
      />
    </DiagramSvg>
  );
}

function IncidentDiagram() {
  return (
    <DiagramSvg h={240} label={`Failing request: DNS answer ${IP.old}, handshake with WEB-OLD completes, GET delivered, WEB-OLD returns 503`}>
      <SeqLanes
        lanes={[
          { x: 80, label: "CLIENT", color: D.cyan },
          { x: 320, label: "DNS", color: D.violet },
          { x: 560, label: "WEB-OLD", color: D.warning },
        ]}
        msgs={[
          { from: 0, to: 1, label: `A ${NAME}?` },
          { from: 1, to: 0, label: `A ${IP.old} TTL ${RECORD_TTL}`, sub: "DNS answer .20", color: D.warning },
          { from: 0, to: 2, label: `SYN seq ${I.isnC}` },
          { from: 2, to: 0, label: `SYN,ACK seq ${I.isnS} ack ${I.isnC + 1}`, color: D.success },
          { from: 0, to: 2, label: `GET / · Host: ${NAME}`, color: D.warning },
          { from: 2, to: 0, label: "HTTP/1.1 503 Service Unavailable", color: D.danger },
        ]}
      />
    </DiagramSvg>
  );
}

function EvidenceDiagram() {
  return (
    <DiagramSvg h={170} label="Evidence from the failing request: DNS answer, five-tuple, TCP flags, HTTP request line and Host header, HTTP status">
      <DTable
        x={30}
        y={8}
        title="The failing request, field by field"
        cols={[
          { label: "EVIDENCE", w: 150 },
          { label: "VALUE", w: 430 },
        ]}
        rows={[
          ["DNS answer", `${NAME} A ${IP.old} · TTL ${RECORD_TTL}`],
          ["Five-tuple", `TCP ${IP.client}:${I.sport} → ${IP.old}:80`],
          ["TCP flags", "SYN → SYN,ACK → ACK (handshake complete)"],
          ["HTTP request", `GET / HTTP/1.1 · Host: ${NAME}`],
          ["HTTP status", "503 Service Unavailable · Retry-After 120"],
        ]}
      />
    </DiagramSvg>
  );
}

function DirectDiagram() {
  return (
    <DiagramSvg h={130} label={`Direct comparison: curl to ${IP.new} returns 200, curl to ${IP.old} returns 503, curl by name resolves ${IP.old} and returns 503`}>
      <DTable
        x={20}
        y={8}
        title="Change one variable: where the address comes from"
        cols={[
          { label: "TEST", w: 260 },
          { label: "ADDRESS", w: 130 },
          { label: "RESULT", w: 210 },
        ]}
        rows={[
          [`curl http://${IP.new}/`, IP.new, "200 OK"],
          [`curl http://${IP.old}/`, IP.old, "503 Service Unavailable"],
          [`curl http://${NAME}/`, `${IP.old} (DNS)`, "503 Service Unavailable"],
        ]}
        highlight={{ row: 2, color: D.danger }}
      />
    </DiagramSvg>
  );
}

function AuthoritativeDiagram() {
  return (
    <DiagramSvg h={110} label={`The authoritative server answers ${IP.old}; the migration plan says ${IP.new}`}>
      <DTable
        x={60}
        y={8}
        title={`dig @${IP.dns} ${NAME} A`}
        cols={[
          { label: "SOURCE", w: 200 },
          { label: "A RECORD", w: 160 },
          { label: "TTL", w: 160 },
        ]}
        rows={[
          ["Authoritative answer", IP.old, `${RECORD_TTL} s`],
          ["Migration plan", IP.new, `${RECORD_TTL} s`],
        ]}
        highlight={{ row: 0, color: D.warning }}
      />
    </DiagramSvg>
  );
}

function RuledOutDiagram() {
  return (
    <DiagramSvg h={190} label="Hypotheses ruled out: packet loss, TCP/80 blocked, gateway, ARP, MTU, WEB-NEW down">
      <DTable
        x={20}
        y={8}
        title="Every suspect tested against evidence"
        cols={[
          { label: "SUSPECT", w: 180 },
          { label: "EVIDENCE AGAINST IT", w: 420 },
        ]}
        rows={[
          ["Packet loss", "a complete HTTP response came back"],
          ["TCP/80 blocked", "the handshake completed"],
          ["Default gateway", "DNS, TCP and HTTP all crossed it"],
          ["Stale ARP", "every packet reached its destination"],
          ["MTU", "requests and responses arrived intact"],
          ["WEB-NEW down", `direct request to ${IP.new} → 200 OK`],
        ]}
      />
    </DiagramSvg>
  );
}

function RepairsDiagram() {
  return (
    <DiagramSvg h={150} label="Wrong repairs change nothing about the name; flushing a cache only re-asks the same server; the right repair updates the authoritative record">
      <DTable
        x={20}
        y={8}
        title="Repairs compared"
        cols={[
          { label: "CHANGE", w: 250 },
          { label: "EFFECT", w: 350 },
        ]}
        rows={[
          ["Flush the client DNS cache", "re-asks the same authoritative server"],
          ["Clear ARP / change gateway", "nothing: those layers already work"],
          ["Restart WEB-OLD", "still the retired host; still 503"],
          [`Authoritative A → ${IP.new}`, "every new lookup returns WEB-NEW"],
        ]}
        highlight={{ row: 3, color: D.success }}
      />
    </DiagramSvg>
  );
}

function CacheDiagram() {
  const x0 = 60;
  const w = 520;
  const at = (sec: number) => x0 + (sec / RECORD_TTL) * w;
  return (
    <DiagramSvg h={140} label={`After the authoritative fix, the client keeps using its cached ${IP.old} until the TTL expires or the cache is flushed`}>
      <rect x={x0} y={40} width={w} height={22} rx={6} fill={D.warning} fillOpacity={0.18} stroke={D.warning} strokeOpacity={0.6} />
      <text x={x0 + 8} y={55} fill={D.warning} fontSize={10} fontWeight={700}>
        client cache: {NAME} → {IP.old}
      </text>
      <line x1={at(86)} y1={30} x2={at(86)} y2={72} stroke={D.success} strokeWidth={2} />
      <text x={at(86)} y={24} textAnchor="middle" fill={D.success} fontSize={9.5} fontWeight={700}>
        zone fixed
      </text>
      <line x1={at(RECORD_TTL)} y1={30} x2={at(RECORD_TTL)} y2={72} stroke={D.cyan} strokeWidth={2} />
      <text x={at(RECORD_TTL)} y={24} textAnchor="end" fill={D.cyan} fontSize={9.5} fontWeight={700}>
        TTL expires
      </text>
      <text x={x0} y={92} fill={D.muted} fontSize={9.5}>
        0 s: answer cached
      </text>
      <text x={x0 + w} y={92} textAnchor="end" fill={D.muted} fontSize={9.5}>
        {RECORD_TTL} s
      </text>
      <text x={320} y={122} textAnchor="middle" fill={D.text} fontSize={10}>
        Between the fix and expiry this client still gets 503. Flushing just ends the wait early — for this one client.
      </text>
    </DiagramSvg>
  );
}

function VerifyDiagram() {
  return (
    <DiagramSvg h={150} label={`Before and after: authoritative A ${IP.old} to ${IP.new}, fresh lookup ${IP.old} to ${IP.new}, HTTP by name 503 to 200`}>
      <DTable
        x={40}
        y={8}
        title="Same tests, before and after"
        cols={[
          { label: "CHECK", w: 220 },
          { label: "INCIDENT", w: 160 },
          { label: "AFTER REPAIR", w: 160 },
        ]}
        rows={[
          ["Authoritative A record", IP.old, IP.new],
          ["Fresh lookup (cache empty)", IP.old, IP.new],
          ["TCP/80 handshake", "WEB-OLD", "WEB-NEW"],
          [`http://${NAME}/`, "503", "200 OK"],
        ]}
        highlight={{ row: 3, color: D.success }}
      />
    </DiagramSvg>
  );
}

export function ApLessonGuideContent() {
  return (
    <div className="space-y-12">
      <GuideSection id="apl-mission" eyebrow="Mission" title="The network worked — the answer was wrong" tone="cyan">
        <p>
          Users open http://{NAME}/ and see &quot;503 Service Unavailable&quot;. The reflex is to blame the network. This lesson shows why that is backwards: a status code can only exist if every packet arrived and the application answered. The question becomes <em>which</em> application answered, and why the name led there.
        </p>
      </GuideSection>

      <GuideSection id="apl-method" eyebrow="Method" title="Start at the lowest broken dependency" tone="violet">
        <DiagramFrame caption="Evidence decides where to start — here, high in the stack.">
          <DiagramSvg h={82} label="Troubleshooting workflow">
            <WorkflowDiagram notes={["what fails?", "by name only?", "DNS, TCP, HTTP", "one mapping", "direct by IP", "one record", "by name, fresh"]} />
          </DiagramSvg>
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="apl-topology" eyebrow="Topology" title="One name, two web servers" tone="cyan">
        <DiagramFrame caption="Plain HTTP on TCP/80 — no TLS; every byte in the lesson is readable.">
          <TopologyDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="apl-baseline" eyebrow="Baseline" title="A healthy request" tone="success">
        <DiagramFrame caption="Name → address → connection → request → status.">
          <BaselineDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="apl-layers" eyebrow="Concepts" title="What each layer proves" tone="warning">
        <DiagramFrame caption="Read each result for exactly what it proves.">
          <LayersDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="apl-incident" eyebrow="Incident" title="The failing request" tone="danger">
        <DiagramFrame caption="Nothing was lost: a complete answer came back.">
          <IncidentDiagram />
        </DiagramFrame>
        <Callout tone="danger" title="503 is not a transport error">
          Transport failures look like timeouts, resets or ICMP errors. A well-formed HTTP response — any status — means the network delivered the request and the reply.
        </Callout>
      </GuideSection>

      <GuideSection id="apl-evidence" eyebrow="Evidence" title="Reading the evidence" tone="violet">
        <DiagramFrame caption="The destination address came from the DNS answer.">
          <EvidenceDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="apl-direct" eyebrow="Evidence" title="Direct-IP comparison" tone="ip">
        <DiagramFrame caption="Same request, same Host header — only the address source changes.">
          <DirectDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="apl-authoritative" eyebrow="Evidence" title="Ask the source of truth" tone="violet">
        <DiagramFrame caption="Querying the authoritative server rules out an intermediate cache.">
          <AuthoritativeDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="apl-ruled-out" eyebrow="Hypotheses" title="Ruling out the usual suspects" tone="violet">
        <DiagramFrame caption="Each suspect predicts something the evidence contradicts.">
          <RuledOutDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="apl-repairs" eyebrow="Repair" title="Right vs wrong repairs" tone="warning">
        <DiagramFrame caption="Fix the mapping at its source.">
          <RepairsDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="apl-cache" eyebrow="Verify" title="Caches after the fix" tone="warning">
        <DiagramFrame caption="A correct fix can be invisible to a client for up to one TTL.">
          <CacheDiagram />
        </DiagramFrame>
        <Callout tone="warning" title="A flush is not a fix">
          Flushing the client cache before the zone is corrected just fetches the same wrong answer again. After the zone is corrected, a flush only lets one lab client see the fix sooner.
        </Callout>
      </GuideSection>

      <GuideSection id="apl-ladder" eyebrow="Ladder" title="Start where the evidence points" tone="cyan">
        <DiagramFrame caption="The lower rungs are already proven by the 503 itself.">
          <DiagramSvg h={130} label="Evidence ladder for this incident">
            <LadderDiagram
              rows={[
                { rung: "Network / IP", evidence: "all packets delivered both ways", status: "ok" },
                { rung: "Transport", evidence: "TCP/80 handshake completes", status: "ok" },
                { rung: "Intended service", evidence: `${IP.new} direct → 200`, status: "ok" },
                { rung: "Name resolution", evidence: `authoritative A → ${IP.old}`, status: "fail" },
                { rung: "Result by name", evidence: "503 (consequence)", status: "suspect" },
              ]}
            />
          </DiagramSvg>
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="apl-verify" eyebrow="Verify" title="By name, fresh lookup, 200" tone="success">
        <DiagramFrame caption="Proof repeats the original failing test.">
          <VerifyDiagram />
        </DiagramFrame>
        <ChecklistCard tone="success" title="Verified" mark="✓" items={[`Authoritative: ${NAME} A ${IP.new}`, "Client cache flushed for the test (or TTL expired)", `Fresh lookup → ${IP.new}`, `http://${NAME}/ → 200 OK from WEB-NEW`]} />
      </GuideSection>

      <GuideSection id="apl-glossary" eyebrow="Glossary" title="Terms" tone="cyan">
        <Glossary
          items={[
            { term: "A record", def: "Maps a name to an IPv4 address." },
            { term: "TTL (DNS)", def: "How many seconds a resolver or client may reuse an answer." },
            { term: "Authoritative server", def: "The server that owns a zone's records — the source of truth." },
            { term: "Host header", def: "The site name in an HTTP/1.1 request, so one server can host many sites." },
            { term: "503 Service Unavailable", def: "The server answered, but is not serving this request right now." },
          ]}
        />
      </GuideSection>
    </div>
  );
}
