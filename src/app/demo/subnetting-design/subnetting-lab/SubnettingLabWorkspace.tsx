"use client";

import { useCallback, useRef, useState } from "react";
import { clsx } from "clsx";
import { PracticeLabShell } from "@/components/practice-lab/PracticeLabShell";
import { Button } from "@/components/ui/Button";
import type { CliVendor } from "@/lib/cli/types";
import { createSsState, ssApply, type SsAction, type SsIf, type SsState } from "@/lib/sim-engine/scenarios/subnetStudio";
import type { ConsoleSession } from "@/app/demo/dhcp-dns/dhcp-lab/ConsoleTerminal";
import type { CliQuestion } from "@/app/demo/dhcp-dns/dhcp-lab/dhcpBuildCli";
import { LearnInsideABlock, LearnMoveTheLine, LearnWhereBlocksStart } from "./SubnetLearn";
import { StartClassesCidr, StartHostBits, StartTwoParts, StartWhySubnet } from "./SubnetStart";
import { PlanEqualSplit, PlanRightSize } from "./SubnetPlan";
import { FixWrittenVsReal } from "./SubnetFix";
import { CalculateIt } from "./SubnetCalc";
import { EMPTY_DESK, StudioApply, StudioDesign, StudioTrouble, type TroubleDesk } from "./SubnetStudio";
import { SsDesk, openSsWindow, type SsWin } from "./SubnetDevices";
import type { SsCiscoMode, SsCommit } from "./ssCli";
import { STEPS, SubnetPresentation } from "./SubnetPresentation";

/**
 * Subnet Explorer — the Subnetting Practice Lab. Understand first, then manipulate, calculate, design, apply, verify
 * and troubleshoot:
 *
 *   LEARN      the subnetting presentation (SubnetPresentation: scrollytelling deck, opens first)
 *   EXPLORE    1 Two parts of an address · 2 Host bits make addresses · 3 Why subnet? · 4 Classes, then CIDR ·
 *              5 Move the line · 6 Where blocks start · 7 Inside a block                  (explorable pictures)
 *   CALCULATE  8 Calculate it                                                            (checked practice)
 *   PLAN       9 One size for everyone? (FLSM) · 10 Right-size & pack (VLSM) · 11 Written vs real
 *   ENGINEER   12 Design · 13 Build & test · 14 Troubleshoot  (the Subnet Studio: subnetStudio.ts — a real topology)
 *
 * Chapters are never gated. The Explore/Plan pictures are pure; the Engineer chapters share one studio state (a
 * brief or a ticket), its device windows and terminals. Nothing here receives the ScenarioEngine, the guided snapshot
 * or the progress store.
 */

const FLOW = ["Learn", "Explore", "Calculate", "Plan", "Engineer"] as const;
const PARTS = ["Explore", "Calculate", "Plan", "Engineer"] as const;
const CHAPTERS: { part: 0 | 1 | 2 | 3; title: string }[] = [
  { part: 0, title: "Two parts of an address" },
  { part: 0, title: "Host bits make addresses" },
  { part: 0, title: "Why subnet?" },
  { part: 0, title: "Classes, then CIDR" },
  { part: 0, title: "Move the line" },
  { part: 0, title: "Where blocks start" },
  { part: 0, title: "Inside a block" },
  { part: 1, title: "Calculate it" },
  { part: 2, title: "One size for everyone?" },
  { part: 2, title: "Right-size & pack" },
  { part: 2, title: "Written vs real" },
  { part: 3, title: "Design" },
  { part: 3, title: "Build & test" },
  { part: 3, title: "Troubleshoot" },
];
const DESIGN = 11;
const APPLY = 12;
const TROUBLE = 13;
const same = (a: Record<string, SsIf>, b: Record<string, SsIf>) => JSON.stringify(a) === JSON.stringify(b);

