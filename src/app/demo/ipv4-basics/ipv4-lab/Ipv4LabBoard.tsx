"use client";

import type { ReactNode } from "react";
import { BoardSection, DeepenUnderstanding, EngineerCheck, KeyLesson, NextAction, PredictionBlock, StateDeltaChips, TeachingBoard, TeachingEventRows, Verdict, type EngineerCheckFact, type PredictionOption, type StateDelta, type TeachingEventRowDef } from "@/components/practice-lab/TeachingBoard";
import { V4_FAULT_PREFIX, V4_IP, V4_MAC, V4_PREFIX, maskOf, networkOf } from "@/lib/sim-engine/scenarios/ipv4Basics";
import { V4_LAB_HOST_C, V4_LAB_MODEL, V4_LAB_REPAIRS, V4_LAB_REPAIR_CORRECT, fieldOf, v4Owner, type V4Host, type V4LabAction, type V4LabDevice, type V4LabState, type V4Record } from "@/lib/sim-engine/scenarios/ipv4Lab";

/**
 * IPv4 Lab Teaching Board — the IPv4 composition of the generic board primitives. It owns the script, predictions,
 * evidence checks and the wrong-mask incident; the primitives own layout.
 *
 * Every board connects back to one model: destination IPv4 → MY prefix → LOCAL or REMOTE → next hop → ARP resolves
 * only that next hop's MAC. Prediction answers are frozen from a pure dry run when the action runs. A check needs an
 * inspection made after the event (a decision, a device card, a frame, the packet diff, an R1 command) AND the
 * matching lab state.
 */

export const V4_LAB_STAGES = ["Baseline", "Local decision", "Local send", "Remote decision", "To the gateway", "R1 forwards", "Reply", "Incident", "Repair & verify"];
const A = V4_IP["HOST-A"];
const B = V4_IP["HOST-B"];
const C = V4_LAB_HOST_C.ip;
const GA = V4_IP.R1L;
const GB = V4_IP.R1R;
const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));
const opts = (...xs: (string | [string, string])[]): PredictionOption[] => xs.map((x) => (Array.isArray(x) ? { id: x[0], label: x[1] } : { id: x, label: x }));

export function v4LabDryRun(s: V4LabState, a: V4LabAction): V4LabState {
  const hops = V4_LAB_MODEL.hops(s, a);
  let n = V4_LAB_MODEL.start(s, a);
  for (let i = 0; i < hops; i++) n = V4_LAB_MODEL.arrive(n);
  return n;
}

interface PredictDef {
  id: string;
  prompt: string;
  options: PredictionOption[];
  multiple?: boolean;
  correct: (before: V4LabState, after: V4LabState) => string[];
  explain: string;
}
export interface V4ScriptStep {
  id: string;
  stage: number;
  phase: string;
  action: V4LabAction;
  label: string;
  /** Phone tab-bar label (one line). */
  short: string;
  predict?: PredictDef[];
  repair?: boolean;
}

const lastRec = (s: V4LabState) => s.records[s.records.length - 1];
const ipFrameOf = (r: V4Record) => (r.ipFrame !== undefined ? r.frames[r.ipFrame] : undefined);

