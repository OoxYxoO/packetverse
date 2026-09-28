import { VPN, VPN_MAC } from "@/lib/sim-engine/scenarios/ipsecVpn";

const TABLE = new Map<string, string>([
  [VPN.hostA, "HOST-A"],
  [VPN.hostB, "HOST-B"],
  [VPN.gwaPub, "GW-A"],
  [VPN.gwbPub, "GW-B"],
  [VPN.gwaLan, "GW-A lan"],
  [VPN.gwbLan, "GW-B lan"],
  ...Object.entries(VPN_MAC).map(([k, v]) => [v, k] as [string, string]),
]);

/** Names for the lesson's addresses — every key is a scenario export. */
export const vpnNames = (v: string): string | undefined => TABLE.get(v);
