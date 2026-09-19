import type { DeviceInterfaceData, DeviceProcessingTrace, LinkDetail, NodeExplanation, PacketStackFrame, ProcessingStage } from "@/components/network3d/types";
import type { PacketVisual } from "@/lib/sim-engine/types";
import {
  BGP_STATE_INFO,
  BGP_STATE_LABEL,
  DEST_AS,
  DEST_PREFIX,
  IFACE_IP,
  ROUTER_AS,
  ROUTER_IDS,
  SESSIONS,
  bgpSteps,
  type BgpSessionState,
  type BgpState,
  type RouterId,
  type SessionId,
  type TcpState,
} from "@/lib/sim-engine/scenarios/bgpEnterprise";

/**
 * The "Scene Adapter" (brief §29) for BGP's device-interior 3D view.
 * Every stage list, checkpoint, interface, and link-detail value
 * below is computed FROM BgpState + the current step's PacketVisual
 * (the ScenarioEngine's own output) — this file never decides a BGP
 * session state, path attribute, or best-path winner itself; it only
 * re-describes decisions bgpEnterprise.ts already made (including its
 * own `computeBestPath`), in the generic DeviceProcessingTrace/
 * DeviceInterfaceData/LinkDetail/NodeExplanation shapes the 3D layer
 * understands. Nothing in components/network3d/ imports this file.
 *
 * BGP's mental model is deliberately NOT OSPF's: there is no LSDB, no
 * SPF, no flooding wave. Instead: a TCP session forms first and is
 * shown as ordinary TCP (brief §6), THEN a BGP FSM runs on top of it,
 * THEN UPDATE messages carry path *attributes* a learner inspects and
 * compares (brief §11/§14) rather than a graph a router recomputes.
 */

const stepIndex = (id: string) => bgpSteps.findIndex((s) => s.id === id);

// ---------------------------------------------------------------------------
// Conceptual BGP Control-Plane Pipeline — per-message-kind stage lists
// (brief §5/§30). TCP is kept visually and structurally separate from
// BGP itself (brief §6): a TCP packet only ever walks TCP_* stages, it
// never touches a BGP_*/FSM stage.
// ---------------------------------------------------------------------------

const TCP_SEND_STAGES: ProcessingStage[] = [
  { id: "session-init", label: "Session Init" },
  { id: "tcp-179", label: "TCP/179" },
  { id: "egress", label: "Egress" },
];
const TCP_RECEIVE_STAGES: ProcessingStage[] = [
  { id: "ingress", label: "Ingress Interface" },
  { id: "tcp-179", label: "TCP/179" },
  { id: "session-state", label: "Session State" },
];

const OPEN_SEND_STAGES: ProcessingStage[] = [
  { id: "bgp-process", label: "BGP Process (Originate OPEN)" },
  { id: "build-open", label: "Build OPEN Message" },
  { id: "egress", label: "Egress" },
];
const OPEN_RECEIVE_STAGES: ProcessingStage[] = [
  { id: "ingress", label: "Ingress Interface" },
  { id: "bgp-open", label: "BGP OPEN" },
  { id: "peer-validation", label: "Peer Validation" },
  { id: "capability-negotiation", label: "Capability / Parameter Negotiation" },
  { id: "fsm-transition", label: "FSM Transition" },
];

const KEEPALIVE_SEND_STAGES: ProcessingStage[] = [
  { id: "bgp-process", label: "BGP Process (Originate KEEPALIVE)" },
  { id: "build-keepalive", label: "Build KEEPALIVE" },
  { id: "egress", label: "Egress" },
];
const KEEPALIVE_RECEIVE_STAGES: ProcessingStage[] = [
  { id: "ingress", label: "Ingress Interface" },
  { id: "bgp-keepalive", label: "BGP KEEPALIVE" },
  { id: "liveness-confirmed", label: "Session Liveness Confirmed" },
  { id: "fsm-transition", label: "FSM Transition" },
];

const UPDATE_SEND_STAGES: ProcessingStage[] = [
  { id: "bgp-process", label: "BGP Process (Originate UPDATE)" },
  { id: "build-update", label: "Build UPDATE Message" },
  { id: "egress", label: "Egress" },
];
/** The full receive-side UPDATE pipeline (brief §30) — "Not every packet activates every stage" (brief §5): a plain receive only reaches `candidate-path`; the later best-path/install steps (which carry no packet of their own) advance the SAME router further along this SAME stage list. */
const UPDATE_STAGES: ProcessingStage[] = [
  { id: "ingress", label: "Ingress Interface" },
  { id: "parse-update", label: "Parse UPDATE" },
  { id: "validate-attrs", label: "Validate Attributes" },
  { id: "policy", label: "Policy" },
  { id: "candidate-path", label: "Candidate Path" },
  { id: "best-path-eval", label: "Best-Path Evaluation" },
  { id: "bgp-table", label: "BGP Table" },
  { id: "rib", label: "RIB Installation" },
];

const FSM_ONLY_STAGES: ProcessingStage[] = [
  { id: "tcp-179", label: "TCP Session" },
  { id: "peer-fsm", label: "Peer / FSM" },
];

