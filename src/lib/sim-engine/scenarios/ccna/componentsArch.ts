import type { PacketVisual, ScenarioStep } from "../../types";
import type { PacketMutationType, ProcessingStage } from "@/components/network3d/types";
import { act, acted, hop, kitBase, layer, moved, packet, q, repairStep, say, stackOf, withDetail, type KitBase } from "./kit";

/**
 * Network Components & Architectures (CCNA 1.1, 1.2). One company: a wireless laptop, an access point powered by PoE,
 * an access switch, a Layer 3 core switch (the users' default gateway), a wireless LAN controller, a server, a
 * firewall, an internet edge router doing NAT, the ISP and a cloud application.
 *
 * Modeled:
 * - What each component reads and changes on a real request: the AP bridges 802.11 to 802.3; an L2 switch forwards on
 *   the destination MAC and changes nothing; an L3 switch / router looks up the destination IP, rewrites both MACs
 *   and decrements TTL; a stateful firewall matches policy and records a session; the edge router translates the
 *   source address (PAT) before the internet; an endpoint terminates the connection.
 * - Architectures as graphs: hop counts and the number of equal-cost shortest paths are computed by breadth-first
 *   search over each design (SOHO, 2-tier collapsed core, 3-tier, spine-leaf), not stated.
 * - PoE as a power budget (IEEE 802.3af class 3 = 15.4 W, 802.3at class 4 = 30 W at the PSE): ports are granted
 *   power in order while the switch's budget lasts; a device that would exceed it is denied and stays dark.
 */

export type ArchView = "campus" | "soho" | "two-tier" | "three-tier" | "spine-leaf";
export type PoeSwitch = "ACC-SW1" | "ACC-SW2";
export interface PoeDraw {
  port: string;
  device: string;
  /** IEEE class: 3 = 15.4 W, 4 = 30 W (power reserved at the switch). */
  cls: 3 | 4;
}
export const POE_WATTS: Record<3 | 4, number> = { 3: 15.4, 4: 30 };
export const POE_BUDGET: Record<PoeSwitch, number> = { "ACC-SW1": 120, "ACC-SW2": 180 };

export interface CompState extends KitBase {
  view: ArchView;
  /** Devices plugged into each access switch, in port order (the order PoE is granted). */
  poe: Record<PoeSwitch, PoeDraw[]>;
  /** Where the meeting-room AP is plugged in (absent before it is installed). */
  ap2?: PoeSwitch;
  /** Firewall sessions (one line each). */
  sessions: string[];
  /** Edge router translations: inside → outside. */
  nat: string[];
  /** The laptop's location for the Wi-Fi part of the story. */
  laptopAt: "desk" | "meeting-room";
  associated?: "AP1" | "AP2";
  /** Architectures whose paths have been measured and may be shown (never before their question is answered). */
  measured: ArchView[];
}

const PHONES: PoeDraw[] = [1, 2, 3, 4].map((n) => ({ port: `Gi1/0/${n + 1}`, device: `PHONE-${n}`, cls: 3 as const }));
export function createCompState(): CompState {
  return {
    ...kitBase(),
    view: "campus",
    poe: { "ACC-SW1": [{ port: "Gi1/0/1", device: "AP1", cls: 4 }, ...PHONES], "ACC-SW2": [{ port: "Gi1/0/2", device: "PRINTER-PHONE", cls: 3 }] },
    sessions: [],
    nat: [],
    laptopAt: "desk",
    associated: "AP1",
    measured: [],
  };
}

// ---------------------------------------------------------------------------------------------------------------
// PoE: power granted in port order while the budget lasts
// ---------------------------------------------------------------------------------------------------------------
export interface PoeGrant extends PoeDraw {
  watts: number;
  powered: boolean;
}
export function poeTable(s: CompState, sw: PoeSwitch): { grants: PoeGrant[]; used: number; budget: number } {
  let used = 0;
  const grants = s.poe[sw].map((d) => {
    const w = POE_WATTS[d.cls];
    const powered = used + w <= POE_BUDGET[sw] + 1e-9;
    if (powered) used += w;
    return { ...d, watts: w, powered };
  });
  return { grants, used: Math.round(used * 10) / 10, budget: POE_BUDGET[sw] };
}
export const isPowered = (s: CompState, device: string) => (["ACC-SW1", "ACC-SW2"] as PoeSwitch[]).some((sw) => poeTable(s, sw).grants.some((g) => g.device === device && g.powered));

