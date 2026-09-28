import { IC_ADDR, IC_MAC } from "@/lib/sim-engine/scenarios/icmpDiagnostics";

const label = (k: string) => k.replace(":", " ");
const TABLE = new Map<string, string>([...Object.entries(IC_ADDR), ...Object.entries(IC_MAC)].map(([k, v]) => [v, label(k)]));

/** Names for the lesson's addresses — every key is a scenario export. */
export const icNames = (v: string): string | undefined => TABLE.get(v);