export function SubnettingLabWorkspace({ open, onClose, initialMode = "present" }: { open: boolean; onClose: () => void; /** "explore" when the lesson page already played the presentation before opening the lab. */ initialMode?: "present" | "explore" }) {
  const [mode, setMode] = useState<"present" | "explore">(initialMode);
  const [pStep, setPStep] = useState(0);
  const goStep = useRef<((i: number) => void) | undefined>(undefined);
  const [ch, setCh] = useState(0);
  const [visited, setVisited] = useState<Set<number>>(() => new Set([0]));
  const [resetCount, setResetCount] = useState(0);

  // ---- the Subnet Studio (Engineer chapters) ----
  const [ss, setSs] = useState<SsState>(() => createSsState("lab"));
  const ssRef = useRef<SsState>(ss);
  const [hist, setHist] = useState<SsCommit[]>(() => [{ r1: ss.net.r1, at: 0, by: "initial" }]);
  const [windows, setWindows] = useState<SsWin[]>([]);
  const [focus, setFocus] = useState<string | undefined>(undefined);
  const [vendor, setVendor] = useState<CliVendor>("cisco");
  const [cisco, setCisco] = useState<SsCiscoMode>({ kind: "exec" });
  const [junosEdit, setJunosEdit] = useState(false);
  const [cand, setCand] = useState<Record<string, SsIf>>(ss.net.r1);
  const [question, setQuestion] = useState<CliQuestion | undefined>(undefined);
  const [consoles, setConsoles] = useState<Record<string, ConsoleSession>>({});
  const [notes, setNotes] = useState(true);
  const desk = useState<TroubleDesk>(EMPTY_DESK);
  const setDesk = desk[1];

  const actSs = useCallback((a: SsAction, by?: string) => {
    const n = ssApply(ssRef.current, a);
    ssRef.current = n;
    setSs(n);
    // Junos keeps a commit history: any change to R1 (plan applied, IOS line, ticket, Junos commit) becomes a commit.
    setHist((h) => (same(h[0].r1, n.net.r1) ? h : [{ r1: n.net.r1, at: Date.now(), by: by ?? (a.type === "r1-if" ? "admin (IOS)" : a.type === "apply" ? "plan applied" : a.type === "ticket" ? "ticket" : a.type) }, ...h].slice(0, 20)));
    if (a.type === "ticket" || a.type === "brief") {
      setDesk(EMPTY_DESK);
      setConsoles({});
      setCisco({ kind: "exec" });
      setJunosEdit(false);
      setCand(n.net.r1);
      setWindows((ws) => ws.filter((w) => w.id === "r1" || n.needs.some((x) => x.id === w.id)));
    }
    return n;
  }, [setDesk]);
  const act = useCallback((a: SsAction) => actSs(a), [actSs]);
  const openWin = (id: string) => {
    setWindows((ws) => openSsWindow(ws, id));
    setFocus(id);
  };
  const cli = { cisco, setCisco, junosEdit, setJunosEdit, cand, setCand, hist, commit: (r1: Record<string, SsIf>) => actSs({ type: "r1-set", r1, by: "Junos commit" }, "admin") };

  const go = (to: number) => {
    if (to < 0 || to >= CHAPTERS.length || to === ch) return;
    setCh(to);
    setVisited((v) => new Set(v).add(to));
    if (to < DESIGN) setWindows((ws) => ws.map((w) => ({ ...w, minimized: true })));
    window.setTimeout(() => document.getElementById("practice-lab-title")?.focus(), 30);
  };
  const goEng = (k: "design" | "apply" | "trouble") => go(k === "design" ? DESIGN : k === "apply" ? APPLY : TROUBLE);
  const toExplorer = () => {
    setMode("explore");
    setVisited((v) => new Set(v).add(ch));
    window.setTimeout(() => document.getElementById("practice-lab-title")?.focus(), 30);
  };
  const toPresentation = () => {
    setWindows((ws) => ws.map((w) => ({ ...w, minimized: true })));
    setMode("present");
  };
  const onStep = useCallback((i: number) => setPStep(i), []);
  const reset = () => {
    if (mode === "present") {
      goStep.current?.(0);
      return;
    }
    setResetCount((n) => n + 1);
    if (ch >= DESIGN) {
      const fresh = createSsState("lab");
      ssRef.current = fresh;
      setSs(fresh);
      setHist([{ r1: fresh.net.r1, at: 0, by: "initial" }]);
      setWindows([]);
      setFocus(undefined);
      setVendor("cisco");
      setCisco({ kind: "exec" });
      setJunosEdit(false);
      setCand(fresh.net.r1);
      setQuestion(undefined);
      setConsoles({});
      setDesk(EMPTY_DESK);
    }
  };

  const part = CHAPTERS[ch].part;
  const nextLabel = ch < CHAPTERS.length - 1 ? `${CHAPTERS[ch + 1].title} →` : undefined;

  const nav = (compact: boolean) => (
    <div className="flex items-center gap-2">
      <Button size={compact ? "sm" : "md"} variant="secondary" onClick={() => go(ch - 1)} disabled={ch === 0} aria-label="Previous chapter">
        ←
      </Button>
      {nextLabel && (
        <Button size={compact ? "sm" : "md"} onClick={() => go(ch + 1)}>
          {compact ? "Next →" : nextLabel}
        </Button>
      )}
    </div>
  );

  const rail = (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <nav aria-label="Chapters" className="min-w-0">
        <ol className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <li className="flex items-center gap-1.5">
            <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-pv-text-faint">Learn</span>
            <button type="button" onClick={toPresentation} className="flex h-7 items-center rounded-full border border-pv-success/50 px-2.5 text-[12.5px] font-semibold text-pv-success hover:text-pv-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-pv-cyan">
              ▶ Presentation
            </button>
          </li>
          {PARTS.map((p, pi) => (
            <li key={p} className="flex items-center gap-1.5">
              <span className={clsx("text-[11px] font-bold uppercase tracking-[0.14em]", part === pi ? "text-pv-cyan-soft" : "text-pv-text-faint")}>{p}</span>
              <ol className="flex gap-1">
                {CHAPTERS.map((c, i) =>
                  c.part !== pi ? null : (
                    <li key={c.title}>
                      <button
                        type="button"
                        onClick={() => go(i)}
                        aria-current={i === ch ? "step" : undefined}
                        title={c.title}
                        className={clsx(
                          "flex h-7 min-w-7 items-center justify-center rounded-full border px-2 text-[12.5px] font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-pv-cyan",
                          i === ch ? "border-pv-cyan bg-pv-cyan/20 text-pv-text" : visited.has(i) ? "border-pv-success/50 text-pv-success hover:text-pv-text" : "border-pv-border text-pv-text-muted hover:text-pv-text",
                        )}
                      >
                        {i + 1}
                        <span aria-hidden className={clsx("ml-1.5", i === ch ? "inline" : "hidden")}>{c.title}</span>
                        <span className="sr-only">
                          {" "}
                          {c.title}
                          {i === ch ? " (current)" : visited.has(i) ? " (visited)" : ""}
                        </span>
                      </button>
                    </li>
                  ),
                )}
              </ol>
            </li>
          ))}
        </ol>
        <h2 className="sr-only">
          Chapter {ch + 1}: {CHAPTERS[ch].title}
        </h2>
      </nav>
      <div className="hidden shrink-0 lg:block">{nav(false)}</div>
    </div>
  );

  const last = pStep === STEPS.length - 1;
  const presentNav = (compact: boolean) => (
    <div className="flex items-center gap-2">
      <Button size={compact ? "sm" : "md"} variant="secondary" onClick={() => goStep.current?.(pStep - 1)} disabled={pStep === 0} aria-label="Previous step">
        ←
      </Button>
      {last ? (
        <Button size={compact ? "sm" : "md"} onClick={toExplorer}>
          Explore it yourself →
        </Button>
      ) : (
        <Button size={compact ? "sm" : "md"} onClick={() => goStep.current?.(pStep + 1)}>
          Next →
        </Button>
      )}
    </div>
  );
  const presentHeader = (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-pv-cyan-soft">
          Learn · the subnetting presentation <span className="text-pv-text-faint">· {pStep + 1} / {STEPS.length}</span>
        </p>
        <h2 className="truncate text-[17px] font-semibold leading-tight text-pv-text sm:text-[19px]">{STEPS[pStep].chapter}</h2>
        <div className="mt-1.5 flex h-1.5 max-w-xl overflow-hidden rounded-full bg-pv-border" role="progressbar" aria-valuemin={1} aria-valuemax={STEPS.length} aria-valuenow={pStep + 1} aria-label="Presentation progress">
          <div className="h-full rounded-full bg-pv-cyan transition-[width] duration-500" style={{ width: `${((pStep + 1) / STEPS.length) * 100}%` }} />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button type="button" onClick={toExplorer} className="text-[13px] font-semibold text-pv-text-muted underline-offset-2 hover:text-pv-text hover:underline">
          Skip to the Explorer →
        </button>
        <div className="hidden lg:block">{presentNav(false)}</div>
      </div>
    </div>
  );

  const k = `${resetCount}-${ch}`;
  const studio = { ss, act, openWin, go: goEng };
  const board =
    mode === "present" ? <SubnetPresentation step={pStep} onStep={onStep} goRef={goStep} onDone={toExplorer} /> :
    ch === 0 ? <StartTwoParts key={k} /> :
    ch === 1 ? <StartHostBits key={k} /> :
    ch === 2 ? <StartWhySubnet key={k} /> :
    ch === 3 ? <StartClassesCidr key={k} /> :
    ch === 4 ? <LearnMoveTheLine key={k} /> :
    ch === 5 ? <LearnWhereBlocksStart key={k} /> :
    ch === 6 ? <LearnInsideABlock key={k} /> :
    ch === 7 ? <CalculateIt key={k} /> :
    ch === 8 ? <PlanEqualSplit key={k} /> :
    ch === 9 ? <PlanRightSize key={k} /> :
    ch === 10 ? <FixWrittenVsReal key={k} /> :
    ch === DESIGN ? <StudioDesign key={k} {...studio} /> :
    ch === APPLY ? <StudioApply key={k} {...studio} /> :
    <StudioTrouble key={k} {...studio} desk={desk} />;

  return (
    <PracticeLabShell
      open={open}
      onClose={onClose}
      title={mode === "present" ? "Subnetting, from zero" : "Subnet Explorer"}
      sandboxNote="Explore freely · nothing here changes your lesson progress"
      onReset={reset}
      stages={[] /* the chapter rail below shows where you are */}
      currentStage={0}
      loop={{ labels: [...FLOW], current: mode === "present" ? 0 : part + 1 }}
      primaryAction={(compact) => (compact ? (mode === "present" ? presentNav(true) : nav(true)) : null)}
      topology={mode === "present" ? presentHeader : rail}
      topologyClassName={mode === "explore" && ch >= APPLY ? "h-auto max-w-[2400px]" : "h-auto max-w-6xl"}
      board={
        <>
          {board}
          {mode === "explore" && ch >= DESIGN && <SsDesk windows={windows} setWindows={setWindows} focus={focus} setFocus={setFocus} ctx={{ view: ss, act, vendor, setVendor, cli, question, setQuestion, consoles, setConsoles, notes, setNotes }} />}
        </>
      }
    />
  );
}
