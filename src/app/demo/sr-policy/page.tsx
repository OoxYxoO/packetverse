"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { clsx } from "clsx";
import { useScenarioEngine } from "@/lib/sim-engine/useScenarioEngine";
import {
  BSID,
  DYNAMIC_CANDIDATE,
  EXPLICIT_CANDIDATE,
  GRAPH_EDGES,
  GRAPH_NODES,
  LINKS,
  POLICY_COLOR,
  POLICY_COLOR_NAME,
  STEP_IDX,
  TERMS,
  activeCandidateEvaluation,
  buildSidDatabase,
  buildSrPolicyCliCommands,
  candidateEvaluations,
  computeIgpPath,
  createSrPolicyState,
  evaluateCandidate,
  fmtLabel,
  policyState,
  srPolicySteps,
  type Affinity,
  type CandidateDef,
  type RouterId,
  type SrPolicyState,
} from "@/lib/sim-engine/scenarios/srPolicy";
import { GraphTopologyViewer, type GraphEdge } from "@/components/network/GraphTopologyViewer";
import { GraphPacket } from "@/components/network/GraphPacket";
import { PacketInspector } from "@/components/network/PacketInspector";
import { ForwardingDecisionCard } from "@/components/protocol/ForwardingDecisionCard";
import { PacketJourneyTimeline } from "@/components/protocol/PacketJourneyTimeline";
import { PlaneSplitPanel } from "@/components/protocol/PlaneSplitPanel";
import { PolicyViewer, type PolicyCandidateRow } from "@/components/protocol/PolicyViewer";
import { SidTableViewer } from "@/components/protocol/SidTableViewer";
import { SegmentListViewer, type SegmentListRow } from "@/components/protocol/SegmentListViewer";
import { ConstraintEvaluationViewer } from "@/components/protocol/ConstraintEvaluationViewer";
import { RouteEvolutionViewer } from "@/components/protocol/RouteEvolutionViewer";
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
type TopoView = "physical" | "igp" | "policy";

const WHY_POLICY: { q: string; a: string }[] = [
  { q: "WHAT IS SR POLICY?", a: "Traffic-engineering intent — <Headend, Color, Endpoint> — with candidate paths, preference, and fallback behavior." },
  { q: "WHY NOT JUST A LABEL STACK?", a: "A policy has to decide WHICH segment list applies right now, among multiple candidates, and react when one stops being valid." },
  { q: "DOES A POLICY FORCE ALL TRAFFIC?", a: "No — a policy can be UP while traffic keeps using ordinary IGP, until something steers it in." },
  { q: "IS THIS TI-LFA?", a: "No — candidate fallback is headend policy re-selection, not a local precomputed repair near a failure." },
];

const REPAIR_OPTIONS = [
  { id: "change-r6-sid", label: "Change the R6 Node SID" },
  { id: "increase-igp-cost", label: "Increase the IGP cost of the top path" },
  { id: "restart-mpls", label: "Restart MPLS" },
  { id: "restore-explicit-preference", label: "Restore GOLD-EXPLICIT preference to 200" },
];
const WRONG_FEEDBACK: Record<string, string> = {
  "change-r6-sid": "R6 SID resolution is healthy — this incident has nothing to do with the endpoint's Node SID.",
  "increase-igp-cost": "Candidate selection is determined by policy preference among valid candidates, not IGP cost. The wrong candidate is being selected before its segment list is even installed.",
  "restart-mpls": "MPLS forwarding is healthy — packets are being delivered, just via the wrong candidate.",
};

function affinityCandidateDef(base: CandidateDef, affinity: Affinity | "NONE"): CandidateDef {
  return { ...base, requiredAffinity: affinity === "NONE" ? undefined : affinity };
}

