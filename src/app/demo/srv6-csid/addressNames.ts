import { ipv6Hextets, type CsidHopFacts } from "@/components/lesson/srv6AdvancedCallout";
import { ALL_ROUTERS, LOCATOR_BLOCK_HEXTETS, NEXT_CSID_VALUE, ordinarySidText, readReplaceIndex, type Srv6CsidState } from "@/lib/sim-engine/scenarios/srv6Csid";
import { FUNCTION } from "@/lib/sim-engine/scenarios/srv6EndpointBehaviors";
import { isReplacePhase } from "./deviceTrace";

const ORDINARY = new Map<string, string>();
for (const r of ALL_ROUTERS) {
  ORDINARY.set(ordinarySidText(r).toLowerCase(), `${r} End (ordinary SID)`);
  ORDINARY.set(ordinarySidText(r, FUNCTION.END_DT4).toLowerCase(), `${r} End.DT4 (ordinary SID)`);
}
const ownerOf = (node: number) => ALL_ROUTERS.find((r) => NEXT_CSID_VALUE[r] === node) ?? `node 0x${node.toString(16)}`;

/**
 * Names the active segment in a CSID destination address. Exact ordinary
 * SIDs are matched first; otherwise the DA is decoded with the flavor the
 * current (or historical) step uses — REPLACE: Locator-Node + Function +
 * Index; NEXT: active CSID followed by the CSIDs still waiting to shift in.
 */
export function csidDescribeDa(stepId: string): (address: string) => string {
  const replace = isReplacePhase(stepId);
  return (address) => {
    const ordinary = ORDINARY.get(address.toLowerCase());
    if (ordinary) return ordinary;
    const h = ipv6Hextets(address);
    if (LOCATOR_BLOCK_HEXTETS.some((v, i) => h[i] !== v)) return "outside the shared Locator-Block";
    if (replace) return `${ownerOf(h[3])} ${h[4] === FUNCTION.END_DT4 ? "End.DT4" : "End"} · Index ${readReplaceIndex(h)}`;
    const waiting = h.slice(4).filter((v) => v !== 0).map(ownerOf);
    return waiting.length ? `active ${ownerOf(h[3])} · then ${waiting.join(" ")}` : `active ${ownerOf(h[3])} · last CSID in container`;
  };
}

/** The processing point a CSID callout cites: the last endpoint in the recorded journey that actually advanced the packet (a FINAL delivery record is not an advance). */
export function csidHopFacts(state: Srv6CsidState, stepId: string): CsidHopFacts | undefined {
  const replace = isReplacePhase(stepId);
  const journey = replace ? state.replaceJourney : state.journey;
  const hop = [...journey].reverse().find((j) => j.action !== "FINAL");
  if (!hop) return undefined;
  return {
    router: hop.router,
    action: hop.action,
    segmentsLeftBefore: hop.segmentsLeftBefore,
    segmentsLeftAfter: hop.segmentsLeftAfter,
    hopLimitBefore: hop.hopLimitBefore,
    hopLimitAfter: hop.hopLimitAfter,
    indexBefore: replace ? readReplaceIndex(hop.daBefore) : undefined,
    indexAfter: replace ? readReplaceIndex(hop.daAfter) : undefined,
  };
}
