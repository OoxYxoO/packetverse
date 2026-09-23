"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { clsx } from "clsx";
import { useScenarioEngine } from "@/lib/sim-engine/useScenarioEngine";
import {
  ALL_ROUTERS,
  buildMultiSidIllustration,
  buildSrv6TiLfaCliCommands,
  createSrv6TiLfaState,
  GRAPH_EDGES,
  GRAPH_NODES,
  INFRA_ADDRESS_TEXT,
  PROTECTED_LINK,
  PROTECTED_NODE,
  computePreConvergenceFib,
  srv6TiLfaSteps,
  validateRepairPath,
  type RouterId,
  type Srv6TiLfaState,
  type TiLfaRepairPath,
} from "@/lib/sim-engine/scenarios/srv6TiLfa";
import { GraphTopologyViewer } from "@/components/network/GraphTopologyViewer";
import { GraphPacket } from "@/components/network/GraphPacket";
import { PacketInspector } from "@/components/network/PacketInspector";
import { PacketJourneyTimeline } from "@/components/protocol/PacketJourneyTimeline";
import { RepairSpaceViewer } from "@/components/protocol/RepairSpaceViewer";
import { RepairComputationViewer, type RepairComputationStage } from "@/components/protocol/RepairComputationViewer";
import { Srv6RepairListViewer } from "@/components/protocol/Srv6RepairListViewer";
import { RecoveryTimelineViewer, type RecoveryEvent } from "@/components/protocol/RecoveryTimelineViewer";
import { RouteEvolutionViewer, type RouteEvolutionField } from "@/components/protocol/RouteEvolutionViewer";
import { Srv6BehaviorExecutionViewer } from "@/components/protocol/Srv6BehaviorExecutionViewer";
import { TroubleshootingLayers, type DiagnosticLayer } from "@/components/protocol/TroubleshootingLayers";
import { CLIOutputPanel } from "@/components/protocol/CLIOutputPanel";
import { PredictionQuestion } from "@/components/quiz/PredictionQuestion";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { useProgressStore } from "@/lib/state/useProgressStore";
import { NetworkScene3D } from "@/components/network3d/NetworkScene3D";
import { NodeInspectorPanel } from "@/components/network3d/NodeInspectorPanel";
import { PacketFocusPanel } from "@/components/network3d/PacketFocusPanel";
import { TopologyModeSwitcher } from "@/components/network3d/TopologyModeSwitcher";
import { DeviceExplorerPanel, InterfaceListTab, type DeviceExplorerTab } from "@/components/network3d/DeviceExplorerPanel";
import { PacketDetailPanel } from "@/components/network3d/PacketDetailPanel";
import { LinkDetailPanel } from "@/components/network3d/LinkDetailPanel";
import { TopologyFrame } from "@/components/network3d/TopologyFrame";
import { TopologyFocusMode } from "@/components/network3d/TopologyFocusMode";
import { HopInspectorPanel } from "@/components/network3d/HopInspectorPanel";
import { PacketDiffViewer } from "@/components/network3d/PacketDiffViewer";
import { HopTimeline } from "@/components/network3d/HopTimeline";
import { PacketFlowControls, type PlaySpeed } from "@/components/network3d/PacketFlowControls";
import { ObjectFocusPanel } from "@/components/network3d/ObjectFocusPanel";
import { layoutTo3D } from "@/components/network3d/layout";
import type { ActivePacket3D, CameraMode, FocusTarget3D, InspectorSurface, Link3DData, Node3DStatus, PacketStackFrame } from "@/components/network3d/types";
import { explainNode } from "./explain";
import { PRIMARY_TRANSITION_ROUTER, deviceForStep, interfacesFor, linkDetailFor, packetFramesFor, traceFor } from "./deviceTrace";

const DEVICE_ROUTERS: RouterId[] = ["PE1", "P1", "P3", "P4", "P2", "PE2"];
type TopoView = "physical" | "preConvergence" | "repairSpaces" | "repairProgram" | "recovery";

const WHY_TI_LFA: { q: string; a: string }[] = [
  { q: "WHAT is TI-LFA?", a: "Local fast repair at the PLR using a precomputed outgoing interface + SRv6 repair program — activated instantly on local failure detection." },
  { q: "WHY not just wait?", a: "Every other router's FIB stays stale until it converges — sending traffic on its original destination can genuinely loop during that window." },
  { q: '"Topology Independent"?', a: "Still uses the full link-state topology. \"TI\" means the repair isn't limited to one adjacent backup next hop." },
  { q: "Permanent?", a: "No — TI-LFA is temporary. IGP convergence eventually takes over and the repair is released." },
];

const REPAIR_OPTIONS = [
  { id: "lower-metric", label: "Lower the P1-P3 IGP metric" },
  { id: "reinstall-same", label: "Reinstall the same P2 SID" },
  { id: "wait-converge", label: "Wait until every router converges" },
  { id: "recompute-correct", label: "Recompute the repair from the actual topology (P4 End.X+USD → P2)" },
];
const WRONG_FEEDBACK: Record<string, string> = {
  "lower-metric": "P1 already sends repair traffic to P3 — the outgoing interface was never the problem. The problem is what P3 does with the repair destination afterward.",
  "reinstall-same": "SID existence isn't the issue. The selected repair instruction simply doesn't encode a loop-free path through P3's stale FIB.",
  "wait-converge": "Eventual convergence may restore traffic, but that defeats the purpose of local FRR and leaves the precomputed repair permanently incorrect.",
};

/** Derives a close-but-non-clipping camera eye offset from a focused object's world-space bounding size (see sr-mpls-foundations for the same helper). */
function eyeOffsetForFocusTarget(target: FocusTarget3D): [number, number, number] {
  const [sx, sy, sz] = target.size ?? [0.6, 0.3, 0.3];
  const maxDim = Math.max(sx, sy, sz);
  const dist = Math.max(0.55, maxDim * 1.8);
  return [dist * 0.55, dist * 0.5, dist * 0.75];
}

const PRE_CONVERGENCE_STEPS = new Set(["p3-pre-failure-route", "predict-p3-route", "naive-fail-injected", "naive-forward-p1-p3", "naive-p3-stale-fib", "naive-loop-p3-p1", "predict-naive-loop", "naive-loop-explained"]);
const REPAIR_SPACES_STEPS = new Set(["p-space-intro", "p-space-compute", "extended-p-space-intro", "extended-p-space-compute", "q-space-intro", "q-space-compute", "select-repair-node", "node-protection-compute"]);
const REPAIR_PROGRAM_STEPS = new Set(["repair-anatomy-intro", "why-p4-endx", "globally-routed-adjacency", "usd-intro", "predict-usd", "repair-list-derive", "h-encaps-intro", "predict-no-srh", "protection-ready", "node-protection-repair-list"]);
const RECOVERY_STEPS = new Set(["phases-intro", "precompute-intro", "igp-converging", "plr-converged", "repair-released", "post-convergence-forwarding", "loop-free-recap"]);

