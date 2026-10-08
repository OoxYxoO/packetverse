"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { clsx } from "clsx";
import { PracticeLabShell, type PracticeLabTab } from "@/components/practice-lab/PracticeLabShell";
import { LabEventLog } from "@/components/practice-lab/LabEventLog";
import type { CliVendor } from "@/lib/cli/types";
import type { CliQuestion } from "@/app/demo/dhcp-dns/dhcp-lab/dhcpBuildCli";
import type { ConsoleSession } from "@/app/demo/dhcp-dns/dhcp-lab/ConsoleTerminal";
import { RN_BUILD_PAIRS, RN_CAUSES, RN_ROUTERS, RN_TICKETS, createRouteNet, isRouter, rnApply, rnCauseFeedback, rnClone, rnLastTest, rnPairTest, rnProofs, rnTicket, type RnAction, type RnCause, type RnDecision, type RnDev, type RnRouter, type RnRouterCfg, type RnRun, type RnState, type RnTicketId } from "@/lib/sim-engine/scenarios/routeNet";
import { RnTopology } from "./RnTopology";
import { CaptureView, RnDesk, capPoints, openRnWindow, type RnWin } from "./RnDevices";
import { Card, Composer, Journey, LookupStrip, LpmExplorer, Outcomes, Resolution, RouteTable, TestVerdict, ladder } from "./RnPanels";
import { RN_LEVELS, type RnShow, type RnStep } from "./RnLearn";
import { buildHints } from "./rnPractice";
import { RN_MOMENT_MS, rnMoments } from "./rnMoments";
import { ifName, rnVendorText, type RnIosMode } from "./rnCli";

/**
 * Routing Lab — the shared practice-lab workspace (pinned topology, each test played step by step with Pause / Step /
 * Skip / Replay, the deciding router's lookup pinned under the topology, the teaching board below, the evidence on the
 * right), with routing's own content:
 *
 *   LEARN                  6 levels (RnLearn): connected networks · static route and next hop · longest prefix match ·
 *                          every router decides (default route, routing vs switching vs ARP) · the return path ·
 *                          when routes can't be used (link down, unresolvable next hop, discard, loop)
 *   ENGINEERING WORKSPACE  Investigate (traffic, the LPM explorer, R1–R3 windows with Cisco/Junos consoles, hosts with
 *                          Linux terminals, captures on every interface) · Build (connected-only network → make four
 *                          host pairs work both ways; hints on request) · Troubleshoot (five tickets: reproduce →
 *                          explain → fix on a device → prove with fresh traffic)
 *
 * One model (routeNet.ts) produces every hop, lookup, table, ARP entry, capture and verdict. Nothing here touches the
 * guided lesson or the progress store.
 */

