"use client";

import { clsx } from "clsx";
import { useEffect, useState, type ReactNode } from "react";
import { PracticeLabShell, type PracticeLabTab } from "@/components/practice-lab/PracticeLabShell";
import { LabTopology, type LabPacketView } from "@/components/practice-lab/LabTopology";
import { LabEventLog } from "@/components/practice-lab/LabEventLog";
import type { GraphNode, GraphRegion } from "@/components/network/GraphTopologyViewer";
import type { CliVendor } from "@/lib/cli/types";
import {
  ARP_HOSTS,
  ARP_TICKETS,
  DEV_NAME,
  HOSTS,
  R1_IFS,
  SW_PORTS,
  createArpNet,
  hostLinkUp,
  planArp,
  runAll,
  type ArpAction,
  type ArpCapture,
  type ArpDev,
  type ArpHost,
  type ArpNetState,
  type ArpPlan,
  type ArpTicketId,
  type SendDecision,
  type SwPort,
  type WaveCopy,
} from "@/lib/sim-engine/scenarios/arpNet";
import type { ConsoleSession } from "@/app/demo/dhcp-dns/dhcp-lab/ConsoleTerminal";
import { arpIfName, arpVendorText, type SwCiscoMode } from "./arpNetCli";
import { CacheTable, CaptureTable, DecisionChain, FrameView, MacTableView, ifLabel } from "./ArpVisuals";
import { ARP_LEVELS, ARP_STEPS, ArpStepView, type ArpLevel } from "./ArpLearn";
import { ArpDesk, openArpWindow, type ArpWin } from "./ArpDevices";
import { ARP_CAUSES, ARP_CHALLENGES, TICKET_CAUSE, causeFeedback, ticketProofs, type ArpCause } from "./arpPractice";

/**
 * ARP Lab — understand ARP, then prove and troubleshoot it, on the lesson's network plus two more hosts on its LAN.
 *
 *   Learn (5 levels)   why ARP · request and reply · the cache · leaving the LAN · when it fails. Steps rebuild the
 *                      network they start from and can pause an exchange mid-way so the learner looks before it goes on.
 *   Engineering        Investigate (every device in its own window: hosts' settings, caches, decisions, Windows/Linux
 *                      terminals, captures; SW1 and R1 in Cisco IOS or Junos) · Troubleshoot (reported tickets:
 *                      reproduce, explain from evidence, fix, prove) · Practice (challenges judged from the network).
 *
 * Playback: an exchange is planned completely by the model (arpNet.ts) as waves of frames plus the network at each
 * moment; this workspace plays it (pause, step, skip, replay). Everything — topology, tables, captures, windows,
 * terminals — reads the moment being shown. The lab is a sandbox: no lesson state, no progress.
 */

export const ARP_SEGMENT_MS = 950;
const COLOR = { req: "#f59e0b", rep: "#34d399", echo: "#38bdf8", erep: "#22d3ee", bad: "#f87171", dim: "#94a3b8" };
const NODES = (s: ArpNetState): GraphNode[] => [
  { id: "laptop", label: "Laptop", subLabel: s.cfg.laptop.ip, x: 13, y: 20, kind: "laptop" },
  { id: "pcb", label: "PC-B", subLabel: s.cfg.pcb.ip, x: 13, y: 80, kind: "laptop" },
  { id: "pcc", label: "PC-C", subLabel: s.cfg.pcc.ip, x: 40, y: 86, kind: "laptop" },
  { id: "sw1", label: "SW1", subLabel: "switch", x: 40, y: 46, kind: "switch" },
  { id: "r1", label: "R1", subLabel: "gateway", x: 66, y: 46, kind: "router" },
  { id: "server", label: "Server", subLabel: s.cfg.server.ip, x: 89, y: 46, kind: "server" },
];
const COMPACT: Record<string, { x: number; y: number }> = { laptop: { x: 16, y: 20 }, pcb: { x: 16, y: 54 }, pcc: { x: 16, y: 86 }, sw1: { x: 48, y: 46 }, r1: { x: 80, y: 46 }, server: { x: 80, y: 86 } };
const REGIONS: GraphRegion[] = [
  { id: "lan", label: "LAN 192.168.10.0/24 · one broadcast domain", x: 3, y: 5, width: 55, height: 92, tone: "cyan" },
  { id: "srv", label: "10.20.20.0/24", x: 75, y: 22, width: 23, height: 50, tone: "violet" },
];
const COMPACT_REGIONS: GraphRegion[] = [
  { id: "lan", label: "LAN 192.168.10.0/24", x: 3, y: 3, width: 62, height: 94, tone: "cyan" },
  { id: "srv", label: "10.20.20.0/24", x: 68, y: 66, width: 30, height: 31, tone: "violet" },
];
const TARGETS = ["192.168.10.10", "192.168.10.20", "192.168.10.30", "192.168.10.1", "10.20.20.1", "10.20.20.20", "192.168.10.99", "10.20.20.99", "8.8.8.8"];
const SOURCES: (ArpHost | "r1")[] = ["laptop", "pcb", "pcc", "server", "r1"];
const TICKET_TARGET: Record<ArpTicketId, string> = { gateway: "10.20.20.20", mask: "192.168.10.20", static: "192.168.10.20", dupip: "192.168.10.20", port: "192.168.10.20" };

