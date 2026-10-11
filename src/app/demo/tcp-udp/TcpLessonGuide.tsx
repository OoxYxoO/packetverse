import { ChecklistCard, CompareCards, DArrow, DIAGRAM as D, DNode, DPill, DiagramFrame, DiagramSvg, FieldTable, FlowSteps, Glossary, GuideSection, Mono, TroubleshootingFlow } from "@/components/lesson/GuideBlocks";
import { CliPanel, pickLines, runGuideCli } from "@/components/lesson/GuideCli";
import { PracticeBridge } from "@/components/lesson/GuideInteractive";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { PresentationBridge } from "@/components/presentation/LessonPresentation";
import type { CliVendor } from "@/lib/cli/types";
import { TN_ADDR, TN_FIRST, TN_HTTP, createTcpNet, flagsText, pktName, tnApply, tnClone, tnTicket, type TnAction, type TnCap, type TnState } from "@/lib/sim-engine/scenarios/tcpNet";
import { tcpLaptopSet, tcpR1Sets, tcpServerSet, type TcpCliApi } from "./tcp-lab/tcpCli";

/**
 * TCP & UDP LESSON GUIDE — the lesson's story on the TCP & UDP Lab's network (Laptop → R1 → Server): ports and sockets,
 * the handshake, seq/ack, loss and retransmission, the close, refused vs timeout, UDP; then the incident where the
 * Server's SYN-ACKs are dropped on the way back. Every output and capture row comes from the lab's own model and terminals.
 */
export const TCP_LESSON_GUIDE_SECTIONS: LessonGuideSectionLink[] = [
  { id: "t-mission", label: "What this lesson teaches" },
  { id: "t-network", label: "The network of this lesson" },
  { id: "t-ideas", label: "Three ideas you need" },
  { id: "t-walk", label: "What you will watch" },
  { id: "t-ports", label: "A port finds the program" },
  { id: "t-handshake", label: "The handshake" },
  { id: "t-seq", label: "Every byte is numbered" },
  { id: "t-loss", label: "Loss and retransmission" },
  { id: "t-close", label: "The close" },
  { id: "t-refused", label: "Refused is not timed out" },
  { id: "t-udp", label: "UDP: no connection" },
  { id: "t-verify", label: "What working looks like" },
  { id: "t-incident", label: "The incident" },
  { id: "t-investigate", label: "How far did the handshake get?" },
  { id: "t-repair", label: "Repair and prove it" },
  { id: "t-other", label: "Other ways connections fail" },
  { id: "t-model", label: "Mental model" },
  { id: "t-glossary", label: "Glossary" },
  { id: "t-recap", label: "Recap" },
  { id: "t-practice", label: "Practice it" },
];

const C = TN_FIRST.clientIsn;
const S = TN_FIRST.serverIsn;
const CP = TN_FIRST.clientPort;
const SRV = TN_ADDR.server;

/** The TCP & UDP Lab's own terminals, run against a lab state (a test typed there runs on a copy of that state). */
function lessonCli(s: TnState, dev: "laptop" | "server" | "r1", vendor: CliVendor, command: string) {
  const api: TcpCliApi = { view: s, act: (a) => tnApply(s, a), ios: { kind: "exec" }, setIos: () => undefined, junosEdit: false, setJunosEdit: () => undefined, cand: s.cfg.r1, setCand: () => undefined };
  return runGuideCli(dev === "r1" ? tcpR1Sets(api)[vendor] : dev === "server" ? tcpServerSet(api) : tcpLaptopSet(api), command);
}
const play = (st: TnState, as: TnAction[]) => as.reduce(tnApply, st);
const HS = play(createTcpNet(), [{ type: "nc", port: 443 }]);
const WEB = play(createTcpNet(), [{ type: "curl", port: 80 }]);
const LOSS = play(createTcpNet(), [{ type: "loss", dir: "s2c", what: "data", nth: 2 }, { type: "curl", port: 80 }]);
const BROKEN = play(createTcpNet(), [{ type: "ticket", id: "synack-drop" }, tnTicket("synack-drop").repro]);
const FIXED = (() => {
  const c = tnClone(BROKEN.cfg);
  c.r1.acl.entries = c.r1.acl.entries.filter((e) => e.action !== "deny");
  return play(BROKEN, [{ type: "cfg", cfg: c, text: "R1: no 5" }]);
})();
const REFUSED = play(createTcpNet(), [{ type: "ticket", id: "refused" }]);

