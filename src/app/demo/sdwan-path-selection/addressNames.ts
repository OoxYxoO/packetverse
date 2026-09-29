import { SD, SD_MAC } from "@/lib/sim-engine/scenarios/sdwanPathSelection";

const TABLE = new Map<string, string>([
  [SD.client, "CLIENT"],
  [SD.app, "APP"],
  [SD.branchLo, "BRANCH-EDGE lo0"],
  [SD.hubLo, "HUB-EDGE lo0"],
  [SD.branchLan, "BRANCH-EDGE lan"],
  ...Object.entries(SD_MAC).map(([k, v]) => [v, k] as [string, string]),
]);

/** Names for the lesson's addresses — every key is a scenario export. */
export const sdNames = (v: string): string | undefined => TABLE.get(v);
