"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { clsx } from "clsx";
import { PracticeLabShell, type PracticeLabTab } from "@/components/practice-lab/PracticeLabShell";
import type { CliVendor } from "@/lib/cli/types";
import type { CliQuestion } from "@/app/demo/dhcp-dns/dhcp-lab/dhcpBuildCli";
import type { ConsoleSession } from "@/app/demo/dhcp-dns/dhcp-lab/ConsoleTerminal";
import type { SpBase, SpCause, SpChallenge, SpFeedback, SpLevel, SpMoment, SpProof, SpRun, SpRung, SpTicket } from "./spKit";
import type { XrStack } from "./spCli";
import { SpDesk, openSpWindow, type SpConsoleCtx, type SpDeskDevice, type SpWin } from "./SpDesk";
import { MomentLine, Pill } from "./SpUi";
import { SP_TRAVEL_MS } from "./SpStage";

/**
 * The shared Service Provider practice-lab workspace. One lesson spec supplies the network model and everything the
 * student sees; this component runs the same learning loop for every SP lesson:
 *
 *   LEARN                  the lesson's levels: each step explains, runs something on a fresh network, plays it moment
 *                          by moment (Pause / Step / Skip / Replay) and shows the evidence it asks for
 *   ENGINEERING WORKSPACE  Investigate (the lesson's composer + device windows + tools) · Challenges (checked from the
 *                          network) · Troubleshoot (tickets: reproduce → explain → fix → prove with a fresh test)
 *
 * Nothing here touches the guided lesson or the progress store.
 */

export interface SpCliState extends SpConsoleCtx {
  cand: Record<string, unknown>;
  setCand: (dev: string, c: unknown) => void;
  xr: Record<string, XrStack>;
  setXr: (dev: string, s: XrStack) => void;
  edit: Record<string, boolean>;
  setEdit: (dev: string, b: boolean) => void;
  setQuestion: (q: CliQuestion | undefined) => void;
}
export interface SpCtx<S, A, Snap> {
  s: S;
  /** The tables as of the moment on screen (or now). */
  live: Snap;
  /** Set while a run is on screen and a moment's snapshot is shown. */
  snap?: Snap;
  act: (a: A) => S;
  vendor: CliVendor;
  setVendor: (v: CliVendor) => void;
  busy: boolean;
  eng: boolean;
  level: number;
  openWin: (id: string) => void;
  cli: SpCliState;
  moment?: SpMoment<Snap>;
  /** The last run, once it has finished playing. */
  done?: SpRun<Snap>;
  text: (t: string) => string;
}
export interface SpLabSpec<S extends SpBase<Snap>, A, Snap> {
  title: string;
  note: (eng: boolean, level: number) => string;
  /** A fresh network. `vendor` is the OS the lab is showing (labs whose behavior differs by OS use it). */
  fresh: (seq: number, vendor: CliVendor) => S;
  /** Labs whose behavior follows the OS: the action that switches the network to the newly shown OS. */
  vendorAction?: (v: CliVendor) => A;
  /** The OS views this lab offers, first one shown by default (default: IOS XR and Junos). */
  vendors?: CliVendor[];
  apply: (s: S, a: A) => S;
  snapOf: (s: S) => Snap;
  ticketAction: (id: string) => A;
  levels: SpLevel<A>[];
  gate: { title: string; points: ReactNode[]; more: ReactNode };
  stage: (c: SpCtx<S, A, Snap>, p: { moment?: SpMoment<Snap>; momentKey: string; compact: boolean; onNode?: (id: string) => void; selected?: string }) => ReactNode;
  footer?: (c: SpCtx<S, A, Snap>) => ReactNode;
  devices: string[];
  device: (id: string, c: SpCtx<S, A, Snap>) => SpDeskDevice;
  /** From which Learn level devices can be opened (the workspace always can). */
  openFrom: number;
  window: (id: string, c: SpCtx<S, A, Snap>) => ReactNode;
  tools: { id: string; label: string; render: (c: SpCtx<S, A, Snap>) => ReactNode }[];
  toolsLabel: { learn: string; eng: string };
  evidence: (key: string, c: SpCtx<S, A, Snap>) => ReactNode;
  composer: (c: SpCtx<S, A, Snap>) => ReactNode;
  investigate: ReactNode[];
  challenges: SpChallenge<S>[];
  tickets: SpTicket<A>[];
  ticketIntro: string;
  reproHint: string;
  fixHint: string;
  causes: SpCause[];
  feedback: (s: S, cause: string) => SpFeedback;
  proofs: (s: S) => SpProof[];
  ladder: (s: S, vendor: CliVendor) => SpRung[];
  runCard?: (c: SpCtx<S, A, Snap>, run: SpRun<Snap>) => ReactNode;
  text?: (vendor: CliVendor, t: string) => string;
  momentMs?: number;
}

