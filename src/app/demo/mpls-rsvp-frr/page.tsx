"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { clsx } from "clsx";
import { useScenarioEngine } from "@/lib/sim-engine/useScenarioEngine";
import {
  GRAPH_EDGES,
  GRAPH_NODES,
  HEADEND,
  PROTECTED_LINK,
  PROTECTED_NODE,
  STEP_IDX,
  TERMS,
  buildFrrCliCommands,
  buildFrrForwardingState,
  buildPrimaryForwardingState,
  computeActiveForwardingPath,
  createRsvpFrrState,
  determineProtectionReadiness,
  fmtLabel,
  linkIdsOnPath,
  rsvpFrrSteps,
  type Bypass,
  type RouterId,
  type RsvpFrrState,
} from "@/lib/sim-engine/scenarios/rsvpFrr";
import { GraphTopologyViewer, type GraphEdge } from "@/components/network/GraphTopologyViewer";
import { GraphPacket } from "@/components/network/GraphPacket";
import { PacketInspector } from "@/components/network/PacketInspector";
import { ForwardingDecisionCard } from "@/components/protocol/ForwardingDecisionCard";
import { PacketJourneyTimeline } from "@/components/protocol/PacketJourneyTimeline";
import { PlaneSplitPanel } from "@/components/protocol/PlaneSplitPanel";
import { ProtectionPathViewer } from "@/components/protocol/ProtectionPathViewer";
import { RecoveryTimelineViewer, type RecoveryEvent } from "@/components/protocol/RecoveryTimelineViewer";
import { BeforeAfterMetrics } from "@/components/protocol/BeforeAfterMetrics";
import { ProtocolStateMachine } from "@/components/protocol/ProtocolStateMachine";
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

const DEVICE_ROUTERS: RouterId[] = ["R1", "R3", "R4", "R5", "R6", "R7"];
type PathView = "normal" | "failure" | "repair" | "reoptimized";

const WHY_FRR: { q: string; a: string }[] = [
  { q: "WHAT is FRR?", a: "Pre-established local protection that a router near a failure activates immediately — not a faster global recomputation." },
  { q: "WHY use it?", a: "End-to-end reconvergence takes real time; some traffic can't tolerate the interruption while the headend reacts." },
  { q: "WHEN is it used?", a: "Provider cores carrying traffic sensitive to even brief interruptions — voice, video, financial links." },
  { q: "WITHOUT it?", a: "A link or router failure interrupts traffic until the headend notices, recomputes CSPF, and re-signals end to end." },
];

const REPAIR_OPTIONS = [
  { id: "increase-igp-metric", label: "Increase the IGP metric on R3-R5" },
  { id: "restart-rsvp", label: "Restart RSVP on R1" },
  { id: "increase-bandwidth", label: "Increase the primary LSP's bandwidth" },
  { id: "establish-node-protection", label: "Establish a node-protecting bypass (R3 → R4 → R7)" },
];
const WRONG_FEEDBACK: Record<string, string> = {
  "increase-igp-metric": "R5 itself is down. Changing the failed node's link metric does not make the existing bypass node-protecting — its Merge Point is still R5.",
  "restart-rsvp": "The protection-design mismatch is local to the PLR/bypass relationship — RSVP sessions elsewhere are healthy.",
  "increase-bandwidth": "Bandwidth is not the cause. The backup path still terminates at the failed R5 regardless of how much is reserved.",
};

function readinessLabel(r: "READY" | "UNAVAILABLE" | "NOT_CONFIGURED"): "READY" | "UNAVAILABLE" | "NOT CONFIGURED" {
  return r === "NOT_CONFIGURED" ? "NOT CONFIGURED" : r;
}

function activeBypassFor(state: RsvpFrrState): Bypass | undefined {
  if (state.activeBypassId === state.linkBypass?.id) return state.linkBypass;
  if (state.activeBypassId === state.nodeBypass?.id) return state.nodeBypass;
  return undefined;
}

