"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { clsx } from "clsx";
import { useScenarioEngine } from "@/lib/sim-engine/useScenarioEngine";
import {
  ALL_ROUTERS,
  BASE_LINKS,
  DESTINATION,
  GRAPH_EDGES,
  GRAPH_NODES,
  PLR,
  PROTECTED_LINK,
  PROTECTED_NODE,
  STEP_IDX,
  TERMS,
  TI_LFA_LIFECYCLE_INFO,
  buildSidDatabase,
  buildSrTiLfaCliCommands,
  computePostConvergencePath,
  createSrTiLfaState,
  deriveNodeSidLabel,
  determineProtectionReadiness,
  linkIdsOnPath,
  srTiLfaSteps,
  validateRepairList,
  type RouterId,
  type SrTiLfaState,
  type TiLfaComputation,
} from "@/lib/sim-engine/scenarios/srTiLfa";
import { GraphTopologyViewer, type GraphEdge } from "@/components/network/GraphTopologyViewer";
import { GraphPacket } from "@/components/network/GraphPacket";
import { PacketInspector } from "@/components/network/PacketInspector";
import { ForwardingDecisionCard } from "@/components/protocol/ForwardingDecisionCard";
import { PacketJourneyTimeline } from "@/components/protocol/PacketJourneyTimeline";
import { PlaneSplitPanel } from "@/components/protocol/PlaneSplitPanel";
import { SidTableViewer } from "@/components/protocol/SidTableViewer";
import type { SegmentListRow } from "@/components/protocol/SegmentListViewer";
import { RepairListViewer } from "@/components/protocol/RepairListViewer";
import { RepairSpaceViewer } from "@/components/protocol/RepairSpaceViewer";
import { RepairComputationViewer, type RepairComputationStage } from "@/components/protocol/RepairComputationViewer";
import { ProtectionPathViewer } from "@/components/protocol/ProtectionPathViewer";
import { RecoveryTimelineViewer, type RecoveryEvent } from "@/components/protocol/RecoveryTimelineViewer";
import { RouteEvolutionViewer } from "@/components/protocol/RouteEvolutionViewer";
import { BeforeAfterMetrics } from "@/components/protocol/BeforeAfterMetrics";
import { TroubleshootingLayers, type DiagnosticLayer } from "@/components/protocol/TroubleshootingLayers";
import { CLIOutputPanel } from "@/components/protocol/CLIOutputPanel";
import { PredictionQuestion } from "@/components/quiz/PredictionQuestion";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { useProgressStore } from "@/lib/state/useProgressStore";
import { NetworkScene3D } from "@/components/network3d/NetworkScene3D";
import { NodeInspectorPanel } from "@/components/network3d/NodeInspectorPanel";
import { TopologyModeSwitcher } from "@/components/network3d/TopologyModeSwitcher";
import { PlaneViewSwitcher } from "@/components/network3d/PlaneViewSwitcher";
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
import { deviceForStep, interfacesFor, linkDetailFor, packetFramesFor, traceFor } from "./deviceTrace";

const DEVICE_ROUTERS: RouterId[] = ["R1", "R2", "R3", "R4", "R5", "R6"];
type TopoView = "physical" | "igp";

const WHY_TILFA: { q: string; a: string }[] = [
  { q: "WHAT IS TI-LFA?", a: "Local repair expressed as SR instructions — precomputed before failure, activated instantly by the PLR." },
  { q: "DOES 'TOPOLOGY INDEPENDENT' MEAN NO TOPOLOGY?", a: "No — the repair is computed FROM the topology. It means the repair isn't limited to one adjacent backup next hop." },
  { q: "IS THIS THE SAME AS RSVP FRR?", a: "No — same goal (local repair before global convergence), different machinery: SR instructions, not a signaled bypass LSP." },
  { q: "CAN IT SURVIVE ANY FAILURE?", a: "No — if no surviving physical path exists, no local-repair technology can manufacture one." },
];

const REPAIR_OPTIONS = [
  { id: "change-r6-sid", label: "Change R6's Node SID" },
  { id: "increase-policy-preference", label: "Increase the R1 SR Policy candidate preference" },
  { id: "restart-mpls-forwarding", label: "Restart MPLS forwarding at R2" },
  { id: "recompute-tilfa", label: "Recompute TI-LFA against the current topology" },
];
const WRONG_FEEDBACK: Record<string, string> = {
  "change-r6-sid": "R6's Node SID is healthy — this incident has nothing to do with the destination's SID.",
  "increase-policy-preference": "This isn't an SR Policy candidate-preference problem. TI-LFA local repair at R2 is a completely different mechanism from SR Policy candidate fallback.",
  "restart-mpls-forwarding": "MPLS forwarding is doing exactly what it was told — the repair COMPUTATION itself is stale (computed before the R2-R3 metric change), not the forwarding engine.",
};

