import type { NodeExplanation } from "@/components/network3d/types";
import { EVPN_EXPORT_RT, HOST_A_IP, HOST_A_MAC, HOST_B_IP, HOST_B_MAC, VNI, VTEP_LOOPBACK, type EvpnDeviceId, type EvpnState } from "@/lib/sim-engine/scenarios/evpnVxlan";

/**
 * All EVPN/VXLAN-specific reasoning for the 3D node inspector lives
 * here, not inside any network3d/ component — mirrors mpls-l3vpn's
 * explain.ts exactly. Tense is derived from `state.journey`, the same
 * data <PacketJourneyTimeline>-style panels already render.
 */

const DEVICE_TYPE: Record<EvpnDeviceId, string> = {
  "HOST-A": "End Host",
  LEAF1: "Leaf Switch (VTEP)",
  SPINE1: "Spine Switch",
  LEAF2: "Leaf Switch (VTEP)",
  "HOST-B": "End Host",
};
const ROLE: Record<EvpnDeviceId, string> = {
  "HOST-A": "Sender",
  LEAF1: `VTEP — ${VTEP_LOOPBACK.LEAF1}`,
  SPINE1: "IP Underlay — Not A VTEP",
  LEAF2: `VTEP — ${VTEP_LOOPBACK.LEAF2}`,
  "HOST-B": "Receiver",
};

function macTableInfo(state: EvpnState, leaf: "LEAF1" | "LEAF2") {
  const rows = state.macTable[leaf].map((m) => ({
    label: `${m.mac} (${m.ip})`,
    value: m.learnedVia === "local" ? "Local — this leaf's access port" : m.learnedVia === "evpn" ? `Remote via EVPN — VTEP ${m.remoteVtep}` : `Remote (assumed for now) — VTEP ${m.remoteVtep}`,
  }));
  return { title: `${leaf} — MAC/IP Table`, rows };
}

function evpnRouteInfo(state: EvpnState, leaf: "LEAF1" | "LEAF2") {
  if (leaf === "LEAF2" && state.evpnRoute) {
    const r = state.evpnRoute;
    return { title: "LEAF2 — EVPN Type 2 Route (originated)", rows: [
      { label: "MAC / IP", value: `${r.mac} / ${r.ip}` },
      { label: "RD", value: r.rd },
      { label: "RT", value: r.rt },
      { label: "Next Hop", value: r.nextHop },
    ] };
  }
  if (leaf === "LEAF1" && state.received.LEAF1) {
    const r = state.received.LEAF1;
    return { title: "LEAF1 — Received EVPN Type 2 Route", rows: [
      { label: "MAC / IP", value: `${r.route.mac} / ${r.route.ip}` },
      { label: "RD", value: r.route.rd },
      { label: "RT", value: r.route.rt },
      { label: "Import RT check", value: r.rtChecked ? (r.imported ? "Matched — imported" : "Mismatch — rejected") : "not yet checked" },
    ] };
  }
  return undefined;
}

