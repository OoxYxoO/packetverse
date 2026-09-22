import type { DeviceInterfaceData, DeviceProcessingTrace, LinkDetail, PacketMutation, PacketStackFrame, ProcessingStage } from "@/components/network3d/types";
import type { PacketVisual } from "@/lib/sim-engine/types";
import {
  CE_MAC,
  CE_ROUTERS,
  LINKS,
  MTU_NODES,
  PE_ROUTERS,
  resolveAttachmentCircuits,
  spokePairFor,
  peSpokePair,
  spokeUp,
  pwUpBetween,
  type CeId,
  type HvplsState,
  type JourneyAction,
  type JourneyHop,
  type LinkDef,
  type RouterId,
  type PeId,
  type MtuId,
} from "@/lib/sim-engine/scenarios/hVpls";

/**
 * Scene Adapter for H-VPLS's device-interior 3D view. Every stage list
 * and interface/link value below is derived FROM HvplsState — no
 * bridging, port-role, or split-horizon decision is made in this file.
 */

const CE_PIPELINE: ProcessingStage[] = [
  { id: "ac", label: "Attachment Circuit" },
  { id: "deliver", label: "Deliver / Receive" },
];
/** Shared by both MTU-s and PE-rs — the same conceptual bridge pipeline runs at both tiers, just over different port roles. */
const BRIDGE_PIPELINE: ProcessingStage[] = [
  { id: "ingress", label: "Ingress (AC / Spoke / Mesh)" },
  { id: "learn", label: "Learn Source MAC" },
  { id: "lookup", label: "Destination Lookup" },
  { id: "decide", label: "Forwarding Decision (Hierarchical Split Horizon)" },
  { id: "encap", label: "Label Push / Pop" },
  { id: "deliver", label: "Deliver / Forward" },
];
const BRIDGE_STAGE_ORDER = BRIDGE_PIPELINE.map((s) => s.id);

function stageForAction(action: JourneyAction): string {
  switch (action) {
    case "AC_INGRESS":
    case "SPOKE_INGRESS":
    case "MESH_INGRESS":
      return "ingress";
    case "LEARN_SOURCE":
      return "learn";
    case "LOOKUP_DEST":
      return "lookup";
    case "LOCAL_SWITCH":
    case "REPLICATE":
    case "MESH_SPLIT_HORIZON_BLOCK":
      return "decide";
    case "PUSH_SPOKE":
    case "PUSH_MESH":
    case "POP_TRANSPORT":
      return "encap";
    default:
      return "deliver";
  }
}
const allIds = (s: ProcessingStage[]) => s.map((x) => x.id);

function neighborLinks(router: RouterId): { neighbor: RouterId; link: LinkDef }[] {
  return LINKS.filter((l) => l.a === router || l.b === router).map((l) => ({ neighbor: l.a === router ? l.b : l.a, link: l }));
}
function ifaceId(router: RouterId, neighbor: RouterId): string {
  return `${router}-${neighbor}`;
}

// ---------------------------------------------------------------------------
// Hop enrichment (additive DeviceProcessingTrace fields feeding
// HopInspectorPanel/PacketDiffViewer) — every value below is derived from
// the JourneyHop the scenario's own step `run()` already wrote, never a
// second, competing decision made here.
// ---------------------------------------------------------------------------

const LOOKUP_TYPE_BY_ACTION: Partial<Record<JourneyAction, string>> = {
  AC_INGRESS: "Attachment Circuit — Source MAC Learning",
  SPOKE_INGRESS: "Spoke PW Label Resolution — Source Learning + Hierarchical Lookup",
  MESH_INGRESS: "Mesh PW Label Resolution — Source Learning + Hierarchical Lookup",
  LEARN_SOURCE: "Source MAC Learning",
  LOOKUP_DEST: "FDB Destination Lookup",
  LOCAL_SWITCH: "FDB Destination Lookup — Local Delivery",
  REPLICATE: "Egress Set Computation — Flood (BUM)",
  PUSH_SPOKE: "Spoke PW Receive Label + Hierarchical Egress Selection",
  PUSH_MESH: "Mesh PW Receive Label + Hierarchical Egress Selection",
  POP_TRANSPORT: "Transport Label — PHP / Implicit-Null",
  MESH_SPLIT_HORIZON_BLOCK: "Egress Set + Hierarchical Split-Horizon Filter",
  AC_EGRESS: "Attachment Circuit Delivery",
  SPOKE_EGRESS: "Spoke PW Delivery",
  MESH_EGRESS: "Mesh PW Delivery",
  AC_UNAVAILABLE: "Attachment Circuit — Unavailable",
};

