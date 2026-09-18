"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { clsx } from "clsx";
import { useScenarioEngine } from "@/lib/sim-engine/useScenarioEngine";
import {
  GRAPH_NODES,
  GRAPH_EDGES,
  PROTECTED_LINK,
  PROTECTED_NODE,
  PLR,
  CUST_A_EXPORT_RT,
  CUST_A_RD,
  CE1_IPV4_PREFIX,
  CE2_IPV4_PREFIX,
  createCapstoneState,
  capstoneSteps,
  compareArchitectures,
  comparisonPhaseForIndex,
  type ComparisonPhase,
  buildRequirementMatrix,
  buildTeSegments,
  buildMplsSidDatabase,
  buildSrv6SidDatabase,
  buildMplsRepairList,
  buildSegmentEncodingComparison,
  buildCapstoneCliCommands,
  nodeSidLabel,
  archLabel,
  type Architecture,
  type CapstoneState,
  type RouterId,
  type ViewMode,
} from "@/lib/sim-engine/scenarios/srMplsVsSrv6";
import { GraphTopologyViewer } from "@/components/network/GraphTopologyViewer";
import { GraphPacket } from "@/components/network/GraphPacket";
import { PacketInspector } from "@/components/network/PacketInspector";
import { SidTableViewer, type SidTableRow } from "@/components/protocol/SidTableViewer";
import { SegmentListViewer, type SegmentListRow } from "@/components/protocol/SegmentListViewer";
import { SegmentRoutingHeaderViewer } from "@/components/protocol/SegmentRoutingHeaderViewer";
import { RepairListViewer } from "@/components/protocol/RepairListViewer";
import { Srv6RepairListViewer, type Srv6RepairSidRow } from "@/components/protocol/Srv6RepairListViewer";
import { Srv6VpnRouteViewer, type Srv6VpnRouteRow } from "@/components/protocol/Srv6VpnRouteViewer";
import { SegmentEncodingComparisonViewer } from "@/components/protocol/SegmentEncodingComparisonViewer";
import { TroubleshootingLayers, type DiagnosticLayer } from "@/components/protocol/TroubleshootingLayers";
import { PredictionQuestion } from "@/components/quiz/PredictionQuestion";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { useProgressStore } from "@/lib/state/useProgressStore";
import { NetworkScene3D } from "@/components/network3d/NetworkScene3D";
import { TopologyModeSwitcher } from "@/components/network3d/TopologyModeSwitcher";
import { DeviceExplorerPanel, InterfaceListTab, type DeviceExplorerTab } from "@/components/network3d/DeviceExplorerPanel";
import { layoutTo3D } from "@/components/network3d/layout";
import type { ActivePacket3D, Link3DData, Node3DStatus } from "@/components/network3d/types";
import { explainNode } from "./explain";
import { interfacesFor, linkDetailFor } from "./deviceTrace";

const RR1_NODE = { id: "RR1", label: "RR1", x: 49, y: 6, subLabel: "Route Reflector (control-plane only)" };
const RR1_EDGES = [
  { id: "RR1-PE1", a: "RR1", b: "PE1", label: "MP-BGP" },
  { id: "RR1-PE2", a: "RR1", b: "PE2", label: "MP-BGP" },
];

const VIEW_MODES: { value: ViewMode; label: string }[] = [
  { value: "REQUIREMENT", label: "Requirement" },
  { value: "SR_MPLS", label: "SR-MPLS" },
  { value: "SRV6", label: "SRv6" },
  { value: "SIDE_BY_SIDE", label: "Side-by-Side" },
  { value: "PACKET", label: "Packet" },
  { value: "FAILURE", label: "Failure" },
];

const WHY_CAPSTONE: { q: string; a: string }[] = [
  { q: "Same architecture?", a: "SR-MPLS and SRv6 are ONE Segment Routing architecture (RFC 8402) with two different data-plane encodings — never framed as old/bad vs. new/better." },
  { q: "What actually changes?", a: "The forwarding-plane encoding (MPLS label vs. IPv6 address+SRH) and the capabilities that encoding exposes — not the underlying segment-list model." },
  { q: "What stays identical?", a: "Topology, IGP, VRF/RD/RT, MP-BGP VPN routes, the TI-LFA repair-topology computation, and the customer service — every difference you'll see is attributable to encoding, not to a different example." },
  { q: "Is there a winner?", a: "No. This is an engineering trade-off lesson — three Decision Labs each pick a DIFFERENT correct architecture for a different requirement." },
];

