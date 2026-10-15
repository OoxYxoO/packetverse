import type { PacketVisual, ScenarioStep } from "../../types";
import type { ProcessingStage } from "@/components/network3d/types";
import { act, acted, hop, kitBase, layer, packet, q, repairStep, say, stackOf, withDetail, type KitBase } from "./kit";
import { compress, inPrefix } from "./ipv6Addr";

/**
 * Static Routes: Floating, Host & IPv6 (CCNA 3.1, 3.3). R1 is an edge router with two ISPs, an MPLS WAN to a branch
 * (OSPF) and an LTE router for emergencies.
 *
 * Modeled (one RIB algorithm for every step):
 * - Candidates per prefix come from connected interfaces, OSPF and static configuration. A candidate is usable only if
 *   its outgoing interface is up. Per prefix/length the lowest administrative distance wins (connected 0, static 1 by
 *   default, OSPF 110); metric only compares routes from the same source.
 * - Forwarding: longest-prefix match over the installed routes.
 * - A floating static is just a static with a higher AD than the route it backs up: it installs only when that route
 *   disappears.
 * - IPv6 uses the same algorithm; a link-local next hop needs the outgoing interface too.
 */

export interface Cand {
  af: 4 | 6;
  prefix: string;
  len: number;
  proto: "C" | "L" | "S" | "O";
  ad: number;
  metric: number;
  via?: string;
  iface: string;
  /** Free-text note shown in tables (e.g. "floating"). */
  note?: string;
}
export interface SrState extends KitBase {
  ifUp: Record<string, boolean>;
  statics: Cand[];
  /** OSPF-learned candidates (present while the WAN interface and its neighbour are up). */
  ospf: Cand[];
  traces: string[];
}
const ip2n = (ip: string) => ip.split(".").reduce((a, o) => a * 256 + Number(o), 0) >>> 0;
const in4 = (ip: string, p: string, len: number) => {
  const m = len === 0 ? 0 : (0xffffffff << (32 - len)) >>> 0;
  return ((ip2n(ip) & m) >>> 0) === ((ip2n(p) & m) >>> 0);
};
export const IFACES: Record<string, { ip: string; len: number; net: string; to: string; af: 4 | 6 }> = {
  "Gi0/0": { ip: "10.1.1.1", len: 24, net: "10.1.1.0", to: "LAN", af: 4 },
  "Gi0/1": { ip: "198.51.100.2", len: 30, net: "198.51.100.0", to: "ISP-A", af: 4 },
  "Gi0/2": { ip: "203.0.113.6", len: 30, net: "203.0.113.4", to: "ISP-B", af: 4 },
  "Gi0/3": { ip: "10.0.12.1", len: 30, net: "10.0.12.0", to: "WAN", af: 4 },
  "Gi0/4": { ip: "10.0.40.1", len: 30, net: "10.0.40.0", to: "LTE", af: 4 },
};
export const V6IF: Record<string, { gua: string; len: number }> = { "Gi0/1": { gua: "2001:db8:a::2", len: 64 }, "Gi0/2": { gua: "2001:db8:b::2", len: 64 } };

export const PRIMARY_DEFAULT: Cand = { af: 4, prefix: "0.0.0.0", len: 0, proto: "S", ad: 1, metric: 0, via: "198.51.100.1", iface: "Gi0/1" };
export const FLOATING_DEFAULT: Cand = { af: 4, prefix: "0.0.0.0", len: 0, proto: "S", ad: 250, metric: 0, via: "203.0.113.5", iface: "Gi0/2", note: "floating" };
export const HOST_ROUTE: Cand = { af: 4, prefix: "192.0.2.10", len: 32, proto: "S", ad: 1, metric: 0, via: "203.0.113.5", iface: "Gi0/2", note: "host route" };
export const V6_DEFAULT: Cand = { af: 6, prefix: "::", len: 0, proto: "S", ad: 1, metric: 0, via: "2001:db8:a::1", iface: "Gi0/1" };
export const V6_FLOATING: Cand = { af: 6, prefix: "::", len: 0, proto: "S", ad: 250, metric: 0, via: "fe80::b", iface: "Gi0/2", note: "floating" };
export const OSPF_BRANCH: Cand = { af: 4, prefix: "10.50.0.0", len: 16, proto: "O", ad: 110, metric: 20, via: "10.0.12.2", iface: "Gi0/3" };
export const BAD_BACKUP: Cand = { af: 4, prefix: "10.50.0.0", len: 16, proto: "S", ad: 5, metric: 0, via: "10.0.40.2", iface: "Gi0/4", note: "backup" };
export const GOOD_BACKUP: Cand = { ...BAD_BACKUP, ad: 250, note: "floating" };

