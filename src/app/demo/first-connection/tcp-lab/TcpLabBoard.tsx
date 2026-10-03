"use client";

import type { ReactNode } from "react";
import { BoardSection, DeepenUnderstanding, EngineerCheck, KeyLesson, NextAction, PredictionBlock, StateDeltaChips, TeachingBoard, TeachingEventRows, Verdict, type EngineerCheckFact, type PredictionOption, type StateDelta, type TeachingEventRowDef } from "@/components/practice-lab/TeachingBoard";
import { TCP_LAB_CONNS, TCP_LAB_MODEL, TCP_LAB_PAYLOADS, epText, flagText, tcbFor, type TcpCaptureRecord, type TcpConnId, type TcpHost, type TcpLabAction, type TcpLabNode, type TcpLabState } from "@/lib/sim-engine/scenarios/tcpLab";
import type { TcpCaptureView } from "./TcpLabCapture";

/**
 * TCP Lab Teaching Board — the TCP composition of the generic board primitives. It owns the script, predictions,
 * evidence checks and the return-path incident; the primitives own layout.
 *
 * Every board answers: what happened · what changed · why · why it matters · how to verify it (endpoint socket state,
 * seq/ack values, a capture entry, packet fields, the path) · what to do next. Prediction answers are frozen from a
 * pure dry run when the action runs. A check needs an inspection made after the event AND the matching lab state.
 */

export const TCP_LAB_STAGES = ["Baseline", "SYN", "SYN-ACK", "ACK", "Data", "Loss", "Refused", "Incident", "Repair & verify"];
const M = TCP_LAB_CONNS.main;
const I = TCP_LAB_CONNS.incident;
const R = TCP_LAB_CONNS.refused;
const HELLO = TCP_LAB_PAYLOADS.first;
const WORLD = TCP_LAB_PAYLOADS.second;
const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));
const hostName = (h: TcpHost) => (h === "client" ? "Laptop" : "Server");

export function tcpLabDryRun(s: TcpLabState, a: TcpLabAction): TcpLabState {
  const hops = TCP_LAB_MODEL.hops(s, a);
  let n = TCP_LAB_MODEL.start(s, a);
  for (let i = 0; i < hops; i++) n = TCP_LAB_MODEL.arrive(n);
  return n;
}

interface PredictDef {
  id: string;
  prompt: string;
  options: PredictionOption[];
  correct: (before: TcpLabState, after: TcpLabState) => string[];
  explain: string;
}
export interface TcpScriptStep {
  id: string;
  stage: number;
  phase: string;
  action: TcpLabAction;
  label: string;
  /** Phone tab-bar label (one line). */
  short: string;
  predict?: PredictDef[];
  repair?: boolean;
}

const last = (s: TcpLabState) => s.capture[s.capture.length - 1];
const lastPendingSeg = (s: TcpLabState) => s.pending[s.pending.length - 1]?.seg;
const opts = (...xs: (string | [string, string])[]): PredictionOption[] => xs.map((x) => (Array.isArray(x) ? { id: x[0], label: x[1] } : { id: x, label: x }));
const st = (s: TcpLabState, h: TcpHost, c: TcpConnId) => tcbFor(s, h, c);

