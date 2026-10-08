import { CompareCards, DArrow, DIAGRAM as D, DiagramFrame, DiagramSvg, DNode, FlowSteps, Glossary, GuideSection } from "@/components/lesson/GuideBlocks";
import { DTable } from "@/components/lesson/FundamentalsGuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { LadderDiagram, SeqLanes } from "@/components/lesson/TroubleshootingGuideSvg";
import { FLOW, IP, NAME, RECORD_TTL } from "@/lib/sim-engine/scenarios/troubleshootingApplication";

export const AP_DEEP_DIVE_SECTIONS: LessonGuideSectionLink[] = [
  { id: "apd-resolution", label: "Cache, recursive, authoritative" },
  { id: "apd-a", label: "The A record" },
  { id: "apd-ttl", label: "TTL and cache expiry" },
  { id: "apd-tuple", label: "The five-tuple" },
  { id: "apd-handshake", label: "TCP handshake" },
  { id: "apd-request", label: "The HTTP request" },
  { id: "apd-host", label: "Host header vs IP" },
  { id: "apd-status", label: "Status codes: 200 vs 503" },
  { id: "apd-success", label: "Network success, app failure" },
  { id: "apd-mapping", label: "Name-to-service mapping" },
  { id: "apd-workflow", label: "Workflow" },
  { id: "apd-glossary", label: "Glossary" },
];

const B = FLOW.healthy;

function ResolutionDiagram() {
  return (
    <DiagramSvg h={150} label="Resolution path: client cache first, then a recursive resolver with its own cache, then the authoritative server for the zone">
      <DNode x={90} y={60} label="Client cache" sub="stub resolver" accent={D.cyan} w={130} />
      <DNode x={320} y={60} label="Recursive" sub="has its own cache" accent={D.violet} w={140} />
      <DNode x={550} y={60} label="Authoritative" sub="owns example.test" accent={D.success} w={140} />
      <DArrow x1={157} y1={60} x2={248} y2={60} label="miss → ask" />
      <DArrow x1={392} y1={60} x2={478} y2={60} label="miss → ask" />
      <text x={320} y={118} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        Each layer answers from cache while the TTL lasts. In this lab the DNS server is both resolver and authority.
      </text>
    </DiagramSvg>
  );
}

function ARecordDiagram() {
  return (
    <DiagramSvg h={110} label={`A resource record: name ${NAME}, type A, class IN, TTL ${RECORD_TTL}, data a 4-byte IPv4 address`}>
      <DTable
        x={30}
        y={8}
        title="Resource record in the answer section"
        cols={[
          { label: "NAME", w: 170 },
          { label: "TYPE", w: 60 },
          { label: "CLASS", w: 70 },
          { label: "TTL", w: 90 },
          { label: "RDLENGTH", w: 80 },
          { label: "RDATA", w: 110 },
        ]}
        rows={[[NAME, "A (1)", "IN (1)", `${RECORD_TTL} s`, "4", IP.new]]}
      />
    </DiagramSvg>
  );
}

function TtlDiagram() {
  return (
    <DiagramSvg h={120} label="A cached answer's remaining TTL counts down; while it is above zero the client does not ask again">
      <DTable
        x={40}
        y={8}
        title="The same cache entry over time"
        cols={[
          { label: "TIME SINCE ANSWER", w: 170 },
          { label: "REMAINING TTL", w: 150 },
          { label: "CLIENT BEHAVIOR", w: 240 },
        ]}
        rows={[
          ["0 s", `${RECORD_TTL} s`, "uses cached address"],
          ["86 s", `${RECORD_TTL - 86} s`, "uses cached address (no query)"],
          [`${RECORD_TTL} s`, "0 — expired", "queries again, caches new answer"],
        ]}
      />
    </DiagramSvg>
  );
}

function TupleDiagram() {
  return (
    <DiagramSvg h={90} label="The five-tuple: protocol, source IP, source port, destination IP, destination port">
      <DTable
        x={30}
        y={8}
        title="Five-tuple identifies one connection"
        cols={[
          { label: "PROTO", w: 80 },
          { label: "SRC IP", w: 130 },
          { label: "SRC PORT", w: 100 },
          { label: "DST IP", w: 170 },
          { label: "DST PORT", w: 100 },
        ]}
        rows={[["TCP", IP.client, String(B.sport), `${IP.new} (from DNS)`, "80"]]}
      />
    </DiagramSvg>
  );
}

