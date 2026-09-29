import type { DeviceInterfaceData, DeviceProcessingTrace, InterfaceRole } from "@/components/network3d/types";
import { traceFromHops } from "@/components/lesson/fundamentalsTrace";
import { IFACES, ISIS_STAGES, LINK_METRIC, ROUTER, THREE_WAY_CODE, ifKey, type IsisRouter, type IsisState } from "@/lib/sim-engine/scenarios/isisFundamentals";

export function isisTraceFor(device: IsisRouter, s: IsisState, stepId: string): DeviceProcessingTrace {
  return traceFromHops(device, s.hops, stepId, ISIS_STAGES);
}

function roleAt(s: IsisState, device: IsisRouter, stepId: string, iface: string): InterfaceRole {
  const hop = [...s.hops].reverse().find((h) => h.device === device && h.stepId === stepId);
  if (!hop) return "idle";
  if (hop.ingressInterfaceId === iface) return "ingress";
  if (hop.egressInterfaceId === iface) return "egress";
  return "idle";
}

export function isisInterfacesFor(device: IsisRouter, s: IsisState, stepId: string): DeviceInterfaceData[] {
  const phys = IFACES.filter((i) => i.router === device).map((i) => {
    const a = s.adj[ifKey(device, i.name)];
    return {
      id: i.name,
      name: i.name,
      status: s.physUp[i.link] ? ("up" as const) : ("down" as const),
      ip: `${i.addr}/31`,
      neighborId: i.peer,
      neighborLabel: `${i.peer} ${i.peerIface}`,
      linkType: "Ethernet · IS-IS point-to-point circuit",
      role: roleAt(s, device, stepId, i.name),
      extra: [
        { label: "MAC", value: i.mac },
        { label: "Physical / Ethernet", value: s.physUp[i.link] ? "up" : "down" },
        { label: "Circuit level", value: s.circuit[ifKey(device, i.name)] === "L1" ? "Level-1 only" : "Level-2 only" },
        { label: "Wide metric", value: String(LINK_METRIC) },
        { label: "Local circuit ID", value: String(i.circuitId) },
        { label: "Adjacency", value: `${a.state}${a.neighbor ? ` · ${a.neighbor}` : ""}${a.level !== "none" ? ` · ${a.level}` : ""}` },
        { label: "Three-way state", value: `${a.state === "UP" ? "Up" : a.state === "INITIALIZING" ? "Initializing" : "Down"} (${THREE_WAY_CODE[a.state]})` },
        { label: "Holding timer", value: a.hold ? `${a.hold} s` : "—" },
      ],
    };
  });
  return [...phys, { id: "lo0", name: "lo0", status: "up", ip: `${ROUTER[device].loopback}/32`, linkType: "Loopback (passive, advertised in TLV 135)", role: "idle" }];
}
