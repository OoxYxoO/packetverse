import type { PacketVisual } from "@/lib/sim-engine/types";
import type { PacketCallout3D } from "@/components/network3d/types";
import { PROTOCOL_HEX, packetCallout } from "@/components/lesson/packetCallout";
import { shimStack, stackText } from "@/components/lesson/mplsStack";

/**
 * Lesson-local callout. The scenario tags RSVP messages as protocol "MPLS"
 * (layer "RSVP"): name them as RSVP control-plane signaling with their
 * direction — PATH headend → tailend, RESV tailend → headend — and never as
 * something that carries customer traffic.
 */
export function rsvpTeCallout(packet: PacketVisual): PacketCallout3D {
  const color = PROTOCOL_HEX[packet.protocol];
  if (packet.layers[0]?.name === "RSVP") {
    return packet.badge === "RESV"
      ? { title: "RSVP RESV ↑ upstream", detail: "Control plane · tailend → headend · labels + reservation, no customer data", color }
      : { title: "RSVP PATH ↓ downstream", detail: "Control plane · headend → tailend · ERO + bandwidth request, no customer data", color };
  }
  if (packet.protocol === "MPLS") {
    const stack = shimStack(packet);
    if (packet.badge === "POP") return { title: "POP (PHP)", detail: `Data plane · ${stackText(stack)} → R6`, color };
    return { title: packet.summary, detail: `Data plane · stack ${stackText(stack)}`, color };
  }
  if (packet.protocol === "IP") return { title: "IP (unlabeled)", detail: `Data plane · ${packet.summary}`, color };
  return packetCallout(packet);
}
