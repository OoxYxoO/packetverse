import type { DeviceKind, NetNode, PacketVisual, ScenarioStep } from "../types";

/**
 * THE FLAGSHIP DEMO (project brief §45/46)
 *
 *   Laptop → Switch → Router → Server
 *
 * A learner opens an HTTPS site hosted on a remote subnet. This single
 * scenario walks: "what do I need before I can send?" → ARP → switched
 * (MAC-table) forwarding → routing lookup → TCP three-way handshake.
 *
 * This file is PURE data + PURE functions — no React, no Three.js, no
 * DOM. It is the "networking logic" half of the architecture described
 * in §40; components in /components/network and /app/demo render it.
 */

export interface FirstConnectionState {
  nodes: Record<string, NetNode>;
  arpTable: Record<string, Record<string, string>>;
  macTable: Record<string, Record<string, string>>;
  routingTable: Record<
    string,
    { network: string; iface: string; note: string; matched?: boolean }[]
  >;
  tcp: {
    state: "CLOSED" | "SYN_SENT" | "SYN_RECEIVED" | "ESTABLISHED";
    clientSeq?: number;
    serverSeq?: number;
  };
  deliveredToServer: boolean;
}

export const ADDR = {
  laptop: { ip: "192.168.10.10", mac: "02:AA:00:00:00:01" },
  gateway: { ip: "192.168.10.1", mac: "02:BB:00:00:00:01" },
  routerWan: { ip: "10.20.20.1", mac: "02:BB:00:00:00:02" },
  server: { ip: "10.20.20.20", mac: "02:CC:00:00:00:01" },
};

export function createFirstConnectionState(): FirstConnectionState {
  const nodes: Record<string, NetNode> = {
    laptop: { id: "laptop", label: "Laptop", kind: "laptop", ip: ADDR.laptop.ip, mac: ADDR.laptop.mac, track: 0.04 },
    switch: { id: "switch", label: "Access Switch", kind: "switch", track: 0.36 },
    router: { id: "router", label: "Router", kind: "router", ip: ADDR.gateway.ip, mac: ADDR.gateway.mac, track: 0.68 },
    server: { id: "server", label: "Server", kind: "server", ip: ADDR.server.ip, mac: ADDR.server.mac, track: 0.96 },
  };
  return {
    nodes,
    arpTable: { laptop: {} },
    macTable: { switch: {} },
    routingTable: {
      router: [
        { network: "192.168.10.0/24", iface: "ge-0/0/0 (LAN)", note: "Directly connected" },
        { network: "10.20.20.0/24", iface: "ge-0/0/1 (Server segment)", note: "Directly connected" },
        { network: "0.0.0.0/0", iface: "ge-0/0/2 (WAN)", note: "Default route" },
      ],
    },
    tcp: { state: "CLOSED" },
    deliveredToServer: false,
  };
}

export type FirstConnectionDeviceId = "laptop" | "switch" | "router" | "server";

/** Linear physical chain, left to right — the same order the original `track` values implied. */
export const DEVICE_ORDER: FirstConnectionDeviceId[] = ["laptop", "switch", "router", "server"];

interface GNode {
  id: FirstConnectionDeviceId;
  label: string;
  x: number;
  y: number;
  subLabel?: string;
  kind: DeviceKind;
}
interface GLink {
  id: string;
  a: FirstConnectionDeviceId;
  b: FirstConnectionDeviceId;
  label?: string;
}

