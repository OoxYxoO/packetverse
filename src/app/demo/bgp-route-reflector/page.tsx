"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { clsx } from "clsx";
import { useScenarioEngine } from "@/lib/sim-engine/useScenarioEngine";
import type { PacketVisual } from "@/lib/sim-engine/types";
import {
  CHALLENGE_FULLMESH_EDGES,
  CHALLENGE_FULLMESH_NODES,
  CHALLENGE_PES,
  CHALLENGE_TWORR_EDGES,
  CHALLENGE_TWORR_NODES,
  CHALLENGE_TWORR_REGIONS,
  CLUSTER_ID,
  FULLMESH_4_EDGES,
  FULLMESH_4_NODES,
  MAX_RENDERED_MESH_ROUTERS,
  PREFIX,
  ROUTER_IP,
  SCALE_EXAMPLES,
  SINGLE_RR_EDGES,
  SINGLE_RR_NODES,
  SINGLE_RR_REGIONS,
  TERMS,
  TWO_RR_EDGES,
  TWO_RR_EDGES_FAULTY,
  TWO_RR_NODES,
  TWO_RR_REGIONS,
  VPNV4_LABEL,
  VPNV4_PREFIX,
  VPNV4_RD,
  VPNV4_RT,
  buildRrCliCommands,
  connectedRrOf,
  createRrState,
  fullMeshSessionCount,
  isClientOf,
  originAttrsLayerIndex,
  reflectionCandidatesFor,
  relationshipOf,
  rrAttrsLayerIndex,
  rrSessionCount,
  rrSteps,
  scaleMeshGraph,
  type GNode,
  type GRegion,
  type RouterId,
  type RrState,
} from "@/lib/sim-engine/scenarios/bgpRouteReflector";
import { GraphTopologyViewer } from "@/components/network/GraphTopologyViewer";
import { GraphPacket } from "@/components/network/GraphPacket";
import { PacketInspector } from "@/components/network/PacketInspector";
import { RrRouteViewer, type RrRouteRow } from "@/components/protocol/RrRouteViewer";
import { ReflectionDecisionViewer } from "@/components/protocol/ReflectionDecisionViewer";
import { TroubleshootingLayers, type DiagnosticLayer as TsDiagnosticLayer } from "@/components/protocol/TroubleshootingLayers";
import { VpnRouteViewer } from "@/components/protocol/VpnRouteViewer";
import { CLIOutputPanel } from "@/components/protocol/CLIOutputPanel";
import { PredictionQuestion } from "@/components/quiz/PredictionQuestion";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { useProgressStore } from "@/lib/state/useProgressStore";
import { NetworkScene3D, type FloodCopy3D } from "@/components/network3d/NetworkScene3D";
import { NodeInspectorPanel } from "@/components/network3d/NodeInspectorPanel";
import { TopologyModeSwitcher } from "@/components/network3d/TopologyModeSwitcher";
import { DeviceExplorerPanel, InterfaceListTab, type DeviceExplorerTab } from "@/components/network3d/DeviceExplorerPanel";
import { PacketDetailPanel } from "@/components/network3d/PacketDetailPanel";
import { LinkDetailPanel } from "@/components/network3d/LinkDetailPanel";
import { PlaneViewSwitcher, type PlaneView } from "@/components/network3d/PlaneViewSwitcher";
import { TopologyFrame } from "@/components/network3d/TopologyFrame";
import { TopologyFocusMode } from "@/components/network3d/TopologyFocusMode";
import { HopInspectorPanel } from "@/components/network3d/HopInspectorPanel";
import { PacketDiffViewer } from "@/components/network3d/PacketDiffViewer";
import { HopTimeline } from "@/components/network3d/HopTimeline";
import { PacketFlowControls, type PlaySpeed } from "@/components/network3d/PacketFlowControls";
import { ObjectFocusPanel } from "@/components/network3d/ObjectFocusPanel";
import { layoutRegionsTo3D, layoutTo3D } from "@/components/network3d/layout";
import type { ActivePacket3D, CameraMode, FocusTarget3D, InspectorSurface, Link3DData, Node3DStatus } from "@/components/network3d/types";
import { diagnosticLayersFor, explainRouter, floodTargetsForStep, interfacesFor, linkDetailFor, packetFramesFor, traceFor, PRIMARY_TRANSITION_ROUTER } from "./deviceTrace";

const DEVICE_ROUTERS: RouterId[] = ["PE1", "PE2", "PE3", "PE4", "PE5", "PE6", "RR1", "RR2"];

const WHY_RR: { q: string; a: string }[] = [
  { q: "WHAT is a Route Reflector?", a: "An iBGP router permitted to re-advertise routes between its clients — bending the normal iBGP split-horizon rule just for them." },
  { q: "WHY use it?", a: "Full-mesh iBGP doesn't scale — n(n-1)/2 sessions grows explosively. A Route Reflector replaces most of that mesh with hub-and-spoke." },
  { q: "WHEN is it used?", a: "Any provider or enterprise core running iBGP among more than a handful of routers." },
  { q: "WITHOUT it?", a: "Every router needs a direct iBGP session to every other router — or routes silently stop propagating." },
];

const REPAIR_OPTIONS = [
  { id: "restart-session", label: "Restart the RR2 ↔ PE3 BGP session" },
  { id: "remove-rr-peering", label: "Remove the RR1 ↔ RR2 peering" },
  { id: "make-client", label: "Reconfigure PE3 as RR2's route-reflector-client" },
  { id: "change-localpref", label: "Raise PE3's Local Preference" },
];
const WRONG_FEEDBACK: Record<string, string> = {
  "restart-session": "The session is already Established — restarting it won't change the client relationship at all.",
  "remove-rr-peering": "Removing RR1↔RR2 would break route distribution between the two clusters entirely — it makes things worse, not better.",
  "change-localpref": "LOCAL_PREF affects best-path selection between existing candidates. PE3 doesn't have a candidate route at all yet — this doesn't touch reflection policy.",
};
const CHALLENGE_OPTIONS = [
  { id: "no-change", label: "Leave it as a full mesh — just add more capacity" },
  { id: "two-rr-unpeered", label: "RR1 (PE1–PE3 clients) and RR2 (PE4–PE6 clients), with no RR1↔RR2 peering" },
  { id: "two-rr-peered", label: "RR1 (PE1–PE3 clients) and RR2 (PE4–PE6 clients), peered with each other" },
  { id: "single-rr-all", label: "One RR1 serving all 6 PEs as clients, no redundancy" },
];
const CHALLENGE_WRONG_FEEDBACK: Record<string, string> = {
  "no-change": "Session count isn't reduced at all — this doesn't solve the scaling problem.",
  "two-rr-unpeered": "PE1–PE3 and PE4–PE6 would never learn each other's routes — RR1 and RR2 need to peer for routes to cross clusters.",
  "single-rr-all": "This does reduce sessions, but with zero redundancy — the brief calls for RR1 AND RR2. One RR going down would take the whole reflection domain with it.",
};

