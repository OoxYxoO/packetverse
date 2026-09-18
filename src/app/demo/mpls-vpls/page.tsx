"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { clsx } from "clsx";
import { useScenarioEngine } from "@/lib/sim-engine/useScenarioEngine";
import {
  GRAPH_EDGES,
  GRAPH_NODES,
  LINKS,
  PE_ROUTERS,
  ROUTER_LOOPBACK,
  SERVICE_GRAPH_EDGES,
  SERVICE_GRAPH_NODES,
  SERVICE_NAME,
  STEP_IDX,
  TARGETED_LDP_INFO,
  TERMS,
  VLAN,
  VPLS_XP_AWARD,
  allocatePwReceiveLabel,
  buildVplsCliCommands,
  buildVplsFecKey,
  createMplsVplsState,
  fdbFor,
  mplsVplsSteps,
  portLabel,
  portsFor,
  pwPeersOf,
  pwUpBetween,
  resolveAttachmentCircuit,
  transportReachable,
  type MplsVplsState,
  type RouterId,
} from "@/lib/sim-engine/scenarios/mplsVpls";
import { GraphTopologyViewer } from "@/components/network/GraphTopologyViewer";
import { GraphPacket } from "@/components/network/GraphPacket";
import { PacketInspector } from "@/components/network/PacketInspector";
import { ForwardingDecisionCard } from "@/components/protocol/ForwardingDecisionCard";
import { PacketJourneyTimeline } from "@/components/protocol/PacketJourneyTimeline";
import { PlaneSplitPanel } from "@/components/protocol/PlaneSplitPanel";
import { ServiceInstanceViewer } from "@/components/protocol/ServiceInstanceViewer";
import { PseudowireViewer } from "@/components/protocol/PseudowireViewer";
import { LfibViewer } from "@/components/protocol/LibLfibViewer";
import { EthernetFdbViewer } from "@/components/protocol/EthernetFdbViewer";
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
import { bridgePortsSummary, explainNode } from "./explain";
import { interfacesFor, linkDetailFor, packetFramesFor, traceFor } from "./deviceTrace";

const DEVICE_ROUTERS: RouterId[] = ["CE1", "PE1", "P1", "P2", "P3", "PE2", "PE3", "CE2", "CE3"];
type TopoView = "physical" | "transport" | "service" | "mac-learning";

const WHY_VPLS: { q: string; a: string }[] = [
  { q: "WHAT IS A VPLS BRIDGE CONTEXT?", a: "A per-PE virtual Ethernet bridge for this one service — local AC port plus one pseudowire port per remote mesh PE." },
  { q: "WHY A FULL MESH?", a: "A pseudowire is still point-to-point. Multipoint reachability comes from meshing PWs between every PE pair — required because split horizon forbids PW-to-PW relay." },
  { q: "HOW ARE REMOTE MACS LEARNED?", a: "Purely from the data plane — the source MAC of any frame arriving on a PW is learned exactly like one arriving on a local AC. No control-plane MAC advertisement exists here." },
  { q: "WHAT IS PSEUDOWIRE SPLIT HORIZON?", a: "A frame received from one mesh PW is never relayed out another mesh PW — the rule that keeps a full PW mesh loop-free." },
];

const REPAIR_OPTIONS = [
  { id: "restore-pw-pe1-pe3", label: "Restore the direct pseudowire between PE1 and PE3" },
  { id: "disable-split-horizon-pe2", label: "Disable pseudowire split horizon on PE2 so it can relay PE1's traffic to PE3" },
  { id: "restart-targeted-ldp-mesh", label: "Restart the entire targeted LDP mesh" },
  { id: "reconfigure-ce3-vlan", label: "Change CE3's VLAN tag" },
];
const WRONG_FEEDBACK: Record<string, string> = {
  "disable-split-horizon-pe2": "Never do this. Disabling split horizon would let PE2 relay PW-ingress traffic back out another mesh PW — reopening the exact Ethernet loop condition split horizon exists to prevent, mesh-wide, permanently. It would mask this one symptom while creating a much worse, standing hazard.",
  "restart-targeted-ldp-mesh": "Targeted LDP is already OPERATIONAL for every pair that's actually up — PE1-PE2 and PE2-PE3 both work fine. Restarting the whole mesh doesn't address the one missing leg and would needlessly disrupt healthy pseudowires.",
  "reconfigure-ce3-vlan": "CE3's VLAN tag is irrelevant to this incident — the frame never even reaches PE3's AC to be checked against it. The failure is entirely inside the PW mesh, one hop earlier.",
};