// ---------------------------------------------------------------------------------------------------------------
// Architectures as graphs: BFS hop count and number of equal-cost shortest paths
// ---------------------------------------------------------------------------------------------------------------
export interface ArchGraph {
  nodes: string[];
  links: [string, string][];
  /** The two endpoints the lesson measures between. */
  from: string;
  to: string;
}
const mesh = (a: string[], b: string[]): [string, string][] => a.flatMap((x) => b.map((y) => [x, y] as [string, string]));
export const ARCH: Record<Exclude<ArchView, "campus">, ArchGraph> = {
  soho: { nodes: ["PC", "PHONE", "LAPTOP", "HOME-RTR", "ISP"], links: [["PC", "HOME-RTR"], ["PHONE", "HOME-RTR"], ["LAPTOP", "HOME-RTR"], ["HOME-RTR", "ISP"]], from: "PC", to: "ISP" },
  "two-tier": { nodes: ["H1", "H3", "ACC1", "ACC2", "ACC3", "CORE1", "CORE2"], links: [["H1", "ACC1"], ["H3", "ACC3"], ...mesh(["ACC1", "ACC2", "ACC3"], ["CORE1", "CORE2"]), ["CORE1", "CORE2"]], from: "H1", to: "H3" },
  "three-tier": {
    nodes: ["H1", "H4", "ACC1", "ACC2", "ACC3", "ACC4", "DA1", "DA2", "DB1", "DB2", "CORE1", "CORE2"],
    links: [["H1", "ACC1"], ["H4", "ACC4"], ...mesh(["ACC1", "ACC2"], ["DA1", "DA2"]), ...mesh(["ACC3", "ACC4"], ["DB1", "DB2"]), ...mesh(["DA1", "DA2", "DB1", "DB2"], ["CORE1", "CORE2"]), ["CORE1", "CORE2"]],
    from: "H1",
    to: "H4",
  },
  "spine-leaf": { nodes: ["SRV-A", "SRV-B", "LEAF1", "LEAF2", "LEAF3", "LEAF4", "SPINE1", "SPINE2", "SPINE3", "SPINE4"], links: [["SRV-A", "LEAF1"], ["SRV-B", "LEAF4"], ...mesh(["LEAF1", "LEAF2", "LEAF3", "LEAF4"], ["SPINE1", "SPINE2", "SPINE3", "SPINE4"])], from: "SRV-A", to: "SRV-B" },
};
/** Breadth-first search: shortest path length in links, and how many distinct shortest paths exist. */
export function shortest(g: ArchGraph, from = g.from, to = g.to): { links: number; paths: number; example: string[] } {
  const adj = new Map<string, string[]>(g.nodes.map((n) => [n, []]));
  for (const [a, b] of g.links) {
    adj.get(a)!.push(b);
    adj.get(b)!.push(a);
  }
  const dist = new Map([[from, 0]]);
  const count = new Map([[from, 1]]);
  const prev = new Map<string, string>();
  const queue = [from];
  while (queue.length) {
    const u = queue.shift()!;
    for (const v of adj.get(u)!) {
      if (!dist.has(v)) {
        dist.set(v, dist.get(u)! + 1);
        count.set(v, 0);
        prev.set(v, u);
        queue.push(v);
      }
      if (dist.get(v) === dist.get(u)! + 1) count.set(v, count.get(v)! + count.get(u)!);
    }
  }
  const example: string[] = [];
  for (let n: string | undefined = to; n; n = prev.get(n)) example.unshift(n);
  return { links: dist.get(to) ?? Infinity, paths: count.get(to) ?? 0, example };
}
/** Links between switches only (the cabling a design needs between network devices). */
export const switchLinks = (g: ArchGraph) => g.links.filter(([a, b]) => ![g.from, g.to, "PC", "PHONE", "LAPTOP", "ISP"].includes(a) && ![g.from, g.to, "PC", "PHONE", "LAPTOP", "ISP"].includes(b)).length;

// ---------------------------------------------------------------------------------------------------------------
// Addresses and packets — real header fields only
// ---------------------------------------------------------------------------------------------------------------
export const COMP_MAC = { LAPTOP: "a4:5e:60:1c:22:07", CORE_V10: "00:1e:bd:0a:00:01", CORE_V20: "00:1e:bd:14:00:01", SERVER1: "00:50:56:14:00:0a", CORE_T: "00:1e:bd:01:00:01", FW1_IN: "00:1b:17:00:00:02", FW1_OUT: "00:1b:17:00:01:02", EDGE_IN: "00:23:04:00:00:01", EDGE_OUT: "00:23:04:00:01:01", ISP: "00:0c:29:ee:00:01" } as const;
export const COMP_IP = { LAPTOP: "10.10.10.25", SERVER1: "10.20.20.10", APP: "203.0.113.50", PUBLIC: "198.51.100.2" } as const;
const C = { wifi: "#a78bfa", eth: "#94a3b8", ip: "#60a5fa", tcp: "#34d399" };

const wifiFrame = (id: string, dstIp: string): PacketVisual =>
  packet(id, "ETHERNET", "LAPTOP", "AP1", "802.11", `Wi-Fi frame · ${COMP_IP.LAPTOP} → ${dstIp}`, [
    layer("802.11 Header", C.wifi, [["Receiver (AP BSSID)", "AP1 radio"], ["Transmitter", COMP_MAC.LAPTOP], ["Destination", COMP_MAC.CORE_V10], ["SSID", "CORP"]]),
    layer("IPv4 Header", C.ip, [["Source IP", COMP_IP.LAPTOP], ["Destination IP", dstIp], ["TTL", "64"]]),
    layer("TCP Header", C.tcp, [["Source Port", "52114"], ["Destination Port", dstIp === COMP_IP.APP ? "443" : "445"], ["Flags", "SYN"]]),
  ]);
