"use client";

import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import Link from "next/link";
import { clsx } from "clsx";
import { useScenarioEngine } from "@/lib/sim-engine/useScenarioEngine";
import type { PacketVisual, ScenarioStep } from "@/lib/sim-engine/types";
import { GraphTopologyViewer, type GraphEdge, type GraphNode, type GraphRegion } from "@/components/network/GraphTopologyViewer";
import { GraphPacketBubble } from "@/components/network/GraphPacketBubble";
import { PacketInspector } from "@/components/network/PacketInspector";
import { PacketJourneyTimeline } from "@/components/protocol/PacketJourneyTimeline";
import { TroubleshootingLayers, type DiagnosticLayer } from "@/components/protocol/TroubleshootingLayers";
import { PredictionQuestion } from "@/components/quiz/PredictionQuestion";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { useProgressStore } from "@/lib/state/useProgressStore";
import { NetworkScene3D, type FloodCopy3D } from "@/components/network3d/NetworkScene3D";
import { NodeInspectorPanel } from "@/components/network3d/NodeInspectorPanel";
import { TopologyModeSwitcher } from "@/components/network3d/TopologyModeSwitcher";
import { DeviceExplorerPanel, InterfaceListTab, type DeviceExplorerTab } from "@/components/network3d/DeviceExplorerPanel";
import { TopologyFrame } from "@/components/network3d/TopologyFrame";
import { TopologyFocusMode } from "@/components/network3d/TopologyFocusMode";
import { HopInspectorPanel } from "@/components/network3d/HopInspectorPanel";
import { PacketDiffViewer } from "@/components/network3d/PacketDiffViewer";
import { HopTimeline } from "@/components/network3d/HopTimeline";
import { PacketFlowControls, type PlaySpeed } from "@/components/network3d/PacketFlowControls";
import { layoutRegionsTo3D, layoutTo3D } from "@/components/network3d/layout";
import type { ActivePacket3D, CameraMode, DeviceInterfaceData, DeviceProcessingTrace, InspectorSurface, Link3DData, Node3DStatus, NodeExplanation, PacketCallout3D, PacketStackFrame } from "@/components/network3d/types";
import { LessonGuideButton, LessonGuideDialog, type LessonGuideTab } from "./LessonGuideDialog";
import { MissionBriefingCard, MissionBriefingStrip } from "./MissionBriefingCard";
import { resolveBriefing, type BriefingPhaseDef, type BriefingStepNote } from "./briefing";
import { bubblePacket } from "./mplsStack";
import type { FundHop } from "./fundamentalsTrace";

/**
 * One reusable page shell for the Fundamentals lessons (Ethernet & Switching, IPv4, VLANs). It carries NO protocol
 * logic — every value it shows comes from the lesson's own scenario state, traces, explanations and callouts, passed
 * in through `FundamentalsLessonConfig`. It reproduces the finished-lesson UX: normal 2D/3D, Focus Mode with a real
 * 3D|2D renderer switch, device mode, hop timeline with Historical / Return to Current, Mission Briefing card/strip,
 * questions, a requiresState repair challenge, packet bubbles and 3D callouts.
 */
export interface ShellFloodCopy {
  id: string;
  fromId: string;
  toId: string;
  packet: PacketVisual;
}
export interface ShellTable {
  title: string;
  rows: { label: string; value: string }[];
}
export interface ShellEdge extends GraphEdge {
  down?: boolean;
}
export interface FundamentalsLessonConfig<S extends { hops: FundHop[] }> {
  lessonId: string;
  xp: number;
  steps: ScenarioStep<S>[];
  createState: () => S;
  badge: string;
  title: string;
  intro: string;
  facts: { q: string; a: string }[];
  terms: { term: string; expansion: string; meaning: string }[];
  guide: { title: string; subtitle: string; tabs: LessonGuideTab[] };
  briefing: { phases: BriefingPhaseDef[]; notes: Partial<Record<string, BriefingStepNote>> };
  nodes: (s: S) => GraphNode[];
  edges: (s: S) => ShellEdge[];
  regions?: GraphRegion[];
  /** Devices whose interior (pipeline, interfaces, tables) can be entered. */
  enterable: string[];
  /** Non-packet steps that belong on the hop timeline, and the device each one is about. */
  primaryDevice: Partial<Record<string, string>>;
  traceFor: (device: string, s: S, stepId: string) => DeviceProcessingTrace;
  interfacesFor: (device: string, s: S, stepId: string) => DeviceInterfaceData[];
  pipelineTitle: (device: string) => string;
  explainNode: (s: S, id: string, stepId: string) => NodeExplanation;
  tablesFor: (device: string, s: S) => ShellTable[];
  /** 3D callout / 2D bubble title for a packet, given the state it belongs to (decisions come from that state, never from the packet). */
  callout: (p: PacketVisual, s: S) => PacketCallout3D;
  floodCopies?: (s: S, stepId: string) => ShellFloodCopy[];
  nodeBadges?: (id: string, s: S) => string[] | undefined;
  repair: { stepId: string; prompt: string; options: { id: string; label: string }[]; correctId: string; success: string; wrongFeedback: Record<string, string>; attempt: (s: S) => { choice: string; correct: boolean } | undefined };
  diagnostics: { fromStepId: string; layers: (s: S) => DiagnosticLayer[] };
  /** Teaching panels for the main column, from the live state. */
  panels?: (s: S, stepId: string | undefined) => ReactNode;
  /** Compact facts under the packet inspector (e.g. a MAC table), from the live state. */
  sidePanel?: (s: S) => ReactNode;
  complete: { badge: string; title: string; message: string };
}

