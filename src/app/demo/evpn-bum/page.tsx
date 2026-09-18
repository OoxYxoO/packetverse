"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { clsx } from "clsx";
import { useScenarioEngine } from "@/lib/sim-engine/useScenarioEngine";
import {
  EVPN_EXPORT_RT,
  evpnBumSteps,
  FABRIC_DEVICES,
  GRAPH_EDGES,
  GRAPH_NODES,
  GRAPH_REGIONS,
  LEAF_IDS,
  LOGICAL_GRAPH_EDGES,
  LOGICAL_GRAPH_NODES,
  TERMS,
  VNI,
  createEvpnBumState,
  outerIpLayerIndex,
  replicaPacket,
  vniLayerIndex,
  withEvpnMesh,
  type EvpnBumDeviceId,
  type EvpnBumState,
  type LeafId,
} from "@/lib/sim-engine/scenarios/evpnBum";
import { GraphTopologyViewer } from "@/components/network/GraphTopologyViewer";
import { GraphPacket } from "@/components/network/GraphPacket";
import { PacketInspector } from "@/components/network/PacketInspector";
import { ForwardingDecisionCard } from "@/components/protocol/ForwardingDecisionCard";
import { PacketJourneyTimeline } from "@/components/protocol/PacketJourneyTimeline";
import { PlaneSplitPanel } from "@/components/protocol/PlaneSplitPanel";
import { FloodListViewer } from "@/components/protocol/FloodListViewer";
import { TroubleshootingLayers, type DiagnosticLayer } from "@/components/protocol/TroubleshootingLayers";
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
import { layoutRegionsTo3D, layoutTo3D } from "@/components/network3d/layout";
import type { ActivePacket3D, CameraMode, Link3DData, Node3DStatus } from "@/components/network3d/types";
import { explainNode } from "./explain";
import { floodListRows, interfacesFor, linkDetailFor, packetFramesFor, traceFor } from "./deviceTrace";

const WHY_BUM: { q: string; a: string }[] = [
  { q: "WHAT is BUM traffic?", a: "Broadcast, Unknown-unicast, Multicast — any frame with no single known destination MAC to look up." },
  { q: "WHY does it need special handling?", a: "A VXLAN fabric has no shared wire to \"just broadcast on\" — every remote VTEP that matters has to get its own copy." },
  { q: "WHAT is Route Type 3?", a: "Inclusive Multicast Ethernet Tag (IMET) — a VTEP announcing \"I participate in this VNI,\" building the flood list Type 2 never could." },
  { q: "WITHOUT Type 3?", a: "A VTEP would have no verifiable way to know which remote VTEPs are even in the broadcast domain." },
];

const REPAIR_OPTIONS = [
  { id: "restart-session", label: "Restart the LEAF1 ↔ LEAF2 ↔ LEAF3 BGP EVPN session" },
  { id: "flap-uplink", label: "Flap LEAF3's uplink to SPINE1" },
  { id: "fix-rt", label: `Fix LEAF3's Type 3 (IMET) export RT to match the shared EVPN RT (${EVPN_EXPORT_RT})` },
  { id: "manual-flood-entry", label: "Manually add LEAF3 to LEAF1's flood list" },
];
const WRONG_FEEDBACK: Record<string, string> = {
  "restart-session": "The BGP EVPN session is already Established — restarting it won't change route-target import policy at all.",
  "flap-uplink": "The underlay and VTEP reachability are already healthy — this doesn't touch RT policy.",
  "manual-flood-entry": "That would mask the symptom, not fix it — and it abandons the whole point of a distributed control plane: a real Type 3 route, not a hand-typed flood-list entry.",
};

