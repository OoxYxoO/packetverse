"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { clsx } from "clsx";
import { PracticeLabShell, type PracticeLabTab } from "@/components/practice-lab/PracticeLabShell";
import { LabEventLog } from "@/components/practice-lab/LabEventLog";
import type { CliVendor } from "@/lib/cli/types";
import type { CliQuestion } from "@/app/demo/dhcp-dns/dhcp-lab/dhcpBuildCli";
import type { ConsoleSession } from "@/app/demo/dhcp-dns/dhcp-lab/ConsoleTerminal";
import { FW_CAUSES, FW_TICKETS, createFwNet, fwApply, fwCauseFeedback, fwClone, fwLastRepro, fwProofs, fwTicket, type FwAction, type FwCause, type FwDev, type FwNet, type FwRule, type FwRun, type FwTicketId } from "@/lib/sim-engine/scenarios/fwNet";
import { FwTopology } from "./FwTopology";
import { CaptureView, FwDesk, capPoints, openFwWindow, type FwWin } from "./FwDevices";
import { Card, Composer, Journey, NatView, Pipeline, Policies, Sessions, ladder } from "./FwPanels";
import { FW_LEVELS, type FwShow, type FwStep } from "./FwLearn";
import { FW_CHALLENGES } from "./fwPractice";
import { FW_MOMENT_MS, FW_TRAVEL_MS, fwMoments } from "./fwMoments";
import { fwVendorText } from "./fwNames";
import type { FwCand, FwIosMode } from "./fwCli";

type FwSnap = Record<string, never>;
/**
 * Firewall Lab — the shared practice-lab workspace (pinned topology, each run played hop by hop with Pause / Step /
 * Skip / Replay, the board below, the evidence on the right), with stateful-firewall content:
 *
 *   LEARN                  6 levels (FwLearn): a router that decides · rules in order · sessions · source NAT ·
 *                          publishing a server · reading a firewall path
 *   ENGINEERING WORKSPACE  Investigate (connections, pings, stray segments; FW1 window with the policy editor, NAT,
 *                          sessions, logs, Cisco IOS zone-based firewall / Junos SRX console, per-interface captures;
 *                          the ISP's looking glass; host shells) · Challenges (six, checked from the network) ·
 *                          Troubleshoot (five tickets)
 *
 * One model (fwNet.ts) runs FW1's pipeline (session → destination NAT → route → policy → source NAT → session) and
 * every host's TCP stack, and produces every hop and verdict. Nothing here touches the guided lesson or progress.
 */

