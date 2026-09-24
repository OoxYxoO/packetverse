import { Callout, ChecklistCard, CompareCards, DArrow, DIAGRAM as D, DNode, DPill, DiagramFrame, DiagramSvg, FieldTable, FlowSteps, Glossary, GuideSection, Mono } from "@/components/lesson/GuideBlocks";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";

export const TCP_DEEP_DIVE_SECTIONS: LessonGuideSectionLink[] = [
  { id: "t-what", label: "What TCP is for" },
  { id: "t-ports", label: "Ports & sockets" },
  { id: "t-handshake", label: "The three-way handshake" },
  { id: "t-seq", label: "Sequence & ACK numbers" },
  { id: "t-states", label: "Connection states" },
  { id: "t-mss", label: "MSS" },
  { id: "t-window", label: "Receive window & flow control" },
  { id: "t-reliability", label: "Reliability & retransmission" },
  { id: "t-congestion", label: "Flow vs congestion control" },
  { id: "t-close", label: "FIN: graceful close" },
  { id: "t-rst", label: "RST: abort" },
  { id: "t-udp", label: "TCP vs UDP" },
  { id: "t-https", label: "Why HTTPS needs TCP here" },
  { id: "t-failures", label: "Handshake failures" },
  { id: "t-capture", label: "Reading a capture" },
  { id: "t-not", label: "What TCP does NOT do" },
  { id: "t-glossary", label: "Glossary" },
  { id: "t-model", label: "Mental model" },
];

function SocketDiagram() {
  return (
    <DiagramSvg h={150} label="A TCP connection is identified by the source and destination IP address and port">
      <DNode x={120} y={70} label="Laptop" sub="192.168.10.10 : 51001" w={180} />
      <DNode x={520} y={70} label="Server" sub="10.20.20.20 : 443" accent={D.tcp} w={180} />
      <DArrow x1={212} y1={70} x2={428} y2={70} color={D.tcp} both label="one connection" />
      <text x={320} y={125} textAnchor="middle" fill={D.muted} fontSize={10.5} fontFamily="monospace">
        socket pair = {"{"}192.168.10.10, 51001, 10.20.20.20, 443{"}"} (+ protocol TCP)
      </text>
    </DiagramSvg>
  );
}

function HandshakeDiagram() {
  return (
    <DiagramSvg h={250} label="SYN, SYN-ACK, ACK with the lesson's sequence numbers and the resulting states">
      <text x={110} y={22} textAnchor="middle" fill={D.text} fontSize={12} fontWeight={600}>
        Client (Laptop)
      </text>
      <text x={530} y={22} textAnchor="middle" fill={D.text} fontSize={12} fontWeight={600}>
        Server :443
      </text>
      <line x1={110} y1={32} x2={110} y2={240} stroke={D.line} strokeDasharray="3 4" />
      <line x1={530} y1={32} x2={530} y2={240} stroke={D.line} strokeDasharray="3 4" />
      <DPill x={60} y={48} text="SYN_SENT" color={D.tcp} w={80} />
      <DArrow x1={112} y1={58} x2={526} y2={86} color={D.tcp} label="SYN  seq=100" labelDy={-12} />
      <DPill x={586} y={100} text="SYN_RCVD" color={D.tcp} w={80} />
      <DArrow x1={528} y1={110} x2={114} y2={138} color={D.tcp} label="SYN-ACK  seq=300  ack=101" labelDy={-12} />
      <DPill x={60} y={160} text="ESTABLISHED" color={D.success} w={96} />
      <DArrow x1={112} y1={170} x2={526} y2={198} color={D.tcp} label="ACK  seq=101  ack=301" labelDy={-12} />
      <DPill x={580} y={220} text="ESTABLISHED" color={D.success} w={96} />
    </DiagramSvg>
  );
}

function SeqDiagram() {
  const cells = ["100 SYN", "101", "102", "103", "…"];
  return (
    <DiagramSvg h={150} label="The SYN consumes one sequence number, so the first data byte is 101">
      {cells.map((c, i) => (
        <g key={c}>
          <rect x={60 + i * 100} y={40} width={92} height={40} rx={8} fill={i === 0 ? D.tcp : D.box} fillOpacity={i === 0 ? 0.18 : 1} stroke={i === 0 ? D.tcp : D.line} />
          <text x={106 + i * 100} y={65} textAnchor="middle" fill={i === 0 ? D.tcp : D.text} fontSize={11} fontFamily="monospace">
            {c}
          </text>
        </g>
      ))}
      <text x={60} y={28} fill={D.muted} fontSize={10}>
        client → server sequence space
      </text>
      <text x={320} y={112} textAnchor="middle" fill={D.text} fontSize={11}>
        SYN uses seq 100 → server replies ack=101 (&quot;next byte I expect is 101&quot;)
      </text>
      <text x={320} y={132} textAnchor="middle" fill={D.muted} fontSize={10}>
        the first data byte will carry seq 101
      </text>
    </DiagramSvg>
  );
}