export function createSrState(): SrState {
  return { ...kitBase(), ifUp: Object.fromEntries(Object.keys(IFACES).map((k) => [k, true])), statics: [PRIMARY_DEFAULT], ospf: [OSPF_BRANCH], traces: [] };
}
function candidates(s: SrState): Cand[] {
  const conn = Object.entries(IFACES).flatMap(([iface, i]) => [
    { af: 4 as const, prefix: i.net, len: i.len, proto: "C" as const, ad: 0, metric: 0, iface },
    { af: 4 as const, prefix: i.ip, len: 32, proto: "L" as const, ad: 0, metric: 0, iface },
  ]);
  const v6conn = Object.entries(V6IF).flatMap(([iface, i]) => [{ af: 6 as const, prefix: i.gua.replace(/::\d+$/, "::"), len: i.len, proto: "C" as const, ad: 0, metric: 0, iface }]);
  const ospf = s.ifUp["Gi0/3"] ? s.ospf : [];
  return [...conn, ...v6conn, ...s.statics, ...ospf].filter((c) => s.ifUp[c.iface] !== false);
}
/** The routing table: per prefix/length, the lowest-AD usable candidate (then the lowest metric). */
export function rib(s: SrState, af: 4 | 6 = 4): Cand[] {
  const best = new Map<string, Cand>();
  for (const c of candidates(s).filter((x) => x.af === af)) {
    const k = `${c.prefix}/${c.len}`;
    const cur = best.get(k);
    if (!cur || c.ad < cur.ad || (c.ad === cur.ad && c.metric < cur.metric)) best.set(k, c);
  }
  return [...best.values()].sort((a, b) => b.len - a.len);
}
/** Every configured/learned candidate with whether it won its prefix — for "why isn't my route installed?". */
export function contenders(s: SrState, prefix: string, len: number) {
  const installed = rib(s, prefix.includes(":") ? 6 : 4).find((r) => r.prefix === prefix && r.len === len);
  const all = [...s.statics, ...s.ospf].filter((c) => c.prefix === prefix && c.len === len);
  return all.map((c) => ({ c, installed: installed === c, usable: s.ifUp[c.iface] !== false && (c.proto !== "O" || s.ifUp["Gi0/3"]) }));
}
export function lookup(s: SrState, dst: string): Cand | undefined {
  const af = dst.includes(":") ? 6 : 4;
  return rib(s, af).find((r) => (af === 4 ? in4(dst, r.prefix, r.len) : inPrefix(dst, r.prefix, r.len)));
}
export const routeText = (r: Cand) => `${r.proto}${r.len === 0 ? "*" : ""} ${r.af === 6 ? compress(r.prefix) : r.prefix}/${r.len}${r.proto === "C" || r.proto === "L" ? "" : ` [${r.ad}/${r.metric}]`}${r.via ? ` via ${r.via}` : " is directly connected"}, ${r.iface}`;

// ---------------------------------------------------------------------------------------------------------------
const C = { ip: "#60a5fa", v6: "#38bdf8" };
const pkt = (id: string, dst: string, to: string): PacketVisual =>
  packet(id, dst.includes(":") ? "IPV6" : "IP", "R1", to, dst.includes(":") ? "IPv6" : "IPv4", `${dst.includes(":") ? "IPv6" : "IPv4"} · ${dst.includes(":") ? "2001:db8:1::10" : "10.1.1.10"} → ${dst}`, [layer(dst.includes(":") ? "IPv6 Header" : "IPv4 Header", dst.includes(":") ? C.v6 : C.ip, [["Source", dst.includes(":") ? "2001:db8:1::10" : "10.1.1.10"], ["Destination", dst], [dst.includes(":") ? "Hop Limit" : "TTL", "63"]])]);
export const ST = {
  r1: [{ id: "rx", label: "Receive from the LAN" }, { id: "rib", label: "Routing table: best route per prefix (lowest AD)" }, { id: "lpm", label: "Longest prefix match for the destination" }, { id: "tx", label: "Forward to the next hop" }],
  peer: [{ id: "rx", label: "Receive" }, { id: "fwd", label: "Forward onward" }],
} satisfies Record<string, ProcessingStage[]>;

