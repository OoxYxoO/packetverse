import type { NodeExplanation } from "@/components/network3d/types";
import { ESI, SERVER_A_IP, SERVER_A_MAC, VTEP_LOOPBACK, dfRoleFor, type EvpnMultihomingDeviceId, type EvpnMultihomingState } from "@/lib/sim-engine/scenarios/evpnMultihoming";

const DEVICE_TYPE: Record<EvpnMultihomingDeviceId, string> = { "SERVER-A": "Dual-Homed End Host", LEAF1: "Leaf Switch (VTEP, ES Member)", SPINE1: "Spine Switch", LEAF2: "Leaf Switch (VTEP, ES Member)", LEAF3: "Leaf Switch (VTEP)", "HOST-B": "End Host" };

export function explainNode(state: EvpnMultihomingState, nodeId: EvpnMultihomingDeviceId): NodeExplanation {
  const journeyIndex = state.journey.findIndex((h) => h.device === nodeId);
  const isCurrentActor = journeyIndex !== -1 && journeyIndex === state.journey.length - 1;
  const alreadyActed = journeyIndex !== -1 && !isCurrentActor;
  const hop = journeyIndex !== -1 ? state.journey[journeyIndex] : undefined;
  const base: NodeExplanation = { id: nodeId, name: nodeId, deviceType: DEVICE_TYPE[nodeId], role: nodeId, currentAction: "" };

  if (nodeId === "SERVER-A") {
    return { ...base, controlPlaneRole: "Outside BGP EVPN entirely — SERVER-A itself never runs EVPN. It's simply dual-attached.", dataPlaneRole: "Sends and receives ordinary Ethernet frames over whichever of its two links is currently up.", currentAction: `Dual-homed to LEAF1 and LEAF2 (ESI ${ESI.slice(-8)}) — MAC ${SERVER_A_MAC}, IP ${SERVER_A_IP}.` };
  }
  if (nodeId === "HOST-B") {
    return { ...base, controlPlaneRole: "Outside this lesson's multihoming story — single-homed, exactly like every earlier lesson's hosts.", dataPlaneRole: "Sends a broadcast without any idea SERVER-A is multihomed at all.", currentAction: "Idle." };
  }
  if (nodeId === "SPINE1") {
    let currentAction = "Idle.";
    if (isCurrentActor && hop) currentAction = `Right now: ${hop.lookup} → ${hop.action}.`;
    else if (alreadyActed && hop) currentAction = `Already done: ${hop.lookup} → ${hop.action}.`;
    return { ...base, controlPlaneRole: "No ESI, no DF election, no BGP EVPN participation at all.", dataPlaneRole: "Forwards strictly on the outer underlay destination IP — DF election decisions never happen here.", currentAction, packetBefore: hop?.input, packetAfter: hop?.output, note: "DF election is entirely a leaf/VTEP concern — the spine has no idea an Ethernet Segment exists." };
  }
  if (nodeId === "LEAF3") {
    let currentAction = "Idle.";
    if (isCurrentActor && hop) currentAction = `Right now: ${hop.lookup} → ${hop.action}.`;
    else if (alreadyActed && hop) currentAction = `Already done: ${hop.lookup} → ${hop.action}.`;
    return { ...base, controlPlaneRole: "Not part of ESI " + ESI.slice(-8) + " at all — simpler role, no ES/DF state to track.", dataPlaneRole: "Replicates BUM traffic toward every remote VTEP in the VNI's flood list, exactly as the BUM lesson taught — completely unaware which of them is DF.", currentAction, packetBefore: hop?.input, packetAfter: hop?.output };
  }

  // LEAF1 / LEAF2
  const leaf = nodeId as "LEAF1" | "LEAF2";
  const failed = leaf === "LEAF1" && state.leaf1Failed;
  const role = dfRoleFor(state.dfState, leaf);
  let currentAction = "Idle.";
  if (isCurrentActor && hop) currentAction = `Right now: ${hop.lookup} → ${hop.action}.`;
  else if (alreadyActed && hop) currentAction = `Already done: ${hop.lookup} → ${hop.action}.`;
  else if (failed) currentAction = "Ethernet-Segment attachment unavailable — excluded from the current DF candidate set.";
  else if (role === "df") currentAction = `DF for ESI ${ESI.slice(-8)} / ${state.dfState.evi}. Forwards BUM toward the ES.`;
  else if (role === "ndf") currentAction = `NDF for ESI ${ESI.slice(-8)} / ${state.dfState.evi}. Suppresses BUM duplicates toward the ES — still forwards ordinary unicast normally.`;
  return {
    ...base,
    controlPlaneRole: `Attached to ESI ${ESI.slice(-8)}; advertises Type 4 (ES) and Type 1 (Ethernet A-D) routes; participates in DF election for this ESI/EVI.`,
    dataPlaneRole:
      role === "df"
        ? "Forwards BUM traffic onto the Ethernet Segment; also forwards ordinary unicast, All-Active."
        : role === "ndf"
          ? "Suppresses BUM duplicates toward the Ethernet Segment; still forwards ordinary unicast normally — NDF never means inactive for unicast."
          : "DF role not yet elected for this ESI/EVI — no BUM forwarding decision has been made yet.",
    currentAction,
    packetBefore: hop?.input,
    packetAfter: hop?.output,
    note: state.dualDfFault && !failed ? `${leaf} currently believes it is DF — but so does the other ES member. This is an injected control-plane inconsistency.` : undefined,
    tables: [{ title: `${leaf} — Ethernet Segment`, rows: [{ label: "ESI", value: ESI }, { label: "VTEP", value: VTEP_LOOPBACK[leaf] }, { label: "Role", value: failed ? "Unavailable" : role === "df" ? "DF" : role === "ndf" ? "NDF" : "Not elected" }] }],
  };
}

export { ESI, SERVER_A_IP, SERVER_A_MAC, VTEP_LOOPBACK };