const DECISION_LAB_STEP_IDS = new Set(["decision-lab-a", "decision-lab-b", "decision-lab-c"]);

export default function SrMplsVsSrv6Capstone() {
  const { engine, snapshot } = useScenarioEngine<CapstoneState>(createCapstoneState(), capstoneSteps);
  const [viewMode, setViewMode] = useState<ViewMode>("SIDE_BY_SIDE");
  const [is3D, setIs3D] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<RouterId | "RR1" | undefined>(undefined);
  const [enteredDeviceId, setEnteredDeviceId] = useState<RouterId | undefined>(undefined);
  const [explorerArch, setExplorerArch] = useState<Architecture>("SR_MPLS");
  const [selectedInterfaceId, setSelectedInterfaceId] = useState<string | undefined>(undefined);
  const [selectedLinkId, setSelectedLinkId] = useState<string | undefined>(undefined);
  const [packetSelected, setPacketSelected] = useState(false);
  const completeLesson = useProgressStore((s) => s.completeLesson);
  const recordAnswer = useProgressStore((s) => s.recordAnswer);
  const unlockAchievement = useProgressStore((s) => s.unlockAchievement);
  const awardedRef = useRef(false);

  const { state, currentStep, index, totalSteps, isComplete, lastAnswer, whatChanged, activePacket } = snapshot;
  const canAdvance = engine.canAdvance();

  const nodes = useMemo(() => [...GRAPH_NODES, RR1_NODE], []);
  const edges = useMemo(
    () => [
      ...GRAPH_EDGES.map((e) => ({ ...e, state: state.linkFailed && (e.id === "P1-P2") ? ("down" as const) : ("full" as const) })),
      ...RR1_EDGES,
    ],
    [state.linkFailed],
  );
  const activeNodeIds = activePacket ? [activePacket.from, activePacket.to] : [];
  const packetFrom = nodes.find((n) => n.id === activePacket?.from);
  const packetTo = nodes.find((n) => n.id === activePacket?.to);

  // --- 3D (overview-only; no device-interior scene in this capstone — see final report) ---
  const nodes3DBase = useMemo(() => layoutTo3D(GRAPH_NODES), []);
  const nodes3D = nodes3DBase.map((n) => {
    let status: Node3DStatus = "idle";
    if (n.id === selectedNodeId) status = "selected";
    else if (activePacket && (n.id === activePacket.from || n.id === activePacket.to)) status = "active";
    const badges = n.id === PLR ? ["PLR"] : n.id === PROTECTED_NODE && state.linkFailed ? undefined : n.id === "P4" && state.sharedRepair ? ["REPAIR NODE"] : undefined;
    return { ...n, status, badges };
  });
  const links3D: Link3DData[] = GRAPH_EDGES.map((e) => ({ ...e, active: activePacket ? (e.a === activePacket.from && e.b === activePacket.to) || (e.b === activePacket.from && e.a === activePacket.to) : false }));
  const activePacket3D: ActivePacket3D | undefined = activePacket && nodes3D.some((n) => n.id === activePacket.from) && nodes3D.some((n) => n.id === activePacket.to) ? { packet: activePacket, fromId: activePacket.from, toId: activePacket.to } : undefined;

  // --- Derived per-phase data ---
  const teSegments = useMemo(() => buildTeSegments(), []);
  const mplsSidDb = useMemo(() => buildMplsSidDatabase(), []);
  const srv6SidDb = useMemo(() => buildSrv6SidDatabase(), []);
  const archComparison = useMemo(() => compareArchitectures(), []);
  const requirementMatrix = useMemo(() => buildRequirementMatrix(), []);
  const headerLabRows = useMemo(() => buildSegmentEncodingComparison(), []);

  const mplsSidRows: SidTableRow[] = mplsSidDb.map((r) => ({ prefix: r.sidType === "NODE" ? undefined : undefined, router: r.router, sidType: r.sidType, localLabel: r.label, scope: r.sidType === "NODE" ? "GLOBAL" : "LOCAL", owner: r.owner, nextHop: r.neighbor, meaning: r.meaning, installed: true }));
  const teMplsRows: SegmentListRow[] = teSegments.map((s, i) => ({ order: i, sid: nodeSidLabel(s.owner), type: "NODE", target: s.owner, scope: "GLOBAL", active: i === 0, completed: false, explanation: s.explanation }));
  const repairMpls = state.sharedRepair ? buildMplsRepairList(state.sharedRepair) : [];
  const repairMplsRows: SegmentListRow[] = repairMpls.map((s, i) => ({ order: i, sid: s.label, type: s.type, owner: s.owner, target: s.target ?? s.owner, scope: s.type === "NODE" ? "GLOBAL" : "LOCAL", active: i === 0, completed: false, explanation: s.type === "NODE" ? `Reach ${s.owner} via ordinary IGP` : `At ${s.owner}, force the ${s.owner}→${s.target} adjacency` }));
  const srv6RepairRows: Srv6RepairSidRow[] = state.sharedRepair?.repairList.sids.map((s) => ({ sid: s.sidText, owner: s.owner, behavior: "End.X", adjacency: s.adjacency, flavors: s.flavors, purpose: `Force ${s.owner}→${s.adjacency}` })) ?? [];

  const srv6VpnRow: Srv6VpnRouteRow | undefined = state.srv6VpnRoute
    ? {
        afiSafi: "VPN-IPv4",
        prefix: state.srv6VpnRoute.prefix,
        rd: state.srv6VpnRoute.rd,
        routeTargets: state.srv6VpnRoute.rt,
        bgpNextHop: state.srv6VpnRoute.bgpNextHop,
        serviceSid: state.srv6VpnRoute.prefixSid?.l3Service.serviceSid.sidText,
        endpointBehavior: "End.DT4",
        received: !!state.srv6ImportProgress?.received,
        rtImported: state.srv6ImportProgress?.rtImport?.passed,
        rtImportReason: state.srv6ImportProgress?.rtImport?.reason,
        sidResolved: state.srv6ImportProgress?.serviceSidResolution?.resolvable,
        sidResolvedReason: state.srv6ImportProgress?.serviceSidResolution?.reason,
        installed: state.srv6ImportProgress?.installed,
      }
    : undefined;

  const diagnosticLayers: DiagnosticLayer[] = [
    { label: "CE route advertised", status: state.troubleshooting.started ? "healthy" : "unknown" },
    { label: "VPN route received", status: state.troubleshooting.started ? "healthy" : "unknown" },
    { label: "RT import", status: state.troubleshooting.started ? "healthy" : "unknown" },
    { label: "BGP next hop reachable", status: state.troubleshooting.started ? "healthy" : "unknown" },
    { label: "SR-MPLS: VPN forwarding", status: state.troubleshooting.started ? "healthy" : "unknown" },
    { label: "SRv6: Service SID resolvable", status: !state.troubleshooting.locatorWithdrawn ? "unknown" : state.troubleshooting.repaired ? "healthy" : "failing" },
    { label: "SRv6: VPN forwarding usable", status: !state.troubleshooting.locatorWithdrawn ? "unknown" : state.troubleshooting.verified ? "healthy" : "failing" },
  ];

  const cliCommands = useMemo(() => (enteredDeviceId ? buildCapstoneCliCommands(state, explorerArch, enteredDeviceId) : []), [state, explorerArch, enteredDeviceId]);
  const nodeExplanation = enteredDeviceId ? explainNode(state, explorerArch, enteredDeviceId) : undefined;
  const deviceInterfaces = enteredDeviceId ? interfacesFor(enteredDeviceId, state, explorerArch, currentStep?.id ?? "") : [];
  const selectedLinkDetail = selectedLinkId ? linkDetailFor(selectedLinkId, state, explorerArch) : undefined;

  useEffect(() => {
    if (isComplete && !awardedRef.current) {
      awardedRef.current = true;
      completeLesson("sr-mpls-vs-srv6", 1000);
      unlockAchievement("segment-routing-architect");
    }
  }, [isComplete, completeLesson, unlockAchievement]);

  const handleAnswer = (optionId: string) => {
    engine.answer(optionId);
    if (currentStep?.question) recordAnswer(optionId === currentStep.question.correctOptionId);
    if (currentStep && DECISION_LAB_STEP_IDS.has(currentStep.id)) {
      const arch: Architecture = optionId === "srv6" || optionId === "srv6-uncompressed" || optionId === "srv6-csid" ? "SRV6" : "SR_MPLS";
      engine.act(arch);
    }
  };

  const handleRestart = () => {
    awardedRef.current = false;
    engine.restart();
    setViewMode("SIDE_BY_SIDE");
    setIs3D(false);
    setSelectedNodeId(undefined);
    setEnteredDeviceId(undefined);
    setSelectedLinkId(undefined);
    setPacketSelected(false);
  };

  const nextLabel = currentStep?.question && !lastAnswer ? "Answer to continue" : currentStep?.requiresState && !canAdvance ? "Apply the correct fix to continue" : "Next Step →";

  const explorerTabs: DeviceExplorerTab[] = nodeExplanation
    ? [
        { id: "overview", label: "Overview", content: <OverviewTab action={nodeExplanation.currentAction} note={nodeExplanation.note} tables={nodeExplanation.tables} /> },
        { id: "interfaces", label: "Interfaces", content: <InterfaceListTab interfaces={deviceInterfaces} selectedInterfaceId={selectedInterfaceId} onSelectInterface={setSelectedInterfaceId} /> },
        { id: "cli", label: "CLI (conceptual)", content: <CliTab commands={cliCommands} /> },
      ]
    : [];

  return (
    <div className="mx-auto max-w-7xl px-6 py-10">
      <div className="mb-6">
        <Badge tone="cyan" className="mb-3">
          ENGINEERING CAPSTONE · RFC 8402 · RFC 8660 · RFC 9256 · RFC 9855 · RFC 8754 · RFC 8986 · RFC 9252 · RFC 9800
        </Badge>
        <h1 className="text-2xl font-semibold text-pv-text sm:text-3xl">SR-MPLS vs. SRv6: Same Requirement, Two Data Planes</h1>
        <p className="mt-2 max-w-3xl text-sm text-pv-text-muted">
          One shared topology, one shared traffic requirement, one shared failure, one shared VPN service, one shared TE requirement — solved once in SR-MPLS, once in SRv6. Inspect exactly what changes and what doesn&apos;t.
        </p>
      </div>

      <div className="mb-4 grid gap-2 sm:grid-cols-4">
        {WHY_CAPSTONE.map((item) => (
          <GlassPanel key={item.q} className="p-3">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-pv-cyan-soft">{item.q}</p>
            <p className="text-[11px] leading-snug text-pv-text-muted">{item.a}</p>
          </GlassPanel>
        ))}
      </div>

      <div className="mb-4 flex gap-1 overflow-x-auto pb-2">
        {capstoneSteps.map((step, i) => (
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

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <TopologyModeSwitcher options={VIEW_MODES} value={viewMode} onChange={setViewMode} />
        <TopologyModeSwitcher options={[{ value: "off", label: "2D" }, { value: "on", label: "3D View" }]} value={is3D ? "on" : "off"} onChange={(v) => setIs3D(v === "on")} tone="violet" />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-4">
          <GlassPanel strong className="p-5">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-pv-cyan-soft">
                Step {index + 1} / {totalSteps} — {currentStep?.label}
              </span>
              <Badge tone={state.activeArchitecture === "SR_MPLS" ? "cyan" : "violet"}>{archLabel(state.activeArchitecture)}</Badge>
            </div>
            <p className="text-sm leading-relaxed text-pv-text">{currentStep?.narrative}</p>
            {whatChanged.length > 0 && (
              <ul className="mt-3 space-y-1 border-t border-pv-border pt-3 text-[11px] text-pv-text-muted">
                {whatChanged.map((w, i) => (
                  <li key={i}>• {w}</li>
                ))}
              </ul>
            )}
          </GlassPanel>

          {currentStep?.question && <PredictionQuestion question={currentStep.question} selectedOptionId={lastAnswer?.stepId === currentStep.id ? lastAnswer.optionId : undefined} onAnswer={handleAnswer} />}

          {currentStep?.id === "incident-ladder" && <TroubleshootingLayers layers={diagnosticLayers} />}

          {currentStep?.id === "incident-repair" && (
            <GlassPanel strong className="p-4">
              <p className="mb-3 text-sm text-pv-text">Restore PE2&apos;s SRv6 locator reachability and recompute Service SID resolution.</p>
              <Button onClick={() => engine.act(undefined)} disabled={state.troubleshooting.repaired}>
                {state.troubleshooting.repaired ? "Locator Restored ✓" : "Restore SRv6 Locator Reachability"}
              </Button>
            </GlassPanel>
          )}

          {!is3D ? (
            <GlassPanel className="relative aspect-[16/10] w-full overflow-hidden p-0">
              <GraphTopologyViewer nodes={nodes} edges={edges} activeNodeIds={activeNodeIds} onNodeClick={(id) => setSelectedNodeId(id as RouterId)} onEdgeClick={setSelectedLinkId}>
                {activePacket && packetFrom && packetTo && <GraphPacket packet={activePacket} from={packetFrom} to={packetTo} onSelect={() => setPacketSelected(true)} />}
              </GraphTopologyViewer>
            </GlassPanel>
          ) : (
            <GlassPanel className="relative aspect-[16/10] w-full overflow-hidden p-0">
              <NetworkScene3D nodes={nodes3D} links={links3D} activePacket={activePacket3D} onSelectNode={(id) => setSelectedNodeId(id as RouterId)} onSelectLink={setSelectedLinkId} selectedLinkId={selectedLinkId} mode="overview" />
            </GlassPanel>
          )}

          {selectedNodeId && selectedNodeId !== "RR1" && !enteredDeviceId && (
            <GlassPanel className="p-3">
              <div className="flex items-center justify-between">
                <span className="pv-mono text-sm text-pv-text">{selectedNodeId}</span>
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setExplorerArch(viewMode === "SR_MPLS" || viewMode === "SRV6" ? viewMode : state.activeArchitecture);
                      setEnteredDeviceId(selectedNodeId as RouterId);
                    }}
                  >
                    Enter Device →
                  </Button>
                  <Button variant="secondary" onClick={() => setSelectedNodeId(undefined)}>
                    Close
                  </Button>
                </div>
              </div>
            </GlassPanel>
          )}

          {selectedLinkDetail && (
            <GlassPanel className="p-3 text-[11px]">
              <p className="mb-1 pv-mono text-pv-text">
                {selectedLinkDetail.aLabel} ↔ {selectedLinkDetail.bLabel} · {selectedLinkDetail.status.toUpperCase()}
              </p>
              {selectedLinkDetail.protocols.map((p) => (
                <p key={p.label} className="text-pv-text-faint">
                  {p.label}: <span className="text-pv-text">{p.value}</span>
                </p>
              ))}
              <button className="mt-1 text-pv-cyan-soft" onClick={() => setSelectedLinkId(undefined)}>
                Close
              </button>
            </GlassPanel>
          )}

          {enteredDeviceId && nodeExplanation && (
            <GlassPanel strong className="p-4">
              <div className="mb-3 flex items-center gap-2">
                <TopologyModeSwitcher options={[{ value: "SR_MPLS", label: "SR-MPLS" }, { value: "SRV6", label: "SRv6" }]} value={explorerArch} onChange={setExplorerArch} />
              </div>
              <DeviceExplorerPanel explanation={nodeExplanation} tabs={explorerTabs} xrayEnabled={false} onToggleXray={() => {}} onExit={() => setEnteredDeviceId(undefined)} />
            </GlassPanel>
          )}

          <div className="flex items-center justify-between gap-3">
            <Button variant="secondary" onClick={() => engine.goTo(index - 1)} disabled={index === 0}>
              ← Previous
            </Button>
            <Button variant="secondary" onClick={handleRestart}>
              Restart
            </Button>
            <Button onClick={() => engine.advance()} disabled={!canAdvance || isComplete}>
              {isComplete ? "Complete ✓" : nextLabel}
            </Button>
          </div>
        </div>

        <div className="space-y-4">
          {viewMode === "REQUIREMENT" && <RequirementView rows={requirementMatrix} completed={isComplete} archComparison={archComparison} />}
          {viewMode === "SR_MPLS" && <MplsView state={state} sidRows={mplsSidRows} teRows={teMplsRows} repairRows={repairMplsRows} />}
          {viewMode === "SRV6" && <Srv6View state={state} sidDb={srv6SidDb} srv6VpnRow={srv6VpnRow} repairRows={srv6RepairRows} />}
          {viewMode === "SIDE_BY_SIDE" && <SideBySideView phase={comparisonPhaseForIndex(index)} archComparison={archComparison} headerLabRows={headerLabRows} />}
          {viewMode === "PACKET" && <PacketInspector packet={packetSelected ? activePacket : activePacket} />}
          {viewMode === "FAILURE" && <FailureView state={state} repairMplsRows={repairMplsRows} srv6RepairRows={srv6RepairRows} />}
        </div>
      </div>
    </div>
  );
}

function OverviewTab({ action, note, tables }: { action: string; note?: string; tables?: { title: string; rows: { label: string; value: string }[] }[] }) {
  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-pv-cyan/30 bg-pv-cyan/5 p-3">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-pv-cyan-soft">Current Action</p>
        <p className="text-sm text-pv-text">{action}</p>
      </div>
      {note && <p className="rounded-lg border border-pv-warning/30 bg-pv-warning/5 p-2.5 text-xs text-pv-text-muted">{note}</p>}
      {tables?.map((t) => (
        <div key={t.title} className="rounded-lg border border-pv-border p-2.5">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-pv-text-faint">{t.title}</p>
          {t.rows.map((r) => (
            <p key={r.label} className="pv-mono text-[11px] text-pv-text-muted">
              {r.label}: <span className="text-pv-text">{r.value}</span>
            </p>
          ))}
        </div>
      ))}
    </div>
  );
}

