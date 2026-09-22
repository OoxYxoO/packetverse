"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { clsx } from "clsx";
import { useScenarioEngine } from "@/lib/sim-engine/useScenarioEngine";
import {
  ARGUMENT_LENGTH,
  FUNCTION_LENGTH,
  LOCATOR_LENGTH,
  fmtIpv6,
  locatorTextFor,
} from "@/lib/sim-engine/scenarios/srv6Foundations";
import {
  BEHAVIOR_LABEL,
  CE_IDS,
  FUNCTION,
  GRAPH_EDGES,
  GRAPH_NODES,
  STEP_IDX,
  VRFS,
  buildEndpointCliCommands,
  buildNamedIpv6Fib,
  createSrv6EndpointState,
  srv6EndpointSteps,
  type CeId,
  type ChallengeKey,
  type EndpointLocalSidEntry,
  type JourneyHop,
  type NodeId,
  type RouterId,
  type Srv6EndpointAction,
  type Srv6EndpointState,
} from "@/lib/sim-engine/scenarios/srv6EndpointBehaviors";
import { GraphTopologyViewer, type GraphEdge } from "@/components/network/GraphTopologyViewer";
import { GraphPacket } from "@/components/network/GraphPacket";
import { PacketInspector } from "@/components/network/PacketInspector";
import { ForwardingDecisionCard } from "@/components/protocol/ForwardingDecisionCard";
import { PacketJourneyTimeline } from "@/components/protocol/PacketJourneyTimeline";
import { PlaneSplitPanel } from "@/components/protocol/PlaneSplitPanel";
import { Srv6SidStructureViewer } from "@/components/protocol/Srv6SidStructureViewer";
import { LocalSidTableViewer, type LocalSidRow } from "@/components/protocol/LocalSidTableViewer";
import { Srv6BehaviorComparisonViewer, type BehaviorComparisonRow } from "@/components/protocol/Srv6BehaviorComparisonViewer";
import { Srv6BehaviorExecutionViewer, type Srv6BehaviorExecutionData } from "@/components/protocol/Srv6BehaviorExecutionViewer";
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
import { PRIMARY_TRANSITION_ROUTER, deviceForStep, interfacesFor, linkDetailFor, packetFramesFor, traceFor } from "./deviceTrace";

const ROUTER_IDS: RouterId[] = ["R1", "R2", "R3", "R4", "R5", "R6"];
const SID_OWNER_ROUTERS: RouterId[] = ["R3", "R6"];
type TopoView = "physical" | "program" | "behavior" | "service";

const WHY_BEHAVIORS: { q: string; a: string }[] = [
  { q: "WHAT IS AN ENDPOINT BEHAVIOR?", a: "The local instruction a node binds to one of its own SIDs — what happens once the packet actually arrives." },
  { q: "WHY MANY BEHAVIORS?", a: "Reaching the node is only half the operation. Forward normally, force one adjacency, select a table, or decapsulate into a service — genuinely different actions." },
  { q: "IS END.X A STATIC ROUTE?", a: "No — it still advances the segment exactly like End. Only the forwarding TREATMENT differs (a bound adjacency, not ordinary FIB)." },
  { q: "WITHOUT MULTIPLE BEHAVIORS?", a: "SRv6 would only ever be able to say \"reach this node\" — never \"and then do this one specific thing.\"" },
];

const BEHAVIOR_COMPARISON_ROWS: BehaviorComparisonRow[] = [
  { behavior: "End", family: "TOPOLOGICAL", advancesSegment: true, decapsulates: false, payload: "—", forwardingAction: "Next SID → normal IPv6 FIB", associatedParameter: "none", mustBeFinal: false },
  { behavior: "End.X", family: "TOPOLOGICAL", advancesSegment: true, decapsulates: false, payload: "—", forwardingAction: "Next SID → bound adjacency J", associatedParameter: "adjacency J", mustBeFinal: false },
  { behavior: "End.T", family: "TOPOLOGICAL", advancesSegment: true, decapsulates: false, payload: "—", forwardingAction: "Next SID → bound IPv6 table T", associatedParameter: "IPv6 table T", mustBeFinal: false },
  { behavior: "End.DX6", family: "SERVICE", advancesSegment: false, decapsulates: true, payload: "Inner IPv6", forwardingAction: "Inner IPv6 → adjacency J", associatedParameter: "adjacency J", mustBeFinal: true },
  { behavior: "End.DX4", family: "SERVICE", advancesSegment: false, decapsulates: true, payload: "Inner IPv4", forwardingAction: "Inner IPv4 → adjacency J", associatedParameter: "adjacency J", mustBeFinal: true },
  { behavior: "End.DT6", family: "SERVICE", advancesSegment: false, decapsulates: true, payload: "Inner IPv6", forwardingAction: "Inner IPv6 → table T lookup", associatedParameter: "IPv6 table T", mustBeFinal: true },
  { behavior: "End.DT4", family: "SERVICE", advancesSegment: false, decapsulates: true, payload: "Inner IPv4", forwardingAction: "Inner IPv4 → table T lookup", associatedParameter: "IPv4 table T", mustBeFinal: true },
  { behavior: "End.DX2", family: "SERVICE", advancesSegment: false, decapsulates: true, payload: "Inner Ethernet", forwardingAction: "Ethernet frame → OIF I", associatedParameter: "outgoing interface I", mustBeFinal: true },
];

const REPAIR_OPTIONS = [
  { id: "change-igp-metric", label: "Change the IPv6 underlay metric" },
  { id: "reinstall-dx4", label: "Restart/reinstall the same End.DX4 SID" },
  { id: "add-ipv4-route-to-provider-fib", label: "Add 10.10.2.0/24 to the provider's IPv6 FIB" },
  { id: "rebind-dt4", label: "Rebind the service SID: End.DX4/CE4-A → End.DT4/VRF-CUST4" },
];
const WRONG_FEEDBACK: Record<string, string> = {
  "change-igp-metric": "The packet already reaches R6 correctly — the underlay was never broken. The problem is what R6 does with the exposed IPv4 packet once it gets there.",
  "reinstall-dx4": "The SID is already operational — decapsulation succeeds every time. Reinstalling the same End.DX4 binding doesn't change its semantics; it's still a fixed cross-connect.",
  "add-ipv4-route-to-provider-fib": "This is the SRv6 provider IPv6 core, not the customer's IPv4 routing domain. Customer IPv4 forwarding belongs inside VRF-CUST4, consulted only AFTER decapsulation.",
};