export function explainNode(state: EvpnState, nodeId: EvpnDeviceId): NodeExplanation {
  const journeyIndex = state.journey.findIndex((h) => h.device === nodeId);
  const isCurrentActor = journeyIndex !== -1 && journeyIndex === state.journey.length - 1;
  const alreadyActed = journeyIndex !== -1 && !isCurrentActor;
  const hop = journeyIndex !== -1 ? state.journey[journeyIndex] : undefined;

  const base: NodeExplanation = { id: nodeId, name: nodeId, deviceType: DEVICE_TYPE[nodeId], role: ROLE[nodeId], currentAction: "" };

  if (nodeId === "HOST-A") {
    return {
      ...base,
      controlPlaneRole: "Outside VXLAN and BGP EVPN entirely — HOST-A has no idea any of this exists.",
      dataPlaneRole: `Originates a plain Ethernet frame toward ${HOST_B_MAC}. Never sees a VXLAN header.`,
      currentAction: state.packet ? "Frame already sent toward LEAF1." : "Idle — waiting for the lesson to send a frame toward HOST-B.",
      packetAfter: `Ethernet[${HOST_A_MAC} → ${HOST_B_MAC}]`,
    };
  }

  if (nodeId === "HOST-B") {
    const delivered = state.journey.some((h) => h.device === "LEAF2" && h.action === "DECAP");
    return {
      ...base,
      controlPlaneRole: "Outside VXLAN and BGP EVPN entirely.",
      dataPlaneRole: "Receives the exposed inner Ethernet frame from LEAF2 — identical to what HOST-A sent.",
      currentAction: delivered ? "Delivered — HOST-B has received the frame, VXLAN headers fully stripped." : "Idle — waiting for LEAF2 to deliver the frame.",
      packetBefore: delivered ? `Ethernet[${HOST_A_MAC} → ${HOST_B_MAC}] (from LEAF2)` : undefined,
    };
  }

  if (nodeId === "LEAF1") {
    const tables = [macTableInfo(state, "LEAF1"), evpnRouteInfo(state, "LEAF1")].filter((t): t is NonNullable<typeof t> => !!t);
    let currentAction = "Idle — waiting for a frame from HOST-A.";
    if (isCurrentActor && hop) currentAction = `Right now: ${hop.lookup} → ${hop.action}.`;
    else if (alreadyActed && hop) currentAction = `Already done: ${hop.lookup} → ${hop.action}. Result: ${hop.output}.`;
    else if (state.received.LEAF1?.imported) currentAction = "Remote MAC for HOST-B already installed via EVPN — ready to encapsulate the next frame.";
    return {
      ...base,
      controlPlaneRole: "Peers with LEAF2 over BGP EVPN; receives Type 2 (MAC/IP) routes and checks RT before installing them.",
      dataPlaneRole: `VLAN ${10} → VNI ${VNI} mapping, remote-VTEP resolution, VXLAN encapsulation toward whichever VTEP owns the destination MAC.`,
      currentAction,
      packetBefore: hop?.input,
      packetAfter: hop?.output,
      tables,
    };
  }

  if (nodeId === "SPINE1") {
    let currentAction = "Idle — waiting for an underlay IP packet.";
    if (isCurrentActor && hop) currentAction = `Right now: ${hop.lookup} → ${hop.action}.`;
    else if (alreadyActed && hop) currentAction = `Already done: ${hop.lookup} → ${hop.action}. Result: ${hop.output}.`;
    return {
      ...base,
      controlPlaneRole: "No VXLAN, no BGP EVPN, no tenant MAC table at all — participates only in the underlay IGP.",
      dataPlaneRole: "Forwards strictly on the outer (underlay) destination IP — the VTEP loopback, never the inner frame.",
      currentAction,
      packetBefore: hop?.input,
      packetAfter: hop?.output,
      note: "SPINE1 never inspects the VXLAN header or the inner Ethernet frame for this forwarding decision — both ride along unread.",
    };
  }

  // LEAF2
  const tables = [macTableInfo(state, "LEAF2"), evpnRouteInfo(state, "LEAF2")].filter((t): t is NonNullable<typeof t> => !!t);
  let currentAction = "Idle — HOST-B is locally attached, nothing advertised yet.";
  if (isCurrentActor && hop) currentAction = `Right now: ${hop.lookup} → ${hop.action}.`;
  else if (alreadyActed && hop) currentAction = `Already done: ${hop.lookup} → ${hop.action}. Result: ${hop.output}.`;
  else if (state.evpnRoute) currentAction = `Control plane complete — advertised MAC ${state.evpnRoute.mac} / IP ${state.evpnRoute.ip} (RT ${state.evpnRoute.rt}) to LEAF1. Will decapsulate and deliver inbound VXLAN traffic for HOST-B.`;
  return {
    ...base,
    controlPlaneRole: "Learns HOST-B locally, builds an EVPN Type 2 route (RD for uniqueness, RT for import policy, next-hop = its own VTEP), advertises it to LEAF1.",
    dataPlaneRole: "VXLAN decapsulation, VNI → VLAN lookup, delivers the original inner frame out HOST-B's access port.",
    currentAction,
    packetBefore: hop?.input,
    packetAfter: hop?.output,
    tables,
  };
}

export { EVPN_EXPORT_RT, HOST_A_IP, HOST_B_IP };
