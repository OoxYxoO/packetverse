import type { NodeExplanation } from "@/components/network3d/types";
import { ESI, VPWS_SERVICE_ID, pbRoleFor, type EvpnVpwsDeviceId, type EvpnVpwsState, type PeId } from "@/lib/sim-engine/scenarios/evpnVpws";

const DEVICE_TYPE: Record<EvpnVpwsDeviceId, string> = { "CE-A": "Dual-Homed Customer Edge", PE1: "Provider Edge (ES Member)", PE2: "Provider Edge (ES Member)", CORE: "MPLS/IP Provider Core", PE3: "Provider Edge (Remote Endpoint)", "CE-B": "Single-Homed Customer Edge" };

/** Index of the device's newest hop — the journey accumulates every direction, so the first match is stale history. */
function lastHopIndex(state: EvpnVpwsState, nodeId: EvpnVpwsDeviceId): number {
  for (let i = state.journey.length - 1; i >= 0; i--) if (state.journey[i].device === nodeId) return i;
  return -1;
}

export function explainNode(state: EvpnVpwsState, nodeId: EvpnVpwsDeviceId): NodeExplanation {
  const journeyIndex = lastHopIndex(state, nodeId);
  const isCurrentActor = journeyIndex !== -1 && journeyIndex === state.journey.length - 1;
  const alreadyActed = journeyIndex !== -1 && !isCurrentActor;
  const hop = journeyIndex !== -1 ? state.journey[journeyIndex] : undefined;
  const base: NodeExplanation = { id: nodeId, name: nodeId, deviceType: DEVICE_TYPE[nodeId], role: nodeId, currentAction: "" };

  if (nodeId === "CE-A") {
    return { ...base, controlPlaneRole: "Outside BGP EVPN entirely — CE-A never runs EVPN. It's simply dual-attached.", dataPlaneRole: "Sends and receives ordinary customer Ethernet frames over whichever attachment is currently Primary.", currentAction: `Dual-homed to PE1 and PE2 (ESI ${ESI.slice(-8)}).` };
  }
  if (nodeId === "CE-B") {
    return { ...base, controlPlaneRole: "Outside this lesson's EVPN control plane entirely — single-homed to PE3.", dataPlaneRole: "Sends and receives ordinary customer Ethernet frames over its one attachment.", currentAction: "Idle." };
  }
  if (nodeId === "CORE") {
    let currentAction = "Idle.";
    if (isCurrentActor && hop) currentAction = `Right now: ${hop.lookup} → ${hop.action}.`;
    else if (alreadyActed && hop) currentAction = `Already done: ${hop.lookup} → ${hop.action}.`;
    return { ...base, controlPlaneRole: "No ESI, no VPWS service awareness, no Primary/Backup state at all.", dataPlaneRole: "Forwards strictly on the top transport label — never inspects the VPWS service label or customer MACs, and never selects a VPWS AC.", currentAction, packetBefore: hop?.input, packetAfter: hop?.output, note: "VPWS service lookup is entirely a PE concern — the core only ever swaps the transport label." };
  }

  if (nodeId === "PE3") {
    let currentAction = "Idle.";
    if (isCurrentActor && hop) currentAction = `Right now: ${hop.lookup} → ${hop.action}.`;
    else if (alreadyActed && hop) currentAction = `Already done: ${hop.lookup} → ${hop.action}.`;
    return {
      ...base,
      controlPlaneRole: `Advertises its own A-D per-EVI route as VPWS-${VPWS_SERVICE_ID}'s remote endpoint; discovers whichever CE-A-side PE is currently Primary.`,
      dataPlaneRole: "Reads the VPWS service label, identifies VPWS-500 and CE-B's AC, and forwards the customer frame — no destination-MAC lookup selects the remote site, because there is exactly one remote endpoint per service.",
      currentAction,
      packetBefore: hop?.input,
      packetAfter: hop?.output,
      note: state.mtuFault ? "PE3's expected L2 MTU does not match the Primary's advertised L2 MTU — the remote endpoint exists but is not usable until this is corrected." : undefined,
    };
  }

  // PE1 / PE2
  const pe = nodeId as PeId;
  const failed = pe === "PE1" && state.pe1AcFailed;
  const role = pbRoleFor(state.election, pe);
  let currentAction = "Idle.";
  if (isCurrentActor && hop) currentAction = `Right now: ${hop.lookup} → ${hop.action}.`;
  else if (alreadyActed && hop) currentAction = `Already done: ${hop.lookup} → ${hop.action}.`;
  else if (failed) currentAction = "Attachment Circuit to CE-A is down. Device, underlay, BGP EVPN, and transport all remain healthy.";
  else if (role === "primary") currentAction = `Primary for ESI ${ESI.slice(-8)} / VPWS-${VPWS_SERVICE_ID}. Forwards customer traffic for this service.`;
  else if (role === "backup") currentAction = `Backup for ESI ${ESI.slice(-8)} / VPWS-${VPWS_SERVICE_ID}. Healthy and ready — not currently forwarding this service's traffic.`;
  return {
    ...base,
    controlPlaneRole: `Attached to ESI ${ESI.slice(-8)}; advertises Ethernet A-D per-EVI for VPWS-${VPWS_SERVICE_ID}; participates in Single-Active election for this ES.`,
    dataPlaneRole: failed ? "Cannot deliver customer traffic to/from CE-A — its Attachment Circuit is down." : role === "primary" ? "Pushes the VPWS service label and transport label, then forwards toward the core." : "Backup — does not forward this service's traffic while healthy and Primary is available.",
    currentAction,
    packetBefore: hop?.input,
    packetAfter: hop?.output,
    tables: [{ title: `${pe} — Single-Active`, rows: [{ label: "ESI", value: ESI }, { label: "Role", value: failed ? "Unavailable" : role === "not-elected" ? "Not elected" : role.toUpperCase() }] }],
  };
}

export { ESI, VPWS_SERVICE_ID };
