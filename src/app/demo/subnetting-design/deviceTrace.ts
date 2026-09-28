import type { DeviceInterfaceData, DeviceProcessingTrace, InterfaceRole } from "@/components/network3d/types";
import { traceFromHops } from "@/components/lesson/fundamentalsTrace";
import { HOST_RX_STAGES, HOST_SEG, R1_IFACE, ROUTER_STAGES, SD_ADDR, SD_MAC, describe, type SdDevice, type SdState, type SegId } from "@/lib/sim-engine/scenarios/subnettingDesign";

export function sdTraceFor(device: SdDevice, s: SdState, stepId: string): DeviceProcessingTrace {
  return traceFromHops(device, s.hops, stepId, device === "R1" || device === "R2" ? ROUTER_STAGES : HOST_RX_STAGES);
}

function roleAt(s: SdState, device: SdDevice, stepId: string, iface: string): InterfaceRole {
  const hop = [...s.hops].reverse().find((h) => h.device === device && h.stepId === stepId);
  if (!hop) return "idle";
  if (hop.ingressInterfaceId === iface) return "ingress";
  if (hop.egressInterfaceId === iface) return "egress";
  return "idle";
}

const PEER: Record<SegId, SdDevice> = { "LAN-A": "HOST-A", "LAN-B": "HOST-B", "LAN-C": "HOST-C", TRANSIT: "R2" };

export function sdInterfacesFor(device: SdDevice, s: SdState, stepId: string): DeviceInterfaceData[] {
  if (device === "R1") {
    return (Object.keys(R1_IFACE) as SegId[]).map((seg) => {
      const d = s.deployed[seg];
      const addr = SD_ADDR[`R1:${seg}` as keyof typeof SD_ADDR];
      return {
        id: R1_IFACE[seg],
        name: R1_IFACE[seg],
        status: d ? ("up" as const) : ("down" as const),
        ip: d ? `${addr}/${d.prefix}` : undefined,
        neighborId: PEER[seg],
        neighborLabel: `${PEER[seg]} (${seg})`,
        linkType: "Ethernet",
        role: roleAt(s, "R1", stepId, R1_IFACE[seg]),
        extra: d ? [{ label: "Connected", value: `${d.network}/${d.prefix}` }, { label: "Usable", value: `${describe(d.network, d.prefix).firstHost} – ${describe(d.network, d.prefix).lastHost}` }, { label: "MAC", value: SD_MAC[`R1:${seg}` as keyof typeof SD_MAC] }] : [{ label: "State", value: "not configured yet" }],
      };
    });
  }
  if (device === "R2") {
    const d = s.deployed.TRANSIT;
    return [{ id: "ge-0/0/0", name: "ge-0/0/0", status: d ? "up" : "down", ip: d ? `${SD_ADDR["R2:TRANSIT"]}/${d.prefix}` : undefined, neighborId: "R1", neighborLabel: "R1 (transit)", linkType: "Ethernet", role: roleAt(s, "R2", stepId, "ge-0/0/0"), extra: d ? [{ label: "Connected", value: `${d.network}/${d.prefix}` }] : [{ label: "State", value: "not configured yet" }] }];
  }
  const seg = HOST_SEG[device];
  const d = s.deployed[seg];
  return [{ id: "eth0", name: "eth0", status: "up", ip: d ? `${SD_ADDR[device]}/${d.prefix}` : undefined, neighborId: "R1", neighborLabel: `R1 ${R1_IFACE[seg]}`, linkType: "Ethernet", role: roleAt(s, device, stepId, "eth0"), extra: d ? [{ label: "Network", value: `${d.network}/${d.prefix}` }, { label: "Gateway", value: SD_ADDR[`R1:${seg}` as keyof typeof SD_ADDR] }] : [{ label: "State", value: "awaiting the address plan" }] }];
}
