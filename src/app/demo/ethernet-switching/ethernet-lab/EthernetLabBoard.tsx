"use client";

import type { ReactNode } from "react";
import { BoardSection, CommandHelp, DeepenUnderstanding, EngineerCheck, KeyLesson, NextAction, PredictionBlock, StateDeltaChips, TeachingBoard, TeachingEventRows, Verdict, type CommandHelpItem, type EngineerCheckFact, type PredictionOption, type StateDelta, type TeachingEventRowDef } from "@/components/practice-lab/TeachingBoard";
import { ETH_MAC, ETH_REPAIR_CORRECT, FDB_AGING_SEC, SW1_PORTS, lookup, macName, BROADCAST_MAC, type EthDevice, type EthSwitch } from "@/lib/sim-engine/scenarios/ethernetSwitching";
import { ETH_LAB_MODEL, ETH_LAB_REPAIRS, ethDelivered, hostAttachment, type EthLabAction, type EthLabState, type EthTransmission } from "@/lib/sim-engine/scenarios/ethernetLab";
import { ciscoMac } from "@/lib/cli/format";
import type { CliVendor } from "@/lib/cli/types";

/**
 * Ethernet Lab Teaching Board — the Ethernet composition of the generic board primitives. It owns every Ethernet
 * explanation, the guided T0→T8 script, predictions, engineer checks and the incident; the primitives own layout.
 *
 * Every board answers: what happened · what changed · why (rows + key lesson) · why it matters · how to verify it
 * (device cards, table rows, packet copies, and SW1's CLI) · what to do next.
 * Prediction answers are frozen from a pure dry run when the action runs. An engineer check needs BOTH an inspection
 * made after the latest event (a successfully executed CLI command, a device card, a row "Why?", a packet copy) AND
 * the matching lab state. Tab / `?` in the terminal never count — only executed commands are reported.
 */

const A = ETH_MAC["HOST-A"];
const B = ETH_MAC["HOST-B"];
const C = ETH_MAC["HOST-C"];
const short = (mac: string) => (mac === BROADCAST_MAC ? "FF:FF:FF:FF:FF:FF" : `…:${mac.slice(-2)}`);
const who = (mac: string) => (mac === BROADCAST_MAC ? "broadcast" : macName(mac));

