"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { clsx } from "clsx";
import { useScenarioEngine } from "@/lib/sim-engine/useScenarioEngine";
import {
  ALL_ROUTERS,
  BASE_PROGRAM,
  buildCsidCliCommands,
  buildDaAndSrh,
  calculateCompressionMetrics,
  calculateModeledPacketSize,
  compressNextCsidRun,
  compressReplaceCsidRun,
  createSrv6CsidState,
  CSID_CUST_HOST,
  csidHexText,
  ENDX_PROGRAM,
  GRAPH_EDGES,
  GRAPH_NODES,
  liveStructures,
  LOCATOR_BLOCK_TEXT,
  NEXT_CSID_VALUE,
  ordinarySidText,
  srv6CsidSteps,
  type CompressedListEntry,
  type RouterId,
  type SegmentRoutingHeader,
  type Srv6CsidState,
} from "@/lib/sim-engine/scenarios/srv6Csid";
import { fmtIpv6 } from "@/lib/sim-engine/scenarios/srv6Foundations";
import { PE2_DT4_SID } from "@/lib/sim-engine/scenarios/srv6L3vpn";
import { GraphTopologyViewer } from "@/components/network/GraphTopologyViewer";
import { GraphPacket } from "@/components/network/GraphPacket";
import { PacketInspector } from "@/components/network/PacketInspector";
import { PacketJourneyTimeline } from "@/components/protocol/PacketJourneyTimeline";
import { SegmentRoutingHeaderViewer, type SegmentRoutingHeaderData } from "@/components/protocol/SegmentRoutingHeaderViewer";
import { CsidContainerViewer, type CsidContainerData } from "@/components/protocol/CsidContainerViewer";
import { Srv6CompressionMetricsViewer } from "@/components/protocol/Srv6CompressionMetricsViewer";
import { CsidFlavorComparisonViewer } from "@/components/protocol/CsidFlavorComparisonViewer";
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
import { DeviceExplorerPanel, InterfaceListTab, type DeviceExplorerTab } from "@/components/network3d/DeviceExplorerPanel";
import { PacketDetailPanel } from "@/components/network3d/PacketDetailPanel";
import { LinkDetailPanel } from "@/components/network3d/LinkDetailPanel";
import { layoutTo3D } from "@/components/network3d/layout";
import type { ActivePacket3D, CameraMode, Link3DData, Node3DStatus } from "@/components/network3d/types";
import { explainNode } from "./explain";
import { interfacesFor, linkDetailFor, packetFramesFor, traceFor } from "./deviceTrace";

const DEVICE_ROUTERS: RouterId[] = [...ALL_ROUTERS];
type TopoView = "physical" | "packet";

const WHY_CSID: { q: string; a: string }[] = [
  { q: "WHAT does compression change?", a: "Encoding only — how the next SID is determined. The network program's intent never changes." },
  { q: "WHY does it matter?", a: "A long SRv6 program repeats the same Locator-Block and unused padding in every 128-bit segment." },
  { q: "WHEN is it used?", a: "Whenever a run of segments has a known-valid, compression-eligible structure sharing a common Locator-Block." },
  { q: "WITHOUT structure validation?", a: "An invalid/unknown structure could be silently mis-encoded into something that isn't a valid SID at all." },
];

function containerViewerData(entry: CompressedListEntry): CsidContainerData | undefined {
  if (entry.kind === "ORDINARY") return undefined;
  if (entry.kind === "REPLACE_CSID_PACKED") {
    const pairs: [number, number][] = [];
    for (let i = 0; i < entry.hextets.length; i += 2) pairs.push([entry.hextets[i], entry.hextets[i + 1]]);
    return {
      locatorBlockText: LOCATOR_BLOCK_TEXT,
      locatorBlockBits: 48,
      csidBits: 32,
      argumentBits: 0,
      isPackedContainer: true,
      slots: pairs.map((p, i) => ({ value: p[0] === 0 && p[1] === 0 ? "padding" : `${csidHexText(p[0])} / ${csidHexText(p[1])}`, owner: entry.segments[i]?.owner, role: p[0] === 0 && p[1] === 0 ? "padding" : "queued" })),
    };
  }
  if (entry.kind === "REPLACE_CSID_FIRST") {
    return {
      locatorBlockText: LOCATOR_BLOCK_TEXT,
      locatorBlockBits: 48,
      csidBits: 32,
      argumentBits: 48,
      indexValue: entry.hextets[7],
      slots: [{ value: `${csidHexText(entry.hextets[3])} / ${csidHexText(entry.hextets[4])}`, owner: entry.segments[0]?.owner, role: "active" }],
    };
  }
  const csidSlots = entry.hextets.slice(3);
  return {
    locatorBlockText: LOCATOR_BLOCK_TEXT,
    locatorBlockBits: 48,
    csidBits: 16,
    argumentBits: 64,
    slots: csidSlots.map((v, i) => ({ value: v === 0 ? "0000 (padding)" : csidHexText(v), owner: entry.segments[i]?.owner, role: v === 0 ? "padding" : i === 0 ? "active" : "queued" })),
  };
}

