"use client";

import type { ReactNode } from "react";
import { Callout, ChecklistCard, CompareCards, DArrow, DIAGRAM as D, DNode, DPill, DiagramFrame, DiagramSvg, FailureSignatures, FieldTable, FlowSteps, GuideSection, Misconceptions, Mono, PacketAnatomy, StateTransition, TroubleshootingFlow } from "@/components/lesson/GuideBlocks";
import { ExplainIt, KnowledgeCheck, KnowledgeQuiz, PracticeBridge, type KnowledgeQuestion } from "@/components/lesson/GuideInteractive";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { ADDR } from "@/lib/sim-engine/scenarios/firstConnection";
import { TN_HTTP, TN_TIMERS, createTcpNet, flagsText, pktName, tnApply, tnClone, tnTicket, type TnAction, type TnCap, type TnRun, type TnState, type TcpState } from "@/lib/sim-engine/scenarios/tcpNet";

/**
 * TCP DEEP DIVE — the complete TCP lesson, taught on THIS lesson's network: Laptop 192.168.10.10 → R1 → Server
 * 10.20.20.20, ISNs 100 / 300. Every number, table and segment below is produced by running the TCP/UDP Lab's own
 * model (tcpNet), so the guide and the lab cannot drift apart.
 * Topics the lab does not simulate are kept in "Beyond this lesson" and never shown with lesson values.
 */

const G = { foundation: "Foundation", segment: "The segment", handshake: "The handshake", data: "Data and reliability", refusal: "Refusal, close and UDP", trouble: "Troubleshooting", master: "Master it", beyond: "Beyond this lesson" };

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
  { id: "td-close", label: "The orderly close and TIME-WAIT", group: G.refusal },
  { id: "td-udp", label: "UDP: datagrams, no connection", group: G.refusal },
  { id: "td-dropvsrst", label: "Drop vs timeout vs refusal", group: G.refusal },
  { id: "td-workflow", label: "Troubleshooting workflow", group: G.trouble },
  { id: "td-signatures", label: "Failure signatures and captures", group: G.trouble },
  { id: "td-incident", label: "The return-path incident", group: G.trouble },
  { id: "td-myths", label: "Common misconceptions", group: G.master },
  { id: "td-quiz", label: "Knowledge check", group: G.master },
  { id: "td-explain", label: "Can you explain it?", group: G.master },
  { id: "td-practice", label: "Practice in the TCP & UDP Lab", group: G.master },
  { id: "td-beyond", label: "MSS, window, congestion, HTTPS, SACK", group: G.beyond },
];

// ------------------------------------------------------------------ one source of truth: the TCP/UDP Lab model

const play = (st: TnState, as: TnAction[]) => as.reduce(tnApply, st);
const fresh = () => createTcpNet();
/** nc -vz 10.20.20.20 443: handshake, then the orderly close. */
const HS = play(fresh(), [{ type: "nc", port: 443 }]);
/** curl http://10.20.20.20/: handshake, request, page, close. */
const WEB = play(fresh(), [{ type: "curl", port: 80 }]);
/** The same, with R1 losing the page's second segment once. */
const LOSS = play(fresh(), [{ type: "loss", dir: "s2c", what: "data", nth: 2 }, { type: "curl", port: 80 }]);
/** A port nothing listens on. */
const REF = play(fresh(), [{ type: "nc", port: 8080 }]);
/** A DNS query (UDP). */
const DNS = play(fresh(), [{ type: "dig" }]);
/** The SYN-ACK-drop ticket: reproduce, then fix R1 and test again. */
const INC = play(fresh(), [{ type: "ticket", id: "synack-drop" }, tnTicket("synack-drop").repro]);
const FIXED = (() => {
  const c = tnClone(INC.cfg);
  c.r1.acl.entries = c.r1.acl.entries.filter((e) => e.action !== "deny");
  return play(INC, [{ type: "cfg", cfg: c, text: "fix" }, tnTicket("synack-drop").repro]);
})();

const M = { clientPort: 51001, serverPort: 443, clientIsn: 100, serverIsn: 300 };
const R = { clientPort: REF.last!.events.find((e) => e.k === "state")!.local.port, serverPort: 8080, clientIsn: 100 };
const REQ = TN_HTTP.request;
const PAGE = TN_HTTP.response;
const capsOf = (st: TnState, point: TnCap["point"] = "laptop") => st.captures.filter((c) => c.n >= st.last!.capFrom && c.point === point && c.pkt.proto !== "icmp");
const [SYN, SYNACK, ACK3] = capsOf(HS);
const Strong = ({ children }: { children: ReactNode }) => <b className="text-pv-text">{children}</b>;
const segText = (c: TnCap) => (c.pkt.tcp ? `${flagsText(c.pkt.tcp.flags)} seq=${c.pkt.tcp.seq}${c.pkt.tcp.ack !== undefined ? ` ack=${c.pkt.tcp.ack}` : ""}${c.pkt.tcp.len ? ` len=${c.pkt.tcp.len}` : ""}` : pktName(c.pkt));
const t0 = (st: TnState) => st.last!.start;

