"use client";

import type { ReactNode } from "react";
import { BoardSection, DeepenUnderstanding, EngineerCheck, KeyLesson, NextAction, PredictionBlock, StateDeltaChips, TeachingBoard, TeachingEventRows, Verdict, type EngineerCheckFact, type PredictionOption, type StateDelta, type TeachingEventRowDef } from "@/components/practice-lab/TeachingBoard";
import { ETH_MAC, FDB_AGING_SEC, SW1_PORTS, lookup, macName, BROADCAST_MAC, type EthDevice, type EthSwitch } from "@/lib/sim-engine/scenarios/ethernetSwitching";
import { ETH_LAB_MODEL, ethDelivered, hostAttachment, type EthLabAction, type EthLabState, type EthTransmission } from "@/lib/sim-engine/scenarios/ethernetLab";

/**
 * Ethernet Lab Teaching Board — the Ethernet composition of the generic board primitives. It owns every Ethernet
 * explanation, the guided T0→T7 script, prediction answers and engineer checks; the primitives own layout only.
 * Prediction answers are derived from a pure dry run of the lab model, and every engineer check needs BOTH an
 * inspection made after the latest event (device card, row "Why?", packet copy) AND the matching lab state.
 */

const A = ETH_MAC["HOST-A"];
const B = ETH_MAC["HOST-B"];
const C = ETH_MAC["HOST-C"];
const short = (mac: string) => (mac === BROADCAST_MAC ? "FF:FF:FF:FF:FF:FF" : `…:${mac.slice(-2)}`);
const who = (mac: string) => (mac === BROADCAST_MAC ? "broadcast" : macName(mac));

export const ETH_LAB_STAGES = ["Baseline", "Unknown unicast", "Return", "Known unicast", "Broadcast", "Aging", "Stale entry", "Repair & verify"];

/** Pure dry run of one action (no React state involved). */
export function ethLabDryRun(s: EthLabState, a: EthLabAction): EthLabState {
  const hops = ETH_LAB_MODEL.hops(s, a);
  let n = ETH_LAB_MODEL.start(s, a);
  for (let i = 0; i < hops; i++) n = ETH_LAB_MODEL.arrive(n);
  return n;
}

interface PredictDef {
  id: string;
  prompt: string;
  options: PredictionOption[];
  multiple?: boolean;
  /** Correct option ids, derived from the state before and after the action. */
  correct: (before: EthLabState, after: EthLabState) => string[];
  explain: (after: EthLabState) => ReactNode;
}
export interface EthScriptStep {
  id: string;
  stage: number;
  action: EthLabAction;
  label: string;
  predict?: PredictDef[];
}

const sw1Decision = (s: EthLabState) => s.tx?.decisions.find((d) => d.sw === "SW1");
const portOptions: PredictionOption[] = SW1_PORTS.map((p) => ({ id: p, label: p }));
const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

