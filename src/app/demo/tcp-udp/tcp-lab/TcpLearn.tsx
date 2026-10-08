"use client";

import type { ReactNode } from "react";
import { TN_ADDR, type TnAction, type TnCfg } from "@/lib/sim-engine/scenarios/tcpNet";

/**
 * LEARN — the transport layer, one idea per step, always on the real network (Laptop — R1 — Server):
 *   1 Ports & conversations   one IP, many services; the client's own port; the 4-tuple names a conversation
 *   2 The handshake           SYN, SYN-ACK, ACK — and BOTH endpoints changing state; R1 keeps none
 *   3 Bytes, seq and ack      the handshake prepares; the data rides the connection; seq = first byte, ack = next byte
 *   4 Loss and recovery       a lost segment, the duplicate ACK, the same bytes resent, the ACK jumping forward
 *   5 Close, reset, timeout   FIN/ACK/FIN/ACK and TIME-WAIT; RST (refused) vs silence (timeout)
 *   6 UDP                     a datagram and an answer — no handshake, no state; a closed port; the application retries
 * A step can set the network up (a real configuration), arm the lab's loss, and say which evidence to show.
 */

export type TcpShow = "ports" | "history" | "handshake" | "ledger" | "numbers" | "trace" | "sockets-laptop" | "sockets-server" | "reading" | "sleep";
export interface TcpStep {
  id: string;
  title: string;
  body: ReactNode;
  setup?: (c: TnCfg) => void;
  setupText?: string;
  /** Applied just before each run of this step (the lab's loss impairment is one-shot). */
  arm?: TnAction;
  /** Each run starts from the step's own fresh network (so the numbers in the text match), unless `keep`. */
  runs?: { label: string; action: TnAction | TnAction[]; keep?: boolean }[];
  show: TcpShow[];
}
export interface TcpLevel {
  n: number;
  title: string;
  idea: string;
  steps: TcpStep[];
}
const B = ({ children }: { children: ReactNode }) => <b className="text-pv-text">{children}</b>;
const M = ({ children }: { children: ReactNode }) => <span className="pv-mono text-pv-text">{children}</span>;
const nc = (port: number, timeout?: number): TnAction => ({ type: "nc", port, timeout });

