import type { NodeExplanation } from "@/components/network3d/types";
import { INFRA_ADDRESS_TEXT, PROTECTED_LINK, PROTECTED_NODE, type RouterId, type Srv6TiLfaState } from "@/lib/sim-engine/scenarios/srv6TiLfa";

/**
 * All SRv6-TI-LFA-specific reasoning for the 3D node inspector lives
 * here (ARCHITECTURE.md §4) — never inside network3d/*. Tense is
 * derived from `state.journey`, exactly like every other lesson.
 */

const DEVICE_TYPE: Record<RouterId, string> = { PE1: "PE Router", P1: "P Router (PLR)", P2: "P Router (Protected)", P3: "P Router (Repair OIF)", P4: "P Router (Repair Node)", PE2: "PE Router (Destination)" };
const ROLE: Record<RouterId, string> = { PE1: "Headend", P1: "Point of Local Repair", P2: "Protected Resource", P3: "Repair Outgoing Interface", P4: "Repair Node (End.X+USD)", PE2: "Destination" };

export function explainNode(state: Srv6TiLfaState, nodeId: RouterId): NodeExplanation {
  const journeyIndex = state.journey.findIndex((h) => h.router === nodeId);
  const isCurrentActor = journeyIndex !== -1 && journeyIndex === state.journey.length - 1;
  const alreadyActed = journeyIndex !== -1 && !isCurrentActor;
  const hop = journeyIndex !== -1 ? state.journey[journeyIndex] : undefined;

  const base: NodeExplanation = { id: nodeId, name: nodeId, deviceType: DEVICE_TYPE[nodeId], role: ROLE[nodeId], currentAction: "" };

  if (nodeId === "PE1") {
    return { ...base, controlPlaneRole: "Ordinary headend — has no idea a repair even exists.", dataPlaneRole: "Originates the plain infrastructure IPv6 packet toward PE2.", currentAction: hop ? `Already sent: ${hop.output}` : "Idle." };
  }

  if (nodeId === "P1") {
    const repair = state.linkRepair;
    let currentAction = "Idle — primary path PE1→P1→P2→PE2 is healthy; a repair is precomputed but carries nothing.";
    if (isCurrentActor && hop) currentAction = `Right now: ${hop.lookup} → ${hop.action}.`;
    else if (alreadyActed && hop) currentAction = `Already done: ${hop.lookup} → ${hop.action}.`;
    return {
      ...base,
      controlPlaneRole: `Precomputes P-Space/extended P-Space/Q-Space and a repair path (OIF + repair list) for ${PROTECTED_LINK} — before any failure.`,
      dataPlaneRole: "On failure: detects locally, then H.Encaps-wraps protected traffic with the precomputed repair outer. Never recomputes from scratch at failure time.",
      currentAction,
      packetBefore: hop?.input,
      packetAfter: hop?.output,
      tables: repair ? [{ title: "P1 — TI-LFA Repair (Link)", rows: [{ label: "Protected", value: repair.protectedResource }, { label: "Repair node", value: repair.repairNode ?? "none" }, { label: "Merge target", value: repair.mergeTarget ?? "none" }, { label: "Outgoing interface", value: `P1→${repair.outgoingInterface ?? "?"}` }] }] : undefined,
    };
  }

  if (nodeId === "P3" || nodeId === "P2") {
    let currentAction = "Idle — waiting for a packet whose outer destination falls inside a known locator.";
    if (isCurrentActor && hop) currentAction = `Right now: ${hop.lookup} → ${hop.action}.`;
    else if (alreadyActed && hop) currentAction = `Already done: ${hop.lookup} → ${hop.action}.`;
    return {
      ...base,
      controlPlaneRole: "No TI-LFA computation of its own — participates only in the ordinary IPv6 IGP.",
      dataPlaneRole: nodeId === "P3" ? "Forwards purely on the outer IPv6 destination — has no idea a repair is in progress." : `${PROTECTED_LINK === "P1-P2" ? "The protected resource itself (for link protection) — otherwise completely healthy." : ""} Forwards ordinary IPv6 traffic toward PE2.`,
      currentAction,
      packetBefore: hop?.input,
      packetAfter: hop?.output,
      note: nodeId === "P3" ? "P3 never learns about the failure or the repair from the packet itself — it just does ordinary forwarding, which is exactly why the repair SID must be globally routed." : undefined,
    };
  }

  if (nodeId === "P4") {
    let currentAction = "Idle — holds a globally-routed End.X+USD SID, unused until a repair activates.";
    if (isCurrentActor && hop) currentAction = `Right now: ${hop.lookup} → ${hop.action}.`;
    else if (alreadyActed && hop) currentAction = `Already done: ${hop.lookup} → ${hop.action}.`;
    return {
      ...base,
      controlPlaneRole: "Owns a globally-routed End.X SID with the USD flavor, bound to a specific adjacency (P2 for link protection, PE2 for node protection).",
      dataPlaneRole: "On a repair packet: matches its local SID, removes the repair outer entirely (USD), then forces the exposed packet to the bound adjacency — never executing any VPN-layer behavior merely because it handled TI-LFA.",
      currentAction,
      packetBefore: hop?.input,
      packetAfter: hop?.output,
      note: `P4 does not know it is the destination's neighbor via link protection vs. node protection — it simply executes whichever adjacency the currently-active repair SID specifies (${PROTECTED_NODE === "P2" ? "P2 or PE2 depending on the active lab" : ""}).`,
    };
  }

  // PE2
  let currentAction = "Idle — waiting to receive.";
  if (isCurrentActor && hop) currentAction = `Right now: ${hop.lookup} → ${hop.action}.`;
  else if (alreadyActed && hop) currentAction = `Already done: ${hop.lookup} → ${hop.action}.`;
  return { ...base, controlPlaneRole: "Ordinary destination — has no idea any repair ever happened.", dataPlaneRole: "Receives the original, unmodified packet exactly as PE1 sent it.", currentAction, packetBefore: hop?.input, packetAfter: hop?.output, tables: [{ title: "PE2 — Identity", rows: [{ label: "Infra address", value: INFRA_ADDRESS_TEXT.PE2 }] }] };
}