function StateDiagram() {
  const s = (x: number, y: number, t: string, c: string = D.tcp) => <DPill x={x} y={y} text={t} color={c} w={112} />;
  return (
    <DiagramSvg h={220} label="Client and server TCP state progression during open and close">
      <text x={160} y={22} textAnchor="middle" fill={D.text} fontSize={11} fontWeight={700}>
        Client (active open)
      </text>
      <text x={480} y={22} textAnchor="middle" fill={D.text} fontSize={11} fontWeight={700}>
        Server (passive open)
      </text>
      {s(160, 50, "CLOSED", D.faint)}
      <DArrow x1={160} y1={63} x2={160} y2={85} color={D.faint} />
      <text x={172} y={78} fill={D.muted} fontSize={9.5}>
        send SYN
      </text>
      {s(160, 100, "SYN_SENT")}
      <DArrow x1={160} y1={113} x2={160} y2={135} color={D.faint} />
      <text x={172} y={128} fill={D.muted} fontSize={9.5}>
        rcv SYN-ACK, send ACK
      </text>
      {s(160, 150, "ESTABLISHED", D.success)}
      {s(480, 50, "LISTEN", D.faint)}
      <DArrow x1={480} y1={63} x2={480} y2={85} color={D.faint} />
      <text x={492} y={78} fill={D.muted} fontSize={9.5}>
        rcv SYN, send SYN-ACK
      </text>
      {s(480, 100, "SYN_RECEIVED")}
      <DArrow x1={480} y1={113} x2={480} y2={135} color={D.faint} />
      <text x={492} y={128} fill={D.muted} fontSize={9.5}>
        rcv ACK
      </text>
      {s(480, 150, "ESTABLISHED", D.success)}
      <text x={320} y={200} textAnchor="middle" fill={D.muted} fontSize={10}>
        closing adds FIN_WAIT_1/2, CLOSE_WAIT, LAST_ACK and TIME_WAIT (see &quot;FIN: graceful close&quot;)
      </text>
    </DiagramSvg>
  );
}

function WindowDiagram() {
  return (
    <DiagramSvg h={150} label="Sliding window: acknowledged bytes, bytes in flight, usable window, and bytes not yet allowed">
      <rect x={40} y={50} width={140} height={36} fill={D.success} fillOpacity={0.2} stroke={D.success} />
      <rect x={180} y={50} width={180} height={36} fill={D.ip} fillOpacity={0.2} stroke={D.ip} />
      <rect x={360} y={50} width={140} height={36} fill={D.tcp} fillOpacity={0.08} stroke={D.tcp} strokeDasharray="4 3" />
      <rect x={500} y={50} width={100} height={36} fill={D.box} stroke={D.line} />
      <text x={110} y={73} textAnchor="middle" fill={D.success} fontSize={10.5}>
        sent &amp; ACKed
      </text>
      <text x={270} y={73} textAnchor="middle" fill={D.ip} fontSize={10.5}>
        sent, not yet ACKed
      </text>
      <text x={430} y={73} textAnchor="middle" fill={D.tcp} fontSize={10.5}>
        may send now
      </text>
      <text x={550} y={73} textAnchor="middle" fill={D.muted} fontSize={10.5}>
        wait
      </text>
      <line x1={180} y1={100} x2={500} y2={100} stroke={D.warning} strokeWidth={2} />
      <text x={340} y={120} textAnchor="middle" fill={D.warning} fontSize={10.5} fontWeight={700}>
        receiver&apos;s advertised window (rwnd)
      </text>
      <text x={340} y={30} textAnchor="middle" fill={D.muted} fontSize={10}>
        the window slides right as ACKs arrive
      </text>
    </DiagramSvg>
  );
}

