import type { NodeExplanation } from "@/components/network3d/types";
import { IKE_PROPOSAL, IKE_SPI_I, ESP_PROPOSAL, VPN, spiText, type VpnDevice, type VpnState } from "@/lib/sim-engine/scenarios/ipsecVpn";

type Table = { title: string; rows: { label: string; value: string }[] };

/** Per-gateway SA view: what THIS gateway sends with (outbound) and recognises (inbound). */
export function gwSaRows(s: VpnState, gw: "GW-A" | "GW-B") {
  const a = gw === "GW-A";
  const c = s.child;
  const installed = !!c && s.childStatus === "INSTALLED";
  return {
    ike: [
      { label: "Peer", value: a ? VPN.gwbPub : VPN.gwaPub },
      { label: "IKE SA state", value: s.ike.phase },
      { label: "Initiator SPI", value: s.ike.phase === "NONE" ? "—" : IKE_SPI_I },
      { label: "Responder SPI", value: s.ike.spiR ?? "not yet known" },
      { label: "Peer authenticated", value: s.ike.peersAuthenticated ? "yes (AUTH verified)" : "no" },
      { label: "Latest exchange", value: s.ike.lastExchange ? `${s.ike.lastExchange} · MsgID ${s.ike.lastMsgId}` : "none" },
      { label: "IKE algorithms", value: s.ike.phase === "NONE" || s.ike.phase === "IKE_SA_INIT sent" ? "not negotiated" : IKE_PROPOSAL },
    ],
    child: [
      { label: "CHILD SA", value: s.childStatus },
      { label: "Local selector", value: a ? VPN.siteA : VPN.siteB },
      { label: "Remote selector", value: a ? VPN.siteB : s.gwbRemote },
      ...(installed
        ? [
            { label: "Negotiated TSi / TSr", value: `${c!.tsi} / ${c!.tsr}` },
            { label: "Outbound SPI", value: spiText(a ? c!.ab : c!.ba) },
            { label: "Inbound SPI", value: spiText(a ? c!.ba : c!.ab) },
            { label: "Next outbound ESP seq", value: String(a ? c!.seqAB : c!.seqBA) },
            { label: "Highest inbound seq accepted", value: String(a ? c!.rxBA : c!.rxAB) },
            { label: "Transform", value: ESP_PROPOSAL },
          ]
        : []),
      ...(s.lastNotify ? [{ label: "Last notify", value: s.lastNotify }] : []),
    ],
  };
}

export function vpnTables(device: VpnDevice, s: VpnState): Table[] {
  if (device === "GW-A" || device === "GW-B") {
    const r = gwSaRows(s, device);
    return [
      { title: "IKE SA", rows: r.ike },
      { title: "CHILD SA", rows: r.child },
      { title: "Interfaces", rows: [{ label: "Inside", value: device === "GW-A" ? `${VPN.gwaLan}/24` : `${VPN.gwbLan}/24` }, { label: "Outside", value: device === "GW-A" ? VPN.gwaPub : VPN.gwbPub }] },
    ];
  }
  if (device === "INTERNET") return [{ title: "Sees", rows: [{ label: "Readable", value: "outer IPv4 · UDP/500 IKE header · ESP SPI + sequence" }, { label: "Not readable", value: "SK payload contents · inner packets (ciphertext)" }] }];
  const a = device === "HOST-A";
  return [{ title: "Host", rows: [{ label: "IPv4", value: a ? `${VPN.hostA}/24` : `${VPN.hostB}/24` }, { label: "Gateway", value: a ? VPN.gwaLan : VPN.gwbLan }, { label: "Talks to", value: a ? VPN.hostB : VPN.hostA }, ...(a ? [{ label: "Pings sent / replies", value: `${s.hostA.sent} / ${s.hostA.replies}` }, { label: "Last result", value: s.hostA.lastResult }] : [])] }];
}

const TYPE: Record<VpnDevice, string> = { "HOST-A": "Host (Site A)", "GW-A": "IPsec gateway (IKEv2 initiator)", INTERNET: "Public Internet (transit routers)", "GW-B": "IPsec gateway (IKEv2 responder)", "HOST-B": "Host (Site B)" };

export function explainVpn(s: VpnState, id: string, stepId: string): NodeExplanation {
  const device = id as VpnDevice;
  const hop = [...s.hops].reverse().find((h) => h.device === device && h.stepId === stepId);
  const gw = device === "GW-A" || device === "GW-B";
  return {
    id,
    name: device,
    deviceType: TYPE[device],
    role: gw ? `IKE SA ${s.ike.phase} · CHILD SA ${s.childStatus}` : device === "INTERNET" ? "Routes on outer headers only" : device === "HOST-A" ? `${VPN.hostA} · unaware of IPsec` : `${VPN.hostB} · unaware of IPsec`,
    currentAction: hop ? `${hop.action}: ${hop.reason}` : "Idle this step.",
    controlPlaneRole: gw ? "IKEv2 (UDP/500): negotiate, authenticate, create/delete CHILD SAs." : undefined,
    dataPlaneRole: gw ? "ESP (protocol 50): encrypt/decrypt host traffic that matches the CHILD SA's selectors." : hop ? `In: ${hop.input}. Result: ${hop.output}.` : "Ordinary IPv4.",
    packetBefore: hop?.input,
    packetAfter: hop?.output,
    tables: vpnTables(device, s),
  };
}
