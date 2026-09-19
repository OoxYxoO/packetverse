"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { clsx } from "clsx";
import { useScenarioEngine } from "@/lib/sim-engine/useScenarioEngine";
import type { PacketVisual } from "@/lib/sim-engine/types";
import {
  BGP_STATE_INFO,
  BGP_STATE_LABEL,
  BGP_STATE_ORDER,
  BGP_STATE_VISITED_ORDER,
  DEST_PREFIX,
  GRAPH_EDGES,
  GRAPH_NODES,
  GRAPH_REGIONS,
  ROUTER_AS,
  SESSIONS,
  bgpSteps,
  buildBgpCliCommands,
  createBgpState,
  type BgpPath,
  type BgpState,
  type RouterId,
  type SessionId,
} from "@/lib/sim-engine/scenarios/bgpEnterprise";
import { GraphTopologyViewer, type GraphEdge } from "@/components/network/GraphTopologyViewer";
import { GraphPacket } from "@/components/network/GraphPacket";
import { PacketInspector } from "@/components/network/PacketInspector";
import { ProtocolStateMachine } from "@/components/protocol/ProtocolStateMachine";
import { BgpTableViewer, type BgpPathRow } from "@/components/protocol/BgpTableViewer";
import { BestPathDecisionViewer } from "@/components/protocol/BestPathDecisionViewer";
import { CLIOutputPanel } from "@/components/protocol/CLIOutputPanel";
import { PredictionQuestion } from "@/components/quiz/PredictionQuestion";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { useProgressStore } from "@/lib/state/useProgressStore";
import { NetworkScene3D } from "@/components/network3d/NetworkScene3D";
import { NodeInspectorPanel } from "@/components/network3d/NodeInspectorPanel";
import { PacketFocusPanel } from "@/components/network3d/PacketFocusPanel";
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
import {
  ATTRIBUTE_INFO,
  PRIMARY_TRANSITION_ROUTER,
  dataForwardTrace,
  dataPlaneHopChain,
  diagnosticLayersFor,
  explainRouter,
  fsmTransitionFor,
  interfacesFor,
  linkDetailFor,
  packetFramesFor,
  regionInfoFor,
  traceFor,
} from "./deviceTrace";

const DEVICE_ROUTERS: RouterId[] = ["R1", "R2", "R3", "R4"];
const LOCAL_PREF_OPTIONS = [50, 100, 150, 200, 300];
const PACKET_STEP_COUNT = bgpSteps.filter((s) => !!s.packet).length;
const LOCALPREF_STEP_INDEX = bgpSteps.findIndex((s) => s.id === "localpref-change");
const AS_TO_REGION: Record<number, string> = { 65001: "as-65001", 65010: "as-65010", 65020: "as-65020" };
const ATTRIBUTE_IDS = ["AS_PATH", "NEXT_HOP", "LOCAL_PREF", "MED", "ORIGIN"] as const;

const WHY_BGP: { q: string; a: string }[] = [
  { q: "WHAT is BGP?", a: "A path-vector protocol autonomous systems use to exchange reachability with each other." },
  { q: "WHY does it exist?", a: "An IGP like OSPF only runs inside one AS — it has no concept of AS boundaries or inter-AS policy." },
  { q: "eBGP vs iBGP?", a: "eBGP peers with a different AS (R1↔R3, R2↔R4). iBGP peers within the same AS (R1↔R2), sharing what each learned externally." },
  { q: "WHEN to use it?", a: "Multihoming to more than one provider, or exchanging routes with any external network you don't administer." },
];

function toBgpPathRow(p: BgpPath): BgpPathRow {
  return {
    id: p.id,
    label: p.label,
    nextHop: p.attrs.nextHop,
    localPref: p.attrs.localPref,
    asPath: p.attrs.asPath,
    med: p.attrs.med,
    origin: p.attrs.origin,
    peerType: p.attrs.peerType,
    valid: p.valid,
    best: p.best,
    installed: p.installed,
    nextHopReachable: p.nextHopReachable,
  };
}

