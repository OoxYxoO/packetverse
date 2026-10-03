"use client";

import type { ReactNode } from "react";
import { BoardSection, CommandHelp, DeepenUnderstanding, EngineerCheck, KeyLesson, NextAction, PredictionBlock, StateDeltaChips, TeachingBoard, TeachingEventRows, Verdict, type CommandHelpItem, type EngineerCheckFact, type PredictionOption, type StateDelta, type TeachingEventRowDef } from "@/components/practice-lab/TeachingBoard";
import { BROADCAST_MAC, HOST_ATTACH, LOOP_WAVES_SHOWN, PRIMARY_PORT, SECONDARY_PORT, SWF_MAC, SWF_PORTS, SWF_REPAIR_CORRECT, frameDst, lookup, macName, portInfo, type SwfDevice, type SwfHost, type SwfSwitch } from "@/lib/sim-engine/scenarios/switchingFundamentals";
import { SWF_LAB_MODEL, SWF_LAB_REPAIRS, swfCopiesPerHost, swfDelivered, type SwfLabAction, type SwfLabState, type SwfTransmission } from "@/lib/sim-engine/scenarios/switchingLab";
import { ciscoMac } from "@/lib/cli/format";
import type { CliVendor } from "@/lib/cli/types";

/**
 * Switching Lab Teaching Board — the Switching composition of the generic board primitives. It owns every
 * explanation, the guided T0→T9 script, predictions, engineer checks and the loop incident; primitives own layout.
 *
 * Every board answers: what happened · what changed · why · why it matters · how to verify it (both switches' CLIs,
 * device cards, table rows, packet copies) · what to do next. Prediction answers are frozen from a pure dry run when
 * the action runs. A check needs an inspection made after the event (a successfully executed command ON THE RIGHT
 * SWITCH, a device card, a row "Why?", a packet copy) AND the matching lab state. Tab / `?` never count.
 */

const A = SWF_MAC["HOST-A"];
const B = SWF_MAC["HOST-B"];
const D = SWF_MAC["HOST-D"];
const who = (mac: string) => (mac === BROADCAST_MAC ? "broadcast" : macName(mac));
const short = (mac: string) => (mac === BROADCAST_MAC ? "FF:FF:FF:FF:FF:FF" : `…:${mac.slice(-2)}`);
const other = (sw: SwfSwitch): SwfSwitch => (sw === "SW1" ? "SW2" : "SW1");
const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

export const SWF_LAB_STAGES = ["Baseline", "First frame", "Reply", "Known unicast", "Local traffic", "Partial knowledge", "Broadcast", "Second link", "Incident", "Repair & verify"];

/** Where an entry points, in plain words: a host's own access port, or "behind" the other switch. */
export function swfLocation(sw: SwfSwitch, port: string): string {
  const p = portInfo(sw, port);
  return p?.kind === "access" ? `local — ${p.peer}'s own port` : `behind ${other(sw)} via ${port}`;
}

export function swfLabDryRun(s: SwfLabState, a: SwfLabAction): SwfLabState {
  const hops = SWF_LAB_MODEL.hops(s, a);
  let n = SWF_LAB_MODEL.start(s, a);
  for (let i = 0; i < hops; i++) n = SWF_LAB_MODEL.arrive(n);
  return n;
}

interface PredictDef {
  id: string;
  prompt: string;
  options: PredictionOption[];
  multiple?: boolean;
  correct: (before: SwfLabState, after: SwfLabState) => string[];
  explain: string;
}
export interface SwfScriptStep {
  id: string;
  stage: number;
  phase: string;
  action: SwfLabAction;
  label: string;
  predict?: PredictDef[];
  /** The incident's repair: only advances when the chosen fix is the right one. */
  repair?: boolean;
}

const decisionOf = (s: SwfLabState, sw: SwfSwitch) => s.tx?.decisions.find((d) => d.sw === sw);
const flooders = (s: SwfLabState) => [...new Set((s.tx?.decisions ?? []).filter((d) => d.kind === "unknown-unicast" || d.kind === "broadcast").map((d) => d.sw))];
const send = (src: SwfHost, dst: SwfHost | "broadcast", arpFor?: SwfHost): SwfLabAction => ({ type: "send", src, dst, arpFor });

