import type { DeviceInterfaceData, DeviceProcessingTrace, LinkDetail, PacketMutation, PacketStackFrame, ProcessingStage } from "@/components/network3d/types";
import { CUST_A_RD, CUST_A_RT, GRAPH_EDGES, l3vpnSteps, type L3VpnState, type RouterId } from "@/lib/sim-engine/scenarios/mplsL3vpn";

/**
 * The "Scene Adapter" (Batch B brief §15-23) for MPLS L3VPN's device-interior
 * 3D view. Every stage list, checkpoint, interface, and link-detail value
 * below is computed FROM L3VpnState (the ScenarioEngine's own output) —
 * this file never makes a VRF/BGP/label decision itself, it only
 * re-describes decisions the engine already made, in the generic
 * DeviceProcessingTrace/DeviceInterfaceData shape the 3D layer
 * understands. Nothing in components/network3d/ imports this file
 * directly — the page wires them together every render.
 *
 * Level 3 enrichment (brief §19/§21) is layered onto the EXISTING
 * per-stepIndex branch structure — every branch already correctly
 * decided its `activeStageId`/`packetBefore`/`packetAfter`; this pass
 * only adds `lookupType`/`lookupKey`/`lookupResult`/`nextHopId`/
 * `nextHopLabel`/`reason`/`packetBeforeFrames`/`packetAfterFrames`,
 * deriving every value from data the branch already had (never a new
 * VRF/RT/label decision). New branches were added ONLY for the MP-BGP
 * control-plane steps (remote-route-learned…vrf-install), which
 * previously fell through to the generic "packet not arrived yet" base
 * with no inspectable detail at all — mirrors BGP Route Reflector's
 * non-packet, currentStepId-keyed branches.
 */

const stepIndex = (id: string) => l3vpnSteps.findIndex((s) => s.id === id);

// ---------------------------------------------------------------------------
// Conceptual Forwarding Pipeline — stage lists per device role (brief §5-8).
// ---------------------------------------------------------------------------

const PE1_STAGES: ProcessingStage[] = [
  { id: "ingress", label: "Ingress Interface" },
  { id: "identify-vrf", label: "Identify VRF" },
  { id: "vrf-lookup", label: "VRF Route Lookup" },
  { id: "bgp-nexthop", label: "Resolve BGP Next-Hop" },
  { id: "vpn-label", label: "Obtain VPN Label" },
  { id: "transport-label", label: "Obtain Transport Label" },
  { id: "build-stack", label: "Build Label Stack" },
  { id: "egress", label: "Egress Interface" },
];
/** PE1's control-plane side (brief §21) — importing the VPNv4 route MP-BGP delivers, distinct from the forwarding pipeline above. */
const PE1_CONTROL_STAGES: ProcessingStage[] = [
  { id: "mpbgp-receive", label: "MP-BGP Receive" },
  { id: "rt-import-check", label: "RT Import Check" },
  { id: "vrf-install", label: "VRF Install" },
];
const P1_STAGES: ProcessingStage[] = [
  { id: "ingress", label: "Ingress" },
  { id: "read-label", label: "Read Top Label" },
  { id: "lfib-lookup", label: "LFIB Lookup" },
  { id: "swap", label: "Label Action: SWAP" },
  { id: "egress", label: "Egress" },
];
const P2_STAGES: ProcessingStage[] = [
  { id: "ingress", label: "Ingress" },
  { id: "read-label", label: "Read Top Label" },
  { id: "lfib-lookup", label: "LFIB Lookup" },
  { id: "pop", label: "Label Action: POP (PHP)" },
  { id: "egress", label: "Egress" },
];
const PE2_STAGES: ProcessingStage[] = [
  { id: "ingress", label: "Ingress" },
  { id: "vpn-lookup", label: "VPN Label Lookup" },
  { id: "vrf-context", label: "Select VRF Context (CUST-A)" },
  { id: "remove-label", label: "Remove VPN Label" },
  { id: "ip-forward", label: "IP Forward to CE" },
  { id: "egress", label: "Egress" },
];
/** PE2's control-plane side (brief §21) — originating and advertising the VPNv4 route. */
const PE2_CONTROL_STAGES: ProcessingStage[] = [
  { id: "vrf-route", label: "VRF Route (Local)" },
  { id: "apply-rd", label: "Apply RD" },
  { id: "attach-rt", label: "Attach Export RT" },
  { id: "alloc-vpn-label", label: "Allocate VPN Label" },
  { id: "mpbgp-advertise", label: "MP-BGP Advertise" },
];