export const ETH_LAB_SCRIPT: EthScriptStep[] = [
  {
    id: "t1-send",
    stage: 1,
    action: { type: "send", src: "HOST-A", dst: "HOST-B" },
    label: "Send HOST-A → HOST-B",
    predict: [
      {
        id: "t1-learn",
        prompt: "When HOST-A's frame reaches SW1 on ge-0/0/1, what does SW1 learn?",
        options: [
          { id: "src", label: "HOST-A's MAC → ge-0/0/1" },
          { id: "dst", label: "HOST-B's MAC → ge-0/0/2" },
          { id: "both", label: "Both MACs" },
          { id: "none", label: "Nothing until HOST-B replies" },
        ],
        correct: (_b, a) => (a.tx?.learned.some((l) => l.sw === "SW1" && l.mac === A && l.port === "ge-0/0/1") && !a.tx?.learned.some((l) => l.mac === B) ? ["src"] : []),
        explain: () => "Learning uses the SOURCE MAC and the port it arrived on. The destination field says who the frame is for — not where they are.",
      },
      {
        id: "t1-ports",
        prompt: "HOST-B is not in SW1's table. Which SW1 ports send a copy?",
        options: portOptions,
        multiple: true,
        correct: (_b, a) => sw1Decision(a)?.egress ?? [],
        explain: (a) => `Lookup missed, so SW1 floods out every other up port: ${sw1Decision(a)?.egress.join(", ")}. Never back out ge-0/0/1, where the frame came in.`,
      },
    ],
  },
  {
    id: "t2-send",
    stage: 2,
    action: { type: "send", src: "HOST-B", dst: "HOST-A" },
    label: "Send HOST-B → HOST-A",
    predict: [
      {
        id: "t2-flood",
        prompt: "HOST-B replies to HOST-A. What does SW1 do with it?",
        options: [
          { id: "forward", label: "Forward out ge-0/0/1 only" },
          { id: "flood", label: "Flood out every other port" },
          { id: "drop", label: "Drop it" },
        ],
        correct: (_b, a) => {
          const d = sw1Decision(a);
          return d?.kind === "known-unicast" && sameSet(d.egress, ["ge-0/0/1"]) ? ["forward"] : d?.kind === "unknown-unicast" ? ["flood"] : [];
        },
        explain: () => "SW1 already learned HOST-A on ge-0/0/1 from the first frame, so the reply is known unicast.",
      },
    ],
  },
  {
    id: "t3-send",
    stage: 3,
    action: { type: "send", src: "HOST-A", dst: "HOST-B" },
    label: "Send HOST-A → HOST-B again",
    predict: [
      {
        id: "t3-ports",
        prompt: "HOST-A sends to HOST-B again. Which SW1 ports carry it?",
        options: portOptions,
        multiple: true,
        correct: (_b, a) => sw1Decision(a)?.egress ?? [],
        explain: () => "HOST-B's reply taught SW1 that HOST-B is on ge-0/0/2. Same lookup as before — this time it hits.",
      },
    ],
  },
  {
    id: "t4-send",
    stage: 4,
    action: { type: "send", src: "HOST-C", dst: "broadcast" },
    label: "Send HOST-C broadcast",
    predict: [
      {
        id: "t4-bcast",
        prompt: "SW1 knows HOST-A and HOST-B. HOST-C sends to FF:FF:FF:FF:FF:FF. What happens?",
        options: [
          { id: "flood", label: "Flooded out every port except ge-0/0/3" },
          { id: "known", label: "Sent only to the hosts SW1 knows" },
          { id: "reflect", label: "Flooded out every port, back to HOST-C too" },
          { id: "drop", label: "Dropped — no host has that MAC" },
        ],
        correct: (b, a) => {
          const d = sw1Decision(a);
          const up = SW1_PORTS.filter((p) => p !== "ge-0/0/3" && !b.net.downPorts.includes(`SW1 ${p}`));
          return d?.kind === "broadcast" && sameSet(d.egress, up) ? ["flood"] : [];
        },
        explain: () => "A complete table doesn't stop it: the destination itself means everyone. And never back out the ingress port.",
      },
    ],
  },
  { id: "t5-time-200", stage: 5, action: { type: "time", seconds: 200 }, label: "Let 200 s pass" },
  {
    id: "t5-send",
    stage: 5,
    action: { type: "send", src: "HOST-A", dst: "HOST-B" },
    label: "Send HOST-A → HOST-B",
    predict: [
      {
        id: "t5-refresh",
        prompt: "At t=200 s HOST-A sends to HOST-B. Which SW1 entries does this frame refresh?",
        options: [
          { id: "a", label: "HOST-A only" },
          { id: "b", label: "HOST-B only" },
          { id: "ab", label: "HOST-A and HOST-B" },
          { id: "none", label: "None" },
        ],
        correct: (_b, a) => {
          const r = (a.tx?.learned ?? []).filter((l) => l.sw === "SW1").map((l) => l.mac);
          return [r.includes(A) && r.includes(B) ? "ab" : r.includes(A) ? "a" : r.includes(B) ? "b" : "none"];
        },
        explain: () => "Only the SOURCE is refreshed. HOST-B is only the destination here, so its timer keeps running.",
      },
    ],
  },
  {
    id: "t5-time-150",
    stage: 5,
    action: { type: "time", seconds: 150 },
    label: "Let 150 s pass",
    predict: [
      {
        id: "t5-survive",
        prompt: `At t=350 s, which SW1 entries remain? (Aging time ${FDB_AGING_SEC} s)`,
        options: [
          { id: A, label: "HOST-A" },
          { id: B, label: "HOST-B" },
          { id: C, label: "HOST-C" },
        ],
        multiple: true,
        correct: (_b, a) => a.net.fdb.SW1.map((e) => e.mac),
        explain: (a) => (a.last?.type === "time" ? `Expired: ${a.last.expired.filter((x) => x.sw === "SW1").map((x) => `${who(x.mac)} (age ${x.age} s)`).join(", ") || "none"}. Kept: ${a.net.fdb.SW1.map((e) => `${who(e.mac)} (age ${a.net.clock - e.lastSeen} s)`).join(", ") || "none"}.` : null),
      },
    ],
  },
  {
    id: "t6-b-speaks",
    stage: 6,
    action: { type: "send", src: "HOST-B", dst: "HOST-A" },
    label: "HOST-B sends to HOST-A",
    predict: [
      {
        id: "t6-relearn",
        prompt: "HOST-B's entry aged out in T5. HOST-B now sends to HOST-A from ge-0/0/2. What does SW1 learn?",
        options: [
          { id: "ge-0/0/2", label: "HOST-B → ge-0/0/2" },
          { id: "nothing", label: "Nothing — HOST-B expired" },
          { id: "ge-0/0/1", label: "HOST-B → ge-0/0/1" },
        ],
        correct: (_b, a) => [a.tx?.learned.find((l) => l.sw === "SW1" && l.mac === B)?.port ?? "nothing"],
        explain: () => "An expired host is simply unknown. Its next frame is learned again, against the port it arrives on.",
      },
    ],
  },
  { id: "t6-move", stage: 6, action: { type: "move-b", to: "desk" }, label: "Move HOST-B to the hot desk" },
  {
    id: "t6-b-sends",
    stage: 6,
    action: { type: "send", src: "HOST-B", dst: "HOST-A" },
    label: "HOST-B sends to HOST-A",
    predict: [
      {
        id: "t6-where",
        prompt: "HOST-B now sits behind DESK-SW and hasn't sent anything. What does SW1's table say about HOST-B?",
        options: [
          { id: "none", label: "No entry — flushed when ge-0/0/2 went down" },
          { id: "ge-0/0/2", label: "HOST-B → ge-0/0/2" },
          { id: "ge-0/0/4", label: "HOST-B → ge-0/0/4" },
        ],
        correct: (b) => [lookup(b.net.fdb.SW1, B)?.port ?? "none"],
        explain: () => "A link going down flushes what was learned on it. Nothing tells SW1 where HOST-B went — only a frame from HOST-B can.",
      },
    ],
  },
  { id: "t6-move-back", stage: 6, action: { type: "move-b", to: "sw1" }, label: "Move HOST-B back to SW1 ge-0/0/2" },
  {
    id: "t6-stale-send",
    stage: 6,
    action: { type: "send", src: "HOST-A", dst: "HOST-B" },
    label: "Send HOST-A → HOST-B",
    predict: [
      {
        id: "t6-stale",
        prompt: "HOST-B is back on ge-0/0/2 but hasn't sent anything there. Where does SW1 send HOST-A → HOST-B?",
        options: [
          { id: "ge-0/0/4", label: "Out ge-0/0/4, toward DESK-SW" },
          { id: "ge-0/0/2", label: "Out ge-0/0/2, where HOST-B is" },
          { id: "flood", label: "Flood — HOST-B is unknown" },
        ],
        correct: (_b, a) => {
          const d = sw1Decision(a);
          return [d?.kind === "known-unicast" ? (d.egress[0] ?? "") : "flood"];
        },
        explain: () => "SW1 trusts its table: the HOST-B entry still points at ge-0/0/4. A link coming up taught it nothing, and ge-0/0/4 never went down.",
      },
    ],
  },
  { id: "t7-clear", stage: 7, action: { type: "clear-b" }, label: "Clear SW1's dynamic entry for HOST-B" },
  {
    id: "t7-verify-1",
    stage: 7,
    action: { type: "send", src: "HOST-A", dst: "HOST-B" },
    label: "Verify: HOST-A → HOST-B",
    predict: [
      {
        id: "t7-flood",
        prompt: "The stale entry is gone. What does SW1 do with HOST-A → HOST-B now?",
        options: [
          { id: "flood", label: "Flood — HOST-B is unknown" },
          { id: "ge-0/0/2", label: "Forward out ge-0/0/2" },
          { id: "ge-0/0/4", label: "Forward out ge-0/0/4" },
        ],
        correct: (_b, a) => {
          const d = sw1Decision(a);
          return [d?.kind === "unknown-unicast" ? "flood" : (d?.egress[0] ?? "")];
        },
        explain: () => "Clearing the entry makes HOST-B unknown, so the next frame is flooded — and the copy on ge-0/0/2 reaches HOST-B.",
      },
    ],
  },
  { id: "t7-verify-2", stage: 7, action: { type: "send", src: "HOST-B", dst: "HOST-A" }, label: "Verify: HOST-B → HOST-A" },
  { id: "t7-verify-3", stage: 7, action: { type: "send", src: "HOST-A", dst: "HOST-B" }, label: "Verify: HOST-A → HOST-B" },
];

