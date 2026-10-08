import type { CliVendor } from "@/lib/cli/types";
import { ARP_HOSTS, HOSTS, R1_IFS, entryFor, ipOwners, maskOf, netOf, type ArpCapture, type ArpNetState, type ArpTicketId } from "@/lib/sim-engine/scenarios/arpNet";
import { arpVendorText } from "./arpNetCli";

/**
 * ARP troubleshooting and practice, judged only from the network's evidence (caches, settings, link state,
 * captures). A wrong hypothesis gets the evidence that rules it out, read from the network at that moment.
 */

const PCB = "192.168.10.20";
const after = (s: ArpNetState, mark: number) => s.captures.filter((c) => c.no > mark);
const laptopGotReplyFrom = (cs: ArpCapture[], ip: string) => cs.some((c) => c.dev === "laptop" && c.dir === "in" && c.frame.ip?.icmp === "echo-reply" && c.frame.ip.src === ip);

export type ArpCause = "gw" | "mask" | "static" | "dupip" | "l2" | "down" | "swtable" | "r1";
export const ARP_CAUSES: { id: ArpCause; label: string }[] = [
  { id: "gw", label: "The Laptop's default gateway is an address nobody owns" },
  { id: "mask", label: "The Laptop's mask makes a host on its LAN look remote" },
  { id: "static", label: "A wrong static ARP entry on the Laptop" },
  { id: "dupip", label: "Another host is using PC-B's IP address" },
  { id: "l2", label: "No Layer-2 path to PC-B: its switch port is down" },
  { id: "down", label: "PC-B is powered off" },
  { id: "swtable", label: "SW1's MAC address table is wrong" },
  { id: "r1", label: "R1 isn't answering ARP" },
];
export const TICKET_CAUSE: Record<ArpTicketId, ArpCause> = { gateway: "gw", mask: "mask", static: "static", dupip: "dupip", port: "l2" };

export function causeFeedback(s: ArpNetState, cause: ArpCause, vendor: CliVendor): string {
  const L = s.cfg.laptop;
  const st = entryFor(s, "laptop", PCB);
  const owners = ipOwners(s, PCB);
  const t = (x: string) => arpVendorText(vendor, x);
  switch (cause) {
    case "gw": {
      if (!L.gw) return "The Laptop has no default gateway at all: remote traffic isn't even sent (ping: General failure), and no ARP happens.";
      const gwOwners = ipOwners(s, L.gw);
      return gwOwners.length
        ? t(`The Laptop's gateway is ${L.gw}, which ${gwOwners.join(", ")} owns: an ARP for it gets answered (look at the Laptop's cache or R1's ARP table).`)
        : `Right: the Laptop's gateway is ${L.gw}, and no device owns that address. Every remote packet starts with "who has ${L.gw}?" — the broadcast reaches everyone, nobody replies, the entry stays incomplete, and Windows reports "Destination host unreachable" from its own address. Local traffic never needs the gateway, which is why PC-B and PC-C work.`;
    }
    case "mask":
      return L.prefix === 24
        ? `The Laptop's mask is ${maskOf(24)}: 192.168.10.0/24 contains every host on this LAN, so they are ARPed directly.`
        : `Right: the Laptop's mask is ${maskOf(L.prefix)} (/${L.prefix}), so its own network is ${netOf(L.ip, L.prefix)}/${L.prefix}. ${PCB} falls outside it, so the Laptop treats PC-B as remote and sends to its gateway: the echo frames carry R1's MAC while the IP destination is PC-B. R1 forwards them back onto the same LAN. PC-B (with a /24) answers directly — the path is asymmetric.`;
    case "static":
      return st?.static
        ? st.mac === HOSTS.pcb.mac
          ? `There is a static entry for ${PCB}, but it holds PC-B's real MAC (${HOSTS.pcb.mac}).`
          : `Right: the Laptop has a STATIC entry ${PCB} → ${st.mac}, but PC-B's MAC is ${HOSTS.pcb.mac} (ip addr on PC-B). A static entry is never refreshed or replaced, so the Laptop never ARPs for PC-B: it frames every packet to a MAC no port has. SW1 floods those frames, every NIC discards them. PC-C has no such entry, so PC-C reaches PC-B.`
        : `The Laptop has no static entry for ${PCB} (arp -a shows its type).`;
    case "dupip":
      return owners.length > 1
        ? `Right: ${owners.join(" and ")} both use ${PCB}. The Laptop's broadcast reaches both, both reply, and the last reply wins its cache — here ${st?.mac ? `${st.mac} (${ARP_HOSTS.find((h) => HOSTS[h].mac === st.mac) ? HOSTS[ARP_HOSTS.find((h) => HOSTS[h].mac === st.mac)!].name : "?"})` : "the later one"}. Pings "work" because the wrong host answers them.`
        : `Only ${owners.join(", ") || "nobody"} uses ${PCB} (check each host's ipconfig / ip addr): a request for it gets one reply.`;
    case "l2":
      return s.swShut.includes("fa3")
        ? t(`Right: SW1 Fa0/3 (PC-B's port) is shut down — administratively disabled. SW1 floods the Laptop's ARP broadcast out every port that is up, and Fa0/3 isn't, so PC-B never hears the question: nothing reaches its capture, and the Laptop's entry stays incomplete.`)
        : !s.power.pcb
          ? t("SW1 Fa0/3 is enabled; it has no link because PC-B itself is off.")
          : t("SW1 Fa0/3 is enabled and connected (show interfaces status), and PC-B's capture shows the frames that reach it.");
    case "down":
      return s.power.pcb
        ? t(`PC-B is powered on (its window). ${s.swShut.includes("fa3") ? "Its port shows disabled, not notconnect: SW1 itself has turned the port off." : "Its port has link."}`)
        : "Right: PC-B is powered off, so its switch port has no link and nothing can answer for its address.";
    case "swtable":
      return t(`SW1's table only says behind which port each MAC is (show mac address-table). It never holds IP addresses and never answers ARP. ${st?.static ? `The frames go to ${st.mac} because the Laptop addressed them there; SW1 floods them because no port has that MAC.` : "Whatever it holds, it cannot make a host ask for the wrong IP or believe the wrong reply."}`);
    case "r1":
      return `R1 answers ARP for ${R1_IFS.gi0.ip} and ${R1_IFS.gi1.ip} — its own addresses (show ip arp lists them with Age "-")${L.gw && L.gw !== R1_IFS.gi0.ip ? `. The Laptop isn't asking for ${R1_IFS.gi0.ip}: it is asking for ${L.gw}` : ""}. R1 replies only for its own addresses; it never answers on behalf of PC-B.`;
  }
}

