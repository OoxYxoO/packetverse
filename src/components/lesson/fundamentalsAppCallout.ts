import type { PacketVisual } from "@/lib/sim-engine/types";
import type { PacketCallout3D } from "@/components/network3d/types";
import { fundamentalsCallout, type FundName } from "./fundamentalsCallout";

/**
 * Callouts for Fundamentals packets that carry ICMP, DHCP or DNS (Batch 10). Additive: anything else is delegated
 * unchanged to `fundamentalsCallout`. Text is read only from the packet's own layers; a device's decision is
 * appended separately (from lesson state), never presented as a header field.
 */
const ICMP_HEX = "#f472b6";
const DHCP_HEX = "#f59e0b";
const DNS_HEX = "#a78bfa";

const layer = (p: PacketVisual, re: RegExp) => p.layers.find((l) => re.test(l.name));
const field = (p: PacketVisual, re: RegExp, label: string) => layer(p, re)?.fields.find((f) => f.label === label)?.value;
const nm = (name: FundName, v: string | undefined) => (v ? (name(v) ?? v) : "?");
const join = (parts: (string | undefined)[]) => parts.filter(Boolean).join(" · ");

export function fundamentalsAppCallout(p: PacketVisual, name: FundName, opts: { decision?: string } = {}): PacketCallout3D {
  const src = field(p, /^IPv4/, "Source");
  const dst = field(p, /^IPv4/, "Destination");
  const ttl = field(p, /^IPv4/, "TTL");
  const len = field(p, /^IPv4/, "Total Length");
  const ip = `${nm(name, src)} → ${nm(name, dst)}`;

  if (layer(p, /^ICMP/)) {
    const type = (field(p, /^ICMP/, "Type") ?? "").split(" ")[0];
    const code = (field(p, /^ICMP/, "Code") ?? "").split(" ")[0];
    const typeName = { "8": "Echo Request", "0": "Echo Reply", "11": "Time Exceeded", "3": "Dest. Unreachable" }[type] ?? `Type ${type}`;
    const seq = field(p, /^ICMP/, "Sequence Number");
    const mtu = field(p, /^ICMP/, "Next-Hop MTU");
    return {
      title: join([`ICMP ${typeName} ${type}/${code}`, seq ? `seq ${seq}` : undefined, `TTL ${ttl}`]),
      detail: join([ip, `len ${len}`, field(p, /^IPv4/, "Flags")?.startsWith("DF") ? "DF" : undefined, mtu ? `next-hop MTU ${mtu}` : undefined, opts.decision]),
      color: ICMP_HEX,
    };
  }
  const dhcp = layer(p, /^DHCP/);
  if (dhcp) {
    const t = dhcp.name.replace("DHCP (BOOTP) — ", "");
    const yi = field(p, /^DHCP/, "yiaddr");
    return {
      title: join([t, `xid ${field(p, /^DHCP/, "xid")}`]),
      detail: join([`${src} → ${dst}`, `UDP ${field(p, /^UDP/, "Source Port")}→${field(p, /^UDP/, "Destination Port")}`, yi && yi !== "0.0.0.0" ? `yiaddr ${yi}` : undefined, field(p, /^DHCP/, "giaddr") !== "0.0.0.0" ? `giaddr ${field(p, /^DHCP/, "giaddr")}` : undefined, opts.decision]),
      color: DHCP_HEX,
    };
  }
  const dns = layer(p, /^DNS/);
  if (dns) {
    const q = (field(p, /^DNS/, "Question") ?? "").split(" · ")[0];
    const ans = field(p, /^DNS/, "Answer");
    return {
      title: join([`${dns.name} ${field(p, /^DNS/, "Transaction ID")}`, `A ${q}`]),
      detail: join([`${ip} · UDP ${field(p, /^UDP/, "Source Port")}→${field(p, /^UDP/, "Destination Port")}`, ans ? `answer ${ans.split(" · ").pop()} (TTL ${ans.match(/TTL (\d+)/)?.[1]} s)` : undefined, opts.decision]),
      color: DNS_HEX,
    };
  }
  return fundamentalsCallout(p, name, opts);
}