export const TCP_LAB_SCRIPT: TcpScriptStep[] = [
  {
    id: "t1", short: "Open connection",
    stage: 1,
    phase: "T1",
    action: { type: "connect", conn: "main" },
    label: "Laptop opens the connection",
    predict: [
      { id: "t1-port", prompt: "Which destination port does the Laptop's first segment carry?", options: opts(String(M.serverPort), String(M.clientPort), "80"), correct: (_b, a) => [String(last(a).seg.dst.port)], explain: `HTTPS listens on ${M.serverPort}. ${M.clientPort} is the Laptop's own ephemeral source port.` },
      { id: "t1-flags", prompt: "Which TCP flags are set?", options: opts("SYN", "SYN, ACK", "ACK"), correct: (_b, a) => [flagText(last(a).seg.flags)], explain: "Only SYN: the Laptop asks to synchronise sequence numbers. There is nothing to acknowledge yet, so the ACK flag is clear." },
      { id: "t1-seq", prompt: "Which sequence number does it carry?", options: opts(String(M.clientIsn), String(M.clientIsn + 1), "0", "1"), correct: (_b, a) => [String(last(a).seg.seq)], explain: `Its initial sequence number (ISN), ${M.clientIsn}. Sequence numbers are positions in a byte stream, not packet counters.` },
      { id: "t1-state", prompt: "What is the Laptop's TCP state after sending it?", options: opts("SYN-SENT", "ESTABLISHED", "LISTEN"), correct: (_b, a) => [st(a, "client", "main")?.state ?? ""], explain: "SYN-SENT: it has sent a SYN and waits for the matching SYN-ACK." },
    ],
  },
  {
    id: "t2", short: "Deliver reply",
    stage: 2,
    phase: "T2",
    action: { type: "deliver" },
    label: "Deliver the Server's reply",
    predict: [
      { id: "t2-flags", prompt: "Which flags does the Server's reply carry?", options: opts("SYN, ACK", "ACK", "SYN"), correct: (_b, a) => [flagText(last(a).seg.flags)], explain: "SYN (its own ISN) and ACK (acknowledging the Laptop's SYN) in one segment." },
      { id: "t2-seq", prompt: "Which sequence number does the Server use?", options: opts(String(M.serverIsn), String(M.clientIsn + 1), String(M.serverIsn + 1)), correct: (_b, a) => [String(last(a).seg.seq)], explain: `Its own ISN, ${M.serverIsn} — each direction has its own, independent sequence space.` },
      { id: "t2-ack", prompt: "Calculate its ACK number.", options: opts(String(M.clientIsn + 1), String(M.clientIsn), String(M.serverIsn + 1)), correct: (_b, a) => [String(last(a).seg.ack)], explain: `ACK = client ISN + 1 = ${M.clientIsn} + 1 = ${M.clientIsn + 1}: the SYN used sequence number ${M.clientIsn}, so ${M.clientIsn + 1} is the next byte the Server expects.` },
      {
        id: "t2-states",
        prompt: "After the Laptop processes this reply, what are the two states?",
        options: opts(["c-est", "Laptop ESTABLISHED · Server SYN-RECEIVED"], ["both", "Both ESTABLISHED"], ["c-sent", "Laptop SYN-SENT · Server ESTABLISHED"]),
        correct: (_b, a) => [st(a, "client", "main")?.state === "ESTABLISHED" && st(a, "server", "main")?.state === "SYN-RECEIVED" ? "c-est" : st(a, "client", "main")?.state === "ESTABLISHED" ? "both" : "c-sent"],
        explain: "The Laptop's SYN has now been acknowledged and it knows the Server's ISN, so it is ESTABLISHED. The Server is still waiting for its own SYN to be acknowledged.",
      },
    ],
  },
  {
    id: "t3", short: "Deliver reply",
    stage: 3,
    phase: "T3",
    action: { type: "deliver" },
    label: "Deliver the Laptop's reply",
    predict: [
      { id: "t3-seq", prompt: "Which sequence number does the Laptop's ACK carry?", options: opts(String(M.clientIsn + 1), String(M.clientIsn + 2), String(M.clientIsn)), correct: (_b, a) => [String(last(a).seg.seq)], explain: `${M.clientIsn + 1}: the SYN consumed ${M.clientIsn}. A pure ACK carries no bytes, so it does not move the sequence number further.` },
      { id: "t3-ack", prompt: "And its ACK number?", options: opts(String(M.serverIsn + 1), String(M.serverIsn), String(M.serverIsn + 2)), correct: (_b, a) => [String(last(a).seg.ack)], explain: `Server ISN + 1 = ${M.serverIsn + 1}: the Server's SYN consumed ${M.serverIsn}.` },
      {
        id: "t3-states",
        prompt: "What changes when this ACK arrives?",
        options: opts(["srv", "Server SYN-RECEIVED → ESTABLISHED (Laptop already is)"], ["both", "Both become ESTABLISHED at this moment"], ["none", "Nothing — states change when data flows"]),
        correct: (_b, a) => [st(a, "server", "main")?.state === "ESTABLISHED" ? "srv" : "none"],
        explain: "Each endpoint changes state when it processes a segment. The Laptop did at the SYN-ACK; the Server does now, when its own SYN is acknowledged.",
      },
    ],
  },
  {
    id: "t4", short: "Send “HELLO”",
    stage: 4,
    phase: "T4",
    action: { type: "send-data", conn: "main", payload: HELLO },
    label: `Laptop sends ${HELLO.length} bytes “${HELLO}”`,
    predict: [
      { id: "t4-seq", prompt: `Which sequence number does the first byte, “${HELLO[0]}”, get?`, options: opts(String(M.clientIsn + 1), String(M.clientIsn + 2), String(M.clientIsn + 1 + HELLO.length)), correct: (_b, a) => [String(last(a).seg.seq)], explain: `${M.clientIsn + 1}: the first byte after the SYN. The pure ACK before it carried no bytes.` },
      { id: "t4-ack", prompt: `After the Server receives these ${HELLO.length} bytes, which ACK number will it send?`, options: opts(String(M.clientIsn + 1 + HELLO.length), String(M.clientIsn + 2), String(M.clientIsn + HELLO.length)), correct: (_b, a) => [String(lastPendingSeg(a)?.ack ?? "")], explain: `${M.clientIsn + 1} + ${HELLO.length} = ${M.clientIsn + 1 + HELLO.length}. ACK is the next byte expected — not a packet count, not the last byte received.` },
    ],
  },
  { id: "t4-ack", short: "Deliver reply", stage: 4, phase: "T4", action: { type: "deliver" }, label: "Deliver the Server's reply" },
  {
    id: "t5", short: "Send “WORLD”",
    stage: 5,
    phase: "T5",
    action: { type: "send-data", conn: "main", payload: WORLD, dropAtR1: true },
    label: `Send “${WORLD}” — the lab drops it at R1`,
    predict: [
      { id: "t5-rcv", prompt: "What happens to the Server's RCV.NXT?", options: opts(["stays", `Stays ${M.clientIsn + 1 + HELLO.length}`], ["adv", `Becomes ${M.clientIsn + 1 + HELLO.length + WORLD.length}`], ["one", `Becomes ${M.clientIsn + 2 + HELLO.length}`]), correct: (b, a) => [st(a, "server", "main")?.rcvNxt === st(b, "server", "main")?.rcvNxt ? "stays" : "adv"], explain: "The Server never receives the segment, so nothing in its state can change." },
      { id: "t5-ack", prompt: "Which ACK does the Server send for it?", options: opts(["none", "None — it received nothing"], ["new", String(M.clientIsn + 1 + HELLO.length + WORLD.length)], ["old", String(M.clientIsn + 1 + HELLO.length)]), correct: (b, a) => [a.pending.length > b.pending.length ? "new" : "none"], explain: "A receiver can only acknowledge what arrives. The Laptop learns of the loss from the ABSENCE of an acknowledgment." },
    ],
  },
  {
    id: "t5-rtx", short: "Fire timer",
    stage: 5,
    phase: "T5",
    action: { type: "timer", host: "client", conn: "main" },
    label: "Let the Laptop's retransmission timer expire (lab event)",
    predict: [
      { id: "t5-rtx-seq", prompt: "Which sequence number does the retransmitted segment carry?", options: opts(String(M.clientIsn + 1 + HELLO.length), String(M.clientIsn + 1 + HELLO.length + WORLD.length), String(M.clientIsn + 2 + HELLO.length)), correct: (_b, a) => [String(last(a).seg.seq)], explain: "The same sequence number and the same bytes: it is the oldest unacknowledged data, resent from the retransmission queue. SND.NXT does not move." },
      { id: "t5-rtx-ack", prompt: "Which ACK will the Server send once it arrives?", options: opts(String(M.clientIsn + 1 + HELLO.length + WORLD.length), String(M.clientIsn + 1 + HELLO.length + 2 * WORLD.length), String(M.clientIsn + 2 + HELLO.length)), correct: (_b, a) => [String(lastPendingSeg(a)?.ack ?? "")], explain: `${M.clientIsn + 1 + HELLO.length} + ${WORLD.length} = ${M.clientIsn + 1 + HELLO.length + WORLD.length}: the bytes count once, however many times they were sent.` },
    ],
  },
  { id: "t5-ack", short: "Deliver reply", stage: 5, phase: "T5", action: { type: "deliver" }, label: "Deliver the Server's reply" },
  {
    id: "t6", short: "Open to :8443",
    stage: 6,
    phase: "T6",
    action: { type: "connect", conn: "refused" },
    label: `Open a second connection to port ${R.serverPort}`,
    predict: [
      { id: "t6-reply", prompt: `Nothing listens on port ${R.serverPort}, but the Server is up and reachable. What comes back?`, options: opts(["rst", "A reset (RST)"], ["none", "Nothing — the SYN times out"], ["synack", "A SYN-ACK"]), correct: (_b, a) => [lastPendingSeg(a)?.flags.includes("RST") ? "rst" : lastPendingSeg(a) ? "synack" : "none"], explain: "A reachable host whose TCP has no listener on that port answers the SYN with RST,ACK. Silence would mean the SYN (or the reply) was lost — a different problem." },
    ],
  },
  {
    id: "t6-rst", short: "Deliver reply",
    stage: 6,
    phase: "T6",
    action: { type: "deliver" },
    label: "Deliver the Server's reply",
    predict: [
      { id: "t6-ack", prompt: "Calculate the reset's ACK number.", options: opts(String(R.clientIsn + 1), String(R.clientIsn), "0"), correct: (_b, a) => [String(last(a).seg.ack)], explain: `SYN seq + 1 = ${R.clientIsn + 1}: the reset acknowledges exactly the SYN it refuses, so the Laptop can trust it (its sequence number is 0 — no connection exists on the Server).` },
      { id: "t6-state", prompt: "What happens to the Laptop's attempt?", options: opts(["refused", "CLOSED — the application is told “connection refused”"], ["retry", "Stays SYN-SENT and retries"], ["est", "ESTABLISHED"]), correct: (_b, a) => [st(a, "client", "refused")?.error === "refused" ? "refused" : st(a, "client", "refused")?.state === "SYN-SENT" ? "retry" : "est"], explain: "An acceptable RST ends the attempt immediately. No timeout, no retries — the opposite of a lost segment." },
    ],
  },
  { id: "t7-ticket", short: "Open ticket", stage: 7, phase: "T7", action: { type: "fault" }, label: "Open the ticket: “the site never loads”" },
  { id: "t7-syn", short: "Reproduce", stage: 7, phase: "T7", action: { type: "connect", conn: "incident" }, label: "Reproduce: open a new connection to :443" },
  { id: "t7-reply", short: "Deliver reply", stage: 7, phase: "T7", action: { type: "deliver" }, label: "Deliver the Server's reply" },
  { id: "t7-timer", short: "Fire server timer", stage: 7, phase: "T7", action: { type: "timer", host: "server", conn: "incident" }, label: "Let the Server's retransmission timer expire (lab event)" },
  { id: "t8-repair", short: "Apply fix", stage: 8, phase: "T8", action: { type: "repair" }, label: "Apply the selected fix", repair: true },
  {
    id: "t8-v1", short: "Fire server timer",
    stage: 8,
    phase: "T8",
    action: { type: "timer", host: "server", conn: "incident" },
    label: "Verify: let the Server retransmit its SYN-ACK",
    predict: [
      { id: "t8-v1", prompt: "The return path is restored. What happens when the Server's retransmitted SYN-ACK arrives?", options: opts(["est", "The Laptop processes it: SYN-SENT → ESTABLISHED, and sends the ACK"], ["new", "The Laptop ignores it — only a brand-new connection can work"], ["rst", "The Laptop answers with RST"]), correct: (_b, a) => [st(a, "client", "incident")?.state === "ESTABLISHED" ? "est" : "new"], explain: "TCP keeps state: the half-open connection is still waiting, and the retransmitted SYN-ACK (same seq, same ack) completes it." },
    ],
  },
  { id: "t8-v2", short: "Deliver ACK", stage: 8, phase: "T8", action: { type: "deliver" }, label: "Verify: deliver the Laptop's ACK" },
  {
    id: "t8-v3", short: "Send “HELLO”",
    stage: 8,
    phase: "T8",
    action: { type: "send-data", conn: "incident", payload: HELLO },
    label: `Verify: send “${HELLO}” on the recovered connection`,
    predict: [{ id: "t8-v3", prompt: `Sequence number of its first byte?`, options: opts(String(I.clientIsn + 1), String(M.clientIsn + 1), String(I.clientIsn)), correct: (_b, a) => [String(last(a).seg.seq)], explain: `This connection's ISN is ${I.clientIsn}, so its first data byte is ${I.clientIsn + 1}. Every connection has its own sequence space.` }],
  },
  { id: "t8-v4", short: "Deliver ACK", stage: 8, phase: "T8", action: { type: "deliver" }, label: "Verify: deliver the Server's ACK" },
];

