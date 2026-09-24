import type { DeviceInterfaceData, DeviceProcessingTrace, LinkDetail, PacketMutation, PacketStackFrame, ProcessingStage } from "@/components/network3d/types";
import type { EvpnRibRow } from "@/components/protocol/EvpnRouteTable";
import type { PacketVisual } from "@/lib/sim-engine/types";
import {
  ESI,
  GRAPH_EDGES,
  LOCAL_AC_VLAN,
  REMOTE_AC_VLAN,
  TRANSPORT_LABEL,
  VPWS_SERVICE_ID,
  discoverVpwsEndpoint,
  remoteServiceLabelFor,
  evpnVpwsSteps,
  pbRoleFor,
  type EvpnVpwsDeviceId,
  type EvpnVpwsState,
  type JourneyAction,
  type JourneyHop,
  type PeId,
} from "@/lib/sim-engine/scenarios/evpnVpws";

const stepIndex = (id: string) => evpnVpwsSteps.findIndex((s) => s.id === id);

/**
 * Level-3 enrichment (brief §2/§28/§31/§32) — every field below is
 * re-described FROM the scenario's own JourneyHop, never a new domain
 * decision. See docs/ARCHITECTURE.md §18 "enrich an existing adapter".
 */
function ethernetFrames(): PacketStackFrame[] {
  return [{ id: "ethernet", text: "Ethernet (Customer Frame)", tone: "generic" }];
}
/** `serviceLabel` is always a real value from the scenario — the pushed downstream label or the disposition PE's own advertised label. */
function mplsFrames(serviceLabel: number, justChanged = false): PacketStackFrame[] {
  return [
    { id: "transport", text: `MPLS Shim (transport) — Label ${TRANSPORT_LABEL}`, tone: "transport" },
    { id: "service", text: `MPLS Shim (service) — Label ${serviceLabel}`, tone: "vpn", justChanged },
    { id: "ethernet", text: "Ethernet (Customer Frame)", tone: "generic" },
  ];
}
const ACTION_LOOKUP_TYPE: Record<JourneyAction, string> = {
  AC_INGRESS: "Access Circuit → VPWS Service",
  SERVICE_LOOKUP: "Service Lookup (Not MAC Lookup)",
  PUSH_LABELS: "Push Service + Transport Labels",
  TRANSPORT_FORWARD: "Top Transport Label (Swap)",
  POP_TRANSPORT: "Pop Transport Label",
  POP_SERVICE: "Pop Service Label → Identify AC",
  AC_EGRESS: "Access Circuit Egress",
  AC_UNAVAILABLE: "Access Circuit State",
};
const ACTION_REASON: Record<JourneyAction, string> = {
  AC_INGRESS: "The customer frame enters on CE-A's attachment circuit and is mapped straight to VPWS-500 — no MAC learning is involved.",
  SERVICE_LOOKUP: "VPWS-500 has exactly one remote service endpoint, so no destination-MAC lookup is needed to select among multiple remote sites — the provider decision is service/AC based.",
  PUSH_LABELS: "A two-label stack is pushed: the VPWS service label identifies the service/AC at the far end, the transport label carries the packet across the core.",
  TRANSPORT_FORWARD: "The core performs ordinary transport label swap forwarding — it never inspects the VPWS service label or customer MACs, and never selects a VPWS AC.",
  POP_TRANSPORT: "Transport label removed — the service label beneath it is now exposed for the disposition PE to read.",
  POP_SERVICE: "The service label identifies VPWS-500 and its CE-B attachment circuit — the customer frame is forwarded there unchanged.",
  AC_EGRESS: "The customer frame leaves on the identified attachment circuit exactly as it arrived — VPWS never modifies customer MACs.",
  AC_UNAVAILABLE: "This PE's attachment circuit to its customer edge is down — the PE device itself, its underlay, and BGP EVPN session all remain healthy.",
};

function findLastHop(journey: JourneyHop[], device: EvpnVpwsDeviceId, action: JourneyAction): JourneyHop | undefined {
  for (let idx = journey.length - 1; idx >= 0; idx--) {
    if (journey[idx].device === device && journey[idx].action === action) return journey[idx];
  }
  return undefined;
}