/** Freeze the correct answers of a step's predictions from the state before the action (pure). */
export function ethRevealFor(step: EthScriptStep, before: EthLabState): Record<string, string[]> {
  if (!step.predict) return {};
  const after = ethLabDryRun(before, step.action);
  return Object.fromEntries(step.predict.map((p) => [p.id, p.correct(before, after)]));
}

/** Repair is verified only by traffic: HOST-B relearned on its real port and the last A→B frame was known unicast to it. */
export function ethRepairVerified(s: EthLabState): boolean {
  const d = sw1Decision(s);
  return !!s.tx && s.last?.type === "send" && s.tx.src === "HOST-A" && s.tx.dst === "HOST-B" && d?.kind === "known-unicast" && sameSet(d.egress, ["ge-0/0/2"]) && lookup(s.net.fdb.SW1, B)?.port === "ge-0/0/2" && s.net.hostB === "SW1 ge-0/0/2" && ethDelivered(s.tx);
}

// ---------------------------------------------------------------------------------------------------------------
// Observation (WHAT HAPPENED / WHAT CHANGED) — derived from the latest lab event
// ---------------------------------------------------------------------------------------------------------------
function sendRows(tx: EthTransmission, net: EthLabState["net"]): TeachingEventRowDef[] {
  const rows: TeachingEventRowDef[] = [];
  const dst = tx.frame.layers[0].fields.find((f) => f.label === "Destination MAC")!.value;
  const at = hostAttachment(net, tx.src);
  rows.push({ who: tx.src, body: `sent dst ${dst} (${who(dst)}) · src ${ETH_MAC[tx.src]} into ${at.sw} ${at.port}.`, short: `sent to ${who(dst)} via ${at.sw} ${at.port}.` });
  tx.decisions.forEach((d) => {
    const l = tx.learned.find((x) => x.sw === d.sw)!;
    const learnText = l.kind === "learned" ? `learned ${who(l.mac)} → ${l.port}` : l.kind === "moved" ? `moved ${who(l.mac)} ${l.from} → ${l.port}` : `refreshed ${who(l.mac)} on ${l.port}`;
    const decide =
      d.kind === "broadcast"
        ? d.egress.length
          ? `broadcast → flooded out ${d.egress.join(", ")} (not back out ${d.ingress})`
          : "broadcast, but no other port is up — nothing further to send"
        : d.kind === "unknown-unicast"
          ? d.egress.length
            ? `lookup ${short(dst)} missed → flooded out ${d.egress.join(", ")}`
            : `lookup ${short(dst)} missed, and no other port is up — the copy goes no further`
          : d.egress.length
            ? `lookup ${short(dst)} hit → forwarded out ${d.egress.join(", ")} only`
            : "destination is on the ingress port → filtered";
    rows.push({ who: d.sw, tone: d.egress.length === 0 || d.kind !== "known-unicast" ? "attention" : "device", body: `${learnText} (source MAC, ingress ${d.ingress}); ${decide}.`, short: `${learnText}; ${decide}.` });
  });
  tx.received.forEach((r) => rows.push({ who: r.host, tone: r.accepted ? "result" : "attention", body: r.accepted ? `accepted — the destination ${dst === BROADCAST_MAC ? "is broadcast" : "is its own MAC"}.` : `received a flooded copy but discarded it — destination ${short(dst)} is ${who(dst)}, not ${r.host}.`, short: r.accepted ? "accepted." : `discarded (not ${r.host}'s MAC).` }));
  const sw1 = tx.decisions.find((d) => d.sw === "SW1");
  if (sw1 && sw1.kind !== "known-unicast" && at.sw === "SW1") rows.push({ who: "Ingress rule", tone: "device", body: `${tx.src} got no copy back — SW1 never sends a frame out the port it arrived on (${sw1.ingress}).`, short: `${tx.src} got no copy back (ingress port excluded).` });
  if (tx.dst !== "broadcast" && !ethDelivered(tx) && tx.wave >= tx.waves) rows.push({ who: "Result", tone: "attention", body: `${tx.dst} never received the frame. No device reported an error.`, short: `${tx.dst} never received it.` });
  return rows;
}

