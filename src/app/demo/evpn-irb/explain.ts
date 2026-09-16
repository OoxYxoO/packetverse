import type { NodeExplanation } from "@/components/network3d/types";
import { ANYCAST_GATEWAYS, L3_VNI, ROUTER_MAC, VLAN_FOR_LEAF, VRF, VTEP_LOOPBACK, type EvpnIrbDeviceId, type EvpnIrbState } from "@/lib/sim-engine/scenarios/evpnIrb";

const DEVICE_TYPE: Record<EvpnIrbDeviceId, string> = {
  "HOST-A": "End Host",
  LEAF1: "Leaf Switch (VTEP, IRB)",
  SPINE1: "Spine Switch",
  LEAF2: "Leaf Switch (VTEP, IRB)",
  LEAF3: "Leaf Switch (VTEP, IRB)",
  "HOST-C": "End Host",
  "HOST-B": "End Host",
};
const ROLE: Record<EvpnIrbDeviceId, string> = {
  "HOST-A": "Sender — VLAN 10",
  LEAF1: `VTEP — ${VTEP_LOOPBACK.LEAF1} — Anycast GW for VLAN 10`,
  SPINE1: "IP Underlay — Not A VTEP",
  LEAF2: `VTEP — ${VTEP_LOOPBACK.LEAF2} — Anycast GW for VLAN 10`,
  LEAF3: `VTEP — ${VTEP_LOOPBACK.LEAF3} — Anycast GW for VLAN 20`,
  "HOST-C": "Same-subnet peer — VLAN 10",
  "HOST-B": "Receiver — VLAN 20",
};

function vrfTable(state: EvpnIrbState, leaf: "LEAF1" | "LEAF2" | "LEAF3") {
  const l3vni = state.l3VniByLeaf[leaf];
  const rows = [{ label: "VRF", value: VRF }, { label: "L3 VNI", value: String(l3vni) }, { label: "Router MAC", value: ROUTER_MAC[leaf] }];
  return { title: `${leaf} — VRF ${VRF}`, rows };
}
function gatewayTable(leaf: "LEAF1" | "LEAF2" | "LEAF3") {
  const gw = ANYCAST_GATEWAYS[VLAN_FOR_LEAF[leaf]];
  return { title: `${leaf} — Anycast Gateway`, rows: [{ label: "Gateway IP", value: gw.gatewayIp }, { label: "Gateway MAC", value: gw.gatewayMac }, { label: "Also provided by", value: gw.leafs.filter((l) => l !== leaf).join(", ") || "(only this leaf)" }] };
}