function allIds(stages: ProcessingStage[]) {
  return stages.map((s) => s.id);
}

/** Parses this file's own literal `packetBefore`/`packetAfter` bracket-stack strings (e.g. "[Transport 102][VPN 24002][IP]") into structured `PacketStackFrame[]` — exact, deterministic parsing of text this file already writes, never a new value. Prose strings ("IP packet arrives from CE1") have no bracketed labels and correctly fall back to a bare IP frame. */
function parseStackFrames(text: string | undefined, markTopChanged: boolean): PacketStackFrame[] | undefined {
  if (!text) return undefined;
  const matches = [...text.matchAll(/\[(Transport|VPN) (\d+)\]/g)];
  const frames: PacketStackFrame[] = matches.map((m, i) => ({ id: `label-${i}`, text: `${m[1]} ${m[2]}`, tone: m[1] === "Transport" ? "transport" : "vpn", justChanged: markTopChanged && i === 0 }));
  frames.push({ id: "ip", text: "IP", tone: "ip" });
  return frames;
}

function mutationsFor(action: "PUSH" | "SWAP" | "POP", detail: string | undefined): PacketMutation[] {
  return detail ? [{ type: action, detail }] : [];
}

export function traceFor(router: RouterId, state: L3VpnState, currentStepId: string): DeviceProcessingTrace | undefined {
  const i = stepIndex(currentStepId);

  if (router === "PE1") {
    // --- Control-plane branches (brief §19/§21) — importing the VPNv4 route ---
    if (currentStepId === "mpbgp-advertise") {
      return {
        deviceId: "PE1",
        stages: PE1_CONTROL_STAGES,
        activeStageId: "mpbgp-receive",
        completedStageIds: [],
        lookupType: "MP-BGP VPNv4 Receive",
        lookupKey: state.received.PE1 ? `${state.received.PE1.route.rd}:${state.received.PE1.route.prefix}` : undefined,
        lookupResult: "Received — not yet imported into any VRF",
        reason: "PE1 receives the complete VPNv4 UPDATE from PE2: RD, prefix, RT, next-hop, and VPN label all in one message.",
        forwardingAction: "PE1 receives 10.2.2.0/24 via MP-BGP.",
      };
    }
    if (currentStepId === "predict-rt-import") {
      return { deviceId: "PE1", stages: PE1_CONTROL_STAGES, activeStageId: "mpbgp-receive", completedStageIds: [], lookupType: "MP-BGP VPNv4 Receive", lookupResult: "Received — RT import check pending" };
    }
    if (currentStepId === "rt-import-check") {
      const received = state.received.PE1;
      return {
        deviceId: "PE1",
        stages: PE1_CONTROL_STAGES,
        activeStageId: "rt-import-check",
        completedStageIds: ["mpbgp-receive"],
        lookupType: "RT Import Check",
        lookupKey: `Route RT ${received?.route.rt ?? "—"} vs. CUST-A import RT ${CUST_A_RT}`,
        lookupResult: received?.rtMatched ? "Match" : "No match",
        reason: "RT is the only thing that has to match — RD is expected to differ between PE1 and PE2, and the VRF name isn't compared at all.",
        forwardingAction: "PE1 compares the route's RT against CUST-A's import RT.",
      };
    }
    if (currentStepId === "vrf-install") {
      return {
        deviceId: "PE1",
        stages: PE1_CONTROL_STAGES,
        activeStageId: "vrf-install",
        completedStageIds: ["mpbgp-receive", "rt-import-check"],
        lookupType: "VRF Install",
        lookupKey: "10.2.2.0/24",
        lookupResult: "Imported into VRF CUST-A",
        reason: "RT matched, so the route is installed into VRF CUST-A — never the provider's global table.",
        forwardingAction: "PE1 imports 10.2.2.0/24 into VRF CUST-A.",
      };
    }
    if (currentStepId === "fault-injected") {
      const custA = (state.vrfs.PE1 ?? []).find((v) => v.name === "CUST-A");
      return {
        deviceId: "PE1",
        stages: PE1_CONTROL_STAGES,
        activeStageId: "rt-import-check",
        completedStageIds: ["mpbgp-receive"],
        lookupType: "RT Import Check",
        lookupKey: `Route RT 65001:100 vs. CUST-A import RT ${custA?.importRt ?? "—"}`,
        lookupResult: "No match — route withdrawn from CUST-A",
        reason: "An engineer changed PE1's CUST-A import RT to 65001:999 — it no longer matches PE2's export RT (65001:100).",
        forwardingAction: "PE1's import RT no longer matches — 10.2.2.0/24 is withdrawn from VRF CUST-A.",
      };
    }
    if (currentStepId === "repair-challenge" && state.repairAttempt?.correct) {
      return {
        deviceId: "PE1",
        stages: PE1_CONTROL_STAGES,
        activeStageId: "vrf-install",
        completedStageIds: ["mpbgp-receive", "rt-import-check"],
        lookupType: "RT Import Check",
        lookupKey: `Route RT 65001:100 vs. CUST-A import RT ${CUST_A_RT}`,
        lookupResult: "Match — re-imported into CUST-A",
        reason: "PE1's import RT corrected back to 65001:100 — the route matches again and is reinstalled.",
        forwardingAction: "PE1's import RT corrected to 65001:100 — 10.2.2.0/24 re-imported into VRF CUST-A.",
      };
    }
    if (i >= stepIndex("mpbgp-advertise") && i < stepIndex("send-ce1")) {
      return { deviceId: "PE1", stages: PE1_CONTROL_STAGES, activeStageId: "vrf-install", completedStageIds: allIds(PE1_CONTROL_STAGES), lookupResult: "10.2.2.0/24 present in VRF CUST-A" };
    }

    // --- Forwarding pipeline (existing branch structure, enriched) ---
    const base: DeviceProcessingTrace = { deviceId: "PE1", ingressInterfaceId: "PE1-ce", egressInterfaceId: "PE1-p1", stages: PE1_STAGES, completedStageIds: [] };
    if (i < stepIndex("send-ce1")) return base;
    if (i === stepIndex("send-ce1")) return { ...base, activeStageId: "ingress", packetBefore: "IP packet arrives from CE1", packetBeforeFrames: parseStackFrames("IP packet arrives from CE1", false) };
    if (i <= stepIndex("predict-stack-order")) {
      return {
        ...base,
        activeStageId: "vrf-lookup",
        completedStageIds: ["ingress", "identify-vrf"],
        packetBefore: "IP packet (VRF CUST-A match)",
        packetBeforeFrames: parseStackFrames("IP packet (VRF CUST-A match)", false),
        lookupType: "VRF Route Lookup",
        lookupKey: "10.2.2.20 in VRF CUST-A",
        lookupResult: "10.2.2.0/24 — BGP next-hop 4.4.4.4, VPN label 24002",
        nextHopId: "PE2",
        nextHopLabel: "PE2 (4.4.4.4)",
        reason: "VRF CUST-A matched — PE1 still needs the transport LSP to actually reach 4.4.4.4.",
      };
    }
    if (i === stepIndex("push-vpn-label")) {
      return {
        ...base,
        activeStageId: "vpn-label",
        completedStageIds: ["ingress", "identify-vrf", "vrf-lookup", "bgp-nexthop"],
        packetBefore: "IP packet (VRF CUST-A match)",
        packetAfter: "[VPN 24002][IP]",
        packetBeforeFrames: parseStackFrames("IP packet (VRF CUST-A match)", false),
        packetAfterFrames: parseStackFrames("[VPN 24002][IP]", true),
        lookupType: "VPN Label (from VRF/MP-BGP)",
        lookupResult: "PUSH 24002",
        mutations: mutationsFor("PUSH", "VPN 24002"),
        reason: "The VPN label identifies Customer A's forwarding context at PE2 — it becomes the bottom of the stack.",
      };
    }
    if (i === stepIndex("push-transport-label")) {
      return {
        ...base,
        activeStageId: "build-stack",
        completedStageIds: ["ingress", "identify-vrf", "vrf-lookup", "bgp-nexthop", "vpn-label", "transport-label"],
        packetBefore: "[VPN 24002][IP]",
        packetAfter: "[Transport 102][VPN 24002][IP]",
        packetBeforeFrames: parseStackFrames("[VPN 24002][IP]", false),
        packetAfterFrames: parseStackFrames("[Transport 102][VPN 24002][IP]", true),
        lookupType: "LFIB (Transport)",
        lookupKey: "unlabeled → P1",
        lookupResult: "PUSH 102 → toward P1",
        nextHopId: "P1",
        nextHopLabel: "P1",
        mutations: mutationsFor("PUSH", "Transport 102"),
        reason: "The transport label comes from the LDP-built LFIB — this is what actually gets the packet across the core, outermost so every P router can read it.",
      };
    }
    return {
      ...base,
      completedStageIds: allIds(PE1_STAGES),
      packetBefore: "IP packet (VRF CUST-A match)",
      packetAfter: "[Transport 102][VPN 24002][IP]",
      packetBeforeFrames: parseStackFrames("IP packet (VRF CUST-A match)", false),
      packetAfterFrames: parseStackFrames("[Transport 102][VPN 24002][IP]", false),
    };
  }

  if (router === "P1") {
    const base: DeviceProcessingTrace = { deviceId: "P1", ingressInterfaceId: "P1-pe1", egressInterfaceId: "P1-p2", stages: P1_STAGES, completedStageIds: [] };
    if (i < stepIndex("p1-swap")) return base;
    if (i <= stepIndex("predict-p-router")) {
      return {
        ...base,
        activeStageId: "swap",
        completedStageIds: ["ingress", "read-label", "lfib-lookup"],
        packetBefore: "[Transport 102][VPN 24002][IP]",
        packetAfter: "[Transport 203][VPN 24002][IP]",
        packetBeforeFrames: parseStackFrames("[Transport 102][VPN 24002][IP]", false),
        packetAfterFrames: parseStackFrames("[Transport 203][VPN 24002][IP]", true),
        lookupType: "LFIB (transport, outer label only)",
        lookupKey: "102",
        lookupResult: "SWAP → 203 → toward P2",
        nextHopId: "P2",
        nextHopLabel: "P2",
        mutations: mutationsFor("SWAP", "Transport 203"),
        reason: "P1 never inspects the VPN label underneath — only the outer transport label drives this decision, which is exactly why P routers never need customer routes.",
      };
    }
    return {
      ...base,
      completedStageIds: allIds(P1_STAGES),
      packetBefore: "[Transport 102][VPN 24002][IP]",
      packetAfter: "[Transport 203][VPN 24002][IP]",
      packetBeforeFrames: parseStackFrames("[Transport 102][VPN 24002][IP]", false),
      packetAfterFrames: parseStackFrames("[Transport 203][VPN 24002][IP]", false),
    };
  }

  if (router === "P2") {
    const base: DeviceProcessingTrace = { deviceId: "P2", ingressInterfaceId: "P2-p1", egressInterfaceId: "P2-pe2", stages: P2_STAGES, completedStageIds: [] };
    if (i < stepIndex("p2-php")) return base;
    if (i <= stepIndex("predict-remaining-label")) {
      return {
        ...base,
        activeStageId: "pop",
        completedStageIds: ["ingress", "read-label", "lfib-lookup"],
        packetBefore: "[Transport 203][VPN 24002][IP]",
        packetAfter: "[VPN 24002][IP]",
        packetBeforeFrames: parseStackFrames("[Transport 203][VPN 24002][IP]", false),
        packetAfterFrames: parseStackFrames("[VPN 24002][IP]", true),
        lookupType: "LFIB (implicit-null / PHP)",
        lookupKey: "203",
        lookupResult: "POP outer label only → toward PE2",
        nextHopId: "PE2",
        nextHopLabel: "PE2",
        mutations: mutationsFor("POP", "Transport 203"),
        reason: "PHP removes only the outer transport label — the VPN label underneath must survive all the way to PE2.",
      };
    }
    return {
      ...base,
      completedStageIds: allIds(P2_STAGES),
      packetBefore: "[Transport 203][VPN 24002][IP]",
      packetAfter: "[VPN 24002][IP]",
      packetBeforeFrames: parseStackFrames("[Transport 203][VPN 24002][IP]", false),
      packetAfterFrames: parseStackFrames("[VPN 24002][IP]", false),
    };
  }

  // PE2
  // --- Control-plane branches (brief §19/§21) — originating and advertising the VPNv4 route ---
  if (currentStepId === "remote-route-learned") {
    return { deviceId: "PE2", stages: PE2_CONTROL_STAGES, activeStageId: "vrf-route", completedStageIds: [], lookupType: "VRF Local Route", lookupResult: "10.2.2.0/24 learned into VRF CUST-A (local)", reason: "CE2 advertises its prefix to PE2 — installed as a local route in VRF CUST-A." };
  }
  if (currentStepId === "add-rd") {
    return { deviceId: "PE2", stages: PE2_CONTROL_STAGES, activeStageId: "apply-rd", completedStageIds: ["vrf-route"], lookupType: "Apply RD", lookupResult: `${state.vpnRoute?.rd ?? "—"}:10.2.2.0/24`, reason: "RD only makes the route unique in MP-BGP — it never controls import." };
  }
  if (currentStepId === "rt-attach") {
    return { deviceId: "PE2", stages: PE2_CONTROL_STAGES, activeStageId: "attach-rt", completedStageIds: ["vrf-route", "apply-rd"], lookupType: "Attach Export RT", lookupResult: state.vpnRoute?.rt ?? CUST_A_RT, nextHopId: "PE2", nextHopLabel: "PE2 (self)", reason: "PE2 sets itself as BGP next-hop — the address PE1 will need to reach through the MPLS transport LSP." };
  }
  if (currentStepId === "vpn-label-alloc") {
    return { deviceId: "PE2", stages: PE2_CONTROL_STAGES, activeStageId: "alloc-vpn-label", completedStageIds: ["vrf-route", "apply-rd", "attach-rt"], lookupType: "Allocate VPN Label", lookupResult: String(state.vpnRoute?.vpnLabel ?? "—"), reason: "The VPN label identifies Customer A's forwarding context at PE2 for whenever a labeled packet arrives back — unrelated to the transport label, which comes from LDP." };
  }
  if (currentStepId === "mpbgp-advertise" || currentStepId === "predict-rt-import" || currentStepId === "rt-import-check" || currentStepId === "vrf-install") {
    return { deviceId: "PE2", stages: PE2_CONTROL_STAGES, activeStageId: "mpbgp-advertise", completedStageIds: allIds(PE2_CONTROL_STAGES).slice(0, -1), lookupType: "MP-BGP VPNv4 Advertise", lookupKey: state.vpnRoute ? `${state.vpnRoute.rd}:${state.vpnRoute.prefix}` : undefined, lookupResult: "Advertised to PE1", reason: "RD, prefix, RT, next-hop, and VPN label all travel in one MP-BGP UPDATE." };
  }
  if (i >= stepIndex("remote-route-learned") && i < stepIndex("send-ce1")) {
    return { deviceId: "PE2", stages: PE2_CONTROL_STAGES, activeStageId: "mpbgp-advertise", completedStageIds: allIds(PE2_CONTROL_STAGES), lookupResult: "10.2.2.0/24 advertised via MP-BGP" };
  }

  // --- Forwarding pipeline (existing branch structure, enriched) ---
  const base: DeviceProcessingTrace = { deviceId: "PE2", ingressInterfaceId: "PE2-p2", egressInterfaceId: "PE2-ce", stages: PE2_STAGES, completedStageIds: [] };
  if (i < stepIndex("pe2-vpn-lookup")) return base;
  if (i === stepIndex("pe2-vpn-lookup")) {
    return {
      ...base,
      activeStageId: "vpn-lookup",
      completedStageIds: ["ingress"],
      packetBefore: "[VPN 24002][IP]",
      packetBeforeFrames: parseStackFrames("[VPN 24002][IP]", false),
      lookupType: "VPN Label Lookup",
      lookupKey: "24002",
      lookupResult: "VRF CUST-A forwarding context selected",
      reason: "The VPN label — not a generic IP lookup — tells PE2 which customer/VRF this packet belongs to.",
    };
  }
  if (i === stepIndex("pe2-deliver")) {
    return {
      ...base,
      activeStageId: "ip-forward",
      completedStageIds: ["ingress", "vpn-lookup", "vrf-context", "remove-label"],
      packetBefore: "[VPN 24002][IP]",
      packetAfter: "IP packet → CE2",
      packetBeforeFrames: parseStackFrames("[VPN 24002][IP]", false),
      packetAfterFrames: parseStackFrames("IP packet → CE2", true),
      lookupType: "VRF Forwarding",
      lookupKey: "10.2.2.20 in VRF CUST-A",
      lookupResult: "Delivered to CE2",
      nextHopId: "CE2",
      nextHopLabel: "CE2",
      mutations: mutationsFor("POP", "VPN 24002"),
      reason: "VPN label removed; the exposed IP packet is forwarded using VRF CUST-A's own table, exactly like any normal IP forward.",
    };
  }
  return {
    ...base,
    completedStageIds: allIds(PE2_STAGES),
    packetBefore: "[VPN 24002][IP]",
    packetAfter: "IP packet → CE2",
    packetBeforeFrames: parseStackFrames("[VPN 24002][IP]", false),
    packetAfterFrames: parseStackFrames("IP packet → CE2", false),
  };
}

