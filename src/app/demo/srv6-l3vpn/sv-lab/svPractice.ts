import type { SpChallenge } from "@/components/sp-lab/spKit";
import type { SvState, SvTest } from "@/lib/sim-engine/scenarios/svNet";

/** SRv6 L3VPN Lab challenges — checked from the network's state and fresh pings, never from the commands typed. */
const fresh = (s: SvState) => s.tests.filter((t) => t.cfgSeq === s.cfgSeq);
const okTo = (s: SvState, src: string, to: string, ce?: string) => fresh(s).find((t) => t.src === src && t.to === to && t.ok && (!ce || t.deliveredTo === ce));
const last = (s: SvState): SvTest | undefined => fresh(s).at(-1);
const hint = (s: SvState) => {
  const t = last(s);
  return !t ? "ping from a CE (or ping vrf from a PE)." : t.ok ? `${t.src} → ${t.to}: success via ${t.fwd.sid ?? "a local route"}.` : `${t.src} → ${t.to}: ${t.why}`;
};

export const SV_CHALLENGES: SpChallenge<SvState>[] = [
  {
    id: "shared",
    title: "One SID, two sites",
    how: "Prove that CE1 reaches both CE2 (10.20.1.10) and CE3 (10.20.2.10) through the same End.DT4 service SID.",
    done: (s) => {
      const a = okTo(s, "CE1", "10.20.1.10", "CE2");
      const b = okTo(s, "CE1", "10.20.2.10", "CE3");
      return !!a && !!b && a.fwd.sid === b.fwd.sid && a.fwd.behavior === "End.DT4";
    },
    next: (s) => (!okTo(s, "CE1", "10.20.1.10", "CE2") ? "CE1 → 10.20.1.10 hasn't succeeded yet." : !okTo(s, "CE1", "10.20.2.10", "CE3") ? "CE1 → 10.20.2.10 hasn't succeeded yet." : "the two pings used different SIDs."),
  },
  {
    id: "isolation",
    title: "Same address, different customer",
    how: "Prove isolation: CE1's ping to 10.20.1.10 must be answered by CE2, and CE4's ping to 10.20.1.10 by CE5.",
    done: (s) => !!okTo(s, "CE1", "10.20.1.10", "CE2") && !!okTo(s, "CE4", "10.20.1.10", "CE5"),
    next: (s) => (!okTo(s, "CE1", "10.20.1.10", "CE2") ? "CE1 → 10.20.1.10 (answered by CE2) is missing." : !okTo(s, "CE4", "10.20.1.10", "CE5") ? "CE4 → 10.20.1.10 (answered by CE5) is missing." : hint(s)),
  },
  {
    id: "newsite",
    title: "Turn up a new site",
    how: "CE6 (CUST-A) is cabled to PE1 Gi0/0/0/3 with LAN 10.10.6.0/24 behind 192.168.16.2. Make 10.10.6.10 reachable from CE2.",
    done: (s) => !!okTo(s, "CE2", "10.10.6.10", "CE6"),
    next: (s) => (!s.cfg.PE1.statics.some((x) => x.pfx === "10.10.6.0/24") ? "PE1 has no route to 10.10.6.0/24 in CUST-A." : !s.view.vpn.some((x) => x.pe === "PE1" && x.pfx === "10.10.6.0/24") ? "PE1 doesn't advertise 10.10.6.0/24 into BGP." : hint(s)),
  },
  {
    id: "perce",
    title: "One SID per CE",
    how: "Switch PE2's CUST-A IPv4 to per-CE allocation, then prove CE1 still reaches CE2 and CE3 — now through two different End.DX4 SIDs.",
    done: (s) => {
      const a = okTo(s, "CE1", "10.20.1.10", "CE2");
      const b = okTo(s, "CE1", "10.20.2.10", "CE3");
      return !!a && !!b && a.fwd.behavior === "End.DX4" && b.fwd.behavior === "End.DX4" && a.fwd.sid !== b.fwd.sid;
    },
    next: (s) => (s.cfg.PE2.bgp?.vrf["CUST-A"]?.af.ipv4?.mode !== "per-ce" ? "PE2's CUST-A IPv4 still allocates per VRF." : hint(s)),
  },
  {
    id: "rebuild",
    title: "Rebuild PE2's VPN service",
    how: "Press “Remove PE2's BGP VRF” below: PE2's router bgp vrf CUST-A is gone. Rebuild it so CE1 reaches CE2 over IPv4 and IPv6 again.",
    done: (s) => !!s.cfg.PE2.bgp?.vrf["CUST-A"] && !!okTo(s, "CE1", "10.20.1.10", "CE2") && !!okTo(s, "CE1", "2001:db8:ca:20::a", "CE2"),
    next: (s) => {
      const v = s.cfg.PE2.bgp?.vrf["CUST-A"];
      if (!v) return "PE2 has no router bgp vrf CUST-A.";
      if (!v.rd) return "the VRF has no route distinguisher.";
      for (const f of ["ipv4", "ipv6"] as const) {
        const a = v.af[f];
        if (!a) return `address-family ${f} unicast is missing.`;
        if (!a.srv6On || !a.srv6) return `${f}: no SRv6 locator for the service SID.`;
        if (!a.rs) return `${f}: the static routes toward the CEs aren't redistributed.`;
      }
      return hint(s);
    },
  },
];
