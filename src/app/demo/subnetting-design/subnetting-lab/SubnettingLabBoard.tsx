"use client";

import { useState, type ReactNode } from "react";
import { clsx } from "clsx";
import { PredictionBlock, StateDeltaChips, Verdict, type EngineerCheckFact, type PredictionOption, type StateDelta } from "@/components/practice-lab/TeachingBoard";
import { PARENT, SEGMENTS, blockSize, isAligned, maskOf, rangeOf } from "@/lib/sim-engine/scenarios/subnettingDesign";
import {
  SL_BOUNDARY_CANDIDATES,
  SL_BOUNDARY_PREFIX,
  SL_CALC,
  SL_FLSM_PREFIXES,
  SL_LAN_D,
  SL_PREFIX_MAX,
  SL_PREFIX_MIN,
  dotOct,
  equalSplit,
  firstFit,
  fitStatus,
  freeSpace,
  holes,
  incidentSymptom,
  lastOctet,
  octetBits,
  parseIPv4,
  planReport,
  rangeLabel,
  realBlock,
  slMinPrefix,
  slRow,
  slUsable,
  stepNetwork,
  subnetCalc,
  validateRow,
  type SlAction,
  type SlBoundaryTest,
  type SlRule,
  type SlSeg,
  type SlState,
} from "@/lib/sim-engine/scenarios/subnettingLab";
import { SEG_COLOR } from "./SubnetRuler";
import { AddressBoard, AddressTiles, BitsSnap, BlockGrid, Card, CapacityBars, ClaimsVsReality, Coach, ExampleContainer, FlsmSplit, PlainList, RequirementPieces, SubnetCard, planRows, plainViolations, segName, startsText, type BoardGhost } from "./SubnetVisuals";

/**
 * Subnet Design Studio — Learning View. Each stage shows ONE dominant visual and reveals the rest progressively:
 * concept → visual → predict → try it → result → why → quick verify. The engineering evidence (exact masks, raw
 * table, rules, overlap matrix, log) lives in "Engineer details", which a learner never has to open.
 *
 * The lab model owns every number and verdict; this file owns sequence, copy and which visual is on screen.
 * A prediction must be answered before the action it predicts appears, and is locked once that action happened.
 * A quick-verify item needs an inspection made after the latest event AND the matching lab state.
 */

export interface SlDraft {
  prefix?: number;
  network: string;
}
export type SlWhere = "visual" | "details";
export interface SlBoardCtx {
  lab: SlState;
  before?: SlState;
  conceal: boolean;
  seen: (key: string) => boolean;
  seenSince: (seq: number, key: string) => boolean;
  answer: (id: string) => string[];
  onAnswer: (id: string, v: string[]) => void;
  act: (a: SlAction) => void;
  inspect: (key: string, where?: SlWhere, anchor?: string) => void;
  drafts: Partial<Record<SlSeg, SlDraft>>;
  setDraft: (seg: SlSeg, d: Partial<SlDraft>) => void;
  selected?: SlSeg;
  select: (seg: SlSeg) => void;
  windowStart: number;
  zoomed: boolean;
  setZoomed: (z: boolean) => void;
}

const opts = (...xs: [string, string][]): PredictionOption[] => xs.map(([id, label]) => ({ id, label }));
const same = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));
const LADDER = (h: number) => `2^${h} − 2 = ${2 ** h - 2}`;

// ---------------------------------------------------------------------------------------------------------------
// Predictions (answers derived from the model; authored order never puts the answer first every time)
// ---------------------------------------------------------------------------------------------------------------
interface PredictDef {
  id: string;
  stage: number;
  prompt: string;
  options: PredictionOption[];
  correct: string[];
  revealOn: (lab: SlState) => boolean;
  explain: string | ((lab: SlState) => string);
}
const LARGEST = [...SEGMENTS].sort((a, b) => b.hosts - a.hosts)[0];
const MIN_TOTAL = SEGMENTS.reduce((n, s) => n + blockSize(slMinPrefix(s.hosts)), 0);
const RAW_TOTAL = SEGMENTS.reduce((n, s) => n + s.hosts, 0);
const CALC = subnetCalc(SL_CALC.address, SL_CALC.prefix);
const FLSM_POSSIBLE = SL_FLSM_PREFIXES.some((p) => equalSplit(p).satisfiesAll);
const C_HOSTS = SEGMENTS.find((s) => s.id === "LAN-C")!.hosts;
const C_MIN = slMinPrefix(C_HOSTS);
const BOUNDARY_COUNT = blockSize(PARENT.prefix) / blockSize(SL_BOUNDARY_PREFIX);

export const SL_PREDICTIONS: PredictDef[] = [
  { id: "t0", stage: 0, prompt: "Which requirement will shape this design most?", options: opts(["TRANSIT", "Transit (2)"], ["LAN-C", "LAN-C (25)"], ["LAN-A", "LAN-A (100)"], ["LAN-B", "LAN-B (50)"]), correct: [LARGEST.id], revealOn: (l) => l.requirementsRead, explain: `${LARGEST.id}'s ${LARGEST.hosts} addresses need a /${slMinPrefix(LARGEST.hosts)} — ${blockSize(slMinPrefix(LARGEST.hosts))} of the 256 addresses. Every other block has to fit around it.` },
  { id: "t1", stage: 1, prompt: `Which is the smallest prefix that holds LAN-C's ${C_HOSTS} addresses?`, options: opts(["26", "/26"], ["28", "/28"], ["27", "/27"], ["25", "/25"]), correct: [String(C_MIN)], revealOn: (l) => slRow(l, "LAN-C")?.prefix !== undefined, explain: `${LADDER(4)} < ${C_HOSTS} ≤ ${LADDER(5)} → 5 host bits → /${C_MIN}. A /26 also holds ${C_HOSTS}, but it is not the smallest.` },
  { id: "t2", stage: 2, prompt: `How many /${SL_BOUNDARY_PREFIX} blocks fit inside ${PARENT.network}/${PARENT.prefix}?`, options: opts(["4", "4"], ["16", "16"], ["8", "8"], ["32", "32"]), correct: [String(BOUNDARY_COUNT)], revealOn: (l) => l.boundaryTests.length > 0, explain: `A /27 block is 32 addresses: 256 ÷ 32 = ${BOUNDARY_COUNT} blocks, starting at ${startsText(SL_BOUNDARY_PREFIX)}.` },
  { id: "t3", stage: 3, prompt: `What is the broadcast address of the subnet that contains ${SL_CALC.address}/${SL_CALC.prefix}?`, options: opts(["207", ".207"], ["255", ".255"], ["231", ".231"], [String(lastOctet(CALC.broadcast)), dotOct(CALC.broadcast)]), correct: [String(lastOctet(CALC.broadcast))], revealOn: (l) => !!l.calc, explain: `${SL_CALC.address} belongs to ${CALC.network}/${SL_CALC.prefix}. Broadcast = every host bit 1 = ${CALC.broadcast}. Only the whole /24 ends in .255.` },
  { id: "t4", stage: 4, prompt: `Can one equal block size carve the /24 into four networks that all fit?`, options: opts(["26", "Yes, with /26"], ["25", "Yes, with /25"], ["no", "No"], ["27", "Yes, with /27"]), correct: [FLSM_POSSIBLE ? "26" : "no"], revealOn: (l) => l.flsmTried.length > 0, explain: "Four networks need at least four blocks (/26 or smaller), but LAN-A's 100 addresses need a /25 — and only two /25s exist. No single size works." },
  { id: "t5", stage: 5, prompt: "How many addresses will the four smallest-fitting blocks use together?", options: opts([String(RAW_TOTAL), String(RAW_TOTAL)], ["256", "256"], [String(MIN_TOTAL), String(MIN_TOTAL)], ["200", "200"]), correct: [String(MIN_TOTAL)], revealOn: (l) => ["LAN-A", "LAN-B", "TRANSIT"].every((id) => slRow(l, id as SlSeg)?.prefix !== undefined), explain: `Blocks come in powers of two: 128 + 64 + 32 + 4 = ${MIN_TOTAL}. ${RAW_TOTAL} is the raw demand before rounding each requirement up to a block.` },
  { id: "t6", stage: 6, prompt: "Which network is the most convenient to place first?", options: opts(["TRANSIT", "Transit"], ["LAN-B", "LAN-B"], ["LAN-C", "LAN-C"], ["LAN-A", "LAN-A"]), correct: [LARGEST.id], revealOn: (l) => l.rows.some((r) => r.network !== undefined), explain: "The largest. A block of 2^k ends on a multiple of 2^k, so the next free address is already a valid start for every smaller block — no gaps to skip. Other orders can still give a valid plan; they just leave gaps to track." },
  {
    id: "t7",
    stage: 7,
    prompt: `A new LAN-D needs ${SL_LAN_D.hosts} addresses. Where can it go?`,
    options: opts(["228", ".228/28"], ["232", ".232/28"], ["240", ".240/28"], ["none", "Nowhere — it does not fit"]),
    correct: [],
    revealOn: (l) => slRow(l, "LAN-D")?.network !== undefined,
    explain: (l) => {
      const fit = firstFit(l.rows.filter((r) => r.id !== "LAN-D"), "LAN-D", SL_LAN_D.hosts);
      const free = freeSpace(l.rows.filter((r) => r.id !== "LAN-D"));
      return `LAN-D needs a /28 — 16 addresses on a multiple of 16. Your free space is ${free.ranges.map((f) => rangeLabel(f)).join(", ") || "none"}; ${fit ? `the first /28 that fits is ${dotOct(fit.network)}/28` : "no aligned /28 fits"}. Free count alone isn't enough — the start must be aligned.`;
    },
  },
];
export const slPrediction = (id: string) => SL_PREDICTIONS.find((p) => p.id === id);
export function slCorrectFor(id: string, lab: SlState): string[] {
  if (id === "t7") {
    const fit = firstFit(lab.rows.filter((r) => r.id !== "LAN-D"), "LAN-D", SL_LAN_D.hosts);
    return [fit ? String(lastOctet(fit.network)) : "none"];
  }
  return slPrediction(id)?.correct ?? [];
}
export const slIsRevealed = (id: string, lab: SlState) => !!slPrediction(id)?.revealOn(lab);