export default function MplsVplsDemo() {
  const { engine, snapshot } = useScenarioEngine<MplsVplsState>(createMplsVplsState(), mplsVplsSteps);
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
  const displayPath: RouterId[] = journeyPath.length > 0 ? journeyPath : DEVICE_ROUTERS;
  const bestPathEdgeIds = displayPath.length > 1 ? LINKS.filter((l) => displayPath.includes(l.a) && displayPath.includes(l.b)).map((l) => l.id) : [];
  const acFor = (r: RouterId) => resolveAttachmentCircuit(state.acs, r);
  const focusAc = acFor(focusRouter);
  const focusIsPe = PE_ROUTERS.includes(focusRouter);
  const focusFdb = focusIsPe ? fdbFor(state, focusRouter) : [];

  // --- visibility gates, keyed off STEP_IDX ---
  const showTerms = index >= STEP_IDX.topologyIntro;
  const showServiceInstance = index >= STEP_IDX.vplsServiceInstance && index < STEP_IDX.establishPwPe1Pe2;
  const showTargetedLdpLifecycle = index >= STEP_IDX.targetedLdpIntro && index < STEP_IDX.establishPwPe1Pe2;
  const showPwMesh = index >= STEP_IDX.establishPwPe1Pe2;
  const showFdb = index >= STEP_IDX.macLearningIntro && focusIsPe;
  const showFloodNote = !!state.floodCopies && state.floodCopies.length > 0;
  const showTroubleshoot = index >= STEP_IDX.troubleshootingIntro;
  const showViews = index >= STEP_IDX.transportRecapIntro;

  const cliCommands = useMemo(() => buildVplsCliCommands(state, focusRouter), [state, focusRouter]);
  const lastHop = state.journey[state.journey.length - 1];

  const serviceFields = [
    { label: "Type", value: "Ethernet VPLS" },
    { label: "FEC / Service ID", value: buildVplsFecKey() },
    { label: "AC", value: focusAc?.interfaceName ?? "—" },
    { label: "VLAN", value: String(VLAN) },
    { label: "Bridge Ports", value: focusIsPe ? portsFor(state, focusRouter).map(portLabel).join(", ") || "(none)" : "—" },
  ];

  const lfibEntries = state.journey.filter((h) => h.device === focusRouter).map((h, i) => ({ fec: `${buildVplsFecKey()}-${i}`, incomingLabel: h.input, action: h.action, outgoingLabel: h.output, outgoingInterface: undefined }));

  const pwLegStatus = (a: RouterId, b: RouterId) => (pwUpBetween(state.pwLinks, a, b) ? "healthy" : state.troubleshooting.started ? "failing" : "unknown");
  const diagnosticLayers: DiagnosticLayer[] = [
    { label: "CE1 / CE2 / CE3 ACs", status: state.acs.every((a) => a.up) ? "healthy" : "failing" },
    { label: "IGP", status: state.transport.igpUp ? "healthy" : "unknown" },
    { label: "MPLS Transport", status: state.transport.ldpUp ? "healthy" : "unknown" },
    { label: "PE Loopback Reachability", status: state.transport.lspUp ? "healthy" : "unknown" },
    { label: "Targeted LDP Mesh", status: state.targetedLdp === "OPERATIONAL" ? "healthy" : "unknown" },
    { label: "PW PE1-PE2", status: pwLegStatus("PE1", "PE2") },
    { label: "PW PE1-PE3", status: pwLegStatus("PE1", "PE3") },
    { label: "PW PE2-PE3", status: pwLegStatus("PE2", "PE3") },
    { label: "Pseudowire Split Horizon", status: "healthy" },
    { label: "CE1 ↔ CE2 Reachability", status: pwLegStatus("PE1", "PE2") },
    { label: "CE1 ↔ CE3 Reachability", status: pwLegStatus("PE1", "PE3") },
    { label: "CE2 ↔ CE3 Reachability", status: pwLegStatus("PE2", "PE3") },
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
    if (PE_ROUTERS.includes(n.id as RouterId)) badges.push("VPLS BRIDGE");
    if (n.id.startsWith("P") && !n.id.startsWith("PE") && topoView === "service") badges.push("HIDDEN IN SERVICE VIEW");
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
  const floodCopies3D: FloodCopy3D[] | undefined = state.floodCopies?.map((fc) => ({ id: fc.id, fromId: fc.fromPe, toId: fc.toPe }));
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
    const mplsTransportTab: DeviceExplorerTab = { id: "mpls-transport", label: "MPLS Transport", content: <Row label="Transport LSP" value={transportReachable(state.transport) ? "UP" : "DOWN"} /> };
    const ldpTab: DeviceExplorerTab = { id: "ldp", label: "LDP", content: <Row label="Hop-by-hop LDP" value={state.transport.ldpUp ? "UP (recap)" : "DOWN"} /> };
    const targetedLdpTab: DeviceExplorerTab = {
      id: "targeted-ldp",
      label: "Targeted LDP",
      content: (
        <div className="space-y-1 pv-mono text-[11px]">
          <Row label="Mesh Peers" value={pwPeersOf(router).map((p) => ROUTER_LOOPBACK[p] ?? p).join(", ")} />
          <Row label="State" value={state.targetedLdp} />
          <p className="mt-1 text-[10px] text-pv-text-faint">{TARGETED_LDP_INFO[state.targetedLdp].meaning}</p>
        </div>
      ),
    };
    const vplsServiceTab: DeviceExplorerTab = {
      id: "vpls-service",
      label: "VPLS Service",
      content: <ServiceInstanceViewer title={SERVICE_NAME} subtitle={`${buildVplsFecKey()} · VLAN ${VLAN}`} fields={[{ label: "AC", value: acFor(router)?.interfaceName ?? "—" }, { label: "Bridge Ports", value: portsFor(state, router).map(portLabel).join(", ") || "(none)" }]} status={acFor(router)?.up ? "up" : "down"} />,
    };
    const pseudowireMeshTab: DeviceExplorerTab = {
      id: "pseudowire-mesh",
      label: "Pseudowire Mesh",
      content: (
        <div className="space-y-3">
          {pwPeersOf(router).map((peer) => (
            <PseudowireViewer
              key={peer}
              service={SERVICE_NAME}
              pwType="Ethernet"
              pwId={1000 + Number(peer.slice(-1))}
              localPe={router}
              remotePe={peer}
              localAc={acFor(router)?.interfaceName ?? "—"}
              remotePeer={ROUTER_LOOPBACK[peer] ?? peer}
              localReceiveLabel={allocatePwReceiveLabel(router, peer)}
              remoteReceiveLabel={allocatePwReceiveLabel(peer, router)}
              transportState={transportReachable(state.transport) ? "UP" : "DOWN"}
              targetedLdpState={state.targetedLdp}
              pwState={pwUpBetween(state.pwLinks, router, peer) ? "UP" : "DOWN"}
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
      content: <EthernetFdbViewer title={router} rows={fdbFor(state, router).map((e) => ({ mac: e.mac, portKind: e.port.kind, portPeer: e.port.peer, age: e.age }))} />,
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
      content: <LfibViewer title={router} entries={state.journey.filter((h) => h.device === router).map((h, i) => ({ fec: `transport-${i}`, incomingLabel: h.input, action: h.action, outgoingLabel: h.output }))} />,
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
    const cliTab: DeviceExplorerTab = { id: "cli", label: "CLI", content: <CLIOutputPanel commands={buildVplsCliCommands(state, router)} /> };

    if (PE_ROUTERS.includes(router)) return [overviewTab, hardwareTab, interfacesTab, igpTab, mplsTransportTab, ldpTab, targetedLdpTab, vplsServiceTab, pseudowireMeshTab, fdbTab, forwardingTab, packetTab, cliTab];
    if (router === "P1" || router === "P2" || router === "P3") return [overviewTab, hardwareTab, interfacesTab, igpTab, mplsTransportTab, lfibTab, packetTab, cliTab];
    return [overviewTab, hardwareTab, interfacesTab, packetTab, cliTab];
  }

  useEffect(() => {
    if (isComplete && !awardedRef.current) {
      awardedRef.current = true;
      completeLesson("mpls-vpls", VPLS_XP_AWARD);
      unlockAchievement("virtual-lan-engineer");
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
    topoView === "service" || topoView === "mac-learning"
      ? SERVICE_GRAPH_NODES.map((n) => ({
          ...n,
          kind: (n.id.startsWith("CE") ? "laptop" : "pe-router") as "laptop" | "pe-router",
          subLabel: topoView === "mac-learning" && PE_ROUTERS.includes(n.id as RouterId) ? `FDB: ${fdbFor(state, n.id as RouterId).length}` : n.subLabel,
        }))
      : nodes;
  const activeEdges = topoView === "service" || topoView === "mac-learning" ? SERVICE_GRAPH_EDGES : GRAPH_EDGES.map((e) => ({ ...e }));

  return (
    <div className="mx-auto max-w-7xl px-6 py-10">
      <div className="mb-6">
        <Badge tone="cyan" className="mb-3">
          TRADITIONAL MPLS VPLS · FULL-MESH PSEUDOWIRES · MAC LEARNING · SPLIT HORIZON
        </Badge>
        <h1 className="text-2xl font-semibold text-pv-text sm:text-3xl">Many Wires, One Virtual LAN</h1>
        <p className="mt-2 max-w-3xl text-sm text-pv-text-muted">
          How does a provider turn multiple point-to-point MPLS pseudowires into one multipoint virtual Ethernet LAN?
          Every PE runs a virtual bridge, full-meshed with pseudowires to every other PE, learning MAC addresses
          purely from the data plane and flooding what it doesn&apos;t know — with one rule, pseudowire split
          horizon, keeping the whole mesh loop-free.
        </p>
      </div>

      <div className="mb-4 grid gap-2 sm:grid-cols-4">
        {WHY_VPLS.map((item) => (
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
        {mplsVplsSteps.map((step, i) => (
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
            { value: "service", label: "VPLS Service" },
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
                    Switch to 3D View to watch every flood replica travel independently at the same time: {state.floodCopies?.map((fc) => `${fc.fromPe} → ${fc.toPe}`).join(", ")}.
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

          {showServiceInstance && !isComplete && <ServiceInstanceViewer title={SERVICE_NAME} subtitle={`${buildVplsFecKey()} · VLAN ${VLAN}`} fields={serviceFields} status={focusAc?.up ? "up" : "down"} />}

          {showTargetedLdpLifecycle && !isComplete && (
            <GlassPanel className="p-4">
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-pv-text-muted">PacketVerse Targeted LDP Mesh Lifecycle</h4>
              <p className="pv-mono text-xs text-pv-cyan-soft">{state.targetedLdp}</p>
              <p className="mt-1 text-[11px] text-pv-text-muted">{TARGETED_LDP_INFO[state.targetedLdp].meaning}</p>
              <p className="mt-1 text-[11px] text-pv-text-faint">Why: {TARGETED_LDP_INFO[state.targetedLdp].why}</p>
            </GlassPanel>
          )}

          {showPwMesh && !isComplete && (
            <div className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-pv-violet">Full-Mesh Pseudowires</h3>
              {(["PE1-PE2", "PE1-PE3", "PE2-PE3"] as const).map((pairId) => {
                const [a, b] = pairId.split("-") as [RouterId, RouterId];
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
                    localReceiveLabel={allocatePwReceiveLabel(a, b)}
                    remoteReceiveLabel={allocatePwReceiveLabel(b, a)}
                    transportState={transportReachable(state.transport) ? "UP" : "DOWN"}
                    targetedLdpState={state.targetedLdp}
                    pwState={pwUpBetween(state.pwLinks, a, b) ? "UP" : "DOWN"}
                    mtu={1500}
                    controlWord={false}
                  />
                );
              })}
            </div>
          )}

          {showFdb && !isComplete && <EthernetFdbViewer title={focusRouter} rows={focusFdb.map((e) => ({ mac: e.mac, portKind: e.port.kind, portPeer: e.port.peer, age: e.age }))} />}

          {index >= STEP_IDX.macLearningIntro && focusIsPe && !isComplete && (
            <GlassPanel className="p-3">
              <p className="pv-mono text-[11px] text-pv-text-faint">Bridge ports at {focusRouter}: {bridgePortsSummary(state, focusRouter)}</p>
            </GlassPanel>
          )}

          {lfibEntries.length > 0 && !isComplete && index >= STEP_IDX.sendCe1ToCe21 && <LfibViewer title={focusRouter} entries={lfibEntries} />}

          {showTroubleshoot && !isComplete && <TroubleshootingLayers title="Diagnostic Ladder" layers={diagnosticLayers} />}

          {showViews && !isComplete && (
            <PlaneSplitPanel
              show={planeView}
              controlTitle="Control Plane — Targeted LDP + Full-Mesh PW Signaling"
              controlRows={[
                { label: "Targeted LDP Mesh", value: state.targetedLdp },
                { label: "PW PE1-PE2 / PE1-PE3 / PE2-PE3", value: `${pwUpBetween(state.pwLinks, "PE1", "PE2") ? "UP" : "DOWN"} / ${pwUpBetween(state.pwLinks, "PE1", "PE3") ? "UP" : "DOWN"} / ${pwUpBetween(state.pwLinks, "PE2", "PE3") ? "UP" : "DOWN"}` },
                { label: "ACs (CE1/CE2/CE3)", value: state.acs.map((a) => (a.up ? "UP" : "DOWN")).join(" / ") },
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
              <Badge tone="success">Virtual LAN Engineer</Badge>
              <h2 className="text-2xl font-semibold text-pv-text">You Built The Virtual LAN</h2>
              <p className="max-w-md text-sm text-pv-text-muted">
                You turned VPWS&apos;s point-to-point pseudowires into a genuine multipoint VPLS bridge — full-mesh
                pseudowires, real data-plane MAC learning, BUM flooding, and the pseudowire split-horizon rule that
                keeps the mesh loop-free. You diagnosed a missing mesh leg and repaired it correctly, never by
                disabling split horizon. +{VPLS_XP_AWARD} XP awarded.
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
      <p className="mb-3 text-sm font-medium text-pv-text">Choose the correct repair to restore CE1 ↔ CE3:</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((opt) => {
          const isSelected = attempt?.choice === opt.id;
          const isCorrect = opt.id === "restore-pw-pe1-pe3";
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
            <span className="font-semibold">✓ PW PE1-PE3 restored — the direct mesh leg is back.</span>
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
