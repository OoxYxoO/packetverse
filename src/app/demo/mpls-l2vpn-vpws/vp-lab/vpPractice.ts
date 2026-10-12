import type { SpChallenge } from "@/components/sp-lab/spKit";
import { cwOf, type VpCe, type VpState } from "@/lib/sim-engine/scenarios/vpNet";

/** L2VPN (VPWS) Lab challenges — checked from the pseudowires' state and fresh customer pings. */
const fresh = (s: VpState) => s.tests.filter((t) => t.cfgSeq === s.cfgSeq);
const pinged = (s: VpState, from: VpCe, dst: string) => fresh(s).filter((t) => t.from === from && t.dst === dst).at(-1);
const svc = (s: VpState, vlan: number) => s.view.pws.filter((p) => p.xc.ac?.endsWith(`.${vlan}`));
const bothUp = (s: VpState, vlan: number) => svc(s, vlan).length === 2 && svc(s, vlan).every((p) => p.up);

export const VP_CHALLENGES: SpChallenge<VpState>[] = [
  {
    id: "transparent",
    title: "Prove the wires are separate",
    how: "Without changing anything, show that both customers use 192.168.100.0/24 and still never meet: ping 192.168.100.2 from CE1A and from CE1B. Each must succeed and reach its own site 2.",
    done: (s) => pinged(s, "CE1A", "192.168.100.2")?.reached === "CE2A" && !!pinged(s, "CE1A", "192.168.100.2")?.ok && pinged(s, "CE1B", "192.168.100.2")?.reached === "CE2B" && !!pinged(s, "CE1B", "192.168.100.2")?.ok,
    next: (s) => (!pinged(s, "CE1A", "192.168.100.2") ? "ping 192.168.100.2 from CE1A." : !pinged(s, "CE1B", "192.168.100.2") ? "now ping 192.168.100.2 from CE1B." : "both pings must succeed — and reach different sites."),
  },
  {
    id: "newpw",
    title: "Move CUST-B to PW ID 5200",
    how: "The provider renumbers its pseudowires: CUST-B must use PW ID 5200 instead of 5100. Change it on both PEs and prove CUST-B with a fresh ping from CE1B to 192.168.100.2.",
    done: (s) => svc(s, 200).length === 2 && svc(s, 200).every((p) => p.xc.pwid === 5200) && bothUp(s, 200) && !!pinged(s, "CE1B", "192.168.100.2")?.ok,
    next: (s) => {
      const ps = svc(s, 200);
      if (!ps.some((p) => p.xc.pwid === 5200)) return "neither PE uses PW ID 5200 for CUST-B yet.";
      if (!ps.every((p) => p.xc.pwid === 5200)) return "one PE uses 5200, the other doesn't: the pseudowire can't come up until both agree.";
      if (!bothUp(s, 200)) return "both use 5200, but the pseudowire isn't up — check each PE's view.";
      return "now ping 192.168.100.2 from CE1B.";
    },
  },
  {
    id: "nocw",
    title: "Turn the control word off for CUST-A",
    how: "CUST-A's new CE vendor recommends running the pseudowire without the control word. Turn it off on both ends (IOS XR: the pw-class; Junos: no-control-word) and prove CUST-A with a fresh ping from CE1A to 192.168.100.2.",
    done: (s) => svc(s, 100).length === 2 && svc(s, 100).every((p) => !cwOf(s.os, s.cfg[p.pe], p.xc)) && bothUp(s, 100) && !!pinged(s, "CE1A", "192.168.100.2")?.ok,
    next: (s) => {
      const ps = svc(s, 100);
      const off = ps.filter((p) => !cwOf(s.os, s.cfg[p.pe], p.xc)).length;
      if (!off) return "both ends of CUST-A's pseudowire still use the control word.";
      if (off < ps.length) return "one end is off, the other on: a control-word mismatch keeps the pseudowire down.";
      if (!bothUp(s, 100)) return "the control word is off at both ends, but the pseudowire isn't up.";
      return "now ping 192.168.100.2 from CE1A.";
    },
  },
  {
    id: "jumbo",
    title: "Jumbo frames for CUST-A",
    how: "CUST-A wants 9000-byte frames. Raise the pseudowire MTU of CUST-A to 9000 at both ends (IOS XR: mtu 9018 on the l2transport sub-interface; Junos: mtu 9000 under the l2circuit interface) and prove it with a fresh ping from CE1A.",
    done: (s) => svc(s, 100).length === 2 && svc(s, 100).every((p) => p.mtu === 9000) && bothUp(s, 100) && !!pinged(s, "CE1A", "192.168.100.2")?.ok,
    next: (s) => {
      const ps = svc(s, 100);
      if (!ps.some((p) => p.mtu === 9000)) return "CUST-A's pseudowire still signals MTU 1500 at both ends.";
      if (!ps.every((p) => p.mtu === 9000)) return "one end signals 9000, the other doesn't: an MTU mismatch keeps the pseudowire down.";
      if (!bothUp(s, 100)) return "both ends signal 9000, but the pseudowire isn't up.";
      return "now ping 192.168.100.2 from CE1A.";
    },
  },
  {
    id: "rebuild",
    title: "Rebuild CUST-A on PE2",
    how: "Press “Wipe PE2's CUST-A service” (below): the sub-interface and the cross-connect are deleted. Build them again — VLAN 100 on the port toward CE2A, a cross-connect to 1.1.1.1 with PW ID 5000 and the control word — and prove it with a fresh ping from CE1A to 192.168.100.2.",
    done: (s) => !!s.wiped && bothUp(s, 100) && pinged(s, "CE1A", "192.168.100.2")?.reached === "CE2A" && !!pinged(s, "CE1A", "192.168.100.2")?.ok,
    next: (s) => {
      if (!s.wiped) return "wipe PE2's CUST-A service first.";
      const ac = Object.entries(s.cfg.PE2.acs).find(([k]) => k.startsWith("ge-0/0/1."));
      if (!ac) return "PE2 has no sub-interface on the port toward CE2A.";
      if (ac[1].vlan !== 100) return "PE2's sub-interface toward CE2A doesn't accept VLAN 100.";
      const x = s.cfg.PE2.xcs.find((y) => y.ac === ac[0]);
      if (!x) return "the sub-interface isn't in a cross-connect.";
      if (x.nbr !== "1.1.1.1" || x.pwid !== 5000) return "the cross-connect must point at 1.1.1.1 with PW ID 5000.";
      if (!bothUp(s, 100)) return "the pseudowire isn't up yet — compare the two ends (control word, MTU).";
      return "now ping 192.168.100.2 from CE1A.";
    },
  },
];
