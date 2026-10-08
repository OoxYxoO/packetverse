import { DL_ADDR, DL_IFACES, DL_NODE_IFACES, type DlHop, type DlIface, type DlNode, type DlObs, type DlPacket, type DlState } from "@/lib/sim-engine/scenarios/dhcpDnsLab";

/**
 * Coaching for the DHCP & DNS Lab's observation points. Everything here READS the lab's packets (hops + obs); it
 * never invents traffic. It turns "this frame crossed this interface" into what an engineer concludes from it, and
 * what they can't conclude yet.
 */

export type Coach = "guide" | "hints" | "off";
export type InspectNode = Exclude<DlNode, "WEB">;
export const INSPECTABLE: InspectNode[] = ["CLIENT", "SW1", "R1", "SW2", "DHCP-SRV", "DNS-SRV"];

export const DEVICE_INFO: Record<DlNode, { role: string; look: string; cannot: string; capture: string }> = {
  CLIENT: {
    role: "The user's laptop: where the symptom is felt.",
    look: "Start here. What identity did DHCP give it (address, gateway, DNS server)? Is it answering from its DNS cache? Did it actually transmit anything?",
    cannot: "It can't show you what happened to its frames after they left the cable.",
    capture: "A packet capture on the laptop's own network card (Wireshark / tcpdump).",
  },
  SW1: {
    role: "The client LAN's access switch (Layer 2 only).",
    look: "Prove the client's frames arrive (MAC table, port counters) and leave towards R1. A mirror port (SPAN) lets you capture what one port sends and receives.",
    cannot: "A switch never reads IP, UDP, DHCP or DNS. It can prove frames passed through, never that DHCP or DNS worked.",
    capture: "A mirror (SPAN) session copies this port's traffic to an analyser.",
  },
  R1: {
    role: "The client LAN's gateway, and the DHCP relay between the two LANs.",
    look: "The boundary between the LANs. Does the client's broadcast arrive on ge-0/0/0? Does a relayed unicast leave ge-0/0/1? Is a helper configured? Does R1 have ARP entries for its next hops?",
    cannot: "R1 can prove it forwarded a request, not that the server's service processed it.",
    capture: "An embedded capture on the router interface (Cisco monitor capture, Junos monitor traffic).",
  },
  SW2: {
    role: "The server LAN's switch (Layer 2 only).",
    look: "Prove the relayed DHCP packet or the DNS query actually reached the server's port, and that replies came back up to R1.",
    cannot: "Like SW1, it can't see whether the server's application answered correctly.",
    capture: "A mirror (SPAN) session copies this port's traffic to an analyser.",
  },
  "DHCP-SRV": {
    role: "Runs the DHCP service (dhcpd) that leases 10.10.10.0/24.",
    look: "Did the request reach the host (capture on eth0)? Is the service running and listening on UDP 67? What does its log say about this client? Are there free leases?",
    cannot: "It can't see what happens to its reply after it leaves. Follow the reply back to prove the client got it.",
    capture: "tcpdump on the server's eth0.",
  },
  "DNS-SRV": {
    role: "Runs the DNS service (named) for packetverse.test.",
    look: "Did the query arrive? Is the service listening on UDP 53? Did it log the query, and what did it answer?",
    cannot: "It only knows about queries that reach it. A client pointed at the wrong DNS server never shows up here at all.",
    capture: "tcpdump on the server's eth0.",
  },
  WEB: {
    role: "Outside your network.",
    look: "You can't capture on the internet. You can prove a packet left through R1 ge-0/0/2, and whether a reply came back.",
    cannot: "Whether the far end exists, beyond the reply you did or didn't get.",
    capture: "Not available: not your network.",
  },
};

const isHost = (n: DlNode) => n === "CLIENT" || n === "DHCP-SRV" || n === "DNS-SRV" || n === "WEB";
const isSw = (n: DlNode) => n === "SW1" || n === "SW2";
export const ifaceLabel = (i: DlIface, nm: (i: DlIface) => string = (x) => DL_IFACES[x].name) => `${DL_IFACES[i].node} ${nm(i)}`;

/** One-line "what it is" for a captured frame: proto, addresses, the key field. */
export function frameSummary(p: DlPacket): string {
  return p.info;
}

