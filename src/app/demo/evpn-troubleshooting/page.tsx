"use client";

import { useEffect, useRef, useState } from "react";
import { clsx } from "clsx";
import {
  HYPOTHESIS_OPTIONS,
  VTEP_LOOPBACK,
  type ArenaDeviceId,
  type Difficulty,
  type FaultId,
  type HypothesisCategory,
  type ScenarioMode,
} from "@/lib/sim-engine/arena/faultTypes";
import { rankForScore, type ScoreBreakdown } from "@/lib/sim-engine/arena/scoring";
import { FAULT_BANK } from "@/lib/sim-engine/arena/faultRegistry";
import { GraphTopologyViewer } from "@/components/network/GraphTopologyViewer";
import { EvpnRibViewer } from "@/components/protocol/EvpnRouteTable";
import { ElectionViewer } from "@/components/protocol/ElectionViewer";
import { NextHopSetViewer } from "@/components/protocol/NextHopSetViewer";
import { ServiceInstanceViewer } from "@/components/protocol/ServiceInstanceViewer";
import { TroubleshootingLayers, type DiagnosticLayer } from "@/components/protocol/TroubleshootingLayers";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { useProgressStore } from "@/lib/state/useProgressStore";
import { useArenaEngine } from "./useArenaEngine";
import {
  CLI_SUGGESTIONS_CISCO,
  CLI_SUGGESTIONS_JUNIPER,
  hostInfo,
  isLeaf,
  runCapture,
  runCliCommand,
  runTest,
  type TestId,
  type TestResult,
} from "./evidence";
import type { ArenaState } from "@/lib/sim-engine/arena/faultTypes";
import { esTabRowsFor, evpnRibRowsFor, interfacesFor, suppressionTabRowsFor, vpwsTabRowsFor, vrfTabRowsFor } from "./deviceTrace";

// ---------------------------------------------------------------------------
// Fixed fabric layout (brief §4)
// ---------------------------------------------------------------------------

const GRAPH_NODES = [
  { id: "SPINE1", label: "SPINE1", x: 50, y: 12, subLabel: "Underlay only", kind: "switch" as const },
  { id: "LEAF1", label: "LEAF1", x: 20, y: 45, subLabel: `VTEP ${VTEP_LOOPBACK.LEAF1}`, kind: "switch" as const },
  { id: "LEAF2", label: "LEAF2", x: 50, y: 45, subLabel: `VTEP ${VTEP_LOOPBACK.LEAF2}`, kind: "switch" as const },
  { id: "LEAF3", label: "LEAF3", x: 80, y: 45, subLabel: `VTEP ${VTEP_LOOPBACK.LEAF3}`, kind: "switch" as const },
  { id: "HOST-A", label: "HOST-A", x: 10, y: 80, kind: "server" as const },
  { id: "SERVER-A", label: "SERVER-A", x: 35, y: 80, subLabel: "Dual-Homed", kind: "server" as const },
  { id: "HOST-B", label: "HOST-B", x: 80, y: 80, kind: "server" as const },
];
const GRAPH_EDGES = [
  { id: "spine-leaf1", a: "SPINE1", b: "LEAF1" },
  { id: "spine-leaf2", a: "SPINE1", b: "LEAF2" },
  { id: "spine-leaf3", a: "SPINE1", b: "LEAF3" },
  { id: "leaf1-hosta", a: "LEAF1", b: "HOST-A" },
  { id: "leaf1-servera", a: "LEAF1", b: "SERVER-A", label: "ESI" },
  { id: "leaf2-servera", a: "LEAF2", b: "SERVER-A", label: "ESI" },
  { id: "leaf3-hostb", a: "LEAF3", b: "HOST-B" },
].map((e) => ({ ...e, state: "full" as const }));

const LEAF_OPTIONS: ArenaDeviceId[] = ["LEAF1", "LEAF2", "LEAF3"];
const DEVICE_OPTIONS: ArenaDeviceId[] = ["SPINE1", "LEAF1", "LEAF2", "LEAF3"];
const PING_TARGETS = ["HOST-A", "SERVER-A", "HOST-B", "10.10.20.5", "203.0.113.0/24", "ROAMER"];

const TEST_LABELS: Record<TestId, string> = {
  ping: "Ping",
  arp: "ARP / Neighbor Test",
  "mac-lookup": "MAC Lookup",
  "evpn-route": "EVPN Route Lookup",
  "vrf-route": "VRF Route Lookup",
  "vtep-reachability": "VTEP Reachability",
  "packet-trace": "Packet Trace",
  "interface-state": "Interface State",
  "bgp-neighbor": "BGP Neighbor",
  "vni-state": "VNI State",
  "ethernet-segment": "Ethernet Segment",
  "df-state": "DF State",
  "vpws-service": "VPWS Service",
};

interface StartedConfig {
  seed?: string;
  difficulty: Difficulty;
  mode: ScenarioMode;
  explicitFaultId?: FaultId;
  runId: string;
}

export default function EvpnTroubleshootingArena() {
  const [started, setStarted] = useState<StartedConfig | null>(null);

  if (!started) return <EntryScreen onStart={(c) => setStarted({ ...c, runId: crypto.randomUUID() })} />;
  return <IncidentView key={started.runId} config={started} onExit={() => setStarted(null)} />;
}

// ---------------------------------------------------------------------------
// Entry screen (brief §2)
// ---------------------------------------------------------------------------

