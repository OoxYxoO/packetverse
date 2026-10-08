import type { PacketVisual, PVEvent, PVEventType, ScenarioStep } from "../types";
import type { ProcessingStage } from "@/components/network3d/types";
import type { FundHop } from "@/components/lesson/fundamentalsTrace";
import { fieldOf, hex4, icmpPacket, ipToNum, ipv4Checksum, packetStack, type IcmpEcho, type Ipv4Fields } from "./fundamentalsPackets";

/**
 * Routing Fundamentals: Static Routes & Longest Prefix Match — HOST-A — R1 — R2 — SERVER-A / SERVER-B.
 *
 * Modeled exactly (RFC 1812 forwarding, RFC 4632 classless prefixes):
 * - Connected routes exist because an interface is configured and up; static routes (including the 0.0.0.0/0
 *   default) are operator-configured. No dynamic routing protocol runs anywhere in this lesson.
 * - A router finds EVERY installed route whose prefix contains the destination and selects the longest prefix.
 *   Less-specific routes stay installed; they just lose this particular lookup.
 * - A static route's next hop is resolved recursively: 10.0.12.2 lies inside R1's connected 10.0.12.0/30, which gives
 *   the egress interface; the next hop's MAC comes from the ARP cache (already resolved here — the ARP lesson covers it).
 * - Forwarding rebuilds the Ethernet frame for the next link, decrements TTL by one and recomputes the IPv4 header
 *   checksum. IPv4 source and destination never change (no NAT). The next-hop address never goes in the packet.
 * - A discard route that wins the lookup drops the packet locally (silently in this model — a "reject" variant
 *   would return ICMP unreachable). It is not an interface, ARP, firewall or R2 failure.
 * - A router with no matching route drops the packet (routers normally also return ICMP Destination Unreachable,
 *   Net Unreachable 3/0 — not drawn here).
 * Test traffic is ICMP Echo (ping), carried directly in IPv4.
 */

export type RtRouter = "R1" | "R2";
export type RtHost = "HOST-A" | "SERVER-A" | "SERVER-B";
export type RtDevice = RtHost | RtRouter;
export const RT_DEVICES: RtDevice[] = ["HOST-A", "R1", "R2", "SERVER-A", "SERVER-B"];
export const RT_ADDR = { "HOST-A": "10.10.10.10", "R1:LAN": "10.10.10.1", "R1:TRANSIT": "10.0.12.1", "R2:TRANSIT": "10.0.12.2", "R2:SRV": "172.16.50.1", "SERVER-A": "172.16.50.50", "SERVER-B": "172.16.50.200" } as const;
export const RT_MAC = { "HOST-A": "00:00:5E:00:53:10", "R1:LAN": "00:00:5E:00:53:11", "R1:TRANSIT": "00:00:5E:00:53:12", "R2:TRANSIT": "00:00:5E:00:53:21", "R2:SRV": "00:00:5E:00:53:22", "SERVER-A": "00:00:5E:00:53:50", "SERVER-B": "00:00:5E:00:53:C8" } as const;
/** A destination outside every specific route — only the default matches it on R1. */
export const OUTSIDE_DST = "203.0.113.80";
export const ECHO_ID = 1001;
export const INITIAL_TTL = 64;
export const HOST_PREFIX: Record<RtHost, { net: string; len: number; gw: string; gwDev: RtRouter; gwMac: string; ip: string; mac: string }> = {
  "HOST-A": { net: "10.10.10.0", len: 24, gw: RT_ADDR["R1:LAN"], gwDev: "R1", gwMac: RT_MAC["R1:LAN"], ip: RT_ADDR["HOST-A"], mac: RT_MAC["HOST-A"] },
  "SERVER-A": { net: "172.16.50.0", len: 24, gw: RT_ADDR["R2:SRV"], gwDev: "R2", gwMac: RT_MAC["R2:SRV"], ip: RT_ADDR["SERVER-A"], mac: RT_MAC["SERVER-A"] },
  "SERVER-B": { net: "172.16.50.0", len: 24, gw: RT_ADDR["R2:SRV"], gwDev: "R2", gwMac: RT_MAC["R2:SRV"], ip: RT_ADDR["SERVER-B"], mac: RT_MAC["SERVER-B"] },
};

/** Router interfaces: address/prefix, MAC, and the device(s) on the other side. */
export const RT_IFACES: Record<RtRouter, { name: string; addr: string; len: number; mac: string; link: string }[]> = {
  R1: [
    { name: "ge-0/0/0", addr: RT_ADDR["R1:LAN"], len: 24, mac: RT_MAC["R1:LAN"], link: "HOST-A LAN" },
    { name: "ge-0/0/1", addr: RT_ADDR["R1:TRANSIT"], len: 30, mac: RT_MAC["R1:TRANSIT"], link: "R1–R2 transit" },
  ],
  R2: [
    { name: "ge-0/0/1", addr: RT_ADDR["R2:TRANSIT"], len: 30, mac: RT_MAC["R2:TRANSIT"], link: "R1–R2 transit" },
    { name: "ge-0/0/0", addr: RT_ADDR["R2:SRV"], len: 24, mac: RT_MAC["R2:SRV"], link: "Server LAN" },
  ],
};
/** Already-resolved ARP caches (IP → MAC, and the device that owns it). */
export const RT_ARP: Record<RtRouter, Record<string, { mac: string; dev: RtDevice }>> = {
  R1: { [RT_ADDR["HOST-A"]]: { mac: RT_MAC["HOST-A"], dev: "HOST-A" }, [RT_ADDR["R2:TRANSIT"]]: { mac: RT_MAC["R2:TRANSIT"], dev: "R2" } },
  R2: { [RT_ADDR["R1:TRANSIT"]]: { mac: RT_MAC["R1:TRANSIT"], dev: "R1" }, [RT_ADDR["SERVER-A"]]: { mac: RT_MAC["SERVER-A"], dev: "SERVER-A" }, [RT_ADDR["SERVER-B"]]: { mac: RT_MAC["SERVER-B"], dev: "SERVER-B" } },
};

export type RouteSource = "connected" | "static";
export interface Route {
  prefix: string;
  len: number;
  source: RouteSource;
  /** Connected routes name their interface; static routes name a next hop (resolved recursively) or discard. */
  iface?: string;
  nextHop?: string;
  discard?: boolean;
}
export const routeKey = (r: Route) => `${r.prefix}/${r.len}`;
export const routeText = (r: Route) => `${routeKey(r)} ${r.source === "connected" ? `connected ${r.iface}` : r.discard ? "static discard" : `static via ${r.nextHop}`}`;
/** Tables are listed the way routers display them: by prefix address, then prefix length. */
export const sortRib = (rib: Route[]) => [...rib].sort((a, b) => ipToNum(a.prefix) - ipToNum(b.prefix) || a.len - b.len);
export const DISCARD_25: Route = { prefix: "172.16.50.0", len: 25, source: "static", discard: true };
const NH = RT_ADDR["R2:TRANSIT"];
export const R1_HEALTHY: Route[] = sortRib([
  { prefix: "10.10.10.0", len: 24, source: "connected", iface: "ge-0/0/0" },
  { prefix: "10.0.12.0", len: 30, source: "connected", iface: "ge-0/0/1" },
  { prefix: "172.16.50.0", len: 24, source: "static", nextHop: NH },
  { prefix: "172.16.0.0", len: 16, source: "static", nextHop: NH },
  { prefix: "0.0.0.0", len: 0, source: "static", nextHop: NH },
]);
export const R2_TABLE: Route[] = sortRib([
  { prefix: "10.0.12.0", len: 30, source: "connected", iface: "ge-0/0/1" },
  { prefix: "172.16.50.0", len: 24, source: "connected", iface: "ge-0/0/0" },
  { prefix: "10.10.10.0", len: 24, source: "static", nextHop: RT_ADDR["R1:TRANSIT"] },
]);