export const ETH_LAB_STAGES = ["Baseline", "Unknown unicast", "Return", "Known unicast", "Broadcast", "Aging", "Host move", "Incident", "Repair & verify"];

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
  /** Network action; a `repair` step takes its action from the learner's chosen fix instead. */
  action: EthLabAction;
  label: string;
  predict?: PredictDef[];
  /** The incident's repair: only advances when the chosen fix is the right one. */
  repair?: boolean;
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
  {
    id: "t5-time-200",
    stage: 5,
    action: { type: "time", seconds: 200 },
    label: "Let 200 s pass",
    predict: [
      {
        id: "t5-200",
        prompt: `200 s pass with no traffic at all. What happens to SW1's entries? (Aging time ${FDB_AGING_SEC} s)`,
        options: [
          { id: "stay", label: "They all stay, now 200 s old" },
          { id: "gone", label: "They are all removed" },
          { id: "some", label: "Only the broadcast sender's entry is removed" },
        ],
        correct: (_b, a) => (a.last?.type === "time" ? [a.last.expired.some((x) => x.sw === "SW1") ? (a.net.fdb.SW1.length ? "some" : "gone") : "stay"] : []),
        explain: () => `Nothing is older than ${FDB_AGING_SEC} s yet, so nothing expires — every entry just gets older.`,
      },
    ],
  },
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
  {
    id: "t6-move",
    stage: 6,
    action: { type: "move-b", to: "desk" },
    label: "Move HOST-B to the hot desk",
    predict: [
      {
        id: "t6-unplug",
        prompt: "HOST-B is unplugged from ge-0/0/2 and plugged into DESK-SW. What happens to SW1's HOST-B entry?",
        options: [
          { id: "flushed", label: "Removed — its port went down" },
          { id: "kept", label: "Kept until it ages out" },
          { id: "moved", label: "Moved to ge-0/0/4 automatically" },
        ],
        correct: (b, a) => [!lookup(a.net.fdb.SW1, B) && lookup(b.net.fdb.SW1, B) ? "flushed" : lookup(a.net.fdb.SW1, B)?.port === "ge-0/0/4" ? "moved" : "kept"],
        explain: () => "A port going down flushes the dynamic entries learned on it. Nothing tells SW1 where HOST-B went.",
      },
    ],
  },
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
          { id: "none", label: "No entry" },
          { id: "ge-0/0/2", label: "HOST-B → ge-0/0/2" },
          { id: "ge-0/0/4", label: "HOST-B → ge-0/0/4" },
        ],
        correct: (b) => [lookup(b.net.fdb.SW1, B)?.port ?? "none"],
        explain: () => "Flushed with ge-0/0/2, and nothing taught SW1 a new location — only a frame FROM HOST-B can.",
      },
    ],
  },
  {
    id: "t6-move-back",
    stage: 6,
    action: { type: "move-b", to: "sw1" },
    label: "Move HOST-B back to SW1 ge-0/0/2",
    predict: [
      {
        id: "t6-linkup",
        prompt: "HOST-B is plugged back into ge-0/0/2 and the link comes up. What does SW1 learn from that?",
        options: [
          { id: "nothing", label: "Nothing — only frames teach MAC locations" },
          { id: "learn", label: "HOST-B → ge-0/0/2" },
          { id: "flush4", label: "It removes HOST-B from ge-0/0/4" },
        ],
        correct: (_b, a) => [lookup(a.net.fdb.SW1, B)?.port === "ge-0/0/2" ? "learn" : lookup(a.net.fdb.SW1, B) ? "nothing" : "flush4"],
        explain: () => "A link coming up carries no source MAC, so SW1's table does not change. ge-0/0/4 never went down either.",
      },
    ],
  },
  {
    id: "t7-reproduce",
    stage: 7,
    action: { type: "send", src: "HOST-A", dst: "HOST-B" },
    label: "Reproduce the ticket: HOST-A → HOST-B",
    predict: [
      {
        id: "t7-expect",
        prompt: "Ticket: “HOST-A can't reach HOST-B.” What do you expect will happen to HOST-A → HOST-B?",
        options: [
          { id: "delivered", label: "HOST-B receives it" },
          { id: "flood", label: "SW1 floods it to every port" },
          { id: "elsewhere", label: "SW1 sends it somewhere HOST-B isn't" },
          { id: "drop", label: "SW1 drops it" },
        ],
        correct: (_b, a) => {
          const d = sw1Decision(a);
          if (a.tx && ethDelivered(a.tx)) return ["delivered"];
          return [d?.kind === "unknown-unicast" ? "flood" : d?.kind === "known-unicast" && d.egress.length ? "elsewhere" : "drop"];
        },
        explain: () => "SW1 forwarded it as KNOWN unicast — out one port — and HOST-B never received it. Now find out why from the evidence.",
      },
    ],
  },
  { id: "t8-repair", stage: 8, action: { type: "repair", choice: ETH_REPAIR_CORRECT }, label: "Apply the selected fix", repair: true },
  {
    id: "t8-verify-1",
    stage: 8,
    action: { type: "send", src: "HOST-A", dst: "HOST-B" },
    label: "Verify: HOST-A → HOST-B",
    predict: [
      {
        id: "t8-flood",
        prompt: "SW1 has no entry for HOST-B now. What does SW1 do with HOST-A → HOST-B?",
        options: [
          { id: "flood", label: "Flood it" },
          { id: "ge-0/0/2", label: "Forward out ge-0/0/2 only" },
          { id: "ge-0/0/4", label: "Forward out ge-0/0/4 only" },
        ],
        correct: (_b, a) => {
          const d = sw1Decision(a);
          return [d?.kind === "unknown-unicast" ? "flood" : (d?.egress[0] ?? "")];
        },
        explain: () => "An unknown destination is flooded — and the copy on ge-0/0/2 reaches HOST-B.",
      },
    ],
  },
  { id: "t8-verify-2", stage: 8, action: { type: "send", src: "HOST-B", dst: "HOST-A" }, label: "Verify: HOST-B → HOST-A" },
  { id: "t8-verify-3", stage: 8, action: { type: "send", src: "HOST-A", dst: "HOST-B" }, label: "Verify: HOST-A → HOST-B" },
];

export const ETH_LAB_REPAIR_INDEX = ETH_LAB_SCRIPT.findIndex((s) => s.repair);

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

/** Does SW1's entry for HOST-B contradict where HOST-B is plugged in? (Derived from state, never stored.) */
export function ethHostBStale(s: EthLabState): boolean {
  const e = lookup(s.net.fdb.SW1, B);
  const at = hostAttachment(s.net, "HOST-B");
  if (!e) return false;
  return at.sw === "SW1" ? e.port !== at.port : e.port !== "ge-0/0/4";
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
    } else if (last?.type === "clear-b" || last?.type === "repair") {
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
      { who: "Plug in", body: "HOST-B plugged back into SW1 ge-0/0/2 → link UP. A link coming up carries no source MAC." },
      { who: "SW1", body: "ge-0/0/4 stayed up — nothing learned behind it was flushed. HOST-B has not sent a frame since." },
    ];
  }
  if (last.type === "repair")
    return [{ who: "Repair", tone: last.correct ? "attention" : "device", body: last.correct ? `SW1's dynamic entry HOST-B → ${last.removed?.port ?? "?"} cleared. HOST-B is unknown to SW1 until it sends again.` : `“${ETH_LAB_REPAIRS.find((r) => r.id === last.choice)?.label}” — SW1's table is unchanged.` }];
  return [{ who: "SW1", tone: "attention", body: last.removed ? `dynamic entry HOST-B → ${last.removed.port} cleared. HOST-B is unknown to SW1 until it sends again.` : "had no entry for HOST-B to clear." }];
}

