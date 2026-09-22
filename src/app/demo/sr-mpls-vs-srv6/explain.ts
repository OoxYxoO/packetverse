import type { NodeExplanation } from "@/components/network3d/types";
import {
  CUST_A_EXPORT_RT,
  INFRA_ADDRESS,
  PROTECTED_LINK,
  capstoneSteps,
  endSidText,
  nodeSidLabel,
  type Architecture,
  type CapstoneState,
  type RouterId,
} from "@/lib/sim-engine/scenarios/srMplsVsSrv6";
import { fmtIpv6 } from "@/lib/sim-engine/scenarios/srv6Foundations";

/**
 * All capstone-specific reasoning for the 3D node inspector lives here
 * (ARCHITECTURE.md §4) — never inside network3d/*. Tense is derived
 * from `state.journey`, filtered to the currently-active architecture
 * so an SR-MPLS-only journey entry never leaks into the SRv6 view or
 * vice versa.
 */

const DEVICE_TYPE: Record<Exclude<RouterId, "CE1" | "CE2">, string> = {
  PE1: "PE Router (Headend)",
  P1: "P Router (PLR)",
  P3: "P Router (Repair OIF)",
  P4: "P Router (Repair Node)",
  P2: "P Router (Protected Resource)",
  PE2: "PE Router (Destination)",
};
const ROLE: Record<Exclude<RouterId, "CE1" | "CE2">, string> = {
  PE1: "Headend / Ingress PE",
  P1: "Point of Local Repair",
  P3: "Repair Outgoing Interface",
  P4: "Repair Node",
  P2: "Egress-side Core / Protected Link Endpoint",
  PE2: "Egress PE / Destination",
};

