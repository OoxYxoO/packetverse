import type { PacketVisual } from "@/lib/sim-engine/types";
import type { PacketCallout3D } from "@/components/network3d/types";

/** Hex mirrors of the --pv-proto-* tokens (three.js and inline SVG need real color values). */
export const PROTOCOL_HEX: Record<PacketVisual["protocol"], string> = {
  ARP: "#f59e0b",
  ETHERNET: "#94a3b8",
  IP: "#60a5fa",
  IPV6: "#38bdf8",
  TCP: "#34d399",
  HTTPS: "#a78bfa",
  OSPF: "#22d3ee",
  BGP: "#fb7185",
  MPLS: "#f472b6",
  VXLAN: "#facc15",
};

/**
 * Short, readable name for a packet plus a one-line detail, derived only from
 * the PacketVisual itself: the message type comes from `badge` or the
 * "TYPE — detail" convention the scenarios use in `summary`.
 * e.g. OSPF "Hello — no neighbors listed yet" → "OSPF Hello" / "no neighbors listed yet".
 */
export function packetMessageLabel(packet: PacketVisual): { title: string; detail?: string } {
  const [head, ...rest] = packet.summary.split(" — ");
  const kind = packet.badge ?? (rest.length > 0 ? head : undefined);
  // Don't repeat the protocol when the message name already contains it ("Normal IP packet", "BGP UPDATE").
  const namesProtocol = kind !== undefined && kind.toUpperCase().split(/\W+/).includes(packet.protocol);
  const title = !kind ? packet.protocol : namesProtocol ? kind : `${packet.protocol} ${kind}`;
  const detail = rest.length > 0 ? rest.join(" — ") : packet.summary !== kind ? packet.summary : undefined;
  return { title, detail };
}

export function packetCallout(packet: PacketVisual): PacketCallout3D {
  const { title, detail } = packetMessageLabel(packet);
  return { title, detail, color: PROTOCOL_HEX[packet.protocol] };
}