/**
 * Only PUSH_SPOKE/PUSH_MESH map to an unambiguous packet mutation from the
 * hop's own action name. Every other H-VPLS action (SPOKE_INGRESS,
 * MESH_SPLIT_HORIZON_BLOCK, ...) bundles a transport-label pop together with
 * learn/lookup/flood-decision in one step — reporting a precise PUSH/POP for
 * those would overstate precision this action taxonomy doesn't actually
 * carry, so they report no mutation rather than a guessed one (anti-fake-data
 * rule: `packetBefore`/`packetAfter` plain text already tells the real story
 * for those hops).
 */
function mutationsForAction(hop: JourneyHop): PacketMutation[] {
  switch (hop.action) {
    case "PUSH_SPOKE":
    case "PUSH_MESH":
      return [{ type: "PUSH", detail: hop.output }];
    case "POP_TRANSPORT":
      return [{ type: "POP", detail: hop.input }];
    default:
      return [];
  }
}

/** Reverse lookup from a CE's real MAC to its id — used only as the
 * fallback below, never to fabricate a forwarding decision. */
const MAC_TO_CE: Record<string, CeId> = Object.fromEntries(CE_ROUTERS.map((ce) => [CE_MAC[ce], ce])) as Record<string, CeId>;

/**
 * The CE that actually originated the frame currently on the wire, read
 * straight off `state.packet.frame.srcMac` (never rewritten mid-journey —
 * `deliverEthernetFrame` only strips labels). Used ONLY as the ingress
 * fallback for a journey's very first hop, where no earlier journey entry
 * exists to walk backward from — which in this topology is always the
 * AC-ingress hop at the MTU-s the sending CE is physically attached to.
 * Unlike a fixed per-router AC map (fine for mpls-vpls's PE1↔CE1), MTU1
 * alone has two attached CEs (CE1 and CE2), so a single hardcoded peer
 * would be wrong for half of MTU1's traffic — this reads the real source
 * instead of guessing.
 */
function sourceCeFromPacket(state: HvplsState): CeId | undefined {
  const mac = state.packet?.frame.srcMac;
  return mac ? MAC_TO_CE[mac] : undefined;
}

/**
 * Previous different-device journey entry — the router this hop's frame
 * actually arrived FROM. Walks backward past same-device entries so the
 * ingress interface reflects the true prior hop, never a device's own
 * fixed neighbor-array slot (ARCHITECTURE.md §17's "Known correctness fix"
 * — MTU1 alone has three ports (two ACs + one spoke) and every PE-rs has
 * three (one spoke + two mesh), so a fixed nbrs[0]/nbrs[1] pick is actively
 * wrong here, not just imprecise).
 */
function prevRouterFor(hop: JourneyHop, state: HvplsState): RouterId | undefined {
  // `hop.ingressPeer` — set by the scenario's own `run()` from the real
  // `ingress` port it already computed — is authoritative. Deliberately NOT
  // backed by an array-adjacency walk: H-VPLS's journey is NOT strictly
  // linear like mpls-vpls's (a single flood fans out to two ports appended
  // one-after-another into the SAME array), so "the previous array entry"
  // can belong to an entirely different flood branch than the one that
  // actually reached this hop's device — an adjacency guess would silently
  // pick the wrong branch rather than showing nothing. See JourneyHop's own
  // doc comment. The one hop missing `ingressPeer` (the informal spoke-
  // failure recap) falls back to the packet's real source CE.
  return hop.ingressPeer ?? sourceCeFromPacket(state);
}
/**
 * Next hop peer — `hop.egressPeer` only (set exclusively for a genuinely
 * single-egress decision; deliberately absent for a multi-branch flood,
 * where no single "next hop" claim would be honest — the full egress set
 * is already in `output`/`lookup` text). Falls back to `state.packetAt`
 * only for the trailing edge of the whole journey (where the packet
 * genuinely IS right now), never to array-adjacency, for the same reason
 * `prevRouterFor` never does.
 */
function nextRouterFor(hop: JourneyHop, state: HvplsState): RouterId | undefined {
  if (hop.egressPeer) return hop.egressPeer;
  const idx = state.journey.indexOf(hop);
  const isLast = idx === state.journey.length - 1;
  if (isLast && state.packetAt && state.packetAt !== hop.device) return state.packetAt;
  return undefined;
}
function ingressIfaceFor(router: RouterId, hop: JourneyHop | undefined, state: HvplsState): string | undefined {
  if (!hop) return undefined;
  const prev = prevRouterFor(hop, state);
  return prev ? ifaceId(router, prev) : undefined;
}
function egressIfaceFor(router: RouterId, hop: JourneyHop | undefined, state: HvplsState): string | undefined {
  if (!hop) return undefined;
  const next = nextRouterFor(hop, state);
  return next ? ifaceId(router, next) : undefined;
}

