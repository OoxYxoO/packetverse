import type { SpChallenge } from "@/components/sp-lab/spKit";
import { macTable, type EvHost, type EvState } from "@/lib/sim-engine/scenarios/evNet";

/** EVPN-VXLAN Lab challenges — checked from the EVPN routes, the MAC tables and fresh host pings. */
const fresh = (s: EvState) => s.tests.filter((t) => t.cfgSeq === s.cfgSeq);
const pinged = (s: EvState, from: EvHost, dst: string) => fresh(s).filter((t) => t.from === from && t.dst === dst).at(-1);
const remoteAt = (s: EvState, leaf: "LEAF1" | "LEAF2", mac: string) => macTable(s.cfg, s.view, s.fdb, leaf).some((m) => m.mac === mac && !!m.remote);

export const EV_CHALLENGES: SpChallenge<EvState>[] = [
  {
    id: "learn",
    title: "Learned from BGP, not from the tunnel",
    how: "Clear both leaves' tables (Clear all MAC tables, or clear ethernet-switching table on each leaf), then ping 10.10.10.22 from HOST-A. LEAF1 must end up with HOST-B as a remote MAC behind 10.255.0.2 — read it in show evpn database or show ethernet-switching table.",
    done: (s) => s.cleared !== undefined && s.tests.some((t) => t.t > s.cleared! && t.from === "HOST-A" && t.dst === "10.10.10.22" && t.ok) && remoteAt(s, "LEAF1", "bb:bb:bb:bb:bb:22"),
    next: (s) => (s.cleared === undefined ? "clear the MAC tables first." : "now ping 10.10.10.22 from HOST-A."),
  },
  {
    id: "silent",
    title: "Known without crossing",
    how: "Clear the tables, then ping only between HOST-A and HOST-C (both on LEAF1). Show that LEAF2 knows HOST-C (cc:cc:cc:cc:cc:33) behind LEAF1 even though no frame of HOST-C's ever crossed the fabric.",
    done: (s) => {
      if (s.cleared === undefined) return false;
      const since = s.tests.filter((t) => t.t > s.cleared!);
      return since.length > 0 && since.every((t) => (t.from === "HOST-A" && t.dst === "10.10.10.33") || (t.from === "HOST-C" && t.dst === "10.10.10.11")) && since.some((t) => t.ok) && remoteAt(s, "LEAF2", "cc:cc:cc:cc:cc:33");
    },
    next: (s) => (s.cleared === undefined ? "clear the MAC tables first." : "ping 10.10.10.33 from HOST-A — and nothing else since the clear."),
  },
  {
    id: "vni20",
    title: "Stretch VLAN 20",
    how: "HOST-E (LEAF1) and HOST-F (LEAF2) share 10.20.20.0/24 in V20, which isn't stretched. On both leaves map V20 to VNI 10020, add it to the extended-vni-list and give it route target 65000:10020; prove it with a fresh ping from HOST-E to 10.20.20.22.",
    done: (s) => !!pinged(s, "HOST-E", "10.20.20.22")?.ok,
    next: (s) => {
      for (const l of ["LEAF1", "LEAF2"] as const) {
        const c = s.cfg[l];
        if (c.vlans.V20?.vni !== 10020) return `${l}: V20 isn't mapped to VNI 10020.`;
        if (!c.evpn?.extended.includes(10020)) return `${l}: 10020 isn't in the extended-vni-list.`;
        if (c.evpn.targets[10020] !== "65000:10020") return `${l}: VNI 10020 has no route target 65000:10020.`;
      }
      return "now ping 10.20.20.22 from HOST-E.";
    },
  },
  {
    id: "vlanlocal",
    title: "VLAN numbers are local",
    how: "Prove the VNI is what matters: give LEAF2's V10 VLAN ID 110 (vlans V10 vlan-id 110) and show that a fresh ping from HOST-A to 10.10.10.22 still works.",
    done: (s) => s.cfg.LEAF2.vlans.V10?.id === 110 && s.cfg.LEAF1.vlans.V10?.id === 10 && !!pinged(s, "HOST-A", "10.10.10.22")?.ok,
    next: (s) => (s.cfg.LEAF2.vlans.V10?.id !== 110 ? "LEAF2's V10 still has VLAN ID 10." : "now ping 10.10.10.22 from HOST-A."),
  },
  {
    id: "rebuild",
    title: "Rebuild LEAF2's overlay",
    how: "Press “Wipe LEAF2's overlay” (below): LEAF2 loses protocols evpn, its BGP group, switch-options and its VLAN-to-VNI mappings. Rebuild them — VTEP source lo0.0, RD 10.255.0.2:10010, V10 → VNI 10010, extended, route target 65000:10010, BGP to 10.255.0.1 with family evpn — and prove it with a fresh ping from HOST-A to 10.10.10.22. You touch LEAF2 only.",
    done: (s) => !!s.wiped && s.view.bgp.evpn && !!pinged(s, "HOST-A", "10.10.10.22")?.ok,
    next: (s) => {
      if (!s.wiped) return "wipe LEAF2's overlay first.";
      const c = s.cfg.LEAF2;
      if (!c.vtep) return "LEAF2 has no vtep-source-interface.";
      if (!c.rd) return "LEAF2 has no route-distinguisher.";
      if (c.vlans.V10?.vni !== 10010) return "LEAF2's V10 isn't mapped to VNI 10010.";
      if (!c.evpn?.vxlan || !c.evpn.extended.includes(10010)) return "LEAF2's protocols evpn needs encapsulation vxlan and extended-vni-list 10010.";
      if (c.evpn.targets[10010] !== "65000:10010") return "LEAF2's VNI 10010 needs vrf-target target:65000:10010.";
      if (!s.view.bgp.evpn) return "the BGP EVPN session to 10.255.0.1 isn't carrying family evpn yet.";
      return "now ping 10.10.10.22 from HOST-A.";
    },
  },
];
