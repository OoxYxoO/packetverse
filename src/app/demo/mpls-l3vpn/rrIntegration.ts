import type { DeviceInterfaceData, NodeExplanation } from "@/components/network3d/types";
import type { PacketLayer, PacketVisual } from "@/lib/sim-engine/types";
import { CLUSTER_ID, ROUTER_IP, evaluateReflection, type PeerRelationship } from "@/lib/sim-engine/scenarios/bgpRouteReflector";
import type { VpnV4Route } from "@/lib/sim-engine/scenarios/mplsL3vpn";

/**
 * Route Reflector integration adapter for the MPLS L3VPN lesson (brief
 * §8: "Reuse bgp-route-reflector, reflection rules, RR packet/update
 * presentation, ORIGINATOR_ID, CLUSTER_LIST... Do not copy the RR
 * logic into mpls-l3vpn/page.tsx"). This file is the seam: it imports
 * the REAL reflection-rule engine (`evaluateReflection`) and the REAL
 * RR identity constants (`ROUTER_IP.RR1`, `CLUSTER_ID.RR1`) from the
 * Route Reflector lesson's own scenario file, and combines them with
 * the L3VPN lesson's OWN canonical `VpnV4Route` (RD/RT/prefix/next-hop/
 * VPN label) — none of which is duplicated or reinvented here. The
 * L3VPN scenario file (mplsL3vpn.ts) is untouched: this adapter only
 * adds a PRESENTATIONAL "what would this look like reflected through
 * RR1" layer on top of state the engine already computed.
 *
 * RR1 is not a new L3VpnState router — it never appears in journey/
 * transportLfib/vrfs. It's purely a control-plane-only 3D node this
 * page optionally splices into the topology, exactly the way the
 * brief describes: "does not become a data-plane MPLS hop merely
 * because it is an RR."
 */

export const RR1_ID = "RR1" as const;
export const RR1_LOOPBACK = ROUTER_IP.RR1;
export const RR1_CLUSTER_ID = CLUSTER_ID.RR1!;

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

/** Splices RR1 into an existing node/edge list, positioned above the PE1↔PE2 span — a control-plane-only overlay, never altering the existing CE1..CE2 chain. `pe1Id`/`pe2Id` let physical (PE1/PE2) and logical (same ids here) views share one function. */
export function withRr1(nodes: GNode[], edges: GEdge[], pe1Id: string, pe2Id: string): { nodes: GNode[]; edges: GEdge[] } {
  const pe1 = nodes.find((n) => n.id === pe1Id);
  const pe2 = nodes.find((n) => n.id === pe2Id);
  if (!pe1 || !pe2) return { nodes, edges };
  const rr1: GNode = { id: RR1_ID, label: "RR1", x: (pe1.x + pe2.x) / 2, y: Math.min(pe1.y, pe2.y) - 30, subLabel: `${RR1_LOOPBACK} · Route Reflector` };
  return {
    nodes: [...nodes, rr1],
    edges: [...edges, { id: `${RR1_ID}-${pe1Id}`, a: RR1_ID, b: pe1Id, label: "MP-BGP (reflected)" }, { id: `${RR1_ID}-${pe2Id}`, a: RR1_ID, b: pe2Id, label: "MP-BGP" }],
  };
}

// ---------------------------------------------------------------------------
// Reflected-route presentation (brief §2/§3/§10) — ORIGINATOR_ID is the
// originating PE's own loopback (already canonical L3VPN state); the
// reflect/withhold reasoning is the REAL rule engine, not new logic.
// ---------------------------------------------------------------------------

export interface ReflectedVpnRoute {
  originatorId: string;
  clusterList: string[];
  decision: "reflect" | "withhold";
  reason: string;
}

/** What RR1 would do with `route` — reused straight from bgp-route-reflector's rule engine. In this 2-PE integration PE2 (originator) and PE1 (sole other peer) are both modeled as RR1 clients, so this is always a "reflect" — the interesting content for a learner is the ORIGINATOR_ID/CLUSTER_LIST it adds, not a withhold case (that's this lesson's simpler purpose vs. the full Route Reflector lesson). */
export function reflectThroughRr1(route: VpnV4Route, originatorLoopback: string): ReflectedVpnRoute {
  const sourceRelationship: PeerRelationship = "client";
  const candidateRelationship: PeerRelationship = "client";
  const { decision, reason } = evaluateReflection(sourceRelationship, candidateRelationship);
  return { originatorId: originatorLoopback, clusterList: [RR1_CLUSTER_ID], decision, reason };
}

// ---------------------------------------------------------------------------
// Packet presentation (brief §2/§13) — mirrors bgp-route-reflector's own
// two-layer convention (origin attributes layer + a separate RR
// attributes layer) so a learner who took that lesson recognizes the
// shape immediately, and so X-Ray focus-layer dimming works the same way.
// ---------------------------------------------------------------------------

