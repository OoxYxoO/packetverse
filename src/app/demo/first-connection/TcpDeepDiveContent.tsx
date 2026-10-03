"use client";

import type { ReactNode } from "react";
import { Callout, ChecklistCard, CompareCards, DArrow, DIAGRAM as D, DNode, DPill, DiagramFrame, DiagramSvg, FailureSignatures, FieldTable, FlowSteps, GuideSection, Misconceptions, Mono, PacketAnatomy, StateTransition, TroubleshootingFlow } from "@/components/lesson/GuideBlocks";
import { ExplainIt, KnowledgeCheck, KnowledgeQuiz, PracticeBridge, type KnowledgeQuestion } from "@/components/lesson/GuideInteractive";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { ADDR } from "@/lib/sim-engine/scenarios/firstConnection";
import { TCP_LAB_CONNS, TCP_LAB_PAYLOADS, createTcpLabState, flagText, tcbFor, tcpLabPacket, type TcpCaptureRecord, type TcpConnId, type TcpLabAction, type TcpLabState } from "@/lib/sim-engine/scenarios/tcpLab";
import { tcpLabDryRun } from "./tcp-lab/TcpLabBoard";

/**
 * TCP DEEP DIVE — the complete TCP lesson, taught on THIS lesson's connection: Laptop 192.168.10.10:51001 →
 * Server 10.20.20.20:443 across SW1 and R1, ISNs 100 / 300. Every number, table and segment below is produced by
 * running the TCP Lab's own model, so the guide, the guided lesson and the lab cannot drift apart.
 * Topics the lab does not simulate are kept in "Beyond this lesson" and never shown with lesson values.
 */

const G = { foundation: "Foundation", segment: "The segment", handshake: "The handshake", data: "Data and reliability", refusal: "Refusal vs loss", trouble: "Troubleshooting", master: "Master it", beyond: "Beyond this lesson" };

export const TCP_DEEP_DIVE_SECTIONS: LessonGuideSectionLink[] = [
  { id: "td-why", label: "Why TCP exists", group: G.foundation },
  { id: "td-ip", label: "What IP gives TCP — and doesn't", group: G.foundation },
  { id: "td-stream", label: "A reliable ordered byte stream", group: G.foundation },
  { id: "td-sockets", label: "Endpoints and sockets", group: G.foundation },
  { id: "td-ports", label: "Source and destination ports", group: G.foundation },
  { id: "td-tuple", label: "Connection identity", group: G.foundation },
  { id: "td-roles", label: "Client vs server", group: G.foundation },
  { id: "td-header", label: "TCP header anatomy", group: G.segment },
  { id: "td-flags", label: "Flags", group: G.segment },
  { id: "td-seq", label: "What a sequence number means", group: G.segment },
  { id: "td-ack", label: "What an ACK number means", group: G.segment },
  { id: "td-synseq", label: "Why SYN consumes a sequence number", group: G.segment },
  { id: "td-isn", label: "Initial sequence numbers", group: G.segment },
  { id: "td-3way", label: "The three-way handshake", group: G.handshake },
  { id: "td-client", label: "Client state transitions", group: G.handshake },
  { id: "td-server", label: "Server state transitions", group: G.handshake },
  { id: "td-real", label: "This handshake, segment by segment", group: G.handshake },
  { id: "td-est", label: "ESTABLISHED", group: G.handshake },
  { id: "td-data", label: "Application data", group: G.data },
  { id: "td-seqadv", label: "Sequence advances by bytes", group: G.data },
  { id: "td-ackadv", label: "ACK advancement", group: G.data },
  { id: "td-loss", label: "Loss and retransmission", group: G.data },
  { id: "td-reliable", label: "Where reliability comes from", group: G.data },
  { id: "td-rst", label: "RST: a refused port", group: G.refusal },
  { id: "td-dropvsrst", label: "Drop vs timeout vs refusal", group: G.refusal },
  { id: "td-workflow", label: "Troubleshooting workflow", group: G.trouble },
  { id: "td-signatures", label: "Failure signatures and captures", group: G.trouble },
  { id: "td-incident", label: "The return-path incident", group: G.trouble },
  { id: "td-myths", label: "Common misconceptions", group: G.master },
  { id: "td-quiz", label: "Knowledge check", group: G.master },
  { id: "td-explain", label: "Can you explain it?", group: G.master },
  { id: "td-practice", label: "Practise in the TCP Lab", group: G.master },
  { id: "td-beyond", label: "MSS, window, congestion, UDP, HTTPS, close", group: G.beyond },
];

// ------------------------------------------------------------------ one source of truth: the TCP Lab model

const M = TCP_LAB_CONNS.main;
const R = TCP_LAB_CONNS.refused;
const I = TCP_LAB_CONNS.incident;
const HELLO = TCP_LAB_PAYLOADS.first;
const WORLD = TCP_LAB_PAYLOADS.second;
const play = (s: TcpLabState, actions: TcpLabAction[]) => actions.reduce(tcpLabDryRun, s);
const deliver: TcpLabAction = { type: "deliver" };
const LAB_SYN = play(createTcpLabState(), [{ type: "connect", conn: "main" }]);
const LAB_SYNACK = play(LAB_SYN, [deliver]);
const LAB_EST = play(LAB_SYNACK, [deliver]);
const LAB_DATA = play(LAB_EST, [{ type: "send-data", conn: "main", payload: HELLO }, deliver]);
const LAB_LOST = play(LAB_DATA, [{ type: "send-data", conn: "main", payload: WORLD, dropAtR1: true }]);
const LAB_RECOVERED = play(LAB_LOST, [{ type: "timer", host: "client", conn: "main" }, deliver]);
const LAB_REFUSED = play(LAB_RECOVERED, [{ type: "connect", conn: "refused" }, deliver]);
const LAB_INCIDENT = play(LAB_REFUSED, [{ type: "fault" }, { type: "connect", conn: "incident" }, deliver, { type: "timer", host: "server", conn: "incident" }]);
const LAB_FIXED = play(LAB_INCIDENT, [{ type: "repair" }, { type: "timer", host: "server", conn: "incident" }, deliver, { type: "send-data", conn: "incident", payload: HELLO }, deliver]);

