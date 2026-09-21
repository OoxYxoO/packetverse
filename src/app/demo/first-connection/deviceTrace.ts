import type { DeviceInterfaceData, DeviceProcessingTrace, LinkDetail, PacketStackFrame, ProcessingStage } from "@/components/network3d/types";
import { ADDR, GRAPH_LINKS, firstConnectionSteps, type FirstConnectionDeviceId, type FirstConnectionState } from "@/lib/sim-engine/scenarios/firstConnection";

/**
 * Scene Adapter for First Connection. Every field below is re-described
 * from FirstConnectionState + the current step id — this lesson has no
 * growing `state.journey` array (like OSPF/BGP Enterprise), so each
 * device's trace is a plain step-id-keyed lookup rather than a scan of
 * a journey log. Never invents a lookup/result the domain state doesn't
 * already contain.
 */

const stepIndex = (id: string) => firstConnectionSteps.findIndex((s) => s.id === id);

// --- Per-device conceptual pipelines (see ARCHITECTURE.md §7/§17) ----------
// Each device gets its OWN stage list per sub-phase it actually
// participates in, mirroring mpls-ldp's "two genuinely distinct
// journeys sharing one traceFor" pattern — never one bloated list with
// stages that silently never light up again once passed.

const LAPTOP_L2_STAGES: ProcessingStage[] = [
  { id: "determine-need", label: "Determine L2 Requirement" },
  { id: "arp-cache-check", label: "ARP Cache Lookup" },
  { id: "arp-broadcast", label: "Send ARP Request" },
  { id: "arp-learn", label: "Learn Gateway MAC" },
  { id: "build-frame", label: "Build Frame to Gateway" },
];
const LAPTOP_TCP_STAGES: ProcessingStage[] = [
  { id: "tcp-open", label: "Send SYN" },
  { id: "tcp-wait-synack", label: "Await SYN-ACK" },
  { id: "tcp-ack", label: "Send Final ACK" },
  { id: "established", label: "Connection Established" },
];

const SWITCH_STAGES: ProcessingStage[] = [
  { id: "ingress", label: "Ingress Frame" },
  { id: "mac-lookup", label: "MAC Table Lookup" },
  { id: "decision", label: "Flood or Forward" },
  { id: "egress", label: "Egress Frame" },
];

const ROUTER_ARP_STAGES: ProcessingStage[] = [
  { id: "recognize-own-ip", label: "Recognize Target IP as Own" },
  { id: "build-reply", label: "Build ARP Reply" },
  { id: "egress-reply", label: "Unicast Reply to Requester" },
];
const ROUTER_FORWARDING_STAGES: ProcessingStage[] = [
  { id: "ingress", label: "Ingress Frame" },
  { id: "route-lookup", label: "Routing Table Lookup" },
  { id: "decap", label: "Strip Incoming L2 Header" },
  { id: "rewrite", label: "Rewrite Ethernet Header" },
  { id: "egress", label: "Egress Frame" },
];

const SERVER_STAGES: ProcessingStage[] = [
  { id: "receive-ip", label: "Receive IP Packet" },
  { id: "tcp-listen", label: "TCP Listening (port 443)" },
  { id: "tcp-synack", label: "Send SYN-ACK" },
  { id: "tcp-established", label: "Connection Established" },
];

function allIds(stages: ProcessingStage[]) {
  return stages.map((s) => s.id);
}

function arpFrames(): PacketStackFrame[] {
  return [
    { id: "ethernet", text: "Ethernet II", tone: "generic" },
    { id: "arp", text: "ARP", tone: "ip" },
  ];
}
function ipFrames(dstMac: string, justChanged = false): PacketStackFrame[] {
  return [
    { id: "ethernet", text: `Ethernet II (dst ${dstMac})`, tone: "generic", justChanged },
    { id: "ip", text: "IPv4", tone: "ip" },
  ];
}
function tcpFrames(dstMac: string, flags: string): PacketStackFrame[] {
  return [
    { id: "ethernet", text: `Ethernet II (dst ${dstMac})`, tone: "generic" },
    { id: "ip", text: "IPv4", tone: "ip" },
    { id: "tcp", text: `TCP ${flags}`, tone: "transport" },
  ];
}

const IDLE_L2 = { deviceId: "", stages: [], completedStageIds: [] } as unknown as DeviceProcessingTrace;