export const inPrefix = (ip: string, prefix: string, len: number) => len === 0 || Math.floor(ipToNum(ip) / 2 ** (32 - len)) === Math.floor(ipToNum(prefix) / 2 ** (32 - len));
/** Every installed route containing `dst`, longest prefix first. */
export const matchingRoutes = (rib: Route[], dst: string) => rib.filter((r) => inPrefix(dst, r.prefix, r.len)).sort((a, b) => b.len - a.len);
/** Recursive next-hop resolution through a connected route. */
export function resolve(router: RtRouter, rib: Route[], route: Route, dst: string) {
  const nh = route.source === "connected" ? dst : route.nextHop!;
  const via = rib.find((r) => r.source === "connected" && inPrefix(nh, r.prefix, r.len));
  const arp = RT_ARP[router][nh];
  return { nextHop: nh, via, iface: via?.iface ?? route.iface, arp };
}

export type LookupOutcome = "forward" | "discard" | "no-route";
export interface LookupRecord {
  router: RtRouter;
  dst: string;
  matches: string[];
  selected?: string;
  outcome: LookupOutcome;
  nextHop?: string;
  iface?: string;
}
export type ProbeResult = "untested" | "reachable" | "dropped at R1 (discard route)" | "forwarded via /24";
export interface RtState {
  hops: FundHop[];
  rib: Record<RtRouter, Route[]>;
  packet?: PacketVisual;
  /** The latest route lookup (router, matches, winner) — lives in the inspectors and routing panel, never in the packet. */
  lookup?: LookupRecord;
  results: { "SERVER-A": ProbeResult; "SERVER-B": ProbeResult; outside?: string };
  note?: { device: RtDevice; text: string };
  faultActive: boolean;
  repairAttempt?: { choice: string; correct: boolean };
  repaired: boolean;
}
export const createRtState = (): RtState => ({ hops: [], rib: { R1: R1_HEALTHY, R2: R2_TABLE }, results: { "SERVER-A": "untested", "SERVER-B": "untested" }, faultActive: false, repaired: false });

// ---------------------------------------------------------------------------------------------------------------
// Stages
// ---------------------------------------------------------------------------------------------------------------
export const ROUTER_STAGES: ProcessingStage[] = [
  { id: "rx", label: "Receive frame · dst MAC is mine · remove Ethernet" },
  { id: "match", label: "Find EVERY route containing the IPv4 destination" },
  { id: "select", label: "Select the longest matching prefix" },
  { id: "resolve", label: "Resolve next hop → egress interface + MAC" },
  { id: "ttl", label: "TTL − 1 · recompute header checksum" },
  { id: "tx", label: "Build a new Ethernet frame for the next link" },
];
export const HOST_TX_STAGES: ProcessingStage[] = [
  { id: "mask", label: "Destination inside my own prefix?" },
  { id: "gw", label: "Off-link → Layer-2 next hop = default gateway" },
  { id: "build", label: "IPv4 + ICMP Echo (destination stays the server)" },
  { id: "tx", label: "Ethernet frame to the gateway's MAC" },
];
export const HOST_RX_STAGES: ProcessingStage[] = [
  { id: "rx", label: "Receive · destination MAC and IPv4 are mine" },
  { id: "icmp", label: "Read ICMP Echo" },
  { id: "act", label: "Accept / reply" },
];
const withDetail = (base: ProcessingStage[], d: Partial<Record<string, string>>): ProcessingStage[] => base.map((x) => (d[x.id] ? { ...x, detail: d[x.id] } : x));
const ev = (type: PVEventType, stepId: string, message: string): PVEvent => ({ type, stepId, timestamp: Date.now(), message });
const push = (s: RtState, hop: FundHop, patch: Partial<RtState> = {}): RtState => ({ ...s, ...patch, hops: [...s.hops, hop] });
const idle = (s: RtState): RtState => ({ ...s, packet: undefined, note: undefined, lookup: undefined });

// ---------------------------------------------------------------------------------------------------------------
// Reading packets back
// ---------------------------------------------------------------------------------------------------------------
export function ipFieldsOf(p: PacketVisual): Ipv4Fields {
  return { src: fieldOf(p, /^IPv4/, "Source"), dst: fieldOf(p, /^IPv4/, "Destination"), ttl: Number(fieldOf(p, /^IPv4/, "TTL")), protocol: 1, payloadLength: Number(fieldOf(p, /^IPv4/, "Total Length")) - 20, id: parseInt(fieldOf(p, /^IPv4/, "Identification"), 16), df: false };
}
function echoOf(p: PacketVisual): IcmpEcho {
  return { kind: fieldOf(p, /^ICMP/, "Type").startsWith("8") ? "echo-request" : "echo-reply", identifier: parseInt(fieldOf(p, /^ICMP/, "Identifier"), 10), sequence: Number(fieldOf(p, /^ICMP/, "Sequence Number")), dataLength: parseInt(fieldOf(p, /^ICMP/, "Data"), 10) };
}
export const ethDstOf = (p: PacketVisual) => fieldOf(p, /^Ethernet/, "Destination MAC");
export const ethSrcOf = (p: PacketVisual) => fieldOf(p, /^Ethernet/, "Source MAC");
const deviceOfIp = (ip: string): string => (Object.entries(RT_ADDR).find(([, v]) => v === ip)?.[0] ?? ip).replace(/:.*/, "");