export const SWF_LAB_SCRIPT: SwfScriptStep[] = [
  {
    id: "t1",
    stage: 1,
    phase: "T1",
    action: send("HOST-A", "HOST-B"),
    label: "Send HOST-A → HOST-B",
    predict: [
      {
        id: "t1-flood",
        prompt: "Neither switch has heard from HOST-B. Which switches flood HOST-A's frame?",
        options: [
          { id: "both", label: "Both SW1 and SW2" },
          { id: "SW1", label: "Only SW1" },
          { id: "SW2", label: "Only SW2" },
          { id: "none", label: "Neither" },
        ],
        correct: (_b, a) => {
          const f = flooders(a);
          return [f.length === 2 ? "both" : f.length === 1 ? f[0] : "none"];
        },
        explain: "Each switch looks up HOST-B in its OWN table. Both tables are empty, so both lookups miss and both switches flood.",
      },
      {
        id: "t1-sw2port",
        prompt: "When the copy reaches SW2, where does SW2 learn HOST-A?",
        options: [
          { id: PRIMARY_PORT, label: `${PRIMARY_PORT} — the link to SW1` },
          { id: "ge-0/0/1", label: "ge-0/0/1 — HOST-A's port on SW1" },
          { id: "synced", label: "SW1 tells SW2 where HOST-A is" },
        ],
        correct: (_b, a) => [a.tx?.learned.find((l) => l.sw === "SW2" && l.mac === A)?.port ?? "synced"],
        explain: `SW2 learns from the frame arriving on ITS port: ${PRIMARY_PORT}. Nothing is synchronised between switches.`,
      },
    ],
  },
  {
    id: "t2",
    stage: 2,
    phase: "T2",
    action: send("HOST-B", "HOST-A"),
    label: "Send HOST-B → HOST-A",
    predict: [
      {
        id: "t2-fwd",
        prompt: "HOST-B replies to HOST-A. What do the two switches do?",
        options: [
          { id: "both-forward", label: "Both forward out one port" },
          { id: "both-flood", label: "Both flood" },
          { id: "sw2-flood", label: "SW2 floods, SW1 forwards" },
        ],
        correct: (_b, a) => {
          const k1 = decisionOf(a, "SW1")?.kind;
          const k2 = decisionOf(a, "SW2")?.kind;
          return [k1 === "known-unicast" && k2 === "known-unicast" ? "both-forward" : k1 === "unknown-unicast" && k2 === "unknown-unicast" ? "both-flood" : k2 === "unknown-unicast" ? "sw2-flood" : ""];
        },
        explain: "Both switches learned HOST-A from the first frame — each on its own port — so both lookups hit.",
      },
    ],
  },
  {
    id: "t3",
    stage: 3,
    phase: "T3",
    action: send("HOST-A", "HOST-B"),
    label: "Send HOST-A → HOST-B again",
    predict: [
      {
        id: "t3-lookups",
        prompt: "How many MAC-table lookups decide where this frame goes?",
        options: [
          { id: "2", label: "Two — one per switch" },
          { id: "1", label: "One — SW1 decides the whole path" },
          { id: "0", label: "None — the path is cached" },
        ],
        correct: (_b, a) => [String(a.tx?.decisions.length ?? 0)],
        explain: "Every bridge decides on its own, from its own table: SW1 picks ge-0/0/23, then SW2 picks ge-0/0/1.",
      },
    ],
  },
  {
    id: "t4-d",
    stage: 4,
    phase: "T4",
    action: send("HOST-D", "HOST-A"),
    label: "Send HOST-D → HOST-A",
    predict: [
      {
        id: "t4-sw2",
        prompt: "HOST-D (on SW1) sends to HOST-A (on SW1). Will SW2 learn HOST-D?",
        options: [
          { id: "no", label: "No — the frame never reaches SW2" },
          { id: "yes", label: "Yes — SW1 shares what it learns" },
        ],
        correct: (_b, a) => [lookup(a.net.fdb.SW2, D) ? "yes" : "no"],
        explain: "HOST-A is known on ge-0/0/1, so the frame stays on SW1. A switch cannot learn from a frame it never receives.",
      },
    ],
  },
  {
    id: "t4-a",
    stage: 4,
    phase: "T4",
    action: send("HOST-A", "HOST-D"),
    label: "Send HOST-A → HOST-D",
    predict: [
      {
        id: "t4-cross",
        prompt: "HOST-A answers HOST-D. Does this frame cross ge-0/0/23?",
        options: [
          { id: "no", label: "No — SW1 knows HOST-D on ge-0/0/2" },
          { id: "yes", label: "Yes — SW1 floods it" },
        ],
        correct: (_b, a) => [a.tx?.segments.some((g) => g.egress === PRIMARY_PORT) ? "yes" : "no"],
        explain: "SW1 learned HOST-D from HOST-D's own frame, so this is known unicast out ge-0/0/2 only. SW2 still knows nothing about HOST-D.",
      },
    ],
  },
  {
    id: "t5",
    stage: 5,
    phase: "T5",
    action: send("HOST-C", "HOST-D"),
    label: "Send HOST-C → HOST-D",
    predict: [
      {
        id: "t5-who",
        prompt: "HOST-C (on SW2) sends to HOST-D (on SW1). What do the switches do?",
        options: [
          { id: "sw2-flood", label: "SW2 floods, SW1 forwards" },
          { id: "both-flood", label: "Both flood" },
          { id: "both-forward", label: "Both forward" },
          { id: "sw1-flood", label: "SW1 floods, SW2 forwards" },
        ],
        correct: (_b, a) => {
          const k1 = decisionOf(a, "SW1")?.kind;
          const k2 = decisionOf(a, "SW2")?.kind;
          return [k2 === "unknown-unicast" && k1 === "known-unicast" ? "sw2-flood" : k1 === "unknown-unicast" && k2 === "unknown-unicast" ? "both-flood" : k1 === "known-unicast" && k2 === "known-unicast" ? "both-forward" : "sw1-flood"];
        },
        explain: "SW2 never saw a frame from HOST-D, so it floods. SW1 learned HOST-D from HOST-D's own frames, so it forwards to ge-0/0/2 only.",
      },
    ],
  },
  {
    id: "t6",
    stage: 6,
    phase: "T6",
    action: send("HOST-D", "broadcast", "HOST-C"),
    label: "Send HOST-D broadcast",
    predict: [
      {
        id: "t6-recv",
        prompt: "HOST-D broadcasts an ARP request for HOST-C. Who receives a copy — and how many?",
        options: [
          { id: "one-each", label: "HOST-A, HOST-B and HOST-C — one copy each" },
          { id: "sw1-only", label: "Only HOST-A (SW1's other host)" },
          { id: "all-incl-d", label: "Every host, HOST-D included" },
          { id: "dup", label: "Every other host, twice" },
        ],
        correct: (_b, a) => {
          if (!a.tx) return [];
          const c = swfCopiesPerHost(a.tx);
          return [c["HOST-D"] > 0 ? "all-incl-d" : c["HOST-B"] === 0 ? "sw1-only" : Math.max(c["HOST-A"], c["HOST-B"], c["HOST-C"]) > 1 ? "dup" : "one-each"];
        },
        explain: "Every other host in the broadcast domain — across both switches — exactly once. Never back to HOST-D through its own ingress port.",
      },
    ],
  },
  {
    id: "t7-enable",
    stage: 7,
    phase: "T7",
    action: { type: "enable-secondary" },
    label: `Enable ${SECONDARY_PORT} on both switches`,
    predict: [
      {
        id: "t7-expect",
        prompt: `A technician enables ${SECONDARY_PORT} "for redundancy". Both SW1↔SW2 links will forward and NO loop prevention runs. What will happen to the next broadcast?`,
        options: [
          { id: "loop", label: "Copies keep circling between SW1 and SW2" },
          { id: "one-link", label: "SW1 uses one link and ignores the other" },
          { id: "share", label: "Each link carries half; every host gets one copy" },
          { id: "stp", label: "Spanning Tree blocks one link automatically" },
        ],
        correct: (_b, a) => [swfLabDryRun(a, send("HOST-A", "broadcast", "HOST-B")).circulating.length > 0 ? "loop" : "one-link"],
        explain: "A flood leaves on every forwarding port except the ingress — both inter-switch links. Each copy comes back on the other link, and Ethernet has no TTL to stop it. No STP runs in this lab.",
      },
    ],
  },
  {
    id: "t7-bcast",
    stage: 7,
    phase: "T7",
    action: send("HOST-A", "broadcast", "HOST-B"),
    label: "Send HOST-A broadcast",
    predict: [
      {
        id: "t7-copies",
        prompt: "How many copies of HOST-A's broadcast does SW1 send toward SW2?",
        options: [
          { id: "2", label: "Two — one out each forwarding link" },
          { id: "1", label: "One" },
          { id: "0", label: "None" },
        ],
        correct: (_b, a) => {
          const d = a.tx?.decisions.find((x) => x.sw === "SW1");
          return [String(d ? d.egress.filter((p) => p === PRIMARY_PORT || p === SECONDARY_PORT).length : 0)];
        },
        explain: "SW1 doesn't know both ports lead to the same switch — each is just a forwarding port, so one copy leaves on each.",
      },
    ],
  },
  {
    id: "t8-symptom",
    stage: 8,
    phase: "T8",
    action: send("HOST-D", "HOST-A"),
    label: "Ticket: “HOST-D can't reach HOST-A” — reproduce it",
    predict: [
      {
        id: "t8-expect",
        prompt: "HOST-D and HOST-A are both on SW1. What do you expect will happen to HOST-D → HOST-A now?",
        options: [
          { id: "delivered", label: "SW1 delivers it out ge-0/0/1" },
          { id: "away", label: "SW1 sends it toward SW2" },
          { id: "flood", label: "SW1 floods it" },
        ],
        correct: (_b, a) => {
          const d = a.tx?.decisions.find((x) => x.sw === "SW1");
          return [d?.kind === "unknown-unicast" ? "flood" : d?.egress.includes("ge-0/0/1") ? "delivered" : "away"];
        },
        explain: "SW1 forwarded it as known unicast — toward SW2. Now find out why from the evidence.",
      },
    ],
  },
  { id: "t9-repair", stage: 9, phase: "T9", action: { type: "repair", choice: SWF_REPAIR_CORRECT }, label: "Apply the selected fix", repair: true },
  {
    id: "t9-verify-bcast",
    stage: 9,
    phase: "T9",
    action: send("HOST-A", "broadcast", "HOST-B"),
    label: "Verify: HOST-A broadcast",
    predict: [
      {
        id: "t9-copies",
        prompt: "One SW1↔SW2 link forwards again. How many copies of HOST-A's broadcast will each other host receive?",
        options: [
          { id: "one", label: "Exactly one" },
          { id: "two", label: "Two" },
          { id: "growing", label: "More every wave" },
        ],
        correct: (_b, a) => {
          if (!a.tx) return [];
          const c = swfCopiesPerHost(a.tx);
          const max = Math.max(c["HOST-B"], c["HOST-C"], c["HOST-D"]);
          return [a.circulating.length ? "growing" : max === 1 ? "one" : "two"];
        },
        explain: "With one path between the switches, a flooded copy can never come back to the switch that sent it.",
      },
    ],
  },
  { id: "t9-verify-uni", stage: 9, phase: "T9", action: send("HOST-B", "HOST-A"), label: "Verify: HOST-B → HOST-A" },
];

