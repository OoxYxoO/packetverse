"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { clsx } from "clsx";
import { useScenarioEngine } from "@/lib/sim-engine/useScenarioEngine";
import type { DeviceKind } from "@/lib/sim-engine/types";
import {
  ARCHITECTURES,
  ARCHITECTURE_LABEL,
  ARCHITECTURE_PROFILES,
  CE_MAC,
  L2VPN_EVOLUTION_XP_AWARD,
  REQUIREMENT_LABEL,
  STEP_IDX,
  TERMS,
  createL2vpnEvolutionState,
  describeArchitecture,
  evaluateRequirements,
  getStateOwnership,
  hvplsSplitHorizonDemo,
  l2vpnEvolutionSteps,
  labelBlockRecapRows,
  mobilityComparisonDemo,
  multihomingComparisonDemo,
  scalingComparisonRows,
  serviceTopology,
  topologyFor,
  type Architecture,
  type L2vpnEvolutionState,
  type PeId,
  type Requirement,
  type RouterId,
} from "@/lib/sim-engine/scenarios/l2vpnEvolution";
import { GraphTopologyViewer } from "@/components/network/GraphTopologyViewer";
import { GraphPacket } from "@/components/network/GraphPacket";
import { PacketInspector } from "@/components/network/PacketInspector";
import { ForwardingDecisionCard } from "@/components/protocol/ForwardingDecisionCard";
import { EthernetFdbViewer } from "@/components/protocol/EthernetFdbViewer";
import { EvpnRibViewer, type EvpnRibRow } from "@/components/protocol/EvpnRouteTable";
import { ArchitectureComparisonViewer, type ArchitectureComparisonRow } from "@/components/protocol/ArchitectureComparisonViewer";
import { StateOwnershipViewer } from "@/components/protocol/StateOwnershipViewer";
import { TroubleshootingLayers, type DiagnosticLayer } from "@/components/protocol/TroubleshootingLayers";
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
import { DEVICE_ROUTERS, PRIMARY_TRANSITION_ROUTER, deviceForStep, interfacesFor, linkDetailFor, packetFramesFor, traceFor } from "./deviceTrace";

type ViewMode = "physical" | "service";
const CHALLENGE_REQUIREMENTS: Requirement[] = ["multipoint", "native-multihoming", "fast-mac-mobility", "control-plane-mac-ip"];

function kindFor(id: string): DeviceKind {
  if (id.startsWith("CE")) return "laptop";
  if (id.startsWith("MTU")) return "switch";
  if (id === "RR1") return "router";
  if (id.startsWith("PE")) return "pe-router";
  return "router";
}

/** Journey-worthy steps with no `.packet` of their own — a real event (a scaling recap, an EVPN mobility/multihoming comparison) attributed to a fixed subject router, exactly like mpls-ldp's own no-packet control steps. */
const JOURNEY_STEP_IDS = new Set([
  "vpws-signaling-recap",
  "vpls-first-frame-unknown",
  "vpls-source-learn",
  "vpls-known-unicast",
  "bgp-vpls-label-block-recap",
  "incident-symptoms",
  "repair-challenge",
  "verify-dataplane",
  "evpn-ce3-install",
  "evpn-mac-mobility-comparison",
  "evpn-multihoming-comparison",
]);