/** Capture rows for the last test at one point (the same rows the lab's Capture view shows). */
const captureRows = (st: TnState, point: TnCap["point"] = "laptop") =>
  capsOf(st, point).map((c) => [((c.t - t0(st)) / 1000).toFixed(3), c.pkt.dst === "10.20.20.20" ? "Laptop → Server" : "Server → Laptop", <Mono key="f">{c.pkt.tcp ? flagsText(c.pkt.tcp.flags) : pktName(c.pkt)}</Mono>, c.pkt.tcp ? String(c.pkt.tcp.seq) : "—", c.pkt.tcp?.ack !== undefined ? String(c.pkt.tcp.ack) : "—", String(c.pkt.tcp?.len ?? c.pkt.udp?.len ?? 0), `${c.note ? c.note : c.dir === "out" ? "sent" : "received"}${c.pkt.retx ? " · retransmission" : ""}`]);
const CAP_COLS = ["Time (s)", "Direction", "Flags", "Seq", "Ack", "Len", "Note"];

/** Both endpoints' states for a test's conversation, just after time t. */
function statesAt(run: TnRun, t: number) {
  let i = -1;
  run.events.forEach((e, k) => e.t <= t && (i = k));
  const snap = run.snaps[i];
  const c = snap?.tcbs.find((x) => x.host === "laptop" && x.run === run.id);
  const v = c ? snap.tcbs.find((x) => x.host === "server" && x.remote?.port === c.local.port) : undefined;
  return { client: (c?.state ?? "CLOSED") as TcpState, server: (v?.state ?? "LISTEN") as TcpState | "LISTEN" };
}
const arrival = (st: TnState, c: TnCap) => st.captures.find((x) => x.n >= st.last!.capFrom && x.pkt.id === c.pkt.id && x.point === (c.pkt.dst === "10.20.20.20" ? "server" : "laptop") && x.dir === "in")?.t ?? c.t;

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
    <DiagramSvg h={260} label={`SYN seq=${SYN.pkt.tcp!.seq}, SYN-ACK seq=${SYNACK.pkt.tcp!.seq} ack=${SYNACK.pkt.tcp!.ack}, ACK seq=${ACK3.pkt.tcp!.seq} ack=${ACK3.pkt.tcp!.ack}, with the state of each endpoint at the moment it changes`}>
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
      <DArrow x1={112} y1={58} x2={526} y2={86} color={D.tcp} label={`SYN  seq=${SYN.pkt.tcp!.seq}`} labelDy={-12} />
      <DPill x={594} y={100} text="SYN-RECEIVED" color={D.tcp} w={100} />
      <DArrow x1={528} y1={112} x2={114} y2={140} color={D.tcp} label={`SYN-ACK  seq=${SYNACK.pkt.tcp!.seq}  ack=${SYNACK.pkt.tcp!.ack}`} labelDy={-12} />
      <DPill x={52} y={158} text="ESTABLISHED" color={D.success} w={96} />
      <DArrow x1={112} y1={170} x2={526} y2={198} color={D.tcp} label={`ACK  seq=${ACK3.pkt.tcp!.seq}  ack=${ACK3.pkt.tcp!.ack}`} labelDy={-12} />
      <DPill x={588} y={216} text="ESTABLISHED" color={D.success} w={96} />
      <text x={320} y={248} textAnchor="middle" fill={D.muted} fontSize={10}>
        each endpoint changes state when it processes a segment — the Laptop is ESTABLISHED first
      </text>
    </DiagramSvg>
  );
}

