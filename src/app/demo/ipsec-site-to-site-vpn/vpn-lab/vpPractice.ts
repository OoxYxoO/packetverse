import { HOST_IP, type VpNet } from "@/lib/sim-engine/scenarios/vpnNet";

/**
 * Hands-on challenges of the VPN Lab — each checked against the network itself (its runs, captures, SAs and
 * configuration), never against what was clicked or typed.
 */
export interface VpChallenge {
  id: string;
  title: string;
  how: string;
  done: (s: VpNet) => boolean;
  /** What is still missing, from the network's own state — shown while the challenge is open and something was tried. */
  next: (s: VpNet) => string;
}
const freshPing = (s: VpNet, from: string, to: string, pred: (r: VpNet["runs"][number]["results"][number]) => boolean) => s.runs.some((r) => r.kind === "traffic" && r.cfgSeq === s.cfgSeq && r.results.some((x) => x.send.from === from && x.send.to === to && pred(x)));
export const VP_CHALLENGES: VpChallenge[] = [
  {
    id: "esp",
    title: "Find both SPIs on the wire",
    how: "Ping from HOST-A to HOST-B and find, in the INTERNET capture, the ESP packets of both directions — with their two different SPIs.",
    done: (s) => { const spis = new Set(s.captures.filter((c) => c.point === "INTERNET" && c.pkt.kind === "esp").map((c) => c.pkt.spi)); return spis.size >= 2; },
    next: (s) => (s.captures.some((c) => c.point === "INTERNET" && c.pkt.kind === "esp") ? "Only one direction is on the wire so far. The reply must come back through the tunnel too: ping again with the tunnel up, and look for the second SPI." : "No ESP on the internet yet. Bring the tunnel up, ping from HOST-A to HOST-B, then open the INTERNET capture."),
  },
  {
    id: "ike",
    title: "Read an IKE_AUTH exchange",
    how: "Show the IKE negotiation and capture it on a gateway's WAN side: find IKE_AUTH with its traffic selectors.",
    done: (s) => s.captures.some((c) => c.pkt.kind === "ike" && c.pkt.ike?.ex === "IKE_AUTH" && / TSi /.test(c.pkt.ike.carries)),
    next: (s) => (s.captures.some((c) => c.pkt.kind === "ike" && c.pkt.ike?.ex === "IKE_AUTH") ? "IKE_AUTH was captured, but without its traffic selectors: run the full negotiation again." : s.captures.some((c) => c.pkt.kind === "ike") ? "IKE stopped before IKE_AUTH: fix the tunnel (peer, proposal), then negotiate again." : "Run the IKE negotiation, then open a gateway's WAN capture and find IKE_AUTH."),
  },
  {
    id: "split",
    title: "Prove split tunneling",
    how: "With the same configuration, show HOST-A reaching HOST-B through the tunnel and WEB in the clear.",
    done: (s) => freshPing(s, "HOST-A", HOST_IP["HOST-B"], (x) => x.replied && x.encrypted) && freshPing(s, "HOST-A", HOST_IP.WEB, (x) => x.replied && !x.encrypted),
    next: (s) => {
      const vpn = freshPing(s, "HOST-A", HOST_IP["HOST-B"], (x) => x.replied && x.encrypted);
      const web = freshPing(s, "HOST-A", HOST_IP.WEB, (x) => x.replied && !x.encrypted);
      if (vpn && !web) return "HOST-B is reached through the tunnel. Now ping WEB (192.0.2.80) from HOST-A, with the same configuration.";
      if (!vpn && web) return "WEB is reached in the clear. Now ping HOST-B from HOST-A through the tunnel, with the same configuration.";
      return "Ping HOST-B and WEB from HOST-A, after your last change, and compare which one is encrypted.";
    },
  },
  {
    id: "harden",
    title: "Change the IKE proposal on both ends",
    how: "Move both gateways to the other IKE proposal (AES-CBC-128 / group 14) and prove HOST-A reaches HOST-B through the tunnel again. (In between, the tunnel is down: that is why real changes are planned.)",
    done: (s) => s.cfg.gw["GW-A"].ike === "aes128-sha1-g14" && s.cfg.gw["GW-B"].ike === "aes128-sha1-g14" && freshPing(s, "HOST-A", HOST_IP["HOST-B"], (x) => x.replied && x.encrypted),
    next: (s) => {
      const old = (["GW-A", "GW-B"] as const).filter((g) => s.cfg.gw[g].ike !== "aes128-sha1-g14");
      if (old.length) return `${old.join(" and ")} still ${old.length > 1 ? "offer" : "offers"} the old proposal (AES-GCM-256 / group 19). Move ${old.length > 1 ? "both" : "it"} to AES-CBC-128 / group 14.`;
      return "Both gateways use the new proposal. Now prove it: ping HOST-B from HOST-A through the tunnel.";
    },
  },
  {
    id: "broad",
    title: "Let GW-B accept all of 10.10.0.0/16",
    how: "Widen GW-B's remote selector to 10.10.0.0/16 (GW-A keeps proposing 10.10.10.0/24) and show the tunnel still carries HOST-A's ping.",
    done: (s) => s.cfg.gw["GW-B"].remote === "10.10.0.0/16" && freshPing(s, "HOST-A", HOST_IP["HOST-B"], (x) => x.replied && x.encrypted),
    next: (s) => (s.cfg.gw["GW-B"].remote !== "10.10.0.0/16" ? `GW-B's remote selector is ${s.cfg.gw["GW-B"].remote}. Widen it to 10.10.0.0/16 and leave GW-A as it is.` : "GW-B accepts 10.10.0.0/16. Now prove the tunnel still carries HOST-A's ping to HOST-B."),
  },
  {
    id: "dpd",
    title: "Survive a peer outage",
    how: "Cut GW-B's internet link, show Site B unreachable, restore it and show the tunnel back — with new SPIs.",
    done: (s) => s.runs.some((r) => r.kind === "traffic" && r.results.some((x) => x.send.to === HOST_IP["HOST-B"] && !x.replied && /no IPsec SA/.test(x.fail ?? ""))) && s.cfg.wanB && freshPing(s, "HOST-A", HOST_IP["HOST-B"], (x) => x.replied && x.encrypted) && s.sa.gen > 1,
    next: (s) => {
      const down = s.runs.some((r) => r.kind === "traffic" && r.results.some((x) => x.send.to === HOST_IP["HOST-B"] && !x.replied && /no IPsec SA/.test(x.fail ?? "")));
      if (!down) return "First cut GW-B's internet link and ping HOST-B from HOST-A: show that Site B is unreachable.";
      if (!s.cfg.wanB) return "Site B is unreachable. Now restore GW-B's internet link.";
      return "The link is back. Ping HOST-B from HOST-A again and check the tunnel carries it, with new SPIs.";
    },
  },
];
