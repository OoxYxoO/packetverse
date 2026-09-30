import type { DeviceInterfaceData, DeviceProcessingTrace, InterfaceRole } from "@/components/network3d/types";
import { traceFromHops } from "@/components/lesson/fundamentalsTrace";
import { IP, MAC, OSPF_COST, RT_STAGES, type RtDevice, type RtState } from "@/lib/sim-engine/scenarios/troubleshootingRouting";

export function rtTraceFor(device: RtDevice, s: RtState, stepId: string): DeviceProcessingTrace {
  return traceFromHops(device, s.hops, stepId, RT_STAGES[device]);
}

function roleAt(s: RtState, device: RtDevice, stepId: string, iface: string): InterfaceRole {
  const hop = [...s.hops].reverse().find((h) => h.device === device && h.stepId === stepId);
  if (!hop) return "idle";
  if (hop.ingressInterfaceId === iface) return "ingress";
  if (hop.egressInterfaceId === iface) return "egress";
  return "idle";
}

const IFS: Record<RtDevice, { name: string; ip: string; mac: string; peer: RtDevice; peerLabel: string; ospf?: boolean }[]> = {
  CLIENT: [{ name: "eth0", ip: `${IP.client}/24`, mac: MAC.CLIENT, peer: "R1", peerLabel: "R1 ge-0/0/0" }],
  R1: [
    { name: "ge-0/0/0", ip: `${IP.r1Lan}/24`, mac: MAC.R1_LAN, peer: "CLIENT", peerLabel: "CLIENT eth0" },
    { name: "ge-0/0/1", ip: `${IP.r1T}/31`, mac: MAC.R1_T, peer: "R2", peerLabel: "R2 ge-0/0/0", ospf: true },
  ],
  R2: [
    { name: "ge-0/0/0", ip: `${IP.r2a}/31`, mac: MAC.R2_A, peer: "R1", peerLabel: "R1 ge-0/0/1", ospf: true },
    { name: "ge-0/0/1", ip: `${IP.r2b}/31`, mac: MAC.R2_B, peer: "R3", peerLabel: "R3 ge-0/0/0", ospf: true },
  ],
  R3: [
    { name: "ge-0/0/0", ip: `${IP.r3T}/31`, mac: MAC.R3_T, peer: "R2", peerLabel: "R2 ge-0/0/1", ospf: true },
    { name: "ge-0/0/1", ip: `${IP.r3Lan}/24`, mac: MAC.R3_LAN, peer: "SERVER-A", peerLabel: "server LAN" },
  ],
  "SERVER-A": [{ name: "eth0", ip: `${IP.srvA}/24`, mac: MAC.SRV_A, peer: "R3", peerLabel: "R3 ge-0/0/1" }],
  "SERVER-B": [{ name: "eth0", ip: `${IP.srvB}/24`, mac: MAC.SRV_B, peer: "R3", peerLabel: "R3 ge-0/0/1" }],
};

export function rtInterfacesFor(device: RtDevice, s: RtState, stepId: string): DeviceInterfaceData[] {
  return IFS[device].map((i) => ({
    id: i.name,
    name: i.name,
    status: "up" as const,
    ip: i.ip,
    neighborId: i.peer,
    neighborLabel: i.peerLabel,
    linkType: i.ospf ? `OSPF area 0 · point-to-point · cost ${OSPF_COST}` : "Ethernet",
    role: roleAt(s, device, stepId, i.name),
    extra: [{ label: "MAC", value: i.mac }, ...(i.ospf ? [{ label: "OSPF neighbor", value: `${i.peer} Full` }] : [])],
  }));
}
