import type { ReactNode } from "react";
import type { SpLevel } from "@/components/sp-lab/spKit";
import type { PaAction, PaHosts, PaJCfg } from "@/lib/sim-engine/scenarios/paNet";

/**
 * Packet Analysis Lab · Learn — six levels on the lab network:
 *   1 One conversation, five captures · 2 The handshake, number by number · 3 Refusal or silence? · 4 Bracket the loss ·
 *   5 Can you trust the capture? · 6 When it breaks: the slow open
 */

const B = ({ children }: { children: ReactNode }) => <b className="text-pv-text">{children}</b>;
const M = ({ children }: { children: ReactNode }) => <span className="pv-mono text-pv-text">{children}</span>;
const set = (text: string, r1?: (c: PaJCfg) => void, sw1?: (c: PaJCfg) => void, host?: (h: PaHosts) => void): PaAction => ({ type: "set", text, changes: [...(r1 ? [{ dev: "R1" as const, f: r1 }] : []), ...(sw1 ? [{ dev: "SW1" as const, f: sw1 }] : [])], host });
const nc: PaAction = { type: "nc" };
const curl: PaAction = { type: "curl" };
const warm = set("CLIENT already knows its gateway's MAC (it used the portal earlier)", undefined, undefined, (h) => void (h.clientArp = true));
const stopped = set("SERVER: nginx stopped", undefined, undefined, (h) => void ((h.nginx = false), (h.clientArp = true)));
const dropped = set("SERVER: iptables drops TCP/443", undefined, undefined, (h) => void ((h.drop443 = true), (h.clientArp = true)));
const shaper = set("R1: class-of-service shaping-rate 64k on ge-0/0/0", (c) => void (c.shape = true), undefined, (h) => void (h.clientArp = true));
const halfMirror = set("SW1: analyzer CAP mirrors ingress only", undefined, (c) => void (c.analyzer = { ingress: true, egress: false }), (h) => void (h.clientArp = true));