// ---------------------------------------------------------------------------------------------------------------
// Context, inspections and CLI verification
// ---------------------------------------------------------------------------------------------------------------
export interface EthBoardCtx {
  lab: EthLabState;
  /** Was `key` inspected after the latest event? (`dev:X`, `card:X`, `pkt:<seg>`, `cli:<commandId>`) */
  seen: (key: string) => boolean;
  /** …at or after lab event `fromSeq` (the incident's evidence survives failed repair attempts). */
  seenSince: (fromSeq: number, key: string) => boolean;
  answer: (key: string) => string[];
  onAnswer: (key: string, v: string[]) => void;
  onInspectDevice: (id: EthDevice) => void;
  onInspectCopy: (segId: string) => void;
  /** Place a command in SW1's terminal (does not run it). */
  onPutCommand: (vendor: CliVendor, command: string) => void;
}

/** Any successful MAC-table query on SW1 (whole table or filtered) inspects SW1's table; the check's state fact must still hold. */
const CLI_TABLE = ["mac-table", "mac-table-dynamic", "mac-table-address", "mac-table-interface"];
const cliRan = (x: EthBoardCtx, ids: string[]) => ids.some((id) => x.seen(`cli:${id}`));
/** SW1's table inspected: device card, a row's Why?, or a MAC-table command on SW1's CLI. */
const sawSw1 = (x: EthBoardCtx) => x.seen("dev:SW1") || x.seen("card:SW1") || cliRan(x, CLI_TABLE);
const sawDesk = (x: EthBoardCtx) => x.seen("dev:DESK-SW") || x.seen("card:DESK-SW");
const openSw1 = (x: EthBoardCtx) => ({ label: "open SW1", onClick: () => x.onInspectDevice("SW1") });

const Q = {
  table: { question: "What MACs does SW1 know?", cisco: "show mac address-table", junos: "show ethernet-switching table" },
  macA: { question: "Which interface was HOST-A learned on?", cisco: `show mac address-table address ${ciscoMac(A)}`, junos: "show ethernet-switching table interface ge-0/0/1" },
  macB: { question: "Which interface is HOST-B learned on?", cisco: `show mac address-table address ${ciscoMac(B)}`, junos: "show ethernet-switching table" },
  behind2: { question: "What MACs are behind HOST-B's port?", cisco: "show mac address-table interface Gi1/0/2", junos: "show ethernet-switching table interface ge-0/0/2" },
  behind4: { question: "What MACs are behind the DESK-SW uplink?", cisco: "show mac address-table interface Gi1/0/4", junos: "show ethernet-switching table interface ge-0/0/4" },
  aging: { question: "How long do dynamic entries live?", cisco: "show mac address-table aging-time", junos: "show ethernet-switching table" },
  status: { question: "What is the state of each interface?", cisco: "show interfaces status", junos: "show interfaces terse" },
};
type VerifyQ = (typeof Q)[keyof typeof Q];

function verifyItems(x: EthBoardCtx, qs: VerifyQ[]): CommandHelpItem[] {
  return qs.map((q) => ({
    question: q.question,
    commands: [
      { label: "Cisco", command: q.cisco },
      { label: "Junos", command: q.junos },
    ],
    onPut: () => x.onPutCommand("cisco", q.cisco),
    putLabel: `Put “${q.cisco}” in SW1's Cisco terminal`,
  }));
}

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
  verify?: VerifyQ[];
  checks?: (x: EthBoardCtx) => { facts: EngineerCheckFact[]; identify?: IdentifyDef[] };
  deepen?: { q: string; a: ReactNode }[];
}

