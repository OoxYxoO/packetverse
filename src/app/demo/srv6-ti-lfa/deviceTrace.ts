import type { DeviceInterfaceData, DeviceProcessingTrace, LinkDetail, PacketMutation, PacketStackFrame, ProcessingStage } from "@/components/network3d/types";
import type { PacketVisual } from "@/lib/sim-engine/types";
import { fmtIpv6 } from "@/lib/sim-engine/scenarios/srv6Foundations";
import {
  computeExtendedPSpace,
  computePSpace,
  computePostConvergencePath,
  computeQSpace,
  DESTINATION,
  GRAPH_EDGES,
  INFRA_ADDRESS_TEXT,
  LINKS,
  PLR,
  PROTECTED_LINK,
  srv6TiLfaSteps,
  type RouterId,
  type Srv6TiLfaState,
  type TiLfaPacketState,
} from "@/lib/sim-engine/scenarios/srv6TiLfa";

/**
 * Scene Adapter for SRv6 TI-LFA's device-interior 3D view (ARCHITECTURE.md
 * §4). Every stage/lookup/interface/link-detail value below is derived
 * FROM Srv6TiLfaState — no P-Space/Q-Space/repair-node decision is made
 * here. Level 3 enrichment (lookupType/lookupKey/lookupResult/nextHopId/
 * nextHopLabel/reason/packetBeforeFrames/packetAfterFrames/mutations)
 * reshapes facts the scenario file already computed — P/Q-Space steps
 * re-call the SAME exported pure functions (`computePSpace`, etc.) with
 * the exact same inputs the scenario file itself would use, never a new
 * graph algorithm. Directional ingress/egress interfaces are derived
 * from the ACTUAL next-hop each branch already knows (never a static
 * `nbrs[0]`/`nbrs[1]` pick) — this matters here more than almost any
 * other lesson, since P1's real egress differs between primary (P2),
 * repair (P3), P3's real egress differs between ordinary transit (P4)
 * and its stale-FIB bounce (P1), and P4's real egress differs between
 * link protection (P2) and node protection (PE2).
 */

const stepIndex = (id: string) => srv6TiLfaSteps.findIndex((s) => s.id === id);

// ---------------------------------------------------------------------------
// Stage lists
// ---------------------------------------------------------------------------

const PE1_STAGES: ProcessingStage[] = [
  { id: "originate", label: "Originate Packet" },
  { id: "egress", label: "Egress Toward P1" },
];
const P1_STAGES: ProcessingStage[] = [
  { id: "ingress", label: "Ingress Interface" },
  { id: "primary-lookup", label: "Primary Next-Hop Lookup" },
  { id: "failure-check", label: "Protected Resource Check" },
  { id: "repair-lookup", label: "Precomputed Repair Lookup" },
  { id: "encapsulate", label: "H.Encaps Repair Outer" },
  { id: "egress", label: "Egress" },
];
const TRANSIT_STAGES: ProcessingStage[] = [
  { id: "ingress", label: "Ingress" },
  { id: "ipv6-fib", label: "Ordinary IPv6 FIB Lookup" },
  { id: "egress", label: "Egress" },
];
const REPAIR_NODE_STAGES: ProcessingStage[] = [
  { id: "ingress", label: "Ingress" },
  { id: "local-sid-match", label: "Local SID Match (End.X+USD)" },
  { id: "usd-decap", label: "USD: Remove Repair Outer" },
  { id: "forced-adjacency", label: "Forced Adjacency" },
  { id: "egress", label: "Egress" },
];
const DEST_STAGES: ProcessingStage[] = [
  { id: "ingress", label: "Ingress" },
  { id: "deliver", label: "Deliver / Local Segment" },
];
const DEST_VPN_STAGES: ProcessingStage[] = [
  { id: "ingress", label: "Ingress" },
  { id: "local-sid-match", label: "Local SID Match (End.DT4)" },
  { id: "service-decap", label: "Decapsulate + VRF Lookup" },
  { id: "deliver", label: "Deliver to CE" },
];

function allIds(stages: ProcessingStage[]) {
  return stages.map((s) => s.id);
}

// ---------------------------------------------------------------------------
// Physical interfaces — needed early so trace branches can derive REAL
// directional ingress/egress from an actual neighbor id.
// ---------------------------------------------------------------------------