const ethFrame = (id: string, from: string, to: string, srcMac: string, dstMac: string, srcIp: string, dstIp: string, ttl: number, sport = "52114", vlan?: string): PacketVisual =>
  packet(id, "ETHERNET", from, to, "FRAME", `Ethernet · ${srcIp} → ${dstIp} · TTL ${ttl}`, [
    layer("Ethernet II Header", C.eth, [["Destination MAC", dstMac], ["Source MAC", srcMac], ...(vlan ? ([["802.1Q VLAN", vlan]] as [string, string][]) : [])]),
    layer("IPv4 Header", C.ip, [["Source IP", srcIp], ["Destination IP", dstIp], ["TTL", String(ttl)]]),
    layer("TCP Header", C.tcp, [["Source Port", sport], ["Destination Port", dstIp === COMP_IP.APP ? "443" : "445"], ["Flags", "SYN"]]),
  ]);

// ---------------------------------------------------------------------------------------------------------------
// Stage tables per component — what each one actually does
// ---------------------------------------------------------------------------------------------------------------
export const ST = {
  endpoint: [{ id: "build", label: "Application opens a connection" }, { id: "ip", label: "IP: destination local or remote?" }, { id: "tx", label: "Send to the default gateway's MAC" }],
  ap: [{ id: "rx", label: "Receive 802.11 frame on the radio" }, { id: "convert", label: "Bridge 802.11 → 802.3 (Ethernet)" }, { id: "tx", label: "Send on the wired uplink (PoE-powered port)" }],
  l2: [{ id: "rx", label: "Receive frame" }, { id: "learn", label: "Learn source MAC" }, { id: "lookup", label: "Look up destination MAC" }, { id: "tx", label: "Forward — frame unchanged" }],
  l3: [{ id: "rx", label: "Receive frame addressed to my MAC" }, { id: "route", label: "Route lookup: destination IP" }, { id: "rewrite", label: "New MACs · TTL − 1" }, { id: "tx", label: "Send out the egress interface" }],
  fw: [{ id: "rx", label: "Receive" }, { id: "zone", label: "Zones: inside → outside" }, { id: "policy", label: "Policy: first matching rule" }, { id: "session", label: "Record session (state)" }, { id: "tx", label: "Forward" }],
  edge: [{ id: "rx", label: "Receive" }, { id: "nat", label: "PAT: private source → public address" }, { id: "route", label: "Route: default to the ISP" }, { id: "tx", label: "Send to the internet" }],
  isp: [{ id: "rx", label: "Receive" }, { id: "route", label: "Provider routing (not ours)" }, { id: "tx", label: "Forward toward the destination" }],
  server: [{ id: "rx", label: "Receive" }, { id: "deliver", label: "Destination IP and port are mine" }, { id: "reply", label: "Application answers (SYN-ACK)" }],
  wlc: [{ id: "join", label: "AP joins (CAPWAP control)" }, { id: "push", label: "Push SSID, security, channel plan" }, { id: "monitor", label: "Monitor radios and clients" }],
} satisfies Record<string, ProcessingStage[]>;

// ---------------------------------------------------------------------------------------------------------------
// Hops
// ---------------------------------------------------------------------------------------------------------------
type Step = ScenarioStep<CompState>;
const MUT: Record<string, PacketMutationType> = { "Source MAC": "SA_CHANGE", "Destination MAC": "DA_CHANGE", TTL: "TTL_CHANGE", "Source IP": "SA_CHANGE", "Source Port": "SA_CHANGE", Framing: "ENCAPSULATE" };
const H = (s: CompState, stepId: string, device: string, stages: ProcessingStage[], active: string, details: Partial<Record<string, string>>, p: PacketVisual, out: PacketVisual | undefined, x: { action: string; reason: string; ingress?: string; egress?: string; lookupType?: string; lookupKey?: string; lookupResult?: string; next?: string; decision?: string; mutations?: { field: string; before: string; after: string }[] }): CompState =>
  acted(
    s,
    hop({
      stepId,
      device,
      stages: withDetail(stages, details),
      activeStageId: active,
      ingressInterfaceId: x.ingress,
      egressInterfaceId: x.egress,
      lookupType: x.lookupType ?? "",
      lookupKey: x.lookupKey ?? "",
      lookupResult: x.lookupResult ?? "",
      action: x.action,
      reason: x.reason,
      input: p.summary,
      output: out?.summary ?? "delivered",
      nextHopId: x.next,
      before: stackOf(p),
      after: out ? stackOf(out) : undefined,
      mutations: x.mutations?.map((m) => ({ type: MUT[m.field] ?? "ENCAPSULATE", detail: `${m.field}: ${m.before} → ${m.after}` })),
    }),
    out,
    x.decision,
  );

