import type { PacketVisual, ScenarioStep } from "../../types";
import type { ProcessingStage } from "@/components/network3d/types";
import { act, acted, hop, kitBase, layer, packet, q, repairStep, say, stackOf, withDetail, type KitBase } from "./kit";

/**
 * IPv6 Addressing (CCNA 1.8, 1.9). PC1 boots on a LAN behind R1 and configures itself with SLAAC, then pings a server
 * on another subnet. Later R1 is replaced and its IPv6 routing is not turned back on.
 *
 * Modeled (all computed, nothing stated):
 * - Address text: expansion and RFC 5952 compression; type classification by prefix (global unicast 2000::/3, unique
 *   local fc00::/7, link-local fe80::/10, multicast ff00::/8, loopback, unspecified).
 * - Modified EUI-64: interface ID from a MAC (flip the U/L bit, insert ff:fe).
 * - Solicited-node multicast ff02::1:ffXX:XXXX from the low 24 bits, and the 33:33 multicast MAC from the low 32 bits.
 * - On-link decision: destination inside a learned /64 prefix → neighbor discovery directly; otherwise → the default
 *   router learned from a Router Advertisement. No default router → the packet never leaves the host.
 * - A router sends Router Advertisements and forwards only while IPv6 routing is enabled (Cisco
 *   `ipv6 unicast-routing`); without it, it behaves as a host on each interface.
 */

