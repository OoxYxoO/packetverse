import type { PacketLayer, PacketVisual, PVEvent, PVEventType, ScenarioStep } from "../types";
import type { PacketStackFrame, ProcessingStage } from "@/components/network3d/types";
import type { FundHop } from "@/components/lesson/fundamentalsTrace";
import { ethLayer, hex4, icmpLayer, icmpLength, type IcmpEcho } from "./fundamentalsPackets";
import { FCS_LAYER, fieldIn, ip4Frame, ip4Layer, u16, u32, type Ip4 } from "./enterpriseEdgePackets";

/**
 * IS-IS Fundamentals: Adjacencies, LSP Flooding & SPF — PE1 — P1 — P2 — PE2, a Level-2-only provider core.
 *
 * Modeled exactly (ISO/IEC 10589, RFC 1195, RFC 5303, RFC 5305, RFC 5309):
 * - IS-IS PDUs travel directly in IEEE 802.3 frames with LLC DSAP/SSAP 0xFE, control 0x03 — never in IPv4, UDP or
 *   TCP. The common header starts with the protocol discriminator 0x83. The Ethernet links run IS-IS point-to-point
 *   (RFC 5309), so hellos use the P2P IIH (PDU type 17) sent to the AllISs address 09:00:2B:00:00:05; there is no DIS
 *   and no pseudonode.
 * - Adjacencies use the RFC 5303 three-way handshake (TLV 240, state Up 0 / Initializing 1 / Down 2). A router moves
 *   to Up once it hears an IIH that lists its own System ID — so one side can go Down → Up directly.
 * - Level-2 LSPs (type 20) carry TLV 22 (Extended IS Reachability) and TLV 135 (Extended IP Reachability) with wide
 *   metrics; their Fletcher checksum is computed over the real encoded bytes. CSNPs (25) summarize the database,
 *   PSNPs (27) acknowledge LSPs or request missing/newer ones.
 * - SPF runs on each router's own LSDB and uses a link only when BOTH ends report it (two-way check). The resulting
 *   routes are installed in the IPv4 RIB; ordinary IPv4 forwarding then uses them — IS-IS never carries user data.
 * - Every router is Level-2-only: a simple provider-backbone design, not a claim that all IS-IS networks are.
 * - Loopbacks are the only advertised prefixes here (transit /31s are left out for clarity).
 * - LSP generation is briefly delayed at start-up, so each router's first LSP (sequence 1) already lists its adjacencies.
 * - IIH padding (TLV 8) is omitted; the PDU length shown is the unpadded length.
 * Incident: P2's P1-facing circuit becomes Level-1-only. Ethernet and IPv4 stay up; with no common level the P1–P2
 * adjacency goes Down, P1 re-originates its LSP (sequence 2) without P2, and PE1 loses 10.0.0.4/32.
 */

export type IsisRouter = "PE1" | "P1" | "P2" | "PE2";
export const ISIS_ROUTERS: IsisRouter[] = ["PE1", "P1", "P2", "PE2"];
export type Level = "L1" | "L2";
export type AdjState = "DOWN" | "INITIALIZING" | "UP";
export const THREE_WAY_CODE: Record<AdjState, number> = { UP: 0, INITIALIZING: 1, DOWN: 2 };
export const PDU = { P2P_IIH: 17, L2_LSP: 20, L2_CSNP: 25, L2_PSNP: 27 } as const;
export const ALL_ISS = "09:00:2B:00:00:05";
export const AREA = "49.0001";
export const HOLD_TIME = 30;
export const LSP_LIFETIME = 1200;
export const LINK_METRIC = 10;
export const PREFIX_METRIC = 10;

export const ROUTER: Record<IsisRouter, { sysId: string; loopback: string }> = {
  PE1: { sysId: "0000.0000.0001", loopback: "10.0.0.1" },
  P1: { sysId: "0000.0000.0002", loopback: "10.0.0.2" },
  P2: { sysId: "0000.0000.0003", loopback: "10.0.0.3" },
  PE2: { sysId: "0000.0000.0004", loopback: "10.0.0.4" },
};
export const netOf = (r: IsisRouter) => `${AREA}.${ROUTER[r].sysId}.00`;
export const lspIdOf = (r: IsisRouter, seqFrag = "00-00") => `${ROUTER[r].sysId}.${seqFrag}`;
export const routerBySysId = (sys: string) => ISIS_ROUTERS.find((r) => ROUTER[r].sysId === sys);

export type LinkId = "L-PE1-P1" | "L-P1-P2" | "L-P2-PE2";
export interface IsisIface {
  router: IsisRouter;
  name: string;
  addr: string;
  mac: string;
  circuitId: number;
  link: LinkId;
  peer: IsisRouter;
  peerIface: string;
}
export const IFACES: IsisIface[] = [
  { router: "PE1", name: "ge-0/0/0", addr: "192.0.2.0", mac: "00:00:5E:00:53:A1", circuitId: 1, link: "L-PE1-P1", peer: "P1", peerIface: "ge-0/0/0" },
  { router: "P1", name: "ge-0/0/0", addr: "192.0.2.1", mac: "00:00:5E:00:53:B1", circuitId: 1, link: "L-PE1-P1", peer: "PE1", peerIface: "ge-0/0/0" },
  { router: "P1", name: "ge-0/0/1", addr: "192.0.2.2", mac: "00:00:5E:00:53:B2", circuitId: 2, link: "L-P1-P2", peer: "P2", peerIface: "ge-0/0/0" },
  { router: "P2", name: "ge-0/0/0", addr: "192.0.2.3", mac: "00:00:5E:00:53:C1", circuitId: 1, link: "L-P1-P2", peer: "P1", peerIface: "ge-0/0/1" },
  { router: "P2", name: "ge-0/0/1", addr: "192.0.2.4", mac: "00:00:5E:00:53:C2", circuitId: 2, link: "L-P2-PE2", peer: "PE2", peerIface: "ge-0/0/0" },
  { router: "PE2", name: "ge-0/0/0", addr: "192.0.2.5", mac: "00:00:5E:00:53:D1", circuitId: 1, link: "L-P2-PE2", peer: "P2", peerIface: "ge-0/0/1" },
];
export const LINKS: { id: LinkId; a: IsisRouter; b: IsisRouter; subnet: string }[] = [
  { id: "L-PE1-P1", a: "PE1", b: "P1", subnet: "192.0.2.0/31" },
  { id: "L-P1-P2", a: "P1", b: "P2", subnet: "192.0.2.2/31" },
  { id: "L-P2-PE2", a: "P2", b: "PE2", subnet: "192.0.2.4/31" },
];
export const ifaceOf = (r: IsisRouter, peer: IsisRouter) => IFACES.find((i) => i.router === r && i.peer === peer)!;
export const ifKey = (r: IsisRouter, name: string) => `${r}:${name}`;