function forward(id: string, dst: string): (s: SrState) => SrState {
  return (s) => {
    const r = lookup(s, dst);
    const to = r ? IFACES[r.iface]?.to ?? "ISP-A" : "R1";
    const p = pkt(`${id}-p`, dst, to);
    const all = rib(s, dst.includes(":") ? 6 : 4).filter((x) => (dst.includes(":") ? inPrefix(dst, x.prefix, x.len) : in4(dst, x.prefix, x.len)));
    const n = acted(s, hop({ stepId: id, device: "R1", stages: withDetail(ST.r1, { rib: `${rib(s).length} IPv4 routes installed`, lpm: `${dst}: matches ${all.map((x) => `/${x.len}`).join(", ") || "nothing"} → ${r ? `/${r.len}` : "none"}`, tx: r ? `${r.via ?? "connected"} · ${r.iface}` : "drop" }), activeStageId: "lpm", ingressInterfaceId: "Gi0/0", egressInterfaceId: r?.iface, lookupType: "Longest prefix match", lookupKey: dst, lookupResult: r ? routeText(r) : "no route", action: r ? `FORWARD via ${to}` : "DROP", reason: "The most specific matching route wins, whatever its source; administrative distance only chose which route was installed for each prefix.", input: p.summary, output: r ? `→ ${to}` : "dropped", nextHopId: r ? to : undefined, before: stackOf(p) }), p, r ? `${dst} → ${to}` : "no route");
    return { ...n, traces: [...n.traces, `${dst} → ${r ? `${to} (${r.proto} /${r.len} AD ${r.ad})` : "dropped"}`] };
  };
}

export const SR_REPAIR_OPTIONS = [
  { id: "ad250", label: "Give the LTE static route an administrative distance above OSPF's — 250" },
  { id: "remove-ospf", label: "Stop running OSPF to the branch" },
  { id: "cost", label: "Lower the OSPF cost on the WAN link" },
  { id: "more-specific", label: "Add a /24 static route for each branch subnet via the WAN" },
];
export const SR_REPAIR_CORRECT = "ad250";