export interface Proof {
  label: string;
  ok: boolean;
}
export function ticketProofs(s: ArpNetState, id: ArpTicketId, mark: number, vendor: CliVendor): Proof[] {
  const cs = after(s, mark);
  const L = s.cfg.laptop;
  const st = entryFor(s, "laptop", PCB);
  switch (id) {
    case "gateway":
      return [
        { label: `The Laptop's gateway is ${R1_IFS.gi0.ip} (R1)`, ok: L.gw === R1_IFS.gi0.ip },
        { label: "The Laptop's ARP cache holds R1's MAC for its gateway", ok: entryFor(s, "laptop", R1_IFS.gi0.ip)?.mac === R1_IFS.gi0.mac },
        { label: "A ping from the Laptop to the Server got a reply (Laptop capture)", ok: laptopGotReplyFrom(cs, "10.20.20.20") },
      ];
    case "mask":
      return [
        { label: "The Laptop's mask is 255.255.255.0", ok: L.prefix === 24 },
        { label: "An echo to PC-B left the Laptop framed to PC-B's MAC, not R1's", ok: cs.some((c) => c.dev === "laptop" && c.dir === "out" && c.frame.ip?.icmp === "echo-request" && c.frame.ip.dst === PCB && c.frame.ethDst === HOSTS.pcb.mac) },
        { label: "PC-B's reply came back", ok: laptopGotReplyFrom(cs, PCB) },
      ];
    case "static":
      return [
        { label: `No wrong static entry for ${PCB} on the Laptop`, ok: !(st?.static && st.mac !== HOSTS.pcb.mac) },
        { label: `The Laptop's entry for ${PCB} is PC-B's real MAC`, ok: st?.mac === HOSTS.pcb.mac },
        { label: "A ping from the Laptop to PC-B got a reply", ok: laptopGotReplyFrom(cs, PCB) },
      ];
    case "dupip":
      return [
        { label: `Only PC-B uses ${PCB}`, ok: ipOwners(s, PCB).length === 1 && s.cfg.pcb.ip === PCB },
        { label: `The Laptop's entry for ${PCB} is PC-B's MAC`, ok: st?.mac === HOSTS.pcb.mac },
        { label: "PC-B's own capture shows the Laptop's echo request", ok: cs.some((c) => c.dev === "pcb" && c.dir === "in" && c.frame.ip?.icmp === "echo-request" && c.frame.ip.src === L.ip) },
      ];
    case "port":
      return [
        { label: arpVendorText(vendor, "SW1 Fa0/3 is enabled"), ok: !s.swShut.includes("fa3") },
        { label: "A ping from the Laptop to PC-B got a reply", ok: laptopGotReplyFrom(cs, PCB) },
      ];
  }
}

