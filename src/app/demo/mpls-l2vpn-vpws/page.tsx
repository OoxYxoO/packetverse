"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { clsx } from "clsx";
import { useScenarioEngine } from "@/lib/sim-engine/useScenarioEngine";
import {
  AC_VLAN,
  GRAPH_EDGES,
  GRAPH_NODES,
  LINKS,
  PW_ID,
  ROUTER_LOOPBACK,
  SERVICE_GRAPH_EDGES,
  SERVICE_GRAPH_NODES,
  SERVICE_NAME,
  STEP_IDX,
  TERMS,
  TARGETED_LDP_INFO,
  allocatePwReceiveLabel,
  buildVpwsCliCommands,
  createMplsL2vpnVpwsState,
  fmtLabel,
  mplsL2vpnVpwsSteps,
  pwCompatibilityFor,
  pwFecKey,
  pwStateFor,
  resolveAttachmentCircuit,
  transportLabelFor,
  transportReachable,
  validatePwCompatibility,
  type MplsL2vpnVpwsState,
  type RouterId,
} from "@/lib/sim-engine/scenarios/mplsL2vpnVpws";
import { GraphTopologyViewer } from "@/components/network/GraphTopologyViewer";
import { GraphPacket } from "@/components/network/GraphPacket";
import { PacketInspector } from "@/components/network/PacketInspector";
import { ForwardingDecisionCard } from "@/components/protocol/ForwardingDecisionCard";
import { PacketJourneyTimeline } from "@/components/protocol/PacketJourneyTimeline";
import { PlaneSplitPanel } from "@/components/protocol/PlaneSplitPanel";
import { ServiceInstanceViewer } from "@/components/protocol/ServiceInstanceViewer";
import { PseudowireViewer } from "@/components/protocol/PseudowireViewer";
import { LibViewer, LfibViewer } from "@/components/protocol/LibLfibViewer";
import { LabelFlowView } from "@/components/protocol/LabelFlowView";
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
import { TopologyModeSwitcher } from "@/components/network3d/TopologyModeSwitcher";
import { PlaneViewSwitcher } from "@/components/network3d/PlaneViewSwitcher";
import { DeviceExplorerPanel, InterfaceListTab, type DeviceExplorerTab } from "@/components/network3d/DeviceExplorerPanel";
import { PacketDetailPanel } from "@/components/network3d/PacketDetailPanel";
import { LinkDetailPanel } from "@/components/network3d/LinkDetailPanel";
import { layoutTo3D } from "@/components/network3d/layout";
import type { ActivePacket3D, CameraMode, Link3DData, Node3DStatus, PacketStackFrame } from "@/components/network3d/types";
import { explainNode } from "./explain";
import { interfacesFor, linkDetailFor, packetFramesFor, traceFor } from "./deviceTrace";

const DEVICE_ROUTERS: RouterId[] = ["CE1", "PE1", "P1", "P2", "PE2", "CE2"];
type TopoView = "physical" | "transport" | "service";

const WHY_VPWS: { q: string; a: string }[] = [
  { q: "WHAT IS A PSEUDOWIRE?", a: "An emulated point-to-point circuit between two PEs, signaled by targeted LDP and forwarded with a directional service label." },
  { q: "IS THIS EVPN-VPWS?", a: "No — this is the traditional, LDP-signaled model (PW FEC / targeted LDP). EVPN-VPWS signals the same kind of service using BGP instead." },
  { q: "DOES TRANSPORT UP MEAN PW UP?", a: "No — transport just gets a labeled packet to the PE. The PE still needs to know which local service should receive it." },
  { q: "IS THE PW LABEL SHARED?", a: "No — each PE allocates its own directional receive label. Forward and reverse traffic normally use different labels." },
];

