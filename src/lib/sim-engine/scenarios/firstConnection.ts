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
  /** IPv4 → MAC, per Layer-3 device ("laptop", "router"). A pure L2 switch has no ARP table here. */
  arpTable: Record<string, Record<string, string>>;
  /** MAC → canonical switch port id (see SWITCH_PORTS), learned from the SOURCE MAC of each frame on ingress. */
  macTable: Record<string, Record<string, SwitchPortId>>;
  routingTable: Record<
    string,
    { network: string; iface: string; ifaceId: RouterInterfaceId; origin: "connected" | "static"; note: string; matched?: boolean }[]
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
  /** Router's third (WAN / default-route) port — unnumbered in this lesson, but every Ethernet port still has a MAC. */
  routerUplink: { mac: "02:BB:00:00:00:03" },
};

/**
 * Canonical logical interfaces — ONE truth that every presentation
 * (3D labels, Cisco CLI, Junos CLI) translates into its own naming.
 * The lesson visuals label switch ports Fa0/1 / Fa0/2; a CLI adapter
 * may render the same port as FastEthernet0/1 or ge-0/0/1.
 */
export type SwitchPortId = "port1" | "port2";
export interface SwitchPortDef {
  id: SwitchPortId;
  /** Label used by the lesson's own visuals and tables. */
  label: string;
  neighbor: FirstConnectionDeviceId;
  neighborLabel: string;
  mac: string;
}
export const SWITCH_PORTS: SwitchPortDef[] = [
  { id: "port1", label: "Fa0/1", neighbor: "laptop", neighborLabel: "Laptop", mac: "02:DD:00:00:00:01" },
  { id: "port2", label: "Fa0/2", neighbor: "router", neighborLabel: "Router", mac: "02:DD:00:00:00:02" },
];

export type RouterInterfaceId = "lan" | "server" | "wan";
export interface RouterInterfaceDef {
  id: RouterInterfaceId;
  ip?: string;
  prefixLength?: number;
  mac: string;
  description: string;
}
export const ROUTER_INTERFACES: RouterInterfaceDef[] = [
  { id: "lan", ip: ADDR.gateway.ip, prefixLength: 24, mac: ADDR.gateway.mac, description: "LAN - Access Switch" },
  { id: "server", ip: ADDR.routerWan.ip, prefixLength: 24, mac: ADDR.routerWan.mac, description: "Server segment" },
  { id: "wan", mac: ADDR.routerUplink.mac, description: "WAN uplink (default route)" },
];

/** Hostnames shown as the secondary identity of the Access Switch and Router (CLI prompts, lab topology). */
export const DEVICE_HOSTNAME = { switch: "SW1", router: "R1" } as const;

/** The two IP subnets of this network — the Router sits on the boundary and separates the broadcast domains. */
export const SUBNETS = {
  lan: { network: "192.168.10.0/24", label: "LAN", prefixLength: 24 },
  server: { network: "10.20.20.0/24", label: "Server segment", prefixLength: 24 },
} as const;

/** "02:AA:… → Fa0/1 → Laptop" rows for the visual MAC-table viewers — the state itself stores only the canonical port id. */
export function macTableDisplay(entries: Record<string, SwitchPortId> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [mac, portId] of Object.entries(entries ?? {})) {
    const port = SWITCH_PORTS.find((p) => p.id === portId);
    out[mac] = port ? `${port.label} → ${port.neighborLabel}` : portId;
  }
  return out;
}

