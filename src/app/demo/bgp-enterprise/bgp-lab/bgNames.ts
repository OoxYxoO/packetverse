import type { CliVendor } from "@/lib/cli/types";
import { LINK_ENDS, type BgLink, type BgRouter } from "@/lib/sim-engine/scenarios/bgpNet";

/**
 * Interface names in each OS view. Each router's links are numbered in a fixed order: Cisco GigabitEthernet0/N ↔ Junos
 * ge-0/0/N; the LAN is Gi0/0 / ge-0/0/0.
 */
const IF_ORDER: Record<BgRouter, BgLink[]> = { R1: ["L13", "L12"], R2: ["L24", "L12"], R3: ["L13", "L35"], R4: ["L24", "L45"], R5: ["L35", "L45"] };
export function ifOf(r: BgRouter, link: BgLink | "lan", vendor: CliVendor, long = false): string {
  const n = link === "lan" ? 0 : IF_ORDER[r].indexOf(link) + 1;
  return vendor === "cisco" ? `${long ? "GigabitEthernet" : "Gi"}0/${n}` : `ge-0/0/${n}`;
}
/** Which link a router address belongs to. */
export const linkOfAddr = (addr: string): BgLink | undefined => (Object.keys(LINK_ENDS) as BgLink[]).find((l) => LINK_ENDS[l][1] === addr || LINK_ENDS[l][3] === addr);
export const ifOfAddr = (r: BgRouter, addr: string | undefined, vendor: CliVendor, long = false) => {
  if (!addr) return "";
  const l = linkOfAddr(addr);
  return l ? ifOf(r, l, vendor, long) : ifOf(r, "lan", vendor, long);
};
