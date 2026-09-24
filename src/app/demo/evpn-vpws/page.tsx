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
  LOCAL_AC_VLAN,
  LOGICAL_GRAPH_EDGES,
  LOGICAL_GRAPH_NODES,
  REMOTE_AC_VLAN,
  TERMS,
  VPWS_SERVICE_ID,
  createEvpnVpwsState,
  evpnVpwsSteps,
  pbRoleFor,
  serviceLayerIndex,
  transportLayerIndex,
  withEvpnMesh,
  type EvpnVpwsDeviceId,
  type EvpnVpwsState,
  type PeId,
} from "@/lib/sim-engine/scenarios/evpnVpws";
import { GraphTopologyViewer } from "@/components/network/GraphTopologyViewer";
import { GraphPacket } from "@/components/network/GraphPacket";
import { PacketInspector } from "@/components/network/PacketInspector";
import { ForwardingDecisionCard } from "@/components/protocol/ForwardingDecisionCard";
import { PacketJourneyTimeline } from "@/components/protocol/PacketJourneyTimeline";
import { PlaneSplitPanel } from "@/components/protocol/PlaneSplitPanel";
import { CLIOutputPanel } from "@/components/protocol/CLIOutputPanel";
import { EvpnRibViewer } from "@/components/protocol/EvpnRouteTable";
import { ElectionViewer } from "@/components/protocol/ElectionViewer";
import { RouteEvolutionViewer } from "@/components/protocol/RouteEvolutionViewer";
import { BgpUpdateCard } from "@/components/protocol/BgpUpdateCard";
import { ServiceInstanceViewer } from "@/components/protocol/ServiceInstanceViewer";
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
  buildVpwsCliCommands,
  esTabRowsFor,
  evpnRibRowsFor,
  interfacesFor,
  labelsTabRowsFor,
  linkDetailFor,
  packetFramesFor,
  pbTabRowsFor,
  remoteEndpointsTabRowsFor,
  traceFor,
  vpwsServicesTabRowsFor,
} from "./deviceTrace";

const REPAIR_OPTIONS = [
  { id: "change-ceb-mac", label: "Change CE-B's MAC address" },
  { id: "add-type2", label: "Add a Type-2 MAC route" },
  { id: "make-pe2-df", label: "Make PE2 the DF" },
  { id: "fix-mtu", label: "Make the VPWS L2 MTU compatible" },
];
const WRONG_FEEDBACK: Record<string, string> = {
  "change-ceb-mac": "VPWS service selection is not failing because of destination-MAC learning — CE-B's identity was never the problem.",
  "add-type2": "VPWS service establishment is driven by Ethernet A-D per-EVI signaling, not Type-2 MAC routes — adding one wouldn't touch the actual failure.",
  "make-pe2-df": "The current failure is service-parameter compatibility, not Primary/Backup election — DF isn't even a concept this lesson uses.",
};

/** Which fabric device is the primary inspection subject of a no-packet control-plane step. */
const PRIMARY_TRANSITION_ROUTER: Record<string, "PE1" | "CORE" | "PE2" | "PE3"> = {
  "topology-intro": "PE1",
  "es-inspector": "PE1",
  "single-active-election": "PE1",
  "pe1-advertises-adevi": "PE1",
  "pe2-advertises-adevi": "PE2",
  "pe3-advertises-adevi": "PE3",
  "vpws-route-discovery": "PE3",
  "core-transport-only": "CORE",
  "pe3-disposition": "PE3",
  "failure-intro": "PE1",
  "control-plane-response": "PE1",
  "primary-backup-failover": "PE2",
  "restore-pe1-ac": "PE1",
  "fault-injected": "PE3",
  "repair-challenge": "PE3",
  "verify-repair": "PE3",
  "challenge-refail-pe1": "PE2",
};

function deviceForStep(stepId: string, packet: PacketVisual | undefined): EvpnVpwsDeviceId | undefined {
  if (packet) return (packet.from ?? packet.to) as EvpnVpwsDeviceId;
  return PRIMARY_TRANSITION_ROUTER[stepId];
}

function eyeOffsetForFocusTarget(target: FocusTarget3D): [number, number, number] {
  const [sx, sy, sz] = target.size ?? [0.6, 0.3, 0.3];
  const maxDim = Math.max(sx, sy, sz);
  const dist = Math.max(0.55, maxDim * 1.8);
  return [dist * 0.55, dist * 0.5, dist * 0.75];
}

