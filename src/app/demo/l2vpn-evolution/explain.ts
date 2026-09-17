import type { NodeExplanation } from "@/components/network3d/types";
import { CE_MAC, type L2vpnEvolutionState, type RouterId } from "@/lib/sim-engine/scenarios/l2vpnEvolution";

/**
 * All L2VPN-Evolution-specific reasoning for the 3D node inspector
 * lives here, not in network3d/*. Every sentence derives from live
 * L2vpnEvolutionState.
 */

const DEVICE_TYPE: Partial<Record<RouterId, string>> = {
  CE1: "Customer Edge (CUST-A)",
  CE2: "Customer Edge (CUST-A)",
  CE3: "Customer Edge (CUST-A)",
  PE1: "Provider Edge",
  PE2: "Provider Edge",
  PE3: "Provider Edge",
  P1: "Provider Core (P router)",
  P2: "Provider Core (P router)",
  MTU1: "MTU-s (H-VPLS access bridge)",
  MTU2: "MTU-s (H-VPLS access bridge)",
  RR1: "Route Reflector (BGP-VPLS control plane)",
  "CE-DUAL": "Dual-homed customer edge (multihoming comparison)",
};

export function explainNode(state: L2vpnEvolutionState, nodeId: RouterId): NodeExplanation {
  const hops = state.journey.filter((h) => h.device === nodeId);
  const hop = hops[hops.length - 1];
  const base: NodeExplanation = { id: nodeId, name: nodeId, deviceType: DEVICE_TYPE[nodeId] ?? nodeId, role: "", currentAction: "" };

  if (nodeId.startsWith("PE")) {
    const pe = nodeId as "PE1" | "PE2" | "PE3";
    const fdb = state.fdb[pe] ?? [];
    const currentAction = hop ? `${hop.lookup} → ${hop.action}.` : `Idle. FDB has ${fdb.length} entr${fdb.length === 1 ? "y" : "ies"}.`;
    const fdbTable = { title: "MAC / FDB Table", rows: fdb.length ? fdb.map((e) => ({ label: e.mac, value: `${e.port.kind} → ${e.port.peer}` })) : [{ label: "(empty)", value: "no entries learned yet" }] };
    const type2Table = { title: "EVPN Type 2 Routes Installed (EVPN view only)", rows: state.type2Routes.length ? state.type2Routes.map((r) => ({ label: r.mac, value: `origin ${r.originPe}, RD ${r.rd}` })) : [{ label: "(none)", value: "no Type 2 routes advertised yet" }] };
    return {
      ...base,
      role: "Provider Edge — the one device that exists, in some form, across all five architectures compared in this lesson.",
      controlPlaneRole: "Signals its pseudowires (targeted LDP, or BGP-VPLS NLRI, depending on which architecture is currently selected) and, only under EVPN, advertises/receives Type 2 MAC/IP routes.",
      dataPlaneRole: "Learns source MACs on its local AC and remote service ports; floods unknown/broadcast traffic; forwards known unicast to a single port — identical data-plane behavior under VPLS, BGP-VPLS, and H-VPLS alike.",
      currentAction,
      packetBefore: hop?.input,
      packetAfter: hop?.output,
      tables: [fdbTable, type2Table],
    };
  }

  if (nodeId.startsWith("CE")) {
    const mac = nodeId === "CE1" ? CE_MAC.CE1 : nodeId === "CE2" ? CE_MAC.CE2 : nodeId === "CE3" ? CE_MAC.CE3 : undefined;
    const currentAction = hop ? `${hop.lookup} → ${hop.action}.` : "Idle — an ordinary Ethernet device, unaware of which L2VPN architecture the provider is currently using.";
    return {
      ...base,
      role: "Customer Ethernet device — sends and receives ordinary frames; has no idea whether the provider is using VPWS, VPLS, BGP-VPLS, H-VPLS, or EVPN underneath.",
      controlPlaneRole: "None — CE devices are outside the provider's control plane entirely, in every architecture in this track.",
      dataPlaneRole: "Sends and receives ordinary Ethernet frames on its attachment circuit.",
      currentAction,
      note: mac ? `MAC: ${mac}` : undefined,
      packetBefore: hop?.input,
      packetAfter: hop?.output,
    };
  }

  if (nodeId === "RR1") {
    return {
      ...base,
      role: "BGP-VPLS Route Reflector — reflects VPLS NLRI between PE1/PE2/PE3.",
      controlPlaneRole: "Carries VPLS NLRI (RD, VE ID, label block) for membership/service discovery only.",
      dataPlaneRole: "None — never forwards a customer Ethernet frame, and never holds a customer FDB entry.",
      currentAction: "Idle — reflecting whatever VPLS NLRI PE1/PE2/PE3 have advertised.",
    };
  }

  if (nodeId.startsWith("MTU")) {
    return {
      ...base,
      role: "H-VPLS access-tier bridge — owns local ACs plus exactly one spoke pseudowire to its PE-rs hub.",
      controlPlaneRole: "Signals exactly one spoke pseudowire — never joins the core mesh.",
      dataPlaneRole: "Learns source MACs on its ACs and its one spoke port, exactly like any other VPLS-family bridge.",
      currentAction: "Idle.",
    };
  }

  // P routers, CE-DUAL
  return {
    ...base,
    role: nodeId === "CE-DUAL" ? "A customer edge dual-homed to two PEs — used only for the multihoming comparison." : "Provider core — transport forwarding only, in every architecture in this track.",
    controlPlaneRole: "Transport label distribution only — never any customer service state.",
    dataPlaneRole: "Forwards on the outer transport label alone; never inspects a service/PW label, a customer MAC, or an EVPN route.",
    currentAction: "Idle.",
  };
}