export default function SrPolicyDemo() {
  const { engine, snapshot } = useScenarioEngine<SrPolicyState>(createSrPolicyState(), srPolicySteps);
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
  const [labExplicitPref, setLabExplicitPref] = useState(200);
  const [labDynamicPref, setLabDynamicPref] = useState(100);
  const [labAffinity, setLabAffinity] = useState<Affinity | "NONE">("GOLD");
  const completeLesson = useProgressStore((s) => s.completeLesson);
  const recordAnswer = useProgressStore((s) => s.recordAnswer);
  const unlockAchievement = useProgressStore((s) => s.unlockAchievement);

  const { state, currentStep, index, totalSteps, isComplete, lastAnswer, whatChanged, activePacket } = snapshot;
  const canAdvance = engine.canAdvance();

  const nodes = useMemo(() => GRAPH_NODES.map((n) => ({ ...n, kind: (n.id === "R1" || n.id === "R6" ? "pe-router" : "p-router") as "pe-router" | "p-router" })), []);
  const evals = candidateEvaluations(state);
  const active = activeCandidateEvaluation(state);
  const pState = policyState(state);
  const journeyPath = state.journey.map((h) => h.router);
  const previewPath = journeyPath.length > 0 ? journeyPath : active ? computePathFromSegments(active.segmentList.map((s) => s.target)) : [];
  const bestPathEdgeIds = linkIdsOnPath(previewPath.length ? previewPath : ["R1"], state.links);

  const displayNodes = nodes.map((n) => {
    if (topoView === "policy" && (n.id === "R1" || n.id === "R6")) return { ...n, subLabel: n.id === "R1" ? "Headend" : "Endpoint" };
    return n;
  });
  const edges: GraphEdge[] = GRAPH_EDGES.map((e) => {
    const isUp = state.links.some((l) => l.id === e.id);
    return { ...e, state: isUp ? ("full" as const) : ("down" as const), cost: topoView === "igp" ? staticLinkMetric(e.id) : undefined };
  });
  const activeNodeIds = activePacket ? [activePacket.from, activePacket.to] : [];
  const packetFrom = activePacket ? nodes.find((n) => n.id === activePacket.from) : undefined;
  const packetTo = activePacket ? nodes.find((n) => n.id === activePacket.to) : undefined;

  const showTerms = index >= STEP_IDX.policyIdentity;
  const showPolicyViewer = index >= STEP_IDX.explicitCandidateValidation && state.candidates.length > 0;
  const showSegmentList = index >= STEP_IDX.teAttributes && !!active;
  const showViews = index >= STEP_IDX.viewsIntro;
  const showLab = index >= STEP_IDX.policyLabIntro && index < STEP_IDX.troubleshootingIntro;
  const showTroubleshoot = index >= STEP_IDX.troubleshootingIntro;
  const showTeConstraint = index === STEP_IDX.teAttributes + 1 || index === STEP_IDX.teAttributes + 2;
  const showRouteEvolution = index > 0 && srPolicySteps[index]?.id === "preference-switch";

  const sidDatabase = useMemo(() => buildSidDatabase(state.links, "R1"), [state.links]);
  const cliCommands = useMemo(() => buildSrPolicyCliCommands(state, focusRouter), [state, focusRouter]);
  const lastHop = state.journey[state.journey.length - 1];

  const candidateRows: PolicyCandidateRow[] = evals.map((e) => ({
    id: e.def.id,
    name: e.def.name,
    type: e.def.type,
    preference: e.def.preference,
    valid: e.valid,
    reason: e.reason,
    segmentSummary: e.segmentList.length ? e.segmentList.map((s) => `${s.type} ${s.sid}`).join(" → ") : "(no segment list)",
    active: active?.def.id === e.def.id,
  }));
  const activeSegmentRows: SegmentListRow[] = (active?.segmentList ?? []).map((s) => ({
    order: s.order,
    sid: s.sid,
    type: s.type,
    owner: s.owner,
    target: s.target,
    scope: s.scope,
    active: s.active,
    completed: s.completed,
    explanation: s.explanation,
  }));

  const diagnosticLayers: DiagnosticLayer[] = [
    { label: "Physical Topology", status: "healthy" },
    { label: "IGP", status: "healthy" },
    { label: "SR Capability", status: "healthy" },
    { label: "SID Database", status: "healthy" },
    { label: "Endpoint R6", status: "healthy" },
    { label: "Policy Exists", status: state.policyConfigured ? "healthy" : "unknown" },
    { label: "Policy State", status: pState === "UP" ? "healthy" : "unknown" },
    { label: "Explicit Candidate Validity", status: evals.find((e) => e.def.type === "EXPLICIT")?.valid ? "healthy" : "unknown" },
    { label: "Dynamic Candidate Validity", status: evals.find((e) => e.def.type === "DYNAMIC")?.valid ? "healthy" : "unknown" },
    { label: "Candidate Preference", status: state.troubleshooting.started && !state.troubleshooting.verified ? "failing" : "unknown" },
    { label: "Expected Active Candidate", status: state.troubleshooting.started && !state.troubleshooting.verified ? "failing" : "unknown" },
    { label: "Segment Forwarding", status: "healthy" },
    { label: "Endpoint Delivery", status: "healthy" },
  ];

  // --- read-only SR Policy lab preview (computed, not engine-mutating) ---
  const labExplicit = useMemo(() => evaluateCandidate({ ...EXPLICIT_CANDIDATE, preference: labExplicitPref }, state.links, "R1", "R6"), [labExplicitPref, state.links]);
  const labDynamic = useMemo(() => evaluateCandidate(affinityCandidateDef({ ...DYNAMIC_CANDIDATE, preference: labDynamicPref }, labAffinity), state.links, "R1", "R6"), [labDynamicPref, labAffinity, state.links]);
  const labActive = useMemo(() => {
    const vs = [labExplicit, labDynamic].filter((e) => e.valid);
    return vs.length ? vs.reduce((best, e) => (e.def.preference > best.def.preference ? e : best)) : undefined;
  }, [labExplicit, labDynamic]);

  // --- TE constraint evaluation preview (for the constraint-viewer step) ---
  const teConstraintRows = useMemo(
    () =>
      state.links.map((l) => ({
        id: l.id,
        label: l.id,
        columns: [
          { label: "Affinity", value: l.affinities.join(", ") },
          { label: "Metric", value: String(l.metric) },
        ],
        pass: l.affinities.includes("GOLD"),
        reason: l.affinities.includes("GOLD") ? "Matches INCLUDE GOLD" : "Excluded — no GOLD affinity",
      })),
    [state.links],
  );
  const goldPath = useMemo(() => computeIgpPath(state.links.filter((l) => l.affinities.includes("GOLD")), "R1", "R6"), [state.links]);

  // --- 3D derived state ---
  const nodes3DBase = useMemo(() => layoutTo3D(nodes), [nodes]);
  const visitedRouters = new Set(state.journey.map((h) => h.router));
  const nodes3D = nodes3DBase.map((n) => {
    let status: Node3DStatus = "idle";
    if (n.id === selectedNodeId || n.id === enteredDeviceId) status = "selected";
    else if (activePacket && (n.id === activePacket.from || n.id === activePacket.to)) status = "active";
    else if (visitedRouters.has(n.id as RouterId)) status = "onPath";
    const badges = n.id === "R1" ? ["HEADEND"] : n.id === "R6" ? ["ENDPOINT"] : n.id === "R3" ? ["OWNS ADJ-SID"] : undefined;
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
  const nodeExplanation = explainTargetId ? explainNode(state, explainTargetId) : undefined;
  const xrayPacket = activePacket && (selectedNodeId === activePacket.from || selectedNodeId === activePacket.to) ? activePacket : undefined;
  const selectedLinkDetail = selectedLinkId ? linkDetailFor(selectedLinkId, state) : undefined;
  const packetCurrentDeviceLabel = effectiveDeviceId ?? state.packetAt ?? activePacket?.from ?? "—";
  const packetDirection = previewPath.length ? previewPath.join(" → ") : "—";
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
          {state.links.filter((l) => l.a === router || l.b === router).map((l) => (
            <div key={l.id} className="flex justify-between">
              <span className="text-pv-text-faint">{l.id}</span>
              <span className="text-pv-text">metric {l.metric}</span>
            </div>
          ))}
        </div>
      ),
    };
    const teTab: DeviceExplorerTab = {
      id: "te",
      label: "TE Database",
      content: (
        <div className="space-y-1.5 pv-mono text-[11px]">
          {LINKS.filter((l) => l.a === router || l.b === router).map((l) => (
            <div key={l.id} className="flex justify-between">
              <span className="text-pv-text-faint">{l.id}</span>
              <span className="text-pv-text">{l.affinities.join(", ")} · metric {l.metric}</span>
            </div>
          ))}
        </div>
      ),
    };
    const srgbTab: DeviceExplorerTab = {
      id: "srgb",
      label: "SRGB",
      content: (
        <div className="space-y-1 pv-mono text-[11px]">
          <Row label="Range" value="16000-23999" />
          <Row label="Router" value={router} />
          <Row label="Node SID Index" value={String(sidDatabase.find((r) => r.router === router)?.sidIndex ?? "—")} />
          <Row label="Derived Label" value={String(sidDatabase.find((r) => r.router === router)?.localLabel ?? "—")} />
        </div>
      ),
    };
    const sidDbTab: DeviceExplorerTab = { id: "sid-db", label: "SID Database", content: <SidTableViewer rows={buildSidDatabase(state.links, router)} /> };
    const policiesTab: DeviceExplorerTab = {
      id: "policies",
      label: "SR Policies",
      content: state.policyConfigured ? (
        <div className="space-y-0.5 pv-mono text-[11px]">
          <Row label="Policy Key" value={`<R1,${POLICY_COLOR},R6>`} />
          <Row label="Color" value={`${POLICY_COLOR} (${POLICY_COLOR_NAME})`} />
          <Row label="Endpoint" value="10.0.0.6" />
          <Row label="Policy State" value={pState} />
          <Row label="BSID" value={String(BSID)} />
          <Row label="Active Candidate" value={active?.def.name ?? "—"} />
          <Row label="Candidate Count" value={String(evals.length)} />
        </div>
      ) : (
        <p className="text-xs text-pv-text-faint">No policy configured yet.</p>
      ),
    };
    const candidatesTab: DeviceExplorerTab = {
      id: "candidates",
      label: "Candidate Paths",
      content: (
        <div className="space-y-2">
          {evals.map((e) => (
            <div key={e.def.id} className="rounded border border-pv-border p-2 pv-mono text-[11px]">
              <Row label="Name" value={e.def.name} />
              <Row label="Type" value={e.def.type} />
              <Row label="Preference" value={String(e.def.preference)} />
              <Row label="Validity" value={e.valid ? "VALID" : "INVALID"} />
              <Row label="Validity Reason" value={e.reason} />
              <Row label="Segment List" value={e.segmentList.length ? e.segmentList.map((s) => s.sid).join(" / ") : "(none)"} />
              <Row label="Constraints" value={e.def.type === "DYNAMIC" ? `INCLUDE ${e.def.requiredAffinity ?? "NONE"}` : "explicit (operator-specified)"} />
              <Row label="Active/Standby" value={active?.def.id === e.def.id ? "ACTIVE" : e.valid ? "STANDBY" : "—"} />
            </div>
          ))}
        </div>
      ),
    };
    const segListTab: DeviceExplorerTab = { id: "segment-list", label: "Segment List", content: active ? <SegmentListViewer title={`${active.def.name} (active)`} segments={activeSegmentRows} /> : <p className="text-xs text-pv-text-faint">No active candidate.</p> };
    const bsidTab: DeviceExplorerTab = {
      id: "bsid",
      label: "Binding SID",
      content: (
        <div className="space-y-0.5 pv-mono text-[11px]">
          <Row label="BSID" value={String(BSID)} />
          <Row label="Owner" value="R1" />
          <Row label="Scope" value="LOCAL" />
          <Row label="Bound Policy" value={`<R1,${POLICY_COLOR},R6>`} />
          <Row label="Active Candidate" value={active?.def.name ?? "—"} />
          <Row label="Resolved Segment List" value={active ? active.segmentList.map((s) => s.sid).join(" / ") : "—"} />
        </div>
      ),
    };
    const steeringTab: DeviceExplorerTab = {
      id: "steering",
      label: "Steering",
      content: (
        <div className="space-y-2 pv-mono text-[11px]">
          <div className="rounded border border-pv-border p-2">
            <Row label="Flow" value="DEFAULT" />
            <Row label="Classification" value="unmatched" />
            <Row label="Intent/Color" value="none" />
            <Row label="Selected Policy" value="none — IGP forwarding" />
          </div>
          <div className="rounded border border-pv-border p-2">
            <Row label="Flow" value="GOLD" />
            <Row label="Classification" value={`Color ${POLICY_COLOR}`} />
            <Row label="Selected Policy" value={`<R1,${POLICY_COLOR},R6>`} />
            <Row label="Policy State" value={pState} />
            <Row label="Result" value={pState === "UP" ? `Steered via ${active?.def.name}` : "FAILED — strict, no IGP fallback"} />
          </div>
        </div>
      ),
    };
    const forwardingTab: DeviceExplorerTab = {
      id: "forwarding",
      label: "MPLS Forwarding",
      content: nodeExplanation.tables?.[0] ? (
        <div className="space-y-0.5 pv-mono text-[11px]">
          {nodeExplanation.tables[0].rows.map((r) => (
            <Row key={r.label} label={r.label} value={r.value} />
          ))}
        </div>
      ) : (
        <p className="text-xs text-pv-text-faint">No forwarding entry for this router right now.</p>
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
    const cliTab: DeviceExplorerTab = { id: "cli", label: "CLI", content: <CLIOutputPanel commands={buildSrPolicyCliCommands(state, router)} /> };

    if (router === "R1") return [overviewTab, hardwareTab, interfacesTab, igpTab, teTab, srgbTab, sidDbTab, policiesTab, candidatesTab, segListTab, bsidTab, steeringTab, forwardingTab, packetTab, cliTab];
    if (router === "R3") return [overviewTab, hardwareTab, interfacesTab, sidDbTab, forwardingTab, packetTab, cliTab];
    return [overviewTab, hardwareTab, interfacesTab, forwardingTab, packetTab, cliTab];
  }

  useEffect(() => {
    if (isComplete) {
      completeLesson("sr-policy", 550);
      unlockAchievement("policy-architect");
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
    setLabExplicitPref(200);
    setLabDynamicPref(100);
    setLabAffinity("GOLD");
  };

  const nextLabel = currentStep?.question && !lastAnswer ? "Answer to continue" : currentStep?.requiresState && !canAdvance ? "Apply the correct fix to continue" : "Next Step →";

  return (
    <div className="mx-auto max-w-7xl px-6 py-10">
      <div className="mb-6">
        <Badge tone="cyan" className="mb-3">
          SR TRAFFIC ENGINEERING · SR POLICY · CANDIDATE PATHS · BSID
        </Badge>
        <h1 className="text-2xl font-semibold text-pv-text sm:text-3xl">From Individual SIDs To An Operational Policy</h1>
        <p className="mt-2 max-w-3xl text-sm text-pv-text-muted">
          A policy is intent — headend, color, endpoint. A candidate path is one way to realize that intent. The highest-preference
          valid candidate becomes active, resolves a segment list, and only traffic actually steered into the policy ever uses it.
        </p>
      </div>

      <div className="mb-4 grid gap-2 sm:grid-cols-4">
        {WHY_POLICY.map((item) => (
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
        {srPolicySteps.map((step, i) => (
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
            { value: "policy", label: "SR Policy" },
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

          {showTeConstraint && !isComplete && (
            <ConstraintEvaluationViewer
              title="TE Constraint Evaluation — INCLUDE GOLD"
              constraintSummary="Prune every link without the GOLD affinity, then take the shortest remaining path."
              candidates={teConstraintRows}
              resultLabel="Shortest Valid TE Path"
              resultValue={goldPath ? `${goldPath.path.join(" → ")} (cost ${goldPath.cost})` : "none"}
              resultPass={!!goldPath}
            />
          )}

          {showRouteEvolution && !isComplete && (
            <RouteEvolutionViewer
              title="Active Candidate Switch"
              oldLabel="BEFORE"
              newLabel="AFTER"
              fields={[
                { label: "Active Candidate", oldValue: "GOLD-EXPLICIT", newValue: "GOLD-DYNAMIC", decisive: false },
                { label: "GOLD-EXPLICIT Preference", oldValue: "200", newValue: "50", decisive: true },
                { label: "GOLD-DYNAMIC Preference", oldValue: "100", newValue: "100", decisive: false },
              ]}
              winnerReason="GOLD-DYNAMIC (100) now beats GOLD-EXPLICIT (50) — policy identity did not change, only the active candidate."
            />
          )}

          {showTerms && !isComplete && <SidTableViewer rows={sidDatabase} />}

          {showPolicyViewer && !isComplete && (
            <PolicyViewer
              policyKey={`<R1,${POLICY_COLOR},R6>`}
              headend="R1"
              color={POLICY_COLOR}
              colorLabel={POLICY_COLOR_NAME}
              endpoint="10.0.0.6"
              state={pState}
              bindingSid={index >= STEP_IDX.bsidIntro ? BSID : undefined}
              activeCandidateName={active?.def.name}
              steeringState={state.flow ? `${state.flow} flow` : undefined}
              candidates={candidateRows}
            />
          )}

          {showSegmentList && !isComplete && <SegmentListViewer title={`Segment List — ${active!.def.name} (active)`} segments={activeSegmentRows} />}

          {showLab && !isComplete && (
            <GlassPanel strong className="space-y-4 p-5">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-pv-violet">SR Policy Lab</h3>
              <p className="text-[11px] text-pv-text-muted">Read-only preview: computed against real domain functions, nothing here mutates the lesson.</p>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block text-xs">
                  <span className="mb-1 block text-pv-text-faint">GOLD-EXPLICIT preference</span>
                  <input type="range" min={0} max={250} value={labExplicitPref} onChange={(e) => setLabExplicitPref(Number(e.target.value))} className="w-full" />
                  <span className="pv-mono text-pv-cyan-soft">{labExplicitPref}</span>
                </label>
                <label className="block text-xs">
                  <span className="mb-1 block text-pv-text-faint">GOLD-DYNAMIC preference</span>
                  <input type="range" min={0} max={250} value={labDynamicPref} onChange={(e) => setLabDynamicPref(Number(e.target.value))} className="w-full" />
                  <span className="pv-mono text-pv-cyan-soft">{labDynamicPref}</span>
                </label>
              </div>

              <div>
                <span className="mb-1 block text-xs text-pv-text-faint">Required Affinity (GOLD-DYNAMIC)</span>
                <div className="flex gap-2">
                  {(["GOLD", "NONE"] as const).map((a) => (
                    <button
                      key={a}
                      type="button"
                      onClick={() => setLabAffinity(a)}
                      className={clsx("rounded-full border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide transition-colors", labAffinity === a ? "border-pv-cyan/50 bg-pv-cyan/15 text-pv-cyan-soft" : "border-pv-border text-pv-text-faint hover:text-pv-text")}
                    >
                      {a}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                <LabCandidateCard name="GOLD-EXPLICIT" evalResult={labExplicit} active={labActive?.def.id === labExplicit.def.id} />
                <LabCandidateCard name="GOLD-DYNAMIC" evalResult={labDynamic} active={labActive?.def.id === labDynamic.def.id} />
              </div>
            </GlassPanel>
          )}

          {showTroubleshoot && !isComplete && <TroubleshootingLayers title="Diagnostic Ladder" layers={diagnosticLayers} />}

          {showViews && !isComplete && (
            <PlaneSplitPanel
              show={planeView}
              controlTitle="Control Plane — Policy Identity + Candidates"
              controlRows={[
                { label: "Policy Key", value: state.policyConfigured ? `<R1,${POLICY_COLOR},R6>` : "not configured" },
                { label: "Policy State", value: pState },
                { label: "BSID", value: index >= STEP_IDX.bsidIntro ? String(BSID) : "not allocated" },
                { label: "Active Candidate", value: active?.def.name ?? "—" },
                { label: "Steering", value: state.flow ? `${state.flow} flow` : "none" },
              ]}
              dataTitle="Data Plane — Current MPLS Packet"
              dataRows={
                state.packet
                  ? [
                      { label: "Location", value: state.packetAt ?? "—" },
                      { label: "Labels on wire", value: state.packet.labels.length ? state.packet.labels.map((l) => fmtLabel(l.value)).join(" / ") : "(none)" },
                    ]
                  : [{ label: "Packet", value: "none in flight" }]
              }
            />
          )}

          {isComplete && (
            <GlassPanel strong glow="success" className="flex flex-col items-center gap-4 p-10 text-center">
              <Badge tone="success">Policy Architect</Badge>
              <h2 className="text-2xl font-semibold text-pv-text">You Built The Intent</h2>
              <p className="max-w-md text-sm text-pv-text-muted">
                You built an SR Policy from an explicit candidate and a computed dynamic fallback, understood preference-based
                selection among valid candidates, resolved a Binding SID, and steered GOLD traffic in while DEFAULT traffic kept
                using ordinary IGP. +550 XP awarded.
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

function LabCandidateCard({ name, evalResult, active }: { name: string; evalResult: { valid: boolean; reason: string; def: { preference: number } }; active: boolean }) {
  return (
    <div className={clsx("rounded-lg border p-3 text-xs", active ? "border-pv-success/50 bg-pv-success/5" : "border-pv-border")}>
      <div className="mb-1 flex items-center gap-2">
        <span className="pv-mono font-semibold text-pv-text">{name}</span>
        <Badge tone={evalResult.valid ? "success" : "danger"}>{evalResult.valid ? "VALID" : "INVALID"}</Badge>
        {active && <Badge tone="success">ACTIVE</Badge>}
      </div>
      <p className="pv-mono text-[10px] text-pv-text-faint">pref {evalResult.def.preference}</p>
      <p className="mt-1 text-[11px] text-pv-text-muted">{evalResult.reason}</p>
    </div>
  );
}

function RepairChallenge({ options, attempt, onTry }: { options: { id: string; label: string }[]; attempt?: { choice: string; correct: boolean }; onTry: (choice: string) => void }) {
  return (
    <GlassPanel strong className="p-5">
      <p className="mb-3 text-sm font-medium text-pv-text">Choose the correct repair to restore GOLD-EXPLICIT as the active candidate:</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((opt) => {
          const isSelected = attempt?.choice === opt.id;
          const isCorrect = opt.id === "restore-explicit-preference";
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
            <span className="font-semibold">✓ GOLD-EXPLICIT preference restored to 200.</span>
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

function linkIdsOnPath(path: RouterId[], links: SrPolicyState["links"]): string[] {
  const ids: string[] = [];
  for (let i = 0; i < path.length - 1; i++) {
    const l = links.find((x) => (x.a === path[i] && x.b === path[i + 1]) || (x.b === path[i] && x.a === path[i + 1]));
    if (l) ids.push(l.id);
  }
  return ids;
}

function computePathFromSegments(targets: RouterId[]): RouterId[] {
  return ["R1", ...targets];
}

/** Static metrics/affinities never change even while a link is administratively "down" (removed from state.links) — reads from the full topology so IGP-view cost labels stay visible either way. */
function staticLinkMetric(linkId: string): number | undefined {
  return LINKS.find((l) => l.id === linkId)?.metric;
}
