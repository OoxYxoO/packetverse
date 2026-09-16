"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { clsx } from "clsx";
import { useScenarioEngine } from "@/lib/sim-engine/useScenarioEngine";
import {
  ALL_ROUTERS,
  BASE_LINKS,
  DESTINATION,
  FAD_128,
  GRAPH_EDGES,
  GRAPH_NODES,
  HEADEND,
  R6_ALGO0_SID,
  R6_ALGO128_SID,
  STEP_IDX,
  TERMS,
  buildFlexAlgoCliCommands,
  buildSidDatabase,
  computeAlgorithmSpf,
  createSrFlexAlgoState,
  deriveAlgoNodeSidLabel,
  determineParticipatingRouters,
  linkIdsOnPath,
  spfFor,
  srFlexAlgoSteps,
  validateAlgorithmContinuity,
  type AffinityColor,
  type AlgorithmId,
  type MetricType,
  type RouterId,
  type SrFlexAlgoState,
} from "@/lib/sim-engine/scenarios/srFlexAlgo";
import { GraphTopologyViewer } from "@/components/network/GraphTopologyViewer";
import { GraphPacket } from "@/components/network/GraphPacket";
import { PacketInspector } from "@/components/network/PacketInspector";
import { ForwardingDecisionCard } from "@/components/protocol/ForwardingDecisionCard";
import { PacketJourneyTimeline } from "@/components/protocol/PacketJourneyTimeline";
import { PlaneSplitPanel } from "@/components/protocol/PlaneSplitPanel";
import { SidTableViewer } from "@/components/protocol/SidTableViewer";
import { ConstraintEvaluationViewer, type ConstraintCandidateRow } from "@/components/protocol/ConstraintEvaluationViewer";
import { RouteEvolutionViewer } from "@/components/protocol/RouteEvolutionViewer";
import { FlexAlgoDefinitionViewer } from "@/components/protocol/FlexAlgoDefinitionViewer";
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
import type { ActivePacket3D, CameraMode, Link3DData, Node3DStatus, PacketStackFrame } from "@/components/network3d/types";
import { explainNode } from "./explain";
import { interfacesFor, linkDetailFor, packetFramesFor, traceFor } from "./deviceTrace";

const DEVICE_ROUTERS: RouterId[] = ["R1", "R2", "R3", "R4", "R5", "R6"];
type TopoView = "physical" | "algo0" | "flexalgo128";

const WHY_FLEXALGO: { q: string; a: string }[] = [
  { q: "WHAT IS FLEX-ALGO?", a: "A distributed IGP definition (metric type + affinity constraints) that every participating router calculates its own SPF against." },
  { q: "IS ALGORITHM 0 A FLEX-ALGO?", a: "No — Algorithm 0 is the ordinary default SPF every router already runs. Flex-Algo IDs are layered alongside it." },
  { q: "IS THIS AN SR POLICY?", a: "No — SR Policy is headend intent + candidate paths. Flex-Algo is a distributed, IGP-computed topology every participant calculates itself." },
  { q: "IS 128 A FIXED PATH?", a: "No — it's an algorithm definition. Link attributes can change the calculated path without changing the algorithm ID." },
];

const REPAIR_OPTIONS = [
  { id: "change-algo0-sid", label: "Change R6's Algorithm-0 Node SID" },
  { id: "increase-policy-preference", label: "Increase an SR Policy candidate preference" },
  { id: "restart-mpls", label: "Restart MPLS forwarding" },
  { id: "enable-r3-participation", label: "Enable Algorithm 128 participation on R3" },
];
const WRONG_FEEDBACK: Record<string, string> = {
  "change-algo0-sid": "R6's Algorithm-0 Node SID is healthy — default Algorithm-0 forwarding already works. This incident is entirely inside Algorithm 128.",
  "increase-policy-preference": "This failure is in distributed Flex-Algo participation/topology calculation, not SR Policy candidate-path selection — no SR Policy is even involved here.",
  "restart-mpls": "MPLS forwarding is correctly consuming whatever algorithm topology is available to it. The Flex-Algo 128 state itself is incomplete — restarting forwarding doesn't restore R3's participation.",
};

