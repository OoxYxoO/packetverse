"use client";

import { clsx } from "clsx";
import { useEffect, useState, type ReactNode } from "react";
import { PracticeLabShell, type PracticeLabTab } from "@/components/practice-lab/PracticeLabShell";
import { LabTopology, type LabPacketView } from "@/components/practice-lab/LabTopology";
import { LabEventLog } from "@/components/practice-lab/LabEventLog";
import type { GraphNode, GraphRegion } from "@/components/network/GraphTopologyViewer";
import type { CliVendor } from "@/lib/cli/types";
import { networkOf } from "@/lib/sim-engine/scenarios/ipv4Basics";
import { V4_DEV_NAME, V4_HOSTS, V4_HOST_IDS, V4_R1, V4_TICKETS, createV4Net, v4Plan, v4RunAll, type V4Action, type V4Capture, type V4Decision, type V4H, type V4IfCfg, type V4NetState, type V4Plan, type V4R1If, type V4RouterStep, type V4TicketId, type V4WaveCopy } from "@/lib/sim-engine/scenarios/ipv4Net";
import type { ConsoleSession } from "@/app/demo/dhcp-dns/dhcp-lab/ConsoleTerminal";
import type { CliQuestion } from "@/app/demo/dhcp-dns/dhcp-lab/dhcpBuildCli";
import { v4IfLabel, v4VendorText, type V4CiscoMode, type V4Commit } from "./v4Cli";
import { AddressChain, CacheTable, CaptureTable, DecisionMath, FrameView, RouterPipeline, ifLabel } from "./V4Visuals";
import { V4_LEVELS, V4_STEPS, V4StepView, type V4Level } from "./V4Learn";
import { V4Desk, openV4Window, type V4Win, type V4WinId } from "./V4Devices";
import { V4_CAUSES, V4_CHALLENGES, V4_TICKET_CAUSE, v4CauseFeedback, v4TicketProofs, type V4Cause } from "./v4Practice";

/**
 * IPv4 Lab — understand how a host and a router use IPv4, then prove and troubleshoot it.
 *
 *   Learn (5 levels)   address and prefix · local or remote · through R1 · TTL and checksum · wrong settings. Steps
 *                      rebuild the network they start from and can pause an exchange at a chosen moment.
 *   Engineering        Investigate (hosts and R1 in their own windows: what each believes, its settings, terminals —
 *                      Linux, Windows, Cisco IOS, Junos — captures) · Troubleshoot (reported tickets: reproduce,
 *                      explain from evidence, fix, prove) · Practice (challenges judged from the network).
 *
 * Playback: an exchange is planned completely by the model (ipv4Net.ts) as waves of frames plus the network at each
 * moment; this workspace plays it. Every view reads the moment being shown. Sandbox: no lesson state, no progress.
 */

export const V4_SEGMENT_MS = 900;
const COLOR = { req: "#f59e0b", rep: "#34d399", echo: "#38bdf8", erep: "#22d3ee", bad: "#f87171", dim: "#94a3b8" };
const NODES = (s: V4NetState): GraphNode[] => [
  { id: "hosta", label: "HOST-A", subLabel: s.cfg.hosta.ip, x: 9, y: 28, kind: "laptop" },
  { id: "hostc", label: "HOST-C", subLabel: s.cfg.hostc.ip, x: 9, y: 78, kind: "laptop" },
  { id: "swa", label: "SW-A", subLabel: "switch", x: 28, y: 52, kind: "switch" },
  { id: "r1", label: "R1", subLabel: "router", x: 50, y: 52, kind: "router" },
  { id: "swb", label: "SW-B", subLabel: "switch", x: 72, y: 52, kind: "switch" },
  { id: "hostb", label: "HOST-B", subLabel: s.cfg.hostb.ip, x: 91, y: 52, kind: "laptop" },
];
const COMPACT: Record<string, { x: number; y: number }> = { hosta: { x: 16, y: 22 }, hostc: { x: 84, y: 22 }, swa: { x: 50, y: 30 }, r1: { x: 50, y: 56 }, swb: { x: 28, y: 86 }, hostb: { x: 76, y: 86 } };
const regions = (s: V4NetState, compact: boolean): GraphRegion[] => {
  const a = `LAN A ${networkOf(s.r1.ge0.ip, s.r1.ge0.prefix)}/${s.r1.ge0.prefix}`, b = `LAN B ${networkOf(s.r1.ge1.ip, s.r1.ge1.prefix)}/${s.r1.ge1.prefix}`;
  return compact
    ? [
        { id: "a", label: a, x: 3, y: 4, width: 94, height: 40, tone: "cyan" },
        { id: "b", label: b, x: 3, y: 70, width: 94, height: 28, tone: "violet" },
      ]
    : [
        { id: "a", label: a, x: 2, y: 6, width: 41, height: 90, tone: "cyan" },
        { id: "b", label: b, x: 58, y: 18, width: 40, height: 64, tone: "violet" },
      ];
};
const TARGETS = ["192.168.10.10", "192.168.10.30", "192.168.10.70", "192.168.10.1", "192.168.10.65", "192.168.10.40", "192.168.10.99", "10.0.0.1"];
const SOURCES: (V4H | "r1")[] = ["hosta", "hostc", "hostb", "r1"];
const INITIAL_HIST: V4Commit[] = [{ r1: { ge0: { ...V4_R1.ge0.cfg }, ge1: { ...V4_R1.ge1.cfg } }, at: 0, by: "root" }];

