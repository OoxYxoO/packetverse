"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { clsx } from "clsx";
import { useScenarioEngine } from "@/lib/sim-engine/useScenarioEngine";
import {
  ESI,
  GRAPH_EDGES,
  GRAPH_NODES,
  GRAPH_REGIONS,
  LOGICAL_GRAPH_EDGES,
  LOGICAL_GRAPH_NODES,
  SERVER_A_IP,
  SERVER_A_MAC,
  TERMS,
  VLAN,
  VNI,
  createEvpnAliasingState,
  evpnAliasingSteps,
  outerIpLayerIndex,
  withEvpnMesh,
  type EvpnAliasingDeviceId,
  type EvpnAliasingState,
  type LeafId,
} from "@/lib/sim-engine/scenarios/evpnAliasingMassWithdrawal";
import { GraphTopologyViewer } from "@/components/network/GraphTopologyViewer";
import { GraphPacket } from "@/components/network/GraphPacket";
import { PacketInspector } from "@/components/network/PacketInspector";
import { ForwardingDecisionCard } from "@/components/protocol/ForwardingDecisionCard";
import { PacketJourneyTimeline } from "@/components/protocol/PacketJourneyTimeline";
import { PlaneSplitPanel } from "@/components/protocol/PlaneSplitPanel";
import { CLIOutputPanel } from "@/components/protocol/CLIOutputPanel";
import { EvpnRibViewer } from "@/components/protocol/EvpnRouteTable";
import { NextHopSetViewer } from "@/components/protocol/NextHopSetViewer";
import { RouteEvolutionViewer } from "@/components/protocol/RouteEvolutionViewer";
import { BeforeAfterMetrics } from "@/components/protocol/BeforeAfterMetrics";
import { BgpUpdateCard } from "@/components/protocol/BgpUpdateCard";
import { TroubleshootingLayers, type DiagnosticLayer } from "@/components/protocol/TroubleshootingLayers";
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
import { PacketFocusPanel } from "@/components/network3d/PacketFocusPanel";
import { ObjectFocusPanel } from "@/components/network3d/ObjectFocusPanel";
import { layoutRegionsTo3D, layoutTo3D } from "@/components/network3d/layout";
import type { ActivePacket3D, CameraMode, FocusTarget3D, InspectorSurface, Link3DData, Node3DStatus } from "@/components/network3d/types";
import type { PacketVisual } from "@/lib/sim-engine/types";
import { explainNode } from "./explain";
import {
  adRoutesTabRowsFor,
  aliasingTabRowsFor,
  buildAliasingCliCommands,
  esTabRowsFor,
  evpnRibRowsFor,
  failureStateTabRowsFor,
  interfacesFor,
  linkDetailFor,
  macTableTabRowsFor,
  nextHopsTabRowsFor,
  packetFramesFor,
  traceFor,
} from "./deviceTrace";

const REPAIR_OPTIONS = [
  { id: "make-leaf2-df", label: "Make LEAF2 the DF" },
  { id: "delete-mac", label: "Delete SERVER-A's MAC" },
  { id: "disable-ecmp", label: "Disable ECMP permanently" },
  { id: "remove-leaf1-esi", label: "Remove LEAF1 from the ESI configuration entirely" },
  { id: "process-mass-withdrawal", label: "Apply/process the A-D per-ES withdrawal and recompute the aliasing next-hop set" },
];
const WRONG_FEEDBACK: Record<string, string> = {
  "make-leaf2-df": "DF state does not repair the stale known-unicast aliasing set — DF election and aliasing are separate mechanisms entirely.",
  "delete-mac": "SERVER-A's endpoint identity is not the problem — its MAC/IP never changed.",
  "disable-ecmp": "That hides the symptom and defeats all-active aliasing for every other flow, too — it doesn't fix the stale next-hop set.",
  "remove-leaf1-esi": "This is a transient attachment failure, not a permanent reconfiguration — removing LEAF1 from the ESI entirely is inappropriate here.",
};

/** Which fabric device is the primary inspection subject of a no-packet control-plane step. */
const PRIMARY_TRANSITION_ROUTER: Record<string, "LEAF1" | "SPINE1" | "LEAF2" | "LEAF3"> = {
  "known-unicast-setup": "LEAF1",
  "leaf1-advertises-perevi-perces": "LEAF1",
  "leaf2-advertises-perevi-perces": "LEAF2",
  "aliasing-decision-chamber": "LEAF3",
  "flow-a-leaf3-pipeline": "LEAF3",
  "flow-a-delivered": "LEAF1",
  "flow-b-delivered": "LEAF3",
  "fail-es-attachment": "LEAF1",
  "convergence-problem": "LEAF3",
  "withdraw-per-es": "LEAF1",
  "leaf3-processes-withdrawal": "LEAF3",
  "resend-after-mass-withdrawal": "LEAF3",
  "fault-injected": "LEAF3",
  "repair-challenge": "LEAF3",
  "verify-converged": "LEAF3",
};

function deviceForStep(stepId: string, packet: PacketVisual | undefined): EvpnAliasingDeviceId | undefined {
  if (packet) return (packet.from ?? packet.to) as EvpnAliasingDeviceId;
  return PRIMARY_TRANSITION_ROUTER[stepId];
}

function eyeOffsetForFocusTarget(target: FocusTarget3D): [number, number, number] {
  const [sx, sy, sz] = target.size ?? [0.6, 0.3, 0.3];
  const maxDim = Math.max(sx, sy, sz);
  const dist = Math.max(0.55, maxDim * 1.8);
  return [dist * 0.55, dist * 0.5, dist * 0.75];
}

const FABRIC_ENTERABLE: ("LEAF1" | "SPINE1" | "LEAF2" | "LEAF3")[] = ["LEAF1", "SPINE1", "LEAF2", "LEAF3"];