/**
 * Which router is the primary inspection subject of a no-packet
 * control-plane/lab step (a flood/lookup decision recorded only via
 * `run()` with no `.packet`, the fault/repair sequence, the standalone
 * spoke-failure experiment) — these never touch `state.packet`, so
 * `deviceForStep` needs a fixed subject the way mpls-vpls's own map does.
 * Every packet-carrying step instead resolves from the packet's own
 * `from`/`to` (sender priority — `state.journey` records each hop against
 * the router that PERFORMED the action).
 *
 * `mtu2-mtu3-discard` and `pe3-mtu3-discard-path` are included even though
 * those steps push no new journey hop for their primary subject (they only
 * update FDBs) — clicking that timeline entry still points the learner at
 * a real device whose FDB just changed, honestly showing "no forwarding
 * activity recorded yet" in the Hop Inspector rather than fabricating one.
 */
export const PRIMARY_TRANSITION_ROUTER: Partial<Record<string, RouterId>> = {
  "transport-lsp-up": "PE1",
  "mtu1-flood-decision": "MTU1",
  "pe3-receives-direct-from-pe1": "PE3",
  "mtu2-mtu3-discard": "MTU2",
  "mtu1-flood-remote": "MTU1",
  "pe3-mtu3-discard-path": "PE3",
  "ce4-replies-known": "MTU3",
  "troubleshooting-intro": "PE1",
  "fault-injection": "PE1",
  "diagnostic-ladder": "PE1",
  "repair-challenge": "PE1",
  "repaired-recompute": "PE1",
  "local-survival-demo": "MTU1",
  "fail-mtu1-spoke": "MTU1",
  "restore-spoke": "MTU1",
  "engineer-challenge-confirm": "PE1",
};

export function deviceForStep(stepId: string, packet: PacketVisual | undefined): RouterId | undefined {
  if (packet) return (packet.from ?? packet.to) as RouterId;
  return PRIMARY_TRANSITION_ROUTER[stepId];
}

export function traceFor(router: RouterId, state: HvplsState): DeviceProcessingTrace | undefined {
  const nbrs = neighborLinks(router);
  const hops = state.journey.filter((h) => h.device === router);
  const hop = hops[hops.length - 1];
  const isCurrent = state.journey.length > 0 && state.journey[state.journey.length - 1] === hop;

  if (router.startsWith("CE")) {
    // A CE has exactly one physical neighbor — its own MTU-s — so this is a
    // structural fact, not a positional guess, unlike the multi-neighbor
    // MTU-s/PE-rs case below.
    const onlyIface = nbrs[0] ? ifaceId(router, nbrs[0].neighbor) : undefined;
    const base: DeviceProcessingTrace = { deviceId: router, ingressInterfaceId: onlyIface, egressInterfaceId: onlyIface, stages: CE_PIPELINE, completedStageIds: [] };
    if (!hop) return base;
    const enrichment = {
      lookupType: LOOKUP_TYPE_BY_ACTION[hop.action],
      lookupKey: hop.input,
      lookupResult: `${hop.action} → ${hop.output}`,
      reason: hop.lookup,
      mutations: mutationsForAction(hop),
    };
    if (isCurrent) return { ...base, activeStageId: hop.action === "AC_EGRESS" ? "deliver" : "ac", completedStageIds: hop.action === "AC_EGRESS" ? ["ac"] : [], packetBefore: hop.input, packetAfter: hop.output, ...enrichment };
    return { ...base, completedStageIds: allIds(CE_PIPELINE), packetBefore: hop.input, packetAfter: hop.output, ...enrichment };
  }

  // MTU-s and PE-rs both run the same bridge pipeline shape.
  const ingressIfaceId = ingressIfaceFor(router, hop, state);
  const egressIfaceId = egressIfaceFor(router, hop, state);
  const base: DeviceProcessingTrace = { deviceId: router, ingressInterfaceId: ingressIfaceId, egressInterfaceId: egressIfaceId, stages: BRIDGE_PIPELINE, completedStageIds: [] };
  if (!hop) return base;
  const activeStageId = stageForAction(hop.action);
  const activeIdx = BRIDGE_STAGE_ORDER.indexOf(activeStageId);
  const completed = BRIDGE_STAGE_ORDER.slice(0, isCurrent ? activeIdx : activeIdx + 1);
  const nextRouter = nextRouterFor(hop, state);
  const enrichment = {
    lookupType: LOOKUP_TYPE_BY_ACTION[hop.action],
    lookupKey: hop.input,
    lookupResult: `${hop.action} → ${hop.output}`,
    reason: hop.lookup,
    nextHopId: nextRouter,
    nextHopLabel: nextRouter,
    mutations: mutationsForAction(hop),
  };
  if (isCurrent) return { ...base, activeStageId, completedStageIds: completed, packetBefore: hop.input, packetAfter: hop.output, ...enrichment };
  return { ...base, completedStageIds: allIds(BRIDGE_PIPELINE), packetBefore: hop.input, packetAfter: hop.output, ...enrichment };
}

