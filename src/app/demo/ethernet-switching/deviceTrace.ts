import type { DeviceInterfaceData, DeviceProcessingTrace, InterfaceRole } from "@/components/network3d/types";
import { traceFromHops } from "@/components/lesson/fundamentalsTrace";
import { DESK_PORTS, ETH_MAC, HOST_RX_STAGES, SW1_PORTS, SW_STAGES, deskPortNeighbor, macName, sw1PortNeighbor, type EthDevice, type EthHost, type EthState } from "@/lib/sim-engine/scenarios/ethernetSwitching";

const isSwitch = (d: EthDevice) => d === "SW1" || d === "DESK-SW";

/** The device's own recorded hop at `stepId` (live or historical), else an idle pipeline. */
export function ethTraceFor(device: EthDevice, s: EthState, stepId: string): DeviceProcessingTrace {
  return traceFromHops(device, s.hops, stepId, isSwitch(device) ? SW_STAGES : HOST_RX_STAGES);
}

function roleAt(s: EthState, device: EthDevice, stepId: string, port: string): InterfaceRole {
  const hop = [...s.hops].reverse().find((h) => h.device === device && h.stepId === stepId);
  if (!hop) return "idle";
  if (hop.ingressInterfaceId === port) return "ingress";
  if (hop.egressInterfaceId === port || hop.egressInterfaceIds?.includes(port)) return "egress";
  return "idle";
}

export function ethInterfacesFor(device: EthDevice, s: EthState, stepId: string): DeviceInterfaceData[] {
  if (device === "SW1" || device === "DESK-SW") {
    const ports: readonly string[] = device === "SW1" ? SW1_PORTS : DESK_PORTS;
    return ports.map((port) => {
      const nb = device === "SW1" ? sw1PortNeighbor(s, port) : deskPortNeighbor(s, port);
      const macs = s.fdb[device].filter((e) => e.port === port).map((e) => macName(e.mac));
      return {
        id: port,
        name: port,
        status: nb ? "up" : "down",
        neighborId: nb,
        neighborLabel: nb ?? "no link",
        linkType: "Ethernet access",
        role: roleAt(s, device, stepId, port),
        extra: [{ label: "MACs learned here", value: macs.length ? macs.join(", ") : "none" }],
      };
    });
  }
  const host = device as EthHost;
  const attach = host === "HOST-B" ? s.hostB : host === "HOST-A" ? "SW1 ge-0/0/1" : "SW1 ge-0/0/3";
  return [
    {
      id: "eth0",
      name: "eth0",
      status: "up",
      neighborId: attach.startsWith("SW1") ? "SW1" : "DESK-SW",
      neighborLabel: attach,
      linkType: "Ethernet",
      role: roleAt(s, device, stepId, "eth0"),
      extra: [{ label: "MAC", value: ETH_MAC[host] }],
    },
  ];
}
