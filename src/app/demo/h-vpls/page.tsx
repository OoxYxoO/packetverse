"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { clsx } from "clsx";
import { useScenarioEngine } from "@/lib/sim-engine/useScenarioEngine";
import {
  ALL_DEVICES,
  GRAPH_EDGES,
  GRAPH_NODES,
  HIERARCHY_GRAPH_EDGES,
  HIERARCHY_GRAPH_NODES,
  LINKS,
  MTU_NODES,
  PE_ROUTERS,
  ROUTER_LOOPBACK,
  SERVICE_GRAPH_EDGES,
  SERVICE_GRAPH_NODES,
  SERVICE_NAME,
  STEP_IDX,
  TERMS,
  VLAN,
  HVPLS_XP_AWARD,
  allocatePwReceiveLabel,
  allocateSpokeReceiveLabel,
  buildHvplsCliCommands,
  bridgePortsFor,
  createHvplsState,
  fdbFor,
  hVplsSteps,
  portLabel,
  peSpokePair,
  pwPeersOf,
  pwUpBetween,
  resolveAttachmentCircuits,
  spokePairFor,
  spokeUp,
  transportReachable,
  calculateFullMeshPwCount,
  calculateHierarchicalPwCount,
  type HvplsState,
  type RouterId,
  type PeId,
  type MtuId,
} from "@/lib/sim-engine/scenarios/hVpls";
import { GraphTopologyViewer } from "@/components/network/GraphTopologyViewer";
import { GraphPacket } from "@/components/network/GraphPacket";
import { PacketInspector } from "@/components/network/PacketInspector";
import { ForwardingDecisionCard } from "@/components/protocol/ForwardingDecisionCard";
import { PacketJourneyTimeline } from "@/components/protocol/PacketJourneyTimeline";
import { PlaneSplitPanel } from "@/components/protocol/PlaneSplitPanel";
import { ServiceInstanceViewer } from "@/components/protocol/ServiceInstanceViewer";
import { PseudowireViewer } from "@/components/protocol/PseudowireViewer";
import { EthernetFdbViewer } from "@/components/protocol/EthernetFdbViewer";
import { BridgePortsViewer } from "@/components/protocol/BridgePortsViewer";
import { TroubleshootingLayers, type DiagnosticLayer } from "@/components/protocol/TroubleshootingLayers";
import { CLIOutputPanel } from "@/components/protocol/CLIOutputPanel";
import { PredictionQuestion } from "@/components/quiz/PredictionQuestion";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { useProgressStore } from "@/lib/state/useProgressStore";
import { NetworkScene3D, type FloodCopy3D } from "@/components/network3d/NetworkScene3D";
import { TopologyQuickExpand } from "@/components/network3d/TopologyQuickExpand";
import { NodeInspectorPanel } from "@/components/network3d/NodeInspectorPanel";
import { TopologyModeSwitcher } from "@/components/network3d/TopologyModeSwitcher";
import { PlaneViewSwitcher } from "@/components/network3d/PlaneViewSwitcher";
import { DeviceExplorerPanel, InterfaceListTab, type DeviceExplorerTab } from "@/components/network3d/DeviceExplorerPanel";
import { PacketDetailPanel } from "@/components/network3d/PacketDetailPanel";
import { LinkDetailPanel } from "@/components/network3d/LinkDetailPanel";
import { layoutTo3D } from "@/components/network3d/layout";
import type { ActivePacket3D, CameraMode, Link3DData, Node3DStatus, PacketStackFrame } from "@/components/network3d/types";
import type { DeviceKind } from "@/lib/sim-engine/types";
import { bridgePortsSummary, explainNode } from "./explain";
import { interfacesFor, linkDetailFor, packetFramesFor, traceFor } from "./deviceTrace";

const DEVICE_ROUTERS: RouterId[] = ALL_DEVICES;
type TopoView = "physical" | "hierarchy" | "service" | "mac-learning";

const WHY_HVPLS: { q: string; a: string }[] = [
  { q: "WHAT IS H-VPLS?", a: "RFC 4762's hierarchical VPLS: access MTU-s bridges spoke into a smaller core mesh of PE-rs hubs, instead of every device joining one giant full mesh." },
  { q: "WHY HIERARCHY?", a: "A flat full mesh costs n(n-1)/2 pseudowires. Restructuring into access + core tiers lets new access sites cost one spoke each, not one PW to every existing device." },
  { q: "WHAT'S NEW ABOUT SPLIT HORIZON?", a: "Only mesh-to-mesh relay is forbidden. A spoke PW behaves like an access-side port — it may freely forward onto the mesh, and the mesh may freely forward back onto it." },
  { q: "IS THIS EVPN?", a: "No. H-VPLS still uses classic data-plane MAC learning and flooding-based discovery — just restructured across two bridging tiers. EVPN is a different, BGP-based control plane, covered next." },
];