export const V4_LAB_SCRIPT: V4ScriptStep[] = [
  {
    id: "t1",
    short: "Decide",
    stage: 1,
    phase: "T1",
    action: { type: "decide", src: "HOST-A", dst: C },
    label: `HOST-A decides how to reach ${C}`,
    predict: [
      { id: "t1-lr", prompt: `Is ${C} local or remote for HOST-A (${A}/${V4_PREFIX})?`, options: opts(["local", "Local — same network"], ["remote", "Remote — different network"]), correct: (_b, a) => [a.decision?.local ? "local" : "remote"], explain: `${A} AND ${maskOf(V4_PREFIX)} = ${networkOf(A, V4_PREFIX)} and ${C} AND ${maskOf(V4_PREFIX)} = ${networkOf(C, V4_PREFIX)}: the same network.` },
      { id: "t1-nh", prompt: "What is the next hop?", options: opts([C, `${C} — HOST-C itself`], [GA, `${GA} — the default gateway`], ["sw", "SW-A"]), correct: (_b, a) => [a.decision?.nextHop ?? ""], explain: "For a local destination the next hop IS the destination. A switch is never a next hop." },
      { id: "t1-mac", prompt: "Whose MAC does HOST-A need?", options: opts(["c", "HOST-C's"], ["r1", "R1's"], ["bc", "The broadcast address"]), correct: (_b, a) => [a.decision?.local ? "c" : "r1"], explain: "The next hop's: HOST-C. ARP will resolve it." },
      { id: "t1-gw", prompt: "Is the default gateway involved?", options: opts(["no", "No"], ["yes", "Yes — every packet goes through the gateway"]), correct: (_b, a) => [a.decision?.local ? "no" : "yes"], explain: "A host uses its gateway only for REMOTE destinations." },
    ],
  },
  {
    id: "t2",
    short: "Send",
    stage: 2,
    phase: "T2",
    action: { type: "send", src: "HOST-A", dst: C },
    label: `HOST-A sends to ${C}`,
    predict: [
      { id: "t2-arp", prompt: "Which IPv4 address will HOST-A ARP for?", options: opts(C, GA, B), correct: (_b, a) => [lastRec(a).arp[0]?.ip ?? ""], explain: "ARP always resolves the next hop chosen by the IPv4 decision — here the destination itself." },
      { id: "t2-r1", prompt: "Will R1 route this IPv4 packet?", options: opts(["no", "No"], ["yes", "Yes"]), correct: (b, a) => [a.r1Forwarded > b.r1Forwarded ? "yes" : "no"], explain: "Local traffic goes straight to the destination's MAC. R1 only sees the ARP broadcast (and ignores it: it isn't for R1's address)." },
    ],
  },
  {
    id: "t3",
    short: "Decide",
    stage: 3,
    phase: "T3",
    action: { type: "decide", src: "HOST-A", dst: B },
    label: `HOST-A decides how to reach ${B}`,
    predict: [
      { id: "t3-lr", prompt: `Is ${B} local or remote for HOST-A (${A}/${V4_PREFIX})?`, options: opts(["remote", "Remote — different network"], ["local", "Local — the first three octets match"]), correct: (_b, a) => [a.decision?.local ? "local" : "remote"], explain: `${B} AND ${maskOf(V4_PREFIX)} = ${networkOf(B, V4_PREFIX)} ≠ ${networkOf(A, V4_PREFIX)}. With /${V4_PREFIX} the boundary is inside the last octet — matching first octets prove nothing.` },
      { id: "t3-dst", prompt: `Does the destination IPv4 address become ${GA}?`, options: opts(["no", `No — it stays ${B}`], ["yes", `Yes — HOST-A addresses the packet to ${GA}`]), correct: (_b, a) => [a.decision?.dst === B ? "no" : "yes"], explain: "The gateway is the next hop, not the destination. The IPv4 header always carries the final destination." },
      { id: "t3-nh", prompt: "What is the next hop?", options: opts([GA, `${GA} — default gateway`], [B, `${B} — HOST-B`], [GB, `${GB} — R1's other interface`]), correct: (_b, a) => [a.decision?.nextHop ?? ""], explain: `HOST-A's default gateway, ${GA}. HOST-A knows nothing about R1's other side.` },
    ],
  },
  {
    id: "t4",
    short: "Send",
    stage: 4,
    phase: "T4",
    action: { type: "send", src: "HOST-A", dst: B },
    label: `HOST-A sends to ${B}`,
    predict: [
      { id: "t4-arp", prompt: "Which IPv4 address will HOST-A ARP for?", options: opts(B, GA, GB), correct: (_b, a) => [lastRec(a).arp[0]?.ip ?? ""], explain: `${GA}: the next hop. HOST-A never ARPs for a remote host — ARP works only on HOST-A's own LAN.` },
      { id: "t4-eth", prompt: "Which MAC goes in the Ethernet destination?", options: opts(["r1", `R1 ge-0/0/0 (${V4_MAC.R1L})`], ["b", `HOST-B (${V4_MAC["HOST-B"]})`], ["bc", "FF:FF:FF:FF:FF:FF"]), correct: (_b, a) => [fieldOf(ipFrameOf(lastRec(a))!, /^Ethernet/, "Destination MAC") === V4_MAC.R1L ? "r1" : "b"], explain: "The frame is for the next hop: R1." },
      { id: "t4-ip", prompt: "Which IPv4 destination does the packet carry?", options: opts(B, GA), correct: (_b, a) => [fieldOf(ipFrameOf(lastRec(a))!, /^IPv4/, "Destination")], explain: `${B}. Ethernet destination = R1; IPv4 destination = HOST-B.` },
    ],
  },
  {
    id: "t5",
    short: "R1 forwards",
    stage: 5,
    phase: "T5",
    action: { type: "route" },
    label: "R1 processes the packet",
    predict: [
      {
        id: "t5-chg",
        prompt: "Which fields will R1 change? (select all)",
        multiple: true,
        options: opts(["esrc", "Ethernet source MAC"], ["edst", "Ethernet destination MAC"], ["ttl", "TTL"], ["csum", "IPv4 header checksum"], ["isrc", "Source IPv4"], ["idst", "Destination IPv4"]),
        correct: (_b, a) => {
          const r = lastRec(a);
          if (!r.routing || r.routing.outFrame < 0) return [];
          const i = r.frames[r.routing.inFrame];
          const o = r.frames[r.routing.outFrame];
          const map: [string, RegExp, string][] = [["esrc", /^Ethernet/, "Source MAC"], ["edst", /^Ethernet/, "Destination MAC"], ["ttl", /^IPv4/, "TTL"], ["csum", /^IPv4/, "Header Checksum"], ["isrc", /^IPv4/, "Source"], ["idst", /^IPv4/, "Destination"]];
          return map.filter(([, re, l]) => fieldOf(i, re, l) !== fieldOf(o, re, l)).map(([id]) => id);
        },
        explain: "A new Ethernet header for the next link (both MACs), TTL − 1, and therefore a recomputed checksum. The IPv4 addresses don't change (no NAT here).",
      },
      { id: "t5-ttl", prompt: "What will the TTL be when the packet leaves R1?", options: opts("63", "64", "62"), correct: (_b, a) => [fieldOf(lastRec(a).frames[lastRec(a).routing!.outFrame], /^IPv4/, "TTL")], explain: "64 − 1 = 63: one router hop. TTL is a hop limit, not a time." },
    ],
  },
  {
    id: "t6-decide",
    short: "HOST-B decides",
    stage: 6,
    phase: "T6",
    action: { type: "decide", src: "HOST-B", dst: A },
    label: `HOST-B decides how to reply to ${A}`,
    predict: [
      { id: "t6-lr", prompt: `From HOST-B's side (${B}/${V4_PREFIX}), is ${A} local or remote?`, options: opts(["remote", "Remote"], ["local", "Local"]), correct: (_b, a) => [a.decision?.local ? "local" : "remote"], explain: "HOST-B runs the same test with ITS OWN address and mask: 192.168.10.64 ≠ 192.168.10.0." },
      { id: "t6-gw", prompt: "Which gateway does HOST-B use?", options: opts([GB, `${GB} (R1 ge-0/0/1)`], [GA, `${GA} (R1 ge-0/0/0)`]), correct: (_b, a) => [a.decision?.nextHop ?? ""], explain: `Its own default gateway, on its own LAN: ${GB}.` },
    ],
  },
  {
    id: "t6-send",
    short: "Send reply",
    stage: 6,
    phase: "T6",
    action: { type: "send", src: "HOST-B", dst: A },
    label: `HOST-B sends the reply`,
    predict: [{ id: "t6-arp", prompt: `Does HOST-B have to send an ARP request for ${GB}?`, options: opts(["no", `No — it already learned ${GB} when R1 ARPed for HOST-B`], ["yes", "Yes — its ARP cache is empty"]), correct: (_b, a) => [lastRec(a).arp[0]?.outcome === "cache" ? "no" : "yes"], explain: "When R1 asked “who has 192.168.10.70?”, HOST-B — the target — stored R1's address and MAC from that request." }],
  },
  {
    id: "t6-route",
    short: "R1 forwards",
    stage: 6,
    phase: "T6",
    action: { type: "route" },
    label: "R1 forwards the reply",
    predict: [{ id: "t6-r1arp", prompt: `Does R1 have to ARP for ${A}?`, options: opts(["no", "No — it learned HOST-A when HOST-A ARPed for R1"], ["yes", "Yes"]), correct: (_b, a) => [lastRec(a).arp[0]?.outcome === "cache" ? "no" : "yes"], explain: `HOST-A's ARP request was for R1's own address ${GA}, so R1 stored HOST-A's mapping then.` }],
  },
  { id: "t7-ticket", short: "Open ticket", stage: 7, phase: "T7", action: { type: "incident" }, label: "Open the ticket" },
  { id: "t7-c", short: "Reproduce → C", stage: 7, phase: "T7", action: { type: "send", src: "HOST-A", dst: C }, label: `Reproduce: HOST-A → HOST-C (${C})` },
  { id: "t7-b", short: "Reproduce → B", stage: 7, phase: "T7", action: { type: "send", src: "HOST-A", dst: B }, label: `Reproduce: HOST-A → HOST-B (${B})` },
  { id: "t8-repair", short: "Apply fix", stage: 8, phase: "T8", action: { type: "repair", choice: V4_LAB_REPAIR_CORRECT }, label: "Apply the selected fix", repair: true },
  {
    id: "t8-send",
    short: "Verify send",
    stage: 8,
    phase: "T8",
    action: { type: "send", src: "HOST-A", dst: B },
    label: `Verify: HOST-A sends to ${B} again`,
    predict: [
      { id: "t8-lr", prompt: "What will HOST-A decide now?", options: opts(["remote", "REMOTE — next hop 192.168.10.1"], ["local", "LOCAL — next hop 192.168.10.70"]), correct: (_b, a) => [lastRec(a).decision?.local ? "local" : "remote"], explain: `With /${V4_PREFIX} restored, 192.168.10.70 is in 192.168.10.64/26 again.` },
      { id: "t8-arp", prompt: "Which next-hop MAC does HOST-A use?", options: opts(["r1", "R1's — 192.168.10.1, already in its ARP cache"], ["b", "HOST-B's — after a new ARP request"]), correct: (_b, a) => [lastRec(a).arp[0]?.ip === GA ? "r1" : "b"], explain: "The gateway's. HOST-A learned it earlier, so no new ARP request is needed." },
    ],
  },
  {
    id: "t8-route",
    short: "Verify R1",
    stage: 8,
    phase: "T8",
    action: { type: "route" },
    label: "Verify: R1 forwards it",
    predict: [{ id: "t8-ttl", prompt: "What TTL will HOST-B receive?", options: opts("63", "64"), correct: (_b, a) => [fieldOf(lastRec(a).frames[lastRec(a).routing!.outFrame], /^IPv4/, "TTL")], explain: "63 — one router hop, exactly as before the incident." }],
  },
];


