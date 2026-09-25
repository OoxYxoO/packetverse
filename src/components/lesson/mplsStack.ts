import type { PacketVisual } from "@/lib/sim-engine/types";
import type { PacketCallout3D } from "@/components/network3d/types";

/** One MPLS shim as the Packet Inspector shows it, read back from the packet's own layers. */
export interface ShimView {
  label: string;
  s: string;
  /** "transport" / "vpn" / "bypass", from the scenario's "MPLS Shim (purpose)" layer name. */
  purpose?: string;
}

/** The label stack carried by a packet, outermost first — derived only from the PacketVisual the scenario built from state. */
export function shimStack(packet: PacketVisual): ShimView[] {
  return packet.layers
    .filter((l) => l.name.startsWith("MPLS Shim"))
    .map((l) => ({
      label: l.fields.find((f) => f.label === "Label")?.value ?? "?",
      s: l.fields.find((f) => f.label.startsWith("S "))?.value ?? "?",
      purpose: /\(([^)]+)\)/.exec(l.name)?.[1],
    }));
}

/** "102 S0 / 24002 S1"; an empty stack reads as plain IP. */
export function stackText(stack: ShimView[]): string {
  return stack.length ? stack.map((l) => `${l.label} S${l.s}`).join(" / ") : "no labels (plain IP)";
}

/**
 * Packet shaped so <GraphPacketBubble title={c.title}> shows the callout's
 * detail line: the bubble reads its detail from the "TITLE — detail" summary.
 */
export function bubblePacket(packet: PacketVisual, c: PacketCallout3D): PacketVisual {
  return { ...packet, badge: c.title, summary: c.detail ? `${c.title} — ${c.detail}` : c.title };
}
