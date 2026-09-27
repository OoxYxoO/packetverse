import type { NodeExplanation } from "@/components/network3d/types";
import { GATEWAY, R1_ROUTES, SW_PORTS, V4_IP, V4_MAC, V4_PREFIX, broadcastOf, decide, hostRange, maskOf, networkOf, type Ipv4Device, type Ipv4State } from "@/lib/sim-engine/scenarios/ipv4Basics";

type Table = { title: string; rows: { label: string; value: string }[] };

export function v4Tables(device: Ipv4Device, s: Ipv4State): Table[] {
  if (device === "R1") {
    return [
      { title: "Routing table", rows: R1_ROUTES.map((r) => ({ label: r.prefix, value: `${r.iface} · ${r.via}` })) },
      {
        title: "Interfaces",
        rows: [
          { label: "ge-0/0/0", value: `${V4_IP.R1L}/${V4_PREFIX} · ${V4_MAC.R1L}` },
          { label: "ge-0/0/1", value: `${V4_IP.R1R}/${V4_PREFIX} · ${V4_MAC.R1R}` },
        ],
      },
      {
        title: "ARP cache",
        rows: [
          { label: V4_IP["HOST-A"], value: V4_MAC["HOST-A"] },
          { label: V4_IP["HOST-B"], value: V4_MAC["HOST-B"] },
        ],
      },
    ];
  }
  if (device === "SW-A" || device === "SW-B") return [{ title: "FDB", rows: SW_PORTS[device].map((p) => ({ label: p.mac, value: `${p.port} → ${p.to}` })) }];
  const prefix = device === "HOST-A" ? s.hostAPrefix : V4_PREFIX;
  const ip = V4_IP[device];
  const range = hostRange(ip, prefix);
  const other = device === "HOST-A" ? V4_IP["HOST-B"] : V4_IP["HOST-A"];
  const d = decide(device, prefix, other);
  const gw = GATEWAY[device];
  const arp = device === "HOST-A" ? [{ label: gw, value: V4_MAC.R1L }, ...(s.hostAUnresolved ? [{ label: V4_IP["HOST-B"], value: "INCOMPLETE" }] : [])] : [{ label: gw, value: V4_MAC.R1R }];
  return [
    {
      title: "Addressing",
      rows: [
        { label: "IPv4", value: `${ip}/${prefix}` },
        { label: "Mask", value: maskOf(prefix) },
        { label: "Subnet", value: `${networkOf(ip, prefix)}/${prefix}` },
        { label: "Broadcast", value: broadcastOf(ip, prefix) },
        { label: "Host range", value: range ? `${range.first} – ${range.last}` : "n/a" },
        { label: "Gateway", value: gw },
      ],
    },
    { title: "Next hop", rows: [{ label: `to ${other}`, value: d.onLink ? `on-link → ARP for ${other}` : `remote → gateway ${gw}` }] },
    { title: "ARP cache", rows: arp },
  ];
}

export function explainV4(s: Ipv4State, id: string, stepId: string): NodeExplanation {
  const device = id as Ipv4Device;
  const hop = [...s.hops].reverse().find((h) => h.device === device && h.stepId === stepId);
  const tables = v4Tables(device, s);
  const act = hop ? `${hop.action}: ${hop.reason}` : undefined;
  if (device === "R1") {
    return {
      id,
      name: "R1",
      deviceType: "IPv4 router",
      role: "Forwards IPv4 packets between its two connected /26 networks",
      currentAction: act ?? "Idle this step.",
      controlPlaneRole: `Knows only its connected routes: ${R1_ROUTES.map((r) => `${r.prefix} on ${r.iface}`).join(", ")}. No routing protocol. Proxy ARP is disabled.`,
      dataPlaneRole: hop ? `Received: ${hop.input}. Lookup: ${hop.lookupKey} → ${hop.lookupResult}. Sent: ${hop.output}.` : "Accepts frames addressed to its own MAC, looks up the IPv4 destination, decrements TTL, recomputes the header checksum and sends a new Ethernet frame on the egress link.",
      packetBefore: hop?.input,
      packetAfter: hop?.output,
      tables,
    };
  }
  if (device === "SW-A" || device === "SW-B") {
    return {
      id,
      name: device,
      deviceType: "Ethernet switch",
      role: `Switches frames inside ${device === "SW-A" ? "HOST-A's" : "HOST-B's"} LAN by destination MAC`,
      currentAction: act ?? "Idle this step.",
      controlPlaneRole: "Knows MAC → port only. It never reads IPv4 addresses or masks.",
      dataPlaneRole: hop ? `Received: ${hop.input}. Lookup: ${hop.lookupResult}. Sent: ${hop.output}.` : "Forwards known unicast; floods broadcast (like ARP requests) out every other port.",
      packetBefore: hop?.input,
      packetAfter: hop?.output,
      tables,
    };
  }
  const prefix = device === "HOST-A" ? s.hostAPrefix : V4_PREFIX;
  const wrong = device === "HOST-A" && prefix !== V4_PREFIX;
  return {
    id,
    name: device,
    deviceType: "IPv4 host",
    role: `${V4_IP[device]}/${prefix} · gateway ${GATEWAY[device]}`,
    currentAction: act ?? "Idle this step.",
    controlPlaneRole: `Knows its own address, mask ${maskOf(prefix)} and gateway. It decides on-link vs remote by ANDing with ITS OWN mask.`,
    dataPlaneRole: hop ? `Lookup: ${hop.lookupType} → ${hop.lookupResult}. Result: ${hop.output}.` : "Off-link packets are framed to the gateway's MAC; the IPv4 destination stays the real host.",
    packetBefore: hop?.input,
    packetAfter: hop?.output,
    note: wrong ? `Configured /${prefix} (${maskOf(prefix)}) makes ${networkOf(V4_IP[device], prefix)}/${prefix} look like one LAN, but R1 and HOST-B are on a different /${V4_PREFIX}.` : undefined,
    tables,
  };
}
