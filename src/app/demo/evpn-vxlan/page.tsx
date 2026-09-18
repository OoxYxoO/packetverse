"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { clsx } from "clsx";
import { useScenarioEngine } from "@/lib/sim-engine/useScenarioEngine";
import {
  EVPN_EXPORT_RT,
  evpnSteps,
  GRAPH_EDGES,
  GRAPH_NODES,
  GRAPH_REGIONS,
  LOGICAL_GRAPH_EDGES,
  LOGICAL_GRAPH_NODES,
  TERMS,
  VNI,
  VLAN,
  createEvpnState,
  outerIpLayerIndex,
  vniAndInnerLayerIndex,
  withEvpnSession,
  type EvpnDeviceId,
  type EvpnState,
  type LeafId,
} from "@/lib/sim-engine/scenarios/evpnVxlan";
import { GraphTopologyViewer } from "@/components/network/GraphTopologyViewer";
import { GraphPacket } from "@/components/network/GraphPacket";
import { PacketInspector } from "@/components/network/PacketInspector";
import { ForwardingDecisionCard } from "@/components/protocol/ForwardingDecisionCard";
import { PacketJourneyTimeline } from "@/components/protocol/PacketJourneyTimeline";
import { PlaneSplitPanel } from "@/components/protocol/PlaneSplitPanel";
import { EvpnRouteTable, type EvpnMacRow } from "@/components/protocol/EvpnRouteTable";
import { TroubleshootingLayers, type DiagnosticLayer } from "@/components/protocol/TroubleshootingLayers";
import { PredictionQuestion } from "@/components/quiz/PredictionQuestion";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { useProgressStore } from "@/lib/state/useProgressStore";
import { NetworkScene3D, type FloodCopy3D } from "@/components/network3d/NetworkScene3D";
import { TopologyQuickExpand } from "@/components/network3d/TopologyQuickExpand";
import { NodeInspectorPanel } from "@/components/network3d/NodeInspectorPanel";
import { PacketFocusPanel } from "@/components/network3d/PacketFocusPanel";
import { TopologyModeSwitcher } from "@/components/network3d/TopologyModeSwitcher";
import { PlaneViewSwitcher } from "@/components/network3d/PlaneViewSwitcher";
import { DeviceExplorerPanel, InterfaceListTab, type DeviceExplorerTab } from "@/components/network3d/DeviceExplorerPanel";
import { PacketDetailPanel } from "@/components/network3d/PacketDetailPanel";
import { LinkDetailPanel } from "@/components/network3d/LinkDetailPanel";
import { layoutRegionsTo3D, layoutTo3D } from "@/components/network3d/layout";
import type { ActivePacket3D, CameraMode, Link3DData, Node3DStatus } from "@/components/network3d/types";
import { explainNode } from "./explain";
import { interfacesFor, linkDetailFor, packetFramesFor, traceFor } from "./deviceTrace";

const FABRIC_DEVICES: EvpnDeviceId[] = ["LEAF1", "SPINE1", "LEAF2"];
const LEAF_IDS: LeafId[] = ["LEAF1", "LEAF2"];

const WHY_EVPN: { q: string; a: string }[] = [
  { q: "WHAT is EVPN + VXLAN?", a: "VXLAN encapsulates Layer-2 frames inside IP/UDP so they can cross a routed fabric; BGP EVPN distributes where each MAC actually lives." },
  { q: "WHY use it?", a: "A routed spine-leaf fabric scales far better than a flat switched one — but only if Layer 2 can still cross it when a tenant needs it to." },
  { q: "WHEN is it used?", a: "Modern data-center fabrics, multi-tenant clouds, anywhere a spine-leaf underlay needs to carry tenant Layer-2 segments." },
  { q: "WITHOUT EVPN?", a: "VXLAN still works via flood-and-learn — but every unknown/broadcast frame is replicated to every remote VTEP, which stops scaling." },
];