// ---------------------------------------------------------------------------------------------------------------
// Device actions
// ---------------------------------------------------------------------------------------------------------------
function hostSend(s: RtState, stepId: string, host: RtHost, dst: string, kind: IcmpEcho["kind"], seq: number): RtState {
  const h = HOST_PREFIX[host];
  const onLink = inPrefix(dst, h.net, h.len);
  const icmp: IcmpEcho = { kind, identifier: ECHO_ID, sequence: seq, dataLength: 56 };
  const pkt = icmpPacket({ id: `${stepId}-${host}`, from: host, to: h.gwDev, ethSrc: h.mac, ethDst: h.gwMac, ip: { src: h.ip, dst, ttl: INITIAL_TTL, id: (host === "HOST-A" ? 0x1000 : 0x5000) + seq, df: false }, icmp });
  const hop: FundHop = {
    stepId,
    device: host,
    stages: withDetail(HOST_TX_STAGES, { mask: `${dst} in ${h.net}/${h.len}? ${onLink ? "yes" : "no"}`, gw: `L2 next hop ${h.gw} (${h.gwDev})`, build: `${h.ip} → ${dst} · TTL ${INITIAL_TTL} · ${kind === "echo-request" ? "Echo Request" : "Echo Reply"} seq ${seq}`, tx: `dst MAC ${h.gwMac}` }),
    activeStageId: "tx",
    egressInterfaceId: "eth0",
    lookupType: "On-link check (own prefix)",
    lookupKey: dst,
    lookupResult: `off-link → default gateway ${h.gw}`,
    action: kind === "echo-request" ? "ECHO REQUEST" : "ECHO REPLY",
    reason: `${dst} is not inside ${host}'s own ${h.net}/${h.len}, so ${host} hands the packet to its default gateway ${h.gw}: the Ethernet destination is the gateway's MAC ${h.gwMac}, while the IPv4 destination stays ${dst}.`,
    input: kind === "echo-reply" ? `Echo Request seq ${seq}` : "(originated here)",
    output: `IPv4 ${h.ip} → ${dst} · Ethernet → ${h.gwMac}`,
    nextHopId: h.gwDev,
    after: packetStack(pkt),
  };
  return push(s, hop, { packet: pkt, lookup: undefined, note: { device: host, text: `${host}: off-link → gateway ${h.gw}` } });
}

const inIfaceOf = (r: RtRouter, from: string) => (r === "R1" ? (from === "HOST-A" ? "ge-0/0/0" : "ge-0/0/1") : from === "R1" ? "ge-0/0/1" : "ge-0/0/0");

/** One router handles the packet it holds, up to `stage`. At "tx" it forwards, discards or drops for lack of a route. */
function routerStep(s: RtState, stepId: string, r: RtRouter, inPkt: PacketVisual, stage: "rx" | "select" | "tx"): RtState {
  const ip = ipFieldsOf(inPkt);
  const rib = s.rib[r];
  const inIface = inIfaceOf(r, inPkt.from);
  const matches = matchingRoutes(rib, ip.dst);
  const win = matches[0];
  const res = win && !win.discard ? resolve(r, rib, win, ip.dst) : undefined;
  const outcome: LookupOutcome = !win ? "no-route" : win.discard ? "discard" : "forward";
  const lookup: LookupRecord = { router: r, dst: ip.dst, matches: matches.map(routeKey), selected: win ? routeKey(win) : undefined, outcome, nextHop: res?.nextHop, iface: res?.iface };
  const matchText = matches.length ? `${matches.length} match${matches.length === 1 ? "" : "es"}: ${matches.map((m) => `/${m.len}${m.discard ? " discard" : ""}`).join(", ")}` : "no installed route contains it";
  const winText = win ? routeText(win) : "—";
  const outIf = res ? RT_IFACES[r].find((i) => i.name === res.iface) : undefined;
  const fwdFields: Ipv4Fields = { ...ip, ttl: ip.ttl - 1 };
  const detail: Partial<Record<string, string>> = { rx: `on ${inIface} · dst MAC ${ethDstOf(inPkt)} (mine) · IPv4 → ${ip.dst}` };
  if (stage !== "rx") {
    detail.match = matchText;
    detail.select = win ? `longest: ${winText}` : "nothing to select";
  }
  if (stage === "tx" && res) {
    detail.resolve = win?.source === "static" ? `${res.nextHop} ∈ connected ${res.via ? routeKey(res.via) : "?"} → ${res.iface} · ARP ${res.nextHop} → ${res.arp?.mac}` : `destination on connected ${routeKey(win!)} → ${res.iface} · ARP ${res.nextHop} → ${res.arp?.mac}`;
    detail.ttl = `TTL ${ip.ttl} → ${ip.ttl - 1} · checksum ${hex4(ipv4Checksum(ip))} → ${hex4(ipv4Checksum(fwdFields))}`;
    detail.tx = `Ethernet ${outIf?.mac} → ${res.arp?.mac}`;
  }
  const base = {
    stepId,
    device: r,
    ingressInterfaceId: inIface,
    lookupType: `${r} routing table (longest prefix match)`,
    lookupKey: ip.dst,
    before: packetStack(inPkt),
  };
  if (stage === "rx") {
    const hop: FundHop = { ...base, stages: withDetail(ROUTER_STAGES, detail), activeStageId: "rx", lookupResult: "lookup pending", action: "RECEIVE", reason: `The frame's destination MAC is ${r} ${inIface}'s own, so ${r} removes the Ethernet header and reads the IPv4 destination ${ip.dst}. Routing starts from that address alone.`, input: `IPv4 ${ip.src} → ${ip.dst} · TTL ${ip.ttl}`, output: "route lookup next" };
    return push(s, hop, { packet: { ...inPkt, to: r }, lookup: undefined, note: { device: r, text: `${r}: received · IPv4 → ${ip.dst}` } });
  }
  if (stage === "select") {
    const hop: FundHop = { ...base, stages: withDetail(ROUTER_STAGES, detail), activeStageId: "select", lookupResult: `${matchText} → ${winText}`, action: `LPM · ${win ? routeKey(win) : "NO ROUTE"}`, reason: win ? `${matches.length} installed route${matches.length === 1 ? "" : "s"} contain ${ip.dst}. ${routeKey(win)} is the longest prefix — it matches the most leading bits of the destination — so it wins. The others stay installed; they just lose this lookup.` : `No installed route contains ${ip.dst}.`, input: `IPv4 → ${ip.dst}`, output: winText };
    return push(s, hop, { packet: { ...inPkt, to: r }, lookup, note: { device: r, text: `${r}: longest match ${win ? routeKey(win) : "none"}` } });
  }
  if (outcome !== "forward") {
    const hop: FundHop = {
      ...base,
      stages: withDetail(ROUTER_STAGES, { ...detail, select: outcome === "discard" ? `longest: ${winText} → drop here` : "no route → drop" }),
      activeStageId: outcome === "discard" ? "select" : "match",
      lookupResult: `${matchText} → ${outcome === "discard" ? `${routeKey(win!)} discard` : "no route"}`,
      action: outcome === "discard" ? "DISCARD ROUTE · DROP" : "NO ROUTE · DROP",
      reason:
        outcome === "discard"
          ? `${routeKey(win!)} is a discard route and it is the longest match for ${ip.dst}, so ${r} drops the packet right here. The ${matches.slice(1).map(routeKey).join(", ")} route${matches.length > 2 ? "s are" : " is"} still installed — they simply lose to the longer /${win!.len}.`
          : `None of ${r}'s routes contains ${ip.dst}, and ${r} has no default route. The packet cannot continue. (A router normally also returns ICMP Destination Unreachable, Net Unreachable, to the source.)`,
      input: `IPv4 ${ip.src} → ${ip.dst} · TTL ${ip.ttl}`,
      output: "dropped",
    };
    return push(s, hop, { packet: undefined, lookup, note: { device: r, text: `${r}: ${outcome === "discard" ? `discard route ${routeKey(win!)}` : "no route"} → dropped` } });
  }
  const next = res!.arp!;
  const fwd = icmpPacket({ id: `${stepId}-${r}`, from: r, to: next.dev, ethSrc: outIf!.mac, ethDst: next.mac, ip: { src: ip.src, dst: ip.dst, ttl: ip.ttl - 1, id: ip.id, df: false }, icmp: echoOf(inPkt) });
  const hop: FundHop = {
    ...base,
    stages: withDetail(ROUTER_STAGES, detail),
    activeStageId: "tx",
    egressInterfaceId: res!.iface,
    lookupResult: `${matchText} → ${winText}`,
    action: "FORWARD",
    reason: `${routeKey(win!)} wins (longest match). ${win!.source === "static" ? `Its next hop ${res!.nextHop} is reached through connected ${res!.via ? routeKey(res!.via) : ""} on ${res!.iface}.` : `The destination is on the connected network behind ${res!.iface}.`} ${r} decrements TTL to ${ip.ttl - 1}, recomputes the header checksum and wraps the unchanged IPv4 addresses in a NEW Ethernet frame to ${next.mac}.`,
    input: `IPv4 ${ip.src} → ${ip.dst} · TTL ${ip.ttl} · Ethernet → ${ethDstOf(inPkt)}`,
    output: `IPv4 ${ip.src} → ${ip.dst} · TTL ${ip.ttl - 1} · Ethernet ${outIf!.mac} → ${next.mac} out ${res!.iface}`,
    nextHopId: next.dev,
    after: packetStack(fwd, ["eth", "ip"]),
    mutations: [
      { type: "TTL_CHANGE", detail: `${ip.ttl} → ${ip.ttl - 1}` },
      { type: "SA_CHANGE", detail: `Ethernet src → ${outIf!.mac}` },
      { type: "DA_CHANGE", detail: `Ethernet dst → ${next.mac}` },
    ],
  };
  return push(s, hop, { packet: fwd, lookup, note: { device: r, text: `${r}: ${routeKey(win!)} → ${next.dev} · TTL ${ip.ttl}→${ip.ttl - 1}` } });
}