export function explainNode(state: CapstoneState, architecture: Architecture, nodeId: RouterId): NodeExplanation {
  const isMpls = architecture === "SR_MPLS";
  const hops = state.journey.filter((h) => h.architecture === architecture && h.router === nodeId);
  const hop = hops[hops.length - 1];
  // Device Explorer shows LIVE device state, not the current step's hop (that is the Hop Inspector's job) — so this is labeled as the most recent activity and names the step that recorded it, rather than implying it is happening now.
  const hopStepLabel = hop ? capstoneSteps.find((s) => s.id === hop.stepId)?.label : undefined;
  const currentAction = hop ? `Most recent ${isMpls ? "SR-MPLS" : "SRv6"} activity (${hopStepLabel ?? hop.stepId}): ${hop.lookup} → ${hop.action} → ${hop.output}` : `Idle — no ${isMpls ? "SR-MPLS" : "SRv6"} packet processed here yet.`;

  if (nodeId === "CE1" || nodeId === "CE2") {
    return { id: nodeId, name: nodeId, deviceType: "Customer Edge", role: nodeId === "CE1" ? "Source site" : "Destination site", currentAction: "Customer site — never runs SR-MPLS or SRv6 itself; only originates/receives plain IP traffic." };
  }

  const base: NodeExplanation = { id: nodeId, name: nodeId, deviceType: DEVICE_TYPE[nodeId], role: ROLE[nodeId], currentAction, packetBefore: hop?.input, packetAfter: hop?.output };

  if (nodeId === "PE1") {
    return {
      ...base,
      controlPlaneRole: "Holds CUST-A's VRF, the SR Policy candidate, and (in SR-MPLS) the Node-SID database / (in SRv6) the End SID for every core router.",
      dataPlaneRole: isMpls ? "Imposes a label stack (transport, and VPN when carrying CUST-A traffic) toward PE2." : "Sets the outer IPv6 DA to the appropriate SID (End, or a Service SID when carrying CUST-A traffic).",
      tables: [{ title: isMpls ? "PE1 — Node-SID" : "PE1 — End SID", rows: [{ label: isMpls ? "Node-SID" : "End SID", value: isMpls ? String(nodeSidLabel("PE1")) : endSidText("PE1") }] }],
    };
  }

  if (nodeId === "P1") {
    const repair = state.sharedRepair;
    return {
      ...base,
      controlPlaneRole: `Point of Local Repair for ${PROTECTED_LINK} — the SAME precomputed repair topology (P-Space/Q-Space/post-convergence path) feeds both architectures' encodings.`,
      dataPlaneRole: isMpls ? "Ordinary label-switching under normal conditions; on failure, pushes a Node-SID + Adj-SID repair label stack." : "Ordinary IPv6 forwarding under normal conditions; on failure, H.Encaps-wraps traffic in a single End.X+USD repair SID.",
      note: state.linkFailed ? `${PROTECTED_LINK} is currently DOWN — P1 is actively repairing.` : `${PROTECTED_LINK} is healthy — repair is precomputed but idle.`,
      tables: repair ? [{ title: "P1 — Shared Repair Computation", rows: [{ label: "Repair node", value: repair.repairNode ?? "none" }, { label: "Merge target", value: repair.mergeTarget ?? "none" }, { label: "Outgoing interface", value: `P1→${repair.outgoingInterface ?? "?"}` }] }] : undefined,
    };
  }

  if (nodeId === "P3") {
    return {
      ...base,
      controlPlaneRole: "No customer VRF state, no TI-LFA computation of its own — participates only in the shared IGP.",
      dataPlaneRole: isMpls ? "Ordinary LFIB label-switching — has no idea whether it's carrying TE, VPN, or repair traffic." : "Ordinary IPv6 FIB forwarding — has no idea whether it's carrying TE, VPN, or repair traffic.",
      note: "P3 never learns about a failure or a repair from the packet itself — this is exactly why the repair instruction must be globally reachable rather than trusted to P3's own downstream forwarding.",
    };
  }

  if (nodeId === "P4") {
    return {
      ...base,
      controlPlaneRole: isMpls ? "Owns a Node-SID (ordinary reachability) and, as the chosen repair node, a locally-significant Adj-SID toward P2." : "Owns an End SID (ordinary reachability) and, as the chosen repair node, a globally-routed End.X+USD SID toward P2.",
      dataPlaneRole: isMpls ? "On repair traffic: pops its Node-SID label, reads the local Adj-SID, forces the P4→P2 adjacency." : "On repair traffic: matches its Local SID Table entry (End.X+USD), removes the ENTIRE repair outer header, forces the exposed packet onto the P4→P2 adjacency.",
      note: "P4 never executes any VPN-layer behavior merely because it handled a TI-LFA repair — an existing VPN outer (if present) rides through completely untouched.",
    };
  }

  if (nodeId === "P2") {
    return {
      ...base,
      controlPlaneRole: `The far end of the protected resource (${PROTECTED_LINK}) — otherwise an ordinary core router with no customer VRF state in either architecture.`,
      dataPlaneRole: isMpls ? "Ordinary LFIB forwarding (or PHP toward PE2)." : "Ordinary IPv6 FIB forwarding.",
    };
  }

  // PE2
  const importReason = isMpls ? undefined : state.srv6ImportProgress?.serviceSidResolution?.reason;
  return {
    ...base,
    controlPlaneRole: `Holds CUST-A's VRF and advertises the egress service identifier via MP-BGP (RT ${CUST_A_EXPORT_RT}) — an MPLS VPN label in SR-MPLS, a real Service SID (SRv6 L3 Service TLV, RFC 9252) in SRv6.`,
    dataPlaneRole: isMpls ? "Pops the transport label (PHP may already have done this), reads the VPN label, looks up the CUST-A VRF, delivers to CE2." : "Matches its Local SID Table (End.DT4), decapsulates, looks up the CUST-A VRF, delivers to CE2.",
    note: importReason,
    tables: [{ title: "PE2 — Identity", rows: [{ label: "Infra address", value: fmtIpv6(INFRA_ADDRESS[nodeId]) }, { label: isMpls ? "Node-SID" : "End SID", value: isMpls ? String(nodeSidLabel("PE2")) : endSidText("PE2") }] }],
  };
}