export function v4RevealFor(step: V4ScriptStep, before: V4LabState): Record<string, string[]> {
  if (!step.predict) return {};
  const after = v4LabDryRun(before, step.action);
  return Object.fromEntries(step.predict.map((p) => [p.id, p.correct(before, after)]));
}

// ---------------------------------------------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------------------------------------------
export interface V4BoardCtx {
  lab: V4LabState;
  before?: V4LabState;
  /** Inspected after the latest event? (`dec:<host>`, `dev:<device>`, `cfg:HOST-A`, `pkt:<rec>-<frame>`, `diff:<rec>`, `cli:<commandId>`) */
  seen: (key: string) => boolean;
  seenSince: (fromSeq: number, key: string) => boolean;
  answer: (key: string) => string[];
  onAnswer: (key: string, v: string[]) => void;
  onInspectDevice: (id: V4LabDevice) => void;
  onInspectDecision: (src: V4Host) => void;
  onInspectConfig: () => void;
  onInspectFrame: (rec: number, frame: number) => void;
  onOpenDiff: (rec: number) => void;
  /** The incident is unresolved and HOST-A's configuration has not been inspected yet. */
  conceal: boolean;
}

const openDev = (x: V4BoardCtx, d: V4LabDevice) => ({ label: `open ${d}`, onClick: () => x.onInspectDevice(d) });
const recIdx = (x: V4BoardCtx) => x.lab.records.length - 1;
const frameIdx = (r: V4Record | undefined, kind: "ipv4" | "arp-request") => (r ? r.frameKinds.findIndex((k) => k === kind) : -1);
const sawFrame = (x: V4BoardCtx, r: V4Record | undefined, kind: "ipv4" | "arp-request") => {
  const i = frameIdx(r, kind);
  return !!r && i >= 0 && x.seen(`pkt:${r.id}-${i}`);
};
const openFrame = (x: V4BoardCtx, kind: "ipv4" | "arp-request") => {
  const r = x.lab.records[recIdx(x)];
  const i = frameIdx(r, kind);
  return r && i >= 0 ? { label: `open the ${kind === "ipv4" ? "IPv4" : "ARP request"} frame`, onClick: () => x.onInspectFrame(recIdx(x), i) } : undefined;
};

interface StepCopy {
  title: string;
  summary: ReactNode;
  key: ReactNode;
  checks?: (x: V4BoardCtx) => EngineerCheckFact[];
  deepen?: { q: string; a: ReactNode }[];
}

