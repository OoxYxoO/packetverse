import { Callout, ChecklistCard, CompareCards, DArrow, DIAGRAM as D, DNode, DPill, DiagramFrame, DiagramSvg, FailureSignatures, Glossary, GuideSection, Misconceptions, Mono, PathDivider, ProtocolStory, TroubleshootingFlow } from "@/components/lesson/GuideBlocks";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { TN_ADDR, TN_DNS, TN_FIRST, TN_HTTP, TN_TIMERS } from "@/lib/sim-engine/scenarios/tcpNet";

/**
 * TCP/UDP LESSON GUIDE — the transport layer as one story on this lesson's network (Laptop — R1 — Server, the lab's
 * own values): why transport exists, ports, client and server, the listening socket, the handshake with both endpoints
 * changing state, seq/ack, data, loss and retransmission, close and reset, refused vs timeout, UDP, then verifying and
 * troubleshooting. Every stage says how to confirm it happened and what failure looks like there.
 */
export const TCP_LESSON_GUIDE_SECTIONS: LessonGuideSectionLink[] = [
  { id: "t-mission", label: "Your mission" },
  { id: "t-story", label: "The whole story" },
  { id: "t-breaks", label: "When it breaks" },
  { id: "t-ports", label: "Ports and conversations" },
  { id: "t-handshake", label: "Handshake and endpoint state" },
  { id: "t-seq", label: "seq and ack" },
  { id: "t-loss", label: "Loss and retransmission" },
  { id: "t-close", label: "Close, reset, refused, timeout" },
  { id: "t-udp", label: "UDP" },
  { id: "t-layers", label: "Is it really TCP?" },
  { id: "t-memorize", label: "What to memorize" },
  { id: "t-glossary", label: "Glossary" },
  { id: "t-recap", label: "Quick recap" },
];

const C = TN_FIRST.clientIsn;
const S = TN_FIRST.serverIsn;
const CP = TN_FIRST.clientPort;

function NetworkDiagram() {
  return (
    <DiagramSvg h={170} label={`Laptop ${TN_ADDR.laptop} connects through R1 to the Server ${TN_ADDR.server}, which listens on several ports`}>
      <DNode x={100} y={70} label="Laptop" sub={`${TN_ADDR.laptop} : ${CP}`} w={170} />
      <DNode x={320} y={70} label="R1" sub="routes IP · no TCP state" accent={D.faint} w={150} />
      <DNode x={540} y={70} label="Server" sub={TN_ADDR.server} accent={D.tcp} w={150} />
      <DArrow x1={186} y1={70} x2={244} y2={70} color={D.tcp} both />
      <DArrow x1={396} y1={70} x2={464} y2={70} color={D.tcp} both />
      {["TCP 22 ssh", "TCP 80 http", "TCP 443 https", "TCP 8443 api", "UDP 53 dns"].map((p, i) => (
        <DPill key={p} x={470 + (i % 2) * 74} y={102 + Math.floor(i / 2) * 20} text={p} color={p.startsWith("UDP") ? D.warning : D.tcp} w={70} />
      ))}
      <text x={100} y={128} textAnchor="middle" fill={D.muted} fontSize={10}>
        client: picks a source port per connection
      </text>
    </DiagramSvg>
  );
}
function HandshakeDiagram() {
  return (
    <DiagramSvg h={250} label={`SYN seq=${C}, SYN-ACK seq=${S} ack=${C + 1}, ACK ack=${S + 1}, with each endpoint's state`}>
      <text x={110} y={22} textAnchor="middle" fill={D.text} fontSize={12} fontWeight={600}>
        Laptop :{CP}
      </text>
      <text x={530} y={22} textAnchor="middle" fill={D.text} fontSize={12} fontWeight={600}>
        Server :443
      </text>
      <line x1={110} y1={32} x2={110} y2={240} stroke={D.line} strokeDasharray="3 4" />
      <line x1={530} y1={32} x2={530} y2={240} stroke={D.line} strokeDasharray="3 4" />
      <DPill x={46} y={42} text="SYN-SENT" color={D.warning} w={84} />
      <DPill x={594} y={42} text="LISTEN" color={D.faint} w={84} />
      <DArrow x1={112} y1={58} x2={526} y2={86} color={D.tcp} label={`SYN  seq=${C}`} labelDy={-12} />
      <DPill x={594} y={98} text="SYN-RECEIVED" color={D.warning} w={100} />
      <DArrow x1={528} y1={112} x2={114} y2={140} color={D.tcp} label={`SYN-ACK  seq=${S}  ack=${C + 1}`} labelDy={-12} />
      <DPill x={52} y={154} text="ESTABLISHED" color={D.success} w={96} />
      <DArrow x1={112} y1={168} x2={526} y2={196} color={D.tcp} label={`ACK  seq=${C + 1}  ack=${S + 1}`} labelDy={-12} />
      <DPill x={588} y={208} text="ESTABLISHED" color={D.success} w={96} />
      <text x={320} y={238} textAnchor="middle" fill={D.muted} fontSize={10}>
        both endpoints change state — R1, in the middle, never does
      </text>
    </DiagramSvg>
  );
}

