import { HOST_PORT, SPARE, ST_LINKS, ST_SWITCHES, pk, type StState } from "@/lib/sim-engine/scenarios/stpNet";

/**
 * Hands-on challenges of the STP Lab's engineering workspace. Each is checked against the network itself — its runs,
 * its log, its computed tree — never against what was typed or clicked.
 */

export interface StChallenge {
  id: string;
  title: string;
  how: string;
  done: (s: StState) => boolean;
  /** What is still missing, from the network's own state — shown while the challenge is open and something was tried. */
  next: (s: StState) => string;
}
const guarded = (s: StState) => s.cfg.sw.SW3.ports[SPARE].bpduGuard || s.cfg.sw.SW3.ports[SPARE].rootGuard;
const helloNow = (s: StState) => s.runs.some((r) => r.kind === "hello" && r.cfgSeq === s.cfgSeq);
const lastEv = (s: StState, f: (l: StState["syslog"][number]) => boolean) => [...s.syslog].reverse().find(f)?.clock;

export const ST_CHALLENGES: StChallenge[] = [
  {
    id: "root",
    title: "Make SW2 the root bridge — and prove it from the BPDUs",
    how: "Change bridge priorities (window, or spanning-tree vlan 1 priority / set protocols rstp bridge-priority), then send a Hello: every BPDU must name SW2 as root.",
    done: (s) => s.tree.bridges.SW1?.root === "SW2" && s.runs.some((r) => r.kind === "hello" && r.cfgSeq === s.cfgSeq && r.waves[0]?.hops.every((h) => !h.frame.bpdu || h.frame.bpdu.root.mac === "00:00:5E:00:53:02")),
    next: (s) => {
      const r = s.tree.bridges.SW1?.root;
      if (r !== "SW2") return `Every switch still names ${r ?? "no switch"} as root. Give SW2 the lowest priority (lower than SW1's 24576).`;
      return helloNow(s) ? "A Hello ran, but not every BPDU named SW2. Look at the Hello's BPDUs in the Journey." : "SW2 should be root now. Send a Hello after your last change and read the root in its BPDUs.";
    },
  },
  {
    id: "move-alt",
    title: "Move the blocked port to the SW1–SW3 link, without moving the root",
    how: "With SW1 still root and all three links up, make SW3 ge-0/0/1 the Alternate port (think: which switch's which port cost decides SW3's Root Port?).",
    done: (s) => s.tree.bridges.SW1?.root === "SW1" && ST_LINKS.every((l) => s.cfg.links[l]) && s.tree.ports[pk("SW3", "ge-0/0/1")]?.role === "Alternate",
    next: (s) => {
      if (s.tree.bridges.SW1?.root !== "SW1") return "The root moved. Keep SW1 as root: put the priorities back.";
      if (!ST_LINKS.every((l) => s.cfg.links[l])) return "All three links must be up. Plug the unplugged cable back.";
      return "SW1 is root and every link is up, but SW3 ge-0/0/1 isn't Alternate yet. The cost counts on the port where the BPDU arrives: which of SW3's ports must cost more?";
    },
  },
  {
    id: "alt-drop",
    title: "Catch an Alternate port discarding data",
    how: "Send a broadcast and find, in the journey or a capture, the frame arriving on the Alternate port and being discarded there.",
    done: (s) => s.runs.some((r) => r.kind === "traffic" && r.waves.some((w) => w.decisions.some((d) => d.drop && /Alternate/.test(d.drop)))),
    next: (s) => (s.runs.some((r) => r.kind === "traffic") ? "No frame was dropped on an Alternate port yet. Send a broadcast (an ARP request) while one port is Alternate, and look for the drop in the Journey." : "Send a broadcast: Generate traffic → broadcasts an ARP request."),
  },
  {
    id: "failover",
    title: "Fail a link and lose nothing",
    how: "Unplug an inter-switch link that carries traffic, then ping across at once (within 2 s): the ping must work with RSTP doing the repair.",
    done: (s) => {
      const down = lastEv(s, (l) => l.ev === "down" && (l.port === "ge-0/0/1" || l.port === "ge-0/0/2"));
      return down !== undefined && s.runs.some((r) => r.kind === "traffic" && r.clock >= down && r.clock - down <= 2 && r.results.length > 0 && r.results.every((x) => x.replied) && !ST_LINKS.every((l) => s.cfg.links[l]));
    },
    next: (s) => {
      if (ST_LINKS.every((l) => s.cfg.links[l])) return "Unplug an inter-switch link that carries traffic (SW1↔SW2 or SW1↔SW3) first.";
      return "A link is down. Now ping across within 2 s of unplugging it: the ping must work while RSTP repairs the tree.";
    },
  },
  {
    id: "edge",
    title: "Find the 30-second gap — then close it",
    how: "Turn edge off on a host port, reseat that host and show its ping fails right away; then make the port edge again, reseat, and show the ping works at once.",
    done: (s) => {
      const failed = s.runs.some((r) => r.results.some((x) => /isn't forwarding yet|isn't forwarding/.test(x.fail ?? "") || (!x.replied && r.waves.some((w) => w.decisions.some((d) => d.port === HOST_PORT && d.drop)))));
      const up = lastEv(s, (l) => l.ev === "up" && l.port === HOST_PORT);
      const last = s.last;
      return failed && up !== undefined && !!last && last.kind === "traffic" && last.clock - up <= 2 && last.results.every((x) => x.replied) && ["SW1", "SW2", "SW3"].every((sw) => s.cfg.sw[sw as "SW1"].ports[HOST_PORT].edge);
    },
    next: (s) => {
      const failed = s.runs.some((r) => r.results.some((x) => /isn't forwarding/.test(x.fail ?? "")));
      if (!failed) return "First show the gap: turn edge off on a host port, reseat that host, and ping at once. The ping should fail.";
      const off = ST_SWITCHES.filter((sw) => !s.cfg.sw[sw].ports[HOST_PORT].edge);
      if (off.length) return `You showed the gap. Now make ${off.map((sw) => `${sw} ge-0/0/10`).join(", ")} an edge port again, reseat the host, and ping at once.`;
      return "Every host port is edge again. Reseat the host, then ping within 2 s.";
    },
  },
  {
    id: "rogue",
    title: "Let the small switch in — and keep SW1 as root",
    how: "Plug the small switch into SW3 ge-0/0/11 and protect that port so SW1 stays root (BPDU guard or root guard). Prove it with a Hello.",
    done: (s) => s.cfg.rogue && guarded(s) && s.tree.bridges.SW1?.root === "SW1" && helloNow(s),
    next: (s) => {
      if (!s.cfg.rogue) return "Plug the small switch into SW3 ge-0/0/11 first.";
      if (!guarded(s)) return s.tree.bridges.SW1?.root === "SW1" ? "SW1 is root, but SW3 ge-0/0/11 isn't protected: a priority race isn't a protection. Add BPDU guard or root guard on that port." : "The small switch is root now. Protect SW3 ge-0/0/11 with BPDU guard or root guard.";
      if (s.tree.bridges.SW1?.root !== "SW1") return "The port is protected, but SW1 isn't root. Check the priorities.";
      return "Protected, and SW1 is root. Send a Hello to prove it.";
    },
  },
];
