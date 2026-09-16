import type { NodeExplanation } from "@/components/network3d/types";
import type { L3VpnState, RouterId } from "@/lib/sim-engine/scenarios/mplsL3vpn";

/**
 * All MPLS-L3VPN-specific reasoning for the 3D node inspector lives
 * here, not inside any network3d/ component (brief §6: "Do not move
 * networking logic into the 3D components"). Tense ("already did" /
 * "doing now" / "will do") is derived from `state.journey` — the same
 * data the 2D <PacketJourneyTimeline> already renders — rather than
 * from a hand-written per-step lookup table, so it stays correct
 * automatically as the learner moves through the lesson, including
 * Previous/Restart and the fault/repair/challenge phases.
 */

const PATH_ORDER: RouterId[] = ["CE1", "PE1", "P1", "P2", "PE2", "CE2"];

const DEVICE_TYPE: Record<RouterId, string> = {
  CE1: "CE Router",
  PE1: "PE Router",
  P1: "P Router (Core)",
  P2: "P Router (Core)",
  PE2: "PE Router",
  CE2: "CE Router",
};
const ROLE: Record<RouterId, string> = {
  CE1: "Customer Edge — Site 1",
  PE1: "Ingress PE",
  P1: "Transit P Router",
  P2: "Penultimate Hop",
  PE2: "Egress PE",
  CE2: "Customer Edge — Site 2",
};

function vrfTable(state: L3VpnState, router: RouterId) {
  const vrfs = state.vrfs[router];
  if (!vrfs || vrfs.length === 0) return undefined;
  return {
    title: `${router} — VRF Tables`,
    rows: vrfs.flatMap((v) => v.routes.map((r) => ({ label: `${v.name} · ${r.prefix} (RT ${v.importRt})`, value: `${r.prefix} (${r.origin}${r.viaPe ? ` via ${r.viaPe}` : ""})` }))),
  };
}

function vpnRouteTable(state: L3VpnState, router: RouterId) {
  if (router === "PE2" && state.vpnRoute) {
    return {
      title: "PE2 — VPNv4 Route (originated)",
      rows: [
        { label: "Prefix", value: state.vpnRoute.prefix },
        { label: "RD", value: state.vpnRoute.rd ?? "not yet applied" },
        { label: "RT", value: state.vpnRoute.rt ?? "not yet attached" },
        { label: "VPN Label", value: state.vpnRoute.vpnLabel !== undefined ? String(state.vpnRoute.vpnLabel) : "not yet allocated" },
      ],
    };
  }
  if (router === "PE1" && state.received.PE1) {
    const r = state.received.PE1;
    return {
      title: "PE1 — Received VPNv4 Route",
      rows: [
        { label: "Prefix", value: r.route.prefix },
        { label: "RD", value: r.route.rd ?? "—" },
        { label: "RT", value: r.route.rt ?? "—" },
        { label: "RT check", value: r.rtChecked ? (r.imported ? "Matched — imported" : "Mismatch — rejected") : "not yet checked" },
      ],
    };
  }
  return undefined;
}

