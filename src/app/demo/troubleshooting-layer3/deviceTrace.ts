import type { DeviceInterfaceData, DeviceProcessingTrace, InterfaceRole } from "@/components/network3d/types";
import { traceFromHops } from "@/components/lesson/fundamentalsTrace";
import { L3, L3_MAC, L3_STAGES, maskOf, type L3Device, type L3State } from "@/lib/sim-engine/scenarios/troubleshootingLayer3";

export function l3TraceFor(device: L3Device, s: L3State, stepId: string): DeviceProcessingTrace {
  return traceFromHops(device, s.hops, stepId, L3_STAGES[device]);
}

function roleAt(s: L3State, device: L3Device, stepId: string, iface: string): InterfaceRole {
  const hop = [...s.hops].reverse().find((h) => h.device === device && h.stepId === stepId);
  if (!hop) return "idle";
  if (hop.ingressInterfaceId === iface) return "ingress";
  if (hop.egressInterfaceId === iface) return "egress";
  return "idle";
}

const IFS: Record<L3Device, { name: string; ip?: string; mac?: string; peer: L3Device; peerLabel: string }[]> = {
  CLIENT: [{ name: "eth0", mac: L3_MAC.CLIENT, peer: "SW1", peerLabel: "SW1 ge-0/0/1" }],
  SW1: [
    { name: "ge-0/0/1", peer: "CLIENT", peerLabel: "CLIENT eth0" },
    { name: "ge-0/0/24", peer: "R1", peerLabel: "R1 ge-0/0/0" },
  ],
  R1: [
    { name: "ge-0/0/0", ip: `${L3.gw}/24`, mac: L3_MAC.R1_LAN, peer: "SW1", peerLabel: "SW1 ge-0/0/24" },
    { name: "ge-0/0/1", ip: `${L3.r1T}/31`, mac: L3_MAC.R1_T, peer: "R2", peerLabel: "R2 ge-0/0/0" },
  ],
  R2: [
    { name: "ge-0/0/0", ip: `${L3.r2T}/31`, mac: L3_MAC.R2_T, peer: "R1", peerLabel: "R1 ge-0/0/1" },
    { name: "ge-0/0/1", ip: `${L3.r2Srv}/24`, mac: L3_MAC.R2_SRV, peer: "SERVER", peerLabel: "SERVER eth0" },
    { name: "ge-0/0/2", ip: `${L3.r2Rem}/24`, mac: L3_MAC.R2_REM, peer: "REMOTE-SERVER", peerLabel: "REMOTE-SERVER eth0" },
  ],
  SERVER: [{ name: "eth0", ip: `${L3.server}/24`, mac: L3_MAC.SERVER, peer: "R2", peerLabel: "R2 ge-0/0/1" }],
  "REMOTE-SERVER": [{ name: "eth0", ip: `${L3.remote}/24`, mac: L3_MAC.REMOTE, peer: "R2", peerLabel: "R2 ge-0/0/2" }],
};

/** Interfaces at the SHOWN step — CLIENT's address carries its configured prefix at that step. */
export function l3InterfacesFor(device: L3Device, s: L3State, stepId: string): DeviceInterfaceData[] {
  return IFS[device].map((i) => ({
    id: i.name,
    name: i.name,
    status: "up" as const,
    ip: device === "CLIENT" ? `${L3.client}/${s.clientPrefix}` : i.ip,
    neighborId: i.peer,
    neighborLabel: i.peerLabel,
    linkType: device === "SW1" ? "Access port (VLAN 1)" : "Ethernet",
    role: roleAt(s, device, stepId, i.name),
    extra: [...(i.mac ? [{ label: "MAC", value: i.mac }] : []), ...(device === "CLIENT" ? [{ label: "Mask", value: maskOf(s.clientPrefix) }, { label: "Gateway", value: L3.gw }] : [])],
  }));
}