export const TCP_LAB_REPAIR_INDEX = TCP_LAB_SCRIPT.findIndex((s) => s.repair);

export function tcpRevealFor(step: TcpScriptStep, before: TcpLabState): Record<string, string[]> {
  if (!step.predict) return {};
  const after = tcpLabDryRun(before, step.action);
  return Object.fromEntries(step.predict.map((p) => [p.id, p.correct(before, after)]));
}

// ---------------------------------------------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------------------------------------------
export interface TcpBoardCtx {
  lab: TcpLabState;
  /** State before the latest action (for "what changed"). */
  before?: TcpLabState;
  /** Inspected after the latest event? (`dev:<node>`, `card:<host>`, `pkt:<no>`, `cap:<point>`) */
  seen: (key: string) => boolean;
  seenSince: (fromSeq: number, key: string) => boolean;
  answer: (key: string) => string[];
  onAnswer: (key: string, v: string[]) => void;
  onInspectDevice: (id: TcpLabNode) => void;
  onInspectSegment: (no: number) => void;
  onViewCapture: (v: TcpCaptureView) => void;
  /** Incident not yet proven: hide where its segments stopped. */
  concealFault: boolean;
}

const cardOf = (x: TcpBoardCtx, h: TcpHost) => x.seen(`card:${h}`) || x.seen(`dev:${h === "client" ? "laptop" : "server"}`);
const openHost = (x: TcpBoardCtx, h: TcpHost) => ({ label: `open ${hostName(h)}`, onClick: () => x.onInspectDevice(h === "client" ? "laptop" : "server") });
const openSeg = (x: TcpBoardCtx, no: number | undefined) => (no ? { label: `open segment #${no}`, onClick: () => x.onInspectSegment(no) } : undefined);
const viewCap = (x: TcpBoardCtx, v: TcpCaptureView, label: string) => ({ label, onClick: () => x.onViewCapture(v) });
const recNo = (x: TcpBoardCtx, pred: (r: TcpCaptureRecord) => boolean) => [...x.lab.capture].reverse().find(pred)?.no;

interface IdentifyDef {
  id: string;
  prompt: string;
  options: PredictionOption[];
  correct: string[];
}
const answered = (x: TcpBoardCtx, q: IdentifyDef) => {
  const v = x.answer(`${x.lab.seq}|${q.id}`);
  return v.length > 0 && sameSet(v, q.correct);
};

interface StepCopy {
  title: string;
  summary: ReactNode;
  key: ReactNode;
  checks?: (x: TcpBoardCtx) => { facts: EngineerCheckFact[]; identify?: IdentifyDef[] };
  deepen?: { q: string; a: ReactNode }[];
}