/** An identify question is proven only when answered correctly after the event. */
const answered = (x: EthBoardCtx, q: IdentifyDef, key = `${x.lab.seq}|${q.id}`) => {
  const v = x.answer(key);
  return v.length > 0 && q.correct.length > 0 && sameSet(v, q.correct);
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
    verify: [Q.macA, Q.table],
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
          { id: "a-port", text: "Inspect SW1's table (CLI or device card) and identify HOST-A's port", provenText: `SW1 learned HOST-A on ${aPort} — from the source MAC.`, proven: sawSw1(x) && !!aPort && answered(x, qPort), action: openSw1(x) },
          { id: "b-absent", text: "Explain why HOST-B is absent", provenText: "HOST-B is absent: it has not sourced a frame, and only sources are learned.", proven: sawSw1(x) && bAbsent && answered(x, qWhy) },
          { id: "c-copy", text: "Inspect HOST-C's copy: whose MAC is the destination?", provenText: `HOST-C's copy is addressed to ${short(cDst ?? "")} (HOST-B), so HOST-C discarded it.`, proven: !!cSeg && x.seen(`pkt:${cSeg.id}`) && cSeg.outcome === "discarded" && cDst === B, action: cSeg ? { label: "inspect copy", onClick: () => x.onInspectCopy(cSeg.id) } : undefined },
        ],
      };
    },
    deepen: [
      { q: "Why doesn't SW1 change the destination to broadcast when it floods?", a: "Flooding is what the switch does with the frame — not a change to the frame. Every copy still carries HOST-B's MAC, which is exactly why HOST-C can discard its copy." },
      { q: "Did DESK-SW learn anything?", a: "Yes. DESK-SW is unmanaged but still a learning bridge: its copy arrived on port 1, so it learned HOST-A behind port 1. Its lookup for HOST-B missed too, and with nothing on port 2 the copy went no further. Being unmanaged, it has no CLI — the lab shows its table as a simulation view." },
    ],
  },
  "t2-send": {
    title: "The return frame",
    summary: "HOST-B's reply taught SW1 the reverse direction, and it went out one port only.",
    key: "A reply teaches the reverse direction. SW1 learned HOST-B from the reply's source MAC — and HOST-A was already known, so no flood.",
    verify: [Q.behind2],
    checks: (x) => {
      const bPort = lookup(x.lab.net.fdb.SW1, B)?.port;
      const real = hostAttachment(x.lab.net, "HOST-B");
      const egress = sw1Decision(x.lab)?.egress ?? [];
      const q: IdentifyDef = { id: "t2-count", prompt: "Identify: how many SW1 ports carried the reply?", options: ["1", "2", "3"].map((n) => ({ id: n, label: n })), correct: [String(egress.length)] };
      return {
        identify: [q],
        facts: [
          { id: "b-port", text: "Check HOST-B's entry (CLI or SW1's card) against where HOST-B is plugged in", provenText: `HOST-B → ${bPort}, matching its real port.`, proven: (sawSw1(x) || x.seen("cli:mac-table-interface") || x.seen("cli:mac-table-address")) && real.sw === "SW1" && bPort === real.port, action: openSw1(x) },
          { id: "one-port", text: "Count the ports that carried the reply", provenText: `${egress.length} port (${egress.join(", ")}) — known unicast.`, proven: x.seen("dev:SW1") && answered(x, q), action: openSw1(x) },
        ],
      };
    },
  },
  "t3-send": {
    title: "Known unicast",
    summary: "The same lookup as the first frame — this time it hit, so only ge-0/0/2 carried the frame.",
    key: "Unknown-unicast flooding and known-unicast forwarding are two outcomes of the same destination lookup: miss → flood, hit → one port. (The CLI shows the table, not each frame's path — SW1's card shows the last decision.)",
    checks: (x) => {
      const got = [...new Set((x.lab.tx?.segments ?? []).filter((g) => g.from === "SW1").map((g) => g.to))];
      const q: IdentifyDef = { id: "t3-recv", prompt: "Identify: which devices received a copy from SW1?", options: ["HOST-B", "HOST-C", "DESK-SW"].map((d) => ({ id: d, label: d })), multiple: true, correct: got };
      return { identify: [q], facts: [{ id: "recv", text: "Open SW1 (its last decision) and identify who received a copy", provenText: `Only ${got.join(", ")} — HOST-C and DESK-SW saw nothing.`, proven: x.seen("dev:SW1") && answered(x, q), action: openSw1(x) }] };
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
    verify: [Q.table],
    checks: (x) => {
      const got = [...new Set((x.lab.tx?.segments ?? []).filter((g) => g.from === "SW1").map((g) => g.to))];
      const q: IdentifyDef = { id: "t4-recv", prompt: "Identify: which devices received a copy from SW1?", options: ["HOST-A", "HOST-B", "HOST-C", "DESK-SW"].map((d) => ({ id: d, label: d })), multiple: true, correct: got };
      return {
        identify: [q],
        facts: [
          { id: "c-port", text: "Check what SW1 learned from the broadcast", provenText: `HOST-C → ${lookup(x.lab.net.fdb.SW1, C)?.port} — broadcasts are still learned from their source.`, proven: sawSw1(x) && lookup(x.lab.net.fdb.SW1, C)?.port === "ge-0/0/3", action: openSw1(x) },
          { id: "recv", text: "Identify who received a copy (and who did not)", provenText: `${got.join(", ")} — not HOST-C, whose port was the ingress.`, proven: x.seen("dev:SW1") && answered(x, q), action: openSw1(x) },
          { id: "desk", text: "Inspect DESK-SW: it processed its copy as a bridge", provenText: "DESK-SW learned HOST-C on port 1; with nothing on port 2 it had no other port to flood to.", proven: sawDesk(x) && !!lookup(x.lab.net.fdb["DESK-SW"], C), action: { label: "open DESK-SW", onClick: () => x.onInspectDevice("DESK-SW") } },
        ],
      };
    },
  },
  "t5-time-200": {
    title: "Time passes",
    summary: "200 s with no traffic. Every entry is 200 s old — still under the 300 s aging time.",
    key: "An entry's age is the time since its MAC last appeared as a SOURCE. Watch which frames reset it.",
    verify: [Q.aging],
    checks: (x) => ({ facts: [{ id: "aging", text: "Find SW1's aging time (CLI) or the ages in the State panel", provenText: `${FDB_AGING_SEC} s — nothing is that old yet.`, proven: x.seen("cli:mac-aging") || sawSw1(x), action: openSw1(x) }] }),
  },
  "t5-send": {
    title: "A refresh — for the source only",
    summary: "HOST-A's entry was refreshed to age 0. HOST-B's was not, even though the frame was addressed to it.",
    key: "Only a frame a host SENDS refreshes its entry. Being the destination does nothing to the timer.",
    checks: (x) => {
      const fresh = x.lab.net.fdb.SW1.filter((e) => e.lastSeen === x.lab.net.clock).map((e) => e.mac);
      const q: IdentifyDef = { id: "t5-reset", prompt: "Identify: whose age is 0 s now?", options: [A, B, C].map((m) => ({ id: m, label: who(m) })), multiple: true, correct: fresh };
      return { identify: [q], facts: [{ id: "age", text: "Inspect the ages (SW1's card or the State panel)", provenText: `Age 0: ${fresh.map(who).join(", ")}. HOST-B kept aging.`, proven: (x.seen("dev:SW1") || x.seen("card:SW1")) && answered(x, q), action: openSw1(x) }] };
    },
  },
  "t5-time-150": {
    title: "Entries age out",
    summary: "At t=350 s, every entry not refreshed in the last 300 s expired.",
    key: `Aging is per entry, from its own last source frame: older than ${FDB_AGING_SEC} s → removed. A frame to a removed host is unknown unicast again.`,
    verify: [Q.table],
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
    verify: [Q.behind2],
    checks: (x) => ({ facts: [{ id: "b-back", text: "Find HOST-B's entry in SW1's table", provenText: `HOST-B → ${lookup(x.lab.net.fdb.SW1, B)?.port}.`, proven: (sawSw1(x) || x.seen("cli:mac-table-interface") || x.seen("cli:mac-table-address")) && lookup(x.lab.net.fdb.SW1, B)?.port === "ge-0/0/2", action: openSw1(x) }] }),
  },
  "t6-move": {
    title: "HOST-B moves to the hot desk",
    summary: "ge-0/0/2 went down and SW1 forgot HOST-B. Nothing told SW1 where HOST-B went.",
    key: "A link going down flushes the entries learned on it. A switch learns a NEW location only from a frame the host sends.",
    verify: [Q.status, Q.table],
    checks: (x) => ({
      facts: [
        { id: "down", text: "Check the interface state: is HOST-B's old port down?", provenText: "ge-0/0/2 (Gi1/0/2) is down (notconnect).", proven: (cliRan(x, ["interfaces-status", "interface-detail"]) || x.seen("dev:SW1")) && x.lab.net.downPorts.includes("SW1 ge-0/0/2"), action: openSw1(x) },
        { id: "flushed", text: "Confirm SW1 no longer has HOST-B", provenText: "SW1 has no entry for HOST-B — flushed with ge-0/0/2.", proven: sawSw1(x) && !lookup(x.lab.net.fdb.SW1, B), action: openSw1(x) },
      ],
    }),
  },
  "t6-b-sends": {
    title: "HOST-B speaks from the hot desk",
    summary: "DESK-SW learned HOST-B on port 2, and SW1 learned HOST-B behind ge-0/0/4 — correct, for now.",
    key: "Each switch learns from the frame arriving on ITS port: for SW1, HOST-B now lives behind ge-0/0/4 (the DESK-SW uplink).",
    verify: [Q.behind4],
    checks: (x) => ({ facts: [{ id: "b-ge4", text: "Find where SW1 now places HOST-B", provenText: `HOST-B → ${lookup(x.lab.net.fdb.SW1, B)?.port}.`, proven: (sawSw1(x) || x.seen("cli:mac-table-interface") || x.seen("cli:mac-table-address")) && lookup(x.lab.net.fdb.SW1, B)?.port === "ge-0/0/4", action: openSw1(x) }] }),
  },
  "t6-move-back": {
    title: "HOST-B returns to ge-0/0/2",
    summary: "ge-0/0/2 came up and DESK-SW's port 2 went down. HOST-B hasn't sent anything since.",
    key: "A link coming up tells SW1 nothing about which MACs are behind it — only frames do.",
    verify: [Q.status],
    checks: (x) => ({ facts: [{ id: "up", text: "Check the interface state again", provenText: "Gi1/0/2 (ge-0/0/2) is up again; Gi1/0/4 never went down.", proven: (cliRan(x, ["interfaces-status", "interface-detail"]) || x.seen("dev:SW1")) && !x.lab.net.downPorts.length, action: openSw1(x) }] }),
  },
  "t8-repair": {
    title: "Fix applied — not verified yet",
    summary: "SW1 has no entry for HOST-B now. That removes the wrong answer; it doesn't provide the right one.",
    key: "SW1 must relearn HOST-B from a frame HOST-B sends on ge-0/0/2. Prove it with traffic, then with the CLI.",
    verify: [Q.macB],
    checks: (x) => ({ facts: [{ id: "cleared", text: "Confirm on SW1 that the HOST-B entry is gone", provenText: "No HOST-B entry: the next frame to HOST-B will be flooded.", proven: sawSw1(x) && !lookup(x.lab.net.fdb.SW1, B), action: openSw1(x) }] }),
  },
  "t8-verify-1": {
    title: "Verify 1: flood reaches HOST-B",
    summary: "HOST-B is unknown, so SW1 flooded — and the copy on ge-0/0/2 reached HOST-B.",
    key: "Unknown unicast is how a switch reaches a host it doesn't know yet. Now HOST-B must reply.",
  },
  "t8-verify-2": {
    title: "Verify 2: HOST-B relearned",
    summary: "HOST-B's reply arrived on ge-0/0/2, so SW1 learned HOST-B where it really is.",
    key: "The repair completes when the host sources a frame from its real port.",
    verify: [Q.macB, Q.behind2],
    checks: (x) => ({ facts: [{ id: "relearned", text: "Check HOST-B's entry", provenText: `HOST-B → ${lookup(x.lab.net.fdb.SW1, B)?.port}.`, proven: (sawSw1(x) || x.seen("cli:mac-table-interface") || x.seen("cli:mac-table-address")) && lookup(x.lab.net.fdb.SW1, B)?.port === "ge-0/0/2", action: openSw1(x) }] }),
  },
  "t8-verify-3": {
    title: "Verified: known unicast to HOST-B",
    summary: "HOST-A → HOST-B left ge-0/0/2 only and HOST-B accepted it. Service restored, proven by traffic.",
    key: "Repair is verified by traffic AND state: flood → reply → relearn on the right port → known unicast.",
    verify: [Q.macB],
    checks: (x) => ({ facts: [{ id: "verified", text: "Run a MAC-table command on SW1's CLI and confirm HOST-B on Gi1/0/2 (ge-0/0/2)", provenText: "SW1's CLI shows HOST-B on ge-0/0/2, and the last frame used that port only.", proven: cliRan(x, CLI_TABLE) && ethRepairVerified(x.lab) }] }),
  },
};