const FABRIC_ENTERABLE: ("PE1" | "CORE" | "PE2" | "PE3")[] = ["PE1", "CORE", "PE2", "PE3"];

export default function EvpnVpwsDemo() {
  const { engine, snapshot } = useScenarioEngine<EvpnVpwsState>(createEvpnVpwsState(), evpnVpwsSteps);
  const [autoPlay, setAutoPlay] = useState(false);
  const [speed, setSpeed] = useState<0.5 | 1 | 2>(1);
  const [viewMode, setViewMode] = useState<"physical" | "logical" | "3d">("physical");
  const [planeView, setPlaneView] = useState<"control" | "data" | "both">("both");
  const [selectedNodeId, setSelectedNodeId] = useState<EvpnVpwsDeviceId | undefined>(undefined);
  const [cameraMode, setCameraMode] = useState<CameraMode>("overview");
  const [enteredDeviceId, setEnteredDeviceId] = useState<EvpnVpwsDeviceId | undefined>(undefined);
  const [deviceXray, setDeviceXray] = useState(true);
  const [autoEnterDevices, setAutoEnterDevices] = useState(true);
  const [selectedInterfaceId, setSelectedInterfaceId] = useState<string | undefined>(undefined);
  const [selectedLinkId, setSelectedLinkId] = useState<string | undefined>(undefined);
  const [selectedRegionId, setSelectedRegionId] = useState<string | undefined>(undefined);
  const [packetSelected, setPacketSelected] = useState(false);
  const [xrayMode, setXrayMode] = useState(true);
  const [pbAdvanced, setPbAdvanced] = useState(false);
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
  const pbLabel = (pe: PeId) => (pe === "PE1" && state.pe1AcFailed ? "AC DOWN" : pbRoleFor(state.election, pe).toUpperCase().replace("-", " "));
  const nodes =
    viewMode === "physical"
      ? augmented.nodes.map((n) => (n.id === "PE1" ? { ...n, subLabel: pbLabel("PE1") } : n.id === "PE2" ? { ...n, subLabel: pbLabel("PE2") } : n))
      : augmented.nodes;
  const edges = augmented.edges.map((e) => ({ ...e, state: "full" as const }));
  const activeNodeIds = activePacket ? [activePacket.from, activePacket.to] : [];
  const packetFrom = activePacket ? nodes.find((n) => n.id === activePacket.from) : undefined;
  const packetTo = activePacket ? nodes.find((n) => n.id === activePacket.to) : undefined;

  const focusIndices = state.packetAt === "CORE" ? transportLayerIndex(state.packet) : state.packetAt === "PE3" ? serviceLayerIndex(state.packet) : undefined;
  const lastHop = state.journey[state.journey.length - 1];
  const showPlanes = index >= evpnVpwsSteps.findIndex((s) => s.id === "cea-sends-frame");
  const showTroubleshootLayers = index >= evpnVpwsSteps.findIndex((s) => s.id === "break-intro");

  const physicalAugmented = withEvpnMesh(GRAPH_NODES, GRAPH_EDGES, sessionActive);
  const nodes3DBase = layoutTo3D(physicalAugmented.nodes);
  const regions3D = layoutRegionsTo3D(GRAPH_REGIONS);
  const visitedDevices = new Set(state.journey.map((h) => h.device));
  const nodes3D = nodes3DBase.map((n) => {
    let status: Node3DStatus = "idle";
    if (n.id === selectedNodeId || n.id === enteredDeviceId) status = "selected";
    else if (activePacket && (n.id === activePacket.from || n.id === activePacket.to)) status = "active";
    else if (visitedDevices.has(n.id as EvpnVpwsDeviceId)) status = "onPath";
    const badges =
      n.id === "PE1"
        ? state.pe1AcFailed
          ? ["ESI", "AC DOWN"]
          : ["ESI", pbRoleFor(state.election, "PE1").toUpperCase()]
        : n.id === "PE2"
          ? ["ESI", pbRoleFor(state.election, "PE2").toUpperCase()]
          : undefined;
    return { ...n, status, badges };
  });
  const links3D: Link3DData[] = physicalAugmented.edges.map((e) => ({
    ...e,
    active: activePacket ? (e.a === activePacket.from && e.b === activePacket.to) || (e.b === activePacket.from && e.a === activePacket.to) : false,
    onPath: visitedDevices.has(e.a as EvpnVpwsDeviceId) && visitedDevices.has(e.b as EvpnVpwsDeviceId),
  }));
  const activePacket3D: ActivePacket3D | undefined = activePacket && nodes3D.some((n) => n.id === activePacket.from) && nodes3D.some((n) => n.id === activePacket.to) ? { packet: activePacket, fromId: activePacket.from, toId: activePacket.to } : undefined;
  const questionActive = !isComplete && !!currentStep?.question && lastAnswer?.stepId !== currentStep.id;
  const selectedNode3D = nodes3D.find((n) => n.id === selectedNodeId);

  const isFabricDevice = (id: EvpnVpwsDeviceId | undefined): id is "PE1" | "CORE" | "PE2" | "PE3" => id === "PE1" || id === "CORE" || id === "PE2" || id === "PE3";
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

  const explainTargetId = effectiveDeviceId ?? selectedNodeId ?? (followNode3D?.id as EvpnVpwsDeviceId | undefined);
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

  const journeyStepIndices = evpnVpwsSteps.map((s, i) => ({ s, i })).filter(({ s, i }) => i <= index && (!!s.packet || PRIMARY_TRANSITION_ROUTER[s.id] !== undefined));
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

  const historicalState = historicalCursor !== undefined ? engine.getStateAt(historicalCursor) : undefined;
  const historicalStep = historicalCursor !== undefined ? evpnVpwsSteps[historicalCursor] : undefined;
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
    if (v === "device" && !enteredDeviceId) setEnteredDeviceId(isFabricDevice(selectedNodeId) ? selectedNodeId : (activeDeviceId ?? "PE1"));
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
    { label: "Physical", status: "healthy" },
    { label: "Provider Core", status: "healthy" },
    { label: "BGP EVPN", status: "healthy" },
    { label: "Type-1 Per-EVI Received", status: "healthy" },
    { label: "VPWS Service ID", status: "healthy" },
    { label: "Remote Endpoint Found", status: "healthy" },
    { label: "L2 MTU Compatibility", status: state.mtuFault ? "failing" : "healthy" },
    { label: "Remote Endpoint Usable", status: state.mtuFault ? "failing" : "healthy" },
    { label: "VPWS Forwarding State", status: state.mtuFault ? "failing" : "healthy" },
    { label: "Customer Delivery", status: state.mtuFault ? "failing" : "healthy" },
  ];

  useEffect(() => {
    if (isComplete) {
      completeLesson("evpn-single-active-vpws", 450);
      unlockAchievement("virtual-wire-engineer");
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

  const ethernetSegmentInspector = (
    <GlassPanel strong className="space-y-2 p-5">
      <div className="flex items-center justify-between">
        <h3 className="pv-mono text-sm font-bold text-pv-text">Ethernet Segment</h3>
        <button type="button" onClick={() => setSelectedRegionId(undefined)} className="text-xs text-pv-text-faint hover:text-pv-text">✕</button>
      </div>
      <div className="grid grid-cols-2 gap-2 pv-mono text-[11px]">
        <span className="text-pv-text-faint">ESI</span><span className="text-pv-text">{ESI}</span>
        <span className="text-pv-text-faint">Redundancy Mode</span><span className="text-pv-text">SINGLE-ACTIVE</span>
        <span className="text-pv-text-faint">Primary</span><span className="text-pv-text">{state.election.primaryPe ?? "(not yet elected)"}</span>
        <span className="text-pv-text-faint">Backup</span><span className="text-pv-text">{state.election.backupPe ?? "(none)"}</span>
        <span className="text-pv-text-faint">Service</span><span className="text-pv-text">VPWS-{VPWS_SERVICE_ID}</span>
      </div>
    </GlassPanel>
  );

  const handleRestart = () => {
    setAutoPlay(false);
    engine.restart();
    setCameraMode("overview");
    setEnteredDeviceId(undefined);
    setSelectedNodeId(undefined);
    setSelectedLinkId(undefined);
    setSelectedRegionId(undefined);
    setPacketSelected(false);
    setPbAdvanced(false);
    setFocusedObject(undefined);
    setHistoricalIndex(undefined);
    setInspectorSurface("hop");
  };

  const nextLabel = currentStep?.question && !lastAnswer ? "Answer to continue" : currentStep?.requiresState && !canAdvance ? "Apply the correct fix to continue" : "Next Step →";

  const explorerTabsFor = (device: "PE1" | "CORE" | "PE2" | "PE3"): DeviceExplorerTab[] => {
    if (!nodeExplanation) return [];
    if (device === "CORE") {
      return [
        { id: "overview", label: "Overview", content: <OverviewTab explanation={nodeExplanation} /> },
        { id: "interfaces", label: "Interfaces", content: <InterfaceListTab interfaces={deviceInterfaces} selectedInterfaceId={selectedInterfaceId} onSelectInterface={setSelectedInterfaceId} /> },
        { id: "packet", label: "Packet", content: devicePacketForTab ? <PacketInspector packet={devicePacketForTab} /> : <p className="text-xs text-pv-text-faint">No packet at this device right now.</p> },
        { id: "cli", label: "CLI", content: <CLIOutputPanel commands={buildVpwsCliCommands(state, device)} /> },
      ];
    }
    if (device === "PE3") {
      return [
        { id: "overview", label: "Overview", content: <OverviewTab explanation={nodeExplanation} /> },
        { id: "hardware", label: "Hardware", content: <p className="text-xs text-pv-text-muted">Generic stylized PE router chassis — {deviceInterfaces.length} physical interfaces.</p> },
        { id: "interfaces", label: "Interfaces", content: <InterfaceListTab interfaces={deviceInterfaces} selectedInterfaceId={selectedInterfaceId} onSelectInterface={setSelectedInterfaceId} /> },
        { id: "evpn-routes", label: "EVPN Routes", content: <EvpnRibViewer title={device} rows={evpnRibRowsFor(state, device)} /> },
        { id: "vpws-services", label: "VPWS Services", content: <KeyValueTab rows={vpwsServicesTabRowsFor(state, device)} /> },
        { id: "remote-endpoints", label: "Remote Endpoints", content: <KeyValueTab rows={remoteEndpointsTabRowsFor(state)} /> },
        { id: "labels", label: "Labels", content: <KeyValueTab rows={labelsTabRowsFor(state, device)} /> },
        { id: "packet", label: "Packet", content: devicePacketForTab ? <PacketInspector packet={devicePacketForTab} /> : <p className="text-xs text-pv-text-faint">No packet at this device right now.</p> },
        { id: "cli", label: "CLI", content: <CLIOutputPanel commands={buildVpwsCliCommands(state, device)} /> },
      ];
    }
    return [
      { id: "overview", label: "Overview", content: <OverviewTab explanation={nodeExplanation} /> },
      { id: "hardware", label: "Hardware", content: <p className="text-xs text-pv-text-muted">Generic stylized PE router chassis — {deviceInterfaces.length} physical interfaces.</p> },
      { id: "interfaces", label: "Interfaces", content: <InterfaceListTab interfaces={deviceInterfaces} selectedInterfaceId={selectedInterfaceId} onSelectInterface={setSelectedInterfaceId} /> },
      { id: "ethernet-segment", label: "Ethernet Segment", content: <KeyValueTab rows={esTabRowsFor(state, device)} /> },
      { id: "evpn-routes", label: "EVPN Routes", content: <EvpnRibViewer title={device} rows={evpnRibRowsFor(state, device)} /> },
      { id: "vpws-services", label: "VPWS Services", content: <KeyValueTab rows={vpwsServicesTabRowsFor(state, device)} /> },
      { id: "primary-backup", label: "Primary / Backup", content: <KeyValueTab rows={pbTabRowsFor(state, device)} /> },
      { id: "labels", label: "Labels", content: <KeyValueTab rows={labelsTabRowsFor(state, device)} /> },
      { id: "packet", label: "Packet", content: devicePacketForTab ? <PacketInspector packet={devicePacketForTab} /> : <p className="text-xs text-pv-text-faint">No packet at this device right now.</p> },
      { id: "cli", label: "CLI", content: <CLIOutputPanel commands={buildVpwsCliCommands(state, device)} /> },
    ];
  };

  const pipelineTitleFor = (device: "PE1" | "CORE" | "PE2" | "PE3") =>
    device === "PE3" ? "Conceptual EVPN-VPWS Egress Pipeline" : device === "CORE" ? "Conceptual Transport Forwarding Pipeline" : "Conceptual VPWS Control / Forwarding Pipeline";

  const sceneProps = { nodes: nodes3D, links: links3D, regions: regions3D };

  return (
    <div className="mx-auto max-w-7xl px-6 py-10">
      <div className="mb-6">
        <Badge tone="cyan" className="mb-3">EVPN Single-Active + EVPN-VPWS · Route Type 1</Badge>
        <h1 className="text-2xl font-semibold text-pv-text sm:text-3xl">A Virtual Wire, Protected By One Primary</h1>
        <p className="mt-2 max-w-3xl text-sm text-pv-text-muted">
          Act 1: CE-A is dual-homed, but only one PE — the Primary — forwards traffic at a time. Act 2: that
          Single-Active redundancy protects a point-to-point EVPN-VPWS service between CE-A and CE-B.
        </p>
      </div>

      <div className="mb-4 grid gap-2 sm:grid-cols-4">
        {[
          { q: "IS THE BACKUP DOWN?", a: "No — Single-Active is a control-plane role. The Backup can be fully healthy while simply not forwarding this service's traffic." },
          { q: "IS VPWS ORDINARY BRIDGING?", a: "No — it's point-to-point. Ethernet A-D per-EVI is central; Type-2 MAC routes are not required to establish it." },
          { q: "DOES THE FRAME LOSE ITS MACS?", a: "No — customer Ethernet frames still contain normal MAC addresses. The provider decision is service/AC based, not a multipoint MAC lookup." },
          { q: "WHAT'S DEFERRED?", a: "The full All-Active VPWS data plane, a second VXLAN-VPWS simulation, Type 5/IRB/tenant VRFs." },
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
        {evpnVpwsSteps.map((step, i) => (
          <button key={step.id} type="button" disabled={i > index} onClick={() => i < index && engine.goTo(i)} title={step.label} className={clsx("h-1.5 flex-1 min-w-3 rounded-full transition-colors", i < index ? "bg-pv-success/70 hover:bg-pv-success cursor-pointer" : i === index ? "bg-pv-cyan" : "bg-white/10")} />
        ))}
      </div>

      <div className="mb-6 flex flex-wrap gap-3">
        <TopologyModeSwitcher options={[{ value: "physical", label: "Physical Topology" }, { value: "logical", label: "Logical (Virtual Wire) View" }, { value: "3d", label: "3D View" }]} value={viewMode} onChange={setViewMode} />
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
                onSelectNode={(id) => { setSelectedNodeId(id as EvpnVpwsDeviceId); setSelectedRegionId(undefined); setSelectedLinkId(undefined); setPacketSelected(false); setInspectorSurface("device"); setHistoricalIndex(undefined); }}
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
                        pipelineTitle: isFabricDevice(effectiveDeviceId) ? pipelineTitleFor(effectiveDeviceId) : undefined,
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
                  direction={state.direction === "ce-a-to-ce-b" ? "CE-A → PE1/PE2 → Core → PE3 → CE-B" : "CE-B → PE3 → Core → Primary PE → CE-A"}
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

              {selectedRegionId === "ethernet-segment" && !packetSelected && !selectedLinkDetail && ethernetSegmentInspector}

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
          ) : viewMode === "logical" ? (
            <>
              <GraphTopologyViewer nodes={nodes} edges={edges} activeNodeIds={activeNodeIds} regions={[]} />
              <GlassPanel className="p-4">
                <p className="text-xs text-pv-text-muted">The provider network fades away in this logical view — CE-A&apos;s AC and CE-B&apos;s AC are joined directly by VPWS-{VPWS_SERVICE_ID}, a point-to-point virtual Ethernet wire.</p>
              </GlassPanel>
            </>
          ) : (
            <>
              <GraphTopologyViewer nodes={nodes} edges={edges} activeNodeIds={activeNodeIds} regions={GRAPH_REGIONS}>
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

          {currentStep?.id === "single-active-election" && (
            <ElectionViewer
              title="Single-Active Election"
              scope={`ESI ${ESI.slice(-8)} · VPWS-${VPWS_SERVICE_ID}`}
              algorithm={state.election.algorithm}
              candidates={state.election.candidates.map((c) => ({ id: c.pe, label: c.pe, value: c.electionValue, available: c.available }))}
              winnerId={state.election.primaryPe}
              reason={state.election.reason}
              roleFor={(c) => (c.id === state.election.primaryPe ? { label: "PRIMARY", tone: "success" } : c.id === state.election.backupPe ? { label: "BACKUP", tone: "warning" } : undefined)}
            />
          )}

          {currentStep?.id === "all-active-vs-single-active" && (
            <div className="grid gap-2 sm:grid-cols-2">
              <GlassPanel strong className="p-4">
                <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-pv-violet">ALL-ACTIVE</h4>
                <p className="text-[11px] text-pv-text-muted">Multiple forwarding PEs — flow-based use of eligible paths.</p>
              </GlassPanel>
              <GlassPanel strong className="p-4">
                <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-pv-cyan-soft">SINGLE-ACTIVE</h4>
                <p className="text-[11px] text-pv-text-muted">One active forwarding PE — backup prepared to take over.</p>
              </GlassPanel>
            </div>
          )}

          {currentStep?.id === "vpws-service-viewer" && (
            <ServiceInstanceViewer
              title={`VPWS Service Instance ${VPWS_SERVICE_ID}`}
              subtitle="Point-to-Point Ethernet Service"
              status={state.vpwsService?.status ?? "down"}
              fields={[
                { label: "Service ID", value: String(VPWS_SERVICE_ID) },
                { label: "Endpoint A", value: "CE-A / PE1-PE2" },
                { label: "Endpoint B", value: "CE-B / PE3" },
                { label: "Local AC", value: `VLAN ${LOCAL_AC_VLAN}` },
                { label: "Remote AC", value: `VLAN ${REMOTE_AC_VLAN}` },
                { label: "Redundancy", value: "Single-Active" },
                { label: "Primary", value: state.election.primaryPe ?? "(not yet elected)" },
                { label: "Backup", value: state.election.backupPe ?? "(none)" },
              ]}
            />
          )}

          {currentStep?.id === "primary-backup-signaling" && (
            <GlassPanel strong className="space-y-3 p-4">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-pv-violet">Primary / Backup Signaling</h4>
                <button type="button" onClick={() => setPbAdvanced((v) => !v)} className="rounded-full border border-pv-border px-2.5 py-1 text-[10px] font-semibold uppercase text-pv-text-faint hover:text-pv-text">
                  {pbAdvanced ? "Beginner View" : "[ Advanced ]"}
                </button>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {(["PE1", "PE2"] as PeId[]).map((pe) => {
                  const role = pbRoleFor(state.election, pe);
                  const route = state.perEviAdRoutes[pe];
                  return (
                    <div key={pe} className={clsx("rounded-lg border p-3", role === "primary" ? "border-pv-success/50 bg-pv-success/5" : "border-pv-border")}>
                      <p className="pv-mono text-sm font-semibold text-pv-text">{pe}</p>
                      {pbAdvanced ? (
                        <div className="mt-1 space-y-0.5 pv-mono text-[11px] text-pv-text-muted">
                          <p>P Flag: {role === "primary" ? "1" : "0"}</p>
                          <p>B Flag: {role === "backup" ? "1" : "0"}</p>
                          <p>L2 MTU: {route?.l2Mtu ?? "—"}</p>
                          <p>Control-Word Indicator: not modeled</p>
                        </div>
                      ) : (
                        <Badge tone={role === "primary" ? "success" : "muted"}>{role.toUpperCase()}</Badge>
                      )}
                    </div>
                  );
                })}
              </div>
            </GlassPanel>
          )}

          {currentStep?.id === "control-plane-response" && state.perEviAdRoutes.PE1 && (
            <BgpUpdateCard
              title="EVPN Route Type 1 — A-D Per-EVI"
              from="PE1"
              to="BGP EVPN"
              action="withdraw"
              fields={[
                { label: "VPWS Service ID", value: String(VPWS_SERVICE_ID) },
                { label: "ESI", value: ESI },
                { label: "PE", value: "PE1" },
                { label: "Action", value: "WITHDRAW" },
              ]}
            />
          )}

          {currentStep?.id === "pb-route-transition" && (
            <RouteEvolutionViewer
              title="Primary / Backup — Before And After Failover"
              oldLabel="BEFORE"
              newLabel="AFTER"
              fields={[
                { label: "PE1", oldValue: "P=1 B=0 (Primary)", newValue: "Unavailable for VPWS-500", decisive: true },
                { label: "PE2", oldValue: "P=0 B=1 (Backup)", newValue: "P=1 B=0 (Primary)", decisive: true },
              ]}
              winnerReason="These are VPWS control-plane roles carried on the A-D per-EVI route — never bits inside the customer's own packet."
            />
          )}

          {currentStep?.id === "data-path-failover" && (
            <div className="grid gap-2 sm:grid-cols-2">
              <GlassPanel strong className="p-4">
                <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-pv-text-faint">BEFORE</h4>
                <p className="pv-mono text-xs text-pv-text">CE-B → PE3 → PE1 → CE-A</p>
              </GlassPanel>
              <GlassPanel strong className="p-4">
                <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-pv-success">AFTER</h4>
                <p className="pv-mono text-xs text-pv-text">CE-B → PE3 → PE2 → CE-A</p>
              </GlassPanel>
            </div>
          )}

          {currentStep?.id === "compare-vpws-vs-bridging" && (
            <div className="grid gap-2 sm:grid-cols-2">
              <GlassPanel strong className="p-4">
                <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-pv-violet">EVPN BRIDGING</h4>
                <p className="text-[11px] text-pv-text-muted">Multipoint service. MAC/IP routes matter. MAC lookup participates.</p>
              </GlassPanel>
              <GlassPanel strong className="p-4">
                <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-pv-cyan-soft">EVPN-VPWS</h4>
                <p className="text-[11px] text-pv-text-muted">Point-to-point service. Two service endpoints. Type-1 per-EVI is central. No ordinary multipoint MAC lookup required.</p>
              </GlassPanel>
            </div>
          )}

          {currentStep?.id === "compare-traditional-pw" && (
            <div className="grid gap-2 sm:grid-cols-2">
              <GlassPanel strong className="p-4">
                <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-pv-text-faint">TRADITIONAL VPWS / PW</h4>
                <p className="text-[11px] text-pv-text-muted">Service endpoint/label signaling commonly associated with pseudowire mechanisms (e.g. LDP-based).</p>
              </GlassPanel>
              <GlassPanel strong className="p-4">
                <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-pv-cyan-soft">EVPN-VPWS</h4>
                <p className="text-[11px] text-pv-text-muted">BGP EVPN provides service discovery and service-label signaling instead.</p>
              </GlassPanel>
            </div>
          )}

          {currentStep?.id === "multiple-vpws-scaling" && (
            <GlassPanel strong className="p-4">
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-pv-text-muted">Same Ethernet Segment, Distinct VPWS Services</h4>
              <div className="grid grid-cols-4 gap-2 pv-mono text-[11px]">
                <span className="text-pv-text-faint">Service</span><span className="text-pv-text-faint">A-D Per-EVI</span><span className="text-pv-text-faint">Service ID</span><span className="text-pv-text-faint">Service Label</span>
                <span className="text-pv-text">VPWS-500</span><span className="text-pv-text">PE1/PE2 → PE3</span><span className="text-pv-text">500</span><span className="text-pv-text">24500</span>
                <span className="text-pv-text">VPWS-501</span><span className="text-pv-text">PE1/PE2 → PE3</span><span className="text-pv-text">501</span><span className="text-pv-text">24501</span>
                <span className="text-pv-text">VPWS-502</span><span className="text-pv-text">PE1/PE2 → PE3</span><span className="text-pv-text">502</span><span className="text-pv-text">24502</span>
              </div>
              <p className="mt-2 text-[11px] text-pv-text-faint">One service label never automatically identifies all services on the ES — each has its own A-D per-EVI route, service ID, and service label.</p>
            </GlassPanel>
          )}

          {currentStep?.id === "transport-independence-note" && (
            <GlassPanel className="p-4">
              <p className="text-xs text-pv-text-muted">EVPN-VPWS control-plane procedures are not limited to this MPLS visualization — VXLAN encapsulation is also conceptually supported. This lesson keeps MPLS as the actual simulated data plane and does not add a second full VXLAN-VPWS simulation.</p>
            </GlassPanel>
          )}

          {showPlanes && !isComplete && (
            <PlaneSplitPanel
              show={planeView}
              controlTitle="Control — A-D Per-EVI + P/B Signaling → Service Discovery"
              controlRows={[
                { label: "BGP EVPN mesh", value: state.bgpSessionUp ? "Established" : "Not yet formed" },
                { label: "Primary", value: state.election.primaryPe ?? "—" },
                { label: "VPWS-500 Status", value: state.vpwsService?.status.toUpperCase() ?? "DOWN" },
              ]}
              dataTitle="Data — Customer Ethernet → Service Lookup → MPLS → Remote AC"
              dataRows={[{ label: "Direction", value: state.direction === "ce-a-to-ce-b" ? "CE-A → CE-B" : "CE-B → CE-A" }, { label: "Via Primary", value: state.election.primaryPe ?? "—" }]}
            />
          )}

          {showTroubleshootLayers && !isComplete && <TroubleshootingLayers title="Troubleshooting Layers" layers={diagnosticLayers} />}

          {currentStep?.id === "single-active-vs-all-active-vpws" && (
            <div className="grid gap-2 sm:grid-cols-2">
              <GlassPanel strong className="p-4">
                <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-pv-cyan-soft">SINGLE-ACTIVE VPWS</h4>
                <p className="text-[11px] text-pv-text-muted">One Primary, one Backup. Remote traffic uses Primary. This lesson&apos;s simulation.</p>
              </GlassPanel>
              <GlassPanel strong className="p-4">
                <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-pv-violet">ALL-ACTIVE VPWS</h4>
                <p className="text-[11px] text-pv-text-muted">Multiple active PEs may participate in per-flow forwarding. Not built here.</p>
              </GlassPanel>
            </div>
          )}

          {isComplete && (
            <GlassPanel strong glow="success" className="flex flex-col items-center gap-4 p-10 text-center">
              <Badge tone="success">Virtual Wire Engineer</Badge>
              <h2 className="text-2xl font-semibold text-pv-text">The Wire Held</h2>
              <p className="max-w-md text-sm text-pv-text-muted">
                CE-A and CE-B stayed connected over a point-to-point EVPN-VPWS service — surviving a Primary/Backup
                failover and a service-parameter repair, all signaled through Ethernet A-D per-EVI routes rather than
                ordinary Type-2 MAC learning. +450 XP awarded.
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
            {(["PE1", "PE2"] as PeId[]).map((pe) => (
              <span key={pe} className={clsx("rounded-full px-3 py-1 text-[11px] font-semibold pv-mono", pbRoleFor(state.election, pe) === "primary" ? "bg-pv-success/15 text-pv-success" : "text-pv-text-faint")}>
                {pe}: {pe === "PE1" && state.pe1AcFailed ? "AC down" : { "not-elected": "not elected", primary: "primary", backup: "backup", ineligible: "ineligible" }[pbRoleFor(state.election, pe)]}
              </span>
            ))}
          </div>
          <p className="pv-mono text-[10px] text-pv-text-faint">VPWS-{VPWS_SERVICE_ID}: {state.vpwsService?.status.toUpperCase() ?? "DOWN"}</p>
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
                onSelectNode={(id) => { setSelectedNodeId(id as EvpnVpwsDeviceId); setSelectedRegionId(undefined); setSelectedLinkId(undefined); setPacketSelected(false); setInspectorSurface("device"); setHistoricalIndex(undefined); }}
                onSelectLink={(id) => { setSelectedLinkId(id); setSelectedRegionId(undefined); }}
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
                        pipelineTitle: isFabricDevice(effectiveDeviceId) ? pipelineTitleFor(effectiveDeviceId) : undefined,
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
            ) : selectedRegionId === "ethernet-segment" ? (
              ethernetSegmentInspector
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
                    setSelectedNodeId(id as EvpnVpwsDeviceId);
                    setInspectorSurface("hop");
                    if (cameraMode === "device") setEnteredDeviceId(id as EvpnVpwsDeviceId);
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
                  setSelectedLinkId(undefined);
                  setSelectedRegionId(undefined);
                  const histState = engine.getStateAt(entry.index);
                  const histStep = evpnVpwsSteps[entry.index];
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
      <p className="mb-3 text-sm font-medium text-pv-text">Protect the virtual wire — choose the correct repair:</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((opt) => {
          const isSelected = attempt?.choice === opt.id;
          const isCorrect = opt.id === "fix-mtu";
          return (
            <button key={opt.id} type="button" onClick={() => onTry(opt.id)} className={clsx("rounded-xl border px-4 py-3 text-left text-sm transition-colors cursor-pointer", isSelected && isCorrect && "border-pv-success/50 bg-pv-success/10 text-pv-success", isSelected && !isCorrect && "border-pv-danger/50 bg-pv-danger/10 text-pv-danger", !isSelected && "border-pv-border hover:border-pv-cyan/40 hover:bg-pv-cyan/5")}>
              {opt.label}
            </button>
          );
        })}
      </div>
      {attempt && (
        <div className={clsx("mt-4 rounded-xl border p-4 text-sm", attempt.correct ? "border-pv-success/50 bg-pv-success/10 text-pv-success" : "border-pv-warning/40 bg-pv-warning/5 text-pv-text-muted")}>
          {attempt.correct ? <span className="font-semibold">✓ PE3&apos;s expected L2 MTU corrected — VPWS-500 is UP again.</span> : (<><span className="mb-1 block font-semibold text-pv-text">That doesn&apos;t fix it.</span>{WRONG_FEEDBACK[attempt.choice] ?? "Try again."}</>)}
        </div>
      )}
    </GlassPanel>
  );
}