interface IfaceDef {
  id: string;
  name: string;
  ip: string;
  neighborId: RouterId;
  neighborLabel: string;
  linkType: string;
  mtu: number;
  protocols: string[];
}
const INTERFACES: Record<RouterId, IfaceDef[]> = {
  PE1: [{ id: "PE1-p1", name: "ge-0/0/0", ip: INFRA_ADDRESS_TEXT.PE1, neighborId: "P1", neighborLabel: "P1", linkType: "Core (IPv6/SRv6)", mtu: 9192, protocols: ["IPv6 IGP"] }],
  P1: [
    { id: "P1-pe1", name: "xe-0/0/0", ip: INFRA_ADDRESS_TEXT.P1, neighborId: "PE1", neighborLabel: "PE1", linkType: "Core (IPv6/SRv6)", mtu: 9192, protocols: ["IPv6 IGP"] },
    { id: "P1-p2", name: "xe-0/1/0", ip: INFRA_ADDRESS_TEXT.P1, neighborId: "P2", neighborLabel: "P2", linkType: "Core (Primary, TI-LFA protected)", mtu: 9192, protocols: ["IPv6 IGP", "TI-LFA"] },
    { id: "P1-p3", name: "xe-0/2/0", ip: INFRA_ADDRESS_TEXT.P1, neighborId: "P3", neighborLabel: "P3", linkType: "Core (Repair OIF)", mtu: 9192, protocols: ["IPv6 IGP"] },
  ],
  P2: [
    { id: "P2-p1", name: "xe-0/0/0", ip: INFRA_ADDRESS_TEXT.P2, neighborId: "P1", neighborLabel: "P1", linkType: "Core (Primary, TI-LFA protected)", mtu: 9192, protocols: ["IPv6 IGP"] },
    { id: "P2-pe2", name: "xe-0/1/0", ip: INFRA_ADDRESS_TEXT.P2, neighborId: "PE2", neighborLabel: "PE2", linkType: "Core (IPv6/SRv6)", mtu: 9192, protocols: ["IPv6 IGP"] },
    { id: "P2-p4", name: "xe-0/2/0", ip: INFRA_ADDRESS_TEXT.P2, neighborId: "P4", neighborLabel: "P4", linkType: "Core (Merge Link)", mtu: 9192, protocols: ["IPv6 IGP"] },
  ],
  P3: [
    { id: "P3-p1", name: "xe-0/0/0", ip: INFRA_ADDRESS_TEXT.P3, neighborId: "P1", neighborLabel: "P1", linkType: "Core (Repair OIF)", mtu: 9192, protocols: ["IPv6 IGP"] },
    { id: "P3-p4", name: "xe-0/1/0", ip: INFRA_ADDRESS_TEXT.P3, neighborId: "P4", neighborLabel: "P4", linkType: "Core (IPv6/SRv6)", mtu: 9192, protocols: ["IPv6 IGP"] },
  ],
  P4: [
    { id: "P4-p3", name: "xe-0/0/0", ip: INFRA_ADDRESS_TEXT.P4, neighborId: "P3", neighborLabel: "P3", linkType: "Core (IPv6/SRv6)", mtu: 9192, protocols: ["IPv6 IGP", "SRv6"] },
    { id: "P4-p2", name: "xe-0/1/0", ip: INFRA_ADDRESS_TEXT.P4, neighborId: "P2", neighborLabel: "P2", linkType: "Core (Merge Link — link protection)", mtu: 9192, protocols: ["IPv6 IGP"] },
    { id: "P4-pe2", name: "xe-0/2/0", ip: INFRA_ADDRESS_TEXT.P4, neighborId: "PE2", neighborLabel: "PE2", linkType: "Core (Node-protection backup link)", mtu: 9192, protocols: ["IPv6 IGP"] },
  ],
  PE2: [{ id: "PE2-p2", name: "ge-0/0/0", ip: INFRA_ADDRESS_TEXT.PE2, neighborId: "P2", neighborLabel: "P2", linkType: "Core (IPv6/SRv6)", mtu: 9192, protocols: ["IPv6 IGP"] }],
};

function ifaceId(router: RouterId, neighbor: RouterId | undefined): string | undefined {
  if (!neighbor) return undefined;
  return INTERFACES[router].find((f) => f.neighborId === neighbor)?.id;
}

// ---------------------------------------------------------------------------
// Packet-stack framing — a deterministic reshape of `TiLfaPacketState`,
// never a new fact.
// ---------------------------------------------------------------------------

function framesFor(pkt: TiLfaPacketState | undefined, topChanged: boolean): PacketStackFrame[] | undefined {
  if (!pkt) return undefined;
  const frames: PacketStackFrame[] = [];
  if (pkt.repairOuter) frames.push({ id: "repair", text: `TI-LFA Repair Outer (DA=${fmtIpv6(pkt.repairOuter.daHextets)})`, tone: "transport", justChanged: topChanged });
  if (pkt.repairOuter?.srh) frames.push({ id: "repair-srh", text: `Repair SRH (SL=${pkt.repairOuter.srh.segmentsLeft})`, tone: "transport" });
  if (pkt.vpnOuter) frames.push({ id: "vpn", text: `SRv6 L3VPN Outer (DA=${pkt.vpnOuter.daText})`, tone: "vpn" });
  if (pkt.inner) frames.push({ id: "inner", text: pkt.inner.kind === "IPV4" ? "Inner IPv4" : pkt.inner.kind === "IPV6" ? "Inner IPv6" : "Inner Ethernet", tone: "ip" });
  return frames;
}
function plainFrame(text: string): PacketStackFrame[] {
  return [{ id: "plain", text, tone: "generic" }];
}
function mutationsFor(type: PacketMutation["type"], detail: string): PacketMutation[] {
  return [{ type, detail }];
}

const findEntry = (state: Srv6TiLfaState, router: RouterId) => {
  const hops = state.journey.filter((h) => h.router === router);
  return hops[hops.length - 1];
};

// ---------------------------------------------------------------------------
// PE1 — headend
// ---------------------------------------------------------------------------

function traceForPE1(state: Srv6TiLfaState, stepId: string): DeviceProcessingTrace {
  const base: DeviceProcessingTrace = { deviceId: "PE1", egressInterfaceId: ifaceId("PE1", "P1"), stages: PE1_STAGES, completedStageIds: [] };
  if (stepId === "baseline-packet-intro") {
    return {
      ...base,
      activeStageId: "egress",
      completedStageIds: ["originate"],
      packetBefore: "Plain infrastructure IPv6 packet",
      packetAfter: `[IPv6] PE1 → ${DESTINATION} — no SRH`,
      packetBeforeFrames: plainFrame("Not yet built"),
      packetAfterFrames: plainFrame(`IPv6, DA=${INFRA_ADDRESS_TEXT.PE2}`),
      lookupType: "Originate",
      lookupResult: `DA = ${INFRA_ADDRESS_TEXT.PE2}`,
      nextHopId: "P1",
      nextHopLabel: "P1",
      reason: "Ordinary headend — has no idea a repair even exists.",
    };
  }
  if (stepId === "l3vpn-integration-intro") {
    return {
      ...base,
      activeStageId: "egress",
      completedStageIds: ["originate"],
      packetBefore: "Customer IPv4 inside a pre-existing SRv6 L3VPN outer",
      packetAfter: "Unchanged — ordinary VPN traffic toward PE2 End.DT4",
      packetAfterFrames: framesFor(state.packet, false),
      lookupType: "Originate (Pre-Existing VPN Packet)",
      lookupResult: "Outer DA = PE2 End.DT4 Service SID",
      nextHopId: "P1",
      nextHopLabel: "P1",
      reason: "Reusing the SRv6 L3VPN packet concept from /demo/srv6-l3vpn — PE1 has no idea TI-LFA exists either.",
    };
  }
  return base;
}