// ---------------------------------------------------------------------------------------------------------------
// Stage completion (state only) and the learner-facing headers
// ---------------------------------------------------------------------------------------------------------------
const minimal = (lab: SlState, id: SlSeg) => {
  const r = slRow(lab, id);
  return !!r && r.prefix === slMinPrefix(r.hosts);
};
export function slStageDone(lab: SlState): boolean {
  switch (lab.stage) {
    case 0:
      return lab.requirementsRead;
    case 1:
      return minimal(lab, "LAN-C");
    case 2:
      return lab.boundaryTests.some((t) => t.aligned) && lab.boundaryTests.some((t) => !t.aligned);
    case 3:
      return !!lab.calc;
    case 4:
      return lab.flsmTried.includes(25) && lab.flsmTried.includes(26);
    case 5:
      return SEGMENTS.every((s) => minimal(lab, s.id));
    case 6:
      return planReport(lab.rows).allValid;
    case 7: {
      const d = lab.report?.checks.find((c) => c.id === "LAN-D");
      return !!lab.report && lab.reportSeq === lab.seq && lab.report.allValid && !!d?.valid;
    }
    case 8:
      return lab.incident.resolved;
    default:
      return false;
  }
}
export function slStageGate(lab: SlState): string | undefined {
  if (slStageDone(lab)) return undefined;
  return ["Look at the requirements first", "Find LAN-C's smallest fitting size", "Try two starting addresses", "Calculate the subnet", "Try the /25 and /26 splits", "Give every network its smallest block", "Place all four networks validly", "Fit LAN-D, then check your design", "Investigate, redesign and verify"][lab.stage];
}
export function slStageHeader(lab: SlState): { title: string; concept: string } {
  if (lab.freePlay) return { title: "Design anything", concept: "Change requirements, sizes and placements. The same validator judges every design." };
  return [
    { title: "One /24, four networks", concept: `You own ${PARENT.network}/${PARENT.prefix} — 256 addresses. Four networks need room. Each count already includes R1's interface.` },
    { title: "How big must LAN-C be?", concept: "A subnet is a container of a fixed size. Find the smallest container that holds LAN-C." },
    { title: "Where can a /27 begin?", concept: "A /27 owns 32 addresses at a time. Let's find where each 32-address block starts." },
    { title: "One subnet, end to end", concept: "Any address belongs to exactly one block. Find that block's network, hosts and broadcast." },
    { title: "Equal-size blocks (FLSM)", concept: "Cut the /24 into equal pieces. Can one size fit all four networks?" },
    { title: "Give each network its own size (VLSM)", concept: "Each network gets the smallest block that fits it — different sizes in one /24." },
    { title: "Build the address plan", concept: "Place every block in the /24. Each must start on its own boundary and share nothing." },
    { title: "Check the finished plan", concept: "A plan is valid only as a whole. Then fit a new network into what's left." },
    { title: "A spreadsheet plan that looks right", concept: "A colleague's plan looks tidy — but users on LAN-B have a problem. Find out why from the maths." },
  ][lab.stage];
}