export default function SrFlexAlgoDemo() {
  const { engine, snapshot } = useScenarioEngine<SrFlexAlgoState>(createSrFlexAlgoState(), srFlexAlgoSteps);
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
  const [labAlgorithm, setLabAlgorithm] = useState<AlgorithmId>(128);
  const [labMetric, setLabMetric] = useState<MetricType>("DELAY");
  const [labInclude, setLabInclude] = useState<AffinityColor | "NONE">("NONE");
  const [labExclude, setLabExclude] = useState<AffinityColor | "NONE">("BLUE");
  const [labR3R5Delay, setLabR3R5Delay] = useState(5);
  const awardedRef = useRef(false);
  const completeLesson = useProgressStore((s) => s.completeLesson);
  const recordAnswer = useProgressStore((s) => s.recordAnswer);
  const unlockAchievement = useProgressStore((s) => s.unlockAchievement);

  const { state, currentStep, index, totalSteps, isComplete, lastAnswer, whatChanged, activePacket } = snapshot;
  const canAdvance = engine.canAdvance();

  const nodes = useMemo(() => GRAPH_NODES.map((n) => ({ ...n, kind: (n.id === "R1" || n.id === "R6" ? "pe-router" : "p-router") as "pe-router" | "p-router" })), []);
  const journeyPath = state.journey.map((h) => h.router);
  const algo0 = spfFor(state, 0);
  const algo128 = spfFor(state, 128);
  const participants128 = determineParticipatingRouters(state.algorithmParticipation, 128);
  const continuity128 = validateAlgorithmContinuity(algo128.path, participants128);
  const activeSpf = state.activeAlgorithm === 0 ? algo0 : algo128;
  const displayPath: RouterId[] = journeyPath.length > 0 ? journeyPath : (activeSpf.path ?? ["R1"]);
  const bestPathEdgeIds = linkIdsOnPath(displayPath, state.links);

  // --- visibility gates, keyed off STEP_IDX ---
  const showTerms = index >= STEP_IDX.flexAlgoIntro;
  const showFadCard = index >= STEP_IDX.fadDefined;
  const showMetricsTable = index >= STEP_IDX.topologyMetricsTable && index < STEP_IDX.affinityIntro;
  const showSignature = index === STEP_IDX.signatureComparison;
  const showSidTable = index >= STEP_IDX.algo128PrefixSidIntro && index < STEP_IDX.affinityIntro;
  const showAffinityEval = index >= STEP_IDX.fad128ExcludeBlue && index < STEP_IDX.topologyViewIntro;
  const showTopologyViewHint = index >= STEP_IDX.topologyViewIntro;
  const showAlgorithmRib = index >= STEP_IDX.algorithmRibIntro && index < STEP_IDX.troubleshootingIntro;
  const showLfib = index >= STEP_IDX.lfibIntro && index < STEP_IDX.troubleshootingIntro;
  const showLab = index >= STEP_IDX.flexAlgoLabIntro && index < STEP_IDX.troubleshootingIntro;
  const showTroubleshoot = index >= STEP_IDX.troubleshootingIntro;
  const showViews = index >= STEP_IDX.fadDefined;

  const sidDatabase = useMemo(() => buildSidDatabase(state.algorithmParticipation), [state.algorithmParticipation]);
  const cliCommands = useMemo(() => buildFlexAlgoCliCommands(state, focusRouter), [state, focusRouter]);
  const lastHop = state.journey[state.journey.length - 1];

  const affinityConstraintRows: ConstraintCandidateRow[] = state.links.map((l) => ({
    id: l.id,
    label: l.id,
    columns: [
      { label: "Affinity", value: l.affinity ?? "none" },
      { label: "Delay", value: String(l.delayMetric) },
    ],
    pass: algo128.eligibleLinks.includes(l.id),
    reason: algo128.eligibleLinks.includes(l.id) ? "Eligible for Algorithm 128" : algo128.rejectedLinks.find((r) => r.id === l.id)?.reason,
  }));

  // --- Flex-Algo Lab: read-only preview, computed against real domain functions, never mutates engine state ---
  const labLinks = useMemo(() => state.links.map((l) => (l.id === "R3-R5" ? { ...l, delayMetric: labR3R5Delay } : l)), [state.links, labR3R5Delay]);
  const labDef = useMemo(
    () => ({
      algorithm: labAlgorithm,
      metricType: labAlgorithm === 0 ? ("IGP" as MetricType) : labMetric,
      includeAffinity: labInclude === "NONE" ? undefined : labInclude,
      excludeAffinity: labExclude === "NONE" ? undefined : labExclude,
      priority: 100,
      source: HEADEND,
    }),
    [labAlgorithm, labMetric, labInclude, labExclude],
  );
  const labParticipants = useMemo(() => determineParticipatingRouters(state.algorithmParticipation, labAlgorithm), [state.algorithmParticipation, labAlgorithm]);
  const labResult = useMemo(() => computeAlgorithmSpf(labLinks, labDef, labParticipants, HEADEND, DESTINATION), [labLinks, labDef, labParticipants]);

  const diagnosticLayers: DiagnosticLayer[] = [
    { label: "Physical Topology", status: "healthy" },
    { label: "IGP Adjacencies", status: "healthy" },
    { label: "Algorithm-0 SPF", status: "healthy" },
    { label: "SR Capability", status: "healthy" },
    { label: "FAD 128 Advertised", status: "healthy" },
    { label: "Delay Link Attributes", status: "healthy" },
    { label: "R1 Algorithm-128 Participation", status: participants128.includes("R1") ? "healthy" : "failing" },
    { label: "R3 Algorithm-128 Participation", status: state.troubleshooting.started && !participants128.includes("R3") ? "failing" : participants128.includes("R3") ? "healthy" : "unknown" },
    { label: "Algorithm-128 Topology Continuity", status: state.troubleshooting.started && !continuity128.valid ? "failing" : continuity128.valid ? "healthy" : "unknown" },
    { label: "Algorithm-128 Prefix-SID Forwarding", status: state.troubleshooting.started && !algo128.path ? "failing" : algo128.path ? "healthy" : "unknown" },
    { label: "Default (Algorithm-0) Forwarding", status: "healthy" },
  ];

  // --- 3D derived state ---
  const nodes3DBase = useMemo(() => layoutTo3D(nodes), [nodes]);
  const visitedRouters = new Set(state.journey.map((h) => h.router));
  const highlightPath = topoView === "algo0" ? algo0.path : topoView === "flexalgo128" ? algo128.path : undefined;
  const nodes3D = nodes3DBase.map((n) => {
    let status: Node3DStatus = "idle";
    if (n.id === selectedNodeId || n.id === enteredDeviceId) status = "selected";
    else if (activePacket && (n.id === activePacket.from || n.id === activePacket.to)) status = "active";
    else if (visitedRouters.has(n.id as RouterId)) status = "onPath";
    else if (highlightPath?.includes(n.id as RouterId)) status = "onPath";
    const badges: string[] = [];
    if (n.id === "R1") badges.push("HEADEND");
    if (n.id === "R6") badges.push("DESTINATION");
    if (topoView === "flexalgo128" && !participants128.includes(n.id as RouterId)) badges.push("NOT PARTICIPATING");
    return { ...n, status, badges: badges.length ? badges : undefined };
  });
  const links3D: Link3DData[] = GRAPH_EDGES.map((e) => ({
    id: e.id,
    a: e.a,
    b: e.b,
    active: activePacket ? (e.a === activePacket.from && e.b === activePacket.to) || (e.b === activePacket.from && e.a === activePacket.to) : false,
    onPath: topoView === "physical" ? bestPathEdgeIds.includes(e.id) : !!highlightPath && linkIdsOnPath(highlightPath, state.links).includes(e.id),
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
          {BASE_LINKS.filter((l) => l.a === router || l.b === router).map((l) => (
            <Row key={l.id} label={l.id} value={`IGP ${l.igpMetric} · Delay ${l.delayMetric} · ${l.affinity ?? "no affinity"}`} />
          ))}
        </div>
      ),
    };
    const fadTab: DeviceExplorerTab = {
      id: "fad",
      label: "Flex-Algo Definitions",
      content: (
        <FlexAlgoDefinitionViewer
          algorithm={128}
          metricType={FAD_128.metricType}
          excludeAffinity={FAD_128.excludeAffinity}
          includeAffinity={FAD_128.includeAffinity}
          source={FAD_128.source}
          participation={ALL_ROUTERS.map((r) => ({ router: r, participating: participants128.includes(r) }))}
        />
      ),
    };
    const algoTopologiesTab: DeviceExplorerTab = {
      id: "algo-topologies",
      label: "Algorithm Topologies",
      content: (
        <div className="space-y-2 pv-mono text-[11px]">
          <Row label="Algorithm 0 eligible links" value={algo0.eligibleLinks.join(", ")} />
          <Row label="Algorithm 128 eligible links" value={algo128.eligibleLinks.join(", ") || "(none)"} />
          <Row label="Algorithm 128 rejected links" value={algo128.rejectedLinks.map((r) => `${r.id} (${r.reason})`).join("; ") || "(none)"} />
        </div>
      ),
    };
    const srgbTab: DeviceExplorerTab = {
      id: "srgb",
      label: "SRGB",
      content: (
        <div className="space-y-1 pv-mono text-[11px]">
          <Row label="Range" value="16000-16999" />
          <Row label="Router" value={router} />
          <Row label="Algorithm-0 SID" value={String(deriveAlgoNodeSidLabel(router, 0))} />
          <Row label="Algorithm-128 SID" value={String(deriveAlgoNodeSidLabel(router, 128))} />
        </div>
      ),
    };
    const sidDbTab: DeviceExplorerTab = { id: "sid-db", label: "SID Database", content: <SidTableViewer rows={buildSidDatabase(state.algorithmParticipation).filter((r) => r.router === router)} srgb={{ start: 16000, end: 16999 }} /> };
    const algoRibTab: DeviceExplorerTab = {
      id: "algo-rib",
      label: "Algorithm RIB",
      content: (
        <div className="space-y-1 pv-mono text-[11px]">
          <p className="mb-1 text-[10px] uppercase tracking-wide text-pv-text-faint">PacketVerse conceptual algorithm-specific routing view</p>
          <Row label="Algorithm 0 → 10.0.0.6/32" value={algo0.path?.join(" → ") ?? "unreachable"} />
          <Row label="Algorithm 128 → 10.0.0.6/32" value={algo128.path?.join(" → ") ?? "unreachable"} />
        </div>
      ),
    };
    const forwardingTab: DeviceExplorerTab = {
      id: "forwarding",
      label: "MPLS Forwarding",
      content: (() => {
        const hop = state.journey.filter((h) => h.router === router).slice(-1)[0];
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
    const cliTab: DeviceExplorerTab = { id: "cli", label: "CLI", content: <CLIOutputPanel commands={buildFlexAlgoCliCommands(state, router)} /> };

    if (router === "R1") return [overviewTab, hardwareTab, interfacesTab, igpTab, fadTab, algoTopologiesTab, srgbTab, sidDbTab, algoRibTab, forwardingTab, packetTab, cliTab];
    if (router === "R3") return [overviewTab, hardwareTab, interfacesTab, fadTab, sidDbTab, forwardingTab, packetTab, cliTab];
    return [overviewTab, hardwareTab, interfacesTab, sidDbTab, forwardingTab, packetTab, cliTab];
  }

  useEffect(() => {
    if (isComplete && !awardedRef.current) {
      awardedRef.current = true;
      completeLesson("sr-flex-algo", 600);
      unlockAchievement("algorithm-engineer");
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
    setLabAlgorithm(128);
    setLabMetric("DELAY");
    setLabInclude("NONE");
    setLabExclude("BLUE");
    setLabR3R5Delay(5);
  };

  const nextLabel = currentStep?.question && !lastAnswer ? "Answer to continue" : currentStep?.requiresState && !canAdvance ? "Apply the correct fix to continue" : "Next Step →";

  return (
    <div className="mx-auto max-w-7xl px-6 py-10">
      <div className="mb-6">
        <Badge tone="cyan" className="mb-3">
          SR-MPLS FLEX-ALGO · FAD · AFFINITIES · ALGORITHM-SPECIFIC SIDs
        </Badge>
        <h1 className="text-2xl font-semibold text-pv-text sm:text-3xl">One Prefix, Two Algorithms, Two Paths</h1>
        <p className="mt-2 max-w-3xl text-sm text-pv-text-muted">
          Normal Node-SID forwarding follows the IGP shortest path. What if we want the IGP to calculate ANOTHER
          shortest-path topology, using different constraints? A Flex-Algo Definition, distributed via the IGP, lets
          every participating router calculate its own algorithm-specific SPF — and its own algorithm-specific
          Prefix-SID for the exact same destination.
        </p>
      </div>

      <div className="mb-4 grid gap-2 sm:grid-cols-4">
        {WHY_FLEXALGO.map((item) => (
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
        {srFlexAlgoSteps.map((step, i) => (
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
            { value: "algo0", label: "Algorithm 0" },
            { value: "flexalgo128", label: "Flex-Algo 128" },
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
                if (v === "device" && !enteredDeviceId) setEnteredDeviceId(selectedNodeId ?? activeDeviceId ?? "R1");
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
              <GraphTopologyViewer
                nodes={nodes}
                edges={GRAPH_EDGES.map((e) => {
                  const link = BASE_LINKS.find((l) => l.id === e.id)!;
                  const isEligible = topoView !== "flexalgo128" || algo128.eligibleLinks.includes(e.id);
                  const cost = topoView === "algo0" ? link.igpMetric : topoView === "flexalgo128" ? link.delayMetric : undefined;
                  return { ...e, state: isEligible ? ("full" as const) : ("down" as const), cost };
                })}
                activeNodeIds={activePacket ? [activePacket.from, activePacket.to] : []}
                bestPathEdgeIds={topoView === "physical" ? bestPathEdgeIds : highlightPath ? linkIdsOnPath(highlightPath, state.links) : []}
                onEdgeClick={(id) => setSelectedLinkId(id)}
              >
                {activePacket && nodes.find((n) => n.id === activePacket.from) && nodes.find((n) => n.id === activePacket.to) && (
                  <GraphPacket packet={activePacket} from={nodes.find((n) => n.id === activePacket.from)!} to={nodes.find((n) => n.id === activePacket.to)!} />
                )}
              </GraphTopologyViewer>

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

          {showFadCard && !isComplete && index < STEP_IDX.affinityIntro && (
            <FlexAlgoDefinitionViewer
              title="FAD: Algorithm 128"
              algorithm={128}
              metricType={FAD_128.metricType}
              includeAffinity={FAD_128.includeAffinity}
              excludeAffinity={index >= STEP_IDX.fad128ExcludeBlue ? FAD_128.excludeAffinity : undefined}
              source={FAD_128.source}
              participation={ALL_ROUTERS.map((r) => ({ router: r, participating: participants128.includes(r) }))}
            />
          )}

          {showMetricsTable && !isComplete && (
            <GlassPanel className="p-4">
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-pv-text-muted">Link Metrics</h4>
              <div className="grid grid-cols-1 gap-1.5 pv-mono text-[11px] sm:grid-cols-2">
                {BASE_LINKS.map((l) => (
                  <div key={l.id} className="flex items-center justify-between rounded-lg border border-pv-border px-3 py-1.5">
                    <span className="font-semibold text-pv-text">{l.id}</span>
                    <span className="text-pv-text-muted">
                      IGP {l.igpMetric} · Delay {l.delayMetric} {l.affinity && <Badge tone={l.affinity === "BLUE" ? "cyan" : "warning"}>{l.affinity}</Badge>}
                    </span>
                  </div>
                ))}
              </div>
            </GlassPanel>
          )}

          {showSignature && !isComplete && (
            <RouteEvolutionViewer
              title="Same Destination, Different Algorithm"
              oldLabel="ALGORITHM 0 (IGP)"
              newLabel="FLEX-ALGO 128 (DELAY)"
              fields={[{ label: "R1 → R6 path", oldValue: algo0.path?.join(" → ") ?? "—", newValue: algo128.path?.join(" → ") ?? "—", decisive: true }]}
              winnerReason="Same physical network. Same destination. Different algorithm. Different path — both computed from the same topology, using different constraints."
            />
          )}

          {showSidTable && !isComplete && <SidTableViewer title="SID Database — R6" rows={sidDatabase.filter((r) => r.router === "R6")} srgb={{ start: 16000, end: 16999 }} />}

          {showAffinityEval && !isComplete && (
            <ConstraintEvaluationViewer
              title="Flex-Algo 128 — Affinity Filtering"
              constraintSummary={`Exclude every link carrying affinity ${FAD_128.excludeAffinity}, then compute DELAY-shortest path among what remains.`}
              candidates={affinityConstraintRows}
              resultLabel="Algorithm-128 Path"
              resultValue={algo128.path ? `${algo128.path.join(" → ")} (delay ${algo128.totalMetric})` : "unreachable"}
              resultPass={!!algo128.path}
            />
          )}

          {showTopologyViewHint && !isComplete && index < STEP_IDX.algorithmRibIntro && (
            <GlassPanel className="p-3">
              <p className="text-[11px] text-pv-text-muted">
                Use the <span className="pv-mono text-pv-cyan-soft">Physical / Algorithm 0 / Flex-Algo 128</span> switch above the topology to compare views directly.
              </p>
            </GlassPanel>
          )}

          {showAlgorithmRib && !isComplete && (
            <GlassPanel strong className="space-y-2 p-4">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-pv-violet">Algorithm RIB (PacketVerse Conceptual View)</h4>
              <div className="grid grid-cols-1 gap-1.5 pv-mono text-[11px] sm:grid-cols-2">
                <div className="rounded-lg border border-pv-border p-2">
                  <Row label="Algorithm 0 → 10.0.0.6/32" value={algo0.path?.join(" → ") ?? "unreachable"} />
                </div>
                <div className="rounded-lg border border-pv-border p-2">
                  <Row label="Algorithm 128 → 10.0.0.6/32" value={algo128.path?.join(" → ") ?? "unreachable"} />
                </div>
              </div>
            </GlassPanel>
          )}

          {showLfib && !isComplete && (
            <GlassPanel className="space-y-1.5 p-4 pv-mono text-[11px]">
              <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-pv-text-muted">LFIB — R1</h4>
              <Row label={`Label ${R6_ALGO0_SID}`} value={`Algorithm 0 · next hop ${algo0.path?.[1] ?? "—"}`} />
              <Row label={`Label ${R6_ALGO128_SID}`} value={`Algorithm 128 · next hop ${algo128.path?.[1] ?? "—"}`} />
            </GlassPanel>
          )}

          {showLab && !isComplete && (
            <GlassPanel strong className="space-y-4 p-5">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-pv-violet">Flex-Algo Lab</h3>
              <p className="text-[11px] text-pv-text-muted">Read-only preview: computed against real domain functions, nothing here mutates the lesson.</p>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-xs">
                  <span className="mb-1 block text-pv-text-faint">Algorithm</span>
                  <div className="flex gap-2">
                    {([0, 128] as const).map((a) => (
                      <button key={a} type="button" onClick={() => setLabAlgorithm(a)} className={clsx("rounded-full border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide transition-colors", labAlgorithm === a ? "border-pv-cyan/50 bg-pv-cyan/15 text-pv-cyan-soft" : "border-pv-border text-pv-text-faint hover:text-pv-text")}>
                        {a}
                      </button>
                    ))}
                  </div>
                </label>
                <label className="block text-xs">
                  <span className="mb-1 block text-pv-text-faint">Metric</span>
                  <div className="flex gap-2">
                    {(["IGP", "TE", "DELAY"] as const).map((m) => (
                      <button key={m} type="button" disabled={labAlgorithm === 0} onClick={() => setLabMetric(m)} className={clsx("rounded-full border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide transition-colors disabled:opacity-40", labMetric === m && labAlgorithm !== 0 ? "border-pv-cyan/50 bg-pv-cyan/15 text-pv-cyan-soft" : "border-pv-border text-pv-text-faint hover:text-pv-text")}>
                        {m}
                      </button>
                    ))}
                  </div>
                </label>
                <label className="block text-xs">
                  <span className="mb-1 block text-pv-text-faint">Include Affinity</span>
                  <div className="flex gap-2">
                    {(["NONE", "GOLD"] as const).map((a) => (
                      <button key={a} type="button" disabled={labAlgorithm === 0} onClick={() => setLabInclude(a)} className={clsx("rounded-full border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide transition-colors disabled:opacity-40", labInclude === a && labAlgorithm !== 0 ? "border-pv-cyan/50 bg-pv-cyan/15 text-pv-cyan-soft" : "border-pv-border text-pv-text-faint hover:text-pv-text")}>
                        {a}
                      </button>
                    ))}
                  </div>
                </label>
                <label className="block text-xs">
                  <span className="mb-1 block text-pv-text-faint">Exclude Affinity</span>
                  <div className="flex gap-2">
                    {(["NONE", "BLUE"] as const).map((a) => (
                      <button key={a} type="button" disabled={labAlgorithm === 0} onClick={() => setLabExclude(a)} className={clsx("rounded-full border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide transition-colors disabled:opacity-40", labExclude === a && labAlgorithm !== 0 ? "border-pv-cyan/50 bg-pv-cyan/15 text-pv-cyan-soft" : "border-pv-border text-pv-text-faint hover:text-pv-text")}>
                        {a}
                      </button>
                    ))}
                  </div>
                </label>
              </div>

              <label className="block text-xs">
                <span className="mb-1 block text-pv-text-faint">R3-R5 Delay (link-attribute experiment)</span>
                <input type="range" min={1} max={100} value={labR3R5Delay} onChange={(e) => setLabR3R5Delay(Number(e.target.value))} className="w-full" />
                <span className="pv-mono text-pv-cyan-soft">{labR3R5Delay}</span>
              </label>

              <div className="rounded-lg border border-pv-border p-3 pv-mono text-[11px]">
                <Row label="Eligible links" value={labResult.eligibleLinks.join(", ") || "(none)"} />
                <Row label="Rejected links" value={labResult.rejectedLinks.map((r) => r.id).join(", ") || "(none)"} />
                <Row label="Computed path" value={labResult.path?.join(" → ") ?? "unreachable"} />
                <Row label="Total metric" value={String(labResult.totalMetric ?? "—")} />
              </div>
            </GlassPanel>
          )}

          {showTroubleshoot && !isComplete && <TroubleshootingLayers title="Diagnostic Ladder" layers={diagnosticLayers} />}

          {showViews && !isComplete && (
            <PlaneSplitPanel
              show={planeView}
              controlTitle="Control Plane — Flex-Algo Definition"
              controlRows={[
                { label: "Algorithm", value: "128" },
                { label: "Metric Type", value: FAD_128.metricType },
                { label: "Exclude Affinity", value: index >= STEP_IDX.fad128ExcludeBlue ? (FAD_128.excludeAffinity ?? "none") : "not yet applied" },
                { label: "Participating", value: participants128.join(", ") },
              ]}
              dataTitle="Data Plane — Current MPLS Packet"
              dataRows={
                state.packet
                  ? [
                      { label: "Location", value: state.packetAt ?? "—" },
                      { label: "Active Algorithm", value: String(state.activeAlgorithm) },
                      { label: "Label on wire", value: state.packet.labels.length ? String(state.packet.labels[0].value) : "(none)" },
                    ]
                  : [{ label: "Packet", value: "none in flight" }]
              }
            />
          )}

          {isComplete && (
            <GlassPanel strong glow="success" className="flex flex-col items-center gap-4 p-10 text-center">
              <Badge tone="success">Algorithm Engineer</Badge>
              <h2 className="text-2xl font-semibold text-pv-text">You Defined The Topology</h2>
              <p className="max-w-md text-sm text-pv-text-muted">
                You built a Flex-Algo Definition from real distributed IGP concepts — metric type, affinity, and
                participation — computed an algorithm-specific SPF independently at every participating router, and
                derived an algorithm-specific Prefix-SID that gave the same destination a genuinely different,
                recalculated path. +600 XP awarded.
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

          <PacketJourneyTimeline hops={state.journey} />
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
      <p className="mb-3 text-sm font-medium text-pv-text">Choose the correct repair for Flex-Algo 128:</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((opt) => {
          const isSelected = attempt?.choice === opt.id;
          const isCorrect = opt.id === "enable-r3-participation";
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
            <span className="font-semibold">✓ Algorithm 128 participation restored on R3.</span>
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
