import type { NodeExplanation } from "@/components/network3d/types";
import { HOST_A_IP, HOST_A_MAC, HOST_B_IP, HOST_B_MAC, VTEP_LOOPBACK, canSuppressNeighborDiscovery, lookupMacIpBinding, type EvpnArpNdDeviceId, type EvpnArpNdState } from "@/lib/sim-engine/scenarios/evpnArpNdSuppression";

const DEVICE_TYPE: Record<EvpnArpNdDeviceId, string> = { "HOST-A": "End Host", LEAF1: "Leaf Switch (VTEP)", SPINE1: "Spine Switch", LEAF2: "Leaf Switch (VTEP)", LEAF3: "Leaf Switch (VTEP)", "HOST-B": "End Host" };

export function explainNode(state: EvpnArpNdState, nodeId: EvpnArpNdDeviceId): NodeExplanation {
  const journeyIndex = state.journey.findIndex((h) => h.device === nodeId);
  const isCurrentActor = journeyIndex !== -1 && journeyIndex === state.journey.length - 1;
  const alreadyActed = journeyIndex !== -1 && !isCurrentActor;
  const hop = journeyIndex !== -1 ? state.journey[journeyIndex] : undefined;
  const base: NodeExplanation = { id: nodeId, name: nodeId, deviceType: DEVICE_TYPE[nodeId], role: nodeId, currentAction: "" };

  if (nodeId === "HOST-A") {
    return { ...base, controlPlaneRole: "Outside BGP EVPN entirely.", dataPlaneRole: "Sends an ordinary ARP request whenever it needs a MAC — unaware whether the fabric answers it locally or floods it.", currentAction: state.arpCacheHostA.length ? `ARP cache: ${state.arpCacheHostA[0].ip} → ${state.arpCacheHostA[0].mac}` : "No ARP cache entry for HOST-B yet." };
  }
  if (nodeId === "HOST-B") {
    return { ...base, controlPlaneRole: "Its own MAC/IP was advertised via ordinary EVPN Type 2 — that's what makes suppression possible at all.", dataPlaneRole: "Never sees any of this — ARP suppression is entirely a leaf/VTEP-side optimization.", currentAction: "Idle." };
  }
  if (nodeId === "SPINE1") {
    let currentAction = "Idle.";
    if (isCurrentActor && hop) currentAction = `Right now: ${hop.lookup} → ${hop.action}.`;
    else if (alreadyActed && hop) currentAction = `Already done: ${hop.lookup} → ${hop.action}.`;
    return { ...base, controlPlaneRole: "No MAC/IP bindings, no ARP/ND lookup logic, no BGP EVPN participation at all.", dataPlaneRole: "Forwards strictly on the outer underlay destination IP — whether the packet is a BUM replica or ordinary unicast makes no difference to it.", currentAction, packetBefore: hop?.input, packetAfter: hop?.output, note: "ARP/ND suppression decisions never happen on the spine — that's entirely a leaf/VTEP concern." };
  }

  const leaf = nodeId as "LEAF1" | "LEAF2" | "LEAF3";
  const binding = lookupMacIpBinding(state.macIpBindings[leaf], HOST_B_IP);
  const canSuppress = canSuppressNeighborDiscovery(binding);
  let currentAction = "Idle.";
  if (isCurrentActor && hop) currentAction = `Right now: ${hop.lookup} → ${hop.action}.`;
  else if (alreadyActed && hop) currentAction = `Already done: ${hop.lookup} → ${hop.action}.`;
  else if (leaf === "LEAF1") currentAction = state.suppressionEnabled ? (canSuppress ? `Ready to suppress: ${HOST_B_IP} → ${binding?.mac} known locally.` : "Binding incomplete — the next ARP request will fall back to BUM.") : "Suppression not yet introduced — the next ARP request will flood normally.";
  return {
    ...base,
    controlPlaneRole: leaf === "LEAF1" ? "Maintains its own EVPN MAC/IP binding table — used both for ordinary forwarding and, once introduced, for local ARP suppression." : "Imports HOST-B's Type 2 route like any other remote MAC/IP fact.",
    dataPlaneRole: leaf === "LEAF1" ? "Either floods an ARP request as BUM, or answers it locally with a proxy reply — never both for the same request." : "Would receive a flooded ARP copy whenever LEAF1 falls back to BUM.",
    currentAction,
    packetBefore: hop?.input,
    packetAfter: hop?.output,
    note: leaf === "LEAF1" && binding && !binding.hasIpInfo ? `${HOST_B_IP}'s binding is missing its IP information — MAC route is fine, but suppression can't use it.` : undefined,
  };
}

export { HOST_A_MAC, HOST_A_IP, HOST_B_MAC, HOST_B_IP, VTEP_LOOPBACK };
