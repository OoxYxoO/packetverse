import type { DeviceInterfaceData, NodeExplanation } from "@/components/network3d/types";
import type { PacketLayer, PacketVisual } from "@/lib/sim-engine/types";
import { evaluateReflection, type PeerRelationship } from "@/lib/sim-engine/scenarios/bgpRouteReflector";
import { routeToBgpFields, type RouterId, type VpnRoute } from "@/lib/sim-engine/scenarios/srv6L3vpn";

/**
 * Route Reflector integration adapter (mirrors `app/demo/mpls-l3vpn/rrIntegration.ts`
 * exactly): reuses the REAL reflection-rule engine (`evaluateReflection`)
 * from the Route Reflector lesson, combined with THIS lesson's own
 * canonical `VpnRoute`. RR1 gets its own fresh IPv6 loopback/cluster id
 * here rather than importing `ROUTER_IP.RR1`/`CLUSTER_ID.RR1` — those
 * are IPv4 values scoped to that lesson's own (unrelated) topology, and
 * this lesson's BGP next hops are IPv6, so reusing them would be
 * type-safe but semantically wrong. RR1 is never a member of this
 * lesson's own RouterId/state — it is spliced into the topology
 * presentation-only, exactly like the MPLS L3VPN precedent.
 */

export const RR1_ID = "RR1" as const;
export const RR1_LOOPBACK = "2001:db8:ffff::99";
export const RR1_CLUSTER_ID = "2001:db8:ffff::199";

interface GNode {
  id: string;
  label: string;
  x: number;
  y: number;
  subLabel?: string;
}
interface GEdge {
  id: string;
  a: string;
  b: string;
  label?: string;
}

export function withRr1(nodes: GNode[], edges: GEdge[], pe1Id: string, pe2Id: string): { nodes: GNode[]; edges: GEdge[] } {
  const pe1 = nodes.find((n) => n.id === pe1Id);
  const pe2 = nodes.find((n) => n.id === pe2Id);
  if (!pe1 || !pe2) return { nodes, edges };
  const rr1: GNode = { id: RR1_ID, label: "RR1", x: (pe1.x + pe2.x) / 2, y: Math.min(pe1.y, pe2.y) - 28, subLabel: `${RR1_LOOPBACK} · Route Reflector` };
  return {
    nodes: [...nodes, rr1],
    edges: [...edges, { id: `${RR1_ID}-${pe1Id}`, a: RR1_ID, b: pe1Id, label: "MP-BGP (reflected)" }, { id: `${RR1_ID}-${pe2Id}`, a: RR1_ID, b: pe2Id, label: "MP-BGP" }],
  };
}

export interface ReflectedVpnRoute {
  originatorId: string;
  clusterList: string[];
  decision: "reflect" | "withhold";
  reason: string;
}
/** Both PE1 and PE2 are modeled as RR1 clients — always a "reflect"; the interesting content is ORIGINATOR_ID/CLUSTER_LIST, not a withhold case (that's the full Route Reflector lesson's job). */
export function reflectThroughRr1(route: VpnRoute, originatorLoopback: string): ReflectedVpnRoute {
  const sourceRelationship: PeerRelationship = "client";
  const candidateRelationship: PeerRelationship = "client";
  const { decision, reason } = evaluateReflection(sourceRelationship, candidateRelationship);
  return { originatorId: originatorLoopback, clusterList: [RR1_CLUSTER_ID], decision, reason };
}

function rrAttrsLayer(reflected: ReflectedVpnRoute): PacketLayer {
  return {
    name: "BGP UPDATE (RR attributes)",
    color: "var(--pv-violet, #a78bfa)",
    fields: [
      { label: "ORIGINATOR_ID", value: reflected.originatorId },
      { label: "CLUSTER_LIST", value: reflected.clusterList.join(", ") },
    ],
  };
}
export function packetToRr1(route: VpnRoute, from: RouterId): PacketVisual {
  return { id: "vpn-to-rr1", protocol: "BGP", from, to: RR1_ID, summary: `VPN UPDATE — ${route.prefix} → RR1`, badge: "VPN UPDATE", layers: [{ name: "MP-BGP VPN UPDATE", color: "var(--pv-proto-bgp)", fields: routeToBgpFields(route) }] };
}
export function packetFromRr1(route: VpnRoute, to: RouterId, reflected: ReflectedVpnRoute): PacketVisual {
  return { id: "vpn-from-rr1", protocol: "BGP", from: RR1_ID, to, summary: `VPN UPDATE (reflected) — ${route.prefix}`, badge: "VPN UPDATE", layers: [{ name: "MP-BGP VPN UPDATE", color: "var(--pv-proto-bgp)", fields: routeToBgpFields(route) }, rrAttrsLayer(reflected)] };
}

export function rr1Interfaces(): DeviceInterfaceData[] {
  return [
    { id: "RR1-PE1", name: "ge-0/0/0", status: "up", ip: RR1_LOOPBACK, neighborId: "PE1", neighborLabel: "PE1", linkType: "Internal (iBGP)", mtu: 1500, protocols: ["MP-BGP"], role: "idle", extra: [{ label: "RR Relationship", value: "Client" }] },
    { id: "RR1-PE2", name: "ge-0/0/1", status: "up", ip: RR1_LOOPBACK, neighborId: "PE2", neighborLabel: "PE2", linkType: "Internal (iBGP)", mtu: 1500, protocols: ["MP-BGP"], role: "idle", extra: [{ label: "RR Relationship", value: "Client" }] },
  ];
}

export function explainRr1(hasRoutes: boolean): NodeExplanation {
  return {
    id: RR1_ID,
    name: "RR1",
    deviceType: "Route Reflector",
    role: "ROUTE REFLECTOR",
    currentAction: hasRoutes ? "Reflecting CUST-A VPN routes between PE1 and PE2 — control plane only." : "Idle — no VPN routes to reflect yet.",
    controlPlaneRole: "Ordinary iBGP speaker with one exception: routes learned from a client may be reflected to other clients, carrying ORIGINATOR_ID and CLUSTER_LIST.",
    dataPlaneRole: "Never becomes a data-plane hop. Customer packets never traverse RR1 — it only distributes the VPN routes and their Service SIDs, never executes one.",
    tables: [{ title: "RR1 — Info", rows: [{ label: "Router ID", value: RR1_LOOPBACK }, { label: "Cluster ID", value: RR1_CLUSTER_ID }, { label: "Sessions", value: "PE1 (client), PE2 (client)" }] }],
  };
}