export function traceFor(device: FirstConnectionDeviceId, state: FirstConnectionState, currentStepId: string): DeviceProcessingTrace {
  const i = stepIndex(currentStepId);
  const iMission = stepIndex("mission");
  const iPlan = stepIndex("plan-question");
  const iArpReq = stepIndex("arp-request");
  const iArpReply = stepIndex("arp-reply");
  const iPredictNext = stepIndex("predict-next");
  const iFrameToGw = stepIndex("frame-to-gateway");
  const iRouterFwd = stepIndex("router-forwards");
  const iTcpIntro = stepIndex("tcp-intro");
  const iTcpSyn = stepIndex("tcp-syn");
  const iPredictSynAck = stepIndex("predict-synack");
  const iTcpSynAck = stepIndex("tcp-synack");
  const iPredictAck = stepIndex("predict-ack");
  const iTcpAck = stepIndex("tcp-ack");
  const iComplete = stepIndex("complete");

  const macKnown = Object.keys(state.macTable.switch ?? {}).length > 0;
  const routeMatched = state.routingTable.router.some((r) => r.matched);

  if (device === "laptop") {
    if (i === iMission || i === iPlan) {
      return { deviceId: "laptop", stages: LAPTOP_L2_STAGES, activeStageId: "determine-need", completedStageIds: [] };
    }
    if (i === iArpReq) {
      return {
        deviceId: "laptop",
        egressInterfaceId: "laptop-eth0",
        stages: LAPTOP_L2_STAGES,
        activeStageId: "arp-broadcast",
        completedStageIds: ["determine-need", "arp-cache-check"],
        packetBefore: "ARP table: no entry for 192.168.10.1",
        lookupType: "ARP Cache Lookup",
        lookupKey: ADDR.gateway.ip,
        lookupResult: "Miss — broadcasting a request",
        nextHopId: "router",
        nextHopLabel: "Router (via Switch)",
        packetBeforeFrames: arpFrames(),
        reason: "The destination (10.20.20.20) is off-subnet, so the frame must go to the default gateway — but the gateway's MAC address isn't cached yet.",
      };
    }
    if (i === iArpReply || i === iPredictNext) {
      return {
        deviceId: "laptop",
        ingressInterfaceId: "laptop-eth0",
        stages: LAPTOP_L2_STAGES,
        activeStageId: "arp-learn",
        completedStageIds: ["determine-need", "arp-cache-check", "arp-broadcast"],
        packetBefore: "ARP table: empty",
        packetAfter: `ARP table: ${ADDR.gateway.ip} → ${ADDR.gateway.mac}`,
        lookupType: "ARP Reply Received",
        lookupKey: ADDR.gateway.ip,
        lookupResult: `${ADDR.gateway.ip} is at ${ADDR.gateway.mac}`,
        packetAfterFrames: arpFrames(),
        reason: "Only the Router replied — it's the only device that owns 192.168.10.1 — so the Laptop now caches exactly one new fact.",
      };
    }
    if (i === iFrameToGw || i === iRouterFwd) {
      return {
        deviceId: "laptop",
        egressInterfaceId: "laptop-eth0",
        stages: LAPTOP_L2_STAGES,
        activeStageId: i === iFrameToGw ? "build-frame" : undefined,
        completedStageIds: allIds(LAPTOP_L2_STAGES),
        packetBefore: "IP packet, no frame yet",
        packetAfter: `Ethernet dst = ${ADDR.gateway.mac} (gateway), IP dst = ${ADDR.server.ip} (Server)`,
        lookupType: "Frame Construction",
        lookupKey: "Cached gateway MAC",
        lookupResult: "Destination MAC = gateway; Destination IP stays the Server — the gateway is a Layer 2 hop, not the final destination.",
        packetBeforeFrames: arpFrames(),
        packetAfterFrames: ipFrames(ADDR.gateway.mac),
        nextHopId: "router",
        nextHopLabel: "Router",
        reason: "A default-gateway hop only ever changes the Layer 2 destination — the IP destination is preserved end-to-end.",
      };
    }
    if (i >= iTcpIntro && i <= iComplete) {
      const active = i === iTcpSyn ? "tcp-open" : i === iPredictSynAck || i === iTcpSynAck ? "tcp-wait-synack" : i === iPredictAck || i === iTcpAck ? "tcp-ack" : i === iComplete ? "established" : undefined;
      const completed = LAPTOP_TCP_STAGES.slice(0, LAPTOP_TCP_STAGES.findIndex((s) => s.id === active)).map((s) => s.id);
      return {
        deviceId: "laptop",
        egressInterfaceId: i === iTcpSyn || i === iTcpAck ? "laptop-eth0" : undefined,
        ingressInterfaceId: i === iPredictSynAck || i === iTcpSynAck ? "laptop-eth0" : undefined,
        stages: LAPTOP_TCP_STAGES,
        activeStageId: active,
        completedStageIds: i === iComplete ? allIds(LAPTOP_TCP_STAGES) : completed,
        packetBefore: state.tcp.clientSeq !== undefined ? `TCP: ${i < iTcpSynAck ? "CLOSED" : "SYN_SENT"}` : "TCP: CLOSED",
        packetAfter: state.tcp.state !== "CLOSED" ? `TCP: ${state.tcp.state}` : undefined,
        packetBeforeFrames: state.tcp.clientSeq !== undefined ? tcpFrames(ADDR.gateway.mac, i >= iTcpSynAck ? "SYN" : "—") : undefined,
        lookupType: i === iTcpSyn ? "Connection Open (active)" : undefined,
        lookupResult: state.tcp.clientSeq !== undefined ? `seq=${state.tcp.clientSeq}` : undefined,
        reason: "Before HTTPS can exchange any data, both sides must agree on initial sequence numbers via the three-way handshake.",
      };
    }
    return IDLE_L2;
  }

  if (device === "switch") {
    if (i === iMission || i === iPlan) return { deviceId: "switch", stages: SWITCH_STAGES, completedStageIds: [] };
    if (i === iArpReq) {
      return {
        deviceId: "switch",
        ingressInterfaceId: "switch-fa01",
        stages: SWITCH_STAGES,
        activeStageId: "decision",
        completedStageIds: ["ingress", "mac-lookup"],
        packetBefore: "MAC table: empty",
        lookupType: "MAC Table Lookup",
        lookupKey: "FF:FF:FF:FF:FF:FF (broadcast)",
        lookupResult: "Broadcast destination — flood out every other port",
        packetBeforeFrames: arpFrames(),
        forwardingAction: "FLOOD",
        reason: "A broadcast destination is never a MAC-table hit — it always floods, regardless of table state.",
      };
    }
    if (i === iArpReply) {
      return {
        deviceId: "switch",
        ingressInterfaceId: "switch-fa02",
        egressInterfaceId: "switch-fa01",
        stages: SWITCH_STAGES,
        activeStageId: "egress",
        completedStageIds: ["ingress", "mac-lookup", "decision"],
        packetBefore: "MAC table: empty",
        packetAfter: `MAC table: ${ADDR.laptop.mac} → Fa0/1, ${ADDR.gateway.mac} → Fa0/2`,
        lookupType: "Source MAC Learning + Destination Lookup",
        lookupKey: ADDR.laptop.mac,
        lookupResult: "Both endpoints' MACs now known — reply forwarded as known unicast out Fa0/1",
        packetAfterFrames: arpFrames(),
        forwardingAction: "KNOWN UNICAST",
        reason: "The switch learns a source MAC from every frame it forwards — by the time the reply arrives, it already knows both ports.",
      };
    }
    if (i === iFrameToGw) {
      return {
        deviceId: "switch",
        ingressInterfaceId: "switch-fa01",
        egressInterfaceId: "switch-fa02",
        stages: SWITCH_STAGES,
        activeStageId: "decision",
        completedStageIds: ["ingress", "mac-lookup"],
        packetBefore: `MAC table: ${ADDR.gateway.mac} → Fa0/2 (known)`,
        lookupType: "MAC Table Lookup",
        lookupKey: ADDR.gateway.mac,
        lookupResult: "Known unicast — forward directly out Fa0/2, no flooding",
        packetBeforeFrames: ipFrames(ADDR.gateway.mac),
        forwardingAction: "KNOWN UNICAST",
        nextHopId: "router",
        nextHopLabel: "Router",
        reason: "The switch reads only the Ethernet destination MAC to make this decision — it never looks at the IP header underneath.",
      };
    }
    return { deviceId: "switch", stages: SWITCH_STAGES, completedStageIds: macKnown ? allIds(SWITCH_STAGES) : [], forwardingAction: macKnown ? "Transparent Layer-2 forwarding — MAC table already resolved" : undefined };
  }

  if (device === "router") {
    if (i === iMission || i === iPlan) return { deviceId: "router", stages: ROUTER_ARP_STAGES, completedStageIds: [] };
    if (i === iArpReq) {
      return {
        deviceId: "router",
        ingressInterfaceId: "router-ge000",
        stages: ROUTER_ARP_STAGES,
        activeStageId: "recognize-own-ip",
        completedStageIds: [],
        lookupType: "ARP Target IP Match",
        lookupKey: ADDR.gateway.ip,
        lookupResult: "Matches this router's own ge-0/0/0 address",
        packetBeforeFrames: arpFrames(),
        reason: "Every device on the broadcast domain receives the request, but only the device that owns the target IP answers.",
      };
    }
    if (i === iArpReply || i === iPredictNext) {
      return {
        deviceId: "router",
        egressInterfaceId: "router-ge000",
        stages: ROUTER_ARP_STAGES,
        activeStageId: "egress-reply",
        completedStageIds: ["recognize-own-ip", "build-reply"],
        packetAfter: `Unicast reply — ${ADDR.gateway.ip} is at ${ADDR.gateway.mac}`,
        lookupResult: `Replies directly (unicast) to ${ADDR.laptop.mac}`,
        packetAfterFrames: arpFrames(),
        nextHopId: "laptop",
        nextHopLabel: "Laptop",
        reason: "An ARP reply is always unicast — there's no reason to broadcast an answer only one device asked for.",
      };
    }
    if (i === iFrameToGw) {
      return {
        deviceId: "router",
        ingressInterfaceId: "router-ge000",
        stages: ROUTER_FORWARDING_STAGES,
        activeStageId: "route-lookup",
        completedStageIds: ["ingress"],
        packetBefore: `Frame arrives, IP dst = ${ADDR.server.ip}`,
        lookupType: "Routing Table Lookup",
        lookupKey: ADDR.server.ip,
        lookupResult: "Matched 10.20.20.0/24 → ge-0/0/1 (directly connected)",
        packetBeforeFrames: ipFrames(ADDR.gateway.mac),
        reason: "The router reads only the IP destination for this decision — the Ethernet header that got the frame here is about to be discarded.",
      };
    }
    if (i === iRouterFwd) {
      return {
        deviceId: "router",
        ingressInterfaceId: "router-ge000",
        egressInterfaceId: "router-ge001",
        stages: ROUTER_FORWARDING_STAGES,
        activeStageId: "rewrite",
        completedStageIds: ["ingress", "route-lookup", "decap"],
        packetBefore: `Ethernet dst = ${ADDR.gateway.mac} (this router), IP dst = ${ADDR.server.ip}`,
        packetAfter: `Ethernet dst = ${ADDR.server.mac} (Server), IP dst = ${ADDR.server.ip} (unchanged)`,
        packetBeforeFrames: ipFrames(ADDR.gateway.mac),
        packetAfterFrames: ipFrames(ADDR.server.mac, true),
        mutations: [
          { type: "DA_CHANGE", detail: `Destination MAC: ${ADDR.gateway.mac} → ${ADDR.server.mac}` },
          { type: "SA_CHANGE", detail: `Source MAC: ${ADDR.laptop.mac} → ${ADDR.routerWan.mac}` },
        ],
        lookupResult: "New Ethernet header built for the Server segment — IP header untouched",
        nextHopId: "server",
        nextHopLabel: "Server",
        reason: "Every router hop rewrites the Layer 2 header from scratch — the Layer 3 (IP) header rides through unmodified end-to-end (no NAT on this path).",
      };
    }
    return { deviceId: "router", stages: ROUTER_FORWARDING_STAGES, completedStageIds: routeMatched ? allIds(ROUTER_FORWARDING_STAGES) : [], forwardingAction: routeMatched ? "Transparent forwarding — route already resolved" : undefined };
  }

  // server
  if (i < iRouterFwd) return { deviceId: "server", stages: SERVER_STAGES, completedStageIds: [] };
  if (i === iRouterFwd) {
    return {
      deviceId: "server",
      ingressInterfaceId: "server-eth0",
      stages: SERVER_STAGES,
      activeStageId: "receive-ip",
      completedStageIds: [],
      packetBefore: "No packet received yet",
      packetAfter: `IP packet received from ${ADDR.laptop.ip}`,
      packetAfterFrames: ipFrames(ADDR.server.mac),
      reason: "The IP packet has arrived, but there is no TCP connection yet — HTTPS needs one before any data can flow.",
    };
  }
  if (i === iTcpSyn) {
    return {
      deviceId: "server",
      ingressInterfaceId: "server-eth0",
      stages: SERVER_STAGES,
      activeStageId: "tcp-listen",
      completedStageIds: ["receive-ip"],
      packetBefore: "TCP: LISTEN (port 443)",
      lookupType: "TCP SYN Received",
      lookupResult: "Preparing SYN-ACK with its own initial sequence number",
      packetBeforeFrames: tcpFrames(ADDR.server.mac, "SYN"),
      reason: "A SYN must be acknowledged AND matched with the server's own initial sequence number — one combined SYN-ACK segment.",
    };
  }
  if (i === iPredictSynAck || i === iTcpSynAck) {
    return {
      deviceId: "server",
      egressInterfaceId: "server-eth0",
      stages: SERVER_STAGES,
      activeStageId: "tcp-synack",
      completedStageIds: ["receive-ip", "tcp-listen"],
      packetAfter: state.tcp.serverSeq !== undefined ? `TCP: SYN_RECEIVED, seq=${state.tcp.serverSeq}, ack=${(state.tcp.clientSeq ?? 100) + 1}` : undefined,
      lookupResult: state.tcp.serverSeq !== undefined ? `SYN-ACK sent — seq=${state.tcp.serverSeq}, ack=${(state.tcp.clientSeq ?? 100) + 1}` : "Building SYN-ACK",
      packetAfterFrames: state.tcp.serverSeq !== undefined ? tcpFrames(ADDR.routerWan.mac, "SYN, ACK") : undefined,
      nextHopId: "laptop",
      nextHopLabel: "Laptop",
      reason: "The server both acknowledges the client's SYN and proposes its own sequence number in a single segment.",
    };
  }
  if (i === iPredictAck || i === iTcpAck || i === stepIndex("complete")) {
    const established = state.tcp.state === "ESTABLISHED";
    return {
      deviceId: "server",
      ingressInterfaceId: established ? "server-eth0" : undefined,
      stages: SERVER_STAGES,
      activeStageId: established ? "tcp-established" : "tcp-synack",
      completedStageIds: established ? allIds(SERVER_STAGES) : ["receive-ip", "tcp-listen"],
      packetAfter: established ? "TCP: ESTABLISHED" : undefined,
      lookupResult: established ? "Final ACK received — connection ESTABLISHED" : undefined,
      packetAfterFrames: established ? tcpFrames(ADDR.routerWan.mac, "ACK") : undefined,
      reason: "Once the server sees the client's ACK, both sides independently consider the connection ESTABLISHED.",
    };
  }
  return { deviceId: "server", stages: SERVER_STAGES, completedStageIds: state.tcp.state === "ESTABLISHED" ? allIds(SERVER_STAGES) : [] };
}