interface Player {
  committed: V4NetState;
  plan?: V4Plan;
  cursor: number;
  playing: boolean;
  pauseAt?: number;
  queue: V4Action[];
}
const INITIAL: Player = { committed: createV4Net(), cursor: 0, playing: false, queue: [] };
function finish(p: Player): Player {
  let committed = p.committed;
  let plan = p.plan;
  for (const a of p.queue) {
    const np = v4Plan(committed, a);
    committed = np.snaps[np.snaps.length - 1];
    plan = np.waves.length ? np : undefined;
  }
  return { committed, plan, cursor: plan ? plan.waves.length : 0, playing: false, queue: [] };
}
function startQueue(p: Player, animate: boolean, pauseAt?: number): Player {
  const q = [...p.queue];
  let committed = p.committed;
  let plan = p.plan;
  while (q.length) {
    const a = q.shift()!;
    const np = v4Plan(committed, a);
    committed = np.snaps[np.snaps.length - 1];
    plan = np.waves.length ? np : undefined;
    if (np.waves.length && animate) return { committed, plan: np, cursor: 0, playing: true, pauseAt, queue: q };
    if (np.waves.length && pauseAt !== undefined) return { committed, plan: np, cursor: Math.min(pauseAt, np.waves.length), playing: false, pauseAt, queue: q };
  }
  return { committed, plan, cursor: plan ? plan.waves.length : 0, playing: false, queue: [] };
}
const sameR1 = (a: Record<V4R1If, V4IfCfg>, b: Record<V4R1If, V4IfCfg>) => JSON.stringify(a) === JSON.stringify(b);

interface TicketRun {
  id: V4TicketId;
  mark0: number;
  markFix?: number;
  tried: { cause: V4Cause; text: string }[];
  diagnosed: boolean;
  hint: boolean;
}
const FIX_HINT: Record<V4TicketId, string> = {
  mask: "Open HOST-A → Network settings and set the mask back to 255.255.255.192 (/26). Then ping HOST-B and check the echo's Ethernet destination.",
  gateway: "Open HOST-A → Network settings and set the default gateway to R1's LAN A address, 192.168.10.1. Then ping HOST-B.",
  return: "Open HOST-B → Network settings and give it R1's LAN B address, 192.168.10.65, as default gateway. Then ping HOST-B from HOST-A again.",
  r1down: "In R1's console: configure terminal, interface Gi0/1, no shutdown (Junos: configure, delete interfaces ge-0/0/1 disable, commit). Then check the routing table and ping HOST-B.",
};
type Mode = "learn" | "gate" | "eng";
type EngTab = "investigate" | "troubleshoot" | "practice";

