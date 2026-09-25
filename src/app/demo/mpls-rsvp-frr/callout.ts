import type { PacketVisual } from "@/lib/sim-engine/types";
import type { PacketCallout3D } from "@/components/network3d/types";
import { PROTOCOL_HEX, packetCallout } from "@/components/lesson/packetCallout";
import { shimStack, stackText } from "@/components/lesson/mplsStack";

/**
 * Lesson-local callout. The repair stack is named by role — Outer: bypass
 * label, Inner: protected-LSP label — and every value/S bit is read back
 * from the packet the scenario built from state.
 */
export function frrCallout(packet: PacketVisual): PacketCallout3D {
  const color = PROTOCOL_HEX[packet.protocol];
  if (packet.protocol === "MPLS") {
    const stack = shimStack(packet);
    const bypass = stack.find((l) => l.purpose === "bypass");
    const inner = stack.find((l) => l.purpose !== "bypass");
    const innerText = inner ? `protected LSP ${inner.label} S${inner.s}` : "no labels (plain IP)";
    if (packet.badge === "SWAP+PUSH") {
      return bypass
        ? { title: "FRR Repair", detail: `Outer: bypass ${bypass.label} S${bypass.s} · Inner: ${innerText}`, color }
        : { title: "FRR Repair (bypass popped at R4)", detail: `Inner: ${innerText} → Merge Point ${packet.to}`, color };
    }
    if (packet.summary.startsWith("POP BYPASS")) return { title: "Bypass PHP · POP outer only", detail: `Inner: ${innerText} → Merge Point ${packet.to}`, color };
    if (packet.summary.includes("resumed")) return { title: `Merge Point ${packet.from} · resume normal`, detail: `Data plane · ${packet.badge} → ${stack.length ? `stack ${stackText(stack)}` : "plain IP"} to ${packet.to}`, color };
    if (packet.badge === "POP") return { title: "POP (PHP)", detail: `Data plane · ${stackText(stack)} → ${packet.to}`, color };
    const top = stack[0]?.label;
    return { title: top ? `${packet.badge} ${packet.badge === "SWAP" ? "→ " : ""}${top}` : packet.summary, detail: `Data plane · stack ${stackText(stack)}`, color };
  }
  if (packet.protocol === "IP") return { title: "IP (unlabeled)", detail: `Data plane · ${packet.summary}`, color };
  return packetCallout(packet);
}
