"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { clsx } from "clsx";
import { useScenarioEngine } from "@/lib/sim-engine/useScenarioEngine";
import {
  EXAMPLE_TYPE2_ROUTE,
  GRAPH_EDGES,
  GRAPH_NODES,
  GRAPH_REGIONS,
  L3_VNI,
  LOGICAL_GRAPH_EDGES,
  LOGICAL_GRAPH_NODES,
  TENANT_PREFIX,
  TENANT_PREFIX_WIDE,
  TERMS,
  VRF,
  createEvpnType5State,
  evpnType5Steps,
  ipv4LayerIndex,
  leaf1FocusIndices,
  leaf3FocusIndices,
  outerIpLayerIndex,
  withEvpnMesh,
  type EvpnType5DeviceId,
  type EvpnType5State,
} from "@/lib/sim-engine/scenarios/evpnType5";
import { GraphTopologyViewer } from "@/components/network/GraphTopologyViewer";
import { GraphPacket } from "@/components/network/GraphPacket";
import { PacketInspector } from "@/components/network/PacketInspector";
import { ForwardingDecisionCard } from "@/components/protocol/ForwardingDecisionCard";
import { PacketJourneyTimeline } from "@/components/protocol/PacketJourneyTimeline";
import { PlaneSplitPanel } from "@/components/protocol/PlaneSplitPanel";
import { CLIOutputPanel } from "@/components/protocol/CLIOutputPanel";
import { EvpnRibViewer } from "@/components/protocol/EvpnRouteTable";
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
import { ObjectFocusPanel } from "@/components/network3d/ObjectFocusPanel";
import { layoutRegionsTo3D, layoutTo3D } from "@/components/network3d/layout";
import type { ActivePacket3D, CameraMode, FocusTarget3D, InspectorSurface, Link3DData, Node3DStatus } from "@/components/network3d/types";
import type { PacketVisual } from "@/lib/sim-engine/types";
import { explainNode } from "./explain";
import { buildSpineCliCommands, buildType5CliCommands, evpnRibRowsFor, interfacesFor, linkDetailFor, packetFramesFor, traceFor, vrfRoutesRowsFor } from "./deviceTrace";

const FABRIC_DEVICES: ("LEAF1" | "SPINE1" | "LEAF2" | "LEAF3")[] = ["LEAF1", "SPINE1", "LEAF2", "LEAF3"];

/** Which fabric device is the primary inspection subject of a no-packet control-plane step — mirrors the earlier EVPN lessons' PRIMARY_TRANSITION_ROUTER. */
const PRIMARY_TRANSITION_ROUTER: Record<string, "LEAF1" | "SPINE1" | "LEAF2" | "LEAF3"> = {
  "create-type5-route": "LEAF3",
  "enter-leaf1-type5-import": "LEAF1",
  "predict-rt-import": "LEAF1",
  "vrf-route-installed": "LEAF1",
  "lpm-intro": "LEAF2",
  "predict-lpm": "LEAF1",
  "fault-injected": "LEAF1",
  "repair-challenge": "LEAF1",
};

function deviceForStep(stepId: string, packet: PacketVisual | undefined): EvpnType5DeviceId | undefined {
  if (packet) return (packet.from ?? packet.to) as EvpnType5DeviceId;
  return PRIMARY_TRANSITION_ROUTER[stepId];
}

function eyeOffsetForFocusTarget(target: FocusTarget3D): [number, number, number] {
  const [sx, sy, sz] = target.size ?? [0.6, 0.3, 0.3];
  const maxDim = Math.max(sx, sy, sz);
  const dist = Math.max(0.55, maxDim * 1.8);
  return [dist * 0.55, dist * 0.5, dist * 0.75];
}

const ROUTE_TYPE_SUMMARY = [
  { type: "2", question: "Where is this MAC/IP endpoint?" },
  { type: "3", question: "Who participates in this VNI/BUM domain?" },
  { type: "5", question: "Where is this IP prefix?" },
] as const;

