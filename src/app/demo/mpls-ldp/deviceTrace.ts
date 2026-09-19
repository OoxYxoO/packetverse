import type { DeviceInterfaceData, DeviceProcessingTrace, LinkDetail, NodeExplanation, PacketMutation, PacketStackFrame, ProcessingStage } from "@/components/network3d/types";
import type { PacketVisual } from "@/lib/sim-engine/types";
import {
  FEC,
  GRAPH_EDGES,
  LDP_LINKS,
  LDP_STATE_INFO,
  LDP_STATE_LABEL,
  ROUTER_LOOPBACK,
  fmtLabel,
  type ForwardingAction,
  type JourneyHop,
  type LdpLinkId,
  type MplsState,
  type RouterId,
} from "@/lib/sim-engine/scenarios/mplsLdp";

/**
 * The "Scene Adapter" (Batch B brief §3-13) for MPLS/LDP's device-interior
 * 3D view. Every stage list, checkpoint, interface, and link-detail value
 * below is computed FROM MplsState (the ScenarioEngine's own output) —
 * this file never decides an LDP session state, a label allocation, or a
 * forwarding action itself; it only re-describes decisions mplsLdp.ts's
 * own step `run()` functions already made, in the generic
 * DeviceProcessingTrace/DeviceInterfaceData/LinkDetail/NodeExplanation
 * shapes the 3D layer understands. Nothing in components/network3d/
 * imports this file.
 *
 * Two genuinely distinct journeys live here, on purpose (brief §5):
 *   - LDP CONTROL PLANE (Hello/Session/Label Mapping) has no growing
 *     per-hop array in MplsState — those steps are keyed off
 *     `currentStepId` directly, exactly like BGP Route Reflector's
 *     non-packet FSM-transition branches.
 *   - MPLS DATA PLANE (PUSH/SWAP/POP/IP_FORWARD) already has a real,
 *     immutable, growing `state.journey: JourneyHop[]` — reused exactly
 *     like SR-MPLS Foundations' `traceFor` does (`hopInspectionFields()`
 *     derived straight from the existing `JourneyHop`), never a second
 *     parallel forwarding log.
 */

function isTransitLsr(router: RouterId): boolean {
  return router === "P1" || router === "P2";
}

// ---------------------------------------------------------------------------
// Conceptual pipelines (brief §5/§9) — LDP control plane is one shared
// discovery→session→label-exchange→LFIB-install ladder every provider
// router walks; MPLS data plane gets a per-forwarding-action pipeline,
// mirroring SR-MPLS Foundations' per-role split.
// ---------------------------------------------------------------------------

const LDP_CONTROL_STAGES: ProcessingStage[] = [
  { id: "hello", label: "LDP Hello (Discovery)" },
  { id: "session", label: "TCP Session (646)" },
  { id: "label-exchange", label: "Label Mapping Exchange" },
  { id: "lfib-install", label: "LFIB Install" },
];

const PUSH_STAGES: ProcessingStage[] = [
  { id: "ingress", label: "Ingress (Unlabeled)" },
  { id: "fec-lookup", label: "FEC Lookup" },
  { id: "push", label: "PUSH Transport Label" },
  { id: "egress", label: "Egress" },
];
const SWAP_STAGES: ProcessingStage[] = [
  { id: "ingress", label: "Ingress" },
  { id: "lfib-lookup", label: "LFIB Lookup" },
  { id: "swap", label: "SWAP Label" },
  { id: "egress", label: "Egress" },
];
const POP_STAGES: ProcessingStage[] = [
  { id: "ingress", label: "Ingress" },
  { id: "lfib-lookup", label: "LFIB Lookup (implicit-null)" },
  { id: "pop", label: "POP (Penultimate Hop Popping)" },
  { id: "egress", label: "Egress (Unlabeled)" },
];
const IP_FORWARD_STAGES: ProcessingStage[] = [
  { id: "ingress", label: "Ingress (Unlabeled)" },
  { id: "ip-lookup", label: "IP Routing Table Lookup" },
  { id: "deliver", label: "Deliver" },
];

const IDLE_STAGES: ProcessingStage[] = [
  { id: "interface", label: "Interface" },
  { id: "ldp", label: "LDP Session" },
  { id: "lib", label: "LIB" },
  { id: "lfib", label: "LFIB" },
  { id: "forwarding", label: "Forwarding Result" },
];
function idleTrace(router: RouterId): DeviceProcessingTrace {
  return { deviceId: router, stages: IDLE_STAGES, completedStageIds: [] };
}

