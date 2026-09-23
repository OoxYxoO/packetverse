"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { clsx } from "clsx";
import { useScenarioEngine } from "@/lib/sim-engine/useScenarioEngine";
import {
  ALL_ROUTERS,
  BASE_PROGRAM,
  buildCsidCliCommands,
  calculateCompressionMetrics,
  calculateModeledPacketSize,
  compressNextCsidRun,
  compressReplaceCsidRun,
  computeNextCsidCapacity,
  createSrv6CsidState,
  CSID_CUST_HOST,
  csidHexText,
  ENDX_PROGRAM,
  GRAPH_EDGES,
  GRAPH_NODES,
  HEADEND,
  liveStructures,
  LOCATOR_BLOCK_TEXT,
  NEXT_CSID_LAYOUT,
  NEXT_CSID_VALUE,
  ordinarySidText,
  REPLACE_CSID_LAYOUT,
  REPLACE_PROGRAM,
  srv6CsidSteps,
  verifyCompressionEquivalence,
  type CompressedListEntry,
  type LogicalSegment,
  type RouterId,
  type SegmentRoutingHeader,
  type Srv6CsidState,
} from "@/lib/sim-engine/scenarios/srv6Csid";
import { fmtIpv6 } from "@/lib/sim-engine/scenarios/srv6Foundations";
import { PE2_DT4_SID } from "@/lib/sim-engine/scenarios/srv6L3vpn";
import { GraphTopologyViewer } from "@/components/network/GraphTopologyViewer";
import { GraphPacket } from "@/components/network/GraphPacket";
import { PacketInspector } from "@/components/network/PacketInspector";
import { PacketJourneyTimeline } from "@/components/protocol/PacketJourneyTimeline";
import { SegmentRoutingHeaderViewer, type SegmentRoutingHeaderData } from "@/components/protocol/SegmentRoutingHeaderViewer";
import { CsidContainerViewer, type CsidContainerData } from "@/components/protocol/CsidContainerViewer";
import { Srv6CompressionMetricsViewer } from "@/components/protocol/Srv6CompressionMetricsViewer";
import { CsidFlavorComparisonViewer } from "@/components/protocol/CsidFlavorComparisonViewer";
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
import {
  animatedHopFor,
  containerStateRows,
  deviceForStep,
  interfacesFor,
  ipv6RoutesFor,
  isReplacePhase,
  linkDetailFor,
  localSidsFor,
  packetFramesFor,
  packetLocationFor,
  phasePacketFor,
  physicalLinkIdsFor,
  physicalPathFor,
  pipelineTitleFor,
  PRIMARY_TRANSITION,
  traceFor,
  walkFor,
} from "./deviceTrace";

const DEVICE_ROUTERS: RouterId[] = [...ALL_ROUTERS];
type TopoView = "physical" | "packet";

const WHY_CSID: { q: string; a: string }[] = [
  { q: "WHAT does compression change?", a: "Encoding only — how the next SID is determined. The network program's intent never changes." },
  { q: "WHY does it matter?", a: "A long SRv6 program repeats the same Locator-Block and unused padding in every 128-bit segment." },
  { q: "WHEN is it used?", a: "Whenever a run of segments has a known-valid, compression-eligible structure sharing a common Locator-Block." },
  { q: "WITHOUT structure validation?", a: "An invalid/unknown structure could be silently mis-encoded into something that isn't a valid SID at all." },
];

/** Logical-segment counts for the header-efficiency lab (scenario step `header-efficiency-lab`). */
const EFFICIENCY_COUNTS = [1, 2, 3, 5, 6, 8, 10, 15];
const LAB_OWNERS: RouterId[] = ALL_ROUTERS.filter((r) => r !== HEADEND);
/** Payload size used for the modeled MTU comparison (both encodings get the identical payload). */
const MTU_LAB_PAYLOAD_BYTES = 1400;

const MAIN_LADDER_STEPS = new Set(["diagnostic-ladder", "trouble-question", "wrong-repair-metric", "wrong-repair-preference", "wrong-repair-ignore-structure", "repair-challenge", "apply-repair"]);
const CHALLENGE_LADDER_STEPS = new Set(["challenge-diagnose", "challenge-repair", "challenge-verify"]);

function eyeOffsetForFocusTarget(target: FocusTarget3D): [number, number, number] {
  const [sx, sy, sz] = target.size ?? [0.6, 0.3, 0.3];
  const maxDim = Math.max(sx, sy, sz);
  const dist = Math.max(0.55, maxDim * 1.8);
  return [dist * 0.55, dist * 0.5, dist * 0.75];
}

function containerViewerData(entry: CompressedListEntry): CsidContainerData | undefined {
  if (entry.kind === "ORDINARY") return undefined;
  if (entry.kind === "REPLACE_CSID_PACKED") {
    const pairs: [number, number][] = [];
    for (let i = 0; i < entry.hextets.length; i += 2) pairs.push([entry.hextets[i], entry.hextets[i + 1]]);
    return {
      locatorBlockText: LOCATOR_BLOCK_TEXT,
      locatorBlockBits: REPLACE_CSID_LAYOUT.lblBits,
      csidBits: REPLACE_CSID_LAYOUT.lnflBits,
      argumentBits: 0,
      isPackedContainer: true,
      slots: pairs.map((p, i) => ({ value: p[0] === 0 && p[1] === 0 ? "padding" : `${csidHexText(p[0])} / ${csidHexText(p[1])}`, owner: entry.segments[i]?.owner, role: p[0] === 0 && p[1] === 0 ? "padding" : "queued" })),
    };
  }
  if (entry.kind === "REPLACE_CSID_FIRST") {
    return {
      locatorBlockText: LOCATOR_BLOCK_TEXT,
      locatorBlockBits: REPLACE_CSID_LAYOUT.lblBits,
      csidBits: REPLACE_CSID_LAYOUT.lnflBits,
      argumentBits: 128 - REPLACE_CSID_LAYOUT.lblBits - REPLACE_CSID_LAYOUT.lnflBits,
      indexValue: entry.hextets[7],
      slots: [{ value: `${csidHexText(entry.hextets[3])} / ${csidHexText(entry.hextets[4])}`, owner: entry.segments[0]?.owner, role: "active" }],
    };
  }
  const csidSlots = entry.hextets.slice(NEXT_CSID_LAYOUT.lblBits / 16);
  return {
    locatorBlockText: LOCATOR_BLOCK_TEXT,
    locatorBlockBits: NEXT_CSID_LAYOUT.lblBits,
    csidBits: NEXT_CSID_LAYOUT.lnflBits,
    argumentBits: 128 - NEXT_CSID_LAYOUT.lblBits - NEXT_CSID_LAYOUT.lnflBits,
    slots: csidSlots.map((v, i) => ({ value: v === 0 ? "0000 (padding)" : csidHexText(v), owner: entry.segments[i]?.owner, role: v === 0 ? "padding" : i === 0 ? "active" : "queued" })),
  };
}