export interface ObsMeaning {
  /** What this row means, in one sentence (all coaching levels except off). */
  means: string;
  proves: string;
  notProves: string;
  next?: string;
}
/** What an engineer can conclude from seeing this packet at this interface, in this direction. */
export function obsMeaning(p: DlPacket, o: DlObs, hop: DlHop | undefined, nm: (i: DlIface) => string = (x) => DL_IFACES[x].name): ObsMeaning {
  const info = { ...DL_IFACES[o.iface], name: nm(o.iface) };
  const node = info.node;
  const what = p.msg;
  const k = p.obs.indexOf(o);
  const nx = p.obs[k + 1];
  const nextLine = nx ? `Next point on its way: ${ifaceLabel(nx.iface, nm)} (${nx.dir === "in" ? "arriving" : "leaving"}).` : undefined;
  if (o.dir === "out") {
    if (isHost(node))
      return {
        means: `${node} transmitted the ${what} out ${info.name}.`,
        proves: `${node} really sent it. Whatever happens next, the problem isn't "it was never sent".`,
        notProves: "That anyone received it.",
        next: nextLine,
      };
    if (isSw(node))
      return {
        means: `${node} sent the frame out ${info.name}, towards ${info.faces}${hop?.act === "flood" ? " (flooded: it was a broadcast)" : ""}.`,
        proves: `${node} passed it on towards ${info.faces}.`,
        notProves: `That ${info.faces} accepted it. Switches only move frames.`,
        next: nextLine,
      };
    const relayed = p.src === DL_ADDR.RS || p.src === DL_ADDR.RC;
    return {
      means: relayed ? `R1 sent a packet it created itself out ${info.name}: the relay agent's copy (source ${p.src}).` : `R1 routed the ${what} out ${info.name} towards ${info.faces}.`,
      proves: relayed ? "The relay agent is working: it took the client's broadcast and re-sent it." : "R1 had a route and a next-hop MAC, so it forwarded the packet.",
      notProves: "That the next device answered.",
      next: nextLine,
    };
  }
  // arriving
  const end = hop && hop.out.length === 0;
  const fate = !hop ? "" : hop.act === "drop" ? " …and dropped it here." : hop.act === "reject" ? " …and rejected it (port unreachable)." : hop.act === "ignore" ? " …and ignored it (not for this device)." : hop.act === "unanswered" ? " …and never answered." : hop.act === "relay" && hop.out.length === 0 ? " …and handed it to the relay agent." : "";
  if (isHost(node))
    return {
      means: `${node}'s network card received the ${what} on ${info.name}.${fate}`,
      proves: `The ${what} made it all the way to ${node}: the path to it works.`,
      notProves: node === "CLIENT" ? "That the client accepted it: check its configuration and state." : hop?.act === "reject" ? "Nothing more: the host received it, but no service took it." : `That ${node}'s service processed it correctly: check its status and log.`,
      next: end ? `${hop?.text ?? ""}` : nextLine,
    };
  if (isSw(node))
    return {
      means: `${node} received the frame on ${info.name}, from ${info.faces}.`,
      proves: `The frame crossed the cable into ${node}: that link and port work.`,
      notProves: `That ${node} forwarded it. Look at its other ports.`,
      next: nextLine,
    };
  return {
    means: `R1 received the ${what} on ${info.name}.${fate}`,
    proves: `The ${what} reached the router.`,
    notProves: hop?.act === "drop" ? "Nothing beyond R1: it never left. Prove it by checking R1's other interface." : "That R1 forwarded or relayed it. Check the other interface.",
    next: end ? hop?.text : nextLine,
  };
}