function CliTab({ commands }: { commands: { command: string; output: string }[] }) {
  return (
    <div className="space-y-2 pv-mono text-[11px]">
      {commands.map((c) => (
        <div key={c.command} className="rounded-lg border border-pv-border p-2">
          <p className="text-pv-cyan-soft">$ {c.command}</p>
          <p className="text-pv-text-muted">{c.output}</p>
        </div>
      ))}
    </div>
  );
}

function RequirementView({ rows, completed, archComparison }: { rows: { requirement: string; srMpls: string; srv6: string }[]; completed: boolean; archComparison: ReturnType<typeof compareArchitectures> }) {
  return (
    <GlassPanel className="p-4">
      <div className="mb-4 rounded-lg border border-pv-border p-2.5 text-[11px] text-pv-text-muted">
        <p className="mb-1 font-semibold text-pv-text-faint uppercase tracking-wide">Shared CUST-A Service (identical both sides)</p>
        <p>
          RT <span className="text-pv-text">{CUST_A_EXPORT_RT}</span> · RD <span className="text-pv-text">{CUST_A_RD.PE1}</span>/<span className="text-pv-text">{CUST_A_RD.PE2}</span> · CE1 <span className="text-pv-text">{CE1_IPV4_PREFIX}</span> · CE2 <span className="text-pv-text">{CE2_IPV4_PREFIX}</span>
        </p>
      </div>
      <h3 className="mb-3 text-sm font-semibold text-pv-text">Requirement Matrix — No Winner Column</h3>
      <div className="space-y-2 text-[11px]">
        {rows.map((r) => (
          <div key={r.requirement} className="rounded-lg border border-pv-border p-2.5">
            <p className="mb-1 font-semibold text-pv-text">{r.requirement}</p>
            <p className="text-pv-cyan-soft">SR-MPLS: <span className="text-pv-text-muted">{r.srMpls}</span></p>
            <p className="text-pv-violet">SRv6: <span className="text-pv-text-muted">{r.srv6}</span></p>
          </div>
        ))}
      </div>
      {completed && (
        <div className="mt-4 rounded-lg border border-pv-success/40 bg-pv-success/5 p-3 text-[11px] text-pv-text">
          <p className="mb-1 font-semibold text-pv-success">Final Engineering Summary</p>
          <p>Long segment program — SR-MPLS: {archComparison.instructionBytesMpls}B · SRv6 uncompressed: {archComparison.instructionBytesSrv6Uncompressed}B · SRv6 CSID: {archComparison.instructionBytesSrv6Csid}B.</p>
        </div>
      )}
    </GlassPanel>
  );
}

