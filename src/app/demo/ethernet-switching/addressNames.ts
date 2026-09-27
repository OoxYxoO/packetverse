import { ETH_MAC, type EthHost } from "@/lib/sim-engine/scenarios/ethernetSwitching";

const TABLE = new Map<string, string>((Object.keys(ETH_MAC) as EthHost[]).map((h) => [ETH_MAC[h], h]));

/** Host names for the lesson's MAC addresses — every key is a scenario export. */
export const ethNames = (v: string): string | undefined => TABLE.get(v);
