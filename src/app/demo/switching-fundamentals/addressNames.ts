import { BROADCAST_MAC, SWF_MAC } from "@/lib/sim-engine/scenarios/switchingFundamentals";

const TABLE = new Map<string, string>([...Object.entries(SWF_MAC).map(([k, v]) => [v, k] as [string, string]), [BROADCAST_MAC, "broadcast"]]);

/** Names for the lesson's MAC addresses — every key is a scenario export. */
export const swfNames = (v: string): string | undefined => TABLE.get(v);
