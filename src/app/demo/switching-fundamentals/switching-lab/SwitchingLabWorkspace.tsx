"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { clsx } from "clsx";
import { PracticeLabShell, type PracticeLabTab } from "@/components/practice-lab/PracticeLabShell";
import { LabEventLog } from "@/components/practice-lab/LabEventLog";
import type { CliVendor } from "@/lib/cli/types";
import type { CliQuestion } from "@/app/demo/dhcp-dns/dhcp-lab/dhcpBuildCli";
import type { ConsoleSession } from "@/app/demo/dhcp-dns/dhcp-lab/ConsoleTerminal";
import { SN_CAUSES, SN_PORTS, SN_TICKETS, createSwitchNet, isUplink, snActiveUplinks, snApply, snCauseFeedback, snCirculating, snLastRepro, snProofs, snTicket, type SnAction, type SnCause, type SnDev, type SnRun, type SnSnap, type SnState, type SnSw, type SnSwCfg, type SnTicketId } from "@/lib/sim-engine/scenarios/switchNet";
import { FdbCard, SnTopology } from "./SnTopology";
import { CaptureView, SnDesk, capPoints, openSnWindow, type SnWin } from "./SnDevices";
import { Card, Composer, Copies, Flaps, Journey, LinkLoad, Pipeline, Uplinks, WhereIs, ladder } from "./SnPanels";
import { SN_LEVELS, type SnShow, type SnStep } from "./SnLearn";
import { SN_CHALLENGES } from "./snPractice";
import { SN_MOMENT_MS, SN_TRAVEL_MS, snMoments } from "./snMoments";
import { snPortName, snVendorText, type SnIosMode } from "./snCli";

/**
 * Switching Lab — the shared practice-lab workspace (pinned topology, each run played hop by hop with Pause / Step /
 * Skip / Replay, the current hop in one line, the teaching board below, the evidence on the right), with multi-switch
 * Layer-2 content:
 *
 *   LEARN                  6 levels (SnLearn): two tables · local stays local · broadcast · learned state changes
 *                          (aging, clearing, a host moving) · a second link · storm, flapping, recovery, why STP
 *   ENGINEERING WORKSPACE  Investigate (traffic composer, SW1/SW2 windows with Cisco/Junos consoles, host windows,
 *                          captures on every port) · Challenges (six, checked from the network) · Troubleshoot (five
 *                          tickets: reproduce → explain → fix on a device → prove with fresh traffic)
 *
 * One model (switchNet.ts) produces every hop, table, counter, capture and verdict. Nothing here touches the guided
 * lesson or the progress store.
 */

