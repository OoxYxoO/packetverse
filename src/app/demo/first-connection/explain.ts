import type { NodeExplanation } from "@/components/network3d/types";
import { ADDR, firstConnectionSteps, type FirstConnectionDeviceId, type FirstConnectionState } from "@/lib/sim-engine/scenarios/firstConnection";

const stepIndex = (id: string) => firstConnectionSteps.findIndex((s) => s.id === id);

const DEVICE_TYPE: Record<FirstConnectionDeviceId, string> = {
  laptop: "End Host",
  switch: "Access Switch",
  router: "Router (Default Gateway)",
  server: "Server",
};
const ROLE: Record<FirstConnectionDeviceId, string> = {
  laptop: "Sender — 192.168.10.10",
  switch: "Layer 2 forwarding, LAN segment",
  router: "Default gateway + Layer 3 forwarding",
  server: "Destination — 10.20.20.20",
};

export function explainNode(state: FirstConnectionState, nodeId: FirstConnectionDeviceId, currentStepId: string): NodeExplanation {
  const i = stepIndex(currentStepId);
  const base: NodeExplanation = { id: nodeId, name: state.nodes[nodeId]?.label ?? nodeId, deviceType: DEVICE_TYPE[nodeId], role: ROLE[nodeId], currentAction: "" };
  const macKnown = Object.keys(state.macTable.switch ?? {}).length > 0;

  if (nodeId === "laptop") {
    let currentAction = "Idle — no mission started yet.";
    if (i === stepIndex("plan-question")) currentAction = "Working out what it needs before it can send anything off-subnet.";
    else if (i === stepIndex("arp-request")) currentAction = "Broadcasting: \"Who has 192.168.10.1? Tell 192.168.10.10.\"";
    else if (i >= stepIndex("arp-reply") && i < stepIndex("frame-to-gateway")) currentAction = `Learned the gateway's MAC — ${ADDR.gateway.mac}.`;
    else if (i >= stepIndex("frame-to-gateway") && i < stepIndex("tcp-syn")) currentAction = "Sent the IP packet in a frame addressed to the gateway's MAC.";
    else if (i === stepIndex("tcp-syn")) currentAction = `Opening the connection — SYN, seq=${state.tcp.clientSeq ?? 100}.`;
    else if (i >= stepIndex("predict-synack") && i < stepIndex("tcp-ack")) currentAction = "Waiting for the server's SYN-ACK.";
    else if (state.tcp.state === "ESTABLISHED") currentAction = "TCP session ESTABLISHED with the Server.";
    return {
      ...base,
      controlPlaneRole: "Resolves Layer 2 next-hop information (ARP) before sending anything off-subnet.",
      dataPlaneRole: "Sends the IP packet and, later, the TCP segments — the IP destination never changes; only the Ethernet destination does, hop by hop.",
      currentAction,
      tables: [{ title: "ARP Table", rows: Object.entries(state.arpTable.laptop ?? {}).map(([ip, mac]) => ({ label: ip, value: mac })) }],
    };
  }

  if (nodeId === "switch") {
    let currentAction = "Idle — MAC table empty.";
    if (i === stepIndex("arp-request")) currentAction = "Destination is broadcast — flooding out every port except the one it arrived on.";
    else if (i === stepIndex("arp-reply")) currentAction = "Learning both endpoints' MACs from this exchange, forwarding the reply as known unicast.";
    else if (macKnown) currentAction = "MAC table populated — forwarding as known unicast, no flooding.";
    return {
      ...base,
      controlPlaneRole: "Purely reactive — learns source MACs from frames it forwards; runs no protocol of its own.",
      dataPlaneRole: "Reads only the Ethernet destination MAC to decide flood vs. forward — never inspects the IP header underneath.",
      currentAction,
      tables: [{ title: "MAC / CAM Table", rows: Object.entries(state.macTable.switch ?? {}).map(([mac, port]) => ({ label: mac, value: port })) }],
      note: "A switch's forwarding decision is Layer 2 only — it has no idea what IP address (or subnet) is inside the frame.",
    };
  }

  if (nodeId === "router") {
    let currentAction = "Idle.";
    if (i === stepIndex("arp-request")) currentAction = "Recognized 192.168.10.1 as its own address — preparing a unicast reply.";
    else if (i === stepIndex("arp-reply") || i === stepIndex("predict-next")) currentAction = `Replied directly to the Laptop: ${ADDR.gateway.ip} is at ${ADDR.gateway.mac}.`;
    else if (i === stepIndex("frame-to-gateway")) currentAction = "Looked up 10.20.20.20 in its routing table — matched the directly-connected Server segment.";
    else if (i === stepIndex("router-forwards")) currentAction = "Rewrote the Ethernet header for the Server segment; the IP header is untouched.";
    else if (state.routingTable.router.some((r) => r.matched)) currentAction = "Route already resolved — forwarding transparently.";
    return {
      ...base,
      controlPlaneRole: "Answers ARP for its own interface IPs; otherwise runs no dynamic routing protocol in this lesson (routes are directly connected / static default).",
      dataPlaneRole: "Reads only the IP destination to choose an egress interface, then builds a brand-new Ethernet header for that segment — the IP header rides through unmodified.",
      currentAction,
      tables: [{ title: "Routing Table", rows: state.routingTable.router.map((r) => ({ label: r.network, value: `${r.iface}${r.matched ? " ◀ matched" : ""}` })) }],
    };
  }

  // server
  let currentAction = "Idle — no traffic yet.";
  if (i === stepIndex("router-forwards")) currentAction = "Received the IP packet — no TCP connection exists yet.";
  else if (i === stepIndex("tcp-syn")) currentAction = "Received a SYN — preparing SYN-ACK with its own initial sequence number.";
  else if (i === stepIndex("predict-synack") || i === stepIndex("tcp-synack")) currentAction = state.tcp.serverSeq !== undefined ? `Sent SYN-ACK — seq=${state.tcp.serverSeq}, ack=${(state.tcp.clientSeq ?? 100) + 1}.` : "Building SYN-ACK.";
  else if (state.tcp.state === "ESTABLISHED") currentAction = "TCP session ESTABLISHED with the Laptop.";
  else if (i >= stepIndex("predict-ack")) currentAction = "Waiting for the final ACK.";
  return {
    ...base,
    controlPlaneRole: "Passive — never initiates anything in this lesson; only responds to what arrives.",
    dataPlaneRole: "Completes the three-way handshake, then would carry the HTTPS request/response (out of scope for this lesson).",
    currentAction,
    tables: [{ title: "TCP Connection", rows: [{ label: "State", value: state.tcp.state }, ...(state.tcp.serverSeq !== undefined ? [{ label: "Server seq", value: String(state.tcp.serverSeq) }] : [])] }],
  };
}