export function explainNode(state: EvpnIrbState, nodeId: EvpnIrbDeviceId): NodeExplanation {
  const journeyIndex = state.journey.findIndex((h) => h.device === nodeId);
  const isCurrentActor = journeyIndex !== -1 && journeyIndex === state.journey.length - 1;
  const alreadyActed = journeyIndex !== -1 && !isCurrentActor;
  const hop = journeyIndex !== -1 ? state.journey[journeyIndex] : undefined;

  const base: NodeExplanation = { id: nodeId, name: nodeId, deviceType: DEVICE_TYPE[nodeId], role: ROLE[nodeId], currentAction: "" };

  if (nodeId === "HOST-A") {
    return {
      ...base,
      controlPlaneRole: "ARPs for its local Anycast Gateway — otherwise outside BGP EVPN entirely.",
      dataPlaneRole: "Sends the frame to its gateway's MAC (never HOST-B's own MAC) whenever the destination is outside its own subnet.",
      currentAction: state.arpResolved ? "Gateway MAC resolved — ready to send toward HOST-B." : "Idle — needs to ARP for its gateway first.",
      packetAfter: "Ethernet[HOST-A → Anycast GW], IP[HOST-A → HOST-B]",
    };
  }
  if (nodeId === "HOST-C") {
    return {
      ...base,
      controlPlaneRole: "ARPs for the exact same Anycast Gateway identity as HOST-A — resolved locally by LEAF2 instead of LEAF1.",
      dataPlaneRole: "Same-subnet peer of HOST-A — reachable by plain L2 bridging, no IRB/VRF involvement at all.",
      currentAction: "Idle — use the same-subnet comparison to send a frame here.",
    };
  }
  if (nodeId === "HOST-B") {
    const delivered = state.journey.some((h) => h.device === "LEAF3" && h.action === "IRB_DECAP_AND_ROUTE" && !h.output.startsWith("DROPPED"));
    return {
      ...base,
      controlPlaneRole: "Its own MAC/IP was advertised by LEAF3 as an ordinary EVPN Type 2 route — that's what let LEAF1 resolve it at all.",
      dataPlaneRole: "Receives a frame whose Ethernet source is the (VLAN 20) Anycast Gateway, not HOST-A — only the IP layer still says HOST-A.",
      currentAction: delivered ? "Delivered — HOST-B received the routed frame." : "Idle — waiting for LEAF3 to deliver.",
    };
  }

  if (nodeId === "LEAF1") {
    let currentAction = "Idle — waiting for a frame from HOST-A.";
    if (isCurrentActor && hop) currentAction = `Right now: ${hop.lookup} → ${hop.action}.`;
    else if (alreadyActed && hop) currentAction = `Already done: ${hop.lookup} → ${hop.action}. Result: ${hop.output}.`;
    else if (state.remoteHostRoutes.LEAF1?.[0]) currentAction = `Remote host route ready: ${state.remoteHostRoutes.LEAF1[0].route.ip} via LEAF3. Will route and encapsulate the next inter-subnet frame.`;
    return {
      ...base,
      controlPlaneRole: `Provides the VLAN 10 Anycast Gateway locally; imports HOST-B's EVPN Type 2 route to learn its remote VTEP.`,
      dataPlaneRole: `Bridges within L2 VNI 10010 for same-subnet traffic; routes into VRF ${VRF} and VXLAN-encapsulates with L3 VNI ${state.l3VniByLeaf.LEAF1} for anything else.`,
      currentAction,
      packetBefore: hop?.input,
      packetAfter: hop?.output,
      tables: [gatewayTable("LEAF1"), vrfTable(state, "LEAF1")],
    };
  }
  if (nodeId === "LEAF2") {
    return {
      ...base,
      controlPlaneRole: `Provides the exact same VLAN 10 Anycast Gateway as LEAF1 — the same IP, the same MAC, a different physical leaf.`,
      dataPlaneRole: "Only ever bridges HOST-C locally in this lesson's flow — never appears on the routed HOST-A ↔ HOST-B path.",
      currentAction: "Idle — HOST-C's traffic to HOST-A stays inside L2 VNI 10010.",
      tables: [gatewayTable("LEAF2"), vrfTable(state, "LEAF2")],
    };
  }

  if (nodeId === "SPINE1") {
    let currentAction = "Idle — waiting for an underlay packet.";
    if (isCurrentActor && hop) currentAction = `Right now: ${hop.lookup} → ${hop.action}.`;
    else if (alreadyActed && hop) currentAction = `Already done: ${hop.lookup} → ${hop.action}. Result: ${hop.output}.`;
    return {
      ...base,
      controlPlaneRole: "No VRF, no Anycast Gateway, no BGP EVPN participation at all — participates only in the underlay IGP.",
      dataPlaneRole: "Forwards strictly on the outer (underlay) destination IP — it never makes a tenant-VRF decision.",
      currentAction,
      packetBefore: hop?.input,
      packetAfter: hop?.output,
      note: "SPINE1 routes the VXLAN packet as plain IP — it has no idea this traffic was ever routed between subnets at all.",
    };
  }

  // LEAF3
  const mismatch = state.l3VniByLeaf.LEAF3 !== L3_VNI;
  let currentAction = "Idle — waiting for a routed VXLAN packet.";
  if (isCurrentActor && hop) currentAction = `Right now: ${hop.lookup} → ${hop.action}.`;
  else if (alreadyActed && hop) currentAction = `Already done: ${hop.lookup} → ${hop.action}. Result: ${hop.output}.`;
  return {
    ...base,
    controlPlaneRole: `Originates HOST-B's EVPN Type 2 route; provides VLAN 20's Anycast Gateway locally.`,
    dataPlaneRole: `Decapsulates VXLAN traffic carrying its own VRF's L3 VNI, routes it, and rewrites the Ethernet header for local delivery to HOST-B.`,
    currentAction,
    packetBefore: hop?.input,
    packetAfter: hop?.output,
    note: mismatch ? `LEAF3's VRF ${VRF} is currently mapped to L3 VNI ${state.l3VniByLeaf.LEAF3} — a routed packet carrying L3 VNI ${L3_VNI} has nowhere to land.` : undefined,
    tables: [gatewayTable("LEAF3"), vrfTable(state, "LEAF3")],
  };
}