export function packetFramesFor(state: FirstConnectionState): PacketStackFrame[] | undefined {
  if (state.tcp.state !== "CLOSED") return tcpFrames(state.tcp.state === "ESTABLISHED" ? ADDR.routerWan.mac : ADDR.gateway.mac, state.tcp.state);
  if (state.deliveredToServer) return ipFrames(ADDR.server.mac);
  if (Object.keys(state.arpTable.laptop ?? {}).length > 0) return ipFrames(ADDR.gateway.mac);
  return arpFrames();
}

/** Only the layer(s) this hop actually reads for its decision — dims the rest as "present, not used for this hop's decision" (the core L2-vs-L3 teaching point of this lesson). */
export function focusIndicesFor(device: FirstConnectionDeviceId | undefined, currentStepId: string): number[] | undefined {
  if (device === "switch" && (currentStepId === "frame-to-gateway" || currentStepId === "arp-request" || currentStepId === "arp-reply")) return [0]; // Ethernet only
  if (device === "router" && currentStepId === "frame-to-gateway") return [1]; // IP only
  return undefined;
}

interface IfaceDef {
  id: string;
  name: string;
  ip?: string;
  neighborId?: FirstConnectionDeviceId;
  neighborLabel?: string;
  linkType: string;
  mtu: number;
  protocols: string[];
  extra?: { label: string; value: string }[];
}

