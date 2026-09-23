"use client";

import { useMemo, useState, useEffect } from "react";
import Link from "next/link";
import { clsx } from "clsx";
import { useScenarioEngine } from "@/lib/sim-engine/useScenarioEngine";
import {
  DEVICE_ORDER,
  GRAPH_LINKS,
  GRAPH_NODES,
  createFirstConnectionState,
  firstConnectionSteps,
  linksOnPath,
  type FirstConnectionDeviceId,
  type FirstConnectionState,
} from "@/lib/sim-engine/scenarios/firstConnection";
import { PacketInspector } from "@/components/network/PacketInspector";
import { ARPTableViewer } from "@/components/network/ARPTableViewer";
import { MACTableViewer } from "@/components/network/MACTableViewer";
import { RouteTableViewer } from "@/components/network/RouteTableViewer";
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
import { TopologyFrame } from "@/components/network3d/TopologyFrame";
import { TopologyFocusMode } from "@/components/network3d/TopologyFocusMode";
import { HopInspectorPanel } from "@/components/network3d/HopInspectorPanel";
import { PacketDiffViewer } from "@/components/network3d/PacketDiffViewer";
import { HopTimeline } from "@/components/network3d/HopTimeline";
import { PacketFlowControls, type PlaySpeed } from "@/components/network3d/PacketFlowControls";
import { ObjectFocusPanel } from "@/components/network3d/ObjectFocusPanel";
import { layoutTo3D } from "@/components/network3d/layout";
import type { ActivePacket3D, CameraMode, FocusTarget3D, InspectorSurface, Link3DData, Node3DStatus, NodeExplanation } from "@/components/network3d/types";
import type { PacketVisual } from "@/lib/sim-engine/types";
import { explainNode } from "./explain";
import { focusIndicesFor, interfacesFor, linkDetailFor, packetFramesFor, traceFor } from "./deviceTrace";

/** The one step whose primary teaching actor isn't the packet's own sender — everywhere else, sender-priority (matches this lesson's step-id-keyed traceFor, mirroring the OSPF/BGP Enterprise convention — see ARCHITECTURE.md §18). */
const STEP_PRIMARY_DEVICE: Partial<Record<string, FirstConnectionDeviceId>> = { "frame-to-gateway": "switch" };

function deviceForStep(stepId: string, packet: PacketVisual | undefined): FirstConnectionDeviceId | undefined {
  if (STEP_PRIMARY_DEVICE[stepId]) return STEP_PRIMARY_DEVICE[stepId];
  if (packet) return (packet.from ?? packet.to) as FirstConnectionDeviceId;
  return undefined;
}

function devicesBetween(from: string, to: string): FirstConnectionDeviceId[] {
  const fi = DEVICE_ORDER.indexOf(from as FirstConnectionDeviceId);
  const ti = DEVICE_ORDER.indexOf(to as FirstConnectionDeviceId);
  if (fi === -1 || ti === -1) return [];
  const [lo, hi] = fi < ti ? [fi, ti] : [ti, fi];
  return DEVICE_ORDER.slice(lo, hi + 1);
}

function eyeOffsetForFocusTarget(target: FocusTarget3D): [number, number, number] {
  const [sx, sy, sz] = target.size ?? [0.6, 0.3, 0.3];
  const maxDim = Math.max(sx, sy, sz);
  const dist = Math.max(0.55, maxDim * 1.8);
  return [dist * 0.55, dist * 0.5, dist * 0.75];
}

const TCP_STATES = ["CLOSED", "SYN_SENT", "SYN_RECEIVED", "ESTABLISHED"];

function TCPStatePanel({ tcpState }: { tcpState: string }) {
  return (
    <GlassPanel className="p-4">
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-pv-text-muted">TCP State</h4>
      <div className="flex flex-wrap gap-1.5">
        {TCP_STATES.map((s) => (
          <span
            key={s}
            className={clsx(
              "rounded-md border px-2 py-1 pv-mono text-[10px]",
              s === tcpState ? "border-pv-success/50 bg-pv-success/10 text-pv-success" : "border-pv-border text-pv-text-faint",
            )}
          >
            {s}
          </span>
        ))}
      </div>
    </GlassPanel>
  );
}