function ifacePairForHop(device: "PE1" | "PE2" | "PE3", action: JourneyAction): { ingressInterfaceId?: string; egressInterfaceId?: string } {
  const ce = device === "PE3" ? `${device}-ceb` : `${device}-cea`;
  const core = `${device}-core`;
  if (action === "SERVICE_LOOKUP" || action === "PUSH_LABELS") return { ingressInterfaceId: ce, egressInterfaceId: core };
  if (action === "POP_SERVICE" || action === "AC_EGRESS") return { ingressInterfaceId: core, egressInterfaceId: ce };
  return { ingressInterfaceId: core, egressInterfaceId: undefined };
}

function hopToTrace(device: "PE1" | "PE2" | "PE3", hop: JourneyHop, stages: ProcessingStage[], activeStageId: string, state: EvpnVpwsState): DeviceProcessingTrace {
  const isPush = hop.action === "PUSH_LABELS";
  const isPop = hop.action === "POP_SERVICE";
  // PUSH presents the downstream label the scenario actually pushed; POP presents the
  // disposition PE's own advertised label — the one remote PEs push toward it.
  const serviceLabel = isPush ? state.packet?.labels.find((l) => l.purpose === "service")?.value : isPop ? state.perEviAdRoutes[device]?.serviceLabel : undefined;
  const labeledFrames = serviceLabel === undefined ? undefined : mplsFrames(serviceLabel, isPush);
  const mutations: PacketMutation[] | undefined = isPush
    ? [...(serviceLabel === undefined ? [] : [{ type: "PUSH" as const, detail: `Service label ${serviceLabel}` }]), { type: "PUSH", detail: `Transport label ${TRANSPORT_LABEL}` }]
    : isPop
      ? [{ type: "POP", detail: serviceLabel === undefined ? "Transport + service labels removed — customer frame forwarded to the AC" : `Transport + service label ${serviceLabel} removed — customer frame forwarded to the AC` }]
      : undefined;
  const nextHopId = hop.action === "PUSH_LABELS" ? "CORE" : hop.action === "SERVICE_LOOKUP" && device !== "PE3" ? "PE3" : isPop ? "CE-B" : undefined;
  return {
    deviceId: device,
    ...ifacePairForHop(device, hop.action),
    stages,
    activeStageId,
    completedStageIds: stages.map((s) => s.id),
    packetBefore: hop.input,
    packetAfter: hop.output,
    packetBeforeFrames: isPush ? ethernetFrames() : isPop ? labeledFrames : undefined,
    packetAfterFrames: isPush ? labeledFrames : isPop ? ethernetFrames() : undefined,
    lookupType: ACTION_LOOKUP_TYPE[hop.action],
    lookupKey: hop.lookup,
    lookupResult: hop.output,
    nextHopId,
    nextHopLabel: nextHopId,
    reason: ACTION_REASON[hop.action],
    mutations,
  };
}

const CONTROL_PIPELINE_STAGES: ProcessingStage[] = [
  { id: "es-configured", label: "Ethernet Segment Configured" },
  { id: "election", label: "Single-Active Election" },
  { id: "adevi-advertised", label: "A-D Per-EVI Advertised" },
  { id: "remote-discovered", label: "Remote Endpoint Discovered" },
  { id: "service-installed", label: "VPWS Service Installed" },
];
/** PE3's own control plane — it advertises and learns VPWS-500, with no Ethernet Segment or Single-Active role. */
const PE3_CONTROL_STAGES: ProcessingStage[] = [
  { id: "adevi-advertised", label: "A-D Per-EVI Advertised" },
  { id: "remote-discovered", label: "Remote Endpoint Discovered" },
  { id: "service-installed", label: "VPWS Service Installed" },
];
const PE1_PE2_FORWARD_STAGES: ProcessingStage[] = [
  { id: "ac-ingress", label: "Access Circuit Ingress" },
  { id: "service-lookup", label: "Service Lookup (VPWS-500)" },
  { id: "remote-endpoint", label: "Remote Endpoint = PE3" },
  { id: "push-labels", label: "Push Service + Transport Labels" },
  { id: "egress", label: "Egress Toward Core" },
];
const PE3_EGRESS_STAGES: ProcessingStage[] = [
  { id: "mpls-ingress", label: "MPLS Ingress" },
  { id: "transport-processing", label: "Transport Processing" },
  { id: "service-label", label: "VPWS Service Label" },
  { id: "identify-service", label: "Identify VPWS-500" },
  { id: "identify-ac", label: "Identify CE-B AC" },
  { id: "vlan-translation", label: "Optional VLAN/Tag Translation" },
  { id: "forward-ce", label: "Forward Customer Ethernet Frame" },
];
const CORE_STAGES: ProcessingStage[] = [
  { id: "underlay-ingress", label: "MPLS Ingress" },
  { id: "top-label", label: "Top Transport Label" },
  { id: "transport-forward", label: "Transport Forward (Swap)" },
];

