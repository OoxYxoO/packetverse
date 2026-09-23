"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { clsx } from "clsx";
import { useScenarioEngine } from "@/lib/sim-engine/useScenarioEngine";
import {
  GRAPH_NODES,
  GRAPH_EDGES,
  PROTECTED_LINK,
  PLR,
  CUST_A_EXPORT_RT,
  CUST_A_RD,
  CE1_IPV4_PREFIX,
  CE2_IPV4_PREFIX,
  INFRA_ADDRESS,
  createCapstoneState,
  capstoneSteps,
  compareArchitectures,
  compareProtectionEncoding,
  comparisonPhaseForIndex,
  comparisonRevealIndex,
  comparisonRevealed,
  type ComparisonPhase,
  buildRequirementMatrix,
  buildMplsSidDatabase,
  buildSrv6SidDatabase,
  buildMplsRepairList,
  buildSegmentEncodingComparison,
  buildCapstoneCliCommands,
  localSidEntries,
  nodeSidLabel,
  adjSidLabel,
  archLabel,
  stepArchitecture,
  type Architecture,
  type CapstoneState,
  type HopPacket,
  type RouterId,
  type StepArchitecture,
  type TransportComparisonRow,
  type ViewMode,
} from "@/lib/sim-engine/scenarios/srMplsVsSrv6";
import { fmtIpv6 } from "@/lib/sim-engine/scenarios/srv6Foundations";
import { GraphTopologyViewer } from "@/components/network/GraphTopologyViewer";
import { GraphPacket } from "@/components/network/GraphPacket";
import { PacketInspector } from "@/components/network/PacketInspector";
import { SidTableViewer, type SidTableRow } from "@/components/protocol/SidTableViewer";
import { SegmentListViewer, type SegmentListRow } from "@/components/protocol/SegmentListViewer";
import { SegmentRoutingHeaderViewer } from "@/components/protocol/SegmentRoutingHeaderViewer";
import { RepairListViewer } from "@/components/protocol/RepairListViewer";
import { Srv6RepairListViewer, type Srv6RepairSidRow } from "@/components/protocol/Srv6RepairListViewer";
import { Srv6VpnRouteViewer, type Srv6VpnRouteRow } from "@/components/protocol/Srv6VpnRouteViewer";
import { SegmentEncodingComparisonViewer } from "@/components/protocol/SegmentEncodingComparisonViewer";
import { TroubleshootingLayers, type DiagnosticLayer } from "@/components/protocol/TroubleshootingLayers";
import { PredictionQuestion } from "@/components/quiz/PredictionQuestion";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { useProgressStore } from "@/lib/state/useProgressStore";
import { NetworkScene3D } from "@/components/network3d/NetworkScene3D";
import { NodeInspectorPanel } from "@/components/network3d/NodeInspectorPanel";
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
import { DEVICE_ROUTERS, PRIMARY_TRANSITION_ROUTER, deviceForStep, framesForHopPacket, interfacesFor, linkDetailFor, packetFramesFor, traceFor } from "./deviceTrace";

const RR1_NODE = { id: "RR1", label: "RR1", x: 49, y: 6, subLabel: "Route Reflector (control-plane only)" };
const RR1_EDGES = [
  { id: "RR1-PE1", a: "RR1", b: "PE1", label: "MP-BGP" },
  { id: "RR1-PE2", a: "RR1", b: "PE2", label: "MP-BGP" },
];

const VIEW_MODES: { value: ViewMode; label: string }[] = [
  { value: "REQUIREMENT", label: "Requirement" },
  { value: "SR_MPLS", label: "SR-MPLS" },
  { value: "SRV6", label: "SRv6" },
  { value: "SIDE_BY_SIDE", label: "Side-by-Side" },
  { value: "PACKET", label: "Packet" },
  { value: "FAILURE", label: "Failure" },
];
const TECH_OPTIONS: { value: Architecture; label: string }[] = [
  { value: "SR_MPLS", label: "SR-MPLS" },
  { value: "SRV6", label: "SRv6" },
];
const CAMERA_OPTIONS: { value: CameraMode; label: string }[] = [
  { value: "overview", label: "Overview" },
  { value: "device", label: "Device" },
  { value: "packetFollow", label: "Packet Follow" },
  { value: "freeOrbit", label: "Free Orbit" },
];

const WHY_CAPSTONE: { q: string; a: string }[] = [
  { q: "Same architecture?", a: "SR-MPLS and SRv6 are ONE Segment Routing architecture (RFC 8402) with two different data-plane encodings — never framed as old/bad vs. new/better." },
  { q: "What actually changes?", a: "The forwarding-plane encoding (MPLS label vs. IPv6 address+SRH) and the capabilities that encoding exposes — not the underlying segment-list model." },
  { q: "What stays identical?", a: "Topology, IGP, VRF/RD/RT, MP-BGP VPN routes, the TI-LFA repair-topology computation, and the customer service — every difference you'll see is attributable to encoding, not to a different example." },
  { q: "Is there a winner?", a: "No. This is an engineering trade-off lesson — three Decision Labs each pick a DIFFERENT correct architecture for a different requirement." },
];

const DECISION_LAB_STEP_IDS = new Set(["decision-lab-a", "decision-lab-b", "decision-lab-c"]);
const PHASE_TITLE: Record<ComparisonPhase, string> = { transport: "Transport Encoding", te: "Explicit TE Encoding", vpn: "L3VPN Service Plane", protection: "Protection (TI-LFA) Encoding", header: "Header Efficiency", other: "Requirement Matrix" };

/** Physical cable between two routers, or undefined — the ONLY test used before drawing a packet between two nodes. */
function physicalEdge(a: string | undefined, b: string | undefined) {
  if (!a || !b) return undefined;
  return GRAPH_EDGES.find((e) => (e.a === a && e.b === b) || (e.a === b && e.b === a));
}

function stepArchTag(a: StepArchitecture): string {
  return a === "SR_MPLS" ? "SR-MPLS" : a === "SRV6" ? "SRv6" : a === "BOTH" ? "Both (parallel)" : "Shared";
}

/** Derives a close-but-non-clipping camera eye offset from a focused object's world-space bounding size (see sr-mpls-foundations for the same helper). */
function eyeOffsetForFocusTarget(target: FocusTarget3D): [number, number, number] {
  const [sx, sy, sz] = target.size ?? [0.6, 0.3, 0.3];
  const maxDim = Math.max(sx, sy, sz);
  const dist = Math.max(0.55, maxDim * 1.8);
  return [dist * 0.55, dist * 0.5, dist * 0.75];
}

/** Which headend-built packet each phase compares — two PARALLEL executions of the same intent, never one packet's before/after. */
function parallelPackets(phase: ComparisonPhase, state: CapstoneState): { mpls?: HopPacket; srv6?: HopPacket } {
  if (phase === "transport") return { mpls: state.mplsTransportPacket && { kind: "MPLS", packet: state.mplsTransportPacket }, srv6: state.srv6TransportPacket && { kind: "SRV6", packet: state.srv6TransportPacket } };
  if (phase === "te") return { mpls: state.mplsTePacket && { kind: "MPLS", packet: state.mplsTePacket }, srv6: state.srv6TePacket && { kind: "SRV6", packet: state.srv6TePacket } };
  if (phase === "vpn") return { mpls: state.mplsVpnPacket && { kind: "MPLS", packet: state.mplsVpnPacket }, srv6: state.srv6VpnPacket && { kind: "SRV6_L3VPN", packet: state.srv6VpnPacket } };
  if (phase === "protection") return { mpls: state.mplsRepairPacket && { kind: "MPLS", packet: state.mplsRepairPacket }, srv6: state.srv6RepairPacket && { kind: "SRV6_TILFA", packet: state.srv6RepairPacket } };
  return {};
}