function MplsView({ state, sidRows, teRows, repairRows }: { state: CapstoneState; sidRows: SidTableRow[]; teRows: SegmentListRow[]; repairRows: SegmentListRow[] }) {
  return (
    <div className="space-y-4">
      <SidTableViewer title="SR-MPLS Node/Adj-SID Database" rows={sidRows} srgb={{ start: 16000, end: 16999 }} />
      <SegmentListViewer title="SR Policy Segment List (Explicit TE)" segments={teRows} />
      {state.linkFailed && <RepairListViewer title="TI-LFA Repair (SR-MPLS Encoding)" protectedResource={PROTECTED_LINK} repairTarget={state.sharedRepair?.mergeTarget} segments={repairRows} />}
      {state.mplsVpnRoute && (
        <GlassPanel className="p-4 text-[11px]">
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-pv-text-muted">VPNv4 Route (SR-MPLS)</h4>
          <p className="text-pv-text-muted">
            Prefix: <span className="text-pv-text">{state.mplsVpnRoute.prefix}</span> · RD: <span className="text-pv-text">{state.mplsVpnRoute.rd}</span> · RT: <span className="text-pv-text">{state.mplsVpnRoute.rt}</span> · VPN label: <span className="text-pv-text">{state.mplsVpnRoute.vpnLabel}</span>
          </p>
        </GlassPanel>
      )}
    </div>
  );
}