// ---------------------------------------------------------------------------------------------------------------
// The incident (T7): symptom → observation → evidence → hypothesis → test → root cause
// ---------------------------------------------------------------------------------------------------------------
const HYPOTHESES: PredictionOption[] = [
  { id: "stale", label: "SW1's entry for HOST-B points to the wrong port" },
  { id: "mac", label: "HOST-B's MAC address changed" },
  { id: "arp", label: "HOST-A has the wrong MAC for HOST-B" },
  { id: "link", label: "HOST-B's port is down" },
  { id: "flood", label: "SW1's flooding is broken" },
];
const TESTS: PredictionOption[] = [
  { id: "contradiction", label: "SW1 has HOST-B behind ge-0/0/4, but HOST-B is plugged into ge-0/0/2 (up)" },
  { id: "dst", label: "The frame's destination MAC is HOST-B's MAC" },
  { id: "desk", label: "DESK-SW has no entry for HOST-B" },
];

export function ethIncidentEvidence(x: EthBoardCtx) {
  const from = x.lab.tx?.id ?? x.lab.seq;
  const ran = (ids: string[]) => ids.some((id) => x.seenSince(from, `cli:${id}`));
  const dead = x.lab.tx?.segments.find((g) => g.outcome === "dead-end");
  return [
    { id: "e-table", text: "Where does SW1 think HOST-B is? — run a MAC-table command on SW1", provenText: `SW1's table: HOST-B → ${lookup(x.lab.net.fdb.SW1, B)?.port ?? "no entry"}.`, proven: ran(["mac-table", "mac-table-dynamic", "mac-table-address"]) },
    { id: "e-status", text: "Is the port HOST-B is plugged into up? — check interface state on SW1", provenText: "Every SW1 port is up (Gi1/0/2 = ge-0/0/2 included).", proven: ran(["interfaces-status", "interface-detail"]) },
    { id: "e-host", text: "Where is HOST-B physically plugged in? — open HOST-B", provenText: `HOST-B is plugged into ${hostAttachment(x.lab.net, "HOST-B").sw} ${hostAttachment(x.lab.net, "HOST-B").port}.`, proven: x.seenSince(from, "dev:HOST-B"), action: { label: "open HOST-B", onClick: () => x.onInspectDevice("HOST-B") } },
    { id: "e-stop", text: "Where did the frame stop? — open DESK-SW or inspect the copy", provenText: "At DESK-SW: no entry for HOST-B there, and no other port up.", proven: x.seenSince(from, "dev:DESK-SW") || (!!dead && x.seenSince(from, `pkt:${dead.id}`)), action: { label: "open DESK-SW", onClick: () => x.onInspectDevice("DESK-SW") } },
  ] satisfies EngineerCheckFact[];
}