const INTERFACES: Record<FirstConnectionDeviceId, IfaceDef[]> = {
  laptop: [{ id: "laptop-eth0", name: "eth0", ip: `${ADDR.laptop.ip}/24`, neighborId: "switch", neighborLabel: "Access Switch", linkType: "Access", mtu: 1500, protocols: ["Ethernet", "ARP"] }],
  switch: [
    { id: "switch-fa01", name: "Fa0/1", neighborId: "laptop", neighborLabel: "Laptop", linkType: "Access", mtu: 1500, protocols: ["Ethernet"] },
    { id: "switch-fa02", name: "Fa0/2", neighborId: "router", neighborLabel: "Router", linkType: "Access", mtu: 1500, protocols: ["Ethernet"] },
  ],
  router: [
    { id: "router-ge000", name: "ge-0/0/0", ip: `${ADDR.gateway.ip}/24`, neighborId: "switch", neighborLabel: "Access Switch (LAN)", linkType: "LAN", mtu: 1500, protocols: ["Ethernet", "ARP", "IPv4"] },
    { id: "router-ge001", name: "ge-0/0/1", ip: `${ADDR.routerWan.ip}/24`, neighborId: "server", neighborLabel: "Server (directly connected)", linkType: "Server Segment", mtu: 1500, protocols: ["Ethernet", "IPv4"] },
    { id: "router-ge002", name: "ge-0/0/2", linkType: "WAN (default route)", mtu: 1500, protocols: ["IPv4"], extra: [{ label: "Route", value: "0.0.0.0/0" }] },
  ],
  server: [{ id: "server-eth0", name: "eth0", ip: `${ADDR.server.ip}/24`, neighborId: "router", neighborLabel: "Router", linkType: "Server Segment", mtu: 1500, protocols: ["Ethernet", "IPv4", "TCP"] }],
};

