import type { SpChallenge } from "@/components/sp-lab/spKit";
import { CES, type VsCe } from "@/lib/sim-engine/scenarios/vsNet";
import { EM_PES, emMacTable, emMeshOk, type EmState } from "@/lib/sim-engine/scenarios/emNet";

/** L2VPN Evolution Lab challenges — checked from the EVPN routes, the flood lists, the MAC tables and fresh customer pings. */
const fresh = (s: EmState) => s.tests.filter((t) => t.cfgSeq === s.cfgSeq);
const pinged = (s: EmState, from: VsCe, dst: string) => fresh(s).filter((t) => t.from === from && t.dst === dst).at(-1);
const knows = (s: EmState, pe: "PE1" | "PE2" | "PE3", ce: VsCe) => emMacTable(s.view, s.fdb, pe).some((m) => m.mac === CES[ce].mac && !!m.remote);

export const EVO_CHALLENGES: SpChallenge<EmState>[] = [
  {
    id: "learn",
    title: "Learn without seeing",
    how: "Make PE2 know where CE3 is — CE3's MAC behind PE3 — without CE2 or CE4 sending anything. Then check PE2's table (show evpn evi vpn-id 100 mac / show evpn database instance EVPN-A): which route taught it?",
    done: (s) => knows(s, "PE2", "CE3") && !s.fdb.PE2.length,
    next: (s) => {
      if (s.fdb.PE2.length) return "a CE behind PE2 has sent frames — clear the MAC tables and use only CE1 and CE3.";
      if (!s.fdb.PE3.some((m) => m.mac === CES.CE3.mac)) return "PE3 hasn't learned CE3's MAC yet: CE3 must send a frame (a ping between CE1 and CE3 will do).";
      return "PE3 knows CE3, but PE2 has no Type 2 route for it — is PE3 advertising its MACs?";
    },
  },
  {
    id: "unicast",
    title: "Flood once, then unicast",
    how: "Ping 192.168.100.3 from CE1 twice in a row with nothing in between. The first ping floods (its ARP request goes to every PE with their inclusive-multicast labels); the second must be unicast only, with PE3's unicast label. If the tables already know CE3, clear them first.",
    done: (s) => {
      const t = s.tests;
      for (let i = 1; i < t.length; i++) if (t[i - 1].from === "CE1" && t[i - 1].dst === "192.168.100.3" && t[i - 1].ok && t[i - 1].flooded && t[i].from === "CE1" && t[i].dst === "192.168.100.3" && t[i].ok && !t[i].flooded) return true;
      return false;
    },
    next: (s) => {
      const t = s.tests.at(-1);
      if (!t) return "ping 192.168.100.3 from CE1.";
      if (t.from === "CE1" && t.dst === "192.168.100.3" && t.ok && t.flooded) return "now ping it again: the second time should be unicast.";
      if (t.from === "CE1" && t.dst === "192.168.100.3" && t.ok && !t.flooded) return "that ping was already unicast — clear the MAC tables, then ping twice.";
      return "two pings from CE1 to 192.168.100.3, back to back.";
    },
  },
  {
    id: "ce4",
    title: "Connect CE4 to the EVI",
    how: "CE4 (192.168.100.4) is cabled to PE2's second port and sends VLAN 100. Add an attachment circuit for VLAN 100 on that port to PE2's bridge domain / EVPN instance — no BGP change is needed — and prove it with a fresh ping from CE4 to 192.168.100.1.",
    done: (s) => !!pinged(s, "CE4", "192.168.100.1")?.ok,
    next: (s) => {
      const ac = s.cfg.PE2.acs["ge-0/0/2.100"];
      if (!ac) return "PE2 has no sub-interface for VLAN 100 on the port toward CE4.";
      if (ac.vlan !== 100) return "the sub-interface toward CE4 doesn't accept VLAN 100.";
      if (s.os === "junos" && !ac.l2) return "the unit toward CE4 needs encapsulation vlan-bridge.";
      if (!s.cfg.PE2.bd?.acs.includes("ge-0/0/2.100")) return "the sub-interface isn't in PE2's bridge domain / EVPN instance.";
      return "now ping 192.168.100.1 from CE4.";
    },
  },
  {
    id: "rebuild",
    title: "Rebuild PE3",
    how: "Press “Wipe PE3's EVPN” (below): PE3 loses its EVI, its bridge domain / instance and its sub-interface; its BGP session stays. Build the service again — VLAN 100 toward CE3, EVI 100 with RD 65000:3 and RT 65000:100, MAC advertisement — and prove it: a fresh ping from CE1 to 192.168.100.3 succeeds and PE1 learns CE3's MAC from a Type 2 route. You touch PE3 only.",
    done: (s) => !!s.wiped && emMeshOk(s) && !!pinged(s, "CE1", "192.168.100.3")?.ok && knows(s, "PE1", "CE3"),
    next: (s) => {
      if (!s.wiped) return "wipe PE3's EVPN first.";
      const c = s.cfg.PE3;
      const k = "ge-0/0/1.100";
      if (!c.acs[k] || c.acs[k].vlan !== 100) return "PE3 has no sub-interface accepting VLAN 100 toward CE3.";
      if (s.os === "junos" && !c.acs[k].l2) return "PE3's unit toward CE3 needs encapsulation vlan-bridge.";
      if (!c.bd?.acs.includes(k)) return "PE3's attachment circuit toward CE3 isn't in a bridge domain / EVPN instance.";
      if (!c.evi?.rd) return "PE3's EVI has no route distinguisher.";
      if (c.evi.rt !== "65000:100") return "PE3's EVI must import and export 65000:100.";
      if (s.os === "xr" && c.bd.evi !== 100) return "PE3's bridge domain isn't bound to EVI 100 (evi 100 under the bridge domain).";
      if (!emMeshOk(s)) return "not every PE has every other on its flood list yet.";
      if (s.os === "xr" && !c.evi.advMac) return "PE3 advertises no MAC routes: without advertise-mac the others never learn CE3 and keep flooding to it.";
      return "now ping 192.168.100.3 from CE1 and check PE1's table.";
    },
  },
  {
    id: "rt200",
    title: "Move the EVI to RT 65000:200",
    how: "The provider renumbers its route targets: EVI 100 must use 65000:200 on all three PEs. While only some PEs have changed, the sites split into islands — finish on all three and prove it with a fresh ping from CE1 to 192.168.100.3.",
    done: (s) => EM_PES.every((pe) => s.cfg[pe].evi?.rt === "65000:200") && emMeshOk(s) && !!pinged(s, "CE1", "192.168.100.3")?.ok,
    next: (s) => {
      const n = EM_PES.filter((pe) => s.cfg[pe].evi?.rt === "65000:200").length;
      if (!n) return "no PE uses 65000:200 yet.";
      if (n < 3) return `${n} of 3 PEs use 65000:200: PEs with different RTs don't import each other's routes.`;
      return emMeshOk(s) ? "now ping 192.168.100.3 from CE1." : "all three use 65000:200, but not every flood list is complete.";
    },
  },
];
