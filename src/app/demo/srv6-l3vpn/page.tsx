"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { clsx } from "clsx";
import { useScenarioEngine } from "@/lib/sim-engine/useScenarioEngine";
import {
  buildSrv6L3vpnCliCommands,
  createSrv6L3vpnState,
  CUST_A_EXPORT_RT,
  CUST_A_IMPORT_RT,
  CUST_A_RD,
  CUST_A_VRF,
  CUST_A_WRONG_RT,
  GRAPH_EDGES,
  GRAPH_NODES,
  GRAPH_REGIONS,
  INFRA_LOOPBACK,
  LOCATOR_PREFIX,
  PE1_DT4_SID,
  PE2_DT4_SID,
  P1_ENDX_SID_TEXT,
  P_ROUTERS,
  PE_ROUTERS,
  simulateMissingServiceTlv,
  simulatePerVrfVsPerCe,
  simulateRtMismatch,
  srv6L3vpnSteps,
  CE2_HOST_IPV4,
  CE3_HOST_IPV4,
  type PerVrfVsPerCeResult,
  type RouterId,
  type Srv6L3vpnState,
} from "@/lib/sim-engine/scenarios/srv6L3vpn";
import { fmtIpv6 } from "@/lib/sim-engine/scenarios/srv6Foundations";
import { BEHAVIOR_LABEL } from "@/lib/sim-engine/scenarios/srv6EndpointBehaviors";
import { GraphTopologyViewer } from "@/components/network/GraphTopologyViewer";
import { GraphPacket } from "@/components/network/GraphPacket";
import { PacketInspector } from "@/components/network/PacketInspector";
import { PacketJourneyTimeline } from "@/components/protocol/PacketJourneyTimeline";
import { PlaneSplitPanel } from "@/components/protocol/PlaneSplitPanel";
import { Srv6VpnRouteViewer, type Srv6VpnRouteRow } from "@/components/protocol/Srv6VpnRouteViewer";
import { TroubleshootingLayers, type DiagnosticLayer } from "@/components/protocol/TroubleshootingLayers";
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
import { RR1_ID, explainRr1, packetFromRr1, packetToRr1, reflectThroughRr1, rr1Interfaces, withRr1 } from "./rrIntegration";

const DEVICE_ROUTERS: RouterId[] = ["PE1", "P1", "P2", "PE2"];
type ExtRouterId = RouterId | typeof RR1_ID;
type TopoView = "physical" | "bgpControl" | "vpnService" | "packet";

const WHY_SRV6_L3VPN: { q: string; a: string }[] = [
  { q: "WHAT changes vs. MPLS L3VPN?", a: "The egress service instruction: an SRv6 Service SID (bound to End.DT4/End.DT6) replaces the MPLS VPN label." },
  { q: "WHAT stays the same?", a: "VRF, RD, RT, and MP-BGP VPN routes — all unchanged. This is not a new VPN architecture." },
  { q: "WHY does it matter?", a: "One IPv6/SRv6 core forwards both MPLS-style VPN and TE traffic with no separate label-distribution protocol." },
  { q: "WITHOUT the locator?", a: "A perfectly healthy BGP session and route can still be forwarding-useless — Service SID resolvability is a separate dependency." },
];

const REPAIR_OPTIONS = [
  { id: "change-rt", label: "Change PE1's CUST-A import RT" },
  { id: "restart-mpbgp", label: "Restart the MP-BGP session" },
  { id: "add-mpls-label", label: "Add an MPLS VPN label to the route" },
  { id: "restore-locator", label: `Restore PE2's locator advertisement (${LOCATOR_PREFIX.PE2})` },
];
const WRONG_FEEDBACK: Record<string, string> = {
  "change-rt": "RT import already succeeds — the route is received and matches CUST-A's import RT. Changing RT does nothing for a Service SID that can't be resolved.",
  "restart-mpbgp": "The route and its BGP next hop are already received and reachable. Restarting the session doesn't touch the SRv6 locator that's actually missing.",
  "add-mpls-label": "This VPN uses the SRv6 service data plane, not MPLS. The missing dependency is Service SID reachability — an MPLS label has no meaning here.",
};

/** Derives a close-but-non-clipping camera eye offset from a focused object's world-space bounding size (see sr-mpls-foundations for the same helper). */
function eyeOffsetForFocusTarget(target: FocusTarget3D): [number, number, number] {
  const [sx, sy, sz] = target.size ?? [0.6, 0.3, 0.3];
  const maxDim = Math.max(sx, sy, sz);
  const dist = Math.max(0.55, maxDim * 1.8);
  return [dist * 0.55, dist * 0.5, dist * 0.75];
}