function deltas(s: EthLabState): StateDelta[] {
  const last = s.last;
  const out: StateDelta[] = [];
  (["SW1", "DESK-SW"] as EthSwitch[]).forEach((sw) => {
    const label = `${sw} table`;
    if (last?.type === "send" && s.tx) {
      const l = s.tx.learned.filter((x) => x.sw === sw);
      const n = l.filter((x) => x.kind !== "refreshed").length;
      out.push({ label, count: n ? n : l.length ? 1 : 0, text: n ? undefined : l.length ? "REFRESHED" : "UNCHANGED" });
    } else if (last?.type === "time") {
      const n = last.expired.filter((x) => x.sw === sw).length;
      out.push({ label, count: n, text: n ? `−${n} EXPIRED` : "UNCHANGED" });
    } else if (last?.type === "move-b") {
      const n = last.flushed.filter((x) => x.sw === sw).length;
      out.push({ label, count: n, text: n ? `−${n} FLUSHED` : "UNCHANGED" });
    } else if (last?.type === "clear-b") {
      const n = sw === "SW1" && last.removed ? 1 : 0;
      out.push({ label, count: n, text: n ? "−1 CLEARED" : "UNCHANGED" });
    }
  });
  return out;
}

function eventRows(s: EthLabState): TeachingEventRowDef[] {
  const last = s.last;
  if (!last) return [];
  if (last.type === "send") return s.tx ? sendRows(s.tx, s.net) : [];
  if (last.type === "time") {
    const rows: TeachingEventRowDef[] = [{ who: "Clock", body: `${last.seconds} s passed: t=${last.from} → t=${last.to} s. Aging time is ${FDB_AGING_SEC} s.` }];
    // One row per switch (row keys are the actor names): what expired, with its real age, and what was kept.
    (["SW1", "DESK-SW"] as EthSwitch[]).forEach((sw) => {
      const gone = last.expired.filter((x) => x.sw === sw).map((x) => `${who(x.mac)} on ${x.port} (not a source for ${x.age} s)`);
      const kept = s.net.fdb[sw].map((e) => `${who(e.mac)} (${s.net.clock - e.lastSeen} s)`);
      if (!gone.length && !kept.length) return;
      rows.push({ who: sw, tone: gone.length ? "attention" : "result", body: `${gone.length ? `expired: ${gone.join(", ")}. ` : "nothing expired. "}${kept.length ? `Kept: ${kept.join(", ")}.` : "Table now empty."}` });
    });
    return rows;
  }
  if (last.type === "move-b") {
    if (last.to === "desk")
      return [
        { who: "Unplug", tone: "attention", body: "HOST-B unplugged from SW1 ge-0/0/2 → that link went DOWN." },
        { who: "SW1", body: last.flushed.length ? `flushed what it had learned on ge-0/0/2: ${last.flushed.map((f) => who(f.mac)).join(", ")}.` : "had nothing learned on ge-0/0/2 to flush." },
        { who: "Plug in", body: "HOST-B plugged into DESK-SW port 2. It has not sent anything yet, so no switch knows it is there." },
      ];
    return [
      { who: "Unplug", tone: "attention", body: "HOST-B unplugged from DESK-SW port 2 → DESK-SW port 2 DOWN." },
      { who: "DESK-SW", body: last.flushed.length ? `flushed what it had learned on port 2: ${last.flushed.map((f) => who(f.mac)).join(", ")}.` : "had nothing learned on port 2 to flush." },
      { who: "Plug in", body: "HOST-B plugged back into SW1 ge-0/0/2 → link UP. A link coming up teaches SW1 no MAC addresses." },
      last.staleKept ? { who: "SW1", tone: "attention", body: `ge-0/0/4 never went down, so nothing was flushed there: SW1 still maps HOST-B → ${last.staleKept.port}.` } : { who: "SW1", body: "has no entry for HOST-B." },
    ];
  }
  return [{ who: "SW1", tone: "attention", body: last.removed ? `dynamic entry HOST-B → ${last.removed.port} cleared. HOST-B is unknown to SW1 until it sends again.` : "had no entry for HOST-B to clear." }];
}

// ---------------------------------------------------------------------------------------------------------------
// Per-step copy, checks and the board
// ---------------------------------------------------------------------------------------------------------------
export interface EthBoardCtx {
  lab: EthLabState;
  /** Was `key` inspected after the latest event? */
  seen: (key: string) => boolean;
  answer: (key: string) => string[];
  onAnswer: (key: string, v: string[]) => void;
  onInspectDevice: (id: EthDevice) => void;
  onInspectCopy: (segId: string) => void;
}

const sawSw1 = (x: EthBoardCtx) => x.seen("dev:SW1") || x.seen("card:SW1");
const sawDesk = (x: EthBoardCtx) => x.seen("dev:DESK-SW") || x.seen("card:DESK-SW");

