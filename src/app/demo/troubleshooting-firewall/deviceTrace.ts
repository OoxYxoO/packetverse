import type { DeviceInterfaceData, DeviceProcessingTrace, InterfaceRole } from "@/components/network3d/types";
import { traceFromHops } from "@/components/lesson/fundamentalsTrace";
import { FW_ALL_STAGES, IP, MAC, type FwDevice, type FwState } from "@/lib/sim-engine/scenarios/troubleshootingFirewall";

export function fwTraceFor(device: FwDevice, s: FwState, stepId: string): DeviceProcessingTrace {
  return traceFromHops(device, s.hops, stepId, FW_ALL_STAGES[device]);
}

function roleAt(s: FwState, device: FwDevice, stepId: string, iface: string): InterfaceRole {
  const hop = [...s.hops].reverse().find((h) => h.device === device && h.stepId === stepId);
  if (!hop) return "idle";
  if (hop.ingressInterfaceId === iface) return "ingress";
  if (hop.egressInterfaceId === iface) return "egress";
  return "idle";
}

const IFS: Record<FwDevice, { name: string; ip: string; mac: string; peer: FwDevice; type: string }[]> = {
  CLIENT: [{ name: "eth0", ip: `${IP.client}/24`, mac: MAC.CLIENT, peer: "EDGE-R1", type: "Ethernet" }],
  "EDGE-R1": [
    { name: "ge-0/0/0", ip: `${IP.r1Lan}/24`, mac: MAC.R1_LAN, peer: "CLIENT", type: "Client LAN" },
    { name: "ge-0/0/1", ip: `${IP.r1Fw1}/31`, mac: MAC.R1_F1, peer: "FW1", type: "to FW1" },
    { name: "ge-0/0/2", ip: `${IP.r1Fw2}/31`, mac: MAC.R1_F2, peer: "FW2", type: "to FW2" },
  ],
  FW1: [
    { name: "ge-0/0/0 (trust)", ip: `${IP.fw1In}/31`, mac: MAC.FW1_IN, peer: "EDGE-R1", type: "zone trust" },
    { name: "ge-0/0/1 (dmz)", ip: `${IP.fw1Out}/31`, mac: MAC.FW1_OUT, peer: "EDGE-R2", type: "zone dmz" },
  ],
  FW2: [
    { name: "ge-0/0/0 (trust)", ip: `${IP.fw2In}/31`, mac: MAC.FW2_IN, peer: "EDGE-R1", type: "zone trust" },
    { name: "ge-0/0/1 (dmz)", ip: `${IP.fw2Out}/31`, mac: MAC.FW2_OUT, peer: "EDGE-R2", type: "zone dmz" },
  ],
  "EDGE-R2": [
    { name: "ge-0/0/1", ip: `${IP.r2Fw1}/31`, mac: MAC.R2_F1, peer: "FW1", type: "to FW1" },
    { name: "ge-0/0/2", ip: `${IP.r2Fw2}/31`, mac: MAC.R2_F2, peer: "FW2", type: "to FW2" },
    { name: "ge-0/0/0", ip: `${IP.r2Lan}/24`, mac: MAC.R2_LAN, peer: "SERVER", type: "Server LAN" },
  ],
  SERVER: [{ name: "eth0", ip: `${IP.server}/24`, mac: MAC.SERVER, peer: "EDGE-R2", type: "Ethernet" }],
};

export function fwInterfacesFor(device: FwDevice, s: FwState, stepId: string): DeviceInterfaceData[] {
  return IFS[device].map((i) => ({ id: i.name, name: i.name, status: "up" as const, ip: i.ip, neighborId: i.peer, neighborLabel: i.peer, linkType: i.type, role: roleAt(s, device, stepId, i.name), extra: [{ label: "MAC", value: i.mac }] }));
}