export default function Srv6L3vpnDemo() {
  const { engine, snapshot } = useScenarioEngine<Srv6L3vpnState>(createSrv6L3vpnState(), srv6L3vpnSteps);
  const [autoPlay, setAutoPlay] = useState(false);
  const [speed, setSpeed] = useState<0.5 | 1 | 2>(1);
  const [topoView, setTopoView] = useState<TopoView>("physical");
  const [viewMode3D, setViewMode3D] = useState(false);
  const [planeView, setPlaneView] = useState<"control" | "data" | "both">("both");
  const [focusRouter, setFocusRouter] = useState<RouterId>("PE1");
  const [selectedNodeId, setSelectedNodeId] = useState<ExtRouterId | undefined>(undefined);
  const [cameraMode, setCameraMode] = useState<CameraMode>("overview");
  const [enteredDeviceId, setEnteredDeviceId] = useState<ExtRouterId | undefined>(undefined);
  const [deviceXray, setDeviceXray] = useState(true);
  const [autoEnterDevices, setAutoEnterDevices] = useState(true);
  const [selectedInterfaceId, setSelectedInterfaceId] = useState<string | undefined>(undefined);
  const [selectedLinkId, setSelectedLinkId] = useState<string | undefined>(undefined);
  const [packetSelected, setPacketSelected] = useState(false);
  const [xrayMode, setXrayMode] = useState(true);
  const [perCeDst, setPerCeDst] = useState<string>(CE3_HOST_IPV4);
  const [policyPreviewOn, setPolicyPreviewOn] = useState(false);
  const [rrRelayActive, setRrRelayActive] = useState(false);
  const [rrRelayHop, setRrRelayHop] = useState<0 | 1>(0);
  const [focusMode, setFocusMode] = useState(false);
  const [focusedObject, setFocusedObject] = useState<FocusTarget3D | undefined>(undefined);
  /** Presentation cursor for HopTimeline inspection (ARCHITECTURE.md §18) — a step INDEX, never mutates the live lesson. undefined = inspecting the current/live hop. */
  const [historicalIndex, setHistoricalIndex] = useState<number | undefined>(undefined);
  /** Explicit Hop-vs-Device intent inside Focus Mode (ARCHITECTURE.md §18) — set by the actual gesture, never inferred from whether a trace object happens to exist. */
  const [inspectorSurface, setInspectorSurface] = useState<InspectorSurface>("hop");
  const completeLesson = useProgressStore((s) => s.completeLesson);
  const recordAnswer = useProgressStore((s) => s.recordAnswer);
  const unlockAchievement = useProgressStore((s) => s.unlockAchievement);
  const awardedRef = useRef(false);

  const { state, currentStep, index, totalSteps, isComplete, lastAnswer, whatChanged, activePacket } = snapshot;
  const canAdvance = engine.canAdvance();

  const showRr = index >= srv6L3vpnSteps.findIndex((s) => s.id === "mpbgp-advertise-ipv4");
  const showPerVrfLab = currentStep?.id === "per-vrf-vs-per-ce-lab" || currentStep?.id === "predict-dt4-vs-dx4";
  const showRtMismatchLab = currentStep?.id === "rt-mismatch-lab";
  const showMissingTlvLab = currentStep?.id === "missing-service-tlv-lab";
  const showPolicyPreview = currentStep?.id === "sr-policy-integration-preview" || currentStep?.id === "predict-policy-plus-service";
  const showTroubleshoot = index >= srv6L3vpnSteps.findIndex((s) => s.id === "break-intro");
  const showPlanes = index >= srv6L3vpnSteps.findIndex((s) => s.id === "send-ce1-ce2");

  const rrModeActive = showRr;
  const augmented = rrModeActive ? withRr1(GRAPH_NODES, GRAPH_EDGES, "PE1", "PE2") : { nodes: GRAPH_NODES, edges: GRAPH_EDGES };
  const nodesRaw = augmented.nodes.map((n) => {
    if (topoView === "vpnService" && (n.id === "PE1" || n.id === "PE2")) return { ...n, subLabel: n.id === "PE1" ? `RD ${CUST_A_RD.PE1}` : `RD ${CUST_A_RD.PE2}` };
    if (topoView === "packet" && state.packet && n.id === state.packetAt) return { ...n, subLabel: `DA=${fmtIpv6(state.packet.outer.daHextets)}` };
    return n;
  });
  const nodes = nodesRaw;
  const edges = augmented.edges.map((e) => ({ ...e, state: "full" as const }));
  const activeNodeIds = activePacket ? [activePacket.from, activePacket.to] : [];
  const packetFrom = activePacket ? nodes.find((n) => n.id === activePacket.from) : undefined;
  const packetTo = activePacket ? nodes.find((n) => n.id === activePacket.to) : undefined;

  const cliCommands = useMemo(() => buildSrv6L3vpnCliCommands(state, focusRouter), [state, focusRouter]);
  const lastHop = state.journey[state.journey.length - 1];

  // --- RR1 relay (presentational only, mirrors mpls-l3vpn's own pattern) — never a progression gate, so it stays outside Focus Mode's inspector chain, exactly like the mpls-l3vpn precedent. ---
  const pe2ToPe1Route = state.advertisedRoutes.find((r) => r.originPe === "PE2" && r.prefix.startsWith("10.20.1"));
  const rrReflected = pe2ToPe1Route ? reflectThroughRr1(pe2ToPe1Route, INFRA_LOOPBACK.PE2!) : undefined;
  const rrRelayPacket = rrRelayActive && pe2ToPe1Route ? (rrRelayHop === 0 ? packetToRr1(pe2ToPe1Route, "PE2") : rrReflected ? packetFromRr1(pe2ToPe1Route, "PE1", rrReflected) : undefined) : undefined;

  useEffect(() => {
    if (!rrRelayActive) return;
    const t = setTimeout(() => {
      if (rrRelayHop === 0) setRrRelayHop(1);
      else setRrRelayActive(false);
    }, 1600);
    return () => clearTimeout(t);
  }, [rrRelayActive, rrRelayHop]);

  // --- 3D derived state (always the plain physical layout, independent of the 2D topoView tabs) ---
  const physicalAugmented = rrModeActive ? withRr1(GRAPH_NODES, GRAPH_EDGES, "PE1", "PE2") : { nodes: GRAPH_NODES, edges: GRAPH_EDGES };
  const nodes3DBase = useMemo(() => layoutTo3D(physicalAugmented.nodes), [physicalAugmented.nodes]);
  const visitedRouters = new Set(state.journey.map((h) => h.router));
  const nodes3D = nodes3DBase.map((n) => {
    let status: Node3DStatus = "idle";
    if (n.id === selectedNodeId || n.id === enteredDeviceId) status = "selected";
    else if (activePacket && (n.id === activePacket.from || n.id === activePacket.to)) status = "active";
    else if (visitedRouters.has(n.id as RouterId)) status = "onPath";
    const badges = n.id === "PE1" || n.id === "PE2" ? ["VRF CUST-A"] : n.id === RR1_ID ? ["RR"] : undefined;
    return { ...n, status, badges };
  });
  const links3D: Link3DData[] = physicalAugmented.edges.map((e) => ({
    ...e,
    active: activePacket ? (e.a === activePacket.from && e.b === activePacket.to) || (e.b === activePacket.from && e.a === activePacket.to) : false,
    onPath: visitedRouters.has(e.a as RouterId) && visitedRouters.has(e.b as RouterId),
  }));
  const activePacket3D: ActivePacket3D | undefined = activePacket && nodes3D.some((n) => n.id === activePacket.from) && nodes3D.some((n) => n.id === activePacket.to) ? { packet: activePacket, fromId: activePacket.from, toId: activePacket.to } : undefined;
  const questionActive = !isComplete && !!currentStep?.question && lastAnswer?.stepId !== currentStep.id;
  const selectedNode3D = nodes3D.find((n) => n.id === selectedNodeId);

  const activeDeviceId = DEVICE_ROUTERS.find((r) => traceFor(r, state, currentStep?.id ?? "")?.activeStageId !== undefined);
  const effectiveDeviceId = cameraMode === "device" ? enteredDeviceId : cameraMode === "packetFollow" && autoEnterDevices ? activeDeviceId : undefined;
  const inDeviceMode = !!effectiveDeviceId;
  const isRr1Device = effectiveDeviceId === RR1_ID;
  const isPDevice = effectiveDeviceId === "P1" || effectiveDeviceId === "P2";
  const deviceTrace = effectiveDeviceId && !isRr1Device ? traceFor(effectiveDeviceId as RouterId, state, currentStep?.id ?? "") : undefined;

  const followPacketIntoCurrentDevice = () => {
    if (!packetSelected || cameraMode !== "device") return;
    const snap = engine.getSnapshot();
    const nextDevice = DEVICE_ROUTERS.find((r) => traceFor(r, snap.state, snap.currentStep?.id ?? "")?.activeStageId !== undefined);
    if (nextDevice) setEnteredDeviceId(nextDevice);
  };

  const deviceInterfaces = isRr1Device ? rr1Interfaces() : effectiveDeviceId ? interfacesFor(effectiveDeviceId as RouterId, state, currentStep?.id ?? "") : [];
  const devicePacketFrames: PacketStackFrame[] | undefined = effectiveDeviceId ? packetFramesFor(state, deviceTrace?.activeStageId) : undefined;

  // --- Generic 3D object-focus sub-state (ARCHITECTURE.md §18) — layered ON TOP of `cameraMode`, never a 5th camera mode. Never available while RR1 is entered — RR1 has no DeviceProcessingTrace, only its own explorer tabs. ---
  const focusedObjectStillValid =
    focusedObject &&
    !isRr1Device &&
    (focusedObject.kind === "stage"
      ? deviceTrace?.stages.some((s) => s.id === focusedObject.id)
      : focusedObject.kind === "packetLayer"
        ? devicePacketFrames?.some((f) => f.id === focusedObject.id)
        : focusedObject.kind === "interface"
          ? deviceInterfaces.some((i) => i.id === focusedObject.id)
          : true);
  const activeFocusedObject = focusedObjectStillValid ? focusedObject : undefined;

  const followNode3D = cameraMode === "packetFollow" && activePacket ? nodes3D.find((n) => n.id === (state.packetAt ?? activePacket.to)) : selectedNode3D;
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
  const nodeExplanation = explainTargetId === RR1_ID ? explainRr1(state.advertisedRoutes.length > 0) : explainTargetId ? explainNode(state, explainTargetId as RouterId) : undefined;
  const xrayPacket = activePacket && (selectedNodeId === activePacket.from || selectedNodeId === activePacket.to) ? activePacket : undefined;
  const selectedLinkDetail = selectedLinkId ? linkDetailFor(selectedLinkId, state) : undefined;
  const packetCurrentDeviceLabel = effectiveDeviceId ?? state.packetAt ?? activePacket?.from ?? "—";
  const devicePacketForTab = xrayPacket ?? (effectiveDeviceId && state.packetAt === effectiveDeviceId ? activePacket : undefined);

  // --- Hop Inspector target (ARCHITECTURE.md §18) — explicit selection wins outright: selectedNodeId > effectiveDeviceId > activeDeviceId, excluding the synthetic RR1 device (which has no DeviceProcessingTrace of its own). ---
  const nonRr1SelectedId = selectedNodeId !== RR1_ID ? (selectedNodeId as RouterId | undefined) : undefined;
  const nonRr1EffectiveId = !isRr1Device ? (effectiveDeviceId as RouterId | undefined) : undefined;
  const focusInspectDeviceId = nonRr1SelectedId ?? nonRr1EffectiveId ?? activeDeviceId;
  const focusTrace = focusInspectDeviceId ? traceFor(focusInspectDeviceId, state, currentStep?.id ?? "") : undefined;
  const focusInterfaces = focusInspectDeviceId ? interfacesFor(focusInspectDeviceId, state, currentStep?.id ?? "") : undefined;

  // --- HopTimeline data — every step that either carries a packet or is a no-packet control-plane/fault step tracked in PRIMARY_TRANSITION_ROUTER (mirrors MPLS L3VPN/SRv6 Policy). ---
  const journeyStepIndices = srv6L3vpnSteps.map((s, i) => ({ s, i })).filter(({ s, i }) => i <= index && (!!s.packet || PRIMARY_TRANSITION_ROUTER[s.id] !== undefined));
  const journeyHopEntries = journeyStepIndices.map(({ s, i }) => ({ id: s.id, label: s.label, index: i }));

  // --- Historical (timeline) inspection (ARCHITECTURE.md §18) — reuses ScenarioEngine's OWN `stateByIndex` snapshot (exposed via `getStateAt`). Presentation-only — never calls `engine.goTo()`. The SAME `traceFor` used for live inspection is reused unmodified against a frozen Srv6L3vpnState. ---
  const historicalState = historicalIndex !== undefined ? engine.getStateAt(historicalIndex) : undefined;
  const historicalStep = historicalIndex !== undefined ? srv6L3vpnSteps[historicalIndex] : undefined;
  const historicalPacket = historicalStep && historicalState ? historicalStep.packet?.(historicalState) : undefined;
  const historicalDeviceId = historicalStep && historicalState ? deviceForStep(historicalStep.id, historicalPacket) : undefined;
  const historicalTrace = historicalDeviceId && historicalState ? traceFor(historicalDeviceId, historicalState, historicalStep!.id) : undefined;
  const historicalInterfaces = historicalDeviceId && historicalState ? interfacesFor(historicalDeviceId, historicalState, historicalStep!.id) : undefined;

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

  // --- Manual object focus / historical inspection vs. Play — resuming playback takes priority. ---
  function handleToggleAutoPlay() {
    if (!autoPlay) {
      setFocusedObject(undefined);
      setHistoricalIndex(undefined);
      setInspectorSurface("hop");
    }
    setAutoPlay((v) => !v);
  }

  const peExplorerTabs: DeviceExplorerTab[] = nodeExplanation
    ? [
        { id: "overview", label: "Overview", content: <OverviewTab action={nodeExplanation.currentAction} note={nodeExplanation.note} /> },
        { id: "interfaces", label: "Interfaces", content: <InterfaceListTab interfaces={deviceInterfaces} selectedInterfaceId={selectedInterfaceId} onSelectInterface={setSelectedInterfaceId} /> },
        { id: "underlay", label: "IPv6 Underlay", content: <RowsTab rows={[{ label: "Infra Loopback", value: INFRA_LOOPBACK[effectiveDeviceId as RouterId] ?? "—" }, { label: "SRv6 Locator", value: LOCATOR_PREFIX[effectiveDeviceId as RouterId] ?? "—" }, { label: "Locator State", value: state.locatorWithdrawn[effectiveDeviceId as RouterId] ? "WITHDRAWN" : "advertised" }]} /> },
        { id: "vrfs", label: "VRFs", content: <RowsTab rows={[{ label: "VRF Name", value: CUST_A_VRF.name }, { label: "Export RT", value: CUST_A_VRF.exportRt }, { label: "Import RT", value: CUST_A_VRF.importRt }]} /> },
        { id: "local-routes", label: "Local Customer Routes", content: <RowsTab rows={(state.localRoutes[effectiveDeviceId as RouterId] ?? []).map((r) => ({ label: r.prefix, value: `via ${r.ce} (${r.family})` }))} /> },
        { id: "vpn-routes", label: "MP-BGP VPN Routes", content: <RowsTab rows={state.advertisedRoutes.filter((r) => r.originPe === effectiveDeviceId).map((r) => ({ label: r.prefix, value: `${r.rd} · RT ${r.rt} · SID ${r.prefixSid?.l3Service.serviceSid.sidText}` }))} /> },
        { id: "imported", label: "Imported Routes", content: <RowsTab rows={(state.installedAt[effectiveDeviceId as RouterId] ?? []).map((p) => ({ label: p.route.prefix, value: p.installed ? "installed" : p.rtImport?.passed ? "RT ok, not installed" : "RT failed" }))} /> },
        { id: "sids", label: "SRv6 Service SIDs", content: <RowsTab rows={effectiveDeviceId === "PE1" ? [{ label: PE1_DT4_SID.sidText, value: "End.DT4 · CUST-A" }] : [{ label: PE2_DT4_SID.sidText, value: "End.DT4 · CUST-A" }]} /> },
        {
          id: "sid-resolution",
          label: "Service SID Resolution",
          content: <RowsTab rows={(state.installedAt[effectiveDeviceId as RouterId] ?? []).map((p) => ({ label: p.route.prefixSid?.l3Service.serviceSid.sidText ?? p.route.prefix, value: p.serviceSidResolution?.reason ?? "not yet evaluated" }))} />,
        },
        { id: "packet", label: "Packet", content: devicePacketForTab ? <PacketInspector packet={devicePacketForTab} focusLayerIndices={undefined} /> : <p className="text-xs text-pv-text-faint">No packet at this device right now.</p> },
        { id: "cli", label: "CLI", content: <CLIOutputPanel commands={cliCommands} /> },
      ]
    : [];

  const pExplorerTabs: DeviceExplorerTab[] = nodeExplanation
    ? [
        { id: "overview", label: "Overview", content: <OverviewTab action={nodeExplanation.currentAction} note={nodeExplanation.note} /> },
        { id: "interfaces", label: "Interfaces", content: <InterfaceListTab interfaces={deviceInterfaces} selectedInterfaceId={selectedInterfaceId} onSelectInterface={setSelectedInterfaceId} /> },
        { id: "igp", label: "IPv6 IGP", content: <RowsTab rows={[{ label: "Protocol", value: "IPv6 IGP (converged)" }, { label: "Neighbors", value: "Adjacent core routers" }]} /> },
        { id: "fib", label: "IPv6 FIB", content: <RowsTab rows={[{ label: LOCATOR_PREFIX.PE1 ?? "", value: "toward PE1" }, { label: state.locatorWithdrawn.PE2 ? `${LOCATOR_PREFIX.PE2} (WITHDRAWN)` : (LOCATOR_PREFIX.PE2 ?? ""), value: "toward PE2" }]} /> },
        { id: "packet", label: "Packet", content: devicePacketForTab ? <PacketInspector packet={devicePacketForTab} /> : <p className="text-xs text-pv-text-faint">No packet at this device right now.</p> },
        { id: "cli", label: "CLI", content: <CLIOutputPanel commands={cliCommands} /> },
      ]
    : [];

  const rr1ExplorerTabs: DeviceExplorerTab[] = nodeExplanation
    ? [
        { id: "overview", label: "Overview", content: <OverviewTab action={nodeExplanation.currentAction} /> },
        { id: "sessions", label: "BGP Sessions", content: <RowsTab rows={[{ label: "PE1", value: "Client" }, { label: "PE2", value: "Client" }]} /> },
        { id: "vpnv4", label: "VPNv4 RIB", content: <RowsTab rows={state.advertisedRoutes.filter((r) => r.family === "IPV4").map((r) => ({ label: r.prefix, value: `${r.rd} · SID ${r.prefixSid?.l3Service.serviceSid.sidText}` }))} /> },
        { id: "vpnv6", label: "VPNv6 RIB", content: <RowsTab rows={state.advertisedRoutes.filter((r) => r.family === "IPV6").map((r) => ({ label: r.prefix, value: `${r.rd} · SID ${r.prefixSid?.l3Service.serviceSid.sidText}` }))} /> },
        { id: "reflection", label: "Route Reflection", content: <RowsTab rows={rrReflected ? [{ label: "Decision", value: rrReflected.decision }, { label: "ORIGINATOR_ID", value: rrReflected.originatorId }, { label: "CLUSTER_LIST", value: rrReflected.clusterList.join(", ") }] : [{ label: "Status", value: "no route reflected yet" }]} /> },
        { id: "cli", label: "CLI", content: <p className="text-xs text-pv-text-faint">RR1 carries no customer VRF, no local Service SID, and never processes a customer packet.</p> },
      ]
    : [];

  function explorerTabsFor(deviceId: ExtRouterId): DeviceExplorerTab[] {
    if (deviceId === RR1_ID) return rr1ExplorerTabs;
    if (deviceId === "P1" || deviceId === "P2") return pExplorerTabs;
    return peExplorerTabs;
  }

  const diagnosticLayers: DiagnosticLayer[] = [
    { label: "PE1 Interfaces", status: "healthy" },
    { label: "RR1 MP-BGP", status: "healthy" },
    { label: "PE2 VPN Advertisement", status: "healthy" },
    { label: "RD", status: "healthy" },
    { label: `RT ${CUST_A_EXPORT_RT}`, status: "healthy" },
    { label: "PE1 RT Import", status: "healthy" },
    { label: "PE2 BGP Next Hop", status: "healthy" },
    { label: "SRv6 L3 Service TLV / Service SID", status: "healthy" },
    { label: "PE2 Service SID Locator Route", status: state.locatorWithdrawn.PE2 ? "failing" : "healthy" },
    { label: "Service SID Resolvability", status: state.locatorWithdrawn.PE2 ? "failing" : "healthy" },
    { label: "Usable VPN Forwarding Entry", status: state.locatorWithdrawn.PE2 ? "failing" : "healthy" },
  ];

  useEffect(() => {
    if (isComplete && !awardedRef.current) {
      awardedRef.current = true;
      completeLesson("srv6-l3vpn", 800);
      unlockAchievement("srv6-vpn-architect");
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
    setTopoView("physical");
    setViewMode3D(false);
    setPerCeDst(CE3_HOST_IPV4);
    setPolicyPreviewOn(false);
    setRrRelayActive(false);
    setRrRelayHop(0);
    setFocusMode(false);
    setFocusedObject(undefined);
    setHistoricalIndex(undefined);
    setInspectorSurface("hop");
  };

  const nextLabel = currentStep?.question && !lastAnswer ? "Answer to continue" : currentStep?.requiresState && !canAdvance ? "Apply the correct fix to continue" : "Next Step →";

  const focusInstalled = state.installedAt[focusRouter] ?? [];
  const focusRoute: Srv6VpnRouteRow | undefined = focusInstalled[0]
    ? {
        afiSafi: focusInstalled[0].route.family === "IPV4" ? "IPv4 / VPN-IPv4" : "IPv6 / VPN-IPv6",
        prefix: focusInstalled[0].route.prefix,
        rd: focusInstalled[0].route.rd,
        routeTargets: focusInstalled[0].route.rt,
        bgpNextHop: focusInstalled[0].route.bgpNextHop,
        serviceSid: focusInstalled[0].route.prefixSid?.l3Service.serviceSid.sidText,
        endpointBehavior: focusInstalled[0].route.prefixSid ? BEHAVIOR_LABEL[focusInstalled[0].route.prefixSid.l3Service.serviceSid.behavior] : undefined,
        sidAllocationMode: "Per-VRF (shared across CUST-A prefixes)",
        received: focusInstalled[0].received,
        rtImported: focusInstalled[0].rtImport?.passed,
        rtImportReason: focusInstalled[0].rtImport?.reason,
        sidResolved: focusInstalled[0].serviceSidResolution?.resolvable,
        sidResolvedReason: focusInstalled[0].serviceSidResolution?.reason,
        installed: focusInstalled[0].installed,
      }
    : undefined;

  const perVrfResult: PerVrfVsPerCeResult = simulatePerVrfVsPerCe(perCeDst, state.localRoutes.PE2 ?? []);
  const rtMismatchResult = pe2ToPe1Route ? simulateRtMismatch(pe2ToPe1Route, CUST_A_WRONG_RT, CUST_A_IMPORT_RT) : undefined;
  const missingTlv = simulateMissingServiceTlv();

  const perVrfLabPanel = (
    <GlassPanel strong className="space-y-3 p-5">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-pv-violet">Read-Only Lab: Per-VRF (End.DT4) vs. Per-CE (End.DX4)</h3>
      <div className="flex flex-wrap gap-2">
        {[CE2_HOST_IPV4, CE3_HOST_IPV4].map((ip) => (
          <button
            key={ip}
            type="button"
            onClick={() => setPerCeDst(ip)}
            className={clsx("rounded-full border px-3 py-1 text-[11px] font-semibold pv-mono transition-colors", perCeDst === ip ? "border-pv-cyan/50 bg-pv-cyan/15 text-pv-cyan-soft" : "border-pv-border text-pv-text-faint hover:text-pv-text")}
          >
            dst {ip}
          </button>
        ))}
      </div>
      <div className="grid gap-2 sm:grid-cols-2 text-xs">
        <div className="rounded-lg border border-pv-success/40 bg-pv-success/5 p-2.5">
          <p className="mb-1 font-semibold text-pv-success">End.DT4 (per-VRF)</p>
          <p className="pv-mono text-pv-text">{perVrfResult.dt4Ce ? `→ ${perVrfResult.dt4Ce}` : "→ no match"}</p>
        </div>
        <div className="rounded-lg border border-pv-border p-2.5">
          <p className="mb-1 font-semibold text-pv-text-muted">End.DX4 (per-CE, fixed to CE2)</p>
          <p className="pv-mono text-pv-text">→ {perVrfResult.dx4Ce} (always, regardless of destination)</p>
        </div>
      </div>
    </GlassPanel>
  );

  const rtMismatchLabPanel = rtMismatchResult && (
    <GlassPanel strong className="space-y-2 p-5">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-pv-violet">Read-Only Lab: RT Mismatch</h3>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Badge tone="cyan">Received</Badge>
        <Badge tone="danger">RT Import Failed</Badge>
      </div>
      <p className="text-xs text-pv-text-muted">{rtMismatchResult.rtImport.reason}</p>
      <p className="text-xs text-pv-text-faint">Contrast with the incident ahead: there, RT import PASSES and Service SID resolution is what fails instead.</p>
    </GlassPanel>
  );

  const missingTlvLabPanel = (
    <GlassPanel strong className="space-y-2 p-5">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-pv-violet">Read-Only Lab: Missing SRv6 L3 Service TLV</h3>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Badge tone="cyan">Received</Badge>
        <Badge tone="muted">No Service SID</Badge>
      </div>
      <p className="text-xs text-pv-text-muted">{missingTlv.reason}</p>
    </GlassPanel>
  );

  const policyPreviewPanel = (
    <GlassPanel strong className="space-y-3 p-5">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-pv-violet">Advanced Preview: Shortest Path vs. SR Policy Service Steering</h3>
      <div className="flex gap-2">
        <button type="button" onClick={() => setPolicyPreviewOn(false)} className={clsx("rounded-full border px-3 py-1.5 text-xs font-semibold uppercase transition-colors", !policyPreviewOn ? "border-pv-cyan/50 bg-pv-cyan/15 text-pv-cyan-soft" : "border-pv-border text-pv-text-faint")}>
          Shortest Path
        </button>
        <button type="button" onClick={() => setPolicyPreviewOn(true)} className={clsx("rounded-full border px-3 py-1.5 text-xs font-semibold uppercase transition-colors", policyPreviewOn ? "border-pv-violet/50 bg-pv-violet/15 text-pv-violet" : "border-pv-border text-pv-text-faint")}>
          SR Policy Steered
        </button>
      </div>
      {!policyPreviewOn ? (
        <p className="pv-mono text-xs text-pv-text-muted">Outer IPv6 DA = {PE2_DT4_SID.sidText} — no SRH.</p>
      ) : (
        <div className="space-y-1 pv-mono text-xs text-pv-text-muted">
          <p>Outer IPv6 DA = {P1_ENDX_SID_TEXT} (P1 End.X)</p>
          <p>SRH Segment List[0] = {PE2_DT4_SID.sidText} (final)</p>
          <p>SRH Segment List[1] = {P1_ENDX_SID_TEXT}</p>
          <p className="text-pv-text-faint">At P1: End.X advances DA → {PE2_DT4_SID.sidText}. At PE2: Segments Left = 0 → End.DT4 executes as the final instruction, same as shortest path.</p>
        </div>
      )}
    </GlassPanel>
  );

  return (
    <div className="mx-auto max-w-7xl px-6 py-10">
      <div className="mb-6">
        <Badge tone="cyan" className="mb-3">
          SRv6 L3VPN · RFC 9252 · VRF + RD/RT + SERVICE SID + END.DT4/DT6
        </Badge>
        <h1 className="text-2xl font-semibold text-pv-text sm:text-3xl">A VPN Route Says What. A Service SID Says How.</h1>
        <p className="mt-2 max-w-3xl text-sm text-pv-text-muted">
          Same VRF, RD, RT, and MP-BGP control plane as MPLS L3VPN — but the egress PE now hands the ingress PE a real SRv6 Service
          SID instead of a VPN label, and BGP next-hop reachability turns out not to be the whole story.
        </p>
      </div>

      <div className="mb-4 grid gap-2 sm:grid-cols-4">
        {WHY_SRV6_L3VPN.map((item) => (
          <GlassPanel key={item.q} className="p-3">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-pv-cyan-soft">{item.q}</p>
            <p className="text-[11px] leading-snug text-pv-text-muted">{item.a}</p>
          </GlassPanel>
        ))}
      </div>

      {/* TIMELINE */}
      <div className="mb-4 flex gap-1 overflow-x-auto pb-2">
        {srv6L3vpnSteps.map((step, i) => (
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
            { value: "bgpControl", label: "BGP Control" },
            { value: "vpnService", label: "VPN Service" },
            { value: "packet", label: "Packet" },
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
        {showPlanes && <PlaneViewSwitcher value={planeView} onChange={setPlaneView} />}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_400px]">
        {/* MAIN COLUMN */}
        <div className="space-y-6">
          {viewMode3D ? (
            <>
              <TopologyFrame questionActive={questionActive} onExpand={() => setFocusMode(true)}>
                {focusMode ? (
                  // Focus Mode renders its own full-size <NetworkScene3D> below —
                  // avoid a second, fully hidden WebGL canvas behind the modal
                  // (one-canvas invariant, see sr-mpls-foundations).
                  <div className="h-96 w-full rounded-2xl border border-pv-border bg-pv-bg-elevated sm:h-[28rem]" />
                ) : (
                  <NetworkScene3D
                    nodes={nodes3D}
                    links={links3D}
                    activePacket={inDeviceMode ? undefined : activePacket3D}
                    onSelectNode={(id) => {
                      setSelectedNodeId(id as ExtRouterId);
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
                            pipelineTitle: isRr1Device ? "Route Reflector — No Forwarding Pipeline" : "Conceptual SRv6 L3VPN Pipeline",
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
                  currentHopLabel={lastHop ? `${lastHop.router}: ${lastHop.action} → ${lastHop.output}` : undefined}
                  hopIndex={state.journey.length}
                  totalHops={4}
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
                  direction="PE1 → P1 → P2 → PE2"
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
                    {selectedNodeId && (DEVICE_ROUTERS.includes(selectedNodeId as RouterId) || selectedNodeId === RR1_ID) && (
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
              <GraphTopologyViewer nodes={nodes} edges={edges} activeNodeIds={rrRelayPacket ? [rrRelayPacket.from, rrRelayPacket.to] : activeNodeIds} regions={topoView === "physical" ? GRAPH_REGIONS : []}>
                {rrRelayPacket
                  ? (() => {
                      const from = nodes.find((n) => n.id === rrRelayPacket.from);
                      const to = nodes.find((n) => n.id === rrRelayPacket.to);
                      return from && to ? <GraphPacket packet={rrRelayPacket} from={from} to={to} /> : null;
                    })()
                  : activePacket && packetFrom && packetTo && <GraphPacket packet={activePacket} from={packetFrom} to={packetTo} />}
              </GraphTopologyViewer>

              {topoView === "bgpControl" && rrModeActive && pe2ToPe1Route && (
                <GlassPanel className="space-y-2 p-4">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-pv-violet">MP-BGP Via RR1</h4>
                  <p className="text-xs text-pv-text-muted">Same VPN route ({pe2ToPe1Route.prefix}, RT {pe2ToPe1Route.rt}, SID {pe2ToPe1Route.prefixSid?.l3Service.serviceSid.sidText}) — PE2 → RR1 → PE1. RR1 adds ORIGINATOR_ID/CLUSTER_LIST; it never carries customer traffic.</p>
                  <Button
                    size="sm"
                    disabled={rrRelayActive}
                    onClick={() => {
                      setRrRelayActive(true);
                      setRrRelayHop(0);
                    }}
                  >
                    {rrRelayActive ? (rrRelayHop === 0 ? "PE2 → RR1…" : "RR1 → PE1…") : "Show VPN Route via RR1 →"}
                  </Button>
                </GlassPanel>
              )}

              {lastHop && (
                <GlassPanel className="p-4">
                  <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-pv-text-muted">Forwarding Decision — {lastHop.router}</h4>
                  <p className="pv-mono text-[11px] text-pv-text-muted">
                    In: <span className="text-pv-text">{lastHop.input}</span>
                  </p>
                  <p className="pv-mono text-[11px] text-pv-text-muted">
                    Lookup: <span className="text-pv-text">{lastHop.lookup}</span>
                  </p>
                  <p className="pv-mono text-[11px] text-pv-text-muted">
                    Action: <span className="text-pv-cyan-soft">{lastHop.action}</span> → <span className="text-pv-text">{lastHop.output}</span>
                  </p>
                </GlassPanel>
              )}
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

          {showPerVrfLab && !isComplete && perVrfLabPanel}
          {showRtMismatchLab && !isComplete && rtMismatchLabPanel}
          {showMissingTlvLab && !isComplete && missingTlvLabPanel}
          {showPolicyPreview && !isComplete && policyPreviewPanel}

          {showPlanes && !isComplete && (
            <PlaneSplitPanel
              show={planeView}
              controlTitle="Control Plane — VRF → RD → RT → MP-BGP → Service SID"
              controlRows={[
                { label: "VRF CUST-A routes (PE1)", value: `${(state.installedAt.PE1 ?? []).length + (state.localRoutes.PE1 ?? []).length} routes` },
                { label: "PE2 export RT", value: CUST_A_EXPORT_RT },
                { label: "PE1 import RT", value: CUST_A_IMPORT_RT },
                { label: "PE2 Service SID (End.DT4)", value: PE2_DT4_SID.sidText },
                { label: "PE2 locator state", value: state.locatorWithdrawn.PE2 ? "WITHDRAWN" : "advertised" },
                { label: "PE1 import result (CE2 route)", value: (() => { const e = (state.installedAt.PE1 ?? []).find((p) => p.route.prefix.startsWith("10.20.1")); return e ? (e.installed ? "Installed" : e.rtImport?.passed ? "RT ok, SID unresolved" : "RT rejected") : "—"; })() },
              ]}
              dataTitle="Data Plane — Current Packet"
              dataRows={
                state.packet
                  ? [
                      { label: "Location", value: state.packetAt ?? "—" },
                      { label: "Outer IPv6 DA (Service SID)", value: fmtIpv6(state.packet.outer.daHextets) },
                      { label: "SRH", value: state.packet.outer.srh ? `Segments Left ${state.packet.outer.srh.segmentsLeft}` : "(none)" },
                      { label: "Inner payload", value: state.packet.inner ? state.packet.inner.kind : "—" },
                    ]
                  : [{ label: "Packet", value: "none in flight" }]
              }
            />
          )}

          {showTroubleshoot && !isComplete && <TroubleshootingLayers title="Troubleshooting Layers" layers={diagnosticLayers} />}

          {isComplete && (
            <GlassPanel strong glow="success" className="flex flex-col items-center gap-4 p-10 text-center">
              <Badge tone="success">SRv6 VPN Architect</Badge>
              <h2 className="text-2xl font-semibold text-pv-text">CUST-A Is Connected, Over SRv6</h2>
              <p className="max-w-md text-sm text-pv-text-muted">
                You built VRF CUST-A on an SRv6 data plane end to end: real RD/RT policy, real MP-BGP VPN routes carrying a genuine
                SRv6 L3 Service TLV, per-VRF Service SIDs shared across multiple prefixes, dual-stack End.DT4/End.DT6 forwarding, and
                a repair after PE2&apos;s locator route — never PE2 itself — went missing. +800 XP awarded.
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
            {[...PE_ROUTERS, ...P_ROUTERS].map((r) => (
              <button key={r} type="button" onClick={() => setFocusRouter(r)} className={clsx("rounded-full px-3 py-1 text-[11px] font-semibold pv-mono transition-colors", focusRouter === r ? "bg-pv-cyan/15 text-pv-cyan-soft" : "text-pv-text-faint hover:text-pv-text")}>
                {r}
              </button>
            ))}
          </div>

          {focusRouter === "PE1" || focusRouter === "PE2" ? (
            <GlassPanel className="p-4">
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-pv-text-muted">{focusRouter} — VRF CUST-A</h4>
              <div className="space-y-1 pv-mono text-[11px] text-pv-text-muted">
                {(state.localRoutes[focusRouter] ?? []).map((r) => (
                  <p key={r.prefix}>
                    {r.prefix} <span className="text-pv-text-faint">(local, via {r.ce})</span>
                  </p>
                ))}
                {(state.installedAt[focusRouter] ?? []).map((p) => (
                  <p key={p.route.prefix}>
                    {p.route.prefix} <span className={p.installed ? "text-pv-success" : "text-pv-text-faint"}>({p.installed ? "installed" : "not installed"} via {p.route.originPe})</span>
                  </p>
                ))}
              </div>
            </GlassPanel>
          ) : (
            <GlassPanel className="p-4">
              <p className="text-xs text-pv-text-faint">{focusRouter} is a P router — no VRF, no customer routes, no Service SID table. Plain IPv6 forwarding only.</p>
            </GlassPanel>
          )}

          <Srv6VpnRouteViewer title={focusRouter} route={focusRoute} />

          <PacketJourneyTimeline hops={state.journey} />
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
                  Engineer challenge pending — restore PE2&apos;s locator to continue
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
                onSelectNode={(id) => {
                  setSelectedNodeId(id as ExtRouterId);
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
                        pipelineTitle: isRr1Device ? "Route Reflector — No Forwarding Pipeline" : "Conceptual SRv6 L3VPN Pipeline",
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
            ) : currentStep?.id === "repair-challenge" ? (
              <>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-pv-cyan-soft">Engineer Challenge</p>
                <RepairChallenge options={REPAIR_OPTIONS} attempt={state.repairAttempt} onTry={(choice) => engine.act({ choice })} />
              </>
            ) : showPerVrfLab ? (
              <>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-pv-violet">Per-VRF vs. Per-CE Lab</p>
                {perVrfLabPanel}
              </>
            ) : showRtMismatchLab ? (
              <>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-pv-violet">RT Mismatch Lab</p>
                {rtMismatchLabPanel}
              </>
            ) : showMissingTlvLab ? (
              <>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-pv-violet">Missing Service TLV Lab</p>
                {missingTlvLabPanel}
              </>
            ) : showPolicyPreview ? (
              <>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-pv-violet">SR Policy Service-Steering Preview</p>
                {policyPreviewPanel}
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
            ) : inDeviceMode && isRr1Device ? (
              // RR1 is a synthetic, presentation-only device with no ScenarioEngine
              // state of its own (§ rrIntegration.ts) — it never has a Hop trace, so
              // it has only one surface, not a Hop/Device switch.
              <DeviceExplorerPanel
                explanation={nodeExplanation!}
                tabs={rr1ExplorerTabs}
                xrayEnabled={deviceXray}
                onToggleXray={() => setDeviceXray((v) => !v)}
                onExit={() => {
                  setCameraMode("overview");
                  setEnteredDeviceId(undefined);
                }}
              />
            ) : inspectorSurface === "device" ? (
              inDeviceMode ? (
                <div className="space-y-3">
                  <TopologyModeSwitcher options={[{ value: "hop", label: "Hop" }, { value: "device", label: "Device" }]} value={inspectorSurface} onChange={setInspectorSurface} tone="violet" />
                  <DeviceExplorerPanel
                    explanation={nodeExplanation!}
                    tabs={isPDevice ? pExplorerTabs : peExplorerTabs}
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
                    setSelectedNodeId(id as RouterId);
                    setInspectorSurface("hop");
                    setHistoricalIndex(undefined);
                    if (cameraMode === "device" && DEVICE_ROUTERS.includes(id as RouterId)) setEnteredDeviceId(id as RouterId);
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
                  const histStep = srv6L3vpnSteps[entry.index];
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

function RepairChallenge({ options, attempt, onTry }: { options: { id: string; label: string }[]; attempt?: { choice: string; correct: boolean }; onTry: (choice: string) => void }) {
  return (
    <GlassPanel strong className="p-5">
      <p className="mb-3 text-sm font-medium text-pv-text">Choose the correct repair:</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((opt) => {
          const isSelected = attempt?.choice === opt.id;
          const isCorrect = opt.id === "restore-locator";
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
            <span className="font-semibold">✓ PE2&apos;s locator restored — Service SID resolves again, CUST-A routes re-installed.</span>
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
