import type { PacketVisual } from "@/lib/sim-engine/types";
import type { PacketCallout3D } from "@/components/network3d/types";
import { PROTOCOL_HEX, packetCallout } from "@/components/lesson/packetCallout";
import { shimStack, stackText } from "@/components/lesson/mplsStack";

/** The scenario tags LDP messages as protocol "MPLS" (layer "LDP"); name them by what they are. */
const LDP_TITLE: Record<string, string> = { HELLO: "LDP Hello", SESSION: "LDP Session", "LABEL MAPPING": "LDP Label Mapping" };

const afterDash = (summary: string) => summary.split(" — ").slice(1).join(" — ") || undefined;

/** Lesson-local callout: LDP is control plane, labeled packets are data plane, and the stack comes from the packet itself. */
export function ldpCallout(packet: PacketVisual): PacketCallout3D {
  const color = PROTOCOL_HEX[packet.protocol];
  if (packet.layers[0]?.name === "LDP") {
    const detail = afterDash(packet.summary);
    return { title: LDP_TITLE[packet.badge ?? ""] ?? "LDP", detail: `Control plane${detail ? ` · ${detail}` : ""}`, color };
  }
  if (packet.protocol === "MPLS") {
    const stack = shimStack(packet);
    if (packet.badge === "POP") return { title: "POP (PHP)", detail: `Data plane · ${stackText(stack)} → PE2`, color };
    return { title: packet.summary, detail: `Data plane · stack ${stackText(stack)}`, color };
  }
  if (packet.protocol === "IP") return { title: "IP (unlabeled)", detail: `Data plane · ${packet.summary}`, color };
  return packetCallout(packet);
}