export function packetFramesFor(state: HvplsState): PacketStackFrame[] | undefined {
  if (!state.packet) return undefined;
  const labelFrames: PacketStackFrame[] = state.packet.labels.map((l, idx) => ({
    id: `label-${idx}`,
    text: `${l.purpose === "transport" ? "Transport" : "PW"} ${l.value}`,
    tone: l.purpose === "transport" ? "transport" : "vpn",
    justChanged: idx === 0,
  }));
  return [...labelFrames, { id: "eth", text: "Ethernet", tone: "generic" }];
}

export function interfacesFor(router: RouterId, state: HvplsState): DeviceInterfaceData[] {
  const acs = router.startsWith("MTU") ? resolveAttachmentCircuits(state.acs, router as MtuId) : [];
  return neighborLinks(router).map(({ neighbor, link }) => {
    const ac = acs.find((a) => a.ceRouter === neighbor);
    const extra =
      link.tier === "mesh"
        ? [{ label: "Role", value: "MESH_PW" }]
        : link.tier === "spoke"
          ? [{ label: "Role", value: router.startsWith("PE") ? state.spokeRoleByPe[router as PeId] : "SPOKE_PW" }]
          : ac
            ? [{ label: "VLAN", value: String(ac.vlan) }, { label: "AC Status", value: ac.up ? "up" : "down" }]
            : undefined;
    return {
      id: `${router}-${neighbor}`,
      name: `to-${neighbor}`,
      status: "up" as const,
      neighborId: neighbor,
      neighborLabel: neighbor,
      linkType: link.tier === "mesh" ? "Core (Mesh PW)" : link.tier === "spoke" ? "Access (Spoke PW)" : "Access",
      mtu: 1500,
      protocols: link.tier === "access" ? ["Ethernet"] : ["MPLS"],
      role: "idle" as const,
      extra,
    };
  });
}

export function linkDetailFor(linkId: string, state: HvplsState): LinkDetail | undefined {
  const link = LINKS.find((l) => l.id === linkId);
  if (!link) return undefined;
  const linkUp =
    link.tier === "mesh"
      ? pwUpBetween(state.meshLinks, link.a as PeId, link.b as PeId)
      : link.tier === "spoke"
        ? spokeUp(state.spokeLinks, (link.a.startsWith("MTU") ? link.a : link.b) as MtuId)
        : true;
  return {
    aLabel: link.a,
    bLabel: link.b,
    aInterface: { id: `${link.a}-${link.b}`, name: `to-${link.b}`, status: linkUp ? "up" : "down", neighborId: link.b, neighborLabel: link.b, linkType: link.tier, mtu: 1500, protocols: link.tier === "access" ? ["Ethernet"] : ["MPLS"], role: "idle" },
    bInterface: { id: `${link.b}-${link.a}`, name: `to-${link.a}`, status: linkUp ? "up" : "down", neighborId: link.a, neighborLabel: link.a, linkType: link.tier, mtu: 1500, protocols: link.tier === "access" ? ["Ethernet"] : ["MPLS"], role: "idle" },
    status: linkUp ? "up" : "down",
    mtu: 1500,
    protocols: [{ label: "Tier", value: link.tier === "mesh" ? "Core Mesh PW" : link.tier === "spoke" ? "Spoke PW" : "Attachment Circuit" }],
  };
}

export const DEVICE_ROUTERS: RouterId[] = ["CE1", "CE2", "MTU1", "PE1", "CE3", "MTU2", "PE2", "PE3", "MTU3", "CE4"];
export { MTU_NODES, PE_ROUTERS, spokePairFor, peSpokePair };