const NARROW_QUERY = "(max-width: 640px)";
const subscribeNarrow = (cb: () => void) => {
  const m = window.matchMedia(NARROW_QUERY);
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
};
/** True on phone-width viewports (false during SSR, so hydration matches). */
function useNarrow() {
  return useSyncExternalStore(subscribeNarrow, () => window.matchMedia(NARROW_QUERY).matches, () => false);
}

function framesFromPacket(p: PacketVisual | undefined): PacketStackFrame[] | undefined {
  if (!p) return undefined;
  return p.layers.map((l, i) => ({ id: `${l.name}-${i}`, text: l.name, tone: /IPv4|IP /i.test(l.name) ? "ip" : /802\.1Q|Tag/i.test(l.name) ? "vpn" : "generic" }));
}

export function FundamentalsLessonShell<S extends { hops: FundHop[] }>({ config }: { config: FundamentalsLessonConfig<S> }) {
  const c = config;
  const { engine, snapshot } = useScenarioEngine<S>(c.createState(), c.steps);
  const narrow = useNarrow();
  const [autoPlay, setAutoPlay] = useState(false);
  const [speed, setSpeed] = useState<0.5 | 1 | 2>(1);
  const [viewMode, setViewMode] = useState<"physical" | "3d">("physical");
  const [selectedNodeId, setSelectedNodeId] = useState<string | undefined>(undefined);
  const [cameraMode, setCameraMode] = useState<CameraMode>("overview");
  const [enteredDeviceId, setEnteredDeviceId] = useState<string | undefined>(undefined);
  const [deviceXray, setDeviceXray] = useState(true);
  const [selectedInterfaceId, setSelectedInterfaceId] = useState<string | undefined>(undefined);
  const [packetSelected, setPacketSelected] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [historicalIndex, setHistoricalIndex] = useState<number | undefined>(undefined);
  const [inspectorSurface, setInspectorSurface] = useState<InspectorSurface>("hop");
  const completeLesson = useProgressStore((st) => st.completeLesson);
  const recordAnswer = useProgressStore((st) => st.recordAnswer);

  const { state, currentStep, index, totalSteps, isComplete, lastAnswer, whatChanged, activePacket } = snapshot;
  const canAdvance = engine.canAdvance();
  const stepId = currentStep?.id ?? c.steps[c.steps.length - 1]?.id ?? "";

  // --- Historical cursor (same invariant as every finished lesson): only a step strictly before the live one. ---
  if (historicalIndex !== undefined && historicalIndex >= index) setHistoricalIndex(undefined);
  const historicalCursor = historicalIndex !== undefined && historicalIndex < index ? historicalIndex : undefined;
  const historicalState = historicalCursor !== undefined ? engine.getStateAt(historicalCursor) : undefined;
  const historicalStep = historicalCursor !== undefined ? c.steps[historicalCursor] : undefined;
  const historicalPacket = historicalStep && historicalState ? historicalStep.packet?.(historicalState) : undefined;

  /** The device that acted at a step: its last recorded hop, else the step's primary device, else the packet's sender. */
  const actorAt = (st: S, id: string, p: PacketVisual | undefined) => st.hops.filter((h) => h.stepId === id).at(-1)?.device ?? c.primaryDevice[id] ?? p?.from;
  const historicalDeviceId = historicalStep && historicalState ? actorAt(historicalState, historicalStep.id, historicalPacket) : undefined;
  const historicalTrace = historicalDeviceId && historicalState && historicalStep ? c.traceFor(historicalDeviceId, historicalState, historicalStep.id) : undefined;
  const historicalInterfaces = historicalDeviceId && historicalState && historicalStep ? c.interfacesFor(historicalDeviceId, historicalState, historicalStep.id) : undefined;

  // Everything drawn on the topology reads the SHOWN state/packet — a historical selection never mixes in live state.
  const shownState = historicalState ?? state;
  const shownStepId = historicalStep?.id ?? stepId;
  const shownPacket: PacketVisual | undefined = historicalCursor !== undefined ? historicalPacket : activePacket;
  const nodes = c.nodes(shownState);
  const edges = c.edges(shownState).map((e) => ({ ...e, state: e.down ? ("down" as const) : ("full" as const) }));
  const copies = c.floodCopies?.(shownState, shownStepId) ?? [];

  const nodes3D = layoutTo3D(nodes).map((n) => {
    let status: Node3DStatus = "idle";
    if (n.id === selectedNodeId || n.id === enteredDeviceId) status = "selected";
    else if (shownPacket && (n.id === shownPacket.from || n.id === shownPacket.to)) status = "active";
    else if (copies.some((cp) => cp.fromId === n.id || cp.toId === n.id)) status = "active";
    return { ...n, status, badges: c.nodeBadges?.(n.id, shownState) };
  });
  const regions3D = layoutRegionsTo3D(c.regions ?? []);
  const links3D: Link3DData[] = edges.map((e) => ({ id: e.id, a: e.a, b: e.b, label: e.label, active: shownPacket ? (e.a === shownPacket.from && e.b === shownPacket.to) || (e.b === shownPacket.from && e.a === shownPacket.to) : false, onPath: false }));
  const shownPacket3D: ActivePacket3D | undefined = shownPacket && nodes3D.some((n) => n.id === shownPacket.from) && nodes3D.some((n) => n.id === shownPacket.to) ? { packet: shownPacket, fromId: shownPacket.from, toId: shownPacket.to, callout: c.callout(shownPacket, shownState) } : undefined;
  const floodCopies3D: FloodCopy3D[] | undefined = copies.length ? copies.map((cp) => ({ id: cp.id, fromId: cp.fromId, toId: cp.toId, callout: c.callout(cp.packet, shownState) })) : undefined;

  const questionActive = !isComplete && !!currentStep?.question && lastAnswer?.stepId !== currentStep.id;
  const isEnterable = (id: string | undefined): id is string => !!id && c.enterable.includes(id);
  const activeDeviceId = c.enterable.find((d) => c.traceFor(d, state, stepId).activeStageId !== undefined);
  const effectiveDeviceId = cameraMode === "device" ? enteredDeviceId : cameraMode === "packetFollow" ? activeDeviceId : undefined;
  const inDeviceMode = !!effectiveDeviceId;
  const deviceTrace = effectiveDeviceId ? c.traceFor(effectiveDeviceId, state, stepId) : undefined;
  const deviceInterfaces = effectiveDeviceId ? c.interfacesFor(effectiveDeviceId, state, stepId) : [];
  const devicePacketFrames = effectiveDeviceId ? (deviceTrace?.packetBeforeFrames ?? framesFromPacket(activePacket)) : undefined;

  const selectedNode3D = nodes3D.find((n) => n.id === selectedNodeId);
  const followNode3D = cameraMode === "packetFollow" && activePacket ? nodes3D.find((n) => n.id === activePacket.to) : undefined;
  const focusPosition3D: [number, number, number] | undefined = cameraMode === "freeOrbit" ? undefined : inDeviceMode ? [0, 0, deviceXray ? -0.2 : 0] : cameraMode === "packetFollow" ? followNode3D?.position : selectedNode3D?.position;
  const eyeOffset3D: [number, number, number] | undefined = inDeviceMode ? (deviceXray ? [0.6, 2.6, 5.2] : [2.1, 1.5, 3.8]) : undefined;

  const explainTargetId = effectiveDeviceId ?? selectedNodeId;
  const nodeExplanation = explainTargetId ? c.explainNode(state, explainTargetId, stepId) : undefined;
  const xrayPacket = activePacket && (selectedNodeId === activePacket.from || selectedNodeId === activePacket.to) ? activePacket : undefined;

  const focusInspectDeviceId = selectedNodeId ?? effectiveDeviceId ?? actorAt(state, stepId, activePacket);
  const focusTrace = focusInspectDeviceId ? c.traceFor(focusInspectDeviceId, state, stepId) : undefined;
  const focusInterfaces = focusInspectDeviceId ? c.interfacesFor(focusInspectDeviceId, state, stepId) : undefined;

  const journeyHopEntries = c.steps.map((s, i) => ({ s, i })).filter(({ s, i }) => i <= index && (!!s.packet || c.primaryDevice[s.id] !== undefined)).map(({ s, i }) => ({ id: s.id, label: s.label, index: i }));
  const historicalTimelinePos = historicalCursor !== undefined ? journeyHopEntries.findIndex((h) => h.index === historicalCursor) : -1;

  const briefing = currentStep ? resolveBriefing(currentStep.id, currentStep.label, c.briefing.phases, c.briefing.notes) : undefined;
  const actionPending = !isComplete && !questionActive && !!currentStep?.requiresState && !canAdvance;
  const showDiagnostics = index >= c.steps.findIndex((s) => s.id === c.diagnostics.fromStepId);
  const attempt = c.repair.attempt(state);

  useEffect(() => {
    if (isComplete) completeLesson(c.lessonId, c.xp);
  }, [isComplete, completeLesson, c.lessonId, c.xp]);

  useEffect(() => {
    if (!autoPlay || !canAdvance || isComplete) return;
    const t = setTimeout(() => engine.advance(), 2200 / speed);
    return () => clearTimeout(t);
  }, [autoPlay, canAdvance, isComplete, index, engine, speed]);

  const handleAnswer = (optionId: string) => {
    engine.answer(optionId);
    if (currentStep?.question) recordAnswer(optionId === currentStep.question.correctOptionId);
  };

  function handleViewModeChange(v: "physical" | "3d") {
    setViewMode(v);
    if (v !== "3d") {
      setCameraMode("overview");
      setEnteredDeviceId(undefined);
    }
  }
  function handleCameraModeChange(v: CameraMode) {
    setCameraMode(v);
    if (v === "device" && !enteredDeviceId) setEnteredDeviceId(isEnterable(selectedNodeId) ? selectedNodeId : (activeDeviceId ?? c.enterable[0]));
    if (v === "overview") {
      setEnteredDeviceId(undefined);
      setSelectedNodeId(undefined);
    }
    if (v === "freeOrbit") setEnteredDeviceId(undefined);
  }
  function handleToggleAutoPlay() {
    if (!autoPlay) {
      setHistoricalIndex(undefined);
      setInspectorSurface("hop");
    }
    setAutoPlay((v) => !v);
  }
  const handleRestart = () => {
    setAutoPlay(false);
    engine.restart();
    setCameraMode("overview");
    setEnteredDeviceId(undefined);
    setSelectedNodeId(undefined);
    setPacketSelected(false);
    setHistoricalIndex(undefined);
    setInspectorSurface("hop");
  };
  const selectNode = (id: string) => {
    setSelectedNodeId(id);
    setPacketSelected(false);
    setInspectorSurface("device");
    setHistoricalIndex(undefined);
  };

  const explorerTabsFor = (device: string): DeviceExplorerTab[] => {
    if (!nodeExplanation) return [];
    const tables = c.tablesFor(device, state);
    return [
      { id: "overview", label: "Overview", content: <OverviewTab explanation={nodeExplanation} /> },
      { id: "interfaces", label: "Interfaces", content: <InterfaceListTab interfaces={deviceInterfaces} selectedInterfaceId={selectedInterfaceId} onSelectInterface={setSelectedInterfaceId} /> },
      ...tables.map((t) => ({ id: `t-${t.title}`, label: t.title, content: <KeyValueTab rows={t.rows} /> })),
      { id: "packet", label: "Packet", content: activePacket && (activePacket.from === device || activePacket.to === device) ? <PacketInspector packet={activePacket} /> : <p className="text-xs text-pv-text-faint">No packet at this device right now.</p> },
    ];
  };

  const graph2D = (focus?: boolean) => (
    <div className={focus ? "relative h-full overflow-hidden [&>div]:!h-full [&>div]:rounded-none [&>div]:border-0" : "relative"}>
      <GraphTopologyViewer nodes={nodes} edges={edges} activeNodeIds={shownPacket ? [shownPacket.from, shownPacket.to] : []} regions={c.regions ?? []} onNodeClick={selectNode}>
        {shownPacket &&
          (() => {
            const pkt = shownPacket;
            const from = nodes.find((n) => n.id === pkt.from);
            const to = nodes.find((n) => n.id === pkt.to);
            if (!from || !to) return null;
            const cc = c.callout(pkt, shownState);
            return <GraphPacketBubble packet={bubblePacket(pkt, cc)} from={from} to={to} title={cc.title} scope={`${pkt.from} → ${pkt.to}`} onSelect={() => setPacketSelected(true)} />;
          })()}
        {/* Phone width: copies keep their moving dots in 3D, but in 2D only the main bubble (whose text lists every flood port) is labelled. */}
        {(narrow ? [] : copies)
          .filter((cp) => !(shownPacket && cp.fromId === shownPacket.from && cp.toId === shownPacket.to))
          .map((cp) => {
            const from = nodes.find((n) => n.id === cp.fromId);
            const to = nodes.find((n) => n.id === cp.toId);
            if (!from || !to) return null;
            const cc = c.callout(cp.packet, shownState);
            return <GraphPacketBubble key={cp.id} compact packet={bubblePacket(cp.packet, cc)} from={from} to={to} title={cc.title} />;
          })}
      </GraphTopologyViewer>
    </div>
  );

  const scene = (focus: boolean) => (
    <NetworkScene3D
      nodes={nodes3D}
      links={links3D}
      regions={regions3D}
      activePacket={inDeviceMode ? undefined : shownPacket3D}
      floodCopies={inDeviceMode ? undefined : floodCopies3D}
      onSelectNode={selectNode}
      onSelectPacket={() => {
        setPacketSelected(true);
        if (!focus) setAutoPlay(false);
      }}
      packetSelected={packetSelected}
      focusPosition={focusPosition3D}
      eyeOffset={eyeOffset3D}
      mode={inDeviceMode ? "device" : "overview"}
      deviceView={
        inDeviceMode && effectiveDeviceId
          ? {
              deviceLabel: effectiveDeviceId,
              interfaces: deviceInterfaces,
              xray: deviceXray,
              trace: deviceTrace,
              packetFrames: devicePacketFrames,
              onSelectInterface: setSelectedInterfaceId,
              selectedInterfaceId,
              onSelectPacket: () => setPacketSelected(true),
              packetSelected,
              pipelineTitle: c.pipelineTitle(effectiveDeviceId),
            }
          : undefined
      }
    />
  );

  const cameraSwitcher = (
    <TopologyModeSwitcher options={[{ value: "overview", label: "Overview" }, { value: "device", label: "Device" }, { value: "packetFollow", label: "Packet Follow" }, { value: "freeOrbit", label: "Free Orbit" }]} value={cameraMode} onChange={handleCameraModeChange} />
  );
  const nextLabel = currentStep?.question && !lastAnswer ? "Answer to continue" : currentStep?.requiresState && !canAdvance ? "Apply the correct fix to continue" : "Next Step →";
  const repairPanel = <RepairChallenge prompt={c.repair.prompt} options={c.repair.options} correctId={c.repair.correctId} success={c.repair.success} wrongFeedback={c.repair.wrongFeedback} attempt={attempt} onTry={(choice) => engine.act({ choice })} />;
  const historicalBanner = (
    <div className="flex items-center justify-between rounded-lg border border-pv-violet/40 bg-pv-violet/10 px-3 py-2">
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 shrink-0 rounded-full bg-pv-violet" />
        <span className="text-[11px] font-semibold uppercase tracking-wide text-pv-violet">Historical — {historicalStep?.label}</span>
      </div>
      <button type="button" onClick={() => setHistoricalIndex(undefined)} className="text-[11px] font-semibold uppercase tracking-wide text-pv-text-faint transition-colors hover:text-pv-cyan-soft">
        Return to Current →
      </button>
    </div>
  );

  return (
    <div className="mx-auto max-w-7xl px-6 py-10">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <Badge tone="cyan" className="mb-3">
            {c.badge}
          </Badge>
          <h1 className="text-2xl font-semibold text-pv-text sm:text-3xl">{c.title}</h1>
          <p className="mt-2 max-w-3xl text-sm text-pv-text-muted">{c.intro}</p>
        </div>
        <LessonGuideButton onClick={() => setGuideOpen(true)} />
        <LessonGuideDialog open={guideOpen} onClose={() => setGuideOpen(false)} title={c.guide.title} subtitle={c.guide.subtitle} tabs={c.guide.tabs} />
      </div>

      <div className="mb-4 grid gap-2 sm:grid-cols-4">
        {c.facts.map((item) => (
          <GlassPanel key={item.q} className="p-3">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-pv-cyan-soft">{item.q}</p>
            <p className="text-[11px] leading-snug text-pv-text-muted">{item.a}</p>
          </GlassPanel>
        ))}
      </div>

      <div className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-5">
        {c.terms.map((t) => (
          <GlassPanel key={t.term} className="p-2.5" title={t.meaning}>
            <p className="pv-mono text-xs font-bold text-pv-text">{t.term}</p>
            <p className="text-[10px] text-pv-text-faint">{t.expansion}</p>
          </GlassPanel>
        ))}
      </div>

      <div className="mb-4 flex gap-1 overflow-x-auto pb-2">
        {c.steps.map((step, i) => (
          <button key={step.id} type="button" disabled={i > index} onClick={() => i < index && engine.goTo(i)} title={step.label} className={clsx("h-1.5 min-w-3 flex-1 rounded-full transition-colors", i < index ? "cursor-pointer bg-pv-success/70 hover:bg-pv-success" : i === index ? "bg-pv-cyan" : "bg-white/10")} />
        ))}
      </div>

      <div className="mb-6 flex flex-wrap gap-3">
        <TopologyModeSwitcher options={[{ value: "physical", label: "2D Topology" }, { value: "3d", label: "3D View" }]} value={viewMode} onChange={handleViewModeChange} />
        {viewMode === "3d" && (
          <>
            {cameraSwitcher}
            {inDeviceMode && <TopologyModeSwitcher options={[{ value: "off", label: "Exterior" }, { value: "on", label: "X-Ray" }]} value={deviceXray ? "on" : "off"} onChange={(v) => setDeviceXray(v === "on")} tone="violet" />}
          </>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_400px]">
        <div className="min-w-0 space-y-6">
          <TopologyFrame questionActive={questionActive} onExpand={() => setFocusMode(true)}>
            {focusMode ? <div className="h-96 w-full rounded-2xl border border-pv-border bg-pv-bg-elevated sm:h-[28rem]" /> : viewMode === "3d" ? scene(false) : graph2D()}
          </TopologyFrame>

          {historicalCursor !== undefined && historicalBanner}

          {inDeviceMode && effectiveDeviceId && nodeExplanation ? (
            <DeviceExplorerPanel explanation={nodeExplanation} tabs={explorerTabsFor(effectiveDeviceId)} xrayEnabled={deviceXray} onToggleXray={() => setDeviceXray((v) => !v)} onExit={() => { setCameraMode("overview"); setEnteredDeviceId(undefined); }} />
          ) : (
            nodeExplanation && (
              <NodeInspectorPanel explanation={nodeExplanation} packet={xrayPacket} xrayEnabled>
                {isEnterable(selectedNodeId) && viewMode === "3d" && (
                  <Button size="sm" onClick={() => { setEnteredDeviceId(selectedNodeId); setCameraMode("device"); }}>
                    Enter Device →
                  </Button>
                )}
              </NodeInspectorPanel>
            )
          )}

          {!isComplete && currentStep && briefing && (
            <MissionBriefingCard stepNumber={index + 1} totalSteps={totalSteps} title={currentStep.label} phase={briefing.phase} objective={briefing.objective} context={currentStep.narrative} doingNow={briefing.doingNow} takeaway={briefing.takeaway} questionPending={questionActive} />
          )}

          {!isComplete && currentStep?.question && <PredictionQuestion question={currentStep.question} selectedOptionId={lastAnswer?.stepId === currentStep.id ? lastAnswer.optionId : undefined} onAnswer={handleAnswer} />}
          {!isComplete && currentStep?.id === c.repair.stepId && repairPanel}

          {whatChanged.length > 0 && !currentStep?.question && currentStep?.id !== c.repair.stepId && (
            <GlassPanel className="p-5">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-pv-cyan-soft">What changed?</h3>
              <ul className="space-y-1.5">
                {whatChanged.map((w) => (
                  <li key={w} className="flex gap-2 text-xs text-pv-text-muted">
                    <span className="text-pv-success">✓</span>
                    {w}
                  </li>
                ))}
              </ul>
            </GlassPanel>
          )}

          {!isComplete && c.panels?.(state, currentStep?.id)}

          {showDiagnostics && !isComplete && <TroubleshootingLayers title="Troubleshooting Layers" layers={c.diagnostics.layers(state)} />}

          {isComplete && (
            <GlassPanel strong glow="success" className="flex flex-col items-center gap-4 p-10 text-center">
              <Badge tone="success">{c.complete.badge}</Badge>
              <h2 className="text-2xl font-semibold text-pv-text">{c.complete.title}</h2>
              <p className="max-w-md text-sm text-pv-text-muted">
                {c.complete.message} +{c.xp} XP awarded.
              </p>
              <div className="flex gap-3">
                <Button onClick={handleRestart} variant="secondary">
                  Restart Lesson
                </Button>
                <Link href="/learn">
                  <Button>Back To Lessons</Button>
                </Link>
              </div>
            </GlassPanel>
          )}

          {!isComplete && (
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="secondary" size="sm" onClick={() => engine.goTo(Math.max(0, index - 1))} disabled={index === 0}>
                ← Previous
              </Button>
              <Button size="sm" onClick={() => engine.advance()} disabled={!canAdvance}>
                {nextLabel}
              </Button>
              <Button variant={autoPlay ? "primary" : "ghost"} size="sm" onClick={handleToggleAutoPlay}>
                {autoPlay ? "⏸ Auto-Playing" : "▶ Auto-Play"}
              </Button>
              <Button variant="ghost" size="sm" onClick={handleRestart}>
                ⟲ Restart
              </Button>
            </div>
          )}
        </div>

        <div className="min-w-0 space-y-4">
          <PacketInspector packet={shownPacket} />
          {c.sidePanel?.(shownState)}
          <PacketJourneyTimeline hops={shownState.hops.map((h) => ({ router: h.device, action: h.action, output: h.output }))} />
        </div>
      </div>

      {focusMode && (
        <TopologyFocusMode
          onClose={() => setFocusMode(false)}
          toolbar={
            <>
              <LessonGuideButton compact onClick={() => setGuideOpen(true)} />
              <TopologyModeSwitcher options={[{ value: "3d", label: "3D" }, { value: "2d", label: "2D" }]} value={viewMode === "3d" ? "3d" : "2d"} onChange={(v) => handleViewModeChange(v === "3d" ? "3d" : "physical")} />
              {viewMode === "3d" && (
                <>
                  {cameraSwitcher}
                  {inDeviceMode && <TopologyModeSwitcher options={[{ value: "off", label: "Exterior" }, { value: "on", label: "X-Ray" }]} value={deviceXray ? "on" : "off"} onChange={(v) => setDeviceXray(v === "on")} tone="violet" />}
                </>
              )}
            </>
          }
          header={
            !isComplete && currentStep && briefing ? (
              <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                <MissionBriefingStrip stepNumber={index + 1} totalSteps={totalSteps} title={currentStep.label} phase={briefing.phase} objective={briefing.objective} questionPending={questionActive} />
                {actionPending && <span className="shrink-0 rounded-full border border-pv-warning/40 bg-pv-warning/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-pv-warning">Repair pending — apply it in the panel to continue</span>}
              </div>
            ) : (
              <span className="text-xs font-semibold text-pv-success">Lesson complete</span>
            )
          }
          canvas={viewMode !== "3d" ? graph2D(true) : <div className="h-full [&>div]:h-full [&>div]:rounded-none [&>div]:border-0">{scene(true)}</div>}
          inspector={
            currentStep?.question ? (
              <>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-pv-cyan-soft">Current Prediction</p>
                <PredictionQuestion question={currentStep.question} selectedOptionId={lastAnswer?.stepId === currentStep.id ? lastAnswer.optionId : undefined} onAnswer={handleAnswer} />
              </>
            ) : currentStep?.id === c.repair.stepId ? (
              repairPanel
            ) : inspectorSurface === "device" && historicalCursor === undefined ? (
              inDeviceMode && effectiveDeviceId && nodeExplanation ? (
                <div className="space-y-3">
                  <TopologyModeSwitcher options={[{ value: "hop", label: "Hop" }, { value: "device", label: "Device" }]} value={inspectorSurface} onChange={setInspectorSurface} tone="violet" />
                  <DeviceExplorerPanel explanation={nodeExplanation} tabs={explorerTabsFor(effectiveDeviceId)} xrayEnabled={deviceXray} onToggleXray={() => setDeviceXray((v) => !v)} onExit={() => { setCameraMode("overview"); setEnteredDeviceId(undefined); }} />
                </div>
              ) : nodeExplanation ? (
                <NodeInspectorPanel explanation={nodeExplanation} packet={xrayPacket} xrayEnabled />
              ) : (
                <GlassPanel className="p-4">
                  <p className="text-xs text-pv-text-faint">Select a device, or advance the lesson, to inspect a hop.</p>
                </GlassPanel>
              )
            ) : historicalCursor !== undefined && historicalTrace ? (
              <div className="space-y-3">
                {historicalBanner}
                <HopInspectorPanel trace={historicalTrace} deviceName={historicalDeviceId ?? "—"} interfaces={historicalInterfaces} />
                <PacketDiffViewer before={historicalTrace.packetBeforeFrames} after={historicalTrace.packetAfterFrames} beforeText={historicalTrace.packetBefore} afterText={historicalTrace.packetAfter} mutations={historicalTrace.mutations} />
              </div>
            ) : historicalCursor !== undefined ? (
              <div className="space-y-3">{historicalBanner}</div>
            ) : focusTrace && focusInspectDeviceId ? (
              <div className="space-y-3">
                {inDeviceMode && <TopologyModeSwitcher options={[{ value: "hop", label: "Hop" }, { value: "device", label: "Device" }]} value={inspectorSurface} onChange={setInspectorSurface} tone="violet" />}
                <HopInspectorPanel trace={focusTrace} deviceName={focusInspectDeviceId} interfaces={focusInterfaces} onFocusNextHop={(id) => { setSelectedNodeId(id); setInspectorSurface("hop"); }} />
                <PacketDiffViewer before={focusTrace.packetBeforeFrames} after={focusTrace.packetAfterFrames} beforeText={focusTrace.packetBefore} afterText={focusTrace.packetAfter} mutations={focusTrace.mutations} />
              </div>
            ) : (
              <GlassPanel className="p-4">
                <p className="text-xs text-pv-text-faint">Select a device, or advance the lesson, to inspect a hop.</p>
              </GlassPanel>
            )
          }
          timeline={
            <div className="space-y-2">
              <HopTimeline
                hops={journeyHopEntries}
                currentIndex={historicalTimelinePos >= 0 ? historicalTimelinePos : journeyHopEntries.length - 1}
                onSelectHop={(i) => {
                  const entry = journeyHopEntries[i];
                  if (!entry) return;
                  setInspectorSurface("hop");
                  if (entry.index === index) {
                    setHistoricalIndex(undefined);
                    return;
                  }
                  setHistoricalIndex(entry.index);
                  setSelectedNodeId(undefined);
                }}
              />
              <PacketFlowControls
                playing={autoPlay}
                onTogglePlay={handleToggleAutoPlay}
                onPrevHop={() => {
                  setHistoricalIndex(undefined);
                  setInspectorSurface("hop");
                  engine.goTo(Math.max(0, index - 1));
                }}
                onNextHop={() => {
                  setHistoricalIndex(undefined);
                  setInspectorSurface("hop");
                  engine.advance();
                }}
                onReset={handleRestart}
                canPrevHop={index > 0}
                canNextHop={canAdvance}
                speed={speed as PlaySpeed}
                onSpeedChange={setSpeed}
                followPacket={cameraMode === "packetFollow"}
                onToggleFollowPacket={() => handleCameraModeChange(cameraMode === "packetFollow" ? "overview" : "packetFollow")}
                view3D={viewMode === "3d"}
                onToggleView3D={() => handleViewModeChange(viewMode === "3d" ? "physical" : "3d")}
              />
            </div>
          }
        />
      )}
    </div>
  );
}

function OverviewTab({ explanation }: { explanation: NodeExplanation }) {
  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-pv-cyan/30 bg-pv-cyan/5 p-3">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-pv-cyan-soft">Current Action</p>
        <p className="text-sm text-pv-text">{explanation.currentAction}</p>
      </div>
      {explanation.controlPlaneRole && <p className="text-xs text-pv-text-muted">{explanation.controlPlaneRole}</p>}
      {explanation.dataPlaneRole && <p className="text-xs text-pv-text-muted">{explanation.dataPlaneRole}</p>}
      {explanation.note && <p className="rounded-lg border border-pv-warning/30 bg-pv-warning/5 p-2.5 text-xs text-pv-text-muted">{explanation.note}</p>}
    </div>
  );
}

