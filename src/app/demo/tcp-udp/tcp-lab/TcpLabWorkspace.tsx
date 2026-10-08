"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { clsx } from "clsx";
import { PracticeLabShell, type PracticeLabTab } from "@/components/practice-lab/PracticeLabShell";
import { LabEventLog } from "@/components/practice-lab/LabEventLog";
import type { CliVendor } from "@/lib/cli/types";
import { TN_CAUSES, TN_POINTS, TN_TICKETS, createTcpNet, tnApply, tnCauseFeedback, tnClone, tnHealthy, tnListener, tnProofs, tnTicket, type TnAction, type TnCause, type TnCfg, type TnDev, type TnRun, type TnState, type TnTicketId } from "@/lib/sim-engine/scenarios/tcpNet";
import type { ConsoleSession } from "@/app/demo/dhcp-dns/dhcp-lab/ConsoleTerminal";
import { EndpointBar, NumbersCard, TcpTopology } from "./TcpTopology";
import { CaptureView, PathTrace, SocketTable, TcpDesk, openTcpWindow, type TcpWin } from "./TcpDevices";
import { Reading, SegmentLedger, StateHistory, TrafficComposer, ladder } from "./TcpPanels";
import { TCP_LEVELS, type TcpStep } from "./TcpLearn";
import { TCP_MOMENT_MS, conversation, tcpMoments } from "./tcpMoments";
import type { TcpIosMode } from "./tcpCli";

/**
 * TCP/UDP Lab — the shared practice-lab workspace (pinned topology, the test played moment by moment with Pause / Step
 * / Skip / Replay, the current moment in one line, the teaching board below, the endpoints' evidence on the right),
 * with the transport layer's own content:
 *
 *   LEARN                  6 levels (TcpLearn): ports · handshake · seq/ack · loss · close/refused/timeout · UDP
 *   ENGINEERING WORKSPACE  Investigate (composer, device windows: Linux Laptop and Server, Cisco/Junos R1, captures at
 *                          four points, path trace) · Build (publish a service, prove it, block it two ways, restore
 *                          it) · Troubleshoot (six tickets: reproduce → explain → fix on a device → prove)
 *
 * One model (tcpNet.ts) produces every moment, socket, capture and verdict. Nothing here touches the guided lesson or
 * the progress store.
 */