// ---------------------------------------------------------------------------
// Packet visual stack (brief §5-9) — derived straight from state.packet.
// ---------------------------------------------------------------------------

export function packetFramesFor(state: L3VpnState, activeStageId: string | undefined): PacketStackFrame[] | undefined {
  if (!state.packet) return undefined;
  const justChangedTone = activeStageId === "build-stack" || activeStageId === "swap" || activeStageId === "pop" || activeStageId === "remove-label" || activeStageId === "vpn-label" ? "top" : undefined;
  const labelFrames: PacketStackFrame[] = state.packet.labels.map((l, i) => ({
    id: `label-${i}`,
    text: `${l.purpose === "transport" ? "Transport" : "VPN"} ${l.value}`,
    tone: l.purpose === "transport" ? "transport" : "vpn",
    justChanged: justChangedTone === "top" && i === 0,
  }));
  return [...labelFrames, { id: "ip", text: "IP", tone: "ip" }];
}

// ---------------------------------------------------------------------------
// Physical interfaces (brief §2/§3) — generic naming, IPs are
// presentational device metadata, not something protocol logic reads.
// RD/RT/VRF fields (brief §19) are carried in the generic `extra` bag,
// and ONLY on PE-facing access interfaces — a P router's interfaces
// never carry VRF/RT fields, matching "Transit P should not inspect the
// customer VPN route" (brief §18).
// ---------------------------------------------------------------------------