/** Shown for a router uninvolved in the current step — the full umbrella pipeline (brief §5), entirely dim. */
const IDLE_STAGES: ProcessingStage[] = [
  { id: "interface", label: "Interface" },
  { id: "tcp-179", label: "TCP Session" },
  { id: "bgp-fsm", label: "BGP FSM" },
  { id: "bgp-table", label: "BGP Table" },
  { id: "rib", label: "RIB" },
  { id: "forwarding", label: "Forwarding Result" },
];
function idleTrace(router: RouterId): DeviceProcessingTrace {
  return { deviceId: router, stages: IDLE_STAGES, completedStageIds: [] };
}

/** Which conceptual BGP/TCP message kind is this, from protocol + badge the scenario file already set. */
function packetKind(packet: PacketVisual): "tcp" | "open" | "keepalive" | "update" | undefined {
  if (packet.protocol === "TCP") return "tcp";
  if (packet.protocol === "BGP") {
    if (packet.badge === "OPEN") return "open";
    if (packet.badge === "KEEPALIVE") return "keepalive";
    if (packet.badge === "UPDATE") return "update";
  }
  return undefined;
}

/** Interface id for `router`'s port facing `neighbor` — must match `interfacesFor`'s own `id` (brief §17: Hop Inspector ingress/egress rows resolve interface names by this id). */
function ifaceId(router: RouterId, neighbor: RouterId): string {
  return `${router}-${neighbor}`;
}

function sessionIdFor(a: RouterId, b: RouterId): SessionId | undefined {
  const direct = `${a}-${b}` as SessionId;
  const alt = `${b}-${a}` as SessionId;
  if (SESSIONS[direct]) return direct;
  if (SESSIONS[alt]) return alt;
  return undefined;
}

// ---------------------------------------------------------------------------
// Static step→FSM-transition tables (brief §7) — mirrors exactly what
// each step's own `run()` mutates in bgpEnterprise.ts. Kept here (not
// inferred) for the same reason OSPF's adapter keeps an equivalent
// table: `traceFor`/`explainRouter` only see the CURRENT state, not
// the previous one, so a BEFORE value can't be derived by diffing.
// ---------------------------------------------------------------------------

const TCP_STEP_TRANSITIONS: Record<string, { before: TcpState; after: TcpState }> = {
  "tcp-syn": { before: "CLOSED", after: "SYN_SENT" },
  "tcp-synack": { before: "SYN_SENT", after: "SYN_RECEIVED" },
  "tcp-ack": { before: "SYN_RECEIVED", after: "ESTABLISHED" },
};

const BGP_STEP_TRANSITIONS: Record<string, { before: BgpSessionState; after: BgpSessionState }> = {
  "bgp-connect": { before: "IDLE", after: "CONNECT" },
  "bgp-open-r1": { before: "CONNECT", after: "OPENSENT" },
  "bgp-open-r3": { before: "OPENSENT", after: "OPENCONFIRM" },
  "bgp-keepalive": { before: "OPENCONFIRM", after: "ESTABLISHED" },
  "secondary-sessions": { before: "IDLE", after: "ESTABLISHED" },
};
const BGP_STEP_EVENT: Record<string, string> = {
  "bgp-connect": "TCP connection completed",
  "bgp-open-r1": "R1 sends its OPEN",
  "bgp-open-r3": "R3's OPEN received and accepted",
  "bgp-keepalive": "Valid KEEPALIVE received",
  "secondary-sessions": "Identical TCP → OPEN → KEEPALIVE sequence completes on R2↔R4 and R1↔R2",
};

/** BEFORE/AFTER/WHY/EVENT for the current step's FSM transition (brief §7), or undefined when this step isn't an FSM-transition step. `why` is sourced straight from `BGP_STATE_INFO` — never re-authored here. */
export function fsmTransitionFor(currentStepId: string): { before: BgpSessionState; after: BgpSessionState; why: string; event: string } | undefined {
  const t = BGP_STEP_TRANSITIONS[currentStepId];
  if (!t) return undefined;
  return { ...t, why: BGP_STATE_INFO[t.after].why, event: BGP_STEP_EVENT[currentStepId] };
}

/** Primary router for Packet-Follow auto-enter on steps that carry no packet of their own (brief §29, mirrors OSPF's PRIMARY_TRANSITION_ROUTER). */
export const PRIMARY_TRANSITION_ROUTER: Record<string, RouterId> = {
  "bgp-connect": "R1",
  "secondary-sessions": "R2",
  "ibgp-share": "R1",
  "bestpath-r1": "R1",
  "install-r1": "R1",
  "bestpath-r2": "R2",
  "install-r2": "R2",
  "trouble-fix": "R2",
  "prepend-apply": "R2",
  "localpref-change": "R1",
  "challenge-intro": "R1",
  challenge: "R1",
};

/**
 * Per-router trace for the current packet (if any) or the current
 * step's internal event (best-path re-evaluation, FSM-only
 * transition, policy change) otherwise. Every branch below just
 * re-describes what bgpEnterprise.ts's own `run()`/`action()`
 * functions already decided — this never compares a LOCAL_PREF or
 * AS_PATH itself.
 */