type Mode = "learn" | "gate" | "eng";
type EngTab = "investigate" | "build" | "troubleshoot";
type Tools = "sockets" | "trace" | "captures" | "log";
interface Player {
  run?: TnRun;
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
const Card = ({ title, children, tone = "plain" }: { title: string; children: ReactNode; tone?: "plain" | "ok" | "warn" }) => (
  <div className={clsx("space-y-1.5 rounded-2xl border p-3", tone === "ok" ? "border-pv-success/50 bg-pv-success/[0.06]" : tone === "warn" ? "border-pv-warning/50 bg-pv-warning/[0.06]" : "border-pv-border bg-pv-bg-elevated/30")}>
    <p className="text-[10.5px] font-bold uppercase tracking-[0.16em] text-pv-text-faint">{title}</p>
    {children}
  </div>
);
const isTool = (a: TnAction) => a.type === "curl" || a.type === "nc" || a.type === "dig" || a.type === "ping" || a.type === "sleep";

export function TcpLabWorkspace({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [mode, setMode] = useState<Mode>("learn");
  const [engTab, setEngTab] = useState<EngTab>("investigate");
  const [level, setLevel] = useState(0);
  const [step, setStep] = useState(0);
  const [unlocked, setUnlocked] = useState(0);
  const [s, setS] = useState<TnState>(() => createTcpNet());
  const sRef = useRef(s);
  const [P, setP] = useState<Player>(IDLE);
  const [animate, setAnimate] = useState(true);
  const [ranKey, setRanKey] = useState<string | undefined>(undefined);
  const [windows, setWindows] = useState<TcpWin[]>([]);
  const [focus, setFocus] = useState<TnDev | undefined>(undefined);
  const [vendor, setVendor] = useState<CliVendor>("cisco");
  const [ios, setIos] = useState<TcpIosMode>({ kind: "exec" });
  const [junosEdit, setJunosEdit] = useState(false);
  const [cand, setCand] = useState<TnCfg["r1"]>(() => tnClone(s.cfg.r1));
  const [consoles, setConsoles] = useState<Record<string, ConsoleSession>>({});
  const [notes, setNotes] = useState(true);
  const [guess, setGuess] = useState<TnCause | undefined>(undefined);
  const [found, setFound] = useState(false);
  const [rungs, setRungs] = useState<Record<string, boolean>>({});
  const [tools, setTools] = useState<Tools>("sockets");
  const [mobileTab, setMobileTab] = useState<PracticeLabTab>("topology");
  const [ticketSeq, setTicketSeq] = useState(0);

  // ---------------------------------------------------------------- Playback (moments on the simulation's clock)
  const moments = useMemo(() => tcpMoments(P.run), [P.run]);
  const n = moments.length;
  const playingPlan = !!P.run && P.cursor < n;
  useEffect(() => {
    if (!P.playing || !P.run || P.cursor >= n) return;
    const t = window.setTimeout(() => setP((p) => (p.key !== P.key ? p : p.cursor + 1 >= n ? { ...p, cursor: n, playing: false } : { ...p, cursor: p.cursor + 1 })), TCP_MOMENT_MS);
    return () => window.clearTimeout(t);
  }, [P, n]);
  const show = useCallback(
    (run: TnRun) => {
      if (run.tool === "sleep") return setP(IDLE);
      setP({ run, key: `r${run.id}-${++playSeq}`, cursor: animate ? 0 : tcpMoments(run).length, playing: animate });
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
  /** Sockets as of the moment on screen (the live state once the test has finished). */
  const snap = moment?.snap ?? (playingPlan ? prevMoment?.snap : undefined);
  const live = snap ?? { tcbs: s.tcbs, udp: s.udp };
  const conv = P.run ? conversation(snap ?? { tcbs: [...s.tcbs], udp: s.udp }, P.run.id, P.run.port) : {};

  const act = useCallback(
    (a: TnAction) => {
      const nx = tnApply(sRef.current, a);
      sRef.current = nx;
      setS(nx);
      if (a.type === "cfg" || a.type === "ticket" || a.type === "fresh") setCand(tnClone(nx.cfg.r1));
      if (isTool(a) && nx.last) show(nx.last);
      return nx;
    },
    [show],
  );
  const openWin = (d: TnDev) => {
    setWindows((ws) => openTcpWindow(ws, d));
    setFocus(d);
  };
  const resetNet = (cfg?: TnCfg, text?: string) => {
    let ns: TnState = { ...createTcpNet(), seq: sRef.current.seq + 1 };
    if (cfg) ns = tnApply(ns, { type: "cfg", cfg, text: text ?? "Lesson setup" });
    sRef.current = ns;
    setS(ns);
    setP(IDLE);
    setCand(tnClone(ns.cfg.r1));
    setIos({ kind: "exec" });
    setJunosEdit(false);
  };

  // ---------------------------------------------------------------- Learn
  const lv = TCP_LEVELS[level];
  const st = lv.steps[step];
  const stepKey = `${level}:${step}`;
  const hasRun = !!st.runs?.length;
  const ran = !hasRun || ranKey === stepKey;
  const stepDone = ran && !playingPlan;
  const stepCfg = (t: TcpStep) => {
    if (!t.setup) return undefined;
    const c = tnHealthy();
    t.setup(c);
    return c;
  };
  const enterStep = (li: number, si: number) => {
    setLevel(li);
    setStep(si);
    setRanKey(undefined);
    const t = TCP_LEVELS[li].steps[si];
    resetNet(stepCfg(t), t.setupText);
  };
  const runStep = (r: NonNullable<TcpStep["runs"]>[number]) => {
    if (!r.keep) resetNet(stepCfg(st), st.setupText);
    if (st.arm && !r.keep) act(st.arm);
    const list = Array.isArray(r.action) ? r.action : [r.action];
    list.forEach((a) => act(a));
    setRanKey(stepKey);
  };
  const nextStep = () => {
    if (!stepDone) return;
    if (step + 1 < lv.steps.length) return enterStep(level, step + 1);
    if (level + 1 < TCP_LEVELS.length) {
      setUnlocked((u) => Math.max(u, level + 1));
      return enterStep(level + 1, 0);
    }
    setP((p) => ({ ...p, cursor: n, playing: false }));
    setMode("gate");
  };
  const toEngineering = () => {
    setUnlocked(TCP_LEVELS.length - 1);
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
    const last = level + 1 >= TCP_LEVELS.length && step + 1 >= lv.steps.length;
    return (
      <Pill onClick={nextStep} disabled={!stepDone} tone="primary">
        {step + 1 < lv.steps.length ? "Next →" : last ? "I've finished learning →" : compact ? `Level ${level + 2} →` : `Level ${level + 2}: ${TCP_LEVELS[level + 1].title} →`}
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
        moment {Math.min(P.cursor, n)}/{n}
        {moment ? ` · t=${((moment.t - P.run.start) / 1000).toFixed(3)} s` : ""}
      </span>
    </div>
  );

  // ---------------------------------------------------------------- Topology
  const eng = mode === "eng";
  const topologyFor = (compact: boolean) => <TcpTopology cfg={s.cfg} moment={moment} prev={prevMoment} runKey={P.key} cursor={P.cursor} client={conv.client} server={conv.server} compact={compact} onNode={eng || level >= 1 ? openWin : undefined} selected={focus} />;
  const topology = (
    <>
      <div className="h-full sm:hidden">{topologyFor(true)}</div>
      <div className="hidden h-full sm:block">{topologyFor(false)}</div>
    </>
  );
  const proto = P.run?.tool === "dig" ? "udp" : "tcp";
  const footer = <EndpointBar cfg={s.cfg} client={conv.client} server={conv.server} port={P.run?.tool === "dig" ? 53 : P.run?.port} proto={proto} result={!playingPlan ? P.run?.result : undefined} />;
  const gapText = moment && moment.gap > 40 ? `⏱ +${moment.gap >= 1000 ? `${(moment.gap / 1000).toFixed(moment.gap % 1000 ? 1 : 0)} s` : `${moment.gap} ms`} later — ` : "";
  const caption = moment ? `${gapText}${moment.lines.map((l) => l.text).join(" · ")}` : P.run ? `${P.run.cmd} → ${P.run.ok ? "success" : P.run.result}` : (s.log[s.log.length - 1]?.text ?? "");
  const momentPanel = P.run && (
    <div className="space-y-1">
      {(moment ?? prevMoment)?.lines.map((l, i) => (
        <p key={`${P.key}${P.cursor}${i}`} className={clsx("pv-pop rounded-lg border px-2 py-1 text-[12.5px]", l.tone === "bad" ? "border-pv-danger/40 bg-pv-danger/[0.06] text-pv-text" : l.tone === "ok" ? "border-pv-success/40 bg-pv-success/[0.06] text-pv-text" : l.tone === "state" ? "border-pv-violet/40 bg-pv-violet/[0.06] text-pv-text" : "border-pv-cyan/30 bg-pv-cyan/[0.04] text-pv-text")} style={{ animationDelay: `${i * 90}ms` }}>
          {i === 0 && moment && gapText ? <span className="text-pv-warning">{gapText}</span> : null}
          {l.text}
        </p>
      ))}
    </div>
  );

  // ---------------------------------------------------------------- Evidence blocks a step asks for
  const done = P.run && !playingPlan ? P.run : undefined;
  const evidence = (what: TcpStep["show"]) => (
    <div className="space-y-2">
      {what.includes("numbers") && P.run && (
        <div className="grid gap-2 sm:grid-cols-2">
          <NumbersCard who="Laptop" tcb={conv.client} />
          <NumbersCard who="Server" tcb={conv.server} />
        </div>
      )}
      {done && what.includes("history") && <StateHistory run={done} />}
      {done && what.includes("handshake") && <SegmentLedger s={s} run={done} onlyHandshake />}
      {done && what.includes("ledger") && <SegmentLedger s={s} run={done} />}
      {done && what.includes("trace") && (
        <Card title="Where each packet was seen (capture points)">
          <PathTrace s={s} />
        </Card>
      )}
      {done && what.includes("reading") && <Reading s={s} run={done} />}
      {what.includes("sockets-laptop") && (
        <Card title="Laptop: its sockets (ss -tan)">
          <SocketTable cfg={s.cfg} snap={live} host="laptop" />
        </Card>
      )}
      {what.includes("sockets-server") && (
        <Card title="Server: its sockets (ss -tlnp / ss -ulnp)">
          <SocketTable cfg={s.cfg} snap={live} host="server" />
        </Card>
      )}
    </div>
  );

  // ---------------------------------------------------------------- Boards
  const header = (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1">
        {TCP_LEVELS.map((l, li) => (
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
      <div className="flex flex-wrap items-center gap-2 border-t border-pv-border pt-2">
        {(step > 0 || level > 0) && <Pill onClick={() => (step > 0 ? enterStep(level, step - 1) : enterStep(level - 1, TCP_LEVELS[level - 1].steps.length - 1))}>← Back</Pill>}
        <span className="flex-1" />
        {learnAction(false)}
      </div>
    </div>
  );
  const gateBoard = (
    <div className="space-y-3 rounded-2xl border border-pv-violet/50 bg-pv-violet/[0.05] p-4">
      <h3 className="text-[16px] font-bold text-pv-text">You can read a connection from the wire</h3>
      <ul className="list-disc space-y-1 pl-5 text-[13px] text-pv-text-muted">
        <li>The IP address finds the host; the port finds the application. A conversation is a 4-tuple: client IP:port ⇄ server IP:port.</li>
        <li>SYN, SYN-ACK, ACK: both endpoints change state (SYN-SENT / SYN-RECEIVED → ESTABLISHED). Routers carry the segments and keep no TCP state.</li>
        <li>seq = where these bytes begin; ack = the next byte expected. A lost segment shows as a duplicate ACK; the same bytes are resent; the ACK jumps.</li>
        <li>RST = an answer (“nothing listens here”, refused). Silence = something lost the SYN or the reply (timeout) — find where.</li>
        <li>UDP: ports and datagrams, no handshake, no state, no retransmission — the application decides what to do about silence.</li>
      </ul>
      <p className="text-[13px] text-pv-text-muted">The engineering workspace gives you the three devices in their own windows (Linux terminals on the Laptop and the Server, Cisco/Junos on R1), captures at four points, a hands-on build, and six tickets to solve from evidence.</p>
      <div className="flex flex-wrap gap-2">
        <Pill onClick={toEngineering} tone="primary">
          Enter the engineering workspace →
        </Pill>
        <Pill onClick={() => toLearn(TCP_LEVELS.length - 1)}>Review level 6</Pill>
      </div>
    </div>
  );

  // Troubleshoot
  const t = s.ticket ? tnTicket(s.ticket) : undefined;
  const proofs = tnProofs(s);
  const solved = !!t && proofs.every((p) => p.ok);
  const fb = guess ? tnCauseFeedback(s, guess) : undefined;
  const startTicket = (id: TnTicketId) => {
    setWindows([]);
    setConsoles({});
    setGuess(undefined);
    setFound(false);
    setRungs({});
    setP(IDLE);
    setTicketSeq(act({ type: "ticket", id }).seq);
  };
  const reproduced = !!t && s.runs.some((r) => r.id > ticketSeq && r.tool !== "sleep");
  const phase = !t ? 0 : !reproduced ? 1 : !found ? 2 : !solved ? 3 : 4;
  const troubleshootBoard = (
    <div className="space-y-3">
      {!t ? (
        <>
          <p className="text-[13px] text-pv-text-muted">Users report symptoms, not causes. Each ticket is the same network with one real thing wrong. Reproduce it, follow the evidence point by point (did the SYN leave? arrive? what answered? what state is each end in?), name the cause, fix it on the device, and prove it with a fresh test.</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {TN_TICKETS.map((x) => (
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
              <p className="text-[13px] text-pv-text-muted">See it yourself first: run what the user runs, and watch where it goes.</p>
              <Pill onClick={() => act(t.repro)} disabled={playingPlan} tone="primary">
                Reproduce it ▶
              </Pill>
            </div>
          )}
          {phase >= 2 && (
            <div className="space-y-1.5">
              <p className="text-[13px] text-pv-text-muted">Walk the evidence in order — open each question once you&apos;ve looked (captures, sockets, device windows):</p>
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
              <p className="pt-1 text-[13px] text-pv-text-muted">{found ? "Diagnosis:" : "What explains all of it? A wrong choice gets the evidence that rules it out."}</p>
              <div className="grid gap-1">
                {TN_CAUSES.map((c) => {
                  const picked = guess === c.id;
                  if (found && !picked) return null;
                  return (
                    <div key={c.id}>
                      <button
                        type="button"
                        disabled={found}
                        onClick={() => {
                          setGuess(c.id);
                          if (tnCauseFeedback(s, c.id).right) setFound(true);
                        }}
                        className={clsx("w-full rounded-lg border px-2 py-1 text-left text-[12.5px]", picked ? (fb?.right ? "border-pv-success/60 bg-pv-success/10 text-pv-text" : "border-pv-warning/50 text-pv-text-muted") : "border-pv-border text-pv-text hover:border-pv-violet/60")}
                      >
                        {picked ? (fb?.right ? "✓ " : "✗ ") : ""}
                        {c.label}
                      </button>
                      {picked && fb && (
                        <p className={clsx("px-2 py-1 text-[12px]", fb.right ? "text-pv-success" : "text-pv-text-muted")}>
                          {fb.consequence && <b className="text-pv-warning">Not the cause. </b>}
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
              <p className="text-[13px] font-semibold text-pv-text">{solved ? "Proved" : "Fix it, verify it on the device, then prove it"}</p>
              {!solved && <p className="text-[12.5px] text-pv-text-muted">Change it on the device (window or terminal), check the device&apos;s own state (ss, iptables -L, ip route, show access-lists…), then run the user&apos;s test again. A command that was accepted isn&apos;t a repaired connection.</p>}
              <ul className="space-y-0.5">
                {proofs.map((p) => (
                  <li key={p.label} className={clsx("text-[12.5px]", p.ok ? "text-pv-success" : "text-pv-text-muted")}>
                    {p.ok ? "✓" : "○"} {p.label} <span className="text-[11.5px] text-pv-text-faint">— {p.detail}</span>
                  </li>
                ))}
              </ul>
              {!solved && (
                <Pill onClick={() => act(t.repro)} disabled={playingPlan}>
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

  // Build: publish a service and control it
  const runs9000 = s.runs.filter((r) => r.port === 9000);
  const build = [
    { k: "listen", label: "Start a listener on the Server: TCP 9000", how: "Server terminal: nc -lk 9000 & (or Services → nc). Verify with ss -tlnp.", ok: !!tnListener(s.cfg, "tcp", 9000) || runs9000.some((r) => r.ok) },
    { k: "connect", label: "Connect from the Laptop and see both ends ESTABLISHED", how: "nc -vz 10.20.20.20 9000 — watch both state labels during the test.", ok: runs9000.some((r) => r.ok && r.events.some((e) => e.k === "state" && e.host === "server" && e.to === "ESTABLISHED")) },
    { k: "reject", label: "Block it politely: the client must get “refused”", how: "sudo iptables -A INPUT -p tcp --dport 9000 -j REJECT --reject-with tcp-reset — then test again.", ok: runs9000.some((r) => r.result === "refused" && r.events.some((e) => e.k === "drop" && e.why === "ipt")) },
    { k: "drop", label: "Block it silently: the client must time out", how: "Replace the rule with -j DROP (iptables -D INPUT 1, then -A … -j DROP) — then test with nc -vz -w 5.", ok: runs9000.some((r) => r.result === "timeout" && r.events.some((e) => e.k === "drop" && e.why === "ipt")) },
    { k: "restore", label: "Open it again and prove it", how: "Remove the rule (iptables -D INPUT 1), check iptables -L, test again.", ok: (() => {
      const lastRun = runs9000[runs9000.length - 1];
      return !!lastRun?.ok && runs9000.some((r) => r.result === "timeout") && !s.cfg.server.ipt.some((r) => r.port === 9000);
    })() },
  ];
  const buildBoard = (
    <div className="space-y-2">
      <p className="text-[13px] text-pv-text-muted">The team wants a new service on TCP 9000. Publish it, prove it works end to end, then see the two ways a firewall can block it — and what each looks like from the client. Each check is read from the network, not from what you typed.</p>
      <ol className="space-y-1">
        {build.map((b, i) => (
          <li key={b.k} className={clsx("rounded-lg border px-2 py-1.5", b.ok ? "border-pv-success/50 bg-pv-success/[0.05]" : "border-pv-border")}>
            <p className={clsx("text-[12.5px] font-semibold", b.ok ? "text-pv-success" : "text-pv-text")}>
              {b.ok ? "✓" : `${i + 1}.`} {b.label}
            </p>
            <p className="pv-mono text-[11.5px] text-pv-text-muted">{b.how}</p>
          </li>
        ))}
      </ol>
      {build.every((b) => b.ok) && <p className="text-[12.5px] font-semibold text-pv-success">Done: you published a service, proved it, and saw REJECT (an answer: refused) and DROP (silence: timeout) from the client&apos;s side.</p>}
      <div className="flex flex-wrap gap-2">
        <Pill onClick={() => openWin("server")}>Open the Server</Pill>
        <Pill onClick={() => openWin("laptop")}>Open the Laptop</Pill>
        <Pill onClick={() => resetNet()}>Start over</Pill>
      </div>
    </div>
  );
  const deviceButtons = (
    <div className="flex flex-wrap gap-1">
      {(["laptop", "r1", "server"] as TnDev[]).map((d) => (
        <button key={d} type="button" onClick={() => openWin(d)} className="rounded-md border border-pv-border px-2 py-0.5 text-[12px] font-semibold text-pv-text-muted hover:border-pv-cyan/60 hover:text-pv-text">
          {d === "laptop" ? "💻 Laptop" : d === "server" ? "🗄 Server" : "⇄ R1"}
        </button>
      ))}
    </div>
  );
  const engBoard = (
    <div className="space-y-3">
      <div role="tablist" className="flex gap-1">
        {(
          [
            ["investigate", "Investigate"],
            ["build", "Build"],
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
      {engTab === "build" && buildBoard}
      <TrafficComposer s={s} act={(a) => act(a)} />
      {engTab === "investigate" && (
        <div className="space-y-2 text-[13px] text-pv-text-muted">
          <p>The same network, yours. Things worth proving with evidence:</p>
          <ul className="list-disc space-y-0.5 pl-5 text-[12.5px]">
            <li>Stop nginx on the Server, then curl from the Laptop: what comes back, and how fast? Start it again and compare.</li>
            <li>On the Server, drop its own replies (iptables -A OUTPUT -p tcp --sport 443 -j DROP) and run nc -vz … 443: what state is the Server in (ss -tan)?</li>
            <li>On R1, deny TCP from the Server&apos;s port 80 inbound on Gi0/1 and curl: compare the four capture points in the path trace.</li>
            <li>Remove the Server&apos;s default route: ping fails too. Is it TCP&apos;s fault?</li>
            <li>Run nc twice, then sleep 61 on the Laptop and read ss -tan again: where did TIME-WAIT go?</li>
          </ul>
          <Pill onClick={() => resetNet()}>Fresh network</Pill>
        </div>
      )}
      {P.run && (
        <details open className="rounded-xl border border-pv-border p-2">
          <summary className="cursor-pointer text-[12px] font-semibold text-pv-text">Test: {P.run.cmd}</summary>
          <div className="mt-2 space-y-2">
            {momentPanel}
            {done && <Reading s={s} run={done} />}
            {done && <StateHistory run={done} />}
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
            ["sockets", "Sockets"],
            ["trace", "Path trace"],
            ["captures", "Captures"],
            ["log", "Log"],
          ] as const
        ).map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tools === k} onClick={() => setTools(k)} className={clsx("rounded-md px-2.5 py-0.5 text-[12px] font-semibold", tools === k ? "bg-pv-cyan/15 text-pv-text" : "text-pv-text-muted hover:text-pv-text")}>
            {label}
          </button>
        ))}
        <span className="flex-1" />
        <div className="flex rounded-full border border-pv-border p-0.5 text-[11px]" aria-label="R1 console">
          {(["cisco", "juniper"] as const).map((x) => (
            <button key={x} type="button" aria-pressed={vendor === x} onClick={() => setVendor(x)} className={clsx("rounded-full px-2 py-0.5 font-semibold", vendor === x ? "bg-pv-cyan/20 text-pv-text" : "text-pv-text-faint")}>
              {x === "cisco" ? "Cisco" : "Junos"}
            </button>
          ))}
        </div>
      </div>
      {tools === "sockets" && (
        <div className="space-y-2">
          <p className="text-[11px] text-pv-text-faint">{snap ? "As of the moment the topology is showing." : "As of now."} TCP state lives in these two hosts only.</p>
          <div className="rounded-xl border border-pv-border p-2">
            <p className="mb-1 text-[12px] font-semibold text-pv-text">Laptop</p>
            <SocketTable cfg={s.cfg} snap={live} host="laptop" />
          </div>
          <div className="rounded-xl border border-pv-border p-2">
            <p className="mb-1 text-[12px] font-semibold text-pv-text">Server</p>
            <SocketTable cfg={s.cfg} snap={live} host="server" />
          </div>
          <p className="text-[11px] text-pv-text-faint">R1 has no socket table: it forwards IP packets.</p>
        </div>
      )}
      {tools === "trace" && (playingPlan ? <p className="rounded-xl border border-pv-border p-2 text-[12px] text-pv-text-muted">The path trace of this test appears when it has finished — let it play, or press Skip to end.</p> : <PathTrace s={s} />)}
      {tools === "captures" &&
        (playingPlan ? (
          <p className="rounded-xl border border-pv-border p-2 text-[12px] text-pv-text-muted">This test&apos;s captures appear when it has finished — let it play, or press Skip to end.</p>
        ) : (
          <div className="-mx-3 rounded-xl border border-pv-border">
            <CaptureView s={s} points={TN_POINTS} />
          </div>
        ))}
      {tools === "log" && <LabEventLog entries={[...s.log].reverse().map((l) => ({ id: l.seq, tag: `#${l.seq}`, text: l.text, kind: l.tone === "warn" ? "warning" : l.tone === "ok" ? "learn" : "info" }))} title="Lab log" />}
    </div>
  );

  const ctx = { view: s, snap, act, vendor, setVendor, ios, setIos, junosEdit, setJunosEdit, cand, setCand, consoles, setConsoles, notes, setNotes };

  return (
    <PracticeLabShell
      open={open}
      onClose={onClose}
      title="TCP & UDP Lab"
      sandboxNote={eng ? "Engineering workspace · sandbox, no progress" : "Laptop — R1 — Server · sandbox, no progress"}
      onReset={reset}
      animate={animate}
      onToggleAnimate={() => setAnimate((a) => !a)}
      stages={[]}
      currentStage={0}
      primaryAction={learnAction}
      controls={playerControls}
      topology={topology}
      topologyClassName="h-[300px] sm:h-[clamp(240px,34vh,330px)]"
      topologyFooter={footer}
      eventStrip={<p className="truncate text-[11.5px] text-pv-text-muted" aria-live="polite">{caption}</p>}
      board={
        <div className="space-y-3">
          {header}
          {mode === "learn" && learnBoard}
          {mode === "gate" && gateBoard}
          {eng && engBoard}
          <TcpDesk windows={windows} setWindows={setWindows} focus={focus} setFocus={setFocus} ctx={ctx} />
        </div>
      }
      liveState={liveState}
      liveStateLabel={eng ? "Tools" : "What the endpoints know"}
      mobileTab={mobileTab}
      onMobileTabChange={setMobileTab}
      tabLabels={{ state: eng ? "Tools" : "Sockets" }}
    />
  );
}