function allIds(stages: ProcessingStage[]) {
  return stages.map((s) => s.id);
}

/** Interface id for `router`'s port facing `neighbor` — must match `interfacesFor`'s own `id`. */
function ifaceId(router: RouterId, neighbor: RouterId): string {
  return `${router}-${neighbor}`;
}

function ldpLinkFor(a: RouterId, b: RouterId): LdpLinkId | undefined {
  return LDP_LINKS.find((l) => (l.a === a && l.b === b) || (l.a === b && l.b === a))?.id;
}

/** Which router is the primary inspection subject of a given step — the packet's SENDER (or receiver, if no sender applies) for a message-carrying step, or a fixed router for a no-packet control-plane/fault step. Sender-priority, not receiver-priority like BGP/OSPF's `deviceForStep` — deliberately: every MPLS data-plane `JourneyHop` is recorded against the router performing the PUSH/SWAP/POP (the sender of that hop's outgoing packet), so `state.journey.filter(h => h.router === X)` only has data for the sender at the exact step it acted; the receiver's own hop isn't recorded until its own later step. LDP control-plane branches deliberately give BOTH sender and receiver real data, so this priority never produces a worse default there either. */
export const PRIMARY_TRANSITION_ROUTER: Record<string, RouterId> = {
  "ldp-other-sessions": "P1",
  "lfib-pe1": "PE1",
  "fault-injected": "P1",
  "repair-challenge": "P1",
};

export function deviceForStep(stepId: string, packet: PacketVisual | undefined): RouterId | undefined {
  if (packet) return (packet.from ?? packet.to) as RouterId;
  return PRIMARY_TRANSITION_ROUTER[stepId];
}

// ---------------------------------------------------------------------------
// MPLS data-plane hop enrichment — derived entirely from the existing
// `JourneyHop` (brief §9/§10), same principle as SR-MPLS's
// `hopInspectionFields()`. `hop.input`/`hop.output` are always either
// "IP packet ..." prose or "label <N> [+ IP packet]" — `extractLabel`
// only ever pulls a number that's actually written in that hop's own
// text, never guesses one.
// ---------------------------------------------------------------------------

const LOOKUP_TYPE_BY_ACTION: Record<ForwardingAction, string> = {
  PUSH: "FEC Lookup",
  SWAP: "LFIB",
  POP: "LFIB (implicit-null / PHP)",
  POP_AND_LOOKUP: "LFIB → IP Lookup",
  IP_FORWARD: "IP Routing Table",
  DROP: "LFIB (no match)",
};
const STAGES_BY_ACTION: Record<ForwardingAction, ProcessingStage[]> = {
  PUSH: PUSH_STAGES,
  SWAP: SWAP_STAGES,
  POP: POP_STAGES,
  POP_AND_LOOKUP: POP_STAGES,
  IP_FORWARD: IP_FORWARD_STAGES,
  DROP: IP_FORWARD_STAGES,
};
const ACTIVE_STAGE_BY_ACTION: Record<ForwardingAction, string> = {
  PUSH: "push",
  SWAP: "swap",
  POP: "pop",
  POP_AND_LOOKUP: "pop",
  IP_FORWARD: "deliver",
  DROP: "deliver",
};

function extractLabel(text: string): number | undefined {
  const m = text.match(/label (\d+)/);
  return m ? Number(m[1]) : undefined;
}

function mutationsForAction(hop: JourneyHop): PacketMutation[] {
  switch (hop.action) {
    case "PUSH":
      return [{ type: "PUSH", detail: hop.output }];
    case "SWAP":
      return [{ type: "SWAP", detail: hop.output }];
    case "POP":
    case "POP_AND_LOOKUP":
      return [{ type: "POP", detail: hop.input }];
    default:
      return [];
  }
}

function stackFramesFor(prefix: string, text: string, justChanged: boolean): PacketStackFrame[] {
  const label = extractLabel(text);
  const frames: PacketStackFrame[] = [];
  if (label !== undefined) frames.push({ id: `${prefix}-mpls`, text: `MPLS ${label}`, tone: "transport", justChanged });
  frames.push({ id: `${prefix}-ip`, text: "IP", tone: "ip" });
  return frames;
}

