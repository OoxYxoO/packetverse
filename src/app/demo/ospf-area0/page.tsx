"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { clsx } from "clsx";
import { useScenarioEngine } from "@/lib/sim-engine/useScenarioEngine";
import {
  ALL_ROUTERS,
  GRAPH_EDGES,
  GRAPH_NODES,
  NEIGHBOR_STATE_INFO,
  NEIGHBOR_STATE_LABEL,
  NEIGHBOR_STATE_ORDER,
  ROUTER_IDS,
  buildCliCommands,
  computeSpf,
  createOspfState,
  ospfSteps,
  type OspfState,
  type RouterId,
} from "@/lib/sim-engine/scenarios/ospfArea0";
import { GraphTopologyViewer, type GraphEdge, type GraphEdgeState } from "@/components/network/GraphTopologyViewer";
import { GraphPacket } from "@/components/network/GraphPacket";
import { PacketInspector } from "@/components/network/PacketInspector";
import { ProtocolStateMachine } from "@/components/protocol/ProtocolStateMachine";
import { LSDBViewer } from "@/components/protocol/LSDBViewer";
import { SpfPathPanel } from "@/components/protocol/SpfPathPanel";
import { RouteTablePanel } from "@/components/protocol/RouteTablePanel";
import { CLIOutputPanel } from "@/components/protocol/CLIOutputPanel";
import { PredictionQuestion } from "@/components/quiz/PredictionQuestion";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { useProgressStore } from "@/lib/state/useProgressStore";
import { NetworkScene3D } from "@/components/network3d/NetworkScene3D";
import { TopologyQuickExpand } from "@/components/network3d/TopologyQuickExpand";
import { NodeInspectorPanel } from "@/components/network3d/NodeInspectorPanel";
import { PacketFocusPanel } from "@/components/network3d/PacketFocusPanel";
import { TopologyModeSwitcher } from "@/components/network3d/TopologyModeSwitcher";
import { DeviceExplorerPanel, InterfaceListTab, type DeviceExplorerTab } from "@/components/network3d/DeviceExplorerPanel";
import { PacketDetailPanel } from "@/components/network3d/PacketDetailPanel";
import { LinkDetailPanel } from "@/components/network3d/LinkDetailPanel";
import { PlaneViewSwitcher, type PlaneView } from "@/components/network3d/PlaneViewSwitcher";
import { layoutTo3D } from "@/components/network3d/layout";
import type { ActivePacket3D, CameraMode, Link3DData, Node3DStatus } from "@/components/network3d/types";
import type { FloodCopy3D } from "@/components/network3d/NetworkScene3D";
import {
  FLOOD_ORIGIN_BY_STEP,
  PRIMARY_TRANSITION_ROUTER,
  computeFloodWaves,
  dataForwardTrace,
  explainRouter,
  floodEdgesForWave,
  interfacesFor,
  linkDetailFor,
  lsaInspectorPacket,
  packetFramesFor,
  traceFor,
} from "./deviceTrace";

const DEVICE_ROUTERS: RouterId[] = ALL_ROUTERS;
const CHALLENGE_COST_OPTIONS = [10, 15, 20, 25, 30, 50, 60];
const PACKET_STEP_COUNT = ospfSteps.filter((s) => !!s.packet).length;
const COST_CHANGE_STEP_INDEX = ospfSteps.findIndex((s) => s.id === "cost-changed");

const WHY_OSPF: { q: string; a: string }[] = [
  { q: "WHAT is OSPF?", a: "A link-state interior gateway protocol — routers flood a map of the network, then each calculates its own paths." },
  { q: "WHY does it exist?", a: "Static routes don't scale, and don't react when a link fails." },
  { q: "WITHOUT it?", a: "R1 only ever knows its directly connected networks — nothing an admin didn't type by hand." },
  { q: "WHY run SPF?", a: "Every router needs a consistent, loop-free view of the shortest path to everywhere, computed independently." },
];