// ---------------------------------------------------------------------------
// P1 — PLR
// ---------------------------------------------------------------------------

function traceForP1(state: Srv6TiLfaState, stepId: string): DeviceProcessingTrace {
  const base: DeviceProcessingTrace = { deviceId: "P1", ingressInterfaceId: ifaceId("P1", "PE1"), stages: P1_STAGES, completedStageIds: [] };

  if (stepId === "naive-fail-injected") {
    return { ...base, activeStageId: "failure-check", completedStageIds: ["ingress", "primary-lookup"], lookupType: "Local Interface-Down Detection", lookupKey: PROTECTED_LINK, lookupResult: "DOWN — detected locally", reason: "No IGP flooding required — P1 knows immediately from its own interface state." };
  }
  if (stepId === "naive-forward-p1-p3" || stepId === "naive-loop-p3-p1") {
    const hopIdx = stepId === "naive-forward-p1-p3" ? 0 : 2;
    const hop = state.naiveDemo?.hops[hopIdx];
    const nextHop = hop?.forwardedTo;
    return {
      ...base,
      egressInterfaceId: ifaceId("P1", nextHop),
      activeStageId: "primary-lookup",
      completedStageIds: ["ingress"],
      packetBefore: `IPv6, DA=${INFRA_ADDRESS_TEXT.PE2}`,
      packetAfter: `Forwarded to ${nextHop ?? "—"}, unmodified`,
      lookupType: "Primary Next-Hop Lookup (NO repair program in this demo)",
      lookupKey: `${DESTINATION} infra address`,
      lookupResult: `next hop ${nextHop ?? "—"} (P1's own recomputed post-failure route)`,
      nextHopId: nextHop,
      nextHopLabel: nextHop,
      reason: stepId === "naive-forward-p1-p3" ? "This demonstration has NO repair program — P1 just forwards the ORIGINAL packet using its own new next hop." : "SAME decision again — P1 has no memory of already trying this, and no repair program to consult instead. This is the loop.",
    };
  }
  if (stepId === "post-convergence-compute") {
    const post = computePostConvergencePath(state.links, PLR, DESTINATION, "LINK", PROTECTED_LINK);
    return { ...base, activeStageId: "primary-lookup", completedStageIds: ["ingress"], lookupType: "Post-Convergence SPF (computed)", lookupResult: post ? `${post.path.join(" → ")} (cost ${post.cost})` : "no path", reason: "Real SPF with the protected resource genuinely removed from the graph — never hardcoded." };
  }
  if (stepId === "p-space-compute") {
    const pSpace = computePSpace(state.links, PLR, "LINK", PROTECTED_LINK);
    return { ...base, activeStageId: "primary-lookup", completedStageIds: ["ingress"], lookupType: "P-Space Computation", lookupResult: pSpace.join(", ") || "(empty)", reason: "Nodes P1's OWN pre-convergence shortest path reaches without traversing the protected resource." };
  }
  if (stepId === "extended-p-space-compute") {
    const ext = computeExtendedPSpace(state.links, PLR, "LINK", PROTECTED_LINK);
    return { ...base, activeStageId: "primary-lookup", completedStageIds: ["ingress"], lookupType: "Extended P-Space Computation", lookupResult: ext.join(", ") || "(empty)", reason: "Widened via each ELIGIBLE neighbor of P1's own shortest-path tree." };
  }
  if (stepId === "q-space-compute") {
    const qSpace = computeQSpace(state.links, DESTINATION, "LINK", PROTECTED_LINK);
    return { ...base, activeStageId: "primary-lookup", completedStageIds: ["ingress"], lookupType: "Q-Space Computation (of the destination)", lookupResult: qSpace.join(", ") || "(empty)", reason: "Nodes whose OWN pre-convergence shortest path reaches PE2 without traversing the protected resource." };
  }
  if (stepId === "select-repair-node") {
    const r = state.linkRepair;
    return { ...base, activeStageId: "repair-lookup", completedStageIds: ["ingress", "primary-lookup", "failure-check"], lookupType: "Repair Node Selection", lookupResult: r ? `${r.repairNode} (last P-Space/extended-P-Space node on the post-convergence path)` : "—", reason: "Documented strategy: the very next node on that same path becomes the forced adjacency target." };
  }
  if (stepId === "repair-list-derive") {
    const r = state.linkRepair;
    const sid = r?.repairList.sids[0];
    return {
      ...base,
      egressInterfaceId: ifaceId("P1", r?.outgoingInterface),
      activeStageId: "repair-lookup",
      completedStageIds: ["ingress", "primary-lookup", "failure-check"],
      lookupType: "Repair List Derivation",
      lookupResult: sid ? `OIF P1→${r?.outgoingInterface}; SID ${sid.sidText} (${sid.behavior}+${sid.flavors.join(",")}) → adjacency ${sid.adjacency}` : "—",
      nextHopId: r?.outgoingInterface,
      nextHopLabel: r?.outgoingInterface,
      reason: "Outgoing interface needs no SID at all — ordinary IPv6 reachability toward P4's locator. Only the repair list needs a SID.",
    };
  }
  if (stepId === "protection-ready") {
    return { ...base, completedStageIds: ["ingress", "primary-lookup", "failure-check", "repair-lookup"], lookupType: "Protection State", lookupResult: "READY (precomputed, installed, carrying no traffic)", reason: "READY means precomputed, not active." };
  }
  if (stepId === "trigger-failure" || stepId === "p1-detects") {
    return { ...base, activeStageId: "failure-check", completedStageIds: ["ingress", "primary-lookup"], lookupType: "Local Interface-Down Detection", lookupKey: PROTECTED_LINK, lookupResult: "DOWN — detected locally", reason: "Protection was already precomputed before this failure happened." };
  }
  if (stepId === "p1-activates-repair") {
    return { ...base, activeStageId: "repair-lookup", completedStageIds: ["ingress", "primary-lookup", "failure-check"], lookupType: "Repair Activation", lookupResult: "Precomputed repair for P1-P2 now ACTIVE", reason: "No new computation happens here — the repair path was already derived." };
  }
  if (stepId === "p1-encaps-packet" || stepId === "wrong-repair-forwards" || stepId === "l3vpn-fail-and-repair") {
    const hop = findEntry(state, "P1");
    const r = state.linkRepair;
    const sid = r?.repairList.sids[0];
    const isWrong = stepId === "wrong-repair-forwards";
    return {
      ...base,
      egressInterfaceId: ifaceId("P1", r?.outgoingInterface),
      activeStageId: "encapsulate",
      completedStageIds: ["ingress", "primary-lookup", "failure-check", "repair-lookup"],
      packetBefore: stepId === "l3vpn-fail-and-repair" ? "SRv6 L3VPN packet (DA=PE2 End.DT4)" : `IPv6, DA=${INFRA_ADDRESS_TEXT.PE2}`,
      packetAfter: sid ? `Repair outer added — DA=${sid.sidText}` : "—",
      packetBeforeFrames: stepId === "l3vpn-fail-and-repair" ? plainFrame("SRv6 L3VPN outer, no repair yet") : plainFrame(`IPv6, DA=${INFRA_ADDRESS_TEXT.PE2}`),
      packetAfterFrames: framesFor(state.packet, true),
      lookupType: "H.Encaps (Repair Outer)",
      lookupKey: r?.outgoingInterface ? `OIF P1→${r.outgoingInterface}` : undefined,
      lookupResult: hop?.lookup ?? "—",
      nextHopId: r?.outgoingInterface,
      nextHopLabel: r?.outgoingInterface,
      mutations: sid ? mutationsFor("ENCAPSULATE", isWrong ? `WRONG repair outer added — DA = ${sid.sidText} (directly routed to ${sid.owner}, not the documented P4 End.X+USD adjacency)` : stepId === "l3vpn-fail-and-repair" ? `Repair outer wraps the ENTIRE existing SRv6 VPN packet — DA = ${sid.sidText}` : `Repair outer added — DA = ${sid.sidText} (P4 End.X+USD), no SRH`) : [],
      reason: isWrong ? "The installed repair SID is directly routed to P2 — it does not force a specific adjacency past P3's stale FIB." : "A single-SID repair needs no segment list — the DA alone carries it.",
    };
  }
  if (stepId === "wrong-repair-loop") {
    const hop = findEntry(state, "P1");
    return { ...base, egressInterfaceId: ifaceId("P1", "P3"), activeStageId: "encapsulate", completedStageIds: ["ingress", "primary-lookup", "failure-check", "repair-lookup"], lookupType: "Repair Re-Received", lookupResult: hop?.output ?? "Loop detected", reason: "Received again — same repair, same outcome. This comes from REAL forwarding state (P3's actual pre-convergence FIB), not a hardcoded fault flag." };
  }
  if (stepId === "igp-converging") {
    return { ...base, completedStageIds: ["ingress", "primary-lookup", "failure-check", "repair-lookup", "encapsulate"], lookupType: "IGP Convergence", lookupResult: "Still repairing — P1 itself has not yet reconverged", reason: "A separate, distributed process running on its own timeline." };
  }
  if (stepId === "plr-converged") {
    return { ...base, egressInterfaceId: ifaceId("P1", "P3"), completedStageIds: ["ingress", "primary-lookup", "failure-check", "repair-lookup", "encapsulate"], lookupType: "P1 Own Convergence", lookupResult: "Ordinary FIB toward PE2 now avoids P1-P2 directly", reason: "No repair encapsulation required any more." };
  }
  if (stepId === "repair-released") {
    return { ...base, egressInterfaceId: ifaceId("P1", "P3"), completedStageIds: ["ingress", "primary-lookup"], lookupType: "Repair Released", lookupResult: "Repair encapsulation state cleared", reason: "TI-LFA is temporary, not a permanent replacement for IGP convergence." };
  }
  if (stepId === "post-convergence-forwarding") {
    const hop = findEntry(state, "P1");
    return { ...base, egressInterfaceId: ifaceId("P1", "P3"), activeStageId: "primary-lookup", completedStageIds: ["ingress"], lookupType: "Ordinary Post-Convergence IPv6 FIB", lookupResult: hop?.output ?? "—", nextHopId: "P3", nextHopLabel: "P3", reason: "No H.Encaps repair outer, no End.X+USD SID anywhere." };
  }
  if (stepId === "node-protection-compute") {
    const r = state.nodeRepair;
    return { ...base, activeStageId: "repair-lookup", completedStageIds: ["ingress", "primary-lookup"], lookupType: "Node-Protecting Repair Node Selection", lookupResult: r ? `${r.repairNode} (merge → ${r.mergeTarget})` : "—", reason: "Q-Space(PE2, node P2 excluded) is EMPTY here — every node's current best path goes through P2, so the repair forces an explicit adjacency instead of trusting any node's natural forwarding." };
  }
  if (stepId === "node-protection-repair-list") {
    const r = state.nodeRepair;
    const sid = r?.repairList.sids[0];
    return { ...base, egressInterfaceId: ifaceId("P1", r?.outgoingInterface), activeStageId: "repair-lookup", completedStageIds: ["ingress", "primary-lookup"], lookupType: "Node-Protecting Repair List", lookupResult: sid ? `OIF P1→${r?.outgoingInterface}; SID ${sid.sidText} → adjacency ${sid.adjacency} (bypasses P2 via P4-PE2)` : "—", nextHopId: r?.outgoingInterface, nextHopLabel: r?.outgoingInterface, reason: "Outgoing interface unchanged — P4 is still safely reachable. Only the forced adjacency changes." };
  }
  if (stepId === "inject-wrong-repair") {
    const wrong = state.linkRepair?.repairList.sids[0];
    return { ...base, activeStageId: "repair-lookup", completedStageIds: ["ingress", "primary-lookup", "failure-check"], lookupType: "Repair List (INCORRECT — installed for this incident)", lookupResult: wrong ? `WRONG SID ${wrong.sidText} (directly routed to ${wrong.owner})` : "—", reason: "NOT the documented P4 End.X+USD adjacency strategy — the outgoing interface P1→P3 is still correct." };
  }
  if (stepId === "fail-for-incident") {
    return { ...base, activeStageId: "failure-check", completedStageIds: ["ingress", "primary-lookup"], lookupType: "Local Interface-Down Detection", lookupResult: "P1-P2 DOWN — wrong repair activates", reason: "The repair itself is what's broken, not the activation mechanism." };
  }
  if (stepId === "repair-challenge") {
    const correct = state.repairAttempt?.correct;
    const r = state.linkRepair;
    return {
      ...base,
      activeStageId: correct ? "repair-lookup" : "failure-check",
      completedStageIds: correct ? ["ingress", "primary-lookup", "failure-check"] : ["ingress", "primary-lookup"],
      lookupType: correct ? "Repair Recomputed" : "Engineer Challenge Pending",
      lookupResult: correct && r ? `repair node ${r.repairNode}, adjacency ${r.mergeTarget}` : "Choose the correct repair in the panel",
      reason: correct ? "Recomputed from the actual topology: post-convergence path → P/Q relationship → globally routed End.X." : undefined,
    };
  }
  if (stepId === "verify-resend") {
    const hop = state.journey[0];
    const r = state.linkRepair;
    const sid = r?.repairList.sids[0];
    return {
      ...base,
      egressInterfaceId: ifaceId("P1", r?.outgoingInterface),
      activeStageId: "encapsulate",
      completedStageIds: ["ingress", "primary-lookup", "failure-check", "repair-lookup"],
      packetBefore: `IPv6, DA=${INFRA_ADDRESS_TEXT.PE2}`,
      packetAfter: sid ? `Repair outer added — DA=${sid.sidText}` : "—",
      packetAfterFrames: framesFor(state.packet, true),
      lookupType: "H.Encaps (Correct Repair Outer)",
      lookupResult: hop?.lookup ?? "—",
      nextHopId: r?.outgoingInterface,
      nextHopLabel: r?.outgoingInterface,
      mutations: sid ? mutationsFor("ENCAPSULATE", `Correct repair outer added — DA = ${sid.sidText} (P4 End.X+USD)`) : [],
      reason: "Proves the CORRECT repair — not eventual convergence — is what fixes this.",
    };
  }
  if (stepId === "engineer-challenge-intro") {
    const verified = state.troubleshooting.verified && !!state.nodeRepair?.repairNode;
    return { ...base, completedStageIds: allIds(P1_STAGES), lookupType: "Engineer Challenge — Recap", lookupResult: verified ? "All TI-LFA phases verified." : "Recap pending.", reason: verified ? "Local repair, activation, troubleshooting, and node protection all confirmed." : undefined };
  }
  const i = stepIndex(stepId);
  if (i >= stepIndex("baseline-packet-intro") && i < stepIndex("trigger-failure") && state.phase === "STEADY_STATE") {
    return { ...base, egressInterfaceId: ifaceId("P1", "P2"), activeStageId: "primary-lookup", completedStageIds: ["ingress"], lookupType: "Primary IPv6 FIB", lookupResult: `next hop P2 (protected primary path)`, nextHopId: "P2", nextHopLabel: "P2", reason: "Healthy — repair precomputed but idle." };
  }
  return { ...base, completedStageIds: allIds(P1_STAGES) };
}