type Mode = "learn" | "gate" | "eng";
type EngTab = "investigate" | "challenges" | "troubleshoot";
interface Player<Snap> {
  run?: SpRun<Snap>;
  key: string;
  cursor: number;
  playing: boolean;
}
let playSeq = 0;

export function SpLabWorkspace<S extends SpBase<Snap>, A, Snap>({ spec, open, onClose }: { spec: SpLabSpec<S, A, Snap>; open: boolean; onClose: () => void }) {
  const MOMENT_MS = spec.momentMs ?? 2300;
  const LV = spec.levels;
  const VENDORS = spec.vendors ?? (["cisco", "juniper"] as CliVendor[]);
  const V0 = VENDORS[0];
  const vendorRef = useRef<CliVendor>("cisco");
  /** The OS a fresh network is built for: the current view, or the lab's first one when the lab doesn't offer it. */
  const build = useCallback(
    (li: number, si: number, seq: number): S => {
      const v = spec.vendors && !spec.vendors.includes(vendorRef.current) ? spec.vendors[0] : vendorRef.current;
      return (LV[li].steps[si].pre ?? []).reduce((acc, a) => spec.apply(acc, a), spec.fresh(seq, v));
    },
    [LV, spec],
  );
  const [mode, setMode] = useState<Mode>("learn");
  const [engTab, setEngTab] = useState<EngTab>("investigate");
  const [level, setLevel] = useState(0);
  const [step, setStep] = useState(0);
  const [unlocked, setUnlocked] = useState(0);
  const [s, setS] = useState<S>(() => (LV[0].steps[0].pre ?? []).reduce((acc, a) => spec.apply(acc, a), spec.fresh(0, V0)));
  const sRef = useRef(s);
  const [P, setP] = useState<Player<Snap>>({ key: "idle", cursor: 0, playing: false });
  const [landedKey, setLandedKey] = useState("");
  const [animate, setAnimate] = useState(true);
  const [ranKey, setRanKey] = useState<string | undefined>(undefined);
  const [answer, setAnswer] = useState<string | undefined>(undefined);
  const [windows, setWindows] = useState<SpWin[]>([]);
  const [focus, setFocus] = useState<string | undefined>(undefined);
  const [vendor, setVendorState] = useState<CliVendor>(V0);
  const [cand, setCandAll] = useState<Record<string, unknown>>({});
  const [xr, setXrAll] = useState<Record<string, XrStack>>({});
  const [edit, setEditAll] = useState<Record<string, boolean>>({});
  const [sessions, setSessions] = useState<Record<string, ConsoleSession>>({});
  const [question, setQuestion] = useState<CliQuestion | undefined>(undefined);
  const [notes, setNotes] = useState(true);
  const [guess, setGuess] = useState<string | undefined>(undefined);
  const [guessFb, setGuessFb] = useState<SpFeedback | undefined>(undefined);
  const [found, setFound] = useState(false);
  const [rungs, setRungs] = useState<Record<string, boolean>>({});
  const [tool, setTool] = useState(spec.tools[0]?.id ?? "");
  const [mobileTab, setMobileTab] = useState<PracticeLabTab>("topology");
  const [ticketSeq, setTicketSeq] = useState(0);
  const text = useCallback((t: string) => (spec.text ? spec.text(vendor, t) : t), [spec, vendor]);

  // ---------------------------------------------------------------- Playback (one moment at a time)
  const moments = P.run?.moments ?? [];
  const n = moments.length;
  const playingPlan = !!P.run && P.cursor < n;
  const curKey = `${P.key}:${P.cursor}`;
  useEffect(() => {
    if (!P.playing || !P.run || P.cursor >= n) return;
    const t = window.setTimeout(() => setP((p) => (p.key !== P.key ? p : p.cursor + 1 >= n ? { ...p, cursor: n, playing: false } : { ...p, cursor: p.cursor + 1 })), MOMENT_MS);
    return () => window.clearTimeout(t);
  }, [P, n, MOMENT_MS]);
  useEffect(() => {
    if (!playingPlan) return;
    const k = curKey;
    const t = window.setTimeout(() => setLandedKey(k), SP_TRAVEL_MS);
    return () => window.clearTimeout(t);
  }, [curKey, playingPlan]);
  const landed = landedKey === curKey;
  const show = useCallback((run: SpRun<Snap>) => setP({ run, key: `r${run.id}-${++playSeq}`, cursor: animate ? 0 : run.moments.length, playing: animate }), [animate]);
  const pause = () => setP((p) => ({ ...p, playing: false }));
  const play = () => setP((p) => ({ ...p, playing: true }));
  const stepOnce = () => setP((p) => (p.cursor < n ? { ...p, cursor: p.cursor + 1, playing: false } : p));
  const skip = () => setP((p) => ({ ...p, cursor: n, playing: false }));
  const replay = () => setP((p) => (p.run ? { ...p, key: `${p.key}+`, cursor: 0, playing: true } : p));
  const moment = playingPlan ? moments[P.cursor] : undefined;
  const prevMoment = P.cursor > 0 ? moments[Math.min(P.cursor, n) - 1] : undefined;
  const snap: Snap | undefined = moment ? (landed ? moment.snap : prevMoment?.snap) : undefined;
  const live = snap ?? spec.snapOf(s);

  const resetCli = () => {
    setCandAll({});
    setXrAll({});
    setEditAll({});
    setQuestion(undefined);
  };
  const act = useCallback(
    (a: A) => {
      const before = sRef.current;
      const nx = spec.apply(before, a);
      sRef.current = nx;
      setS(nx);
      if (nx.last && nx.last !== before.last) show(nx.last);
      return nx;
    },
    [show, spec],
  );
  /** Switching the OS view: the consoles follow; a lab whose behavior depends on the OS recomputes (no run is shown). */
  const setVendor = (v: CliVendor) => {
    vendorRef.current = v;
    setVendorState(v);
    if (spec.vendorAction) {
      const nx = spec.apply(sRef.current, spec.vendorAction(v));
      sRef.current = nx;
      setS(nx);
      setCandAll({});
      setXrAll({});
      setEditAll({});
    }
  };
  const openWin = (d: string) => {
    setWindows((ws) => openSpWindow(ws, d));
    setFocus(d);
  };
  const resetNet = (start?: S) => {
    const ns: S = start ?? spec.fresh(sRef.current.seq + 1, VENDORS.includes(vendorRef.current) ? vendorRef.current : V0);
    sRef.current = ns;
    setS(ns);
    setP({ key: "idle", cursor: 0, playing: false });
    resetCli();
  };

  // ---------------------------------------------------------------- Learn
  const lv = LV[level];
  const st = lv.steps[step];
  const stepKey = `${level}:${step}`;
  const hasRun = !!st.runs?.length;
  const ran = !hasRun || ranKey === stepKey;
  const stepDone = ran && !playingPlan;
  const enterStep = (li: number, si: number) => {
    setLevel(li);
    setStep(si);
    setRanKey(undefined);
    setAnswer(undefined);
    resetNet(build(li, si, sRef.current.seq + 1));
  };
  const runStep = (r: NonNullable<(typeof st)["runs"]>[number]) => {
    if (!r.keep) resetNet(build(level, step, sRef.current.seq + 1));
    r.actions.forEach((a) => act(a));
    setRanKey(stepKey);
  };
  const nextStep = () => {
    if (!stepDone) return;
    if (step + 1 < lv.steps.length) return enterStep(level, step + 1);
    if (level + 1 < LV.length) {
      setUnlocked((u) => Math.max(u, level + 1));
      return enterStep(level + 1, 0);
    }
    setP((p) => ({ ...p, cursor: n, playing: false }));
    setMode("gate");
  };
  const toEngineering = () => {
    setUnlocked(LV.length - 1);
    setMode("eng");
    setEngTab("investigate");
    setGuess(undefined);
    setFound(false);
    setRungs({});
    resetNet();
    setWindows([]);
  };
  const toLearn = (li: number) => {
    setWindows([]);
    setMode("learn");
    enterStep(li, 0);
  };
  const reset = () => {
    setWindows([]);
    setFocus(undefined);
    vendorRef.current = V0;
    setVendorState(V0);
    setSessions({});
    setGuess(undefined);
    setFound(false);
    setRungs({});
    setTool(spec.tools[0]?.id ?? "");
    if (mode === "learn") enterStep(level, step);
    else resetNet();
  };

  const eng = mode === "eng";
  const done = P.run && !playingPlan ? P.run : undefined;
  const cli: SpCliState = {
    cand,
    setCand: (d, c) => setCandAll((m) => ({ ...m, [d]: c })),
    xr,
    setXr: (d, st2) => setXrAll((m) => ({ ...m, [d]: st2 })),
    edit,
    setEdit: (d, b) => setEditAll((m) => ({ ...m, [d]: b })),
    sessions,
    setSessions,
    notes,
    setNotes,
    question,
    setQuestion,
  };
  const ctx: SpCtx<S, A, Snap> = { s, live, snap, act, vendor, setVendor, busy: playingPlan, eng, level, openWin, cli, moment: landed ? moment : prevMoment, done, text };

  // ---------------------------------------------------------------- Pieces
  const learnAction = (compact: boolean) => {
    if (mode !== "learn") return null;
    if (hasRun && !ran) {
      const first = st.runs![0];
      return (
        <Pill onClick={() => runStep(first)} disabled={playingPlan} tone="primary">
          {compact ? "▶ Go" : `▶ ${first.label}`}
        </Pill>
      );
    }
    const last = level + 1 >= LV.length && step + 1 >= lv.steps.length;
    return (
      <Pill onClick={nextStep} disabled={!stepDone} tone="primary">
        {step + 1 < lv.steps.length ? "Next →" : last ? "I've finished learning →" : compact ? `Level ${level + 2} →` : `Level ${level + 2}: ${LV[level + 1].title} →`}
      </Pill>
    );
  };
  const playerControls = P.run && (
    <div className="flex flex-wrap items-center gap-1" aria-label="Playback">
      {playingPlan && (P.playing ? <Pill onClick={pause}>⏸ Pause</Pill> : <Pill onClick={play}>▶ Play</Pill>)}
      {playingPlan && <Pill onClick={stepOnce}>Step ⏭</Pill>}
      {playingPlan && <Pill onClick={skip}>Skip to end</Pill>}
      {!playingPlan && <Pill onClick={replay}>↻ Replay</Pill>}
      <span className="pv-mono text-[11px] text-pv-text-faint">
        step {Math.min(P.cursor + (playingPlan ? 1 : 0), n)}/{n}
      </span>
    </div>
  );

  const clickable = eng || level >= spec.openFrom;
  const stageFor = (compact: boolean) => spec.stage(ctx, { moment, momentKey: curKey, compact, onNode: clickable ? openWin : undefined, selected: focus });
  const topology = (
    <>
      <div className="h-full sm:hidden">{stageFor(true)}</div>
      <div className="hidden h-full sm:block">{stageFor(false)}</div>
    </>
  );
  const shown = moment ?? prevMoment;
  const caption = moment ? moment.lines.map((l) => l.text).join(" · ") : (s.log[s.log.length - 1]?.text ?? "");
  const momentPanel = P.run && shown && (
    <div className="space-y-1">
      {shown.lines.slice(0, 8).map((l, i) => (
        <MomentLine key={`${P.key}${P.cursor}${i}`} text={text(l.text)} tone={l.tone} delay={moment ? SP_TRAVEL_MS * 0.6 + i * 90 : i * 60} />
      ))}
      {shown.lines.length > 8 && <p className="text-[11.5px] text-pv-text-faint">… and {shown.lines.length - 8} more things happened in this step.</p>}
    </div>
  );

  // ---------------------------------------------------------------- Boards
  const header = (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1">
        {LV.map((l, li) => (
          <button key={l.n} type="button" disabled={li > unlocked && !eng} aria-current={mode === "learn" && level === li ? "step" : undefined} onClick={() => toLearn(li)} className={clsx("rounded-full border px-2.5 py-0.5 text-[11.5px] font-semibold disabled:opacity-35", mode === "learn" && level === li ? "border-pv-cyan bg-pv-cyan/15 text-pv-text" : li < unlocked || eng ? "border-pv-success/50 text-pv-success" : "border-pv-border text-pv-text-muted")}>
            {l.n}. {l.title}
          </button>
        ))}
        <span className="mx-1 text-pv-text-faint">→</span>
        <button type="button" onClick={() => (eng ? undefined : mode === "gate" ? toEngineering() : setMode("gate"))} className={clsx("rounded-full border px-2.5 py-0.5 text-[11.5px] font-semibold", eng ? "border-pv-violet bg-pv-violet/15 text-pv-text" : "border-pv-violet/50 text-pv-violet")}>
          Engineering workspace
        </button>
      </div>
      {mode === "learn" && (
        <p className="text-[12px] text-pv-text-faint">
          Level {lv.n}: {lv.idea}
        </p>
      )}
    </div>
  );
  const check = st.check;
  const learnBoard = (
    <div className="space-y-3 rounded-2xl border border-pv-border bg-pv-bg-elevated/40 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-[15px] font-bold text-pv-text">{st.title}</h3>
        <span className="shrink-0 text-[11px] text-pv-text-faint">
          step {step + 1} / {lv.steps.length}
        </span>
      </div>
      <div className="space-y-1.5 text-[13.5px] leading-snug text-pv-text-muted">{st.body}</div>
      {st.runs && (st.runs.length > 1 || ran) && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11.5px] text-pv-text-faint">Run:</span>
          {st.runs.map((r) => (
            <Pill key={r.label} onClick={() => runStep(r)} disabled={playingPlan}>
              {r.label}
            </Pill>
          ))}
        </div>
      )}
      {momentPanel}
      {playingPlan && st.show.length > 0 && <p className="rounded-xl border border-pv-border p-2 text-[12px] text-pv-text-muted">The evidence below follows the run step by step — let it play, step through it, or press Skip to end.</p>}
      <div className="space-y-2">
        {st.show.map((k) => (
          <div key={k}>{spec.evidence(k, ctx)}</div>
        ))}
      </div>
      {check && stepDone && (
        <div className="space-y-1 rounded-xl border border-pv-border p-2">
          <p className="text-[12.5px] font-semibold text-pv-text">Check yourself (optional): {check.q}</p>
          <div className="grid gap-1">
            {check.options.map((o) => (
              <button key={o.id} type="button" onClick={() => setAnswer(o.id)} className={clsx("rounded-lg border px-2 py-1 text-left text-[12.5px]", answer === o.id ? (o.id === check.answer ? "border-pv-success/60 bg-pv-success/10 text-pv-text" : "border-pv-warning/50 text-pv-text-muted") : "border-pv-border text-pv-text hover:border-pv-cyan/60")}>
                {answer === o.id ? (o.id === check.answer ? "✓ " : "✗ ") : ""}
                {o.label}
              </button>
            ))}
          </div>
          {answer && <p className={clsx("text-[12px]", answer === check.answer ? "text-pv-success" : "text-pv-text-muted")}>{check.why}</p>}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 border-t border-pv-border pt-2">
        {(step > 0 || level > 0) && <Pill onClick={() => (step > 0 ? enterStep(level, step - 1) : enterStep(level - 1, LV[level - 1].steps.length - 1))}>← Back</Pill>}
        <span className="flex-1" />
        {learnAction(false)}
      </div>
    </div>
  );
  const gateBoard = (
    <div className="space-y-3 rounded-2xl border border-pv-violet/50 bg-pv-violet/[0.05] p-4">
      <h3 className="text-[16px] font-bold text-pv-text">{spec.gate.title}</h3>
      <ul className="list-disc space-y-1 pl-5 text-[13px] text-pv-text-muted">
        {spec.gate.points.map((p, i) => (
          <li key={i}>{p}</li>
        ))}
      </ul>
      <div className="text-[13px] text-pv-text-muted">{spec.gate.more}</div>
      <div className="flex flex-wrap gap-2">
        <Pill onClick={toEngineering} tone="primary">
          Enter the engineering workspace →
        </Pill>
        <Pill onClick={() => toLearn(LV.length - 1)}>Review level {LV.length}</Pill>
      </div>
    </div>
  );

  // Troubleshoot
  const t = s.ticket ? spec.tickets.find((x) => x.id === s.ticket) : undefined;
  const proofs = t ? spec.proofs(s) : [];
  const solved = !!t && proofs.every((p) => p.ok);
  const fb = guess ? guessFb : undefined;
  const startTicket = (id: string) => {
    setWindows([]);
    setSessions({});
    setGuess(undefined);
    setFound(false);
    setRungs({});
    setP({ key: "idle", cursor: 0, playing: false });
    resetCli();
    setTicketSeq(act(spec.ticketAction(id)).seq);
  };
  const reproduced = !!t && s.runs.some((r) => r.id > ticketSeq);
  const phase = !t ? 0 : !reproduced ? 1 : !found ? 2 : !solved ? 3 : 4;
  const allTickets = () => (resetNet(), setGuess(undefined), setFound(false));
  const runRepro = () => t && t.repro.forEach((a) => act(a));
  const troubleshootBoard = (
    <div className="space-y-3">
      {!t ? (
        <>
          <p className="text-[13px] text-pv-text-muted">{spec.ticketIntro}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {spec.tickets.map((x) => (
              <button key={x.id} type="button" onClick={() => startTicket(x.id)} className="rounded-xl border border-pv-border p-2.5 text-left hover:border-pv-violet/60">
                <p className="text-[13px] font-bold text-pv-text">{x.title}</p>
                <p className="text-[12px] italic text-pv-text-muted">{x.report}</p>
              </button>
            ))}
          </div>
        </>
      ) : (
        <div className="space-y-3 rounded-2xl border border-pv-violet/40 p-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-[14px] font-bold text-pv-text">{t.title}</p>
              <p className="text-[12.5px] italic text-pv-text-muted">{t.report}</p>
            </div>
            <Pill onClick={allTickets}>All tickets</Pill>
          </div>
          <ol className="flex flex-wrap gap-1 text-[11.5px]">
            {["Reproduce", "Explain", "Fix", "Prove"].map((p, i) => (
              <li key={p} className={clsx("rounded-full border px-2 py-0.5 font-semibold", phase > i + 1 || (i === 3 && solved) ? "border-pv-success/60 text-pv-success" : phase === i + 1 ? "border-pv-violet bg-pv-violet/15 text-pv-text" : "border-pv-border text-pv-text-faint")}>
                {i + 1}. {p}
              </li>
            ))}
          </ol>
          {phase === 1 && (
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[13px] text-pv-text-muted">
                See it yourself first: {t.reproLabel}. {spec.reproHint}
              </p>
              <Pill onClick={runRepro} disabled={playingPlan} tone="primary">
                Reproduce it ▶
              </Pill>
            </div>
          )}
          {phase >= 2 && (
            <div className="space-y-1.5">
              <p className="text-[13px] text-pv-text-muted">Walk the evidence in order. Open each question once you&apos;ve looked at the devices yourself (their windows, consoles and the tools):</p>
              <div className="grid gap-1">
                {spec.ladder(s, vendor).map((r, i) => (
                  <div key={r.k} className="rounded-lg border border-pv-border/70 px-2 py-1">
                    <button type="button" onClick={() => setRungs((m) => ({ ...m, [r.k]: !m[r.k] }))} className="flex w-full items-center gap-2 text-left">
                      <span className="text-[11px] text-pv-text-faint">{i + 1}</span>
                      <span className="flex-1 text-[12.5px] font-semibold text-pv-text">{text(r.title)}</span>
                      <span className="text-[11px] text-pv-cyan-soft">{rungs[r.k] ? "hide" : "check"}</span>
                    </button>
                    {rungs[r.k] && <p className="mt-0.5 text-[12px] leading-snug text-pv-text-muted">{text(r.text)}</p>}
                  </div>
                ))}
              </div>
              <p className="pt-1 text-[13px] text-pv-text-muted">{found ? "Diagnosis:" : "What explains all of it? A wrong choice gets the evidence that rules it out."}</p>
              <div className="grid gap-1">
                {spec.causes.map((c) => {
                  const picked = guess === c.id;
                  if (found && !picked) return null;
                  return (
                    <div key={c.id}>
                      <button
                        type="button"
                        disabled={found}
                        onClick={() => {
                          const f = spec.feedback(s, c.id);
                          setGuess(c.id);
                          setGuessFb(f);
                          if (f.right) setFound(true);
                        }}
                        className={clsx("w-full rounded-lg border px-2 py-1 text-left text-[12.5px]", picked ? (fb?.right ? "border-pv-success/60 bg-pv-success/10 text-pv-text" : "border-pv-warning/50 text-pv-text-muted") : "border-pv-border text-pv-text hover:border-pv-violet/60")}
                      >
                        {picked ? (fb?.right ? "✓ " : "✗ ") : ""}
                        {text(c.label)}
                      </button>
                      {picked && fb && (
                        <p className={clsx("px-2 py-1 text-[12px]", fb.right ? "text-pv-success" : "text-pv-text-muted")}>
                          {!fb.right && <b className="text-pv-warning">{fb.consequence ? "A consequence, not the cause. " : "Not the cause. "}</b>}
                          {text(fb.text)}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {phase >= 3 && (
            <div className="space-y-1.5 rounded-xl border border-pv-border p-2">
              <p className="text-[13px] font-semibold text-pv-text">{solved ? "Proved" : "Fix it, check the devices, then prove it with a fresh test"}</p>
              {!solved && <p className="text-[12.5px] text-pv-text-muted">{spec.fixHint}</p>}
              <ul className="space-y-0.5">
                {proofs.map((p) => (
                  <li key={p.label} className={clsx("text-[12.5px]", p.ok ? "text-pv-success" : "text-pv-text-muted")}>
                    {p.ok ? "✓" : "○"} {text(p.label)} <span className="text-[11.5px] text-pv-text-faint">— {text(p.detail)}</span>
                  </li>
                ))}
              </ul>
              {!solved && (
                <Pill onClick={runRepro} disabled={playingPlan}>
                  ▶ Run the test again
                </Pill>
              )}
              {solved && (
                <p className="text-[12.5px] text-pv-text">
                  Ticket closed with evidence. <Pill onClick={allTickets}>Next ticket</Pill>
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );

  const challengesBoard = (
    <div className="space-y-2">
      <p className="text-[13px] text-pv-text-muted">Operate the network yourself. Each challenge is checked from what the network is doing (its adjacencies, databases, tables, the traffic it carried, its configuration), not from what you clicked. Start over gives a fresh network.</p>
      <ol className="space-y-1">
        {spec.challenges.map((c, i) => {
          const ok = c.done(s);
          return (
            <li key={c.id} className={clsx("rounded-lg border px-2 py-1.5", ok ? "border-pv-success/50 bg-pv-success/[0.05]" : "border-pv-border")}>
              <p className={clsx("text-[12.5px] font-semibold", ok ? "text-pv-success" : "text-pv-text")}>
                {ok ? "✓" : `${i + 1}.`} {c.title}
              </p>
              <p className="text-[12px] text-pv-text-muted">{text(c.how)}</p>
              {!ok && (s.runs.length > 0 || s.cfgSeq > 0) && <p className="mt-0.5 text-[12px] text-pv-warning">Not yet: {text(c.next(s))}</p>}
            </li>
          );
        })}
      </ol>
      <Pill onClick={() => resetNet()}>Start over</Pill>
    </div>
  );
  const deviceButtons = (
    <div className="flex flex-wrap gap-1">
      {spec.devices.map((d) => {
        const dev = spec.device(d, ctx);
        return (
          <button key={d} type="button" onClick={() => openWin(d)} className="rounded-md border border-pv-border px-2 py-0.5 text-[12px] font-semibold text-pv-text-muted hover:border-pv-cyan/60 hover:text-pv-text">
            <span style={{ color: dev.tone }}>{dev.icon}</span> {dev.label}
          </button>
        );
      })}
    </div>
  );
  const engBoard = (
    <div className="space-y-3">
      <div role="tablist" className="flex flex-wrap gap-1">
        {(
          [
            ["investigate", "Investigate"],
            ["challenges", "Challenges"],
            ["troubleshoot", "Troubleshoot"],
          ] as const
        ).map(([m, label]) => (
          <button key={m} type="button" role="tab" aria-selected={engTab === m} onClick={() => (setEngTab(m), setGuess(undefined), setFound(false), setRungs({}), resetNet())} className={clsx("rounded-lg border px-3 py-1 text-[12.5px] font-semibold", engTab === m ? "border-pv-violet bg-pv-violet/15 text-pv-text" : "border-pv-border text-pv-text-muted hover:text-pv-text")}>
            {label}
          </button>
        ))}
      </div>
      <div className="space-y-1.5">
        <p className="text-[12px] text-pv-text-muted">Click a router on the topology (or here) to open it in its own window.</p>
        {deviceButtons}
      </div>
      {engTab === "troubleshoot" && troubleshootBoard}
      {engTab === "challenges" && challengesBoard}
      {spec.composer(ctx)}
      {engTab === "investigate" && (
        <div className="space-y-2 text-[13px] text-pv-text-muted">
          <p>The same network, yours. Things worth proving with evidence:</p>
          <ul className="list-disc space-y-0.5 pl-5 text-[12.5px]">
            {spec.investigate.map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ul>
          <Pill onClick={() => resetNet()}>Fresh network</Pill>
        </div>
      )}
      {P.run && (
        <details open className="rounded-xl border border-pv-border p-2">
          <summary className="cursor-pointer text-[12px] font-semibold text-pv-text">Run: {text(P.run.cmd)}</summary>
          <div className="mt-2 space-y-2">
            {momentPanel}
            {done && spec.runCard?.(ctx, done)}
          </div>
        </details>
      )}
    </div>
  );

  // ---------------------------------------------------------------- Tools (right column)
  const liveState = (
    <div className="space-y-2">
      <div role="tablist" className="flex flex-wrap items-center gap-1">
        {spec.tools.map((x) => (
          <button key={x.id} type="button" role="tab" aria-selected={tool === x.id} onClick={() => setTool(x.id)} className={clsx("rounded-md px-2.5 py-0.5 text-[12px] font-semibold", tool === x.id ? "bg-pv-cyan/15 text-pv-text" : "text-pv-text-muted hover:text-pv-text")}>
            {x.label}
          </button>
        ))}
        <span className="flex-1" />
        {VENDORS.length > 1 && (
          <div className="flex rounded-full border border-pv-border p-0.5 text-[11px]" aria-label="Vendor view">
            {VENDORS.map((x) => (
              <button key={x} type="button" aria-pressed={vendor === x} onClick={() => setVendor(x)} className={clsx("rounded-full px-2 py-0.5 font-semibold", vendor === x ? "bg-pv-cyan/20 text-pv-text" : "text-pv-text-faint")}>
                {x === "cisco" ? "IOS XR" : "Junos"}
              </button>
            ))}
          </div>
        )}
      </div>
      {spec.tools.find((x) => x.id === tool)?.render(ctx)}
    </div>
  );

  return (
    <PracticeLabShell
      open={open}
      onClose={onClose}
      title={spec.title}
      sandboxNote={eng ? "Engineering workspace · sandbox, no progress" : `${spec.note(eng, level)} · sandbox, no progress`}
      onReset={reset}
      animate={animate}
      onToggleAnimate={() => setAnimate((a) => !a)}
      stages={[]}
      currentStage={0}
      primaryAction={learnAction}
      controls={playerControls}
      topology={topology}
      topologyClassName="h-[330px] sm:h-[clamp(330px,46vh,440px)]"
      topologyFooter={spec.footer?.(ctx)}
      eventStrip={
        <p className="truncate text-[11.5px] text-pv-text-muted" aria-live="polite">
          {text(caption)}
        </p>
      }
      board={
        <div className="space-y-3">
          {header}
          {mode === "learn" && learnBoard}
          {mode === "gate" && gateBoard}
          {eng && engBoard}
          <SpDesk windows={windows} setWindows={setWindows} focus={focus} setFocus={setFocus} device={(id) => spec.device(id, ctx)} render={(id) => spec.window(id, ctx)} />
        </div>
      }
      liveState={liveState}
      liveStateLabel={eng ? spec.toolsLabel.eng : spec.toolsLabel.learn}
      mobileTab={mobileTab}
      onMobileTabChange={setMobileTab}
      tabLabels={{ state: eng ? "Tools" : "State" }}
    />
  );
}