// ---------------------------------------------------------------------------------------------------------------
// Playback
// ---------------------------------------------------------------------------------------------------------------
interface Player {
  committed: ArpNetState;
  plan?: ArpPlan;
  cursor: number;
  playing: boolean;
  pauseAt?: number;
  queue: ArpAction[];
}
const INITIAL: Player = { committed: createArpNet(), cursor: 0, playing: false, queue: [] };
/** Jump to the end of whatever is playing, applying any queued actions instantly. */
function finish(p: Player): Player {
  let committed = p.committed;
  let plan = p.plan;
  for (const a of p.queue) {
    const np = planArp(committed, a);
    committed = np.snaps[np.snaps.length - 1];
    plan = np.waves.length ? np : undefined;
  }
  return { committed, plan, cursor: plan ? plan.waves.length : 0, playing: false, queue: [] };
}
/** Start the queued actions: instant ones apply at once, the first exchange starts playing. */
function startQueue(p: Player, animate: boolean, pauseAt?: number): Player {
  const q = [...p.queue];
  let committed = p.committed;
  let plan = p.plan;
  while (q.length) {
    const a = q.shift()!;
    const np = planArp(committed, a);
    committed = np.snaps[np.snaps.length - 1];
    plan = np.waves.length ? np : undefined;
    if (np.waves.length && animate) return { committed, plan: np, cursor: 0, playing: true, pauseAt, queue: q };
    // without animation an exchange is shown at its end — unless a step asked to stop at a moment
    if (np.waves.length && pauseAt !== undefined) return { committed, plan: np, cursor: Math.min(pauseAt, np.waves.length), playing: false, pauseAt, queue: q };
  }
  return { committed, plan, cursor: plan ? plan.waves.length : 0, playing: false, queue: [] };
}

interface TicketRun {
  id: ArpTicketId;
  mark0: number;
  markFix?: number;
  tried: { cause: ArpCause; text: string }[];
  diagnosed: boolean;
  hint: boolean;
}
const FIX_HINT: Record<ArpTicketId, string> = {
  gateway: "Open the Laptop → Network settings and set the default gateway to R1's address, 192.168.10.1. Then ping the Server.",
  mask: "Open the Laptop → Network settings and set the subnet mask to 255.255.255.0. Then ping PC-B and look at the echo's Ethernet destination.",
  static: "On the Laptop: arp -d 192.168.10.20 removes the static entry (arp -a shows it as static). Then ping PC-B: the Laptop has to ARP, and learns the real MAC.",
  dupip: "Give PC-C back its own address (PC-C → Network settings → 192.168.10.30), then clear the Laptop's stale entry (arp -d 192.168.10.20) and ping PC-B again.",
  port: "In SW1's console: configure terminal, interface Fa0/3, no shutdown (Junos: configure, delete interfaces ge-0/0/3 disable, commit). Then ping PC-B.",
};

type Mode = "learn" | "gate" | "eng";
type EngTab = "investigate" | "troubleshoot" | "practice";