/** Investigation complete: all evidence gathered, hypothesis and test answered correctly (from state). */
export function ethIncidentSolved(x: EthBoardCtx): boolean {
  const stale = ethHostBStale(x.lab);
  return ethIncidentEvidence(x).every((f) => f.proven) && stale && sameSet(x.answer("incident|hypothesis"), ["stale"]) && sameSet(x.answer("incident|test"), ["contradiction"]);
}

const REPAIR_FEEDBACK: Record<string, string> = {
  "static-ge4": "A static entry pins HOST-B to ge-0/0/4 — the wrong port — permanently. SW1 would never relearn the right one.",
  "arp-entry": "HOST-A's frame already carries HOST-B's real MAC (check the packet). ARP maps IP → MAC; it can't change WHERE SW1 thinks that MAC lives.",
  "reboot-a": "HOST-A addresses its frames correctly. The wrong information is in SW1's table, not in HOST-A.",
};

function Incident({ x }: { x: EthBoardCtx }) {
  const evidence = ethIncidentEvidence(x);
  const gathered = evidence.filter((f) => f.proven).length;
  const hyp = x.answer("incident|hypothesis");
  const test = x.answer("incident|test");
  const hypOk = sameSet(hyp, ["stale"]) && ethHostBStale(x.lab);
  const testOk = sameSet(test, ["contradiction"]);
  const solved = ethIncidentSolved(x);
  return (
    <>
      <BoardSection label="Symptom" tone="cyan">
        <TeachingEventRows rows={x.lab.tx ? sendRows(x.lab.tx, x.lab.net) : []} />
      </BoardSection>
      <BoardSection label="Observation">
        <p className="text-[12.5px] leading-snug text-pv-text-muted">The frame left SW1 as <b className="text-pv-text">known unicast</b> — one port — and HOST-B never received it. No device reported an error. Don&apos;t guess: gather evidence from the live network.</p>
      </BoardSection>
      <EngineerCheck intro="Evidence — each item needs a real inspection (an executed CLI command, a device card, a packet copy):" facts={evidence} footnote="Gather at least three pieces of evidence to unlock the hypothesis." />
      <BoardSection label="How do I find out?" tone="violet">
        <CommandHelp items={verifyItems(x, [Q.table, Q.status, Q.behind2, Q.behind4])} />
      </BoardSection>
      {gathered >= 3 && (
        <PredictionBlock
          label="Hypothesis"
          prompt="What is the most likely cause?"
          options={HYPOTHESES}
          value={hyp}
          onChange={(v) => x.onAnswer("incident|hypothesis", v)}
          verdict={hyp.length ? <Verdict correct={hypOk}>{hypOk ? "Consistent with the evidence. Now test it: which observation proves it?" : "That doesn't fit the evidence you gathered — look at it again."}</Verdict> : undefined}
        />
      )}
      {hypOk && (
        <PredictionBlock
          label="Test"
          prompt="Which observation proves the hypothesis?"
          options={TESTS}
          value={test}
          onChange={(v) => x.onAnswer("incident|test", v)}
          verdict={test.length ? <Verdict correct={testOk}>{testOk ? "That contradiction is the proof: the table and the cabling disagree." : "True, but it doesn't prove the cause — it's consistent with a healthy network too."}</Verdict> : undefined}
        />
      )}
      {solved && (
        <KeyLesson>
          <b>Root cause — a stale dynamic entry.</b> SW1 learned HOST-B behind ge-0/0/4 while HOST-B sat at the hot desk → ge-0/0/4 never went down, so nothing flushed it → ge-0/0/2 coming up taught SW1 nothing → HOST-B hasn&apos;t sent a frame from ge-0/0/2 yet, and the entry hasn&apos;t aged out. SW1 forwards correctly — by a table that is out of date.
        </KeyLesson>
      )}
    </>
  );
}