export interface ArpChallenge {
  id: string;
  title: string;
  task: string;
  hint: string;
  done: (s: ArpNetState, m: { cap: number; log: number }) => boolean;
  proof: string;
}
const laptopArpedFor = (cs: ArpCapture[], ip: string) => cs.some((c) => c.dev === "laptop" && c.dir === "out" && c.frame.arp?.op === "request" && c.frame.arp.tip === ip);
export const ARP_CHALLENGES: ArpChallenge[] = [
  {
    id: "learn",
    title: "Teach the Laptop PC-B's MAC without asking",
    task: "Get PC-B's MAC into the Laptop's ARP cache without the Laptop ever sending an ARP request for it.",
    hint: "Who learns from an ARP request, besides the one who sent it?",
    done: (s, m) => entryFor(s, "laptop", PCB)?.mac === HOSTS.pcb.mac && !laptopArpedFor(after(s, m.cap), PCB),
    proof: "The Laptop's cache holds PC-B, and its capture shows no request for 192.168.10.20: it learned as the TARGET of PC-B's request.",
  },
  {
    id: "hit",
    title: "Ping PC-B twice: ARP only once",
    task: "From a fresh start, ping PC-B from the Laptop two separate times, and prove the second time sent no ARP at all.",
    hint: "Ping once (ping -n 1), then ping again. Compare the two runs in the Laptop's capture.",
    done: (s, m) => {
      const cs = after(s, m.cap).filter((c) => c.dev === "laptop" && c.dir === "out");
      const runs = [...new Set(cs.filter((c) => c.frame.ip?.icmp === "echo-request" && c.frame.ip.dst === PCB).map((c) => c.run))];
      return runs.length >= 2 && cs.some((c) => c.run === runs[0] && c.frame.arp?.tip === PCB) && runs.slice(1).some((r) => !cs.some((c) => c.run === r && c.frame.type === "ARP"));
    },
    proof: "Two pings to PC-B: the first run starts with an ARP request, a later one has echo requests only — a cache hit.",
  },
  {
    id: "switch",
    title: "SW1 knows PC-C, no ARP cache does",
    task: "Make SW1's MAC table hold PC-C's MAC while no device has PC-C's address (192.168.10.30) in its ARP cache.",
    hint: "SW1 learns from any frame PC-C sends. ARP caches learn only from ARP exchanges that involve them. What could PC-C send that nobody answers?",
    done: (s) => !!s.swMac[HOSTS.pcc.mac] && !(["laptop", "pcb", "pcc", "server", "r1"] as const).some((o) => s.caches[o].some((e) => e.ip === s.cfg.pcc.ip && e.state === "reachable")),
    proof: "SW1's MAC table has PC-C's MAC on Fa0/4, and no ARP cache maps 192.168.10.30: two different tables, filled by different things.",
  },
  {
    id: "gwmac",
    title: "Get the gateway's MAC without pinging it",
    task: "Put R1's MAC into the Laptop's ARP cache without pinging 192.168.10.1.",
    hint: "When does the Laptop need the gateway's MAC?",
    done: (s, m) => entryFor(s, "laptop", R1_IFS.gi0.ip)?.mac === R1_IFS.gi0.mac && !after(s, m.cap).some((c) => c.dev === "laptop" && c.dir === "out" && c.frame.ip?.dst === R1_IFS.gi0.ip),
    proof: "The Laptop's cache holds 192.168.10.1 → R1's MAC, learned because it sent traffic to a REMOTE address.",
  },
  {
    id: "server",
    title: "Make R1 resolve the Server",
    task: "Get the Server's MAC into R1's ARP table — on its Server-side interface.",
    hint: "R1 ARPs for a next hop only when it has a packet to forward there (or a ping of its own).",
    done: (s) => entryFor(s, "r1", "10.20.20.20")?.mac === HOSTS.server.mac,
    proof: "R1's ARP table lists 10.20.20.20 on Gi0/1: ARP on the far side happens between R1 and the Server — never from the Laptop.",
  },
  {
    id: "expire",
    title: "Watch an entry expire",
    task: "Make the Laptop forget PC-B without clearing anything.",
    hint: "Host entries in this lab expire 120 s after they were last confirmed.",
    done: (s, m) => s.log.some((l) => l.id > m.log && /ARP entries expired: .*Laptop 192\.168\.10\.20(?! \()/.test(l.text)),
    proof: "The log shows the Laptop's entry for 192.168.10.20 expired: the next ping will ARP again.",
  },
  {
    id: "incomplete",
    title: "Leave an incomplete entry",
    task: "Make the Laptop's neighbor cache show an incomplete/unreachable entry for an address on its own LAN.",
    hint: "Ask for an address nobody owns. netsh interface ipv4 show neighbors shows what arp -a hides.",
    done: (s) => s.caches.laptop.some((e) => e.state !== "reachable" && netOf(e.ip, 24) === "192.168.10.0"),
    proof: "The Laptop's neighbor cache has an Unreachable entry: a request went out, no reply came back.",
  },
];