function SeqSpaceDiagram() {
  // The Laptop → Server stream of the web fetch: the SYN (1 number), the request (78 bytes), the FIN (1 number).
  const req = capsOf(WEB).find((c) => c.dir === "out" && c.pkt.tcp!.len)!;
  const fin = capsOf(WEB).find((c) => c.dir === "out" && c.pkt.tcp!.flags.includes("FIN"))!;
  const blocks = [
    { from: M.clientIsn, to: M.clientIsn, label: "SYN", color: D.tcp },
    { from: req.pkt.tcp!.seq, to: req.pkt.tcp!.seq + REQ - 1, label: `request (${REQ} bytes)`, color: D.success },
    { from: fin.pkt.tcp!.seq, to: fin.pkt.tcp!.seq, label: "FIN", color: D.warning },
  ];
  const x = (i: number) => 20 + i * 200;
  return (
    <DiagramSvg h={150} label={`Laptop to Server sequence space: ${M.clientIsn} is the SYN, ${req.pkt.tcp!.seq} to ${req.pkt.tcp!.seq + REQ - 1} the request, ${fin.pkt.tcp!.seq} the FIN`}>
      <text x={20} y={22} fill={D.muted} fontSize={10}>
        Laptop → Server sequence space during curl (one number per byte; SYN and FIN take one each)
      </text>
      {blocks.map((b, i) => (
        <g key={b.label}>
          <rect x={x(i)} y={40} width={i === 1 ? 190 : 120} height={44} rx={6} fill={b.color} fillOpacity={0.14} stroke={b.color} />
          <text x={x(i) + (i === 1 ? 95 : 60)} y={58} textAnchor="middle" fill={D.muted} fontSize={9.5} fontFamily="monospace">
            {b.from === b.to ? b.from : `${b.from}–${b.to}`}
          </text>
          <text x={x(i) + (i === 1 ? 95 : 60)} y={76} textAnchor="middle" fill={D.text} fontSize={11} fontWeight={700}>
            {b.label}
          </text>
        </g>
      ))}
      <text x={20} y={112} fill={D.success} fontSize={10.5} fontWeight={700}>
        {`request = ${req.pkt.tcp!.seq}–${req.pkt.tcp!.seq + REQ - 1}  → the Server answers ack=${req.pkt.tcp!.seq + REQ}`}
      </text>
      <text x={20} y={132} fill={D.muted} fontSize={10}>
        {`ACK = the next byte expected. The FIN takes ${fin.pkt.tcp!.seq}; the Server acknowledges it with ack=${fin.pkt.tcp!.seq + 1}.`}
      </text>
    </DiagramSvg>
  );
}

function LossDiagram() {
  const lost = LOSS.last!.events.find((e) => e.k === "drop" && e.why === "lab-loss") as Extract<TnRun["events"][number], { k: "drop" }>;
  const caps = capsOf(LOSS);
  const dup = caps.filter((c) => c.dir === "out" && c.pkt.tcp!.ack === lost.pkt.tcp!.seq)[1];
  const rtx = caps.find((c) => c.pkt.retx)!;
  const jump = caps.find((c) => c.dir === "out" && c.n > rtx.n)!;
  return (
    <DiagramSvg h={230} label={`Segment seq ${lost.pkt.tcp!.seq} is lost at R1, the Laptop repeats ack=${lost.pkt.tcp!.seq}, the Server resends the same seq after its ${TN_TIMERS.dataRto} ms timer, the Laptop acknowledges ${jump.pkt.tcp!.ack}`}>
      <text x={110} y={18} textAnchor="middle" fill={D.text} fontSize={11} fontWeight={600}>
        Laptop
      </text>
      <text x={320} y={18} textAnchor="middle" fill={D.text} fontSize={11} fontWeight={600}>
        R1
      </text>
      <text x={530} y={18} textAnchor="middle" fill={D.text} fontSize={11} fontWeight={600}>
        Server
      </text>
      {[110, 320, 530].map((xx) => (
        <line key={xx} x1={xx} y1={26} x2={xx} y2={222} stroke={D.line} strokeDasharray="3 4" />
      ))}
      <DArrow x1={528} y1={44} x2={324} y2={60} color={D.danger} label={`data seq=${lost.pkt.tcp!.seq} len=${lost.pkt.tcp!.len}`} labelDy={-8} />
      <text x={270} y={66} fill={D.danger} fontSize={13} fontWeight={700} textAnchor="end">
        ✕ lost
      </text>
      <DArrow x1={528} y1={84} x2={114} y2={100} color={D.tcp} label="the next segment arrives" labelDy={-8} />
      <DArrow x1={112} y1={120} x2={526} y2={136} color={D.warning} label={`${segText(dup)} — a duplicate ACK: “still missing ${lost.pkt.tcp!.seq}”`} labelDy={-8} />
      <text x={545} y={160} fill={D.warning} fontSize={10}>
        {`${TN_TIMERS.dataRto} ms, no progress: resend`}
      </text>
      <DArrow x1={528} y1={174} x2={114} y2={190} color={D.warning} label={`${segText(rtx)} (same bytes)`} labelDy={-8} />
      <DArrow x1={112} y1={206} x2={526} y2={220} color={D.success} label={`${segText(jump)} — the ACK jumps over the buffered bytes`} labelDy={-6} />
    </DiagramSvg>
  );
}

// ------------------------------------------------------------------ knowledge checks