export default function Srv6TiLfaDemo() {
  const { engine, snapshot } = useScenarioEngine<Srv6TiLfaState>(createSrv6TiLfaState(), srv6TiLfaSteps);
  const [autoPlay, setAutoPlay] = useState(false);
  const [speed, setSpeed] = useState<0.5 | 1 | 2>(1);
  const [topoView, setTopoView] = useState<TopoView>("physical");
  const [viewMode3D, setViewMode3D] = useState(false);
  const [focusRouter, setFocusRouter] = useState<RouterId>("P1");
  const [selectedNodeId, setSelectedNodeId] = useState<RouterId | undefined>(undefined);
  const [cameraMode, setCameraMode] = useState<CameraMode>("overview");
  const [enteredDeviceId, setEnteredDeviceId] = useState<RouterId | undefined>(undefined);
  const [deviceXray, setDeviceXray] = useState(true);
  const [autoEnterDevices, setAutoEnterDevices] = useState(true);
  const [selectedInterfaceId, setSelectedInterfaceId] = useState<string | undefined>(undefined);
  const [selectedLinkId, setSelectedLinkId] = useState<string | undefined>(undefined);
  const [packetSelected, setPacketSelected] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [focusedObject, setFocusedObject] = useState<FocusTarget3D | undefined>(undefined);
  /** Presentation cursor for HopTimeline inspection (ARCHITECTURE.md §18) — a step INDEX, never mutates the live lesson. undefined = inspecting the current/live hop. */
  const [historicalIndex, setHistoricalIndex] = useState<number | undefined>(undefined);
  /** Explicit Hop-vs-Device intent inside Focus Mode — set by the actual gesture, never inferred from whether a trace object happens to exist. */
  const [inspectorSurface, setInspectorSurface] = useState<InspectorSurface>("hop");
  const completeLesson = useProgressStore((s) => s.completeLesson);
  const recordAnswer = useProgressStore((s) => s.recordAnswer);
  const unlockAchievement = useProgressStore((s) => s.unlockAchievement);
  const awardedRef = useRef(false);

  const { state, currentStep, index, totalSteps, isComplete, lastAnswer, whatChanged, activePacket } = snapshot;
  const canAdvance = engine.canAdvance();

  const showRepairSpaces = index >= srv6TiLfaSteps.findIndex((s) => s.id === "p-space-intro");
  const showRepairProgram = index >= srv6TiLfaSteps.findIndex((s) => s.id === "repair-anatomy-intro");
  const showTroubleshoot = index >= srv6TiLfaSteps.findIndex((s) => s.id === "break-intro-ti-lfa");
  const showMultiSidLab = currentStep?.id === "multi-sid-example" || currentStep?.id === "no-fake-srh-contrast";
  const showBehaviorExecution = currentStep?.id === "p4-usd-decap";
  const nodeProtectionLabStart = srv6TiLfaSteps.findIndex((s) => s.id === "node-protection-intro");
  const nodeProtectionLabEnd = srv6TiLfaSteps.findIndex((s) => s.id === "srlg-preview");
  const inNodeProtectionLab = index >= nodeProtectionLabStart && index <= nodeProtectionLabEnd;
  const activeRepair: TiLfaRepairPath | undefined = state.activeMode === "NODE" || (inNodeProtectionLab && !!state.nodeRepair) ? (state.nodeRepair ?? state.linkRepair) : state.linkRepair;

  const nodes = GRAPH_NODES.map((n) => {
    if (topoView === "preConvergence" && (n.id === "P3" || n.id === "P4")) return { ...n, subLabel: state.failureKnownAt[n.id as RouterId] ? "converged" : "STALE FIB" };
    return n;
  });
  const edges = GRAPH_EDGES.map((e) => ({ ...e, state: state.failedLinkIds.includes(e.id) ? ("down" as const) : ("full" as const) }));
  const activeNodeIds = activePacket ? [activePacket.from, activePacket.to] : [];
  const packetFrom = activePacket ? nodes.find((n) => n.id === activePacket.from) : undefined;
  const packetTo = activePacket ? nodes.find((n) => n.id === activePacket.to) : undefined;

  const cliCommands = useMemo(() => buildSrv6TiLfaCliCommands(state, focusRouter), [state, focusRouter]);
  const lastHop = state.journey[state.journey.length - 1];
  const multiSid = useMemo(() => buildMultiSidIllustration(), []);

  const repairComputationStages: RepairComputationStage[] = activeRepair
    ? [
        { id: "resource", label: "Protected Resource", value: activeRepair.protectedResource, explanation: `${activeRepair.mode === "LINK" ? "Link" : "Node"} protection.` },
        { id: "post", label: "Post-Convergence Path", value: activeRepair.postConvergencePath?.join(" → ") ?? "—", explanation: `Cost ${activeRepair.postConvergenceCost ?? "—"} — real SPF with the resource removed.` },
        { id: "p", label: "P-Space", value: activeRepair.pSpace.join(", ") || "(empty)", explanation: "PLR's own pre-convergence shortest paths that avoid the resource." },
        { id: "extp", label: "Extended P-Space", value: activeRepair.extendedPSpace.join(", ") || "(empty)", explanation: "Widened via each eligible PLR-neighbor's own SPT." },
        { id: "q", label: "Q-Space", value: activeRepair.qSpace.join(", ") || "(empty)", explanation: "Nodes whose own pre-convergence path to the destination avoids the resource." },
        { id: "node", label: "Repair Node", value: activeRepair.repairNode ?? "none", explanation: "Last (extended) P-Space node on the post-convergence path." },
        { id: "rl", label: "Repair List", value: activeRepair.repairList.sids[0]?.sidText ?? "(none)", explanation: `Forced adjacency → ${activeRepair.mergeTarget ?? "none"}.` },
      ]
    : [];

  const recoveryEvents: RecoveryEvent[] = [
    { id: "steady", timeLabel: "T0", event: "Primary active, repair precomputed (READY)", status: "healthy" },
    { id: "fail", timeLabel: "T1", event: "P1-P2 fails — P1 detects locally", actor: "P1", status: "failure" },
    { id: "active", timeLabel: "T2", event: "TI-LFA repair activates", actor: "P1", path: "P1 → P3 → P4 → P2 → PE2", status: "repair" },
    { id: "converging", timeLabel: "T3", event: "IGP floods the failure; SPF recomputes network-wide", status: "info" },
    { id: "converged", timeLabel: "T4", event: "P1 itself converges", actor: "P1", status: "info" },
    { id: "released", timeLabel: "T5", event: "Repair released — ordinary post-convergence forwarding resumes", path: "P1 → P3 → P4 → P2 → PE2", status: "healthy" },
  ];

  const staleFibFields: RouteEvolutionField[] = ALL_ROUTERS.filter((r) => r !== "PE1" && r !== "PE2").map((r) => {
    const preFailure = computePreConvergenceFib(r, "PE2", state.links, "LINK", PROTECTED_LINK, false);
    const current = computePreConvergenceFib(r, "PE2", state.links, "LINK", PROTECTED_LINK, !!state.failureKnownAt[r]);
    return { label: r, oldValue: String(preFailure.nextHop ?? "—"), newValue: current.knowsFailure ? String(current.nextHop ?? "—") : `${current.nextHop ?? "—"} (stale — unchanged)`, decisive: current.knowsFailure };
  });

  const readiness = activeRepair ? validateRepairPath(activeRepair, state.links) : undefined;

  // --- 3D derived state ---
  const nodes3DBase = useMemo(() => layoutTo3D(GRAPH_NODES), []);
  const visitedRouters = new Set(state.journey.map((h) => h.router));
  const nodes3D = nodes3DBase.map((n) => {
    let status: Node3DStatus = "idle";
    if (n.id === selectedNodeId || n.id === enteredDeviceId) status = "selected";
    else if (activePacket && (n.id === activePacket.from || n.id === activePacket.to)) status = "active";
    else if (visitedRouters.has(n.id as RouterId)) status = "onPath";
    const badges = n.id === "P1" ? ["PLR"] : n.id === "P2" && state.failedLinkIds.includes(PROTECTED_LINK) ? ["LINK DOWN"] : n.id === "P4" ? ["REPAIR NODE"] : undefined;
    return { ...n, status, badges };
  });
  const links3D: Link3DData[] = GRAPH_EDGES.map((e) => ({
    ...e,
    active: activePacket ? (e.a === activePacket.from && e.b === activePacket.to) || (e.b === activePacket.from && e.a === activePacket.to) : false,
    onPath: visitedRouters.has(e.a as RouterId) && visitedRouters.has(e.b as RouterId),
  }));
  const activePacket3D: ActivePacket3D | undefined = activePacket && nodes3D.some((n) => n.id === activePacket.from) && nodes3D.some((n) => n.id === activePacket.to) ? { packet: activePacket, fromId: activePacket.from, toId: activePacket.to } : undefined;
  const selectedNode3D = nodes3D.find((n) => n.id === selectedNodeId);
  const questionActive = !isComplete && !!currentStep?.question && lastAnswer?.stepId !== currentStep.id;

  const activeDeviceId = DEVICE_ROUTERS.find((r) => traceFor(r, state, currentStep?.id ?? "")?.activeStageId !== undefined);
  const effectiveDeviceId = cameraMode === "device" ? enteredDeviceId : cameraMode === "packetFollow" && autoEnterDevices ? activeDeviceId : undefined;
  const inDeviceMode = !!effectiveDeviceId;
  const deviceTrace = effectiveDeviceId ? traceFor(effectiveDeviceId, state, currentStep?.id ?? "") : undefined;

  const followPacketIntoCurrentDevice = () => {
    if (!packetSelected || cameraMode !== "device") return;
    const snap = engine.getSnapshot();
    const nextDevice = DEVICE_ROUTERS.find((r) => traceFor(r, snap.state, snap.currentStep?.id ?? "")?.activeStageId !== undefined);
    if (nextDevice) setEnteredDeviceId(nextDevice);
  };

  const deviceInterfaces = effectiveDeviceId ? interfacesFor(effectiveDeviceId, state, currentStep?.id ?? "") : [];
  const devicePacketFrames: PacketStackFrame[] | undefined = effectiveDeviceId ? packetFramesFor(state, deviceTrace?.activeStageId) : undefined;

  // --- Generic 3D object-focus sub-state — layered ON TOP of `cameraMode`, never a 5th camera mode.
  const focusedObjectStillValid =
    focusedObject &&
    (focusedObject.kind === "stage"
      ? deviceTrace?.stages.some((s) => s.id === focusedObject.id)
      : focusedObject.kind === "packetLayer"
        ? devicePacketFrames?.some((f) => f.id === focusedObject.id)
        : focusedObject.kind === "interface"
          ? deviceInterfaces.some((i) => i.id === focusedObject.id)
          : true);
  const activeFocusedObject = focusedObjectStillValid ? focusedObject : undefined;

  const followNode3D = cameraMode === "packetFollow" && activePacket ? nodes3D.find((n) => n.id === (state.packetAt ?? activePacket.to)) : selectedNode3D;
  const focusPosition3D: [number, number, number] | undefined = activeFocusedObject
    ? activeFocusedObject.position
    : cameraMode === "freeOrbit"
      ? undefined
      : inDeviceMode
        ? [0, 0, deviceXray ? -0.2 : 0]
        : cameraMode === "packetFollow"
          ? followNode3D?.position
          : selectedNode3D?.position;
  const eyeOffset3D: [number, number, number] | undefined = activeFocusedObject ? eyeOffsetForFocusTarget(activeFocusedObject) : inDeviceMode ? (deviceXray ? [0.6, 2.6, 5.2] : [2.1, 1.5, 3.8]) : undefined;

  const explainTargetId = effectiveDeviceId ?? selectedNodeId ?? followNode3D?.id;
  const nodeExplanation = explainTargetId ? explainNode(state, explainTargetId as RouterId) : undefined;
  const xrayPacket = activePacket && (selectedNodeId === activePacket.from || selectedNodeId === activePacket.to) ? activePacket : undefined;
  const selectedLinkDetail = selectedLinkId ? linkDetailFor(selectedLinkId, state) : undefined;
  const packetCurrentDeviceLabel = effectiveDeviceId ?? state.packetAt ?? activePacket?.from ?? "—";
  const devicePacketForTab = xrayPacket ?? (effectiveDeviceId && state.packetAt === effectiveDeviceId ? activePacket : undefined);

  // --- Hop Inspector target — explicit selection wins outright: selectedNodeId > effectiveDeviceId > activeDeviceId.
  const focusInspectDeviceId = (selectedNodeId ?? effectiveDeviceId ?? activeDeviceId) as RouterId | undefined;
  const focusTrace = focusInspectDeviceId ? traceFor(focusInspectDeviceId, state, currentStep?.id ?? "") : undefined;
  const focusInterfaces = focusInspectDeviceId ? interfacesFor(focusInspectDeviceId, state, currentStep?.id ?? "") : undefined;

  // --- HopTimeline data — every step that either carries a packet or is a no-packet control-plane/computation step tracked in PRIMARY_TRANSITION_ROUTER.
  const journeyStepIndices = srv6TiLfaSteps.map((s, i) => ({ s, i })).filter(({ s, i }) => i <= index && (!!s.packet || PRIMARY_TRANSITION_ROUTER[s.id] !== undefined));
  const journeyHopEntries = journeyStepIndices.map(({ s, i }) => ({ id: s.id, label: s.label, index: i }));

  // --- Historical-cursor invariant (ARCHITECTURE.md §18) — inspection is only
  // meaningful for a step strictly EARLIER than the live one. Once any live
  // navigation (Previous, progress bar, Step Back, …) reaches or passes the
  // selected step, historical mode ends. The stored cursor is cleared during
  // render (React's "adjust state on prop change" pattern) so it can't
  // resurrect when the lesson later moves forward again; `historicalCursor`
  // is the only value the rest of the page reads.
  if (historicalIndex !== undefined && historicalIndex >= index) setHistoricalIndex(undefined);
  const historicalCursor = historicalIndex !== undefined && historicalIndex < index ? historicalIndex : undefined;
  // Chip position of a valid historical selection; -1 falls back to the live entry, never to "no current chip".
  const historicalTimelinePos = historicalCursor !== undefined ? journeyHopEntries.findIndex((h) => h.index === historicalCursor) : -1;

  // --- Historical (timeline) inspection — reuses ScenarioEngine's OWN `stateByIndex` snapshot (exposed via `getStateAt`). Presentation-only — never calls `engine.goTo()`.
  const historicalState = historicalCursor !== undefined ? engine.getStateAt(historicalCursor) : undefined;
  const historicalStep = historicalCursor !== undefined ? srv6TiLfaSteps[historicalCursor] : undefined;
  const historicalPacket = historicalStep && historicalState ? historicalStep.packet?.(historicalState) : undefined;
  const historicalDeviceId = historicalStep && historicalState ? deviceForStep(historicalStep.id, historicalPacket) : undefined;
  const historicalTrace = historicalDeviceId && historicalState ? traceFor(historicalDeviceId, historicalState, historicalStep!.id) : undefined;
  const historicalInterfaces = historicalDeviceId && historicalState ? interfacesFor(historicalDeviceId, historicalState, historicalStep!.id) : undefined;

  /** Detail shown in <ObjectFocusPanel> for a focused stage/packetLayer/interface. Every field comes straight off `deviceTrace`/`deviceInterfaces`/`devicePacketFrames`; link focus reuses <LinkDetailPanel> instead. */
  function focusPanelFieldsFor(target: FocusTarget3D): { title: string; fields: { label: string; value: string }[] } {
    if (target.kind === "stage" && deviceTrace) {
      const stage = deviceTrace.stages.find((s) => s.id === target.id);
      const fields: { label: string; value: string }[] = [];
      if (stage?.detail) fields.push({ label: "Detail", value: stage.detail });
      if (deviceTrace.activeStageId === target.id) {
        if (deviceTrace.lookupType) fields.push({ label: "Lookup", value: deviceTrace.lookupType });
        if (deviceTrace.lookupKey) fields.push({ label: "Match", value: deviceTrace.lookupKey });
        if (deviceTrace.lookupResult) fields.push({ label: "Result", value: deviceTrace.lookupResult });
        const egressIface = deviceInterfaces.find((i) => i.id === deviceTrace.egressInterfaceId);
        if (egressIface) fields.push({ label: "Egress", value: egressIface.name });
        if (deviceTrace.reason) fields.push({ label: "Why", value: deviceTrace.reason });
      }
      return { title: stage?.label ?? target.id, fields };
    }
    if (target.kind === "packetLayer") {
      const frame = devicePacketFrames?.find((f) => f.id === target.id);
      return { title: frame?.text ?? target.id, fields: [] };
    }
    if (target.kind === "interface") {
      const iface = deviceInterfaces.find((i) => i.id === target.id);
      if (!iface) return { title: target.id, fields: [] };
      const fields: { label: string; value: string }[] = [];
      if (iface.neighborLabel) fields.push({ label: "Peer", value: iface.neighborLabel });
      fields.push({ label: "Current role", value: iface.role === "ingress" ? "Ingress" : iface.role === "egress" ? "Egress" : "Idle" });
      fields.push({ label: "Status", value: iface.status === "up" ? "Up" : "Down" });
      if (iface.ip) fields.push({ label: "IP", value: iface.ip });
      return { title: iface.name, fields };
    }
    return { title: target.id, fields: [] };
  }

  function handleCameraModeChange(v: CameraMode) {
    setCameraMode(v);
    if (v === "device" && !enteredDeviceId) setEnteredDeviceId(selectedNodeId ?? activeDeviceId ?? "P1");
    if (v === "overview") {
      setEnteredDeviceId(undefined);
      setSelectedNodeId(undefined);
    }
    if (v === "freeOrbit") setEnteredDeviceId(undefined);
  }

  function handleToggleAutoPlay() {
    if (!autoPlay) {
      setFocusedObject(undefined);
      setHistoricalIndex(undefined);
      setInspectorSurface("hop");
    }
    setAutoPlay((v) => !v);
  }

  const peExplorerTabs = (router: RouterId): DeviceExplorerTab[] =>
    nodeExplanation
      ? [
          { id: "overview", label: "Overview", content: <OverviewTab action={nodeExplanation.currentAction} note={nodeExplanation.note} /> },
          { id: "interfaces", label: "Interfaces", content: <InterfaceListTab interfaces={deviceInterfaces} selectedInterfaceId={selectedInterfaceId} onSelectInterface={setSelectedInterfaceId} /> },
          ...(router === "P1"
            ? ([
                { id: "igp", label: "IPv6 IGP", content: <RowsTab rows={[{ label: "Primary next hop", value: "P2" }, { label: "Protected resource", value: PROTECTED_LINK }]} /> },
                { id: "old-fib", label: "Old FIB", content: <RowsTab rows={[{ label: "PE2 (before failure)", value: "via P2" }]} /> },
                { id: "post-spf", label: "Post-Convergence SPF", content: <RowsTab rows={[{ label: "Path", value: state.linkRepair?.postConvergencePath?.join(" → ") ?? "not yet computed" }]} /> },
                { id: "pq", label: "P/Q Spaces", content: <RowsTab rows={[{ label: "P-Space", value: state.linkRepair?.pSpace.join(", ") ?? "—" }, { label: "Extended P-Space", value: state.linkRepair?.extendedPSpace.join(", ") ?? "—" }, { label: "Q-Space", value: state.linkRepair?.qSpace.join(", ") ?? "—" }]} /> },
                { id: "protection", label: "TI-LFA Protection", content: <RowsTab rows={[{ label: "State", value: readiness?.valid ? "READY" : "STALE" }, { label: "Repair node", value: state.linkRepair?.repairNode ?? "none" }]} /> },
                { id: "repair-list", label: "Repair List", content: <RowsTab rows={(state.linkRepair?.repairList.sids ?? []).map((s) => ({ label: s.sidText, value: `${s.behavior}+${s.flavors.join(",")} → ${s.adjacency}` }))} /> },
                { id: "failure", label: "Failure Detection", content: <RowsTab rows={[{ label: "P1-P2", value: state.failedLinkIds.includes(PROTECTED_LINK) ? "DOWN (detected)" : "UP" }]} /> },
              ] satisfies DeviceExplorerTab[])
            : []),
          { id: "packet", label: "Packet", content: devicePacketForTab ? <PacketInspector packet={devicePacketForTab} /> : <p className="text-xs text-pv-text-faint">No packet at this device right now.</p> },
          { id: "cli", label: "CLI", content: <CLIOutputPanel commands={cliCommands} /> },
        ]
      : [];

  const p3ExplorerTabs: DeviceExplorerTab[] = nodeExplanation
    ? [
        { id: "overview", label: "Overview", content: <OverviewTab action={nodeExplanation.currentAction} note={nodeExplanation.note} /> },
        { id: "interfaces", label: "Interfaces", content: <InterfaceListTab interfaces={deviceInterfaces} selectedInterfaceId={selectedInterfaceId} onSelectInterface={setSelectedInterfaceId} /> },
        { id: "pre-fib", label: "Pre-Convergence FIB", content: <RowsTab rows={[{ label: "PE2", value: "via P1 (cost 30) — unchanged until P3 converges" }]} /> },
        { id: "current-fib", label: "Current FIB", content: <RowsTab rows={[{ label: "Knows failure?", value: state.failureKnownAt.P3 ? "yes" : "no" }]} /> },
        { id: "packet", label: "Packet", content: devicePacketForTab ? <PacketInspector packet={devicePacketForTab} /> : <p className="text-xs text-pv-text-faint">No packet at this device right now.</p> },
        { id: "cli", label: "CLI", content: <CLIOutputPanel commands={cliCommands} /> },
      ]
    : [];

  const p4ExplorerTabs: DeviceExplorerTab[] = nodeExplanation
    ? [
        { id: "overview", label: "Overview", content: <OverviewTab action={nodeExplanation.currentAction} note={nodeExplanation.note} /> },
        { id: "locator", label: "Locator", content: <RowsTab rows={[{ label: "Locator", value: INFRA_ADDRESS_TEXT.P4 }]} /> },
        { id: "local-sids", label: "Local SID Table", content: <RowsTab rows={(state.linkRepair?.repairList.sids ?? []).filter((s) => s.owner === "P4").map((s) => ({ label: s.sidText, value: `${s.behavior} · adjacency ${s.adjacency}` }))} /> },
        { id: "endx", label: "End.X", content: <RowsTab rows={[{ label: "Adjacency (link protection)", value: "P2" }, { label: "Adjacency (node protection)", value: "PE2" }]} /> },
        { id: "usd", label: "USD Flavor", content: <RowsTab rows={[{ label: "Behavior", value: "Remove repair outer + extensions, expose inner, force adjacency" }]} /> },
        { id: "packet", label: "Packet", content: devicePacketForTab ? <PacketInspector packet={devicePacketForTab} /> : <p className="text-xs text-pv-text-faint">No packet at this device right now.</p> },
        { id: "cli", label: "CLI", content: <CLIOutputPanel commands={cliCommands} /> },
      ]
    : [];

  function explorerTabsFor(router: RouterId): DeviceExplorerTab[] {
    if (router === "P3") return p3ExplorerTabs;
    if (router === "P4") return p4ExplorerTabs;
    return peExplorerTabs(router);
  }

  const diagnosticLayers: DiagnosticLayer[] = [
    { label: "P1-P2 Failure Detected", status: "healthy" },
    { label: "PLR = P1", status: "healthy" },
    { label: "P1-P3 Backup Interface", status: "healthy" },
    { label: "Post-Convergence Path Calculated", status: "healthy" },
    { label: "P-Space Calculated", status: "healthy" },
    { label: "Q-Space Calculated", status: "healthy" },
    { label: "Correct P/Q Relationship", status: "healthy" },
    { label: "Installed Repair OIF", status: "healthy" },
    { label: "Installed Repair SID = P4 End.X→P2", status: state.linkRepair?.mergeTarget === "P2" && state.linkRepair?.repairNode === "P4" ? "healthy" : "failing" },
    { label: "P3 Pre-Convergence FIB To P2", status: showTroubleshoot ? "failing" : "unknown" },
    { label: "Repair Path Loop-Free", status: state.linkRepair?.mergeTarget === "P2" && state.linkRepair?.repairNode === "P4" ? "healthy" : "failing" },
    { label: "Protected Traffic Delivered", status: state.troubleshooting.verified ? "healthy" : showTroubleshoot ? "failing" : "unknown" },
  ];

  useEffect(() => {
    if (isComplete && !awardedRef.current) {
      awardedRef.current = true;
      completeLesson("srv6-ti-lfa", 800);
      unlockAchievement("srv6-resilience-engineer");
    }
  }, [isComplete, completeLesson, unlockAchievement]);

  useEffect(() => {
    if (!autoPlay || !canAdvance || isComplete) return;
    const t = setTimeout(() => engine.advance(), 2200 / speed);
    return () => clearTimeout(t);
  }, [autoPlay, canAdvance, isComplete, index, engine, speed]);

  const handleAnswer = (optionId: string) => {
    engine.answer(optionId);
    if (currentStep?.question) recordAnswer(optionId === currentStep.question.correctOptionId);
  };

  const handleRestart = () => {
    awardedRef.current = false;
    engine.restart();
    setCameraMode("overview");
    setEnteredDeviceId(undefined);
    setSelectedNodeId(undefined);
    setSelectedLinkId(undefined);
    setPacketSelected(false);
    setTopoView("physical");
    setViewMode3D(false);
    setFocusMode(false);
    setFocusedObject(undefined);
    setHistoricalIndex(undefined);
    setInspectorSurface("hop");
  };

  const nextLabel = currentStep?.question && !lastAnswer ? "Answer to continue" : currentStep?.requiresState && !canAdvance ? "Apply the correct fix to continue" : "Next Step →";

  const preConvergencePanel = <RouteEvolutionViewer title="Per-Router FIB Toward PE2 (Stale vs. Converged)" oldLabel="STALE" newLabel="CURRENT" fields={staleFibFields} winnerReason="P3/P4 keep their pre-failure FIB until THEY individually converge — this is the whole reason local repair can't rely on their forwarding." />;
  const repairSpacesPanel = activeRepair && <RepairSpaceViewer title={`Repair Spaces — ${activeRepair.mode === "LINK" ? PROTECTED_LINK : PROTECTED_NODE}`} nodes={ALL_ROUTERS.map((r) => ({ id: r, label: r }))} pSpace={activeRepair.pSpace} extendedPSpace={activeRepair.extendedPSpace} qSpace={activeRepair.qSpace} pqCandidates={activeRepair.pqCandidates} selectedRepairNode={activeRepair.repairNode} protectedResource={activeRepair.protectedResource} plr="P1" destination="PE2" />;
  const repairProgramPanel = activeRepair && (
    <div className="space-y-3">
      <RepairComputationViewer title="Repair Computation Pipeline" stages={repairComputationStages} />
      <Srv6RepairListViewer
        protectedResource={activeRepair.protectedResource}
        outgoingInterface={activeRepair.outgoingInterface ? `P1 → ${activeRepair.outgoingInterface}` : undefined}
        sids={activeRepair.repairList.sids.map((s) => ({ sid: s.sidText, owner: s.owner, behavior: s.behavior, adjacency: s.adjacency, flavors: s.flavors, purpose: `Forces the exposed packet to adjacency ${s.adjacency} — never rewrites the packet's own destination.` }))}
      />
    </div>
  );
  const recoveryPanel = <RecoveryTimelineViewer events={recoveryEvents} />;
  const multiSidPanel = (
    <GlassPanel strong className="space-y-2 p-5">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-pv-violet">Multi-SID SRH Lab (Separate Illustration)</h3>
      <p className="pv-mono text-xs text-pv-text-muted">Outer DA = {multiSid.sids[0].sidText}</p>
      <p className="pv-mono text-xs text-pv-text-muted">Segment List[0] = {multiSid.srh.segmentList[0].sidText} (final)</p>
      <p className="pv-mono text-xs text-pv-text-muted">Segment List[1] = {multiSid.srh.segmentList[1].sidText}</p>
      <p className="pv-mono text-xs text-pv-text-muted">Segments Left = {multiSid.srh.segmentsLeft} · Last Entry = {multiSid.srh.lastEntry}</p>
    </GlassPanel>
  );

  return (
    <div className="mx-auto max-w-7xl px-6 py-10">
      <div className="mb-6">
        <Badge tone="cyan" className="mb-3">
          SRv6 PROTECTION · TI-LFA · RFC 9855 · P-SPACE/Q-SPACE · END.X+USD
        </Badge>
        <h1 className="text-2xl font-semibold text-pv-text sm:text-3xl">Convergence Repairs The Network. TI-LFA Protects Traffic While That Happens.</h1>
        <p className="mt-2 max-w-3xl text-sm text-pv-text-muted">
          A precomputed outgoing interface plus a globally-routed SRv6 End.X+USD repair SID lets P1 restore traffic locally, the
          instant it detects a failure — while P3 and P4 are still completely unaware anything happened.
        </p>
      </div>

      <div className="mb-4 grid gap-2 sm:grid-cols-4">
        {WHY_TI_LFA.map((item) => (
          <GlassPanel key={item.q} className="p-3">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-pv-cyan-soft">{item.q}</p>
            <p className="text-[11px] leading-snug text-pv-text-muted">{item.a}</p>
          </GlassPanel>
        ))}
      </div>

      <div className="mb-4 flex gap-1 overflow-x-auto pb-2">
        {srv6TiLfaSteps.map((step, i) => (
          <button
            key={step.id}
            type="button"
            disabled={i > index}
            onClick={() => i < index && engine.goTo(i)}
            title={step.label}
            className={clsx("h-1.5 flex-1 min-w-3 rounded-full transition-colors", i < index ? "bg-pv-success/70 hover:bg-pv-success cursor-pointer" : i === index ? "bg-pv-cyan" : "bg-white/10")}
          />
        ))}
      </div>

      <div className="mb-6 flex flex-wrap gap-3">
        <TopologyModeSwitcher
          options={[
            { value: "physical", label: "Physical" },
            { value: "preConvergence", label: "Pre-Convergence" },
            { value: "repairSpaces", label: "Repair Spaces" },
            { value: "repairProgram", label: "Repair Program" },
            { value: "recovery", label: "Recovery" },
          ]}
          value={topoView}
          onChange={setTopoView}
        />
        <TopologyModeSwitcher options={[{ value: "off", label: "2D" }, { value: "on", label: "3D View" }]} value={viewMode3D ? "on" : "off"} onChange={(v) => setViewMode3D(v === "on")} tone="violet" />
        {viewMode3D && (
          <>
            <TopologyModeSwitcher
              options={[
                { value: "overview", label: "Overview" },
                { value: "device", label: "Device" },
                { value: "packetFollow", label: "Packet Follow" },
                { value: "freeOrbit", label: "Free Orbit" },
              ]}
              value={cameraMode}
              onChange={handleCameraModeChange}
            />
            {inDeviceMode && <TopologyModeSwitcher options={[{ value: "off", label: "Exterior" }, { value: "on", label: "X-Ray" }]} value={deviceXray ? "on" : "off"} onChange={(v) => setDeviceXray(v === "on")} tone="violet" />}
          </>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_400px]">
        {/* MAIN COLUMN */}
        <div className="space-y-6">
          {viewMode3D ? (
            <>
              <TopologyFrame questionActive={questionActive} onExpand={() => setFocusMode(true)}>
                {focusMode ? (
                  // Focus Mode renders its own full-size <NetworkScene3D> below —
                  // avoid a second, fully hidden WebGL canvas behind the modal
                  // (one-canvas invariant, see sr-mpls-foundations).
                  <div className="h-96 w-full rounded-2xl border border-pv-border bg-pv-bg-elevated sm:h-[28rem]" />
                ) : (
                  <NetworkScene3D
                    nodes={nodes3D}
                    links={links3D}
                    activePacket={inDeviceMode ? undefined : activePacket3D}
                    onSelectNode={(id) => {
                      setSelectedNodeId(id as RouterId);
                      setPacketSelected(false);
                      setSelectedLinkId(undefined);
                      setInspectorSurface("device");
                      setHistoricalIndex(undefined);
                    }}
                    onSelectLink={(id) => {
                      setSelectedLinkId(id);
                      setSelectedNodeId(undefined);
                      setPacketSelected(false);
                    }}
                    selectedLinkId={selectedLinkId}
                    onFocusLink={setFocusedObject}
                    onSelectPacket={() => {
                      setPacketSelected(true);
                      setAutoPlay(false);
                    }}
                    packetSelected={packetSelected}
                    focusPosition={focusPosition3D}
                    eyeOffset={eyeOffset3D}
                    mode={inDeviceMode ? "device" : "overview"}
                    deviceView={
                      inDeviceMode
                        ? {
                            deviceLabel: effectiveDeviceId!,
                            interfaces: deviceInterfaces,
                            xray: deviceXray,
                            trace: deviceTrace,
                            packetFrames: devicePacketFrames,
                            onSelectInterface: setSelectedInterfaceId,
                            selectedInterfaceId,
                            onSelectPacket: () => {
                              setPacketSelected(true);
                              setAutoPlay(false);
                            },
                            packetSelected,
                            pipelineTitle: "Conceptual TI-LFA Repair Pipeline",
                            onFocusObject: setFocusedObject,
                            focusedObjectId: activeFocusedObject?.id,
                          }
                        : undefined
                    }
                  />
                )}
              </TopologyFrame>

              {cameraMode === "packetFollow" && (
                <PacketFocusPanel
                  currentHopLabel={lastHop ? `${lastHop.router}: ${lastHop.action} → ${lastHop.output}` : undefined}
                  hopIndex={state.journey.length}
                  totalHops={5}
                  onPrevHop={() => engine.goTo(Math.max(0, index - 1))}
                  onNextHop={() => engine.advance()}
                  canPrev={index > 0}
                  canNext={canAdvance}
                  cameraFollow={true}
                  onToggleCameraFollow={() => setAutoEnterDevices((v) => !v)}
                />
              )}

              {packetSelected && activePacket && (
                <PacketDetailPanel
                  packet={activePacket}
                  currentDevice={packetCurrentDeviceLabel}
                  direction="PE1 → P1 → P3 → P4 → P2 → PE2"
                  paused={packetSelected}
                  onResume={() => setPacketSelected(false)}
                  onStepForward={() => {
                    engine.advance();
                    followPacketIntoCurrentDevice();
                  }}
                  onStepBack={() => {
                    engine.goTo(Math.max(0, index - 1));
                    followPacketIntoCurrentDevice();
                  }}
                  canStepForward={canAdvance}
                  canStepBack={index > 0}
                  onClose={() => setPacketSelected(false)}
                />
              )}

              {selectedLinkDetail && !packetSelected && <LinkDetailPanel detail={selectedLinkDetail} onClose={() => setSelectedLinkId(undefined)} />}

              {inDeviceMode && !packetSelected && !selectedLinkDetail ? (
                <DeviceExplorerPanel
                  explanation={nodeExplanation!}
                  tabs={explorerTabsFor(effectiveDeviceId!)}
                  xrayEnabled={deviceXray}
                  onToggleXray={() => setDeviceXray((v) => !v)}
                  onExit={() => {
                    setCameraMode("overview");
                    setEnteredDeviceId(undefined);
                  }}
                />
              ) : (
                !packetSelected &&
                !selectedLinkDetail && (
                  <NodeInspectorPanel explanation={nodeExplanation} packet={xrayPacket}>
                    {selectedNodeId && DEVICE_ROUTERS.includes(selectedNodeId) && (
                      <Button
                        size="sm"
                        onClick={() => {
                          setEnteredDeviceId(selectedNodeId);
                          setCameraMode("device");
                        }}
                      >
                        Enter Device →
                      </Button>
                    )}
                  </NodeInspectorPanel>
                )
              )}
            </>
          ) : (
            <>
              <GraphTopologyViewer nodes={nodes} edges={edges} activeNodeIds={activeNodeIds}>
                {activePacket && packetFrom && packetTo && <GraphPacket packet={activePacket} from={packetFrom} to={packetTo} />}
              </GraphTopologyViewer>

              {lastHop && (
                <GlassPanel className="p-4">
                  <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-pv-text-muted">Forwarding Decision — {lastHop.router}</h4>
                  <p className="pv-mono text-[11px] text-pv-text-muted">
                    In: <span className="text-pv-text">{lastHop.input}</span>
                  </p>
                  <p className="pv-mono text-[11px] text-pv-text-muted">
                    Lookup: <span className="text-pv-text">{lastHop.lookup}</span>
                  </p>
                  <p className="pv-mono text-[11px] text-pv-text-muted">
                    Action: <span className="text-pv-cyan-soft">{lastHop.action}</span> → <span className="text-pv-text">{lastHop.output}</span>
                  </p>
                </GlassPanel>
              )}

              {topoView === "preConvergence" && <div className="grid gap-3 sm:grid-cols-2">{preConvergencePanel}</div>}
              {topoView === "repairSpaces" && repairSpacesPanel}
              {topoView === "repairProgram" && repairProgramPanel}
              {topoView === "recovery" && recoveryPanel}
            </>
          )}

          {!isComplete && currentStep && (
            <GlassPanel strong className="p-6">
              <div className="mb-2 flex items-center gap-2">
                <Badge tone="muted">
                  Step {index + 1} / {totalSteps}
                </Badge>
                <span className="text-xs text-pv-text-faint">{currentStep.label}</span>
              </div>
              <p className="text-sm leading-relaxed text-pv-text">{currentStep.narrative}</p>
            </GlassPanel>
          )}

          {!isComplete && currentStep?.question && <PredictionQuestion question={currentStep.question} selectedOptionId={lastAnswer?.stepId === currentStep.id ? lastAnswer.optionId : undefined} onAnswer={handleAnswer} />}

          {!isComplete && currentStep?.id === "repair-challenge" && <RepairChallenge options={REPAIR_OPTIONS} attempt={state.repairAttempt} onTry={(choice) => engine.act({ choice })} />}

          {currentStep?.id === "p4-usd-decap" && state.linkRepair?.repairList.sids[0] && (
            <Srv6BehaviorExecutionViewer
              data={{
                activeSid: state.linkRepair.repairList.sids[0].sidText,
                matchedLocalSid: state.linkRepair.repairList.sids[0].sidText,
                behavior: "End.X + USD",
                input: "Repair outer IPv6 + original inner IPv6",
                validation: "Segments Left = 0 (single-SID repair, no SRH) — final segment position OK.",
                transformation: "Remove repair outer IPv6 header and extensions entirely.",
                egressDecision: `Force exposed packet to adjacency ${state.linkRepair.repairList.sids[0].adjacency}`,
                resultingPacket: `Original IPv6 → ${state.linkRepair.repairList.sids[0].adjacency}`,
              }}
            />
          )}

          {whatChanged.length > 0 && !currentStep?.question && currentStep?.id !== "repair-challenge" && (
            <GlassPanel className="p-5">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-pv-cyan-soft">What changed?</h3>
              <ul className="space-y-1.5">
                {whatChanged.map((c) => (
                  <li key={c} className="flex gap-2 text-xs text-pv-text-muted">
                    <span className="text-pv-success">✓</span>
                    {c}
                  </li>
                ))}
              </ul>
            </GlassPanel>
          )}

          {showMultiSidLab && !isComplete && multiSidPanel}
          {showTroubleshoot && !isComplete && <TroubleshootingLayers title="Troubleshooting Layers" layers={diagnosticLayers} />}

          {isComplete && (
            <GlassPanel strong glow="success" className="flex flex-col items-center gap-4 p-10 text-center">
              <Badge tone="success">SRv6 Resilience Engineer</Badge>
              <h2 className="text-2xl font-semibold text-pv-text">The Core Survived P1-P2 — Locally, Immediately</h2>
              <p className="max-w-md text-sm text-pv-text-muted">
                You precomputed a TI-LFA repair path from real P-Space/extended P-Space/Q-Space analysis, activated it locally at
                the PLR the instant a failure was detected, proved a naive redirect genuinely loops from real stale-FIB state,
                repaired a wrong precomputed repair list, protected both a link and a node, and protected a nested SRv6 L3VPN
                packet without either layer knowing about the other. +800 XP awarded.
              </p>
              <div className="flex gap-3">
                <Button onClick={handleRestart} variant="secondary">
                  Restart Lesson
                </Button>
                <Link href="/dashboard">
                  <Button>View Dashboard</Button>
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
              <div className="flex gap-1 rounded-full border border-pv-border p-0.5">
                {([0.5, 1, 2] as const).map((s) => (
                  <button key={s} type="button" onClick={() => setSpeed(s)} className={clsx("rounded-full px-2.5 py-1 text-[10px] font-semibold pv-mono transition-colors", speed === s ? "bg-pv-cyan/15 text-pv-cyan-soft" : "text-pv-text-faint hover:text-pv-text")}>
                    {s}x
                  </button>
                ))}
              </div>
              <Button variant="ghost" size="sm" onClick={handleRestart}>
                ⟲ Restart
              </Button>
            </div>
          )}
        </div>

        {/* SIDEBAR */}
        <div className="space-y-4">
          <PacketInspector packet={activePacket} />

          <div className="flex flex-wrap gap-1 rounded-full border border-pv-border p-0.5 w-fit">
            {DEVICE_ROUTERS.map((r) => (
              <button key={r} type="button" onClick={() => setFocusRouter(r)} className={clsx("rounded-full px-3 py-1 text-[11px] font-semibold pv-mono transition-colors", focusRouter === r ? "bg-pv-cyan/15 text-pv-cyan-soft" : "text-pv-text-faint hover:text-pv-text")}>
                {r}
              </button>
            ))}
          </div>

          {showRepairProgram && activeRepair && (
            <Srv6RepairListViewer
              title={`${focusRouter === "P1" ? "P1" : "PacketVerse"} — Repair Path`}
              protectedResource={activeRepair.protectedResource}
              outgoingInterface={activeRepair.outgoingInterface ? `P1 → ${activeRepair.outgoingInterface}` : undefined}
              sids={activeRepair.repairList.sids.map((s) => ({ sid: s.sidText, owner: s.owner, behavior: s.behavior, adjacency: s.adjacency, flavors: s.flavors, purpose: `Adjacency → ${s.adjacency}` }))}
            />
          )}

          {showRepairSpaces && activeRepair && (
            <GlassPanel className="p-4">
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-pv-text-muted">Protection Readiness</h4>
              <Badge tone={readiness?.valid ? "success" : "danger"}>{readiness?.valid ? "READY" : "STALE / INCORRECT"}</Badge>
              <p className="mt-2 text-[11px] text-pv-text-muted">{readiness?.reason}</p>
            </GlassPanel>
          )}

          <PacketJourneyTimeline hops={state.journey} />
          <CLIOutputPanel commands={cliCommands} />
        </div>
      </div>

      {focusMode && (
        <TopologyFocusMode
          onClose={() => setFocusMode(false)}
          toolbar={
            <>
              <TopologyModeSwitcher
                options={[
                  { value: "overview", label: "Overview" },
                  { value: "device", label: "Device" },
                  { value: "packetFollow", label: "Packet Follow" },
                  { value: "freeOrbit", label: "Free Orbit" },
                ]}
                value={cameraMode}
                onChange={handleCameraModeChange}
              />
              {inDeviceMode && <TopologyModeSwitcher options={[{ value: "off", label: "Exterior" }, { value: "on", label: "X-Ray" }]} value={deviceXray ? "on" : "off"} onChange={(v) => setDeviceXray(v === "on")} tone="violet" />}
              {cameraMode === "packetFollow" && (
                <button
                  type="button"
                  onClick={() => setAutoEnterDevices((v) => !v)}
                  className={clsx("rounded-full border px-3 py-1.5 text-xs font-semibold uppercase tracking-wide transition-colors", autoEnterDevices ? "border-pv-cyan/50 bg-pv-cyan/15 text-pv-cyan-soft" : "border-pv-border text-pv-text-faint hover:text-pv-text")}
                >
                  Auto-Enter Devices
                </button>
              )}
            </>
          }
          header={
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
              <div className="flex min-w-0 items-center gap-2">
                <Badge tone="muted">
                  Step {Math.min(index + 1, totalSteps)} / {totalSteps}
                </Badge>
                <span className="truncate text-xs font-medium text-pv-text">{currentStep?.label ?? (isComplete ? "Complete" : "")}</span>
              </div>
              {questionActive ? (
                <span className="shrink-0 rounded-full border border-pv-warning/40 bg-pv-warning/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-pv-warning">
                  Prediction pending — answer in the panel to continue
                </span>
              ) : currentStep?.id === "repair-challenge" ? (
                <span className="shrink-0 rounded-full border border-pv-warning/40 bg-pv-warning/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-pv-warning">
                  Engineer challenge pending — recompute the correct repair to continue
                </span>
              ) : (
                currentStep?.narrative && (
                  <p className="min-w-0 flex-1 truncate text-[11px] text-pv-text-faint" title={currentStep.narrative}>
                    {currentStep.narrative}
                  </p>
                )
              )}
            </div>
          }
          canvas={
            <div className="h-full [&>div]:h-full [&>div]:rounded-none [&>div]:border-0">
              <NetworkScene3D
                nodes={nodes3D}
                links={links3D}
                activePacket={inDeviceMode ? undefined : activePacket3D}
                onSelectNode={(id) => {
                  setSelectedNodeId(id as RouterId);
                  setPacketSelected(false);
                  setSelectedLinkId(undefined);
                  setInspectorSurface("device");
                  setHistoricalIndex(undefined);
                }}
                onSelectLink={(id) => setSelectedLinkId(id)}
                selectedLinkId={selectedLinkId}
                onFocusLink={setFocusedObject}
                onSelectPacket={() => setPacketSelected(true)}
                packetSelected={packetSelected}
                focusPosition={focusPosition3D}
                eyeOffset={eyeOffset3D}
                mode={inDeviceMode ? "device" : "overview"}
                deviceView={
                  inDeviceMode
                    ? {
                        deviceLabel: effectiveDeviceId!,
                        interfaces: deviceInterfaces,
                        xray: deviceXray,
                        trace: deviceTrace,
                        packetFrames: devicePacketFrames,
                        onSelectInterface: setSelectedInterfaceId,
                        selectedInterfaceId,
                        onSelectPacket: () => setPacketSelected(true),
                        packetSelected,
                        pipelineTitle: "Conceptual TI-LFA Repair Pipeline",
                        onFocusObject: setFocusedObject,
                        focusedObjectId: activeFocusedObject?.id,
                      }
                    : undefined
                }
              />
            </div>
          }
          inspector={
            currentStep?.question ? (
              <>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-pv-cyan-soft">Current Prediction</p>
                <PredictionQuestion question={currentStep.question} selectedOptionId={lastAnswer?.stepId === currentStep.id ? lastAnswer.optionId : undefined} onAnswer={handleAnswer} />
              </>
            ) : currentStep?.id === "repair-challenge" ? (
              <>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-pv-cyan-soft">Engineer Challenge</p>
                <RepairChallenge options={REPAIR_OPTIONS} attempt={state.repairAttempt} onTry={(choice) => engine.act({ choice })} />
              </>
            ) : showBehaviorExecution && state.linkRepair?.repairList.sids[0] ? (
              <>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-pv-violet">End.X + USD Execution</p>
                <Srv6BehaviorExecutionViewer
                  data={{
                    activeSid: state.linkRepair.repairList.sids[0].sidText,
                    matchedLocalSid: state.linkRepair.repairList.sids[0].sidText,
                    behavior: "End.X + USD",
                    input: "Repair outer IPv6 + original inner IPv6",
                    validation: "Segments Left = 0 (single-SID repair, no SRH) — final segment position OK.",
                    transformation: "Remove repair outer IPv6 header and extensions entirely.",
                    egressDecision: `Force exposed packet to adjacency ${state.linkRepair.repairList.sids[0].adjacency}`,
                    resultingPacket: `Original IPv6 → ${state.linkRepair.repairList.sids[0].adjacency}`,
                  }}
                />
              </>
            ) : showMultiSidLab ? (
              <>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-pv-violet">Multi-SID SRH Lab</p>
                {multiSidPanel}
              </>
            ) : currentStep && PRE_CONVERGENCE_STEPS.has(currentStep.id) ? (
              <>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-pv-violet">Pre-Convergence FIB</p>
                {preConvergencePanel}
              </>
            ) : currentStep && REPAIR_SPACES_STEPS.has(currentStep.id) && repairSpacesPanel ? (
              <>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-pv-violet">Repair Spaces</p>
                {repairSpacesPanel}
              </>
            ) : currentStep && REPAIR_PROGRAM_STEPS.has(currentStep.id) && repairProgramPanel ? (
              <>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-pv-violet">Repair Program</p>
                {repairProgramPanel}
              </>
            ) : currentStep && RECOVERY_STEPS.has(currentStep.id) ? (
              <>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-pv-violet">Recovery Timeline</p>
                {recoveryPanel}
              </>
            ) : selectedLinkDetail ? (
              <LinkDetailPanel
                detail={selectedLinkDetail}
                onClose={() => {
                  setSelectedLinkId(undefined);
                  setFocusedObject(undefined);
                }}
              />
            ) : activeFocusedObject && activeFocusedObject.kind !== "link" ? (
              <ObjectFocusPanel
                kind={activeFocusedObject.kind}
                title={focusPanelFieldsFor(activeFocusedObject).title}
                fields={focusPanelFieldsFor(activeFocusedObject).fields}
                onBack={() => setFocusedObject(undefined)}
                onOverview={() => {
                  setFocusedObject(undefined);
                  handleCameraModeChange("overview");
                }}
              />
            ) : inspectorSurface === "device" ? (
              inDeviceMode ? (
                <div className="space-y-3">
                  <TopologyModeSwitcher options={[{ value: "hop", label: "Hop" }, { value: "device", label: "Device" }]} value={inspectorSurface} onChange={setInspectorSurface} tone="violet" />
                  <DeviceExplorerPanel
                    explanation={nodeExplanation!}
                    tabs={explorerTabsFor(effectiveDeviceId!)}
                    xrayEnabled={deviceXray}
                    onToggleXray={() => setDeviceXray((v) => !v)}
                    onExit={() => {
                      setCameraMode("overview");
                      setEnteredDeviceId(undefined);
                    }}
                  />
                </div>
              ) : nodeExplanation ? (
                <NodeInspectorPanel explanation={nodeExplanation} packet={xrayPacket} />
              ) : (
                <GlassPanel className="p-4">
                  <p className="text-xs text-pv-text-faint">Select a device, or advance the lesson, to inspect a hop.</p>
                </GlassPanel>
              )
            ) : historicalCursor !== undefined && historicalTrace ? (
              <div className="space-y-3">
                {inDeviceMode && (
                  <TopologyModeSwitcher options={[{ value: "hop", label: "Hop" }, { value: "device", label: "Device" }]} value={inspectorSurface} onChange={setInspectorSurface} tone="violet" disabledValues={["device"]} />
                )}
                <div className="flex items-center justify-between rounded-lg border border-pv-violet/40 bg-pv-violet/10 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 shrink-0 rounded-full bg-pv-violet" />
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-pv-violet">Historical — {historicalStep?.label}</span>
                  </div>
                  <button type="button" onClick={() => setHistoricalIndex(undefined)} className="text-[11px] font-semibold uppercase tracking-wide text-pv-text-faint transition-colors hover:text-pv-cyan-soft">
                    Return to Current →
                  </button>
                </div>
                <HopInspectorPanel trace={historicalTrace} deviceName={historicalDeviceId ?? "—"} interfaces={historicalInterfaces} />
                <PacketDiffViewer before={historicalTrace.packetBeforeFrames} after={historicalTrace.packetAfterFrames} beforeText={historicalTrace.packetBefore} afterText={historicalTrace.packetAfter} mutations={historicalTrace.mutations} />
              </div>
            ) : focusTrace ? (
              <div className="space-y-3">
                {inDeviceMode && <TopologyModeSwitcher options={[{ value: "hop", label: "Hop" }, { value: "device", label: "Device" }]} value={inspectorSurface} onChange={setInspectorSurface} tone="violet" />}
                <HopInspectorPanel
                  trace={focusTrace}
                  deviceName={focusInspectDeviceId ?? "—"}
                  interfaces={focusInterfaces}
                  onFocusNextHop={(id) => {
                    setSelectedNodeId(id as RouterId);
                    setInspectorSurface("hop");
                    setHistoricalIndex(undefined);
                    if (cameraMode === "device" && DEVICE_ROUTERS.includes(id as RouterId)) setEnteredDeviceId(id as RouterId);
                  }}
                />
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
                  setFocusedObject(undefined);
                  const histState = engine.getStateAt(entry.index);
                  const histStep = srv6TiLfaSteps[entry.index];
                  const histPacket = histStep && histState ? histStep.packet?.(histState) : undefined;
                  const router = histState ? deviceForStep(entry.id, histPacket) : undefined;
                  if (router && DEVICE_ROUTERS.includes(router)) {
                    setSelectedNodeId(router);
                    if (cameraMode === "device") setEnteredDeviceId(router);
                  }
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
                view3D={viewMode3D}
                onToggleView3D={() => setViewMode3D((v) => !v)}
              />
            </div>
          }
        />
      )}
    </div>
  );
}

function OverviewTab({ action, note }: { action: string; note?: string }) {
  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-pv-cyan/30 bg-pv-cyan/5 p-3">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-pv-cyan-soft">Current Action</p>
        <p className="text-sm text-pv-text">{action}</p>
      </div>
      {note && <p className="rounded-lg border border-pv-warning/30 bg-pv-warning/5 p-2.5 text-xs text-pv-text-muted">{note}</p>}
    </div>
  );
}

function RowsTab({ rows }: { rows: { label: string; value: string }[] }) {
  if (rows.length === 0) return <p className="text-xs text-pv-text-faint">Nothing to show yet.</p>;
  return (
    <div className="space-y-1 pv-mono text-[11px]">
      {rows.map((r) => (
        <div key={r.label} className="flex justify-between gap-3 rounded-lg border border-pv-border p-2">
          <span className="text-pv-text-faint">{r.label}</span>
          <span className="text-right text-pv-text">{r.value}</span>
        </div>
      ))}
    </div>
  );
}

function RepairChallenge({ options, attempt, onTry }: { options: { id: string; label: string }[]; attempt?: { choice: string; correct: boolean }; onTry: (choice: string) => void }) {
  return (
    <GlassPanel strong className="p-5">
      <p className="mb-3 text-sm font-medium text-pv-text">Choose the correct repair:</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((opt) => {
          const isSelected = attempt?.choice === opt.id;
          const isCorrect = opt.id === "recompute-correct";
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => onTry(opt.id)}
              className={clsx(
                "rounded-xl border px-4 py-3 text-left text-sm transition-colors cursor-pointer",
                isSelected && isCorrect && "border-pv-success/50 bg-pv-success/10 text-pv-success",
                isSelected && !isCorrect && "border-pv-danger/50 bg-pv-danger/10 text-pv-danger",
                !isSelected && "border-pv-border hover:border-pv-cyan/40 hover:bg-pv-cyan/5",
              )}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
      {attempt && (
        <div className={clsx("mt-4 rounded-xl border p-4 text-sm", attempt.correct ? "border-pv-success/50 bg-pv-success/10 text-pv-success" : "border-pv-warning/40 bg-pv-warning/5 text-pv-text-muted")}>
          {attempt.correct ? (
            <span className="font-semibold">✓ Repair recomputed — P4 End.X+USD → P2, exactly the documented strategy.</span>
          ) : (
            <>
              <span className="mb-1 block font-semibold text-pv-text">That doesn&apos;t fix it.</span>
              {WRONG_FEEDBACK[attempt.choice] ?? "Try again."}
            </>
          )}
        </div>
      )}
    </GlassPanel>
  );
}
