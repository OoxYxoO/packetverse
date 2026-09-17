import type { NodeExplanation } from "@/components/network3d/types";
import { CUST_A_RD, INFRA_LOOPBACK, LOCATOR_PREFIX, PE1_DT4_SID, PE1_DT6_SID, PE2_DT4_SID, PE2_DT6_SID, type RouterId, type Srv6L3vpnState } from "@/lib/sim-engine/scenarios/srv6L3vpn";

/**
 * All SRv6-L3VPN-specific reasoning for the 3D node inspector lives
 * here (ARCHITECTURE.md §4) — never inside network3d/*. Tense is
 * derived from `state.journey`, exactly like every other lesson's
 * explain.ts, so Previous/goTo/Restart stay correct automatically.
 */

const DEVICE_TYPE: Record<RouterId, string> = {
  CE1: "CE Router",
  PE1: "PE Router",
  P1: "P Router (Core)",
  P2: "P Router (Core)",
  PE2: "PE Router",
  CE2: "CE Router",
  CE3: "CE Router",
};
const ROLE: Record<RouterId, string> = {
  CE1: "Customer Edge — Site 1",
  PE1: "Ingress/Egress PE",
  P1: "IPv6/SRv6 Transit",
  P2: "IPv6/SRv6 Transit",
  PE2: "Ingress/Egress PE",
  CE2: "Customer Edge — Site 2",
  CE3: "Customer Edge — Site 3",
};

function vrfTable(state: Srv6L3vpnState, router: RouterId) {
  const local = state.localRoutes[router];
  const installed = state.installedAt[router];
  if (!local && !installed) return undefined;
  const rows = [
    ...(local ?? []).map((r) => ({ label: `${r.prefix} (local, via ${r.ce})`, value: r.family })),
    ...(installed ?? []).map((p) => ({ label: `${p.route.prefix} (${p.route.originPe})`, value: p.installed ? `installed via ${p.route.prefixSid?.l3Service.serviceSid.sidText}` : "not installed" })),
  ];
  return { title: `${router} — VRF CUST-A`, rows };
}

function serviceSidTable(router: RouterId) {
  if (router === "PE1") return { title: "PE1 — Local Service SIDs", rows: [{ label: PE1_DT4_SID.sidText, value: "End.DT4 · CUST-A" }, { label: PE1_DT6_SID.sidText, value: "End.DT6 · CUST-A" }] };
  if (router === "PE2") return { title: "PE2 — Local Service SIDs", rows: [{ label: PE2_DT4_SID.sidText, value: "End.DT4 · CUST-A" }, { label: PE2_DT6_SID.sidText, value: "End.DT6 · CUST-A" }] };
  return undefined;
}

export function explainNode(state: Srv6L3vpnState, nodeId: RouterId): NodeExplanation {
  const journeyIndex = state.journey.findIndex((h) => h.router === nodeId);
  const isCurrentActor = journeyIndex !== -1 && journeyIndex === state.journey.length - 1;
  const alreadyActed = journeyIndex !== -1 && !isCurrentActor;
  const hop = journeyIndex !== -1 ? state.journey[journeyIndex] : undefined;

  const base: NodeExplanation = { id: nodeId, name: nodeId, deviceType: DEVICE_TYPE[nodeId], role: ROLE[nodeId], currentAction: "" };

  if (nodeId === "CE1" || nodeId === "CE2" || nodeId === "CE3") {
    const delivered = state.journey.some((h) => h.router === (nodeId === "CE1" ? "PE1" : "PE2") && h.output.includes(nodeId));
    return {
      ...base,
      controlPlaneRole: "Outside the provider's MP-BGP/SRv6 control plane — CE-PE routing isn't this lesson's focus.",
      dataPlaneRole: nodeId === "CE1" ? "Originates plain customer IPv4/IPv6 packets. Never sees an outer IPv6 header, a Service SID, or an SRH." : "Receives the exposed customer packet from PE2. The entire SRv6 VPN domain is invisible to it.",
      currentAction: delivered ? "Delivered." : nodeId === "CE1" ? "Idle — waiting to send." : "Idle — waiting to receive.",
      packetBefore: hop?.input,
      packetAfter: hop?.output,
    };
  }

  if (nodeId === "PE1" || nodeId === "PE2") {
    const tables = [vrfTable(state, nodeId), serviceSidTable(nodeId)].filter((t): t is NonNullable<typeof t> => !!t);
    let currentAction = `Idle — VRF CUST-A holds only ${nodeId}'s own local routes so far.`;
    if (isCurrentActor && hop) currentAction = `Right now: ${hop.lookup} → ${hop.action}.`;
    else if (alreadyActed && hop) currentAction = `Already done: ${hop.lookup} → ${hop.action}. Result: ${hop.output}.`;
    const locatorWithdrawn = state.locatorWithdrawn[nodeId];
    const note = locatorWithdrawn ? `${nodeId}'s SRv6 locator (${LOCATOR_PREFIX[nodeId]}) is currently WITHDRAWN — its BGP infrastructure loopback (${INFRA_LOOPBACK[nodeId]}) is still reachable, but its Service SIDs cannot be resolved by remote PEs right now.` : undefined;
    return {
      ...base,
      controlPlaneRole: `Holds VRF CUST-A (RD ${CUST_A_RD[nodeId]}); advertises its own per-VRF Service SIDs via the BGP Prefix-SID Attribute's SRv6 L3 Service TLV, and imports the other PE's routes by RT.`,
      dataPlaneRole: "Ingress: VRF lookup selects a remote Service SID, then SRv6-encapsulates (no VPN label, usually no SRH). Egress: local SID match executes End.DT4/End.DT6, then a real VRF lookup on the exposed payload.",
      currentAction,
      packetBefore: hop?.input,
      packetAfter: hop?.output,
      tables,
      note,
    };
  }

  // P1 / P2
  let currentAction = "Idle — waiting for an IPv6 packet whose destination falls inside a known PE locator.";
  if (isCurrentActor && hop) currentAction = `Right now: ${hop.lookup} → ${hop.action}.`;
  else if (alreadyActed && hop) currentAction = `Already done: ${hop.lookup} → ${hop.action}. Result: ${hop.output}.`;
  return {
    ...base,
    controlPlaneRole: "No VRF, no customer routes, no MP-BGP session, no Service SID table. Participates only in the provider's own IPv6 IGP.",
    dataPlaneRole: "Plain IPv6 FIB forwarding on the outer destination address only.",
    currentAction,
    packetBefore: hop?.input,
    packetAfter: hop?.output,
    note: `${nodeId} never inspects the Service SID's meaning, the SRH (if any), or the inner customer payload — it forwards purely on the outer IPv6 destination.`,
  };
}