const CHALLENGE_QUESTIONS: { key: ChallengeKey; prompt: string; options: { id: string; label: string }[]; correct: string }[] = [
  {
    key: "a",
    prompt: "A. Force the next SRv6 segment through the R3→R4 adjacency.",
    correct: "END_X",
    options: [
      { id: "END", label: "End" },
      { id: "END_X", label: "End.X" },
      { id: "END_T", label: "End.T" },
      { id: "END_DT4", label: "End.DT4" },
    ],
  },
  {
    key: "b",
    prompt: "B. After decapsulation, route IPv4 customer traffic using VRF-CUST4.",
    correct: "END_DT4",
    options: [
      { id: "END_DX4", label: "End.DX4" },
      { id: "END_DT4", label: "End.DT4" },
      { id: "END_DT6", label: "End.DT6" },
      { id: "END_X", label: "End.X" },
    ],
  },
  {
    key: "c",
    prompt: "C. After decapsulation, send exposed IPv6 directly to one CE adjacency, with no tenant table lookup.",
    correct: "END_DX6",
    options: [
      { id: "END_DT6", label: "End.DT6" },
      { id: "END_DX6", label: "End.DX6" },
      { id: "END_T", label: "End.T" },
      { id: "END_DX4", label: "End.DX4" },
    ],
  },
  {
    key: "d",
    prompt: "D. After decapsulation, cross-connect an Ethernet frame to one service interface.",
    correct: "END_DX2",
    options: [
      { id: "END_DX2", label: "End.DX2" },
      { id: "END_DT4", label: "End.DT4" },
      { id: "END_X", label: "End.X" },
      { id: "END_DX6", label: "End.DX6" },
    ],
  },
];

const SRV6_ENDPOINT_XP_AWARD = 700;

