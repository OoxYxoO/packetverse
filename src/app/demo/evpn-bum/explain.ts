import type { NodeExplanation } from "@/components/network3d/types";
import { VNI, VTEP_LOOPBACK, type EvpnBumDeviceId, type EvpnBumState } from "@/lib/sim-engine/scenarios/evpnBum";

const DEVICE_TYPE: Record<EvpnBumDeviceId, string> = {
  "HOST-A": "End Host",
  LEAF1: "Leaf Switch (VTEP)",
  SPINE1: "Spine Switch",
  LEAF2: "Leaf Switch (VTEP)",
  LEAF3: "Leaf Switch (VTEP)",
  "HOST-B": "End Host",
  "HOST-C": "End Host",
};
const ROLE: Record<EvpnBumDeviceId, string> = {
  "HOST-A": "Sender",
  LEAF1: `VTEP — ${VTEP_LOOPBACK.LEAF1}`,
  SPINE1: "IP Underlay — Not A VTEP",
  LEAF2: `VTEP — ${VTEP_LOOPBACK.LEAF2}`,
  LEAF3: `VTEP — ${VTEP_LOOPBACK.LEAF3}`,
  "HOST-B": "Receiver",
  "HOST-C": "Receiver",
};

function floodListInfo(state: EvpnBumState, leaf: "LEAF1" | "LEAF2" | "LEAF3") {
  const list = state.floodList[leaf];
  return { title: `${leaf} — VNI ${VNI} Flood List`, rows: list.length ? list.map((l) => ({ label: l, value: VTEP_LOOPBACK[l] })) : [{ label: "(empty)", value: "no remote VTEPs currently learned" }] };
}

export function explainNode(state: EvpnBumState, nodeId: EvpnBumDeviceId): NodeExplanation {
  const journeyIndex = state.journey.findIndex((h) => h.device === nodeId);
  const isCurrentActor = journeyIndex !== -1 && journeyIndex === state.journey.length - 1;
  const alreadyActed = journeyIndex !== -1 && !isCurrentActor;
  const hop = journeyIndex !== -1 ? state.journey[journeyIndex] : undefined;

  const base: NodeExplanation = { id: nodeId, name: nodeId, deviceType: DEVICE_TYPE[nodeId], role: ROLE[nodeId], currentAction: "" };

  if (nodeId === "HOST-A") {
    return {
      ...base,
      controlPlaneRole: "Outside BGP EVPN entirely — HOST-A has no idea a flood list exists.",
      dataPlaneRole: "Originates a plain broadcast Ethernet frame (dest FF:FF:FF:FF:FF:FF). Sends exactly one frame, regardless of how many remote VTEPs exist.",
      currentAction: state.packet ? "Broadcast frame already sent toward LEAF1." : "Idle — waiting for the lesson to send a broadcast.",
      packetAfter: "Ethernet[FF:FF:FF:FF:FF:FF]",
    };
  }
  if (nodeId === "HOST-B" || nodeId === "HOST-C") {
    const delivered = state.journey.some((h) => h.device === nodeId.replace("HOST", "LEAF").replace("-B", "2").replace("-C", "3") && h.action === "DECAP_AND_DELIVER");
    return {
      ...base,
      controlPlaneRole: "Outside BGP EVPN entirely.",
      dataPlaneRole: "Receives the exposed broadcast frame from its local leaf — identical to what HOST-A sent.",
      currentAction: delivered ? "Delivered — this host received the broadcast, VXLAN headers fully stripped." : "Idle — waiting for its leaf to deliver the broadcast.",
    };
  }

  if (nodeId === "LEAF1") {
    const tables = [floodListInfo(state, "LEAF1")];
    let currentAction = "Idle — waiting for a frame from HOST-A.";
    if (isCurrentActor && hop) currentAction = `Right now: ${hop.lookup} → ${hop.action}.`;
    else if (alreadyActed && hop) currentAction = `Already done: ${hop.lookup} → ${hop.action}. Result: ${hop.output}.`;
    else if (state.floodList.LEAF1.length) currentAction = `Flood list ready: ${state.floodList.LEAF1.join(", ")} — will replicate any BUM frame toward each of them.`;
    return {
      ...base,
      controlPlaneRole: "Peers with LEAF2 and LEAF3 over BGP EVPN; advertises its own Type 3 (IMET) route and imports theirs to build its VNI 10010 flood list.",
      dataPlaneRole: "Classifies inbound frames; for BUM traffic, creates one independent VXLAN copy per entry in its flood list (ingress replication).",
      currentAction,
      packetBefore: hop?.input,
      packetAfter: hop?.output,
      tables,
    };
  }

  if (nodeId === "SPINE1") {
    let currentAction = "Idle — waiting for underlay IP packets.";
    if (isCurrentActor && hop) currentAction = `Right now: ${hop.lookup} → ${hop.action}.`;
    else if (alreadyActed && hop) currentAction = `Already done: ${hop.lookup} → ${hop.action}. Result: ${hop.output}.`;
    return {
      ...base,
      controlPlaneRole: "No VXLAN, no BGP EVPN, no VNI flood list at all — participates only in the underlay IGP.",
      dataPlaneRole: "Forwards each underlay packet strictly on its own outer destination IP — even when several packets are really copies of the same original frame, SPINE1 treats them as unrelated IP packets.",
      currentAction,
      packetBefore: hop?.input,
      packetAfter: hop?.output,
      note: "SPINE1 never knows this traffic is a broadcast, and never needs to — replication already happened at LEAF1.",
    };
  }

  // LEAF2 / LEAF3
  const tables = [floodListInfo(state, nodeId as "LEAF2" | "LEAF3")];
  let currentAction = "Idle.";
  if (isCurrentActor && hop) currentAction = `Right now: ${hop.lookup} → ${hop.action}.`;
  else if (alreadyActed && hop) currentAction = `Already done: ${hop.lookup} → ${hop.action}. Result: ${hop.output}.`;
  else if (state.floodList[nodeId as "LEAF2" | "LEAF3"].length) currentAction = `Flood list ready: ${state.floodList[nodeId as "LEAF2" | "LEAF3"].join(", ")}.`;
  return {
    ...base,
    controlPlaneRole: "Advertises its own Type 3 route for VNI 10010 and imports the other leafs' — this is what makes it a valid BUM-replication target in the first place.",
    dataPlaneRole: "Decapsulates any inbound VXLAN copy addressed to its own VTEP and delivers the exposed frame out every locally eligible port for VNI 10010.",
    currentAction,
    packetBefore: hop?.input,
    packetAfter: hop?.output,
    tables,
  };
}
