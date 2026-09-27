import { VLAN_MAC, type VlanHost } from "@/lib/sim-engine/scenarios/vlanFundamentals";

const TABLE = new Map<string, string>((Object.keys(VLAN_MAC) as VlanHost[]).map((h) => [VLAN_MAC[h], h]));

/** Host names for the lesson's MAC addresses — every key is a scenario export. */
export const vlanNames = (v: string): string | undefined => TABLE.get(v);