export default function L2vpnEvolutionDemo() {
  const { engine, snapshot } = useScenarioEngine<L2vpnEvolutionState>(createL2vpnEvolutionState(), l2vpnEvolutionSteps);
  const [manualArchitecture, setManualArchitecture] = useState<Architecture | undefined>(undefined);
  const [viewMode, setViewMode] = useState<ViewMode>("physical");
  const [viewMode3D, setViewMode3D] = useState(false);
  const [autoPlay, setAutoPlay] = useState(false);
  const [speed, setSpeed] = useState<0.5 | 1 | 2>(1);
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
  const [focusedObject, setFocusedObject] = useState<FocusTarget3D | undefined>(undefined);
  /** Presentation cursor for HopTimeline inspection — a step INDEX, never mutates the live lesson. undefined = inspecting the current/live hop. */
  const [historicalIndex, setHistoricalIndex] = useState<number | undefined>(undefined);
  /** Explicit Hop-vs-Device intent inside Focus Mode — set by the actual gesture (node click → device; timeline/next-hop/Play → hop), never inferred from whether a trace object happens to exist. */
  const [inspectorSurface, setInspectorSurface] = useState<InspectorSurface>("hop");

  const completeLesson = useProgressStore((s) => s.completeLesson);
  const recordAnswer = useProgressStore((s) => s.recordAnswer);
  const unlockAchievement = useProgressStore((s) => s.unlockAchievement);

  const { state, currentStep, index, totalSteps, isComplete, lastAnswer, whatChanged, activePacket } = snapshot;
  const canAdvance = engine.canAdvance();

  // Auto-follows the arc as it progresses; a manual selector click
  // overrides this until Restart, so the learner can still freely
  // browse any architecture at any time.
  const autoArchitecture: Architecture = useMemo(() => {
    if (index >= STEP_IDX.evpnTransitionQuestion) return "EVPN";
    if (index >= STEP_IDX.hvplsTopology) return "H_VPLS";
    if (index >= STEP_IDX.bgpVplsIntro) return "BGP_VPLS";
    if (index >= STEP_IDX.vplsTopology) return "VPLS";
    return "VPWS";
  }, [index]);
  const selectedArchitecture = manualArchitecture ?? autoArchitecture;
  const setSelectedArchitecture = (a: Architecture) => {
    setManualArchitecture(a);
    if (a !== "BGP_VPLS") setViewMode("physical");
  };
  // Only BGP-VPLS has a genuinely distinct control-plane topology (the RR1
  // star) vs. its own service topology (the PE-to-PE mesh) — every other
  // architecture's "physical" view already IS its service topology, so
  // offering the toggle there would either be a no-op (EVPN) or actively
  // wrong (H-VPLS's hierarchy is not interchangeable with a flat mesh).
  const showServiceToggle = selectedArchitecture === "BGP_VPLS";

  useEffect(() => {
    if (isComplete) {
      completeLesson("l2vpn-evolution", L2VPN_EVOLUTION_XP_AWARD);
      unlockAchievement("l2vpn-architect");
    }
  }, [isComplete, completeLesson, unlockAchievement]);

  useEffect(() => {
    if (!autoPlay || !canAdvance || isComplete) return;
    const t = setTimeout(() => engine.advance(), 2200 / speed);
    return () => clearTimeout(t);
  }, [autoPlay, canAdvance, isComplete, index, engine, speed]);

  const handleAnswer = (optionId: string) => {
    if (!currentStep?.question) return;
    const correct = optionId === currentStep.question.correctOptionId;
    engine.answer(optionId);
    recordAnswer(correct);
  };

  const handleRestart = () => {
    engine.restart();
    setManualArchitecture(undefined);
    setViewMode("physical");
    setSelectedNodeId(undefined);
    setPacketSelected(false);
    setCameraMode("overview");
    setEnteredDeviceId(undefined);
    setSelectedLinkId(undefined);
    setSelectedFloodCopyId(undefined);
    setAutoPlay(false);
    setFocusedObject(undefined);
    setHistoricalIndex(undefined);
    setInspectorSurface("hop");
  };

  const nextLabel = currentStep?.question && !lastAnswer ? "Answer to continue" : currentStep?.requiresState && !canAdvance ? "Resolve the incident to continue" : "Next Step →";

  const topology = viewMode === "service" && showServiceToggle ? serviceTopology() : topologyFor(selectedArchitecture);
  const topologyNodeIds = useMemo(() => new Set(topology.nodes.map((n) => n.id)), [topology]);
  const nodeById = useMemo(() => Object.fromEntries(topology.nodes.map((n) => [n.id, n])), [topology]);

  const profile = describeArchitecture(selectedArchitecture);
  const comparisonRows: ArchitectureComparisonRow[] = ARCHITECTURES.map((a) => ({ ...ARCHITECTURE_PROFILES[a], architecture: ARCHITECTURE_LABEL[a], highlighted: a === selectedArchitecture }));

  const showFdbForArchitecture = selectedArchitecture === "VPLS" || selectedArchitecture === "BGP_VPLS";

  const incidentLayers: DiagnosticLayer[] = [
    { label: "BGP session (PE1↔RR1↔PE3)", status: "healthy" },
    { label: "VPLS address family", status: "healthy" },
    { label: "Route Target import", status: "healthy" },
    { label: "PE3 membership discovered", status: "healthy" },
    { label: "Label-block coverage", status: "healthy" },
    { label: "Derived service label", status: "healthy" },
    { label: "Service adjacency PE1↔PE3", status: "healthy" },
    { label: "CE3 BGP-VPLS MAC route", status: "unknown" },
    { label: "CE3 FDB entry at PE1", status: state.incident.resolved ? "healthy" : "failing" },
    { label: "Unknown-unicast flooding (expected until learned)", status: state.incident.resolved ? "healthy" : "unknown" },
  ];

  const evpnRows: EvpnRibRow[] = state.type2Routes.map((r): EvpnRibRow => ({ routeType: "2", summary: `${r.mac} / ${r.ip}`, nextHop: r.originPe, rd: r.rd, rt: r.rt }));

  // --- 3D derived state ---
  const nodes3DBase = useMemo(() => layoutTo3D(topology.nodes.map((n) => ({ ...n, kind: kindFor(n.id) }))), [topology]);
  const journeyPath = state.journey.map((h) => h.device);
  const visitedRouters = new Set(journeyPath);
  const journeyPathStrs: string[] = journeyPath;
  const bestPathEdgeIds = journeyPathStrs.length > 1 ? topology.edges.filter((e) => journeyPathStrs.includes(e.a) && journeyPathStrs.includes(e.b)).map((e) => e.id) : [];
  const nodes3D = nodes3DBase.map((n) => {
    let status: Node3DStatus = "idle";
    if (n.id === selectedNodeId || n.id === enteredDeviceId) status = "selected";
    else if (activePacket && (n.id === activePacket.from || n.id === activePacket.to)) status = "active";
    else if (visitedRouters.has(n.id as RouterId)) status = "onPath";
    const badges: string[] = [];
    if (n.id === "RR1") badges.push("ROUTE REFLECTOR");
    if (n.id.startsWith("MTU")) badges.push("MTU-s");
    const subLabel = showFdbForArchitecture && n.id.startsWith("PE") ? `FDB: ${state.fdb[n.id as PeId]?.length ?? 0}` : n.subLabel;
    return { ...n, subLabel, status, badges: badges.length ? badges : undefined };
  });
  const links3D: Link3DData[] = topology.edges.map((e) => ({
    id: e.id,
    a: e.a,
    b: e.b,
    label: e.label,
    active: activePacket ? (e.a === activePacket.from && e.b === activePacket.to) || (e.b === activePacket.from && e.a === activePacket.to) : false,
    onPath: bestPathEdgeIds.includes(e.id),
  }));
  const activePacket3D: ActivePacket3D | undefined = activePacket && topologyNodeIds.has(activePacket.from) && topologyNodeIds.has(activePacket.to) ? { packet: activePacket, fromId: activePacket.from, toId: activePacket.to } : undefined;
  const questionActive = !isComplete && !!currentStep?.question && lastAnswer?.stepId !== currentStep.id;
  // Flood/replication (brief §21): each simultaneous PW copy PE1 creates
  // from one original customer frame, rendered via FloodCopy3D — never a
  // single shared multicast label, never a sequential per-PE animation.
  const floodCopies3D: FloodCopy3D[] | undefined = state.floodCopies?.map((fc) => ({ id: fc.id, fromId: fc.fromPe, toId: fc.toPe }));
  const selectedNode3D = nodes3D.find((n) => n.id === selectedNodeId);

  const activeDeviceId = PRIMARY_TRANSITION_ROUTER[currentStep?.id ?? ""] ?? DEVICE_ROUTERS.find((r) => traceFor(r, state)?.activeStageId !== undefined);
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
  const packetCurrentDeviceLabel = effectiveDeviceId ?? state.packetAt ?? activePacket?.from ?? "—";
  const packetDirection = journeyPath.length ? journeyPath.join(" → ") : activePacket ? `${activePacket.from} → ${activePacket.to}` : "—";
  const devicePacketForTab = xrayPacket ?? (effectiveDeviceId && state.packetAt === effectiveDeviceId ? activePacket : undefined);

  const focusInspectDeviceId = (selectedNodeId ?? effectiveDeviceId ?? activeDeviceId) as RouterId | undefined;
  const focusTrace = focusInspectDeviceId ? traceFor(focusInspectDeviceId, state) : undefined;
  const focusInterfaces = focusInspectDeviceId ? interfacesFor(focusInspectDeviceId, state) : undefined;

  const journeyStepIndices = l2vpnEvolutionSteps.map((s, i) => ({ s, i })).filter(({ s, i }) => i <= index && (!!s.packet || JOURNEY_STEP_IDS.has(s.id)));
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
  // snapshot (exposed via `getStateAt`). Presentation-only — never calls
  // `engine.goTo()`.
  const historicalState = historicalCursor !== undefined ? engine.getStateAt(historicalCursor) : undefined;
  const historicalStep = historicalCursor !== undefined ? l2vpnEvolutionSteps[historicalCursor] : undefined;
  const historicalPacket = historicalStep && historicalState ? historicalStep.packet?.(historicalState) : undefined;
  const historicalDeviceId = historicalStep && historicalState ? deviceForStep(historicalStep.id, historicalPacket) : undefined;
  const historicalTrace = historicalDeviceId && historicalState ? traceFor(historicalDeviceId, historicalState) : undefined;
  const historicalInterfaces = historicalDeviceId && historicalState ? interfacesFor(historicalDeviceId, historicalState) : undefined;

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
      if (iface.extra) fields.push(...iface.extra);
      return { title: iface.name, fields };
    }
    return { title: target.id, fields: [] };
  }

  function handleCameraModeChange(v: CameraMode) {
    setCameraMode(v);
    if (v === "device" && !enteredDeviceId) setEnteredDeviceId((selectedNodeId && topologyNodeIds.has(selectedNodeId) ? selectedNodeId : undefined) ?? activeDeviceId ?? (topology.nodes[0]?.id as RouterId));
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

    if (router.startsWith("PE")) {
      const pe = router as PeId;
      const architectureTab: DeviceExplorerTab = {
        id: "architecture",
        label: "Architecture",
        content: (
          <div className="space-y-1.5 pv-mono text-[11px]">
            <Row label="Active Architecture" value={ARCHITECTURE_LABEL[selectedArchitecture]} />
            <Row label="Signaling" value={profile.signaling} />
            <Row label="MAC Reachability" value={profile.macReachability} />
          </div>
        ),
      };
      const fdbTab: DeviceExplorerTab = { id: "fdb", label: "MAC / FDB", content: <EthernetFdbViewer title={pe} rows={state.fdb[pe].map((e) => ({ mac: e.mac, portKind: e.port.kind, portPeer: e.port.peer }))} /> };
      const evpnTab: DeviceExplorerTab = {
        id: "evpn",
        label: "EVPN Routes",
        content: state.type2Routes.length ? <EvpnRibViewer title={pe} rows={evpnRows} /> : <p className="text-xs text-pv-text-faint">No EVPN Type 2 routes advertised in this architecture/phase.</p>,
      };
      return [overviewTab, hardwareTab, interfacesTab, architectureTab, fdbTab, evpnTab, packetTab];
    }
    if (router === "RR1") {
      const bgpTab: DeviceExplorerTab = {
        id: "bgp",
        label: "BGP Control",
        content: (
          <div className="space-y-2">
            <p className="text-xs text-pv-text-muted">RR1 reflects a client-learned VPLS/EVPN NLRI to every other client — the same reflection rule taught in the BGP Route Reflector lesson. RR1 never becomes a customer data-plane hop and never holds a customer FDB entry.</p>
            <div className="space-y-1 pv-mono text-[11px]">
              {labelBlockRecapRows().map((r) => (
                <Row key={r.label} label={r.label} value={r.value} />
              ))}
            </div>
          </div>
        ),
      };
      return [overviewTab, hardwareTab, bgpTab];
    }
    if (router.startsWith("MTU")) {
      const roleTab: DeviceExplorerTab = {
        id: "role",
        label: "Access Role",
        content: (
          <div className="space-y-2">
            <p className="text-xs text-pv-text-muted">H-VPLS access-tier bridge — owns local ACs plus exactly one spoke pseudowire to its PE-rs hub. Learns customer MACs from the data plane exactly like any other VPLS-family bridge; never joins the core mesh.</p>
            <div className="space-y-1 pv-mono text-[11px]">
              {hvplsSplitHorizonDemo().map((r, i) => (
                <div key={i} className="rounded-lg border border-pv-border p-2">
                  <div className="text-pv-text">Ingress: {r.ingress}</div>
                  <div className="text-pv-text-faint">Allowed egress: {r.allowed}</div>
                  <Badge tone="cyan">{r.decision}</Badge>
                </div>
              ))}
            </div>
          </div>
        ),
      };
      return [overviewTab, hardwareTab, interfacesTab, roleTab];
    }
    return [overviewTab, hardwareTab, interfacesTab, packetTab];
  }

  const floodCopyInspector = selectedFloodCopy && (
    <GlassPanel strong className="space-y-3 p-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-pv-text">Flood Replica Inspector</h3>
        <button type="button" onClick={() => setSelectedFloodCopyId(undefined)} className="text-xs text-pv-text-faint hover:text-pv-text">
          ✕
        </button>
      </div>
      <p className="text-xs text-pv-text-muted">
        One of {state.floodCopies?.length ?? 0} independent replicas {selectedFloodCopy.fromPe} creates from a single customer frame — {selectedFloodCopy.fromPe} → {selectedFloodCopy.toPe}. The source CE never transmitted more than one original frame; this is real, independent packet replication, not a single shared multicast label, and it happens identically under VPLS and BGP-VPLS (the signaling changed — the flooding didn&apos;t).
      </p>
      {activePacket && (
        <div>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-pv-text-faint">Currently Tracked Packet</p>
          <PacketInspector packet={activePacket} />
        </div>
      )}
    </GlassPanel>
  );

  const comparisonContentFor = (stepId: string | undefined): ReactNode => {
    switch (stepId) {
      case "bgp-vpls-label-block-recap":
        return (
          <GlassPanel className="p-4">
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-pv-text-muted">Label = Label Base + VE-ID − VBO</h4>
            <div className="space-y-1">
              {labelBlockRecapRows().map((r) => (
                <Row key={r.label} label={r.label} value={r.value} />
              ))}
            </div>
          </GlassPanel>
        );
      case "hvpls-scaling-comparison":
        return (
          <GlassPanel className="p-4">
            {scalingComparisonRows(10).map((r) => (
              <Row key={r.label} label={r.label} value={r.value} />
            ))}
          </GlassPanel>
        );
      case "hvpls-split-horizon":
        return (
          <GlassPanel className="p-4">
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-pv-text-muted">Hierarchical Split Horizon (live)</h4>
            {hvplsSplitHorizonDemo().map((r, i) => (
              <div key={i} className="mb-2 rounded-lg border border-pv-border p-2 text-[11px]">
                <div className="pv-mono text-pv-text">Ingress: {r.ingress}</div>
                <div className="pv-mono text-pv-text-faint">Allowed egress: {r.allowed}</div>
                <Badge tone="cyan">{r.decision}</Badge>
              </div>
            ))}
          </GlassPanel>
        );
      case "evpn-ce3-install":
      case "evpn-type2-recap":
      case "evpn-vs-traditional-signature":
        return <EvpnRibViewer title="CUST-A" rows={evpnRows} />;
      case "evpn-mac-mobility-comparison": {
        const { before, after, selected } = mobilityComparisonDemo();
        return (
          <GlassPanel className="p-4">
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-pv-text-muted">Reused From EVPN MAC Mobility Lesson</h4>
            <div className="space-y-1 pv-mono text-[11px] text-pv-text-muted">
              <div>Old advertisement (representing PE1): seq {before.mobilitySeq}</div>
              <div>New advertisement (representing PE2): seq {after.mobilitySeq}</div>
              <div className="text-pv-success">Winner: seq {selected.mobilitySeq} — higher sequence always wins</div>
            </div>
          </GlassPanel>
        );
      }
      case "evpn-multihoming-comparison": {
        const { dfState, roleByLeaf } = multihomingComparisonDemo();
        return (
          <GlassPanel className="p-4">
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-pv-text-muted">Reused From EVPN Multihoming Lesson — CE-DUAL</h4>
            <div className="space-y-1 pv-mono text-[11px] text-pv-text-muted">
              <div>{dfState.reason}</div>
              <div>PE1 (as LEAF1): {roleByLeaf.LEAF1}</div>
              <div>PE2 (as LEAF2): {roleByLeaf.LEAF2}</div>
            </div>
          </GlassPanel>
        );
      }
      case "architecture-comparison-table":
        return <ArchitectureComparisonViewer rows={comparisonRows} />;
      case "state-ownership-table":
        return <StateOwnershipViewer rows={getStateOwnership()} />;
      default:
        return null;
    }
  };

  const activeNodes3D = nodes3D;
  const activeEdges3D = links3D;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <div className="mb-6 flex items-center justify-between">
        <Link href="/dashboard" className="text-sm text-pv-text-faint hover:text-pv-text">
          ← Dashboard
        </Link>
        <Badge tone="violet">CUST-A · L2VPN Evolution Capstone</Badge>
      </div>

      <h1 className="mb-2 text-2xl font-bold text-pv-text">L2VPN Evolution: VPWS → VPLS → BGP-VPLS → H-VPLS → EVPN</h1>
      <p className="mb-6 text-sm text-pv-text-muted">If all five can provide a Layer-2 service, why do all five exist? One customer, five architectures, compared on the same questions every time.</p>

      {/* Step rail */}
      <div className="mb-6 flex gap-1">
        {l2vpnEvolutionSteps.map((step, i) => (
          <button
            key={step.id}
            type="button"
            disabled={i > index}
            onClick={() => i < index && engine.goTo(i)}
            title={step.label}
            className={clsx("h-1.5 flex-1 min-w-1 rounded-full transition-colors", i < index ? "bg-pv-success/70 hover:bg-pv-success cursor-pointer" : i === index ? "bg-pv-cyan" : "bg-white/10")}
          />
        ))}
      </div>

      {isComplete ? (
        <GlassPanel strong className="p-8 text-center">
          <h2 className="mb-3 text-xl font-bold text-pv-success">L2VPN Architect</h2>
          <p className="mb-4 text-sm text-pv-text-muted">
            BGP-VPLS changes how the VPLS is discovered and signaled; H-VPLS changes how the VPLS is structured; EVPN changes how Ethernet reachability itself is distributed. +{L2VPN_EVOLUTION_XP_AWARD} XP awarded.
          </p>
          <Button onClick={handleRestart}>Restart Lesson</Button>
        </GlassPanel>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
          <div className="space-y-5">
            {/* Narrative */}
            <GlassPanel strong className="p-5">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-pv-cyan-soft">{currentStep?.label}</h3>
              <p className="text-sm leading-relaxed text-pv-text">{currentStep?.narrative}</p>
              {whatChanged.length > 0 && (
                <ul className="mt-3 space-y-1 border-t border-pv-border pt-3">
                  {whatChanged.map((w, i) => (
                    <li key={i} className="pv-mono text-[11px] text-pv-cyan-soft">
                      → {w}
                    </li>
                  ))}
                </ul>
              )}
            </GlassPanel>

            {/* Toolbar */}
            <div className="flex flex-wrap items-center gap-3">
              <TopologyModeSwitcher options={ARCHITECTURES.map((a) => ({ value: a, label: ARCHITECTURE_LABEL[a] }))} value={selectedArchitecture} onChange={(v) => setSelectedArchitecture(v as Architecture)} tone="cyan" />
              {showServiceToggle && <TopologyModeSwitcher options={[{ value: "physical", label: "BGP Control" }, { value: "service", label: "Service Mesh" }]} value={viewMode} onChange={(v) => setViewMode(v as ViewMode)} tone="violet" />}
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
            </div>

            {/* Topology */}
            {viewMode3D ? (
              <>
                <TopologyFrame questionActive={questionActive} onExpand={() => setFocusMode(true)}>
                  {focusMode ? (
                    // Focus Mode renders its own full-size <NetworkScene3D> below —
                    // avoid a second, fully hidden WebGL canvas (one-canvas invariant).
                    <div className="h-96 w-full rounded-2xl border border-pv-border bg-pv-bg-elevated sm:h-[28rem]" />
                  ) : (
                    <NetworkScene3D
                      nodes={activeNodes3D}
                      links={activeEdges3D}
                      activePacket={inDeviceMode ? undefined : activePacket3D}
                      floodCopies={inDeviceMode ? undefined : floodCopies3D}
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
                              pipelineTitle: effectiveDeviceId!.startsWith("PE") ? "Conceptual VPLS-Family Bridging Pipeline" : effectiveDeviceId === "RR1" ? "Conceptual Route-Reflection Pipeline" : undefined,
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

                {!packetSelected && !selectedLinkDetail && floodCopyInspector}

                {inDeviceMode && !packetSelected && !selectedLinkDetail && !floodCopyInspector ? (
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
                  !floodCopyInspector && (
                    <NodeInspectorPanel explanation={nodeExplanation} packet={xrayPacket} xrayEnabled={xrayMode}>
                      {selectedNodeId && DEVICE_ROUTERS.includes(selectedNodeId) && topologyNodeIds.has(selectedNodeId) && (
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
              <GlassPanel className="p-4">
                <GraphTopologyViewer nodes={topology.nodes} edges={topology.edges.map((e) => ({ ...e, state: "full" as const }))} activeNodeIds={activePacket ? [activePacket.from, activePacket.to] : []} bestPathEdgeIds={bestPathEdgeIds} onNodeClick={(id) => setSelectedNodeId(id as RouterId)} onEdgeClick={(id) => setSelectedLinkId(id)}>
                  {activePacket && nodeById[activePacket.from] && nodeById[activePacket.to] && (
                    <GraphPacket packet={activePacket} from={{ x: nodeById[activePacket.from].x, y: nodeById[activePacket.from].y }} to={{ x: nodeById[activePacket.to].x, y: nodeById[activePacket.to].y }} onSelect={() => setPacketSelected(true)} />
                  )}
                </GraphTopologyViewer>

                {!!state.floodCopies?.length && (
                  <div className="mt-3 rounded-xl border border-pv-violet/30 bg-pv-violet/5 p-3">
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-pv-violet">Flooding — Switch To 3D View To See Every Replica At Once</p>
                    <p className="text-[11px] text-pv-text-muted">{state.floodCopies.map((fc) => `${fc.fromPe} → ${fc.toPe}`).join(", ")}</p>
                  </div>
                )}
              </GlassPanel>
            )}

            {!viewMode3D && packetSelected && activePacket && (
              <div>
                <div className="mb-1 flex justify-end">
                  <button type="button" onClick={() => setPacketSelected(false)} className="text-xs text-pv-text-faint hover:text-pv-text">
                    close
                  </button>
                </div>
                <PacketInspector packet={activePacket} />
              </div>
            )}

            {!viewMode3D && selectedLinkId && linkDetailFor(selectedLinkId, state) && <LinkDetailPanel detail={linkDetailFor(selectedLinkId, state)!} onClose={() => setSelectedLinkId(undefined)} />}

            {!viewMode3D && selectedNodeId && (
              <GlassPanel className="p-4">
                <div className="mb-2 flex items-center justify-between">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-pv-text-muted">{selectedNodeId}</h4>
                  <button type="button" onClick={() => setSelectedNodeId(undefined)} className="text-xs text-pv-text-faint hover:text-pv-text">
                    close
                  </button>
                </div>
                <NodeExplanationPanel state={state} nodeId={selectedNodeId} />
              </GlassPanel>
            )}

            {/* FDB — VPLS / BGP-VPLS lanes (legacy panel, unchanged) */}
            {showFdbForArchitecture && (
              <div className="grid gap-3 sm:grid-cols-3">
                {(["PE1", "PE2", "PE3"] as const).map((pe) => (
                  <EthernetFdbViewer key={pe} title={pe} rows={state.fdb[pe].map((e) => ({ mac: e.mac, portKind: e.port.kind, portPeer: e.port.peer }))} />
                ))}
              </div>
            )}

            {!viewMode3D && (currentStep?.id === "vpls-first-frame-unknown" || currentStep?.id === "vpls-known-unicast" || currentStep?.id === "incident-symptoms" || currentStep?.id === "verify-dataplane") && state.journey.length > 0 && (
              <ForwardingDecisionCard router={state.journey[state.journey.length - 1].device} input={state.journey[state.journey.length - 1].input} lookup={state.journey[state.journey.length - 1].lookup} action={state.journey[state.journey.length - 1].action} output={state.journey[state.journey.length - 1].output} />
            )}

            {currentStep?.id.startsWith("incident-") && <TroubleshootingLayers title="Diagnostic Ladder" layers={incidentLayers} />}

            {comparisonContentFor(currentStep?.id)}

            {!currentStep?.question && currentStep?.id === "repair-challenge" && <IncidentRepairChallenge attempt={state.incident.repairAttempt} onTry={(choice) => engine.act({ choice })} />}

            {currentStep?.question && (
              <div className="space-y-3">
                <PredictionQuestion question={currentStep.question} selectedOptionId={lastAnswer?.stepId === currentStep.id ? lastAnswer.optionId : undefined} onAnswer={handleAnswer} />
                {currentStep.id === "engineer-challenge" && lastAnswer?.stepId === currentStep.id && <EngineerChallengeReveal architecture={lastAnswer.optionId as Architecture} />}
              </div>
            )}

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
              <Button variant="secondary" size="sm" onClick={handleRestart}>
                Restart
              </Button>
              <span className="pv-mono text-xs text-pv-text-faint">
                Step {index + 1} / {totalSteps}
              </span>
            </div>
          </div>

          {/* Right rail */}
          <div className="space-y-4">
            <GlassPanel strong className="p-4">
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-pv-violet">{ARCHITECTURE_LABEL[selectedArchitecture]}</h4>
              <dl className="space-y-2 text-[11px]">
                <Row label="Service Type" value={profile.serviceType} />
                <Row label="Discovery" value={profile.discovery} />
                <Row label="Signaling" value={profile.signaling} />
                <Row label="MAC Reachability" value={profile.macReachability} />
                <Row label="BUM" value={profile.bum} />
                <Row label="Split Horizon" value={profile.splitHorizon} />
                <Row label="Multihoming" value={profile.multihomingModel} />
                <Row label="Access Hierarchy" value={profile.accessHierarchy} />
              </dl>
            </GlassPanel>

            <GlassPanel className="p-4">
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-pv-text-muted">CUST-A Sites</h4>
              <div className="space-y-1 pv-mono text-[11px] text-pv-text-muted">
                <div>CE1 — {CE_MAC.CE1}</div>
                <div>CE2 — {CE_MAC.CE2}</div>
                <div>CE3 — {CE_MAC.CE3}</div>
              </div>
            </GlassPanel>

            <GlassPanel className="p-4">
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-pv-text-muted">Terms</h4>
              <div className="space-y-2">
                {TERMS.map((t) => (
                  <div key={t.term} className="text-[11px]">
                    <span className="pv-mono font-semibold text-pv-cyan-soft">{t.term}</span>
                    <span className="text-pv-text-faint"> — {t.expansion}. </span>
                    <span className="text-pv-text-muted">{t.meaning}</span>
                  </div>
                ))}
              </div>
            </GlassPanel>
          </div>
        </div>
      )}

      {focusMode && (
        <TopologyFocusMode
          onClose={() => setFocusMode(false)}
          toolbar={
            <>
              <TopologyModeSwitcher options={ARCHITECTURES.map((a) => ({ value: a, label: ARCHITECTURE_LABEL[a] }))} value={selectedArchitecture} onChange={(v) => setSelectedArchitecture(v as Architecture)} tone="cyan" />
              {showServiceToggle && <TopologyModeSwitcher options={[{ value: "physical", label: "BGP Control" }, { value: "service", label: "Service Mesh" }]} value={viewMode} onChange={(v) => setViewMode(v as ViewMode)} tone="violet" />}
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
                <Badge tone="violet">{ARCHITECTURE_LABEL[selectedArchitecture]}</Badge>
                <span className="truncate text-xs font-medium text-pv-text">{currentStep?.label ?? (isComplete ? "Complete" : "")}</span>
              </div>
              {questionActive ? (
                <span className="shrink-0 rounded-full border border-pv-warning/40 bg-pv-warning/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-pv-warning">
                  Prediction pending — answer in the panel to continue
                </span>
              ) : currentStep?.id === "repair-challenge" ? (
                <span className="shrink-0 rounded-full border border-pv-warning/40 bg-pv-warning/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-pv-warning">
                  Engineer challenge pending — resolve the incident in the panel to continue
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
                nodes={activeNodes3D}
                links={activeEdges3D}
                activePacket={inDeviceMode ? undefined : activePacket3D}
                floodCopies={inDeviceMode ? undefined : floodCopies3D}
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
                        pipelineTitle: effectiveDeviceId!.startsWith("PE") ? "Conceptual VPLS-Family Bridging Pipeline" : effectiveDeviceId === "RR1" ? "Conceptual Route-Reflection Pipeline" : undefined,
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
                {currentStep.id === "engineer-challenge" && lastAnswer?.stepId === currentStep.id && <EngineerChallengeReveal architecture={lastAnswer.optionId as Architecture} />}
              </>
            ) : currentStep?.id === "repair-challenge" ? (
              <>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-pv-cyan-soft">Engineer Challenge</p>
                <IncidentRepairChallenge attempt={state.incident.repairAttempt} onTry={(choice) => engine.act({ choice })} />
              </>
            ) : comparisonContentFor(currentStep?.id) ? (
              comparisonContentFor(currentStep?.id)
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
                  const histStep = l2vpnEvolutionSteps[entry.index];
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

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between pv-mono text-[11px] text-pv-text-muted">
      <span className="text-pv-text-faint">{label}</span>
      <span className="text-pv-text">{value}</span>
    </div>
  );
}

function NodeExplanationPanel({ state, nodeId }: { state: L2vpnEvolutionState; nodeId: RouterId }) {
  const explanation = explainNode(state, nodeId);
  const trace = traceFor(nodeId, state);
  return (
    <div className="space-y-2 text-[11px]">
      <p className="text-pv-text-faint">{explanation.deviceType}</p>
      <p className="text-pv-text">{explanation.role}</p>
      {explanation.controlPlaneRole && <p className="text-pv-cyan-soft">Control: {explanation.controlPlaneRole}</p>}
      {explanation.dataPlaneRole && <p className="text-pv-violet">Data: {explanation.dataPlaneRole}</p>}
      <p className="pv-mono text-pv-text-muted">{explanation.currentAction}</p>
      {trace?.stages && (
        <div className="mt-2 flex flex-wrap gap-1">
          {trace.stages.map((s) => (
            <Badge key={s.id} tone={trace.completedStageIds.includes(s.id) ? "success" : trace.activeStageId === s.id ? "cyan" : "muted"}>
              {s.label}
            </Badge>
          ))}
        </div>
      )}
      {explanation.tables?.map((t) => (
        <div key={t.title} className="mt-2">
          <p className="mb-1 text-pv-text-faint uppercase tracking-wide">{t.title}</p>
          {t.rows.map((r) => (
            <div key={r.label} className="flex justify-between pv-mono text-pv-text-muted">
              <span>{r.label}</span>
              <span className="text-pv-text">{r.value}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/** Requirement match reveal for the "Engineer Challenge" prediction — gated behind `lastAnswer` and evaluated against whichever architecture the LEARNER chose, never a pre-filled correct answer sitting next to an unanswered question (that would spoil the question it's meant to explain). */
function EngineerChallengeReveal({ architecture }: { architecture: Architecture }) {
  return (
    <GlassPanel className="p-4">
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-pv-text-muted">Requirement Match — {ARCHITECTURE_LABEL[architecture]}</h4>
      {evaluateRequirements(architecture, CHALLENGE_REQUIREMENTS).map((r) => (
        <div key={r.requirement} className="flex justify-between pv-mono text-[11px] text-pv-text-muted">
          <span>{REQUIREMENT_LABEL[r.requirement]}</span>
          <Badge tone={r.status === "supported" ? "success" : r.status === "partial" ? "warning" : "danger"}>{r.status}</Badge>
        </div>
      ))}
    </GlassPanel>
  );
}

const WRONG_REPAIR_FEEDBACK: Record<string, string> = {
  "restart-bgp": "Restarting BGP fixes nothing here — the session, the address family, and RT import were already healthy. BGP-VPLS's NLRI was never designed to carry a customer MAC in the first place, so there is no missing route a restart could surface.",
  "add-evpn-type2-manually": "This is BGP-signaled VPLS, not EVPN — there is no Type 2 AFI/SAFI running in this service. Manually injecting an EVPN route into a BGP-VPLS deployment does not do anything for this service's forwarding.",
  "change-vpls-rt": "The Route Target already matches — membership, label-block coverage, and the service adjacency are all already healthy. Changing an RT that isn't broken risks breaking real membership for no benefit.",
};
const REPAIR_OPTIONS = [
  { id: "observe-traffic", label: "No configuration change — let CE3 send traffic so PE1 learns its MAC from the data plane" },
  { id: "restart-bgp", label: "Restart BGP because CE3's MAC is absent" },
  { id: "add-evpn-type2-manually", label: "Manually add an EVPN Type 2 route for CE3" },
  { id: "change-vpls-rt", label: "Change the VPLS Route Target" },
];
function IncidentRepairChallenge({ attempt, onTry }: { attempt?: { choice: string; correct: boolean }; onTry: (choice: string) => void }) {
  return (
    <GlassPanel strong className="p-5">
      <p className="mb-3 text-sm font-medium text-pv-text">Choose how to proceed:</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {REPAIR_OPTIONS.map((opt) => {
          const isSelected = attempt?.choice === opt.id;
          const isCorrect = opt.id === "observe-traffic";
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
            <span className="font-semibold">✓ Correct — this was never a configuration fault. CE3&apos;s MAC is now learned from real customer traffic.</span>
          ) : (
            <>
              <span className="mb-1 block font-semibold text-pv-text">That doesn&apos;t fix anything, because nothing was broken.</span>
              {WRONG_REPAIR_FEEDBACK[attempt.choice] ?? "Try again."}
            </>
          )}
        </div>
      )}
    </GlassPanel>
  );
}

/** Derives a close-but-non-clipping camera eye offset from a focused object's world-space bounding size. */
function eyeOffsetForFocusTarget(target: FocusTarget3D): [number, number, number] {
  const [sx, sy, sz] = target.size ?? [0.6, 0.3, 0.3];
  const maxDim = Math.max(sx, sy, sz);
  const dist = Math.max(0.55, maxDim * 1.8);
  return [dist * 0.55, dist * 0.5, dist * 0.75];
}
