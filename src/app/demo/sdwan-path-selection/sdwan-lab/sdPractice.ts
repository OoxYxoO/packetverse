import type { SdNet } from "@/lib/sim-engine/scenarios/sdNet";

/**
 * Hands-on challenges of the SD-WAN Lab — each checked against the network itself (its runs, path states, counters
 * and configuration), never against what was clicked or typed.
 */
export interface SdChallenge {
  id: string;
  title: string;
  how: string;
  done: (s: SdNet) => boolean;
  /** What is still missing, from the network's own state — shown while the challenge is open and something was tried. */
  next: (s: SdNet) => string;
}
const ran = (s: SdNet, pred: (r: SdNet["runs"][number]) => boolean) => s.runs.some(pred);
export const SD_CHALLENGES: SdChallenge[] = [
  {
    id: "split",
    title: "Two applications, two paths",
    how: "Show a call and the backup leaving the branch at the same time on different tunnels.",
    done: (s) => ran(s, (r) => r.kind === "traffic" && r.results.some((x) => x.kind === "VOICE" && x.delivered) && r.results.some((x) => x.kind === "BULK" && x.delivered) && new Set(r.results.filter((x) => x.delivered).map((x) => x.tun)).size === 2),
    next: (s) => {
      const both = [...s.runs].reverse().find((r) => r.kind === "traffic" && r.results.some((x) => x.kind === "VOICE") && r.results.some((x) => x.kind === "BULK"));
      if (!both) return "Send a call and the backup at the same moment (Call + backup together), with both tunnels up.";
      const ways = [...new Set(both.results.filter((x) => x.delivered).map((x) => x.tun))];
      return ways.length === 1 ? `Both left on ${ways[0]}. Check each application's preference: VOICE prefers TUN-A, BULK prefers TUN-B.` : "Not both were delivered. Make sure both tunnels are up, measure, then send both again.";
    },
  },
  {
    id: "brown",
    title: "Catch a brownout",
    how: "Degrade ISP-A, let the edge measure it, and show TUN-A reachable but failing the voice SLA.",
    done: (s) => s.paths["TUN-A"].quality === "brownout" && s.paths["TUN-A"].sla === "FAIL",
    next: (s) => (s.paths["TUN-A"].quality !== "brownout" ? "Set ISP-A to brownout first." : "ISP-A is browned out, but TUN-A still passes: measure an interval, and check that the voice SLA class isn't too loose to catch it."),
  },
  {
    id: "failover",
    title: "Fail voice over — and back",
    how: "Make voice move to TUN-B because TUN-A fails its SLA, then bring TUN-A back and show voice returning to it after the recovery intervals.",
    done: (s) => ran(s, (r) => r.kind === "traffic" && r.results.some((x) => x.kind === "VOICE" && x.tun === "TUN-B" && !x.fallback)) && s.events.some((e) => /eligible again/.test(e.text)) && s.runs.at(-1)?.kind === "traffic" && s.runs.at(-1)!.results.some((x) => x.kind === "VOICE" && x.tun === "TUN-A"),
    next: (s) => {
      if (!ran(s, (r) => r.kind === "traffic" && r.results.some((x) => x.kind === "VOICE" && x.tun === "TUN-B" && !x.fallback))) return "First brown out ISP-A, measure, and place a call: it should leave on TUN-B.";
      if (!s.events.some((e) => /eligible again/.test(e.text))) return "Voice moved to TUN-B. Now set ISP-A back to healthy and measure until TUN-A is eligible again.";
      return "TUN-A is eligible again. Place a call now and show it back on TUN-A.";
    },
  },
  {
    id: "faster",
    title: "Recover faster",
    how: "Change the recovery to one interval and show voice returning to TUN-A after a single good interval.",
    done: (s) => s.cfg.hold === 1 && s.events.some((e) => /SLA met for 1 interval —/.test(e.text)),
    next: (s) => (s.cfg.hold !== 1 ? `Recovery takes ${s.cfg.hold} intervals. Make it one (Cisco: bfd app-route multiplier 1 on the edge · Junos: switch-idle-time 10).` : "Recovery is one interval. Now brown out ISP-A, measure, set it healthy again and measure once."),
  },
  {
    id: "budget",
    title: "Keep backups off the business line",
    how: "Make the backup use only TUN-B, then show it dropped when ISP-B is down — and decide whether that is what you want.",
    done: (s) => s.cfg.pref.BULK.join() === "TUN-B" && ran(s, (r) => r.kind === "traffic" && r.results.some((x) => x.kind === "BULK" && !x.delivered)),
    next: (s) => (s.cfg.pref.BULK.join() !== "TUN-B" ? `The backup may use ${s.cfg.pref.BULK.join(" > ")}. Leave it only TUN-B (Cisco: remove BULK-PREF's secondary preference · Junos: delete RI-BULK's qualified next hop st0.1).` : "The backup uses only TUN-B. Now take ISP-B down, measure, and run the backup."),
  },
  {
    id: "bad",
    title: "Survive a bad day",
    how: "With both ISPs browned out, show a call still connecting through the best path.",
    done: (s) => s.paths["TUN-A"].quality === "brownout" && s.paths["TUN-B"].quality === "brownout" && ran(s, (r) => r.kind === "traffic" && r.results.some((x) => x.kind === "VOICE" && x.delivered && x.fallback)),
    next: (s) => (s.paths["TUN-A"].quality !== "brownout" || s.paths["TUN-B"].quality !== "brownout" ? "Brown out both ISPs first, then measure." : "Both ISPs are browned out. Measure, then place a call: it must connect through the best path. If it is dropped, check what voice does when no path meets the SLA."),
  },
];
