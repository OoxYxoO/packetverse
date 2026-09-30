import type { DeviceInterfaceData, DeviceProcessingTrace, InterfaceRole } from "@/components/network3d/types";
import { traceFromHops } from "@/components/lesson/fundamentalsTrace";
import { L2_IP, L2_MAC, L2_PORTS, L2_STAGES, NATIVE_VLAN, allowedText, stpState, type L2Device, type L2Host, type L2State, type L2Sw } from "@/lib/sim-engine/scenarios/troubleshootingLayer2";

export function l2TraceFor(device: L2Device, s: L2State, stepId: string): DeviceProcessingTrace {
  return traceFromHops(device, s.hops, stepId, L2_STAGES[device]);
}

function roleAt(s: L2State, device: L2Device, stepId: string, iface: string): InterfaceRole {
  const hop = [...s.hops].reverse().find((h) => h.device === device && h.stepId === stepId);
  if (!hop) return "idle";
  if (hop.ingressInterfaceId === iface) return "ingress";
  if (hop.egressInterfaceId === iface || hop.egressInterfaceIds?.includes(iface)) return "egress";
  return "idle";
}

/** Ports as the switch reports them at the SHOWN step: mode, VLAN membership, native VLAN and RSTP role/state. */
export function l2InterfacesFor(device: L2Device, s: L2State, stepId: string): DeviceInterfaceData[] {
  if (device === "HOST-A" || device === "HOST-B") {
    const h = device as L2Host;
    return [{ id: "eth0", name: "eth0", status: "up", ip: `${L2_IP[h]}/24`, neighborId: h === "HOST-A" ? "SW1" : "SW3", neighborLabel: `${h === "HOST-A" ? "SW1" : "SW3"} ge-0/0/1`, linkType: "Ethernet (untagged)", role: roleAt(s, device, stepId, "eth0"), extra: [{ label: "MAC", value: L2_MAC[h] }] }];
  }
  return L2_PORTS.filter((p) => p.sw === (device as L2Sw)).map((p) => ({
    id: p.port,
    name: p.port,
    status: "up" as const,
    neighborId: p.peer,
    neighborLabel: p.peerPort ? `${p.peer} ${p.peerPort}` : `${p.peer} eth0`,
    linkType: p.mode === "access" ? `Access · PVID ${p.pvid}` : "802.1Q trunk",
    role: roleAt(s, device, stepId, p.port),
    extra: [
      { label: "Admin / oper", value: "up / up" },
      { label: "Mode", value: p.mode },
      ...(p.mode === "trunk" ? [{ label: "Allowed VLANs", value: allowedText(s, p.sw, p.port) }, { label: "Native VLAN", value: `${NATIVE_VLAN} (untagged)` }] : [{ label: "Access VLAN (PVID)", value: String(p.pvid) }]),
      { label: "RSTP role / state", value: `${p.role} / ${stpState(p)}` },
    ],
  }));
}