const COPY: Record<string, StepCopy> = {
  t1: {
    title: "LOCAL: the destination is on HOST-A's own network",
    summary: `HOST-A ANDed both addresses with its own mask ${maskOf(V4_PREFIX)}: both give ${networkOf(A, V4_PREFIX)}. Next hop = HOST-C itself.`,
    key: "Nothing has been sent yet. IPv4 decided WHO the next hop is; ARP will only find that next hop's MAC.",
    checks: (x) => [{ id: "dec", text: "Inspect HOST-A's decision: both AND results", provenText: `${A} → ${networkOf(A, V4_PREFIX)}, ${C} → ${networkOf(C, V4_PREFIX)} — same network, LOCAL.`, proven: x.seen("dec:HOST-A") && !!x.lab.decision?.local, action: { label: "inspect the decision", onClick: () => x.onInspectDecision("HOST-A") } }],
  },
  t2: {
    title: "Local delivery: straight to HOST-C",
    summary: `HOST-A ARPed for ${C} (the destination), HOST-C answered, and the packet went directly to HOST-C's MAC. R1 routed nothing.`,
    key: (
      <>
        <span className="block">
          <b>IP destination = HOST-C · Ethernet destination = HOST-C.</b>
        </span>
        <span className="mt-1 block text-pv-text-muted">ARP followed the IPv4 decision: local → resolve the destination itself. R1 saw only the ARP broadcast and ignored it.</span>
      </>
    ),
    checks: (x) => {
      const r = lastRec(x.lab);
      return [
        { id: "frame", text: "Open the IPv4 frame: Ethernet and IPv4 destinations", provenText: `Ethernet dst ${V4_LAB_HOST_C.mac} (HOST-C) · IPv4 dst ${C} (HOST-C).`, proven: sawFrame(x, r, "ipv4"), action: openFrame(x, "ipv4") },
        { id: "r1", text: "Open R1: did it route anything?", provenText: `IPv4 packets routed: ${x.lab.r1Forwarded}.`, proven: x.seen("dev:R1") && x.lab.r1Forwarded === 0, action: openDev(x, "R1") },
      ];
    },
  },
  t3: {
    title: "REMOTE: a different network",
    summary: `${B} AND ${maskOf(V4_PREFIX)} = ${networkOf(B, V4_PREFIX)}, not ${networkOf(A, V4_PREFIX)}. Next hop = default gateway ${GA}; the final destination stays ${B}.`,
    key: (
      <>
        <b>Final Layer-3 destination ≠ next Layer-2 hop.</b> HOST-A will hand the packet to {GA}, but the IPv4 header will still say {B}.
      </>
    ),
    checks: (x) => [{ id: "dec", text: "Inspect HOST-A's decision for .70", provenText: `${networkOf(A, V4_PREFIX)} ≠ ${networkOf(B, V4_PREFIX)} → REMOTE · next hop ${GA}.`, proven: x.seen("dec:HOST-A") && x.lab.decision?.local === false, action: { label: "inspect the decision", onClick: () => x.onInspectDecision("HOST-A") } }],
  },
  t4: {
    title: "IP destination = HOST-B, Ethernet destination = R1",
    summary: `HOST-A ARPed for its gateway ${GA} — not for ${B} — and framed the packet to R1's MAC. The packet now waits at R1.`,
    key: (
      <>
        <span className="block pv-mono">IPv4 dst = {B} (HOST-B)</span>
        <span className="block pv-mono">Ethernet dst = {V4_MAC.R1L} (R1)</span>
        <span className="mt-1 block text-pv-text-muted">The router is the next hop, never the IP destination.</span>
      </>
    ),
    checks: (x) => {
      const r = lastRec(x.lab);
      return [
        { id: "frame", text: "Open the IPv4 frame and compare its two destinations", provenText: `Ethernet dst ${V4_MAC.R1L} (R1) · IPv4 dst ${B} (HOST-B).`, proven: sawFrame(x, r, "ipv4"), action: openFrame(x, "ipv4") },
        { id: "arp", text: "Open HOST-A: which address did its ARP cache learn?", provenText: `${GA} → ${V4_MAC.R1L} (the gateway). No entry for ${B}.`, proven: x.seen("dev:HOST-A") && !!x.lab.arp["HOST-A"][GA] && !x.lab.arp["HOST-A"][B], action: openDev(x, "HOST-A") },
      ];
    },
  },
  t5: {
    title: "R1 forwards: new frame, TTL 63, same IP addresses",
    summary: `R1 matched ${B} to its connected 192.168.10.64/26 on ge-0/0/1, ARPed for HOST-B on that LAN, decremented the TTL, recomputed the checksum and sent a new Ethernet frame.`,
    key: (
      <>
        <span className="block">
          <b>Changed:</b> Ethernet source and destination, TTL, header checksum.
        </span>
        <span className="block">
          <b>Unchanged:</b> source and destination IPv4, Identification, Flags, payload.
        </span>
      </>
    ),
    checks: (x) => [
      { id: "diff", text: "Open the before/after comparison", provenText: "TTL 64 → 63, checksum and both MACs changed; IPv4 source/destination identical.", proven: x.seen(`diff:${lastRec(x.lab).id}`), action: { label: "open the comparison", onClick: () => x.onOpenDiff(recIdx(x)) } },
      { id: "route", text: "On R1's CLI: which route sent it out ge-0/0/1?", provenText: "192.168.10.64/26 — directly connected on ge-0/0/1 (Gi0/1).", proven: x.seen("cli:route-table"), action: undefined },
    ],
    deepen: [{ q: "Why recompute the checksum?", a: "The IPv4 header checksum covers the TTL field. Changing the TTL changes the header, so R1 must compute a new checksum — or HOST-B would discard the packet as corrupted." }],
  },
  "t6-decide": {
    title: "HOST-B decides for itself",
    summary: `HOST-B ANDed with its own /${V4_PREFIX}: ${networkOf(B, V4_PREFIX)} vs ${networkOf(A, V4_PREFIX)} → REMOTE → its own gateway ${GB}.`,
    key: "Every host makes its own decision from its own configuration. Nothing HOST-A decided travels with the packet.",
  },
  "t6-send": {
    title: "No ARP needed: HOST-B already knew R1",
    summary: `HOST-B framed the reply to ${V4_MAC.R1R} straight away — it learned ${GB} when R1 ARPed for it.`,
    key: "An ARP request teaches its target the requester's mapping, so the reverse direction is often already resolved.",
    checks: (x) => [{ id: "b", text: "Open HOST-B: where did its gateway's MAC come from?", provenText: `${GB} → ${V4_MAC.R1R}, learned from R1's ARP request for ${B}.`, proven: x.seen("dev:HOST-B") && !!x.lab.arp["HOST-B"][GB], action: openDev(x, "HOST-B") }],
  },
  "t6-route": {
    title: "The reply crosses R1 the same way",
    summary: `R1 matched ${A} to 192.168.10.0/26 on ge-0/0/0, used its cached HOST-A entry, set TTL 63 and delivered the reply.`,
    key: "Two independent decisions (HOST-A's and HOST-B's), one router doing the same job in both directions.",
  },
  "t7-ticket": { title: "Ticket: HOST-A can reach HOST-C but not HOST-B", summary: "A network setting was recently changed. Nobody is sure which. Reproduce both paths before changing anything.", key: "Compare a destination that works with one that doesn't." },
  "t7-c": { title: "HOST-A → HOST-C still works", summary: "Local delivery to HOST-C succeeded as before.", key: "Whatever changed, HOST-A's LAN and its own address still work." },
};