export default function SrMplsVsSrv6Capstone() {
  const { engine, snapshot } = useScenarioEngine<CapstoneState>(createCapstoneState(), capstoneSteps);
  const [viewMode, setViewMode] = useState<ViewMode>("SIDE_BY_SIDE");
  const [is3D, setIs3D] = useState(false);
  /** Learner's technology choice — only consulted on SHARED/BOTH steps; a single-architecture step always locks the technology to its own data plane. */
  const [techChoice, setTechChoice] = useState<Architecture>("SR_MPLS");
  const [selectedNodeId, setSelectedNodeId] = useState<RouterId | "RR1" | undefined>(undefined);
  const [cameraMode, setCameraMode] = useState<CameraMode>("overview");
  const [enteredDeviceId, setEnteredDeviceId] = useState<RouterId | undefined>(undefined);
  const [deviceXray, setDeviceXray] = useState(true);
  const [autoEnterDevices, setAutoEnterDevices] = useState(true);
  const [selectedInterfaceId, setSelectedInterfaceId] = useState<string | undefined>(undefined);
  const [selectedLinkId, setSelectedLinkId] = useState<string | undefined>(undefined);
  const [packetSelected, setPacketSelected] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  /** A focused stage/layer/interface is only meaningful inside the technology it was clicked in — stage/frame ids differ per data plane. */
  const [focused, setFocused] = useState<{ target: FocusTarget3D; tech: Architecture } | undefined>(undefined);
  /** Presentation cursor for HopTimeline inspection (ARCHITECTURE.md §18) — a step INDEX, never passed to engine.goTo(). */
  const [historicalIndex, setHistoricalIndex] = useState<number | undefined>(undefined);
  const [inspectorSurface, setInspectorSurface] = useState<InspectorSurface>("hop");
  const [autoPlay, setAutoPlay] = useState(false);
  const [speed, setSpeed] = useState<PlaySpeed>(1);
  const completeLesson = useProgressStore((s) => s.completeLesson);
  const recordAnswer = useProgressStore((s) => s.recordAnswer);
  const unlockAchievement = useProgressStore((s) => s.unlockAchievement);
  const awardedRef = useRef(false);

  const { state, currentStep, index, totalSteps, isComplete, lastAnswer, whatChanged, activePacket } = snapshot;
  const canAdvance = engine.canAdvance();
  const stepId = currentStep?.id ?? "";
  const questionActive = !isComplete && !!currentStep?.question && lastAnswer?.stepId !== currentStep.id;

  // --- Historical cursor (read-only engine snapshot, never goTo) ---
  // Invariant (ARCHITECTURE.md §18) — inspection is only
  // meaningful for a step strictly EARLIER than the live one. Once any live
  // navigation (Previous, progress bar, Step Back, …) reaches or passes the
  // selected step, historical mode ends. The stored cursor is cleared during
  // render (React's "adjust state on prop change" pattern) so it can't
  // resurrect when the lesson later moves forward again; `historicalCursor`
  // is the only value the rest of the page reads — including the inspected
  // step/state/architecture and `tech` below, so a stale future step can
  // never lock the technology context.
  if (historicalIndex !== undefined && historicalIndex >= index) setHistoricalIndex(undefined);
  const historicalCursor = historicalIndex !== undefined && historicalIndex < index ? historicalIndex : undefined;
  const historicalState = historicalCursor !== undefined ? engine.getStateAt(historicalCursor) : undefined;
  const historicalStep = historicalCursor !== undefined ? capstoneSteps[historicalCursor] : undefined;
  const historicalPacket = historicalStep && historicalState ? historicalStep.packet?.(historicalState) : undefined;
  const historical = historicalCursor !== undefined && !!historicalState && !!historicalStep;

  // --- ONE technology context for everything inspected: the inspected step's own data plane when it has one, otherwise the learner's choice. Packet frames, hop trace, pipeline and Device Explorer all read this same value, so they can never mix SR-MPLS and SRv6 state.
  const inspectStepId = historical ? historicalStep!.id : stepId;
  const inspectState = historical ? historicalState! : state;
  const inspectStepArch = stepArchitecture(inspectStepId);
  const techLocked = inspectStepArch === "SR_MPLS" || inspectStepArch === "SRV6";
  const tech: Architecture = techLocked ? (inspectStepArch as Architecture) : techChoice;
  const techName = archLabel(tech);

  const nodes = useMemo(() => [...GRAPH_NODES, RR1_NODE], []);
  const edges = useMemo(() => [...GRAPH_EDGES.map((e) => ({ ...e, state: state.linkFailed && e.id === PROTECTED_LINK ? ("down" as const) : ("full" as const) })), ...RR1_EDGES], [state.linkFailed]);
  // A packet is only ever drawn across a real cable.
  const drawablePacket = activePacket && physicalEdge(activePacket.from, activePacket.to) ? activePacket : undefined;
  const activeNodeIds = drawablePacket ? [drawablePacket.from, drawablePacket.to] : [];
  const packetFrom = nodes.find((n) => n.id === drawablePacket?.from);
  const packetTo = nodes.find((n) => n.id === drawablePacket?.to);

  // --- Physical links this step's (inspected) hops actually crossed, from each hop's recorded ingress/egress peers — never from logical segment order.
  const stepLinkIds = new Set<string>();
  for (const h of inspectState.journey) {
    if (h.stepId !== inspectStepId || h.architecture !== tech) continue;
    const inEdge = physicalEdge(h.ingressPeer, h.router);
    const outEdge = physicalEdge(h.router, h.egressPeer);
    if (inEdge) stepLinkIds.add(inEdge.id);
    if (outEdge) stepLinkIds.add(outEdge.id);
  }

  // --- 3D ---
  const nodes3DBase = useMemo(() => layoutTo3D(GRAPH_NODES), []);
  const nodes3D = nodes3DBase.map((n) => {
    let status: Node3DStatus = "idle";
    if (n.id === selectedNodeId || n.id === enteredDeviceId) status = "selected";
    else if (drawablePacket && (n.id === drawablePacket.from || n.id === drawablePacket.to)) status = "active";
    const badges = n.id === PLR ? ["PLR"] : n.id === "P4" && state.sharedRepair ? ["REPAIR NODE"] : undefined;
    return { ...n, status, badges };
  });
  const links3D: Link3DData[] = GRAPH_EDGES.map((e) => ({
    ...e,
    active: drawablePacket ? (e.a === drawablePacket.from && e.b === drawablePacket.to) || (e.b === drawablePacket.from && e.a === drawablePacket.to) : false,
    onPath: stepLinkIds.has(e.id),
    visualState: state.linkFailed && e.id === PROTECTED_LINK ? "failed" : undefined,
  }));
  const activePacket3D: ActivePacket3D | undefined = drawablePacket ? { packet: drawablePacket, fromId: drawablePacket.from, toId: drawablePacket.to } : undefined;
  const selectedNode3D = nodes3D.find((n) => n.id === selectedNodeId);

  const deviceWithEvent = (router: RouterId | undefined, s: CapstoneState, sid: string, t: Architecture) => (router && traceFor(router, s, t, sid)?.activeStageId !== undefined ? router : undefined);
  const activeDeviceId = deviceWithEvent(deviceForStep(stepId, activePacket), state, stepId, tech);
  const effectiveDeviceId = cameraMode === "device" ? enteredDeviceId : cameraMode === "packetFollow" && autoEnterDevices ? activeDeviceId : undefined;
  const inDeviceMode = !!effectiveDeviceId;
  // Device interior follows the inspected (live or historical) state, so the pipeline/packet stack never shows live state beside a historical inspector.
  const deviceTrace = effectiveDeviceId ? traceFor(effectiveDeviceId, inspectState, tech, inspectStepId) : undefined;
  const deviceInterfaces = effectiveDeviceId ? interfacesFor(effectiveDeviceId, inspectState, tech, inspectStepId) : [];
  const devicePacketFrames: PacketStackFrame[] | undefined = packetFramesFor(deviceTrace);

  const focusedObject = focused && focused.tech === tech ? focused.target : undefined;
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
  const setFocusedObject = (t: FocusTarget3D | undefined) => setFocused(t ? { target: t, tech } : undefined);

  const followNode3D = cameraMode === "packetFollow" && drawablePacket ? nodes3D.find((n) => n.id === drawablePacket.to) : selectedNode3D;
  const focusPosition3D: [number, number, number] | undefined = activeFocusedObject ? activeFocusedObject.position : cameraMode === "freeOrbit" ? undefined : inDeviceMode ? [0, 0, deviceXray ? -0.2 : 0] : cameraMode === "packetFollow" ? followNode3D?.position : selectedNode3D?.position;
  const eyeOffset3D: [number, number, number] | undefined = activeFocusedObject ? eyeOffsetForFocusTarget(activeFocusedObject) : inDeviceMode ? (deviceXray ? [0.6, 2.6, 5.2] : [2.1, 1.5, 3.8]) : undefined;

  const explainTargetId = (effectiveDeviceId ?? (selectedNodeId !== "RR1" ? selectedNodeId : undefined) ?? followNode3D?.id) as RouterId | undefined;
  const nodeExplanation = explainTargetId ? explainNode(state, tech, explainTargetId) : undefined;
  const selectedLinkDetail = selectedLinkId ? linkDetailFor(selectedLinkId, inspectState, tech, historical ? historicalPacket : activePacket) : undefined;

  // --- Hop Inspector target: explicit selection > entered device > the step's own active device.
  const focusInspectDeviceId = ((selectedNodeId !== "RR1" ? selectedNodeId : undefined) ?? effectiveDeviceId ?? activeDeviceId) as RouterId | undefined;
  const focusTrace = focusInspectDeviceId ? traceFor(focusInspectDeviceId, state, tech, stepId) : undefined;
  const focusInterfaces = focusInspectDeviceId ? interfacesFor(focusInspectDeviceId, state, tech, stepId) : undefined;
  const focusHasEvent = focusTrace?.activeStageId !== undefined;

  // --- HopTimeline: every reached step that carries a packet or records an event at one router. Tagged with its data plane: SR-MPLS and SRv6 entries are parallel executions, not one packet's progression.
  const journeyHopEntries = capstoneSteps
    .map((s, i) => ({ s, i }))
    .filter(({ s, i }) => i <= index && (!!s.packet || PRIMARY_TRANSITION_ROUTER[s.id] !== undefined))
    .map(({ s, i }) => ({ id: s.id, label: `${stepArchTag(stepArchitecture(s.id))} · ${s.label}`, index: i }));
  // Chip position of a valid historical selection; -1 falls back to the live entry, never to "no current chip".
  const historicalTimelinePos = historicalCursor !== undefined ? journeyHopEntries.findIndex((h) => h.index === historicalCursor) : -1;

  const historicalDeviceId = historical ? deviceWithEvent(deviceForStep(historicalStep!.id, historicalPacket), historicalState!, historicalStep!.id, tech) : undefined;
  const historicalTrace = historicalDeviceId ? traceFor(historicalDeviceId, historicalState!, tech, historicalStep!.id) : undefined;
  const historicalInterfaces = historicalDeviceId ? interfacesFor(historicalDeviceId, historicalState!, tech, historicalStep!.id) : undefined;

  // --- Comparison surface data (domain-computed; revealed only once the phase's own predictions are behind the learner).
  const archComparison = useMemo(() => compareArchitectures(), []);
  const requirementMatrix = useMemo(() => buildRequirementMatrix(), []);
  const headerLabRows = useMemo(() => buildSegmentEncodingComparison(), []);
  const mplsSidDb = useMemo(() => buildMplsSidDatabase(), []);
  const srv6SidDb = useMemo(() => buildSrv6SidDatabase(), []);
  const phase = comparisonPhaseForIndex(index);
  const phaseRows = (p: ComparisonPhase): TransportComparisonRow[] => (p === "transport" ? archComparison.transport : p === "te" ? archComparison.te : p === "vpn" ? archComparison.vpn : p === "protection" ? (state.sharedRepair ? compareProtectionEncoding(state.sharedRepair) : []) : p === "other" ? requirementMatrix : []);

  const mplsSidRows: SidTableRow[] = mplsSidDb.map((r) => ({ router: r.router, sidType: r.sidType, localLabel: r.label, scope: r.sidType === "NODE" ? "GLOBAL" : "LOCAL", owner: r.owner, nextHop: r.neighbor, meaning: r.meaning, installed: true }));
  // Built from STATE (set by mpls-te-build), never the static builder — the list must not exist before the learner has predicted its size.
  const teMplsRows: SegmentListRow[] = state.mplsSegments.map((s, i) => ({ order: i, sid: s.type === "NODE" ? nodeSidLabel(s.owner) : adjSidLabel(s.owner, s.target!), type: s.type, owner: s.owner, target: s.type === "NODE" ? s.owner : s.target!, scope: s.type === "NODE" ? "GLOBAL" : "LOCAL", active: i === 0, completed: false, explanation: s.explanation }));
  const repairMplsRows: SegmentListRow[] = (state.sharedRepair ? buildMplsRepairList(state.sharedRepair) : []).map((s, i) => ({ order: i, sid: s.label, type: s.type, owner: s.owner, target: s.target ?? s.owner, scope: s.type === "NODE" ? "GLOBAL" : "LOCAL", active: i === 0, completed: false, explanation: s.type === "NODE" ? `Reach ${s.owner} via ordinary IGP` : `At ${s.owner}, force the ${s.owner}→${s.target} adjacency` }));
  const srv6RepairRows: Srv6RepairSidRow[] = state.sharedRepair?.repairList.sids.map((s) => ({ sid: s.sidText, owner: s.owner, behavior: "End.X", adjacency: s.adjacency, flavors: s.flavors, purpose: `Force ${s.owner}→${s.adjacency}` })) ?? [];
  const srv6VpnRow: Srv6VpnRouteRow | undefined = state.srv6VpnRoute
    ? {
        afiSafi: "VPN-IPv4",
        prefix: state.srv6VpnRoute.prefix,
        rd: state.srv6VpnRoute.rd,
        routeTargets: state.srv6VpnRoute.rt,
        bgpNextHop: state.srv6VpnRoute.bgpNextHop,
        serviceSid: state.srv6VpnRoute.prefixSid?.l3Service.serviceSid.sidText,
        endpointBehavior: "End.DT4",
        received: !!state.srv6ImportProgress?.received,
        rtImported: state.srv6ImportProgress?.rtImport?.passed,
        rtImportReason: state.srv6ImportProgress?.rtImport?.reason,
        sidResolved: state.srv6ImportProgress?.serviceSidResolution?.resolvable,
        sidResolvedReason: state.srv6ImportProgress?.serviceSidResolution?.reason,
        installed: state.srv6ImportProgress?.installed,
      }
    : undefined;

  const diagnosticLayers: DiagnosticLayer[] = [
    { label: "CE route advertised", status: state.troubleshooting.started ? "healthy" : "unknown" },
    { label: "VPN route received", status: state.troubleshooting.started ? "healthy" : "unknown" },
    { label: "RT import", status: state.troubleshooting.started ? "healthy" : "unknown" },
    { label: "BGP next hop reachable", status: state.troubleshooting.started ? "healthy" : "unknown" },
    { label: "SR-MPLS: VPN forwarding", status: state.troubleshooting.started ? "healthy" : "unknown" },
    { label: "SRv6: Service SID resolvable", status: !state.troubleshooting.locatorWithdrawn ? "unknown" : state.troubleshooting.repaired ? "healthy" : "failing" },
    { label: "SRv6: VPN forwarding usable", status: !state.troubleshooting.locatorWithdrawn ? "unknown" : state.troubleshooting.verified ? "healthy" : "failing" },
  ];

  // --- Device Explorer (LIVE state only — disabled while a historical entry is inspected). Tabs are technology-native: an LFIB tab exists only in SR-MPLS, a Local SID Table only in SRv6.
  function explorerTabsFor(router: RouterId): DeviceExplorerTab[] {
    const explanation = explainNode(state, tech, router);
    const tabs: DeviceExplorerTab[] = [
      { id: "overview", label: "Overview", content: <OverviewTab tech={techName} action={explanation.currentAction} note={explanation.note} tables={explanation.tables} /> },
      { id: "interfaces", label: "Interfaces", content: <InterfaceListTab interfaces={interfacesFor(router, state, tech, stepId)} selectedInterfaceId={selectedInterfaceId} onSelectInterface={setSelectedInterfaceId} /> },
    ];
    if (router === "CE1" || router === "CE2") return tabs;
    const exercised = state.journey.filter((h) => h.architecture === tech && h.router === router);
    if (tech === "SR_MPLS") {
      tabs.push({
        id: "sid-bindings",
        label: "SID / Label Bindings",
        content: <RowsTab rows={mplsSidDb.filter((r) => r.sidType === "NODE" || r.router === router).map((r) => ({ label: r.sidType === "NODE" ? `Node-SID(${r.router}) · global` : `Adj-SID(${r.owner}→${r.neighbor}) · local`, value: String(r.label) }))} />,
      });
      tabs.push({
        id: "lfib",
        label: "MPLS LFIB (exercised)",
        content: <RowsTab note="Entries this router has actually used in the lesson so far — the capstone does not model a full LFIB dump." rows={exercised.map((h) => ({ label: `${capstoneSteps.find((s) => s.id === h.stepId)?.label ?? h.stepId}`, value: `${h.input} → ${h.action} → ${h.output}` }))} empty="No SR-MPLS label operation recorded at this router yet." />,
      });
      if (router === "PE1") tabs.push({ id: "policy", label: "SR Policy", content: <RowsTab rows={state.mplsSegments.map((s) => ({ label: `#${s.order} ${s.type === "NODE" ? `Node-SID(${s.owner})` : `Adj-SID(${s.owner}→${s.target})`}`, value: String(s.type === "NODE" ? nodeSidLabel(s.owner) : adjSidLabel(s.owner, s.target!)) }))} empty="No SR Policy built yet." /> });
      if (router === "PE1" || router === "PE2") {
        const vrf = state.mplsVrfs[router]?.[0];
        tabs.push({ id: "vrf", label: "VRF CUST-A", content: <RowsTab rows={[...(vrf?.routes.map((r) => ({ label: r.prefix, value: r.origin === "local" ? "local (CE-facing)" : `imported · RD ${r.rd} via ${r.viaPe}${state.mplsVpnRoute ? ` · VPN label ${state.mplsVpnRoute.vpnLabel}` : ""}` })) ?? []), { label: "Import / Export RT", value: `${vrf?.importRt ?? "—"} / ${vrf?.exportRt ?? "—"}` }]} /> });
      }
      if (router === "P1") tabs.push({ id: "repair", label: "TI-LFA Repair", content: <RowsTab rows={state.sharedRepair ? [{ label: "Protected", value: `${PROTECTED_LINK} (${state.linkFailed ? "DOWN" : "up"})` }, { label: "Repair OIF", value: `P1→${state.sharedRepair.outgoingInterface ?? "?"}` }, ...buildMplsRepairList(state.sharedRepair).map((s) => ({ label: s.type === "NODE" ? `Node-SID(${s.owner})` : `Adj-SID(${s.owner}→${s.target})`, value: String(s.label) }))] : []} empty="Repair not computed yet." /> });
    } else {
      tabs.push({ id: "locator", label: "Locator / End SID", content: <RowsTab rows={[{ label: "Infrastructure address", value: fmtIpv6(INFRA_ADDRESS[router]) }, ...srv6SidDb.filter((r) => r.router === router).map((r) => ({ label: r.behavior === "END" ? "End SID" : r.behavior, value: r.sidText }))]} /> });
      tabs.push({ id: "local-sid", label: "Local SID Table", content: <RowsTab note="Only SIDs this capstone actually binds at this router." rows={localSidEntries(state, router).map((e) => ({ label: `${e.sid} · ${e.behavior}`, value: e.usedBy }))} /> });
      if (router === "PE1") {
        const srh = state.srv6TePacket?.srh;
        tabs.push({
          id: "policy",
          label: "SR Policy",
          content: srh ? <SegmentRoutingHeaderViewer title="SR Policy SRH (Explicit TE)" activeDa={fmtIpv6(state.srv6TePacket!.daHextets)} srh={{ ...srh, segmentList: srh.segmentList.map((s) => ({ index: s.index, sid: s.sidText, label: s.ownerRouter })) }} /> : <RowsTab rows={[]} empty="No SR Policy built yet." />,
        });
        tabs.push({ id: "vpn", label: "CUST-A VPN Route", content: srv6VpnRow ? <Srv6VpnRouteViewer title="CUST-A (received from PE2)" route={srv6VpnRow} /> : <RowsTab rows={[]} empty="No SRv6 VPN route received yet." /> });
      }
      if (router === "P1") tabs.push({ id: "repair", label: "TI-LFA Repair", content: <RowsTab rows={state.sharedRepair ? [{ label: "Protected", value: `${PROTECTED_LINK} (${state.linkFailed ? "DOWN" : "up"})` }, { label: "Repair OIF", value: `P1→${state.sharedRepair.outgoingInterface ?? "?"}` }, ...state.sharedRepair.repairList.sids.map((s) => ({ label: `${s.sidText}`, value: `End.X+${s.flavors.join("+")} at ${s.owner} → ${s.adjacency}` }))] : []} empty="Repair not computed yet." /> });
    }
    tabs.push({ id: "cli", label: "CLI (conceptual)", content: <CliTab commands={buildCapstoneCliCommands(state, tech, router)} /> });
    return tabs;
  }

  /** Detail shown in <ObjectFocusPanel> — every field read off `deviceTrace`/`deviceInterfaces`/`devicePacketFrames` for the current technology. */
  function focusPanelFieldsFor(target: FocusTarget3D): { title: string; fields: { label: string; value: string }[] } {
    if (target.kind === "stage" && deviceTrace) {
      const stage = deviceTrace.stages.find((s) => s.id === target.id);
      const fields: { label: string; value: string }[] = [{ label: "Data plane", value: techName }];
      if (deviceTrace.activeStageId === target.id) {
        if (deviceTrace.lookupType) fields.push({ label: "Lookup", value: deviceTrace.lookupType });
        if (deviceTrace.lookupKey) fields.push({ label: "Match", value: deviceTrace.lookupKey });
        if (deviceTrace.lookupResult) fields.push({ label: "Result", value: deviceTrace.lookupResult });
        const egressIface = deviceInterfaces.find((i) => i.id === deviceTrace.egressInterfaceId);
        if (egressIface) fields.push({ label: "Egress", value: egressIface.name });
        if (deviceTrace.reason) fields.push({ label: "Why", value: deviceTrace.reason });
      } else {
        fields.push({ label: "State", value: deviceTrace.completedStageIds.includes(target.id) ? "Completed at this hop" : "Not reached at this hop" });
      }
      return { title: stage?.label ?? target.id, fields };
    }
    if (target.kind === "packetLayer") {
      const frame = devicePacketFrames?.find((f) => f.id === target.id);
      return { title: frame?.text ?? target.id, fields: [{ label: "Data plane", value: techName }, { label: "Changed at this hop", value: frame?.justChanged ? "Yes" : "No" }] };
    }
    if (target.kind === "interface") {
      const iface = deviceInterfaces.find((i) => i.id === target.id);
      if (!iface) return { title: target.id, fields: [] };
      const fields: { label: string; value: string }[] = [];
      if (iface.neighborLabel) fields.push({ label: "Physical peer", value: iface.neighborLabel });
      fields.push({ label: "Current role", value: iface.role === "ingress" ? "Ingress" : iface.role === "egress" ? "Egress" : "Idle" });
      fields.push({ label: "Status", value: iface.status === "up" ? "Up" : "Down" });
      if (iface.ip) fields.push({ label: "IP", value: iface.ip });
      iface.extra?.forEach((e) => fields.push(e));
      return { title: iface.name, fields };
    }
    return { title: target.id, fields: [] };
  }

  // --- Handlers ---
  function handleCameraModeChange(v: CameraMode) {
    setCameraMode(v);
    if (v === "device" && !enteredDeviceId) {
      const sel = selectedNodeId && DEVICE_ROUTERS.includes(selectedNodeId as (typeof DEVICE_ROUTERS)[number]) ? (selectedNodeId as RouterId) : undefined;
      setEnteredDeviceId(sel ?? activeDeviceId ?? "P1");
    }
    if (v === "overview") {
      setEnteredDeviceId(undefined);
      setSelectedNodeId(undefined);
    }
    if (v === "freeOrbit") setEnteredDeviceId(undefined);
  }

  /** Technology switch (shared/parallel steps only): clears everything whose meaning is technology-specific (focused stage/layer, historical cursor, selected interface, packet detail). Device/link selection is physical and stays valid in both data planes. */
  function handleTechChange(v: Architecture) {
    setTechChoice(v);
    setFocused(undefined);
    setSelectedInterfaceId(undefined);
    setPacketSelected(false);
  }

  function handleToggleAutoPlay() {
    if (!autoPlay) {
      setFocused(undefined);
      setHistoricalIndex(undefined);
      setInspectorSurface("hop");
    }
    setAutoPlay((v) => !v);
  }

  const goPrev = () => {
    setHistoricalIndex(undefined);
    setInspectorSurface("hop");
    engine.goTo(Math.max(0, index - 1));
  };
  const goNext = () => {
    setHistoricalIndex(undefined);
    setInspectorSurface("hop");
    engine.advance();
  };

  useEffect(() => {
    if (isComplete && !awardedRef.current) {
      awardedRef.current = true;
      completeLesson("sr-mpls-vs-srv6", 1000);
      unlockAchievement("segment-routing-architect");
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
    if (currentStep && DECISION_LAB_STEP_IDS.has(currentStep.id)) {
      const arch: Architecture = optionId === "srv6" || optionId === "srv6-uncompressed" || optionId === "srv6-csid" ? "SRV6" : "SR_MPLS";
      engine.act(arch);
    }
  };

  const handleRestart = () => {
    awardedRef.current = false;
    engine.restart();
    setViewMode("SIDE_BY_SIDE");
    setIs3D(false);
    setTechChoice("SR_MPLS");
    setCameraMode("overview");
    setSelectedNodeId(undefined);
    setEnteredDeviceId(undefined);
    setSelectedInterfaceId(undefined);
    setSelectedLinkId(undefined);
    setPacketSelected(false);
    setFocusMode(false);
    setFocused(undefined);
    setHistoricalIndex(undefined);
    setInspectorSurface("hop");
    setAutoPlay(false);
  };

  const nextLabel = currentStep?.question && !lastAnswer ? "Answer to continue" : currentStep?.requiresState && !canAdvance ? "Apply the correct fix to continue" : "Next Step →";

  const selectNode = (id: string) => {
    setSelectedNodeId(id as RouterId | "RR1");
    setPacketSelected(false);
    setSelectedLinkId(undefined);
    setInspectorSurface("device");
    setHistoricalIndex(undefined);
  };

  const repairAction = (
    <GlassPanel strong className="p-4">
      <p className="mb-3 text-sm text-pv-text">Restore PE2&apos;s SRv6 locator reachability and recompute Service SID resolution.</p>
      <Button onClick={() => engine.act(undefined)} disabled={state.troubleshooting.repaired}>
        {state.troubleshooting.repaired ? "Locator Restored ✓" : "Restore SRv6 Locator Reachability"}
      </Button>
    </GlassPanel>
  );

  const techSwitcher = <TopologyModeSwitcher options={TECH_OPTIONS} value={tech} onChange={handleTechChange} disabledValues={techLocked ? TECH_OPTIONS.map((o) => o.value).filter((v) => v !== tech) : undefined} />;
  const techBanner = (
    <div className={clsx("flex items-center gap-2 rounded-lg border px-3 py-1.5", tech === "SR_MPLS" ? "border-pv-cyan/40 bg-pv-cyan/5" : "border-pv-violet/40 bg-pv-violet/5")}>
      <span className={clsx("text-[11px] font-semibold uppercase tracking-wide", tech === "SR_MPLS" ? "text-pv-cyan-soft" : "text-pv-violet")}>{techName}</span>
      <span className="text-[10px] text-pv-text-faint">{techLocked ? "— this step's data plane" : inspectStepArch === "BOTH" ? "— one of two parallel executions (switch above)" : "— shared step; showing this data plane's device state"}</span>
    </div>
  );

  const comparisonSurface = (() => {
    const p = phase;
    const revealed = comparisonRevealed(p, index);
    const rows = revealed ? phaseRows(p) : [];
    const par = revealed ? parallelPackets(p, state) : {};
    return (
      <div className="space-y-3">
        <StepNarrative label={currentStep?.label} narrative={currentStep?.narrative} whatChanged={whatChanged} open />
        {!revealed ? (
          <GlassPanel className="p-4 text-[11px] text-pv-text-faint">The {PHASE_TITLE[p]} side-by-side unlocks at step {comparisonRevealIndex(p) + 1} — after this phase&apos;s predictions, so it can&apos;t give their answers away.</GlassPanel>
        ) : (
          <>
            {rows.length > 0 && <ComparisonTable title={`SR-MPLS vs SRv6 — ${PHASE_TITLE[p]}`} rows={rows} />}
            {par.mpls && par.srv6 && <ParallelPackets mpls={framesForHopPacket(par.mpls) ?? []} srv6={framesForHopPacket(par.srv6) ?? []} />}
            {p === "header" && <SegmentEncodingComparisonViewer title="8-Segment Program: Modeled Overhead (Near-MTU)" rows={headerLabRows} />}
          </>
        )}
      </div>
    );
  })();

  const noEventPlaceholder = (
    <div className="space-y-3">
      <StepNarrative label={currentStep?.label} narrative={currentStep?.narrative} whatChanged={whatChanged} open />
      <GlassPanel className="p-4">
        <p className="text-xs text-pv-text-faint">
          No active {techName} forwarding event {focusInspectDeviceId ? `at ${focusInspectDeviceId} ` : ""}for this step. Select a device, pick an earlier timeline entry, or advance the lesson.
        </p>
      </GlassPanel>
    </div>
  );

  const hopSwitcher = (disabled: boolean) => (inDeviceMode ? <TopologyModeSwitcher options={[{ value: "hop", label: "Hop" }, { value: "device", label: "Device" }]} value={inspectorSurface} onChange={setInspectorSurface} tone="violet" disabledValues={disabled ? ["device"] : undefined} /> : null);

  const focusInspector: ReactNode = (() => {
    // 1. Progression gates always win (prediction questions, decision labs, diagnosis).
    if (!isComplete && currentStep?.question && (questionActive || !historical)) {
      return (
        <>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-pv-cyan-soft">{DECISION_LAB_STEP_IDS.has(currentStep.id) ? "Engineering Decision Lab" : "Current Prediction"}</p>
          <StepNarrative label={currentStep.label} narrative={currentStep.narrative} open />
          <PredictionQuestion question={currentStep.question} selectedOptionId={lastAnswer?.stepId === currentStep.id ? lastAnswer.optionId : undefined} onAnswer={handleAnswer} />
          {currentStep.id === "incident-ladder" && <TroubleshootingLayers layers={diagnosticLayers} />}
        </>
      );
    }
    // 2. The requiresState repair action (no question) — must be reachable here, or Focus Mode would dead-end.
    if (!isComplete && stepId === "incident-repair" && (!state.troubleshooting.repaired || !historical)) {
      return (
        <>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-pv-warning">Engineer Action</p>
          <StepNarrative label={currentStep?.label} narrative={currentStep?.narrative} open />
          {repairAction}
          <TroubleshootingLayers layers={diagnosticLayers} />
        </>
      );
    }
    if (selectedLinkDetail) {
      return (
        <LinkDetailPanel
          detail={selectedLinkDetail}
          onClose={() => {
            setSelectedLinkId(undefined);
            setFocused(undefined);
          }}
        />
      );
    }
    if (activeFocusedObject && activeFocusedObject.kind !== "link") {
      const f = focusPanelFieldsFor(activeFocusedObject);
      return <ObjectFocusPanel kind={activeFocusedObject.kind} title={f.title} fields={f.fields} onBack={() => setFocused(undefined)} onOverview={() => { setFocused(undefined); handleCameraModeChange("overview"); }} />;
    }
    if (inspectorSurface === "device") {
      if (inDeviceMode) {
        return (
          <div className="space-y-3">
            {hopSwitcher(false)}
            {techBanner}
            <DeviceExplorerPanel explanation={explainNode(state, tech, effectiveDeviceId!)} tabs={explorerTabsFor(effectiveDeviceId!)} xrayEnabled={deviceXray} onToggleXray={() => setDeviceXray((v) => !v)} onExit={() => { setCameraMode("overview"); setEnteredDeviceId(undefined); }} />
          </div>
        );
      }
      if (nodeExplanation) {
        return (
          <div className="space-y-3">
            {techBanner}
            <NodeInspectorPanel explanation={nodeExplanation} packet={drawablePacket && (selectedNodeId === drawablePacket.from || selectedNodeId === drawablePacket.to) ? drawablePacket : undefined}>
              {selectedNodeId && DEVICE_ROUTERS.includes(selectedNodeId as (typeof DEVICE_ROUTERS)[number]) && (
                <Button size="sm" onClick={() => { setEnteredDeviceId(selectedNodeId as RouterId); setCameraMode("device"); }}>
                  Enter Device →
                </Button>
              )}
            </NodeInspectorPanel>
          </div>
        );
      }
      return noEventPlaceholder;
    }
    if (historical) {
      return (
        <div className="space-y-3">
          {hopSwitcher(true)}
          <div className="flex items-center justify-between rounded-lg border border-pv-violet/40 bg-pv-violet/10 px-3 py-2">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 shrink-0 rounded-full bg-pv-violet" />
              <span className="text-[11px] font-semibold uppercase tracking-wide text-pv-violet">Historical — {historicalStep?.label}</span>
            </div>
            <button type="button" onClick={() => setHistoricalIndex(undefined)} className="text-[11px] font-semibold uppercase tracking-wide text-pv-text-faint transition-colors hover:text-pv-cyan-soft">
              Return to Current →
            </button>
          </div>
          {techBanner}
          {historicalTrace && historicalDeviceId ? (
            <>
              <HopInspectorPanel trace={historicalTrace} deviceName={historicalDeviceId} interfaces={historicalInterfaces} />
              <PacketDiffViewer before={historicalTrace.packetBeforeFrames} after={historicalTrace.packetAfterFrames} beforeText={historicalTrace.packetBefore} afterText={historicalTrace.packetAfter} mutations={historicalTrace.mutations} />
            </>
          ) : (
            <GlassPanel className="p-4">
              <p className="text-xs text-pv-text-faint">No {techName} event was recorded at this step.</p>
            </GlassPanel>
          )}
        </div>
      );
    }
    if (focusHasEvent && focusTrace) {
      return (
        <div className="space-y-3">
          {hopSwitcher(false)}
          {techBanner}
          <HopInspectorPanel
            trace={focusTrace}
            deviceName={focusInspectDeviceId ?? "—"}
            interfaces={focusInterfaces}
            onFocusNextHop={(id) => {
              setSelectedNodeId(id as RouterId);
              setInspectorSurface("hop");
              setHistoricalIndex(undefined);
              if (cameraMode === "device" && DEVICE_ROUTERS.includes(id as (typeof DEVICE_ROUTERS)[number])) setEnteredDeviceId(id as RouterId);
            }}
          />
          <PacketDiffViewer before={focusTrace.packetBeforeFrames} after={focusTrace.packetAfterFrames} beforeText={focusTrace.packetBefore} afterText={focusTrace.packetAfter} mutations={focusTrace.mutations} />
        </div>
      );
    }
    if (stepArchitecture(stepId) === "SHARED" && comparisonRevealed(phase, index) && (phaseRows(phase).length > 0 || phase === "header")) {
      return (
        <div className="space-y-3">
          {hopSwitcher(false)}
          {comparisonSurface}
        </div>
      );
    }
    return (
      <div className="space-y-3">
        {hopSwitcher(false)}
        {noEventPlaceholder}
        {state.troubleshooting.started && stepArchitecture(stepId) === "SRV6" && <TroubleshootingLayers layers={diagnosticLayers} />}
      </div>
    );
  })();

  const deviceView = inDeviceMode
    ? {
        deviceLabel: `${effectiveDeviceId!} · ${techName}`,
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
        pipelineTitle: tech === "SR_MPLS" ? "Conceptual SR-MPLS Forwarding Pipeline" : "Conceptual SRv6 Forwarding Pipeline",
        onFocusObject: setFocusedObject,
        focusedObjectId: activeFocusedObject?.id,
      }
    : undefined;

  return (
    <div className="mx-auto max-w-7xl px-6 py-10">
      <div className="mb-6">
        <Badge tone="cyan" className="mb-3">
          ENGINEERING CAPSTONE · RFC 8402 · RFC 8660 · RFC 9256 · RFC 9855 · RFC 8754 · RFC 8986 · RFC 9252 · RFC 9800
        </Badge>
        <h1 className="text-2xl font-semibold text-pv-text sm:text-3xl">SR-MPLS vs. SRv6: Same Requirement, Two Data Planes</h1>
        <p className="mt-2 max-w-3xl text-sm text-pv-text-muted">
          One shared topology, one shared traffic requirement, one shared failure, one shared VPN service, one shared TE requirement — solved once in SR-MPLS, once in SRv6. Inspect exactly what changes and what doesn&apos;t.
        </p>
      </div>

      <div className="mb-4 grid gap-2 sm:grid-cols-4">
        {WHY_CAPSTONE.map((item) => (
          <GlassPanel key={item.q} className="p-3">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-pv-cyan-soft">{item.q}</p>
            <p className="text-[11px] leading-snug text-pv-text-muted">{item.a}</p>
          </GlassPanel>
        ))}
      </div>

      <div className="mb-4 flex gap-1 overflow-x-auto pb-2">
        {capstoneSteps.map((step, i) => (
          <button
            key={step.id}
            type="button"
            disabled={i > index}
            onClick={() => i < index && engine.goTo(i)}
            title={step.label}
            className={clsx("h-1.5 flex-1 min-w-2 rounded-full transition-colors", i < index ? "bg-pv-success/70 hover:bg-pv-success cursor-pointer" : i === index ? "bg-pv-cyan" : "bg-white/10")}
          />
        ))}
      </div>

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <TopologyModeSwitcher options={VIEW_MODES} value={viewMode} onChange={setViewMode} />
        <TopologyModeSwitcher options={[{ value: "off", label: "2D" }, { value: "on", label: "3D View" }]} value={is3D ? "on" : "off"} onChange={(v) => setIs3D(v === "on")} tone="violet" />
        {is3D && <TopologyModeSwitcher options={CAMERA_OPTIONS} value={cameraMode} onChange={handleCameraModeChange} />}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-4">
          <GlassPanel strong className="p-5">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-pv-cyan-soft">
                Step {Math.min(index + 1, totalSteps)} / {totalSteps} — {currentStep?.label ?? "Complete"}
              </span>
              <Badge tone={stepArchitecture(stepId) === "SRV6" ? "violet" : "cyan"}>{stepArchTag(stepArchitecture(stepId))}</Badge>
            </div>
            <p className="text-sm leading-relaxed text-pv-text">{currentStep?.narrative}</p>
            {whatChanged.length > 0 && (
              <ul className="mt-3 space-y-1 border-t border-pv-border pt-3 text-[11px] text-pv-text-muted">
                {whatChanged.map((w, i) => (
                  <li key={i}>• {w}</li>
                ))}
              </ul>
            )}
          </GlassPanel>

          {currentStep?.question && <PredictionQuestion question={currentStep.question} selectedOptionId={lastAnswer?.stepId === currentStep.id ? lastAnswer.optionId : undefined} onAnswer={handleAnswer} />}

          {stepId === "incident-ladder" && <TroubleshootingLayers layers={diagnosticLayers} />}
          {stepId === "incident-repair" && repairAction}

          <TopologyFrame questionActive={questionActive} onExpand={() => setFocusMode(true)}>
            {!is3D ? (
              <GlassPanel className="relative aspect-[16/10] w-full overflow-hidden p-0">
                <GraphTopologyViewer nodes={nodes} edges={edges} activeNodeIds={activeNodeIds} onNodeClick={(id) => setSelectedNodeId(id as RouterId)} onEdgeClick={setSelectedLinkId}>
                  {drawablePacket && packetFrom && packetTo && <GraphPacket packet={drawablePacket} from={packetFrom} to={packetTo} onSelect={() => setPacketSelected(true)} />}
                </GraphTopologyViewer>
              </GlassPanel>
            ) : focusMode ? (
              // Focus Mode renders its own full-size <NetworkScene3D> — never a second, hidden WebGL canvas behind it (one-canvas invariant).
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
                deviceView={deviceView}
              />
            )}
          </TopologyFrame>

          {packetSelected && drawablePacket && (
            <PacketDetailPanel
              packet={drawablePacket}
              currentDevice={effectiveDeviceId ?? drawablePacket.from}
              direction={`${drawablePacket.from} → ${drawablePacket.to} (${stepArchTag(stepArchitecture(stepId))})`}
              paused={packetSelected}
              onResume={() => setPacketSelected(false)}
              onStepForward={goNext}
              onStepBack={goPrev}
              canStepForward={canAdvance}
              canStepBack={index > 0}
              onClose={() => setPacketSelected(false)}
            />
          )}

          {selectedNodeId && selectedNodeId !== "RR1" && !enteredDeviceId && DEVICE_ROUTERS.includes(selectedNodeId as (typeof DEVICE_ROUTERS)[number]) && (
            <GlassPanel className="p-3">
              <div className="flex items-center justify-between">
                <span className="pv-mono text-sm text-pv-text">{selectedNodeId}</span>
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setEnteredDeviceId(selectedNodeId as RouterId);
                      if (is3D) setCameraMode("device");
                    }}
                  >
                    Enter Device →
                  </Button>
                  <Button variant="secondary" onClick={() => setSelectedNodeId(undefined)}>
                    Close
                  </Button>
                </div>
              </div>
            </GlassPanel>
          )}

          {selectedLinkDetail && !packetSelected && <LinkDetailPanel detail={selectedLinkDetail} onClose={() => setSelectedLinkId(undefined)} />}

          {enteredDeviceId && (
            <GlassPanel strong className="space-y-3 p-4">
              <div className="flex flex-wrap items-center gap-2">
                {techSwitcher}
                {techLocked && <span className="text-[10px] text-pv-text-faint">Locked to this step&apos;s data plane.</span>}
              </div>
              {historical ? (
                <p className="text-xs text-pv-text-faint">Device Explorer shows live state only — return to the current step to use it.</p>
              ) : questionActive ? (
                <p className="text-xs text-pv-text-faint">Answer the prediction first — device tables would give the answer away.</p>
              ) : (
                <DeviceExplorerPanel
                  explanation={explainNode(state, tech, enteredDeviceId)}
                  tabs={explorerTabsFor(enteredDeviceId)}
                  xrayEnabled={deviceXray}
                  onToggleXray={() => setDeviceXray((v) => !v)}
                  onExit={() => {
                    setEnteredDeviceId(undefined);
                    setCameraMode("overview");
                  }}
                />
              )}
            </GlassPanel>
          )}

          {isComplete ? (
            <GlassPanel strong glow="success" className="flex flex-col items-center gap-4 p-10 text-center">
              <Badge tone="success">Segment Routing Architect</Badge>
              <h2 className="text-2xl font-semibold text-pv-text">One Architecture, Two Data Planes</h2>
              <p className="max-w-md text-sm text-pv-text-muted">You solved the identical engineering brief twice — once in SR-MPLS, once in SRv6 — and compared exactly what changed and what didn&apos;t. +1000 XP awarded.</p>
              <div className="flex gap-3">
                <Button onClick={handleRestart} variant="secondary">
                  Restart Lesson
                </Button>
                <Link href="/dashboard">
                  <Button>View Dashboard</Button>
                </Link>
              </div>
            </GlassPanel>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Button variant="secondary" onClick={goPrev} disabled={index === 0}>
                ← Previous
              </Button>
              <Button variant={autoPlay ? "primary" : "ghost"} size="sm" onClick={handleToggleAutoPlay}>
                {autoPlay ? "⏸ Auto-Playing" : "▶ Auto-Play"}
              </Button>
              <Button variant="secondary" onClick={handleRestart}>
                Restart
              </Button>
              <Button onClick={goNext} disabled={!canAdvance}>
                {nextLabel}
              </Button>
            </div>
          )}
        </div>

        <div className="space-y-4">
          {questionActive && viewMode !== "PACKET" ? (
            <GlassPanel className="p-4 text-[11px] text-pv-text-faint">Answer the prediction to reveal this view — its tables would give the answer away.</GlassPanel>
          ) : (
            <>
              {viewMode === "REQUIREMENT" && <RequirementView rows={requirementMatrix} revealed={comparisonRevealed("other", index)} revealStep={comparisonRevealIndex("other") + 1} completed={isComplete} archComparison={archComparison} />}
              {viewMode === "SR_MPLS" && <MplsView state={state} sidRows={mplsSidRows} teRows={teMplsRows} repairRows={repairMplsRows} />}
              {viewMode === "SRV6" && <Srv6View state={state} sidDb={srv6SidDb} srv6VpnRow={srv6VpnRow} repairRows={srv6RepairRows} />}
              {viewMode === "SIDE_BY_SIDE" &&
                (phase === "other" ? (
                  <GlassPanel className="p-4 text-[11px] text-pv-text-faint">No per-phase comparison at this step — see the Requirement view for the full matrix once it unlocks.</GlassPanel>
                ) : comparisonRevealed(phase, index) ? (
                  <div className="space-y-4">
                    {phaseRows(phase).length > 0 && <ComparisonTable title={`SR-MPLS vs SRv6 — ${PHASE_TITLE[phase]}`} rows={phaseRows(phase)} />}
                    {(() => {
                      const par = parallelPackets(phase, state);
                      return par.mpls && par.srv6 ? <ParallelPackets mpls={framesForHopPacket(par.mpls) ?? []} srv6={framesForHopPacket(par.srv6) ?? []} /> : null;
                    })()}
                    {phase === "header" && <SegmentEncodingComparisonViewer title="8-Segment Program: Modeled Overhead (Near-MTU)" rows={headerLabRows} />}
                  </div>
                ) : (
                  <GlassPanel className="p-4 text-[11px] text-pv-text-faint">The {PHASE_TITLE[phase]} side-by-side unlocks at step {comparisonRevealIndex(phase) + 1} — after this phase&apos;s predictions.</GlassPanel>
                ))}
              {viewMode === "PACKET" && <PacketInspector packet={activePacket} />}
              {viewMode === "FAILURE" && <FailureView state={state} repairMplsRows={repairMplsRows} srv6RepairRows={srv6RepairRows} />}
            </>
          )}
        </div>
      </div>

      {focusMode && (
        <TopologyFocusMode
          onClose={() => setFocusMode(false)}
          toolbar={
            <>
              <TopologyModeSwitcher options={CAMERA_OPTIONS} value={cameraMode} onChange={handleCameraModeChange} />
              {techSwitcher}
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
                <Badge tone={stepArchitecture(stepId) === "SRV6" ? "violet" : "cyan"}>{stepArchTag(stepArchitecture(stepId))}</Badge>
                <span className="truncate text-xs font-medium text-pv-text">{currentStep?.label ?? (isComplete ? "Complete" : "")}</span>
              </div>
              {questionActive ? (
                <span className="shrink-0 rounded-full border border-pv-warning/40 bg-pv-warning/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-pv-warning">
                  {DECISION_LAB_STEP_IDS.has(stepId) ? "Decision pending — choose in the panel to continue" : "Prediction pending — answer in the panel to continue"}
                </span>
              ) : stepId === "incident-repair" && !state.troubleshooting.repaired ? (
                <span className="shrink-0 rounded-full border border-pv-warning/40 bg-pv-warning/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-pv-warning">Engineer action pending — restore the locator to continue</span>
              ) : isComplete ? (
                <span className="shrink-0 rounded-full border border-pv-success/40 bg-pv-success/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-pv-success">Capstone complete — Segment Routing Architect (+1000 XP)</span>
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
                onSelectNode={selectNode}
                onSelectLink={(id) => setSelectedLinkId(id)}
                selectedLinkId={selectedLinkId}
                onFocusLink={setFocusedObject}
                onSelectPacket={() => setPacketSelected(true)}
                packetSelected={packetSelected}
                focusPosition={focusPosition3D}
                eyeOffset={eyeOffset3D}
                mode={inDeviceMode ? "device" : "overview"}
                deviceView={deviceView}
              />
            </div>
          }
          inspector={focusInspector}
          timeline={
            <div className="space-y-2">
              <HopTimeline
                hops={journeyHopEntries}
                currentIndex={historicalTimelinePos >= 0 ? historicalTimelinePos : journeyHopEntries.length - 1}
                onSelectHop={(i) => {
                  const entry = journeyHopEntries[i];
                  if (!entry) return;
                  setInspectorSurface("hop");
                  setFocused(undefined);
                  if (entry.index === index) {
                    setHistoricalIndex(undefined);
                    return;
                  }
                  setHistoricalIndex(entry.index);
                  const histState = engine.getStateAt(entry.index);
                  const histStep = capstoneSteps[entry.index];
                  const histPacket = histStep && histState ? histStep.packet?.(histState) : undefined;
                  const router = histState ? deviceForStep(entry.id, histPacket) : undefined;
                  if (router && DEVICE_ROUTERS.includes(router as (typeof DEVICE_ROUTERS)[number])) {
                    setSelectedNodeId(router);
                    if (cameraMode === "device") setEnteredDeviceId(router);
                  }
                }}
              />
              <PacketFlowControls
                playing={autoPlay}
                onTogglePlay={handleToggleAutoPlay}
                onPrevHop={goPrev}
                onNextHop={goNext}
                onReset={handleRestart}
                canPrevHop={index > 0}
                canNextHop={canAdvance && !isComplete}
                speed={speed}
                onSpeedChange={setSpeed}
                followPacket={cameraMode === "packetFollow"}
                onToggleFollowPacket={() => handleCameraModeChange(cameraMode === "packetFollow" ? "overview" : "packetFollow")}
              />
            </div>
          }
        />
      )}
    </div>
  );
}

function StepNarrative({ label, narrative, whatChanged, open }: { label?: string; narrative?: string; whatChanged?: string[]; open?: boolean }) {
  if (!narrative) return null;
  return (
    <details open={open} className="rounded-lg border border-pv-border bg-white/[0.02] p-3">
      <summary className="cursor-pointer text-[10px] font-semibold uppercase tracking-wide text-pv-text-faint">{label ?? "Step"}</summary>
      <p className="mt-2 text-[11px] leading-relaxed text-pv-text-muted">{narrative}</p>
      {whatChanged && whatChanged.length > 0 && (
        <ul className="mt-2 space-y-1 border-t border-pv-border pt-2 text-[11px] text-pv-text-muted">
          {whatChanged.map((w, i) => (
            <li key={i}>• {w}</li>
          ))}
        </ul>
      )}
    </details>
  );
}

/** Property / SR-MPLS / SRv6 rows straight from the scenario's compare*() functions — deliberately no winner column. */
function ComparisonTable({ title, rows }: { title: string; rows: { requirement: string; srMpls: string; srv6: string }[] }) {
  return (
    <GlassPanel strong className="p-4">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-pv-text">{title}</h3>
      <div className="mb-2 grid grid-cols-[1fr_1fr_1fr] gap-2 text-[10px] font-semibold uppercase tracking-wide">
        <span className="text-pv-text-faint">Property</span>
        <span className="text-pv-cyan-soft">SR-MPLS</span>
        <span className="text-pv-violet">SRv6</span>
      </div>
      <div className="space-y-1.5 text-[11px]">
        {rows.map((r) => (
          <div key={r.requirement} className="grid grid-cols-[1fr_1fr_1fr] gap-2 rounded-lg border border-pv-border p-2">
            <span className="font-semibold text-pv-text-faint">{r.requirement}</span>
            <span className="pv-mono break-words text-pv-cyan-soft">{r.srMpls}</span>
            <span className="pv-mono break-words text-pv-violet">{r.srv6}</span>
          </div>
        ))}
      </div>
    </GlassPanel>
  );
}

/** The two headend-built packets for the same intent, side by side — parallel alternatives, NOT a before/after (that is what PacketDiff is for). */
function ParallelPackets({ mpls, srv6 }: { mpls: PacketStackFrame[]; srv6: PacketStackFrame[] }) {
  const tone = (t: PacketStackFrame["tone"]) => (t === "transport" ? "border-pv-cyan/40 bg-pv-cyan/5 text-pv-text" : t === "vpn" ? "border-pv-violet/40 bg-pv-violet/5 text-pv-text" : "border-pv-border bg-white/[0.02] text-pv-text-muted");
  return (
    <GlassPanel className="p-4">
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-pv-text">Headend Packet — Parallel Encodings</h3>
      <p className="mb-3 text-[10px] text-pv-text-faint">Two alternative executions of the same intent, each in its own native format — not one packet changing.</p>
      <div className="grid grid-cols-2 gap-3">
        {[
          { title: "SR-MPLS (label stack)", frames: mpls, cls: "text-pv-cyan-soft" },
          { title: "SRv6 (IPv6 / SRH)", frames: srv6, cls: "text-pv-violet" },
        ].map((col) => (
          <div key={col.title}>
            <p className={clsx("mb-1.5 text-[10px] font-semibold uppercase tracking-wide", col.cls)}>{col.title}</p>
            <div className="space-y-1">
              {col.frames.map((f) => (
                <div key={f.id} className={clsx("rounded-md border px-2 py-1.5 pv-mono text-[10px] break-words", tone(f.tone))}>
                  {f.text}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </GlassPanel>
  );
}

function OverviewTab({ tech, action, note, tables }: { tech: string; action: string; note?: string; tables?: { title: string; rows: { label: string; value: string }[] }[] }) {
  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-pv-cyan/30 bg-pv-cyan/5 p-3">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-pv-cyan-soft">{tech} — Device Activity</p>
        <p className="text-sm text-pv-text">{action}</p>
      </div>
      {note && <p className="rounded-lg border border-pv-warning/30 bg-pv-warning/5 p-2.5 text-xs text-pv-text-muted">{note}</p>}
      {tables?.map((t) => (
        <div key={t.title} className="rounded-lg border border-pv-border p-2.5">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-pv-text-faint">{t.title}</p>
          {t.rows.map((r) => (
            <p key={r.label} className="pv-mono text-[11px] text-pv-text-muted">
              {r.label}: <span className="text-pv-text">{r.value}</span>
            </p>
          ))}
        </div>
      ))}
    </div>
  );
}

function RowsTab({ rows, note, empty }: { rows: { label: string; value: string }[]; note?: string; empty?: string }) {
  return (
    <div className="space-y-1 pv-mono text-[11px]">
      {note && <p className="mb-2 font-sans text-[10px] text-pv-text-faint">{note}</p>}
      {rows.length === 0 ? (
        <p className="font-sans text-xs text-pv-text-faint">{empty ?? "Nothing to show yet."}</p>
      ) : (
        rows.map((r, i) => (
          <div key={`${r.label}-${i}`} className="flex justify-between gap-3 rounded-lg border border-pv-border p-2">
            <span className="text-pv-text-faint">{r.label}</span>
            <span className="text-right text-pv-text">{r.value}</span>
          </div>
        ))
      )}
    </div>
  );
}

function CliTab({ commands }: { commands: { command: string; output: string }[] }) {
  return (
    <div className="space-y-2 pv-mono text-[11px]">
      {commands.map((c) => (
        <div key={c.command} className="rounded-lg border border-pv-border p-2">
          <p className="text-pv-cyan-soft">$ {c.command}</p>
          <p className="text-pv-text-muted">{c.output}</p>
        </div>
      ))}
    </div>
  );
}

function RequirementView({ rows, revealed, revealStep, completed, archComparison }: { rows: { requirement: string; srMpls: string; srv6: string }[]; revealed: boolean; revealStep: number; completed: boolean; archComparison: ReturnType<typeof compareArchitectures> }) {
  return (
    <GlassPanel className="p-4">
      <div className="mb-4 rounded-lg border border-pv-border p-2.5 text-[11px] text-pv-text-muted">
        <p className="mb-1 font-semibold text-pv-text-faint uppercase tracking-wide">Shared CUST-A Service (identical both sides)</p>
        <p>
          RT <span className="text-pv-text">{CUST_A_EXPORT_RT}</span> · RD <span className="text-pv-text">{CUST_A_RD.PE1}</span>/<span className="text-pv-text">{CUST_A_RD.PE2}</span> · CE1 <span className="text-pv-text">{CE1_IPV4_PREFIX}</span> · CE2 <span className="text-pv-text">{CE2_IPV4_PREFIX}</span>
        </p>
      </div>
      <h3 className="mb-3 text-sm font-semibold text-pv-text">Requirement Matrix — No Winner Column</h3>
      {revealed ? (
        <div className="space-y-2 text-[11px]">
          {rows.map((r) => (
            <div key={r.requirement} className="rounded-lg border border-pv-border p-2.5">
              <p className="mb-1 font-semibold text-pv-text">{r.requirement}</p>
              <p className="text-pv-cyan-soft">SR-MPLS: <span className="text-pv-text-muted">{r.srMpls}</span></p>
              <p className="text-pv-violet">SRv6: <span className="text-pv-text-muted">{r.srv6}</span></p>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-[11px] text-pv-text-faint">The matrix restates every phase&apos;s result, so it unlocks at step {revealStep} (Requirement Matrix).</p>
      )}
      {completed && (
        <div className="mt-4 rounded-lg border border-pv-success/40 bg-pv-success/5 p-3 text-[11px] text-pv-text">
          <p className="mb-1 font-semibold text-pv-success">Final Engineering Summary</p>
          <p>Long segment program — SR-MPLS: {archComparison.instructionBytesMpls}B · SRv6 uncompressed: {archComparison.instructionBytesSrv6Uncompressed}B · SRv6 CSID: {archComparison.instructionBytesSrv6Csid}B.</p>
        </div>
      )}
    </GlassPanel>
  );
}

function MplsView({ state, sidRows, teRows, repairRows }: { state: CapstoneState; sidRows: SidTableRow[]; teRows: SegmentListRow[]; repairRows: SegmentListRow[] }) {
  return (
    <div className="space-y-4">
      <SidTableViewer title="SR-MPLS Node/Adj-SID Database" rows={sidRows} srgb={{ start: 16000, end: 16999 }} />
      {teRows.length > 0 ? <SegmentListViewer title="SR Policy Segment List (Explicit TE)" segments={teRows} /> : <GlassPanel className="p-4 text-[11px] text-pv-text-faint">SR Policy segment list appears once PE1 builds it.</GlassPanel>}
      {state.linkFailed && <RepairListViewer title="TI-LFA Repair (SR-MPLS Encoding)" protectedResource={PROTECTED_LINK} repairTarget={state.sharedRepair?.mergeTarget} segments={repairRows} />}
      {state.mplsVpnRoute && (
        <GlassPanel className="p-4 text-[11px]">
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-pv-text-muted">VPNv4 Route (SR-MPLS)</h4>
          <p className="text-pv-text-muted">
            Prefix: <span className="text-pv-text">{state.mplsVpnRoute.prefix}</span> · RD: <span className="text-pv-text">{state.mplsVpnRoute.rd}</span> · RT: <span className="text-pv-text">{state.mplsVpnRoute.rt}</span> · VPN label: <span className="text-pv-text">{state.mplsVpnRoute.vpnLabel}</span>
          </p>
        </GlassPanel>
      )}
    </div>
  );
}

function Srv6View({ state, sidDb, srv6VpnRow, repairRows }: { state: CapstoneState; sidDb: { router: string; behavior: string; sidText: string; meaning: string }[]; srv6VpnRow?: Srv6VpnRouteRow; repairRows: Srv6RepairSidRow[] }) {
  const teSrh = state.srv6TePacket?.srh;
  return (
    <div className="space-y-4">
      <GlassPanel className="p-4">
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-pv-text-muted">SRv6 End SID Database</h4>
        <div className="space-y-1 pv-mono text-[11px]">
          {sidDb.map((r) => (
            <div key={r.router} className="flex justify-between rounded-lg border border-pv-border p-1.5">
              <span className="text-pv-text-faint">{r.router}</span>
              <span className="text-pv-text">{r.sidText}</span>
            </div>
          ))}
        </div>
      </GlassPanel>
      {teSrh && (
        <SegmentRoutingHeaderViewer
          title="SR Policy SRH (Explicit TE)"
          activeDa={teSrh.segmentList[teSrh.segmentsLeft]?.sidText ?? ""}
          srh={{ ...teSrh, segmentList: teSrh.segmentList.map((s) => ({ index: s.index, sid: s.sidText, label: s.ownerRouter })) }}
        />
      )}
      {state.linkFailed && <Srv6RepairListViewer title="TI-LFA Repair (SRv6 Encoding)" protectedResource={PROTECTED_LINK} outgoingInterface={state.sharedRepair?.outgoingInterface} sids={repairRows} />}
      {srv6VpnRow && <Srv6VpnRouteViewer title="CUST-A" route={srv6VpnRow} />}
    </div>
  );
}

function FailureView({ state, repairMplsRows, srv6RepairRows }: { state: CapstoneState; repairMplsRows: SegmentListRow[]; srv6RepairRows: Srv6RepairSidRow[] }) {
  const repair = state.sharedRepair;
  return (
    <div className="space-y-4">
      <GlassPanel className="p-4 text-[11px]">
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-pv-text-muted">Shared TI-LFA Computation</h4>
        <p className="text-pv-text-muted">Protected: <span className="text-pv-text">{PROTECTED_LINK}</span> · PLR: <span className="text-pv-text">{PLR}</span></p>
        <p className="text-pv-text-muted">P-Space: <span className="text-pv-text">{repair?.pSpace.join(", ") || "—"}</span></p>
        <p className="text-pv-text-muted">Extended P-Space: <span className="text-pv-text">{repair?.extendedPSpace.join(", ") || "—"}</span></p>
        <p className="text-pv-text-muted">Q-Space: <span className="text-pv-text">{repair?.qSpace.join(", ") || "—"}</span></p>
        <p className="text-pv-text-muted">Post-convergence path: <span className="text-pv-text">{repair?.postConvergencePath?.join(" → ") || "—"}</span></p>
        <p className="text-pv-text-muted">Repair node: <span className="text-pv-text">{repair?.repairNode ?? "—"}</span> · Merge target: <span className="text-pv-text">{repair?.mergeTarget ?? "—"}</span></p>
      </GlassPanel>
      <RepairListViewer title="SR-MPLS Repair Encoding" protectedResource={PROTECTED_LINK} repairTarget={repair?.mergeTarget} segments={repairMplsRows} />
      <Srv6RepairListViewer title="SRv6 Repair Encoding" protectedResource={PROTECTED_LINK} outgoingInterface={repair?.outgoingInterface} sids={srv6RepairRows} />
      <GlassPanel className="p-3 text-[11px] text-pv-text-faint">Link state: {state.linkFailed ? "P1-P2 DOWN — repairs active" : "Healthy — repairs precomputed, idle"}</GlassPanel>
    </div>
  );
}
