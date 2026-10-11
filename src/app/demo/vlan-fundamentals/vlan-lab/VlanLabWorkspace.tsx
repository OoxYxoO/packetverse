"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { clsx } from "clsx";
import { PracticeLabShell, type PracticeLabTab } from "@/components/practice-lab/PracticeLabShell";
import { LabEventLog } from "@/components/practice-lab/LabEventLog";
import type { CliVendor } from "@/lib/cli/types";
import type { CliQuestion } from "@/app/demo/dhcp-dns/dhcp-lab/dhcpBuildCli";
import type { ConsoleSession } from "@/app/demo/dhcp-dns/dhcp-lab/ConsoleTerminal";
import { RTR_PORT, TRUNK, VL_CAUSES, VL_PORTS, VL_TICKETS, createVlanNet, vlApply, vlCauseFeedback, vlClone, vlLastRepro, vlNativeMismatch, vlProofs, vlTicket, type VlAction, type VlCause, type VlDev, type VlRun, type VlSnap, type VlState, type VlSw, type VlTicketId } from "@/lib/sim-engine/scenarios/vlanNet";
import { VlTopology, VlanTableCard } from "./VlTopology";
import { CaptureView, VlDesk, capLabel, capPoints, openVlWindow, type VlWin } from "./VlDevices";
import { Anatomy, Card, Composer, Journey, Membership, Reach, VlanTables, ladder } from "./VlPanels";
import { VL_LEVELS, type VlShow, type VlStep } from "./VlLearn";
import { VL_CHALLENGES } from "./vlPractice";
import { VL_MOMENT_MS, VL_TRAVEL_MS, vlMoments } from "./vlMoments";
import { r1IfName, vlPortName, vlVendorText } from "./vlNames";
import type { VlCand, VlIosMode, VlR1Mode } from "./vlCli";

/**
 * VLAN Lab — the shared practice-lab workspace (pinned topology, each run played hop by hop with Pause / Step / Skip /
 * Replay, the board below, the evidence on the right), with VLAN content:
 *
 *   LEARN                  6 levels (VlLearn): two LANs on one set of switches · the trunk and its tags · the port
 *                          decides the VLAN · allowed list and native VLAN · joining VLANs through R1 · reading evidence
 *   ENGINEERING WORKSPACE  Investigate (traffic composer; SW1/SW2 windows with port VLAN settings, the VLAN database,
 *                          tables by VLAN, Cisco/Junos consoles, captures with the tag column; R1's subinterfaces; host
 *                          shells) · Challenges (six, checked from the network) · Troubleshoot (five tickets:
 *                          reproduce → explain → fix → prove with fresh traffic)
 *
 * One model (vlanNet.ts) produces every hop, tag, table, counter, capture and verdict. Nothing here touches the guided
 * lesson or the progress store.
 */