interface IfaceDef {
  id: string;
  name: string;
  ip: string;
  neighborId: RouterId;
  neighborLabel: string;
  linkType: string;
  mtu: number;
  protocols: string[];
}

const INTERFACES: Record<RouterId, IfaceDef[]> = {
  CE1: [{ id: "CE1-pe1", name: "ge-0/0/0", ip: "10.1.1.10/24", neighborId: "PE1", neighborLabel: "PE1", linkType: "Access", mtu: 1500, protocols: ["Static"] }],
  PE1: [
    { id: "PE1-ce", name: "ge-0/0/0", ip: "10.1.1.1/24", neighborId: "CE1", neighborLabel: "CE1", linkType: "Access (VRF CUST-A)", mtu: 1500, protocols: ["Static"] },
    { id: "PE1-p1", name: "xe-0/1/0", ip: "10.0.12.1/30", neighborId: "P1", neighborLabel: "P1", linkType: "Core (LSP)", mtu: 9192, protocols: ["OSPF", "LDP"] },
  ],
  P1: [
    { id: "P1-pe1", name: "xe-0/0/0", ip: "10.0.12.2/30", neighborId: "PE1", neighborLabel: "PE1", linkType: "Core (LSP)", mtu: 9192, protocols: ["OSPF", "LDP"] },
    { id: "P1-p2", name: "xe-0/1/0", ip: "10.0.23.1/30", neighborId: "P2", neighborLabel: "P2", linkType: "Core (LSP)", mtu: 9192, protocols: ["OSPF", "LDP"] },
  ],
  P2: [
    { id: "P2-p1", name: "xe-0/0/0", ip: "10.0.23.2/30", neighborId: "P1", neighborLabel: "P1", linkType: "Core (LSP)", mtu: 9192, protocols: ["OSPF", "LDP"] },
    { id: "P2-pe2", name: "xe-0/1/0", ip: "10.0.24.1/30", neighborId: "PE2", neighborLabel: "PE2", linkType: "Core (LSP)", mtu: 9192, protocols: ["OSPF", "LDP"] },
  ],
  PE2: [
    { id: "PE2-p2", name: "xe-0/0/0", ip: "10.0.24.2/30", neighborId: "P2", neighborLabel: "P2", linkType: "Core (LSP)", mtu: 9192, protocols: ["OSPF", "LDP"] },
    { id: "PE2-ce", name: "ge-0/1/0", ip: "10.2.2.1/24", neighborId: "CE2", neighborLabel: "CE2", linkType: "Access (VRF CUST-A)", mtu: 1500, protocols: ["Static"] },
  ],
  CE2: [{ id: "CE2-pe2", name: "ge-0/0/0", ip: "10.2.2.20/24", neighborId: "PE2", neighborLabel: "PE2", linkType: "Access", mtu: 1500, protocols: ["Static"] }],
};