function Srv6View({ state, sidDb, srv6VpnRow, repairRows }: { state: CapstoneState; sidDb: { router: string; behavior: string; sidText: string; meaning: string }[]; srv6VpnRow?: Srv6VpnRouteRow; repairRows: Srv6RepairSidRow[] }) {
  const teSrh = state.srv6TePacket?.srh;
  return (
    <div className="space-y-4">
      <GlassPanel className="p-4">
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-pv-text-muted">SRv6 End SID Database</h4>
        <div className="space-y-1 pv-mono text-[11px]">
          {sidDb.map((r) => (
            <div key={r.router} className="flex justify-between rounded-lg border border-pv-border p-1.5">
              <span className="text-pv-text-faint">{r.router}</span>
              <span className="text-pv-text">{r.sidText}</span>
            </div>
          ))}
        </div>
      </GlassPanel>
      {teSrh && (
        <SegmentRoutingHeaderViewer
          title="SR Policy SRH (Explicit TE)"
          activeDa={teSrh.segmentList[teSrh.segmentsLeft]?.sidText ?? ""}
          srh={{ ...teSrh, segmentList: teSrh.segmentList.map((s) => ({ index: s.index, sid: s.sidText, label: s.ownerRouter })) }}
        />
      )}
      {state.linkFailed && <Srv6RepairListViewer title="TI-LFA Repair (SRv6 Encoding)" protectedResource={PROTECTED_LINK} outgoingInterface={state.sharedRepair?.outgoingInterface} sids={repairRows} />}
      {srv6VpnRow && <Srv6VpnRouteViewer title="CUST-A" route={srv6VpnRow} />}
    </div>
  );
}

