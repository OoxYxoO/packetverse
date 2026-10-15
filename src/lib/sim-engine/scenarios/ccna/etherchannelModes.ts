/**
 * EtherChannel negotiation by mode pair (CCNA 2.4): LACP (IEEE 802.3ad/802.1AX: active, passive), Cisco PAgP
 * (desirable, auto) and static "on". A bundle forms only when the two ends can agree:
 * - on ↔ on: no protocol, bundles unconditionally (and dangerously — no checks).
 * - LACP: at least one side active. PAgP: at least one side desirable.
 * - Mixing protocols, or "on" with a negotiating side, never bundles (with "on" against a negotiating side, the
 *   members fall back to individual links or are suspended).
 */
export type ChannelMode = "on" | "active" | "passive" | "desirable" | "auto";
export const MODES: ChannelMode[] = ["on", "active", "passive", "desirable", "auto"];
const proto = (m: ChannelMode) => (m === "on" ? "static" : m === "active" || m === "passive" ? "LACP" : "PAgP");
const initiates = (m: ChannelMode) => m === "active" || m === "desirable";

export function bundleResult(a: ChannelMode, b: ChannelMode): { bundles: boolean; why: string } {
  if (a === "on" && b === "on") return { bundles: true, why: "static — no negotiation" };
  if (proto(a) !== proto(b)) return { bundles: false, why: a === "on" || b === "on" ? "one side static, one negotiating" : "LACP and PAgP don't talk to each other" };
  if (!initiates(a) && !initiates(b)) return { bundles: false, why: "both sides wait — nobody starts" };
  return { bundles: true, why: `${proto(a)} negotiates` };
}