function HandshakeDiagram() {
  return (
    <DiagramSvg h={150} label={`TCP handshake: SYN seq ${B.isnC}; SYN-ACK seq ${B.isnS} ack ${B.isnC + 1}; ACK seq ${B.isnC + 1} ack ${B.isnS + 1}`}>
      <SeqLanes
        lanes={[
          { x: 120, label: "CLIENT", color: D.cyan },
          { x: 520, label: "WEB-NEW", color: D.success },
        ]}
        msgs={[
          { from: 0, to: 1, label: `SYN seq ${B.isnC}`, sub: "MSS 1460" },
          { from: 1, to: 0, label: `SYN,ACK seq ${B.isnS} ack ${B.isnC + 1}`, color: D.success },
          { from: 0, to: 1, label: `ACK seq ${B.isnC + 1} ack ${B.isnS + 1}` },
        ]}
      />
    </DiagramSvg>
  );
}

function RequestDiagram() {
  return (
    <DiagramSvg h={192} label="HTTP/1.1 request in plain text: request line, Host, User-Agent, Accept, Connection headers, blank line">
      <DTable
        x={60}
        y={8}
        title="GET request bytes (101 bytes, plain text)"
        cols={[
          { label: "LINE", w: 150 },
          { label: "TEXT", w: 370 },
        ]}
        rows={[
          ["Request line", "GET / HTTP/1.1"],
          ["Host", NAME],
          ["User-Agent", "pv-lab/1.0"],
          ["Accept", "*/*"],
          ["Connection", "close"],
          ["(blank line)", "end of headers — no body"],
        ]}
      />
    </DiagramSvg>
  );
}

function HostDiagram() {
  return (
    <DiagramSvg h={110} label="The IP destination chooses the server; the Host header chooses the site on that server">
      <DTable
        x={40}
        y={8}
        title="Two different fields, two different jobs"
        cols={[
          { label: "FIELD", w: 170 },
          { label: "SET FROM", w: 170 },
          { label: "CHOOSES", w: 220 },
        ]}
        rows={[
          ["IPv4 destination", "the DNS answer", "which server receives it"],
          ["HTTP Host header", "the URL the user typed", "which site that server serves"],
        ]}
      />
    </DiagramSvg>
  );
}

function StatusDiagram() {
  return (
    <DiagramSvg h={170} label="HTTP status classes: 1xx informational, 2xx success, 3xx redirect, 4xx client error, 5xx server error; 200 OK vs 503 Service Unavailable">
      <DTable
        x={40}
        y={8}
        title="Status classes — all are application answers"
        cols={[
          { label: "CLASS", w: 90 },
          { label: "MEANING", w: 200 },
          { label: "EXAMPLE", w: 270 },
        ]}
        rows={[
          ["2xx", "success", "200 OK — WEB-NEW"],
          ["3xx", "go elsewhere", "301 Moved Permanently"],
          ["4xx", "the request is at fault", "404 Not Found"],
          ["5xx", "the server cannot serve it", "503 Service Unavailable — WEB-OLD"],
        ]}
        highlight={{ row: 3, color: D.warning }}
      />
    </DiagramSvg>
  );
}

function SuccessFailureDiagram() {
  return (
    <DiagramSvg h={150} label="Symptoms of network failures versus application failures">
      <DTable
        x={30}
        y={8}
        title="What the symptom looks like"
        cols={[
          { label: "SYMPTOM", w: 230 },
          { label: "LAYER THAT FAILED", w: 350 },
        ]}
        rows={[
          ["timeout, no SYN-ACK", "path / filter / no host"],
          ["TCP RST to SYN", "host up, nothing listening on the port"],
          ["name does not resolve", "DNS"],
          ["complete HTTP 5xx response", "application (network worked)"],
        ]}
        highlight={{ row: 3, color: D.warning }}
      />
    </DiagramSvg>
  );
}

function MappingDiagram() {
  return (
    <DiagramSvg h={120} label="Name to service mapping chain: name, A record, IP address, server, site selected by Host header, status">
      <DNode x={70} y={50} label="name" sub="portal…" accent={D.cyan} w={100} />
      <DNode x={200} y={50} label="A record" sub="authoritative" accent={D.violet} w={110} />
      <DNode x={330} y={50} label="address" sub={IP.new} accent={D.ip} w={110} />
      <DNode x={460} y={50} label="server" sub="TCP/80" accent={D.success} w={100} />
      <DNode x={580} y={50} label="site" sub="Host →200" accent={D.success} w={96} />
      <DArrow x1={121} y1={50} x2={143} y2={50} />
      <DArrow x1={256} y1={50} x2={273} y2={50} />
      <DArrow x1={386} y1={50} x2={408} y2={50} />
      <DArrow x1={511} y1={50} x2={530} y2={50} />
      <text x={320} y={102} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        A wrong link anywhere in this chain can still produce a perfectly healthy TCP connection.
      </text>
    </DiagramSvg>
  );
}