function EntryScreen({ onStart }: { onStart: (c: { seed?: string; difficulty: Difficulty; mode: ScenarioMode; explicitFaultId?: FaultId }) => void }) {
  const [difficulty, setDifficulty] = useState<Difficulty>("associate");
  const [mode, setMode] = useState<ScenarioMode>("random");
  const [seedInput, setSeedInput] = useState("");
  const [selectedFault, setSelectedFault] = useState<FaultId | undefined>(undefined);
  const [showDashboard, setShowDashboard] = useState(false);
  const arenaResults = useProgressStore((s) => s.arenaResults);

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <Badge tone="cyan" className="mb-3">EVPN Troubleshooting Arena</Badge>
      <h1 className="mb-2 text-2xl font-semibold text-pv-text sm:text-3xl">Real Incidents. No Answer Key.</h1>
      <p className="mb-8 max-w-2xl text-sm text-pv-text-muted">Investigate → hypothesize → test → repair → verify. The fault is never named — you have to find it.</p>

      <GlassPanel strong className="mb-6 space-y-4 p-6">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-pv-cyan-soft">Difficulty</p>
          <div className="flex gap-2">
            {(["associate", "professional", "expert"] as Difficulty[]).map((d) => (
              <button key={d} type="button" onClick={() => setDifficulty(d)} className={clsx("rounded-full border px-4 py-2 text-sm font-semibold capitalize transition-colors", difficulty === d ? "border-pv-cyan/50 bg-pv-cyan/10 text-pv-cyan-soft" : "border-pv-border text-pv-text-faint hover:text-pv-text")}>
                {d}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-pv-cyan-soft">Scenario Mode</p>
          <div className="flex flex-wrap gap-2">
            {([{ id: "random", label: "Random" }, { id: "select", label: "Select Scenario" }, { id: "daily", label: "Daily Challenge" }] as { id: ScenarioMode; label: string }[]).map((m) => (
              <button key={m.id} type="button" onClick={() => setMode(m.id)} className={clsx("rounded-full border px-4 py-2 text-sm font-semibold transition-colors", mode === m.id ? "border-pv-violet/50 bg-pv-violet/10 text-pv-violet" : "border-pv-border text-pv-text-faint hover:text-pv-text")}>
                {m.label}
              </button>
            ))}
          </div>
        </div>

        {mode === "select" && (
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-pv-cyan-soft">Scenario</p>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {FAULT_BANK.map((f) => (
                <button key={f.id} type="button" onClick={() => setSelectedFault(f.id)} className={clsx("rounded-lg border px-3 py-2 text-left text-xs transition-colors", selectedFault === f.id ? "border-pv-cyan/50 bg-pv-cyan/10 text-pv-text" : "border-pv-border text-pv-text-muted hover:text-pv-text")}>
                  {f.symptomName}
                </button>
              ))}
            </div>
          </div>
        )}

        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-pv-cyan-soft">Or Enter A Scenario Seed</p>
          <input value={seedInput} onChange={(e) => setSeedInput(e.target.value)} placeholder="EVPN-7F29A" className="w-full rounded-lg border border-pv-border bg-transparent px-3 py-2 pv-mono text-sm text-pv-text placeholder:text-pv-text-faint focus:border-pv-cyan/50 focus:outline-none" />
        </div>

        <Button onClick={() => onStart({ seed: seedInput.trim() || undefined, difficulty, mode: seedInput.trim() ? "select" : mode, explicitFaultId: mode === "select" ? selectedFault : undefined })}>Open Incident →</Button>
      </GlassPanel>

      <Button variant="ghost" size="sm" onClick={() => setShowDashboard((v) => !v)}>{showDashboard ? "Hide Dashboard" : "Arena Dashboard"}</Button>
      {showDashboard && <ArenaDashboard results={arenaResults} />}
    </div>
  );
}