// ---------------------------------------------------------------------------------------------------------------
// Event rows and deltas
// ---------------------------------------------------------------------------------------------------------------
function eventRows(x: V4BoardCtx): TeachingEventRowDef[] {
  const { lab } = x;
  const ev = lab.last;
  if (!ev) return [];
  if (ev.type === "noop") return [{ who: "Lab", body: ev.reason }];
  if (ev.type === "incident") return [{ who: "Ticket", tone: "attention", body: "HOST-A can reach HOST-C but cannot reach HOST-B. A network setting was recently changed." }];
  if (ev.type === "repair") return [{ who: "Repair", tone: "attention", body: ev.correct ? `HOST-A's prefix is /${V4_PREFIX} again. Nothing has been sent yet — prove it with traffic.` : "Nothing about HOST-A's forwarding decision changed." }];
  if (ev.type === "config") return [{ who: "Config", tone: "attention", body: ev.what === "arp" ? "All ARP caches cleared." : `HOST-A's ${ev.what} changed: ${ev.what === "prefix" ? `/${lab.config["HOST-A"].prefix}` : lab.config["HOST-A"].gateway}.` }];
  const d = lab.decision;
  if (ev.type === "decide" && d) {
    const hide = x.conceal && d.src === "HOST-A";
    return [{ who: d.src, tone: "device", body: hide ? `decided ${d.local ? "LOCAL" : "REMOTE"} for ${d.dst} → next hop ${d.nextHop}.` : `${d.srcIp} AND ${d.mask} = ${d.srcNet}; ${d.dst} AND ${d.mask} = ${d.dstNet} → ${d.local ? "LOCAL" : "REMOTE"} → next hop ${d.nextHop}.` }];
  }
  if (ev.type !== "traffic") return [];
  const r = lab.records[ev.rec];
  const rows: TeachingEventRowDef[] = [];
  if (r.kind === "send" && r.decision) rows.push({ who: r.src as string, tone: "device", body: `decided ${r.decision.local ? "LOCAL" : "REMOTE"} for ${r.dst} → next hop ${r.decision.nextHop}.` });
  r.arp.forEach((u, i) => {
    const who = u.by === "R1L" || u.by === "R1R" ? "R1" : u.by;
    rows.push({ who: `ARP ${i + 1}`, tone: u.outcome === "no-reply" ? "attention" : "result", body: `${who} needed the MAC of next hop ${u.ip} (${v4Owner(u.ip) ?? "no device owns it"}): ${u.outcome === "cache" ? `already in its cache → ${u.mac}` : u.outcome === "resolved" ? `ARP request → reply → ${u.mac}` : "ARP request — no reply. Entry INCOMPLETE; nothing can be sent."}` });
  });
  if (r.routing && r.routing.outFrame >= 0) {
    const o = r.frames[r.routing.outFrame];
    rows.push({ who: "R1", tone: "device", body: `${r.dst} ∈ ${r.routing.route} (connected, ${r.routing.egress}) → TTL ${fieldOf(r.frames[r.routing.inFrame], /^IPv4/, "TTL")} → ${fieldOf(o, /^IPv4/, "TTL")}, checksum ${fieldOf(o, /^IPv4/, "Header Checksum")}, new frame ${fieldOf(o, /^Ethernet/, "Source MAC")} → ${fieldOf(o, /^Ethernet/, "Destination MAC")}.` });
  }
  if (r.ipFrame !== undefined && r.kind === "send") {
    const f = r.frames[r.ipFrame];
    rows.push({ who: "Frame", body: `IPv4 ${fieldOf(f, /^IPv4/, "Source")} → ${fieldOf(f, /^IPv4/, "Destination")} inside Ethernet → ${fieldOf(f, /^Ethernet/, "Destination MAC")} (${v4Owner(fieldOf(f, /^Ethernet/, "Destination MAC"))}).` });
  }
  rows.push({ who: "Result", tone: r.result === "delivered" ? "result" : r.result === "at-router" ? "device" : "attention", body: r.result === "delivered" ? `${v4Owner(r.dst)} received it.` : r.result === "at-router" ? "R1 accepted the frame (its own MAC) — the packet waits for R1 to route it." : r.result === "arp-failed" ? `${r.src} never sent an IPv4 packet: its next hop never answered ARP.` : "No route." });
  return rows;
}