export default function OspfArea0Demo() {
  const { engine, snapshot } = useScenarioEngine<OspfState>(createOspfState(), ospfSteps);
  const [autoPlay, setAutoPlay] = useState(false);
  const [speed, setSpeed] = useState<0.5 | 1 | 2>(1);
  const [viewMode, setViewMode] = useState<"physical" | "logical" | "3d">("physical");
  const [selectedNodeId, setSelectedNodeId] = useState<RouterId | undefined>(undefined);
  const [cameraMode, setCameraMode] = useState<CameraMode | "spf">("overview");
  const [enteredDeviceId, setEnteredDeviceId] = useState<RouterId | undefined>(undefined);
  const [deviceXray, setDeviceXray] = useState(true);
  const [autoEnterDevices, setAutoEnterDevices] = useState(true);
  const [selectedInterfaceId, setSelectedInterfaceId] = useState<string | undefined>(undefined);
  const [selectedLinkId, setSelectedLinkId] = useState<string | undefined>(undefined);
  const [packetSelected, setPacketSelected] = useState(false);
  const [spfTreeMode, setSpfTreeMode] = useState(false);
  const [spfRootOverride, setSpfRootOverride] = useState<RouterId>("R1");
  const [planeView, setPlaneView] = useState<PlaneView>("both");
  const [floodTopologyMode, setFloodTopologyMode] = useState(false);
  const [floodWaveIndex, setFloodWaveIndex] = useState(0);
  const [selectedFloodCopyId, setSelectedFloodCopyId] = useState<string | undefined>(undefined);
  const [sendingUserPacket, setSendingUserPacket] = useState(false);
  const [userPacketHop, setUserPacketHop] = useState(0);
  const [sentPackets, setSentPackets] = useState<{ when: "before" | "after"; path: RouterId[]; cost: number }[]>([]);
  const completeLesson = useProgressStore((s) => s.completeLesson);
  const recordAnswer = useProgressStore((s) => s.recordAnswer);
  const unlockAchievement = useProgressStore((s) => s.unlockAchievement);
  const awardedRef = useRef(false);

  const { state, currentStep, index, totalSteps, isComplete, lastAnswer, whatChanged, activePacket } = snapshot;
  const canAdvance = engine.canAdvance();

  const nodes = useMemo(() => GRAPH_NODES.map((n) => ({ ...n, subLabel: ROUTER_IDS[n.id] })), []);

  const edges: GraphEdge[] = useMemo(
    () =>
      GRAPH_EDGES.map((e) => {
        const sa = state.neighborTables[e.a]?.[e.b]?.state ?? "DOWN";
        const sb = state.neighborTables[e.b]?.[e.a]?.state ?? "DOWN";
        const edgeState: GraphEdgeState = sa === "FULL" && sb === "FULL" ? "full" : sa === "DOWN" && sb === "DOWN" ? "down" : "forming";
        return { id: e.id, a: e.a, b: e.b, cost: state.interfaces[e.a]?.[e.b]?.cost ?? 0, state: edgeState };
      }),
    [state.neighborTables, state.interfaces],
  );

  const bestPathEdgeIds = useMemo(() => {
    const path = state.spfBestPath ?? [];
    const ids: string[] = [];
    for (let i = 0; i < path.length - 1; i++) {
      const edge = GRAPH_EDGES.find((e) => (e.a === path[i] && e.b === path[i + 1]) || (e.b === path[i] && e.a === path[i + 1]));
      if (edge) ids.push(edge.id);
    }
    return ids;
  }, [state.spfBestPath]);

  const activeNodeIds = activePacket ? [activePacket.from, activePacket.to] : [];
  const packetFrom = activePacket ? nodes.find((n) => n.id === activePacket.from) : undefined;
  const packetTo = activePacket ? nodes.find((n) => n.id === activePacket.to) : undefined;

  const cliCommands = useMemo(() => buildCliCommands(state, "R1"), [state]);

  // --- 3D derived state (Scene Adapter = deviceTrace.ts; no protocol logic here or in components/network3d/) ---
  const nodes3DBase = useMemo(() => layoutTo3D(GRAPH_NODES), []);
  const adjacentRouters = new Set<RouterId>();
  for (const e of GRAPH_EDGES) {
    const sa = state.neighborTables[e.a]?.[e.b]?.state ?? "DOWN";
    if (sa !== "DOWN") {
      adjacentRouters.add(e.a);
      adjacentRouters.add(e.b);
    }
  }
  const nodes3D = nodes3DBase.map((n) => {
    let status: Node3DStatus = "idle";
    if (n.id === selectedNodeId || n.id === enteredDeviceId) status = "selected";
    else if (activePacket && (n.id === activePacket.from || n.id === activePacket.to)) status = "active";
    else if (adjacentRouters.has(n.id as RouterId)) status = "onPath";
    const nbStates = DEVICE_ROUTERS.filter((r) => r !== n.id).map((r) => state.neighborTables[n.id as RouterId]?.[r]?.state ?? "DOWN");
    const badge = nbStates.some((s) => s === "FULL") ? "FULL" : nbStates.some((s) => s !== "DOWN") ? "FORMING" : undefined;
    return { ...n, status, badges: badge ? [badge] : undefined };
  });

  const spfTreeEdgeIds = useMemo(() => {
    if (!spfTreeMode) return new Set<string>();
    const lsdbView = state.lsdb[spfRootOverride];
    if (!lsdbView || Object.keys(lsdbView).length < 4) return new Set<string>();
    const dist = computeSpf(spfRootOverride, lsdbView);
    const ids = new Set<string>();
    for (const dest of ALL_ROUTERS) {
      if (dest === spfRootOverride) continue;
      const path = dist[dest]?.path ?? [];
      for (let i = 0; i < path.length - 1; i++) {
        const edge = GRAPH_EDGES.find((e) => (e.a === path[i] && e.b === path[i + 1]) || (e.b === path[i] && e.a === path[i + 1]));
        if (edge) ids.add(edge.id);
      }
    }
    return ids;
  }, [spfTreeMode, spfRootOverride, state.lsdb]);

  // --- LSA Flooding Mode (brief §1) — origin/wave data comes from computeFloodWaves (a pure BFS over the
  // already-established adjacency graph in deviceTrace.ts); this component only owns the animation clock. ---
  const floodOrigin = FLOOD_ORIGIN_BY_STEP[currentStep?.id ?? ""];
  const floodWaves = useMemo(() => (floodOrigin ? computeFloodWaves(floodOrigin, state.neighborTables) : []), [floodOrigin, state.neighborTables]);
  const floodEdges = floodTopologyMode && floodOrigin ? floodEdgesForWave(floodWaves, floodWaveIndex, state.neighborTables) : [];
  const floodCopies: FloodCopy3D[] = floodEdges.map((e) => ({ id: `${e.id}-w${floodWaveIndex}`, fromId: e.from, toId: e.to }));
  const floodComplete = floodOrigin ? floodWaveIndex >= Math.max(0, floodWaves.length - 1) : false;
  const selectedFloodLsa = selectedFloodCopyId && floodOrigin ? state.lsdb[floodOrigin]?.[floodOrigin] : undefined;
  const floodLsaPacket = selectedFloodLsa ? lsaInspectorPacket(selectedFloodLsa) : undefined;

  // Reset the wave clock when the step (or its origin) changes — done during render, not an effect,
  // since this is "adjust state when a prop changes," the pattern React explicitly recommends handling
  // this way rather than with an effect (https://react.dev/reference/react/useState#storing-information-from-previous-renders).
  const floodKey = `${currentStep?.id ?? ""}|${floodOrigin ?? ""}`;
  const [prevFloodKey, setPrevFloodKey] = useState(floodKey);
  if (prevFloodKey !== floodKey) {
    setPrevFloodKey(floodKey);
    if (floodWaveIndex !== 0) setFloodWaveIndex(0);
  }

  useEffect(() => {
    if (!floodTopologyMode || !floodOrigin || floodWaveIndex >= floodWaves.length - 1) return;
    const t = setTimeout(() => setFloodWaveIndex((w) => w + 1), 1600);
    return () => clearTimeout(t);
  }, [floodTopologyMode, floodOrigin, floodWaveIndex, floodWaves.length]);

  // --- Data-plane demonstration (brief §3/§4) — the path/cost come straight from state.routingTables.R1.R4,
  // the ACTUAL route OSPF's SPF installed. Nothing here decides a path; it only animates the already-decided one. ---
  const userPacketPath = state.routingTables.R1?.R4?.path ?? [];
  const userPacketCost = state.routingTables.R1?.R4?.cost;
  const userPacketPathKey = userPacketPath.join(">");
  const dataPacketAtRouter = sendingUserPacket && userPacketHop < userPacketPath.length - 1 ? userPacketPath[userPacketHop] : undefined;
  const dataPacketNextRouter = sendingUserPacket && userPacketHop < userPacketPath.length - 1 ? userPacketPath[userPacketHop + 1] : undefined;
  const dataPacketDelivered = sendingUserPacket && userPacketHop >= userPacketPath.length - 1;
  const dataPacket3D: ActivePacket3D | undefined =
    dataPacketAtRouter && dataPacketNextRouter
      ? {
          packet: {
            id: `data-hop-${userPacketHop}`,
            protocol: "IP",
            from: dataPacketAtRouter,
            to: dataPacketNextRouter,
            summary: "Normal IP packet — R1-side host → R4-side host",
            layers: [
              {
                name: "IPv4",
                color: "var(--pv-proto-ip)",
                fields: [
                  { label: "Source", value: "R1-side host (10.1.0.0/24)" },
                  { label: "Destination", value: "R4-side host (10.4.0.0/24)" },
                  { label: "Note", value: "Carried using the route OSPF installed — not an OSPF packet itself" },
                ],
              },
            ],
          },
          fromId: dataPacketAtRouter,
          toId: dataPacketNextRouter,
        }
      : undefined;

  useEffect(() => {
    if (!sendingUserPacket) return;
    if (userPacketHop >= userPacketPath.length - 1) {
      const beforeCostChange = index < COST_CHANGE_STEP_INDEX;
      const when: "before" | "after" = beforeCostChange ? "before" : "after";
      const path = userPacketPath;
      const cost = userPacketCost ?? 0;
      const t = setTimeout(() => {
        setSentPackets((prev) => [...prev.filter((p) => p.when !== when), { when, path, cost }]);
        setSendingUserPacket(false);
      }, 1400);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setUserPacketHop((h) => h + 1), 1300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sendingUserPacket, userPacketHop, userPacketPathKey]);

  const beforePacket = sentPackets.find((p) => p.when === "before");
  const afterPacket = sentPackets.find((p) => p.when === "after");

  const showControlPlane = planeView !== "data";
  const showDataPlane = planeView !== "control";

  const links3D: Link3DData[] = GRAPH_EDGES.map((e) => ({
    id: e.id,
    a: e.a,
    b: e.b,
    label: `cost ${state.interfaces[e.a]?.[e.b]?.cost ?? "?"}`,
    active: activePacket ? (e.a === activePacket.from && e.b === activePacket.to) || (e.b === activePacket.from && e.a === activePacket.to) : false,
    onPath: spfTreeMode ? spfTreeEdgeIds.has(e.id) : adjacentRouters.has(e.a) && adjacentRouters.has(e.b) && (state.neighborTables[e.a]?.[e.b]?.state === "FULL" || state.neighborTables[e.b]?.[e.a]?.state === "FULL"),
  }));

  const activePacket3D: ActivePacket3D | undefined = activePacket && nodes3D.some((n) => n.id === activePacket.from) && nodes3D.some((n) => n.id === activePacket.to) ? { packet: activePacket, fromId: activePacket.from, toId: activePacket.to } : undefined;
  const questionActive = !isComplete && !!currentStep?.question && lastAnswer?.stepId !== currentStep.id;
  const selectedNode3D = nodes3D.find((n) => n.id === selectedNodeId);

  // Which router (if any) is actively processing the current packet right now — drives auto-enter in Packet Follow mode.
  // A normal IP packet departing a router (brief §3) takes priority — it's the reason the learner is looking, and it's
  // a completely separate concern from the OSPF control-plane transitions/packets PRIMARY_TRANSITION_ROUTER covers.
  const activeDeviceId = dataPacketAtRouter ?? PRIMARY_TRANSITION_ROUTER[currentStep?.id ?? ""] ?? DEVICE_ROUTERS.find((r) => traceFor(r, state, currentStep?.id ?? "", activePacket).activeStageId !== undefined);
  const effectiveDeviceId = cameraMode === "device" ? enteredDeviceId : cameraMode === "packetFollow" && autoEnterDevices ? activeDeviceId : undefined;
  const inDeviceMode = !!effectiveDeviceId;

  const deviceTrace =
    effectiveDeviceId && dataPacketAtRouter === effectiveDeviceId && dataPacketNextRouter
      ? dataForwardTrace(effectiveDeviceId, dataPacketNextRouter)
      : effectiveDeviceId
        ? traceFor(effectiveDeviceId, state, currentStep?.id ?? "", activePacket)
        : undefined;

  const followPacketIntoCurrentDevice = () => {
    if (!packetSelected || cameraMode !== "device") return;
    const snap = engine.getSnapshot();
    const nextDevice = PRIMARY_TRANSITION_ROUTER[snap.currentStep?.id ?? ""] ?? DEVICE_ROUTERS.find((r) => traceFor(r, snap.state, snap.currentStep?.id ?? "", snap.activePacket).activeStageId !== undefined);
    if (nextDevice) setEnteredDeviceId(nextDevice);
  };

  const deviceInterfaces = effectiveDeviceId ? interfacesFor(effectiveDeviceId, state, currentStep?.id ?? "", activePacket) : [];
  const devicePacketFrames = effectiveDeviceId ? packetFramesFor(activePacket) : undefined;

  const followNode3D = cameraMode === "packetFollow" && activePacket ? nodes3D.find((n) => n.id === activePacket.to) : undefined;
  const focusPosition3D: [number, number, number] | undefined =
    cameraMode === "freeOrbit" ? undefined : cameraMode === "spf" ? [0, 0, 0] : inDeviceMode ? [0, 0, deviceXray ? -0.2 : 0] : cameraMode === "packetFollow" ? followNode3D?.position : selectedNode3D?.position;
  const eyeOffset3D: [number, number, number] | undefined = cameraMode === "spf" ? [0.01, 9, 0.01] : inDeviceMode ? (deviceXray ? [0.6, 2.6, 5.2] : [2.1, 1.5, 3.8]) : undefined;

  const explainTargetId = effectiveDeviceId ?? selectedNodeId ?? followNode3D?.id;
  const nodeExplanation = explainTargetId ? explainRouter(state, explainTargetId as RouterId, currentStep?.id ?? "", activePacket) : undefined;
  const xrayPacket = activePacket && (selectedNodeId === activePacket.from || selectedNodeId === activePacket.to) ? activePacket : undefined;

  const selectedLinkDetail = selectedLinkId ? linkDetailFor(selectedLinkId, state, activePacket) : undefined;
  const packetCurrentDeviceLabel = effectiveDeviceId ?? activePacket?.to ?? activePacket?.from ?? "—";
  const packetDirection = activePacket ? `${activePacket.from} → ${activePacket.to}` : "—";
  const packetStepsSoFar = ospfSteps.slice(0, index + 1).filter((s) => !!s.packet).length;

  const explorerCliCommands = useMemo(() => buildCliCommands(state, effectiveDeviceId ?? "R1"), [state, effectiveDeviceId]);
  const explorerRoutes = Object.values(state.routingTables[effectiveDeviceId ?? "R1"] ?? {})
    .filter((r): r is NonNullable<typeof r> => Boolean(r))
    .map((r) => ({ destination: r.destination, nextHop: r.nextHop, cost: r.cost, path: r.path }));

  const explorerTabs: DeviceExplorerTab[] = nodeExplanation
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
                Generic stylized OSPF router chassis — {deviceInterfaces.length} physical interface{deviceInterfaces.length === 1 ? "" : "s"}.
              </p>
              <p className="pv-mono text-[11px] text-pv-text-faint">Rotate in the 3D view to inspect the hardware; click a port to select it in the Interfaces tab.</p>
            </div>
          ),
        },
        {
          id: "interfaces",
          label: "Interfaces",
          content: <InterfaceListTab interfaces={deviceInterfaces} selectedInterfaceId={selectedInterfaceId} onSelectInterface={setSelectedInterfaceId} />,
        },
        {
          id: "neighbors",
          label: "Neighbors",
          content: effectiveDeviceId ? <NeighborsTab router={effectiveDeviceId} state={state} /> : null,
        },
        {
          id: "lsdb",
          label: "LSDB",
          content: <LSDBViewer routers={effectiveDeviceId ? [effectiveDeviceId, ...DEVICE_ROUTERS.filter((r) => r !== effectiveDeviceId)] : DEVICE_ROUTERS} lsdb={state.lsdb} />,
        },
        {
          id: "routes",
          label: "Routes",
          content: <RouteTablePanel title={effectiveDeviceId ?? "R1"} routes={explorerRoutes} />,
        },
        {
          id: "packet",
          label: "Packet",
          content: (
            <div className="space-y-2">
              {(nodeExplanation.packetBefore || nodeExplanation.packetAfter) && (
                <div className="rounded-lg border border-pv-border p-2.5 pv-mono text-[11px]">
                  {nodeExplanation.packetBefore && (
                    <p className="text-pv-text-muted">
                      Before: <span className="text-pv-text">{nodeExplanation.packetBefore}</span>
                    </p>
                  )}
                  {nodeExplanation.packetAfter && (
                    <p className="text-pv-text-muted">
                      After: <span className="text-pv-cyan-soft">{nodeExplanation.packetAfter}</span>
                    </p>
                  )}
                </div>
              )}
              {activePacket && effectiveDeviceId && (activePacket.from === effectiveDeviceId || activePacket.to === effectiveDeviceId) ? (
                <PacketInspector packet={activePacket} />
              ) : (
                <p className="text-xs text-pv-text-faint">No packet at this device right now.</p>
              )}
            </div>
          ),
        },
        { id: "cli", label: "CLI", content: <CLIOutputPanel commands={explorerCliCommands} /> },
      ]
    : [];

  useEffect(() => {
    if (isComplete && !awardedRef.current) {
      awardedRef.current = true;
      completeLesson("ospf-fundamentals", 150);
      unlockAchievement("spf-navigator");
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
    setFloodTopologyMode(false);
    setFloodWaveIndex(0);
    setSelectedFloodCopyId(undefined);
    setSendingUserPacket(false);
    setUserPacketHop(0);
    setSentPackets([]);
  };

  const nextLabel = currentStep?.question && !lastAnswer ? "Answer to continue" : currentStep?.requiresState && !canAdvance ? "Change cost to continue" : "Next Step →";

  return (
    <div className="mx-auto max-w-7xl px-6 py-10">
      <div className="mb-6">
        <Badge tone="cyan" className="mb-3">
          OSPF · Single Area · Point-to-Point
        </Badge>
        <h1 className="text-2xl font-semibold text-pv-text sm:text-3xl">R1 Learns The Network — Automatically</h1>
        <p className="mt-2 max-w-3xl text-sm text-pv-text-muted">
          Four routers, Area 0, point-to-point links. Form the adjacencies yourself, synchronize the link-state database, watch SPF pick
          the best path, then change the physics of the network by changing a single number.
        </p>
      </div>

      <div className="mb-6 grid gap-2 sm:grid-cols-4">
        {WHY_OSPF.map((item) => (
          <GlassPanel key={item.q} className="p-3">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-pv-cyan-soft">{item.q}</p>
            <p className="text-[11px] leading-snug text-pv-text-muted">{item.a}</p>
          </GlassPanel>
        ))}
      </div>

      {/* TIMELINE */}
      <div className="mb-6 flex gap-1 overflow-x-auto pb-2">
        {ospfSteps.map((step, i) => (
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
        <TopologyModeSwitcher
          options={[
            { value: "physical", label: "Physical 2D" },
            { value: "logical", label: "Logical OSPF" },
            { value: "3d", label: "3D Explore" },
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
                { value: "spf", label: "SPF Analysis" },
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
                if (v === "freeOrbit" || v === "spf") setEnteredDeviceId(undefined);
              }}
            />
            {inDeviceMode && (
              <TopologyModeSwitcher
                options={[
                  { value: "off", label: "Exterior" },
                  { value: "on", label: "X-Ray" },
                ]}
                value={deviceXray ? "on" : "off"}
                onChange={(v) => setDeviceXray(v === "on")}
                tone="violet"
              />
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
            {(cameraMode === "spf" || cameraMode === "overview") && (
              <TopologyModeSwitcher
                options={[
                  { value: "off", label: "Network Topology" },
                  { value: "on", label: "SPF Tree" },
                ]}
                value={spfTreeMode ? "on" : "off"}
                onChange={(v) => setSpfTreeMode(v === "on")}
                tone="violet"
              />
            )}
            {spfTreeMode && (
              <TopologyModeSwitcher options={DEVICE_ROUTERS.map((r) => ({ value: r, label: r }))} value={spfRootOverride} onChange={setSpfRootOverride} />
            )}
            {cameraMode === "overview" && (
              <TopologyModeSwitcher
                options={[
                  { value: "off", label: "Normal Topology" },
                  { value: "on", label: "LSA Flooding" },
                ]}
                value={floodTopologyMode ? "on" : "off"}
                onChange={(v) => {
                  setFloodTopologyMode(v === "on");
                  setSelectedFloodCopyId(undefined);
                }}
                tone="violet"
              />
            )}
            <PlaneViewSwitcher value={planeView} onChange={setPlaneView} />
          </>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_400px]">
        {/* MAIN COLUMN */}
        <div className="space-y-6">
          {viewMode === "3d" ? (
            <>
              <TopologyQuickExpand questionActive={questionActive} nodes={nodes3D} links={links3D} activePacket={dataPacket3D ? (showDataPlane ? dataPacket3D : undefined) : showControlPlane ? activePacket3D : undefined}>
              <NetworkScene3D
                nodes={nodes3D}
                links={links3D}
                activePacket={inDeviceMode ? undefined : dataPacket3D ? (showDataPlane ? dataPacket3D : undefined) : showControlPlane ? activePacket3D : undefined}
                floodCopies={!inDeviceMode && showControlPlane ? floodCopies : []}
                onSelectFloodCopy={(id) => {
                  setSelectedFloodCopyId(id);
                  setPacketSelected(false);
                  setSelectedLinkId(undefined);
                }}
                selectedFloodCopyId={selectedFloodCopyId}
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
              </TopologyQuickExpand>

              {cameraMode === "spf" && (
                <GlassPanel strong className="p-5">
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-pv-cyan-soft">SPF Analysis — Root {state.spfRoot ?? spfRootOverride}</h3>
                  <SpfPathPanel root={state.spfRoot ?? "R1"} destination="R4" paths={state.spfPaths ?? []} />
                </GlassPanel>
              )}

              {cameraMode === "overview" && floodTopologyMode && (
                <GlassPanel strong className="p-5">
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-pv-warning">LSA Flooding</h3>
                  {floodOrigin ? (
                    <p className="text-sm text-pv-text-muted">
                      Router-LSA {ROUTER_IDS[floodOrigin]} originated at <span className="text-pv-text">{floodOrigin}</span>. Wave {Math.min(floodWaveIndex + 1, floodWaves.length)} of {floodWaves.length}:{" "}
                      {floodWaves[floodWaveIndex]?.join(", ")} {floodWaveIndex > 0 ? "just received it." : "is the origin."}
                      {floodComplete && " Flooding complete — every reachable router's LSDB is synchronized. Any further copy would be recognized as already-known (same sequence) and dropped, not re-flooded."}
                    </p>
                  ) : (
                    <p className="text-sm text-pv-text-faint">No LSA origination or update at this step — LSDBs are already synchronized. This mode lights up right after a Router-LSA is (re)originated (the initial mesh flood, or a cost change).</p>
                  )}
                </GlassPanel>
              )}

              {selectedFloodCopyId && floodLsaPacket && (
                <GlassPanel strong className="space-y-2 p-5">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-pv-warning">LSA In Flight</h3>
                    <button type="button" onClick={() => setSelectedFloodCopyId(undefined)} className="text-xs text-pv-text-faint hover:text-pv-text">
                      ✕
                    </button>
                  </div>
                  <PacketInspector packet={floodLsaPacket} />
                </GlassPanel>
              )}

              {cameraMode === "overview" && showDataPlane && (
                <GlassPanel strong className="space-y-3 p-5">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-pv-cyan-soft">Data Plane — Normal IP Forwarding</h3>
                  <p className="text-xs text-pv-text-muted">
                    OSPF built the routing information. This sends one ordinary IP packet from an R1-side host to an R4-side host, using the route already installed — OSPF itself never forwards it.
                  </p>
                  <Button
                    size="sm"
                    disabled={userPacketPath.length === 0 || sendingUserPacket}
                    onClick={() => {
                      setSendingUserPacket(true);
                      setUserPacketHop(0);
                    }}
                  >
                    {userPacketPath.length === 0 ? "No OSPF route to R4 yet" : sendingUserPacket ? (dataPacketDelivered ? "Delivered" : `In flight: ${dataPacketAtRouter} → ${dataPacketNextRouter}`) : "Send Test Packet →"}
                  </Button>
                  {(beforePacket || afterPacket) && (
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <div className={clsx("rounded-lg border p-3", beforePacket ? "border-pv-border" : "border-pv-border/40")}>
                        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-pv-text-faint">Before Cost Change</p>
                        {beforePacket ? (
                          <p className="pv-mono text-xs text-pv-text">
                            {beforePacket.path.join(" → ")} <span className="text-pv-text-faint">(cost {beforePacket.cost})</span>
                          </p>
                        ) : (
                          <p className="text-xs text-pv-text-faint">Not sent yet.</p>
                        )}
                      </div>
                      <div className={clsx("rounded-lg border p-3", afterPacket ? "border-pv-success/50 bg-pv-success/5" : "border-pv-border/40")}>
                        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-pv-text-faint">After Cost Change</p>
                        {afterPacket ? (
                          <p className="pv-mono text-xs text-pv-text">
                            {afterPacket.path.join(" → ")} <span className="text-pv-text-faint">(cost {afterPacket.cost})</span>
                          </p>
                        ) : (
                          <p className="text-xs text-pv-text-faint">Not sent yet.</p>
                        )}
                      </div>
                    </div>
                  )}
                </GlassPanel>
              )}

              {cameraMode === "packetFollow" && (
                <PacketFocusPanel
                  currentHopLabel={activePacket ? `${activePacket.from} → ${activePacket.to}: ${activePacket.summary}` : undefined}
                  hopIndex={packetStepsSoFar}
                  totalHops={PACKET_STEP_COUNT}
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
                  tabs={explorerTabs}
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
                  <NodeInspectorPanel explanation={nodeExplanation} packet={xrayPacket} xrayEnabled={false}>
                    {selectedNodeId && DEVICE_ROUTERS.includes(selectedNodeId) && (
                      <Button
                        size="sm"
                        onClick={() => {
                          setEnteredDeviceId(selectedNodeId);
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
          ) : (
            <GraphTopologyViewer nodes={nodes} edges={edges} activeNodeIds={activeNodeIds} bestPathEdgeIds={viewMode === "logical" ? bestPathEdgeIds : []}>
              {activePacket && packetFrom && packetTo && <GraphPacket packet={activePacket} from={packetFrom} to={packetTo} />}
            </GraphTopologyViewer>
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

          {!isComplete && currentStep?.id === "challenge" && (
            <ChallengeControl
              options={CHALLENGE_COST_OPTIONS}
              currentCost={state.interfaces.R1?.R2?.cost}
              triedCost={state.challengeCost}
              succeeded={state.challengeSucceeded}
              route={state.routingTables.R1?.R4}
              onTry={(cost) => engine.act({ cost })}
            />
          )}

          {whatChanged.length > 0 && !currentStep?.question && currentStep?.id !== "challenge" && (
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
              <Badge tone="success">SPF Navigator</Badge>
              <h2 className="text-2xl font-semibold text-pv-text">OSPF Converged On Your Path</h2>
              <p className="max-w-md text-sm text-pv-text-muted">
                You formed every adjacency, synchronized four LSDBs, ran SPF twice, broke and fixed an area mismatch, and steered
                traffic by changing a single cost. +150 XP awarded.
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
          {showControlPlane && <PacketInspector packet={activePacket} />}
          {showControlPlane && (
            <ProtocolStateMachine
              title="R1 ↔ R2 Neighbor State"
              states={NEIGHBOR_STATE_ORDER}
              labels={NEIGHBOR_STATE_LABEL}
              current={state.neighborTables.R2?.R1?.state ?? "DOWN"}
              descriptions={NEIGHBOR_STATE_INFO}
            />
          )}
          {showControlPlane && <LSDBViewer routers={ALL_ROUTERS} lsdb={state.lsdb} />}
          {showControlPlane && <SpfPathPanel root="R1" destination="R4" paths={state.spfPaths ?? []} />}
          <RouteTablePanel
            title="R1"
            routes={Object.values(state.routingTables.R1 ?? {})
              .filter((r): r is NonNullable<typeof r> => Boolean(r))
              .map((r) => ({ destination: r.destination, nextHop: r.nextHop, cost: r.cost, path: r.path }))}
          />
          <CLIOutputPanel commands={cliCommands} />
        </div>
      </div>
    </div>
  );
}

function NeighborsTab({ router, state }: { router: RouterId; state: OspfState }) {
  const neighborIds = (Object.keys(state.neighborTables[router] ?? {}) as RouterId[]);
  const [focused, setFocused] = useState<RouterId | undefined>(neighborIds[0]);
  const active = focused ?? neighborIds[0];

  if (neighborIds.length === 0) return <p className="text-xs text-pv-text-faint">No OSPF-enabled neighbors.</p>;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {neighborIds.map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => setFocused(n)}
            className={clsx(
              "rounded-lg border px-2.5 py-1.5 pv-mono text-[11px] transition-colors",
              active === n ? "border-pv-cyan/50 bg-pv-cyan/10 text-pv-cyan-soft" : "border-pv-border text-pv-text-muted hover:text-pv-text",
            )}
          >
            {n} ({ROUTER_IDS[n]}) — {NEIGHBOR_STATE_LABEL[state.neighborTables[router]?.[n]?.state ?? "DOWN"]}
          </button>
        ))}
      </div>
      {active && (
        <ProtocolStateMachine
          title={`${router} ↔ ${active} Neighbor State`}
          states={NEIGHBOR_STATE_ORDER}
          labels={NEIGHBOR_STATE_LABEL}
          current={state.neighborTables[router]?.[active]?.state ?? "DOWN"}
          descriptions={NEIGHBOR_STATE_INFO}
        />
      )}
    </div>
  );
}

function ChallengeControl({
  options,
  currentCost,
  triedCost,
  succeeded,
  route,
  onTry,
}: {
  options: number[];
  currentCost?: number;
  triedCost?: number;
  succeeded?: boolean;
  route?: { nextHop: RouterId; cost: number };
  onTry: (cost: number) => void;
}) {
  return (
    <GlassPanel strong className="p-5">
      <p className="mb-3 text-sm font-medium text-pv-text">Set R1&apos;s interface cost toward R2:</p>
      <div className="flex flex-wrap gap-2">
        {options.map((cost) => (
          <button
            key={cost}
            type="button"
            onClick={() => onTry(cost)}
            className={clsx(
              "rounded-lg border px-3 py-2 text-sm pv-mono transition-colors cursor-pointer",
              cost === currentCost ? "border-pv-cyan/60 bg-pv-cyan/10 text-pv-cyan-soft" : "border-pv-border hover:border-pv-cyan/40 hover:bg-pv-cyan/5",
            )}
          >
            {cost}
          </button>
        ))}
      </div>

      {triedCost !== undefined && route && (
        <div
          className={clsx(
            "mt-4 rounded-xl border p-4 text-sm",
            succeeded ? "border-pv-success/50 bg-pv-success/10 text-pv-success" : "border-pv-warning/40 bg-pv-warning/5 text-pv-text-muted",
          )}
        >
          {succeeded ? (
            <>
              <span className="mb-1 block font-semibold">✓ R1 → R3 → R4 is now the best path.</span>
              Cost {triedCost} made the R2 path (10 + {triedCost} = {10 + triedCost}) more expensive than R1 → R3 → R4 (cost 25).
            </>
          ) : (
            <>
              <span className="mb-1 block font-semibold text-pv-text">Still routing via {route.nextHop}, cost {route.cost}.</span>
              R1 → R3 → R4 costs 25 — you need R1 → R2 → R4 (10 + {triedCost}) to cost more than that.
            </>
          )}
        </div>
      )}
    </GlassPanel>
  );
}