/** Percent-space {x,y} layout for `layoutTo3D` — one straight LAN→WAN chain, no branching. */
export const GRAPH_NODES: GNode[] = [
  { id: "laptop", label: "Laptop", x: 8, y: 50, subLabel: ADDR.laptop.ip, kind: "laptop" },
  { id: "switch", label: "Access Switch", x: 37, y: 50, kind: "switch" },
  { id: "router", label: "Router", x: 63, y: 50, subLabel: ADDR.gateway.ip, kind: "router" },
  { id: "server", label: "Server", x: 92, y: 50, subLabel: ADDR.server.ip, kind: "server" },
];
export const GRAPH_LINKS: GLink[] = [
  { id: "laptop-switch", a: "laptop", b: "switch", label: "LAN Access" },
  { id: "switch-router", a: "switch", b: "router", label: "LAN Access" },
  { id: "router-server", a: "router", b: "server", label: "Server Segment" },
];

/** Every physical link id the path from `from` to `to` actually traverses (linear topology → a contiguous slice of GRAPH_LINKS). */
export function linksOnPath(from: string, to: string): string[] {
  const i = DEVICE_ORDER.indexOf(from as FirstConnectionDeviceId);
  const j = DEVICE_ORDER.indexOf(to as FirstConnectionDeviceId);
  if (i === -1 || j === -1) return [];
  const [lo, hi] = i < j ? [i, j] : [j, i];
  return GRAPH_LINKS.slice(lo, hi).map((l) => l.id);
}

const eth = (src: string, dst: string) => ({
  name: "Ethernet II",
  color: "var(--pv-proto-ethernet)",
  fields: [
    { label: "Destination MAC", value: dst },
    { label: "Source MAC", value: src },
  ],
});

const ipLayer = (src: string, dst: string) => ({
  name: "IPv4",
  color: "var(--pv-proto-ip)",
  fields: [
    { label: "Source IP", value: src },
    { label: "Destination IP", value: dst },
    { label: "TTL", value: "64" },
  ],
});