const REPAIR_OPTIONS = [
  { id: "restart-ldp", label: "Restart the targeted LDP session" },
  { id: "change-igp-metric", label: "Change the transport IGP metric" },
  { id: "change-ce1-ip", label: "Change CE1's IP address" },
  { id: "fix-pw-id", label: "Change PE2's PW ID to match PE1 (5000)" },
];
const WRONG_FEEDBACK: Record<string, string> = {
  "restart-ldp": "Session establishment is already healthy — targeted LDP is OPERATIONAL. The two PEs still describe different services; restarting the session won't change what either PE is configured with.",
  "change-igp-metric": "Transport reachability is healthy — PE1 can already reach PE2's loopback. This incident is entirely inside pseudowire signaling, not transport.",
  "change-ce1-ip": "The pseudowire must establish before customer Ethernet forwarding can succeed at all. CE1's IP addressing is irrelevant — VPWS doesn't route or inspect it.",
};

export default function MplsL2vpnVpwsDemo() {
  const { engine, snapshot } = useScenarioEngine<MplsL2vpnVpwsState>(createMplsL2vpnVpwsState(), mplsL2vpnVpwsSteps);
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
  const [packetSelected, setPacketSelected] = useState(false);
  const [xrayMode, setXrayMode] = useState(true);
  const [labPe2Mtu, setLabPe2Mtu] = useState(1500);
  const [labMtuHardGate, setLabMtuHardGate] = useState(false);
  const awardedRef = useRef(false);
  const completeLesson = useProgressStore((s) => s.completeLesson);
  const recordAnswer = useProgressStore((s) => s.recordAnswer);
  const unlockAchievement = useProgressStore((s) => s.unlockAchievement);

  const { state, currentStep, index, totalSteps, isComplete, lastAnswer, whatChanged, activePacket } = snapshot;
  const canAdvance = engine.canAdvance();

  const nodes = useMemo(() => GRAPH_NODES.map((n) => ({ ...n, kind: (n.id === "CE1" || n.id === "CE2" ? "laptop" : n.id === "PE1" || n.id === "PE2" ? "pe-router" : "p-router") as "laptop" | "pe-router" | "p-router" })), []);
  const journeyPath = state.journey.map((h) => h.device);
  const displayPath: RouterId[] = journeyPath.length > 0 ? journeyPath : ["CE1", "PE1", "P1", "P2", "PE2", "CE2"];
  const bestPathEdgeIds = displayPath.length > 1 ? LINKS.filter((l) => displayPath.includes(l.a) && displayPath.includes(l.b)).map((l) => l.id) : [];
  const ac1 = resolveAttachmentCircuit(state.acs, "PE1");
  const ac2 = resolveAttachmentCircuit(state.acs, "PE2");
  const pwState = pwStateFor(state);
  const compat = pwCompatibilityFor(state);

  // --- visibility gates, keyed off STEP_IDX ---
  const showTerms = index >= STEP_IDX.topologyIntro;
  const showServiceInstance = index >= STEP_IDX.serviceInstanceIntro;
  const showTargetedLdpLifecycle = index >= STEP_IDX.targetedLdpIntro && index < STEP_IDX.pwFecIntro;
  const showPwFec = index >= STEP_IDX.pwFecIntro && index < STEP_IDX.packetBeforeEncap;
  const showPseudowireViewer = index >= STEP_IDX.pwUp;
  const showLabelFlow = index >= STEP_IDX.twoLabelStackSignature && index <= STEP_IDX.pe2Deliver;
  const showLib = index >= STEP_IDX.directionalAllocIntro && index < STEP_IDX.packetBeforeEncap;
  const showLfib = index >= STEP_IDX.packetBeforeEncap;
  const showMtuLab = index >= STEP_IDX.mtuLabNote && index < STEP_IDX.troubleshootingIntro;
  const showTroubleshoot = index >= STEP_IDX.troubleshootingIntro;
  const showViews = index >= STEP_IDX.transportRecapIntro;

  const cliCommands = useMemo(() => buildVpwsCliCommands(state, focusRouter), [state, focusRouter]);
  const lastHop = state.journey[state.journey.length - 1];

  const serviceFields = [
    { label: "Type", value: "Ethernet VPWS" },
    { label: "PE1 AC", value: ac1?.interfaceName ?? "—" },
    { label: "PE2 AC", value: ac2?.interfaceName ?? "—" },
    { label: "PW ID (PE1 / PE2)", value: `${state.pe1Config.fec.pwId} / ${state.pe2Config.fec.pwId}` },
    { label: "VLAN", value: String(AC_VLAN) },
  ];

  const libEntries = [
    { fec: pwFecKey(state.pe1Config.fec), localLabel: String(allocatePwReceiveLabel("PE1")), remoteBindings: state.remoteLabelKnownAtPe1 !== undefined ? [{ neighbor: "PE2", label: String(state.remoteLabelKnownAtPe1) }] : [] },
  ];
  const lfibEntries = state.journey
    .filter((h) => h.device === focusRouter)
    .map((h) => ({ fec: pwFecKey(state.pe1Config.fec), incomingLabel: h.input, action: h.action, outgoingLabel: h.output, outgoingInterface: undefined }));

  const labelFlowNodes = state.journey.map((h) => ({ router: h.device, action: h.action, outputLabel: h.output.match(/label (\d+)/)?.[1] ?? (h.action === "AC_EGRESS" ? "Ethernet" : h.output) }));

  const diagnosticLayers: DiagnosticLayer[] = [
    { label: "CE1 AC", status: ac1?.up ? "healthy" : "failing" },
    { label: "CE2 AC", status: ac2?.up ? "healthy" : "failing" },
    { label: "IGP", status: state.transport.igpUp ? "healthy" : "unknown" },
    { label: "MPLS Transport", status: state.transport.ldpUp ? "healthy" : "unknown" },
    { label: "PE Loopback Reachability", status: state.transport.lspUp ? "healthy" : "unknown" },
    { label: "Targeted LDP", status: state.targetedLdp === "OPERATIONAL" ? "healthy" : "unknown" },
    { label: "PW Type", status: compat.typeMatch ? "healthy" : "failing" },
    { label: "Interface Parameters", status: state.troubleshooting.started && !compat.compatible && compat.fecMatch ? "failing" : "healthy" },
    { label: `PE1 PW ID (${state.pe1Config.fec.pwId})`, status: "healthy" },
    { label: `PE2 PW ID (${state.pe2Config.fec.pwId})`, status: state.pe2Config.fec.pwId === state.pe1Config.fec.pwId ? "healthy" : "failing" },
    { label: "PW FEC Match", status: compat.fecMatch ? "healthy" : state.troubleshooting.started ? "failing" : "unknown" },
    { label: "Remote PW Label Association", status: state.remoteLabelKnownAtPe1 !== undefined && state.remoteLabelKnownAtPe2 !== undefined ? "healthy" : state.troubleshooting.started ? "failing" : "unknown" },
    { label: "Pseudowire State", status: pwState === "UP" ? "healthy" : state.troubleshooting.started ? "failing" : "unknown" },
    { label: "Data Forwarding", status: pwState === "UP" ? "healthy" : state.troubleshooting.started ? "failing" : "unknown" },
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
    if (n.id === "PE1" || n.id === "PE2") badges.push("PW ENDPOINT");
    if ((n.id === "P1" || n.id === "P2") && topoView === "service") badges.push("HIDDEN IN SERVICE VIEW");
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
    const mplsTransportTab: DeviceExplorerTab = {
      id: "mpls-transport",
      label: "MPLS Transport",
      content: (
        <div className="space-y-1 pv-mono text-[11px]">
          <Row label="Transport LSP" value={transportReachable(state.transport) ? "UP" : "DOWN"} />
          <Row label="Local Transport Label" value={fmtLabel(transportLabelFor(router))} />
        </div>
      ),
    };
    const ldpTab: DeviceExplorerTab = { id: "ldp", label: "LDP", content: <Row label="Hop-by-hop LDP" value={state.transport.ldpUp ? "UP (recap)" : "DOWN"} /> };
    const targetedLdpTab: DeviceExplorerTab = {
      id: "targeted-ldp",
      label: "Targeted LDP",
      content: (
        <div className="space-y-1 pv-mono text-[11px]">
          <Row label="Peer" value={router === "PE1" ? (ROUTER_LOOPBACK.PE2 ?? "—") : (ROUTER_LOOPBACK.PE1 ?? "—")} />
          <Row label="State" value={state.targetedLdp} />
          <p className="mt-1 text-[10px] text-pv-text-faint">{TARGETED_LDP_INFO[state.targetedLdp].meaning}</p>
        </div>
      ),
    };
    const vpwsServicesTab: DeviceExplorerTab = {
      id: "vpws-services",
      label: "VPWS Services",
      content: <ServiceInstanceViewer title={SERVICE_NAME} subtitle={`PW ID ${router === "PE1" ? state.pe1Config.fec.pwId : state.pe2Config.fec.pwId}`} fields={serviceFields} status={pwState === "UP" ? "up" : "down"} />,
    };
    const pseudowireTab: DeviceExplorerTab = {
      id: "pseudowire",
      label: "Pseudowire",
      content: (
        <PseudowireViewer
          service={SERVICE_NAME}
          pwType="Ethernet"
          pwId={router === "PE1" ? state.pe1Config.fec.pwId : state.pe2Config.fec.pwId}
          localPe={router}
          remotePe={router === "PE1" ? "PE2" : "PE1"}
          localAc={(router === "PE1" ? ac1 : ac2)?.interfaceName ?? "—"}
          remotePeer={router === "PE1" ? (ROUTER_LOOPBACK.PE2 ?? "—") : (ROUTER_LOOPBACK.PE1 ?? "—")}
          localReceiveLabel={allocatePwReceiveLabel(router)}
          remoteReceiveLabel={router === "PE1" ? state.remoteLabelKnownAtPe1 : state.remoteLabelKnownAtPe2}
          transportState={transportReachable(state.transport) ? "UP" : "DOWN"}
          targetedLdpState={state.targetedLdp}
          pwState={pwState}
          mtu={router === "PE1" ? state.pe1Config.mtu : state.pe2Config.mtu}
          controlWord={router === "PE1" ? state.pe1Config.controlWord : state.pe2Config.controlWord}
          status={pwState === "DOWN" && state.troubleshooting.started ? compat.reasons.join(" ") : undefined}
        />
      ),
    };
    const forwardingTab: DeviceExplorerTab = {
      id: "forwarding",
      label: "MPLS Forwarding",
      content: (() => {
        const hop = state.journey.filter((h) => h.device === router).slice(-1)[0];
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
    const lfibTab: DeviceExplorerTab = {
      id: "lfib",
      label: "LFIB",
      content: <LfibViewer title={router} entries={state.journey.filter((h) => h.device === router).map((h) => ({ fec: "transport", incomingLabel: h.input, action: h.action, outgoingLabel: h.output }))} />,
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
    const cliTab: DeviceExplorerTab = { id: "cli", label: "CLI", content: <CLIOutputPanel commands={buildVpwsCliCommands(state, router)} /> };

    if (router === "PE1" || router === "PE2") return [overviewTab, hardwareTab, interfacesTab, igpTab, mplsTransportTab, ldpTab, targetedLdpTab, vpwsServicesTab, pseudowireTab, forwardingTab, packetTab, cliTab];
    if (router === "P1" || router === "P2") return [overviewTab, hardwareTab, interfacesTab, igpTab, mplsTransportTab, lfibTab, packetTab, cliTab];
    return [overviewTab, hardwareTab, interfacesTab, packetTab, cliTab];
  }

  useEffect(() => {
    if (isComplete && !awardedRef.current) {
      awardedRef.current = true;
      completeLesson("mpls-l2vpn-vpws", 550);
      unlockAchievement("pseudowire-engineer");
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
    setLabPe2Mtu(1500);
    setLabMtuHardGate(false);
  };

  const nextLabel = currentStep?.question && !lastAnswer ? "Answer to continue" : currentStep?.requiresState && !canAdvance ? "Apply the correct fix to continue" : "Next Step →";

  const activeNodes = topoView === "service" ? SERVICE_GRAPH_NODES.map((n) => ({ ...n, kind: (n.id === "CE1" || n.id === "CE2" ? "laptop" : "pe-router") as "laptop" | "pe-router" })) : nodes;
  const activeEdges = topoView === "service" ? SERVICE_GRAPH_EDGES : GRAPH_EDGES.map((e) => ({ ...e }));

  return (
    <div className="mx-auto max-w-7xl px-6 py-10">
      <div className="mb-6">
        <Badge tone="cyan" className="mb-3">
          TRADITIONAL MPLS L2VPN · VPWS · ATTACHMENT CIRCUITS · TARGETED LDP
        </Badge>
        <h1 className="text-2xl font-semibold text-pv-text sm:text-3xl">One Virtual Wire, Two Labels</h1>
        <p className="mt-2 max-w-3xl text-sm text-pv-text-muted">
          How can two customer Ethernet ports behave like one virtual wire even though an MPLS provider network sits
          between them? A targeted LDP session signals a pseudowire between two PEs; each PE allocates its own
          directional receive label; the outer transport label gets the frame to the PE, and the inner pseudowire
          label tells that PE which virtual wire the frame belongs to.
        </p>
      </div>

      <div className="mb-4 grid gap-2 sm:grid-cols-4">
        {WHY_VPWS.map((item) => (
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
        {mplsL2vpnVpwsSteps.map((step, i) => (
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
            { value: "transport", label: "Transport" },
            { value: "service", label: "Service" },
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
                if (v === "device" && !enteredDeviceId) setEnteredDeviceId(selectedNodeId ?? activeDeviceId ?? "PE1");
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

          {showServiceInstance && !isComplete && !showPseudowireViewer && <ServiceInstanceViewer title={SERVICE_NAME} subtitle={`PW ID ${PW_ID} · VLAN ${AC_VLAN}`} fields={serviceFields} status={pwState === "UP" ? "up" : "down"} />}

          {showTargetedLdpLifecycle && !isComplete && (
            <GlassPanel className="p-4">
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-pv-text-muted">PacketVerse Targeted LDP Session Lifecycle</h4>
              <p className="pv-mono text-xs text-pv-cyan-soft">{state.targetedLdp}</p>
              <p className="mt-1 text-[11px] text-pv-text-muted">{TARGETED_LDP_INFO[state.targetedLdp].meaning}</p>
              <p className="mt-1 text-[11px] text-pv-text-faint">Why: {TARGETED_LDP_INFO[state.targetedLdp].why}</p>
            </GlassPanel>
          )}

          {showPwFec && !isComplete && (
            <GlassPanel strong className="p-4">
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-pv-violet">Pseudowire FEC</h4>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 pv-mono text-[11px]">
                <span className="text-pv-text-faint">PW Type</span>
                <span className="text-pv-text">{state.pe1Config.fec.pwType}</span>
                <span className="text-pv-text-faint">PW ID</span>
                <span className="text-pv-text">{state.pe1Config.fec.pwId}</span>
                <span className="text-pv-text-faint">FEC Key</span>
                <span className="text-pv-text">{pwFecKey(state.pe1Config.fec)}</span>
              </div>
            </GlassPanel>
          )}

          {showLib && !isComplete && <LibViewer title="PE1" entries={libEntries} />}

          {showLabelFlow && !isComplete && state.journey.length > 0 && <LabelFlowView nodes={labelFlowNodes} />}

          {showPseudowireViewer && !isComplete && (
            <PseudowireViewer
              service={SERVICE_NAME}
              pwType="Ethernet"
              pwId={state.pe1Config.fec.pwId}
              localPe="PE1"
              remotePe="PE2"
              localAc={ac1?.interfaceName ?? "—"}
              remotePeer={ROUTER_LOOPBACK.PE2 ?? "—"}
              localReceiveLabel={allocatePwReceiveLabel("PE1")}
              remoteReceiveLabel={state.remoteLabelKnownAtPe1}
              transportState={transportReachable(state.transport) ? "UP" : "DOWN"}
              targetedLdpState={state.targetedLdp}
              pwState={pwState}
              mtu={state.pe1Config.mtu}
              controlWord={state.pe1Config.controlWord}
              status={pwState === "DOWN" && state.troubleshooting.started ? compat.reasons.join(" ") : undefined}
            />
          )}

          {showLfib && !isComplete && lfibEntries.length > 0 && <LfibViewer title={focusRouter} entries={lfibEntries} />}

          {showMtuLab && !isComplete && (
            <GlassPanel strong className="space-y-3 p-5">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-pv-violet">Advanced Lab: MTU Compatibility</h3>
              <p className="text-[11px] text-pv-text-muted">Read-only preview: computed against real domain functions, nothing here mutates the lesson. This is this lesson&apos;s own deterministic model, not a universal vendor rule.</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-xs">
                  <span className="mb-1 block text-pv-text-faint">PE2 MTU</span>
                  <input type="range" min={1400} max={1500} step={100} value={labPe2Mtu} onChange={(e) => setLabPe2Mtu(Number(e.target.value))} className="w-full" />
                  <span className="pv-mono text-pv-cyan-soft">{labPe2Mtu}</span>
                </label>
                <label className="flex items-center gap-2 text-xs">
                  <input type="checkbox" checked={labMtuHardGate} onChange={(e) => setLabMtuHardGate(e.target.checked)} />
                  <span className="text-pv-text-faint">Treat MTU mismatch as a hard PW-compatibility gate</span>
                </label>
              </div>
              {(() => {
                const labResult = validatePwCompatibility(state.pe1Config, { ...state.pe2Config, mtu: labPe2Mtu }, labMtuHardGate);
                return (
                  <div className="rounded-lg border border-pv-border p-3 pv-mono text-[11px]">
                    <Row label="Compatible" value={labResult.compatible ? "YES" : "NO"} />
                    <Row label="Reasons" value={labResult.reasons.join(" ") || "(none)"} />
                  </div>
                );
              })()}
            </GlassPanel>
          )}

          {showTroubleshoot && !isComplete && <TroubleshootingLayers title="Diagnostic Ladder" layers={diagnosticLayers} />}

          {showViews && !isComplete && (
            <PlaneSplitPanel
              show={planeView}
              controlTitle="Control Plane — Targeted LDP + PW Signaling"
              controlRows={[
                { label: "Targeted LDP", value: state.targetedLdp },
                { label: "PW FEC (PE1 / PE2)", value: `${state.pe1Config.fec.pwId} / ${state.pe2Config.fec.pwId}` },
                { label: "PW State", value: pwState },
                { label: "AC1 / AC2", value: `${ac1?.up ? "UP" : "DOWN"} / ${ac2?.up ? "UP" : "DOWN"}` },
              ]}
              dataTitle="Data Plane — Current MPLS Packet"
              dataRows={
                state.packet
                  ? [
                      { label: "Location", value: state.packetAt ?? "—" },
                      { label: "Labels on wire", value: state.packet.labels.length ? state.packet.labels.map((l) => `${l.value} (${l.purpose})`).join(" / ") : "(none — Ethernet only)" },
                    ]
                  : [{ label: "Packet", value: "none in flight" }]
              }
            />
          )}

          {isComplete && (
            <GlassPanel strong glow="success" className="flex flex-col items-center gap-4 p-10 text-center">
              <Badge tone="success">Pseudowire Engineer</Badge>
              <h2 className="text-2xl font-semibold text-pv-text">You Built The Virtual Wire</h2>
              <p className="max-w-md text-sm text-pv-text-muted">
                You built a traditional LDP-signaled pseudowire — attachment circuits, a targeted LDP session, a
                matching PW FEC, directional receive-label allocation, and two-label forwarding where the core only
                ever touches the outer label. You verified forward and reverse traffic use different PW labels and
                repaired a real PW-ID mismatch. +550 XP awarded.
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
              <button key={r} type="button" onClick={() => setFocusRouter(r)} className={clsx("rounded-full px-3 py-1 text-[11px] font-semibold pv-mono transition-colors", focusRouter === r ? "bg-pv-cyan/15 text-pv-cyan-soft" : "text-pv-text-faint hover:text-pv-text")}>
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
      <p className="mb-3 text-sm font-medium text-pv-text">Choose the correct repair for the pseudowire:</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((opt) => {
          const isSelected = attempt?.choice === opt.id;
          const isCorrect = opt.id === "fix-pw-id";
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
            <span className="font-semibold">✓ PE2&apos;s PW ID corrected to match PE1.</span>
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
