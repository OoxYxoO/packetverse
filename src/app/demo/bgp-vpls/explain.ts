import type { NodeExplanation } from "@/components/network3d/types";
import {
  AS_NUMBER,
  CUST_A_RT,
  PE_ROUTERS,
  RR1_CLUSTER_ID,
  ROUTER_LOOPBACK,
  SERVICE_NAME,
  discoveredMembersFor,
  fdbFor,
  portsFor,
  resolveAttachmentCircuit,
  type BgpVplsState,
  type PeRouterId,
  type RouterId,
} from "@/lib/sim-engine/scenarios/bgpVpls";

/**
 * All BGP-VPLS-specific reasoning for the 3D node inspector lives
 * here, not in network3d/*. Every sentence derives from live
 * BgpVplsState — never leaking an RT mismatch or a repair before it
 * has actually happened in the journey/bgpJourney.
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
  RR1: "Route Reflector",
};
const ROLE: Record<RouterId, string> = {
  CE1: "Customer Ethernet device — no idea an MPLS provider network or BGP exists",
  PE1: "VPLS bridge member — discovers other members and PW labels via BGP, still learns customer MACs from the data plane",
  P1: "Ordinary transport transit — no BGP or VPLS awareness",
  P2: "Ordinary transport transit — no BGP or VPLS awareness",
  P3: "Ordinary transport transit — no BGP or VPLS awareness",
  PE2: "VPLS bridge member — discovers other members and PW labels via BGP, still learns customer MACs from the data plane",
  PE3: "VPLS bridge member — discovers other members and PW labels via BGP, still learns customer MACs from the data plane",
  CE2: "Customer Ethernet device — no idea an MPLS provider network or BGP exists",
  CE3: "Customer Ethernet device — no idea an MPLS provider network or BGP exists",
  RR1: "Ordinary iBGP speaker with one exception — routes learned from a client may be reflected to other clients",
};

export function explainNode(state: BgpVplsState, nodeId: RouterId): NodeExplanation {
  const base: NodeExplanation = { id: nodeId, name: nodeId, deviceType: DEVICE_TYPE[nodeId], role: ROLE[nodeId], currentAction: "" };

  if (nodeId === "RR1") {
    const hop = state.bgpJourney[state.bgpJourney.length - 1];
    const currentAction = hop && hop.device === "RR1" ? `${hop.lookup} → ${hop.action}.` : `Idle. AS ${AS_NUMBER}, Cluster ID ${RR1_CLUSTER_ID}. Sessions to ${PE_ROUTERS.join(", ")} are ${state.mpBgpUp ? "Established" : "Idle"}.`;
    return {
      ...base,
      controlPlaneRole: "Reflects VPLS NLRIs (RD, VE ID, label block, RT) between its clients — never originates or modifies a customer route.",
      dataPlaneRole: "Never a data-plane hop for customer Ethernet traffic — no attachment circuit, no FDB, no pseudowire terminates here.",
      currentAction,
      tables: [{ title: "RR1 — Info", rows: [{ label: "Router ID", value: ROUTER_LOOPBACK.RR1 ?? "—" }, { label: "AS", value: String(AS_NUMBER) }, { label: "Cluster ID", value: RR1_CLUSTER_ID }, { label: "Clients", value: PE_ROUTERS.join(", ") }] }],
    };
  }

  const journey = state.journey.filter((h) => h.device === nodeId);
  const hop = journey[journey.length - 1];

  if (PE_ROUTERS.includes(nodeId as PeRouterId)) {
    const pe = nodeId as PeRouterId;
    const ac = resolveAttachmentCircuit(state.acs, pe);
    const fdb = fdbFor(state, pe);
    const members = discoveredMembersFor(state, pe);
    const currentAction = hop ? `${hop.lookup} → ${hop.action}.` : `Idle. AC ${ac?.interfaceName} is ${ac?.up ? "up" : "DOWN"}. Discovered members: ${members.join(", ") || "none yet"}. FDB has ${fdb.length} entr${fdb.length === 1 ? "y" : "ies"}.`;
    const bgpTable = {
      title: "BGP VPLS Identity",
      rows: [
        { label: "RD", value: state.localAdvertisements[pe]?.rd ?? "(not yet advertised)" },
        { label: "VE ID", value: String(state.veIdByPe[pe]) },
        { label: "Import / Export RT", value: `${state.importRtByPe[pe]} / ${state.exportRtByPe[pe]}` },
        { label: "Discovered Members", value: members.join(", ") || "(none)" },
      ],
    };
    const fdbTable = {
      title: "MAC / FDB Table",
      rows: fdb.length ? fdb.map((e) => ({ label: e.mac, value: `${e.port.kind}: ${e.port.peer}` })) : [{ label: "(empty)", value: "no entries learned yet — BGP never populates this" }],
    };
    return {
      ...base,
      controlPlaneRole: `Peers only with RR1 for L2VPN/VPLS AFI/SAFI — discovers membership via RT import, computes send labels from imported label blocks. Service RT: ${CUST_A_RT}.`,
      dataPlaneRole: "Learns source MACs on every ingress port (AC or PW), floods unknown/broadcast/multicast, forwards known unicast to a single port, never relays a mesh-PW-ingress frame out another mesh PW.",
      currentAction,
      packetBefore: hop?.input,
      packetAfter: hop?.output,
      tables: [bgpTable, fdbTable],
    };
  }

  const currentAction = hop ? `${hop.lookup} → ${hop.action}.` : `Ordinary transport transit — forwards using only the top (transport) label, with no visibility into ${SERVICE_NAME}, BGP, or any customer MAC.`;
  return { ...base, controlPlaneRole: "No BGP VPLS state at all — only transport (LDP) forwarding state.", dataPlaneRole: "Acts on the top label only; the inner service label passes through completely untouched.", currentAction, packetBefore: hop?.input, packetAfter: hop?.output };
}

export function forwardingLabelText(state: BgpVplsState, router: RouterId): string {
  const hops = state.journey.filter((h) => h.device === router);
  const hop = hops[hops.length - 1];
  if (!hop) return "—";
  return `${hop.input} → ${hop.action} → ${hop.output}`;
}

export function bridgePortsSummary(state: BgpVplsState, router: PeRouterId): string {
  return portsFor(state, router).map((p) => `${p.kind}: ${p.peer}`).join(", ") || "(no active ports)";
}