const COPY: Record<string, StepCopy> = {
  t1: {
    title: "SYN: the Laptop asks to synchronise",
    summary: `The Laptop created its side of the connection ${epText({ ip: "192.168.10.10", port: M.clientPort })} ↔ 10.20.20.20:${M.serverPort}, sent a SYN with seq ${M.clientIsn}, and is now SYN-SENT.`,
    key: (
      <>
        <b>A SYN consumes one sequence number.</b> The SYN carries seq {M.clientIsn} and no data, yet the Laptop&apos;s SND.NXT is already {M.clientIsn + 1}. Sequence numbers count positions in the byte stream (the SYN occupies one), not packets.
      </>
    ),
    checks: (x) => {
      const n = recNo(x, (r) => r.conn === "main" && r.seg.flags.join() === "SYN");
      const c = st(x.lab, "client", "main");
      return {
        facts: [
          { id: "syn-pkt", text: "Open the SYN: which seq, and is the ACK field valid?", provenText: `seq ${M.clientIsn}, flags SYN, ACK field not valid (ACK flag clear).`, proven: !!n && x.seen(`pkt:${n}`), action: openSeg(x, n) },
          { id: "syn-card", text: "Check the Laptop's socket: what is SND.NXT now?", provenText: `SYN-SENT · SND.NXT ${c?.sndNxt} — the SYN used ${M.clientIsn}.`, proven: cardOf(x, "client") && c?.sndNxt === M.clientIsn + 1, action: openHost(x, "client") },
        ],
      };
    },
    deepen: [{ q: "Why didn't SW1 or R1 change state?", a: "They forward the frame (R1 rewrites the Ethernet header and decrements the TTL) but never read TCP ports or sequence numbers. TCP state lives only in the two endpoints." }],
  },
  t2: {
    title: "SYN-ACK: acknowledge, and synchronise the other direction",
    summary: `The Server had answered the SYN at once — it created its own connection in SYN-RECEIVED. Its SYN-ACK (seq ${M.serverIsn}, ack ${M.clientIsn + 1}) reached the Laptop, which is now ESTABLISHED.`,
    key: (
      <>
        <b>ACK = client ISN + 1 = {M.clientIsn + 1}.</b> “I have everything up to {M.clientIsn}; send {M.clientIsn + 1} next.” The SYN-ACK also carries the Server&apos;s own ISN, {M.serverIsn}. The Laptop is ESTABLISHED before the Server is — each endpoint moves when it processes a segment.
      </>
    ),
    checks: (x) => {
      const n = recNo(x, (r) => r.conn === "main" && r.seg.flags.join() === "SYN,ACK");
      const q: IdentifyDef = {
        id: "t2-why",
        prompt: `Identify: why is the ACK ${M.clientIsn + 1}?`,
        options: opts(["isn", `Laptop's ISN ${M.clientIsn} + 1 — its SYN used ${M.clientIsn}`], ["count", "It is the first packet the Server received, plus 100"], ["server", "It is the Server's own ISN"]),
        correct: ["isn"],
      };
      return {
        identify: [q],
        facts: [
          { id: "synack-pkt", text: "Open the SYN-ACK and identify why its ACK is what it is", provenText: `seq ${M.serverIsn} (Server ISN), ack ${M.clientIsn + 1} (= ${M.clientIsn} + 1).`, proven: !!n && x.seen(`pkt:${n}`) && answered(x, q), action: openSeg(x, n) },
          { id: "synack-states", text: "Check both sockets: are the endpoints in the same state?", provenText: "No: Laptop ESTABLISHED, Server still SYN-RECEIVED.", proven: cardOf(x, "client") && cardOf(x, "server") && st(x.lab, "client", "main")?.state === "ESTABLISHED" && st(x.lab, "server", "main")?.state === "SYN-RECEIVED", action: openHost(x, cardOf(x, "client") ? "server" : "client") },
        ],
      };
    },
  },
  t3: {
    title: "ACK: the Server's SYN is acknowledged",
    summary: `The Laptop's ACK (seq ${M.clientIsn + 1}, ack ${M.serverIsn + 1}) reached the Server, which moved SYN-RECEIVED → ESTABLISHED.`,
    key: "Both sequence spaces are now synchronised: each side knows the other's ISN and has had its own SYN acknowledged. That — not “three packets” — is what ESTABLISHED means.",
    checks: (x) => ({
      facts: [{ id: "est", text: "Check both sockets: what does each endpoint expect next?", provenText: `Laptop RCV.NXT ${st(x.lab, "client", "main")?.rcvNxt} · Server RCV.NXT ${st(x.lab, "server", "main")?.rcvNxt} — both ESTABLISHED.`, proven: cardOf(x, "client") && cardOf(x, "server") && st(x.lab, "server", "main")?.state === "ESTABLISHED", action: openHost(x, cardOf(x, "client") ? "server" : "client") }],
    }),
    deepen: [{ q: "Is the handshake a security check?", a: "No. It synchronises sequence numbers and proves both directions work. Authentication and encryption come later, from TLS." }],
  },
  t4: {
    title: `Data: ${HELLO.length} bytes occupy ${HELLO.length} sequence numbers`,
    summary: `The Laptop sent “${HELLO}” as bytes ${M.clientIsn + 1}–${M.clientIsn + HELLO.length}. The Server delivered them to the application and now expects byte ${M.clientIsn + 1 + HELLO.length}.`,
    key: (
      <>
        <b>Sequence numbers track bytes.</b> seq {M.clientIsn + 1} + {HELLO.length} bytes → the Server&apos;s RCV.NXT becomes {M.clientIsn + 1 + HELLO.length}, and that is the ACK it will send. Not {M.clientIsn + 2}: a segment is not “one more”.
      </>
    ),
    checks: (x) => {
      const n = recNo(x, (r) => r.conn === "main" && r.seg.payload === HELLO);
      const q: IdentifyDef = { id: "t4-mean", prompt: `Identify: what will “ACK ${M.clientIsn + 1 + HELLO.length}” tell the Laptop?`, options: opts(["next", `Bytes up to ${M.clientIsn + HELLO.length} arrived; send ${M.clientIsn + 1 + HELLO.length} next`], ["pkt", `Packet number ${M.clientIsn + 1 + HELLO.length} arrived`], ["count", `${M.clientIsn + 1 + HELLO.length} bytes arrived`]), correct: ["next"] };
      return {
        identify: [q],
        facts: [{ id: "data", text: "Open the data segment and the Server's socket", provenText: `seq ${M.clientIsn + 1}, ${HELLO.length} bytes · Server RCV.NXT ${st(x.lab, "server", "main")?.rcvNxt}.`, proven: !!n && x.seen(`pkt:${n}`) && cardOf(x, "server") && answered(x, q), action: x.seen(`pkt:${n}`) ? openHost(x, "server") : openSeg(x, n) }],
      };
    },
  },
  "t4-ack": {
    title: "The ACK moves the Laptop's SND.UNA",
    summary: `The Server's ACK ${M.clientIsn + 1 + HELLO.length} arrived: nothing the Laptop sent is unacknowledged any more.`,
    key: "The Laptop kept a copy of “HELLO” until this ACK arrived. That retained copy is what makes recovery possible if a segment is lost.",
    checks: (x) => ({ facts: [{ id: "una", text: "Check the Laptop's socket: SND.UNA and SND.NXT", provenText: `SND.UNA ${st(x.lab, "client", "main")?.sndUna} = SND.NXT ${st(x.lab, "client", "main")?.sndNxt}: everything sent is acknowledged.`, proven: cardOf(x, "client") && st(x.lab, "client", "main")?.sndUna === st(x.lab, "client", "main")?.sndNxt, action: openHost(x, "client") }] }),
  },
  t5: {
    title: "Lost on the way: nothing changes at the receiver",
    summary: `The Laptop sent “${WORLD}” (seq ${M.clientIsn + 1 + HELLO.length}) and moved SND.NXT to ${M.clientIsn + 1 + HELLO.length + WORLD.length}. The lab dropped it at R1, so the Server never saw it.`,
    key: "The receiver's state is untouched and no ACK exists for these bytes. The sender still holds them as unacknowledged — that state, not the network, is what will recover them.",
    checks: (x) => {
      const n = recNo(x, (r) => r.conn === "main" && r.seg.payload === WORLD);
      return {
        facts: [
          { id: "cap-l", text: "Capture at the Laptop: did it send the segment?", provenText: `Yes — #${n} seq ${M.clientIsn + 1 + HELLO.length}, ${WORLD.length} bytes, out.`, proven: x.seen("cap:laptop"), action: viewCap(x, "laptop", "view Laptop capture") },
          { id: "cap-s", text: "Capture at the Server: did it arrive?", provenText: "No — the Server's capture has no such segment.", proven: x.seen("cap:server"), action: viewCap(x, "server", "view Server capture") },
          { id: "rcv", text: "Server socket: did RCV.NXT move?", provenText: `No — still ${st(x.lab, "server", "main")?.rcvNxt}.`, proven: cardOf(x, "server") && st(x.lab, "server", "main")?.rcvNxt === M.clientIsn + 1 + HELLO.length, action: openHost(x, "server") },
        ],
      };
    },
  },
  "t5-rtx": {
    title: "Retransmission: the same bytes, the same sequence number",
    summary: `The Laptop's retransmission timer expired (a lab event) and it resent seq ${M.clientIsn + 1 + HELLO.length}, “${WORLD}”, from its retransmission queue. This copy arrived; the Server's RCV.NXT moved once, to ${M.clientIsn + 1 + HELLO.length + WORLD.length}.`,
    key: "Reliability = endpoint state + acknowledgments + retransmission. Ethernet and IP never resend anything; TCP at the Laptop did, because it remembered which bytes were unacknowledged.",
    checks: (x) => {
      const n = recNo(x, (r) => r.conn === "main" && r.retransmission);
      return { facts: [{ id: "rtx", text: "Open the retransmission and the Server's socket", provenText: `#${n}: seq ${M.clientIsn + 1 + HELLO.length}, same ${WORLD.length} bytes · Server RCV.NXT ${st(x.lab, "server", "main")?.rcvNxt}.`, proven: !!n && x.seen(`pkt:${n}`) && cardOf(x, "server"), action: x.seen(`pkt:${n}`) ? openHost(x, "server") : openSeg(x, n) }] };
    },
    deepen: [{ q: "How long is the retransmission timer?", a: "Real stacks compute it from measured round-trip times and back off after each retry. The lab makes it a button so you control when it fires — no timer value here is a TCP constant." }],
  },
  "t5-ack": {
    title: "Recovered",
    summary: `ACK ${M.clientIsn + 1 + HELLO.length + WORLD.length} arrived. The Server's application received “${HELLO}${WORLD}” — in order, once.`,
    key: "From the application's point of view nothing was lost: TCP hid the loss behind state and retransmission.",
  },
  t6: {
    title: "A SYN to a closed port",
    summary: `The Laptop opened ${epText({ ip: "192.168.10.10", port: R.clientPort })} → :${R.serverPort} (lab ISN ${R.clientIsn}). The Server received the SYN, found no listener, created no connection and queued a reset.`,
    key: "The Server's TCP stack answers — not an application. There is no socket on that port to hand the SYN to.",
    checks: (x) => ({ facts: [{ id: "nolisten", text: "Server sockets: was a connection created?", provenText: `No — only the listener on :${M.serverPort} (and the HTTPS connection). Nothing for :${R.serverPort}.`, proven: cardOf(x, "server") && !st(x.lab, "server", "refused"), action: openHost(x, "server") }] }),
  },
  "t6-rst": {
    title: "Refused ≠ lost",
    summary: `The RST,ACK (seq 0, ack ${R.clientIsn + 1}) reached the Laptop, which closed the attempt at once: “connection refused”.`,
    key: (
      <>
        <span className="block">
          <b>Loss (T5):</b> silence → the sender waits → retransmits → eventually times out.
        </span>
        <span className="block">
          <b>Refused (T6):</b> an immediate RST from a reachable host → no retries.
        </span>
        <span className="mt-1 block text-pv-text-muted">A timeout is not a refusal, and a RST is not a timeout.</span>
      </>
    ),
    checks: (x) => {
      const n = recNo(x, (r) => r.seg.flags.includes("RST"));
      return { facts: [{ id: "rst", text: "Open the reset and the Laptop's socket", provenText: `RST,ACK seq 0 ack ${R.clientIsn + 1} · Laptop attempt CLOSED (refused).`, proven: !!n && x.seen(`pkt:${n}`) && cardOf(x, "client") && st(x.lab, "client", "refused")?.error === "refused", action: x.seen(`pkt:${n}`) ? openHost(x, "client") : openSeg(x, n) }] };
    },
  },
  "t7-ticket": { title: "Ticket: “the site never loads”", summary: "Users can't open the site. No error message, the browser just keeps spinning. Reproduce it before changing anything.", key: "Reproduce first: a fresh connection attempt gives you evidence at every capture point." },
  "t7-syn": { title: "Reproducing: a new connection to :443", summary: `The Laptop opened ${epText({ ip: "192.168.10.10", port: I.clientPort })} → :${I.serverPort} (lab ISN ${I.clientIsn}) and is SYN-SENT.`, key: "So far this looks exactly like T1." },
  "t7-reply": { title: "Waiting…", summary: "The Server's reply was sent. The Laptop has not received anything — it is still SYN-SENT.", key: "No RST, no error: just nothing." },
};

