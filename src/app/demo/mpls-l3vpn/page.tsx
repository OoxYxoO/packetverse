"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { clsx } from "clsx";
import { useScenarioEngine } from "@/lib/sim-engine/useScenarioEngine";
import {
  GRAPH_EDGES,
  GRAPH_NODES,
  GRAPH_REGIONS,
  LOGICAL_GRAPH_EDGES,
  LOGICAL_GRAPH_NODES,
  PROVIDER_ROUTERS,
  TERMS,
  buildL3vpnCliCommands,
  createL3VpnState,
  l3vpnSteps,
  transportLayerIndex,
  vpnLayerIndex,
  type L3VpnState,
  type RouterId,
} from "@/lib/sim-engine/scenarios/mplsL3vpn";
import { GraphTopologyViewer } from "@/components/network/GraphTopologyViewer";
import { GraphPacket } from "@/components/network/GraphPacket";
import { PacketInspector } from "@/components/network/PacketInspector";
import { RouteTablePanel } from "@/components/protocol/RouteTablePanel";
import { ForwardingDecisionCard } from "@/components/protocol/ForwardingDecisionCard";
import { PacketJourneyTimeline } from "@/components/protocol/PacketJourneyTimeline";
import { PlaneSplitPanel } from "@/components/protocol/PlaneSplitPanel";
import { VpnRouteViewer } from "@/components/protocol/VpnRouteViewer";
import { TroubleshootingLayers, type DiagnosticLayer } from "@/components/protocol/TroubleshootingLayers";
import { CLIOutputPanel } from "@/components/protocol/CLIOutputPanel";
import { PredictionQuestion } from "@/components/quiz/PredictionQuestion";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { useProgressStore } from "@/lib/state/useProgressStore";
import { NetworkScene3D } from "@/components/network3d/NetworkScene3D";
import { TopologyQuickExpand } from "@/components/network3d/TopologyQuickExpand";
import { NodeInspectorPanel } from "@/components/network3d/NodeInspectorPanel";
import { PacketFocusPanel } from "@/components/network3d/PacketFocusPanel";
import { TopologyModeSwitcher } from "@/components/network3d/TopologyModeSwitcher";
import { PlaneViewSwitcher } from "@/components/network3d/PlaneViewSwitcher";
import { DeviceExplorerPanel, InterfaceListTab, type DeviceExplorerTab } from "@/components/network3d/DeviceExplorerPanel";
import { PacketDetailPanel } from "@/components/network3d/PacketDetailPanel";
import { LinkDetailPanel } from "@/components/network3d/LinkDetailPanel";
import { layoutTo3D } from "@/components/network3d/layout";
import type { ActivePacket3D, CameraMode, Link3DData, Node3DStatus, PacketStackFrame } from "@/components/network3d/types";
import type { PacketVisual } from "@/lib/sim-engine/types";
import { explainNode } from "./explain";
import { interfacesFor, linkDetailFor, packetFramesFor, traceFor } from "./deviceTrace";
import {
  RR1_ID,
  RR1_LOOPBACK,
  explainRr1,
  packetPe2ToRr1,
  packetRr1ToPe1,
  reflectThroughRr1,
  rr1Interfaces,
  rrAttrsLayerIndex,
  vpnv4LayerIndex,
  withRr1,
} from "./rrIntegration";
import { ReflectionDecisionViewer } from "@/components/protocol/ReflectionDecisionViewer";

const DEVICE_ROUTERS: RouterId[] = ["PE1", "P1", "P2", "PE2"];
type ExtRouterId = RouterId | typeof RR1_ID;
// Pipeline stages where the device acts on the transport label vs. the VPN label — drives which
// packet-stack frames get dimmed in X-Ray (brief §6/§7/§8: "present, not used for this decision").
const TRANSPORT_FOCUS_STAGES = new Set(["read-label", "lfib-lookup", "swap", "pop"]);
const VPN_FOCUS_STAGES = new Set(["vpn-lookup", "vrf-context", "remove-label"]);

const WHY_L3VPN: { q: string; a: string }[] = [
  { q: "WHAT is MPLS L3VPN?", a: "Private Layer-3 connectivity between customer sites, across a shared provider MPLS core." },
  { q: "WHY use it?", a: "Customer routing stays separated (VRF) while the provider core stays scalable — not just \"MPLS makes it faster.\"" },
  { q: "WHEN is it used?", a: "Enterprise WAN, bank branches, government WAN, international offices, managed SP networks." },
  { q: "WITHOUT it?", a: "Either customer routes leak into the backbone, or separate physical/tunnel infrastructure is needed per customer." },
];

// Which packet-inspector layer to X-ray-focus for a given step (brief §16/§41).
const FOCUS_BY_STEP: Record<string, "transport" | "vpn"> = {
  "p1-swap": "transport",
  "predict-p-router": "transport",
  "p2-php": "transport",
  "pe2-vpn-lookup": "vpn",
  "predict-remaining-label": "vpn",
};

