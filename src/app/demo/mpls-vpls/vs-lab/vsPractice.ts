import type { SpChallenge } from "@/components/sp-lab/spKit";
import { VS_PES, type VsCe, type VsState } from "@/lib/sim-engine/scenarios/vsNet";

/** VPLS Lab challenges — checked from the pseudowires, the MAC tables and fresh customer pings. */
const fresh = (s: VsState) => s.tests.filter((t) => t.cfgSeq === s.cfgSeq);
const pinged = (s: VsState, from: VsCe, dst: string) => fresh(s).filter((t) => t.from === from && t.dst === dst).at(-1);
const meshUp = (s: VsState) => s.view.pws.length === 6 && s.view.pws.every((p) => p.up);

export const VS_CHALLENGES: SpChallenge<VsState>[] = [
  {
    id: "flood",
    title: "Flood once, then learn",
    how: "Show the bridge learning: ping 192.168.100.3 from CE1 twice in a row with nothing in between. The first ping must have flooded (empty tables or cache), the second must be unicast only. (If the tables already know CE3, clear them first: clear l2vpn bridge-domain bd-name VPLS-A / clear vpls mac-table instance VPLS-A on PE1.)",
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
    how: "CE4 (192.168.100.4) is cabled to PE2's second port and sends VLAN 100 — but the port isn't part of the service. Add an attachment circuit for VLAN 100 on that port to PE2's bridge domain / VPLS instance and prove it with a fresh ping from CE4 to 192.168.100.1.",
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
    id: "relearn",
    title: "Clear the tables, watch them refill",
    how: "Clear the MAC table on PE1 (IOS XR: clear l2vpn bridge-domain bd-name VPLS-A; Junos: clear vpls mac-table instance VPLS-A), then ping 192.168.100.2 from CE1. Unknown again, the first frames must flood — and PE1 must have relearned CE2 behind PE2.",
    done: (s) => s.cleared !== undefined && s.tests.some((t) => t.t > s.cleared! && t.from === "CE1" && t.dst === "192.168.100.2" && t.ok && t.flooded) && s.fdb.PE1.some((m) => m.mac === "00:22:22:22:22:22" && m.port === "pw:2.2.2.2"),
    next: (s) => (s.cleared === undefined ? "clear PE1's MAC table first." : "now ping 192.168.100.2 from CE1."),
  },
  {
    id: "jumbo",
    title: "Jumbo frames for the whole VPLS",
    how: "The customer wants 9000-byte frames everywhere. Raise the VPLS MTU to 9000 on all three PEs (IOS XR: mtu 9000 in the bridge domain; Junos: protocols vpls mtu 9000) and prove the mesh with a fresh ping from CE1 to 192.168.100.3.",
    done: (s) => VS_PES.every((pe) => s.cfg[pe].bd?.mtu === 9000) && meshUp(s) && !!pinged(s, "CE1", "192.168.100.3")?.ok,
    next: (s) => {
      const n = VS_PES.filter((pe) => s.cfg[pe].bd?.mtu === 9000).length;
      if (!n) return "no PE signals MTU 9000 yet.";
      if (n < 3) return `${n} of 3 PEs signal 9000: the pseudowires between different MTUs stay down until all agree.`;
      return meshUp(s) ? "now ping 192.168.100.3 from CE1." : "all three signal 9000, but not every pseudowire is up.";
    },
  },
  {
    id: "rebuild",
    title: "Rebuild PE3",
    how: "Press “Wipe PE3's VPLS” (below): PE3 loses its bridge domain / instance and its sub-interface. Build it again — VLAN 100 toward CE3, VPLS ID 500, neighbors 1.1.1.1 and 2.2.2.2 — and prove the full mesh with a fresh ping from CE1 to 192.168.100.3.",
    done: (s) => !!s.wiped && meshUp(s) && !!pinged(s, "CE1", "192.168.100.3")?.ok,
    next: (s) => {
      if (!s.wiped) return "wipe PE3's VPLS first.";
      const bd = s.cfg.PE3.bd;
      if (!bd) return "PE3 has no bridge domain / VPLS instance.";
      if (!s.cfg.PE3.acs["ge-0/0/1.100"] || !bd.acs.includes("ge-0/0/1.100")) return "PE3's attachment circuit toward CE3 (VLAN 100) isn't in the VPLS.";
      if (!["1.1.1.1", "2.2.2.2"].every((ip) => bd.nbrs.some((n) => n.ip === ip))) return "PE3 must list both 1.1.1.1 and 2.2.2.2 as neighbors.";
      if (!meshUp(s)) return "not every pseudowire is up yet — check the PW ID / VPLS ID.";
      return "now ping 192.168.100.3 from CE1.";
    },
  },
];
