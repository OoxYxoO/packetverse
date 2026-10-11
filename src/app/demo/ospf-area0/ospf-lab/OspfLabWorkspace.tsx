"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { clsx } from "clsx";
import { PracticeLabShell, type PracticeLabTab } from "@/components/practice-lab/PracticeLabShell";
import { LabEventLog } from "@/components/practice-lab/LabEventLog";
import type { CliVendor } from "@/lib/cli/types";
import type { CliQuestion } from "@/app/demo/dhcp-dns/dhcp-lab/dhcpBuildCli";
import type { ConsoleSession } from "@/app/demo/dhcp-dns/dhcp-lab/ConsoleTerminal";
import { HOST_IP, LINK_TEXT, OS_CAUSES, OS_LINKS, OS_TICKETS, createOsNet, osApply, osCauseFeedback, osClone, osLastRepro, osLookup, osProofs, osTicket, type OsAction, type OsCause, type OsDev, type OsRouter, type OsRun, type OsState, type OsTicketId } from "@/lib/sim-engine/scenarios/ospfNet";
import { OsTopology } from "./OsTopology";
import { CaptureView, OsDesk, capPoints, openOsWindow, type OsWin } from "./OsDevices";
import { Adjacencies, Card, Composer, Journey, PathTo, Spf, ladder } from "./OsPanels";
import { OS_LEVELS, type OsShow, type OsStep } from "./OsLearn";
import { OS_CHALLENGES } from "./osPractice";
import { OS_MOMENT_MS, OS_TRAVEL_MS, osMoments } from "./osMoments";
import { osVendorText } from "./osNames";
import type { OsCand, OsIosMode } from "./osCli";

type OsSnap = Record<string, never>;
/**
 * OSPF Lab — the shared practice-lab workspace (pinned topology, each run played hop by hop with Pause / Step / Skip /
 * Replay, the board below, the evidence on the right), with link-state routing content:
 *
 *   LEARN                  6 levels (OsLearn): routers that talk · becoming neighbors · one map for everyone · each
 *                          router computes its own paths · when something fails · what the router actually uses
 *   ENGINEERING WORKSPACE  Investigate (pings, traceroutes, Hellos, LSA floods, link and silent failures; R1–R4 windows
 *                          with the OSPF interface table, routes, LSDB, Cisco/Junos consoles, captures; host shells) ·
 *                          Challenges (six, checked from the network) · Troubleshoot (five tickets)
 *
 * One model (ospfNet.ts) computes adjacencies, LSDBs, SPF and routing tables and produces every hop and verdict.
 * Nothing here touches the guided lesson or the progress store.
 */

type Mode = "learn" | "gate" | "eng";
type EngTab = "investigate" | "challenges" | "troubleshoot";
type Tools = "tables" | "journey" | "captures" | "counters" | "log";
interface Player {
  run?: OsRun;
  base?: OsSnap;
  key: string;
  cursor: number;
  playing: boolean;
}
const IDLE: Player = { key: "idle", cursor: 0, playing: false };
let playSeq = 0;
const Pill = ({ children, onClick, disabled, tone }: { children: ReactNode; onClick: () => void; disabled?: boolean; tone?: "primary" }) => (
  <button type="button" onClick={onClick} disabled={disabled} className={clsx("rounded-full px-3 py-1 text-[12px] font-semibold disabled:opacity-40", tone === "primary" ? "bg-pv-cyan text-[#03131a] hover:bg-pv-cyan/90" : "border border-pv-border text-pv-text-muted hover:text-pv-text")}>
    {children}
  </button>
);
type Dev = OsRouter;
const IOS0: Record<Dev, OsIosMode> = { R1: { kind: "exec" }, R2: { kind: "exec" }, R3: { kind: "exec" }, R4: { kind: "exec" } };
const EDIT0: Record<Dev, boolean> = { R1: false, R2: false, R3: false, R4: false };
const NO_SNAP: OsSnap = {};
const candOf = (s: OsState): OsCand => osClone(s.cfg.r);
const buildStep = (t: OsStep, seq: number): OsState => (t.pre ?? []).reduce((acc, a) => osApply(acc, a), { ...createOsNet(), seq });

