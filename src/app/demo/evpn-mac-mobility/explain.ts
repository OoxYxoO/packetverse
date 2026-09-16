import type { NodeExplanation } from "@/components/network3d/types";
import { HOST_A_IP, HOST_A_MAC, HOST_B_IP, HOST_B_MAC, VTEP_LOOPBACK, type EvpnMobilityDeviceId, type EvpnMobilityState } from "@/lib/sim-engine/scenarios/evpnMacMobility";

const DEVICE_TYPE: Record<EvpnMobilityDeviceId, string> = { "HOST-A": "End Host (Mobile)", LEAF1: "Leaf Switch (VTEP)", SPINE1: "Spine Switch", LEAF2: "Leaf Switch (VTEP)", LEAF3: "Leaf Switch (VTEP)", "HOST-B": "End Host" };

export function explainNode(state: EvpnMobilityState, nodeId: EvpnMobilityDeviceId): NodeExplanation {
  const journeyIndex = state.journey.findIndex((h) => h.device === nodeId);
  const isCurrentActor = journeyIndex !== -1 && journeyIndex === state.journey.length - 1;
  const alreadyActed = journeyIndex !== -1 && !isCurrentActor;
  const hop = journeyIndex !== -1 ? state.journey[journeyIndex] : undefined;
  const base: NodeExplanation = { id: nodeId, name: nodeId, deviceType: DEVICE_TYPE[nodeId], role: nodeId === "HOST-A" ? `Currently on ${state.hostALocation}` : nodeId, currentAction: "" };

  if (nodeId === "HOST-A") {
    return { ...base, controlPlaneRole: "Outside BGP EVPN entirely — its own MAC/IP never changes, no matter where it's attached.", dataPlaneRole: `Reachable via whichever leaf is currently selected by each remote VTEP's own mobility comparison.`, currentAction: `Attached to ${state.hostALocation}. Identity: ${HOST_A_MAC} / ${HOST_A_IP} — unchanged since the lesson began.` };
  }
  if (nodeId === "HOST-B") {
    return { ...base, controlPlaneRole: "Outside this lesson's mobility story — stationary throughout.", dataPlaneRole: "Sends toward HOST-A; unaware that HOST-A's location has changed at all.", currentAction: "Idle." };
  }
  if (nodeId === "SPINE1") {
    let currentAction = "Idle.";
    if (isCurrentActor && hop) currentAction = `Right now: ${hop.lookup} → ${hop.action}.`;
    else if (alreadyActed && hop) currentAction = `Already done: ${hop.lookup} → ${hop.action}.`;
    return { ...base, controlPlaneRole: "No MAC table, no mobility sequence tracking, no BGP EVPN participation at all.", dataPlaneRole: "Forwards strictly on the outer underlay destination VTEP IP — it never tracks where HOST-A currently is.", currentAction, packetBefore: hop?.input, packetAfter: hop?.output, note: "The spine never tracks endpoint mobility — that's entirely a leaf/VTEP and BGP EVPN concern." };
  }

  // Leaf
  const leaf = nodeId as "LEAF1" | "LEAF2" | "LEAF3";
  const isLocal = leaf === state.hostALocation;
  const selected = isLocal ? state.hostARoutes[state.hostARoutes.length - 1] : state.selectedRouteByLeaf[leaf];
  let currentAction = "Idle.";
  if (isCurrentActor && hop) currentAction = `Right now: ${hop.lookup} → ${hop.action}.`;
  else if (alreadyActed && hop) currentAction = `Already done: ${hop.lookup} → ${hop.action}.`;
  else if (isLocal) currentAction = `HOST-A is locally attached here (sequence ${selected?.mobilitySeq ?? 0}).`;
  else if (selected) currentAction = `Believes HOST-A is behind ${selected.originLeaf} (sequence ${selected.mobilitySeq}, ${selected.stale ? "STALE — comparison not applied" : "current"}).`;
  return {
    ...base,
    controlPlaneRole: isLocal ? "Originates HOST-A's Type 2 route with the next mobility sequence whenever it observes HOST-A locally for the first time." : "Imports HOST-A's Type 2 route and must select whichever advertisement carries the higher mobility sequence.",
    dataPlaneRole: isLocal ? "Delivers inbound VXLAN traffic to HOST-A's local access port." : "Bridges outbound traffic toward HOST-A's currently SELECTED remote VTEP.",
    currentAction,
    packetBefore: hop?.input,
    packetAfter: hop?.output,
    note: !isLocal && selected?.stale ? `${leaf} received a newer route but its comparison logic didn't act on it — still forwarding to ${selected.originLeaf}.` : undefined,
  };
}

export { HOST_A_MAC, HOST_A_IP, HOST_B_MAC, HOST_B_IP, VTEP_LOOPBACK };