const REPAIR_OPTIONS = [
  { id: "restart-evpn-session", label: "Restart the LEAF1 ↔ LEAF2 EVPN BGP session" },
  { id: "flap-uplink", label: "Flap LEAF1's uplink to SPINE1" },
  { id: "fix-rt", label: `Fix LEAF1's VNI ${VNI} import RT to match LEAF2's export RT (${EVPN_EXPORT_RT})` },
  { id: "static-mac", label: "Manually configure a static MAC entry for HOST-B on LEAF1" },
];
const WRONG_FEEDBACK: Record<string, string> = {
  "restart-evpn-session": "The EVPN session is already Established — restarting it won't change import policy at all.",
  "flap-uplink": "The underlay and VTEP reachability are already healthy — this doesn't touch RT policy.",
  "static-mac": "That would mask the symptom, not fix it — and it abandons the whole point of EVPN: a distributed, verifiable control plane instead of hand-typed MAC entries.",
};

function macRows(state: EvpnState, leaf: LeafId): EvpnMacRow[] {
  return state.macTable[leaf].map((m) => ({
    mac: m.mac,
    ip: m.ip,
    vni: VNI,
    source: m.learnedVia,
    remoteVtep: m.remoteVtep,
    rd: m.learnedVia === "evpn" ? state.evpnRoute?.rd : undefined,
    rt: m.learnedVia === "evpn" ? state.evpnRoute?.rt : undefined,
  }));
}