export default function MplsRsvpFrrDemo() {
  const { engine, snapshot } = useScenarioEngine<RsvpFrrState>(createRsvpFrrState(), rsvpFrrSteps);
  const [autoPlay, setAutoPlay] = useState(false);
  const [speed, setSpeed] = useState<0.5 | 1 | 2>(1);
  const [pathView, setPathView] = useState<PathView>("normal");
  const [viewMode3D, setViewMode3D] = useState(false);
  const [planeView, setPlaneView] = useState<"control" | "data" | "both">("both");
  const [focusRouter, setFocusRouter] = useState<RouterId>("R3");
  const [selectedNodeId, setSelectedNodeId] = useState<RouterId | undefined>(undefined);
  const [cameraMode, setCameraMode] = useState<CameraMode>("overview");
  const [enteredDeviceId, setEnteredDeviceId] = useState<RouterId | undefined>(undefined);
  const [deviceXray, setDeviceXray] = useState(true);
  const [autoEnterDevices, setAutoEnterDevices] = useState(true);
  const [selectedInterfaceId, setSelectedInterfaceId] = useState<string | undefined>(undefined);
  const [selectedLinkId, setSelectedLinkId] = useState<string | undefined>(undefined);
  const [packetSelected, setPacketSelected] = useState(false);
  const [xrayMode, setXrayMode] = useState(true);
  const [experimentFail, setExperimentFail] = useState<"link" | "node" | "bypass" | undefined>(undefined);
  const [focusMode, setFocusMode] = useState(false);
  const [focusedObject, setFocusedObject] = useState<FocusTarget3D | undefined>(undefined);
  /** Presentation cursor for HopTimeline inspection (mirrors mpls-ldp's "Historical Timeline Inspection Fix") — a step INDEX, never mutates the live lesson. undefined = inspecting the current/live hop. */
  const [historicalIndex, setHistoricalIndex] = useState<number | undefined>(undefined);
  /** Explicit Hop-vs-Device intent inside Focus Mode ("Shared Focus Mode Inspector Fix") — set by the actual gesture (node click → device; timeline/next-hop/Play → hop). */
  const [inspectorSurface, setInspectorSurface] = useState<InspectorSurface>("hop");
  const completeLesson = useProgressStore((s) => s.completeLesson);
  const recordAnswer = useProgressStore((s) => s.recordAnswer);
  const unlockAchievement = useProgressStore((s) => s.unlockAchievement);
  const awardedRef = useRef(false);

  const { state, currentStep, index, totalSteps, isComplete, lastAnswer, whatChanged, activePacket } = snapshot;
  const canAdvance = engine.canAdvance();

  const nodes = useMemo(() => GRAPH_NODES.map((n) => ({ ...n, kind: (n.id === "R1" || n.id === "R6" ? "pe-router" : "p-router") as "pe-router" | "p-router" })), []);
  const active = activeBypassFor(state);
  const activePath = computeActiveForwardingPath(state.primaryLsp, state.failure, active);

  const highlightPath = pathView === "reoptimized" && state.reoptimized ? state.reoptimized.path : pathView === "repair" ? activePath : state.primaryLsp.path;
  const bestPathEdgeIds = linkIdsOnPath(highlightPath, state.links).filter((id) => !state.failedLinkIds.includes(id));
  const edges: GraphEdge[] = GRAPH_EDGES.map((e) => ({ ...e, state: state.failedLinkIds.includes(e.id) ? ("down" as const) : ("full" as const) }));
  const activeNodeIds = activePacket ? [activePacket.from, activePacket.to] : [];
  const packetFrom = activePacket ? nodes.find((n) => n.id === activePacket.from) : undefined;
  const packetTo = activePacket ? nodes.find((n) => n.id === activePacket.to) : undefined;

  const showTerminology = index >= STEP_IDX.frrIntro;
  const showProtectionViewer = index >= STEP_IDX.establishLinkBypass;
  const showLifecycle = index >= STEP_IDX.establishLinkBypass;
  const showViews = index >= STEP_IDX.viewsIntro;
  const showBeforeAfter = index >= STEP_IDX.frrIntro;
  const showLinkVsNodeTable = index >= STEP_IDX.linkVsNodeTable;
  const showExperiment = index >= STEP_IDX.linkVsNodeTable;
  const showTroubleshoot = index >= STEP_IDX.troubleshootingIntro;
  const showRecoveryTimeline = index >= STEP_IDX.establishLinkBypass;

  const primaryFwd = useMemo(() => buildPrimaryForwardingState(state.primaryLsp), [state.primaryLsp]);
  const frrFwd = useMemo(() => (active ? buildFrrForwardingState(state.primaryLsp, active) : {}), [state.primaryLsp, active]);
  const effectiveFwd = active ? frrFwd : primaryFwd;

  const recoveryEvents: RecoveryEvent[] = useMemo(() => {
    const events: RecoveryEvent[] = [{ id: "t0", timeLabel: "t0", event: "Primary LSP UP", status: "healthy", path: state.primaryLsp.path.join(" → ") }];
    if (state.linkBypass) events.push({ id: "t1", timeLabel: "t1", event: "Link-protection bypass READY", actor: state.linkBypass.plr, status: "info", path: state.linkBypass.path.join(" → ") });
    if (state.failedLinkIds.length || state.failedNode) {
      events.push({ id: "t3", timeLabel: "t3", event: `${state.failedNode ? `${state.failedNode} node` : state.failedLinkIds.join(", ")} failure`, status: "failure" });
      events.push({ id: "t4", timeLabel: "t4", event: "PLR detects failure locally", actor: active?.plr ?? "R3", status: "failure" });
    }
    if (active) {
      events.push({ id: "t5", timeLabel: "t5", event: "Local repair activated", actor: active.plr, status: "repair" });
      events.push({ id: "t6", timeLabel: "t6", event: "Packet enters bypass", status: "repair", path: active.path.join(" → ") });
      events.push({ id: "t7", timeLabel: "t7", event: "Packet reaches Merge Point", actor: active.mergePoint, status: "repair" });
      events.push({ id: "t8", timeLabel: "t8", event: "Protected-LSP forwarding resumes", status: "healthy" });
    }
    if (state.reoptimized) {
      events.push({ id: "t9", timeLabel: "t9", event: "Headend learns topology change", actor: HEADEND, status: "info" });
      events.push({ id: "t10", timeLabel: "t10", event: "End-to-end reoptimization", status: "healthy", path: state.reoptimized.path.join(" → "), explanation: `New TE metric ${state.reoptimized.teMetricTotal}` });
    }
    return events;
  }, [state.primaryLsp.path, state.linkBypass, state.failedLinkIds, state.failedNode, active, state.reoptimized]);

  const cliCommands = useMemo(() => buildFrrCliCommands(state, focusRouter), [state, focusRouter]);
  const lastHop = state.journey[state.journey.length - 1];

  const diagnosticLayers: DiagnosticLayer[] = [
    { label: "Physical R1-R3", status: "healthy" },
    { label: "Primary RSVP State (before event)", status: "healthy" },
    { label: "Failure Detected At PLR", status: state.failure ? "healthy" : "unknown" },
    { label: "FRR Configured", status: "healthy" },
    { label: "Bypass LSP (Link)", status: "healthy" },
    { label: "Link Protection", status: "healthy" },
    { label: "Protected Link Avoidance", status: "healthy" },
    { label: "Protected NODE Avoidance", status: state.troubleshooting.nodeBypassEstablished ? "healthy" : "failing" },
    { label: "Merge Point Reachable", status: state.troubleshooting.nodeBypassEstablished ? "healthy" : "failing" },
    { label: "Node-Protecting Bypass", status: state.nodeBypass ? "healthy" : "unknown" },
    { label: "Local Repair", status: state.troubleshooting.nodeBypassEstablished && active?.protectionType === "NODE" ? "healthy" : state.troubleshooting.started ? "failing" : "unknown" },
  ];

  // --- 3D derived state ---
  const nodes3DBase = useMemo(() => layoutTo3D(nodes), [nodes]);
  const visitedRouters = new Set(state.journey.map((h) => h.router));
  const nodes3D = nodes3DBase.map((n) => {
    let status: Node3DStatus = "idle";
    if (n.id === selectedNodeId || n.id === enteredDeviceId) status = "selected";
    else if (activePacket && (n.id === activePacket.from || n.id === activePacket.to)) status = "active";
    else if (visitedRouters.has(n.id as RouterId)) status = "onPath";
    const badges = n.id === "R1" ? ["HEADEND"] : n.id === "R6" ? ["TAILEND"] : n.id === active?.plr ? ["PLR"] : n.id === active?.mergePoint ? ["MP"] : state.failedNode === n.id ? ["FAILED"] : undefined;
    return { ...n, status, badges };
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

  const deviceInterfaces = effectiveDeviceId ? interfacesFor(effectiveDeviceId, state) : [];
  const devicePacketFrames: PacketStackFrame[] | undefined = effectiveDeviceId ? packetFramesFor(state) : undefined;

  const followNode3D = cameraMode === "packetFollow" && activePacket ? nodes3D.find((n) => n.id === (state.packetAt ?? activePacket.to)) : undefined;
  const focusPosition3D: [number, number, number] | undefined =
    cameraMode === "freeOrbit" ? undefined : inDeviceMode ? [0, 0, deviceXray ? -0.2 : 0] : cameraMode === "packetFollow" ? followNode3D?.position : selectedNode3D?.position;
  const eyeOffset3D: [number, number, number] | undefined = inDeviceMode ? (deviceXray ? [0.6, 2.6, 5.2] : [2.1, 1.5, 3.8]) : undefined;

  const explainTargetId = (effectiveDeviceId ?? selectedNodeId ?? followNode3D?.id) as RouterId | undefined;
  const nodeExplanation = explainTargetId ? explainNode(state, explainTargetId, currentStep?.id ?? "") : undefined;
  const xrayPacket = activePacket && (selectedNodeId === activePacket.from || selectedNodeId === activePacket.to) ? activePacket : undefined;
  const selectedLinkDetail = selectedLinkId ? linkDetailFor(selectedLinkId, state) : undefined;
  const packetCurrentDeviceLabel = effectiveDeviceId ?? state.packetAt ?? activePacket?.from ?? "—";
  const packetDirection = active ? `Local repair: ${active.path.join(" → ")}` : state.primaryLsp.path.join(" → ");
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
  const focusTrace = focusInspectDeviceId ? traceFor(focusInspectDeviceId, state, currentStep?.id ?? "") : undefined;
  const focusInterfaces = focusInspectDeviceId ? interfacesFor(focusInspectDeviceId, state) : undefined;

  // --- HopTimeline data — every step carrying a real MPLS data-plane
  // packet (this lesson never models separate PATH/RESV control
  // packets — see deviceTrace.ts). Every packet-carrying step here
  // already yields real per-router trace data via `state.journey`, so
  // no narrative-step fallback range is needed (unlike RSVP-TE's PATH/
  // RESV pipeline-inspection steps).
  const journeyStepIndices = rsvpFrrSteps.map((s, i) => ({ s, i })).filter(({ s, i }) => i <= index && !!s.packet);
  const journeyHopEntries = journeyStepIndices.map(({ s, i }) => ({ id: s.id, label: s.label, index: i }));

  // --- Historical inspection (mirrors mpls-ldp §3/§4) — reuses
  // ScenarioEngine's OWN `getStateAt` snapshot. Presentation-only — never
  // calls `engine.goTo()`.
  const historicalState = historicalIndex !== undefined ? engine.getStateAt(historicalIndex) : undefined;
  const historicalStep = historicalIndex !== undefined ? rsvpFrrSteps[historicalIndex] : undefined;
  const historicalPacket = historicalStep && historicalState ? historicalStep.packet?.(historicalState) : undefined;
  const historicalDeviceId = historicalStep && historicalState ? deviceForStep(historicalStep.id, historicalState, historicalPacket) : undefined;
  const historicalTrace = historicalDeviceId && historicalState ? traceFor(historicalDeviceId, historicalState, historicalStep!.id) : undefined;
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
        <div className="space-y-3">
          <div className="rounded-lg border border-pv-cyan/30 bg-pv-cyan/5 p-3">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-pv-cyan-soft">Current Action</p>
            <p className="text-sm text-pv-text">{nodeExplanation.currentAction}</p>
          </div>
          {nodeExplanation.note && <p className="rounded-lg border border-pv-warning/30 bg-pv-warning/5 p-2.5 text-xs text-pv-text-muted">{nodeExplanation.note}</p>}
        </div>
      ),
    };
    const hardwareTab: DeviceExplorerTab = { id: "hardware", label: "Hardware", content: <p className="text-xs text-pv-text-muted">Generic stylized {nodeExplanation.deviceType.toLowerCase()} chassis — {deviceInterfaces.length} physical interfaces.</p> };
    const interfacesTab: DeviceExplorerTab = { id: "interfaces", label: "Interfaces", content: <InterfaceListTab interfaces={deviceInterfaces} selectedInterfaceId={selectedInterfaceId} onSelectInterface={setSelectedInterfaceId} /> };
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
    const forwardingTab: DeviceExplorerTab = {
      id: "forwarding",
      label: "MPLS Forwarding",
      content: effectiveFwd[router] ? (
        <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 pv-mono text-[11px]">
          <span className="text-pv-text-faint">Incoming</span>
          <span className="text-pv-text">{effectiveFwd[router]!.incomingLabel === "UNLABELED" ? "unlabeled" : fmtLabel(effectiveFwd[router]!.incomingLabel as never)}</span>
          <span className="text-pv-text-faint">Action</span>
          <span className="text-pv-text">{effectiveFwd[router]!.action}</span>
          <span className="text-pv-text-faint">Outgoing</span>
          <span className="text-pv-text">{effectiveFwd[router]!.outgoingLabels?.map((l) => fmtLabel(l)).join(" / ") ?? "—"}</span>
          <span className="text-pv-text-faint">Interface</span>
          <span className="text-pv-text">{effectiveFwd[router]!.outgoingInterface ?? "—"}</span>
        </div>
      ) : (
        <p className="text-xs text-pv-text-faint">No forwarding entry for this router right now.</p>
      ),
    };
    const cliTab: DeviceExplorerTab = { id: "cli", label: "CLI", content: <CLIOutputPanel commands={buildFrrCliCommands(state, router)} /> };
    const frrTable = nodeExplanation.tables?.[0];
    const frrTab: DeviceExplorerTab = {
      id: "frr",
      label: router === "R3" ? "FRR Protection" : "Merge Point",
      content: frrTable ? (
        <div className="space-y-0.5 pv-mono text-[11px]">
          {frrTable.rows.map((r) => (
            <div key={r.label} className="flex justify-between gap-3">
              <span className="text-pv-text-faint">{r.label}</span>
              <span className="text-pv-text">{r.value}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-pv-text-faint">No FRR association for this router.</p>
      ),
    };

    if (router === "R1") return [overviewTab, hardwareTab, interfacesTab, forwardingTab, packetTab, cliTab];
    if (router === "R6") return [overviewTab, hardwareTab, interfacesTab, forwardingTab, packetTab, cliTab];
    if (router === "R3") return [overviewTab, hardwareTab, interfacesTab, frrTab, forwardingTab, packetTab, cliTab];
    if (router === "R4") return [overviewTab, hardwareTab, interfacesTab, forwardingTab, packetTab, cliTab];
    return [overviewTab, hardwareTab, interfacesTab, frrTab, forwardingTab, packetTab, cliTab]; // R5 / R7 — Merge Point candidates
  }

  // --- read-only experiment (brief §39) — reads real domain functions against live state, mutates nothing ---
  const experimentResult = useMemo(() => {
    if (!experimentFail) return undefined;
    if (experimentFail === "link") {
      const readiness = determineProtectionReadiness(state.linkBypass, state.links, ["R3-R5"], undefined);
      return { label: "Protected Link (R3-R5) fails", outcome: readiness === "READY" ? "Link protection succeeds — traffic detours via R3 → R4 → R5." : "Link protection unavailable." };
    }
    if (experimentFail === "node") {
      const linkOnly = determineProtectionReadiness(state.linkBypass, state.links, [], "R5");
      const nodeOk = determineProtectionReadiness(state.nodeBypass, state.links, [], "R5");
      return { label: "Protected Node (R5) fails", outcome: `Link-only backup: ${linkOnly === "READY" ? "would survive (it wouldn't — Merge Point is R5)" : "FAILS (Merge Point R5 is down)"}. Node-protection backup: ${nodeOk === "READY" ? "SUCCEEDS via R3 → R4 → R7." : "not configured yet."}` };
    }
    const readiness = determineProtectionReadiness(state.nodeBypass, state.links, ["R4-R7"], undefined);
    return { label: "Bypass Link (R4-R7) fails", outcome: readiness === "READY" ? "Node protection still READY." : "Primary stays UP (R3-R5/R5 untouched) — but node PROTECTION becomes UNAVAILABLE, not a service outage." };
  }, [experimentFail, state.linkBypass, state.nodeBypass, state.links]);

  useEffect(() => {
    if (isComplete && !awardedRef.current) {
      awardedRef.current = true;
      completeLesson("mpls-rsvp-frr", 500);
      unlockAchievement("fast-reroute-engineer");
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
    setPathView("normal");
    setExperimentFail(undefined);
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
          MPLS RSVP-TE FAST REROUTE · PLR + MERGE POINT + LINK/NODE PROTECTION
        </Badge>
        <h1 className="text-2xl font-semibold text-pv-text sm:text-3xl">A Failure Near A Router — Too Slow To Wait For The Headend?</h1>
        <p className="mt-2 max-w-3xl text-sm text-pv-text-muted">
          Watch a router right next to a failure repair it locally in an instant — using a bypass tunnel signaled long before
          the failure ever happened — then see exactly why protecting a link is not the same as protecting the router at its
          far end.
        </p>
      </div>

      <div className="mb-4 grid gap-2 sm:grid-cols-4">
        {WHY_FRR.map((item) => (
          <GlassPanel key={item.q} className="p-3">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-pv-cyan-soft">{item.q}</p>
            <p className="text-[11px] leading-snug text-pv-text-muted">{item.a}</p>
          </GlassPanel>
        ))}
      </div>

      {showTerminology && (
        <div className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {TERMS.map((t) => (
            <GlassPanel key={t.term} className="p-2.5" title={t.meaning}>
              <p className="pv-mono text-xs font-bold text-pv-text">{t.term}</p>
              <p className="text-[10px] text-pv-text-faint">{t.expansion}</p>
            </GlassPanel>
          ))}
        </div>
      )}

      {/* TIMELINE */}
      <div className="mb-4 flex gap-1 overflow-x-auto pb-2">
        {rsvpFrrSteps.map((step, i) => (
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
            { value: "normal", label: "Normal" },
            { value: "failure", label: "Failure" },
            { value: "repair", label: "Local Repair" },
            { value: "reoptimized", label: "Reoptimized" },
          ]}
          value={pathView}
          onChange={setPathView}
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
              onChange={(v) => {
                setCameraMode(v);
                if (v === "device" && !enteredDeviceId) setEnteredDeviceId(selectedNodeId ?? activeDeviceId ?? "R3");
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
              <GraphTopologyViewer nodes={nodes} edges={edges} activeNodeIds={activeNodeIds} bestPathEdgeIds={bestPathEdgeIds} onEdgeClick={(id) => setSelectedLinkId(id)}>
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

          {showProtectionViewer && state.linkBypass && !isComplete && (
            <ProtectionPathViewer
              title="Link-Protection Bypass"
              primaryPath={state.primaryLsp.path}
              backupPath={state.linkBypass.path}
              protectedResource={state.linkBypass.protectedResource}
              plr={state.linkBypass.plr}
              mergePoint={state.linkBypass.mergePoint}
              protectionType="LINK"
              readiness={readinessLabel(determineProtectionReadiness(state.linkBypass, state.links, state.failedLinkIds, state.failedNode))}
              active={state.activeBypassId === state.linkBypass.id}
              failure={state.failure?.kind === "LINK" ? `${state.failure.resource} is down` : state.failure?.kind === "NODE" && state.failure.resource === "R5" ? "R5 has failed — this bypass's Merge Point is unusable" : undefined}
            />
          )}

          {state.nodeBypass && !isComplete && (
            <ProtectionPathViewer
              title="Node-Protection Bypass"
              primaryPath={state.primaryLsp.path}
              backupPath={state.nodeBypass.path}
              protectedResource={state.nodeBypass.protectedResource}
              plr={state.nodeBypass.plr}
              mergePoint={state.nodeBypass.mergePoint}
              protectionType="NODE"
              readiness={readinessLabel(determineProtectionReadiness(state.nodeBypass, state.links, state.failedLinkIds, state.failedNode))}
              active={state.activeBypassId === state.nodeBypass.id}
            />
          )}

          {showLifecycle && (state.linkBypass || state.nodeBypass) && !isComplete && (
            <ProtocolStateMachine
              states={["UNPROTECTED", "PROTECTION_SIGNALING", "READY", "FAILURE_DETECTED", "LOCAL_REPAIR_ACTIVE", "REOPTIMIZING", "RECOVERED"]}
              current={(active ?? state.nodeBypass ?? state.linkBypass)!.lifecycle}
              title="PacketVerse FRR Recovery Lifecycle (teaching abstraction, not an official RSVP FSM)"
            />
          )}

          {showBeforeAfter && index < STEP_IDX.establishLinkBypass && !isComplete && (
            <BeforeAfterMetrics
              title="Without FRR vs. With FRR"
              beforeLabel="WITHOUT FRR"
              afterLabel="WITH FRR"
              metrics={[
                { label: "Local backup ready", before: "NO", after: "YES" },
                { label: "Immediate local recovery", before: "NO", after: "YES" },
                { label: "End-to-end recomputation required", before: "YES", after: "may still occur later" },
              ]}
            />
          )}

          {showLinkVsNodeTable && !isComplete && <LinkVsNodeTable state={state} />}

          {showExperiment && !isComplete && (
            <GlassPanel strong className="space-y-3 p-5">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-pv-violet">Experiment — Fail A Different Resource</h3>
              <p className="text-[11px] text-pv-text-muted">Read-only: computed against real protection state, nothing here mutates the lesson.</p>
              <div className="flex flex-wrap gap-2">
                {(["link", "node", "bypass"] as const).map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setExperimentFail(f)}
                    className={clsx("rounded-full border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide transition-colors", experimentFail === f ? "border-pv-cyan/50 bg-pv-cyan/15 text-pv-cyan-soft" : "border-pv-border text-pv-text-faint hover:text-pv-text")}
                  >
                    {f === "link" ? "Protected Link" : f === "node" ? "Protected Node" : "Bypass Link"}
                  </button>
                ))}
              </div>
              {experimentResult && (
                <div className="rounded-lg border border-pv-border p-3 text-xs">
                  <p className="mb-1 font-semibold text-pv-text">{experimentResult.label}</p>
                  <p className="text-pv-text-muted">{experimentResult.outcome}</p>
                </div>
              )}
            </GlassPanel>
          )}

          {showRecoveryTimeline && !isComplete && <RecoveryTimelineViewer events={recoveryEvents} />}

          {showTroubleshoot && !isComplete && <TroubleshootingLayers title="Diagnostic Ladder" layers={diagnosticLayers} />}

          {showViews && !isComplete && (
            <PlaneSplitPanel
              show={planeView}
              controlTitle="Control Plane — Primary + Bypass RSVP State"
              controlRows={[
                { label: "Primary LSP", value: `${state.primaryLsp.id} — ${state.primaryLsp.requestedBandwidthMbps} Mbps` },
                { label: "Link bypass", value: state.linkBypass ? `${state.linkBypass.lifecycle}${state.activeBypassId === state.linkBypass.id ? " (ACTIVE)" : ""}` : "not configured" },
                { label: "Node bypass", value: state.nodeBypass ? `${state.nodeBypass.lifecycle}${state.activeBypassId === state.nodeBypass.id ? " (ACTIVE)" : ""}` : "not configured" },
                { label: "Failure", value: state.failure ? `${state.failure.kind}: ${state.failure.resource}` : "none" },
              ]}
              dataTitle="Data Plane — Current MPLS Packet"
              dataRows={
                state.packet
                  ? [
                      { label: "Location", value: state.packetAt ?? "—" },
                      { label: "Labels on wire", value: state.packet.labels.length ? state.packet.labels.map((l) => `${l.value}(${l.purpose})`).join(" / ") : "(none)" },
                      { label: "Following", value: active ? active.path.join(" → ") + " → " + state.primaryLsp.path.slice(state.primaryLsp.path.indexOf(active.mergePoint) + 1).join(" → ") : state.primaryLsp.path.join(" → ") },
                    ]
                  : [{ label: "Packet", value: "none in flight" }]
              }
            />
          )}

          {isComplete && (
            <GlassPanel strong glow="success" className="flex flex-col items-center gap-4 p-10 text-center">
              <Badge tone="success">Fast Reroute Engineer</Badge>
              <h2 className="text-2xl font-semibold text-pv-text">You Protected The LSP</h2>
              <p className="max-w-md text-sm text-pv-text-muted">
                You identified the PLR and Merge Point, watched local repair activate without any headend involvement, traced
                a real facility-backup label stack through a bypass, discovered why link protection cannot survive a node
                failure, and repaired that exact mismatch with genuine node protection. +500 XP awarded.
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
                  if (v === "device" && !enteredDeviceId) setEnteredDeviceId(selectedNodeId ?? activeDeviceId ?? "R3");
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
                  const histStep = rsvpFrrSteps[entry.index];
                  const histPacket = histStep && histState ? histStep.packet?.(histState) : undefined;
                  const router = histState ? deviceForStep(entry.id, histState, histPacket) : undefined;
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

function LinkVsNodeTable({ state }: { state: RsvpFrrState }) {
  const linkSurvivesLink = state.linkBypass ? "YES" : "—";
  const nodeSurvivesLink = state.nodeBypass ? "YES" : "—";
  const linkSurvivesNode = "NO";
  const nodeSurvivesNode = state.nodeBypass ? "YES" : "—";
  return (
    <GlassPanel className="p-4">
      <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-pv-text-muted">Link vs. Node Protection</h4>
      <div className="overflow-x-auto">
        <table className="w-full pv-mono text-[11px]">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wide text-pv-text-faint">
              <th className="pb-1.5 pr-3"> </th>
              <th className="pb-1.5 pr-3">Link Protection</th>
              <th className="pb-1.5">Node Protection</th>
            </tr>
          </thead>
          <tbody className="[&>tr]:border-t [&>tr]:border-pv-border">
            <tr>
              <td className="py-1.5 pr-3 text-pv-text-faint">Protected</td>
              <td className="py-1.5 pr-3 text-pv-text">{PROTECTED_LINK}</td>
              <td className="py-1.5 text-pv-text">{PROTECTED_NODE}</td>
            </tr>
            <tr>
              <td className="py-1.5 pr-3 text-pv-text-faint">PLR</td>
              <td className="py-1.5 pr-3 text-pv-text">{state.linkBypass?.plr ?? "R3"}</td>
              <td className="py-1.5 text-pv-text">{state.nodeBypass?.plr ?? "R3"}</td>
            </tr>
            <tr>
              <td className="py-1.5 pr-3 text-pv-text-faint">MP</td>
              <td className="py-1.5 pr-3 text-pv-text">{state.linkBypass?.mergePoint ?? "R5"}</td>
              <td className="py-1.5 text-pv-text">{state.nodeBypass?.mergePoint ?? "R7"}</td>
            </tr>
            <tr>
              <td className="py-1.5 pr-3 text-pv-text-faint">Bypass</td>
              <td className="py-1.5 pr-3 text-pv-text">{state.linkBypass?.path.join("-") ?? "R3-R4-R5"}</td>
              <td className="py-1.5 text-pv-text">{state.nodeBypass?.path.join("-") ?? "R3-R4-R7"}</td>
            </tr>
            <tr>
              <td className="py-1.5 pr-3 text-pv-text-faint">Survives R3-R5 failure</td>
              <td className={clsx("py-1.5 pr-3 font-semibold", linkSurvivesLink === "YES" ? "text-pv-success" : "text-pv-text-muted")}>{linkSurvivesLink}</td>
              <td className={clsx("py-1.5 font-semibold", nodeSurvivesLink === "YES" ? "text-pv-success" : "text-pv-text-muted")}>{nodeSurvivesLink}</td>
            </tr>
            <tr>
              <td className="py-1.5 pr-3 text-pv-text-faint">Survives R5 failure</td>
              <td className="py-1.5 pr-3 font-semibold text-pv-danger">{linkSurvivesNode}</td>
              <td className={clsx("py-1.5 font-semibold", nodeSurvivesNode === "YES" ? "text-pv-success" : "text-pv-text-muted")}>{nodeSurvivesNode}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </GlassPanel>
  );
}

function RepairChallenge({ options, attempt, onTry }: { options: { id: string; label: string }[]; attempt?: { choice: string; correct: boolean }; onTry: (choice: string) => void }) {
  return (
    <GlassPanel strong className="p-5">
      <p className="mb-3 text-sm font-medium text-pv-text">Choose the correct repair to protect against complete R5 failure:</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((opt) => {
          const isSelected = attempt?.choice === opt.id;
          const isCorrect = opt.id === "establish-node-protection";
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
            <span className="font-semibold">✓ Node-protecting bypass R3 → R4 → R7 established.</span>
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