// The four data-plane steps that append a journey hop: PE1 push, P1 swap, P2 PHP, PE2 VPN-label lookup.
const DATA_PLANE_HOP_COUNT = 4;

const REPAIR_OPTIONS = [
  { id: "restart-mpbgp", label: "Restart the MP-BGP session" },
  { id: "flap-interface", label: "Flap the P1 ↔ P2 interface" },
  { id: "fix-rt", label: "Change PE1's CUST-A import RT to 65001:100" },
  { id: "reinstall-ldp", label: "Reinstall LDP on the core" },
];
const WRONG_FEEDBACK: Record<string, string> = {
  "restart-mpbgp": "MP-BGP is already Established — restarting it won't change import policy at all.",
  "flap-interface": "The interface, IGP, LDP and transport are all already healthy — this doesn't touch RT policy.",
  "reinstall-ldp": "LDP only distributes the transport label. It has nothing to do with VPN route import.",
};

export default function MplsL3vpnDemo() {
  const { engine, snapshot } = useScenarioEngine<L3VpnState>(createL3VpnState(), l3vpnSteps);
  const [autoPlay, setAutoPlay] = useState(false);
  const [speed, setSpeed] = useState<0.5 | 1 | 2>(1);
  const [viewMode, setViewMode] = useState<"physical" | "logical" | "3d">("physical");
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
  const [mpBgpTopology, setMpBgpTopology] = useState<"direct" | "rr">("direct");
  const [rrRelayActive, setRrRelayActive] = useState(false);
  const [rrRelayHop, setRrRelayHop] = useState<0 | 1>(0);
  const [rrDisabled, setRrDisabled] = useState(false);
  const [rrQuestionAnswer, setRrQuestionAnswer] = useState<"yes" | "no" | undefined>(undefined);
  const completeLesson = useProgressStore((s) => s.completeLesson);
  const recordAnswer = useProgressStore((s) => s.recordAnswer);
  const unlockAchievement = useProgressStore((s) => s.unlockAchievement);
  const awardedRef = useRef(false);

  const { state, currentStep, index, totalSteps, isComplete, lastAnswer, whatChanged, activePacket } = snapshot;
  const canAdvance = engine.canAdvance();

  const mpbgpIntroIndex = l3vpnSteps.findIndex((s) => s.id === "mpbgp-intro");
  const showRrToggle = index >= mpbgpIntroIndex;
  const rrModeActive = showRrToggle && mpBgpTopology === "rr";

  // --- Route Reflector integration (brief: "Add Route Reflector Integration to the Existing MPLS L3VPN Lesson")
  // RR1 is spliced into the node/edge lists ONLY when the learner opts into Route Reflector mode — Direct
  // Peering renders GRAPH_NODES/GRAPH_EDGES exactly as before, byte for byte. The canonical VPNv4 route
  // (RD/RT/next-hop/VPN label) stays entirely owned by state.vpnRoute; rrIntegration.ts only reflects it. ---
  const baseNodes = viewMode === "physical" ? GRAPH_NODES : LOGICAL_GRAPH_NODES;
  const baseEdges = viewMode === "physical" ? GRAPH_EDGES : LOGICAL_GRAPH_EDGES;
  const augmented = rrModeActive ? withRr1(baseNodes, baseEdges, "PE1", "PE2") : { nodes: baseNodes, edges: baseEdges };
  const nodes = augmented.nodes;
  const edges = augmented.edges.map((e) => ({ ...e, state: "full" as const }));
  const activeNodeIds = activePacket ? [activePacket.from, activePacket.to] : [];
  const packetFrom = activePacket ? nodes.find((n) => n.id === activePacket.from) : undefined;
  const packetTo = activePacket ? nodes.find((n) => n.id === activePacket.to) : undefined;

  // --- Synthetic PE2→RR1→PE1 relay replay (brief §2) — purely a presentational animation the learner
  // triggers manually; it never touches L3VpnState. Reuses the SAME real route fields for both hops. ---
  const canShowRrRelay = rrModeActive && state.vpnRoute?.vpnLabel !== undefined && !rrDisabled;
  const rrReflected = state.vpnRoute ? reflectThroughRr1(state.vpnRoute, RR1_LOOPBACK) : undefined;
  const rrRelayPacket: PacketVisual | undefined =
    rrRelayActive && state.vpnRoute
      ? rrRelayHop === 0
        ? packetPe2ToRr1(state.vpnRoute)
        : rrReflected
          ? packetRr1ToPe1(state.vpnRoute, rrReflected)
          : undefined
      : undefined;

  useEffect(() => {
    if (!rrRelayActive) return;
    const t = setTimeout(() => {
      if (rrRelayHop === 0) setRrRelayHop(1);
      else setRrRelayActive(false);
    }, 1600);
    return () => clearTimeout(t);
  }, [rrRelayActive, rrRelayHop]);

  const focusKind = FOCUS_BY_STEP[currentStep?.id ?? ""];
  const focusIndices = focusKind === "transport" ? transportLayerIndex(state.packet) : focusKind === "vpn" ? vpnLayerIndex(state.packet) : undefined;

  const cliCommands = useMemo(() => buildL3vpnCliCommands(state, focusRouter), [state, focusRouter]);
  const lastHop = state.journey[state.journey.length - 1];
  const showPlanes = index >= l3vpnSteps.findIndex((s) => s.id === "send-ce1");
  const showTroubleshootLayers = index >= l3vpnSteps.findIndex((s) => s.id === "break-intro");

  // --- 3D derived state (brief §15: 3D layer subscribes to the same scenario state; deviceTrace.ts is the Scene Adapter — no protocol logic here or in components/network3d/) ---
  // The 3D scene always renders the PHYSICAL layout (independent of the 2D physical/logical toggle) — RR1 is
  // spliced into that SAME physical graph, exactly like the 2D views, only when Route Reflector mode is on.
  const physicalAugmented = rrModeActive ? withRr1(GRAPH_NODES, GRAPH_EDGES, "PE1", "PE2") : { nodes: GRAPH_NODES, edges: GRAPH_EDGES };
  const nodes3DBase = useMemo(() => layoutTo3D(physicalAugmented.nodes), [physicalAugmented.nodes]);
  const visitedRouters = new Set(state.journey.map((h) => h.router));
  if (state.packet) visitedRouters.add("CE1");
  const nodes3D = nodes3DBase.map((n) => {
    let status: Node3DStatus = "idle";
    if (n.id === selectedNodeId || n.id === enteredDeviceId) status = "selected";
    else if (rrRelayPacket && (n.id === rrRelayPacket.from || n.id === rrRelayPacket.to)) status = "active";
    else if (activePacket && (n.id === activePacket.from || n.id === activePacket.to)) status = "active";
    else if (visitedRouters.has(n.id as RouterId)) status = "onPath";
    const badges = n.id === "PE1" || n.id === "PE2" ? ["VRF CUST-A"] : n.id === RR1_ID ? (rrDisabled ? ["DISABLED"] : ["RR"]) : undefined;
    return { ...n, status, badges };
  });
  const links3D: Link3DData[] = physicalAugmented.edges.map((e) => ({
    ...e,
    active: rrRelayPacket
      ? (e.a === rrRelayPacket.from && e.b === rrRelayPacket.to) || (e.b === rrRelayPacket.from && e.a === rrRelayPacket.to)
      : activePacket
        ? (e.a === activePacket.from && e.b === activePacket.to) || (e.b === activePacket.from && e.a === activePacket.to)
        : false,
    onPath: visitedRouters.has(e.a as RouterId) && visitedRouters.has(e.b as RouterId),
  }));
  const activePacket3D: ActivePacket3D | undefined = rrRelayPacket
    ? { packet: rrRelayPacket, fromId: rrRelayPacket.from, toId: rrRelayPacket.to }
    : activePacket && nodes3D.some((n) => n.id === activePacket.from) && nodes3D.some((n) => n.id === activePacket.to)
      ? { packet: activePacket, fromId: activePacket.from, toId: activePacket.to }
      : undefined;
  const selectedNode3D = nodes3D.find((n) => n.id === selectedNodeId);
  const questionActive = !isComplete && !!currentStep?.question && lastAnswer?.stepId !== currentStep.id;

  // Which router (if any) is actively processing the packet right now — drives auto-enter in Packet Follow mode.
  const activeDeviceId = DEVICE_ROUTERS.find((r) => traceFor(r, state, currentStep?.id ?? "")?.activeStageId !== undefined);
  const effectiveDeviceId = cameraMode === "device" ? enteredDeviceId : cameraMode === "packetFollow" && autoEnterDevices ? activeDeviceId : undefined;
  const inDeviceMode = !!effectiveDeviceId;

  const isRr1Device = effectiveDeviceId === RR1_ID;
  const deviceTrace = effectiveDeviceId && !isRr1Device ? traceFor(effectiveDeviceId, state, currentStep?.id ?? "") : undefined;

  // While the packet inspector is open and paused inside manual Device mode, Step Forward/Step Back
  // can move the packet into a different router than the one currently entered — keep the chassis
  // view following the packet so it never shows one device's pipeline with another device's packet data.
  // Read the engine's fresh snapshot synchronously right after advancing so this stays a plain
  // event-handler state update rather than a setState-in-effect cascade.
  const followPacketIntoCurrentDevice = () => {
    if (!packetSelected || cameraMode !== "device") return;
    const snap = engine.getSnapshot();
    const nextDevice = DEVICE_ROUTERS.find((r) => traceFor(r, snap.state, snap.currentStep?.id ?? "")?.activeStageId !== undefined);
    if (nextDevice) setEnteredDeviceId(nextDevice);
  };
  const deviceInterfaces = isRr1Device ? rr1Interfaces() : effectiveDeviceId ? interfacesFor(effectiveDeviceId, state, currentStep?.id ?? "") : [];
  const devicePacketFrames: PacketStackFrame[] | undefined = effectiveDeviceId ? packetFramesFor(state, deviceTrace?.activeStageId) : undefined;
  const deviceFocusTones: PacketStackFrame["tone"][] | undefined =
    deviceTrace?.activeStageId && TRANSPORT_FOCUS_STAGES.has(deviceTrace.activeStageId)
      ? ["transport"]
      : deviceTrace?.activeStageId && VPN_FOCUS_STAGES.has(deviceTrace.activeStageId)
        ? ["vpn"]
        : undefined;

  const followNode3D = cameraMode === "packetFollow" && activePacket ? nodes3D.find((n) => n.id === (state.packetAt ?? activePacket.to)) : undefined;
  const focusPosition3D: [number, number, number] | undefined =
    cameraMode === "freeOrbit" ? undefined : inDeviceMode ? [0, 0, deviceXray ? -0.2 : 0] : cameraMode === "packetFollow" ? followNode3D?.position : selectedNode3D?.position;
  const eyeOffset3D: [number, number, number] | undefined = inDeviceMode ? (deviceXray ? [0.6, 2.6, 5.2] : [2.1, 1.5, 3.8]) : undefined;

  const explainTargetId = effectiveDeviceId ?? selectedNodeId ?? followNode3D?.id;
  const nodeExplanation = explainTargetId === RR1_ID ? explainRr1(state.vpnRoute, rrDisabled) : explainTargetId ? explainNode(state, explainTargetId as RouterId) : undefined;
  const xrayPacket = activePacket && (selectedNodeId === activePacket.from || selectedNodeId === activePacket.to) ? activePacket : undefined;
  const lastJourneyHop = state.journey[state.journey.length - 1];

  const selectedLinkDetail = selectedLinkId ? linkDetailFor(selectedLinkId, state) : undefined;
  const packetCurrentDeviceLabel = effectiveDeviceId ?? state.packetAt ?? activePacket?.from ?? "—";
  const packetDirection = "PE1 → P1 → P2 → PE2";

  const devicePacketForTab = rrRelayPacket ?? xrayPacket ?? (effectiveDeviceId && state.packetAt === effectiveDeviceId ? activePacket : undefined);
  const rrFocusIndices = rrRelayPacket ? (rrRelayHop === 0 ? vpnv4LayerIndex(rrRelayPacket) : rrAttrsLayerIndex(rrRelayPacket)) : undefined;

  const rr1ExplorerTabs: DeviceExplorerTab[] = nodeExplanation
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
            </div>
          ),
        },
        {
          id: "interfaces",
          label: "Interfaces",
          content: <InterfaceListTab interfaces={deviceInterfaces} selectedInterfaceId={selectedInterfaceId} onSelectInterface={setSelectedInterfaceId} />,
        },
        {
          id: "reflection",
          label: "Reflection",
          content: state.vpnRoute ? (
            <ReflectionDecisionViewer
              title="RR1 Reflection Decision"
              receivedFromLabel="PE2"
              receivedFromRelationship="client"
              candidates={[{ id: "PE1", label: "PE1", relationship: "client", decision: rrReflected?.decision ?? "reflect", reason: rrReflected?.reason ?? "" }]}
            />
          ) : (
            <p className="text-xs text-pv-text-faint">No VPNv4 route to reflect yet.</p>
          ),
        },
        {
          id: "packet",
          label: "Packet",
          content: devicePacketForTab ? <PacketInspector packet={devicePacketForTab} focusLayerIndices={xrayMode ? rrFocusIndices : undefined} /> : <p className="text-xs text-pv-text-faint">No packet at RR1 right now — try &quot;Show VPNv4 Route via RR1&quot;.</p>,
        },
      ]
    : [];

  const mplsExplorerTabs: DeviceExplorerTab[] = nodeExplanation
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
              {nodeExplanation.note && <p className="rounded-lg border border-pv-warning/30 bg-pv-warning/5 p-2.5 text-xs text-pv-text-muted">{nodeExplanation.note}</p>}
            </div>
          ),
        },
        {
          id: "hardware",
          label: "Hardware",
          content: (
            <div className="space-y-2 text-xs text-pv-text-muted">
              <p>
                Generic stylized {nodeExplanation.deviceType.toLowerCase()} chassis — {deviceInterfaces.length} physical interface{deviceInterfaces.length === 1 ? "" : "s"}.
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
        {
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
              {devicePacketForTab ? <PacketInspector packet={devicePacketForTab} focusLayerIndices={xrayMode ? focusIndices : undefined} /> : <p className="text-xs text-pv-text-faint">No packet at this device right now.</p>}
            </div>
          ),
        },
        {
          id: "tables",
          label: "Tables",
          content:
            nodeExplanation.tables && nodeExplanation.tables.length > 0 ? (
              <div className="space-y-2">
                {nodeExplanation.tables.map((t) => (
                  <div key={t.title} className="rounded-lg border border-pv-border p-2.5">
                    <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-pv-text-faint">{t.title}</p>
                    <div className="space-y-0.5 pv-mono text-[11px]">
                      {t.rows.map((r) => (
                        <div key={r.label} className="flex justify-between gap-3">
                          <span className="text-pv-text-faint">{r.label}</span>
                          <span className="text-pv-text">{r.value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-pv-text-faint">No tables for this device yet.</p>
            ),
        },
        {
          id: "control",
          label: "Control Plane",
          content: (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {nodeExplanation.controlPlaneRole && (
                <div className="rounded-lg border border-pv-border p-2.5">
                  <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-pv-text-faint">Control Plane</p>
                  <p className="text-xs text-pv-text-muted">{nodeExplanation.controlPlaneRole}</p>
                </div>
              )}
              {nodeExplanation.dataPlaneRole && (
                <div className="rounded-lg border border-pv-border p-2.5">
                  <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-pv-text-faint">Data Plane</p>
                  <p className="text-xs text-pv-text-muted">{nodeExplanation.dataPlaneRole}</p>
                </div>
              )}
            </div>
          ),
        },
        { id: "cli", label: "CLI", content: <CLIOutputPanel commands={cliCommands} /> },
      ]
    : [];

  const diagnosticLayers: DiagnosticLayer[] = [
    { label: "Interface", status: "healthy" },
    { label: "IGP", status: "healthy" },
    { label: "LDP", status: "healthy" },
    { label: "MPLS Transport", status: "healthy" },
    { label: "MP-BGP", status: "healthy" },
    { label: "RT Import", status: state.faultActive ? "failing" : state.received.PE1?.imported ? "healthy" : "unknown" },
    { label: "VRF Route", status: state.faultActive ? "failing" : state.received.PE1?.imported ? "healthy" : "unknown" },
  ];

  useEffect(() => {
    if (isComplete && !awardedRef.current) {
      awardedRef.current = true;
      completeLesson("mpls-l3vpn", 300);
      unlockAchievement("vpn-architect");
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
    setMpBgpTopology("direct");
    setRrRelayActive(false);
    setRrRelayHop(0);
    setRrDisabled(false);
    setRrQuestionAnswer(undefined);
  };

  const nextLabel = currentStep?.question && !lastAnswer ? "Answer to continue" : currentStep?.requiresState && !canAdvance ? "Apply the correct fix to continue" : "Next Step →";

  const focusVrfs = state.vrfs[focusRouter];
  const focusIgp = state.igpRoutes[focusRouter];
  const focusReceived = state.received[focusRouter];

  return (
    <div className="mx-auto max-w-7xl px-6 py-10">
      <div className="mb-6">
        <Badge tone="cyan" className="mb-3">
          MPLS L3VPN · VRF + RD/RT + MP-BGP + Two-Label Stack
        </Badge>
        <h1 className="text-2xl font-semibold text-pv-text sm:text-3xl">Two Sites, One Private Network, Zero Shared Routes</h1>
        <p className="mt-2 max-w-3xl text-sm text-pv-text-muted">
          Watch a customer route become a VPNv4 route, cross MP-BGP, and get imported by RT policy — then watch the actual packet
          carry two labels across the exact same core you already built.
        </p>
      </div>

      <div className="mb-4 grid gap-2 sm:grid-cols-4">
        {WHY_L3VPN.map((item) => (
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
        {l3vpnSteps.map((step, i) => (
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
            { value: "physical", label: "Physical Topology" },
            { value: "logical", label: "Logical (VPN) View" },
            { value: "3d", label: "3D View" },
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
                { value: "freeOrbit", label: "Free Orbit" },
              ]}
              value={cameraMode}
              onChange={(v) => {
                setCameraMode(v);
                if (v === "device" && !enteredDeviceId) setEnteredDeviceId(selectedNodeId ?? activeDeviceId ?? "PE1");
                if (v === "overview") {
                  setEnteredDeviceId(undefined);
                  setSelectedNodeId(undefined);
                }
                if (v === "freeOrbit") setEnteredDeviceId(undefined);
              }}
            />
            {inDeviceMode && (
              <TopologyModeSwitcher
                options={[
                  { value: "off", label: "Exterior" },
                  { value: "on", label: "X-Ray" },
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
            <TopologyModeSwitcher
              options={[
                { value: "off", label: "Normal View" },
                { value: "on", label: "X-Ray Packet View" },
              ]}
              value={xrayMode ? "on" : "off"}
              onChange={(v) => setXrayMode(v === "on")}
              tone="violet"
            />
          </>
        )}
        {showRrToggle && (
          <TopologyModeSwitcher
            options={[
              { value: "direct", label: "Direct Peering" },
              { value: "rr", label: "Route Reflector" },
            ]}
            value={mpBgpTopology}
            onChange={(v) => {
              setMpBgpTopology(v);
              if (v === "direct") {
                setRrRelayActive(false);
                setRrDisabled(false);
                if (selectedNodeId === RR1_ID) setSelectedNodeId(undefined);
                if (enteredDeviceId === RR1_ID) {
                  setEnteredDeviceId(undefined);
                  setCameraMode("overview");
                }
              }
            }}
            tone="violet"
          />
        )}
        {showPlanes && <PlaneViewSwitcher value={planeView} onChange={setPlaneView} />}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_400px]">
        {/* MAIN COLUMN */}
        <div className="space-y-6">
          {viewMode === "3d" ? (
            <>
              <TopologyQuickExpand questionActive={questionActive} nodes={nodes3D} links={links3D} activePacket={activePacket3D}>
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
                        focusTones: deviceFocusTones,
                      }
                    : undefined
                }
              />
              </TopologyQuickExpand>

              {cameraMode === "packetFollow" && (
                <PacketFocusPanel
                  currentHopLabel={lastJourneyHop ? `${lastJourneyHop.router}: ${lastJourneyHop.action} → ${lastJourneyHop.output}` : undefined}
                  hopIndex={state.journey.length}
                  totalHops={DATA_PLANE_HOP_COUNT}
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
                  focusLayerIndices={xrayMode ? focusIndices : undefined}
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
                  tabs={isRr1Device ? rr1ExplorerTabs : mplsExplorerTabs}
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
                  <NodeInspectorPanel explanation={nodeExplanation} packet={xrayPacket} focusLayerIndices={xrayMode ? focusIndices : undefined} xrayEnabled={xrayMode}>
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
              <GraphTopologyViewer nodes={nodes} edges={edges} activeNodeIds={activeNodeIds} regions={viewMode === "physical" ? GRAPH_REGIONS : []}>
                {activePacket && packetFrom && packetTo && <GraphPacket packet={activePacket} from={packetFrom} to={packetTo} />}
              </GraphTopologyViewer>

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

          {!isComplete && currentStep?.question && (
            <PredictionQuestion
              question={currentStep.question}
              selectedOptionId={lastAnswer?.stepId === currentStep.id ? lastAnswer.optionId : undefined}
              onAnswer={handleAnswer}
            />
          )}

          {!isComplete && currentStep?.id === "repair-challenge" && (
            <RepairChallenge options={REPAIR_OPTIONS} attempt={state.repairAttempt} onTry={(choice) => engine.act({ choice })} />
          )}

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

          {rrModeActive && !isComplete && (
            <GlassPanel strong className="space-y-3 p-5">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-pv-violet">MP-BGP Via Route Reflector</h3>
                {rrDisabled && <Badge tone="danger">RR1 Control-Plane Session Disabled</Badge>}
              </div>
              <p className="text-xs text-pv-text-muted">
                Same VPNv4 route (RD {state.vpnRoute?.rd ?? "—"}, RT {state.vpnRoute?.rt ?? "—"}, VPN label {state.vpnRoute?.vpnLabel ?? "—"}) — now distributed PE2 → RR1 → PE1 instead of directly. RR1 adds ORIGINATOR_ID and CLUSTER_LIST; it never carries customer traffic.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  disabled={!canShowRrRelay || rrRelayActive}
                  onClick={() => {
                    setRrRelayActive(true);
                    setRrRelayHop(0);
                  }}
                >
                  {rrDisabled ? "RR1 disabled" : !canShowRrRelay ? "VPNv4 route not built yet" : rrRelayActive ? (rrRelayHop === 0 ? "PE2 → RR1…" : "RR1 → PE1…") : "Show VPNv4 Route via RR1 →"}
                </Button>
                <button
                  type="button"
                  onClick={() => setRrDisabled((v) => !v)}
                  className={clsx(
                    "rounded-full border px-3 py-1.5 text-xs font-semibold uppercase tracking-wide transition-colors",
                    rrDisabled ? "border-pv-danger/50 bg-pv-danger/10 text-pv-danger" : "border-pv-border text-pv-text-faint hover:text-pv-text",
                  )}
                >
                  {rrDisabled ? "Re-Enable RR1 Session" : "Disable RR1 Control-Plane Session"}
                </button>
              </div>
              {rrDisabled && (
                <p className="rounded-lg border border-pv-warning/40 bg-pv-warning/5 p-2.5 text-xs text-pv-text-muted">
                  RR1&apos;s control-plane session is down: it can no longer distribute new or changed VPNv4 routes. This does not mean customer packets already forwarding stop instantly — existing MPLS transport LSPs and any already-installed VRF routes are a separate, already-converged mechanism that isn&apos;t torn down just because RR1 stopped reflecting. What breaks is future route distribution and convergence, not necessarily traffic already in flight.
                </p>
              )}
              <RrQuestion answer={rrQuestionAnswer} onAnswer={setRrQuestionAnswer} />
            </GlassPanel>
          )}

          {showPlanes && !isComplete && (
            <PlaneSplitPanel
              show={planeView}
              controlTitle={rrModeActive ? "Control Plane — PE2 → RR1 → PE1" : "Control Plane — VRF → RD → RT → MP-BGP"}
              controlRows={[
                { label: "VRF CUST-A (PE1)", value: `${state.vrfs.PE1?.find((v) => v.name === "CUST-A")?.routes.length ?? 0} routes` },
                { label: "VPNv4 route RD", value: state.vpnRoute?.rd ?? "—" },
                { label: "VPNv4 route RT", value: state.vpnRoute?.rt ?? "—" },
                { label: "VPN label", value: state.vpnRoute?.vpnLabel !== undefined ? String(state.vpnRoute.vpnLabel) : "—" },
                ...(rrModeActive ? [{ label: "MP-BGP topology", value: "PE2 → RR1 → PE1 (reflected)" }] : []),
                { label: "PE1 import result", value: state.received.PE1 ? (state.received.PE1.imported ? "Imported" : state.received.PE1.rtChecked ? "Rejected (RT mismatch)" : "Received, not yet checked") : "—" },
              ]}
              dataTitle="Data Plane — Current Packet"
              dataRows={
                state.packet
                  ? [
                      { label: "Location", value: state.packetAt ?? "—" },
                      { label: "Labels on wire (outer→inner)", value: state.packet.labels.length ? state.packet.labels.map((l) => `${l.value}(${l.purpose})`).join(" → ") : "(none)" },
                      { label: "Destination", value: state.packet.dstIp },
                    ]
                  : [{ label: "Packet", value: "none in flight" }]
              }
            />
          )}

          {showTroubleshootLayers && !isComplete && <TroubleshootingLayers title="Troubleshooting Layers" layers={diagnosticLayers} />}

          {isComplete && (
            <GlassPanel strong glow="success" className="flex flex-col items-center gap-4 p-10 text-center">
              <Badge tone="success">VPN Architect</Badge>
              <h2 className="text-2xl font-semibold text-pv-text">Customer A Is Connected, End To End</h2>
              <p className="max-w-md text-sm text-pv-text-muted">
                You built a VRF, watched a route become VPNv4 with a real RD and RT, saw MP-BGP carry it with a VPN label, imported
                it under real policy, pushed a genuine two-label stack, and watched the core forward on the outer transport label
                only — the VPN label rode along the whole way, present but unused until the egress PE — then repaired a Route Target
                mismatch under a fully healthy transport and control plane. +300 XP awarded.
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
              <Button variant={autoPlay ? "primary" : "ghost"} size="sm" onClick={() => setAutoPlay((v) => !v)}>
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
          <PacketInspector packet={activePacket} focusLayerIndices={focusIndices} />

          <div className="flex flex-wrap gap-1 rounded-full border border-pv-border p-0.5 w-fit">
            {PROVIDER_ROUTERS.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setFocusRouter(r)}
                className={clsx(
                  "rounded-full px-3 py-1 text-[11px] font-semibold pv-mono transition-colors",
                  focusRouter === r ? "bg-pv-cyan/15 text-pv-cyan-soft" : "text-pv-text-faint hover:text-pv-text",
                )}
              >
                {r}
              </button>
            ))}
          </div>

          {focusVrfs && focusVrfs.length > 0 ? (
            <GlassPanel className="p-4">
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-pv-text-muted">{focusRouter} — VRF Tables</h4>
              <div className="space-y-3">
                {focusVrfs.map((v) => (
                  <div key={v.name} className="rounded-lg border border-pv-border p-2.5 text-[11px]">
                    <div className="mb-1.5 flex items-center justify-between">
                      <Badge tone={v.name === "CUST-A" ? "cyan" : "violet"}>{v.name}</Badge>
                      <span className="pv-mono text-pv-text-faint">
                        RT {v.importRt}
                        {v.importRt !== v.exportRt && <span className="text-pv-danger"> (export {v.exportRt})</span>}
                      </span>
                    </div>
                    {v.routes.map((r) => (
                      <p key={r.prefix} className="pv-mono text-pv-text-muted">
                        {r.prefix} <span className="text-pv-text-faint">({r.origin}{r.viaPe ? ` via ${r.viaPe}` : ""})</span>
                      </p>
                    ))}
                  </div>
                ))}
              </div>
            </GlassPanel>
          ) : (
            <GlassPanel className="p-4">
              <p className="text-xs text-pv-text-faint">{focusRouter} is a P router — it has no VRF and never holds a customer route.</p>
            </GlassPanel>
          )}

          <RouteTablePanel title={`${focusRouter} — Global IGP Route`} routes={focusIgp ? [focusIgp] : []} />

          <VpnRouteViewer
            title={focusRouter}
            route={
              focusRouter === "PE2" && state.vpnRoute
                ? {
                    vrf: state.vpnRoute.vrf,
                    prefix: state.vpnRoute.prefix,
                    originPe: state.vpnRoute.originPe,
                    rd: state.vpnRoute.rd,
                    rt: state.vpnRoute.rt,
                    nextHop: state.vpnRoute.nextHop,
                    vpnLabel: state.vpnRoute.vpnLabel,
                  }
                : focusReceived
                  ? {
                      vrf: focusReceived.route.vrf,
                      prefix: focusReceived.route.prefix,
                      originPe: focusReceived.route.originPe,
                      rd: focusReceived.route.rd,
                      rt: focusReceived.route.rt,
                      nextHop: focusReceived.route.nextHop,
                      vpnLabel: focusReceived.route.vpnLabel,
                      received: true,
                      rtChecked: focusReceived.rtChecked,
                      imported: focusReceived.imported,
                      originatorId: rrModeActive && focusRouter === "PE1" ? rrReflected?.originatorId : undefined,
                      clusterList: rrModeActive && focusRouter === "PE1" ? rrReflected?.clusterList : undefined,
                    }
                  : undefined
            }
          />

          <PacketJourneyTimeline hops={state.journey} />
          <CLIOutputPanel commands={cliCommands} />
        </div>
      </div>
    </div>
  );
}

/** Req §6's "Important question" — deliberately local/optional state, not an engine step, so Direct Peering learners never see an extra timeline entry and this can be re-asked freely inside the RR toggle. */
function RrQuestion({ answer, onAnswer }: { answer: "yes" | "no" | undefined; onAnswer: (a: "yes" | "no") => void }) {
  return (
    <div className="rounded-lg border border-pv-border p-3">
      <p className="mb-2 text-xs font-medium text-pv-text">The VPNv4 route traveled through RR1. Must customer traffic also pass through RR1?</p>
      <div className="flex gap-2">
        {(["yes", "no"] as const).map((opt) => (
          <button
            key={opt}
            type="button"
            onClick={() => onAnswer(opt)}
            className={clsx(
              "rounded-lg border px-3 py-1.5 text-xs font-semibold uppercase transition-colors",
              answer === opt ? (opt === "no" ? "border-pv-success/50 bg-pv-success/10 text-pv-success" : "border-pv-danger/50 bg-pv-danger/10 text-pv-danger") : "border-pv-border text-pv-text-muted hover:text-pv-text",
            )}
          >
            {opt}
          </button>
        ))}
      </div>
      {answer && (
        <p className="mt-2 text-xs text-pv-text-muted">
          {answer === "no" ? <span className="font-semibold text-pv-success">Correct — no.</span> : <span className="font-semibold text-pv-danger">Not quite.</span>} Route distribution path and packet forwarding path are separate concepts: RR1 told PE1 how to reach the route, but customer packets still follow the MPLS transport LSP (CE1 → PE1 → P1 → P2 → PE2 → CE2), which never involves RR1.
        </p>
      )}
    </div>
  );
}

function RepairChallenge({
  options,
  attempt,
  onTry,
}: {
  options: { id: string; label: string }[];
  attempt?: { choice: string; correct: boolean };
  onTry: (choice: string) => void;
}) {
  return (
    <GlassPanel strong className="p-5">
      <p className="mb-3 text-sm font-medium text-pv-text">Choose the correct repair for PE1&apos;s VRF CUST-A:</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((opt) => {
          const isSelected = attempt?.choice === opt.id;
          const isCorrect = opt.id === "fix-rt";
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
        <div
          className={clsx(
            "mt-4 rounded-xl border p-4 text-sm",
            attempt.correct ? "border-pv-success/50 bg-pv-success/10 text-pv-success" : "border-pv-warning/40 bg-pv-warning/5 text-pv-text-muted",
          )}
        >
          {attempt.correct ? (
            <span className="font-semibold">✓ Import RT corrected — 10.2.2.0/24 re-imported into CUST-A.</span>
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