// ---------------------------------------------------------------------------
// P3 — ordinary transit / repair OIF / stale-FIB naive bounce
// ---------------------------------------------------------------------------

function traceForP3(state: Srv6TiLfaState, stepId: string): DeviceProcessingTrace {
  const base: DeviceProcessingTrace = { deviceId: "P3", ingressInterfaceId: ifaceId("P3", "P1"), stages: TRANSIT_STAGES, completedStageIds: [] };

  if (stepId === "p3-pre-failure-route") {
    return { ...base, activeStageId: "ipv6-fib", completedStageIds: ["ingress"], lookupType: "Own Pre-Failure SPF (P3→PE2)", lookupKey: "via P1 (cost 30) vs. via P4 (cost 70)", lookupResult: "next hop P1 (cost 30 wins)", nextHopId: "P1", nextHopLabel: "P1", reason: "Completely correct right now — this stays true until P3 itself learns about the failure." };
  }
  if (stepId === "naive-p3-stale-fib" || stepId === "naive-loop-p3-p1") {
    const hop = stepId === "naive-p3-stale-fib" ? state.naiveDemo?.hops[1] : state.naiveDemo?.hops[3];
    const nextHop = hop?.forwardedTo;
    return {
      ...base,
      egressInterfaceId: ifaceId("P3", nextHop),
      activeStageId: "ipv6-fib",
      completedStageIds: ["ingress"],
      packetBefore: `IPv6, DA=${INFRA_ADDRESS_TEXT.PE2}`,
      packetAfter: `Forwarded to ${nextHop ?? "—"}, unmodified`,
      lookupType: "Stale (Pre-Failure) FIB Lookup",
      lookupKey: DESTINATION,
      lookupResult: `next hop ${nextHop ?? "—"} (UNCHANGED since before failure)`,
      nextHopId: nextHop,
      nextHopLabel: nextHop,
      reason: "P3 has not learned of the failure yet — the SAME entry computed before any failure.",
    };
  }
  if (stepId === "p3-transit-repair") {
    const hop = findEntry(state, "P3");
    return {
      ...base,
      egressInterfaceId: ifaceId("P3", "P4"),
      activeStageId: "ipv6-fib",
      completedStageIds: ["ingress"],
      packetBefore: "Repair outer IPv6",
      packetAfter: "Forwarded toward P4, unmodified",
      packetBeforeFrames: framesFor(state.packet, false),
      packetAfterFrames: framesFor(state.packet, false),
      lookupType: "Ordinary IPv6 FIB",
      lookupKey: "outer DA falls inside P4's locator",
      lookupResult: hop?.output ?? "Forwarded toward P4",
      nextHopId: "P4",
      nextHopLabel: "P4",
      reason: "P3 has no idea this is a repair — it just forwards toward P4 using its own ordinary IPv6 FIB, completely unaware of TI-LFA, the failure, or anything else.",
    };
  }
  if (stepId === "wrong-repair-p3-stale") {
    const hop = findEntry(state, "P3");
    return {
      ...base,
      egressInterfaceId: ifaceId("P3", "P1"),
      activeStageId: "ipv6-fib",
      completedStageIds: ["ingress"],
      packetBefore: "Repair outer, DA=P2 SID",
      packetAfter: "Forwarded back to P1, unmodified",
      lookupType: "Ordinary (Stale) IPv6 FIB Toward P2",
      lookupResult: hop?.output ?? "forwarded to P1",
      nextHopId: "P1",
      nextHopLabel: "P1",
      reason: "The SID was never designed to force a specific adjacency past P3 — P3's own pre-convergence FIB entry toward P2's address space still says \"via P1\".",
    };
  }
  if (stepId === "verify-resend") {
    const hop = state.journey[1];
    return { ...base, egressInterfaceId: ifaceId("P3", "P4"), activeStageId: "ipv6-fib", completedStageIds: ["ingress"], lookupType: "Ordinary IPv6 FIB", lookupResult: hop?.output ?? "Forwarded to P4", nextHopId: "P4", nextHopLabel: "P4", reason: "Correct repair SID — P3 forwards toward P4's locator exactly as before." };
  }
  if (stepId === "post-convergence-forwarding") {
    const hop = findEntry(state, "P3");
    return { ...base, egressInterfaceId: ifaceId("P3", "P4"), activeStageId: "ipv6-fib", completedStageIds: ["ingress"], lookupType: "Ordinary Post-Convergence IPv6 FIB", lookupResult: hop?.output ?? "—", nextHopId: "P4", nextHopLabel: "P4" };
  }
  return base;
}

