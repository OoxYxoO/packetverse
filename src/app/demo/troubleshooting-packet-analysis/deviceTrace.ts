import type { DeviceInterfaceData, DeviceProcessingTrace, InterfaceRole } from "@/components/network3d/types";
import { traceFromHops } from "@/components/lesson/fundamentalsTrace";
import { PA_IFACES, STAGES, ifKey, type PaDevice, type PaState } from "@/lib/sim-engine/scenarios/troubleshootingPacketAnalysis";

export function paTraceFor(device: PaDevice, s: PaState, stepId: string): DeviceProcessingTrace {
  return traceFromHops(device, s.hops, stepId, STAGES[device]);
}

function roleAt(s: PaState, device: PaDevice, stepId: string, iface: string): InterfaceRole {
  const hop = [...s.hops].reverse().find((h) => h.device === device && h.stepId === stepId);
  if (!hop) return "idle";
  if (hop.ingressInterfaceId === iface) return "ingress";
  if (hop.egressInterfaceId === iface) return "egress";
  return "idle";
}

/** Interfaces with the counters of the SHOWN state (never the live one). */
export function paInterfacesFor(device: PaDevice, s: PaState, stepId: string): DeviceInterfaceData[] {
  return PA_IFACES.filter((i) => i.device === device).map((i) => {
    const c = s.counters[ifKey(device, i.name)];
    return {
      id: i.name,
      name: i.name,
      status: "up" as const,
      ip: i.addr,
      neighborId: i.peer,
      neighborLabel: i.peer,
      linkType: device === "SW1" ? `Access/uplink port (${i.name === "ge-0/0/1" ? "mirrored to the CLIENT-side capture" : "to R1"})` : "Ethernet",
      role: roleAt(s, device, stepId, i.name),
      extra: [
        ...(i.mac ? [{ label: "MAC", value: i.mac }] : []),
        { label: "Admin / oper", value: "up / up" },
        ...(device === "R1" || device === "CLIENT" || device === "SERVER"
          ? [
              { label: "Input packets (lesson flows)", value: String(c.inPkts) },
              { label: "Output packets (lesson flows)", value: String(c.outPkts) },
              { label: "Output drops", value: String(c.outDrops) },
            ]
          : [{ label: "Forwarding", value: "by destination MAC; frames unchanged" }]),
      ],
    };
  });
}
