import { DL_ADDR, DL_IFACES, type DlHop, type DlNode, type DlPacket } from "@/lib/sim-engine/scenarios/dhcpDnsLab";

/**
 * Plain language for the DHCP & DNS Lab's beginner levels. Everything is derived from the model's real packets and
 * device actions (hops), so the words a beginner reads always match what the simulation did. No jargon unless the
 * level has introduced it.
 */

export const field = (p: DlPacket, k: string) => p.layers.flatMap((l) => l.fields).find((f) => f.k === k)?.v;
export const PLAIN_NAME: Record<DlNode, string> = { CLIENT: "the laptop", SW1: "switch SW1", R1: "router R1", SW2: "switch SW2", "DHCP-SRV": "the DHCP server", "DNS-SRV": "the DNS server", WEB: "the web server" };
const Cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const who = (ip: string): string => {
  const a = ip.split(":")[0];
  if (a === "0.0.0.0" || a === DL_ADDR.C) return "Laptop";
  if (a === DL_ADDR.RC || a === DL_ADDR.RS) return "R1";
  if (a === DL_ADDR.SRV) return "DHCP server";
  if (a === DL_ADDR.DNS) return "DNS server";
  if (a === "255.255.255.255") return "everyone";
  return a;
};

/** One line of the conversation: who says what to whom, in everyday words. */
export function plainMessage(p: DlPacket): { from: string; to: string; says: string } {
  const from = who(p.src);
  const to = p.dst.startsWith("255.255.255.255") ? (p.src === DL_ADDR.RC ? "everyone on the laptop's network" : "everyone") : who(p.dst);
  const relayed = p.src === DL_ADDR.RS && p.proto === "DHCP";
  switch (p.msg) {
    case "DISCOVER":
      return relayed ? { from, to, says: "A laptop on network 10.10.10.0/24 is asking for settings. Can you help?" } : { from, to, says: "Is there a DHCP server? I need network settings!" };
    case "OFFER":
      return { from, to, says: `I can offer the address ${field(p, "yiaddr")}.` };
    case "REQUEST":
      if (field(p, "ciaddr") && field(p, "ciaddr") !== "0.0.0.0") return { from, to, says: `Can I keep using ${field(p, "ciaddr")} for longer?` };
      return { from, to, says: relayed ? `The laptop accepts ${field(p, "opt 50 requested IP")}.` : `Yes please, I'll take ${field(p, "opt 50 requested IP")}.` };
    case "ACK":
      return { from, to, says: `Confirmed: ${field(p, "yiaddr")} is yours. Your router is ${field(p, "opt 3 router")}, your DNS server is ${field(p, "opt 6 DNS")}.` };
    case "RELEASE":
      return { from, to, says: "I don't need my address any more." };
    case "ARP request":
      return { from, to: "everyone", says: `Who has ${field(p, "target IP")}? I need its hardware (MAC) address to send to it.` };
    case "ARP reply":
      return { from, to, says: `That's me: ${field(p, "sender IP")}.` };
    case "DNS query":
      return { from, to, says: `What is the address of ${(field(p, "Question") ?? "").replace(" A IN", "")}?` };
    case "DNS response": {
      const a = field(p, "Answer");
      return { from, to, says: a ? `It's ${a.split(" A ")[1]}.` : "There is no such name." };
    }
    case "Port unreachable":
      return { from, to, says: "Your message arrived, but no program here is listening for it." };
    case "Echo request":
      return { from, to, says: "Are you there? (ping)" };
    case "Echo reply":
      return { from, to, says: "Yes, I'm here." };
  }
}

/** What one device did with the message, in plain words (from the model's action). */
export function plainHop(p: DlPacket, h: DlHop): string {
  const dev = Cap(PLAIN_NAME[h.node]);
  const next = h.out.length ? PLAIN_NAME[DL_IFACES[DL_IFACES[h.out[0]].peer].node] : "";
  switch (h.act) {
    case "send":
      return `${dev} sends it.`;
    case "flood":
      return `${dev} passes it on to every other cable: it is addressed to everyone. A switch doesn't read what's inside.`;
    case "forward":
      return `${dev} passes it on, only towards ${next}.`;
    case "relay":
      return h.in === "R1:ge-0/0/0" ? "Router R1 catches the broadcast (routers don't pass broadcasts on) and sends a copy directly to the DHCP server, with a note saying which network the laptop is in." : "Router R1 passes the server's answer back onto the laptop's network.";
    case "route":
      return `Router R1 forwards it to the other network, like any normal message.`;
    case "deliver":
      return h.node === "DHCP-SRV" || h.node === "DNS-SRV" ? `${dev} receives it and works out an answer.` : `${dev} receives it.`;
    case "drop":
      return h.node === "R1" && p.proto === "DHCP" ? "Router R1 throws it away: routers don't pass broadcasts on, and no relay is set up." : `${dev} can't deliver it any further, so it's thrown away.`;
    case "reject":
      return `${dev} receives it, but the program that should answer isn't running, so it replies “nobody is listening here”.`;
    case "ignore":
      return `${dev} sees it, but it isn't meant for them.`;
    case "unanswered":
      return `${dev} receives it but doesn't answer.`;
  }
}

/** The devices in the order they handled a whole message (all its legs), without flooded copies nobody wanted. */
export function plainJourney(packets: DlPacket[]): { p: DlPacket; h: DlHop }[] {
  return packets.flatMap((p) => p.hops.filter((h, i) => h.act !== "ignore" || i === p.hops.length - 1).map((h) => ({ p, h })));
}

/** Short role of each device, for beginners. */
export const ROLE: Record<Exclude<DlNode, "WEB">, { icon: string; title: string; job: string }> = {
  CLIENT: { icon: "💻", title: "The laptop (client)", job: "Needs settings to use the network. It asks for them, then uses them." },
  SW1: { icon: "⇄", title: "Switch SW1", job: "Connects the devices of one network with cables. It passes messages along without reading them." },
  R1: { icon: "R", title: "Router R1", job: "Connects two networks. It doesn't pass broadcasts from one network to the other, so here it also acts as a DHCP relay." },
  SW2: { icon: "⇄", title: "Switch SW2", job: "Connects the servers' network. Like SW1, it just passes messages along." },
  "DHCP-SRV": { icon: "🗄", title: "The DHCP server", job: "Hands out addresses and settings (address, router, DNS server) for a limited time: a lease." },
  "DNS-SRV": { icon: "🗄", title: "The DNS server", job: "Answers “what is the address of this name?”" },
};
