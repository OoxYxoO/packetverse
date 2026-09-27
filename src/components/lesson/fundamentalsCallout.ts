import type { PacketLayer, PacketVisual } from "@/lib/sim-engine/types";
import type { PacketCallout3D } from "@/components/network3d/types";
import { PROTOCOL_HEX } from "./packetCallout";

/**
 * 2D bubble / 3D callout text for the Fundamentals lessons (Ethernet & Switching, IPv4, VLANs). The packet part is
 * read ONLY from the PacketVisual's own wire layers — Ethernet II, an 802.1Q tag when (and only when) the frame
 * carries one, IPv4, ARP. A device's decision (flood, known unicast, next hop, drop) is passed in separately from the
 * lesson state and appended after the wire description, so it is never presented as a header field.
 */
export type FundName = (value: string) => string | undefined;

const layer = (p: PacketVisual, re: RegExp): PacketLayer | undefined => p.layers.find((l) => re.test(l.name));
const field = (l: PacketLayer | undefined, re: RegExp) => l?.fields.find((f) => re.test(f.label))?.value;
const nm = (name: FundName, v: string | undefined) => (v ? (name(v) ?? v) : "?");

export function fundamentalsCallout(p: PacketVisual, name: FundName, opts: { decision?: string; markUntagged?: boolean } = {}): PacketCallout3D {
  const color = PROTOCOL_HEX[p.protocol];
  const eth = layer(p, /^Ethernet/);
  const tag = layer(p, /^802\.1Q/);
  const ip = layer(p, /^IPv4/);
  const arp = layer(p, /^ARP/);
  const dst = field(eth, /^Destination MAC$/);
  const src = field(eth, /^Source MAC$/);
  const vid = field(tag, /^VID/);
  const tagText = tag ? `802.1Q VID ${vid ?? "?"}` : opts.markUntagged ? "untagged" : undefined;
  const bcast = dst?.toUpperCase() === "FF:FF:FF:FF:FF:FF";
  const l2 = `L2 ${nm(name, src)} → ${bcast ? "broadcast" : nm(name, dst)}`;
  const tail = (parts: (string | undefined)[]) => parts.filter(Boolean).join(" · ");

  if (ip) {
    const s = field(ip, /^Source/);
    const d = field(ip, /^Destination/);
    const ttl = field(ip, /^TTL/);
    return { title: tail([`IPv4 ${nm(name, s)} → ${nm(name, d)}`, ttl ? `TTL ${ttl}` : undefined]), detail: tail([l2, tagText, opts.decision]), color };
  }
  if (arp) {
    const op = field(arp, /^Operation/) ?? "";
    const target = field(arp, /^Target IP/);
    const sender = field(arp, /^Sender IP/);
    const title = /request/i.test(op) ? `ARP request · who has ${target ?? "?"}? tell ${sender ?? "?"}` : `ARP reply · ${sender ?? "?"} is at ${field(arp, /^Sender MAC/) ?? "?"}`;
    return { title, detail: tail([l2, tagText, opts.decision]), color };
  }
  const kind = bcast ? "Ethernet broadcast" : "Ethernet frame";
  return { title: tail([tagText && tag ? tagText : undefined, `${kind} ${nm(name, src)} → ${bcast ? "all" : nm(name, dst)}`]), detail: tail([`dst ${dst ?? "?"}`, `src ${src ?? "?"}`, !tag && opts.markUntagged ? "untagged" : undefined, opts.decision]), color };
}
