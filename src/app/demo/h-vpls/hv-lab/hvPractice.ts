import type { SpChallenge } from "@/components/sp-lab/spKit";
import { HV_VPLS, type HvCe, type HvState } from "@/lib/sim-engine/scenarios/hvNet";

/** H-VPLS Lab challenges — checked from the pseudowires, the MAC tables and fresh customer pings. */
const fresh = (s: HvState) => s.tests.filter((t) => t.cfgSeq === s.cfgSeq);
const pinged = (s: HvState, from: HvCe, dst: string) => fresh(s).filter((t) => t.from === from && t.dst === dst).at(-1);
const allUp = (s: HvState) => s.view.pws.length === 12 && s.view.pws.every((p) => p.up);

export const HV_CHALLENGES: SpChallenge<HvState>[] = [
  {
    id: "local",
    title: "Keep it local",
    how: "Prove that MTU1 switches its own sites: clear every MAC table (Clear all MAC tables, or clear l2vpn bridge-domain bd-name HVPLS-A / clear vpls mac-table instance HVPLS-A on each device), ping 192.168.100.2 from CE1, and leave PE1 without any entry for CE2's MAC (00:22:22:22:22:22).",
    done: (s) => s.cleared !== undefined && s.tests.some((t) => t.t > s.cleared! && t.from === "CE1" && t.dst === "192.168.100.2" && t.ok) && !s.fdb.PE1.some((m) => m.mac === "00:22:22:22:22:22") && s.fdb.MTU1.some((m) => m.mac === "00:22:22:22:22:22"),
    next: (s) => (s.cleared === undefined ? "clear the MAC tables first." : s.fdb.PE1.some((m) => m.mac === "00:22:22:22:22:22") ? "PE1 knows CE2 — clear the tables again and only ping between CE1 and CE2." : "now ping 192.168.100.2 from CE1."),
  },
  {
    id: "ce5",
    title: "Connect CE5 at MTU2",
    how: "CE5 (192.168.100.5) is cabled to MTU2's ge-0/0/2 and sends VLAN 100. Add the attachment circuit to MTU2's bridge — nothing changes on any PE-rs — and prove it with a fresh ping from CE5 to 192.168.100.4.",
    done: (s) => !!pinged(s, "CE5", "192.168.100.4")?.ok,
    next: (s) => {
      const ac = s.cfg.MTU2.acs["ge-0/0/2.100"];
      if (!ac) return "MTU2 has no sub-interface for VLAN 100 on the port toward CE5.";
      if (ac.vlan !== 100) return "the sub-interface toward CE5 doesn't accept VLAN 100.";
      if (!s.cfg.MTU2.bd?.acs.includes("ge-0/0/2.100")) return "the sub-interface isn't in MTU2's bridge domain / VPLS instance.";
      return "now ping 192.168.100.4 from CE5.";
    },
  },
  {
    id: "flood",
    title: "Flood once, then learn",
    how: "Show the hierarchy learning: ping 192.168.100.4 from CE1 twice in a row with nothing in between. The first ping must have flooded, the second must be unicast only. (Clear the MAC tables first if they already know CE4.)",
    done: (s) => {
      const t = s.tests;
      for (let i = 1; i < t.length; i++) if (t[i - 1].from === "CE1" && t[i - 1].dst === "192.168.100.4" && t[i - 1].ok && t[i - 1].flooded && t[i].from === "CE1" && t[i].dst === "192.168.100.4" && t[i].ok && !t[i].flooded) return true;
      return false;
    },
    next: (s) => {
      const t = s.tests.at(-1);
      if (!t) return "ping 192.168.100.4 from CE1.";
      if (t.from === "CE1" && t.dst === "192.168.100.4" && t.ok && t.flooded) return "now ping it again: the second time should be unicast.";
      if (t.from === "CE1" && t.dst === "192.168.100.4" && t.ok) return "that ping was already unicast — clear the tables, then ping twice.";
      return "two pings from CE1 to 192.168.100.4, back to back.";
    },
  },
  {
    id: "jumbo",
    title: "Jumbo frames, both tiers",
    how: "The customer wants 9000-byte frames. Raise the signaled MTU to 9000 on all six VPLS devices (IOS XR: mtu 9000 in the bridge domain; Junos: protocols vpls mtu 9000) and prove the hierarchy with a fresh ping from CE1 to 192.168.100.4.",
    done: (s) => HV_VPLS.every((r) => s.cfg[r].bd?.mtu === 9000) && allUp(s) && !!pinged(s, "CE1", "192.168.100.4")?.ok,
    next: (s) => {
      const n = HV_VPLS.filter((r) => s.cfg[r].bd?.mtu === 9000).length;
      if (!n) return "no device signals MTU 9000 yet.";
      if (n < 6) return `${n} of 6 devices signal 9000: every pseudowire between different MTUs stays down until both ends agree.`;
      return allUp(s) ? "now ping 192.168.100.4 from CE1." : "all six signal 9000, but not every pseudowire is up.";
    },
  },
  {
    id: "rebuild",
    title: "Rebuild MTU3",
    how: "Press “Wipe MTU3's service” (below): MTU3 loses its bridge domain / instance, its spoke and its sub-interface. Build it again — VLAN 100 toward CE4, one pseudowire (PW ID / VPLS ID 100) to its hub 3.3.3.3 — and prove it with a fresh ping from CE1 to 192.168.100.4. You touch MTU3 only.",
    done: (s) => !!s.wiped && allUp(s) && !!pinged(s, "CE1", "192.168.100.4")?.ok,
    next: (s) => {
      if (!s.wiped) return "wipe MTU3's service first.";
      const bd = s.cfg.MTU3.bd;
      if (!bd) return "MTU3 has no bridge domain / VPLS instance.";
      if (!s.cfg.MTU3.acs["ge-0/0/1.100"] || !bd.acs.includes("ge-0/0/1.100")) return "MTU3's attachment circuit toward CE4 (VLAN 100) isn't in the bridge.";
      if (![...bd.spokes, ...bd.mesh].some((n) => n.ip === "3.3.3.3")) return "MTU3 has no pseudowire to its hub 3.3.3.3.";
      if (!allUp(s)) return "MTU3's spoke isn't up yet — check its PW ID / VPLS ID.";
      return "now ping 192.168.100.4 from CE1.";
    },
  },
];
