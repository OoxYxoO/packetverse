import type { DeviceInterfaceData, DeviceProcessingTrace, InterfaceRole } from "@/components/network3d/types";
import { traceFromHops } from "@/components/lesson/fundamentalsTrace";
import { HOST_RX_STAGES, IC_ADDR, IC_MAC, ROUTER_STAGES, ifaceInfo, mtuOf, type IcDevice, type IcmpState } from "@/lib/sim-engine/scenarios/icmpDiagnostics";

export function icTraceFor(device: IcDevice, s: IcmpState, stepId: string): DeviceProcessingTrace {
  return traceFromHops(device, s.hops, stepId, device === "R1" || device === "R2" ? ROUTER_STAGES : HOST_RX_STAGES);
}

function roleAt(s: IcmpState, device: IcDevice, stepId: string, iface: string): InterfaceRole {
  const hop = [...s.hops].reverse().find((h) => h.device === device && h.stepId === stepId);
  if (!hop) return "idle";
  if (hop.ingressInterfaceId === iface) return "ingress";
  if (hop.egressInterfaceId === iface) return "egress";
  return "idle";
}

export function icInterfacesFor(device: IcDevice, s: IcmpState, stepId: string): DeviceInterfaceData[] {
  if (device === "R1" || device === "R2") {
    const lanPrefix = device === "R1" ? "192.0.2.0/24" : "198.51.100.0/24";
    return (["ge-0/0/0", "ge-0/0/1"] as const).map((iface) => {
      const i = ifaceInfo(device, iface);
      return {
        id: iface,
        name: iface,
        status: "up" as const,
        ip: `${i.addr}/${iface === "ge-0/0/1" ? 30 : 24}`,
        neighborId: i.peer,
        neighborLabel: i.peer,
        linkType: iface === "ge-0/0/1" ? "Transit" : "LAN",
        mtu: mtuOf(s, device, iface),
        role: roleAt(s, device, stepId, iface),
        extra: [{ label: "IP MTU", value: `${mtuOf(s, device, iface)} bytes` }, { label: "Connected", value: iface === "ge-0/0/1" ? "203.0.113.0/30" : lanPrefix }, { label: "MAC", value: i.mac }],
      };
    });
  }
  const a = device === "HOST-A";
  return [{ id: "eth0", name: "eth0", status: "up", ip: a ? `${IC_ADDR["HOST-A"]}/24` : `${IC_ADDR["HOST-B"]}/24`, neighborId: a ? "R1" : "R2", neighborLabel: a ? "R1 ge-0/0/0" : "R2 ge-0/0/0", linkType: "LAN", mtu: 1500, role: roleAt(s, device, stepId, "eth0"), extra: [{ label: "Gateway", value: a ? IC_ADDR["R1:LAN"] : IC_ADDR["R2:LAN"] }, { label: "MAC", value: a ? IC_MAC["HOST-A"] : IC_MAC["HOST-B"] }] }];
}