// ---------------------------------------------------------------------------------------------------------------
// Address arithmetic
// ---------------------------------------------------------------------------------------------------------------
/** Eight 16-bit groups. */
export function groups(addr: string): number[] {
  const a = addr.toLowerCase().split("/")[0];
  const [head, tail] = a.includes("::") ? a.split("::") : [a, undefined];
  const h = head ? head.split(":").filter((x) => x !== "") : [];
  const t = tail !== undefined && tail !== "" ? tail.split(":") : [];
  const fill = tail === undefined ? [] : Array(8 - h.length - t.length).fill("0");
  return [...h, ...fill, ...t].map((g) => parseInt(g, 16));
}
export const expand = (addr: string) => groups(addr).map((g) => g.toString(16).padStart(4, "0")).join(":");
/** RFC 5952: lower case, no leading zeros, the longest run (≥ 2) of zero groups becomes "::" (first one on a tie). */
export function compress(addr: string): string {
  const g = groups(addr);
  let best = { at: -1, len: 0 };
  for (let i = 0; i < 8; ) {
    if (g[i] !== 0) {
      i++;
      continue;
    }
    let j = i;
    while (j < 8 && g[j] === 0) j++;
    if (j - i > best.len) best = { at: i, len: j - i };
    i = j;
  }
  const hex = g.map((x) => x.toString(16));
  if (best.len < 2) return hex.join(":");
  return `${hex.slice(0, best.at).join(":")}::${hex.slice(best.at + best.len).join(":")}`;
}
export type V6Type = "unspecified" | "loopback" | "link-local" | "unique local" | "multicast" | "global unicast" | "other";
export function classify(addr: string): V6Type {
  const g = groups(addr);
  if (g.every((x) => x === 0)) return "unspecified";
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return "loopback";
  if ((g[0] & 0xffc0) === 0xfe80) return "link-local";
  if ((g[0] & 0xfe00) === 0xfc00) return "unique local";
  if ((g[0] & 0xff00) === 0xff00) return "multicast";
  if ((g[0] & 0xe000) === 0x2000) return "global unicast";
  return "other";
}
/** Modified EUI-64 interface identifier (the low 64 bits) from a 48-bit MAC. */
export function eui64(mac: string): string {
  const b = mac.split(":").map((x) => parseInt(x, 16));
  b[0] ^= 0x02;
  const x = [b[0], b[1], b[2], 0xff, 0xfe, b[3], b[4], b[5]];
  return [0, 2, 4, 6].map((i) => ((x[i] << 8) | x[i + 1]).toString(16)).join(":");
}
export const withIid = (prefix64: string, iid: string) => compress(`${groups(prefix64).slice(0, 4).map((g) => g.toString(16)).join(":")}:${iid}`);
export function solicitedNode(addr: string): string {
  const g = groups(addr);
  return compress(`ff02::1:ff${(g[6] & 0xff).toString(16).padStart(2, "0")}:${g[7].toString(16)}`);
}
export function multicastMac(addr: string): string {
  const g = groups(addr);
  const b = [g[6] >> 8, g[6] & 0xff, g[7] >> 8, g[7] & 0xff];
  return ["33", "33", ...b.map((x) => x.toString(16).padStart(2, "0"))].join(":");
}
export function inPrefix(addr: string, prefix: string, len: number): boolean {
  const a = groups(addr);
  const p = groups(prefix);
  for (let bit = 0; bit < len; bit++) {
    const gi = bit >> 4;
    const mask = 0x8000 >> (bit & 15);
    if ((a[gi] & mask) !== (p[gi] & mask)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------------------------------------------
// The network
// ---------------------------------------------------------------------------------------------------------------
export const V6 = {
  pc1Mac: "00:50:56:a1:3c:07",
  r1Mac0: "00:1e:bd:7a:10:00",
  r1Mac1: "00:1e:bd:7a:10:01",
  srvMac: "00:50:56:b4:20:10",
  lan: "2001:db8:acad:10::",
  srvNet: "2001:db8:acad:20::",
  r1Lla: "fe80::1",
  r1Gua0: "2001:db8:acad:10::1",
  r1Gua1: "2001:db8:acad:20::1",
  srv: "2001:db8:acad:20::10",
  srvLla: "fe80::250:56ff:feb4:2010",
} as const;
export const PC1_LLA = compress(`fe80::${eui64(V6.pc1Mac)}`);
export const PC1_GUA = withIid(V6.lan, eui64(V6.pc1Mac));

export interface HostV6 {
  linkLocal?: string;
  gua?: string;
  defaultRouter?: string;
  prefixes: string[];
  groups: string[];
  neighbors: Record<string, string>;
}
export interface V6State extends KitBase {
  pc1: HostV6;
  /** R1 forwards IPv6 and sends Router Advertisements only while this is on. */
  r1Routing: boolean;
  r1Neighbors: Record<string, string>;
  /** Echo results seen by PC1 (one line each). */
  pings: string[];
}
const freshPc = (): HostV6 => ({ prefixes: [], groups: [], neighbors: {} });
export function createV6State(): V6State {
  return { ...kitBase(), pc1: freshPc(), r1Routing: true, r1Neighbors: { [V6.srv]: V6.srvMac }, pings: [] };
}

/** PC1's next hop for a destination: on-link (inside a learned prefix) → the destination; else the default router. */
export function nextHopFor(h: HostV6, dst: string): { kind: "on-link" | "router" | "none"; via?: string } {
  if (classify(dst) === "link-local") return { kind: "on-link", via: dst };
  if (h.prefixes.some((p) => inPrefix(dst, p, 64))) return { kind: "on-link", via: dst };
  if (h.defaultRouter) return { kind: "router", via: h.defaultRouter };
  return { kind: "none" };
}

// ---------------------------------------------------------------------------------------------------------------
// Packets (real header fields)
// ---------------------------------------------------------------------------------------------------------------
const C = { eth: "#94a3b8", v6: "#38bdf8", icmp: "#34d399" };
const v6pkt = (id: string, from: string, to: string, badge: string, src: string, dst: string, srcMac: string, dstMac: string, hopLimit: number, icmp: [string, string][]): PacketVisual =>
  packet(id, "IPV6", from, to, badge, `${badge} · ${src} → ${dst}`, [
    layer("Ethernet II Header", C.eth, [["Destination MAC", dstMac], ["Source MAC", srcMac], ["EtherType", "0x86DD (IPv6)"]]),
    layer("IPv6 Header", C.v6, [["Source", src], ["Destination", dst], ["Next Header", "58 (ICMPv6)"], ["Hop Limit", String(hopLimit)]]),
    layer("ICMPv6", C.icmp, icmp),
  ], dstMac.startsWith("33:33"));

export const ST = {
  host: [{ id: "lla", label: "Form link-local (fe80::/64 + interface ID)" }, { id: "dad", label: "Duplicate Address Detection (NS)" }, { id: "rs", label: "Ask for routers (RS)" }, { id: "slaac", label: "Build global address from the RA prefix" }, { id: "send", label: "On-link or via default router?" }],
  router: [{ id: "rx", label: "Receive" }, { id: "ra", label: "Router Advertisement (if routing)" }, { id: "nd", label: "Neighbor discovery" }, { id: "route", label: "Route lookup (if routing)" }, { id: "tx", label: "Forward · Hop Limit − 1" }],
  server: [{ id: "rx", label: "Receive" }, { id: "reply", label: "Echo Reply" }],
  sw: [{ id: "rx", label: "Receive frame" }, { id: "fwd", label: "Forward (multicast → flood in VLAN)" }],
} satisfies Record<string, ProcessingStage[]>;

// ---------------------------------------------------------------------------------------------------------------
// Repair
// ---------------------------------------------------------------------------------------------------------------
export const V6_REPAIR_OPTIONS = [
  { id: "routing", label: "Enable IPv6 routing on R1 (Cisco: ipv6 unicast-routing) so it advertises and forwards" },
  { id: "prefix48", label: "Change R1's LAN address to a /48 prefix" },
  { id: "static-pc", label: "Give PC1 a static global address" },
  { id: "reboot", label: "Reboot PC1 again" },
];
export const V6_REPAIR_CORRECT = "routing";

type Step = ScenarioStep<V6State>;
const pc = (s: V6State, h: Partial<HostV6>): V6State => ({ ...s, pc1: { ...s.pc1, ...h } });
const sample = "2001:0db8:0000:0000:0000:ff00:0042:8329";

/** PC1's RS/RA exchange — the same model for the healthy boot and for the incident. */
function rsStep(id: string): (s: V6State) => V6State {
  return (s) => {
    const p = v6pkt(`${id}-rs`, "PC1", "R1", "RS", s.pc1.linkLocal!, "ff02::2", V6.pc1Mac, multicastMac("ff02::2"), 255, [["Type", "133 (Router Solicitation)"], ["Source link-layer address", V6.pc1Mac]]);
    return acted(s, hop({ stepId: id, device: "PC1", stages: withDetail(ST.host, { rs: "to ff02::2 (all routers) · Hop Limit 255" }), activeStageId: "rs", egressInterfaceId: "eth0", lookupType: "Router discovery", lookupKey: "ff02::2", lookupResult: "all-routers multicast", action: "SEND RS", reason: "A host asks every router on the link to advertise now instead of waiting for the next periodic RA.", input: "boot", output: p.summary, nextHopId: "R1", before: stackOf(p) }), p, "RS → ff02::2");
  };
}
function raStep(id: string): (s: V6State) => V6State {
  return (s) => {
    if (!s.r1Routing) {
      return acted(s, hop({ stepId: id, device: "R1", stages: withDetail(ST.router, { rx: "RS from PC1 (ff02::2)", ra: "not a router — IPv6 routing disabled" }), activeStageId: "ra", ingressInterfaceId: "Gi0/0", lookupType: "IPv6 routing", lookupKey: "enabled?", lookupResult: "no", action: "IGNORE RS", reason: "With IPv6 routing off, R1 is just a host with addresses: it isn't in the all-routers group's job, sends no Router Advertisements and forwards nothing.", input: "RS", output: "no reply" }), undefined, "no Router Advertisement");
    }
    const p = v6pkt(`${id}-ra`, "R1", "PC1", "RA", V6.r1Lla, "ff02::1", V6.r1Mac0, multicastMac("ff02::1"), 255, [["Type", "134 (Router Advertisement)"], ["Router Lifetime", "1800 s"], ["Prefix", `${compress(V6.lan)}/64`], ["Flags", "A (autonomous) · L (on-link)"], ["Source link-layer address", V6.r1Mac0]]);
    return acted(s, hop({ stepId: id, device: "R1", stages: withDetail(ST.router, { rx: "RS from PC1", ra: `prefix ${compress(V6.lan)}/64 · lifetime 1800 s` }), activeStageId: "ra", ingressInterfaceId: "Gi0/0", egressInterfaceId: "Gi0/0", lookupType: "Router Advertisement", lookupKey: "Gi0/0 prefixes", lookupResult: `${compress(V6.lan)}/64`, action: "SEND RA", reason: "The RA gives hosts the on-link prefix, permission to build their own address from it (A flag), and the router's link-local address as their default gateway.", input: "RS", output: p.summary, nextHopId: "PC1", before: stackOf(p) }), p, `RA · prefix ${compress(V6.lan)}/64`);
  };
}
function slaacStep(id: string): (s: V6State) => V6State {
  return (s) => {
    const gua = withIid(V6.lan, eui64(V6.pc1Mac));
    const n = acted(s, hop({ stepId: id, device: "PC1", stages: withDetail(ST.host, { slaac: `${compress(V6.lan)}/64 + ${eui64(V6.pc1Mac)} = ${gua}` }), activeStageId: "slaac", lookupType: "SLAAC", lookupKey: `${compress(V6.lan)}/64`, lookupResult: gua, action: "ADDRESS", reason: "Stateless address autoconfiguration: prefix from the RA, interface ID generated by the host. No server keeps a lease.", input: "RA", output: gua, mutations: [{ type: "SA_CHANGE", detail: `global address ${gua}` }] }), undefined, `SLAAC → ${gua}`);
    return pc(n, { gua, prefixes: [V6.lan], defaultRouter: V6.r1Lla, groups: [...new Set([...s.pc1.groups, solicitedNode(gua)])] });
  };
}

export const ipv6Steps: Step[] = [
  say("intro", "128 bits, no broadcast", "IPv4 ran out of addresses. IPv6 has 128-bit addresses, no broadcast, and hosts that configure themselves. Follow PC1 from power-on to a ping across a router — then see what happens when the router forgets it is one."),
  say("notation", "Reading an IPv6 address", "Eight groups of four hex digits. Two rules shorten them: drop leading zeros in a group, and replace one run of all-zero groups with ::.", {
    question: q(`What is the shortest correct form of ${sample}?`, [["a", compress(sample)], ["b", "2001:db8::ff00::42:8329"], ["c", "2001:db8:0:0:0:ff00:42:8329"], ["d", "2001:db8::ff:42:8329"]], "a", `Leading zeros go (0db8 → db8, 0042 → 42) and the longest run of zero groups becomes ::. "::" can appear only once, or the address would be ambiguous; option c is valid but not the shortest; option d drops a significant zero in ff00. Expanded, the address is ${expand(sample)}.`),
  }),
  act("link-local", "A link-local address, before any router", `PC1 boots. With no help from anyone it forms a link-local address: fe80::/64 plus a 64-bit interface ID. Here the ID comes from its MAC by modified EUI-64: flip the 7th bit and insert ff:fe in the middle — ${V6.pc1Mac} → ${eui64(V6.pc1Mac)}.`, (s) => {
    const n = acted(s, hop({ stepId: "link-local", device: "PC1", stages: withDetail(ST.host, { lla: `fe80:: + ${eui64(V6.pc1Mac)} = ${PC1_LLA}` }), activeStageId: "lla", lookupType: "Modified EUI-64", lookupKey: V6.pc1Mac, lookupResult: eui64(V6.pc1Mac), action: "LINK-LOCAL", reason: "Every IPv6 interface has a link-local address. It works only on this link — routers never forward it — and it is what neighbor discovery and routing protocols use.", input: "interface up", output: PC1_LLA, mutations: [{ type: "SA_CHANGE", detail: `link-local ${PC1_LLA} (tentative)` }] }), undefined, `tentative ${PC1_LLA}`);
    return pc(n, { linkLocal: PC1_LLA, groups: ["ff02::1", solicitedNode(PC1_LLA)] });
  }, "STEP_ENTERED", q("With only this address, what can PC1 reach?", [["yes", "Any IPv6 device on its own link"], ["no", "The server on the other subnet"], ["dhcp", "Nothing until DHCPv6 gives it an address"]], "yes", "Link-local addresses need no router and no server. Neighbors on the same link can reach each other with them immediately; only traffic leaving the link needs a global address.")),
  act("dad", "Is anyone else using it?", `Before using the address, PC1 checks for duplicates: a Neighbor Solicitation from :: (it has no address yet) to the solicited-node multicast group of its own address — ${solicitedNode(PC1_LLA)}, MAC ${multicastMac(solicitedNode(PC1_LLA))}. No answer within a second: the address is unique.`, (s) => {
    const sn = solicitedNode(PC1_LLA);
    const p = v6pkt("dad-ns", "PC1", "SW1", "NS (DAD)", "::", sn, V6.pc1Mac, multicastMac(sn), 255, [["Type", "135 (Neighbor Solicitation)"], ["Target", PC1_LLA]]);
    return acted(s, hop({ stepId: "dad", device: "PC1", stages: withDetail(ST.host, { lla: PC1_LLA, dad: `NS → ${sn} · no reply → unique` }), activeStageId: "dad", egressInterfaceId: "eth0", lookupType: "Duplicate Address Detection", lookupKey: PC1_LLA, lookupResult: "no Neighbor Advertisement — unique", action: "DAD", reason: "Solicited-node multicast reaches only the hosts whose address ends in the same 24 bits — usually nobody but a duplicate. IPv6 has no broadcast.", input: "tentative address", output: p.summary, before: stackOf(p) }), p, "DAD: no duplicate");
  }),
  rsStepAct("rs", "Any routers here?", "PC1 sends a Router Solicitation to ff02::2, the all-routers multicast group, from its link-local address."),
  act("ra", "R1 answers", "R1 answers with a Router Advertisement, sent to ff02::1 so every node on the link hears it. Open the packet to read what it carries.", raStep("ra"), "PACKET_SENT", q("What does PC1 learn from this Router Advertisement?", [["prefix", "The on-link /64 prefix and a default router (R1's link-local address)"], ["address", "A complete address assigned by R1"], ["dns", "Only the DNS server"], ["mac", "R1's MAC table"]], "prefix", "The RA carries the prefix and R1's link-local source address; the host builds its own address from the prefix (SLAAC) and uses fe80::1 as its default router. Addresses are not assigned by the router.")),
  act("slaac", "PC1 builds its global address", `Prefix from the RA, interface ID from the MAC: ${compress(V6.lan)}/64 + ${eui64(V6.pc1Mac)} = ${PC1_GUA}. PC1 runs DAD for it too, then uses it. (Most operating systems now pick a random interface ID instead of EUI-64, for privacy — the mechanism is the same.)`, slaacStep("slaac"), "STEP_ENTERED"),
  say("address-types", "One interface, many addresses", "PC1 now holds a link-local and a global unicast address, and listens on multicast groups: ff02::1 (all nodes) and a solicited-node group for each address. Open PC1 to see them.", {
    question: q(`A server on another subnet replies to PC1. Which of PC1's addresses must it use?`, [["gua", PC1_GUA], ["lla", PC1_LLA], ["sn", solicitedNode(PC1_GUA)], ["all", "ff02::1"]], "gua", `Only the global unicast address (${classify(PC1_GUA)}) is routable beyond this link. ${PC1_LLA} is ${classify(PC1_LLA)}; the ff02 addresses are ${classify("ff02::1")} groups for this link only.`),
  }),
  say("ula-anycast", "Unique local and anycast", "Two more types complete the set. Unique local addresses (fd00::/8, from fc00::/7) are for internal networks, like private IPv4 — routable inside the company, never on the internet. Anycast is one unicast address configured on several devices; routing delivers to the nearest. There is no IPv6 broadcast at all."),
  act("ping-start", "PC1 pings the server", `PC1 pings ${V6.srv}. Is it on-link? PC1 compares it with its /64: ${compress(V6.srvNet)}/64 is not ${compress(V6.lan)}/64, so the packet goes to the default router, ${V6.r1Lla}. PC1 needs R1's MAC first — a Neighbor Solicitation to ${solicitedNode(V6.r1Lla)}.`, (s) => {
    const nh = nextHopFor(s.pc1, V6.srv);
    const sn = solicitedNode(V6.r1Lla);
    const p = v6pkt("ns-r1", "PC1", "R1", "NS", PC1_GUA, sn, V6.pc1Mac, multicastMac(sn), 255, [["Type", "135 (Neighbor Solicitation)"], ["Target", V6.r1Lla], ["Source link-layer address", V6.pc1Mac]]);
    return acted(s, hop({ stepId: "ping-start", device: "PC1", stages: withDetail(ST.host, { send: `${V6.srv}: ${nh.kind === "router" ? `not on-link → via ${nh.via}` : nh.kind}` }), activeStageId: "send", egressInterfaceId: "eth0", lookupType: "On-link check", lookupKey: V6.srv, lookupResult: nh.kind === "router" ? `off-link → default router ${nh.via}` : nh.kind, action: "NEIGHBOR SOLICITATION", reason: "Neighbor discovery replaces ARP: a solicited-node multicast instead of a broadcast, inside ICMPv6.", input: `ping ${V6.srv}`, output: p.summary, nextHopId: "R1", before: stackOf(p) }), p, `NS for ${V6.r1Lla}`);
  }),
  act("na", "R1 answers with its MAC", "R1 replies with a Neighbor Advertisement straight to PC1: target fe80::1 is at its Gi0/0 MAC. PC1 caches it.", (s) => {
    const p = v6pkt("na-r1", "R1", "PC1", "NA", V6.r1Lla, PC1_GUA, V6.r1Mac0, V6.pc1Mac, 255, [["Type", "136 (Neighbor Advertisement)"], ["Target", V6.r1Lla], ["Flags", "R (router) · S (solicited) · O"], ["Target link-layer address", V6.r1Mac0]]);
    const n = acted(s, hop({ stepId: "na", device: "R1", stages: withDetail(ST.router, { nd: `NA: ${V6.r1Lla} is ${V6.r1Mac0}` }), activeStageId: "nd", ingressInterfaceId: "Gi0/0", egressInterfaceId: "Gi0/0", lookupType: "Neighbor discovery", lookupKey: V6.r1Lla, lookupResult: V6.r1Mac0, action: "NEIGHBOR ADVERTISEMENT", reason: "The R flag tells PC1 this neighbor is a router.", input: "NS", output: p.summary, nextHopId: "PC1", before: stackOf(p) }), p, `NA · ${V6.r1Mac0}`);
    return { ...pc(n, { neighbors: { ...n.pc1.neighbors, [V6.r1Lla]: V6.r1Mac0 } }), r1Neighbors: { ...n.r1Neighbors, [PC1_GUA]: V6.pc1Mac } };
  }),
  act("echo", "Echo Request to the router", `PC1 sends the Echo Request: source ${PC1_GUA}, destination ${V6.srv}, Hop Limit 64 — inside a frame addressed to R1's MAC.`, (s) => {
    const p = v6pkt("echo", "PC1", "R1", "Echo Request", PC1_GUA, V6.srv, V6.pc1Mac, V6.r1Mac0, 64, [["Type", "128 (Echo Request)"], ["Identifier", "0x1d3"], ["Sequence", "1"]]);
    return acted(s, hop({ stepId: "echo", device: "PC1", stages: withDetail(ST.host, { send: `via ${V6.r1Lla} (${V6.r1Mac0})` }), activeStageId: "send", egressInterfaceId: "eth0", lookupType: "Neighbor cache", lookupKey: V6.r1Lla, lookupResult: V6.r1Mac0, action: "SEND", reason: "The IPv6 destination is the server; the frame's destination is the next hop.", input: `ping ${V6.srv}`, output: p.summary, nextHopId: "R1", before: stackOf(p) }), p, "Echo Request → R1");
  }),
  act("r1-routes", "R1 routes it", `R1 looks up ${V6.srv}: ${compress(V6.srvNet)}/64 is connected on Gi0/1. New frame to the server's MAC, Hop Limit 64 → 63.`, (s) => {
    const inP = v6pkt("echo", "PC1", "R1", "Echo Request", PC1_GUA, V6.srv, V6.pc1Mac, V6.r1Mac0, 64, [["Type", "128 (Echo Request)"]]);
    const p = v6pkt("echo-fwd", "R1", "SERVER", "Echo Request", PC1_GUA, V6.srv, V6.r1Mac1, V6.srvMac, 63, [["Type", "128 (Echo Request)"], ["Identifier", "0x1d3"], ["Sequence", "1"]]);
    return acted(s, hop({ stepId: "r1-routes", device: "R1", stages: withDetail(ST.router, { route: `${V6.srv} → ${compress(V6.srvNet)}/64 connected Gi0/1`, tx: "Hop Limit 63" }), activeStageId: "tx", ingressInterfaceId: "Gi0/0", egressInterfaceId: "Gi0/1", lookupType: "IPv6 routing table", lookupKey: V6.srv, lookupResult: `C ${compress(V6.srvNet)}/64 · Gi0/1`, action: "ROUTE", reason: "IPv6 routing works like IPv4: longest-prefix match, new frame per hop, Hop Limit instead of TTL.", input: inP.summary, output: p.summary, nextHopId: "SERVER", before: stackOf(inP), after: stackOf(p), mutations: [{ type: "HOP_LIMIT_CHANGE", detail: "Hop Limit 64 → 63" }, { type: "MAC_CHANGE", detail: `${V6.r1Mac1} → ${V6.srvMac}` }] }), p, "routed → Gi0/1");
  }),
  act("server-replies", "The server replies", "The server answers with an Echo Reply to PC1's global address; R1 routes it back. One round trip, no broadcast anywhere.", (s) => {
    const p = v6pkt("reply", "SERVER", "R1", "Echo Reply", V6.srv, PC1_GUA, V6.srvMac, V6.r1Mac1, 64, [["Type", "129 (Echo Reply)"], ["Identifier", "0x1d3"], ["Sequence", "1"]]);
    const n = acted(s, hop({ stepId: "server-replies", device: "SERVER", stages: withDetail(ST.server, { reply: `→ ${PC1_GUA}` }), activeStageId: "reply", ingressInterfaceId: "eth0", egressInterfaceId: "eth0", lookupType: "ICMPv6", lookupKey: "Echo Request", lookupResult: "reply", action: "ECHO REPLY", reason: "The reply's destination is the source the server saw: PC1's global unicast address.", input: "Echo Request", output: p.summary, nextHopId: "R1", before: stackOf(p) }), p, "Echo Reply → PC1");
    return { ...n, pings: [...n.pings, `${V6.srv}: reply, hop limit 63`] };
  }, "PACKET_RECEIVED"),
  // incident
  act("fault-injected", "A hardware refresh", "R1 is swapped for a new router. The engineer pastes the old interface configuration — both IPv6 addresses, fe80::1 on Gi0/0 — and the interfaces come up. PC1 is rebooted the next morning and starts from scratch.", (s) => ({ ...s, r1Routing: false, faultActive: true, pc1: { ...freshPc(), linkLocal: PC1_LLA, groups: ["ff02::1", solicitedNode(PC1_LLA)] }, r1Neighbors: {}, packet: undefined, flood: [], decision: { device: "R1", text: "interfaces up · addresses configured" } }), "STEP_ENTERED"),
  act("inc-rs", "PC1 asks for routers again", "PC1 forms the same link-local address, passes DAD, and sends a Router Solicitation to ff02::2.", rsStep("inc-rs"), "PACKET_SENT"),
  act("inc-no-ra", "Silence", "No Router Advertisement comes back — not to the RS, and not periodically. PC1 keeps only its link-local address and has no default router.", raStep("inc-no-ra"), "PACKET_DROPPED"),
  act("inc-ping", "The ping never leaves", `PC1 pings ${V6.srv}. It isn't on-link (PC1 knows no prefix at all) and there is no default router, so the operating system reports the destination unreachable without sending anything.`, (s) => {
    const nh = nextHopFor(s.pc1, V6.srv);
    const n = acted(s, hop({ stepId: "inc-ping", device: "PC1", stages: withDetail(ST.host, { slaac: "no RA → no global address", send: `${V6.srv}: ${nh.kind === "none" ? "no route" : nh.kind}` }), activeStageId: "send", lookupType: "On-link check", lookupKey: V6.srv, lookupResult: nh.kind === "none" ? "no prefix, no default router — no route" : String(nh.via), action: "DROP (no route)", reason: "Without a Router Advertisement a host has neither a global address nor a gateway. Traffic off the link has nowhere to go.", input: `ping ${V6.srv}`, output: "Destination unreachable (no route)" }), undefined, "no route to host");
    return { ...n, pings: [...n.pings, `${V6.srv}: no route`] };
  }, "PACKET_DROPPED"),
  say("trouble-question", "Diagnose", "R1's interfaces are up and carry the right addresses. PC1 has a link-local address, no global address, no default router.", {
    question: q("What is the most likely cause?", [["prefix", "R1's LAN prefix length is wrong"], ["routing", "R1 isn't acting as an IPv6 router, so it sends no Router Advertisements (and wouldn't forward)"], ["dad", "PC1's address is a duplicate"], ["server", "The server is down"]], "routing", "Addresses on interfaces don't make a router. On Cisco IOS, a device sends RAs and forwards IPv6 only with ipv6 unicast-routing; the new R1 never got that global line. A wrong prefix length would still produce RAs; a duplicate would fail DAD; the server never sees a packet.", ["What does PC1 need to build a global address?", "Who sends that, and when?", "Interfaces are configured — what else makes a router a router?"]),
  }),
  say("diagnostic-layers", "Troubleshooting layers", "Bottom-up on the LAN: link, PC1's link-local, R1's addresses, R1's IPv6 routing, Router Advertisements, PC1's global address and default router."),
  repairStep("repair-challenge", "Repair", "Choose the change that fixes the cause.", V6_REPAIR_CORRECT, (s) => ({ ...s, r1Routing: true, decision: { device: "R1", text: "IPv6 unicast routing enabled" } })),
  act("verify-ra", "Router Advertisements return", "R1 now joins ff02::2 and answers PC1's next Router Solicitation with the /64 prefix and itself as default router. PC1 builds the same global address as before.", (s) => {
    const ra = raStep("verify-ra")(rsStep("verify-ra")(s));
    return { ...slaacStep("verify-ra")(ra), packet: ra.packet };
  }, "PACKET_SENT"),
  act("verify-ping", "The ping succeeds", `PC1's on-link check sends ${V6.srv} to fe80::1; R1 routes it out Gi0/1 and the server replies.`, (s) => {
    const nh = nextHopFor(s.pc1, V6.srv);
    const p = v6pkt("v-echo", "R1", "SERVER", "Echo Request", PC1_GUA, V6.srv, V6.r1Mac1, V6.srvMac, 63, [["Type", "128 (Echo Request)"], ["Sequence", "1"]]);
    const n = acted(s, hop({ stepId: "verify-ping", device: "R1", stages: withDetail(ST.router, { route: `${V6.srv} → Gi0/1`, tx: "Hop Limit 63" }), activeStageId: "tx", ingressInterfaceId: "Gi0/0", egressInterfaceId: "Gi0/1", lookupType: "IPv6 routing table", lookupKey: V6.srv, lookupResult: `C ${compress(V6.srvNet)}/64 · Gi0/1 (PC1 via ${nh.via})`, action: "ROUTE", reason: "Routing on: RAs out, packets through.", input: "Echo Request from PC1", output: p.summary, nextHopId: "SERVER", before: stackOf(p) }), p, "routed → SERVER");
    return { ...n, pings: [...n.pings, `${V6.srv}: reply, hop limit 63`] };
  }, "PACKET_RECEIVED"),
  say("complete", "IPv6 addressing", "Compressed notation; link-local on every interface; SLAAC from a Router Advertisement; neighbor discovery over solicited-node multicast; global, unique local, multicast and anycast — and a router that must be told to route before it will advertise."),
];

function rsStepAct(id: string, label: string, narrative: string): Step {
  return act(id, label, narrative, rsStep(id), "PACKET_SENT");
}