export function interfacesFor(router: RouterId, state: L3VpnState, currentStepId: string): DeviceInterfaceData[] {
  const trace = traceFor(router, state, currentStepId);
  const processing = trace?.activeStageId !== undefined;
  const custA = (state.vrfs[router] ?? []).find((v) => v.name === "CUST-A");
  return INTERFACES[router].map((def) => {
    const isVrfAccess = def.linkType.startsWith("Access (VRF");
    const extra: { label: string; value: string }[] = [];
    if (isVrfAccess && custA) {
      extra.push({ label: "VRF", value: custA.name });
      extra.push({ label: "Import RT", value: custA.importRt });
      extra.push({ label: "Export RT", value: custA.exportRt });
      extra.push({ label: "VRF Routes", value: String(custA.routes.length) });
    }
    return {
      id: def.id,
      name: def.name,
      status: "up",
      ip: def.ip,
      neighborId: def.neighborId,
      neighborLabel: def.neighborLabel,
      linkType: def.linkType,
      mtu: def.mtu,
      protocols: def.protocols,
      packetCount: trace && (trace.completedStageIds.length > 0 || processing) ? 1 : 0,
      role: processing && def.id === trace?.ingressInterfaceId ? "ingress" : processing && def.id === trace?.egressInterfaceId ? "egress" : "idle",
      extra: extra.length ? extra : undefined,
    };
  });
}

