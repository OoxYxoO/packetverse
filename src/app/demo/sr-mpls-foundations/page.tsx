"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { clsx } from "clsx";
import { useScenarioEngine } from "@/lib/sim-engine/useScenarioEngine";
import {
  GRAPH_EDGES,
  GRAPH_NODES,
  NODE_SID_INDEX,
  R3_R5_ADJ_SID,
  SRGB_END,
  SRGB_START,
  STEP_IDX,
  TERMS,
  buildSegmentList,
  buildSidDatabase,
  buildSrCliCommands,
  computeSrPacketPath,
  createSrMplsState,
  fmtLabel,
  resolveActiveSegment,
  srMplsSteps,
  type RouterId,
  type SegmentSpec,
  type SrMplsState,
} from "@/lib/sim-engine/scenarios/srMplsFoundations";
import { GraphTopologyViewer, type GraphEdge } from "@/components/network/GraphTopologyViewer";
import { GraphPacket } from "@/components/network/GraphPacket";
import { PacketInspector } from "@/components/network/PacketInspector";
import { ForwardingDecisionCard } from "@/components/protocol/ForwardingDecisionCard";
import { PacketJourneyTimeline } from "@/components/protocol/PacketJourneyTimeline";
import { PlaneSplitPanel } from "@/components/protocol/PlaneSplitPanel";
import { SidTableViewer } from "@/components/protocol/SidTableViewer";
import { SegmentListViewer } from "@/components/protocol/SegmentListViewer";
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
import { layoutTo3D } from "@/components/network3d/layout";
import { TopologyFrame } from "@/components/network3d/TopologyFrame";
import { TopologyFocusMode } from "@/components/network3d/TopologyFocusMode";
import { HopInspectorPanel } from "@/components/network3d/HopInspectorPanel";
import { PacketDiffViewer } from "@/components/network3d/PacketDiffViewer";
import { HopTimeline } from "@/components/network3d/HopTimeline";
import { PacketFlowControls, type PlaySpeed } from "@/components/network3d/PacketFlowControls";
import { ObjectFocusPanel } from "@/components/network3d/ObjectFocusPanel";
import type { ActivePacket3D, CameraMode, FocusTarget3D, InspectorSurface, Link3DData, Node3DStatus, PacketStackFrame } from "@/components/network3d/types";
import { explainNode } from "./explain";
import { interfacesFor, linkDetailFor, packetFramesFor, traceFor } from "./deviceTrace";

const DEVICE_ROUTERS: RouterId[] = ["R1", "R2", "R3", "R4", "R5", "R6"];
type TopoView = "physical" | "igp" | "sr";

const WHY_SR: { q: string; a: string }[] = [
  { q: "WHAT IS SR-MPLS?", a: "IGP-distributed instructions (segments) imposed as an MPLS label stack at the headend — no RSVP signaling of an end-to-end LSP." },
  { q: "WHY USE IT?", a: "Steer traffic with a short list of instructions instead of signaling and maintaining per-LSP state hop by hop." },
  { q: "DOES IT REPLACE THE IGP?", a: "No — the IGP still computes reachability and shortest paths. SR extensions ride on top of it." },
  { q: "WITHOUT SR?", a: "LDP just follows the IGP everywhere; RSVP-TE needs PATH/RESV signaling for every engineered LSP." },
];

const REPAIR_OPTIONS = [
  { id: "increase-ospf-metric", label: "Increase the OSPF metric on a link" },
  { id: "change-r6-node-sid", label: "Change R6's Node SID" },
  { id: "add-random-labels", label: "Add more MPLS labels to the stack" },
  { id: "correct-segment-list", label: "Rebuild the list as [R3 Node SID, R3→R5 Adj-SID, R6 Node SID]" },
];
const WRONG_FEEDBACK: Record<string, string> = {
  "increase-ospf-metric": "This doesn't change ownership or scope of the Adjacency SID — the active segment is still owned by R3, not R1.",
  "change-r6-node-sid": "R6's Node SID is working correctly. The failure happens before that segment ever becomes active.",
  "add-random-labels": "Segment order and semantic ownership matter — a longer stack is not automatically valid.",
};

