import type { DeviceInterfaceData, DeviceProcessingTrace, InterfaceRole } from "@/components/network3d/types";
import { traceFromHops } from "@/components/lesson/fundamentalsTrace";
import { HOST_RX_STAGES, HOST_VLAN, SWITCH_PORTS, SW_STAGES, VLAN_MAC, hostAttach, vlanMacName, type VlanDevice, type VlanHost, type VlanState } from "@/lib/sim-engine/scenarios/vlanFundamentals";

export function vlanTraceFor(device: VlanDevice, s: VlanState, stepId: string): DeviceProcessingTrace {
  return traceFromHops(device, s.hops, stepId, device === "SW1" || device === "SW2" ? SW_STAGES : HOST_RX_STAGES);
}

function roleAt(s: VlanState, device: VlanDevice, stepId: string, port: string): InterfaceRole {
  const hop = [...s.hops].reverse().find((h) => h.device === device && h.stepId === stepId);
  if (!hop) return "idle";
  if (hop.ingressInterfaceId === port) return "ingress";
  if (hop.egressInterfaceId === port || hop.egressInterfaceIds?.includes(port)) return "egress";
  return "idle";
}

export function vlanInterfacesFor(device: VlanDevice, s: VlanState, stepId: string): DeviceInterfaceData[] {
  if (device === "SW1" || device === "SW2") {
    return SWITCH_PORTS[device].map((p) => {
      const macs = s.fdb[device].filter((e) => e.port === p.port).map((e) => `V${e.vlan} ${vlanMacName(e.mac)}`);
      return {
        id: p.port,
        name: p.port,
        status: "up" as const,
        neighborId: p.peer,
        neighborLabel: p.peer,
        linkType: p.mode === "access" ? `access · VLAN ${p.vlan}` : "802.1Q trunk",
        role: roleAt(s, device, stepId, p.port),
        extra: [p.mode === "access" ? { label: "Access VLAN", value: `${p.vlan} (untagged)` } : { label: "Allowed VLANs", value: s.allowed[device].join(", ") || "none" }, { label: "Learned", value: macs.length ? macs.join(", ") : "none" }],
      };
    });
  }
  const h = device as VlanHost;
  const at = hostAttach(h);
  return [{ id: "eth0", name: "eth0", status: "up", neighborId: at.sw, neighborLabel: `${at.sw} ${at.port}`, linkType: "Ethernet (untagged)", role: roleAt(s, device, stepId, "eth0"), extra: [{ label: "MAC", value: VLAN_MAC[h] }, { label: "Attached VLAN", value: `${HOST_VLAN[h]} (set on ${at.sw} ${at.port})` }] }];
}