type Mode = "learn" | "gate" | "eng";
type EngTab = "investigate" | "build" | "troubleshoot";
type Tools = "tables" | "journey" | "captures" | "log";
interface Player {
  run?: RnRun;
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
const EXEC: Record<RnRouter, RnIosMode> = { R1: { kind: "exec" }, R2: { kind: "exec" }, R3: { kind: "exec" } };
const candOf = (s: RnState): Record<RnRouter, RnRouterCfg> => rnClone(s.cfg.r);
const buildStep = (t: RnStep, seq: number): RnState => (t.pre ?? []).reduce((acc, a) => rnApply(acc, a), { ...createRouteNet(t.start?.()), seq });
const isTest = (a: RnAction) => a.type === "ping" || a.type === "traceroute";

export function RoutingLabWorkspace({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [mode, setMode] = useState<Mode>("learn");
  const [engTab, setEngTab] = useState<EngTab>("investigate");
  const [level, setLevel] = useState(0);
  const [step, setStep] = useState(0);
  const [unlocked, setUnlocked] = useState(0);
  const [s, setS] = useState<RnState>(() => buildStep(RN_LEVELS[0].steps[0], 0));
  const sRef = useRef(s);
  const [P, setP] = useState<Player>(IDLE);
  const [animate, setAnimate] = useState(true);
  const [ranKey, setRanKey] = useState<string | undefined>(undefined);
  const [answer, setAnswer] = useState<string | undefined>(undefined);
  const [windows, setWindows] = useState<RnWin[]>([]);
  const [focus, setFocus] = useState<RnDev | undefined>(undefined);
  const [vendor, setVendor] = useState<CliVendor>("cisco");
  const [ios, setIosAll] = useState<Record<RnRouter, RnIosMode>>(EXEC);
  const [junosEdit, setJunosAll] = useState<Record<RnRouter, boolean>>({ R1: false, R2: false, R3: false });
  const [cand, setCandAll] = useState<Record<RnRouter, RnRouterCfg>>(() => candOf(s));
  const [consoles, setConsoles] = useState<Record<string, ConsoleSession>>({});
  const [question, setQuestion] = useState<CliQuestion | undefined>(undefined);
  const [notes, setNotes] = useState(true);
  const [guess, setGuess] = useState<RnCause | undefined>(undefined);
  const [found, setFound] = useState(false);
  const [rungs, setRungs] = useState<Record<string, boolean>>({});
  const [hintsShown, setHintsShown] = useState(0);
  const [tools, setTools] = useState<Tools>("tables");
  const [toolRouter, setToolRouter] = useState<RnRouter>("R1");
  const [mobileTab, setMobileTab] = useState<PracticeLabTab>("topology");
  const [ticketSeq, setTicketSeq] = useState(0);

  // ---------------------------------------------------------------- Playback
  const moments = useMemo(() => rnMoments(P.run, s.cfg), [P.run, s.cfg]);
  const n = moments.length;
  const playingPlan = !!P.run && P.cursor < n;
  useEffect(() => {
    if (!P.playing || !P.run || P.cursor >= n) return;
    const t = window.setTimeout(() => setP((p) => (p.key !== P.key ? p : p.cursor + 1 >= n ? { ...p, cursor: n, playing: false } : { ...p, cursor: p.cursor + 1 })), RN_MOMENT_MS);
    return () => window.clearTimeout(t);
  }, [P, n]);
  const show = useCallback(
    (run: RnRun) => {
      setP({ run, key: `r${run.id}-${++playSeq}`, cursor: animate ? 0 : rnMoments(run, sRef.current.cfg).length, playing: animate });
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
  const snap = moment?.snap;
  /** The router decision to pin under the topology: the one on screen, else the last one of the test. */
  const pinned: RnDecision | undefined = (moment ?? prevMoment)?.decisions.find((d) => isRouter(d.at) && d.lookup) ?? (P.run && !playingPlan ? [...P.run.moments.flatMap((m) => m.decisions)].reverse().find((d) => isRouter(d.at) && d.lookup) : undefined);

  const act = useCallback(
    (a: RnAction) => {
      const nx = rnApply(sRef.current, a);
      sRef.current = nx;
      setS(nx);
      if (a.type === "cfg" || a.type === "ticket" || a.type === "fresh" || a.type === "build") setCandAll(candOf(nx));
      if (isTest(a) && nx.last) show(nx.last);
      return nx;
    },
    [show],
  );
  const openWin = (d: RnDev) => {
    setWindows((ws) => openRnWindow(ws, d));
    setFocus(d);
  };
  const resetNet = (start?: RnState) => {
    const ns: RnState = start ?? { ...createRouteNet(), seq: sRef.current.seq + 1 };
    sRef.current = ns;
    setS(ns);
    setP(IDLE);
    setCandAll(candOf(ns));
    setIosAll(EXEC);
    setJunosAll({ R1: false, R2: false, R3: false });
    setQuestion(undefined);
  };

  // ---------------------------------------------------------------- Learn
  const lv = RN_LEVELS[level];
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
    resetNet(buildStep(RN_LEVELS[li].steps[si], sRef.current.seq + 1));
  };
  const runStep = (r: NonNullable<RnStep["runs"]>[number]) => {
    if (!r.keep) resetNet(buildStep(st, sRef.current.seq + 1));
    r.actions.forEach((a) => act(a));
    setRanKey(stepKey);
  };
  const nextStep = () => {
    if (!stepDone) return;
    if (step + 1 < lv.steps.length) return enterStep(level, step + 1);
    if (level + 1 < RN_LEVELS.length) {
      setUnlocked((u) => Math.max(u, level + 1));
      return enterStep(level + 1, 0);
    }
    setP((p) => ({ ...p, cursor: n, playing: false }));
    setMode("gate");
  };
  const toEngineering = () => {
    setUnlocked(RN_LEVELS.length - 1);
    setMode("eng");
    setEngTab("investigate");
    setGuess(undefined);
    setFound(false);
    setRungs({});
    setHintsShown(0);
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
    setHintsShown(0);
    setTools("tables");
    if (mode === "learn") enterStep(level, step);
    else if (engTab === "build") resetNet(rnApply(createRouteNet(), { type: "build" }));
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
    const last = level + 1 >= RN_LEVELS.length && step + 1 >= lv.steps.length;
    return (
      <Pill onClick={nextStep} disabled={!stepDone} tone="primary">
        {step + 1 < lv.steps.length ? "Next →" : last ? "I've finished learning →" : compact ? `Level ${level + 2} →` : `Level ${level + 2}: ${RN_LEVELS[level + 1].title} →`}
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

  // ---------------------------------------------------------------- Topology
  const eng = mode === "eng";
  const showIfs = eng || level >= 1;
  const topologyFor = (compact: boolean) => <RnTopology cfg={s.cfg} moment={moment} prev={prevMoment} runKey={P.key} cursor={P.cursor} compact={compact} onNode={eng || level >= 1 ? openWin : undefined} selected={focus} vendor={vendor} showIfs={showIfs} />;
  const topology = (
    <>
      <div className="h-full sm:hidden">{topologyFor(true)}</div>
      <div className="hidden h-full sm:block">{topologyFor(false)}</div>
    </>
  );
  const footer = (
    <div className="rounded-xl border border-pv-border bg-pv-bg-elevated/40 px-2 py-1.5">
      <LookupStrip d={pinned} vendor={vendor} />
    </div>
  );
  const caption = moment ? moment.lines.map((l) => l.text).join(" · ") : P.run ? (s.log[s.log.length - 1]?.text ?? "") : (s.log[s.log.length - 1]?.text ?? "");
  const momentPanel = P.run && (moment || prevMoment) && (
    <div className="space-y-1">
      {(moment ?? prevMoment)!.lines.slice(0, 6).map((l, i) => (
        <p key={`${P.key}${P.cursor}${i}`} className={clsx("pv-pop rounded-lg border px-2 py-1 text-[12.5px]", l.tone === "bad" ? "border-pv-danger/40 bg-pv-danger/[0.06] text-pv-text" : l.tone === "ok" ? "border-pv-success/40 bg-pv-success/[0.06] text-pv-text" : l.tone === "route" ? "border-pv-cyan/40 bg-pv-cyan/[0.05] text-pv-text" : "border-pv-border text-pv-text")} style={{ animationDelay: `${i * 90}ms` }}>
          {rnVendorText(vendor, l.text)}
        </p>
      ))}
    </div>
  );

  // ---------------------------------------------------------------- Evidence blocks a step asks for
  const done = P.run && !playingPlan ? P.run : undefined;
  const resolving = pinned && pinned.lookup?.winner ? pinned : undefined;
  const evidence = (what: RnShow[]) => (
    <div className="space-y-2">
      {what.includes("resolution") && resolving && (
        <Card title={`${resolving.at}: from winning route to frame`}>
          <Resolution cfg={s.cfg} d={resolving} vendor={vendor} />
        </Card>
      )}
      {done && what.includes("verdict") && (
        <Card title="Result — each direction separately">
          <TestVerdict run={done} cfg={s.cfg} />
        </Card>
      )}
      {done && what.includes("journey") && (
        <Card title="Every decision, in order">
          <Journey run={done} vendor={vendor} />
        </Card>
      )}
      {(["R1", "R2", "R3"] as RnRouter[]).map((r) =>
        what.includes(`table-${r}` as RnShow) ? (
          <Card key={r} title={`${r}'s routing table${pinned?.at === r && pinned.lookup ? ` — looking up ${pinned.pkt.dst}` : ""}`}>
            <RouteTable cfg={s.cfg} r={r} vendor={vendor} lookup={pinned?.at === r ? pinned.lookup : undefined} />
          </Card>
        ) : null,
      )}
      {(what.includes("explorer") || what.includes("explorer-predict")) && (
        <Card title="Longest-prefix explorer">
          <LpmExplorer key={`${stepKey}${mode}`} cfg={s.cfg} vendor={vendor} predict={what.includes("explorer-predict")} initial={st.explore} />
        </Card>
      )}
      {what.includes("outcomes") && (
        <Card title="Four ways a packet stops at a router">
          <Outcomes />
        </Card>
      )}
      {what.includes("capture-SERVER-A") && done && (
        <Card title="SERVER-A's own capture (its NIC)">
          <div className="-mx-3">
            <CaptureView s={s} points={["SERVER-A"]} vendor={vendor} />
          </div>
        </Card>
      )}
      {what.includes("layers") && (
        <div className="grid gap-2 sm:grid-cols-3">
          <Card title="Switch (Switching lesson)">
            <p className="text-[12.5px] text-pv-text-muted">
              <b className="pv-mono text-pv-text">MAC → port</b>. Learned from source MACs, inside one network. Forwards the frame unchanged.
            </p>
          </Card>
          <Card title="Router (this lesson)">
            <p className="text-[12.5px] text-pv-text-muted">
              <b className="pv-mono text-pv-text">IP prefix → next hop + interface</b>. From connected interfaces and configured routes. Longest prefix wins. TTL − 1.
            </p>
          </Card>
          <Card title="ARP (ARP lesson)">
            <p className="text-[12.5px] text-pv-text-muted">
              <b className="pv-mono text-pv-text">next-hop IP → MAC</b>. Only after the route is chosen — the new frame goes to the next hop&apos;s MAC, the IP destination stays the same.
            </p>
          </Card>
        </div>
      )}
    </div>
  );

  // ---------------------------------------------------------------- Boards
  const header = (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1">
        {RN_LEVELS.map((l, li) => (
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
        {(step > 0 || level > 0) && <Pill onClick={() => (step > 0 ? enterStep(level, step - 1) : enterStep(level - 1, RN_LEVELS[level - 1].steps.length - 1))}>← Back</Pill>}
        <span className="flex-1" />
        {learnAction(false)}
      </div>
    </div>
  );
  const gateBoard = (
    <div className="space-y-3 rounded-2xl border border-pv-violet/50 bg-pv-violet/[0.05] p-4">
      <h3 className="text-[16px] font-bold text-pv-text">You can read a router&apos;s decision</h3>
      <ul className="list-disc space-y-1 pl-5 text-[13px] text-pv-text-muted">
        <li>Connected routes come from interfaces that are up; static routes are configured — and installed only if their next hop is reachable on a connected network.</li>
        <li>For each packet: every installed route containing the destination, the longest prefix wins. The default (/0) wins only when nothing else matches.</li>
        <li>Then the next hop: which interface, ARP for its MAC, a new frame, TTL − 1 — and the next router decides again, alone.</li>
        <li>The reply is a separate packet with its own lookups. One direction working proves nothing about the other.</li>
        <li>No route (Net Unreachable), discard (silence), unresolvable next hop (Host Unreachable) and a loop (Time Exceeded) all drop packets — differently.</li>
      </ul>
      <p className="text-[13px] text-pv-text-muted">The engineering workspace gives you R1, R2 and R3 (Cisco or Junos), the hosts with Linux terminals, captures on every interface, a network to build yourself, and five tickets.</p>
      <div className="flex flex-wrap gap-2">
        <Pill onClick={toEngineering} tone="primary">
          Enter the engineering workspace →
        </Pill>
        <Pill onClick={() => toLearn(RN_LEVELS.length - 1)}>Review level 6</Pill>
      </div>
    </div>
  );

  // Troubleshoot
  const t = s.ticket ? rnTicket(s.ticket) : undefined;
  const proofs = rnProofs(s);
  const solved = !!t && proofs.every((p) => p.ok);
  const fb = guess ? rnCauseFeedback(s, guess) : undefined;
  const startTicket = (id: RnTicketId) => {
    setWindows([]);
    setConsoles({});
    setGuess(undefined);
    setFound(false);
    setRungs({});
    setP(IDLE);
    setTicketSeq(act({ type: "ticket", id }).seq);
  };
  const reproduced = !!t && s.runs.some((r) => r.id > ticketSeq);
  const phase = !t ? 0 : !reproduced ? 1 : !found ? 2 : !solved ? 3 : 4;
  const troubleshootBoard = (
    <div className="space-y-3">
      {!t ? (
        <>
          <p className="text-[13px] text-pv-text-muted">Users report symptoms, not causes. Each ticket is this network with one real thing wrong. Reproduce it, follow the packet router by router (what matches? what wins? is it usable? does the reply make it back?), name the cause, fix it on the router, and prove it with fresh traffic.</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {RN_TICKETS.map((x) => (
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
              <p className="text-[13px] text-pv-text-muted">See it yourself first: {t.test.label.toLowerCase()}, and watch where it stops.</p>
              <Pill onClick={() => act({ type: "ping", from: t.test.from, dst: t.test.dst })} disabled={playingPlan} tone="primary">
                Reproduce it ▶
              </Pill>
            </div>
          )}
          {phase >= 2 && (
            <div className="space-y-1.5">
              <p className="text-[13px] text-pv-text-muted">Walk the evidence in order — open each question once you&apos;ve looked (tables, the lookup strip, captures, the routers&apos; consoles, traceroute):</p>
              <div className="grid gap-1">
                {ladder(s, vendor, rnLastTest(s)).map((r, i) => (
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
                {RN_CAUSES.map((c) => {
                  const picked = guess === c.id;
                  if (found && !picked) return null;
                  return (
                    <div key={c.id}>
                      <button
                        type="button"
                        disabled={found}
                        onClick={() => {
                          setGuess(c.id);
                          if (rnCauseFeedback(s, c.id).right) setFound(true);
                        }}
                        className={clsx("w-full rounded-lg border px-2 py-1 text-left text-[12.5px]", picked ? (fb?.right ? "border-pv-success/60 bg-pv-success/10 text-pv-text" : "border-pv-warning/50 text-pv-text-muted") : "border-pv-border text-pv-text hover:border-pv-violet/60")}
                      >
                        {picked ? (fb?.right ? "✓ " : "✗ ") : ""}
                        {c.label}
                      </button>
                      {picked && fb && (
                        <p className={clsx("px-2 py-1 text-[12px]", fb.right ? "text-pv-success" : "text-pv-text-muted")}>
                          {!fb.right && <b className="text-pv-warning">{fb.consequence ? "Consequence, not cause. " : "Not the cause. "}</b>}
                          {rnVendorText(vendor, fb.text)}
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
              <p className="text-[13px] font-semibold text-pv-text">{solved ? "Proved" : "Fix it on the router, check its table, then prove it with traffic"}</p>
              {!solved && <p className="text-[12.5px] text-pv-text-muted">Change it in the router&apos;s console (or window), read its table (show ip route / show route), then run the user&apos;s test again. An accepted command isn&apos;t a working path.</p>}
              <ul className="space-y-0.5">
                {proofs.map((p) => (
                  <li key={p.label} className={clsx("text-[12.5px]", p.ok ? "text-pv-success" : "text-pv-text-muted")}>
                    {p.ok ? "✓" : "○"} {p.label} <span className="text-[11.5px] text-pv-text-faint">— {rnVendorText(vendor, p.detail)}</span>
                  </li>
                ))}
              </ul>
              {!solved && (
                <div className="flex flex-wrap gap-1">
                  <Pill onClick={() => act({ type: "ping", from: t.test.from, dst: t.test.dst })} disabled={playingPlan}>
                    ▶ Run the user&apos;s test again
                  </Pill>
                  {t.id === "discard" && (
                    <Pill onClick={() => act({ type: "ping", from: "HOST-A", dst: "172.16.50.200" })} disabled={playingPlan}>
                      ▶ Ping SERVER-B too
                    </Pill>
                  )}
                </div>
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

  // Build
  const pairs = RN_BUILD_PAIRS.map((p) => ({ p, run: rnPairTest(s, p) }));
  const built = s.build && pairs.every((x) => x.run?.ok);
  const hint = s.build ? buildHints(s, vendor) : { hints: [] };
  const buildBoard = (
    <div className="space-y-2">
      {!s.build ? (
        <div className="space-y-2">
          <p className="text-[13px] text-pv-text-muted">You get the same three routers with their interfaces configured — and <b className="text-pv-text">no static routes at all</b>. Make every pair below work in both directions. Decide which router needs which route, configure it in the router&apos;s console (Cisco or Junos), check its table, and prove it with traffic. Hints are there if you want them.</p>
          <Pill tone="primary" onClick={() => (setHintsShown(0), setConsoles({}), resetNet(rnApply(createRouteNet(), { type: "build" })))}>
            Start the build →
          </Pill>
        </div>
      ) : (
        <>
          <p className="text-[13px] text-pv-text-muted">Each check is a real ping (request AND reply), run against the network as it is now. A change makes earlier results stale.</p>
          <ol className="space-y-1">
            {pairs.map(({ p, run }) => (
              <li key={p.label} className={clsx("flex flex-wrap items-center gap-2 rounded-lg border px-2 py-1.5", run?.ok ? "border-pv-success/50 bg-pv-success/[0.05]" : run ? "border-pv-danger/40" : "border-pv-border")}>
                <span className={clsx("text-[12.5px] font-semibold", run?.ok ? "text-pv-success" : "text-pv-text")}>
                  {run?.ok ? "✓" : run ? "✕" : "○"} {p.label}
                </span>
                <span className="text-[11.5px] text-pv-text-muted">{run ? (run.ok ? "works both ways" : run.probes[0]?.failedLeg === "reply" ? `request arrives, reply dies at ${run.probes[0].stopAt}` : `stops at ${run.probes[0]?.stopAt ?? "?"} (${run.probes[0]?.stop ?? "?"})`) : "not tested since the last change"}</span>
                <span className="flex-1" />
                <Pill onClick={() => act({ type: "ping", from: p.from, dst: p.dst })} disabled={playingPlan}>
                  Test ▶
                </Pill>
              </li>
            ))}
          </ol>
          {built ? (
            <p className="rounded-lg border border-pv-success/50 bg-pv-success/[0.06] px-2 py-1.5 text-[12.5px] font-semibold text-pv-success">Built and proved: every network reaches every other one it needs, both ways. Compare your routes with your neighbor&apos;s — there is more than one correct answer.</p>
          ) : (
            <div className="space-y-1 rounded-xl border border-pv-border p-2">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-[12.5px] font-semibold text-pv-text">Hints{hint.pair ? ` — for ${hint.pair}` : ""}</p>
                <Pill onClick={() => setHintsShown((h) => Math.min(h + 1, hint.hints.length))} disabled={hintsShown >= hint.hints.length}>
                  {hintsShown === 0 ? "I need a hint" : "Next hint"}
                </Pill>
              </div>
              {hint.hints.slice(0, hintsShown).map((h) => (
                <p key={h.level} className="text-[12.5px] text-pv-text-muted">
                  <b className="text-pv-text">{h.level}.</b> {rnVendorText(vendor, h.text)}
                </p>
              ))}
            </div>
          )}
          <div className="flex flex-wrap gap-1">
            {RN_ROUTERS.map((r) => (
              <Pill key={r} onClick={() => openWin(r)}>
                Open {r}
              </Pill>
            ))}
            <Pill onClick={() => (setHintsShown(0), resetNet(rnApply(createRouteNet(), { type: "build" })))}>Start over</Pill>
          </div>
        </>
      )}
    </div>
  );
  const deviceButtons = (
    <div className="flex flex-wrap gap-1">
      {(["R1", "R2", "R3", "HOST-A", "SERVER-A", "SERVER-B", "SERVER-C"] as RnDev[]).map((d) => (
        <button key={d} type="button" onClick={() => openWin(d)} className="rounded-md border border-pv-border px-2 py-0.5 text-[12px] font-semibold text-pv-text-muted hover:border-pv-cyan/60 hover:text-pv-text">
          {isRouter(d) ? `⇄ ${d}` : `${d === "HOST-A" ? "💻" : "🗄"} ${d}`}
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
            ["build", "Build"],
            ["troubleshoot", "Troubleshoot"],
          ] as const
        ).map(([m, label]) => (
          <button key={m} type="button" role="tab" aria-selected={engTab === m} onClick={() => (setEngTab(m), setGuess(undefined), setFound(false), setRungs({}), setHintsShown(0), setConsoles({}), setWindows([]), resetNet())} className={clsx("rounded-lg border px-3 py-1 text-[12.5px] font-semibold", engTab === m ? "border-pv-violet bg-pv-violet/15 text-pv-text" : "border-pv-border text-pv-text-muted hover:text-pv-text")}>
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
      <Composer s={s} act={(a) => act(a)} busy={playingPlan} />
      {engTab === "investigate" && (
        <>
          <Card title="Longest-prefix explorer">
            <LpmExplorer cfg={s.cfg} vendor={vendor} />
          </Card>
          <div className="space-y-2 text-[13px] text-pv-text-muted">
            <p>The same network, yours. Things worth proving with evidence:</p>
            <ul className="list-disc space-y-0.5 pl-5 text-[12.5px]">
              <li>Add a host route 172.16.50.200/32 via R3 on R1. Which server changes path? (traceroute both.)</li>
              <li>Remove R1&apos;s 172.16.50.0/24: where does SERVER-A&apos;s traffic go now, and why does it still work?</li>
              <li>Shut R2&apos;s ge-0/0/2. Which routes on R2 and R3 stop being installed? Does anything break?</li>
              <li>Point R3&apos;s route to 10.10.10.0/24 at R2. Ping SERVER-C: which way does the reply go?</li>
              <li>Ping 203.0.113.80 from HOST-A, then add a discard default on R3. What changes in the evidence?</li>
            </ul>
            <Pill onClick={() => resetNet()}>Fresh network</Pill>
          </div>
        </>
      )}
      {P.run && (
        <details open className="rounded-xl border border-pv-border p-2">
          <summary className="cursor-pointer text-[12px] font-semibold text-pv-text">Test: {P.run.cmd}</summary>
          <div className="mt-2 space-y-2">
            {momentPanel}
            {done && <TestVerdict run={done} cfg={s.cfg} />}
            {done && <pre className="overflow-x-auto rounded-lg border border-white/10 bg-[#05080d] px-3 py-2 pv-mono text-[11px] text-pv-text-muted">{done.output}</pre>}
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
            ["tables", "Routing tables"],
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
        <div className="flex rounded-full border border-pv-border p-0.5 text-[11px]" aria-label="Router OS">
          {(["cisco", "juniper"] as const).map((x) => (
            <button key={x} type="button" aria-pressed={vendor === x} onClick={() => setVendor(x)} className={clsx("rounded-full px-2 py-0.5 font-semibold", vendor === x ? "bg-pv-cyan/20 text-pv-text" : "text-pv-text-faint")}>
              {x === "cisco" ? "Cisco" : "Junos"}
            </button>
          ))}
        </div>
      </div>
      {tools === "tables" && (
        <div className="space-y-2">
          <div className="flex gap-1">
            {RN_ROUTERS.map((r) => (
              <button key={r} type="button" aria-pressed={toolRouter === r} onClick={() => setToolRouter(r)} className={clsx("rounded-full border px-2.5 py-0.5 text-[12px] font-semibold", toolRouter === r ? "border-pv-cyan bg-pv-cyan/15 text-pv-text" : "border-pv-border text-pv-text-muted")}>
                {r}
                {pinned?.at === r ? " ●" : ""}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-pv-text-faint">Each router&apos;s own table. ● = deciding in the step on screen; its comparison is shown.</p>
          <RouteTable cfg={s.cfg} r={toolRouter} vendor={vendor} lookup={pinned?.at === toolRouter ? pinned.lookup : undefined} compact />
          {snap && <p className="text-[11px] text-pv-text-faint">ARP on {toolRouter}: {Object.entries(snap.arp[toolRouter]).map(([ip, m]) => `${ip}${m === "incomplete" ? " (incomplete)" : ""}`).join(", ") || "empty"}</p>}
          <p className="text-[11.5px] text-pv-text-muted">
            Interfaces: {(["ge-0/0/0", "ge-0/0/1", "ge-0/0/2"] as const).map((i) => `${ifName(vendor, i)} ${s.cfg.r[toolRouter].ifs[i].addr}/${s.cfg.r[toolRouter].ifs[i].len}`).join(" · ")}
          </p>
        </div>
      )}
      {tools === "journey" && (playingPlan ? <p className="rounded-xl border border-pv-border p-2 text-[12px] text-pv-text-muted">The full journey appears when the test has finished — let it play, or press Skip to end.</p> : s.last ? <Journey run={s.last} vendor={vendor} max={120} /> : <p className="text-[12.5px] text-pv-text-faint">Send a test first.</p>)}
      {tools === "captures" &&
        (playingPlan ? (
          <p className="rounded-xl border border-pv-border p-2 text-[12px] text-pv-text-muted">This test&apos;s captures appear when it has finished — let it play, or press Skip to end.</p>
        ) : (
          <div className="-mx-3 rounded-xl border border-pv-border">
            <CaptureView key={s.seq} s={s} points={capPoints()} initial="R1 ge-0/0/1" vendor={vendor} />
          </div>
        ))}
      {tools === "log" && <LabEventLog entries={[...s.log].reverse().slice(0, 80).map((l, i) => ({ id: s.log.length - i, tag: `#${l.seq}`, text: rnVendorText(vendor, l.text), kind: l.tone === "warn" ? "warning" : l.tone === "ok" ? "learn" : "info" }))} title="Lab log" />}
    </div>
  );

  const setIos = (r: RnRouter, m: RnIosMode) => setIosAll((x) => ({ ...x, [r]: m }));
  const setJunosEdit = (r: RnRouter, b: boolean) => setJunosAll((x) => ({ ...x, [r]: b }));
  const setCand = (r: RnRouter, c: RnRouterCfg) => setCandAll((x) => ({ ...x, [r]: c }));
  const ctx = { view: s, snap, act, vendor, setVendor, ios, setIos, junosEdit, setJunosEdit, cand, setCand, consoles, setConsoles, notes, setNotes, question, setQuestion };

  return (
    <PracticeLabShell
      open={open}
      onClose={onClose}
      title="Routing Lab"
      sandboxNote={eng ? "Engineering workspace · sandbox, no progress" : "R1 · R2 · R3 · sandbox, no progress"}
      onReset={reset}
      animate={animate}
      onToggleAnimate={() => setAnimate((a) => !a)}
      stages={[]}
      currentStage={0}
      primaryAction={learnAction}
      controls={playerControls}
      topology={topology}
      topologyClassName="h-[320px] sm:h-[clamp(300px,40vh,380px)]"
      topologyFooter={footer}
      eventStrip={<p className="truncate text-[11.5px] text-pv-text-muted" aria-live="polite">{rnVendorText(vendor, caption)}</p>}
      board={
        <div className="space-y-3">
          {header}
          {mode === "learn" && learnBoard}
          {mode === "gate" && gateBoard}
          {eng && engBoard}
          <RnDesk windows={windows} setWindows={setWindows} focus={focus} setFocus={setFocus} ctx={ctx} />
        </div>
      }
      liveState={liveState}
      liveStateLabel={eng ? "Tools" : "What each router knows"}
      mobileTab={mobileTab}
      onMobileTabChange={setMobileTab}
      tabLabels={{ state: eng ? "Tools" : "Tables" }}
    />
  );
}
