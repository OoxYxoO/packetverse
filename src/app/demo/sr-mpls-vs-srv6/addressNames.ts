import { canonicalIpv6, ipv6Hextets, type AddressName } from "@/components/lesson/srv6AdvancedCallout";
import { buildSrv6TeSegments, describeMplsLabel, describeSrv6Sid, globalDt4SidText, INFRA_ADDRESS, PE1_TRANSPORT_SOURCE, srv6TeSegmentName, type CapstoneState } from "@/lib/sim-engine/scenarios/srMplsVsSrv6";
import { fmtIpv6 } from "@/lib/sim-engine/scenarios/srv6Foundations";
import { PE2_DT4_SID } from "@/lib/sim-engine/scenarios/srv6L3vpn";
import { PLR_REPAIR_SOURCE } from "@/lib/sim-engine/scenarios/srv6TiLfa";
import { repairSidName } from "../srv6-ti-lfa/addressNames";

const TE_SEGMENTS = buildSrv6TeSegments();

/**
 * Names for capstone packet addresses, from the lesson's own helpers and the
 * given (live or historical) state. The generic global-table End.DT4 and the
 * CUST-A Service SID are named distinctly — they are different SIDs.
 */
export function capstoneAddressNames(state: CapstoneState): AddressName {
  const table = new Map<string, string>();
  const add = (addr: string, name: string) => table.set(canonicalIpv6(addr), name);
  for (const [r, h] of Object.entries(INFRA_ADDRESS)) add(fmtIpv6(h), r);
  add(PE1_TRANSPORT_SOURCE, "PE1");
  add(PLR_REPAIR_SOURCE, "P1");
  add(globalDt4SidText("PE2"), "PE2 End.DT4 (global table)");
  add(PE2_DT4_SID.sidText, "PE2 End.DT4 (CUST-A Service SID)");
  for (const s of TE_SEGMENTS) if (!table.has(canonicalIpv6(s.sidText))) add(s.sidText, srv6TeSegmentName(s));
  // One SID, one name: the shared repair's P4→P2 End.X is the same SID as the TE End.X, so an existing name is kept.
  for (const s of state.sharedRepair?.repairList.sids ?? []) if (!table.has(canonicalIpv6(s.sidText))) add(s.sidText, repairSidName(s));
  return (address) => {
    const known = table.get(canonicalIpv6(address));
    if (known) return known;
    if (!address.includes(":")) return undefined;
    const d = describeSrv6Sid(ipv6Hextets(address));
    return d !== "SID" ? d : undefined;
  };
}

export const capstoneLabelMeaning = (label: string) => describeMplsLabel(Number(label) as Parameters<typeof describeMplsLabel>[0]);