function vpnv4Layer(route: VpnV4Route): PacketLayer {
  return {
    name: "MP-BGP VPNv4 UPDATE",
    color: "var(--pv-proto-bgp)",
    fields: [
      { label: "AFI/SAFI", value: "VPNv4" },
      { label: "NLRI (RD:Prefix)", value: `${route.rd}:${route.prefix}` },
      { label: "Extended Community (RT)", value: route.rt ?? "" },
      { label: "NEXT_HOP", value: route.nextHop ?? "" },
      { label: "VPN Label", value: String(route.vpnLabel) },
    ],
  };
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

/** Index of the RR-attributes layer, if present — for X-Ray focus dimming, mirroring `transportLayerIndex`/`vpnLayerIndex` in mplsL3vpn.ts. */
export function rrAttrsLayerIndex(packet: PacketVisual | undefined): number[] | undefined {
  if (!packet) return undefined;
  const i = packet.layers.findIndex((l) => l.name === "BGP UPDATE (RR attributes)");
  return i === -1 ? undefined : [i];
}
export function vpnv4LayerIndex(packet: PacketVisual | undefined): number[] | undefined {
  if (!packet) return undefined;
  const i = packet.layers.findIndex((l) => l.name === "MP-BGP VPNv4 UPDATE");
  return i === -1 ? undefined : [i];
}

/** PE2 → RR1: the same VPNv4 UPDATE the direct-peering lesson already sends, untouched. */
export function packetPe2ToRr1(route: VpnV4Route): PacketVisual {
  return { id: "vpnv4-pe2-rr1", protocol: "BGP", from: "PE2", to: RR1_ID, summary: `VPNv4 UPDATE — ${route.prefix} → RR1`, badge: "VPNv4 UPDATE", layers: [vpnv4Layer(route)] };
}
/** RR1 → PE1: the same route, reflected — ORIGINATOR_ID/CLUSTER_LIST now present as their own layer. */
export function packetRr1ToPe1(route: VpnV4Route, reflected: ReflectedVpnRoute): PacketVisual {
  return { id: "vpnv4-rr1-pe1", protocol: "BGP", from: RR1_ID, to: "PE1", summary: `VPNv4 UPDATE (reflected) — ${route.prefix}`, badge: "VPNv4 UPDATE", layers: [vpnv4Layer(route), rrAttrsLayer(reflected)] };
}

// ---------------------------------------------------------------------------
// RR1 as a (lightweight) explorable device (brief §3) — reuses the
// generic DeviceInterfaceData/NodeExplanation shapes; RR1 gets a
// smaller Device Explorer tab set than a full RR lesson's router since
// it plays a supporting role here, not the primary teaching subject.
// ---------------------------------------------------------------------------

export function rr1Interfaces(): DeviceInterfaceData[] {
  return [
    { id: "RR1-PE1", name: "ge-0/0/0", status: "up", ip: RR1_LOOPBACK, neighborId: "PE1", neighborLabel: "PE1", linkType: "Internal (iBGP)", mtu: 1500, protocols: ["BGP"], role: "idle", extra: [{ label: "RR Relationship", value: "Client" }] },
    { id: "RR1-PE2", name: "ge-0/0/1", status: "up", ip: RR1_LOOPBACK, neighborId: "PE2", neighborLabel: "PE2", linkType: "Internal (iBGP)", mtu: 1500, protocols: ["BGP"], role: "idle", extra: [{ label: "RR Relationship", value: "Client" }] },
  ];
}

export function explainRr1(route: VpnV4Route | undefined, disabled: boolean): NodeExplanation {
  return {
    id: RR1_ID,
    name: "RR1",
    deviceType: "Route Reflector",
    role: "ROUTE REFLECTOR",
    currentAction: disabled
      ? "Control-plane session disabled — RR1 is no longer distributing VPNv4 routes. Already-installed forwarding state elsewhere is unaffected by this alone."
      : route
        ? `Reflecting ${route.prefix} between PE1 and PE2 — control plane only.`
        : "Idle — no VPNv4 route to reflect yet.",
    controlPlaneRole: "Ordinary iBGP speaker with one exception: routes learned from a client may be reflected to other clients, carrying ORIGINATOR_ID and CLUSTER_LIST.",
    dataPlaneRole: "Never becomes an MPLS data-plane hop by virtue of reflecting this route — customer packets never traverse RR1.",
    tables: [
      { title: "RR1 — Info", rows: [{ label: "Router ID", value: RR1_LOOPBACK }, { label: "Cluster ID", value: RR1_CLUSTER_ID }, { label: "Sessions", value: "PE1 (client), PE2 (client)" }] },
    ],
  };
}