// ---------------------------------------------------------------------------------------------------------------
// Event rows and deltas — built from the latest record and the endpoints' state change.
// ---------------------------------------------------------------------------------------------------------------
function eventRows(x: TcpBoardCtx): TeachingEventRowDef[] {
  const { lab } = x;
  const ev = lab.last;
  if (!ev) return [];
  if (ev.type === "noop") return [{ who: "Lab", body: ev.reason }];
  if (ev.type === "fault") return [{ who: "Ticket", tone: "attention", body: "“The site never loads.” Something on the network changed — you don't know what. Reproduce it." }];
  if (ev.type === "repair") return [{ who: "Repair", tone: "attention", body: "R1 forwards Server → Laptop TCP again. No TCP state changed: the Laptop is still SYN-SENT and the Server still SYN-RECEIVED until a segment proves the path." }];
  const r = lab.capture[ev.no - 1];
  if (!r) return [];
  const g = r.seg;
  const from: TcpHost = r.dir === "c2s" ? "client" : "server";
  const to: TcpHost = from === "client" ? "server" : "client";
  const rows: TeachingEventRowDef[] = [{ who: hostName(from), body: `sent ${flagText(g.flags)} seq=${g.seq}${g.ack !== undefined ? ` ack=${g.ack}` : ""}${g.payload ? `, ${g.payload.length} bytes “${g.payload}”` : ""} · ${epText(g.src)} → ${epText(g.dst)}${r.retransmission ? " — a retransmission of the same bytes" : ""}.` }];
  const hidden = x.concealFault && r.drop?.reason === "return-path-fault";
  if (r.outcome === "delivered") rows.push({ who: "SW1 · R1", tone: "device", body: "forwarded it. R1 built a new Ethernet header and decremented the TTL (64 → 63); neither reads TCP ports, flags or sequence numbers." });
  else if (!hidden) rows.push({ who: "R1", tone: "attention", body: r.drop?.reason === "lab-loss" ? "dropped it (lab-injected loss)." : "dropped it: the return-path fault drops TCP from the Server toward the Laptop." });
  const b = x.before;
  const tb = b ? tcbFor(b, to, r.conn) : undefined;
  const ta = tcbFor(lab, to, r.conn);
  if (r.outcome === "dropped") rows.push({ who: hostName(to), tone: "attention", body: hidden ? `received nothing${ta ? ` — still ${ta.state}` : ""}.` : `never received it — its state is unchanged${ta?.rcvNxt !== undefined ? ` (RCV.NXT ${ta.rcvNxt})` : ""}.` });
  else {
    const bits: string[] = [];
    if (!tb && ta) bits.push(`created a connection in ${ta.state}`);
    if (tb && ta && tb.state !== ta.state) bits.push(`${tb.state} → ${ta.state}${ta.error === "refused" ? " (connection refused)" : ""}`);
    if (ta?.rcvNxt !== undefined && tb?.rcvNxt !== ta.rcvNxt) bits.push(tb?.rcvNxt === undefined ? `learned the peer's ISN ${ta.irs}: RCV.NXT = ${ta.rcvNxt}` : `RCV.NXT ${tb.rcvNxt} → ${ta.rcvNxt}`);
    if (ta?.sndUna !== undefined && tb?.sndUna !== undefined && tb.sndUna !== ta.sndUna) bits.push(`SND.UNA ${tb.sndUna} → ${ta.sndUna}`);
    if (g.payload && ta && ta.delivered.length > (tb?.delivered.length ?? 0)) bits.push(`delivered “${g.payload}” to the application`);
    if (!ta && g.flags.includes("SYN") && !g.flags.includes("ACK")) bits.push(`has no listener on port ${g.dst.port} — created no connection`);
    const reply = lab.pending.find((p) => p.from === to && p.conn === r.conn)?.seg;
    if (reply && !(b?.pending ?? []).some((p) => p.seg === reply)) bits.push(`queued its reply: ${flagText(reply.flags)} seq=${reply.seq}${reply.ack !== undefined ? ` ack=${reply.ack}` : ""}`);
    rows.push({ who: hostName(to), tone: "result", body: bits.length ? `${bits.join("; ")}.` : "accepted it — nothing new to change." });
  }
  return rows;
}

