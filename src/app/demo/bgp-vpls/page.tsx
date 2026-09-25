"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { clsx } from "clsx";
import { useScenarioEngine } from "@/lib/sim-engine/useScenarioEngine";
import {
  AS_NUMBER,
  BGP_CONTROL_EDGES,
  BGP_CONTROL_NODES,
  CUST_A_RT,
  GRAPH_EDGES,
  GRAPH_NODES,
  LINKS,
  PE_ROUTERS,
  RD_BY_PE,
  ROUTER_LOOPBACK,
  SERVICE_GRAPH_EDGES,
  SERVICE_GRAPH_NODES,
  SERVICE_NAME,
  STEP_IDX,
  TERMS,
  VE_ID_BY_PE,
  VPLS_XP_AWARD,
  bgpVplsSteps,
  buildBgpVplsCliCommands,
  createBgpVplsState,
  deriveVplsDemuxLabel,
  discoveredMembersFor,
  fdbFor,
  formatLabelBlockResult,
  portLabel,
  portsFor,
  pwLabelToward,
  pwUpBetween,
  resolveAttachmentCircuit,
  transportReachable,
  type BgpVplsState,
  type PeRouterId,
  type RouterId,
} from "@/lib/sim-engine/scenarios/bgpVpls";
import { transportLabelFor } from "@/lib/sim-engine/scenarios/mplsVpls";
import { GraphTopologyViewer } from "@/components/network/GraphTopologyViewer";
import { GraphPacketBubble } from "@/components/network/GraphPacketBubble";
import { LessonGuideButton, LessonGuideDialog, type LessonGuideTab } from "@/components/lesson/LessonGuideDialog";
import { MissionBriefingCard, MissionBriefingStrip } from "@/components/lesson/MissionBriefingCard";
import { resolveBriefing } from "@/components/lesson/briefing";
import { bubblePacket } from "@/components/lesson/mplsStack";
import { PROTOCOL_HEX } from "@/components/lesson/packetCallout";
import { floodCopyTitle, frameDstMac, l2vpnCallout } from "@/components/lesson/l2vpnCallout";
import { PacketInspector } from "@/components/network/PacketInspector";
import { ForwardingDecisionCard } from "@/components/protocol/ForwardingDecisionCard";
import { PacketJourneyTimeline } from "@/components/protocol/PacketJourneyTimeline";
import { PlaneSplitPanel } from "@/components/protocol/PlaneSplitPanel";
import { ServiceInstanceViewer } from "@/components/protocol/ServiceInstanceViewer";
import { PseudowireViewer } from "@/components/protocol/PseudowireViewer";
import { BgpVplsNlriViewer } from "@/components/protocol/BgpVplsNlriViewer";
import { BgpUpdateCard } from "@/components/protocol/BgpUpdateCard";
import { EthernetFdbViewer } from "@/components/protocol/EthernetFdbViewer";
import { LfibViewer } from "@/components/protocol/LibLfibViewer";
import { TroubleshootingLayers, type DiagnosticLayer } from "@/components/protocol/TroubleshootingLayers";
import { CLIOutputPanel } from "@/components/protocol/CLIOutputPanel";
import { PredictionQuestion } from "@/components/quiz/PredictionQuestion";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { useProgressStore } from "@/lib/state/useProgressStore";
import { NetworkScene3D, type FloodCopy3D } from "@/components/network3d/NetworkScene3D";
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
import type { PacketVisual } from "@/lib/sim-engine/types";
import { bridgePortsSummary, explainNode } from "./explain";
import { deviceForStep, interfacesFor, isHopStep, linkDetailFor, packetFramesFor, traceFor } from "./deviceTrace";
import { BGP_VPLS_BRIEFING_NOTES, BGP_VPLS_BRIEFING_PHASES } from "./briefing";
import { BGP_VPLS_LESSON_SECTIONS, BgpVplsLessonGuideContent } from "./LessonGuideContent";
import { BGP_VPLS_DEEP_DIVE_SECTIONS, BgpVplsDeepDiveContent } from "./DeepDiveContent";

const GUIDE_TABS: LessonGuideTab[] = [
  { id: "lesson", label: "This Lesson", hint: "PE1–PE3 via RR1 · VE IDs 1–3 · label blocks", sections: BGP_VPLS_LESSON_SECTIONS, content: <BgpVplsLessonGuideContent /> },
  { id: "deep", label: "BGP-VPLS Deep Dive", hint: "RFC 4761 BGP-signaled VPLS in general", sections: BGP_VPLS_DEEP_DIVE_SECTIONS, content: <BgpVplsDeepDiveContent /> },
];
const calloutFor = (p: PacketVisual) => l2vpnCallout(p, { serviceName: "PW" });

const DEVICE_ROUTERS: RouterId[] = ["CE1", "PE1", "P1", "P2", "P3", "PE2", "PE3", "CE2", "CE3", "RR1"];
type TopoView = "physical" | "bgp-control" | "service" | "mac-learning";

const WHY_BGP_VPLS: { q: string; a: string }[] = [
  { q: "WHAT REPLACES TARGETED LDP?", a: "MP-BGP — each PE advertises RD/VE-ID/label-block/RT to a Route Reflector; membership and PW labels come from that, not a per-pair session." },
  { q: "DOES BGP LEARN CUSTOMER MACS?", a: "No. BGP distributes VPLS membership and label-block signaling only — remote MAC learning stays data-plane, exactly like classic VPLS." },
  { q: "IS THIS EVPN?", a: "No — EVPN's own route types carry MAC/IP reachability in the control plane. BGP-VPLS never does." },
  { q: "DOES THE RR CARRY CUSTOMER TRAFFIC?", a: "No — RR1 reflects BGP UPDATEs only. Customer Ethernet frames travel PE-to-PE directly across the MPLS core." },
];

const REPAIR_OPTIONS = [
  { id: "fix-pe3-rt", label: "Correct PE3's import/export Route Target back to 65000:100" },
  { id: "restart-bgp-session", label: "Restart PE3's BGP session to RR1" },
  { id: "configure-targeted-ldp", label: "Configure targeted LDP from PE3 to PE1/PE2 as a fallback" },
  { id: "clear-mac-table", label: "Clear PE3's MAC table" },
];
const WRONG_FEEDBACK: Record<string, string> = {
  "restart-bgp-session": "The session is already Established — that was never the problem. Re-establishment will advertise and import using the exact same incorrect Route Target, changing nothing.",
  "configure-targeted-ldp": "This lesson's VPLS service is BGP-signaled. The missing state is caused by BGP service-membership policy (the RT), not an absent targeted LDP session — adding one wouldn't touch the actual fault at all.",
  "clear-mac-table": "Data-plane MAC relearning cannot create missing BGP VPLS membership or PW state. The FDB was never the problem — the RT import was.",
};

function eyeOffsetForFocusTarget(target: FocusTarget3D): [number, number, number] {
  const [sx, sy, sz] = target.size ?? [0.6, 0.3, 0.3];
  const maxDim = Math.max(sx, sy, sz);
  const dist = Math.max(0.55, maxDim * 1.8);
  return [dist * 0.55, dist * 0.5, dist * 0.75];
}

