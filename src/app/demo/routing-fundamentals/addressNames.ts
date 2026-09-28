import { OUTSIDE_DST, RT_ADDR, RT_MAC } from "@/lib/sim-engine/scenarios/routingFundamentals";

const label = (k: string) => k.replace(":", " ");
const TABLE = new Map<string, string>([...Object.entries(RT_ADDR), ...Object.entries(RT_MAC)].map(([k, v]) => [v, label(k)] as [string, string]));

/** Names for the lesson's addresses — every key is a scenario export. The outside destination keeps its address. */
export const rtNames = (v: string): string | undefined => (v === OUTSIDE_DST ? undefined : TABLE.get(v));