export const SWF_LAB_REPAIR_INDEX = SWF_LAB_SCRIPT.findIndex((s) => s.repair);

export function swfRevealFor(step: SwfScriptStep, before: SwfLabState): Record<string, string[]> {
  if (!step.predict) return {};
  const after = swfLabDryRun(before, step.action);
  return Object.fromEntries(step.predict.map((p) => [p.id, p.correct(before, after)]));
}

/** Repair proven by traffic: no copies left, one copy per host on the last broadcast, HOST-A stable on its real ports. */
export function swfRepairVerified(s: SwfLabState): boolean {
  const d1 = decisionOf(s, "SW1");
  const d2 = decisionOf(s, "SW2");
  return !s.net.secondaryUp && !s.circulating.length && s.last?.type === "send" && s.tx?.src === "HOST-B" && s.tx.dst === "HOST-A" && d2?.kind === "known-unicast" && d1?.kind === "known-unicast" && lookup(s.net.fdb.SW1, A)?.port === "ge-0/0/1" && lookup(s.net.fdb.SW2, A)?.port === PRIMARY_PORT && swfDelivered(s.tx);
}

// ---------------------------------------------------------------------------------------------------------------
// Observation — derived from the latest lab event. Row keys are actor names, so each actor appears once.
// ---------------------------------------------------------------------------------------------------------------
const KIND_TEXT: Record<string, string> = { "unknown-unicast": "UNKNOWN UNICAST → flood", "known-unicast": "KNOWN UNICAST → one port", broadcast: "BROADCAST → flood", filter: "FILTER → nothing sent" };
export const swfKindText = (k: string) => KIND_TEXT[k] ?? k;

function sendRows(tx: SwfTransmission, s: SwfLabState): TeachingEventRowDef[] {
  const dst = frameDst(tx.frame);
  const rows: TeachingEventRowDef[] = [];
  if (tx.kind === "send") {
    const at = HOST_ATTACH[tx.src];
    rows.push({ who: tx.src, body: `sent dst ${dst} (${who(dst)}) · src ${SWF_MAC[tx.src]} into ${at.sw} ${at.port}.`, short: `sent to ${who(dst)} via ${at.sw} ${at.port}.` });
  } else rows.push({ who: "Drain", body: `the copies still on ${PRIMARY_PORT} were delivered with one SW1↔SW2 link forwarding.` });
  (["SW1", "SW2"] as SwfSwitch[]).forEach((sw) => {
    const ds = tx.decisions.filter((d) => d.sw === sw);
    if (!ds.length) return;
    const ls = tx.learned.filter((l) => l.sw === sw);
    const learnText = ls.map((l) => (l.kind === "learned" ? `learned ${who(l.mac)} → ${l.port}` : l.kind === "moved" ? `MOVED ${who(l.mac)} ${l.from} → ${l.port}` : `refreshed ${who(l.mac)} on ${l.port}`)).join("; then ");
    const decide = ds
      .map((d) =>
        d.kind === "broadcast"
          ? `broadcast in on ${d.ingress} → flooded out ${d.egress.join(", ")}`
          : d.kind === "unknown-unicast"
            ? `${short(dst)} not in ${sw}'s table → flooded out ${d.egress.join(", ")}`
            : d.kind === "known-unicast"
              ? `${short(dst)} found in ${sw}'s table → out ${d.egress.join(", ")} only`
              : `${short(dst)} is behind ${d.ingress}, the port it came in on → filtered`,
      )
      .join("; ");
    rows.push({ who: sw, tone: ds.every((d) => d.kind === "known-unicast") ? "device" : "attention", body: `${learnText}. ${decide}.${ds.length > 1 ? ` (${ds.length} copies processed)` : ""}`, short: `${learnText}; ${decide}.` });
  });
  const copies = swfCopiesPerHost(tx);
  (Object.keys(copies) as SwfHost[]).forEach((h) => {
    const r = tx.received.filter((x) => x.host === h);
    if (!r.length) return;
    const n = r.length;
    // Rows are keyed by actor: a looped copy reaching the sender extends the sender's row instead of adding one.
    if (h === tx.src && tx.kind === "send") {
      rows[0] = { ...rows[0], tone: "attention", body: `${rows[0].body} Its own broadcast came back ${n}× — looped copies.`, short: `${rows[0].short ?? ""} Got it back ${n}×.` };
      return;
    }
    rows.push({ who: h, tone: n > 1 ? "attention" : r[0].accepted ? "result" : "attention", body: r[0].accepted ? `accepted${n > 1 ? ` — ${n} copies of ONE frame` : ""}${h === tx.src ? " — its own broadcast came back" : ""}.` : `got ${n > 1 ? `${n} flooded copies` : "a flooded copy"} but discarded — destination ${short(dst)} is ${who(dst)}.`, short: n > 1 ? `${n} copies.` : r[0].accepted ? "accepted." : "discarded." });
  });
  const untouched = (["SW1", "SW2"] as SwfSwitch[]).filter((sw) => !tx.decisions.some((d) => d.sw === sw));
  if (untouched.length && tx.wave >= tx.waves) rows.push({ who: "Not involved", body: `${untouched.join(", ")} never received this frame — so ${untouched.length > 1 ? "they" : "it"} learned nothing from it.` });
  if (s.circulating.length && tx.bridgeWaves >= LOOP_WAVES_SHOWN && tx.wave >= tx.waves) rows.push({ who: "Loop", tone: "attention", body: `the drawing stops after ${LOOP_WAVES_SHOWN} bridge waves, with ${s.circulating.length} cop${s.circulating.length === 1 ? "y" : "ies"} still circulating. Ethernet has no TTL: in a real network these copies keep looping until a link is shut or loop prevention blocks one.` });
  if (tx.kind === "send" && tx.dst !== "broadcast" && !swfDelivered(tx) && tx.wave >= tx.waves) rows.push({ who: "Result", tone: "attention", body: `${tx.dst} never received the frame. No device reported an error.` });
  return rows;
}

function eventRows(s: SwfLabState): TeachingEventRowDef[] {
  const last = s.last;
  if (!last) return [];
  if (last.type === "send") return s.tx ? sendRows(s.tx, s) : [];
  if (last.type === "enable-secondary") return [{ who: "Change", tone: "attention", body: `${SECONDARY_PORT} enabled on SW1 and SW2 — two SW1↔SW2 links forward. No loop prevention runs in this lab.` }];
  if (last.type === "repair") {
    if (!last.correct) return [{ who: "Repair", body: `“${SWF_LAB_REPAIRS.find((r) => r.id === last.choice)?.label}” — ${last.cleared ? "both tables emptied, but" : "no effect:"} copies are still circulating over both links.` }];
    const rows: TeachingEventRowDef[] = [{ who: "Repair", tone: "attention", body: `${SECONDARY_PORT} disabled on SW1 and SW2 — one SW1↔SW2 path left. Entries learned on it were flushed${last.flushed?.length ? ` (${last.flushed.map((f) => `${f.sw}: ${who(f.mac)}`).join(", ")})` : ""}; ${last.lost} cop${last.lost === 1 ? "y was" : "ies were"} lost with the link.` }];
    return s.tx && s.tx.kind === "drain" ? [...rows, ...sendRows(s.tx, s).slice(1)] : rows;
  }
  return [
    { who: last.sw, tone: "attention", body: last.removed.length ? `dynamic entries cleared: ${last.removed.map((r) => who(r.mac)).join(", ")}.` : "had no dynamic entries to clear." },
    { who: other(last.sw), body: `kept its own table (${s.net.fdb[other(last.sw)].length} entries) — clearing one switch does not touch the other.` },
  ];
}