function OverviewTab({ explanation }: { explanation: NodeExplanation }) {
  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-pv-cyan/30 bg-pv-cyan/5 p-3">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-pv-cyan-soft">Current Action</p>
        <p className="text-sm text-pv-text">{explanation.currentAction}</p>
      </div>
      {(explanation.controlPlaneRole || explanation.dataPlaneRole) && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {explanation.controlPlaneRole && (
            <div className="rounded-lg border border-pv-border p-2.5">
              <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-pv-text-faint">Control Plane</p>
              <p className="text-xs text-pv-text-muted">{explanation.controlPlaneRole}</p>
            </div>
          )}
          {explanation.dataPlaneRole && (
            <div className="rounded-lg border border-pv-border p-2.5">
              <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-pv-text-faint">Data Plane</p>
              <p className="text-xs text-pv-text-muted">{explanation.dataPlaneRole}</p>
            </div>
          )}
        </div>
      )}
      {explanation.note && <p className="rounded-lg border border-pv-warning/30 bg-pv-warning/5 p-2.5 text-xs text-pv-text-muted">{explanation.note}</p>}
    </div>
  );
}

export default function FirstConnectionDemo() {
  const { engine, snapshot } = useScenarioEngine<FirstConnectionState>(createFirstConnectionState(), firstConnectionSteps);
  const [autoPlay, setAutoPlay] = useState(false);
  const [speed, setSpeed] = useState<0.5 | 1 | 2>(1);
  const [cameraMode, setCameraMode] = useState<CameraMode>("overview");
  const [selectedNodeId, setSelectedNodeId] = useState<FirstConnectionDeviceId | undefined>(undefined);
  const [enteredDeviceId, setEnteredDeviceId] = useState<FirstConnectionDeviceId | undefined>(undefined);
  const [deviceXray, setDeviceXray] = useState(true);
  const [selectedInterfaceId, setSelectedInterfaceId] = useState<string | undefined>(undefined);
  const [selectedLinkId, setSelectedLinkId] = useState<string | undefined>(undefined);
  const [packetSelected, setPacketSelected] = useState(false);
  const [xrayMode, setXrayMode] = useState(true);
  const [focusMode, setFocusMode] = useState(false);
  const [focusedObject, setFocusedObject] = useState<FocusTarget3D | undefined>(undefined);
  const [historicalIndex, setHistoricalIndex] = useState<number | undefined>(undefined);
  const [inspectorSurface, setInspectorSurface] = useState<InspectorSurface>("hop");
  const completeLesson = useProgressStore((s) => s.completeLesson);
  const recordAnswer = useProgressStore((s) => s.recordAnswer);
  const unlockAchievement = useProgressStore((s) => s.unlockAchievement);

  const { state, currentStep, index, totalSteps, isComplete, lastAnswer, whatChanged, activePacket } = snapshot;
  const canAdvance = engine.canAdvance();
  const questionActive = !isComplete && !!currentStep?.question && lastAnswer?.stepId !== currentStep.id;

  const nodes3DBase = layoutTo3D(GRAPH_NODES);
  const lastStepIndex = Math.min(index, firstConnectionSteps.length - 1);
  const touchedDeviceIds = useMemo(() => {
    const ids = new Set<FirstConnectionDeviceId>();
    for (let k = 0; k <= lastStepIndex; k++) {
      const pkt = firstConnectionSteps[k].packet?.(state);
      if (pkt) devicesBetween(pkt.from, pkt.to).forEach((d) => ids.add(d));
    }
    return ids;
  }, [lastStepIndex, state]);
  const visitedLinkIds = useMemo(() => {
    const ids = new Set<string>();
    for (let k = 0; k <= lastStepIndex; k++) {
      const pkt = firstConnectionSteps[k].packet?.(state);
      if (pkt) linksOnPath(pkt.from, pkt.to).forEach((id) => ids.add(id));
    }
    return ids;
  }, [lastStepIndex, state]);
  const activeDeviceIds = activePacket ? devicesBetween(activePacket.from, activePacket.to) : [];
  const nodes3D = nodes3DBase.map((n) => {
    let status: Node3DStatus = "idle";
    if (n.id === selectedNodeId || n.id === enteredDeviceId) status = "selected";
    else if (activeDeviceIds.includes(n.id as FirstConnectionDeviceId)) status = "active";
    else if (touchedDeviceIds.has(n.id as FirstConnectionDeviceId)) status = "onPath";
    return { ...n, status };
  });
  const links3D: Link3DData[] = GRAPH_LINKS.map((l) => ({
    id: l.id,
    a: l.a,
    b: l.b,
    label: l.label,
    active: activePacket ? linksOnPath(activePacket.from, activePacket.to).includes(l.id) : false,
    onPath: visitedLinkIds.has(l.id),
  }));
  const activePacket3D: ActivePacket3D | undefined = activePacket ? { packet: activePacket, fromId: activePacket.from, toId: activePacket.to } : undefined;

  const activeDeviceId = DEVICE_ORDER.find((d) => traceFor(d, state, currentStep?.id ?? "").activeStageId !== undefined);
  const effectiveDeviceId = cameraMode === "device" ? enteredDeviceId : undefined;
  const inDeviceMode = !!effectiveDeviceId;

  const deviceTrace = effectiveDeviceId ? traceFor(effectiveDeviceId, state, currentStep?.id ?? "") : undefined;
  const deviceInterfaces = effectiveDeviceId ? interfacesFor(effectiveDeviceId, state, currentStep?.id ?? "") : [];
  const devicePacketFrames = effectiveDeviceId ? packetFramesFor(state) : undefined;

  const focusedObjectStillValid =
    focusedObject &&
    (focusedObject.kind === "stage"
      ? deviceTrace?.stages.some((s) => s.id === focusedObject.id)
      : focusedObject.kind === "packetLayer"
        ? devicePacketFrames?.some((f) => f.id === focusedObject.id)
        : focusedObject.kind === "interface"
          ? deviceInterfaces.some((i) => i.id === focusedObject.id)
          : true);
  const activeFocusedObject = focusedObjectStillValid ? focusedObject : undefined;

  const selectedNode3D = nodes3D.find((n) => n.id === selectedNodeId);
  const focusPosition3D: [number, number, number] | undefined = activeFocusedObject
    ? activeFocusedObject.position
    : cameraMode === "freeOrbit"
      ? undefined
      : inDeviceMode
        ? [0, 0, deviceXray ? -0.2 : 0]
        : selectedNode3D?.position;
  const eyeOffset3D: [number, number, number] | undefined = activeFocusedObject ? eyeOffsetForFocusTarget(activeFocusedObject) : inDeviceMode ? (deviceXray ? [0.6, 2.6, 5.2] : [2.1, 1.5, 3.8]) : undefined;

  const explainTargetId = effectiveDeviceId ?? selectedNodeId;
  const nodeExplanation = explainTargetId ? explainNode(state, explainTargetId, currentStep?.id ?? "") : undefined;
  const xrayPacket = activePacket && (selectedNodeId === activePacket.from || selectedNodeId === activePacket.to) ? activePacket : undefined;
  const xraySubjectId = effectiveDeviceId ?? selectedNodeId;
  const focusIndices = focusIndicesFor(xraySubjectId, currentStep?.id ?? "");

  const selectedLinkDetail = selectedLinkId ? linkDetailFor(selectedLinkId, state) : undefined;
  const packetCurrentDeviceLabel = effectiveDeviceId ?? activePacket?.to ?? activePacket?.from ?? "—";
  const devicePacketForTab = effectiveDeviceId && activePacket && devicesBetween(activePacket.from, activePacket.to).includes(effectiveDeviceId) ? activePacket : undefined;

  const selectedFabricId = selectedNodeId;
  const focusInspectDeviceId = selectedFabricId ?? effectiveDeviceId ?? activeDeviceId;
  const focusTrace = focusInspectDeviceId ? traceFor(focusInspectDeviceId, state, currentStep?.id ?? "") : undefined;
  const focusInterfaces = focusInspectDeviceId ? interfacesFor(focusInspectDeviceId, state, currentStep?.id ?? "") : undefined;

  // --- Historical-cursor invariant (ARCHITECTURE.md §18) — inspection is only
  // meaningful for a step strictly EARLIER than the live one. Once any live
  // navigation (Previous, progress bar, Step Back, …) reaches or passes the
  // selected step, historical mode ends. The stored cursor is cleared during
  // render (React's "adjust state on prop change" pattern) so it can't
  // resurrect when the lesson later moves forward again; `historicalCursor`
  // is the only value the rest of the page reads.
  if (historicalIndex !== undefined && historicalIndex >= index) setHistoricalIndex(undefined);
  const historicalCursor = historicalIndex !== undefined && historicalIndex < index ? historicalIndex : undefined;

  const journeyHopEntries = firstConnectionSteps.map((s, i) => ({ s, i })).filter(({ s, i }) => i <= index && !!s.packet).map(({ s, i }) => ({ id: s.id, label: s.label, index: i }));
  // Chip position of a valid historical selection; -1 falls back to the live entry, never to "no current chip".
  const historicalTimelinePos = historicalCursor !== undefined ? journeyHopEntries.findIndex((h) => h.index === historicalCursor) : -1;

  const historicalState = historicalCursor !== undefined ? engine.getStateAt(historicalCursor) : undefined;
  const historicalStep = historicalCursor !== undefined ? firstConnectionSteps[historicalCursor] : undefined;
  const historicalPacket = historicalStep && historicalState ? historicalStep.packet?.(historicalState) : undefined;
  const historicalDeviceId = historicalStep && historicalState ? deviceForStep(historicalStep.id, historicalPacket) : undefined;
  const historicalTrace = historicalDeviceId && historicalState ? traceFor(historicalDeviceId, historicalState, historicalStep!.id) : undefined;
  const historicalInterfaces = historicalDeviceId && historicalState ? interfacesFor(historicalDeviceId, historicalState, historicalStep!.id) : undefined;

  function focusPanelFieldsFor(target: FocusTarget3D): { title: string; fields: { label: string; value: string }[] } {
    if (target.kind === "stage" && deviceTrace) {
      const stage = deviceTrace.stages.find((s) => s.id === target.id);
      const fields: { label: string; value: string }[] = [];
      if (stage?.detail) fields.push({ label: "Detail", value: stage.detail });
      if (deviceTrace.activeStageId === target.id) {
        if (deviceTrace.lookupType) fields.push({ label: "Lookup", value: deviceTrace.lookupType });
        if (deviceTrace.lookupKey) fields.push({ label: "Match", value: deviceTrace.lookupKey });
        if (deviceTrace.lookupResult) fields.push({ label: "Result", value: deviceTrace.lookupResult });
        const egressIface = deviceInterfaces.find((i) => i.id === deviceTrace.egressInterfaceId);
        if (egressIface) fields.push({ label: "Egress", value: egressIface.name });
        if (deviceTrace.reason) fields.push({ label: "Why", value: deviceTrace.reason });
      }
      return { title: stage?.label ?? target.id, fields };
    }
    if (target.kind === "packetLayer") {
      const frame = devicePacketFrames?.find((f) => f.id === target.id);
      return { title: frame?.text ?? target.id, fields: [] };
    }
    if (target.kind === "interface") {
      const iface = deviceInterfaces.find((i) => i.id === target.id);
      if (!iface) return { title: target.id, fields: [] };
      const fields: { label: string; value: string }[] = [];
      if (iface.neighborLabel) fields.push({ label: "Peer", value: iface.neighborLabel });
      fields.push({ label: "Current role", value: iface.role === "ingress" ? "Ingress" : iface.role === "egress" ? "Egress" : "Idle" });
      fields.push({ label: "Status", value: iface.status === "up" ? "Up" : "Down" });
      if (iface.ip) fields.push({ label: "IP", value: iface.ip });
      if (iface.extra) fields.push(...iface.extra);
      return { title: iface.name, fields };
    }
    return { title: target.id, fields: [] };
  }

  function handleCameraModeChange(v: CameraMode) {
    setCameraMode(v);
    if (v === "device" && !enteredDeviceId) setEnteredDeviceId(selectedNodeId ?? activeDeviceId ?? "laptop");
    if (v === "overview") {
      setEnteredDeviceId(undefined);
      setSelectedNodeId(undefined);
    }
    if (v === "freeOrbit") setEnteredDeviceId(undefined);
  }

  function handleToggleAutoPlay() {
    if (!autoPlay) {
      setFocusedObject(undefined);
      setHistoricalIndex(undefined);
      setInspectorSurface("hop");
    }
    setAutoPlay((v) => !v);
  }

  useEffect(() => {
    if (isComplete) {
      completeLesson("arp-resolution", 75);
      completeLesson("tcp-three-way-handshake", 75);
      unlockAchievement("handshake-hero");
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
    setFocusedObject(undefined);
    setHistoricalIndex(undefined);
    setInspectorSurface("hop");
    setAutoPlay(false);
  };

  const nextLabel = currentStep?.question && !lastAnswer ? "Answer to continue" : "Next Step →";

  const explorerTabsFor = (device: FirstConnectionDeviceId): DeviceExplorerTab[] => {
    if (!nodeExplanation) return [];
    const packetTab: DeviceExplorerTab = {
      id: "packet",
      label: "Packet",
      content: devicePacketForTab ? <PacketInspector packet={devicePacketForTab} /> : <p className="text-xs text-pv-text-faint">No packet is at this device right now.</p>,
    };
    const ifaceTab: DeviceExplorerTab = { id: "interfaces", label: "Interfaces", content: <InterfaceListTab interfaces={deviceInterfaces} selectedInterfaceId={selectedInterfaceId} onSelectInterface={setSelectedInterfaceId} /> };
    const overviewTab: DeviceExplorerTab = { id: "overview", label: "Overview", content: <OverviewTab explanation={nodeExplanation} /> };
    if (device === "laptop") return [overviewTab, ifaceTab, { id: "arp", label: "ARP Cache", content: <ARPTableViewer title="Laptop" entries={state.arpTable.laptop ?? {}} /> }, packetTab];
    if (device === "switch") return [overviewTab, ifaceTab, { id: "mac", label: "MAC Table", content: <MACTableViewer title="Switch" entries={state.macTable.switch ?? {}} /> }, packetTab];
    if (device === "router") return [overviewTab, ifaceTab, { id: "routes", label: "Routing Table", content: <RouteTableViewer title="Router" routes={state.routingTable.router} /> }, packetTab];
    return [overviewTab, ifaceTab, { id: "tcp", label: "TCP Connections", content: <TCPStatePanel tcpState={state.tcp.state} /> }, packetTab];
  };

  return (
    <div className="mx-auto max-w-7xl px-6 py-10">
      <div className="mb-8">
        <Badge tone="cyan" className="mb-3">
          Flagship Demo
        </Badge>
        <h1 className="text-2xl font-semibold text-pv-text sm:text-3xl">Laptop → Switch → Router → Server</h1>
        <p className="mt-2 max-w-2xl text-sm text-pv-text-muted">
          You are <span className="pv-mono text-pv-cyan-soft">192.168.10.10</span>. Mission: connect to{" "}
          <span className="pv-mono text-pv-cyan-soft">10.20.20.20</span> over HTTPS. Drive every packet yourself —
          ARP, switching, routing, and the TCP handshake.
        </p>
      </div>

      <div className="mb-6 flex gap-1.5 overflow-x-auto pb-2">
        {firstConnectionSteps.map((step, i) => (
          <button
            key={step.id}
            type="button"
            disabled={i > index}
            onClick={() => i < index && engine.goTo(i)}
            title={step.label}
            className={clsx(
              "h-1.5 flex-1 min-w-6 rounded-full transition-colors",
              i < index ? "bg-pv-success/70 hover:bg-pv-success cursor-pointer" : i === index ? "bg-pv-cyan" : "bg-white/10",
            )}
          />
        ))}
      </div>

      <div className="mb-6 flex flex-wrap gap-3">
        <TopologyModeSwitcher options={[{ value: "overview", label: "Overview" }, { value: "device", label: "Device" }, { value: "freeOrbit", label: "Free Orbit" }]} value={cameraMode} onChange={handleCameraModeChange} />
        {inDeviceMode && <TopologyModeSwitcher options={[{ value: "off", label: "Exterior" }, { value: "on", label: "X-Ray" }]} value={deviceXray ? "on" : "off"} onChange={(v) => setDeviceXray(v === "on")} tone="violet" />}
        <TopologyModeSwitcher options={[{ value: "off", label: "Normal View" }, { value: "on", label: "X-Ray Packet View" }]} value={xrayMode ? "on" : "off"} onChange={(v) => setXrayMode(v === "on")} tone="violet" />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <TopologyFrame questionActive={questionActive} onExpand={() => setFocusMode(true)}>
            {focusMode ? (
              <div className="h-96 w-full rounded-2xl border border-pv-border bg-pv-bg-elevated sm:h-[28rem]" />
            ) : (
              <NetworkScene3D
                nodes={nodes3D}
                links={links3D}
                activePacket={inDeviceMode ? undefined : activePacket3D}
                onSelectNode={(id) => {
                  setSelectedNodeId(id as FirstConnectionDeviceId);
                  setSelectedLinkId(undefined);
                  setPacketSelected(false);
                  setInspectorSurface("device");
                  setHistoricalIndex(undefined);
                }}
                onSelectLink={(id) => {
                  setSelectedLinkId(id);
                  setSelectedNodeId(undefined);
                  setPacketSelected(false);
                }}
                onFocusLink={setFocusedObject}
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
                          effectiveDeviceId === "laptop"
                            ? "Conceptual Host Send Pipeline"
                            : effectiveDeviceId === "switch"
                              ? "Conceptual Layer 2 Forwarding Pipeline"
                              : effectiveDeviceId === "router"
                                ? "Conceptual Routing & Rewrite Pipeline"
                                : "Conceptual Host Receive Pipeline",
                        onFocusObject: setFocusedObject,
                        focusedObjectId: activeFocusedObject?.id,
                      }
                    : undefined
                }
              />
            )}
          </TopologyFrame>

          {packetSelected && activePacket && (
            <PacketDetailPanel
              packet={activePacket}
              currentDevice={packetCurrentDeviceLabel}
              direction="Laptop → Switch → Router → Server"
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

          {selectedLinkDetail && !packetSelected && <LinkDetailPanel detail={selectedLinkDetail} onClose={() => setSelectedLinkId(undefined)} />}

          {inDeviceMode && !packetSelected && !selectedLinkDetail ? (
            <DeviceExplorerPanel explanation={nodeExplanation!} tabs={explorerTabsFor(effectiveDeviceId!)} xrayEnabled={deviceXray} onToggleXray={() => setDeviceXray((v) => !v)} onExit={() => { setCameraMode("overview"); setEnteredDeviceId(undefined); }} />
          ) : (
            !packetSelected &&
            !selectedLinkDetail && (
              <NodeInspectorPanel explanation={nodeExplanation} packet={xrayPacket} focusLayerIndices={xrayMode ? focusIndices : undefined} xrayEnabled={xrayMode}>
                {selectedNodeId && (
                  <Button size="sm" onClick={() => { setEnteredDeviceId(selectedNodeId); setCameraMode("device"); }}>
                    Enter Device →
                  </Button>
                )}
              </NodeInspectorPanel>
            )
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

          {isComplete && (
            <GlassPanel strong glow="success" className="flex flex-col items-center gap-4 p-10 text-center">
              <Badge tone="success">Session Established</Badge>
              <h2 className="text-2xl font-semibold text-pv-text">TCP SESSION ESTABLISHED</h2>
              <p className="max-w-md text-sm text-pv-text-muted">
                You walked ARP resolution, switched forwarding, a routing lookup, and the full TCP three-way
                handshake — end to end, one packet at a time. +150 XP awarded.
              </p>
              <div className="flex gap-3">
                <Button onClick={handleRestart} variant="secondary">
                  Restart Demo
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
              <Button variant={autoPlay ? "primary" : "ghost"} size="sm" onClick={handleToggleAutoPlay}>
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

        <div className="space-y-4">
          <PacketInspector packet={activePacket} focusLayerIndices={xrayMode ? focusIndices : undefined} />
          <TCPStatePanel tcpState={state.tcp.state} />
          <ARPTableViewer title="Laptop" entries={state.arpTable.laptop ?? {}} />
          <MACTableViewer title="Switch" entries={state.macTable.switch ?? {}} />
          <RouteTableViewer title="Router" routes={state.routingTable.router ?? []} />
        </div>
      </div>

      {focusMode && (
        <TopologyFocusMode
          onClose={() => setFocusMode(false)}
          toolbar={
            <>
              <TopologyModeSwitcher options={[{ value: "overview", label: "Overview" }, { value: "device", label: "Device" }, { value: "freeOrbit", label: "Free Orbit" }]} value={cameraMode} onChange={handleCameraModeChange} />
              {inDeviceMode && <TopologyModeSwitcher options={[{ value: "off", label: "Exterior" }, { value: "on", label: "X-Ray" }]} value={deviceXray ? "on" : "off"} onChange={(v) => setDeviceXray(v === "on")} tone="violet" />}
            </>
          }
          header={
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
              <div className="flex min-w-0 items-center gap-2">
                <Badge tone="muted">Step {index + 1} / {totalSteps}</Badge>
                <span className="truncate text-xs font-medium text-pv-text">{currentStep?.label}</span>
              </div>
              {questionActive ? (
                <span className="shrink-0 rounded-full border border-pv-warning/40 bg-pv-warning/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-pv-warning">
                  Prediction pending — answer in the panel to continue
                </span>
              ) : (
                currentStep?.narrative && (
                  <p className="min-w-0 flex-1 truncate text-[11px] text-pv-text-faint" title={currentStep.narrative}>
                    {currentStep.narrative}
                  </p>
                )
              )}
            </div>
          }
          canvas={
            <div className="h-full [&>div]:h-full [&>div]:rounded-none [&>div]:border-0">
              <NetworkScene3D
                nodes={nodes3D}
                links={links3D}
                activePacket={inDeviceMode ? undefined : activePacket3D}
                onSelectNode={(id) => {
                  setSelectedNodeId(id as FirstConnectionDeviceId);
                  setSelectedLinkId(undefined);
                  setPacketSelected(false);
                  setInspectorSurface("device");
                  setHistoricalIndex(undefined);
                }}
                onSelectLink={(id) => setSelectedLinkId(id)}
                onFocusLink={setFocusedObject}
                selectedLinkId={selectedLinkId}
                onSelectPacket={() => setPacketSelected(true)}
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
                        onSelectPacket: () => setPacketSelected(true),
                        packetSelected,
                        pipelineTitle:
                          effectiveDeviceId === "laptop"
                            ? "Conceptual Host Send Pipeline"
                            : effectiveDeviceId === "switch"
                              ? "Conceptual Layer 2 Forwarding Pipeline"
                              : effectiveDeviceId === "router"
                                ? "Conceptual Routing & Rewrite Pipeline"
                                : "Conceptual Host Receive Pipeline",
                        onFocusObject: setFocusedObject,
                        focusedObjectId: activeFocusedObject?.id,
                      }
                    : undefined
                }
              />
            </div>
          }
          inspector={
            currentStep?.question ? (
              <>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-pv-cyan-soft">Current Prediction</p>
                <PredictionQuestion question={currentStep.question} selectedOptionId={lastAnswer?.stepId === currentStep.id ? lastAnswer.optionId : undefined} onAnswer={handleAnswer} />
              </>
            ) : selectedLinkDetail ? (
              <LinkDetailPanel detail={selectedLinkDetail} onClose={() => { setSelectedLinkId(undefined); setFocusedObject(undefined); }} />
            ) : activeFocusedObject && activeFocusedObject.kind !== "link" ? (
              <ObjectFocusPanel
                kind={activeFocusedObject.kind}
                title={focusPanelFieldsFor(activeFocusedObject).title}
                fields={focusPanelFieldsFor(activeFocusedObject).fields}
                onBack={() => setFocusedObject(undefined)}
                onOverview={() => {
                  setFocusedObject(undefined);
                  handleCameraModeChange("overview");
                }}
              />
            ) : inspectorSurface === "device" ? (
              inDeviceMode ? (
                <div className="space-y-3">
                  <TopologyModeSwitcher options={[{ value: "hop", label: "Hop" }, { value: "device", label: "Device" }]} value={inspectorSurface} onChange={setInspectorSurface} tone="violet" />
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
                </div>
              ) : nodeExplanation ? (
                <NodeInspectorPanel explanation={nodeExplanation} packet={xrayPacket} focusLayerIndices={xrayMode ? focusIndices : undefined} xrayEnabled={xrayMode} />
              ) : (
                <GlassPanel className="p-4">
                  <p className="text-xs text-pv-text-faint">Select a device, or advance the lesson, to inspect a hop.</p>
                </GlassPanel>
              )
            ) : historicalCursor !== undefined && historicalTrace ? (
              <div className="space-y-3">
                {inDeviceMode && (
                  <TopologyModeSwitcher options={[{ value: "hop", label: "Hop" }, { value: "device", label: "Device" }]} value={inspectorSurface} onChange={setInspectorSurface} tone="violet" disabledValues={["device"]} />
                )}
                <div className="flex items-center justify-between rounded-lg border border-pv-violet/40 bg-pv-violet/10 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 shrink-0 rounded-full bg-pv-violet" />
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-pv-violet">Historical — {historicalStep?.label}</span>
                  </div>
                  <button type="button" onClick={() => setHistoricalIndex(undefined)} className="text-[11px] font-semibold uppercase tracking-wide text-pv-text-faint transition-colors hover:text-pv-cyan-soft">
                    Return to Current →
                  </button>
                </div>
                <HopInspectorPanel trace={historicalTrace} deviceName={historicalDeviceId ?? "—"} interfaces={historicalInterfaces} />
                <PacketDiffViewer before={historicalTrace.packetBeforeFrames} after={historicalTrace.packetAfterFrames} beforeText={historicalTrace.packetBefore} afterText={historicalTrace.packetAfter} mutations={historicalTrace.mutations} />
              </div>
            ) : focusTrace ? (
              <div className="space-y-3">
                {inDeviceMode && <TopologyModeSwitcher options={[{ value: "hop", label: "Hop" }, { value: "device", label: "Device" }]} value={inspectorSurface} onChange={setInspectorSurface} tone="violet" />}
                <HopInspectorPanel
                  trace={focusTrace}
                  deviceName={focusInspectDeviceId ?? "—"}
                  interfaces={focusInterfaces}
                  onFocusNextHop={(id) => {
                    setSelectedNodeId(id as FirstConnectionDeviceId);
                    setInspectorSurface("hop");
                    if (cameraMode === "device") setEnteredDeviceId(id as FirstConnectionDeviceId);
                  }}
                />
                <PacketDiffViewer before={focusTrace.packetBeforeFrames} after={focusTrace.packetAfterFrames} beforeText={focusTrace.packetBefore} afterText={focusTrace.packetAfter} mutations={focusTrace.mutations} />
              </div>
            ) : (
              <GlassPanel className="p-4">
                <p className="text-xs text-pv-text-faint">Select a device, or advance the lesson, to inspect a hop.</p>
              </GlassPanel>
            )
          }
          timeline={
            <div className="space-y-2">
              <HopTimeline
                hops={journeyHopEntries}
                currentIndex={historicalTimelinePos >= 0 ? historicalTimelinePos : journeyHopEntries.length - 1}
                onSelectHop={(i) => {
                  const entry = journeyHopEntries[i];
                  if (!entry) return;
                  setInspectorSurface("hop");
                  if (entry.index === index) {
                    setHistoricalIndex(undefined);
                    return;
                  }
                  setHistoricalIndex(entry.index);
                  setFocusedObject(undefined);
                  const histState = engine.getStateAt(entry.index);
                  const histStep = firstConnectionSteps[entry.index];
                  const histPacket = histStep && histState ? histStep.packet?.(histState) : undefined;
                  const device = deviceForStep(entry.id, histPacket);
                  if (device) {
                    setSelectedNodeId(device);
                    if (cameraMode === "device") setEnteredDeviceId(device);
                  }
                }}
              />
              <PacketFlowControls
                playing={autoPlay}
                onTogglePlay={handleToggleAutoPlay}
                onPrevHop={() => {
                  setHistoricalIndex(undefined);
                  setInspectorSurface("hop");
                  engine.goTo(Math.max(0, index - 1));
                }}
                onNextHop={() => {
                  setHistoricalIndex(undefined);
                  setInspectorSurface("hop");
                  engine.advance();
                }}
                onReset={handleRestart}
                canPrevHop={index > 0}
                canNextHop={canAdvance}
                speed={speed as PlaySpeed}
                onSpeedChange={setSpeed}
                followPacket={false}
              />
            </div>
          }
        />
      )}
    </div>
  );
}