interface IdentifyDef {
  id: string;
  prompt: string;
  options: PredictionOption[];
  multiple?: boolean;
  correct: string[];
}
interface StepCopy {
  title: string;
  summary: ReactNode;
  key: ReactNode;
  checks?: (x: EthBoardCtx) => { facts: EngineerCheckFact[]; identify?: IdentifyDef[] };
  deepen?: { q: string; a: ReactNode }[];
}

const openSw1 = (x: EthBoardCtx) => ({ label: "open SW1", onClick: () => x.onInspectDevice("SW1") });
/** An identify question is proven only when answered correctly after the event. */
const answered = (x: EthBoardCtx, q: IdentifyDef) => {
  const v = x.answer(`${x.lab.seq}|${q.id}`);
  return v.length > 0 && sameSet(v, q.correct);
};

const COPY: Record<string, StepCopy> = {
  "t1-send": {
    title: "First frame: unknown unicast",
    summary: "SW1 learned where HOST-A is — and had to flood, because it has never heard from HOST-B.",
    key: (
      <>
        <b>Learning is based on the source. Forwarding is based on the destination.</b> One frame proved where HOST-A lives (ge-0/0/1); it says nothing about where HOST-B is.
      </>
    ),
    checks: (x) => {
      const aPort = lookup(x.lab.net.fdb.SW1, A)?.port ?? "";
      const qPort: IdentifyDef = { id: "a-port", prompt: "Identify: which port did SW1 learn HOST-A on?", options: portOptions, correct: [aPort] };
      const bAbsent = !lookup(x.lab.net.fdb.SW1, B);
      const qWhy: IdentifyDef = {
        id: "b-absent",
        prompt: "Identify: why is HOST-B missing from SW1's table?",
        options: [
          { id: "not-sourced", label: "HOST-B hasn't sourced a frame yet" },
          { id: "link", label: "HOST-B's link is down" },
          { id: "dst", label: "Switches learn destinations later" },
          { id: "full", label: "The table is full" },
        ],
        correct: bAbsent && x.lab.net.hostB === "SW1 ge-0/0/2" ? ["not-sourced"] : [],
      };
      const cSeg = x.lab.tx?.segments.find((g) => g.to === "HOST-C");
      const cDst = x.lab.tx?.frame.layers[0].fields.find((f) => f.label === "Destination MAC")?.value;
      return {
        identify: [qPort, qWhy],
        facts: [
          { id: "a-port", text: "Inspect SW1's table and identify HOST-A's port", provenText: `SW1 learned HOST-A on ${aPort} — from the source MAC.`, proven: sawSw1(x) && !!aPort && answered(x, qPort), action: openSw1(x) },
          { id: "b-absent", text: "Explain why HOST-B is absent", provenText: "HOST-B is absent: it has not sourced a frame, and only sources are learned.", proven: sawSw1(x) && bAbsent && answered(x, qWhy) },
          { id: "c-copy", text: "Inspect HOST-C's copy: whose MAC is the destination?", provenText: `HOST-C's copy is addressed to ${short(cDst ?? "")} (HOST-B), so HOST-C discarded it.`, proven: !!cSeg && x.seen(`pkt:${cSeg.id}`) && cSeg.outcome === "discarded" && cDst === B, action: cSeg ? { label: "inspect copy", onClick: () => x.onInspectCopy(cSeg.id) } : undefined },
        ],
      };
    },
    deepen: [
      { q: "Why doesn't SW1 change the destination to broadcast when it floods?", a: "Flooding is what the switch does with the frame — not a change to the frame. Every copy still carries HOST-B's MAC, which is exactly why HOST-C can discard its copy." },
      { q: "Did DESK-SW learn anything?", a: "Yes. DESK-SW is unmanaged but still a learning bridge: its copy arrived on port 1, so it learned HOST-A behind port 1. Its lookup for HOST-B missed too, and with nothing on port 2 the copy went no further." },
    ],
  },
  "t2-send": {
    title: "The return frame",
    summary: "HOST-B's reply taught SW1 the reverse direction, and it went out one port only.",
    key: "A reply teaches the reverse direction. SW1 learned HOST-B from the reply's source MAC — and HOST-A was already known, so no flood.",
    checks: (x) => {
      const bPort = lookup(x.lab.net.fdb.SW1, B)?.port;
      const real = hostAttachment(x.lab.net, "HOST-B");
      const egress = sw1Decision(x.lab)?.egress ?? [];
      const q: IdentifyDef = { id: "t2-count", prompt: "Identify: how many SW1 ports carried the reply?", options: ["1", "2", "3"].map((n) => ({ id: n, label: n })), correct: [String(egress.length)] };
      return {
        identify: [q],
        facts: [
          { id: "b-port", text: "Check HOST-B's entry against where HOST-B is plugged in", provenText: `HOST-B → ${bPort}, matching its real port.`, proven: sawSw1(x) && real.sw === "SW1" && bPort === real.port, action: openSw1(x) },
          { id: "one-port", text: "Count the ports that carried the reply", provenText: `${egress.length} port (${egress.join(", ")}) — known unicast.`, proven: sawSw1(x) && answered(x, q) },
        ],
      };
    },
  },
  "t3-send": {
    title: "Known unicast",
    summary: "The same lookup as the first frame — this time it hit, so only ge-0/0/2 carried the frame.",
    key: "Unknown-unicast flooding and known-unicast forwarding are two outcomes of the same destination lookup: miss → flood, hit → one port.",
    checks: (x) => {
      const got = [...new Set((x.lab.tx?.segments ?? []).filter((g) => g.from === "SW1").map((g) => g.to))];
      const q: IdentifyDef = { id: "t3-recv", prompt: "Identify: which devices received a copy from SW1?", options: ["HOST-B", "HOST-C", "DESK-SW"].map((d) => ({ id: d, label: d })), multiple: true, correct: got };
      return { identify: [q], facts: [{ id: "recv", text: "Identify who received a copy this time", provenText: `Only ${got.join(", ")} — HOST-C and DESK-SW saw nothing.`, proven: sawSw1(x) && answered(x, q), action: openSw1(x) }] };
    },
  },
  "t4-send": {
    title: "Broadcast",
    summary: "SW1 knows every host, yet the broadcast was still flooded — for a different reason than the first frame.",
    key: (
      <>
        <span className="block">
          <b>Unknown unicast</b> floods because the destination lookup <b>missed</b>.
        </span>
        <span className="block">
          <b>Broadcast</b> floods because the destination itself <b>means everyone</b> in the broadcast domain.
        </span>
        <span className="mt-1 block text-pv-text-muted">A broadcast reaches all other members of the broadcast domain through eligible egress ports; a switch does not reflect it back through its ingress port.</span>
      </>
    ),
    checks: (x) => {
      const got = [...new Set((x.lab.tx?.segments ?? []).filter((g) => g.from === "SW1").map((g) => g.to))];
      const q: IdentifyDef = { id: "t4-recv", prompt: "Identify: which devices received a copy from SW1?", options: ["HOST-A", "HOST-B", "HOST-C", "DESK-SW"].map((d) => ({ id: d, label: d })), multiple: true, correct: got };
      return {
        identify: [q],
        facts: [
          { id: "c-port", text: "Check what SW1 learned from the broadcast", provenText: `HOST-C → ${lookup(x.lab.net.fdb.SW1, C)?.port} — broadcasts are still learned from their source.`, proven: sawSw1(x) && lookup(x.lab.net.fdb.SW1, C)?.port === "ge-0/0/3", action: openSw1(x) },
          { id: "recv", text: "Identify who received a copy (and who did not)", provenText: `${got.join(", ")} — not HOST-C, whose port was the ingress.`, proven: sawSw1(x) && answered(x, q) },
          { id: "desk", text: "Inspect DESK-SW: it processed its copy as a bridge", provenText: "DESK-SW learned HOST-C on port 1; with nothing on port 2 it had no other port to flood to.", proven: sawDesk(x) && !!lookup(x.lab.net.fdb["DESK-SW"], C), action: { label: "open DESK-SW", onClick: () => x.onInspectDevice("DESK-SW") } },
        ],
      };
    },
  },
  "t5-time-200": {
    title: "Time passes",
    summary: "200 s with no traffic. Every entry is 200 s old — still under the 300 s aging time.",
    key: "An entry's age is the time since its MAC last appeared as a SOURCE. Watch which frames reset it.",
  },
  "t5-send": {
    title: "A refresh — for the source only",
    summary: "HOST-A's entry was refreshed to age 0. HOST-B's was not, even though the frame was addressed to it.",
    key: "Only a frame a host SENDS refreshes its entry. Being the destination does nothing to the timer.",
    checks: (x) => {
      const fresh = x.lab.net.fdb.SW1.filter((e) => e.lastSeen === x.lab.net.clock).map((e) => e.mac);
      const q: IdentifyDef = { id: "t5-reset", prompt: "Identify: whose age is 0 s now?", options: [A, B, C].map((m) => ({ id: m, label: who(m) })), multiple: true, correct: fresh };
      return { identify: [q], facts: [{ id: "age", text: "Inspect the ages in SW1's table", provenText: `Age 0: ${fresh.map(who).join(", ")}. HOST-B kept aging.`, proven: sawSw1(x) && answered(x, q), action: openSw1(x) }] };
    },
  },
  "t5-time-150": {
    title: "Entries age out",
    summary: "At t=350 s, every entry not refreshed in the last 300 s expired.",
    key: `Aging is per entry, from its own last source frame: older than ${FDB_AGING_SEC} s → removed. A frame to a removed host is unknown unicast again.`,
    checks: (x) => {
      const kept = x.lab.net.fdb.SW1.map((e) => e.mac);
      const q: IdentifyDef = { id: "t5-kept", prompt: "Identify: which SW1 entries are still there?", options: [A, B, C].map((m) => ({ id: m, label: who(m) })), multiple: true, correct: kept };
      return { identify: [q], facts: [{ id: "kept", text: "Inspect SW1's table after aging", provenText: `Still present: ${kept.map(who).join(", ") || "none"}.`, proven: sawSw1(x) && answered(x, q), action: openSw1(x) }] };
    },
  },
  "t6-b-speaks": {
    title: "Before the move: HOST-B is learned again",
    summary: "HOST-B's frame put it back in SW1's table — on ge-0/0/2, where it is plugged in.",
    key: "An aged-out host is relearned from its next source frame. Now watch what happens to this entry when HOST-B unplugs.",
    checks: (x) => ({ facts: [{ id: "b-back", text: "Find HOST-B's entry in SW1's table", provenText: `HOST-B → ${lookup(x.lab.net.fdb.SW1, B)?.port}.`, proven: sawSw1(x) && lookup(x.lab.net.fdb.SW1, B)?.port === "ge-0/0/2", action: openSw1(x) }] }),
  },
  "t6-move": {
    title: "HOST-B moves to the hot desk",
    summary: "ge-0/0/2 went down and SW1 forgot HOST-B. Nothing told SW1 where HOST-B went.",
    key: "A link going down flushes the entries learned on it. A switch learns a NEW location only from a frame the host sends.",
    checks: (x) => ({ facts: [{ id: "flushed", text: "Confirm SW1 no longer has HOST-B", provenText: "SW1 has no entry for HOST-B — flushed with ge-0/0/2.", proven: sawSw1(x) && !lookup(x.lab.net.fdb.SW1, B), action: openSw1(x) }] }),
  },
  "t6-b-sends": {
    title: "HOST-B speaks from the hot desk",
    summary: "DESK-SW learned HOST-B on port 2, and SW1 learned HOST-B behind ge-0/0/4 — correct, for now.",
    key: "Each switch learns from the frame arriving on ITS port: for SW1, HOST-B now lives behind ge-0/0/4 (the DESK-SW uplink).",
    checks: (x) => ({ facts: [{ id: "b-ge4", text: "Find where SW1 now places HOST-B", provenText: `HOST-B → ${lookup(x.lab.net.fdb.SW1, B)?.port}.`, proven: sawSw1(x) && lookup(x.lab.net.fdb.SW1, B)?.port === "ge-0/0/4", action: openSw1(x) }] }),
  },
  "t6-move-back": {
    title: "HOST-B returns — the entry goes stale",
    summary: "HOST-B is on ge-0/0/2 again, but SW1 still believes HOST-B is behind ge-0/0/4.",
    key: (
      <>
        Why it is stale: HOST-B was learned on ge-0/0/4 → ge-0/0/4 never went down, so nothing flushed it → ge-0/0/2 coming up taught SW1 nothing → HOST-B hasn&apos;t sent a frame from ge-0/0/2 yet.
      </>
    ),
    checks: (x) => {
      const entry = lookup(x.lab.net.fdb.SW1, B)?.port;
      const real = hostAttachment(x.lab.net, "HOST-B");
      return {
        facts: [
          {
            id: "stale",
            text: "Compare SW1's entry for HOST-B with where HOST-B is plugged in",
            provenText: `SW1 says ${entry}; HOST-B is on ${real.sw} ${real.port}. Stale.`,
            proven: sawSw1(x) && x.seen("dev:HOST-B") && !!entry && !(real.sw === "SW1" && real.port === entry),
            action: { label: x.seen("dev:HOST-B") ? "open SW1" : "open HOST-B", onClick: () => x.onInspectDevice(x.seen("dev:HOST-B") ? "SW1" : "HOST-B") },
          },
        ],
      };
    },
  },
  "t6-stale-send": {
    title: "The frame goes nowhere",
    summary: "SW1 forwarded by its table — out ge-0/0/4. DESK-SW had no other port for HOST-B, and HOST-B never saw the frame.",
    key: "Every device did its job correctly; the table was wrong. Known unicast to a stale port loses frames silently.",
    checks: (x) => {
      const dead = x.lab.tx?.segments.find((g) => g.outcome === "dead-end");
      const q: IdentifyDef = { id: "t6-died", prompt: "Identify: where did the frame stop?", options: ["SW1", "DESK-SW", "HOST-B"].map((d) => ({ id: d, label: d })), correct: dead ? [dead.to] : [] };
      return { identify: [q], facts: [{ id: "died", text: "Inspect DESK-SW and identify where the frame stopped", provenText: "At DESK-SW: HOST-B unknown there, and no other port up.", proven: sawDesk(x) && !!dead && answered(x, q), action: { label: "open DESK-SW", onClick: () => x.onInspectDevice("DESK-SW") } }] };
    },
  },
  "t7-clear": {
    title: "Stale entry cleared",
    summary: "SW1 no longer has an entry for HOST-B. Not repaired yet — that takes traffic.",
    key: "Clearing removes the wrong answer; it doesn't provide the right one. SW1 must relearn HOST-B from a frame HOST-B sends.",
    checks: (x) => ({ facts: [{ id: "cleared", text: "Confirm the HOST-B entry is gone", provenText: "No HOST-B entry: the next frame to HOST-B will be flooded.", proven: sawSw1(x) && !lookup(x.lab.net.fdb.SW1, B), action: openSw1(x) }] }),
  },
  "t7-verify-1": {
    title: "Verify 1: flood reaches HOST-B",
    summary: "HOST-B is unknown, so SW1 flooded — and the copy on ge-0/0/2 reached HOST-B.",
    key: "Unknown unicast is how a switch reaches a host it doesn't know yet. Now HOST-B must reply.",
  },
  "t7-verify-2": {
    title: "Verify 2: HOST-B relearned",
    summary: "HOST-B's reply arrived on ge-0/0/2, so SW1 learned HOST-B where it really is.",
    key: "The repair completes when the host sources a frame from its real port.",
    checks: (x) => ({ facts: [{ id: "relearned", text: "Check HOST-B's entry", provenText: `HOST-B → ${lookup(x.lab.net.fdb.SW1, B)?.port}.`, proven: sawSw1(x) && lookup(x.lab.net.fdb.SW1, B)?.port === "ge-0/0/2", action: openSw1(x) }] }),
  },
  "t7-verify-3": {
    title: "Verified: known unicast to HOST-B",
    summary: "HOST-A → HOST-B left ge-0/0/2 only and HOST-B accepted it. Service restored, proven by traffic.",
    key: "Repair is verified by traffic, not by clearing a table: flood → reply → relearn → known unicast.",
    checks: (x) => ({ facts: [{ id: "verified", text: "Verify HOST-B is back on ge-0/0/2 and reached by known unicast", provenText: "HOST-B → ge-0/0/2, and the last frame used that port only.", proven: sawSw1(x) && ethRepairVerified(x.lab), action: openSw1(x) }] }),
  },
};

