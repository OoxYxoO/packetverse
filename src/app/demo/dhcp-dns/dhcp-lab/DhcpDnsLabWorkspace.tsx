"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { clsx } from "clsx";
import { PracticeLabShell, type PracticeLabTab } from "@/components/practice-lab/PracticeLabShell";
import { useLabRunner } from "@/lib/practice-lab/useLabRunner";
import type { CliSessionMap } from "@/components/protocol/CLITerminal";
import type { CliVendor } from "@/lib/cli/types";
import { DL_CONFIG_EXPLAIN, DL_MIGRATE_EXPLAIN, dlNarrate } from "./dhcpNarrate";
import { INITIAL_SEL, type InvestigateSel } from "./Investigate";
import { journeyEnd, journeys, ACT_TONE, type Coach } from "./dhcpObserve";
import { LEVELS, LEVEL_STEPS, Walkthrough, type Level } from "./LearnPath";
import { DeviceCard, activityBadge } from "./DeviceCard";
import { BuildMode, INITIAL_BUILD, makeBuildApi, type BuildSnap } from "./BuildMode";
import type { CiscoMode, CliQuestion, JunosMode } from "./dhcpBuildCli";
import { DeviceDesk, openWindow, type WinState } from "./DeviceWindow";
import type { ConsoleSession } from "./ConsoleTerminal";
import type { InspectNode } from "./dhcpObserve";
import { Workbench, type Station } from "./Workbench";
import { dhcpExchange } from "./dhcpExchange";
import { IfNameContext, ifNamer } from "./ifNames";
import { ConceptsDrawer, type ConceptId } from "./Concepts";
import { MissionBar } from "./Mission";
import { DECK_CSS, Mover } from "@/components/presentation/ScrollyDeck";
import { Token, Topo, nodeAt, short, type TopoNode, type TopoView } from "@/components/presentation/Visuals";
import { DH_ADDR, DNS_NAME, LEASE_SECONDS } from "@/lib/sim-engine/scenarios/dhcpDns";
import {
  DL_IFACES,
  DL_NODE_IFACES,
  DL_ADDR,
  DL_CAUSES,
  DL_LAB_MODEL,
  DL_LOCATIONS,
  DL_T1,
  DL_T2,
  DL_TICKETS,
  DL_WEB_NEW,
  DL_WRONG,
  configured,
  dhcpNextLabel,
  fmtT,
  leaseLeft,
  type DlAction,
  type DlCause,
  type DlConfig,
  type DlNode,
  type DlPacket,
  type DlState,
  type DlTicketId,
} from "@/lib/sim-engine/scenarios/dhcpDnsLab";

/**
 * DHCP & DNS Lab: two workspaces, one simulation.
 *   ① Learn the service (levels 1–4): focused, full width, one card at a time, device cards under the topology.
 *   A "Ready" gate marks the end of learning.
 *   ② The engineering workspace: Follow the traffic → Troubleshoot → Build it. One task panel (with a mission bar
 *      that always says what to do, what to look at, and what's next) and ONE tool at a time (Follow · Device · CLI ·
 *      Timeline). A Concepts drawer brings learning context back without leaving the investigation, and a trip back
 *      to Learn keeps the investigation to return to.
 * The model (dhcpDnsLab.ts) is the only source of truth. Own runner/state; never sees the lesson or progress.
 */

const NODES: TopoNode[] = [
  { id: "CLIENT", label: "CLIENT", icon: "💻", x: 8, y: 55 },
  { id: "SW1", label: "SW1", icon: "⇄", x: 26, y: 55 },
  { id: "R1", label: "R1", sub: "relay", icon: "R", x: 46, y: 55 },
  { id: "SW2", label: "SW2", icon: "⇄", x: 64, y: 55 },
  { id: "DHCP-SRV", label: "DHCP-SRV", sub: DH_ADDR["DHCP-SRV"], icon: "🗄", x: 89, y: 22 },
  { id: "DNS-SRV", label: "DNS-SRV", sub: DH_ADDR["DNS-SRV"], icon: "🗄", x: 89, y: 88 },
  { id: "WEB", label: "internet", sub: "203.0.113.x", icon: "🌐", x: 64, y: 12 },
];
const at = (n: string) => nodeAt(NODES, n);
const NAMES = [DNS_NAME, "mail.packetverse.test", "wwww.packetverse.test"];
type Change = { k: keyof DlConfig; v: DlConfig[keyof DlConfig] } | "migrate";
type Eng = "tickets" | "explore";
const STATION: Record<5 | 6 | 7, { id: Station; name: string }> = { 5: { id: "follow", name: "Follow the traffic" }, 6: { id: "troubleshoot", name: "Troubleshoot" }, 7: { id: "build", name: "Build it" } };

