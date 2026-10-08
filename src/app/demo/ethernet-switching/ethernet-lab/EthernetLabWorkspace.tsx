"use client";

import { clsx } from "clsx";
import { useState, type ReactNode } from "react";
import { PracticeLabShell, type PracticeLabTab } from "@/components/practice-lab/PracticeLabShell";
import { LabTopology, type LabPacketView } from "@/components/practice-lab/LabTopology";
import { LabEventLog } from "@/components/practice-lab/LabEventLog";
import type { CliVendor } from "@/lib/cli/types";
import { useLabRunner } from "@/lib/practice-lab/useLabRunner";
import { DESK_PORTS, ETH_MAC, SW1_PORTS, type EthDevice, type EthHost } from "@/lib/sim-engine/scenarios/ethernetSwitching";
import { ETH_HOSTS, ETH_LAB_MODEL, ETH_TICKETS, ethVisibleSegments, hostLink, isInFlight, runInstant, type EthLabAction, type EthLabCfg, type EthLabState, type EthTicketId } from "@/lib/sim-engine/scenarios/ethernetLab";
import type { ConsoleSession } from "@/app/demo/dhcp-dns/dhcp-lab/ConsoleTerminal";
import type { CliQuestion } from "@/app/demo/dhcp-dns/dhcp-lab/dhcpBuildCli";
import { ETH_REGIONS, ethEdges, ethNodes } from "../topology";
import { ETH_DEFAULT_CFG, ethPortName, ethVendorText, type EthCiscoMode, type EthCommit, type EthJunosMode } from "./ethLabCli";
import { CaptureList, FrameCard, MacTable, NicVerdicts, SwitchMind, portLabel, who } from "./EthVisuals";
import { LEVELS, LEVEL_STEPS, LearnStepView, type EthLevel } from "./EthLearn";
import { EthDesk, openEthWindow, type EthWin } from "./EthDevices";
import { ETH_CAUSES, ETH_CHALLENGES, TICKET_CAUSE, causeFeedback, ticketProofs, type EthCause } from "./ethPractice";

/**
 * Ethernet Lab — learn the switch, then work on it.
 *
 *   Learn (4 levels)   one frame and the NIC filter → inside the switch (learn, look up, flood or forward) →
 *                      broadcast and time → two switches and a moving host. Each step rebuilds the network it starts
 *                      from, plays its frames on the topology, and shows only the evidence its idea needs.
 *   Engineering        Investigate (devices in their own windows: SW1 console in IOS or Junos, ports and counters,
 *                      MAC tables, captures on any port; hosts' cables and NICs) · Troubleshoot (reported tickets:
 *                      reproduce, explain with evidence, fix with real actions, prove with frames) · Practice
 *                      (make the network do something, judged from its captures and tables).
 *
 * One lab state drives everything (topology animation, windows, CLI, tables, captures, counters, verdicts). The lab
 * is a sandbox: nothing here touches the guided lesson or the progress store.
 */

export const ETH_LAB_SEGMENT_MS = 1000;
const COLOR = { unicast: "#38bdf8", broadcast: "#f59e0b", accepted: "#10b981", discarded: "#94a3b8", stop: "#f87171" };
const COMPACT_POS: Record<string, { x: number; y: number }> = { "HOST-A": { x: 18, y: 20 }, "HOST-C": { x: 12, y: 52 }, SW1: { x: 52, y: 50 }, "DESK-SW": { x: 36, y: 84 } };
const compactNodes = (net: EthLabState["net"]) => ethNodes(net).map((n) => ({ ...n, ...(n.id === "HOST-B" ? (net.hostB === "SW1 ge-0/0/2" ? { x: 78, y: 20 } : { x: 78, y: 84 }) : COMPACT_POS[n.id]) }));
const letter = (h: string) => h.slice(-1);
const B_MAC = ETH_MAC["HOST-B"];
const sameCfg = (a: EthLabCfg, b: EthLabCfg) => JSON.stringify([a.aging, a.statics.map((x) => `${x.mac}@${x.port}`).sort(), [...a.shut].sort()]) === JSON.stringify([b.aging, b.statics.map((x) => `${x.mac}@${x.port}`).sort(), [...b.shut].sort()]);
const INITIAL_HIST: EthCommit[] = [{ cfg: ETH_DEFAULT_CFG, at: 0, by: "root" }];