function allIds(stages: ProcessingStage[]) {
  return stages.map((s) => s.id);
}

/** Exact (step, device) → (action, stage table, activeStageId) map — avoids matching a stale hop from an earlier step for the same device. */
const SIGNATURE_MOMENT: Record<string, { device: "PE1" | "PE2" | "PE3"; action: JourneyAction; stages: ProcessingStage[]; activeStageId: string }[]> = {
  "pe1-service-lookup": [{ device: "PE1", action: "SERVICE_LOOKUP", stages: PE1_PE2_FORWARD_STAGES, activeStageId: "service-lookup" }],
  "mpls-data-plane": [{ device: "PE1", action: "PUSH_LABELS", stages: PE1_PE2_FORWARD_STAGES, activeStageId: "push-labels" }],
  "pe3-disposition": [{ device: "PE3", action: "POP_SERVICE", stages: PE3_EGRESS_STAGES, activeStageId: "forward-ce" }],
  "return-direction": [
    { device: "PE3", action: "SERVICE_LOOKUP", stages: PE1_PE2_FORWARD_STAGES, activeStageId: "service-lookup" },
    { device: "PE1", action: "POP_SERVICE", stages: PE3_EGRESS_STAGES, activeStageId: "forward-ce" },
  ],
  "data-path-failover": [
    { device: "PE3", action: "SERVICE_LOOKUP", stages: PE1_PE2_FORWARD_STAGES, activeStageId: "service-lookup" },
    { device: "PE2", action: "POP_SERVICE", stages: PE3_EGRESS_STAGES, activeStageId: "forward-ce" },
  ],
  // restore-pe1-ac re-elects PE1 before the MTU fault, so verify-repair's ingress is always PE1.
  "verify-repair": [
    { device: "PE1", action: "SERVICE_LOOKUP", stages: PE1_PE2_FORWARD_STAGES, activeStageId: "service-lookup" },
    { device: "PE3", action: "POP_SERVICE", stages: PE3_EGRESS_STAGES, activeStageId: "forward-ce" },
  ],
  "challenge-resend": [
    { device: "PE2", action: "SERVICE_LOOKUP", stages: PE1_PE2_FORWARD_STAGES, activeStageId: "service-lookup" },
    { device: "PE3", action: "POP_SERVICE", stages: PE3_EGRESS_STAGES, activeStageId: "forward-ce" },
  ],
};

