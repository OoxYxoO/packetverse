import type { PacketVisual } from "@/lib/sim-engine/types";
import type { PacketCallout3D } from "@/components/network3d/types";
import { PROTOCOL_HEX, packetCallout } from "./packetCallout";
import { shimStack, type ShimView } from "./mplsStack";

/**
 * Readable callouts for the L2VPN family (VPWS, VPLS, BGP-VPLS, H-VPLS,
 * Evolution). Everything is read back from the PacketVisual the scenario
 * built from state — labels, S bits, MACs, NLRI fields — never invented.
 */

const BROADCAST = "ff:ff:ff:ff:ff:ff";
const field = (packet: PacketVisual, layerName: string, label: string) => packet.layers.find((l) => l.name.startsWith(layerName))?.fields.find((f) => f.label === label)?.value;
const shortMac = (mac?: string) => (mac ? (mac === BROADCAST ? "broadcast" : mac.slice(-5)) : "?");

/** "Transport 102 S0 / PW 25001 S1" — `serviceName` names the inner (service) label per lesson. */
export function l2vpnStackText(stack: ShimView[], serviceName = "PW"): string {
  if (stack.length === 0) return "no labels (Ethernet only)";
  return stack.map((l) => `${l.purpose === "transport" ? "Transport" : serviceName} ${l.label} S${l.s}`).join(" / ");
}

export function l2vpnCallout(packet: PacketVisual, opts: { serviceName?: string } = {}): PacketCallout3D {
  const color = PROTOCOL_HEX[packet.protocol];
  const first = packet.layers[0]?.name ?? "";

  if (first === "Targeted LDP") {
    const fec = field(packet, "Targeted LDP", "FEC");
    // "PE1→ label: 24012" fields are the label that PE advertised, i.e. its own RECEIVE label.
    const labels = packet.layers[0].fields.filter((f) => /→ label$/.test(f.label)).map((f) => `${f.label.replace(/→ label$/, "").trim()} receives on ${f.value}`);
    const single = field(packet, "Targeted LDP", "Label");
    if (packet.badge === "MAPPING") {
      const detail = [fec, single ? `${packet.from} receives on ${single}` : undefined, ...labels].filter(Boolean).join(" · ");
      return { title: `LDP PW Label Mapping${/spoke|mesh/i.test(packet.summary) ? ` (${/spoke/i.test(packet.summary) ? "spoke" : "mesh"})` : ""}`, detail: `Control plane · ${detail}`, color };
    }
    const kind = packet.badge === "HELLO" ? "Hello (unicast)" : packet.badge === "TCP" ? "TCP session" : packet.badge === "INIT" ? "Initialization" : packet.summary;
    return { title: `Targeted LDP ${kind}`, detail: "Control plane · PE loopback ↔ PE loopback, no customer data", color };
  }

  if (packet.protocol === "BGP") {
    const withdraw = packet.badge === "WITHDRAW";
    if (/EVPN/.test(first)) return { title: "EVPN Type 2 (MAC/IP)", detail: `Control plane · ${packet.summary.split(" — ")[1] ?? packet.summary}`, color };
    const ve = field(packet, "MP-BGP", "VE ID");
    const lb = field(packet, "MP-BGP", "Label Base");
    const vbo = field(packet, "MP-BGP", "VE Block Offset");
    const vbs = field(packet, "MP-BGP", "VE Block Size");
    const rt = field(packet, "MP-BGP", "Route Target");
    const detail = ve ? `VE ${ve} · block VBO ${vbo}/VBS ${vbs}/LB ${lb} · RT ${rt}` : packet.summary;
    return { title: withdraw ? "BGP VPLS Withdrawal" : /reflected/i.test(packet.summary) ? "BGP VPLS NLRI (reflected)" : "BGP VPLS Advertisement", detail: `Control plane · ${detail} · no customer MACs`, color };
  }

  if (packet.protocol === "MPLS" && packet.layers.some((l) => l.name.startsWith("MPLS Shim") || l.name === "Ethernet")) {
    const stack = shimStack(packet);
    const dst = field(packet, "Ethernet", "Dst MAC");
    const frame = dst === BROADCAST ? "broadcast frame" : `frame → …${shortMac(dst)}`;
    return { title: packet.summary, detail: `Data plane · ${l2vpnStackText(stack, opts.serviceName)} · ${frame}`, color };
  }

  if (packet.layers.some((l) => l.name === "Ethernet")) {
    const src = field(packet, "Ethernet", "Src MAC");
    const dst = field(packet, "Ethernet", "Dst MAC");
    const kind = dst === BROADCAST ? "Broadcast frame" : /unknown/i.test(packet.summary) ? "Unknown-unicast frame" : /known/i.test(packet.summary) ? "Known-unicast frame" : "Ethernet frame";
    return { title: kind, detail: `Data plane · …${shortMac(src)} → ${dst === BROADCAST ? "ff:ff (all)" : `…${shortMac(dst)}`} · ${packet.summary}`, color };
  }

  return packetCallout(packet);
}

/** Destination MAC of the Ethernet frame inside a packet visual, if it carries one. */
export function frameDstMac(packet?: PacketVisual): string | undefined {
  return packet ? field(packet, "Ethernet", "Dst MAC") : undefined;
}

/**
 * Title for one of several simultaneous flood replicas, classified from the
 * replicated frame itself (its destination MAC), never from the lesson's
 * latest forwarding decision — that changes as copies reach other PEs.
 * A flooded unicast frame is, by definition, unknown unicast at the
 * replicating device; broadcast and multicast stay distinct BUM members.
 */
export function floodCopyTitle(dstMac: string | undefined, toId: string): string {
  if (!dstMac) return `BUM flood copy → ${toId}`;
  const firstOctet = parseInt(dstMac.slice(0, 2), 16);
  const kind = dstMac.toLowerCase() === BROADCAST ? "Broadcast" : firstOctet & 1 ? "Multicast" : "Unknown unicast";
  return `${kind} · BUM flood → ${toId}`;
}