function SideBySideView({ phase, archComparison, headerLabRows }: { phase: ComparisonPhase; archComparison: ReturnType<typeof compareArchitectures>; headerLabRows: ReturnType<typeof buildSegmentEncodingComparison> }) {
  const rows = phase === "vpn" ? archComparison.vpn : phase === "te" ? archComparison.te : phase === "protection" ? archComparison.protection : archComparison.transport;
  return (
    <div className="space-y-4">
      <GlassPanel strong className="p-4">
        <h3 className="mb-3 text-sm font-semibold text-pv-text">SAME REQUIREMENT — Two Encodings</h3>
        <div className="grid grid-cols-2 gap-3 text-center text-[11px]">
          <div className="rounded-lg border border-pv-cyan/40 bg-pv-cyan/5 p-2">
            <p className="font-semibold text-pv-cyan-soft">SR-MPLS</p>
            <p className="text-pv-text-faint">Segment → MPLS SID → LFIB → label operation</p>
          </div>
          <div className="rounded-lg border border-pv-violet/40 bg-pv-violet/5 p-2">
            <p className="font-semibold text-pv-violet">SRv6</p>
            <p className="text-pv-text-faint">Segment → IPv6 SID → IPv6 FIB / Local SID → endpoint behavior</p>
          </div>
        </div>
      </GlassPanel>
      <GlassPanel className="p-4">
        <div className="space-y-2 text-[11px]">
          {rows.map((r) => (
            <div key={r.requirement} className="grid grid-cols-[1fr_1fr_1fr] gap-2 rounded-lg border border-pv-border p-2">
              <span className="font-semibold text-pv-text-faint">{r.requirement}</span>
              <span className="pv-mono text-pv-cyan-soft">{r.srMpls}</span>
              <span className="pv-mono text-pv-violet">{r.srv6}</span>
            </div>
          ))}
        </div>
      </GlassPanel>
      {phase === "header" && <SegmentEncodingComparisonViewer title="8-Segment Program: Modeled Overhead (Near-MTU)" rows={headerLabRows} />}
    </div>
  );
}

