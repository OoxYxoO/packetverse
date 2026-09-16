import type { NodeExplanation } from "@/components/network3d/types";
import { PW_ID, SERVICE_NAME, allocatePwReceiveLabel, pwStateFor, resolveAttachmentCircuit, type MplsL2vpnVpwsState, type RouterId } from "@/lib/sim-engine/scenarios/mplsL2vpnVpws";

/**
 * All VPWS-specific reasoning for the 3D node inspector lives here,
 * not in network3d/*. Every sentence derives from live
 * MplsL2vpnVpwsState — never leaking a PW-ID mismatch or a repair
 * before it has actually happened in the journey.
 */

const DEVICE_TYPE: Record<RouterId, string> = {
  CE1: "Customer Edge",
  PE1: "Pseudowire Endpoint (PE)",
  P1: "Provider Core (Transit)",
  P2: "Provider Core (Transit)",
  PE2: "Pseudowire Endpoint (PE)",
  CE2: "Customer Edge",
};
const ROLE: Record<RouterId, string> = {
  CE1: "Customer Ethernet device — no idea an MPLS core exists",
  PE1: "Pseudowire endpoint — owns the AC toward CE1, allocates and advertises a local PW receive label",
  P1: "Ordinary transport transit — no pseudowire service state",
  P2: "Ordinary transport transit — no pseudowire service state",
  PE2: "Pseudowire endpoint — owns the AC toward CE2, allocates and advertises a local PW receive label",
  CE2: "Customer Ethernet device — no idea an MPLS core exists",
};

export function explainNode(state: MplsL2vpnVpwsState, nodeId: RouterId): NodeExplanation {
  const hops = state.journey.filter((h) => h.device === nodeId);
  const hop = hops[hops.length - 1];
  const base: NodeExplanation = { id: nodeId, name: nodeId, deviceType: DEVICE_TYPE[nodeId], role: ROLE[nodeId], currentAction: "" };

  if (nodeId === "PE1" || nodeId === "PE2") {
    const pwState = pwStateFor(state);
    const ac = resolveAttachmentCircuit(state.acs, nodeId);
    const currentAction = hop ? `${hop.lookup} → ${hop.action}.` : `Idle. ${SERVICE_NAME} is ${pwState}. AC ${ac?.interfaceName} is ${ac?.up ? "up" : "DOWN"}.`;
    const table = {
      title: "Pseudowire",
      rows: [
        { label: "Service", value: SERVICE_NAME },
        { label: "PW ID (configured here)", value: String(nodeId === "PE1" ? state.pe1Config.fec.pwId : state.pe2Config.fec.pwId) },
        { label: "Local Receive Label", value: String(allocatePwReceiveLabel(nodeId)) },
        { label: "Remote Label Learned", value: String((nodeId === "PE1" ? state.remoteLabelKnownAtPe1 : state.remoteLabelKnownAtPe2) ?? "none") },
        { label: "PW State", value: pwState },
      ],
    };
    return { ...base, controlPlaneRole: "Signals the pseudowire via targeted LDP — PW FEC, local label allocation, remote label association.", dataPlaneRole: "Pushes the remote peer's advertised PW label on ingress; pops its OWN advertised label on egress and delivers to the local AC.", currentAction, packetBefore: hop?.input, packetAfter: hop?.output, tables: [table] };
  }

  if (nodeId === "CE1" || nodeId === "CE2") {
    const currentAction = hop ? `${hop.lookup} → ${hop.action}.` : "Idle — an ordinary Ethernet device, unaware any MPLS provider network exists.";
    return { ...base, controlPlaneRole: "None — CE devices are outside the provider's MPLS control plane entirely.", dataPlaneRole: "Sends and receives ordinary Ethernet frames on the attachment circuit.", currentAction, packetBefore: hop?.input, packetAfter: hop?.output };
  }

  const currentAction = hop ? `${hop.lookup} → ${hop.action}.` : `Ordinary transport transit — forwards using only the top (transport) label, with no visibility into PW ID ${PW_ID} or any customer service.`;
  return { ...base, controlPlaneRole: "No pseudowire service state at all — only transport (LDP) forwarding state.", dataPlaneRole: "Acts on the top label only; the inner PW label passes through completely untouched.", currentAction, packetBefore: hop?.input, packetAfter: hop?.output };
}

export function forwardingLabelText(state: MplsL2vpnVpwsState, router: RouterId): string {
  const hops = state.journey.filter((h) => h.device === router);
  const hop = hops[hops.length - 1];
  if (!hop) return "—";
  return `${hop.input} → ${hop.action} → ${hop.output}`;
}