/** Next-hop for a data-plane hop — the next journey entry if one already exists (an earlier, already-passed hop), or `state.packetAt` when this IS the most-recently-recorded hop (which already reflects where the packet now is, per ARCHITECTURE.md §1). */
function nextHopFor(hop: JourneyHop, state: MplsState): { id?: RouterId; label?: string } {
  if (hop.action === "IP_FORWARD" || hop.action === "DROP") return {};
  const idx = state.journey.indexOf(hop);
  const isLast = idx === state.journey.length - 1;
  const nextRouter = !isLast ? state.journey[idx + 1]?.router : state.packetAt;
  if (!nextRouter || nextRouter === hop.router) return {};
  return { id: nextRouter, label: nextRouter };
}
function prevRouterFor(hop: JourneyHop, state: MplsState): RouterId | undefined {
  const idx = state.journey.indexOf(hop);
  return idx > 0 ? state.journey[idx - 1].router : undefined;
}

function forwardingTraceFor(router: RouterId, hop: JourneyHop, state: MplsState): DeviceProcessingTrace {
  const stages = STAGES_BY_ACTION[hop.action];
  const prevRouter = prevRouterFor(hop, state);
  const nextHop = nextHopFor(hop, state);
  const isCurrent = state.journey[state.journey.length - 1] === hop;
  return {
    deviceId: router,
    ingressInterfaceId: prevRouter ? ifaceId(router, prevRouter) : undefined,
    egressInterfaceId: nextHop.id ? ifaceId(router, nextHop.id) : undefined,
    stages,
    activeStageId: isCurrent ? ACTIVE_STAGE_BY_ACTION[hop.action] : undefined,
    completedStageIds: isCurrent ? stages.slice(0, -1).map((s) => s.id) : allIds(stages),
    packetBefore: hop.input,
    packetAfter: hop.output,
    packetBeforeFrames: stackFramesFor("before", hop.input, false),
    packetAfterFrames: stackFramesFor("after", hop.output, true),
    lookupType: LOOKUP_TYPE_BY_ACTION[hop.action],
    lookupKey: hop.input,
    lookupResult: `${hop.action} → ${hop.output}`,
    reason: hop.lookup,
    nextHopId: nextHop.id,
    nextHopLabel: nextHop.label,
    mutations: mutationsForAction(hop),
    forwardingAction: `${hop.router}: ${hop.action} — ${hop.output}`,
  };
}

/**
 * Per-router trace. LDP control-plane steps are keyed off `currentStepId`
 * directly (mirrors BGP Route Reflector's non-packet FSM-transition
 * branches); every MPLS forwarding step instead falls through to
 * `state.journey`, which already grows correctly and is never
 * retroactively mutated (mirrors SR-MPLS Foundations).
 */