function FailureView({ state, repairMplsRows, srv6RepairRows }: { state: CapstoneState; repairMplsRows: SegmentListRow[]; srv6RepairRows: Srv6RepairSidRow[] }) {
  const repair = state.sharedRepair;
  return (
    <div className="space-y-4">
      <GlassPanel className="p-4 text-[11px]">
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-pv-text-muted">Shared TI-LFA Computation</h4>
        <p className="text-pv-text-muted">Protected: <span className="text-pv-text">{PROTECTED_LINK}</span> · PLR: <span className="text-pv-text">{PLR}</span></p>
        <p className="text-pv-text-muted">P-Space: <span className="text-pv-text">{repair?.pSpace.join(", ") || "—"}</span></p>
        <p className="text-pv-text-muted">Extended P-Space: <span className="text-pv-text">{repair?.extendedPSpace.join(", ") || "—"}</span></p>
        <p className="text-pv-text-muted">Q-Space: <span className="text-pv-text">{repair?.qSpace.join(", ") || "—"}</span></p>
        <p className="text-pv-text-muted">Post-convergence path: <span className="text-pv-text">{repair?.postConvergencePath?.join(" → ") || "—"}</span></p>
        <p className="text-pv-text-muted">Repair node: <span className="text-pv-text">{repair?.repairNode ?? "—"}</span> · Merge target: <span className="text-pv-text">{repair?.mergeTarget ?? "—"}</span></p>
      </GlassPanel>
      <RepairListViewer title="SR-MPLS Repair Encoding" protectedResource={PROTECTED_LINK} repairTarget={repair?.mergeTarget} segments={repairMplsRows} />
      <Srv6RepairListViewer title="SRv6 Repair Encoding" protectedResource={PROTECTED_LINK} outgoingInterface={repair?.outgoingInterface} sids={srv6RepairRows} />
      <GlassPanel className="p-3 text-[11px] text-pv-text-faint">Link state: {state.linkFailed ? "P1-P2 DOWN — repairs active" : "Healthy — repairs precomputed, idle"}</GlassPanel>
    </div>
  );
}