function RetransmitDiagram() {
  return (
    <DiagramSvg h={210} label="A lost segment is detected by a missing acknowledgment and retransmitted">
      <line x1={110} y1={20} x2={110} y2={200} stroke={D.line} strokeDasharray="3 4" />
      <line x1={530} y1={20} x2={530} y2={200} stroke={D.line} strokeDasharray="3 4" />
      <DArrow x1={112} y1={40} x2={526} y2={60} color={D.ip} label="seq 101 (100 bytes)" labelDy={-8} />
      <line x1={112} y1={80} x2={330} y2={92} stroke={D.danger} strokeWidth={2.2} />
      <text x={340} y={96} fill={D.danger} fontSize={14} fontWeight={700}>
        ✕ lost
      </text>
      <text x={200} y={78} textAnchor="middle" fill={D.danger} fontSize={10} fontWeight={700}>
        seq 201
      </text>
      <DArrow x1={528} y1={112} x2={114} y2={132} color={D.tcp} label="ack=201 (still waiting for 201)" labelDy={-8} />
      <DArrow x1={112} y1={160} x2={526} y2={180} color={D.warning} label="timeout or duplicate ACKs → resend seq 201" labelDy={-8} />
    </DiagramSvg>
  );
}

function CloseDiagram() {
  return (
    <DiagramSvg h={230} label="Four-segment graceful close with FIN and ACK in each direction">
      <line x1={110} y1={20} x2={110} y2={220} stroke={D.line} strokeDasharray="3 4" />
      <line x1={530} y1={20} x2={530} y2={220} stroke={D.line} strokeDasharray="3 4" />
      <DArrow x1={112} y1={40} x2={526} y2={62} color={D.violet} label="FIN (client is done sending)" labelDy={-8} />
      <DArrow x1={528} y1={86} x2={114} y2={108} color={D.tcp} label="ACK" labelDy={-8} />
      <DArrow x1={528} y1={132} x2={114} y2={154} color={D.violet} label="FIN (server is done too)" labelDy={-8} />
      <DArrow x1={112} y1={178} x2={526} y2={200} color={D.tcp} label="ACK → client waits in TIME_WAIT" labelDy={-8} />
    </DiagramSvg>
  );
}

function StackDiagram() {
  const layers: [string, string, string][] = [
    ["HTTP request / response", D.violet, "application data"],
    ["TLS", D.violet, "encryption + server authentication"],
    ["TCP :443", D.tcp, "reliable ordered byte stream"],
    ["IPv4 10.20.20.20", D.ip, "end-to-end addressing"],
    ["Ethernet", D.eth, "hop-by-hop delivery (ARP-resolved MAC)"],
  ];
  return (
    <DiagramSvg h={220} label="HTTPS layering: HTTP over TLS over TCP over IP over Ethernet">
      {layers.map(([t, c, n], i) => (
        <g key={t}>
          <rect x={120} y={14 + i * 40} width={220} height={32} rx={8} fill={c} fillOpacity={0.14} stroke={c} />
          <text x={230} y={35 + i * 40} textAnchor="middle" fill={c} fontSize={11.5} fontWeight={700}>
            {t}
          </text>
          <text x={360} y={35 + i * 40} fill={D.muted} fontSize={10.5}>
            {n}
          </text>
        </g>
      ))}
    </DiagramSvg>
  );
}