function ArenaDashboard({ results }: { results: { seed: string; categories: string[]; difficulty: Difficulty; score: number; hintsUsed: number }[] }) {
  const solved = results.length;
  const avgScore = solved ? Math.round(results.reduce((a, r) => a + r.score, 0) / solved) : 0;
  const bestScore = solved ? Math.max(...results.map((r) => r.score)) : 0;
  const firstAttempt = results.filter((r) => r.hintsUsed === 0).length;
  const categoryTotals = new Map<string, { hits: number; sum: number }>();
  results.forEach((r) => r.categories.forEach((c) => { const cur = categoryTotals.get(c) ?? { hits: 0, sum: 0 }; categoryTotals.set(c, { hits: cur.hits + 1, sum: cur.sum + r.score }); }));

  return (
    <GlassPanel strong className="mt-4 space-y-4 p-6">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-pv-cyan-soft">Arena Dashboard</h3>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Incidents Solved" value={String(solved)} />
        <Stat label="Average Score" value={String(avgScore)} />
        <Stat label="Best Score" value={String(bestScore)} />
        <Stat label="First-Attempt Fixes" value={String(firstAttempt)} />
      </div>
      {categoryTotals.size > 0 && (
        <div>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-pv-text-faint">Weak Areas</p>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {Array.from(categoryTotals.entries()).map(([c, v]) => (
              <div key={c} className="flex items-center justify-between rounded-lg border border-pv-border px-3 py-1.5 text-xs">
                <span className="text-pv-text-muted">{c}</span>
                <span className="pv-mono text-pv-text">{Math.round(v.sum / v.hits / 10)}%</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </GlassPanel>
  );
}
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-pv-border p-3 text-center">
      <p className="pv-mono text-lg font-bold text-pv-text">{value}</p>
      <p className="text-[10px] uppercase tracking-wide text-pv-text-faint">{label}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Incident view
// ---------------------------------------------------------------------------

function IncidentView({ config, onExit }: { config: { seed?: string; difficulty: Difficulty; mode: ScenarioMode; explicitFaultId?: FaultId }; onExit: () => void }) {
  const engine = useArenaEngine(config);
  const { session } = engine;
  const [selectedNodeId, setSelectedNodeId] = useState<ArenaDeviceId | undefined>(undefined);
  const [enteredDevice, setEnteredDevice] = useState<ArenaDeviceId | undefined>(undefined);
  const [findingText, setFindingText] = useState("");
  const [copyLabel, setCopyLabel] = useState("COPY SCENARIO CODE");
  const recordArenaResult = useProgressStore((s) => s.recordArenaResult);
  const arenaResults = useProgressStore((s) => s.arenaResults);
  const recordedRef = useRef(false);

  const nodes = GRAPH_NODES;
  const edges = GRAPH_EDGES;

  const subLabelFor = (id: string, fallback?: string) => {
    if (id === "LEAF1" && session.scenario.state.es.esAttachmentDown === "LEAF1") return "ES attachment: DOWN";
    if (id === "SERVER-A") return "Dual-Homed (ESI)";
    return fallback;
  };

  const score = engine.score;
  // Records the result exactly once per resolved incident — a Zustand
  // store write, not a local setState, so this stays a legitimate
  // "synchronize with an external system" effect (the same pattern
  // every lesson's own completeLesson()/unlockAchievement() effect
  // uses) rather than a same-component render-triggering setState.
  useEffect(() => {
    if (session.resolved && score && !recordedRef.current) {
      recordedRef.current = true;
      const categories = Array.from(new Set(session.scenario.faults.map((f) => f.category)));
      recordArenaResult({ seed: session.scenario.seed, faultIds: session.scenario.faultIds, categories, difficulty: session.scenario.difficulty, score: score.total, hintsUsed: session.hintsRevealed });
    }
  }, [session.resolved, score, session.scenario, session.hintsRevealed, recordArenaResult]);
  // .findLast (not .find): the same seed can appear more than once across
  // replays, and the most recent entry is always this incident's own
  // just-recorded result — an earlier entry would show a stale XP amount
  // (e.g. the pre-anti-farming-discount award from a prior play).
  const xpAwarded = [...arenaResults].reverse().find((r) => r.seed === session.scenario.seed)?.xpAwarded ?? null;

  return (
    <div className="mx-auto max-w-7xl px-6 py-10">
      <div className="mb-4 flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={onExit}>← Exit Arena</Button>
        <button type="button" onClick={engine.toggleInstructor} className={clsx("rounded-full border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide transition-colors", session.instructorMode ? "border-pv-danger/50 bg-pv-danger/10 text-pv-danger" : "border-pv-border text-pv-text-faint hover:text-pv-text")}>
          Instructor Mode {session.instructorMode ? "ON" : "OFF"}
        </button>
      </div>

      <IncidentHeader session={session} onCopySeed={() => { navigator.clipboard?.writeText(session.scenario.seed); setCopyLabel("COPIED"); setTimeout(() => setCopyLabel("COPY SCENARIO CODE"), 1500); }} copyLabel={copyLabel} />

      {session.instructorMode && <InstructorPanel faults={session.scenario.faults} />}

      {!session.resolved ? (
        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_420px]">
          <div className="space-y-6">
            <GraphTopologyViewer
              nodes={nodes.map((n) => ({ ...n, subLabel: subLabelFor(n.id, n.subLabel) }))}
              edges={edges}
              activeNodeIds={[]}
              regions={[]}
              onNodeClick={(id) => { setSelectedNodeId(id as ArenaDeviceId); setEnteredDevice(undefined); }}
            />
            {selectedNodeId && !enteredDevice && (
              <GlassPanel strong className="p-5">
                <div className="mb-2 flex items-center justify-between">
                  <h4 className="pv-mono text-sm font-bold text-pv-text">{selectedNodeId}</h4>
                  <button type="button" onClick={() => setSelectedNodeId(undefined)} className="text-xs text-pv-text-faint hover:text-pv-text">✕</button>
                </div>
                {isLeafOrSpine(selectedNodeId) ? (
                  <Button size="sm" onClick={() => { setEnteredDevice(selectedNodeId); engine.inspectDevice(selectedNodeId); }}>Open Device Explorer →</Button>
                ) : (
                  <p className="text-xs text-pv-text-muted">End host — no configuration surface to inspect directly. Use the toolbox to test its reachability.</p>
                )}
              </GlassPanel>
            )}
            {enteredDevice && isLeafOrSpine(enteredDevice) && <DeviceExplorer device={enteredDevice} state={session.scenario.state} onExit={() => setEnteredDevice(undefined)} />}

            <Toolbox state={session.scenario.state} onRun={(testId, params, device) => engine.runTest(testId, params, device)} />
            <CliTerminal state={session.scenario.state} />
            <PacketCaptureAndTrace state={session.scenario.state} />

            {session.mode === "repair" && <RepairPanel session={session} onApply={engine.applyRepair} onVerify={engine.verify} />}
          </div>

          <div className="space-y-4">
            <InvestigationNotebook
              session={session}
              findingText={findingText}
              onFindingTextChange={setFindingText}
              onAddFinding={(kind) => { if (findingText.trim()) { engine.addFinding(findingText.trim(), kind); setFindingText(""); } }}
              onSetHypothesis={engine.setHypothesis}
              onRevealHint={engine.revealHint}
              faultHints={session.scenario.faults[0]?.hints}
            />
            {session.mode === "investigate" && (
              <Button onClick={engine.enterRepairMode} className="w-full">Enter Repair Mode →</Button>
            )}
            <TestLog session={session} />
          </div>
        </div>
      ) : (
        <PostIncidentReport session={session} score={score} xpAwarded={xpAwarded} onNewIncident={onExit} />
      )}
    </div>
  );
}

function isLeafOrSpine(id: ArenaDeviceId): id is "SPINE1" | "LEAF1" | "LEAF2" | "LEAF3" {
  return id === "SPINE1" || id === "LEAF1" || id === "LEAF2" || id === "LEAF3";
}

function IncidentHeader({ session, onCopySeed, copyLabel }: { session: ReturnType<typeof useArenaEngine>["session"]; onCopySeed: () => void; copyLabel: string }) {
  const inc = session.scenario.incident;
  return (
    <GlassPanel strong className="p-6">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <Badge tone="danger">INCIDENT</Badge>
        <div className="flex items-center gap-2">
          <span className="pv-mono text-[11px] text-pv-text-faint">Scenario Seed: {session.scenario.seed}</span>
          <button type="button" onClick={onCopySeed} className="rounded-full border border-pv-border px-2.5 py-1 text-[10px] font-semibold uppercase text-pv-text-faint hover:text-pv-text">{copyLabel}</button>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div><p className="text-[10px] uppercase tracking-wide text-pv-text-faint">Site</p><p className="pv-mono text-sm text-pv-text">{inc.site}</p></div>
        <div><p className="text-[10px] uppercase tracking-wide text-pv-text-faint">Severity</p><p className="pv-mono text-sm text-pv-text">{inc.severity}</p></div>
        <div className="sm:col-span-2"><p className="text-[10px] uppercase tracking-wide text-pv-text-faint">Report</p><p className="text-sm text-pv-text">{inc.report}</p></div>
        <div><p className="text-[10px] uppercase tracking-wide text-pv-text-faint">Started</p><p className="pv-mono text-sm text-pv-text">{inc.started}</p></div>
        <div><p className="text-[10px] uppercase tracking-wide text-pv-text-faint">Recent Changes</p><p className="pv-mono text-sm text-pv-text">{inc.recentChanges}</p></div>
      </div>
    </GlassPanel>
  );
}

function InstructorPanel({ faults }: { faults: ReturnType<typeof useArenaEngine>["session"]["scenario"]["faults"] }) {
  return (
    <GlassPanel className="mt-4 space-y-3 border-pv-danger/40 p-5">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-pv-danger">Instructor Mode — Not Visible To Students</h4>
      {faults.map((f) => (
        <div key={f.id} className="rounded-lg border border-pv-border p-3 text-xs">
          <p className="pv-mono text-pv-text">Fault ID: {f.id} — {f.internalTitle}</p>
          <p className="mt-1 text-pv-text-muted">Category: {f.category}</p>
          <p className="mt-1 text-pv-text-muted">Correct repair: {f.repairs.find((r) => r.correct)?.label}</p>
          <p className="mt-1 text-pv-text-muted">Learning objective: {f.rootCauseSummary}</p>
        </div>
      ))}
    </GlassPanel>
  );
}

// ---------------------------------------------------------------------------
// Device Explorer (brief: reuse Device Explorer)
// ---------------------------------------------------------------------------

function DeviceExplorer({ device, state, onExit }: { device: "SPINE1" | "LEAF1" | "LEAF2" | "LEAF3"; state: ReturnType<typeof useArenaEngine>["session"]["scenario"]["state"]; onExit: () => void }) {
  const [tab, setTab] = useState("overview");
  const ifaces = interfacesFor(state, device);
  const tabs = device === "SPINE1"
    ? [{ id: "overview", label: "Overview" }, { id: "interfaces", label: "Interfaces" }]
    : [
        { id: "overview", label: "Overview" },
        { id: "interfaces", label: "Interfaces" },
        { id: "evpn-routes", label: "EVPN Routes" },
        { id: "vrf", label: "VRF / IRB" },
        ...(state.es.leafs.includes(device) ? [{ id: "es", label: "Ethernet Segment" }] : []),
        ...(device === "LEAF1" || device === "LEAF2" ? [{ id: "vpws", label: "VPWS Services" }] : []),
        ...(device === "LEAF1" ? [{ id: "suppression", label: "Suppression" }] : []),
      ];

  return (
    <GlassPanel strong className="space-y-4 p-5">
      <div className="flex items-center justify-between">
        <h3 className="pv-mono text-lg font-bold text-pv-text">{device}</h3>
        <Button variant="ghost" size="sm" onClick={onExit}>← Close</Button>
      </div>
      <div className="flex flex-wrap gap-1 rounded-full border border-pv-border p-0.5 w-fit">
        {tabs.map((t) => (
          <button key={t.id} type="button" onClick={() => setTab(t.id)} className={clsx("rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors", tab === t.id ? "bg-pv-cyan/15 text-pv-cyan-soft" : "text-pv-text-faint hover:text-pv-text")}>{t.label}</button>
        ))}
      </div>
      <div>
        {tab === "overview" && (
          <div className="space-y-1 pv-mono text-[11px]">
            <p className="text-pv-text-faint">Device status: <span className="text-pv-text">up</span></p>
            <p className="text-pv-text-faint">BGP EVPN: <span className="text-pv-text">{device === "SPINE1" ? "n/a (underlay only)" : state.bgpEvpnUp[device] ? "Established" : "Down"}</span></p>
            <p className="text-pv-text-faint">Type-2 routes visible: <span className="text-pv-text">{state.type2Routes.length}</span></p>
          </div>
        )}
        {tab === "interfaces" && (
          <div className="space-y-1.5">
            {ifaces.map((i) => (
              <div key={i.id} className="flex items-center justify-between rounded-lg border border-pv-border px-3 py-1.5 pv-mono text-[11px]">
                <span className={i.status === "down" ? "text-pv-danger" : "text-pv-text"}>{i.name} → {i.neighborLabel}</span>
                <span className={i.status === "down" ? "text-pv-danger" : "text-pv-success"}>{i.status.toUpperCase()}</span>
              </div>
            ))}
          </div>
        )}
        {tab === "evpn-routes" && <EvpnRibViewer title={device} rows={evpnRibRowsFor(state, device)} />}
        {tab === "vrf" && isLeaf(device) && <KeyValueList rows={vrfTabRowsFor(state, device)} />}
        {tab === "es" && isLeaf(device) && <KeyValueList rows={esTabRowsFor(state, device)} />}
        {tab === "vpws" && <ServiceInstanceViewer title={`VPWS-${state.vpws.serviceId}`} status={state.vpws.status} fields={vpwsTabRowsFor(state, device)} />}
        {tab === "suppression" && isLeaf(device) && <KeyValueList rows={suppressionTabRowsFor(state, device)} />}
      </div>
    </GlassPanel>
  );
}

function KeyValueList({ rows }: { rows: { label: string; value: string }[] }) {
  return (
    <div className="space-y-0.5 rounded-lg border border-pv-border p-2.5 pv-mono text-[11px]">
      {rows.map((r) => (<div key={r.label} className="flex justify-between gap-3"><span className="text-pv-text-faint">{r.label}</span><span className="text-pv-text">{r.value}</span></div>))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Investigation Notebook (brief §10/§11/§23)
// ---------------------------------------------------------------------------

function InvestigationNotebook({
  session,
  findingText,
  onFindingTextChange,
  onAddFinding,
  onSetHypothesis,
  onRevealHint,
  faultHints,
}: {
  session: ReturnType<typeof useArenaEngine>["session"];
  findingText: string;
  onFindingTextChange: (v: string) => void;
  onAddFinding: (kind: "healthy" | "suspicious") => void;
  onSetHypothesis: (h: HypothesisCategory) => void;
  onRevealHint: () => void;
  faultHints?: [string, string, string];
}) {
  return (
    <GlassPanel strong className="space-y-4 p-5">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-pv-cyan-soft">Investigation</h3>

      <div>
        <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-pv-text-faint">Current Hypothesis</p>
        <div className="flex flex-wrap gap-1.5">
          {HYPOTHESIS_OPTIONS.map((h) => (
            <button key={h.id} type="button" onClick={() => onSetHypothesis(h.id)} className={clsx("rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors", session.hypothesis === h.id ? "border-pv-violet/50 bg-pv-violet/10 text-pv-violet" : "border-pv-border text-pv-text-faint hover:text-pv-text")}>{h.label}</button>
          ))}
        </div>
      </div>

      <div>
        <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-pv-text-faint">Add A Finding</p>
        <input value={findingText} onChange={(e) => onFindingTextChange(e.target.value)} placeholder="e.g. Type-2 route for HOST-B not imported" className="mb-1.5 w-full rounded-lg border border-pv-border bg-transparent px-2.5 py-1.5 text-xs text-pv-text placeholder:text-pv-text-faint focus:border-pv-cyan/50 focus:outline-none" />
        <div className="flex gap-1.5">
          <Button size="sm" variant="secondary" onClick={() => onAddFinding("healthy")}>✓ Healthy</Button>
          <Button size="sm" variant="secondary" onClick={() => onAddFinding("suspicious")}>✕ Suspicious</Button>
        </div>
      </div>

      {session.findings.length > 0 && (
        <div className="space-y-1">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-pv-text-faint">Findings</p>
          {session.findings.map((f) => (
            <p key={f.id} className={clsx("pv-mono text-[11px]", f.kind === "healthy" ? "text-pv-success" : "text-pv-danger")}>{f.kind === "healthy" ? "✓" : "✕"} {f.text}</p>
          ))}
        </div>
      )}

      <div>
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-pv-text-faint">Hints</p>
          {session.hintsRevealed < 3 && <button type="button" onClick={onRevealHint} className="text-[10px] font-semibold text-pv-cyan-soft hover:text-pv-cyan">Request Hint {session.hintsRevealed + 1}</button>}
        </div>
        {Array.from({ length: session.hintsRevealed }).map((_, i) => (
          <p key={i} className="mt-1 rounded-lg border border-pv-warning/30 bg-pv-warning/5 p-2 text-[11px] text-pv-text-muted">Hint {i + 1}: {faultHints?.[i]}</p>
        ))}
      </div>
    </GlassPanel>
  );
}

function TestLog({ session }: { session: ReturnType<typeof useArenaEngine>["session"] }) {
  return (
    <GlassPanel className="space-y-2 p-5">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-pv-cyan-soft">Evidence Timeline</h3>
      <div className="max-h-56 space-y-1 overflow-y-auto pv-mono text-[11px]">
        {session.timeline.map((t) => (<p key={t.id} className="text-pv-text-muted">{t.timeLabel} {t.text}</p>))}
      </div>
    </GlassPanel>
  );
}

// ---------------------------------------------------------------------------
// Toolbox (brief §12)
// ---------------------------------------------------------------------------

function Toolbox({ state, onRun }: { state: ArenaState; onRun: (testId: TestId, params: Record<string, string>, device?: ArenaDeviceId) => void }) {
  const [testId, setTestId] = useState<TestId>("ping");
  const [from, setFrom] = useState("HOST-A");
  const [to, setTo] = useState("HOST-B");
  const [leaf, setLeaf] = useState<ArenaDeviceId>("LEAF1");
  const [vni, setVni] = useState("10010");
  const [macName, setMacName] = useState("HOST-B");
  const [routeType, setRouteType] = useState("2");
  const [result, setResult] = useState<TestResult | null>(null);

  const run = () => {
    let params: Record<string, string> = {};
    let device: ArenaDeviceId | undefined;
    switch (testId) {
      case "ping":
      case "packet-trace":
        params = { from, to };
        device = isLeafOrSpine(from as ArenaDeviceId) ? (from as ArenaDeviceId) : hostInfo(from)?.leaf;
        break;
      case "arp":
        params = { from: leaf, to: state.suppression.targetIp };
        device = leaf;
        break;
      case "mac-lookup": {
        const mac = hostInfo(macName)?.mac ?? "";
        params = { leaf, mac };
        device = leaf;
        break;
      }
      case "evpn-route":
        params = { type: routeType };
        break;
      case "vrf-route":
      case "bgp-neighbor":
      case "interface-state":
        params = { leaf };
        device = leaf;
        break;
      case "vtep-reachability":
        params = { from: leaf, to };
        device = leaf;
        break;
      case "vni-state":
        params = { leaf, vni };
        device = leaf;
        break;
      case "ethernet-segment":
        params = { leaf: "LEAF1,LEAF2" };
        break;
      case "df-state":
      case "vpws-service":
        params = {};
        break;
    }
    const r = runTest(state, testId, params);
    setResult(r);
    onRun(testId, params, device);
  };

  return (
    <GlassPanel strong className="space-y-3 p-5">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-pv-cyan-soft">Toolbox</h3>
      <div className="flex flex-wrap items-center gap-2">
        <select value={testId} onChange={(e) => setTestId(e.target.value as TestId)} className="rounded-lg border border-pv-border bg-transparent px-2 py-1.5 text-xs text-pv-text">
          {Object.entries(TEST_LABELS).map(([id, label]) => (<option key={id} value={id} className="bg-black">{label}</option>))}
        </select>

        {(testId === "ping" || testId === "packet-trace") && (
          <>
            <select value={from} onChange={(e) => setFrom(e.target.value)} className="rounded-lg border border-pv-border bg-transparent px-2 py-1.5 text-xs text-pv-text">
              {["HOST-A", "SERVER-A", "HOST-B", "LEAF1", "LEAF2", "LEAF3"].map((v) => (<option key={v} value={v} className="bg-black">{v}</option>))}
            </select>
            <span className="text-xs text-pv-text-faint">→</span>
            <select value={to} onChange={(e) => setTo(e.target.value)} className="rounded-lg border border-pv-border bg-transparent px-2 py-1.5 text-xs text-pv-text">
              {[...PING_TARGETS, "broadcast", "LEAF1", "LEAF2", "LEAF3"].map((v) => (<option key={v} value={v} className="bg-black">{v}</option>))}
            </select>
          </>
        )}
        {(testId === "arp" || testId === "vrf-route" || testId === "bgp-neighbor" || testId === "interface-state" || testId === "vni-state") && (
          <select value={String(leaf)} onChange={(e) => setLeaf(e.target.value as ArenaDeviceId)} className="rounded-lg border border-pv-border bg-transparent px-2 py-1.5 text-xs text-pv-text">
            {DEVICE_OPTIONS.map((v) => (<option key={v} value={v} className="bg-black">{v}</option>))}
          </select>
        )}
        {testId === "vni-state" && (
          <select value={vni} onChange={(e) => setVni(e.target.value)} className="rounded-lg border border-pv-border bg-transparent px-2 py-1.5 text-xs text-pv-text">
            <option value="10010" className="bg-black">10010</option>
            <option value="10020" className="bg-black">10020</option>
          </select>
        )}
        {testId === "mac-lookup" && (
          <>
            <select value={String(leaf)} onChange={(e) => setLeaf(e.target.value as ArenaDeviceId)} className="rounded-lg border border-pv-border bg-transparent px-2 py-1.5 text-xs text-pv-text">
              {LEAF_OPTIONS.map((v) => (<option key={v} value={v} className="bg-black">{v}</option>))}
            </select>
            <select value={macName} onChange={(e) => setMacName(e.target.value)} className="rounded-lg border border-pv-border bg-transparent px-2 py-1.5 text-xs text-pv-text">
              {["HOST-A", "HOST-B", "SERVER-A", "ROAMER"].map((v) => (<option key={v} value={v} className="bg-black">{v}</option>))}
            </select>
          </>
        )}
        {testId === "vtep-reachability" && (
          <>
            <select value={String(leaf)} onChange={(e) => setLeaf(e.target.value as ArenaDeviceId)} className="rounded-lg border border-pv-border bg-transparent px-2 py-1.5 text-xs text-pv-text">
              {LEAF_OPTIONS.map((v) => (<option key={v} value={v} className="bg-black">{v}</option>))}
            </select>
            <span className="text-xs text-pv-text-faint">→</span>
            <select value={to} onChange={(e) => setTo(e.target.value)} className="rounded-lg border border-pv-border bg-transparent px-2 py-1.5 text-xs text-pv-text">
              {[...LEAF_OPTIONS, "SERVER-A"].map((v) => (<option key={v} value={v} className="bg-black">{v}</option>))}
            </select>
          </>
        )}
        {testId === "evpn-route" && (
          <select value={routeType} onChange={(e) => setRouteType(e.target.value)} className="rounded-lg border border-pv-border bg-transparent px-2 py-1.5 text-xs text-pv-text">
            {["1", "2", "3", "4", "5"].map((v) => (<option key={v} value={v} className="bg-black">Type {v}</option>))}
          </select>
        )}

        <Button size="sm" onClick={run}>Run Test</Button>
      </div>

      {result && (
        <div className="rounded-lg border border-pv-border p-3">
          <div className="mb-1 flex items-center justify-between">
            <p className="text-xs font-semibold text-pv-text">{result.title}</p>
            {result.success !== undefined && <Badge tone={result.success ? "success" : "danger"}>{result.success ? "PASS" : "FAIL"}</Badge>}
          </div>
          <div className="space-y-0.5 pv-mono text-[11px] text-pv-text-muted">
            {result.lines.map((l, i) => (<p key={i}>{l}</p>))}
          </div>
        </div>
      )}

      {result && testId === "vtep-reachability" && to === "SERVER-A" && (
        <NextHopSetViewer
          title="Eligible Next-Hop Set"
          chain={[{ label: "Destination", value: "SERVER-A" }, { label: "Type-2 Route", value: "ESI-carrying" }]}
          members={(["LEAF1", "LEAF2"] as const).map((l) => ({ id: l, label: l, eligible: state.aliasing.eligiblePEs.includes(l) }))}
          setLabel="Eligible Next-Hops"
        />
      )}
      {result && testId === "df-state" && (
        <ElectionViewer
          title="Ethernet Segment DF Belief"
          algorithm="Observed, not re-run — this only reports each leaf's current believed role."
          candidates={state.es.leafs.map((l) => ({ id: l, label: l, value: VTEP_LOOPBACK[l] }))}
          reason="Exactly one leaf should believe it is DF for a healthy Ethernet Segment."
          roleFor={(c) => (state.es.dualDfBelief[c.id as "LEAF1" | "LEAF2"] ? { label: "BELIEVES DF", tone: "warning" } : { label: "NDF", tone: "muted" })}
        />
      )}
    </GlassPanel>
  );
}

// ---------------------------------------------------------------------------
// CLI Terminal (brief §13)
// ---------------------------------------------------------------------------

function CliTerminal({ state }: { state: ArenaState }) {
  const [device, setDevice] = useState<ArenaDeviceId>("LEAF1");
  const [flavor, setFlavor] = useState<"cisco" | "juniper">("cisco");
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<{ cmd: string; output: string[] }[]>([]);

  const run = (cmd: string) => {
    if (!cmd.trim()) return;
    const output = runCliCommand(state, device, flavor, cmd);
    setHistory((h) => [...h, { cmd, output }]);
    setInput("");
  };

  const suggestions = flavor === "cisco" ? CLI_SUGGESTIONS_CISCO : CLI_SUGGESTIONS_JUNIPER;

  return (
    <GlassPanel strong className="space-y-3 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-pv-cyan-soft">CLI Terminal (read-only)</h3>
        <div className="flex items-center gap-2">
          <select value={device} onChange={(e) => setDevice(e.target.value as ArenaDeviceId)} className="rounded-lg border border-pv-border bg-transparent px-2 py-1 text-xs text-pv-text">
            {DEVICE_OPTIONS.map((d) => (<option key={d} value={d} className="bg-black">{d}</option>))}
          </select>
          <div className="flex gap-1 rounded-full border border-pv-border p-0.5">
            {(["cisco", "juniper"] as const).map((f) => (
              <button key={f} type="button" onClick={() => setFlavor(f)} className={clsx("rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize", flavor === f ? "bg-pv-cyan/15 text-pv-cyan-soft" : "text-pv-text-faint")}>{f}</button>
            ))}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap gap-1">
        {suggestions.map((s) => (<button key={s} type="button" onClick={() => run(s)} className="rounded-full border border-pv-border px-2 py-0.5 pv-mono text-[10px] text-pv-text-faint hover:text-pv-text">{s}</button>))}
      </div>
      <div className="max-h-56 space-y-2 overflow-y-auto rounded-lg border border-pv-border bg-black/30 p-3 pv-mono text-[11px]">
        {history.map((h, i) => (
          <div key={i}>
            <p className="text-pv-cyan-soft">{device}# {h.cmd}</p>
            {h.output.map((l, j) => (<p key={j} className="text-pv-text-muted">{l}</p>))}
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && run(input)} placeholder={`show bgp l2vpn evpn summary`} className="flex-1 rounded-lg border border-pv-border bg-transparent px-2.5 py-1.5 pv-mono text-xs text-pv-text placeholder:text-pv-text-faint focus:border-pv-cyan/50 focus:outline-none" />
        <Button size="sm" onClick={() => run(input)}>Run</Button>
      </div>
    </GlassPanel>
  );
}

// ---------------------------------------------------------------------------
// Packet Capture + Packet Trace (brief §15/§16)
// ---------------------------------------------------------------------------

function PacketCaptureAndTrace({ state }: { state: ArenaState }) {
  const [captureDevice, setCaptureDevice] = useState<ArenaDeviceId>("LEAF1");
  const [direction, setDirection] = useState<"ingress" | "egress">("ingress");
  const [captureLines, setCaptureLines] = useState<string[] | null>(null);

  const [traceFrom, setTraceFrom] = useState("HOST-A");
  const [traceTo, setTraceTo] = useState("HOST-B");
  const [traceResult, setTraceResult] = useState<TestResult | null>(null);

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <GlassPanel strong className="space-y-3 p-5">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-pv-cyan-soft">Packet Capture</h3>
        <div className="flex flex-wrap gap-2">
          <select value={captureDevice} onChange={(e) => setCaptureDevice(e.target.value as ArenaDeviceId)} className="rounded-lg border border-pv-border bg-transparent px-2 py-1.5 text-xs text-pv-text">
            {LEAF_OPTIONS.map((d) => (<option key={d} value={d} className="bg-black">{d}</option>))}
          </select>
          <select value={direction} onChange={(e) => setDirection(e.target.value as "ingress" | "egress")} className="rounded-lg border border-pv-border bg-transparent px-2 py-1.5 text-xs text-pv-text">
            <option value="ingress" className="bg-black">Ingress</option>
            <option value="egress" className="bg-black">Egress</option>
          </select>
          <Button size="sm" onClick={() => setCaptureLines(runCapture(state, captureDevice, direction))}>Capture Packet</Button>
        </div>
        {captureLines && (
          <div className="rounded-lg border border-pv-border bg-black/30 p-2.5 pv-mono text-[11px] text-pv-text-muted">
            {captureLines.map((l, i) => (<p key={i}>{l}</p>))}
          </div>
        )}
      </GlassPanel>

      <GlassPanel strong className="space-y-3 p-5">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-pv-cyan-soft">Trace Flow</h3>
        <div className="flex flex-wrap items-center gap-2">
          <select value={traceFrom} onChange={(e) => setTraceFrom(e.target.value)} className="rounded-lg border border-pv-border bg-transparent px-2 py-1.5 text-xs text-pv-text">
            {["HOST-A", "SERVER-A", "HOST-B"].map((v) => (<option key={v} value={v} className="bg-black">{v}</option>))}
          </select>
          <span className="text-xs text-pv-text-faint">→</span>
          <select value={traceTo} onChange={(e) => setTraceTo(e.target.value)} className="rounded-lg border border-pv-border bg-transparent px-2 py-1.5 text-xs text-pv-text">
            {[...PING_TARGETS, "broadcast"].map((v) => (<option key={v} value={v} className="bg-black">{v}</option>))}
          </select>
          <Button size="sm" onClick={() => setTraceResult(runTest(state, "packet-trace", { from: traceFrom, to: traceTo }))}>Trace</Button>
        </div>
        {traceResult && (
          <div className="space-y-1 rounded-lg border border-pv-border p-2.5 pv-mono text-[11px]">
            {traceResult.lines.map((l, i) => (<p key={i} className={l.includes("✕") ? "text-pv-danger" : "text-pv-success"}>{l}</p>))}
          </div>
        )}
      </GlassPanel>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Repair Mode (brief §18/§19/§20)
// ---------------------------------------------------------------------------

function RepairPanel({ session, onApply, onVerify }: { session: ReturnType<typeof useArenaEngine>["session"]; onApply: (repairId: string) => void; onVerify: () => void }) {
  const allRepairs = session.scenario.faults.flatMap((f) => f.repairs);
  const contextual = allRepairs.filter((r) => session.inspectedDevices.includes(r.deviceId));
  const locked = allRepairs.length - contextual.length;

  return (
    <GlassPanel strong className="space-y-3 p-5">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-pv-cyan-soft">Repair Mode</h3>
      {contextual.length === 0 && <p className="text-xs text-pv-text-muted">No repair controls yet — open Device Explorer on a device you suspect first.</p>}
      <div className="grid gap-2 sm:grid-cols-2">
        {contextual.map((r) => {
          const attempt = session.repairAttempts.find((a) => a.repairId === r.id);
          return (
            <button
              key={r.id}
              type="button"
              onClick={() => onApply(r.id)}
              className={clsx(
                "rounded-xl border px-4 py-3 text-left text-sm transition-colors cursor-pointer",
                attempt?.correct && "border-pv-success/50 bg-pv-success/10 text-pv-success",
                attempt && !attempt.correct && "border-pv-danger/50 bg-pv-danger/10 text-pv-danger",
                !attempt && "border-pv-border hover:border-pv-cyan/40 hover:bg-pv-cyan/5",
              )}
            >
              <span className="pv-mono text-[10px] uppercase text-pv-text-faint">{r.deviceId}</span>
              <p>{r.label}</p>
            </button>
          );
        })}
      </div>
      {locked > 0 && <p className="text-[11px] text-pv-text-faint">{locked} more repair option(s) will appear once you inspect the relevant device(s).</p>}
      {session.repairAttempts.some((a) => !a.correct) && (
        <div className="rounded-lg border border-pv-warning/30 bg-pv-warning/5 p-2.5 text-xs text-pv-text-muted">
          {(() => {
            const last = [...session.repairAttempts].reverse().find((a) => !a.correct);
            const repair = allRepairs.find((r) => r.id === last?.repairId);
            return repair?.rejectReason ?? "That repair had no effect.";
          })()}
        </div>
      )}
      <Button onClick={onVerify} className="w-full">Verify Fix</Button>
    </GlassPanel>
  );
}

// ---------------------------------------------------------------------------
// Post-Incident Report (brief §25/§26)
// ---------------------------------------------------------------------------

function PostIncidentReport({
  session,
  score,
  xpAwarded,
  onNewIncident,
}: {
  session: ReturnType<typeof useArenaEngine>["session"];
  score?: ScoreBreakdown;
  xpAwarded: number | null;
  onNewIncident: () => void;
}) {
  const [replayIndex, setReplayIndex] = useState(session.timeline.length - 1);
  const rank = score ? rankForScore(score.total) : undefined;
  const idealPath = session.scenario.faults[0]?.evidenceSummary ?? [];
  const yourPath = session.testLog.map((t) => t.result.title);
  const finalLayers: DiagnosticLayer[] = ["Layer 1", "Underlay", "Control Plane", "Overlay", "Service", "Forwarding"].map((label) => ({ label, status: "healthy" as const }));

  return (
    <div className="mt-6 space-y-6">
      <GlassPanel strong glow="success" className="space-y-4 p-6">
        <Badge tone="success">INCIDENT RESOLVED</Badge>
        <div>
          <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-pv-text-faint">Root Cause</h4>
          <p className="text-sm text-pv-text">{session.scenario.faults.map((f) => f.rootCauseSummary).join(" ")}</p>
        </div>
        <div>
          <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-pv-text-faint">Evidence</h4>
          <ul className="space-y-0.5 pv-mono text-[11px] text-pv-text-muted">{session.scenario.faults.flatMap((f) => f.evidenceSummary).map((e) => (<li key={e}>• {e}</li>))}</ul>
        </div>
        <div>
          <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-pv-text-faint">Repair</h4>
          <p className="text-sm text-pv-text">{session.repairAttempts.find((a) => a.correct)?.label}</p>
        </div>
        <div>
          <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-pv-text-faint">Verification</h4>
          <p className="text-sm text-pv-text">{session.scenario.faults[0]?.verificationTest.description} re-tested successfully.</p>
        </div>
        {score && (
          <div>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-pv-text-faint">Score — {score.total} / 1000</h4>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              <Stat label="Diagnosis" value={String(score.diagnosis)} />
              <Stat label="Investigation" value={String(score.investigation)} />
              <Stat label="Repair" value={String(score.repair)} />
              <Stat label="Verification" value={String(score.verification)} />
              <Stat label="Efficiency" value={String(score.efficiency)} />
            </div>
          </div>
        )}
        {rank && (
          <div>
            <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-pv-text-faint">Grade</h4>
            <p className="pv-mono text-lg font-bold text-pv-success">{rank.label}</p>
          </div>
        )}
        {xpAwarded !== null && <p className="pv-mono text-xs text-pv-cyan-soft">+{xpAwarded} XP awarded</p>}
      </GlassPanel>

      <TroubleshootingLayers title="Diagnostic Layers — Post-Solution" layers={finalLayers} />

      <GlassPanel className="grid gap-4 p-6 sm:grid-cols-2">
        <div>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-pv-cyan-soft">Ideal Investigation Path</h4>
          <ul className="space-y-1 pv-mono text-[11px] text-pv-text-muted">{idealPath.map((p) => (<li key={p}>• {p}</li>))}</ul>
        </div>
        <div>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-pv-violet">Your Investigation Path</h4>
          <ul className="space-y-1 pv-mono text-[11px] text-pv-text-muted">{yourPath.length ? yourPath.map((p, i) => (<li key={i}>• {p}</li>)) : <li>No tests were run.</li>}</ul>
        </div>
      </GlassPanel>

      <GlassPanel className="space-y-3 p-6">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-pv-cyan-soft">Replay Investigation</h4>
        <input type="range" min={0} max={Math.max(0, session.timeline.length - 1)} value={replayIndex} onChange={(e) => setReplayIndex(Number(e.target.value))} className="w-full" />
        <div className="space-y-0.5 pv-mono text-[11px] text-pv-text-muted">
          {session.timeline.slice(0, replayIndex + 1).map((t) => (<p key={t.id}>{t.timeLabel} {t.text}</p>))}
        </div>
      </GlassPanel>

      <Button onClick={onNewIncident}>New Incident</Button>
    </div>
  );
}