const REPAIR_OPTIONS = [
  { id: "readvertise-type5", label: "Re-advertise the Type 5 route" },
  { id: "change-rt", label: `Change VRF ${VRF}'s import RT` },
  { id: "restart-evpn", label: "Restart the BGP EVPN session" },
  { id: "restore-underlay", label: "Restore the underlay route to LEAF3's VTEP (10.255.0.3)" },
];
const WRONG_FEEDBACK: Record<string, string> = {
  "readvertise-type5": "The Type 5 route is already present and unchanged — re-sending it won't fix an underlay reachability problem.",
  "change-rt": "RT already matches — the route is already imported. Changing it now would only break import, not fix next-hop resolution.",
  "restart-evpn": "The BGP EVPN session is already Established and the route is already received — this isn't a session problem.",
};

export default function EvpnType5Demo() {
  const { engine, snapshot } = useScenarioEngine<EvpnType5State>(createEvpnType5State(), evpnType5Steps);
  const [autoPlay, setAutoPlay] = useState(false);
  const [speed, setSpeed] = useState<0.5 | 1 | 2>(1);
  const [viewMode, setViewMode] = useState<"physical" | "logical" | "3d">("physical");
  const [planeView, setPlaneView] = useState<"control" | "data" | "both">("both");
  const [selectedNodeId, setSelectedNodeId] = useState<EvpnType5DeviceId | undefined>(undefined);
  const [cameraMode, setCameraMode] = useState<CameraMode>("overview");
  const [enteredDeviceId, setEnteredDeviceId] = useState<EvpnType5DeviceId | undefined>(undefined);
  const [deviceXray, setDeviceXray] = useState(true);
  const [selectedInterfaceId, setSelectedInterfaceId] = useState<string | undefined>(undefined);
  const [selectedLinkId, setSelectedLinkId] = useState<string | undefined>(undefined);
  const [packetSelected, setPacketSelected] = useState(false);
  const [xrayMode, setXrayMode] = useState(true);
  const [routeTab, setRouteTab] = useState<"host" | "prefix">("prefix");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [summaryFocus, setSummaryFocus] = useState<"2" | "3" | "5" | undefined>(undefined);
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

  const focusIndicesFor = (device: EvpnType5DeviceId | undefined, packet: typeof activePacket) => {
    if (device === "SPINE1") return outerIpLayerIndex(packet);
    if (device === "LEAF1") return leaf1FocusIndices(packet);
    if (device === "LEAF3") return leaf3FocusIndices(packet);
    if (device === "BORDER-SVR") return ipv4LayerIndex(packet);
    return undefined;
  };
  const focusIndices = focusIndicesFor(state.packetAt, activePacket);
  const lastHop = state.journey[state.journey.length - 1];
  const showPlanes = index >= evpnType5Steps.findIndex((s) => s.id === "host-a-sends");
  const showTroubleshootLayers = index >= evpnType5Steps.findIndex((s) => s.id === "break-intro");
  const showLpm = index >= evpnType5Steps.findIndex((s) => s.id === "lpm-intro");
  const showRouteObject = index >= evpnType5Steps.findIndex((s) => s.id === "type5-route-object");

  const physicalAugmented = withEvpnMesh(GRAPH_NODES, GRAPH_EDGES, sessionActive);
  const nodes3DBase = layoutTo3D(physicalAugmented.nodes);
  const regions3D = layoutRegionsTo3D(GRAPH_REGIONS);
  const visitedDevices = new Set(state.journey.map((h) => h.device));
  if (state.packet) visitedDevices.add("HOST-A");
  const nodes3D = nodes3DBase.map((n) => {
    let status: Node3DStatus = "idle";
    if (n.id === selectedNodeId || n.id === enteredDeviceId) status = "selected";
    else if (summaryFocus === "5" && n.id === "LEAF3") status = "selected";
    else if (summaryFocus === "2" && n.id === "LEAF3") status = "selected";
    else if (summaryFocus === "3" && (n.id === "LEAF1" || n.id === "LEAF2" || n.id === "LEAF3")) status = "selected";
    else if (activePacket && (n.id === activePacket.from || n.id === activePacket.to)) status = "active";
    else if (visitedDevices.has(n.id as EvpnType5DeviceId)) status = "onPath";
    const badges = n.id === "LEAF1" || n.id === "LEAF2" ? ["VTEP", "ANYCAST GW 10"] : n.id === "LEAF3" ? ["VTEP", "PREFIX ORIGIN"] : n.id === "SPINE1" ? ["UNDERLAY ONLY"] : undefined;
    return { ...n, status, badges };
  });
  const links3D: Link3DData[] = physicalAugmented.edges.map((e) => ({
    ...e,
    active: activePacket ? (e.a === activePacket.from && e.b === activePacket.to) || (e.b === activePacket.from && e.a === activePacket.to) : false,
    onPath: visitedDevices.has(e.a as EvpnType5DeviceId) && visitedDevices.has(e.b as EvpnType5DeviceId),
  }));
  const activePacket3D: ActivePacket3D | undefined = activePacket && nodes3D.some((n) => n.id === activePacket.from) && nodes3D.some((n) => n.id === activePacket.to) ? { packet: activePacket, fromId: activePacket.from, toId: activePacket.to } : undefined;
  const questionActive = !isComplete && !!currentStep?.question && lastAnswer?.stepId !== currentStep.id;
  const selectedNode3D = nodes3D.find((n) => n.id === selectedNodeId);

  const isFabricDevice = (id: EvpnType5DeviceId | undefined): id is "LEAF1" | "SPINE1" | "LEAF2" | "LEAF3" => id === "LEAF1" || id === "SPINE1" || id === "LEAF2" || id === "LEAF3";
  const activeDeviceId = FABRIC_DEVICES.find((d) => traceFor(d, state, currentStep?.id ?? "").activeStageId !== undefined);
  const effectiveDeviceId = cameraMode === "device" ? enteredDeviceId : undefined;
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

  const focusPosition3D: [number, number, number] | undefined = activeFocusedObject
    ? activeFocusedObject.position
    : cameraMode === "freeOrbit"
      ? undefined
      : inDeviceMode
        ? [0, 0, deviceXray ? -0.2 : 0]
        : selectedNode3D?.position;
  const eyeOffset3D: [number, number, number] | undefined = activeFocusedObject ? eyeOffsetForFocusTarget(activeFocusedObject) : inDeviceMode ? (deviceXray ? [0.6, 2.6, 5.2] : [2.1, 1.5, 3.8]) : undefined;

  const explainTargetId = effectiveDeviceId ?? selectedNodeId;
  const nodeExplanation = explainTargetId ? explainNode(state, explainTargetId) : undefined;
  const xrayPacket = activePacket && (selectedNodeId === activePacket.from || selectedNodeId === activePacket.to) ? activePacket : undefined;

  const selectedLinkDetail = selectedLinkId ? linkDetailFor(selectedLinkId, state) : undefined;
  const devicePacketForTab = xrayPacket ?? (effectiveDeviceId && state.packetAt === effectiveDeviceId ? activePacket : undefined);

  const selectedFabricId = isFabricDevice(selectedNodeId) ? selectedNodeId : undefined;
  const effectiveFabricId = isFabricDevice(effectiveDeviceId) ? effectiveDeviceId : undefined;
  const focusInspectDeviceId = selectedFabricId ?? effectiveFabricId ?? activeDeviceId;
  const focusTrace = focusInspectDeviceId ? traceFor(focusInspectDeviceId, state, currentStep?.id ?? "") : undefined;
  const focusInterfaces = focusInspectDeviceId ? interfacesFor(focusInspectDeviceId, state, currentStep?.id ?? "") : undefined;

  const journeyStepIndices = evpnType5Steps.map((s, i) => ({ s, i })).filter(({ s, i }) => i <= index && (!!s.packet || PRIMARY_TRANSITION_ROUTER[s.id] !== undefined));
  const journeyHopEntries = journeyStepIndices.map(({ s, i }) => ({ id: s.id, label: s.label, index: i }));

  const historicalState = historicalIndex !== undefined ? engine.getStateAt(historicalIndex) : undefined;
  const historicalStep = historicalIndex !== undefined ? evpnType5Steps[historicalIndex] : undefined;
  const historicalPacket = historicalStep && historicalState ? historicalStep.packet?.(historicalState) : undefined;
  const historicalDeviceId = historicalStep && historicalState ? deviceForStep(historicalStep.id, historicalPacket) : undefined;
  const historicalTrace = historicalDeviceId && isFabricDevice(historicalDeviceId) && historicalState ? traceFor(historicalDeviceId, historicalState, historicalStep!.id) : undefined;
  const historicalInterfaces = historicalDeviceId && isFabricDevice(historicalDeviceId) && historicalState ? interfacesFor(historicalDeviceId, historicalState, historicalStep!.id) : undefined;

  const t5AtLeaf1 = state.received.LEAF1?.[0];
  const diagnosticLayers: DiagnosticLayer[] = [
    { label: "Physical", status: "healthy" },
    { label: "Underlay Adjacency", status: "healthy" },
    { label: "BGP EVPN", status: state.bgpSessionUp ? "healthy" : "unknown" },
    { label: "Type-5 Route Received", status: t5AtLeaf1 ? "healthy" : "unknown" },
    { label: "RT Import", status: t5AtLeaf1?.imported ? "healthy" : "unknown" },
    { label: "Prefix Candidate", status: t5AtLeaf1?.imported ? "healthy" : "unknown" },
    { label: "VTEP Resolution", status: state.faultActive ? "failing" : t5AtLeaf1?.vtepResolved ? "healthy" : "unknown" },
    { label: "VRF Route Usable", status: state.faultActive ? "failing" : t5AtLeaf1?.imported && t5AtLeaf1?.vtepResolved ? "healthy" : "unknown" },
    { label: "VXLAN Forwarding", status: state.faultActive ? "failing" : "healthy" },
    { label: "Destination Delivery", status: state.faultActive ? "failing" : "healthy" },
  ];

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

  useEffect(() => {
    if (isComplete) {
      completeLesson("evpn-type5-prefix", 350);
      unlockAchievement("prefix-navigator");
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
    setPacketSelected(false);
    setRouteTab("prefix");
    setShowAdvanced(false);
    setSummaryFocus(undefined);
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
    return [
      { id: "overview", label: "Overview", content: <OverviewTab explanation={nodeExplanation} /> },
      { id: "hardware", label: "Hardware", content: <p className="text-xs text-pv-text-muted">Generic stylized leaf switch chassis — {deviceInterfaces.length} physical interfaces.</p> },
      { id: "interfaces", label: "Interfaces", content: <InterfaceListTab interfaces={deviceInterfaces} selectedInterfaceId={selectedInterfaceId} onSelectInterface={setSelectedInterfaceId} /> },
      { id: "vlan-vni", label: "VLAN / VNI", content: <KeyValueTab rows={[{ label: "L3 VNI", value: String(L3_VNI) }, { label: "VRF", value: VRF }]} /> },
      { id: "evpn-routes", label: "EVPN Routes", content: <EvpnRibViewer title={device} rows={evpnRibRowsFor(state, device)} /> },
      { id: "vrf-routes", label: "VRF / Routes", content: <KeyValueTab rows={vrfRoutesRowsFor(state, device)} /> },
      { id: "prefixes", label: "Prefixes", content: <PrefixesTab state={state} device={device} /> },
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
      {
        id: "cli",
        label: "CLI",
        content: (
          <div className="space-y-3">
            <p className="rounded-lg border border-pv-border p-2.5 text-xs text-pv-text-muted">
              <span className="font-semibold text-pv-text">Concept:</span> EVPN Type 5 carries an IP prefix (not a host MAC/IP) tagged with an RD/RT, and each vendor exposes it through its own route/VRF/VTEP inspection commands below — the underlying route information is the same; the CLI/state model is not identical across vendors.
            </p>
            <CLIOutputPanel commands={buildType5CliCommands(state, device)} />
          </div>
        ),
      },
    ];
  };

  return (
    <div className="mx-auto max-w-7xl px-6 py-10">
      <div className="mb-6">
        <Badge tone="cyan" className="mb-3">EVPN Route Type 5 · IP Prefix Advertisement</Badge>
        <h1 className="text-2xl font-semibold text-pv-text sm:text-3xl">Where Is This Entire Prefix?</h1>
        <p className="mt-2 max-w-3xl text-sm text-pv-text-muted">
          Type 2 already taught you one host at a time. Now LEAF3 needs to advertise an entire external prefix,
          172.16.50.0/24, that was never individually learned as a host — watch EVPN Route Type 5 do it.
        </p>
      </div>

      <div className="mb-4 grid gap-2 sm:grid-cols-4">
        {[
          { q: "WHAT is Type 5?", a: "An EVPN route that advertises an entire IP prefix's reachability through a remote VTEP — not one host's MAC/IP." },
          { q: "WHY not just use Type 2?", a: "Type 2 has no concept of prefix length — it's scoped to individual endpoints, one MAC/IP at a time." },
          { q: "WHAT does it reuse?", a: "The exact same symmetric-IRB / L3 VNI forwarding the previous lesson built — only the control plane that populated the route is new." },
          { q: "KEY LESSON?", a: "A route can be received and RT-imported yet still be unusable if its next-hop VTEP can't be resolved." },
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
        {evpnType5Steps.map((step, i) => (
          <button key={step.id} type="button" disabled={i > index} onClick={() => i < index && engine.goTo(i)} title={step.label} className={clsx("h-1.5 flex-1 min-w-3 rounded-full transition-colors", i < index ? "bg-pv-success/70 hover:bg-pv-success cursor-pointer" : i === index ? "bg-pv-cyan" : "bg-white/10")} />
        ))}
      </div>

      <div className="mb-6 flex flex-wrap gap-3">
        <TopologyModeSwitcher options={[{ value: "physical", label: "Physical Topology" }, { value: "logical", label: "Logical (Routed) View" }, { value: "3d", label: "3D View" }]} value={viewMode} onChange={setViewMode} />
        {viewMode === "3d" && (
          <>
            <TopologyModeSwitcher
              options={[{ value: "overview", label: "Overview" }, { value: "device", label: "Device" }, { value: "freeOrbit", label: "Free Orbit" }]}
              value={cameraMode}
              onChange={handleCameraModeChange}
            />
            {inDeviceMode && <TopologyModeSwitcher options={[{ value: "off", label: "Exterior" }, { value: "on", label: "X-Ray" }]} value={deviceXray ? "on" : "off"} onChange={(v) => setDeviceXray(v === "on")} tone="violet" />}
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
                nodes={nodes3D}
                links={links3D}
                activePacket={inDeviceMode ? undefined : activePacket3D}
                regions={regions3D}
                onSelectNode={(id) => {
                  setSelectedNodeId(id as EvpnType5DeviceId);
                  setSelectedLinkId(undefined);
                  setPacketSelected(false);
                  setInspectorSurface("device");
                  setHistoricalIndex(undefined);
                }}
                onSelectLink={(id) => {
                  setSelectedLinkId(id);
                  setSelectedNodeId(undefined);
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
                        pipelineTitle: effectiveDeviceId === "LEAF1" ? (currentStep?.id === "enter-leaf1-type5-import" ? "Conceptual EVPN Type-5 Import Pipeline" : "Conceptual Symmetric IRB Forwarding Pipeline") : effectiveDeviceId === "LEAF3" ? "Conceptual Symmetric IRB Egress Pipeline" : "Conceptual Underlay Forwarding Pipeline",
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
                  currentDevice={effectiveDeviceId ?? state.packetAt ?? activePacket?.from ?? "—"}
                  direction="HOST-A → LEAF1 (Anycast GW) → SPINE1 → LEAF3 → tenant prefix"
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

              {inDeviceMode && !packetSelected && !selectedLinkDetail ? (
                <DeviceExplorerPanel explanation={nodeExplanation!} tabs={isFabricDevice(effectiveDeviceId) ? explorerTabsFor(effectiveDeviceId) : []} xrayEnabled={deviceXray} onToggleXray={() => setDeviceXray((v) => !v)} onExit={() => { setCameraMode("overview"); setEnteredDeviceId(undefined); }} />
              ) : (
                !packetSelected &&
                !selectedLinkDetail && (
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
              <ul className="space-y-1.5">
                {whatChanged.map((c) => (<li key={c} className="flex gap-2 text-xs text-pv-text-muted"><span className="text-pv-success">✓</span>{c}</li>))}
              </ul>
            </GlassPanel>
          )}

          {currentStep?.id === "type2-vs-type3-vs-type5" && (
            <GlassPanel className="p-4">
              <table className="w-full text-left text-[11px]">
                <thead><tr className="text-pv-text-faint"><th className="pb-1 font-normal">Route</th><th className="pb-1 font-normal">Primary Learning Purpose</th></tr></thead>
                <tbody className="pv-mono text-pv-text">
                  <tr className="border-t border-pv-border"><td className="py-1.5">Type 2</td><td className="py-1.5 text-pv-text-faint">MAC/IP endpoint reachability</td></tr>
                  <tr className="border-t border-pv-border"><td className="py-1.5">Type 3</td><td className="py-1.5 text-pv-text-faint">VNI/BUM participation</td></tr>
                  <tr className="border-t border-pv-border"><td className="py-1.5">Type 5</td><td className="py-1.5 text-pv-text-faint">IP prefix reachability</td></tr>
                </tbody>
              </table>
            </GlassPanel>
          )}

          {showRouteObject && state.type5Route && (
            <GlassPanel strong className="space-y-2 p-4">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-pv-success">▭ EVPN Type 5 — Prefix Route</h4>
                <button type="button" onClick={() => setShowAdvanced((v) => !v)} className="text-[10px] font-semibold uppercase text-pv-text-faint hover:text-pv-text">{showAdvanced ? "Hide Advanced" : "[ Advanced ]"}</button>
              </div>
              <div className="grid grid-cols-2 gap-2 pv-mono text-[11px]">
                <span className="text-pv-text-faint">Prefix</span><span className="text-pv-text">{state.type5Route.prefix}</span>
                <span className="text-pv-text-faint">RD</span><span className="text-pv-cyan-soft">{state.type5Route.rd}</span>
                <span className="text-pv-text-faint">RT</span><span className="text-pv-violet">{state.type5Route.rt}</span>
                <span className="text-pv-text-faint">Next Hop</span><span className="text-pv-text">{state.type5Route.nextHop}</span>
                <span className="text-pv-text-faint">L3 VNI</span><span className="text-pv-text">{state.type5Route.l3Vni}</span>
              </div>
              {showAdvanced && (
                <div className="grid grid-cols-2 gap-2 border-t border-pv-border pt-2 pv-mono text-[11px]">
                  <span className="text-pv-text-faint">ESI</span><span className="text-pv-text">{state.type5Route.esi}</span>
                  <span className="text-pv-text-faint">Ethernet Tag ID</span><span className="text-pv-text">{state.type5Route.ethernetTagId}</span>
                  <span className="text-pv-text-faint">GW IP</span><span className="text-pv-text">{state.type5Route.gatewayIp}</span>
                </div>
              )}
            </GlassPanel>
          )}

          {showLpm && state.type5RouteWide && (
            <GlassPanel className="space-y-2 p-4">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-pv-violet">Longest-Prefix Match — Ordinary Routing Behavior</h4>
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="rounded-lg border border-pv-border p-2.5 pv-mono text-[11px] text-pv-text-muted">{TENANT_PREFIX_WIDE} <span className="text-pv-text-faint">via LEAF2 — less specific</span></div>
                <div className="rounded-lg border border-pv-success/50 bg-pv-success/5 p-2.5 pv-mono text-[11px] text-pv-success">{TENANT_PREFIX} <span className="text-pv-text-faint">via LEAF3 — wins (longest match)</span></div>
              </div>
            </GlassPanel>
          )}

          {index >= evpnType5Steps.findIndex((s) => s.id === "vrf-route-installed") && !isComplete && (
            <GlassPanel className="space-y-3 p-4">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-pv-text-muted">Host Route vs. Prefix Route</h4>
              <div className="flex gap-1 rounded-full border border-pv-border p-0.5 w-fit">
                {(["host", "prefix"] as const).map((t) => (
                  <button key={t} type="button" onClick={() => setRouteTab(t)} className={clsx("rounded-full px-3 py-1 text-[11px] font-semibold uppercase transition-colors", routeTab === t ? "bg-pv-cyan/15 text-pv-cyan-soft" : "text-pv-text-faint hover:text-pv-text")}>{t === "host" ? "Host Route" : "Prefix Route"}</button>
                ))}
              </div>
              {routeTab === "host" ? (
                <p className="pv-mono text-[11px] text-pv-text-muted">{EXAMPLE_TYPE2_ROUTE.ip} — <span className="text-pv-cyan-soft">Type 2</span>: individually learned as one host&apos;s MAC/IP on LEAF3&apos;s access port. Scoped to exactly that one address.</p>
              ) : (
                <p className="pv-mono text-[11px] text-pv-text-muted">{TENANT_PREFIX} — <span className="text-pv-success">Type 5</span>: never individually learned as a host at all; it&apos;s a whole prefix already sitting in LEAF3&apos;s VRF, advertised as one route covering every address inside it.</p>
              )}
            </GlassPanel>
          )}

          {showPlanes && !isComplete && (
            <PlaneSplitPanel
              show={planeView}
              controlTitle="Control Plane — EVPN Type 5 → VRF RIB"
              controlRows={[
                { label: "BGP EVPN mesh", value: state.bgpSessionUp ? "Established" : "Not yet formed" },
                { label: `${TENANT_PREFIX} originated on`, value: "LEAF3" },
                { label: "LEAF1 installed route", value: t5AtLeaf1 ? `${t5AtLeaf1.route.prefix} via LEAF3` : "—" },
              ]}
              dataTitle="Data Plane — HOST-A → L3 VNI/VXLAN → Destination Prefix"
              dataRows={state.packet ? [{ label: "Location", value: state.packetAt ?? "—" }, { label: "Encapsulation", value: state.packet.encapsulated ? `Routed VXLAN (L3 VNI ${state.packet.l3Vni ?? L3_VNI})` : "Plain Ethernet" }, { label: "IP endpoints", value: `${state.packet.innerSrcIp} → ${state.packet.innerDstIp}` }] : [{ label: "Frame", value: "none in flight" }]}
            />
          )}

          {showTroubleshootLayers && !isComplete && <TroubleshootingLayers title="Troubleshooting Layers" layers={diagnosticLayers} />}

          {isComplete && (
            <GlassPanel strong glow="success" className="flex flex-col items-center gap-4 p-10 text-center">
              <Badge tone="success">Prefix Navigator</Badge>
              <h2 className="text-2xl font-semibold text-pv-text">An Entire Prefix, One Route</h2>
              <p className="max-w-md text-sm text-pv-text-muted">
                You watched EVPN Route Type 5 advertise an entire IP prefix, installed it into a remote VRF under the
                same RT policy every earlier route type used, then repaired a next-hop VTEP resolution failure that
                left a fully-received, fully-imported route completely unusable. +350 XP awarded.
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

          {isComplete && (
            <GlassPanel className="space-y-3 p-5">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-pv-text-muted">Type 2 / Type 3 / Type 5 — Summary</h3>
              <div className="flex flex-wrap gap-2">
                {ROUTE_TYPE_SUMMARY.map((r) => (
                  <button key={r.type} type="button" onClick={() => setSummaryFocus(summaryFocus === r.type ? undefined : r.type)} className={clsx("rounded-lg border px-3 py-2 text-left text-xs transition-colors", summaryFocus === r.type ? "border-pv-cyan/50 bg-pv-cyan/10" : "border-pv-border hover:border-pv-cyan/30")}>
                    <span className="pv-mono font-bold text-pv-text">TYPE {r.type}</span>
                    <p className="mt-0.5 text-pv-text-muted">&quot;{r.question}&quot;</p>
                  </button>
                ))}
              </div>
              {summaryFocus && <p className="text-[11px] text-pv-text-faint">Switch to 3D View — the relevant leaf(s) for Type {summaryFocus} are highlighted in the fabric.</p>}
            </GlassPanel>
          )}
        </div>

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
                options={[{ value: "overview", label: "Overview" }, { value: "device", label: "Device" }, { value: "freeOrbit", label: "Free Orbit" }]}
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
                onSelectNode={(id) => {
                  setSelectedNodeId(id as EvpnType5DeviceId);
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
                        pipelineTitle: effectiveDeviceId === "LEAF1" ? (currentStep?.id === "enter-leaf1-type5-import" ? "Conceptual EVPN Type-5 Import Pipeline" : "Conceptual Symmetric IRB Forwarding Pipeline") : effectiveDeviceId === "LEAF3" ? "Conceptual Symmetric IRB Egress Pipeline" : "Conceptual Underlay Forwarding Pipeline",
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
                    setSelectedNodeId(id as EvpnType5DeviceId);
                    setInspectorSurface("hop");
                    if (cameraMode === "device") setEnteredDeviceId(id as EvpnType5DeviceId);
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
                  const histStep = evpnType5Steps[entry.index];
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
                followPacket={false}
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
      {rows.map((r) => (<div key={r.label} className="flex justify-between gap-3"><span className="text-pv-text-faint">{r.label}</span><span className="text-pv-text">{r.value}</span></div>))}
    </div>
  );
}

function PrefixesTab({ state, device }: { state: EvpnType5State; device: "LEAF1" | "LEAF2" | "LEAF3" }) {
  if (device === "LEAF3") return <p className="text-xs text-pv-text-faint">{TENANT_PREFIX} originates here — connected/static, not imported.</p>;
  const t5 = state.received[device]?.[0];
  const wide = device === "LEAF1" ? state.type5RouteWide : undefined;
  if (!t5 && !wide) return <p className="text-xs text-pv-text-faint">No Type 5 prefixes learned yet.</p>;
  return (
    <div className="space-y-2">
      {t5 && (
        <div className="rounded-lg border border-pv-success/40 bg-pv-success/5 p-2.5 pv-mono text-[11px]">
          <p className="font-semibold text-pv-text">{t5.route.prefix}</p>
          <p className="text-pv-text-muted">via {t5.route.originLeaf} — {t5.imported ? (t5.vtepResolved ? "usable" : "installed, VTEP unresolved") : "not imported"}</p>
        </div>
      )}
      {wide && (
        <div className="rounded-lg border border-pv-border p-2.5 pv-mono text-[11px]">
          <p className="font-semibold text-pv-text">{wide.prefix}</p>
          <p className="text-pv-text-muted">via {wide.originLeaf} — less specific, not used for 172.16.50.10</p>
        </div>
      )}
    </div>
  );
}

function RepairChallenge({ options, attempt, onTry }: { options: { id: string; label: string }[]; attempt?: { choice: string; correct: boolean }; onTry: (choice: string) => void }) {
  return (
    <GlassPanel strong className="p-5">
      <p className="mb-3 text-sm font-medium text-pv-text">Restore prefix reachability — choose the correct repair:</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((opt) => {
          const isSelected = attempt?.choice === opt.id;
          const isCorrect = opt.id === "restore-underlay";
          return (
            <button key={opt.id} type="button" onClick={() => onTry(opt.id)} className={clsx("rounded-xl border px-4 py-3 text-left text-sm transition-colors cursor-pointer", isSelected && isCorrect && "border-pv-success/50 bg-pv-success/10 text-pv-success", isSelected && !isCorrect && "border-pv-danger/50 bg-pv-danger/10 text-pv-danger", !isSelected && "border-pv-border hover:border-pv-cyan/40 hover:bg-pv-cyan/5")}>
              {opt.label}
            </button>
          );
        })}
      </div>
      {attempt && (
        <div className={clsx("mt-4 rounded-xl border p-4 text-sm", attempt.correct ? "border-pv-success/50 bg-pv-success/10 text-pv-success" : "border-pv-warning/40 bg-pv-warning/5 text-pv-text-muted")}>
          {attempt.correct ? <span className="font-semibold">✓ Underlay reachability restored — the Type 5 route is usable again.</span> : (<><span className="mb-1 block font-semibold text-pv-text">That doesn&apos;t fix it.</span>{WRONG_FEEDBACK[attempt.choice] ?? "Try again."}</>)}
        </div>
      )}
    </GlassPanel>
  );
}