export default function SrTiLfaDemo() {
  const { engine, snapshot } = useScenarioEngine<SrTiLfaState>(createSrTiLfaState(), srTiLfaSteps);
  const [autoPlay, setAutoPlay] = useState(false);
  const [speed, setSpeed] = useState<0.5 | 1 | 2>(1);
  const [topoView, setTopoView] = useState<TopoView>("physical");
  const [viewMode3D, setViewMode3D] = useState(false);
  const [planeView, setPlaneView] = useState<"control" | "data" | "both">("both");
  const [focusRouter, setFocusRouter] = useState<RouterId>("R2");
  const [selectedNodeId, setSelectedNodeId] = useState<RouterId | undefined>(undefined);
  const [cameraMode, setCameraMode] = useState<CameraMode>("overview");
  const [enteredDeviceId, setEnteredDeviceId] = useState<RouterId | undefined>(undefined);
  const [deviceXray, setDeviceXray] = useState(true);
  const [autoEnterDevices, setAutoEnterDevices] = useState(true);
  const [selectedInterfaceId, setSelectedInterfaceId] = useState<string | undefined>(undefined);
  const [selectedLinkId, setSelectedLinkId] = useState<string | undefined>(undefined);
  const [packetSelected, setPacketSelected] = useState(false);
  const [xrayMode, setXrayMode] = useState(true);
  const [focusMode, setFocusMode] = useState(false);
  const [focusedObject, setFocusedObject] = useState<FocusTarget3D | undefined>(undefined);
  /** Presentation cursor for HopTimeline inspection (mirrors mpls-ldp's "Historical Timeline Inspection Fix") — a step INDEX, never mutates the live lesson. undefined = inspecting the current/live hop. */
  const [historicalIndex, setHistoricalIndex] = useState<number | undefined>(undefined);
  /** Explicit Hop-vs-Device intent inside Focus Mode ("Shared Focus Mode Inspector Fix") — set by the actual gesture (node click → device; timeline/next-hop/Play → hop). */
  const [inspectorSurface, setInspectorSurface] = useState<InspectorSurface>("hop");
  const awardedRef = useRef(false);
  const completeLesson = useProgressStore((s) => s.completeLesson);
  const recordAnswer = useProgressStore((s) => s.recordAnswer);
  const unlockAchievement = useProgressStore((s) => s.unlockAchievement);

  const { state, currentStep, index, totalSteps, isComplete, lastAnswer, whatChanged, activePacket } = snapshot;
  const canAdvance = engine.canAdvance();

  const nodes = useMemo(() => GRAPH_NODES.map((n) => ({ ...n, kind: (n.id === "R1" || n.id === "R6" ? "pe-router" : "p-router") as "pe-router" | "p-router" })), []);
  const journeyPath = state.journey.map((h) => h.router);
  const linkComp = state.linkProtection;
  const nodeComp = state.nodeProtection;
  const linkReadiness = linkComp ? determineProtectionReadiness(linkComp, state.links) : "NOT_CONFIGURED";
  const nodeReadiness = nodeComp ? determineProtectionReadiness(nodeComp, state.links) : "NOT_CONFIGURED";
  const primaryOrRepairPath: RouterId[] = journeyPath.length > 0 ? journeyPath : ["R1", "R2", "R4", "R6"];
  const bestPathEdgeIds = linkIdsOnPath(primaryOrRepairPath, state.links);

  const displayNodes = nodes.map((n) => {
    if (n.id === "R1") return { ...n, subLabel: "Headend" };
    if (n.id === "R2") return { ...n, subLabel: "PLR" };
    if (n.id === "R6") return { ...n, subLabel: "Destination" };
    return n;
  });
  const edges: GraphEdge[] = GRAPH_EDGES.map((e) => {
    const isUp = !state.failedLinkIds.includes(e.id) && state.failedNode !== e.a && state.failedNode !== e.b;
    const currentMetric = state.links.find((l) => l.id === e.id)?.metric;
    return { ...e, state: isUp ? ("full" as const) : ("down" as const), cost: topoView === "igp" ? currentMetric : undefined };
  });
  const activeNodeIds = activePacket ? [activePacket.from, activePacket.to] : [];
  const packetFrom = activePacket ? nodes.find((n) => n.id === activePacket.from) : undefined;
  const packetTo = activePacket ? nodes.find((n) => n.id === activePacket.to) : undefined;

  // --- visibility gates, keyed off STEP_IDX (never off content strings) ---
  const showTerms = index >= STEP_IDX.protectedResourceIntro;
  const showPostConvergence = index >= STEP_IDX.postConvergenceIntro && index < STEP_IDX.repairListCompute;
  const showPSpace = index >= STEP_IDX.pSpaceCompute && index < STEP_IDX.repairListCompute;
  const showQSpace = index >= STEP_IDX.qSpaceCompute && index < STEP_IDX.repairListCompute;
  const showRepairList = index >= STEP_IDX.repairListCompute && !!linkComp?.repairSegments.length;
  const showRepairComputation = index >= STEP_IDX.postConvergenceIntro && index < STEP_IDX.protectionReady;
  const showProtectionCard = index >= STEP_IDX.protectionReady;
  const showRecoveryTimeline = index >= STEP_IDX.recoveryTimeline && index < STEP_IDX.nodeProtectionCompute;
  const showProtectionComparison = index >= STEP_IDX.protectionComparison && index < STEP_IDX.troubleshootingIntro;
  const showTroubleshoot = index >= STEP_IDX.troubleshootingIntro;
  const showViews = index >= STEP_IDX.protectionReady;
  const sidDatabase = useMemo(() => buildSidDatabase(state.links, focusRouter), [state.links, focusRouter]);
  const cliCommands = useMemo(() => buildSrTiLfaCliCommands(state, focusRouter), [state, focusRouter]);
  const lastHop = state.journey[state.journey.length - 1];

  const toSegmentRows = (comp: TiLfaComputation | undefined, activeLabel?: number): SegmentListRow[] => {
    if (!comp) return [];
    return comp.repairSegments.map((s) => ({
      order: s.order,
      sid: s.type === "NODE" ? deriveNodeSidLabel(s.target) : 24000 + s.order,
      type: s.type,
      owner: s.type === "ADJ" ? comp.postConvergencePath?.[s.order] : undefined,
      target: s.target,
      scope: s.type === "NODE" ? "GLOBAL" : "LOCAL",
      active: activeLabel !== undefined && (s.type === "NODE" ? deriveNodeSidLabel(s.target) : 24000 + s.order) === activeLabel,
      completed: false,
      explanation: s.type === "NODE" ? `Reach ${s.target} via its own current shortest path — matches the desired sub-path exactly, so a Node SID alone suffices.` : `Force the specific hop to ${s.target} — the natural shortest path from here does not match the desired safe sub-path.`,
    }));
  };
  const activeRepairLabel = state.packet?.labels.find((l) => l.purpose === "repair")?.value;
  const linkSegmentRows = toSegmentRows(linkComp, activeRepairLabel);

  const postConvergence = useMemo(() => computePostConvergencePath(BASE_LINKS, PLR, DESTINATION, "LINK", PROTECTED_LINK), []);
  const preFailurePath = ["R2", "R4", "R6"];

  const repairComputationStages: RepairComputationStage[] = linkComp
    ? [
        { id: "failure-model", label: "Failure Model", value: `${linkComp.protectionType} ${linkComp.protectedResource}`, explanation: "What's being protected — a link or a node — determines which paths count as safe." },
        { id: "post-convergence", label: "Post-Convergence Path", value: linkComp.postConvergencePath?.join(" → ") ?? "—", explanation: "Real SPF, with the protected resource actually removed from the graph — this is where the packet should end up." },
        { id: "p-space", label: "P-Space", value: linkComp.pSpace.join(", ") || "(empty)", explanation: "Nodes R2's own shortest path reaches without the protected resource." },
        { id: "q-space", label: "Q-Space", value: linkComp.qSpace.join(", ") || "(empty)", explanation: "Nodes whose own shortest path reaches R6 without the protected resource." },
        { id: "pq-candidate", label: "PQ Candidate", value: linkComp.repairPoint ?? "none", explanation: "In both spaces — safe to repair toward. Closest-to-destination tie-break among multiple candidates." },
        { id: "repair-list", label: "Repair Segment List", value: linkComp.repairSegments.map((s) => `${s.type}(${s.target})`).join(", ") || "(none)", explanation: "Minimal segment list reproducing the safe sub-path from R2 to the repair point." },
      ]
    : [];

  const diagnosticLayers: DiagnosticLayer[] = [
    { label: "Physical Topology", status: "healthy" },
    { label: "IGP Before Failure", status: "healthy" },
    { label: "SR Capability", status: "healthy" },
    { label: "R6 Node SID", status: "healthy" },
    { label: "Protected Resource Detection", status: "healthy" },
    { label: "TI-LFA Configuration", status: "healthy" },
    { label: "Repair Entry Installed", status: "healthy" },
    { label: "Repair Computed From CURRENT Topology", status: state.troubleshooting.started && !state.troubleshooting.recomputed ? "failing" : state.troubleshooting.started ? "healthy" : "unknown" },
    { label: "Repair Avoids Protected Resource", status: state.troubleshooting.started && !state.troubleshooting.recomputed ? "failing" : state.troubleshooting.started ? "healthy" : "unknown" },
    { label: "Local Repair Activation", status: "healthy" },
    { label: "Repair Packet Delivery", status: state.troubleshooting.started && !state.troubleshooting.verified ? "failing" : state.troubleshooting.started ? "healthy" : "unknown" },
    { label: "Global Convergence", status: "healthy" },
  ];

  const recoveryEvents: RecoveryEvent[] = useMemo(() => {
    const events: RecoveryEvent[] = [
      { id: "t0", timeLabel: "t0", event: "Primary path installed", status: "healthy", path: "R1 → R2 → R4 → R6" },
    ];
    if (linkComp?.repairPoint) events.push({ id: "t1", timeLabel: "t1", event: "TI-LFA repair precomputed", status: "info", explanation: `Repair point ${linkComp.repairPoint}, segments ${linkComp.repairSegments.map((s) => s.type).join(",")}` });
    if (linkReadiness === "READY") events.push({ id: "t2", timeLabel: "t2", event: "Protection READY", status: "healthy" });
    if (index >= STEP_IDX.protectionReady) events.push({ id: "t3", timeLabel: "t3", event: "Packet follows primary", status: "healthy", path: "R1 → R2 → R4 → R6" });
    if (state.failedLinkIds.includes(PROTECTED_LINK)) events.push({ id: "t4", timeLabel: "t4", event: "R2-R4 fails", status: "failure" });
    if (state.linkProtectionLifecycle === "FAILURE_DETECTED" || state.linkProtectionLifecycle === "LOCAL_REPAIR_ACTIVE" || state.linkProtectionLifecycle === "CONVERGING" || state.linkProtectionLifecycle === "CONVERGED") events.push({ id: "t5", timeLabel: "t5", event: "R2 detects failure locally", status: "repair" });
    if (state.linkProtectionLifecycle === "LOCAL_REPAIR_ACTIVE" || state.linkProtectionLifecycle === "CONVERGING" || state.linkProtectionLifecycle === "CONVERGED") events.push({ id: "t6", timeLabel: "t6", event: "Repair segment list activated", status: "repair", path: linkComp?.postConvergencePath?.join(" → ") });
    if (state.journey.some((h) => h.action === "PUSH_REPAIR")) events.push({ id: "t7", timeLabel: "t7", event: "Packet enters repair path", status: "repair" });
    if (state.journey.some((h) => h.action === "POP_REPAIR")) events.push({ id: "t8", timeLabel: "t8", event: "Packet reaches the repair point", status: "repair" });
    if (state.journey.some((h) => h.action === "DELIVER" && h.router === "R6")) events.push({ id: "t9", timeLabel: "t9", event: "Original SR forwarding resumes", status: "healthy" });
    if (state.reoptimized) events.push({ id: "t10", timeLabel: "t10", event: "IGP failure information propagates", status: "info" });
    if (state.linkProtectionLifecycle === "CONVERGING" || state.linkProtectionLifecycle === "CONVERGED") events.push({ id: "t11", timeLabel: "t11", event: "SPF converges", status: "info", path: state.reoptimized?.path.join(" → ") });
    if (state.linkProtectionLifecycle === "CONVERGED") events.push({ id: "t12", timeLabel: "t12", event: "Repair segment no longer needed for active forwarding", status: "healthy" });
    return events;
  }, [state, linkComp, linkReadiness, index]);

  // --- 3D derived state ---
  const nodes3DBase = useMemo(() => layoutTo3D(nodes), [nodes]);
  const visitedRouters = new Set(state.journey.map((h) => h.router));
  const nodes3D = nodes3DBase.map((n) => {
    let status: Node3DStatus = "idle";
    if (n.id === selectedNodeId || n.id === enteredDeviceId) status = "selected";
    else if (activePacket && (n.id === activePacket.from || n.id === activePacket.to)) status = "active";
    else if (visitedRouters.has(n.id as RouterId)) status = "onPath";
    const badges: string[] = [];
    if (n.id === "R1") badges.push("HEADEND");
    if (n.id === "R2") badges.push("PLR");
    if (n.id === "R6") badges.push("DESTINATION");
    if ((showPSpace || showRepairComputation) && linkComp?.pSpace.includes(n.id as RouterId)) badges.push("P-SPACE");
    if ((showQSpace || showRepairComputation) && linkComp?.qSpace.includes(n.id as RouterId)) badges.push("Q-SPACE");
    if (linkComp?.repairPoint === n.id) badges.push("PQ / REPAIR PT");
    return { ...n, status, badges: badges.length ? badges : undefined };
  });
  const links3D: Link3DData[] = GRAPH_EDGES.map((e) => ({
    id: e.id,
    a: e.a,
    b: e.b,
    active: activePacket ? (e.a === activePacket.from && e.b === activePacket.to) || (e.b === activePacket.from && e.a === activePacket.to) : false,
    onPath: bestPathEdgeIds.includes(e.id),
  }));
  const activePacket3D: ActivePacket3D | undefined = activePacket && nodes3D.some((n) => n.id === activePacket.from) && nodes3D.some((n) => n.id === activePacket.to) ? { packet: activePacket, fromId: activePacket.from, toId: activePacket.to } : undefined;
  const questionActive = !isComplete && !!currentStep?.question && lastAnswer?.stepId !== currentStep.id;
  const selectedNode3D = nodes3D.find((n) => n.id === selectedNodeId);

  const activeDeviceId = DEVICE_ROUTERS.find((r) => traceFor(r, state)?.activeStageId !== undefined);
  const effectiveDeviceId = cameraMode === "device" ? enteredDeviceId : cameraMode === "packetFollow" && autoEnterDevices ? activeDeviceId : undefined;
  const inDeviceMode = !!effectiveDeviceId;
  const deviceTrace = effectiveDeviceId ? traceFor(effectiveDeviceId, state) : undefined;

  const followPacketIntoCurrentDevice = () => {
    if (!packetSelected || cameraMode !== "device") return;
    const snap = engine.getSnapshot();
    const nextDevice = DEVICE_ROUTERS.find((r) => traceFor(r, snap.state)?.activeStageId !== undefined);
    if (nextDevice) setEnteredDeviceId(nextDevice);
  };

  const deviceInterfaces = effectiveDeviceId ? interfacesFor(effectiveDeviceId, state) : [];
  const devicePacketFrames: PacketStackFrame[] | undefined = effectiveDeviceId ? packetFramesFor(state) : undefined;

  const followNode3D = cameraMode === "packetFollow" && activePacket ? nodes3D.find((n) => n.id === (state.packetAt ?? activePacket.to)) : undefined;
  const focusPosition3D: [number, number, number] | undefined =
    cameraMode === "freeOrbit" ? undefined : inDeviceMode ? [0, 0, deviceXray ? -0.2 : 0] : cameraMode === "packetFollow" ? followNode3D?.position : selectedNode3D?.position;
  const eyeOffset3D: [number, number, number] | undefined = inDeviceMode ? (deviceXray ? [0.6, 2.6, 5.2] : [2.1, 1.5, 3.8]) : undefined;

  const explainTargetId = (effectiveDeviceId ?? selectedNodeId ?? followNode3D?.id) as RouterId | undefined;
  const nodeExplanation = explainTargetId ? explainNode(state, explainTargetId) : undefined;
  const xrayPacket = activePacket && (selectedNodeId === activePacket.from || selectedNodeId === activePacket.to) ? activePacket : undefined;
  const selectedLinkDetail = selectedLinkId ? linkDetailFor(selectedLinkId, state) : undefined;
  const packetCurrentDeviceLabel = effectiveDeviceId ?? state.packetAt ?? activePacket?.from ?? "—";
  const packetDirection = primaryOrRepairPath.join(" → ");
  const devicePacketForTab = xrayPacket ?? (effectiveDeviceId && state.packetAt === effectiveDeviceId ? activePacket : undefined);

  // --- Generic 3D object-focus sub-state (mirrors mpls-ldp §25) — layered
  // ON TOP of `cameraMode`, never a 5th camera mode. Reuses
  // `deviceTrace`/`deviceInterfaces`/`devicePacketFrames`.
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

  // --- Hop Inspector target (mirrors mpls-ldp §23) — explicit selection
  // wins outright: selectedNodeId > effectiveDeviceId > activeDeviceId.
  const focusInspectDeviceId = (selectedNodeId ?? effectiveDeviceId ?? activeDeviceId) as RouterId | undefined;
  const focusTrace = focusInspectDeviceId ? traceFor(focusInspectDeviceId, state) : undefined;
  const focusInterfaces = focusInspectDeviceId ? interfacesFor(focusInspectDeviceId, state) : undefined;

  // --- HopTimeline data — every step carrying a real MPLS data-plane
  // packet. This lesson never models separate control-plane signaling
  // packets, and every journey-appending step here already carries a
  // `packet` field of its own (unlike sr-policy's two packet-less
  // classification/policy-unavailable steps), so no narrative-step
  // fallback map is needed.
  const journeyStepIndices = srTiLfaSteps.map((s, i) => ({ s, i })).filter(({ s, i }) => i <= index && !!s.packet);
  const journeyHopEntries = journeyStepIndices.map(({ s, i }) => ({ id: s.id, label: s.label, index: i }));

  // --- Historical inspection (mirrors mpls-ldp §3/§4) — reuses
  // ScenarioEngine's OWN `getStateAt` snapshot. Presentation-only — never
  // calls `engine.goTo()`.
  const historicalState = historicalIndex !== undefined ? engine.getStateAt(historicalIndex) : undefined;
  const historicalStep = historicalIndex !== undefined ? srTiLfaSteps[historicalIndex] : undefined;
  const historicalPacket = historicalStep && historicalState ? historicalStep.packet?.(historicalState) : undefined;
  const historicalDeviceId = historicalStep && historicalState ? deviceForStep(historicalState, historicalPacket) : undefined;
  const historicalTrace = historicalDeviceId && historicalState ? traceFor(historicalDeviceId, historicalState) : undefined;
  const historicalInterfaces = historicalDeviceId && historicalState ? interfacesFor(historicalDeviceId, historicalState) : undefined;

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
      if (iface.extra) fields.push(...iface.extra);
      return { title: iface.name, fields };
    }
    return { title: target.id, fields: [] };
  }

  function explorerTabsFor(router: RouterId): DeviceExplorerTab[] {
    if (!nodeExplanation) return [];
    const overviewTab: DeviceExplorerTab = {
      id: "overview",
      label: "Overview",
      content: (
        <div className="rounded-lg border border-pv-cyan/30 bg-pv-cyan/5 p-3">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-pv-cyan-soft">Current Action</p>
          <p className="text-sm text-pv-text">{nodeExplanation.currentAction}</p>
        </div>
      ),
    };
    const hardwareTab: DeviceExplorerTab = { id: "hardware", label: "Hardware", content: <p className="text-xs text-pv-text-muted">Generic stylized {nodeExplanation.deviceType.toLowerCase()} chassis — {deviceInterfaces.length} physical interfaces.</p> };
    const interfacesTab: DeviceExplorerTab = { id: "interfaces", label: "Interfaces", content: <InterfaceListTab interfaces={deviceInterfaces} selectedInterfaceId={selectedInterfaceId} onSelectInterface={setSelectedInterfaceId} /> };
    const igpTab: DeviceExplorerTab = {
      id: "igp",
      label: "IGP",
      content: (
        <div className="space-y-1.5 pv-mono text-[11px]">
          {state.links.filter((l) => l.a === router || l.b === router).map((l) => (
            <Row key={l.id} label={l.id} value={`metric ${l.metric}${state.failedLinkIds.includes(l.id) ? " (DOWN)" : ""}`} />
          ))}
        </div>
      ),
    };
    const postConvergenceTab: DeviceExplorerTab = {
      id: "post-convergence",
      label: "Post-Convergence SPF",
      content: (
        <div className="space-y-1 pv-mono text-[11px]">
          <Row label="Pre-Failure SPF (R2→R6)" value={preFailurePath.join(" → ")} />
          <Row label="Post-Failure SPF (R2→R6)" value={postConvergence?.path.join(" → ") ?? "—"} />
          <Row label="Post-Failure Cost" value={String(postConvergence?.cost ?? "—")} />
        </div>
      ),
    };
    const srgbTab: DeviceExplorerTab = {
      id: "srgb",
      label: "SRGB",
      content: (
        <div className="space-y-1 pv-mono text-[11px]">
          <Row label="Range" value="16000-16999" />
          <Row label="Router" value={router} />
          <Row label="Node SID" value={String(deriveNodeSidLabel(router))} />
        </div>
      ),
    };
    const sidDbTab: DeviceExplorerTab = { id: "sid-db", label: "SID Database", content: <SidTableViewer rows={buildSidDatabase(state.links, router)} srgb={{ start: 16000, end: 16999 }} /> };
    const pqSpaceTab: DeviceExplorerTab = {
      id: "pq-space",
      label: "P/Q Space",
      content: linkComp ? (
        <RepairSpaceViewer nodes={ALL_ROUTERS.map((r) => ({ id: r, label: r }))} pSpace={linkComp.pSpace} qSpace={linkComp.qSpace} pqCandidates={linkComp.pqCandidates} selectedRepairNode={linkComp.repairPoint} protectedResource={linkComp.protectedResource} plr={linkComp.plr} destination={linkComp.destination} />
      ) : (
        <p className="text-xs text-pv-text-faint">Not computed yet.</p>
      ),
    };
    const repairsTab: DeviceExplorerTab = {
      id: "ti-lfa-repairs",
      label: "TI-LFA Repairs",
      content: linkComp ? (
        <div className="space-y-1 pv-mono text-[11px]">
          <Row label="Destination" value={linkComp.destination} />
          <Row label="Protected Resource" value={linkComp.protectedResource} />
          <Row label="Protection Type" value={linkComp.protectionType} />
          <Row label="Repair State" value={linkReadiness} />
          <Row label="Post-Convergence Path" value={linkComp.postConvergencePath?.join(" → ") ?? "—"} />
          <Row label="P-Space" value={linkComp.pSpace.join(", ") || "(empty)"} />
          <Row label="Q-Space" value={linkComp.qSpace.join(", ") || "(empty)"} />
          <Row label="PQ Node" value={linkComp.repairPoint ?? "none"} />
          <Row label="Repair Segment List" value={linkComp.repairSegments.map((s) => `${s.type}(${s.target})`).join(", ") || "(none)"} />
          <Row label="Installed" value={linkComp.repairSegments.length > 0 ? "YES" : "NO"} />
          <Row label="Active" value={state.linkProtectionLifecycle === "LOCAL_REPAIR_ACTIVE" ? "YES" : "NO"} />
          <Row label="Validation" value={validateRepairList(linkComp, state.links).reason} />
        </div>
      ) : (
        <p className="text-xs text-pv-text-faint">No protection computed yet.</p>
      ),
    };
    const forwardingTab: DeviceExplorerTab = {
      id: "forwarding",
      label: "MPLS Forwarding",
      content: (() => {
        const hop = state.journey.filter((h) => h.router === router).slice(-1)[0];
        return hop ? (
          <div className="space-y-0.5 pv-mono text-[11px]">
            <Row label="Input" value={hop.input} />
            <Row label="Lookup" value={hop.lookup} />
            <Row label="Action" value={hop.action} />
            <Row label="Output" value={hop.output} />
          </div>
        ) : (
          <p className="text-xs text-pv-text-faint">No forwarding entry for this router right now.</p>
        );
      })(),
    };
    const packetTab: DeviceExplorerTab = {
      id: "packet",
      label: "Packet",
      content: (
        <div className="space-y-2">
          <p className="pv-mono text-[11px] text-pv-text-muted">
            Before: <span className="text-pv-text">{nodeExplanation.packetBefore ?? "—"}</span>
          </p>
          <p className="pv-mono text-[11px] text-pv-text-muted">
            After: <span className="text-pv-cyan-soft">{nodeExplanation.packetAfter ?? "—"}</span>
          </p>
          {devicePacketForTab ? <PacketInspector packet={devicePacketForTab} /> : <p className="text-xs text-pv-text-faint">No packet at this device right now.</p>}
        </div>
      ),
    };
    const cliTab: DeviceExplorerTab = { id: "cli", label: "CLI", content: <CLIOutputPanel commands={buildSrTiLfaCliCommands(state, router)} /> };

    if (router === "R2") return [overviewTab, hardwareTab, interfacesTab, igpTab, postConvergenceTab, srgbTab, sidDbTab, pqSpaceTab, repairsTab, forwardingTab, packetTab, cliTab];
    if (router === "R3" || router === "R5") return [overviewTab, hardwareTab, interfacesTab, sidDbTab, forwardingTab, packetTab, cliTab];
    return [overviewTab, hardwareTab, interfacesTab, forwardingTab, packetTab, cliTab];
  }

  useEffect(() => {
    if (isComplete && !awardedRef.current) {
      awardedRef.current = true;
      completeLesson("sr-ti-lfa", 600);
      unlockAchievement("convergence-architect");
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
    engine.restart();
    awardedRef.current = false;
    setCameraMode("overview");
    setEnteredDeviceId(undefined);
    setSelectedNodeId(undefined);
    setSelectedLinkId(undefined);
    setPacketSelected(false);
    setTopoView("physical");
    setAutoPlay(false);
    setFocusedObject(undefined);
    setHistoricalIndex(undefined);
    setInspectorSurface("hop");
  };

  // --- Manual object focus / historical inspection vs. Play — resuming
  // playback takes priority (mirrors mpls-ldp / sr-mpls-foundations).
  const handleToggleAutoPlay = () => {
    if (!autoPlay) {
      setFocusedObject(undefined);
      setHistoricalIndex(undefined);
      setInspectorSurface("hop");
    }
    setAutoPlay((v) => !v);
  };

  const nextLabel = currentStep?.question && !lastAnswer ? "Answer to continue" : currentStep?.requiresState && !canAdvance ? "Apply the correct fix to continue" : "Next Step →";

  return (
    <div className="mx-auto max-w-7xl px-6 py-10">
      <div className="mb-6">
        <Badge tone="cyan" className="mb-3">
          SR-MPLS TI-LFA · P-SPACE · Q-SPACE · LOCAL REPAIR
        </Badge>
        <h1 className="text-2xl font-semibold text-pv-text sm:text-3xl">Repairing Traffic Locally — Without The Headend</h1>
        <p className="mt-2 max-w-3xl text-sm text-pv-text-muted">
          How can an SR router repair traffic locally after a failure — without waiting for the headend, and without
          pre-signaling an RSVP bypass tunnel? The PLR precomputes a post-convergence path, derives P-Space and Q-Space,
          selects a PQ repair point, and builds a minimal SR repair segment list — all before any failure happens.
        </p>
      </div>

      <div className="mb-4 grid gap-2 sm:grid-cols-4">
        {WHY_TILFA.map((item) => (
          <GlassPanel key={item.q} className="p-3">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-pv-cyan-soft">{item.q}</p>
            <p className="text-[11px] leading-snug text-pv-text-muted">{item.a}</p>
          </GlassPanel>
        ))}
      </div>

      {showTerms && (
        <div className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {TERMS.map((t) => (
            <GlassPanel key={t.term} className="p-2.5" title={t.meaning}>
              <p className="pv-mono text-xs font-bold text-pv-text">{t.term}</p>
              <p className="text-[10px] text-pv-text-faint">{t.expansion}</p>
            </GlassPanel>
          ))}
        </div>
      )}

      <div className="mb-4 flex gap-1 overflow-x-auto pb-2">
        {srTiLfaSteps.map((step, i) => (
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
        <TopologyModeSwitcher options={[{ value: "physical", label: "Physical" }, { value: "igp", label: "IGP" }]} value={topoView} onChange={setTopoView} />
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
              onChange={(v) => {
                setCameraMode(v);
                if (v === "device" && !enteredDeviceId) setEnteredDeviceId(selectedNodeId ?? activeDeviceId ?? "R2");
                if (v === "overview") {
                  setEnteredDeviceId(undefined);
                  setSelectedNodeId(undefined);
                }
                if (v === "freeOrbit") setEnteredDeviceId(undefined);
              }}
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
            <TopologyModeSwitcher options={[{ value: "off", label: "Normal View" }, { value: "on", label: "X-Ray Packet View" }]} value={xrayMode ? "on" : "off"} onChange={(v) => setXrayMode(v === "on")} tone="violet" />
          </>
        )}
        {showViews && <PlaneViewSwitcher value={planeView} onChange={setPlaneView} />}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_400px]">
        {/* MAIN COLUMN */}
        <div className="space-y-6">
          {viewMode3D ? (
            <>
              <TopologyFrame questionActive={questionActive} onExpand={() => setFocusMode(true)}>
              {focusMode ? (
                // Focus Mode renders its own full-size <NetworkScene3D> below —
                // avoid a second, fully hidden WebGL canvas running behind the
                // modal (one-canvas invariant, see mpls-ldp/sr-mpls-foundations).
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
                        onFocusObject: setFocusedObject,
                        focusedObjectId: activeFocusedObject?.id,
                      }
                    : undefined
                }
              />
              )}
              </TopologyFrame>

              {packetSelected && activePacket && (
                <PacketDetailPanel
                  packet={activePacket}
                  currentDevice={packetCurrentDeviceLabel}
                  direction={packetDirection}
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
                  <NodeInspectorPanel explanation={nodeExplanation} packet={xrayPacket} xrayEnabled={xrayMode}>
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
              <GraphTopologyViewer nodes={displayNodes} edges={edges} activeNodeIds={activeNodeIds} bestPathEdgeIds={bestPathEdgeIds} onEdgeClick={(id) => setSelectedLinkId(id)}>
                {activePacket && packetFrom && packetTo && <GraphPacket packet={activePacket} from={packetFrom} to={packetTo} />}
              </GraphTopologyViewer>

              {selectedLinkId && !lastHop && linkDetailFor(selectedLinkId, state) && <LinkDetailPanel detail={linkDetailFor(selectedLinkId, state)!} onClose={() => setSelectedLinkId(undefined)} />}

              {lastHop && <ForwardingDecisionCard router={lastHop.router} input={lastHop.input} lookup={lastHop.lookup} action={lastHop.action} output={lastHop.output} />}
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

          {!isComplete && currentStep?.id === "repair-challenge" && <RepairChallenge options={REPAIR_OPTIONS} attempt={state.troubleshooting.repairAttempt} onTry={(choice) => engine.act({ choice })} />}

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

          {showPostConvergence && !isComplete && (
            <RouteEvolutionViewer
              title="Pre-Failure vs. Post-Failure SPF (R2 → R6)"
              oldLabel="PRE-FAILURE SPF"
              newLabel="POST-FAILURE SPF"
              fields={[{ label: "R2 → R6 path", oldValue: preFailurePath.join(" → "), newValue: postConvergence?.path.join(" → ") ?? "—", decisive: true }]}
              winnerReason={`${PROTECTED_LINK} is no longer usable — TI-LFA repairs toward this recomputed path before R2 itself has reconverged.`}
            />
          )}

          {showRepairComputation && !isComplete && linkComp && <RepairComputationViewer title="TI-LFA Repair Computation Pipeline" stages={repairComputationStages} />}

          {(showPSpace || showQSpace) && !isComplete && linkComp && (
            <RepairSpaceViewer
              title="P-Space / Q-Space"
              nodes={ALL_ROUTERS.map((r) => ({ id: r, label: r }))}
              pSpace={linkComp.pSpace}
              qSpace={linkComp.qSpace}
              pqCandidates={linkComp.pqCandidates}
              selectedRepairNode={index >= STEP_IDX.pqSelect ? linkComp.repairPoint : undefined}
              protectedResource={linkComp.protectedResource}
              plr={linkComp.plr}
              destination={linkComp.destination}
            />
          )}

          {showRepairList && !isComplete && linkComp && <RepairListViewer protectedResource={linkComp.protectedResource} repairTarget={linkComp.repairPoint} segments={linkSegmentRows} />}

          {index === STEP_IDX.multiSidExample && !isComplete && state.advMultiSidSegments && (
            <RepairListViewer
              title="Advanced Example — Repair Segment List"
              protectedResource="R4 (illustrative)"
              repairTarget="R5"
              segments={state.advMultiSidSegments.map((s) => ({
                order: s.order,
                sid: s.type === "NODE" ? deriveNodeSidLabel(s.target) : 24000 + s.order,
                type: s.type,
                target: s.target,
                scope: s.type === "NODE" ? "GLOBAL" : "LOCAL",
                active: false,
                completed: false,
                explanation: s.type === "NODE" ? `Reach ${s.target} via its own current shortest path.` : `Force the specific hop to ${s.target} — the natural shortest path does not match the desired safe sub-path in this illustration.`,
              }))}
            />
          )}

          {showTerms && !isComplete && index < STEP_IDX.repairListCompute && <SidTableViewer rows={sidDatabase} srgb={{ start: 16000, end: 16999 }} />}

          {showProtectionCard && !isComplete && linkComp && (
            <ProtectionPathViewer
              title="TI-LFA Link Protection"
              primaryPath={["R1", "R2", "R4", "R6"]}
              backupPath={state.linkProtectionLifecycle === "LOCAL_REPAIR_ACTIVE" || state.linkProtectionLifecycle === "CONVERGING" ? linkComp.postConvergencePath : undefined}
              backupPathLabel="Repair Path"
              protectedResource={linkComp.protectedResource}
              plr={linkComp.plr}
              mergePoint={linkComp.repairPoint}
              mergePointLabel="REPAIR PT"
              mergePointTitle="Repair Point"
              protectionType="LINK"
              readiness={linkReadiness === "NOT_CONFIGURED" ? "NOT CONFIGURED" : linkReadiness}
              active={state.linkProtectionLifecycle === "LOCAL_REPAIR_ACTIVE"}
              failure={state.failedLinkIds.includes(PROTECTED_LINK) ? `${PROTECTED_LINK} is down` : undefined}
            />
          )}

          {showRecoveryTimeline && !isComplete && <RecoveryTimelineViewer title="PacketVerse Simulated TI-LFA Recovery Timeline" events={recoveryEvents} />}

          {index >= STEP_IDX.protectionReady && index < STEP_IDX.nodeProtectionCompute && !isComplete && (
            <GlassPanel className="p-4">
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-pv-text-muted">PacketVerse TI-LFA Recovery Lifecycle</h4>
              <p className="pv-mono text-xs text-pv-cyan-soft">{state.linkProtectionLifecycle}</p>
              <p className="mt-1 text-[11px] text-pv-text-muted">{TI_LFA_LIFECYCLE_INFO[state.linkProtectionLifecycle].meaning}</p>
              <p className="mt-1 text-[11px] text-pv-text-faint">Why: {TI_LFA_LIFECYCLE_INFO[state.linkProtectionLifecycle].why}</p>
            </GlassPanel>
          )}

          {showProtectionComparison && !isComplete && nodeComp && (
            <div className="grid gap-4 sm:grid-cols-2">
              <ProtectionPathViewer
                title="LINK PROTECTION"
                primaryPath={["R1", "R2", "R4", "R6"]}
                backupPath={linkComp?.postConvergencePath}
                backupPathLabel="Repair Path"
                protectedResource={PROTECTED_LINK}
                plr={PLR}
                mergePoint={linkComp?.repairPoint}
                mergePointLabel="REPAIR PT"
                mergePointTitle="Repair Point"
                protectionType="LINK"
                readiness={linkReadiness === "NOT_CONFIGURED" ? "NOT CONFIGURED" : linkReadiness}
                active={false}
              />
              <ProtectionPathViewer
                title="NODE PROTECTION"
                primaryPath={["R1", "R2", "R4", "R6"]}
                backupPath={nodeComp.postConvergencePath}
                backupPathLabel="Repair Path"
                protectedResource={PROTECTED_NODE}
                plr={PLR}
                mergePoint={nodeComp.repairPoint}
                mergePointLabel="REPAIR PT"
                mergePointTitle="Repair Point"
                protectionType="NODE"
                readiness={nodeReadiness === "NOT_CONFIGURED" ? "NOT CONFIGURED" : nodeReadiness}
                active={false}
              />
            </div>
          )}

          {showTroubleshoot && !isComplete && <TroubleshootingLayers title="Diagnostic Ladder" layers={diagnosticLayers} />}

          {showViews && !isComplete && (
            <PlaneSplitPanel
              show={planeView}
              controlTitle="Control Plane — TI-LFA Precomputation"
              controlRows={[
                { label: "Protected Resource", value: linkComp?.protectedResource ?? "—" },
                { label: "PLR", value: linkComp?.plr ?? "—" },
                { label: "Repair Point", value: linkComp?.repairPoint ?? "—" },
                { label: "Lifecycle", value: state.linkProtectionLifecycle },
              ]}
              dataTitle="Data Plane — Current MPLS Packet"
              dataRows={
                state.packet
                  ? [
                      { label: "Location", value: state.packetAt ?? "—" },
                      { label: "Labels on wire", value: state.packet.labels.length ? state.packet.labels.map((l) => `${l.value}${l.purpose === "repair" ? " (repair)" : ""}`).join(" / ") : "(none)" },
                    ]
                  : [{ label: "Packet", value: "none in flight" }]
              }
            />
          )}

          {index >= STEP_IDX.multiSidExample && index < STEP_IDX.troubleshootingIntro && !isComplete && (
            <BeforeAfterMetrics
              title="Same Post-Convergence Destination, Different Repair Lists"
              beforeLabel="LINK PROTECTION"
              afterLabel="NODE PROTECTION"
              metrics={[
                { label: "Repair segments", before: String(linkComp?.repairSegments.length ?? 0), after: String(nodeComp?.repairSegments.length ?? 0), improved: false },
                { label: "Repair point", before: linkComp?.repairPoint ?? "—", after: nodeComp?.repairPoint ?? "—", improved: false },
              ]}
            />
          )}

          {isComplete && (
            <GlassPanel strong glow="success" className="flex flex-col items-center gap-4 p-10 text-center">
              <Badge tone="success">Convergence Architect</Badge>
              <h2 className="text-2xl font-semibold text-pv-text">You Repaired It Locally</h2>
              <p className="max-w-md text-sm text-pv-text-muted">
                You precomputed a post-convergence path, derived P-Space and Q-Space, selected a PQ repair point, and built
                a minimal SR repair segment list — activated locally at the PLR, before the headend or global convergence
                were ever involved. You protected both a link and a node, diagnosed a stale repair, and verified the fix
                with a real packet. +600 XP awarded.
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
                onChange={(v) => {
                  setCameraMode(v);
                  if (v === "device" && !enteredDeviceId) setEnteredDeviceId(selectedNodeId ?? activeDeviceId ?? "R2");
                  if (v === "overview") {
                    setEnteredDeviceId(undefined);
                    setSelectedNodeId(undefined);
                  }
                  if (v === "freeOrbit") setEnteredDeviceId(undefined);
                }}
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
                  Step {index + 1} / {totalSteps}
                </Badge>
                <span className="truncate text-xs font-medium text-pv-text">{currentStep?.label}</span>
              </div>
              {questionActive ? (
                <span className="shrink-0 rounded-full border border-pv-warning/40 bg-pv-warning/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-pv-warning">
                  Prediction pending — answer in the panel to continue
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
                  setCameraMode("overview");
                  setEnteredDeviceId(undefined);
                  setSelectedNodeId(undefined);
                }}
              />
            ) : inspectorSurface === "device" ? (
              inDeviceMode ? (
                <div className="space-y-3">
                  <TopologyModeSwitcher
                    options={[{ value: "hop", label: "Hop" }, { value: "device", label: "Device" }]}
                    value={inspectorSurface}
                    onChange={setInspectorSurface}
                    tone="violet"
                  />
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
                <NodeInspectorPanel explanation={nodeExplanation} packet={xrayPacket} xrayEnabled={false} />
              ) : (
                <GlassPanel className="p-4">
                  <p className="text-xs text-pv-text-faint">Select a device, or advance the lesson, to inspect a hop.</p>
                </GlassPanel>
              )
            ) : historicalIndex !== undefined && historicalTrace ? (
              <div className="space-y-3">
                {inDeviceMode && (
                  <TopologyModeSwitcher
                    options={[{ value: "hop", label: "Hop" }, { value: "device", label: "Device" }]}
                    value={inspectorSurface}
                    onChange={setInspectorSurface}
                    tone="violet"
                    disabledValues={["device"]}
                  />
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
                {inDeviceMode && (
                  <TopologyModeSwitcher
                    options={[{ value: "hop", label: "Hop" }, { value: "device", label: "Device" }]}
                    value={inspectorSurface}
                    onChange={setInspectorSurface}
                    tone="violet"
                  />
                )}
                <HopInspectorPanel
                  trace={focusTrace}
                  deviceName={focusInspectDeviceId ?? "—"}
                  interfaces={focusInterfaces}
                  onFocusNextHop={(id) => {
                    setSelectedNodeId(id as RouterId);
                    setInspectorSurface("hop");
                    if (cameraMode === "device") setEnteredDeviceId(id as RouterId);
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
                currentIndex={historicalIndex !== undefined ? journeyHopEntries.findIndex((h) => h.index === historicalIndex) : journeyHopEntries.length - 1}
                onSelectHop={(i) => {
                  const entry = journeyHopEntries[i];
                  if (!entry) return;
                  setInspectorSurface("hop");
                  if (entry.index === index) {
                    // The rightmost/current entry — return to live inspection.
                    setHistoricalIndex(undefined);
                    return;
                  }
                  setHistoricalIndex(entry.index);
                  setFocusedObject(undefined);
                  const histState = engine.getStateAt(entry.index);
                  const histStep = srTiLfaSteps[entry.index];
                  const histPacket = histStep && histState ? histStep.packet?.(histState) : undefined;
                  const router = histState ? deviceForStep(histState, histPacket) : undefined;
                  if (router) {
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
                onToggleFollowPacket={() => {
                  const next = cameraMode === "packetFollow" ? "overview" : "packetFollow";
                  setCameraMode(next);
                  if (next === "overview") {
                    setEnteredDeviceId(undefined);
                    setSelectedNodeId(undefined);
                  }
                }}
              />
            </div>
          }
        />
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-pv-text-faint">{label}</span>
      <span className="text-pv-text">{value}</span>
    </div>
  );
}

function RepairChallenge({ options, attempt, onTry }: { options: { id: string; label: string }[]; attempt?: { choice: string; correct: boolean }; onTry: (choice: string) => void }) {
  return (
    <GlassPanel strong className="p-5">
      <p className="mb-3 text-sm font-medium text-pv-text">Choose the correct repair for the stale TI-LFA computation:</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((opt) => {
          const isSelected = attempt?.choice === opt.id;
          const isCorrect = opt.id === "recompute-tilfa";
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
            <span className="font-semibold">✓ TI-LFA recomputed against the current topology.</span>
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