// ---------------------------------------------------------------------------
// P2 — protected resource endpoint (link protection) / healthy transit
// ---------------------------------------------------------------------------

function traceForP2(state: Srv6TiLfaState, stepId: string): DeviceProcessingTrace {
  const base: DeviceProcessingTrace = { deviceId: "P2", ingressInterfaceId: ifaceId("P2", "P1"), egressInterfaceId: ifaceId("P2", "PE2"), stages: TRANSIT_STAGES, completedStageIds: [] };
  if (stepId === "p2-normal-forward") {
    const hop = findEntry(state, "P2");
    return { ...base, ingressInterfaceId: ifaceId("P2", "P4"), activeStageId: "ipv6-fib", completedStageIds: ["ingress"], packetBefore: `IPv6, DA=${INFRA_ADDRESS_TEXT.PE2}`, packetAfter: "Forwarded to PE2, unmodified", lookupType: "Ordinary IPv6 FIB", lookupResult: hop?.output ?? "forwarded to PE2", nextHopId: "PE2", nextHopLabel: "PE2", reason: "P2 is completely healthy — only the P1-P2 LINK failed. It receives from P4 (the repair's forced adjacency) and forwards normally over its own direct link to PE2." };
  }
  if (stepId === "verify-resend") {
    const hop = state.journey[3];
    return { ...base, ingressInterfaceId: ifaceId("P2", "P4"), activeStageId: "ipv6-fib", completedStageIds: ["ingress"], lookupType: "Ordinary IPv6 FIB", lookupResult: hop?.output ?? "Forwarded to PE2", nextHopId: "PE2", nextHopLabel: "PE2" };
  }
  if (stepId === "l3vpn-result") {
    const hop = findEntry(state, "P2");
    return { ...base, ingressInterfaceId: ifaceId("P2", "P4"), activeStageId: "ipv6-fib", completedStageIds: ["ingress"], packetBefore: "SRv6 L3VPN outer, DA=PE2 End.DT4", packetAfter: "Forwarded toward PE2, unaffected by the repair", lookupType: "Ordinary IPv6 FIB", lookupResult: hop?.output ?? "Forwarded to PE2", nextHopId: "PE2", nextHopLabel: "PE2", reason: "TI-LFA and the VPN service are two fully independent layers." };
  }
  if (stepId === "post-convergence-forwarding") {
    const hop = findEntry(state, "P2");
    return { ...base, activeStageId: "ipv6-fib", completedStageIds: ["ingress"], lookupType: "Ordinary Post-Convergence IPv6 FIB", lookupResult: hop?.output ?? "—", nextHopId: "PE2", nextHopLabel: "PE2" };
  }
  const i = stepIndex(stepId);
  if (i >= stepIndex("baseline-packet-intro") && i < stepIndex("trigger-failure") && state.phase === "STEADY_STATE") {
    return { ...base, lookupType: "Protected Resource", lookupResult: "Healthy — the P1-P2 link into P2 is currently up", reason: "Main lab (link protection): P2 itself stays healthy, so a repair may merge back at it." };
  }
  return base;
}

