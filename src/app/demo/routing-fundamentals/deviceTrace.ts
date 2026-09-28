import type { DeviceInterfaceData, DeviceProcessingTrace, InterfaceRole } from "@/components/network3d/types";
import { traceFromHops } from "@/components/lesson/fundamentalsTrace";
import { HOST_PREFIX, HOST_RX_STAGES, ROUTER_STAGES, RT_IFACES, routeKey, type RtDevice, type RtHost, type RtState } from "@/lib/sim-engine/scenarios/routingFundamentals";

const isRouter = (d: RtDevice): d is "R1" | "R2" => d === "R1" || d === "R2";

export function rtTraceFor(device: RtDevice, s: RtState, stepId: string): DeviceProcessingTrace {
  return traceFromHops(device, s.hops, stepId, isRouter(device) ? ROUTER_STAGES : HOST_RX_STAGES);
}

function roleAt(s: RtState, device: RtDevice, stepId: string, iface: string): InterfaceRole {
  const hop = [...s.hops].reverse().find((h) => h.device === device && h.stepId === stepId);
  if (!hop) return "idle";
  if (hop.ingressInterfaceId === iface) return "ingress";
  if (hop.egressInterfaceId === iface) return "egress";
  return "idle";
}

const PEER: Record<"R1" | "R2", Record<string, { id: string; label: string }>> = {
  R1: { "ge-0/0/0": { id: "HOST-A", label: "HOST-A eth0" }, "ge-0/0/1": { id: "R2", label: "R2 ge-0/0/1" } },
  R2: { "ge-0/0/1": { id: "R1", label: "R1 ge-0/0/1" }, "ge-0/0/0": { id: "SERVER-A", label: "SERVER-A + SERVER-B (server LAN)" } },
};

export function rtInterfacesFor(device: RtDevice, s: RtState, stepId: string): DeviceInterfaceData[] {
  if (isRouter(device)) {
    return RT_IFACES[device].map((i) => {
      const connected = s.rib[device].find((r) => r.source === "connected" && r.iface === i.name);
      return {
        id: i.name,
        name: i.name,
        status: "up" as const,
        ip: `${i.addr}/${i.len}`,
        neighborId: PEER[device][i.name].id,
        neighborLabel: PEER[device][i.name].label,
        linkType: i.link,
        mtu: 1500,
        role: roleAt(s, device, stepId, i.name),
        extra: [
          { label: "MAC", value: i.mac },
          { label: "Connected route", value: connected ? routeKey(connected) : "none" },
        ],
      };
    });
  }
  const h = HOST_PREFIX[device as RtHost];
  return [{ id: "eth0", name: "eth0", status: "up", ip: `${h.ip}/${h.len}`, neighborId: h.gwDev, neighborLabel: `${h.gwDev} (gateway ${h.gw})`, linkType: "LAN", mtu: 1500, role: roleAt(s, device, stepId, "eth0"), extra: [{ label: "MAC", value: h.mac }, { label: "Default gateway", value: h.gw }] }];
}