// journey 1: laptop → SERVER1 (inside the campus)
const j1Wifi = wifiFrame("j1-wifi", COMP_IP.SERVER1);
const j1AccIn = ethFrame("j1-eth", "AP1", "ACC-SW1", COMP_MAC.LAPTOP, COMP_MAC.CORE_V10, COMP_IP.LAPTOP, COMP_IP.SERVER1, 64);
const j1CoreIn = moved(ethFrame("j1-eth2", "ACC-SW1", "CORE", COMP_MAC.LAPTOP, COMP_MAC.CORE_V10, COMP_IP.LAPTOP, COMP_IP.SERVER1, 64, "52114", "10"), "j1-eth2", "ACC-SW1", "CORE");
const j1Srv = ethFrame("j1-routed", "CORE", "SERVER1", COMP_MAC.CORE_V20, COMP_MAC.SERVER1, COMP_IP.LAPTOP, COMP_IP.SERVER1, 63);
// journey 2: laptop → cloud APP
const j2CoreIn = ethFrame("j2-eth", "ACC-SW1", "CORE", COMP_MAC.LAPTOP, COMP_MAC.CORE_V10, COMP_IP.LAPTOP, COMP_IP.APP, 64, "52190", "10");
const j2Fw = ethFrame("j2-fw", "CORE", "FW1", COMP_MAC.CORE_T, COMP_MAC.FW1_IN, COMP_IP.LAPTOP, COMP_IP.APP, 63, "52190");
const j2Edge = ethFrame("j2-edge", "FW1", "EDGE-R", COMP_MAC.FW1_OUT, COMP_MAC.EDGE_IN, COMP_IP.LAPTOP, COMP_IP.APP, 62, "52190");
const j2Isp = ethFrame("j2-isp", "EDGE-R", "ISP", COMP_MAC.EDGE_OUT, COMP_MAC.ISP, COMP_IP.PUBLIC, COMP_IP.APP, 61, "40001");
const j2App = moved({ ...j2Isp, summary: `IPv4 · ${COMP_IP.PUBLIC}:40001 → ${COMP_IP.APP}:443 · TTL 59` }, "j2-app", "ISP", "APP");

// ---------------------------------------------------------------------------------------------------------------
// Repair (the incident: the meeting-room AP gets no power)
// ---------------------------------------------------------------------------------------------------------------
export const COMP_REPAIR_OPTIONS = [
  { id: "move-sw2", label: "Re-patch AP2 to a port on ACC-SW2, which has PoE budget to spare" },
  { id: "channel", label: "Change AP2's Wi-Fi channel so it stops overlapping AP1" },
  { id: "static-ip", label: "Give AP2 a static IP address" },
  { id: "reboot-wlc", label: "Reboot the wireless LAN controller" },
];
export const COMP_REPAIR_CORRECT = "move-sw2";

const ap2Draw: PoeDraw = { port: "Gi1/0/12", device: "AP2", cls: 4 };
const installAp2 = (s: CompState): CompState => ({ ...s, ap2: "ACC-SW1", poe: { ...s.poe, "ACC-SW1": [...s.poe["ACC-SW1"], ap2Draw] }, faultActive: true });
const moveAp2 = (s: CompState): CompState => ({ ...s, ap2: "ACC-SW2", poe: { "ACC-SW1": s.poe["ACC-SW1"].filter((d) => d.device !== "AP2"), "ACC-SW2": [...s.poe["ACC-SW2"], ap2Draw] } });

const view = (v: ArchView, measure = false) => (s: CompState): CompState => ({ ...s, view: v, measured: measure ? [...s.measured, v] : s.measured, packet: undefined, flood: [], decision: undefined });
const measure = (s: CompState): CompState => ({ ...s, measured: [...s.measured, s.view] });
const facts = (v: Exclude<ArchView, "campus">) => {
  const g = ARCH[v];
  const r = shortest(g);
  return { ...r, switchLinks: switchLinks(g) };
};