export default function SrMplsFoundationsDemo() {
  const { engine, snapshot } = useScenarioEngine<SrMplsState>(createSrMplsState(), srMplsSteps);
  const [autoPlay, setAutoPlay] = useState(false);
  const [speed, setSpeed] = useState<0.5 | 1 | 2>(1);
  const [topoView, setTopoView] = useState<TopoView>("physical");
  const [viewMode3D, setViewMode3D] = useState(false);
  const [planeView, setPlaneView] = useState<"control" | "data" | "both">("both");
  const [focusRouter, setFocusRouter] = useState<RouterId>("R1");
  const [selectedNodeId, setSelectedNodeId] = useState<RouterId | undefined>(undefined);
  const [cameraMode, setCameraMode] = useState<CameraMode>("overview");
  const [enteredDeviceId, setEnteredDeviceId] = useState<RouterId | undefined>(undefined);
  const [deviceXray, setDeviceXray] = useState(true);
  const [autoEnterDevices, setAutoEnterDevices] = useState(true);
  const [selectedInterfaceId, setSelectedInterfaceId] = useState<string | undefined>(undefined);
  const [selectedLinkId, setSelectedLinkId] = useState<string | undefined>(undefined);
  const [packetSelected, setPacketSelected] = useState(false);
  const [xrayMode, setXrayMode] = useState(true);
  const [labSegments, setLabSegments] = useState<SegmentSpec[]>([{ type: "NODE", target: "R6" }]);
  const [focusMode, setFocusMode] = useState(false);
  const [focusedObject, setFocusedObject] = useState<FocusTarget3D | undefined>(undefined);
  /** Explicit Hop-vs-Device intent inside Focus Mode ("Shared Focus Mode Inspector Fix") — set by the actual gesture (node click → device; timeline/next-hop/Play → hop), never inferred from whether a trace object happens to exist. */
  const [inspectorSurface, setInspectorSurface] = useState<InspectorSurface>("hop");
  /** Presentation cursor for HopTimeline inspection — a ScenarioEngine step INDEX, never mutates the live lesson. undefined = inspecting the current/live hop. */
  const [historicalIndex, setHistoricalIndex] = useState<number | undefined>(undefined);
  const completeLesson = useProgressStore((s) => s.completeLesson);
  const recordAnswer = useProgressStore((s) => s.recordAnswer);
  const unlockAchievement = useProgressStore((s) => s.unlockAchievement);

  const { state, currentStep, index, totalSteps, isComplete, lastAnswer, whatChanged, activePacket } = snapshot;
  const canAdvance = engine.canAdvance();

  // --- Historical-cursor invariant — inspection is only meaningful for a
  // step strictly EARLIER than the live one. Once any live navigation
  // (Previous, progress bar, Step Back, …) reaches or passes the selected
  // step, historical mode ends. The stored cursor is cleared during render
  // (React's "adjust state on prop change" pattern) so it can't resurrect
  // when the lesson later moves forward again; `historicalCursor` is the
  // only value the rest of the page reads. This lesson also resets its
  // journey mid-lesson, so a selection whose chip is no longer in the
  // current journey epoch (live navigation crossed a reset) ends the same
  // way — rewinding back into that epoch later must not resurrect it.
  //
  // HopTimeline data — the current journey epoch, each chip mapped to the
  // ScenarioEngine step that recorded it (see `deriveJourneyTimeline`).
  const journeyHopEntries = deriveJourneyTimeline(engine.getStateAt, index);
  const historicalEntry = historicalIndex !== undefined && historicalIndex < index ? journeyHopEntries.find((h) => h.index === historicalIndex) : undefined;
  if (historicalIndex !== undefined && !historicalEntry) setHistoricalIndex(undefined);
  const historicalCursor = historicalEntry?.index;

  const nodes = useMemo(() => GRAPH_NODES.map((n) => ({ ...n, kind: (n.id === "R1" || n.id === "R6" ? "pe-router" : "p-router") as "pe-router" | "p-router" })), []);
  const activeSegment = resolveActiveSegment(state.segmentList ?? []);
  const journeyPath = state.journey.map((h) => h.router);
  const previewPath = journeyPath.length > 0 ? journeyPath : state.segmentList ? computeSrPacketPath(state.segmentList, state.links) : [];
  const bestPathEdgeIds = linkIdsOnPath(previewPath, state.links);

  const displayNodes = nodes.map((n) => {
    const sid = state.prefixSids.find((p) => p.router === n.id);
    if (topoView === "sr") return { ...n, subLabel: `SID ${sid?.label}` };
    if (topoView === "igp") return { ...n, subLabel: undefined };
    return n;
  });
  const edges: GraphEdge[] = GRAPH_EDGES.map((e) => ({ ...e, state: "full" as const, cost: topoView === "igp" ? state.links.find((l) => l.id === e.id)?.metric : undefined }));
  const activeNodeIds = activePacket ? [activePacket.from, activePacket.to] : [];
  const packetFrom = activePacket ? nodes.find((n) => n.id === activePacket.from) : undefined;
  const packetTo = activePacket ? nodes.find((n) => n.id === activePacket.to) : undefined;

  const showTerms = index >= STEP_IDX.segmentIntro;
  const showSidDb = index >= STEP_IDX.sidDatabaseIntro;
  const showSegmentList = index >= STEP_IDX.segmentListViewerIntro && !!state.segmentList;
  const showViews = index >= STEP_IDX.viewsIntro;
  const showLab = index >= STEP_IDX.segmentLabIntro && index < STEP_IDX.troubleshootingIntro;
  const showTroubleshoot = index >= STEP_IDX.troubleshootingIntro;

  const sidDatabase = useMemo(() => buildSidDatabase(state.prefixSids, state.adjSids, state.links, "R1"), [state.prefixSids, state.adjSids, state.links]);
  const cliCommands = useMemo(() => buildSrCliCommands(state, focusRouter), [state, focusRouter]);
  const lastHop = state.journey[state.journey.length - 1];

  const diagnosticLayers: DiagnosticLayer[] = [
    { label: "Physical Links", status: "healthy" },
    { label: "IGP", status: "healthy" },
    { label: "SR Capability", status: "healthy" },
    { label: "R6 Prefix-SID", status: "healthy" },
    { label: "Node-SID Forwarding", status: "healthy" },
    { label: "Segment List Received", status: state.troubleshooting.started ? "healthy" : "unknown" },
    { label: "Active SID Exists In Domain", status: state.troubleshooting.started ? "healthy" : "unknown" },
    { label: "Active SID Owned By R1", status: state.fault ? "failing" : state.troubleshooting.correctListVerified ? "healthy" : "unknown" },
    { label: "Adj-SID Scope Valid At R1", status: state.fault ? "failing" : state.troubleshooting.correctListVerified ? "healthy" : "unknown" },
    { label: "Segment Execution", status: state.fault ? "failing" : state.troubleshooting.correctListVerified ? "healthy" : "unknown" },
    { label: "Packet Delivery", status: state.fault ? "failing" : state.troubleshooting.correctListVerified ? "healthy" : "unknown" },
  ];

  // --- read-only segment-list lab preview ---
  const labList = useMemo(() => buildSegmentList(labSegments, state.prefixSids, state.adjSids), [labSegments, state.prefixSids, state.adjSids]);
  const labPath = useMemo(() => computeSrPacketPath(labList, state.links), [labList, state.links]);
  const compareList = useMemo(() => buildSegmentList([{ type: "NODE", target: "R3" }, { type: "NODE", target: "R6" }], state.prefixSids, state.adjSids), [state.prefixSids, state.adjSids]);
  const comparePath = useMemo(() => computeSrPacketPath(compareList, state.links), [compareList, state.links]);
  const forceList = useMemo(() => buildSegmentList([{ type: "NODE", target: "R3" }, { type: "ADJ", adjId: R3_R5_ADJ_SID.id }, { type: "NODE", target: "R6" }], state.prefixSids, state.adjSids), [state.prefixSids, state.adjSids]);
  const forcePath = useMemo(() => computeSrPacketPath(forceList, state.links), [forceList, state.links]);

  const PRESETS: { label: string; specs: SegmentSpec[] }[] = [
    { label: "Shortest To R6", specs: [{ type: "NODE", target: "R6" }] },
    { label: "Via R3", specs: [{ type: "NODE", target: "R3" }, { type: "NODE", target: "R6" }] },
    { label: "Force R3→R5", specs: [{ type: "NODE", target: "R3" }, { type: "ADJ", adjId: R3_R5_ADJ_SID.id }, { type: "NODE", target: "R6" }] },
  ];

  // --- 3D derived state ---
  const nodes3DBase = useMemo(() => layoutTo3D(nodes), [nodes]);
  const visitedRouters = new Set(state.journey.map((h) => h.router));
  const nodes3D = nodes3DBase.map((n) => {
    let status: Node3DStatus = "idle";
    if (n.id === selectedNodeId || n.id === enteredDeviceId) status = "selected";
    else if (activePacket && (n.id === activePacket.from || n.id === activePacket.to)) status = "active";
    else if (visitedRouters.has(n.id as RouterId)) status = "onPath";
    const badges = n.id === "R1" ? ["HEADEND"] : n.id === "R6" ? ["DEST"] : n.id === "R3" ? ["OWNS ADJ-SID"] : undefined;
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

  // --- Generic 3D object-focus sub-state (brief: "3D Inspection & Selection
  // UX Pass" §4/§12) — layered ON TOP of `cameraMode`, never a 5th camera
  // mode of its own. Cleared automatically once the object it names is no
  // longer present in current data (e.g. the packet moved past that stage)
  // rather than fighting the learner by staying locked onto something
  // stale; a "link" target is exempt since graph edge ids are static, so
  // it only clears when the learner explicitly backs out or picks another
  // object.
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
  // Wider default framing than a manually-entered "Device" view — Packet
  // Follow's auto-entered device should show the whole conceptual pipeline
  // first (brief §11: "see whole pipeline → choose stage → zoom into
  // stage"), not immediately crop it the way a deliberate "Enter Device"
  // close-up is allowed to.
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

  /** Detail shown in <ObjectFocusPanel> for a focused stage/packetLayer/interface — every field comes straight off data the page already computed (`deviceTrace`, `devicePacketFrames`, `deviceInterfaces`); nothing here is a new protocol computation ("3D Inspection & Selection UX Pass" §7/§8/§9). Link focus reuses the existing `<LinkDetailPanel>` path instead (§10) so it isn't handled here. */
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

  // --- Selection precedence ("3D Inspection & Selection UX Pass" §15) ---
  // Two different targets read from the same underlying click state
  // (`selectedNodeId`/`enteredDeviceId`/`activeDeviceId`), each with its
  // own deterministic, explicit rule — neither "blindly" copies the other:
  //
  // `explainTargetId` (below, feeds NodeInspectorPanel/DeviceExplorerPanel):
  //   effectiveDeviceId > selectedNodeId > followNode3D
  //   `effectiveDeviceId` wins first here because it is ITSELF already an
  //   explicit action once cameraMode is "device" (the learner clicked
  //   "Enter Device →", setting `enteredDeviceId`) — and while auto-following
  //   in "packetFollow" mode, deliberately keeps riding the currently-
  //   processing device rather than freezing on a stale prior node click,
  //   which is the entire point of Auto-Enter Devices. Both branches only
  //   apply while `inDeviceMode` is true, and in that state the 3D scene
  //   renders the device INTERIOR (no other clickable topology node exists
  //   to conflict with it) — so this never actually overrides a same-frame
  //   explicit click.
  //
  // `focusInspectDeviceId` (Hop Inspector, below): explicit selection wins
  //   outright — see its own comment.
  //
  // `activeFocusedObject` (object-focus, above) is a separate axis entirely
  //   and never touches `selectedNodeId` — it can't silently substitute for
  //   either of the above.
  const explainTargetId = (effectiveDeviceId ?? selectedNodeId ?? followNode3D?.id) as RouterId | undefined;
  const nodeExplanation = explainTargetId ? explainNode(state, explainTargetId, currentStep?.id ?? "") : undefined;
  const xrayPacket = activePacket && (selectedNodeId === activePacket.from || selectedNodeId === activePacket.to) ? activePacket : undefined;
  const selectedLinkDetail = selectedLinkId ? linkDetailFor(selectedLinkId, state) : undefined;
  const packetCurrentDeviceLabel = effectiveDeviceId ?? state.packetAt ?? activePacket?.from ?? "—";
  const packetDirection = previewPath.length ? previewPath.join(" → ") : "—";
  const devicePacketForTab = xrayPacket ?? (effectiveDeviceId && state.packetAt === effectiveDeviceId ? activePacket : undefined);

  // --- Question Context Mode (brief §9/§10) — true while a prediction
  // question is the current step and unanswered, so the topology
  // viewport goes sticky/compact instead of scrolling out of view.
  const questionActive = !isComplete && !!currentStep?.question && lastAnswer?.stepId !== currentStep.id;

  // --- Live Hop Inspector target — reuses the SAME selectedNodeId/
  // effectiveDeviceId/activeDeviceId state the rest of the page already
  // computes (brief §10: "Do not duplicate ScenarioEngine state").
  //
  // Deterministic precedence ("3D Inspection & Selection UX Pass" §3/§14/§15):
  //   selectedNodeId > effectiveDeviceId > activeDeviceId
  // `selectedNodeId` is set by explicit learner gestures — clicking a 3D
  // node, clicking a HopTimeline entry, or clicking the Hop Inspector's
  // "Go to next hop" CTA — and always wins, so a direct node click can
  // never be silently overridden by the current processing device or by
  // "there happens to be a next hop." A HopTimeline entry for an earlier
  // step is inspected through `historicalCursor` below instead, never
  // through this live-state trace.
  const focusInspectDeviceId = (selectedNodeId ?? effectiveDeviceId ?? activeDeviceId) as RouterId | undefined;
  const focusTrace = focusInspectDeviceId ? traceFor(focusInspectDeviceId, state) : undefined;
  const focusInterfaces = focusInspectDeviceId ? interfacesFor(focusInspectDeviceId, state) : undefined;

  // Chip position of a valid historical selection; -1 falls back to the live entry, never to "no current chip".
  const historicalTimelinePos = historicalCursor !== undefined ? journeyHopEntries.findIndex((h) => h.index === historicalCursor) : -1;

  // --- Historical inspection — reuses ScenarioEngine's OWN `stateByIndex`
  // snapshot (exposed via `getStateAt`). Presentation-only — never calls
  // `engine.goTo()`. The device is the exact JourneyHop router the chip
  // recorded, and `traceFor`/`interfacesFor` run unmodified against the
  // frozen SrMplsState: inside that snapshot the selected hop is still the
  // latest hop at its router, and prev/next routers come from the journey
  // as it stood at that moment, never from a later hop or journey epoch.
  const historicalState = historicalCursor !== undefined ? engine.getStateAt(historicalCursor) : undefined;
  const historicalStep = historicalCursor !== undefined ? srMplsSteps[historicalCursor] : undefined;
  const historicalDeviceId = historicalEntry?.router;
  const historicalTrace = historicalDeviceId && historicalState ? traceFor(historicalDeviceId, historicalState) : undefined;
  const historicalInterfaces = historicalDeviceId && historicalState ? interfacesFor(historicalDeviceId, historicalState) : undefined;

  // --- Shared camera-mode transition (brief §12) — used by BOTH the normal
  // toolbar's switcher and Focus Mode's, and by "Follow Packet" (which is
  // now just this same switch to/from "packetFollow", not a separate
  // boolean) — one place owns the enter/exit side-effects.
  function handleCameraModeChange(v: CameraMode) {
    setCameraMode(v);
    if (v === "device" && !enteredDeviceId) setEnteredDeviceId(selectedNodeId ?? activeDeviceId ?? "R1");
    if (v === "overview") {
      setEnteredDeviceId(undefined);
      setSelectedNodeId(undefined);
    }
    if (v === "freeOrbit") setEnteredDeviceId(undefined);
  }

  // --- Manual object-focus vs. Play Traffic (brief: "3D Inspection &
  // Selection UX Pass" §13/§5) — resuming playback is an explicit request
  // to keep watching the journey move, so it takes priority over a
  // previously-focused stage/layer/interface rather than leaving the
  // camera silently parked on a device the packet has already left.
  // Pausing again does NOT re-focus anything — the learner has to click.
  function handleToggleAutoPlay() {
    if (!autoPlay) {
      setFocusedObject(undefined);
      setInspectorSurface("hop");
      setHistoricalIndex(undefined);
    }
    setAutoPlay((v) => !v);
  }

  // --- In-scene "current device" callout (brief §14) — reuses the exact
  // same `traceFor()` data the Hop Inspector already renders, so it can
  // never show anything not already safely revealed by real journey data
  // (no separate/duplicate computation, no way to leak a future hop).
  const calloutTrace = activeDeviceId ? traceFor(activeDeviceId, state) : undefined;
  const calloutNode3D = activeDeviceId ? nodes3D.find((n) => n.id === activeDeviceId) : undefined;
  const calloutLines = calloutTrace
    ? ([calloutTrace.lookupType, calloutTrace.lookupResult ?? calloutTrace.forwardingAction, calloutTrace.nextHopLabel ? `out → ${calloutTrace.nextHopLabel}` : undefined].filter(Boolean) as string[])
    : [];
  const sceneCallout =
    !inDeviceMode && calloutNode3D && calloutLines.length > 0
      ? { position: [calloutNode3D.position[0], calloutNode3D.position[1] + 0.95, calloutNode3D.position[2]] as [number, number, number], title: activeDeviceId as string, lines: calloutLines }
      : undefined;

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
            <div key={l.id} className="flex justify-between">
              <span className="text-pv-text-faint">{l.id}</span>
              <span className="text-pv-text">metric {l.metric}</span>
            </div>
          ))}
        </div>
      ),
    };
    const srgbTab: DeviceExplorerTab = {
      id: "srgb",
      label: "SRGB",
      content: (
        <div className="space-y-1 pv-mono text-[11px]">
          <p className="text-pv-text-faint">
            Range: <span className="text-pv-text">{SRGB_START}-{SRGB_END}</span>
          </p>
          <p className="text-pv-text-faint">
            Index: <span className="text-pv-text">{NODE_SID_INDEX[router]}</span>
          </p>
          <p className="text-pv-text-faint">
            Derived label: <span className="text-pv-cyan-soft">{state.prefixSids.find((p) => p.router === router)?.label}</span>
          </p>
        </div>
      ),
    };
    const sidDbTab: DeviceExplorerTab = { id: "sid-db", label: "SID Database", content: <SidTableViewer rows={buildSidDatabase(state.prefixSids, state.adjSids, state.links, router)} srgb={{ start: SRGB_START, end: SRGB_END }} /> };
    const segListTab: DeviceExplorerTab = { id: "segment-list", label: "Segment List", content: state.segmentList ? <SegmentListViewer segments={state.segmentList} /> : <p className="text-xs text-pv-text-faint">No segment list active.</p> };
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
      content: nodeExplanation.tables?.[0] ? (
        <div className="space-y-0.5 pv-mono text-[11px]">
          {nodeExplanation.tables[0].rows.map((r) => (
            <div key={r.label} className="flex justify-between gap-3">
              <span className="text-pv-text-faint">{r.label}</span>
              <span className="text-pv-text">{r.value}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-pv-text-faint">No SID ownership at this router.</p>
      ),
    };
    const cliTab: DeviceExplorerTab = { id: "cli", label: "CLI", content: <CLIOutputPanel commands={buildSrCliCommands(state, router)} /> };
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

    if (router === "R1") return [overviewTab, hardwareTab, interfacesTab, hopInspectorTab, igpTab, srgbTab, sidDbTab, segListTab, forwardingTab, packetTab, cliTab];
    if (router === "R3") return [overviewTab, hardwareTab, interfacesTab, hopInspectorTab, forwardingTab, sidDbTab, packetTab, cliTab];
    return [overviewTab, hardwareTab, interfacesTab, hopInspectorTab, forwardingTab, packetTab, cliTab];
  }

  useEffect(() => {
    if (isComplete) {
      completeLesson("sr-mpls-foundations", 500);
      unlockAchievement("segment-programmer");
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
    setTopoView("physical");
    setLabSegments([{ type: "NODE", target: "R6" }]);
    setFocusMode(false);
    setFocusedObject(undefined);
    setHistoricalIndex(undefined);
    setInspectorSurface("hop");
  };

  const nextLabel = currentStep?.question && !lastAnswer ? "Answer to continue" : currentStep?.requiresState && !canAdvance ? "Apply the correct fix to continue" : "Next Step →";

  return (
    <div className="mx-auto max-w-7xl px-6 py-10">
      <div className="mb-6">
        <Badge tone="cyan" className="mb-3">
          SR-MPLS FOUNDATIONS · NODE SID · PREFIX SID · ADJACENCY SID · SRGB
        </Badge>
        <h1 className="text-2xl font-semibold text-pv-text sm:text-3xl">Steering MPLS Traffic Without Signaling Every Hop</h1>
        <p className="mt-2 max-w-3xl text-sm text-pv-text-muted">
          A short ordered list of instructions, imposed once as an MPLS label stack — reach a router via the IGP shortest path, or force one
          specific link — without RSVP-style PATH/RESV signaling for every engineered LSP.
        </p>
      </div>

      <div className="mb-4 grid gap-2 sm:grid-cols-4">
        {WHY_SR.map((item) => (
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
        {srMplsSteps.map((step, i) => (
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
            { value: "igp", label: "IGP" },
            { value: "sr", label: "Segment Routing" },
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
        {showViews && <PlaneViewSwitcher value={planeView} onChange={setPlaneView} />}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_400px]">
        {/* MAIN COLUMN */}
        <div className="space-y-6">
          {viewMode3D ? (
            <>
              <TopologyFrame questionActive={questionActive} onExpand={() => setFocusMode(true)}>
                {focusMode ? (
                  // Focus Mode already renders its own full-size <NetworkScene3D> in the
                  // overlay above; keeping this one mounted too would run a second, fully
                  // hidden WebGL canvas (its useFrame loops keep ticking behind the modal)
                  // for no visible benefit — swap in a static placeholder of the exact
                  // same footprint instead, so there's no layout shift on close.
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
                <GraphTopologyViewer nodes={displayNodes} edges={edges} activeNodeIds={activeNodeIds} bestPathEdgeIds={bestPathEdgeIds} onEdgeClick={(id) => setSelectedLinkId(id)}>
                  {activePacket && packetFrom && packetTo && <GraphPacket packet={activePacket} from={packetFrom} to={packetTo} />}
                </GraphTopologyViewer>
              </TopologyFrame>

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

          {showSidDb && !isComplete && <SidTableViewer rows={sidDatabase} srgb={{ start: SRGB_START, end: SRGB_END }} />}

          {showSegmentList && !isComplete && <SegmentListViewer segments={state.segmentList!} />}

          {showLab && !isComplete && (
            <GlassPanel strong className="space-y-3 p-5">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-pv-violet">Segment-List Lab</h3>
              <p className="text-[11px] text-pv-text-muted">Read-only: preview computed against real IGP/SID state, nothing here mutates the lesson.</p>
              <div className="flex flex-wrap gap-2">
                {PRESETS.map((p) => (
                  <button
                    key={p.label}
                    type="button"
                    onClick={() => setLabSegments(p.specs)}
                    className={clsx("rounded-full border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide transition-colors", JSON.stringify(labSegments) === JSON.stringify(p.specs) ? "border-pv-cyan/50 bg-pv-cyan/15 text-pv-cyan-soft" : "border-pv-border text-pv-text-faint hover:text-pv-text")}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <SegmentListViewer title="Lab Segment List" segments={labList} />
              <div className="rounded-lg border border-pv-border p-3 text-xs">
                <p className="mb-1 font-semibold text-pv-text">Previewed physical path</p>
                <p className="pv-mono text-pv-cyan-soft">{labPath.join(" → ")}</p>
              </div>
            </GlassPanel>
          )}

          {index === STEP_IDX.segmentLabIntro && !isComplete && (
            <GlassPanel className="p-5">
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-pv-text-muted">Compare: [R3, R6] vs. [R3, Adj R3→R5, R6]</h4>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-pv-border p-3 text-xs">
                  <p className="mb-1 pv-mono font-semibold text-pv-text">[R3, R6]</p>
                  <p className="pv-mono text-pv-text-muted">{comparePath.join(" → ")}</p>
                  <p className="mt-1 text-[11px] text-pv-text-faint">Leaves R3 via whatever the current shortest path happens to be.</p>
                </div>
                <div className="rounded-lg border border-pv-cyan/40 bg-pv-cyan/5 p-3 text-xs">
                  <p className="mb-1 pv-mono font-semibold text-pv-text">[R3, Adj R3→R5, R6]</p>
                  <p className="pv-mono text-pv-cyan-soft">{forcePath.join(" → ")}</p>
                  <p className="mt-1 text-[11px] text-pv-text-faint">Explicitly forces the R3→R5 link, regardless of the IGP&apos;s opinion.</p>
                </div>
              </div>
            </GlassPanel>
          )}

          {showTroubleshoot && !isComplete && <TroubleshootingLayers title="Diagnostic Ladder" layers={diagnosticLayers} />}

          {showViews && !isComplete && (
            <PlaneSplitPanel
              show={planeView}
              controlTitle="Control Plane — IGP + SID Advertisements"
              controlRows={[
                { label: "IGP topology", value: `${state.links.length} links, costs as shown` },
                { label: "SRGB", value: `${SRGB_START}-${SRGB_END}` },
                { label: "Prefix-SIDs advertised", value: String(state.prefixSids.length) },
                { label: "Local Adj-SIDs (R3)", value: String(state.adjSids.filter((a) => a.owner === "R3").length) },
              ]}
              dataTitle="Data Plane — Current MPLS Packet"
              dataRows={
                state.packet
                  ? [
                      { label: "Location", value: state.packetAt ?? "—" },
                      { label: "Labels on wire", value: state.packet.labels.length ? state.packet.labels.map((l) => fmtLabel(l.value)).join(" / ") : "(none)" },
                      { label: "Active segment", value: activeSegment ? `${activeSegment.type} SID ${activeSegment.sid}` : "—" },
                    ]
                  : [{ label: "Packet", value: "none in flight" }]
              }
            />
          )}

          {isComplete && (
            <GlassPanel strong glow="success" className="flex flex-col items-center gap-4 p-10 text-center">
              <Badge tone="success">Segment Programmer</Badge>
              <h2 className="text-2xl font-semibold text-pv-text">You Programmed The Path</h2>
              <p className="max-w-md text-sm text-pv-text-muted">
                You read the SID database, told a Node SID from an Adjacency SID, understood local scope, built a real segment list, and traced
                it label by label through R3&apos;s owned adjacency all the way to R6. +500 XP awarded.
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
              <TopologyModeSwitcher options={[{ value: "off", label: "2D" }, { value: "on", label: "3D View" }]} value={viewMode3D ? "on" : "off"} onChange={(v) => setViewMode3D(v === "on")} tone="violet" />
              {viewMode3D && (
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
              )}
              {viewMode3D && inDeviceMode && <TopologyModeSwitcher options={[{ value: "off", label: "Exterior" }, { value: "on", label: "X-Ray" }]} value={deviceXray ? "on" : "off"} onChange={(v) => setDeviceXray(v === "on")} tone="violet" />}
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
              {viewMode3D ? (
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
                <GraphTopologyViewer nodes={displayNodes} edges={edges} activeNodeIds={activeNodeIds} bestPathEdgeIds={bestPathEdgeIds} onNodeClick={(id) => setSelectedNodeId(id as RouterId)} onEdgeClick={(id) => setSelectedLinkId(id)}>
                  {activePacket && packetFrom && packetTo && <GraphPacket packet={activePacket} from={packetFrom} to={packetTo} />}
                </GraphTopologyViewer>
              )}
            </div>
          }
          inspector={
            <div className="space-y-3">
              {currentStep?.question ? (
                // Self-contained Focus Mode (brief §1-3): the SAME <PredictionQuestion>
                // + `handleAnswer` (→ engine.answer()) the normal lesson page uses —
                // not a second quiz surface. Prioritized over the Hop Inspector while
                // a question is the current step so OBSERVE→PREDICT→ANSWER→REVEAL
                // never requires leaving Focus Mode.
                <>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-pv-cyan-soft">Current Prediction</p>
                  <PredictionQuestion question={currentStep.question} selectedOptionId={lastAnswer?.stepId === currentStep.id ? lastAnswer.optionId : undefined} onAnswer={handleAnswer} />
                </>
              ) : selectedLinkDetail ? (
                // Link focus (brief §10) reuses the exact same <LinkDetailPanel>
                // the normal page already shows outside Focus Mode — no
                // duplicate link-state logic.
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
                  <NodeInspectorPanel explanation={nodeExplanation} packet={xrayPacket} xrayEnabled={xrayMode} />
                ) : (
                  <GlassPanel className="p-4">
                    <p className="text-xs text-pv-text-faint">Select a device, or advance the lesson, to inspect a hop.</p>
                  </GlassPanel>
                )
              ) : historicalCursor !== undefined && historicalTrace ? (
                // Level 3 historical (timeline) inspection — a frozen snapshot
                // from ScenarioEngine's own `stateByIndex` (via `getStateAt`),
                // never the live `focusTrace`/`state` below. Device Explorer
                // is live-only in this lesson, so the Hop/Device switch is
                // shown disabled rather than letting a historical packet/
                // segment list combine with live CLI/SID/segment-list tabs as
                // though they were the same moment.
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
                <>
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
                      setHistoricalIndex(undefined);
                      if (cameraMode === "device") setEnteredDeviceId(id as RouterId);
                    }}
                  />
                  <PacketDiffViewer before={focusTrace.packetBeforeFrames} after={focusTrace.packetAfterFrames} beforeText={focusTrace.packetBefore} afterText={focusTrace.packetAfter} mutations={focusTrace.mutations} />
                </>
              ) : (
                <GlassPanel className="p-4">
                  <p className="text-xs text-pv-text-faint">Select a device, or advance the lesson, to inspect a hop.</p>
                </GlassPanel>
              )}
            </div>
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
                  // The chip recorded at the live step IS the current hop — inspect it live, not as history.
                  setHistoricalIndex(entry.index === index ? undefined : entry.index);
                  setFocusedObject(undefined);
                  setSelectedNodeId(entry.router);
                  if (cameraMode === "device") setEnteredDeviceId(entry.router);
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
 * distance ("3D Inspection & Selection UX Pass" §5: "use bounding-box /
 * object bounds ... rather than hardcoded camera coordinates"). A link's
 * bounding size includes its full length, so longer links correctly get
 * pulled back further to keep both endpoints in frame.
 */
function eyeOffsetForFocusTarget(target: FocusTarget3D): [number, number, number] {
  const [sx, sy, sz] = target.size ?? [0.6, 0.3, 0.3];
  const maxDim = Math.max(sx, sy, sz);
  const dist = Math.max(0.55, maxDim * 1.8);
  return [dist * 0.55, dist * 0.5, dist * 0.75];
}

interface JourneyTimelineEntry {
  id: string;
  label: string;
  /** ScenarioEngine step index whose run() recorded this hop — the snapshot historical inspection reads. */
  index: number;
  router: RouterId;
  /** Position within the current journey epoch. */
  journeyIndex: number;
}

/**
 * HopTimeline entries for the CURRENT journey epoch, each mapped to the
 * ScenarioEngine step that actually recorded it. Several steps reset
 * `state.journey = []`, so a journey position is NOT a step index; this
 * walks the engine's own per-step snapshots instead. Every appending
 * step spreads the previous array (`[...state.journey, hop]`), so a
 * snapshot whose journey no longer starts with the previous snapshot's
 * exact hop objects began a new epoch — earlier entries are discarded,
 * exactly as the old `state.journey`-only timeline showed them.
 */
function deriveJourneyTimeline(getStateAt: (i: number) => SrMplsState | undefined, liveIndex: number): JourneyTimelineEntry[] {
  let entries: JourneyTimelineEntry[] = [];
  let prev: SrMplsState["journey"] = [];
  for (let i = 0; i <= liveIndex; i++) {
    const journey = getStateAt(i)?.journey;
    if (!journey) continue;
    const continues = journey.length >= prev.length && prev.every((h, k) => journey[k] === h);
    if (!continues) {
      entries = [];
      prev = [];
    }
    for (let k = prev.length; k < journey.length; k++) {
      entries.push({ id: `${journey[k].router}-${k}`, label: journey[k].router, index: i, router: journey[k].router, journeyIndex: k });
    }
    prev = journey;
  }
  return entries;
}

function linkIdsOnPath(path: RouterId[], links: SrMplsState["links"]): string[] {
  const ids: string[] = [];
  for (let i = 0; i < path.length - 1; i++) {
    const l = links.find((x) => (x.a === path[i] && x.b === path[i + 1]) || (x.b === path[i] && x.a === path[i + 1]));
    if (l) ids.push(l.id);
  }
  return ids;
}

function RepairChallenge({ options, attempt, onTry }: { options: { id: string; label: string }[]; attempt?: { choice: string; correct: boolean }; onTry: (choice: string) => void }) {
  return (
    <GlassPanel strong className="p-5">
      <p className="mb-3 text-sm font-medium text-pv-text">Choose the correct repair to restore the R3→R5-forcing segment list:</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((opt) => {
          const isSelected = attempt?.choice === opt.id;
          const isCorrect = opt.id === "correct-segment-list";
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
            <span className="font-semibold">✓ Segment list rebuilt: [R3 Node SID, R3→R5 Adj-SID, R6 Node SID].</span>
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