export const firstConnectionSteps: ScenarioStep<FirstConnectionState>[] = [
  {
    id: "mission",
    label: "Mission Briefing",
    narrative:
      "You are the Laptop at 192.168.10.10. Mission: open an HTTPS session with the Server at 10.20.20.20 — a different subnet, reachable only through the Switch and Router. Nothing has been sent yet.",
  },
  {
    id: "plan-question",
    label: "Plan the Journey",
    narrative:
      "Before your PC can send a single packet toward a remote subnet, it has to resolve one piece of Layer 2 information first.",
    question: {
      prompt: "Before sending the packet to a remote subnet, what information does your PC need?",
      options: [
        { id: "dns", label: "DNS server address" },
        { id: "gw-mac", label: "Default gateway's MAC address" },
        { id: "bgp", label: "A BGP route" },
        { id: "mpls", label: "An MPLS label" },
      ],
      correctOptionId: "gw-mac",
      explanation:
        "Your PC already knows the destination is off-subnet (10.20.20.0/24 ≠ its own /24), so it must forward via its default gateway. To build the Ethernet frame it needs the gateway's MAC address — that's what ARP resolves. DNS, BGP and MPLS aren't relevant to a host sending its first packet on a LAN.",
    },
  },
  {
    id: "arp-request",
    label: "ARP Request",
    narrative:
      "Your PC has no entry for 192.168.10.1 in its ARP table yet, so it broadcasts a request: \"Who has 192.168.10.1? Tell 192.168.10.10.\" Every device on the switch's broadcast domain receives it.",
    packet: (): PacketVisual => ({
      id: "arp-req",
      protocol: "ARP",
      from: "laptop",
      to: "router",
      broadcast: true,
      summary: "Who has 192.168.10.1? Tell 192.168.10.10",
      layers: [
        eth(ADDR.laptop.mac, "FF:FF:FF:FF:FF:FF"),
        {
          name: "ARP",
          color: "var(--pv-proto-arp)",
          fields: [
            { label: "Operation", value: "1 (Request)" },
            { label: "Sender MAC", value: ADDR.laptop.mac },
            { label: "Sender IP", value: ADDR.laptop.ip },
            { label: "Target MAC", value: "00:00:00:00:00:00 (unknown)" },
            { label: "Target IP", value: ADDR.gateway.ip },
          ],
        },
      ],
    }),
    run: (state) => ({
      state,
      events: [
        {
          type: "ARP_REQUEST_SENT",
          stepId: "arp-request",
          timestamp: Date.now(),
          message: "Laptop broadcasts ARP request for 192.168.10.1",
        },
      ],
    }),
  },
  {
    id: "arp-reply",
    label: "ARP Reply",
    narrative:
      "Every device saw the broadcast, but only the Router recognizes 192.168.10.1 as its own address. It replies directly — unicast — to the Laptop with its MAC address.",
    packet: (): PacketVisual => ({
      id: "arp-reply",
      protocol: "ARP",
      from: "router",
      to: "laptop",
      summary: `192.168.10.1 is at ${ADDR.gateway.mac}`,
      layers: [
        eth(ADDR.gateway.mac, ADDR.laptop.mac),
        {
          name: "ARP",
          color: "var(--pv-proto-arp)",
          fields: [
            { label: "Operation", value: "2 (Reply)" },
            { label: "Sender MAC", value: ADDR.gateway.mac },
            { label: "Sender IP", value: ADDR.gateway.ip },
            { label: "Target MAC", value: ADDR.laptop.mac },
            { label: "Target IP", value: ADDR.laptop.ip },
          ],
        },
      ],
    }),
    run: (state) => {
      const next: FirstConnectionState = {
        ...state,
        arpTable: { ...state.arpTable, laptop: { ...state.arpTable.laptop, [ADDR.gateway.ip]: ADDR.gateway.mac } },
        macTable: {
          ...state.macTable,
          switch: { ...state.macTable.switch, [ADDR.laptop.mac]: "Fa0/1 → Laptop", [ADDR.gateway.mac]: "Fa0/2 → Router" },
        },
      };
      return {
        state: next,
        events: [
          { type: "ARP_ENTRY_CREATED", stepId: "arp-reply", timestamp: Date.now(), message: "Laptop learns 192.168.10.1 → 02:BB:00:00:00:01" },
          { type: "MAC_LEARNED", stepId: "arp-reply", timestamp: Date.now(), message: "Switch learns MAC 02:AA:00:00:00:01 on Fa0/1" },
          { type: "MAC_LEARNED", stepId: "arp-reply", timestamp: Date.now(), message: "Switch learns MAC 02:BB:00:00:00:01 on Fa0/2" },
        ],
      };
    },
    whatChanged: (prev, next) => [
      `Laptop ARP table: 192.168.10.1 → ${next.arpTable.laptop[ADDR.gateway.ip]} (was empty)`,
      `Switch CAM table gained 2 entries (Fa0/1 → Laptop, Fa0/2 → Router)`,
    ],
  },
  {
    id: "predict-next",
    label: "Predict",
    narrative: "The Laptop now has everything it needs at Layer 2.",
    question: {
      prompt: "Now that the PC has the gateway's MAC address, what does it do next?",
      options: [
        { id: "send-frame", label: "Send the IP packet in a frame addressed to the gateway's MAC" },
        { id: "arp-server", label: "Send another ARP request, this time for the Server's IP" },
        { id: "bgp", label: "Advertise a BGP update for 10.20.20.0/24" },
        { id: "wait-dns", label: "Wait for a DNS response" },
      ],
      correctOptionId: "send-frame",
      explanation:
        "The destination IP stays the Server (10.20.20.20) — only the destination MAC is the gateway's. The gateway is a Layer 2 hop, not the final destination, so the PC never ARPs for the Server directly (it's off-subnet).",
    },
  },
  {
    id: "frame-to-gateway",
    label: "Switched Delivery",
    narrative:
      "The Laptop sends the frame — Ethernet destination MAC = gateway, IP destination = Server. The Switch already learned the Router's MAC on Fa0/2, so it forwards straight out that port instead of flooding.",
    packet: (): PacketVisual => ({
      id: "frame-1",
      protocol: "IP",
      from: "laptop",
      to: "router",
      summary: "IP packet toward 10.20.20.20, framed to the gateway",
      layers: [eth(ADDR.laptop.mac, ADDR.gateway.mac), ipLayer(ADDR.laptop.ip, ADDR.server.ip)],
    }),
    run: (state) => ({
      state: {
        ...state,
        routingTable: {
          router: state.routingTable.router.map((r) => ({ ...r, matched: r.network === "10.20.20.0/24" })),
        },
      },
      events: [
        { type: "PACKET_SENT", stepId: "frame-to-gateway", timestamp: Date.now(), message: "Switch forwards unicast frame out Fa0/2 (no flooding — MAC known)" },
        { type: "ROUTE_LOOKUP", stepId: "frame-to-gateway", timestamp: Date.now(), message: "Router looks up 10.20.20.20 in its routing table" },
        { type: "ROUTE_SELECTED", stepId: "frame-to-gateway", timestamp: Date.now(), message: "Matched 10.20.20.0/24 → ge-0/0/1" },
      ],
    }),
    whatChanged: () => [
      "Switch forwarded the frame directly to Fa0/2 — a known unicast MAC, no flooding needed.",
      "Router matched 10.20.20.0/24 in its routing table → outgoing interface ge-0/0/1.",
    ],
  },
  {
    id: "router-forwards",
    label: "Route & Rewrite",
    narrative:
      "The Router de-encapsulates the frame, confirms the route, and builds a brand-new Ethernet header for the Server segment. Watch closely: the IP header is untouched, but both MAC addresses change.",
    packet: (): PacketVisual => ({
      id: "frame-2",
      protocol: "IP",
      from: "router",
      to: "server",
      summary: "Same IP packet, new Ethernet header",
      layers: [eth(ADDR.routerWan.mac, ADDR.server.mac), ipLayer(ADDR.laptop.ip, ADDR.server.ip)],
    }),
    run: (state) => ({
      state: { ...state, deliveredToServer: true },
      events: [{ type: "PACKET_RECEIVED", stepId: "router-forwards", timestamp: Date.now(), message: "Server receives the IP packet" }],
    }),
    whatChanged: () => [
      "Frame delivered to Server.",
      "Ethernet header rewritten at every hop (src/dst MAC changed twice).",
      "IP header identical end-to-end — no NAT on this path.",
    ],
  },
  {
    id: "tcp-intro",
    label: "TCP Handshake",
    narrative:
      "The IP packet has arrived, but there's no connection yet. HTTPS runs over TCP port 443 — before any data flows, the Laptop and Server must complete a three-way handshake.",
  },
  {
    id: "tcp-syn",
    label: "SYN",
    narrative: "The Laptop opens the connection by sending a SYN segment with an initial sequence number.",
    packet: (): PacketVisual => ({
      id: "syn",
      protocol: "TCP",
      from: "laptop",
      to: "server",
      summary: "SYN, seq=100",
      layers: [
        eth(ADDR.laptop.mac, ADDR.gateway.mac),
        ipLayer(ADDR.laptop.ip, ADDR.server.ip),
        {
          name: "TCP",
          color: "var(--pv-proto-tcp)",
          fields: [
            { label: "Source Port", value: "51001" },
            { label: "Destination Port", value: "443" },
            { label: "Flags", value: "SYN" },
            { label: "Sequence", value: "100" },
          ],
        },
      ],
    }),
    run: (state) => ({
      state: { ...state, tcp: { state: "SYN_SENT", clientSeq: 100 } },
      events: [{ type: "TCP_STATE_CHANGED", stepId: "tcp-syn", timestamp: Date.now(), message: "Client: CLOSED → SYN_SENT" }],
    }),
  },
  {
    id: "predict-synack",
    label: "Predict",
    narrative: "The Server received the SYN.",
    question: {
      prompt: "What should the server send next?",
      options: [
        { id: "ack", label: "ACK" },
        { id: "syn", label: "SYN" },
        { id: "synack", label: "SYN-ACK" },
        { id: "fin", label: "FIN" },
      ],
      correctOptionId: "synack",
      explanation:
        "The server must both acknowledge the client's SYN and propose its own initial sequence number — that's one combined segment with SYN and ACK flags set.",
    },
  },
  {
    id: "tcp-synack",
    label: "SYN-ACK",
    narrative: "The Server acknowledges the client's SYN and sends its own sequence number back.",
    packet: (): PacketVisual => ({
      id: "synack",
      protocol: "TCP",
      from: "server",
      to: "laptop",
      summary: "SYN-ACK, seq=300, ack=101",
      layers: [
        eth(ADDR.server.mac, ADDR.routerWan.mac),
        ipLayer(ADDR.server.ip, ADDR.laptop.ip),
        {
          name: "TCP",
          color: "var(--pv-proto-tcp)",
          fields: [
            { label: "Source Port", value: "443" },
            { label: "Destination Port", value: "51001" },
            { label: "Flags", value: "SYN, ACK" },
            { label: "Sequence", value: "300" },
            { label: "Acknowledgment", value: "101" },
          ],
        },
      ],
    }),
    run: (state) => ({
      state: { ...state, tcp: { ...state.tcp, state: "SYN_RECEIVED", serverSeq: 300 } },
      events: [{ type: "TCP_STATE_CHANGED", stepId: "tcp-synack", timestamp: Date.now(), message: "Server: LISTEN → SYN_RECEIVED" }],
    }),
  },
  {
    id: "predict-ack",
    label: "Predict",
    narrative: "One segment remains to complete the handshake.",
    question: {
      prompt: "Complete the TCP handshake — what does the client send now?",
      options: [
        { id: "ack", label: "ACK, acknowledging the server's sequence number" },
        { id: "syn", label: "Another SYN" },
        { id: "synack", label: "SYN-ACK" },
        { id: "rst", label: "RST" },
      ],
      correctOptionId: "ack",
      explanation:
        "The client acknowledges the server's SYN (seq 300 → ack 301) with a plain ACK. Once the server sees it, both sides consider the connection ESTABLISHED.",
    },
  },
  {
    id: "tcp-ack",
    label: "ACK",
    narrative: "The Laptop sends the final ACK. The three-way handshake is complete.",
    packet: (): PacketVisual => ({
      id: "ack",
      protocol: "TCP",
      from: "laptop",
      to: "server",
      summary: "ACK, seq=101, ack=301",
      layers: [
        eth(ADDR.laptop.mac, ADDR.gateway.mac),
        ipLayer(ADDR.laptop.ip, ADDR.server.ip),
        {
          name: "TCP",
          color: "var(--pv-proto-tcp)",
          fields: [
            { label: "Source Port", value: "51001" },
            { label: "Destination Port", value: "443" },
            { label: "Flags", value: "ACK" },
            { label: "Sequence", value: "101" },
            { label: "Acknowledgment", value: "301" },
          ],
        },
      ],
    }),
    run: (state) => ({
      state: { ...state, tcp: { ...state.tcp, state: "ESTABLISHED" } },
      events: [{ type: "TCP_STATE_CHANGED", stepId: "tcp-ack", timestamp: Date.now(), message: "Client & Server: → ESTABLISHED" }],
    }),
    whatChanged: () => ["TCP session state: ESTABLISHED on both Laptop and Server.", "HTTPS (TLS) can now begin on top of this connection."],
  },
  {
    id: "complete",
    label: "Session Established",
    narrative:
      "TCP SESSION ESTABLISHED. From here, TLS negotiation and the HTTPS request/response would follow — that's a lesson of its own. You just watched, and drove, every hop: ARP, switched forwarding, routing, and the TCP handshake.",
  },
];