function hostReceive(s: RtState, stepId: string, host: RtHost, inPkt: PacketVisual, act: string): RtState {
  const ip = ipFieldsOf(inPkt);
  const e = echoOf(inPkt);
  const hop: FundHop = {
    stepId,
    device: host,
    stages: withDetail(HOST_RX_STAGES, { rx: `from ${ip.src} · TTL ${ip.ttl} (not decremented)`, icmp: `${e.kind === "echo-request" ? "Echo Request" : "Echo Reply"} seq ${e.sequence}`, act }),
    activeStageId: "act",
    ingressInterfaceId: "eth0",
    lookupType: "Local delivery",
    lookupKey: ip.dst,
    lookupResult: "my address",
    action: act.toUpperCase(),
    reason: `${host} owns ${ip.dst}. The packet arrives with TTL ${ip.ttl}: ${INITIAL_TTL - ip.ttl} router${INITIAL_TTL - ip.ttl === 1 ? "" : "s"} forwarded it.`,
    input: `IPv4 ${ip.src} → ${ip.dst} · TTL ${ip.ttl}`,
    output: act,
    before: packetStack(inPkt),
  };
  return push(s, hop, { note: { device: host, text: `${host}: ${act}` } });
}

// ---------------------------------------------------------------------------------------------------------------
// Repair
// ---------------------------------------------------------------------------------------------------------------
export const RT_REPAIR_OPTIONS = [
  { id: "remove-25", label: "Remove the static 172.16.50.0/25 discard route from R1" },
  { id: "change-default", label: "Point R1's default route at a different next hop" },
  { id: "add-16", label: "Add another static 172.16.0.0/16 route via 10.0.12.2" },
  { id: "raise-ttl", label: "Raise HOST-A's initial TTL to 128" },
  { id: "flush-arp", label: "Flush R1's ARP cache" },
] as const;
export const RT_REPAIR_CORRECT = "remove-25";
export function applyRtRepair(s: RtState, choice: string): RtState {
  const correct = choice === RT_REPAIR_CORRECT;
  if (!correct) return { ...s, repairAttempt: { choice, correct } };
  return { ...s, repairAttempt: { choice, correct }, repaired: true, rib: { ...s.rib, R1: s.rib.R1.filter((r) => routeKey(r) !== routeKey(DISCARD_25)) }, packet: undefined, lookup: undefined, note: { device: "R1", text: "R1: static 172.16.50.0/25 discard removed" } };
}

// ---------------------------------------------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------------------------------------------
const pkt = (s: RtState) => s.packet;
const SA = RT_ADDR["SERVER-A"];
const SB = RT_ADDR["SERVER-B"];
const HA = RT_ADDR["HOST-A"];

/** Forward the packet through each router in turn (for compressed return legs), ending at the last router's output. */
const chain = (s: RtState, stepId: string, routers: RtRouter[]) => routers.reduce((acc, r) => routerStep(acc, stepId, r, acc.packet!, "tx"), s);