export default function BgpEnterpriseDemo() {
  const { engine, snapshot } = useScenarioEngine<BgpState>(createBgpState(), bgpSteps);
  const [autoPlay, setAutoPlay] = useState(false);
  const [speed, setSpeed] = useState<0.5 | 1 | 2>(1);
  const [viewMode, setViewMode] = useState<"physical" | "logical" | "3d">("physical");
  const [focusRouter, setFocusRouter] = useState<"R1" | "R2">("R1");
  const [highlightedAs, setHighlightedAs] = useState<number | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | undefined>(undefined);
  const [cameraMode, setCameraMode] = useState<CameraMode | "bestPath">("overview");
  const [enteredDeviceId, setEnteredDeviceId] = useState<RouterId | undefined>(undefined);
  const [deviceXray, setDeviceXray] = useState(true);
  const [autoEnterDevices, setAutoEnterDevices] = useState(true);
  const [selectedInterfaceId, setSelectedInterfaceId] = useState<string | undefined>(undefined);
  const [selectedLinkId, setSelectedLinkId] = useState<string | undefined>(undefined);
  const [packetSelected, setPacketSelected] = useState(false);
  const [selectedRegionId, setSelectedRegionId] = useState<string | undefined>(undefined);
  const [vendorView, setVendorView] = useState<"concept" | "cisco" | "juniper">("concept");
  const [selectedAttribute, setSelectedAttribute] = useState<string | undefined>(undefined);
  const [planeView, setPlaneView] = useState<PlaneView>("both");
  const [sendingUserPacket, setSendingUserPacket] = useState(false);
  const [userPacketHop, setUserPacketHop] = useState(0);
  const [sentPackets, setSentPackets] = useState<{ when: "before" | "after"; path: string[]; viaIsp?: string }[]>([]);
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

  const { state, currentStep, index, totalSteps, isComplete, lastAnswer, whatChanged, activePacket } = snapshot;
  const canAdvance = engine.canAdvance();

  const edges: GraphEdge[] = useMemo(
    () =>
      GRAPH_EDGES.map((e) => {
        if (e.a === "DEST" || e.b === "DEST") return { id: e.id, a: e.a, b: e.b, state: "full" as const };
        const sessionId = `${e.a}-${e.b}` as SessionId;
        const altId = `${e.b}-${e.a}` as SessionId;
        const session = state.sessions[sessionId] ?? state.sessions[altId];
        const edgeState = session?.bgp === "ESTABLISHED" ? "full" : session?.bgp && session.bgp !== "IDLE" ? "forming" : "down";
        return { id: e.id, a: e.a, b: e.b, label: e.label, state: edgeState };
      }),
    [state.sessions],
  );

  const activeNodeIds = activePacket ? [activePacket.from, activePacket.to] : [];
  const packetFrom = activePacket ? GRAPH_NODES.find((n) => n.id === activePacket.from) : undefined;
  const packetTo = activePacket ? GRAPH_NODES.find((n) => n.id === activePacket.to) : undefined;
  const highlightedRegionIds = highlightedAs && AS_TO_REGION[highlightedAs] ? [AS_TO_REGION[highlightedAs]] : [];

  const cliCommands = useMemo(() => buildBgpCliCommands(state, focusRouter), [state, focusRouter]);

  // --- 3D derived state (Scene Adapter = deviceTrace.ts; no protocol logic here or in components/network3d/) ---
  const nodes3DBase = useMemo(() => layoutTo3D(GRAPH_NODES), []);
  const regions3D = useMemo(() => layoutRegionsTo3D(GRAPH_REGIONS), []);

  const adjacentRouters = new Set<RouterId>();
  for (const sid of Object.keys(SESSIONS) as SessionId[]) {
    if (state.sessions[sid].bgp !== "IDLE") {
      adjacentRouters.add(SESSIONS[sid].a);
      adjacentRouters.add(SESSIONS[sid].b);
    }
  }
  const nodes3D = nodes3DBase.map((n) => {
    let status: Node3DStatus = "idle";
    if (n.id === selectedNodeId || n.id === enteredDeviceId) status = "selected";
    else if (activePacket && (n.id === activePacket.from || n.id === activePacket.to)) status = "active";
    else if (adjacentRouters.has(n.id as RouterId)) status = "onPath";
    const sessionStates = DEVICE_ROUTERS.includes(n.id as RouterId)
      ? (Object.keys(SESSIONS) as SessionId[]).filter((sid) => SESSIONS[sid].a === n.id || SESSIONS[sid].b === n.id).map((sid) => state.sessions[sid].bgp)
      : [];
    const badge = sessionStates.some((s) => s === "ESTABLISHED") ? "ESTABLISHED" : sessionStates.some((s) => s !== "IDLE") ? "FORMING" : undefined;
    return { ...n, status, badges: badge ? [badge] : undefined };
  });

  const links3D: Link3DData[] = GRAPH_EDGES.map((e) => {
    const active = activePacket ? (e.a === activePacket.from && e.b === activePacket.to) || (e.b === activePacket.from && e.a === activePacket.to) : false;
    const sess = state.sessions[e.id as SessionId];
    if (!sess) return { id: e.id, a: e.a, b: e.b, label: e.label, active, onPath: false };
    return { id: e.id, a: e.a, b: e.b, label: e.label ?? SESSIONS[e.id as SessionId].type, active, onPath: sess.bgp === "ESTABLISHED" };
  });

  const activePacket3D: ActivePacket3D | undefined = activePacket && nodes3D.some((n) => n.id === activePacket.from) && nodes3D.some((n) => n.id === activePacket.to) ? { packet: activePacket, fromId: activePacket.from, toId: activePacket.to } : undefined;
  const selectedNode3D = nodes3D.find((n) => n.id === selectedNodeId);

  // --- Data-plane demonstration (brief §24/§25) — the hop chain comes straight from dataPlaneHopChain(), which
  // only follows the ALREADY-decided .best/.installed/.advertisedBy fields; nothing here re-runs best-path. ---
  const userPacketPath = useMemo(() => dataPlaneHopChain(state, "R1") ?? [], [state]);
  const userPacketPathKey = userPacketPath.join(">");
  const dataPacketAtRouter = sendingUserPacket && userPacketHop < userPacketPath.length - 1 ? userPacketPath[userPacketHop] : undefined;
  const dataPacketNextRouter = sendingUserPacket && userPacketHop < userPacketPath.length - 1 ? userPacketPath[userPacketHop + 1] : undefined;
  const dataPacketDelivered = sendingUserPacket && userPacketHop >= userPacketPath.length - 1;
  const dataPacket3D: ActivePacket3D | undefined =
    dataPacketAtRouter && dataPacketNextRouter
      ? {
          packet: {
            id: `data-hop-${userPacketHop}`,
            protocol: "IP",
            from: dataPacketAtRouter,
            to: dataPacketNextRouter,
            summary: `Normal IP packet — enterprise host → ${DEST_PREFIX}`,
            layers: [
              {
                name: "IPv4",
                color: "var(--pv-proto-ip)",
                fields: [
                  { label: "Source", value: "Enterprise host (AS65001)" },
                  { label: "Destination", value: `${DEST_PREFIX} (AS65030)` },
                  { label: "Note", value: "Carried using the route BGP installed — not a BGP packet itself" },
                ],
              },
            ],
          },
          fromId: dataPacketAtRouter,
          toId: dataPacketNextRouter,
        }
      : undefined;

  useEffect(() => {
    if (!sendingUserPacket) return;
    if (userPacketHop >= userPacketPath.length - 1) {
      const when: "before" | "after" = index < LOCALPREF_STEP_INDEX ? "before" : "after";
      const path = userPacketPath;
      const viaIsp = state.bgpTables.R1.find((p) => p.best)?.isp;
      const t = setTimeout(() => {
        setSentPackets((prev) => [...prev.filter((p) => p.when !== when), { when, path, viaIsp }]);
        setSendingUserPacket(false);
      }, 1400);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setUserPacketHop((h) => h + 1), 1300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sendingUserPacket, userPacketHop, userPacketPathKey]);

  const beforePacket = sentPackets.find((p) => p.when === "before");
  const afterPacket = sentPackets.find((p) => p.when === "after");

  const showControlPlane = planeView !== "data";
  const showDataPlane = planeView !== "control";

  // Which router (if any) is actively processing the current packet/event right now — drives auto-enter in Packet Follow mode.
  const activeDeviceId =
    (dataPacketAtRouter && dataPacketAtRouter !== "DEST" ? (dataPacketAtRouter as RouterId) : undefined) ??
    PRIMARY_TRANSITION_ROUTER[currentStep?.id ?? ""] ??
    DEVICE_ROUTERS.find((r) => traceFor(r, state, currentStep?.id ?? "", activePacket).activeStageId !== undefined);
  const effectiveDeviceId = cameraMode === "device" ? enteredDeviceId : cameraMode === "packetFollow" && autoEnterDevices ? activeDeviceId : undefined;
  const inDeviceMode = !!effectiveDeviceId;

  const deviceTrace =
    effectiveDeviceId && dataPacketAtRouter === effectiveDeviceId && dataPacketNextRouter
      ? dataForwardTrace(effectiveDeviceId, dataPacketNextRouter)
      : effectiveDeviceId
        ? traceFor(effectiveDeviceId, state, currentStep?.id ?? "", activePacket)
        : undefined;

  const followPacketIntoCurrentDevice = () => {
    if (!packetSelected || cameraMode !== "device") return;
    const snap = engine.getSnapshot();
    const nextDevice = PRIMARY_TRANSITION_ROUTER[snap.currentStep?.id ?? ""] ?? DEVICE_ROUTERS.find((r) => traceFor(r, snap.state, snap.currentStep?.id ?? "", snap.activePacket).activeStageId !== undefined);
    if (nextDevice) setEnteredDeviceId(nextDevice);
  };

  const deviceInterfaces = effectiveDeviceId ? interfacesFor(effectiveDeviceId, state, currentStep?.id ?? "", activePacket) : [];
  const devicePacketFrames = effectiveDeviceId ? packetFramesFor(activePacket) : undefined;

  // --- Generic 3D object-focus sub-state ("3D Inspection & Selection UX
  // Pass" / "Universal Interactive Topology Migration" §25) — layered ON
  // TOP of `cameraMode`, never a 5th camera mode. Only reachable from the
  // device-interior scene, so it reuses `deviceTrace`/`deviceInterfaces`/
  // `devicePacketFrames` (the camera-following ones), never a separate
  // computation. Cleared automatically once the object it names is no
  // longer present in current data.
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

  const followNode3D = cameraMode === "packetFollow" && activePacket ? nodes3D.find((n) => n.id === activePacket.to) : undefined;
  const PACKET_FOLLOW_DEVICE_EYE_OFFSET: [number, number, number] = [1.7, 3.3, 6.6];
  const focusPosition3D: [number, number, number] | undefined = activeFocusedObject
    ? activeFocusedObject.position
    : cameraMode === "freeOrbit"
      ? undefined
      : cameraMode === "bestPath"
        ? [0, 0, 0]
        : inDeviceMode
          ? [0, 0, deviceXray ? -0.2 : 0]
          : cameraMode === "packetFollow"
            ? followNode3D?.position
            : selectedNode3D?.position;
  const eyeOffset3D: [number, number, number] | undefined = activeFocusedObject
    ? eyeOffsetForFocusTarget(activeFocusedObject)
    : cameraMode === "bestPath"
      ? [0.01, 9, 0.01]
      : inDeviceMode
        ? cameraMode === "packetFollow"
          ? PACKET_FOLLOW_DEVICE_EYE_OFFSET
          : deviceXray
            ? [0.6, 2.6, 5.2]
            : [2.1, 1.5, 3.8]
        : undefined;

  const explainTargetId = effectiveDeviceId ?? selectedNodeId ?? followNode3D?.id;
  const nodeExplanation = explainTargetId && DEVICE_ROUTERS.includes(explainTargetId as RouterId) ? explainRouter(state, explainTargetId as RouterId, currentStep?.id ?? "", activePacket) : undefined;
  const xrayPacket = activePacket && (selectedNodeId === activePacket.from || selectedNodeId === activePacket.to) ? activePacket : undefined;
  const questionActive = !isComplete && !!currentStep?.question && lastAnswer?.stepId !== currentStep.id;

  // --- Hop Inspector target ("Universal Interactive Topology Migration"
  // §23) — explicit selection wins outright, matching SR-MPLS's rule:
  // selectedNodeId > effectiveDeviceId > activeDeviceId. Decoupled from
  // `inDeviceMode` so a plain node click (no "Enter Device") already
  // shows that router's Hop Inspector inside Focus Mode.
  const focusInspectDeviceId = (selectedNodeId ?? effectiveDeviceId ?? activeDeviceId) as RouterId | undefined;
  const focusTrace =
    focusInspectDeviceId && dataPacketAtRouter === focusInspectDeviceId && dataPacketNextRouter
      ? dataForwardTrace(focusInspectDeviceId, dataPacketNextRouter)
      : focusInspectDeviceId
        ? traceFor(focusInspectDeviceId, state, currentStep?.id ?? "", activePacket)
        : undefined;
  const focusInterfaces = focusInspectDeviceId ? interfacesFor(focusInspectDeviceId, state, currentStep?.id ?? "", activePacket) : undefined;

  // --- HopTimeline data — every packet-carrying OR FSM-transition step
  // completed so far (`PRIMARY_TRANSITION_ROUTER` already identifies the
  // no-packet transition steps — TCP/BGP state moves with no message of
  // their own), re-describing `bgpSteps`/`index` rather than a separate
  // journey log, since BgpState tracks FSM/table state, not a growing
  // per-hop array the way SR-MPLS's `state.journey` does.
  const journeyStepIndices = bgpSteps
    .map((s, i) => ({ s, i }))
    .filter(({ s, i }) => i <= index && (!!s.packet || PRIMARY_TRANSITION_ROUTER[s.id] !== undefined));
  const journeyHopEntries = journeyStepIndices.map(({ s, i }) => ({ id: s.id, label: s.label, index: i }));

  // --- Historical inspection ("Historical Timeline Inspection Fix" §3/§4)
  // — reuses ScenarioEngine's OWN `stateByIndex` snapshot (exposed via
  // `getStateAt`) rather than a second, hand-rolled journey record: the
  // engine already freezes the exact state at the moment each index was
  // entered, which is what `goTo()` itself restores from. Presentation-
  // only — never calls `engine.goTo()`, so the live lesson never moves.
  const historicalState = historicalIndex !== undefined ? engine.getStateAt(historicalIndex) : undefined;
  const historicalStep = historicalIndex !== undefined ? bgpSteps[historicalIndex] : undefined;
  const historicalPacket = historicalStep && historicalState ? historicalStep.packet?.(historicalState) : undefined;
  const historicalDeviceId = historicalStep && historicalState ? deviceForStep(historicalStep.id, historicalPacket) : undefined;
  const historicalTrace =
    historicalDeviceId && historicalState
      ? traceFor(historicalDeviceId, historicalState, historicalStep!.id, historicalPacket)
      : undefined;
  const historicalInterfaces = historicalDeviceId && historicalState ? interfacesFor(historicalDeviceId, historicalState, historicalStep!.id, historicalPacket) : undefined;

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
      return { title: frame?.text ?? target.id, fields: frame ? [{ label: "Layer type", value: frame.tone }] : [] };
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

  function handleCameraModeChange(v: CameraMode | "bestPath") {
    setCameraMode(v);
    if (v === "device" && !enteredDeviceId) setEnteredDeviceId((selectedNodeId && DEVICE_ROUTERS.includes(selectedNodeId as RouterId) ? (selectedNodeId as RouterId) : undefined) ?? activeDeviceId ?? "R1");
    if (v === "overview") {
      setEnteredDeviceId(undefined);
      setSelectedNodeId(undefined);
    }
    if (v === "freeOrbit" || v === "bestPath") setEnteredDeviceId(undefined);
  }

  // --- Manual object focus vs. Play — resuming playback is an explicit
  // request to keep watching the journey move, so it takes priority over
  // a previously-focused stage/layer/interface (see sr-mpls-foundations
  // for the same rule).
  function handleToggleAutoPlay() {
    if (!autoPlay) {
      setFocusedObject(undefined);
      setHistoricalIndex(undefined);
      setInspectorSurface("hop");
    }
    setAutoPlay((v) => !v);
  }

  const selectedLinkDetail = selectedLinkId ? linkDetailFor(selectedLinkId, state, activePacket) : undefined;
  const selectedRegionInfo = selectedRegionId ? regionInfoFor(selectedRegionId, state) : undefined;
  const packetCurrentDeviceLabel = effectiveDeviceId ?? activePacket?.to ?? activePacket?.from ?? "—";
  const packetDirection = activePacket ? `${activePacket.from} → ${activePacket.to}` : "—";
  const packetStepsSoFar = bgpSteps.slice(0, index + 1).filter((s) => !!s.packet).length;

  const fsmTransition = fsmTransitionFor(currentStep?.id ?? "");

  // Reset the attribute-X-ray selection whenever the active UPDATE packet changes — render-time
  // "adjust state when a prop changes" per React's own guidance, not an effect.
  const updatePacketKey = activePacket?.badge === "UPDATE" ? activePacket.id : "";
  const [prevUpdateKey, setPrevUpdateKey] = useState(updatePacketKey);
  if (prevUpdateKey !== updatePacketKey) {
    setPrevUpdateKey(updatePacketKey);
    if (selectedAttribute !== undefined) setSelectedAttribute(undefined);
  }

  const explorerCliCommands = useMemo(() => buildBgpCliCommands(state, effectiveDeviceId ?? "R1"), [state, effectiveDeviceId]);
  const explorerPaths = state.bgpTables[effectiveDeviceId ?? "R1"] ?? [];
  const explorerInstalled = explorerPaths.filter((p) => p.installed);
  const explorerDiagnostics = effectiveDeviceId ? diagnosticLayersFor(state, effectiveDeviceId) : [];

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
                        <span className={d.ok ? "text-pv-success" : "text-pv-danger"}>
                          {d.ok ? "✓" : "✕"}
                          {d.detail ? ` ${d.detail}` : ""}
                        </span>
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
                  Generic stylized BGP router chassis — {deviceInterfaces.length} physical interface{deviceInterfaces.length === 1 ? "" : "s"}.
                </p>
                <p className="pv-mono text-[11px] text-pv-text-faint">Rotate in the 3D view to inspect the hardware; click a port to select it in the Interfaces tab.</p>
              </div>
            ),
          },
          {
            id: "interfaces",
            label: "Interfaces",
            content: <InterfaceListTab interfaces={deviceInterfaces} selectedInterfaceId={selectedInterfaceId} onSelectInterface={setSelectedInterfaceId} />,
          },
          { id: "peers", label: "Peers", content: <PeersTab router={effectiveDeviceId} state={state} /> },
          {
            id: "bgptable",
            label: "BGP Table",
            content: <BgpTableViewer title={`${effectiveDeviceId} BGP Table`} prefix={DEST_PREFIX} paths={explorerPaths.map(toBgpPathRow)} onHoverAs={setHighlightedAs} highlightedAs={highlightedAs} />,
          },
          {
            id: "routes",
            label: "Routes",
            content:
              explorerInstalled.length === 0 ? (
                <p className="text-xs text-pv-text-faint">No installed route yet — a path can be received and valid without being installed.</p>
              ) : (
                <div className="space-y-2">
                  {explorerInstalled.map((p) => (
                    <div key={p.id} className="rounded-lg border border-pv-success/40 bg-pv-success/5 p-2.5 pv-mono text-[11px]">
                      <p className="text-pv-text">
                        {DEST_PREFIX} via {p.attrs.nextHop}
                      </p>
                      <p className={p.nextHopReachable ? "text-pv-success" : "text-pv-danger"}>{p.nextHopReachable ? "Usable" : "NOT usable — NEXT_HOP unreachable"}</p>
                    </div>
                  ))}
                </div>
              ),
          },
          {
            id: "packet",
            label: "Packet",
            content: (
              <div className="space-y-2">
                {(nodeExplanation.packetBefore || nodeExplanation.packetAfter) && (
                  <div className="rounded-lg border border-pv-border p-2.5 pv-mono text-[11px]">
                    {nodeExplanation.packetBefore && (
                      <p className="text-pv-text-muted">
                        Before: <span className="text-pv-text">{nodeExplanation.packetBefore}</span>
                      </p>
                    )}
                    {nodeExplanation.packetAfter && (
                      <p className="text-pv-text-muted">
                        After: <span className="text-pv-cyan-soft">{nodeExplanation.packetAfter}</span>
                      </p>
                    )}
                  </div>
                )}
                {activePacket && effectiveDeviceId && (activePacket.from === effectiveDeviceId || activePacket.to === effectiveDeviceId) ? (
                  <PacketInspector packet={activePacket} />
                ) : (
                  <p className="text-xs text-pv-text-faint">No packet at this device right now.</p>
                )}
              </div>
            ),
          },
          {
            id: "policy",
            label: "Policy",
            content: (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-x-3 gap-y-1 pv-mono text-[11px]">
                  <span className="text-pv-text-faint">next-hop-self</span>
                  <span className="text-pv-text">{state.nextHopSelf ? "Applied" : "Not applied"}</span>
                  <span className="text-pv-text-faint">ISP-A LOCAL_PREF</span>
                  <span className="text-pv-text">{state.externalPaths["ISP-A"].localPref}</span>
                  <span className="text-pv-text-faint">ISP-B LOCAL_PREF</span>
                  <span className="text-pv-text">{state.externalPaths["ISP-B"].localPref}</span>
                  <span className="text-pv-text-faint">ISP-B AS_PATH</span>
                  <span className="text-pv-text">{state.externalPaths["ISP-B"].asPathTail.join(" ")}</span>
                </div>
                {currentStep?.id === "challenge" && (
                  <ChallengeControl
                    options={LOCAL_PREF_OPTIONS}
                    triedValue={state.challengeLocalPref}
                    succeeded={state.challengeSucceeded}
                    bestIsp={state.bgpTables.R1.find((p) => p.best)?.isp}
                    bestCost={state.bgpTables.R1.find((p) => p.best)?.attrs.localPref}
                    onTry={(localPref) => engine.act({ localPref })}
                  />
                )}
              </div>
            ),
          },
          { id: "cli", label: "CLI", content: <CLIOutputPanel commands={explorerCliCommands} /> },
        ]
      : [];

  useEffect(() => {
    if (isComplete && !awardedRef.current) {
      awardedRef.current = true;
      completeLesson("bgp-fundamentals", 200);
      unlockAchievement("path-architect");
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
    setCameraMode("overview");
    setEnteredDeviceId(undefined);
    setSelectedNodeId(undefined);
    setSelectedLinkId(undefined);
    setPacketSelected(false);
    setSelectedRegionId(undefined);
    setSelectedAttribute(undefined);
    setHighlightedAs(null);
    setSendingUserPacket(false);
    setUserPacketHop(0);
    setSentPackets([]);
    setFocusedObject(undefined);
    setHistoricalIndex(undefined);
    setInspectorSurface("hop");
  };

  const nextLabel = currentStep?.question && !lastAnswer ? "Answer to continue" : currentStep?.requiresState && !canAdvance ? "Change policy to continue" : "Next Step →";

  const focusPaths = state.bgpTables[focusRouter] ?? [];
  const focusCriteria = state.decisionTrace[focusRouter] ?? [];
  const focusDecidedBy = state.decidedBy[focusRouter];

  return (
    <div className="mx-auto max-w-7xl px-6 py-10">
      <div className="mb-6">
        <Badge tone="cyan" className="mb-3">
          BGP · eBGP + iBGP · Enterprise Multihoming
        </Badge>
        <h1 className="text-2xl font-semibold text-pv-text sm:text-3xl">AS65001 Reaches The Internet</h1>
        <p className="mt-2 max-w-3xl text-sm text-pv-text-muted">
          R1 peers externally with ISP-A, R2 peers externally with ISP-B, and R1↔R2 share what each learns over iBGP. Build the
          sessions yourself, watch the best-path decision run on real attributes, then change the outcome with policy.
        </p>
      </div>

      <div className="mb-6 grid gap-2 sm:grid-cols-4">
        {WHY_BGP.map((item) => (
          <GlassPanel key={item.q} className="p-3">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-pv-cyan-soft">{item.q}</p>
            <p className="text-[11px] leading-snug text-pv-text-muted">{item.a}</p>
          </GlassPanel>
        ))}
      </div>

      {/* TIMELINE */}
      <div className="mb-6 flex gap-1 overflow-x-auto pb-2">
        {bgpSteps.map((step, i) => (
          <button
            key={step.id}
            type="button"
            disabled={i > index}
            onClick={() => i < index && engine.goTo(i)}
            title={step.label}
            className={clsx(
              "h-1.5 flex-1 min-w-4 rounded-full transition-colors",
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
        {viewMode === "3d" && (
          <>
            <TopologyModeSwitcher
              options={[
                { value: "overview", label: "Overview" },
                { value: "device", label: "Device" },
                { value: "packetFollow", label: "Packet Follow" },
                { value: "bestPath", label: "Best Path Analysis" },
                { value: "freeOrbit", label: "Free Orbit" },
              ]}
              value={cameraMode}
              onChange={handleCameraModeChange}
            />
            {inDeviceMode && (
              <TopologyModeSwitcher
                options={[
                  { value: "off", label: "Exterior" },
                  { value: "on", label: "Control-Plane X-Ray" },
                ]}
                value={deviceXray ? "on" : "off"}
                onChange={(v) => setDeviceXray(v === "on")}
                tone="violet"
              />
            )}
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
            {cameraMode === "bestPath" && (
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
                // modal (see sr-mpls-foundations for the same fix).
                <div className="h-96 w-full rounded-2xl border border-pv-border bg-pv-bg-elevated sm:h-[28rem]" />
              ) : (
              <NetworkScene3D
                nodes={nodes3D}
                links={links3D}
                activePacket={inDeviceMode ? undefined : dataPacket3D ? (showDataPlane ? dataPacket3D : undefined) : showControlPlane ? activePacket3D : undefined}
                regions={cameraMode === "overview" || cameraMode === "bestPath" ? regions3D : []}
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
                        pipelineTitle: "Conceptual BGP Control-Plane Pipeline",
                        onFocusObject: setFocusedObject,
                        focusedObjectId: activeFocusedObject?.id,
                      }
                    : undefined
                }
              />
              )}
              </TopologyFrame>

              {cameraMode === "bestPath" && (
                <GlassPanel strong className="space-y-4 p-5">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-pv-cyan-soft">Best-Path Decision Chamber — {focusRouter}</h3>
                    <div className="flex gap-1 rounded-full border border-pv-border p-0.5 w-fit">
                      {(["R1", "R2"] as const).map((r) => (
                        <button
                          key={r}
                          type="button"
                          onClick={() => setFocusRouter(r)}
                          className={clsx("rounded-full px-3 py-1 text-[11px] font-semibold pv-mono transition-colors", focusRouter === r ? "bg-pv-cyan/15 text-pv-cyan-soft" : "text-pv-text-faint hover:text-pv-text")}
                        >
                          {r}
                        </button>
                      ))}
                    </div>
                  </div>
                  {focusPaths.length > 0 && (
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      {focusPaths.map((p) => (
                        <div key={p.id} className={clsx("rounded-lg border p-3 pv-mono text-[11px]", p.best ? "border-pv-success/50 bg-pv-success/5" : "border-pv-border")}>
                          <div className="mb-1 flex items-center justify-between">
                            <span className="font-semibold text-pv-text">{p.label}</span>
                            {p.best && <Badge tone="success">Wins</Badge>}
                          </div>
                          <p className="text-pv-text-muted">
                            LOCAL_PREF {p.attrs.localPref} · AS_PATH {p.attrs.asPath.length} hop{p.attrs.asPath.length === 1 ? "" : "s"}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                  {focusCriteria.length > 0 ? (
                    <BestPathDecisionViewer
                      title={`${focusRouter} Best-Path Decision (this lesson's simplified order)`}
                      criteria={focusCriteria}
                      decidedBy={focusDecidedBy}
                      vendorNote={vendorView === "concept" ? "Cisco commonly evaluates its own proprietary Weight attribute before Local Preference. Junos doesn't use Weight and expresses routing preference differently. This chamber shows the standards-level concept." : undefined}
                    />
                  ) : (
                    <p className="text-xs text-pv-text-faint">No candidate paths to compare yet — advance the scenario until {focusRouter} has received UPDATEs from both sources.</p>
                  )}
                  {vendorView === "cisco" && (
                    <div className="rounded-lg border border-pv-warning/40 bg-pv-warning/5 p-3 text-xs text-pv-text-muted">
                      <span className="mb-1 block font-semibold text-pv-text">Cisco IOS note</span>
                      Cisco evaluates a router-local <span className="pv-mono text-pv-text">Weight</span> attribute (0–65535, higher preferred) BEFORE Local Preference. Weight is Cisco-proprietary, never advertised to any peer, and is NOT part of standard BGP — it isn&apos;t modeled in this concept-level chamber.
                    </div>
                  )}
                  {vendorView === "juniper" && (
                    <div className="rounded-lg border border-pv-warning/40 bg-pv-warning/5 p-3 text-xs text-pv-text-muted">
                      <span className="mb-1 block font-semibold text-pv-text">Junos note</span>
                      Junos has no Cisco-style Weight knob. It expresses route preference via each protocol&apos;s <span className="pv-mono text-pv-text">preference</span> value (BGP = 170) and Local Preference the same way this lesson models it — Local Preference is standard BGP, not vendor-specific.
                    </div>
                  )}
                </GlassPanel>
              )}

              {cameraMode === "overview" && showControlPlane && activePacket?.protocol === "BGP" && activePacket.badge === "UPDATE" && (
                <GlassPanel strong className="space-y-3 p-5">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-pv-cyan-soft">UPDATE Attribute X-Ray</h3>
                  <p className="text-xs text-pv-text-muted">Click an attribute to see what it means, whether it&apos;s standard, its propagation scope, and whether it affects this lesson&apos;s best-path decision.</p>
                  <div className="flex flex-wrap gap-1.5">
                    {ATTRIBUTE_IDS.map((attr) => (
                      <button
                        key={attr}
                        type="button"
                        onClick={() => setSelectedAttribute(attr)}
                        className={clsx(
                          "rounded-lg border px-2.5 py-1.5 pv-mono text-[11px] transition-colors",
                          selectedAttribute === attr ? "border-pv-cyan/50 bg-pv-cyan/10 text-pv-cyan-soft" : "border-pv-border text-pv-text-muted hover:text-pv-text",
                        )}
                      >
                        {attr}
                      </button>
                    ))}
                  </div>
                  {selectedAttribute && ATTRIBUTE_INFO[selectedAttribute] && (
                    <div className="space-y-1.5 rounded-lg border border-pv-border bg-black/20 p-3 text-[11px]">
                      <p className="text-sm font-semibold text-pv-text">{selectedAttribute}</p>
                      <p className="text-pv-text-muted">{ATTRIBUTE_INFO[selectedAttribute].purpose}</p>
                      <p className="text-pv-text-faint">
                        <span className="text-pv-cyan-soft">Standard: </span>
                        {ATTRIBUTE_INFO[selectedAttribute].standard}
                      </p>
                      <p className="text-pv-text-faint">
                        <span className="text-pv-cyan-soft">Scope: </span>
                        {ATTRIBUTE_INFO[selectedAttribute].scope}
                      </p>
                      <p className="text-pv-text-faint">
                        <span className="text-pv-cyan-soft">This lesson&apos;s decision: </span>
                        {ATTRIBUTE_INFO[selectedAttribute].affectsDecision}
                      </p>
                    </div>
                  )}
                </GlassPanel>
              )}

              {selectedRegionId && selectedRegionInfo && (
                <GlassPanel strong className="space-y-2 p-5">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-pv-violet">Autonomous System {selectedRegionInfo.asn}</h3>
                    <button type="button" onClick={() => setSelectedRegionId(undefined)} className="text-xs text-pv-text-faint hover:text-pv-text">
                      ✕
                    </button>
                  </div>
                  <div className="grid grid-cols-1 gap-x-3 gap-y-1 pv-mono text-[11px] sm:grid-cols-2">
                    <span className="text-pv-text-faint">ASN</span>
                    <span className="text-pv-text">{selectedRegionInfo.asn}</span>
                    <span className="text-pv-text-faint">Internal Routers</span>
                    <span className="text-pv-text">{selectedRegionInfo.internalRouters.join(", ")}</span>
                    <span className="text-pv-text-faint">External BGP Peers</span>
                    <span className="text-pv-text">{selectedRegionInfo.externalPeers.map((p) => `${p.from}→${p.to}`).join(", ") || "none"}</span>
                    <span className="text-pv-text-faint">Advertised Prefixes</span>
                    <span className="text-pv-text">{selectedRegionInfo.advertisedPrefixes.join(", ") || "none"}</span>
                  </div>
                </GlassPanel>
              )}

              {cameraMode === "overview" && showDataPlane && (
                <GlassPanel strong className="space-y-3 p-5">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-pv-cyan-soft">Data Plane — Normal IP Forwarding</h3>
                  <p className="text-xs text-pv-text-muted">BGP built the routing information. This sends one ordinary IP packet from an enterprise host toward {DEST_PREFIX}, using the route already installed — BGP itself never forwards it.</p>
                  <Button
                    size="sm"
                    disabled={userPacketPath.length === 0 || sendingUserPacket}
                    onClick={() => {
                      setSendingUserPacket(true);
                      setUserPacketHop(0);
                    }}
                  >
                    {userPacketPath.length === 0 ? "No BGP route yet" : sendingUserPacket ? (dataPacketDelivered ? "Delivered" : `In flight: ${dataPacketAtRouter} → ${dataPacketNextRouter}`) : "Send Test Packet →"}
                  </Button>
                  {(beforePacket || afterPacket) && (
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <div className={clsx("rounded-lg border p-3", beforePacket ? "border-pv-border" : "border-pv-border/40")}>
                        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-pv-text-faint">Before Local Preference Change</p>
                        {beforePacket ? (
                          <p className="pv-mono text-xs text-pv-text">
                            {beforePacket.path.join(" → ")} <span className="text-pv-text-faint">(via {beforePacket.viaIsp})</span>
                          </p>
                        ) : (
                          <p className="text-xs text-pv-text-faint">Not sent yet.</p>
                        )}
                      </div>
                      <div className={clsx("rounded-lg border p-3", afterPacket ? "border-pv-success/50 bg-pv-success/5" : "border-pv-border/40")}>
                        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-pv-text-faint">After Local Preference Change</p>
                        {afterPacket ? (
                          <p className="pv-mono text-xs text-pv-text">
                            {afterPacket.path.join(" → ")} <span className="text-pv-text-faint">(via {afterPacket.viaIsp})</span>
                          </p>
                        ) : (
                          <p className="text-xs text-pv-text-faint">Not sent yet.</p>
                        )}
                      </div>
                    </div>
                  )}
                </GlassPanel>
              )}

              {cameraMode === "packetFollow" && (
                <PacketFocusPanel
                  currentHopLabel={activePacket ? `${activePacket.from} → ${activePacket.to}: ${activePacket.summary}` : undefined}
                  hopIndex={packetStepsSoFar}
                  totalHops={PACKET_STEP_COUNT}
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

              {inDeviceMode && !packetSelected && !selectedLinkDetail ? (
                <DeviceExplorerPanel
                  explanation={nodeExplanation!}
                  tabs={explorerTabs}
                  xrayEnabled={deviceXray}
                  onToggleXray={() => setDeviceXray((v) => !v)}
                  xrayOnLabel="Control-Plane X-Ray"
                  onExit={() => {
                    setCameraMode("overview");
                    setEnteredDeviceId(undefined);
                  }}
                />
              ) : selectedNodeId === "DEST" && !packetSelected && !selectedLinkDetail ? (
                <GlassPanel strong className="space-y-2 p-5">
                  <h3 className="pv-mono text-lg font-bold text-pv-text">AS65030</h3>
                  <p className="text-[11px] uppercase tracking-wide text-pv-text-faint">Destination Autonomous System</p>
                  <p className="text-xs text-pv-text-muted">
                    Originates {DEST_PREFIX}. Not a lesson-modeled router — ISP-A and ISP-B each advertise a path toward it, with a different AS_PATH.
                  </p>
                </GlassPanel>
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
            <GraphTopologyViewer nodes={GRAPH_NODES} edges={edges} activeNodeIds={activeNodeIds} regions={GRAPH_REGIONS} highlightedRegionIds={highlightedRegionIds}>
              {activePacket && packetFrom && packetTo && <GraphPacket packet={activePacket} from={packetFrom} to={packetTo} />}
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
            <PredictionQuestion
              question={currentStep.question}
              selectedOptionId={lastAnswer?.stepId === currentStep.id ? lastAnswer.optionId : undefined}
              onAnswer={handleAnswer}
            />
          )}

          {!isComplete && currentStep?.id === "challenge" && (
            <ChallengeControl
              options={LOCAL_PREF_OPTIONS}
              triedValue={state.challengeLocalPref}
              succeeded={state.challengeSucceeded}
              bestIsp={state.bgpTables.R1.find((p) => p.best)?.isp}
              bestCost={state.bgpTables.R1.find((p) => p.best)?.attrs.localPref}
              onTry={(localPref) => engine.act({ localPref })}
            />
          )}

          {whatChanged.length > 0 && !currentStep?.question && currentStep?.id !== "challenge" && (
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
              <Badge tone="success">Path Architect</Badge>
              <h2 className="text-2xl font-semibold text-pv-text">BGP Policy Steered The Path</h2>
              <p className="max-w-md text-sm text-pv-text-muted">
                You brought up eBGP and iBGP sessions from TCP through Established, watched a real best-path decision run twice,
                fixed a NEXT_HOP fault, demonstrated AS-path prepending, and used Local Preference to make AS65001 prefer ISP-B.
                +200 XP awarded.
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
                    className={clsx(
                      "rounded-full px-2.5 py-1 text-[10px] font-semibold pv-mono transition-colors",
                      speed === s ? "bg-pv-cyan/15 text-pv-cyan-soft" : "text-pv-text-faint hover:text-pv-text",
                    )}
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
          {showControlPlane && <PacketInspector packet={activePacket} />}

          {showControlPlane && (
            <ProtocolStateMachine
              title="R1 ↔ R3 BGP FSM (eBGP)"
              states={BGP_STATE_ORDER}
              labels={BGP_STATE_LABEL}
              current={state.sessions["R1-R3"].bgp}
              visited={BGP_STATE_VISITED_ORDER.slice(0, BGP_STATE_VISITED_ORDER.indexOf(state.sessions["R1-R3"].bgp) + 1)}
              descriptions={BGP_STATE_INFO}
            />
          )}

          {showControlPlane && fsmTransition && (
            <GlassPanel className="space-y-1.5 p-4">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-pv-text-muted">FSM Transition</h4>
              <p className="pv-mono text-sm text-pv-text">
                {BGP_STATE_LABEL[fsmTransition.before]} → {BGP_STATE_LABEL[fsmTransition.after]}
              </p>
              <p className="text-xs text-pv-text-faint">
                <span className="text-pv-cyan-soft">Event: </span>
                {fsmTransition.event}
              </p>
              <p className="text-xs text-pv-text-faint">
                <span className="text-pv-cyan-soft">Why: </span>
                {fsmTransition.why}
              </p>
            </GlassPanel>
          )}

          <div className="flex gap-1 rounded-full border border-pv-border p-0.5 w-fit">
            {(["R1", "R2"] as const).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setFocusRouter(r)}
                className={clsx(
                  "rounded-full px-3 py-1 text-[11px] font-semibold pv-mono transition-colors",
                  focusRouter === r ? "bg-pv-cyan/15 text-pv-cyan-soft" : "text-pv-text-faint hover:text-pv-text",
                )}
              >
                {r} (AS{ROUTER_AS[r]})
              </button>
            ))}
          </div>

          {showControlPlane && (
            <BgpTableViewer title={`${focusRouter} BGP Table`} prefix={DEST_PREFIX} paths={focusPaths.map(toBgpPathRow)} onHoverAs={setHighlightedAs} highlightedAs={highlightedAs} />
          )}

          {showControlPlane && focusCriteria.length > 0 && (
            <BestPathDecisionViewer
              title={`${focusRouter} Best-Path Decision (this lesson's simplified order)`}
              criteria={focusCriteria}
              decidedBy={focusDecidedBy}
              vendorNote="Cisco commonly evaluates its own proprietary Weight attribute before Local Preference. Junos doesn't use Weight and expresses routing preference differently. This viewer shows the standards-level concept — see the CLI tabs for how each vendor actually reports it."
            />
          )}

          <GlassPanel className="p-4">
            <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-pv-text-muted">{focusRouter} — Installed Routes</h4>
            {focusPaths.filter((p) => p.installed).length === 0 ? (
              <p className="pv-mono text-xs text-pv-text-faint">EMPTY</p>
            ) : (
              <div className="space-y-1.5">
                {focusPaths
                  .filter((p) => p.installed)
                  .map((p) => (
                    <div key={p.id} className="pv-mono text-[11px]">
                      <span className="text-pv-text">{DEST_PREFIX}</span> <span className="text-pv-text-faint">via</span> <span className={p.nextHopReachable ? "text-pv-success" : "text-pv-danger"}>{p.attrs.nextHop}</span>
                    </div>
                  ))}
              </div>
            )}
          </GlassPanel>

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
                value={cameraMode === "bestPath" ? "overview" : cameraMode}
                onChange={handleCameraModeChange}
              />
              {inDeviceMode && (
                <TopologyModeSwitcher options={[{ value: "off", label: "Exterior" }, { value: "on", label: "Control-Plane X-Ray" }]} value={deviceXray ? "on" : "off"} onChange={(v) => setDeviceXray(v === "on")} tone="violet" />
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
                activePacket={inDeviceMode ? undefined : dataPacket3D ? (showDataPlane ? dataPacket3D : undefined) : showControlPlane ? activePacket3D : undefined}
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
                        pipelineTitle: "Conceptual BGP Control-Plane Pipeline",
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
                    xrayOnLabel="Control-Plane X-Ray"
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
            ) : historicalIndex !== undefined && historicalTrace ? (
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
                currentIndex={historicalIndex !== undefined ? journeyHopEntries.findIndex((h) => h.index === historicalIndex) : journeyHopEntries.length - 1}
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
                  const histStep = bgpSteps[entry.index];
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

function PeersTab({ router, state }: { router: RouterId; state: BgpState }) {
  const sessions = (Object.entries(SESSIONS) as [SessionId, (typeof SESSIONS)[SessionId]][]).filter(([, s]) => s.a === router || s.b === router);
  const [focused, setFocused] = useState<SessionId | undefined>(sessions[0]?.[0]);
  const activeSid = focused ?? sessions[0]?.[0];
  const activeSess = activeSid ? state.sessions[activeSid] : undefined;

  if (sessions.length === 0) return <p className="text-xs text-pv-text-faint">No BGP-enabled neighbors.</p>;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {sessions.map(([sid, s]) => {
          const peer = s.a === router ? s.b : s.a;
          return (
            <button
              key={sid}
              type="button"
              onClick={() => setFocused(sid)}
              className={clsx(
                "rounded-lg border px-2.5 py-1.5 pv-mono text-[11px] transition-colors",
                activeSid === sid ? "border-pv-cyan/50 bg-pv-cyan/10 text-pv-cyan-soft" : "border-pv-border text-pv-text-muted hover:text-pv-text",
              )}
            >
              {peer} (AS{ROUTER_AS[peer]}, {s.type}) — {BGP_STATE_LABEL[state.sessions[sid].bgp]}
            </button>
          );
        })}
      </div>
      {activeSess && (
        <ProtocolStateMachine
          title={`${router} ↔ ${activeSid} BGP FSM`}
          states={BGP_STATE_ORDER}
          labels={BGP_STATE_LABEL}
          current={activeSess.bgp}
          visited={BGP_STATE_VISITED_ORDER.slice(0, BGP_STATE_VISITED_ORDER.indexOf(activeSess.bgp) + 1)}
          descriptions={BGP_STATE_INFO}
        />
      )}
    </div>
  );
}

function ChallengeControl({
  options,
  triedValue,
  succeeded,
  bestIsp,
  bestCost,
  onTry,
}: {
  options: number[];
  triedValue?: number;
  succeeded?: boolean;
  bestIsp?: string;
  bestCost?: number;
  onTry: (localPref: number) => void;
}) {
  return (
    <GlassPanel strong className="p-5">
      <p className="mb-3 text-sm font-medium text-pv-text">Set ISP-B&apos;s Local Preference:</p>
      <div className="flex flex-wrap gap-2">
        {options.map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => onTry(v)}
            className={clsx(
              "rounded-lg border px-3 py-2 text-sm pv-mono transition-colors cursor-pointer",
              v === triedValue ? "border-pv-cyan/60 bg-pv-cyan/10 text-pv-cyan-soft" : "border-pv-border hover:border-pv-cyan/40 hover:bg-pv-cyan/5",
            )}
          >
            {v}
          </button>
        ))}
      </div>

      {triedValue !== undefined && bestIsp && (
        <div
          className={clsx(
            "mt-4 rounded-xl border p-4 text-sm",
            succeeded ? "border-pv-success/50 bg-pv-success/10 text-pv-success" : "border-pv-warning/40 bg-pv-warning/5 text-pv-text-muted",
          )}
        >
          {succeeded ? (
            <>
              <span className="mb-1 block font-semibold">✓ ISP-B is now the best path.</span>
              Local Preference {triedValue} beats ISP-A&apos;s 100 — and LOCAL_PREF is compared before AS_PATH, so it wins regardless of hop count.
            </>
          ) : (
            <>
              <span className="mb-1 block font-semibold text-pv-text">
                Still best via {bestIsp}, Local Preference {bestCost}.
              </span>
              ISP-A holds Local Preference 100 — ISP-B needs a strictly higher value to win.
            </>
          )}
        </div>
      )}
    </GlassPanel>
  );
}

/** Which router is the primary inspection subject of a given step — the packet's receiver (or sender, if no receiver applies) for a message-carrying step, or `PRIMARY_TRANSITION_ROUTER` for a no-packet FSM-transition step. Shared by both live and historical inspection so they agree on "whose hop is this." */
function deviceForStep(stepId: string, packet: PacketVisual | undefined): RouterId | undefined {
  if (packet) return (packet.to ?? packet.from) as RouterId;
  return PRIMARY_TRANSITION_ROUTER[stepId];
}

/** Derives a close-but-non-clipping camera eye offset from a focused object's world-space bounding size, rather than a hardcoded per-kind distance (see sr-mpls-foundations for the same helper). */
function eyeOffsetForFocusTarget(target: FocusTarget3D): [number, number, number] {
  const [sx, sy, sz] = target.size ?? [0.6, 0.3, 0.3];
  const maxDim = Math.max(sx, sy, sz);
  const dist = Math.max(0.55, maxDim * 1.8);
  return [dist * 0.55, dist * 0.5, dist * 0.75];
}