export function traceFor(router: RouterId, state: BgpState, currentStepId: string, activePacket: PacketVisual | undefined): DeviceProcessingTrace {
  // --- FSM-only events with no packet object ---
  const fsm = BGP_STEP_TRANSITIONS[currentStepId];
  if (fsm && currentStepId === "bgp-connect" && router === "R1") {
    return { deviceId: router, stages: FSM_ONLY_STAGES, activeStageId: "peer-fsm", completedStageIds: ["tcp-179"], packetBefore: `BGP: ${BGP_STATE_LABEL[fsm.before]}`, packetAfter: `BGP: ${BGP_STATE_LABEL[fsm.after]}` };
  }
  if (fsm && currentStepId === "secondary-sessions" && (router === "R1" || router === "R2")) {
    return { deviceId: router, stages: FSM_ONLY_STAGES, activeStageId: "peer-fsm", completedStageIds: ["tcp-179"], packetBefore: `BGP: ${BGP_STATE_LABEL[fsm.before]}`, packetAfter: `BGP: ${BGP_STATE_LABEL[fsm.after]}`, forwardingAction: "R2↔R4 (eBGP) and R1↔R2 (iBGP) reach ESTABLISHED the same way R1↔R3 just did." };
  }

  // --- iBGP route-sharing / best-path / install / policy steps — no packet, router advances further along UPDATE_STAGES ---
  if (currentStepId === "ibgp-share" && (router === "R1" || router === "R2")) {
    return { deviceId: router, stages: UPDATE_STAGES, activeStageId: "candidate-path", completedStageIds: ["ingress", "parse-update", "validate-attrs", "policy"], forwardingAction: `${router} gains a second candidate path, relayed over iBGP.` };
  }
  if (currentStepId === "bestpath-r1" && router === "R1") {
    return { deviceId: router, stages: UPDATE_STAGES, activeStageId: "best-path-eval", completedStageIds: ["ingress", "parse-update", "validate-attrs", "policy", "candidate-path"], forwardingAction: "Comparing LOCAL_PREF, then AS_PATH length across both candidates." };
  }
  if (currentStepId === "install-r1" && router === "R1") {
    const best = state.bgpTables.R1.find((p) => p.best);
    return {
      deviceId: router,
      stages: UPDATE_STAGES,
      activeStageId: "rib",
      completedStageIds: ["ingress", "parse-update", "validate-attrs", "policy", "candidate-path", "best-path-eval", "bgp-table"],
      lookupType: "RIB Install",
      lookupKey: DEST_PREFIX,
      lookupResult: best ? `via ${best.isp}, NEXT_HOP ${best.attrs.nextHop}` : undefined,
      nextHopId: best?.advertisedBy,
      nextHopLabel: best?.advertisedBy,
      reason: best ? `LOCAL_PREF ${best.attrs.localPref}, AS_PATH length ${best.attrs.asPath.length} won the comparison.` : undefined,
      forwardingAction: best ? `Installed: ${DEST_PREFIX} via ${best.isp}, NEXT_HOP ${best.attrs.nextHop}.` : undefined,
    };
  }
  if (currentStepId === "bestpath-r2" && router === "R2") {
    return { deviceId: router, stages: UPDATE_STAGES, activeStageId: "best-path-eval", completedStageIds: ["ingress", "parse-update", "validate-attrs", "policy", "candidate-path"], forwardingAction: "R2 runs the identical comparison over its own two candidates." };
  }
  if (currentStepId === "install-r2" && router === "R2") {
    const best = state.bgpTables.R2.find((p) => p.best);
    return {
      deviceId: router,
      stages: UPDATE_STAGES,
      activeStageId: "rib",
      completedStageIds: ["ingress", "parse-update", "validate-attrs", "policy", "candidate-path", "best-path-eval", "bgp-table"],
      lookupType: "RIB Install",
      lookupKey: DEST_PREFIX,
      lookupResult: best ? `via ${best.isp}, NEXT_HOP ${best.attrs.nextHop}${best.nextHopReachable ? "" : " (not reachable)"}` : undefined,
      nextHopId: best?.advertisedBy,
      nextHopLabel: best?.advertisedBy,
      reason: best ? `LOCAL_PREF ${best.attrs.localPref}, AS_PATH length ${best.attrs.asPath.length} won the comparison.` : undefined,
      forwardingAction: best ? `Installed: ${DEST_PREFIX} via ${best.isp}, NEXT_HOP ${best.attrs.nextHop}${best.nextHopReachable ? "" : " — NOT reachable"}.` : undefined,
    };
  }
  if (currentStepId === "trouble-fix" && (router === "R1" || router === "R2")) {
    const path = state.bgpTables[router].find((p) => p.isp === "ISP-A" && p.attrs.peerType === (router === "R1" ? "eBGP" : "iBGP"));
    return { deviceId: router, stages: UPDATE_STAGES, activeStageId: "policy", completedStageIds: ["ingress", "parse-update", "validate-attrs"], forwardingAction: router === "R2" && path ? `next-hop-self applied — NEXT_HOP rewritten to ${IFACE_IP.R1?.R2 ?? "R1"}.` : "next-hop-self applied on the iBGP session." };
  }
  if (currentStepId === "prepend-apply" && (router === "R1" || router === "R2")) {
    return { deviceId: router, stages: UPDATE_STAGES, activeStageId: "best-path-eval", completedStageIds: ["ingress", "parse-update", "validate-attrs", "policy", "candidate-path"], forwardingAction: "ISP-B's AS_PATH lengthened — best path re-evaluated (attribute changed, decision unchanged)." };
  }
  if (currentStepId === "localpref-change" && (router === "R1" || router === "R2")) {
    const best = state.bgpTables[router].find((p) => p.best);
    return {
      deviceId: router,
      stages: UPDATE_STAGES,
      activeStageId: "rib",
      completedStageIds: ["ingress", "parse-update", "validate-attrs", "policy", "candidate-path", "best-path-eval", "bgp-table"],
      lookupType: "RIB Install",
      lookupKey: DEST_PREFIX,
      lookupResult: best ? `via ${best.isp}, LOCAL_PREF ${best.attrs.localPref}` : undefined,
      nextHopId: best?.advertisedBy,
      nextHopLabel: best?.advertisedBy,
      reason: "LOCAL_PREF is compared before AS_PATH length — the changed value now wins.",
      forwardingAction: best ? `New best path installed: via ${best.isp} (LOCAL_PREF ${best.attrs.localPref}).` : undefined,
    };
  }
  if ((currentStepId === "challenge-intro" || currentStepId === "challenge") && (router === "R1" || router === "R2")) {
    const best = state.bgpTables[router].find((p) => p.best);
    return { deviceId: router, stages: UPDATE_STAGES, activeStageId: "best-path-eval", completedStageIds: ["ingress", "parse-update", "validate-attrs", "policy", "candidate-path"], forwardingAction: best ? `Currently best: via ${best.isp} (LOCAL_PREF ${best.attrs.localPref}).` : undefined };
  }

  // --- packet-driven steps: sender gets the short SEND trace, receiver gets the message-specific trace ---
  if (activePacket && (router === activePacket.from || router === activePacket.to)) {
    const kind = packetKind(activePacket);
    if (router === activePacket.from) {
      const sendStages = kind === "tcp" ? TCP_SEND_STAGES : kind === "open" ? OPEN_SEND_STAGES : kind === "keepalive" ? KEEPALIVE_SEND_STAGES : UPDATE_SEND_STAGES;
      const to = activePacket.to as RouterId;
      return {
        deviceId: router,
        stages: sendStages,
        activeStageId: "egress",
        completedStageIds: [sendStages[0].id],
        egressInterfaceId: ifaceId(router, to),
        nextHopId: to,
        nextHopLabel: to,
      };
    }
    // receiver
    const from = activePacket.from as RouterId;
    switch (kind) {
      case "tcp": {
        const t = TCP_STEP_TRANSITIONS[currentStepId];
        return {
          deviceId: router,
          stages: TCP_RECEIVE_STAGES,
          activeStageId: "session-state",
          completedStageIds: ["ingress", "tcp-179"],
          ingressInterfaceId: ifaceId(router, from),
          lookupType: "TCP State",
          lookupResult: t ? `${t.before} → ${t.after}` : undefined,
          reason: "TCP three-way handshake step toward port 179.",
          packetBefore: t ? `TCP: ${t.before}` : undefined,
          packetAfter: t ? `TCP: ${t.after}` : undefined,
        };
      }
      case "open": {
        const t = BGP_STEP_TRANSITIONS[currentStepId];
        return {
          deviceId: router,
          stages: OPEN_RECEIVE_STAGES,
          activeStageId: "fsm-transition",
          completedStageIds: ["ingress", "bgp-open", "peer-validation", "capability-negotiation"],
          ingressInterfaceId: ifaceId(router, from),
          lookupType: "BGP OPEN",
          lookupKey: `Peer AS ${ROUTER_AS[from]}`,
          lookupResult: t ? `FSM ${BGP_STATE_LABEL[t.before]} → ${BGP_STATE_LABEL[t.after]}` : undefined,
          reason: "Peer AS and BGP Identifier validated; capabilities negotiated.",
          packetBefore: t ? `BGP: ${BGP_STATE_LABEL[t.before]}` : undefined,
          packetAfter: t ? `BGP: ${BGP_STATE_LABEL[t.after]}` : undefined,
        };
      }
      case "keepalive": {
        const t = BGP_STEP_TRANSITIONS[currentStepId];
        return {
          deviceId: router,
          stages: KEEPALIVE_RECEIVE_STAGES,
          activeStageId: "fsm-transition",
          completedStageIds: ["ingress", "bgp-keepalive", "liveness-confirmed"],
          ingressInterfaceId: ifaceId(router, from),
          lookupType: "BGP KEEPALIVE",
          lookupResult: t ? `FSM ${BGP_STATE_LABEL[t.before]} → ${BGP_STATE_LABEL[t.after]}` : undefined,
          reason: "Valid KEEPALIVE confirms peer liveness — session reaches ESTABLISHED.",
          packetBefore: t ? `BGP: ${BGP_STATE_LABEL[t.before]}` : undefined,
          packetAfter: t ? `BGP: ${BGP_STATE_LABEL[t.after]}` : undefined,
          forwardingAction: "Session ESTABLISHED on both sides.",
        };
      }
      case "update": {
        const before = (state.bgpTables[router] ?? []).length;
        return {
          deviceId: router,
          stages: UPDATE_STAGES,
          activeStageId: "candidate-path",
          completedStageIds: ["ingress", "parse-update", "validate-attrs", "policy"],
          ingressInterfaceId: ifaceId(router, from),
          lookupType: "UPDATE Parse",
          lookupKey: DEST_PREFIX,
          lookupResult: `${before} → ${before + 1} candidate path(s)`,
          reason: "New candidate path added to the BGP table; best-path evaluation happens in a later step.",
          packetBefore: `${before} candidate path(s) before`,
          packetAfter: `${before + 1} candidate path(s) after`,
        };
      }
      default:
        return idleTrace(router);
    }
  }

  return idleTrace(router);
}