type Mode = "learn" | "gate" | "eng";
type EngTab = "investigate" | "challenges" | "troubleshoot";
type Tools = "tables" | "journey" | "captures" | "counters" | "log";
interface Player {
  run?: FwRun;
  base?: FwSnap;
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
const IOS0: FwIosMode = { kind: "exec" };
const NO_SNAP: FwSnap = {};
const candOf = (s: FwNet): FwCand => fwClone(s.cfg);
const buildStep = (t: FwStep, seq: number): FwNet => (t.pre ?? []).reduce((acc, a) => fwApply(acc, a), { ...createFwNet(), seq });

export function FirewallLabWorkspace({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [mode, setMode] = useState<Mode>("learn");
  const [engTab, setEngTab] = useState<EngTab>("investigate");
  const [level, setLevel] = useState(0);
  const [step, setStep] = useState(0);
  const [unlocked, setUnlocked] = useState(0);
  const [s, setS] = useState<FwNet>(() => buildStep(FW_LEVELS[0].steps[0], 0));
  const sRef = useRef(s);
  const [P, setP] = useState<Player>(IDLE);
  const [landedKey, setLandedKey] = useState("");
  const [animate, setAnimate] = useState(true);
  const [ranKey, setRanKey] = useState<string | undefined>(undefined);
  const [answer, setAnswer] = useState<string | undefined>(undefined);
  const [windows, setWindows] = useState<FwWin[]>([]);
  const [focus, setFocus] = useState<FwDev | undefined>(undefined);
  const [vendor, setVendor] = useState<CliVendor>("cisco");
  const [ios, setIos] = useState<FwIosMode>(IOS0);
  const [junosEdit, setJunosEdit] = useState(false);
  const [spare, setSpare] = useState<FwRule[]>([]);
  const [cand, setCand] = useState<FwCand>(() => candOf(s));
  const [consoles, setConsoles] = useState<Record<string, ConsoleSession>>({});
  const [question, setQuestion] = useState<CliQuestion | undefined>(undefined);
  const [notes, setNotes] = useState(true);
  const [guess, setGuess] = useState<FwCause | undefined>(undefined);
  // The feedback as it was when the student chose: it must not change once they start fixing the fault.
  const [guessFb, setGuessFb] = useState<ReturnType<typeof fwCauseFeedback> | undefined>(undefined);
  const [found, setFound] = useState(false);
  const [rungs, setRungs] = useState<Record<string, boolean>>({});
  const [tools, setTools] = useState<Tools>("tables");
  const [mobileTab, setMobileTab] = useState<PracticeLabTab>("topology");
  const [ticketSeq, setTicketSeq] = useState(0);

  // ---------------------------------------------------------------- Playback (one moment per wave)
  const moments = useMemo(() => fwMoments(P.run), [P.run]);
  const n = moments.length;
  const playingPlan = !!P.run && P.cursor < n;
  const curKey = `${P.key}:${P.cursor}`;
  useEffect(() => {
    if (!P.playing || !P.run || P.cursor >= n) return;
    const t = window.setTimeout(() => setP((p) => (p.key !== P.key ? p : p.cursor + 1 >= n ? { ...p, cursor: n, playing: false } : { ...p, cursor: p.cursor + 1 })), FW_MOMENT_MS);
    return () => window.clearTimeout(t);
  }, [P, n]);
  useEffect(() => {
    if (!playingPlan) return;
    const k = curKey;
    const t = window.setTimeout(() => setLandedKey(k), FW_TRAVEL_MS);
    return () => window.clearTimeout(t);
  }, [curKey, playingPlan]);
  const landed = landedKey === curKey;
  const show = useCallback(
    (run: FwRun, base: FwSnap) => {
      setP({ run, base, key: `r${run.id}-${++playSeq}`, cursor: animate ? 0 : fwMoments(run).length, playing: animate });
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
    (a: FwAction) => {
      const before = sRef.current;
      const nx = fwApply(before, a);
      sRef.current = nx;
      setS(nx);
      if (a.type === "cfg" || a.type === "ticket" || a.type === "fresh") setCand(candOf(nx));
      if (nx.last && nx.last !== before.last) show(nx.last, NO_SNAP);
      return nx;
    },
    [show],
  );
  const openWin = (d: FwDev) => {
    setWindows((ws) => openFwWindow(ws, d));
    setFocus(d);
  };
  const resetNet = (start?: FwNet) => {
    const ns: FwNet = start ?? { ...createFwNet(), seq: sRef.current.seq + 1 };
    sRef.current = ns;
    setS(ns);
    setP(IDLE);
    setCand(candOf(ns));
    setIos(IOS0);
    setJunosEdit(false);
    setSpare([]);
    setQuestion(undefined);
  };

  // ---------------------------------------------------------------- Learn
  const lv = FW_LEVELS[level];
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
    resetNet(buildStep(FW_LEVELS[li].steps[si], sRef.current.seq + 1));
  };
  const runStep = (r: NonNullable<FwStep["runs"]>[number]) => {
    if (!r.keep) resetNet(buildStep(st, sRef.current.seq + 1));
    r.actions.forEach((a) => act(a));
    setRanKey(stepKey);
  };
  const nextStep = () => {
    if (!stepDone) return;
    if (step + 1 < lv.steps.length) return enterStep(level, step + 1);
    if (level + 1 < FW_LEVELS.length) {
      setUnlocked((u) => Math.max(u, level + 1));
      return enterStep(level + 1, 0);
    }
    setP((p) => ({ ...p, cursor: n, playing: false }));
    setMode("gate");
  };
  const toEngineering = () => {
    setUnlocked(FW_LEVELS.length - 1);
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
    const last = level + 1 >= FW_LEVELS.length && step + 1 >= lv.steps.length;
    return (
      <Pill onClick={nextStep} disabled={!stepDone} tone="primary">
        {step + 1 < lv.steps.length ? "Next →" : last ? "I've finished learning →" : compact ? `Level ${level + 2} →` : `Level ${level + 2}: ${FW_LEVELS[level + 1].title} →`}
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
  const topologyFor = (compact: boolean) => <FwTopology s={s} moment={moment} prev={prevMoment} runKey={P.key} cursor={P.cursor} compact={compact} onNode={clickable ? openWin : undefined} selected={focus} vendor={vendor} />;
  const topology = (
    <>
      <div className="h-full sm:hidden">{topologyFor(true)}</div>
      <div className="hidden h-full sm:block">{topologyFor(false)}</div>
    </>
  );
  const lastR = s.last?.results[0];
  const footer = (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11.5px] text-pv-text-muted">
      <span>
        sessions: <b className="pv-mono text-pv-text">{s.sessions.filter((x) => x.state !== "CLOSED").length}</b> ({s.sessions.filter((x) => x.state === "ESTABLISHED").length} established)
      </span>
      {lastR && (
        <span>
          last: <b className={clsx("pv-mono", lastR.ok ? "text-pv-success" : "text-pv-danger")}>{lastR.outcome}</b>
        </span>
      )}
      <span>log: {s.fwlog.filter((l) => l.kind !== "create" && l.kind !== "close").length} drops</span>
    </div>
  );
  const caption = moment ? moment.lines.map((l) => l.text).join(" · ") : (s.log[s.log.length - 1]?.text ?? "");
  const momentPanel = P.run && (moment || prevMoment) && (
    <div className="space-y-1">
      {(moment ?? prevMoment)!.lines.slice(0, 10).map((l, i) => (
        <p key={`${P.key}${P.cursor}${i}`} className={clsx("pv-pop rounded-lg border px-2 py-1 text-[12.5px]", l.tone === "bad" ? "border-pv-danger/40 bg-pv-danger/[0.06] text-pv-text" : l.tone === "ok" ? "border-pv-success/40 bg-pv-success/[0.06] text-pv-text" : l.tone === "learn" ? "border-pv-violet/40 bg-pv-violet/[0.06] text-pv-text" : "border-pv-cyan/30 bg-pv-cyan/[0.04] text-pv-text")} style={{ animationDelay: `${moment ? FW_TRAVEL_MS * 0.6 + i * 90 : i * 60}ms` }}>
          {fwVendorText(vendor, l.text)}
        </p>
      ))}
      {(moment ?? prevMoment)!.lines.length > 10 && <p className="text-[11.5px] text-pv-text-faint">… and {(moment ?? prevMoment)!.lines.length - 10} more things happened in this hop.</p>}
    </div>
  );

  // ---------------------------------------------------------------- Evidence blocks a step asks for
  const done = P.run && !playingPlan ? P.run : undefined;
  const wait = <p className="rounded-xl border border-pv-border p-2 text-[12px] text-pv-text-muted">The evidence appears when the run has finished — let it play, or press Skip to end.</p>;
  const evidence = (what: FwShow[]) => (
    <div className="space-y-2">
      {what.includes("policy") && (
        <Card title="Policies, in order">
          <Policies s={s} vendor={vendor} />
        </Card>
      )}
      {P.run && playingPlan && what.includes("pipeline") && wait}
      {done && what.includes("pipeline") && (
        <Card title="What FW1 decided, step by step">
          <Pipeline run={done} vendor={vendor} />
        </Card>
      )}
      {what.includes("sessions") && (
        <Card title="FW1's session table">
          <Sessions s={s} />
        </Card>
      )}
      {what.includes("nat") && (
        <Card title="Translations">
          <NatView s={s} vendor={vendor} />
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
        {FW_LEVELS.map((l, li) => (
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
        {(step > 0 || level > 0) && <Pill onClick={() => (step > 0 ? enterStep(level, step - 1) : enterStep(level - 1, FW_LEVELS[level - 1].steps.length - 1))}>← Back</Pill>}
        <span className="flex-1" />
        {learnAction(false)}
      </div>
    </div>
  );
  const gateBoard = (
    <div className="space-y-3 rounded-2xl border border-pv-violet/50 bg-pv-violet/[0.05] p-4">
      <h3 className="text-[16px] font-bold text-pv-text">You can follow a packet through a stateful firewall</h3>
      <ul className="list-disc space-y-1 pl-5 text-[13px] text-pv-text-muted">
        <li>FW1 routes, and allows traffic per zone pair: the first matching rule decides; nothing matching means the implicit default deny.</li>
        <li>The first packet creates a session; replies match it in reverse and need no rule. A segment with no session (and no SYN) is dropped.</li>
        <li>Source NAT rewrites the source to an address the internet routes back to us; destination NAT publishes a server — before the policy, which therefore uses the real address.</li>
        <li>Allowed is not working: a session stuck half-open means the reply died past the firewall (NAT address, ISP route, the server&apos;s gateway).</li>
        <li>Timeout = something dropped it silently; connection refused = it arrived and nothing listens.</li>
      </ul>
      <p className="text-[13px] text-pv-text-muted">The engineering workspace gives you FW1 in its own window (policy editor, NAT, sessions, logs, a Cisco IOS zone-based firewall or Junos SRX console, captures on each interface), the ISP&apos;s looking glass, five hosts with a Linux shell, six challenges and five tickets to solve from evidence.</p>
      <div className="flex flex-wrap gap-2">
        <Pill onClick={toEngineering} tone="primary">
          Enter the engineering workspace →
        </Pill>
        <Pill onClick={() => toLearn(FW_LEVELS.length - 1)}>Review level 6</Pill>
      </div>
    </div>
  );

  // Troubleshoot
  const t = s.ticket ? fwTicket(s.ticket) : undefined;
  const proofs = fwProofs(s);
  const solved = !!t && proofs.every((p) => p.ok);
  const fb = guess ? guessFb : undefined;
  const repro = fwLastRepro(s);
  const startTicket = (id: FwTicketId) => {
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
          <p className="text-[13px] text-pv-text-muted">Users report symptoms, not causes. Each ticket is this network with one real thing wrong. Reproduce it, follow the first packet through FW1 (zone, rule, translation, session), then the reply, name the cause, fix it where it lives, and prove it with fresh traffic.</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {FW_TICKETS.map((x) => (
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
              <p className="text-[13px] text-pv-text-muted">See it yourself first: {t.reproLabel} — and watch which way it goes.</p>
              <Pill onClick={() => t.repro.forEach((a) => act(a))} disabled={playingPlan} tone="primary">
                Reproduce it ▶
              </Pill>
            </div>
          )}
          {phase >= 2 && (
            <div className="space-y-1.5">
              <p className="text-[13px] text-pv-text-muted">Walk the evidence in order — open each question once you&apos;ve looked (hit counts, logs, sessions, translations, captures, the consoles):</p>
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
                {FW_CAUSES.map((c) => {
                  const picked = guess === c.id;
                  if (found && !picked) return null;
                  return (
                    <div key={c.id}>
                      <button
                        type="button"
                        disabled={found}
                        onClick={() => {
                          const f = fwCauseFeedback(s, c.id);
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
                          {fwVendorText(vendor, fb.text)}
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
              {!solved && <p className="text-[12.5px] text-pv-text-muted">Change it on the device (its window, or its console — Junos needs a commit), check the devices&apos; own state (show policy-map type inspect zone-pair sessions / show ip nat translations · show security flow session / show security policies hit-count), then run the user&apos;s test again. An accepted command isn&apos;t a repaired network.</p>}
              <ul className="space-y-0.5">
                {proofs.map((p) => (
                  <li key={p.label} className={clsx("text-[12.5px]", p.ok ? "text-pv-success" : "text-pv-text-muted")}>
                    {p.ok ? "✓" : "○"} {fwVendorText(vendor, p.label)} <span className="text-[11.5px] text-pv-text-faint">— {fwVendorText(vendor, p.detail)}</span>
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
      <p className="text-[13px] text-pv-text-muted">Operate the network yourself. Each challenge is checked from what the network did — its sessions, logs, captures and configuration — not from what you clicked. Start over gives a fresh network.</p>
      <ol className="space-y-1">
        {FW_CHALLENGES.map((c, i) => {
          const ok = c.done(s);
          return (
            <li key={c.id} className={clsx("rounded-lg border px-2 py-1.5", ok ? "border-pv-success/50 bg-pv-success/[0.05]" : "border-pv-border")}>
              <p className={clsx("text-[12.5px] font-semibold", ok ? "text-pv-success" : "text-pv-text")}>
                {ok ? "✓" : `${i + 1}.`} {c.title}
              </p>
              <p className="text-[12px] text-pv-text-muted">{fwVendorText(vendor, c.how)}</p>
              {!ok && (s.runs.length > 0 || s.cfgSeq > 0) && <p className="mt-0.5 text-[12px] text-pv-warning">Not yet: {fwVendorText(vendor, c.next(s))}</p>}
            </li>
          );
        })}
      </ol>
      <Pill onClick={() => resetNet()}>Start over</Pill>
    </div>
  );
  const deviceButtons = (
    <div className="flex flex-wrap gap-1">
      {(["FW1", "ISP", "CLIENT", "LAB", "DMZ", "WEB", "OUT"] as FwDev[]).map((d) => (
        <button key={d} type="button" onClick={() => openWin(d)} className="rounded-md border border-pv-border px-2 py-0.5 text-[12px] font-semibold text-pv-text-muted hover:border-pv-cyan/60 hover:text-pv-text">
          {d === "FW1" ? "🛡 FW1" : d === "ISP" ? "R ISP" : `💻 ${d}`}
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
      <Composer act={(a) => act(a)} busy={playingPlan} />
      {engTab === "investigate" && (
        <div className="space-y-2 text-[13px] text-pv-text-muted">
          <p>The same network, yours. Things worth proving with evidence:</p>
          <ul className="list-disc space-y-0.5 pl-5 text-[12.5px]">
            <li>Open a connection from CLIENT and compare the SYN in FW1&apos;s trust and untrust captures: what changed, what didn&apos;t?</li>
            <li>Predict which rule LAB&apos;s HTTPS hits before you send it — then check the hit counts.</li>
            <li>Send a stray ACK from the internet and find it in the log. Why can&apos;t it start a session?</li>
            <li>Connect from OUT to 198.51.100.2:443 and read the destination NAT step; then try SSH.</li>
            <li>Compare show policy-map type inspect zone-pair sessions (IOS) with show security flow session (Junos) for the same session.</li>
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
        <div className="flex rounded-full border border-pv-border p-0.5 text-[11px]" aria-label="Console OS">
          {(["cisco", "juniper"] as const).map((x) => (
            <button key={x} type="button" aria-pressed={vendor === x} onClick={() => setVendor(x)} className={clsx("rounded-full px-2 py-0.5 font-semibold", vendor === x ? "bg-pv-cyan/20 text-pv-text" : "text-pv-text-faint")}>
              {x === "cisco" ? "Cisco" : "Junos"}
            </button>
          ))}
        </div>
      </div>
      {tools === "tables" && (
        <div className="space-y-2">
          <Card title="Policies, in order">
            <Policies s={s} vendor={vendor} />
          </Card>
          <Card title="FW1's session table">
            <Sessions s={s} />
          </Card>
          <Card title="Translations">
            <NatView s={s} vendor={vendor} />
          </Card>
        </div>
      )}
      {tools === "journey" &&
        (playingPlan ? (
          wait
        ) : s.last ? (
          <div className="space-y-2">
            <Card title="What FW1 decided">
              <Pipeline run={s.last} vendor={vendor} />
            </Card>
            <Journey run={s.last} vendor={vendor} max={80} />
          </div>
        ) : (
          <p className="text-[12.5px] text-pv-text-faint">Send something first.</p>
        ))}
      {tools === "captures" &&
        (playingPlan ? (
          wait
        ) : (
          <div className="-mx-3 rounded-xl border border-pv-border">
            <CaptureView key={s.seq} s={s} points={capPoints()} initial="FW1 untrust" vendor={vendor} />
          </div>
        ))}
      {tools === "log" && <LabEventLog entries={[...s.log].reverse().slice(0, 80).map((l, i) => ({ id: s.log.length - i, tag: `#${l.seq}`, text: fwVendorText(vendor, l.text), kind: l.tone === "warn" ? "warning" : l.tone === "ok" ? "learn" : "info" }))} title="Lab log" />}
    </div>
  );

  const ctx = { view: s, act, vendor, setVendor, ios, setIos, junosEdit, setJunosEdit, cand, setCand, spare, setSpare, consoles, setConsoles, notes, setNotes, question, setQuestion };

  return (
    <PracticeLabShell
      open={open}
      onClose={onClose}
      title="Firewall Lab"
      sandboxNote={eng ? "Engineering workspace · sandbox, no progress" : "FW1 · trust / dmz / untrust · sandbox, no progress"}
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
      eventStrip={<p className="truncate text-[11.5px] text-pv-text-muted" aria-live="polite">{caption}</p>}
      board={
        <div className="space-y-3">
          {header}
          {mode === "learn" && learnBoard}
          {mode === "gate" && gateBoard}
          {eng && engBoard}
          <FwDesk windows={windows} setWindows={setWindows} focus={focus} setFocus={setFocus} ctx={ctx} />
        </div>
      }
      liveState={liveState}
      liveStateLabel={eng ? "Tools" : "The firewall"}
      mobileTab={mobileTab}
      onMobileTabChange={setMobileTab}
      tabLabels={{ state: eng ? "Tools" : "Firewall" }}
    />
  );
}