export function ArpLabWorkspace({ open, onClose, vendor, onVendorChange, onOpenPresentation }: { open: boolean; onClose: () => void; vendor: CliVendor; onVendorChange: (v: CliVendor) => void; onOpenPresentation?: () => void }) {
  const [P, setP] = useState<Player>(INITIAL);
  const [animate, setAnimate] = useState(true);
  const [mode, setMode] = useState<Mode>("learn");
  const [level, setLevel] = useState<ArpLevel>(1);
  const [unlocked, setUnlocked] = useState<ArpLevel>(1);
  const [stepIdx, setStepIdx] = useState<Record<ArpLevel, number>>({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 });
  const [ranKey, setRanKey] = useState<string | undefined>(undefined);
  const [engTab, setEngTab] = useState<EngTab>("investigate");
  const [mobileTab, setMobileTab] = useState<PracticeLabTab>("topology");
  const [tools, setTools] = useState<"tables" | "captures" | "log">("tables");
  const [capPoint, setCapPoint] = useState("laptop eth0");
  const [capPick, setCapPick] = useState<ArpCapture | undefined>(undefined);
  const [composer, setComposer] = useState<{ src: ArpHost | "r1"; dst: string }>({ src: "laptop", dst: "192.168.10.20" });
  const [consoles, setConsoles] = useState<Record<string, ConsoleSession>>({});
  const [swCisco, setSwCisco] = useState<SwCiscoMode>({ kind: "exec" });
  const [swJunosEdit, setSwJunosEdit] = useState(false);
  const [swCand, setSwCand] = useState<SwPort[]>([]);
  const [notes, setNotes] = useState(true);
  const [wins, setWins] = useState<ArpWin[]>([]);
  const [winFocus, setWinFocus] = useState<ArpDev | undefined>(undefined);
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
      ARP_SEGMENT_MS,
    );
    return () => window.clearTimeout(t);
  }, [P, n]);

  /** Run actions one after another (exchanges animate when animation is on). */
  const runActions = (as: ArpAction[], pauseAt?: number) => update((p) => startQueue({ ...finish(p), queue: as }, animate, pauseAt));
  /** For terminals and windows: run one action now, return the network it leads to. */
  const act = (a: ArpAction | ArpAction[]): ArpNetState => {
    // computed from the state this render shows (one call per event; several actions go in one array)
    const next = startQueue({ ...finish(P), queue: Array.isArray(a) ? a : [a] }, animate);
    setP(next);
    return next.committed;
  };
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
  const steps = ARP_STEPS[level];
  const idx = stepIdx[level];
  const step = steps[idx];
  const key = `${level}:${idx}`;
  const target = step?.run?.pauseAt ?? step?.resume?.pauseAt;
  const ran = (!step?.run && !step?.resume) || ranKey === key;
  const stepDone = ran && P.queue.length === 0 && (!P.plan || P.cursor >= Math.min(target ?? n, n));

  function setupFor(l: ArpLevel, i: number): ArpAction[] {
    const ss = ARP_STEPS[l];
    let j = i;
    while (j > 0 && !ss[j].setup) j--;
    return [...(ss[j].setup ?? []), ...ss.slice(j, i).flatMap((s) => s.run?.actions ?? [])];
  }
  function goStep(l: ArpLevel, i: number, viaNext = false) {
    const ss = ARP_STEPS[l];
    let k = i;
    // a step that continues (or reads) an exchange can't be entered on its own: start from that exchange
    if (!viaNext && !ss[i].setup) while (k > 0 && !ss[k].run && !ss[k].setup) k--;
    setLevel(l);
    setStepIdx((m) => ({ ...m, [l]: k }));
    setRanKey(undefined);
    if (viaNext && !ss[k].setup) return;
    const actions = ss[k].setup ?? setupFor(l, k);
    update((p) => ({ committed: runAll(finish(p).committed, actions), plan: undefined, cursor: 0, playing: false, queue: [] }));
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
      const nl = (level + 1) as ArpLevel;
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
  function toLearn(l: ArpLevel) {
    setWins([]);
    setMode("learn");
    goStep(l, 0);
  }

  // ---------------------------------------------------------------- Engineering
  const openDevice = (id: ArpDev) => {
    setWins((w) => openArpWindow(w, id));
    setWinFocus(id);
  };
  function startTicket(id: ArpTicketId) {
    const s = act({ type: "ticket", id });
    setTicket({ id, mark0: s.capNo, tried: [], diagnosed: false, hint: false });
  }
  function guess(cause: ArpCause) {
    if (!ticket || ticket.diagnosed) return;
    const right = cause === TICKET_CAUSE[ticket.id];
    setTicket({ ...ticket, tried: [...ticket.tried.filter((x) => x.cause !== cause), { cause, text: causeFeedback(P.committed, cause, vendor) }], diagnosed: right, markFix: right ? P.committed.capNo : ticket.markFix });
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
    setSwCisco({ kind: "exec" });
    setSwJunosEdit(false);
    setSwCand([]);
    setWins([]);
    setTicket(undefined);
    setChallenge(undefined);
    setCapPick(undefined);
    setMobileTab("topology");
  }
  const lastDecision = (dev: ArpHost | "r1"): SendDecision | undefined => {
    if (!P.plan) return undefined;
    const ws = P.plan.waves.slice(0, Math.min(P.cursor + 1, n));
    return [...ws].reverse().find((w) => w.decision?.dev === dev)?.decision;
  };

  // ---------------------------------------------------------------- Topology
  const eng = mode === "eng";
  const labels = eng || mode === "gate" || level >= 2;
  const wave = playingPlan ? P.plan!.waves[P.cursor] : undefined;
  const prevWave = P.plan && P.cursor > 0 ? P.plan.waves[Math.min(P.cursor, n) - 1] : undefined;
  const isTarget = (c: WaveCopy) => c.frame.arp?.op === "request" && (c.to === "r1" ? Object.values(R1_IFS).some((x) => x.ip === c.frame.arp!.tip) : c.to !== "sw1" && view.cfg[c.to as ArpHost].ip === c.frame.arp!.tip);
  const kindOf = (c: WaveCopy) => (c.frame.type === "ARP" ? (c.frame.arp!.op === "request" ? { label: "ARP ?", color: COLOR.req } : { label: "ARP reply", color: COLOR.rep }) : c.frame.ip!.icmp === "echo-request" ? { label: "ping", color: COLOR.echo } : c.frame.ip!.icmp === "echo-reply" ? { label: "reply", color: COLOR.erep } : { label: "unreach", color: COLOR.bad });
  const packets: LabPacketView[] = [
    ...(wave?.copies ?? []).map((c, i) => ({ id: `${P.plan!.run}:${P.cursor}:${i}`, path: [c.from, c.to], hop: 0, done: false, ...kindOf(c), description: `${kindOf(c).label}: ${DEV_NAME[c.from]} → ${DEV_NAME[c.to]}` })),
    ...(prevWave?.copies ?? [])
      .filter((c) => c.to !== "sw1")
      .map((c, i) => {
        const o = c.outcome;
        const lab = o === "discarded" ? { label: "✗ not my MAC", color: COLOR.dim } : c.frame.arp?.op === "request" && o === "accepted" ? (isTarget(c) ? { label: "✓ that's me", color: COLOR.rep } : { label: "ignored", color: COLOR.dim }) : o === "accepted" ? { label: `✓ ${kindOf(c).label}`, color: COLOR.rep } : { label: o ?? "", color: COLOR.dim };
        return { id: `${P.plan!.run}:${P.cursor}:done${i}`, path: [c.from, c.to], hop: 1, done: true, ...lab, description: `${DEV_NAME[c.to]}: ${lab.label}` };
      }),
  ];
  const moving = packets.filter((p) => !p.done).flatMap((p) => p.path);
  const pn = (dev: "sw1" | "r1", id: string) => arpIfName(vendor, dev, id);
  const hostUp = (h: ArpHost) => hostLinkUp(view, h);
  const edges = [
    { id: "a", a: "laptop", b: "sw1", label: labels ? pn("sw1", "fa1") : undefined, state: hostUp("laptop") ? ("full" as const) : ("down" as const) },
    { id: "b", a: "pcb", b: "sw1", label: labels ? pn("sw1", "fa3") : undefined, state: hostUp("pcb") ? ("full" as const) : ("down" as const) },
    { id: "c", a: "pcc", b: "sw1", label: labels ? pn("sw1", "fa4") : undefined, state: hostUp("pcc") ? ("full" as const) : ("down" as const) },
    { id: "r", a: "sw1", b: "r1", label: labels ? `${pn("sw1", "fa2")} ↔ ${pn("r1", "gi0")}` : undefined, state: view.swShut.includes("fa2") ? ("down" as const) : ("full" as const) },
    { id: "s", a: "r1", b: "server", label: labels ? pn("r1", "gi1") : undefined, state: view.power.server ? ("full" as const) : ("down" as const) },
  ];
  const cues = wave ? [wave.caption] : P.plan && P.cursor >= n ? [] : [];
  const topologyFor = (compact: boolean) => (
    <LabTopology
      nodes={compact ? NODES(view).map((x) => ({ ...x, ...COMPACT[x.id] })) : NODES(view)}
      edges={edges}
      regions={compact ? COMPACT_REGIONS : REGIONS}
      activeNodeIds={moving}
      selectedNodeId={eng ? winFocus : undefined}
      dimmedNodeIds={ARP_HOSTS.filter((h) => !view.power[h])}
      onNodeClick={eng ? (id) => openDevice(id as ArpDev) : undefined}
      packets={packets}
      segmentMs={ARP_SEGMENT_MS}
      cues={compact ? undefined : cues.map((c) => arpVendorText(vendor, c))}
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
    return pill(idx + 1 < steps.length ? "Next →" : level < 5 ? (compact ? `Level ${level + 1} →` : `Level ${level + 1}: ${ARP_LEVELS[level].title} →`) : "I've finished learning →", nextStep, !stepDone, "primary");
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
        {ARP_LEVELS.map((l) => (
          <button
            key={l.level}
            type="button"
            disabled={l.level > unlocked}
            aria-current={mode === "learn" && level === l.level ? "step" : undefined}
            onClick={() => (eng ? toLearn(l.level) : (setMode("learn"), goStep(l.level, 0)))}
            className={clsx("rounded-full border px-2.5 py-0.5 text-[11.5px] font-semibold disabled:opacity-35", mode === "learn" && level === l.level ? "border-pv-cyan bg-pv-cyan/15 text-pv-text" : l.level < unlocked || eng ? "border-pv-success/50 text-pv-success" : "border-pv-border text-pv-text-muted")}
          >
            {l.level}. {l.title}
          </button>
        ))}
        <span className="mx-1 text-pv-text-faint">→</span>
        <button type="button" onClick={() => (eng ? undefined : mode === "gate" ? toEngineering() : (update(finish), setMode("gate")))} className={clsx("rounded-full border px-2.5 py-0.5 text-[11.5px] font-semibold", eng ? "border-pv-violet bg-pv-violet/15 text-pv-text" : "border-pv-violet/50 text-pv-violet")}>
          Engineering workspace
        </button>
        {onOpenPresentation && (
          <button type="button" onClick={onOpenPresentation} className="ml-auto rounded-full border border-pv-border px-2.5 py-0.5 text-[11.5px] text-pv-text-muted hover:text-pv-text">
            ▶ ARP presentation
          </button>
        )}
      </div>
      {mode === "learn" && <p className="text-[12px] text-pv-text-faint">Level {level}: {ARP_LEVELS[level - 1].idea}</p>}
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
      <ArpStepView step={step} view={view} plan={P.plan} cursor={P.cursor} vendor={vendor} ran={ran} />
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
      <h3 className="text-[16px] font-bold text-pv-text">You can explain ARP from the wire</h3>
      <ul className="list-disc space-y-1 pl-5 text-[13px] text-pv-text-muted">
        <li>An IPv4 host decides local or remote with its own address and mask. Local → the next hop is the destination; remote → the default gateway.</li>
        <li>It needs the next hop&apos;s MAC: cache hit → send; miss → broadcast an ARP Request for the next hop&apos;s IP.</li>
        <li>SW1 floods the broadcast (learning the sender&apos;s MAC → port). Only the owner of the target IP replies, by unicast; it learns the asker too.</li>
        <li>IP destination = final host; Ethernet destination = next hop. Routers rebuild the Ethernet header on every link and do their own ARP.</li>
        <li>No reply = incomplete entry. The failing ARP is on the last link; the sender&apos;s choice of target tells you which.</li>
      </ul>
      <p className="text-[13px] text-pv-text-muted">The engineering workspace gives you every device in its own window: settings, caches, terminals (Windows, Linux, Cisco, Junos), captures. Then tickets to solve, from evidence only.</p>
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
    const h = ARP_HOSTS.find((x) => HOSTS[x].cfg.ip === ip);
    return h ? `${ip} (${HOSTS[h].name})` : ip === R1_IFS.gi0.ip || ip === R1_IFS.gi1.ip ? `${ip} (R1)` : `${ip} (nobody)`;
  };
  const trafficBar = (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-pv-border p-2" aria-label="Traffic and time">
      {sel(composer.src, (v) => setComposer((c) => ({ ...c, src: v as ArpHost | "r1" })), SOURCES.map((s) => ({ v: s, l: DEV_NAME[s] })), "Ping from")}
      {sel(composer.dst, (v) => setComposer((c) => ({ ...c, dst: v })), TARGETS.map((t) => ({ v: t, l: ipName(t) })), "to")}
      {pill("Ping ▶", () => runActions([{ type: "ping", src: composer.src, dst: composer.dst, count: 1 }]), false, "primary")}
      <span className="h-4 w-px bg-pv-border" />
      {pill("+60 s", () => runActions([{ type: "time", seconds: 60 }]))}
      {pill("+125 s", () => runActions([{ type: "time", seconds: 125 }]))}
      <span className="pv-mono text-[11px] text-pv-text-faint">t = {view.clock} s</span>
    </div>
  );
  const deviceButtons = (
    <div className="flex flex-wrap gap-1">
      {(["laptop", "pcb", "pcc", "sw1", "r1", "server"] as ArpDev[]).map((d) => (
        <button key={d} type="button" onClick={() => openDevice(d)} className="rounded-md border border-pv-border px-2 py-0.5 text-[12px] font-semibold text-pv-text-muted hover:border-pv-cyan/60 hover:text-pv-text">
          {d === "sw1" || d === "r1" ? `⇄ ${DEV_NAME[d]}` : `💻 ${DEV_NAME[d]}`}
        </button>
      ))}
    </div>
  );
  const lastResult = P.committed.last?.type === "ping" && !busy ? P.committed.last.result : undefined;
  const exchange = P.plan && (
    <details open className="rounded-xl border border-pv-border p-2">
      <summary className="cursor-pointer text-[12px] font-semibold text-pv-text">Exchange: {P.plan.label}</summary>
      <div className="mt-2 space-y-2">
        {wave && <p className="rounded-lg border border-pv-cyan/40 bg-pv-cyan/[0.06] px-2 py-1 text-[12.5px] text-pv-text">▶ {arpVendorText(vendor, wave.caption)}</p>}
        {(wave?.decision ?? lastDecision(P.plan.snaps[n].last?.type === "ping" ? (P.plan.snaps[n].last as { result: { src: ArpHost | "r1" } }).result.src : "laptop")) && <DecisionChain d={(wave?.decision ?? lastDecision((P.plan.snaps[n].last as { result: { src: ArpHost | "r1" } }).result.src))!} compact />}
        {wave?.copies[0] && <FrameView f={wave.copies[0].frame} />}
        {lastResult && (
          <p className={clsx("text-[12.5px]", lastResult.replies.every((r) => r.kind === "reply") ? "text-pv-success" : "text-pv-warning")}>
            {DEV_NAME[lastResult.src]} → {lastResult.dst}: {lastResult.replies.map((r) => (r.kind === "reply" ? "reply" : r.kind === "host-unreachable" ? "Destination host unreachable" : r.kind === "net-unreachable" ? "Destination net unreachable" : r.kind === "no-route" ? "not sent" : "timed out")).join(", ")}
          </p>
        )}
      </div>
    </details>
  );

  const t = ticket;
  const proofs = t?.diagnosed && t.markFix !== undefined ? ticketProofs(P.committed, t.id, t.markFix, vendor) : [];
  const solved = proofs.length > 0 && proofs.every((p) => p.ok);
  const reproduced = !!t && P.committed.captures.some((c) => c.no > t.mark0 && c.dir === "out" && c.frame.ip?.icmp === "echo-request" && c.frame.ip.dst === TICKET_TARGET[t.id] && c.dev !== "sw1" && c.dev !== "r1");
  const reproducedArp = !!t && P.committed.captures.some((c) => c.no > t.mark0 && c.dir === "out" && c.dev !== "sw1" && c.frame.arp?.op === "request");
  const phase = !t ? 0 : !(reproduced || reproducedArp) && !t.diagnosed ? 1 : !t.diagnosed ? 2 : !solved ? 3 : 4;
  const troubleshootBoard = (
    <div className="space-y-3">
      {!t ? (
        <>
          <p className="text-[13px] text-pv-text-muted">Users report symptoms, not causes. Each ticket breaks the network with a real mechanism. Reproduce it, follow the reasoning (what IP → local or remote → what should be ARPed → entry? request? who saw it? reply? learned?), fix it with the tools an engineer has, and prove it with frames.</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {(Object.keys(ARP_TICKETS) as ArpTicketId[]).map((id) => (
              <button key={id} type="button" onClick={() => startTicket(id)} className="rounded-xl border border-pv-border p-2.5 text-left hover:border-pv-violet/60">
                <p className="text-[13px] font-bold text-pv-text">{ARP_TICKETS[id].title}</p>
                <p className="text-[12px] italic text-pv-text-muted">{ARP_TICKETS[id].report}</p>
              </button>
            ))}
          </div>
        </>
      ) : (
        <div className="space-y-3 rounded-2xl border border-pv-violet/40 p-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-[14px] font-bold text-pv-text">{ARP_TICKETS[t.id].title}</p>
              <p className="text-[12.5px] italic text-pv-text-muted">{ARP_TICKETS[t.id].report}</p>
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
          {phase === 1 && <p className="text-[13px] text-pv-text-muted">See it yourself first: send the traffic the user describes (the ping bar above, or a host&apos;s terminal), and watch where the frames go.</p>}
          {phase >= 2 && (
            <div className="space-y-1.5">
              <p className="text-[13px] text-pv-text-muted">{t.diagnosed ? "Diagnosis:" : "What explains the evidence? Look before choosing: the hosts' settings and caches, SW1's ports and table, R1's ARP table, the captures. A wrong choice gets the evidence that rules it out."}</p>
              <div className="grid gap-1">
                {ARP_CAUSES.map((c) => {
                  const tried = t.tried.find((x) => x.cause === c.id);
                  const right = c.id === TICKET_CAUSE[t.id];
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
              {!solved && <p className="text-[12.5px] text-pv-text-muted">Use the devices — settings, terminals, consoles — then send the traffic that proves it. Every check below is read from the network.</p>}
              <ul className="space-y-0.5">
                {proofs.map((p) => (
                  <li key={p.label} className={clsx("text-[12.5px]", p.ok ? "text-pv-success" : "text-pv-text-muted")}>
                    {p.ok ? "✓" : "○"} {p.label}
                  </li>
                ))}
              </ul>
              {!solved && !t.hint && pill("Hint: how could this be fixed?", () => setTicket({ ...t, hint: true }))}
              {!solved && t.hint && <p className="text-[12px] text-pv-text-muted">{arpVendorText(vendor, FIX_HINT[t.id])}</p>}
              {solved && <p className="text-[12.5px] text-pv-text">Ticket closed with evidence. {pill("Next ticket", () => setTicket(undefined))}</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );

  const ch = challenge && ARP_CHALLENGES.find((c) => c.id === challenge.id);
  const chDone = !!ch && ch.done(P.committed, { cap: challenge!.cap, log: challenge!.log });
  const practiceBoard = (
    <div className="space-y-3">
      {!ch ? (
        <>
          <p className="text-[13px] text-pv-text-muted">Make the network do something, then let the evidence judge it. Each challenge starts on a fresh network; only what happens afterwards counts.</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {ARP_CHALLENGES.map((c) => (
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
          {chDone ? (
            <p className="pv-pop text-[13px] font-semibold text-pv-success">✓ Done. {arpVendorText(vendor, ch.proof)}</p>
          ) : challenge!.hint ? (
            <p className="text-[12.5px] text-pv-text-muted">Hint: {ch.hint}</p>
          ) : (
            pill("Hint", () => setChallenge({ ...challenge!, hint: true }))
          )}
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
        <p className="text-[12px] text-pv-text-muted">Click a device on the topology (or here) to open it in its own window.</p>
        {deviceButtons}
      </div>
      {trafficBar}
      {engTab === "investigate" && (
        <div className="space-y-2 text-[13px] text-pv-text-muted">
          <p>The same network, yours. Things worth proving with evidence:</p>
          <ul className="list-disc space-y-0.5 pl-5 text-[12.5px]">
            <li>Ping PC-B, then look at PC-C&apos;s capture: what did PC-C receive, and what did it do with it?</li>
            <li>Ping the Server, then compare the Laptop&apos;s cache with R1&apos;s ({vendor === "cisco" ? "show ip arp" : "show arp"}): who knows the Server&apos;s MAC?</li>
            <li>On SW1, run {vendor === "cisco" ? "show ip arp" : "show arp"} and {vendor === "cisco" ? "show mac address-table" : "show ethernet-switching table"}. Why is one empty?</li>
            <li>Ping 192.168.10.99 from the Laptop; compare arp -a with netsh interface ipv4 show neighbors.</li>
            <li>Change PC-C&apos;s mask to 255.255.255.240 and ping PC-B from PC-C. Who did PC-C ARP for?</li>
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
  const capPoints = [...ARP_HOSTS.map((h) => `${h} eth0`), ...SW_PORTS.map((p) => `sw1 ${p}`), "r1 gi0", "r1 gi1"];
  const [capDev, capIf] = capPoint.split(" ") as [ArpDev, string];
  const showTools = eng || mode === "gate" || level >= 2;
  const cacheOwners = eng || mode === "gate" || level >= 4 ? (["laptop", "pcb", "pcc", "r1", "server"] as const) : (["laptop", "pcb", "pcc"] as const);
  const liveState = !showTools ? (
    <p className="text-[12.5px] text-pv-text-muted">Level 1 is about the story: why a packet can&apos;t leave without a MAC. The caches, the switch&apos;s table and the captures appear from level 2.</p>
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
            <button key={v} type="button" aria-pressed={vendor === v} onClick={() => onVendorChange(v)} className={clsx("rounded-full px-2 py-0.5 font-semibold", vendor === v ? "bg-pv-cyan/20 text-pv-text" : "text-pv-text-faint")}>
              {v === "cisco" ? "Cisco" : "Junos"}
            </button>
          ))}
        </div>
      </div>
      {tools === "tables" && (
        <div className="space-y-2">
          <p className="text-[11px] text-pv-text-faint">ARP caches (IP → MAC) live in devices with an IP address. SW1&apos;s table (MAC → port) is something else.</p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
            {cacheOwners.map((o) => (
              <CacheTable key={o} s={view} owner={o} />
            ))}
            <MacTableView s={view} vendor={vendor} />
          </div>
          <p className="text-[10.5px] text-pv-text-faint">t = {view.clock} s · host entries last 120 s, R1&apos;s 20 min, SW1&apos;s MAC entries 300 s</p>
        </div>
      )}
      {tools === "captures" && (
        <div className="space-y-1.5">
          <label className="flex items-center gap-1 text-[11.5px] text-pv-text-faint">
            Capture at
            <select value={capPoint} onChange={(e) => (setCapPoint(e.target.value), setCapPick(undefined))} className="rounded-md border border-pv-border bg-pv-bg px-1.5 py-1 text-[12px] text-pv-text">
              {capPoints.map((p) => {
                const [d, i] = p.split(" ") as [ArpDev, string];
                return (
                  <option key={p} value={p}>
                    {DEV_NAME[d]} {ifLabel(d, i, vendor)}
                  </option>
                );
              })}
            </select>
          </label>
          <CaptureTable s={view} dev={capDev} iface={capIf} vendor={vendor} onPick={setCapPick} picked={capPick?.no} />
          {capPick && <FrameView f={capPick.frame} note={capPick.note && arpVendorText(vendor, capPick.note)} />}
        </div>
      )}
      {tools === "log" && <LabEventLog entries={view.log.map((l) => ({ id: l.id, tag: `t=${l.clock}s`, text: arpVendorText(vendor, l.text), kind: l.kind === "warn" ? "warning" : l.kind }))} />}
    </div>
  );

  return (
    <PracticeLabShell
      open={open}
      onClose={onClose}
      title="ARP Lab"
      sandboxNote={eng ? "Engineering workspace · sandbox, no progress" : "Same network as the lesson, plus PC-B and PC-C · sandbox, no progress"}
      onReset={reset}
      animate={animate}
      onToggleAnimate={() => setAnimate((a) => !a)}
      stages={[]}
      currentStage={0}
      primaryAction={learnAction}
      controls={playerControls}
      topology={topology}
      topologyClassName="h-[380px] sm:h-[clamp(250px,38vh,360px)]"
      eventStrip={<p className="truncate text-[11.5px] text-pv-text-muted" aria-live="polite">{arpVendorText(vendor, wave?.caption ?? view.log[view.log.length - 1]?.text ?? "")}</p>}
      board={
        <div className="space-y-3">
          {header}
          {mode === "learn" && learnBoard}
          {mode === "gate" && gateBoard}
          {eng && engBoard}
          {eng && (
            <ArpDesk
              windows={wins}
              setWindows={setWins}
              focus={winFocus}
              setFocus={setWinFocus}
              ctx={{ view, act, busy, vendor, setVendor: onVendorChange, sw: { cisco: swCisco, setCisco: setSwCisco, junosEdit: swJunosEdit, setJunosEdit: setSwJunosEdit, cand: swCand, setCand: setSwCand }, consoles, setConsoles, notes, setNotes, lastDecision }}
            />
          )}
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
