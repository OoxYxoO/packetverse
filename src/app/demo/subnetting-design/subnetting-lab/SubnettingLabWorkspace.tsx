"use client";

import { useState } from "react";
import { PracticeLabShell } from "@/components/practice-lab/PracticeLabShell";
import { LabEventLog } from "@/components/practice-lab/LabEventLog";
import { Button } from "@/components/ui/Button";
import { useLabRunner } from "@/lib/practice-lab/useLabRunner";
import { SL_CALC, SL_LAB_MODEL, SL_STAGES, parseIPv4, slRow, type SlAction, type SlRule, type SlSeg, type SlState } from "@/lib/sim-engine/scenarios/subnettingLab";
import { SubnetRuler, windowFor } from "./SubnetRuler";
import { SubnetPlanTable } from "./SubnetPlanTable";
import { SubnetVerifyPanel } from "./SubnetVerifyPanel";
import { StageHeader } from "./SubnetVisuals";
import { SL_PREDICTIONS, SubnettingLabBoard, slIsRevealed, slStageDone, slStageGate, slStageHeader, type SlDraft, type SlWhere } from "./SubnettingLabBoard";

/**
 * Subnet Design Studio — the subnetting composition of the generic Practice Lab framework, on the guided lesson's
 * own 10.44.0.0/24 requirements. Its runner and state are its own; nothing here receives the ScenarioEngine, the
 * guided snapshot or the progress store.
 *
 * Layout: a single Learning View column (no permanent side panel). The shell's pinned "topology" slot carries a
 * human stage header; the board shows one dominant visual per stage and reveals predict → try → result → why →
 * verify progressively. Engineer details (plan table, rules, overlap matrix, precise ruler, design log) sit in one
 * collapsible section at the bottom — useful, never required.
 *
 *   generic (framework):  PracticeLabShell (no animation toggle, no right column) · useLabRunner (every action
 *                         instant, hops = 0; Reset; no Replay — nothing moves) · LabEventLog · board primitives
 *   subnetting (here):    SL_LAB_MODEL truth · stage script and copy · visuals · engineer details · free play
 */

const LOOP = ["Concept", "Predict", "Try it", "Result", "Verify"];

