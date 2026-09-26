import { canonicalIpv6, type AddressName } from "@/components/lesson/srv6AdvancedCallout";
import { ALL_ROUTERS, buildMultiSidIllustration, INFRA_ADDRESS_TEXT, isEndXRepairSid, srSourceFor, type RepairInstructionSid, type Srv6TiLfaState } from "@/lib/sim-engine/scenarios/srv6TiLfa";
import { PE1_SR_SOURCE as VPN_PE1_SOURCE, PE2_DT4_SID } from "@/lib/sim-engine/scenarios/srv6L3vpn";

/** End.X names its bound adjacency; the incident's plain End SID is only routed toward its owner (#83). */
export function repairSidName(s: RepairInstructionSid): string {
  const flavors = s.flavors.join("+");
  return isEndXRepairSid(s) ? `${s.owner} End.X+${flavors}→${s.adjacency}` : `${s.owner} End+${flavors} · routed toward ${s.owner} · no bound adjacency`;
}

const MULTI_SIDS = buildMultiSidIllustration().sids;

/**
 * Names for every address a TI-LFA packet can carry, read from the given
 * state (live, or a historical snapshot) — so a historical bubble names the
 * repair SID that was installed THEN, never the current one.
 */
export function tiLfaAddressNames(state: Srv6TiLfaState): AddressName {
  const table = new Map<string, string>();
  const add = (addr: string, name: string) => table.set(canonicalIpv6(addr), name);
  for (const r of ALL_ROUTERS) {
    add(INFRA_ADDRESS_TEXT[r], r);
    add(srSourceFor(r), r);
  }
  add(VPN_PE1_SOURCE, "PE1");
  add(PE2_DT4_SID.sidText, "PE2 End.DT4 (CUST-A)");
  for (const s of MULTI_SIDS) add(s.sidText, repairSidName(s));
  for (const s of state.nodeRepair?.repairList.sids ?? []) add(s.sidText, repairSidName(s));
  for (const s of state.linkRepair?.repairList.sids ?? []) add(s.sidText, repairSidName(s));
  return (address) => table.get(canonicalIpv6(address));
}