function deltas(x: TcpBoardCtx): StateDelta[] {
  const { lab, before } = x;
  const conn: TcpConnId | undefined = lab.last?.type === "send" ? lab.capture[lab.last.no - 1]?.conn : undefined;
  return (["client", "server"] as TcpHost[]).map((h) => {
    const label = `${hostName(h)} TCP`;
    if (!conn) return { label, count: 0, text: "UNCHANGED" };
    const a = tcbFor(lab, h, conn);
    const b = before ? tcbFor(before, h, conn) : undefined;
    if (!a) return { label, count: 0, text: "NO CONNECTION" };
    if (!b) return { label, count: 1, text: `NEW · ${a.state}` };
    const changed = a.state !== b.state || a.rcvNxt !== b.rcvNxt || a.sndNxt !== b.sndNxt || a.sndUna !== b.sndUna;
    return { label, count: changed ? 1 : 0, text: a.state !== b.state ? `${b.state} → ${a.state}` : changed ? "NUMBERS MOVED" : "UNCHANGED" };
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Incident: symptom → observation → evidence → hypothesis → test → root cause
// ---------------------------------------------------------------------------------------------------------------
const HYPOTHESES: PredictionOption[] = opts(
  ["closed", `Nothing listens on port ${I.serverPort} — the connection is refused`],
  ["app", "The Server's web application crashed"],
  ["ack", "The Laptop computed a wrong ACK number"],
  ["return", "Segments from the Server to the Laptop are lost on the way back (return path)"],
  ["syn", "The Laptop's SYN never reached the Server"],
);
const HYP_FEEDBACK: Record<string, string> = {
  closed: "A closed port is answered at once with RST, and the Server creates no connection. Here no RST arrived, and the Server holds a SYN-RECEIVED connection.",
  app: "The handshake is done by the Server's TCP stack, and it did answer the SYN. An application failure would show up after ESTABLISHED, not as a missing SYN-ACK.",
  ack: "The Laptop never received a SYN-ACK, so it never computed an ACK at all.",
  syn: "The Server's capture shows the SYN arriving, and the Server created a SYN-RECEIVED connection for it.",
};
const TESTS: PredictionOption[] = opts(
  ["state", "The Laptop is SYN-SENT while the Server is SYN-RECEIVED"],
  ["proof", "The SYN-ACK is in the Server capture and arrives on R1's Server side, but never leaves R1's LAN side and never reaches the Laptop"],
  ["norst", "No RST came back"],
);
const TEST_FEEDBACK: Record<string, string> = {
  state: "True and consistent with the hypothesis — but it doesn't show WHERE the SYN-ACK stops.",
  norst: "That rules out a refused port, not the location of the loss.",
};

export function tcpIncidentEvidence(x: TcpBoardCtx): EngineerCheckFact[] {
  const from = x.lab.capture.find((r) => r.conn === "incident")?.action ?? x.lab.seq;
  const since = (k: string) => x.seenSince(from, k);
  const c = st(x.lab, "client", "incident");
  const s = st(x.lab, "server", "incident");
  const synAcks = x.lab.capture.filter((r) => r.conn === "incident" && r.dir === "s2c").length;
  return [
    { id: "e-client", text: "What state is the Laptop's new connection in? — Laptop socket", provenText: `${c?.state}: it has never processed a SYN-ACK.`, proven: since("card:client") || since("dev:laptop"), action: openHost(x, "client") },
    { id: "e-server", text: "Did the Server get the SYN? — Server socket", provenText: `Yes: the Server holds the connection in ${s?.state} and is waiting for its SYN-ACK to be acknowledged.`, proven: since("card:server") || since("dev:server"), action: openHost(x, "server") },
    { id: "e-cap-server", text: "Did the Server send a SYN-ACK? — Server capture", provenText: `Yes: ${synAcks} SYN-ACK${synAcks === 1 ? "" : "s"} (seq ${I.serverIsn}, ack ${I.clientIsn + 1}) went out.`, proven: since("cap:server"), action: viewCap(x, "server", "view Server capture") },
    { id: "e-cap-laptop", text: "Did anything come back to the Laptop? — Laptop capture", provenText: "No SYN-ACK and no RST ever arrived at the Laptop.", proven: since("cap:laptop"), action: viewCap(x, "laptop", "view Laptop capture") },
    { id: "e-cap-r1", text: "Where does the SYN-ACK stop? — R1's captures, both interfaces", provenText: "It arrives on R1's Server side and never leaves on R1's LAN side.", proven: since("cap:r1-server") && since("cap:r1-lan"), action: viewCap(x, since("cap:r1-server") ? "r1-lan" : "r1-server", "view R1 capture") },
  ];
}

export function tcpIncidentSolved(x: TcpBoardCtx): boolean {
  return tcpIncidentEvidence(x).every((f) => f.proven) && x.lab.returnPathFault && sameSet(x.answer("incident|hypothesis"), ["return"]) && sameSet(x.answer("incident|test"), ["proof"]);
}

function Incident({ x }: { x: TcpBoardCtx }) {
  const evidence = tcpIncidentEvidence(x);
  const gathered = evidence.filter((f) => f.proven).length;
  const hyp = x.answer("incident|hypothesis");
  const test = x.answer("incident|test");
  const hypOk = sameSet(hyp, ["return"]);
  const testOk = sameSet(test, ["proof"]);
  return (
    <>
      <BoardSection label="Symptom" tone="cyan">
        <p className="text-[12.5px] leading-snug text-pv-text-muted">The new connection never opens: the Laptop sent a SYN and is still waiting. No error, no reset — the browser just spins.</p>
      </BoardSection>
      <BoardSection label="Observation">
        <p className="text-[12.5px] leading-snug text-pv-text-muted">The Server&apos;s retransmission timer fired and it resent something — yet the Laptop is still waiting. Don&apos;t guess: find how far the conversation got.</p>
      </BoardSection>
      <EngineerCheck intro="Evidence — each item needs a real inspection (a socket, a capture point):" facts={evidence} footnote="Gather at least three pieces of evidence to unlock the hypothesis." />
      {gathered >= 3 && (
        <PredictionBlock label="Hypothesis" prompt="What is the root cause?" options={HYPOTHESES} value={hyp} onChange={(v) => x.onAnswer("incident|hypothesis", v)} verdict={hyp.length ? <Verdict correct={hypOk}>{hypOk ? "Consistent with the evidence. Now test it: which observation proves it?" : (HYP_FEEDBACK[hyp[0]] ?? "That doesn't fit the evidence.")}</Verdict> : undefined} />
      )}
      {hypOk && (
        <PredictionBlock label="Test" prompt="Which observation proves it — including where?" options={TESTS} value={test} onChange={(v) => x.onAnswer("incident|test", v)} verdict={test.length ? <Verdict correct={testOk}>{testOk ? "That's the proof: forward progress stops inside R1, on the way back." : TEST_FEEDBACK[test[0]]}</Verdict> : undefined} />
      )}
      {tcpIncidentSolved(x) && (
        <KeyLesson>
          <b>Root cause — return-path loss at R1.</b> SYN left the Laptop ✓ → reached the Server ✓ (SYN-RECEIVED) → Server sent SYN-ACK ✓ (and retransmitted it) → SYN-ACK reached R1&apos;s Server side ✓ → never left R1&apos;s LAN side ✗ → the Laptop never processed a SYN-ACK and stays SYN-SENT.
          <span className="mt-1 block text-pv-text-muted">Not a refused port (no RST), not the application (the handshake never completed), not ACK arithmetic (there was no SYN-ACK to answer).</span>
        </KeyLesson>
      )}
    </>
  );
}

export const TCP_REPAIRS: PredictionOption[] = opts(["open-port", `Open TCP port ${I.serverPort} on the Server`], ["restart-app", "Restart the Server's web application"], ["r1", "Restore R1's return path (Server → Laptop)"], ["isn", "Change the Laptop's initial sequence number"], ["arp", "Clear the Laptop's ARP cache"]);
export const TCP_REPAIR_CORRECT = "r1";
const REPAIR_FEEDBACK: Record<string, string> = {
  "open-port": `Port ${I.serverPort} is already open: the Server created a SYN-RECEIVED connection and answered. Nothing changes.`,
  "restart-app": "The application isn't involved yet — the Server's TCP answered the SYN. Restarting it doesn't touch R1; the SYN-ACKs would still be lost.",
  isn: `The ISN was acknowledged correctly (ack ${I.clientIsn + 1}). The reply still never reaches the Laptop.`,
  arp: "The Laptop's SYN reached the Server, so ARP and the forward path work. The loss is on the way back.",
};

function RepairChoice({ x, tried }: { x: TcpBoardCtx; tried?: string }) {
  return (
    <>
      <PredictionBlock label="Repair" prompt="Choose the change that fixes the cause you proved." options={TCP_REPAIRS} value={x.answer("repair-choice")} onChange={(v) => x.onAnswer("repair-choice", v)} />
      {tried && tried !== TCP_REPAIR_CORRECT && <Verdict correct={false}>{REPAIR_FEEDBACK[tried]} Pick again.</Verdict>}
    </>
  );
}

/** Repair verified by traffic: SYN-ACK delivered, both ESTABLISHED, data acknowledged on the recovered connection. */
export function tcpRepairVerified(s: TcpLabState): boolean {
  const c = st(s, "client", "incident");
  const sv = st(s, "server", "incident");
  return !s.returnPathFault && c?.state === "ESTABLISHED" && sv?.state === "ESTABLISHED" && sv.delivered === HELLO && c.sndUna === c.sndNxt && s.capture.some((r) => r.conn === "incident" && r.dir === "s2c" && r.outcome === "delivered" && r.seg.flags.includes("SYN"));
}

const VERIFY_COPY: Record<string, StepCopy> = {
  "t8-repair": { title: "Path restored — not yet verified", summary: "R1 forwards Server → Laptop TCP again. Nothing in TCP has changed: the connection is still half-open.", key: "A repair is a hypothesis about the fix. Traffic proves it." },
  "t8-v1": {
    title: "The retransmitted SYN-ACK gets through",
    summary: `The Server's SYN-ACK (seq ${I.serverIsn}, ack ${I.clientIsn + 1}) reached the Laptop this time: SYN-SENT → ESTABLISHED, ACK queued.`,
    key: "The half-open connection recovered by itself, through TCP's own retransmission — because both endpoints kept their state.",
    checks: (x) => ({ facts: [{ id: "lap-cap", text: "Laptop capture: does the SYN-ACK arrive now?", provenText: "Yes — the SYN-ACK is in the Laptop's capture.", proven: x.seen("cap:laptop"), action: viewCap(x, "laptop", "view Laptop capture") }] }),
  },
  "t8-v2": {
    title: "Both endpoints ESTABLISHED",
    summary: `The Laptop's ACK (seq ${I.clientIsn + 1}, ack ${I.serverIsn + 1}) reached the Server: SYN-RECEIVED → ESTABLISHED.`,
    key: "The handshake completed across the repaired path. One more proof: does it carry data?",
    checks: (x) => ({ facts: [{ id: "both", text: "Check both sockets of the recovered connection", provenText: "Laptop ESTABLISHED · Server ESTABLISHED.", proven: cardOf(x, "client") && cardOf(x, "server") && st(x.lab, "server", "incident")?.state === "ESTABLISHED", action: openHost(x, cardOf(x, "client") ? "server" : "client") }] }),
  },
  "t8-v3": { title: "Data on the recovered connection", summary: `“${HELLO}” occupies bytes ${I.clientIsn + 1}–${I.clientIsn + HELLO.length} of this connection's own sequence space.`, key: "Each connection has its own ISN and its own numbers." },
  "t8-v4": {
    title: "Verified",
    summary: `ACK ${I.clientIsn + 1 + HELLO.length} returned through R1: the Laptop's data was delivered and acknowledged across the repaired path.`,
    key: "Verified by traffic and state: SYN-ACK delivered, both ESTABLISHED, data acknowledged.",
    checks: (x) => ({ facts: [{ id: "final", text: "Laptop capture and the Server socket: is the data acknowledged?", provenText: `Server delivered “${HELLO}”; Laptop SND.UNA = SND.NXT = ${st(x.lab, "client", "incident")?.sndNxt}.`, proven: x.seen("cap:laptop") && cardOf(x, "server") && tcpRepairVerified(x.lab), action: x.seen("cap:laptop") ? openHost(x, "server") : viewCap(x, "laptop", "view Laptop capture") }] }),
  },
};
const copyFor = (id: string) => COPY[id] ?? VERIFY_COPY[id];

export function tcpStepChecksDone(stepId: string, x: TcpBoardCtx): boolean {
  if (stepId === "t7-timer") return tcpIncidentSolved(x);
  const c = copyFor(stepId)?.checks?.(x);
  return !c || c.facts.every((f) => f.proven);
}

function IdentifyBlock({ x, q }: { x: TcpBoardCtx; q: IdentifyDef }) {
  const key = `${x.lab.seq}|${q.id}`;
  const v = x.answer(key);
  const ok = sameSet(v, q.correct);
  return <PredictionBlock label="Identify" prompt={q.prompt} options={q.options} value={v} onChange={(nv) => x.onAnswer(key, nv)} verdict={v.length ? <Verdict correct={ok}>{ok ? "Exactly." : "Look at the numbers again."}</Verdict> : undefined} />;
}

export interface TcpLabBoardProps extends TcpBoardCtx {
  revealed: Record<string, string[]>;
  cursor: number;
  freePlay: boolean;
  inFlight: boolean;
  gate?: string;
  repairTried?: string;
}

export function TcpLabBoard(props: TcpLabBoardProps) {
  const { lab, cursor, freePlay, inFlight } = props;
  const prev = cursor > 0 ? TCP_LAB_SCRIPT[cursor - 1] : undefined;
  const next = !freePlay ? TCP_LAB_SCRIPT[cursor] : undefined;
  const copy = !freePlay && prev ? copyFor(prev.id) : undefined;
  const incident = !freePlay && prev?.id === "t7-timer";

  if (inFlight)
    return (
      <TeachingBoard phase={`${prev?.phase ?? "T0"} · in flight`} title="Segment in flight" summary="SW1 and R1 forward it; only the receiving endpoint will process the TCP header.">
        <BoardSection label="What happened so far" tone="cyan">
          <TeachingEventRows rows={eventRows(props).slice(0, 1)} />
        </BoardSection>
      </TeachingBoard>
    );

  const checks = copy?.checks?.(props);
  const verdicts = !freePlay && prev?.predict ? prev.predict.map((p) => ({ p, ans: props.answer(p.id), ok: sameSet(props.answer(p.id), props.revealed[p.id] ?? []) })) : [];
  const verdictList = verdicts.map(({ p, ans, ok }) => (
    <Verdict key={p.id} correct={ok}>
      <span className="font-semibold text-pv-text">{p.prompt}</span> You said: {ans.map((a) => p.options.find((o) => o.id === a)?.label ?? a).join(", ") || "—"}. {p.explain}
    </Verdict>
  ));
  const t0Facts: EngineerCheckFact[] = [{ id: "t0", text: "Inspect the Server's sockets: is there a connection yet?", provenText: `No — only a listening socket on :${M.serverPort}. The Laptop has no socket for it either.`, proven: cardOf(props, "server") && lab.sockets.server.length === 1 && lab.sockets.client.length === 0, action: openHost(props, "server") }];

  return (
    <TeachingBoard
      phase={freePlay ? "Free play" : `${prev?.phase ?? "T0"} · ${TCP_LAB_STAGES[prev?.stage ?? 0]}`}
      title={freePlay ? (lab.last ? "What just happened" : "Free play") : incident ? "Incident: the connection never opens" : (copy?.title ?? "Before the first segment")}
      summary={
        freePlay
          ? "Open connections, send data, drop a segment, fire retransmission timers, break or repair the return path. Verify with sockets and captures."
          : incident
            ? "Reproduced. Now troubleshoot from evidence: observe → evidence → hypothesis → test → root cause."
            : (copy?.summary ?? `The Server listens on TCP ${M.serverPort}. The Laptop (192.168.10.10) wants an HTTPS connection to 10.20.20.20:${M.serverPort} from its ephemeral port ${M.clientPort}. ISNs in this lab: Laptop ${M.clientIsn}, Server ${M.serverIsn}.`)
      }
    >
      {!prev && !freePlay && (
        <>
          <BoardSection label="The connection's identity" tone="cyan">
            <p className="pv-mono text-[12px] text-pv-text">
              TCP · 192.168.10.10:{M.clientPort} ↔ 10.20.20.20:{M.serverPort}
            </p>
            <p className="mt-1 text-[11.5px] text-pv-text-muted">Protocol + both IP addresses + both ports identify one connection. The Laptop is the client (it opens); the Server is the server (it listens).</p>
          </BoardSection>
          <PredictionBlock
            prompt="What must happen before any application data can be exchanged?"
            options={opts(["hs", "Both endpoints synchronise sequence numbers (the handshake)"], ["none", "Nothing — the Laptop can send HTTPS data straight away"], ["arp", "Another ARP exchange with the Server"])}
            value={props.answer("t0")}
            onChange={(v) => props.onAnswer("t0", v)}
            verdict={props.answer("t0").length ? <Verdict correct={props.answer("t0")[0] === "hs"}>TCP data is numbered relative to each side&apos;s ISN, so both sides must learn the other&apos;s ISN first. ARP is already done — the Server is not on the Laptop&apos;s subnet anyway.</Verdict> : undefined}
          />
          <EngineerCheck intro="Prove it from the live state:" facts={t0Facts} />
        </>
      )}

      {incident && (
        <>
          {verdictList}
          <Incident x={props} />
        </>
      )}

      {!incident && lab.last && (prev || freePlay) && (
        <>
          <BoardSection label="What happened" tone="cyan">
            <TeachingEventRows rows={eventRows(props)} />
          </BoardSection>
          <BoardSection label="What changed">
            <StateDeltaChips deltas={deltas(props)} />
          </BoardSection>
          {verdictList}
          {copy && <KeyLesson>{copy.key}</KeyLesson>}
          {checks && (
            <>
              {checks.identify?.map((q) => (
                <IdentifyBlock key={q.id} x={props} q={q} />
              ))}
              <EngineerCheck intro="Verify it — sockets, segment fields and captures:" facts={checks.facts} />
            </>
          )}
        </>
      )}

      {next?.repair && <RepairChoice x={props} tried={props.repairTried} />}
      {next?.predict?.map((p) => (
        <PredictionBlock key={p.id} prompt={p.prompt} options={p.options} value={props.answer(p.id)} onChange={(v) => props.onAnswer(p.id, v)} />
      ))}
      {next && <NextAction>{props.gate ?? `${next.label}.`}</NextAction>}
      {!next && !freePlay && <NextAction>Guided steps complete — continue in free play.</NextAction>}
      {freePlay && <NextAction>Pick an action below the topology.</NextAction>}
      {incident ? (
        <DeepenUnderstanding
          qa={[
            { q: "Why does the Server keep a SYN-RECEIVED connection?", a: "It answered the SYN and is waiting for its own SYN to be acknowledged. It retransmits the SYN-ACK a few times, then gives up — servers that collect many such half-open connections are a classic symptom of broken return paths (or SYN floods)." },
            { q: "Why doesn't the Laptop's own SYN retransmission fix it?", a: "Its SYN reaches the Server fine; the problem is every reply on the way back. Whatever the Server sends toward the Laptop is lost at R1." },
          ]}
        />
      ) : (
        copy?.deepen && <DeepenUnderstanding qa={copy.deepen} />
      )}
    </TeachingBoard>
  );
}