export function SubnettingLabWorkspace({ open, onClose }: { open: boolean; onClose: () => void }) {
  const runner = useLabRunner(SL_LAB_MODEL);
  const lab = runner.state;
  const [before, setBefore] = useState<SlState | undefined>(undefined);
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [seenKeys, setSeenKeys] = useState<Set<string>>(() => new Set());
  const [drafts, setDrafts] = useState<Partial<Record<SlSeg, SlDraft>>>({});
  const [selected, setSelected] = useState<SlSeg | undefined>(undefined);
  const [windowStart, setWindowStart] = useState(0);
  const [zoomed, setZoomed] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);

  /** Inspections count only after the latest event. */
  const seen = (key: string) => seenKeys.has(`${lab.seq}|${key}`);
  const seenSince = (fromSeq: number, key: string) => [...seenKeys].some((k) => k.endsWith(`|${key}`) && Number(k.slice(0, k.indexOf("|"))) >= fromSeq);
  function markSeen(key: string) {
    const k = `${lab.seq}|${key}`;
    if (!seenKeys.has(k)) setSeenKeys((s) => new Set([...s, k]));
  }
  const answer = (id: string) => answers[id] ?? [];
  function onAnswer(id: string, v: string[]) {
    if (SL_PREDICTIONS.some((p) => p.id === id) && slIsRevealed(id, lab)) return;
    setAnswers((a) => ({ ...a, [id]: v }));
  }
  function inspect(key: string, where?: SlWhere, anchor?: string) {
    markSeen(key);
    if (key === "real:LAN-B") selectSeg("LAN-B");
    if (key.startsWith("row:")) selectSeg(key.slice(4) as SlSeg);
    if (key === "zoom") setZoomed(true);
    if (where === "details") setDetailsOpen(true);
    if (anchor) window.setTimeout(() => document.getElementById(anchor)?.scrollIntoView({ block: "nearest", behavior: "smooth" }), 40);
  }
  function selectSeg(seg: SlSeg) {
    setSelected(seg);
    setWindowStart(windowFor(lab.rows, seg, ghostFor(seg)));
  }
  function ghostFor(seg: SlSeg) {
    const ip = parseIPv4(drafts[seg]?.network ?? "");
    const p = slRow(lab, seg)?.prefix;
    return ip && p !== undefined ? { seg, network: ip, prefix: p } : undefined;
  }
  function setDraft(seg: SlSeg, d: Partial<SlDraft>) {
    setDrafts((all) => {
      const next = { ...all, [seg]: { network: all[seg]?.network ?? "", ...all[seg], ...d } };
      const ip = parseIPv4(next[seg]!.network);
      const p = slRow(lab, seg)?.prefix;
      if (ip && p !== undefined) setWindowStart(windowFor(lab.rows, seg, { seg, network: ip, prefix: p }));
      return next;
    });
  }
  function act(a: SlAction) {
    setBefore(lab);
    runner.run(a);
    if (a.type === "place" || a.type === "clear") setDrafts((d) => ({ ...d, [a.seg]: { ...d[a.seg], network: a.type === "place" ? a.network : "" } }));
    if (a.type === "stage" || a.type === "free-play") {
      setSelected(undefined);
      setDrafts({});
      setWindowStart(0);
      setZoomed(false);
      window.setTimeout(() => document.getElementById("practice-lab-title")?.focus(), 30);
    }
  }
  function runCheck(rule: SlRule) {
    markSeen("rules");
    act({ type: "check", rule });
  }
  function reset() {
    runner.reset();
    setBefore(undefined);
    setAnswers({});
    setSeenKeys(new Set());
    setDrafts({});
    setSelected(undefined);
    setWindowStart(0);
    setZoomed(false);
    setDetailsOpen(false);
  }

  const conceal = lab.incident.active && !lab.incident.maskApplied && !lab.freePlay;
  const done = slStageDone(lab);
  const gate = lab.freePlay ? undefined : slStageGate(lab);
  const last = lab.stage === SL_STAGES.length - 1;
  function next() {
    if (!done || lab.freePlay) return;
    act(last ? { type: "free-play" } : { type: "stage", stage: lab.stage + 1 });
  }
  const ghostSeg = selected && ghostFor(selected) ? selected : undefined;
  const ghost = ghostSeg ? ghostFor(ghostSeg) : undefined;
  const head = slStageHeader(lab);

  // Engineer details: binary view follows what is being examined (never before it is asked for).
  const lastBad = [...lab.boundaryTests].reverse().find((t) => !t.aligned);
  const binary = lab.freePlay
    ? selected && slRow(lab, selected)?.network && slRow(lab, selected)?.prefix
      ? { ip: slRow(lab, selected)!.network!, prefix: slRow(lab, selected)!.prefix!, label: `${selected} as written` }
      : undefined
    : lab.stage === 2 && lastBad && seen("bin:boundary")
      ? { ip: lastBad.address, prefix: lastBad.prefix, label: `${lastBad.address} under /${lastBad.prefix}` }
      : lab.stage === 3 && lab.calc && seen("bin:calc")
        ? { ip: SL_CALC.address, prefix: SL_CALC.prefix, label: `${SL_CALC.address}/${SL_CALC.prefix}` }
        : lab.stage === 8 && slRow(lab, "LAN-B")?.network && seenSince(lab.records.find((r) => r.kind === "stage" && r.stage === 8)?.seq ?? lab.seq, "bin:incident")
          ? { ip: slRow(lab, "LAN-B")!.network!, prefix: 26, label: "LAN-B's written start under /26" }
          : undefined;
  const freeSeq = lab.records.find((r) => r.kind === "free-play")?.seq;
  const showFreeBlocks = lab.freePlay || lab.stage === 8 || (lab.stage === 7 && answer("t7").length > 0);

  const details = (
    <details id="sl-details" open={detailsOpen} onToggle={(e) => setDetailsOpen((e.currentTarget as HTMLDetailsElement).open)} className="rounded-2xl border border-pv-border bg-pv-bg-elevated/30 p-3">
      <summary className="cursor-pointer text-[14px] font-semibold text-pv-text-muted outline-none hover:text-pv-text focus-visible:text-pv-cyan-soft">
        Engineer details ▾ <span className="font-normal text-pv-text-faint">— exact ranges, rules, overlap matrix, precise ruler, design log</span>
      </summary>
      <div className="mt-3 grid gap-3 xl:grid-cols-2">
        <div className="min-w-0 space-y-3">
          <SubnetPlanTable
            rows={lab.rows}
            conceal={conceal}
            selected={selected}
            onSelect={(s) => {
              selectSeg(s);
              markSeen(`row:${s}`);
            }}
          />
          <SubnetRuler
            rows={lab.rows}
            conceal={conceal}
            ghost={ghost}
            selected={selected}
            onSelect={(s) => {
              selectSeg(s);
              markSeen(`row:${s}`);
            }}
            windowStart={windowStart}
            onWindow={setWindowStart}
          />
          <LabEventLog title="Design log" entries={lab.records.map((r) => ({ id: r.seq, tag: freeSeq !== undefined && r.seq >= freeSeq ? "Free" : `T${r.stage}`, text: r.text, kind: r.tone }))} />
        </div>
        <div className="min-w-0">
          <SubnetVerifyPanel lab={lab} conceal={conceal} binary={binary} showFreeBlocks={showFreeBlocks} onRunCheck={lab.incident.active ? runCheck : undefined} />
        </div>
      </div>
    </details>
  );

  const loopIndex = lab.freePlay ? -1 : done ? 4 : lab.last && lab.last.stage === lab.stage && lab.last.kind !== "stage" ? 3 : SL_PREDICTIONS.some((p) => p.stage === lab.stage && answer(p.id).length) ? 2 : 1;
  const nextButton = (compact: boolean) =>
    lab.freePlay ? null : done ? (
      <Button size={compact ? "sm" : "md"} onClick={next}>
        {last ? "Continue in free play →" : `Next: ${SL_STAGES[lab.stage + 1]} →`}
      </Button>
    ) : (
      <span className={compact ? "text-[11px] text-pv-text-faint" : "inline-block rounded-full border border-dashed border-pv-border px-3 py-1.5 text-[13px] text-pv-text-faint"}>
        {compact ? gate : `To continue: ${gate}`}
      </span>
    );
  // Desktop: the Next button lives in the stage header (aligned with the lesson column). Phones: the shell's tab bar.
  const primary = (compact: boolean) => (compact ? nextButton(true) : null);

  return (
    <PracticeLabShell
      open={open}
      onClose={onClose}
      title="Subnet Design Studio"
      sandboxNote="Same 10.44.0.0/24 as the lesson · sandbox, no progress"
      onReset={reset}
      stages={SL_STAGES.map((label, i) => ({ id: `t${i}`, label }))}
      currentStage={lab.stage}
      stageSuffix={lab.freePlay ? <span className="rounded-full border border-pv-success/40 px-2 py-0.5 text-[10.5px] text-pv-success">free play</span> : undefined}
      loop={{ labels: LOOP, current: loopIndex }}
      primaryAction={primary}
      topology={<StageHeader stage={lab.stage} freePlay={lab.freePlay} title={head.title} concept={head.concept} action={nextButton(false)} />}
      topologyClassName="h-auto"
      board={<SubnettingLabBoard lab={lab} before={before} conceal={conceal} seen={seen} seenSince={seenSince} answer={answer} onAnswer={onAnswer} act={act} inspect={inspect} drafts={drafts} setDraft={setDraft} selected={selected} select={selectSeg} windowStart={windowStart} zoomed={zoomed} setZoomed={setZoomed} gate={gate} details={details} />}
    />
  );
}