function KeyValueTab({ rows }: { rows: { label: string; value: string }[] }) {
  return (
    <div className="space-y-0.5 rounded-lg border border-pv-border p-2.5 pv-mono text-[11px]">
      {rows.length === 0 ? (
        <p className="text-pv-text-faint">EMPTY</p>
      ) : (
        rows.map((r, i) => (
          <div key={`${r.label}-${i}`} className="flex justify-between gap-3">
            <span className="text-pv-text-faint">{r.label}</span>
            <span className="break-all text-right text-pv-text">{r.value}</span>
          </div>
        ))
      )}
    </div>
  );
}

function RepairChallenge({ prompt, options, correctId, success, wrongFeedback, attempt, onTry }: { prompt: string; options: { id: string; label: string }[]; correctId: string; success: string; wrongFeedback: Record<string, string>; attempt?: { choice: string; correct: boolean }; onTry: (choice: string) => void }) {
  return (
    <GlassPanel strong className="p-5">
      <p className="mb-3 text-sm font-medium text-pv-text">{prompt}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((opt) => {
          const isSelected = attempt?.choice === opt.id;
          const isCorrect = opt.id === correctId;
          return (
            <button key={opt.id} type="button" onClick={() => onTry(opt.id)} className={clsx("cursor-pointer rounded-xl border px-4 py-3 text-left text-sm transition-colors", isSelected && isCorrect && "border-pv-success/50 bg-pv-success/10 text-pv-success", isSelected && !isCorrect && "border-pv-danger/50 bg-pv-danger/10 text-pv-danger", !isSelected && "border-pv-border hover:border-pv-cyan/40 hover:bg-pv-cyan/5")}>
              {opt.label}
            </button>
          );
        })}
      </div>
      {attempt && (
        <div className={clsx("mt-4 rounded-xl border p-4 text-sm", attempt.correct ? "border-pv-success/50 bg-pv-success/10 text-pv-success" : "border-pv-warning/40 bg-pv-warning/5 text-pv-text-muted")}>
          {attempt.correct ? (
            <span className="font-semibold">✓ {success}</span>
          ) : (
            <>
              <span className="mb-1 block font-semibold text-pv-text">That doesn&apos;t fix it.</span>
              {wrongFeedback[attempt.choice] ?? "Try again."}
            </>
          )}
        </div>
      )}
    </GlassPanel>
  );
}