// ---------------------------------------------------------------------------
// P4 — repair node (End.X+USD)
// ---------------------------------------------------------------------------

function traceForP4(state: Srv6TiLfaState, stepId: string): DeviceProcessingTrace {
  const base: DeviceProcessingTrace = { deviceId: "P4", ingressInterfaceId: ifaceId("P4", "P3"), stages: REPAIR_NODE_STAGES, completedStageIds: [] };
  const activeRepair = state.activeMode === "NODE" ? state.nodeRepair : state.linkRepair;
  const sid = activeRepair?.repairList.sids[0];

  if (stepId === "p4-endx-usd-execute") {
    return {
      ...base,
      egressInterfaceId: ifaceId("P4", sid?.adjacency),
      activeStageId: "local-sid-match",
      completedStageIds: ["ingress"],
      packetBefore: sid ? `Repair outer IPv6, DA=${sid.sidText}` : "Repair outer IPv6",
      lookupType: "Local SID Table Match",
      lookupResult: sid ? `Match — behavior End.X, flavor USD, adjacency ${sid.adjacency}` : "—",
      nextHopId: sid?.adjacency,
      nextHopLabel: sid?.adjacency,
      reason: "An exact SID match, not a prefix lookup — P4's own local SID table owns this SID.",
    };
  }
  if (stepId === "p4-usd-decap" || stepId === "l3vpn-p4-decap-repair-only" || stepId === "verify-resend") {
    const hop = stepId === "verify-resend" ? state.journey[2] : findEntry(state, "P4");
    return {
      ...base,
      egressInterfaceId: ifaceId("P4", sid?.adjacency),
      activeStageId: "usd-decap",
      completedStageIds: ["ingress", "local-sid-match"],
      packetBefore: "Repair outer + original packet",
      packetAfter: "Repair outer removed, forced to adjacency",
      packetBeforeFrames: framesFor(state.packet, false),
      packetAfterFrames: state.packet ? plainFrame(hop?.output ?? "Repair outer removed") : undefined,
      lookupType: "End.X + USD",
      lookupKey: sid?.sidText,
      lookupResult: hop?.output ?? "—",
      nextHopId: sid?.adjacency,
      nextHopLabel: sid?.adjacency,
      mutations: sid ? mutationsFor("DECAPSULATE", stepId === "l3vpn-p4-decap-repair-only" ? `USD removes ONLY the repair outer — the SRv6 L3VPN outer (DA=PE2 End.DT4) survives completely intact` : `USD removes the repair outer IPv6 header and extensions entirely, exposing the original packet, then forces it to adjacency ${sid.adjacency}`) : [],
      reason: "Not USP (SRH only), not MPLS PHP — the entire outer IPv6 header and its extensions are removed.",
    };
  }
  return base;
}

