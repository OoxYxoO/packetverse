import type { DeviceInterfaceData, DeviceProcessingTrace, InterfaceRole } from "@/components/network3d/types";
import { traceFromHops } from "@/components/lesson/fundamentalsTrace";
import { HOST_RX_STAGES, ROUTER_STAGES, SWITCH_STAGES, SW_PORTS, V4_IP, V4_MAC, V4_PREFIX, maskOf, networkOf, type Ipv4Device, type Ipv4State } from "@/lib/sim-engine/scenarios/ipv4Basics";

export function v4TraceFor(device: Ipv4Device, s: Ipv4State, stepId: string): DeviceProcessingTrace {
  const idle = device === "R1" ? ROUTER_STAGES : device === "SW-A" || device === "SW-B" ? SWITCH_STAGES : HOST_RX_STAGES;
  return traceFromHops(device, s.hops, stepId, idle);
}

function roleAt(s: Ipv4State, device: Ipv4Device, stepId: string, iface: string): InterfaceRole {
  const hop = [...s.hops].reverse().find((h) => h.device === device && h.stepId === stepId);
  if (!hop) return "idle";
  if (hop.ingressInterfaceId === iface) return "ingress";
  if (hop.egressInterfaceId === iface) return "egress";
  return "idle";
}

export function v4InterfacesFor(device: Ipv4Device, s: Ipv4State, stepId: string): DeviceInterfaceData[] {
  if (device === "R1") {
    return [
      { id: "ge-0/0/0", name: "ge-0/0/0", status: "up", ip: `${V4_IP.R1L}/${V4_PREFIX}`, neighborId: "SW-A", neighborLabel: "SW-A (HOST-A's LAN)", linkType: "Ethernet", role: roleAt(s, "R1", stepId, "ge-0/0/0"), extra: [{ label: "MAC", value: V4_MAC.R1L }, { label: "Connected", value: `${networkOf(V4_IP.R1L, V4_PREFIX)}/${V4_PREFIX}` }, { label: "Proxy ARP", value: "disabled" }] },
      { id: "ge-0/0/1", name: "ge-0/0/1", status: "up", ip: `${V4_IP.R1R}/${V4_PREFIX}`, neighborId: "SW-B", neighborLabel: "SW-B (HOST-B's LAN)", linkType: "Ethernet", role: roleAt(s, "R1", stepId, "ge-0/0/1"), extra: [{ label: "MAC", value: V4_MAC.R1R }, { label: "Connected", value: `${networkOf(V4_IP.R1R, V4_PREFIX)}/${V4_PREFIX}` }, { label: "Proxy ARP", value: "disabled" }] },
    ];
  }
  if (device === "SW-A" || device === "SW-B") {
    return SW_PORTS[device].map((p) => ({ id: p.port, name: p.port, status: "up" as const, neighborId: p.to, neighborLabel: p.to, linkType: "Ethernet access", role: roleAt(s, device, stepId, p.port), extra: [{ label: "MAC learned", value: p.mac }] }));
  }
  const prefix = device === "HOST-A" ? s.hostAPrefix : V4_PREFIX;
  const ip = V4_IP[device];
  return [
    {
      id: "eth0",
      name: "eth0",
      status: "up",
      ip: `${ip}/${prefix}`,
      neighborId: device === "HOST-A" ? "SW-A" : "SW-B",
      neighborLabel: device === "HOST-A" ? "SW-A p1" : "SW-B p2",
      linkType: "Ethernet",
      role: roleAt(s, device, stepId, "eth0"),
      extra: [
        { label: "MAC", value: V4_MAC[device] },
        { label: "Mask", value: maskOf(prefix) },
        { label: "Subnet", value: `${networkOf(ip, prefix)}/${prefix}` },
      ],
    },
  ];
}
