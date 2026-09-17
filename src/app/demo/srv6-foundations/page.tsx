"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { clsx } from "clsx";
import { useScenarioEngine } from "@/lib/sim-engine/useScenarioEngine";
import {
  ALL_ROUTERS,
  ARGUMENT_LENGTH,
  END_FUNCTION,
  FUNCTION_LENGTH,
  GRAPH_EDGES,
  GRAPH_NODES,
  LOCATOR_LENGTH,
  STEP_IDX,
  TERMS,
  buildIpv6Fib,
  buildSrv6CliCommands,
  computeSrv6PacketPath,
  createSrv6State,
  endSidText,
  fmtIpv6,
  functionHexText,
  locatorTextFor,
  srv6Steps,
  type RouterId,
  type Srv6State,
} from "@/lib/sim-engine/scenarios/srv6Foundations";
import { GraphTopologyViewer, type GraphEdge } from "@/components/network/GraphTopologyViewer";
import { GraphPacket } from "@/components/network/GraphPacket";
import { PacketInspector } from "@/components/network/PacketInspector";
import { ForwardingDecisionCard } from "@/components/protocol/ForwardingDecisionCard";
import { PacketJourneyTimeline } from "@/components/protocol/PacketJourneyTimeline";
import { PlaneSplitPanel } from "@/components/protocol/PlaneSplitPanel";
import { Srv6SidStructureViewer } from "@/components/protocol/Srv6SidStructureViewer";
import { LocalSidTableViewer, type LocalSidRow } from "@/components/protocol/LocalSidTableViewer";
import { SegmentRoutingHeaderViewer, type SrhSegmentRow } from "@/components/protocol/SegmentRoutingHeaderViewer";
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

const DEVICE_ROUTERS: RouterId[] = ALL_ROUTERS;
const SID_OWNER_ROUTERS: RouterId[] = ["R3", "R5", "R6"];
type TopoView = "physical" | "ipv6" | "srv6";

const WHY_SRV6: { q: string; a: string }[] = [
  { q: "WHAT IS SRv6?", a: "Segment Routing instantiated directly in the IPv6 data plane — segments are 128-bit IPv6 SIDs, not MPLS labels." },
  { q: "WHY USE IT?", a: "SR steering and IPv6 forwarding are the same mechanism — no MPLS label stack required underneath." },
  { q: "IS EVERY ADDRESS A SID?", a: "No — a SID must be explicitly instantiated and bound to a behavior in a Local SID Table." },
  { q: "WITHOUT SRv6?", a: "SR-MPLS needs an MPLS data plane underneath; a routed IPv6-only core has no equivalent steering mechanism without it." },
];

const SERVICE_BEHAVIOR_PREVIEW = [
  { behavior: "End", meaning: "Basic endpoint — the segment routing program continues", status: "Taught in this lesson" },
  { behavior: "End.X", meaning: "Endpoint with an L3 cross-connect (Adj-SID-style)", status: "Preview only" },
  { behavior: "End.T", meaning: "Endpoint with a specific IPv6 table lookup", status: "Preview only" },
  { behavior: "End.DX4", meaning: "Decapsulation + IPv4 cross-connect", status: "Preview only" },
  { behavior: "End.DX6", meaning: "Decapsulation + IPv6 cross-connect", status: "Preview only" },
  { behavior: "End.DT4", meaning: "Decapsulation + IPv4 table lookup", status: "Preview only" },
  { behavior: "End.DT6", meaning: "Decapsulation + IPv6 table lookup", status: "Preview only" },
  { behavior: "End.DX2", meaning: "Decapsulation + L2 cross-connect", status: "Preview only" },
];

const ARCH_COMPARISON = [
  { property: "SID encoding", srMpls: "MPLS label", srv6: "128-bit IPv6 address" },
  { property: "Active segment", srMpls: "Top label", srv6: "IPv6 Destination Address" },
  { property: "Segment list", srMpls: "Label stack", srv6: "SRH — only when more than one segment is needed" },
  { property: "Forwarding core", srMpls: "MPLS LFIB", srv6: "IPv6 FIB" },
  { property: "Endpoint action", srMpls: "Label action (PUSH/SWAP/POP)", srv6: "SID behavior (e.g. End)" },
  { property: "SRGB", srMpls: "Relevant — derives label values", srv6: "Not used for SRv6 SID allocation" },
  { property: "PHP", srMpls: "Penultimate-hop popping", srv6: "No equivalent SRv6 mechanism" },
];