export function traceFor(device: "PE1" | "CORE" | "PE2" | "PE3", state: EvpnVpwsState, currentStepId: string): DeviceProcessingTrace {
  const i = stepIndex(currentStepId);

  if (device === "CORE") {
    const base: DeviceProcessingTrace = { deviceId: "CORE", stages: CORE_STAGES, completedStageIds: [] };
    // Active only while the labeled packet is in the core, or at CORE's own teaching step (whose run
    // then hands the packet to PE3) — a packet merely existing elsewhere is not CORE processing it.
    if (state.packetAt !== "CORE" && currentStepId !== "core-transport-only") return base;
    return { ...base, activeStageId: "transport-forward", completedStageIds: ["underlay-ingress", "top-label"], lookupType: "Top Transport Label (Swap)", lookupKey: `Label ${TRANSPORT_LABEL}`, reason: "Ordinary transport forwarding — never inspects the VPWS service label or customer MACs, and never selects a VPWS AC." };
  }

  // Exact signature moments for PE1/PE2/PE3 — real JourneyHop data, never a stale earlier hop.
  const moments = SIGNATURE_MOMENT[currentStepId];
  const moment = moments?.find((m) => m.device === device);
  if (moment) {
    const hop = findLastHop(state.journey, device, moment.action);
    if (hop) return hopToTrace(device, hop, moment.stages, moment.activeStageId, state);
  }

  // Everything before the first customer frame is control plane — Act 2 opens with A-D signaling, not forwarding.
  const controlEnd = stepIndex("cea-sends-frame");
  const routes = state.perEviAdRoutes;
  const serviceUp = state.vpwsService?.status === "up";
  if (device === "PE1" || device === "PE2") {
    if (i < controlEnd) {
      const base: DeviceProcessingTrace = { deviceId: device, stages: CONTROL_PIPELINE_STAGES, completedStageIds: [] };
      const electionIndex = stepIndex("single-active-election");
      if (i < electionIndex) return { ...base, activeStageId: "es-configured", completedStageIds: [] };
      if (currentStepId === "single-active-election") return { ...base, activeStageId: "election", completedStageIds: ["es-configured"] };
      if (currentStepId === (device === "PE1" ? "pe1-advertises-adevi" : "pe2-advertises-adevi")) return { ...base, activeStageId: "adevi-advertised", completedStageIds: ["es-configured", "election"] };
      // Not this device's moment — show only the progress the scenario state actually records.
      const own = routes[device];
      const done = ["es-configured"];
      if (state.election.primaryPe) done.push("election");
      if (own && !own.withdrawn) done.push("adevi-advertised");
      if (discoverVpwsEndpoint(routes, device)) done.push("remote-discovered");
      if (serviceUp) done.push("service-installed");
      return { ...base, completedStageIds: done };
    }
    if (device === "PE1" && state.pe1AcFailed) {
      return { deviceId: device, stages: PE1_PE2_FORWARD_STAGES, completedStageIds: [], lookupType: ACTION_LOOKUP_TYPE.AC_UNAVAILABLE, reason: ACTION_REASON.AC_UNAVAILABLE };
    }
    const base: DeviceProcessingTrace = { deviceId: device, stages: PE1_PE2_FORWARD_STAGES, completedStageIds: [] };
    // The customer frame has just entered this PE on its AC (last hop is the CE's AC_INGRESS) — state-backed, no hop invented.
    const lastHop = state.journey[state.journey.length - 1];
    if (state.packetAt === device && lastHop?.action === "AC_INGRESS") {
      return { ...base, activeStageId: "ac-ingress", lookupType: ACTION_LOOKUP_TYPE.AC_INGRESS, reason: ACTION_REASON.AC_INGRESS };
    }
    const forwarded = state.journey.some((h) => h.device === device && (h.action === "PUSH_LABELS" || h.action === "SERVICE_LOOKUP" || h.action === "POP_SERVICE"));
    if (!forwarded) return base;
    return { ...base, completedStageIds: allIds(PE1_PE2_FORWARD_STAGES) };
  }

  // PE3 — the remote VPWS endpoint: never a CE-A Ethernet Segment member, never in that Single-Active election.
  if (i < controlEnd) {
    const base: DeviceProcessingTrace = { deviceId: "PE3", stages: PE3_CONTROL_STAGES, completedStageIds: [] };
    const own = routes.PE3;
    const remote = discoverVpwsEndpoint(routes, "PE3");
    if (currentStepId === "pe3-advertises-adevi") return { ...base, activeStageId: "adevi-advertised", completedStageIds: [...(remote ? ["remote-discovered"] : []), ...(serviceUp ? ["service-installed"] : [])] };
    if (currentStepId === "vpws-route-discovery") {
      return serviceUp
        ? { ...base, activeStageId: "service-installed", completedStageIds: ["adevi-advertised", "remote-discovered"] }
        : { ...base, activeStageId: "remote-discovered", completedStageIds: own ? ["adevi-advertised"] : [] };
    }
    const done: string[] = [];
    if (own && !own.withdrawn) done.push("adevi-advertised");
    if (remote) done.push("remote-discovered");
    if (serviceUp) done.push("service-installed");
    return { ...base, completedStageIds: done };
  }
  const base: DeviceProcessingTrace = { deviceId: "PE3", stages: PE3_EGRESS_STAGES, completedStageIds: [] };
  const delivered = state.journey.some((h) => h.device === "PE3" && h.action === "POP_SERVICE");
  // An installed A-D route is control state, not packet processing — egress activates only once the packet is at PE3.
  if (!delivered) return state.packetAt === "PE3" ? { ...base, activeStageId: "mpls-ingress" } : base;
  return { ...base, completedStageIds: allIds(PE3_EGRESS_STAGES) };
}

/**
 * The packet stack the device is handling at this step, read from its own trace rather than the
 * persistent `state.packet` (which keeps the first PE1 → PE3 stack through later directions).
 * No active processing stage → no packet stack.
 */