function srhToViewerData(srh: SegmentRoutingHeader): SegmentRoutingHeaderData {
  return {
    nextHeader: srh.nextHeader,
    hdrExtLen: srh.hdrExtLen,
    routingType: srh.routingType,
    segmentsLeft: srh.segmentsLeft,
    lastEntry: srh.lastEntry,
    flags: srh.flags,
    tag: srh.tag,
    segmentList: srh.segmentList.map((s) => ({ index: s.index, sid: s.isPackedContainer ? `packed: ${s.csidOwners?.join(", ") ?? "?"} (not a valid SID)` : fmtIpv6(s.hextets), label: s.label })),
  };
}

export default function Srv6CsidDemo() {
  const { engine, snapshot } = useScenarioEngine<Srv6CsidState>(createSrv6CsidState(), srv6CsidSteps);
  const [autoPlay, setAutoPlay] = useState(false);
  const [speed, setSpeed] = useState<0.5 | 1 | 2>(1);
  const [topoView, setTopoView] = useState<TopoView>("physical");
  const [viewMode3D, setViewMode3D] = useState(false);
  const [focusRouter, setFocusRouter] = useState<RouterId>("R1");
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
  /** Presentation cursor for HopTimeline inspection (ARCHITECTURE.md §18) — a step INDEX, never passed to engine.goTo(). undefined = live. */
  const [historicalIndex, setHistoricalIndex] = useState<number | undefined>(undefined);
  /** Explicit Hop-vs-Device intent inside Focus Mode — set by the actual gesture, never inferred from data presence. */
  const [inspectorSurface, setInspectorSurface] = useState<InspectorSurface>("hop");
  const completeLesson = useProgressStore((s) => s.completeLesson);
  const recordAnswer = useProgressStore((s) => s.recordAnswer);
  const unlockAchievement = useProgressStore((s) => s.unlockAchievement);
  const awardedRef = useRef(false);

  const { state, currentStep, index, totalSteps, isComplete, lastAnswer, whatChanged, activePacket } = snapshot;
  const canAdvance = engine.canAdvance();
  const stepId = currentStep?.id ?? "";

  // --- Historical-cursor invariant (ARCHITECTURE.md §18) — inspection is only
  // meaningful for a step strictly EARLIER than the live one. Once any live
  // navigation (Previous, progress bar, Step Back, …) reaches or passes the
  // selected step, historical mode ends. The stored cursor is cleared during
  // render (React's "adjust state on prop change" pattern) so it can't
  // resurrect when the lesson later moves forward again; `historicalCursor`
  // is the only value the rest of the page reads.
  if (historicalIndex !== undefined && historicalIndex >= index) setHistoricalIndex(undefined);
  const historicalCursor = historicalIndex !== undefined && historicalIndex < index ? historicalIndex : undefined;

  const isReplaceLab = isReplacePhase(stepId);
  const activePkt = phasePacketFor(state, stepId);
  const activeJourney = isReplaceLab ? state.replaceJourney : state.journey;
  const walkHops = walkFor(state, stepId)?.hops ?? [];
  const packetLocation = packetLocationFor(state, stepId);

  // Physical packet path — never the logical CSID owner sequence.
  const physicalPath = physicalPathFor(state, stepId);
  const physicalRouters = new Set<string>(physicalPath);
  const physicalLinkIds = physicalLinkIdsFor(state, stepId);
  const animatedHop = animatedHopFor(activePacket, state, stepId);

  const nodes = GRAPH_NODES.map((n) => (topoView === "packet" && activePkt && n.id === packetLocation ? { ...n, subLabel: `DA=${fmtIpv6(activePkt.daHextets)}` } : n));
  const edges = GRAPH_EDGES.filter((e) => (e.id !== "R3-R5" && e.id !== "R6-R8") || stepId.startsWith("endx"));
  const activeNodeIds = animatedHop ? [animatedHop.fromId, animatedHop.toId] : [];
  const packetFrom = animatedHop ? nodes.find((n) => n.id === animatedHop.fromId) : undefined;
  const packetTo = animatedHop ? nodes.find((n) => n.id === animatedHop.toId) : undefined;

  const cliCommands = useMemo(() => buildCsidCliCommands(state, focusRouter), [state, focusRouter]);
  const lastHop = walkHops[walkHops.length - 1];

  // --- 3D derived state ---
  const nodes3DBase = useMemo(() => layoutTo3D(GRAPH_NODES), []);
  const nodes3D = nodes3DBase.map((n) => {
    let status: Node3DStatus = "idle";
    if (n.id === selectedNodeId || n.id === enteredDeviceId) status = "selected";
    else if (animatedHop && (n.id === animatedHop.fromId || n.id === animatedHop.toId)) status = "active";
    else if (physicalRouters.has(n.id)) status = "onPath";
    return { ...n, status, badges: n.id === HEADEND ? ["HEADEND"] : undefined };
  });
  const links3D: Link3DData[] = GRAPH_EDGES.map((e) => ({
    ...e,
    active: animatedHop ? (e.a === animatedHop.fromId && e.b === animatedHop.toId) || (e.b === animatedHop.fromId && e.a === animatedHop.toId) : false,
    onPath: physicalLinkIds.has(e.id),
  }));
  const activePacket3D: ActivePacket3D | undefined = activePacket && animatedHop ? { packet: activePacket, fromId: animatedHop.fromId, toId: animatedHop.toId } : undefined;
  const selectedNode3D = nodes3D.find((n) => n.id === selectedNodeId);
  const questionActive = !isComplete && !!currentStep?.question && lastAnswer?.stepId !== currentStep.id;
  const actionPending = !isComplete && !!currentStep?.requiresState && !canAdvance;

  const activeDeviceId = DEVICE_ROUTERS.find((r) => traceFor(r, state, stepId).activeStageId !== undefined);
  const effectiveDeviceId = cameraMode === "device" ? enteredDeviceId : cameraMode === "packetFollow" && autoEnterDevices ? activeDeviceId : undefined;
  const inDeviceMode = !!effectiveDeviceId;
  const deviceTrace = effectiveDeviceId ? traceFor(effectiveDeviceId, state, stepId) : undefined;
  const deviceInterfaces = effectiveDeviceId ? interfacesFor(effectiveDeviceId, state, stepId) : [];
  const devicePacketFrames: PacketStackFrame[] | undefined = effectiveDeviceId ? packetFramesFor(state, stepId, deviceTrace?.activeStageId) : undefined;
  const pipelineTitle = pipelineTitleFor(deviceTrace, stepId);

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

  const followNode3D = cameraMode === "packetFollow" ? nodes3D.find((n) => n.id === (packetLocation ?? animatedHop?.toId)) : selectedNode3D;
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
  const nodeExplanation = explainTargetId ? explainNode(state, explainTargetId as RouterId, stepId) : undefined;
  const xrayPacket = activePacket && animatedHop && (selectedNodeId === animatedHop.fromId || selectedNodeId === animatedHop.toId) ? activePacket : undefined;
  const selectedLinkDetail = selectedLinkId ? linkDetailFor(selectedLinkId, state, stepId, activePacket) : undefined;
  const packetCurrentDeviceLabel = effectiveDeviceId ?? packetLocation ?? activePacket?.from ?? "—";
  const devicePacketForTab = xrayPacket ?? (effectiveDeviceId && packetLocation === effectiveDeviceId ? activePacket : undefined);

  // --- Hop Inspector target — explicit selection wins: selectedNodeId > effectiveDeviceId > activeDeviceId.
  const focusInspectDeviceId = (selectedNodeId ?? effectiveDeviceId ?? activeDeviceId) as RouterId | undefined;
  const focusTrace = focusInspectDeviceId ? traceFor(focusInspectDeviceId, state, stepId) : undefined;
  const focusInterfaces = focusInspectDeviceId ? interfacesFor(focusInspectDeviceId, state, stepId) : undefined;

  // --- HopTimeline — every step with a recorded primary actor, up to the current index.
  const journeyHopEntries = srv6CsidSteps
    .map((s, i) => ({ s, i }))
    .filter(({ s, i }) => i <= index && PRIMARY_TRANSITION[s.id] !== undefined)
    .map(({ s, i }) => {
      const router = PRIMARY_TRANSITION[s.id]!.router;
      return { id: s.id, label: s.label.startsWith(router) ? s.label : `${router}: ${s.label}`, index: i };
    });
  // Chip position of a valid historical selection; -1 falls back to the live entry, never to "no current chip".
  const historicalTimelinePos = historicalCursor !== undefined ? journeyHopEntries.findIndex((h) => h.index === historicalCursor) : -1;

  // --- Historical inspection — ScenarioEngine's own frozen snapshot, never goTo().
  const historicalState = historicalCursor !== undefined ? engine.getStateAt(historicalCursor) : undefined;
  const historicalStep = historicalCursor !== undefined ? srv6CsidSteps[historicalCursor] : undefined;
  const historicalPacket = historicalStep && historicalState ? historicalStep.packet?.(historicalState) : undefined;
  const historicalDeviceId = historicalStep && historicalState ? deviceForStep(historicalStep.id, historicalPacket) : undefined;
  const historicalTrace = historicalDeviceId && historicalState ? traceFor(historicalDeviceId, historicalState, historicalStep!.id) : undefined;
  const historicalInterfaces = historicalDeviceId && historicalState ? interfacesFor(historicalDeviceId, historicalState, historicalStep!.id) : undefined;

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
      if (iface.linkType) fields.push({ label: "Link", value: iface.linkType });
      return { title: iface.name, fields };
    }
    return { title: target.id, fields: [] };
  }

  function handleCameraModeChange(v: CameraMode) {
    setCameraMode(v);
    if (v === "device" && !enteredDeviceId) setEnteredDeviceId(selectedNodeId ?? activeDeviceId ?? HEADEND);
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

  // --- Device Explorer tabs (live state only — disabled during historical inspection).
  const structures = liveStructures(state);
  const explorerRouter = effectiveDeviceId;
  const deviceHop = explorerRouter ? walkHops.filter((h) => h.router === explorerRouter).at(-1) : undefined;
  const commonTabs = (router: RouterId): DeviceExplorerTab[] =>
    nodeExplanation
      ? [
          { id: "overview", label: "Overview", content: <OverviewTab action={nodeExplanation.currentAction} note={nodeExplanation.note} /> },
          { id: "interfaces", label: "Interfaces", content: <InterfaceListTab interfaces={deviceInterfaces} selectedInterfaceId={selectedInterfaceId} onSelectInterface={setSelectedInterfaceId} /> },
          { id: "routes", label: "IPv6 Routes", content: <RowsTab rows={ipv6RoutesFor(router, state)} /> },
        ]
      : [];
  const headendTabs: DeviceExplorerTab[] = nodeExplanation
    ? [
        ...commonTabs(HEADEND),
        { id: "structures", label: "SID Structures", content: <RowsTab rows={LAB_OWNERS.map((r) => ({ label: r, value: structures[r] ? `LBL=${structures[r]!.lbl} LNL=${structures[r]!.lnl} FL=${structures[r]!.fl} AL=${structures[r]!.al}` : "unknown" }))} /> },
        { id: "program", label: "Logical Segment List", content: <RowsTab rows={BASE_PROGRAM.map((s) => ({ label: s.id, value: `${s.owner} (${s.behavior})` }))} /> },
        { id: "plan", label: "Compression Plan", content: <RowsTab rows={compressNextCsidRun(BASE_PROGRAM, structures).entries.map((e, i) => ({ label: `Entry ${i}`, value: e.label }))} /> },
        { id: "container", label: "Container State", content: <RowsTab rows={containerStateRows(state, stepId)} /> },
        { id: "packet", label: "Packet", content: devicePacketForTab ? <PacketInspector packet={devicePacketForTab} /> : <p className="text-xs text-pv-text-faint">No packet at this device right now.</p> },
        { id: "cli", label: "CLI", content: <CLIOutputPanel commands={cliCommands} /> },
      ]
    : [];
  const endpointTabs = (router: RouterId): DeviceExplorerTab[] =>
    nodeExplanation
      ? [
          ...commonTabs(router),
          { id: "local-sids", label: "Local SIDs", content: <RowsTab rows={localSidsFor(router)} /> },
          { id: "structure", label: "SID Structure", content: <RowsTab rows={structures[router] ? [{ label: "Locator-Block", value: LOCATOR_BLOCK_TEXT }, { label: "Locator-Node", value: csidHexText(NEXT_CSID_VALUE[router]) }, { label: "LBL", value: String(structures[router]!.lbl) }, { label: "LNL", value: String(structures[router]!.lnl) }, { label: "FL", value: String(structures[router]!.fl) }, { label: "AL", value: String(structures[router]!.al) }] : []} /> },
          {
            id: "processing",
            label: isReplaceLab ? "REPLACE-CSID Processing" : "NEXT-CSID Processing",
            content: <RowsTab rows={deviceHop ? [{ label: "Input DA", value: deviceHop.input }, { label: "Lookup", value: deviceHop.lookup }, { label: "Action", value: deviceHop.action }, { label: "Output DA", value: deviceHop.output }] : []} />,
          },
          { id: "container", label: "Container State", content: <RowsTab rows={containerStateRows(state, stepId)} /> },
          { id: "packet", label: "Packet", content: devicePacketForTab ? <PacketInspector packet={devicePacketForTab} /> : <p className="text-xs text-pv-text-faint">No packet at this device right now.</p> },
          { id: "cli", label: "CLI", content: <CLIOutputPanel commands={cliCommands} /> },
        ]
      : [];
  const explorerTabsFor = (router: RouterId) => (router === HEADEND ? headendTabs : endpointTabs(router));

  const mainDiagnosticLayers: DiagnosticLayer[] = [
    { label: "SR Policy Validity", status: "healthy" },
    { label: "SID Semantic List", status: "healthy" },
    { label: `${state.mainFault.targetRouter} Reachability`, status: "healthy" },
    { label: "NEXT-CSID Capability", status: "healthy" },
    { label: `${state.mainFault.targetRouter} Structure Advertised`, status: "healthy" },
    { label: "LBL / LNFL Non-Zero", status: "healthy" },
    { label: "AL Matches 128-LBL-LNL-FL", status: state.mainFault.active && !state.mainFault.repaired ? "failing" : "healthy" },
    { label: `${state.mainFault.targetRouter} Compressible`, status: state.mainFault.active && !state.mainFault.repaired ? "failing" : "healthy" },
  ];
  const challengeDiagnosticLayers: DiagnosticLayer[] = [
    { label: "SR Policy Validity", status: "healthy" },
    { label: `${state.challengeFault.targetRouter} Reachability`, status: "healthy" },
    { label: "AL Matches 128-LBL-LNL-FL", status: state.challengeFault.active && !state.challengeFault.repaired ? "failing" : "healthy" },
    { label: `${state.challengeFault.targetRouter} Compressible`, status: state.challengeFault.active && !state.challengeFault.repaired ? "failing" : "healthy" },
  ];

  useEffect(() => {
    if (isComplete && !awardedRef.current) {
      awardedRef.current = true;
      completeLesson("srv6-csid", 850);
      unlockAchievement("srv6-compression-engineer");
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
    setAutoPlay(false);
    setCameraMode("overview");
    setEnteredDeviceId(undefined);
    setSelectedNodeId(undefined);
    setSelectedLinkId(undefined);
    setSelectedInterfaceId(undefined);
    setPacketSelected(false);
    setTopoView("physical");
    setViewMode3D(false);
    setFocusMode(false);
    setFocusedObject(undefined);
    setHistoricalIndex(undefined);
    setInspectorSurface("hop");
  };

  const nextLabel = currentStep?.question && !lastAnswer ? "Answer to continue" : currentStep?.requiresState && !canAdvance ? "Apply the correct fix to continue" : "Next Step →";

  // --- Step-anchored lesson panels (shared by the main column and the Focus Mode inspector) ---
  const containerA = compressNextCsidRun(BASE_PROGRAM, structures).entries[0];
  const containerB = compressNextCsidRun(BASE_PROGRAM, structures).entries[1];
  const oneContainerPlan = compressNextCsidRun(BASE_PROGRAM.slice(0, 4), structures);
  const endxPlan = compressNextCsidRun(ENDX_PROGRAM, structures);
  const servicePlan = compressNextCsidRun(BASE_PROGRAM.slice(0, 2), structures);
  const faultPlan = compressNextCsidRun(BASE_PROGRAM, structures);
  const replacePlan = compressReplaceCsidRun(REPLACE_PROGRAM, structures);
  const fullPlan = compressNextCsidRun(BASE_PROGRAM, structures);
  const fullMetrics = calculateCompressionMetrics(BASE_PROGRAM.length, fullPlan);
  const mtuUncompressed = calculateModeledPacketSize(fullMetrics.originalSegmentBytes, true, MTU_LAB_PAYLOAD_BYTES);
  const mtuCompressed = calculateModeledPacketSize(fullMetrics.compressedSegmentBytes, fullMetrics.compressedContainerCount > 1, MTU_LAB_PAYLOAD_BYTES);
  const efficiencyRows = EFFICIENCY_COUNTS.map((n) => {
    const program: LogicalSegment[] = Array.from({ length: n }, (_, i) => ({ id: `H${i + 1}`, owner: LAB_OWNERS[i % LAB_OWNERS.length], behavior: "END" }));
    const plan = compressNextCsidRun(program, structures);
    return { n, metrics: calculateCompressionMetrics(n, plan), hasSrh: plan.entries.length > 1 };
  });

  const flavorRows = [
    { property: "First container", nextCsid: "Fully formed SID + Argument", replaceCsid: "Fully formed SID + Index" },
    { property: "Later containers", nextCsid: "Also fully formed SIDs", replaceCsid: "Packed (not valid SIDs)" },
    { property: "Locator-Block repetition", nextCsid: "Every container", replaceCsid: "First container only" },
    { property: "Active advancement", nextCsid: "Shift Argument", replaceCsid: "Reconstruct from Index" },
    { property: "Index usage", nextCsid: "None", replaceCsid: "Tracks packed position" },
    { property: "Typical CSID size (this lesson)", nextCsid: `${NEXT_CSID_LAYOUT.lnflBits} bits`, replaceCsid: `${REPLACE_CSID_LAYOUT.lnflBits} bits` },
    { property: "Service behavior support", nextCsid: "None", replaceCsid: "End.DX*/End.DT* family" },
    { property: "IPv6 DA validity", nextCsid: "Always a valid SID", replaceCsid: "Always a valid SID" },
  ];

  const containerPanel = (title: string, entry: CompressedListEntry | undefined) => {
    const data = entry ? containerViewerData(entry) : undefined;
    return data ? <CsidContainerViewer key={title} title={title} data={data} /> : null;
  };

  function stepPanelFor(id: string): ReactNode {
    if (id === "compress-first-container") return containerPanel("Container A", containerA);
    if (id === "compress-second-container") return containerPanel("Container B", containerB);
    if (id === "full-srh-two-containers" || id === "mandatory-resend")
      return state.packet?.srh ? (
        <div className="space-y-3">
          {id === "full-srh-two-containers" && containerPanel("Container B", containerB)}
          <SegmentRoutingHeaderViewer activeDa={fmtIpv6(state.packet.daHextets)} srh={srhToViewerData(state.packet.srh)} />
        </div>
      ) : null;
    if (id === "one-container-intro") return containerPanel("Single Container (No SRH)", oneContainerPlan.entries[0]);
    if (id === "endx-setup") return <div className="space-y-3">{endxPlan.entries.map((e, i) => containerPanel(i === 0 ? "Container A (R2..R6, End.X)" : "Container B (R8 only)", e))}</div>;
    if (id === "fault-consequence")
      return (
        <GlassPanel strong className="space-y-3 p-5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-pv-violet">Partial Compression — Live Plan</h3>
          {faultPlan.entries.map((e, i) => (
            <div key={i}>{containerViewerData(e) ? <CsidContainerViewer title={e.label} data={containerViewerData(e)!} /> : <p className="pv-mono rounded-lg border border-pv-warning/40 bg-pv-warning/5 p-2.5 text-xs text-pv-text">{e.label} — {fmtIpv6(e.hextets)}</p>}</div>
          ))}
        </GlassPanel>
      );
    if (MAIN_LADDER_STEPS.has(id)) return <TroubleshootingLayers title={`Diagnostic Ladder — ${state.mainFault.targetRouter}`} layers={mainDiagnosticLayers} />;
    if (CHALLENGE_LADDER_STEPS.has(id)) return <TroubleshootingLayers title={`Diagnostic Ladder — ${state.challengeFault.targetRouter} (Challenge)`} layers={challengeDiagnosticLayers} />;
    if (id === "final-service-sid-experiment")
      return (
        <GlassPanel className="space-y-2 p-4">
          <p className="pv-mono text-xs text-pv-text">Final entry (ordinary, real L3VPN reuse): {PE2_DT4_SID.sidText}</p>
          {containerPanel(servicePlan.entries[0]?.label ?? "Container", servicePlan.entries[0])}
        </GlassPanel>
      );
    if (id === "uncompressed-program" || id === "compression-comparison") return <EncodingComparison metrics={fullMetrics} equivalent={verifyCompressionEquivalence(BASE_PROGRAM, fullPlan)} />;
    if (id === "compression-metrics-viewer") return <Srv6CompressionMetricsViewer data={fullMetrics} />;
    if (id === "mtu-lab")
      return (
        <GlassPanel className="p-4">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-pv-violet">Modeled Encapsulation Size ({MTU_LAB_PAYLOAD_BYTES}B payload)</h3>
          <div className="grid gap-2 text-xs sm:grid-cols-2">
            <SizeCard title={`Uncompressed (${fullMetrics.originalSegmentCount} SIDs)`} size={mtuUncompressed} />
            <SizeCard title={`NEXT-CSID (${fullMetrics.compressedContainerCount} entries)`} size={mtuCompressed} highlight />
          </div>
          <p className="mt-2 text-[11px] text-pv-text-faint">Header overhead only — the physical path MTU and the forwarding path are unchanged.</p>
        </GlassPanel>
      );
    if (id === "header-efficiency-lab") return <EfficiencyTable rows={efficiencyRows} capacity={computeNextCsidCapacity(NEXT_CSID_LAYOUT)} />;
    if (id === "replace-first-container") return containerPanel("First Container (Fully Formed SID)", replacePlan.entries[0]);
    if (id === "replace-packed-containers") return containerPanel("Packed Container", replacePlan.entries[1]);
    if (id === "replace-dt4-execute")
      return (
        <GlassPanel className="p-4">
          <p className="pv-mono text-xs text-pv-text">Decap + IPv4 VRF lookup for {CSID_CUST_HOST} — delivered via End.DT4.</p>
        </GlassPanel>
      );
    if (id === "flavor-comparison") return <CsidFlavorComparisonViewer rows={flavorRows} />;
    return null;
  }
  const stepPanel = stepPanelFor(stepId);

  const requiredActionPanel = currentStep?.requiresState ? (
    <GlassPanel strong className="space-y-3 p-5">
      <p className="text-sm text-pv-text">{currentStep.narrative}</p>
      <Button onClick={() => engine.act({})} disabled={canAdvance}>
        {canAdvance ? "✓ Applied" : stepId === "challenge-verify" ? "Verify Repair" : "Apply Repair"}
      </Button>
    </GlassPanel>
  ) : null;

  const scene = (inFocus: boolean) => (
    <NetworkScene3D
      nodes={nodes3D}
      links={links3D}
      activePacket={inDeviceMode ? undefined : activePacket3D}
      onSelectNode={(id) => {
        setSelectedNodeId(id as RouterId);
        setPacketSelected(false);
        setSelectedLinkId(undefined);
        // An explicit node click asks for that device's live state — never a historical one.
        setInspectorSurface("device");
        setHistoricalIndex(undefined);
      }}
      onSelectLink={(id) => {
        setSelectedLinkId(id);
        if (!inFocus) {
          setSelectedNodeId(undefined);
          setPacketSelected(false);
        }
      }}
      selectedLinkId={selectedLinkId}
      onFocusLink={setFocusedObject}
      onSelectPacket={() => {
        setPacketSelected(true);
        if (!inFocus) setAutoPlay(false);
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
                if (!inFocus) setAutoPlay(false);
              },
              packetSelected,
              pipelineTitle,
              onFocusObject: setFocusedObject,
              focusedObjectId: activeFocusedObject?.id,
            }
          : undefined
      }
    />
  );

  const hopOrDeviceSwitch = (disabled: boolean) =>
    inDeviceMode ? <TopologyModeSwitcher options={[{ value: "hop", label: "Hop" }, { value: "device", label: "Device" }]} value={inspectorSurface} onChange={setInspectorSurface} tone="violet" disabledValues={disabled ? ["device"] : undefined} /> : null;

  const liveHopInspector =
    focusTrace && (focusTrace.activeStageId !== undefined || focusTrace.lookupType || focusTrace.reason) ? (
      <div className="space-y-3">
        {hopOrDeviceSwitch(false)}
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
    ) : null;

  return (
    <div className="mx-auto max-w-7xl px-6 py-10">
      <div className="mb-6">
        <Badge tone="cyan" className="mb-3">
          RFC 9800 · SRv6 COMPRESSED SID (CSID / uSID) · NEXT-CSID + REPLACE-CSID
        </Badge>
        <h1 className="text-2xl font-semibold text-pv-text sm:text-3xl">Compression Changes Encoding. Never Intent.</h1>
        <p className="mt-2 max-w-3xl text-sm text-pv-text-muted">
          The same S1 → S2 → ... → S8 program, folded into one or two 128-bit containers instead of eight independent SIDs — while every
          segment&apos;s meaning, and RFC 8754&apos;s reversed Segment List storage order, stay exactly as they were.
        </p>
      </div>

      <div className="mb-4 grid gap-2 sm:grid-cols-4">
        {WHY_CSID.map((item) => (
          <GlassPanel key={item.q} className="p-3">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-pv-cyan-soft">{item.q}</p>
            <p className="text-[11px] leading-snug text-pv-text-muted">{item.a}</p>
          </GlassPanel>
        ))}
      </div>

      <div className="mb-4 flex gap-1 overflow-x-auto pb-2">
        {srv6CsidSteps.map((step, i) => (
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
        <TopologyModeSwitcher options={[{ value: "physical", label: "Physical" }, { value: "packet", label: "Packet" }]} value={topoView} onChange={setTopoView} />
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
        <div className="space-y-6">
          {viewMode3D ? (
            <>
              <TopologyFrame questionActive={questionActive} onExpand={() => setFocusMode(true)}>
                {focusMode ? (
                  // Focus Mode renders its own full-size scene — no second, hidden WebGL canvas (one-canvas invariant).
                  <div className="h-96 w-full rounded-2xl border border-pv-border bg-pv-bg-elevated sm:h-[28rem]" />
                ) : (
                  scene(false)
                )}
              </TopologyFrame>
              {packetSelected && activePacket && (
                <PacketDetailPanel
                  packet={activePacket}
                  currentDevice={packetCurrentDeviceLabel}
                  direction={physicalPath.length > 1 ? physicalPath.join(" → ") : "R1 → …"}
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
                <DeviceExplorerPanel explanation={nodeExplanation!} tabs={explorerTabsFor(effectiveDeviceId!)} xrayEnabled={deviceXray} onToggleXray={() => setDeviceXray((v) => !v)} onExit={() => { setCameraMode("overview"); setEnteredDeviceId(undefined); }} />
              ) : (
                !packetSelected &&
                !selectedLinkDetail && (
                  <NodeInspectorPanel explanation={nodeExplanation} packet={xrayPacket}>
                    {selectedNodeId && DEVICE_ROUTERS.includes(selectedNodeId) && (
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
              <GraphTopologyViewer nodes={nodes} edges={edges} activeNodeIds={activeNodeIds}>
                {activePacket && packetFrom && packetTo && <GraphPacket packet={activePacket} from={packetFrom} to={packetTo} />}
              </GraphTopologyViewer>
              {lastHop && (
                <GlassPanel className="p-4">
                  <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-pv-text-muted">Forwarding Decision — {lastHop.router}</h4>
                  <p className="pv-mono text-[11px] text-pv-text-muted">In: <span className="text-pv-text">{lastHop.input}</span></p>
                  <p className="pv-mono text-[11px] text-pv-text-muted">Lookup: <span className="text-pv-text">{lastHop.lookup}</span></p>
                  <p className="pv-mono text-[11px] text-pv-text-muted">Action: <span className="text-pv-cyan-soft">{lastHop.action}</span> → <span className="text-pv-text">{lastHop.output}</span></p>
                </GlassPanel>
              )}
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

          {!isComplete && requiredActionPanel}

          {whatChanged.length > 0 && !currentStep?.question && (
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

          {!isComplete && stepPanel}

          {isComplete && (
            <GlassPanel strong glow="success" className="flex flex-col items-center gap-4 p-10 text-center">
              <Badge tone="success">SRv6 Compression Engineer</Badge>
              <h2 className="text-2xl font-semibold text-pv-text">Same Program. Smaller Wire Footprint.</h2>
              <p className="max-w-md text-sm text-pv-text-muted">
                You built RFC 9800 NEXT-CSID and REPLACE-CSID compression end to end: real structure validation, real container
                construction, an intra-container shift that never touches Segments Left, a real container-boundary crossing that
                does, partial compression around one broken structure, and a REPLACE-CSID sequence ending in a real End.DT4 SID.
                +850 XP awarded.
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
                  <button key={s} type="button" onClick={() => setSpeed(s)} className={clsx("rounded-full px-2.5 py-1 text-[10px] font-semibold pv-mono transition-colors", speed === s ? "bg-pv-cyan/15 text-pv-cyan-soft" : "text-pv-text-faint hover:text-pv-text")}>{s}x</button>
                ))}
              </div>
              <Button variant="ghost" size="sm" onClick={handleRestart}>⟲ Restart</Button>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <PacketInspector packet={activePacket} />

          <div className="flex flex-wrap gap-1 rounded-full border border-pv-border p-0.5 w-fit">
            {ALL_ROUTERS.map((r) => (
              <button key={r} type="button" onClick={() => setFocusRouter(r)} className={clsx("rounded-full px-3 py-1 text-[11px] font-semibold pv-mono transition-colors", focusRouter === r ? "bg-pv-cyan/15 text-pv-cyan-soft" : "text-pv-text-faint hover:text-pv-text")}>{r}</button>
            ))}
          </div>

          <GlassPanel className="p-4">
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-pv-text-muted">{focusRouter}</h4>
            {focusRouter === HEADEND ? (
              <p className="text-xs text-pv-text-faint">Headend — validates structures and compresses the logical program.</p>
            ) : (
              <div className="space-y-1 pv-mono text-[11px] text-pv-text-muted">
                <p>Locator-Node: {csidHexText(NEXT_CSID_VALUE[focusRouter])}</p>
                <p>Ordinary SID: {ordinarySidText(focusRouter)}</p>
              </div>
            )}
          </GlassPanel>

          <PacketJourneyTimeline hops={activeJourney} />
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
                <Badge tone="muted">Step {Math.min(index + 1, totalSteps)} / {totalSteps}</Badge>
                <span className="truncate text-xs font-medium text-pv-text">{currentStep?.label ?? (isComplete ? "Complete" : "")}</span>
              </div>
              {questionActive ? (
                <span className="shrink-0 rounded-full border border-pv-warning/40 bg-pv-warning/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-pv-warning">Prediction pending — answer in the panel to continue</span>
              ) : actionPending ? (
                <span className="shrink-0 rounded-full border border-pv-warning/40 bg-pv-warning/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-pv-warning">Repair pending — apply it in the panel to continue</span>
              ) : isComplete ? (
                <span className="shrink-0 rounded-full border border-pv-success/40 bg-pv-success/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-pv-success">Lesson complete — +850 XP</span>
              ) : (
                currentStep?.narrative && (
                  <p className="min-w-0 flex-1 truncate text-[11px] text-pv-text-faint" title={currentStep.narrative}>
                    {currentStep.narrative}
                  </p>
                )
              )}
            </div>
          }
          canvas={<div className="h-full [&>div]:h-full [&>div]:rounded-none [&>div]:border-0">{scene(true)}</div>}
          inspector={
            // An unanswered prediction always wins; once answered it stays visible until the learner explicitly picks a timeline entry.
            questionActive || (!isComplete && currentStep?.question && historicalCursor === undefined) ? (
              <div className="space-y-3">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-pv-cyan-soft">Current Prediction</p>
                <PredictionQuestion question={currentStep!.question!} selectedOptionId={lastAnswer?.stepId === currentStep!.id ? lastAnswer.optionId : undefined} onAnswer={handleAnswer} />
                {(MAIN_LADDER_STEPS.has(stepId) || CHALLENGE_LADDER_STEPS.has(stepId)) && stepPanel}
              </div>
            ) : actionPending ? (
              <div className="space-y-3">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-pv-warning">Required Action</p>
                {requiredActionPanel}
                {stepPanel}
              </div>
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
                  {hopOrDeviceSwitch(false)}
                  <DeviceExplorerPanel explanation={nodeExplanation!} tabs={explorerTabsFor(effectiveDeviceId!)} xrayEnabled={deviceXray} onToggleXray={() => setDeviceXray((v) => !v)} onExit={() => { setCameraMode("overview"); setEnteredDeviceId(undefined); }} />
                </div>
              ) : nodeExplanation ? (
                <NodeInspectorPanel explanation={nodeExplanation} packet={xrayPacket}>
                  {selectedNodeId && (
                    <Button size="sm" onClick={() => { setEnteredDeviceId(selectedNodeId); setCameraMode("device"); }}>
                      Enter Device →
                    </Button>
                  )}
                </NodeInspectorPanel>
              ) : (
                <GlassPanel className="p-4">
                  <p className="text-xs text-pv-text-faint">Select a device, or advance the lesson, to inspect a hop.</p>
                </GlassPanel>
              )
            ) : historicalCursor !== undefined && historicalTrace ? (
              <div className="space-y-3">
                {hopOrDeviceSwitch(true)}
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
            ) : isComplete ? (
              <GlassPanel strong className="space-y-3 p-5 text-center">
                <Badge tone="success">SRv6 Compression Engineer</Badge>
                <p className="text-sm text-pv-text">Lesson complete — +850 XP awarded.</p>
                <Button size="sm" variant="secondary" onClick={handleRestart}>Restart Lesson</Button>
              </GlassPanel>
            ) : stepPanel || liveHopInspector ? (
              <div className="space-y-3">
                {stepPanel}
                {liveHopInspector}
              </div>
            ) : (
              <GlassPanel className="p-4">
                <p className="text-xs text-pv-text-faint">{currentStep?.narrative ?? "Select a device, or advance the lesson, to inspect a hop."}</p>
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
                  setFocusedObject(undefined);
                  setSelectedLinkId(undefined);
                  if (entry.index === index) {
                    setHistoricalIndex(undefined);
                    return;
                  }
                  setHistoricalIndex(entry.index);
                  const histState = engine.getStateAt(entry.index);
                  const histStep = srv6CsidSteps[entry.index];
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
                  setSelectedNodeId(undefined);
                  engine.goTo(Math.max(0, index - 1));
                }}
                onNextHop={() => {
                  setHistoricalIndex(undefined);
                  setInspectorSurface("hop");
                  setSelectedNodeId(undefined);
                  engine.advance();
                }}
                onReset={handleRestart}
                canPrevHop={index > 0}
                canNextHop={canAdvance && !isComplete}
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

type Metrics = ReturnType<typeof calculateCompressionMetrics>;
type ModeledSize = ReturnType<typeof calculateModeledPacketSize>;

/** Side-by-side ENCODING comparison of one logical program — deliberately not a PacketDiff: these are two alternative representations, not successive packet states. */
function EncodingComparison({ metrics, equivalent }: { metrics: Metrics; equivalent: boolean }) {
  return (
    <GlassPanel className="space-y-3 p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-pv-violet">Same Program, Two Encodings</h3>
      <div className="grid gap-2 text-xs sm:grid-cols-2">
        <div className="rounded-lg border border-pv-border p-2.5">
          <p className="mb-1 font-semibold text-pv-text-faint">Uncompressed ({metrics.originalSegmentCount} full SIDs)</p>
          <p className="pv-mono text-pv-text">{metrics.originalSegmentCount} × 16 = {metrics.originalSegmentBytes} bytes</p>
        </div>
        <div className="rounded-lg border border-pv-cyan/40 bg-pv-cyan/5 p-2.5">
          <p className="mb-1 font-semibold text-pv-cyan-soft">NEXT-CSID ({metrics.compressedContainerCount} containers)</p>
          <p className="pv-mono text-pv-text">{metrics.compressedContainerCount} × 16 = {metrics.compressedSegmentBytes} bytes</p>
        </div>
      </div>
      <p className="pv-mono text-[11px] text-pv-text-muted">
        Segment-value storage saved: {metrics.savedBytes} bytes ({metrics.percentageReduction}%). Logical program equivalent after expansion: {equivalent ? "yes" : "NO"}.
      </p>
      <p className="text-[11px] text-pv-text-faint">Encoding/header footprint only — the logical program, topology, and forwarding path are identical.</p>
    </GlassPanel>
  );
}

function SizeCard({ title, size, highlight }: { title: string; size: ModeledSize; highlight?: boolean }) {
  return (
    <div className={clsx("rounded-lg border p-2.5", highlight ? "border-pv-cyan/40 bg-pv-cyan/5" : "border-pv-border")}>
      <p className={clsx("mb-1 font-semibold", highlight ? "text-pv-cyan-soft" : "text-pv-text-faint")}>{title}</p>
      <p className="pv-mono text-pv-text">outer IPv6 {size.outerIpv6Bytes}B + SRH {size.srhBytes}B + payload {size.payloadBytes}B</p>
      <p className="pv-mono text-pv-text">= {size.totalBytes}B total</p>
    </div>
  );
}

function EfficiencyTable({ rows, capacity }: { rows: { n: number; metrics: Metrics; hasSrh: boolean }[]; capacity: number }) {
  return (
    <GlassPanel className="space-y-2 p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-pv-violet">Header Efficiency — capacity K = {capacity} CSIDs per container</h3>
      <div className="overflow-x-auto">
        <table className="w-full pv-mono text-[11px]">
          <thead>
            <tr className="text-left text-pv-text-faint">
              <th className="py-1 pr-2 font-semibold">Logical segments</th>
              <th className="py-1 pr-2 font-semibold">Containers</th>
              <th className="py-1 pr-2 font-semibold">Uncompressed</th>
              <th className="py-1 pr-2 font-semibold">Compressed</th>
              <th className="py-1 font-semibold">SRH</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ n, metrics, hasSrh }) => (
              <tr key={n} className="border-t border-pv-border/60 text-pv-text">
                <td className="py-1 pr-2">{n}</td>
                <td className="py-1 pr-2">{metrics.compressedContainerCount}</td>
                <td className="py-1 pr-2">{metrics.originalSegmentBytes}B</td>
                <td className="py-1 pr-2">{metrics.compressedSegmentBytes}B</td>
                <td className="py-1">{hasSrh ? "yes" : "no (DA only)"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-pv-text-faint">Each row is compressNextCsidRun() over n End segments cycling R2..R8. Logical segment count is not the number of physical routers traversed.</p>
    </GlassPanel>
  );
}
