import { SD_ADDR, SD_MAC } from "@/lib/sim-engine/scenarios/subnettingDesign";

const label = (k: string) => (k.startsWith("R1:") ? `R1 ${k.slice(3)}` : k.startsWith("R2:") ? "R2" : k);
const TABLE = new Map<string, string>([...Object.entries(SD_ADDR), ...Object.entries(SD_MAC)].map(([k, v]) => [v, label(k)]));

/** Names for the lesson's addresses — every key is a scenario export. */
export const sdNames = (v: string): string | undefined => TABLE.get(v);