// ---------------------------------------------------------------------------
// Packet visual (brief §6/§10) — TCP and BGP are rendered as distinct
// layer stacks so "TCP/179 must be visually separate from BGP" is
// true in the packet's own stack, not just in the pipeline: a BGP
// message shows BGP on top of TCP on top of IP; a bare TCP handshake
// packet shows only TCP on top of IP — it never gains a BGP frame.
// ---------------------------------------------------------------------------

export function packetFramesFor(packet: PacketVisual | undefined): PacketStackFrame[] | undefined {
  if (!packet) return undefined;
  if (packet.protocol === "TCP") {
    return [
      { id: "tcp", text: `TCP ${packet.badge ?? ""}`.trim(), tone: "transport", justChanged: true },
      { id: "ip", text: "IP", tone: "ip" },
    ];
  }
  return [
    { id: "bgp", text: `BGP ${packet.badge ?? ""}`.trim(), tone: "generic", justChanged: true },
    { id: "tcp", text: "TCP :179", tone: "transport" },
    { id: "ip", text: "IP", tone: "ip" },
  ];
}

// ---------------------------------------------------------------------------
// Physical interfaces (brief §4/§26) — generic naming; Session Type/
// Local AS/Peer AS/TCP state/BGP state/prefix counters are BGP-
// specific fields carried in the generic `extra` bag, not new named
// fields on DeviceInterfaceData.
// ---------------------------------------------------------------------------

