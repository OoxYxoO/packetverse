import type { DeviceInterfaceData, DeviceProcessingTrace, InterfaceRole } from "@/components/network3d/types";
import { traceFromHops } from "@/components/lesson/fundamentalsTrace";
import { CUST, LOOP, MAC, MP_STAGES, VRF, type MpDevice, type MpState } from "@/lib/sim-engine/scenarios/troubleshootingMpls";

export function mpTraceFor(device: MpDevice, s: MpState, stepId: string): DeviceProcessingTrace {
  return traceFromHops(device, s.hops, stepId, MP_STAGES[device]);
}

function roleAt(s: MpState, device: MpDevice, stepId: string, iface: string): InterfaceRole {
  const hop = [...s.hops].reverse().find((h) => h.device === device && h.stepId === stepId);
  if (!hop) return "idle";
  if (hop.ingressInterfaceId === iface) return "ingress";
  if (hop.egressInterfaceId === iface) return "egress";
  return "idle";
}

const IFS: Record<MpDevice, { name: string; ip: string; mac?: string; peer: MpDevice; type: string }[]> = {
  CE1: [{ name: "ge-0/0/0", ip: `${CUST.ce1Pe}/30`, mac: MAC.CE1, peer: "PE1", type: "Customer ↔ PE (plain IPv4)" }],
  PE1: [
    { name: "ge-0/0/0", ip: `${CUST.pe1Ce}/30 (VRF ${VRF})`, mac: MAC.PE1_CE, peer: "CE1", type: `PE–CE, VRF ${VRF}` },
    { name: "ge-0/0/1", ip: "172.30.0.0/31", mac: MAC.PE1_CORE, peer: "P1", type: "Core · IGP + LDP" },
  ],
  P1: [
    { name: "ge-0/0/0", ip: "172.30.0.1/31", mac: MAC.P1_A, peer: "PE1", type: "Core · IGP + LDP" },
    { name: "ge-0/0/1", ip: "172.30.0.2/31", mac: MAC.P1_B, peer: "P2", type: "Core · IGP + LDP" },
  ],
  P2: [
    { name: "ge-0/0/0", ip: "172.30.0.3/31", mac: MAC.P2_A, peer: "P1", type: "Core · IGP + LDP" },
    { name: "ge-0/0/1", ip: "172.30.0.4/31", mac: MAC.P2_B, peer: "PE2", type: "Core · IGP + LDP" },
  ],
  PE2: [
    { name: "ge-0/0/0", ip: "172.30.0.5/31", mac: MAC.PE2_CORE, peer: "P2", type: "Core · IGP + LDP" },
    { name: "ge-0/0/1", ip: `${CUST.pe2Ce}/30 (VRF ${VRF})`, mac: MAC.PE2_CE, peer: "CE2", type: `PE–CE, VRF ${VRF}` },
  ],
  CE2: [{ name: "ge-0/0/0", ip: `${CUST.ce2Pe}/30`, mac: MAC.CE2, peer: "PE2", type: "Customer ↔ PE (plain IPv4)" }],
};

export function mpInterfacesFor(device: MpDevice, s: MpState, stepId: string): DeviceInterfaceData[] {
  const phys = IFS[device].map((i) => ({ id: i.name, name: i.name, status: "up" as const, ip: i.ip, neighborId: i.peer, neighborLabel: i.peer, linkType: i.type, role: roleAt(s, device, stepId, i.name), extra: i.mac ? [{ label: "MAC", value: i.mac }] : [] }));
  const lo = (LOOP as Record<string, string>)[device];
  return lo ? [...phys, { id: "lo0", name: "lo0", status: "up" as const, ip: `${lo}/32`, linkType: "Loopback (LDP FEC, BGP source)", role: "idle" as const }] : phys;
}
