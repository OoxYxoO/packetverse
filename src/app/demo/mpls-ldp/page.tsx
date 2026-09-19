"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { clsx } from "clsx";
import { useScenarioEngine } from "@/lib/sim-engine/useScenarioEngine";
import {
  GRAPH_EDGES,
  GRAPH_NODES,
  GRAPH_REGIONS,
  LDP_LINKS,
  LDP_STATE_INFO,
  LDP_STATE_LABEL,
  LDP_STATE_ORDER,
  PROVIDER_ROUTERS,
  TERMS,
  buildMplsCliCommands,
  createMplsState,
  fmtLabel,
  mplsSteps,
  type MplsState,
  type RouterId,
} from "@/lib/sim-engine/scenarios/mplsLdp";
import { GraphTopologyViewer, type GraphEdge } from "@/components/network/GraphTopologyViewer";
import { GraphPacket } from "@/components/network/GraphPacket";
import { PacketInspector } from "@/components/network/PacketInspector";
import { ProtocolStateMachine } from "@/components/protocol/ProtocolStateMachine";
import { LibViewer, LfibViewer } from "@/components/protocol/LibLfibViewer";
import { RouteTablePanel } from "@/components/protocol/RouteTablePanel";
import { ForwardingDecisionCard } from "@/components/protocol/ForwardingDecisionCard";
import { PacketJourneyTimeline } from "@/components/protocol/PacketJourneyTimeline";
import { LabelFlowView } from "@/components/protocol/LabelFlowView";
import { PlaneSplitPanel } from "@/components/protocol/PlaneSplitPanel";
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
import { TopologyFrame } from "@/components/network3d/TopologyFrame";
import { TopologyFocusMode } from "@/components/network3d/TopologyFocusMode";
import { HopInspectorPanel } from "@/components/network3d/HopInspectorPanel";
import { PacketDiffViewer } from "@/components/network3d/PacketDiffViewer";
import { HopTimeline } from "@/components/network3d/HopTimeline";
import { PacketFlowControls, type PlaySpeed } from "@/components/network3d/PacketFlowControls";
import { ObjectFocusPanel } from "@/components/network3d/ObjectFocusPanel";
import { layoutRegionsTo3D, layoutTo3D } from "@/components/network3d/layout";
import type { ActivePacket3D, CameraMode, FocusTarget3D, Link3DData, Node3DStatus } from "@/components/network3d/types";
import { PRIMARY_TRANSITION_ROUTER, deviceForStep, explainRouter, interfacesFor, linkDetailFor, packetFramesFor, traceFor } from "./deviceTrace";

const DEVICE_ROUTERS: RouterId[] = ["PE1", "P1", "P2", "PE2"];

const WHY_MPLS: { q: string; a: string }[] = [
  { q: "WHAT is MPLS?", a: "A forwarding technology that classifies traffic once, at the edge, and switches it through the core using short labels." },
  { q: "WHY use it?", a: "Scalable forwarding, traffic engineering, and services (like VPNs) — not because label lookups are inherently \"faster\" than IP." },
  { q: "WHAT does it NOT replace?", a: "The IGP (OSPF) — MPLS forwards along paths the IGP already says are reachable." },
  { q: "WHEN do engineers use it?", a: "Provider cores that need scalable per-service forwarding state, not just best-effort IP." },
];

const REPAIR_OPTIONS = [
  { id: "restart-ospf", label: "Restart OSPF on P1" },
  { id: "reboot-p2", label: "Reboot P2" },
  { id: "enable-ldp", label: "Enable LDP on the P1 ↔ P2 interface" },
  { id: "increase-mtu", label: "Increase the MTU on P1 ↔ P2" },
];
const WRONG_FEEDBACK: Record<string, string> = {
  "restart-ospf": "OSPF is already healthy — restarting it doesn't touch the LDP session at all.",
  "reboot-p2": "A reboot tears down everything, not just the LDP session — and doesn't address why LDP wasn't enabled.",
  "increase-mtu": "MTU isn't the problem here — the LDP session simply isn't up on this link.",
};

function withKind(nodes: typeof GRAPH_NODES) {
  return nodes.map((n) => ({ ...n, kind: n.id === "PE1" || n.id === "PE2" ? ("pe-router" as const) : n.id === "P1" || n.id === "P2" ? ("p-router" as const) : ("router" as const) }));
}