const PORT_NAMES: Record<RouterId, RouterId[]> = {
  R1: ["R3", "R2"],
  R2: ["R4", "R1"],
  R3: ["R1"],
  R4: ["R2"],
};

function portName(index: number) {
  return `ge-0/0/${index}`;
}

/** How many prefixes `router` has received FROM `neighbor` — read straight off the already-tagged `advertisedBy` field, never recomputed. */
function prefixesReceivedFrom(state: BgpState, router: RouterId, neighbor: RouterId): number {
  return (state.bgpTables[router] ?? []).filter((p) => p.advertisedBy === neighbor).length;
}
/** How many prefixes `router` has advertised TO `neighbor` — symmetric to the above: count what shows up in the NEIGHBOR's table tagged as advertised-by `router`. */
function prefixesAdvertisedTo(state: BgpState, router: RouterId, neighbor: RouterId): number {
  return (state.bgpTables[neighbor] ?? []).filter((p) => p.advertisedBy === router).length;
}

export function interfacesFor(router: RouterId, state: BgpState, currentStepId: string, activePacket: PacketVisual | undefined): DeviceInterfaceData[] {
  const neighbors = PORT_NAMES[router];
  const i = stepIndex(currentStepId);
  return neighbors.map((neighbor, idx) => {
    const sid = sessionIdFor(router, neighbor);
    const sess = sid ? state.sessions[sid] : undefined;
    const sessionType = sid ? SESSIONS[sid].type : "eBGP";
    const role = activePacket && ((activePacket.to === router && activePacket.from === neighbor) || (activePacket.from === router && activePacket.to === neighbor)) ? (activePacket.to === router ? "ingress" : "egress") : "idle";
    const packetCount = bgpSteps.slice(0, i + 1).filter((s) => {
      const p = s.packet?.(state);
      return p && ((p.from === router && p.to === neighbor) || (p.from === neighbor && p.to === router));
    }).length;
    return {
      id: `${router}-${neighbor}`,
      name: portName(idx),
      status: "up",
      ip: IFACE_IP[router]?.[neighbor],
      neighborId: neighbor,
      neighborLabel: `${neighbor} (AS${ROUTER_AS[neighbor]})`,
      linkType: sessionType === "eBGP" ? "External" : "Internal",
      mtu: 1500,
      protocols: ["BGP"],
      packetCount,
      role,
      extra: [
        { label: "BGP Enabled", value: "Yes" },
        { label: "Session Type", value: sessionType },
        { label: "Local AS", value: String(ROUTER_AS[router]) },
        { label: "Peer AS", value: String(ROUTER_AS[neighbor]) },
        { label: "TCP State", value: sess?.tcp ?? "CLOSED" },
        { label: "BGP State", value: BGP_STATE_LABEL[sess?.bgp ?? "IDLE"] },
        { label: "Prefixes Received", value: String(prefixesReceivedFrom(state, router, neighbor)) },
        { label: "Prefixes Advertised", value: String(prefixesAdvertisedTo(state, router, neighbor)) },
      ],
    };
  });
}

// ---------------------------------------------------------------------------
// Link detail (brief §26) — Physical/TCP/BGP grouped into one flat
// badge list (same convention OSPF's LinkDetail uses), kept generic
// (`protocols: {label,value}[]`) so the same LinkDetailPanel serves
// every lesson.
// ---------------------------------------------------------------------------

