import type { DeviceInterfaceData, DeviceProcessingTrace, InterfaceRole } from "@/components/network3d/types";
import { traceFromHops } from "@/components/lesson/fundamentalsTrace";
import { CLIENT_STAGES, DH_ADDR, DH_MAC, RELAY_STAGES, SERVER_STAGES, SWITCH_STAGES, type DhDevice, type DhState } from "@/lib/sim-engine/scenarios/dhcpDns";

const IDLE: Record<DhDevice, typeof CLIENT_STAGES> = { CLIENT: CLIENT_STAGES, SW1: SWITCH_STAGES, SW2: SWITCH_STAGES, R1: RELAY_STAGES, "DHCP-SRV": SERVER_STAGES, "DNS-SRV": SERVER_STAGES };
export function dhTraceFor(device: DhDevice, s: DhState, stepId: string): DeviceProcessingTrace {
  return traceFromHops(device, s.hops, stepId, IDLE[device]);
}

function roleAt(s: DhState, device: DhDevice, stepId: string, iface: string): InterfaceRole {
  const hops = s.hops.filter((h) => h.device === device && h.stepId === stepId);
  if (hops.some((h) => h.ingressInterfaceId === iface)) return "ingress";
  if (hops.some((h) => h.egressInterfaceId === iface)) return "egress";
  return "idle";
}

export function dhInterfacesFor(device: DhDevice, s: DhState, stepId: string): DeviceInterfaceData[] {
  switch (device) {
    case "R1":
      return [
        { id: "ge-0/0/0", name: "ge-0/0/0", status: "up", ip: `${DH_ADDR["R1:CLIENT"]}/24`, neighborId: "SW1", neighborLabel: "SW1 (client LAN)", linkType: "Ethernet", role: roleAt(s, "R1", stepId, "ge-0/0/0"), extra: [{ label: "DHCP relay", value: `helper ${DH_ADDR["DHCP-SRV"]} · giaddr ${DH_ADDR["R1:CLIENT"]}` }, { label: "MAC", value: DH_MAC["R1:CLIENT"] }] },
        { id: "ge-0/0/1", name: "ge-0/0/1", status: "up", ip: `${DH_ADDR["R1:SERVER"]}/24`, neighborId: "SW2", neighborLabel: "SW2 (server LAN)", linkType: "Ethernet", role: roleAt(s, "R1", stepId, "ge-0/0/1"), extra: [{ label: "MAC", value: DH_MAC["R1:SERVER"] }] },
      ];
    case "SW1":
      return [
        { id: "p1", name: "p1", status: "up", neighborId: "CLIENT", neighborLabel: "CLIENT", linkType: "access", role: roleAt(s, "SW1", stepId, "p1") },
        { id: "p2", name: "p2", status: "up", neighborId: "R1", neighborLabel: "R1 ge-0/0/0", linkType: "access", role: roleAt(s, "SW1", stepId, "p2") },
      ];
    case "SW2":
      return [
        { id: "p1", name: "p1", status: "up", neighborId: "R1", neighborLabel: "R1 ge-0/0/1", linkType: "access", role: roleAt(s, "SW2", stepId, "p1") },
        { id: "p2", name: "p2", status: "up", neighborId: "DHCP-SRV", neighborLabel: "DHCP-SRV", linkType: "access", role: roleAt(s, "SW2", stepId, "p2") },
        { id: "p3", name: "p3", status: "up", neighborId: "DNS-SRV", neighborLabel: "DNS-SRV", linkType: "access", role: roleAt(s, "SW2", stepId, "p3") },
      ];
    case "CLIENT":
      return [{ id: "eth0", name: "eth0", status: "up", ip: s.client.ip ? `${s.client.ip}/24` : undefined, neighborId: "SW1", neighborLabel: "SW1 p1", linkType: "Ethernet", role: roleAt(s, "CLIENT", stepId, "eth0"), extra: [{ label: "DHCP state", value: s.client.phase }, { label: "MAC", value: DH_MAC.CLIENT }] }];
    default:
      return [{ id: "eth0", name: "eth0", status: "up", ip: `${DH_ADDR[device]}/24`, neighborId: "SW2", neighborLabel: "SW2", linkType: "Ethernet", role: roleAt(s, device, stepId, "eth0"), extra: [{ label: "Gateway", value: DH_ADDR["R1:SERVER"] }, { label: "MAC", value: DH_MAC[device] }] }];
  }
}
