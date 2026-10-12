import type { SpChallenge } from "@/components/sp-lab/spKit";
import type { VsCe } from "@/lib/sim-engine/scenarios/vsNet";
import { BV_PES, type BvState } from "@/lib/sim-engine/scenarios/bvNet";

/** BGP VPLS Lab challenges — checked from the BGP tables, the pseudowires, the MAC tables and fresh customer pings. */
const fresh = (s: BvState) => s.tests.filter((t) => t.cfgSeq === s.cfgSeq);
const pinged = (s: BvState, from: VsCe, dst: string) => fresh(s).filter((t) => t.from === from && t.dst === dst).at(-1);
const meshUp = (s: BvState) => s.view.pws.length === 6 && s.view.pws.every((p) => p.up);

export const BV_CHALLENGES: SpChallenge<BvState>[] = [
  {
    id: "flood",
    title: "Flood once, then learn",
    how: "Show that the bridge works as in any VPLS: ping 192.168.100.3 from CE1 twice in a row with nothing in between. The first ping must have flooded, the second must be unicast only. (If the tables already know CE3, clear them first: clear l2vpn bridge-domain bd-name VPLS-A / clear vpls mac-table instance VPLS-A on PE1.)",
    done: (s) => {
      const t = s.tests;
      for (let i = 1; i < t.length; i++) if (t[i - 1].from === "CE1" && t[i - 1].dst === "192.168.100.3" && t[i - 1].ok && t[i - 1].flooded && t[i].from === "CE1" && t[i].dst === "192.168.100.3" && t[i].ok && !t[i].flooded) return true;
      return false;
    },
    next: (s) => {
      const t = s.tests.at(-1);
      if (!t) return "ping 192.168.100.3 from CE1.";
      if (t.from === "CE1" && t.dst === "192.168.100.3" && t.ok && t.flooded) return "now ping it again: the second time should be unicast.";
      if (t.from === "CE1" && t.dst === "192.168.100.3" && t.ok && !t.flooded) return "that ping was already unicast — clear PE1's MAC table, then ping twice.";
      return "two pings from CE1 to 192.168.100.3, back to back.";
    },
  },
  {
    id: "ce4",
    title: "Connect CE4 to the VPLS",
    how: "CE4 (192.168.100.4) is cabled to PE2's second port and sends VLAN 100. Add an attachment circuit for VLAN 100 on that port to PE2's bridge domain / VPLS instance — no BGP change is needed — and prove it with a fresh ping from CE4 to 192.168.100.1.",
    done: (s) => !!pinged(s, "CE4", "192.168.100.1")?.ok,
    next: (s) => {
      const ac = s.cfg.PE2.acs["ge-0/0/2.100"];
      if (!ac) return "PE2 has no sub-interface for VLAN 100 on the port toward CE4.";
      if (ac.vlan !== 100) return "the sub-interface toward CE4 doesn't accept VLAN 100.";
      if (!s.cfg.PE2.bd?.acs.includes("ge-0/0/2.100")) return "the sub-interface isn't in PE2's bridge domain / VPLS instance.";
      return "now ping 192.168.100.1 from CE4.";
    },
  },
  {
    id: "ve20",
    title: "Renumber PE3 to VE ID 20",
    how: "Give PE3 VE ID 20 (IOS XR: ve-id 20 under signaling-protocol bgp; Junos: site-identifier 20). PE1 and PE2 must answer with an extra label block that covers 20, the mesh must come back, and a fresh ping from CE1 to 192.168.100.3 must succeed.",
    done: (s) => s.cfg.PE3.bd?.veId === 20 && s.view.nlris.filter((n) => n.pe === "PE1").length > 1 && meshUp(s) && !!pinged(s, "CE1", "192.168.100.3")?.ok,
    next: (s) => {
      if (s.cfg.PE3.bd?.veId !== 20) return "PE3's VE ID isn't 20 yet.";
      if (s.view.nlris.filter((n) => n.pe === "PE1").length < 2) return "PE1 hasn't advertised a block covering VE ID 20 — has it imported PE3's new route?";
      return meshUp(s) ? "now ping 192.168.100.3 from CE1." : "not every pseudowire is up yet.";
    },
  },
  {
    id: "rebuild",
    title: "Rebuild PE3",
    how: "Press “Wipe PE3's VPLS” (below): PE3 loses its bridge domain / instance and its sub-interface; its BGP session stays. Build the VPLS again — VLAN 100 toward CE3, RD 65000:3, RT 65000:100, VE ID 3, BGP auto-discovery and signaling — and prove the full mesh with a fresh ping from CE1 to 192.168.100.3. You touch PE3 only.",
    done: (s) => !!s.wiped && meshUp(s) && !!pinged(s, "CE1", "192.168.100.3")?.ok,
    next: (s) => {
      if (!s.wiped) return "wipe PE3's VPLS first.";
      const bd = s.cfg.PE3.bd;
      if (!bd) return "PE3 has no bridge domain / VPLS instance.";
      if (!s.cfg.PE3.acs["ge-0/0/1.100"] || !bd.acs.includes("ge-0/0/1.100")) return "PE3's attachment circuit toward CE3 (VLAN 100) isn't in the VPLS.";
      if (s.os === "xr" && !(bd.vfi && bd.ad && bd.sig)) return "PE3's bridge domain needs a VFI with autodiscovery bgp and signaling-protocol bgp.";
      if (!bd.rd) return "PE3's VPLS has no route distinguisher.";
      if (bd.rt !== "65000:100") return "PE3's route target must be 65000:100.";
      if (bd.veId === undefined) return "PE3 has no VE ID (site identifier).";
      if (!meshUp(s)) return "not every pseudowire is up yet — check the VE ID.";
      return "now ping 192.168.100.3 from CE1.";
    },
  },
  {
    id: "rt200",
    title: "Move the VPLS to RT 65000:200",
    how: "The provider renumbers its route targets: VPLS-A must use 65000:200 on all three PEs. While only some PEs have changed, the sites split into islands — finish on all three and prove the mesh with a fresh ping from CE1 to 192.168.100.3.",
    done: (s) => BV_PES.every((pe) => s.cfg[pe].bd?.rt === "65000:200") && meshUp(s) && !!pinged(s, "CE1", "192.168.100.3")?.ok,
    next: (s) => {
      const n = BV_PES.filter((pe) => s.cfg[pe].bd?.rt === "65000:200").length;
      if (!n) return "no PE uses 65000:200 yet.";
      if (n < 3) return `${n} of 3 PEs use 65000:200: PEs with different RTs don't import each other's routes.`;
      return meshUp(s) ? "now ping 192.168.100.3 from CE1." : "all three use 65000:200, but not every pseudowire is up.";
    },
  },
];