export function traceFor(router: RouterId, state: MplsState, currentStepId: string): DeviceProcessingTrace {
  // --- LDP control-plane steps with no packet-driven journey entry ---
  if (currentStepId === "ldp-hello" && (router === "PE1" || router === "P1")) {
    return {
      deviceId: router,
      stages: LDP_CONTROL_STAGES,
      activeStageId: "hello",
      completedStageIds: [],
      ingressInterfaceId: router === "P1" ? ifaceId("P1", "PE1") : undefined,
      egressInterfaceId: router === "PE1" ? ifaceId("PE1", "P1") : undefined,
      lookupType: "LDP Discovery",
      lookupKey: "UDP 646 (multicast)",
      lookupResult: "Neighbor discovered",
      reason: LDP_STATE_INFO.HELLO.meaning,
      forwardingAction: "PE1 and P1 discover each other as LDP-capable neighbors.",
    };
  }
  if (currentStepId === "ldp-session" && (router === "PE1" || router === "P1")) {
    return {
      deviceId: router,
      stages: LDP_CONTROL_STAGES,
      activeStageId: "session",
      completedStageIds: ["hello"],
      ingressInterfaceId: router === "PE1" ? ifaceId("PE1", "P1") : undefined,
      egressInterfaceId: router === "P1" ? ifaceId("P1", "PE1") : undefined,
      lookupType: "LDP Session Init",
      lookupKey: "TCP 646",
      lookupResult: "Session established",
      reason: LDP_STATE_INFO.SESSION.meaning,
      forwardingAction: "P1 opens a TCP session to PE1 on port 646.",
    };
  }
  if (currentStepId === "ldp-other-sessions" && isTransitLsr(router)) {
    return {
      deviceId: router,
      stages: LDP_CONTROL_STAGES,
      activeStageId: "session",
      completedStageIds: ["hello"],
      lookupType: "LDP Session Init",
      lookupResult: "Session established",
      reason: "The identical Hello → TCP session sequence PE1↔P1 just completed happens independently here.",
      forwardingAction: `${router}'s other LDP session(s) reach Operational the same way.`,
    };
  }
  if (currentStepId === "label-dist-pe2" && (router === "PE2" || router === "P2")) {
    const sending = router === "PE2";
    return {
      deviceId: router,
      stages: LDP_CONTROL_STAGES,
      activeStageId: "label-exchange",
      completedStageIds: ["hello", "session"],
      ingressInterfaceId: !sending ? ifaceId("P2", "PE2") : undefined,
      egressInterfaceId: sending ? ifaceId("PE2", "P2") : undefined,
      lookupType: "LDP Label Mapping",
      lookupKey: FEC,
      lookupResult: sending ? "Advertised implicit-null" : "Received implicit-null from PE2",
      reason: "PE2 owns this FEC — as the final hop, it advertises implicit-null upstream so the penultimate router pops the label itself (PHP).",
      forwardingAction: "PE2 advertises implicit-null for 4.4.4.4/32.",
    };
  }
  if (currentStepId === "label-dist-p2" && (router === "P2" || router === "P1")) {
    const sending = router === "P2";
    const local = state.lib.P2[0]?.localLabel;
    return {
      deviceId: router,
      stages: LDP_CONTROL_STAGES,
      activeStageId: "label-exchange",
      completedStageIds: ["hello", "session"],
      ingressInterfaceId: !sending ? ifaceId("P1", "P2") : undefined,
      egressInterfaceId: sending ? ifaceId("P2", "P1") : undefined,
      lookupType: "LDP Label Mapping",
      lookupKey: FEC,
      lookupResult: sending ? `Advertised ${local !== undefined ? fmtLabel(local) : "—"}` : `Received ${local !== undefined ? fmtLabel(local) : "—"} from P2`,
      reason: "P2 allocates its own local label and advertises it upstream — LFIB entries are only built from labels actually received this way.",
      forwardingAction: sending ? "P2 allocates & advertises label 203." : "P1 receives label 203 from P2.",
    };
  }
  if (currentStepId === "label-dist-p1" && (router === "P1" || router === "PE1")) {
    const sending = router === "P1";
    const local = state.lib.P1[0]?.localLabel;
    return {
      deviceId: router,
      stages: LDP_CONTROL_STAGES,
      activeStageId: "label-exchange",
      completedStageIds: ["hello", "session"],
      ingressInterfaceId: !sending ? ifaceId("PE1", "P1") : undefined,
      egressInterfaceId: sending ? ifaceId("P1", "PE1") : undefined,
      lookupType: "LDP Label Mapping",
      lookupKey: FEC,
      lookupResult: sending ? `Advertised ${local !== undefined ? fmtLabel(local) : "—"}` : `Received ${local !== undefined ? fmtLabel(local) : "—"} from P1`,
      reason: "P1 allocates its own local label and advertises it upstream, exactly like P2 just did.",
      forwardingAction: sending ? "P1 allocates & advertises label 102." : "PE1 receives label 102 from P1.",
    };
  }
  if (currentStepId === "lfib-pe1" && router === "PE1") {
    const entry = state.lfib.PE1[0];
    return {
      deviceId: router,
      stages: LDP_CONTROL_STAGES,
      activeStageId: "lfib-install",
      completedStageIds: allIds(LDP_CONTROL_STAGES).filter((s) => s !== "lfib-install"),
      egressInterfaceId: ifaceId("PE1", "P1"),
      lookupType: "LFIB Install",
      lookupKey: FEC,
      lookupResult: entry ? `unlabeled → PUSH ${fmtLabel(entry.outgoingLabel ?? 0)} → ${entry.outgoingInterface}` : undefined,
      reason: "PE1 now has everything it needs: the FEC is IGP-reachable, and P1 advertised a label for it.",
      forwardingAction: "PE1 builds its LFIB: unlabeled IP in → PUSH 102 → toward P1.",
    };
  }
  if (currentStepId === "fault-injected" && isTransitLsr(router)) {
    return {
      deviceId: router,
      stages: LDP_CONTROL_STAGES,
      activeStageId: "hello",
      completedStageIds: [],
      lookupType: "LDP Session",
      lookupResult: "Down — binding withdrawn",
      reason: "The LDP session between P1 and P2 goes down. OSPF is untouched — only the label binding P1 needs for its LFIB is gone.",
      forwardingAction: router === "P1" ? "P1's LIB/LFIB entries for 4.4.4.4/32 are withdrawn." : "P2's Hello toward P1 is no longer answered.",
    };
  }
  if (currentStepId === "repair-challenge" && router === "P1" && state.repairAttempt?.correct) {
    const entry = state.lfib.P1[0];
    return {
      deviceId: router,
      stages: LDP_CONTROL_STAGES,
      activeStageId: "lfib-install",
      completedStageIds: allIds(LDP_CONTROL_STAGES).filter((s) => s !== "lfib-install"),
      ingressInterfaceId: ifaceId("P1", "PE1"),
      egressInterfaceId: ifaceId("P1", "P2"),
      lookupType: "LFIB Install",
      lookupKey: FEC,
      lookupResult: entry ? `${entry.incomingLabel === "UNLABELED" ? "unlabeled" : fmtLabel(entry.incomingLabel)} → SWAP → ${fmtLabel(entry.outgoingLabel ?? 0)} → ${entry.outgoingInterface}` : undefined,
      reason: "LDP re-enabled on the P1↔P2 interface — Hello, session, and label mapping all restored.",
      forwardingAction: "P1's LFIB is restored: 102 → SWAP → 203 → toward P2.",
    };
  }

  // --- MPLS data-plane steps: journey-array-backed (SR-MPLS pattern) ---
  const hops = state.journey.filter((h) => h.router === router);
  const hop = hops[hops.length - 1];
  if (hop) return forwardingTraceFor(router, hop, state);

  return idleTrace(router);
}

