import type { DeviceInterfaceData, DeviceProcessingTrace, InterfaceRole } from "@/components/network3d/types";
import { traceFromHops } from "@/components/lesson/fundamentalsTrace";
import { AP_STAGES, IP, MAC, type ApDevice, type ApState } from "@/lib/sim-engine/scenarios/troubleshootingApplication";

export function apTraceFor(device: ApDevice, s: ApState, stepId: string): DeviceProcessingTrace {
  return traceFromHops(device, s.hops, stepId, AP_STAGES[device]);
}

function roleAt(s: ApState, device: ApDevice, stepId: string, iface: string): InterfaceRole {
  const hop = [...s.hops].reverse().find((h) => h.device === device && h.stepId === stepId);
  if (!hop) return "idle";
  if (hop.ingressInterfaceId === iface) return "ingress";
  if (hop.egressInterfaceId === iface) return "egress";
  return "idle";
}

const IFS: Record<ApDevice, { name: string; ip: string; mac: string; peer: ApDevice; type: string }[]> = {
  CLIENT: [{ name: "eth0", ip: `${IP.client}/24`, mac: MAC.CLIENT, peer: "NETWORK", type: `Ethernet · gw ${IP.gwClient}` }],
  NETWORK: [
    { name: "ge-0/0/0", ip: `${IP.gwClient}/24`, mac: MAC.NET_C, peer: "CLIENT", type: "Client LAN" },
    { name: "ge-0/0/1", ip: `${IP.gwServers}/24`, mac: MAC.NET_S, peer: "DNS", type: "Server LAN (DNS, WEB-OLD, WEB-NEW)" },
  ],
  DNS: [{ name: "eth0", ip: `${IP.dns}/24`, mac: MAC.DNS, peer: "NETWORK", type: "Ethernet · UDP/53" }],
  "WEB-OLD": [{ name: "eth0", ip: `${IP.old}/24`, mac: MAC.OLD, peer: "NETWORK", type: "Ethernet · TCP/80" }],
  "WEB-NEW": [{ name: "eth0", ip: `${IP.new}/24`, mac: MAC.NEW, peer: "NETWORK", type: "Ethernet · TCP/80" }],
};

export function apInterfacesFor(device: ApDevice, s: ApState, stepId: string): DeviceInterfaceData[] {
  return IFS[device].map((i) => ({ id: i.name, name: i.name, status: "up" as const, ip: i.ip, neighborId: i.peer, neighborLabel: i.peer, linkType: i.type, role: roleAt(s, device, stepId, i.name), extra: [{ label: "MAC", value: i.mac }] }));
}