export const routingFundamentalsSteps: ScenarioStep<RtState>[] = [
  {
    id: "intro",
    label: "Two routers, three networks",
    narrative: `HOST-A (${HA}/24) reaches two servers — SERVER-A ${SA} and SERVER-B ${SB} — through R1 and R2. There is no routing protocol here: every route is either connected or typed in by an operator. You'll read routing tables, watch longest-prefix match pick a winner, and fix a route that silently eats traffic.`,
  },
  {
    id: "topology",
    label: "Addresses and links",
    narrative: `HOST-A LAN 10.10.10.0/24 (R1 ge-0/0/0 = ${RT_ADDR["R1:LAN"]}). Transit 10.0.12.0/30 (R1 ge-0/0/1 = ${RT_ADDR["R1:TRANSIT"]}, R2 ge-0/0/1 = ${RT_ADDR["R2:TRANSIT"]}). Server LAN 172.16.50.0/24 (R2 ge-0/0/0 = ${RT_ADDR["R2:SRV"]}); both servers use ${RT_ADDR["R2:SRV"]} as their gateway. ARP entries are already resolved (the ARP lesson covers how).`,
  },
  {
    id: "predict-connected",
    label: "Predict: where routes come from",
    narrative: "R1's table already contains 10.10.10.0/24 and 10.0.12.0/30. Nobody typed a route for either.",
    question: {
      prompt: "Why does R1 have routes for 10.10.10.0/24 and 10.0.12.0/30?",
      options: [
        { id: "connected", label: "They're connected routes: each comes from an IPv4 interface that is configured and up" },
        { id: "static", label: "An operator configured them as static routes" },
        { id: "ospf", label: "R1 learned them from R2 with a routing protocol" },
        { id: "arp", label: "R1 built them from its ARP cache" },
      ],
      correctOptionId: "connected",
      explanation: "Configuring 10.10.10.1/24 on an interface that is up puts 10.10.10.0/24 in the table as connected. The same goes for 10.0.12.1/30. No routing protocol runs in this lesson.",
    },
  },
  {
    id: "connected-routes",
    label: "Connected routes",
    narrative: "R1: 10.10.10.0/24 connected on ge-0/0/0, 10.0.12.0/30 connected on ge-0/0/1. R2: 10.0.12.0/30 on ge-0/0/1, 172.16.50.0/24 on ge-0/0/0. A connected route means 'the destination is on this wire — send straight to it'.",
    run: (s) => {
      const hop: FundHop = {
        stepId: "connected-routes",
        device: "R1",
        stages: [
          { id: "if0", label: "ge-0/0/0 10.10.10.1/24 · up", detail: "→ 10.10.10.0/24 connected" },
          { id: "if1", label: "ge-0/0/1 10.0.12.1/30 · up", detail: "→ 10.0.12.0/30 connected" },
          { id: "rib", label: "Installed in the routing table", detail: "source: connected" },
        ],
        activeStageId: "rib",
        lookupType: "Interface state",
        lookupKey: "configured + up interfaces",
        lookupResult: "2 connected routes",
        action: "CONNECTED",
        reason: "An interface that is configured with an address and prefix, and is up, contributes its network as a connected route. It disappears if the interface goes down.",
        input: "ge-0/0/0 10.10.10.1/24 · ge-0/0/1 10.0.12.1/30",
        output: "10.10.10.0/24, 10.0.12.0/30 (connected)",
      };
      return { state: push(idle(s), hop), events: [ev("STEP_ENTERED", "connected-routes", "Connected routes")] };
    },
    whatChanged: () => ["R1: 2 connected routes", "R2: 2 connected routes"],
  },
  {
    id: "static-routes",
    label: "Static routes and their next hop",
    narrative: `An operator configured R1: 172.16.50.0/24 via ${NH} and 172.16.0.0/16 via ${NH}. A static route names a NEXT HOP, not an exit — R1 finds the exit by resolving ${NH} recursively: it lies inside the connected 10.0.12.0/30, so it is reached out ge-0/0/1. R2 has one static return route: 10.10.10.0/24 via ${RT_ADDR["R1:TRANSIT"]}.`,
    run: (s) => {
      const hop: FundHop = {
        stepId: "static-routes",
        device: "R1",
        stages: [
          { id: "cfg", label: "Operator-configured routes", detail: `172.16.50.0/24 and 172.16.0.0/16 via ${NH}` },
          { id: "rec", label: "Resolve the next hop recursively", detail: `${NH} ∈ connected 10.0.12.0/30` },
          { id: "out", label: "Egress interface found", detail: "ge-0/0/1" },
        ],
        activeStageId: "out",
        lookupType: "Next-hop resolution",
        lookupKey: NH,
        lookupResult: "via connected 10.0.12.0/30 → ge-0/0/1",
        action: "STATIC",
        reason: `A static route is only usable while its next hop is reachable. ${NH} is inside R1's connected transit network, so the route resolves to ge-0/0/1. The next-hop address is used to pick the exit and the neighbor's MAC — it never replaces the packet's IPv4 destination.`,
        input: `static 172.16.50.0/24 via ${NH}`,
        output: "resolved → ge-0/0/1",
      };
      return { state: push(idle(s), hop), events: [ev("STEP_ENTERED", "static-routes", "Static routes")] };
    },
    whatChanged: () => ["R1: 2 static routes via 10.0.12.2", "R2: static return route 10.10.10.0/24 via 10.0.12.1"],
  },
  {
    id: "default-route",
    label: "The default route",
    narrative: `R1 also has 0.0.0.0/0 via ${NH} — a static default route. A /0 has no network bits at all, so it matches EVERY IPv4 destination. That is exactly why it is used only when nothing more specific matches.`,
  },
  {
    id: "predict-host-l2",
    label: "Predict: HOST-A's frame",
    narrative: `HOST-A is about to ping SERVER-A (${SA}).`,
    question: {
      prompt: `What destination addresses does HOST-A put on its first frame to ${SA}?`,
      options: [
        { id: "gw-mac", label: `Ethernet → R1's ge-0/0/0 MAC; IPv4 destination stays ${SA}` },
        { id: "server-mac", label: `Ethernet → SERVER-A's MAC; IPv4 destination ${SA}` },
        { id: "gw-ip", label: `Ethernet → R1's MAC; IPv4 destination changed to ${RT_ADDR["R1:LAN"]}` },
        { id: "bcast", label: `Ethernet broadcast; IPv4 destination ${SA}` },
      ],
      correctOptionId: "gw-mac",
      explanation: `${SA} is outside 10.10.10.0/24, so the Layer-2 next hop is the default gateway ${RT_ADDR["R1:LAN"]}. Only the Ethernet destination points at R1. The IPv4 destination is the final target all the way.`,
    },
  },
  {
    id: "a-sends",
    label: "HOST-A → SERVER-A",
    narrative: `HOST-A sends an Echo Request: IPv4 ${HA} → ${SA}, TTL ${INITIAL_TTL}, in a frame to R1's MAC ${RT_MAC["R1:LAN"]}.`,
    run: (s) => ({ state: hostSend(idle(s), "a-sends", "HOST-A", SA, "echo-request", 1), events: [ev("PACKET_SENT", "a-sends", "HOST-A pings SERVER-A")] }),
    packet: pkt,
    whatChanged: () => ["Off-link → gateway 10.10.10.1", `IPv4 destination ${SA}`],
  },
  {
    id: "r1-receives",
    label: "R1 receives",
    narrative: `The frame is addressed to R1's own MAC, so R1 takes it, removes the Ethernet header and reads the IPv4 destination: ${SA}. Now it has to choose a route.`,
    run: (s) => ({ state: routerStep(s, "r1-receives", "R1", pkt(s)!, "rx"), events: [ev("PACKET_RECEIVED", "r1-receives", "R1 receives")] }),
    packet: pkt,
  },
  {
    id: "predict-lpm",
    label: "Predict: which route wins?",
    narrative: `Look at R1's routing table. Several entries could describe ${SA}.`,
    packet: pkt,
    question: {
      prompt: `Which installed route does R1 select for ${SA}?`,
      options: [
        { id: "24", label: "172.16.50.0/24 via 10.0.12.2 — the longest matching prefix" },
        { id: "16", label: "172.16.0.0/16 via 10.0.12.2 — it covers the whole range" },
        { id: "0", label: "0.0.0.0/0 — the default is used for anything remote" },
        { id: "first", label: "Whichever matching route was configured first" },
      ],
      correctOptionId: "24",
      explanation: "All three contain 172.16.50.50: /24, /16 and /0. Forwarding picks the most specific match, the one with the longest prefix. Configuration order, and the idea of a 'metric', play no part in this choice.",
    },
  },
  {
    id: "r1-selects",
    label: "R1: longest prefix match",
    narrative: `R1 collects every route that contains ${SA}: 172.16.50.0/24, 172.16.0.0/16 and 0.0.0.0/0. The /24 matches 24 leading bits, the /16 only 16, the /0 none. The /24 wins. The other two stay in the table.`,
    run: (s) => ({ state: routerStep(s, "r1-selects", "R1", pkt(s)!, "select"), events: [ev("ROUTE_LOOKUP", "r1-selects", "R1 selects 172.16.50.0/24")] }),
    packet: pkt,
    whatChanged: (_p, n) => [`Matches: ${n.lookup?.matches.join(", ") ?? ""}`, `Selected: ${n.lookup?.selected ?? ""}`],
  },
  {
    id: "predict-default-override",
    label: "Predict: does the default matter?",
    narrative: "Suppose someone changed R1's default route to a different next hop.",
    packet: pkt,
    question: {
      prompt: `Would changing the default route change how ${SA} is forwarded?`,
      options: [
        { id: "no", label: "No — the /24 is a longer match, so the default never wins this lookup" },
        { id: "yes", label: "Yes — the default route overrides everything else" },
        { id: "half", label: "Only for half of the packets" },
        { id: "reload", label: "Only after R1 reloads" },
      ],
      correctOptionId: "no",
      explanation: "A default route is the least specific route possible. It is chosen only when no longer prefix matches. Here the /24 always beats it.",
    },
  },
  {
    id: "predict-hop-change",
    label: "Predict: what changes at R1?",
    narrative: "R1 is about to send the packet toward R2.",
    packet: pkt,
    question: {
      prompt: "What changes when R1 forwards the packet?",
      options: [
        { id: "eth", label: "A new Ethernet frame (R1 → R2 MACs) and TTL − 1; the IPv4 source and destination stay the same" },
        { id: "ipdst", label: "The IPv4 destination becomes the next hop 10.0.12.2" },
        { id: "nothing", label: "Nothing — routers forward frames unchanged, like switches" },
        { id: "ipsrc", label: "The IPv4 source becomes R1's address" },
      ],
      correctOptionId: "eth",
      explanation: "The next hop decides which neighbor gets the frame (its MAC goes in the new Ethernet header). It never goes into the IPv4 header. TTL drops by one, the checksum is recomputed, and with no NAT the addresses are untouched.",
    },
  },
  {
    id: "r1-forwards",
    label: "R1 forwards: new frame, TTL 63",
    narrative: `R1 resolves ${NH} through connected 10.0.12.0/30 → ge-0/0/1, decrements TTL to 63, recomputes the checksum and builds a new frame: ${RT_MAC["R1:TRANSIT"]} → ${RT_MAC["R2:TRANSIT"]}. IPv4 is still ${HA} → ${SA}.`,
    run: (s) => ({ state: routerStep(s, "r1-forwards", "R1", pkt(s)!, "tx"), events: [ev("PACKET_SENT", "r1-forwards", "R1 forwards")] }),
    packet: pkt,
    whatChanged: () => ["Ethernet rewritten for the transit link", "TTL 64 → 63, checksum recomputed", "IPv4 addresses unchanged"],
  },
  {
    id: "r2-forwards",
    label: "R2: connected delivery, TTL 62",
    narrative: `R2's longest match for ${SA} is its connected 172.16.50.0/24, so the destination itself is the next hop: R2 decrements TTL to 62 and frames the packet straight to SERVER-A's MAC ${RT_MAC["SERVER-A"]}.`,
    run: (s) => ({ state: routerStep(s, "r2-forwards", "R2", pkt(s)!, "tx"), events: [ev("PACKET_SENT", "r2-forwards", "R2 forwards")] }),
    packet: pkt,
  },
  {
    id: "server-a-receives",
    label: "SERVER-A receives",
    narrative: `SERVER-A accepts the Echo Request with TTL 62 — two routers each took one. A destination host doesn't decrement TTL.`,
    run: (s) => ({ state: { ...hostReceive(s, "server-a-receives", "SERVER-A", pkt(s)!, "accept · reply next"), packet: undefined, lookup: undefined }, events: [ev("PACKET_RECEIVED", "server-a-receives", "SERVER-A receives")] }),
  },
  {
    id: "server-a-replies",
    label: "SERVER-A replies",
    narrative: `SERVER-A sends an Echo Reply: IPv4 ${SA} → ${HA}. ${HA} is off-link for SERVER-A too, so the frame goes to its gateway R2 (${RT_MAC["R2:SRV"]}).`,
    run: (s) => ({ state: hostSend(idle(s), "server-a-replies", "SERVER-A", HA, "echo-reply", 1), events: [ev("PACKET_SENT", "server-a-replies", "SERVER-A replies")] }),
    packet: pkt,
  },
  {
    id: "r2-return",
    label: "R2 uses its return route",
    narrative: `R2's only match for ${HA} is its static return route 10.10.10.0/24 via ${RT_ADDR["R1:TRANSIT"]}. Without it the reply would have nowhere to go. TTL 64 → 63, new frame to R1.`,
    run: (s) => ({ state: routerStep(s, "r2-return", "R2", pkt(s)!, "tx"), events: [ev("PACKET_SENT", "r2-return", "R2 forwards reply")] }),
    packet: pkt,
  },
  {
    id: "r1-return",
    label: "R1 delivers on its connected LAN",
    narrative: `R1's longest match for ${HA} is connected 10.10.10.0/24, so it frames the reply straight to HOST-A's MAC with TTL 62.`,
    run: (s) => ({ state: routerStep(s, "r1-return", "R1", pkt(s)!, "tx"), events: [ev("PACKET_SENT", "r1-return", "R1 forwards reply")] }),
    packet: pkt,
  },
  {
    id: "a-receives",
    label: "HOST-A gets the reply",
    narrative: "HOST-A matches the Echo Reply to its request. SERVER-A is reachable, and routing works in both directions.",
    run: (s) => ({ state: { ...hostReceive(s, "a-receives", "HOST-A", pkt(s)!, "reply matched"), packet: undefined, lookup: undefined, results: { ...s.results, "SERVER-A": "reachable" } }, events: [ev("PACKET_RECEIVED", "a-receives", "HOST-A receives reply")] }),
    whatChanged: () => ["SERVER-A reachable (round trip)"],
  },
  {
    id: "default-send",
    label: "A destination outside 172.16/16",
    narrative: `HOST-A pings ${OUTSIDE_DST}, an address outside every specific route on R1.`,
    run: (s) => ({ state: hostSend(idle(s), "default-send", "HOST-A", OUTSIDE_DST, "echo-request", 2), events: [ev("PACKET_SENT", "default-send", `HOST-A pings ${OUTSIDE_DST}`)] }),
    packet: pkt,
  },
  {
    id: "default-r1",
    label: "R1: only the default matches",
    narrative: `For ${OUTSIDE_DST}: 172.16.50.0/24 — no match. 172.16.0.0/16 — no match. 0.0.0.0/0 — match. The default is the only candidate, so R1 forwards to ${NH} with TTL 63.`,
    run: (s) => ({ state: routerStep(s, "default-r1", "R1", pkt(s)!, "tx"), events: [ev("PACKET_SENT", "default-r1", "R1 uses the default route")] }),
    packet: pkt,
    whatChanged: (_p, n) => [`Matches: ${n.lookup?.matches.join(", ") ?? ""}`, `Selected: ${n.lookup?.selected ?? ""}`],
  },
  {
    id: "predict-default",
    label: "Predict: is it reachable now?",
    narrative: `R1 has sent the packet for ${OUTSIDE_DST} to R2.`,
    packet: pkt,
    question: {
      prompt: `Does R1's default route mean ${OUTSIDE_DST} is reachable?`,
      options: [
        { id: "no", label: "No — it only tells R1 where to send it; R2 still needs a route of its own" },
        { id: "yes", label: "Yes — a default route means the Internet is reachable" },
        { id: "r1", label: "Yes — R1 already delivered it" },
        { id: "arp", label: "Only if R2 has an ARP entry for it" },
      ],
      correctOptionId: "no",
      explanation: "Every router decides independently. The default route moves the packet one hop, to R2. R2 then does its own lookup, and it has no route and no default for 203.0.113.80.",
    },
  },
  {
    id: "default-r2",
    label: "R2 has no route",
    narrative: `R2's table holds 10.0.12.0/30, 172.16.50.0/24 and 10.10.10.0/24 — none contains ${OUTSIDE_DST}, and R2 has no default. The packet stops here.`,
    run: (s) => ({ state: { ...routerStep(s, "default-r2", "R2", pkt(s)!, "tx"), results: { ...s.results, outside: "dropped at R2 (no route)" } }, events: [ev("PACKET_DROPPED", "default-r2", "R2: no route")] }),
    whatChanged: () => ["R2: no matching route → dropped", "A default route is a next hop, not a promise of reachability"],
  },
  {
    id: "table-vs-decision",
    label: "Routes that exist vs the route that wins",
    narrative: "R1 holds /24, /16 and /0 routes that all cover 172.16.50.50, at the same time. A more specific route never deletes a less specific one. Two separate questions: 'Which routes exist?' (the table) and 'Which route wins for this destination?' (one lookup).",
    run: (s) => ({ state: idle(s), events: [] }),
  },
  {
    id: "incident-intro",
    label: "Incident: one server gone",
    narrative: `Overnight maintenance touched R1's configuration. The morning ticket: "Nobody on 10.10.10.0/24 can reach SERVER-A (${SA}). SERVER-B (${SB}) works fine." Both servers sit on the same /24 behind R2. R2 and both servers are unchanged.`,
    run: (s) => {
      const hop: FundHop = {
        stepId: "incident-intro",
        device: "R1",
        stages: [
          { id: "chg", label: "Configuration change window", detail: "R1 routing configuration edited" },
          { id: "rib", label: "Routing table", detail: `${s.rib.R1.length + 1} routes installed` },
        ],
        activeStageId: "rib",
        lookupType: "Configuration change",
        lookupKey: "R1",
        lookupResult: "routing table changed",
        action: "CONFIG CHANGE",
        reason: "Something changed in R1's routing configuration overnight. Compare the table with what you saw earlier.",
        input: `${s.rib.R1.length} routes`,
        output: `${s.rib.R1.length + 1} routes`,
      };
      return { state: push({ ...idle(s), faultActive: true, rib: { ...s.rib, R1: sortRib([...s.rib.R1, DISCARD_25]) }, results: { "SERVER-A": "untested", "SERVER-B": "untested" } }, hop), events: [ev("STEP_ENTERED", "incident-intro", "Maintenance changed R1")] };
    },
    whatChanged: (_p, n) => [`R1 routes installed: ${n.rib.R1.length}`],
  },
  {
    id: "fault-a-send",
    label: "HOST-A pings SERVER-A",
    narrative: `Same test as before: Echo Request ${HA} → ${SA}, to R1's MAC.`,
    run: (s) => ({ state: hostSend(idle(s), "fault-a-send", "HOST-A", SA, "echo-request", 3), events: [ev("PACKET_SENT", "fault-a-send", "HOST-A pings SERVER-A")] }),
    packet: pkt,
  },
  {
    id: "fault-a-r1",
    label: "R1's lookup for SERVER-A",
    narrative: `R1 collects every route containing ${SA}. There are four now, and the longest is a /25 — a discard route. R1 drops the packet on the spot. The healthy /24 via ${NH} is still installed; it simply loses to the longer /25.`,
    run: (s) => ({ state: { ...routerStep(s, "fault-a-r1", "R1", pkt(s)!, "tx"), results: { ...s.results, "SERVER-A": "dropped at R1 (discard route)" } }, events: [ev("PACKET_DROPPED", "fault-a-r1", "R1 discards SERVER-A traffic")] }),
    whatChanged: (_p, n) => [`Matches: ${n.lookup?.matches.join(", ") ?? ""}`, `Selected: ${n.lookup?.selected ?? ""} (discard)`, "172.16.50.0/24 is still installed"],
  },
  {
    id: "predict-b-match",
    label: "Predict: SERVER-B and the /25",
    narrative: `172.16.50.0/25 covers 172.16.50.0 – 172.16.50.127 (the first 25 bits fixed, 7 host bits). SERVER-B is ${SB}.`,
    question: {
      prompt: `Does ${SB} match 172.16.50.0/25?`,
      options: [
        { id: "no", label: "No — .200 is 11001000; its 25th bit is 1, while the /25 requires 0 (range .0 – .127)" },
        { id: "yes", label: "Yes — every 172.16.50.x address matches the /25" },
        { id: "maybe", label: "Only if SERVER-B uses a /25 mask itself" },
        { id: "default", label: "It matches the /25 because it matches the default" },
      ],
      correctOptionId: "no",
      explanation: "A /25 fixes 25 bits: 172.16.50 plus the top bit of the last octet, which must be 0. .50 is 00110010 (top bit 0, a match). .200 is 11001000 (top bit 1, no match). So SERVER-B's longest match is still the /24.",
    },
  },
  {
    id: "probe-b-send",
    label: "HOST-A pings SERVER-B",
    narrative: `Echo Request ${HA} → ${SB}.`,
    run: (s) => ({ state: hostSend(idle(s), "probe-b-send", "HOST-A", SB, "echo-request", 4), events: [ev("PACKET_SENT", "probe-b-send", "HOST-A pings SERVER-B")] }),
    packet: pkt,
  },
  {
    id: "probe-b-r1",
    label: "R1's lookup for SERVER-B",
    narrative: `For ${SB}: the /25 does NOT match, so the longest match is 172.16.50.0/24 via ${NH}. R1 forwards with TTL 63.`,
    run: (s) => ({ state: routerStep(s, "probe-b-r1", "R1", pkt(s)!, "tx"), events: [ev("PACKET_SENT", "probe-b-r1", "R1 forwards to SERVER-B")] }),
    packet: pkt,
    whatChanged: (_p, n) => [`Matches: ${n.lookup?.matches.join(", ") ?? ""}`, `Selected: ${n.lookup?.selected ?? ""}`],
  },
  {
    id: "probe-b-r2",
    label: "R2 delivers to SERVER-B",
    narrative: `R2's connected 172.16.50.0/24 → SERVER-B's MAC ${RT_MAC["SERVER-B"]}, TTL 62.`,
    run: (s) => ({ state: routerStep(s, "probe-b-r2", "R2", pkt(s)!, "tx"), events: [ev("PACKET_SENT", "probe-b-r2", "R2 forwards to SERVER-B")] }),
    packet: pkt,
  },
  {
    id: "probe-b-reply",
    label: "SERVER-B answers",
    narrative: `SERVER-B replies. R2 (return route) and R1 (connected LAN) carry the reply back to HOST-A. Same /24, one half dead, the other half fine.`,
    run: (s) => {
      const recv = hostReceive(s, "probe-b-reply", "SERVER-B", pkt(s)!, "accept · reply");
      const back = chain(hostSend(recv, "probe-b-reply", "SERVER-B", HA, "echo-reply", 4), "probe-b-reply", ["R2", "R1"]);
      return { state: { ...back, results: { ...back.results, "SERVER-B": "reachable" } }, events: [ev("PACKET_SENT", "probe-b-reply", "SERVER-B reply returns")] };
    },
    packet: pkt,
    whatChanged: () => ["SERVER-B reachable", "SERVER-A still dropped at R1"],
  },
  {
    id: "trouble-question",
    label: "Diagnose the incident",
    narrative: "SERVER-A fails, SERVER-B works, both in 172.16.50.0/24, and nothing changed on R2 or the servers.",
    question: {
      prompt: "Why does the erroneous /25 affect SERVER-A but not SERVER-B?",
      options: [
        { id: "lpm", label: ".50 falls inside 172.16.50.0/25, so the discard route is its longest match; .200 is outside the /25, so the /24 still wins for it" },
        { id: "missing", label: "The /24 route was deleted when the /25 was added" },
        { id: "r2", label: "R2 lost its route to SERVER-A" },
        { id: "order", label: "The /25 was configured last, so it is tried first" },
      ],
      correctOptionId: "lpm",
      explanation: "The /24 is still installed. For SERVER-A, the longer /25 discard route wins the lookup, so R1 drops the packet. SERVER-B's address doesn't fall inside the /25 at all, so its lookup still selects the /24. Configuration order has nothing to do with it.",
    },
  },
  {
    id: "diagnostic-layers",
    label: "Troubleshooting layers",
    narrative: "Walk the layers from the wire up to the route selection.",
  },
  {
    id: "repair-challenge",
    label: "Repair R1's routing",
    narrative: "Choose the change that fixes the cause you identified.",
    action: (s, payload) => ({ state: applyRtRepair(s, (payload as { choice: string }).choice), events: [ev("STEP_ENTERED", "repair-challenge", `Repair attempt: ${(payload as { choice: string }).choice}`)] }),
    requiresState: (s) => s.repaired,
  },
  {
    id: "verify-a-send",
    label: "Verify: ping SERVER-A",
    narrative: `HOST-A pings ${SA} again.`,
    run: (s) => ({ state: hostSend(idle(s), "verify-a-send", "HOST-A", SA, "echo-request", 5), events: [ev("PACKET_SENT", "verify-a-send", "HOST-A pings SERVER-A")] }),
    packet: pkt,
  },
  {
    id: "verify-a-r1",
    label: "Verify: /24 wins again",
    narrative: `With the /25 gone, R1's matches for ${SA} are /24, /16 and /0 — the existing /24 via ${NH} is the longest valid match again. TTL 63, new frame to R2.`,
    run: (s) => ({ state: routerStep(s, "verify-a-r1", "R1", pkt(s)!, "tx"), events: [ev("PACKET_SENT", "verify-a-r1", "R1 selects /24")] }),
    packet: pkt,
    whatChanged: (_p, n) => [`Matches: ${n.lookup?.matches.join(", ") ?? ""}`, `Selected: ${n.lookup?.selected ?? ""}`],
  },
  {
    id: "verify-a-r2",
    label: "Verify: R2 delivers",
    narrative: `R2 frames it to SERVER-A with TTL 62.`,
    run: (s) => ({ state: routerStep(s, "verify-a-r2", "R2", pkt(s)!, "tx"), events: [ev("PACKET_SENT", "verify-a-r2", "R2 forwards")] }),
    packet: pkt,
  },
  {
    id: "verify-a-reply",
    label: "Verify: SERVER-A answers",
    narrative: "SERVER-A replies, and the reply returns through R2 and R1 to HOST-A. SERVER-A is restored.",
    run: (s) => {
      const recv = hostReceive(s, "verify-a-reply", "SERVER-A", pkt(s)!, "accept · reply");
      const back = chain(hostSend(recv, "verify-a-reply", "SERVER-A", HA, "echo-reply", 5), "verify-a-reply", ["R2", "R1"]);
      return { state: { ...back, results: { ...back.results, "SERVER-A": "reachable" } }, events: [ev("PACKET_SENT", "verify-a-reply", "SERVER-A reply returns")] };
    },
    packet: pkt,
    whatChanged: () => ["SERVER-A reachable"],
  },
  {
    id: "verify-b",
    label: "Verify: SERVER-B still works",
    narrative: `A last check for ${SB}: R1 still selects 172.16.50.0/24 and forwards toward R2. Nothing that worked before was disturbed.`,
    run: (s) => {
      const sent = hostSend(idle(s), "verify-b", "HOST-A", SB, "echo-request", 6);
      const fwd = routerStep(sent, "verify-b", "R1", sent.packet!, "tx");
      return { state: { ...fwd, results: { ...fwd.results, "SERVER-B": "forwarded via /24" } }, events: [ev("PACKET_SENT", "verify-b", "R1 forwards to SERVER-B")] };
    },
    packet: pkt,
    whatChanged: (_p, n) => [`Selected for ${SB}: ${n.lookup?.selected ?? ""}`],
  },
  {
    id: "verify-table",
    label: "Verify: the table",
    narrative: "R1's routing table: two connected routes, the /24 and /16 statics and the default. No 172.16.50.0/25 discard route.",
    run: (s) => ({ state: idle(s), events: [] }),
    whatChanged: (_p, n) => [`R1: ${n.rib.R1.map(routeKey).join(", ")}`],
  },
  {
    id: "dynamic-context",
    label: "Where dynamic routing fits",
    narrative: "Every route here was connected or typed in. A routing protocol such as OSPF fills the same table automatically — but the forwarding decision you practiced is unchanged: find every matching route, and the longest prefix wins.",
    run: (s) => ({ state: idle(s), events: [] }),
  },
  {
    id: "complete",
    label: "Lesson complete",
    narrative: "Connected, static and default routes; longest-prefix match; recursive next hops; a new Ethernet frame and TTL − 1 at every router — and a more-specific discard route that took out exactly half a subnet.",
  },
];

/** Formats a route for tables. */
export const routeRow = (r: Route) => ({ label: routeKey(r), value: r.source === "connected" ? `connected · ${r.iface}` : r.discard ? "static · discard" : `static · via ${r.nextHop}${r.len === 0 ? " (default)" : ""}` });
/** 32-character bit string of an IPv4 address. */
export const ipBits = (ip: string) => ipToNum(ip).toString(2).padStart(32, "0");
export { deviceOfIp };