export function OspfLabWorkspace({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [mode, setMode] = useState<Mode>("learn");
  const [engTab, setEngTab] = useState<EngTab>("investigate");
  const [level, setLevel] = useState(0);
  const [step, setStep] = useState(0);
  const [unlocked, setUnlocked] = useState(0);
  const [s, setS] = useState<OsState>(() => buildStep(OS_LEVELS[0].steps[0], 0));
  const sRef = useRef(s);
  const [P, setP] = useState<Player>(IDLE);
  const [landedKey, setLandedKey] = useState("");
  const [animate, setAnimate] = useState(true);
  const [ranKey, setRanKey] = useState<string | undefined>(undefined);
  const [answer, setAnswer] = useState<string | undefined>(undefined);
  const [windows, setWindows] = useState<OsWin[]>([]);
  const [focus, setFocus] = useState<OsDev | undefined>(undefined);
  const [vendor, setVendor] = useState<CliVendor>("cisco");
  const [ios, setIosAll] = useState<Record<Dev, OsIosMode>>(IOS0);
  const [junosEdit, setJunosAll] = useState<Record<Dev, boolean>>(EDIT0);
  const [cand, setCand] = useState<OsCand>(() => candOf(s));
  const [consoles, setConsoles] = useState<Record<string, ConsoleSession>>({});
  const [question, setQuestion] = useState<CliQuestion | undefined>(undefined);
  const [notes, setNotes] = useState(true);
  const [guess, setGuess] = useState<OsCause | undefined>(undefined);
  // The feedback as it was when the student chose: it must not change once they start fixing the fault.
  const [guessFb, setGuessFb] = useState<ReturnType<typeof osCauseFeedback> | undefined>(undefined);
  const [found, setFound] = useState(false);
  const [rungs, setRungs] = useState<Record<string, boolean>>({});
  const [tools, setTools] = useState<Tools>("tables");
  const [mobileTab, setMobileTab] = useState<PracticeLabTab>("topology");
  const [ticketSeq, setTicketSeq] = useState(0);

  // ---------------------------------------------------------------- Playback (one moment per wave)
  const moments = useMemo(() => osMoments(P.run), [P.run]);
  const n = moments.length;
  const playingPlan = !!P.run && P.cursor < n;
  const curKey = `${P.key}:${P.cursor}`;
  useEffect(() => {
    if (!P.playing || !P.run || P.cursor >= n) return;
    const t = window.setTimeout(() => setP((p) => (p.key !== P.key ? p : p.cursor + 1 >= n ? { ...p, cursor: n, playing: false } : { ...p, cursor: p.cursor + 1 })), OS_MOMENT_MS);
    return () => window.clearTimeout(t);
  }, [P, n]);
  useEffect(() => {
    if (!playingPlan) return;
    const k = curKey;
    const t = window.setTimeout(() => setLandedKey(k), OS_TRAVEL_MS);
    return () => window.clearTimeout(t);
  }, [curKey, playingPlan]);
  const landed = landedKey === curKey;
  const show = useCallback(
    (run: OsRun, base: OsSnap) => {
      setP({ run, base, key: `r${run.id}-${++playSeq}`, cursor: animate ? 0 : osMoments(run).length, playing: animate });
    },
    [animate],
  );
  const pause = () => setP((p) => ({ ...p, playing: false }));
  const play = () => setP((p) => ({ ...p, playing: true }));
  const stepOnce = () => setP((p) => (p.cursor < n ? { ...p, cursor: p.cursor + 1, playing: false } : p));
  const skip = () => setP((p) => ({ ...p, cursor: n, playing: false }));
  const replay = () => setP((p) => (p.run ? { ...p, key: `${p.key}+`, cursor: 0, playing: true } : p));
  const moment = playingPlan ? moments[P.cursor] : undefined;
  const prevMoment = P.cursor > 0 ? moments[Math.min(P.cursor, n) - 1] : undefined;
  void landed;

  const act = useCallback(
    (a: OsAction) => {
      const before = sRef.current;
      const nx = osApply(before, a);
      sRef.current = nx;
      setS(nx);
      if (a.type !== "traffic" && a.type !== "hello" && a.type !== "flood" && a.type !== "wait") setCand(candOf(nx));
      if (nx.last && nx.last !== before.last) show(nx.last, NO_SNAP);
      return nx;
    },
    [show],
  );
  const openWin = (d: OsDev) => {
    setWindows((ws) => openOsWindow(ws, d));
    setFocus(d);
  };
  const resetNet = (start?: OsState) => {
    const ns: OsState = start ?? { ...createOsNet(), seq: sRef.current.seq + 1 };
    sRef.current = ns;
    setS(ns);
    setP(IDLE);
    setCand(candOf(ns));
    setIosAll(IOS0);
    setJunosAll(EDIT0);
    setQuestion(undefined);
  };

  // ---------------------------------------------------------------- Learn
  const lv = OS_LEVELS[level];
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
    resetNet(buildStep(OS_LEVELS[li].steps[si], sRef.current.seq + 1));
  };
  const runStep = (r: NonNullable<OsStep["runs"]>[number]) => {
    if (!r.keep) resetNet(buildStep(st, sRef.current.seq + 1));
    r.actions.forEach((a) => act(a));
    setRanKey(stepKey);
  };
  const nextStep = () => {
    if (!stepDone) return;
    if (step + 1 < lv.steps.length) return enterStep(level, step + 1);
    if (level + 1 < OS_LEVELS.length) {
      setUnlocked((u) => Math.max(u, level + 1));
      return enterStep(level + 1, 0);
    }
    setP((p) => ({ ...p, cursor: n, playing: false }));
    setMode("gate");
  };
  const toEngineering = () => {
    setUnlocked(OS_LEVELS.length - 1);
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
    setVendor("cisco");
    setConsoles({});
    setGuess(undefined);
    setFound(false);
    setRungs({});
    setTools("tables");
    if (mode === "learn") enterStep(level, step);
    else resetNet();
  };

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
    const last = level + 1 >= OS_LEVELS.length && step + 1 >= lv.steps.length;
    return (
      <Pill onClick={nextStep} disabled={!stepDone} tone="primary">
        {step + 1 < lv.steps.length ? "Next →" : last ? "I've finished learning →" : compact ? `Level ${level + 2} →` : `Level ${level + 2}: ${OS_LEVELS[level + 1].title} →`}
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
        hop {Math.min(P.cursor + (playingPlan ? 1 : 0), n)}/{n}
      </span>
    </div>
  );

  // ---------------------------------------------------------------- Topology
  const eng = mode === "eng";
  const clickable = eng || level >= 1;
  const topologyFor = (compact: boolean) => <OsTopology s={s} moment={moment} prev={prevMoment} runKey={P.key} cursor={P.cursor} compact={compact} onNode={clickable ? openWin : undefined} selected={focus} vendor={vendor} />;
  const topology = (
    <>
      <div className="h-full sm:hidden">{topologyFor(true)}</div>
      <div className="hidden h-full sm:block">{topologyFor(false)}</div>
    </>
  );
  const r14 = osLookup(s.view, "R1", HOST_IP.H4);
  const footer = (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11.5px] text-pv-text-muted">
      <span>
        neighbors: {OS_LINKS.map((l) => (
          <b key={l} className={clsx("pv-mono mr-1", s.view.adj[l].state === "FULL" && s.cfg.links[l] ? "text-pv-success" : s.cfg.links[l] ? "text-pv-danger" : "text-pv-text-faint")}>
            {LINK_TEXT[l]} {s.cfg.links[l] ? s.view.adj[l].state : "cut"}
          </b>
        ))}
      </span>
      <span>
        R1 → H4&apos;s LAN: <b className="pv-mono text-pv-text">{r14 ? `${r14.proto === "O" ? "OSPF" : r14.proto === "S" ? "STATIC" : "C"} [${r14.ad}/${r14.metric}] via ${r14.hops.map((h) => h.nh).join(" + ")}` : "no route"}</b>
      </span>
      <span className="text-pv-text-faint">lab clock {s.clock - 10800} s</span>
    </div>
  );
  const caption = moment ? moment.lines.map((l) => l.text).join(" · ") : (s.log[s.log.length - 1]?.text ?? "");
  const momentPanel = P.run && (moment || prevMoment) && (
    <div className="space-y-1">
      {(moment ?? prevMoment)!.lines.slice(0, 8).map((l, i) => (
        <p key={`${P.key}${P.cursor}${i}`} className={clsx("pv-pop rounded-lg border px-2 py-1 text-[12.5px]", l.tone === "bad" ? "border-pv-danger/40 bg-pv-danger/[0.06] text-pv-text" : l.tone === "ok" ? "border-pv-success/40 bg-pv-success/[0.06] text-pv-text" : l.tone === "learn" ? "border-pv-violet/40 bg-pv-violet/[0.06] text-pv-text" : "border-pv-cyan/30 bg-pv-cyan/[0.04] text-pv-text")} style={{ animationDelay: `${moment ? OS_TRAVEL_MS * 0.6 + i * 90 : i * 60}ms` }}>
          {osVendorText(vendor, l.text)}
        </p>
      ))}
      {(moment ?? prevMoment)!.lines.length > 8 && <p className="text-[11.5px] text-pv-text-faint">… and {(moment ?? prevMoment)!.lines.length - 8} more things happened in this hop.</p>}
    </div>
  );

  // ---------------------------------------------------------------- Evidence blocks a step asks for
  const done = P.run && !playingPlan ? P.run : undefined;
  const wait = <p className="rounded-xl border border-pv-border p-2 text-[12px] text-pv-text-muted">The evidence appears when the run has finished — let it play, or press Skip to end.</p>;
  const evidence = (what: OsShow[]) => (
    <div className="space-y-2">
      {what.includes("adj") && (
        <Card title="Neighbors on every link">
          <Adjacencies s={s} vendor={vendor} />
        </Card>
      )}
      {what.includes("spf") && (
        <Card title="SPF: each router's shortest paths">
          <Spf s={s} vendor={vendor} />
        </Card>
      )}
      {what.includes("path") && (
        <Card title="Every router's route to a LAN">
          <PathTo s={s} vendor={vendor} />
        </Card>
      )}
      {P.run && playingPlan && what.includes("journey") && wait}
      {done && what.includes("journey") && (
        <Card title="Every decision, hop by hop">
          <Journey run={done} vendor={vendor} />
        </Card>
      )}
    </div>
  );

  // ---------------------------------------------------------------- Boards
  const header = (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1">
        {OS_LEVELS.map((l, li) => (
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
      {evidence(st.show)}
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
        {(step > 0 || level > 0) && <Pill onClick={() => (step > 0 ? enterStep(level, step - 1) : enterStep(level - 1, OS_LEVELS[level - 1].steps.length - 1))}>← Back</Pill>}
        <span className="flex-1" />
        {learnAction(false)}
      </div>
    </div>
  );
  const gateBoard = (
    <div className="space-y-3 rounded-2xl border border-pv-violet/50 bg-pv-violet/[0.05] p-4">
      <h3 className="text-[16px] font-bold text-pv-text">You can read a link-state network</h3>
      <ul className="list-disc space-y-1 pl-5 text-[13px] text-pv-text-muted">
        <li>OSPF routers become neighbors through Hellos — same area and timers, not passive; FULL also needs the same MTU.</li>
        <li>Each router floods a Router-LSA describing its links and networks; every router in the area holds the same database.</li>
        <li>Each router runs SPF on that map from its own position: the cheapest total of outgoing interface costs wins; equal totals share the load.</li>
        <li>A link down reconverges at once; a silent neighbor only after the dead interval.</li>
        <li>The routing table uses the longest match, then the lowest administrative distance: a static route beats OSPF; an unadvertised LAN has no route at all.</li>
      </ul>
      <p className="text-[13px] text-pv-text-muted">The engineering workspace gives you R1–R4 in their own windows (the OSPF interface table, routes, LSDB, Cisco/Junos consoles, captures of Hellos, LSUs and pings), the four hosts with a Linux shell, six challenges and five tickets to solve from evidence.</p>
      <div className="flex flex-wrap gap-2">
        <Pill onClick={toEngineering} tone="primary">
          Enter the engineering workspace →
        </Pill>
        <Pill onClick={() => toLearn(OS_LEVELS.length - 1)}>Review level 6</Pill>
      </div>
    </div>
  );

  // Troubleshoot
  const t = s.ticket ? osTicket(s.ticket) : undefined;
  const proofs = osProofs(s);
  const solved = !!t && proofs.every((p) => p.ok);
  const fb = guess ? guessFb : undefined;
  const repro = osLastRepro(s);
  const startTicket = (id: OsTicketId) => {
    setWindows([]);
    setConsoles({});
    setGuess(undefined);
    setFound(false);
    setRungs({});
    setP(IDLE);
    setTicketSeq(act({ type: "ticket", id }).seq);
  };
  const reproduced = !!t && s.runs.length > 0 && ticketSeq >= 0;
  const phase = !t ? 0 : !reproduced ? 1 : !found ? 2 : !solved ? 3 : 4;
  const troubleshootBoard = (
    <div className="space-y-3">
      {!t ? (
        <>
          <p className="text-[13px] text-pv-text-muted">Users report symptoms, not causes. Each ticket is this network after a normal morning of traffic, with one real thing wrong. Reproduce it, check neighbors, databases, SPF results and what the routing table actually uses, name the cause, fix it on the device, and prove it with fresh traffic.</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {OS_TICKETS.map((x) => (
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
            <Pill onClick={() => (resetNet(), setGuess(undefined), setFound(false))}>All tickets</Pill>
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
              <p className="text-[13px] text-pv-text-muted">See it yourself first: {t.reproLabel} — and watch where the frames go.</p>
              <Pill onClick={() => t.repro.forEach((a) => act(a))} disabled={playingPlan} tone="primary">
                Reproduce it ▶
              </Pill>
            </div>
          )}
          {phase >= 2 && (
            <div className="space-y-1.5">
              <p className="text-[13px] text-pv-text-muted">Walk the evidence in order — open each question once you&apos;ve looked (neighbors, the LSDB, SPF, routing tables, the consoles):</p>
              <div className="grid gap-1">
                {ladder(s, vendor, repro).map((r, i) => (
                  <div key={r.k} className="rounded-lg border border-pv-border/70 px-2 py-1">
                    <button type="button" onClick={() => setRungs((m) => ({ ...m, [r.k]: !m[r.k] }))} className="flex w-full items-center gap-2 text-left">
                      <span className="text-[11px] text-pv-text-faint">{i + 1}</span>
                      <span className="flex-1 text-[12.5px] font-semibold text-pv-text">{r.title}</span>
                      <span className="text-[11px] text-pv-cyan-soft">{rungs[r.k] ? "hide" : "check"}</span>
                    </button>
                    {rungs[r.k] && <p className="mt-0.5 text-[12px] leading-snug text-pv-text-muted">{r.text}</p>}
                  </div>
                ))}
              </div>
              <p className="pt-1 text-[13px] text-pv-text-muted">{found ? "Diagnosis:" : "What explains all of it? A wrong choice gets the evidence that rules it out."}</p>
              <div className="grid gap-1">
                {OS_CAUSES.map((c) => {
                  const picked = guess === c.id;
                  if (found && !picked) return null;
                  return (
                    <div key={c.id}>
                      <button
                        type="button"
                        disabled={found}
                        onClick={() => {
                          const f = osCauseFeedback(s, c.id);
                          setGuess(c.id);
                          setGuessFb(f);
                          if (f.right) setFound(true);
                        }}
                        className={clsx("w-full rounded-lg border px-2 py-1 text-left text-[12.5px]", picked ? (fb?.right ? "border-pv-success/60 bg-pv-success/10 text-pv-text" : "border-pv-warning/50 text-pv-text-muted") : "border-pv-border text-pv-text hover:border-pv-violet/60")}
                      >
                        {picked ? (fb?.right ? "✓ " : "✗ ") : ""}
                        {c.label}
                      </button>
                      {picked && fb && (
                        <p className={clsx("px-2 py-1 text-[12px]", fb.right ? "text-pv-success" : "text-pv-text-muted")}>
                          {!fb.right && <b className="text-pv-warning">{fb.consequence ? "A consequence, not the cause. " : "Not the cause. "}</b>}
                          {osVendorText(vendor, fb.text)}
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
              <p className="text-[13px] font-semibold text-pv-text">{solved ? "Proved" : "Fix it, check the devices, then prove it with traffic"}</p>
              {!solved && <p className="text-[12.5px] text-pv-text-muted">Change it on the device (its window, or its console — Junos needs a commit), check the devices&apos; own state (show ip ospf neighbor / show ip route · show ospf neighbor / show route), then run the user&apos;s test again. An accepted command isn&apos;t a repaired network.</p>}
              <ul className="space-y-0.5">
                {proofs.map((p) => (
                  <li key={p.label} className={clsx("text-[12.5px]", p.ok ? "text-pv-success" : "text-pv-text-muted")}>
                    {p.ok ? "✓" : "○"} {osVendorText(vendor, p.label)} <span className="text-[11.5px] text-pv-text-faint">— {osVendorText(vendor, p.detail)}</span>
                  </li>
                ))}
              </ul>
              {!solved && (
                <Pill onClick={() => t.repro.forEach((a) => act(a))} disabled={playingPlan}>
                  ▶ Run the user&apos;s test again
                </Pill>
              )}
              {solved && (
                <p className="text-[12.5px] text-pv-text">
                  Ticket closed with evidence. <Pill onClick={() => (resetNet(), setGuess(undefined), setFound(false))}>Next ticket</Pill>
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
      <p className="text-[13px] text-pv-text-muted">Operate the network yourself. Each challenge is checked from what the network did — the frames it carried, where they were captured, its configuration — not from what you clicked. Start over gives a fresh network.</p>
      <ol className="space-y-1">
        {OS_CHALLENGES.map((c, i) => {
          const ok = c.done(s);
          return (
            <li key={c.id} className={clsx("rounded-lg border px-2 py-1.5", ok ? "border-pv-success/50 bg-pv-success/[0.05]" : "border-pv-border")}>
              <p className={clsx("text-[12.5px] font-semibold", ok ? "text-pv-success" : "text-pv-text")}>
                {ok ? "✓" : `${i + 1}.`} {c.title}
              </p>
              <p className="text-[12px] text-pv-text-muted">{osVendorText(vendor, c.how)}</p>
              {!ok && (s.runs.length > 0 || s.cfgSeq > 0) && <p className="mt-0.5 text-[12px] text-pv-warning">Not yet: {osVendorText(vendor, c.next(s))}</p>}
            </li>
          );
        })}
      </ol>
      <Pill onClick={() => resetNet()}>Start over</Pill>
    </div>
  );
  const deviceButtons = (
    <div className="flex flex-wrap gap-1">
      {(["R1", "R2", "R3", "R4", "H1", "H2", "H3", "H4"] as OsDev[]).map((d) => (
        <button key={d} type="button" onClick={() => openWin(d)} className="rounded-md border border-pv-border px-2 py-0.5 text-[12px] font-semibold text-pv-text-muted hover:border-pv-cyan/60 hover:text-pv-text">
          {d.startsWith("R") ? `R ${d}` : `💻 ${d}`}
        </button>
      ))}
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
        <p className="text-[12px] text-pv-text-muted">Click a device on the topology (or here) to open it in its own window.</p>
        {deviceButtons}
      </div>
      {engTab === "troubleshoot" && troubleshootBoard}
      {engTab === "challenges" && challengesBoard}
      <Composer s={s} act={(a) => act(a)} busy={playingPlan} />
      {engTab === "investigate" && (
        <div className="space-y-2 text-[13px] text-pv-text-muted">
          <p>The same network, yours. Things worth proving with evidence:</p>
          <ul className="list-disc space-y-0.5 pl-5 text-[12.5px]">
            <li>Send Hellos and capture on R2 ge-0/0/1: what is in a Hello, and what changes when you put one end in area 1?</li>
            <li>Raise one cost and predict the new path from H1 to H4 before you traceroute. Then look at the way back.</li>
            <li>Cut a link and show the flood: which routers changed their LSA?</li>
            <li>Fail a link silently and watch show ip ospf neighbor for 40 s.</li>
            <li>Add a static route on R1 and read show ip route 192.168.4.10 — on Cisco and on Junos (preference 5 vs 10).</li>
          </ul>
          <Pill onClick={() => resetNet()}>Fresh network</Pill>
        </div>
      )}
      {P.run && (
        <details open className="rounded-xl border border-pv-border p-2">
          <summary className="cursor-pointer text-[12px] font-semibold text-pv-text">Run: {P.run.cmd}</summary>
          <div className="mt-2 space-y-2">
            {momentPanel}
            {done && (
              <>
                <Card title="Every decision, hop by hop">
                  <Journey run={done} vendor={vendor} />
                </Card>
              </>
            )}
          </div>
        </details>
      )}
    </div>
  );

  // ---------------------------------------------------------------- Tools (right column)
  const liveState = (
    <div className="space-y-2">
      <div role="tablist" className="flex flex-wrap items-center gap-1">
        {(
          [
            ["tables", "Tables"],
            ["journey", "Journey"],
            ["captures", "Captures"],
            ["log", "Log"],
          ] as const
        ).map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tools === k} onClick={() => setTools(k)} className={clsx("rounded-md px-2.5 py-0.5 text-[12px] font-semibold", tools === k ? "bg-pv-cyan/15 text-pv-text" : "text-pv-text-muted hover:text-pv-text")}>
            {label}
          </button>
        ))}
        <span className="flex-1" />
        <div className="flex rounded-full border border-pv-border p-0.5 text-[11px]" aria-label="Port names">
          {(["cisco", "juniper"] as const).map((x) => (
            <button key={x} type="button" aria-pressed={vendor === x} onClick={() => setVendor(x)} className={clsx("rounded-full px-2 py-0.5 font-semibold", vendor === x ? "bg-pv-cyan/20 text-pv-text" : "text-pv-text-faint")}>
              {x === "cisco" ? "Cisco" : "Junos"}
            </button>
          ))}
        </div>
      </div>
      {tools === "tables" && (
        <div className="space-y-2">
          <Card title="Neighbors on every link">
            <Adjacencies s={s} vendor={vendor} />
          </Card>
          <Card title="Every router's route to a LAN">
            <PathTo s={s} vendor={vendor} />
          </Card>
          <Card title="SPF: each router's shortest paths">
            <Spf s={s} vendor={vendor} />
          </Card>
        </div>
      )}
      {tools === "journey" && (playingPlan ? wait : s.last ? <Journey run={s.last} vendor={vendor} max={80} /> : <p className="text-[12.5px] text-pv-text-faint">Send something first.</p>)}
      {tools === "captures" &&
        (playingPlan ? (
          wait
        ) : (
          <div className="-mx-3 rounded-xl border border-pv-border">
            <CaptureView key={s.seq} s={s} points={capPoints()} initial="R1 ge-0/0/1" vendor={vendor} />
          </div>
        ))}
      {tools === "log" && <LabEventLog entries={[...s.log].reverse().slice(0, 80).map((l, i) => ({ id: s.log.length - i, tag: `#${l.seq}`, text: osVendorText(vendor, l.text), kind: l.tone === "warn" ? "warning" : l.tone === "ok" ? "learn" : "info" }))} title="Lab log" />}
    </div>
  );

  const setIos = (d: Dev, m: OsIosMode) => setIosAll((x) => ({ ...x, [d]: m }));
  const setJunosEdit = (d: Dev, b: boolean) => setJunosAll((x) => ({ ...x, [d]: b }));
  const ctx = { view: s, act, vendor, setVendor, ios, setIos, junosEdit, setJunosEdit, cand, setCand, consoles, setConsoles, notes, setNotes, question, setQuestion };

  return (
    <PracticeLabShell
      open={open}
      onClose={onClose}
      title="OSPF Lab"
      sandboxNote={eng ? "Engineering workspace · sandbox, no progress" : "R1–R4 diamond · area 0 · sandbox, no progress"}
      onReset={reset}
      animate={animate}
      onToggleAnimate={() => setAnimate((a) => !a)}
      stages={[]}
      currentStage={0}
      primaryAction={learnAction}
      controls={playerControls}
      topology={topology}
      topologyClassName="h-[320px] sm:h-[clamp(320px,44vh,420px)]"
      topologyFooter={footer}
      eventStrip={<p className="truncate text-[11.5px] text-pv-text-muted" aria-live="polite">{osVendorText(vendor, caption)}</p>}
      board={
        <div className="space-y-3">
          {header}
          {mode === "learn" && learnBoard}
          {mode === "gate" && gateBoard}
          {eng && engBoard}
          <OsDesk windows={windows} setWindows={setWindows} focus={focus} setFocus={setFocus} ctx={ctx} />
        </div>
      }
      liveState={liveState}
      liveStateLabel={eng ? "Tools" : "The routing"}
      mobileTab={mobileTab}
      onMobileTabChange={setMobileTab}
      tabLabels={{ state: eng ? "Tools" : "Routing" }}
    />
  );
}
