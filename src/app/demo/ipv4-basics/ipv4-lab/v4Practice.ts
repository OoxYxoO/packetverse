import type { CliVendor } from "@/lib/cli/types";
import { V4_PREFIX, maskOf, networkOf } from "@/lib/sim-engine/scenarios/ipv4Basics";
import { V4_HOSTS, V4_R1, v4Entry, v4IpOwners, v4Routes, type V4Capture, type V4NetState, type V4TicketId } from "@/lib/sim-engine/scenarios/ipv4Net";
import { v4VendorText } from "./v4Cli";

/**
 * IPv4 troubleshooting and practice, judged only from the network's evidence (settings, R1's interfaces and routes,
 * caches, captures). A wrong hypothesis gets the evidence that rules it out, read from the network at that moment.
 */

const B = "192.168.10.70";
const after = (s: V4NetState, mark: number) => s.captures.filter((c) => c.no > mark);
const gotReply = (cs: V4Capture[], dev: "hosta" | "hostb" | "hostc", from: string) => cs.some((c) => c.dev === dev && c.dir === "in" && c.frame.ip?.icmp === "echo-reply" && c.frame.ip.src === from);

export type V4Cause = "a-mask" | "a-gw" | "b-gw" | "r1-if" | "r1-route" | "b-off" | "ttl" | "l2";
export const V4_CAUSES: { id: V4Cause; label: string }[] = [
  { id: "a-mask", label: "HOST-A's mask makes it think HOST-B is on its own LAN" },
  { id: "a-gw", label: "HOST-A's default gateway is an address nobody owns" },
  { id: "b-gw", label: "HOST-B can't send replies off its LAN (default gateway missing or wrong)" },
  { id: "r1-if", label: "R1's interface toward LAN B is down, so R1 has no route there" },
  { id: "r1-route", label: "R1 needs a static route to 192.168.10.64/26" },
  { id: "b-off", label: "HOST-B is not receiving anything" },
  { id: "ttl", label: "The packets' TTL runs out at R1" },
  { id: "l2", label: "A switch or ARP problem on LAN A" },
];
export const V4_TICKET_CAUSE: Record<V4TicketId, V4Cause> = { mask: "a-mask", gateway: "a-gw", return: "b-gw", r1down: "r1-if" };

export function v4CauseFeedback(s: V4NetState, cause: V4Cause, vendor: CliVendor, mark0: number): string {
  const a = s.cfg.hosta, b = s.cfg.hostb;
  const cs = after(s, mark0);
  const t = (x: string) => v4VendorText(vendor, x);
  const route64 = v4Routes(s).some((r) => r.net === "192.168.10.64");
  const bGotRequest = cs.some((c) => c.dev === "hostb" && c.dir === "in" && c.frame.ip?.icmp === "echo-request");
  switch (cause) {
    case "a-mask":
      return networkOf(B, a.prefix) === networkOf(a.ip, a.prefix)
        ? `Right: HOST-A is ${a.ip}/${a.prefix} (mask ${maskOf(a.prefix)}). ${B} AND ${maskOf(a.prefix)} = ${networkOf(B, a.prefix)}, the same as HOST-A's own network — so HOST-A decides HOST-B is LOCAL and ARPs for ${B} itself. HOST-B is on the other side of R1, nobody on LAN A owns that address, R1 doesn't answer for it (no Proxy ARP): the entry fails and HOST-A reports "Destination Host Unreachable" from its own address.`
        : `HOST-A's mask is ${maskOf(a.prefix)}: ${B} AND it = ${networkOf(B, a.prefix)}, not HOST-A's ${networkOf(a.ip, a.prefix)} — HOST-A correctly treats HOST-B as remote.`;
    case "a-gw": {
      if (!a.gw) return "HOST-A has no default gateway at all: remote pings fail immediately with “Network is unreachable” — nothing is ARPed.";
      const owners = v4IpOwners(s, a.gw);
      return owners.length
        ? t(`HOST-A's gateway is ${a.gw}, owned by ${owners.join(", ")}: an ARP for it gets answered (see HOST-A's ip neigh).`)
        : `Right: HOST-A's gateway is ${a.gw}. HOST-A correctly decides HOST-B is remote and ARPs for its gateway — but no device owns ${a.gw}, so the ARP fails and nothing leaves LAN A. HOST-C works because local traffic never uses the gateway.`;
    }
    case "b-gw":
      if (b.gw && v4IpOwners(s, b.gw).some((o) => o.startsWith("R1"))) return t(`HOST-B's default gateway is ${b.gw}, R1's own LAN B address: its replies to other networks have a way out.`);
      return bGotRequest
        ? `Right: HOST-B ${b.gw ? `uses ${b.gw}, which nobody owns, as its gateway` : "has no default gateway"} (ip route). The echo request arrives — HOST-B's capture shows it — but the reply is for ${a.ip}, a different network: remote, ${b.gw ? "and its gateway never answers ARP" : "and no gateway to send it to"}. The reply never leaves HOST-B, so HOST-A just times out.`
        : `HOST-B's gateway is missing, but that only matters once a request reaches HOST-B — and its capture shows none arriving. Look earlier in the path.`;
    case "r1-if":
      return !s.r1.ge1.up
        ? t(`Right: R1's ge-0/0/1 is administratively down. An interface that is down gives no connected route: show ip route / show route has no 192.168.10.64/26. The packet reaches R1, R1 has nowhere to send it, drops it and answers "Destination Net Unreachable" — from its LAN A address, which is why that address still answers pings.`)
        : t(`R1's ge-0/0/1 is up (show ip interface brief) and 192.168.10.64/26 is a connected route.`);
    case "r1-route":
      return route64
        ? t("R1 already has 192.168.10.64/26 as a connected route (show ip route): a static route is never needed for a network R1 is directly connected to.")
        : t("R1 has no route to 192.168.10.64/26 — but ask why: that network is directly connected to ge-0/0/1. A connected route disappears when its interface is down. A static route through a dead interface wouldn't help; bringing the interface back does.");
    case "b-off":
      return bGotRequest ? "HOST-B's capture shows the echo request arriving: HOST-B receives fine. What happens next is the question." : "Nothing reached HOST-B — but that's a symptom, not a cause. HOST-B is up and connected (its window). Find where the packet stopped: HOST-A's decision, its ARP, R1.";
    case "ttl":
      return "The pings leave with TTL 64 (Linux default) and R1 only takes 1 off: they would arrive with 63. No “time exceeded” appears in any capture.";
    case "l2":
      return "HOST-A reaches HOST-C (same switch, same LAN) without any problem, and its ARP for local addresses gets answered: LAN A's switching and ARP work. The difference is where HOST-A decides to send frames for HOST-B.";
  }
}

