import type { NodeExplanation } from "@/components/network3d/types";
import { ESI, SERVER_A_IP, SERVER_A_MAC, VTEP_LOOPBACK, type EvpnAliasingDeviceId, type EvpnAliasingState } from "@/lib/sim-engine/scenarios/evpnAliasingMassWithdrawal";

const DEVICE_TYPE: Record<EvpnAliasingDeviceId, string> = { "SERVER-A": "Dual-Homed End Host", LEAF1: "Leaf Switch (VTEP, ES Member)", SPINE1: "Spine Switch", LEAF2: "Leaf Switch (VTEP, ES Member)", LEAF3: "Leaf Switch (VTEP)", "HOST-B": "End Host" };

export function explainNode(state: EvpnAliasingState, nodeId: EvpnAliasingDeviceId): NodeExplanation {
  const journeyIndex = state.journey.findIndex((h) => h.device === nodeId);
  const isCurrentActor = journeyIndex !== -1 && journeyIndex === state.journey.length - 1;
  const alreadyActed = journeyIndex !== -1 && !isCurrentActor;
  const hop = journeyIndex !== -1 ? state.journey[journeyIndex] : undefined;
  const base: NodeExplanation = { id: nodeId, name: nodeId, deviceType: DEVICE_TYPE[nodeId], role: nodeId, currentAction: "" };

  if (nodeId === "SERVER-A") {
    return { ...base, controlPlaneRole: "Outside BGP EVPN entirely — SERVER-A never runs EVPN. It's simply dual-attached.", dataPlaneRole: "Receives known-unicast traffic over whichever eligible PE a given flow happened to use.", currentAction: `Dual-homed to LEAF1 and LEAF2 (ESI ${ESI.slice(-8)}) — MAC ${SERVER_A_MAC}, IP ${SERVER_A_IP}.` };
  }
  if (nodeId === "HOST-B") {
    return { ...base, controlPlaneRole: "Outside this lesson's EVPN control plane entirely.", dataPlaneRole: "Sends ordinary known-unicast flows toward SERVER-A, with no idea it is multihomed.", currentAction: "Idle." };
  }
  if (nodeId === "SPINE1") {
    let currentAction = "Idle.";
    if (isCurrentActor && hop) currentAction = `Right now: ${hop.lookup} → ${hop.action}.`;
    else if (alreadyActed && hop) currentAction = `Already done: ${hop.lookup} → ${hop.action}.`;
    return { ...base, controlPlaneRole: "No ESI, no aliasing, no mass-withdrawal awareness at all.", dataPlaneRole: "Forwards strictly on the outer underlay destination IP.", currentAction, packetBefore: hop?.input, packetAfter: hop?.output, note: "Aliasing and mass-withdrawal decisions are entirely a leaf/VTEP concern — the spine never makes them." };
  }
  if (nodeId === "LEAF3") {
    let currentAction = "Idle.";
    if (isCurrentActor && hop) currentAction = `Right now: ${hop.lookup} → ${hop.action}.`;
    else if (alreadyActed && hop) currentAction = `Already done: ${hop.lookup} → ${hop.action}.`;
    return {
      ...base,
      controlPlaneRole: "Not part of ESI " + ESI.slice(-8) + " — builds its aliasing set purely from Type-2 + A-D per-EVI routes received from LEAF1 and LEAF2.",
      dataPlaneRole: "Selects one eligible next hop per flow toward SERVER-A — a deterministic flow abstraction, never per-packet round robin.",
      currentAction,
      packetBefore: hop?.input,
      packetAfter: hop?.output,
      note: state.staleAliasingFault ? "LEAF3's aliasing set has not been recomputed since LEAF1's A-D per-ES withdrawal arrived — this is an injected processing fault, not normal EVPN behavior." : undefined,
      tables: state.aliasing ? [{ title: "LEAF3 — Aliasing Set", rows: [{ label: "Destination", value: state.aliasing.mac }, { label: "ESI", value: ESI }, { label: "Eligible PEs", value: state.aliasing.eligiblePEs.join(", ") || "(none)" }] }] : undefined,
    };
  }

  const leaf = nodeId as "LEAF1" | "LEAF2";
  const failed = leaf === "LEAF1" && state.esAttachmentFailed;
  const eligible = state.aliasing?.eligiblePEs.includes(leaf) ?? true;
  let currentAction = "Idle.";
  if (isCurrentActor && hop) currentAction = `Right now: ${hop.lookup} → ${hop.action}.`;
  else if (alreadyActed && hop) currentAction = `Already done: ${hop.lookup} → ${hop.action}.`;
  else if (failed) currentAction = "ES-facing attachment to SERVER-A is down. Device, underlay, BGP EVPN, and VTEP reachability all remain healthy.";
  else currentAction = `Attached to ESI ${ESI.slice(-8)}; advertises A-D per-EVI and A-D per-ES. ${eligible ? "Currently an eligible known-unicast next hop." : "No longer an eligible next hop — pruned by Mass Withdrawal."}`;
  return {
    ...base,
    controlPlaneRole: `Advertises A-D per-EVI (aliasing) and A-D per-ES (fast-failure signaling) for ESI ${ESI.slice(-8)} — does not re-run DF election here (see the Multihoming lesson).`,
    dataPlaneRole: failed ? "Cannot deliver known-unicast traffic to SERVER-A — its local ES attachment is down." : "Decapsulates VXLAN and delivers directly to SERVER-A for any flow that selects it — no DF status check is involved in known-unicast delivery.",
    currentAction,
    packetBefore: hop?.input,
    packetAfter: hop?.output,
    tables: [{ title: `${leaf} — Ethernet Segment`, rows: [{ label: "ESI", value: ESI }, { label: "VTEP", value: VTEP_LOOPBACK[leaf] }, { label: "Local ES Attachment", value: failed ? "DOWN" : "Up" }, { label: "A-D Per-ES", value: state.perEsAdRoutes[leaf]?.withdrawn ? "WITHDRAWN" : "Advertised" }] }],
  };
}

export { ESI, SERVER_A_IP, SERVER_A_MAC, VTEP_LOOPBACK };