// ---------------------------------------------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------------------------------------------
export const componentsArchSteps: Step[] = [
  say("intro", "One request, every component", "A laptop on the office Wi-Fi opens a file on SERVER1, then a cloud application. Follow those two requests and you meet every component of an enterprise network — each one doing one job, at one layer."),
  say("predict-first", "Predict: radio to cable", "The laptop transmits on the radio.", {
    question: q("Which device turns the laptop's radio transmission into a frame on a cable?", [["switch", "The access switch"], ["ap", "The access point"], ["wlc", "The wireless LAN controller"], ["router", "The router"]], "ap", "The access point is the radio's other end: it receives the 802.11 frame and bridges it onto its wired Ethernet uplink. The controller manages APs (configuration, channels, clients) but in this design user traffic is bridged locally by the AP, not sent through the controller."),
  }),
  act("laptop-sends", "The laptop transmits", "The laptop's IP stack sees 10.20.20.10 is not on its own subnet, so the frame goes to its default gateway's MAC — CORE's VLAN 10 interface — over the air to AP1.", (s) =>
    H(s, "laptop-sends", "LAPTOP", ST.endpoint, "tx", { ip: `${COMP_IP.SERVER1} is remote → default gateway 10.10.10.1`, tx: "802.11 to AP1 · destination MAC = gateway" }, j1Wifi, j1Wifi, { action: "SEND", reason: "An endpoint originates traffic. It decides local vs remote from its own IP and mask, and sends remote traffic to its default gateway's MAC.", egress: "wlan0", lookupType: "Host routing", lookupKey: COMP_IP.SERVER1, lookupResult: "remote — use 10.10.10.1", next: "AP1", decision: "LAPTOP → default gateway" }),
  ),
  act("ap-bridges", "AP1 bridges radio to Ethernet", "AP1 receives the 802.11 frame and re-frames it as Ethernet on its uplink to ACC-SW1. AP1 has no power socket of its own: ACC-SW1 powers it over the same cable with PoE.", (s) =>
    H(s, "ap-bridges", "AP1", ST.ap, "tx", { rx: "SSID CORP · from a4:5e:60:1c:22:07", convert: "same addresses, Ethernet II framing", tx: "Gi1/0/1 on ACC-SW1 · powered by PoE (class 4, 30 W)" }, j1Wifi, j1AccIn, { action: "BRIDGE 802.11 → 802.3", reason: "An access point is a Layer 2 bridge between the radio and the wire. It does not route: the IP header passes through untouched.", ingress: "radio0", egress: "Gi0", lookupType: "Bridge", lookupKey: "802.11 → 802.3", lookupResult: "re-framed, addresses kept", next: "ACC-SW1", decision: "AP1: bridged to the wired LAN", mutations: [{ field: "Framing", before: "802.11", after: "Ethernet II" }] }),
  ),
  act("acc-forwards", "ACC-SW1 forwards on the MAC", "ACC-SW1 is a Layer 2 access switch. It learns the laptop's MAC on Gi1/0/1, looks up the destination MAC (the gateway) and sends the frame up its uplink to CORE, tagged for VLAN 10 on the trunk. The IP packet inside is never read.", (s) =>
    H(s, "acc-forwards", "ACC-SW1", ST.l2, "tx", { learn: `${COMP_MAC.LAPTOP} on Gi1/0/1`, lookup: `${COMP_MAC.CORE_V10} → Gi1/0/48 (uplink)`, tx: "same frame, 802.1Q tag VLAN 10 on the trunk" }, j1AccIn, j1CoreIn, { action: "L2 FORWARD", reason: "A Layer 2 switch forwards by destination MAC address within one VLAN. It never changes addresses or TTL.", ingress: "Gi1/0/1", egress: "Gi1/0/48", lookupType: "MAC address table", lookupKey: COMP_MAC.CORE_V10, lookupResult: "Gi1/0/48 (uplink to CORE)", next: "CORE", decision: "ACC-SW1: known MAC → uplink" }),
  ),
  say("predict-core", "Predict: the Layer 3 switch", "The frame reaches CORE, addressed to CORE's own VLAN 10 MAC. SERVER1 is in VLAN 20.", {
    keepPacket: true,
    question: q("What does CORE do with the packet?", [["same", "Forwards the same frame into VLAN 20 unchanged"], ["route", "Routes it: new source and destination MACs, TTL decremented"], ["flood", "Floods it to every port, since VLAN 20 is a different VLAN"], ["firewall", "Sends it to the firewall first"]], "route", "The frame was addressed to CORE itself, so CORE acts as a router: it looks up 10.20.20.10, finds its connected VLAN 20 interface, builds a NEW frame (its VLAN 20 MAC → SERVER1's MAC) and decrements TTL. A Layer 2 switch can't move traffic between VLANs; a Layer 3 switch routes between them in hardware."),
  }),
  act("core-routes", "CORE routes between VLANs", "CORE, the Layer 3 core switch, is the users' default gateway. It routes the packet from VLAN 10 to VLAN 20: same IP addresses, new Ethernet header, TTL 64 → 63.", (s) =>
    H(s, "core-routes", "CORE", ST.l3, "tx", { route: `${COMP_IP.SERVER1} → connected, Vlan20`, rewrite: `src ${COMP_MAC.CORE_V20} · dst ${COMP_MAC.SERVER1} · TTL 63`, tx: "Gi1/0/10 → SERVER1" }, j1CoreIn, j1Srv, { action: "ROUTE (Vlan10 → Vlan20)", reason: "A Layer 3 device decides on the destination IP address. Each routed hop rewrites the frame's MAC addresses and decrements TTL; the IP addresses stay the same.", ingress: "Vlan10", egress: "Vlan20", lookupType: "Routing table", lookupKey: COMP_IP.SERVER1, lookupResult: "10.20.20.0/24 connected · Vlan20", next: "SERVER1", decision: "CORE: routed into VLAN 20", mutations: [{ field: "Source MAC", before: COMP_MAC.LAPTOP, after: COMP_MAC.CORE_V20 }, { field: "Destination MAC", before: COMP_MAC.CORE_V10, after: COMP_MAC.SERVER1 }, { field: "TTL", before: "64", after: "63" }] }),
  ),
  act("server-receives", "SERVER1 answers", "SERVER1 is an endpoint too: the destination IP and port are its own, so the operating system hands the connection to the file service, which answers. The reply retraces the path in reverse.", (s) =>
    H(s, "server-receives", "SERVER1", ST.server, "reply", { deliver: `${COMP_IP.SERVER1}:445 — mine`, reply: "SYN-ACK back to the laptop" }, j1Srv, undefined, { action: "DELIVER", reason: "Endpoints (laptops, phones, servers) are where connections begin and end. Network devices in between only move the traffic.", ingress: "eth0", lookupType: "Socket", lookupKey: `${COMP_IP.SERVER1}:445`, lookupResult: "listening — accept", decision: "SERVER1: connection accepted" }),
  ),
  act("leave-building", "A request for the cloud", "Now the laptop opens a cloud application at 203.0.113.50. AP1 and ACC-SW1 do exactly what they did before; the frame arrives at CORE again, tagged for VLAN 10.", (s) => ({ ...s, packet: j2CoreIn, flood: [], decision: { device: "CORE", text: "frame for 203.0.113.50 arrives" } }), "PACKET_SENT"),
  act("core-default", "CORE: no specific route", "CORE has no route for 203.0.113.50 — only its default route, pointing at FW1. Anything not inside the company goes there.", (s) =>
    H(s, "core-default", "CORE", ST.l3, "tx", { route: "203.0.113.50 → 0.0.0.0/0 via 10.0.0.2 (FW1)", rewrite: "new MACs · TTL 63", tx: "Gi1/0/24 → FW1" }, j2CoreIn, j2Fw, { action: "ROUTE (default)", reason: "With no more specific route, the router uses the default route — the gateway of last resort — toward the internet edge.", ingress: "Vlan10", egress: "Gi1/0/24", lookupType: "Routing table", lookupKey: COMP_IP.APP, lookupResult: "0.0.0.0/0 → 10.0.0.2", next: "FW1", decision: "CORE: default route → FW1" }),
  ),
  say("predict-fw", "Predict: the firewall's question", "The packet arrives at FW1, the next-generation firewall between the company and the internet.", {
    keepPacket: true,
    question: q("What does FW1 check that none of the devices before it did?", [["mac", "Whether the destination MAC is correct"], ["policy", "Whether a security policy allows this traffic from inside to outside, then remembers the connection"], ["cable", "Whether the cable to the ISP is up"], ["dns", "Whether the name resolved to the right address"]], "policy", "Switches and routers forward anything they have a path for. A firewall adds a decision: does a rule permit this source, destination and application between these zones? If yes, it records a session so the reply is allowed back without a rule of its own."),
  }),
  act("fw-policy", "FW1 permits and remembers", "FW1 matches the packet against its inside → outside policy: rule ALLOW-WEB permits users to reach TCP 443. It records a session, then forwards the packet to the edge router.", (s) => {
    const n = H(s, "fw-policy", "FW1", ST.fw, "tx", { zone: "inside → outside", policy: "ALLOW-WEB: users → any · tcp/443 · permit", session: `${COMP_IP.LAPTOP}:52190 → ${COMP_IP.APP}:443`, tx: "→ EDGE-R" }, j2Fw, j2Edge, { action: "PERMIT + SESSION", reason: "A stateful firewall decides per connection using security policy, and keeps a session table so return traffic is recognised.", ingress: "inside", egress: "outside", lookupType: "Security policy", lookupKey: "inside → outside · tcp/443", lookupResult: "ALLOW-WEB (permit)", next: "EDGE-R", decision: "FW1: ALLOW-WEB · session created" });
    return { ...n, sessions: [...n.sessions, `${COMP_IP.LAPTOP}:52190 → ${COMP_IP.APP}:443 · tcp · ALLOW-WEB`] };
  }),
  act("edge-nat", "EDGE-R translates and routes", "The internet doesn't route private 10.x addresses. EDGE-R, the internet edge router, replaces the source with its public address and a new port (PAT), then sends the packet to the ISP on its default route.", (s) => {
    const n = H(s, "edge-nat", "EDGE-R", ST.edge, "tx", { nat: `${COMP_IP.LAPTOP}:52190 → ${COMP_IP.PUBLIC}:40001`, route: "0.0.0.0/0 → ISP", tx: "Gi0/1 → ISP" }, j2Edge, j2Isp, { action: "PAT + ROUTE", reason: "An edge router connects the company to a provider. Here it also translates private addresses to the one public address the ISP assigned.", ingress: "Gi0/0", egress: "Gi0/1", lookupType: "NAT + routing", lookupKey: `${COMP_IP.LAPTOP}:52190`, lookupResult: `${COMP_IP.PUBLIC}:40001 · default → ISP`, next: "ISP", decision: "EDGE-R: PAT → 198.51.100.2", mutations: [{ field: "Source IP", before: COMP_IP.LAPTOP, after: COMP_IP.PUBLIC }, { field: "Source Port", before: "52190", after: "40001" }] });
    return { ...n, nat: [...n.nat, `${COMP_IP.LAPTOP}:52190 ↔ ${COMP_IP.PUBLIC}:40001`] };
  }),
  act("isp-carries", "The ISP carries it", "Beyond EDGE-R the network is someone else's: the ISP's routers carry the packet toward the cloud provider. You control your side of the edge, not this part.", (s) =>
    H(s, "isp-carries", "ISP", ST.isp, "tx", { route: `${COMP_IP.APP} → provider network`, tx: "toward the cloud provider" }, j2Isp, j2App, { action: "TRANSIT", reason: "A WAN or internet provider moves traffic between sites and networks it doesn't own.", lookupType: "Provider routing", lookupKey: COMP_IP.APP, lookupResult: "toward 203.0.113.0/24", next: "APP", decision: "ISP: transit" }),
  ),
  act("app-receives", "The cloud application answers", "The application runs in a public cloud. To it, the connection comes from 198.51.100.2 — the edge router's public address. Its reply comes back to EDGE-R, which translates it back to the laptop.", (s) =>
    H(s, "app-receives", "APP", ST.server, "reply", { deliver: `${COMP_IP.APP}:443 — mine`, reply: `SYN-ACK to ${COMP_IP.PUBLIC}:40001` }, j2App, undefined, { action: "DELIVER", reason: "Cloud-hosted applications are endpoints on someone else's network; your traffic reaches them across the WAN or internet.", ingress: "eth0", lookupType: "Socket", lookupKey: `${COMP_IP.APP}:443`, lookupResult: "listening — accept", decision: "APP: connection accepted" }),
  ),
  say("roles", "Every component, one job", "You have now met them all: the endpoint originates; the AP bridges radio to cable; the L2 switch forwards on MAC; the L3 switch and router forward on IP and rewrite the frame; the firewall decides by policy and remembers sessions; the WLC manages the APs; the server answers. Open any device to see its pipeline for its step."),
  // architectures
  act("arch-intro", "Same jobs, different designs", "The jobs stay the same; the design decides how many of each device you need, how they connect, and how far apart any two endpoints are. Start small.", view("soho", true), "STEP_ENTERED"),
  say("soho", "SOHO: one box", `A small office or home office (SOHO) puts the router, switch, access point, firewall and DHCP server in one device. PC → HOME-RTR → ISP is ${facts("soho").links} links, and there is ${facts("soho").paths} path: simple and cheap.`, {
    question: q("What is the main weakness of putting every function in the one home router?", [["speed", "It cannot reach the internet as fast as an enterprise"], ["single", "It is a single point of failure: if it fails, everything stops"], ["vlans", "It can't support more than one device"], ["ipv6", "It can't use IPv6"]], "single", "SOHO trades redundancy for simplicity: one box, no redundant paths. If HOME-RTR fails, routing, switching, Wi-Fi and the firewall all fail with it. Enterprise designs add redundant devices and links precisely to avoid that."),
  }),
  act("two-tier", "2-tier: collapsed core", `A 2-tier (collapsed core) campus: access switches dual-homed to a pair of core switches that also do the distribution job. H1 to H3 crosses ${facts("two-tier").links} links, and there are ${facts("two-tier").paths} equal shortest paths — lose one core switch and the other still carries the traffic.`, view("two-tier", true), "STEP_ENTERED"),
  act("three-tier", "3-tier: access, distribution, core", "A larger campus adds a distribution pair for each building and a separate core between buildings. Each layer has one job: access connects users, distribution aggregates a building and applies policy, core moves traffic between buildings as fast as possible.", view("three-tier"), "STEP_ENTERED", q("H1 is in building A and H4 in building B. How many links does a packet cross on the shortest path?", [["4", "4"], ["6", "6"], ["8", "8"]], "6", `H1 → access → distribution → core → distribution → access → H4: ${facts("three-tier").links} links, and there are ${facts("three-tier").paths} different shortest paths through the redundant pairs.`)),
  say("three-tier-paths", "Redundancy in every layer", `With a redundant pair at each layer there are ${facts("three-tier").paths} equal shortest paths between H1 and H4. Any one switch or link can fail and traffic still has a way across — at the cost of ${facts("three-tier").switchLinks} links between switches.`, { run: measure }),
  act("spine-leaf", "Spine-leaf: the data center fabric", "Data centers carry mostly server-to-server (east-west) traffic. A spine-leaf fabric connects every leaf switch to every spine switch, and nothing else: servers attach to leaves, spines connect leaves.", view("spine-leaf"), "STEP_ENTERED", q("SRV-A is on LEAF1 and SRV-B on LEAF4. With four spines, how many equal-cost paths are there between them?", [["1", "1"], ["2", "2"], ["4", "4"], ["16", "16"]], "4", `Every leaf connects to every spine, so leaf-to-leaf has exactly one path through each spine: ${facts("spine-leaf").paths} paths, each ${facts("spine-leaf").links} links long. Add a fifth spine and you add a fifth path — and more bandwidth — without changing the distance.`)),
  say("spine-leaf-why", "Why every server is equally close", `Any server to any server on another leaf is always ${facts("spine-leaf").links} links: leaf, spine, leaf. Predictable latency, many equal paths to share the load, and growth by adding spines or leaves. That is why modern data centers — and the cloud providers behind the APP you reached — are built this way.`, { run: measure }),
  act("wan-cloud", "WAN, on-premises and cloud", "Back to the company. Sites connect over a WAN or the internet; applications run on-premises (SERVER1, in your building) or in the cloud (APP, in a provider's data center). Same components, someone else's racks.", view("campus"), "STEP_ENTERED"),
  // incident
  act("fault-injected", "A new access point", "Facilities installs AP2 in the meeting room and patches it into ACC-SW1 port Gi1/0/12. ACC-SW1 already powers AP1 and four IP phones over PoE.", (s) => ({ ...installAp2(s), packet: undefined, flood: [], decision: { device: "ACC-SW1", text: "AP2 detected on Gi1/0/12 · requests class 4" } }), "STEP_ENTERED"),
  act("no-wifi", "No Wi-Fi in the meeting room", "A user carries the laptop into the meeting room. AP1's signal is too weak there, and the laptop hears no beacon for CORP from AP2. It can't associate to anything.", (s) => ({ ...s, laptopAt: "meeting-room", associated: undefined, packet: undefined, flood: [], decision: { device: "LAPTOP", text: "no SSID heard in the meeting room" } }), "PACKET_DROPPED"),
  say("trouble-question", "Diagnose", "The cable tests fine, AP2 is configured on the controller, and other users in the building are fine.", {
    question: q("What is the most likely reason AP2 is not working?", [["ssid", "AP2 is broadcasting the wrong SSID"], ["channel", "AP2's channel overlaps AP1"], ["poe", "ACC-SW1 doesn't have enough PoE budget left to power AP2"], ["vlan", "AP2's port is in the wrong VLAN"]], "poe", "Every other explanation needs AP2 to be running. A dark AP hears nothing and says nothing — no beacons at all. ACC-SW1's PoE table shows why: AP1 (30 W) and four phones (4 × 15.4 W) already reserve 91.6 W of its 120 W; AP2 asks for 30 W more, which would need 121.6 W, so the switch denies it.", ["Is AP2 actually transmitting anything?", "What powers AP2?", "Add up what ACC-SW1 already supplies."]),
  }),
  say("diagnostic-layers", "Troubleshooting layers", "Bottom-up: power, then link, then the AP joining the controller, then the radio. The first layer that fails is the one to fix."),
  repairStep("repair-challenge", "Repair", "Choose the change that fixes the cause.", COMP_REPAIR_CORRECT, (s) => ({ ...moveAp2(s), decision: { device: "ACC-SW2", text: "AP2 now on ACC-SW2 Gi1/0/12" } })),
  act("verify-power", "AP2 powers up", "On ACC-SW2, which reserves only 15.4 W of 180 W, AP2's 30 W request is granted. AP2 boots, gets an address and joins the WLC, which sends it the SSID and security settings.", (s) =>
    acted(s, hop({ stepId: "verify-power", device: "WLC", stages: withDetail(ST.wlc, { join: "AP2 joined (CAPWAP)", push: "SSID CORP · WPA2 · channel 36", monitor: "AP2 radios up" }), activeStageId: "push", action: "AP JOINED", reason: "Lightweight APs are managed by a controller: they join it, then receive their WLAN configuration and channel plan from it.", lookupType: "AP join", lookupKey: "AP2", lookupResult: "joined", input: "AP2 discovery", output: "configuration pushed" }), undefined, "WLC: AP2 joined, SSID pushed"),
  "STEP_ENTERED"),
  act("verify-assoc", "The laptop connects", "AP2 now beacons CORP in the meeting room. The laptop associates and its traffic follows exactly the path you traced at the start — AP, access switch, core, firewall, edge, ISP.", (s) => ({ ...s, associated: "AP2", packet: undefined, flood: [], decision: { device: "LAPTOP", text: "associated to AP2" } }), "PACKET_RECEIVED"),
  say("complete", "Components and designs", "Endpoints, APs, L2 and L3 switches, routers, firewalls, controllers and servers each do one job at one layer; SOHO, 2-tier, 3-tier and spine-leaf decide how many of each you need and how they connect. And something as physical as a power budget can take a component out of the path."),
];