// ---------------------------------------------------------------------------
// PE2 — destination
// ---------------------------------------------------------------------------

function traceForPE2(state: Srv6TiLfaState, stepId: string): DeviceProcessingTrace {
  const base: DeviceProcessingTrace = { deviceId: "PE2", ingressInterfaceId: ifaceId("PE2", "P2"), stages: DEST_STAGES, completedStageIds: [] };
  if (stepId === "pe2-delivers" || stepId === "verify-resend") {
    const hop = stepId === "verify-resend" ? state.journey[4] : findEntry(state, "PE2");
    return { ...base, activeStageId: "deliver", completedStageIds: ["ingress"], packetBefore: `IPv6, DA=${INFRA_ADDRESS_TEXT.PE2}`, packetAfter: "Delivered", lookupType: "Self Is Destination", lookupResult: hop?.output ?? "Delivered", reason: "Completely ordinary IPv6 delivery — receives its own original packet, unaware any repair ever happened." };
  }
  if (stepId === "post-convergence-forwarding") {
    return { ...base, activeStageId: "deliver", completedStageIds: ["ingress"], lookupType: "Self Is Destination", lookupResult: "Delivered via ordinary post-convergence forwarding", reason: "No H.Encaps repair outer, no End.X+USD SID anywhere on this path." };
  }
  if (stepId === "l3vpn-result") {
    const hop = findEntry(state, "PE2");
    return { ...base, stages: DEST_VPN_STAGES, activeStageId: "service-decap", completedStageIds: ["ingress", "local-sid-match"], packetBefore: "SRv6 L3VPN outer, DA=PE2 End.DT4", packetAfter: "Delivered to CE via CUST-A", lookupType: "End.DT4 — CUST-A IPv4 Lookup", lookupResult: hop?.output ?? "Delivered to CE via CUST-A", reason: "End.DT4 executes exactly as it would have without any failure ever happening — TI-LFA and the VPN service are two fully independent layers." };
  }
  return base;
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

export function traceFor(router: RouterId, state: Srv6TiLfaState, currentStepId: string): DeviceProcessingTrace | undefined {
  if (router === "PE1") return traceForPE1(state, currentStepId);
  if (router === "P1") return traceForP1(state, currentStepId);
  if (router === "P3") return traceForP3(state, currentStepId);
  if (router === "P2") return traceForP2(state, currentStepId);
  if (router === "P4") return traceForP4(state, currentStepId);
  if (router === "PE2") return traceForPE2(state, currentStepId);
  return undefined;
}

export function packetFramesFor(state: Srv6TiLfaState, activeStageId: string | undefined): PacketStackFrame[] | undefined {
  const topChanged = activeStageId === "encapsulate" || activeStageId === "usd-decap" || activeStageId === "forced-adjacency";
  return framesFor(state.packet, topChanged);
}

// ---------------------------------------------------------------------------
// HopTimeline support
// ---------------------------------------------------------------------------

export const PRIMARY_TRANSITION_ROUTER: Partial<Record<string, RouterId>> = {
  "p3-pre-failure-route": "P3",
  "naive-fail-injected": "P1",
  "naive-forward-p1-p3": "P1",
  "naive-p3-stale-fib": "P3",
  "naive-loop-p3-p1": "P1",
  "post-convergence-compute": "P1",
  "p-space-compute": "P1",
  "extended-p-space-compute": "P1",
  "q-space-compute": "P1",
  "select-repair-node": "P1",
  "repair-list-derive": "P1",
  "protection-ready": "P1",
  "trigger-failure": "P1",
  "p1-detects": "P1",
  "p1-activates-repair": "P1",
  "p3-transit-repair": "P3",
  "p4-endx-usd-execute": "P4",
  "p4-usd-decap": "P4",
  "p2-normal-forward": "P2",
  "pe2-delivers": "PE2",
  "igp-converging": "P1",
  "plr-converged": "P1",
  "repair-released": "P1",
  "node-protection-compute": "P1",
  "node-protection-repair-list": "P1",
  "inject-wrong-repair": "P1",
  "fail-for-incident": "P1",
  "wrong-repair-p3-stale": "P3",
  "wrong-repair-loop": "P1",
  "repair-challenge": "P1",
  "l3vpn-integration-intro": "PE1",
  "l3vpn-p4-decap-repair-only": "P4",
  "l3vpn-result": "PE2",
  "engineer-challenge-intro": "P1",
};

/** Sender-priority (`packet.from ?? packet.to`) — every JourneyHop in this lesson is recorded against the router that PERFORMED the lookup/encapsulation/decapsulation, matching SRv6 L3VPN/MPLS L3VPN's own rule. */
export function deviceForStep(stepId: string, packet: PacketVisual | undefined): RouterId | undefined {
  if (packet) return (packet.from ?? packet.to) as RouterId;
  return PRIMARY_TRANSITION_ROUTER[stepId];
}

// ---------------------------------------------------------------------------
// Interfaces / link detail
// ---------------------------------------------------------------------------

export function interfacesFor(router: RouterId, state: Srv6TiLfaState, currentStepId: string): DeviceInterfaceData[] {
  const trace = traceFor(router, state, currentStepId);
  const processing = trace?.activeStageId !== undefined;
  return INTERFACES[router].map((def) => {
    const linkDown = (router === "P1" && def.neighborId === "P2") || (router === "P2" && def.neighborId === "P1") ? state.failedLinkIds.includes(PROTECTED_LINK) : false;
    return {
      id: def.id,
      name: def.name,
      status: linkDown ? "down" : "up",
      ip: def.ip,
      neighborId: def.neighborId,
      neighborLabel: def.neighborLabel,
      linkType: def.linkType,
      mtu: def.mtu,
      protocols: def.protocols,
      packetCount: trace && (trace.completedStageIds.length > 0 || processing) ? 1 : 0,
      role: processing && def.id === trace?.ingressInterfaceId ? "ingress" : processing && def.id === trace?.egressInterfaceId ? "egress" : "idle",
    };
  });
}

export function linkDetailFor(linkId: string, state: Srv6TiLfaState): LinkDetail | undefined {
  const edge = GRAPH_EDGES.find((e) => e.id === linkId);
  if (!edge) return undefined;
  const a = edge.a as RouterId;
  const b = edge.b as RouterId;
  const aIface = INTERFACES[a].find((f) => f.neighborId === b);
  const bIface = INTERFACES[b].find((f) => f.neighborId === a);
  if (!aIface || !bIface) return undefined;
  const down = state.failedLinkIds.includes(edge.id);
  return {
    aLabel: a,
    bLabel: b,
    aInterface: { id: aIface.id, name: aIface.name, status: down ? "down" : "up", ip: aIface.ip, neighborId: b, neighborLabel: b, linkType: aIface.linkType, mtu: aIface.mtu, protocols: aIface.protocols, role: "idle" },
    bInterface: { id: bIface.id, name: bIface.name, status: down ? "down" : "up", ip: bIface.ip, neighborId: a, neighborLabel: a, linkType: bIface.linkType, mtu: bIface.mtu, protocols: bIface.protocols, role: "idle" },
    status: down ? "down" : "up",
    mtu: aIface.mtu,
    protocols: [{ label: "IGP", value: "IPv6 (conceptual)" }, { label: "TI-LFA", value: edge.id === "P1-P2" ? "Protected resource" : "Protection topology" }],
  };
}

export { LINKS };
