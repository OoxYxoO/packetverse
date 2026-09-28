import { DH_ADDR, DH_MAC } from "@/lib/sim-engine/scenarios/dhcpDns";

const label = (k: string) => (k === "WRONG_DNS" ? "no host" : k === "WEB" ? "web server" : k.replace(":", " "));
const TABLE = new Map<string, string>([...Object.entries(DH_ADDR), ...Object.entries(DH_MAC)].map(([k, v]) => [v, label(k)]));
TABLE.set("0.0.0.0", "unconfigured");
TABLE.set("255.255.255.255", "broadcast");

/** Names for the lesson's addresses — every key is a scenario export. */
export const dhNames = (v: string): string | undefined => TABLE.get(v);
