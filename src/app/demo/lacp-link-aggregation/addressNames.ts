import { HOST_IP, HOST_MAC, LACP_DST } from "@/lib/sim-engine/scenarios/lacpLinkAggregation";

const TABLE = new Map<string, string>([...Object.entries(HOST_MAC), ...Object.entries(HOST_IP)].map(([k, v]) => [v, k] as [string, string]).concat([[LACP_DST, "Slow Protocols"]]));

/** Names for the lesson's addresses — every key is a scenario export. */
export const lacpNames = (v: string): string | undefined => TABLE.get(v);
