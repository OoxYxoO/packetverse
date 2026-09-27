import type { PacketLayer, PacketVisual } from "@/lib/sim-engine/types";
import type { PacketCallout3D } from "@/components/network3d/types";
import { PROTOCOL_HEX } from "./packetCallout";

/**
 * Readable 2D bubbles / 3D callouts for the EVPN lessons. Every value is
 * read back from the PacketVisual the scenario built (live or historical)
 * — never recomputed. Control-plane fields (route type, RD, RT, next hop,
 * mobility community, Label2, Router's MAC) are only ever described when
 * the packet IS a BGP UPDATE; a tenant data packet is described strictly
 * from its own wire layers (Ethernet / IP / ARP / VXLAN / outer IP).
 * Each lesson supplies `name(address)` built from its scenario exports.
 */
export type EvpnName = (value: string) => string | undefined;

/** Builds a case-insensitive lookup from address → role name (MACs are compared in upper case). */
export function evpnNameTable(entries: [string, string][]): EvpnName {
  const table = new Map(entries.map(([k, v]) => [k.toUpperCase(), v]));
  return (value) => table.get(value.toUpperCase());
}

const layer = (p: PacketVisual, re: RegExp) => p.layers.find((l) => re.test(l.name));
const field = (l: PacketLayer | undefined, re: RegExp) => l?.fields.find((f) => re.test(f.label))?.value;
const nm = (name: EvpnName, v: string | undefined) => (v ? (name(v) ?? v) : "?");

function bgpCallout(p: PacketVisual, bgp: PacketLayer, name: EvpnName): PacketCallout3D {
  const color = PROTOCOL_HEX[p.protocol];
  const type = (field(bgp, /^Route Type/) ?? "?").split(" ")[0];
  const nh = field(bgp, /^Next Hop|^Originating Router/);
  const rdRt = `RD ${field(bgp, /^RD$/) ?? "—"} · RT ${field(bgp, /^Route Target/) ?? "—"}`;
  if (type === "3") {
    return { title: `BGP EVPN UPDATE · Type 3 (IMET) · ${nm(name, nh)} joins VNI ${field(bgp, /^VNI/) ?? "?"}`, detail: `membership only — no MAC/IP · ${rdRt}`, color };
  }
  if (type === "5") {
    return { title: `BGP EVPN UPDATE · Type 5 · ${field(bgp, /^IP Prefix/) ?? "?"} via ${nm(name, nh)}`, detail: `L3 VNI ${field(bgp, /^L3 VNI/) ?? "?"} · ${rdRt} · GW IP ${field(bgp, /^GW IP/) ?? "—"}`, color };
  }
  const extras: string[] = [];
  const ecAbsent = field(bgp, /^MAC Mobility Extended Community$/);
  const ecSeq = field(bgp, /^MAC Mobility Extended Community — Sequence/);
  if (ecAbsent) extras.push(`MAC Mobility EC: ${ecAbsent.toLowerCase()} (effective seq ${field(bgp, /^Effective Mobility Sequence/) ?? "0"})`);
  if (ecSeq) extras.push(`MAC Mobility EC seq ${ecSeq}`);
  const label2 = field(bgp, /^Label2/);
  if (label2) extras.push(`Label2 / IP-VRF VNI ${label2}`);
  const rmac = field(bgp, /^EVPN Router's MAC/);
  if (rmac) extras.push(`Router's MAC EC ${rmac.split(" ")[0]}`);
  const vni = field(bgp, /^VNI/);
  return {
    title: `BGP EVPN UPDATE · Type 2 · ${nm(name, field(bgp, /^MAC Address/))} via ${nm(name, nh)}`,
    detail: [`${field(bgp, /^MAC Address/)} / ${field(bgp, /^IP Address/)}`, vni ? `VNI ${vni}` : undefined, ...extras, rdRt].filter(Boolean).join(" · "),
    color,
  };
}

export function evpnCallout(p: PacketVisual, name: EvpnName): PacketCallout3D {
  const color = PROTOCOL_HEX[p.protocol];
  const bgp = layer(p, /^BGP UPDATE/);
  if (bgp) return bgpCallout(p, bgp, name);

  const arp = layer(p, /^ARP /);
  if (arp) {
    const senderIp = field(arp, /^Sender IP/);
    const senderMac = field(arp, /^Sender MAC/);
    if (/Request/.test(arp.name)) {
      const target = field(arp, /^Target IP/);
      const targetName = target ? name(target) : undefined;
      return { title: `ARP Request · who has ${target ?? "?"}${targetName ? ` (${targetName})` : ""}?`, detail: `sender ${nm(name, senderIp)} (${senderMac}) · Ethernet broadcast`, color };
    }
    const proxy = /Proxy/.test(arp.name);
    return { title: `${proxy ? "Proxy ARP Reply" : "ARP Reply"} · ${senderIp} is at ${senderMac}`, detail: proxy ? `answered locally by the VTEP from its binding · to ${nm(name, field(arp, /^Target MAC/))}` : `from ${nm(name, senderIp)} · to ${nm(name, field(arp, /^Target MAC/))}`, color };
  }

  const vx = layer(p, /^VXLAN Header/);
  const outer = layer(p, /^Outer IP/);
  if (vx && outer) {
    const vni = field(vx, /^VNI/) ?? "?";
    const routedEth = layer(p, /^Inner Ethernet \(routed/);
    const inner = layer(p, /^Original Ethernet Frame/);
    const innerIp = layer(p, /^Inner IP/);
    const title = `VXLAN · VNI ${vni}${routedEth ? " (L3 VNI)" : ""} · ${nm(name, field(outer, /^Outer Src/))} → ${nm(name, field(outer, /^Outer Dst/))}`;
    const detail = routedEth
      ? `inner Ethernet ${nm(name, field(routedEth, /^Src MAC/))} → ${nm(name, field(routedEth, /^Dst MAC/))} · inner IP ${nm(name, field(innerIp, /^Src IP/))} → ${nm(name, field(innerIp, /^Dst IP/))}`
      : `inner frame ${nm(name, field(inner, /^Inner Src MAC/))} → ${nm(name, field(inner, /^Inner Dst MAC/))} · ${nm(name, field(inner, /^Inner Src IP/))} → ${nm(name, field(inner, /^Inner Dst IP/))} · UDP 4789`;
    return { title, detail, color };
  }
  if (vx) return { title: `VXLAN copy · VNI ${field(vx, /^VNI/) ?? "?"} · toward ${field(vx, /^Toward/) ?? "?"}`, detail: "one replica, one outer destination VTEP", color };

  const eth = layer(p, /^Ethernet$/);
  const ip = layer(p, /^IPv4$/);
  if (eth) {
    return {
      title: `Ethernet · ${nm(name, field(eth, /^Src MAC/))} → ${nm(name, field(eth, /^Dst MAC/))}`,
      detail: ip ? `IPv4 ${nm(name, field(ip, /^Src IP/))} → ${nm(name, field(ip, /^Dst IP/))}` : p.summary,
      color,
    };
  }
  return { title: p.summary, color };
}