export function linkDetailFor(linkId: string, state: BgpState, activePacket: PacketVisual | undefined): LinkDetail | undefined {
  const [a, b] = linkId.split("-") as [RouterId, RouterId];
  if (!PORT_NAMES[a] || !PORT_NAMES[b]) return undefined;
  const aIfaces = interfacesFor(a, state, "", undefined);
  const bIfaces = interfacesFor(b, state, "", undefined);
  const aIface = aIfaces.find((f) => f.neighborId === b);
  const bIface = bIfaces.find((f) => f.neighborId === a);
  if (!aIface || !bIface) return undefined;
  const sid = sessionIdFor(a, b);
  const sess = sid ? state.sessions[sid] : undefined;
  const sessionType = sid ? SESSIONS[sid].type : "eBGP";
  const traffic = activePacket && ((activePacket.from === a && activePacket.to === b) || (activePacket.from === b && activePacket.to === a)) ? activePacket.summary : undefined;
  return {
    aLabel: a,
    bLabel: b,
    aInterface: aIface,
    bInterface: bIface,
    status: "up",
    mtu: 1500,
    protocols: [
      { label: "Link Type", value: sessionType === "eBGP" ? "External (eBGP)" : "Internal (iBGP)" },
      { label: "TCP Port", value: "179" },
      { label: "TCP State", value: sess?.tcp ?? "CLOSED" },
      { label: `${a} AS`, value: String(ROUTER_AS[a]) },
      { label: `${b} AS`, value: String(ROUTER_AS[b]) },
      { label: "BGP FSM", value: BGP_STATE_LABEL[sess?.bgp ?? "IDLE"] },
      { label: "Prefixes Received", value: String(prefixesReceivedFrom(state, a, b) + prefixesReceivedFrom(state, b, a)) },
    ],
    currentTraffic: traffic,
  };
}

// ---------------------------------------------------------------------------
// Node explanation (brief §3/§28) — tense-aware, derived from the
// current step id and session/BGP-table state, never hardcoded
// per-step text unrelated to what actually happened.
// ---------------------------------------------------------------------------

const ROLE_LABEL = "BGP ROUTER";

export function explainRouter(state: BgpState, router: RouterId, currentStepId: string, activePacket: PacketVisual | undefined): NodeExplanation {
  const i = stepIndex(currentStepId);
  const neighbors = PORT_NAMES[router];
  const peerRows = neighbors.map((n) => {
    const sid = sessionIdFor(router, n);
    const sess = sid ? state.sessions[sid] : undefined;
    return { label: `${n} (AS${ROUTER_AS[n]})`, value: `${BGP_STATE_LABEL[sess?.bgp ?? "IDLE"]} · TCP ${sess?.tcp ?? "CLOSED"}` };
  });
  const paths = state.bgpTables[router] ?? [];
  const best = paths.find((p) => p.best);
  const kind = activePacket ? packetKind(activePacket) : undefined;

  let currentAction: string;
  if (i < 0) currentAction = "Idle.";
  else if (i < stepIndex("tcp-syn")) currentAction = `${router} has no BGP session yet.`;
  else if (kind === "tcp" && activePacket) {
    currentAction = router === activePacket.from ? `${router} is establishing TCP/179 toward ${activePacket.to}.` : `${router} is completing the TCP handshake from ${activePacket.from} — not a BGP message yet.`;
  } else if (currentStepId === "bgp-connect") {
    currentAction = `${router}'s BGP FSM moves IDLE → CONNECT now that TCP is up.`;
  } else if (kind === "open" && activePacket) {
    currentAction = router === activePacket.from ? `${router} has sent a BGP OPEN and is waiting for peer negotiation.` : `${router} received a BGP OPEN from ${activePacket.from} and is validating AS number and BGP Identifier.`;
  } else if (kind === "keepalive") {
    currentAction = `${router}'s BGP session is now ESTABLISHED — UPDATE messages can flow.`;
  } else if (currentStepId === "secondary-sessions") {
    currentAction = `${router}'s other BGP session(s) reach ESTABLISHED the same way.`;
  } else if (kind === "update" && activePacket) {
    currentAction = router === activePacket.to ? `${router} has received ${DEST_PREFIX} from ${activePacket.from}.` : `${router} is advertising ${DEST_PREFIX} toward ${activePacket.to}.`;
  } else if (currentStepId === "ibgp-share") {
    currentAction = `${router} is sharing its externally-learned path with its iBGP peer.`;
  } else if ((currentStepId === "bestpath-r1" && router === "R1") || (currentStepId === "bestpath-r2" && router === "R2")) {
    currentAction = `${router} is comparing candidate paths.`;
  } else if ((currentStepId === "install-r1" && router === "R1") || (currentStepId === "install-r2" && router === "R2")) {
    currentAction = best ? `${router} installs ${DEST_PREFIX} via ${best.isp}${best.nextHopReachable ? "" : " — but NEXT_HOP is not yet reachable"}.` : `${router} installs its best path.`;
  } else if (currentStepId === "trouble-fix" && router === "R2") {
    currentAction = `${router} applies next-hop-self — NEXT_HOP is rewritten to point at a directly-connected router.`;
  } else if (currentStepId === "prepend-apply") {
    currentAction = `${router}'s candidate paths' attributes changed (AS_PATH prepended) — best path re-evaluated.`;
  } else if (currentStepId === "localpref-change" && best) {
    currentAction = `${router} now prefers ${best.isp} because Local Preference ${best.attrs.localPref} outranks the competing path's shorter AS_PATH.`;
  } else if (currentStepId === "challenge" || currentStepId === "challenge-intro") {
    currentAction = best ? `${router} is currently comparing paths — best: ${best.isp} (LOCAL_PREF ${best.attrs.localPref}).` : `${router} is comparing candidate paths.`;
  } else {
    currentAction = best ? `Idle — best path via ${best.isp}, ${paths.length} candidate path(s) known.` : `Idle — ${paths.length} candidate path(s) known.`;
  }

  return {
    id: router,
    name: router,
    deviceType: "BGP Router",
    role: ROLE_LABEL,
    currentAction,
    controlPlaneRole: "Runs BGP: forms TCP/179 sessions, negotiates OPEN/KEEPALIVE, exchanges UPDATE, compares path attributes, installs a best path.",
    dataPlaneRole: "Forwards normal IP traffic using the route BGP installed — BGP messages themselves never carry user traffic.",
    tables: [
      {
        title: `${router} — Info`,
        rows: [
          { label: "Router ID", value: ROUTER_IDS[router] },
          { label: "Local AS", value: String(ROUTER_AS[router]) },
          { label: "BGP Neighbors", value: String(neighbors.length) },
          { label: "Prefixes Received", value: String(paths.length) },
          { label: "Best Path", value: best ? `${best.isp} (${best.installed ? "installed" : "not installed"})` : "none" },
        ],
      },
      { title: `${router} — BGP Neighbors`, rows: peerRows },
    ],
  };
}