const REPAIR_OPTIONS = [
  { id: "change-r1-route", label: "Change R1's IPv6 route to R3's locator" },
  { id: "manual-sl-edit", label: "Manually change Segments Left in the SRH" },
  { id: "add-mpls-label", label: "Add an MPLS label for R3" },
  { id: "restore-local-sid", label: "Restore R3's local SID (behavior: End) in its Local SID Table" },
];
const WRONG_FEEDBACK: Record<string, string> = {
  "change-r1-route": "R1's route to R3's locator already works — the packet already arrives at R3 correctly. The problem is what R3 does once it gets there.",
  "manual-sl-edit": "The SRH is already valid — Segments Left and Last Entry are correct. The failure is that R3 has no local SID entry bound to the active SID, not a malformed header.",
  "add-mpls-label": "This is the SRv6 IPv6 data plane, not SR-MPLS — there is no MPLS label stack to add here.",
};

export default function Srv6FoundationsDemo() {
  const { engine, snapshot } = useScenarioEngine<Srv6State>(createSrv6State(), srv6Steps);
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
  const [labOrder, setLabOrder] = useState<RouterId[]>(["R6"]);
  const completeLesson = useProgressStore((s) => s.completeLesson);
  const recordAnswer = useProgressStore((s) => s.recordAnswer);
  const unlockAchievement = useProgressStore((s) => s.unlockAchievement);

  const { state, currentStep, index, totalSteps, isComplete, lastAnswer, whatChanged, activePacket } = snapshot;
  const canAdvance = engine.canAdvance();

  const nodes = useMemo(() => GRAPH_NODES.map((n) => ({ ...n, kind: (n.id === "R1" || n.id === "R6" ? "pe-router" : "p-router") as "pe-router" | "p-router" })), []);
  const journeyPath = state.journey.map((h) => h.router);
  const previewPath = journeyPath.length > 0 ? journeyPath : state.highLevelOrder ? computeSrv6PacketPath(state.highLevelOrder, state.links) : [];
  const bestPathEdgeIds = linkIdsOnPath(previewPath, state.links);

  const displayNodes = nodes.map((n) => {
    if (topoView === "srv6") return { ...n, subLabel: SID_OWNER_ROUTERS.includes(n.id as RouterId) ? (state.localSidTable[n.id as RouterId] ? "End SID" : "NO LOCAL SID") : undefined };
    if (topoView === "ipv6") return { ...n, subLabel: locatorTextFor(n.id as RouterId).split("/")[0] };
    return n;
  });
  const edges: GraphEdge[] = GRAPH_EDGES.map((e) => ({ ...e, state: "full" as const, cost: topoView === "ipv6" ? state.links.find((l) => l.id === e.id)?.metric : undefined }));
  const activeNodeIds = activePacket ? [activePacket.from, activePacket.to] : [];
  const packetFrom = activePacket ? nodes.find((n) => n.id === activePacket.from) : undefined;
  const packetTo = activePacket ? nodes.find((n) => n.id === activePacket.to) : undefined;

  const showTerms = index >= STEP_IDX.whatIsASid;
  const showSidStructure = index >= STEP_IDX.sidStructureIntro && index < STEP_IDX.localSidTableIntro;
  const showLocalSidTable = index >= STEP_IDX.localSidTableIntro;
  const showSrh = index >= STEP_IDX.srhViewerIntro && !!state.packet;
  const showViews = index >= STEP_IDX.viewsIntro;
  const showLab = index >= STEP_IDX.segmentLabIntro && index < STEP_IDX.troubleshootingIntro;
  const showTroubleshoot = index >= STEP_IDX.troubleshootingIntro;
  const showServicePreview = currentStep?.id === "service-behavior-preview-table";
  const showArchComparison = currentStep?.id === "sr-mpls-vs-srv6-full-comparison";
  const showLocatorVsSidVisual = currentStep?.id === "locator-vs-local-sid" || currentStep?.id === "predict-q6-locator-vs-local-sid";

  const lastHop = state.journey[state.journey.length - 1];

  const localSidRows: LocalSidRow[] = SID_OWNER_ROUTERS.map((r) => {
    const e = state.localSidTable[r];
    return e
      ? { sid: e.sidText, locator: e.locatorText, functionText: e.functionText, behavior: e.behavior, owner: e.owner, state: "ACTIVE" as const, parameters: e.parameters }
      : { sid: endSidText(r), locator: locatorTextFor(r), functionText: functionHexText(END_FUNCTION), behavior: "End", owner: r, state: "MISSING" as const, parameters: "—" };
  });

  const srhSegmentRows: SrhSegmentRow[] | undefined = state.packet?.srh?.segmentList.map((s) => ({ index: s.index, sid: s.sidText, label: s.ownerRouter }));

  const ipv6Fib = useMemo(() => buildIpv6Fib(focusRouter, state.links, state.locators), [focusRouter, state.links, state.locators]);
  const cliCommands = useMemo(() => buildSrv6CliCommands(state, focusRouter), [state, focusRouter]);

  const diagnosticLayers: DiagnosticLayer[] = [
    { label: "R1/R2/R3 Interfaces", status: "healthy" },
    { label: "IPv6 IGP", status: "healthy" },
    { label: "R3 Locator Route At R1", status: "healthy" },
    { label: "R3 Ordinary IPv6 Reachability", status: "healthy" },
    { label: "SRH Format Valid", status: "healthy" },
    { label: "Packet Arrives At R3", status: state.troubleshooting.started ? "healthy" : "unknown" },
    { label: "R3 Locator Advertised", status: "healthy" },
    { label: "R3 Local SID Entry", status: state.fault ? "failing" : state.troubleshooting.correctVerified ? "healthy" : "unknown" },
    { label: "End Behavior Binding", status: state.fault ? "failing" : state.troubleshooting.correctVerified ? "healthy" : "unknown" },
    { label: "Segment Advancement", status: state.fault ? "failing" : state.troubleshooting.correctVerified ? "healthy" : "unknown" },
    { label: "R6 Forwarding", status: state.fault ? "failing" : state.troubleshooting.correctVerified ? "healthy" : "unknown" },
  ];

  // --- read-only segment-program lab preview ---
  const labPath = useMemo(() => computeSrv6PacketPath(labOrder, state.links), [labOrder, state.links]);
  const LAB_PRESETS: { label: string; order: RouterId[] }[] = [
    { label: "Shortest To R6", order: ["R6"] },
    { label: "Via R3", order: ["R3", "R6"] },
    { label: "Via R3, R5", order: ["R3", "R5", "R6"] },
  ];

  // --- 3D derived state ---
  const nodes3DBase = useMemo(() => layoutTo3D(nodes), [nodes]);
  const visitedRouters = new Set(state.journey.map((h) => h.router));
  const nodes3D = nodes3DBase.map((n) => {
    let status: Node3DStatus = "idle";
    if (n.id === selectedNodeId || n.id === enteredDeviceId) status = "selected";
    else if (activePacket && (n.id === activePacket.from || n.id === activePacket.to)) status = "active";
    else if (visitedRouters.has(n.id as RouterId)) status = "onPath";
    const badges = n.id === "R1" ? ["HEADEND"] : n.id === "R6" ? ["DEST"] : SID_OWNER_ROUTERS.includes(n.id as RouterId) ? ["LOCAL SID"] : undefined;
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
  const nodeExplanation = explainTargetId ? explainNode(state, explainTargetId, currentStep?.id ?? "") : undefined;
  const xrayPacket = activePacket && (selectedNodeId === activePacket.from || selectedNodeId === activePacket.to) ? activePacket : undefined;
  const selectedLinkDetail = selectedLinkId ? linkDetailFor(selectedLinkId, state) : undefined;
  const packetCurrentDeviceLabel = effectiveDeviceId ?? state.packetAt ?? activePacket?.from ?? "—";
  const packetDirection = previewPath.length ? previewPath.join(" → ") : "—";
  const devicePacketForTab = xrayPacket ?? (effectiveDeviceId && state.packetAt === effectiveDeviceId ? activePacket : undefined);

  function explorerTabsFor(router: RouterId): DeviceExplorerTab[] {
    if (!nodeExplanation) return [];
    const localSid = state.localSidTable[router];
    const overviewTab: DeviceExplorerTab = {
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
    };
    const hardwareTab: DeviceExplorerTab = { id: "hardware", label: "Hardware", content: <p className="text-xs text-pv-text-muted">Generic stylized {nodeExplanation.deviceType.toLowerCase()} chassis — {deviceInterfaces.length} physical interfaces.</p> };
    const interfacesTab: DeviceExplorerTab = { id: "interfaces", label: "Interfaces", content: <InterfaceListTab interfaces={deviceInterfaces} selectedInterfaceId={selectedInterfaceId} onSelectInterface={setSelectedInterfaceId} /> };
    const fibTab: DeviceExplorerTab = {
      id: "ipv6-fib",
      label: "IPv6 FIB",
      content: (
        <div className="space-y-1.5 pv-mono text-[11px]">
          {buildIpv6Fib(router, state.links, state.locators).map((r) => (
            <div key={r.locatorPrefix} className="flex justify-between gap-3">
              <span className="text-pv-text-faint">{r.locatorPrefix}</span>
              <span className="text-pv-text">next-hop {r.nextHop ?? "(local)"}</span>
            </div>
          ))}
        </div>
      ),
    };
    const locatorTab: DeviceExplorerTab = {
      id: "locator",
      label: "SRv6 Locator",
      content: (
        <div className="space-y-1 pv-mono text-[11px]">
          <p className="text-pv-text-faint">Locator: <span className="text-pv-text">{locatorTextFor(router)}</span></p>
          <p className="text-pv-text-faint">Advertised: <span className="text-pv-success">YES</span></p>
          <p className="text-pv-text-faint">Local SIDs: <span className="text-pv-text">{localSid ? 1 : 0}</span></p>
        </div>
      ),
    };
    const localSidTab: DeviceExplorerTab = {
      id: "local-sid-table",
      label: "Local SID Table",
      content: <LocalSidTableViewer title={`${router} Local SID Table`} rows={localSid ? [{ sid: localSid.sidText, locator: localSid.locatorText, functionText: localSid.functionText, behavior: localSid.behavior, owner: localSid.owner, state: "ACTIVE", parameters: localSid.parameters }] : []} />,
    };
    const sidStructureTab: DeviceExplorerTab = {
      id: "sid-structure",
      label: "SID Structure",
      content: localSid ? (
        <Srv6SidStructureViewer sid={localSid.sidText} locatorLength={LOCATOR_LENGTH} functionLength={FUNCTION_LENGTH} argumentLength={ARGUMENT_LENGTH} locator={localSid.locatorText} functionText={localSid.functionText} behavior={localSid.behavior} owner={localSid.owner} />
      ) : (
        <p className="text-xs text-pv-text-faint">No local SID instantiated at this router.</p>
      ),
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
    const cliTab: DeviceExplorerTab = { id: "cli", label: "CLI", content: <CLIOutputPanel commands={buildSrv6CliCommands(state, router)} /> };

    if (router === "R1") return [overviewTab, hardwareTab, interfacesTab, fibTab, locatorTab, packetTab, cliTab];
    if (SID_OWNER_ROUTERS.includes(router)) return [overviewTab, hardwareTab, interfacesTab, fibTab, locatorTab, localSidTab, sidStructureTab, packetTab, cliTab];
    return [overviewTab, hardwareTab, interfacesTab, fibTab, locatorTab, packetTab, cliTab];
  }

  useEffect(() => {
    if (isComplete) {
      completeLesson("srv6-foundations", 650);
      unlockAchievement("srv6-programmer");
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
    setCameraMode("overview");
    setEnteredDeviceId(undefined);
    setSelectedNodeId(undefined);
    setSelectedLinkId(undefined);
    setPacketSelected(false);
    setTopoView("physical");
    setLabOrder(["R6"]);
  };

  const nextLabel = currentStep?.question && !lastAnswer ? "Answer to continue" : currentStep?.requiresState && !canAdvance ? "Apply the correct fix to continue" : "Next Step →";

  return (
    <div className="mx-auto max-w-7xl px-6 py-10">
      <div className="mb-6">
        <Badge tone="cyan" className="mb-3">
          SRv6 FOUNDATIONS · IPv6 SID · LOCATOR · FUNCTION · LOCAL SID TABLE · SRH · END
        </Badge>
        <h1 className="text-2xl font-semibold text-pv-text sm:text-3xl">Segment Routing, Directly In The IPv6 Data Plane</h1>
        <p className="mt-2 max-w-3xl text-sm text-pv-text-muted">
          A 128-bit IPv6 SID, a routable locator, a per-node behavior binding, and a Segment Routing Header when more than one segment is
          needed — no MPLS label stack anywhere underneath.
        </p>
      </div>

      <div className="mb-4 grid gap-2 sm:grid-cols-4">
        {WHY_SRV6.map((item) => (
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
        {srv6Steps.map((step, i) => (
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
            { value: "ipv6", label: "IPv6 Underlay" },
            { value: "srv6", label: "SRv6 Program" },
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
              <GraphTopologyViewer nodes={displayNodes} edges={edges} activeNodeIds={activeNodeIds} bestPathEdgeIds={bestPathEdgeIds} onEdgeClick={(id) => setSelectedLinkId(id)}>
                {activePacket && packetFrom && packetTo && <GraphPacket packet={activePacket} from={packetFrom} to={packetTo} />}
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

          {showSidStructure && !isComplete && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Srv6SidStructureViewer title="R3 End SID" sid={endSidText("R3")} locatorLength={LOCATOR_LENGTH} functionLength={FUNCTION_LENGTH} argumentLength={ARGUMENT_LENGTH} locator={locatorTextFor("R3")} functionText={functionHexText(END_FUNCTION)} behavior="End" owner="R3" />
              <Srv6SidStructureViewer title="R6 End SID" sid={endSidText("R6")} locatorLength={LOCATOR_LENGTH} functionLength={FUNCTION_LENGTH} argumentLength={ARGUMENT_LENGTH} locator={locatorTextFor("R6")} functionText={functionHexText(END_FUNCTION)} behavior="End" owner="R6" />
            </div>
          )}

          {showLocatorVsSidVisual && (
            <GlassPanel className="p-5">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-pv-border p-3 text-xs">
                  <p className="mb-1 font-semibold uppercase tracking-wide text-pv-text-faint">Locator Route</p>
                  <p className="text-pv-text-muted">&quot;How do I reach R3?&quot;</p>
                </div>
                <div className="rounded-lg border border-pv-cyan/40 bg-pv-cyan/5 p-3 text-xs">
                  <p className="mb-1 font-semibold uppercase tracking-wide text-pv-cyan-soft">Local SID Entry</p>
                  <p className="text-pv-text-muted">&quot;What does R3 DO when this exact SID becomes active?&quot;</p>
                </div>
              </div>
            </GlassPanel>
          )}

          {showLocalSidTable && !isComplete && <LocalSidTableViewer rows={localSidRows} />}

          {showSrh && !isComplete && <SegmentRoutingHeaderViewer activeDa={fmtIpv6(state.packet!.daHextets)} srh={state.packet!.srh ? { ...state.packet!.srh, segmentList: srhSegmentRows! } : undefined} />}

          {showLab && !isComplete && (
            <GlassPanel strong className="space-y-3 p-5">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-pv-violet">Segment-Program Lab</h3>
              <p className="text-[11px] text-pv-text-muted">Read-only: preview computed against real IGP/Local SID Table state, nothing here mutates the lesson.</p>
              <div className="flex flex-wrap gap-2">
                {LAB_PRESETS.map((p) => (
                  <button
                    key={p.label}
                    type="button"
                    onClick={() => setLabOrder(p.order)}
                    className={clsx("rounded-full border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide transition-colors", JSON.stringify(labOrder) === JSON.stringify(p.order) ? "border-pv-cyan/50 bg-pv-cyan/15 text-pv-cyan-soft" : "border-pv-border text-pv-text-faint hover:text-pv-text")}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <div className="rounded-lg border border-pv-border p-3 text-xs">
                <p className="mb-1 pv-mono text-pv-text">
                  High-level program: &lt;{labOrder.join(", ")}&gt;
                </p>
                <p className="mb-1 font-semibold text-pv-text">Previewed physical path</p>
                <p className="pv-mono text-pv-cyan-soft">{labPath.join(" → ")}</p>
              </div>
            </GlassPanel>
          )}

          {showServicePreview && (
            <GlassPanel className="overflow-x-auto p-4">
              <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-pv-text-muted">Endpoint Behavior Preview</h4>
              <table className="w-full pv-mono text-[11px]">
                <thead>
                  <tr className="text-left text-[9px] uppercase tracking-wide text-pv-text-faint">
                    <th className="pb-1.5 pr-3">Behavior</th>
                    <th className="pb-1.5 pr-3">Meaning</th>
                    <th className="pb-1.5">Status</th>
                  </tr>
                </thead>
                <tbody className="[&>tr]:border-t [&>tr]:border-pv-border">
                  {SERVICE_BEHAVIOR_PREVIEW.map((row) => (
                    <tr key={row.behavior}>
                      <td className="py-1.5 pr-3 font-semibold text-pv-text">{row.behavior}</td>
                      <td className="py-1.5 pr-3 text-pv-text-muted">{row.meaning}</td>
                      <td className="py-1.5">
                        <Badge tone={row.status === "Taught in this lesson" ? "success" : "muted"}>{row.status}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </GlassPanel>
          )}

          {showArchComparison && (
            <GlassPanel className="overflow-x-auto p-4">
              <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-pv-text-muted">SR-MPLS vs. SRv6</h4>
              <table className="w-full min-w-[600px] pv-mono text-[11px]">
                <thead>
                  <tr className="text-left text-[9px] uppercase tracking-wide text-pv-text-faint">
                    <th className="pb-1.5 pr-3">Property</th>
                    <th className="pb-1.5 pr-3">SR-MPLS</th>
                    <th className="pb-1.5">SRv6</th>
                  </tr>
                </thead>
                <tbody className="[&>tr]:border-t [&>tr]:border-pv-border">
                  {ARCH_COMPARISON.map((row) => (
                    <tr key={row.property}>
                      <td className="py-1.5 pr-3 text-pv-text-faint">{row.property}</td>
                      <td className="py-1.5 pr-3 text-pv-text-muted">{row.srMpls}</td>
                      <td className="py-1.5 text-pv-cyan-soft">{row.srv6}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </GlassPanel>
          )}

          {showTroubleshoot && !isComplete && <TroubleshootingLayers title="Diagnostic Ladder" layers={diagnosticLayers} />}

          {showViews && !isComplete && (
            <PlaneSplitPanel
              show={planeView}
              controlTitle="Control Plane — Locators + Local SID Table"
              controlRows={[
                { label: "IGP topology", value: `${state.links.length} links, costs as shown` },
                { label: "Locators advertised", value: String(state.locators.length) },
                { label: "Local SIDs instantiated", value: String(Object.values(state.localSidTable).filter(Boolean).length) },
              ]}
              dataTitle="Data Plane — Current IPv6 Packet"
              dataRows={
                state.packet
                  ? [
                      { label: "Location", value: state.packetAt ?? "—" },
                      { label: "Active segment (DA)", value: fmtIpv6(state.packet.daHextets) },
                      { label: "Segments Left", value: state.packet.srh ? String(state.packet.srh.segmentsLeft) : "(no SRH)" },
                    ]
                  : [{ label: "Packet", value: "none in flight" }]
              }
            />
          )}

          {isComplete && (
            <GlassPanel strong glow="success" className="flex flex-col items-center gap-4 p-10 text-center">
              <Badge tone="success">SRv6 Programmer</Badge>
              <h2 className="text-2xl font-semibold text-pv-text">You Programmed The IPv6 Path</h2>
              <p className="max-w-md text-sm text-pv-text-muted">
                You read a Local SID Table, decomposed a SID into LOC:FUNCT:ARG, built a correct full SRH with reversed storage order, traced
                a real End execution end to end, and repaired a missing local SID binding. +650 XP awarded.
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

          {showLocalSidTable && (
            <GlassPanel className="p-3">
              <h4 className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-pv-text-faint">{focusRouter}&apos;s IPv6 FIB</h4>
              <div className="space-y-1 pv-mono text-[10px]">
                {ipv6Fib.map((r) => (
                  <div key={r.locatorPrefix} className="flex justify-between gap-2">
                    <span className="text-pv-text-faint">{r.locatorPrefix}</span>
                    <span className="text-pv-text">→ {r.nextHop ?? "local"}</span>
                  </div>
                ))}
              </div>
            </GlassPanel>
          )}

          <PacketJourneyTimeline hops={state.journey} />
          <CLIOutputPanel commands={cliCommands} />
        </div>
      </div>
    </div>
  );
}

function linkIdsOnPath(path: RouterId[], links: Srv6State["links"]): string[] {
  const ids: string[] = [];
  for (let i = 0; i < path.length - 1; i++) {
    const l = links.find((x) => (x.a === path[i] && x.b === path[i + 1]) || (x.b === path[i] && x.a === path[i + 1]));
    if (l) ids.push(l.id);
  }
  return ids;
}

function RepairChallenge({ options, attempt, onTry }: { options: { id: string; label: string }[]; attempt?: { choice: string; correct: boolean }; onTry: (choice: string) => void }) {
  return (
    <GlassPanel strong className="p-5">
      <p className="mb-3 text-sm font-medium text-pv-text">Choose the correct repair to restore the &lt;R3, R6&gt; segment program:</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((opt) => {
          const isSelected = attempt?.choice === opt.id;
          const isCorrect = opt.id === "restore-local-sid";
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
            <span className="font-semibold">✓ R3&apos;s Local SID Table entry restored: End SID, behavior End.</span>
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