const recsOf = (s: TcpLabState, conn: TcpConnId) => s.capture.filter((r) => r.conn === conn);
const SYN = LAB_EST.capture[0];
const SYNACK = LAB_EST.capture[1];
const ACK3 = LAB_EST.capture[2];
const Strong = ({ children }: { children: ReactNode }) => <b className="text-pv-text">{children}</b>;
const segText = (r: TcpCaptureRecord) => `${flagText(r.seg.flags)} seq=${r.seg.seq}${r.seg.ack !== undefined ? ` ack=${r.seg.ack}` : ""}${r.seg.payload ? ` len=${r.seg.payload.length}` : ""}`;

/** Capture rows for one connection at a lab state (the same rows the lab's Capture "All" view shows). */
const captureRows = (s: TcpLabState, conn: TcpConnId) =>
  recsOf(s, conn).map((r) => [String(r.no), r.dir === "c2s" ? "Laptop → Server" : "Server → Laptop", <Mono key="f">{flagText(r.seg.flags)}</Mono>, String(r.seg.seq), r.seg.ack !== undefined ? String(r.seg.ack) : "—", String(r.seg.payload.length), `${r.outcome === "dropped" ? "dropped at R1" : "delivered"}${r.retransmission ? " · retransmission" : ""}`]);
const CAP_COLS = ["No.", "Direction", "Flags", "Seq", "Ack", "Len", "Outcome"];

/** Both endpoints' states for a connection at a lab state. */
const states = (s: TcpLabState, conn: TcpConnId) => {
  const c = tcbFor(s, "client", conn);
  const v = tcbFor(s, "server", conn);
  return { client: c ? (c.error === "refused" ? "CLOSED (refused)" : c.state) : "—", server: v ? v.state : conn === "refused" ? "no connection (nothing listens)" : "LISTEN" };
};

function LabBridge({ label, onOpenLab, children }: { label: string; onOpenLab?: () => void; children: ReactNode }) {
  return (
    <PracticeBridge label={label} onPractice={onOpenLab}>
      {children}
    </PracticeBridge>
  );
}

// ------------------------------------------------------------------ diagrams (TCP-specific, real values)

function SocketDiagram() {
  return (
    <DiagramSvg h={150} label={`A TCP connection is identified by protocol plus both IP addresses and both ports: ${ADDR.laptop.ip}:${M.clientPort} and ${ADDR.server.ip}:${M.serverPort}`}>
      <DNode x={120} y={70} label="Laptop (client)" sub={`${ADDR.laptop.ip} : ${M.clientPort}`} w={190} />
      <DNode x={520} y={70} label="Server" sub={`${ADDR.server.ip} : ${M.serverPort}`} accent={D.tcp} w={190} />
      <DArrow x1={217} y1={70} x2={423} y2={70} color={D.tcp} both label="one connection" />
      <text x={320} y={125} textAnchor="middle" fill={D.muted} fontSize={10.5} fontFamily="monospace">
        {`{TCP, ${ADDR.laptop.ip}, ${M.clientPort}, ${ADDR.server.ip}, ${M.serverPort}}`}
      </text>
    </DiagramSvg>
  );
}

function HandshakeDiagram() {
  return (
    <DiagramSvg h={260} label={`SYN seq=${SYN.seg.seq}, SYN-ACK seq=${SYNACK.seg.seq} ack=${SYNACK.seg.ack}, ACK seq=${ACK3.seg.seq} ack=${ACK3.seg.ack}, with the state of each endpoint at the moment it changes`}>
      <text x={110} y={22} textAnchor="middle" fill={D.text} fontSize={12} fontWeight={600}>
        Laptop :{M.clientPort}
      </text>
      <text x={530} y={22} textAnchor="middle" fill={D.text} fontSize={12} fontWeight={600}>
        Server :{M.serverPort}
      </text>
      <line x1={110} y1={32} x2={110} y2={250} stroke={D.line} strokeDasharray="3 4" />
      <line x1={530} y1={32} x2={530} y2={250} stroke={D.line} strokeDasharray="3 4" />
      <DPill x={46} y={46} text="SYN-SENT" color={D.tcp} w={84} />
      <DPill x={594} y={46} text="LISTEN" color={D.faint} w={84} />
      <DArrow x1={112} y1={58} x2={526} y2={86} color={D.tcp} label={`SYN  seq=${SYN.seg.seq}`} labelDy={-12} />
      <DPill x={594} y={100} text="SYN-RECEIVED" color={D.tcp} w={100} />
      <DArrow x1={528} y1={112} x2={114} y2={140} color={D.tcp} label={`SYN-ACK  seq=${SYNACK.seg.seq}  ack=${SYNACK.seg.ack}`} labelDy={-12} />
      <DPill x={52} y={158} text="ESTABLISHED" color={D.success} w={96} />
      <DArrow x1={112} y1={170} x2={526} y2={198} color={D.tcp} label={`ACK  seq=${ACK3.seg.seq}  ack=${ACK3.seg.ack}`} labelDy={-12} />
      <DPill x={588} y={216} text="ESTABLISHED" color={D.success} w={96} />
      <text x={320} y={248} textAnchor="middle" fill={D.muted} fontSize={10}>
        each endpoint changes state when it processes a segment — the Laptop is ESTABLISHED first
      </text>
    </DiagramSvg>
  );
}