function deltas(x: V4BoardCtx): StateDelta[] {
  const { lab, before } = x;
  const tables: (V4Host | "R1")[] = ["HOST-A", "HOST-C", "HOST-B", "R1"];
  const out: StateDelta[] = tables.map((t) => {
    const n = Object.keys(lab.arp[t]).length - (before ? Object.keys(before.arp[t]).length : 0);
    return { label: `${t} ARP`, count: Math.max(0, n), text: n > 0 ? undefined : "UNCHANGED" };
  });
  const fwd = lab.r1Forwarded - (before?.r1Forwarded ?? 0);
  out.push({ label: "R1 routed", count: fwd, text: fwd ? `+${fwd}` : "0" });
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Incident: symptom → observation → evidence → hypothesis → test → root cause
// ---------------------------------------------------------------------------------------------------------------
const HYPOTHESES: PredictionOption[] = opts(["route", "R1 has no route to 192.168.10.64/26"], ["gateway", "HOST-A's default gateway is wrong"], ["b-down", "HOST-B is down"], ["switch", "SW-A is dropping HOST-A's traffic"], ["mask", "HOST-A's mask makes 192.168.10.70 look local"]);
const HYP_FEEDBACK: Record<string, string> = {
  route: "R1's routing table has 192.168.10.64/26 as a connected route — and R1 never even received an IPv4 packet to route.",
  gateway: "HOST-A never used its gateway at all: it decided LOCAL and ARPed for 192.168.10.70 itself. A wrong gateway would show REMOTE with an unanswered ARP for the gateway.",
  "b-down": "HOST-A's ARP request never reached HOST-B: it is on a different LAN behind R1. HOST-B's state can't explain what HOST-A does.",
  switch: "SW-A delivered HOST-A's frames: HOST-C received them, and R1 received the ARP broadcast.",
};
const TESTS: PredictionOption[] = opts(["arp", "HOST-A's ARP for 192.168.10.70 got no reply"], ["proof", `With HOST-A's configured /${V4_FAULT_PREFIX}, ${A} and ${B} both AND to 192.168.10.0 — so HOST-A treats ${B} as local and never selects its gateway`], ["route", "R1 has a connected route to 192.168.10.64/26"]);
const TEST_FEEDBACK: Record<string, string> = { arp: "True — but that is the symptom. Why did HOST-A ARP for .70 at all?", route: "True — it rules R1 out. It doesn't explain HOST-A's choice." };

export function v4IncidentEvidence(x: V4BoardCtx): EngineerCheckFact[] {
  const fromRec = [...x.lab.records].reverse().find((r) => r.kind === "send" && r.src === "HOST-A" && r.dst === B && r.result === "arp-failed");
  const from = x.lab.log.find((l) => l.text.startsWith("Ticket:"))?.tag ? Number(x.lab.log.find((l) => l.text.startsWith("Ticket:"))!.tag.slice(1)) : x.lab.seq;
  const since = (k: string) => x.seenSince(from, k);
  const arpFrame = fromRec ? fromRec.frameKinds.findIndex((k) => k === "arp-request") : -1;
  return [
    { id: "e-dec", text: "What did HOST-A decide for 192.168.10.70? — inspect its decision", provenText: "LOCAL — next hop 192.168.10.70 itself, not the gateway.", proven: since("dec:HOST-A") && fromRec?.decision?.local === true, action: { label: "inspect the decision", onClick: () => x.onInspectDecision("HOST-A") } },
    { id: "e-arp", text: "Which address did HOST-A ARP for? — open its ARP request", provenText: "“Who has 192.168.10.70?” — the destination, not the gateway 192.168.10.1.", proven: !!fromRec && arpFrame >= 0 && since(`pkt:${fromRec.id}-${arpFrame}`), action: fromRec && arpFrame >= 0 ? { label: "open the ARP request", onClick: () => x.onInspectFrame(x.lab.records.indexOf(fromRec), arpFrame) } : undefined },
    { id: "e-inc", text: "Did the ARP get an answer? — open HOST-A", provenText: "No: 192.168.10.70 → INCOMPLETE in HOST-A's ARP cache.", proven: since("dev:HOST-A") && x.lab.arp["HOST-A"][B] === "INCOMPLETE", action: openDev(x, "HOST-A") },
    { id: "e-r1", text: "Did R1 route anything? — open R1", provenText: "No: its routed counter did not move; it only saw an ARP request that was not for its address.", proven: since("dev:R1"), action: openDev(x, "R1") },
    { id: "e-route", text: "Does R1 have a route to HOST-B? — R1's routing table (CLI)", provenText: "Yes: 192.168.10.64/26 is directly connected on ge-0/0/1.", proven: since("cli:route-table"), action: undefined },
    { id: "e-cfg", text: "What is HOST-A's configuration? — inspect HOST-A's configuration", provenText: `${A}/${V4_FAULT_PREFIX} (mask ${maskOf(V4_FAULT_PREFIX)}) · gateway ${GA}.`, proven: since("cfg:HOST-A"), action: { label: "inspect configuration", onClick: () => x.onInspectConfig() } },
    { id: "e-b", text: "What is HOST-B's address? — open HOST-B", provenText: `${B}/${V4_PREFIX} — in 192.168.10.64/26.`, proven: since("dev:HOST-B"), action: openDev(x, "HOST-B") },
  ];
}
export const v4ConfigInspected = (x: Pick<V4BoardCtx, "lab" | "seenSince">) => {
  const t = x.lab.log.find((l) => l.text.startsWith("Ticket:"))?.tag;
  return !!t && x.seenSince(Number(t.slice(1)), "cfg:HOST-A");
};

export function v4IncidentSolved(x: V4BoardCtx): boolean {
  return v4IncidentEvidence(x).every((f) => f.proven) && sameSet(x.answer("incident|hypothesis"), ["mask"]) && sameSet(x.answer("incident|test"), ["proof"]);
}

function Incident({ x }: { x: V4BoardCtx }) {
  const evidence = v4IncidentEvidence(x);
  const gathered = evidence.filter((f) => f.proven).length;
  const hyp = x.answer("incident|hypothesis");
  const test = x.answer("incident|test");
  const hypOk = sameSet(hyp, ["mask"]);
  const testOk = sameSet(test, ["proof"]);
  const cfgSeen = evidence.find((f) => f.id === "e-cfg")?.proven;
  return (
    <>
      <BoardSection label="Symptom" tone="cyan">
        <p className="text-[12.5px] leading-snug text-pv-text-muted">HOST-A → HOST-C works. HOST-A → HOST-B fails: no IPv4 packet is delivered, and no device reports an error.</p>
      </BoardSection>
      <BoardSection label="Observation">
        <p className="text-[12.5px] leading-snug text-pv-text-muted">Start from HOST-A&apos;s forwarding decision, then follow what it did next. Don&apos;t change anything yet.</p>
      </BoardSection>
      <EngineerCheck intro="Evidence — each item needs a real inspection:" facts={evidence} footnote="Gather at least four pieces of evidence to unlock the hypothesis." />
      {gathered >= 4 && <PredictionBlock label="Hypothesis" prompt="What is the root cause?" options={HYPOTHESES} value={hyp} onChange={(v) => x.onAnswer("incident|hypothesis", v)} verdict={hyp.length ? <Verdict correct={hypOk}>{hypOk ? "Consistent with the evidence. Now prove it." : (HYP_FEEDBACK[hyp[0]] ?? "That doesn't fit the evidence.")}</Verdict> : undefined} />}
      {hypOk && !cfgSeen && <Verdict correct={false}>To test this hypothesis you need HOST-A&apos;s actual configuration — inspect it first.</Verdict>}
      {hypOk && cfgSeen && <PredictionBlock label="Test" prompt="Which observation proves it?" options={TESTS} value={test} onChange={(v) => x.onAnswer("incident|test", v)} verdict={test.length ? <Verdict correct={testOk}>{testOk ? `That's the proof: under /${V4_FAULT_PREFIX}, ${A} AND ${maskOf(V4_FAULT_PREFIX)} = 192.168.10.0 and ${B} AND ${maskOf(V4_FAULT_PREFIX)} = 192.168.10.0.` : TEST_FEEDBACK[test[0]]}</Verdict> : undefined} />}
      {v4IncidentSolved(x) && (
        <KeyLesson>
          <b>Root cause — HOST-A&apos;s mask is /{V4_FAULT_PREFIX} instead of /{V4_PREFIX}.</b> With the wrong mask HOST-A classifies {B} as LOCAL → next hop = {B} itself → ARP “who has {B}?” on HOST-A&apos;s LAN → HOST-B is on another LAN and R1 doesn&apos;t answer for others (no Proxy ARP) → INCOMPLETE → no IPv4 packet ever reaches R1. HOST-C still works because it is local under both masks.
        </KeyLesson>
      )}
    </>
  );
}

const REPAIR_FEEDBACK: Record<string, string> = {
  "gateway-65": `192.168.10.65 is not on HOST-A's LAN — and HOST-A doesn't use its gateway for ${B} anyway: it decides LOCAL.`,
  "r1-route": "R1 already has 192.168.10.64/26 as a connected route, and it never receives an IPv4 packet to route.",
  "restart-b": "HOST-B isn't involved: HOST-A's ARP never reaches HOST-B's LAN.",
};

function RepairChoice({ x, tried }: { x: V4BoardCtx; tried?: string }) {
  return (
    <>
      <PredictionBlock label="Repair" prompt="Choose the change that fixes the cause you proved." options={V4_LAB_REPAIRS.map((r) => ({ id: r.id, label: r.label }))} value={x.answer("repair-choice")} onChange={(v) => x.onAnswer("repair-choice", v)} />
      {tried && tried !== V4_LAB_REPAIR_CORRECT && <Verdict correct={false}>{REPAIR_FEEDBACK[tried]} Pick again.</Verdict>}
    </>
  );
}

/** Verified by traffic: HOST-A (at /26) decided REMOTE, used the gateway, R1 forwarded with TTL 63, HOST-B received. */
export function v4RepairVerified(s: V4LabState): boolean {
  const r = s.records[s.records.length - 1];
  const send = [...s.records].reverse().find((x) => x.kind === "send" && x.src === "HOST-A" && x.dst === B);
  return s.config["HOST-A"].prefix === V4_PREFIX && r?.kind === "route" && r.result === "delivered" && !!r.routing && fieldOf(r.frames[r.routing.outFrame], /^IPv4/, "TTL") === "63" && fieldOf(r.frames[r.routing.outFrame], /^IPv4/, "Source") === A && send?.decision?.local === false && send.arp[0]?.ip === GA;
}

const VERIFY_COPY: Record<string, StepCopy> = {
  "t8-repair": { title: "Prefix restored — not yet verified", summary: `HOST-A is ${A}/${V4_PREFIX} again. No traffic has been sent.`, key: "A repair is only a hypothesis about the fix. Traffic proves it." },
  "t8-send": {
    title: "REMOTE again: to the gateway",
    summary: `HOST-A decided REMOTE, used next hop ${GA} (MAC already cached) and framed the packet to R1.`,
    key: "The decision is right again, so everything after it is right again.",
    checks: (x) => [{ id: "dec", text: "Inspect HOST-A's decision", provenText: `${networkOf(A, V4_PREFIX)} ≠ ${networkOf(B, V4_PREFIX)} → REMOTE → next hop ${GA}.`, proven: x.seen("dec:HOST-A") && x.lab.decision?.local === false, action: { label: "inspect the decision", onClick: () => x.onInspectDecision("HOST-A") } }],
  },
  "t8-route": {
    title: "Verified: HOST-B reached",
    summary: `R1 forwarded the packet out ge-0/0/1 with TTL 63; HOST-B received it with source ${A} and destination ${B}.`,
    key: "Verified by traffic: correct decision → correct next hop → correct Layer-2 target → routed (TTL 63) → delivered, with the IPv4 addresses unchanged.",
    checks: (x) => [
      { id: "diff", text: "Open the before/after comparison", provenText: "TTL 64 → 63 · both MACs new · IPv4 source and destination unchanged.", proven: x.seen(`diff:${lastRec(x.lab).id}`) && v4RepairVerified(x.lab), action: { label: "open the comparison", onClick: () => x.onOpenDiff(recIdx(x)) } },
      { id: "b", text: "Open HOST-B: did it receive the packet?", provenText: `Received ${x.lab.delivered["HOST-B"]} packet(s) from HOST-A in this lab.`, proven: x.seen("dev:HOST-B"), action: openDev(x, "HOST-B") },
    ],
  },
};
const copyFor = (id: string) => COPY[id] ?? VERIFY_COPY[id];

export function v4StepChecksDone(stepId: string, x: V4BoardCtx): boolean {
  if (stepId === "t7-b") return v4IncidentSolved(x);
  const c = copyFor(stepId)?.checks?.(x);
  return !c || c.every((f) => f.proven);
}

export interface V4LabBoardProps extends V4BoardCtx {
  revealed: Record<string, string[]>;
  cursor: number;
  freePlay: boolean;
  inFlight: boolean;
  gate?: string;
  repairTried?: string;
}

export function V4LabBoard(props: V4LabBoardProps) {
  const { lab, cursor, freePlay, inFlight } = props;
  const prev = cursor > 0 ? V4_LAB_SCRIPT[cursor - 1] : undefined;
  const next = !freePlay ? V4_LAB_SCRIPT[cursor] : undefined;
  const copy = !freePlay && prev ? copyFor(prev.id) : undefined;
  const incident = !freePlay && prev?.id === "t7-b";

  if (inFlight)
    return (
      <TeachingBoard phase={`${prev?.phase ?? "T0"} · in flight`} title="Frames in flight" summary="Watch which address is ARPed, and where the IPv4 frame is addressed.">
        <BoardSection label="So far" tone="cyan">
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
  const t0q = { id: "t0", options: opts([C, `${C} (HOST-C)`], [B, `${B} (HOST-B)`], [GA, `${GA} (R1 ge-0/0/0, the gateway)`]) };
  const t0ans = props.answer("t0");
  const t0ok = sameSet(t0ans, [C, GA]);
  const t0Facts: EngineerCheckFact[] = [
    { id: "cfg", text: "Inspect HOST-A's configuration: address, prefix, gateway", provenText: `${A}/${V4_PREFIX} (${maskOf(V4_PREFIX)}) · gateway ${GA}.`, proven: props.seen("cfg:HOST-A"), action: { label: "inspect configuration", onClick: () => props.onInspectConfig() } },
    { id: "r1", text: "Open R1: which networks does it know?", provenText: "192.168.10.0/26 (ge-0/0/0) and 192.168.10.64/26 (ge-0/0/1), both connected. ARP caches all empty.", proven: props.seen("dev:R1") || props.seen("cli:route-table"), action: openDev(props, "R1") },
  ];

  return (
    <TeachingBoard
      phase={freePlay ? "Free play" : `${prev?.phase ?? "T0"} · ${V4_LAB_STAGES[prev?.stage ?? 0]}`}
      title={freePlay ? (lab.last ? "What just happened" : "Free play") : incident ? "Incident: HOST-A can't reach HOST-B" : (copy?.title ?? "Before anything is sent")}
      summary={
        freePlay
          ? "Pick any source and destination, change HOST-A's prefix (/24–/27) or its gateway, clear ARP caches. Watch the decision change first, and everything else follow."
          : incident
            ? "Reproduced. Troubleshoot from the forwarding decision: evidence → hypothesis → test → root cause."
            : (copy?.summary ?? `HOST-A ${A}/${V4_PREFIX}, gateway ${GA}. HOST-C ${C} (a lab-only host on HOST-A's LAN). HOST-B ${B} behind R1. All ARP caches are empty.`)
      }
    >
      {!prev && !freePlay && (
        <>
          <PredictionBlock
            prompt={`Which of these addresses are on HOST-A's own network (${A}/${V4_PREFIX})? Select all.`}
            options={t0q.options}
            multiple
            value={t0ans}
            onChange={(v) => props.onAnswer("t0", v)}
            verdict={t0ans.length ? <Verdict correct={t0ok}>{t0ok ? `Right: ${C} and ${GA} are in ${networkOf(A, V4_PREFIX)}/${V4_PREFIX}; ${B} is in ${networkOf(B, V4_PREFIX)}/${V4_PREFIX}.` : `It's HOST-A's own /${V4_PREFIX} that decides: the network bits end inside the last octet (blocks of 64). ${C} and ${GA} fall in .0–.63; ${B} does not.`}</Verdict> : undefined}
          />
          <EngineerCheck intro="Inspect the network before anything moves:" facts={t0Facts} />
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
          {checks && <EngineerCheck intro="Verify it — the decision, device cards, frames, the packet diff, R1's CLI:" facts={checks} />}
        </>
      )}

      {next?.repair && <RepairChoice x={props} tried={props.repairTried} />}
      {next?.predict?.map((p) => (
        <PredictionBlock key={p.id} prompt={p.prompt} options={p.options} multiple={p.multiple} value={props.answer(p.id)} onChange={(v) => props.onAnswer(p.id, v)} />
      ))}
      {next && <NextAction>{props.gate ?? `${next.label}.`}</NextAction>}
      {!next && !freePlay && <NextAction>Guided steps complete — continue in free play.</NextAction>}
      {freePlay && <NextAction>Use the controls below the topology.</NextAction>}
      {incident ? (
        <DeepenUnderstanding
          qa={[
            { q: "Would Proxy ARP fix it?", a: "Enabling Proxy ARP on R1 would make R1 answer “192.168.10.70 is at R1's MAC”, and traffic would flow — but HOST-A would still have the wrong idea of its own network (a wrong broadcast address, and every destination its mistaken network covers still treated as local). It hides the misconfiguration instead of fixing it." },
            { q: "How is this different from a wrong default gateway?", a: "With a wrong gateway HOST-A still decides REMOTE correctly; it just picks an unusable next hop (its ARP for the gateway gets no answer). With a wrong mask HOST-A picks the wrong class — LOCAL — and never uses the gateway at all. Try both in free play." },
          ]}
        />
      ) : (
        copy?.deepen && <DeepenUnderstanding qa={copy.deepen} />
      )}
    </TeachingBoard>
  );
}