// ---------------------------------------------------------------------------
// Packet visual (brief §8) — the label stack IS the real
// `state.packet.labels`, never re-derived from prose.
// ---------------------------------------------------------------------------

export function packetFramesFor(state: MplsState): PacketStackFrame[] | undefined {
  if (!state.packet) return undefined;
  const labelFrames: PacketStackFrame[] = state.packet.labels.map((l, i) => ({ id: `label-${i}`, text: `MPLS ${l.value}`, tone: "transport", justChanged: i === 0 }));
  return [...labelFrames, { id: "ip", text: "IP", tone: "ip" }];
}

// ---------------------------------------------------------------------------
// Physical interfaces (brief §4) — LDP session state / local-vs-remote
// label are LDP-specific fields carried in the generic `extra` bag.
// ---------------------------------------------------------------------------

function neighborsFor(router: RouterId): RouterId[] {
  return GRAPH_EDGES.filter((e) => e.a === router || e.b === router).map((e) => (e.a === router ? e.b : e.a));
}

function portName(index: number) {
  return `ge-0/0/${index}`;
}

export function interfacesFor(router: RouterId, state: MplsState): DeviceInterfaceData[] {
  const neighbors = neighborsFor(router);
  return neighbors.map((neighbor, idx) => {
    const linkId = ldpLinkFor(router, neighbor);
    const ldpState = linkId ? state.ldp[linkId] : undefined;
    const localEntry = state.lib[router]?.[0];
    const remoteFromThisNeighbor = localEntry?.remoteBindings.find((b) => b.neighbor === neighbor);
    const extra: { label: string; value: string }[] = [];
    if (linkId) {
      extra.push({ label: "LDP Enabled", value: "Yes" });
      extra.push({ label: "LDP State", value: LDP_STATE_LABEL[ldpState ?? "DOWN"] });
      if (localEntry?.localLabel !== undefined) extra.push({ label: "Local Label", value: fmtLabel(localEntry.localLabel) });
      if (remoteFromThisNeighbor) extra.push({ label: "Remote Label (from neighbor)", value: fmtLabel(remoteFromThisNeighbor.label) });
    } else {
      extra.push({ label: "LDP Enabled", value: "No — access link" });
    }
    return {
      id: ifaceId(router, neighbor),
      name: portName(idx),
      status: "up",
      ip: ROUTER_LOOPBACK[neighbor],
      neighborId: neighbor,
      neighborLabel: neighbor,
      linkType: linkId ? "Core (MPLS domain)" : "Access",
      mtu: linkId ? 9192 : 1500,
      protocols: linkId ? ["OSPF", "LDP", "MPLS"] : ["IP"],
      role: "idle",
      extra,
    };
  });
}

