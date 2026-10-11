import { HOST_IP, PUBLIC, fwPolicy, type FwNet } from "@/lib/sim-engine/scenarios/fwNet";

/**
 * Hands-on challenges of the Firewall Lab — each checked against the network itself (its runs, sessions, logs and
 * configuration), never against what was clicked or typed.
 */
export interface FwChallenge {
  id: string;
  title: string;
  how: string;
  done: (s: FwNet) => boolean;
  /** What is still missing, from the network's own state — shown while the challenge is open and something was tried. */
  next: (s: FwNet) => string;
}
const fresh = (s: FwNet, from: string, to: string, port: number | "ping", outcome: (o: string) => boolean) => s.runs.some((r) => r.cfgSeq === s.cfgSeq && r.results.some((x) => x.send.from === from && x.send.to === to && (port === "ping" ? x.send.kind === "ping" : x.send.kind === "connect" && (x.send.port ?? 443) === port) && outcome(x.outcome)));
export const FW_CHALLENGES: FwChallenge[] = [
  {
    id: "nat",
    title: "See source NAT on both sides of FW1",
    how: "Open a connection from the office, then find the same SYN in the captures of FW1's trust and untrust interfaces — private source on one, public on the other.",
    done: (s) => s.captures.some((a) => a.point === "FW1 trust" && a.pkt.flags === "SYN" && a.pkt.src.startsWith("10.10.10.") && s.captures.some((b) => b.point === "FW1 untrust" && b.run === a.run && b.pkt.flags === "SYN" && b.pkt.src === PUBLIC && b.pkt.dst === a.pkt.dst)),
    next: (s) => (s.runs.some((r) => r.results.some((x) => x.send.from === "CLIENT" || x.send.from === "LAB")) ? "Open FW1's captures on trust and on untrust for that run, and compare the SYN's source on each side." : "Open a connection from the office first (CLIENT → WEB, HTTPS)."),
  },
  {
    id: "stateful",
    title: "Prove the firewall is stateful",
    how: "Show a reply admitted by a session (an ESTABLISHED session) and a stray segment from the internet dropped because it matches none.",
    done: (s) => s.sessions.some((x) => x.state === "ESTABLISHED") && s.fwlog.some((l) => l.kind === "nosession"),
    next: (s) => (!s.sessions.some((x) => x.state === "ESTABLISHED") ? "First complete a connection, so a session reaches ESTABLISHED (CLIENT → WEB, HTTPS)." : "You have an ESTABLISHED session. Now send a stray segment from the internet (OUT's shell: sudo hping3 -A -c 1 -p 443 198.51.100.2) and find its drop in the log."),
  },
  {
    id: "nohttp",
    title: "Allow HTTPS out, but no more plain HTTP",
    how: "Change the policy so the office can still open HTTPS to WEB but HTTP (80) is denied — prove both with fresh traffic from CLIENT.",
    done: (s) => fresh(s, "CLIENT", HOST_IP.WEB, 443, (o) => o === "established") && fresh(s, "CLIENT", HOST_IP.WEB, 80, (o) => o === "timeout"),
    next: (s) => {
      const ok443 = fresh(s, "CLIENT", HOST_IP.WEB, 443, (o) => o === "established");
      const no80 = fresh(s, "CLIENT", HOST_IP.WEB, 80, (o) => o === "timeout");
      if (fresh(s, "CLIENT", HOST_IP.WEB, 80, (o) => o === "established")) return "HTTP (80) from CLIENT still works. Change the rule that allows it, then test HTTPS and HTTP again.";
      if (ok443 && !no80) return "HTTPS works. Now prove HTTP (80) from CLIENT is denied, after your last change.";
      if (!ok443 && no80) return "HTTP is denied. Now prove HTTPS from CLIENT still works, after your last change.";
      return "Change the policy (the rule that allows HTTP), then test both HTTPS and HTTP from CLIENT to WEB.";
    },
  },
  {
    id: "lock",
    title: "Keep the office away from the DMZ — not the internet",
    how: "Stop CLIENT from reaching the DMZ server directly (172.16.0.10), while OUT still reaches it through 198.51.100.2 — both proven with fresh traffic.",
    done: (s) => fresh(s, "CLIENT", HOST_IP.DMZ, 443, (o) => o !== "established") && fresh(s, "OUT", PUBLIC, 443, (o) => o === "established"),
    next: (s) => {
      const blocked = fresh(s, "CLIENT", HOST_IP.DMZ, 443, (o) => o !== "established");
      const pub = fresh(s, "OUT", PUBLIC, 443, (o) => o === "established");
      if (blocked && !pub) return "CLIENT is kept away. Now prove OUT still reaches the server through 198.51.100.2, after your last change.";
      if (!blocked && pub) return "OUT reaches the server. Now prove CLIENT can't reach 172.16.0.10 directly, after your last change.";
      return "Change the trust → dmz policy, then test CLIENT → 172.16.0.10 and OUT → 198.51.100.2 (both HTTPS).";
    },
  },
  {
    id: "lab",
    title: "Let the lab PCs browse HTTPS only",
    how: "Without opening anything else for them, make LAB reach WEB over HTTPS — LAB's SSH and HTTP to WEB must stay denied by policy.",
    done: (s) => fresh(s, "LAB", HOST_IP.WEB, 443, (o) => o === "established") && fwPolicy(s.cfg, "trust", "untrust", HOST_IP.LAB, HOST_IP.WEB, "tcp", 22).action === "deny" && fwPolicy(s.cfg, "trust", "untrust", HOST_IP.LAB, HOST_IP.WEB, "tcp", 80).action === "deny",
    next: (s) => {
      if (fwPolicy(s.cfg, "trust", "untrust", HOST_IP.LAB, HOST_IP.WEB, "tcp", 22).action !== "deny" || fwPolicy(s.cfg, "trust", "untrust", HOST_IP.LAB, HOST_IP.WEB, "tcp", 80).action !== "deny") return "Too much is open for LAB now: SSH (22) and HTTP (80) to WEB must stay denied. Allow HTTPS only.";
      return fwPolicy(s.cfg, "trust", "untrust", HOST_IP.LAB, HOST_IP.WEB, "tcp", 443).action === "permit" ? "The policy allows LAB HTTPS only. Prove it: LAB opens HTTPS to WEB, after your last change." : "BLOCK-LAB still catches LAB's HTTPS. Add a rule for LAB's HTTPS above it.";
    },
  },
  {
    id: "default",
    title: "Catch the default deny in the log",
    how: "Send something no rule allows from the internet to our public address and find its deny entry in FW1's log.",
    done: (s) => s.fwlog.some((l) => l.kind === "deny" && l.from === "untrust"),
    next: (s) => (s.fwlog.some((l) => l.kind === "deny") ? "A deny was logged, but not from the internet. Send something from OUT that no rule allows (for example SSH to 198.51.100.2)." : "From OUT, try something no rule allows on 198.51.100.2 (for example ssh 198.51.100.2), then read FW1's log."),
  },
];
