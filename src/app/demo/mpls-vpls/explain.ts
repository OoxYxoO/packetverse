import type { NodeExplanation } from "@/components/network3d/types";
import {
  PE_ROUTERS,
  SERVICE_NAME,
  allocatePwReceiveLabel,
  buildVplsFecKey,
  fdbFor,
  portsFor,
  pwPeersOf,
  pwUpBetween,
  resolveAttachmentCircuit,
  type MplsVplsState,
  type RouterId,
} from "@/lib/sim-engine/scenarios/mplsVpls";

/**
 * All VPLS-specific reasoning for the 3D node inspector lives here, not
 * in network3d/*. Every sentence derives from live MplsVplsState —
 * never leaking a split-horizon block or a repair before it has
 * actually happened in the journey.
 */

const DEVICE_TYPE: Record<RouterId, string> = {
  CE1: "Customer Edge",
  PE1: "VPLS Bridge Member (PE)",
  P1: "Provider Core (Transit)",
  P2: "Provider Core (Transit)",
  P3: "Provider Core (Transit)",
  PE2: "VPLS Bridge Member (PE)",
  PE3: "VPLS Bridge Member (PE)",
  CE2: "Customer Edge",
  CE3: "Customer Edge",
};
const ROLE: Record<RouterId, string> = {
  CE1: "Customer Ethernet device — no idea an MPLS provider network exists",
  PE1: "VPLS bridge member — owns the AC toward CE1 plus a pseudowire port to every other mesh PE",
  P1: "Ordinary transport transit — no VPLS bridge state",
  P2: "Ordinary transport transit — no VPLS bridge state",
  P3: "Ordinary transport transit — no VPLS bridge state",
  PE2: "VPLS bridge member — owns the AC toward CE2 plus a pseudowire port to every other mesh PE",
  PE3: "VPLS bridge member — owns the AC toward CE3 plus a pseudowire port to every other mesh PE",
  CE2: "Customer Ethernet device — no idea an MPLS provider network exists",
  CE3: "Customer Ethernet device — no idea an MPLS provider network exists",
};

export function explainNode(state: MplsVplsState, nodeId: RouterId): NodeExplanation {
  const hops = state.journey.filter((h) => h.device === nodeId);
  const hop = hops[hops.length - 1];
  const base: NodeExplanation = { id: nodeId, name: nodeId, deviceType: DEVICE_TYPE[nodeId], role: ROLE[nodeId], currentAction: "" };

  if (PE_ROUTERS.includes(nodeId)) {
    const ac = resolveAttachmentCircuit(state.acs, nodeId);
    const fdb = fdbFor(state, nodeId);
    const peers = pwPeersOf(nodeId);
    const currentAction = hop ? `${hop.lookup} → ${hop.action}.` : `Idle. AC ${ac?.interfaceName} is ${ac?.up ? "up" : "DOWN"}. FDB has ${fdb.length} entr${fdb.length === 1 ? "y" : "ies"}.`;
    const pwTable = {
      title: "Pseudowire Mesh",
      rows: peers.map((peer) => ({
        label: `PW to ${peer}`,
        value: `${pwUpBetween(state.pwLinks, nodeId, peer) ? "UP" : "DOWN"} — local ${allocatePwReceiveLabel(nodeId, peer)} / remote ${allocatePwReceiveLabel(peer, nodeId)}`,
      })),
    };
    const fdbTable = {
      title: "MAC / FDB Table",
      rows: fdb.length ? fdb.map((e) => ({ label: e.mac, value: `${e.port.kind === "AC" ? "AC" : "PW"}: ${e.port.peer}` })) : [{ label: "(empty)", value: "no entries learned yet" }],
    };
    return {
      ...base,
      controlPlaneRole: `Signals ${peers.length} pseudowire(s) via targeted LDP — VPLS service ${buildVplsFecKey()} shared mesh-wide, PW FEC + directional labels per pair.`,
      dataPlaneRole: "Learns source MACs on every ingress port (AC or PW), floods unknown/broadcast/multicast, forwards known unicast to a single port, and never relays a mesh-PW-ingress frame out another mesh PW.",
      currentAction,
      packetBefore: hop?.input,
      packetAfter: hop?.output,
      tables: [pwTable, fdbTable],
    };
  }

  if (nodeId === "CE1" || nodeId === "CE2" || nodeId === "CE3") {
    const currentAction = hop ? `${hop.lookup} → ${hop.action}.` : "Idle — an ordinary Ethernet device, unaware any MPLS provider network exists.";
    return { ...base, controlPlaneRole: "None — CE devices are outside the provider's MPLS control plane entirely.", dataPlaneRole: "Sends and receives ordinary Ethernet frames on the attachment circuit; silently discards frames not addressed to it.", currentAction, packetBefore: hop?.input, packetAfter: hop?.output };
  }

  const currentAction = hop ? `${hop.lookup} → ${hop.action}.` : `Ordinary transport transit — forwards using only the top (transport) label, with no visibility into ${SERVICE_NAME} or any customer MAC.`;
  return { ...base, controlPlaneRole: "No VPLS service state at all — only transport (LDP) forwarding state.", dataPlaneRole: "Acts on the top label only; the inner PW label passes through completely untouched.", currentAction, packetBefore: hop?.input, packetAfter: hop?.output };
}

export function forwardingLabelText(state: MplsVplsState, router: RouterId): string {
  const hops = state.journey.filter((h) => h.device === router);
  const hop = hops[hops.length - 1];
  if (!hop) return "—";
  return `${hop.input} → ${hop.action} → ${hop.output}`;
}

export function bridgePortsSummary(state: MplsVplsState, router: RouterId): string {
  if (!PE_ROUTERS.includes(router)) return "—";
  return portsFor(state, router).map((p) => `${p.kind}: ${p.peer}`).join(", ") || "(no active ports)";
}
