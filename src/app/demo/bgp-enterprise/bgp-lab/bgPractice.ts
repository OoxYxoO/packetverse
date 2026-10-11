import { BG_SESSIONS, HOST_IP, LAN, SESSIONS, advKey, isRouter, type BgDev, type BgNet, type BgRouter } from "@/lib/sim-engine/scenarios/bgpNet";

/**
 * Hands-on challenges of the BGP Lab — each checked against the network itself (its runs, its sessions, its paths and
 * announcements), never against what was clicked or typed.
 */
export interface BgChallenge {
  id: string;
  title: string;
  how: string;
  done: (s: BgNet) => boolean;
  /** What is still missing, from the network's own state — shown while the challenge is open and something was tried. */
  next: (s: BgNet) => string;
}
const fresh = (s: BgNet, from: string, to: string, pred: (path: BgDev[]) => boolean) => s.runs.some((r) => r.kind === "traffic" && r.cfgSeq === s.cfgSeq && r.results.some((x) => x.replied && x.send.from === from && x.send.to === to && pred(x.path.filter(isRouter))));
const allUp = (s: BgNet) => BG_SESSIONS.every((x) => s.cfg.links[SESSIONS[x].link] && s.view.sess[x].state === "Established");
const own = (p: string) => p.startsWith("192.0.2.");
const TO_ISP: [BgRouter, BgRouter][] = [
  ["R1", "R3"],
  ["R2", "R4"],
];
export const BG_CHALLENGES: BgChallenge[] = [
  {
    id: "update",
    title: "Read an UPDATE",
    how: "Show the UPDATEs and open a capture on R1: find the prefix, the AS_PATH and the NEXT_HOP ISP-A sent for 203.0.113.0/24.",
    done: (s) => s.captures.some((c) => c.pkt.kind === "update" && c.point === "R1" && c.dir === "in" && c.pkt.upd?.prefixes[0] === LAN.R5.prefix),
    next: () => "Press “Show the UPDATEs ▶”, then open R1's capture and find the UPDATE that arrived from ISP-A for 203.0.113.0/24.",
  },
  {
    id: "flip",
    title: "Make ISP-B the primary exit — without cutting anything",
    how: "Change policies only (every session Established) so that a traceroute from H1 to SRV leaves through R2 and ISP-B.",
    done: (s) => allUp(s) && fresh(s, "H1", HOST_IP.SRV, (p) => p.includes("R4") && !p.includes("R3")),
    next: (s) => {
      if (!allUp(s)) return "Every session must stay Established: change policies only.";
      const best = s.view.paths.R1.find((p) => p.prefix === LAN.R5.prefix && p.best);
      if (best?.from === "R3" || best?.sess === "R1-R3") return "R1 still prefers its own ISP-A path. Which attribute does R1 compare first, and which policy sets it?";
      return "R1's best path now points to R2. Trace from H1 to SRV after your last change.";
    },
  },
  {
    id: "failover",
    title: "Lose ISP-A without losing the internet",
    how: "Cut the R1–R3 link, then show that H1 still reaches SRV — and through which routers.",
    done: (s) => !s.cfg.links.L13 && fresh(s, "H1", HOST_IP.SRV, () => true),
    next: (s) => (s.cfg.links.L13 ? "Cut the R1–R3 link first." : s.view.sess["R2-R4"].state !== "Established" ? "ISP-A is cut, and the backup session R2–ISP-B isn't up either. Why?" : "ISP-A is cut. Now trace from H1 to SRV: which routers does it cross?"),
  },
  {
    id: "inbound",
    title: "Bring the internet's traffic in through ISP-B",
    how: "Without touching R3–R5, make AS65030 prefer ISP-B to reach H1's LAN, and prove it with a traceroute from SRV to H1.",
    done: (s) => allUp(s) && s.view.paths.R5.find((p) => p.prefix === LAN.R1.prefix && p.best)?.from === "R4" && fresh(s, "SRV", HOST_IP.H1, (p) => p.includes("R4")),
    next: (s) => {
      if (!allUp(s)) return "Keep every session Established.";
      const best = s.view.paths.R5.find((p) => p.prefix === LAN.R1.prefix && p.best);
      if (best?.from !== "R4") return "AS65030 still reaches H1's LAN through ISP-A. You can't change its choice directly, only what you announce: make the ISP-A path look worse, or the ISP-B path better.";
      return "AS65030 now prefers ISP-B. Prove it: trace from SRV to H1 after your last change.";
    },
  },
  {
    id: "leak",
    title: "Cause a leak, catch it, stop it",
    how: "Let an enterprise router announce a route that isn't ours to its ISP and catch it in the UPDATEs; then restore the filter and show the UPDATEs again.",
    done: (s) => s.captures.some((c) => c.pkt.kind === "update" && ((c.pkt.src === "R1" && c.pkt.dst === "R3") || (c.pkt.src === "R2" && c.pkt.dst === "R4")) && !own(c.pkt.upd!.prefixes[0])) && TO_ISP.every(([f, t]) => (s.view.adv[advKey(f, t)] ?? []).length > 0 && (s.view.adv[advKey(f, t)] ?? []).every((p) => own(p.prefix))) && s.runs.some((r) => r.kind === "updates" && r.cfgSeq === s.cfgSeq),
    next: (s) => {
      const caught = s.captures.some((c) => c.pkt.kind === "update" && ((c.pkt.src === "R1" && c.pkt.dst === "R3") || (c.pkt.src === "R2" && c.pkt.dst === "R4")) && !own(c.pkt.upd!.prefixes[0]));
      if (!caught) return "Remove an outbound filter toward an ISP, then press “Show the UPDATEs ▶” and catch the foreign prefix in the capture.";
      if (!TO_ISP.every(([f, t]) => (s.view.adv[advKey(f, t)] ?? []).every((p) => own(p.prefix)))) return "You caught the leak. Now put the filter back.";
      return "The filter is back. Show the UPDATEs again to prove only our prefixes go out.";
    },
  },
  {
    id: "notify",
    title: "Break a session on purpose — and read why",
    how: "Give one neighbor a wrong remote AS, find the NOTIFICATION in the log, then repair it until every session is Established again.",
    done: (s) => s.syslog.some((x) => x.ev === "notify") && allUp(s),
    next: (s) => (s.syslog.some((x) => x.ev === "notify") ? "You caused the NOTIFICATION. Now repair the remote AS until every session is Established." : "Give one neighbor a wrong remote AS (or peer-as), then read the log."),
  },
];