export function Ipv4LabWorkspace({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [P, setP] = useState<Player>(INITIAL);
  const [animate, setAnimate] = useState(true);
  const [mode, setMode] = useState<Mode>("learn");
  const [level, setLevel] = useState<V4Level>(1);
  const [unlocked, setUnlocked] = useState<V4Level>(1);
  const [stepIdx, setStepIdx] = useState<Record<V4Level, number>>({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 });
  const [ranKey, setRanKey] = useState<string | undefined>(undefined);
  const [engTab, setEngTab] = useState<EngTab>("investigate");
  const [vendor, setVendor] = useState<CliVendor>("cisco");
  const [mobileTab, setMobileTab] = useState<PracticeLabTab>("topology");
  const [tools, setTools] = useState<"tables" | "captures" | "log">("tables");
  const [capPoint, setCapPoint] = useState("hosta eth0");
  const [capPick, setCapPick] = useState<V4Capture | undefined>(undefined);
  const [composer, setComposer] = useState<{ src: V4H | "r1"; dst: string; ttl: string }>({ src: "hosta", dst: "192.168.10.70", ttl: "" });
  const [consoles, setConsoles] = useState<Record<string, ConsoleSession>>({});
  const [cisco, setCisco] = useState<V4CiscoMode>({ kind: "exec" });
  const [junosEdit, setJunosEdit] = useState(false);
  const [cand, setCand] = useState<Record<V4R1If, V4IfCfg>>(INITIAL_HIST[0].r1);
  const [hist, setHist] = useState<V4Commit[]>(INITIAL_HIST);
  const [question, setQuestion] = useState<CliQuestion | undefined>(undefined);
  const [notes, setNotes] = useState(true);
  const [wins, setWins] = useState<V4Win[]>([]);
  const [winFocus, setWinFocus] = useState<V4WinId | undefined>(undefined);
  const [ticket, setTicket] = useState<TicketRun | undefined>(undefined);
  const [challenge, setChallenge] = useState<{ id: string; cap: number; log: number; hint: boolean } | undefined>(undefined);

  const update = (f: (p: Player) => Player) => setP(f);
  const n = P.plan?.waves.length ?? 0;
  const playingPlan = !!P.plan && P.cursor < n;
  const view = playingPlan ? P.plan!.snaps[P.cursor] : P.committed;
  const busy = playingPlan || P.queue.length > 0;

  useEffect(() => {
    if (!P.playing || !P.plan || P.cursor >= n) return;
    if (P.pauseAt !== undefined && P.cursor >= P.pauseAt) return;
    const t = window.setTimeout(
      () =>
        update((p) => {
          if (!p.plan) return p;
          const c = p.cursor + 1;
          const len = p.plan.waves.length;
          if (c >= len) return p.queue.length ? startQueue({ ...p, cursor: len, playing: false }, true) : { ...p, cursor: len, playing: false, pauseAt: undefined };
          return { ...p, cursor: c, playing: p.pauseAt === undefined || c < p.pauseAt };
        }),
      V4_SEGMENT_MS,
    );
    return () => window.clearTimeout(t);
  }, [P, n]);

  /** R1's committed configuration follows the network (IOS lines, tickets, a fresh network), so Junos shows it as rollback 0. */
  const syncHist = (next: V4NetState, by: string) => {
    setHist((h) => (sameR1(h[0].r1, next.r1) ? h : [{ r1: next.r1, at: Date.now(), by }, ...h].slice(0, 30)));
    if (!junosEdit) setCand(next.r1);
  };
  const runActions = (as: V4Action[], pauseAt?: number) => {
    const next = startQueue({ ...finish(P), queue: as }, animate, pauseAt);
    setP(next);
    syncHist(next.committed, as.some((a) => a.type === "ticket") ? "ticket" : "admin");
    return next;
  };
  const act = (a: V4Action): V4NetState => runActions([a]).committed;
  const replay = () => update((p) => (p.plan ? { ...p, cursor: 0, playing: true, pauseAt: undefined } : p));
  const stepOnce = () => update((p) => (p.plan && p.cursor < p.plan.waves.length ? { ...p, cursor: p.cursor + 1, playing: false, pauseAt: undefined } : p));
  const pause = () => update((p) => ({ ...p, playing: false }));
  const play = () => update((p) => ({ ...p, playing: true, pauseAt: p.pauseAt !== undefined && p.cursor >= p.pauseAt ? undefined : p.pauseAt }));
  const skip = () => update(finish);
  const resumeTo = (pauseAt?: number) =>
    update((p) => {
      if (!p.plan || p.cursor >= p.plan.waves.length) return p;
      if (animate) return { ...p, playing: true, pauseAt };
      const c = Math.min(pauseAt ?? p.plan.waves.length, p.plan.waves.length);
      return c >= p.plan.waves.length && p.queue.length ? startQueue({ ...p, cursor: c, playing: false }, false) : { ...p, cursor: c, playing: false, pauseAt };
    });

  // ---------------------------------------------------------------- Learn
  const steps = V4_STEPS[level];
  const idx = stepIdx[level];
  const step = steps[idx];
  const key = `${level}:${idx}`;
  const target = step?.run?.pauseAt ?? step?.resume?.pauseAt;
  const ran = (!step?.run && !step?.resume) || ranKey === key;
  // a step with nothing to run is done at once (even while an earlier step's exchange stays paused); otherwise wait for its moment
  const stepDone = (!step?.run && !step?.resume) || (ran && P.queue.length === 0 && (!P.plan || P.cursor >= Math.min(target ?? n, n)));
  function setupFor(l: V4Level, i: number): V4Action[] {
    const ss = V4_STEPS[l];
    let j = i;
    while (j > 0 && !ss[j].setup) j--;
    return [...(ss[j].setup ?? []), ...ss.slice(j, i).flatMap((s) => s.run?.actions ?? [])];
  }
  function goStep(l: V4Level, i: number, viaNext = false) {
    const ss = V4_STEPS[l];
    let k = i;
    if (!viaNext && !ss[i].setup) while (k > 0 && !ss[k].run && !ss[k].setup) k--;
    setLevel(l);
    setStepIdx((m) => ({ ...m, [l]: k }));
    setRanKey(undefined);
    if (viaNext && !ss[k].setup) return;
    const actions = ss[k].setup ?? setupFor(l, k);
    const committed = v4RunAll(finish(P).committed, actions);
    setP({ committed, plan: undefined, cursor: 0, playing: false, queue: [] });
    syncHist(committed, "root");
  }
  function runStep() {
    if (!step || (busy && !step.resume)) return;
    setRanKey(key);
    if (step.run) runActions(step.run.actions, step.run.pauseAt);
    else if (step.resume) resumeTo(step.resume.pauseAt);
  }
  function nextStep() {
    if (busy && !stepDone) return;
    if (idx + 1 < steps.length) return goStep(level, idx + 1, true);
    if (level < 5) {
      const nl = (level + 1) as V4Level;
      setUnlocked((u) => (u < nl ? nl : u));
      goStep(nl, 0);
    } else {
      update(finish);
      setMode("gate");
    }
  }
  function toEngineering() {
    setUnlocked(5);
    setMode("eng");
    setEngTab("investigate");
    setTicket(undefined);
    setChallenge(undefined);
    runActions([{ type: "fresh" }]);
  }
  function toLearn(l: V4Level) {
    setWins([]);
    setMode("learn");
    goStep(l, 0);
  }

  // ---------------------------------------------------------------- Engineering
  const openDevice = (id: string) => {
    if (id === "swa" || id === "swb") return;
    setWins((w) => openV4Window(w, id as V4WinId));
    setWinFocus(id as V4WinId);
  };
  function startTicket(id: V4TicketId) {
    const s = act({ type: "ticket", id });
    setTicket({ id, mark0: s.capNo, tried: [], diagnosed: false, hint: false });
  }
  function guess(cause: V4Cause) {
    if (!ticket || ticket.diagnosed) return;
    const right = cause === V4_TICKET_CAUSE[ticket.id];
    setTicket({ ...ticket, tried: [...ticket.tried.filter((x) => x.cause !== cause), { cause, text: v4CauseFeedback(P.committed, cause, vendor, ticket.mark0) }], diagnosed: right, markFix: right ? P.committed.capNo : ticket.markFix });
  }
  function startChallenge(id: string) {
    const s = act({ type: "fresh" });
    setChallenge({ id, cap: s.capNo, log: s.log[s.log.length - 1]?.id ?? 0, hint: false });
  }
  function reset() {
    setP(INITIAL);
    setMode("learn");
    setLevel(1);
    setUnlocked(1);
    setStepIdx({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 });
    setRanKey(undefined);
    setEngTab("investigate");
    setConsoles({});
    setCisco({ kind: "exec" });
    setJunosEdit(false);
    setCand(INITIAL_HIST[0].r1);
    setHist(INITIAL_HIST);
    setQuestion(undefined);
    setWins([]);
    setTicket(undefined);
    setChallenge(undefined);
    setCapPick(undefined);
    setVendor("cisco");
    setComposer({ src: "hosta", dst: "192.168.10.70", ttl: "" });
    setMobileTab("topology");
  }
  const lastDecision = (dev: V4H | "r1"): V4Decision | undefined => (P.plan ? [...P.plan.waves.slice(0, Math.min(P.cursor + 1, n))].reverse().find((w) => w.decision?.dev === dev)?.decision : undefined);
  const lastRouter = (): V4RouterStep | undefined => (P.plan ? [...P.plan.waves.slice(0, Math.min(P.cursor + 1, n))].reverse().find((w) => w.router)?.router : undefined);

  // ---------------------------------------------------------------- Topology
  const eng = mode === "eng";
  const labels = eng || mode === "gate" || level >= 3;
  const wave = playingPlan ? P.plan!.waves[P.cursor] : undefined;
  const prevWave = P.plan && P.cursor > 0 ? P.plan.waves[Math.min(P.cursor, n) - 1] : undefined;
  const kindOf = (c: V4WaveCopy) => (c.frame.type === "ARP" ? (c.frame.arp!.op === "request" ? { label: "ARP ?", color: COLOR.req } : { label: "ARP reply", color: COLOR.rep }) : c.frame.ip!.icmp === "echo-request" ? { label: `ping TTL ${c.frame.ip!.ttl}`, color: COLOR.echo } : c.frame.ip!.icmp === "echo-reply" ? { label: `reply TTL ${c.frame.ip!.ttl}`, color: COLOR.erep } : { label: c.frame.ip!.icmp === "time-exceeded" ? "TTL exceeded" : "unreachable", color: COLOR.bad });
  const packets: LabPacketView[] = [
    ...(wave?.copies ?? []).map((c, i) => ({ id: `${P.plan!.run}:${P.cursor}:${i}`, path: [c.from, c.to], hop: 0, done: false, ...kindOf(c), description: `${kindOf(c).label}: ${V4_DEV_NAME[c.from]} → ${V4_DEV_NAME[c.to]}` })),
    ...(prevWave?.copies ?? [])
      .filter((c) => c.to !== "swa" && c.to !== "swb")
      .map((c, i) => {
        const req = c.frame.arp?.op === "request";
        const ownerIp = c.to === "r1" ? [view.r1.ge0.ip, view.r1.ge1.ip] : [view.cfg[c.to as V4H].ip];
        const lab = req ? (ownerIp.includes(c.frame.arp!.tip) ? { label: "✓ that's me", color: COLOR.rep } : { label: "ignored", color: COLOR.dim }) : { label: `✓ ${kindOf(c).label}`, color: COLOR.rep };
        return { id: `${P.plan!.run}:${P.cursor}:d${i}`, path: [c.from, c.to], hop: 1, done: true, ...lab, description: `${V4_DEV_NAME[c.to]}: ${lab.label}` };
      }),
  ];
  const moving = packets.filter((p) => !p.done).flatMap((p) => p.path);
  const edges = [
    { id: "a", a: "hosta", b: "swa", label: labels ? "p1" : undefined, state: "full" as const },
    { id: "c", a: "hostc", b: "swa", label: labels ? "p3" : undefined, state: "full" as const },
    { id: "r0", a: "swa", b: "r1", label: labels ? `${v4IfLabel(vendor, "ge0")} ${view.r1.ge0.ip.replace("192.168.10", "")}` : undefined, state: view.r1.ge0.up ? ("full" as const) : ("down" as const) },
    { id: "r1", a: "r1", b: "swb", label: labels ? `${v4IfLabel(vendor, "ge1")} ${view.r1.ge1.ip.replace("192.168.10", "")}` : undefined, state: view.r1.ge1.up ? ("full" as const) : ("down" as const) },
    { id: "b", a: "swb", b: "hostb", label: labels ? "p2" : undefined, state: "full" as const },
  ];
  const topologyFor = (compact: boolean) => (
    <LabTopology
      nodes={compact ? NODES(view).map((x) => ({ ...x, ...COMPACT[x.id] })) : NODES(view)}
      edges={edges}
      regions={regions(view, compact)}
      activeNodeIds={moving}
      selectedNodeId={eng ? winFocus : undefined}
      onNodeClick={eng ? openDevice : undefined}
      packets={packets}
      segmentMs={V4_SEGMENT_MS}
      cues={compact || !wave ? undefined : [v4VendorText(vendor, wave.caption)]}
    />
  );
  const topology = (
    <>
      <div className="h-full sm:hidden">{topologyFor(true)}</div>
      <div className="hidden h-full sm:block">{topologyFor(false)}</div>
    </>
  );

  // ---------------------------------------------------------------- Pieces
  const pill = (label: ReactNode, onClick: () => void, disabled?: boolean, tone?: "primary") => (
    <button type="button" onClick={onClick} disabled={disabled} className={clsx("rounded-full px-3 py-1 text-[12px] font-semibold disabled:opacity-40", tone === "primary" ? "bg-pv-cyan text-[#03131a] hover:bg-pv-cyan/90" : "border border-pv-border text-pv-text-muted hover:text-pv-text")}>
      {label}
    </button>
  );
  const learnAction = (compact: boolean) => {
    if (mode !== "learn" || !step) return null;
    if ((step.run || step.resume) && !ran) return pill(compact ? "▶ Go" : `▶ ${(step.run ?? step.resume)!.label}`, runStep, busy && !step.resume, "primary");
    return pill(idx + 1 < steps.length ? "Next →" : level < 5 ? (compact ? `Level ${level + 1} →` : `Level ${level + 1}: ${V4_LEVELS[level].title} →`) : "I've finished learning →", nextStep, !stepDone, "primary");
  };
  const playerControls = P.plan && (
    <div className="flex flex-wrap items-center gap-1" aria-label="Playback">
      {playingPlan && (P.playing ? pill("⏸ Pause", pause) : pill("▶ Play", play))}
      {playingPlan && pill("Step ⏭", stepOnce)}
      {playingPlan && pill("Skip to end", skip)}
      {!playingPlan && P.queue.length === 0 && pill("↻ Replay", replay)}
      <span className="pv-mono text-[11px] text-pv-text-faint">
        moment {Math.min(P.cursor, n)}/{n}
      </span>
    </div>
  );
  const header = (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1">
        {V4_LEVELS.map((l) => (
          <button key={l.level} type="button" disabled={l.level > unlocked} aria-current={mode === "learn" && level === l.level ? "step" : undefined} onClick={() => (eng ? toLearn(l.level) : (setMode("learn"), goStep(l.level, 0)))} className={clsx("rounded-full border px-2.5 py-0.5 text-[11.5px] font-semibold disabled:opacity-35", mode === "learn" && level === l.level ? "border-pv-cyan bg-pv-cyan/15 text-pv-text" : l.level < unlocked || eng ? "border-pv-success/50 text-pv-success" : "border-pv-border text-pv-text-muted")}>
            {l.level}. {l.title}
          </button>
        ))}
        <span className="mx-1 text-pv-text-faint">→</span>
        <button type="button" onClick={() => (eng ? undefined : mode === "gate" ? toEngineering() : (update(finish), setMode("gate")))} className={clsx("rounded-full border px-2.5 py-0.5 text-[11.5px] font-semibold", eng ? "border-pv-violet bg-pv-violet/15 text-pv-text" : "border-pv-violet/50 text-pv-violet")}>
          Engineering workspace
        </button>
      </div>
      {mode === "learn" && <p className="text-[12px] text-pv-text-faint">Level {level}: {V4_LEVELS[level - 1].idea}</p>}
    </div>
  );
  const learnBoard = step && (
    <div className="space-y-3 rounded-2xl border border-pv-border bg-pv-bg-elevated/40 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-[15px] font-bold text-pv-text">{step.title}</h3>
        <span className="shrink-0 text-[11px] text-pv-text-faint">
          step {idx + 1} / {steps.length}
        </span>
      </div>
      <V4StepView step={step} view={view} plan={P.plan} cursor={P.cursor} vendor={vendor} ran={ran} />
      <div className="flex flex-wrap items-center gap-2 border-t border-pv-border pt-2">
        {idx > 0 && pill("← Back", () => goStep(level, idx - 1))}
        {step.run && ran && pill("Run it again", () => goStep(level, idx))}
        <span className="flex-1" />
        {learnAction(false)}
      </div>
    </div>
  );
  const gateBoard = (
    <div className="space-y-3 rounded-2xl border border-pv-violet/50 bg-pv-violet/[0.05] p-4">
      <h3 className="text-[16px] font-bold text-pv-text">You can follow a packet through IPv4</h3>
      <ul className="list-disc space-y-1 pl-5 text-[13px] text-pv-text-muted">
        <li>An address plus its prefix says which network a device believes it is on.</li>
        <li>A host ANDs its own address and the destination with its own mask: same network → deliver directly; different → send to the default gateway.</li>
        <li>The IPv4 destination is always the final host; the Ethernet destination is only the next hop on this wire.</li>
        <li>R1 removes the frame, looks the destination up, takes 1 off the TTL, recomputes the checksum and builds a new frame.</li>
        <li>A wrong mask breaks the decision; a wrong gateway breaks the door; the reply depends on the other host&apos;s settings.</li>
      </ul>
      <p className="text-[13px] text-pv-text-muted">The engineering workspace opens every host and R1 in its own window: settings, terminals (Linux, Windows, Cisco IOS, Junos), captures. Then tickets to solve from evidence.</p>
      <div className="flex flex-wrap gap-2">
        {pill("Enter the engineering workspace →", toEngineering, false, "primary")}
        {pill("Review level 5", () => toLearn(5))}
      </div>
    </div>
  );
  const sel = (value: string, onChange: (v: string) => void, options: { v: string; l: string }[], label: string) => (
    <label className="flex items-center gap-1 text-[11.5px] text-pv-text-faint">
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)} className="rounded-md border border-pv-border bg-pv-bg px-1.5 py-1 text-[12px] text-pv-text">
        {options.map((o) => (
          <option key={o.v} value={o.v}>
            {o.l}
          </option>
        ))}
      </select>
    </label>
  );
  const ipName = (ip: string) => {
    const h = V4_HOST_IDS.find((x) => view.cfg[x].ip === ip);
    return h ? `${ip} (${V4_HOSTS[h].name})` : ip === view.r1.ge0.ip || ip === view.r1.ge1.ip ? `${ip} (R1)` : `${ip} (nobody)`;
  };
  const trafficBar = (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-pv-border p-2" aria-label="Traffic">
      {sel(composer.src, (v) => setComposer((c) => ({ ...c, src: v as V4H | "r1" })), SOURCES.map((s) => ({ v: s, l: V4_DEV_NAME[s] })), "Ping from")}
      {sel(composer.dst, (v) => setComposer((c) => ({ ...c, dst: v })), [...new Set([...TARGETS, ...V4_HOST_IDS.map((h) => view.cfg[h].ip)])].map((t) => ({ v: t, l: ipName(t) })), "to")}
      {sel(composer.ttl, (v) => setComposer((c) => ({ ...c, ttl: v })), [{ v: "", l: "default TTL" }, { v: "1", l: "TTL 1" }, { v: "2", l: "TTL 2" }], "")}
      {pill("Ping ▶", () => runActions([{ type: "ping", src: composer.src, dst: composer.dst, count: 1, ttl: composer.ttl ? +composer.ttl : undefined }]), false, "primary")}
    </div>
  );
  const deviceButtons = (
    <div className="flex flex-wrap gap-1">
      {(["hosta", "hostc", "r1", "hostb"] as V4WinId[]).map((d) => (
        <button key={d} type="button" onClick={() => openDevice(d)} className="rounded-md border border-pv-border px-2 py-0.5 text-[12px] font-semibold text-pv-text-muted hover:border-pv-cyan/60 hover:text-pv-text">
          {d === "r1" ? "R R1" : `💻 ${V4_DEV_NAME[d]}`}
        </button>
      ))}
    </div>
  );
  const lastResult = P.committed.last?.type === "ping" && !busy ? P.committed.last.result : undefined;
  const curDecision = wave?.decision ?? (lastResult ? lastDecision(lastResult.src) : undefined);
  const curRouter = wave?.router;
  const exchange = P.plan && (
    <details open className="rounded-xl border border-pv-border p-2">
      <summary className="cursor-pointer text-[12px] font-semibold text-pv-text">Exchange: {P.plan.label}</summary>
      <div className="mt-2 space-y-2">
        {wave && <p className="rounded-lg border border-pv-cyan/40 bg-pv-cyan/[0.06] px-2 py-1 text-[12.5px] text-pv-text">▶ {v4VendorText(vendor, wave.caption)}</p>}
        {curDecision && curDecision.dev !== "r1" && <DecisionMath d={curDecision} name={V4_DEV_NAME[curDecision.dev]} />}
        {curDecision && <AddressChain d={curDecision} />}
        {curRouter && <RouterPipeline r={curRouter} vendor={vendor} />}
        {wave?.copies[0] && <FrameView f={wave.copies[0].frame} />}
        {lastResult && (
          <p className={clsx("text-[12.5px]", lastResult.replies.every((r) => r.kind === "reply") ? "text-pv-success" : "text-pv-warning")}>
            {V4_DEV_NAME[lastResult.src]} → {lastResult.dst}: {lastResult.replies.map((r) => (r.kind === "reply" ? `reply (TTL ${r.ttl})` : r.kind === "host-unreachable" ? "Destination Host Unreachable" : r.kind === "net-unreachable" ? `Destination Net Unreachable from ${r.from}` : r.kind === "ttl-expired" ? `Time to live exceeded at ${r.from}` : r.kind === "no-route" ? "not sent (no route)" : "timed out")).join(", ")}
          </p>
        )}
      </div>
    </details>
  );

  const t = ticket;
  const proofs = t?.diagnosed && t.markFix !== undefined ? v4TicketProofs(P.committed, t.id, t.markFix, vendor) : [];
  const solved = proofs.length > 0 && proofs.every((p) => p.ok);
  const reproduced = !!t && P.committed.captures.some((c) => c.no > t.mark0 && c.dir === "out" && c.dev !== "r1" && (c.frame.ip?.icmp === "echo-request" || c.frame.arp?.op === "request"));
  const phase = !t ? 0 : !reproduced && !t.diagnosed ? 1 : !t.diagnosed ? 2 : !solved ? 3 : 4;
  const troubleshootBoard = (
    <div className="space-y-3">
      {!t ? (
        <>
          <p className="text-[13px] text-pv-text-muted">Users report symptoms, not causes. Each ticket breaks the network with a real mechanism. Reproduce it, then reason step by step — the host&apos;s IP, mask and gateway → local or remote → whom it tried to reach on the wire → did the packet reach R1 → what R1 did → did the reply come back — and prove each step before you fix anything.</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {(Object.keys(V4_TICKETS) as V4TicketId[]).map((id) => (
              <button key={id} type="button" onClick={() => startTicket(id)} className="rounded-xl border border-pv-border p-2.5 text-left hover:border-pv-violet/60">
                <p className="text-[13px] font-bold text-pv-text">{V4_TICKETS[id].title}</p>
                <p className="text-[12px] italic text-pv-text-muted">{V4_TICKETS[id].report}</p>
              </button>
            ))}
          </div>
        </>
      ) : (
        <div className="space-y-3 rounded-2xl border border-pv-violet/40 p-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-[14px] font-bold text-pv-text">{V4_TICKETS[t.id].title}</p>
              <p className="text-[12.5px] italic text-pv-text-muted">{V4_TICKETS[t.id].report}</p>
            </div>
            {pill("All tickets", () => setTicket(undefined))}
          </div>
          <ol className="flex flex-wrap gap-1 text-[11.5px]">
            {["Reproduce", "Explain", "Fix", "Prove"].map((p, i) => (
              <li key={p} className={clsx("rounded-full border px-2 py-0.5 font-semibold", phase > i + 1 || (i === 3 && solved) ? "border-pv-success/60 text-pv-success" : phase === i + 1 ? "border-pv-violet bg-pv-violet/15 text-pv-text" : "border-pv-border text-pv-text-faint")}>
                {i + 1}. {p}
              </li>
            ))}
          </ol>
          {phase === 1 && <p className="text-[13px] text-pv-text-muted">See it yourself first: send the traffic the user describes (the ping bar, or a host&apos;s terminal) and watch where it goes.</p>}
          {phase >= 2 && (
            <div className="space-y-1.5">
              <p className="text-[13px] text-pv-text-muted">{t.diagnosed ? "Diagnosis:" : "What explains the evidence? Look before choosing — each host's settings and decision, R1's interfaces and routes, the captures. A wrong choice gets the evidence that rules it out."}</p>
              <div className="grid gap-1">
                {V4_CAUSES.map((c) => {
                  const tried = t.tried.find((x) => x.cause === c.id);
                  const right = c.id === V4_TICKET_CAUSE[t.id];
                  if (t.diagnosed && !tried) return null;
                  return (
                    <div key={c.id}>
                      <button type="button" disabled={t.diagnosed} onClick={() => guess(c.id)} className={clsx("w-full rounded-lg border px-2 py-1 text-left text-[12.5px]", tried ? (right ? "border-pv-success/60 bg-pv-success/10 text-pv-text" : "border-pv-warning/50 text-pv-text-muted") : "border-pv-border text-pv-text hover:border-pv-violet/60")}>
                        {tried ? (right ? "✓ " : "✗ ") : ""}
                        {c.label}
                      </button>
                      {tried && <p className={clsx("px-2 py-1 text-[12px]", right ? "text-pv-success" : "text-pv-text-muted")}>{tried.text}</p>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {phase >= 3 && (
            <div className="space-y-1.5 rounded-xl border border-pv-border p-2">
              <p className="text-[13px] font-semibold text-pv-text">{solved ? "Proved" : "Fix it, then prove it"}</p>
              {!solved && <p className="text-[12.5px] text-pv-text-muted">A setting accepted is not a network fixed: change it, check what the device now believes, then send the traffic that proves it. Every check below is read from the network.</p>}
              <ul className="space-y-0.5">
                {proofs.map((p) => (
                  <li key={p.label} className={clsx("text-[12.5px]", p.ok ? "text-pv-success" : "text-pv-text-muted")}>
                    {p.ok ? "✓" : "○"} {p.label}
                  </li>
                ))}
              </ul>
              {!solved && !t.hint && pill("Hint: how could this be fixed?", () => setTicket({ ...t, hint: true }))}
              {!solved && t.hint && <p className="text-[12px] text-pv-text-muted">{v4VendorText(vendor, FIX_HINT[t.id])}</p>}
              {solved && <p className="text-[12.5px] text-pv-text">Ticket closed with evidence. {pill("Next ticket", () => setTicket(undefined))}</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
  const ch = challenge && V4_CHALLENGES.find((c) => c.id === challenge.id);
  const chDone = !!ch && ch.done(P.committed, { cap: challenge!.cap, log: challenge!.log });
  const practiceBoard = (
    <div className="space-y-3">
      {!ch ? (
        <>
          <p className="text-[13px] text-pv-text-muted">Change IPv4 settings and see what they really do. Each challenge starts on a fresh network and is judged from what the network did afterwards.</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {V4_CHALLENGES.map((c) => (
              <button key={c.id} type="button" onClick={() => startChallenge(c.id)} className="rounded-xl border border-pv-border p-2.5 text-left hover:border-pv-cyan/60">
                <p className="text-[13px] font-bold text-pv-text">{c.title}</p>
                <p className="text-[12px] text-pv-text-muted">{c.task}</p>
              </button>
            ))}
          </div>
        </>
      ) : (
        <div className={clsx("space-y-2 rounded-2xl border p-3", chDone ? "border-pv-success/60" : "border-pv-cyan/40")}>
          <div className="flex items-start justify-between gap-2">
            <p className="text-[14px] font-bold text-pv-text">{ch.title}</p>
            {pill("All challenges", () => setChallenge(undefined))}
          </div>
          <p className="text-[13px] text-pv-text-muted">{ch.task}</p>
          {chDone ? <p className="pv-pop text-[13px] font-semibold text-pv-success">✓ Done. {v4VendorText(vendor, ch.proof)}</p> : challenge!.hint ? <p className="text-[12.5px] text-pv-text-muted">Hint: {ch.hint}</p> : pill("Hint", () => setChallenge({ ...challenge!, hint: true }))}
          <div className="flex gap-2">{pill("Start over (fresh network)", () => startChallenge(ch.id))}</div>
        </div>
      )}
    </div>
  );
  const engBoard = (
    <div className="space-y-3">
      <div role="tablist" className="flex gap-1">
        {(
          [
            ["investigate", "Investigate"],
            ["troubleshoot", "Troubleshoot"],
            ["practice", "Practice"],
          ] as const
        ).map(([m, label]) => (
          <button key={m} type="button" role="tab" aria-selected={engTab === m} onClick={() => (setEngTab(m), setTicket(undefined), setChallenge(undefined), m === "investigate" && engTab !== "investigate" && runActions([{ type: "fresh" }]))} className={clsx("rounded-lg border px-3 py-1 text-[12.5px] font-semibold", engTab === m ? "border-pv-violet bg-pv-violet/15 text-pv-text" : "border-pv-border text-pv-text-muted hover:text-pv-text")}>
            {label}
          </button>
        ))}
      </div>
      <div className="space-y-1.5">
        <p className="text-[12px] text-pv-text-muted">Click a host or R1 on the topology (or here) to open it in its own window.</p>
        {deviceButtons}
      </div>
      {trafficBar}
      {engTab === "investigate" && (
        <div className="space-y-2 text-[13px] text-pv-text-muted">
          <p>The same network, yours. Things worth proving with evidence:</p>
          <ul className="list-disc space-y-0.5 pl-5 text-[12.5px]">
            <li>Ping HOST-B from HOST-A, then compare HOST-A&apos;s capture with R1&apos;s capture on {v4IfLabel(vendor, "ge1")}: which fields changed?</li>
            <li>On HOST-A, run <span className="pv-mono">ip route get 192.168.10.70</span> and <span className="pv-mono">ip route get 192.168.10.30</span>. Then change HOST-A&apos;s mask and run them again.</li>
            <li>Ping HOST-B with TTL 1, then TTL 2. Where does each one end?</li>
            <li>Ping R1&apos;s far interface (192.168.10.65) from HOST-A. Did R1 forward anything? (Its counters and pipeline say.)</li>
            <li>Shut R1&apos;s {v4IfLabel(vendor, "ge1")} from its console and look at its routing table before you ping.</li>
          </ul>
          <div className="flex flex-wrap gap-2">{pill("Fresh network", () => runActions([{ type: "fresh" }]))}</div>
        </div>
      )}
      {engTab === "troubleshoot" && troubleshootBoard}
      {engTab === "practice" && practiceBoard}
      {exchange}
    </div>
  );

  // ---------------------------------------------------------------- Tools
  const capPoints = [...V4_HOST_IDS.map((h) => `${h} eth0`), "r1 ge0", "r1 ge1"];
  const [capDev, capIf] = capPoint.split(" ") as [V4H | "r1", string];
  const showTools = eng || mode === "gate" || level >= 2;
  const liveState = !showTools ? (
    <p className="text-[12.5px] text-pv-text-muted">Level 1 is about the address itself. The caches, R1&apos;s state and the captures appear from level 2.</p>
  ) : (
    <div className="space-y-2">
      <div role="tablist" className="flex flex-wrap items-center gap-1">
        {(
          [
            ["tables", "Tables"],
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
          {(["cisco", "juniper"] as const).map((v) => (
            <button key={v} type="button" aria-pressed={vendor === v} onClick={() => setVendor(v)} className={clsx("rounded-full px-2 py-0.5 font-semibold", vendor === v ? "bg-pv-cyan/20 text-pv-text" : "text-pv-text-faint")}>
              {v === "cisco" ? "Cisco" : "Junos"}
            </button>
          ))}
        </div>
      </div>
      {tools === "tables" && (
        <div className="space-y-2">
          <div className="rounded-xl border border-pv-border p-2 text-[12px]">
            <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-pv-text-faint">Settings</p>
            {V4_HOST_IDS.map((h) => (
              <p key={h} className="pv-mono text-[11.5px] text-pv-text">
                {V4_HOSTS[h].name} {view.cfg[h].ip}/{view.cfg[h].prefix} gw {view.cfg[h].gw ?? "none"}
              </p>
            ))}
            {(["ge0", "ge1"] as V4R1If[]).map((i) => (
              <p key={i} className="pv-mono text-[11.5px] text-pv-text">
                R1 {v4IfLabel(vendor, i)} {view.r1[i].ip}/{view.r1[i].prefix} {view.r1[i].up ? "up" : "DOWN"}
              </p>
            ))}
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
            {(["hosta", "hostc", "r1", "hostb"] as const).map((o) => (
              <CacheTable key={o} s={view} owner={o} />
            ))}
          </div>
          <p className="text-[10.5px] text-pv-text-faint">R1 forwarded {view.counters.forwarded} · TTL expired {view.counters.ttlExpired} · no route {view.counters.noRoute}</p>
        </div>
      )}
      {tools === "captures" && (
        <div className="space-y-1.5">
          <label className="flex items-center gap-1 text-[11.5px] text-pv-text-faint">
            Capture at
            <select value={capPoint} onChange={(e) => (setCapPoint(e.target.value), setCapPick(undefined))} className="rounded-md border border-pv-border bg-pv-bg px-1.5 py-1 text-[12px] text-pv-text">
              {capPoints.map((p) => {
                const [d, i] = p.split(" ");
                return (
                  <option key={p} value={p}>
                    {V4_DEV_NAME[d as V4H]} {ifLabel(d, i, vendor)}
                  </option>
                );
              })}
            </select>
          </label>
          <CaptureTable s={view} dev={capDev} iface={capIf} vendor={vendor} onPick={setCapPick} picked={capPick?.no} />
          {capPick && <FrameView f={capPick.frame} note={capPick.note && v4VendorText(vendor, capPick.note)} />}
        </div>
      )}
      {tools === "log" && <LabEventLog entries={view.log.map((l) => ({ id: l.id, tag: `#${l.id}`, text: v4VendorText(vendor, l.text), kind: l.kind === "warn" ? "warning" : l.kind }))} />}
    </div>
  );

  const cliApi = { cisco, setCisco, junosEdit, setJunosEdit, cand, setCand, hist, commit: (r1: Record<V4R1If, V4IfCfg>) => { setHist((h) => [{ r1, at: Date.now(), by: "student" }, ...h].slice(0, 30)); const next = startQueue({ ...finish(P), queue: [{ type: "r1-cfg", r1, line: "commit" }] }, animate); setP(next); } };

  return (
    <PracticeLabShell
      open={open}
      onClose={onClose}
      title="IPv4 Lab"
      sandboxNote={eng ? "Engineering workspace · sandbox, no progress" : "Same network as the lesson, plus HOST-C · sandbox, no progress"}
      onReset={reset}
      animate={animate}
      onToggleAnimate={() => setAnimate((a) => !a)}
      stages={[]}
      currentStage={0}
      primaryAction={learnAction}
      controls={playerControls}
      topology={topology}
      topologyClassName="h-[380px] sm:h-[clamp(250px,38vh,360px)]"
      eventStrip={<p className="truncate text-[11.5px] text-pv-text-muted" aria-live="polite">{v4VendorText(vendor, wave?.caption ?? view.log[view.log.length - 1]?.text ?? "")}</p>}
      board={
        <div className="space-y-3">
          {header}
          {mode === "learn" && learnBoard}
          {mode === "gate" && gateBoard}
          {eng && engBoard}
          {eng && <V4Desk windows={wins} setWindows={setWins} focus={winFocus} setFocus={setWinFocus} ctx={{ view, act, busy, vendor, setVendor, cli: cliApi, question, setQuestion, consoles, setConsoles, notes, setNotes, lastDecision, lastRouter }} />}
        </div>
      }
      liveState={liveState}
      liveStateLabel={eng ? "Tools" : "What each device knows"}
      mobileTab={mobileTab}
      onMobileTabChange={setMobileTab}
      tabLabels={{ state: eng ? "Tools" : "Tables" }}
    />
  );
}