export const PA_LEVELS: SpLevel<PaAction>[] = [
  {
    n: 1,
    title: "One conversation, five captures",
    idea: "CLIENT fetches the portal from SERVER:443. The same frames are captured at five points along the path; each capture is a different witness of the same conversation.",
    steps: [
      {
        title: "Follow one request",
        body: <p>CLIENT first ARPs for its gateway <M>10.10.10.1</M>, then opens TCP to <M>10.20.20.20:443</M>, sends a 120-byte request, receives 380 bytes and closes. Every frame is recorded at CLIENT eth0, on SW1&apos;s mirror (SPAN), on both R1 interfaces and at SERVER eth0. The table below shows each frame and every capture that saw it.</p>,
        runs: [{ label: "curl the portal", actions: [curl] }],
        show: ["bracket", "test"],
        check: { q: "Which fields change between the CLIENT capture and the SERVER capture of the same SYN?", options: [{ id: "a", label: "TTL (64 → 63) and the Ethernet addresses — R1 routes the packet in between" }, { id: "b", label: "The source and destination IP addresses" }, { id: "c", label: "The TCP sequence number" }], answer: "a", why: "Routing rewrites the frame and decrements TTL; IPs, ports and TCP numbers stay the same end to end." },
      },
    ],
  },
  {
    n: 2,
    title: "The handshake, number by number",
    idea: "One flow is one five-tuple. Inside it, sequence and acknowledgment numbers tell you exactly what each side has received.",
    steps: [
      {
        title: "SYN, SYN-ACK, ACK — then a close",
        body: <p>The SYN carries CLIENT&apos;s initial sequence number. The SYN-ACK carries SERVER&apos;s and acknowledges CLIENT&apos;s <B>ISN + 1</B>. Data advances the sequence by its length; a FIN consumes one number. tcpdump prints relative numbers after the handshake (<M>-nn</M>); add <M>S</M> (<M>-nnS</M>) to see absolute ones.</p>,
        pre: [warm],
        runs: [{ label: "nc -vz (connect test)", actions: [nc] }],
        show: ["captures", "bracket"],
        check: { q: "The SYN has seq 2000. What does the SYN-ACK acknowledge?", options: [{ id: "a", label: "2001 — the SYN consumes one sequence number" }, { id: "b", label: "2000" }, { id: "c", label: "Its own sequence number" }], answer: "a", why: "SYN and FIN each consume one sequence number; the ACK names the next byte expected." },
      },
    ],
  },
  {
    n: 3,
    title: "Refusal or silence?",
    idea: "A closed port answers at once with RST. A drop answers nothing — the client waits and retransmits. The difference shows up in the first second of a capture.",
    steps: [
      {
        title: "A closed port",
        body: <p>nginx is stopped. SERVER receives the SYN and answers immediately with <B>RST,ACK</B>: the connection is refused in well under a millisecond. There is no retransmission, because there is nothing to wait for.</p>,
        pre: [stopped],
        runs: [{ label: "nc -vz", actions: [nc] }],
        show: ["test", "bracket"],
      },
      {
        title: "A silent drop",
        body: <p>nginx runs, but SERVER&apos;s host firewall drops TCP/443. The SYN is still in SERVER&apos;s own capture (tcpdump sees frames before the firewall), yet nothing comes back. CLIENT retransmits the SYN after <B>1 s</B>, then after <B>2 s</B> more, and gives up at its 5-second timeout.</p>,
        pre: [dropped],
        runs: [{ label: "nc -vz", actions: [nc] }],
        show: ["test", "bracket"],
        check: { q: "Which capture proves the SYN reached SERVER in this case?", options: [{ id: "a", label: "SERVER eth0 — the host capture sees the SYN before the firewall discards it" }, { id: "b", label: "CLIENT eth0" }, { id: "c", label: "None — a timeout means the SYN never arrived" }], answer: "a", why: "Only a capture at or past the drop point can tell you how far the packet got." },
      },
    ],
  },
  {
    n: 4,
    title: "Bracket the loss",
    idea: "When an answer goes missing, find the last capture that has it and the first that doesn't. The loss is between them — then confirm with a counter at that spot.",
    steps: [
      {
        title: "The SYN-ACK that vanished",
        body: <p>R1 now shapes its client-facing egress. The first SYN-ACK leaves SERVER and arrives on R1 <M>ge-0/0/1</M>, but is never transmitted on <M>ge-0/0/0</M>: not in R1&apos;s ge-0/0/0 capture, not on SPAN, not at CLIENT. CLIENT retransmits its SYN after 1 s; the second SYN-ACK gets through. R1&apos;s <M>ge-0/0/0</M> output drops rose by one.</p>,
        pre: [shaper],
        runs: [{ label: "nc -vz", actions: [nc] }],
        show: ["bracket", "counters"],
        check: { q: "Where was the first SYN-ACK lost?", options: [{ id: "a", label: "Inside R1, between receiving it on ge-0/0/1 and transmitting it on ge-0/0/0" }, { id: "b", label: "Between CLIENT and SW1" }, { id: "c", label: "SERVER never sent it" }], answer: "a", why: "It is in the ge-0/0/1 capture and absent from ge-0/0/0 onwards — and ge-0/0/0's drop counter agrees." },
      },
    ],
  },
  {
    n: 5,
    title: "Can you trust the capture?",
    idea: "A capture can only show what it was given. A mirror that copies one direction makes every reply look ‘lost’ — while the network works perfectly.",
    steps: [
      {
        title: "A one-sided mirror",
        body: <p>SW1&apos;s analyzer now mirrors only frames <B>received</B> on CLIENT&apos;s port. The connection succeeds — CLIENT&apos;s own capture shows the SYN-ACK — but the SPAN copy contains only what CLIENT sent. Before you conclude ‘no reply’, check how the capture was taken.</p>,
        pre: [halfMirror],
        runs: [{ label: "nc -vz", actions: [nc] }],
        show: ["bracket", "test", "ladder"],
        check: { q: "The SPAN capture shows SYNs and no SYN-ACKs. What do you check first?", options: [{ id: "a", label: "Whether the mirror copies both directions — and whether the connection actually failed" }, { id: "b", label: "Open a case with the server vendor" }, { id: "c", label: "Restart the server" }], answer: "a", why: "Absence of evidence in an incomplete capture is not evidence of absence." },
      },
    ],
  },
  {
    n: 6,
    title: "When it breaks: the slow open",
    idea: "The guided lesson's incident: connections sometimes take a full second to open. Three connection tests, five captures and R1's counters lead to one drop point.",
    steps: [
      {
        title: "Intermittent, but not random",
        body: <p>Of three connections, the first needs a SYN retransmission and opens after <B>1.000 s</B>; the others open in microseconds (the third loses a FIN, retransmitted after 200 ms). The ladder below reads the network: the request always arrives, SERVER always answers, the missing answer disappears inside R1 on the way out of <M>ge-0/0/0</M>, and its output-drop counter matches. Remove the shaper and prove three clean connections.</p>,
        pre: [shaper],
        runs: [{ label: "Three connection tests", actions: [nc, nc, nc] }],
        show: ["test", "ladder", "counters"],
        check: { q: "Why is a retransmitted SYN not proof that the first SYN was lost?", options: [{ id: "a", label: "The client only knows it got no SYN-ACK — the SYN or the SYN-ACK could have been lost; captures tell which" }, { id: "b", label: "It is proof" }, { id: "c", label: "SYNs are never lost" }], answer: "a", why: "Here the SYN arrived every time; it was the answer that was dropped." },
      },
    ],
  },
];