const QUIZ: KnowledgeQuestion[] = [
  { id: "q1", prompt: `The Laptop's SYN carries seq ${M.clientIsn}. What ACK does the Server send back?`, options: [{ id: "a", label: String(M.clientIsn + 1) }, { id: "b", label: String(M.clientIsn) }, { id: "c", label: "1" }], correctId: "a", explanation: `The SYN occupies sequence number ${M.clientIsn}; ACK is the next byte expected, ${M.clientIsn + 1}.` },
  { id: "q2", prompt: "Which endpoint reaches ESTABLISHED first?", options: [{ id: "a", label: "The Laptop — when it processes the SYN-ACK" }, { id: "b", label: "Both at once, after the third packet" }, { id: "c", label: "The Server — when it sends the SYN-ACK" }], correctId: "a", explanation: "The Laptop's SYN is acknowledged by the SYN-ACK. The Server's SYN is acknowledged only by the Laptop's ACK, so the Server moves later." },
  { id: "q3", prompt: `curl sends a ${REQ}-byte request starting at seq ${M.clientIsn + 1}. What will the Server's ACK be?`, options: [{ id: "a", label: String(M.clientIsn + 1 + REQ) }, { id: "b", label: String(M.clientIsn + 2) }, { id: "c", label: String(M.clientIsn + REQ) }], correctId: "a", explanation: `${M.clientIsn + 1} + ${REQ} = ${M.clientIsn + 1 + REQ}: sequence numbers count bytes, and the ACK names the next one expected.` },
  { id: "q4", prompt: `The page segment starting at seq 1301 is lost and the next one (2301) arrives. What ACK does the Laptop send?`, options: [{ id: "a", label: "1301 again — a duplicate ACK" }, { id: "b", label: "2701" }, { id: "c", label: "Nothing" }], correctId: "a", explanation: "The receiver keeps the later bytes aside but can only acknowledge up to the hole: it repeats the next byte it still expects." },
  { id: "q5", prompt: "The retransmission of lost data carries…", options: [{ id: "a", label: "The same sequence number and the same bytes" }, { id: "b", label: "A new, higher sequence number" }, { id: "c", label: "Sequence number 0" }], correctId: "a", explanation: "It is the oldest unacknowledged data, resent from the sender's retransmission queue. SND.NXT does not move." },
  { id: "q6", prompt: `A SYN to port ${R.serverPort} gets an immediate RST,ACK. What does that tell you?`, options: [{ id: "a", label: "The host is reachable but nothing listens on that port" }, { id: "b", label: "The SYN was lost on the way" }, { id: "c", label: "The server application is overloaded" }], correctId: "a", explanation: "Only a reachable host's TCP can answer. Loss produces silence and retries, never a reset." },
  { id: "q7", prompt: "The Laptop stays SYN-SENT; the Server shows SYN-RECEIVED. Most likely?", options: [{ id: "a", label: "The SYN-ACK is lost on the way back" }, { id: "b", label: "The port is closed" }, { id: "c", label: "The Laptop computed the wrong ACK" }], correctId: "a", explanation: "The Server got the SYN and answered. A closed port would answer RST and create no connection; the Laptop never got a SYN-ACK to compute any ACK from." },
  { id: "q8", prompt: "Which device in this lesson keeps TCP connection state?", options: [{ id: "a", label: "Only the Laptop and the Server" }, { id: "b", label: "R1 too" }, { id: "c", label: "Only R1" }], correctId: "a", explanation: "TCP is end to end. R1 routes packets and decrements the TTL; it doesn't keep connection state (its ACL can match ports, but that is filtering, not TCP)." },
  { id: "q9", prompt: "dig gets no answer and retries twice. Who retried?", options: [{ id: "a", label: "dig, the application" }, { id: "b", label: "UDP" }, { id: "c", label: "R1" }], correctId: "a", explanation: "UDP has no acknowledgments and no retransmission. An application that wants reliability over UDP builds it itself." },
];

// ------------------------------------------------------------------ content