export interface V4Proof {
  label: string;
  ok: boolean;
}
export function v4TicketProofs(s: V4NetState, id: V4TicketId, mark: number, vendor: CliVendor): V4Proof[] {
  const cs = after(s, mark);
  const a = s.cfg.hosta, b = s.cfg.hostb;
  const t = (x: string) => v4VendorText(vendor, x);
  const replyAB: V4Proof = { label: "HOST-A got an echo reply from HOST-B (HOST-A's capture)", ok: gotReply(cs, "hosta", B) };
  switch (id) {
    case "mask":
      return [
        { label: `HOST-A's mask is ${maskOf(V4_PREFIX)} again`, ok: a.prefix === V4_PREFIX },
        { label: "HOST-A's echo to HOST-B left framed to R1's MAC (remote, via the gateway)", ok: cs.some((c) => c.dev === "hosta" && c.dir === "out" && c.frame.ip?.icmp === "echo-request" && c.frame.ip.dst === B && c.frame.ethDst === V4_R1.ge0.mac) },
        replyAB,
      ];
    case "gateway":
      return [{ label: `HOST-A's gateway is R1 (${s.r1.ge0.ip})`, ok: a.gw === s.r1.ge0.ip }, { label: "HOST-A resolved its gateway's MAC", ok: v4Entry(s, "hosta", s.r1.ge0.ip)?.mac === V4_R1.ge0.mac }, replyAB];
    case "return":
      return [{ label: `HOST-B's gateway is R1 (${s.r1.ge1.ip})`, ok: b.gw === s.r1.ge1.ip }, { label: "HOST-B sent an echo reply back (HOST-B's capture)", ok: cs.some((c) => c.dev === "hostb" && c.dir === "out" && c.frame.ip?.icmp === "echo-reply") }, replyAB];
    case "r1down":
      return [{ label: t("R1 ge-0/0/1 is up"), ok: s.r1.ge1.up }, { label: "R1 has a route to 192.168.10.64/26 again", ok: v4Routes(s).some((r) => r.net === "192.168.10.64") }, replyAB];
  }
}