const introduceRrIndex = rrSteps.findIndex((s) => s.id === "introduce-rr");
const showCalculatorIndex = rrSteps.findIndex((s) => s.id === "show-fullmesh");
const vpnv4Index = rrSteps.findIndex((s) => s.id === "reconnect-l3vpn-intro");
const planesIndex = rrSteps.findIndex((s) => s.id === "control-vs-data-plane");
const troubleshootIndex = rrSteps.findIndex((s) => s.id === "fault-intro");
const challengeIndex = rrSteps.findIndex((s) => s.id === "challenge-intro");

function withKind(nodes: GNode[]): GNode[] {
  return nodes.map((n) => ({ ...n, kind: n.id === "RR1" || n.id === "RR2" ? ("p-router" as const) : ("router" as const) }));
}

export default function BgpRouteReflectorDemo() {
  const { engine, snapshot } = useScenarioEngine<RrState>(createRrState(), rrSteps);
  const [autoPlay, setAutoPlay] = useState(false);
  const [speed, setSpeed] = useState<0.5 | 1 | 2>(1);
  const [viewMode, setViewMode] = useState<"physical" | "logical" | "3d">("physical");
  const [topoView, setTopoView] = useState<"fullmesh" | "rr">("fullmesh");
  const [routerCount, setRouterCount] = useState(4);
  const [planeView, setPlaneView] = useState<PlaneView>("both");
  const [focusRouter, setFocusRouter] = useState<RouterId>("RR1");
  const [selectedNodeId, setSelectedNodeId] = useState<string | undefined>(undefined);
  const [cameraMode, setCameraMode] = useState<CameraMode | "reflection">("overview");
  const [mapMode, setMapMode] = useState<"physical" | "reflectionFlow">("physical");
  const [enteredDeviceId, setEnteredDeviceId] = useState<RouterId | undefined>(undefined);
  const [deviceXray, setDeviceXray] = useState(true);
  const [selectedInterfaceId, setSelectedInterfaceId] = useState<string | undefined>(undefined);
  const [selectedLinkId, setSelectedLinkId] = useState<string | undefined>(undefined);
  const [packetSelected, setPacketSelected] = useState(false);
  const [selectedRegionId, setSelectedRegionId] = useState<string | undefined>(undefined);
  const [vendorView, setVendorView] = useState<"concept" | "cisco" | "juniper">("concept");
  const [focusMode, setFocusMode] = useState(false);
  const [focusedObject, setFocusedObject] = useState<FocusTarget3D | undefined>(undefined);
  /** Presentation cursor for HopTimeline inspection ("Historical Timeline Inspection Fix" §3) — a step INDEX, never mutates the live lesson. undefined = inspecting the current/live hop. */
  const [historicalIndex, setHistoricalIndex] = useState<number | undefined>(undefined);
  /** Explicit Hop-vs-Device intent inside Focus Mode ("Shared Focus Mode Inspector Fix") — set by the actual gesture (node click → device; timeline/next-hop/Play → hop), never inferred from whether a trace object happens to exist. */
  const [inspectorSurface, setInspectorSurface] = useState<InspectorSurface>("hop");
  const completeLesson = useProgressStore((s) => s.completeLesson);
  const recordAnswer = useProgressStore((s) => s.recordAnswer);
  const unlockAchievement = useProgressStore((s) => s.unlockAchievement);
  const awardedRef = useRef(false);
  const autoSwitchedRef = useRef(false);

  const { state, currentStep, index, totalSteps, isComplete, lastAnswer, whatChanged, activePacket } = snapshot;
  const canAdvance = engine.canAdvance();
  // Question Context Mode smoke test (brief §27/§56) — same sticky/compact
  // treatment as SR-MPLS Foundations, so a BGP RR prediction question never
  // scrolls the topology out of view. No new engine/page state — reuses the
  // existing snapshot fields exactly like SR-MPLS's TopologyFrame usage.
  const questionActive = !isComplete && !!currentStep?.question && lastAnswer?.stepId !== currentStep.id;
  const isChallengePhase = index >= challengeIndex;

  useEffect(() => {
    if (index >= introduceRrIndex && !autoSwitchedRef.current) {
      autoSwitchedRef.current = true;
      setTopoView("rr");
    }
    if (index < introduceRrIndex) autoSwitchedRef.current = false;
  }, [index]);

  // Auto-set the slider to the step's canonical value on entry — adjusting state during
  // render (per React's own guidance) rather than an effect, since this is exactly the
  // "reset derived state when a key changes" pattern, not a subscription to an external system.
  const [prevScaleStepId, setPrevScaleStepId] = useState(currentStep?.id);
  if (prevScaleStepId !== currentStep?.id) {
    setPrevScaleStepId(currentStep?.id);
    if (currentStep?.id === "show-fullmesh" && routerCount !== 4) setRouterCount(4);
    if ((currentStep?.id === "scale-demo" || currentStep?.id === "predict-session-count-10") && routerCount !== 10) setRouterCount(10);
  }

  // --- Topology selection (mirrors the 2D page's fullMeshGraph/rrGraph exactly, extended with the interactive router-count slider) ---
  const fullMeshGraph = useMemo(() => {
    if (isChallengePhase) return { nodes: CHALLENGE_FULLMESH_NODES as GNode[], edges: CHALLENGE_FULLMESH_EDGES, regions: [] as GRegion[] };
    if (routerCount !== 4) return { ...scaleMeshGraph(Math.min(routerCount, MAX_RENDERED_MESH_ROUTERS)), regions: [] as GRegion[] };
    return { nodes: FULLMESH_4_NODES as GNode[], edges: FULLMESH_4_EDGES, regions: [] as GRegion[] };
  }, [isChallengePhase, routerCount]);

  const rrGraph = useMemo(() => {
    if (isChallengePhase) {
      return state.design.mode === "tworr"
        ? { nodes: CHALLENGE_TWORR_NODES as GNode[], edges: CHALLENGE_TWORR_EDGES, regions: CHALLENGE_TWORR_REGIONS }
        : { nodes: CHALLENGE_FULLMESH_NODES as GNode[], edges: CHALLENGE_FULLMESH_EDGES, regions: [] as GRegion[] };
    }
    if (state.design.mode === "tworr") return { nodes: TWO_RR_NODES as GNode[], edges: state.faultActive ? TWO_RR_EDGES_FAULTY : TWO_RR_EDGES, regions: TWO_RR_REGIONS };
    if (state.design.mode === "singlerr") return { nodes: SINGLE_RR_NODES as GNode[], edges: SINGLE_RR_EDGES, regions: SINGLE_RR_REGIONS };
    return { nodes: FULLMESH_4_NODES as GNode[], edges: FULLMESH_4_EDGES, regions: [] as GRegion[] };
  }, [isChallengePhase, state.design.mode, state.faultActive]);

  const activeGraph = topoView === "fullmesh" ? fullMeshGraph : rrGraph;
  const visibleRouterIds = activeGraph.nodes.map((n) => n.id as RouterId);

  // --- 3D derived state (Scene Adapter = deviceTrace.ts; no protocol logic here or in components/network3d/) ---
  const nodes3DBase = useMemo(() => layoutTo3D(withKind(activeGraph.nodes)), [activeGraph.nodes]);
  const regions3D = useMemo(() => layoutRegionsTo3D(activeGraph.regions), [activeGraph.regions]);

  const nodes3D = nodes3DBase.map((n) => {
    let status: Node3DStatus = "idle";
    if (n.id === selectedNodeId || n.id === enteredDeviceId) status = "selected";
    else if (activePacket && (n.id === activePacket.from || n.id === activePacket.to)) status = "active";
    else if (state.received[n.id as RouterId]) status = "onPath";
    const isRr = n.id === "RR1" || n.id === "RR2";
    const badge = isRr ? "RR" : state.design.mode !== "fullmesh" ? (connectedRrOf(state.design, n.id as RouterId) ? "CLIENT" : undefined) : undefined;
    return { ...n, status, badges: badge ? [badge] : undefined };
  });

  const links3D: Link3DData[] = activeGraph.edges.map((e) => {
    const active = activePacket ? (e.a === activePacket.from && e.b === activePacket.to) || (e.b === activePacket.from && e.a === activePacket.to) : false;
    return { id: e.id, a: e.a, b: e.b, label: e.label, active, onPath: !!(state.received[e.a as RouterId] && state.received[e.b as RouterId]) };
  });

  const activePacket3D: ActivePacket3D | undefined = activePacket && nodes3D.some((n) => n.id === activePacket.from) && nodes3D.some((n) => n.id === activePacket.to) ? { packet: activePacket, fromId: activePacket.from, toId: activePacket.to } : undefined;
  const selectedNode3D = nodes3D.find((n) => n.id === selectedNodeId);

  // --- Reflection Flow map mode (brief §15) — simultaneous reflected copies, computed from the real reflection rules via floodTargetsForStep, exactly like OSPF's flood wave adapter. ---
  const floodTargets = mapMode === "reflectionFlow" ? floodTargetsForStep(currentStep?.id ?? "", state.design, activePacket) : [];
  const floodCopies: FloodCopy3D[] = floodTargets.map((t) => ({ id: t.id, fromId: t.fromId, toId: t.toId }));

  const showControlPlane = planeView !== "data";
  const showDataPlane = planeView !== "control";

  const activeDeviceId = useMemo(
    () => PRIMARY_TRANSITION_ROUTER[currentStep?.id ?? ""] ?? DEVICE_ROUTERS.find((r) => visibleRouterIds.includes(r) && traceFor(r, state, currentStep?.id ?? "", activePacket).activeStageId !== undefined),
    [currentStep?.id, visibleRouterIds, state, activePacket],
  );
  const effectiveDeviceId = cameraMode === "device" ? enteredDeviceId : cameraMode === "packetFollow" ? activeDeviceId : undefined;
  const inDeviceMode = !!effectiveDeviceId;

  const deviceTrace = effectiveDeviceId ? traceFor(effectiveDeviceId, state, currentStep?.id ?? "", activePacket) : undefined;
  const deviceInterfaces = effectiveDeviceId ? interfacesFor(effectiveDeviceId, state, visibleRouterIds) : [];
  const devicePacketFrames = effectiveDeviceId ? packetFramesFor(activePacket) : undefined;

  // --- Generic 3D object-focus sub-state ("Universal Interactive Topology
  // Migration" §25) — layered ON TOP of `cameraMode`, never a 5th camera
  // mode. Reuses `deviceTrace`/`deviceInterfaces`/`devicePacketFrames`
  // (the camera-following ones). Cleared automatically once the object
  // it names is no longer present in current data.
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
      : cameraMode === "reflection"
        ? [0, 0, 0]
        : inDeviceMode
          ? [0, 0, deviceXray ? -0.2 : 0]
          : selectedNode3D?.position;
  const eyeOffset3D: [number, number, number] | undefined = activeFocusedObject
    ? eyeOffsetForFocusTarget(activeFocusedObject)
    : cameraMode === "reflection"
      ? [0.01, 9, 0.01]
      : inDeviceMode
        ? deviceXray
          ? [0.6, 2.6, 5.2]
          : [2.1, 1.5, 3.8]
        : undefined;

  const explainTargetId = effectiveDeviceId ?? selectedNodeId;
  const nodeExplanation = explainTargetId && DEVICE_ROUTERS.includes(explainTargetId as RouterId) ? explainRouter(state, explainTargetId as RouterId, currentStep?.id ?? "", activePacket, visibleRouterIds) : undefined;
  const xrayPacket = activePacket && (selectedNodeId === activePacket.from || selectedNodeId === activePacket.to) ? activePacket : undefined;

  // --- Hop Inspector target ("Universal Interactive Topology Migration"
  // §23) — explicit selection wins outright: selectedNodeId >
  // effectiveDeviceId > activeDeviceId. Decoupled from `inDeviceMode` so a
  // plain node click already shows that router's Hop Inspector inside
  // Focus Mode.
  const focusInspectDeviceId = (selectedNodeId ?? effectiveDeviceId ?? activeDeviceId) as RouterId | undefined;
  const focusTrace = focusInspectDeviceId ? traceFor(focusInspectDeviceId, state, currentStep?.id ?? "", activePacket) : undefined;
  const focusInterfaces = focusInspectDeviceId ? interfacesFor(focusInspectDeviceId, state, visibleRouterIds) : undefined;

  // --- Historical-cursor invariant (ARCHITECTURE.md §18) — inspection is only
  // meaningful for a step strictly EARLIER than the live one. Once any live
  // navigation (Previous, progress bar, Step Back, …) reaches or passes the
  // selected step, historical mode ends. The stored cursor is cleared during
  // render (React's "adjust state on prop change" pattern) so it can't
  // resurrect when the lesson later moves forward again; `historicalCursor`
  // is the only value the rest of the page reads.
  if (historicalIndex !== undefined && historicalIndex >= index) setHistoricalIndex(undefined);
  const historicalCursor = historicalIndex !== undefined && historicalIndex < index ? historicalIndex : undefined;

  // --- HopTimeline data — every packet-carrying OR FSM/reflection-
  // transition step completed so far (`PRIMARY_TRANSITION_ROUTER` already
  // identifies the no-packet transition steps), re-describing
  // `rrSteps`/`index` rather than a separate journey log.
  const journeyStepIndices = rrSteps
    .map((s, i) => ({ s, i }))
    .filter(({ s, i }) => i <= index && (!!s.packet || PRIMARY_TRANSITION_ROUTER[s.id] !== undefined));
  const journeyHopEntries = journeyStepIndices.map(({ s, i }) => ({ id: s.id, label: s.label, index: i }));
  // Chip position of a valid historical selection; -1 falls back to the live entry, never to "no current chip".
  const historicalTimelinePos = historicalCursor !== undefined ? journeyHopEntries.findIndex((h) => h.index === historicalCursor) : -1;

  // --- Historical inspection ("Historical Timeline Inspection Fix" §3/§4)
  // — reuses ScenarioEngine's OWN `stateByIndex` snapshot (exposed via
  // `getStateAt`) rather than a second, hand-rolled journey record.
  // Presentation-only — never calls `engine.goTo()`.
  const historicalState = historicalCursor !== undefined ? engine.getStateAt(historicalCursor) : undefined;
  const historicalStep = historicalCursor !== undefined ? rrSteps[historicalCursor] : undefined;
  const historicalPacket = historicalStep && historicalState ? historicalStep.packet?.(historicalState) : undefined;
  const historicalDeviceId = historicalStep && historicalState ? deviceForStep(historicalStep.id, historicalPacket) : undefined;
  const historicalTrace =
    historicalDeviceId && historicalState
      ? traceFor(historicalDeviceId, historicalState, historicalStep!.id, historicalPacket)
      : undefined;
  const historicalInterfaces = historicalDeviceId && historicalState ? interfacesFor(historicalDeviceId, historicalState, visibleRouterIds) : undefined;

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
      return { title: iface.name, fields };
    }
    return { title: target.id, fields: [] };
  }

  function handleCameraModeChange(v: CameraMode | "reflection") {
    setCameraMode(v);
    if (v === "device" && !enteredDeviceId) setEnteredDeviceId((selectedNodeId as RouterId) ?? activeDeviceId ?? "RR1");
    if (v === "overview") {
      setEnteredDeviceId(undefined);
      setSelectedNodeId(undefined);
    }
    if (v === "freeOrbit" || v === "reflection") setEnteredDeviceId(undefined);
  }

  // --- Manual object focus vs. Play — resuming playback takes priority
  // over a previously-focused stage/layer/interface (see sr-mpls-foundations).
  function handleToggleAutoPlay() {
    if (!autoPlay) {
      setFocusedObject(undefined);
      setHistoricalIndex(undefined);
      setInspectorSurface("hop");
    }
    setAutoPlay((v) => !v);
  }

  const selectedLinkDetail = selectedLinkId ? linkDetailFor(selectedLinkId, state, visibleRouterIds, activePacket) : undefined;
  const packetCurrentDeviceLabel = effectiveDeviceId ?? activePacket?.to ?? activePacket?.from ?? "—";
  const packetDirection = activePacket ? `${activePacket.from} → ${activePacket.to}` : "—";

  const focusKind = currentStep?.id && ["ibgp-share-intro", "pe1-advertises-rr"].includes(currentStep.id) ? "origin" : currentStep?.id && ["rr-reflects", "reflect-through-two-rr", "vpnv4-through-rr"].includes(currentStep.id) ? "rr" : undefined;
  const focusIndices = focusKind === "origin" ? originAttrsLayerIndex(activePacket) : focusKind === "rr" ? rrAttrsLayerIndex(activePacket) : undefined;

  const cliCommands = useMemo(() => buildRrCliCommands(state, focusRouter), [state, focusRouter]);
  const explorerCliCommands = useMemo(() => buildRrCliCommands(state, effectiveDeviceId ?? "RR1"), [state, effectiveDeviceId]);
  const explorerDiagnostics = effectiveDeviceId ? diagnosticLayersFor(state, effectiveDeviceId) : [];
  const explorerReceived = effectiveDeviceId ? state.received[effectiveDeviceId] : undefined;
  const explorerRouteRow: RrRouteRow | undefined = explorerReceived
    ? {
        prefix: explorerReceived.route.prefix,
        originator: explorerReceived.route.originator,
        originatorId: explorerReceived.route.originatorId,
        nextHop: explorerReceived.route.nextHop,
        localPref: explorerReceived.route.localPref,
        clusterList: explorerReceived.clusterList,
        reflected: explorerReceived.viaReflection,
        learnedFromClient: effectiveDeviceId ? isClientOf(state.design, explorerReceived.receivedFrom, effectiveDeviceId) || isClientOf(state.design, effectiveDeviceId, explorerReceived.receivedFrom) : false,
      }
    : undefined;
  const explorerIsRr = effectiveDeviceId === "RR1" || effectiveDeviceId === "RR2";
  const explorerReflectionCandidates = explorerIsRr && effectiveDeviceId && explorerReceived ? reflectionCandidatesFor(state.design, effectiveDeviceId, explorerReceived.receivedFrom) : [];

  const showCalculator = index >= showCalculatorIndex;
  const showRrToggle = index >= introduceRrIndex;
  const showPlanes = index >= planesIndex;
  const clientCount = Object.values(state.design.clients).reduce((sum, c) => sum + (c?.length ?? 0), 0) || 4;
  const rrCount = (Object.keys(state.design.clients).length || 1) as 1 | 2;

  const explorerTabs: DeviceExplorerTab[] =
    nodeExplanation && effectiveDeviceId
      ? [
          {
            id: "overview",
            label: "Overview",
            content: (
              <div className="space-y-3">
                <div className="rounded-lg border border-pv-cyan/30 bg-pv-cyan/5 p-3">
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-pv-cyan-soft">Current Action</p>
                  <p className="text-sm text-pv-text">{nodeExplanation.currentAction}</p>
                </div>
                <div className="rounded-lg border border-pv-border p-2.5">
                  <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-pv-text-faint">Diagnostic Layers</p>
                  <div className="space-y-1">
                    {explorerDiagnostics.map((d) => (
                      <div key={d.label} className="flex items-center justify-between pv-mono text-[11px]">
                        <span className="text-pv-text-muted">{d.label}</span>
                        <span className={d.ok ? "text-pv-success" : "text-pv-danger"}>{d.ok ? "✓" : "✕"}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ),
          },
          {
            id: "hardware",
            label: "Hardware",
            content: (
              <div className="space-y-2 text-xs text-pv-text-muted">
                <p>
                  Generic stylized {explorerIsRr ? "Route Reflector" : "PE router"} chassis — {deviceInterfaces.length} physical interface{deviceInterfaces.length === 1 ? "" : "s"}.
                </p>
                <p className="pv-mono text-[11px] text-pv-text-faint">Rotate in the 3D view to inspect the hardware; click a port to select it in the Interfaces tab.</p>
              </div>
            ),
          },
          { id: "interfaces", label: "Interfaces", content: <InterfaceListTab interfaces={deviceInterfaces} selectedInterfaceId={selectedInterfaceId} onSelectInterface={setSelectedInterfaceId} /> },
          {
            id: "peers",
            label: "Peers",
            content: (
              <div className="flex flex-wrap gap-1.5">
                {deviceInterfaces.map((i) => (
                  <Badge key={i.id} tone={i.extra?.find((f) => f.label === "RR Relationship")?.value === "Client" ? "cyan" : "muted"}>
                    {i.neighborLabel}
                  </Badge>
                ))}
                {deviceInterfaces.length === 0 && <p className="text-xs text-pv-text-faint">No BGP sessions in this topology view.</p>}
              </div>
            ),
          },
          { id: "bgptable", label: "BGP Table", content: <RrRouteViewer title={effectiveDeviceId} route={explorerRouteRow} /> },
          {
            id: "reflection",
            label: "Reflection",
            content: explorerIsRr ? (
              explorerReceived ? (
                <ReflectionDecisionViewer title={`${effectiveDeviceId} Reflection Decision`} receivedFromLabel={explorerReceived.receivedFrom} receivedFromRelationship={relationshipOf(state.design, effectiveDeviceId, explorerReceived.receivedFrom)} candidates={explorerReflectionCandidates.map((c) => ({ id: c.routerId, label: c.routerId, relationship: c.relationship, decision: c.decision, reason: c.reason }))} />
              ) : (
                <p className="text-xs text-pv-text-faint">No route received yet — nothing to evaluate.</p>
              )
            ) : (
              <p className="text-xs text-pv-text-faint">{effectiveDeviceId} is an ordinary PE — it never makes a reflection decision. Only a Route Reflector does.</p>
            ),
          },
          {
            id: "routes",
            label: "Routes",
            content: explorerIsRr ? (
              <p className="text-xs text-pv-text-faint">A Route Reflector reflects this route — it does not install it into a forwarding RIB for its own use. It is not in the customer data path.</p>
            ) : explorerReceived ? (
              <div className="rounded-lg border border-pv-success/40 bg-pv-success/5 p-2.5 pv-mono text-[11px]">
                <p className="text-pv-text">{explorerReceived.route.prefix} via {explorerReceived.route.nextHop}</p>
                <p className="text-pv-success">Installed (RIB)</p>
              </div>
            ) : (
              <p className="text-xs text-pv-text-faint">No installed route yet.</p>
            ),
          },
          {
            id: "packet",
            label: "Packet",
            content:
              activePacket && effectiveDeviceId && (activePacket.from === effectiveDeviceId || activePacket.to === effectiveDeviceId) ? (
                <PacketInspector packet={activePacket} focusLayerIndices={focusIndices} />
              ) : (
                <p className="text-xs text-pv-text-faint">No packet at this device right now.</p>
              ),
          },
          { id: "cli", label: "CLI", content: <CLIOutputPanel commands={explorerCliCommands} /> },
        ]
      : [];

  useEffect(() => {
    if (isComplete && !awardedRef.current) {
      awardedRef.current = true;
      completeLesson("bgp-route-reflector", 300);
      unlockAchievement("control-plane-architect");
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
    autoSwitchedRef.current = false;
    engine.restart();
    setTopoView("fullmesh");
    setRouterCount(4);
    setCameraMode("overview");
    setMapMode("physical");
    setEnteredDeviceId(undefined);
    setSelectedNodeId(undefined);
    setSelectedLinkId(undefined);
    setSelectedRegionId(undefined);
    setPacketSelected(false);
    setFocusedObject(undefined);
    setHistoricalIndex(undefined);
    setInspectorSurface("hop");
  };

  const nextLabel = currentStep?.question && !lastAnswer ? "Answer to continue" : currentStep?.requiresState && !canAdvance ? "Apply the correct fix to continue" : "Next Step →";

  return (
    <div className="mx-auto max-w-7xl px-6 py-10">
      <div className="mb-6">
        <Badge tone="cyan" className="mb-3">
          BGP Route Reflector · iBGP Scaling
        </Badge>
        <h1 className="text-2xl font-semibold text-pv-text sm:text-3xl">Full Mesh Doesn&apos;t Scale — Reflection Does</h1>
        <p className="mt-2 max-w-3xl text-sm text-pv-text-muted">
          Watch iBGP&apos;s full-mesh requirement explode as routers are added, then watch a Route Reflector bend the split-horizon
          rule — just for its clients — and cut that mesh down to a hub and spoke.
        </p>
      </div>

      <div className="mb-4 grid gap-2 sm:grid-cols-4">
        {WHY_RR.map((item) => (
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
        {rrSteps.map((step, i) => (
          <button
            key={step.id}
            type="button"
            disabled={i > index}
            onClick={() => i < index && engine.goTo(i)}
            title={step.label}
            className={clsx(
              "h-1.5 flex-1 min-w-3 rounded-full transition-colors",
              i < index ? "bg-pv-success/70 hover:bg-pv-success cursor-pointer" : i === index ? "bg-pv-cyan" : "bg-white/10",
            )}
          />
        ))}
      </div>

      <div className="mb-6 flex flex-wrap gap-3">
        <TopologyModeSwitcher
          options={[
            { value: "physical", label: "Physical 2D" },
            { value: "logical", label: "Logical BGP" },
            { value: "3d", label: "3D Explore" },
          ]}
          value={viewMode}
          onChange={setViewMode}
        />
        {showRrToggle && (
          <TopologyModeSwitcher
            options={[
              { value: "fullmesh", label: "Full Mesh" },
              { value: "rr", label: "Route Reflector" },
            ]}
            value={topoView}
            onChange={setTopoView}
            tone="violet"
          />
        )}
        {viewMode === "3d" && (
          <>
            <TopologyModeSwitcher
              options={[
                { value: "overview", label: "Overview" },
                { value: "device", label: "Device" },
                { value: "packetFollow", label: "Packet Follow" },
                { value: "reflection", label: "Reflection Analysis" },
                { value: "freeOrbit", label: "Free Orbit" },
              ]}
              value={cameraMode}
              onChange={handleCameraModeChange}
            />
            {inDeviceMode && (
              <TopologyModeSwitcher
                options={[
                  { value: "off", label: "Exterior" },
                  { value: "on", label: "Reflection X-Ray" },
                ]}
                value={deviceXray ? "on" : "off"}
                onChange={(v) => setDeviceXray(v === "on")}
                tone="violet"
              />
            )}
            {cameraMode === "overview" && topoView === "rr" && (
              <TopologyModeSwitcher
                options={[
                  { value: "physical", label: "Physical Topology" },
                  { value: "reflectionFlow", label: "Reflection Flow" },
                ]}
                value={mapMode}
                onChange={setMapMode}
                tone="violet"
              />
            )}
            {cameraMode === "reflection" && (
              <TopologyModeSwitcher
                options={[
                  { value: "concept", label: "Concept" },
                  { value: "cisco", label: "Cisco" },
                  { value: "juniper", label: "Juniper" },
                ]}
                value={vendorView}
                onChange={setVendorView}
                tone="violet"
              />
            )}
            <PlaneViewSwitcher value={planeView} onChange={setPlaneView} />
          </>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_400px]">
        {/* MAIN COLUMN */}
        <div className="space-y-6">
          {viewMode === "3d" ? (
            <>
              <TopologyFrame questionActive={questionActive} onExpand={() => setFocusMode(true)}>
              {focusMode ? (
                // Focus Mode renders its own full-size <NetworkScene3D> below —
                // avoid a second, fully hidden WebGL canvas running behind the
                // modal (one-canvas invariant, see sr-mpls-foundations).
                <div className="h-96 w-full rounded-2xl border border-pv-border bg-pv-bg-elevated sm:h-[28rem]" />
              ) : (
              <NetworkScene3D
                nodes={nodes3D}
                links={links3D}
                activePacket={inDeviceMode ? undefined : showControlPlane ? activePacket3D : undefined}
                floodCopies={!inDeviceMode && showControlPlane ? floodCopies : []}
                regions={cameraMode === "overview" || cameraMode === "reflection" ? regions3D : []}
                onSelectRegion={(id) => {
                  setSelectedRegionId(id);
                  setSelectedNodeId(undefined);
                  setPacketSelected(false);
                  setSelectedLinkId(undefined);
                }}
                selectedRegionId={selectedRegionId}
                onSelectNode={(id) => {
                  setSelectedNodeId(id);
                  setSelectedRegionId(undefined);
                  setPacketSelected(false);
                  setSelectedLinkId(undefined);
                  setInspectorSurface("device");
                  setHistoricalIndex(undefined);
                }}
                onSelectLink={(id) => {
                  setSelectedLinkId(id);
                  setSelectedNodeId(undefined);
                  setSelectedRegionId(undefined);
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
                        pipelineTitle: "Conceptual Route Reflection Pipeline",
                        onFocusObject: setFocusedObject,
                        focusedObjectId: activeFocusedObject?.id,
                      }
                    : undefined
                }
              />
              )}
              </TopologyFrame>

              {cameraMode === "overview" && topoView === "fullmesh" && showCalculator && !isChallengePhase && (
                <GlassPanel strong className="space-y-3 p-5">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-pv-cyan-soft">Session-Count Scaling — Full Mesh vs. Route Reflector</h3>
                  <label className="block text-xs text-pv-text-muted">
                    Number of BGP routers: <span className="pv-mono text-pv-text">{routerCount}</span>
                    <input
                      type="range"
                      min={4}
                      max={100}
                      value={routerCount}
                      onChange={(e) => setRouterCount(Number(e.target.value))}
                      className="mt-2 block w-full accent-pv-cyan"
                    />
                  </label>
                  {routerCount > MAX_RENDERED_MESH_ROUTERS && (
                    <p className="text-[11px] text-pv-text-faint">
                      Above {MAX_RENDERED_MESH_ROUTERS} routers, every individual link stops being legible to render in 3D — the count below is exact, calculated, not drawn link-by-link.
                    </p>
                  )}
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-2">
                    <div className="rounded-lg border border-pv-danger/30 bg-pv-danger/5 p-3">
                      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-pv-text-faint">Full Mesh — n(n-1)/2</p>
                      <p className="pv-mono text-lg font-bold text-pv-danger">{fullMeshSessionCount(routerCount).toLocaleString()} sessions</p>
                    </div>
                    <div className="rounded-lg border border-pv-success/30 bg-pv-success/5 p-3">
                      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-pv-text-faint">Route Reflector Design (illustrative)</p>
                      <p className="pv-mono text-lg font-bold text-pv-success">{rrSessionCount(routerCount, routerCount > 50 ? 2 : 1).toLocaleString()} sessions</p>
                      <p className="mt-1 text-[10px] text-pv-text-faint">Dramatically fewer direct PE-to-PE sessions — the exact count depends on the actual design/topology chosen, not a universal formula.</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-1 pv-mono text-[11px] sm:grid-cols-4">
                    {SCALE_EXAMPLES.map((n) => (
                      <span key={n} className="text-pv-text-muted">
                        {n} routers: <span className="text-pv-text">{fullMeshSessionCount(n).toLocaleString()}</span> sessions
                      </span>
                    ))}
                  </div>
                </GlassPanel>
              )}

              {cameraMode === "reflection" && (
                <GlassPanel strong className="space-y-4 p-5">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-pv-cyan-soft">Reflection Decision Chamber</h3>
                  <div className="flex flex-wrap gap-1.5">
                    {(["RR1", "RR2"] as const).map((r) => (
                      <button
                        key={r}
                        type="button"
                        onClick={() => setFocusRouter(r)}
                        className={clsx("rounded-lg border px-2.5 py-1.5 pv-mono text-[11px] transition-colors", focusRouter === r ? "border-pv-cyan/50 bg-pv-cyan/10 text-pv-cyan-soft" : "border-pv-border text-pv-text-muted hover:text-pv-text")}
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                  {state.received[focusRouter] ? (
                    <ReflectionDecisionViewer
                      receivedFromLabel={state.received[focusRouter]!.receivedFrom}
                      receivedFromRelationship={relationshipOf(state.design, focusRouter, state.received[focusRouter]!.receivedFrom)}
                      candidates={reflectionCandidatesFor(state.design, focusRouter, state.received[focusRouter]!.receivedFrom).map((c) => ({ id: c.routerId, label: c.routerId, relationship: c.relationship, decision: c.decision, reason: c.reason }))}
                    />
                  ) : (
                    <p className="text-xs text-pv-text-faint">{focusRouter} has no candidate route yet.</p>
                  )}
                  {vendorView === "cisco" && (
                    <div className="rounded-lg border border-pv-warning/40 bg-pv-warning/5 p-3 text-xs text-pv-text-muted">
                      <span className="mb-1 block font-semibold text-pv-text">Cisco IOS</span>
                      Configure with <span className="pv-mono text-pv-text">neighbor &lt;ip&gt; route-reflector-client</span> per client, and <span className="pv-mono text-pv-text">bgp cluster-id &lt;id&gt;</span> once. Inspect with <span className="pv-mono text-pv-text">show bgp neighbors</span>.
                    </div>
                  )}
                  {vendorView === "juniper" && (
                    <div className="rounded-lg border border-pv-warning/40 bg-pv-warning/5 p-3 text-xs text-pv-text-muted">
                      <span className="mb-1 block font-semibold text-pv-text">Junos</span>
                      Configure a <span className="pv-mono text-pv-text">group</span> of type internal with a <span className="pv-mono text-pv-text">cluster &lt;id&gt;</span> statement — every neighbor in that group becomes a client. Inspect with <span className="pv-mono text-pv-text">show bgp neighbor</span>.
                    </div>
                  )}
                </GlassPanel>
              )}

              {selectedRegionId && (
                <GlassPanel strong className="space-y-2 p-5">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-pv-violet">{activeGraph.regions.find((r) => r.id === selectedRegionId)?.label ?? selectedRegionId}</h3>
                    <button type="button" onClick={() => setSelectedRegionId(undefined)} className="text-xs text-pv-text-faint hover:text-pv-text">
                      ✕
                    </button>
                  </div>
                  <p className="text-xs text-pv-text-muted">
                    Route reflection creates a topology that is no longer the simple full mesh normal iBGP assumes — each cluster boundary groups an RR with the clients it reflects for. ORIGINATOR_ID and CLUSTER_LIST exist specifically because this shape can (in principle) route a copy back around.
                  </p>
                </GlassPanel>
              )}

              {index >= vpnv4Index && showDataPlane && !isComplete && (
                <VpnRouteViewer
                  title="PE1 (via RR1)"
                  route={{ vrf: "CUST-A", prefix: VPNV4_PREFIX, originPe: "PE2", rd: VPNV4_RD, rt: VPNV4_RT, nextHop: "4.4.4.4", vpnLabel: VPNV4_LABEL, received: index > vpnv4Index }}
                />
              )}

              {showPlanes && !isComplete && (
                <GlassPanel strong className="space-y-4 p-5">
                  <p className="text-center text-[10px] font-semibold uppercase tracking-wide text-pv-text-faint">The strongest idea in this lesson</p>
                  <div className="grid gap-4 sm:grid-cols-2">
                    {showControlPlane && (
                      <div className="rounded-xl border border-pv-violet/40 bg-pv-violet/5 p-4 text-center">
                        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-pv-violet">Control Plane</p>
                        <div className="space-y-1 pv-mono text-xs text-pv-text">
                          <p>PE1</p>
                          <p className="text-pv-text-faint">│ UPDATE</p>
                          <p>▼</p>
                          <p className="rounded border border-pv-violet/50 bg-pv-violet/10 px-2 py-1 inline-block">RR1</p>
                          <p className="text-pv-text-faint">↙ ↓ ↘</p>
                          <p>PE2&nbsp;&nbsp;PE3&nbsp;&nbsp;PE4</p>
                        </div>
                      </div>
                    )}
                    {showDataPlane && (
                      <div className="rounded-xl border border-pv-cyan/40 bg-pv-cyan/5 p-4 text-center">
                        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-pv-cyan-soft">Data Plane</p>
                        <p className="pv-mono text-xs text-pv-text">CE1 → PE1 → P1 → P2 → PE2 → CE2</p>
                        <p className="mt-3 pv-mono text-xs text-pv-text-faint">RR1</p>
                        <p className="pv-mono text-pv-danger">✕</p>
                        <p className="text-[11px] text-pv-text-faint">not traversed</p>
                      </div>
                    )}
                  </div>
                  <p className="text-xs text-pv-text-muted">
                    The Route Reflector is essential to how PE1 learned this route at all — but it never sits in the path a customer packet actually takes. Control-plane dependency ≠ physically forwarding the packet.
                  </p>
                </GlassPanel>
              )}

              {packetSelected && activePacket && (
                <PacketDetailPanel
                  packet={activePacket}
                  currentDevice={packetCurrentDeviceLabel}
                  direction={packetDirection}
                  focusLayerIndices={focusIndices}
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
                <DeviceExplorerPanel
                  explanation={nodeExplanation!}
                  tabs={explorerTabs}
                  xrayEnabled={deviceXray}
                  onToggleXray={() => setDeviceXray((v) => !v)}
                  xrayOnLabel="Reflection X-Ray"
                  onExit={() => {
                    setCameraMode("overview");
                    setEnteredDeviceId(undefined);
                  }}
                />
              ) : (
                !packetSelected &&
                !selectedLinkDetail && (
                  <NodeInspectorPanel explanation={nodeExplanation} packet={xrayPacket} xrayEnabled={false}>
                    {selectedNodeId && DEVICE_ROUTERS.includes(selectedNodeId as RouterId) && (
                      <Button
                        size="sm"
                        onClick={() => {
                          setEnteredDeviceId(selectedNodeId as RouterId);
                          setCameraMode("device");
                        }}
                      >
                        Enter Router →
                      </Button>
                    )}
                  </NodeInspectorPanel>
                )
              )}
            </>
          ) : (
            <GraphTopologyViewer nodes={activeGraph.nodes} edges={activeGraph.edges.map((e) => ({ ...e, state: "full" as const }))} activeNodeIds={activePacket ? [activePacket.from, activePacket.to] : []} regions={activeGraph.regions}>
              {activePacket && (() => {
                const from = activeGraph.nodes.find((n) => n.id === activePacket.from);
                const to = activeGraph.nodes.find((n) => n.id === activePacket.to);
                return from && to ? <GraphPacket packet={activePacket} from={from} to={to} /> : null;
              })()}
            </GraphTopologyViewer>
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

          {!isComplete && currentStep?.question && (
            <PredictionQuestion question={currentStep.question} selectedOptionId={lastAnswer?.stepId === currentStep.id ? lastAnswer.optionId : undefined} onAnswer={handleAnswer} />
          )}

          {!isComplete && currentStep?.id === "repair-challenge" && (
            <ChoiceChallenge
              prompt="Choose the correct repair for RR2's session with PE3:"
              options={REPAIR_OPTIONS}
              correctId="make-client"
              attempt={state.repairAttempt}
              wrongFeedback={WRONG_FEEDBACK}
              successMessage="✓ PE3 reconfigured as RR2's client — route reflected."
              onTry={(choice) => engine.act({ choice })}
            />
          )}

          {!isComplete && currentStep?.id === "challenge-select" && (
            <ChoiceChallenge
              prompt="Pick a Route Reflector redesign for the 6-PE network:"
              options={CHALLENGE_OPTIONS}
              correctId="two-rr-peered"
              attempt={state.challengeChoice !== undefined ? { choice: state.challengeChoice, correct: state.challengeSucceeded === true } : undefined}
              wrongFeedback={CHALLENGE_WRONG_FEEDBACK}
              successMessage={state.challengeCheck ? `✓ All ${CHALLENGE_PES.length} PEs covered — session count ${state.challengeCheck.sessionCount} (was ${fullMeshSessionCount(CHALLENGE_PES.length)}).` : "✓ Design validated."}
              onTry={(choice) => engine.act({ choice })}
            />
          )}

          {whatChanged.length > 0 && !currentStep?.question && currentStep?.id !== "repair-challenge" && currentStep?.id !== "challenge-select" && (
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

          {isComplete && (
            <GlassPanel strong glow="success" className="flex flex-col items-center gap-4 p-10 text-center">
              <Badge tone="success">Control Plane Architect</Badge>
              <h2 className="text-2xl font-semibold text-pv-text">The Provider Scales — Without A Full Mesh</h2>
              <p className="max-w-md text-sm text-pv-text-muted">
                You watched full-mesh iBGP explode, learned exactly which iBGP rule a Route Reflector bends and for whom, tracked
                ORIGINATOR_ID and CLUSTER_LIST across two clusters, confirmed the RR never touches customer traffic, repaired a
                broken client relationship, and redesigned a 6-PE network around two redundant reflectors. +300 XP awarded.
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
                  <button
                    key={s}
                    type="button"
                    onClick={() => setSpeed(s)}
                    className={clsx("rounded-full px-2.5 py-1 text-[10px] font-semibold pv-mono transition-colors", speed === s ? "bg-pv-cyan/15 text-pv-cyan-soft" : "text-pv-text-faint hover:text-pv-text")}
                  >
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
          {showControlPlane && <PacketInspector packet={activePacket} focusLayerIndices={focusIndices} />}

          <div className="flex flex-wrap gap-1 rounded-full border border-pv-border p-0.5 w-fit">
            {DEVICE_ROUTERS.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setFocusRouter(r)}
                className={clsx("rounded-full px-2.5 py-1 text-[11px] font-semibold pv-mono transition-colors", focusRouter === r ? "bg-pv-cyan/15 text-pv-cyan-soft" : "text-pv-text-faint hover:text-pv-text")}
              >
                {r}
              </button>
            ))}
          </div>

          {showControlPlane && (
            <RrRouteViewer
              title={focusRouter}
              route={
                state.received[focusRouter]
                  ? {
                      prefix: state.received[focusRouter]!.route.prefix,
                      originator: state.received[focusRouter]!.route.originator,
                      originatorId: state.received[focusRouter]!.route.originatorId,
                      nextHop: state.received[focusRouter]!.route.nextHop,
                      localPref: state.received[focusRouter]!.route.localPref,
                      clusterList: state.received[focusRouter]!.clusterList,
                      reflected: state.received[focusRouter]!.viaReflection,
                      learnedFromClient: connectedRrOf(state.design, focusRouter) ? isClientOf(state.design, connectedRrOf(state.design, focusRouter)!, focusRouter) : false,
                    }
                  : undefined
              }
            />
          )}

          {index >= troubleshootIndex && !isChallengePhase && (
            <TroubleshootingLayers
              title={`${focusRouter} — Troubleshooting Layers`}
              layers={diagnosticLayersFor(state, focusRouter).map((d): TsDiagnosticLayer => ({ label: d.label, status: d.ok ? "healthy" : "failing" }))}
            />
          )}

          {showControlPlane && (focusRouter === "PE1" || focusRouter === "RR1") && (
            <GlassPanel className="space-y-1.5 p-4">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-pv-text-muted">Loop Prevention — Worked Example</h4>
              <p className="text-[11px] text-pv-text-muted">
                If {PREFIX} ever routed back to <span className="pv-mono text-pv-text">PE1</span> (its originator), PE1 would compare ORIGINATOR_ID (<span className="pv-mono text-pv-cyan-soft">{ROUTER_IP.PE1}</span>) against its own router ID (<span className="pv-mono text-pv-text">{ROUTER_IP.PE1}</span>) — a match — and reject it.
              </p>
              <p className="text-[11px] text-pv-text-muted">
                If RR1 ever received this route back with CLUSTER_LIST already containing its own cluster (<span className="pv-mono text-pv-violet">{CLUSTER_ID.RR1}</span>), RR1 would reject it the same way — this is real loop-prevention logic, not an animated example.
              </p>
            </GlassPanel>
          )}

          {showRrToggle && showCalculator && (
            <GlassPanel className="p-4">
              <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-pv-text-muted">Right Now</h4>
              <p className="pv-mono text-[11px] text-pv-text-muted">
                {clientCount} clients, {rrCount} RR{rrCount === 2 ? "s" : ""}: Full Mesh <span className="text-pv-danger">{fullMeshSessionCount(clientCount)} sessions</span> vs. Route Reflector <span className="text-pv-success">{rrSessionCount(clientCount, rrCount)} sessions</span>.
              </p>
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
              <TopologyModeSwitcher
                options={[
                  { value: "overview", label: "Overview" },
                  { value: "device", label: "Device" },
                  { value: "packetFollow", label: "Packet Follow" },
                  { value: "freeOrbit", label: "Free Orbit" },
                ]}
                value={cameraMode === "reflection" ? "overview" : cameraMode}
                onChange={handleCameraModeChange}
              />
              {inDeviceMode && (
                <TopologyModeSwitcher options={[{ value: "off", label: "Exterior" }, { value: "on", label: "Reflection X-Ray" }]} value={deviceXray ? "on" : "off"} onChange={(v) => setDeviceXray(v === "on")} tone="violet" />
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
                activePacket={inDeviceMode ? undefined : showControlPlane ? activePacket3D : undefined}
                floodCopies={!inDeviceMode && showControlPlane ? floodCopies : []}
                regions={cameraMode === "overview" ? regions3D : []}
                onSelectRegion={(id) => {
                  setSelectedRegionId(id);
                  setSelectedNodeId(undefined);
                  setPacketSelected(false);
                  setSelectedLinkId(undefined);
                }}
                selectedRegionId={selectedRegionId}
                onSelectNode={(id) => {
                  setSelectedNodeId(id);
                  setSelectedRegionId(undefined);
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
                        pipelineTitle: "Conceptual Route Reflection Pipeline",
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
                    tabs={explorerTabs}
                    xrayEnabled={deviceXray}
                    onToggleXray={() => setDeviceXray((v) => !v)}
                    xrayOnLabel="Reflection X-Ray"
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
            ) : historicalCursor !== undefined && historicalTrace ? (
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
                    setSelectedNodeId(id);
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
                    // The rightmost/current entry — return to live inspection.
                    setHistoricalIndex(undefined);
                    return;
                  }
                  setHistoricalIndex(entry.index);
                  setFocusedObject(undefined);
                  const histState = engine.getStateAt(entry.index);
                  const histStep = rrSteps[entry.index];
                  const histPacket = histStep && histState ? histStep.packet?.(histState) : undefined;
                  const router = deviceForStep(entry.id, histPacket);
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

function ChoiceChallenge({
  prompt,
  options,
  correctId,
  attempt,
  wrongFeedback,
  successMessage,
  onTry,
}: {
  prompt: string;
  options: { id: string; label: string }[];
  correctId: string;
  attempt?: { choice: string; correct: boolean };
  wrongFeedback: Record<string, string>;
  successMessage: string;
  onTry: (choice: string) => void;
}) {
  return (
    <GlassPanel strong className="p-5">
      <p className="mb-3 text-sm font-medium text-pv-text">{prompt}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((opt) => {
          const isSelected = attempt?.choice === opt.id;
          const isCorrect = opt.id === correctId;
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
          {attempt.correct ? <span className="font-semibold">{successMessage}</span> : (
            <>
              <span className="mb-1 block font-semibold text-pv-text">That doesn&apos;t work.</span>
              {wrongFeedback[attempt.choice] ?? "Try again."}
            </>
          )}
        </div>
      )}
    </GlassPanel>
  );
}

/**
 * Which router is the primary inspection subject of a given step — for
 * Route Reflector steps, `PRIMARY_TRANSITION_ROUTER` (the RR actually
 * making the reflection decision) takes priority over the packet's own
 * receiver, matching `activeDeviceId`'s own precedence above (a reflected
 * UPDATE's interesting behavior happens AT the reflecting RR, not at
 * whichever PE it happens to be en route to) — the reverse priority from
 * bgp-enterprise/ospf-area0's `deviceForStep`, deliberately, so Follow-
 * Packet camera-entry and Timeline historical-inspection always agree on
 * "whose hop is this" for the same step.
 */
function deviceForStep(stepId: string, packet: PacketVisual | undefined): RouterId | undefined {
  return PRIMARY_TRANSITION_ROUTER[stepId] ?? (packet ? ((packet.to ?? packet.from) as RouterId) : undefined);
}

/** Derives a close-but-non-clipping camera eye offset from a focused object's world-space bounding size (see sr-mpls-foundations for the same helper). */
function eyeOffsetForFocusTarget(target: FocusTarget3D): [number, number, number] {
  const [sx, sy, sz] = target.size ?? [0.6, 0.3, 0.3];
  const maxDim = Math.max(sx, sy, sz);
  const dist = Math.max(0.55, maxDim * 1.8);
  return [dist * 0.55, dist * 0.5, dist * 0.75];
}