function SeqSpaceDiagram() {
  const c = tcbFor(LAB_RECOVERED, "client", "main")!;
  const bytes = [...HELLO, ...WORLD];
  const cells = [{ n: M.clientIsn, t: "SYN" }, ...bytes.map((ch, i) => ({ n: M.clientIsn + 1 + i, t: ch }))];
  return (
    <DiagramSvg h={170} label={`Laptop to Server sequence space: ${M.clientIsn} is the SYN, bytes ${M.clientIsn + 1} to ${c.sndNxt! - 1} carry ${HELLO}${WORLD}, next is ${c.sndNxt}`}>
      <text x={20} y={22} fill={D.muted} fontSize={10}>
        Laptop → Server sequence space (one number per byte; the SYN takes one)
      </text>
      {cells.map((x, i) => (
        <g key={x.n}>
          <rect x={20 + i * 52} y={40} width={48} height={44} rx={6} fill={i === 0 ? D.tcp : D.box} fillOpacity={i === 0 ? 0.18 : 1} stroke={i === 0 ? D.tcp : i <= HELLO.length ? D.success : D.warning} />
          <text x={44 + i * 52} y={58} textAnchor="middle" fill={D.muted} fontSize={9} fontFamily="monospace">
            {x.n}
          </text>
          <text x={44 + i * 52} y={76} textAnchor="middle" fill={i === 0 ? D.tcp : D.text} fontSize={i === 0 ? 9.5 : 12} fontWeight={700} fontFamily="monospace">
            {x.t}
          </text>
        </g>
      ))}
      <text x={20} y={112} fill={D.success} fontSize={10.5} fontWeight={700}>
        {`“${HELLO}” = ${M.clientIsn + 1}–${M.clientIsn + HELLO.length}  → ACK ${M.clientIsn + 1 + HELLO.length}`}
      </text>
      <text x={20} y={132} fill={D.warning} fontSize={10.5} fontWeight={700}>
        {`“${WORLD}” = ${M.clientIsn + 1 + HELLO.length}–${M.clientIsn + HELLO.length + WORLD.length}  → ACK ${c.sndUna}`}
      </text>
      <text x={20} y={154} fill={D.muted} fontSize={10}>
        {`ACK = the next byte expected. After both: SND.UNA = SND.NXT = ${c.sndNxt}.`}
      </text>
    </DiagramSvg>
  );
}

function LossDiagram() {
  const [lost, rtx, ack] = recsOf(LAB_RECOVERED, "main").slice(-3);
  return (
    <DiagramSvg h={210} label={`Segment seq ${lost.seg.seq} is lost at R1, no acknowledgment arrives, the Laptop retransmits the same seq ${rtx.seg.seq}, the Server acknowledges ${ack.seg.ack}`}>
      <text x={110} y={18} textAnchor="middle" fill={D.text} fontSize={11} fontWeight={600}>
        Laptop
      </text>
      <text x={320} y={18} textAnchor="middle" fill={D.text} fontSize={11} fontWeight={600}>
        R1
      </text>
      <text x={530} y={18} textAnchor="middle" fill={D.text} fontSize={11} fontWeight={600}>
        Server
      </text>
      {[110, 320, 530].map((x) => (
        <line key={x} x1={x} y1={26} x2={x} y2={200} stroke={D.line} strokeDasharray="3 4" />
      ))}
      <DArrow x1={112} y1={44} x2={316} y2={62} color={D.danger} label={segText(lost)} labelDy={-8} />
      <text x={330} y={68} fill={D.danger} fontSize={13} fontWeight={700}>
        ✕ lost
      </text>
      <text x={330} y={90} fill={D.muted} fontSize={10}>
        {`Server never sees it: RCV.NXT stays ${lost.seg.seq}, no ACK`}
      </text>
      <text x={20} y={118} fill={D.warning} fontSize={10}>
        retransmission timer expires
      </text>
      <DArrow x1={112} y1={130} x2={526} y2={150} color={D.warning} label={`${segText(rtx)} (same bytes)`} labelDy={-8} />
      <DArrow x1={528} y1={170} x2={114} y2={190} color={D.tcp} label={segText(ack)} labelDy={-8} />
    </DiagramSvg>
  );
}

// ------------------------------------------------------------------ knowledge checks

const QUIZ: KnowledgeQuestion[] = [
  { id: "q1", prompt: `The Laptop's SYN carries seq ${M.clientIsn}. What ACK does the Server send back?`, options: [{ id: "a", label: String(M.clientIsn + 1) }, { id: "b", label: String(M.clientIsn) }, { id: "c", label: "1" }], correctId: "a", explanation: `The SYN occupies sequence number ${M.clientIsn}; ACK is the next byte expected, ${M.clientIsn + 1}.` },
  { id: "q2", prompt: "Which endpoint reaches ESTABLISHED first?", options: [{ id: "a", label: "The Laptop — when it processes the SYN-ACK" }, { id: "b", label: "Both at once, after the third packet" }, { id: "c", label: "The Server — when it sends the SYN-ACK" }], correctId: "a", explanation: "The Laptop's SYN is acknowledged by the SYN-ACK. The Server's SYN is acknowledged only by the Laptop's ACK, so the Server moves later." },
  { id: "q3", prompt: `The Laptop sends ${HELLO.length} bytes starting at seq ${M.clientIsn + 1}. What will the Server's ACK be?`, options: [{ id: "a", label: String(M.clientIsn + 1 + HELLO.length) }, { id: "b", label: String(M.clientIsn + 2) }, { id: "c", label: String(M.clientIsn + HELLO.length) }], correctId: "a", explanation: `${M.clientIsn + 1} + ${HELLO.length} = ${M.clientIsn + 1 + HELLO.length}: sequence numbers count bytes, and the ACK names the next one expected.` },
  { id: "q4", prompt: `A data segment seq ${M.clientIsn + 1 + HELLO.length} is lost. What does the Server's RCV.NXT do?`, options: [{ id: "a", label: `Stays ${M.clientIsn + 1 + HELLO.length}` }, { id: "b", label: "Advances anyway" }, { id: "c", label: "Resets to 0" }], correctId: "a", explanation: "A receiver changes only for segments it actually receives." },
  { id: "q5", prompt: "The retransmission of lost data carries…", options: [{ id: "a", label: "The same sequence number and the same bytes" }, { id: "b", label: "A new, higher sequence number" }, { id: "c", label: "Sequence number 0" }], correctId: "a", explanation: "It is the oldest unacknowledged data, resent from the sender's retransmission queue. SND.NXT does not move." },
  { id: "q6", prompt: `A SYN to port ${R.serverPort} gets an immediate RST,ACK. What does that tell you?`, options: [{ id: "a", label: "The host is reachable but nothing listens on that port" }, { id: "b", label: "The SYN was lost on the way" }, { id: "c", label: "The server application is overloaded" }], correctId: "a", explanation: "Only a reachable host's TCP can answer. Loss produces silence and retries, never a reset." },
  { id: "q7", prompt: "The Laptop stays SYN-SENT; the Server shows SYN-RECEIVED. Most likely?", options: [{ id: "a", label: "The SYN-ACK is lost on the way back" }, { id: "b", label: "The port is closed" }, { id: "c", label: "The Laptop computed the wrong ACK" }], correctId: "a", explanation: "The Server got the SYN and answered. A closed port would answer RST and create no connection; the Laptop never got a SYN-ACK to compute any ACK from." },
  { id: "q8", prompt: "Which device in this lesson keeps TCP connection state?", options: [{ id: "a", label: "Only the Laptop and the Server" }, { id: "b", label: "R1 and SW1 too" }, { id: "c", label: "Only R1" }], correctId: "a", explanation: "TCP is end to end. SW1 forwards frames; R1 routes packets and decrements the TTL; neither reads ports or sequence numbers." },
];