// ---------------------------------------------------------------------------------------------------------------
// Byte encoding (for lengths and the LSP checksum)
// ---------------------------------------------------------------------------------------------------------------
const sysIdBytes = (sys: string) => sys.split(".").flatMap((g) => [parseInt(g.slice(0, 2), 16), parseInt(g.slice(2, 4), 16)]);
const ipBytes = (ip: string) => ip.split(".").map(Number);
const u24 = (n: number) => [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
const tlv = (type: number, value: number[]) => [type, value.length, ...value];
export const hex8s = (n: number) => `0x${n.toString(16).toUpperCase().padStart(8, "0")}`;

/**
 * ISO 8473 / ISO 10589 Fletcher checksum. `bytes` is the covered range with the two checksum octets zeroed; `k` is
 * the 1-based position of the first checksum octet inside it. Returns the two octets that make the range verify.
 */
export function fletcherChecksum(bytes: number[], k: number): number {
  let c0 = 0;
  let c1 = 0;
  for (const b of bytes) {
    c0 = (c0 + b) % 255;
    c1 = (c1 + c0) % 255;
  }
  const n = bytes.length;
  let x = (((n - k) * c0 - c1) % 255 + 255) % 255;
  let y = (((-(n - k + 1) * c0 + c1) % 255) + 255 * 255) % 255;
  if (x === 0) x = 255;
  if (y === 0) y = 255;
  return (x << 8) | y;
}
/** True when a covered range (checksum included) verifies: both running sums end at zero. */
export function fletcherVerifies(bytes: number[]): boolean {
  let c0 = 0;
  let c1 = 0;
  for (const b of bytes) {
    c0 = (c0 + b) % 255;
    c1 = (c1 + c0) % 255;
  }
  return c0 === 0 && c1 === 0;
}

// ---------------------------------------------------------------------------------------------------------------
// LSPs
// ---------------------------------------------------------------------------------------------------------------
export interface Lsp {
  id: string;
  originator: IsisRouter;
  seq: number;
  lifetime: number;
  isReach: { neighbor: IsisRouter; metric: number }[];
  ipReach: { prefix: string; len: number; metric: number }[];
}
function lspTlvBytes(l: Lsp): number[] {
  const area = tlv(1, [3, 0x49, 0x00, 0x01]);
  const proto = tlv(129, [0xcc]);
  const host = tlv(137, [...l.originator].map((c) => c.charCodeAt(0)));
  const ifAddr = tlv(132, ipBytes(ROUTER[l.originator].loopback));
  const is22 = l.isReach.length ? tlv(22, l.isReach.flatMap((n) => [...sysIdBytes(ROUTER[n.neighbor].sysId), 0, ...u24(n.metric), 0])) : [];
  const ip135 = tlv(135, l.ipReach.flatMap((p) => [...u32(p.metric), p.len & 0x3f, ...ipBytes(p.prefix).slice(0, Math.ceil(p.len / 8))]));
  return [...area, ...proto, ...host, ...ifAddr, ...is22, ...ip135];
}
/** Full L2 LSP PDU bytes (common header 8 + LSP header 19 + TLVs) with its real checksum. */
export function lspBytes(l: Lsp): number[] {
  const tlvs = lspTlvBytes(l);
  const len = 27 + tlvs.length;
  const b = [0x83, 27, 1, 0, PDU.L2_LSP, 1, 0, 0, ...u16(len), ...u16(l.lifetime), ...sysIdBytes(ROUTER[l.originator].sysId), 0, 0, ...u32(l.seq), 0, 0, 0x03, ...tlvs];
  const covered = b.slice(12);
  const c = fletcherChecksum(covered, 13);
  b[24] = c >> 8;
  b[25] = c & 0xff;
  return b;
}
export const lspChecksum = (l: Lsp) => {
  const b = lspBytes(l);
  return (b[24] << 8) | b[25];
};
export const lspLength = (l: Lsp) => lspBytes(l).length;

/** What each router advertises in its LSP given its current UP adjacencies. */
export function buildLsp(r: IsisRouter, seq: number, upNeighbors: IsisRouter[]): Lsp {
  return { id: lspIdOf(r), originator: r, seq, lifetime: LSP_LIFETIME, isReach: upNeighbors.map((n) => ({ neighbor: n, metric: LINK_METRIC })), ipReach: [{ prefix: ROUTER[r].loopback, len: 32, metric: PREFIX_METRIC }] };
}
export const lspSummary = (l: Lsp) => `${l.id} seq ${hex8s(l.seq)} · IS ${l.isReach.map((n) => `${n.neighbor}/${n.metric}`).join(", ") || "none"} · IP ${l.ipReach.map((p) => `${p.prefix}/${p.len} m${p.metric}`).join(", ")}`;

// ---------------------------------------------------------------------------------------------------------------
// SPF (on one router's own LSDB, with the two-way check)
// ---------------------------------------------------------------------------------------------------------------
export interface SpfNode {
  router: IsisRouter;
  dist: number;
  nextHop?: IsisRouter;
  path: IsisRouter[];
}
export interface RibRoute {
  prefix: string;
  metric: number;
  nextHop: IsisRouter;
  nextHopAddr: string;
  iface: string;
  path: IsisRouter[];
}
export interface SpfResult {
  tree: SpfNode[];
  routes: RibRoute[];
  unusable: string[];
}
export function runSpf(self: IsisRouter, lsdb: Lsp[]): SpfResult {
  const byOrig = new Map(lsdb.map((l) => [l.originator, l]));
  const twoWay = (a: IsisRouter, b: IsisRouter) => !!byOrig.get(a)?.isReach.some((n) => n.neighbor === b) && !!byOrig.get(b)?.isReach.some((n) => n.neighbor === a);
  const unusable: string[] = [];
  for (const l of lsdb) for (const n of l.isReach) if (!twoWay(l.originator, n.neighbor)) unusable.push(`${l.originator}→${n.neighbor} (${n.neighbor} does not report ${l.originator})`);
  const dist = new Map<IsisRouter, SpfNode>([[self, { router: self, dist: 0, path: [self] }]]);
  const done = new Set<IsisRouter>();
  while (true) {
    const cand = [...dist.values()].filter((d) => !done.has(d.router)).sort((a, b) => a.dist - b.dist || a.router.localeCompare(b.router))[0];
    if (!cand) break;
    done.add(cand.router);
    for (const n of byOrig.get(cand.router)?.isReach ?? []) {
      if (!twoWay(cand.router, n.neighbor)) continue;
      const d = cand.dist + n.metric;
      const cur = dist.get(n.neighbor);
      if (!cur || d < cur.dist) dist.set(n.neighbor, { router: n.neighbor, dist: d, nextHop: cand.router === self ? n.neighbor : cand.nextHop, path: [...cand.path, n.neighbor] });
    }
  }
  const tree = [...dist.values()].sort((a, b) => a.dist - b.dist);
  const routes: RibRoute[] = [];
  for (const node of tree) {
    if (node.router === self || !node.nextHop) continue;
    const l = byOrig.get(node.router);
    for (const p of l?.ipReach ?? []) {
      const i = ifaceOf(self, node.nextHop);
      const nh = ifaceOf(node.nextHop, self);
      routes.push({ prefix: `${p.prefix}/${p.len}`, metric: node.dist + p.metric, nextHop: node.nextHop, nextHopAddr: nh.addr, iface: i.name, path: node.path });
    }
  }
  return { tree, routes, unusable };
}
export const routeTo = (s: IsisState, r: IsisRouter, prefix: string) => s.rib[r]?.find((x) => x.prefix === prefix);

// ---------------------------------------------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------------------------------------------
export interface Adjacency {
  state: AdjState;
  neighbor?: IsisRouter;
  hold: number;
  level: Level | "none";
}
export interface IsisState {
  hops: FundHop[];
  packet?: PacketVisual;
  flood: { id: string; fromId: string; toId: string; packet: PacketVisual }[];
  /** Configured circuit level per router interface. */
  circuit: Record<string, Level>;
  /** Physical/Ethernet state per link (never changed by the incident). */
  physUp: Record<LinkId, boolean>;
  /** Each router's view of the adjacency on each interface. */
  adj: Record<string, Adjacency>;
  lsdb: Record<IsisRouter, Lsp[]>;
  spf: Partial<Record<IsisRouter, SpfResult>>;
  rib: Partial<Record<IsisRouter, RibRoute[]>>;
  lastPdu: Partial<Record<IsisRouter, string>>;
  decision?: { device: IsisRouter; text: string };
  ping?: string;
  faultActive: boolean;
  repairAttempt?: { choice: string; correct: boolean };
  repaired: boolean;
}
export function createIsisState(): IsisState {
  const circuit: Record<string, Level> = {};
  const adj: Record<string, Adjacency> = {};
  for (const i of IFACES) {
    circuit[ifKey(i.router, i.name)] = "L2";
    adj[ifKey(i.router, i.name)] = { state: "DOWN", hold: 0, level: "none" };
  }
  return { hops: [], flood: [], circuit, physUp: { "L-PE1-P1": true, "L-P1-P2": true, "L-P2-PE2": true }, adj, lsdb: { PE1: [], P1: [], P2: [], PE2: [] }, spf: {}, rib: {}, lastPdu: {}, faultActive: false, repaired: false };
}
export const adjOf = (s: IsisState, r: IsisRouter, peer: IsisRouter) => s.adj[ifKey(r, ifaceOf(r, peer).name)];
export const circuitOf = (s: IsisState, r: IsisRouter, peer: IsisRouter) => s.circuit[ifKey(r, ifaceOf(r, peer).name)];
export const commonLevel = (s: IsisState, a: IsisRouter, b: IsisRouter): Level | "none" => (circuitOf(s, a, b) === circuitOf(s, b, a) ? circuitOf(s, a, b) : "none");
export const upNeighbors = (s: IsisState, r: IsisRouter) => IFACES.filter((i) => i.router === r && s.adj[ifKey(r, i.name)].state === "UP" && s.adj[ifKey(r, i.name)].level === "L2").map((i) => i.peer);
export const lspIn = (s: IsisState, r: IsisRouter, orig: IsisRouter) => s.lsdb[r].find((l) => l.originator === orig);
const installLsp = (db: Lsp[], l: Lsp) => [...db.filter((x) => x.originator !== l.originator), l].sort((a, b) => a.id.localeCompare(b.id));
export const linkAdjText = (s: IsisState, l: LinkId) => {
  const def = LINKS.find((x) => x.id === l)!;
  const a = adjOf(s, def.a, def.b).state;
  const b = adjOf(s, def.b, def.a).state;
  return a === "UP" && b === "UP" ? "L2 UP" : a === "DOWN" && b === "DOWN" ? "DOWN" : `${def.a} ${a} / ${def.b} ${b}`;
};

// ---------------------------------------------------------------------------------------------------------------
// Packets
// ---------------------------------------------------------------------------------------------------------------
const PDU_NAME: Record<number, string> = { 17: "Point-to-Point IIH", 20: "Level-2 LSP", 25: "Level-2 CSNP", 27: "Level-2 PSNP" };
const HDR_LEN: Record<number, number> = { 17: 20, 20: 27, 25: 33, 27: 17 };
function isisFrame(id: string, from: IsisRouter, to: IsisRouter, pduType: number, pduLen: number, pduHeader: PacketLayer, tlvs: PacketLayer[], badge: string, summary: string): PacketVisual {
  const src = ifaceOf(from, to).mac;
  return {
    id,
    protocol: "ETHERNET",
    from,
    to,
    badge,
    summary,
    layers: [
      { name: "IEEE 802.3 Header", color: "#94a3b8", fields: [{ label: "Destination MAC", value: `${ALL_ISS} (AllISs)` }, { label: "Source MAC", value: src }, { label: "Length", value: `${3 + pduLen} (LLC 3 + IS-IS PDU ${pduLen})` }] },
      { name: "LLC", color: "#a78bfa", fields: [{ label: "DSAP", value: "0xFE (OSI)" }, { label: "SSAP", value: "0xFE (OSI)" }, { label: "Control", value: "0x03 (UI)" }] },
      {
        name: "IS-IS Common Header",
        color: "#22d3ee",
        fields: [
          { label: "Protocol Discriminator", value: "0x83 (Intradomain Routeing, ISO 10589)" },
          { label: "Length Indicator", value: `${HDR_LEN[pduType]} (header bytes)` },
          { label: "Version / Protocol ID Extension", value: "1" },
          { label: "ID Length", value: "0 (= 6-byte System IDs)" },
          { label: "PDU Type", value: `${pduType} (${PDU_NAME[pduType]})` },
          { label: "Version", value: "1" },
          { label: "Maximum Area Addresses", value: "0 (= 3)" },
        ],
      },
      pduHeader,
      ...tlvs,
      FCS_LAYER,
    ],
  };
}
export const isIsis = (p: PacketVisual) => p.layers.some((l) => l.name === "IS-IS Common Header");
export const pduTypeOf = (p: PacketVisual) => Number(fieldIn(p, /^IS-IS Common Header$/, "PDU Type").split(" ")[0]);

/** P2P IIH (type 17) with the RFC 5303 three-way TLV. */
export function iihPacket(s: IsisState, id: string, from: IsisRouter, to: IsisRouter, state: AdjState, neighbor?: IsisRouter): PacketVisual {
  const i = ifaceOf(from, to);
  const level = s.circuit[ifKey(from, i.name)];
  const circuitType = level === "L1" ? 1 : 2;
  const nb = neighbor ? ifaceOf(neighbor, from) : undefined;
  const threeWayLen = neighbor ? 15 : 5;
  const tlvLen = 2 + 4 + 2 + 1 + 2 + 4 + 2 + threeWayLen;
  const pduLen = HDR_LEN[17] + tlvLen;
  const header: PacketLayer = {
    name: "P2P IIH Header",
    color: "#22d3ee",
    fields: [
      { label: "Circuit Type", value: `${circuitType} (${level === "L1" ? "Level-1 only" : "Level-2 only"})` },
      { label: "Source ID", value: `${ROUTER[from].sysId} (${from})` },
      { label: "Holding Time", value: `${HOLD_TIME} s` },
      { label: "PDU Length", value: `${pduLen} (padding TLV 8 omitted in this view)` },
      { label: "Local Circuit ID", value: String(i.circuitId) },
    ],
  };
  const tlvs: PacketLayer[] = [
    { name: "TLV 1 — Area Addresses", color: "#60a5fa", fields: [{ label: "Area", value: AREA }] },
    { name: "TLV 129 — Protocols Supported", color: "#60a5fa", fields: [{ label: "NLPID", value: "0xCC (IPv4)" }] },
    { name: "TLV 132 — IP Interface Address", color: "#60a5fa", fields: [{ label: "Address", value: i.addr }] },
    {
      name: "TLV 240 — Point-to-Point Three-Way Adjacency",
      color: "#fbbf24",
      fields: [
        { label: "Adjacency Three-Way State", value: `${THREE_WAY_CODE[state]} (${state === "UP" ? "Up" : state === "INITIALIZING" ? "Initializing" : "Down"})` },
        { label: "Extended Local Circuit ID", value: String(i.circuitId) },
        ...(neighbor && nb ? [{ label: "Neighbor System ID", value: `${ROUTER[neighbor].sysId} (${neighbor})` }, { label: "Neighbor Extended Local Circuit ID", value: String(nb.circuitId) }] : [{ label: "Neighbor", value: "not yet heard — no neighbor fields" }]),
      ],
    },
  ];
  return isisFrame(id, from, to, 17, pduLen, header, tlvs, "IIH", `IS-IS P2P IIH — ${from} → ${to} · three-way ${state} · circuit type ${circuitType}`);
}

export function lspPacket(id: string, from: IsisRouter, to: IsisRouter, l: Lsp): PacketVisual {
  const len = lspLength(l);
  const header: PacketLayer = {
    name: "LSP Header",
    color: "#22d3ee",
    fields: [
      { label: "PDU Length", value: String(len) },
      { label: "Remaining Lifetime", value: `${l.lifetime} s` },
      { label: "LSP ID", value: `${l.id} (${l.originator}, pseudonode 00, fragment 00)` },
      { label: "Sequence Number", value: hex8s(l.seq) },
      { label: "Checksum", value: `${hex4(lspChecksum(l))} (Fletcher, computed over this LSP)` },
      { label: "P / ATT / OL / IS Type", value: "0 / 0 / 0 / 3 (Level-2)" },
    ],
  };
  const tlvs: PacketLayer[] = [
    { name: "TLV 1 — Area Addresses", color: "#60a5fa", fields: [{ label: "Area", value: AREA }] },
    { name: "TLV 129 — Protocols Supported", color: "#60a5fa", fields: [{ label: "NLPID", value: "0xCC (IPv4)" }] },
    { name: "TLV 137 — Dynamic Hostname", color: "#60a5fa", fields: [{ label: "Hostname", value: l.originator }] },
    { name: "TLV 132 — IP Interface Address", color: "#60a5fa", fields: [{ label: "Address", value: ROUTER[l.originator].loopback }] },
    ...(l.isReach.length ? [{ name: "TLV 22 — Extended IS Reachability", color: "#34d399", fields: l.isReach.map((n) => ({ label: `Neighbor ${ROUTER[n.neighbor].sysId}.00`, value: `${n.neighbor} · metric ${n.metric}` })) }] : []),
    { name: "TLV 135 — Extended IP Reachability", color: "#fbbf24", fields: l.ipReach.map((p) => ({ label: `${p.prefix}/${p.len}`, value: `metric ${p.metric} · up/down 0` })) },
  ];
  return isisFrame(id, from, to, 20, len, header, tlvs, "LSP", `IS-IS L2 LSP — ${l.id} seq ${hex8s(l.seq)} · ${from} → ${to}`);
}

const entryText = (l: Lsp) => `lifetime ${l.lifetime} · seq ${hex8s(l.seq)} · csum ${hex4(lspChecksum(l))}`;
export function csnpPacket(id: string, from: IsisRouter, to: IsisRouter, db: Lsp[]): PacketVisual {
  const len = HDR_LEN[25] + 2 + db.length * 16;
  const header: PacketLayer = {
    name: "CSNP Header",
    color: "#22d3ee",
    fields: [
      { label: "PDU Length", value: String(len) },
      { label: "Source ID", value: `${ROUTER[from].sysId}.00 (${from})` },
      { label: "Start LSP ID", value: "0000.0000.0000.00-00" },
      { label: "End LSP ID", value: "FFFF.FFFF.FFFF.FF-FF" },
    ],
  };
  const tlvs: PacketLayer[] = [{ name: "TLV 9 — LSP Entries", color: "#34d399", fields: db.map((l) => ({ label: l.id, value: entryText(l) })) }];
  return isisFrame(id, from, to, 25, len, header, tlvs, "CSNP", `IS-IS L2 CSNP — ${from} → ${to} · ${db.length} LSP entries`);
}
export function psnpPacket(id: string, from: IsisRouter, to: IsisRouter, entries: Lsp[], purpose: "ack" | "request"): PacketVisual {
  const len = HDR_LEN[27] + 2 + entries.length * 16;
  const header: PacketLayer = { name: "PSNP Header", color: "#22d3ee", fields: [{ label: "PDU Length", value: String(len) }, { label: "Source ID", value: `${ROUTER[from].sysId}.00 (${from})` }] };
  const tlvs: PacketLayer[] = [{ name: "TLV 9 — LSP Entries", color: "#34d399", fields: entries.map((l) => (purpose === "request" ? { label: l.id, value: `${entryText(l)} (my older copy — send me yours)` } : { label: l.id, value: entryText(l) })) }];
  return isisFrame(id, from, to, 27, len, header, tlvs, "PSNP", `IS-IS L2 PSNP — ${from} → ${to} · ${purpose === "ack" ? "acknowledge" : "request"} ${entries.map((e) => e.id).join(", ")}`);
}

/** Ordinary IPv4 user data (ICMP Echo) — no IS-IS content at all. */
export function pingPacket(id: string, from: IsisRouter, to: IsisRouter, ttl: number): PacketVisual {
  const echo: IcmpEcho = { kind: "echo-request", identifier: 0x0100, sequence: 1, dataLength: 56 };
  const ip: Ip4 = { src: ROUTER.PE1.loopback, dst: ROUTER.PE2.loopback, ttl, protocol: 1, payloadLength: icmpLength(echo), id: 0x4401, df: false };
  return { id, protocol: "IP", from, to, badge: "ICMP", summary: `ICMP Echo Request — ${ip.src} → ${ip.dst} · TTL ${ttl}`, layers: [ethLayer(ifaceOf(from, to).mac, ifaceOf(to, from).mac), ip4Layer(ip), icmpLayer(echo), FCS_LAYER] };
}

export function isisStack(p: PacketVisual): PacketStackFrame[] {
  if (!isIsis(p)) return [{ id: "eth", text: `Ethernet · dst ${fieldIn(p, /^Ethernet/, "Destination MAC")} · src ${fieldIn(p, /^Ethernet/, "Source MAC")}`, tone: "generic" }, ip4Frame(p), { id: "icmp", text: `ICMP · type ${fieldIn(p, /^ICMP/, "Type")}`, tone: "transport" }];
  const t = pduTypeOf(p);
  return [
    { id: "eth", text: `802.3 · dst ${ALL_ISS} (AllISs) · src ${fieldIn(p, /^IEEE 802\.3/, "Source MAC")}`, tone: "generic" },
    { id: "llc", text: "LLC · DSAP 0xFE · SSAP 0xFE · UI 0x03 (no IP header)", tone: "generic" },
    { id: "isis", text: `IS-IS 0x83 · PDU type ${t} (${PDU_NAME[t]})`, tone: "vpn" },
  ];
}

// ---------------------------------------------------------------------------------------------------------------
// Stages and hop helpers
// ---------------------------------------------------------------------------------------------------------------
export const ISIS_STAGES: ProcessingStage[] = [
  { id: "rx", label: "Receive 802.3 / LLC 0xFE → IS-IS (0x83), no IP" },
  { id: "adj", label: "IIH: level · area · three-way adjacency state" },
  { id: "lsdb", label: "LSP / SNP: compare sequence · install · acknowledge" },
  { id: "flood", label: "Flood onward (not back out the ingress circuit) · request" },
  { id: "spf", label: "SPF on the Level-2 LSDB → IPv4 RIB" },
  { id: "fwd", label: "IPv4 data plane: longest-prefix match in the RIB" },
];
const withDetail = (d: Partial<Record<string, string>>): ProcessingStage[] => ISIS_STAGES.map((x) => (d[x.id] ? { ...x, detail: d[x.id] } : x));
const ev = (type: PVEventType, stepId: string, message: string): PVEvent => ({ type, stepId, timestamp: Date.now(), message });
const idle = (s: IsisState): IsisState => ({ ...s, packet: undefined, flood: [], decision: undefined });
function hop(stepId: string, device: IsisRouter, o: { active: string; details: Partial<Record<string, string>>; lookupType: string; key: string; result: string; action: string; reason: string; input: string; output: string; ingress?: string; egress?: string; next?: IsisRouter; before?: PacketVisual; after?: PacketVisual }): FundHop {
  return { stepId, device, stages: withDetail(o.details), activeStageId: o.active, ingressInterfaceId: o.ingress, egressInterfaceId: o.egress, lookupType: o.lookupType, lookupKey: o.key, lookupResult: o.result, action: o.action, reason: o.reason, input: o.input, output: o.output, nextHopId: o.next, before: o.before ? isisStack(o.before) : undefined, after: o.after ? isisStack(o.after) : undefined };
}
const setAdj = (s: IsisState, r: IsisRouter, peer: IsisRouter, a: Adjacency): IsisState => ({ ...s, adj: { ...s.adj, [ifKey(r, ifaceOf(r, peer).name)]: a } });

/** One IIH on the wire: `from` sends with its current three-way view; `to` processes it (RFC 5303 transitions). */
function iihStep(s: IsisState, stepId: string, from: IsisRouter, to: IsisRouter): IsisState {
  const mine = adjOf(s, from, to);
  const p = iihPacket(s, `${stepId}-iih`, from, to, mine.state, mine.neighbor);
  const common = commonLevel(s, from, to);
  const theirs = adjOf(s, to, from);
  let next: Adjacency;
  let why: string;
  if (common === "none") {
    next = { state: "DOWN", hold: 0, level: "none" };
    why = `${to}'s circuit is ${circuitOf(s, to, from) === "L1" ? "Level-1" : "Level-2"}-only; this IIH says circuit type ${circuitOf(s, from, to) === "L1" ? "1 (Level-1 only)" : "2 (Level-2 only)"}. No common level, so no adjacency can exist on this circuit.`;
  } else if (mine.state === "DOWN") {
    next = { state: "INITIALIZING", neighbor: from, hold: HOLD_TIME, level: common };
    why = `${from} is heard but has not listed ${to} yet (state Down). ${to} records ${from} and moves to Initializing; its next IIH will list ${from} as neighbor.`;
  } else if (mine.neighbor === to) {
    next = { state: "UP", neighbor: from, hold: HOLD_TIME, level: common };
    why = `${from}'s IIH lists ${to}'s own System ID — two-way communication is proven. Adjacency Up at Level 2${theirs.state === "DOWN" ? " (straight from Down: RFC 5303 allows it once your own ID is echoed)" : ""}.`;
  } else {
    next = { ...theirs, hold: HOLD_TIME };
    why = "Hello refreshes the holding timer.";
  }
  const h = hop(stepId, to, {
    active: "adj",
    ingress: ifaceOf(to, from).name,
    details: { rx: `P2P IIH from ${from} on ${ifaceOf(to, from).name}`, adj: `circuit type ${circuitOf(s, from, to) === "L1" ? 1 : 2} vs local ${circuitOf(s, to, from)} → common ${common} · three-way ${mine.state} → ${to}: ${theirs.state} → ${next.state}` },
    lookupType: `${to} adjacency on ${ifaceOf(to, from).name}`,
    key: `IIH from ${ROUTER[from].sysId}`,
    result: `${theirs.state} → ${next.state}`,
    action: `IIH · ${next.state}`,
    reason: why,
    input: `P2P IIH (17) · three-way ${mine.state}${mine.neighbor ? ` · neighbor ${mine.neighbor}` : ""}`,
    output: `adjacency ${next.state}`,
    before: p,
  });
  const sendHop = hop(stepId, from, { active: "adj", egress: ifaceOf(from, to).name, details: { adj: `send P2P IIH · circuit type ${circuitOf(s, from, to) === "L1" ? 1 : 2} · three-way ${mine.state}` }, lookupType: `${from} adjacency on ${ifaceOf(from, to).name}`, key: "periodic / triggered IIH", result: `advertises three-way ${mine.state}`, action: "SEND IIH", reason: "IIHs go directly into an 802.3/LLC frame to AllISs — there is no IPv4 header, no UDP and no TCP.", input: "adjacency state", output: `IIH → ${to}`, next: to, after: p });
  const out = setAdj(idle(s), to, from, next);
  return { ...out, hops: [...s.hops, sendHop, h], packet: p, lastPdu: { ...s.lastPdu, [from]: `sent P2P IIH (17) · ${mine.state}`, [to]: `received P2P IIH (17) from ${from}` }, decision: { device: to, text: `${to}: adjacency ${theirs.state} → ${next.state}` } };
}

/** Receive an LSP: newer sequence → install, acknowledge (PSNP), flood onward except back out the ingress. */
function lspReceive(s: IsisState, stepId: string, from: IsisRouter, to: IsisRouter, l: Lsp, showOnward?: IsisRouter): IsisState {
  const have = lspIn(s, to, l.originator);
  const newer = !have || l.seq > have.seq;
  const onward = IFACES.filter((i) => i.router === to && i.peer !== from && s.adj[ifKey(to, i.name)].state === "UP").map((i) => i.peer);
  const inP = lspPacket(`${stepId}-in`, from, to, l);
  const h = hop(stepId, to, {
    active: "flood",
    ingress: ifaceOf(to, from).name,
    egress: onward[0] ? ifaceOf(to, onward[0]).name : undefined,
    details: { rx: `L2 LSP from ${from}`, lsdb: `${l.id}: have ${have ? hex8s(have.seq) : "none"} · received ${hex8s(l.seq)} → ${newer ? "newer: install" : "not newer: ignore"} · acknowledge with PSNP`, flood: onward.length ? `flood to ${onward.join(", ")} · not back to ${from}` : `no other adjacencies · not back to ${from}` },
    lookupType: `${to} Level-2 LSDB`,
    key: l.id,
    result: newer ? `installed seq ${hex8s(l.seq)}` : "already current",
    action: newer ? "INSTALL · ACK · FLOOD" : "IGNORE (not newer)",
    reason: `A higher sequence number means newer information. ${to} installs it, acknowledges it to ${from} with a PSNP, and floods it on every other Level-2 adjacency — never back out the circuit it came from. This is control-plane flooding, not user data forwarding.`,
    input: `${l.id} seq ${hex8s(l.seq)}`,
    output: onward.length ? `flooded to ${onward.join(", ")}` : "stored",
    next: showOnward,
    before: inP,
  });
  const lsdb = newer ? { ...s.lsdb, [to]: installLsp(s.lsdb[to], l) } : s.lsdb;
  const packet = showOnward ? lspPacket(`${stepId}-out`, to, showOnward, l) : inP;
  return { ...idle(s), hops: [...s.hops, h], lsdb, packet, lastPdu: { ...s.lastPdu, [to]: `received L2 LSP (20) ${l.id} seq ${hex8s(l.seq)}` }, decision: { device: to, text: `${to}: ${newer ? "install" : "ignore"} ${l.id} ${hex8s(l.seq)}${onward.length ? ` · flood → ${onward.join(", ")}` : ""}` } };
}

/** A router (re)originates its own LSP from its current adjacencies. */
function originate(s: IsisState, stepId: string, r: IsisRouter, seq: number, sendTo?: IsisRouter): IsisState {
  const nbs = upNeighbors(s, r);
  const l = buildLsp(r, seq, nbs);
  const prev = lspIn(s, r, r);
  const h = hop(stepId, r, {
    active: "lsdb",
    egress: sendTo ? ifaceOf(r, sendTo).name : undefined,
    details: { lsdb: `originate ${l.id} seq ${hex8s(prev ? prev.seq : 0)} → ${hex8s(seq)} · TLV 22: ${nbs.join(", ") || "none"} · TLV 135: ${ROUTER[r].loopback}/32 m${PREFIX_METRIC}`, flood: sendTo ? `flood to ${nbs.join(", ")}` : "" },
    lookupType: `${r} own LSP`,
    key: l.id,
    result: `seq ${hex8s(seq)} · checksum ${hex4(lspChecksum(l))}`,
    action: prev ? "RE-ORIGINATE LSP" : "ORIGINATE LSP",
    reason: prev ? `${r}'s adjacencies changed, so its LSP must describe the new truth. The sequence number goes up (${hex8s(prev.seq)} → ${hex8s(seq)}), never back, so every router can tell the new copy is newer.` : `${r} describes itself: its Level-2 neighbors (TLV 22, wide metric ${LINK_METRIC}) and its loopback (TLV 135, metric ${PREFIX_METRIC}). Remaining lifetime ${LSP_LIFETIME} s; it will be refreshed before it expires.`,
    input: `UP adjacencies: ${nbs.join(", ") || "none"}`,
    output: lspSummary(l),
    next: sendTo,
    after: sendTo ? lspPacket(`${stepId}-lsp`, r, sendTo, l) : undefined,
  });
  return { ...idle(s), hops: [...s.hops, h], lsdb: { ...s.lsdb, [r]: installLsp(s.lsdb[r], l) }, packet: sendTo ? lspPacket(`${stepId}-lsp`, r, sendTo, l) : undefined, lastPdu: { ...s.lastPdu, [r]: `originated L2 LSP (20) seq ${hex8s(seq)}` }, decision: { device: r, text: `${r}: ${l.id} seq ${hex8s(seq)}` } };
}

function spfStep(s: IsisState, stepId: string, r: IsisRouter): IsisState {
  const res = runSpf(r, s.lsdb[r]);
  const to4 = res.routes.find((x) => x.prefix === `${ROUTER.PE2.loopback}/32`);
  const h = hop(stepId, r, {
    active: "spf",
    details: { spf: `tree ${res.tree.map((t) => `${t.router}=${t.dist}`).join(" · ")}${res.unusable.length ? ` · not usable: ${res.unusable.join("; ")}` : ""}`, fwd: to4 ? `10.0.0.4/32 metric ${to4.metric} via ${to4.nextHopAddr} (${to4.iface})` : "10.0.0.4/32: no route" },
    lookupType: `${r} SPF (Level-2)`,
    key: `${s.lsdb[r].length} LSPs in LSDB`,
    result: to4 ? `10.0.0.4/32 via ${to4.nextHop} metric ${to4.metric}` : "10.0.0.4/32 unreachable",
    action: "SPF → RIB",
    reason: `Dijkstra over ${r}'s own LSDB, using only links both ends report (two-way check). Each prefix costs the distance to its originator plus its TLV 135 metric. The results go into the IPv4 routing table; IS-IS itself never forwards user packets.`,
    input: `${s.lsdb[r].map((l) => `${l.originator} ${hex8s(l.seq)}`).join(", ")}`,
    output: res.routes.map((x) => `${x.prefix} m${x.metric} via ${x.nextHop}`).join(" · ") || "no IS-IS routes",
  });
  return { ...idle(s), hops: [...s.hops, h], spf: { ...s.spf, [r]: res }, rib: { ...s.rib, [r]: res.routes }, decision: { device: r, text: to4 ? `${r}: 10.0.0.4/32 via ${to4.nextHop} metric ${to4.metric}` : `${r}: no route to 10.0.0.4/32` } };
}

/** One IPv4 forwarding hop using the installed IS-IS route. */
function forward(s: IsisState, stepId: string, r: IsisRouter, ttl: number, extra: FundHop[] = []): IsisState {
  const route = routeTo(s, r, `${ROUTER.PE2.loopback}/32`);
  if (!route) {
    const h = hop(stepId, r, { active: "fwd", details: { fwd: "10.0.0.4 → no matching route → drop (ICMP unreachable not drawn)" }, lookupType: `${r} IPv4 RIB`, key: "destination 10.0.0.4", result: "no route", action: "DROP · NO ROUTE", reason: "SPF no longer produces a path to PE2, so there is nothing to forward with. The Ethernet link is still up — the routing domain is partitioned.", input: "ICMP Echo 10.0.0.1 → 10.0.0.4", output: "dropped" });
    return { ...idle(s), hops: [...s.hops, ...extra, h], ping: `failed at ${r}: no route to 10.0.0.4`, decision: { device: r, text: `${r}: no route to 10.0.0.4 — dropped` } };
  }
  const p = pingPacket(`${stepId}-ping`, r, route.nextHop, ttl);
  const h = hop(stepId, r, { active: "fwd", egress: route.iface, details: { fwd: `10.0.0.4 matches ${route.prefix} (IS-IS, metric ${route.metric}) → ${route.nextHopAddr} ${route.iface} · TTL ${ttl + (r === "PE1" ? 0 : 1)} → ${ttl}` }, lookupType: `${r} IPv4 RIB`, key: "destination 10.0.0.4", result: `${route.prefix} via ${route.nextHopAddr}`, action: "IPv4 FORWARD", reason: "Ordinary IPv4 forwarding: a longest-prefix match on the route IS-IS installed. The packet carries no IIH, LSP, SNP or TLV — just Ethernet, IPv4 and ICMP.", input: "ICMP Echo 10.0.0.1 → 10.0.0.4", output: `to ${route.nextHop}`, next: route.nextHop, after: p });
  return { ...idle(s), hops: [...s.hops, ...extra, h], packet: p, decision: { device: r, text: `${r}: 10.0.0.4 via ${route.nextHop} (IS-IS m${route.metric})` } };
}

// ---------------------------------------------------------------------------------------------------------------
// Repair
// ---------------------------------------------------------------------------------------------------------------
export const ISIS_REPAIR_OPTIONS = [
  { id: "p2-level2", label: "Set P2's P1-facing IS-IS circuit (ge-0/0/0) back to Level-2-only" },
  { id: "change-31", label: "Change the P1–P2 /31 addressing" },
  { id: "restart-bgp", label: "Restart BGP on PE1 and PE2" },
  { id: "clear-arp", label: "Clear the ARP caches on P1 and P2" },
  { id: "raise-mtu", label: "Increase the P1–P2 MTU" },
] as const;
export const ISIS_REPAIR_CORRECT = "p2-level2";
export function applyIsisRepair(s: IsisState, choice: string): IsisState {
  const correct = choice === ISIS_REPAIR_CORRECT;
  if (!correct) return { ...s, repairAttempt: { choice, correct } };
  return { ...idle(s), circuit: { ...s.circuit, [ifKey("P2", "ge-0/0/0")]: "L2" }, repairAttempt: { choice, correct }, repaired: true, faultActive: false, decision: { device: "P2", text: "P2 ge-0/0/0: circuit level → Level-2-only" } };
}

// ---------------------------------------------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------------------------------------------
const pkt = (s: IsisState) => s.packet;
const note = (s: IsisState, stepId: string, r: IsisRouter, o: { active: string; details: Partial<Record<string, string>>; action: string; reason: string; key: string; result: string }): IsisState => ({ ...s, hops: [...s.hops, hop(stepId, r, { ...o, lookupType: `${r} IS-IS`, input: o.key, output: o.result })] });
const adjLine = (s: IsisState) => LINKS.map((l) => `${l.a}–${l.b}: ${linkAdjText(s, l.id)}`).join(" · ");
/** Bring an adjacency straight to UP on both sides (used where the handshake was already shown). */
const bringUp = (s: IsisState, a: IsisRouter, b: IsisRouter): IsisState => setAdj(setAdj(s, a, b, { state: "UP", neighbor: b, hold: HOLD_TIME, level: "L2" }), b, a, { state: "UP", neighbor: a, hold: HOLD_TIME, level: "L2" });

export const isisSteps: ScenarioStep<IsisState>[] = [
  {
    id: "intro",
    label: "A four-router provider core",
    narrative: `PE1 — P1 — P2 — PE2, joined by three Ethernet links (${LINKS.map((l) => l.subnet).join(", ")}). Each router has a loopback (10.0.0.1–10.0.0.4/32). Right now nothing is routed between them: no routing protocol has run. IS-IS will discover neighbors, share topology and compute shortest paths — and it will do it without using IP at all.`,
  },
  {
    id: "net-decomp",
    label: "Every router has a NET",
    narrative: `PE1's NET is ${netOf("PE1")}. Read it right to left: NSEL 00 (always 00 for a router), the six-byte System ID 0000.0000.0001, and the Area ID ${AREA}. The NET names the IS-IS router itself — it is not an interface address and never used as an IPv4 next hop.`,
    run: (s) => ({ state: note(idle(s), "net-decomp", "PE1", { active: "rx", details: { rx: `NET ${netOf("PE1")} = area ${AREA} · System ID ${ROUTER.PE1.sysId} · NSEL 00` }, action: "NET", reason: "The System ID must be unique in the routing domain; it is what LSP IDs and adjacencies are keyed on.", key: netOf("PE1"), result: `System ID ${ROUTER.PE1.sysId}` }), events: [ev("STEP_ENTERED", "net-decomp", "NET")] }),
  },
  {
    id: "predict-net",
    label: "Predict: the System ID",
    narrative: `P2's NET is ${netOf("P2")}.`,
    question: {
      prompt: `Which part of ${netOf("P2")} is P2's System ID?`,
      options: [
        { id: "sys", label: "0000.0000.0003 — the six bytes before the final 00" },
        { id: "area", label: "49.0001 — the first part" },
        { id: "nsel", label: "00 — the last byte" },
        { id: "whole", label: "The whole string — it is P2's IPv4 address in another format" },
      ],
      correctOptionId: "sys",
      explanation: "Area 49.0001, System ID 0000.0000.0003, NSEL 00. LSP IDs (0000.0000.0003.00-00), adjacency tables and SPF all use the System ID; the NET is not an IP address.",
    },
  },
  {
    id: "levels",
    label: "Level-2-only, metric 10",
    narrative: `Every router and circuit here is Level-2-only — a simple provider-backbone design where the whole core is one Level-2 domain. (Real networks also use Level-1 areas and Level-1/2 routers; the Deep Dive covers them.) Each transit link has wide metric ${LINK_METRIC}, and each loopback is advertised with metric ${PREFIX_METRIC}.`,
    run: (s) => ({ state: note(idle(s), "levels", "P1", { active: "adj", details: { adj: "ge-0/0/0 L2 · ge-0/0/1 L2 · metric 10 each" }, action: "LEVEL-2-ONLY", reason: "An adjacency can only form on a level both ends run on that circuit.", key: "P1 circuits", result: "L2-only · metric 10" }), events: [] }),
  },
  {
    id: "predict-ip",
    label: "Predict: what carries IS-IS?",
    narrative: "Before P1 and P2 say hello, think about what the hello travels in.",
    question: {
      prompt: "Does IS-IS need IPv4 or UDP to form this adjacency?",
      options: [
        { id: "no", label: "No — IS-IS PDUs ride directly in the link-layer frame (802.3 + LLC 0xFE), with no IP header" },
        { id: "udp", label: "Yes — hellos use UDP like many routing protocols" },
        { id: "ip124", label: "Yes — IS-IS is IP protocol 124" },
        { id: "tcp", label: "Only TCP, for reliability" },
      ],
      correctOptionId: "no",
      explanation: "IS-IS came from OSI and runs directly over the data link. That is why it can build IPv4 (and IPv6) routing without depending on the IP forwarding it is about to create. (Protocol number 124 is assigned to 'ISIS over IPv4', which is not how routers normally run it.)",
    },
  },
  {
    id: "encapsulation",
    label: "802.3, LLC, 0x83",
    narrative: `Each Ethernet link here is configured as an IS-IS point-to-point circuit (RFC 5309). PDUs go in an IEEE 802.3 frame to ${ALL_ISS} (AllISs), with LLC DSAP 0xFE, SSAP 0xFE, control 0x03. The IS-IS common header starts with discriminator 0x83. Because the circuits are point-to-point there is no DIS and no pseudonode.`,
    run: (s) => ({ state: note(idle(s), "encapsulation", "P2", { active: "rx", details: { rx: `802.3 → ${ALL_ISS} · LLC FE/FE/03 · 0x83` }, action: "P2P OVER ETHERNET", reason: "Point-to-point operation over LAN media: P2P IIHs, no DIS election.", key: "ge-0/0/0", result: "P2P circuit" }), events: [] }),
  },
  {
    id: "predict-pdu",
    label: "Predict: which hello?",
    narrative: "IS-IS has three kinds of hello: LAN Level-1 (15), LAN Level-2 (16) and point-to-point (17).",
    question: {
      prompt: "Which PDU type forms the adjacency on these point-to-point circuits?",
      options: [
        { id: "17", label: "Type 17 — the point-to-point IIH (used for both levels)" },
        { id: "16", label: "Type 16 — Level-2 LAN IIH, because the routers are Level-2" },
        { id: "20", label: "Type 20 — a Level-2 LSP" },
        { id: "25", label: "Type 25 — a CSNP" },
      ],
      correctOptionId: "17",
      explanation: "LAN IIHs (15/16) are for broadcast circuits with a DIS. A point-to-point circuit uses one P2P IIH type, 17, and the circuit-type field says which levels the sender runs.",
    },
  },
  {
    id: "iih-p1-down",
    label: "P1 → P2: IIH, state Down",
    narrative: "P1 sends a P2P IIH on ge-0/0/1: circuit type 2 (Level-2 only), System ID 0000.0000.0002, holding time 30 s, area 49.0001, IPv4 supported, interface address 192.0.2.2 — and TLV 240 with three-way state Down, because P1 has not heard P2 yet. P2 hears it and moves to Initializing.",
    run: (s) => ({ state: iihStep(s, "iih-p1-down", "P1", "P2"), events: [ev("PACKET_SENT", "iih-p1-down", "IIH Down")] }),
    packet: pkt,
    whatChanged: (_p, n) => [`P2 → P1 adjacency: ${adjOf(n, "P2", "P1").state}`],
  },
  {
    id: "iih-p2-init",
    label: "P2 → P1: IIH, state Initializing",
    narrative: "P2 answers with three-way state Initializing and now includes P1 as its neighbor: Neighbor System ID 0000.0000.0002 and P1's extended local circuit ID 2. P1 sees its own System ID echoed back.",
    run: (s) => ({ state: iihStep(s, "iih-p2-init", "P2", "P1"), events: [ev("PACKET_SENT", "iih-p2-init", "IIH Initializing")] }),
    packet: pkt,
    whatChanged: (_p, n) => [`P1 → P2 adjacency: ${adjOf(n, "P1", "P2").state}`],
  },
  {
    id: "predict-3way",
    label: "Predict: why three-way?",
    narrative: "P1 went straight to Up because P2's hello listed P1.",
    question: {
      prompt: "What does the three-way adjacency TLV (240) protect against?",
      options: [
        { id: "oneway", label: "One-way links — an adjacency only comes Up once each side has proven it hears the other" },
        { id: "loops", label: "Routing loops in SPF" },
        { id: "auth", label: "Unauthenticated neighbors" },
        { id: "mtu", label: "MTU mismatches" },
      ],
      correctOptionId: "oneway",
      explanation: "Without it, a router could bring an adjacency up while its own hellos never reach the other side. With TLV 240, Up requires hearing your own System ID in the neighbor's hello. (Its state codes are Up 0, Initializing 1, Down 2 — values, not step order.)",
    },
  },
  {
    id: "iih-p1-up",
    label: "P1 → P2: IIH, state Up",
    narrative: "P1 now reports Up and lists P2. When P2 receives an IIH listing its own System ID while Initializing, it moves to Up too. The P1–P2 Level-2 adjacency is Up on both sides — the physical link state never changed during any of this.",
    run: (s) => ({ state: iihStep(s, "iih-p1-up", "P1", "P2"), events: [ev("OSPF_NEIGHBOR_STATE_CHANGED", "iih-p1-up", "P1–P2 UP")] }),
    packet: pkt,
    whatChanged: (_p, n) => [`P1: ${adjOf(n, "P1", "P2").state} · P2: ${adjOf(n, "P2", "P1").state}`],
  },
  {
    id: "iih-p2-up",
    label: "Hellos keep the adjacency alive",
    narrative: "From now on each side sends IIHs with state Up every few seconds; each one resets the neighbor's 30-second holding timer. If hellos stop for 30 s, the adjacency goes Down.",
    run: (s) => ({ state: iihStep(s, "iih-p2-up", "P2", "P1"), events: [ev("PACKET_SENT", "iih-p2-up", "IIH Up")] }),
    packet: pkt,
  },
  {
    id: "all-adjacencies",
    label: "All three adjacencies Up",
    narrative: "The same handshake runs on PE1–P1 and P2–PE2. All three circuits: Ethernet up, IPv4 configured, IS-IS Level-2 adjacency Up. Link state and adjacency state are separate facts — the first says frames get through, the second says IS-IS agreed to route over it.",
    run: (s) => {
      const up = bringUp(bringUp(idle(s), "PE1", "P1"), "P2", "PE2");
      return { state: note(up, "all-adjacencies", "P1", { active: "adj", details: { adj: adjLine(up) }, action: "ADJACENCIES UP", reason: "Three point-to-point Level-2 adjacencies.", key: "adjacency table", result: adjLine(up) }), events: [ev("OSPF_NEIGHBOR_STATE_CHANGED", "all-adjacencies", "All UP")] };
    },
    whatChanged: (_p, n) => [adjLine(n)],
  },
  {
    id: "predict-lsp",
    label: "Predict: who advertises 10.0.0.4?",
    narrative: "Every router now builds a Link State PDU describing itself.",
    question: {
      prompt: "Which LSP carries reachability for PE2's loopback 10.0.0.4/32?",
      options: [
        { id: "pe2", label: "PE2's own LSP (0000.0000.0004.00-00), in TLV 135" },
        { id: "p2", label: "P2's LSP, because P2 is PE2's neighbor" },
        { id: "all", label: "Every router's LSP" },
        { id: "csnp", label: "A CSNP from PE2" },
      ],
      correctOptionId: "pe2",
      explanation: "Each router describes only itself: its neighbors (TLV 22) and its own prefixes (TLV 135). Everyone else learns 10.0.0.4/32 from PE2's LSP, flooded unchanged.",
    },
  },
  {
    id: "lsp-pe2",
    label: "PE2 originates its LSP",
    narrative: `PE2 originates Level-2 LSP ${lspIdOf("PE2")} (PDU type 20), sequence 0x00000001, remaining lifetime ${LSP_LIFETIME} s. TLV 22 lists neighbor P2 at metric ${LINK_METRIC}; TLV 135 lists 10.0.0.4/32 at metric ${PREFIX_METRIC}. The checksum is computed over the whole LSP. PE2 floods it to its only neighbor, P2.`,
    run: (s) => {
      let n = idle(s);
      for (const r of ["PE1", "P1", "P2"] as IsisRouter[]) n = { ...n, lsdb: { ...n.lsdb, [r]: installLsp(n.lsdb[r], buildLsp(r, 1, upNeighbors(n, r))) } };
      return { state: originate(n, "lsp-pe2", "PE2", 1, "P2"), events: [ev("PACKET_SENT", "lsp-pe2", "PE2 LSP")] };
    },
    packet: pkt,
    whatChanged: (_p, n) => [`PE2 LSDB: ${n.lsdb.PE2.map((l) => l.id).join(", ")}`],
  },
  {
    id: "lsp-p2",
    label: "P2 installs and floods",
    narrative: "P2 has no copy of PE2's LSP, so this one is newer. P2 installs it in its Level-2 LSDB, will acknowledge it to PE2 with a PSNP, and floods it to P1 — not back to PE2.",
    run: (s) => ({ state: lspReceive(s, "lsp-p2", "PE2", "P2", lspIn(s, "PE2", "PE2")!, "P1"), events: [ev("PACKET_SENT", "lsp-p2", "Flood to P1")] }),
    packet: pkt,
  },
  {
    id: "psnp-ack",
    label: "P2 acknowledges with a PSNP",
    narrative: "On point-to-point circuits every LSP is acknowledged. P2 sends PE2 a Level-2 PSNP (type 27) listing the LSP ID, sequence number, lifetime and checksum it received. Until that ack arrives, PE2 would retransmit the LSP.",
    run: (s) => {
      const l = lspIn(s, "P2", "PE2")!;
      const p = psnpPacket("psnp-ack", "P2", "PE2", [l], "ack");
      const h = hop("psnp-ack", "P2", { active: "lsdb", egress: "ge-0/0/1", details: { lsdb: `PSNP ack ${l.id} ${hex8s(l.seq)}` }, lookupType: "P2 flooding state", key: l.id, result: "acknowledged", action: "PSNP · ACK", reason: "A PSNP acknowledges specific LSPs on point-to-point circuits (it can also request LSPs, as you will see later).", input: l.id, output: "PSNP → PE2", next: "PE2", after: p });
      return { state: { ...idle(s), hops: [...s.hops, h], packet: p, lastPdu: { ...s.lastPdu, P2: "sent L2 PSNP (27) ack" }, decision: { device: "P2", text: `P2: ack ${l.id}` } }, events: [ev("PACKET_SENT", "psnp-ack", "PSNP")] };
    },
    packet: pkt,
  },
  {
    id: "lsp-p1",
    label: "P1 installs and floods",
    narrative: "P1 receives PE2's LSP from P2: newer than anything it has, so it installs it, acknowledges P2, and floods it to PE1.",
    run: (s) => ({ state: lspReceive(s, "lsp-p1", "P2", "P1", lspIn(s, "P2", "PE2")!, "PE1"), events: [ev("PACKET_SENT", "lsp-p1", "Flood to PE1")] }),
    packet: pkt,
  },
  {
    id: "lsp-pe1",
    label: "PE1 installs it",
    narrative: "PE1 installs PE2's LSP. It has no other adjacency, so the flood stops here, and PE1 acknowledges with a PSNP. The LSP crossed the network unchanged — same ID, sequence and checksum on every router.",
    run: (s) => {
      const l = lspIn(s, "P1", "PE2")!;
      const r = lspReceive(s, "lsp-pe1", "P1", "PE1", l);
      const p = psnpPacket("lsp-pe1-ack", "PE1", "P1", [l], "ack");
      return { state: { ...r, packet: p }, events: [ev("PACKET_SENT", "lsp-pe1", "PSNP ack")] };
    },
    packet: pkt,
    whatChanged: (_p, n) => [`PE2's LSP on: ${ISIS_ROUTERS.filter((r) => lspIn(n, r, "PE2")).join(", ")}`],
  },
  {
    id: "others-flood",
    label: "Every LSP floods the same way",
    narrative: "PE1, P1 and P2 originated their own sequence-1 LSPs too, and each was flooded and acknowledged the same way. Every router now holds four LSPs.",
    run: (s) => {
      let n = idle(s);
      const own = ISIS_ROUTERS.map((r) => lspIn(n, r, r)!);
      for (const r of ISIS_ROUTERS) for (const l of own) n = { ...n, lsdb: { ...n.lsdb, [r]: installLsp(n.lsdb[r], l) } };
      return { state: note(n, "others-flood", "P1", { active: "flood", details: { flood: own.map((l) => `${l.id} ${hex8s(l.seq)}`).join(" · ") }, action: "FLOODED", reason: "Flooding carries each router's LSP to every other router in the level.", key: "LSDB", result: `${n.lsdb.P1.length} LSPs` }), events: [] };
    },
    whatChanged: (_p, n) => ISIS_ROUTERS.map((r) => `${r}: ${n.lsdb[r].length} LSPs`),
  },
  {
    id: "predict-csnp",
    label: "Predict: CSNP vs PSNP",
    narrative: "You have seen PSNPs acknowledge LSPs. Now P2 sends P1 a CSNP.",
    question: {
      prompt: "What is the role of a CSNP compared with a PSNP?",
      options: [
        { id: "roles", label: "A CSNP lists every LSP header the sender has (a database summary); a PSNP names specific LSPs to acknowledge or request" },
        { id: "routes", label: "A CSNP is a copy of the sender's IP routing table" },
        { id: "same", label: "They are the same PDU with different names" },
        { id: "hello", label: "A CSNP is a keepalive; a PSNP is a hello" },
      ],
      correctOptionId: "roles",
      explanation: "SNPs carry LSP IDs, sequence numbers, lifetimes and checksums — never routes. Comparing a CSNP with your own database shows what you are missing (request it with a PSNP) or what the other side is missing (send it).",
    },
  },
  {
    id: "csnp",
    label: "P2 → P1: CSNP",
    narrative: "P2's Level-2 CSNP (type 25) lists all four LSP entries it holds, from LSP ID 0000.0000.0000.00-00 to FFFF.FFFF.FFFF.FF-FF. P1 compares each entry with its own database: same IDs, sequences and checksums. Nothing to request, nothing to send.",
    run: (s) => {
      const p = csnpPacket("csnp", "P2", "P1", s.lsdb.P2);
      const same = s.lsdb.P2.every((l) => lspIn(s, "P1", l.originator)?.seq === l.seq);
      const h = hop("csnp", "P1", { active: "lsdb", ingress: "ge-0/0/1", details: { rx: "L2 CSNP from P2", lsdb: s.lsdb.P2.map((l) => `${l.id} ${hex8s(l.seq)} ${lspIn(s, "P1", l.originator)?.seq === l.seq ? "=" : "≠"}`).join(" · ") }, lookupType: "P1 LSDB comparison", key: "CSNP entries", result: same ? "databases identical" : "differences found", action: same ? "CSNP · IN SYNC" : "CSNP · DIFFERENCES", reason: "A CSNP is a summary of LSP headers, not routes. Matching entries mean the two databases are synchronized.", input: `${s.lsdb.P2.length} entries`, output: same ? "no PSNP needed" : "request / send", before: p });
      return { state: { ...idle(s), hops: [...s.hops, h], packet: p, lastPdu: { ...s.lastPdu, P1: "received L2 CSNP (25)", P2: "sent L2 CSNP (25)" }, decision: { device: "P1", text: "P1: LSDB in sync with P2" } }, events: [ev("PACKET_SENT", "csnp", "CSNP")] };
    },
    packet: pkt,
  },
  {
    id: "lsdb",
    label: "One consistent Level-2 LSDB",
    narrative: "All four routers hold the same four LSPs — PE1, P1, P2, PE2, each at sequence 0x00000001 with lifetime counting down from 1200 s (they are refreshed before expiry). Same database everywhere means every router computes a consistent view of the topology.",
    run: (s) => ({ state: note(idle(s), "lsdb", "PE1", { active: "lsdb", details: { lsdb: s.lsdb.PE1.map(lspSummary).join(" | ") }, action: "LSDB CONVERGED", reason: "Identical LSDBs are the precondition for consistent SPF results.", key: "PE1 LSDB", result: `${s.lsdb.PE1.length} LSPs` }), events: [] }),
    whatChanged: (_p, n) => n.lsdb.PE1.map(lspSummary),
  },
  {
    id: "predict-metric",
    label: "Predict: PE1's cost to 10.0.0.4",
    narrative: "PE1 is about to run SPF. Each link has metric 10; PE2 advertises 10.0.0.4/32 with metric 10.",
    question: {
      prompt: "What total metric does PE1 calculate to 10.0.0.4/32?",
      options: [
        { id: "40", label: "40 — PE1→P1 10 + P1→P2 10 + P2→PE2 10 + prefix 10" },
        { id: "30", label: "30 — three links × 10" },
        { id: "10", label: "10 — the prefix metric" },
        { id: "4", label: "4 — the hop count" },
      ],
      correctOptionId: "40",
      explanation: "Distance to PE2 is 30 (three links); the prefix adds its own TLV 135 metric of 10. From P1 the same prefix costs 30, from P2 20, and PE2 itself advertises it at 10.",
    },
  },
  {
    id: "spf-pe1",
    label: "PE1 runs SPF",
    narrative: "PE1 runs Dijkstra on its own LSDB, using a link only when both ends report it. Tree: P1 at 10, P2 at 20, PE2 at 30. Prefixes: 10.0.0.2/32 at 20, 10.0.0.3/32 at 30, 10.0.0.4/32 at 40 — all via next hop P1 (192.0.2.1).",
    run: (s) => {
      let n = s;
      for (const r of ["P1", "P2", "PE2"] as IsisRouter[]) n = { ...n, spf: { ...n.spf, [r]: runSpf(r, n.lsdb[r]) }, rib: { ...n.rib, [r]: runSpf(r, n.lsdb[r]).routes } };
      return { state: spfStep(n, "spf-pe1", "PE1"), events: [ev("OSPF_SPF_COMPLETED", "spf-pe1", "SPF")] };
    },
    whatChanged: (_p, n) => (n.rib.PE1 ?? []).map((r) => `${r.prefix} metric ${r.metric} via ${r.nextHop}`),
  },
  {
    id: "rib",
    label: "Routes installed",
    narrative: "PE1's IPv4 routing table now has 10.0.0.4/32 via 192.0.2.1 (ge-0/0/0), IS-IS metric 40. For the same prefix P1 has 30, P2 20. IS-IS's job ends here — installing routes. Packets are forwarded by the normal IPv4 data plane.",
    run: (s) => ({ state: note(idle(s), "rib", "PE1", { active: "spf", details: { spf: ISIS_ROUTERS.filter((r) => r !== "PE2").map((r) => `${r}: ${routeTo(s, r, "10.0.0.4/32")?.metric ?? "—"}`).join(" · ") }, action: "RIB", reason: "Control plane done; data plane uses the result.", key: "10.0.0.4/32", result: `PE1 metric ${routeTo(s, "PE1", "10.0.0.4/32")?.metric}` }), events: [] }),
    whatChanged: (_p, n) => ISIS_ROUTERS.filter((r) => r !== "PE2").map((r) => `${r} → 10.0.0.4/32: metric ${routeTo(n, r, "10.0.0.4/32")?.metric} via ${routeTo(n, r, "10.0.0.4/32")?.nextHop}`),
  },
  {
    id: "ping-pe1",
    label: "PE1 → 10.0.0.4: ordinary IPv4",
    narrative: "PE1 sends an ICMP Echo from 10.0.0.1 to 10.0.0.4. Look at the packet: Ethernet, IPv4, ICMP — no IIH, no LSP, no TLV. PE1 matches the IS-IS route and forwards to P1.",
    run: (s) => ({ state: forward(s, "ping-pe1", "PE1", 64), events: [ev("PACKET_SENT", "ping-pe1", "Ping")] }),
    packet: pkt,
  },
  {
    id: "ping-p1",
    label: "P1 forwards",
    narrative: "P1 looks up 10.0.0.4 in its own routing table (IS-IS route via P2), decrements TTL and forwards.",
    run: (s) => ({ state: forward(s, "ping-p1", "P1", 63), events: [ev("PACKET_SENT", "ping-p1", "Forward")] }),
    packet: pkt,
  },
  {
    id: "ping-p2",
    label: "P2 delivers to PE2",
    narrative: "P2 forwards to PE2, which owns 10.0.0.4 and accepts the echo. Control plane (IS-IS) and data plane (IPv4) did separate jobs.",
    run: (s) => {
      const r = forward(s, "ping-p2", "P2", 62);
      const h = hop("ping-p2", "PE2", { active: "fwd", details: { fwd: "10.0.0.4 is local → deliver" }, lookupType: "PE2 IPv4", key: "10.0.0.4", result: "local", action: "DELIVER", reason: "PE2 owns the destination.", input: "ICMP Echo", output: "delivered" });
      return { state: { ...r, hops: [...r.hops, h], ping: "delivered to PE2" }, events: [ev("PACKET_RECEIVED", "ping-p2", "Delivered")] };
    },
    packet: pkt,
    whatChanged: () => ["Echo delivered to PE2 (10.0.0.4)"],
  },
  {
    id: "incident-intro",
    label: "Incident: a maintenance change",
    narrative: "During maintenance someone edits IS-IS on P2's P1-facing interface. Nothing is unplugged; the Ethernet link and its /31 addresses are unchanged. Soon PE1 can no longer reach PE2's loopback.",
    run: (s) => {
      const n: IsisState = { ...idle(s), circuit: { ...s.circuit, [ifKey("P2", "ge-0/0/0")]: "L1" }, faultActive: true, ping: undefined };
      return { state: note(n, "incident-intro", "P2", { active: "adj", details: { adj: "ge-0/0/0 IS-IS configuration edited" }, action: "CONFIG CHANGED", reason: "A configuration change on one IS-IS circuit.", key: "P2 ge-0/0/0", result: "edited" }), events: [ev("STEP_ENTERED", "incident-intro", "P2 edited")] };
    },
  },
  {
    id: "inc-iih-p2",
    label: "P2's hellos change",
    narrative: "P2 keeps sending P2P IIHs (type 17) on the same Ethernet link — but the circuit-type field now says 1. P2 no longer runs Level 2 on this circuit, so its own Level-2 adjacency to P1 is gone.",
    run: (s) => {
      const n = setAdj(s, "P2", "P1", { state: "DOWN", hold: 0, level: "none" });
      return { state: iihStep(n, "inc-iih-p2", "P2", "P1"), events: [ev("PACKET_SENT", "inc-iih-p2", "IIH circuit type 1")] };
    },
    packet: pkt,
    whatChanged: (_p, n) => [`P1: ${adjOf(n, "P1", "P2").state} · P2: ${adjOf(n, "P2", "P1").state}`, "Ethernet P1–P2: UP"],
  },
  {
    id: "inc-p1-lsp",
    label: "P1 re-originates: sequence 2",
    narrative: "P1's adjacency to P2 is Down, so P1's LSP must stop listing P2. P1 originates sequence 0x00000002 without P2 in TLV 22 and floods it to PE1. (P2 does the same toward PE2.) The LSP moves forward in sequence — it never goes back.",
    run: (s) => {
      let n = originate(idle(s), "inc-p1-lsp", "P1", 2, "PE1");
      const p2 = buildLsp("P2", 2, upNeighbors(n, "P2"));
      n = { ...n, lsdb: { ...n.lsdb, P2: installLsp(n.lsdb.P2, p2), PE2: installLsp(n.lsdb.PE2, p2) } };
      const l = lspIn(n, "P1", "P1")!;
      n = { ...n, lsdb: { ...n.lsdb, PE1: installLsp(n.lsdb.PE1, l) } };
      return { state: n, events: [ev("PACKET_SENT", "inc-p1-lsp", "P1 seq 2")] };
    },
    packet: pkt,
    whatChanged: (_p, n) => [`P1 LSP: ${lspSummary(lspIn(n, "PE1", "P1")!)}`],
  },
  {
    id: "inc-spf",
    label: "PE1's SPF loses PE2",
    narrative: "PE1's LSDB still holds P2's sequence-1 LSP (it cannot hear P2's update across the partition), and that old LSP still lists P1. But P1's new LSP no longer lists P2, so the P1–P2 link fails the two-way check and SPF cannot use it. Tree: P1 only. 10.0.0.3/32 and 10.0.0.4/32 disappear from PE1's routing table.",
    run: (s) => {
      let n = s;
      for (const r of ["P1", "P2", "PE2"] as IsisRouter[]) n = { ...n, spf: { ...n.spf, [r]: runSpf(r, n.lsdb[r]) }, rib: { ...n.rib, [r]: runSpf(r, n.lsdb[r]).routes } };
      return { state: spfStep(n, "inc-spf", "PE1"), events: [ev("OSPF_SPF_COMPLETED", "inc-spf", "Route lost")] };
    },
    whatChanged: (_p, n) => [`PE1 LSDB: ${n.lsdb.PE1.map((l) => `${l.originator} ${hex8s(l.seq)}`).join(", ")}`, `PE1 route to 10.0.0.4/32: ${routeTo(n, "PE1", "10.0.0.4/32") ? "present" : "none"}`],
  },
  {
    id: "inc-ping",
    label: "The ping fails",
    narrative: "PE1 tries to send an ICMP Echo to 10.0.0.4 — there is no route, so it is dropped at PE1. The Ethernet links are all up; the routing domain is split in two.",
    run: (s) => ({ state: forward(s, "inc-ping", "PE1", 64), events: [ev("PACKET_DROPPED", "inc-ping", "No route")] }),
    whatChanged: (_p, n) => [`Ping: ${n.ping}`],
  },
  {
    id: "predict-why-gone",
    label: "Diagnose: link up, route gone",
    narrative: "Every Ethernet link is up and every interface has its IPv4 address.",
    question: {
      prompt: "Why can a route disappear while the Ethernet link stays UP?",
      options: [
        { id: "adj", label: "SPF only uses links with a working IS-IS adjacency on both ends; a link can pass frames without IS-IS agreeing to route over it" },
        { id: "arp", label: "The ARP entry for 192.0.2.3 expired" },
        { id: "prefix", label: "PE2 stopped advertising 10.0.0.4/32" },
        { id: "bgp", label: "BGP withdrew the route" },
      ],
      correctOptionId: "adj",
      explanation: "Physical/link state and routing adjacency are different layers. PE2 still advertises its loopback — PE1 just has no usable topology path to PE2.",
    },
  },
  {
    id: "predict-what",
    label: "Diagnose: the root cause",
    narrative: "Clues: P1 ge-0/0/1 up, P2 ge-0/0/0 up. Both send P2P IIHs. P1's IIH: circuit type 2. P2's IIH: circuit type 1. Adjacency: Down.",
    question: {
      prompt: "What exactly is wrong?",
      options: [
        { id: "level", label: "A level mismatch: P1's circuit is Level-2-only, P2's is Level-1-only — no common level, so no adjacency" },
        { id: "area", label: "The two routers are in different areas" },
        { id: "subnet", label: "The /31 addresses are wrong" },
        { id: "physical", label: "The P1–P2 cable is down" },
      ],
      correctOptionId: "level",
      explanation: "Both routers run IS-IS, share area 49.0001 and have working Ethernet and IPv4. But a Level-2 adjacency needs both ends to run Level 2 on the circuit; P2 now offers only Level 1.",
    },
  },
  {
    id: "diagnostic-layers",
    label: "Troubleshooting ladder",
    narrative: "Check each layer separately: Ethernet, IPv4, IS-IS circuit levels, adjacency, LSDB, SPF result, routing table.",
  },
  {
    id: "repair-challenge",
    label: "Repair the circuit",
    narrative: "Choose the change that fixes the cause you identified.",
    action: (s, payload) => ({ state: applyIsisRepair(s, (payload as { choice: string }).choice), events: [ev("STEP_ENTERED", "repair-challenge", `Repair attempt: ${(payload as { choice: string }).choice}`)] }),
    requiresState: (s) => s.repaired,
  },
  {
    id: "rep-iih-p2",
    label: "P2 → P1: IIH, circuit type 2, Down",
    narrative: "P2's circuit is Level-2-only again. Its IIH now says circuit type 2 and three-way state Down — a fresh start. P1 hears a compatible hello and moves to Initializing.",
    run: (s) => ({ state: iihStep(s, "rep-iih-p2", "P2", "P1"), events: [ev("PACKET_SENT", "rep-iih-p2", "IIH Down")] }),
    packet: pkt,
    whatChanged: (_p, n) => [`P1: ${adjOf(n, "P1", "P2").state} · P2: ${adjOf(n, "P2", "P1").state}`],
  },
  {
    id: "rep-iih-p1",
    label: "P1 → P2: IIH, Initializing",
    narrative: "P1 answers with state Initializing, listing P2. P2 hears its own System ID and goes Up.",
    run: (s) => ({ state: iihStep(s, "rep-iih-p1", "P1", "P2"), events: [ev("PACKET_SENT", "rep-iih-p1", "IIH Initializing")] }),
    packet: pkt,
    whatChanged: (_p, n) => [`P1: ${adjOf(n, "P1", "P2").state} · P2: ${adjOf(n, "P2", "P1").state}`],
  },
  {
    id: "rep-iih-up",
    label: "P2 → P1: IIH, Up",
    narrative: "P2's IIH now says Up and lists P1. P1, Initializing, hears its own ID: Up. The Level-2 adjacency is back — Down → Initializing → Up on P1's side this time.",
    run: (s) => ({ state: iihStep(s, "rep-iih-up", "P2", "P1"), events: [ev("OSPF_NEIGHBOR_STATE_CHANGED", "rep-iih-up", "P1–P2 UP")] }),
    packet: pkt,
    whatChanged: (_p, n) => [adjLine(n)],
  },
  {
    id: "rep-lsp-p1",
    label: "P1 re-originates: sequence 3",
    narrative: "P1 lists P2 again, so it originates sequence 0x00000003 (after 1 and 2 — never backwards) and floods it to P2 and PE1. P2 likewise originates its sequence 3 listing P1.",
    run: (s) => {
      let n = originate(idle(s), "rep-lsp-p1", "P1", 3, "P2");
      const l = lspIn(n, "P1", "P1")!;
      const p2 = buildLsp("P2", 3, upNeighbors(n, "P2"));
      n = { ...n, lsdb: { ...n.lsdb, P2: installLsp(installLsp(n.lsdb.P2, l), p2), PE1: installLsp(n.lsdb.PE1, l), PE2: installLsp(installLsp(n.lsdb.PE2, p2), l) } };
      return { state: n, events: [ev("PACKET_SENT", "rep-lsp-p1", "P1 seq 3")] };
    },
    packet: pkt,
    whatChanged: (_p, n) => [lspSummary(lspIn(n, "P1", "P1")!), lspSummary(lspIn(n, "P2", "P2")!)],
  },
  {
    id: "rep-csnp",
    label: "P2 → P1: CSNP after the adjacency returns",
    narrative: "With the adjacency back, P2 sends a CSNP. P1 compares: P2's own LSP is sequence 3 in the CSNP but sequence 1 in P1's database — P1 is missing P2's newer LSP.",
    run: (s) => {
      const p = csnpPacket("rep-csnp", "P2", "P1", s.lsdb.P2);
      const diff = s.lsdb.P2.filter((l) => (lspIn(s, "P1", l.originator)?.seq ?? 0) < l.seq);
      const h = hop("rep-csnp", "P1", { active: "lsdb", ingress: "ge-0/0/1", details: { rx: "L2 CSNP from P2", lsdb: s.lsdb.P2.map((l) => `${l.id} CSNP ${hex8s(l.seq)} / mine ${hex8s(lspIn(s, "P1", l.originator)?.seq ?? 0)}`).join(" · ") }, lookupType: "P1 LSDB comparison", key: "CSNP entries", result: `missing newer: ${diff.map((d) => d.id).join(", ") || "none"}`, action: "CSNP · DIFFERENCES", reason: "The CSNP reveals which LSPs P1 lacks or holds older copies of.", input: `${s.lsdb.P2.length} entries`, output: "request with PSNP", before: p });
      return { state: { ...idle(s), hops: [...s.hops, h], packet: p, lastPdu: { ...s.lastPdu, P1: "received L2 CSNP (25)" }, decision: { device: "P1", text: `P1: missing ${diff.map((d) => d.id).join(", ")}` } }, events: [ev("PACKET_SENT", "rep-csnp", "CSNP")] };
    },
    packet: pkt,
  },
  {
    id: "rep-psnp",
    label: "P1 → P2: PSNP request",
    narrative: "P1 answers with a PSNP entry for 0000.0000.0003.00-00 carrying its own copy (sequence 1). P2 sees that copy is older than its sequence 3 and sends the LSP. This is the other job of a PSNP: requesting, not only acknowledging.",
    run: (s) => {
      const l = lspIn(s, "P2", "P2")!;
      // On a P2P circuit the request entry carries P1's own (older) copy; the neighbor sees it is older and sends its LSP.
      const p = psnpPacket("rep-psnp", "P1", "P2", [lspIn(s, "P1", "P2")!], "request");
      const h = hop("rep-psnp", "P1", { active: "flood", egress: "ge-0/0/1", details: { flood: `request ${l.id}` }, lookupType: "P1 flooding", key: l.id, result: "requested", action: "PSNP · REQUEST", reason: "A PSNP entry for an LSP you do not have (or have older) asks the neighbor to send it.", input: l.id, output: "PSNP → P2", next: "P2", after: p });
      return { state: { ...idle(s), hops: [...s.hops, h], packet: p, lastPdu: { ...s.lastPdu, P1: "sent L2 PSNP (27) request" }, decision: { device: "P1", text: `P1: request ${l.id}` } }, events: [ev("PACKET_SENT", "rep-psnp", "PSNP request")] };
    },
    packet: pkt,
  },
  {
    id: "rep-lsp-p2",
    label: "P2 sends its LSP; P1 floods it",
    narrative: "P2 sends LSP 0000.0000.0003.00-00 sequence 3. P1 installs it (newer than sequence 1) and floods it to PE1. PE1's database now shows P1 and P2 listing each other again.",
    run: (s) => {
      const l = lspIn(s, "P2", "P2")!;
      const r = lspReceive(s, "rep-lsp-p2", "P2", "P1", l, "PE1");
      return { state: { ...r, lsdb: { ...r.lsdb, PE1: installLsp(r.lsdb.PE1, l) } }, events: [ev("PACKET_SENT", "rep-lsp-p2", "P2 seq 3")] };
    },
    packet: pkt,
    whatChanged: (_p, n) => [`PE1 LSDB: ${n.lsdb.PE1.map((l) => `${l.originator} ${hex8s(l.seq)}`).join(", ")}`],
  },
  {
    id: "rep-spf",
    label: "PE1 re-runs SPF",
    narrative: "P1–P2 passes the two-way check again. PE1's tree: P1 10, P2 20, PE2 30. 10.0.0.4/32 is back at metric 40 via P1.",
    run: (s) => {
      let n = s;
      for (const r of ["P1", "P2", "PE2"] as IsisRouter[]) n = { ...n, spf: { ...n.spf, [r]: runSpf(r, n.lsdb[r]) }, rib: { ...n.rib, [r]: runSpf(r, n.lsdb[r]).routes } };
      return { state: spfStep(n, "rep-spf", "PE1"), events: [ev("OSPF_SPF_COMPLETED", "rep-spf", "Route back")] };
    },
    whatChanged: (_p, n) => [`PE1 → 10.0.0.4/32: metric ${routeTo(n, "PE1", "10.0.0.4/32")?.metric} via ${routeTo(n, "PE1", "10.0.0.4/32")?.nextHop}`],
  },
  {
    id: "ver-ping-send",
    label: "Verify: PE1 pings again",
    narrative: "ICMP Echo 10.0.0.1 → 10.0.0.4 leaves PE1 on the restored IS-IS route.",
    run: (s) => ({ state: forward(s, "ver-ping-send", "PE1", 64), events: [ev("PACKET_SENT", "ver-ping-send", "Ping")] }),
    packet: pkt,
  },
  {
    id: "ver-ping-deliver",
    label: "Verify: delivered",
    narrative: "P1 and P2 forward it by their own IS-IS routes; PE2 accepts it. The level fix restored the adjacency, the LSDB, the SPF result and the forwarding path.",
    run: (s) => {
      const a = forward(s, "ver-ping-deliver", "P1", 63);
      const b = forward(a, "ver-ping-deliver", "P2", 62);
      const h = hop("ver-ping-deliver", "PE2", { active: "fwd", details: { fwd: "10.0.0.4 is local → deliver" }, lookupType: "PE2 IPv4", key: "10.0.0.4", result: "local", action: "DELIVER", reason: "PE2 owns the destination.", input: "ICMP Echo", output: "delivered" });
      return { state: { ...b, hops: [...b.hops, h], ping: "delivered to PE2" }, events: [ev("PACKET_RECEIVED", "ver-ping-deliver", "Delivered")] };
    },
    packet: pkt,
    whatChanged: (_p, n) => [`Ping: ${n.ping}`],
  },
  {
    id: "operations",
    label: "Checking it on real routers",
    narrative: "On real routers you would check the same layers with commands such as (Cisco-style) show isis neighbors / show isis database / show ip route isis, or (Juniper-style) show isis adjacency / show isis database / show route protocol isis. The syntax is vendor-specific; the questions — adjacency, levels, LSDB, SPF result, route — are the protocol's.",
    run: (s) => ({ state: idle(s), events: [] }),
  },
  {
    id: "complete",
    label: "Lesson complete",
    narrative: "NETs and System IDs, IS-IS directly over Layer 2, the three-way P2P handshake, LSP flooding with CSNP/PSNP, SPF with a two-way check, ordinary IPv4 forwarding — and a level mismatch that broke routing while every cable stayed up.",
  },
];