type Step = ScenarioStep<SrState>;
export const staticSteps: Step[] = [
  say("intro", "Routes you write yourself", "Dynamic protocols learn routes; static routes are the ones you type. They point to the internet, force a path, and stand by as a backup. Every one of them competes in the same routing table, by the same rules."),
  say("table", "Reading the routing table", "Each line of show ip route gives the source (C connected, L local, S static, O OSPF, * candidate default), the prefix and length, [administrative distance/metric], the next hop and the exit interface.", {
    question: q("A line reads O 10.50.0.0/16 [110/20] via 10.0.12.2, Gi0/3. What are 110 and 20?", [["admet", "110 is the administrative distance (OSPF), 20 the OSPF metric (cost)"], ["hops", "110 hops and 20 ms"], ["metad", "110 is the metric, 20 the distance"], ["vlan", "VLAN 110, priority 20"]], "admet", "AD says how trusted the source is (OSPF = 110); the metric ranks routes from that same source (OSPF cost 20). Lower is better for both."),
  }),
  act("default", "The default route", "A user browses to 8.8.8.8. R1 has no specific route for it; only the static default route matches — S* 0.0.0.0/0 via ISP-A, the gateway of last resort.", forward("default", "8.8.8.8")),
  act("host-route", "A host route forces one path", "A partner requires our traffic to their API server, 192.0.2.10, to arrive from ISP-B's address range. R1 gets a host route: ip route 192.0.2.10 255.255.255.255 203.0.113.5. Now two installed routes match that server.", (s) => ({ ...s, statics: [...s.statics, HOST_ROUTE], packet: undefined, flood: [], decision: { device: "R1", text: "S 192.0.2.10/32 [1/0] via 203.0.113.5 installed" } }), "STEP_ENTERED", q("Both 0.0.0.0/0 (via ISP-A) and 192.0.2.10/32 (via ISP-B) match 192.0.2.10. Which does R1 use?", [["host", "The /32 — the longest prefix match wins"], ["default", "The default route — it was configured first"], ["both", "Both, alternating"], ["ad", "Whichever has the lower AD"]], "host", "Forwarding always picks the most specific match. Administrative distance only matters between routes for the same prefix and length.")),
  act("host-forward", "The packet takes the host route", "A user's request to 192.0.2.10 arrives. R1 finds two matches — /0 and /32 — and forwards on the longer one, out Gi0/2 to ISP-B. Everything else still uses ISP-A.", forward("host-forward", "192.0.2.10")),
  say("ad", "Same prefix, different sources", "The branch network 10.50.0.0/16 is learned by OSPF over the MPLS WAN.", {
    question: q("If someone also configured a static route for 10.50.0.0/16 with the default AD, which would be installed?", [["static", "The static route — AD 1 beats OSPF's 110"], ["ospf", "The OSPF route — it has a real metric"], ["both", "Both, load-balanced"]], "static", "Between sources for the same prefix, the lowest administrative distance wins outright; metrics from different protocols are never compared. That's why a static backup must be given a higher AD."),
  }),
  act("floating", "A floating default route", "For resilience R1 gets a second default route via ISP-B with AD 250: ip route 0.0.0.0 0.0.0.0 203.0.113.5 250. It's in the configuration but not in the routing table — the primary's AD 1 wins.", (s) => ({ ...s, statics: [...s.statics, FLOATING_DEFAULT], packet: undefined, flood: [], decision: { device: "R1", text: `0/0 installed: ${routeText(rib({ ...s, statics: [...s.statics, FLOATING_DEFAULT] }).find((r) => r.len === 0)!)}` } }), "STEP_ENTERED"),
  act("fail-a", "ISP-A goes down", "ISP-A's circuit fails and Gi0/1 goes down. The primary default route is unusable, so the floating route — the only 0.0.0.0/0 left — is installed. Browsing continues via ISP-B.", (s) => forward("fail-a", "8.8.8.8")({ ...s, ifUp: { ...s.ifUp, "Gi0/1": false } }), "PACKET_SENT"),
  act("restore-a", "ISP-A returns", "The circuit comes back. AD 1 beats 250 again: the primary returns to the table, the floating route steps back, and traffic shifts to ISP-A without anyone touching R1.", (s) => forward("restore-a", "8.8.8.8")({ ...s, ifUp: { ...s.ifUp, "Gi0/1": true } }), "PACKET_SENT"),
  act("ipv6", "The same, for IPv6", "IPv6 static routes follow identical rules: ipv6 route ::/0 2001:db8:a::1, and a floating ::/0 via ISP-B's link-local address fe80::b with AD 250. A ping to 2001:4860:4860::8888 leaves via ISP-A.", (s) => forward("ipv6", "2001:4860:4860::8888")({ ...s, statics: [...s.statics, V6_DEFAULT, V6_FLOATING] }), "PACKET_SENT", q("Why must the IPv6 floating route name the interface (Gi0/2) as well as fe80::b?", [["ll", "Link-local addresses are only unique on one link, so R1 can't tell which link fe80::b is on"], ["ipv6", "IPv6 routes always need an interface"], ["ad", "Floating routes need an interface"]], "ll", "Every link has its own fe80::/64. fe80::b could exist on any interface, so a link-local next hop is meaningless without the exit interface.")),
  // incident
  act("fault-injected", "A backup for the branch", "To keep the branch reachable if the MPLS WAN fails, an engineer adds a route via the LTE router: ip route 10.50.0.0 255.255.0.0 10.0.40.2 5 — ‘a small AD, so it's a backup’.", (s) => ({ ...s, statics: [...s.statics, BAD_BACKUP], faultActive: true, packet: undefined, flood: [], decision: { device: "R1", text: "static 10.50.0.0/16 AD 5 configured" } }), "STEP_ENTERED"),
  act("inc-traffic", "The branch is slow — and the bill arrives", "Branch users complain that file shares crawl, and the LTE data bill jumps. The MPLS WAN and its OSPF adjacency are perfectly healthy.", forward("inc-traffic", "10.50.1.20"), "PACKET_SENT"),
  say("trouble-question", "Diagnose", "OSPF still has 10.50.0.0/16 in its database with cost 20. show ip route lists 10.50.0.0/16 once.", {
    question: q("Why is branch traffic going over LTE?", [["ad", "The static route's AD 5 is lower than OSPF's 110, so the static is installed instead of the OSPF route"], ["lpm", "The static route is more specific"], ["ospf", "The OSPF route has a higher metric"], ["lte", "LTE is faster than MPLS"]], "ad", "Both routes are 10.50.0.0/16 — same length, so it's an AD contest, and 5 < 110. A floating static must have an AD higher than the route it backs up. Metrics never compare across protocols.", ["Same prefix length?", "What decides between two sources?", "What should a backup's AD be relative to OSPF?"]),
  }),
  say("diagnostic-layers", "Troubleshooting layers", "From the bottom: the WAN link and OSPF neighbour, the OSPF route, which route the RIB installed and why, and the path the traffic takes."),
  repairStep("repair-challenge", "Repair", "Choose the change that fixes the cause.", SR_REPAIR_CORRECT, (s) => ({ ...s, statics: s.statics.map((c) => (c === BAD_BACKUP ? GOOD_BACKUP : c)), decision: { device: "R1", text: "ip route 10.50.0.0 255.255.0.0 10.0.40.2 250" } })),
  act("verify", "OSPF wins again", "With AD 250 the static floats: OSPF's route (AD 110) is installed and branch traffic is back on the WAN.", forward("verify", "10.50.1.20"), "PACKET_SENT"),
  act("verify-failover", "And the backup still works", "Proof that it's still a backup: the WAN link drops, OSPF's route disappears, and the floating static installs. Branch traffic moves to LTE until the WAN returns.", (s) => forward("verify-failover", "10.50.1.20")({ ...s, ifUp: { ...s.ifUp, "Gi0/3": false } }), "PACKET_SENT"),
  say("complete", "Static routing", "Codes, AD and metric in every line; longest prefix match for forwarding; lowest AD per prefix for installation; default, network and host routes; floating statics with an AD above the route they protect — in IPv4 and IPv6."),
];
