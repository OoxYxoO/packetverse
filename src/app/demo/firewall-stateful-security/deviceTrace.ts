import type { DeviceInterfaceData, DeviceProcessingTrace, InterfaceRole } from "@/components/network3d/types";
import { traceFromHops } from "@/components/lesson/fundamentalsTrace";
import { CLIENT_STAGES, FW, FW_IFACES, FW_MAC, FW_STAGES, ISP_STAGES, WEB_PORT, WEB_STAGES, type FwDevice, type FwState } from "@/lib/sim-engine/scenarios/firewallStateful";

const STAGES = { CLIENT: CLIENT_STAGES, FW1: FW_STAGES, ISP: ISP_STAGES, "WEB-SERVER": WEB_STAGES } as const;

export function fwTraceFor(device: FwDevice, s: FwState, stepId: string): DeviceProcessingTrace {
  return traceFromHops(device, s.hops, stepId, STAGES[device]);
}

function roleAt(s: FwState, device: FwDevice, stepId: string, iface: string): InterfaceRole {
  const hop = [...s.hops].reverse().find((h) => h.device === device && h.stepId === stepId);
  if (!hop) return "idle";
  if (hop.ingressInterfaceId === iface) return "ingress";
  if (hop.egressInterfaceId === iface) return "egress";
  return "idle";
}

export function fwInterfacesFor(device: FwDevice, s: FwState, stepId: string): DeviceInterfaceData[] {
  if (device === "FW1" || device === "ISP") {
    return FW_IFACES[device].map((i) => ({
      id: i.name,
      name: i.name,
      status: "up" as const,
      ip: `${i.addr}/${i.len}`,
      neighborId: i.peer,
      neighborLabel: `${i.peer} ${i.peerIface}`,
      linkType: i.zone ? `Zone ${i.zone}` : "Routed",
      role: roleAt(s, device, stepId, i.name),
      extra: [{ label: "MAC", value: i.mac }, ...(i.zone ? [{ label: "Security zone", value: i.zone }] : []), ...(device === "FW1" && i.zone === "untrust" ? [{ label: "SNAT-OUT translates to", value: s.natAddr }] : [])],
    }));
  }
  if (device === "CLIENT") {
    return [{ id: "eth0", name: "eth0", status: "up", ip: `${FW.client}/24`, neighborId: "FW1", neighborLabel: "FW1 ge-0/0/0", linkType: "Access (trust LAN)", role: roleAt(s, device, stepId, "eth0"), extra: [{ label: "MAC", value: FW_MAC.CLIENT }, { label: "Default gateway", value: FW.trust }, { label: "TCP state", value: s.client.state }, { label: "Source port", value: s.client.sport ? String(s.client.sport) : "none open" }] }];
  }
  return [{ id: "eth0", name: "eth0", status: "up", ip: `${FW.web}/24`, neighborId: "ISP", neighborLabel: "ISP ge-0/0/1", linkType: "Server LAN", role: roleAt(s, device, stepId, "eth0"), extra: [{ label: "MAC", value: FW_MAC.WEB }, { label: "Default gateway", value: FW.ispWeb }, { label: "Listening", value: `TCP/${WEB_PORT}` }, { label: "TCP state", value: s.web.state }] }];
}