type Mode = "learn" | "gate" | "eng";
type EngTab = "investigate" | "troubleshoot" | "practice";
interface TicketRun {
  id: EthTicketId;
  /** Capture number when the ticket was reported, and when the diagnosis was made (proof frames must come after). */
  mark0?: number;
  markFix?: number;
  /** Each hypothesis tried, with the evidence as it stood when it was tried. */
  tried: { cause: EthCause; text: string }[];
  diagnosed: boolean;
  hint: boolean;
}
const FIX_HINT: Record<EthTicketId, (v: CliVendor) => string> = {
  cable: () => "Open HOST-B: its network card window shows the cable. Plug it back in, then send HOST-A → HOST-B.",
  stale: (v) => `Either HOST-B sends any frame (open HOST-B → Send a frame), or clear the entry on SW1: ${v === "cisco" ? "clear mac address-table dynamic address 0011.2233.440b" : "clear ethernet-switching table"}. Then send HOST-A → HOST-B.`,
  dupmac: () => "Find the card that uses HOST-B's MAC (each host's Network card tab, or SW1's log of moves), give it back its burned-in address, then let HOST-B send and test HOST-A → HOST-B.",
  static: (v) => (v === "cisco" ? "In SW1's console: configure terminal, then no mac address-table static 0011.2233.440b vlan 1. Then test HOST-A → HOST-B." : "In SW1's console: configure, delete vlans default switch-options interface ge-0/0/4.0 static-mac 00:11:22:33:44:0b (show | compare first), commit. Then test HOST-A → HOST-B."),
  flood: () => "Nothing is broken: SW1 just hasn't heard from HOST-B. Let HOST-B send any frame, then test HOST-A → HOST-B and check HOST-C's capture.",
};