export function packetFramesFor(trace: DeviceProcessingTrace | undefined, state: EvpnVpwsState): PacketStackFrame[] | undefined {
  switch (trace?.activeStageId) {
    case "ac-ingress":
    case "service-lookup":
      return ethernetFrames(); // customer frame before encapsulation
    case "push-labels":
      return trace.packetAfterFrames; // the stack this PE just built
    case "forward-ce":
      return trace.packetBeforeFrames; // incoming stack carrying the disposition PE's own label
    case "transport-forward":
    case "mpls-ingress": {
      // Only reached while the labeled packet is in the core or arriving at PE3 — `state.packet` is that packet.
      const serviceLabel = state.packet?.labels.find((l) => l.purpose === "service")?.value;
      return serviceLabel === undefined ? undefined : mplsFrames(serviceLabel);
    }
    default:
      return undefined;
  }
}

/** The layer(s) the device actually acts on at its active stage — the X-Ray focus. */
export function xrayFocusTonesFor(trace: DeviceProcessingTrace | undefined): PacketStackFrame["tone"][] | undefined {
  switch (trace?.activeStageId) {
    case "ac-ingress":
    case "service-lookup":
      return ["generic"];
    case "push-labels":
      return ["transport", "vpn"];
    case "transport-forward":
    case "mpls-ingress":
      return ["transport"];
    case "forward-ce":
      return ["vpn"];
    default:
      return undefined;
  }
}

const TONE_LAYER: Record<PacketStackFrame["tone"], RegExp> = { transport: /\(transport\)/, vpn: /\(service\)/, generic: /^Ethernet/, ip: /^IP/ };
/** Maps focus tones onto a PacketVisual's layers; undefined when none of them is present — never a substitute layer. */
export function layerIndicesForTones(tones: PacketStackFrame["tone"][] | undefined, packet: PacketVisual | undefined): number[] | undefined {
  if (!tones || !packet) return undefined;
  const indices = packet.layers.flatMap((l, idx) => (tones.some((t) => TONE_LAYER[t].test(l.name)) ? [idx] : []));
  return indices.length > 0 ? indices : undefined;
}

interface IfaceDef { id: string; name: string; ip?: string; neighborId: EvpnVpwsDeviceId; neighborLabel: string; linkType: string; mtu: number; protocols: string[]; extra?: { label: string; value: string }[]; }

const INTERFACES: Record<"PE1" | "CORE" | "PE2" | "PE3", IfaceDef[]> = {
  PE1: [
    { id: "PE1-cea", name: "ge-0/0/0", neighborId: "CE-A", neighborLabel: "CE-A", linkType: `Access (VPWS-${VPWS_SERVICE_ID}, VLAN ${LOCAL_AC_VLAN})`, mtu: 9000, protocols: ["Ethernet"], extra: [{ label: "ESI", value: ESI }] },
    { id: "PE1-core", name: "et-0/1/0", ip: "10.0.21.1/31", neighborId: "CORE", neighborLabel: "CORE", linkType: "MPLS Core (Uplink)", mtu: 9216, protocols: ["IGP", "LDP/RSVP", "BGP EVPN"] },
  ],
  CORE: [
    { id: "CORE-pe1", name: "et-0/0/0", ip: "10.0.21.0/31", neighborId: "PE1", neighborLabel: "PE1", linkType: "MPLS Core", mtu: 9216, protocols: ["IGP"] },
    { id: "CORE-pe2", name: "et-0/0/1", ip: "10.0.22.0/31", neighborId: "PE2", neighborLabel: "PE2", linkType: "MPLS Core", mtu: 9216, protocols: ["IGP"] },
    { id: "CORE-pe3", name: "et-0/0/2", ip: "10.0.23.0/31", neighborId: "PE3", neighborLabel: "PE3", linkType: "MPLS Core", mtu: 9216, protocols: ["IGP"] },
  ],
  PE2: [
    { id: "PE2-cea", name: "ge-0/0/0", neighborId: "CE-A", neighborLabel: "CE-A", linkType: `Access (VPWS-${VPWS_SERVICE_ID}, VLAN ${LOCAL_AC_VLAN})`, mtu: 9000, protocols: ["Ethernet"], extra: [{ label: "ESI", value: ESI }] },
    { id: "PE2-core", name: "et-0/1/0", ip: "10.0.22.1/31", neighborId: "CORE", neighborLabel: "CORE", linkType: "MPLS Core (Uplink)", mtu: 9216, protocols: ["IGP", "LDP/RSVP", "BGP EVPN"] },
  ],
  PE3: [
    { id: "PE3-core", name: "et-0/1/0", ip: "10.0.23.1/31", neighborId: "CORE", neighborLabel: "CORE", linkType: "MPLS Core (Uplink)", mtu: 9216, protocols: ["IGP", "LDP/RSVP", "BGP EVPN"] },
    { id: "PE3-ceb", name: "ge-0/0/0", neighborId: "CE-B", neighborLabel: "CE-B", linkType: `Access (VPWS-${VPWS_SERVICE_ID}, VLAN ${REMOTE_AC_VLAN})`, mtu: 1500, protocols: ["Ethernet"] },
  ],
};