const REPAIR_OPTIONS = [
  { id: "reclassify-pe1-spoke", label: "Reclassify PE1's port toward MTU1 back to SPOKE_PW" },
  { id: "disable-split-horizon-globally", label: "Disable hierarchical split horizon globally so PE1 can relay onto every mesh port regardless" },
  { id: "restart-mtu1-pseudowire", label: "Restart the MTU1-PE1 pseudowire" },
  { id: "clear-all-mac-tables", label: "Clear every device's MAC table" },
];
const WRONG_FEEDBACK: Record<string, string> = {
  "disable-split-horizon-globally": "Never do this. The mesh-only split-horizon rule is correct and still needed — PE2 and PE3 must still never relay onto each other's mesh ports. The actual defect is that PE1's OWN spoke got misclassified as a mesh port; disabling the rule mesh-wide would reopen a real loop-prevention hazard everywhere just to mask one port's wrong label.",
  "restart-mtu1-pseudowire": "The spoke pseudowire is already genuinely UP — signaling operational, labels valid. Restarting it changes nothing about PE1's port-role classification, which is the actual defect.",
  "clear-all-mac-tables": "Relearning MAC addresses doesn't correct a forwarding-policy misclassification. PE1 will simply relearn the same MACs against the same wrongly-classified port and fail exactly the same way.",
};

