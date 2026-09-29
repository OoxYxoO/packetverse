import type { DeviceInterfaceData, DeviceProcessingTrace, InterfaceRole } from "@/components/network3d/types";
import { traceFromHops } from "@/components/lesson/fundamentalsTrace";
import { GW_STAGES, HOST_STAGES, INET_STAGES, VPN, VPN_MAC, spiText, type VpnDevice, type VpnState } from "@/lib/sim-engine/scenarios/ipsecVpn";

export function vpnTraceFor(device: VpnDevice, s: VpnState, stepId: string): DeviceProcessingTrace {
  return traceFromHops(device, s.hops, stepId, device === "GW-A" || device === "GW-B" ? GW_STAGES : device === "INTERNET" ? INET_STAGES : HOST_STAGES);
}

function roleAt(s: VpnState, device: VpnDevice, stepId: string, iface: string): InterfaceRole {
  const hop = [...s.hops].reverse().find((h) => h.device === device && h.stepId === stepId);
  if (!hop) return "idle";
  if (hop.ingressInterfaceId === iface) return "ingress";
  if (hop.egressInterfaceId === iface) return "egress";
  return "idle";
}

export function vpnInterfacesFor(device: VpnDevice, s: VpnState, stepId: string): DeviceInterfaceData[] {
  const r = (i: string) => roleAt(s, device, stepId, i);
  if (device === "GW-A" || device === "GW-B") {
    const a = device === "GW-A";
    const c = s.child;
    const saRows = c && s.childStatus === "INSTALLED" ? [{ label: "Outbound ESP SPI", value: spiText(a ? c.ab : c.ba) }, { label: "Inbound ESP SPI", value: spiText(a ? c.ba : c.ab) }, { label: "Next outbound seq", value: String(a ? c.seqAB : c.seqBA) }] : [{ label: "CHILD SA", value: s.childStatus }];
    return [
      { id: "lan", name: "lan", status: "up", ip: a ? `${VPN.gwaLan}/24` : `${VPN.gwbLan}/24`, neighborId: a ? "HOST-A" : "HOST-B", neighborLabel: a ? "HOST-A" : "HOST-B", linkType: "Inside (protected site)", role: r("lan"), extra: [{ label: "MAC", value: a ? VPN_MAC["GW-A:lan"] : VPN_MAC["GW-B:lan"] }, { label: "Site", value: a ? VPN.siteA : VPN.siteB }] },
      { id: "wan", name: "wan", status: "up", ip: a ? VPN.gwaPub : VPN.gwbPub, neighborId: "INTERNET", neighborLabel: "Internet", linkType: "Outside (public)", role: r("wan"), extra: [{ label: "MAC", value: a ? VPN_MAC["GW-A:wan"] : VPN_MAC["GW-B:wan"] }, { label: "IKE peer", value: a ? VPN.gwbPub : VPN.gwaPub }, { label: "IKE SA", value: s.ike.phase }, ...saRows] },
    ];
  }
  if (device === "INTERNET") {
    return [
      { id: "to-GW-A", name: "to-GW-A", status: "up", neighborId: "GW-A", neighborLabel: `GW-A ${VPN.gwaPub}`, linkType: "Public", role: r("to-GW-A"), extra: [{ label: "MAC", value: VPN_MAC["INET:a"] }] },
      { id: "to-GW-B", name: "to-GW-B", status: "up", neighborId: "GW-B", neighborLabel: `GW-B ${VPN.gwbPub}`, linkType: "Public", role: r("to-GW-B"), extra: [{ label: "MAC", value: VPN_MAC["INET:b"] }] },
    ];
  }
  const a = device === "HOST-A";
  return [{ id: "eth0", name: "eth0", status: "up", ip: a ? `${VPN.hostA}/24` : `${VPN.hostB}/24`, neighborId: a ? "GW-A" : "GW-B", neighborLabel: a ? "GW-A lan" : "GW-B lan", linkType: "Access", role: r("eth0"), extra: [{ label: "MAC", value: a ? VPN_MAC["HOST-A"] : VPN_MAC["HOST-B"] }, { label: "Default gateway", value: a ? VPN.gwaLan : VPN.gwbLan }] }];
}