export function ApDeepDiveContent() {
  return (
    <div className="space-y-12">
      <GuideSection id="apd-resolution" eyebrow="DNS" title="Client cache, recursive and authoritative" tone="violet">
        <DiagramFrame caption="The first cache with a fresh answer wins — correct or not.">
          <ResolutionDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="apd-a" eyebrow="DNS" title="The A record" tone="violet">
        <DiagramFrame caption="An A record's data is exactly four bytes: one IPv4 address.">
          <ARecordDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="apd-ttl" eyebrow="DNS" title="TTL and cache expiry" tone="warning">
        <DiagramFrame caption="The TTL served with an answer bounds how long that answer can outlive a change.">
          <TtlDiagram />
        </DiagramFrame>
        <CompareCards
          items={[
            { title: "Lower TTL before a change", tone: "success", tag: "plan", points: ["caches turn over quickly", "the change is seen within minutes", "raise it again afterwards"] },
            { title: "Change with a long TTL", tone: "warning", tag: "wait", points: ["clients keep the old answer", "only expiry or a flush clears it", "flushing every client is not realistic"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="apd-tuple" eyebrow="TCP" title="The five-tuple" tone="tcp">
        <DiagramFrame caption="The destination IP in the tuple is whatever DNS returned.">
          <TupleDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="apd-handshake" eyebrow="TCP" title="The TCP handshake" tone="tcp">
        <DiagramFrame caption="Each side acknowledges the other's sequence number + 1.">
          <HandshakeDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="apd-request" eyebrow="HTTP" title="The HTTP request" tone="warning">
        <DiagramFrame caption="Plain HTTP/1.1 is text lines ending in CRLF, then a blank line.">
          <RequestDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="apd-host" eyebrow="HTTP" title="Host header vs IP destination" tone="warning">
        <DiagramFrame caption="Sending the right Host to the wrong server still reaches the wrong server.">
          <HostDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="apd-status" eyebrow="HTTP" title="Status codes: 200 vs 503" tone="warning">
        <DiagramFrame caption="Every status code is an answer from the application.">
          <StatusDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="apd-success" eyebrow="Diagnosis" title="Network success, application failure" tone="danger">
        <DiagramFrame caption="The shape of the failure tells you which layer to look at.">
          <SuccessFailureDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="apd-mapping" eyebrow="Diagnosis" title="Name-to-service mapping" tone="cyan">
        <DiagramFrame caption="Test each link of the chain separately — a direct request by IP skips the first two.">
          <MappingDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="apd-workflow" eyebrow="Workflow" title="An application troubleshooting workflow" tone="cyan">
        <DiagramFrame caption="Each rung is one observable result.">
          <DiagramSvg h={150} label="Application troubleshooting ladder">
            <LadderDiagram
              rows={[
                { rung: "What did DNS return?", evidence: "dig name · compare to intent", status: "suspect" },
                { rung: "Did TCP connect?", evidence: "handshake flags on the five-tuple", status: "ok" },
                { rung: "What was requested?", evidence: "request line + Host header", status: "ok" },
                { rung: "What status came back?", evidence: "status line, from which server", status: "suspect" },
                { rung: "Direct test by IP", evidence: "same request to the intended server", status: "ok" },
              ]}
            />
          </DiagramSvg>
        </DiagramFrame>
        <FlowSteps
          steps={[
            { title: "Resolve", body: `dig ${NAME} — note the address and TTL.`, tone: "violet" },
            { title: "Connect", body: "curl -v shows the address it connected to.", tone: "cyan" },
            { title: "Compare", body: "Repeat by IP with the same Host header.", tone: "warning" },
            { title: "Fix at the source", body: "Correct the authoritative record, then handle caches when verifying.", tone: "success" },
          ]}
        />
      </GuideSection>

      <GuideSection id="apd-glossary" eyebrow="Glossary" title="Terms" tone="cyan">
        <Glossary
          items={[
            { term: "Stub resolver", def: "The client's resolver library and cache." },
            { term: "Recursive resolver", def: "Finds answers on the client's behalf and caches them." },
            { term: "Negative caching", def: "Caching 'no such name' answers too, for the zone's negative TTL." },
            { term: "Virtual host", def: "One server hosting several sites, chosen by the Host header." },
            { term: "Retry-After", def: "A header on 503 responses suggesting when to try again." },
          ]}
        />
      </GuideSection>
    </div>
  );
}
