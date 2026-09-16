import type { NodeExplanation } from "@/components/network3d/types";
import { ANYCAST_GATEWAYS, ROUTER_MAC, TENANT_PREFIX, VRF, VTEP_LOOPBACK, type EvpnType5DeviceId, type EvpnType5State } from "@/lib/sim-engine/scenarios/evpnType5";

const DEVICE_TYPE: Record<EvpnType5DeviceId, string> = {
  "HOST-A": "End Host",
  LEAF1: "Leaf Switch (VTEP, IRB)",
  SPINE1: "Spine Switch",
  LEAF2: "Leaf Switch (VTEP, IRB)",
  LEAF3: "Leaf Switch (VTEP, IRB)",
  "HOST-C": "End Host",
  "HOST-B": "End Host",
  "BORDER-SVR": "External Segment",
};
const ROLE: Record<EvpnType5DeviceId, string> = {
  "HOST-A": "Sender — VLAN 10",
  LEAF1: `VTEP — ${VTEP_LOOPBACK.LEAF1} — Anycast GW for VLAN 10`,
  SPINE1: "IP Underlay — Not A VTEP",
  LEAF2: `VTEP — ${VTEP_LOOPBACK.LEAF2}`,
  LEAF3: `VTEP — ${VTEP_LOOPBACK.LEAF3} — Originates the tenant prefix`,
  "HOST-C": "Same-subnet peer — VLAN 10",
  "HOST-B": "Receiver — VLAN 20 (Type 2, from the previous lesson)",
  "BORDER-SVR": `Origin of ${TENANT_PREFIX} — connected/static in VRF ${VRF}`,
};

export function explainNode(state: EvpnType5State, nodeId: EvpnType5DeviceId): NodeExplanation {
  const journeyIndex = state.journey.findIndex((h) => h.device === nodeId);
  const isCurrentActor = journeyIndex !== -1 && journeyIndex === state.journey.length - 1;
  const alreadyActed = journeyIndex !== -1 && !isCurrentActor;
  const hop = journeyIndex !== -1 ? state.journey[journeyIndex] : undefined;
  const base: NodeExplanation = { id: nodeId, name: nodeId, deviceType: DEVICE_TYPE[nodeId], role: ROLE[nodeId], currentAction: "" };

  if (nodeId === "HOST-A") {
    return { ...base, controlPlaneRole: "Outside BGP EVPN entirely.", dataPlaneRole: "Sends toward its local Anycast Gateway whenever the destination is outside its own subnet — including a destination inside a Type-5-learned prefix.", currentAction: state.packet ? "Frame sent toward the tenant prefix." : "Idle." };
  }
  if (nodeId === "HOST-C" || nodeId === "HOST-B") {
    return { ...base, controlPlaneRole: "Outside this lesson's Type 5 story.", dataPlaneRole: "Unaffected by anything in this lesson — still reachable exactly as the previous lesson left it.", currentAction: "Idle." };
  }
  if (nodeId === "BORDER-SVR") {
    return { ...base, controlPlaneRole: `Not itself a BGP EVPN participant — it's simply what ${TENANT_PREFIX} sits behind.`, dataPlaneRole: "Represents the destination segment traffic is actually routed toward.", currentAction: state.journey.some((h) => h.device === "LEAF3") ? "Delivered — traffic has arrived from LEAF3." : "Idle." };
  }

  if (nodeId === "LEAF1" || nodeId === "LEAF2") {
    const received = state.received[nodeId]?.[0];
    let currentAction = "Idle — waiting for a Type 5 route.";
    if (isCurrentActor && hop) currentAction = `Right now: ${hop.lookup} → ${hop.action}.`;
    else if (alreadyActed && hop) currentAction = `Already done: ${hop.lookup} → ${hop.action}. Result: ${hop.output}.`;
    else if (received) currentAction = `${received.route.prefix} ${received.imported ? (received.vtepResolved ? "installed and usable" : "installed, but its next-hop VTEP is NOT resolvable") : "received, not imported"}.`;
    return {
      ...base,
      controlPlaneRole: `Imports EVPN Type 5 (and Type 2/Type 3) routes into VRF ${VRF} under the same RT policy every earlier EVPN route type used.`,
      dataPlaneRole: nodeId === "LEAF1" ? `Routes into VRF ${VRF}, performs longest-prefix match, and VXLAN-encapsulates over L3 VNI 50000 toward whichever VTEP owns the matching route.` : "Provides VLAN 10's Anycast Gateway; not on the routed HOST-A ↔ prefix path in this lesson's main flow.",
      currentAction,
      packetBefore: hop?.input,
      packetAfter: hop?.output,
      note: received && received.imported && !received.vtepResolved ? `${received.route.prefix} is installed in VRF ${VRF} but its next-hop VTEP (${received.route.nextHop}) can't currently be resolved through the underlay.` : undefined,
    };
  }

  if (nodeId === "SPINE1") {
    let currentAction = "Idle.";
    if (isCurrentActor && hop) currentAction = `Right now: ${hop.lookup} → ${hop.action}.`;
    else if (alreadyActed && hop) currentAction = `Already done: ${hop.lookup} → ${hop.action}. Result: ${hop.output}.`;
    return { ...base, controlPlaneRole: "No VRF, no route types, no BGP EVPN participation at all.", dataPlaneRole: "Forwards strictly on the outer underlay destination VTEP IP — regardless of whether a Type 2, Type 3, or Type 5 route originally populated the forwarding decision.", currentAction, packetBefore: hop?.input, packetAfter: hop?.output, note: "The spine never makes a tenant-VRF decision, for any route type." };
  }

  // LEAF3
  let currentAction = "Idle.";
  if (isCurrentActor && hop) currentAction = `Right now: ${hop.lookup} → ${hop.action}.`;
  else if (alreadyActed && hop) currentAction = `Already done: ${hop.lookup} → ${hop.action}. Result: ${hop.output}.`;
  else currentAction = `Originates ${TENANT_PREFIX} as an EVPN Type 5 route.`;
  return {
    ...base,
    controlPlaneRole: `Originates the Type 5 route for ${TENANT_PREFIX} (RD/RT attached, next-hop = its own VTEP); also originates HOST-B's Type 2 route from the previous lesson.`,
    dataPlaneRole: `Decapsulates routed VXLAN traffic for VRF ${VRF} and delivers it toward the destination prefix.`,
    currentAction,
    packetBefore: hop?.input,
    packetAfter: hop?.output,
    tables: [{ title: `${nodeId} — Router MAC`, rows: [{ label: "Router MAC", value: ROUTER_MAC.LEAF3 }, { label: "VTEP", value: VTEP_LOOPBACK.LEAF3 }] }],
  };
}

export { ANYCAST_GATEWAYS };
