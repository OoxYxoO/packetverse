"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { clsx } from "clsx";
import { useScenarioEngine } from "@/lib/sim-engine/useScenarioEngine";
import {
  BOTTOM_PATH,
  EGRESS,
  GRAPH_EDGES,
  GRAPH_NODES,
  INGRESS,
  STEP_IDX,
  TERMS,
  TOP_PATH,
  buildEro,
  buildRsvpForwardingState,
  buildRsvpTeCliCommands,
  buildTeDatabase,
  computeCspf,
  computeIgpShortestPath,
  createRsvpTeState,
  fmtLabel,
  forSnapshot,
  linkIdsOnPath,
  rsvpTeSteps,
  validateExplicitPath,
  type Affinity,
  type RouterId,
  type RsvpTeState,
} from "@/lib/sim-engine/scenarios/rsvpTe";
import { GraphTopologyViewer, type GraphEdge } from "@/components/network/GraphTopologyViewer";
import { GraphPacket } from "@/components/network/GraphPacket";
import { PacketInspector } from "@/components/network/PacketInspector";
import { ForwardingDecisionCard } from "@/components/protocol/ForwardingDecisionCard";
import { PacketJourneyTimeline } from "@/components/protocol/PacketJourneyTimeline";
import { PlaneSplitPanel } from "@/components/protocol/PlaneSplitPanel";
import { ServiceInstanceViewer } from "@/components/protocol/ServiceInstanceViewer";
import { CapacityBar } from "@/components/protocol/CapacityBar";
import { ConstraintEvaluationViewer, type ConstraintCandidateRow } from "@/components/protocol/ConstraintEvaluationViewer";
import { RouteEvolutionViewer } from "@/components/protocol/RouteEvolutionViewer";
import { ProtocolStateMachine } from "@/components/protocol/ProtocolStateMachine";
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
import { layoutTo3D } from "@/components/network3d/layout";
import type { ActivePacket3D, CameraMode, Link3DData, Node3DStatus, PacketStackFrame } from "@/components/network3d/types";
import { explainNode, rroFor } from "./explain";
import { interfacesFor, linkDetailFor, packetFramesFor, traceFor } from "./deviceTrace";

const DEVICE_ROUTERS: RouterId[] = ["R1", "R2", "R3", "R4", "R5", "R6"];

const WHY_RSVP_TE: { q: string; a: string }[] = [
  { q: "WHAT is RSVP-TE?", a: "A signaling protocol that establishes constrained, traffic-engineered LSPs — not just the IGP's shortest path." },
  { q: "WHY use it?", a: "Guaranteed bandwidth and explicit paths for traffic that can't tolerate the IGP shortest path's bottlenecks." },
  { q: "WHEN is it used?", a: "Service provider cores needing bandwidth-guaranteed tunnels, explicit-path steering, or (in a later lesson) fast local protection." },
  { q: "WITHOUT it?", a: "Traffic always follows the IGP's cost-based shortest path — even through a link that can never satisfy its bandwidth needs." },
];

const REPAIR_OPTIONS = [
  { id: "increase-ospf-metric", label: "Increase the OSPF metric on R2-R4" },
  { id: "restart-rsvp", label: "Restart the RSVP process on R1" },
  { id: "static-route", label: "Add a static route to R6" },
  { id: "release-custb", label: "Release CUST-B's existing reservation on R3-R5" },
];
const WRONG_FEEDBACK: Record<string, string> = {
  "increase-ospf-metric": "This is a TE bandwidth constraint, not an ordinary IGP reachability or preference problem — changing a metric doesn't create reservable bandwidth.",
  "restart-rsvp": "RSVP is healthy on every router — restarting it doesn't change whether a path satisfying 700 Mbps actually exists.",
  "static-route": "R6 is already reachable — reachability was never the failure. CSPF failed on a bandwidth constraint, not on IP routing.",
};

const BANDWIDTH_OPTIONS = [100, 300, 500, 800] as const;