type Mode = "learn" | "gate" | "eng";
type EngTab = "investigate" | "challenges" | "troubleshoot";
type Tools = "tables" | "journey" | "captures" | "counters" | "log";
interface Player {
  run?: SnRun;
  /** Tables and counters just before the run. */
  base?: SnSnap;
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
const SW_IOS: Record<SnSw, SnIosMode> = { SW1: { kind: "exec" }, SW2: { kind: "exec" } };
const snapOf = (s: SnState): SnSnap => ({ fdb: s.fdb, counters: s.counters });
const candOf = (s: SnState): Record<SnSw, SnSwCfg> => JSON.parse(JSON.stringify(s.cfg.sw)) as Record<SnSw, SnSwCfg>;
const buildStep = (t: SnStep, seq: number): SnState => (t.pre ?? []).reduce((acc, a) => snApply(acc, a), { ...createSwitchNet(), seq });

export function SwitchingLabWorkspace({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [mode, setMode] = useState<Mode>("learn");
  const [engTab, setEngTab] = useState<EngTab>("investigate");
  const [level, setLevel] = useState(0);
  const [step, setStep] = useState(0);
  const [unlocked, setUnlocked] = useState(0);
  const [s, setS] = useState<SnState>(() => createSwitchNet());
  const sRef = useRef(s);
  const [P, setP] = useState<Player>(IDLE);
  const [landedKey, setLandedKey] = useState("");
  const [animate, setAnimate] = useState(true);
  const [ranKey, setRanKey] = useState<string | undefined>(undefined);
  const [answer, setAnswer] = useState<string | undefined>(undefined);
  const [windows, setWindows] = useState<SnWin[]>([]);
  const [focus, setFocus] = useState<SnDev | undefined>(undefined);
  const [vendor, setVendor] = useState<CliVendor>("juniper");
  const [ios, setIosAll] = useState<Record<SnSw, SnIosMode>>(SW_IOS);
  const [junosEdit, setJunosAll] = useState<Record<SnSw, boolean>>({ SW1: false, SW2: false });
  const [cand, setCandAll] = useState<Record<SnSw, SnSwCfg>>(() => candOf(s));
  const [consoles, setConsoles] = useState<Record<string, ConsoleSession>>({});
  const [question, setQuestion] = useState<CliQuestion | undefined>(undefined);
  const [notes, setNotes] = useState(true);
  const [guess, setGuess] = useState<SnCause | undefined>(undefined);
  const [found, setFound] = useState(false);
  const [rungs, setRungs] = useState<Record<string, boolean>>({});
  const [tools, setTools] = useState<Tools>("tables");
  const [mobileTab, setMobileTab] = useState<PracticeLabTab>("topology");
  const [ticketSeq, setTicketSeq] = useState(0);

  // ---------------------------------------------------------------- Playback (one moment per hop)
  const moments = useMemo(() => snMoments(P.run, s.cfg), [P.run, s.cfg]);
  const n = moments.length;
  const playingPlan = !!P.run && P.cursor < n;
  const curKey = `${P.key}:${P.cursor}`;
  useEffect(() => {
    if (!P.playing || !P.run || P.cursor >= n) return;
    const t = window.setTimeout(() => setP((p) => (p.key !== P.key ? p : p.cursor + 1 >= n ? { ...p, cursor: n, playing: false } : { ...p, cursor: p.cursor + 1 })), SN_MOMENT_MS);
    return () => window.clearTimeout(t);
  }, [P, n]);
  // A copy "lands" when its marker reaches the device: only then does that switch's table change on screen.
  useEffect(() => {
    if (!playingPlan) return;
    const k = curKey;
    const t = window.setTimeout(() => setLandedKey(k), SN_TRAVEL_MS);
    return () => window.clearTimeout(t);
  }, [curKey, playingPlan]);
  const landed = landedKey === curKey;
  const show = useCallback(
    (run: SnRun, base: SnSnap) => {
      setP({ run, base, key: `r${run.id}-${++playSeq}`, cursor: animate ? 0 : snMoments(run, sRef.current.cfg).length, playing: animate });
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
  /** Tables and counters as of what the topology is showing. */
  const snap: SnSnap | undefined = moment ? (landed ? moment.snap : (prevMoment?.snap ?? P.base)) : undefined;
  const live = snap ?? snapOf(s);

  const act = useCallback(
    (a: SnAction) => {
      const before = sRef.current;
      const nx = snApply(before, a);
      sRef.current = nx;
      setS(nx);
      if (a.type === "cfg" || a.type === "ticket" || a.type === "fresh" || a.type === "move") setCandAll(candOf(nx));
      if (nx.last && nx.last !== before.last) show(nx.last, snapOf(before));
      return nx;
    },
    [show],
  );
  const openWin = (d: SnDev) => {
    setWindows((ws) => openSnWindow(ws, d));
    setFocus(d);
  };
  const resetNet = (start?: SnState) => {
    const ns: SnState = start ?? { ...createSwitchNet(), seq: sRef.current.seq + 1 };
    sRef.current = ns;
    setS(ns);
    setP(IDLE);
    setCandAll(candOf(ns));
    setIosAll(SW_IOS);
    setJunosAll({ SW1: false, SW2: false });
    setQuestion(undefined);
  };

  // ---------------------------------------------------------------- Learn
  const lv = SN_LEVELS[level];
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
    resetNet(buildStep(SN_LEVELS[li].steps[si], sRef.current.seq + 1));
  };
  const runStep = (r: NonNullable<SnStep["runs"]>[number]) => {
    if (!r.keep) resetNet(buildStep(st, sRef.current.seq + 1));
    r.actions.forEach((a) => act(a));
    setRanKey(stepKey);
  };
  const nextStep = () => {
    if (!stepDone) return;
    if (step + 1 < lv.steps.length) return enterStep(level, step + 1);
    if (level + 1 < SN_LEVELS.length) {
      setUnlocked((u) => Math.max(u, level + 1));
      return enterStep(level + 1, 0);
    }
    setP((p) => ({ ...p, cursor: n, playing: false }));
    setMode("gate");
  };
  const toEngineering = () => {
    setUnlocked(SN_LEVELS.length - 1);
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
    setVendor("juniper");
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
    const last = level + 1 >= SN_LEVELS.length && step + 1 >= lv.steps.length;
    return (
      <Pill onClick={nextStep} disabled={!stepDone} tone="primary">
        {step + 1 < lv.steps.length ? "Next →" : last ? "I've finished learning →" : compact ? `Level ${level + 2} →` : `Level ${level + 2}: ${SN_LEVELS[level + 1].title} →`}
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
  const showPorts = eng || level >= 1;
  const clickable = eng || level >= 1;
  const topologyFor = (compact: boolean) => <SnTopology cfg={s.cfg} snap={live} moment={moment} prev={prevMoment} landed={landed} runKey={P.key} cursor={P.cursor} compact={compact} onNode={clickable ? openWin : undefined} selected={focus} showPorts={showPorts} vendor={vendor} />;
  const topology = (
    <>
      <div className="h-full sm:hidden">{topologyFor(true)}</div>
      <div className="hidden h-full sm:block">{topologyFor(false)}</div>
    </>
  );
  const shownDecisions = (landed ? moment?.decisions : prevMoment?.decisions) ?? [];
  const circ = snCirculating(s);
  const footer = (
    <div className="space-y-1.5">
      <div className="grid grid-cols-2 gap-1.5 sm:hidden">
        {(["SW1", "SW2"] as SnSw[]).map((sw) => (
          <FdbCard key={sw} short sw={sw} vendor={vendor} cfg={s.cfg} snap={live} decisions={moment ? shownDecisions.filter((d) => d.sw === sw) : []} />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11.5px] text-pv-text-muted">
        <span>
          SW1↔SW2 forwarding: <b className={clsx("pv-mono", snActiveUplinks(s.cfg).length > 1 ? "text-pv-danger" : "text-pv-text")}>{snActiveUplinks(s.cfg).map((p) => snPortName(vendor, p)).join(" + ") || "none"}</b>
        </span>
        {circ > 0 && <span className="font-semibold text-pv-danger">{circ.toLocaleString("en-US")} cop{circ === 1 ? "y" : "ies"} circulating — no TTL stops them</span>}
        <span className="text-pv-text-faint">no loop prevention (STP off) · lab clock {s.clock} s</span>
      </div>
    </div>
  );
  const caption = moment ? moment.lines.map((l) => l.text).join(" · ") : P.run ? (s.log[s.log.length - 1]?.text ?? "") : (s.log[s.log.length - 1]?.text ?? "");
  const momentPanel = P.run && (moment || prevMoment) && (
    <div className="space-y-1">
      {(moment ?? prevMoment)!.lines.slice(0, 8).map((l, i) => (
        <p key={`${P.key}${P.cursor}${i}`} className={clsx("pv-pop rounded-lg border px-2 py-1 text-[12.5px]", l.tone === "bad" ? "border-pv-danger/40 bg-pv-danger/[0.06] text-pv-text" : l.tone === "ok" ? "border-pv-success/40 bg-pv-success/[0.06] text-pv-text" : l.tone === "learn" ? "border-pv-violet/40 bg-pv-violet/[0.06] text-pv-text" : "border-pv-cyan/30 bg-pv-cyan/[0.04] text-pv-text")} style={{ animationDelay: `${moment ? SN_TRAVEL_MS * 0.6 + i * 90 : i * 60}ms` }}>
          {snVendorText(vendor, l.text)}
        </p>
      ))}
      {(moment ?? prevMoment)!.lines.length > 8 && <p className="text-[11.5px] text-pv-text-faint">… and {(moment ?? prevMoment)!.lines.length - 8} more things happened in this hop.</p>}
    </div>
  );

  // ---------------------------------------------------------------- Evidence blocks a step asks for
  const done = P.run && !playingPlan ? P.run : undefined;
  const pipelines = (moment ? shownDecisions : (done?.waves.flatMap((w) => w.decisions) ?? [])).slice(0, moment ? 2 : 3);
  const uplinkDelta = (run: SnRun) =>
    (["SW1", "SW2"] as SnSw[]).flatMap((sw) =>
      SN_PORTS.filter((p) => isUplink(p) && s.cfg.cables[p as "ge-0/0/23"]).map((p) => ({ k: `${sw} ${p}`, sw, p, out: (s.counters[`${sw} ${p}`].outF - (run.before[`${sw} ${p}`]?.outF ?? 0)) })),
    );
  const evidence = (what: SnShow[]) => (
    <div className="space-y-2">
      {what.includes("pipeline") && pipelines.length > 0 && (
        <Card title={moment ? "Inside the switch, right now" : "Inside each switch (first decisions of the run)"}>
          <div className="space-y-1.5">
            {pipelines.map((d, i) => (
              <div key={`${d.sw}${d.frame.id}${d.port}${i}`} className="space-y-0.5">
                <p className="text-[11.5px] font-semibold text-pv-text">{d.sw}</p>
                <Pipeline cfg={s.cfg} d={d} />
              </div>
            ))}
          </div>
        </Card>
      )}
      {done && what.includes("journey") && (
        <Card title="The frame's journey, hop by hop">
          <Journey cfg={s.cfg} run={done} vendor={vendor} />
        </Card>
      )}
      {what.includes("where") && (
        <Card title="Where is each host — really, and according to each switch?">
          <WhereIs cfg={s.cfg} snap={live} vendor={vendor} />
        </Card>
      )}
      {done && what.includes("copies") && (
        <Card title="Copies each host received in this run" tone={done.results.some(() => false) ? "bad" : "plain"}>
          <Copies cfg={s.cfg} run={done} />
        </Card>
      )}
      {done && what.includes("load") && (
        <Card title="Load on the SW1↔SW2 links">
          <LinkLoad run={done} />
        </Card>
      )}
      {what.includes("flaps") && (
        <Card title="MAC entries that moved">
          <Flaps s={s} vendor={vendor} />
        </Card>
      )}
      {what.includes("uplinks") && (
        <Card title="Links between the switches">
          <Uplinks cfg={s.cfg} vendor={vendor} />
        </Card>
      )}
      {done && what.includes("uplinkCounters") && (
        <Card title="Frames sent on the uplinks during this run (interface counters)">
          <ul className="pv-mono space-y-0.5 text-[12px]">
            {uplinkDelta(done).map((x) => (
              <li key={x.k} className={x.out ? "text-pv-warning" : "text-pv-text-muted"}>
                {x.sw} {snPortName(vendor, x.p)} out: +{x.out.toLocaleString("en-US")}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );

  // ---------------------------------------------------------------- Boards
  const header = (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1">
        {SN_LEVELS.map((l, li) => (
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
        {(step > 0 || level > 0) && <Pill onClick={() => (step > 0 ? enterStep(level, step - 1) : enterStep(level - 1, SN_LEVELS[level - 1].steps.length - 1))}>← Back</Pill>}
        <span className="flex-1" />
        {learnAction(false)}
      </div>
    </div>
  );
  const gateBoard = (
    <div className="space-y-3 rounded-2xl border border-pv-violet/50 bg-pv-violet/[0.05] p-4">
      <h3 className="text-[16px] font-bold text-pv-text">You can follow a frame through several switches</h3>
      <ul className="list-disc space-y-1 pl-5 text-[13px] text-pv-text-muted">
        <li>Every switch has its own MAC table, learned only from source MACs arriving on its own ports. Hosts on the other switch sit behind the uplink.</li>
        <li>Every switch looks up the destination on its own: known → one port, unknown or broadcast → flood. A frame can be known at one switch and unknown at the next.</li>
        <li>Local traffic stays local once the switch knows both ends. A broadcast reaches every host of the domain once.</li>
        <li>Learned state ages out, is flushed when a port goes down, and goes stale when a silent host moves.</li>
        <li>Two forwarding paths between switches = a loop. Ethernet has no TTL: floods circulate forever, MACs flap, a third path makes a storm. Only removing a path stops it — that&apos;s what Spanning Tree automates.</li>
      </ul>
      <p className="text-[13px] text-pv-text-muted">The engineering workspace gives you SW1 and SW2 in their own windows (ports and counters, their own MAC tables, Cisco/Junos consoles, captures on every port), the hosts, six hands-on challenges and five tickets to solve from evidence.</p>
      <div className="flex flex-wrap gap-2">
        <Pill onClick={toEngineering} tone="primary">
          Enter the engineering workspace →
        </Pill>
        <Pill onClick={() => toLearn(SN_LEVELS.length - 1)}>Review level 6</Pill>
      </div>
    </div>
  );

  // Troubleshoot
  const t = s.ticket ? snTicket(s.ticket) : undefined;
  const proofs = snProofs(s);
  const solved = !!t && proofs.every((p) => p.ok);
  const fb = guess ? snCauseFeedback(s, guess) : undefined;
  const repro = snLastRepro(s);
  const startTicket = (id: SnTicketId) => {
    setWindows([]);
    setConsoles({});
    setGuess(undefined);
    setFound(false);
    setRungs({});
    setP(IDLE);
    setTicketSeq(act({ type: "ticket", id }).seq);
  };
  const reproduced = !!t && s.runs.some((r) => r.id > ticketSeq && !r.background);
  const phase = !t ? 0 : !reproduced ? 1 : !found ? 2 : !solved ? 3 : 4;
  const troubleshootBoard = (
    <div className="space-y-3">
      {!t ? (
        <>
          <p className="text-[13px] text-pv-text-muted">Users report symptoms, not causes. Each ticket is this network after a normal morning of traffic, with one real thing wrong. Reproduce it, compare what each switch believes with where the hosts really are, follow the frame port by port, name the cause, fix it on the device, and prove it with fresh traffic.</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {SN_TICKETS.map((x) => (
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
              <p className="text-[13px] text-pv-text-muted">See it yourself first: {t.reproLabel.toLowerCase()}, and watch where the frames go.</p>
              <Pill onClick={() => act({ type: "traffic", sends: t.repro })} disabled={playingPlan} tone="primary">
                Reproduce it ▶
              </Pill>
            </div>
          )}
          {phase >= 2 && (
            <div className="space-y-1.5">
              <p className="text-[13px] text-pv-text-muted">Walk the evidence in order — open each question once you&apos;ve looked (the tables, the journey, captures, the switch consoles):</p>
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
                {SN_CAUSES.map((c) => {
                  const picked = guess === c.id;
                  if (found && !picked) return null;
                  return (
                    <div key={c.id}>
                      <button
                        type="button"
                        disabled={found}
                        onClick={() => {
                          setGuess(c.id);
                          if (snCauseFeedback(s, c.id).right) setFound(true);
                        }}
                        className={clsx("w-full rounded-lg border px-2 py-1 text-left text-[12.5px]", picked ? (fb?.right ? "border-pv-success/60 bg-pv-success/10 text-pv-text" : "border-pv-warning/50 text-pv-text-muted") : "border-pv-border text-pv-text hover:border-pv-violet/60")}
                      >
                        {picked ? (fb?.right ? "✓ " : "✗ ") : ""}
                        {c.label}
                      </button>
                      {picked && fb && (
                        <p className={clsx("px-2 py-1 text-[12px]", fb.right ? "text-pv-success" : "text-pv-text-muted")}>
                          {!fb.right && <b className="text-pv-warning">Not the cause. </b>}
                          {snVendorText(vendor, fb.text)}
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
              <p className="text-[13px] font-semibold text-pv-text">{solved ? "Proved" : "Fix it, check the switches, then prove it with traffic"}</p>
              {!solved && <p className="text-[12.5px] text-pv-text-muted">Change it on the device (its window, or its console), check the switches&apos; own state (MAC tables, interface status, logs), then run the user&apos;s test again. An accepted command isn&apos;t a repaired network.</p>}
              <ul className="space-y-0.5">
                {proofs.map((p) => (
                  <li key={p.label} className={clsx("text-[12.5px]", p.ok ? "text-pv-success" : "text-pv-text-muted")}>
                    {p.ok ? "✓" : "○"} {snVendorText(vendor, p.label)} <span className="text-[11.5px] text-pv-text-faint">— {snVendorText(vendor, p.detail)}</span>
                  </li>
                ))}
              </ul>
              {!solved && (
                <Pill onClick={() => act({ type: "traffic", sends: t.repro })} disabled={playingPlan}>
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
      <p className="text-[13px] text-pv-text-muted">Operate the network yourself. Each challenge is checked from what the network did — the frames it carried, the tables it learned — not from what you clicked. They build on each other; Start over gives a fresh network.</p>
      <ol className="space-y-1">
        {SN_CHALLENGES.map((c, i) => {
          const ok = c.done(s);
          return (
            <li key={c.id} className={clsx("rounded-lg border px-2 py-1.5", ok ? "border-pv-success/50 bg-pv-success/[0.05]" : "border-pv-border")}>
              <p className={clsx("text-[12.5px] font-semibold", ok ? "text-pv-success" : "text-pv-text")}>
                {ok ? "✓" : `${i + 1}.`} {c.title}
              </p>
              <p className="text-[12px] text-pv-text-muted">{c.how}</p>
            </li>
          );
        })}
      </ol>
      <Pill onClick={() => resetNet()}>Start over</Pill>
    </div>
  );
  const deviceButtons = (
    <div className="flex flex-wrap gap-1">
      {(["SW1", "SW2", "HOST-A", "HOST-D", "HOST-B", "HOST-C", ...(s.cfg.hosts["HOST-E"].at ? (["HOST-E"] as const) : [])] as SnDev[]).map((d) => (
        <button key={d} type="button" onClick={() => openWin(d)} className="rounded-md border border-pv-border px-2 py-0.5 text-[12px] font-semibold text-pv-text-muted hover:border-pv-cyan/60 hover:text-pv-text">
          {d === "SW1" || d === "SW2" ? `⇄ ${d}` : `💻 ${d}`}
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
            <li>Send one frame from HOST-A to HOST-B with empty tables. On which ports of each switch was it captured? Compare with SW2&apos;s table afterwards.</li>
            <li>Clear only SW1&apos;s table, then ping across: who floods, who forwards? Read both consoles.</li>
            <li>Move HOST-C to SW1&apos;s spare port. What does each switch believe until HOST-C speaks?</li>
            <li>Enable ge-0/0/24 on one switch only: is there a loop? (show interfaces status on the other.)</li>
            <li>Enable it on both, send one broadcast, then read show logging / mac-learning-log and the uplink counters.</li>
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
                <Card title="Copies each host received">
                  <Copies cfg={s.cfg} run={done} />
                </Card>
                {done.waves.some((w) => w.hops.some((h) => h.from.startsWith("SW") && h.to.startsWith("SW"))) && (
                  <Card title="Load on the SW1↔SW2 links">
                    <LinkLoad run={done} />
                  </Card>
                )}
              </>
            )}
          </div>
        </details>
      )}
    </div>
  );

  // ---------------------------------------------------------------- Tools (right column)
  const ctrRows = (sw: SnSw) => SN_PORTS.filter((p) => s.cfg.hosts && (isUplink(p) ? s.cfg.cables[p as "ge-0/0/23"] : true)).map((p) => ({ p, c: live.counters[`${sw} ${p}`] }));
  const liveState = (
    <div className="space-y-2">
      <div role="tablist" className="flex flex-wrap items-center gap-1">
        {(
          [
            ["tables", "Tables"],
            ["journey", "Journey"],
            ["captures", "Captures"],
            ["counters", "Counters"],
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
          <p className="text-[11px] text-pv-text-faint">{snap ? "As of the hop the topology is showing." : "As of now."} Two switches, two tables — compare them.</p>
          <WhereIs cfg={s.cfg} snap={live} vendor={vendor} />
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
            {(["SW1", "SW2"] as SnSw[]).map((sw) => (
              <FdbCard key={sw} sw={sw} vendor={vendor} cfg={s.cfg} snap={live} decisions={moment ? shownDecisions.filter((d) => d.sw === sw) : []} />
            ))}
          </div>
          <Card title="Links between the switches">
            <Uplinks cfg={s.cfg} vendor={vendor} />
          </Card>
        </div>
      )}
      {tools === "journey" && (playingPlan ? <p className="rounded-xl border border-pv-border p-2 text-[12px] text-pv-text-muted">The journey of this run appears when it has finished — let it play, or press Skip to end.</p> : s.last ? <Journey cfg={s.cfg} run={s.last} vendor={vendor} max={80} /> : <p className="text-[12.5px] text-pv-text-faint">Send something first.</p>)}
      {tools === "captures" &&
        (playingPlan ? (
          <p className="rounded-xl border border-pv-border p-2 text-[12px] text-pv-text-muted">This run&apos;s captures appear when it has finished — let it play, or press Skip to end.</p>
        ) : (
          <div className="-mx-3 rounded-xl border border-pv-border">
            <CaptureView key={s.seq} s={s} points={capPoints(s)} initial="SW1 ge-0/0/23" vendor={vendor} />
          </div>
        ))}
      {tools === "counters" && (
        <div className="space-y-2">
          <p className="text-[11px] text-pv-text-faint">Frames in / out per port since the counters were cleared{snap ? " — as of the hop on screen" : ""}.</p>
          {(["SW1", "SW2"] as SnSw[]).map((sw) => (
            <div key={sw} className="rounded-xl border border-pv-border p-2">
              <p className="mb-1 text-[12px] font-semibold text-pv-text">{sw}</p>
              <table className="w-full text-left text-[12px]">
                <tbody className="pv-mono">
                  {ctrRows(sw).map(({ p, c }) => (
                    <tr key={p} className="border-t border-pv-border/40">
                      <td className="px-1 py-0.5">{snPortName(vendor, p)}</td>
                      <td className="px-1 py-0.5 text-pv-text-muted">
                        in {c.inF.toLocaleString("en-US")} · out {c.outF.toLocaleString("en-US")}
                      </td>
                      <td className="px-1 py-0.5 text-pv-text-faint">bcast {c.inB.toLocaleString("en-US")}/{c.outB.toLocaleString("en-US")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
          <Pill onClick={() => act({ type: "clear-counters" })}>Clear all counters</Pill>
        </div>
      )}
      {tools === "log" && <LabEventLog entries={[...s.log].reverse().slice(0, 80).map((l, i) => ({ id: s.log.length - i, tag: `#${l.seq}`, text: snVendorText(vendor, l.text), kind: l.tone === "warn" ? "warning" : l.tone === "ok" ? "learn" : "info" }))} title="Lab log" />}
    </div>
  );

  const setIos = (sw: SnSw, m: SnIosMode) => setIosAll((x) => ({ ...x, [sw]: m }));
  const setJunosEdit = (sw: SnSw, b: boolean) => setJunosAll((x) => ({ ...x, [sw]: b }));
  const setCand = (sw: SnSw, c: SnSwCfg) => setCandAll((x) => ({ ...x, [sw]: c }));
  const ctx = { view: s, snap, act, vendor, setVendor, ios, setIos, junosEdit, setJunosEdit, cand, setCand, consoles, setConsoles, notes, setNotes, question, setQuestion };

  return (
    <PracticeLabShell
      open={open}
      onClose={onClose}
      title="Switching Lab"
      sandboxNote={eng ? "Engineering workspace · sandbox, no progress" : "SW1 + SW2 · one broadcast domain · sandbox, no progress"}
      onReset={reset}
      animate={animate}
      onToggleAnimate={() => setAnimate((a) => !a)}
      stages={[]}
      currentStage={0}
      primaryAction={learnAction}
      controls={playerControls}
      topology={topology}
      topologyClassName="h-[300px] sm:h-[clamp(300px,40vh,380px)]"
      topologyFooter={footer}
      eventStrip={<p className="truncate text-[11.5px] text-pv-text-muted" aria-live="polite">{snVendorText(vendor, caption)}</p>}
      board={
        <div className="space-y-3">
          {header}
          {mode === "learn" && learnBoard}
          {mode === "gate" && gateBoard}
          {eng && engBoard}
          <SnDesk windows={windows} setWindows={setWindows} focus={focus} setFocus={setFocus} ctx={ctx} />
        </div>
      }
      liveState={liveState}
      liveStateLabel={eng ? "Tools" : "What each switch knows"}
      mobileTab={mobileTab}
      onMobileTabChange={setMobileTab}
      tabLabels={{ state: eng ? "Tools" : "Tables" }}
    />
  );
}