export default function EvpnBumDemo() {
  const { engine, snapshot } = useScenarioEngine<EvpnBumState>(createEvpnBumState(), evpnBumSteps);
  const [autoPlay, setAutoPlay] = useState(false);
  const [speed, setSpeed] = useState<0.5 | 1 | 2>(1);
  const [viewMode, setViewMode] = useState<"physical" | "logical" | "3d">("physical");
  const [planeView, setPlaneView] = useState<"control" | "data" | "both">("both");
  const [focusLeaf, setFocusLeaf] = useState<LeafId>("LEAF1");
  const [selectedNodeId, setSelectedNodeId] = useState<EvpnBumDeviceId | undefined>(undefined);
  const [cameraMode, setCameraMode] = useState<CameraMode>("overview");
  const [enteredDeviceId, setEnteredDeviceId] = useState<EvpnBumDeviceId | undefined>(undefined);
  const [deviceXray, setDeviceXray] = useState(true);
  const [selectedInterfaceId, setSelectedInterfaceId] = useState<string | undefined>(undefined);
  const [selectedLinkId, setSelectedLinkId] = useState<string | undefined>(undefined);
  const [selectedFloodCopyId, setSelectedFloodCopyId] = useState<string | undefined>(undefined);
  const [packetSelected, setPacketSelected] = useState(false);
  const [xrayMode, setXrayMode] = useState(true);
  const completeLesson = useProgressStore((s) => s.completeLesson);
  const recordAnswer = useProgressStore((s) => s.recordAnswer);
  const unlockAchievement = useProgressStore((s) => s.unlockAchievement);

  const { state, currentStep, index, totalSteps, isComplete, lastAnswer, whatChanged, activePacket } = snapshot;
  const canAdvance = engine.canAdvance();

  const sessionActive = state.bgpSessionUp;
  const baseNodes = viewMode === "physical" ? GRAPH_NODES : LOGICAL_GRAPH_NODES;
  const baseEdges = viewMode === "physical" ? GRAPH_EDGES : LOGICAL_GRAPH_EDGES;
  const augmented = withEvpnMesh(baseNodes, baseEdges, sessionActive);
  const nodes = augmented.nodes;
  const edges = augmented.edges.map((e) => ({ ...e, state: "full" as const }));
  const activeNodeIds = activePacket ? [activePacket.from, activePacket.to] : [];
  const packetFrom = activePacket ? nodes.find((n) => n.id === activePacket.from) : undefined;
  const packetTo = activePacket ? nodes.find((n) => n.id === activePacket.to) : undefined;

  const focusIndicesFor = (device: EvpnBumDeviceId | undefined, packet: typeof activePacket) => {
    if (device === "SPINE1") return outerIpLayerIndex(packet);
    if (device === "LEAF2" || device === "LEAF3") return vniLayerIndex(packet);
    return undefined;
  };
  const focusIndices = focusIndicesFor(state.packetAt, activePacket);
  const lastHop = state.journey[state.journey.length - 1];
  const showPlanes = index >= evpnBumSteps.findIndex((s) => s.id === "send-broadcast");
  const showTroubleshootLayers = index >= evpnBumSteps.findIndex((s) => s.id === "break-intro");

  // --- 3D derived state ---
  const physicalAugmented = withEvpnMesh(GRAPH_NODES, GRAPH_EDGES, sessionActive);
  const nodes3DBase = layoutTo3D(physicalAugmented.nodes);
  const regions3D = layoutRegionsTo3D(GRAPH_REGIONS);
  const visitedDevices = new Set(state.journey.map((h) => h.device));
  if (state.packet) visitedDevices.add("HOST-A");
  const nodes3D = nodes3DBase.map((n) => {
    let status: Node3DStatus = "idle";
    if (n.id === selectedNodeId || n.id === enteredDeviceId) status = "selected";
    else if (activePacket && (n.id === activePacket.from || n.id === activePacket.to)) status = "active";
    else if (state.replicaStage === "leaf1-to-spine" && (n.id === "LEAF1" || n.id === "SPINE1")) status = "active";
    else if (state.replicaStage === "spine-to-leaves" && (n.id === "SPINE1" || n.id === "LEAF2" || n.id === "LEAF3")) status = "active";
    else if (visitedDevices.has(n.id as EvpnBumDeviceId)) status = "onPath";
    const badges = n.id === "LEAF1" || n.id === "LEAF2" || n.id === "LEAF3" ? ["VTEP"] : n.id === "SPINE1" ? ["UNDERLAY ONLY"] : undefined;
    return { ...n, status, badges };
  });
  const links3D: Link3DData[] = physicalAugmented.edges.map((e) => ({
    ...e,
    active: activePacket ? (e.a === activePacket.from && e.b === activePacket.to) || (e.b === activePacket.from && e.a === activePacket.to) : false,
    onPath: visitedDevices.has(e.a as EvpnBumDeviceId) && visitedDevices.has(e.b as EvpnBumDeviceId),
  }));
  const activePacket3D: ActivePacket3D | undefined =
    activePacket && nodes3D.some((n) => n.id === activePacket.from) && nodes3D.some((n) => n.id === activePacket.to) ? { packet: activePacket, fromId: activePacket.from, toId: activePacket.to } : undefined;
  const questionActive = !isComplete && !!currentStep?.question && lastAnswer?.stepId !== currentStep.id;
  const floodCopies3D: FloodCopy3D[] | undefined =
    state.replicaStage === "leaf1-to-spine"
      ? state.replicas.map((r) => ({ id: r.id, fromId: "LEAF1", toId: "SPINE1" }))
      : state.replicaStage === "spine-to-leaves"
        ? state.replicas.map((r) => ({ id: r.id, fromId: "SPINE1", toId: r.toLeaf }))
        : undefined;
  const selectedNode3D = nodes3D.find((n) => n.id === selectedNodeId);

  const isFabricDevice = (id: EvpnBumDeviceId | undefined): id is "LEAF1" | "SPINE1" | "LEAF2" | "LEAF3" => id === "LEAF1" || id === "SPINE1" || id === "LEAF2" || id === "LEAF3";
  const activeDeviceId = FABRIC_DEVICES.find((d) => isFabricDevice(d) && traceFor(d, state, currentStep?.id ?? "").activeStageId !== undefined);
  const effectiveDeviceId = cameraMode === "device" ? enteredDeviceId : undefined;
  const inDeviceMode = !!effectiveDeviceId;

  const deviceTrace = isFabricDevice(effectiveDeviceId) ? traceFor(effectiveDeviceId, state, currentStep?.id ?? "") : undefined;
  const deviceInterfaces = isFabricDevice(effectiveDeviceId) ? interfacesFor(effectiveDeviceId, state, currentStep?.id ?? "") : [];
  const devicePacketFrames = effectiveDeviceId ? packetFramesFor(state) : undefined;

  const focusPosition3D: [number, number, number] | undefined = cameraMode === "freeOrbit" ? undefined : inDeviceMode ? [0, 0, deviceXray ? -0.2 : 0] : selectedNode3D?.position;
  const eyeOffset3D: [number, number, number] | undefined = inDeviceMode ? (deviceXray ? [0.6, 2.6, 5.2] : [2.1, 1.5, 3.8]) : undefined;

  const explainTargetId = effectiveDeviceId ?? selectedNodeId;
  const nodeExplanation = explainTargetId ? explainNode(state, explainTargetId) : undefined;
  const xrayPacket = activePacket && (selectedNodeId === activePacket.from || selectedNodeId === activePacket.to) ? activePacket : undefined;

  const selectedLinkDetail = selectedLinkId ? linkDetailFor(selectedLinkId, state) : undefined;
  const selectedReplica = selectedFloodCopyId ? state.replicas.find((r) => r.id === selectedFloodCopyId) : undefined;
  const selectedReplicaPacket =
    selectedReplica && state.replicaStage !== "none"
      ? replicaPacket(selectedReplica, state.replicaStage === "leaf1-to-spine" ? "LEAF1" : "SPINE1", state.replicaStage === "leaf1-to-spine" ? "SPINE1" : selectedReplica.toLeaf, state.replicaStage !== "delivered")
      : undefined;
  const packetCurrentDeviceLabel = effectiveDeviceId ?? state.packetAt ?? activePacket?.from ?? "—";
  const devicePacketForTab = xrayPacket ?? (effectiveDeviceId && state.packetAt === effectiveDeviceId ? activePacket : undefined);

  const diagnosticLayers: DiagnosticLayer[] = [
    { label: "Physical", status: "healthy" },
    { label: "Underlay", status: "healthy" },
    { label: "VTEP Reachability", status: "healthy" },
    { label: "BGP EVPN", status: state.bgpSessionUp ? "healthy" : "unknown" },
    { label: "VNI", status: "healthy" },
    { label: "Type-3 Membership (LEAF3)", status: state.faultActive ? "failing" : state.floodList.LEAF1.includes("LEAF3") ? "healthy" : "unknown" },
    { label: "LEAF3 In Flood List", status: state.faultActive ? "failing" : state.floodList.LEAF1.includes("LEAF3") ? "healthy" : "unknown" },
    { label: "BUM Delivery To LEAF3", status: state.faultActive ? "failing" : state.floodList.LEAF1.includes("LEAF3") ? "healthy" : "unknown" },
  ];

  useEffect(() => {
    if (isComplete) {
      completeLesson("evpn-bum-type3", 300);
      unlockAchievement("flood-controller");
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
    setSelectedFloodCopyId(undefined);
    setPacketSelected(false);
  };

  const nextLabel = currentStep?.question && !lastAnswer ? "Answer to continue" : currentStep?.requiresState && !canAdvance ? "Apply the correct fix to continue" : "Next Step →";

  const explorerTabsFor = (device: "LEAF1" | "SPINE1" | "LEAF2" | "LEAF3"): DeviceExplorerTab[] => {
    if (!nodeExplanation) return [];
    const tabs: DeviceExplorerTab[] = [
      {
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
      },
      { id: "interfaces", label: "Interfaces", content: <InterfaceListTab interfaces={deviceInterfaces} selectedInterfaceId={selectedInterfaceId} onSelectInterface={setSelectedInterfaceId} /> },
    ];
    if (device === "SPINE1") {
      tabs.push({ id: "flood-list", label: "Flood List", content: <p className="text-xs text-pv-text-faint">SPINE1 is not a VTEP — it never builds a VNI flood list at all.</p> });
    } else {
      tabs.push({ id: "flood-list", label: "Flood List", content: <FloodListViewer title={device} vni={VNI} rows={floodListRows(state, device)} /> });
    }
    tabs.push({
      id: "packet",
      label: "Packet",
      content: devicePacketForTab ? <PacketInspector packet={devicePacketForTab} focusLayerIndices={xrayMode ? focusIndicesFor(device, devicePacketForTab) : undefined} /> : <p className="text-xs text-pv-text-faint">No single packet at this device right now — click a VXLAN copy in the 3D view during replication to inspect it.</p>,
    });
    tabs.push({
      id: "control",
      label: "Control Plane",
      content: (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {nodeExplanation.controlPlaneRole && (
            <div className="rounded-lg border border-pv-border p-2.5">
              <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-pv-text-faint">Control Plane</p>
              <p className="text-xs text-pv-text-muted">{nodeExplanation.controlPlaneRole}</p>
            </div>
          )}
          {nodeExplanation.dataPlaneRole && (
            <div className="rounded-lg border border-pv-border p-2.5">
              <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-pv-text-faint">Data Plane</p>
              <p className="text-xs text-pv-text-muted">{nodeExplanation.dataPlaneRole}</p>
            </div>
          )}
        </div>
      ),
    });
    return tabs;
  };

  return (
    <div className="mx-auto max-w-7xl px-6 py-10">
      <div className="mb-6">
        <Badge tone="cyan" className="mb-3">
          EVPN BUM + Route Type 3 (IMET) · Flood List + Ingress Replication
        </Badge>
        <h1 className="text-2xl font-semibold text-pv-text sm:text-3xl">One Broadcast, Every Site</h1>
        <p className="mt-2 max-w-3xl text-sm text-pv-text-muted">
          Route Type 2 answers &quot;where is this MAC?&quot; But a broadcast has no single MAC to look up. Watch LEAF1
          learn — via a completely different route type — exactly which remote VTEPs even participate in VNI 10010,
          then replicate one frame into several independent VXLAN copies.
        </p>
      </div>

      <div className="mb-4 grid gap-2 sm:grid-cols-4">
        {WHY_BUM.map((item) => (
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
        {evpnBumSteps.map((step, i) => (
          <button
            key={step.id}
            type="button"
            disabled={i > index}
            onClick={() => i < index && engine.goTo(i)}
            title={step.label}
            className={clsx(
              "h-1.5 flex-1 min-w-3 rounded-full transition-colors",
              i < index ? "bg-pv-success/70 hover:bg-pv-success cursor-pointer" : i === index ? "bg-pv-cyan" : "bg-white/10",
            )}
          />
        ))}
      </div>

      <div className="mb-6 flex flex-wrap gap-3">
        <TopologyModeSwitcher
          options={[
            { value: "physical", label: "Physical Topology" },
            { value: "logical", label: "Logical (L2 Segment) View" },
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
                { value: "freeOrbit", label: "Free Orbit" },
              ]}
              value={cameraMode}
              onChange={(v) => {
                setCameraMode(v);
                if (v === "device" && !enteredDeviceId) setEnteredDeviceId(isFabricDevice(selectedNodeId) ? selectedNodeId : (activeDeviceId ?? "LEAF1"));
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
              <TopologyQuickExpand questionActive={questionActive} nodes={nodes3D} links={links3D} activePacket={activePacket3D} regions={regions3D}>
              <NetworkScene3D
                nodes={nodes3D}
                links={links3D}
                activePacket={inDeviceMode ? undefined : activePacket3D}
                floodCopies={inDeviceMode ? undefined : floodCopies3D}
                onSelectFloodCopy={setSelectedFloodCopyId}
                selectedFloodCopyId={selectedFloodCopyId}
                regions={regions3D}
                onSelectNode={(id) => {
                  setSelectedNodeId(id as EvpnBumDeviceId);
                  setSelectedLinkId(undefined);
                  setSelectedFloodCopyId(undefined);
                  setPacketSelected(false);
                }}
                onSelectLink={(id) => {
                  setSelectedLinkId(id);
                  setSelectedNodeId(undefined);
                  setSelectedFloodCopyId(undefined);
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
                        pipelineTitle: effectiveDeviceId === "LEAF1" ? "Conceptual BUM Forwarding Pipeline" : effectiveDeviceId === "LEAF2" || effectiveDeviceId === "LEAF3" ? "Conceptual VXLAN Egress Pipeline" : "Conceptual Underlay Forwarding Pipeline",
                      }
                    : undefined
                }
              />
              </TopologyQuickExpand>

              {packetSelected && activePacket && (
                <PacketDetailPanel
                  packet={activePacket}
                  currentDevice={packetCurrentDeviceLabel}
                  direction="HOST-A → LEAF1 → (replicate) → SPINE1 → LEAF2 + LEAF3"
                  focusLayerIndices={xrayMode ? focusIndices : undefined}
                  paused={packetSelected}
                  onResume={() => setPacketSelected(false)}
                  onStepForward={() => engine.advance()}
                  onStepBack={() => engine.goTo(Math.max(0, index - 1))}
                  canStepForward={canAdvance}
                  canStepBack={index > 0}
                  onClose={() => setPacketSelected(false)}
                />
              )}

              {selectedReplicaPacket && !packetSelected && (
                <GlassPanel strong className="space-y-3 p-5">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-pv-text">VXLAN Copy Inspector</h3>
                    <button type="button" onClick={() => setSelectedFloodCopyId(undefined)} className="text-xs text-pv-text-faint hover:text-pv-text">
                      ✕
                    </button>
                  </div>
                  <p className="text-xs text-pv-text-muted">One of {state.replicas.length} independent VXLAN copies LEAF1 created from the single original broadcast frame.</p>
                  <PacketInspector packet={selectedReplicaPacket} />
                </GlassPanel>
              )}

              {selectedLinkDetail && !packetSelected && !selectedReplicaPacket && <LinkDetailPanel detail={selectedLinkDetail} onClose={() => setSelectedLinkId(undefined)} />}

              {inDeviceMode && !packetSelected && !selectedReplicaPacket && !selectedLinkDetail ? (
                <DeviceExplorerPanel
                  explanation={nodeExplanation!}
                  tabs={isFabricDevice(effectiveDeviceId) ? explorerTabsFor(effectiveDeviceId) : []}
                  xrayEnabled={deviceXray}
                  onToggleXray={() => setDeviceXray((v) => !v)}
                  onExit={() => {
                    setCameraMode("overview");
                    setEnteredDeviceId(undefined);
                  }}
                />
              ) : (
                !packetSelected &&
                !selectedReplicaPacket &&
                !selectedLinkDetail && (
                  <NodeInspectorPanel explanation={nodeExplanation} packet={xrayPacket} focusLayerIndices={xrayMode ? focusIndices : undefined} xrayEnabled={xrayMode}>
                    {selectedNodeId && isFabricDevice(selectedNodeId) && (
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
              <GraphTopologyViewer nodes={nodes} edges={edges} activeNodeIds={activeNodeIds} regions={viewMode === "physical" ? GRAPH_REGIONS : []}>
                {activePacket && packetFrom && packetTo && <GraphPacket packet={activePacket} from={packetFrom} to={packetTo} />}
              </GraphTopologyViewer>

              {state.replicaStage !== "none" && (
                <GlassPanel className="p-4">
                  <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-pv-violet">Ingress Replication — 2D Overview Doesn&apos;t Animate Simultaneous Copies</h4>
                  <p className="text-xs text-pv-text-muted">Switch to 3D View to watch both VXLAN copies travel independently — LEAF1 → SPINE1 → LEAF2 and LEAF1 → SPINE1 → LEAF3 — at the same time.</p>
                </GlassPanel>
              )}

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

          {showPlanes && !isComplete && (
            <PlaneSplitPanel
              show={planeView}
              controlTitle="Control Plane — BGP EVPN Type 3 (IMET)"
              controlRows={[
                { label: "BGP EVPN mesh", value: state.bgpSessionUp ? "Established" : "Not yet formed" },
                { label: "LEAF1 flood list", value: state.floodList.LEAF1.join(", ") || "(empty)" },
                { label: "LEAF2 flood list", value: state.floodList.LEAF2.join(", ") || "(empty)" },
                { label: "LEAF3 flood list", value: state.floodList.LEAF3.join(", ") || "(empty)" },
              ]}
              dataTitle="Data Plane — Ingress Replication"
              dataRows={
                state.replicaStage !== "none"
                  ? [
                      { label: "Stage", value: state.replicaStage },
                      { label: "VXLAN copies in flight", value: String(state.replicas.length) },
                      { label: "Targets", value: state.replicas.map((r) => r.toLeaf).join(", ") || "—" },
                    ]
                  : [{ label: "Frame", value: state.packet ? "original broadcast, not yet replicated" : "none in flight" }]
              }
            />
          )}

          {showTroubleshootLayers && !isComplete && <TroubleshootingLayers title="Troubleshooting Layers" layers={diagnosticLayers} />}

          {isComplete && (
            <GlassPanel strong glow="success" className="flex flex-col items-center gap-4 p-10 text-center">
              <Badge tone="success">Flood Controller</Badge>
              <h2 className="text-2xl font-semibold text-pv-text">Every Leaf Agrees On VNI 10010 Again</h2>
              <p className="max-w-md text-sm text-pv-text-muted">
                You watched LEAF1 replicate one broadcast frame into independent VXLAN copies using a real,
                BGP-distributed flood list — built by Route Type 3, not Route Type 2 — then repaired a Type 3 route
                target mismatch that had silently dropped LEAF3 out of the picture while unicast kept working fine.
                +300 XP awarded.
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
                  <button
                    key={s}
                    type="button"
                    onClick={() => setSpeed(s)}
                    className={clsx("rounded-full px-2.5 py-1 text-[10px] font-semibold pv-mono transition-colors", speed === s ? "bg-pv-cyan/15 text-pv-cyan-soft" : "text-pv-text-faint hover:text-pv-text")}
                  >
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
          <PacketInspector packet={activePacket} focusLayerIndices={xrayMode ? focusIndices : undefined} />

          <div className="flex flex-wrap gap-1 rounded-full border border-pv-border p-0.5 w-fit">
            {LEAF_IDS.map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => setFocusLeaf(l)}
                className={clsx("rounded-full px-3 py-1 text-[11px] font-semibold pv-mono transition-colors", focusLeaf === l ? "bg-pv-cyan/15 text-pv-cyan-soft" : "text-pv-text-faint hover:text-pv-text")}
              >
                {l}
              </button>
            ))}
          </div>

          <FloodListViewer title={focusLeaf} vni={VNI} rows={floodListRows(state, focusLeaf)} />

          <PacketJourneyTimeline hops={state.journey.map((h) => ({ router: h.device, action: h.action, output: h.output }))} />
        </div>
      </div>
    </div>
  );
}

function RepairChallenge({ options, attempt, onTry }: { options: { id: string; label: string }[]; attempt?: { choice: string; correct: boolean }; onTry: (choice: string) => void }) {
  return (
    <GlassPanel strong className="p-5">
      <p className="mb-3 text-sm font-medium text-pv-text">Choose the correct repair to restore broadcast reachability to all VTEPs in VNI {VNI}:</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((opt) => {
          const isSelected = attempt?.choice === opt.id;
          const isCorrect = opt.id === "fix-rt";
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
            <span className="font-semibold">✓ Type 3 export RT corrected — LEAF3 re-added to LEAF1&apos;s and LEAF2&apos;s flood lists.</span>
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