/** The capture rows of a state's last test at one point (the same rows the lab's Capture view shows). */
const capRows = (st: TnState, point: TnCap["point"] = "laptop", max = 99) =>
  st.captures
    .filter((c) => c.n >= st.last!.capFrom && c.point === point && c.pkt.proto !== "icmp")
    .slice(0, max)
    .map((c) => [((c.t - st.last!.start) / 1000).toFixed(3), c.pkt.dst === SRV ? "Laptop → Server" : "Server → Laptop", <Mono key="f">{c.pkt.tcp ? flagsText(c.pkt.tcp.flags) : pktName(c.pkt)}</Mono>, c.pkt.tcp ? String(c.pkt.tcp.seq) : "—", c.pkt.tcp?.ack !== undefined ? String(c.pkt.tcp.ack) : "—", String(c.pkt.tcp?.len ?? c.pkt.udp?.len ?? 0), c.pkt.retx ? "retransmission" : c.dir === "out" ? "sent" : "received"]);
const CAP_COLS = ["Time (s)", "Direction", "Flags", "Seq", "Ack", "Len", "Note"];

function NetworkDiagram() {
  return (
    <DiagramSvg h={170} label={`Laptop ${TN_ADDR.laptop} connects through R1 to the Server ${SRV}, which listens on several ports`}>
      <DNode x={100} y={70} label="Laptop" sub={`${TN_ADDR.laptop} : ${CP}`} w={170} />
      <DNode x={320} y={70} label="R1" sub="routes IP · no TCP state" accent={D.faint} w={150} />
      <DNode x={540} y={70} label="Server" sub={SRV} accent={D.tcp} w={150} />
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

function LessonLabBridge({ onOpenLab }: { onOpenLab?: () => void }) {
  if (!onOpenLab) return null;
  return (
    <PracticeBridge label="Open the TCP & UDP Lab" onPractice={onOpenLab}>
      Same network, your own copy. Nothing you do there changes your lesson progress.
    </PracticeBridge>
  );
}

export function TcpLessonGuideContent({ onOpenLab }: { onOpenLab?: () => void }) {
  const listen = lessonCli(createTcpNet(), "server", "cisco", "ss -tlnp");
  const ncOk = lessonCli(createTcpNet(), "laptop", "cisco", `nc -vz ${SRV} 443`);
  const ncRefused = lessonCli(createTcpNet(), "laptop", "cisco", `nc -vz ${SRV} 8080`);
  const dig = lessonCli(createTcpNet(), "laptop", "cisco", `dig @${SRV} server.lab`);
  const curlOk = lessonCli(createTcpNet(), "laptop", "cisco", `curl http://${SRV}/`);
  const curlBad = lessonCli(BROKEN, "laptop", "cisco", `curl --connect-timeout 10 http://${SRV}/`);
  const curlRefused = lessonCli(REFUSED, "laptop", "cisco", `curl http://${SRV}/`);
  const srvBad = lessonCli(BROKEN, "server", "cisco", "ss -tan");
  const aclBad = lessonCli(BROKEN, "r1", "cisco", "show access-lists");
  const curlFixed = lessonCli(FIXED, "laptop", "cisco", `curl http://${SRV}/`);
  const aclFixed = lessonCli(FIXED, "r1", "cisco", "show access-lists");
  return (
    <div className="space-y-12">
      <GuideSection id="t-mission" eyebrow="This lesson" title="What this lesson teaches" tone="tcp">
        <p>
          The Laptop talks to several programs on the Server, through the router R1: a web server, SSH, an API and a DNS server. IP gets each packet to the right <strong>host</strong>. Something else has to get it to the right <strong>program</strong>, and make sure a whole web page arrives complete and in order.
        </p>
        <p>
          This lesson shows how <strong>TCP</strong> and <strong>UDP</strong> do that: you watch a port pick the program, TCP open a connection with a handshake, number every byte, recover a lost segment and close cleanly; you see a refused port and a UDP query. Then the website spins and times out while the server insists it&apos;s fine, and you find out why, fix it, and prove it.
        </p>
        <ChecklistCard
          tone="tcp"
          title="By the end of this lesson you can"
          mark="→"
          items={[
            "name the four numbers that identify a connection, and say which side chose each",
            "follow the handshake with both endpoints' states, and compute each ACK",
            "explain how sequence numbers and ACKs make TCP reliable, and what a retransmission is",
            "tell a refused connection from a timed-out one, and say what each proves",
            "find and repair the incident of this lesson from evidence on every device, and prove it",
          ]}
        />
      </GuideSection>

      <GuideSection id="t-network" eyebrow="This lesson" title="The network of this lesson" tone="cyan">
        <DiagramFrame caption="One client, one router, one server with several services.">
          <NetworkDiagram />
        </DiagramFrame>
        <FieldTable
          title="What runs where"
          columns={["Device", "Address", "Role"]}
          rows={[
            ["Laptop (Linux)", TN_ADDR.laptop, "The client: curl, nc, dig"],
            ["R1", `${TN_ADDR.gw} · ${TN_ADDR.r1wan}`, "Routes between the two networks; keeps no TCP state; filter EDGE on Gi0/1"],
            ["Server (Linux)", SRV, "sshd (TCP 22), nginx (TCP 80, 443), the API (TCP 8443), named (UDP 53)"],
          ]}
        />
      </GuideSection>

      <GuideSection id="t-ideas" eyebrow="This lesson" title="Three ideas you need" tone="cyan">
        <FlowSteps
          steps={[
            { title: "A port finds the program", body: "The IP address gets the packet to the Server; the destination port picks nginx, sshd or named. The client picks its own source port for each connection.", tone: "cyan" },
            { title: "TCP is a conversation with state", body: "Both ends agree to talk (the handshake), number every byte they send, acknowledge what arrived, and resend what didn't.", tone: "tcp" },
            { title: "The answer tells you where it failed", body: "A reset means the host answered and nothing listens. Silence means something dropped the packet, or the answer, on the way.", tone: "danger" },
          ]}
        />
      </GuideSection>

      <GuideSection id="t-walk" eyebrow="This lesson" title="What you will watch, step by step" tone="warning">
        <FlowSteps
          steps={[
            { title: "Ports", body: "The Server listens on five ports; the Laptop brings its own.", tone: "cyan" },
            { title: "The handshake", body: "SYN, SYN-ACK, ACK: both ends reach ESTABLISHED.", tone: "tcp" },
            { title: "Data", body: "A request and a page, every byte numbered and acknowledged.", tone: "violet" },
            { title: "Loss", body: "One segment is lost; TCP notices and sends it again.", tone: "warning" },
            { title: "Close, refuse, UDP", body: "FIN and ACK; a reset from a port nobody listens on; a DNS query with no connection at all.", tone: "ip" },
            { title: "The incident", body: "The site spins and times out. You find out why and fix it.", tone: "danger" },
          ]}
        />
        <p className="text-sm text-pv-text-muted">The sections below walk through each step on this network, in the same order.</p>
      </GuideSection>

      <GuideSection id="t-ports" eyebrow="Ports" title="An IP finds the host; a port finds the program" tone="cyan">
        <p>Each service on the Server opens a <strong>listening socket</strong> on its port. That is what the Server&apos;s socket table shows:</p>
        <CliPanel run={listen} caption="Server · Linux" />
        <p>
          When curl connects, the Laptop picks a free <strong>source port</strong> (<Mono>{CP}</Mono> for the first connection) so replies come back to curl and not to another program. A connection is identified by four numbers: source IP and port, destination IP and port. Two tabs to the same site are two connections, because their source ports differ.
        </p>
      </GuideSection>

      <GuideSection id="t-handshake" eyebrow="The handshake" title="SYN, SYN-ACK, ACK: and both ends change state" tone="tcp">
        <p>Before any data, TCP opens a connection. Each side picks an initial sequence number (ISN), and each acknowledges the other&apos;s:</p>
        <DiagramFrame caption="Both endpoints change state. R1 only routes the packets.">
          <HandshakeDiagram />
        </DiagramFrame>
        <p>The SYN counts as one byte, so the Server acknowledges ISN + 1 ({C + 1}). The lab&apos;s capture on the Laptop shows exactly that, then the immediate close, for <Mono>nc -vz {SRV} 443</Mono>:</p>
        <FieldTable title="Laptop capture · nc -vz to port 443" columns={CAP_COLS} rows={capRows(HS)} />
        <CliPanel run={ncOk} caption="Laptop · Linux" />
      </GuideSection>

      <GuideSection id="t-seq" eyebrow="seq and ack" title="Every byte is numbered" tone="violet">
        <p>
          After the handshake, each byte of data has a sequence number. A segment says &quot;these bytes start at seq N&quot;; an ACK says &quot;I have everything before byte N; send N next&quot;. curl sends its {TN_HTTP.request}-byte request from seq {C + 1}, so the Server acknowledges {C + 1 + TN_HTTP.request}; nginx sends the {TN_HTTP.response}-byte page in 1000-byte segments:
        </p>
        <FieldTable title="Laptop capture · curl http://10.20.20.20/" columns={CAP_COLS} rows={capRows(WEB)} />
        <CliPanel run={{ ...curlOk, output: pickLines(curlOk.output, /h1|title/) }} caption="Laptop · the page arrives" />
      </GuideSection>

      <GuideSection id="t-loss" eyebrow="Reliability" title="Loss and retransmission" tone="warning">
        <p>
          Now R1 loses the page&apos;s second segment once. The third still arrives, but the Laptop can only acknowledge what it has in order, so it keeps asking for the missing byte. The Server notices and sends the <strong>same bytes with the same sequence number</strong> again; curl never knows anything happened:
        </p>
        <FieldTable title="Laptop capture · one segment lost on the way" columns={CAP_COLS} rows={capRows(LOSS)} />
      </GuideSection>

      <GuideSection id="t-close" eyebrow="The close" title="The orderly close" tone="violet">
        <p>
          When curl is done it closes: the Laptop sends <strong>FIN</strong>, the Server acknowledges it, sends its own FIN, and the Laptop acknowledges that. The side that closed first waits in TIME-WAIT for a while, so a late duplicate of an old segment can&apos;t be mistaken for part of a new connection. Both FINs are visible at the end of the captures above.
        </p>
      </GuideSection>

      <GuideSection id="t-refused" eyebrow="Refused vs timeout" title="Refused is not the same as timed out" tone="danger">
        <p>Nothing listens on port 8080. The Server&apos;s TCP answers the SYN at once with a <strong>reset</strong> (RST): &quot;I&apos;m here, but nobody takes calls on that port&quot;:</p>
        <CliPanel run={ncRefused} caption="Laptop · a port nobody listens on" />
        <CompareCards
          items={[
            { title: "Connection refused", tone: "warning", tag: "instant", points: ["The host received the SYN and answered with RST", "The network path works in both directions", "Look at the service: stopped, or another port"] },
            { title: "Connection timed out", tone: "danger", tag: "after retries", points: ["No answer at all: the SYN or the answer was dropped", "The client retried, then gave up", "Look at the path and the filters, in both directions"] },
          ]}
        />
        <p>
          Keep that difference in mind: it is the key to the incident.
        </p>
      </GuideSection>

      <GuideSection id="t-udp" eyebrow="UDP" title="UDP: one datagram, no connection" tone="ip">
        <p>
          DNS uses UDP. There is no handshake, no sequence numbers and no retransmission: dig sends one datagram to port 53 and named answers with one. If the answer is lost, it&apos;s dig, the application, that retries, not UDP:
        </p>
        <CliPanel run={{ ...dig, output: pickLines(dig.output, /status|ANSWER|server\.lab\.\s+300|SERVER/) }} caption="Laptop · a DNS query over UDP" />
      </GuideSection>

      <GuideSection id="t-verify" eyebrow="Verification" title="What working looks like" tone="success">
        <p>Each idea of this lesson has one place that proves it. The commands are only the way to ask; what matters is what each answer proves.</p>
        <FieldTable
          title="Read the lesson on the devices"
          columns={["Question", "Command", "Where", "What the answer proves"]}
          rows={[
            ["Is the service listening?", <Mono key="1">ss -tlnp · ss -ulnp</Mono>, "Server", "A LISTEN socket on the port, owned by the process"],
            ["Does a connection open?", <Mono key="2">nc -vz &lt;ip&gt; &lt;port&gt;</Mono>, "Laptop", "succeeded = handshake complete; refused = RST; timed out = silence"],
            ["How far did a connection get?", <Mono key="3">ss -tan</Mono>, "both ends", "SYN-SENT, SYN-RECV or ESTAB, for the same four numbers"],
            ["Is something filtering?", <Mono key="4">sudo iptables -L -n -v · show access-lists</Mono>, "Server · R1", "Rules and their hit counters"],
          ]}
        />
        <p>On the healthy network, the connection to 443 succeeds (shown above) and so does the web page.</p>
      </GuideSection>

      <GuideSection id="t-incident" eyebrow="Incident" title="The incident: the site spins, then times out" tone="danger">
        <p>The user says: &quot;The site just spins and then times out. The server team swears nginx is running; they even see our connection attempts arriving.&quot; Ping to the Server works.</p>
        <CompareCards
          items={[
            { title: "What should happen", tone: "success", tag: "normal", points: ["SYN reaches the Server", "The SYN-ACK comes back through R1", "The Laptop sends ACK, then the request"] },
            { title: "What happens", tone: "danger", tag: "incident", points: ["The SYN reaches the Server, which answers", "The SYN-ACK never reaches the Laptop", "The Laptop retries its SYN, then gives up"] },
          ]}
        />
        <CompareCards
          items={[
            { title: "Why it fails", tone: "danger", tag: "cause", points: ["R1's filter on Gi0/1 drops TCP from the Server's port 80", "So every SYN-ACK dies at R1", "The handshake can never complete"] },
            { title: "What it can't be", tone: "warning", tag: "red herrings", points: ["A stopped nginx: that would be an instant refused", "A routing problem: ping works both ways", "The Server: its own sockets show it answered"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="t-investigate" eyebrow="Investigation" title="How far did the handshake get?" tone="danger">
        <TroubleshootingFlow
          steps={[
            { question: "Refused or timed out?", look: "Timed out after 10 s, never refused: something drops packets. Compare with what a stopped nginx looks like." },
            { question: "Did the Server get the SYN, and answer?", look: "ss -tan on the Server: SYN-RECV. It received the SYN and sent its SYN-ACK." },
            { question: "Where does the SYN-ACK stop?", look: "The Laptop never sees it. On the way back, R1's filter EDGE: deny tcp host 10.20.20.20 eq www, with matches." },
          ]}
        />
        <CliPanel run={curlBad} caption="Laptop · the user's test" />
        <CliPanel run={{ ...curlRefused, output: pickLines(curlRefused.output, /curl/) }} caption="For comparison · what a stopped nginx would look like" note="Refused, in 4 ms. Not what the user sees." />
        <FieldTable title="Laptop capture · the user's test" columns={CAP_COLS} rows={capRows(BROKEN, "laptop", 4)} />
        <CliPanel run={{ ...srvBad, output: pickLines(srvBad.output, /State|SYN-RECV/) }} caption="Server · it answered" />
        <CliPanel run={aclBad} caption="R1 · Cisco IOS · the filter on Gi0/1" />
      </GuideSection>

      <GuideSection id="t-repair" eyebrow="Repair" title="Repair, and prove it with the user's test" tone="success">
        <p>Remove the line that drops the Server&apos;s replies. Nothing on the Laptop or the Server changes: neither was at fault.</p>
        <CompareCards
          items={[
            { title: "Cisco IOS · R1", tone: "cyan", tag: "one line", points: ["ip access-list extended EDGE", "no 5"] },
            { title: "Junos · R1", tone: "violet", tag: "candidate → commit", points: ["delete firewall family inet filter EDGE term t5", "commit"] },
          ]}
        />
        <CliPanel run={aclFixed} caption="R1 · after the repair" />
        <CliPanel run={{ ...curlFixed, output: pickLines(curlFixed.output, /h1|title/) }} caption="Laptop · the user's test again" />
        <ChecklistCard
          tone="success"
          title="The proof"
          mark="✓"
          items={[
            "The same curl returns the page",
            "A capture shows SYN, SYN-ACK, ACK, the request and the page",
            "The new connection completes; the half-open entry from the failed attempt simply times out on the Server",
            "EDGE keeps its permit line; nothing else on R1 changed",
          ]}
        />
      </GuideSection>

      <GuideSection id="t-other" eyebrow="Troubleshooting" title="Other ways connections fail" tone="warning">
        <p>The dropped SYN-ACK is one way to break a connection. The lab&apos;s tickets add five more, each with its own evidence. The Deep Dive walks through all six with real output from the Laptop, the Server and R1.</p>
        <CompareCards
          items={[
            { title: "Nothing listening", tone: "warning", tag: "refused at once", points: ["nginx stopped: ss -tlnp has no :80", "Every SYN gets an RST", "Start the service"] },
            { title: "The Server's own firewall", tone: "danger", tag: "timeout on one port", points: ["The process listens, but iptables drops the SYN", "No SYN-RECV on the Server at all", "The DROP rule's counter grows"] },
            { title: "No route back", tone: "danger", tag: "everything times out", points: ["The Server has no default gateway", "SYN-RECV for every attempt: its answers have nowhere to go", "ping fails too"] },
            { title: "DNS stopped", tone: "cyan", tag: "UDP refused", points: ["dig fails at once: connection refused", "Over UDP that is an ICMP port unreachable", "Websites by IP still work"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="t-model" eyebrow="Mental model" title="A phone call with numbered pages" tone="cyan">
        <p>
          The IP address is the building; the port is the extension. TCP is a phone call: you dial (SYN), they pick up (SYN-ACK), you say &quot;hello&quot; (ACK), and only then do you read your document, page by numbered page, while the other side keeps saying &quot;got up to page 7&quot;. A missing page is read again. A busy tone at once (reset) means the building is there but nobody has that extension; endless ringing (timeout) means the call, or the answer, never gets through. UDP is a postcard: no call, no page numbers, no guarantee.
        </p>
      </GuideSection>

      <GuideSection id="t-glossary" eyebrow="Glossary" title="Terms used in this lesson" tone="violet">
        <Glossary
          items={[
            { term: "Port", def: "A 16-bit number that picks the program on a host. Servers listen on well-known ports; clients pick a free source port." },
            { term: "Socket", def: "One endpoint: an IP address and a port, owned by a process." },
            { term: "Handshake", def: "SYN, SYN-ACK, ACK: both sides agree to talk and exchange initial sequence numbers." },
            { term: "Sequence number", def: "The number of a segment's first byte. Every byte sent is numbered." },
            { term: "ACK number", def: "The next byte the receiver expects: everything before it has arrived." },
            { term: "Retransmission", def: "The same bytes, same sequence number, sent again because no ACK covered them." },
            { term: "RST", def: "Reset: an immediate refusal or abort. Answers a SYN to a port nobody listens on." },
            { term: "UDP", def: "Datagrams with ports and nothing else: no connection, no ordering, no retransmission." },
          ]}
        />
      </GuideSection>

      <GuideSection id="t-recap" eyebrow="Recap" title="What you can now explain" tone="success">
        <ChecklistCard
          tone="cyan"
          title="TCP & UDP in this lesson"
          mark="→"
          items={[
            "IP finds the host; the destination port finds the program; the source port finds the way back",
            "SYN, SYN-ACK, ACK: both ends move to ESTABLISHED; R1 keeps no state",
            "Every byte has a sequence number; an ACK names the next byte expected",
            "A lost segment is resent with the same sequence number",
            "RST = refused at once; silence = timed out after retries",
            "Server in SYN-RECV with a client that never got the SYN-ACK: look on the way back",
          ]}
        />
      </GuideSection>

      <GuideSection id="t-practice" eyebrow="Practice" title="Practice it" tone="cyan">
        <p>You now know what both ends of a connection should do, and how to prove it. The TCP & UDP Lab gives you this network, with Linux terminals on both ends and Cisco or Junos on R1:</p>
        <FlowSteps
          steps={[
            { title: "Learn (6 levels)", body: "Ports and conversations, the handshake, bytes/seq/ack, loss and recovery, close/reset/refused/timeout, UDP.", tone: "violet" },
            { title: "Test and capture", body: "Run curl, nc and dig, lose a segment on purpose, and read the captures at the Laptop, both sides of R1 and the Server.", tone: "warning" },
            { title: "Troubleshoot (6 tickets)", body: "This lesson's incident and the five other faults above, reported as users report them.", tone: "danger" },
          ]}
        />
        <PresentationBridge>Watch ports, the handshake, numbered bytes and a lost segment animated in the TCP & UDP presentation.</PresentationBridge>
        <LessonLabBridge onOpenLab={onOpenLab} />
        <p className="text-sm text-pv-text-muted">For the full course (the TCP header field by field, every state, the close and TIME-WAIT, drop vs timeout vs refusal, real output for every ticket, a knowledge check), open the TCP & UDP Deep Dive tab.</p>
      </GuideSection>
    </div>
  );
}
