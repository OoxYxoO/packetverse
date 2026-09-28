import { BPDU_DST, BROADCAST_MAC, HOST_MAC } from "@/lib/sim-engine/scenarios/stpRstp";

const TABLE = new Map<string, string>([...Object.entries(HOST_MAC).map(([k, v]) => [v, k] as [string, string]), [BROADCAST_MAC, "broadcast"], [BPDU_DST, "bridge group (BPDU)"]]);

/** Names for the lesson's MAC addresses — every key is a scenario export. */
export const stpNames = (v: string): string | undefined => TABLE.get(v);