// ---------------------------------------------------------------------------------------------------------------
// Shared pieces: result card, "why does this work?", predict, controls
// ---------------------------------------------------------------------------------------------------------------
function calcLines(lab: SlState): string[] {
  const ev = lab.last;
  if (!ev) return [];
  if (ev.kind === "size" && ev.seg) {
    const r = slRow(lab, ev.seg)!;
    const h = 32 - r.prefix!;
    return [`/${r.prefix} → ${h} host bits → 2^${h} = ${blockSize(r.prefix!)} addresses`, `usable = ${LADDER(h)} (ordinary LAN subnet)`, `mask ${maskOf(r.prefix!)}`];
  }
  if (ev.kind === "boundary") {
    const t = lab.boundaryTests[lab.boundaryTests.length - 1];
    const o = lastOctet(t.address);
    return [`/${t.prefix} → blocks of ${blockSize(t.prefix)}`, `${o} mod ${blockSize(t.prefix)} = ${o % blockSize(t.prefix)}`, `${o} AND ${octetBits(t.address, t.prefix).maskOctet} = ${octetBits(t.address, t.prefix).anded} → ${t.real}/${t.prefix}`];
  }
  if (ev.kind === "calc" && lab.calc) return [`${lab.calc.address} AND ${lab.calc.mask} = ${lab.calc.network}`, `first = network + 1 · last = broadcast − 1`, `next subnet = broadcast + 1 = ${lab.calc.next}`];
  if (ev.kind === "flsm" && lab.flsm) {
    const f = equalSplit(lab.flsm);
    return [`borrow ${f.borrowed} bit${f.borrowed === 1 ? "" : "s"} → 2^${f.borrowed} = ${f.count} blocks`, `each ${f.block} addresses, ${f.usable} usable`];
  }
  if ((ev.kind === "place" || ev.kind === "clear") && ev.seg) {
    const c = validateRow(lab.rows, ev.seg);
    if (!c) return [ev.text];
    const o = lastOctet(c.written);
    return [`${c.written}/${c.prefix}: ${o} mod ${blockSize(c.prefix)} = ${o % blockSize(c.prefix)}`, `real block = ${c.written} AND ${maskOf(c.prefix)} = ${c.real}`, `range ${rangeLabel(c.realRange)}`];
  }
  return [ev.text];
}
function deltas(lab: SlState, before?: SlState): StateDelta[] {
  const placedN = (s?: SlState) => (s ? s.rows.filter((r) => r.network !== undefined).length : 0);
  const alloc = (s?: SlState) => (s ? freeSpace(s.rows).allocated : 0);
  const d = (label: string, a: number, b: number, text: string): StateDelta => ({ label, count: a !== b ? 1 : 0, text: a !== b ? text : "UNCHANGED" });
  return [d("Placed", placedN(lab), placedN(before), `${placedN(lab)}/${lab.rows.length}`), d("Allocated", alloc(lab), alloc(before), `${alloc(lab)}/256`)];
}
function WhyDetails({ x, children }: { x: SlBoardCtx; children?: ReactNode }) {
  return (
    <details className="mt-2 rounded-xl border border-pv-border/80 p-2.5">
      <summary className="cursor-pointer text-[13px] font-semibold text-pv-cyan-soft outline-none">Why does this work? ▾</summary>
      <div className="mt-2 space-y-2">
        {children}
        <ul className="space-y-0.5 pv-mono text-[12px] text-pv-text-muted">
          {calcLines(x.lab).map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
        <StateDeltaChips deltas={deltas(x.lab, x.before)} label="What changed" />
      </div>
    </details>
  );
}
function Result({ tone, title, why, remember, children }: { tone: "ok" | "warn" | "bad"; title: ReactNode; why?: ReactNode; remember?: ReactNode; children?: ReactNode }) {
  return (
    <Card tone={tone}>
      <p className={clsx("text-[17px] font-semibold leading-snug", tone === "ok" ? "text-pv-success" : tone === "warn" ? "text-pv-warning" : "text-pv-danger")}>{title}</p>
      {why && (
        <div className="mt-1.5">
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-pv-text-faint">Why</p>
          <div className="text-[14px] leading-snug text-pv-text">{why}</div>
        </div>
      )}
      {remember && (
        <p className="mt-1.5 text-[13.5px] text-pv-text-muted">
          <span className="font-semibold text-pv-cyan-soft">Remember · </span>
          {remember}
        </p>
      )}
      {children}
    </Card>
  );
}
function Predict({ id, x }: { id: string; x: SlBoardCtx }) {
  const p = slPrediction(id)!;
  const locked = slIsRevealed(id, x.lab);
  const ans = x.answer(id);
  const explain = typeof p.explain === "function" ? p.explain(x.lab) : p.explain;
  return (
    <Card tone="task" title={locked ? "Your prediction" : "Predict first"}>
      <PredictionBlock prompt={p.prompt} label=" " options={p.options} value={ans} onChange={(v) => !locked && x.onAnswer(id, v)} verdict={locked && ans.length ? <Verdict correct={same(ans, slCorrectFor(id, x.lab))}>{explain}</Verdict> : undefined} />
    </Card>
  );
}
const big = "rounded-full px-4 py-2 text-[14px] font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-pv-cyan disabled:cursor-not-allowed disabled:opacity-40";
function Btn({ children, onClick, disabled, tone = "primary" }: { children: ReactNode; onClick: () => void; disabled?: boolean; tone?: "primary" | "quiet" }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={clsx(big, tone === "primary" ? "bg-pv-cyan text-[#03131a] hover:brightness-110" : "border border-pv-border text-pv-text-muted hover:text-pv-text")}>
      {children}
    </button>
  );
}
function Checklist({ items }: { items: { label: string; done: boolean }[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[14px]">
      {items.map((i) => (
        <li key={i.label} className={i.done ? "text-pv-success" : "text-pv-text-muted"}>
          {i.done ? "☑" : "☐"} {i.label}
        </li>
      ))}
    </ul>
  );
}
/** Self-verifying evidence, learner-worded (same contract as the framework's EngineerCheck facts). */
function QuickVerify({ facts }: { facts: EngineerCheckFact[] }) {
  const done = facts.filter((f) => f.proven).length;
  return (
    <section className="rounded-2xl border border-pv-border p-3" aria-label="Quick verify">
      <p className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-pv-success">
        Quick verify · {done}/{facts.length}
      </p>
      <ul className="space-y-1.5">
        {facts.map((f) => (
          <li key={f.id} className="flex items-start gap-2 text-[14px]">
            <span aria-hidden className={clsx("mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px]", f.proven ? "border-pv-success bg-pv-success/20 text-pv-success" : "border-pv-border text-transparent")}>
              ✓
            </span>
            <span className="min-w-0">
              <span className="sr-only">{f.proven ? "Done: " : "To do: "}</span>
              <span className={f.proven ? "text-pv-text" : "text-pv-text-muted"}>{f.proven ? f.provenText : f.text}</span>
              {f.action && !f.proven && (
                <button type="button" onClick={f.action.onClick} className="ml-2 rounded-full border border-pv-cyan/50 px-2.5 py-0.5 text-[12.5px] font-semibold text-pv-cyan-soft hover:bg-pv-cyan/10">
                  {f.action.label}
                </button>
              )}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Prefix stepper + "Try /N" (sizing). */
function SizeControl({ seg, x, label = "Try" }: { seg: SlSeg; x: SlBoardCtx; label?: string }) {
  const r = slRow(x.lab, seg);
  if (!r) return null;
  const draft = x.drafts[seg]?.prefix ?? r.prefix ?? 24;
  const set = (p: number) => x.setDraft(seg, { prefix: Math.min(SL_PREFIX_MAX, Math.max(SL_PREFIX_MIN, p)) });
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="min-w-[4.5rem] text-[14px] font-semibold" style={{ color: SEG_COLOR[seg] }}>
        {segName(seg)}
      </span>
      <button type="button" aria-label={`${seg} decrease prefix`} disabled={draft <= SL_PREFIX_MIN} onClick={() => set(draft - 1)} className="h-11 w-11 rounded-xl border border-pv-border text-[18px] font-bold text-pv-text disabled:opacity-30">
        −
      </button>
      <span className="min-w-[3.5rem] text-center pv-mono text-[20px] font-bold text-pv-text" aria-live="polite">
        /{draft}
      </span>
      <button type="button" aria-label={`${seg} increase prefix`} disabled={draft >= SL_PREFIX_MAX} onClick={() => set(draft + 1)} className="h-11 w-11 rounded-xl border border-pv-border text-[18px] font-bold text-pv-text disabled:opacity-30">
        +
      </button>
      <Btn onClick={() => x.act({ type: "size", seg, prefix: draft })}>
        {label} /{draft}
      </Btn>
      <span className="text-[12.5px] text-pv-text-faint">
        {blockSize(draft)} addresses · {slUsable(draft)} usable
      </span>
    </div>
  );
}

/** Free-text network + ± one block + Place, with a plain-language live preview. Never auto-fixes the start. */
function PlaceControl({ seg, x }: { seg: SlSeg; x: SlBoardCtx }) {
  const r = slRow(x.lab, seg);
  if (!r) return null;
  const prefix = r.prefix;
  const text = x.drafts[seg]?.network ?? r.network ?? "";
  const ip = parseIPv4(text);
  const blk = prefix !== undefined ? blockSize(prefix) : undefined;
  const check = validateRow(x.lab.rows, seg);
  const step = (dir: 1 | -1) => {
    if (prefix === undefined) return;
    x.setDraft(seg, { network: stepNetwork(ip ?? PARENT.network, prefix, dir) });
    x.select(seg);
  };
  const preview = ip && prefix !== undefined ? { real: realBlock(ip, prefix), aligned: isAligned(ip, prefix) } : undefined;
  return (
    <div className={clsx("rounded-2xl border-2 p-3", x.selected === seg ? "border-pv-cyan/50" : "border-pv-border")} style={{ borderLeftColor: SEG_COLOR[seg], borderLeftWidth: 5 }}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[15px] font-semibold text-pv-text">
          {segName(seg)} <span className="pv-mono text-pv-text-muted">/{prefix ?? "?"}</span> <span className="text-[13px] font-normal text-pv-text-faint">· {blk ?? "?"} addresses · needs {r.hosts}</span>
        </p>
        {check && <span className={clsx("text-[13px] font-semibold", check.valid ? "text-pv-success" : "text-pv-danger")}>{check.valid ? `✓ placed at ${dotOct(check.real)}/${check.prefix}` : "⚠ needs attention"}</span>}
      </div>
      <label className="mt-2 block text-[12px] font-semibold text-pv-text-faint" htmlFor={`sl-net-${seg}`}>
        Network start
      </label>
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        <button type="button" disabled={prefix === undefined} onClick={() => step(-1)} aria-label={`${seg} minus one block`} className="h-11 rounded-xl border border-pv-border px-3 pv-mono text-[13px] font-semibold text-pv-text-muted disabled:opacity-30">
          −{blk ?? ""}
        </button>
        <input
          id={`sl-net-${seg}`}
          value={text}
          onChange={(e) => {
            x.setDraft(seg, { network: e.target.value });
            x.select(seg);
          }}
          onFocus={() => x.select(seg)}
          inputMode="decimal"
          spellCheck={false}
          placeholder="10.44.0.x"
          aria-label={`${seg} network address`}
          className="h-11 min-w-0 flex-1 basis-32 rounded-xl border border-pv-border bg-pv-bg px-3 pv-mono text-[16px] text-pv-text"
        />
        <button type="button" disabled={prefix === undefined} onClick={() => step(1)} aria-label={`${seg} plus one block`} className="h-11 rounded-xl border border-pv-border px-3 pv-mono text-[13px] font-semibold text-pv-text-muted disabled:opacity-30">
          +{blk ?? ""}
        </button>
        <Btn disabled={!ip || prefix === undefined} onClick={() => x.act({ type: "place", seg, network: ip! })}>
          Place {segName(seg)}
        </Btn>
        {r.network && (
          <Btn tone="quiet" onClick={() => x.act({ type: "clear", seg })}>
            Remove
          </Btn>
        )}
      </div>
      {text && !ip && <p className="mt-1.5 text-[13px] text-pv-warning">That isn&apos;t an IPv4 address yet — nothing is placed.</p>}
      {preview && prefix !== undefined && r.network !== ip && (
        <p className={clsx("mt-1.5 text-[13px]", preview.aligned ? "text-pv-text-muted" : "text-pv-warning")}>
          Preview (dashed on the board): {preview.aligned ? `${dotOct(ip!)}/${prefix} is a valid start → block ${rangeLabel(rangeOf(preview.real, prefix))}.` : `a /${prefix} starts every ${blk} addresses (${startsText(prefix)}), so ${dotOct(ip!)} would land in the ${rangeLabel(rangeOf(preview.real, prefix))} block.`}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------------------------------------------
function Layout({ visual, visualTitle, children, coach, details }: { visual: ReactNode; visualTitle: string; children: ReactNode; coach: ReactNode; details?: ReactNode }) {
  return (
    <div className="mx-auto max-w-4xl space-y-3">
      <Card tone="concept" title={visualTitle} id="sl-visual">
        {visual}
      </Card>
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div className="min-w-0 space-y-3">{children}</div>
        <div className="min-w-0">{coach}</div>
      </div>
      {details}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Incident evidence (kept) — every item points at the visual, not at raw state
// ---------------------------------------------------------------------------------------------------------------
const incidentStart = (lab: SlState) => lab.records.find((r) => r.kind === "stage" && r.stage === 8)?.seq ?? lab.seq;
export function slIncidentEvidence(x: SlBoardCtx): EngineerCheckFact[] {
  const { lab } = x;
  const since = (k: string) => x.seenSince(incidentStart(lab), k);
  const b = validateRow(lab.rows, "LAN-B");
  const c = validateRow(lab.rows, "LAN-C");
  const o = b ? lastOctet(b.written) : 0;
  const bits = octetBits(b?.written ?? PARENT.network, 26);
  const mask = lab.incident.maskApplied;
  return [
    { id: "e-row-b", text: "Read LAN-B's documented range", provenText: b ? `Written ${dotOct(b.written)}/${b.prefix} → claimed ${rangeLabel(b.writtenRange)}.` : "Read.", proven: since("row:LAN-B"), action: { label: "tap LAN-B on the spreadsheet", onClick: () => x.inspect("row:LAN-B", "visual", "sl-visual") } },
    { id: "e-block", text: "Where can a /26 start?", provenText: "/26 = 64 addresses → starts .0 · .64 · .128 · .192.", proven: since("block:26"), action: { label: "show the /26 blocks", onClick: () => x.inspect("block:26", "visual", "sl-incident-tools") } },
    { id: "e-mod", text: "Is .160 a /26 start? — ask “Are the starts valid?”", provenText: `${o} mod 64 = ${o % 64} → not a start.`, proven: lab.incident.rulesRun.includes("alignment") && since("rules") },
    { id: "e-bin", text: "Look at .160 in bits", provenText: `${bits.net}|${bits.host} — host bits are not all 0.`, proven: since("bin:incident"), action: { label: "show the bits", onClick: () => x.inspect("bin:incident", "visual", "sl-incident-tools") } },
    { id: "e-real", text: "Calculate the real /26 block (the test)", provenText: b ? `${dotOct(b.real)}/${b.prefix} → ${rangeLabel(b.realRange)}.` : "Calculated.", proven: mask && since("real:LAN-B") },
    { id: "e-row-c", text: "Read LAN-C's range", provenText: c ? `${dotOct(c.written)}/${c.prefix} → ${rangeLabel(c.writtenRange)}.` : "Read.", proven: since("row:LAN-C"), action: { label: "tap LAN-C on the spreadsheet", onClick: () => x.inspect("row:LAN-C", "visual", "sl-visual") } },
    { id: "e-matrix", text: "Compare the real blocks — ask “Any shared addresses?” after the test", provenText: "LAN-B's real block covers all of LAN-C: shared .128–.159.", proven: mask && lab.incident.rulesRun.includes("overlap") && since("matrix"), action: mask && lab.incident.rulesRun.includes("overlap") ? { label: "compare them", onClick: () => x.inspect("matrix", "visual", "sl-visual") } : undefined },
  ];
}
const HYPOTHESES = opts(["capacity", "LAN-B's /26 is too small for 50 addresses"], ["outside", "LAN-B lies outside the parent /24"], ["mask", "LAN-B should use a different mask"], ["diff-masks", "LAN-B and LAN-C overlap because their masks differ"], ["boundary", "LAN-B's written start is not a valid /26 boundary"]);
const HYP_FEEDBACK: Record<string, string> = {
  capacity: "A /26 holds 62 usable addresses — more than LAN-B's 50. Ask “Are they big enough?” to confirm.",
  outside: "Every block, written or real, is inside 10.44.0.0/24 — “Inside the /24?” confirms it.",
  mask: "/26 is exactly the smallest prefix that fits 50. The size is right; the start address is the problem.",
  "diff-masks": "Different masks don't cause overlap by themselves — .128/26 and .192/27 have different masks and only touch. Ask what made LAN-B's block start where it does.",
};
const CONSEQUENCE = opts(["inside-c", "LAN-B's real block (.128–.191) covers all of LAN-C (.128–.159)"], ["outside", "LAN-B spills past .255"], ["smaller", "LAN-B shrinks to 32 addresses"], ["none", "Nothing: hosts use the written range"]);
const CONS_FEEDBACK: Record<string, string> = {
  outside: "The written range ends at .223 and the real block at .191 — nothing passes .255.",
  smaller: "The prefix sets the size: a /26 is always 64 addresses. Only its position changed.",
  none: "Hosts never read the spreadsheet. They compute address AND mask — and that gives .128/26.",
};
export function slIncidentDiagnosed(x: SlBoardCtx) {
  return slIncidentEvidence(x).every((f) => f.proven) && same(x.answer("hyp"), ["boundary"]) && same(x.answer("cons"), ["inside-c"]);
}

// ---------------------------------------------------------------------------------------------------------------
// The board
// ---------------------------------------------------------------------------------------------------------------
export interface SlBoardProps extends SlBoardCtx {
  gate?: string;
  details: ReactNode;
}

export function SubnettingLabBoard(x: SlBoardProps) {
  const { lab } = x;
  const st = lab.stage;
  const answered = (id: string) => x.answer(id).length > 0 || slIsRevealed(id, lab);
  // A ghost shows only while the typed start differs from what is already placed.
  const draftIp = x.selected ? parseIPv4(x.drafts[x.selected]?.network ?? "") : undefined;
  const ghostSeg = x.selected && draftIp && slRow(lab, x.selected)?.prefix !== undefined && slRow(lab, x.selected)?.network !== draftIp ? x.selected : undefined;
  const ghost: BoardGhost | undefined = ghostSeg ? { seg: ghostSeg, network: parseIPv4(x.drafts[ghostSeg]!.network)!, prefix: slRow(lab, ghostSeg)!.prefix! } : undefined;
  const board = (title?: string) => <AddressBoard rows={lab.rows} ghost={ghost} selected={x.selected} onSelect={x.select} zoomStart={x.windowStart} title={title} zoomed={x.zoomed} onZoom={(z) => { x.setZoomed(z); if (z) x.inspect("zoom"); }} />;
  const placeResult = () => {
    const ev = lab.last;
    if (!ev || (ev.kind !== "place" && ev.kind !== "clear") || !ev.seg) return null;
    const c = validateRow(lab.rows, ev.seg);
    if (!c) return <Result tone="warn" title={`${segName(ev.seg)} removed from the plan`} />;
    if (c.valid) {
      const h = holes(lab.rows);
      return (
        <Result tone={c.oversized ? "warn" : "ok"} title={`✓ ${segName(c.id)} fits at ${dotOct(c.real)}/${c.prefix} (${rangeLabel(c.realRange)})`} why={`${lastOctet(c.real)} is a multiple of ${blockSize(c.prefix)}, the block is inside the /24 and shares no address.`} remember={h.length ? `Valid — note the gap ${h.map((r) => rangeLabel(r)).join(", ")} below your highest block. Another order works; it just leaves gaps to track.` : "Placed largest-first, the next free address is already a valid start for anything smaller."}>
          {c.oversized && <PlainList items={plainViolations(c, lab.rows)} />}
          <WhyDetails x={x} />
        </Result>
      );
    }
    return (
      <Result tone="bad" title={`${segName(c.id)} at ${c.written}/${c.prefix} doesn't work yet`}>
        <PlainList items={plainViolations(c, lab.rows)} />
        <WhyDetails x={x} />
      </Result>
    );
  };

  // ------------------------------------------------------------------ free play
  if (lab.freePlay) {
    const rep = lab.report && lab.reportSeq === lab.seq ? lab.report : undefined;
    return (
      <Layout visualTitle="Your address space" visual={board()} coach={<Coach title="Same rules, your design" lines={["Aligned to its own size", "Big enough", "Inside the /24", "Shares no address"]} remember="Valid is a property of the whole plan." />} details={x.details}>
        {placeResult()}
        {rep && <DesignVerdict lab={lab} />}
        <Card tone="task" title="Change anything">
          <div className="space-y-2">
            {lab.rows.map((r) => (
              <HostsAndSize key={r.id} seg={r.id} x={x} />
            ))}
          </div>
        </Card>
        {lab.rows.map((r) => (
          <PlaceControl key={r.id} seg={r.id} x={x} />
        ))}
        <div className="flex flex-wrap gap-2">
          <Btn onClick={() => x.act({ type: "verify" })}>Check my design</Btn>
          {lab.rows.some((r) => r.id === "LAN-D") ? (
            <Btn tone="quiet" onClick={() => x.act({ type: "remove-lan-d" })}>
              Remove LAN-D
            </Btn>
          ) : (
            <Btn tone="quiet" onClick={() => x.act({ type: "add-lan-d" })}>
              Add LAN-D (14)
            </Btn>
          )}
        </div>
      </Layout>
    );
  }

  // ------------------------------------------------------------------ T0
  if (st === 0) {
    const scale = lab.requirementsRead;
    return (
      <Layout
        visualTitle="The requirements"
        visual={
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {SEGMENTS.map((s) => (
                <div key={s.id} className={clsx("rounded-2xl border-2 p-3 text-center", scale && x.seen("scale") && s.id === LARGEST.id && "ring-2 ring-pv-cyan")} style={{ borderColor: SEG_COLOR[s.id], background: `${SEG_COLOR[s.id]}1f` }}>
                  <p className="text-[15px] font-bold text-pv-text">{segName(s.id)}</p>
                  <p className="pv-mono text-[28px] font-bold leading-none" style={{ color: SEG_COLOR[s.id] }}>
                    {s.hosts}
                  </p>
                  <p className="mt-1 text-[12px] text-pv-text-muted">{s.id === "TRANSIT" ? "addresses: R1 + R2" : "addresses, incl. R1"}</p>
                </div>
              ))}
            </div>
            {scale && (
              <div className="space-y-1.5">
                <p className="text-[13px] text-pv-text-muted">Drawn to scale against the 256-address /24:</p>
                {SEGMENTS.map((s) => (
                  <div key={s.id} className="flex items-center gap-2">
                    <span className="w-16 text-[13px] font-semibold" style={{ color: SEG_COLOR[s.id] }}>
                      {segName(s.id)}
                    </span>
                    <div className="relative h-5 flex-1 rounded-md border border-pv-border bg-pv-bg-elevated/60">
                      <div className="h-full rounded-md" style={{ width: `${Math.max(1, (s.hosts / 256) * 100)}%`, background: SEG_COLOR[s.id] }} />
                    </div>
                    <span className="w-10 text-right pv-mono text-[12px] text-pv-text-muted">{s.hosts}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        }
        coach={<Coach title="/24 = 256 addresses" lines={["Four networks share it", "Counts already include R1", "Transit 2 = R1 + R2 exactly"]} remember="Start from the requirements, not a memorised table." />}
        details={x.details}
      >
        <Predict id="t0" x={x} />
        {answered("t0") && !lab.requirementsRead && (
          <Card tone="task" title="Try it">
            <Btn onClick={() => x.act({ type: "read" })}>Look at the requirements to scale</Btn>
          </Card>
        )}
        {lab.requirementsRead && (
          <>
            <Result tone="ok" title={`${LARGEST.id} is the big one`} why={`${LARGEST.hosts} addresses need a /${slMinPrefix(LARGEST.hosts)} — half of the /24. Everything else must fit around it.`} remember="Each count already includes R1's interface — don't add one again." />
            <QuickVerify facts={[{ id: "scale", text: `Find ${LARGEST.id} on the scale bars`, provenText: `${LARGEST.hosts} of 256 — the longest bar.`, proven: x.seen("scale"), action: { label: "highlight it", onClick: () => x.inspect("scale", "visual", "sl-visual") } }]} />
          </>
        )}
      </Layout>
    );
  }

  // ------------------------------------------------------------------ T1
  if (st === 1) {
    const r = slRow(lab, "LAN-C")!;
    const tried = lab.records.some((rec) => rec.kind === "size" && rec.seg === "LAN-C" && rec.stage === 1);
    const fit = r.prefix !== undefined ? fitStatus(r.hosts, r.prefix) : undefined;
    return (
      <Layout
        visualTitle={tried ? "Container vs need" : "A subnet is a container"}
        visual={
          tried && r.prefix !== undefined ? (
            <CapacityBars hosts={r.hosts} prefixes={x.seen("ladder:LAN-C") ? [C_MIN + 1, C_MIN, C_MIN - 1] : [r.prefix]} highlight={r.prefix} />
          ) : (
            <div className="space-y-3">
              <p className="text-[15px] text-pv-text">
                <b style={{ color: SEG_COLOR["LAN-C"] }}>LAN-C</b> needs <b className="pv-mono text-[20px]">{r.hosts}</b> addresses.
              </p>
              <p className="text-[13px] font-semibold text-pv-text-faint">Example — a small container:</p>
              <ExampleContainer prefix={29} />
              <p className="text-[13px] text-pv-text-muted">Each step up the prefix ladder doubles the container: 8 → 16 → 32 → 64 …</p>
            </div>
          )
        }
        coach={<Coach title="Containers double" lines={["Size = 2^host bits", "Usable = size − 2 (ordinary LAN)", "Prefix = 32 − host bits"]} remember="Pick the smallest container that still fits." />}
        details={x.details}
      >
        <Predict id="t1" x={x} />
        {answered("t1") && (
          <Card tone="task" title="Try it — size LAN-C">
            <SizeControl seg="LAN-C" x={x} />
          </Card>
        )}
        {tried && fit && r.prefix !== undefined && (
          <>
            <Result
              tone={fit === "FITS" ? "ok" : fit === "OVERSIZED" ? "warn" : "bad"}
              title={fit === "FITS" ? `✓ /${r.prefix} holds LAN-C` : fit === "OVERSIZED" ? `/${r.prefix} fits — but it's bigger than needed` : `✕ /${r.prefix} is too small`}
              why={fit === "TOO_SMALL" ? `${slUsable(r.prefix)} usable < ${r.hosts} needed.` : fit === "OVERSIZED" ? `${slUsable(r.prefix)} usable is plenty, but /${C_MIN} already holds ${r.hosts}.` : `Need ${r.hosts} → at least ${slUsable(r.prefix)} usable → ${32 - r.prefix} host bits → /${r.prefix}. One step smaller (/${r.prefix + 1}) gives only ${slUsable(Math.min(r.prefix + 1, SL_PREFIX_MAX))}.`}
              remember="A prefix is justified only when the next smaller container would not fit."
            >
              <WhyDetails x={x} />
            </Result>
            <QuickVerify facts={[{ id: "ladder", text: `Compare /${C_MIN + 1}, /${C_MIN} and /${C_MIN - 1} side by side`, provenText: `${LADDER(4)} < ${r.hosts} ≤ ${LADDER(5)} — /${C_MIN} is the smallest fit.`, proven: x.seen("ladder:LAN-C") && minimal(lab, "LAN-C"), action: { label: "compare", onClick: () => x.inspect("ladder:LAN-C", "visual", "sl-visual") } }]} />
          </>
        )}
      </Layout>
    );
  }

  // ------------------------------------------------------------------ T2
  if (st === 2) {
    const tests = lab.boundaryTests;
    const last = tests[tests.length - 1];
    const lastBad = [...tests].reverse().find((t) => !t.aligned);
    return (
      <Layout
        visualTitle={answered("t2") ? `/${SL_BOUNDARY_PREFIX} = blocks of 32` : "Example: a /26 owns 64 addresses"}
        visual={answered("t2") ? <BlockGrid prefix={SL_BOUNDARY_PREFIX} tests={tests} starts height={84} /> : <BlockGrid prefix={26} sub={() => "64 addresses"} height={84} />}
        coach={
          answered("t2") ? (
            <Coach title={`/${SL_BOUNDARY_PREFIX}`} lines={["32 addresses · 30 usable", `Valid starts every 32: ${startsText(SL_BOUNDARY_PREFIX)}`]} remember="A network starts where all host bits are 0." />
          ) : (
            <Coach title="Blocks start on their own size" lines={["A /26 block = 64 addresses", "So /26 starts are .0 .64 .128 .192"]} remember="Now apply the same idea to a /27." />
          )
        }
        details={x.details}
      >
        <Predict id="t2" x={x} />
        {answered("t2") && (
          <Card tone="task" title="Try two starting addresses">
            <Checklist items={[{ label: "Find one valid start", done: tests.some((t) => t.aligned) }, { label: "Find one invalid start", done: tests.some((t) => !t.aligned) }]} />
            <div className="mt-2 flex flex-wrap gap-2">
              {SL_BOUNDARY_CANDIDATES.map((c) => (
                <Btn key={c} tone="quiet" onClick={() => x.act({ type: "boundary", address: c, prefix: SL_BOUNDARY_PREFIX })}>
                  Test {dotOct(c)}/{SL_BOUNDARY_PREFIX}
                </Btn>
              ))}
            </div>
          </Card>
        )}
        {last && (
          <>
            <Result tone={last.aligned ? "ok" : "bad"} title={last.aligned ? `✓ ${dotOct(last.address)} is a valid /27 start` : `✕ ${dotOct(last.address)} is not a /27 start`} why={last.aligned ? `/27 = blocks of 32 · ${lastOctet(last.address)} ÷ 32 = ${lastOctet(last.address) / 32} exactly.` : `${lastOctet(last.address)} ÷ 32 = ${(lastOctet(last.address) / 32).toFixed(2)} — it sits inside the ${rangeLabel(rangeOf(last.real, last.prefix))} block.`} remember="A network starts where all host bits are zero.">
              <WhyDetails x={x} />
            </Result>
            {lastBad && <QuickVerify facts={[{ id: "bits", text: `See ${dotOct(lastBad.address)} in bits`, provenText: `host bits ${octetBits(lastBad.address, lastBad.prefix).host} aren't all 0.`, proven: x.seen("bin:boundary"), action: { label: "show the bits", onClick: () => x.inspect("bin:boundary", "visual", "sl-bits") } }]} />}
            {lastBad && x.seen("bin:boundary") && (
              <Card title="In bits" id="sl-bits">
                <BitsSnap ip={lastBad.address} prefix={lastBad.prefix} />
              </Card>
            )}
          </>
        )}
      </Layout>
    );
  }

  // ------------------------------------------------------------------ T3
  if (st === 3) {
    const c = lab.calc;
    return (
      <Layout
        visualTitle={c ? `${c.network}/${c.prefix} — address by address` : "Example: a tiny /30, address by address"}
        visual={
          c ? (
            <div className="grid items-start gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <SubnetCard c={c} />
              <AddressTiles network={c.network} prefix={c.prefix} entered={c.address} />
            </div>
          ) : (
            <div className="space-y-2">
              <AddressTiles network="10.44.0.224" prefix={30} />
              <p className="text-[13px] text-pv-text-muted">
                Every block has the same shape: the first address names the network, the last is the broadcast, the ones in between are usable. Now: which block does <b className="pv-mono text-pv-text">{SL_CALC.address}/{SL_CALC.prefix}</b> belong to?
              </p>
            </div>
          )
        }
        coach={<Coach title="Shape of every block" lines={["Network = all host bits 0", "Broadcast = all host bits 1", "Usable = everything between"]} remember="The broadcast is not always .255." />}
        details={x.details}
      >
        <Predict id="t3" x={x} />
        {answered("t3") && !c && (
          <Card tone="task" title="Try it">
            <Btn onClick={() => x.act({ type: "calc", address: SL_CALC.address, prefix: SL_CALC.prefix })}>
              Find the subnet of {SL_CALC.address}/{SL_CALC.prefix}
            </Btn>
          </Card>
        )}
        {c && (
          <>
            <Result tone="ok" title={`✓ ${dotOct(c.address)} belongs to ${dotOct(c.network)}/${c.prefix}`} why={`Clear the host bits → network ${dotOct(c.network)}. Set them all → broadcast ${dotOct(c.broadcast)}. The ${c.usable} addresses between are usable; ${dotOct(c.next)} starts the next block.`} remember="Broadcast = all host bits 1 — not always .255.">
              <WhyDetails x={x} />
            </Result>
            <QuickVerify facts={[{ id: "bits", text: "Check it in bits", provenText: ".200 = 110|01000 → network 110|00000 (.192) · broadcast 110|11111 (.223).", proven: x.seen("bin:calc"), action: { label: "show the bits", onClick: () => x.inspect("bin:calc", "visual", "sl-bits") } }]} />
            {x.seen("bin:calc") && (
              <Card title="In bits" id="sl-bits">
                <BitsSnap ip={c.address} prefix={c.prefix} />
              </Card>
            )}
          </>
        )}
      </Layout>
    );
  }

  // ------------------------------------------------------------------ T4
  if (st === 4) {
    const f = lab.flsm ? equalSplit(lab.flsm) : undefined;
    const both = lab.flsmTried.includes(25) && lab.flsmTried.includes(26);
    return (
      <Layout visualTitle={f ? `Cut into /${f.prefix}: ${f.count} equal blocks` : "The whole /24, before cutting"} visual={<FlsmSplit prefix={lab.flsm} />} coach={<Coach title="Borrowing bits" lines={["1 bit → 2 equal blocks", "2 bits → 4 blocks", "3 bits → 8 blocks"]} remember="Every block gets the same size — even when the networks don't." />} details={x.details}>
        <Predict id="t4" x={x} />
        {answered("t4") && (
          <Card tone="task" title="Try it — cut the /24">
            <Checklist items={[{ label: "Try /25", done: lab.flsmTried.includes(25) }, { label: "Try /26", done: lab.flsmTried.includes(26) }]} />
            <div className="mt-2 flex flex-wrap gap-2">
              {SL_FLSM_PREFIXES.map((p) => (
                <Btn key={p} tone={lab.flsm === p ? "primary" : "quiet"} onClick={() => x.act({ type: "flsm", prefix: p })}>
                  Cut into /{p}
                </Btn>
              ))}
            </div>
          </Card>
        )}
        {f && !both && (
          <Result tone="bad" title={!f.enoughSubnets ? `✕ Only ${f.count} blocks for 4 networks` : `✕ ${f.fits.filter((r) => !r.fits).map((r) => segName(r.id)).join(", ")} doesn't fit a /${f.prefix}`} why={!f.enoughSubnets ? `A /${f.prefix} cut makes ${f.count} blocks of ${f.usable} usable — not enough blocks.` : `Every /${f.prefix} block gives ${f.usable} usable; LAN-A needs 100.`}>
            <WhyDetails x={x} />
          </Result>
        )}
        {both && (
          <Result tone="warn" title="Same-size blocks can't satisfy these unequal requirements" why="Big enough for LAN-A means only two blocks; enough blocks means each is too small for LAN-A." remember="That is exactly why VLSM exists — next stage.">
            <WhyDetails x={x} />
          </Result>
        )}
      </Layout>
    );
  }

  // ------------------------------------------------------------------ T5
  if (st === 5) {
    const last = lab.last?.kind === "size" && lab.last.seg ? slRow(lab, lab.last.seg) : undefined;
    const all = SEGMENTS.every((s) => minimal(lab, s.id));
    return (
      <Layout visualTitle="Four differently sized pieces" visual={<RequirementPieces rows={lab.rows} />} coach={<Coach title="Each network, its own size" lines={["Smallest container that fits", "Pieces are powers of two", "Add up the pieces, not the needs"]} remember="LAN-C is already sized from T1." />} details={x.details}>
        <Predict id="t5" x={x} />
        {answered("t5") && (
          <Card tone="task" title="Try it — size each piece">
            <div className="space-y-2">
              {(["LAN-A", "LAN-B", "TRANSIT"] as SlSeg[]).map((s) => (
                <SizeControl key={s} seg={s} x={x} label="Set" />
              ))}
            </div>
          </Card>
        )}
        {all ? (
          <Result tone="ok" title={`✓ Every network has its smallest block — ${MIN_TOTAL} of 256`} why="LAN-A /25 · LAN-B /26 · LAN-C /27 · Transit /30. The pieces fit inside the /24 with 28 addresses to spare." remember="Next: place the pieces.">
            <WhyDetails x={x} />
          </Result>
        ) : (
          last?.prefix !== undefined && (
            <Result tone={fitStatus(last.hosts, last.prefix) === "FITS" ? "ok" : fitStatus(last.hosts, last.prefix) === "OVERSIZED" ? "warn" : "bad"} title={`${segName(last.id)} /${last.prefix}: ${fitStatus(last.hosts, last.prefix) === "FITS" ? "✓ smallest fit" : fitStatus(last.hosts, last.prefix) === "OVERSIZED" ? "fits, bigger than needed" : "✕ too small"}`} why={`${slUsable(last.prefix)} usable for ${last.hosts} needed.`}>
              <WhyDetails x={x} />
            </Result>
          )
        )}
      </Layout>
    );
  }

  // ------------------------------------------------------------------ T6
  if (st === 6) {
    const sel = x.selected ? slRow(lab, x.selected) : undefined;
    return (
      <Layout visualTitle="Your address plan" visual={board()} coach={<Coach title="Placing a block" lines={sel?.prefix !== undefined ? [`${segName(sel.id)} is a /${sel.prefix}`, `starts: ${startsText(sel.prefix)}`] : ["Pick a block below", "It may start only on a multiple of its size"]} remember="Largest first: the next free address is already a valid start." />} details={x.details}>
        {placeResult()}
        <Predict id="t6" x={x} />
        {answered("t6") && SEGMENTS.map((s) => <PlaceControl key={s.id} seg={s.id} x={x} />)}
        {planReport(lab.rows).allValid && (
          <QuickVerify
            facts={[
              {
                id: "zoom",
                text: "Zoom in on the smallest block to check it",
                provenText: "The /30 sits on its own 4-address boundary, sharing nothing.",
                proven: x.seen("zoom"),
                action: {
                  label: "zoom in",
                  onClick: () => {
                    x.select("TRANSIT");
                    x.inspect("zoom", "visual", "sl-visual");
                  },
                },
              },
            ]}
          />
        )}
      </Layout>
    );
  }

  // ------------------------------------------------------------------ T7
  if (st === 7) {
    const hasD = lab.rows.some((r) => r.id === "LAN-D");
    const checked = lab.records.some((r) => r.kind === "verify" && r.stage === 7);
    const showFree = x.answer("t7").length > 0 && x.seen("free");
    const space = freeSpace(lab.rows);
    return (
      <Layout
        visualTitle="Your subnet plan"
        visual={
          <div className="space-y-3">
            {board()}
            {checked && <DesignVerdict lab={lab} />}
            {checked && (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[300px] text-left text-[14px]">
                  <thead className="text-[11px] uppercase tracking-wide text-pv-text-faint">
                    <tr>
                      <th className="py-1 font-semibold">Network</th>
                      <th className="py-1 font-semibold">Block</th>
                      <th className="py-1 font-semibold">Need / usable</th>
                    </tr>
                  </thead>
                  <tbody>
                    {planRows(lab.rows).map((p) => (
                      <tr key={p.id} className="border-t border-pv-border/60">
                        <td className="py-1 font-semibold" style={{ color: SEG_COLOR[p.id] }}>
                          {segName(p.id)}
                        </td>
                        <td className="py-1 pv-mono">{p.network}</td>
                        <td className="py-1 pv-mono">
                          {p.need} / {p.usable}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {showFree && (
              <p className="text-[14px] text-pv-text-muted">
                Free: {space.ranges.map((f) => `${rangeLabel(f)} (${f.last - f.first + 1}) = ${f.blocks.map((b) => `${dotOct(b.network)}/${b.prefix}`).join(" + ")}`).join("; ") || "none"} — a range, not one subnet.
              </p>
            )}
          </div>
        }
        coach={<Coach title="Valid as a whole" lines={["Every block aligned", "Every block big enough", "All inside the /24", "No shared addresses"]} remember="Free space is a range; a new block still needs an aligned start." />}
        details={x.details}
      >
        <Predict id="t7" x={x} />
        {answered("t7") && (
          <Card tone="task" title="Try it">
            <div className="flex flex-wrap gap-2">
              <Btn onClick={() => x.act({ type: "verify" })}>Check my design</Btn>
              {checked && !hasD && lab.report?.allValid && (
                <Btn tone="quiet" onClick={() => x.act({ type: "add-lan-d" })}>
                  Add LAN-D ({SL_LAN_D.hosts} addresses)
                </Btn>
              )}
            </div>
          </Card>
        )}
        {hasD && (
          <>
            <Card tone="task" title="Size LAN-D">
              <SizeControl seg="LAN-D" x={x} label="Set" />
            </Card>
            <PlaceControl seg="LAN-D" x={x} />
          </>
        )}
        {placeResult()}
        {checked && <QuickVerify facts={[{ id: "free", text: "Read the free space", provenText: `${space.ranges.map((f) => rangeLabel(f)).join(", ") || "none"} — shown under the board.`, proven: x.seen("free"), action: { label: "show it", onClick: () => x.inspect("free", "visual", "sl-visual") } }]} />}
      </Layout>
    );
  }

  // ------------------------------------------------------------------ T8
  return <Incident x={x} />;
}

function HostsAndSize({ seg, x }: { seg: SlSeg; x: SlBoardCtx }) {
  const r = slRow(x.lab, seg)!;
  const [hosts, setHosts] = useState(String(r.hosts));
  return (
    <div className="space-y-1.5 rounded-xl border border-pv-border p-2">
      <div className="flex flex-wrap items-center gap-2 text-[13px] text-pv-text-muted">
        <label className="flex items-center gap-1.5">
          <span style={{ color: SEG_COLOR[seg] }} className="font-semibold">
            {segName(seg)}
          </span>
          needs
          <input value={hosts} onChange={(e) => setHosts(e.target.value)} inputMode="numeric" aria-label={`${seg} required addresses`} className="h-10 w-20 rounded-lg border border-pv-border bg-pv-bg px-2 pv-mono text-[15px] text-pv-text" />
        </label>
        <Btn tone="quiet" onClick={() => x.act({ type: "set-hosts", seg, hosts: Number(hosts) })}>
          Set need
        </Btn>
      </div>
      <SizeControl seg={seg} x={x} label="Set" />
    </div>
  );
}

function DesignVerdict({ lab }: { lab: SlState }) {
  const r = lab.report;
  if (!r) return null;
  const fresh = lab.reportSeq === lab.seq;
  const items = [
    { ok: r.allPlaced, t: "Every network placed" },
    { ok: r.capacity, t: "All requirements fit" },
    { ok: r.aligned, t: "All boundaries valid" },
    { ok: r.inside, t: "Inside 10.44.0.0/24" },
    { ok: r.noOverlap, t: "No overlap" },
  ];
  return (
    <div className={clsx("rounded-xl border p-2.5", r.allValid ? "border-pv-success/40 bg-pv-success/[0.05]" : "border-pv-danger/40 bg-pv-danger/[0.05]")}>
      <p className={clsx("text-[15px] font-semibold", r.allValid ? "text-pv-success" : "text-pv-danger")}>{r.allValid ? "✓ Your design passes every rule" : "✕ Not a valid plan yet"}</p>
      <ul className="mt-1 grid gap-x-4 gap-y-0.5 text-[14px] sm:grid-cols-2">
        {items.map((i) => (
          <li key={i.t} className={i.ok ? "text-pv-success" : "text-pv-danger"}>
            {i.ok ? "✓" : "✕"} {i.t}
          </li>
        ))}
        <li className="text-pv-text-muted">
          {r.space.allocated} / {r.space.total} allocated · {r.space.free} free
        </li>
      </ul>
      {!fresh && <p className="mt-1 text-[12px] text-pv-text-faint">You changed the plan since this check — check again.</p>}
    </div>
  );
}

function Incident({ x }: { x: SlBoardProps }) {
  const { lab } = x;
  const ev = slIncidentEvidence(x);
  const gathered = ev.filter((f) => f.proven).length;
  const hyp = x.answer("hyp");
  const cons = x.answer("cons");
  const hypOk = same(hyp, ["boundary"]);
  const consOk = same(cons, ["inside-c"]);
  const diagnosed = slIncidentDiagnosed(x);
  const sym = incidentSymptom(lab.rows);
  const resolved = lab.incident.resolved;
  const from = incidentStart(lab);
  const b = slRow(lab, "LAN-B");
  const pick = (s: SlSeg) => {
    x.select(s);
    x.inspect(`row:${s}`);
  };
  const lb160: SlBoundaryTest[] = b?.network && b.prefix !== undefined ? [{ address: b.network, prefix: b.prefix, aligned: isAligned(b.network, b.prefix), real: realBlock(b.network, b.prefix) }] : [];
  const sel = x.selected ? slRow(lab, x.selected) : undefined;
  const selIp = x.selected ? parseIPv4(x.drafts[x.selected]?.network ?? "") : undefined;
  const ghost: BoardGhost | undefined = x.selected && selIp && sel?.prefix !== undefined && sel.network !== selIp ? { seg: x.selected, network: selIp, prefix: sel.prefix } : undefined;
  return (
    <Layout
      visualTitle={diagnosed ? (resolved ? "Your redesigned plan" : "Redesign the plan") : "Spreadsheet vs CIDR reality"}
      visual={diagnosed ? <AddressBoard rows={lab.rows} selected={x.selected} onSelect={x.select} zoomStart={x.windowStart} ghost={ghost} zoomed={x.zoomed} onZoom={x.setZoomed} /> : <ClaimsVsReality rows={lab.rows} real={lab.incident.maskApplied} onPick={pick} />}
      coach={<Coach title="Hosts do the maths" lines={["A host computes address AND mask", "It never reads the spreadsheet", "Root cause ≠ consequence"]} remember="Validate the design before deployment — devices won't always catch it." />}
      details={x.details}
    >
      {!resolved && (
        <Card tone="bad" title="Symptom">
          <p className="text-[15px] leading-snug text-pv-text">
            A LAN-B host at <b className="pv-mono">{sym?.host}</b> cannot reach the LAN-C host <b className="pv-mono">{sym?.server}</b>. Its traffic to LAN-A works.
          </p>
          {!diagnosed && <p className="mt-1 text-[13px] text-pv-text-muted">Start by reading the spreadsheet above — tap LAN-B and LAN-C. Change nothing yet.</p>}
        </Card>
      )}
      {!diagnosed && (
        <Card tone="task" title="Investigate">
          <div className="flex flex-wrap gap-2" aria-label="Rule checks">
            {(["alignment", "capacity", "containment", "overlap"] as SlRule[]).map((r) => {
              const run = lab.incident.rulesRun.includes(r);
              return (
                <Btn
                  key={r}
                  tone={run ? "quiet" : "primary"}
                  onClick={() => {
                    x.inspect("rules");
                    x.act({ type: "check", rule: r });
                  }}
                >
                  {run ? "✓ " : ""}
                  {r === "alignment" ? "Are the starts valid?" : r === "capacity" ? "Are they big enough?" : r === "containment" ? "Inside the /24?" : "Any shared addresses?"}
                </Btn>
              );
            })}
          </div>
          {lab.last && lab.last.kind === "check" && <p className="mt-2 rounded-lg bg-pv-bg/60 px-2.5 py-1.5 text-[13.5px] text-pv-text">{lab.last.text}</p>}
          <div id="sl-incident-tools" className="mt-3 space-y-3">
            {x.seenSince(from, "block:26") && (
              <div>
                <p className="mb-1 text-[13px] font-semibold text-pv-text">/26 blocks of the /24 — and where “{b?.network ? dotOct(b.network) : ""}” falls</p>
                <BlockGrid prefix={26} tests={lb160} starts height={64} />
              </div>
            )}
            {x.seenSince(from, "bin:incident") && b?.network && <BitsSnap ip={b.network} prefix={26} />}
          </div>
        </Card>
      )}
      {!diagnosed && <QuickVerify facts={ev} />}
      {!diagnosed && gathered >= 4 && (
        <Card tone="task" title="Hypothesis — what created the problem?">
          <PredictionBlock label=" " prompt="Pick the root cause" options={HYPOTHESES} value={hyp} onChange={(v) => !lab.incident.maskApplied && x.onAnswer("hyp", v)} verdict={hyp.length ? <Verdict correct={hypOk}>{hypOk ? "Consistent with the evidence. Now test it: calculate the real block." : HYP_FEEDBACK[hyp[0]]}</Verdict> : undefined} />
          {hypOk && !lab.incident.maskApplied && (
            <div className="mt-2">
              <Btn
                onClick={() => {
                  x.inspect("real:LAN-B", "visual", "sl-visual");
                  x.act({ type: "apply-mask" });
                }}
              >
                Calculate the real /26 block
              </Btn>
            </div>
          )}
        </Card>
      )}
      {lab.incident.maskApplied && !diagnosed && (
        <Result tone="bad" title={b?.network ? `“${dotOct(b.network)}/26” is really ${dotOct(realBlock(b.network, 26))}/26` : "Real block calculated"} why={b?.network ? `${lastOctet(b.network)} AND 192 = ${lastOctet(realBlock(b.network, 26))}. Hosts and routers use ${rangeLabel(rangeOf(realBlock(b.network, 26), 26))} — which covers LAN-C.` : undefined}>
          <div className="mt-2">
            <PredictionBlock label=" " prompt="What does the real block do to the plan?" options={CONSEQUENCE} value={cons} onChange={(v) => !diagnosed && x.onAnswer("cons", v)} verdict={cons.length ? <Verdict correct={consOk}>{consOk ? "Yes — the overlap is the CONSEQUENCE; the invalid boundary is the CAUSE." : CONS_FEEDBACK[cons[0]]}</Verdict> : undefined} />
          </div>
        </Result>
      )}
      {diagnosed && !resolved && (
        <>
          <Result tone="warn" title="Root cause: an invalid boundary" why="10.44.0.160 is not a multiple of 64, so “.160/26” is really .128/26 — covering LAN-C. Every row looked fine on its own; the plan failed as a whole." remember="Now redesign: move whatever you need. Any plan that passes every rule is accepted." />
          {lab.rows.map((r) => (
            <PlaceControl key={r.id} seg={r.id} x={x} />
          ))}
          <div className="flex flex-wrap gap-2">
            <Btn onClick={() => x.act({ type: "verify" })}>Check my redesign</Btn>
          </div>
          {lab.last?.kind === "verify" && !resolved && <DesignVerdict lab={lab} />}
          {(lab.last?.kind === "place" || lab.last?.kind === "clear") &&
            (() => {
              const c = lab.last?.seg ? validateRow(lab.rows, lab.last.seg) : undefined;
              return c && !c.valid ? <PlainList items={plainViolations(c, lab.rows)} /> : null;
            })()}
        </>
      )}
      {resolved && sym && (
        <Result
          tone="ok"
          title="✓ Redesigned and verified"
          why={
            <>
              Every block is aligned, big enough, inside the /24 and shares nothing. The symptom recalculated from the new plan: <span className="pv-mono">{sym.host}</span> → {sym.decision.srcNet}, <span className="pv-mono">{sym.server}</span> → {sym.decision.dstNet}: <b className="text-pv-success">REMOTE</b>, so it uses its gateway {sym.gateway}.
            </>
          }
          remember="Repair is proven only when the plan passes AND the failing behaviour is recalculated correct."
        />
      )}
    </Layout>
  );
}