export const TCP_LEVELS: TcpLevel[] = [
  {
    n: 1,
    title: "Ports & conversations",
    idea: "An IP address finds the host. A port finds the application on it.",
    steps: [
      {
        id: "l1-ports",
        title: "One address, several applications",
        body: (
          <>
            <p>
              The Server has one IP address, <M>{TN_ADDR.server}</M>, but it runs several programs: SSH, a web server, a DNS server, the team&apos;s API. A packet addressed to <M>{TN_ADDR.server}</M> reaches the machine — but which program should get it?
            </p>
            <p>
              That is what a <B>port</B> is for. Each service <B>listens</B> on its own port: SSH on TCP 22, the web server on TCP 80 and 443, DNS on UDP 53, the API on TCP 8443. Look under the topology: one IP, many ports, each with the program that owns it.
            </p>
          </>
        ),
        show: ["ports", "sockets-server"],
      },
      {
        id: "l1-connect",
        title: "The client brings its own port",
        body: (
          <>
            <p>
              Now the Laptop connects to the web server&apos;s HTTPS port, <M>443</M>. Its operating system picks a free <B>source port</B> for this connection — an <B>ephemeral</B> port — so the answers can find their way back to the right program on the Laptop.
            </p>
            <p>
              A conversation is named by four things: <M>client IP : client port ⇄ server IP : server port</M>. Watch the endpoint bar: that 4-tuple appears as soon as the Laptop sends its first segment.
            </p>
          </>
        ),
        runs: [{ label: "nc -vz 10.20.20.20 443", action: nc(443) }],
        show: ["ports", "reading", "sockets-laptop"],
      },
      {
        id: "l1-two",
        title: "Same two hosts, two different conversations",
        body: (
          <>
            <p>
              Connect again — this time to SSH, port <M>22</M>. Same Laptop, same Server, same IP addresses. Yet it is a different conversation: the Laptop picks a new source port, and the Server port is different too.
            </p>
            <p>Afterwards, read the Laptop&apos;s sockets: two lines, two 4-tuples. That is how one machine keeps many conversations apart.</p>
          </>
        ),
        runs: [{ label: "nc -vz …443, then nc -vz …22", action: [nc(443), nc(22)] }],
        show: ["sockets-laptop", "reading"],
      },
    ],
  },
  {
    n: 2,
    title: "The handshake",
    idea: "Before any data, both endpoints agree to talk — and both change state.",
    steps: [
      {
        id: "l2-watch",
        title: "Watch SYN, SYN-ACK, ACK — and watch both ends",
        body: (
          <>
            <p>
              Open a connection to the web server (port 80) and follow it with <B>Pause</B> and <B>Step</B>. Keep an eye on the two state labels beside the Laptop and the Server — not just on the packets.
            </p>
            <p>
              The Laptop goes <M>CLOSED → SYN-SENT</M> when it sends its <B>SYN</B>. The Server, which was <M>LISTEN</M>ing, creates a new connection in <M>SYN-RECEIVED</M> and answers <B>SYN-ACK</B>. The Laptop&apos;s <B>ACK</B> completes it: both sides <M>ESTABLISHED</M>.
            </p>
          </>
        ),
        runs: [{ label: "nc -vz 10.20.20.20 80", action: nc(80) }],
        show: ["history", "reading"],
      },
      {
        id: "l2-endpoints",
        title: "R1 carried every segment — and kept no state",
        body: (
          <>
            <p>
              Every one of those segments crossed R1. Yet R1 has no idea a connection exists: it reads the IP header, looks up the route, and forwards. Open R1 (click it) — there is no socket table to look at.
            </p>
            <p>
              TCP state lives in the <B>two endpoints</B> only. That&apos;s why, when a connection misbehaves, you ask the Laptop and the Server what state they are in — and use the network devices to find out where packets went.
            </p>
          </>
        ),
        runs: [{ label: "nc -vz 10.20.20.20 80", action: nc(80) }],
        show: ["history", "trace"],
      },
      {
        id: "l2-numbers",
        title: "What the handshake really agrees on",
        body: (
          <>
            <p>
              Each side picks an <B>initial sequence number</B> (ISN) — where it will start numbering its bytes. The Laptop&apos;s SYN carries its ISN; the Server&apos;s SYN-ACK carries the Server&apos;s ISN <i>and</i> acknowledges the Laptop&apos;s: ack = Laptop ISN + 1. The final ACK does the same for the Server&apos;s.
            </p>
            <p>A SYN counts as one byte of sequence space, which is why the ack is ISN + 1. (Real systems pick random ISNs; the lab uses small ones you can read.)</p>
          </>
        ),
        runs: [{ label: "nc -vz 10.20.20.20 80", action: nc(80) }],
        show: ["handshake", "numbers"],
      },
    ],
  },
  {
    n: 3,
    title: "Bytes, seq and ack",
    idea: "The handshake prepares the road. Then every byte is numbered and acknowledged.",
    steps: [
      {
        id: "l3-data",
        title: "The handshake was preparation — now the data",
        body: (
          <>
            <p>
              Fetch the web page with <M>curl</M>. The first three segments are the handshake again. Then the real reason for the connection: curl sends its HTTP request (<M>78</M> bytes), and nginx answers with the page — <M>2400</M> bytes, split into segments of at most 1000.
            </p>
            <p>Watch the numbers on each data segment and the green data travelling on the established connection, then the close.</p>
          </>
        ),
        runs: [{ label: "curl http://10.20.20.20/", action: { type: "curl", port: 80 } }],
        show: ["numbers", "reading"],
      },
      {
        id: "l3-acks",
        title: "seq = where these bytes begin · ack = the next byte I expect",
        body: (
          <>
            <p>
              Read the ledger below. The request starts at <M>seq=101</M> and is 78 bytes long, so it covers 101–178 — and the Server acknowledges <M>ack=179</M>: “I have everything up to 178; send me 179 next”.
            </p>
            <p>The page&apos;s first segment starts at 301 and carries 1000 bytes: the Laptop answers ack=1301. Each ACK is simply the next byte expected. That is how the sender always knows exactly what arrived.</p>
          </>
        ),
        runs: [{ label: "curl http://10.20.20.20/", action: { type: "curl", port: 80 } }],
        show: ["ledger"],
      },
    ],
  },
  {
    n: 4,
    title: "Loss and recovery",
    idea: "When bytes go missing, the ACKs show it — and the same bytes are sent again.",
    steps: [
      {
        id: "l4-loss",
        title: "Lose one segment of the page",
        body: (
          <>
            <p>
              The lab will make R1 lose the <B>second</B> segment of the page (bytes 1301–2300). Fetch the page and watch closely:
            </p>
            <ul className="list-disc space-y-0.5 pl-5">
              <li>the Laptop gets bytes 301–1300 and acknowledges <M>1301</M>;</li>
              <li>bytes 2301–2700 arrive — but 1301 is still missing, so the Laptop keeps them aside and repeats <M>ack=1301</M> (a <B>duplicate ACK</B>);</li>
              <li>the Server&apos;s timer runs out (200 ms): it sends <B>the same bytes again</B>, same seq=1301;</li>
              <li>the hole is filled, and the ACK jumps straight to <M>2701</M> — everything arrived, in order.</li>
            </ul>
          </>
        ),
        arm: { type: "loss", dir: "s2c", what: "data", nth: 2 },
        runs: [{ label: "curl http://10.20.20.20/ (one segment will be lost)", action: { type: "curl", port: 80 } }],
        show: ["ledger", "trace"],
      },
      {
        id: "l4-syn",
        title: "Even the handshake recovers",
        body: (
          <>
            <p>This time the lab loses the Laptop&apos;s first SYN. Nothing comes back, so after 1 second the Laptop&apos;s timer fires and it sends the SYN again — same ISN. This one arrives, and the handshake completes as if nothing happened (just a second later).</p>
            <p>Remember this pattern: a SYN repeated after 1 s, then 2 s, then 4 s… is TCP waiting for an answer that isn&apos;t coming.</p>
          </>
        ),
        arm: { type: "loss", dir: "c2s", what: "syn" },
        runs: [{ label: "nc -vz 10.20.20.20 22 (the first SYN will be lost)", action: nc(22) }],
        show: ["ledger", "history"],
      },
    ],
  },
  {
    n: 5,
    title: "Close, reset, refused, timeout",
    idea: "A connection ends in an orderly close — or is refused — or meets silence. Each looks different.",
    steps: [
      {
        id: "l5-close",
        title: "The orderly close: FIN, ACK, FIN, ACK",
        body: (
          <>
            <p>
              Closing is stateful too. The side that closes first sends <B>FIN</B> (“I have finished sending”) and goes to <M>FIN-WAIT-1</M>. The other side acknowledges (<M>CLOSE-WAIT</M>), lets its application finish, then sends its own FIN (<M>LAST-ACK</M>). The final ACK closes it.
            </p>
            <p>
              The side that closed first lingers in <M>TIME-WAIT</M> for 60 s, in case its last ACK was lost. Check the Laptop&apos;s sockets after the test — then let 60 s pass and look again.
            </p>
          </>
        ),
        runs: [
          { label: "nc -vz 10.20.20.20 443", action: nc(443) },
          { label: "sleep 61 (let TIME-WAIT run out)", action: { type: "sleep", seconds: 61 }, keep: true },
        ],
        show: ["history", "sockets-laptop"],
      },
      {
        id: "l5-refused",
        title: "Refused: the host answers “nobody here”",
        body: (
          <>
            <p>
              Try port <M>8080</M>. Nothing listens there. The SYN reaches the Server, and the Server&apos;s TCP answers at once with <B>RST,ACK</B>: “no such service”. The Laptop goes straight back to CLOSED and nc prints <M>Connection refused</M>.
            </p>
            <p>A refusal is an answer. It proves the network path works both ways and the host is up — the problem is the port: nothing listening (or a firewall that rejects).</p>
          </>
        ),
        runs: [{ label: "nc -vz 10.20.20.20 8080", action: nc(8080) }],
        show: ["history", "reading", "sockets-server"],
      },
      {
        id: "l5-timeout",
        title: "Timeout: nothing comes back at all",
        body: (
          <>
            <p>
              Here R1 has a filter that silently drops SYNs to port 8443. Watch: SYN… nothing. After 1 s the Laptop resends it; after 2 more seconds, again; then 4 s… Silence, until nc gives up after 10 s: <M>timed out</M>.
            </p>
            <p>
              A timeout is <B>not</B> “the server is down”. It means the expected answer never arrived — the SYN or the reply was lost somewhere: a filter, a missing return route, a host firewall, a host that&apos;s off. The evidence (captures at each point) tells you which.
            </p>
          </>
        ),
        setup: (c) => (c.r1.acl = { name: "EDGE", entries: [{ seq: 5, action: "deny", proto: "tcp", dst: TN_ADDR.server, dstPort: 8443, hits: 0 }, { seq: 10, action: "permit", proto: "ip", hits: 0 }], appliedIn: "gi0" }),
        setupText: "Lesson setup: R1's ACL EDGE, inbound on Gi0/0, denies TCP to 10.20.20.20 port 8443",
        runs: [{ label: "nc -vz -w 10 10.20.20.20 8443", action: nc(8443, 10) }],
        show: ["ledger", "trace", "reading"],
      },
    ],
  },
  {
    n: 6,
    title: "UDP",
    idea: "UDP sends a datagram and lets the application decide what comes next.",
    steps: [
      {
        id: "l6-dns",
        title: "A DNS query: one datagram out, one back",
        body: (
          <>
            <p>
              Ask the Server&apos;s DNS service for <M>server.lab</M>. dig sends <B>one UDP datagram</B> to port 53 — no handshake first — and named answers with one datagram. Done. No connection was opened, so there is nothing to close.
            </p>
            <p>
              UDP still has ports (source and destination), so the answer finds dig. What it doesn&apos;t have: sequence numbers, acknowledgments, retransmission, connection state. For one small question and one small answer, that is exactly right — fast and light.
            </p>
          </>
        ),
        runs: [{ label: "dig @10.20.20.20 server.lab", action: { type: "dig" } }],
        show: ["reading", "sockets-server"],
      },
      {
        id: "l6-closed",
        title: "Nothing listening on a UDP port",
        body: (
          <>
            <p>
              Now named is stopped. UDP has no RST — so how does the Laptop learn nothing is there? The Server&apos;s IP layer answers with <B>ICMP port unreachable</B>. dig words it as “connection refused”, though UDP never had a connection.
            </p>
          </>
        ),
        setup: (c) => (c.server.services.find((s) => s.id === "named")!.running = false),
        setupText: "Lesson setup: named (the DNS service) is stopped on the Server",
        runs: [{ label: "dig @10.20.20.20 server.lab", action: { type: "dig" } }],
        show: ["reading", "trace"],
      },
      {
        id: "l6-drop",
        title: "Silence — and who retries",
        body: (
          <>
            <p>
              Here R1 drops UDP to port 53. dig sends its query… nothing. After 5 s it sends it <B>again</B> — and once more — then gives up. Those retries come from <B>dig</B>, the application. UDP itself never retransmits anything.
            </p>
            <p>
              That is the real difference with TCP: TCP keeps state and repairs loss itself; UDP hands datagrams over and leaves reliability to the application — which is perfect for DNS, voice or video, where an old answer is worthless anyway.
            </p>
          </>
        ),
        setup: (c) => (c.r1.acl = { name: "EDGE", entries: [{ seq: 5, action: "deny", proto: "udp", dst: TN_ADDR.server, dstPort: 53, hits: 0 }, { seq: 10, action: "permit", proto: "ip", hits: 0 }], appliedIn: "gi0" }),
        setupText: "Lesson setup: R1's ACL EDGE, inbound on Gi0/0, denies UDP to 10.20.20.20 port 53",
        runs: [{ label: "dig @10.20.20.20 server.lab", action: { type: "dig" } }],
        show: ["reading", "trace"],
      },
    ],
  },
];