// ---------------------------------------------------------------------------
// Link detail (brief §10)
// ---------------------------------------------------------------------------

export function linkDetailFor(linkId: string, state: L3VpnState): LinkDetail | undefined {
  const edge = GRAPH_EDGES.find((e) => e.id === linkId);
  if (!edge) return undefined;
  const a = edge.a as RouterId;
  const b = edge.b as RouterId;
  const aIface = INTERFACES[a].find((f) => f.neighborId === b);
  const bIface = INTERFACES[b].find((f) => f.neighborId === a);
  if (!aIface || !bIface) return undefined;
  const isCore = aIface.linkType.startsWith("Core");
  const currentlyCarrying = state.packetAt && [a, b].includes(state.packetAt as RouterId) && state.packet ? state.packet.labels.map((l) => `[${l.purpose === "transport" ? "Transport" : "VPN"} ${l.value}]`).join("") + "[IP]" : undefined;
  return {
    aLabel: a,
    bLabel: b,
    aInterface: { id: aIface.id, name: aIface.name, status: "up", ip: aIface.ip, neighborId: b, neighborLabel: b, linkType: aIface.linkType, mtu: aIface.mtu, protocols: aIface.protocols, role: "idle" },
    bInterface: { id: bIface.id, name: bIface.name, status: "up", ip: bIface.ip, neighborId: a, neighborLabel: a, linkType: bIface.linkType, mtu: bIface.mtu, protocols: bIface.protocols, role: "idle" },
    status: "up",
    mtu: aIface.mtu,
    protocols: isCore ? [{ label: "IGP", value: "OSPF" }, { label: "LDP", value: "UP" }, { label: "MPLS", value: "Enabled" }] : [{ label: "VRF", value: "CUST-A" }, { label: "Import/Export RT", value: CUST_A_RT }],
    currentTraffic: currentlyCarrying,
  };
}

export { CUST_A_RD, CUST_A_RT };
