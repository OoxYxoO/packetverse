import type { DeviceInterfaceData, DeviceProcessingTrace, InterfaceRole } from "@/components/network3d/types";
import { traceFromHops } from "@/components/lesson/fundamentalsTrace";
import { SD, SD_MAC, TUNNELS, metricText, stagesFor, tunStatus, type SdDevice, type SdState, type TunId } from "@/lib/sim-engine/scenarios/sdwanPathSelection";

export function sdTraceFor(device: SdDevice, s: SdState, stepId: string): DeviceProcessingTrace {
  return traceFromHops(device, s.hops, stepId, stagesFor(device));
}

function roleAt(s: SdState, device: SdDevice, stepId: string, iface: string): InterfaceRole {
  const hop = [...s.hops].reverse().find((h) => h.device === device && h.stepId === stepId);
  if (!hop) return "idle";
  if (hop.ingressInterfaceId === iface) return "ingress";
  if (hop.egressInterfaceId === iface) return "egress";
  return "idle";
}

const tunExtra = (s: SdState, t: TunId) => [
  { label: "Overlay path", value: `${t} (encapsulation vendor-specific, not drawn)` },
  { label: "Underlay circuit", value: `${TUNNELS[t].isp} ${s.tun[t].underlay}` },
  { label: "Overlay", value: s.tun[t].overlay },
  { label: "Probe target", value: s.tun[t].target },
  { label: "Latest interval", value: metricText(s.tun[t].last) },
  { label: "Voice SLA", value: s.tun[t].sla },
  { label: "Eligibility", value: tunStatus(s.tun[t]) },
];

export function sdInterfacesFor(device: SdDevice, s: SdState, stepId: string): DeviceInterfaceData[] {
  const r = (i: string) => roleAt(s, device, stepId, i);
  if (device === "BRANCH-EDGE") {
    return [
      { id: "lan", name: "lan", status: "up", ip: `${SD.branchLan}/24`, neighborId: "CLIENT", neighborLabel: "CLIENT", linkType: "Branch LAN", role: r("lan"), extra: [{ label: "MAC", value: SD_MAC["BR:lan"] }] },
      { id: "wan-a", name: "wan-a", status: "up", ip: TUNNELS["TUN-A"].branchWan, neighborId: "ISP-A", neighborLabel: `ISP-A ${TUNNELS["TUN-A"].ispAddr}`, linkType: "Underlay ISP-A", role: r("wan-a"), extra: [{ label: "MAC", value: SD_MAC["BR:wan-a"] }, ...tunExtra(s, "TUN-A")] },
      { id: "wan-b", name: "wan-b", status: "up", ip: TUNNELS["TUN-B"].branchWan, neighborId: "ISP-B", neighborLabel: `ISP-B ${TUNNELS["TUN-B"].ispAddr}`, linkType: "Underlay ISP-B", role: r("wan-b"), extra: [{ label: "MAC", value: SD_MAC["BR:wan-b"] }, ...tunExtra(s, "TUN-B")] },
      { id: "lo0", name: "lo0", status: "up", ip: `${SD.branchLo}/32`, linkType: "Loopback (probe source)", role: "idle" },
    ];
  }
  if (device === "HUB-EDGE") {
    return [
      { id: "wan-a", name: "wan-a", status: "up", ip: TUNNELS["TUN-A"].hubWan, neighborId: "ISP-A", neighborLabel: "ISP-A", linkType: "TUN-A endpoint", role: r("wan-a"), extra: [{ label: "MAC", value: SD_MAC["HUB:wan-a"] }, { label: "Overlay", value: `TUN-A ${s.tun["TUN-A"].overlay}` }] },
      { id: "wan-b", name: "wan-b", status: "up", ip: TUNNELS["TUN-B"].hubWan, neighborId: "ISP-B", neighborLabel: "ISP-B", linkType: "TUN-B endpoint", role: r("wan-b"), extra: [{ label: "MAC", value: SD_MAC["HUB:wan-b"] }, { label: "Overlay", value: `TUN-B ${s.tun["TUN-B"].overlay}` }] },
      { id: "lan", name: "lan", status: "up", ip: `${SD.hubLan}/24`, neighborId: "APP", neighborLabel: "APP", linkType: "Hub LAN", role: r("lan"), extra: [{ label: "MAC", value: SD_MAC["HUB:lan"] }] },
      { id: "lo0", name: "lo0", status: "up", ip: `${SD.hubLo}/32`, linkType: "Monitoring loopback (answers probes)", role: "idle" },
    ];
  }
  if (device === "ISP-A" || device === "ISP-B") {
    const t: TunId = device === "ISP-A" ? "TUN-A" : "TUN-B";
    return [
      { id: "branch", name: "branch", status: "up", ip: `${TUNNELS[t].ispAddr}/30`, neighborId: "BRANCH-EDGE", neighborLabel: "BRANCH-EDGE", linkType: "Customer circuit", role: r("branch"), extra: [{ label: "MAC", value: SD_MAC[device] }, { label: "Carries", value: `${t} (encapsulated)` }] },
      { id: "hub", name: "hub", status: "up", neighborId: "HUB-EDGE", neighborLabel: `HUB-EDGE ${TUNNELS[t].hubWan}`, linkType: "Toward the hub", role: r("hub") },
    ];
  }
  if (device === "CLIENT") return [{ id: "eth0", name: "eth0", status: "up", ip: `${SD.client}/24`, neighborId: "BRANCH-EDGE", neighborLabel: "BRANCH-EDGE lan", linkType: "Access", role: r("eth0"), extra: [{ label: "MAC", value: SD_MAC.CLIENT }, { label: "Gateway", value: SD.branchLan }] }];
  return [{ id: "eth0", name: "eth0", status: "up", ip: `${SD.app}/24`, neighborId: "HUB-EDGE", neighborLabel: "HUB-EDGE lan", linkType: "Access", role: r("eth0"), extra: [{ label: "MAC", value: SD_MAC.APP }, { label: "Services", value: "UDP 16400 (voice) · TCP 873 (backup)" }] }];
}