export default function HVplsDemo() {
  const { engine, snapshot } = useScenarioEngine<HvplsState>(createHvplsState(), hVplsSteps);
  const [autoPlay, setAutoPlay] = useState(false);
  const [speed, setSpeed] = useState<0.5 | 1 | 2>(1);
  const [topoView, setTopoView] = useState<TopoView>("physical");
  const [viewMode3D, setViewMode3D] = useState(false);
  const [planeView, setPlaneView] = useState<"control" | "data" | "both">("both");
  const [focusRouter, setFocusRouter] = useState<RouterId>("MTU1");
  const [selectedNodeId, setSelectedNodeId] = useState<RouterId | undefined>(undefined);
  const [cameraMode, setCameraMode] = useState<CameraMode>("overview");
  const [enteredDeviceId, setEnteredDeviceId] = useState<RouterId | undefined>(undefined);
  const [deviceXray, setDeviceXray] = useState(true);
  const [autoEnterDevices, setAutoEnterDevices] = useState(true);
  const [selectedInterfaceId, setSelectedInterfaceId] = useState<string | undefined>(undefined);
  const [selectedLinkId, setSelectedLinkId] = useState<string | undefined>(undefined);
  const [packetSelected, setPacketSelected] = useState(false);
  const [xrayMode, setXrayMode] = useState(true);
  const awardedRef = useRef(false);
  const completeLesson = useProgressStore((s) => s.completeLesson);
  const recordAnswer = useProgressStore((s) => s.recordAnswer);
  const unlockAchievement = useProgressStore((s) => s.unlockAchievement);

  const { state, currentStep, index, totalSteps, isComplete, lastAnswer, whatChanged, activePacket } = snapshot;
  const canAdvance = engine.canAdvance();

  const kindFor = (id: string): DeviceKind => (id.startsWith("CE") ? "laptop" : id.startsWith("MTU") ? "switch" : "pe-router");
  const nodes = useMemo(() => GRAPH_NODES.map((n) => ({ ...n, kind: kindFor(n.id) })), []);
  const journeyPath = state.journey.map((h) => h.device);
  const displayPath: RouterId[] = journeyPath.length > 0 ? journeyPath : DEVICE_ROUTERS;
  const bestPathEdgeIds = displayPath.length > 1 ? LINKS.filter((l) => displayPath.includes(l.a) && displayPath.includes(l.b)).map((l) => l.id) : [];
  const focusIsMtu = MTU_NODES.includes(focusRouter as MtuId);
  const focusIsPe = PE_ROUTERS.includes(focusRouter as PeId);
  const focusFdb = focusIsMtu || focusIsPe ? fdbFor(state, focusRouter as MtuId | PeId) : [];

  // --- visibility gates, keyed off STEP_IDX ---
  const showTerms = index >= STEP_IDX.topologyIntro;
  const showTransportRecap = index >= STEP_IDX.transportRecap && index < STEP_IDX.coreMeshIntro;
  const showMeshAndSpokes = index >= STEP_IDX.coreMeshIntro;
  const showBridgePorts = index >= STEP_IDX.readyButEmpty && (focusIsMtu || focusIsPe);
  const showFloodNote = !!state.floodCopies && state.floodCopies.length > 0;
  const showTroubleshoot = index >= STEP_IDX.troubleshootingIntro;
  const showViews = index >= STEP_IDX.transportRecap;
  const showScalingLab = index >= STEP_IDX.scalingLabIntro && index < STEP_IDX.troubleshootingIntro;

  const cliCommands = useMemo(() => buildHvplsCliCommands(state, focusRouter), [state, focusRouter]);
  const lastHop = state.journey[state.journey.length - 1];

  const serviceFields = [
    { label: "Type", value: "Ethernet H-VPLS" },
    { label: "Service", value: SERVICE_NAME },
    { label: "VLAN", value: String(VLAN) },
    { label: "Bridge Ports", value: focusIsMtu || focusIsPe ? bridgePortsFor(state, focusRouter as MtuId | PeId).map(portLabel).join(", ") || "(none)" : "—" },
  ];

  const pwLegStatus = (up: boolean) => (up ? "healthy" : state.troubleshooting.started ? "failing" : "unknown");
  const diagnosticLayers: DiagnosticLayer[] = [
    { label: "CE1-4 Attachment Circuits", status: state.acs.every((a) => a.up) ? "healthy" : "failing" },
    { label: "Transport (IGP + LDP + LSP)", status: transportReachable(state.transport) ? "healthy" : "unknown" },
    { label: "Spoke PW MTU1-PE1", status: pwLegStatus(spokeUp(state.spokeLinks, "MTU1")) },
    { label: "Spoke PW MTU2-PE2", status: pwLegStatus(spokeUp(state.spokeLinks, "MTU2")) },
    { label: "Spoke PW MTU3-PE3", status: pwLegStatus(spokeUp(state.spokeLinks, "MTU3")) },
    { label: "Mesh PW PE1-PE2", status: pwLegStatus(pwUpBetween(state.meshLinks, "PE1", "PE2")) },
    { label: "Mesh PW PE1-PE3", status: pwLegStatus(pwUpBetween(state.meshLinks, "PE1", "PE3")) },
    { label: "Mesh PW PE2-PE3", status: pwLegStatus(pwUpBetween(state.meshLinks, "PE2", "PE3")) },
    { label: "PE1's Port Role Toward MTU1", status: state.spokeRoleByPe.PE1 === "SPOKE_PW" ? "healthy" : "failing" },
    { label: "CE1 ↔ CE2 (Local, via MTU1)", status: "healthy" },
    { label: "CE1 ↔ CE3 (Hierarchical, PE1→PE2)", status: spokeUp(state.spokeLinks, "MTU1") && state.spokeRoleByPe.PE1 === "SPOKE_PW" ? "healthy" : "failing" },
    { label: "CE1 ↔ CE4 (Hierarchical, PE1→PE3)", status: spokeUp(state.spokeLinks, "MTU1") && state.spokeRoleByPe.PE1 === "SPOKE_PW" ? "healthy" : "failing" },
  ];

  // --- 3D derived state ---
  const nodes3DBase = useMemo(() => layoutTo3D(nodes), [nodes]);
  const visitedRouters = new Set(state.journey.map((h) => h.device));
  const nodes3D = nodes3DBase.map((n) => {
    let status: Node3DStatus = "idle";
    if (n.id === selectedNodeId || n.id === enteredDeviceId) status = "selected";
    else if (activePacket && (n.id === activePacket.from || n.id === activePacket.to)) status = "active";
    else if (visitedRouters.has(n.id as RouterId)) status = "onPath";
    const badges: string[] = [];
    if (PE_ROUTERS.includes(n.id as PeId)) badges.push("PE-rs · CORE");
    if (MTU_NODES.includes(n.id as MtuId)) badges.push("MTU-s · ACCESS");
    return { ...n, status, badges: badges.length ? badges : undefined };
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
  const floodCopies3D: FloodCopy3D[] | undefined = state.floodCopies?.map((fc) => ({ id: fc.id, fromId: fc.fromId, toId: fc.toId }));
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

  const followNode3D = cameraMode === "packetFollow" && activePacket ? nodes3D.find((n) => n.id === (state.packetAt ?? activePacket.to)) : undefined;
  const focusPosition3D: [number, number, number] | undefined =
    cameraMode === "freeOrbit" ? undefined : inDeviceMode ? [0, 0, deviceXray ? -0.2 : 0] : cameraMode === "packetFollow" ? followNode3D?.position : selectedNode3D?.position;
  const eyeOffset3D: [number, number, number] | undefined = inDeviceMode ? (deviceXray ? [0.6, 2.6, 5.2] : [2.1, 1.5, 3.8]) : undefined;

  const explainTargetId = (effectiveDeviceId ?? selectedNodeId ?? followNode3D?.id) as RouterId | undefined;
  const nodeExplanation = explainTargetId ? explainNode(state, explainTargetId) : undefined;
  const xrayPacket = activePacket && (selectedNodeId === activePacket.from || selectedNodeId === activePacket.to) ? activePacket : undefined;
  const selectedLinkDetail = selectedLinkId ? linkDetailFor(selectedLinkId, state) : undefined;
  const packetCurrentDeviceLabel = effectiveDeviceId ?? state.packetAt ?? activePacket?.from ?? "—";
  const packetDirection = displayPath.join(" → ");
  const devicePacketForTab = xrayPacket ?? (effectiveDeviceId && state.packetAt === effectiveDeviceId ? activePacket : undefined);

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
    const transportTab: DeviceExplorerTab = {
      id: "transport",
      label: "Transport",
      content: (
        <div className="space-y-1 pv-mono text-[11px]">
          <Row label="IGP" value={state.transport.igpUp ? "UP" : "DOWN"} />
          <Row label="LDP" value={state.transport.ldpUp ? "UP" : "DOWN"} />
          <Row label="Transport LSP" value={transportReachable(state.transport) ? "UP" : "DOWN"} />
          <p className="mt-1 text-[10px] text-pv-text-faint">P routers are omitted from this lesson&apos;s model — see the scenario file&apos;s own scope note. Service topology (spoke vs. mesh role) is independent of transport.</p>
        </div>
      ),
    };
    const serviceTab: DeviceExplorerTab = {
      id: "hvpls-service",
      label: "H-VPLS Service",
      content: (
        <ServiceInstanceViewer
          title={SERVICE_NAME}
          subtitle={`VLAN ${VLAN}`}
          fields={[
            { label: "Tier", value: MTU_NODES.includes(router as MtuId) ? "MTU-s (Access)" : "PE-rs (Core)" },
            { label: "Bridge Ports", value: bridgePortsFor(state, router as MtuId | PeId).map(portLabel).join(", ") || "(none)" },
          ]}
          status="up"
        />
      ),
    };
    const bridgePortsTab: DeviceExplorerTab = {
      id: "bridge-ports",
      label: "Bridge Ports",
      content: <BridgePortsViewer title={router} rows={bridgePortsFor(state, router as MtuId | PeId).map((p) => ({ role: p.kind, peer: p.peer }))} />,
    };
    const fdbTab: DeviceExplorerTab = {
      id: "fdb",
      label: "MAC Table",
      content: <EthernetFdbViewer title={router} rows={fdbFor(state, router as MtuId | PeId).map((e) => ({ mac: e.mac, portKind: e.port.kind, portPeer: e.port.peer, age: e.age }))} />,
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
    const cliTab: DeviceExplorerTab = { id: "cli", label: "CLI", content: <CLIOutputPanel commands={buildHvplsCliCommands(state, router)} /> };

    if (MTU_NODES.includes(router as MtuId)) {
      const mtu = router as MtuId;
      const pair = spokePairFor(mtu);
      const spokeTab: DeviceExplorerTab = {
        id: "spoke-pw",
        label: "Spoke PW",
        content: (
          <PseudowireViewer
            title="Spoke PW"
            service={SERVICE_NAME}
            pwType="Ethernet (Spoke)"
            pwId={4000 + Number(mtu.slice(-1))}
            localPe={mtu}
            remotePe={pair.pe}
            localAc={resolveAttachmentCircuits(state.acs, mtu).map((a) => a.interfaceName).join(", ") || "—"}
            remotePeer={ROUTER_LOOPBACK[pair.pe] ?? pair.pe}
            localReceiveLabel={allocateSpokeReceiveLabel(mtu, pair.pe)}
            remoteReceiveLabel={allocateSpokeReceiveLabel(pair.pe, mtu)}
            transportState={transportReachable(state.transport) ? "UP" : "DOWN"}
            targetedLdpState="OPERATIONAL"
            pwState={spokeUp(state.spokeLinks, mtu) ? "UP" : "DOWN"}
            mtu={1500}
            controlWord={false}
            status="Role: SPOKE_PW (access-side port at the PE-rs hub)"
          />
        ),
      };
      return [overviewTab, hardwareTab, interfacesTab, serviceTab, bridgePortsTab, fdbTab, spokeTab, packetTab, cliTab];
    }

    const pe = router as PeId;
    const pair = peSpokePair(pe);
    const meshTab: DeviceExplorerTab = {
      id: "mesh-pws",
      label: "Mesh PWs",
      content: (
        <div className="space-y-3">
          {pwPeersOf(pe).map((peerId) => {
            const peer = peerId as PeId;
            return <PseudowireViewer
              key={peer}
              title={`${pe}-${peer}`}
              service={SERVICE_NAME}
              pwType="Ethernet (Mesh)"
              pwId={1000 + Number(peer.slice(-1))}
              localPe={pe}
              remotePe={peer}
              localAc="(core hub — no local AC)"
              remotePeer={ROUTER_LOOPBACK[peer] ?? peer}
              localReceiveLabel={allocatePwReceiveLabel(pe, peer)}
              remoteReceiveLabel={allocatePwReceiveLabel(peer, pe)}
              transportState={transportReachable(state.transport) ? "UP" : "DOWN"}
              targetedLdpState="OPERATIONAL"
              pwState={pwUpBetween(state.meshLinks, pe, peer) ? "UP" : "DOWN"}
              mtu={1500}
              controlWord={false}
              status="Role: MESH_PW (core-only — never relays to another MESH_PW)"
            />;
          })}
        </div>
      ),
    };
    const spokeTab: DeviceExplorerTab = {
      id: "spoke-pw",
      label: "Spoke PW",
      content: (
        <PseudowireViewer
          title="Spoke PW"
          service={SERVICE_NAME}
          pwType="Ethernet (Spoke)"
          pwId={4000 + Number(pe.slice(-1))}
          localPe={pe}
          remotePe={pair.mtu}
          localAc="(core hub — no local AC)"
          remotePeer={ROUTER_LOOPBACK[pair.mtu] ?? pair.mtu}
          localReceiveLabel={allocateSpokeReceiveLabel(pe, pair.mtu)}
          remoteReceiveLabel={allocateSpokeReceiveLabel(pair.mtu, pe)}
          transportState={transportReachable(state.transport) ? "UP" : "DOWN"}
          targetedLdpState="OPERATIONAL"
          pwState={spokeUp(state.spokeLinks, pair.mtu) ? "UP" : "DOWN"}
          mtu={1500}
          controlWord={false}
          status={`Classified: ${state.spokeRoleByPe[pe]}${state.spokeRoleByPe[pe] !== "SPOKE_PW" ? " — MISCLASSIFIED" : ""}`}
        />
      ),
    };
    return [overviewTab, hardwareTab, interfacesTab, transportTab, serviceTab, bridgePortsTab, spokeTab, meshTab, fdbTab, packetTab, cliTab];
  }

  useEffect(() => {
    if (isComplete && !awardedRef.current) {
      awardedRef.current = true;
      completeLesson("h-vpls", HVPLS_XP_AWARD);
      unlockAchievement("h-vpls-architect");
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
  };

  const nextLabel = currentStep?.question && !lastAnswer ? "Answer to continue" : currentStep?.requiresState && !canAdvance ? "Apply the correct fix to continue" : "Next Step →";

  const activeNodes =
    topoView === "hierarchy"
      ? HIERARCHY_GRAPH_NODES.map((n) => ({ ...n, kind: kindFor(n.id) }))
      : topoView === "service" || topoView === "mac-learning"
        ? SERVICE_GRAPH_NODES.map((n) => ({
            ...n,
            kind: kindFor(n.id),
            subLabel: topoView === "mac-learning" && (MTU_NODES.includes(n.id as MtuId) || PE_ROUTERS.includes(n.id as PeId)) ? `FDB: ${fdbFor(state, n.id as MtuId | PeId).length}` : n.subLabel,
          }))
        : nodes;
  const activeEdges = topoView === "hierarchy" ? HIERARCHY_GRAPH_EDGES : topoView === "service" || topoView === "mac-learning" ? SERVICE_GRAPH_EDGES : GRAPH_EDGES.map((e) => ({ ...e }));

  return (
    <div className="mx-auto max-w-7xl px-6 py-10">
      <div className="mb-6">
        <Badge tone="cyan" className="mb-3">
          HIERARCHICAL VPLS · MTU-s ACCESS BRIDGES · SPOKE PW · PE-rs CORE MESH · ROLE-AWARE SPLIT HORIZON
        </Badge>
        <h1 className="text-2xl font-semibold text-pv-text sm:text-3xl">Scale The Virtual LAN</h1>
        <p className="mt-2 max-w-3xl text-sm text-pv-text-muted">
          Must every access site that joins a VPLS service become another full-mesh core PE? RFC 4762&apos;s Hierarchical
          VPLS says no — access MTU-s bridges reach the service through one spoke pseudowire to a PE-rs hub, and only
          the (much smaller) PE-rs tier maintains a core full mesh, with a generalized split-horizon rule that only
          forbids mesh-to-mesh relay.
        </p>
      </div>

      <div className="mb-4 grid gap-2 sm:grid-cols-4">
        {WHY_HVPLS.map((item) => (
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
        {hVplsSteps.map((step, i) => (
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

      <div className="mb-6 flex flex-wrap gap-3">
        <TopologyModeSwitcher
          options={[
            { value: "physical", label: "Physical" },
            { value: "hierarchy", label: "Hierarchy" },
            { value: "service", label: "Service" },
            { value: "mac-learning", label: "MAC Learning" },
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
              onChange={(v) => {
                setCameraMode(v);
                if (v === "device" && !enteredDeviceId) setEnteredDeviceId(selectedNodeId ?? activeDeviceId ?? "MTU1");
                if (v === "overview") {
                  setEnteredDeviceId(undefined);
                  setSelectedNodeId(undefined);
                }
                if (v === "freeOrbit") setEnteredDeviceId(undefined);
              }}
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
              <TopologyQuickExpand questionActive={questionActive} nodes={nodes3D} links={links3D} activePacket={activePacket3D}>
              <NetworkScene3D
                nodes={nodes3D}
                links={links3D}
                activePacket={inDeviceMode ? undefined : activePacket3D}
                floodCopies={inDeviceMode ? undefined : floodCopies3D}
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
                      }
                    : undefined
                }
              />
              </TopologyQuickExpand>

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
              <GraphTopologyViewer nodes={activeNodes} edges={activeEdges.map((e) => ({ ...e, state: "full" as const }))} activeNodeIds={activePacket ? [activePacket.from, activePacket.to] : []} bestPathEdgeIds={topoView === "physical" ? bestPathEdgeIds : activeEdges.map((e) => e.id)} onEdgeClick={(id) => setSelectedLinkId(id)}>
                {activePacket && activeNodes.find((n) => n.id === activePacket.from) && activeNodes.find((n) => n.id === activePacket.to) && (
                  <GraphPacket packet={activePacket} from={activeNodes.find((n) => n.id === activePacket.from)!} to={activeNodes.find((n) => n.id === activePacket.to)!} />
                )}
              </GraphTopologyViewer>

              {showFloodNote && (
                <GlassPanel className="p-4">
                  <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-pv-violet">Flooding — 2D Overview Doesn&apos;t Animate Simultaneous Copies</h4>
                  <p className="text-xs text-pv-text-muted">
                    Switch to 3D View to watch every flood replica travel independently at the same time: {state.floodCopies?.map((fc) => `${fc.fromId} → ${fc.toId}`).join(", ")}.
                  </p>
                </GlassPanel>
              )}

              {selectedLinkId && !lastHop && linkDetailFor(selectedLinkId, state) && <LinkDetailPanel detail={linkDetailFor(selectedLinkId, state)!} onClose={() => setSelectedLinkId(undefined)} />}

              {lastHop && <ForwardingDecisionCard router={lastHop.device} input={lastHop.input} lookup={lastHop.lookup} action={lastHop.action} output={lastHop.output} />}
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

          {showTransportRecap && !isComplete && (
            <GlassPanel className="p-4">
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-pv-text-muted">Transport Recap</h4>
              <p className="pv-mono text-xs text-pv-cyan-soft">{transportReachable(state.transport) ? "UP" : "DOWN"}</p>
              <p className="mt-1 text-[11px] text-pv-text-muted">Independent of every spoke/mesh PW role decision that follows.</p>
            </GlassPanel>
          )}

          {showMeshAndSpokes && !isComplete && (
            <div className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-pv-violet">Core Mesh + Access Spokes</h3>
              {(["PE1-PE2", "PE1-PE3", "PE2-PE3"] as const).map((pairId) => {
                const [a, b] = pairId.split("-") as [PeId, PeId];
                return (
                  <PseudowireViewer
                    key={pairId}
                    title={`${pairId} (mesh)`}
                    service={SERVICE_NAME}
                    pwType="Ethernet (Mesh)"
                    pwId={1000 + Number(b.slice(-1))}
                    localPe={a}
                    remotePe={b}
                    localAc="(core hub)"
                    remotePeer={ROUTER_LOOPBACK[b] ?? b}
                    localReceiveLabel={allocatePwReceiveLabel(a, b)}
                    remoteReceiveLabel={allocatePwReceiveLabel(b, a)}
                    transportState={transportReachable(state.transport) ? "UP" : "DOWN"}
                    targetedLdpState="OPERATIONAL"
                    pwState={pwUpBetween(state.meshLinks, a, b) ? "UP" : "DOWN"}
                    mtu={1500}
                    controlWord={false}
                  />
                );
              })}
              {(["MTU1", "MTU2", "MTU3"] as const).map((mtu) => {
                const pair = spokePairFor(mtu);
                return (
                  <PseudowireViewer
                    key={pair.id}
                    title={`${pair.id} (spoke)`}
                    service={SERVICE_NAME}
                    pwType="Ethernet (Spoke)"
                    pwId={4000 + Number(mtu.slice(-1))}
                    localPe={mtu}
                    remotePe={pair.pe}
                    localAc={resolveAttachmentCircuits(state.acs, mtu).map((a) => a.interfaceName).join(", ") || "—"}
                    remotePeer={ROUTER_LOOPBACK[pair.pe] ?? pair.pe}
                    localReceiveLabel={allocateSpokeReceiveLabel(mtu, pair.pe)}
                    remoteReceiveLabel={allocateSpokeReceiveLabel(pair.pe, mtu)}
                    transportState={transportReachable(state.transport) ? "UP" : "DOWN"}
                    targetedLdpState="OPERATIONAL"
                    pwState={spokeUp(state.spokeLinks, mtu) ? "UP" : "DOWN"}
                    mtu={1500}
                    controlWord={false}
                  />
                );
              })}
            </div>
          )}

          {index >= STEP_IDX.bridgePortsMtu1 && !isComplete && <ServiceInstanceViewer title={SERVICE_NAME} subtitle={`VLAN ${VLAN}`} fields={serviceFields} status="up" />}

          {showBridgePorts && !isComplete && <BridgePortsViewer title={focusRouter} rows={bridgePortsFor(state, focusRouter as MtuId | PeId).map((p) => ({ role: p.kind, peer: p.peer }))} />}

          {showBridgePorts && !isComplete && <EthernetFdbViewer title={focusRouter} rows={focusFdb.map((e) => ({ mac: e.mac, portKind: e.port.kind, portPeer: e.port.peer, age: e.age }))} />}

          {index >= STEP_IDX.readyButEmpty && (focusIsMtu || focusIsPe) && !isComplete && (
            <GlassPanel className="p-3">
              <p className="pv-mono text-[11px] text-pv-text-faint">Bridge ports at {focusRouter}: {bridgePortsSummary(state, focusRouter)}</p>
            </GlassPanel>
          )}

          {showScalingLab && !isComplete && <ScalingLab />}

          {showTroubleshoot && !isComplete && <TroubleshootingLayers title="Diagnostic Ladder" layers={diagnosticLayers} />}

          {showViews && !isComplete && (
            <PlaneSplitPanel
              show={planeView}
              controlTitle="Control Plane — Spoke + Core Mesh PW Signaling"
              controlRows={[
                { label: "Core Mesh (PE1-PE2 / PE1-PE3 / PE2-PE3)", value: `${pwUpBetween(state.meshLinks, "PE1", "PE2") ? "UP" : "DOWN"} / ${pwUpBetween(state.meshLinks, "PE1", "PE3") ? "UP" : "DOWN"} / ${pwUpBetween(state.meshLinks, "PE2", "PE3") ? "UP" : "DOWN"}` },
                { label: "Spokes (MTU1-PE1 / MTU2-PE2 / MTU3-PE3)", value: `${spokeUp(state.spokeLinks, "MTU1") ? "UP" : "DOWN"} / ${spokeUp(state.spokeLinks, "MTU2") ? "UP" : "DOWN"} / ${spokeUp(state.spokeLinks, "MTU3") ? "UP" : "DOWN"}` },
                { label: "PE1's Port Role Toward MTU1", value: state.spokeRoleByPe.PE1 },
              ]}
              dataTitle="Data Plane — Current Ethernet/MPLS Packet"
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
              <Badge tone="success">H-VPLS Architect</Badge>
              <h2 className="text-2xl font-semibold text-pv-text">You Scaled The Virtual LAN</h2>
              <p className="max-w-md text-sm text-pv-text-muted">
                You built a hierarchical VPLS service — a PE-rs core full mesh, one spoke pseudowire per access MTU-s,
                role-aware bridge ports, and the generalized split-horizon rule that only forbids mesh-to-mesh relay.
                You proved local switching stays local, traced a frame through spoke → mesh → spoke, and diagnosed a
                misclassified spoke without ever disabling split horizon globally. +{HVPLS_XP_AWARD} XP awarded.
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
          <CLIOutputPanel commands={cliCommands} />
        </div>
      </div>
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
      <p className="mb-3 text-sm font-medium text-pv-text">Choose the correct repair to restore remote reachability:</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((opt) => {
          const isSelected = attempt?.choice === opt.id;
          const isCorrect = opt.id === "reclassify-pe1-spoke";
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
            <span className="font-semibold">✓ PE1&apos;s port toward MTU1 reclassified as SPOKE_PW — the actual defect is fixed.</span>
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

const ACCESS_NODE_OPTIONS = [3, 6, 12, 24] as const;
const CORE_PE_OPTIONS = [2, 3, 4] as const;

/** Read-only scaling lab (brief §40-41) — pure calculation, never mutates engine/narrative state. */
function ScalingLab() {
  const [accessNodes, setAccessNodes] = useState<(typeof ACCESS_NODE_OPTIONS)[number]>(3);
  const [corePes, setCorePes] = useState<(typeof CORE_PE_OPTIONS)[number]>(3);
  const flatCount = calculateFullMeshPwCount(accessNodes + corePes);
  const coreMeshCount = calculateFullMeshPwCount(corePes);
  const hierarchicalCount = calculateHierarchicalPwCount(corePes, accessNodes);

  return (
    <GlassPanel strong className="space-y-4 p-5">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-pv-violet">Scaling Lab — Flat vs. Hierarchical PW Count</h3>
      <div className="flex flex-wrap gap-6">
        <div>
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-pv-text-faint">Access Nodes</p>
          <div className="flex gap-1 rounded-full border border-pv-border p-0.5">
            {ACCESS_NODE_OPTIONS.map((n) => (
              <button key={n} type="button" onClick={() => setAccessNodes(n)} className={clsx("rounded-full px-3 py-1 text-xs font-semibold pv-mono transition-colors", accessNodes === n ? "bg-pv-cyan/15 text-pv-cyan-soft" : "text-pv-text-faint hover:text-pv-text")}>
                {n}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-pv-text-faint">Core PE-rs</p>
          <div className="flex gap-1 rounded-full border border-pv-border p-0.5">
            {CORE_PE_OPTIONS.map((n) => (
              <button key={n} type="button" onClick={() => setCorePes(n)} className={clsx("rounded-full px-3 py-1 text-xs font-semibold pv-mono transition-colors", corePes === n ? "bg-pv-violet/15 text-pv-violet" : "text-pv-text-faint hover:text-pv-text")}>
                {n}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-pv-border p-4">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-pv-text-faint">Flat Full Mesh</p>
          <p className="pv-mono text-xs text-pv-text-muted">calculateFullMeshPwCount({accessNodes + corePes})</p>
          <p className="pv-mono text-2xl font-bold text-pv-text">{flatCount} PWs</p>
          <p className="text-[10px] text-pv-text-faint">All {accessNodes + corePes} devices treated as flat VPLS mesh members</p>
        </div>
        <div className="rounded-xl border border-pv-cyan/40 bg-pv-cyan/5 p-4">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-pv-cyan-soft">Hierarchical (H-VPLS)</p>
          <p className="pv-mono text-xs text-pv-text-muted">calculateHierarchicalPwCount({corePes}, {accessNodes}) = {coreMeshCount} core + {accessNodes} spoke</p>
          <p className="pv-mono text-2xl font-bold text-pv-cyan-soft">{hierarchicalCount} PWs</p>
          <p className="text-[10px] text-pv-text-faint">{corePes} core PE-rs full mesh + {accessNodes} access spokes, one per MTU-s</p>
        </div>
      </div>
      <p className="text-[11px] text-pv-text-faint">
        PW count is one real scaling factor — MAC learning, BUM replication, and hub resource/operational design also matter, and hierarchy restructures the core&apos;s responsibility rather than eliminating it.
      </p>
    </GlassPanel>
  );
}
