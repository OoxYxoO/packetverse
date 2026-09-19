"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { clsx } from "clsx";
import { useScenarioEngine } from "@/lib/sim-engine/useScenarioEngine";
import {
  ANYCAST_GATEWAYS,
  evpnIrbSteps,
  GRAPH_EDGES,
  GRAPH_NODES,
  GRAPH_REGIONS,
  HOST_A_IP,
  HOST_B_IP,
  HOST_C_IP,
  L2_VNI_10,
  L3_VNI,
  LOGICAL_GRAPH_EDGES,
  LOGICAL_GRAPH_NODES,
  TERMS,
  VRF,
  createEvpnIrbState,
  ipv4LayerIndex,
  leaf1FocusIndices,
  leaf3FocusIndices,
  outerIpLayerIndex,
  sameSubnetPacket,
  withEvpnMesh,
  type EvpnIrbDeviceId,
  type EvpnIrbState,
} from "@/lib/sim-engine/scenarios/evpnIrb";
import { GraphTopologyViewer } from "@/components/network/GraphTopologyViewer";
import { GraphPacket } from "@/components/network/GraphPacket";
import { PacketInspector } from "@/components/network/PacketInspector";
import { ForwardingDecisionCard } from "@/components/protocol/ForwardingDecisionCard";
import { PacketJourneyTimeline } from "@/components/protocol/PacketJourneyTimeline";
import { PlaneSplitPanel } from "@/components/protocol/PlaneSplitPanel";
import { CLIOutputPanel } from "@/components/protocol/CLIOutputPanel";
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
import { anycastGatewayInfoFor, buildIrbCliCommands, buildSpineCliCommands, interfacesFor, linkDetailFor, packetFramesFor, traceFor, vlanVniRowsFor, vrfRoutesRowsFor } from "./deviceTrace";

const FABRIC_DEVICES: ("LEAF1" | "SPINE1" | "LEAF2" | "LEAF3")[] = ["LEAF1", "SPINE1", "LEAF2", "LEAF3"];

const ASYMMETRIC_VS_SYMMETRIC = [
  { model: "Asymmetric IRB", ingress: "Routes", egress: "Mostly bridges destination segment", overlay: "Destination L2 VNI" },
  { model: "Symmetric IRB", ingress: "Routes", egress: "Routes", overlay: `L3 VNI ${L3_VNI}` },
];

/** Which fabric device is the primary inspection subject of a no-packet control-plane step — mirrors evpn-vxlan's PRIMARY_TRANSITION_ROUTER. */
const PRIMARY_TRANSITION_ROUTER: Record<string, "LEAF1" | "SPINE1" | "LEAF2" | "LEAF3"> = {
  "enter-leaf1-irb": "LEAF1",
  "vrf-routing-decision": "LEAF1",
  "fault-injected": "LEAF3",
  "repair-challenge": "LEAF3",
};

function deviceForStep(stepId: string, packet: PacketVisual | undefined): EvpnIrbDeviceId | undefined {
  if (packet) return (packet.from ?? packet.to) as EvpnIrbDeviceId;
  return PRIMARY_TRANSITION_ROUTER[stepId];
}

function eyeOffsetForFocusTarget(target: FocusTarget3D): [number, number, number] {
  const [sx, sy, sz] = target.size ?? [0.6, 0.3, 0.3];
  const maxDim = Math.max(sx, sy, sz);
  const dist = Math.max(0.55, maxDim * 1.8);
  return [dist * 0.55, dist * 0.5, dist * 0.75];
}

const REPAIR_OPTIONS = [
  { id: "restart-evpn", label: "Restart the LEAF1 ↔ LEAF2 ↔ LEAF3 BGP EVPN session" },
  { id: "flap-uplink", label: "Flap LEAF3's uplink to SPINE1" },
  { id: "fix-l3vni", label: `Fix LEAF3's VRF ${VRF} to use L3 VNI ${L3_VNI}` },
  { id: "re-advertise-type2", label: "Re-advertise HOST-B's Type 2 route" },
];
const WRONG_FEEDBACK: Record<string, string> = {
  "restart-evpn": "The BGP EVPN session is already Established — restarting it won't change LEAF3's local VRF-to-VNI mapping at all.",
  "flap-uplink": "The underlay and VTEP reachability are already healthy — this is a local VRF configuration problem, not a link problem.",
  "re-advertise-type2": "HOST-B's Type 2 route is already healthy and imported — the problem isn't reachability, it's which L3 VNI the routed packet is dropped into on arrival.",
};