type Mode = "learn" | "gate" | "eng";
type EngTab = "investigate" | "challenges" | "troubleshoot";
type Tools = "tables" | "journey" | "captures" | "counters" | "log";
interface Player {
  run?: VlRun;
  base?: VlSnap;
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
type Dev = VlSw | "R1";
const IOS0: Record<Dev, VlIosMode | VlR1Mode> = { SW1: { kind: "exec" }, SW2: { kind: "exec" }, R1: { kind: "exec" } };
const EDIT0: Record<Dev, boolean> = { SW1: false, SW2: false, R1: false };
const snapOf = (s: VlState): VlSnap => ({ fdb: s.fdb, counters: s.counters, arp: s.arp });
const candOf = (s: VlState): VlCand => ({ sw: vlClone(s.cfg.sw), r1: vlClone(s.cfg.r1) });
const buildStep = (t: VlStep, seq: number): VlState => (t.pre ?? []).reduce((acc, a) => vlApply(acc, a), { ...createVlanNet(), seq });

export function VlanLabWorkspace({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [mode, setMode] = useState<Mode>("learn");
  const [engTab, setEngTab] = useState<EngTab>("investigate");
  const [level, setLevel] = useState(0);
  const [step, setStep] = useState(0);
  const [unlocked, setUnlocked] = useState(0);
  const [s, setS] = useState<VlState>(() => buildStep(VL_LEVELS[0].steps[0], 0));
  const sRef = useRef(s);
  const [P, setP] = useState<Player>(IDLE);
  const [landedKey, setLandedKey] = useState("");
  const [animate, setAnimate] = useState(true);
  const [ranKey, setRanKey] = useState<string | undefined>(undefined);
  const [answer, setAnswer] = useState<string | undefined>(undefined);
  const [windows, setWindows] = useState<VlWin[]>([]);
  const [focus, setFocus] = useState<VlDev | undefined>(undefined);
  const [vendor, setVendor] = useState<CliVendor>("cisco");
  const [ios, setIosAll] = useState<Record<Dev, VlIosMode | VlR1Mode>>(IOS0);
  const [junosEdit, setJunosAll] = useState<Record<Dev, boolean>>(EDIT0);
  const [cand, setCand] = useState<VlCand>(() => candOf(s));
  const [consoles, setConsoles] = useState<Record<string, ConsoleSession>>({});
  const [question, setQuestion] = useState<CliQuestion | undefined>(undefined);
  const [notes, setNotes] = useState(true);
  const [guess, setGuess] = useState<VlCause | undefined>(undefined);
  // The feedback as it was when the student chose: it must not change once they start fixing the fault.
  const [guessFb, setGuessFb] = useState<ReturnType<typeof vlCauseFeedback> | undefined>(undefined);
  const [found, setFound] = useState(false);
  const [rungs, setRungs] = useState<Record<string, boolean>>({});
  const [tools, setTools] = useState<Tools>("tables");
  const [mobileTab, setMobileTab] = useState<PracticeLabTab>("topology");
  const [ticketSeq, setTicketSeq] = useState(0);

  // ---------------------------------------------------------------- Playback (one moment per wave)
  const moments = useMemo(() => vlMoments(P.run, s.cfg), [P.run, s.cfg]);
  const n = moments.length;
  const playingPlan = !!P.run && P.cursor < n;
  const curKey = `${P.key}:${P.cursor}`;
  useEffect(() => {
    if (!P.playing || !P.run || P.cursor >= n) return;
    const t = window.setTimeout(() => setP((p) => (p.key !== P.key ? p : p.cursor + 1 >= n ? { ...p, cursor: n, playing: false } : { ...p, cursor: p.cursor + 1 })), VL_MOMENT_MS);
    return () => window.clearTimeout(t);
  }, [P, n]);
  useEffect(() => {
    if (!playingPlan) return;
    const k = curKey;
    const t = window.setTimeout(() => setLandedKey(k), VL_TRAVEL_MS);
    return () => window.clearTimeout(t);
  }, [curKey, playingPlan]);
  const landed = landedKey === curKey;
  const show = useCallback(
    (run: VlRun, base: VlSnap) => {
      setP({ run, base, key: `r${run.id}-${++playSeq}`, cursor: animate ? 0 : vlMoments(run, sRef.current.cfg).length, playing: animate });
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
  const snap: VlSnap | undefined = moment ? (landed ? moment.snap : (prevMoment?.snap ?? P.base)) : undefined;
  const live = snap ?? snapOf(s);

  const act = useCallback(
    (a: VlAction) => {
      const before = sRef.current;
      const nx = vlApply(before, a);
      sRef.current = nx;
      setS(nx);
      if (a.type === "cfg" || a.type === "ticket" || a.type === "fresh" || a.type === "move") setCand(candOf(nx));
      if (nx.last && nx.last !== before.last) show(nx.last, snapOf(before));
      return nx;
    },
    [show],
  );
  const openWin = (d: VlDev) => {
    setWindows((ws) => openVlWindow(ws, d));
    setFocus(d);
  };
  const resetNet = (start?: VlState) => {
    const ns: VlState = start ?? { ...createVlanNet(), seq: sRef.current.seq + 1 };
    sRef.current = ns;
    setS(ns);
    setP(IDLE);
    setCand(candOf(ns));
    setIosAll(IOS0);
    setJunosAll(EDIT0);
    setQuestion(undefined);
  };

  // ---------------------------------------------------------------- Learn
  const lv = VL_LEVELS[level];
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
    resetNet(buildStep(VL_LEVELS[li].steps[si], sRef.current.seq + 1));
  };
  const runStep = (r: NonNullable<VlStep["runs"]>[number]) => {
    if (!r.keep) resetNet(buildStep(st, sRef.current.seq + 1));
    r.actions.forEach((a) => act(a));
    setRanKey(stepKey);
  };
  const nextStep = () => {
    if (!stepDone) return;
    if (step + 1 < lv.steps.length) return enterStep(level, step + 1);
    if (level + 1 < VL_LEVELS.length) {
      setUnlocked((u) => Math.max(u, level + 1));
      return enterStep(level + 1, 0);
    }
    setP((p) => ({ ...p, cursor: n, playing: false }));
    setMode("gate");
  };
  const toEngineering = () => {
    setUnlocked(VL_LEVELS.length - 1);
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
    const last = level + 1 >= VL_LEVELS.length && step + 1 >= lv.steps.length;
    return (
      <Pill onClick={nextStep} disabled={!stepDone} tone="primary">
        {step + 1 < lv.steps.length ? "Next →" : last ? "I've finished learning →" : compact ? `Level ${level + 2} →` : `Level ${level + 2}: ${VL_LEVELS[level + 1].title} →`}
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
  const router = eng || !!lv.router;
  const showPorts = eng || level >= 1;
  const clickable = eng || level >= 1;
  const topologyFor = (compact: boolean) => <VlTopology cfg={s.cfg} snap={live} moment={moment} prev={prevMoment} landed={landed} runKey={P.key} cursor={P.cursor} compact={compact} onNode={clickable ? openWin : undefined} selected={focus} showPorts={showPorts} vendor={vendor} showRouter={router} />;
  const topology = (
    <>
      <div className="h-full sm:hidden">{topologyFor(true)}</div>
      <div className="hidden h-full sm:block">{topologyFor(false)}</div>
    </>
  );
  const shownDecisions = (landed ? moment?.decisions : prevMoment?.decisions) ?? [];
  const t1 = s.cfg.sw.SW1.ports[TRUNK];
  const t2 = s.cfg.sw.SW2.ports[TRUNK];
  const footer = (
    <div className="space-y-1.5">
      <div className="grid grid-cols-2 gap-1.5 sm:hidden">
        {(["SW1", "SW2"] as VlSw[]).map((sw) => (
          <VlanTableCard key={sw} short sw={sw} vendor={vendor} cfg={s.cfg} snap={live} decisions={moment ? shownDecisions.filter((d) => d.sw === sw) : []} />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11.5px] text-pv-text-muted">
        <span>
          trunk {vlPortName(vendor, TRUNK)}: SW1 allows <b className="pv-mono text-pv-text">{t1.mode === "trunk" ? t1.allowed.join(",") : "access!"}</b> native <b className="pv-mono text-pv-text">{t1.native}</b> · SW2 allows <b className="pv-mono text-pv-text">{t2.mode === "trunk" ? t2.allowed.join(",") : "access!"}</b> native <b className="pv-mono text-pv-text">{t2.native}</b>
        </span>
        {vlNativeMismatch(s.cfg) && <span className="font-semibold text-pv-danger">native VLAN mismatch</span>}
        {router && (
          <span className="text-pv-text-faint">
            R1: {s.cfg.r1.subs.map((x) => `${r1IfName(vendor, x.unit)} VID ${x.vid}`).join(" · ")}
          </span>
        )}
      </div>
    </div>
  );
  const caption = moment ? moment.lines.map((l) => l.text).join(" · ") : (s.log[s.log.length - 1]?.text ?? "");
  const momentPanel = P.run && (moment || prevMoment) && (
    <div className="space-y-1">
      {(moment ?? prevMoment)!.lines.slice(0, 8).map((l, i) => (
        <p key={`${P.key}${P.cursor}${i}`} className={clsx("pv-pop rounded-lg border px-2 py-1 text-[12.5px]", l.tone === "bad" ? "border-pv-danger/40 bg-pv-danger/[0.06] text-pv-text" : l.tone === "ok" ? "border-pv-success/40 bg-pv-success/[0.06] text-pv-text" : l.tone === "learn" ? "border-pv-violet/40 bg-pv-violet/[0.06] text-pv-text" : "border-pv-cyan/30 bg-pv-cyan/[0.04] text-pv-text")} style={{ animationDelay: `${moment ? VL_TRAVEL_MS * 0.6 + i * 90 : i * 60}ms` }}>
          {vlVendorText(vendor, l.text)}
        </p>
      ))}
      {(moment ?? prevMoment)!.lines.length > 8 && <p className="text-[11.5px] text-pv-text-faint">… and {(moment ?? prevMoment)!.lines.length - 8} more things happened in this hop.</p>}
    </div>
  );

  // ---------------------------------------------------------------- Evidence blocks a step asks for
  const done = P.run && !playingPlan ? P.run : undefined;
  const wait = <p className="rounded-xl border border-pv-border p-2 text-[12px] text-pv-text-muted">The evidence appears when the run has finished — let it play, or press Skip to end.</p>;
  const evidence = (what: VlShow[]) => (
    <div className="space-y-2">
      {what.includes("membership") && (
        <Card title="Which VLAN each port is in">
          <Membership cfg={s.cfg} vendor={vendor} />
        </Card>
      )}
      {what.includes("router") && (
        <Card title="R1's subinterfaces">
          <ul className="pv-mono space-y-0.5 text-[12px] text-pv-text">
            {s.cfg.r1.subs.map((x) => (
              <li key={x.unit}>
                {r1IfName(vendor, x.unit)} · accepts VID {x.vid} · {x.ip}/{x.prefix} = gateway of VLAN {x.vid}
              </li>
            ))}
          </ul>
        </Card>
      )}
      {P.run && playingPlan && what.some((w) => ["reach", "anatomy", "anatomyEcho", "journey", "ladder"].includes(w)) && wait}
      {done && what.includes("reach") && (
        <Card title="Who received the broadcast">
          <Reach cfg={s.cfg} run={done} />
        </Card>
      )}
      {done && (what.includes("anatomy") || what.includes("anatomyEcho")) && (
        <Card title="The frame, link by link">
          <Anatomy cfg={s.cfg} run={done} vendor={vendor} pick={what.includes("anatomyEcho") ? "echo" : "first-cross"} />
        </Card>
      )}
      {done && what.includes("ladder") && (
        <Card title="The questions, answered from the evidence">
          <ul className="space-y-1">
            {ladder(s, vendor, done).map((r) => (
              <li key={r.k} className="text-[12px]">
                <b className="text-pv-text">{r.title}</b> <span className="text-pv-text-muted">{r.text}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {done && what.includes("journey") && (
        <Card title="Every decision, hop by hop">
          <Journey cfg={s.cfg} run={done} vendor={vendor} />
        </Card>
      )}
      {what.includes("tables") && (
        <Card title="What each switch knows, VLAN by VLAN">
          <VlanTables cfg={s.cfg} snap={live} vendor={vendor} />
        </Card>
      )}
    </div>
  );

  // ---------------------------------------------------------------- Boards
  const header = (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1">
        {VL_LEVELS.map((l, li) => (
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
        {(step > 0 || level > 0) && <Pill onClick={() => (step > 0 ? enterStep(level, step - 1) : enterStep(level - 1, VL_LEVELS[level - 1].steps.length - 1))}>← Back</Pill>}
        <span className="flex-1" />
        {learnAction(false)}
      </div>
    </div>
  );
  const gateBoard = (
    <div className="space-y-3 rounded-2xl border border-pv-violet/50 bg-pv-violet/[0.05] p-4">
      <h3 className="text-[16px] font-bold text-pv-text">You can follow a frame through VLANs</h3>
      <ul className="list-disc space-y-1 pl-5 text-[13px] text-pv-text-muted">
        <li>A VLAN is a broadcast domain the switches create. A broadcast reaches its own VLAN on every switch, and nothing else. Hosts never know.</li>
        <li>An access port puts the untagged frames of its host into one VLAN. Change the port&apos;s VLAN and the host is in another LAN — its IP settings must follow.</li>
        <li>A trunk carries many VLANs on one link with an 802.1Q tag (VID) on each frame — except the native VLAN, untagged. Each VLAN must be allowed at both ends; the native VLAN must match.</li>
        <li>Each switch learns and looks up per VLAN. A switch never moves a frame between VLANs.</li>
        <li>Between VLANs, a router: one subinterface per VLAN (the VID it accepts + the gateway address). Inter-VLAN traffic hairpins over the trunk with two tags and the TTL lowered.</li>
      </ul>
      <p className="text-[13px] text-pv-text-muted">The engineering workspace gives you SW1, SW2 and R1 in their own windows (VLAN settings per port, the VLAN database, tables by VLAN, Cisco/Junos consoles, captures with the tag column), the four hosts with a Linux shell, six challenges and five tickets to solve from evidence.</p>
      <div className="flex flex-wrap gap-2">
        <Pill onClick={toEngineering} tone="primary">
          Enter the engineering workspace →
        </Pill>
        <Pill onClick={() => toLearn(VL_LEVELS.length - 1)}>Review level 6</Pill>
      </div>
    </div>
  );

  // Troubleshoot
  const t = s.ticket ? vlTicket(s.ticket) : undefined;
  const proofs = vlProofs(s);
  const solved = !!t && proofs.every((p) => p.ok);
  const fb = guess ? guessFb : undefined;
  const repro = vlLastRepro(s);
  const startTicket = (id: VlTicketId) => {
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
          <p className="text-[13px] text-pv-text-muted">Users report symptoms, not causes. Each ticket is this network after a normal morning of traffic, with one real thing wrong. Reproduce it, find which VLAN goes where and where it stops (port VLANs, trunk lists, native VLANs, R1&apos;s tags), name the cause, fix it on the device, and prove it with fresh traffic.</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {VL_TICKETS.map((x) => (
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
              <p className="text-[13px] text-pv-text-muted">See it yourself first: {t.reproLabel}, and watch which VLAN each frame travels in.</p>
              <Pill onClick={() => act({ type: "traffic", sends: t.repro })} disabled={playingPlan} tone="primary">
                Reproduce it ▶
              </Pill>
            </div>
          )}
          {phase >= 2 && (
            <div className="space-y-1.5">
              <p className="text-[13px] text-pv-text-muted">Walk the evidence in order — open each question once you&apos;ve looked (the tables, the journey, captures on the trunks, the consoles):</p>
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
                {VL_CAUSES.map((c) => {
                  const picked = guess === c.id;
                  if (found && !picked) return null;
                  return (
                    <div key={c.id}>
                      <button
                        type="button"
                        disabled={found}
                        onClick={() => {
                          const f = vlCauseFeedback(s, c.id);
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
                          {vlVendorText(vendor, fb.text)}
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
              {!solved && <p className="text-[12.5px] text-pv-text-muted">Change it on the device (its window, or its console — Junos needs a commit), check the devices&apos; own state (show interfaces trunk / show vlans, the tables, R1&apos;s subinterfaces), then run the user&apos;s test again. An accepted command isn&apos;t a repaired network.</p>}
              <ul className="space-y-0.5">
                {proofs.map((p) => (
                  <li key={p.label} className={clsx("text-[12.5px]", p.ok ? "text-pv-success" : "text-pv-text-muted")}>
                    {p.ok ? "✓" : "○"} {vlVendorText(vendor, p.label)} <span className="text-[11.5px] text-pv-text-faint">— {vlVendorText(vendor, p.detail)}</span>
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
      <p className="text-[13px] text-pv-text-muted">Operate the network yourself. Each challenge is checked from what the network did — the frames it carried, where they were captured, its configuration — not from what you clicked. Start over gives a fresh network.</p>
      <ol className="space-y-1">
        {VL_CHALLENGES.map((c, i) => {
          const ok = c.done(s);
          return (
            <li key={c.id} className={clsx("rounded-lg border px-2 py-1.5", ok ? "border-pv-success/50 bg-pv-success/[0.05]" : "border-pv-border")}>
              <p className={clsx("text-[12.5px] font-semibold", ok ? "text-pv-success" : "text-pv-text")}>
                {ok ? "✓" : `${i + 1}.`} {c.title}
              </p>
              <p className="text-[12px] text-pv-text-muted">{vlVendorText(vendor, c.how)}</p>
              {!ok && (s.runs.length > 0 || s.cfgSeq > 0) && <p className="mt-0.5 text-[12px] text-pv-warning">Not yet: {vlVendorText(vendor, c.next(s))}</p>}
            </li>
          );
        })}
      </ol>
      <Pill onClick={() => resetNet()}>Start over</Pill>
    </div>
  );
  const deviceButtons = (
    <div className="flex flex-wrap gap-1">
      {(["SW1", "SW2", "R1", "HOST-A", "HOST-C", "HOST-B", "HOST-D"] as VlDev[]).map((d) => (
        <button key={d} type="button" onClick={() => openWin(d)} className="rounded-md border border-pv-border px-2 py-0.5 text-[12px] font-semibold text-pv-text-muted hover:border-pv-cyan/60 hover:text-pv-text">
          {d === "SW1" || d === "SW2" ? `⇄ ${d}` : d === "R1" ? "R R1" : `💻 ${d}`}
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
            <li>Broadcast from HOST-A: capture on SW1&apos;s trunk and on HOST-C&apos;s port. Which saw it, with which tag?</li>
            <li>Put HOST-B&apos;s port in VLAN 20 on SW2 (Ports tab or <span className="pv-mono">switchport access vlan 20</span>). Who can HOST-B reach now? In which VLAN does SW2 list its MAC?</li>
            <li>Remove VLAN 20 from SW2&apos;s trunk to R1 only. What still works in Engineering, and what doesn&apos;t?</li>
            <li>Change the native VLAN on one end of the SW1↔SW2 trunk. Read show logging on the Cisco view — and look for the same warning on Junos.</li>
            <li>Ping from HOST-A to HOST-D and count the times the echo crosses each trunk, with which VID.</li>
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
                <Card title="The frame, link by link">
                  <Anatomy cfg={s.cfg} run={done} vendor={vendor} pick="echo" />
                </Card>
                {done.waves.some((w) => w.hops.some((h) => h.frame.dst === "FF:FF:FF:FF:FF:FF")) && (
                  <Card title="Who received the broadcast">
                    <Reach cfg={s.cfg} run={done} />
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
  const ctrPorts = (sw: VlSw) => VL_PORTS.filter((p) => sw === "SW2" || p !== RTR_PORT);
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
          <p className="text-[11px] text-pv-text-faint">{snap ? "As of the hop the topology is showing." : "As of now."} One table per switch, split by VLAN.</p>
          <VlanTables cfg={s.cfg} snap={live} vendor={vendor} />
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
            {(["SW1", "SW2"] as VlSw[]).map((sw) => (
              <VlanTableCard key={sw} sw={sw} vendor={vendor} cfg={s.cfg} snap={live} decisions={moment ? shownDecisions.filter((d) => d.sw === sw) : []} />
            ))}
          </div>
          <Card title="Which VLAN each port is in">
            <Membership cfg={s.cfg} vendor={vendor} />
          </Card>
        </div>
      )}
      {tools === "journey" && (playingPlan ? wait : s.last ? <Journey cfg={s.cfg} run={s.last} vendor={vendor} max={80} /> : <p className="text-[12.5px] text-pv-text-faint">Send something first.</p>)}
      {tools === "captures" &&
        (playingPlan ? (
          wait
        ) : (
          <div className="-mx-3 rounded-xl border border-pv-border">
            <CaptureView key={s.seq} s={s} points={capPoints(s).filter((p) => router || p !== "R1 ge-0/0/0")} initial={`SW1 ${TRUNK}`} vendor={vendor} />
          </div>
        ))}
      {tools === "counters" && (
        <div className="space-y-2">
          <p className="text-[11px] text-pv-text-faint">Frames in / out, how many of them tagged, and drops — since the counters were cleared{snap ? ", as of the hop on screen" : ""}.</p>
          {(["SW1", "SW2"] as VlSw[]).map((sw) => (
            <div key={sw} className="rounded-xl border border-pv-border p-2">
              <p className="mb-1 text-[12px] font-semibold text-pv-text">{sw}</p>
              <table className="w-full text-left text-[12px]">
                <tbody className="pv-mono">
                  {ctrPorts(sw).map((p) => {
                    const c = live.counters[`${sw} ${p}`];
                    return (
                      <tr key={p} className="border-t border-pv-border/40">
                        <td className="px-1 py-0.5">{vlPortName(vendor, p)}</td>
                        <td className="px-1 py-0.5 text-pv-text-muted">
                          in {c.inF} · out {c.outF}
                        </td>
                        <td className="px-1 py-0.5 text-pv-text-faint">
                          tagged {c.tagIn}/{c.tagOut}
                        </td>
                        <td className={clsx("px-1 py-0.5", c.drops ? "text-pv-danger" : "text-pv-text-faint")}>drops {c.drops}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ))}
          {router && (
            <p className="pv-mono text-[12px] text-pv-text-muted">
              R1 {r1IfName(vendor)}: in {live.counters.R1.inF} (tagged {live.counters.R1.tagIn}) · out {live.counters.R1.outF} · <span className={live.counters.R1.drops ? "text-pv-danger" : undefined}>unknown-VID drops {live.counters.R1.drops}</span>
            </p>
          )}
          <Pill onClick={() => act({ type: "clear-counters" })}>Clear all counters</Pill>
        </div>
      )}
      {tools === "log" && <LabEventLog entries={[...s.log].reverse().slice(0, 80).map((l, i) => ({ id: s.log.length - i, tag: `#${l.seq}`, text: vlVendorText(vendor, l.text), kind: l.tone === "warn" ? "warning" : l.tone === "ok" ? "learn" : "info" }))} title="Lab log" />}
    </div>
  );

  const setIos = (d: Dev, m: VlIosMode | VlR1Mode) => setIosAll((x) => ({ ...x, [d]: m }));
  const setJunosEdit = (d: Dev, b: boolean) => setJunosAll((x) => ({ ...x, [d]: b }));
  const ctx = { view: s, snap, act, vendor, setVendor, ios, setIos, junosEdit, setJunosEdit, cand, setCand, consoles, setConsoles, notes, setNotes, question, setQuestion };

  return (
    <PracticeLabShell
      open={open}
      onClose={onClose}
      title="VLAN Lab"
      sandboxNote={eng ? "Engineering workspace · sandbox, no progress" : `SW1 + SW2${router ? " + R1" : ""} · VLAN 10 and VLAN 20 · sandbox, no progress`}
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
      eventStrip={<p className="truncate text-[11.5px] text-pv-text-muted" aria-live="polite">{vlVendorText(vendor, caption)}</p>}
      board={
        <div className="space-y-3">
          {header}
          {mode === "learn" && learnBoard}
          {mode === "gate" && gateBoard}
          {eng && engBoard}
          <VlDesk windows={windows} setWindows={setWindows} focus={focus} setFocus={setFocus} ctx={ctx} />
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
export { capLabel };
