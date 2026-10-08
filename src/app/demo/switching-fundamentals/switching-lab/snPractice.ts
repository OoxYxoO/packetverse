import { BCAST, SN_HOSTS, isSw, isUplink, snActiveUplinks, snCirculating, snHostLinkUp, snLookup, snPortUp, type SnHost, type SnRun, type SnState, type SnSw } from "@/lib/sim-engine/scenarios/switchNet";

/**
 * Hands-on challenges of the Switching Lab's engineering workspace. Each is checked against the network itself — the
 * runs it carried, the tables it learned, its links — never against what was typed or clicked.
 */

export interface SnChallenge {
  id: string;
  title: string;
  how: string;
  done: (s: SnState) => boolean;
}
const home: Record<SnHost, string> = { "HOST-A": "SW1 ge-0/0/1", "HOST-D": "SW1 ge-0/0/2", "HOST-B": "SW2 ge-0/0/1", "HOST-C": "SW2 ge-0/0/2", "HOST-E": "" };
const interSwitch = (r: SnRun) => r.waves.some((w) => w.hops.some((h) => isSw(h.from) && isSw(h.to)));
/** Every switch maps this host where it really is (its access port, or its uplink for the other switch). */
export function snRightEverywhere(s: SnState, h: SnHost): boolean {
  const at = s.cfg.hosts[h].at;
  if (!at) return false;
  return (["SW1", "SW2"] as SnSw[]).every((sw) => {
    const e = snLookup(s.cfg, s.fdb, sw, s.cfg.hosts[h].mac);
    return !!e && (at.sw === sw ? e.port === at.port : isUplink(e.port) && snPortUp(s.cfg, sw, e.port));
  });
}
export const SN_CHALLENGES: SnChallenge[] = [
  {
    id: "local",
    title: "Prove that local traffic stays local",
    how: "Make two hosts on the same switch exchange frames that the switch already knows how to forward: the uplink must carry nothing (check the uplink counters or a capture on ge-0/0/23).",
    done: (s) => s.runs.some((r) => !r.background && r.results.length > 0 && r.results.every((x) => x.send.to !== "broadcast" && x.delivered > 0 && s.cfg.hosts[x.send.from].at?.sw === s.cfg.hosts[x.send.to as SnHost].at?.sw) && !interSwitch(r) && r.waves.every((w) => w.decisions.every((d) => d.kind === "known"))),
  },
  {
    id: "partial",
    title: "One frame: known at one switch, unknown at the other",
    how: "Get a single unicast frame flooded by one switch and forwarded out a single port by the other. Hint: clear one table, or let only one switch hear a host.",
    done: (s) => s.runs.some((r) => r.results.some((x) => { const ds = r.waves.flatMap((w) => w.decisions).filter((d) => d.frame.id === x.frame.id && d.frame.dst !== BCAST); return ds.some((d) => d.kind === "unknown") && ds.some((d) => d.kind === "known"); })),
  },
  {
    id: "move",
    title: "Move a host — and make both switches right again without clearing anything",
    how: "Re-cable a host to another switch (its window → Network card), show that frames to it go the old way, then fix both tables using only traffic. Check the “Where is each host?” table.",
    done: (s) => SN_HOSTS.some((h) => h !== "HOST-E" && !!s.cfg.hosts[h].at && `${s.cfg.hosts[h].at!.sw} ${s.cfg.hosts[h].at!.port}` !== home[h] && snRightEverywhere(s, h)) && !s.log.some((l) => /: cleared /.test(l.text)),
  },
  {
    id: "flap",
    title: "Create a loop and catch a MAC flapping in a switch's own log",
    how: "Enable the second uplink on both switches, send one broadcast, then find the flap with show logging (Cisco) or show ethernet-switching mac-learning-log (Junos).",
    done: (s) => s.moves.some((m) => m.flap),
  },
  {
    id: "storm",
    title: "Make a storm grow",
    how: "With one loop each broadcast's copies stay constant. Find the change that makes the number of copies multiply hop after hop — and watch the link load.",
    done: (s) => s.runs.some((r) => { const per = r.waves.map((w) => w.hops.filter((h) => isSw(h.from) && isSw(h.to)).reduce((a, h) => a + h.n, 0)); return per.some((n, i) => i >= 2 && n >= 4 * (per[i - 2] || 1) && per[i - 2] > 0); }),
  },
  {
    id: "recover",
    title: "Stop the loop and prove it with traffic",
    how: "After a flap: leave one path between the switches, let nothing circulate, then send a broadcast that reaches every host exactly once without any MAC moving.",
    done: (s) => s.moves.some((m) => m.flap) && snActiveUplinks(s.cfg).length === 1 && snCirculating(s) === 0 && !!s.last && !s.last.background && s.last.results.some((x) => x.send.to === "broadcast") && s.last.flaps === 0 && !s.last.left && SN_HOSTS.filter((h) => snHostLinkUp(s.cfg, h) && h !== s.last!.results[0].send.from).every((h) => s.last!.waves.flatMap((w) => w.rx).filter((x) => x.host === h && x.frame.id === s.last!.results[0].frame.id).reduce((a, x) => a + x.n, 0) === 1),
  },
];