function srhToViewerData(srh: SegmentRoutingHeader): SegmentRoutingHeaderData {
  return {
    nextHeader: srh.nextHeader,
    hdrExtLen: srh.hdrExtLen,
    routingType: srh.routingType,
    segmentsLeft: srh.segmentsLeft,
    lastEntry: srh.lastEntry,
    flags: srh.flags,
    tag: srh.tag,
    segmentList: srh.segmentList.map((s) => ({ index: s.index, sid: s.isPackedContainer ? `packed: ${s.csidOwners?.join(", ") ?? "?"} (not a valid SID)` : fmtIpv6(s.hextets), label: s.label })),
  };
}

export default function Srv6CsidDemo() {
  const { engine, snapshot } = useScenarioEngine<Srv6CsidState>(createSrv6CsidState(), srv6CsidSteps);
  const [autoPlay, setAutoPlay] = useState(false);
  const [speed, setSpeed] = useState<0.5 | 1 | 2>(1);
  const [topoView, setTopoView] = useState<TopoView>("physical");
  const [viewMode3D, setViewMode3D] = useState(false);
  const [focusRouter, setFocusRouter] = useState<RouterId>("R1");
  const [selectedNodeId, setSelectedNodeId] = useState<RouterId | undefined>(undefined);
  const [cameraMode, setCameraMode] = useState<CameraMode>("overview");
  const [enteredDeviceId, setEnteredDeviceId] = useState<RouterId | undefined>(undefined);
  const [deviceXray, setDeviceXray] = useState(true);
  const [selectedInterfaceId, setSelectedInterfaceId] = useState<string | undefined>(undefined);
  const [selectedLinkId, setSelectedLinkId] = useState<string | undefined>(undefined);
  const [packetSelected, setPacketSelected] = useState(false);
  const [xrayMode, setXrayMode] = useState(true);
  const completeLesson = useProgressStore((s) => s.completeLesson);
  const recordAnswer = useProgressStore((s) => s.recordAnswer);
  const unlockAchievement = useProgressStore((s) => s.unlockAchievement);
  const awardedRef = useRef(false);

  const { state, currentStep, index, totalSteps, isComplete, lastAnswer, whatChanged, activePacket } = snapshot;
  const canAdvance = engine.canAdvance();
  const stepId = currentStep?.id ?? "";

  const isReplaceLab = index >= srv6CsidSteps.findIndex((s) => s.id === "replace-csid-intro") && index < srv6CsidSteps.findIndex((s) => s.id === "flavor-comparison");
  const activePkt = isReplaceLab ? state.replacePacket : state.packet;
  const activeJourney = isReplaceLab ? state.replaceJourney : state.journey;

  const nodes = GRAPH_NODES.map((n) => (topoView === "packet" && activePkt && n.id === state.packetAt ? { ...n, subLabel: `DA=${fmtIpv6(activePkt.daHextets)}` } : n));
  const edges = GRAPH_EDGES.filter((e) => e.id !== "R3-R5" && e.id !== "R6-R8" || stepId.startsWith("endx"));
  const activeNodeIds = activePacket ? [activePacket.from, activePacket.to] : [];
  const packetFrom = activePacket ? nodes.find((n) => n.id === activePacket.from) : undefined;
  const packetTo = activePacket ? nodes.find((n) => n.id === activePacket.to) : undefined;

  const cliCommands = useMemo(() => buildCsidCliCommands(state, focusRouter), [state, focusRouter]);
  const lastHop = activeJourney[activeJourney.length - 1];

  const nodes3DBase = useMemo(() => layoutTo3D(GRAPH_NODES), []);
  const visitedRouters = new Set(activeJourney.map((h) => h.router));
  const nodes3D = nodes3DBase.map((n) => {
    let status: Node3DStatus = "idle";
    if (n.id === selectedNodeId || n.id === enteredDeviceId) status = "selected";
    else if (activePacket && (n.id === activePacket.from || n.id === activePacket.to)) status = "active";
    else if (visitedRouters.has(n.id as RouterId)) status = "onPath";
    return { ...n, status };
  });
  const links3D: Link3DData[] = GRAPH_EDGES.map((e) => ({
    ...e,
    active: activePacket ? (e.a === activePacket.from && e.b === activePacket.to) || (e.b === activePacket.from && e.a === activePacket.to) : false,
    onPath: visitedRouters.has(e.a as RouterId) && visitedRouters.has(e.b as RouterId),
  }));
  const activePacket3D: ActivePacket3D | undefined = activePacket && nodes3D.some((n) => n.id === activePacket.from) && nodes3D.some((n) => n.id === activePacket.to) ? { packet: activePacket, fromId: activePacket.from, toId: activePacket.to } : undefined;
  const selectedNode3D = nodes3D.find((n) => n.id === selectedNodeId);

  const activeDeviceId = DEVICE_ROUTERS.find((r) => traceFor(r, state, stepId)?.activeStageId !== undefined);
  const effectiveDeviceId = cameraMode === "device" ? enteredDeviceId : undefined;
  const inDeviceMode = !!effectiveDeviceId;
  const deviceTrace = effectiveDeviceId ? traceFor(effectiveDeviceId, state, stepId) : undefined;
  const deviceInterfaces = effectiveDeviceId ? interfacesFor(effectiveDeviceId, state, stepId) : [];
  const devicePacketFrames = effectiveDeviceId ? packetFramesFor(state, deviceTrace?.activeStageId) : undefined;

  const followNode3D = selectedNode3D;
  const focusPosition3D: [number, number, number] | undefined = inDeviceMode ? [0, 0, deviceXray ? -0.2 : 0] : selectedNode3D?.position;
  const eyeOffset3D: [number, number, number] | undefined = inDeviceMode ? (deviceXray ? [0.6, 2.6, 5.2] : [2.1, 1.5, 3.8]) : undefined;

  const explainTargetId = effectiveDeviceId ?? selectedNodeId ?? followNode3D?.id;
  const nodeExplanation = explainTargetId ? explainNode(state, explainTargetId as RouterId) : undefined;
  const xrayPacket = activePacket && (selectedNodeId === activePacket.from || selectedNodeId === activePacket.to) ? activePacket : undefined;
  const selectedLinkDetail = selectedLinkId ? linkDetailFor(selectedLinkId, state) : undefined;
  const packetCurrentDeviceLabel = effectiveDeviceId ?? state.packetAt ?? activePacket?.from ?? "—";
  const devicePacketForTab = xrayPacket ?? (effectiveDeviceId && state.packetAt === effectiveDeviceId ? activePacket : undefined);

  const structures = liveStructures(state);
  const headendTabs: DeviceExplorerTab[] = nodeExplanation
    ? [
        { id: "overview", label: "Overview", content: <OverviewTab action={nodeExplanation.currentAction} note={nodeExplanation.note} /> },
        { id: "interfaces", label: "Interfaces", content: <InterfaceListTab interfaces={deviceInterfaces} selectedInterfaceId={selectedInterfaceId} onSelectInterface={setSelectedInterfaceId} /> },
        { id: "structures", label: "SID Structures", content: <RowsTab rows={ALL_ROUTERS.filter((r) => r !== "R1").map((r) => ({ label: r, value: structures[r] ? `LBL=${structures[r]!.lbl} LNL=${structures[r]!.lnl} FL=${structures[r]!.fl} AL=${structures[r]!.al}` : "unknown" }))} /> },
        { id: "program", label: "Original Segment List", content: <RowsTab rows={BASE_PROGRAM.map((s) => ({ label: s.id, value: `${s.owner} (${s.behavior})` }))} /> },
        { id: "plan", label: "Compression Plan", content: <RowsTab rows={compressNextCsidRun(BASE_PROGRAM, structures).entries.map((e, i) => ({ label: `Entry ${i}`, value: e.label }))} /> },
        { id: "packet", label: "Packet", content: devicePacketForTab ? <PacketInspector packet={devicePacketForTab} /> : <p className="text-xs text-pv-text-faint">No packet right now.</p> },
        { id: "cli", label: "CLI", content: <CLIOutputPanel commands={cliCommands} /> },
      ]
    : [];
  const endpointTabs: DeviceExplorerTab[] = nodeExplanation
    ? [
        { id: "overview", label: "Overview", content: <OverviewTab action={nodeExplanation.currentAction} note={nodeExplanation.note} /> },
        { id: "interfaces", label: "Interfaces", content: <InterfaceListTab interfaces={deviceInterfaces} selectedInterfaceId={selectedInterfaceId} onSelectInterface={setSelectedInterfaceId} /> },
        { id: "locator-node", label: "Locator-Block / Local CSID", content: <RowsTab rows={[{ label: "Locator-Block", value: LOCATOR_BLOCK_TEXT }, { label: "Locator-Node", value: effectiveDeviceId ? csidHexText(NEXT_CSID_VALUE[effectiveDeviceId]) : "—" }]} /> },
        { id: "structure", label: "SID Structure", content: <RowsTab rows={effectiveDeviceId && structures[effectiveDeviceId] ? [{ label: "LBL", value: String(structures[effectiveDeviceId]!.lbl) }, { label: "LNL", value: String(structures[effectiveDeviceId]!.lnl) }, { label: "FL", value: String(structures[effectiveDeviceId]!.fl) }, { label: "AL", value: String(structures[effectiveDeviceId]!.al) }] : []} /> },
        { id: "processing", label: isReplaceLab ? "REPLACE-CSID Processing" : "NEXT-CSID Processing", content: <RowsTab rows={lastHop ? [{ label: "Input DA", value: lastHop.input }, { label: "Lookup", value: lastHop.lookup }, { label: "Action", value: lastHop.action }, { label: "Output DA", value: lastHop.output }] : []} /> },
        { id: "packet", label: "Packet", content: devicePacketForTab ? <PacketInspector packet={devicePacketForTab} /> : <p className="text-xs text-pv-text-faint">No packet right now.</p> },
        { id: "cli", label: "CLI", content: <CLIOutputPanel commands={cliCommands} /> },
      ]
    : [];

  const mainDiagnosticLayers: DiagnosticLayer[] = [
    { label: "SR Policy Validity", status: "healthy" },
    { label: "SID Semantic List", status: "healthy" },
    { label: `${state.mainFault.targetRouter} Reachability`, status: "healthy" },
    { label: "NEXT-CSID Capability", status: "healthy" },
    { label: `${state.mainFault.targetRouter} Structure Advertised`, status: "healthy" },
    { label: "LBL / LNFL Non-Zero", status: "healthy" },
    { label: "AL Matches 128-LBL-LNL-FL", status: state.mainFault.active && !state.mainFault.repaired ? "failing" : "healthy" },
    { label: `${state.mainFault.targetRouter} Compressible`, status: state.mainFault.active && !state.mainFault.repaired ? "failing" : "healthy" },
  ];
  const challengeDiagnosticLayers: DiagnosticLayer[] = [
    { label: "SR Policy Validity", status: "healthy" },
    { label: `${state.challengeFault.targetRouter} Reachability`, status: "healthy" },
    { label: "AL Matches 128-LBL-LNL-FL", status: state.challengeFault.active && !state.challengeFault.repaired ? "failing" : "healthy" },
    { label: `${state.challengeFault.targetRouter} Compressible`, status: state.challengeFault.active && !state.challengeFault.repaired ? "failing" : "healthy" },
  ];

  useEffect(() => {
    if (isComplete && !awardedRef.current) {
      awardedRef.current = true;
      completeLesson("srv6-csid", 850);
      unlockAchievement("srv6-compression-engineer");
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
    setTopoView("physical");
    setViewMode3D(false);
  };

  const nextLabel = currentStep?.question && !lastAnswer ? "Answer to continue" : currentStep?.requiresState && !canAdvance ? "Apply the correct fix to continue" : "Next Step →";

  // --- step-anchored panels ---
  const containerA = useMemo(() => compressNextCsidRun(BASE_PROGRAM, structures).entries[0], [structures]);
  const containerB = useMemo(() => compressNextCsidRun(BASE_PROGRAM, structures).entries[1], [structures]);
  const oneContainerPlan = useMemo(() => compressNextCsidRun(BASE_PROGRAM.slice(0, 4), structures), [structures]);
  const endxPlan = useMemo(() => compressNextCsidRun(ENDX_PROGRAM, structures), [structures]);
  const faultPlan = useMemo(() => compressNextCsidRun(BASE_PROGRAM, structures), [structures]);
  const replaceProgramForView = useMemo(() => [{ id: "T1", owner: "R2" as RouterId, behavior: "END" as const }, { id: "T2", owner: "R3" as RouterId, behavior: "END" as const }, { id: "T3", owner: "R4" as RouterId, behavior: "END" as const }, { id: "T4", owner: "R8" as RouterId, behavior: "END_DT4" as const }], []);
  const replacePlan = useMemo(() => compressReplaceCsidRun(replaceProgramForView, structures), [structures, replaceProgramForView]);
  const fullMetrics = useMemo(() => calculateCompressionMetrics(BASE_PROGRAM.length, compressNextCsidRun(BASE_PROGRAM, structures)), [structures]);
  const mtuUncompressed = calculateModeledPacketSize(BASE_PROGRAM.length * 16, true, 1400);
  const mtuCompressed = calculateModeledPacketSize(2 * 16, true, 1400);

  const flavorRows = [
    { property: "First container", nextCsid: "Fully formed SID + Argument", replaceCsid: "Fully formed SID + Index" },
    { property: "Later containers", nextCsid: "Also fully formed SIDs", replaceCsid: "Packed (not valid SIDs)" },
    { property: "Locator-Block repetition", nextCsid: "Every container", replaceCsid: "First container only" },
    { property: "Active advancement", nextCsid: "Shift Argument", replaceCsid: "Reconstruct from Index" },
    { property: "Index usage", nextCsid: "None", replaceCsid: "Tracks packed position" },
    { property: "Typical CSID size (this lesson)", nextCsid: "16 bits", replaceCsid: "32 bits" },
    { property: "Service behavior support", nextCsid: "None", replaceCsid: "End.DX*/End.DT* family" },
    { property: "IPv6 DA validity", nextCsid: "Always a valid SID", replaceCsid: "Always a valid SID" },
  ];

  return (
    <div className="mx-auto max-w-7xl px-6 py-10">
      <div className="mb-6">
        <Badge tone="cyan" className="mb-3">
          RFC 9800 · SRv6 COMPRESSED SID (CSID / uSID) · NEXT-CSID + REPLACE-CSID
        </Badge>
        <h1 className="text-2xl font-semibold text-pv-text sm:text-3xl">Compression Changes Encoding. Never Intent.</h1>
        <p className="mt-2 max-w-3xl text-sm text-pv-text-muted">
          The same S1 → S2 → ... → S8 program, folded into one or two 128-bit containers instead of eight independent SIDs — while every
          segment&apos;s meaning, and RFC 8754&apos;s reversed Segment List storage order, stay exactly as they were.
        </p>
      </div>

      <div className="mb-4 grid gap-2 sm:grid-cols-4">
        {WHY_CSID.map((item) => (
          <GlassPanel key={item.q} className="p-3">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-pv-cyan-soft">{item.q}</p>
            <p className="text-[11px] leading-snug text-pv-text-muted">{item.a}</p>
          </GlassPanel>
        ))}
      </div>

      <div className="mb-4 flex gap-1 overflow-x-auto pb-2">
        {srv6CsidSteps.map((step, i) => (
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
        <TopologyModeSwitcher options={[{ value: "physical", label: "Physical" }, { value: "packet", label: "Packet" }]} value={topoView} onChange={setTopoView} />
        <TopologyModeSwitcher options={[{ value: "off", label: "2D" }, { value: "on", label: "3D View" }]} value={viewMode3D ? "on" : "off"} onChange={(v) => setViewMode3D(v === "on")} tone="violet" />
        {viewMode3D && (
          <>
            <TopologyModeSwitcher
              options={[{ value: "overview", label: "Overview" }, { value: "device", label: "Device" }, { value: "freeOrbit", label: "Free Orbit" }]}
              value={cameraMode === "packetFollow" ? "overview" : cameraMode}
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
            <TopologyModeSwitcher options={[{ value: "off", label: "Normal View" }, { value: "on", label: "X-Ray Packet View" }]} value={xrayMode ? "on" : "off"} onChange={(v) => setXrayMode(v === "on")} tone="violet" />
          </>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_400px]">
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
                    ? { deviceLabel: effectiveDeviceId!, interfaces: deviceInterfaces, xray: deviceXray, trace: deviceTrace, packetFrames: devicePacketFrames, onSelectInterface: setSelectedInterfaceId, selectedInterfaceId, onSelectPacket: () => { setPacketSelected(true); setAutoPlay(false); }, packetSelected }
                    : undefined
                }
              />
              {packetSelected && activePacket && (
                <PacketDetailPanel packet={activePacket} currentDevice={packetCurrentDeviceLabel} direction="R1 → ... → R8" paused={packetSelected} onResume={() => setPacketSelected(false)} onStepForward={() => engine.advance()} onStepBack={() => engine.goTo(Math.max(0, index - 1))} canStepForward={canAdvance} canStepBack={index > 0} onClose={() => setPacketSelected(false)} />
              )}
              {selectedLinkDetail && !packetSelected && <LinkDetailPanel detail={selectedLinkDetail} onClose={() => setSelectedLinkId(undefined)} />}
              {inDeviceMode && !packetSelected && !selectedLinkDetail ? (
                <DeviceExplorerPanel explanation={nodeExplanation!} tabs={effectiveDeviceId === "R1" ? headendTabs : endpointTabs} xrayEnabled={deviceXray} onToggleXray={() => setDeviceXray((v) => !v)} onExit={() => { setCameraMode("overview"); setEnteredDeviceId(undefined); }} />
              ) : (
                !packetSelected &&
                !selectedLinkDetail && (
                  <NodeInspectorPanel explanation={nodeExplanation} packet={xrayPacket} xrayEnabled={xrayMode}>
                    {selectedNodeId && DEVICE_ROUTERS.includes(selectedNodeId) && (
                      <Button size="sm" onClick={() => { setEnteredDeviceId(selectedNodeId); setCameraMode("device"); }}>
                        Enter Device →
                      </Button>
                    )}
                  </NodeInspectorPanel>
                )
              )}
            </>
          ) : (
            <>
              <GraphTopologyViewer nodes={nodes} edges={edges} activeNodeIds={activeNodeIds}>
                {activePacket && packetFrom && packetTo && <GraphPacket packet={activePacket} from={packetFrom} to={packetTo} />}
              </GraphTopologyViewer>
              {lastHop && (
                <GlassPanel className="p-4">
                  <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-pv-text-muted">Forwarding Decision — {lastHop.router}</h4>
                  <p className="pv-mono text-[11px] text-pv-text-muted">In: <span className="text-pv-text">{lastHop.input}</span></p>
                  <p className="pv-mono text-[11px] text-pv-text-muted">Lookup: <span className="text-pv-text">{lastHop.lookup}</span></p>
                  <p className="pv-mono text-[11px] text-pv-text-muted">Action: <span className="text-pv-cyan-soft">{lastHop.action}</span> → <span className="text-pv-text">{lastHop.output}</span></p>
                </GlassPanel>
              )}
            </>
          )}

          {!isComplete && currentStep && (
            <GlassPanel strong className="p-6">
              <div className="mb-2 flex items-center gap-2">
                <Badge tone="muted">Step {index + 1} / {totalSteps}</Badge>
                <span className="text-xs text-pv-text-faint">{currentStep.label}</span>
              </div>
              <p className="text-sm leading-relaxed text-pv-text">{currentStep.narrative}</p>
            </GlassPanel>
          )}

          {!isComplete && currentStep?.question && <PredictionQuestion question={currentStep.question} selectedOptionId={lastAnswer?.stepId === currentStep.id ? lastAnswer.optionId : undefined} onAnswer={handleAnswer} />}

          {!isComplete && currentStep?.requiresState && (
            <GlassPanel strong className="p-5">
              <Button onClick={() => engine.act({})} disabled={canAdvance}>
                {canAdvance ? "✓ Applied" : stepId === "challenge-verify" ? "Verify Repair" : "Apply Repair"}
              </Button>
            </GlassPanel>
          )}

          {whatChanged.length > 0 && !currentStep?.question && (
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

          {stepId === "compress-first-container" && containerA && containerViewerData(containerA) && <CsidContainerViewer title="Container A" data={containerViewerData(containerA)!} />}
          {(stepId === "compress-second-container" || stepId === "full-srh-two-containers") && containerB && containerViewerData(containerB) && <CsidContainerViewer title="Container B" data={containerViewerData(containerB)!} />}
          {(stepId === "full-srh-two-containers" || stepId === "mandatory-resend") && buildDaAndSrh(compressNextCsidRun(BASE_PROGRAM, structures)).srh && (
            <SegmentRoutingHeaderViewer activeDa={fmtIpv6(buildDaAndSrh(compressNextCsidRun(BASE_PROGRAM, structures)).daHextets)} srh={srhToViewerData(buildDaAndSrh(compressNextCsidRun(BASE_PROGRAM, structures)).srh!)} />
          )}
          {stepId === "one-container-intro" && oneContainerPlan.entries[0] && containerViewerData(oneContainerPlan.entries[0]) && <CsidContainerViewer title="Single Container (No SRH)" data={containerViewerData(oneContainerPlan.entries[0])!} />}
          {stepId === "endx-setup" &&
            endxPlan.entries.map((e, i) => containerViewerData(e) && <CsidContainerViewer key={i} title={i === 0 ? "Container A (R2..R6, End.X)" : "Container B (R8 only)"} data={containerViewerData(e)!} />)}
          {stepId === "fault-consequence" && (
            <GlassPanel strong className="space-y-3 p-5">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-pv-violet">Partial Compression — Live Plan</h3>
              {faultPlan.entries.map((e, i) => (
                <div key={i}>
                  {containerViewerData(e) ? <CsidContainerViewer title={e.label} data={containerViewerData(e)!} /> : <p className="pv-mono rounded-lg border border-pv-warning/40 bg-pv-warning/5 p-2.5 text-xs text-pv-text">{e.label} — {fmtIpv6(e.hextets)}</p>}
                </div>
              ))}
            </GlassPanel>
          )}
          {(stepId === "wrong-repair-metric" || stepId === "wrong-repair-preference" || stepId === "wrong-repair-ignore-structure" || stepId === "repair-challenge" || stepId === "trouble-question" || stepId === "diagnostic-ladder") && (
            <TroubleshootingLayers title="Diagnostic Ladder — R4" layers={mainDiagnosticLayers} />
          )}
          {(stepId === "challenge-diagnose" || stepId === "challenge-repair" || stepId === "challenge-verify") && <TroubleshootingLayers title="Diagnostic Ladder — R6 (Challenge)" layers={challengeDiagnosticLayers} />}
          {stepId === "final-service-sid-experiment" && (
            <GlassPanel className="space-y-2 p-4">
              <p className="pv-mono text-xs text-pv-text">Final entry (ordinary, real L3VPN reuse): {PE2_DT4_SID.sidText}</p>
              {containerA && containerViewerData(containerA) && <CsidContainerViewer title="Container [R2,R3]" data={{ ...containerViewerData(containerA)!, slots: containerViewerData(containerA)!.slots.slice(0, 5) }} />}
            </GlassPanel>
          )}
          {stepId === "compression-comparison" && (
            <GlassPanel className="p-4">
              <div className="grid gap-2 sm:grid-cols-2 text-xs">
                <div className="rounded-lg border border-pv-border p-2.5"><p className="mb-1 font-semibold text-pv-text-faint">Uncompressed (7 SIDs)</p><p className="pv-mono text-pv-text">7 × 16 = 112 bytes</p></div>
                <div className="rounded-lg border border-pv-cyan/40 bg-pv-cyan/5 p-2.5"><p className="mb-1 font-semibold text-pv-cyan-soft">NEXT-CSID (2 entries)</p><p className="pv-mono text-pv-text">2 × 16 = 32 bytes</p></div>
              </div>
            </GlassPanel>
          )}
          {stepId === "compression-metrics-viewer" && <Srv6CompressionMetricsViewer data={fullMetrics} />}
          {stepId === "mtu-lab" && (
            <GlassPanel className="p-4">
              <div className="grid gap-2 sm:grid-cols-2 text-xs">
                <div className="rounded-lg border border-pv-border p-2.5"><p className="mb-1 font-semibold text-pv-text-faint">Uncompressed</p><p className="pv-mono text-pv-text">total modeled encapsulation: {mtuUncompressed.totalBytes}B (SRH {mtuUncompressed.srhBytes}B)</p></div>
                <div className="rounded-lg border border-pv-cyan/40 bg-pv-cyan/5 p-2.5"><p className="mb-1 font-semibold text-pv-cyan-soft">Compressed</p><p className="pv-mono text-pv-text">total modeled encapsulation: {mtuCompressed.totalBytes}B (SRH {mtuCompressed.srhBytes}B)</p></div>
              </div>
            </GlassPanel>
          )}
          {stepId === "replace-first-container" && replacePlan.entries[0] && containerViewerData(replacePlan.entries[0]) && <CsidContainerViewer title="First Container (Fully Formed SID)" data={containerViewerData(replacePlan.entries[0])!} />}
          {stepId === "replace-packed-containers" && replacePlan.entries[1] && containerViewerData(replacePlan.entries[1]) && <CsidContainerViewer title="Packed Container" data={containerViewerData(replacePlan.entries[1])!} />}
          {stepId === "replace-dt4-execute" && (
            <GlassPanel className="p-4">
              <p className="pv-mono text-xs text-pv-text">Decap + IPv4 VRF lookup for {CSID_CUST_HOST} — delivered via End.DT4.</p>
            </GlassPanel>
          )}
          {stepId === "flavor-comparison" && <CsidFlavorComparisonViewer rows={flavorRows} />}

          {isComplete && (
            <GlassPanel strong glow="success" className="flex flex-col items-center gap-4 p-10 text-center">
              <Badge tone="success">SRv6 Compression Engineer</Badge>
              <h2 className="text-2xl font-semibold text-pv-text">Same Program. Smaller Wire Footprint.</h2>
              <p className="max-w-md text-sm text-pv-text-muted">
                You built RFC 9800 NEXT-CSID and REPLACE-CSID compression end to end: real structure validation, real container
                construction, an intra-container shift that never touches Segments Left, a real container-boundary crossing that
                does, partial compression around one broken structure, and a REPLACE-CSID sequence ending in a real End.DT4 SID.
                +850 XP awarded.
              </p>
              <div className="flex gap-3">
                <Button onClick={handleRestart} variant="secondary">Restart Lesson</Button>
                <Link href="/dashboard"><Button>View Dashboard</Button></Link>
              </div>
            </GlassPanel>
          )}

          {!isComplete && (
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="secondary" size="sm" onClick={() => engine.goTo(Math.max(0, index - 1))} disabled={index === 0}>← Previous</Button>
              <Button size="sm" onClick={() => engine.advance()} disabled={!canAdvance}>{nextLabel}</Button>
              <Button variant={autoPlay ? "primary" : "ghost"} size="sm" onClick={() => setAutoPlay((v) => !v)}>{autoPlay ? "⏸ Auto-Playing" : "▶ Auto-Play"}</Button>
              <div className="flex gap-1 rounded-full border border-pv-border p-0.5">
                {([0.5, 1, 2] as const).map((s) => (
                  <button key={s} type="button" onClick={() => setSpeed(s)} className={clsx("rounded-full px-2.5 py-1 text-[10px] font-semibold pv-mono transition-colors", speed === s ? "bg-pv-cyan/15 text-pv-cyan-soft" : "text-pv-text-faint hover:text-pv-text")}>{s}x</button>
                ))}
              </div>
              <Button variant="ghost" size="sm" onClick={handleRestart}>⟲ Restart</Button>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <PacketInspector packet={activePacket} />

          <div className="flex flex-wrap gap-1 rounded-full border border-pv-border p-0.5 w-fit">
            {ALL_ROUTERS.map((r) => (
              <button key={r} type="button" onClick={() => setFocusRouter(r)} className={clsx("rounded-full px-3 py-1 text-[11px] font-semibold pv-mono transition-colors", focusRouter === r ? "bg-pv-cyan/15 text-pv-cyan-soft" : "text-pv-text-faint hover:text-pv-text")}>{r}</button>
            ))}
          </div>

          <GlassPanel className="p-4">
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-pv-text-muted">{focusRouter}</h4>
            {focusRouter === "R1" ? (
              <p className="text-xs text-pv-text-faint">Headend — validates structures and compresses the logical program.</p>
            ) : (
              <div className="space-y-1 pv-mono text-[11px] text-pv-text-muted">
                <p>Locator-Node: {csidHexText(NEXT_CSID_VALUE[focusRouter])}</p>
                <p>Ordinary SID: {ordinarySidText(focusRouter)}</p>
              </div>
            )}
          </GlassPanel>

          <PacketJourneyTimeline hops={activeJourney} />
          <CLIOutputPanel commands={cliCommands} />
        </div>
      </div>
    </div>
  );
}

function OverviewTab({ action, note }: { action: string; note?: string }) {
  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-pv-cyan/30 bg-pv-cyan/5 p-3">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-pv-cyan-soft">Current Action</p>
        <p className="text-sm text-pv-text">{action}</p>
      </div>
      {note && <p className="rounded-lg border border-pv-warning/30 bg-pv-warning/5 p-2.5 text-xs text-pv-text-muted">{note}</p>}
    </div>
  );
}

function RowsTab({ rows }: { rows: { label: string; value: string }[] }) {
  if (rows.length === 0) return <p className="text-xs text-pv-text-faint">Nothing to show yet.</p>;
  return (
    <div className="space-y-1 pv-mono text-[11px]">
      {rows.map((r) => (
        <div key={r.label} className="flex justify-between gap-3 rounded-lg border border-pv-border p-2">
          <span className="text-pv-text-faint">{r.label}</span>
          <span className="text-right text-pv-text">{r.value}</span>
        </div>
      ))}
    </div>
  );
}
