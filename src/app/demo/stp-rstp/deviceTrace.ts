import type { DeviceInterfaceData, DeviceProcessingTrace, InterfaceRole } from "@/components/network3d/types";
import { traceFromHops } from "@/components/lesson/fundamentalsTrace";
import { HOST_ATTACH, HOST_MAC, HOST_STAGES, RSTP_STAGES, STP_PORTS, portIdOf, portIdText, portMac, portSummary, vectorText, type StpDevice, type StpHost, type StpState, type StpSw } from "@/lib/sim-engine/scenarios/stpRstp";

const isSwitch = (d: StpDevice): d is StpSw => d === "SW1" || d === "SW2" || d === "SW3";

export function stpTraceFor(device: StpDevice, s: StpState, stepId: string): DeviceProcessingTrace {
  return traceFromHops(device, s.hops, stepId, isSwitch(device) ? RSTP_STAGES : HOST_STAGES);
}

function roleAt(s: StpState, device: StpDevice, stepId: string, iface: string): InterfaceRole {
  const hop = [...s.hops].reverse().find((h) => h.device === device && h.stepId === stepId);
  if (!hop) return "idle";
  if (hop.ingressInterfaceId === iface) return "ingress";
  if (hop.egressInterfaceId === iface || hop.egressInterfaceIds?.includes(iface)) return "egress";
  return "idle";
}

export function stpInterfacesFor(device: StpDevice, s: StpState, stepId: string): DeviceInterfaceData[] {
  if (isSwitch(device)) {
    const sum = portSummary(s, device);
    return STP_PORTS[device].map((p) => {
      const x = sum.find((y) => y.port === p.port)!;
      return {
        id: p.port,
        name: p.port,
        status: x.up ? ("up" as const) : ("down" as const),
        neighborId: p.peer,
        neighborLabel: `${p.peer} ${p.peerPort}`,
        linkType: p.link === "edge" ? "Edge (host)" : `Inter-switch ${p.link}`,
        role: roleAt(s, device, stepId, p.port),
        extra: [
          { label: "Physical link", value: x.up ? "up" : "down" },
          { label: "RSTP participation", value: p.link === "edge" ? "edge port" : x.rstp ? "enabled" : "DISABLED" },
          { label: "Port role", value: x.role },
          { label: "Port state", value: x.state },
          { label: "Port ID", value: portIdText(portIdOf(device, p.port)) },
          { label: "Port MAC", value: portMac(device, p.port) },
          { label: "Last BPDU received", value: p.link === "edge" ? "none (edge)" : x.rx ? vectorText(x.rx) : "none" },
        ],
      };
    });
  }
  const h = device as StpHost;
  return [{ id: "eth0", name: "eth0", status: "up", neighborId: HOST_ATTACH[h].sw, neighborLabel: `${HOST_ATTACH[h].sw} ${HOST_ATTACH[h].port}`, linkType: "Access", role: roleAt(s, device, stepId, "eth0"), extra: [{ label: "MAC", value: HOST_MAC[h] }] }];
}