export default function EvpnAliasingMassWithdrawalDemo() {
  const { engine, snapshot } = useScenarioEngine<EvpnAliasingState>(createEvpnAliasingState(), evpnAliasingSteps);
  const [autoPlay, setAutoPlay] = useState(false);
  const [speed, setSpeed] = useState<0.5 | 1 | 2>(1);
  const [viewMode, setViewMode] = useState<"physical" | "logical" | "3d">("physical");
  const [planeView, setPlaneView] = useState<"control" | "data" | "both">("both");
  const [selectedNodeId, setSelectedNodeId] = useState<EvpnAliasingDeviceId | undefined>(undefined);
  const [cameraMode, setCameraMode] = useState<CameraMode>("overview");
  const [enteredDeviceId, setEnteredDeviceId] = useState<EvpnAliasingDeviceId | undefined>(undefined);
  const [deviceXray, setDeviceXray] = useState(true);
  const [autoEnterDevices, setAutoEnterDevices] = useState(true);
  const [selectedInterfaceId, setSelectedInterfaceId] = useState<string | undefined>(undefined);
  const [selectedLinkId, setSelectedLinkId] = useState<string | undefined>(undefined);
  const [selectedRegionId, setSelectedRegionId] = useState<string | undefined>(undefined);
  const [packetSelected, setPacketSelected] = useState(false);
  const [xrayMode, setXrayMode] = useState(true);
  const [macCountExample, setMacCountExample] = useState<1 | 100 | 1000>(1);
  const [focusMode, setFocusMode] = useState(false);
  const [focusedObject, setFocusedObject] = useState<FocusTarget3D | undefined>(undefined);
  const [historicalIndex, setHistoricalIndex] = useState<number | undefined>(undefined);
  const [inspectorSurface, setInspectorSurface] = useState<InspectorSurface>("hop");
  const completeLesson = useProgressStore((s) => s.completeLesson);
  const recordAnswer = useProgressStore((s) => s.recordAnswer);
  const unlockAchievement = useProgressStore((s) => s.unlockAchievement);

  const { state, currentStep, index, totalSteps, isComplete, lastAnswer, whatChanged, activePacket } = snapshot;
  const canAdvance = engine.canAdvance();

  const sessionActive = state.bgpSessionUp;
  const baseNodes = viewMode === "physical" ? GRAPH_NODES : LOGICAL_GRAPH_NODES;
  const baseEdges = viewMode === "physical" ? GRAPH_EDGES : LOGICAL_GRAPH_EDGES;
  const augmented = withEvpnMesh(baseNodes, baseEdges, viewMode === "physical" && sessionActive);
  const nodes = augmented.nodes;
  const edges = augmented.edges.map((e) => ({ ...e, state: "full" as const }));
  const activeNodeIds = activePacket ? [activePacket.from, activePacket.to] : [];
  const packetFrom = activePacket ? nodes.find((n) => n.id === activePacket.from) : undefined;
  const packetTo = activePacket ? nodes.find((n) => n.id === activePacket.to) : undefined;

  const focusIndices = state.packetAt === "SPINE1" ? outerIpLayerIndex(activePacket) : undefined;
  const lastHop = state.journey[state.journey.length - 1];
  const showPlanes = index >= evpnAliasingSteps.findIndex((s) => s.id === "flow-a-intro");
  const showTroubleshootLayers = index >= evpnAliasingSteps.findIndex((s) => s.id === "break-intro");
  const showAliasingChamber = index >= evpnAliasingSteps.findIndex((s) => s.id === "aliasing-decision-chamber") && !!state.aliasing;

  const physicalAugmented = withEvpnMesh(GRAPH_NODES, GRAPH_EDGES, sessionActive);
  const nodes3DBase = layoutTo3D(physicalAugmented.nodes);
  const regions3D = layoutRegionsTo3D(GRAPH_REGIONS);
  const visitedDevices = new Set(state.journey.map((h) => h.device));
  const nodes3D = nodes3DBase.map((n) => {
    let status: Node3DStatus = "idle";
    if (n.id === selectedNodeId || n.id === enteredDeviceId) status = "selected";
    else if (activePacket && (n.id === activePacket.from || n.id === activePacket.to)) status = "active";
    else if (visitedDevices.has(n.id as EvpnAliasingDeviceId)) status = "onPath";
    const badges =
      n.id === "LEAF1"
        ? state.esAttachmentFailed
          ? ["ESI", "ES DOWN"]
          : ["ESI", state.aliasing?.eligiblePEs.includes("LEAF1") ? "ELIGIBLE" : "NOT ELIGIBLE"]
        : n.id === "LEAF2"
          ? ["ESI", state.aliasing?.eligiblePEs.includes("LEAF2") ?? true ? "ELIGIBLE" : "NOT ELIGIBLE"]
          : undefined;
    return { ...n, status, badges };
  });
  const links3D: Link3DData[] = physicalAugmented.edges.map((e) => ({
    ...e,
    active: activePacket ? (e.a === activePacket.from && e.b === activePacket.to) || (e.b === activePacket.from && e.a === activePacket.to) : false,
    onPath: visitedDevices.has(e.a as EvpnAliasingDeviceId) && visitedDevices.has(e.b as EvpnAliasingDeviceId),
  }));
  const activePacket3D: ActivePacket3D | undefined = activePacket && nodes3D.some((n) => n.id === activePacket.from) && nodes3D.some((n) => n.id === activePacket.to) ? { packet: activePacket, fromId: activePacket.from, toId: activePacket.to } : undefined;
  const questionActive = !isComplete && !!currentStep?.question && lastAnswer?.stepId !== currentStep.id;
  const selectedNode3D = nodes3D.find((n) => n.id === selectedNodeId);

  const isFabricDevice = (id: EvpnAliasingDeviceId | undefined): id is "LEAF1" | "SPINE1" | "LEAF2" | "LEAF3" => id === "LEAF1" || id === "SPINE1" || id === "LEAF2" || id === "LEAF3";
  const activeDeviceId = FABRIC_ENTERABLE.find((d) => traceFor(d, state, currentStep?.id ?? "").activeStageId !== undefined);
  const effectiveDeviceId = cameraMode === "device" ? enteredDeviceId : cameraMode === "packetFollow" && autoEnterDevices ? activeDeviceId : undefined;
  const inDeviceMode = !!effectiveDeviceId;

  const deviceTrace = isFabricDevice(effectiveDeviceId) ? traceFor(effectiveDeviceId, state, currentStep?.id ?? "") : undefined;
  const deviceInterfaces = isFabricDevice(effectiveDeviceId) ? interfacesFor(effectiveDeviceId, state, currentStep?.id ?? "") : [];
  const devicePacketFrames = effectiveDeviceId ? packetFramesFor(state) : undefined;

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

  const followNode3D = cameraMode === "packetFollow" && activePacket ? nodes3D.find((n) => n.id === (state.packetAt ?? activePacket.to)) : undefined;
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

  const explainTargetId = effectiveDeviceId ?? selectedNodeId ?? (followNode3D?.id as EvpnAliasingDeviceId | undefined);
  const nodeExplanation = explainTargetId ? explainNode(state, explainTargetId) : undefined;
  const xrayPacket = activePacket && (selectedNodeId === activePacket.from || selectedNodeId === activePacket.to) ? activePacket : undefined;

  const selectedLinkDetail = selectedLinkId ? linkDetailFor(selectedLinkId, state) : undefined;
  const packetCurrentDeviceLabel = effectiveDeviceId ?? state.packetAt ?? activePacket?.from ?? "—";
  const devicePacketForTab = xrayPacket ?? (effectiveDeviceId && state.packetAt === effectiveDeviceId ? activePacket : undefined);

  // --- Hop Inspector target — explicit selection wins outright: selectedNodeId > effectiveDeviceId > activeDeviceId. ---
  const selectedFabricId = isFabricDevice(selectedNodeId) ? selectedNodeId : undefined;
  const effectiveFabricId = isFabricDevice(effectiveDeviceId) ? effectiveDeviceId : undefined;
  const focusInspectDeviceId = selectedFabricId ?? effectiveFabricId ?? activeDeviceId;
  const focusTrace = focusInspectDeviceId ? traceFor(focusInspectDeviceId, state, currentStep?.id ?? "") : undefined;
  const focusInterfaces = focusInspectDeviceId ? interfacesFor(focusInspectDeviceId, state, currentStep?.id ?? "") : undefined;

  const journeyStepIndices = evpnAliasingSteps.map((s, i) => ({ s, i })).filter(({ s, i }) => i <= index && (!!s.packet || PRIMARY_TRANSITION_ROUTER[s.id] !== undefined));
  const journeyHopEntries = journeyStepIndices.map(({ s, i }) => ({ id: s.id, label: s.label, index: i }));

  const historicalState = historicalIndex !== undefined ? engine.getStateAt(historicalIndex) : undefined;
  const historicalStep = historicalIndex !== undefined ? evpnAliasingSteps[historicalIndex] : undefined;
  const historicalPacket = historicalStep && historicalState ? historicalStep.packet?.(historicalState) : undefined;
  const historicalDeviceId = historicalStep && historicalState ? deviceForStep(historicalStep.id, historicalPacket) : undefined;
  const historicalTrace = historicalDeviceId && isFabricDevice(historicalDeviceId) && historicalState ? traceFor(historicalDeviceId, historicalState, historicalStep!.id) : undefined;
  const historicalInterfaces = historicalDeviceId && isFabricDevice(historicalDeviceId) && historicalState ? interfacesFor(historicalDeviceId, historicalState, historicalStep!.id) : undefined;

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

  function handleCameraModeChange(v: CameraMode) {
    setCameraMode(v);
    if (v === "device" && !enteredDeviceId) setEnteredDeviceId(isFabricDevice(selectedNodeId) ? selectedNodeId : (activeDeviceId ?? "LEAF3"));
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

  const diagnosticLayers: DiagnosticLayer[] = [
    { label: "LEAF1 Device", status: "healthy" },
    { label: "Underlay", status: "healthy" },
    { label: "BGP EVPN", status: "healthy" },
    { label: "ESI", status: "healthy" },
    { label: "LEAF1 ES Attachment", status: state.esAttachmentFailed ? "failing" : "healthy" },
    { label: "A-D Per-ES Withdrawal", status: state.perEsAdRoutes.LEAF1?.withdrawn ? "healthy" : "unknown" },
    { label: "Withdrawal Received LEAF3", status: state.perEsAdRoutes.LEAF1?.withdrawn ? "healthy" : "unknown" },
    { label: "Mass-Withdraw Processing", status: state.massWithdrawalProcessed ? "healthy" : "failing" },
    { label: "Aliasing Next-Hop Set", status: state.staleAliasingFault ? "failing" : "healthy" },
    { label: "Failed PE Pruned", status: state.staleAliasingFault ? "failing" : "healthy" },
    { label: "Known-Unicast Delivery (intermittent)", status: state.staleAliasingFault ? "failing" : "healthy" },
  ];

  const scalingMetrics = [
    { label: "Dependent MAC entries behind this ES", before: macCountExample, after: macCountExample, improved: false },
    { label: "ES-level failure signals needed", before: macCountExample, after: 1 },
  ];

  useEffect(() => {
    if (isComplete) {
      completeLesson("evpn-aliasing-mass-withdrawal", 450);
      unlockAchievement("convergence-engineer");
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
    setCameraMode("overview");
    setEnteredDeviceId(undefined);
    setSelectedNodeId(undefined);
    setSelectedLinkId(undefined);
    setSelectedRegionId(undefined);
    setPacketSelected(false);
    setMacCountExample(1);
    setFocusedObject(undefined);
    setHistoricalIndex(undefined);
    setInspectorSurface("hop");
  };

  const nextLabel = currentStep?.question && !lastAnswer ? "Answer to continue" : currentStep?.requiresState && !canAdvance ? "Apply the correct fix to continue" : "Next Step →";

  const explorerTabsFor = (device: "LEAF1" | "SPINE1" | "LEAF2" | "LEAF3"): DeviceExplorerTab[] => {
    if (!nodeExplanation) return [];
    if (device === "SPINE1") {
      return [
        { id: "overview", label: "Overview", content: <OverviewTab explanation={nodeExplanation} /> },
        { id: "interfaces", label: "Interfaces", content: <InterfaceListTab interfaces={deviceInterfaces} selectedInterfaceId={selectedInterfaceId} onSelectInterface={setSelectedInterfaceId} /> },
        { id: "packet", label: "Packet", content: devicePacketForTab ? <PacketInspector packet={devicePacketForTab} /> : <p className="text-xs text-pv-text-faint">No packet at this device right now.</p> },
        { id: "cli", label: "CLI", content: <CLIOutputPanel commands={buildAliasingCliCommands(state, device)} /> },
      ];
    }
    if (device === "LEAF3") {
      return [
        { id: "overview", label: "Overview", content: <OverviewTab explanation={nodeExplanation} /> },
        { id: "hardware", label: "Hardware", content: <p className="text-xs text-pv-text-muted">Generic stylized leaf switch chassis — {deviceInterfaces.length} physical interfaces.</p> },
        { id: "interfaces", label: "Interfaces", content: <InterfaceListTab interfaces={deviceInterfaces} selectedInterfaceId={selectedInterfaceId} onSelectInterface={setSelectedInterfaceId} /> },
        { id: "evpn-routes", label: "EVPN Routes", content: <EvpnRibViewer title={device} rows={evpnRibRowsFor(state, device)} /> },
        { id: "mac-table", label: "MAC Table", content: <KeyValueTab rows={macTableTabRowsFor(state)} /> },
        { id: "aliasing", label: "Aliasing", content: <KeyValueTab rows={aliasingTabRowsFor(state)} /> },
        { id: "next-hops", label: "Next Hops", content: <KeyValueTab rows={nextHopsTabRowsFor(state)} /> },
        { id: "packet", label: "Packet", content: devicePacketForTab ? <PacketInspector packet={devicePacketForTab} /> : <p className="text-xs text-pv-text-faint">No packet at this device right now.</p> },
        { id: "control", label: "Control Plane", content: <ControlDataTab explanation={nodeExplanation} /> },
        { id: "cli", label: "CLI", content: <CLIOutputPanel commands={buildAliasingCliCommands(state, device)} /> },
      ];
    }
    return [
      { id: "overview", label: "Overview", content: <OverviewTab explanation={nodeExplanation} /> },
      { id: "hardware", label: "Hardware", content: <p className="text-xs text-pv-text-muted">Generic stylized leaf switch chassis — {deviceInterfaces.length} physical interfaces.</p> },
      { id: "interfaces", label: "Interfaces", content: <InterfaceListTab interfaces={deviceInterfaces} selectedInterfaceId={selectedInterfaceId} onSelectInterface={setSelectedInterfaceId} /> },
      { id: "ethernet-segment", label: "Ethernet Segment", content: <KeyValueTab rows={esTabRowsFor(state, device)} /> },
      { id: "evpn-routes", label: "EVPN Routes", content: <EvpnRibViewer title={device} rows={evpnRibRowsFor(state, device)} /> },
      { id: "ad-routes", label: "A-D Routes", content: <EvpnRibViewer title={`${device} A-D`} rows={adRoutesTabRowsFor(state, device)} /> },
      { id: "failure-state", label: "Failure State", content: <KeyValueTab rows={failureStateTabRowsFor(state, device)} /> },
      { id: "packet", label: "Packet", content: devicePacketForTab ? <PacketInspector packet={devicePacketForTab} /> : <p className="text-xs text-pv-text-faint">No packet at this device right now.</p> },
      { id: "cli", label: "CLI", content: <CLIOutputPanel commands={buildAliasingCliCommands(state, device)} /> },
    ];
  };

  const sceneProps = { nodes: nodes3D, links: links3D, regions: regions3D };

  return (
    <div className="mx-auto max-w-7xl px-6 py-10">
      <div className="mb-6">
        <Badge tone="cyan" className="mb-3">EVPN Aliasing + Mass Withdrawal · Route Type 1 Deep Dive</Badge>
        <h1 className="text-2xl font-semibold text-pv-text sm:text-3xl">Many Paths, One Fast Failure Signal</h1>
        <p className="mt-2 max-w-3xl text-sm text-pv-text-muted">
          The same multihomed SERVER-A from the Multihoming lesson — but now for known-unicast traffic. Watch LEAF3
          discover multiple usable paths through Aliasing, then rapidly prune a failed one through Mass Withdrawal.
        </p>
      </div>

      <div className="mb-4 grid gap-2 sm:grid-cols-4">
        {[
          { q: "IS ALIASING DF ELECTION?", a: "No — DF controls BUM forwarding. Aliasing gives known-unicast multiple eligible paths. Separate mechanisms." },
          { q: "DOES NDF MEAN UNUSABLE?", a: "No — in an all-active ES, a PE that is NDF for BUM can still be a perfectly eligible known-unicast next hop." },
          { q: "WHAT DOES MASS WITHDRAWAL DO?", a: "Rapidly removes a failed PE as a usable next hop for every destination behind its Ethernet Segment — not a one-by-one MAC cleanup." },
          { q: "WHAT'S DEFERRED?", a: "Single-Active depth, EVPN-VPWS, advanced DF algorithms, complex multi-failure scenarios, vendor ESI-LAG config." },
        ].map((item) => (
          <GlassPanel key={item.q} className="p-3">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-pv-cyan-soft">{item.q}</p>
            <p className="text-[11px] leading-snug text-pv-text-muted">{item.a}</p>
          </GlassPanel>
        ))}
      </div>

      <div className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-5">
        {TERMS.map((t) => (
          <GlassPanel key={t.term} className="p-2.5" title={t.meaning}>
            <p className="pv-mono text-xs font-bold text-pv-text">{t.term}</p>
            <p className="text-[10px] text-pv-text-faint">{t.expansion}</p>
          </GlassPanel>
        ))}
      </div>

      <div className="mb-4 flex gap-1 overflow-x-auto pb-2">
        {evpnAliasingSteps.map((step, i) => (
          <button key={step.id} type="button" disabled={i > index} onClick={() => i < index && engine.goTo(i)} title={step.label} className={clsx("h-1.5 flex-1 min-w-3 rounded-full transition-colors", i < index ? "bg-pv-success/70 hover:bg-pv-success cursor-pointer" : i === index ? "bg-pv-cyan" : "bg-white/10")} />
        ))}
      </div>

      <div className="mb-6 flex flex-wrap gap-3">
        <TopologyModeSwitcher options={[{ value: "physical", label: "Physical Topology" }, { value: "logical", label: "Logical (ESI) View" }, { value: "3d", label: "3D View" }]} value={viewMode} onChange={setViewMode} />
        {viewMode === "3d" && (
          <>
            <TopologyModeSwitcher
              options={[{ value: "overview", label: "Overview" }, { value: "device", label: "Device" }, { value: "packetFollow", label: "Packet Follow" }, { value: "freeOrbit", label: "Free Orbit" }]}
              value={cameraMode}
              onChange={handleCameraModeChange}
            />
            {inDeviceMode && <TopologyModeSwitcher options={[{ value: "off", label: "Exterior" }, { value: "on", label: "X-Ray" }]} value={deviceXray ? "on" : "off"} onChange={(v) => setDeviceXray(v === "on")} tone="violet" />}
            {cameraMode === "packetFollow" && (
              <button type="button" onClick={() => setAutoEnterDevices((v) => !v)} className={clsx("rounded-full border px-3 py-1.5 text-xs font-semibold uppercase tracking-wide transition-colors", autoEnterDevices ? "border-pv-cyan/50 bg-pv-cyan/15 text-pv-cyan-soft" : "border-pv-border text-pv-text-faint hover:text-pv-text")}>
                Auto-Enter Devices
              </button>
            )}
            <TopologyModeSwitcher options={[{ value: "off", label: "Normal View" }, { value: "on", label: "X-Ray Packet View" }]} value={xrayMode ? "on" : "off"} onChange={(v) => setXrayMode(v === "on")} tone="violet" />
          </>
        )}
        {showPlanes && <PlaneViewSwitcher value={planeView} onChange={setPlaneView} />}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_400px]">
        <div className="space-y-6">
          {viewMode === "3d" ? (
            <>
              <TopologyFrame questionActive={questionActive} onExpand={() => setFocusMode(true)}>
              {focusMode ? (
                <div className="h-96 w-full rounded-2xl border border-pv-border bg-pv-bg-elevated sm:h-[28rem]" />
              ) : (
              <NetworkScene3D
                {...sceneProps}
                activePacket={inDeviceMode ? undefined : activePacket3D}
                onSelectRegion={(id) => { setSelectedRegionId(id); setSelectedNodeId(undefined); setSelectedLinkId(undefined); setPacketSelected(false); setInspectorSurface("device"); setHistoricalIndex(undefined); }}
                selectedRegionId={selectedRegionId}
                onSelectNode={(id) => { setSelectedNodeId(id as EvpnAliasingDeviceId); setSelectedRegionId(undefined); setSelectedLinkId(undefined); setPacketSelected(false); setInspectorSurface("device"); setHistoricalIndex(undefined); }}
                onSelectLink={(id) => { setSelectedLinkId(id); setSelectedNodeId(undefined); setSelectedRegionId(undefined); setPacketSelected(false); }}
                onFocusLink={setFocusedObject}
                selectedLinkId={selectedLinkId}
                onSelectPacket={() => { setPacketSelected(true); setAutoPlay(false); }}
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
                        onSelectPacket: () => { setPacketSelected(true); setAutoPlay(false); },
                        packetSelected,
                        pipelineTitle: effectiveDeviceId === "LEAF3" ? "Conceptual EVPN Aliasing / Mass-Withdrawal Pipeline" : effectiveDeviceId === "LEAF1" || effectiveDeviceId === "LEAF2" ? "Conceptual A-D Advertisement / Decap Pipeline" : "Conceptual Underlay Forwarding Pipeline",
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
                  currentHopLabel={lastHop ? `${lastHop.device}: ${lastHop.lookup} → ${lastHop.action}` : undefined}
                  hopIndex={state.journey.length}
                  totalHops={3}
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
                  direction="HOST-B → LEAF3 → (eligible PE) → SERVER-A"
                  focusLayerIndices={xrayMode ? focusIndices : undefined}
                  paused={packetSelected}
                  onResume={() => setPacketSelected(false)}
                  onStepForward={() => engine.advance()}
                  onStepBack={() => engine.goTo(Math.max(0, index - 1))}
                  canStepForward={canAdvance}
                  canStepBack={index > 0}
                  onClose={() => setPacketSelected(false)}
                />
              )}

              {selectedLinkDetail && !packetSelected && <LinkDetailPanel detail={selectedLinkDetail} onClose={() => setSelectedLinkId(undefined)} />}

              {selectedRegionId === "ethernet-segment" && !packetSelected && !selectedLinkDetail && (
                <GlassPanel strong className="space-y-2 p-5">
                  <div className="flex items-center justify-between">
                    <h3 className="pv-mono text-sm font-bold text-pv-text">Ethernet Segment</h3>
                    <button type="button" onClick={() => setSelectedRegionId(undefined)} className="text-xs text-pv-text-faint hover:text-pv-text">✕</button>
                  </div>
                  <div className="grid grid-cols-2 gap-2 pv-mono text-[11px]">
                    <span className="text-pv-text-faint">ESI</span><span className="text-pv-text">{ESI}</span>
                    <span className="text-pv-text-faint">Attached PEs</span><span className="text-pv-text">LEAF1, LEAF2</span>
                    <span className="text-pv-text-faint">Mode</span><span className="text-pv-text">All-Active</span>
                    <span className="text-pv-text-faint">VLAN / VNI</span><span className="text-pv-text">VLAN {VLAN} / VNI {VNI}</span>
                  </div>
                </GlassPanel>
              )}

              {inDeviceMode && !packetSelected && !selectedLinkDetail && !selectedRegionId ? (
                <DeviceExplorerPanel explanation={nodeExplanation!} tabs={isFabricDevice(effectiveDeviceId) ? explorerTabsFor(effectiveDeviceId) : []} xrayEnabled={deviceXray} onToggleXray={() => setDeviceXray((v) => !v)} onExit={() => { setCameraMode("overview"); setEnteredDeviceId(undefined); }} />
              ) : (
                !packetSelected &&
                !selectedLinkDetail &&
                !selectedRegionId && (
                  <NodeInspectorPanel explanation={nodeExplanation} packet={xrayPacket} focusLayerIndices={xrayMode ? focusIndices : undefined} xrayEnabled={xrayMode}>
                    {selectedNodeId && isFabricDevice(selectedNodeId) && (
                      <Button size="sm" onClick={() => { setEnteredDeviceId(selectedNodeId); setCameraMode("device"); }}>Enter Device →</Button>
                    )}
                  </NodeInspectorPanel>
                )
              )}
            </>
          ) : (
            <>
              <GraphTopologyViewer nodes={nodes} edges={edges} activeNodeIds={activeNodeIds} regions={viewMode === "physical" ? GRAPH_REGIONS : []}>
                {activePacket && packetFrom && packetTo && <GraphPacket packet={activePacket} from={packetFrom} to={packetTo} />}
              </GraphTopologyViewer>
              {lastHop && <ForwardingDecisionCard router={lastHop.device} input={lastHop.input} lookup={lastHop.lookup} action={lastHop.action} output={lastHop.output} />}
            </>
          )}

          {!isComplete && currentStep && (
            <GlassPanel strong className="p-6">
              <div className="mb-2 flex items-center gap-2">
                <Badge tone="muted">Step {index + 1} / {totalSteps}</Badge>
                <span className="text-xs text-pv-text-faint">{currentStep.label}</span>
              </div>
              <p className="text-sm leading-relaxed text-pv-text">{currentStep.narrative}</p>
            </GlassPanel>
          )}

          {!isComplete && currentStep?.question && <PredictionQuestion question={currentStep.question} selectedOptionId={lastAnswer?.stepId === currentStep.id ? lastAnswer.optionId : undefined} onAnswer={handleAnswer} />}
          {!isComplete && currentStep?.id === "repair-challenge" && <RepairChallenge options={REPAIR_OPTIONS} attempt={state.repairAttempt} onTry={(choice) => engine.act({ choice })} />}

          {whatChanged.length > 0 && !currentStep?.question && currentStep?.id !== "repair-challenge" && (
            <GlassPanel className="p-5">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-pv-cyan-soft">What changed?</h3>
              <ul className="space-y-1.5">{whatChanged.map((c) => (<li key={c} className="flex gap-2 text-xs text-pv-text-muted"><span className="text-pv-success">✓</span>{c}</li>))}</ul>
            </GlassPanel>
          )}

          {showAliasingChamber && currentStep?.id === "aliasing-decision-chamber" && state.aliasing && (
            <NextHopSetViewer
              title="EVPN Aliasing"
              scope={`ESI ${ESI.slice(-8)} · VLAN ${VLAN} / VNI ${VNI}`}
              chain={[
                { label: "Destination", value: SERVER_A_MAC },
                { label: "Type-2 Route", value: `ESI ${ESI.slice(-8)}` },
                { label: "A-D Per-EVI Routes", value: "LEAF1, LEAF2" },
              ]}
              members={(["LEAF1", "LEAF2"] as LeafId[]).map((l) => ({ id: l, label: l, eligible: state.aliasing!.eligiblePEs.includes(l) }))}
              setLabel="Eligible Next-Hops"
            />
          )}

          {currentStep?.id === "withdraw-per-es" && state.perEsAdRoutes.LEAF1 && (
            <BgpUpdateCard
              title="EVPN Route Type 1 — A-D Per-ES"
              from="LEAF1"
              to="BGP EVPN"
              action="withdraw"
              fields={[
                { label: "ESI", value: ESI },
                { label: "PE", value: "LEAF1" },
                { label: "Action", value: "WITHDRAW" },
              ]}
            />
          )}

          {currentStep?.id === "next-hop-transformation" && (
            <RouteEvolutionViewer
              title="Aliasing Next-Hop Set — Before And After Mass Withdrawal"
              oldLabel="BEFORE"
              newLabel="AFTER"
              fields={[{ label: "Eligible Next-Hops", oldValue: "{ LEAF1, LEAF2 }", newValue: "{ LEAF2 }", decisive: true }]}
              winnerReason="LEAF1's A-D per-ES withdrawal removed it from every dependent MAC's eligible set behind this Ethernet Segment — SERVER-A's MAC identity itself never changed."
            />
          )}

          {currentStep?.id === "scaling-visualization" && (
            <div className="space-y-3">
              <div className="flex gap-2">
                {([1, 100, 1000] as const).map((n) => (
                  <button key={n} type="button" onClick={() => setMacCountExample(n)} className={clsx("rounded-full px-3 py-1.5 text-xs font-semibold pv-mono transition-colors", macCountExample === n ? "bg-pv-cyan/15 text-pv-cyan-soft" : "border border-pv-border text-pv-text-faint hover:text-pv-text")}>
                    {n} MAC{n > 1 ? "s" : ""}
                  </button>
                ))}
              </div>
              <BeforeAfterMetrics title="Without A-D Per-ES vs. With A-D Per-ES Withdrawal" beforeLabel="WITHOUT FAST ES SIGNAL" afterLabel="WITH A-D PER-ES WITHDRAWAL" metrics={scalingMetrics} />
              <p className="text-[11px] text-pv-text-faint">A control-plane dependency/scaling comparison — not a claim about exact convergence time or packet counts.</p>
            </div>
          )}

          {currentStep?.id === "aliasing-vs-df-vs-mass-withdrawal" && (
            <div className="grid gap-2 sm:grid-cols-3">
              {[
                { title: "ALIASING", purpose: "Multiple eligible paths toward an all-active ES", scope: "Traffic: known unicast" },
                { title: "DF ELECTION", purpose: "Avoid duplicate BUM delivery toward the ES", scope: "Traffic: BUM" },
                { title: "MASS WITHDRAWAL", purpose: "Rapidly prune a failed ES-facing PE", scope: "Event: failure/convergence" },
              ].map((c) => (
                <GlassPanel key={c.title} strong className="p-4">
                  <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-pv-violet">{c.title}</h4>
                  <p className="text-[11px] text-pv-text-muted">{c.purpose}</p>
                  <p className="mt-1 text-[10px] text-pv-text-faint">{c.scope}</p>
                </GlassPanel>
              ))}
            </div>
          )}

          {showPlanes && !isComplete && (
            <PlaneSplitPanel
              show={planeView}
              controlTitle="Control — Type-2 + A-D Per-EVI → Aliasing Set"
              controlRows={[
                { label: "BGP EVPN mesh", value: state.bgpSessionUp ? "Established" : "Not yet formed" },
                { label: "ESI", value: ESI.slice(-8) },
                { label: "Eligible PEs", value: state.aliasing?.eligiblePEs.join(", ") ?? "—" },
              ]}
              dataTitle="Data — Known Unicast Uses Any Eligible PE"
              dataRows={[{ label: "Flow A", value: state.aliasing?.selectedPe.A ? `via ${state.aliasing.selectedPe.A}` : "—" }, { label: "Flow B", value: state.aliasing?.selectedPe.B ? `via ${state.aliasing.selectedPe.B}` : "—" }]}
            />
          )}

          {showTroubleshootLayers && !isComplete && <TroubleshootingLayers title="Troubleshooting Layers" layers={diagnosticLayers} />}

          {isComplete && (
            <GlassPanel strong glow="success" className="flex flex-col items-center gap-4 p-10 text-center">
              <Badge tone="success">Convergence Engineer</Badge>
              <h2 className="text-2xl font-semibold text-pv-text">Many Paths, One Fast Signal</h2>
              <p className="max-w-md text-sm text-pv-text-muted">
                SERVER-A stayed reachable through multiple eligible next hops, and you repaired a stale aliasing set
                by processing the Mass Withdrawal that LEAF1 had already sent — without ever touching DF election, the
                endpoint&apos;s MAC identity, or ECMP itself. +450 XP awarded.
              </p>
              <div className="flex gap-3">
                <Button onClick={handleRestart} variant="secondary">Restart Lesson</Button>
                <Link href="/dashboard"><Button>View Dashboard</Button></Link>
              </div>
            </GlassPanel>
          )}

          {!isComplete && (
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="secondary" size="sm" onClick={() => engine.goTo(Math.max(0, index - 1))} disabled={index === 0}>← Previous</Button>
              <Button size="sm" onClick={() => engine.advance()} disabled={!canAdvance}>{nextLabel}</Button>
              <Button variant={autoPlay ? "primary" : "ghost"} size="sm" onClick={handleToggleAutoPlay}>{autoPlay ? "⏸ Auto-Playing" : "▶ Auto-Play"}</Button>
              <div className="flex gap-1 rounded-full border border-pv-border p-0.5">
                {([0.5, 1, 2] as const).map((s) => (<button key={s} type="button" onClick={() => setSpeed(s)} className={clsx("rounded-full px-2.5 py-1 text-[10px] font-semibold pv-mono transition-colors", speed === s ? "bg-pv-cyan/15 text-pv-cyan-soft" : "text-pv-text-faint hover:text-pv-text")}>{s}x</button>))}
              </div>
              <Button variant="ghost" size="sm" onClick={handleRestart}>⟲ Restart</Button>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <PacketInspector packet={activePacket} focusLayerIndices={xrayMode ? focusIndices : undefined} />
          <div className="flex flex-wrap gap-1 rounded-full border border-pv-border p-0.5 w-fit">
            {(["LEAF1", "LEAF2"] as LeafId[]).map((l) => (
              <span key={l} className={clsx("rounded-full px-3 py-1 text-[11px] font-semibold pv-mono", state.aliasing?.eligiblePEs.includes(l) ? "bg-pv-success/15 text-pv-success" : "text-pv-text-faint")}>
                {l}: {l === "LEAF1" && state.esAttachmentFailed ? "ES down" : state.aliasing ? (state.aliasing.eligiblePEs.includes(l) ? "eligible" : "not eligible") : "—"}
              </span>
            ))}
          </div>
          <p className="pv-mono text-[10px] text-pv-text-faint">SERVER-A: {SERVER_A_IP} · {SERVER_A_MAC}</p>
          <PacketJourneyTimeline hops={state.journey.map((h) => ({ router: h.device, action: h.action, output: h.output }))} />
        </div>
      </div>

      {focusMode && (
        <TopologyFocusMode
          onClose={() => setFocusMode(false)}
          toolbar={
            <>
              <TopologyModeSwitcher
                options={[{ value: "overview", label: "Overview" }, { value: "device", label: "Device" }, { value: "packetFollow", label: "Packet Follow" }, { value: "freeOrbit", label: "Free Orbit" }]}
                value={cameraMode}
                onChange={handleCameraModeChange}
              />
              {inDeviceMode && <TopologyModeSwitcher options={[{ value: "off", label: "Exterior" }, { value: "on", label: "X-Ray" }]} value={deviceXray ? "on" : "off"} onChange={(v) => setDeviceXray(v === "on")} tone="violet" />}
            </>
          }
          header={
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
              <div className="flex min-w-0 items-center gap-2">
                <Badge tone="muted">Step {index + 1} / {totalSteps}</Badge>
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
                {...sceneProps}
                activePacket={inDeviceMode ? undefined : activePacket3D}
                onSelectRegion={(id) => { setSelectedRegionId(id); setSelectedNodeId(undefined); setSelectedLinkId(undefined); setPacketSelected(false); }}
                selectedRegionId={selectedRegionId}
                onSelectNode={(id) => { setSelectedNodeId(id as EvpnAliasingDeviceId); setSelectedRegionId(undefined); setSelectedLinkId(undefined); setPacketSelected(false); setInspectorSurface("device"); setHistoricalIndex(undefined); }}
                onSelectLink={(id) => setSelectedLinkId(id)}
                onFocusLink={setFocusedObject}
                selectedLinkId={selectedLinkId}
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
                        pipelineTitle: effectiveDeviceId === "LEAF3" ? "Conceptual EVPN Aliasing / Mass-Withdrawal Pipeline" : effectiveDeviceId === "LEAF1" || effectiveDeviceId === "LEAF2" ? "Conceptual A-D Advertisement / Decap Pipeline" : "Conceptual Underlay Forwarding Pipeline",
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
              <RepairChallenge options={REPAIR_OPTIONS} attempt={state.repairAttempt} onTry={(choice) => engine.act({ choice })} />
            ) : selectedLinkDetail ? (
              <LinkDetailPanel detail={selectedLinkDetail} onClose={() => { setSelectedLinkId(undefined); setFocusedObject(undefined); }} />
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
                    tabs={isFabricDevice(effectiveDeviceId) ? explorerTabsFor(effectiveDeviceId) : []}
                    xrayEnabled={deviceXray}
                    onToggleXray={() => setDeviceXray((v) => !v)}
                    onExit={() => {
                      setCameraMode("overview");
                      setEnteredDeviceId(undefined);
                    }}
                  />
                </div>
              ) : nodeExplanation ? (
                <NodeInspectorPanel explanation={nodeExplanation} packet={xrayPacket} focusLayerIndices={xrayMode ? focusIndices : undefined} xrayEnabled={xrayMode} />
              ) : (
                <GlassPanel className="p-4">
                  <p className="text-xs text-pv-text-faint">Select a device, or advance the lesson, to inspect a hop.</p>
                </GlassPanel>
              )
            ) : historicalIndex !== undefined && historicalTrace ? (
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
                    setSelectedNodeId(id as EvpnAliasingDeviceId);
                    setInspectorSurface("hop");
                    if (cameraMode === "device") setEnteredDeviceId(id as EvpnAliasingDeviceId);
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
                    setHistoricalIndex(undefined);
                    return;
                  }
                  setHistoricalIndex(entry.index);
                  setFocusedObject(undefined);
                  const histState = engine.getStateAt(entry.index);
                  const histStep = evpnAliasingSteps[entry.index];
                  const histPacket = histStep && histState ? histStep.packet?.(histState) : undefined;
                  const device = deviceForStep(entry.id, histPacket);
                  if (device && isFabricDevice(device)) {
                    setSelectedNodeId(device);
                    if (cameraMode === "device") setEnteredDeviceId(device);
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
                view3D={viewMode === "3d"}
                onToggleView3D={() => setViewMode((v) => (v === "3d" ? "physical" : "3d"))}
              />
            </div>
          }
        />
      )}
    </div>
  );
}

function OverviewTab({ explanation }: { explanation: { currentAction: string; note?: string } }) {
  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-pv-cyan/30 bg-pv-cyan/5 p-3">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-pv-cyan-soft">Current Action</p>
        <p className="text-sm text-pv-text">{explanation.currentAction}</p>
      </div>
      {explanation.note && <p className="rounded-lg border border-pv-warning/30 bg-pv-warning/5 p-2.5 text-xs text-pv-text-muted">{explanation.note}</p>}
    </div>
  );
}

function ControlDataTab({ explanation }: { explanation: { controlPlaneRole?: string; dataPlaneRole?: string } }) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {explanation.controlPlaneRole && <div className="rounded-lg border border-pv-border p-2.5"><p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-pv-text-faint">Control Plane</p><p className="text-xs text-pv-text-muted">{explanation.controlPlaneRole}</p></div>}
      {explanation.dataPlaneRole && <div className="rounded-lg border border-pv-border p-2.5"><p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-pv-text-faint">Data Plane</p><p className="text-xs text-pv-text-muted">{explanation.dataPlaneRole}</p></div>}
    </div>
  );
}

function KeyValueTab({ rows }: { rows: { label: string; value: string }[] }) {
  return (
    <div className="space-y-0.5 rounded-lg border border-pv-border p-2.5 pv-mono text-[11px]">
      {rows.length === 0 ? <p className="text-pv-text-faint">EMPTY</p> : rows.map((r) => (<div key={r.label} className="flex justify-between gap-3"><span className="text-pv-text-faint">{r.label}</span><span className="text-pv-text">{r.value}</span></div>))}
    </div>
  );
}

function RepairChallenge({ options, attempt, onTry }: { options: { id: string; label: string }[]; attempt?: { choice: string; correct: boolean }; onTry: (choice: string) => void }) {
  return (
    <GlassPanel strong className="p-5">
      <p className="mb-3 text-sm font-medium text-pv-text">Converge the multihomed segment — choose the correct repair:</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((opt) => {
          const isSelected = attempt?.choice === opt.id;
          const isCorrect = opt.id === "process-mass-withdrawal";
          return (
            <button key={opt.id} type="button" onClick={() => onTry(opt.id)} className={clsx("rounded-xl border px-4 py-3 text-left text-sm transition-colors cursor-pointer", isSelected && isCorrect && "border-pv-success/50 bg-pv-success/10 text-pv-success", isSelected && !isCorrect && "border-pv-danger/50 bg-pv-danger/10 text-pv-danger", !isSelected && "border-pv-border hover:border-pv-cyan/40 hover:bg-pv-cyan/5")}>
              {opt.label}
            </button>
          );
        })}
      </div>
      {attempt && (
        <div className={clsx("mt-4 rounded-xl border p-4 text-sm", attempt.correct ? "border-pv-success/50 bg-pv-success/10 text-pv-success" : "border-pv-warning/40 bg-pv-warning/5 text-pv-text-muted")}>
          {attempt.correct ? <span className="font-semibold">✓ Mass withdrawal processed — LEAF1 pruned, SERVER-A converges through LEAF2.</span> : (<><span className="mb-1 block font-semibold text-pv-text">That doesn&apos;t fix it.</span>{WRONG_FEEDBACK[attempt.choice] ?? "Try again."}</>)}
        </div>
      )}
    </GlassPanel>
  );
}
