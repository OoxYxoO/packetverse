"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { clsx } from "clsx";
import { useScenarioEngine } from "@/lib/sim-engine/useScenarioEngine";
import { ARGUMENT_LENGTH, FUNCTION_LENGTH, LOCATOR_LENGTH, fmtIpv6, locatorTextFor } from "@/lib/sim-engine/scenarios/srv6Foundations";
import { BEHAVIOR_LABEL, FUNCTION } from "@/lib/sim-engine/scenarios/srv6EndpointBehaviors";
import {
  BSID_TEXT,
  GRAPH_EDGES,
  GRAPH_NODES,
  POLICY_COLOR,
  PSEUDO_FLOWS,
  STEP_IDX,
  WEIGHTED_LAB_LISTS,
  candidateEvaluationsFor,
  selectActiveCandidate,
  createSrv6PolicyState,
  findLocalSid,
  policyStateFor,
  selectSegmentListForFlow,
  srDatabaseFor,
  srv6PolicySteps,
  type ClientId,
  type NodeId,
  type RouterId,
  type Srv6PolicyState,
} from "@/lib/sim-engine/scenarios/srv6Policy";
import { GraphTopologyViewer, type GraphEdge } from "@/components/network/GraphTopologyViewer";
import { GraphPacket } from "@/components/network/GraphPacket";
import { PacketInspector } from "@/components/network/PacketInspector";
import { ForwardingDecisionCard } from "@/components/protocol/ForwardingDecisionCard";
import { PacketJourneyTimeline } from "@/components/protocol/PacketJourneyTimeline";
import { PlaneSplitPanel } from "@/components/protocol/PlaneSplitPanel";
import { Srv6SidStructureViewer } from "@/components/protocol/Srv6SidStructureViewer";
import { LocalSidTableViewer } from "@/components/protocol/LocalSidTableViewer";
import { PolicyViewer, type PolicyCandidateRow } from "@/components/protocol/PolicyViewer";
import { CandidateSelectionViewer, type CandidateSelectionRow } from "@/components/protocol/CandidateSelectionViewer";
import { Srv6PolicySegmentListViewer, type Srv6PolicySegmentRow } from "@/components/protocol/Srv6PolicySegmentListViewer";
import { SegmentRoutingHeaderViewer } from "@/components/protocol/SegmentRoutingHeaderViewer";
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
import { buildSrv6PolicyCliCommands } from "@/lib/sim-engine/scenarios/srv6Policy";

const ROUTER_IDS: RouterId[] = ["R1", "R2", "R3", "R4", "R5", "R6"];
type TopoView = "physical" | "te" | "policy" | "program";

const WHY_POLICY: { q: string; a: string }[] = [
  { q: "WHAT IS SR POLICY?", a: "The layer that decides WHICH ordered set of SIDs traffic should use, why, and how traffic gets steered onto it." },
  { q: "WHY NOT JUST ROUTE?", a: "Ordinary IPv6 answers \"how do I reach R6?\" Traffic engineering answers \"how do I reach R6 while satisfying a specific intent?\"" },
  { q: "IS COLOR A SID?", a: "No — Color is a policy/intent identifier. It never becomes an SRH field, a Tag, or an address." },
  { q: "SR-MPLS OR SRv6?", a: "Same RFC 9256 policy architecture either way — only the segment representation and headend action differ." },
];

const SR_MPLS_VS_SRV6: { property: string; srMpls: string; srv6: string }[] = [
  { property: "Policy identity", srMpls: "<H,C,E>", srv6: "<H,C,E>" },
  { property: "Candidate selection", srMpls: "RFC 9256", srv6: "RFC 9256" },
  { property: "Preference", srMpls: "Same model", srv6: "Same model" },
  { property: "Segment representation", srMpls: "MPLS labels", srv6: "IPv6 SIDs" },
  { property: "Headend action", srMpls: "Push label stack", srv6: "H.Encaps" },
  { property: "Active segment", srMpls: "Top label", srv6: "IPv6 DA" },
  { property: "Program", srMpls: "Label stack", srv6: "SRH" },
  { property: "Adjacency segment", srMpls: "Adj-SID label", srv6: "End.X SID" },
  { property: "Binding SID", srMpls: "MPLS label", srv6: "IPv6 SID" },
];