export default function MplsLdpDemo() {
  const { engine, snapshot } = useScenarioEngine<MplsState>(createMplsState(), mplsSteps);
  const [autoPlay, setAutoPlay] = useState(false);
  const [speed, setSpeed] = useState<0.5 | 1 | 2>(1);
  const [viewMode, setViewMode] = useState<"physical" | "labelFlow" | "3d">("physical");
  const [focusRouter, setFocusRouter] = useState<RouterId>("P1");
  const [selectedNodeId, setSelectedNodeId] = useState<string | undefined>(undefined);
  const [cameraMode, setCameraMode] = useState<CameraMode>("overview");
  const [enteredDeviceId, setEnteredDeviceId] = useState<RouterId | undefined>(undefined);
  const [deviceXray, setDeviceXray] = useState(true);
  const [selectedInterfaceId, setSelectedInterfaceId] = useState<string | undefined>(undefined);
  const [selectedLinkId, setSelectedLinkId] = useState<string | undefined>(undefined);
  const [packetSelected, setPacketSelected] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [focusedObject, setFocusedObject] = useState<FocusTarget3D | undefined>(undefined);
  /** Presentation cursor for HopTimeline inspection ("Historical Timeline Inspection Fix" §3) — a step INDEX, never mutates the live lesson. undefined = inspecting the current/live hop. */
  const [historicalIndex, setHistoricalIndex] = useState<number | undefined>(undefined);
  const completeLesson = useProgressStore((s) => s.completeLesson);
  const recordAnswer = useProgressStore((s) => s.recordAnswer);
  const unlockAchievement = useProgressStore((s) => s.unlockAchievement);
  const awardedRef = useRef(false);

  const { state, currentStep, index, totalSteps, isComplete, lastAnswer, whatChanged, activePacket } = snapshot;
  const canAdvance = engine.canAdvance();
  const questionActive = !isComplete && !!currentStep?.question && lastAnswer?.stepId !== currentStep.id;

  const edges: GraphEdge[] = useMemo(
    () =>
      GRAPH_EDGES.map((e) => {
        const link = LDP_LINKS.find((l) => (l.a === e.a && l.b === e.b) || (l.a === e.b && l.b === e.a));
        if (!link) return { id: e.id, a: e.a, b: e.b, state: "full" as const };
        const st = state.ldp[link.id];
        return { id: e.id, a: e.a, b: e.b, label: e.label, state: st === "OPERATIONAL" ? ("full" as const) : st === "DOWN" ? ("down" as const) : ("forming" as const) };
      }),
    [state.ldp],
  );

  const activeNodeIds = activePacket ? [activePacket.from, activePacket.to] : [];
  const packetFrom = activePacket ? GRAPH_NODES.find((n) => n.id === activePacket.from) : undefined;
  const packetTo = activePacket ? GRAPH_NODES.find((n) => n.id === activePacket.to) : undefined;

  const cliCommands = useMemo(() => buildMplsCliCommands(state, focusRouter), [state, focusRouter]);
  const lastHop = state.journey[state.journey.length - 1];
  const showPlaneSplit = index >= mplsSteps.findIndex((s) => s.id === "ldp-discovery-intro");

  const labelFlowNodes = useMemo(
    () =>
      PROVIDER_ROUTERS.map((r) => {
        const entry = state.lfib[r]?.[0];
        const outputLabel = entry ? (entry.action === "POP" ? "IP" : entry.outgoingLabel !== undefined ? fmtLabel(entry.outgoingLabel) : "—") : r === "PE2" ? "IP" : "—";
        return { router: r, action: entry?.action, outputLabel };
      }),
    [state.lfib],
  );

  // --- 3D derived state (Scene Adapter = deviceTrace.ts; no protocol logic here or in components/network3d/) ---
  const nodes3DBase = useMemo(() => layoutTo3D(withKind(GRAPH_NODES)), []);
  const regions3D = useMemo(() => layoutRegionsTo3D(GRAPH_REGIONS), []);

  const nodes3D = nodes3DBase.map((n) => {
    let status: Node3DStatus = "idle";
    if (n.id === selectedNodeId || n.id === enteredDeviceId) status = "selected";
    else if (activePacket && (n.id === activePacket.from || n.id === activePacket.to)) status = "active";
    else if (state.journey.some((h) => h.router === n.id)) status = "onPath";
    const badge = n.id === "PE1" || n.id === "PE2" ? "LER" : n.id === "P1" || n.id === "P2" ? "LSR" : undefined;
    return { ...n, status, badges: badge ? [badge] : undefined };
  });

  const links3D: Link3DData[] = GRAPH_EDGES.map((e) => {
    const active = activePacket ? (e.a === activePacket.from && e.b === activePacket.to) || (e.b === activePacket.from && e.a === activePacket.to) : false;
    const link = LDP_LINKS.find((l) => (l.a === e.a && l.b === e.b) || (l.a === e.b && l.b === e.a));
    const st = link ? state.ldp[link.id] : undefined;
    return { id: e.id, a: e.a, b: e.b, label: e.label, active, onPath: st === "OPERATIONAL" };
  });

  const activePacket3D: ActivePacket3D | undefined = activePacket && nodes3D.some((n) => n.id === activePacket.from) && nodes3D.some((n) => n.id === activePacket.to) ? { packet: activePacket, fromId: activePacket.from, toId: activePacket.to } : undefined;
  const selectedNode3D = nodes3D.find((n) => n.id === selectedNodeId);

  // Which router is actively processing right now — drives Follow-Packet auto-enter and the Hop Inspector's default target.
  const activeDeviceId = PRIMARY_TRANSITION_ROUTER[currentStep?.id ?? ""] ?? DEVICE_ROUTERS.find((r) => traceFor(r, state, currentStep?.id ?? "").activeStageId !== undefined);
  const effectiveDeviceId = cameraMode === "device" ? enteredDeviceId : cameraMode === "packetFollow" ? activeDeviceId : undefined;
  const inDeviceMode = !!effectiveDeviceId;

  const deviceTrace = effectiveDeviceId ? traceFor(effectiveDeviceId, state, currentStep?.id ?? "") : undefined;
  const deviceInterfaces = effectiveDeviceId ? interfacesFor(effectiveDeviceId, state) : [];
  const devicePacketFrames = effectiveDeviceId ? packetFramesFor(state) : undefined;

  // --- Generic 3D object-focus sub-state ("Universal Interactive Topology
  // Migration" §25) — layered ON TOP of `cameraMode`, never a 5th camera
  // mode. Reuses `deviceTrace`/`deviceInterfaces`/`devicePacketFrames`.
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

  const focusPosition3D: [number, number, number] | undefined = activeFocusedObject
    ? activeFocusedObject.position
    : cameraMode === "freeOrbit"
      ? undefined
      : inDeviceMode
        ? [0, 0, deviceXray ? -0.2 : 0]
        : selectedNode3D?.position;
  const eyeOffset3D: [number, number, number] | undefined = activeFocusedObject
    ? eyeOffsetForFocusTarget(activeFocusedObject)
    : inDeviceMode
      ? deviceXray
        ? [0.6, 2.6, 5.2]
        : [2.1, 1.5, 3.8]
      : undefined;

  const explainTargetId = effectiveDeviceId ?? selectedNodeId;
  const nodeExplanation = explainTargetId && DEVICE_ROUTERS.includes(explainTargetId as RouterId) ? explainRouter(state, explainTargetId as RouterId, currentStep?.id ?? "") : undefined;
  const xrayPacket = activePacket && (selectedNodeId === activePacket.from || selectedNodeId === activePacket.to) ? activePacket : undefined;

  // --- Hop Inspector target ("Universal Interactive Topology Migration"
  // §23) — explicit selection wins outright: selectedNodeId >
  // effectiveDeviceId > activeDeviceId.
  const focusInspectDeviceId = (selectedNodeId ?? effectiveDeviceId ?? activeDeviceId) as RouterId | undefined;
  const focusTrace = focusInspectDeviceId ? traceFor(focusInspectDeviceId, state, currentStep?.id ?? "") : undefined;
  const focusInterfaces = focusInspectDeviceId ? interfacesFor(focusInspectDeviceId, state) : undefined;

  // --- HopTimeline data — every step that either carries a packet (LDP
  // control message OR MPLS data packet) or is a no-packet control-plane
  // step tracked in PRIMARY_TRANSITION_ROUTER, re-describing
  // `mplsSteps`/`index` (mirrors OSPF/BGP Enterprise/BGP Route Reflector —
  // two genuinely distinct journey KINDS share one combined timeline,
  // exactly like BGP Enterprise's TCP-vs-BGP messages do).
  const journeyStepIndices = mplsSteps
    .map((s, i) => ({ s, i }))
    .filter(({ s, i }) => i <= index && (!!s.packet || PRIMARY_TRANSITION_ROUTER[s.id] !== undefined));
  const journeyHopEntries = journeyStepIndices.map(({ s, i }) => ({ id: s.id, label: s.label, index: i }));

  // --- Historical inspection ("Historical Timeline Inspection Fix" §3/§4)
  // — reuses ScenarioEngine's OWN `stateByIndex` snapshot (exposed via
  // `getStateAt`). Presentation-only — never calls `engine.goTo()`. Both
  // the LDP control-plane branches AND the state.journey-backed MPLS
  // forwarding branch of `traceFor` work unmodified against a frozen
  // historical `MplsState`, since `state.journey` inside that snapshot
  // only ever contains hops that had actually happened by that index.
  const historicalState = historicalIndex !== undefined ? engine.getStateAt(historicalIndex) : undefined;
  const historicalStep = historicalIndex !== undefined ? mplsSteps[historicalIndex] : undefined;
  const historicalPacket = historicalStep && historicalState ? historicalStep.packet?.(historicalState) : undefined;
  const historicalDeviceId = historicalStep && historicalState ? deviceForStep(historicalStep.id, historicalPacket) : undefined;
  const historicalTrace = historicalDeviceId && historicalState ? traceFor(historicalDeviceId, historicalState, historicalStep!.id) : undefined;
  const historicalInterfaces = historicalDeviceId && historicalState ? interfacesFor(historicalDeviceId, historicalState) : undefined;

  /** Detail shown in <ObjectFocusPanel> for a focused stage/packetLayer/interface. Every field comes straight off `deviceTrace`/`deviceInterfaces`/`devicePacketFrames`; link focus reuses <LinkDetailPanel> instead. */
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
      return { title: frame?.text ?? target.id, fields: frame ? [{ label: "Layer type", value: frame.tone }] : [] };
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
    if (v === "device" && !enteredDeviceId) setEnteredDeviceId((selectedNodeId && DEVICE_ROUTERS.includes(selectedNodeId as RouterId) ? (selectedNodeId as RouterId) : undefined) ?? activeDeviceId ?? "PE1");
    if (v === "overview") {
      setEnteredDeviceId(undefined);
      setSelectedNodeId(undefined);
    }
    if (v === "freeOrbit") setEnteredDeviceId(undefined);
  }

  // --- Manual object focus / historical inspection vs. Play — resuming
  // playback takes priority (see sr-mpls-foundations for the same rule).
  function handleToggleAutoPlay() {
    if (!autoPlay) {
      setFocusedObject(undefined);
      setHistoricalIndex(undefined);
    }
    setAutoPlay((v) => !v);
  }

  const selectedLinkDetail = selectedLinkId ? linkDetailFor(selectedLinkId, state) : undefined;
  const packetCurrentDeviceLabel = effectiveDeviceId ?? activePacket?.to ?? activePacket?.from ?? "—";
  const packetDirection = activePacket ? `${activePacket.from} → ${activePacket.to}` : "—";

  const explorerCliCommands = useMemo(() => buildMplsCliCommands(state, effectiveDeviceId ?? "PE1"), [state, effectiveDeviceId]);
  const explorerLib = (state.lib[effectiveDeviceId ?? "PE1"] ?? []).map((e) => ({
    fec: e.fec,
    localLabel: e.localLabel !== undefined ? fmtLabel(e.localLabel) : undefined,
    remoteBindings: e.remoteBindings.map((b) => ({ neighbor: b.neighbor, label: fmtLabel(b.label) })),
  }));
  const explorerLfib = (state.lfib[effectiveDeviceId ?? "PE1"] ?? []).map((e) => ({
    fec: e.fec,
    incomingLabel: e.incomingLabel === "UNLABELED" ? "unlabeled" : fmtLabel(e.incomingLabel),
    action: e.action,
    outgoingLabel: e.outgoingLabel !== undefined ? fmtLabel(e.outgoingLabel) : undefined,
    outgoingInterface: e.outgoingInterface,
  }));

  const explorerTabs: DeviceExplorerTab[] =
    nodeExplanation && effectiveDeviceId
      ? [
          {
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
          },
          {
            id: "hardware",
            label: "Hardware",
            content: (
              <div className="space-y-2 text-xs text-pv-text-muted">
                <p>
                  Generic stylized {DEVICE_ROUTERS.includes(effectiveDeviceId) && (effectiveDeviceId === "PE1" || effectiveDeviceId === "PE2") ? "Provider Edge (LER)" : "Provider (LSR)"} chassis — {deviceInterfaces.length} physical interface{deviceInterfaces.length === 1 ? "" : "s"}.
                </p>
                <p className="pv-mono text-[11px] text-pv-text-faint">Rotate in the 3D view to inspect the hardware; click a port to select it in the Interfaces tab.</p>
              </div>
            ),
          },
          { id: "interfaces", label: "Interfaces", content: <InterfaceListTab interfaces={deviceInterfaces} selectedInterfaceId={selectedInterfaceId} onSelectInterface={setSelectedInterfaceId} /> },
          { id: "lib", label: "LIB", content: <LibViewer title={effectiveDeviceId} entries={explorerLib} /> },
          { id: "lfib", label: "LFIB", content: <LfibViewer title={effectiveDeviceId} entries={explorerLfib} /> },
          {
            id: "packet",
            label: "Packet",
            content:
              activePacket && effectiveDeviceId && (activePacket.from === effectiveDeviceId || activePacket.to === effectiveDeviceId) ? (
                <PacketInspector packet={activePacket} />
              ) : (
                <p className="text-xs text-pv-text-faint">No packet at this device right now.</p>
              ),
          },
          { id: "cli", label: "CLI", content: <CLIOutputPanel commands={explorerCliCommands} /> },
        ]
      : [];

  useEffect(() => {
    if (isComplete && !awardedRef.current) {
      awardedRef.current = true;
      completeLesson("mpls-fundamentals", 250);
      unlockAchievement("label-switcher");
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
    setFocusedObject(undefined);
    setHistoricalIndex(undefined);
  };

  const nextLabel = currentStep?.question && !lastAnswer ? "Answer to continue" : currentStep?.requiresState && !canAdvance ? "Apply the correct fix to continue" : "Next Step →";

  const focusLib = (state.lib[focusRouter] ?? []).map((e) => ({
    fec: e.fec,
    localLabel: e.localLabel !== undefined ? fmtLabel(e.localLabel) : undefined,
    remoteBindings: e.remoteBindings.map((b) => ({ neighbor: b.neighbor, label: fmtLabel(b.label) })),
  }));
  const focusLfib = (state.lfib[focusRouter] ?? []).map((e) => ({
    fec: e.fec,
    incomingLabel: e.incomingLabel === "UNLABELED" ? "unlabeled" : fmtLabel(e.incomingLabel),
    action: e.action,
    outgoingLabel: e.outgoingLabel !== undefined ? fmtLabel(e.outgoingLabel) : undefined,
    outgoingInterface: e.outgoingInterface,
  }));
  const focusIgp = state.igpRoutes[focusRouter];

  return (
    <div className="mx-auto max-w-7xl px-6 py-10">
      <div className="mb-6">
        <Badge tone="cyan" className="mb-3">
          MPLS · LDP · Label Switching (Transport Only)
        </Badge>
        <h1 className="text-2xl font-semibold text-pv-text sm:text-3xl">One Packet, Three Labels, Zero Extra IP Lookups</h1>
        <p className="mt-2 max-w-3xl text-sm text-pv-text-muted">
          CE1 → PE1 → P1 → P2 → PE2 → CE2. Bring up LDP yourself, watch label bindings distribute upstream from PE2, then push, swap
          and pop a real label stack across the core.
        </p>
      </div>

      <div className="mb-4 grid gap-2 sm:grid-cols-4">
        {WHY_MPLS.map((item) => (
          <GlassPanel key={item.q} className="p-3">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-pv-cyan-soft">{item.q}</p>
            <p className="text-[11px] leading-snug text-pv-text-muted">{item.a}</p>
          </GlassPanel>
        ))}
      </div>

      <div className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        {TERMS.map((t) => (
          <GlassPanel key={t.term} className="p-2.5" title={t.meaning}>
            <p className="pv-mono text-xs font-bold text-pv-text">{t.term}</p>
            <p className="text-[10px] text-pv-text-faint">{t.expansion}</p>
          </GlassPanel>
        ))}
      </div>

      {/* TIMELINE */}
      <div className="mb-4 flex gap-1 overflow-x-auto pb-2">
        {mplsSteps.map((step, i) => (
          <button
            key={step.id}
            type="button"
            disabled={i > index}
            onClick={() => i < index && engine.goTo(i)}
            title={step.label}
            className={clsx(
              "h-1.5 flex-1 min-w-4 rounded-full transition-colors",
              i < index ? "bg-pv-success/70 hover:bg-pv-success cursor-pointer" : i === index ? "bg-pv-cyan" : "bg-white/10",
            )}
          />
        ))}
      </div>

      <div className="mb-6 flex flex-wrap gap-3">
        <div className="flex gap-1 rounded-full border border-pv-border p-0.5 w-fit">
          {(["physical", "labelFlow", "3d"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setViewMode(m)}
              className={clsx(
                "rounded-full px-3 py-1.5 text-xs font-semibold uppercase tracking-wide transition-colors",
                viewMode === m ? "bg-pv-cyan/15 text-pv-cyan-soft" : "text-pv-text-faint hover:text-pv-text",
              )}
            >
              {m === "physical" ? "Physical Topology" : m === "labelFlow" ? "Label Flow" : "3D Explore"}
            </button>
          ))}
        </div>
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
              onChange={handleCameraModeChange}
            />
            {inDeviceMode && (
              <TopologyModeSwitcher
                options={[
                  { value: "off", label: "Exterior" },
                  { value: "on", label: "Forwarding X-Ray" },
                ]}
                value={deviceXray ? "on" : "off"}
                onChange={(v) => setDeviceXray(v === "on")}
                tone="violet"
              />
            )}
          </>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_400px]">
        {/* MAIN COLUMN */}
        <div className="space-y-6">
          {viewMode === "physical" ? (
            <GraphTopologyViewer nodes={GRAPH_NODES} edges={edges} activeNodeIds={activeNodeIds} regions={GRAPH_REGIONS}>
              {activePacket && packetFrom && packetTo && <GraphPacket packet={activePacket} from={packetFrom} to={packetTo} />}
            </GraphTopologyViewer>
          ) : viewMode === "labelFlow" ? (
            <LabelFlowView nodes={labelFlowNodes} />
          ) : (
            <>
              <TopologyFrame questionActive={questionActive} onExpand={() => setFocusMode(true)}>
              {focusMode ? (
                // Focus Mode renders its own full-size <NetworkScene3D> below —
                // avoid a second, fully hidden WebGL canvas running behind the
                // modal (one-canvas invariant, see sr-mpls-foundations).
                <div className="h-96 w-full rounded-2xl border border-pv-border bg-pv-bg-elevated sm:h-[28rem]" />
              ) : (
              <NetworkScene3D
                nodes={nodes3D}
                links={links3D}
                activePacket={inDeviceMode ? undefined : activePacket3D}
                regions={cameraMode === "overview" ? regions3D : []}
                onSelectNode={(id) => {
                  setSelectedNodeId(id);
                  setPacketSelected(false);
                  setSelectedLinkId(undefined);
                }}
                onSelectLink={(id) => {
                  setSelectedLinkId(id);
                  setSelectedNodeId(undefined);
                  setPacketSelected(false);
                }}
                selectedLinkId={selectedLinkId}
                onFocusLink={setFocusedObject}
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
                        pipelineTitle: "Conceptual LDP / MPLS Pipeline",
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
                  direction={packetDirection}
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
                <DeviceExplorerPanel
                  explanation={nodeExplanation!}
                  tabs={explorerTabs}
                  xrayEnabled={deviceXray}
                  onToggleXray={() => setDeviceXray((v) => !v)}
                  xrayOnLabel="Forwarding X-Ray"
                  onExit={() => {
                    setCameraMode("overview");
                    setEnteredDeviceId(undefined);
                  }}
                />
              ) : selectedNodeId === "CE1" || selectedNodeId === "CE2" ? (
                <GlassPanel strong className="space-y-2 p-5">
                  <h3 className="pv-mono text-lg font-bold text-pv-text">{selectedNodeId}</h3>
                  <p className="text-[11px] uppercase tracking-wide text-pv-text-faint">Customer Edge Router</p>
                  <p className="text-xs text-pv-text-muted">Outside the MPLS domain entirely — sends and receives plain, unlabeled IP packets. Never runs LDP, never sees a label.</p>
                </GlassPanel>
              ) : (
                !packetSelected &&
                !selectedLinkDetail && (
                  <NodeInspectorPanel explanation={nodeExplanation} packet={xrayPacket} xrayEnabled={false}>
                    {selectedNodeId && DEVICE_ROUTERS.includes(selectedNodeId as RouterId) && (
                      <Button
                        size="sm"
                        onClick={() => {
                          setEnteredDeviceId(selectedNodeId as RouterId);
                          setCameraMode("device");
                        }}
                      >
                        Enter Router →
                      </Button>
                    )}
                  </NodeInspectorPanel>
                )
              )}
            </>
          )}

          {lastHop && (
            <ForwardingDecisionCard router={lastHop.router} input={lastHop.input} lookup={lastHop.lookup} action={lastHop.action} output={lastHop.output} />
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
            <PredictionQuestion
              question={currentStep.question}
              selectedOptionId={lastAnswer?.stepId === currentStep.id ? lastAnswer.optionId : undefined}
              onAnswer={handleAnswer}
            />
          )}

          {!isComplete && currentStep?.id === "repair-challenge" && (
            <RepairChallenge options={REPAIR_OPTIONS} attempt={state.repairAttempt} onTry={(choice) => engine.act({ choice })} />
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

          {showPlaneSplit && !isComplete && (
            <PlaneSplitPanel
              controlTitle="Control Plane — OSPF + LDP"
              controlRows={[
                { label: "IGP (OSPF)", value: "Converged" },
                ...LDP_LINKS.map((l) => ({ label: `LDP ${l.a}↔${l.b}`, value: LDP_STATE_LABEL[state.ldp[l.id]] })),
              ]}
              dataTitle="Data Plane — Current Packet"
              dataRows={
                state.packet
                  ? [
                      { label: "Location", value: state.packetAt ?? "—" },
                      { label: "Labels on wire", value: state.packet.labels.length ? state.packet.labels.map((l) => l.value).join(", ") : "(none)" },
                      { label: "Destination", value: state.packet.dstIp },
                    ]
                  : [{ label: "Packet", value: "none in flight" }]
              }
            />
          )}

          {isComplete && (
            <GlassPanel strong glow="success" className="flex flex-col items-center gap-4 p-10 text-center">
              <Badge tone="success">Label Switcher</Badge>
              <h2 className="text-2xl font-semibold text-pv-text">The LSP Is Operational</h2>
              <p className="max-w-md text-sm text-pv-text-muted">
                You brought up LDP from Hello through label mapping, watched PUSH → SWAP → POP transform a real label stack, learned
                why penultimate hop popping exists, and repaired a broken LDP adjacency under a healthy IGP. +250 XP awarded.
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
              <Button variant={autoPlay ? "primary" : "ghost"} size="sm" onClick={handleToggleAutoPlay}>
                {autoPlay ? "⏸ Auto-Playing" : "▶ Auto-Play"}
              </Button>
              <div className="flex gap-1 rounded-full border border-pv-border p-0.5">
                {([0.5, 1, 2] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setSpeed(s)}
                    className={clsx(
                      "rounded-full px-2.5 py-1 text-[10px] font-semibold pv-mono transition-colors",
                      speed === s ? "bg-pv-cyan/15 text-pv-cyan-soft" : "text-pv-text-faint hover:text-pv-text",
                    )}
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
          <PacketInspector packet={activePacket} />

          <ProtocolStateMachine
            title="PE1 ↔ P1 LDP Session"
            states={LDP_STATE_ORDER}
            labels={LDP_STATE_LABEL}
            current={state.ldp["PE1-P1"]}
            descriptions={LDP_STATE_INFO}
          />

          <div className="flex flex-wrap gap-1 rounded-full border border-pv-border p-0.5 w-fit">
            {PROVIDER_ROUTERS.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setFocusRouter(r)}
                className={clsx(
                  "rounded-full px-3 py-1 text-[11px] font-semibold pv-mono transition-colors",
                  focusRouter === r ? "bg-pv-cyan/15 text-pv-cyan-soft" : "text-pv-text-faint hover:text-pv-text",
                )}
              >
                {r}
              </button>
            ))}
          </div>

          <RouteTablePanel title={`${focusRouter} — IGP Route`} routes={focusIgp ? [focusIgp] : []} />
          <LibViewer title={focusRouter} entries={focusLib} />
          <LfibViewer title={focusRouter} entries={focusLfib} />
          <PacketJourneyTimeline hops={state.journey} />
          <CLIOutputPanel commands={cliCommands} />
        </div>
      </div>

      {focusMode && (
        <TopologyFocusMode
          onClose={() => setFocusMode(false)}
          toolbar={
            <>
              <TopologyModeSwitcher
                options={[
                  { value: "overview", label: "Overview" },
                  { value: "device", label: "Device" },
                  { value: "packetFollow", label: "Packet Follow" },
                  { value: "freeOrbit", label: "Free Orbit" },
                ]}
                value={cameraMode}
                onChange={handleCameraModeChange}
              />
              {inDeviceMode && (
                <TopologyModeSwitcher options={[{ value: "off", label: "Exterior" }, { value: "on", label: "Forwarding X-Ray" }]} value={deviceXray ? "on" : "off"} onChange={(v) => setDeviceXray(v === "on")} tone="violet" />
              )}
            </>
          }
          header={
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
              <div className="flex min-w-0 items-center gap-2">
                <Badge tone="muted">
                  Step {index + 1} / {totalSteps}
                </Badge>
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
                regions={cameraMode === "overview" ? regions3D : []}
                onSelectNode={(id) => {
                  setSelectedNodeId(id);
                  setPacketSelected(false);
                  setSelectedLinkId(undefined);
                }}
                onSelectLink={(id) => setSelectedLinkId(id)}
                selectedLinkId={selectedLinkId}
                onFocusLink={setFocusedObject}
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
                        pipelineTitle: "Conceptual LDP / MPLS Pipeline",
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
              <LinkDetailPanel
                detail={selectedLinkDetail}
                onClose={() => {
                  setSelectedLinkId(undefined);
                  setFocusedObject(undefined);
                }}
              />
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
            ) : historicalIndex !== undefined && historicalTrace ? (
              <div className="space-y-3">
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
                <HopInspectorPanel
                  trace={focusTrace}
                  deviceName={focusInspectDeviceId ?? "—"}
                  interfaces={focusInterfaces}
                  onFocusNextHop={(id) => {
                    setSelectedNodeId(id);
                    if (cameraMode === "device") setEnteredDeviceId(id as RouterId);
                  }}
                />
                <PacketDiffViewer before={focusTrace.packetBeforeFrames} after={focusTrace.packetAfterFrames} beforeText={focusTrace.packetBefore} afterText={focusTrace.packetAfter} mutations={focusTrace.mutations} />
              </div>
            ) : inDeviceMode ? (
              <DeviceExplorerPanel
                explanation={nodeExplanation!}
                tabs={explorerTabs}
                xrayEnabled={deviceXray}
                onToggleXray={() => setDeviceXray((v) => !v)}
                xrayOnLabel="Forwarding X-Ray"
                onExit={() => {
                  setCameraMode("overview");
                  setEnteredDeviceId(undefined);
                }}
              />
            ) : nodeExplanation ? (
              <NodeInspectorPanel explanation={nodeExplanation} packet={xrayPacket} xrayEnabled={false} />
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
                currentIndex={historicalIndex !== undefined ? journeyHopEntries.findIndex((h) => h.index === historicalIndex) : journeyHopEntries.length - 1}
                onSelectHop={(i) => {
                  const entry = journeyHopEntries[i];
                  if (!entry) return;
                  if (entry.index === index) {
                    // The rightmost/current entry — return to live inspection.
                    setHistoricalIndex(undefined);
                    return;
                  }
                  setHistoricalIndex(entry.index);
                  setFocusedObject(undefined);
                  const histState = engine.getStateAt(entry.index);
                  const histStep = mplsSteps[entry.index];
                  const histPacket = histStep && histState ? histStep.packet?.(histState) : undefined;
                  const router = deviceForStep(entry.id, histPacket);
                  if (router && DEVICE_ROUTERS.includes(router)) {
                    setSelectedNodeId(router);
                    if (cameraMode === "device") setEnteredDeviceId(router);
                  }
                }}
              />
              <PacketFlowControls
                playing={autoPlay}
                onTogglePlay={handleToggleAutoPlay}
                onPrevHop={() => {
                  setHistoricalIndex(undefined);
                  engine.goTo(Math.max(0, index - 1));
                }}
                onNextHop={() => {
                  setHistoricalIndex(undefined);
                  engine.advance();
                }}
                onReset={handleRestart}
                canPrevHop={index > 0}
                canNextHop={canAdvance}
                speed={speed as PlaySpeed}
                onSpeedChange={setSpeed}
                followPacket={cameraMode === "packetFollow"}
                onToggleFollowPacket={() => handleCameraModeChange(cameraMode === "packetFollow" ? "overview" : "packetFollow")}
                view3D={viewMode === "3d"}
                onToggleView3D={() => setViewMode((v) => (v === "3d" ? "physical" : "3d"))}
              />
            </div>
          }
        />
      )}
    </div>
  );
}

function RepairChallenge({
  options,
  attempt,
  onTry,
}: {
  options: { id: string; label: string }[];
  attempt?: { choice: string; correct: boolean };
  onTry: (choice: string) => void;
}) {
  return (
    <GlassPanel strong className="p-5">
      <p className="mb-3 text-sm font-medium text-pv-text">Choose the correct repair for the P1 ↔ P2 link:</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((opt) => {
          const isSelected = attempt?.choice === opt.id;
          const isCorrect = opt.id === "enable-ldp";
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
        <div
          className={clsx(
            "mt-4 rounded-xl border p-4 text-sm",
            attempt.correct ? "border-pv-success/50 bg-pv-success/10 text-pv-success" : "border-pv-warning/40 bg-pv-warning/5 text-pv-text-muted",
          )}
        >
          {attempt.correct ? (
            <span className="font-semibold">✓ LDP re-enabled — Hello, session, and label mapping all restored.</span>
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

/** Derives a close-but-non-clipping camera eye offset from a focused object's world-space bounding size (see sr-mpls-foundations for the same helper). */
function eyeOffsetForFocusTarget(target: FocusTarget3D): [number, number, number] {
  const [sx, sy, sz] = target.size ?? [0.6, 0.3, 0.3];
  const maxDim = Math.max(sx, sy, sz);
  const dist = Math.max(0.55, maxDim * 1.8);
  return [dist * 0.55, dist * 0.5, dist * 0.75];
}