export function TcpDeepDiveContent({ onOpenLab }: { onOpenLab?: () => void }) {
  const h = SYN.pkt.tcp!;
  const val = (label: string) => ({ "Source Port": String(h.sport), "Destination Port": String(h.dport), Sequence: String(h.seq), Acknowledgment: "0 (not valid — ACK flag clear)", "Header Length": "20 bytes (no options in this lab)", Flags: flagsText(h.flags) })[label] ?? "";
  const hsRun = HS.last!;
  const afterSyn = statesAt(hsRun, arrival(HS, SYN));
  const afterSynAck = statesAt(hsRun, arrival(HS, SYNACK));
  const est = statesAt(hsRun, arrival(HS, ACK3));
  const incTcbs = { client: INC.tcbs.find((x) => x.host === "laptop"), server: INC.tcbs.find((x) => x.host === "server") };
  const incRun = INC.last!;
  const incClient = incRun.events.filter((e) => e.k === "state" && e.host === "laptop").map((e) => (e as { to: string }).to);
  const fixedRun = FIXED.last!;
  const webReq = capsOf(WEB).find((c) => c.dir === "out" && c.pkt.tcp!.len)!;
  const webAck = capsOf(WEB).find((c) => c.dir === "in" && c.pkt.tcp!.len)!;

  return (
    <div className="space-y-12">
      {/* ------------------------------------------------------------ Foundation */}
      <GuideSection id="td-why" eyebrow="Foundation" title="Why TCP exists" tone="tcp">
        <p>
          IP gets a packet from the Laptop to the Server. That is not yet a conversation. A browser needs to send a request and get every byte of the answer back <Strong>complete, in order, exactly once</Strong> — and to know when that failed. TCP turns IP&apos;s single packets into that: a <Strong>reliable, ordered byte stream</Strong> between two applications.
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
          The application writes bytes; TCP numbers every byte, sends them in segments, and the other side hands them to its application in order, with nothing missing or repeated. In the lab nginx sends a {PAGE}-byte page in three segments; even when R1 loses the second one, curl receives all {PAGE} bytes, in order — the lost bytes are simply sent again.
        </p>
        <Callout tone="tcp" title="A stream, not messages">TCP keeps no message boundaries. The receiver gets bytes in order; how they were split into segments is invisible to it.</Callout>
      </GuideSection>

      <GuideSection id="td-sockets" eyebrow="Foundation" title="Endpoints and sockets" tone="cyan">
        <p>
          TCP lives only in the two <Strong>endpoints</Strong>. Each keeps its own record of every connection (state, sequence numbers, unacknowledged data). Before anything is sent, the Server has a <Strong>listening socket</Strong> on <Mono>*:{M.serverPort}</Mono> — a promise to accept connections, not a connection. R1 never holds TCP state.
        </p>
      </GuideSection>

      <GuideSection id="td-ports" eyebrow="Foundation" title="Source and destination ports" tone="cyan">
        <FieldTable
          title="This lesson's ports"
          columns={["Port", "Where", "Meaning"]}
          rows={[
            [<Mono key="p">22 · 80 · 443 · 8443</Mono>, "Server", "well-known service ports (SSH, HTTP, HTTPS, the API): where the Server listens"],
            [<Mono key="p">UDP 53</Mono>, "Server", "DNS — a UDP port: same idea, no connections"],
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
          Every new connection from the Laptop gets the next free port: <Mono>51001</Mono>, <Mono>51002</Mono>… Two connections to the same <Mono>10.20.20.20:{M.serverPort}</Mono> are still two conversations, kept apart by the Laptop&apos;s port — and each has its own sequence numbers. One sequence number never identifies a connection.
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
            { name: "Ethernet II", tone: "ethernet", note: "this link only — R1 rewrites it", fields: [{ name: "Destination MAC", value: "R1's MAC", why: "R1, the default gateway — not the Server." }] },
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
                { name: "Flags", value: val("Flags"), why: "SYN: synchronize sequence numbers." },
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
            [<Mono key="f">SYN</Mono>, "synchronize: this segment carries my ISN", "SYN, SYN-ACK"],
            [<Mono key="f">ACK</Mono>, "the Acknowledgment field is valid", "every segment after the first SYN"],
            [<Mono key="f">PSH</Mono>, "push the data to the application", "curl's request, the page's last segment"],
            [<Mono key="f">FIN</Mono>, "I have finished sending (one sequence number)", "the close"],
            [<Mono key="f">RST</Mono>, "reset: abort / refuse", `the reply from port ${R.serverPort}`],
          ]}
        />
      </GuideSection>

      <GuideSection id="td-seq" eyebrow="The segment" title="What a sequence number means" tone="ip">
        <KnowledgeCheck question={{ id: "p-seq", prompt: "Before reading on: the page's first segment carries 1000 bytes starting at seq 301. What seq does the next segment carry?", options: [{ id: "a", label: "1301" }, { id: "b", label: "302" }], correctId: "a", explanation: "Sequence numbers count bytes: 1000 bytes later, not one segment later." }} />
        <p>
          A sequence number is the <Strong>position of a segment&apos;s first byte</Strong> in that direction&apos;s byte stream. It is not a packet counter: a 1000-byte segment moves the next sequence number by 1000; a pure ACK (no bytes) moves it by 0.
        </p>
        <DiagramFrame caption="The Laptop → Server stream in this lesson, built by the lab's model.">
          <SeqSpaceDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="td-ack" eyebrow="The segment" title="What an ACK number means" tone="ip">
        <p>
          The acknowledgment number is the <Strong>next byte the sender of the ACK expects</Strong>. “ACK {M.clientIsn + 1 + REQ}” means “I have every byte up to {M.clientIsn + REQ}; send {M.clientIsn + 1 + REQ} next”. It is neither the last byte received nor a packet number. ACKs are cumulative: one ACK covers everything before it.
        </p>
      </GuideSection>

      <GuideSection id="td-synseq" eyebrow="The segment" title="Why SYN consumes a sequence number" tone="ip">
        <p>
          A SYN carries no data, yet it occupies one sequence number. That gives the SYN itself something to be acknowledged: the Server&apos;s <Mono>ack={SYNACK.pkt.tcp!.ack}</Mono> proves it received the SYN with seq {M.clientIsn}. So the Laptop&apos;s first data byte is {M.clientIsn + 1}, not {M.clientIsn}. FIN works the same way: it takes one number, so it can be acknowledged.
        </p>
      </GuideSection>

      <GuideSection id="td-isn" eyebrow="The segment" title="Initial sequence numbers" tone="ip">
        <p>
          Each side chooses its own ISN for each connection: here the Laptop {M.clientIsn} and the Server {M.serverIsn}. Real stacks choose them unpredictably from the 32-bit space (to resist spoofing and confusion with old connections); the lab uses small readable values, adding 1000 for each new connection (1100 / 1300, then 2100 / 2300…).
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
        <p>Three segments, because each side must announce its ISN and have it acknowledged — the middle segment does two jobs at once. It synchronizes state; it is not a security check.</p>
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
            [segText(SYN), afterSyn.client, afterSyn.server],
            [segText(SYNACK), afterSynAck.client, afterSynAck.server],
            [segText(ACK3), est.client, est.server],
          ]}
        />
        <LabBridge label="Practice this in the TCP & UDP Lab" onOpenLab={onOpenLab}>
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
          With the connection ESTABLISHED, curl sends its HTTP request ({REQ} bytes, <Mono>{TN_HTTP.requestLine}</Mono>). The segment carries <Mono>{segText(webReq)}</Mono>: its ACK field still says {M.serverIsn + 1}, because the Server has sent no bytes yet. nginx answers with the page — the first segment, <Mono>{segText(webAck)}</Mono>, already acknowledges the request.
        </p>
      </GuideSection>

      <GuideSection id="td-seqadv" eyebrow="Data" title="Sequence advances by bytes" tone="ip">
        <p>
          Sending {REQ} bytes moves the Laptop&apos;s SND.NXT from {M.clientIsn + 1} to {M.clientIsn + 1 + REQ}. Every TCP segment does not add one: a pure ACK adds zero, a SYN or a FIN adds one, data adds its length.
        </p>
      </GuideSection>

      <GuideSection id="td-ackadv" eyebrow="Data" title="ACK advancement" tone="ip">
        <FieldTable title="curl, as the Laptop's capture saw it (from the lab's model)" columns={CAP_COLS} rows={captureRows(WEB).slice(3, 9)} />
        <p>Each ACK is the next byte expected: {M.clientIsn + 1 + REQ} after the request, then 1301, 2301, 2701 as the page arrives. When an ACK arrives, the sender drops those bytes from its retransmission queue.</p>
      </GuideSection>

      <GuideSection id="td-loss" eyebrow="Reliability" title="Loss and retransmission" tone="warning">
        <DiagramFrame caption="The lab drops the segment at R1; the Laptop's own state recovers it.">
          <LossDiagram />
        </DiagramFrame>
        <FieldTable title="The Laptop's capture (from the lab's model)" columns={CAP_COLS} rows={captureRows(LOSS).slice(4, 10)} />
        <p>
          The retransmission carries the <Strong>same sequence number and the same bytes</Strong>. The receiver kept the later bytes aside (out of order) and repeated its ACK for the missing byte; once the hole is filled the ACK jumps to 2701 at once. The lab&apos;s timers are Linux-like: {TN_TIMERS.dataRto} ms minimum for data, {TN_TIMERS.synRto / 1000} s for a SYN, doubling after each try. Real stacks compute the timer from measured round-trip times; after three duplicate ACKs they resend without waiting (fast retransmit).
        </p>
        <LabBridge label="Lose and recover a segment in the TCP & UDP Lab" onOpenLab={onOpenLab}>
          Level 4 makes R1 lose one segment of the page: watch the duplicate ACK, the same bytes resent, and the ACK jump.
        </LabBridge>
      </GuideSection>

      <GuideSection id="td-reliable" eyebrow="Reliability" title="Where reliability comes from" tone="warning">
        <ChecklistCard tone="warning" mark="•" title="TCP reliability = state at both ends" items={["The sender keeps every unacknowledged byte (its retransmission queue)", "The receiver acknowledges the next byte it expects", "Missing acknowledgment → the sender resends the same bytes", "Ethernet and the router resend nothing"]} />
      </GuideSection>

      {/* ------------------------------------------------------------ Refusal vs loss */}
      <GuideSection id="td-rst" eyebrow="Refusal" title="RST: a refused port" tone="danger">
        <FieldTable title={`Laptop :${R.clientPort} → Server :${R.serverPort} (from the lab's model)`} columns={CAP_COLS} rows={captureRows(REF)} />
        <p>
          Nothing listens on {R.serverPort}, but the Server is up and reachable. Its TCP stack answers the SYN with <Mono>RST,ACK seq=0 ack={R.clientIsn + 1}</Mono> — the ACK acknowledges exactly the refused SYN — and creates no connection. The Laptop closes the attempt immediately: “connection refused”. The reset comes from the Server&apos;s TCP, not from an application.
        </p>
      </GuideSection>

      <GuideSection id="td-dropvsrst" eyebrow="Refusal" title="Drop vs timeout vs refusal" tone="danger">
        <FieldTable
          title="Three different failures"
          columns={["What happened", "What the client sees", "In this lesson"]}
          rows={[
            ["A segment is dropped on the path", "silence → retransmissions; eventually a timeout", "the page segment lost at R1; the SYN-ACKs in the incident"],
            ["The port is closed on a reachable host", "an immediate RST — no retries", `SYN to :${R.serverPort}`],
            ["The application fails after ESTABLISHED", "the connection works; requests fail or hang above TCP", "not simulated — TCP state alone can't show it"],
          ]}
        />
        <Callout tone="danger" title="Keep them apart">A timeout is not “connection refused”. A RST is not a timeout. ESTABLISHED is not “the application is healthy”.</Callout>
      </GuideSection>

      <GuideSection id="td-close" eyebrow="Closing" title="The orderly close — and TIME-WAIT" tone="tcp">
        <FieldTable title="The end of nc -vz 10.20.20.20 443 (from the lab's model)" columns={CAP_COLS} rows={captureRows(HS).slice(3)} />
        <p>
          Each direction is closed on its own. The Laptop&apos;s FIN (“I&apos;ve finished sending”) takes one sequence number; the Server acknowledges it and goes to CLOSE-WAIT, its application closes, and it sends its own FIN (LAST-ACK). The Laptop acknowledges that and goes to <Strong>TIME-WAIT</Strong> for {TN_TIMERS.timeWait / 1000} s — in case its last ACK was lost and the FIN comes again. A RST, by contrast, ends a connection at once, with no handshake at all.
        </p>
        <StateTransition
          states={[
            { label: "FIN-WAIT-1", detail: "sent FIN", tone: "tcp" },
            { label: "FIN-WAIT-2", detail: "its FIN acknowledged", tone: "tcp" },
            { label: "TIME-WAIT", detail: "got the peer's FIN, sent the last ACK", tone: "cyan" },
            { label: "CLOSED", detail: `after ${TN_TIMERS.timeWait / 1000} s`, tone: "success" },
          ]}
        />
      </GuideSection>

      <GuideSection id="td-udp" eyebrow="UDP" title="UDP: ports and datagrams, no connection" tone="cyan">
        <FieldTable title="dig @10.20.20.20 server.lab (from the lab's model)" columns={CAP_COLS} rows={captureRows(DNS)} />
        <p>
          UDP adds ports (and a length and checksum) to IP — and nothing else. No handshake, no sequence or acknowledgment numbers, no retransmission, no connection state: the Server&apos;s DNS socket stays UNCONN. One datagram out, one back. When an answer doesn&apos;t come, the <Strong>application</Strong> decides: dig retries after {TN_TIMERS.dnsTimeout / 1000} s, three tries in all. A closed UDP port is reported by ICMP port unreachable (there is no RST).
        </p>
        <Callout tone="cyan" title="Not “bad TCP”">For a small question and a small answer — DNS, time sync, voice frames — a connection would only add delay. UDP is the right tool when the application handles loss its own way, or doesn&apos;t care about a late answer.</Callout>
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
        <FieldTable title="The Server's capture during the fault (from the lab's model)" columns={CAP_COLS} rows={captureRows(INC, "server")} />
        <FieldTable
          title="Evidence"
          columns={["Where", "What it shows"]}
          rows={[
            ["Laptop", `${incClient.join(" → ")} — it never processed a SYN-ACK; curl gave up after 10 s`],
            ["Server socket", `${incTcbs.server?.state ?? "—"} — it got the SYN and answered (and keeps retrying its SYN-ACK)`],
            ["Server capture", "SYN in; SYN-ACK out — and out again each time a SYN repeats"],
            ["R1", `SYN-ACK arrives on Gi0/1, never leaves on Gi0/0; show access-lists: deny tcp host 10.20.20.20 eq www any (${INC.cfg.r1.acl.entries[0].hits} matches)`],
            ["Laptop capture", "SYNs out, no SYN-ACK, no RST"],
          ]}
        />
        <Callout tone="danger" title="Root cause">
          R1&apos;s ACL drops the Server&apos;s TCP replies from port 80. Not a refused port (no RST), not the application (the handshake never completed), not the Server (its own capture shows it answering), not ACK arithmetic (no SYN-ACK ever reached the Laptop).
        </Callout>
        <p>
          After the deny line is removed, the same curl {fixedRun.ok ? "succeeds" : "still fails"}: SYN, SYN-ACK, ACK, request, page, close — and the proof is that test, not the accepted command.
        </p>
        <LabBridge label="Troubleshoot it in the TCP & UDP Lab" onOpenLab={onOpenLab}>
          Reproduce the ticket, gather the evidence at every capture point, prove where the SYN-ACK stops, repair it and verify with traffic.
        </LabBridge>
      </GuideSection>

      {/* ------------------------------------------------------------ Master it */}
      <GuideSection id="td-myths" eyebrow="Master it" title="Common misconceptions" tone="warning">
        <Misconceptions
          items={[
            { myth: "ACK is the packet number I received.", correction: `ACK is the next BYTE expected: after the request (${M.clientIsn + 1}–${M.clientIsn + REQ}) the ACK is ${M.clientIsn + 1 + REQ}.` },
            { myth: "Every TCP segment increments the sequence number by 1.", correction: `Data moves it by its length (${REQ} for the request); a pure ACK by 0; a SYN or FIN by 1.` },
            { myth: "SYN consumes no sequence space.", correction: `It takes one number: SYN seq ${M.clientIsn} → first data byte ${M.clientIsn + 1}, ACK ${M.clientIsn + 1}.` },
            { myth: "ACK means the last byte received.", correction: `It is the NEXT byte expected: ACK ${M.clientIsn + 1 + REQ} means bytes up to ${M.clientIsn + REQ} arrived.` },
            { myth: "UDP is just TCP without reliability.", correction: "UDP is its own tool: ports and datagrams, no state. It's chosen when a connection would only add delay — the application handles silence itself." },
            { myth: "TCP reliability is stateless.", correction: "It depends on state at both ends: the sender keeps unacknowledged bytes and resends them; the receiver tracks RCV.NXT." },
            { myth: "The server sends SYN-ACK without receiving a SYN.", correction: "The SYN-ACK acknowledges a SYN (ack = its seq + 1). With no SYN there is nothing to acknowledge — and no connection on the server." },
            { myth: "A timeout means the port was refused.", correction: `A refused port answers at once with RST (port ${R.serverPort}). A timeout means silence — something was lost.` },
            { myth: "RST and drop are the same.", correction: "A RST is an answer from a reachable host's TCP; a drop is no answer at all." },
            { myth: "ESTABLISHED means the application is healthy.", correction: "It only means both endpoints' TCP state is synchronized. The application above can still fail." },
            { myth: "Ports are IP-layer identifiers.", correction: `Ports are TCP header fields (${M.clientPort}, ${M.serverPort}); IP carries only addresses.` },
            { myth: "The handshake is merely a security check.", correction: "It synchronizes sequence numbers and confirms both directions work. Security comes from TLS, later." },
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

      <GuideSection id="td-practice" eyebrow="Practice" title="Practice in the TCP & UDP Lab" tone="cyan">
        <ChecklistCard
          tone="cyan"
          title="In the lab you will"
          mark="→"
          items={["See one IP serve many ports, and two conversations told apart by port", "Watch both endpoints change state during the handshake — and R1 keep none", "Read seq and ack on a real request and page", "Lose a segment and watch the duplicate ACK and the retransmission", `Compare a refused port (:${R.serverPort}) with a timeout, and the orderly close with TIME-WAIT`, "Query DNS over UDP, then troubleshoot six tickets from sockets and four capture points"]}
        />
        <LabBridge label="Open the TCP & UDP Lab" onOpenLab={onOpenLab}>
          Same network, your own copy. Nothing you do there changes your lesson progress.
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
            ["HTTPS over TCP", "HTTPS is HTTP over TLS over TCP port 443: TLS starts only after the handshake (the lab tests 443 with nc only). HTTP/3 uses QUIC over UDP instead."],
            ["SACK, delayed ACK", "Real receivers may delay ACKs and tell the sender exactly which blocks arrived (SACK); the lab acknowledges every segment at once."],
          ]}
        />
      </GuideSection>
    </div>
  );
}