export default function EvpnIrbDemo() {
  const { engine, snapshot } = useScenarioEngine<EvpnIrbState>(createEvpnIrbState(), evpnIrbSteps);
  const [autoPlay, setAutoPlay] = useState(false);
  const [speed, setSpeed] = useState<0.5 | 1 | 2>(1);
  const [viewMode, setViewMode] = useState<"physical" | "logical" | "3d">("physical");
  const [planeView, setPlaneView] = useState<"control" | "data" | "both">("both");
  const [selectedNodeId, setSelectedNodeId] = useState<EvpnIrbDeviceId | undefined>(undefined);
  const [cameraMode, setCameraMode] = useState<CameraMode>("overview");
  const [enteredDeviceId, setEnteredDeviceId] = useState<EvpnIrbDeviceId | undefined>(undefined);
  const [deviceXray, setDeviceXray] = useState(true);
  const [autoEnterDevices, setAutoEnterDevices] = useState(true);
  const [selectedInterfaceId, setSelectedInterfaceId] = useState<string | undefined>(undefined);
  const [selectedLinkId, setSelectedLinkId] = useState<string | undefined>(undefined);
  const [selectedRegionId, setSelectedRegionId] = useState<string | undefined>(undefined);
  const [packetSelected, setPacketSelected] = useState(false);
  const [xrayMode, setXrayMode] = useState(true);
  const [comparisonTab, setComparisonTab] = useState<"same" | "inter">("inter");
  const [sameSubnetReplayActive, setSameSubnetReplayActive] = useState(false);
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

  const focusIndicesFor = (device: EvpnIrbDeviceId | undefined, packet: typeof activePacket) => {
    if (device === "SPINE1") return outerIpLayerIndex(packet);
    if (device === "LEAF1") return leaf1FocusIndices(packet);
    if (device === "LEAF3") return leaf3FocusIndices(packet);
    if (device === "HOST-B") return ipv4LayerIndex(packet);
    return undefined;
  };
  const focusIndices = focusIndicesFor(state.packetAt, activePacket);
  const lastHop = state.journey[state.journey.length - 1];
  const showPlanes = index >= evpnIrbSteps.findIndex((s) => s.id === "packet-before-routing");
  const showTroubleshootLayers = index >= evpnIrbSteps.findIndex((s) => s.id === "break-intro");
  const showComparison = index >= evpnIrbSteps.findIndex((s) => s.id === "same-subnet-vs-intersubnet");

  useEffect(() => {
    if (!sameSubnetReplayActive) return;
    const t = setTimeout(() => setSameSubnetReplayActive(false), 1800);
    return () => clearTimeout(t);
  }, [sameSubnetReplayActive]);

  // --- 3D derived state ---
  const physicalAugmented = withEvpnMesh(GRAPH_NODES, GRAPH_EDGES, sessionActive);
  const nodes3DBase = layoutTo3D(physicalAugmented.nodes);
  const regions3D = layoutRegionsTo3D(GRAPH_REGIONS);
  const visitedDevices = new Set(state.journey.map((h) => h.device));
  if (state.packet) visitedDevices.add("HOST-A");
  const sameSubnetPkt = sameSubnetReplayActive ? sameSubnetPacket() : undefined;
  const nodes3D = nodes3DBase.map((n) => {
    let status: Node3DStatus = "idle";
    if (n.id === selectedNodeId || n.id === enteredDeviceId) status = "selected";
    else if (sameSubnetPkt && (n.id === sameSubnetPkt.from || n.id === sameSubnetPkt.to)) status = "active";
    else if (activePacket && (n.id === activePacket.from || n.id === activePacket.to)) status = "active";
    else if (visitedDevices.has(n.id as EvpnIrbDeviceId)) status = "onPath";
    const badges = n.id === "LEAF1" || n.id === "LEAF2" ? ["VTEP", "ANYCAST GW 10"] : n.id === "LEAF3" ? ["VTEP", "ANYCAST GW 20"] : n.id === "SPINE1" ? ["UNDERLAY ONLY"] : undefined;
    return { ...n, status, badges };
  });
  const links3D: Link3DData[] = physicalAugmented.edges.map((e) => ({
    ...e,
    active: sameSubnetPkt
      ? (e.a === sameSubnetPkt.from && e.b === sameSubnetPkt.to) || (e.b === sameSubnetPkt.from && e.a === sameSubnetPkt.to)
      : activePacket
        ? (e.a === activePacket.from && e.b === activePacket.to) || (e.b === activePacket.from && e.a === activePacket.to)
        : false,
    onPath: visitedDevices.has(e.a as EvpnIrbDeviceId) && visitedDevices.has(e.b as EvpnIrbDeviceId),
  }));
  const activePacket3D: ActivePacket3D | undefined = sameSubnetPkt
    ? { packet: sameSubnetPkt, fromId: sameSubnetPkt.from, toId: sameSubnetPkt.to }
    : activePacket && nodes3D.some((n) => n.id === activePacket.from) && nodes3D.some((n) => n.id === activePacket.to)
      ? { packet: activePacket, fromId: activePacket.from, toId: activePacket.to }
      : undefined;
  const questionActive = !isComplete && !!currentStep?.question && lastAnswer?.stepId !== currentStep.id;
  const selectedNode3D = nodes3D.find((n) => n.id === selectedNodeId);

  const isFabricDevice = (id: EvpnIrbDeviceId | undefined): id is "LEAF1" | "SPINE1" | "LEAF2" | "LEAF3" => id === "LEAF1" || id === "SPINE1" || id === "LEAF2" || id === "LEAF3";
  const activeDeviceId = FABRIC_DEVICES.find((d) => isFabricDevice(d) && traceFor(d, state, currentStep?.id ?? "").activeStageId !== undefined);
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

  const explainTargetId = effectiveDeviceId ?? selectedNodeId ?? (followNode3D?.id as EvpnIrbDeviceId | undefined);
  const nodeExplanation = explainTargetId ? explainNode(state, explainTargetId) : undefined;
  const xrayPacket = activePacket && (selectedNodeId === activePacket.from || selectedNodeId === activePacket.to) ? activePacket : undefined;

  const selectedLinkDetail = selectedLinkId ? linkDetailFor(selectedLinkId, state) : undefined;
  const devicePacketForTab = xrayPacket ?? (effectiveDeviceId && state.packetAt === effectiveDeviceId ? activePacket : undefined);

  // --- Hop Inspector target — explicit selection wins outright: selectedNodeId > effectiveDeviceId > activeDeviceId. ---
  const selectedFabricId = isFabricDevice(selectedNodeId) ? selectedNodeId : undefined;
  const effectiveFabricId = isFabricDevice(effectiveDeviceId) ? effectiveDeviceId : undefined;
  const focusInspectDeviceId = selectedFabricId ?? effectiveFabricId ?? activeDeviceId;
  const focusTrace = focusInspectDeviceId ? traceFor(focusInspectDeviceId, state, currentStep?.id ?? "") : undefined;
  const focusInterfaces = focusInspectDeviceId ? interfacesFor(focusInspectDeviceId, state, currentStep?.id ?? "") : undefined;

  const journeyStepIndices = evpnIrbSteps.map((s, i) => ({ s, i })).filter(({ s, i }) => i <= index && (!!s.packet || PRIMARY_TRANSITION_ROUTER[s.id] !== undefined));
  const journeyHopEntries = journeyStepIndices.map(({ s, i }) => ({ id: s.id, label: s.label, index: i }));

  const historicalState = historicalIndex !== undefined ? engine.getStateAt(historicalIndex) : undefined;
  const historicalStep = historicalIndex !== undefined ? evpnIrbSteps[historicalIndex] : undefined;
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
    if (v === "device" && !enteredDeviceId) setEnteredDeviceId(isFabricDevice(selectedNodeId) ? selectedNodeId : (activeDeviceId ?? "LEAF1"));
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
    { label: "Underlay", status: "healthy" },
    { label: "VTEP Reachability", status: "healthy" },
    { label: "BGP EVPN", status: state.bgpSessionUp ? "healthy" : "unknown" },
    { label: "Type-2 Reachability", status: state.remoteHostRoutes.LEAF1?.[0]?.imported ? "healthy" : "unknown" },
    { label: "Anycast Gateway", status: state.arpResolved ? "healthy" : "unknown" },
    { label: "L2 VNI", status: "healthy" },
    { label: "VRF", status: "healthy" },
    { label: "L3 VNI Mapping", status: state.faultActive ? "failing" : "healthy" },
    { label: "Routed VXLAN", status: state.faultActive ? "failing" : "healthy" },
    { label: "Inter-Subnet Delivery", status: state.faultActive ? "failing" : "healthy" },
  ];

  useEffect(() => {
    if (isComplete) {
      completeLesson("evpn-irb-anycast-gateway", 350);
      unlockAchievement("anycast-architect");
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
    setComparisonTab("inter");
    setSameSubnetReplayActive(false);
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
        { id: "underlay", label: "Underlay Routes", content: <CLIOutputPanel commands={buildSpineCliCommands()} /> },
        { id: "packet", label: "Packet", content: devicePacketForTab ? <PacketInspector packet={devicePacketForTab} focusLayerIndices={xrayMode ? focusIndicesFor(device, devicePacketForTab) : undefined} /> : <p className="text-xs text-pv-text-faint">No packet at this device right now.</p> },
        { id: "cli", label: "CLI", content: <CLIOutputPanel commands={buildSpineCliCommands()} /> },
      ];
    }
    const gw = anycastGatewayInfoFor(device === "LEAF3" ? "LEAF3" : device);
    return [
      { id: "overview", label: "Overview", content: <OverviewTab explanation={nodeExplanation} /> },
      { id: "hardware", label: "Hardware", content: <p className="text-xs text-pv-text-muted">Generic stylized leaf switch chassis — {deviceInterfaces.length} physical interfaces.</p> },
      { id: "interfaces", label: "Interfaces", content: <InterfaceListTab interfaces={deviceInterfaces} selectedInterfaceId={selectedInterfaceId} onSelectInterface={setSelectedInterfaceId} /> },
      { id: "vlan-vni", label: "VLAN / VNI", content: <KeyValueTab rows={vlanVniRowsFor(device)} /> },
      { id: "mac-evpn", label: "MAC / EVPN", content: <p className="text-xs text-pv-text-muted">{device === "LEAF3" ? "LEAF3 originates HOST-B's own Type 2 route — nothing to import here." : state.remoteHostRoutes[device]?.[0] ? `HOST-B (${state.remoteHostRoutes[device]![0].route.ip}) learned via EVPN Type 2 — remote VTEP LEAF3.` : "No remote host routes learned yet."}</p> },
      { id: "vrf-routes", label: "VRF / Routes", content: <KeyValueTab rows={vrfRoutesRowsFor(state, device)} /> },
      { id: "anycast-gw", label: "Anycast Gateway", content: <KeyValueTab rows={[{ label: "VLAN", value: String(gw.vlan) }, { label: "Gateway IP", value: gw.gatewayIp }, { label: "Gateway MAC", value: gw.gatewayMac }, { label: "Provided by", value: gw.leafs.join(", ") }, { label: "VRF", value: gw.vrf }, { label: "L2 VNI", value: String(gw.l2Vni) }]} /> },
      { id: "packet", label: "Packet", content: devicePacketForTab ? <PacketInspector packet={devicePacketForTab} focusLayerIndices={xrayMode ? focusIndicesFor(device, devicePacketForTab) : undefined} /> : <p className="text-xs text-pv-text-faint">No packet at this device right now.</p> },
      {
        id: "control",
        label: "Control Plane",
        content: (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {nodeExplanation.controlPlaneRole && <div className="rounded-lg border border-pv-border p-2.5"><p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-pv-text-faint">Control Plane</p><p className="text-xs text-pv-text-muted">{nodeExplanation.controlPlaneRole}</p></div>}
            {nodeExplanation.dataPlaneRole && <div className="rounded-lg border border-pv-border p-2.5"><p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-pv-text-faint">Data Plane</p><p className="text-xs text-pv-text-muted">{nodeExplanation.dataPlaneRole}</p></div>}
          </div>
        ),
      },
      { id: "cli", label: "CLI", content: <CLIOutputPanel commands={buildIrbCliCommands(state, device)} /> },
    ];
  };

  return (
    <div className="mx-auto max-w-7xl px-6 py-10">
      <div className="mb-6">
        <Badge tone="cyan" className="mb-3">
          EVPN IRB + Distributed Anycast Gateway · Symmetric IRB
        </Badge>
        <h1 className="text-2xl font-semibold text-pv-text sm:text-3xl">Two Subnets, One Fabric, No Central Router</h1>
        <p className="mt-2 max-w-3xl text-sm text-pv-text-muted">
          HOST-A (VLAN 10) needs HOST-B (VLAN 20) — a different subnet. Watch a gateway that lives locally on every
          relevant leaf route the frame into a VRF, across a routed L3 VNI, to a second leaf that routes it back out.
        </p>
      </div>

      <div className="mb-4 grid gap-2 sm:grid-cols-4">
        {[
          { q: "WHAT is Distributed Anycast Gateway?", a: "The same gateway IP + MAC configured on every leaf serving a subnet — each host reaches its own local leaf, never a centralized router." },
          { q: "WHY symmetric IRB?", a: "Both the ingress and egress VTEP route, over a shared L3 VNI — a leaf never needs a remote subnet locally provisioned just to reach it." },
          { q: "WHAT is an L3 VNI?", a: "A VRF's own routed transport identifier — carries already-routed traffic between VTEPs, distinct from any VLAN's L2 VNI." },
          { q: "WITHOUT it?", a: "Inter-subnet traffic would need to hairpin through one centralized router — exactly what Anycast Gateway avoids." },
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

      {/* TIMELINE */}
      <div className="mb-4 flex gap-1 overflow-x-auto pb-2">
        {evpnIrbSteps.map((step, i) => (
          <button key={step.id} type="button" disabled={i > index} onClick={() => i < index && engine.goTo(i)} title={step.label} className={clsx("h-1.5 flex-1 min-w-3 rounded-full transition-colors", i < index ? "bg-pv-success/70 hover:bg-pv-success cursor-pointer" : i === index ? "bg-pv-cyan" : "bg-white/10")} />
        ))}
      </div>

      <div className="mb-6 flex flex-wrap gap-3">
        <TopologyModeSwitcher
          options={[
            { value: "physical", label: "Physical Topology" },
            { value: "logical", label: "Logical (Routed) View" },
            { value: "3d", label: "3D View" },
          ]}
          value={viewMode}
          onChange={setViewMode}
        />
        {viewMode === "3d" && (
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
                className={clsx(
                  "rounded-full border px-3 py-1.5 text-xs font-semibold uppercase tracking-wide transition-colors",
                  autoEnterDevices ? "border-pv-cyan/50 bg-pv-cyan/15 text-pv-cyan-soft" : "border-pv-border text-pv-text-faint hover:text-pv-text",
                )}
              >
                Auto-Enter Devices
              </button>
            )}
            <TopologyModeSwitcher options={[{ value: "off", label: "Normal View" }, { value: "on", label: "X-Ray Packet View" }]} value={xrayMode ? "on" : "off"} onChange={(v) => setXrayMode(v === "on")} tone="violet" />
          </>
        )}
        {showPlanes && <PlaneViewSwitcher value={planeView} onChange={setPlaneView} />}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_400px]">
        {/* MAIN COLUMN */}
        <div className="space-y-6">
          {viewMode === "3d" ? (
            <>
              <TopologyFrame questionActive={questionActive} onExpand={() => setFocusMode(true)}>
              {focusMode ? (
                <div className="h-96 w-full rounded-2xl border border-pv-border bg-pv-bg-elevated sm:h-[28rem]" />
              ) : (
              <NetworkScene3D
                nodes={nodes3D}
                links={links3D}
                activePacket={inDeviceMode ? undefined : activePacket3D}
                regions={regions3D}
                onSelectRegion={(id) => {
                  setSelectedRegionId(id);
                  setSelectedNodeId(undefined);
                  setSelectedLinkId(undefined);
                  setPacketSelected(false);
                }}
                selectedRegionId={selectedRegionId}
                onSelectNode={(id) => {
                  setSelectedNodeId(id as EvpnIrbDeviceId);
                  setSelectedRegionId(undefined);
                  setSelectedLinkId(undefined);
                  setPacketSelected(false);
                  setInspectorSurface("device");
                  setHistoricalIndex(undefined);
                }}
                onSelectLink={(id) => {
                  setSelectedLinkId(id);
                  setSelectedNodeId(undefined);
                  setSelectedRegionId(undefined);
                  setPacketSelected(false);
                }}
                onFocusLink={setFocusedObject}
                selectedLinkId={selectedLinkId}
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
                        pipelineTitle: effectiveDeviceId === "LEAF1" ? "Conceptual Symmetric IRB Ingress Pipeline" : effectiveDeviceId === "LEAF3" ? "Conceptual Symmetric IRB Egress Pipeline" : effectiveDeviceId === "LEAF2" ? "Conceptual L2 Bridging Pipeline" : "Conceptual Underlay Forwarding Pipeline",
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
                  currentDevice={effectiveDeviceId ?? state.packetAt ?? activePacket?.from ?? "—"}
                  direction="HOST-A → LEAF1 (Anycast GW) → SPINE1 → LEAF3 (Anycast GW) → HOST-B"
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

              {selectedRegionId && (selectedRegionId === "gateway-vlan10" || selectedRegionId === "gateway-vlan20") && !packetSelected && !selectedLinkDetail && (
                <AnycastGatewayPanel vlan={selectedRegionId === "gateway-vlan10" ? 10 : 20} onClose={() => setSelectedRegionId(undefined)} />
              )}

              {inDeviceMode && !packetSelected && !selectedLinkDetail && !selectedRegionId ? (
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
              ) : (
                !packetSelected &&
                !selectedLinkDetail &&
                !selectedRegionId && (
                  <NodeInspectorPanel explanation={nodeExplanation} packet={xrayPacket} focusLayerIndices={xrayMode ? focusIndices : undefined} xrayEnabled={xrayMode}>
                    {selectedNodeId && isFabricDevice(selectedNodeId) && (
                      <Button size="sm" onClick={() => { setEnteredDeviceId(selectedNodeId); setCameraMode("device"); }}>
                        Enter Device →
                      </Button>
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

          {showComparison && (
            <GlassPanel strong className="space-y-3 p-5">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-pv-violet">Same-Subnet vs. Inter-Subnet</h3>
              <div className="flex gap-1 rounded-full border border-pv-border p-0.5 w-fit">
                {(["same", "inter"] as const).map((t) => (
                  <button key={t} type="button" onClick={() => setComparisonTab(t)} className={clsx("rounded-full px-3 py-1 text-[11px] font-semibold uppercase transition-colors", comparisonTab === t ? "bg-pv-cyan/15 text-pv-cyan-soft" : "text-pv-text-faint hover:text-pv-text")}>
                    {t === "same" ? "Same Subnet" : "Inter-Subnet"}
                  </button>
                ))}
              </div>
              {comparisonTab === "same" ? (
                <div className="space-y-2">
                  <p className="text-xs text-pv-text-muted">
                    HOST-A ({HOST_A_IP}) → HOST-C ({HOST_C_IP}) — both VLAN 10. Mechanism: plain L2 VNI {L2_VNI_10} bridging. No gateway, no VRF, no L3 VNI involved at all.
                  </p>
                  <Button size="sm" variant="secondary" disabled={sameSubnetReplayActive} onClick={() => setSameSubnetReplayActive(true)}>
                    {sameSubnetReplayActive ? "HOST-A → HOST-C…" : "Show HOST-A → HOST-C →"}
                  </Button>
                </div>
              ) : (
                <p className="text-xs text-pv-text-muted">
                  HOST-A ({HOST_A_IP}) → HOST-B ({HOST_B_IP}) — VLAN 10 to VLAN 20. Mechanism: local Anycast Gateway → VRF {VRF} → L3 VNI {L3_VNI} → symmetric IRB at LEAF3.
                </p>
              )}
            </GlassPanel>
          )}

          {index >= evpnIrbSteps.findIndex((s) => s.id === "asymmetric-vs-symmetric") && !isComplete && (
            <GlassPanel className="p-4">
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-pv-text-muted">Symmetric vs. Asymmetric IRB</h4>
              <table className="w-full text-left text-[11px]">
                <thead>
                  <tr className="text-pv-text-faint">
                    <th className="pb-1 font-normal">Model</th>
                    <th className="pb-1 font-normal">Ingress VTEP</th>
                    <th className="pb-1 font-normal">Egress VTEP</th>
                    <th className="pb-1 font-normal">Overlay VNI</th>
                  </tr>
                </thead>
                <tbody className="pv-mono text-pv-text">
                  {ASYMMETRIC_VS_SYMMETRIC.map((r) => (
                    <tr key={r.model} className="border-t border-pv-border">
                      <td className="py-1.5">{r.model}</td>
                      <td className="py-1.5">{r.ingress}</td>
                      <td className="py-1.5 text-pv-text-faint">{r.egress}</td>
                      <td className="py-1.5">{r.overlay}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-[11px] text-pv-text-muted">Symmetric IRB scales better on larger fabrics: the ingress VTEP never needs the destination&apos;s L2 segment locally instantiated just to route toward it. Neither model is &quot;wrong.&quot;</p>
            </GlassPanel>
          )}

          {showPlanes && !isComplete && (
            <PlaneSplitPanel
              show={planeView}
              controlTitle="Control Plane — EVPN Type 2 → Remote Host Reachability"
              controlRows={[
                { label: "BGP EVPN mesh", value: state.bgpSessionUp ? "Established" : "Not yet formed" },
                { label: "HOST-B learned on", value: "LEAF3" },
                { label: "LEAF1 remote host route", value: state.remoteHostRoutes.LEAF1?.[0] ? `${state.remoteHostRoutes.LEAF1[0].route.ip} via LEAF3` : "—" },
              ]}
              dataTitle="Data Plane — Anycast GW → VRF → L3 VNI → Symmetric IRB"
              dataRows={
                state.packet
                  ? [
                      { label: "Location", value: state.packetAt ?? "—" },
                      { label: "Encapsulation", value: state.packet.encapsulated ? `Routed VXLAN (L3 VNI ${state.packet.l3Vni ?? L3_VNI})` : "Plain Ethernet" },
                      { label: "IP endpoints", value: `${state.packet.innerSrcIp} → ${state.packet.innerDstIp}` },
                    ]
                  : [{ label: "Frame", value: "none in flight" }]
              }
            />
          )}

          {showTroubleshootLayers && !isComplete && <TroubleshootingLayers title="Troubleshooting Layers" layers={diagnosticLayers} />}

          {isComplete && (
            <GlassPanel strong glow="success" className="flex flex-col items-center gap-4 p-10 text-center">
              <Badge tone="success">Anycast Architect</Badge>
              <h2 className="text-2xl font-semibold text-pv-text">Two Subnets, Routed, No Central Router</h2>
              <p className="max-w-md text-sm text-pv-text-muted">
                You watched a Distributed Anycast Gateway resolve locally, a VRF route the frame across a real L3 VNI
                using symmetric IRB at both ends, then repaired an L3 VNI/VRF mismatch that broke inter-subnet
                delivery while same-subnet traffic and every layer below it stayed completely healthy. +350 XP awarded.
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
                {([0.5, 1, 2] as const).map((s) => (
                  <button key={s} type="button" onClick={() => setSpeed(s)} className={clsx("rounded-full px-2.5 py-1 text-[10px] font-semibold pv-mono transition-colors", speed === s ? "bg-pv-cyan/15 text-pv-cyan-soft" : "text-pv-text-faint hover:text-pv-text")}>
                    {s}x
                  </button>
                ))}
              </div>
              <Button variant="ghost" size="sm" onClick={handleRestart}>⟲ Restart</Button>
            </div>
          )}
        </div>

        {/* SIDEBAR */}
        <div className="space-y-4">
          <PacketInspector packet={activePacket} focusLayerIndices={xrayMode ? focusIndices : undefined} />
          <PacketJourneyTimeline hops={state.journey.map((h) => ({ router: h.device, action: h.action, output: h.output }))} />
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
                nodes={nodes3D}
                links={links3D}
                activePacket={inDeviceMode ? undefined : activePacket3D}
                regions={regions3D}
                onSelectRegion={(id) => {
                  setSelectedRegionId(id);
                  setSelectedNodeId(undefined);
                  setSelectedLinkId(undefined);
                  setPacketSelected(false);
                }}
                selectedRegionId={selectedRegionId}
                onSelectNode={(id) => {
                  setSelectedNodeId(id as EvpnIrbDeviceId);
                  setSelectedRegionId(undefined);
                  setSelectedLinkId(undefined);
                  setPacketSelected(false);
                  setInspectorSurface("device");
                  setHistoricalIndex(undefined);
                }}
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
                        pipelineTitle: effectiveDeviceId === "LEAF1" ? "Conceptual Symmetric IRB Ingress Pipeline" : effectiveDeviceId === "LEAF3" ? "Conceptual Symmetric IRB Egress Pipeline" : effectiveDeviceId === "LEAF2" ? "Conceptual L2 Bridging Pipeline" : "Conceptual Underlay Forwarding Pipeline",
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
              <LinkDetailPanel detail={selectedLinkDetail} onClose={() => { setSelectedLinkId(undefined); setFocusedObject(undefined); }} />
            ) : selectedRegionId === "gateway-vlan10" || selectedRegionId === "gateway-vlan20" ? (
              <AnycastGatewayPanel vlan={selectedRegionId === "gateway-vlan10" ? 10 : 20} onClose={() => setSelectedRegionId(undefined)} />
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
                    setSelectedNodeId(id as EvpnIrbDeviceId);
                    setInspectorSurface("hop");
                    if (cameraMode === "device") setEnteredDeviceId(id as EvpnIrbDeviceId);
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
                  const histStep = evpnIrbSteps[entry.index];
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
      {rows.map((r) => (
        <div key={r.label} className="flex justify-between gap-3">
          <span className="text-pv-text-faint">{r.label}</span>
          <span className="text-pv-text">{r.value}</span>
        </div>
      ))}
    </div>
  );
}

function AnycastGatewayPanel({ vlan, onClose }: { vlan: 10 | 20; onClose: () => void }) {
  const gw = ANYCAST_GATEWAYS[vlan];
  return (
    <GlassPanel strong className="space-y-3 p-5">
      <div className="flex items-center justify-between">
        <h3 className="pv-mono text-sm font-bold text-pv-text">Anycast Gateway — VLAN {vlan}</h3>
        <button type="button" onClick={onClose} className="text-xs text-pv-text-faint hover:text-pv-text">✕</button>
      </div>
      <div className="grid grid-cols-2 gap-2 pv-mono text-[11px]">
        <span className="text-pv-text-faint">Gateway IP</span><span className="text-pv-text">{gw.gatewayIp}</span>
        <span className="text-pv-text-faint">Gateway MAC</span><span className="text-pv-text">{gw.gatewayMac}</span>
        <span className="text-pv-text-faint">Leafs providing it</span><span className="text-pv-text">{gw.leafs.join(", ")}</span>
        <span className="text-pv-text-faint">VRF</span><span className="text-pv-text">{gw.vrf}</span>
        <span className="text-pv-text-faint">L2 VNI</span><span className="text-pv-text">{gw.l2Vni}</span>
      </div>
      <p className="text-xs text-pv-text-muted">Every leaf listed above provides this exact IP/MAC identity locally — a host never needs to hairpin to a centralized gateway.</p>
    </GlassPanel>
  );
}

function RepairChallenge({ options, attempt, onTry }: { options: { id: string; label: string }[]; attempt?: { choice: string; correct: boolean }; onTry: (choice: string) => void }) {
  return (
    <GlassPanel strong className="p-5">
      <p className="mb-3 text-sm font-medium text-pv-text">Restore inter-subnet connectivity — choose the correct repair:</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((opt) => {
          const isSelected = attempt?.choice === opt.id;
          const isCorrect = opt.id === "fix-l3vni";
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
            <span className="font-semibold">✓ L3 VNI corrected — LEAF3&apos;s VRF TENANT-A now matches the routed VXLAN traffic again.</span>
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
