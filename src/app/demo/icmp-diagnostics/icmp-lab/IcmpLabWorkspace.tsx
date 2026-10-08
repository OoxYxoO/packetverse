"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { clsx } from "clsx";
import { PracticeLabShell, type PracticeLabTab } from "@/components/practice-lab/PracticeLabShell";
import { LabEventLog } from "@/components/practice-lab/LabEventLog";
import type { CliVendor } from "@/lib/cli/types";
import { IC_ADDR } from "@/lib/sim-engine/scenarios/icmpDiagnostics";
import { IC_CAUSES, IC_KIND, IC_POINTS, IC_TICKETS, createIcNet, icApply, icCauseFeedback, icClone, icFollow, icHealthy, icJunosIf, icPointLabel, icProofs, icShortIf, icTicket, type IcAction, type IcKind, type IcCause, type IcDev, type IcIf, type IcRouter, type IcRouterCfg, type IcRun, type IcState, type IcTicketId } from "@/lib/sim-engine/scenarios/icmpNet";
import type { ConsoleSession } from "@/app/demo/dhcp-dns/dhcp-lab/ConsoleTerminal";
import type { CliQuestion } from "@/app/demo/dhcp-dns/dhcp-lab/dhcpBuildCli";
import { DecisionChain, IcLabTopology, PacketFields } from "./IcTopology";
import { CaptureView, IcDesk, openIcWindow, type IcWin } from "./IcDevices";
import { ProbeComposer, ResultView, SizeMath, pathMtu } from "./IcPanels";
import { IC_LEVELS } from "./IcLearn";
import { MOMENT_MS, icMoments } from "./icMoments";
import type { IcCiscoMode, IcCommit } from "./icCli";

/**
 * ICMP Lab — built like the ARP lab: the shared practice-lab workspace (pinned topology, the exchange played moment
 * by moment with Pause / Step / Skip / Replay, the current moment in one line under it, the teaching board below,
 * the devices' evidence on the right), with ICMP's own content:
 *
 *   LEARN                 6 levels (IcLearn): one ping · TTL · traceroute · unreachables · size/MTU/DF · silence
 *   ENGINEERING WORKSPACE Experiment (probe composer, device windows with Linux/Cisco/Junos, captures) and
 *                         Troubleshoot (six tickets: reproduce → explain → fix on a device → prove)
 *
 * One model (icmpNet.ts) produces every moment, capture, counter and verdict. Nothing here touches the guided lesson
 * or the progress store.
 */