export function interfacesFor(device: "PE1" | "CORE" | "PE2" | "PE3", state: EvpnVpwsState, currentStepId: string): DeviceInterfaceData[] {
  const trace = traceFor(device, state, currentStepId);
  const processing = trace.activeStageId !== undefined;
  return INTERFACES[device]
    .filter((def) => !(def.neighborId === "CE-A" && device === "PE1" && state.pe1AcFailed))
    .map((def) => ({
      id: def.id,
      name: def.name,
      status: def.neighborId === "CE-A" && device === "PE1" && state.pe1AcFailed ? "down" : "up",
      ip: def.ip,
      neighborId: def.neighborId,
      neighborLabel: def.neighborLabel,
      linkType: def.linkType,
      mtu: def.mtu,
      protocols: def.protocols,
      packetCount: trace.completedStageIds.length > 0 || processing ? 1 : 0,
      role: processing && def.id === trace.ingressInterfaceId ? "ingress" : processing && def.id === trace.egressInterfaceId ? "egress" : processing ? "ingress" : "idle",
      extra: def.extra,
    }));
}

export function esTabRowsFor(state: EvpnVpwsState, pe: PeId) {
  if (pe === "PE3") return [{ label: "Ethernet Segment", value: "Not attached — PE3 is not part of this ES" }];
  const role = pbRoleFor(state.election, pe);
  const roleLabel = { "not-elected": "Not elected", primary: "Primary", backup: "Backup", ineligible: "Ineligible" }[role];
  return [
    { label: "ESI", value: ESI },
    { label: "Redundancy Mode", value: "SINGLE-ACTIVE" },
    { label: "Primary", value: state.election.primaryPe ?? "(not yet elected)" },
    { label: "Backup", value: state.election.backupPe ?? "(none)" },
    { label: "Local Role", value: roleLabel },
    { label: "Service", value: `VPWS-${VPWS_SERVICE_ID}` },
  ];
}

export function pbTabRowsFor(state: EvpnVpwsState, pe: PeId) {
  if (pe === "PE3") return [{ label: "Primary / Backup", value: "Not applicable — PE3 is the single remote endpoint, not part of the Single-Active ES" }];
  const route = state.perEviAdRoutes[pe];
  const role = pbRoleFor(state.election, pe);
  return [
    { label: "Role", value: { "not-elected": "Not elected", primary: "PRIMARY", backup: "BACKUP", ineligible: "Ineligible" }[role] },
    { label: "P Flag (Advanced)", value: role === "primary" ? "1" : "0" },
    { label: "B Flag (Advanced)", value: role === "backup" ? "1" : "0" },
    { label: "L2 MTU (Advanced)", value: route ? String(route.l2Mtu) : "(not advertised)" },
    { label: "Control-Word Indicator (Advanced)", value: "Not modeled in this lesson" },
  ];
}

/** The downstream label this PE pushes toward its current remote endpoint (from the scenario's pure resolver). */
function remoteLabelText(state: EvpnVpwsState, device: PeId): string {
  const remote = discoverVpwsEndpoint(state.perEviAdRoutes, device);
  const label = remoteServiceLabelFor(state.perEviAdRoutes, device);
  return remote && label !== undefined ? `${label} (advertised by ${remote})` : "(no usable remote endpoint)";
}

