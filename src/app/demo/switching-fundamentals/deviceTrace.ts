import type { DeviceInterfaceData, DeviceProcessingTrace, InterfaceRole } from "@/components/network3d/types";
import { traceFromHops } from "@/components/lesson/fundamentalsTrace";
import { HOST_ATTACH, HOST_RX_STAGES, SWF_MAC, SWF_PORTS, SW_STAGES, macName, portForwarding, type SwfDevice, type SwfHost, type SwfState } from "@/lib/sim-engine/scenarios/switchingFundamentals";

const isSwitch = (d: SwfDevice): d is "SW1" | "SW2" => d === "SW1" || d === "SW2";

export function swfTraceFor(device: SwfDevice, s: SwfState, stepId: string): DeviceProcessingTrace {
  return traceFromHops(device, s.hops, stepId, isSwitch(device) ? SW_STAGES : HOST_RX_STAGES);
}

function roleAt(s: SwfState, device: SwfDevice, stepId: string, iface: string): InterfaceRole {
  const hop = [...s.hops].reverse().find((h) => h.device === device && h.stepId === stepId);
  if (!hop) return "idle";
  if (hop.ingressInterfaceId === iface) return "ingress";
  if (hop.egressInterfaceId === iface || hop.egressInterfaceIds?.includes(iface)) return "egress";
  return "idle";
}

export function swfInterfacesFor(device: SwfDevice, s: SwfState, stepId: string): DeviceInterfaceData[] {
  if (isSwitch(device)) {
    return SWF_PORTS[device].map((p) => {
      const fwd = portForwarding(s, device, p.port);
      const macs = s.fdb[device].filter((e) => e.port === p.port).map((e) => macName(e.mac));
      return {
        id: p.port,
        name: p.port,
        status: fwd ? ("up" as const) : ("down" as const),
        neighborId: p.peer,
        neighborLabel: `${p.peer} ${p.peerPort}`,
        linkType: p.kind === "access" ? "Access (host)" : p.kind === "primary" ? "Inter-switch (primary)" : "Inter-switch (secondary)",
        role: roleAt(s, device, stepId, p.port),
        extra: [
          { label: "State", value: fwd ? "forwarding" : "disabled" },
          { label: "FDB entries on this port", value: macs.length ? macs.join(", ") : "none" },
        ],
      };
    });
  }
  const host = device as SwfHost;
  const at = HOST_ATTACH[host];
  return [{ id: "eth0", name: "eth0", status: "up", neighborId: at.sw, neighborLabel: `${at.sw} ${at.port}`, linkType: "Access", role: roleAt(s, device, stepId, "eth0"), extra: [{ label: "MAC", value: SWF_MAC[host] }] }];
}