// ------------------------------------------------------------------ content

export function TcpDeepDiveContent({ onOpenLab }: { onOpenLab?: () => void }) {
  const synPkt = tcpLabPacket(SYN, 0);
  const tcpFields = synPkt.layers.find((l) => l.name === "TCP")!.fields;
  const val = (label: string) => tcpFields.find((f) => f.label === label)?.value ?? "";
  const est = states(LAB_EST, "main");
  const inc = states(LAB_INCIDENT, "incident");
  const fixed = states(LAB_FIXED, "incident");

  return (
    <div className="space-y-12">
      {/* ------------------------------------------------------------ Foundation */}
      <GuideSection id="td-why" eyebrow="Foundation" title="Why TCP exists" tone="tcp">
        <p>
          ARP, switching and routing got an IP packet from the Laptop to the Server. That is not yet a conversation. A browser needs to send a request and get every byte of the answer back <Strong>complete, in order, exactly once</Strong> — and to know when that failed. TCP turns IP&apos;s single packets into that: a <Strong>reliable, ordered byte stream</Strong> between two applications.
        </p>
      </GuideSection>

      <GuideSection id="td-ip" eyebrow="Foundation" title="What IP gives TCP — and what it doesn't" tone="ip">
        <CompareCards
          items={[
            { title: "IP gives", tone: "ip", tag: "best effort", points: ["Addressing: 192.168.10.10 → 10.20.20.20", "Hop-by-hop forwarding (R1 routes, TTL −1)", "Each packet on its own"] },
            { title: "IP does not give", tone: "warning", tag: "TCP's job", points: ["Any guarantee a packet arrives", "Ordering or duplicate removal", "Which application a packet is for", "Any notion of a conversation"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="td-stream" eyebrow="Foundation" title="A reliable ordered byte stream" tone="tcp">
        <p>
          The application writes bytes; TCP numbers every byte, sends them in segments, and the other side hands them to its application in order, with nothing missing or repeated. In the lab the Laptop sends “{HELLO}” and then “{WORLD}”; even though the second segment is lost once, the Server&apos;s application receives exactly <Mono>{tcbFor(LAB_RECOVERED, "server", "main")!.delivered}</Mono>.
        </p>
        <Callout tone="tcp" title="A stream, not messages">TCP keeps no message boundaries. The receiver gets bytes in order; how they were split into segments is invisible to it.</Callout>
      </GuideSection>

      <GuideSection id="td-sockets" eyebrow="Foundation" title="Endpoints and sockets" tone="cyan">
        <p>
          TCP lives only in the two <Strong>endpoints</Strong>. Each keeps its own record of every connection (state, sequence numbers, unacknowledged data). Before anything is sent, the Server has a <Strong>listening socket</Strong> on <Mono>*:{M.serverPort}</Mono> — a promise to accept connections, not a connection. SW1 and R1 never hold TCP state.
        </p>
      </GuideSection>

      <GuideSection id="td-ports" eyebrow="Foundation" title="Source and destination ports" tone="cyan">
        <FieldTable
          title="This lesson's ports"
          columns={["Port", "Where", "Meaning"]}
          rows={[
            [<Mono key="p">{M.serverPort}</Mono>, "Server", "well-known HTTPS port: where the Server listens"],
            [<Mono key="p">{M.clientPort}</Mono>, "Laptop", "ephemeral port picked by the Laptop's OS for this one connection"],
          ]}
        />
        <p>Ports are fields of the TCP header (the transport layer), not of IP. IP gets the packet to the host; the destination port tells the host&apos;s TCP which socket it is for.</p>
      </GuideSection>

      <GuideSection id="td-tuple" eyebrow="Foundation" title="Connection identity" tone="cyan">
        <DiagramFrame caption="Protocol + both addresses + both ports identify one connection.">
          <SocketDiagram />
        </DiagramFrame>
        <p>
          In the lab the Laptop opens three connections from <Mono>{M.clientPort}</Mono>, <Mono>{R.clientPort}</Mono> and <Mono>{I.clientPort}</Mono>. Two of them go to the same <Mono>10.20.20.20:{M.serverPort}</Mono>, yet the Server keeps them apart by the Laptop&apos;s port — and each has its own sequence numbers. One sequence number never identifies a connection.
        </p>
      </GuideSection>

      <GuideSection id="td-roles" eyebrow="Foundation" title="Client vs server" tone="cyan">
        <CompareCards
          items={[
            { title: "Laptop — client", tone: "cyan", tag: "active open", points: ["Picks an ephemeral port", "Sends the first SYN", "CLOSED → SYN-SENT → ESTABLISHED"] },
            { title: "Server — server", tone: "tcp", tag: "passive open", points: [`Listens on ${M.serverPort}`, "Answers a SYN with SYN-ACK", "LISTEN → SYN-RECEIVED → ESTABLISHED"] },
          ]}
        />
      </GuideSection>

      {/* ------------------------------------------------------------ The segment */}
      <GuideSection id="td-header" eyebrow="The segment" title="TCP header anatomy" tone="tcp">
        <PacketAnatomy
          title={`The Laptop's SYN, as it leaves the Laptop (values from the lab)`}
          layers={[
            { name: "Ethernet II", tone: "ethernet", note: "this link only — R1 rewrites it", fields: [{ name: "Destination MAC", value: ADDR.gateway.mac, why: "R1, the default gateway — not the Server." }] },
            { name: "IPv4", tone: "ip", note: "end to end (TTL −1 at R1)", fields: [{ name: "Source → Destination", value: `${ADDR.laptop.ip} → ${ADDR.server.ip}`, why: "Gets the segment to the Server's host." }] },
            {
              name: "TCP",
              tone: "tcp",
              note: "read only by the Server",
              fields: [
                { name: "Source port", value: val("Source Port"), why: "The Laptop's ephemeral port.", key: true },
                { name: "Destination port", value: val("Destination Port"), why: "The Server's listening HTTPS port.", key: true },
                { name: "Sequence number", value: val("Sequence"), why: "The Laptop's ISN; the SYN occupies this number.", key: true },
                { name: "Acknowledgment number", value: val("Acknowledgment"), why: "Meaningful only when the ACK flag is set." },
                { name: "Header length", value: val("Header Length"), why: "Real SYNs usually add options (MSS, window scale…); this lesson does not simulate options." },
                { name: "Flags", value: val("Flags"), why: "SYN: synchronise sequence numbers." },
              ],
            },
          ]}
        />
        <Callout tone="cyan" title="Also in every real TCP header">
          A <Strong>window</Strong> (receive buffer space), a <Strong>checksum</Strong> (verified by the receiver) and an <Strong>urgent pointer</Strong>. They exist, but this lesson does not simulate them, so it shows no values for them.
        </Callout>
      </GuideSection>

      <GuideSection id="td-flags" eyebrow="The segment" title="Flags" tone="tcp">
        <FieldTable
          title="Flags you will see in this lesson"
          columns={["Flag", "Meaning", "Seen in"]}
          rows={[
            [<Mono key="f">SYN</Mono>, "synchronise: this segment carries my ISN", "SYN, SYN-ACK"],
            [<Mono key="f">ACK</Mono>, "the Acknowledgment field is valid", "every segment after the first SYN"],
            [<Mono key="f">PSH</Mono>, "push the data to the application", `the “${HELLO}” and “${WORLD}” data segments`],
            [<Mono key="f">RST</Mono>, "reset: abort / refuse", `the reply from port ${R.serverPort}`],
          ]}
        />
      </GuideSection>

      <GuideSection id="td-seq" eyebrow="The segment" title="What a sequence number means" tone="ip">
        <KnowledgeCheck question={{ id: "p-seq", prompt: `Before reading on: the Laptop's next data segment carries 5 bytes starting at seq ${M.clientIsn + 1}. What seq does the segment after it carry?`, options: [{ id: "a", label: String(M.clientIsn + 6) }, { id: "b", label: String(M.clientIsn + 2) }], correctId: "a", explanation: "Sequence numbers count bytes: 5 bytes later, not one segment later." }} />
        <p>
          A sequence number is the <Strong>position of a segment&apos;s first byte</Strong> in that direction&apos;s byte stream. It is not a packet counter: a 5-byte segment moves the next sequence number by 5; a pure ACK (no bytes) moves it by 0.
        </p>
        <DiagramFrame caption="The Laptop → Server stream in this lesson, built by the lab's model.">
          <SeqSpaceDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="td-ack" eyebrow="The segment" title="What an ACK number means" tone="ip">
        <p>
          The acknowledgment number is the <Strong>next byte the sender of the ACK expects</Strong>. “ACK {M.clientIsn + 1 + HELLO.length}” means “I have every byte up to {M.clientIsn + HELLO.length}; send {M.clientIsn + 1 + HELLO.length} next”. It is neither the last byte received nor a packet number. ACKs are cumulative: one ACK covers everything before it.
        </p>
      </GuideSection>

      <GuideSection id="td-synseq" eyebrow="The segment" title="Why SYN consumes a sequence number" tone="ip">
        <p>
          A SYN carries no data, yet it occupies one sequence number. That gives the SYN itself something to be acknowledged: the Server&apos;s <Mono>ack={SYNACK.seg.ack}</Mono> proves it received the SYN with seq {M.clientIsn}. So the Laptop&apos;s first data byte is {M.clientIsn + 1}, not {M.clientIsn}. (FIN works the same way — beyond this lesson.)
        </p>
      </GuideSection>

      <GuideSection id="td-isn" eyebrow="The segment" title="Initial sequence numbers" tone="ip">
        <p>
          Each side chooses its own ISN for each connection: here the Laptop {M.clientIsn} and the Server {M.serverIsn}. Real stacks choose them unpredictably from the 32-bit space (to resist spoofing and confusion with old connections); the lesson uses small readable values, and the lab uses others ({R.clientIsn}, {I.clientIsn}/{I.serverIsn}) for its other connections.
        </p>
      </GuideSection>

      {/* ------------------------------------------------------------ The handshake */}
      <GuideSection id="td-3way" eyebrow="The handshake" title="The three-way handshake" tone="tcp">
        <DiagramFrame caption="Real values from this lesson; each state appears at the moment that endpoint changes.">
          <HandshakeDiagram />
        </DiagramFrame>
        <FlowSteps
          steps={[
            { title: "SYN", body: `Laptop: “my ISN is ${M.clientIsn}”.`, tone: "tcp" },
            { title: "SYN-ACK", body: `Server: “I have ${M.clientIsn}, send ${M.clientIsn + 1} next — and my ISN is ${M.serverIsn}”.`, tone: "tcp" },
            { title: "ACK", body: `Laptop: “I have ${M.serverIsn}, send ${M.serverIsn + 1} next”.`, tone: "success" },
          ]}
        />
        <p>Three segments, because each side must announce its ISN and have it acknowledged — the middle segment does two jobs at once. It synchronises state; it is not a security check.</p>
      </GuideSection>

      <GuideSection id="td-client" eyebrow="The handshake" title="Client state transitions" tone="tcp">
        <StateTransition
          states={[
            { label: "CLOSED", detail: "no connection", tone: "cyan" },
            { label: "SYN-SENT", detail: `sent SYN seq=${M.clientIsn}`, tone: "tcp" },
            { label: "ESTABLISHED", detail: `processed SYN-ACK ack=${M.clientIsn + 1}, sent ACK`, tone: "success" },
          ]}
        />
      </GuideSection>

      <GuideSection id="td-server" eyebrow="The handshake" title="Server state transitions" tone="tcp">
        <StateTransition
          states={[
            { label: "LISTEN", detail: `socket on *:${M.serverPort}`, tone: "cyan" },
            { label: "SYN-RECEIVED", detail: `received SYN, sent SYN-ACK seq=${M.serverIsn}`, tone: "tcp" },
            { label: "ESTABLISHED", detail: `received ACK ack=${M.serverIsn + 1}`, tone: "success" },
          ]}
        />
      </GuideSection>

      <GuideSection id="td-real" eyebrow="The handshake" title="This handshake, segment by segment" tone="tcp">
        <FieldTable
          title="After each segment is processed (from the lab's model)"
          columns={["Segment", "Laptop", "Server"]}
          rows={[
            [segText(SYN), states(LAB_SYN, "main").client, states(LAB_SYN, "main").server],
            [segText(SYNACK), states(LAB_SYNACK, "main").client, states(LAB_SYNACK, "main").server],
            [segText(ACK3), est.client, est.server],
          ]}
        />
        <LabBridge label="Practise this in the TCP Lab" onOpenLab={onOpenLab}>
          Predict every flag, seq and ack before it is sent, and watch both endpoints&apos; states change.
        </LabBridge>
      </GuideSection>

      <GuideSection id="td-est" eyebrow="The handshake" title="ESTABLISHED" tone="success">
        <p>
          ESTABLISHED means: <Strong>this endpoint</Strong> knows the peer&apos;s ISN and has had its own SYN acknowledged, so it can number and acknowledge bytes. It says nothing about the application: a web server can be ESTABLISHED and still fail every request.
        </p>
      </GuideSection>

      {/* ------------------------------------------------------------ Data and reliability */}
      <GuideSection id="td-data" eyebrow="Data" title="Application data" tone="tcp">
        <p>
          With the connection ESTABLISHED the Laptop sends <Mono>“{HELLO}”</Mono> ({HELLO.length} bytes of lab data — a real HTTPS client would start with a TLS ClientHello). The segment carries <Mono>{segText(recsOf(LAB_DATA, "main")[3])}</Mono>: its ACK field still says {M.serverIsn + 1}, because the Server has sent no bytes yet.
        </p>
      </GuideSection>

      <GuideSection id="td-seqadv" eyebrow="Data" title="Sequence advances by bytes" tone="ip">
        <p>
          Sending {HELLO.length} bytes moves the Laptop&apos;s SND.NXT from {M.clientIsn + 1} to {M.clientIsn + 1 + HELLO.length}. Every TCP segment does not add one: a pure ACK adds zero, a SYN adds one, data adds its length.
        </p>
      </GuideSection>

      <GuideSection id="td-ackadv" eyebrow="Data" title="ACK advancement" tone="ip">
        <FieldTable title="The data exchange (from the lab's model)" columns={CAP_COLS} rows={captureRows(LAB_DATA, "main").slice(3)} />
        <p>The Server&apos;s RCV.NXT became {M.clientIsn + 1 + HELLO.length} and its ACK says exactly that. When it arrives, the Laptop&apos;s SND.UNA catches up with SND.NXT: nothing it sent is unacknowledged.</p>
      </GuideSection>

      <GuideSection id="td-loss" eyebrow="Reliability" title="Loss and retransmission" tone="warning">
        <DiagramFrame caption="The lab drops the segment at R1; the Laptop's own state recovers it.">
          <LossDiagram />
        </DiagramFrame>
        <FieldTable title="Captured (from the lab's model)" columns={CAP_COLS} rows={captureRows(LAB_RECOVERED, "main").slice(5)} />
        <p>
          The retransmission carries the <Strong>same sequence number and the same bytes</Strong>; the Server&apos;s RCV.NXT advances once, to {tcbFor(LAB_RECOVERED, "server", "main")!.rcvNxt}. In real stacks the retransmission timer is computed from measured round-trip times and backs off after each try; the lab makes it a button, so no value here is a TCP constant.
        </p>
        <LabBridge label="Lose and recover a segment in the TCP Lab" onOpenLab={onOpenLab}>
          Drop “{WORLD}” at R1, check the Server&apos;s state didn&apos;t move, then fire the retransmission timer.
        </LabBridge>
      </GuideSection>

      <GuideSection id="td-reliable" eyebrow="Reliability" title="Where reliability comes from" tone="warning">
        <ChecklistCard tone="warning" mark="•" title="TCP reliability = state at both ends" items={["The sender keeps every unacknowledged byte (its retransmission queue)", "The receiver acknowledges the next byte it expects", "Missing acknowledgment → the sender resends the same bytes", "Ethernet, the switch and the router resend nothing"]} />
      </GuideSection>

      {/* ------------------------------------------------------------ Refusal vs loss */}
      <GuideSection id="td-rst" eyebrow="Refusal" title="RST: a refused port" tone="danger">
        <FieldTable title={`Laptop :${R.clientPort} → Server :${R.serverPort} (from the lab's model)`} columns={CAP_COLS} rows={captureRows(LAB_REFUSED, "refused")} />
        <p>
          Nothing listens on {R.serverPort}, but the Server is up and reachable. Its TCP stack answers the SYN with <Mono>RST,ACK seq=0 ack={R.clientIsn + 1}</Mono> — the ACK acknowledges exactly the refused SYN — and creates no connection. The Laptop closes the attempt immediately: “connection refused”. The reset comes from the Server&apos;s TCP, not from an application.
        </p>
      </GuideSection>

      <GuideSection id="td-dropvsrst" eyebrow="Refusal" title="Drop vs timeout vs refusal" tone="danger">
        <FieldTable
          title="Three different failures"
          columns={["What happened", "What the client sees", "In this lesson"]}
          rows={[
            ["A segment is dropped on the path", "silence → retransmissions; eventually a timeout", `“${WORLD}” lost at R1; the SYN-ACKs in the incident`],
            ["The port is closed on a reachable host", "an immediate RST — no retries", `SYN to :${R.serverPort}`],
            ["The application fails after ESTABLISHED", "the connection works; requests fail or hang above TCP", "not simulated — TCP state alone can't show it"],
          ]}
        />
        <Callout tone="danger" title="Keep them apart">A timeout is not “connection refused”. A RST is not a timeout. ESTABLISHED is not “the application is healthy”.</Callout>
      </GuideSection>

      {/* ------------------------------------------------------------ Troubleshooting */}
      <GuideSection id="td-workflow" eyebrow="Troubleshooting" title="Troubleshooting workflow" tone="danger">
        <TroubleshootingFlow
          steps={[
            { question: "Symptom — what exactly fails?", look: "The site never loads: no error, no reset." },
            { question: "Observation — how far does the conversation get?", look: "Reproduce one connection attempt and watch it." },
            { question: "Evidence — what does each endpoint and each capture point say?", look: "Socket states at both ends · captures at the Laptop, R1 (both sides) and the Server." },
            { question: "Hypothesis — one cause that fits ALL the evidence", look: "Closed port? Dead application? Lost SYN? Lost reply? Bad ACK arithmetic?" },
            { question: "Test — the observation that proves it, including where", look: "Find the last capture point that saw the segment." },
            { question: "Root cause, repair", look: "Fix that spot — nothing else." },
            { question: "Verify — with traffic", look: "SYN-ACK delivered, both ESTABLISHED, data acknowledged." },
          ]}
        />
      </GuideSection>

      <GuideSection id="td-signatures" eyebrow="Troubleshooting" title="Failure signatures and reading captures" tone="danger">
        <FailureSignatures
          items={[
            { tag: "A", title: "SYN out, nothing back", tone: "danger", points: ["Client SYN-SENT, retransmitting", "Check the server: did it get the SYN?", "→ forward-path loss, or a lost reply"] },
            { tag: "B", title: "Server SYN-RECEIVED, client SYN-SENT", tone: "danger", points: ["The server answered; the client never processed it", "→ the SYN-ACK is lost on the way back"] },
            { tag: "C", title: "Immediate RST,ACK", tone: "warning", points: ["Reachable host, nothing listening on the port", "→ connection refused, no retries"] },
            { tag: "D", title: "Same seq sent twice", tone: "warning", points: ["A retransmission: the first copy was not acknowledged", "→ look for where the first copy stopped"] },
          ]}
        />
        <p>Reading a capture: each capture point lists only segments that crossed it. The fault lies between the last point that saw a segment and the first one that didn&apos;t.</p>
      </GuideSection>

      <GuideSection id="td-incident" eyebrow="Case study" title="The return-path incident" tone="danger">
        <FieldTable title={`Laptop :${I.clientPort} → Server :${I.serverPort}, during the fault (from the lab's model)`} columns={CAP_COLS} rows={captureRows(LAB_INCIDENT, "incident")} />
        <FieldTable
          title="Evidence"
          columns={["Where", "What it shows"]}
          rows={[
            ["Laptop socket", `${inc.client} — it never processed a SYN-ACK`],
            ["Server socket", `${inc.server} — it got the SYN and answered`],
            ["Server capture", `SYN in; SYN-ACK seq=${I.serverIsn} ack=${I.clientIsn + 1} out (and retransmitted)`],
            ["R1 capture", "SYN-ACK arrives on the Server side, never leaves on the LAN side"],
            ["Laptop capture", "no SYN-ACK, no RST"],
          ]}
        />
        <Callout tone="danger" title="Root cause">
          Return-path loss at R1: segments from the Server to the Laptop are dropped there. Not a refused port (no RST), not the application (the handshake never completed), not ACK arithmetic (no SYN-ACK ever reached the Laptop).
        </Callout>
        <p>
          After R1 is repaired, the Server&apos;s next SYN-ACK retransmission reaches the Laptop: Laptop {fixed.client}, Server {fixed.server}, and “{HELLO}” is acknowledged with {tcbFor(LAB_FIXED, "client", "incident")!.sndUna}. TCP recovered the half-open connection by itself, because both endpoints kept their state.
        </p>
        <LabBridge label="Troubleshoot it in the TCP Lab" onOpenLab={onOpenLab}>
          Reproduce the ticket, gather the evidence at every capture point, prove where the SYN-ACK stops, repair it and verify with traffic.
        </LabBridge>
      </GuideSection>

      {/* ------------------------------------------------------------ Master it */}
      <GuideSection id="td-myths" eyebrow="Master it" title="Common misconceptions" tone="warning">
        <Misconceptions
          items={[
            { myth: "ACK is the packet number I received.", correction: `ACK is the next BYTE expected: after “${HELLO}” (${M.clientIsn + 1}–${M.clientIsn + HELLO.length}) the ACK is ${M.clientIsn + 1 + HELLO.length}.` },
            { myth: "Every TCP segment increments the sequence number by 1.", correction: `Data moves it by its length (${HELLO.length} for “${HELLO}”); a pure ACK by 0; a SYN by 1.` },
            { myth: "SYN consumes no sequence space.", correction: `It takes one number: SYN seq ${M.clientIsn} → first data byte ${M.clientIsn + 1}, ACK ${M.clientIsn + 1}.` },
            { myth: "ACK means the last byte received.", correction: `It is the NEXT byte expected: ACK ${M.clientIsn + 1 + HELLO.length} means bytes up to ${M.clientIsn + HELLO.length} arrived.` },
            { myth: "TCP reliability is stateless.", correction: "It depends on state at both ends: the sender keeps unacknowledged bytes and resends them; the receiver tracks RCV.NXT." },
            { myth: "The server sends SYN-ACK without receiving a SYN.", correction: "The SYN-ACK acknowledges a SYN (ack = its seq + 1). With no SYN there is nothing to acknowledge — and no connection on the server." },
            { myth: "A timeout means the port was refused.", correction: `A refused port answers at once with RST (port ${R.serverPort}). A timeout means silence — something was lost.` },
            { myth: "RST and drop are the same.", correction: "A RST is an answer from a reachable host's TCP; a drop is no answer at all." },
            { myth: "ESTABLISHED means the application is healthy.", correction: "It only means both endpoints' TCP state is synchronised. The application above can still fail." },
            { myth: "Ports are IP-layer identifiers.", correction: `Ports are TCP header fields (${M.clientPort}, ${M.serverPort}); IP carries only addresses.` },
            { myth: "The handshake is merely a security check.", correction: "It synchronises sequence numbers and confirms both directions work. Security comes from TLS, later." },
          ]}
        />
      </GuideSection>

      <GuideSection id="td-quiz" eyebrow="Master it" title="Knowledge check" tone="success">
        <KnowledgeQuiz questions={QUIZ} />
      </GuideSection>

      <GuideSection id="td-explain" eyebrow="Master it" title="Can you explain it?" tone="success">
        <ExplainIt
          items={[
            { q: `Why is the SYN-ACK's ACK ${M.clientIsn + 1}?`, a: `The Laptop's SYN occupied sequence number ${M.clientIsn}. The ACK names the next byte the Server expects, ${M.clientIsn + 1}.` },
            { q: "Why is the Laptop ESTABLISHED before the Server?", a: "An endpoint is ESTABLISHED once it knows the peer's ISN and its own SYN has been acknowledged. The SYN-ACK does both for the Laptop; the Server's SYN is acknowledged only by the Laptop's ACK." },
            { q: "How does TCP recover a segment the network lost?", a: "The sender kept the unacknowledged bytes. No ACK arrives, its retransmission timer fires, and it resends the same sequence range. The receiver accepts it once and acknowledges the next byte." },
            { q: "How do you tell a lost SYN-ACK from a closed port?", a: "A closed port answers immediately with RST,ACK and the server creates no connection. A lost SYN-ACK leaves the client SYN-SENT and the server SYN-RECEIVED, with SYN-ACKs visible at the server's capture but not at the client's." },
          ]}
        />
      </GuideSection>

      <GuideSection id="td-practice" eyebrow="Practice" title="Practise in the TCP Lab" tone="cyan">
        <ChecklistCard
          tone="cyan"
          title="In the lab you will"
          mark="→"
          items={["Predict the flags, seq and ack of every handshake segment", "Watch the Laptop reach ESTABLISHED before the Server", `Send “${HELLO}” and calculate the ACK`, `Lose “${WORLD}” at R1 and recover it by retransmission`, `Compare a refused port (:${R.serverPort}) with a lost segment`, "Troubleshoot a failing handshake from sockets and captures, then verify the fix"]}
        />
        <LabBridge label="Open the TCP Lab" onOpenLab={onOpenLab}>
          Same network, your own copy. Nothing you do there changes your lesson progress or the ARP Lab.
        </LabBridge>
      </GuideSection>

      {/* ------------------------------------------------------------ Beyond this lesson */}
      <GuideSection id="td-beyond" eyebrow="Beyond this lesson" title="Not simulated here — but part of TCP" tone="violet">
        <p className="text-pv-text-muted">The following are real and important, but the lesson and the lab do not model them, so they are described without lesson values.</p>
        <FieldTable
          title="Beyond this lesson"
          columns={["Topic", "In short"]}
          rows={[
            ["MSS", "Each side announces in its SYN (an option) the largest segment payload it wants; on a 1500-byte Ethernet MTU typically 1460 bytes."],
            ["Window / flow control", "Every segment advertises how much more the receiver can buffer; the sender never has more than that unacknowledged."],
            ["Congestion control", "The sender also limits itself to what the network seems to carry (slow start, congestion avoidance) — inferred from loss and delay."],
            ["Orderly close (FIN)", "Each direction is closed separately with FIN, which also consumes one sequence number and must be acknowledged."],
            ["TCP vs UDP", "UDP has no connection, no sequence numbers, no retransmission; applications that need reliability over UDP build their own."],
            ["HTTPS over TCP", "Here HTTPS is HTTP over TLS over TCP port 443: TLS starts only after the handshake. HTTP/3 uses QUIC over UDP instead."],
          ]}
        />
      </GuideSection>
    </div>
  );
}