function RepairChoice({ x }: { x: EthBoardCtx }) {
  const choice = x.answer("repair-choice");
  const last = x.lab.last;
  return (
    <>
      <PredictionBlock label="Repair" prompt="Choose the change that fixes the cause you proved." options={ETH_LAB_REPAIRS.map((r) => ({ id: r.id, label: r.label }))} value={choice} onChange={(v) => x.onAnswer("repair-choice", v)} />
      {last?.type === "repair" && !last.correct && <Verdict correct={false}>{REPAIR_FEEDBACK[last.choice] ?? "That doesn't address the cause."} Nothing changed — pick again.</Verdict>}
    </>
  );
}

/** Are all engineer checks of a step's observation proven (for the learning-loop indicator)? */
export function ethStepChecksDone(stepId: string, x: EthBoardCtx): boolean {
  if (stepId === "t7-reproduce") return ethIncidentSolved(x);
  const c = COPY[stepId]?.checks?.(x);
  return !c || c.facts.every((f) => f.proven);
}

function IdentifyBlock({ x, q }: { x: EthBoardCtx; q: IdentifyDef }) {
  const key = `${x.lab.seq}|${q.id}`;
  const v = x.answer(key);
  const ok = q.correct.length > 0 && sameSet(v, q.correct);
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
  const incident = !freePlay && prev?.id === "t7-reproduce";

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
  const t0Facts: EngineerCheckFact[] = [{ id: "t0", text: "Inspect SW1 (CLI or device card) and confirm its table holds 0 entries", provenText: "SW1's table: 0 entries.", proven: sawSw1(props) && lab.net.fdb.SW1.length === 0, action: openSw1(props) }];

  return (
    <TeachingBoard
      phase={freePlay ? "Free play" : `T${prev?.stage ?? 0} · ${ETH_LAB_STAGES[prev?.stage ?? 0]}`}
      title={freePlay ? (lab.last ? "What just happened" : "Free play") : incident ? "Incident: HOST-A can't reach HOST-B" : (copy?.title ?? "Before anything moves")}
      summary={freePlay ? "Send any frame, let time pass, move HOST-B or clear an entry. Same network, same rules — verify on SW1's CLI." : incident ? "Reproduced. Now troubleshoot from evidence: observe → gather evidence → hypothesis → test → root cause." : (copy?.summary ?? "SW1 and DESK-SW have just booted. HOST-B is on SW1 ge-0/0/2 and every link is up.")}
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
          <EngineerCheck intro="Prove it from the live network:" facts={t0Facts} />
          <BoardSection label="Verify on SW1's CLI" tone="violet">
            <CommandHelp items={verifyItems(props, [Q.table])} />
          </BoardSection>
        </>
      )}

      {incident && (
        <>
          {lastVerdicts.map(({ p, ans, ok }) => (
            <Verdict key={p.id} correct={ok}>
              <span className="font-semibold text-pv-text">{p.prompt}</span> You said: {ans.map((a) => p.options.find((o) => o.id === a)?.label ?? a).join(", ") || "—"}. {p.explain(lab)}
            </Verdict>
          ))}
          <Incident x={props} />
        </>
      )}

      {!incident && lab.last && (prev || freePlay) && (
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
              <EngineerCheck intro="Prove it from the live state — SW1's CLI, device cards, table rows and packet copies:" facts={checks.facts} />
            </>
          )}
          {(copy?.verify || freePlay) && (
            <BoardSection label="Verify on SW1's CLI" tone="violet">
              <CommandHelp items={verifyItems(props, copy?.verify ?? [Q.table, Q.status])} />
            </BoardSection>
          )}
        </>
      )}

      {next?.repair && <RepairChoice x={props} />}
      {next?.predict?.map((p) => (
        <PredictionBlock key={p.id} prompt={p.prompt} options={p.options} multiple={p.multiple} value={props.answer(p.id)} onChange={(v) => props.onAnswer(p.id, v)} />
      ))}
      {next && <NextAction>{props.gate ?? `${next.label}.`}</NextAction>}
      {!next && !freePlay && <NextAction>Guided steps complete — continue in free play.</NextAction>}
      {freePlay && <NextAction>Pick a source and destination below the topology, then send.</NextAction>}
      {incident ? (
        <DeepenUnderstanding
          qa={[
            { q: "Would anything else have cleared the entry?", a: "Yes. Any frame SOURCED by HOST-B on ge-0/0/2 relearns it there (that is why an ARP exchange often “fixes” such problems as a side effect). The entry also ages out after 300 s without frames from HOST-B. Bouncing ge-0/0/4 flushes it too — and everything else learned behind DESK-SW." },
            { q: "What's the real command for the targeted fix?", a: "Cisco: clear mac address-table dynamic address 0011.2233.440b. The lab's CLI is read-only, so the repair is applied as a lab action." },
          ]}
        />
      ) : (
        copy?.deepen && <DeepenUnderstanding qa={copy.deepen} />
      )}
    </TeachingBoard>
  );
}