export default function Srv6EndpointBehaviorsDemo() {
  const { engine, snapshot } = useScenarioEngine<Srv6EndpointState>(createSrv6EndpointState(), srv6EndpointSteps);
  const [autoPlay, setAutoPlay] = useState(false);
  const [speed, setSpeed] = useState<0.5 | 1 | 2>(1);
  const [topoView, setTopoView] = useState<TopoView>("physical");
  const [viewMode3D, setViewMode3D] = useState(false);
  const [planeView, setPlaneView] = useState<"control" | "data" | "both">("both");
  const [focusRouter, setFocusRouter] = useState<RouterId>("R1");
  const [selectedNodeId, setSelectedNodeId] = useState<NodeId | undefined>(undefined);
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
  /** Presentation cursor for HopTimeline inspection — a step INDEX, never mutates the live lesson. undefined = inspecting the current/live hop. */
  const [historicalIndex, setHistoricalIndex] = useState<number | undefined>(undefined);
  /** Explicit Hop-vs-Device intent inside Focus Mode ("Shared Focus Mode Inspector Fix") — set by the actual gesture (node click → device; timeline/next-hop/Play → hop), never inferred from whether a trace object happens to exist. */
  const [inspectorSurface, setInspectorSurface] = useState<InspectorSurface>("hop");
  const awardedRef = useRef(false);
  const completeLesson = useProgressStore((s) => s.completeLesson);
  const recordAnswer = useProgressStore((s) => s.recordAnswer);
  const unlockAchievement = useProgressStore((s) => s.unlockAchievement);

  const { state, currentStep, index, totalSteps, isComplete, lastAnswer, whatChanged, activePacket } = snapshot;
  const canAdvance = engine.canAdvance();

  const nodes = useMemo(
    () =>
      GRAPH_NODES.map((n) => ({
        ...n,
        kind: (n.id === "R1" ? "pe-router" : n.id === "R6" ? "pe-router" : ROUTER_IDS.includes(n.id as RouterId) ? "p-router" : "server") as "pe-router" | "p-router" | "server",
      })),
    [],
  );
  const journeyPath = state.journey.map((h) => h.router);
  const bestPathEdgeIds = linkIdsOnPath(journeyPath);

  const displayNodes = nodes.map((n) => {
    if (topoView === "behavior") {
      const entries = state.localSidTable[n.id as RouterId];
      if (entries?.length) return { ...n, subLabel: entries.map((e) => BEHAVIOR_LABEL[e.behavior]).join(" / ") };
      return n;
    }
    if (topoView === "service" && n.id === "R6") return { ...n, subLabel: "DX6 · DX4 · DT6 · DT4 · DX2" };
    if (topoView === "program" && state.packet) {
      if (n.id === state.packetAt) return { ...n, subLabel: `DA=${fmtIpv6(state.packet.outer.daHextets)}` };
      return n;
    }
    return n;
  });
  const edges: GraphEdge[] = GRAPH_EDGES.map((e) => ({ id: e.id, a: e.a, b: e.b, state: "full" as const }));
  const activeNodeIds = activePacket ? [activePacket.from, activePacket.to] : [];
  const packetFrom = activePacket ? nodes.find((n) => n.id === activePacket.from) : undefined;
  const packetTo = activePacket ? nodes.find((n) => n.id === activePacket.to) : undefined;

  const showTaxonomy = index >= STEP_IDX.taxonomyIntro;
  const showLocalSidTable = index >= STEP_IDX.richerLocalSidTable;
  const showEndVsEndxVisual = currentStep?.id === "signature-end-vs-endx";
  const showEndVsEndtVisual = currentStep?.id === "end-vs-endt-comparison";
  const showOuterInnerModel = currentStep?.id === "outer-inner-packet-model";
  const showBehaviorComparison = index >= STEP_IDX.behaviorComparisonIntro && index < STEP_IDX.troubleshootingIntro;
  const showTroubleshoot = index >= STEP_IDX.troubleshootingIntro;
  const showChallenge = currentStep?.id === "program-the-endpoint";

  const lastHop = state.journey[state.journey.length - 1];
  const executionData = lastHop ? executionDataFromHop(state.journey, state.journey.length - 1, state) : undefined;

  const localSidRows: LocalSidRow[] = SID_OWNER_ROUTERS.flatMap((r) =>
    (state.localSidTable[r] ?? []).map((e) => ({ sid: e.sidText, locator: e.locatorText, functionText: e.functionText, behavior: BEHAVIOR_LABEL[e.behavior], owner: e.owner, state: "ACTIVE" as const, parameters: e.parameterText })),
  );

  const cliCommands = useMemo(() => buildEndpointCliCommands(state, focusRouter), [state, focusRouter]);
  const focusFib = useMemo(() => buildNamedIpv6Fib(focusRouter, state.links, state.locators, "MAIN"), [focusRouter, state.links, state.locators]);

  const diagnosticLayers: DiagnosticLayer[] = [
    { label: "Interfaces / Underlay IGP", status: "healthy" },
    { label: "R6 Locator Reachability", status: state.troubleshooting.started ? "healthy" : "unknown" },
    { label: "R6 Local SID Match", status: state.troubleshooting.started ? "healthy" : "unknown" },
    { label: "Final-Segment Check (SL=0)", status: state.troubleshooting.started ? "healthy" : "unknown" },
    { label: "Outer Decapsulation", status: state.troubleshooting.started ? "healthy" : "unknown" },
    { label: "Expected Service Semantics: Table Lookup", status: state.fault ? "failing" : state.troubleshooting.correctVerified ? "healthy" : "unknown" },
    { label: "VRF-CUST4 Lookup Executed", status: state.fault ? "failing" : state.troubleshooting.correctVerified ? "healthy" : "unknown" },
    { label: "10.10.2.0/24 → CE4-B Selected", status: state.fault ? "failing" : state.troubleshooting.correctVerified ? "healthy" : "unknown" },
  ];

  // --- 3D derived state ---
  const nodes3DBase = useMemo(() => layoutTo3D(nodes), [nodes]);
  const visitedRouters = new Set(state.journey.map((h) => h.router));
  const nodes3D = nodes3DBase.map((n) => {
    let status: Node3DStatus = "idle";
    if (n.id === selectedNodeId || n.id === enteredDeviceId) status = "selected";
    else if (activePacket && (n.id === activePacket.from || n.id === activePacket.to)) status = "active";
    else if (visitedRouters.has(n.id as NodeId)) status = "onPath";
    const entries = state.localSidTable[n.id as RouterId];
    const badges = n.id === "R1" ? ["HEADEND"] : entries?.length ? [`${entries.length} SID${entries.length > 1 ? "S" : ""}`] : CE_IDS.includes(n.id as CeId) ? ["CE"] : undefined;
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

  const activeDeviceId = ROUTER_IDS.find((r) => traceFor(r, state)?.activeStageId !== undefined);
  const effectiveDeviceId = cameraMode === "device" ? enteredDeviceId : cameraMode === "packetFollow" && autoEnterDevices ? activeDeviceId : undefined;
  const inDeviceMode = !!effectiveDeviceId;
  const deviceTrace = effectiveDeviceId ? traceFor(effectiveDeviceId, state) : undefined;

  const followPacketIntoCurrentDevice = () => {
    if (!packetSelected || cameraMode !== "device") return;
    const snap = engine.getSnapshot();
    const nextDevice = ROUTER_IDS.find((r) => traceFor(r, snap.state)?.activeStageId !== undefined);
    if (nextDevice) setEnteredDeviceId(nextDevice);
  };

  const deviceInterfaces = effectiveDeviceId ? interfacesFor(effectiveDeviceId, state) : [];
  const devicePacketFrames: PacketStackFrame[] | undefined = effectiveDeviceId ? packetFramesFor(state) : undefined;

  // --- Generic 3D object-focus sub-state — layered ON TOP of `cameraMode`,
  // never a 5th camera mode of its own. Cleared automatically once the
  // object it names is no longer present in current data.
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
  const PACKET_FOLLOW_DEVICE_EYE_OFFSET: [number, number, number] = [1.7, 3.3, 6.6];
  const focusPosition3D: [number, number, number] | undefined = activeFocusedObject
    ? activeFocusedObject.position
    : cameraMode === "freeOrbit"
      ? undefined
      : inDeviceMode
        ? [0, 0, deviceXray ? -0.2 : 0]
        : cameraMode === "packetFollow"
          ? followNode3D?.position
          : selectedNode3D?.position;
  const eyeOffset3D: [number, number, number] | undefined = activeFocusedObject
    ? eyeOffsetForFocusTarget(activeFocusedObject)
    : inDeviceMode
      ? cameraMode === "packetFollow"
        ? PACKET_FOLLOW_DEVICE_EYE_OFFSET
        : deviceXray
          ? [0.6, 2.6, 5.2]
          : [2.1, 1.5, 3.8]
      : undefined;

  /** Detail shown in <ObjectFocusPanel> for a focused stage/packetLayer/interface — every field comes straight off data the page already computed (`deviceTrace`, `devicePacketFrames`, `deviceInterfaces`). Link focus reuses <LinkDetailPanel> instead. */
  function focusPanelFieldsFor(target: FocusTarget3D): { title: string; fields: { label: string; value: string }[] } {
    if (target.kind === "stage" && deviceTrace) {
      const stage = deviceTrace.stages.find((s) => s.id === target.id);
      const fields: { label: string; value: string }[] = [];
      if (stage?.detail) fields.push({ label: "Detail", value: stage.detail });
      if (deviceTrace.activeStageId === target.id) {
        if (deviceTrace.lookupType) fields.push({ label: "Lookup", value: deviceTrace.lookupType });
        if (deviceTrace.lookupKey) fields.push({ label: "Input", value: deviceTrace.lookupKey });
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

  const explainTargetId = (effectiveDeviceId ?? (ROUTER_IDS.includes(selectedNodeId as RouterId) ? (selectedNodeId as RouterId) : undefined) ?? (ROUTER_IDS.includes(followNode3D?.id as RouterId) ? (followNode3D?.id as RouterId) : undefined)) as RouterId | undefined;
  const nodeExplanation = explainTargetId ? explainNode(state, explainTargetId, currentStep?.id ?? "") : undefined;
  const xrayPacket = activePacket && (selectedNodeId === activePacket.from || selectedNodeId === activePacket.to) ? activePacket : undefined;
  const selectedLinkDetail = selectedLinkId ? linkDetailFor(selectedLinkId, state) : undefined;
  const packetCurrentDeviceLabel = effectiveDeviceId ?? state.packetAt ?? activePacket?.from ?? "—";
  const packetDirection = journeyPath.length ? journeyPath.join(" → ") : "—";
  const devicePacketForTab = xrayPacket ?? (effectiveDeviceId && state.packetAt === effectiveDeviceId ? activePacket : undefined);

  // --- Hop Inspector target — explicit selection wins outright: selectedNodeId (when a real router) > effectiveDeviceId > activeDeviceId.
  const focusInspectDeviceId = ((ROUTER_IDS.includes(selectedNodeId as RouterId) ? (selectedNodeId as RouterId) : undefined) ?? effectiveDeviceId ?? activeDeviceId) as RouterId | undefined;
  const focusTrace = focusInspectDeviceId ? traceFor(focusInspectDeviceId, state) : undefined;
  const focusInterfaces = focusInspectDeviceId ? interfacesFor(focusInspectDeviceId, state) : undefined;

  // --- HopTimeline data — every step that either carries a packet or is a
  // no-packet control-plane/fault step tracked in PRIMARY_TRANSITION_ROUTER.
  const journeyStepIndices = srv6EndpointSteps.map((s, i) => ({ s, i })).filter(({ s, i }) => i <= index && (!!s.packet || PRIMARY_TRANSITION_ROUTER[s.id] !== undefined));
  const journeyHopEntries = journeyStepIndices.map(({ s, i }) => ({ id: s.id, label: s.label, index: i }));

  // --- Historical inspection — reuses ScenarioEngine's OWN `stateByIndex`
  // snapshot (exposed via `getStateAt`). Presentation-only — never calls
  // `engine.goTo()`. `traceFor`/`explainNode` work unmodified against a
  // frozen historical Srv6EndpointState, since `state.journey` inside that
  // snapshot only ever contains hops that had actually happened by that index.
  const historicalState = historicalIndex !== undefined ? engine.getStateAt(historicalIndex) : undefined;
  const historicalStep = historicalIndex !== undefined ? srv6EndpointSteps[historicalIndex] : undefined;
  const historicalPacket = historicalStep && historicalState ? historicalStep.packet?.(historicalState) : undefined;
  const historicalDeviceId = historicalStep && historicalState ? deviceForStep(historicalStep.id, historicalPacket) : undefined;
  const historicalTrace = historicalDeviceId && historicalState ? traceFor(historicalDeviceId, historicalState) : undefined;
  const historicalInterfaces = historicalDeviceId && historicalState ? interfacesFor(historicalDeviceId, historicalState) : undefined;

  // --- Shared camera-mode transition — used by BOTH the normal toolbar's
  // switcher and Focus Mode's, and by "Follow Packet".
  function handleCameraModeChange(v: CameraMode) {
    setCameraMode(v);
    if (v === "device" && !enteredDeviceId) setEnteredDeviceId((ROUTER_IDS.includes(selectedNodeId as RouterId) ? (selectedNodeId as RouterId) : undefined) ?? activeDeviceId ?? "R1");
    if (v === "overview") {
      setEnteredDeviceId(undefined);
      setSelectedNodeId(undefined);
    }
    if (v === "freeOrbit") setEnteredDeviceId(undefined);
  }

  // --- Manual object-focus vs. Play Traffic — resuming playback takes
  // priority over a previously-focused object or a historical cursor.
  function handleToggleAutoPlay() {
    if (!autoPlay) {
      setFocusedObject(undefined);
      setInspectorSurface("hop");
      setHistoricalIndex(undefined);
    }
    setAutoPlay((v) => !v);
  }

  // --- In-scene "current device" callout — reuses the exact same
  // `traceFor()` data the Hop Inspector already renders.
  const calloutTrace = activeDeviceId ? traceFor(activeDeviceId, state) : undefined;
  const calloutNode3D = activeDeviceId ? nodes3D.find((n) => n.id === activeDeviceId) : undefined;
  const calloutLines = calloutTrace
    ? ([calloutTrace.lookupType, calloutTrace.lookupResult ?? calloutTrace.forwardingAction, calloutTrace.nextHopLabel ? `out → ${calloutTrace.nextHopLabel}` : undefined].filter(Boolean) as string[])
    : [];
  const sceneCallout =
    !inDeviceMode && calloutNode3D && calloutLines.length > 0
      ? { position: [calloutNode3D.position[0], calloutNode3D.position[1] + 0.95, calloutNode3D.position[2]] as [number, number, number], title: activeDeviceId as string, lines: calloutLines }
      : undefined;

  function entriesFor(router: RouterId): EndpointLocalSidEntry[] {
    return state.localSidTable[router] ?? [];
  }

  function explorerTabsFor(router: RouterId): DeviceExplorerTab[] {
    if (!nodeExplanation) return [];
    const entries = entriesFor(router);
    const overviewTab: DeviceExplorerTab = {
      id: "overview",
      label: "Overview",
      content: (
        <div className="space-y-3">
          <div className="rounded-lg border border-pv-cyan/30 bg-pv-cyan/5 p-3">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-pv-cyan-soft">Current Action</p>
            <p className="text-sm text-pv-text">{nodeExplanation.currentAction}</p>
          </div>
        </div>
      ),
    };
    const hardwareTab: DeviceExplorerTab = { id: "hardware", label: "Hardware", content: <p className="text-xs text-pv-text-muted">Generic stylized {nodeExplanation.deviceType.toLowerCase()} chassis — {deviceInterfaces.length} physical interfaces.</p> };
    const interfacesTab: DeviceExplorerTab = { id: "interfaces", label: "Interfaces", content: <InterfaceListTab interfaces={deviceInterfaces} selectedInterfaceId={selectedInterfaceId} onSelectInterface={setSelectedInterfaceId} /> };
    const routerTrace = traceFor(router, state);
    const hopInspectorTab: DeviceExplorerTab = {
      id: "hop-inspector",
      label: "Hop Inspector",
      content: routerTrace ? (
        <div className="space-y-3">
          <HopInspectorPanel trace={routerTrace} deviceName={router} interfaces={deviceInterfaces} />
          <PacketDiffViewer before={routerTrace.packetBeforeFrames} after={routerTrace.packetAfterFrames} beforeText={routerTrace.packetBefore} afterText={routerTrace.packetAfter} mutations={routerTrace.mutations} />
        </div>
      ) : (
        <p className="text-xs text-pv-text-faint">No hop recorded at this device yet.</p>
      ),
    };
    const fibTab: DeviceExplorerTab = {
      id: "ipv6-fib",
      label: "IPv6 FIB",
      content: (
        <div className="space-y-1.5 pv-mono text-[11px]">
          {buildNamedIpv6Fib(router, state.links, state.locators, "MAIN").map((r) => (
            <div key={r.locatorPrefix} className="flex justify-between gap-3">
              <span className="text-pv-text-faint">{r.locatorPrefix}</span>
              <span className="text-pv-text">next-hop {r.nextHop ?? "(local)"}</span>
            </div>
          ))}
          {router === "R3" && (
            <>
              <p className="pt-2 text-[9px] font-semibold uppercase tracking-wide text-pv-violet">CORE-B (End.T-bound table)</p>
              {buildNamedIpv6Fib(router, state.links, state.locators, "CORE-B").map((r) => (
                <div key={`coreb-${r.locatorPrefix}`} className="flex justify-between gap-3">
                  <span className="text-pv-text-faint">{r.locatorPrefix}</span>
                  <span className="text-pv-text">next-hop {r.nextHop ?? "(local)"}</span>
                </div>
              ))}
            </>
          )}
        </div>
      ),
    };
    const locatorTab: DeviceExplorerTab = {
      id: "locator",
      label: "SRv6 Locator",
      content: (
        <div className="space-y-1 pv-mono text-[11px]">
          <p className="text-pv-text-faint">Locator: <span className="text-pv-text">{locatorTextFor(router)}</span></p>
          <p className="text-pv-text-faint">Advertised: <span className="text-pv-success">YES</span></p>
          <p className="text-pv-text-faint">Local SIDs: <span className="text-pv-text">{entries.length}</span></p>
        </div>
      ),
    };
    const localSidTab: DeviceExplorerTab = {
      id: "local-sid-table",
      label: "Local SID Table",
      content: <LocalSidTableViewer title={`${router} Local SID Table`} rows={entries.map((e) => ({ sid: e.sidText, locator: e.locatorText, functionText: e.functionText, behavior: BEHAVIOR_LABEL[e.behavior], owner: e.owner, state: "ACTIVE", parameters: e.parameterText }))} />,
    };
    const behaviorTabFor = (fn: number, label: string): DeviceExplorerTab => {
      const entry = entries.find((e) => e.functionValue === fn);
      return {
        id: label.toLowerCase(),
        label,
        content: entry ? (
          <Srv6SidStructureViewer sid={entry.sidText} locatorLength={LOCATOR_LENGTH} functionLength={FUNCTION_LENGTH} argumentLength={ARGUMENT_LENGTH} locator={entry.locatorText} functionText={entry.functionText} behavior={BEHAVIOR_LABEL[entry.behavior]} owner={entry.owner} />
        ) : (
          <p className="text-xs text-pv-text-faint">Not instantiated at this router.</p>
        ),
      };
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
    const cliTab: DeviceExplorerTab = { id: "cli", label: "CLI", content: <CLIOutputPanel commands={buildEndpointCliCommands(state, router)} /> };

    if (router === "R1") return [overviewTab, hardwareTab, interfacesTab, hopInspectorTab, fibTab, locatorTab, packetTab, cliTab];
    if (router === "R3") return [overviewTab, hardwareTab, interfacesTab, hopInspectorTab, fibTab, locatorTab, localSidTab, behaviorTabFor(FUNCTION.END, "End"), behaviorTabFor(FUNCTION.END_X, "End.X"), behaviorTabFor(FUNCTION.END_T, "End.T"), packetTab, cliTab];
    if (router === "R6") {
      const serviceBehaviorsTab: DeviceExplorerTab = {
        id: "service-behaviors",
        label: "Service Behaviors",
        content: <LocalSidTableViewer title="R6 Service Behaviors" rows={entries.filter((e) => e.behavior !== "END").map((e) => ({ sid: e.sidText, locator: e.locatorText, functionText: e.functionText, behavior: BEHAVIOR_LABEL[e.behavior], owner: e.owner, state: "ACTIVE", parameters: e.parameterText }))} />,
      };
      const vrf4Tab: DeviceExplorerTab = {
        id: "vrf-cust4",
        label: "VRF-CUST4",
        content: (
          <div className="space-y-1.5 pv-mono text-[11px]">
            {VRFS["VRF-CUST4"].ipv4Routes!.map((r) => (
              <div key={r.prefix} className="flex justify-between gap-3">
                <span className="text-pv-text-faint">{r.prefix}</span>
                <span className="text-pv-text">→ {r.ceId}</span>
              </div>
            ))}
          </div>
        ),
      };
      const vrf6Tab: DeviceExplorerTab = {
        id: "vrf-cust6",
        label: "VRF-CUST6",
        content: (
          <div className="space-y-1.5 pv-mono text-[11px]">
            {VRFS["VRF-CUST6"].ipv6Routes!.map((r) => (
              <div key={r.ceId} className="flex justify-between gap-3">
                <span className="text-pv-text-faint">{fmtIpv6(r.prefixHextets)}/{r.prefixLength}</span>
                <span className="text-pv-text">→ {r.ceId}</span>
              </div>
            ))}
          </div>
        ),
      };
      const l3AdjTab: DeviceExplorerTab = {
        id: "l3-adjacencies",
        label: "L3 Adjacencies",
        content: (
          <div className="space-y-1.5 pv-mono text-[11px] text-pv-text-muted">
            <p>End.DX6 → CE6</p>
            <p>End.DX4 → CE4-A</p>
          </div>
        ),
      };
      const l2XcTab: DeviceExplorerTab = {
        id: "l2-cross-connect",
        label: "L2 Cross-Connect",
        content: <p className="pv-mono text-[11px] text-pv-text-muted">End.DX2 → OIF ge-0/0/7 (CE-L2)</p>,
      };
      return [overviewTab, hardwareTab, interfacesTab, hopInspectorTab, fibTab, locatorTab, localSidTab, serviceBehaviorsTab, vrf4Tab, vrf6Tab, l3AdjTab, l2XcTab, packetTab, cliTab];
    }
    return [overviewTab, hardwareTab, interfacesTab, hopInspectorTab, fibTab, locatorTab, packetTab, cliTab];
  }

  useEffect(() => {
    if (isComplete && !awardedRef.current) {
      awardedRef.current = true;
      completeLesson("srv6-endpoint-behaviors", SRV6_ENDPOINT_XP_AWARD);
      unlockAchievement("srv6-behavior-engineer");
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

  const nextLabel = currentStep?.question && !lastAnswer ? "Answer to continue" : currentStep?.requiresState && !canAdvance ? "Apply the correct fix to continue" : "Next Step →";

  return (
    <div className="mx-auto max-w-7xl px-6 py-10">
      <div className="mb-6">
        <Badge tone="violet" className="mb-3">
          SRv6 ENDPOINT BEHAVIORS · END · END.X · END.T · END.DX6 · END.DX4 · END.DT6 · END.DT4 · END.DX2
        </Badge>
        <h1 className="text-2xl font-semibold text-pv-text sm:text-3xl">A SID Is Not Merely An IPv6 Waypoint</h1>
        <p className="mt-2 max-w-3xl text-sm text-pv-text-muted">
          Reaching the node that owns a SID is only half the operation. The locally instantiated behavior bound to that SID determines what
          happens next — a different, real forwarding decision per behavior.
        </p>
      </div>

      <div className="mb-4 grid gap-2 sm:grid-cols-4">
        {WHY_BEHAVIORS.map((item) => (
          <GlassPanel key={item.q} className="p-3">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-pv-cyan-soft">{item.q}</p>
            <p className="text-[11px] leading-snug text-pv-text-muted">{item.a}</p>
          </GlassPanel>
        ))}
      </div>

      <div className="mb-4 flex gap-1 overflow-x-auto pb-2">
        {srv6EndpointSteps.map((step, i) => (
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
            { value: "program", label: "SRv6 Program" },
            { value: "behavior", label: "Behavior" },
            { value: "service", label: "Service" },
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
        <PlaneViewSwitcher value={planeView} onChange={setPlaneView} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_400px]">
        {/* MAIN COLUMN */}
        <div className="space-y-6">
          {viewMode3D ? (
            <>
              <TopologyFrame questionActive={questionActive} onExpand={() => setFocusMode(true)}>
                {focusMode ? (
                  <div className="h-96 w-full rounded-2xl border border-pv-border bg-pv-bg-elevated sm:h-[28rem]" />
                ) : (
                  <NetworkScene3D
                    nodes={nodes3D}
                    links={links3D}
                    activePacket={inDeviceMode ? undefined : activePacket3D}
                    onSelectNode={(id) => {
                      setSelectedNodeId(id as NodeId);
                      setPacketSelected(false);
                      setSelectedLinkId(undefined);
                      if (ROUTER_IDS.includes(id as RouterId)) {
                        setInspectorSurface("device");
                        setHistoricalIndex(undefined);
                      }
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
                    callout={sceneCallout}
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

              {selectedLinkDetail && !packetSelected && (
                <LinkDetailPanel
                  detail={selectedLinkDetail}
                  onClose={() => {
                    setSelectedLinkId(undefined);
                    setFocusedObject(undefined);
                  }}
                />
              )}

              {!packetSelected && !selectedLinkDetail && activeFocusedObject && activeFocusedObject.kind !== "link" ? (
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
              ) : inDeviceMode && !packetSelected && !selectedLinkDetail ? (
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
                    {selectedNodeId && ROUTER_IDS.includes(selectedNodeId as RouterId) && (
                      <Button
                        size="sm"
                        onClick={() => {
                          setEnteredDeviceId(selectedNodeId as RouterId);
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
              <TopologyFrame questionActive={questionActive} onExpand={() => setFocusMode(true)}>
                <GraphTopologyViewer nodes={displayNodes} edges={edges} activeNodeIds={activeNodeIds} bestPathEdgeIds={bestPathEdgeIds} onEdgeClick={(id) => setSelectedLinkId(id)}>
                  {activePacket && packetFrom && packetTo && <GraphPacket packet={activePacket} from={packetFrom} to={packetTo} />}
                </GraphTopologyViewer>
              </TopologyFrame>

              {selectedLinkId && !lastHop && linkDetailFor(selectedLinkId, state) && <LinkDetailPanel detail={linkDetailFor(selectedLinkId, state)!} onClose={() => setSelectedLinkId(undefined)} />}

              {lastHop && <ForwardingDecisionCard router={String(lastHop.router)} input={lastHop.input} lookup={lastHop.lookup} action={lastHop.action} output={lastHop.output} />}

              {executionData && <Srv6BehaviorExecutionViewer data={executionData} />}
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

          {!isComplete && showChallenge && <ProgramTheEndpointChallenge answers={state.challenge.answers} onAnswer={(key, choice) => engine.act({ key, choice })} />}

          {whatChanged.length > 0 && !currentStep?.question && currentStep?.id !== "repair-challenge" && currentStep?.id !== "program-the-endpoint" && (
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

          {showEndVsEndxVisual && (
            <GlassPanel className="p-5">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-pv-border p-3 text-xs">
                  <p className="mb-1 font-semibold uppercase tracking-wide text-pv-text-faint">End</p>
                  <p className="pv-mono text-pv-text">R3 ──────────► R6</p>
                  <p className="mt-1 text-pv-text-muted">Ordinary FIB</p>
                </div>
                <div className="rounded-lg border border-pv-cyan/40 bg-pv-cyan/5 p-3 text-xs">
                  <p className="mb-1 font-semibold uppercase tracking-wide text-pv-cyan-soft">End.X</p>
                  <p className="pv-mono text-pv-text">R3 → R4 → R5 → R6</p>
                  <p className="mt-1 text-pv-text-muted">Forced adjacency J</p>
                </div>
              </div>
              <p className="mt-3 text-center text-[11px] font-semibold uppercase tracking-wide text-pv-text-faint">Same next segment. Different forwarding instruction.</p>
            </GlassPanel>
          )}

          {showEndVsEndtVisual && (
            <GlassPanel className="p-5">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-pv-border p-3 text-xs">
                  <p className="mb-1 font-semibold uppercase tracking-wide text-pv-text-faint">End</p>
                  <p className="text-pv-text-muted">Lookup R6 in the normal/current table (MAIN) → direct R6</p>
                </div>
                <div className="rounded-lg border border-pv-violet/40 bg-pv-violet/5 p-3 text-xs">
                  <p className="mb-1 font-semibold uppercase tracking-wide text-pv-violet">End.T</p>
                  <p className="text-pv-text-muted">Associate with CORE-B → lookup R6 → R4</p>
                </div>
              </div>
            </GlassPanel>
          )}

          {showOuterInnerModel && (
            <GlassPanel className="p-5">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-pv-cyan/40 bg-pv-cyan/5 p-3 text-xs">
                  <p className="mb-1 font-semibold uppercase tracking-wide text-pv-cyan-soft">OUTER</p>
                  <p className="text-pv-text-muted">IPv6, DA = active service SID (+ SRH only when genuinely needed)</p>
                </div>
                <div className="rounded-lg border border-pv-border p-3 text-xs">
                  <p className="mb-1 font-semibold uppercase tracking-wide text-pv-text-faint">INNER</p>
                  <p className="text-pv-text-muted">IPv6 packet, IPv4 packet, or Ethernet frame</p>
                </div>
              </div>
            </GlassPanel>
          )}

          {currentStep?.id === "dx-vs-dt-visual" && (
            <GlassPanel className="p-5">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-pv-border p-3 text-xs">
                  <p className="mb-1 font-semibold uppercase tracking-wide text-pv-text-faint">DX (cross-connect)</p>
                  <p className="text-pv-text-muted">decapsulate → fixed L3 adjacency J → CE</p>
                </div>
                <div className="rounded-lg border border-pv-cyan/40 bg-pv-cyan/5 p-3 text-xs">
                  <p className="mb-1 font-semibold uppercase tracking-wide text-pv-cyan-soft">DT (table lookup)</p>
                  <p className="text-pv-text-muted">decapsulate → select table T → destination lookup → CE / next hop</p>
                </div>
              </div>
            </GlassPanel>
          )}

          {showTaxonomy && !isComplete && currentStep?.id === "taxonomy-intro" && (
            <GlassPanel className="p-5">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-pv-cyan/40 bg-pv-cyan/5 p-3 text-xs">
                  <p className="mb-1 font-semibold uppercase tracking-wide text-pv-cyan-soft">Topological / Transit-Endpoint</p>
                  <p className="text-pv-text-muted">End · End.X · End.T — manipulate/forward the SRv6 packet itself</p>
                </div>
                <div className="rounded-lg border border-pv-violet/40 bg-pv-violet/5 p-3 text-xs">
                  <p className="mb-1 font-semibold uppercase tracking-wide text-pv-violet">Decapsulation / Service-Endpoint</p>
                  <p className="text-pv-text-muted">End.DX6 · End.DX4 · End.DT6 · End.DT4 · End.DX2 — expose an inner payload</p>
                </div>
              </div>
            </GlassPanel>
          )}

          {showLocalSidTable && !isComplete && <LocalSidTableViewer title="Local SID Tables — R3 and R6" rows={localSidRows} />}

          {showBehaviorComparison && <Srv6BehaviorComparisonViewer rows={BEHAVIOR_COMPARISON_ROWS} />}

          {showTroubleshoot && !isComplete && <TroubleshootingLayers title="Diagnostic Ladder" layers={diagnosticLayers} />}

          {!isComplete && (
            <PlaneSplitPanel
              show={planeView}
              controlTitle="Control Plane — Local SID Tables + Behavior Bindings"
              controlRows={[
                { label: "Local SIDs at R3", value: String((state.localSidTable.R3 ?? []).length) },
                { label: "Local SIDs at R6", value: String((state.localSidTable.R6 ?? []).length) },
                { label: "VRFs at R6", value: Object.keys(state.vrfs).join(", ") },
              ]}
              dataTitle="Data Plane — Current Packet"
              dataRows={
                state.packet
                  ? [
                      { label: "Location", value: String(state.packetAt ?? "—") },
                      { label: "Outer DA (active segment)", value: fmtIpv6(state.packet.outer.daHextets) },
                      { label: "Segments Left", value: state.packet.outer.srh ? String(state.packet.outer.srh.segmentsLeft) : "(no SRH)" },
                      { label: "Inner payload", value: state.packet.inner ? state.packet.inner.kind : "(none yet)" },
                    ]
                  : [{ label: "Packet", value: "none in flight" }]
              }
            />
          )}

          {isComplete && (
            <GlassPanel strong glow="success" className="flex flex-col items-center gap-4 p-10 text-center">
              <Badge tone="success">SRv6 Behavior Engineer</Badge>
              <h2 className="text-2xl font-semibold text-pv-text">The SID Gets You There. The Behavior Decides What Happens Next.</h2>
              <p className="max-w-md text-sm text-pv-text-muted">
                You built a richer Local SID Table, traced End, End.X, and End.T against the identical next segment, walked the full
                decapsulation family with real payload/final-segment validation, and diagnosed and repaired a DX-vs-DT service binding fault.
                +{SRV6_ENDPOINT_XP_AWARD} XP awarded.
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
            {ROUTER_IDS.map((r) => (
              <button key={r} type="button" onClick={() => setFocusRouter(r)} className={clsx("rounded-full px-3 py-1 text-[11px] font-semibold pv-mono transition-colors", focusRouter === r ? "bg-pv-cyan/15 text-pv-cyan-soft" : "text-pv-text-faint hover:text-pv-text")}>
                {r}
              </button>
            ))}
          </div>

          {showLocalSidTable && (
            <GlassPanel className="p-3">
              <h4 className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-pv-text-faint">{focusRouter}&apos;s IPv6 FIB (MAIN)</h4>
              <div className="space-y-1 pv-mono text-[10px]">
                {focusFib.map((r) => (
                  <div key={r.locatorPrefix} className="flex justify-between gap-2">
                    <span className="text-pv-text-faint">{r.locatorPrefix}</span>
                    <span className="text-pv-text">→ {r.nextHop ?? "local"}</span>
                  </div>
                ))}
              </div>
            </GlassPanel>
          )}

          <PacketJourneyTimeline hops={state.journey.map((h) => ({ ...h, router: String(h.router) }))} />
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
              <TopologyModeSwitcher options={[{ value: "off", label: "Normal View" }, { value: "on", label: "X-Ray Packet View" }]} value={xrayMode ? "on" : "off"} onChange={(v) => setXrayMode(v === "on")} tone="violet" />
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
                  Engineer challenge pending — repair the service binding in the panel to continue
                </span>
              ) : currentStep?.id === "program-the-endpoint" ? (
                <span className="shrink-0 rounded-full border border-pv-warning/40 bg-pv-warning/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-pv-warning">
                  Engineer challenge pending — answer all four in the panel to continue
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
              {viewMode3D ? (
                <NetworkScene3D
                  nodes={nodes3D}
                  links={links3D}
                  activePacket={inDeviceMode ? undefined : activePacket3D}
                  onSelectNode={(id) => {
                    setSelectedNodeId(id as NodeId);
                    setPacketSelected(false);
                    setSelectedLinkId(undefined);
                    if (ROUTER_IDS.includes(id as RouterId)) {
                      setInspectorSurface("device");
                      setHistoricalIndex(undefined);
                    }
                  }}
                  onSelectLink={(id) => setSelectedLinkId(id)}
                  selectedLinkId={selectedLinkId}
                  onFocusLink={setFocusedObject}
                  onSelectPacket={() => setPacketSelected(true)}
                  packetSelected={packetSelected}
                  focusPosition={focusPosition3D}
                  eyeOffset={eyeOffset3D}
                  mode={inDeviceMode ? "device" : "overview"}
                  callout={sceneCallout}
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
              ) : (
                <GraphTopologyViewer nodes={displayNodes} edges={edges} activeNodeIds={activeNodeIds} bestPathEdgeIds={bestPathEdgeIds} onNodeClick={(id) => setSelectedNodeId(id as NodeId)} onEdgeClick={(id) => setSelectedLinkId(id)}>
                  {activePacket && packetFrom && packetTo && <GraphPacket packet={activePacket} from={packetFrom} to={packetTo} />}
                </GraphTopologyViewer>
              )}
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
                <RepairChallenge options={REPAIR_OPTIONS} attempt={state.troubleshooting.repairAttempt} onTry={(choice) => engine.act({ choice })} />
              </>
            ) : currentStep?.id === "program-the-endpoint" ? (
              <>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-pv-cyan-soft">Engineer Challenge</p>
                <ProgramTheEndpointChallenge answers={state.challenge.answers} onAnswer={(key, choice) => engine.act({ key, choice })} />
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
                <NodeInspectorPanel explanation={nodeExplanation} packet={xrayPacket} xrayEnabled={xrayMode} />
              ) : (
                <GlassPanel className="p-4">
                  <p className="text-xs text-pv-text-faint">Select a device, or advance the lesson, to inspect a hop.</p>
                </GlassPanel>
              )
            ) : historicalIndex !== undefined && historicalTrace ? (
              // Level 3 historical (timeline) inspection — a frozen snapshot
              // from ScenarioEngine's own `stateByIndex` (via `getStateAt`),
              // never the live `focusTrace`/`state` below. Device Explorer
              // is live-only in this lesson, so the Hop/Device switch is
              // shown disabled rather than letting historical SRH/behavior
              // state combine with a live later Local SID Table as though
              // they were the same moment.
              <div className="space-y-3">
                {inDeviceMode && <TopologyModeSwitcher options={[{ value: "hop", label: "Hop" }, { value: "device", label: "Device" }]} value={inspectorSurface} onChange={setInspectorSurface} tone="violet" disabledValues={["device"]} />}
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
                    setSelectedNodeId(id as NodeId);
                    setInspectorSurface("hop");
                    setHistoricalIndex(undefined);
                    if (cameraMode === "device" && ROUTER_IDS.includes(id as RouterId)) setEnteredDeviceId(id as RouterId);
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
                  const histStep = srv6EndpointSteps[entry.index];
                  const histPacket = histStep && histState ? histStep.packet?.(histState) : undefined;
                  const router = histState ? deviceForStep(entry.id, histPacket) : undefined;
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

/**
 * Derives a close-but-non-clipping camera eye offset from a focused
 * object's world-space bounding size, rather than a hardcoded per-kind
 * distance.
 */
function eyeOffsetForFocusTarget(target: FocusTarget3D): [number, number, number] {
  const [sx, sy, sz] = target.size ?? [0.6, 0.3, 0.3];
  const maxDim = Math.max(sx, sy, sz);
  const dist = Math.max(0.55, maxDim * 1.8);
  return [dist * 0.55, dist * 0.5, dist * 0.75];
}

const EXECUTION_ACTIONS = new Set<Srv6EndpointAction>(["LOCAL_SID_MATCH", "ADJACENCY_CROSS_CONNECT", "TABLE_LOOKUP", "DECAP_IPV6", "DECAP_IPV4", "DECAP_ETHERNET", "L2_CROSS_CONNECT", "INVALID_FINAL_SEGMENT", "PAYLOAD_TYPE_MISMATCH"]);

function executionDataFromHop(journey: JourneyHop[], idx: number, state: Srv6EndpointState): Srv6BehaviorExecutionData | undefined {
  const hop = journey[idx];
  if (!hop || !EXECUTION_ACTIONS.has(hop.action)) return undefined;
  const allEntries = Object.values(state.localSidTable).flat().filter((e): e is EndpointLocalSidEntry => !!e);
  const activeDaText = state.packet ? fmtIpv6(state.packet.outer.daHextets) : undefined;
  let matched = allEntries.find((e) => hop.input.includes(e.sidText)) ?? (activeDaText ? allEntries.find((e) => e.sidText === activeDaText) : undefined);
  for (let i = idx - 1; !matched && i >= 0 && journey[i].router === hop.router; i--) {
    matched = allEntries.find((e) => journey[i].input.includes(e.sidText));
  }
  const dropped = hop.action === "INVALID_FINAL_SEGMENT" || hop.action === "PAYLOAD_TYPE_MISMATCH";
  return {
    activeSid: matched?.sidText ?? activeDaText ?? hop.input,
    matchedLocalSid: matched ? `${matched.sidText} (${BEHAVIOR_LABEL[matched.behavior]})` : "—",
    behavior: matched ? BEHAVIOR_LABEL[matched.behavior] : hop.action,
    input: hop.input,
    validation: dropped ? "FAILED" : "Passed",
    transformation: hop.lookup,
    egressDecision: hop.action,
    resultingPacket: hop.output,
    dropped,
  };
}

function linkIdsOnPath(path: NodeId[]): string[] {
  const ids: string[] = [];
  for (let i = 0; i < path.length - 1; i++) {
    const e = GRAPH_EDGES.find((x) => (x.a === path[i] && x.b === path[i + 1]) || (x.b === path[i] && x.a === path[i + 1]));
    if (e) ids.push(e.id);
  }
  return ids;
}

function RepairChallenge({ options, attempt, onTry }: { options: { id: string; label: string }[]; attempt?: { choice: string; correct: boolean }; onTry: (choice: string) => void }) {
  return (
    <GlassPanel strong className="p-5">
      <p className="mb-3 text-sm font-medium text-pv-text">Choose the correct repair to restore VRF-CUST4 delivery to CE4-B:</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((opt) => {
          const isSelected = attempt?.choice === opt.id;
          const isCorrect = opt.id === "rebind-dt4";
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
            <span className="font-semibold">✓ Service SID rebound: End.DX4/CE4-A → End.DT4/VRF-CUST4.</span>
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

function ProgramTheEndpointChallenge({ answers, onAnswer }: { answers: Partial<Record<ChallengeKey, { choice: string; correct: boolean }>>; onAnswer: (key: ChallengeKey, choice: string) => void }) {
  return (
    <GlassPanel strong className="space-y-5 p-5">
      <p className="text-sm font-medium text-pv-text">Program the endpoint — pick the correct behavior for each requirement:</p>
      {CHALLENGE_QUESTIONS.map((q) => {
        const attempt = answers[q.key];
        return (
          <div key={q.key} className="space-y-2">
            <p className="text-xs text-pv-text-muted">{q.prompt}</p>
            <div className="grid gap-2 sm:grid-cols-4">
              {q.options.map((opt) => {
                const isSelected = attempt?.choice === opt.id;
                const isCorrect = opt.id === q.correct;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => onAnswer(q.key, opt.id)}
                    className={clsx(
                      "rounded-lg border px-3 py-2 text-center text-xs font-semibold transition-colors cursor-pointer",
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
          </div>
        );
      })}
    </GlassPanel>
  );
}