type Mode = "learn" | "gate" | "eng";
type EngTab = "experiment" | "troubleshoot";
type Tools = "devices" | "captures" | "log";
interface Player {
  run?: IcRun;
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

export function IcmpLabWorkspace({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [mode, setMode] = useState<Mode>("learn");
  const [engTab, setEngTab] = useState<EngTab>("experiment");
  const [level, setLevel] = useState(0);
  const [step, setStep] = useState(0);
  const [unlocked, setUnlocked] = useState(0);
  const [s, setS] = useState<IcState>(() => createIcNet());
  const sRef = useRef(s);
  const [P, setP] = useState<Player>(IDLE);
  const [animate, setAnimate] = useState(true);
  const [ranKey, setRanKey] = useState<string | undefined>(undefined);
  const [stepRun, setStepRun] = useState<Record<string, IcRun>>({});
  const [sizerData, setSizerData] = useState(1372);
  const [windows, setWindows] = useState<IcWin[]>([]);
  const [focus, setFocus] = useState<IcDev | undefined>(undefined);
  const [vendor, setVendor] = useState<CliVendor>("cisco");
  const [cisco, setCiscoM] = useState<Record<IcRouter, IcCiscoMode>>({ R1: { kind: "exec" }, R2: { kind: "exec" } });
  const [junosEdit, setJunosEditM] = useState<Record<IcRouter, boolean>>({ R1: false, R2: false });
  const [cand, setCandM] = useState<Record<IcRouter, IcRouterCfg>>(() => ({ R1: icClone(s.cfg.R1), R2: icClone(s.cfg.R2) }));
  const [hist, setHist] = useState<Record<IcRouter, IcCommit[]>>(() => ({ R1: [{ cfg: icClone(s.cfg.R1), at: 0, by: "initial" }], R2: [{ cfg: icClone(s.cfg.R2), at: 0, by: "initial" }] }));
  const [question, setQuestion] = useState<CliQuestion | undefined>(undefined);
  const [consoles, setConsoles] = useState<Record<string, ConsoleSession>>({});
  const [notes, setNotes] = useState(true);
  const [guess, setGuess] = useState<IcCause | undefined>(undefined);
  const [found, setFound] = useState(false);
  const [rungs, setRungs] = useState<Record<string, boolean>>({});
  const [tools, setTools] = useState<Tools>("devices");
  const [ticketSeq, setTicketSeq] = useState(0);
  const [mobileTab, setMobileTab] = useState<PracticeLabTab>("topology");

  const act = useCallback((a: IcAction, by?: string) => {
    const n = icApply(sRef.current, a);
    const prev = sRef.current;
    sRef.current = n;
    setS(n);
    // Routers' commit history follows every change to them, whoever made it (IOS line, Junos commit, ticket, reset).
    setHist((h) => {
      const out = { ...h };
      for (const r of ["R1", "R2"] as IcRouter[]) {
        const strip = (c: IcRouterCfg) => JSON.stringify({ ...c, acl: c.acl ? { ...c.acl, entries: c.acl.entries.map((e) => ({ ...e, hits: 0 })) } : undefined });
        if (strip(prev.cfg[r]) !== strip(n.cfg[r])) out[r] = [{ cfg: icClone(n.cfg[r]), at: Date.now(), by: by ?? (a.type === "cfg" ? "admin" : a.type) }, ...h[r]].slice(0, 20);
      }
      return out;
    });
    if (a.type === "ticket" || a.type === "fresh") {
      setCandM({ R1: icClone(n.cfg.R1), R2: icClone(n.cfg.R2) });
      setJunosEditM({ R1: false, R2: false });
      setCiscoM({ R1: { kind: "exec" }, R2: { kind: "exec" } });
    }
    return n;
  }, []);

  // ---------------------------------------------------------------- Playback (the ARP lab's moment player)
  const v = vendor === "cisco" ? "cisco" : "juniper";
  const { story, moments } = useMemo(() => icMoments(P.run, v), [P.run, v]);
  const n = moments.length;
  const playingPlan = !!P.run && P.cursor < n;
  useEffect(() => {
    if (!P.playing || !P.run || P.cursor >= n) return;
    const t = window.setTimeout(() => setP((p) => (p.key !== P.key ? p : p.cursor + 1 >= n ? { ...p, cursor: n, playing: false } : { ...p, cursor: p.cursor + 1 })), MOMENT_MS);
    return () => window.clearTimeout(t);
  }, [P, n]);
  const show = (run: IcRun) => setP({ run, key: `r${run.id}-${++playSeq}`, cursor: animate ? 0 : icMoments(run, v).moments.length, playing: animate });
  const pause = () => setP((p) => ({ ...p, playing: false }));
  const play = () => setP((p) => ({ ...p, playing: true }));
  const stepOnce = () => setP((p) => (p.cursor < n ? { ...p, cursor: p.cursor + 1, playing: false } : p));
  const skip = () => setP((p) => ({ ...p, cursor: n, playing: false }));
  const replay = () => setP((p) => (p.run ? { ...p, key: `${p.key}+`, cursor: 0, playing: true } : p));
  const moment = playingPlan ? moments[P.cursor] : undefined;
  /** The last packet that arrived somewhere: its outcome stays on the device through the explaining moments that follow (silence, a stop). */
  const prevMoment = (() => {
    const ref = (moment ?? moments[n - 1])?.probe;
    for (let i = Math.min(P.cursor, n) - 1; i >= 0; i--) {
      const m = moments[i];
      if (m.copy) return m;
      if (m.probe !== ref) return undefined;
    }
    return undefined;
  })();

  const openWin = (d: IcDev) => {
    setWindows((ws) => openIcWindow(ws, d));
    setFocus(d);
  };
  const resetNet = () => {
    const ns = { ...createIcNet(), seq: sRef.current.seq + 1 };
    sRef.current = ns;
    setS(ns);
    setP(IDLE);
    setCandM({ R1: icClone(ns.cfg.R1), R2: icClone(ns.cfg.R2) });
    setHist({ R1: [{ cfg: icClone(ns.cfg.R1), at: 0, by: "initial" }], R2: [{ cfg: icClone(ns.cfg.R2), at: 0, by: "initial" }] });
    setJunosEditM({ R1: false, R2: false });
    setCiscoM({ R1: { kind: "exec" }, R2: { kind: "exec" } });
    setConsoles({});
    setQuestion(undefined);
  };

  // ---------------------------------------------------------------- Learn
  const lv = IC_LEVELS[level];
  const st = lv.steps[step];
  const stepKey = `${level}:${step}`;
  const hasRun = !!st.probes?.length || !!st.sizer;
  const ran = !hasRun || ranKey === stepKey;
  const stepDone = ran && !playingPlan;
  const sRun = stepRun[st.id];
  /** Enter a Learn step: healthy network, then the step's own setup (a real configuration). */
  const enterStep = (li: number, si: number) => {
    setLevel(li);
    setStep(si);
    setRanKey(undefined);
    resetNet();
    const t = IC_LEVELS[li].steps[si];
    if (t.setup) {
      const cfg = icHealthy();
      t.setup(cfg);
      act({ type: "cfg", cfg, text: t.setupText ?? "Lesson setup" }, "lesson");
    }
  };
  const runStep = (a: IcAction) => {
    const ns = act(a);
    setRanKey(stepKey);
    if (ns.last) {
      setStepRun((m) => ({ ...m, [st.id]: ns.last! }));
      show(ns.last);
    }
  };
  const nextStep = () => {
    if (!stepDone) return;
    if (step + 1 < lv.steps.length) return enterStep(level, step + 1);
    if (level + 1 < IC_LEVELS.length) {
      setUnlocked((u) => Math.max(u, level + 1));
      return enterStep(level + 1, 0);
    }
    setP((p) => ({ ...p, cursor: n, playing: false }));
    setMode("gate");
  };
  const toEngineering = () => {
    setUnlocked(IC_LEVELS.length - 1);
    setMode("eng");
    setEngTab("experiment");
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
    setGuess(undefined);
    setFound(false);
    setRungs({});
    setStepRun({});
    setSizerData(1372);
    if (mode === "learn") enterStep(level, step);
    else resetNet();
  };

  // ---------------------------------------------------------------- Pieces
  const sizerAction: IcAction = { type: "ping", dev: "HOST-A", dst: IC_ADDR["HOST-B"], count: 1, data: sizerData, mode: "do" };
  const learnAction = (compact: boolean) => {
    if (mode !== "learn") return null;
    if (hasRun && !ran) {
      const first = st.sizer ? { label: `ping -c 1 -s ${sizerData} -M do HOST-B`, action: sizerAction } : st.probes![0];
      return <Pill onClick={() => runStep(first.action)} disabled={playingPlan} tone={"primary"}>{compact ? "▶ Go" : `▶ ${first.label}`}</Pill>;
    }
    const last = level + 1 >= IC_LEVELS.length && step + 1 >= lv.steps.length;
    return <Pill onClick={nextStep} disabled={!stepDone} tone={"primary"}>{step + 1 < lv.steps.length ? "Next →" : last ? "I've finished learning →" : compact ? `Level ${level + 2} →` : `Level ${level + 2}: ${IC_LEVELS[level + 1].title} →`}</Pill>;
  };
  const playerControls = P.run && (
    <div className="flex flex-wrap items-center gap-1" aria-label="Playback">
      {playingPlan && (P.playing ? <Pill onClick={pause}>{"⏸ Pause"}</Pill> : <Pill onClick={play}>{"▶ Play"}</Pill>)}
      {playingPlan && <Pill onClick={stepOnce}>{"Step ⏭"}</Pill>}
      {playingPlan && <Pill onClick={skip}>{"Skip to end"}</Pill>}
      {!playingPlan && <Pill onClick={replay}>{"↻ Replay"}</Pill>}
      <span className="pv-mono text-[11px] text-pv-text-faint">
        moment {Math.min(P.cursor, n)}/{n}
      </span>
    </div>
  );

  // ---------------------------------------------------------------- Topology
  const eng = mode === "eng";
  const labels = eng || mode === "gate" || level >= 1;
  // traceroute: a hop is known once its answer has reached HOST-A
  const tags: Record<string, string> = {};
  if (story.tool === "traceroute")
    moments.forEach((m, i) => {
      const pr = story.probes[m.probe];
      if (i < P.cursor && m.outcome && m.outcome.at === pr?.sender && pr.probe.answerFrom) tags[pr.probe.answerFrom] = `hop ${m.probe + 1}`;
    });
  const topologyFor = (compact: boolean) => <IcLabTopology s={s} moment={moment} prev={prevMoment} runKey={P.key} cursor={P.cursor} compact={compact} labels={labels} vendor={v} tags={tags} onNode={eng ? openWin : undefined} selected={eng ? focus : undefined} />;
  const topology = (
    <>
      <div className="h-full sm:hidden">{topologyFor(true)}</div>
      <div className="hidden h-full sm:block">{topologyFor(false)}</div>
    </>
  );
  const lastM = P.run && n ? moments[n - 1] : undefined;
  const caption = moment?.caption ?? (lastM ? (lastM.copy && lastM.outcome ? `${lastM.caption} → ${lastM.outcome.label}` : lastM.caption) : undefined);

  /** The exchange on the wire: the moment's sentence, the deciding device's checks, the packet's fields. */
  const exchange = P.run && (
    <div className="space-y-2">
      {caption && <p className={clsx("rounded-lg border px-2 py-1 text-[12.5px] text-pv-text", (moment ?? lastM)?.tone === "bad" ? "border-pv-danger/40 bg-pv-danger/[0.06]" : (moment ?? lastM)?.tone === "icmp" ? "border-pv-warning/40 bg-pv-warning/[0.06]" : (moment ?? lastM)?.tone === "ok" ? "border-pv-success/40 bg-pv-success/[0.06]" : "border-pv-cyan/40 bg-pv-cyan/[0.06]")}>▶ {caption}</p>}
      {(moment ?? lastM)?.decision && <DecisionChain key={`d${P.key}${P.cursor}`} b={(moment ?? lastM)!.decision!} vendor={v} />}
      {(moment ?? lastM)?.copy && (eng || level >= 1) && <PacketFields p={(moment ?? lastM)!.copy!.pkt} />}
    </div>
  );

  // ---------------------------------------------------------------- Boards
  const header = (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1">
        {IC_LEVELS.map((l, li) => (
          <button
            key={l.n}
            type="button"
            disabled={li > unlocked && !eng}
            aria-current={mode === "learn" && level === li ? "step" : undefined}
            onClick={() => toLearn(li)}
            className={clsx("rounded-full border px-2.5 py-0.5 text-[11.5px] font-semibold disabled:opacity-35", mode === "learn" && level === li ? "border-pv-cyan bg-pv-cyan/15 text-pv-text" : li < unlocked || eng ? "border-pv-success/50 text-pv-success" : "border-pv-border text-pv-text-muted")}
          >
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

  const learnBoard = (
    <div className="space-y-3 rounded-2xl border border-pv-border bg-pv-bg-elevated/40 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-[15px] font-bold text-pv-text">{st.title}</h3>
        <span className="shrink-0 text-[11px] text-pv-text-faint">
          step {step + 1} / {lv.steps.length}
        </span>
      </div>
      <div className="space-y-1.5 text-[13.5px] leading-snug text-pv-text-muted">{st.body}</div>
      {st.setupText && <p className="rounded-lg border border-pv-warning/40 bg-pv-warning/[0.06] px-2.5 py-1 text-[12px] text-pv-text">{st.setupText}</p>}
      {st.sizer && <SizeMath data={sizerData} mtu={pathMtu(s)} onData={setSizerData} />}
      {(st.sizer || (st.probes && (st.probes.length > 1 || ran))) && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11.5px] text-pv-text-faint">Send:</span>
          {st.sizer && <Pill onClick={() => runStep(sizerAction)} disabled={playingPlan} tone={!ran ? "primary" : undefined}>{`ping -c 1 -s ${sizerData} -M do HOST-B`}</Pill>}
          {st.probes?.map((p) => (
            <span key={p.label}>{<Pill onClick={() => runStep(p.action)} disabled={playingPlan}>{p.label}</Pill>}</span>
          ))}
        </div>
      )}
      {exchange}
      {sRun && !playingPlan && <ResultView s={s} run={sRun} follow={level >= 3} />}
      {!playingPlan && st.extra?.(s, sRun)}
      <div className="flex flex-wrap items-center gap-2 border-t border-pv-border pt-2">
        {(step > 0 || level > 0) && <Pill onClick={() => (step > 0 ? enterStep(level, step - 1) : enterStep(level - 1, IC_LEVELS[level - 1].steps.length - 1))}>{"← Back"}</Pill>}
        <span className="flex-1" />
        {learnAction(false)}
      </div>
    </div>
  );

  const gateBoard = (
    <div className="space-y-3 rounded-2xl border border-pv-violet/50 bg-pv-violet/[0.05] p-4">
      <h3 className="text-[16px] font-bold text-pv-text">You can read what the network tells you</h3>
      <ul className="list-disc space-y-1 pl-5 text-[13px] text-pv-text-muted">
        <li>An Echo Reply proves the round trip for that packet — not the application, not big packets, not DNS.</li>
        <li>Every router takes 1 off the TTL. At 0 the packet dies and that router sends 11/0 — from the interface it arrived on.</li>
        <li>Traceroute is TTL on purpose: each Time Exceeded names one hop; * * * means no answer came back, not &quot;down&quot;.</li>
        <li>3/0 no route · 3/1 nobody answers ARP · 3/3 nothing listens · 3/4 too big with DF, carrying the MTU that fits.</li>
        <li>Silence is evidence: find where the probe — or its reply — was last seen, and look just beyond it.</li>
      </ul>
      <p className="text-[13px] text-pv-text-muted">The engineering workspace gives you every device in its own window — terminals (Linux, Cisco, Junos), configuration, counters, captures — then six tickets to solve from evidence only.</p>
      <div className="flex flex-wrap gap-2">
        {<Pill onClick={toEngineering} tone={"primary"}>{"Enter the engineering workspace →"}</Pill>}
        {<Pill onClick={() => toLearn(IC_LEVELS.length - 1)}>{"Review level 6"}</Pill>}
      </div>
    </div>
  );

  // Troubleshoot
  const t = s.ticket ? icTicket(s.ticket) : undefined;
  const proofs = icProofs(s);
  const solved = !!t && proofs.every((p) => p.ok);
  const fb = guess ? icCauseFeedback(s, guess) : undefined;
  const startTicket = (id: IcTicketId) => {
    setWindows([]);
    setConsoles({});
    setGuess(undefined);
    setFound(false);
    setRungs({});
    setP(IDLE);
    setTicketSeq(act({ type: "ticket", id }, "ticket").seq);
  };
  const reproduce = () => {
    if (!t) return;
    const a: IcAction = t.id === "blackhole" ? { type: "curl", file: "big" } : t.id === "hidden-hop" ? { type: "trace", dev: "HOST-A", dst: IC_ADDR["HOST-B"] } : { type: "ping", dev: "HOST-A", dst: IC_ADDR["HOST-B"], count: 4 };
    const ns = act(a);
    if (ns.last) show(ns.last);
  };
  const reproduced = !!t && s.runs.some((r) => r.id > ticketSeq);
  const phase = !t ? 0 : !reproduced ? 1 : !found ? 2 : !solved ? 3 : 4;
  const troubleshootBoard = (
    <div className="space-y-3">
      {!t ? (
        <>
          <p className="text-[13px] text-pv-text-muted">Users report symptoms, not causes. Each ticket is the same network with one real setting wrong. Reproduce it, read what the network says (and where it goes silent), name the cause, fix it on the device, and prove it with a fresh probe.</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {IC_TICKETS.map((x) => (
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
            {<Pill onClick={() => (resetNet(), act({ type: "fresh" }))}>{"All tickets"}</Pill>}
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
              <p className="text-[13px] text-pv-text-muted">See it yourself first: send what the user describes and watch where it goes.</p>
              {<Pill onClick={reproduce} disabled={playingPlan} tone={"primary"}>{"Reproduce it ▶"}</Pill>}
            </div>
          )}
          {phase >= 2 && (
            <div className="space-y-1.5">
              <p className="text-[13px] text-pv-text-muted">The evidence so far — open each question when you have looked:</p>
              <div className="grid gap-1">
                {ladder(s).map((r, i) => (
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
              <p className="pt-1 text-[13px] text-pv-text-muted">{found ? "Diagnosis:" : "What started it? A wrong choice gets the evidence that rules it out."}</p>
              <div className="grid gap-1">
                {IC_CAUSES.map((c) => {
                  const picked = guess === c.id;
                  if (found && !picked) return null;
                  return (
                    <div key={c.id}>
                      <button
                        type="button"
                        disabled={found}
                        onClick={() => {
                          setGuess(c.id);
                          if (icCauseFeedback(s, c.id).right) setFound(true);
                        }}
                        className={clsx("w-full rounded-lg border px-2 py-1 text-left text-[12.5px]", picked ? (fb?.right ? "border-pv-success/60 bg-pv-success/10 text-pv-text" : "border-pv-warning/50 text-pv-text-muted") : "border-pv-border text-pv-text hover:border-pv-violet/60")}
                      >
                        {picked ? (fb?.right ? "✓ " : "✗ ") : ""}
                        {c.label}
                      </button>
                      {picked && fb && (
                        <p className={clsx("px-2 py-1 text-[12px]", fb.right ? "text-pv-success" : "text-pv-text-muted")}>
                          {fb.consequence && <b className="text-pv-warning">Consequence, not cause. </b>}
                          {fb.text}
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
              <p className="text-[13px] font-semibold text-pv-text">{solved ? "Proved" : "Fix it, then prove it"}</p>
              {!solved && <p className="text-[12.5px] text-pv-text-muted">Open the device and change the setting (window or CLI), check it there, then send fresh probes — every check below is read from the network.</p>}
              <ul className="space-y-0.5">
                {proofs.map((p) => (
                  <li key={p.label} className={clsx("text-[12.5px]", p.ok ? "text-pv-success" : "text-pv-text-muted")}>
                    {p.ok ? "✓" : "○"} {p.label} <span className="text-[11.5px] text-pv-text-faint">— {p.detail}</span>
                  </li>
                ))}
              </ul>
              {solved && <p className="text-[12.5px] text-pv-text">Ticket closed with evidence. {<Pill onClick={() => (resetNet(), act({ type: "fresh" }))}>{"Next ticket"}</Pill>}</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );

  const deviceButtons = (
    <div className="flex flex-wrap gap-1">
      {(["HOST-A", "R1", "R2", "HOST-B"] as IcDev[]).map((d) => (
        <button key={d} type="button" onClick={() => openWin(d)} className="rounded-md border border-pv-border px-2 py-0.5 text-[12px] font-semibold text-pv-text-muted hover:border-pv-cyan/60 hover:text-pv-text">
          {d === "R1" || d === "R2" ? `⇄ ${d}` : `💻 ${d}`}
        </button>
      ))}
    </div>
  );
  const engBoard = (
    <div className="space-y-3">
      <div role="tablist" className="flex gap-1">
        {(
          [
            ["experiment", "Experiment"],
            ["troubleshoot", "Troubleshoot"],
          ] as const
        ).map(([m, label]) => (
          <button key={m} type="button" role="tab" aria-selected={engTab === m} onClick={() => (setEngTab(m), setGuess(undefined), setFound(false), setRungs({}), resetNet(), act({ type: "fresh" }))} className={clsx("rounded-lg border px-3 py-1 text-[12.5px] font-semibold", engTab === m ? "border-pv-violet bg-pv-violet/15 text-pv-text" : "border-pv-border text-pv-text-muted hover:text-pv-text")}>
            {label}
          </button>
        ))}
      </div>
      <div className="space-y-1.5">
        <p className="text-[12px] text-pv-text-muted">Click a device on the topology (or here) to open it in its own window.</p>
        {deviceButtons}
      </div>
      {engTab === "troubleshoot" && troubleshootBoard}
      <ProbeComposer s={s} act={(a) => act(a)} onRun={show} />
      {engTab === "experiment" && (
        <div className="space-y-2 text-[13px] text-pv-text-muted">
          <p>The same network, yours. Change a real setting on a device, predict, then probe:</p>
          <ul className="list-disc space-y-0.5 pl-5 text-[12.5px]">
            <li>Make the transit link 1400 (R1 and R2, {vendor === "cisco" ? "ip mtu 1400 on Gi0/1" : "family inet mtu 1400 on ge-0/0/1"}), then find the largest DF ping that fits.</li>
            <li>Raise only one end back to 1500 and send a big DF ping: a giant dies with no ICMP at all.</li>
            <li>Filter Time Exceeded on R1&apos;s WAN-IN and run traceroute: which hop goes * * *?</li>
            <li>Remove R2&apos;s route back to 192.0.2.0/24 and compare ping R1, ping R2 and traceroute.</li>
            <li>Power HOST-B off, or drop echo-request in its iptables — compare the two silences.</li>
          </ul>
          <div className="flex flex-wrap gap-2">{<Pill onClick={() => (resetNet(), act({ type: "fresh" }))}>{"Fresh network"}</Pill>}</div>
        </div>
      )}
      {P.run && (
        <details open className="rounded-xl border border-pv-border p-2">
          <summary className="cursor-pointer text-[12px] font-semibold text-pv-text">Exchange: {P.run.tool} from {P.run.dev} to {P.run.dst}</summary>
          <div className="mt-2 space-y-2">
            {exchange}
            {!playingPlan && <ResultView s={s} run={P.run} />}
          </div>
        </details>
      )}
    </div>
  );

  // ---------------------------------------------------------------- Tools (right column)
  const ifn = (i: IcIf) => (vendor === "cisco" ? icShortIf(i) : icJunosIf(i));
  const showTools = eng || mode === "gate" || level >= 1;
  const liveState = !showTools ? (
    <p className="text-[12.5px] text-pv-text-muted">Level 1 is the story of one ping: what is sent, who answers, how it comes back. The devices&apos; counters, the captures and the log appear from level 2.</p>
  ) : (
    <div className="space-y-2">
      <div role="tablist" className="flex flex-wrap items-center gap-1">
        {(
          [
            ["devices", "Devices"],
            ["captures", "Captures"],
            ["log", "Log"],
          ] as const
        ).map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tools === k} onClick={() => setTools(k)} className={clsx("rounded-md px-2.5 py-0.5 text-[12px] font-semibold", tools === k ? "bg-pv-cyan/15 text-pv-text" : "text-pv-text-muted hover:text-pv-text")}>
            {label}
          </button>
        ))}
        <span className="flex-1" />
        <div className="flex rounded-full border border-pv-border p-0.5 text-[11px]" aria-label="Interface names">
          {(["cisco", "juniper"] as const).map((x) => (
            <button key={x} type="button" aria-pressed={vendor === x} onClick={() => setVendor(x)} className={clsx("rounded-full px-2 py-0.5 font-semibold", vendor === x ? "bg-pv-cyan/20 text-pv-text" : "text-pv-text-faint")}>
              {x === "cisco" ? "Cisco" : "Junos"}
            </button>
          ))}
        </div>
      </div>
      {tools === "devices" && <DevicesTable s={s} ifn={ifn} />}
      {tools === "captures" &&
        (playingPlan ? (
          <p className="rounded-xl border border-pv-border p-2 text-[12px] text-pv-text-muted">This test&apos;s captures appear when it has finished — let it play, or press Skip to end.</p>
        ) : (
          <div className="-mx-3 rounded-xl border border-pv-border">
            <CaptureView s={s} points={IC_POINTS} vendor={vendor} />
          </div>
        ))}
      {tools === "log" && <LabEventLog entries={[...s.log].reverse().map((l) => ({ id: l.seq, tag: `#${l.seq}`, text: l.text, kind: l.tone === "warn" ? "warning" : l.tone === "ok" ? "learn" : "info" }))} title="Lab log" />}
    </div>
  );

  const ctx = {
    view: s,
    act: (a: IcAction) => act(a),
    vendor,
    setVendor,
    cisco,
    setCisco: (r: IcRouter, m: IcCiscoMode) => setCiscoM((x) => ({ ...x, [r]: m })),
    junosEdit,
    setJunosEdit: (r: IcRouter, b: boolean) => setJunosEditM((x) => ({ ...x, [r]: b })),
    cand,
    setCand: (r: IcRouter, c: IcRouterCfg) => setCandM((x) => ({ ...x, [r]: c })),
    hist,
    commit: (r: IcRouter, c: IcRouterCfg) => {
      const net = icClone(sRef.current.cfg);
      net[r] = icClone(c);
      act({ type: "cfg", cfg: net, text: `${r}: Junos commit` }, "admin");
    },
    question,
    setQuestion,
    consoles,
    setConsoles,
    notes,
    setNotes,
  };

  return (
    <PracticeLabShell
      open={open}
      onClose={onClose}
      title="ICMP Lab"
      sandboxNote={eng ? "Engineering workspace · sandbox, no progress" : "Same network as the lesson · sandbox, no progress"}
      onReset={reset}
      animate={animate}
      onToggleAnimate={() => setAnimate((a) => !a)}
      stages={[]}
      currentStage={0}
      primaryAction={learnAction}
      controls={playerControls}
      topology={topology}
      topologyClassName="h-[380px] sm:h-[clamp(250px,38vh,360px)]"
      eventStrip={<p className="truncate text-[11.5px] text-pv-text-muted" aria-live="polite">{caption ?? s.log[s.log.length - 1]?.text ?? ""}</p>}
      board={
        <div className="space-y-3">
          {header}
          {mode === "learn" && learnBoard}
          {mode === "gate" && gateBoard}
          {eng && engBoard}
          {eng && <IcDesk windows={windows} setWindows={setWindows} focus={focus} setFocus={setFocus} ctx={ctx} />}
        </div>
      }
      liveState={liveState}
      liveStateLabel={eng ? "Tools" : "What the devices saw"}
      mobileTab={mobileTab}
      onMobileTabChange={setMobileTab}
      tabLabels={{ state: eng ? "Tools" : "Devices" }}
    />
  );
}

/** What each device has and has counted — the ARP lab's tables, for ICMP. */
function DevicesTable({ s, ifn }: { s: IcState; ifn: (i: IcIf) => string }) {
  const c = s.cfg;
  const kinds = (o: Partial<Record<string, number>>) =>
    Object.entries(o)
      .filter(([, x]) => x)
      .map(([k, x]) => `${x}× ${IC_KIND[k as keyof typeof IC_KIND].short}`)
      .join(", ") || "—";
  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
      {(["R1", "R2"] as const).map((r) => (
        <div key={r} className="min-w-0 rounded-xl border border-pv-border bg-pv-bg/70 p-2">
          <p className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-pv-text-faint">{r} · interfaces and ICMP</p>
          {(["ge0", "ge1"] as IcIf[]).map((i) => (
            <p key={i} className={clsx("pv-mono text-[11.5px]", c[r].ifs[i].up ? "text-pv-text" : "text-pv-danger")}>
              {ifn(i)} {c[r].ifs[i].ip}/{c[r].ifs[i].prefix} <span className={c[r].ifs[i].mtu < 1500 ? "text-pv-warning" : "text-pv-text-faint"}>mtu {c[r].ifs[i].mtu}</span> {c[r].ifs[i].up ? "" : "DOWN"}
            </p>
          ))}
          <p className="mt-1 text-[11px] text-pv-text-muted">
            sent: <span className="text-pv-text">{kinds(s.stats[r].sent)}</span>
          </p>
          <p className="text-[11px] text-pv-text-muted">
            received for itself: <span className="text-pv-text">{kinds(s.stats[r].rcvd)}</span>
          </p>
          {r === "R1" && c.R1.acl?.entries.some((e) => e.action === "deny") && <p className="text-[11px] text-pv-danger">WAN-IN denies: {c.R1.acl.entries.filter((e) => e.action === "deny").map((e) => e.icmp ?? e.proto).join(", ")}</p>}
        </div>
      ))}
      {(["HOST-A", "HOST-B"] as const).map((h) => (
        <div key={h} className="min-w-0 rounded-xl border border-pv-border bg-pv-bg/70 p-2">
          <p className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-pv-text-faint">{h}</p>
          <p className="pv-mono text-[11.5px] text-pv-text">
            eth0 {c[h].ip}/{c[h].prefix} gw {c[h].gw} {c[h].power ? "" : <span className="text-pv-danger">POWERED OFF</span>}
          </p>
          <p className="text-[11px] text-pv-text-muted">firewall: {c[h].input.length ? <span className="text-pv-danger">{c[h].input.map((x) => `${x.target} ${x.type}`).join(", ")}</span> : "accepts everything"}</p>
          <p className="text-[11px] text-pv-text-muted">path-MTU cache: {Object.entries(c[h].pmtu).map(([d, m]) => `${d} → ${m}`).join(", ") || "empty"}</p>
        </div>
      ))}
    </div>
  );
}

/** "Port Unreachable (3/3)" — what a learner reads in tool output, not the model's key. */
const kindName = (k: IcKind | undefined, code: boolean) => (!k ? "ICMP" : code ? `${IC_KIND[k].short} (${IC_KIND[k].type}/${IC_KIND[k].code})` : IC_KIND[k].short);

/** The evidence ladder for a ticket, computed from the tests the learner has run and the devices' state. */
function ladder(s: IcState): { k: string; title: string; text: string }[] {
  const B = IC_ADDR["HOST-B"];
  const runs = s.runs;
  const lastPing = [...runs].reverse().find((r) => r.tool === "ping" && r.dev === "HOST-A" && r.dst === B);
  const lastTrace = [...runs].reverse().find((r) => r.tool === "traceroute" && r.dev === "HOST-A" && r.dst === B);
  const lastCurl = [...runs].reverse().find((r) => r.tool === "curl");
  // A traceroute counts too: its last probe is the one sent with enough TTL to go all the way.
  const traceLast = lastTrace?.hops?.at(-1)?.at(-1);
  const probe = lastPing?.probes[lastPing.probes.length - 1] ?? (lastCurl ? lastCurl.probes[lastCurl.probes.length - 1] : undefined) ?? traceLast;
  const follow = probe ? icFollow(probe) : undefined;
  const furthest = follow ? [...follow].reverse().find((r) => r.sawRequest) : undefined;
  const sent = (["R1", "R2"] as IcRouter[]).flatMap((r) => Object.entries(s.stats[r].sent).filter(([, x]) => x).map(([k, x]) => `${r} sent ${x} × ${k === "ttl" ? "Time Exceeded" : k === "frag" ? "Frag Needed" : k === "host" ? "Host Unreachable" : k === "net" ? "Net Unreachable" : k === "port" ? "Port Unreachable" : "Echo Reply"}`));
  const drops = IC_POINTS.flatMap((p) => s.captures.filter((c) => c.point === p && c.note).slice(-1).map((c) => `${icPointLabel(p)}: ${c.note}`));
  const need = (what: string) => `Not tested yet — run ${what}.`;
  // A silent hop BEFORE the destination: that router's Time Exceeded never made it back.
  const silentHop = lastTrace?.hops ? lastTrace.hops.slice(0, -1).findIndex((h) => !h.some((p) => p.answer)) : -1;
  return [
    { k: "ping", title: "What did ping say?", text: lastPing ? `${lastPing.received}/${lastPing.probes.length} replies${lastPing.errors ? `, ${lastPing.errors} ICMP errors (${[...new Set(lastPing.probes.filter((p) => p.answer && p.answer.kind !== "echo-rep").map((p) => `${kindName(p.answer!.kind, false)} from ${p.answerFrom}`))].join(", ")})` : ""}.` : need("ping HOST-B") },
    { k: "trace", title: "What did traceroute say?", text: lastTrace ? lastTrace.hops!.map((h, i) => `${i + 1}: ${h.find((p) => p.answer)?.answerFrom ?? "*"}`).join(" · ") : need("traceroute HOST-B") },
    { k: "reach", title: "Where did the probe reach?", text: follow ? `${furthest ? `The request was last seen on ${icPointLabel(furthest.point)}` : "The request never left HOST-A"}. ${follow[0].sawResponse ? "A response came back to HOST-A." : "Nothing came back to HOST-A."}` : need("a probe to HOST-B") },
    { k: "who", title: "Who answered?", text: probe ? (probe.answer ? `${probe.answerFrom} (${probe.answer.src}) with ${probe.answer.proto === "icmp" ? kindName(probe.answer.kind, true) : probe.answer.tcp}.` : "Nobody answered the last probe.") : need("a probe") },
    { k: "silent", title: "What is silent — and what did the devices see?", text: `${sent.length ? `ICMP generated by routers so far: ${sent.join("; ")}.` : "The routers haven't generated any ICMP."} ${drops.length ? `Drops recorded: ${drops.join(" · ")}.` : "No device recorded a drop."}` },
    { k: "inspect", title: "Which device should I inspect next?", text: silentHop >= 0 ? `Hop ${silentHop + 1} printed * * * but later hops answered, so packets DO pass it: the router at hop ${silentHop + 1} — does it send Time Exceeded? — and every filter its Time Exceeded must cross on the way back to HOST-A.` : furthest ? `The one just past the last place that saw it: ${furthest.point === "HOST-B" ? "HOST-B itself (its firewall, its answer) — or, if HOST-B answered, every router the reply must cross on the way back (their routes)" : furthest.point.startsWith("R2") ? "R2 and what lies beyond it (its LAN interface, HOST-B)" : furthest.point.startsWith("R1") ? "R1's transit side and R2" : "HOST-A's own link and gateway"}. Open it: interfaces, routes, ICMP statistics, captures.` : "Gather a probe first." },
  ];
}