export function createFirstConnectionState(): FirstConnectionState {
  const nodes: Record<string, NetNode> = {
    laptop: { id: "laptop", label: "Laptop", kind: "laptop", ip: ADDR.laptop.ip, mac: ADDR.laptop.mac, track: 0.04 },
    switch: { id: "switch", label: "Access Switch", kind: "switch", track: 0.36 },
    router: { id: "router", label: "Router", kind: "router", ip: ADDR.gateway.ip, mac: ADDR.gateway.mac, track: 0.68 },
    server: { id: "server", label: "Server", kind: "server", ip: ADDR.server.ip, mac: ADDR.server.mac, track: 0.96 },
  };
  return {
    nodes,
    arpTable: { laptop: {}, router: {} },
    macTable: { switch: {} },
    routingTable: {
      router: [
        { network: "192.168.10.0/24", iface: "ge-0/0/0 (LAN)", ifaceId: "lan", origin: "connected", note: "Directly connected" },
        { network: "10.20.20.0/24", iface: "ge-0/0/1 (Server segment)", ifaceId: "server", origin: "connected", note: "Directly connected" },
        { network: "0.0.0.0/0", iface: "ge-0/0/2 (WAN)", ifaceId: "wan", origin: "static", note: "Default route" },
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

/**
 * TCP truth shared by the guided lesson and the TCP Lab: the Laptop's ephemeral port, the Server's HTTPS port,
 * and each side's initial sequence number (real stacks pick random 32-bit ISNs; the lesson uses readable ones).
 */
export const TCP_PORT = { client: 51001, server: 443 } as const;
export const TCP_ISN = { client: 100, server: 300 } as const;
/** Initial IPv4 TTL used by the Laptop and the Server; each router hop decrements it by one. */
export const IPV4_INITIAL_TTL = 64;

/**
 * Each endpoint's TCP state for the guided lesson's single `tcp.state` field (which records how far the handshake
 * has progressed). An endpoint changes state when it processes a segment and sends its response:
 *   SYN_SENT     → client SYN-SENT (SYN sent),                       server still LISTEN (it answers with the next segment)
 *   SYN_RECEIVED → client SYN-SENT (SYN-ACK not processed yet),      server SYN-RECEIVED (SYN-ACK sent)
 *   ESTABLISHED  → client ESTABLISHED (processed SYN-ACK, sent ACK), server ESTABLISHED (ACK received)
 */
export type TcpEndpointState = "CLOSED" | "LISTEN" | "SYN-SENT" | "SYN-RECEIVED" | "ESTABLISHED";
export function tcpEndpointStates(tcp: FirstConnectionState["tcp"]): { client: TcpEndpointState; server: TcpEndpointState } {
  switch (tcp.state) {
    case "CLOSED":
      return { client: "CLOSED", server: "LISTEN" };
    case "SYN_SENT":
      return { client: "SYN-SENT", server: "LISTEN" };
    case "SYN_RECEIVED":
      return { client: "SYN-SENT", server: "SYN-RECEIVED" };
    case "ESTABLISHED":
      return { client: "ESTABLISHED", server: "ESTABLISHED" };
  }
}

export const eth = (src: string, dst: string) => ({
  name: "Ethernet II",
  color: "var(--pv-proto-ethernet)",
  fields: [
    { label: "Destination MAC", value: dst },
    { label: "Source MAC", value: src },
  ],
});

/** IPv4 header as seen on one link; `ttl` is the value on THAT link (64 leaving a host, one less per router hop). */
export const ipLayer = (src: string, dst: string, ttl: number = IPV4_INITIAL_TTL) => ({
  name: "IPv4",
  color: "var(--pv-proto-ip)",
  fields: [
    { label: "Source IP", value: src },
    { label: "Destination IP", value: dst },
    { label: "TTL", value: String(ttl) },
  ],
});

/** ARP request as it leaves the Laptop — shared by the guided lesson and the ARP Lab so both show identical fields. */
export function arpRequestPacket(): PacketVisual {
  return {
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
  };
}

/** Unicast ARP reply from R1 back to the Laptop. */
export function arpReplyPacket(): PacketVisual {
  return {
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
  };
}

/** The first IP packet toward the Server, framed to the gateway MAC that ARP resolved. */
export function gatewayFramePacket(): PacketVisual {
  return {
    id: "frame-1",
    protocol: "IP",
    from: "laptop",
    to: "router",
    summary: "IP packet toward 10.20.20.20, framed to the gateway",
    layers: [eth(ADDR.laptop.mac, ADDR.gateway.mac), ipLayer(ADDR.laptop.ip, ADDR.server.ip)],
  };
}

/** The ARP lesson's guided steps: from the mission to the first packet delivered to the Server (ARP, switching, routing). */
export const arpLessonSteps: ScenarioStep<FirstConnectionState>[] = [
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
      "Your PC has no entry for 192.168.10.1 in its ARP table yet, so it broadcasts a request: \"Who has 192.168.10.1? Tell 192.168.10.10.\" As the frame enters the Switch on Fa0/1, the Switch learns its SOURCE MAC on that port, then floods the broadcast. The Router owns 192.168.10.1, so while processing the request it also caches the sender's mapping: 192.168.10.10 → 02:AA:00:00:00:01.",
    packet: arpRequestPacket,
    run: (state) => ({
      state: {
        ...state,
        // Ingress on Fa0/1: the switch learns the Ethernet SOURCE MAC — it never needs the ARP payload for this.
        macTable: { ...state.macTable, switch: { ...state.macTable.switch, [ADDR.laptop.mac]: "port1" } },
        // R1 owns the target IP, so it caches the ARP sender's IP/MAC while processing the request.
        arpTable: { ...state.arpTable, router: { ...state.arpTable.router, [ADDR.laptop.ip]: ADDR.laptop.mac } },
      },
      events: [
        {
          type: "ARP_REQUEST_SENT",
          stepId: "arp-request",
          timestamp: Date.now(),
          message: "Laptop broadcasts ARP request for 192.168.10.1",
        },
        { type: "MAC_LEARNED", stepId: "arp-request", timestamp: Date.now(), message: "Switch learns source MAC 02:AA:00:00:00:01 on Fa0/1" },
        { type: "ARP_ENTRY_CREATED", stepId: "arp-request", timestamp: Date.now(), message: "Router caches 192.168.10.10 → 02:AA:00:00:00:01 from the request's sender fields" },
      ],
    }),
    whatChanged: () => [
      `Switch MAC table: ${ADDR.laptop.mac} → Fa0/1 (learned from the frame's source MAC on ingress)`,
      `Router ARP table: ${ADDR.laptop.ip} → ${ADDR.laptop.mac} (learned from the ARP request's sender fields)`,
      "Laptop ARP table: still empty — it has only asked the question so far",
    ],
  },
  {
    id: "arp-reply",
    label: "ARP Reply",
    narrative:
      "Every device saw the broadcast, but only the Router recognizes 192.168.10.1 as its own address. It replies directly — unicast — to the Laptop with its MAC address. As the reply enters the Switch on Fa0/2, the Switch learns the Router's SOURCE MAC on that port; when the reply reaches the Laptop, the Laptop caches 192.168.10.1 → 02:BB:00:00:00:01.",
    packet: arpReplyPacket,
    run: (state) => {
      const next: FirstConnectionState = {
        ...state,
        arpTable: { ...state.arpTable, laptop: { ...state.arpTable.laptop, [ADDR.gateway.ip]: ADDR.gateway.mac } },
        // Ingress on Fa0/2: the reply's Ethernet SOURCE MAC is the Router's.
        macTable: { ...state.macTable, switch: { ...state.macTable.switch, [ADDR.gateway.mac]: "port2" } },
      };
      return {
        state: next,
        events: [
          { type: "MAC_LEARNED", stepId: "arp-reply", timestamp: Date.now(), message: "Switch learns source MAC 02:BB:00:00:00:01 on Fa0/2" },
          { type: "ARP_ENTRY_CREATED", stepId: "arp-reply", timestamp: Date.now(), message: "Laptop learns 192.168.10.1 → 02:BB:00:00:00:01" },
        ],
      };
    },
    whatChanged: (prev, next) => [
      `Switch MAC table: ${ADDR.gateway.mac} → Fa0/2 added (the reply's source MAC on ingress); ${ADDR.laptop.mac} → Fa0/1 was already known from the request`,
      `Laptop ARP table: 192.168.10.1 → ${next.arpTable.laptop[ADDR.gateway.ip]} (was empty) — learned from the ARP reply`,
      `Router ARP table unchanged: ${ADDR.laptop.ip} → ${next.arpTable.router?.[ADDR.laptop.ip] ?? "—"}`,
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
    packet: gatewayFramePacket,
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
      "The Router de-encapsulates the frame, confirms the route, and builds a brand-new Ethernet header for the Server segment, using the Server's MAC from its own ARP cache on that segment (had it not been cached, R1 would ARP for 10.20.20.20 there first). Watch closely: both MAC addresses change, the IP addresses stay the same, and the Router decrements the TTL from 64 to 63.",
    packet: (): PacketVisual => ({
      id: "frame-2",
      protocol: "IP",
      from: "router",
      to: "server",
      summary: "Same IP packet, new Ethernet header",
      layers: [eth(ADDR.routerWan.mac, ADDR.server.mac), ipLayer(ADDR.laptop.ip, ADDR.server.ip, IPV4_INITIAL_TTL - 1)],
    }),
    run: (state) => ({
      state: { ...state, deliveredToServer: true },
      events: [{ type: "PACKET_RECEIVED", stepId: "router-forwards", timestamp: Date.now(), message: "Server receives the IP packet" }],
    }),
    whatChanged: () => [
      "Frame delivered to Server.",
      "Ethernet header rewritten at every hop (src/dst MAC changed twice).",
      `IP source and destination identical end-to-end — no NAT on this path. The Router decremented the TTL ${IPV4_INITIAL_TTL} → ${IPV4_INITIAL_TTL - 1}.`,
    ],
  },
];

/**
 * The TCP/UDP lesson's network when it starts: the path is ready — the Laptop knows the gateway's MAC, the switch
 * knows both ends, R1 has routed the first packet to the Server — and no TCP connection exists yet.
 */
export function createTcpLessonState(): FirstConnectionState {
  const s = createFirstConnectionState();
  return {
    ...s,
    arpTable: { laptop: { [ADDR.gateway.ip]: ADDR.gateway.mac }, router: { [ADDR.laptop.ip]: ADDR.laptop.mac } },
    macTable: { switch: { [ADDR.laptop.mac]: "port1", [ADDR.gateway.mac]: "port2" } },
    routingTable: { router: s.routingTable.router.map((r) => ({ ...r, matched: r.ifaceId === "server" })) },
    deliveredToServer: true,
  };
}

/** The TCP/UDP lesson's guided steps: the three-way handshake on the ready path. */
export const tcpLessonSteps: ScenarioStep<FirstConnectionState>[] = [
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
      summary: `SYN, seq=${TCP_ISN.client}`,
      layers: [
        eth(ADDR.laptop.mac, ADDR.gateway.mac),
        ipLayer(ADDR.laptop.ip, ADDR.server.ip),
        {
          name: "TCP",
          color: "var(--pv-proto-tcp)",
          fields: [
            { label: "Source Port", value: String(TCP_PORT.client) },
            { label: "Destination Port", value: String(TCP_PORT.server) },
            { label: "Flags", value: "SYN" },
            { label: "Sequence", value: String(TCP_ISN.client) },
          ],
        },
      ],
    }),
    run: (state) => ({
      state: { ...state, tcp: { state: "SYN_SENT", clientSeq: TCP_ISN.client } },
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
      summary: `SYN-ACK, seq=${TCP_ISN.server}, ack=${TCP_ISN.client + 1}`,
      layers: [
        eth(ADDR.server.mac, ADDR.routerWan.mac),
        ipLayer(ADDR.server.ip, ADDR.laptop.ip),
        {
          name: "TCP",
          color: "var(--pv-proto-tcp)",
          fields: [
            { label: "Source Port", value: String(TCP_PORT.server) },
            { label: "Destination Port", value: String(TCP_PORT.client) },
            { label: "Flags", value: "SYN, ACK" },
            { label: "Sequence", value: String(TCP_ISN.server) },
            { label: "Acknowledgment", value: String(TCP_ISN.client + 1) },
          ],
        },
      ],
    }),
    run: (state) => ({
      state: { ...state, tcp: { ...state.tcp, state: "SYN_RECEIVED", serverSeq: TCP_ISN.server } },
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
        "The client acknowledges the server's SYN (seq 300 → ack 301) with a plain ACK. The client enters ESTABLISHED as it processes the SYN-ACK and sends this ACK; the server stays SYN-RECEIVED until the ACK arrives, and only then enters ESTABLISHED.",
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
      summary: `ACK, seq=${TCP_ISN.client + 1}, ack=${TCP_ISN.server + 1}`,
      layers: [
        eth(ADDR.laptop.mac, ADDR.gateway.mac),
        ipLayer(ADDR.laptop.ip, ADDR.server.ip),
        {
          name: "TCP",
          color: "var(--pv-proto-tcp)",
          fields: [
            { label: "Source Port", value: String(TCP_PORT.client) },
            { label: "Destination Port", value: String(TCP_PORT.server) },
            { label: "Flags", value: "ACK" },
            { label: "Sequence", value: String(TCP_ISN.client + 1) },
            { label: "Acknowledgment", value: String(TCP_ISN.server + 1) },
          ],
        },
      ],
    }),
    run: (state) => ({
      state: { ...state, tcp: { ...state.tcp, state: "ESTABLISHED" } },
      events: [{ type: "TCP_STATE_CHANGED", stepId: "tcp-ack", timestamp: Date.now(), message: "Client: SYN_SENT → ESTABLISHED (processed SYN-ACK, sent ACK) · Server: SYN_RECEIVED → ESTABLISHED (ACK received)" }],
    }),
    whatChanged: () => [
      "Laptop: ESTABLISHED — it entered that state when it processed the SYN-ACK and sent this ACK.",
      "Server: SYN-RECEIVED → ESTABLISHED when the ACK arrived. Both endpoints are now ESTABLISHED.",
      "HTTPS (TLS) can now begin on top of this connection.",
    ],
  },
  {
    id: "complete",
    label: "Session Established",
    narrative:
      "TCP SESSION ESTABLISHED. From here, TLS negotiation and the HTTPS request/response would follow — that's a lesson of its own. You just drove a whole TCP handshake across a routed path: SYN, SYN-ACK and ACK, both endpoints' states, every sequence and acknowledgment number.",
  },
];

/** The whole network's step catalogue, in order (the device-trace helpers order step ids with it). */
export const firstConnectionSteps: ScenarioStep<FirstConnectionState>[] = [...arpLessonSteps, ...tcpLessonSteps];
