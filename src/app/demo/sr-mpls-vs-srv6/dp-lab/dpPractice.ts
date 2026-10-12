import type { SpChallenge } from "@/components/sp-lab/spKit";
import { D_P, type DState, type DTest } from "@/lib/sim-engine/scenarios/dpNet";

/** SR-MPLS vs SRv6 Lab challenges — checked from the network and fresh traffic, never from the commands typed. */
const fresh = (s: DState) => s.tests.filter((t) => t.cfgSeq === s.cfgSeq);
const ok = (s: DState, pred: (t: DTest) => boolean) => fresh(s).find((t) => t.walk.ok && pred(t));
const plane = (t: DTest) => (t.enc === "mpls" ? "SR-MPLS" : "SRv6");
const hint = (s: DState) => {
  const t = fresh(s).at(-1);
  return !t ? "send traffic (ping or drill)." : t.walk.ok ? `${t.cut ? "drill, " : ""}${t.size} B over ${plane(t)}: delivered via ${t.walk.path.join(" → ")}.` : `${t.cut ? "drill, " : ""}${t.size} B over ${plane(t)}: ${t.walk.why}`;
};

export const DP_CHALLENGES: SpChallenge<DState>[] = [
  {
    id: "migrate",
    title: "Migrate CUST-A to SRv6",
    how: "Make PE2 carry CUST-A over SRv6 instead of an MPLS VPN label, and prove it with a fresh ping from site 1.",
    done: (s) => !!ok(s, (t) => t.enc === "srv6" && !t.cut),
    next: (s) => (s.view.svc.enc === "mpls" ? "CUST-A still rides SR-MPLS: PE2's VRF allocates VPN label 9002." : !s.view.svc.usable ? `SRv6 isn't usable: ${s.view.svc.why}.` : hint(s)),
  },
  {
    id: "transit",
    title: "A core without labels",
    how: "Turn SR-MPLS off on every P router, and prove CUST-A is still delivered — through the same core.",
    done: (s) => D_P.every((r) => !s.cfg[r].mpls) && !!ok(s, (t) => !t.cut && t.walk.path.includes("P2")),
    next: (s) => (D_P.some((r) => s.cfg[r].mpls) ? `still running SR-MPLS: ${D_P.filter((r) => s.cfg[r].mpls).join(", ")}.` : hint(s)),
  },
  {
    id: "protect",
    title: "Protected twice",
    how: "Prove that P1 repairs the P1–P2 cut in both data planes: one delivered drill over SR-MPLS and one over SRv6.",
    done: (s) => s.tests.some((t) => t.cut && t.walk.ok && t.enc === "mpls") && s.tests.some((t) => t.cut && t.walk.ok && t.enc === "srv6"),
    next: (s) => {
      const m = s.tests.some((t) => t.cut && t.walk.ok && t.enc === "mpls");
      const v = s.tests.some((t) => t.cut && t.walk.ok && t.enc === "srv6");
      return m ? (v ? "done." : "SR-MPLS drill delivered — now the same over SRv6.") : v ? "SRv6 drill delivered — now the same over SR-MPLS." : hint(s);
    },
  },
  {
    id: "budget",
    title: "Same link, two answers",
    how: "Set the P1–P3 link (both ends) to mtu 1514. Show that a 1460-byte drill is repaired over SR-MPLS but dropped over SRv6 — on that very link.",
    done: (s) => s.tests.some((t) => t.cut && t.walk.ok && t.enc === "mpls" && t.size >= 1460 && t.walk.pathMtu <= 1500) && s.tests.some((t) => t.cut && !t.walk.ok && t.enc === "srv6" && t.size >= 1460 && /MTU toward P3/.test(t.walk.why ?? "")),
    next: (s) => (s.cfg.P1.mtu["ge-0/0/2"] !== 1514 || s.cfg.P3.mtu["ge-0/0/0"] !== 1514 ? "P1–P3 is not at mtu 1514 on both ends yet." : hint(s)),
  },
  {
    id: "choose",
    title: "Choose the plane that protects",
    how: "Remove P4's SRv6 locator from IS-IS (P4 keeps SR-MPLS). Keep CUST-A protected anyway, and prove it with a delivered drill.",
    done: (s) => !s.cfg.P4.isisLoc && s.cfg.P4.mpls && !!ok(s, (t) => t.cut),
    next: (s) => (s.cfg.P4.isisLoc ? "P4 still advertises its SRv6 locator." : !s.view.repair.labels && !s.view.repair.sids ? "P1 has no backup in either plane." : hint(s)),
  },
];