export function explainNode(state: L3VpnState, nodeId: RouterId): NodeExplanation {
  const journeyIndex = state.journey.findIndex((h) => h.router === nodeId);
  const isCurrentActor = journeyIndex !== -1 && journeyIndex === state.journey.length - 1;
  const alreadyActed = journeyIndex !== -1 && !isCurrentActor;
  const hop = journeyIndex !== -1 ? state.journey[journeyIndex] : undefined;

  const base: NodeExplanation = {
    id: nodeId,
    name: nodeId,
    deviceType: DEVICE_TYPE[nodeId],
    role: ROLE[nodeId],
    currentAction: "",
  };

  if (nodeId === "CE1") {
    return {
      ...base,
      controlPlaneRole: "Outside the provider's BGP/MPLS control plane entirely — CE1↔PE1 routing (static or a simple IGP) isn't this lesson's focus.",
      dataPlaneRole: "Originates the plain IP packet toward CE2. Never carries or sees a label.",
      currentAction: state.packet ? "Already sent — the plain IP packet has entered PE1's VRF CUST-A." : "Idle — waiting for the lesson to send a packet toward CE2.",
      packetAfter: "[IP]",
    };
  }

  if (nodeId === "CE2") {
    const delivered = state.journey.some((h) => h.router === "PE2" && h.action === "VPN_LOOKUP");
    return {
      ...base,
      controlPlaneRole: "Outside the provider's BGP/MPLS control plane — PE2↔CE2 routing isn't this lesson's focus.",
      dataPlaneRole: "Receives the exposed IP packet from PE2. Never sees a label — the entire MPLS/VPN domain is invisible to it.",
      currentAction: delivered ? "Delivered — CE2 has received the packet, labels fully stripped." : "Idle — waiting for PE2 to deliver the packet.",
      packetBefore: delivered ? "[IP] (from PE2)" : undefined,
    };
  }

  if (nodeId === "PE1") {
    const tables = [vrfTable(state, "PE1"), vpnRouteTable(state, "PE1")].filter((t): t is NonNullable<typeof t> => !!t);
    let currentAction = "Idle — VRF CUST-A holds only its local route so far.";
    if (isCurrentActor && hop) currentAction = `Right now: ${hop.lookup} → ${hop.action}.`;
    else if (alreadyActed && hop) currentAction = `Already done: ${hop.lookup} → ${hop.action}. Result: ${hop.output}.`;
    else if (state.received.PE1?.imported) currentAction = "VRF lookup already resolved 10.2.2.0/24 via the imported VPNv4 route — ready to forward once a packet arrives.";
    else if (state.received.PE1) currentAction = state.received.PE1.rtChecked ? "Received the VPNv4 route but RT did not match — nothing importable into CUST-A right now." : "Received the VPNv4 route from PE2, not yet RT-checked.";
    return {
      ...base,
      controlPlaneRole: "Holds VRF CUST-A separately from the global table; receives PE2's VPNv4 route over MP-BGP and checks RT before importing it.",
      dataPlaneRole: "VRF lookup on the destination, then pushes the VPN label, then pushes the transport label toward P1.",
      currentAction,
      packetBefore: hop?.input,
      packetAfter: hop?.output,
      tables,
    };
  }

  if (nodeId === "P1" || nodeId === "P2") {
    let currentAction = "Idle — waiting for a labeled packet whose incoming transport label matches an LFIB entry.";
    if (isCurrentActor && hop) currentAction = `Right now: ${hop.lookup} → ${hop.action}.`;
    else if (alreadyActed && hop) currentAction = `Already done: ${hop.lookup} → ${hop.action}. Result: ${hop.output}.`;
    return {
      ...base,
      controlPlaneRole: "No VRF, no customer routes, no MP-BGP session at all — participates only in the provider's IGP and LDP.",
      dataPlaneRole: nodeId === "P1" ? "Swaps the outer transport label only." : "Penultimate-hop-pops the outer transport label only.",
      currentAction,
      packetBefore: hop?.input,
      packetAfter: hop?.output,
      note: `${nodeId} never inspects or uses the inner VPN label for this forwarding decision — it rides along unread, for PE2 to use.`,
    };
  }

  // PE2
  const tables = [vrfTable(state, "PE2"), vpnRouteTable(state, "PE2")].filter((t): t is NonNullable<typeof t> => !!t);
  let currentAction = "Idle — has not yet built the VPNv4 route for 10.2.2.0/24.";
  if (isCurrentActor && hop) currentAction = `Right now: ${hop.lookup} → ${hop.action}.`;
  else if (alreadyActed && hop) currentAction = `Already done: ${hop.lookup} → ${hop.action}. Result: ${hop.output}.`;
  else if (state.vpnRoute?.vpnLabel !== undefined) currentAction = `Control plane complete — RD ${state.vpnRoute.rd}, RT ${state.vpnRoute.rt}, VPN label ${state.vpnRoute.vpnLabel} advertised to PE1. Will look up the VPN label and deliver to CE2 once a packet arrives.`;
  return {
    ...base,
    controlPlaneRole: "Originates the VPNv4 route: attaches RD for uniqueness, RT for import policy, allocates a VPN label, advertises to PE1 over MP-BGP.",
    dataPlaneRole: "VPN-label lookup selects the VRF CUST-A forwarding context, then delivers the exposed IP packet to CE2.",
    currentAction,
    packetBefore: hop?.input,
    packetAfter: hop?.output,
    tables,
  };
}

export { PATH_ORDER };