export default function BgpVplsDemo() {
  const { engine, snapshot } = useScenarioEngine<BgpVplsState>(createBgpVplsState(), bgpVplsSteps);
  const [autoPlay, setAutoPlay] = useState(false);
  const [speed, setSpeed] = useState<0.5 | 1 | 2>(1);
  const [topoView, setTopoView] = useState<TopoView>("physical");
  const [viewMode3D, setViewMode3D] = useState(false);
  const [planeView, setPlaneView] = useState<"control" | "data" | "both">("both");
  const [focusRouter, setFocusRouter] = useState<RouterId>("PE1");
  const [selectedNodeId, setSelectedNodeId] = useState<RouterId | undefined>(undefined);
  const [cameraMode, setCameraMode] = useState<CameraMode>("overview");
  const [enteredDeviceId, setEnteredDeviceId] = useState<RouterId | undefined>(undefined);
  const [deviceXray, setDeviceXray] = useState(true);
  const [autoEnterDevices, setAutoEnterDevices] = useState(true);
  const [selectedInterfaceId, setSelectedInterfaceId] = useState<string | undefined>(undefined);
  const [selectedLinkId, setSelectedLinkId] = useState<string | undefined>(undefined);
  const [selectedFloodCopyId, setSelectedFloodCopyId] = useState<string | undefined>(undefined);
  const [packetSelected, setPacketSelected] = useState(false);
  const [xrayMode, setXrayMode] = useState(true);
  const [focusMode, setFocusMode] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [focusedObject, setFocusedObject] = useState<FocusTarget3D | undefined>(undefined);
  /** Presentation cursor for HopTimeline inspection — a step INDEX, never mutates the live lesson. undefined = inspecting the current/live hop. */
  const [historicalIndex, setHistoricalIndex] = useState<number | undefined>(undefined);
  /** Explicit Hop-vs-Device intent inside Focus Mode — set by the actual gesture, never inferred from data presence. */
  const [inspectorSurface, setInspectorSurface] = useState<InspectorSurface>("hop");
  const [labPe3Rt, setLabPe3Rt] = useState<"65000:100" | "65000:200">("65000:100");
  const [labPe3VeId, setLabPe3VeId] = useState<3 | 7>(3);
  const [labExpandedBlock, setLabExpandedBlock] = useState(false);
  const awardedRef = useRef(false);
  const completeLesson = useProgressStore((s) => s.completeLesson);
  const recordAnswer = useProgressStore((s) => s.recordAnswer);
  const unlockAchievement = useProgressStore((s) => s.unlockAchievement);

  const { state, currentStep, index, totalSteps, isComplete, lastAnswer, whatChanged, activePacket } = snapshot;
  const canAdvance = engine.canAdvance();

  const nodes = useMemo(
    () => GRAPH_NODES.map((n) => ({ ...n, kind: (n.id.startsWith("CE") ? "laptop" : n.id.startsWith("PE") ? "pe-router" : "p-router") as "laptop" | "pe-router" | "p-router" })),
    [],
  );
  const journeyPath = state.journey.map((h) => h.device);
  const displayPath: RouterId[] = journeyPath.length > 0 ? journeyPath : ["CE1", "PE1", "P1", "P2", "P3", "PE2", "PE3", "CE2", "CE3"];
  const bestPathEdgeIds: string[] = displayPath.length > 1 ? LINKS.filter((l) => displayPath.includes(l.a) && displayPath.includes(l.b)).map((l) => l.id) : [];
  const acFor = (r: RouterId) => (PE_ROUTERS.includes(r as PeRouterId) ? resolveAttachmentCircuit(state.acs, r as PeRouterId) : undefined);
  const focusAc = acFor(focusRouter);
  const focusIsPe = PE_ROUTERS.includes(focusRouter as PeRouterId);
  const focusFdb = focusIsPe ? fdbFor(state, focusRouter as PeRouterId) : [];

  // --- visibility gates, keyed off STEP_IDX ---
  const showTerms = index >= STEP_IDX.topologyIntro;
  const showBgpControlIntro = index >= STEP_IDX.bgpControlTopologyIntro && index < STEP_IDX.pe1Advertises;
  const showNlriAnatomy = index >= STEP_IDX.nlriAnatomy && index < STEP_IDX.pe1Advertises;
  const showBgpVplsNlri = index >= STEP_IDX.pe1Advertises && focusIsPe;
  const showLabelBlockViewer = index >= STEP_IDX.labelBlockViewerPe1 && index < STEP_IDX.bgpTableNoMacs;
  const showPwMesh = index >= STEP_IDX.pwMeshUp;
  const showFdb = index >= STEP_IDX.bgpTableNoMacs && focusIsPe;
  const showComparison = index >= STEP_IDX.ldpVsBgpVpls && index < STEP_IDX.labelBlockExpansionIntro;
  const showLabelBlockLab = index >= STEP_IDX.labelBlockExpansionIntro && index < STEP_IDX.withdrawalIntro;
  const showRtLab = index >= STEP_IDX.withdrawalIntro;
  const showTroubleshoot = index >= STEP_IDX.troubleshootingIntro;
  const showViews = index >= STEP_IDX.transportRecapIntro;

  const cliCommands = useMemo(() => buildBgpVplsCliCommands(state, focusRouter), [state, focusRouter]);
  const lastHop = state.journey[state.journey.length - 1];

  const serviceFields = [
    { label: "Type", value: "Ethernet VPLS (BGP-signaled)" },
    { label: "RD", value: focusIsPe ? RD_BY_PE[focusRouter as PeRouterId] : "—" },
    { label: "AC", value: focusAc?.interfaceName ?? "—" },
    { label: "Bridge Ports", value: focusIsPe ? portsFor(state, focusRouter as PeRouterId).map(portLabel).join(", ") || "(none)" : "—" },
  ];

  const lfibEntries = state.journey.filter((h) => h.device === focusRouter).map((h, i) => ({ fec: `${SERVICE_NAME}-${i}`, incomingLabel: h.input, action: h.action, outgoingLabel: h.output, outgoingInterface: undefined }));

  const pwLegStatus = (a: PeRouterId, b: PeRouterId) => (pwUpBetween(state.pwLinks, a, b) ? "healthy" : state.troubleshooting.started ? "failing" : "unknown");
  const diagnosticLayers: DiagnosticLayer[] = [
    { label: "CE1 / CE2 / CE3 ACs", status: state.acs.every((a) => a.up) ? "healthy" : "failing" },
    { label: "IGP", status: state.transport.igpUp ? "healthy" : "unknown" },
    { label: "MPLS Transport", status: state.transport.ldpUp ? "healthy" : "unknown" },
    { label: "PE1 ↔ RR1 BGP", status: state.mpBgpUp ? "healthy" : "unknown" },
    { label: "PE2 ↔ RR1 BGP", status: state.mpBgpUp ? "healthy" : "unknown" },
    { label: "PE3 ↔ RR1 BGP", status: state.mpBgpUp ? "healthy" : "unknown" },
    { label: "L2VPN/VPLS AF", status: state.l2vpnVplsAfUp ? "healthy" : "unknown" },
    { label: "PE1 service RT", status: state.importRtByPe.PE1 === CUST_A_RT ? "healthy" : "failing" },
    { label: "PE2 service RT", status: state.importRtByPe.PE2 === CUST_A_RT ? "healthy" : "failing" },
    { label: "PE3 service RT", status: state.importRtByPe.PE3 === CUST_A_RT ? "healthy" : state.troubleshooting.started ? "failing" : "unknown" },
    { label: "RT membership consistency", status: state.importRtByPe.PE3 === CUST_A_RT ? "healthy" : state.troubleshooting.started ? "failing" : "unknown" },
    { label: "PE1-PE3 service PW", status: pwLegStatus("PE1", "PE3") },
    { label: "PE2-PE3 service PW", status: pwLegStatus("PE2", "PE3") },
  ];

  // --- 3D derived state ---
  const activeNodes3D = topoView === "bgp-control" ? BGP_CONTROL_NODES.map((n) => ({ ...n, kind: (n.id === "RR1" ? "router" : "pe-router") as "router" | "pe-router" })) : nodes;
  const nodes3DBase = useMemo(() => layoutTo3D(activeNodes3D), [activeNodes3D]);
  const visitedRouters = new Set<string>(state.journey.map((h) => h.device));
  const nodes3D = nodes3DBase.map((n) => {
    let status: Node3DStatus = "idle";
    if (n.id === selectedNodeId || n.id === enteredDeviceId) status = "selected";
    else if (activePacket && (n.id === activePacket.from || n.id === activePacket.to)) status = "active";
    else if (visitedRouters.has(n.id as RouterId)) status = "onPath";
    const badges: string[] = [];
    if (n.id === "RR1") badges.push("ROUTE REFLECTOR");
    else if (PE_ROUTERS.includes(n.id as PeRouterId)) badges.push("VPLS BRIDGE");
    return { ...n, status, badges: badges.length ? badges : undefined };
  });
  const activeEdges3D = topoView === "bgp-control" ? BGP_CONTROL_EDGES : GRAPH_EDGES;
  const links3D: Link3DData[] = activeEdges3D.map((e) => ({
    id: e.id,
    a: e.a,
    b: e.b,
    active: activePacket ? (e.a === activePacket.from && e.b === activePacket.to) || (e.b === activePacket.from && e.a === activePacket.to) : false,
    onPath: bestPathEdgeIds.includes(e.id),
  }));
  const activePacket3D: ActivePacket3D | undefined = activePacket && nodes3D.some((n) => n.id === activePacket.from) && nodes3D.some((n) => n.id === activePacket.to) ? { packet: activePacket, fromId: activePacket.from, toId: activePacket.to, callout: calloutFor(activePacket) } : undefined;
  const questionActive = !isComplete && !!currentStep?.question && lastAnswer?.stepId !== currentStep.id;
  // Two mutually-exclusive replication sources reuse the identical FloodCopy3D
  // mechanism (brief §14) — customer BUM flooding and BGP control-plane
  // fan-out (RR1 reflecting to its other clients) never occur at the same
  // time, but neither is ever animated as a fake sequential journey.
  const floodCopies3D: FloodCopy3D[] | undefined = state.floodCopies?.map((fc) => ({ id: fc.id, fromId: fc.fromPe, toId: fc.toPe })) ?? state.bgpFanout?.map((fc) => ({ id: fc.id, fromId: fc.fromId, toId: fc.toId }));
  const floodCopyLabel = (c: { toId: string }) => state.floodCopies ? floodCopyTitle(state.packet?.frame.dstMac ?? frameDstMac(activePacket), c.toId) : `Reflected VPLS NLRI → ${c.toId}`;
  const floodCopiesCallout3D = floodCopies3D?.map((c) => ({ ...c, callout: { title: floodCopyLabel(c), color: state.floodCopies ? PROTOCOL_HEX.MPLS : PROTOCOL_HEX.BGP } }));
  const selectedNode3D = nodes3D.find((n) => n.id === selectedNodeId);

  const activeDeviceId = DEVICE_ROUTERS.find((r) => traceFor(r, state, currentStep?.id ?? "").activeStageId !== undefined);
  const effectiveDeviceId = cameraMode === "device" ? enteredDeviceId : cameraMode === "packetFollow" && autoEnterDevices ? activeDeviceId : undefined;
  const inDeviceMode = !!effectiveDeviceId;
  const deviceTrace = effectiveDeviceId ? traceFor(effectiveDeviceId, state, currentStep?.id ?? "") : undefined;

  const followPacketIntoCurrentDevice = () => {
    if (!packetSelected || cameraMode !== "device") return;
    const snap = engine.getSnapshot();
    const nextDevice = DEVICE_ROUTERS.find((r) => traceFor(r, snap.state, snap.currentStep?.id ?? "").activeStageId !== undefined);
    if (nextDevice) setEnteredDeviceId(nextDevice);
  };

  const deviceInterfaces = effectiveDeviceId ? interfacesFor(effectiveDeviceId, state) : [];
  const devicePacketFrames: PacketStackFrame[] | undefined = effectiveDeviceId ? packetFramesFor(state) : undefined;

  // --- Generic 3D object-focus sub-state — layered ON TOP of `cameraMode`.
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
  const eyeOffset3D: [number, number, number] | undefined = activeFocusedObject
    ? eyeOffsetForFocusTarget(activeFocusedObject)
    : inDeviceMode
      ? deviceXray
        ? [0.6, 2.6, 5.2]
        : [2.1, 1.5, 3.8]
      : undefined;

  const explainTargetId = (effectiveDeviceId ?? selectedNodeId ?? followNode3D?.id) as RouterId | undefined;
  const nodeExplanation = explainTargetId ? explainNode(state, explainTargetId) : undefined;
  const xrayPacket = activePacket && (selectedNodeId === activePacket.from || selectedNodeId === activePacket.to) ? activePacket : undefined;
  const selectedLinkDetail = selectedLinkId ? linkDetailFor(selectedLinkId, state) : undefined;
  const selectedFloodCopy = selectedFloodCopyId ? state.floodCopies?.find((fc) => fc.id === selectedFloodCopyId) : undefined;
  const selectedBgpFanout = selectedFloodCopyId ? state.bgpFanout?.find((fc) => fc.id === selectedFloodCopyId) : undefined;
  const packetCurrentDeviceLabel = effectiveDeviceId ?? state.packetAt ?? activePacket?.from ?? "—";
  const packetDirection = displayPath.join(" → ");
  const devicePacketForTab = xrayPacket ?? (effectiveDeviceId && state.packetAt === effectiveDeviceId ? activePacket : undefined);

  // --- Hop Inspector target — explicit selection wins outright.
  const focusInspectDeviceId = (selectedNodeId ?? effectiveDeviceId ?? activeDeviceId) as RouterId | undefined;
  const focusTrace = focusInspectDeviceId ? traceFor(focusInspectDeviceId, state, currentStep?.id ?? "") : undefined;
  const focusInterfaces = focusInspectDeviceId ? interfacesFor(focusInspectDeviceId, state) : undefined;

  // --- HopTimeline data — every step that either carries a packet (BGP
  // UPDATE or customer frame alike) or is a no-packet BGP/data control-plane
  // step tracked in deviceTrace.ts's `isHopStep`.
  const journeyStepIndices = bgpVplsSteps.map((s, i) => ({ s, i })).filter(({ s, i }) => i <= index && (!!s.packet || isHopStep(s.id)));
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

  // --- Historical inspection — reuses ScenarioEngine's OWN `stateByIndex`
  // snapshot (`getStateAt`). Presentation-only — never calls `engine.goTo()`.
  const historicalState = historicalCursor !== undefined ? engine.getStateAt(historicalCursor) : undefined;
  const historicalStep = historicalCursor !== undefined ? bgpVplsSteps[historicalCursor] : undefined;
  const historicalPacket = historicalStep && historicalState ? historicalStep.packet?.(historicalState) : undefined;
  const historicalDeviceId = historicalStep && historicalState ? deviceForStep(historicalStep.id, historicalPacket) : undefined;
  const historicalTrace = historicalDeviceId && historicalState && historicalStep ? traceFor(historicalDeviceId, historicalState, historicalStep.id) : undefined;
  const historicalInterfaces = historicalDeviceId && historicalState ? interfacesFor(historicalDeviceId, historicalState) : undefined;

  /** Detail shown in <ObjectFocusPanel> for a focused stage/packetLayer/interface. */
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
    if (v === "device" && !enteredDeviceId) setEnteredDeviceId(selectedNodeId ?? activeDeviceId ?? "PE1");
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

    if (router === "RR1") {
      const bgpTab: DeviceExplorerTab = {
        id: "bgp",
        label: "BGP",
        content: (
          <div className="space-y-1 pv-mono text-[11px]">
            <Row label="Router ID" value={ROUTER_LOOPBACK.RR1 ?? "—"} />
            <Row label="AS" value={String(AS_NUMBER)} />
            <Row label="Clients" value={PE_ROUTERS.join(", ")} />
            <Row label="Sessions" value={state.mpBgpUp ? "Established" : "Idle"} />
          </div>
        ),
      };
      const ribTab: DeviceExplorerTab = {
        id: "l2vpn-vpls-rib",
        label: "L2VPN/VPLS RIB",
        content: (
          <div className="space-y-2">
            {PE_ROUTERS.filter((pe) => state.localAdvertisements[pe]).map((pe) => (
              <BgpVplsNlriViewer
                key={pe}
                title={`From ${pe}`}
                fields={{
                  rd: state.localAdvertisements[pe]!.rd,
                  veId: state.localAdvertisements[pe]!.veId,
                  veBlockOffset: state.localAdvertisements[pe]!.block.vbo,
                  veBlockSize: state.localAdvertisements[pe]!.block.vbs,
                  labelBase: state.localAdvertisements[pe]!.block.labelBase,
                  routeTargets: [state.localAdvertisements[pe]!.routeTarget],
                  nextHop: state.localAdvertisements[pe]!.nextHop,
                  layer2Info: `${state.localAdvertisements[pe]!.layer2Info.encapType}, MTU ${state.localAdvertisements[pe]!.layer2Info.mtu}`,
                  sourcePeer: pe,
                }}
              />
            ))}
            {PE_ROUTERS.every((pe) => !state.localAdvertisements[pe]) && <p className="text-xs text-pv-text-faint">No VPLS NLRIs advertised yet.</p>}
          </div>
        ),
      };
      const reflectionTab: DeviceExplorerTab = {
        id: "route-reflection",
        label: "Route Reflection",
        content: <p className="text-xs text-pv-text-muted">RR1 reflects a client-learned VPLS NLRI to every other client — the same reflection rule taught in the BGP Route Reflector lesson, now carrying a VPLS NLRI instead of an IPv4 route. RR1 never becomes a customer data-plane hop.</p>,
      };
      const cliTab: DeviceExplorerTab = { id: "cli", label: "CLI", content: <CLIOutputPanel commands={buildBgpVplsCliCommands(state, "RR1")} /> };
      return [overviewTab, interfacesTab, bgpTab, ribTab, reflectionTab, cliTab];
    }

    const igpTab: DeviceExplorerTab = {
      id: "igp",
      label: "IGP",
      content: (
        <div className="space-y-1.5 pv-mono text-[11px]">
          {LINKS.filter((l) => l.igpMetric !== undefined && (l.a === router || l.b === router)).map((l) => (
            <Row key={l.id} label={l.id} value={`metric ${l.igpMetric}`} />
          ))}
          <Row label="IGP" value={state.transport.igpUp ? "UP" : "DOWN"} />
        </div>
      ),
    };
    const mplsTransportTab: DeviceExplorerTab = { id: "mpls-transport", label: "MPLS Transport", content: <Row label="Transport LSP" value={transportReachable(state.transport) ? "UP" : "DOWN"} /> };

    if (PE_ROUTERS.includes(router as PeRouterId)) {
      const pe = router as PeRouterId;
      const nlri = state.localAdvertisements[pe];
      const bgpTab: DeviceExplorerTab = {
        id: "bgp",
        label: "BGP",
        content: (
          <div className="space-y-1 pv-mono text-[11px]">
            <Row label="Peer" value={ROUTER_LOOPBACK.RR1 ?? "—"} />
            <Row label="State" value={state.mpBgpUp ? "Established" : "Idle"} />
            <Row label="Address Family" value={state.l2vpnVplsAfUp ? "L2VPN/VPLS active" : "not negotiated"} />
          </div>
        ),
      };
      const bgpVplsTab: DeviceExplorerTab = {
        id: "bgp-vpls",
        label: "BGP VPLS",
        content: (
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 pv-mono text-[11px]">
              <span className="text-pv-text-faint">Local RD</span>
              <span className="text-pv-text">{RD_BY_PE[pe]}</span>
              <span className="text-pv-text-faint">Import RT</span>
              <span className="text-pv-text">{state.importRtByPe[pe]}</span>
              <span className="text-pv-text-faint">Export RT</span>
              <span className="text-pv-text">{state.exportRtByPe[pe]}</span>
              <span className="text-pv-text-faint">Local VE ID</span>
              <span className="text-pv-text">{state.veIdByPe[pe]}</span>
              <span className="text-pv-text-faint">Local VBO / VBS</span>
              <span className="text-pv-text">{state.labelBlocksByPe[pe].vbo} / {state.labelBlocksByPe[pe].vbs}</span>
              <span className="text-pv-text-faint">Local Label Base</span>
              <span className="font-semibold text-pv-cyan-soft">{state.labelBlocksByPe[pe].labelBase}</span>
              <span className="text-pv-text-faint">BGP Next Hop</span>
              <span className="text-pv-text">{ROUTER_LOOPBACK[pe] ?? "—"}</span>
            </div>
            <div className="border-t border-pv-border pt-2">
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-pv-text-muted">Imported Remote NLRIs</p>
              {state.importedByPe[pe].length === 0 && <p className="text-[11px] text-pv-text-faint">(none received yet)</p>}
              {state.importedByPe[pe].map((entry, i) => (
                <div key={i} className="flex justify-between gap-2 pv-mono text-[11px]">
                  <span className="text-pv-text-faint">{entry.nlri.originPe} (RD {entry.nlri.rd})</span>
                  <Badge tone={entry.result === "IMPORTED" ? "success" : "danger"}>{entry.result}</Badge>
                </div>
              ))}
            </div>
            {nlri && <BgpVplsNlriViewer title="Local Advertisement" fields={{ rd: nlri.rd, veId: nlri.veId, veBlockOffset: nlri.block.vbo, veBlockSize: nlri.block.vbs, labelBase: nlri.block.labelBase, routeTargets: [nlri.routeTarget], nextHop: nlri.nextHop, layer2Info: `${nlri.layer2Info.encapType}, MTU ${nlri.layer2Info.mtu}`, sourcePeer: pe }} />}
          </div>
        ),
      };
      const labelBlocksTab: DeviceExplorerTab = {
        id: "label-blocks",
        label: "Label Blocks",
        content: (
          <div className="space-y-1.5 pv-mono text-[11px]">
            {PE_ROUTERS.filter((p) => p !== pe).map((remote) => {
              const entries = state.importedByPe[pe].filter((e) => e.nlri.originPe === remote && e.result === "IMPORTED");
              const lookup = entries.length ? deriveVplsDemuxLabel(entries[0].nlri.block, state.veIdByPe[pe]) : undefined;
              return (
                <div key={remote} className="flex justify-between gap-2 border-t border-pv-border pt-1 first:border-t-0 first:pt-0">
                  <span className="text-pv-text-faint">Advertising PE {remote} — block {entries[0]?.nlri.block.vbo ?? "—"}/{entries[0]?.nlri.block.vbs ?? "—"}/{entries[0]?.nlri.block.labelBase ?? "—"}</span>
                  <span className={lookup?.status === "COVERED" ? "text-pv-success" : "text-pv-danger"}>{lookup ? formatLabelBlockResult(lookup) : "not imported"}</span>
                </div>
              );
            })}
          </div>
        ),
      };
      const pseudowireTab: DeviceExplorerTab = {
        id: "pseudowires",
        label: "Pseudowires",
        content: (
          <div className="space-y-3">
            {PE_ROUTERS.filter((p) => p !== pe).map((remote) => (
              <PseudowireViewer
                key={remote}
                title={`${pe}-${remote}`}
                service={SERVICE_NAME}
                pwType="Ethernet"
                pwId={1000 + Number(remote.slice(-1))}
                localPe={pe}
                remotePe={remote}
                localAc={acFor(pe)?.interfaceName ?? "—"}
                remotePeer={ROUTER_LOOPBACK[remote] ?? remote}
                localReceiveLabel={pwLabelToward(state, remote, pe) ?? 0}
                remoteReceiveLabel={pwLabelToward(state, pe, remote)}
                transportState={transportReachable(state.transport) ? "UP" : "DOWN"}
                targetedLdpState={state.mpBgpUp ? "ESTABLISHED" : "IDLE"}
                signalingProtocolLabel="BGP (RFC 4761)"
                pwState={pwUpBetween(state.pwLinks, pe, remote) ? "UP" : "DOWN"}
                mtu={1500}
                controlWord={false}
              />
            ))}
          </div>
        ),
      };
      const fdbTab: DeviceExplorerTab = {
        id: "fdb",
        label: "MAC / FDB",
        content: <EthernetFdbViewer title={pe} rows={fdbFor(state, pe).map((e) => ({ mac: e.mac, portKind: e.port.kind, portPeer: e.port.peer, age: e.age }))} />,
      };
      const forwardingTab: DeviceExplorerTab = {
        id: "forwarding",
        label: "MPLS Forwarding",
        content: (() => {
          const hop = state.journey.filter((h) => h.device === pe).slice(-1)[0];
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
      const cliTab: DeviceExplorerTab = { id: "cli", label: "CLI", content: <CLIOutputPanel commands={buildBgpVplsCliCommands(state, pe)} /> };
      return [overviewTab, hardwareTab, interfacesTab, igpTab, mplsTransportTab, bgpTab, bgpVplsTab, { id: "vpls-service", label: "VPLS Service", content: <ServiceInstanceViewer title={SERVICE_NAME} subtitle={`RD ${RD_BY_PE[pe]} · RT ${CUST_A_RT}`} fields={serviceFields} status={acFor(pe)?.up ? "up" : "down"} /> }, labelBlocksTab, pseudowireTab, fdbTab, forwardingTab, packetTab, cliTab];
    }

    const lfibTab: DeviceExplorerTab = {
      id: "lfib",
      label: "LFIB",
      content: <LfibViewer title={router} entries={state.journey.filter((h) => h.device === router).map((h, i) => ({ fec: `transport-${i}`, incomingLabel: h.input, action: h.action, outgoingLabel: h.output }))} />,
    };
    const packetTab: DeviceExplorerTab = {
      id: "packet",
      label: "Packet",
      content: devicePacketForTab ? <PacketInspector packet={devicePacketForTab} /> : <p className="text-xs text-pv-text-faint">No packet at this device right now.</p>,
    };
    const cliTab: DeviceExplorerTab = { id: "cli", label: "CLI", content: <CLIOutputPanel commands={buildBgpVplsCliCommands(state, router)} /> };
    return [overviewTab, hardwareTab, interfacesTab, igpTab, mplsTransportTab, lfibTab, packetTab, cliTab];
  }

  useEffect(() => {
    if (isComplete && !awardedRef.current) {
      awardedRef.current = true;
      completeLesson("bgp-vpls", VPLS_XP_AWARD);
      unlockAchievement("bgp-vpls-architect");
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
    setSelectedFloodCopyId(undefined);
    setPacketSelected(false);
    setTopoView("physical");
    setAutoPlay(false);
    setFocusedObject(undefined);
    setHistoricalIndex(undefined);
    setInspectorSurface("hop");
    setLabPe3Rt("65000:100");
    setLabPe3VeId(3);
    setLabExpandedBlock(false);
  };

  const nextLabel = currentStep?.question && !lastAnswer ? "Answer to continue" : currentStep?.requiresState && !canAdvance ? "Apply the correct fix to continue" : "Next Step →";

  const activeNodes =
    topoView === "bgp-control"
      ? BGP_CONTROL_NODES.map((n) => ({ ...n, kind: (n.id === "RR1" ? "router" : "pe-router") as "router" | "pe-router" }))
      : topoView === "service" || topoView === "mac-learning"
        ? SERVICE_GRAPH_NODES.map((n) => ({
            ...n,
            kind: (n.id.startsWith("CE") ? "laptop" : "pe-router") as "laptop" | "pe-router",
            subLabel: topoView === "mac-learning" && PE_ROUTERS.includes(n.id as PeRouterId) ? `FDB: ${fdbFor(state, n.id as PeRouterId).length}` : n.subLabel,
          }))
        : nodes;
  const activeEdges = topoView === "bgp-control" ? BGP_CONTROL_EDGES : topoView === "service" || topoView === "mac-learning" ? SERVICE_GRAPH_EDGES : GRAPH_EDGES.map((e) => ({ ...e }));

  // Read-only labs — operate on copied/local state, never the engine's own scenario state.
  const labPe3Import = state.importedByPe.PE1.find((e) => e.nlri.originPe === "PE3");
  const labRtImportResult = labPe3Rt === CUST_A_RT ? "IMPORTED" : "RT_NOT_MATCHED";
  const labBlock = { vbo: 1, vbs: labExpandedBlock ? 8 : 4, labelBase: state.labelBlocksByPe.PE1.labelBase };
  const labLookup = deriveVplsDemuxLabel(labBlock, labPe3VeId);

  const floodCopyInspector = selectedFloodCopy && (
    <GlassPanel strong className="space-y-3 p-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-pv-text">Flood Replica Inspector</h3>
        <button type="button" onClick={() => setSelectedFloodCopyId(undefined)} className="text-xs text-pv-text-faint hover:text-pv-text">
          ✕
        </button>
      </div>
      <p className="text-xs text-pv-text-muted">
        One of {state.floodCopies?.length ?? 0} independent replicas {selectedFloodCopy.fromPe} creates from the single customer frame — {selectedFloodCopy.fromPe} → {selectedFloodCopy.toPe}. This is real, independent Ethernet-frame replication (unknown-unicast/BUM flooding), never a customer MAC advertised or resolved by BGP.
      </p>
      <div className="space-y-1 pv-mono text-[11px]">
        <Row label="PW Label (remote receive label)" value={String(pwLabelToward(state, selectedFloodCopy.toPe as PeRouterId, selectedFloodCopy.fromPe as PeRouterId) ?? "—")} />
        <Row label="Transport Label (first core hop)" value={String(transportLabelFor("P1", selectedFloodCopy.toPe))} />
      </div>
    </GlassPanel>
  );
  const bgpFanoutInspector = selectedBgpFanout && (
    <GlassPanel strong className="space-y-3 p-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-pv-text">BGP Fan-Out Inspector</h3>
        <button type="button" onClick={() => setSelectedFloodCopyId(undefined)} className="text-xs text-pv-text-faint hover:text-pv-text">
          ✕
        </button>
      </div>
      <p className="text-xs text-pv-text-muted">
        One of {state.bgpFanout?.length ?? 0} clients RR1 reflects PE1&apos;s VPLS NLRI to — {selectedBgpFanout.fromId} → {selectedBgpFanout.toId}. This is BGP control-plane fan-out, not a customer data-plane flood — no Ethernet frame exists yet, and RR1 never becomes a data-plane hop.
      </p>
    </GlassPanel>
  );

  const briefing = currentStep ? resolveBriefing(currentStep.id, currentStep.label, BGP_VPLS_BRIEFING_PHASES, BGP_VPLS_BRIEFING_NOTES) : undefined;

  /** 2D is overview-only — leaving 3D exits device mode so the panels match what is shown. */
  function handleView3DChange(on: boolean) {
    setViewMode3D(on);
    if (!on) {
      setCameraMode("overview");
      setEnteredDeviceId(undefined);
      setFocusedObject(undefined);
    }
  }

  const selectNode2D = (id: string) => {
    setSelectedNodeId(id as RouterId);
    setPacketSelected(false);
    setSelectedLinkId(undefined);
    setInspectorSurface("device");
    setHistoricalIndex(undefined);
  };

  // 2D draws replicas on the step that creates them, or while a packet is shown; an earlier flood that lingers in state is not redrawn on explanatory steps.
  const prevState = index > 0 ? engine.getStateAt(index - 1) : undefined;
  const floodIsCurrent = !!floodCopies3D?.length && (!!activePacket || prevState?.floodCopies !== state.floodCopies || prevState?.bgpFanout !== state.bgpFanout);

  const graph2D = (focus?: boolean) => (
    <div className={focus ? "h-full [&>div]:!h-full [&>div]:rounded-none [&>div]:border-0" : undefined}>
      <GraphTopologyViewer nodes={activeNodes} edges={activeEdges.map((e) => ({ ...e, state: "full" as const }))} activeNodeIds={activePacket ? [activePacket.from, activePacket.to] : []} bestPathEdgeIds={topoView === "physical" ? bestPathEdgeIds : activeEdges.map((e) => e.id)} onEdgeClick={(id) => setSelectedLinkId(id)} onNodeClick={focus ? selectNode2D : undefined}>
        {activePacket && activeNodes.find((n) => n.id === activePacket.from) && activeNodes.find((n) => n.id === activePacket.to) && (() => {
          const c = calloutFor(activePacket);
          return <GraphPacketBubble packet={bubblePacket(activePacket, c)} from={activeNodes.find((n) => n.id === activePacket.from)!} to={activeNodes.find((n) => n.id === activePacket.to)!} title={c.title} scope={`${activePacket.from} → ${activePacket.to}`} />;
        })()}
        {floodIsCurrent && floodCopies3D?.map((c) => {
          const f = activeNodes.find((n) => n.id === c.fromId);
          const to = activeNodes.find((n) => n.id === c.toId);
          const proto = state.floodCopies ? ("MPLS" as const) : ("BGP" as const);
          // Copies are drawn from floodCopies themselves, so a flood step with no main packet (e.g. the broadcast flood) still shows every replica.
          return f && to ? <GraphPacketBubble key={c.id} packet={activePacket ? { ...activePacket, id: c.id, protocol: proto } : { id: c.id, protocol: proto, from: c.fromId, to: c.toId, summary: "", layers: [] }} from={f} to={to} compact title={floodCopyLabel(c)} /> : null;
        })}
      </GraphTopologyViewer>
    </div>
  );

  return (
    <div className="mx-auto max-w-7xl px-6 py-10">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <Badge tone="cyan" className="mb-3">
          BGP-SIGNALED VPLS · RFC 4761 · AUTO-DISCOVERY · LABEL BLOCKS
        </Badge>
        <h1 className="text-2xl font-semibold text-pv-text sm:text-3xl">Signal The Virtual LAN With BGP</h1>
        <p className="mt-2 max-w-3xl text-sm text-pv-text-muted">
          Can BGP discover the VPLS members and signal their pseudowires instead of targeted LDP? Yes — MP-BGP over a
          Route Reflector carries an RD, a Route Target, a VE ID, and a label block per PE. But BGP-signaled VPLS is
          not EVPN: BGP never carries a customer MAC address, and the classic Ethernet data plane underneath —
          learning, flooding, split horizon — never changes.
        </p>
      </div>
        <LessonGuideButton onClick={() => setGuideOpen(true)} />
        <LessonGuideDialog open={guideOpen} onClose={() => setGuideOpen(false)} title="BGP-Signaled VPLS" subtitle="AS 65000 · RR1 · RT 65000:100 · VBO 1 / VBS 4" tabs={GUIDE_TABS} />
      </div>

      <div className="mb-4 grid gap-2 sm:grid-cols-4">
        {WHY_BGP_VPLS.map((item) => (
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
        {bgpVplsSteps.map((step, i) => (
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
            { value: "bgp-control", label: "BGP Control" },
            { value: "service", label: "VPLS Service" },
            { value: "mac-learning", label: "MAC Learning" },
          ]}
          value={topoView}
          onChange={setTopoView}
        />
        <TopologyModeSwitcher options={[{ value: "off", label: "2D" }, { value: "on", label: "3D View" }]} value={viewMode3D ? "on" : "off"} onChange={(v) => handleView3DChange(v === "on")} tone="violet" />
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
        {showViews && <PlaneViewSwitcher value={planeView} onChange={setPlaneView} />}
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
                floodCopies={inDeviceMode ? undefined : floodCopiesCallout3D}
                onSelectFloodCopy={setSelectedFloodCopyId}
                selectedFloodCopyId={selectedFloodCopyId}
                onSelectNode={(id) => {
                  setSelectedNodeId(id as RouterId);
                  setPacketSelected(false);
                  setSelectedLinkId(undefined);
                  setSelectedFloodCopyId(undefined);
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
                        pipelineTitle: effectiveDeviceId === "RR1" ? "Conceptual Route Reflection Pipeline" : PE_ROUTERS.includes(effectiveDeviceId as PeRouterId) ? "Conceptual VPLS Bridging Pipeline" : undefined,
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

              {!packetSelected && !selectedLinkDetail && (floodCopyInspector || bgpFanoutInspector)}

              {inDeviceMode && !packetSelected && !selectedLinkDetail && !floodCopyInspector && !bgpFanoutInspector ? (
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
                !selectedLinkDetail &&
                !floodCopyInspector &&
                !bgpFanoutInspector && (
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
              <TopologyFrame questionActive={questionActive} onExpand={() => setFocusMode(true)}>
                {focusMode ? <div className="h-96 w-full rounded-2xl border border-pv-border bg-pv-bg-elevated sm:h-[28rem]" /> : graph2D()}
              </TopologyFrame>


              {selectedLinkId && !lastHop && linkDetailFor(selectedLinkId, state) && <LinkDetailPanel detail={linkDetailFor(selectedLinkId, state)!} onClose={() => setSelectedLinkId(undefined)} />}

              {lastHop && <ForwardingDecisionCard router={lastHop.device} input={lastHop.input} lookup={lastHop.lookup} action={lastHop.action} output={lastHop.output} />}
            </>
          )}

          {!isComplete && currentStep && briefing && (
            <MissionBriefingCard
              stepNumber={index + 1}
              totalSteps={totalSteps}
              title={currentStep.label}
              phase={briefing.phase}
              objective={briefing.objective}
              context={currentStep.narrative}
              doingNow={briefing.doingNow}
              takeaway={briefing.takeaway}
              questionPending={questionActive}
            />
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

          {!isComplete && activePacket?.protocol === "BGP" && (
            <BgpUpdateCard
              title={activePacket.summary}
              from={activePacket.from}
              to={activePacket.to}
              action={activePacket.badge === "WITHDRAW" ? "withdraw" : "announce"}
              fields={activePacket.layers[0]?.fields ?? []}
            />
          )}

          {showBgpControlIntro && !isComplete && (
            <GlassPanel className="p-4">
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-pv-text-muted">BGP Control-Plane Topology</h4>
              <p className="pv-mono text-xs text-pv-cyan-soft">PE1 ─┐ PE2 ─┼── RR1 PE3 ─┘</p>
              <p className="mt-1 text-[11px] text-pv-text-muted">AS {AS_NUMBER}. No PE-to-PE BGP sessions exist — RR1 reflects between all three clients.</p>
            </GlassPanel>
          )}

          {showNlriAnatomy && !isComplete && (
            <GlassPanel strong className="p-4">
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-pv-violet">VPLS BGP NLRI Anatomy</h4>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 pv-mono text-[11px]">
                <span className="text-pv-text-faint">Route Distinguisher</span>
                <span className="text-pv-text">{RD_BY_PE.PE1}</span>
                <span className="text-pv-text-faint">VE ID</span>
                <span className="text-pv-text">{VE_ID_BY_PE.PE1}</span>
                <span className="text-pv-text-faint">VE Block Offset</span>
                <span className="text-pv-text">{state.labelBlocksByPe.PE1.vbo}</span>
                <span className="text-pv-text-faint">VE Block Size</span>
                <span className="text-pv-text">{state.labelBlocksByPe.PE1.vbs}</span>
                <span className="text-pv-text-faint">Label Base</span>
                <span className="font-semibold text-pv-cyan-soft">{state.labelBlocksByPe.PE1.labelBase}</span>
                <span className="text-pv-text-faint">Route Target</span>
                <span className="text-pv-text">{CUST_A_RT}</span>
              </div>
            </GlassPanel>
          )}

          {showBgpVplsNlri && !isComplete && state.localAdvertisements[focusRouter as PeRouterId] && (
            <BgpVplsNlriViewer
              title={`${focusRouter}'s VPLS NLRI`}
              fields={{
                rd: state.localAdvertisements[focusRouter as PeRouterId]!.rd,
                veId: state.localAdvertisements[focusRouter as PeRouterId]!.veId,
                veBlockOffset: state.localAdvertisements[focusRouter as PeRouterId]!.block.vbo,
                veBlockSize: state.localAdvertisements[focusRouter as PeRouterId]!.block.vbs,
                labelBase: state.localAdvertisements[focusRouter as PeRouterId]!.block.labelBase,
                routeTargets: [state.localAdvertisements[focusRouter as PeRouterId]!.routeTarget],
                nextHop: state.localAdvertisements[focusRouter as PeRouterId]!.nextHop,
                layer2Info: `${state.localAdvertisements[focusRouter as PeRouterId]!.layer2Info.encapType}, MTU ${state.localAdvertisements[focusRouter as PeRouterId]!.layer2Info.mtu}`,
                sourcePeer: focusRouter,
              }}
            />
          )}

          {showLabelBlockViewer && !isComplete && (
            <GlassPanel strong className="space-y-2 p-4">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-pv-violet">PE1&apos;s Label Block, Expanded</h4>
              <table className="w-full text-left text-[11px]">
                <thead>
                  <tr className="text-pv-text-faint">
                    <th className="pb-1 font-normal">Remote VE ID</th>
                    <th className="pb-1 font-normal">Label Toward PE1</th>
                  </tr>
                </thead>
                <tbody className="pv-mono text-pv-text">
                  {[1, 2, 3, 4].map((veId) => (
                    <tr key={veId} className={clsx("border-t border-pv-border", (veId === 2 || veId === 3) && "bg-pv-cyan-soft/10")}>
                      <td className="py-1">{veId}</td>
                      <td className="py-1 text-pv-cyan-soft">{formatLabelBlockResult(deriveVplsDemuxLabel(state.labelBlocksByPe.PE1, veId))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-[10px] text-pv-text-faint">Highlighted: PE2 (VE ID 2) and PE3 (VE ID 3) each use their own value from the same block.</p>
            </GlassPanel>
          )}

          {showPwMesh && !isComplete && (
            <div className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-pv-violet">Full-Mesh Pseudowires (BGP-Signaled)</h3>
              {(["PE1-PE2", "PE1-PE3", "PE2-PE3"] as const).map((pairId) => {
                const [a, b] = pairId.split("-") as [PeRouterId, PeRouterId];
                return (
                  <PseudowireViewer
                    key={pairId}
                    title={pairId}
                    service={SERVICE_NAME}
                    pwType="Ethernet"
                    pwId={1000 + Number(b.slice(-1))}
                    localPe={a}
                    remotePe={b}
                    localAc={acFor(a)?.interfaceName ?? "—"}
                    remotePeer={ROUTER_LOOPBACK[b] ?? b}
                    localReceiveLabel={pwLabelToward(state, b, a) ?? 0}
                    remoteReceiveLabel={pwLabelToward(state, a, b)}
                    transportState={transportReachable(state.transport) ? "UP" : "DOWN"}
                    targetedLdpState={state.mpBgpUp ? "ESTABLISHED" : "IDLE"}
                    signalingProtocolLabel="BGP (RFC 4761)"
                    pwState={pwUpBetween(state.pwLinks, a, b) ? "UP" : "DOWN"}
                    mtu={1500}
                    controlWord={false}
                  />
                );
              })}
            </div>
          )}

          {showFdb && !isComplete && <EthernetFdbViewer title={focusRouter} rows={focusFdb.map((e) => ({ mac: e.mac, portKind: e.port.kind, portPeer: e.port.peer, age: e.age }))} />}

          {index >= STEP_IDX.bgpTableNoMacs && focusIsPe && !isComplete && (
            <GlassPanel className="p-3">
              <p className="pv-mono text-[11px] text-pv-text-faint">Bridge ports at {focusRouter}: {bridgePortsSummary(state, focusRouter as PeRouterId)}. Discovered members: {discoveredMembersFor(state, focusRouter as PeRouterId).join(", ") || "(none)"}.</p>
            </GlassPanel>
          )}

          {lfibEntries.length > 0 && !isComplete && index >= STEP_IDX.sendCe1ToCe21 && <LfibViewer title={focusRouter} entries={lfibEntries} />}

          {showComparison && !isComplete && (
            <GlassPanel strong className="p-4">
              <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-pv-violet">LDP VPLS vs. BGP VPLS vs. EVPN</h4>
              <div className="grid grid-cols-1 gap-3 pv-mono text-[11px] sm:grid-cols-3">
                <div className="rounded-lg border border-pv-border p-2.5">
                  <p className="mb-1 font-semibold text-pv-text">LDP VPLS</p>
                  <p className="text-pv-text-faint">Discovery: configured / separate mechanism</p>
                  <p className="text-pv-text-faint">PW signaling: targeted LDP</p>
                  <p className="text-pv-text-faint">MAC reachability: never distributed</p>
                  <p className="text-pv-text-faint">Data-plane learning: yes</p>
                </div>
                <div className="rounded-lg border border-pv-cyan/40 bg-pv-cyan/5 p-2.5">
                  <p className="mb-1 font-semibold text-pv-cyan-soft">BGP VPLS (this lesson)</p>
                  <p className="text-pv-text-faint">Discovery: BGP (RT-based)</p>
                  <p className="text-pv-text-faint">PW signaling: BGP (label blocks)</p>
                  <p className="text-pv-text-faint">MAC reachability: never distributed</p>
                  <p className="text-pv-text-faint">Data-plane learning: yes</p>
                </div>
                <div className="rounded-lg border border-pv-border p-2.5">
                  <p className="mb-1 font-semibold text-pv-text">EVPN</p>
                  <p className="text-pv-text-faint">Discovery: BGP EVPN</p>
                  <p className="text-pv-text-faint">PW signaling: BGP EVPN route types</p>
                  <p className="text-pv-text-faint">MAC reachability: distributed (Type 2)</p>
                  <p className="text-pv-text-faint">Data-plane learning: reduced / suppressed</p>
                </div>
              </div>
            </GlassPanel>
          )}

          {showLabelBlockLab && !isComplete && (
            <GlassPanel strong className="space-y-3 p-5">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-pv-violet">Advanced Lab: Label-Block Coverage</h3>
              <p className="text-[11px] text-pv-text-muted">Read-only preview computed against the real domain functions — nothing here mutates the lesson&apos;s own state.</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-xs">
                  <span className="mb-1 block text-pv-text-faint">PE3 local VE ID</span>
                  <div className="flex gap-1 rounded-full border border-pv-border p-0.5 w-fit">
                    {([3, 7] as const).map((v) => (
                      <button key={v} type="button" onClick={() => setLabPe3VeId(v)} className={clsx("rounded-full px-3 py-1 text-[11px] font-semibold pv-mono", labPe3VeId === v ? "bg-pv-cyan/15 text-pv-cyan-soft" : "text-pv-text-faint")}>
                        {v}
                      </button>
                    ))}
                  </div>
                </label>
                <label className="flex items-center gap-2 text-xs">
                  <input type="checkbox" checked={labExpandedBlock} onChange={(e) => setLabExpandedBlock(e.target.checked)} />
                  <span className="text-pv-text-faint">PE1 advertises the expanded block (VBS 8)</span>
                </label>
              </div>
              <div className="rounded-lg border border-pv-border p-3 pv-mono text-[11px]">
                <Row label="PE1 block" value={`VBO ${labBlock.vbo}, VBS ${labBlock.vbs}, LB ${labBlock.labelBase}`} />
                <Row label={`Label PE3 (VE ID ${labPe3VeId}) uses toward PE1`} value={formatLabelBlockResult(labLookup)} />
              </div>
            </GlassPanel>
          )}

          {showRtLab && !isComplete && (
            <GlassPanel strong className="space-y-3 p-5">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-pv-violet">Advanced Lab: Route Target Import</h3>
              <p className="text-[11px] text-pv-text-muted">Read-only preview: recomputes PE1&apos;s import decision for a hypothetical PE3 RT, without touching the lesson&apos;s own state.</p>
              <div className="flex gap-1 rounded-full border border-pv-border p-0.5 w-fit">
                {(["65000:100", "65000:200"] as const).map((rt) => (
                  <button key={rt} type="button" onClick={() => setLabPe3Rt(rt)} className={clsx("rounded-full px-3 py-1 text-[11px] font-semibold pv-mono", labPe3Rt === rt ? "bg-pv-cyan/15 text-pv-cyan-soft" : "text-pv-text-faint")}>
                    {rt}
                  </button>
                ))}
              </div>
              <div className="rounded-lg border border-pv-border p-3 pv-mono text-[11px]">
                <Row label="PE1 import RT" value={CUST_A_RT} />
                <Row label="Hypothetical PE3 RT" value={labPe3Rt} />
                <Row label="Import result" value={labRtImportResult} />
                <Row label="(actual current PE3→PE1 import)" value={labPe3Import?.result ?? "—"} />
              </div>
            </GlassPanel>
          )}

          {showTroubleshoot && !isComplete && <TroubleshootingLayers title="Diagnostic Ladder" layers={diagnosticLayers} />}

          {showViews && !isComplete && (
            <PlaneSplitPanel
              show={planeView}
              controlTitle="Control Plane — MP-BGP + Route Reflection + VPLS NLRI"
              controlRows={[
                { label: "MP-BGP Sessions", value: state.mpBgpUp ? "Established" : "Idle" },
                { label: "L2VPN/VPLS AF", value: state.l2vpnVplsAfUp ? "active" : "not negotiated" },
                { label: "PE1/PE2/PE3 import RT", value: `${state.importRtByPe.PE1} / ${state.importRtByPe.PE2} / ${state.importRtByPe.PE3}` },
                { label: "PW PE1-PE2/PE1-PE3/PE2-PE3", value: `${pwUpBetween(state.pwLinks, "PE1", "PE2") ? "UP" : "DOWN"} / ${pwUpBetween(state.pwLinks, "PE1", "PE3") ? "UP" : "DOWN"} / ${pwUpBetween(state.pwLinks, "PE2", "PE3") ? "UP" : "DOWN"}` },
              ]}
              dataTitle="Data Plane — Current MPLS Packet"
              dataRows={
                state.packet
                  ? [
                      { label: "Location", value: state.packetAt ?? "—" },
                      { label: "Labels on wire", value: state.packet.labels.length ? state.packet.labels.map((l) => `${l.value} (${l.purpose})`).join(" / ") : "(none — Ethernet only)" },
                      { label: "Last decision", value: state.lastDecision ?? "—" },
                    ]
                  : [{ label: "Packet", value: "none in flight" }]
              }
            />
          )}

          {isComplete && (
            <GlassPanel strong glow="success" className="flex flex-col items-center gap-4 p-10 text-center">
              <Badge tone="success">BGP VPLS Architect</Badge>
              <h2 className="text-2xl font-semibold text-pv-text">You Signaled The Virtual LAN With BGP</h2>
              <p className="max-w-md text-sm text-pv-text-muted">
                You replaced targeted LDP with MP-BGP auto-discovery and RFC 4761 label-block PW signaling over a
                Route Reflector — while proving, frame by frame, that BGP never carried a customer MAC address and
                that the classic VPLS data plane never changed. You diagnosed and repaired a Route Target membership
                mismatch. +{VPLS_XP_AWARD} XP awarded.
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
              <button key={r} type="button" onClick={() => setFocusRouter(r)} className={clsx("rounded-full px-2.5 py-1 text-[11px] font-semibold pv-mono transition-colors", focusRouter === r ? "bg-pv-cyan/15 text-pv-cyan-soft" : "text-pv-text-faint hover:text-pv-text")}>
                {r}
              </button>
            ))}
          </div>

          <PacketJourneyTimeline hops={state.journey.map((h) => ({ router: h.device, action: h.action, output: h.output }))} />
          {state.bgpJourney.length > 0 && (
            <GlassPanel className="p-4">
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-pv-violet">BGP Control-Plane Journey</h4>
              <div className="space-y-1.5">
                {state.bgpJourney.slice(-4).map((h, i) => (
                  <div key={i} className="flex items-center gap-2 text-[11px]">
                    <Badge tone="cyan">{h.device}</Badge>
                    <Badge tone="violet">{h.action}</Badge>
                    <span className="text-pv-text-muted">{h.output}</span>
                  </div>
                ))}
              </div>
            </GlassPanel>
          )}
          <CLIOutputPanel commands={cliCommands} />
        </div>
      </div>

      {focusMode && (
        <TopologyFocusMode
          onClose={() => setFocusMode(false)}
          toolbar={
            <>
              <LessonGuideButton compact onClick={() => setGuideOpen(true)} />
              <TopologyModeSwitcher options={[{ value: "3d", label: "3D" }, { value: "2d", label: "2D" }]} value={viewMode3D ? "3d" : "2d"} onChange={(v) => handleView3DChange(v === "3d")} />
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
            </>
          }
          header={
            currentStep && briefing ? (
              <MissionBriefingStrip stepNumber={index + 1} totalSteps={totalSteps} title={currentStep.label} phase={briefing.phase} objective={briefing.objective} questionPending={questionActive} />
            ) : (
              <span className="text-xs font-semibold text-pv-success">Lesson complete</span>
            )
          }
          canvas={
            !viewMode3D ? (
              graph2D(true)
            ) : (
            <div className="h-full [&>div]:h-full [&>div]:rounded-none [&>div]:border-0">
              <NetworkScene3D
                nodes={nodes3D}
                links={links3D}
                activePacket={inDeviceMode ? undefined : activePacket3D}
                floodCopies={inDeviceMode ? undefined : floodCopiesCallout3D}
                onSelectFloodCopy={setSelectedFloodCopyId}
                selectedFloodCopyId={selectedFloodCopyId}
                onSelectNode={(id) => {
                  setSelectedNodeId(id as RouterId);
                  setPacketSelected(false);
                  setSelectedLinkId(undefined);
                  setSelectedFloodCopyId(undefined);
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
                        pipelineTitle: effectiveDeviceId === "RR1" ? "Conceptual Route Reflection Pipeline" : PE_ROUTERS.includes(effectiveDeviceId as PeRouterId) ? "Conceptual VPLS Bridging Pipeline" : undefined,
                        onFocusObject: setFocusedObject,
                        focusedObjectId: activeFocusedObject?.id,
                      }
                    : undefined
                }
              />
            </div>
            )
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
            ) : selectedLinkDetail ? (
              <LinkDetailPanel
                detail={selectedLinkDetail}
                onClose={() => {
                  setSelectedLinkId(undefined);
                  setFocusedObject(undefined);
                }}
              />
            ) : floodCopyInspector ? (
              floodCopyInspector
            ) : bgpFanoutInspector ? (
              bgpFanoutInspector
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
            ) : historicalCursor !== undefined && historicalTrace ? (
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
                  const histStep = bgpVplsSteps[entry.index];
                  const histPacket: PacketVisual | undefined = histStep && histState ? histStep.packet?.(histState) : undefined;
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
                onToggleView3D={() => handleView3DChange(!viewMode3D)}
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
      <p className="mb-3 text-sm font-medium text-pv-text">Choose the correct repair to restore CE3&apos;s membership in CUST-A-VPLS:</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((opt) => {
          const isSelected = attempt?.choice === opt.id;
          const isCorrect = opt.id === "fix-pe3-rt";
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
            <span className="font-semibold">✓ PE3&apos;s Route Target corrected — membership restored.</span>
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