// ---------------------------------------------------------------------------
// Attribute X-Ray (brief §11) — static, purpose/scope explanations for
// the five attributes the learner can click on an UPDATE. Nothing
// here decides a value; `affectsDecision` is a fixed statement about
// THIS lesson's simplified comparison order, not a general BGP rule.
// ---------------------------------------------------------------------------

export interface AttributeInfo {
  purpose: string;
  standard: string;
  scope: string;
  affectsDecision: string;
}

export const ATTRIBUTE_INFO: Record<string, AttributeInfo> = {
  AS_PATH: {
    purpose: "Lists every AS the route has transited, origin AS last. It's BGP's primary loop-prevention mechanism — a router discards any UPDATE whose own AS number already appears in the path.",
    standard: "Standard, well-known mandatory BGP attribute.",
    scope: "Carried in every UPDATE; grows by one AS on each eBGP hop, unchanged across an iBGP hop.",
    affectsDecision: "Yes — this lesson's 2nd comparison, right after LOCAL_PREF. Shorter AS_PATH wins when LOCAL_PREF ties.",
  },
  NEXT_HOP: {
    purpose: "The IP address traffic for this prefix should be sent to. eBGP normally sets NEXT_HOP to the advertising router's own address; iBGP does NOT rewrite it by default — the router relaying the route has to opt in with next-hop-self.",
    standard: "Standard, well-known mandatory BGP attribute.",
    scope: "Carried in every UPDATE. Must resolve to something directly reachable, or the route is installed-but-unusable (this lesson's NEXT_HOP fault).",
    affectsDecision: "No, not in this lesson's best-path comparison — but it decides whether an installed route is actually USABLE afterward.",
  },
  LOCAL_PREF: {
    purpose: "An AS-internal signal for which outbound path the whole AS should prefer. Higher is preferred.",
    standard: "Standard, well-known discretionary BGP attribute.",
    scope: "Exchanged only over iBGP inside one AS — never sent to an eBGP peer, so it can't be used to influence a neighboring AS's own choice.",
    affectsDecision: "Yes — this lesson's 1st and highest-priority comparison. It overrides AS_PATH length whenever it differs.",
  },
  MED: {
    purpose: "A hint an AS gives a NEIGHBORING AS about which of several entry points to prefer, for return traffic toward the advertiser. Lower is preferred.",
    standard: "Standard, well-known discretionary BGP attribute.",
    scope: "Meaningful only when comparing paths learned from the SAME neighboring AS — comparing MED across different neighbor ASes is not a valid comparison.",
    affectsDecision: "Only when the earlier criteria (LOCAL_PREF, AS_PATH length) tie AND both candidates share the same neighboring AS — that's why this lesson's two paths (different neighbor ASes) always skip it.",
  },
  ORIGIN: {
    purpose: "How the originating AS says it learned this prefix in the first place: IGP (originated via network statement), EGP (legacy), or Incomplete (redistributed from another protocol).",
    standard: "Standard, well-known mandatory BGP attribute.",
    scope: "Carried in every UPDATE, unchanged in transit.",
    affectsDecision: "Not in this lesson — both candidate paths carry the same ORIGIN (IGP), so it never becomes a deciding factor here.",
  },
};

// ---------------------------------------------------------------------------
// Diagnostic layers (brief §21) — the same generic RECEIVED → VALID →
// BEST → NEXT_HOP → USABLE ladder brief §13/§20 draws, computed
// straight from the already-tagged BgpPath fields, never re-decided.
// ---------------------------------------------------------------------------