export function DhcpDnsLabWorkspace({ open, onClose }: { open: boolean; onClose: () => void }) {
  const runner = useLabRunner(DL_LAB_MODEL);
  const lab = runner.state;
  const act = (a: DlAction) => runner.run(a);
  const [level, setLevel] = useState<Level>(1);
  const [unlocked, setUnlocked] = useState<Level>(1);
  const [gate, setGate] = useState(false);
  const [stepIdx, setStepIdx] = useState<Partial<Record<Level, number>>>({});
  const [ranSeq, setRanSeq] = useState<Record<string, number>>({});
  const [eng, setEng] = useState<Eng>("tickets");
  const [lastChange, setLastChange] = useState<Change | undefined>(undefined);
  const [sel, setSel] = useState<InvestigateSel>(INITIAL_SEL);
  const [coach, setCoach] = useState<Coach>("guide");
  const [mobileTab, setMobileTab] = useState<PracticeLabTab>("topology");
  const [vendor, setVendor] = useState<CliVendor>("cisco");
  const [cliSessions, setCliSessions] = useState<CliSessionMap>({});
  const [name, setName] = useState(DNS_NAME);
  const [card, setCard] = useState<Exclude<DlNode, "WEB"> | undefined>(undefined);
  const [build, setBuild] = useState<BuildSnap>(INITIAL_BUILD);
  const [ciscoMode, setCiscoMode] = useState<CiscoMode>({ kind: "exec" });
  const [junosMode, setJunosMode] = useState<JunosMode>("op");
  const [consoles, setConsoles] = useState<Record<string, ConsoleSession>>({});
  const [cliQuestion, setCliQuestion] = useState<CliQuestion | undefined>(undefined);
  const [notes, setNotes] = useState(false);
  /** Build it yourself: the devices the student has opened on the lab desk, and the one a hint points at. */
  const [wins, setWins] = useState<WinState[]>([]);
  const [winFocus, setWinFocus] = useState<InspectNode | undefined>(undefined);
  const [pointed, setPointed] = useState<DlNode | undefined>(undefined);
  const [concept, setConcept] = useState<{ open: boolean; focus?: ConceptId }>({ open: false });
  /** An investigation left in the workspace while the student revisits Learn. */
  const [stash, setStash] = useState<{ level: Level; state: DlState } | undefined>(undefined);
  const engMode = level >= 5 && !gate;
  const steps = level <= 5 ? LEVEL_STEPS[level as 1 | 2 | 3 | 4 | 5] : [];
  const idx = Math.min(stepIdx[level] ?? 0, Math.max(0, steps.length - 1));
  const step = steps[idx];
  const stepKey = `${level}:${step?.id}`;
  // A step's actions can add several steps to the lab's sequence, so its run is recorded once the state has landed.
  const pending = useRef<string | undefined>(undefined);
  useEffect(() => {
    const k = pending.current;
    if (!k) return;
    pending.current = undefined;
    setRanSeq((m) => ({ ...m, [k]: lab.seq }));
  }, [lab.seq]);
  const ran = !!step && ranSeq[stepKey] === lab.seq;
  // Build: a test runs several actions (new laptop, DHCP, ping…). The topology replays everything the test sent, taken
  // from the capture (packets after the test's marker), not only the last action's packets.
  const [batch, setBatch] = useState<{ from: number; seq?: number } | undefined>(undefined);
  const batchPending = useRef(false);
  const [replay, setReplay] = useState(0);
  useEffect(() => {
    if (!batchPending.current) return;
    batchPending.current = false;
    setBatch((b) => b && { ...b, seq: lab.seq });
  }, [lab.seq]);
  const freshSel = (s: InvestigateSel): InvestigateSel => ({ ...s, journey: undefined, pick: undefined });
  const runStep = () => {
    step?.actions?.forEach((a) => act(a));
    pending.current = stepKey;
    setSel((s) => ({ ...freshSel(s), tab: "follow" }));
  };
  const goStep = (i: number) => {
    setStepIdx((m) => ({ ...m, [level]: i }));
    act({ type: "healthy" });
    setSel(freshSel);
  };
  const goLevel = (l: Level, restore?: DlState) => {
    setLevel(l);
    setGate(false);
    setLastChange(undefined);
    setCard(undefined);
    setSel(INITIAL_SEL);
    setMobileTab("topology");
    setCoach(l >= 6 ? "hints" : "guide");
    if (l === 6) setEng("tickets");
    if (l !== 7) {
      setWins([]);
      setPointed(undefined);
    }
    if (restore) act({ type: "restore", state: restore });
    // Build runs on the learner's own network; everything else on the healthy lesson network.
    else if (l === 7) act({ type: "build-start", config: build.config, records: build.records });
    else act({ type: "healthy" });
  };
  const unlock = (l: Level) => setUnlocked((u) => (l > u ? l : u));
  const finishLevel = () => {
    if (level === 4) {
      unlock(5);
      setGate(true);
      setCard(undefined);
      return;
    }
    const n = Math.min(7, level + 1) as Level;
    unlock(n);
    goLevel(n);
  };
  /** Leave the workspace for Learn, keeping the investigation to come back to. */
  const toLearn = (l: Level) => {
    if (engMode) setStash({ level, state: lab });
    setConcept({ open: false });
    goLevel(l);
  };
  const backToWorkspace = () => {
    if (!stash) return;
    const st = stash;
    setStash(undefined);
    goLevel(st.level, st.state);
  };
  const configure = (patch: Partial<DlConfig>) => {
    act({ type: "config", patch });
    const k = Object.keys(patch)[0] as keyof DlConfig;
    setLastChange({ k, v: patch[k] as DlConfig[keyof DlConfig] });
  };
  const doAct = (a: DlAction) => {
    act(a);
    setSel(freshSel);
  };
  /** Open one tool (and show the Tools tab on phones). */
  const openTool = (s: Partial<InvestigateSel>) => {
    setSel((cur) => ({ ...cur, pick: undefined, ...s }));
    setMobileTab("state");
  };
  const c = lab.client;
  const lastPkts = lab.capture.filter((p) => lab.lastPackets.includes(p.no));
  const inBatch = level === 7 && !!batch && batch.seq === lab.seq;
  const topoPkts = inBatch ? lab.capture.filter((p) => p.no > batch!.from) : lastPkts;
  const ticketOpen = level === 6 && eng === "tickets" && !!lab.ticket && !lab.ticket.solved;
  const t = lab.ticket;

  // What the mission bar says (Follow and Troubleshoot; Build has its own per step).
  const mission =
    level === 5 && step
      ? {
          task: step.title,
          look: !step.actions ? "this panel" : ran ? "the Follow tool: which device the message reached last" : "the case description",
          // Name the button the student will actually see.
          next: !step.actions ? (idx === steps.length - 1 ? "Next station: Troubleshoot →" : "Next →") : ran ? "pick the device where it stopped" : `press ▶ ${step.run ?? "Send"}`,
        }
      : level === 6 && eng === "explore"
        ? { task: "Free sandbox: change anything, see what it does", look: "the change card, then the Follow tool", next: "change ONE setting, make the laptop act, follow the result" }
        : level === 6
          ? !t
            ? { task: "Solve a user's ticket", look: "the ticket list below", next: "pick a ticket" }
            : t.solved
              ? { task: `Solved: ${DL_TICKETS[t.id].title}`, look: "the proof list", next: "pick another ticket, or move on to Build it" }
              : t.diagnosed
                ? { task: `Fix: ${DL_TICKETS[t.id].title}`, look: "the fix controls and the proof list", next: "apply the fix, then prove it from the laptop (renew, resolve, ping)" }
                : {
                    task: `Investigate: ${DL_TICKETS[t.id].title}`,
                    look: lab.lastPackets.length ? "the Follow tool, then the device where it stopped (Device tool, CLI)" : "the user's report",
                    next: lab.lastPackets.length ? "say where it stops and why" : "reproduce it with the laptop's buttons",
                  }
          : undefined;

  return (
    <IfNameContext.Provider value={ifNamer(vendor)}>
      <PracticeLabShell
        open={open}
        onClose={onClose}
        title="DHCP & DNS Lab"
        sandboxNote={engMode ? "Engineering workspace · sandbox, no progress" : "Same network as the lesson · sandbox, no progress"}
        onReset={() => {
          runner.reset();
          setLevel(1);
          setUnlocked(1);
          setGate(false);
          setStepIdx({});
          setRanSeq({});
          setLastChange(undefined);
          setSel(INITIAL_SEL);
          setCoach("guide");
          setCliSessions({});
          setMobileTab("topology");
          setCard(undefined);
          setBuild(INITIAL_BUILD);
          setCiscoMode({ kind: "exec" });
          setJunosMode("op");
          setConsoles({});
          setCliQuestion(undefined);
          setWins([]);
          setPointed(undefined);
          setStash(undefined);
          setConcept({ open: false });
        }}
        stages={[]}
        currentStage={0}
        primaryAction={(compact) =>
          compact && level === 6 && engMode && !configured(c) ? (
            <button type="button" onClick={() => doAct({ type: "dhcp-next" })} className="rounded-full bg-pv-cyan px-3 py-1 text-[12px] font-bold text-[#03131a]">
              {dhcpNextLabel(c)}
            </button>
          ) : null
        }
        topology={
          <LabTopo
            lab={lab}
            pkts={topoPkts}
            ifaceVendor={level >= 3 || engMode ? vendor : undefined}
            exchange={engMode && level === 7 ? { key: `${inBatch ? "b" : "l"}${replay}`, onReplay: () => setReplay((r) => r + 1) } : undefined}
            focus={level < 6 && !gate ? step?.focus : undefined}
            sel={sel}
            card={engMode ? (sel.tab === "device" ? sel.node : undefined) : card}
            activity={level >= 2 && !gate}
            compact={engMode && level !== 7}
            pointed={level === 7 ? pointed : undefined}
            hideFaults={ticketOpen || level !== 6}
            hint={gate ? "" : level === 7 && engMode ? "Click a device to open it." : engMode ? "Tap a device to open it in the Device tool." : `Tap a device to see what it knows${level >= 2 ? " and what it just did" : ""}.`}
            onNode={(n) => {
              if (n === "WEB" || gate) return;
              const d = n as Exclude<DlNode, "WEB">;
              // Build: the topology is the lab desk; clicking a device opens that device in its own window.
              if (engMode && level === 7) {
                setWins((w) => openWindow(w, d));
                setWinFocus(d);
                setPointed(undefined);
                setMobileTab("topology");
              } else if (engMode) openTool({ tab: "device", node: d, iface: undefined });
              else setCard((cur) => (cur === d ? undefined : d));
            }}
          />
        }
        topologyFooter={
          !engMode && !gate && card ? (
            <DeviceCard lab={lab} node={card} level={level} onClose={() => setCard(undefined)} onCapture={() => undefined} onFollow={() => undefined} onTables={() => undefined} onTerminal={() => undefined} />
          ) : undefined
        }
        topologyClassName="h-auto max-w-6xl"
        board={
          <div className="mx-auto max-w-4xl space-y-3">
            <style>{DECK_CSS}</style>
            <JourneyHeader
              level={level}
              unlocked={unlocked}
              eng={engMode}
              gate={gate}
              onLearn={(l) => (engMode ? toLearn(l) : goLevel(l))}
              onEnter={() => (stash ? backToWorkspace() : goLevel(Math.max(5, Math.min(unlocked, 7)) as Level))}
              onStation={(l) => goLevel(l)}
              onConcepts={() => setConcept({ open: true })}
              onSkip={() => (unlock(7), goLevel(5))}
            />
            {!engMode && stash && (
              <button type="button" onClick={backToWorkspace} className="w-full rounded-xl border border-pv-violet/60 bg-pv-violet/[0.08] px-3 py-2 text-left text-[13px] text-pv-text">
                <b>Your investigation is waiting.</b> You left the engineering workspace ({STATION[stash.level as 5 | 6 | 7]?.name ?? "workspace"}) to review this. Back to it, exactly as you left it →
              </button>
            )}
            {gate && <ReadyGate onEnter={() => goLevel(5)} onReview={(l) => goLevel(l)} />}
            {!engMode && !gate && step && (
              <Walkthrough
                level={level}
                steps={steps}
                idx={idx}
                setIdx={goStep}
                ran={ran}
                onRun={runStep}
                onFinish={finishLevel}
                finishLabel={level === 4 ? "I've finished learning →" : `Level ${level + 1}: ${LEVELS[level].title} →`}
                lab={lab}
                ctx={{ openFollow: () => undefined }}
              />
            )}

            {engMode && level === 5 && step && (
              <>
                {mission && <MissionBar station={STATION[5].name} task={mission.task} look={mission.look} next={mission.next} />}
                <Walkthrough
                  level={5}
                  label="Follow the traffic"
                  steps={steps}
                  idx={idx}
                  setIdx={goStep}
                  ran={ran}
                  onRun={runStep}
                  onFinish={finishLevel}
                  finishLabel="Next station: Troubleshoot →"
                  lab={lab}
                  ctx={{ openFollow: () => openTool({ tab: "follow", journey: undefined }) }}
                />
              </>
            )}

            {engMode && level === 6 && (
              <>
                {mission && <MissionBar station={STATION[6].name} task={mission.task} look={mission.look} next={mission.next} />}
                <div role="tablist" className="flex gap-1">
                  {(
                    [
                      ["tickets", "Tickets"],
                      ["explore", "Free sandbox"],
                    ] as const
                  ).map(([m, label]) => (
                    <button
                      key={m}
                      type="button"
                      role="tab"
                      aria-selected={eng === m}
                      onClick={() => (setEng(m), setLastChange(undefined), act({ type: "healthy" }))}
                      className={clsx("rounded-lg border px-3 py-1 text-[12.5px] font-semibold", eng === m ? "border-pv-violet bg-pv-violet/15 text-pv-text" : "border-pv-border text-pv-text-muted hover:text-pv-text")}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <ModeBar mode={eng} lab={lab} act={doAct} configure={configure} onMigrate={() => (act({ type: "migrate" }), setLastChange("migrate"))} />
                {eng === "explore" && lastChange && <ChangeCard change={lastChange} />}
                {(lab.lastPackets.length > 0 || lab.lastResult) && <WhyResult lab={lab} onFollow={() => openTool({ tab: "follow", journey: undefined })} />}
                <LaptopPanel lab={lab} act={doAct} name={name} setName={setName} />
                <button type="button" onClick={() => (unlock(7), goLevel(7))} className="w-full rounded-xl border border-pv-success/50 bg-pv-success/[0.06] px-3 py-2 text-left text-[13px] text-pv-text hover:bg-pv-success/[0.1]">
                  <b>Next station: Build it.</b> Configure the DHCP server, R1&apos;s relay and the DNS zone from nothing, then prove the service works →
                </button>
              </>
            )}

            {engMode && level === 7 && (
              <BuildMode
                lab={lab}
                act={act}
                onBatch={(from) => {
                  batchPending.current = true;
                  setBatch({ from });
                  // On a phone the test bench is far below the topology: bring the topology into view to watch the test.
                  const el = document.querySelector("[data-lab-topo]");
                  const r = el?.getBoundingClientRect();
                  if (el && r && (r.bottom < 60 || r.top > window.innerHeight - 60)) el.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
                }}
                snap={build}
                setSnap={setBuild}
                onFollow={() => openTool({ tab: "follow", journey: undefined })}
                onDevice={(n) => (setPointed(n), setMobileTab("topology"))}
              />
            )}
            {engMode && level === 7 && (
              <DeviceDesk
                windows={wins}
                setWindows={setWins}
                focus={winFocus}
                setFocus={setWinFocus}
                ctx={{
                  lab,
                  api: makeBuildApi({ lab, snap: build, setSnap: setBuild, act, cisco: ciscoMode, setCisco: setCiscoMode, junosMode, setJunosMode, question: cliQuestion, setQuestion: setCliQuestion }),
                  coach,
                  vendor,
                  setVendor,
                  consoles,
                  setConsoles,
                  notes,
                  setNotes,
                }}
              />
            )}
            <ConceptsDrawer open={concept.open} focus={concept.focus} onClose={() => setConcept({ open: false })} onFocus={(f) => setConcept({ open: true, focus: f })} onLearn={(l) => toLearn(l)} />
          </div>
        }
        liveState={
          engMode ? (
            <Workbench
              lab={lab}
              sel={sel}
              setSel={setSel}
              coach={coach}
              setCoach={setCoach}
              station={STATION[level as 5 | 6 | 7].id}
              onConcept={(id) => setConcept({ open: true, focus: id })}
              vendor={vendor}
              setVendor={setVendor}
              sessions={cliSessions}
              setSessions={setCliSessions}
            />
          ) : undefined
        }
        liveStateLabel=""
        tabLabels={{ topology: engMode ? "Task" : "Topology", state: "Tools" }}
        mobileTab={mobileTab}
        onMobileTabChange={setMobileTab}
      />
    </IfNameContext.Provider>
  );
}

/** Where the student is on the two-stage journey, and how to move. */
function JourneyHeader({
  level,
  unlocked,
  eng,
  gate,
  onLearn,
  onEnter,
  onStation,
  onConcepts,
  onSkip,
}: {
  level: Level;
  unlocked: Level;
  eng: boolean;
  gate: boolean;
  onLearn: (l: Level) => void;
  onEnter: () => void;
  onStation: (l: Level) => void;
  onConcepts: () => void;
  onSkip: () => void;
}) {
  if (eng)
    return (
      <nav aria-label="Engineering workspace" className="space-y-1.5 rounded-2xl border border-pv-violet/40 bg-pv-violet/[0.04] p-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[12px] font-bold uppercase tracking-[0.12em] text-pv-violet">② Engineering workspace</p>
          <div className="flex gap-1.5">
            <button type="button" onClick={onConcepts} className="rounded-full border border-pv-cyan/60 px-2.5 py-0.5 text-[12px] font-semibold text-pv-cyan-soft">
              Concepts
            </button>
            <button type="button" onClick={() => onLearn(4)} className="rounded-full border border-pv-border px-2.5 py-0.5 text-[12px] text-pv-text-muted hover:text-pv-text">
              ← ① Learn
            </button>
          </div>
        </div>
        <ol className="grid grid-cols-3 gap-1">
          {([5, 6, 7] as Level[]).map((l) => {
            const locked = l > unlocked;
            return (
              <li key={l}>
                <button
                  type="button"
                  disabled={locked}
                  aria-current={l === level ? "step" : undefined}
                  onClick={() => onStation(l)}
                  className={clsx(
                    "w-full rounded-lg border px-2 py-1 text-left",
                    l === level ? "border-pv-violet bg-pv-violet/15 text-pv-text" : locked ? "border-pv-border/50 text-pv-text-faint opacity-60" : "border-pv-border text-pv-text-muted hover:text-pv-text",
                  )}
                >
                  <span className="block text-[10px] font-bold">
                    {locked ? "🔒" : l < unlocked || l < level ? "✓" : ""} {l - 4}
                  </span>
                  <span className="block text-[12px] font-semibold leading-tight">{LEVELS[l - 1].title}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>
    );
  return (
    <nav aria-label="Learning path" className="space-y-1.5">
      <div className="flex flex-wrap items-stretch gap-2">
        <div className="min-w-0 flex-1 rounded-2xl border border-pv-cyan/40 bg-pv-cyan/[0.04] p-2">
          <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.12em] text-pv-cyan-soft">① Learn the service</p>
          <ol className="grid grid-cols-4 gap-1">
            {([1, 2, 3, 4] as Level[]).map((l) => {
              const locked = l > unlocked;
              const done = l < unlocked || gate;
              return (
                <li key={l}>
                  <button
                    type="button"
                    disabled={locked}
                    aria-current={l === level && !gate ? "step" : undefined}
                    onClick={() => onLearn(l)}
                    className={clsx(
                      "w-full rounded-lg border px-1.5 py-1 text-left",
                      l === level && !gate
                        ? "border-pv-cyan bg-pv-cyan/12 text-pv-text"
                        : locked
                          ? "border-pv-border/50 text-pv-text-faint opacity-60"
                          : done
                            ? "border-pv-success/40 text-pv-text-muted hover:text-pv-text"
                            : "border-pv-border text-pv-text-muted hover:text-pv-text",
                    )}
                  >
                    <span className="block text-[10px] font-bold">
                      {locked ? "🔒" : done ? "✓" : ""} {l}
                    </span>
                    <span className="block text-[11.5px] font-semibold leading-tight">{LEVELS[l - 1].short}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
        <button
          type="button"
          disabled={unlocked < 5}
          onClick={onEnter}
          className={clsx("rounded-2xl border px-3 py-2 text-left sm:w-48", unlocked >= 5 ? "border-pv-violet/60 bg-pv-violet/[0.08] text-pv-text hover:bg-pv-violet/15" : "border-pv-border/60 text-pv-text-faint")}
        >
          <span className="block text-[11px] font-bold uppercase tracking-[0.12em] text-pv-violet">② Engineering workspace</span>
          <span className="block text-[12px]">{unlocked >= 5 ? "Follow · Troubleshoot · Build →" : "🔒 opens when you finish learning"}</span>
        </button>
      </div>
      {!gate && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-[11.5px]">
          <span className="text-pv-text-muted">
            Goal of this level: <b className="text-pv-text">{LEVELS[level - 1].skill}</b>
          </span>
          {unlocked < 7 && (
            <button type="button" onClick={onSkip} className="text-pv-text-faint underline-offset-2 hover:text-pv-text hover:underline">
              Already know DHCP and DNS? Go straight to the engineering workspace
            </button>
          )}
        </div>
      )}
    </nav>
  );
}

/** The end of learning, and the deliberate step into the engineering workspace. */
function ReadyGate({ onEnter, onReview }: { onEnter: () => void; onReview: (l: Level) => void }) {
  return (
    <section aria-label="Ready" className="pv-pop space-y-3 rounded-2xl border border-pv-success/50 bg-pv-success/[0.05] p-4">
      <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-pv-success">① Learn the service · complete</p>
      <h3 className="text-[20px] font-bold leading-tight text-pv-text">You&apos;ve learned how DHCP and DNS work.</h3>
      <ul className="space-y-0.5 text-[14px] text-pv-text">
        {LEVELS.slice(0, 4).map((l) => (
          <li key={l.n}>✓ {l.skill}</li>
        ))}
      </ul>
      <div className="rounded-xl border border-pv-violet/50 bg-pv-violet/[0.06] p-3">
        <p className="text-[14.5px] font-semibold text-pv-text">Next: the engineering workspace</p>
        <p className="mt-0.5 text-[13px] text-pv-text-muted">
          You stop being shown what happens, and start finding out yourself: follow traffic, troubleshoot real problems, then configure the service and prove it works. It looks different on purpose:
        </p>
        <ul className="mt-1.5 space-y-1 text-[13px] text-pv-text">
          <li>
            <b>Your task</b> is always in one place, with a bar that says what to do, what to look at, and what&apos;s next.
          </li>
          <li>
            <b>Your tools</b> (Follow, Device, CLI, Timeline) open one at a time, next to the task.
          </li>
          <li>
            <b>Concepts</b> brings back anything you&apos;ve learned (giaddr, ports 67/68…) without leaving your investigation.
          </li>
        </ul>
        <p className="mt-1.5 text-[12.5px] text-pv-text-muted">Three stations, in order: 1 Follow the traffic → 2 Troubleshoot → 3 Build it.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={onEnter} className="rounded-full bg-pv-violet px-5 py-2 text-[14px] font-bold text-white hover:brightness-110">
          Enter the engineering workspace →
        </button>
        <button type="button" onClick={() => onReview(4)} className="text-[12.5px] text-pv-text-faint underline-offset-2 hover:text-pv-text hover:underline">
          Not yet: review the evidence level
        </button>
      </div>
    </section>
  );
}

/** The laptop, driven by the student acting as the user (Troubleshoot). */
function LaptopPanel({ lab, act, name, setName }: { lab: DlState; act: (a: DlAction) => void; name: string; setName: (n: string) => void }) {
  const c = lab.client;
  return (
    <details open className="rounded-2xl border border-pv-border bg-pv-bg-elevated/30 p-3">
      <summary className="cursor-pointer text-[14px] font-semibold text-pv-text">The laptop: act as the user</summary>
      <div className="mt-2 space-y-2">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <IdentityCard lab={lab} />
          <div className="space-y-2">
            <div className="flex flex-wrap gap-1.5">
              {!configured(c) ? (
                <>
                  <button type="button" onClick={() => act({ type: "dhcp-next" })} className="rounded-full bg-pv-cyan px-3 py-1 text-[12.5px] font-bold text-[#03131a]">
                    ▶ {dhcpNextLabel(c)}
                  </button>
                  <button type="button" onClick={() => act({ type: "dhcp-all" })} className="rounded-full border border-pv-border px-3 py-1 text-[12px] text-pv-text-muted hover:text-pv-text">
                    whole exchange
                  </button>
                </>
              ) : (
                <>
                  <button type="button" onClick={() => act({ type: "renew" })} className="rounded-full border border-pv-cyan/60 bg-pv-cyan/10 px-3 py-1 text-[12.5px] font-semibold text-pv-cyan-soft" title="Like ipconfig /renew">
                    Renew
                  </button>
                  <button type="button" onClick={() => act({ type: "release" })} className="rounded-full border border-pv-border px-3 py-1 text-[12px] text-pv-text-muted hover:text-pv-text">
                    Release
                  </button>
                </>
              )}
            </div>
            <LeaseBar lab={lab} act={act} locked={false} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && act({ type: "resolve", name })}
            aria-label="Name to resolve"
            className="h-8 w-52 rounded-lg border border-pv-border bg-pv-bg px-2 pv-mono text-[12.5px] text-pv-text"
          />
          <button type="button" onClick={() => act({ type: "resolve", name })} className="rounded-full bg-pv-cyan px-3 py-1 text-[12.5px] font-bold text-[#03131a]">
            Resolve
          </button>
          {NAMES.map((n) => (
            <button key={n} type="button" onClick={() => setName(n)} className="rounded-full border border-pv-border px-2 py-0.5 pv-mono text-[11px] text-pv-text-muted hover:text-pv-text">
              {n}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[12px] text-pv-text-muted">ping</span>
          {[DH_ADDR["R1:CLIENT"], DH_ADDR.WEB, DL_WEB_NEW, DH_ADDR["DNS-SRV"], DH_ADDR["DHCP-SRV"]].map((ip) => (
            <button key={ip} type="button" onClick={() => act({ type: "ping", dst: ip })} className="rounded-full border border-pv-border px-2 py-0.5 pv-mono text-[11px] text-pv-text-muted hover:text-pv-text">
              {ip}
              {ip === DH_ADDR["R1:CLIENT"] ? " (gateway)" : ip === DH_ADDR["DNS-SRV"] ? " (DNS)" : ip === DH_ADDR["DHCP-SRV"] ? " (DHCP)" : ""}
            </button>
          ))}
          <button type="button" onClick={() => act({ type: "flush" })} className="ml-auto text-[12px] text-pv-text-faint underline-offset-2 hover:text-pv-text hover:underline">
            flush DNS cache
          </button>
        </div>
        {lab.lastResult && (
          <p key={lab.seq} className={clsx("pv-pop rounded-xl border px-3 py-1.5 pv-mono text-[12.5px]", lab.lastResult.ok ? "border-pv-success/50 bg-pv-success/10 text-pv-success" : "border-pv-danger/50 bg-pv-danger/10 text-pv-danger")}>
            {/* A summary of what happened, not a terminal: the real Windows output is in the laptop's Command Prompt. */}
            {lab.lastResult.kind === "resolve" ? "Name lookup → " : "Ping → "}
            {lab.lastResult.text}
          </p>
        )}
      </div>
    </details>
  );
}

function IdentityCard({ lab }: { lab: DlState }) {
  const c = lab.client;
  const row = (k: string, v: string | undefined, bad?: boolean) => (
    <div className="flex justify-between gap-2 border-b border-pv-border/60 py-1 last:border-0">
      <span className="text-[12px] text-pv-text-muted">{k}</span>
      <span key={v} className={clsx("pv-pop pv-mono text-[13px] font-bold", !v ? "text-pv-text-faint" : bad ? "text-pv-danger" : "text-pv-text")}>
        {v ?? "—"}
      </span>
    </div>
  );
  const apipa = c.phase === "APIPA";
  return (
    <div className={clsx("rounded-xl border-2 p-2.5", configured(c) ? "border-pv-success/60" : apipa ? "border-pv-danger/60" : "border-pv-border")}>
      <p className="text-[11px] font-bold uppercase tracking-wide text-pv-text-faint">CLIENT network identity</p>
      {row("IP address", c.ip, apipa)}
      {row("Mask", c.mask)}
      {row("Default gateway (opt 3)", c.gw)}
      {row("DNS server (opt 6)", c.dns)}
      {row("Lease left", configured(c) ? `${fmtT(leaseLeft(lab))} of ${fmtT(LEASE_SECONDS)}` : undefined)}
      {apipa && <p className="mt-1 text-[12px] text-pv-danger">Self-assigned link-local address: no DHCP server answered. No gateway, no DNS.</p>}
    </div>
  );
}

function LeaseBar({ lab, act, locked }: { lab: DlState; act: (a: DlAction) => void; locked: boolean }) {
  const c = lab.client;
  const start = c.leaseStart ?? lab.clock;
  const pos = configured(c) ? Math.min(1, (lab.clock - start) / LEASE_SECONDS) : 0;
  return (
    <div className="space-y-1.5 rounded-xl border border-pv-border p-2">
      <p className="text-[11px] font-bold uppercase tracking-wide text-pv-text-faint">Lease timeline · clock {fmtT(lab.clock)}</p>
      <div className="relative h-3 rounded-full bg-pv-border">
        <div className="absolute inset-y-0 left-0 rounded-full bg-pv-success/60 transition-[width] duration-500" style={{ width: `${pos * 100}%` }} />
        {[0.5, 0.875].map((p) => (
          <span key={p} className="absolute -top-0.5 h-4 w-0.5 bg-white" style={{ left: `${p * 100}%` }} />
        ))}
      </div>
      <div className="flex justify-between text-[10.5px] text-pv-text-faint">
        <span>lease start</span>
        <span>T1 50%</span>
        <span>T2 87.5%</span>
        <span>expiry</span>
      </div>
      {!locked && (
        <div className="flex flex-wrap gap-1.5">
          <TimeBtn onClick={() => act({ type: "time", to: lab.clock + 300 })}>+5 min</TimeBtn>
          <TimeBtn onClick={() => act({ type: "time", to: lab.clock + 3600 })}>+1 h</TimeBtn>
          {configured(c) && (
            <>
              <TimeBtn onClick={() => act({ type: "time", to: start + DL_T1 })}>to T1</TimeBtn>
              <TimeBtn onClick={() => act({ type: "time", to: start + DL_T2 })}>to T2</TimeBtn>
              <TimeBtn onClick={() => act({ type: "time", to: start + LEASE_SECONDS })}>to expiry</TimeBtn>
            </>
          )}
        </div>
      )}
    </div>
  );
}
function TimeBtn({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="rounded-full border border-pv-border px-2.5 py-0.5 text-[11.5px] text-pv-text-muted hover:text-pv-text">
      {children}
    </button>
  );
}

/**
 * Interface names at each end of each cable, from the model's own interfaces (DL_IFACES), so the topology, the CLI,
 * the captures and the device windows all name the same port. R1 and the switches follow the IOS/Junos view the
 * student picked; hosts keep their OS's name (the laptop's "Ethernet", the servers' eth0).
 */
function ifaceTags(vendor: CliVendor) {
  const tags: { key: string; text: string; x: number; y: number; dx: number; dy: number; title: string }[] = [];
  for (const n of ["CLIENT", "SW1", "R1", "SW2", "DHCP-SRV", "DNS-SRV"] as DlNode[]) {
    for (const i of DL_NODE_IFACES[n]) {
      const info = DL_IFACES[i];
      const peer = DL_IFACES[info.peer].node;
      const [x1, y1] = at(n);
      const [x2, y2] = at(peer);
      // A little way along the cable from this device; the two ends of a cable sit on opposite sides of the line
      // (the normal flips with the direction), so they never overlap each other or a moving packet.
      const len = Math.hypot(x2 - x1, y2 - y1) || 1;
      const [nx, ny] = [(y2 - y1) / len, -(x2 - x1) / len];
      const text = ifNamer(vendor)(i);
      tags.push({ key: i, text, x: x1 + (x2 - x1) * 0.3, y: y1 + (y2 - y1) * 0.3, dx: nx * 16, dy: ny * 11, title: `${n} ${text} → ${peer === "WEB" ? "internet" : peer}` });
    }
  }
  return tags;
}

/** On a phone the map is too small for port names on the cables: the same names, as a list of cables. */
function CableList({ vendor }: { vendor: CliVendor }) {
  const nm = ifNamer(vendor);
  const seen = new Set<string>();
  const rows: [string, string, string, string][] = [];
  for (const n of ["CLIENT", "SW1", "R1", "SW2"] as DlNode[])
    for (const i of DL_NODE_IFACES[n]) {
      const peer = DL_IFACES[i].peer;
      const key = [i, peer].sort().join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      const pn = DL_IFACES[peer].node;
      rows.push([n, nm(i), pn === "WEB" ? "" : nm(peer), pn === "WEB" ? "internet" : pn]);
    }
  return (
    <ul aria-label="Cables and their ports" className="mx-auto mt-1 grid max-w-md grid-cols-1 gap-x-3 gap-y-0.5 px-1 pv-mono text-[10.5px] text-pv-text-faint sm:hidden">
      {rows.map(([a, ai, bi, b]) => (
        <li key={`${a}${ai}`} className="flex items-center gap-1">
          <span className="font-sans font-semibold text-pv-text-muted">{a}</span> {ai} <span aria-hidden>↔</span> {bi} <span className="font-sans font-semibold text-pv-text-muted">{b}</span>
        </li>
      ))}
    </ul>
  );
}

function LabTopo({
  lab,
  pkts,
  focus,
  sel,
  card,
  activity,
  hideFaults,
  onNode,
  compact,
  hint,
  pointed,
  exchange,
  ifaceVendor,
}: {
  lab: DlState;
  pkts: DlPacket[];
  focus?: string[];
  sel: InvestigateSel;
  card?: DlNode;
  activity: boolean;
  hideFaults: boolean;
  onNode: (n: string) => void;
  compact?: boolean;
  hint: string;
  pointed?: DlNode;
  exchange?: { key: string; onReplay: () => void };
  ifaceVendor?: CliVendor;
}) {
  const views: Record<string, TopoView> = {};
  for (const f of focus ?? []) views[f] = { ring: "on" };
  // A followed message: light up the devices it reached, mark where it ended.
  const followed = sel.tab === "follow" && sel.journey ? journeys(lab).find((j) => j.id === sel.journey) : undefined;
  if (followed) {
    for (const p of followed.packets) for (const h of p.hops) if (h.act !== "ignore") views[h.node] = { ring: "hit" };
    const end = journeyEnd(followed.packets)!;
    views[end.node] = { ring: ACT_TONE[end.act] === "bad" ? "bad" : "target" };
  }
  // What each device just did, so the student can see where the last event mattered (tap a device for the detail).
  if (activity)
    for (const n of ["SW1", "R1", "SW2", "DHCP-SRV", "DNS-SRV"] as DlNode[]) {
      const b = activityBadge(lab, n);
      if (b) views[n] = { ...views[n], badge: b };
    }
  const c = lab.client;
  views.CLIENT = { ...views.CLIENT, badge: { text: c.phase, tone: configured(c) ? "yes" : c.phase === "APIPA" ? "bad" : "info" } };
  if (!hideFaults && !lab.config.relay) views.R1 = { ...views.R1, badge: { text: "no relay", tone: "bad" } };
  if (!hideFaults && !lab.config.serverUp) views["DHCP-SRV"] = { ...views["DHCP-SRV"], badge: { text: "dhcpd stopped", tone: "bad" } };
  if (!hideFaults && !lab.config.dnsUp) views["DNS-SRV"] = { ...views["DNS-SRV"], badge: { text: "named stopped", tone: "bad" } };
  // A hint or a failed test points at a device; the student still opens it themselves.
  if (pointed) views[pointed] = { ...views[pointed], ring: "target", bubble: { text: "look here: click to open", tone: "info" } };
  const nodes = NODES.map((n) => (n.id === "CLIENT" ? { ...n, sub: c.ip ?? "no IP" } : n));
  const links = [
    { a: "CLIENT", b: "SW1" },
    { a: "SW1", b: "R1" },
    { a: "R1", b: "SW2" },
    { a: "SW2", b: "DHCP-SRV" },
    { a: "SW2", b: "DNS-SRV" },
    { a: "R1", b: "WEB", state: "dim" as const },
  ];
  const segs: { from: string; to: string; color: string; label: string; last: boolean; no: number }[] = [];
  // Build replays a whole test, hop by hop (ARP, the address lookups around it, stays in the captures, not on the map).
  const shown = exchange ? pkts.filter((p) => p.proto !== "ARP").slice(-30) : pkts.slice(-10);
  shown.forEach((p, pi) => {
    p.path.slice(0, -1).forEach((n, i) => segs.push({ from: n, to: p.path[i + 1], color: p.lost && i === p.path.length - 2 ? "red" : p.color, label: tokenLabel(p), last: pi === shown.length - 1 && i === p.path.length - 2, no: p.no }));
  });
  // About a third of a second per hop: slow enough to follow each message, quicker when a long test sent a lot.
  const dur = exchange ? (segs.length > 24 ? 280 : 380) : 420;
  const lastLost = !followed && pkts.length ? [...pkts].reverse().find((p) => p.lost) : undefined;
  if (lastLost) {
    const n = lastLost.hops[lastLost.hops.length - 1].node;
    views[n] = { ...views[n], ring: "bad", bubble: { text: exchange ? `✕ ${tokenLabel(lastLost)} stops here` : "✕ stops here", tone: "bad", delay: segs.length * dur } };
  }
  const ex = exchange ? dhcpExchange(shown) : undefined;
  const startOf = (no?: number) =>
    no === undefined
      ? segs.length * dur
      : Math.max(
          0,
          segs.findIndex((g) => g.no === no),
        ) * dur;
  return (
    <div className="mx-auto w-full max-w-4xl" data-lab-topo>
      <style>{DECK_CSS}</style>
      <Topo nodes={nodes} links={links} views={views} ratio={compact ? 24 : 30} minH={compact ? 170 : 200} onNodeClick={onNode} selected={card}>
        {ifaceVendor &&
          ifaceTags(ifaceVendor).map((t) => (
            <span
              key={t.key}
              title={t.title}
              aria-hidden
              data-iface-tag={t.key}
              className="pointer-events-none absolute z-10 hidden -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded bg-pv-bg/85 px-0.5 pv-mono text-[10px] leading-tight text-pv-text-faint sm:block"
              style={{ left: `calc(${t.x}% + ${t.dx.toFixed(1)}px)`, top: `calc(${t.y}% + ${t.dy.toFixed(1)}px)` }}
            >
              {t.text}
            </span>
          ))}
        {segs.map((g, i) => (
          <Mover key={`${lab.seq}-${exchange?.key ?? ""}-${i}`} from={at(g.from)} to={g.last ? short(at(g.from), at(g.to)) : at(g.to)} delay={i * dur} duration={dur} stay={g.last}>
            <Token color={g.color}>{g.label}</Token>
          </Mover>
        ))}
      </Topo>
      {ifaceVendor && <CableList vendor={ifaceVendor} />}
      {ex && (
        <div key={`${lab.seq}-${exchange!.key}`} className="mx-auto mt-1.5 max-w-3xl rounded-xl border border-pv-border bg-pv-bg/70 px-2.5 py-1.5" aria-label="DHCP exchange on the topology">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-[10.5px] font-bold uppercase tracking-wide text-pv-text-faint">{ex.renewal ? "DHCP renewal" : "DHCP exchange"}</span>
            <ol className="flex flex-wrap items-center gap-1">
              {ex.legs.map((l, i) => (
                <li key={l.msg} className="pv-pop flex items-center gap-1" style={{ animationDelay: `${startOf(l.firstNo)}ms` }}>
                  <span
                    title={l.text}
                    className={clsx(
                      "rounded-full border px-2 py-0.5 text-[11px] font-semibold",
                      l.state === "ok" ? "border-pv-success/60 bg-pv-success/15 text-pv-success" : l.state === "bad" ? "border-pv-danger/60 bg-pv-danger/15 text-pv-danger" : "border-pv-border text-pv-text-faint",
                    )}
                  >
                    {l.state === "ok" ? "✓" : l.state === "bad" ? "✕" : "–"} {l.msg}
                  </span>
                  {i < ex.legs.length - 1 && (
                    <span className="text-[10px] text-pv-text-faint" aria-hidden>
                      →
                    </span>
                  )}
                </li>
              ))}
            </ol>
            <button type="button" onClick={exchange!.onReplay} className="ml-auto rounded-full border border-pv-border px-2 py-0.5 text-[11px] text-pv-text-muted hover:text-pv-text">
              ▶ Replay
            </button>
          </div>
          {(() => {
            const stop = ex.legs.find((l) => l.state === "bad");
            return (
              <p className="pv-pop mt-0.5 text-[12px] text-pv-text-muted" style={{ animationDelay: `${segs.length * dur}ms` }}>
                {stop ? (
                  <>
                    <b className="text-pv-danger">{stop.msg}:</b> {stop.text}.{" "}
                    {stop.at && stop.at !== "WEB" && (
                      <button type="button" onClick={() => onNode(stop.at!)} className="font-semibold text-pv-cyan-soft hover:underline">
                        Open {stop.at} →
                      </button>
                    )}
                  </>
                ) : (
                  <>
                    {ex.legs
                      .filter((l) => l.state === "ok")
                      .map((l) => `${l.msg} ${l.text}`)
                      .join(" · ")}
                    .
                  </>
                )}
              </p>
            );
          })()}
        </div>
      )}
      {hint && <p className="mt-1 text-center text-[11px] text-pv-text-faint">{hint}</p>}
    </div>
  );
}

function tokenLabel(p: DlPacket) {
  if (p.proto === "DHCP") return p.msg;
  if (p.proto === "DNS") return p.msg === "DNS response" ? (p.info.includes("No such") ? "NXDOMAIN" : "DNS answer") : "DNS query";
  if (p.proto === "ARP") return p.msg === "ARP reply" ? "ARP reply" : "ARP?";
  return p.msg === "Port unreachable" ? "ICMP 3/3" : p.msg === "Echo reply" ? "pong" : "ping";
}

function ChangeCard({ change }: { change: Change }) {
  const e = change === "migrate" ? DL_MIGRATE_EXPLAIN : DL_CONFIG_EXPLAIN(change.k, change.v);
  return (
    <div className="pv-pop rounded-xl border border-pv-warning/45 bg-pv-warning/[0.06] p-3">
      <p className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-pv-warning">What you just changed</p>
      <p className="text-[14px] font-semibold text-pv-text">
        {e.title} <span className="font-normal text-pv-text-muted">· where: {e.where}</span>
      </p>
      <p className="text-[13px] text-pv-text-muted">{e.meaning}</p>
      <p className="mt-1 text-[13px] text-pv-text">
        <b>What to expect:</b> {e.expect}
      </p>
    </div>
  );
}
function WhyResult({ lab, onFollow }: { lab: DlState; onFollow: () => void }) {
  const n = dlNarrate(lab);
  return (
    <div key={lab.seq} className={clsx("pv-pop rounded-xl border p-3", n.ok ? "border-pv-success/50 bg-pv-success/[0.07]" : "border-pv-danger/45 bg-pv-danger/[0.06]")}>
      <p className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-pv-text-faint">What just happened, and why</p>
      <div className="mt-0.5 text-[13.5px]">{n.happened}</div>
      <p className="mt-1 text-[13px] text-pv-text-muted">{n.why}</p>
      {lab.lastPackets.length > 0 && (
        <button type="button" onClick={onFollow} className="mt-1 text-[12px] font-semibold text-pv-cyan-soft hover:underline">
          Prove it: follow these messages in Investigate →
        </button>
      )}
    </div>
  );
}

/** What has to be true, observed from the network, before a ticket counts as fixed. */
function ticketProof(lab: DlState): { text: string; ok: boolean }[] {
  const t = lab.ticket;
  if (!t) return [];
  const c = lab.client;
  const lr = lab.lastResult;
  const resolved = lr?.kind === "resolve" && lr.ok;
  const reached = (node: DlNode, msg: string) => lab.capture.some((p) => p.msg === msg && p.hops.some((h) => h.node === node && h.act === "deliver"));
  switch (t.id as DlTicketId) {
    case "no-relay":
      return [
        { text: "R1 relays again: a DISCOVER left R1 ge-0/0/1", ok: lab.capture.some((p) => p.msg === "DISCOVER" && p.obs.some((o) => o.iface === "R1:ge-0/0/1")) },
        { text: "CLIENT is BOUND with a real address (not 169.254)", ok: c.phase === "BOUND" },
        { text: "A name resolves from the client", ok: !!resolved },
      ];
    case "pool":
      return [
        { text: "DHCP-SRV has free addresses again", ok: lab.config.poolFree > 0 },
        { text: "DHCP-SRV answered with an OFFER and an ACK", ok: reached("CLIENT", "ACK") },
        { text: "CLIENT is BOUND", ok: c.phase === "BOUND" },
      ];
    case "dns-option":
      return [
        { text: `CLIENT now uses DNS ${DL_ADDR.DNS} (it renewed after the fix)`, ok: c.dns === DL_ADDR.DNS },
        { text: "A DNS query reached DNS-SRV and was answered", ok: reached("DNS-SRV", "DNS query") && reached("CLIENT", "DNS response") },
        { text: "The name resolves from the client", ok: !!resolved },
      ];
    case "gateway":
      return [
        { text: `CLIENT's gateway is ${DL_ADDR.RC} (it renewed after the fix)`, ok: c.gw === DL_ADDR.RC },
        { text: "CLIENT has an ARP entry for its gateway", ok: !!lab.net.arp.CLIENT[DL_ADDR.RC] && lab.net.arp.CLIENT[DL_ADDR.RC] !== "incomplete" },
        { text: "Traffic beyond the LAN works (a ping or a lookup succeeds)", ok: lr?.ok === true },
      ];
    case "dns-service":
      return [
        { text: "named is running on DNS-SRV", ok: lab.config.dnsUp },
        { text: "A DNS query reached DNS-SRV and was answered", ok: reached("DNS-SRV", "DNS query") && reached("CLIENT", "DNS response") },
        { text: "The name resolves from the client", ok: !!resolved },
      ];
    case "stale-cache":
      return [
        { text: "The client's cache no longer holds the old answer", ok: !lab.cache.some((e) => e.ip === DH_ADDR.WEB && e.expires > lab.clock) },
        { text: "A fresh query went to DNS-SRV and was answered", ok: reached("DNS-SRV", "DNS query") },
        { text: `The name resolves to ${DL_WEB_NEW}`, ok: !!resolved && !!lr?.text.includes(DL_WEB_NEW) },
      ];
  }
}

function ModeBar({ mode, lab, act, configure, onMigrate }: { mode: Eng; lab: DlState; act: (a: DlAction) => void; configure: (p: Partial<DlConfig>) => void; onMigrate: () => void }) {
  const t = lab.ticket;
  const cfg = lab.config;
  const [where, setWhere] = useState<DlNode | undefined>(undefined);
  const [cause, setCause] = useState<DlCause | undefined>(undefined);
  const proof = ticketProof(lab);
  const [browse, setBrowse] = useState(false);
  // Once a ticket is being worked, the list folds away: the ticket is the task.
  const showList = !t || t.solved || browse;
  return (
    <section className="space-y-2.5 rounded-2xl border border-pv-violet/40 bg-pv-violet/[0.06] p-3.5">
      {mode === "explore" && (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-[13px] text-pv-text-muted">Change one thing on a server or the relay, make the laptop do something (get an address, renew, resolve, ping), then prove with the Follow tool where its traffic went.</p>
          <button type="button" onClick={() => act({ type: "healthy" })} className="ml-auto text-[12px] text-pv-text-faint underline-offset-2 hover:text-pv-text hover:underline">
            fresh client, healthy network
          </button>
        </div>
      )}
      {(mode === "explore" || (t && t.diagnosed && !t.solved)) && (
        <div className="space-y-1.5">
          <p className="text-[12.5px] text-pv-text-muted">{mode === "explore" ? "Server and relay configuration:" : "Apply your fix here:"}</p>
          <div className="flex flex-wrap gap-1.5">
            <Toggle on={cfg.relay} onClick={() => configure({ relay: !cfg.relay })}>
              R1 relay (ip helper) {cfg.relay ? "on" : "off"}
            </Toggle>
            <Toggle on={cfg.serverUp} onClick={() => configure({ serverUp: !cfg.serverUp })}>
              DHCP service {cfg.serverUp ? "running" : "stopped"}
            </Toggle>
            <Toggle on={cfg.poolFree > 0} onClick={() => configure({ poolFree: cfg.poolFree > 0 ? 0 : 20 })}>
              pool: {cfg.poolFree > 0 ? `${cfg.poolFree} free` : "exhausted"}
            </Toggle>
            <Toggle on={cfg.option3 === DL_ADDR.RC} onClick={() => configure({ option3: cfg.option3 === DL_ADDR.RC ? DL_WRONG.gw : DL_ADDR.RC })}>
              opt 3 gateway = {cfg.option3}
            </Toggle>
            <Toggle on={cfg.option6 === DL_ADDR.DNS} onClick={() => configure({ option6: cfg.option6 === DL_ADDR.DNS ? DL_WRONG.dns : DL_ADDR.DNS })}>
              opt 6 DNS = {cfg.option6}
            </Toggle>
            <Toggle on={cfg.dnsUp} onClick={() => configure({ dnsUp: !cfg.dnsUp })}>
              DNS service {cfg.dnsUp ? "running" : "stopped"}
            </Toggle>
            {mode === "explore" && (
              <button type="button" onClick={onMigrate} className="rounded-lg border border-pv-warning/50 px-2.5 py-1 text-[12px] font-semibold text-pv-warning">
                migrate {DNS_NAME} → {DL_WEB_NEW}
              </button>
            )}
          </div>
        </div>
      )}
      {mode === "tickets" && (
        <>
          {!t && <p className="text-[13px] text-pv-text-muted">A user reports a problem. Reproduce it, follow the failing traffic until the evidence stops, name the cause, fix it, and prove the service works.</p>}
          {t && !showList && (
            <button type="button" onClick={() => setBrowse(true)} className="text-[12px] text-pv-text-faint underline-offset-2 hover:text-pv-text hover:underline">
              Switch to another ticket
            </button>
          )}
          {showList && (
            <div className="grid gap-2 sm:grid-cols-2">
              {(Object.keys(DL_TICKETS) as DlTicketId[]).map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => (act({ type: "ticket", id }), setWhere(undefined), setCause(undefined), setBrowse(false))}
                  className={clsx("rounded-xl border p-2.5 text-left", t?.id === id ? "border-pv-violet bg-pv-violet/15" : "border-pv-border hover:border-pv-violet/50")}
                >
                  <p className="text-[13.5px] font-semibold text-pv-text">
                    {t?.id === id && t.solved ? "✓ " : ""}
                    {DL_TICKETS[id].title}
                  </p>
                  <p className="text-[11.5px] text-pv-text-muted">{t?.id === id ? "loaded" : "load this ticket"}</p>
                </button>
              ))}
            </div>
          )}
          {t && (
            <div className="space-y-2 rounded-xl border border-pv-border bg-pv-bg/60 p-3">
              <p className="text-[13.5px] text-pv-text">
                <b className="text-pv-danger">Ticket:</b> {DL_TICKETS[t.id].report}
              </p>
              <p className="text-[12px] text-pv-text-muted">
                {["Reproduce", "Locate and explain", "Fix", "Prove"].map((x, i) => {
                  const done = i === 0 ? lab.lastPackets.length > 0 || !!t.diagnosed : i === 1 ? !!t.diagnosed : i === 2 ? !!t.solved : !!t.solved;
                  return (
                    <span key={x} className={clsx("mr-2", done ? "text-pv-success" : "")}>
                      {done ? "✓" : `${i + 1}.`} {x}
                    </span>
                  );
                })}
              </p>
              {!t.diagnosed && (
                <div className="space-y-2">
                  <div>
                    <p className="text-[12px] font-semibold text-pv-text">Where does the user&apos;s traffic stop? (the last device you can prove it reached)</p>
                    <div className="mt-1 flex flex-wrap gap-1.5" role="group" aria-label="Where it stops">
                      {DL_LOCATIONS.map((l) => (
                        <button
                          key={l.id}
                          type="button"
                          aria-pressed={where === l.id}
                          onClick={() => setWhere(l.id)}
                          className={clsx("rounded-lg border px-2.5 py-1 text-left text-[12px]", where === l.id ? "border-pv-cyan bg-pv-cyan/15 text-pv-text" : "border-pv-border text-pv-text-muted hover:text-pv-text")}
                        >
                          {l.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="text-[12px] font-semibold text-pv-text">Why does it stop there?</p>
                    <div className="mt-1 flex flex-wrap gap-1.5" role="group" aria-label="Root cause">
                      {DL_CAUSES.map((cz) => (
                        <button
                          key={cz.id}
                          type="button"
                          aria-pressed={cause === cz.id}
                          onClick={() => setCause(cz.id)}
                          className={clsx("rounded-lg border px-2.5 py-1 text-left text-[12px]", cause === cz.id ? "border-pv-cyan bg-pv-cyan/15 text-pv-text" : "border-pv-border text-pv-text-muted hover:text-pv-text")}
                        >
                          {cz.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={!where || !cause}
                    onClick={() => where && cause && act({ type: "diagnose", cause, at: where })}
                    className="rounded-full bg-pv-violet/80 px-4 py-1.5 text-[12.5px] font-bold text-white disabled:opacity-40"
                  >
                    Check my diagnosis against the evidence
                  </button>
                  {t.wrongAt && <p className="text-[12.5px] text-pv-warning">The evidence doesn&apos;t stop at {t.wrongAt}. Follow the failing message again and find the last device that provably received it.</p>}
                  {!t.wrongAt && t.wrong && <p className="text-[12.5px] text-pv-warning">“{DL_CAUSES.find((x) => x.id === t.wrong)?.label}” doesn&apos;t explain what that device shows. Inspect it: its tables, its log, its CLI.</p>}
                </div>
              )}
              {t.diagnosed && (
                <div className="space-y-1">
                  {!t.solved && <p className="text-[12.5px] text-pv-success">✓ Diagnosis fits the evidence. Fix it, then prove it. Remember: an existing lease only changes when the client renews.</p>}
                  <p className="text-[12px] font-semibold text-pv-text">Proof that the service works:</p>
                  <ul className="space-y-0.5">
                    {proof.map((p) => (
                      <li key={p.text} className={clsx("text-[12.5px]", p.ok ? "text-pv-success" : "text-pv-text-muted")}>
                        {p.ok ? "✓" : "○"} {p.text}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {t.solved && <p className="pv-pop text-[14px] font-bold text-pv-success">✓ Resolved, and proven from the network.</p>}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function Toggle({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={clsx("rounded-lg border px-2.5 py-1 pv-mono text-[11.5px] font-semibold", on ? "border-pv-success/50 text-pv-success" : "border-pv-danger/60 bg-pv-danger/10 text-pv-danger")}>
      {children}
    </button>
  );
}