const REPAIR_OPTIONS = [
  { id: "raise-preference", label: "Increase CP-EXPLICIT preference from 200 to 500" },
  { id: "change-route", label: "Change R1's route to R6" },
  { id: "edit-srh", label: "Manually edit the current packet's SRH" },
  { id: "reverify-sr-db", label: "Re-verify R3's End.X SID in R1's SR Database" },
];
const WRONG_FEEDBACK: Record<string, string> = {
  "raise-preference": "Invalid candidates never become active because of higher preference, no matter how large the number gets. The problem isn't preference — it's validity.",
  "change-route": "R1's ordinary IPv6 reachability to R6 was never broken — CP-DYNAMIC has been delivering traffic the whole time. This doesn't touch SR Database verification.",
  "edit-srh": "The headend constructs the SRH FROM the active candidate's policy state, every time, from scratch. Hand-editing one packet's SRH doesn't fix the control-plane cause and won't survive the next H.Encaps.",
};

export default function Srv6PolicyDemo() {
  const { engine, snapshot } = useScenarioEngine<Srv6PolicyState>(createSrv6PolicyState(), srv6PolicySteps);
  const [autoPlay, setAutoPlay] = useState(false);
  const [speed, setSpeed] = useState<0.5 | 1 | 2>(1);
  const [topoView, setTopoView] = useState<TopoView>("physical");
  const [viewMode3D, setViewMode3D] = useState(false);
  const [planeView, setPlaneView] = useState<"control" | "data" | "both">("both");
  const [focusRouter, setFocusRouter] = useState<RouterId>("R1");
  const [selectedNodeId, setSelectedNodeId] = useState<NodeId | undefined>(undefined);
  const [cameraMode, setCameraMode] = useState<CameraMode>("overview");
  const [enteredDeviceId, setEnteredDeviceId] = useState<RouterId | undefined>(undefined);
  const [deviceXray, setDeviceXray] = useState(true);
  const [autoEnterDevices, setAutoEnterDevices] = useState(true);
  const [selectedInterfaceId, setSelectedInterfaceId] = useState<string | undefined>(undefined);
  const [selectedLinkId, setSelectedLinkId] = useState<string | undefined>(undefined);
  const [packetSelected, setPacketSelected] = useState(false);
  const [xrayMode, setXrayMode] = useState(true);
  const [labFlow, setLabFlow] = useState<string>(PSEUDO_FLOWS[0]);
  const completeLesson = useProgressStore((s) => s.completeLesson);
  const recordAnswer = useProgressStore((s) => s.recordAnswer);
  const unlockAchievement = useProgressStore((s) => s.unlockAchievement);

  const { state, currentStep, index, totalSteps, isComplete, lastAnswer, whatChanged, activePacket } = snapshot;
  const canAdvance = engine.canAdvance();

  const nodes = useMemo(
    () =>
      GRAPH_NODES.map((n) => ({
        ...n,
        kind: (n.id === "R1" || n.id === "R6" ? "pe-router" : ROUTER_IDS.includes(n.id as RouterId) ? "p-router" : "server") as "pe-router" | "p-router" | "server",
      })),
    [],
  );
  const journeyPath = state.journey.map((h) => h.router);
  const bestPathEdgeIds = linkIdsOnPath(journeyPath);

  const evaluations = candidateEvaluationsFor(state);
  const active = selectActiveCandidate(evaluations);
  const pState = policyStateFor(state);
  const srDb = srDatabaseFor(state);

  const displayNodes = nodes.map((n) => {
    if (topoView === "te") {
      const link = GRAPH_EDGES.find((e) => e.a === n.id || e.b === n.id);
      void link;
      return n;
    }
    if (topoView === "policy" && (n.id === "R1" || n.id === "R6")) return { ...n, subLabel: n.id === "R1" ? `Headend — ${pState}` : "Endpoint" };
    if (topoView === "program" && state.packet && n.id === state.packetAt) return { ...n, subLabel: `DA=${fmtIpv6(state.packet.outer.daHextets)}` };
    return n;
  });
  const edges: GraphEdge[] = GRAPH_EDGES.map((e) => {
    const linkDef = state.links.find((l) => l.id === e.id);
    const wasRemoved = ["R1-R2", "R2-R4", "R4-R6", "R1-R3", "R3-R5", "R5-R6", "R3-R4"].includes(e.id) && !linkDef;
    return { id: e.id, a: e.a, b: e.b, state: wasRemoved ? ("down" as const) : ("full" as const), cost: topoView === "te" ? linkDef?.metric : undefined };
  });
  const activeNodeIds = activePacket ? [activePacket.from, activePacket.to] : [];
  const packetFrom = activePacket ? nodes.find((n) => n.id === activePacket.from) : undefined;
  const packetTo = activePacket ? nodes.find((n) => n.id === activePacket.to) : undefined;

  const showPolicyIdentity = index >= STEP_IDX.policyIdentity;
  const showCandidates = index >= STEP_IDX.explicitCandidateIntro;
  const showBsid = index >= STEP_IDX.bsidIntro && index < STEP_IDX.weightedLabIntro;
  const showWeightedLab = currentStep?.id === "weighted-lab-intro" || currentStep?.id === "weighted-lab-explain";
  const showTroubleshoot = index >= STEP_IDX.troubleshootingIntro && index < STEP_IDX.policyInvalidSetup;
  const showBsidExperiment = index >= STEP_IDX.bsidExperimentSetup && index < STEP_IDX.srMplsComparison;
  const showSrMplsComparison = currentStep?.id === "sr-mpls-comparison";

  const lastHop = state.journey[state.journey.length - 1];

  const candidateRows: PolicyCandidateRow[] = evaluations.map((e) => ({
    id: e.def.id,
    name: e.def.name,
    type: e.def.type,
    preference: e.def.preference,
    valid: e.valid,
    reason: e.reason,
    segmentSummary: e.segments.length ? e.segments.map((s) => `${s.sidText} (${BEHAVIOR_LABEL[s.behavior]})`).join(" → ") : "—",
    active: e === active,
  }));
  const selectionRows: CandidateSelectionRow[] = evaluations.map((e) => ({ id: e.def.id, name: e.def.name, preference: e.def.preference, valid: e.valid, reason: e.reason, active: e === active }));
  const activeSegmentRows: Srv6PolicySegmentRow[] = (active?.segments ?? []).map((s, i) => ({
    ordinal: i,
    sid: s.sidText,
    owner: s.owner,
    behavior: BEHAVIOR_LABEL[s.behavior],
    purpose: s.parameterText,
    verified: srDb.find((e) => e.sidText === s.sidText)?.verified,
  }));

  const cliCommands = useMemo(() => buildSrv6PolicyCliCommands(state), [state]);

  const diagnosticLayers: DiagnosticLayer[] = [
    { label: "R1 Interfaces", status: "healthy" },
    { label: "R3-R5 Adjacency", status: state.links.some((l) => l.id === "R3-R5") ? "healthy" : "failing" },
    { label: "IPv6 IGP", status: "healthy" },
    { label: "R3 Locator Reachable", status: "healthy" },
    { label: "R6 Endpoint Reachable", status: "healthy" },
    { label: `Policy <R1,${POLICY_COLOR},R6>`, status: state.policyConfigured ? "healthy" : "unknown" },
    { label: "CP-EXPLICIT Configured", status: state.candidates.some((c) => c.id === "cp-explicit") ? "healthy" : "unknown" },
    { label: "CP-EXPLICIT Preference 200", status: state.candidates.find((c) => c.id === "cp-explicit")?.preference === 200 ? "healthy" : "unknown" },
    { label: "R3 Local End.X Installed", status: "healthy" },
    { label: "R1 SR-DB Verifies R3 End.X", status: state.srDbR3EndXVerified ? "healthy" : "failing" },
    { label: "Explicit Segment-List Validity", status: evaluations.find((e) => e.def.id === "cp-explicit")?.valid ? "healthy" : "failing" },
    { label: "CP-EXPLICIT Valid", status: evaluations.find((e) => e.def.id === "cp-explicit")?.valid ? "healthy" : "failing" },
    { label: "CP-DYNAMIC Valid", status: evaluations.find((e) => e.def.id === "cp-dynamic")?.valid ? "healthy" : "failing" },
  ];

  const labSelection = useMemo(() => selectSegmentListForFlow(labFlow, WEIGHTED_LAB_LISTS), [labFlow]);
  const labDistribution = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const f of PSEUDO_FLOWS) {
      const sel = selectSegmentListForFlow(f, WEIGHTED_LAB_LISTS);
      if (sel.status === "SELECTED") counts[sel.list.id] = (counts[sel.list.id] ?? 0) + 1;
    }
    return counts;
  }, []);

  // --- 3D derived state ---
  const nodes3DBase = useMemo(() => layoutTo3D(nodes), [nodes]);
  const visitedRouters = new Set(state.journey.map((h) => h.router));
  const nodes3D = nodes3DBase.map((n) => {
    let status: Node3DStatus = "idle";
    if (n.id === selectedNodeId || n.id === enteredDeviceId) status = "selected";
    else if (activePacket && (n.id === activePacket.from || n.id === activePacket.to)) status = "active";
    else if (visitedRouters.has(n.id as NodeId)) status = "onPath";
    const entries = state.localSidTable[n.id as RouterId];
    const badges = n.id === "R1" ? ["HEADEND"] : entries?.length ? [`${entries.length} SID${entries.length > 1 ? "S" : ""}`] : n.id === "CLIENT1" || n.id === "RECEIVER6" ? [n.id as ClientId] : undefined;
    return { ...n, status, badges };
  });
  const linksUp = new Set(state.links.map((l) => l.id));
  const links3D: Link3DData[] = GRAPH_EDGES.map((e) => ({
    id: e.id,
    a: e.a,
    b: e.b,
    active: activePacket ? (e.a === activePacket.from && e.b === activePacket.to) || (e.b === activePacket.from && e.a === activePacket.to) : false,
    onPath: bestPathEdgeIds.includes(e.id) && (linksUp.has(e.id as never) || !["R1-R2", "R2-R4", "R4-R6", "R1-R3", "R3-R5", "R5-R6", "R3-R4"].includes(e.id)),
  }));
  const activePacket3D: ActivePacket3D | undefined = activePacket && nodes3D.some((n) => n.id === activePacket.from) && nodes3D.some((n) => n.id === activePacket.to) ? { packet: activePacket, fromId: activePacket.from, toId: activePacket.to } : undefined;
  const selectedNode3D = nodes3D.find((n) => n.id === selectedNodeId);
  const questionActive = !isComplete && !!currentStep?.question && lastAnswer?.stepId !== currentStep.id;

  const activeDeviceId = ROUTER_IDS.find((r) => traceFor(r, state)?.activeStageId !== undefined);
  const effectiveDeviceId = cameraMode === "device" ? enteredDeviceId : cameraMode === "packetFollow" && autoEnterDevices ? activeDeviceId : undefined;
  const inDeviceMode = !!effectiveDeviceId;
  const deviceTrace = effectiveDeviceId ? traceFor(effectiveDeviceId, state) : undefined;

  const followPacketIntoCurrentDevice = () => {
    if (!packetSelected || cameraMode !== "device") return;
    const snap = engine.getSnapshot();
    const nextDevice = ROUTER_IDS.find((r) => traceFor(r, snap.state)?.activeStageId !== undefined);
    if (nextDevice) setEnteredDeviceId(nextDevice);
  };

  const deviceInterfaces = effectiveDeviceId ? interfacesFor(effectiveDeviceId, state) : [];
  const devicePacketFrames: PacketStackFrame[] | undefined = effectiveDeviceId ? packetFramesFor(state) : undefined;

  const followNode3D = cameraMode === "packetFollow" && activePacket ? nodes3D.find((n) => n.id === (state.packetAt ?? activePacket.to)) : undefined;
  const focusPosition3D: [number, number, number] | undefined =
    cameraMode === "freeOrbit" ? undefined : inDeviceMode ? [0, 0, deviceXray ? -0.2 : 0] : cameraMode === "packetFollow" ? followNode3D?.position : selectedNode3D?.position;
  const eyeOffset3D: [number, number, number] | undefined = inDeviceMode ? (deviceXray ? [0.6, 2.6, 5.2] : [2.1, 1.5, 3.8]) : undefined;

  const explainTargetId = (effectiveDeviceId ?? (ROUTER_IDS.includes(selectedNodeId as RouterId) ? (selectedNodeId as RouterId) : undefined) ?? (ROUTER_IDS.includes(followNode3D?.id as RouterId) ? (followNode3D?.id as RouterId) : undefined)) as RouterId | undefined;
  const nodeExplanation = explainTargetId ? explainNode(state, explainTargetId, currentStep?.id ?? "") : undefined;
  const xrayPacket = activePacket && (selectedNodeId === activePacket.from || selectedNodeId === activePacket.to) ? activePacket : undefined;
  const selectedLinkDetail = selectedLinkId ? linkDetailFor(selectedLinkId, state) : undefined;
  const packetCurrentDeviceLabel = effectiveDeviceId ?? state.packetAt ?? activePacket?.from ?? "—";
  const packetDirection = journeyPath.length ? journeyPath.join(" → ") : "—";
  const devicePacketForTab = xrayPacket ?? (effectiveDeviceId && state.packetAt === effectiveDeviceId ? activePacket : undefined);

  function explorerTabsFor(router: RouterId): DeviceExplorerTab[] {
    if (!nodeExplanation) return [];
    const entries = state.localSidTable[router] ?? [];
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
    const igpTab: DeviceExplorerTab = {
      id: "ipv6-igp",
      label: "IPv6 IGP",
      content: (
        <div className="space-y-1 pv-mono text-[11px] text-pv-text-muted">
          {state.links.map((l) => (
            <div key={l.id} className="flex justify-between gap-3">
              <span>{l.a}–{l.b}</span>
              <span>metric {l.metric}</span>
            </div>
          ))}
        </div>
      ),
    };
    const teDbTab: DeviceExplorerTab = {
      id: "te-database",
      label: "TE Database",
      content: (
        <div className="space-y-1 pv-mono text-[11px] text-pv-text-muted">
          {state.links.map((l) => (
            <div key={l.id} className="flex justify-between gap-3">
              <span>{l.a}–{l.b}</span>
              <span>igp {l.metric} / delay {l.delay}</span>
            </div>
          ))}
        </div>
      ),
    };
    const locatorTab: DeviceExplorerTab = {
      id: "locator",
      label: router === "R1" ? "SRv6 Locators" : "Locator",
      content: (
        <div className="space-y-1 pv-mono text-[11px]">
          <p className="text-pv-text-faint">Locator: <span className="text-pv-text">{locatorTextFor(router)}</span></p>
          <p className="text-pv-text-faint">Local SIDs: <span className="text-pv-text">{entries.length}</span></p>
        </div>
      ),
    };
    const localSidTab: DeviceExplorerTab = { id: "local-sid-table", label: "Local SID Table", content: <LocalSidTableViewer title={`${router} Local SID Table`} rows={entries.map((e) => ({ sid: e.sidText, locator: e.locatorText, functionText: e.functionText, behavior: BEHAVIOR_LABEL[e.behavior], owner: e.owner, state: "ACTIVE", parameters: e.parameterText }))} /> };
    const endXTab: DeviceExplorerTab = {
      id: "end-x",
      label: "End.X",
      content: (() => {
        const e = findLocalSid(state.localSidTable, "R3", FUNCTION.END_X);
        return e ? <Srv6SidStructureViewer sid={e.sidText} locatorLength={LOCATOR_LENGTH} functionLength={FUNCTION_LENGTH} argumentLength={ARGUMENT_LENGTH} locator={e.locatorText} functionText={e.functionText} behavior={BEHAVIOR_LABEL[e.behavior]} owner={e.owner} /> : <p className="text-xs text-pv-text-faint">Not instantiated.</p>;
      })(),
    };
    const srPoliciesTab: DeviceExplorerTab = {
      id: "sr-policies",
      label: "SR Policies",
      content: <PolicyViewer policyKey={`<R1,${POLICY_COLOR},R6>`} headend="R1" color={POLICY_COLOR} endpoint="R6" state={pState} bindingSid={undefined} activeCandidateName={active?.def.name} candidates={candidateRows} />,
    };
    const candidatePathsTab: DeviceExplorerTab = { id: "candidate-paths", label: "Candidate Paths", content: <CandidateSelectionViewer candidates={selectionRows} /> };
    const segmentListsTab: DeviceExplorerTab = { id: "segment-lists", label: "Segment Lists", content: <Srv6PolicySegmentListViewer segments={activeSegmentRows} /> };
    const srDbTab: DeviceExplorerTab = {
      id: "sr-database",
      label: "SR Database",
      content: (
        <div className="space-y-1 pv-mono text-[11px]">
          {srDb.map((e) => (
            <div key={e.sidText} className="flex justify-between gap-3">
              <span className="text-pv-text-faint">{e.sidText}</span>
              <span className={e.verified ? "text-pv-success" : "text-pv-danger"}>{e.verified ? "VERIFIED" : "NOT VERIFIED"}</span>
            </div>
          ))}
        </div>
      ),
    };
    const bsidTab: DeviceExplorerTab = { id: "binding-sid", label: "Binding SID", content: <p className="pv-mono text-[11px] text-pv-text-muted">BSID: <span className="text-pv-cyan-soft">{BSID_TEXT}</span> — R1-local, bound to policy &lt;R1,{POLICY_COLOR},R6&gt;.</p> };
    const steeringTab: DeviceExplorerTab = { id: "steering", label: "Steering", content: <p className="pv-mono text-[11px] text-pv-text-muted">Flow: {state.flow ?? "(none classified)"} {state.flow === "LOW_LATENCY" ? `→ Color ${POLICY_COLOR}` : ""}</p> };
    const packetTab: DeviceExplorerTab = {
      id: "packet",
      label: "Packet",
      content: (
        <div className="space-y-2">
          <p className="pv-mono text-[11px] text-pv-text-muted">Before: <span className="text-pv-text">{nodeExplanation.packetBefore ?? "—"}</span></p>
          <p className="pv-mono text-[11px] text-pv-text-muted">After: <span className="text-pv-cyan-soft">{nodeExplanation.packetAfter ?? "—"}</span></p>
          {devicePacketForTab ? <PacketInspector packet={devicePacketForTab} /> : <p className="text-xs text-pv-text-faint">No packet at this device right now.</p>}
        </div>
      ),
    };
    const cliTab: DeviceExplorerTab = { id: "cli", label: "CLI", content: <CLIOutputPanel commands={cliCommands} /> };

    if (router === "R1") return [overviewTab, hardwareTab, interfacesTab, igpTab, teDbTab, locatorTab, srDbTab, srPoliciesTab, candidatePathsTab, segmentListsTab, bsidTab, steeringTab, packetTab, cliTab];
    if (router === "R3") return [overviewTab, hardwareTab, interfacesTab, igpTab, locatorTab, localSidTab, endXTab, packetTab, cliTab];
    if (router === "R6") return [overviewTab, hardwareTab, interfacesTab, igpTab, locatorTab, localSidTab, packetTab, cliTab];
    return [overviewTab, hardwareTab, interfacesTab, igpTab, locatorTab, packetTab, cliTab];
  }

  useEffect(() => {
    if (isComplete) {
      completeLesson("srv6-policy", 750);
      unlockAchievement("srv6-policy-architect");
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
    setLabFlow(PSEUDO_FLOWS[0]);
  };

  const nextLabel = currentStep?.question && !lastAnswer ? "Answer to continue" : currentStep?.requiresState && !canAdvance ? "Apply the correct fix to continue" : "Next Step →";

  return (
    <div className="mx-auto max-w-7xl px-6 py-10">
      <div className="mb-6">
        <Badge tone="violet" className="mb-3">
          SRv6 TRAFFIC ENGINEERING · SR POLICY · RFC 9256 · CANDIDATE PATHS · H.ENCAPS · BSID
        </Badge>
        <h1 className="text-2xl font-semibold text-pv-text sm:text-3xl">A SID Says What To Do. A Policy Says Which SIDs, And Why.</h1>
        <p className="mt-2 max-w-3xl text-sm text-pv-text-muted">
          An SR Policy does not simply choose a segment list: it validates candidate paths, selects the best valid candidate, installs its
          forwarding program, and steers traffic into that program.
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

      <div className="mb-4 flex gap-1 overflow-x-auto pb-2">
        {srv6PolicySteps.map((step, i) => (
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
            { value: "te", label: "TE Database" },
            { value: "policy", label: "SR Policy" },
            { value: "program", label: "Packet Program" },
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
                if (v === "device" && !enteredDeviceId) setEnteredDeviceId((ROUTER_IDS.includes(selectedNodeId as RouterId) ? (selectedNodeId as RouterId) : undefined) ?? activeDeviceId ?? "R1");
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
        <PlaneViewSwitcher value={planeView} onChange={setPlaneView} />
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
                  setSelectedNodeId(id as NodeId);
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
                    {selectedNodeId && ROUTER_IDS.includes(selectedNodeId as RouterId) && (
                      <Button
                        size="sm"
                        onClick={() => {
                          setEnteredDeviceId(selectedNodeId as RouterId);
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

              {lastHop && <ForwardingDecisionCard router={String(lastHop.router)} input={lastHop.input} lookup={lastHop.lookup} action={lastHop.action} output={lastHop.output} />}
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

          {!isComplete && currentStep?.id === "policy-invalid-shown" && (
            <GlassPanel strong className="flex flex-wrap items-center gap-3 p-5">
              <span className="text-xs font-semibold uppercase tracking-wide text-pv-text-faint">Drop-Upon-Invalid</span>
              <TopologyModeSwitcher options={[{ value: "off", label: "DEFAULT" }, { value: "on", label: "DROP-UPON-INVALID" }]} value={state.dropUponInvalid ? "on" : "off"} onChange={(v) => engine.act({ toggleDrop: v === "on" })} tone="violet" />
              <Button size="sm" onClick={() => engine.act({ send: true })}>
                Send Test Packet
              </Button>
            </GlassPanel>
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

          {showPolicyIdentity && !isComplete && (
            <PolicyViewer policyKey={`<R1,${POLICY_COLOR},R6>`} headend="R1" color={POLICY_COLOR} endpoint="R6" state={pState} bindingSid={showBsid || index >= STEP_IDX.bsidIntro ? undefined : undefined} activeCandidateName={active?.def.name} steeringState={state.flow} candidates={candidateRows} />
          )}

          {showCandidates && !isComplete && <CandidateSelectionViewer candidates={selectionRows} />}

          {showCandidates && active && !isComplete && <Srv6PolicySegmentListViewer segments={activeSegmentRows} />}

          {state.packet?.outer.srh && !isComplete && <SegmentRoutingHeaderViewer activeDa={fmtIpv6(state.packet.outer.daHextets)} srh={{ ...state.packet.outer.srh, segmentList: state.packet.outer.srh.segmentList.map((s) => ({ index: s.index, sid: s.sidText, label: s.ownerRouter })) }} />}

          {showWeightedLab && (
            <GlassPanel strong className="space-y-3 p-5">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-pv-violet">Read-Only Lab: Weighted Segment Lists</h3>
              <p className="text-[11px] text-pv-text-muted">Twenty deterministic pseudo-flows, hashed once each into SL-A (weight 80) or SL-B (weight 20).</p>
              <div className="flex flex-wrap gap-1">
                {PSEUDO_FLOWS.map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setLabFlow(f)}
                    className={clsx("rounded-full border px-2 py-1 text-[10px] font-semibold pv-mono transition-colors", labFlow === f ? "border-pv-cyan/50 bg-pv-cyan/15 text-pv-cyan-soft" : "border-pv-border text-pv-text-faint hover:text-pv-text")}
                  >
                    {f}
                  </button>
                ))}
              </div>
              <div className="rounded-lg border border-pv-border p-3 text-xs">
                <p className="mb-1 text-pv-text">
                  {labFlow} →{" "}
                  {labSelection.status === "SELECTED" ? (
                    <>
                      <span className="pv-mono font-semibold text-pv-cyan-soft">{labSelection.list.id}</span> (weight {labSelection.list.weight})
                    </>
                  ) : (
                    <span className="pv-mono font-semibold text-pv-danger">NO VALID SEGMENT LIST</span>
                  )}
                </p>
                <p className="pv-mono text-[11px] text-pv-text-faint">Distribution across all 20 flows: {Object.entries(labDistribution).map(([id, n]) => `${id}=${n}`).join(", ")}</p>
              </div>
            </GlassPanel>
          )}

          {index >= STEP_IDX.bsidExperimentSetup && state.bsidExperiment && showBsidExperiment && (
            <GlassPanel strong className="space-y-3 p-5">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-pv-violet">NESTED POLICY ENCAPSULATION — End.B6.Encaps</h3>
              <div className="grid gap-2 sm:grid-cols-2 text-xs">
                <div className="rounded-lg border border-pv-border p-2.5">
                  <p className="mb-1 font-semibold uppercase tracking-wide text-pv-text-faint">Incoming SRH, Before</p>
                  <p className="pv-mono text-pv-text-muted">DA={state.bsidExperiment.incomingBefore.da}</p>
                  <p className="pv-mono text-pv-text-muted">SL={state.bsidExperiment.incomingBefore.sl}</p>
                </div>
                <div className="rounded-lg border border-pv-cyan/40 bg-pv-cyan/5 p-2.5">
                  <p className="mb-1 font-semibold uppercase tracking-wide text-pv-cyan-soft">Incoming SRH, After Advance</p>
                  <p className="pv-mono text-pv-text-muted">DA={state.bsidExperiment.incomingAfter.da}</p>
                  <p className="pv-mono text-pv-text-muted">SL={state.bsidExperiment.incomingAfter.sl}</p>
                </div>
              </div>
              <p className="text-[11px] text-pv-text-muted">New outer DA (bound policy): <span className="pv-mono text-pv-cyan-soft">{state.bsidExperiment.nestedOuterDa}</span> — {state.bsidExperiment.nestedSrhSummary}</p>
              <PacketInspector packet={{ id: "bsid-nested", protocol: "IPV6", from: "R1", to: "R1", summary: "Nested policy encapsulation", layers: state.bsidExperiment.layers }} />
            </GlassPanel>
          )}

          {showSrMplsComparison && (
            <GlassPanel className="overflow-x-auto p-4">
              <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-pv-text-muted">SR-MPLS vs. SRv6 Policy</h4>
              <table className="w-full min-w-[600px] pv-mono text-[11px]">
                <thead>
                  <tr className="text-left text-[9px] uppercase tracking-wide text-pv-text-faint">
                    <th className="pb-1.5 pr-3">Property</th>
                    <th className="pb-1.5 pr-3">SR-MPLS</th>
                    <th className="pb-1.5">SRv6</th>
                  </tr>
                </thead>
                <tbody className="[&>tr]:border-t [&>tr]:border-pv-border">
                  {SR_MPLS_VS_SRV6.map((row) => (
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

          {!isComplete && (
            <PlaneSplitPanel
              show={planeView}
              controlTitle="Control Plane — Policy, Candidates, SR Database"
              controlRows={[
                { label: "Policy state", value: pState },
                { label: "Active candidate", value: active?.def.name ?? "none" },
                { label: "SR-DB: R3 End.X verified", value: state.srDbR3EndXVerified ? "yes" : "no" },
              ]}
              dataTitle="Data Plane — Current Packet"
              dataRows={
                state.packet
                  ? [
                      { label: "Location", value: String(state.packetAt ?? "—") },
                      { label: "Outer DA (active segment)", value: fmtIpv6(state.packet.outer.daHextets) },
                      { label: "Segments Left", value: state.packet.outer.srh ? String(state.packet.outer.srh.segmentsLeft) : "(no SRH)" },
                    ]
                  : [{ label: "Packet", value: "none in flight" }]
              }
            />
          )}

          {isComplete && (
            <GlassPanel strong glow="success" className="flex flex-col items-center gap-4 p-10 text-center">
              <Badge tone="success">SRv6 Policy Architect</Badge>
              <h2 className="text-2xl font-semibold text-pv-text">You Engineered The IPv6 Path</h2>
              <p className="max-w-md text-sm text-pv-text-muted">
                You built SR Policy &lt;R1,100,R6&gt;, validated an explicit candidate and computed a dynamic one, watched preference decide
                among valid candidates, steered traffic with H.Encaps, survived a real candidate failure and failover, diagnosed and repaired
                an SR-Database fault, and explored Drop-Upon-Invalid and End.B6.Encaps. +750 XP awarded.
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
            {ROUTER_IDS.map((r) => (
              <button key={r} type="button" onClick={() => setFocusRouter(r)} className={clsx("rounded-full px-3 py-1 text-[11px] font-semibold pv-mono transition-colors", focusRouter === r ? "bg-pv-cyan/15 text-pv-cyan-soft" : "text-pv-text-faint hover:text-pv-text")}>
                {r}
              </button>
            ))}
          </div>

          <PacketJourneyTimeline hops={state.journey.map((h) => ({ ...h, router: String(h.router) }))} />
          <CLIOutputPanel commands={cliCommands} />
        </div>
      </div>
    </div>
  );
}

function linkIdsOnPath(path: NodeId[]): string[] {
  const ids: string[] = [];
  for (let i = 0; i < path.length - 1; i++) {
    const e = GRAPH_EDGES.find((x) => (x.a === path[i] && x.b === path[i + 1]) || (x.b === path[i] && x.a === path[i + 1]));
    if (e) ids.push(e.id);
  }
  return ids;
}

function RepairChallenge({ options, attempt, onTry }: { options: { id: string; label: string }[]; attempt?: { choice: string; correct: boolean }; onTry: (choice: string) => void }) {
  return (
    <GlassPanel strong className="p-5">
      <p className="mb-3 text-sm font-medium text-pv-text">Choose the correct repair to restore CP-EXPLICIT as the active candidate:</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((opt) => {
          const isSelected = attempt?.choice === opt.id;
          const isCorrect = opt.id === "reverify-sr-db";
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
            <span className="font-semibold">✓ R1&apos;s SR Database re-verified R3&apos;s End.X SID.</span>
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