function deltas(s: SwfLabState): StateDelta[] {
  return (["SW1", "SW2"] as SwfSwitch[]).map((sw) => {
    const label = `${sw} table`;
    const last = s.last;
    if (last?.type === "clear") return { label, count: last.sw === sw ? last.removed.length : 0, text: last.sw === sw && last.removed.length ? `−${last.removed.length} CLEARED` : "UNCHANGED" };
    if (last?.type === "enable-secondary") return { label, count: 0, text: "UNCHANGED" };
    if (last?.type === "repair" && !last.correct) return { label, count: last.cleared ? 1 : 0, text: last.cleared ? "CLEARED" : "UNCHANGED" };
    if (last?.type === "repair") {
      const f = (last.flushed ?? []).filter((x) => x.sw === sw).length;
      const n = (s.tx?.id === s.seq ? s.tx.learned : []).filter((x) => x.sw === sw && x.kind !== "refreshed").length;
      return { label, count: f + n, text: [f && `−${f} FLUSHED`, n && `+${n} RELEARNED`].filter(Boolean).join(" · ") || "UNCHANGED" };
    }
    const l = (s.tx?.learned ?? []).filter((x) => x.sw === sw);
    const moved = l.filter((x) => x.kind === "moved").length;
    const n = l.filter((x) => x.kind === "learned").length;
    return { label, count: n || moved || (l.length ? 1 : 0), text: moved ? `${moved} MOVE${moved > 1 ? "S" : ""}` : n ? undefined : l.length ? "REFRESHED" : "NOT INVOLVED" };
  });
}