export interface JourneyStop {
  p: DlPacket;
  hop: DlHop;
}
/** The devices a message visited, in order, across all its legs. */
export function journeyStops(packets: DlPacket[]): JourneyStop[] {
  return packets.flatMap((p) => p.hops.filter((h) => h.act !== "ignore" || p.hops.indexOf(h) === p.hops.length - 1).map((hop) => ({ p, hop })));
}
/** Where the message ended up, and how. */
export function journeyEnd(packets: DlPacket[]): { node: DlNode; act: DlHop["act"]; text: string } | undefined {
  const last = packets[packets.length - 1];
  if (!last) return undefined;
  const h = [...last.hops].reverse().find((x) => x.act !== "ignore") ?? last.hops[last.hops.length - 1];
  return { node: h.node, act: h.act, text: h.text };
}
export const ACT_LABEL: Record<DlHop["act"], string> = {
  send: "sent",
  flood: "flooded",
  forward: "forwarded",
  relay: "relayed",
  route: "routed",
  deliver: "received",
  drop: "dropped",
  ignore: "ignored",
  reject: "rejected",
  unanswered: "no answer",
};
export const ACT_TONE: Record<DlHop["act"], "ok" | "bad" | "muted"> = { send: "ok", flood: "ok", forward: "ok", relay: "ok", route: "ok", deliver: "ok", drop: "bad", ignore: "muted", reject: "bad", unanswered: "bad" };

/** Interfaces of a device and how many frames crossed each, for the device view. */
export const nodeIfaces = (n: DlNode) => DL_NODE_IFACES[n];

/** Message picker label: "DISCOVER · xid 0x3903f326 · #12". */
export function journeyLabel(packets: DlPacket[]): string {
  const p = packets[0];
  const id = p.layers.flatMap((l) => l.fields).find((f) => f.k === "xid" || f.k === "Transaction ID")?.v;
  const arp = p.proto === "ARP" ? p.layers.find((l) => l.name.startsWith("ARP"))?.fields : undefined;
  const arpWho = arp ? (p.msg === "ARP request" ? ` for ${arp.find((f) => f.k === "target IP")?.v}` : `: ${arp.find((f) => f.k === "sender IP")?.v} is here`) : "";
  return `${p.msg}${id ? ` · ${id}` : ""}${arpWho}${p.proto === "ICMP" && p.msg !== "Port unreachable" ? ` → ${packets[packets.length - 1].dst}` : ""}`;
}
/** Journeys in the capture, newest first, with the packets of each. */
export function journeys(s: DlState): { id: string; packets: DlPacket[]; recent: boolean }[] {
  const map = new Map<string, DlPacket[]>();
  for (const p of s.capture) map.set(p.journey, [...(map.get(p.journey) ?? []), p]);
  return [...map.entries()].map(([id, packets]) => ({ id, packets, recent: packets.some((p) => s.lastPackets.includes(p.no)) })).reverse();
}

export type CapFilter = "all" | "dhcp" | "dns" | "arp" | "icmp";
export const CAP_FILTERS: { id: CapFilter; label: string; bpf: string }[] = [
  { id: "all", label: "everything", bpf: "" },
  { id: "dhcp", label: "DHCP", bpf: "udp port 67 or udp port 68" },
  { id: "dns", label: "DNS", bpf: "udp port 53" },
  { id: "arp", label: "ARP", bpf: "arp" },
  { id: "icmp", label: "ICMP", bpf: "icmp" },
];
export const capMatch = (f: CapFilter, p: DlPacket) => f === "all" || (f === "dhcp" && p.proto === "DHCP") || (f === "dns" && p.proto === "DNS") || (f === "arp" && p.proto === "ARP") || (f === "icmp" && p.proto === "ICMP");
/** A tcpdump-style one-liner for a captured frame at a point. */
export function tcpdumpLine(p: DlPacket, o: DlObs): string {
  const l2 = `${o.srcMac.toLowerCase()} > ${o.dstMac.toLowerCase()}`;
  if (p.proto === "ARP") return `${o.dir === "in" ? "In " : "Out"} ${l2}, ARP, ${p.info.replace(/^ARP /, "")}`;
  const ports = p.layers.find((l) => l.name === "UDP")?.fields.map((f) => f.v) ?? [];
  const srcIp = p.src.split(":")[0];
  const dstIp = p.dst.split(":")[0];
  const ttl = o.ttl !== undefined ? ` ttl ${o.ttl}` : "";
  const addr = ports.length ? `${srcIp}.${ports[0]} > ${dstIp}.${ports[1]}` : `${srcIp} > ${dstIp}`;
  return `${o.dir === "in" ? "In " : "Out"} ${l2},${ttl} ${addr}: ${p.info}`;
}
