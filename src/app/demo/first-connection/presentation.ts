import type { PacketVisual } from "@/lib/sim-engine/types";
import type { PacketCallout3D } from "@/components/network3d/types";
import type { BriefingPhase } from "@/components/lesson/MissionBriefingCard";

/**
 * First-connection presentation data — purely what the learner reads
 * about each step (objective / "right now" / key takeaway) and how an
 * in-flight packet is labeled. Nothing here changes scenario state or
 * progression; the scenario's own `label`/`narrative` stay the source
 * of the step title and context text.
 */
export interface StepBriefing {
  phase: BriefingPhase;
  objective: string;
  doingNow: string;
  takeaway?: string;
}

export const STEP_BRIEFING: Record<string, StepBriefing> = {
  mission: {
    phase: { label: "Mission", tone: "cyan" },
    objective: "Open an HTTPS session from the Laptop (192.168.10.10) to the Server (10.20.20.20).",
    doingNow: "Reading the mission. Nothing has been sent on the wire yet.",
    takeaway: "The Server is on a different subnet, so every packet must go through the default gateway.",
  },
  "plan-question": {
    phase: { label: "Plan", tone: "violet" },
    objective: "Work out what the Laptop still needs before it can build its first frame.",
    doingNow: "Comparing 10.20.20.20 with the Laptop's own 192.168.10.0/24. It doesn't match, so the traffic goes to the gateway.",
    takeaway: "An off-subnet destination means the next hop is the gateway, and Ethernet needs the gateway's MAC.",
  },
  "arp-request": {
    phase: { label: "ARP", tone: "arp" },
    objective: "Resolve the gateway's IP (192.168.10.1) into its MAC address.",
    doingNow: "The Laptop broadcasts \"Who has 192.168.10.1?\" to FF:FF:FF:FF:FF:FF, and the Switch floods it out every other port in the VLAN.",
    takeaway: "The Laptop ARPs for the gateway, not the Server, because the Server is off-subnet.",
  },
  "arp-reply": {
    phase: { label: "ARP", tone: "arp" },
    objective: "Get the gateway's MAC back to the Laptop.",
    doingNow: "Only the Router owns 192.168.10.1, so it answers with a unicast ARP reply. The Laptop caches the entry and the Switch learns where both MACs live.",
    takeaway: "Requests are broadcast and replies are unicast. The answer is cached so the next frame needs no ARP.",
  },
  "predict-next": {
    phase: { label: "Plan", tone: "violet" },
    objective: "Decide what the Laptop sends now that ARP is solved.",
    doingNow: "The ARP cache holds 192.168.10.1 → 02:BB:00:00:00:01, so Layer 2 is ready.",
    takeaway: "The destination MAC is the gateway's, but the destination IP is still the Server's.",
  },
  "frame-to-gateway": {
    phase: { label: "Switching", tone: "ethernet" },
    objective: "Deliver the frame across the LAN to the Router.",
    doingNow: "The Switch looks up destination MAC 02:BB:00:00:00:01, finds it on Fa0/2 and forwards out that single port. No flooding.",
    takeaway: "Switches forward on MAC addresses and never look at the IP destination.",
  },
  "router-forwards": {
    phase: { label: "Routing", tone: "ip" },
    objective: "Route the packet from the LAN onto the Server segment.",
    doingNow: "The Router matches 10.20.20.0/24, strips the old Ethernet header and builds a new one for the Server segment.",
    takeaway: "At every routed hop the MAC addresses change, while the source and destination IPs stay the same.",
  },
  "tcp-intro": {
    phase: { label: "TCP", tone: "tcp" },
    objective: "Open a reliable TCP connection to port 443 before any HTTPS data flows.",
    doingNow: "IP reachability is proven. Next, the Laptop and Server run the three-way handshake.",
  },
  "tcp-syn": {
    phase: { label: "TCP", tone: "tcp" },
    objective: "Start the handshake.",
    doingNow: "The Laptop sends a SYN with its initial sequence number (seq=100).",
  },
  "predict-synack": {
    phase: { label: "Plan", tone: "violet" },
    objective: "Predict the Server's response.",
    doingNow: "The Server has received the SYN and is deciding how to answer.",
  },
  "tcp-synack": {
    phase: { label: "TCP", tone: "tcp" },
    objective: "Acknowledge the client and share the Server's own sequence number.",
    doingNow: "The Server sends SYN-ACK (seq=300, ack=101).",
  },
  "predict-ack": {
    phase: { label: "Plan", tone: "violet" },
    objective: "Predict the final handshake segment.",
    doingNow: "The Laptop has the SYN-ACK. One segment remains.",
  },
  "tcp-ack": {
    phase: { label: "TCP", tone: "tcp" },
    objective: "Complete the three-way handshake.",
    doingNow: "The Laptop sends ACK (seq=101, ack=301). Both sides are now ESTABLISHED.",
    takeaway: "TLS and the HTTPS request only start after this handshake.",
  },
  complete: {
    phase: { label: "Complete", tone: "success" },
    objective: "Review the full journey.",
    doingNow: "The TCP session is established end to end.",
  },
};

/** Hex mirrors of the --pv-proto-* tokens (three.js needs real color values). */
const PROTOCOL_HEX: Partial<Record<PacketVisual["protocol"], string>> = {
  ARP: "#f59e0b",
  ETHERNET: "#94a3b8",
  IP: "#60a5fa",
  TCP: "#34d399",
  HTTPS: "#a78bfa",
};

export function packetKindLabel(packet: PacketVisual): string {
  if (packet.protocol === "ARP") return packet.broadcast ? "ARP Request · Broadcast" : "ARP Reply · Unicast";
  if (packet.protocol === "TCP") return `TCP ${packet.summary.split(",")[0]}`;
  if (packet.protocol === "IP") return "IPv4 Packet";
  return packet.badge ?? packet.protocol;
}

export function packetColor(packet: PacketVisual): string {
  return PROTOCOL_HEX[packet.protocol] ?? "#67e8f9";
}

export function packetCalloutFor(packet: PacketVisual): PacketCallout3D {
  return { title: packetKindLabel(packet), detail: packet.summary, color: packetColor(packet) };
}