export function labelsTabRowsFor(state: EvpnVpwsState, device: "PE1" | "PE2" | "PE3") {
  const route = state.perEviAdRoutes[device as PeId];
  return [
    { label: "VPWS Service Label (local)", value: route ? String(route.serviceLabel) : "(not advertised)" },
    { label: "Remote Service Label (pushed)", value: remoteLabelText(state, device) },
    { label: "Transport Label", value: state.packet ? String(state.packet.labels.find((l) => l.purpose === "transport")?.value ?? "—") : "(no active packet)" },
    { label: "Note", value: "Service label ≠ MPLS L3VPN VPN label — different mechanisms, kept visually distinct" },
  ];
}

export function vpwsServicesTabRowsFor(state: EvpnVpwsState, device: EvpnVpwsDeviceId) {
  const svc = state.vpwsService;
  return [
    { label: "Service", value: `VPWS-${VPWS_SERVICE_ID}` },
    { label: "Local AC", value: `VLAN ${LOCAL_AC_VLAN} (CE-A side)` },
    { label: "Remote AC / Endpoint", value: `VLAN ${REMOTE_AC_VLAN} (CE-B side)` },
    { label: "Local Service ID", value: String(VPWS_SERVICE_ID) },
    { label: "Remote Service ID", value: String(VPWS_SERVICE_ID) },
    { label: "Redundancy Mode", value: "Single-Active" },
    { label: "Primary", value: state.election.primaryPe ?? "(not yet elected)" },
    { label: "Backup", value: state.election.backupPe ?? "(none)" },
    { label: "Remote PE", value: device === "PE3" ? (discoverVpwsEndpoint(state.perEviAdRoutes, "PE3") ?? "(none usable)") : discoverVpwsEndpoint(state.perEviAdRoutes, device as PeId) ?? "(none)" },
    { label: "Local Service Label (advertised)", value: state.perEviAdRoutes[device as PeId] ? String(state.perEviAdRoutes[device as PeId]!.serviceLabel) : "(not advertised)" },
    ...(device === "PE1" || device === "PE2" || device === "PE3" ? [{ label: "Remote Service Label (pushed)", value: remoteLabelText(state, device) }] : []),
    { label: "L2 MTU", value: svc ? String(svc.pe3ExpectedMtu) : "9000" },
    { label: "Status", value: svc ? svc.status.toUpperCase() : "DOWN" },
  ];
}

export function remoteEndpointsTabRowsFor(state: EvpnVpwsState) {
  return (["PE1", "PE2"] as PeId[]).map((pe) => {
    const route = state.perEviAdRoutes[pe];
    const role = pbRoleFor(state.election, pe);
    return { label: pe, value: !route || route.withdrawn ? "Withdrawn / unavailable" : `${role.toUpperCase()} — service label ${route.serviceLabel}` };
  });
}

export function evpnRibRowsFor(state: EvpnVpwsState, device: EvpnVpwsDeviceId): EvpnRibRow[] {
  const rows: EvpnRibRow[] = [];
  const pushRoute = (pe: PeId) => {
    const r = state.perEviAdRoutes[pe];
    if (!r) return;
    const role = r.role === "remote" ? "Remote Endpoint" : { "not-elected": "Not elected", primary: "Primary", backup: "Backup", ineligible: "Ineligible" }[r.role as Exclude<typeof r.role, "remote">];
    rows.push({
      routeType: "1",
      subKind: "PER EVI",
      summary: `${pe} — ESI ${r.esi ? r.esi.slice(-8) : "0"}${r.withdrawn ? " (WITHDRAWN)" : ""}`,
      nextHop: pe,
      rd: r.rd,
      rt: r.rt,
      extra: [
        { label: "VPWS Service", value: `ID ${r.vpwsServiceId}` },
        { label: "Service Label", value: String(r.serviceLabel) },
        { label: "P/B Role", value: role },
        { label: "L2 MTU", value: String(r.l2Mtu) },
      ],
    });
  };
  if (device === "PE3") {
    pushRoute("PE1");
    pushRoute("PE2");
  } else if (device === "PE1" || device === "PE2") {
    pushRoute("PE3");
  }
  return rows;
}