export interface DiagnosticLayer {
  label: string;
  ok: boolean;
  detail?: string;
}

const PRIMARY_SESSION: Record<RouterId, SessionId> = { R1: "R1-R3", R2: "R2-R4", R3: "R1-R3", R4: "R2-R4" };

export function diagnosticLayersFor(state: BgpState, router: RouterId): DiagnosticLayer[] {
  const sess = state.sessions[PRIMARY_SESSION[router]];
  const paths = state.bgpTables[router] ?? [];
  const best = paths.find((p) => p.best);
  return [
    { label: "Interface", ok: true },
    { label: "TCP/179", ok: sess.tcp === "ESTABLISHED" },
    { label: "BGP Session", ok: sess.bgp === "ESTABLISHED" },
    { label: "UPDATE Received", ok: paths.length > 0 },
    { label: "Best Path", ok: !!best },
    { label: "NEXT_HOP", ok: !!best?.nextHopReachable, detail: best?.attrs.nextHop },
    { label: "RIB / Usable", ok: !!best?.installed && !!best?.nextHopReachable },
  ];
}

// ---------------------------------------------------------------------------
// AS region info (brief §2, optional) — purely descriptive, derived
// from the same ROUTER_AS/SESSIONS data everything else here reads.
// ---------------------------------------------------------------------------

export interface AsRegionInfo {
  asn: number;
  internalRouters: RouterId[];
  externalPeers: { from: RouterId; to: RouterId }[];
  advertisedPrefixes: string[];
}

const AS_REGION_ROUTERS: Record<string, RouterId[]> = {
  "as-65001": ["R1", "R2"],
  "as-65010": ["R3"],
  "as-65020": ["R4"],
};

export function regionInfoFor(regionId: string, state: BgpState): AsRegionInfo | undefined {
  const routers = AS_REGION_ROUTERS[regionId];
  if (!routers) return undefined;
  const asn = ROUTER_AS[routers[0]];
  const externalPeers: { from: RouterId; to: RouterId }[] = [];
  for (const [, sess] of Object.entries(SESSIONS)) {
    if (sess.type !== "eBGP") continue;
    if (routers.includes(sess.a) && !routers.includes(sess.b)) externalPeers.push({ from: sess.a, to: sess.b });
    else if (routers.includes(sess.b) && !routers.includes(sess.a)) externalPeers.push({ from: sess.b, to: sess.a });
  }
  const advertisedPrefixes = regionId === "as-65030-equivalent" ? [] : asn === DEST_AS ? [DEST_PREFIX] : routers.some((r) => (state.bgpTables[r] ?? []).some((p) => p.installed)) ? [`${DEST_PREFIX} (transit — learned via BGP, not originated here)`] : [];
  return { asn, internalRouters: routers, externalPeers, advertisedPrefixes };
}

// ---------------------------------------------------------------------------
// Data-plane demonstration (brief §24/§25) — kept entirely separate
// from `traceFor` above (BGP control-plane only). The hop chain is
// derived purely from the already-decided `.best`/`.installed`/
// `.advertisedBy` fields — it never re-runs best-path itself, it just
// follows the installed decision hop by hop until it reaches an
// eBGP-facing router, then on to the destination AS.
// ---------------------------------------------------------------------------

/** Follows the installed best path from `fromRouter` to the destination, hop by hop — R1 → (R2 if iBGP-relayed) → R3 or R4 → "DEST". Returns undefined if no installed, usable path exists yet. */
export function dataPlaneHopChain(state: BgpState, fromRouter: RouterId): string[] | undefined {
  const chain: string[] = [fromRouter];
  let current: RouterId = fromRouter;
  const visited = new Set<RouterId>([fromRouter]);
  for (let guard = 0; guard < 4; guard++) {
    const best = (state.bgpTables[current] ?? []).find((p) => p.best && p.installed && p.nextHopReachable);
    if (!best) return undefined;
    const next = best.advertisedBy;
    if (visited.has(next)) return undefined;
    chain.push(next);
    visited.add(next);
    if (next === "R3" || next === "R4") {
      chain.push("DEST");
      return chain;
    }
    current = next;
  }
  return undefined;
}

const DATA_FORWARD_STAGES: ProcessingStage[] = [
  { id: "ip-arrives", label: "IP Packet Arrives" },
  { id: "dest-lookup", label: "Destination Lookup" },
  { id: "routing-table", label: "Routing Table" },
  { id: "bgp-route", label: "BGP-Installed Route" },
  { id: "next-hop", label: "Next Hop" },
  { id: "egress", label: "Egress Interface" },
];

/** The conceptual forwarding pipeline for a normal IP packet currently departing `fromRouter` toward `toRouter` over the route BGP installed (brief §25: "BGP is not forwarding this packet"). */
export function dataForwardTrace(fromRouter: RouterId, toRouter: string): DeviceProcessingTrace {
  return {
    deviceId: fromRouter,
    stages: DATA_FORWARD_STAGES,
    activeStageId: "egress",
    completedStageIds: ["ip-arrives", "dest-lookup", "routing-table", "bgp-route", "next-hop"],
    forwardingAction: `Next hop: ${toRouter} — via the route BGP's best-path process already installed. BGP is not forwarding this packet; it only installed the routing information normal IP forwarding is now using.`,
  };
}