// ---------------------------------------------------------------------------
// Link detail (brief §4)
// ---------------------------------------------------------------------------

export function linkDetailFor(linkId: string, state: MplsState): LinkDetail | undefined {
  const edge = GRAPH_EDGES.find((e) => e.id === linkId);
  if (!edge) return undefined;
  const a = edge.a as RouterId;
  const b = edge.b as RouterId;
  const aIfaces = interfacesFor(a, state);
  const bIfaces = interfacesFor(b, state);
  const aIface = aIfaces.find((f) => f.neighborId === b);
  const bIface = bIfaces.find((f) => f.neighborId === a);
  if (!aIface || !bIface) return undefined;
  const ldpLink = ldpLinkFor(a, b);
  const traffic = state.packetAt && [a, b].includes(state.packetAt as RouterId) && state.packet ? `${state.packet.labels.map((l) => `[MPLS ${l.value}]`).join("")}${state.packet.labels.length ? "" : "[IP]"}` : undefined;
  return {
    aLabel: a,
    bLabel: b,
    aInterface: aIface,
    bInterface: bIface,
    status: "up",
    mtu: aIface.mtu,
    protocols: ldpLink
      ? [
          { label: "Link Type", value: "Core (MPLS domain)" },
          { label: "IGP", value: "OSPF" },
          { label: "LDP", value: LDP_STATE_LABEL[state.ldp[ldpLink]] },
        ]
      : [{ label: "Link Type", value: "Access (outside MPLS domain)" }],
    currentTraffic: traffic,
  };
}

// ---------------------------------------------------------------------------
// Node explanation (brief §3/§4) — tense-aware, derived from state.journey
// and the current step id, never hardcoded per-step text unrelated to
// what actually happened.
// ---------------------------------------------------------------------------

const ROLE_LABEL: Partial<Record<RouterId, string>> = { PE1: "INGRESS LER", P1: "TRANSIT LSR", P2: "TRANSIT LSR", PE2: "EGRESS LER" };
const DEVICE_TYPE: Partial<Record<RouterId, string>> = { PE1: "Provider Edge Router (LER)", P1: "Provider Router (LSR)", P2: "Provider Router (LSR)", PE2: "Provider Edge Router (LER)" };

export function explainRouter(state: MplsState, router: RouterId, currentStepId: string): NodeExplanation {
  const neighbors = neighborsFor(router);
  const hops = state.journey.filter((h) => h.router === router);
  const lastHop = hops[hops.length - 1];
  const trace = traceFor(router, state, currentStepId);

  let currentAction: string;
  if (trace.forwardingAction) currentAction = trace.forwardingAction;
  else if (lastHop) currentAction = `${router}: ${lastHop.action} — ${lastHop.output}`;
  else currentAction = `${router} is idle — no LDP session or forwarding activity yet.`;

  const lib = state.lib[router]?.[0];
  const lfib = state.lfib[router]?.[0];

  return {
    id: router,
    name: router,
    deviceType: DEVICE_TYPE[router] ?? "Customer Edge Router",
    role: ROLE_LABEL[router] ?? "CE ROUTER",
    currentAction,
    controlPlaneRole: "Runs LDP: discovers neighbors via Hello, establishes a TCP session, and exchanges label bindings for FECs the IGP already knows how to reach.",
    dataPlaneRole: router === "PE1" ? "Ingress LER — pushes the first transport label onto an unlabeled IP packet." : router === "PE2" ? "Egress LER — receives a plain IP packet (PHP already removed the label) and forwards it using a normal IP lookup." : "Transit LSR — swaps (or, at the penultimate hop, pops) the top label using only its LFIB, never inspecting the customer IP header.",
    tables: [
      {
        title: `${router} — Info`,
        rows: [
          { label: "Loopback", value: ROUTER_LOOPBACK[router] ?? "—" },
          { label: "LDP Neighbors", value: String(neighbors.filter((n) => ldpLinkFor(router, n)).length) },
          { label: "Local Label", value: lib?.localLabel !== undefined ? fmtLabel(lib.localLabel) : "none" },
          { label: "LFIB Action", value: lfib?.action ?? "none" },
        ],
      },
    ],
  };
}

export { fmtLabel };