export function interfacesFor(device: FirstConnectionDeviceId, state: FirstConnectionState, currentStepId: string): DeviceInterfaceData[] {
  const trace = traceFor(device, state, currentStepId);
  const processing = trace.activeStageId !== undefined;
  return INTERFACES[device].map((def) => ({
    id: def.id,
    name: def.name,
    status: "up",
    ip: def.ip,
    neighborId: def.neighborId,
    neighborLabel: def.neighborLabel,
    linkType: def.linkType,
    mtu: def.mtu,
    protocols: def.protocols,
    packetCount: trace.completedStageIds.length > 0 || processing ? 1 : 0,
    role: processing && def.id === trace.ingressInterfaceId ? "ingress" : processing && def.id === trace.egressInterfaceId ? "egress" : "idle",
    extra: def.extra,
  }));
}

export function linkDetailFor(linkId: string, state: FirstConnectionState): LinkDetail | undefined {
  const link = GRAPH_LINKS.find((l) => l.id === linkId);
  if (!link) return undefined;
  const aIface = INTERFACES[link.a].find((f) => f.neighborId === link.b);
  const bIface = INTERFACES[link.b].find((f) => f.neighborId === link.a);
  if (!aIface || !bIface) return undefined;
  const learnedMac = link.id === "laptop-switch" || link.id === "switch-router" ? Object.keys(state.macTable.switch ?? {}).length > 0 : undefined;
  return {
    aLabel: link.a,
    bLabel: link.b,
    aInterface: { id: aIface.id, name: aIface.name, status: "up", ip: aIface.ip, neighborId: link.b, neighborLabel: link.b, linkType: aIface.linkType, mtu: aIface.mtu, protocols: aIface.protocols, role: "idle" },
    bInterface: { id: bIface.id, name: bIface.name, status: "up", ip: bIface.ip, neighborId: link.a, neighborLabel: link.a, linkType: bIface.linkType, mtu: bIface.mtu, protocols: bIface.protocols, role: "idle" },
    status: "up",
    mtu: aIface.mtu,
    protocols: [{ label: "Ethernet", value: "Up" }, ...(learnedMac !== undefined ? [{ label: "MAC learned", value: learnedMac ? "Yes" : "Not yet" }] : [])],
  };
}