export function linkDetailFor(linkId: string, state: EvpnVpwsState): LinkDetail | undefined {
  const edge = GRAPH_EDGES.find((e) => e.id === linkId);
  if (!edge) return undefined;
  const a = edge.a as EvpnVpwsDeviceId;
  const b = edge.b as EvpnVpwsDeviceId;
  const allIfaces: Record<string, IfaceDef[]> = {
    "CE-A": [
      { id: "cea-pe1", name: "eth0", neighborId: "PE1", neighborLabel: "PE1", linkType: `Access (ESI, VLAN ${LOCAL_AC_VLAN})`, mtu: 9000, protocols: ["Ethernet"], extra: [{ label: "ESI", value: ESI }, { label: "Role", value: pbRoleFor(state.election, "PE1").toUpperCase() }] },
      { id: "cea-pe2", name: "eth1", neighborId: "PE2", neighborLabel: "PE2", linkType: `Access (ESI, VLAN ${LOCAL_AC_VLAN})`, mtu: 9000, protocols: ["Ethernet"], extra: [{ label: "ESI", value: ESI }, { label: "Role", value: pbRoleFor(state.election, "PE2").toUpperCase() }] },
    ],
    ...INTERFACES,
    "CE-B": [{ id: "ceb-pe3", name: "eth0", neighborId: "PE3", neighborLabel: "PE3", linkType: `Access (VLAN ${REMOTE_AC_VLAN})`, mtu: 1500, protocols: ["Ethernet"] }],
  };
  const aIface = allIfaces[a]?.find((f) => f.neighborId === b);
  const bIface = allIfaces[b]?.find((f) => f.neighborId === a);
  if (!aIface || !bIface) return undefined;
  const isCore = aIface.linkType.startsWith("MPLS Core");
  return {
    aLabel: a,
    bLabel: b,
    aInterface: { id: aIface.id, name: aIface.name, status: "up", ip: aIface.ip, neighborId: b, neighborLabel: b, linkType: aIface.linkType, mtu: aIface.mtu, protocols: aIface.protocols, role: "idle" },
    bInterface: { id: bIface.id, name: bIface.name, status: "up", ip: bIface.ip, neighborId: a, neighborLabel: a, linkType: bIface.linkType, mtu: bIface.mtu, protocols: bIface.protocols, role: "idle" },
    status: "up",
    mtu: aIface.mtu,
    protocols: isCore ? [{ label: "IGP", value: "Converged" }, { label: "BGP EVPN", value: state.bgpSessionUp ? "Established" : "Not yet formed" }] : [{ label: "ESI", value: a === "CE-A" || b === "CE-A" ? ESI : "—" }],
  };
}

export interface CliOutput { cmd: string; output: string; }
export interface CliCommandEntry { id: string; label: string; cisco: CliOutput; juniper: CliOutput; }

export function buildVpwsCliCommands(state: EvpnVpwsState, device: EvpnVpwsDeviceId): CliCommandEntry[] {
  if (device === "CORE") return [{ id: "mpls", label: "mpls forwarding", cisco: { cmd: "show mpls forwarding-table", output: "Label 16003 -> swap -> PE3" }, juniper: { cmd: "show route table mpls.0", output: "16003 Swap 16003 -> PE3" } }];
  if (device === "CE-A" || device === "CE-B") return [{ id: "iface", label: "interface status", cisco: { cmd: "show interfaces status", output: "Gi0/0 up" }, juniper: { cmd: "show interfaces terse", output: "ge-0/0/0 up" } }];
  const pe = device as PeId;
  const svc: CliOutput = { cmd: `show evpn vpws instance ${VPWS_SERVICE_ID}`, output: `VPWS-${VPWS_SERVICE_ID}  Status: ${state.vpwsService?.status.toUpperCase() ?? "DOWN"}` };
  const svcJ: CliOutput = { cmd: `show evpn instance vpws-${VPWS_SERVICE_ID} extensive`, output: `Service ${VPWS_SERVICE_ID}: ${state.vpwsService?.status ?? "down"}` };
  const ad: CliOutput = { cmd: "show bgp l2vpn evpn route-type 1", output: pe === "PE3" ? `Remote: PE1/PE2 A-D per-EVI` : `Local: A-D per-EVI advertised, Role ${pbRoleFor(state.election, pe as PeId)}` };
  const adJ: CliOutput = { cmd: "show route table bgp.evpn.0 match-prefix 1:*", output: "1:*:500 A-D per-EVI" };
  return [
    { id: "vpws", label: "vpws service", cisco: svc, juniper: svcJ },
    { id: "adroutes", label: "a-d per-evi", cisco: ad, juniper: adJ },
  ];
}