export default function EvpnVxlanDemo() {
  const { engine, snapshot } = useScenarioEngine<EvpnState>(createEvpnState(), evpnSteps);
  const [autoPlay, setAutoPlay] = useState(false);
  const [speed, setSpeed] = useState<0.5 | 1 | 2>(1);
  const [viewMode, setViewMode] = useState<"physical" | "logical" | "3d">("physical");
  const [planeView, setPlaneView] = useState<"control" | "data" | "both">("both");
  const [focusLeaf, setFocusLeaf] = useState<LeafId>("LEAF1");
  const [selectedNodeId, setSelectedNodeId] = useState<EvpnDeviceId | undefined>(undefined);
  const [cameraMode, setCameraMode] = useState<CameraMode>("overview");
  const [enteredDeviceId, setEnteredDeviceId] = useState<EvpnDeviceId | undefined>(undefined);
  const [deviceXray, setDeviceXray] = useState(true);
  const [autoEnterDevices, setAutoEnterDevices] = useState(true);
  const [selectedInterfaceId, setSelectedInterfaceId] = useState<string | undefined>(undefined);
  const [selectedLinkId, setSelectedLinkId] = useState<string | undefined>(undefined);
  const [selectedRegionId, setSelectedRegionId] = useState<string | undefined>(undefined);
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
  const augmented = withEvpnSession(baseNodes, baseEdges, sessionActive);
  const nodes = augmented.nodes;
  const edges = augmented.edges.map((e) => ({ ...e, state: "full" as const }));
  const activeNodeIds = activePacket ? [activePacket.from, activePacket.to] : [];
  const packetFrom = activePacket ? nodes.find((n) => n.id === activePacket.from) : undefined;
  const packetTo = activePacket ? nodes.find((n) => n.id === activePacket.to) : undefined;

  // Which layer(s) a given device actually acts on (brief §15) — a function of WHICH DEVICE is being
  // examined, not of where the packet's raw data currently sits, so Device Explorer's Packet tab focuses
  // correctly on LEAF1 (full stack) even though `state.packetAt` has already moved on to SPINE1 by the
  // time this step's run() completes.
  const focusIndicesFor = (device: EvpnDeviceId | undefined, packet: typeof activePacket) => {
    if (device === "SPINE1") return outerIpLayerIndex(packet);
    if (device === "LEAF2") return vniAndInnerLayerIndex(packet);
    return undefined;
  };
  const focusIndices = focusIndicesFor(state.packetAt, activePacket);
  const lastHop = state.journey[state.journey.length - 1];
  const showPlanes = index >= evpnSteps.findIndex((s) => s.id === "send-host-a");
  const showTroubleshootLayers = index >= evpnSteps.findIndex((s) => s.id === "break-intro");
  const showFloodDemo = currentStep?.id === "limitation-question";

  // --- 3D derived state (Scene Adapter: deviceTrace.ts computes everything protocol-specific; network3d/* only renders) ---
  const physicalAugmented = withEvpnSession(GRAPH_NODES, GRAPH_EDGES, sessionActive);
  const nodes3DBase = layoutTo3D(physicalAugmented.nodes);
  const regions3D = layoutRegionsTo3D(GRAPH_REGIONS);
  const visitedDevices = new Set(state.journey.map((h) => h.device));
  if (state.packet) visitedDevices.add("HOST-A");
  const nodes3D = nodes3DBase.map((n) => {
    let status: Node3DStatus = "idle";
    if (n.id === selectedNodeId || n.id === enteredDeviceId) status = "selected";
    else if (activePacket && (n.id === activePacket.from || n.id === activePacket.to)) status = "active";
    else if (visitedDevices.has(n.id as EvpnDeviceId)) status = "onPath";
    const badges = n.id === "LEAF1" || n.id === "LEAF2" ? ["VTEP"] : n.id === "SPINE1" ? ["UNDERLAY ONLY"] : undefined;
    return { ...n, status, badges };
  });
  const links3D: Link3DData[] = physicalAugmented.edges.map((e) => ({
    ...e,
    active: activePacket ? (e.a === activePacket.from && e.b === activePacket.to) || (e.b === activePacket.from && e.a === activePacket.to) : false,
    onPath: visitedDevices.has(e.a as EvpnDeviceId) && visitedDevices.has(e.b as EvpnDeviceId),
  }));
  const activePacket3D: ActivePacket3D | undefined =
    activePacket && nodes3D.some((n) => n.id === activePacket.from) && nodes3D.some((n) => n.id === activePacket.to) ? { packet: activePacket, fromId: activePacket.from, toId: activePacket.to } : undefined;
  const floodCopies3D: FloodCopy3D[] | undefined = showFloodDemo ? [{ id: "flood-leaf1-leaf2", fromId: "LEAF1", toId: "LEAF2" }] : undefined;
  const selectedNode3D = nodes3D.find((n) => n.id === selectedNodeId);
  const questionActive = !isComplete && !!currentStep?.question && lastAnswer?.stepId !== currentStep.id;

  const activeDeviceId = FABRIC_DEVICES.find((d) => traceFor(d as "LEAF1" | "SPINE1" | "LEAF2", state, currentStep?.id ?? "")?.activeStageId !== undefined);
  const effectiveDeviceId = cameraMode === "device" ? enteredDeviceId : cameraMode === "packetFollow" && autoEnterDevices ? activeDeviceId : undefined;
  const inDeviceMode = !!effectiveDeviceId;
  const isFabricDevice = (id: EvpnDeviceId | undefined): id is "LEAF1" | "SPINE1" | "LEAF2" => id === "LEAF1" || id === "SPINE1" || id === "LEAF2";

  const followPacketIntoCurrentDevice = () => {
    if (!packetSelected || cameraMode !== "device") return;
    const snap = engine.getSnapshot();
    const nextDevice = FABRIC_DEVICES.find((d) => traceFor(d as "LEAF1" | "SPINE1" | "LEAF2", snap.state, snap.currentStep?.id ?? "")?.activeStageId !== undefined);
    if (nextDevice) setEnteredDeviceId(nextDevice);
  };

  const deviceTrace = isFabricDevice(effectiveDeviceId) ? traceFor(effectiveDeviceId, state, currentStep?.id ?? "") : undefined;
  const deviceInterfaces = isFabricDevice(effectiveDeviceId) ? interfacesFor(effectiveDeviceId, state, currentStep?.id ?? "") : [];
  const devicePacketFrames = effectiveDeviceId ? packetFramesFor(state) : undefined;

  const followNode3D = cameraMode === "packetFollow" && activePacket ? nodes3D.find((n) => n.id === (state.packetAt ?? activePacket.to)) : undefined;
  const focusPosition3D: [number, number, number] | undefined =
    cameraMode === "freeOrbit" ? undefined : inDeviceMode ? [0, 0, deviceXray ? -0.2 : 0] : cameraMode === "packetFollow" ? followNode3D?.position : selectedNode3D?.position;
  const eyeOffset3D: [number, number, number] | undefined = inDeviceMode ? (deviceXray ? [0.6, 2.6, 5.2] : [2.1, 1.5, 3.8]) : undefined;

  const explainTargetId = effectiveDeviceId ?? selectedNodeId ?? (followNode3D?.id as EvpnDeviceId | undefined);
  const nodeExplanation = explainTargetId ? explainNode(state, explainTargetId) : undefined;
  const xrayPacket = activePacket && (selectedNodeId === activePacket.from || selectedNodeId === activePacket.to) ? activePacket : undefined;
  const lastJourneyHop = state.journey[state.journey.length - 1];

  const selectedLinkDetail = selectedLinkId ? linkDetailFor(selectedLinkId, state) : undefined;
  const packetCurrentDeviceLabel = effectiveDeviceId ?? state.packetAt ?? activePacket?.from ?? "—";
  const devicePacketForTab = xrayPacket ?? (effectiveDeviceId && state.packetAt === effectiveDeviceId ? activePacket : undefined);

  const diagnosticLayers: DiagnosticLayer[] = [
    { label: "Interface", status: "healthy" },
    { label: "Underlay IGP", status: "healthy" },
    { label: "VTEP Reachability", status: "healthy" },
    { label: "BGP Session", status: state.bgpSessionUp ? "healthy" : "unknown" },
    { label: "EVPN Route", status: state.faultActive ? "failing" : state.received.LEAF1?.imported ? "healthy" : "unknown" },
    { label: "Remote MAC", status: state.faultActive ? "failing" : state.received.LEAF1?.imported ? "healthy" : "unknown" },
    { label: "VXLAN Unicast", status: state.faultActive ? "failing" : state.received.LEAF1?.imported ? "healthy" : "unknown" },
  ];

  useEffect(() => {
    if (isComplete) {
      completeLesson("evpn-vxlan-foundations", 300);
      unlockAchievement("fabric-explorer");
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
    setSelectedRegionId(undefined);
    setPacketSelected(false);
  };

  const nextLabel = currentStep?.question && !lastAnswer ? "Answer to continue" : currentStep?.requiresState && !canAdvance ? "Apply the correct fix to continue" : "Next Step →";

  const explorerTabsFor = (device: "LEAF1" | "SPINE1" | "LEAF2"): DeviceExplorerTab[] => {
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
    if (device === "LEAF1" || device === "LEAF2") {
      tabs.push({ id: "mac-table", label: "MAC / EVPN Table", content: <EvpnRouteTable title={device} rows={macRows(state, device)} /> });
    } else {
      tabs.push({ id: "mac-table", label: "MAC / EVPN Table", content: <p className="text-xs text-pv-text-faint">SPINE1 is not a VTEP — it never builds a tenant MAC table at all.</p> });
    }
    tabs.push({
      id: "packet",
      label: "Packet",
      content: devicePacketForTab ? <PacketInspector packet={devicePacketForTab} focusLayerIndices={xrayMode ? focusIndicesFor(device, devicePacketForTab) : undefined} /> : <p className="text-xs text-pv-text-faint">No packet at this device right now.</p>,
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
          EVPN + VXLAN · VTEP + VNI + Route Type 2 + Local/Remote MAC
        </Badge>
        <h1 className="text-2xl font-semibold text-pv-text sm:text-3xl">One Broadcast Domain, Across A Routed Fabric</h1>
        <p className="mt-2 max-w-3xl text-sm text-pv-text-muted">
          Watch VXLAN carry a Layer-2 frame across a Layer-3 spine-leaf fabric — first on its own, then with BGP EVPN
          telling each leaf exactly where the other one&apos;s MAC addresses live, instead of guessing by flooding.
        </p>
      </div>

      <div className="mb-4 grid gap-2 sm:grid-cols-4">
        {WHY_EVPN.map((item) => (
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
        {evpnSteps.map((step, i) => (
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
                { value: "packetFollow", label: "Packet Follow" },
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
            {cameraMode === "packetFollow" && (
              <button
                type="button"
                onClick={() => setAutoEnterDevices((v) => !v)}
                className={clsx(
                  "rounded-full border px-3 py-1.5 text-xs font-semibold uppercase tracking-wide transition-colors",
                  autoEnterDevices ? "border-pv-cyan/50 bg-pv-cyan/15 text-pv-cyan-soft" : "border-pv-border text-pv-text-faint hover:text-pv-text",
                )}
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
              <TopologyQuickExpand questionActive={questionActive} nodes={nodes3D} links={links3D} activePacket={activePacket3D} regions={regions3D}>
              <NetworkScene3D
                nodes={nodes3D}
                links={links3D}
                activePacket={inDeviceMode ? undefined : activePacket3D}
                floodCopies={inDeviceMode ? undefined : floodCopies3D}
                regions={regions3D}
                onSelectRegion={(id) => {
                  setSelectedRegionId(id);
                  setSelectedNodeId(undefined);
                  setSelectedLinkId(undefined);
                  setPacketSelected(false);
                }}
                selectedRegionId={selectedRegionId}
                onSelectNode={(id) => {
                  setSelectedNodeId(id as EvpnDeviceId);
                  setSelectedRegionId(undefined);
                  setPacketSelected(false);
                  setSelectedLinkId(undefined);
                }}
                onSelectLink={(id) => {
                  setSelectedLinkId(id);
                  setSelectedNodeId(undefined);
                  setSelectedRegionId(undefined);
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
                        pipelineTitle:
                          effectiveDeviceId === "LEAF1" ? "Conceptual VXLAN Ingress Pipeline" : effectiveDeviceId === "LEAF2" ? "Conceptual VXLAN Egress Pipeline" : "Conceptual Underlay Forwarding Pipeline",
                      }
                    : undefined
                }
              />
              </TopologyQuickExpand>

              {cameraMode === "packetFollow" && (
                <PacketFocusPanel
                  currentHopLabel={lastJourneyHop ? `${lastJourneyHop.device}: ${lastJourneyHop.lookup} → ${lastJourneyHop.action}` : undefined}
                  hopIndex={state.journey.length}
                  totalHops={3}
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
                  direction="HOST-A → LEAF1 → SPINE1 → LEAF2 → HOST-B"
                  focusLayerIndices={xrayMode ? focusIndices : undefined}
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

              {selectedRegionId === "vni-overlay" && !packetSelected && !selectedLinkDetail && (
                <VniOverlayPanel state={state} onClose={() => setSelectedRegionId(undefined)} />
              )}

              {inDeviceMode && !packetSelected && !selectedLinkDetail && !selectedRegionId ? (
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
                !selectedLinkDetail &&
                !selectedRegionId && (
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
              controlTitle="Control Plane — BGP EVPN"
              controlRows={[
                { label: "LEAF1 ↔ LEAF2 EVPN session", value: state.bgpSessionUp ? "Established" : "Not yet formed" },
                { label: "Type 2 route", value: state.evpnRoute ? `${state.evpnRoute.mac} / ${state.evpnRoute.ip}` : "—" },
                { label: "RD", value: state.evpnRoute?.rd ?? "—" },
                { label: "RT", value: state.evpnRoute?.rt ?? "—" },
                { label: "LEAF1 import result", value: state.received.LEAF1 ? (state.received.LEAF1.imported ? "Imported" : state.received.LEAF1.rtChecked ? "Rejected (RT mismatch)" : "Received, not yet checked") : "—" },
              ]}
              dataTitle="Data Plane — Current Frame"
              dataRows={
                state.packet
                  ? [
                      { label: "Location", value: state.packetAt ?? "—" },
                      { label: "Encapsulation", value: state.packet.encapsulated ? `VXLAN (VNI ${VNI})` : "Plain Ethernet" },
                      { label: "Inner Src → Dst MAC", value: `${state.packet.innerSrcMac} → ${state.packet.innerDstMac}` },
                    ]
                  : [{ label: "Frame", value: "none in flight" }]
              }
            />
          )}

          {showTroubleshootLayers && !isComplete && <TroubleshootingLayers title="Troubleshooting Layers" layers={diagnosticLayers} />}

          {isComplete && (
            <GlassPanel strong glow="success" className="flex flex-col items-center gap-4 p-10 text-center">
              <Badge tone="success">Fabric Explorer</Badge>
              <h2 className="text-2xl font-semibold text-pv-text">HOST-A ↔ HOST-B, Across A Routed Fabric</h2>
              <p className="max-w-md text-sm text-pv-text-muted">
                You watched VXLAN carry a Layer-2 frame across a Layer-3 spine-leaf fabric, exposed the flood-and-learn
                limitation, built a real BGP EVPN Type 2 route, watched LEAF1 learn HOST-B&apos;s location from it instead
                of assuming it, then repaired a Route Target import mismatch under an otherwise fully healthy fabric.
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

          <EvpnRouteTable title={focusLeaf} rows={macRows(state, focusLeaf)} />

          <PacketJourneyTimeline hops={state.journey.map((h) => ({ router: h.device, action: h.action, output: h.output }))} />
        </div>
      </div>
    </div>
  );
}

function VniOverlayPanel({ state, onClose }: { state: EvpnState; onClose: () => void }) {
  return (
    <GlassPanel strong className="space-y-3 p-5">
      <div className="flex items-center justify-between">
        <h3 className="pv-mono text-sm font-bold text-pv-text">VNI {VNI} — Overlay Segment</h3>
        <button type="button" onClick={onClose} className="text-xs text-pv-text-faint hover:text-pv-text">
          ✕
        </button>
      </div>
      <p className="pv-mono text-[11px] text-pv-text-muted">
        VLAN mapping: <span className="text-pv-text">LEAF1 VLAN {VLAN} → VNI {VNI}</span>, <span className="text-pv-text">LEAF2 VLAN {VLAN} → VNI {VNI}</span>
      </p>
      <p className="pv-mono text-[11px] text-pv-text-muted">
        Local VTEPs: <span className="text-pv-text">LEAF1, LEAF2</span> (SPINE1 is never a VTEP for this or any VNI)
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        <EvpnRouteTable title="LEAF1" rows={macRows(state, "LEAF1")} />
        <EvpnRouteTable title="LEAF2" rows={macRows(state, "LEAF2")} />
      </div>
    </GlassPanel>
  );
}

function RepairChallenge({ options, attempt, onTry }: { options: { id: string; label: string }[]; attempt?: { choice: string; correct: boolean }; onTry: (choice: string) => void }) {
  return (
    <GlassPanel strong className="p-5">
      <p className="mb-3 text-sm font-medium text-pv-text">Choose the correct repair for LEAF1&apos;s VNI {VNI} import policy:</p>
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
            <span className="font-semibold">✓ Import RT corrected — HOST-B&apos;s remote MAC re-installed on LEAF1.</span>
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