export default function MplsRsvpTeDemo() {
  const { engine, snapshot } = useScenarioEngine<RsvpTeState>(createRsvpTeState(), rsvpTeSteps);
  const [autoPlay, setAutoPlay] = useState(false);
  const [speed, setSpeed] = useState<0.5 | 1 | 2>(1);
  const [viewMode, setViewMode] = useState<"physical" | "igp" | "te" | "3d">("physical");
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
  const [teSource, setTeSource] = useState<"ospf" | "isis">("ospf");
  const [showAdvancedFields, setShowAdvancedFields] = useState(false);
  const [labBandwidth, setLabBandwidth] = useState<(typeof BANDWIDTH_OPTIONS)[number]>(500);
  const [labAffinity, setLabAffinity] = useState<Affinity | undefined>(undefined);
  const [labPathMode, setLabPathMode] = useState<"dynamic" | "explicit">("dynamic");
  const [labExplicitChoice, setLabExplicitChoice] = useState<"top" | "bottom">("bottom");
  const completeLesson = useProgressStore((s) => s.completeLesson);
  const recordAnswer = useProgressStore((s) => s.recordAnswer);
  const unlockAchievement = useProgressStore((s) => s.unlockAchievement);
  const awardedRef = useRef(false);

  const { state, currentStep, index, totalSteps, isComplete, lastAnswer, whatChanged, activePacket } = snapshot;
  const canAdvance = engine.canAdvance();

  const nodes = useMemo(() => GRAPH_NODES.map((n) => ({ ...n, kind: (n.id === "R1" || n.id === "R6" ? "pe-router" : "p-router") as "pe-router" | "p-router" })), []);
  const igpPath = useMemo(() => computeIgpShortestPath(state.teLinks), [state.teLinks]);
  const inCspfAnalysis = index >= STEP_IDX.cspfAnalysisFull && index < STEP_IDX.pathHop1;
  const prunedIds = inCspfAnalysis ? (state.lsp.cspf?.prunedLinkIds ?? []) : [];
  const highlightPath = viewMode === "igp" ? (igpPath?.path ?? TOP_PATH) : state.lsp.path ?? (inCspfAnalysis ? state.lsp.cspf?.path : undefined);
  const bestPathEdgeIds = highlightPath ? linkIdsOnPath(highlightPath, state.teLinks) : [];
  const edges: GraphEdge[] = GRAPH_EDGES.map((e) => ({ ...e, state: prunedIds.includes(e.id) ? ("down" as const) : ("full" as const), label: String(state.teLinks.find((l) => l.id === e.id)?.teMetric ?? "") }));
  const activeNodeIds = activePacket ? [activePacket.from, activePacket.to] : [];
  const packetFrom = activePacket ? nodes.find((n) => n.id === activePacket.from) : undefined;
  const packetTo = activePacket ? nodes.find((n) => n.id === activePacket.to) : undefined;

  const teDbRows = useMemo(() => buildTeDatabase(state.teLinks, state.backgroundReservations, forSnapshot(state.lsp)), [state.teLinks, state.backgroundReservations, state.lsp]);
  const fwd = useMemo(() => buildRsvpForwardingState(state.lsp), [state.lsp]);
  const rro = rroFor(state);

  const showTeDb = index >= STEP_IDX.teDbIntro;
  const showCspfViewer = index >= STEP_IDX.cspfAnalysisFull && !!state.lsp.cspf && state.lsp.state === "CSPF";
  const showEro = index >= STEP_IDX.eroIntro;
  const showLspViewer = index >= STEP_IDX.eroIntro;
  const showIgpVsTe = index >= STEP_IDX.viewsIntro;
  const showLab = index >= STEP_IDX.interactiveLabIntro;
  const showRro = index >= STEP_IDX.rroReveal;
  const showTroubleshoot = index >= STEP_IDX.faultInjected;
  const showPlanes = index >= STEP_IDX.pathHop1 || index >= STEP_IDX.sendDataPacket;

  const cspfCandidates: ConstraintCandidateRow[] = (state.lsp.cspf?.evaluations ?? []).map((e) => ({
    id: e.linkId,
    label: e.label,
    columns: [
      { label: "Available", value: `${e.availableMbps} Mbps` },
      { label: "Required", value: `${e.requiredMbps} Mbps` },
    ],
    pass: e.pass,
    reason: e.reason,
  }));

  const labConstraint = { requiredBandwidthMbps: labBandwidth, affinityInclude: labAffinity };
  const labResult = useMemo(
    () =>
      labPathMode === "dynamic"
        ? computeCspf(labConstraint, state.backgroundReservations, state.teLinks, INGRESS, EGRESS, forSnapshot(state.lsp))
        : validateExplicitPath(labExplicitChoice === "top" ? TOP_PATH : BOTTOM_PATH, state.teLinks, labConstraint, state.backgroundReservations, forSnapshot(state.lsp)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [labBandwidth, labAffinity, labPathMode, labExplicitChoice, state.backgroundReservations, state.teLinks, state.lsp],
  );
  const labCandidates: ConstraintCandidateRow[] = labResult.evaluations
    .filter((e) => labPathMode === "dynamic" || linkIdsOnPath(labExplicitChoice === "top" ? TOP_PATH : BOTTOM_PATH, state.teLinks).includes(e.linkId))
    .map((e) => ({ id: e.linkId, label: e.label, columns: [{ label: "Available", value: `${e.availableMbps} Mbps` }, { label: "Required", value: `${e.requiredMbps} Mbps` }], pass: e.pass, reason: e.reason }));

  const cliCommands = useMemo(() => buildRsvpTeCliCommands(state, focusRouter), [state, focusRouter]);
  const lastHop = state.journey[state.journey.length - 1];

  const diagnosticLayers: DiagnosticLayer[] = [
    { label: "Physical Links", status: "healthy" },
    { label: "IGP", status: "healthy" },
    { label: "TE Extensions", status: "healthy" },
    { label: "TE Database", status: "healthy" },
    { label: "RSVP Enabled", status: "healthy" },
    { label: "Destination Reachable", status: "healthy" },
    { label: "Bandwidth Constraint", status: state.faultActive ? "failing" : state.lsp.cspf?.path ? "healthy" : "unknown" },
    { label: "CSPF Path", status: state.faultActive ? "failing" : state.lsp.cspf?.path ? "healthy" : "unknown" },
    { label: "PATH Signaling", status: !state.faultActive && state.lsp.state !== "DOWN" && state.lsp.state !== "CSPF" ? "healthy" : "unknown" },
    { label: "RESV", status: state.lsp.state === "UP" ? "healthy" : "unknown" },
    { label: "RSVP LSP", status: state.lsp.state === "UP" ? "healthy" : state.faultActive ? "failing" : "unknown" },
  ];

  // --- 3D derived state ---
  const nodes3DBase = useMemo(() => layoutTo3D(nodes), [nodes]);
  const visitedRouters = new Set(state.journey.map((h) => h.router));
  if (state.packet) visitedRouters.add(INGRESS);
  const nodes3D = nodes3DBase.map((n) => {
    let status: Node3DStatus = "idle";
    if (n.id === selectedNodeId || n.id === enteredDeviceId) status = "selected";
    else if (activePacket && (n.id === activePacket.from || n.id === activePacket.to)) status = "active";
    else if (visitedRouters.has(n.id as RouterId)) status = "onPath";
    const isPruned = prunedIds.some((id) => id.includes(n.id));
    const badges = n.id === "R1" ? ["INGRESS"] : n.id === "R6" ? ["EGRESS"] : state.lsp.path?.includes(n.id as RouterId) ? ["ON LSP"] : isPruned ? ["PRUNED"] : undefined;
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

  const activeDeviceId = DEVICE_ROUTERS.find((r) => traceFor(r, state, currentStep?.id ?? "")?.activeStageId !== undefined);
  const effectiveDeviceId = cameraMode === "device" ? enteredDeviceId : cameraMode === "packetFollow" && autoEnterDevices ? activeDeviceId : undefined;
  const inDeviceMode = !!effectiveDeviceId;
  const deviceTrace = effectiveDeviceId ? traceFor(effectiveDeviceId, state, currentStep?.id ?? "") : undefined;

  const followPacketIntoCurrentDevice = () => {
    if (!packetSelected || cameraMode !== "device") return;
    const snap = engine.getSnapshot();
    const nextDevice = DEVICE_ROUTERS.find((r) => traceFor(r, snap.state, snap.currentStep?.id ?? "")?.activeStageId !== undefined);
    if (nextDevice) setEnteredDeviceId(nextDevice);
  };

  const deviceInterfaces = effectiveDeviceId ? interfacesFor(effectiveDeviceId, state) : [];
  const devicePacketFrames: PacketStackFrame[] | undefined = effectiveDeviceId ? packetFramesFor(state) : undefined;

  const followNode3D = cameraMode === "packetFollow" && activePacket ? nodes3D.find((n) => n.id === (state.packetAt ?? activePacket.to)) : undefined;
  const focusPosition3D: [number, number, number] | undefined =
    cameraMode === "freeOrbit" ? undefined : inDeviceMode ? [0, 0, deviceXray ? -0.2 : 0] : cameraMode === "packetFollow" ? followNode3D?.position : selectedNode3D?.position;
  const eyeOffset3D: [number, number, number] | undefined = inDeviceMode ? (deviceXray ? [0.6, 2.6, 5.2] : [2.1, 1.5, 3.8]) : undefined;

  const explainTargetId = (effectiveDeviceId ?? selectedNodeId ?? followNode3D?.id) as RouterId | undefined;
  const nodeExplanation = explainTargetId ? explainNode(state, explainTargetId, currentStep?.id ?? "") : undefined;
  const xrayPacket = activePacket && (selectedNodeId === activePacket.from || selectedNodeId === activePacket.to) ? activePacket : undefined;
  const selectedLinkDetail = selectedLinkId ? linkDetailFor(selectedLinkId, state) : undefined;
  const selectedLinkTeRow = selectedLinkId ? teDbRows.find((r) => r.linkId === selectedLinkId) : undefined;
  const packetCurrentDeviceLabel = effectiveDeviceId ?? state.packetAt ?? activePacket?.from ?? "—";
  const packetDirection = activePacket?.badge === "RESV" ? "Egress → Ingress" : activePacket?.badge === "PATH" ? "Ingress → Egress" : state.lsp.path?.join(" → ") ?? "—";
  const devicePacketForTab = xrayPacket ?? (effectiveDeviceId && state.packetAt === effectiveDeviceId ? activePacket : undefined);

  const advancedFieldsRouter = activePacket?.from as RouterId | undefined;
  const advancedFields =
    showAdvancedFields && activePacket && advancedFieldsRouter
      ? activePacket.badge === "PATH"
        ? [{ label: "SESSION", value: `${state.lsp.egress} / Tunnel-ID 1` }, { label: "RSVP_HOP", value: "previous-hop address (per hop)" }, { label: "TIME_VALUES", value: "refresh interval (soft state)" }, { label: "EXPLICIT_ROUTE", value: state.lsp.path ? buildEro(state.lsp.path).join(", ") : "—" }, { label: "LABEL_REQUEST", value: "requested" }, { label: "SESSION_ATTRIBUTE", value: state.lsp.pathType }, { label: "SENDER_TEMPLATE", value: `${state.lsp.ingress} / Tunnel-ID 1` }, { label: "SENDER_TSPEC", value: `${state.lsp.requestedBandwidthMbps} Mbps` }]
        : [{ label: "SESSION", value: `${state.lsp.egress} / Tunnel-ID 1` }, { label: "STYLE", value: "Fixed Filter" }, { label: "FLOWSPEC", value: `${state.lsp.requestedBandwidthMbps} Mbps` }, { label: "LABEL", value: state.lsp.hops[advancedFieldsRouter]?.label !== undefined ? fmtLabel(state.lsp.hops[advancedFieldsRouter]!.label!) : "—" }]
      : undefined;

  function explorerTabsFor(router: RouterId): DeviceExplorerTab[] {
    if (!nodeExplanation) return [];
    const isIngress = router === "R1";
    const isEgress = router === "R6";
    const overviewTab: DeviceExplorerTab = {
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
    const forwardingTab: DeviceExplorerTab = {
      id: "forwarding",
      label: "MPLS Forwarding",
      content: fwd[router] ? (
        <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 pv-mono text-[11px]">
          <span className="text-pv-text-faint">Incoming Label</span>
          <span className="text-pv-text">{fwd[router]!.incomingLabel === "UNLABELED" ? "unlabeled" : fmtLabel(fwd[router]!.incomingLabel as never)}</span>
          <span className="text-pv-text-faint">Action</span>
          <span className="text-pv-text">{fwd[router]!.action}</span>
          <span className="text-pv-text-faint">Outgoing Label</span>
          <span className="text-pv-text">{fwd[router]!.outgoingLabel !== undefined ? fmtLabel(fwd[router]!.outgoingLabel!) : "—"}</span>
          <span className="text-pv-text-faint">Outgoing Interface</span>
          <span className="text-pv-text">{fwd[router]!.outgoingInterface ?? "—"}</span>
        </div>
      ) : (
        <p className="text-xs text-pv-text-faint">No forwarding entry — LSP not UP yet, or this router isn&apos;t on the signaled path.</p>
      ),
    };
    const cliTab: DeviceExplorerTab = { id: "cli", label: "CLI", content: <CLIOutputPanel commands={buildRsvpTeCliCommands(state, router)} /> };
    const rsvpTable = nodeExplanation.tables?.find((t) => t.title.includes("RSVP Session"));
    const rsvpSessionsTab: DeviceExplorerTab = {
      id: "rsvp",
      label: isIngress ? "RSVP Sessions" : isEgress ? "RSVP State" : "RSVP State",
      content: rsvpTable ? (
        <div className="space-y-0.5 pv-mono text-[11px]">
          {rsvpTable.rows.map((r) => (
            <div key={r.label} className="flex justify-between gap-3">
              <span className="text-pv-text-faint">{r.label}</span>
              <span className="text-pv-text">{r.value}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-pv-text-faint">Not on the currently signaled LSP.</p>
      ),
    };

    if (isIngress) {
      const cspfTable = nodeExplanation.tables?.find((t) => t.title === "CSPF Result");
      const cspfTab: DeviceExplorerTab = {
        id: "cspf",
        label: "CSPF",
        content: cspfTable ? (
          <div className="space-y-0.5 pv-mono text-[11px]">
            {cspfTable.rows.map((r) => (
              <div key={r.label} className="flex justify-between gap-3">
                <span className="text-pv-text-faint">{r.label}</span>
                <span className="text-pv-text">{r.value}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-pv-text-faint">CSPF hasn&apos;t run yet.</p>
        ),
      };
      const igpTab: DeviceExplorerTab = { id: "igp", label: "IGP", content: <p className="pv-mono text-xs text-pv-text">Shortest path to R6: {igpPath?.path.join(" → ")} (cost {igpPath?.cost})</p> };
      const teDbTab: DeviceExplorerTab = { id: "tedb", label: "TE Database", content: <TeDbTable rows={teDbRows} /> };
      const lspTab: DeviceExplorerTab = { id: "lsp", label: "RSVP LSPs", content: <RsvpLspFields state={state} rro={rro} /> };
      return [overviewTab, hardwareTab, interfacesTab, igpTab, teDbTab, cspfTab, rsvpSessionsTab, lspTab, forwardingTab, packetTab, cliTab];
    }
    if (isEgress) {
      const lspTermTab: DeviceExplorerTab = { id: "lsp-term", label: "LSP Termination", content: <RsvpLspFields state={state} rro={rro} /> };
      return [overviewTab, hardwareTab, interfacesTab, rsvpSessionsTab, lspTermTab, forwardingTab, packetTab, cliTab];
    }
    const teLinksTab: DeviceExplorerTab = { id: "te-links", label: "TE Links", content: <TeDbTable rows={teDbRows.filter((r) => r.label.includes(router))} /> };
    return [overviewTab, hardwareTab, interfacesTab, teLinksTab, rsvpSessionsTab, forwardingTab, packetTab, cliTab];
  }

  useEffect(() => {
    if (isComplete && !awardedRef.current) {
      awardedRef.current = true;
      completeLesson("mpls-rsvp-te", 450);
      unlockAchievement("traffic-engineer");
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
    setViewMode("physical");
    setLabBandwidth(500);
    setLabAffinity(undefined);
    setLabPathMode("dynamic");
  };

  const nextLabel = currentStep?.question && !lastAnswer ? "Answer to continue" : currentStep?.requiresState && !canAdvance ? "Apply the correct fix to continue" : "Next Step →";

  return (
    <div className="mx-auto max-w-7xl px-6 py-10">
      <div className="mb-6">
        <Badge tone="cyan" className="mb-3">
          MPLS RSVP-TE · CSPF + PATH/RESV + Bandwidth Reservation
        </Badge>
        <h1 className="text-2xl font-semibold text-pv-text sm:text-3xl">What If The Shortest Path Isn&apos;t The Right Path?</h1>
        <p className="mt-2 max-w-3xl text-sm text-pv-text-muted">
          Watch CSPF prune a bandwidth-insufficient link out of contention entirely, watch PATH and RESV signal in opposite
          directions with labels flowing upstream, watch bandwidth actually reserve on real links, then watch MPLS traffic
          follow the engineered path instead of the IGP shortest path.
        </p>
      </div>

      <div className="mb-4 grid gap-2 sm:grid-cols-4">
        {WHY_RSVP_TE.map((item) => (
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
        {rsvpTeSteps.map((step, i) => (
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
            { value: "te", label: "Traffic Engineering" },
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
                if (v === "device" && !enteredDeviceId) setEnteredDeviceId(selectedNodeId ?? activeDeviceId ?? "R1");
                if (v === "overview") {
                  setEnteredDeviceId(undefined);
                  setSelectedNodeId(undefined);
                }
                if (v === "freeOrbit") setEnteredDeviceId(undefined);
              }}
            />
            {inDeviceMode && (
              <TopologyModeSwitcher options={[{ value: "off", label: "Exterior" }, { value: "on", label: "X-Ray" }]} value={deviceXray ? "on" : "off"} onChange={(v) => setDeviceXray(v === "on")} tone="violet" />
            )}
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
          {viewMode === "3d" ? (
            <>
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
                <>
                  <LinkDetailPanel detail={selectedLinkDetail} onClose={() => setSelectedLinkId(undefined)} />
                  {selectedLinkTeRow && <CapacityBar title={`${selectedLinkTeRow.label} — TE Capacity`} total={selectedLinkTeRow.maxReservableMbps} reserved={selectedLinkTeRow.reservedMbps} itemCount={selectedLinkTeRow.reservedMbps > 0 ? 1 : 0} />}
                </>
              )}

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
              <GraphTopologyViewer
                nodes={nodes}
                edges={edges}
                activeNodeIds={activeNodeIds}
                bestPathEdgeIds={bestPathEdgeIds}
                onEdgeClick={(id) => setSelectedLinkId(id)}
              >
                {activePacket && packetFrom && packetTo && <GraphPacket packet={activePacket} from={packetFrom} to={packetTo} />}
              </GraphTopologyViewer>

              {selectedLinkId && !lastHop && (
                <>
                  {linkDetailFor(selectedLinkId, state) && <LinkDetailPanel detail={linkDetailFor(selectedLinkId, state)!} onClose={() => setSelectedLinkId(undefined)} />}
                  {selectedLinkTeRow && <CapacityBar title={`${selectedLinkTeRow.label} — TE Capacity`} total={selectedLinkTeRow.maxReservableMbps} reserved={selectedLinkTeRow.reservedMbps} itemCount={selectedLinkTeRow.reservedMbps > 0 ? 1 : 0} />}
                </>
              )}

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
            <PredictionQuestion question={currentStep.question} selectedOptionId={lastAnswer?.stepId === currentStep.id ? lastAnswer.optionId : undefined} onAnswer={handleAnswer} />
          )}

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

          {showTeDb && !isComplete && (
            <GlassPanel strong className="space-y-3 p-5">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-pv-violet">Traffic Engineering Database</h3>
                <TopologyModeSwitcher options={[{ value: "ospf", label: "OSPF TE" }, { value: "isis", label: "IS-IS TE" }]} value={teSource} onChange={setTeSource} tone="violet" />
              </div>
              <p className="text-[11px] text-pv-text-muted">
                {teSource === "ospf" ? "Sourced conceptually from OSPF's traffic-engineering opaque LSA extensions." : "Sourced conceptually from IS-IS TE sub-TLVs in extended reachability."} Same underlying attributes either way — this lesson stays protocol-neutral about which IGP is running.
              </p>
              <TeDbTable rows={teDbRows} />
            </GlassPanel>
          )}

          {showCspfViewer && state.lsp.cspf && !isComplete && (
            <ConstraintEvaluationViewer
              title="CSPF — Constraint Filtering"
              constraintSummary={`Required Bandwidth: ${state.lsp.cspf.constraint.requiredBandwidthMbps} Mbps${state.lsp.cspf.constraint.affinityInclude ? `, Affinity: ${state.lsp.cspf.constraint.affinityInclude}` : ""}`}
              candidates={cspfCandidates}
              resultLabel={state.lsp.cspf.path ? "Shortest Valid Path" : "No Valid Path"}
              resultValue={state.lsp.cspf.path ? `${state.lsp.cspf.path.join(" → ")} (TE metric ${state.lsp.cspf.teMetricTotal})` : "No PATH message will be sent"}
              resultPass={!!state.lsp.cspf.path}
            />
          )}

          {showEro && state.lsp.path && !isComplete && (
            <GlassPanel strong className="space-y-2 p-4">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-pv-violet">Explicit Route Object (ERO)</h4>
              <div className="flex flex-col items-center gap-1 pv-mono text-sm">
                {buildEro(state.lsp.path).map((hop, i, arr) => (
                  <div key={hop} className="flex flex-col items-center">
                    <span className="rounded-lg border border-pv-cyan/40 bg-pv-cyan/5 px-3 py-1 text-pv-text">{hop}</span>
                    {i < arr.length - 1 && <span className="py-0.5 text-pv-text-faint">↓</span>}
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-pv-text-faint">The ERO communicates the intended path during signaling — it doesn&apos;t forward a single data packet itself.</p>
            </GlassPanel>
          )}

          {activePacket && (activePacket.badge === "PATH" || activePacket.badge === "RESV") && (
            <GlassPanel className="space-y-2 p-4">
              <button type="button" onClick={() => setShowAdvancedFields((v) => !v)} className="text-[11px] font-semibold uppercase tracking-wide text-pv-cyan-soft hover:text-pv-cyan">
                {showAdvancedFields ? "▾" : "▸"} Advanced RSVP Fields
              </button>
              {advancedFields && (
                <div className="grid grid-cols-2 gap-x-3 gap-y-1 pv-mono text-[11px]">
                  {advancedFields.map((f) => (
                    <div key={f.label} className="contents">
                      <span className="text-pv-text-faint">{f.label}</span>
                      <span className="text-pv-text">{f.value}</span>
                    </div>
                  ))}
                </div>
              )}
            </GlassPanel>
          )}

          {index >= STEP_IDX.lspUp && state.lsp.state === "UP" && !isComplete && (
            <ProtocolStateMachine states={["DOWN", "CSPF", "SIGNALING", "UP"]} current={state.lsp.state} descriptions={undefined} title="PacketVerse LSP Lifecycle (teaching abstraction, not an official RSVP FSM)" />
          )}
          {index >= STEP_IDX.lspLifecycleIntro && index < STEP_IDX.lspUp + 1 && state.lsp.state !== "UP" && !isComplete && (
            <ProtocolStateMachine states={["DOWN", "CSPF", "SIGNALING", "UP"]} current={state.lsp.state} title="PacketVerse LSP Lifecycle (teaching abstraction, not an official RSVP FSM)" />
          )}

          {showIgpVsTe && igpPath && !isComplete && (
            <RouteEvolutionViewer
              title="IGP Shortest Path vs. RSVP-TE LSP"
              oldLabel="IGP SHORTEST PATH"
              newLabel="RSVP-TE LSP"
              fields={[
                { label: "Metric", oldValue: String(igpPath.cost), newValue: String(state.lsp.cspf?.teMetricTotal ?? "—"), decisive: false },
                { label: "Path", oldValue: igpPath.path.join("-"), newValue: state.lsp.path?.join("-") ?? "—", decisive: true },
                { label: "Available Bandwidth", oldValue: "200 Mbps (bottleneck)", newValue: `${state.lsp.reservedBandwidthMbps ?? state.lsp.requestedBandwidthMbps} Mbps reserved`, decisive: true },
              ]}
              winnerReason="The IGP shortest path's bottleneck (200 Mbps) cannot satisfy the bandwidth constraint — the TE path was never trying to be the shortest path, only a valid one."
            />
          )}

          {showPlanes && !isComplete && (
            <PlaneSplitPanel
              show={planeView}
              controlTitle="Control Plane — TE DB → CSPF → PATH/RESV → Reservation → Labels"
              controlRows={[
                { label: "CSPF result", value: state.lsp.cspf?.path ? `${state.lsp.cspf.path.join(" → ")} (metric ${state.lsp.cspf.teMetricTotal})` : "no path found" },
                { label: "LSP state", value: state.lsp.state },
                { label: "Requested / Reserved", value: `${state.lsp.requestedBandwidthMbps} Mbps / ${state.lsp.reservedBandwidthMbps ?? "—"} Mbps` },
                { label: "R1 outgoing label", value: fwd.R1?.outgoingLabel !== undefined ? fmtLabel(fwd.R1.outgoingLabel) : "—" },
              ]}
              dataTitle="Data Plane — Current MPLS Packet"
              dataRows={
                state.packet
                  ? [
                      { label: "Location", value: state.packetAt ?? "—" },
                      { label: "Labels on wire", value: state.packet.labels.length ? state.packet.labels.map((l) => `${l.value}`).join(" → ") : "(none)" },
                      { label: "Following", value: state.lsp.path?.join(" → ") ?? "—" },
                    ]
                  : [{ label: "Packet", value: "none in flight" }]
              }
            />
          )}

          {showLab && !isComplete && (
            <GlassPanel strong className="space-y-3 p-5">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-pv-violet">CSPF Lab — Try Your Own Constraints</h3>
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex gap-1 rounded-full border border-pv-border p-0.5">
                  {BANDWIDTH_OPTIONS.map((bw) => (
                    <button key={bw} type="button" onClick={() => setLabBandwidth(bw)} className={clsx("rounded-full px-2.5 py-1 text-[11px] font-semibold pv-mono transition-colors", labBandwidth === bw ? "bg-pv-cyan/15 text-pv-cyan-soft" : "text-pv-text-faint hover:text-pv-text")}>
                      {bw} Mbps
                    </button>
                  ))}
                </div>
                <TopologyModeSwitcher options={[{ value: "dynamic", label: "Dynamic CSPF" }, { value: "explicit", label: "Explicit Path" }]} value={labPathMode} onChange={setLabPathMode} tone="violet" />
                {labPathMode === "explicit" && (
                  <TopologyModeSwitcher options={[{ value: "top", label: "Top Path" }, { value: "bottom", label: "Bottom Path" }]} value={labExplicitChoice} onChange={setLabExplicitChoice} />
                )}
                <button
                  type="button"
                  onClick={() => setLabAffinity((v) => (v === "GOLD" ? undefined : "GOLD"))}
                  className={clsx("rounded-full border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide transition-colors", labAffinity === "GOLD" ? "border-pv-warning/50 bg-pv-warning/10 text-pv-warning" : "border-pv-border text-pv-text-faint hover:text-pv-text")}
                >
                  Include: GOLD {labAffinity === "GOLD" ? "✓" : ""}
                </button>
              </div>
              <ConstraintEvaluationViewer
                title={labPathMode === "dynamic" ? "Dynamic CSPF Result" : `Explicit Path Validation — ${labExplicitChoice === "top" ? "Top" : "Bottom"} Path`}
                constraintSummary={`Required Bandwidth: ${labBandwidth} Mbps${labAffinity ? `, Affinity: ${labAffinity}` : ""}`}
                candidates={labCandidates}
                resultLabel={labResult.path ? "Feasible" : "Not Feasible"}
                resultValue={labResult.path ? `${labResult.path.join(" → ")} (TE metric ${labResult.teMetricTotal})` : "RSVP still needs a viable, signalable path — this one doesn't exist"}
                resultPass={!!labResult.path}
              />
            </GlassPanel>
          )}

          {showRro && state.lsp.state === "UP" && !isComplete && (
            <GlassPanel className="space-y-2 p-4">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-pv-text-muted">[ADVANCED] Record Route Object (RRO)</h4>
              <p className="pv-mono text-sm text-pv-text">{rro.join(" → ")}</p>
              <p className="text-[11px] text-pv-text-faint">The ERO was the intended/requested path. The RRO is the recorded path/state information after signaling succeeded — not the same object.</p>
            </GlassPanel>
          )}

          {showTroubleshoot && !isComplete && <TroubleshootingLayers title="Diagnostic Ladder" layers={diagnosticLayers} />}

          {isComplete && (
            <GlassPanel strong glow="success" className="flex flex-col items-center gap-4 p-10 text-center">
              <Badge tone="success">Traffic Engineer</Badge>
              <h2 className="text-2xl font-semibold text-pv-text">You Engineered The Path</h2>
              <p className="max-w-md text-sm text-pv-text-muted">
                You watched IGP pick the shortest path, watched a bandwidth constraint disqualify it anyway, watched CSPF prune
                and select a real constrained path, watched PATH and RESV signal in opposite directions with labels flowing
                upstream, watched bandwidth actually reserve, and repaired a bandwidth-constraint failure by releasing a
                competing reservation. +450 XP awarded.
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

          {showLspViewer && (
            <ServiceInstanceViewer
              title={`LSP: ${state.lsp.id}`}
              subtitle="RSVP-TE"
              status={state.lsp.state === "UP" ? "up" : state.lsp.state === "DOWN" ? "down" : undefined}
              fields={[
                { label: "Ingress", value: state.lsp.ingress },
                { label: "Egress", value: state.lsp.egress },
                { label: "State", value: state.lsp.state },
                { label: "Requested Bandwidth", value: `${state.lsp.requestedBandwidthMbps} Mbps` },
                { label: "Reserved Bandwidth", value: state.lsp.reservedBandwidthMbps !== undefined ? `${state.lsp.reservedBandwidthMbps} Mbps` : "—" },
                { label: "Path Type", value: state.lsp.pathType },
                { label: "ERO", value: state.lsp.path ? buildEro(state.lsp.path).join(" → ") : "—" },
                { label: "RRO", value: state.lsp.state === "UP" ? rro.join(" → ") || "—" : "—" },
                { label: "TE Metric", value: state.lsp.cspf?.teMetricTotal !== undefined ? String(state.lsp.cspf.teMetricTotal) : "—" },
                { label: "Affinity", value: state.lsp.affinityInclude ?? "none" },
                { label: "R1 Outgoing Label", value: fwd.R1?.outgoingLabel !== undefined ? fmtLabel(fwd.R1.outgoingLabel) : "—" },
              ]}
            />
          )}

          <PacketJourneyTimeline hops={state.journey} />
          <CLIOutputPanel commands={cliCommands} />
        </div>
      </div>
    </div>
  );
}

function TeDbTable({ rows }: { rows: ReturnType<typeof buildTeDatabase> }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full pv-mono text-[10.5px]">
        <thead>
          <tr className="text-left text-[9px] uppercase tracking-wide text-pv-text-faint">
            <th className="pb-1 pr-2">Link</th>
            <th className="pb-1 pr-2">IGP</th>
            <th className="pb-1 pr-2">TE</th>
            <th className="pb-1 pr-2">Max BW</th>
            <th className="pb-1 pr-2">Max Reservable</th>
            <th className="pb-1 pr-2">Reserved</th>
            <th className="pb-1 pr-2">Available</th>
            <th className="pb-1 pr-2">Affinity</th>
            <th className="pb-1">RSVP</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.linkId} className="border-t border-pv-border">
              <td className="py-1 pr-2 text-pv-text">{r.label}</td>
              <td className="py-1 pr-2 text-pv-text-muted">{r.igpMetric}</td>
              <td className="py-1 pr-2 text-pv-text-muted">{r.teMetric}</td>
              <td className="py-1 pr-2 text-pv-text-muted">{r.maxBandwidthMbps}</td>
              <td className="py-1 pr-2 text-pv-text-muted">{r.maxReservableMbps}</td>
              <td className="py-1 pr-2 text-pv-text-muted">{r.reservedMbps}</td>
              <td className={clsx("py-1 pr-2 font-semibold", r.availableMbps > 0 ? "text-pv-success" : "text-pv-danger")}>{r.availableMbps}</td>
              <td className="py-1 pr-2 text-pv-text-muted">{r.affinity}</td>
              <td className="py-1 text-pv-text-muted">{r.rsvpEnabled ? "Yes" : "No"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RsvpLspFields({ state, rro }: { state: RsvpTeState; rro: RouterId[] }) {
  return (
    <div className="space-y-0.5 pv-mono text-[11px]">
      {[
        { label: "State", value: state.lsp.state },
        { label: "Requested", value: `${state.lsp.requestedBandwidthMbps} Mbps` },
        { label: "Reserved", value: state.lsp.reservedBandwidthMbps !== undefined ? `${state.lsp.reservedBandwidthMbps} Mbps` : "—" },
        { label: "Path", value: state.lsp.path?.join(" → ") ?? "—" },
        { label: "RRO", value: state.lsp.state === "UP" ? rro.join(" → ") || "—" : "—" },
      ].map((r) => (
        <div key={r.label} className="flex justify-between gap-3">
          <span className="text-pv-text-faint">{r.label}</span>
          <span className="text-pv-text">{r.value}</span>
        </div>
      ))}
    </div>
  );
}

function RepairChallenge({ options, attempt, onTry }: { options: { id: string; label: string }[]; attempt?: { choice: string; correct: boolean }; onTry: (choice: string) => void }) {
  return (
    <GlassPanel strong className="p-5">
      <p className="mb-3 text-sm font-medium text-pv-text">Choose the correct repair to make a 700 Mbps LSP feasible:</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((opt) => {
          const isSelected = attempt?.choice === opt.id;
          const isCorrect = opt.id === "release-custb";
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
            <span className="font-semibold">✓ CUST-B&apos;s reservation released — R3-R5 is back to 1000 Mbps available.</span>
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
