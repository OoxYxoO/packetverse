import type { CliVendor } from "@/lib/cli/types";
import { RN_BUILD_PAIRS, RN_IFS, RN_IF_SEG, RN_ROUTERS, maskOf, netOf, rnLookup, rnName, rnOwner, rnPeerOf, rnTrace, type RnDev, type RnRouter, type RnState } from "@/lib/sim-engine/scenarios/routeNet";
import { ifName } from "./rnCli";

/**
 * Build exercise helpers. The hints are computed from the network as it is now: each required test is dry-run (on a
 * copy — nothing is recorded), and the first failure is explained one step at a time: which router, which network,
 * which neighbor, which next hop — and only at the end, the syntax.
 */

export interface RnHint {
  level: number;
  text: string;
}
/** Where a test would fail right now (dry run). */
export function dryRun(s: RnState, from: RnDev, dst: string) {
  const t = rnTrace(s, from, dst, "ping", { count: 1 });
  return t.last!;
}
function networkFor(s: RnState, ip: string): { net: string; len: number; owner?: RnRouter } {
  for (const r of RN_ROUTERS)
    for (const i of RN_IFS) {
      const c = s.cfg.r[r].ifs[i];
      if (netOf(ip, c.len) === netOf(c.addr, c.len) && !RN_IF_SEG[r][i].startsWith("t")) return { net: netOf(c.addr, c.len), len: c.len, owner: r };
    }
  return { net: netOf(ip, 24), len: 24 };
}
/** The address `nb` has on the link it shares with `r`. */
function addrToward(s: RnState, r: RnRouter, nb: RnRouter): string | undefined {
  for (const i of RN_IFS) {
    const p = rnPeerOf(r, i);
    if (p?.r === nb) return s.cfg.r[nb].ifs[p.i].addr;
  }
  return undefined;
}
export function buildHints(s: RnState, vendor: CliVendor): { pair?: string; hints: RnHint[] } {
  for (const p of RN_BUILD_PAIRS) {
    const run = dryRun(s, p.from, p.dst);
    if (run.ok) continue;
    const pr = run.probes[0];
    const leg = pr.failedLeg === "reply" ? "reply" : "request";
    const at = pr.stopAt;
    const target = leg === "reply" ? (run.from === "HOST-A" ? s.cfg.h["HOST-A"].ip : s.cfg.h[run.from as "SERVER-C"].ip) : p.dst;
    const n = networkFor(s, target);
    const hints: RnHint[] = [{ level: 1, text: `${p.label} fails. The ${leg} ${leg === "reply" ? `(back to ${rnName(s.cfg, target)})` : ""} stops at ${at ?? "?"} — that router needs attention.` }];
    if (at && RN_ROUTERS.includes(at as RnRouter)) {
      const r = at as RnRouter;
      const w = rnLookup(s.cfg, r, target).winner;
      hints.push({ level: 2, text: w ? `${r}'s best match for ${target} is ${w.prefix}/${w.len}${w.discard ? " (discard)" : w.nh ? ` via ${w.nh}` : ""} — and the packet still dies there (${pr.stop}). Is that next hop right?` : `${r} has no installed route containing ${target}. It needs one for ${n.net}/${n.len}.` });
      const nb = n.owner && n.owner !== r ? n.owner : undefined;
      if (nb) {
        hints.push({ level: 3, text: `${n.net}/${n.len} is connected to ${nb}, and ${nb} is a direct neighbor of ${r}. Hand the packet to ${nb}.` });
        const nh = addrToward(s, r, nb);
        const myIf = RN_IFS.find((i) => rnPeerOf(r, i)?.r === nb);
        if (nh) hints.push({ level: 4, text: `${nb}'s address on the link to ${r} is ${nh} (${r}'s side is ${myIf ? ifName(vendor, myIf) : "?"}). That is the next hop — a neighbor ${r} can ARP for.` });
        if (nh) hints.push({ level: 5, text: vendor === "cisco" ? `On ${r}: configure terminal → ip route ${n.net} ${maskOf(n.len)} ${nh} → end. Check with show ip route, then test again — both directions.` : `On ${r}: configure → set routing-options static route ${n.net}/${n.len} next-hop ${nh} → commit. Check with show route, then test again — both directions.` });
      }
    }
    return { pair: p.label, hints };
  }
  return { hints: [] };
}
export const pairOwnerName = (s: RnState, ip: string) => rnOwner(s.cfg, ip)?.dev ?? ip;