export function TcpDeepDiveContent() {
  return (
    <>
      <GuideSection id="t-what" eyebrow="Fundamentals" title="What TCP is for" tone="tcp">
        <p>
          <b className="text-pv-text">TCP (Transmission Control Protocol)</b> turns IP&apos;s best-effort packet delivery into a <b className="text-pv-text">reliable, ordered, connection-oriented byte stream</b> between two applications. IP may drop, duplicate or reorder packets; TCP hides all of that from the application.
        </p>
        <Callout tone="tcp" title="Connection-oriented" icon="⇄">
          Before any application data flows, both ends agree to talk and synchronize their sequence numbers. That agreement is the three-way handshake you drove in this lesson.
        </Callout>
      </GuideSection>

      <GuideSection id="t-ports" eyebrow="Addressing" title="Ports and the socket pair" tone="cyan">
        <p>
          IP addresses identify hosts; <b className="text-pv-text">ports</b> identify applications on those hosts. The server listens on a well-known port (HTTPS = <Mono>443</Mono>); the client picks a temporary <b className="text-pv-text">ephemeral</b> port (<Mono>51001</Mono> in this lesson).
        </p>
        <DiagramFrame caption="Four values plus the protocol uniquely identify one TCP connection, so one server can serve many clients on port 443 at once.">
          <SocketDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="t-handshake" eyebrow="Opening" title="The three-way handshake" tone="tcp">
        <DiagramFrame caption="The numbers match this lesson. Real stacks pick random 32-bit initial sequence numbers; the lesson uses 100 and 300 to keep the math readable.">
          <HandshakeDiagram />
        </DiagramFrame>
        <FlowSteps
          steps={[
            { title: "SYN", body: "The client proposes a connection and its initial sequence number (ISN), and usually advertises options such as MSS and window scaling.", tone: "tcp" },
            { title: "SYN-ACK", body: "The server acknowledges the client's ISN (ack = ISN + 1) and sends its own ISN.", tone: "tcp" },
            { title: "ACK", body: "The client acknowledges the server's ISN. Both sides are ESTABLISHED and data can flow.", tone: "success" },
          ]}
        />
      </GuideSection>

      <GuideSection id="t-seq" eyebrow="Numbers" title="Sequence and acknowledgment numbers" tone="ip">
        <p>
          TCP numbers <b className="text-pv-text">bytes</b>, not packets. The sequence number is the position of a segment&apos;s first byte; the acknowledgment number is the <b className="text-pv-text">next byte the receiver expects</b>. SYN and FIN each consume one sequence number even though they carry no data.
        </p>
        <DiagramFrame caption="That's why the SYN with seq=100 is answered with ack=101.">
          <SeqDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="t-states" eyebrow="State machine" title="Connection states" tone="tcp">
        <DiagramFrame caption="Each endpoint has its own state. The lesson's TCP State panel shows the handshake as one combined progression.">
          <StateDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="t-mss" eyebrow="Segment size" title="MSS: Maximum Segment Size" tone="violet">
        <p>
          Each side announces in its SYN the largest TCP payload it wants to receive. On Ethernet with a 1500-byte MTU that is typically <Mono>1460</Mono> bytes (1500 − 20 IPv4 − 20 TCP). Choosing segments that fit avoids IP fragmentation.
        </p>
      </GuideSection>

      <GuideSection id="t-window" eyebrow="Flow control" title="Receive window and flow control" tone="ip">
        <p>
          Every segment advertises a <b className="text-pv-text">receive window</b>: how many more bytes the receiver can buffer. The sender never has more unacknowledged data in flight than that window, so a fast sender can&apos;t overrun a slow receiver.
        </p>
        <DiagramFrame caption="Window scaling (negotiated in the SYNs) lets the 16-bit window field describe much larger buffers.">
          <WindowDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="t-reliability" eyebrow="Reliability" title="Reliability and retransmission" tone="warning">
        <p>
          The sender keeps a copy of every unacknowledged segment. If no acknowledgment arrives before the <b className="text-pv-text">retransmission timeout</b>, or several duplicate ACKs signal a gap (fast retransmit), it sends the segment again. The receiver reorders segments by sequence number, so the application always reads the bytes <b className="text-pv-text">in order and without gaps</b>.
        </p>
        <DiagramFrame caption="Cumulative ACKs keep pointing at the first missing byte until it arrives.">
          <RetransmitDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="t-congestion" eyebrow="Two different brakes" title="Flow control vs congestion control" tone="violet">
        <CompareCards
          items={[
            { title: "Flow control", tone: "ip", tag: "receiver", points: ["Protects the receiver's buffer", "Signaled explicitly by the advertised window", "\"I can only take this much right now\""] },
            { title: "Congestion control", tone: "warning", tag: "network", points: ["Protects the network path", "Inferred by the sender from loss or delay (slow start, congestion avoidance)", "Sender keeps its own congestion window (cwnd)"] },
          ]}
        />
        <p>The sender may have in flight at most the smaller of the receive window and its congestion window.</p>
      </GuideSection>

      <GuideSection id="t-close" eyebrow="Closing" title="FIN: graceful close" tone="violet">
        <p>Each direction is closed independently: a FIN means &quot;I have no more data to send&quot;, and it must be acknowledged. The side that closes first waits in <Mono>TIME_WAIT</Mono> so late duplicates from the old connection can&apos;t be mistaken for a new one.</p>
        <DiagramFrame caption="Four segments in the general case; the middle ACK and FIN are often combined into one.">
          <CloseDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="t-rst" eyebrow="Aborting" title="RST: reset" tone="danger">
        <p>
          A <b className="text-pv-text">RST</b> aborts a connection immediately, with no graceful handshake. Common causes: a SYN to a port where nothing is listening (&quot;connection refused&quot;), an application crashing, or a firewall/middlebox rejecting the session.
        </p>
      </GuideSection>

      <GuideSection id="t-udp" eyebrow="Comparison" title="TCP vs UDP" tone="cyan">
        <CompareCards
          items={[
            { title: "TCP", tone: "tcp", tag: "stream", points: ["Handshake before data", "Reliable, ordered, retransmitted", "Flow and congestion control", "Used by HTTPS/TLS, SSH, BGP, SMTP…"] },
            { title: "UDP", tone: "ip", tag: "datagram", points: ["No handshake, no connection state", "No delivery or ordering guarantee", "Lower overhead and latency", "Used by DNS queries, VoIP, many games (and QUIC builds its own reliability on top)"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="t-https" eyebrow="In this lesson" title="Why HTTPS needs TCP here" tone="tcp">
        <p>
          In this lesson the browser speaks classic HTTPS: HTTP carried over <b className="text-pv-text">TLS over TCP port 443</b>. TLS needs a reliable, ordered stream underneath it, so the TCP handshake must reach ESTABLISHED first; only then does the TLS handshake begin, followed by the HTTP request.
        </p>
        <DiagramFrame caption="Each layer depends on the one below. ARP and routing got the IP packet there; TCP makes it a conversation.">
          <StackDiagram />
        </DiagramFrame>
        <Callout tone="cyan" title="More generally" icon="i">
          HTTP/3 runs over QUIC (on UDP) instead of TCP. This lesson models the TCP-based HTTPS path.
        </Callout>
      </GuideSection>

      <GuideSection id="t-failures" eyebrow="Troubleshooting" title="Common handshake failures" tone="danger">
        <ChecklistCard
          tone="warning"
          mark="•"
          title="Symptom → likely cause"
          items={[
            "SYN sent, nothing comes back (client retransmits SYN, then times out): the packet is dropped by a firewall, routing is broken, or the host is down.",
            "SYN answered with RST: nothing is listening on that port, or something actively rejected it.",
            "Handshake completes, then TLS stalls: often an MTU/MSS problem, or TLS-level inspection.",
            "Many connections stuck in SYN_RECEIVED on a server: the final ACKs aren't arriving (asymmetric path or SYN flood).",
          ]}
        />
      </GuideSection>

      <GuideSection id="t-capture" eyebrow="Tools" title="Reading a packet capture" tone="cyan">
        <FieldTable
          title="Fields worth checking in Wireshark/tcpdump"
          accent="tcp"
          columns={["Field", "What it tells you"]}
          rows={[
            ["Flags", "SYN / SYN-ACK / ACK / FIN / RST / PSH: where in its life the connection is"],
            ["Seq / Ack", "Byte positions; gaps or repeats reveal loss and retransmission"],
            ["Window", "Receiver buffer space; a zero window means \"stop sending\""],
            ["Options (SYN)", "MSS, window scale, SACK permitted, timestamps"],
            ["Ports", "Which application and which connection (the 4-tuple)"],
            ["Timing", "Round-trip time between SYN and SYN-ACK; retransmission intervals"],
          ]}
        />
      </GuideSection>

      <GuideSection id="t-not" eyebrow="Clear the myths" title="What TCP does NOT do" tone="danger">
        <ChecklistCard
          tone="danger"
          mark="✕"
          title="Not TCP's job"
          items={["It doesn't encrypt anything. That's TLS.", "It doesn't route packets or pick paths. That's IP.", "It doesn't resolve MAC addresses. That's ARP.", "It doesn't preserve message boundaries. It's a byte stream.", "It doesn't guarantee delivery time. It guarantees order and completeness, or an error."]}
        />
      </GuideSection>

      <GuideSection id="t-glossary" eyebrow="Reference" title="Glossary" tone="cyan">
        <Glossary
          items={[
            { term: "ISN", def: "Initial Sequence Number, chosen by each side in its SYN." },
            { term: "Ephemeral port", def: "Temporary client-side port assigned by the OS for one connection." },
            { term: "MSS", def: "Largest TCP payload a side wants to receive in one segment." },
            { term: "rwnd", def: "Receive window, the buffer space advertised by the receiver." },
            { term: "cwnd", def: "Congestion window, the sender's own estimate of what the network can take." },
            { term: "RTO", def: "Retransmission timeout, how long to wait for an ACK before resending." },
            { term: "TIME_WAIT", def: "Final state of the side that closes first; absorbs stray old segments." },
            { term: "RST", def: "Reset: abort the connection immediately." },
          ]}
        />
      </GuideSection>

      <GuideSection id="t-model" eyebrow="In one breath" title="Mental model" tone="violet">
        <div className="rounded-2xl border border-pv-tcp/30 bg-gradient-to-br from-pv-tcp/10 to-pv-violet/5 p-5 text-sm leading-relaxed text-pv-text">
          TCP is a <b>phone call</b> on top of IP&apos;s <b>postcards</b>: first both sides say hello and agree on numbering (SYN, SYN-ACK, ACK), then every byte is numbered, acknowledged, re-sent if lost and handed over in order, the flow is paced so nobody is overwhelmed, and the call ends politely (FIN) or is hung up abruptly (RST).
        </div>
      </GuideSection>
    </>
  );
}