export function TcpLessonGuideContent() {
  return (
    <>
      <GuideSection id="t-mission" eyebrow="Introduction" title="Your mission: understand what happens between two programs" tone="tcp">
        <p>
          The Laptop (<Mono tone="cyan">{TN_ADDR.laptop}</Mono>) talks to programs on the Server (<Mono tone="tcp">{TN_ADDR.server}</Mono>) through R1. IP delivers each packet to the right <b className="text-pv-text">host</b>. The transport layer delivers it to the right <b className="text-pv-text">program</b> — and, with TCP, makes the conversation reliable.
        </p>
        <DiagramFrame caption="The lesson's network: one client, one router, one server with several services.">
          <NetworkDiagram />
        </DiagramFrame>
        <Callout tone="tcp" title="The big questions" icon="?">
          Which program is a packet for? How do two endpoints agree to talk — and know exactly which bytes arrived? And when a connection fails: was it refused, lost, or something below TCP altogether?
        </Callout>
      </GuideSection>

      <GuideSection id="t-story" eyebrow="How it works" title="From a listening service to a closed connection" tone="cyan">
        <ProtocolStory
          problem={<>A web page has to travel from nginx on the Server to curl on the Laptop: complete, in order, to the right program. IP alone can deliver packets to the host — not to the program, and without any guarantee.</>}
          steps={[
            { actor: "Server", action: <>nginx opens a <strong>listening socket</strong> on TCP 80 (and 443). sshd listens on 22, named on UDP 53.</>, changes: "Server: LISTEN on each service port", verify: "ss -tlnp on the Server lists each port with its process.", fails: { symptom: "A SYN to that port gets RST: connection refused.", evidence: "Nothing listens there — the service is stopped, or on another port." }, tone: "tcp" },
            { actor: "Laptop", action: <>curl asks for a connection to 10.20.20.20:80. The OS picks a source port (<strong>{CP}</strong>) and an ISN ({C}) and sends a <strong>SYN</strong>.</>, changes: "Laptop: CLOSED → SYN-SENT", verify: "Capture on the Laptop: SYN, seq = its ISN, ports 51001 → 80.", fails: { symptom: "The SYN repeats after 1 s, 2 s, 4 s…", evidence: "Nothing is coming back: find where the SYN or the answer stops." }, tone: "tcp" },
            { actor: "R1", action: "routes the packet like any other (TTL −1). It doesn't look at TCP state — there is none on R1.", why: "TCP is end to end", verify: "R1's captures show the SYN in on Gi0/0 and out on Gi0/1.", fails: { symptom: "The SYN arrives on R1 and never leaves.", evidence: "R1 drops it (an ACL, an interface) — silently." }, tone: "ip" },
            { actor: "Server", action: <>the listening socket accepts: a new connection answers <strong>SYN-ACK</strong> — its own ISN ({S}) and ack = {C + 1}.</>, changes: "Server: a new connection in SYN-RECEIVED", why: "the SYN counts as one byte, so the next byte expected is ISN + 1", verify: "Server capture: SYN in, SYN-ACK out; ss -tan shows SYN-RECV.", fails: { symptom: "The Server shows SYN-RECV forever.", evidence: "Its SYN-ACK never got an answer: it was lost on the way back (filter, route)." }, tone: "tcp" },
            { actor: "Laptop", action: <>the SYN-ACK arrives: it acknowledges with <strong>ACK</strong> (ack = {S + 1}).</>, changes: "Laptop: ESTABLISHED, then Server: ESTABLISHED when the ACK arrives", verify: "Both socket tables show ESTAB for the same 4-tuple.", fails: { symptom: "The Laptop stays SYN-SENT.", evidence: "No SYN-ACK reached it: compare the captures point by point." }, tone: "success" },
            { actor: "Both", action: <>curl sends its {TN_HTTP.request}-byte request; nginx sends the {TN_HTTP.response}-byte page in segments. Every byte is numbered; every ACK names the next byte expected.</>, changes: "Sequence numbers advance by bytes sent", verify: `The request covers ${C + 1}–${C + TN_HTTP.request}; the Server acks ${C + 1 + TN_HTTP.request}.`, fails: { symptom: "The same seq is sent twice; duplicate ACKs.", evidence: "A segment was lost and resent — TCP recovered; look for where loss happens." }, tone: "cyan" },
            { actor: "Both", action: <>curl closes: <strong>FIN</strong>, ACK, FIN, ACK. The Laptop waits in TIME-WAIT; the Server&apos;s connection is gone.</>, changes: "FIN-WAIT-1 → FIN-WAIT-2 → TIME-WAIT · CLOSE-WAIT → LAST-ACK → CLOSED", verify: "ss -tan on the Laptop shows TIME-WAIT for 60 s.", fails: { symptom: "A RST instead of a FIN.", evidence: "The connection was aborted or refused, not closed." }, tone: "violet" },
          ]}
          outcome={<>Ports put the bytes in the right program; the handshake gave both ends state to number and acknowledge bytes; loss was repaired by retransmission; the close tidied both ends. The lab lets you watch all of it — and break each part.</>}
        />
      </GuideSection>

      <GuideSection id="t-breaks" eyebrow="When it breaks" title="“The application can't connect”: walk the evidence in order" tone="danger">
        <TroubleshootingFlow
          steps={[
            { question: "Can I reach the host at all?", look: "ping the Server. No replies → an IP problem (routes, return path) before any TCP question." },
            { question: "Which destination port does the application use?", look: "HTTP 80, HTTPS 443, SSH 22, the API 8443 — DNS is UDP 53." },
            { question: "Did the client send its SYN? Did the Server receive it?", look: "Capture on the Laptop, then on the Server. Seeing the SYN leave doesn't prove it arrived." },
            { question: "Is anything listening on that port?", look: "ss -tlnp on the Server. No listener → RST → refused." },
            { question: "Did the Server answer — SYN-ACK or RST?", look: "Server capture. Received but no answer → its firewall (INPUT) or its routes." },
            { question: "Did the answer come back?", look: "R1 Gi0/1 in, Gi0/0 out, Laptop in: the first point where it's missing is where it was lost." },
            { question: "What state is each endpoint in?", look: "Laptop SYN-SENT + Server SYN-RECV = the SYN-ACK is lost on the way back." },
            { question: "Fix, verify, prove", look: "Change one thing on the device, check the device (ss, iptables -L, ip route, show access-lists), then repeat the user's test." },
          ]}
        />
      </GuideSection>

      <PathDivider title="Reference">Each part of the story in detail — with how to confirm it, and what failure looks like.</PathDivider>

      <GuideSection id="t-ports" eyebrow="Ports" title="An IP finds the host; a port finds the program" tone="cyan">
        <CompareCards
          items={[
            { title: "Server ports", tone: "tcp", tag: "listening", points: ["Fixed, well known: 22, 80, 443, 8443 — UDP 53", "One listening socket per service", "Confirm: ss -tlnp / ss -ulnp"] },
            { title: "Client ports", tone: "cyan", tag: "ephemeral", points: [`Picked by the OS per connection: ${CP}, ${CP + 1}…`, "Lets answers find the right program", "Confirm: ss -tan on the Laptop"] },
          ]}
        />
        <p>
          A conversation is the <b className="text-pv-text">4-tuple</b> <Mono>client IP:port ⇄ server IP:port</Mono>. <Mono>{TN_ADDR.laptop}:{CP} → {TN_ADDR.server}:443</Mono> and <Mono>{TN_ADDR.laptop}:{CP + 1} → {TN_ADDR.server}:22</Mono> share both addresses and are still two separate conversations.
        </p>
      </GuideSection>

      <GuideSection id="t-handshake" eyebrow="The handshake" title="SYN, SYN-ACK, ACK — and both endpoints change state" tone="tcp">
        <DiagramFrame caption="The lab's first connection, with the state of each endpoint at the moment it changes.">
          <HandshakeDiagram />
        </DiagramFrame>
        <p>Each side announces where it will start numbering its bytes (its ISN) and has it acknowledged. The Laptop is ESTABLISHED as soon as it gets the SYN-ACK; the Server only when the final ACK arrives. R1 forwards all three and keeps nothing — TCP state lives in the two endpoints.</p>
        <Callout tone="cyan" title="How to confirm it">Captures at both ends show the three segments; <Mono>ss -tan</Mono> on both hosts shows ESTAB for the same 4-tuple. On R1 there is nothing to look at.</Callout>
      </GuideSection>

      <GuideSection id="t-seq" eyebrow="Bytes" title="seq = where these bytes begin · ack = the next byte I expect" tone="ip">
        <p>
          The request is {TN_HTTP.request} bytes starting at <Mono>seq={C + 1}</Mono>: it covers {C + 1}–{C + TN_HTTP.request}, so the Server answers <Mono>ack={C + 1 + TN_HTTP.request}</Mono>. The page&apos;s first segment starts at {S + 1} and carries 1000 bytes: the Laptop answers ack={S + 1001}. SYN and FIN count as one byte each; a pure ACK counts zero.
        </p>
        <Callout tone="ip" title="Why it matters">Because each ACK says exactly which byte comes next, the sender knows what arrived and what didn&apos;t — that&apos;s what makes retransmission possible.</Callout>
      </GuideSection>

      <GuideSection id="t-loss" eyebrow="Reliability" title="Lost bytes are noticed — and sent again" tone="warning">
        <p>
          When R1 loses the page&apos;s second segment (bytes {S + 1001}–{S + 2000}), the third still arrives. The Laptop keeps it aside and repeats <Mono>ack={S + 1001}</Mono> — a <b className="text-pv-text">duplicate ACK</b>. After {TN_TIMERS.dataRto} ms without progress the Server resends the same bytes (same seq); the hole is filled and the ACK jumps to {S + TN_HTTP.response + 1}. A lost SYN is resent after {TN_TIMERS.synRto / 1000} s, then 2, 4…
        </p>
        <Callout tone="warning" title="How to confirm it">The capture shows the same seq twice (the second marked as a retransmission) and the same ack repeated. Routers and switches resent nothing — the endpoints did.</Callout>
      </GuideSection>

      <GuideSection id="t-close" eyebrow="Endings" title="Close, reset, refused, timeout — four different stories" tone="danger">
        <FailureSignatures
          items={[
            { tag: "FIN", title: "Orderly close", tone: "violet", points: ["FIN, ACK, FIN, ACK", "Each side closes its direction", "Closer waits in TIME-WAIT (60 s)"] },
            { tag: "RST", title: "Refused", tone: "danger", points: ["SYN answered at once by RST,ACK", "The host is up, reached both ways", "Nothing listens (or REJECT with tcp-reset)"] },
            { tag: "⏱", title: "Timeout", tone: "warning", points: ["SYN… SYN… SYN… nothing", "The SYN or the answer is lost", "Filter · return route · host firewall · host off"] },
            { tag: "ICMP", title: "Port unreachable", tone: "danger", points: ["A REJECT (default) or a closed UDP port", "Reported as “refused” too", "Comes from the host's IP layer"] },
          ]}
        />
        <Callout tone="danger" title="A timeout is not “the server is down”">It only means the expected answer never arrived. Captures at each point tell you where it stopped — and the endpoint states tell you which half of the exchange was lost.</Callout>
      </GuideSection>

      <GuideSection id="t-udp" eyebrow="UDP" title="UDP: ports and datagrams, nothing more" tone="cyan">
        <CompareCards
          items={[
            { title: "TCP", tone: "tcp", tag: "connection", points: ["handshake → data → close", "seq / ack, retransmission", "state at both ends"] },
            { title: "UDP", tone: "warning", tag: "datagram", points: ["send a datagram → maybe an answer", "no seq, no ack, no retransmission", "no connection state (UNCONN)"] },
          ]}
        />
        <p>
          dig asks <Mono>{TN_DNS.name}</Mono> with one datagram to UDP 53 and gets one back. If the answer doesn&apos;t come, <b className="text-pv-text">dig</b> retries ({TN_TIMERS.dnsTries} tries, {TN_TIMERS.dnsTimeout / 1000} s each) — UDP never does. A closed UDP port answers with ICMP port unreachable (there is no RST). UDP isn&apos;t a worse TCP: for one small question and one small answer, a connection would only add delay.
        </p>
      </GuideSection>

      <GuideSection id="t-layers" eyebrow="Separating layers" title="Is it really TCP?" tone="warning">
        <Misconceptions
          items={[
            { myth: "The connection times out, so TCP is broken.", correction: "TCP is behaving by the book. Something below or beside it (a route, a filter, a firewall) loses the SYN or the answer." },
            { myth: "Ping works, so the service must be reachable.", correction: "Ping proves IP reachability. A port can still be closed (RST) or filtered (timeout)." },
            { myth: "The service works on the server itself, so the network is fine.", correction: "Testing over loopback skips the NIC, R1 and any rule bound to eth0. Test from the client." },
            { myth: "No route back would show up as an ICMP error.", correction: "A server with no route back simply can't answer: SYN in, nothing out, SYN-RECV — and ping fails too. That's an IP problem." },
            { myth: "Routers know about my TCP connection.", correction: "They forward packets. Their ACLs can match ports, but the connection's state lives only in the endpoints." },
          ]}
        />
      </GuideSection>

      <GuideSection id="t-memorize" eyebrow="Exam-ready" title="What to memorize" tone="success">
        <ChecklistCard
          tone="success"
          mark="✓"
          title="Must know"
          items={[
            "IP finds the host; the port finds the program; the 4-tuple names the conversation.",
            "SYN → SYN-ACK → ACK. Client: CLOSED → SYN-SENT → ESTABLISHED. Server: LISTEN → SYN-RECEIVED → ESTABLISHED.",
            "seq = first byte of the segment; ack = next byte expected. SYN and FIN count one each.",
            "Loss shows as duplicate ACKs and the same seq resent; the ACK then jumps.",
            "RST = refused (reachable, nothing listening). Silence = timeout (something lost it).",
            "UDP: no handshake, no state, no retransmission — the application handles silence.",
            "Routers keep no TCP state. Ask the endpoints for state, the network for where packets went.",
          ]}
        />
      </GuideSection>

      <GuideSection id="t-glossary" eyebrow="Reference" title="Glossary" tone="cyan">
        <Glossary
          items={[
            { term: "Port", def: "A number that identifies a program on a host (22 SSH, 80 HTTP, 443 HTTPS, 53 DNS)." },
            { term: "Ephemeral port", def: "The client's temporary source port, chosen by its OS for one connection." },
            { term: "Listening socket", def: "A server program waiting for SYNs on a port (LISTEN)." },
            { term: "4-tuple", def: "Client IP, client port, server IP, server port: the name of a conversation." },
            { term: "ISN", def: "Initial sequence number: where an endpoint starts numbering its bytes." },
            { term: "ACK number", def: "The next byte the sender of the ACK expects." },
            { term: "Duplicate ACK", def: "The same ACK number repeated: a byte is still missing." },
            { term: "RST", def: "Reset: refuse or abort a connection at once." },
            { term: "TIME-WAIT", def: "The state the side that closed first stays in (60 s) before forgetting the connection." },
            { term: "Datagram", def: "One UDP message: ports, length, data — no connection." },
          ]}
        />
      </GuideSection>

      <GuideSection id="t-recap" eyebrow="In one breath" title="Quick recap" tone="violet">
        <div className="rounded-2xl border border-pv-violet/30 bg-gradient-to-br from-pv-violet/10 to-pv-cyan/5 p-5 text-sm leading-relaxed text-pv-text">
          The Server&apos;s programs listen on ports; the Laptop connects from its own port. <b>SYN</b>, <b>SYN-ACK</b>, <b>ACK</b> give both endpoints state — R1 keeps none. Every byte is numbered; ACKs name the next byte expected, so a lost segment is noticed and resent. <b>FIN</b> closes; <b>RST</b> refuses; silence times out. <b>UDP</b> just sends datagrams and lets the application cope. And when something fails, the endpoints&apos; states and captures at each point show where.
        </div>
      </GuideSection>
    </>
  );
}
