import type { PacketVisual } from "@/lib/sim-engine/types";
import type { PacketCallout3D } from "@/components/network3d/types";
import { PROTOCOL_HEX, packetCallout } from "@/components/lesson/packetCallout";
import { shimStack, type ShimView } from "@/components/lesson/mplsStack";

const afterDash = (summary: string) => summary.split(" — ").slice(1).join(" — ") || undefined;

/** Names each label by its job: OUTER = transport (LDP), INNER = VPN (MP-BGP). */
function roleStack(stack: ShimView[]): string {
  if (stack.length === 0) return "no labels (plain IP)";
  if (stack.length === 1) return `${stack[0].purpose === "vpn" ? "VPN only" : "Transport only"}: ${stack[0].label} S${stack[0].s}`;
  return stack.map((l, i) => `${i === 0 ? "OUTER" : "INNER"} ${l.purpose === "vpn" ? "VPN" : "transport"} ${l.label} S${l.s}`).join(" / ");
}

/** Lesson-local callout: MP-BGP is control plane; the labeled packet is data plane, with its stack read from the packet itself. */
export function l3vpnCallout(packet: PacketVisual): PacketCallout3D {
  const color = PROTOCOL_HEX[packet.protocol];
  if (packet.protocol === "BGP") {
    const detail = afterDash(packet.summary) ?? packet.summary;
    return { title: "MP-BGP VPNv4 UPDATE", detail: `Control plane · ${detail}`, color };
  }
  if (packet.protocol === "MPLS") {
    const stack = shimStack(packet);
    const title = packet.badge === "POP" ? "PHP: POP outer label only" : packet.summary;
    return { title, detail: `Data plane · ${roleStack(stack)}`, color };
  }
  if (packet.protocol === "IP") return { title: "IP (unlabeled)", detail: `Data plane · ${packet.summary}`, color };
  return packetCallout(packet);
}