/** Are all engineer checks of a step's observation proven (for the learning-loop indicator)? */
export function ethStepChecksDone(stepId: string, x: EthBoardCtx): boolean {
  const c = COPY[stepId]?.checks?.(x);
  return !c || c.facts.every((f) => f.proven);
}

function IdentifyBlock({ x, q }: { x: EthBoardCtx; q: IdentifyDef }) {
  const key = `${x.lab.seq}|${q.id}`;
  const v = x.answer(key);
  const ok = sameSet(v, q.correct);
  return <PredictionBlock label="Identify (from the live state)" prompt={q.prompt} options={q.options} value={v} multiple={q.multiple} onChange={(nv) => x.onAnswer(key, nv)} verdict={v.length > 0 && (!q.multiple || ok) ? <Verdict correct={ok}>{ok ? "That matches the live state." : "Check the live state again."}</Verdict> : undefined} />;
}

export interface EthernetLabBoardProps extends EthBoardCtx {
  /** Correct answers per prediction id, frozen when the action ran (from the state before it). */
  revealed: Record<string, string[]>;
  cursor: number;
  freePlay: boolean;
  inFlight: boolean;
  gate?: string;
}

export function EthernetLabBoard(props: EthernetLabBoardProps) {
  const { lab, cursor, freePlay, inFlight } = props;
  const prev = cursor > 0 ? ETH_LAB_SCRIPT[cursor - 1] : undefined;
  const next = !freePlay ? ETH_LAB_SCRIPT[cursor] : undefined;
  const copy = !freePlay && prev ? COPY[prev.id] : undefined;

  if (inFlight)
    return (
      <TeachingBoard phase={`T${prev?.stage ?? 0} · in flight`} title="Frame in flight" summary="Watch where each copy goes. Learning happens when a copy arrives at a switch.">
        <BoardSection label="What happened so far" tone="cyan">
          <TeachingEventRows rows={eventRows(lab)} />
        </BoardSection>
      </TeachingBoard>
    );

  const checks = copy?.checks?.(props);
  const lastVerdicts = !freePlay && prev?.predict ? prev.predict.map((p) => ({ p, ans: props.answer(p.id), ok: sameSet(props.answer(p.id), props.revealed[p.id] ?? []) })) : [];

  return (
    <TeachingBoard
      phase={freePlay ? "Free play" : `T${prev?.stage ?? 0} · ${ETH_LAB_STAGES[prev?.stage ?? 0]}`}
      title={freePlay ? (lab.last ? "What just happened" : "Free play") : (copy?.title ?? "Before anything moves")}
      summary={freePlay ? "Send any frame, let time pass or move HOST-B. Same network, same rules." : (copy?.summary ?? "SW1 and DESK-SW have just booted. HOST-B is on SW1 ge-0/0/2 and every link is up.")}
    >
      {!prev && !freePlay && (
        <>
          <PredictionBlock
            label="Predict"
            prompt="What does SW1 know before receiving any traffic?"
            options={[
              { id: "nothing", label: "Nothing — its table is empty" },
              { id: "all", label: "All three host MACs" },
              { id: "ports", label: "Which host is on which port" },
            ]}
            value={props.answer("t0-know")}
            onChange={(v) => props.onAnswer("t0-know", v)}
            verdict={props.answer("t0-know").length ? <Verdict correct={props.answer("t0-know")[0] === "nothing" && lab.net.fdb.SW1.length === 0}>A bridge does not magically know where hosts are. It learns each location from a frame that host sends.</Verdict> : undefined}
          />
          <EngineerCheck
            intro="Prove it from the live network:"
            facts={[{ id: "t0", text: "Inspect SW1 and confirm its table holds 0 entries", provenText: "SW1's table: 0 entries.", proven: sawSw1(props) && lab.net.fdb.SW1.length === 0, action: openSw1(props) }]}
          />
        </>
      )}

      {lab.last && (prev || freePlay) && (
        <>
          <BoardSection label="What happened" tone="cyan">
            <TeachingEventRows rows={eventRows(lab)} />
          </BoardSection>
          <BoardSection label="What changed">
            <StateDeltaChips deltas={deltas(lab)} />
          </BoardSection>
          {lastVerdicts.map(({ p, ans, ok }) => (
            <Verdict key={p.id} correct={ok}>
              <span className="font-semibold text-pv-text">{p.prompt}</span> You said: {ans.map((a) => p.options.find((o) => o.id === a)?.label ?? a).join(", ") || "—"}. {p.explain(lab)}
            </Verdict>
          ))}
          {copy && <KeyLesson>{copy.key}</KeyLesson>}
          {checks && (
            <>
              {checks.identify?.map((q) => (
                <IdentifyBlock key={q.id} x={props} q={q} />
              ))}
              <EngineerCheck intro="Prove it from the live state — device cards, table rows and packet copies:" facts={checks.facts} />
            </>
          )}
        </>
      )}

      {next?.predict?.map((p) => (
        <PredictionBlock key={p.id} prompt={p.prompt} options={p.options} multiple={p.multiple} value={props.answer(p.id)} onChange={(v) => props.onAnswer(p.id, v)} />
      ))}
      {next && <NextAction>{props.gate ?? `${next.label}.`}</NextAction>}
      {!next && !freePlay && <NextAction>Guided steps complete.</NextAction>}
      {freePlay && <NextAction>Pick a source and destination below the topology, then send.</NextAction>}
      {copy?.deepen && <DeepenUnderstanding qa={copy.deepen} />}
    </TeachingBoard>
  );
}