export interface V4Challenge {
  id: string;
  title: string;
  task: string;
  hint: string;
  done: (s: V4NetState, m: { cap: number; log: number }) => boolean;
  proof: string;
}
const runOf = (s: V4NetState, m: number, f: (c: V4Capture) => boolean) => after(s, m).some(f);
export const V4_CHALLENGES: V4Challenge[] = [
  {
    id: "shrink",
    title: "Shrink HOST-A's network",
    task: "Make HOST-A's network as small as possible while HOST-C still counts as LOCAL — then prove it by pinging HOST-C.",
    hint: "HOST-A is .10, HOST-C is .30. Which prefix gives the smallest block that still holds both?",
    done: (s, m) => s.cfg.hosta.prefix === 27 && runOf(s, m.cap, (c) => c.dev === "hosta" && c.dir === "out" && c.frame.ip?.icmp === "echo-request" && c.frame.ip.dst === s.cfg.hostc.ip && c.frame.ethDst === V4_HOSTS.hostc.mac) && gotReply(after(s, m.cap), "hosta", s.cfg.hostc.ip),
    proof: "HOST-A is /27 (192.168.10.0–31): HOST-C (.30) is still inside, so the echo went straight to HOST-C's MAC. /28 would have pushed HOST-C outside.",
  },
  {
    id: "believe",
    title: "Make HOST-A believe HOST-B is next door",
    task: "Change only HOST-A so that it treats HOST-B (192.168.10.70) as LOCAL, then ping HOST-B and explain what happens.",
    hint: "Which setting decides what is local? Make HOST-A's network big enough to include .70.",
    done: (s, m) => runOf(s, m.cap, (c) => c.dev === "hosta" && c.dir === "out" && c.frame.arp?.op === "request" && c.frame.arp.tip === B),
    proof: "HOST-A ARPed for 192.168.10.70 itself — it decided LOCAL. Nobody on LAN A owns that address, and R1 doesn't answer for it: no reply.",
  },
  {
    id: "ttl",
    title: "Make a packet die at R1",
    task: "Send a ping from a host on LAN A to HOST-B that R1 refuses to forward — without changing any configuration.",
    hint: "Each router takes 1 off the TTL. What if there is only 1 to take?",
    done: (s, m) => runOf(s, m.cap, (c) => (c.dev === "hosta" || c.dev === "hostc") && c.dir === "in" && c.frame.ip?.icmp === "time-exceeded"),
    proof: "R1 received the packet with TTL 1, would have had to send it with TTL 0 — so it dropped it and sent “time exceeded” back from its LAN A address.",
  },
  {
    id: "readdress",
    title: "Give HOST-C a new address",
    task: "Re-address HOST-C to another free address on its own network, and prove HOST-B can reach it at the new address.",
    hint: "HOST-C is cabled to LAN A: its address must be inside 192.168.10.0/26, and not already used.",
    done: (s, m) => s.cfg.hostc.ip !== V4_HOSTS.hostc.cfg.ip && networkOf(s.cfg.hostc.ip, 26) === "192.168.10.0" && gotReply(after(s, m.cap), "hostb", s.cfg.hostc.ip),
    proof: "HOST-B's ping to HOST-C's new address got a reply: R1 delivered to the new address because it is still inside its connected 192.168.10.0/26.",
  },
  {
    id: "oneway",
    title: "Break only the way back",
    task: "Change only HOST-B so that HOST-A's pings still reach HOST-B, but no reply ever returns.",
    hint: "HOST-B's reply is for 192.168.10.10 — local or remote for HOST-B? What does it need for remote traffic?",
    done: (s, m) => JSON.stringify(s.cfg.hosta) === JSON.stringify(V4_HOSTS.hosta.cfg) && runOf(s, m.cap, (c) => c.dev === "hostb" && c.dir === "in" && c.frame.ip?.icmp === "echo-request" && c.frame.ip.src === s.cfg.hosta.ip) && !gotReply(after(s, m.cap), "hosta", B),
    proof: "HOST-B's capture shows the request arriving; HOST-A got no reply. Delivery works one way only — every direction is its own forwarding decision.",
  },
  {
    id: "renumber",
    title: "Move LAN B's gateway",
    task: "Renumber R1's LAN B interface to 192.168.10.126 and keep HOST-A ↔ HOST-B working.",
    hint: "Two devices must agree: R1's interface address, and the gateway HOST-B uses.",
    done: (s, m) => s.r1.ge1.ip === "192.168.10.126" && s.cfg.hostb.gw === "192.168.10.126" && gotReply(after(s, m.cap), "hosta", B),
    proof: "R1's ge-0/0/1 is 192.168.10.126 and HOST-B uses it as its gateway: HOST-A's ping got its reply through the renumbered gateway.",
  },
];
