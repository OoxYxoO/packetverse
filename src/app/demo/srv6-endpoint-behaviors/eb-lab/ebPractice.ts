import type { SpChallenge } from "@/components/sp-lab/spKit";
import { ebSid, type EbState } from "@/lib/sim-engine/scenarios/ebNet";

/** SRv6 Endpoint Behaviors Lab challenges — checked from the local SID tables, the VRFs and fresh tests. */
const fresh = (s: EbState) => s.tests.filter((t) => t.cfgSeq === s.cfgSeq);
const hint = (s: EbState) => {
  const t = fresh(s).at(-1);
  return !t ? "send a test from R1." : t.ok ? `that one reached ${t.deliveredTo} via ${t.path.join(" → ")}.` : `that one failed: ${t.why}`;
};
const behaviorOf = (s: EbState, sid: string) => ebSid(s.view, "R6", sid)?.behavior ?? ebSid(s.view, "R3", sid)?.behavior;

export const EB_CHALLENGES: SpChallenge<EbState>[] = [
  {
    id: "crosslink",
    title: "Over the cross-link",
    how: "Without changing configuration, deliver a packet to CE4-B (10.10.2.8) over R3 → R4 → R5 → R6.",
    done: (s) => fresh(s).some((t) => t.ok && t.deliveredTo === "CE4-B" && t.path.join("-").includes("R3-R4-R5-R6")),
    next: hint,
  },
  {
    id: "both",
    title: "Both families",
    how: "Without changing configuration, deliver one packet to CE4-A (10.10.1.8) and one to CE6 (2001:db8:c6::6), each with a single SID.",
    done: (s) => ["CE4-A", "CE6"].every((ce) => fresh(s).some((t) => t.ok && t.deliveredTo === ce && t.sids.length === 1)),
    next: hint,
  },
  {
    id: "dx",
    title: "A SID per customer",
    how: "Make R6 allocate per-CE SIDs for VRF CUST4, find CE4-B's End.DX4 SID in R6's table, and deliver to 10.10.2.8 with it.",
    done: (s) => s.cfg.R6.vrfs.CUST4?.mode === "per-ce" && fresh(s).some((t) => t.ok && t.deliveredTo === "CE4-B" && behaviorOf(s, t.sids.at(-1)!) === "End.DX4"),
    next: (s) => (s.cfg.R6.vrfs.CUST4?.mode !== "per-ce" ? "VRF CUST4 still allocates per VRF." : hint(s)),
  },
  {
    id: "top",
    title: "The service, the long way",
    how: "Get a packet to CE4-B with only the CUST4 service SID in the list, over the top (R1 → R2 → R3 → R6), by changing IS-IS metrics only.",
    done: (s) => fresh(s).some((t) => t.ok && t.deliveredTo === "CE4-B" && t.sids.length === 1 && t.path.join("-").includes("R1-R2-R3-R6")),
    next: hint,
  },
  {
    id: "rebuild",
    title: "Rebuild R6's services",
    how: "Press “Wipe R6's services” below, then rebuild SRv6 under both VRFs on R6's console (locator MAIN, per VRF) and deliver to CE4-B and CE6 again.",
    done: (s) => !!s.wiped && ["CE4-B", "CE6"].every((ce) => fresh(s).some((t) => t.ok && t.deliveredTo === ce)),
    next: (s) => (!s.wiped ? "press “Wipe R6's services” first." : s.view.sids.R6.filter((x) => x.vrf).length < 2 ? "R6 doesn't have both service SIDs yet." : hint(s)),
  },
];