/** "Where is HOST-x?" — both switches' answers side by side (lesson-local comparison). */
function WhereIs({ s, host }: { s: SwfLabState; host: SwfHost }) {
  const mac = SWF_MAC[host];
  return (
    <BoardSection label={`Where is ${host}?`} tone="cyan">
      <div className="grid grid-cols-2 gap-2" aria-label={`Where is ${host} — SW1 and SW2`}>
        {(["SW1", "SW2"] as SwfSwitch[]).map((sw) => {
          const e = lookup(s.net.fdb[sw], mac);
          return (
            <div key={sw} className="rounded-lg border border-pv-border bg-black/20 p-2">
              <p className="text-[11px] font-bold text-pv-text">{sw}</p>
              <p className="pv-mono text-[11.5px] text-pv-cyan-soft">{e ? `${host.slice(-1)} → ${e.port}` : "no entry"}</p>
              <p className="text-[10.5px] text-pv-text-muted">{e ? swfLocation(sw, e.port) : "has never received a frame from it"}</p>
            </div>
          );
        })}
      </div>
    </BoardSection>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Context, inspections and CLI verification
// ---------------------------------------------------------------------------------------------------------------
export interface SwfBoardCtx {
  lab: SwfLabState;
  /** Inspected after the latest event? (`dev:X`, `card:X`, `pkt:<seg>`, `cli:<SW>:<commandId>`) */
  seen: (key: string) => boolean;
  seenSince: (fromSeq: number, key: string) => boolean;
  answer: (key: string) => string[];
  onAnswer: (key: string, v: string[]) => void;
  onInspectDevice: (id: SwfDevice) => void;
  onInspectCopy: (segId: string) => void;
  /** Place a command in one switch's terminal (does not run it). */
  onPutCommand: (sw: SwfSwitch, vendor: CliVendor, command: string) => void;
}
interface IdentifyDef {
  id: string;
  prompt: string;
  options: PredictionOption[];
  multiple?: boolean;
  correct: string[];
}

const MAC_CMDS = ["mac-table", "mac-table-dynamic", "mac-table-address", "mac-table-interface"];
const cliOn = (x: SwfBoardCtx, sw: SwfSwitch, ids: string[]) => ids.some((id) => x.seen(`cli:${sw}:${id}`));
/** A switch's table inspected: its device card, a row's Why?, or a MAC-table command on THAT switch's CLI. */
const saw = (x: SwfBoardCtx, sw: SwfSwitch) => x.seen(`dev:${sw}`) || x.seen(`card:${sw}`) || cliOn(x, sw, MAC_CMDS);
const sawBoth = (x: SwfBoardCtx) => saw(x, "SW1") && saw(x, "SW2");
const open = (x: SwfBoardCtx, sw: SwfSwitch) => ({ label: `open ${sw}`, onClick: () => x.onInspectDevice(sw) });
const openMissing = (x: SwfBoardCtx) => (saw(x, "SW1") ? open(x, "SW2") : open(x, "SW1"));
const answered = (x: SwfBoardCtx, q: IdentifyDef, key = `${x.lab.seq}|${q.id}`) => {
  const v = x.answer(key);
  return v.length > 0 && q.correct.length > 0 && sameSet(v, q.correct);
};
const portQ = (id: string, sw: SwfSwitch, host: SwfHost, s: SwfLabState): IdentifyDef => ({ id, prompt: `Identify: which port does ${sw} have for ${host}?`, options: SWF_PORTS[sw].map((p) => ({ id: p.port, label: p.port })), correct: [lookup(s.net.fdb[sw], SWF_MAC[host])?.port ?? ""] });
const receivers = (s: SwfLabState) => [...new Set((s.tx?.segments ?? []).filter((g) => g.from !== s.tx!.src).map((g) => g.to))];

interface VerifyQ {
  question: string;
  sw: SwfSwitch;
  cisco: string;
  junos: string;
}
const Q = {
  table1: { question: "What MACs does SW1 know?", sw: "SW1", cisco: "show mac address-table", junos: "show ethernet-switching table" },
  table2: { question: "What MACs does SW2 know?", sw: "SW2", cisco: "show mac address-table", junos: "show ethernet-switching table" },
  a1: { question: "Where did SW1 learn HOST-A?", sw: "SW1", cisco: `show mac address-table address ${ciscoMac(A)}`, junos: "show ethernet-switching table" },
  a2: { question: "Where did SW2 learn HOST-A?", sw: "SW2", cisco: `show mac address-table address ${ciscoMac(A)}`, junos: "show ethernet-switching table" },
  trunk1: { question: "What is behind SW1's link to SW2?", sw: "SW1", cisco: "show mac address-table interface Gi1/0/23", junos: "show ethernet-switching table interface ge-0/0/23" },
  d2: { question: "Does SW2 know HOST-D?", sw: "SW2", cisco: `show mac address-table address ${ciscoMac(D)}`, junos: "show ethernet-switching table" },
  links1: { question: "Are both SW1↔SW2 links up?", sw: "SW1", cisco: "show interfaces status", junos: "show interfaces terse" },
} satisfies Record<string, VerifyQ>;

function verifyItems(x: SwfBoardCtx, qs: VerifyQ[]): CommandHelpItem[] {
  return qs.map((q) => ({
    question: `${q.question} (${q.sw})`,
    commands: [
      { label: "Cisco", command: q.cisco },
      { label: "Junos", command: q.junos },
    ],
    onPut: () => x.onPutCommand(q.sw, "cisco", q.cisco),
    putLabel: `Put “${q.cisco}” in ${q.sw}'s Cisco terminal`,
  }));
}

interface StepCopy {
  title: string;
  summary: ReactNode;
  key: ReactNode;
  where?: SwfHost[];
  verify?: VerifyQ[];
  checks?: (x: SwfBoardCtx) => { facts: EngineerCheckFact[]; identify?: IdentifyDef[] };
  deepen?: { q: string; a: ReactNode }[];
}

const COPY: Record<string, StepCopy> = {
  t1: {
    title: "First frame: two bridges, two floods",
    summary: "SW1 and SW2 each learned HOST-A — on different ports — and each flooded, because neither has heard from HOST-B.",
    key: (
      <>
        <b>Same source MAC, different ports:</b> SW1 has HOST-A on ge-0/0/1 (local); SW2 has HOST-A on {PRIMARY_PORT} (behind SW1). Each table is built only from frames arriving on that switch&apos;s ports — nothing is synchronised. Both entries are correct.
      </>
    ),
    where: ["HOST-A"],
    verify: [Q.a1, Q.a2],
    checks: (x) => {
      const q1 = portQ("a-sw1", "SW1", "HOST-A", x.lab);
      const q2 = portQ("a-sw2", "SW2", "HOST-A", x.lab);
      const cSeg = x.lab.tx?.segments.find((g) => g.to === "HOST-C");
      return {
        identify: [q1, q2],
        facts: [
          { id: "a-sw1", text: "Inspect SW1 (its CLI or card) and identify HOST-A's port", provenText: `SW1: HOST-A → ${q1.correct[0]} (local).`, proven: saw(x, "SW1") && answered(x, q1), action: open(x, "SW1") },
          { id: "a-sw2", text: "Inspect SW2 (its CLI or card) and identify HOST-A's port", provenText: `SW2: HOST-A → ${q2.correct[0]} (behind SW1).`, proven: saw(x, "SW2") && answered(x, q2), action: open(x, "SW2") },
          { id: "c-copy", text: "Inspect HOST-C's copy: why did HOST-C discard it?", provenText: "Destination is HOST-B's MAC, not HOST-C's — and the frame is unchanged after crossing two switches.", proven: !!cSeg && x.seen(`pkt:${cSeg.id}`) && cSeg.outcome === "discarded" && !!x.lab.tx && frameDst(x.lab.tx.frame) === B, action: cSeg ? { label: "inspect copy", onClick: () => x.onInspectCopy(cSeg.id) } : undefined },
        ],
      };
    },
    deepen: [
      { q: "Why didn't SW1 use ge-0/0/24?", a: "It is disabled. A switch floods only out ports that are forwarding — and never back out the port the frame arrived on." },
      { q: "Did SW2 change the frame?", a: "No. Source, destination and EtherType are the same on every link. A bridge doesn't rewrite MACs and has no TTL to decrement." },
    ],
  },
  t2: {
    title: "The reply: each switch learns HOST-B on its own",
    summary: "SW2 learned HOST-B locally; SW1 learned HOST-B behind the inter-switch link. Both forwarded out one port.",
    key: "Each switch independently learns the reverse path, from the reply arriving on its own port.",
    where: ["HOST-B"],
    verify: [Q.trunk1],
    checks: (x) => {
      const b1 = lookup(x.lab.net.fdb.SW1, B)?.port;
      const b2 = lookup(x.lab.net.fdb.SW2, B)?.port;
      return { facts: [{ id: "b-both", text: "Inspect both switches: where is HOST-B on each?", provenText: `SW2: HOST-B → ${b2} (local) · SW1: HOST-B → ${b1} (behind SW2).`, proven: sawBoth(x) && b2 === "ge-0/0/1" && b1 === PRIMARY_PORT, action: openMissing(x) }] };
    },
  },
  t3: {
    title: "Known unicast at both switches",
    summary: "SW1 forwarded out ge-0/0/23 only; SW2 forwarded out ge-0/0/1 only. HOST-D and HOST-C saw nothing.",
    key: "Two independent known-unicast decisions: each switch consults only its own table. (The CLI shows tables, not each frame's path — the switches' cards show their last decision.)",
    checks: (x) => {
      const got = receivers(x.lab);
      const q: IdentifyDef = { id: "t3-recv", prompt: "Identify: which devices received a copy?", options: ["SW2", "HOST-B", "HOST-C", "HOST-D"].map((d) => ({ id: d, label: d })), multiple: true, correct: got };
      return { identify: [q], facts: [{ id: "recv", text: "Open both switches (their last decision) and identify who received a copy", provenText: `Only ${got.join(" and ")}.`, proven: x.seen("dev:SW1") && x.seen("dev:SW2") && answered(x, q), action: x.seen("dev:SW1") ? open(x, "SW2") : open(x, "SW1") }] };
    },
  },
  "t4-d": {
    title: "Local traffic stays on SW1",
    summary: "SW1 learned HOST-D on ge-0/0/2 and forwarded straight to HOST-A. SW2 never saw the frame.",
    key: "A switch cannot learn from traffic it never receives.",
    where: ["HOST-D"],
    verify: [Q.d2],
    checks: (x) => ({ facts: [{ id: "d-sw1", text: "Inspect SW1: where did it learn HOST-D?", provenText: `SW1: HOST-D → ${lookup(x.lab.net.fdb.SW1, D)?.port} (local).`, proven: saw(x, "SW1") && lookup(x.lab.net.fdb.SW1, D)?.port === "ge-0/0/2", action: open(x, "SW1") }] }),
  },
  "t4-a": {
    title: "Still local — SW2 still doesn't know HOST-D",
    summary: "HOST-A answered HOST-D; SW1 found HOST-D on ge-0/0/2. Nothing crossed ge-0/0/23.",
    key: "Switches do not share MAC tables: SW1 knows HOST-D, SW2 has never heard of it.",
    where: ["HOST-D"],
    verify: [Q.d2, Q.table1],
    checks: (x) => ({ facts: [{ id: "d-compare", text: "Compare both tables: SW1 knows HOST-D, SW2 does not", provenText: "SW1 has HOST-D on ge-0/0/2; SW2 has no entry for HOST-D.", proven: sawBoth(x) && !!lookup(x.lab.net.fdb.SW1, D) && !lookup(x.lab.net.fdb.SW2, D), action: openMissing(x) }] }),
  },
  t5: {
    title: "Partial knowledge: flooded at SW2, forwarded at SW1",
    summary: "The exact same frame — SW2 flooded it, SW1 sent it out one port.",
    key: (
      <>
        <span className="block">
          <b>SW2:</b> HOST-D unknown → FLOOD.
        </span>
        <span className="block">
          <b>SW1:</b> HOST-D known on ge-0/0/2 → FORWARD.
        </span>
        <span className="mt-1 block text-pv-text-muted">One switch can flood while the next forwards the same frame — two bridges, two lookups, two answers.</span>
      </>
    ),
    where: ["HOST-D", "HOST-C"],
    verify: [Q.d2, Q.table1],
    checks: (x) => {
      const fl = flooders(x.lab);
      const fw = (x.lab.tx?.decisions ?? []).filter((d) => d.kind === "known-unicast").map((d) => d.sw);
      const q1: IdentifyDef = { id: "t5-flood", prompt: "Identify: which switch flooded?", options: ["SW1", "SW2"].map((d) => ({ id: d, label: d })), correct: fl };
      const q2: IdentifyDef = { id: "t5-fwd", prompt: "Identify: which switch forwarded out one port?", options: ["SW1", "SW2"].map((d) => ({ id: d, label: d })), correct: fw };
      const q3: IdentifyDef = {
        id: "t5-why",
        prompt: "Identify: why did they decide differently?",
        options: [
          { id: "tables", label: "SW2 had no entry for HOST-D; SW1 had learned it" },
          { id: "sync", label: "SW2's table had not synchronised yet" },
          { id: "link", label: "ge-0/0/23 only carries known unicast" },
        ],
        correct: !lookup(x.lab.net.fdb.SW2, D) && !!lookup(x.lab.net.fdb.SW1, D) ? ["tables"] : [],
      };
      return {
        identify: [q1, q2, q3],
        facts: [{ id: "partial", text: "Inspect both switches, then identify the flooding switch, the forwarding switch and why", provenText: "SW2 flooded (no entry for HOST-D); SW1 forwarded (HOST-D on ge-0/0/2).", proven: sawBoth(x) && answered(x, q1) && answered(x, q2) && answered(x, q3), action: openMissing(x) }],
      };
    },
  },
  t6: {
    title: "One broadcast domain, two switches",
    summary: "The broadcast crossed both switches and reached every other host once. SW2 finally learned HOST-D — through ge-0/0/23.",
    key: "A broadcast domain can span several switches. Each one still learns the source, evaluates the destination and floods its own eligible ports.",
    where: ["HOST-D"],
    verify: [Q.d2],
    checks: (x) => {
      const q = portQ("d-sw2", "SW2", "HOST-D", x.lab);
      return { identify: [q], facts: [{ id: "d-sw2", text: "Inspect SW2 and identify where it learned HOST-D", provenText: `SW2: HOST-D → ${q.correct[0]} (behind SW1) — learned from the broadcast.`, proven: saw(x, "SW2") && q.correct[0] === PRIMARY_PORT && answered(x, q), action: open(x, "SW2") }] };
    },
  },
  "t7-enable": {
    title: "A second link between the switches",
    summary: `${SECONDARY_PORT} now forwards on both switches. Nothing has gone wrong yet — no frame has been flooded.`,
    key: "Two forwarding paths between the same two bridges, and no loop prevention. Every flood will now leave on both links.",
    verify: [Q.links1],
    checks: (x) => ({ facts: [{ id: "links", text: "Check interface state: are both SW1↔SW2 links up?", provenText: `${PRIMARY_PORT} and ${SECONDARY_PORT} both connected / up.`, proven: (["SW1", "SW2"] as SwfSwitch[]).some((sw) => cliOn(x, sw, ["interfaces-status", "interface-detail"]) || x.seen(`dev:${sw}`)) && x.lab.net.secondaryUp, action: open(x, "SW1") }] }),
  },
  "t7-bcast": {
    title: "The broadcast doesn't stop",
    summary: `Copies left on both links, came back on the other one, and were flooded again. The drawing stops after ${LOOP_WAVES_SHOWN} waves — the loop does not.`,
    key: "Each arriving copy is just a new broadcast to the switch: learn the source, flood every forwarding port except the ingress — including the OTHER inter-switch link. Ethernet has no TTL, so nothing in the frame ever runs out.",
    verify: [Q.a1, Q.a2],
    checks: (x) => {
      const ev = x.lab.loopEvidence;
      const max = ev ? Math.max(...Object.values(ev.copies)) : 0;
      const q: IdentifyDef = { id: "t7-dup", prompt: "Identify: how many copies of this ONE broadcast did HOST-B receive?", options: ["1", "2", "3"].map((d) => ({ id: d, label: d })), correct: ev ? [String(ev.copies["HOST-B"])] : [] };
      return { identify: [q], facts: [{ id: "dup", text: "Open HOST-B and count the copies it received", provenText: `HOST-B received ${ev?.copies["HOST-B"]} copies of one broadcast (most copies at any host: ${max}).`, proven: x.seen("dev:HOST-B") && answered(x, q), action: { label: "open HOST-B", onClick: () => x.onInspectDevice("HOST-B") } }] };
    },
    deepen: [
      { q: "Why does the drawing stop?", a: `For clarity only. PacketVerse draws ${LOOP_WAVES_SHOWN} bridge waves, then pauses with the remaining copies marked “still circulating”. Nothing in Ethernet stops them — and every new broadcast or unknown-unicast frame would add more.` },
      { q: "Is STP doing anything here?", a: "No. This lab runs no loop-prevention protocol at all — that is exactly why the loop forms. Spanning Tree is a later lesson." },
    ],
  },
  "t9-repair": {
    title: "One path again — the loop drains",
    summary: `${SECONDARY_PORT} is disabled: the copy on that cable was lost with the link, and the copy on ${PRIMARY_PORT} was delivered once more and had nowhere to loop back.`,
    key: "Removing the second forwarding path removes the loop. Now prove it: one broadcast should reach every host exactly once, and HOST-A should stay put.",
    verify: [Q.links1],
    checks: (x) => ({ facts: [{ id: "down", text: `Check interface state: is ${SECONDARY_PORT} disabled?`, provenText: `${SECONDARY_PORT} is disabled / administratively down; nothing is circulating.`, proven: (["SW1", "SW2"] as SwfSwitch[]).some((sw) => cliOn(x, sw, ["interfaces-status", "interface-detail"]) || x.seen(`dev:${sw}`)) && !x.lab.net.secondaryUp && !x.lab.circulating.length, action: open(x, "SW1") }] }),
  },
  "t9-verify-bcast": {
    title: "Verify 1: one copy per host",
    summary: "HOST-A's new broadcast reached every other host exactly once, and nothing came back.",
    key: "A single forwarding path between the switches means a flooded copy can never return to the switch that sent it.",
    verify: [Q.a1],
    checks: (x) => {
      const q: IdentifyDef = { id: "t9-one", prompt: "Identify: how many copies did HOST-B receive this time?", options: ["1", "2", "3"].map((d) => ({ id: d, label: d })), correct: x.lab.tx ? [String(swfCopiesPerHost(x.lab.tx)["HOST-B"])] : [] };
      return {
        identify: [q],
        facts: [
          { id: "one", text: "Open HOST-B and count the copies", provenText: "One copy — normal broadcast delivery.", proven: x.seen("dev:HOST-B") && answered(x, q), action: { label: "open HOST-B", onClick: () => x.onInspectDevice("HOST-B") } },
          { id: "a-home", text: "On SW1's CLI: is HOST-A learned on its own port again?", provenText: "SW1: HOST-A → ge-0/0/1 (local).", proven: cliOn(x, "SW1", MAC_CMDS) && lookup(x.lab.net.fdb.SW1, A)?.port === "ge-0/0/1", action: open(x, "SW1") },
        ],
      };
    },
  },
  "t9-verify-uni": {
    title: "Verified: stable forwarding",
    summary: "HOST-B → HOST-A was known unicast at both switches, and HOST-A's entries point at the right ports.",
    key: "Repair is verified by traffic AND state: one copy per host, stable MAC entries, known unicast end to end.",
    verify: [Q.a1, Q.a2],
    checks: (x) => ({ facts: [{ id: "stable", text: "Run a MAC-table command on BOTH switches' CLIs and confirm HOST-A's entries", provenText: "SW1: HOST-A → ge-0/0/1 · SW2: HOST-A → ge-0/0/23 — stable, and the last frame was known unicast at both.", proven: cliOn(x, "SW1", MAC_CMDS) && cliOn(x, "SW2", MAC_CMDS) && swfRepairVerified(x.lab) }] }),
  },
};

// ---------------------------------------------------------------------------------------------------------------
// The incident (T8): symptom → observation → evidence → hypothesis → test → root cause
// ---------------------------------------------------------------------------------------------------------------
// Option order is deliberately not "right answer first".
const HYPOTHESES: PredictionOption[] = [
  { id: "flap", label: "MAC flapping is corrupting the tables" },
  { id: "fdb", label: "SW1's FDB is corrupted and needs clearing" },
  { id: "loop", label: "Two forwarding SW1↔SW2 links with no loop prevention form a Layer-2 loop" },
  { id: "nic", label: "HOST-A's NIC is sending duplicate frames" },
  { id: "stp", label: "Spanning Tree blocked the wrong port" },
];
const TESTS: PredictionOption[] = [
  { id: "dup", label: "HOST-B received two copies of one broadcast" },
  { id: "proof", label: `Both ${PRIMARY_PORT} and ${SECONDARY_PORT} forward, and HOST-A's MAC is learned on inter-switch ports although HOST-A is on SW1 ge-0/0/1` },
  { id: "filter", label: "SW2 filtered HOST-D → HOST-A" },
];
const HYP_FEEDBACK: Record<string, string> = {
  flap: "The flapping is real — but it's a symptom. Why do HOST-A's frames keep arriving on different ports?",
  fdb: "Nothing is corrupted: source learning is doing exactly what it always does with the frames it receives.",
  nic: "HOST-A sent its broadcast once. The copies were made by the switches.",
  stp: "No STP runs in this lab — that is part of the problem, not its cause.",
};

export function swfIncidentEvidence(x: SwfBoardCtx) {
  const from = x.lab.tx?.id ?? x.lab.seq;
  const ran = (sw: SwfSwitch | "any", ids: string[]) => (sw === "any" ? (["SW1", "SW2"] as SwfSwitch[]) : [sw]).some((s) => ids.some((id) => x.seenSince(from, `cli:${s}:${id}`)));
  const ev = x.lab.loopEvidence;
  return [
    { id: "e-links", text: "Are both SW1↔SW2 links forwarding? — interface state on a switch's CLI", provenText: `${PRIMARY_PORT} and ${SECONDARY_PORT} are both up on both switches.`, proven: ran("any", ["interfaces-status", "interface-detail"]) },
    { id: "e-sw1", text: "Where does SW1 have HOST-A? — a MAC-table command on SW1", provenText: `SW1: HOST-A → ${lookup(x.lab.net.fdb.SW1, A)?.port ?? "no entry"}.`, proven: ran("SW1", MAC_CMDS) },
    { id: "e-sw2", text: "Where does SW2 have HOST-A? — a MAC-table command on SW2", provenText: `SW2: HOST-A → ${lookup(x.lab.net.fdb.SW2, A)?.port ?? "no entry"}.`, proven: ran("SW2", MAC_CMDS) },
    { id: "e-host", text: "Did HOST-A actually move? — open HOST-A", provenText: "HOST-A is still on SW1 ge-0/0/1.", proven: x.seenSince(from, "dev:HOST-A"), action: { label: "open HOST-A", onClick: () => x.onInspectDevice("HOST-A") } },
    { id: "e-dup", text: "Did hosts receive duplicates? — open HOST-B or HOST-C", provenText: ev ? `Yes: HOST-B ${ev.copies["HOST-B"]}×, HOST-C ${ev.copies["HOST-C"]}× for one broadcast.` : "—", proven: x.seenSince(from, "dev:HOST-B") || x.seenSince(from, "dev:HOST-C"), action: { label: "open HOST-B", onClick: () => x.onInspectDevice("HOST-B") } },
  ] satisfies EngineerCheckFact[];
}

export function swfIncidentSolved(x: SwfBoardCtx): boolean {
  return swfIncidentEvidence(x).every((f) => f.proven) && x.lab.net.secondaryUp && sameSet(x.answer("incident|hypothesis"), ["loop"]) && sameSet(x.answer("incident|test"), ["proof"]);
}

const REPAIR_FEEDBACK: Record<string, string> = {
  "clear-fdb": "Both tables are empty for a moment — but the copies are still circulating over both links. The next wave relearns (and moves) the same entries.",
  "raise-ttl": "Switches never read or change the IPv4 TTL, and this ARP broadcast has no IPv4 header at all. Ethernet has no TTL of its own.",
  "change-mac": "The loop doesn't depend on which MAC HOST-A uses. Any broadcast from any host would circulate the same way.",
  "restart-b": "HOST-B only receives the duplicates. The copies circulate between the switches whether HOST-B is up or not.",
};

function Incident({ x }: { x: SwfBoardCtx }) {
  const evidence = swfIncidentEvidence(x);
  const gathered = evidence.filter((f) => f.proven).length;
  const hyp = x.answer("incident|hypothesis");
  const test = x.answer("incident|test");
  const hypOk = sameSet(hyp, ["loop"]);
  const testOk = sameSet(test, ["proof"]);
  const ev = x.lab.loopEvidence;
  return (
    <>
      <BoardSection label="Symptom" tone="cyan">
        <TeachingEventRows rows={x.lab.tx ? sendRows(x.lab.tx, x.lab) : []} />
      </BoardSection>
      <BoardSection label="Observation">
        <p className="text-[12.5px] leading-snug text-pv-text-muted">
          Users also report duplicate traffic since the cabling change{ev ? ` — the last broadcast reached HOST-B ${ev.copies["HOST-B"]}× and HOST-D ${ev.copies["HOST-D"]}×` : ""}, and {x.lab.circulating.length} cop{x.lab.circulating.length === 1 ? "y is" : "ies are"} still circulating. Don&apos;t guess: gather evidence on both switches.
        </p>
      </BoardSection>
      <EngineerCheck intro="Evidence — each item needs a real inspection (an executed command on the right switch, a device card):" facts={evidence} footnote="Gather at least three pieces of evidence to unlock the hypothesis." />
      <BoardSection label="How do I find out?" tone="violet">
        <CommandHelp items={verifyItems(x, [Q.links1, Q.a1, Q.a2])} />
      </BoardSection>
      {gathered >= 3 && (
        <PredictionBlock
          label="Hypothesis"
          prompt="What is the root cause?"
          options={HYPOTHESES}
          value={hyp}
          onChange={(v) => x.onAnswer("incident|hypothesis", v)}
          verdict={hyp.length ? <Verdict correct={hypOk}>{hypOk ? "Consistent with the evidence. Now test it: which observation proves it?" : (HYP_FEEDBACK[hyp[0]] ?? "That doesn't fit the evidence.")}</Verdict> : undefined}
        />
      )}
      {hypOk && (
        <PredictionBlock
          label="Test"
          prompt="Which observation proves the hypothesis?"
          options={TESTS}
          value={test}
          onChange={(v) => x.onAnswer("incident|test", v)}
          verdict={test.length ? <Verdict correct={testOk}>{testOk ? "That's the proof: two forwarding paths, and a MAC learned where its host isn't." : "True — but it's a symptom, not proof of the cause."}</Verdict> : undefined}
        />
      )}
      {swfIncidentSolved(x) && (
        <KeyLesson>
          <b>Root cause — a Layer-2 loop.</b> Two forwarding SW1↔SW2 links and no loop prevention → every flood leaves on both and returns on the other → Ethernet has no TTL, so copies circulate → each copy carries HOST-A&apos;s source MAC into different ports, so source learning moves the entry (MAC flapping — a symptom) → SW1 now sends known unicast for HOST-A toward SW2, where it is filtered.
          {ev?.moves.length ? <span className="mt-1 block text-pv-text-muted">Moves seen: {ev.moves.map((m) => `${m.sw} ${who(m.mac)} ${m.from}→${m.to}`).join(" · ")}</span> : null}
        </KeyLesson>
      )}
    </>
  );
}

/** The guided lesson's option order lists the fix first; the lab shows the same options without that hint. */
const REPAIR_ORDER = ["clear-fdb", "raise-ttl", "disable-secondary", "change-mac", "restart-b"];

function RepairChoice({ x }: { x: SwfBoardCtx }) {
  const choice = x.answer("repair-choice");
  const last = x.lab.last;
  return (
    <>
      <PredictionBlock label="Repair" prompt="Choose the change that fixes the cause you proved." options={REPAIR_ORDER.map((id) => ({ id, label: SWF_LAB_REPAIRS.find((r) => r.id === id)!.label }))} value={choice} onChange={(v) => x.onAnswer("repair-choice", v)} />
      {last?.type === "repair" && !last.correct && <Verdict correct={false}>{REPAIR_FEEDBACK[last.choice] ?? "That doesn't remove the cause."} Pick again.</Verdict>}
    </>
  );
}

export function swfStepChecksDone(stepId: string, x: SwfBoardCtx): boolean {
  if (stepId === "t8-symptom") return swfIncidentSolved(x);
  const c = COPY[stepId]?.checks?.(x);
  return !c || c.facts.every((f) => f.proven);
}

function IdentifyBlock({ x, q }: { x: SwfBoardCtx; q: IdentifyDef }) {
  const key = `${x.lab.seq}|${q.id}`;
  const v = x.answer(key);
  const ok = q.correct.length > 0 && sameSet(v, q.correct);
  return <PredictionBlock label="Identify (from the live state)" prompt={q.prompt} options={q.options} value={v} multiple={q.multiple} onChange={(nv) => x.onAnswer(key, nv)} verdict={v.length > 0 && (!q.multiple || ok) ? <Verdict correct={ok}>{ok ? "That matches the live state." : "Check the tables again."}</Verdict> : undefined} />;
}

export interface SwitchingLabBoardProps extends SwfBoardCtx {
  revealed: Record<string, string[]>;
  cursor: number;
  freePlay: boolean;
  inFlight: boolean;
  gate?: string;
}

export function SwitchingLabBoard(props: SwitchingLabBoardProps) {
  const { lab, cursor, freePlay, inFlight } = props;
  const prev = cursor > 0 ? SWF_LAB_SCRIPT[cursor - 1] : undefined;
  const next = !freePlay ? SWF_LAB_SCRIPT[cursor] : undefined;
  const copy = !freePlay && prev ? COPY[prev.id] : undefined;
  const incident = !freePlay && prev?.id === "t8-symptom";

  if (inFlight)
    return (
      <TeachingBoard phase={`${prev?.phase ?? "T0"} · in flight`} title="Frame in flight" summary="Watch each switch make its own decision as a copy arrives.">
        <BoardSection label="What happened so far" tone="cyan">
          <TeachingEventRows rows={eventRows(lab)} />
        </BoardSection>
      </TeachingBoard>
    );

  const checks = copy?.checks?.(props);
  const verdicts = !freePlay && prev?.predict ? prev.predict.map((p) => ({ p, ans: props.answer(p.id), ok: sameSet(props.answer(p.id), props.revealed[p.id] ?? []) })) : [];
  const t0Facts: EngineerCheckFact[] = [{ id: "t0", text: "Inspect SW1 and SW2 (CLI or cards): both tables hold 0 entries", provenText: "SW1: 0 entries · SW2: 0 entries — two separate, empty tables.", proven: sawBoth(props) && lab.net.fdb.SW1.length === 0 && lab.net.fdb.SW2.length === 0, action: openMissing(props) }];
  const verdictList = verdicts.map(({ p, ans, ok }) => (
    <Verdict key={p.id} correct={ok}>
      <span className="font-semibold text-pv-text">{p.prompt}</span> You said: {ans.map((a) => p.options.find((o) => o.id === a)?.label ?? a).join(", ") || "—"}. {p.explain}
    </Verdict>
  ));

  return (
    <TeachingBoard
      phase={freePlay ? "Free play" : `${prev?.phase ?? "T0"} · ${SWF_LAB_STAGES[prev?.stage ?? 0]}`}
      title={freePlay ? (lab.last ? "What just happened" : "Free play") : incident ? "Incident: HOST-D can't reach HOST-A" : (copy?.title ?? "Before anything moves")}
      summary={freePlay ? "Send any frame, clear one switch's table, or enable/disable the second link. Verify on both switches' CLIs." : incident ? "Reproduced. Now troubleshoot from evidence: observe → gather evidence → hypothesis → test → root cause." : (copy?.summary ?? "SW1 and SW2 have just booted. ge-0/0/23 is forwarding; ge-0/0/24 is disabled.")}
    >
      {!prev && !freePlay && (
        <>
          <PredictionBlock
            prompt="What does each switch know before any traffic?"
            options={[
              { id: "nothing", label: "Nothing — two separate, empty tables" },
              { id: "shared", label: "One shared table with every host" },
              { id: "local", label: "Each knows its own hosts from the cables" },
            ]}
            value={props.answer("t0-tables")}
            onChange={(v) => props.onAnswer("t0-tables", v)}
            verdict={props.answer("t0-tables").length ? <Verdict correct={props.answer("t0-tables")[0] === "nothing"}>Each bridge owns its own forwarding database, filled only from frames that arrive on its own ports. A cable tells it nothing.</Verdict> : undefined}
          />
          <EngineerCheck intro="Prove it from the live network:" facts={t0Facts} />
          <BoardSection label="Verify on the CLI" tone="violet">
            <CommandHelp items={verifyItems(props, [Q.table1, Q.table2])} />
          </BoardSection>
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
            <TeachingEventRows rows={eventRows(lab)} />
          </BoardSection>
          <BoardSection label="What changed">
            <StateDeltaChips deltas={deltas(lab)} />
          </BoardSection>
          {copy?.where?.map((h) => (
            <WhereIs key={h} s={lab} host={h} />
          ))}
          {verdictList}
          {copy && <KeyLesson>{copy.key}</KeyLesson>}
          {checks && (
            <>
              {checks.identify?.map((q) => (
                <IdentifyBlock key={q.id} x={props} q={q} />
              ))}
              <EngineerCheck intro="Prove it from the live state — both switches' CLIs, device cards and packet copies:" facts={checks.facts} />
            </>
          )}
          {(copy?.verify || freePlay) && (
            <BoardSection label="Verify on the CLI" tone="violet">
              <CommandHelp items={verifyItems(props, copy?.verify ?? [Q.table1, Q.table2, Q.links1])} />
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
            { q: "Is MAC flapping the problem?", a: "It's a symptom. The same source MAC keeps arriving on different ports because looped copies carry it there; source learning just records the latest port." },
            { q: "How do real networks keep redundant links?", a: "They run a loop-prevention protocol (the Spanning Tree family) so only a loop-free set of links forwards. That's a later lesson — here the fix is to go back to one forwarding path." },
          ]}
        />
      ) : (
        copy?.deepen && <DeepenUnderstanding qa={copy.deepen} />
      )}
    </TeachingBoard>
  );
}
