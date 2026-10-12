import type { SpChallenge } from "@/components/sp-lab/spKit";
import type { L3Ce, L3State } from "@/lib/sim-engine/scenarios/l3Net";

/** MPLS L3VPN Lab challenges — checked from the VRF tables and fresh customer pings. */
const fresh = (s: L3State) => s.tests.filter((t) => t.cfgSeq === s.cfgSeq);
const pinged = (s: L3State, from: L3Ce, dst: string) => fresh(s).filter((t) => t.from === from && t.dst === dst).at(-1);

export const L3_CHALLENGES: SpChallenge<L3State>[] = [
  {
    id: "overlap",
    title: "Prove the overlap",
    how: "Without changing anything, show that both customers use 10.2.2.0/24 and still stay apart: ping 10.2.2.20 from CE1A and from CE1B. Each must succeed and reach its own customer's site 2.",
    done: (s) => pinged(s, "CE1A", "10.2.2.20")?.reached === "CE2A" && !!pinged(s, "CE1A", "10.2.2.20")?.ok && pinged(s, "CE1B", "10.2.2.20")?.reached === "CE2B" && !!pinged(s, "CE1B", "10.2.2.20")?.ok,
    next: (s) => (!pinged(s, "CE1A", "10.2.2.20") ? "ping 10.2.2.20 from CE1A." : !pinged(s, "CE1B", "10.2.2.20") ? "now ping 10.2.2.20 from CE1B." : "both pings must succeed — and reach different sites."),
  },
  {
    id: "extranet",
    title: "Give CUST-A the shared service",
    how: "CE2S (10.9.9.0/24, VRF SHARED on PE2, route target 65001:900) is a service for CUST-A only. Make both CUST-A sites reach 10.9.9.10, while CUST-B still can't. Prove it with fresh pings from CE1A, CE2A and CE1B. (On Junos, vrf-target import takes a single route target: importing two needs a vrf-import policy, and leaking between two VRFs of the same PE also needs routing-options auto-export in both.)",
    done: (s) => !!pinged(s, "CE1A", "10.9.9.10")?.ok && !!pinged(s, "CE2A", "10.9.9.10")?.ok && !!pinged(s, "CE1B", "10.9.9.10") && !pinged(s, "CE1B", "10.9.9.10")!.ok,
    next: (s) => {
      if (!pinged(s, "CE1A", "10.9.9.10")?.ok) return "CE1A doesn't reach 10.9.9.10 yet (or you haven't pinged since your last change). Which VRFs must import which route targets — in both directions?";
      if (!pinged(s, "CE2A", "10.9.9.10")?.ok) return `CE2A (site 2, on the same PE as the service) doesn't reach it yet.${s.os === "junos" ? " On Junos, two VRFs of the same PE exchange routes only with auto-export." : ""}`;
      if (!pinged(s, "CE1B", "10.9.9.10")) return "now prove CUST-B can't: ping 10.9.9.10 from CE1B.";
      return "CUST-B reaches the shared service too — it shouldn't.";
    },
  },
  {
    id: "secondlan",
    title: "Announce CE1A's second LAN",
    how: "CE1A also has 10.1.2.0/24, which the provider doesn't route yet. Make CUST-A's site 2 reach 10.1.2.10 — and only CUST-A's.",
    done: (s) => !!pinged(s, "CE2A", "10.1.2.10")?.ok,
    next: (s) => (!s.view.vrfRoutes.PE1.some((r) => r.vrf === "CUST-A" && r.prefix === "10.1.2.0/24") ? "PE1 has no route to 10.1.2.0/24 in VRF CUST-A." : !s.view.vrfRoutes.PE2.some((r) => r.vrf === "CUST-A" && r.prefix === "10.1.2.0/24") ? "PE1 has the route, but PE2's CUST-A doesn't — is it advertised?" : "now ping 10.1.2.10 from CE2A."),
  },
  {
    id: "pervrf",
    title: "One label per VRF",
    how: "Make PE2 allocate one VPN label for the whole of VRF CUST-A instead of one per prefix (IOS XR label mode per-vrf, Junos vrf-table-label), and prove CUST-A still works with a fresh ping from CE1A to 10.2.2.20.",
    done: (s) => !!s.cfg.PE2.vrfs["CUST-A"]?.perVrfLabel && !!pinged(s, "CE1A", "10.2.2.20")?.ok,
    next: (s) => (!s.cfg.PE2.vrfs["CUST-A"]?.perVrfLabel ? "PE2's CUST-A still allocates per prefix." : "now ping 10.2.2.20 from CE1A."),
  },
  {
    id: "rebuild",
    title: "Rebuild CUST-B on PE2",
    how: "Press “Wipe PE2's CUST-B” (below): the VRF is deleted and its port left in the global table. Build it again — RD 65001:202, route target 65001:200 in and out, the port, the static route to CE2B, advertised into BGP — and prove it with a fresh ping from CE1B to 10.2.2.20.",
    done: (s) => !!s.wiped && !!pinged(s, "CE1B", "10.2.2.20")?.ok && pinged(s, "CE1B", "10.2.2.20")?.reached === "CE2B",
    next: (s) => {
      if (!s.wiped) return "wipe PE2's CUST-B first.";
      const v = s.cfg.PE2.vrfs["CUST-B"];
      if (!v) return "PE2 has no VRF CUST-B.";
      if (!v.rd) return "the VRF has no RD.";
      if (!v.imp.includes("65001:200") || !v.exp.includes("65001:200")) return "the route targets aren't 65001:200 in and out.";
      if (s.cfg.PE2.ifs["ge-0/0/2"]?.vrf !== "CUST-B") return "PE2's port toward CE2B isn't in the VRF.";
      if (!v.statics.length) return "there is no static route to CE2B's LAN.";
      return "now ping 10.2.2.20 from CE1B.";
    },
  },
];