export function EthernetLabWorkspace({ open, onClose }: { open: boolean; onClose: () => void }) {
  const runner = useLabRunner(ETH_LAB_MODEL, { segmentMs: ETH_LAB_SEGMENT_MS });
  const lab = runner.state;
  const [mode, setMode] = useState<Mode>("learn");
  const [level, setLevel] = useState<EthLevel>(1);
  const [unlocked, setUnlocked] = useState<EthLevel>(1);
  const [stepIdx, setStepIdx] = useState<Record<EthLevel, number>>({ 1: 0, 2: 0, 3: 0, 4: 0 });
  const [ranKey, setRanKey] = useState<string | undefined>(undefined);
  const [picked, setPicked] = useState<string[]>([]);
  const [engTab, setEngTab] = useState<EngTab>("investigate");
  const [vendor, setVendor] = useState<CliVendor>("cisco");
  const [mobileTab, setMobileTab] = useState<PracticeLabTab>("topology");
  const [tools, setTools] = useState<"tables" | "captures" | "log">("tables");
  const [capPoint, setCapPoint] = useState<string>("HOST-C eth0");
  const [composer, setComposer] = useState<{ src: EthHost; dst: EthHost | "broadcast" }>({ src: "HOST-A", dst: "HOST-B" });
  // SW1's console state (kept here so closing the window keeps the session, mode and candidate).
  const [consoles, setConsoles] = useState<Record<string, ConsoleSession>>({});
  const [cisco, setCisco] = useState<EthCiscoMode>({ kind: "exec" });
  const [junosMode, setJunosMode] = useState<EthJunosMode>("op");
  const [cand, setCand] = useState<EthLabCfg>(ETH_DEFAULT_CFG);
  const [hist, setHist] = useState<EthCommit[]>(INITIAL_HIST);
  const [question, setQuestion] = useState<CliQuestion | undefined>(undefined);
  const [notes, setNotes] = useState(true);
  const [wins, setWins] = useState<EthWin[]>([]);
  const [winFocus, setWinFocus] = useState<EthDevice | undefined>(undefined);
  const [ticket, setTicket] = useState<TicketRun | undefined>(undefined);
  const [challenge, setChallenge] = useState<{ id: string; cap: number; log: number; hint: boolean } | undefined>(undefined);

  const inFlight = isInFlight(lab);
  const busy = inFlight || runner.busy;
  const tx = lab.tx;
  const shownWave = runner.replayFrame ? runner.replayFrame.hop : (tx?.wave ?? 0);
  const steps = LEVEL_STEPS[level];
  const idx = stepIdx[level];
  const step = steps[idx];
  const key = `${level}:${idx}`;
  const ran = !step?.run || ranKey === key;

  /**
   * Every action goes through here. Actions that aren't frames are instant and deterministic, so their result is known
   * now: SW1's committed configuration follows the network (an IOS line, a ticket or a fresh network changes it outside
   * a Junos commit, and Junos then shows that as the active configuration, rollback 0).
   */
  function act(a: EthLabAction): EthLabState | undefined {
    const next = a.type === "send" ? undefined : runInstant(lab, a);
    if (next && !sameCfg(next.cfg, lab.cfg)) {
      const by = a.type === "ticket" ? "ticket" : a.type === "config" ? "admin" : "root";
      setHist((h) => (sameCfg(h[0].cfg, next.cfg) ? h : [{ cfg: next.cfg, at: Date.now(), by }, ...h].slice(0, 50)));
      if (junosMode === "op") setCand(next.cfg);
    }
    runner.run(a);
    return next;
  }


  // ---------------------------------------------------------------- Learn
  /** The network a step starts from: the nearest step at or before it that sets one up, plus the frames run since. */
  function setupFor(l: EthLevel, i: number): EthLabAction[] | undefined {
    const ss = LEVEL_STEPS[l];
    let j = i;
    while (j > 0 && !ss[j].setup) j--;
    if (!ss[j].setup) return undefined;
    return [...ss[j].setup!, ...ss.slice(j, i).flatMap((s) => s.run?.actions ?? [])];
  }
  function goStep(l: EthLevel, i: number, viaNext = false) {
    const s = LEVEL_STEPS[l][i];
    setLevel(l);
    setStepIdx((m) => ({ ...m, [l]: i }));
    setPicked([]);
    setRanKey(undefined);
    runner.stopReplay();
    const actions = viaNext ? s.setup : setupFor(l, i);
    if (actions) runner.run({ type: "batch", actions, text: `Learn · ${s.title}: network ready` });
  }
  function runStep() {
    if (!step?.run || busy) return;
    setRanKey(key);
    runner.runSequence(step.run.actions);
  }
  function nextStep() {
    if (busy || !ran) return;
    if (idx + 1 < steps.length) return goStep(level, idx + 1, true);
    if (level < 4) {
      const n = (level + 1) as EthLevel;
      setUnlocked((u) => (u < n ? n : u));
      goStep(n, 0);
    } else setMode("gate");
  }
  function toEngineering() {
    setUnlocked(4);
    setMode("eng");
    setEngTab("investigate");
    setTicket(undefined);
    setChallenge(undefined);
    act({ type: "fresh" });
  }
  function toLearn(l: EthLevel) {
    setWins([]);
    setMode("learn");
    goStep(l, 0);
  }

  // ---------------------------------------------------------------- Engineering
  function openDevice(id: EthDevice) {
    setWins((w) => openEthWindow(w, id));
    setWinFocus(id);
  }
  function startTicket(id: EthTicketId) {
    const s = act({ type: "ticket", id });
    setTicket({ id, tried: [], diagnosed: false, hint: false, mark0: s?.capNo ?? lab.capNo });
  }
  function guess(cause: EthCause) {
    if (!ticket || ticket.diagnosed) return;
    const right = cause === TICKET_CAUSE[ticket.id];
    setTicket({ ...ticket, tried: [...ticket.tried.filter((x) => x.cause !== cause), { cause, text: causeFeedback(lab, cause, vendor) }], diagnosed: right, markFix: right ? lab.capNo : ticket.markFix });
  }
  function startChallenge(id: string, fresh: boolean) {
    const s = (fresh && act({ type: "fresh" })) || lab;
    setChallenge({ id, cap: s.capNo, log: s.log[s.log.length - 1]?.id ?? 0, hint: false });
  }

  function reset() {
    runner.reset();
    setMode("learn");
    setLevel(1);
    setUnlocked(1);
    setStepIdx({ 1: 0, 2: 0, 3: 0, 4: 0 });
    setRanKey(undefined);
    setPicked([]);
    setEngTab("investigate");
    setConsoles({});
    setCisco({ kind: "exec" });
    setJunosMode("op");
    setCand(ETH_DEFAULT_CFG);
    setHist(INITIAL_HIST);
    setQuestion(undefined);
    setWins([]);
    setTicket(undefined);
    setChallenge(undefined);
    setMobileTab("topology");
  }

  // ---------------------------------------------------------------- Topology
  const eng = mode === "eng";
  const portsOnMap = eng || mode === "gate" || !!step?.portsOnMap;
  const showFrame = !!tx && (lab.last?.type === "send" || !!runner.replayFrame || (lab.last?.type === "batch" && mode === "learn" && !step?.run));
  const packets: LabPacketView[] =
    showFrame && tx
      ? ethVisibleSegments(tx, shownWave).map(({ seg, moving }) => {
          const bcast = tx.dst === "broadcast";
          const base = bcast ? `${letter(tx.src)}→all` : `${letter(tx.src)}→${letter(tx.dst)}`;
          const d = tx.decisions.find((x) => x.sw === seg.to);
          const rest =
            seg.outcome === "accepted"
              ? { label: `✓ ${base}`, color: COLOR.accepted }
              : seg.outcome === "discarded"
                ? { label: "✗ discard", color: COLOR.discarded }
                : seg.outcome === "forwarded"
                  ? { label: base, color: bcast ? COLOR.broadcast : COLOR.unicast }
                  : seg.outcome === "filtered"
                    ? { label: "filtered", color: COLOR.discarded }
                    : d && d.kind !== "known-unicast"
                      ? { label: "no other port", color: COLOR.discarded }
                      : { label: "dropped", color: COLOR.stop };
          return {
            id: `${tx.id}:${seg.id}:${runner.replayFrame?.id ?? "live"}`,
            path: [seg.from, seg.to],
            hop: moving ? 0 : 1,
            done: !moving,
            label: moving ? base : rest.label,
            color: moving ? (bcast ? COLOR.broadcast : COLOR.unicast) : rest.color,
            description: `${tx.frame.summary}: copy ${seg.from} ${portLabel(seg.from as EthDevice, seg.egress, vendor)} → ${seg.to}${seg.outcome && !moving ? ` (${seg.outcome})` : ""}`,
          };
        })
      : [];
  const movingIds = packets.filter((p) => !p.done).flatMap((p) => p.path);
  const nodeTags: Record<string, string> = {};
  if (lab.last?.type === "send" && tx && !runner.replayFrame && (eng || level >= 2))
    tx.learned.forEach((l) => {
      if ((l.kind === "learned" || l.kind === "moved") && tx.decisions.some((d) => d.sw === l.sw && shownWave > d.wave)) nodeTags[l.sw] = `${nodeTags[l.sw] ? `${nodeTags[l.sw]} ` : ""}+ ${who(l.mac)}`;
    });
  const cues: string[] = [];
  if (lab.last?.type === "send" && tx && (eng || level >= 2)) {
    tx.decisions.filter((d) => shownWave > d.wave).forEach((d) => cues.push(`${d.sw}: ${d.kind === "broadcast" ? "broadcast → flood" : d.kind === "unknown-unicast" ? "unknown → flood" : d.egress.length ? `known → ${portLabel(d.sw, d.egress[0], vendor)}` : "known → no way out"}`));
    if (tx.wave >= tx.waves && tx.dst !== "broadcast" && !tx.received.some((r) => r.host === tx.dst && r.accepted)) cues.push(`${tx.dst} never got it`);
  } else if (lab.last?.type === "move-b") cues.push(lab.last.to === "desk" ? `HOST-B at the hot desk · SW1 ${ethPortName(vendor, "ge-0/0/2")} down` : `HOST-B back on SW1 ${ethPortName(vendor, "ge-0/0/2")}`);
  else if (lab.last?.type === "time") cues.push(`t = ${lab.net.clock} s · ${lab.last.expired.length} expired`);
  const pn = (p: string) => ethPortName(vendor, p);
  const edges = ethEdges(lab.net).map((e) => {
    const host = (e.a.startsWith("HOST") ? e.a : e.b.startsWith("HOST") ? e.b : undefined) as EthHost | undefined;
    const up = host ? hostLink(lab, host).up : !lab.cfg.shut.includes("ge-0/0/4");
    const label = !portsOnMap ? undefined : e.id === "sw1-desk" ? `${pn("ge-0/0/4")} ↔ port 1` : e.id === "b-desk" ? "port 2" : pn(e.label);
    return { ...e, label, state: up ? ("full" as const) : ("down" as const) };
  });
  const dimmed = ETH_HOSTS.filter((h) => !hostLink(lab, h).plugged);
  const topologyFor = (compact: boolean) => (
    <LabTopology
      nodes={compact ? compactNodes(lab.net) : ethNodes(lab.net)}
      edges={edges}
      regions={ETH_REGIONS}
      activeNodeIds={movingIds}
      selectedNodeId={eng ? winFocus : undefined}
      dimmedNodeIds={dimmed}
      onNodeClick={eng ? (id) => openDevice(id as EthDevice) : undefined}
      packets={packets}
      segmentMs={ETH_LAB_SEGMENT_MS}
      nodeTags={compact ? undefined : nodeTags}
      cues={cues}
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
  const learnAction = (compact: boolean) =>
    !step ? null : step.run && !ran ? (
      pill(compact ? "Send ▶" : `▶ ${step.run.label}`, runStep, busy, "primary")
    ) : (
      pill(idx + 1 < steps.length ? "Next →" : level < 4 ? (compact ? `Level ${level + 1} →` : `Level ${level + 1}: ${LEVELS[level].title} →`) : "I've finished learning →", nextStep, busy, "primary")
    );

  const header = (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1">
        {LEVELS.map((l) => (
          <button
            key={l.level}
            type="button"
            disabled={l.level > unlocked || busy}
            aria-current={mode === "learn" && level === l.level ? "step" : undefined}
            onClick={() => (eng ? toLearn(l.level) : (setMode("learn"), goStep(l.level, 0)))}
            className={clsx("rounded-full border px-2.5 py-0.5 text-[11.5px] font-semibold disabled:opacity-35", mode === "learn" && level === l.level ? "border-pv-cyan bg-pv-cyan/15 text-pv-text" : l.level < unlocked || eng ? "border-pv-success/50 text-pv-success" : "border-pv-border text-pv-text-muted")}
          >
            {l.level}. {l.title}
          </button>
        ))}
        <span className="mx-1 text-pv-text-faint">→</span>
        <button type="button" disabled={busy} onClick={() => (eng ? undefined : unlocked >= 4 && mode === "gate" ? toEngineering() : setMode("gate"))} className={clsx("rounded-full border px-2.5 py-0.5 text-[11.5px] font-semibold", eng ? "border-pv-violet bg-pv-violet/15 text-pv-text" : "border-pv-violet/50 text-pv-violet")}>
          Engineering workspace
        </button>
      </div>
      {mode === "learn" && <p className="text-[12px] text-pv-text-faint">Level {level}: {LEVELS[level - 1].idea}</p>}
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
      <LearnStepView lab={lab} step={step} vendor={vendor} ran={ran} picked={picked} onPick={(p) => setPicked((x) => (x.includes(p) ? x.filter((y) => y !== p) : [...x, p]))} shownWave={shownWave} />
      <div className="flex flex-wrap items-center gap-2 border-t border-pv-border pt-2">
        {idx > 0 && pill("← Back", () => goStep(level, idx - 1), busy)}
        {step.run && ran && pill("↻ Replay", () => tx && runner.replay(tx.waves), busy || !tx || lab.last?.type !== "send")}
        {step.run && ran && pill("Run it again", () => goStep(level, idx), busy)}
        <span className="flex-1" />
        {learnAction(false)}
      </div>
    </div>
  );

  const gateBoard = (
    <div className="space-y-3 rounded-2xl border border-pv-violet/50 bg-pv-violet/[0.05] p-4">
      <h3 className="text-[16px] font-bold text-pv-text">You can read a switch now</h3>
      <ul className="list-disc space-y-1 pl-5 text-[13px] text-pv-text-muted">
        <li>A NIC keeps frames for its own MAC (or broadcast) and discards the rest.</li>
        <li>A switch learns from the <b className="text-pv-text">source</b> MAC and the port it arrived on, then looks up the <b className="text-pv-text">destination</b>: known → one port, unknown → flood.</li>
        <li>Broadcasts are flooded by design; unknown unicast is flooded because the switch doesn&apos;t know.</li>
        <li>Entries age out when a host stays silent; a port going down flushes its entries.</li>
        <li>Each switch has its own table, and an entry can be stale: forwarded confidently to the wrong place.</li>
      </ul>
      <p className="text-[13px] text-pv-text-muted">
        In the engineering workspace the same network is yours: open devices in their own windows, use SW1&apos;s console (Cisco or Junos), capture on any port, take tickets and solve challenges. Nothing guides your hand there; the network&apos;s evidence does.
      </p>
      <div className="flex flex-wrap gap-2">
        {pill("Enter the engineering workspace →", toEngineering, busy, "primary")}
        {pill("Review level 4", () => toLearn(4), busy)}
      </div>
    </div>
  );

  const hostSelect = (value: string, onChange: (v: string) => void, options: string[], label: string) => (
    <label className="flex items-center gap-1 text-[11.5px] text-pv-text-faint">
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)} className="rounded-md border border-pv-border bg-pv-bg px-1.5 py-1 text-[12px] text-pv-text">
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
  const trafficBar = (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-pv-border p-2" aria-label="Traffic and time">
      {hostSelect(composer.src, (v) => setComposer((c) => ({ src: v as EthHost, dst: c.dst === v ? (ETH_HOSTS.find((h) => h !== v) as EthHost) : c.dst })), ETH_HOSTS, "From")}
      {hostSelect(composer.dst, (v) => setComposer((c) => ({ ...c, dst: v as EthHost | "broadcast" })), [...ETH_HOSTS.filter((h) => h !== composer.src), "broadcast"], "to")}
      {pill("Send ▶", () => act({ type: "send", src: composer.src, dst: composer.dst }), busy, "primary")}
      <span className="h-4 w-px bg-pv-border" />
      {pill("+60 s", () => act({ type: "time", seconds: 60 }), busy)}
      {pill("+310 s", () => act({ type: "time", seconds: 310 }), busy)}
      {pill("↻ Replay", () => tx && runner.replay(tx.waves), busy || !tx || lab.last?.type !== "send")}
      <span className="pv-mono text-[11px] text-pv-text-faint">t = {lab.net.clock} s</span>
    </div>
  );
  const deviceButtons = (
    <div className="flex flex-wrap gap-1">
      {(["SW1", "DESK-SW", ...ETH_HOSTS] as EthDevice[]).map((d) => (
        <button key={d} type="button" onClick={() => openDevice(d)} className="rounded-md border border-pv-border px-2 py-0.5 text-[12px] font-semibold text-pv-text-muted hover:border-pv-cyan/60 hover:text-pv-text">
          {d === "SW1" ? "⇄ SW1 (console)" : d === "DESK-SW" ? "⇄ DESK-SW" : `💻 ${d}`}
        </button>
      ))}
    </div>
  );
  const lastFrame = tx && lab.last?.type === "send" && (
    <details open className="rounded-xl border border-pv-border p-2">
      <summary className="cursor-pointer text-[12px] font-semibold text-pv-text">
        Last frame: {tx.src} → {tx.dst}
      </summary>
      <div className="mt-2 space-y-2">
        <FrameCard tx={tx} compact />
        <div className={clsx("grid gap-2", tx.decisions.some((d) => d.sw === "DESK-SW") && "lg:grid-cols-2")}>
          <div className="space-y-1">
            <p className="text-[10.5px] font-bold uppercase tracking-wide text-pv-text-faint">Inside SW1</p>
            <SwitchMind lab={lab} tx={tx} sw="SW1" vendor={vendor} shownWave={shownWave} />
          </div>
          {tx.decisions.some((d) => d.sw === "DESK-SW") && (
            <div className="space-y-1">
              <p className="text-[10.5px] font-bold uppercase tracking-wide text-pv-text-faint">Inside DESK-SW</p>
              <SwitchMind lab={lab} tx={tx} sw="DESK-SW" vendor={vendor} shownWave={shownWave} />
            </div>
          )}
        </div>
        {shownWave >= tx.waves && <NicVerdicts lab={lab} tx={tx} />}
      </div>
    </details>
  );

  const t = ticket;
  const proofs = t?.diagnosed && t.markFix !== undefined ? ticketProofs(lab, t.id, t.markFix, vendor) : [];
  const solved = proofs.length > 0 && proofs.every((p) => p.ok);
  const reproduced = !!t && t.mark0 !== undefined && lab.captures.some((c) => c.no > t.mark0! && c.dir === "out" && c.dst === B_MAC && (ETH_HOSTS as string[]).includes(c.dev));
  const phase = !t ? 0 : !reproduced && !t.diagnosed ? 1 : !t.diagnosed ? 2 : !solved ? 3 : 4;
  const troubleshootBoard = (
    <div className="space-y-3">
      {!t ? (
        <>
          <p className="text-[13px] text-pv-text-muted">Users report problems in their own words. Each ticket breaks the network with a real mechanism — reproduce it, explain it from evidence, fix it with the tools an engineer has, and prove it with frames.</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {(Object.keys(ETH_TICKETS) as EthTicketId[]).map((id) => (
              <button key={id} type="button" disabled={busy} onClick={() => startTicket(id)} className="rounded-xl border border-pv-border p-2.5 text-left hover:border-pv-violet/60">
                <p className="text-[13px] font-bold text-pv-text">{ETH_TICKETS[id].title}</p>
                <p className="text-[12px] italic text-pv-text-muted">{ETH_TICKETS[id].report}</p>
              </button>
            ))}
          </div>
        </>
      ) : (
        <div className="space-y-3 rounded-2xl border border-pv-violet/40 p-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-[14px] font-bold text-pv-text">{ETH_TICKETS[t.id].title}</p>
              <p className="text-[12.5px] italic text-pv-text-muted">{ETH_TICKETS[t.id].report}</p>
            </div>
            {pill("All tickets", () => setTicket(undefined), busy)}
          </div>
          <ol className="flex flex-wrap gap-1 text-[11.5px]">
            {["Reproduce", "Explain", "Fix", "Prove"].map((p, i) => (
              <li key={p} className={clsx("rounded-full border px-2 py-0.5 font-semibold", phase > i + 1 || (i === 3 && solved) ? "border-pv-success/60 text-pv-success" : phase === i + 1 ? "border-pv-violet bg-pv-violet/15 text-pv-text" : "border-pv-border text-pv-text-faint")}>
                {i + 1}. {p}
              </li>
            ))}
          </ol>
          {phase === 1 && <p className="text-[13px] text-pv-text-muted">See it for yourself first: send a frame to HOST-B (the traffic bar above, or open a host and use <b className="text-pv-text">Send a frame</b>). Then look at where it went: the topology, SW1&apos;s table, captures.</p>}
          {phase >= 2 && (
            <div className="space-y-1.5">
              <p className="text-[13px] text-pv-text-muted">
                {t.diagnosed ? "Diagnosis:" : "What explains what you see? Gather evidence (SW1's console, tables, captures, the hosts' cards), then choose. A wrong choice gets the evidence that rules it out."}
              </p>
              <div className="grid gap-1">
                {ETH_CAUSES.map((c) => {
                  const tried = t.tried.find((x) => x.cause === c.id);
                  const right = c.id === TICKET_CAUSE[t.id];
                  if (t.diagnosed && !tried) return null;
                  return (
                    <div key={c.id}>
                      <button type="button" disabled={t.diagnosed || busy} onClick={() => guess(c.id)} className={clsx("w-full rounded-lg border px-2 py-1 text-left text-[12.5px]", tried ? (right ? "border-pv-success/60 bg-pv-success/10 text-pv-text" : "border-pv-warning/50 text-pv-text-muted") : "border-pv-border text-pv-text hover:border-pv-violet/60")}>
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
              {!solved && <p className="text-[12.5px] text-pv-text-muted">Use the devices: SW1&apos;s console, the hosts&apos; cables and network cards. Then send the frame that proves it. Every check below is read from the network.</p>}
              <ul className="space-y-0.5">
                {proofs.map((p) => (
                  <li key={p.label} className={clsx("text-[12.5px]", p.ok ? "text-pv-success" : "text-pv-text-muted")}>
                    {p.ok ? "✓" : "○"} {p.label}
                  </li>
                ))}
              </ul>
              {!solved && !t.hint && pill("Hint: how could this be fixed?", () => setTicket({ ...t, hint: true }))}
              {!solved && t.hint && <p className="text-[12px] text-pv-text-muted">{FIX_HINT[t.id](vendor)}</p>}
              {solved && <p className="text-[12.5px] text-pv-text">Ticket closed with evidence. {pill("Next ticket", () => setTicket(undefined))}</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );

  const ch = challenge && ETH_CHALLENGES.find((c) => c.id === challenge.id);
  const chDone = !!ch && ch.done(lab, { cap: challenge!.cap, log: challenge!.log });
  const practiceBoard = (
    <div className="space-y-3">
      {!ch ? (
        <>
          <p className="text-[13px] text-pv-text-muted">Make the network do something. Each challenge is judged from what the network actually did after you started it: its captures, tables and log.</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {ETH_CHALLENGES.map((c) => (
              <button key={c.id} type="button" disabled={busy} onClick={() => startChallenge(c.id, true)} className="rounded-xl border border-pv-border p-2.5 text-left hover:border-pv-cyan/60">
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
            {pill("All challenges", () => setChallenge(undefined), busy)}
          </div>
          <p className="text-[13px] text-pv-text-muted">{ch.task}</p>
          <p className="text-[11.5px] text-pv-text-faint">Started on a fresh network. Only what happens from now on counts.</p>
          {chDone ? (
            <p className="pv-pop text-[13px] font-semibold text-pv-success">✓ Done. Proof: {ethVendorText(vendor, ch.proof)}</p>
          ) : challenge!.hint ? (
            <p className="text-[12.5px] text-pv-text-muted">Hint: {ethVendorText(vendor, ch.hint)}</p>
          ) : (
            pill("Hint", () => setChallenge({ ...challenge!, hint: true }))
          )}
          <div className="flex gap-2">{pill("Start over (fresh network)", () => startChallenge(ch.id, true), busy)}</div>
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
          <button key={m} type="button" role="tab" aria-selected={engTab === m} disabled={busy} onClick={() => (setEngTab(m), setTicket(undefined), setChallenge(undefined), m === "investigate" && engTab !== "investigate" && act({ type: "fresh" }))} className={clsx("rounded-lg border px-3 py-1 text-[12.5px] font-semibold", engTab === m ? "border-pv-violet bg-pv-violet/15 text-pv-text" : "border-pv-border text-pv-text-muted hover:text-pv-text")}>
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
          <p>The same LAN, yours to explore. Things worth trying, and checking with evidence:</p>
          <ul className="list-disc space-y-0.5 pl-5 text-[12.5px]">
            <li>Send HOST-A → HOST-B twice. Compare HOST-C&apos;s capture after each.</li>
            <li>In SW1&apos;s console, read the table ({vendor === "cisco" ? "show mac address-table" : "show ethernet-switching table"}), then the counters on HOST-C&apos;s port ({vendor === "cisco" ? "show interfaces Gi1/0/3" : "show interfaces ge-0/0/3"}).</li>
            <li>Set the aging time to 30 s, pass 60 s, and watch what a frame to a silent host does.</li>
            <li>Unplug HOST-C, send a broadcast and count the copies. Plug it back in: does SW1 know HOST-C?</li>
            <li>Move HOST-B to the hot desk and back without letting it speak. Where does SW1 send its frames?</li>
          </ul>
          <div className="flex flex-wrap gap-2">{pill("Fresh network", () => act({ type: "fresh" }), busy)}</div>
        </div>
      )}
      {engTab === "troubleshoot" && troubleshootBoard}
      {engTab === "practice" && practiceBoard}
      {lastFrame}
    </div>
  );

  // ---------------------------------------------------------------- Tools
  const capPoints = [...SW1_PORTS.map((p) => `SW1 ${p}`), ...DESK_PORTS.map((p) => `DESK-SW ${p}`), ...ETH_HOSTS.map((h) => `${h} eth0`)];
  const [capDev, ...capRest] = capPoint.split(" ");
  const capIface = capRest.join(" ");
  const showTools = eng || mode === "gate" || level >= 2;
  const liveState = !showTools ? (
    <p className="text-[12.5px] text-pv-text-muted">Level 1 is about the frame itself. The switch&apos;s table, captures and log appear from level 2, when you open the switch up.</p>
  ) : (
    <div className="space-y-2">
      <div role="tablist" className="flex gap-1">
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
        <div className="flex rounded-full border border-pv-border p-0.5 text-[11px]" aria-label="Port names">
          {(["cisco", "juniper"] as const).map((v) => (
            <button key={v} type="button" aria-pressed={vendor === v} onClick={() => setVendor(v)} className={clsx("rounded-full px-2 py-0.5 font-semibold", vendor === v ? "bg-pv-cyan/20 text-pv-text" : "text-pv-text-faint")}>
              {v === "cisco" ? "Cisco names" : "Junos names"}
            </button>
          ))}
        </div>
      </div>
      {tools === "tables" && (
        <div className="space-y-2">
          <MacTable lab={lab} sw="SW1" vendor={vendor} tx={lab.last?.type === "send" ? tx : undefined} />
          {(eng || level >= 4 || mode === "gate") && <MacTable lab={lab} sw="DESK-SW" vendor={vendor} tx={lab.last?.type === "send" ? tx : undefined} />}
          <p className="text-[10.5px] text-pv-text-faint">
            Lab clock t = {lab.net.clock} s · aging {lab.cfg.aging} s{lab.cfg.statics.length ? ` · ${lab.cfg.statics.length} static` : ""}
            {lab.cfg.shut.length ? ` · shut: ${lab.cfg.shut.map(pn).join(", ")}` : ""}
          </p>
        </div>
      )}
      {tools === "captures" && (
        <div className="space-y-1.5">
          <label className="flex items-center gap-1 text-[11.5px] text-pv-text-faint">
            Capture at
            <select value={capPoint} onChange={(e) => setCapPoint(e.target.value)} className="rounded-md border border-pv-border bg-pv-bg px-1.5 py-1 text-[12px] text-pv-text">
              {capPoints.map((p) => {
                const [d, ...r] = p.split(" ");
                return (
                  <option key={p} value={p}>
                    {d} {portLabel(d as EthDevice, r.join(" "), vendor)}
                  </option>
                );
              })}
            </select>
          </label>
          <CaptureList lab={lab} dev={capDev as EthDevice} iface={capIface} vendor={vendor} />
        </div>
      )}
      {tools === "log" && <LabEventLog entries={lab.log.map((l) => ({ ...l, text: ethVendorText(vendor, l.text) }))} />}
    </div>
  );

  const cliApi = { cisco, setCisco, junosMode, setJunosMode, cand, setCand, hist, commit: (cfg: EthLabCfg, comment?: string) => (setHist((h) => [{ cfg, at: Date.now(), by: "student", comment }, ...h].slice(0, 50)), act({ type: "config", cfg, line: `commit${comment ? ` comment "${comment}"` : ""}` })) };

  return (
    <PracticeLabShell
      open={open}
      onClose={onClose}
      title="Ethernet Lab"
      sandboxNote={eng ? "Engineering workspace · sandbox, no progress" : "Same network as the lesson · sandbox, no progress"}
      onReset={reset}
      animate={runner.animate}
      onToggleAnimate={() => runner.setAnimate(!runner.animate)}
      stages={[]}
      currentStage={0}
      primaryAction={(compact) => (mode === "learn" ? learnAction(compact) : null)}
      topology={topology}
      topologyClassName="h-[360px] sm:h-[clamp(240px,36vh,340px)]"
      eventStrip={<p className="truncate text-[11.5px] text-pv-text-muted" aria-live="polite">{ethVendorText(vendor, lab.log[lab.log.length - 1]?.text ?? "")}</p>}
      board={
        <div className="space-y-3">
          {header}
          {mode === "learn" && learnBoard}
          {mode === "gate" && gateBoard}
          {eng && engBoard}
          {eng && (
            <EthDesk
              windows={wins}
              setWindows={setWins}
              focus={winFocus}
              setFocus={setWinFocus}
              ctx={{ lab, act, busy, vendor, setVendor, cli: cliApi, consoles, setConsoles, question, setQuestion, notes, setNotes }}
            />
          )}
        </div>
      }
      liveState={liveState}
      liveStateLabel={eng ? "Tools" : "What the switches know"}
      mobileTab={mobileTab}
      onMobileTabChange={setMobileTab}
      tabLabels={{ state: eng ? "Tools" : "Tables" }}
    />
  );
}
