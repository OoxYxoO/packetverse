import { ipToNum, numToIp } from "./fundamentalsPackets";
import { alignedBlocks, blockSize, containingNetwork, isAligned, maskOf, overlaps, prefixFor, rangeOf, usableHosts, type Range } from "./subnettingDesign";

/**
 * SUBNET STUDIO — the pure model behind the Subnetting lab's engineering stage (Design · Apply & test · Troubleshoot).
 *
 * It generalises the lesson's planning rules to any /24 parent and any list of requirements, and composes only the
 * CIDR primitives of subnettingDesign.ts (blockSize, isAligned, containingNetwork, rangeOf, overlaps, alignedBlocks,
 * prefixFor, maskOf) — no second copy of the arithmetic. The audit cross-checks it against subnettingLab.ts on the
 * lesson's own 10.44.0.0/24.
 *
 *  - DESIGN: the learner writes each network (prefix + start) freely. The validator reports ALL violations at once —
 *    TOO_SMALL, MISALIGNED, OUTSIDE_PARENT and OVERLAP judged on the REAL block (address AND mask) — plus OVERSIZED and
 *    ADJACENT as advice that never invalidates a plan. Pass/fail is the rules, never one reference answer.
 *  - FREE SPACE: ranges, the aligned blocks each range can hold, and "can N hosts still fit?" (numerically enough
 *    addresses is not the same as an aligned block being free).
 *  - APPLY: the plan becomes device configuration the way an admin would hand it out (R1 = written start + 1, the LAN
 *    host = written start + 10, gateway = R1). R1 refuses an address whose real network overlaps another interface,
 *    as IOS and Junos do.
 *  - TEST: a ping walks the own-mask local/remote decision (IPv4 Basics), ARP on the right wire, R1's connected routes
 *    and the way back. Nothing is scripted: a broken plan breaks the pings by itself.
 *
 * Requirement counts include the router: a LAN's count includes R1's interface, a link's 2 are R1 and the far router.
 * Ordinary LAN arithmetic only (/22–/30); /31 and /32 are explained in the lesson, never planned here.
 */

// ---------------------------------------------------------------------------------------------------------------
// Briefs
// ---------------------------------------------------------------------------------------------------------------
export type SsKind = "lan" | "link";
export interface SsNeed {
  id: string;
  hosts: number;
  kind: SsKind;
  /** R1 interface number: GigabitEthernet0/n · ge-0/0/n. */
  iface: number;
  /** The device at the far end of this network: a LAN host, or the router across a link. */
  device: string;
  os: "linux" | "windows" | "router";
  what: string;
  /** Several devices on this network (the lab topology); otherwise one device named `device`. */
  devices?: { id: string; name: string; os: "linux" | "windows" }[];
}
export interface SsBrief {
  id: string;
  title: string;
  story: string;
  parent: { network: string; prefix: number };
  needs: SsNeed[];
  /** A requirement that arrives later (the growth exercise). */
  growth?: SsNeed;
}
export const SS_BRIEFS: SsBrief[] = [
  {
    id: "lab",
    title: "Branch network lab",
    story: "A real branch: R1, four switched LANs of different sizes with their PCs and servers, and a WAN link to the ISP. Subnet 172.20.8.0/24 for it, configure every device, and prove it works.",
    parent: { network: "172.20.8.0", prefix: 24 },
    needs: [
      { id: "STAFF", hosts: 100, kind: "lan", iface: 1, device: "PC-S1", os: "windows", what: "Staff desks", devices: [{ id: "PC-S1", name: "PC-S1", os: "windows" }, { id: "PC-S2", name: "PC-S2", os: "linux" }] },
      { id: "LAB", hosts: 50, kind: "lan", iface: 2, device: "LAB-1", os: "linux", what: "Engineering lab", devices: [{ id: "LAB-1", name: "LAB-1", os: "linux" }, { id: "LAB-2", name: "LAB-2", os: "windows" }] },
      { id: "SERVERS", hosts: 20, kind: "lan", iface: 3, device: "SRV-1", os: "linux", what: "Server room", devices: [{ id: "SRV-1", name: "SRV-1", os: "linux" }, { id: "SRV-2", name: "SRV-2", os: "linux" }] },
      { id: "MGMT", hosts: 6, kind: "lan", iface: 4, device: "JUMP", os: "linux", what: "Management", devices: [{ id: "JUMP", name: "JUMP", os: "linux" }] },
      { id: "WAN", hosts: 2, kind: "link", iface: 0, device: "ISP", os: "router", what: "Link to the ISP" },
    ],
  },
  {
    id: "branch",
    title: "Branch office",
    story: "The lesson's own network: three LANs and a transit link to R2, inside 10.44.0.0/24.",
    parent: { network: "10.44.0.0", prefix: 24 },
    needs: [
      { id: "LAN-A", hosts: 100, kind: "lan", iface: 1, device: "HOST-A", os: "linux", what: "Staff" },
      { id: "LAN-B", hosts: 50, kind: "lan", iface: 2, device: "HOST-B", os: "windows", what: "Engineering" },
      { id: "LAN-C", hosts: 25, kind: "lan", iface: 3, device: "HOST-C", os: "linux", what: "Servers" },
      { id: "TRANSIT", hosts: 2, kind: "link", iface: 0, device: "R2", os: "router", what: "Link to R2" },
    ],
  },
  {
    id: "campus",
    title: "Campus floor",
    story: "Six networks that almost fill 192.168.40.0/24 (252 of 256 addresses). Every block must sit exactly right.",
    parent: { network: "192.168.40.0", prefix: 24 },
    needs: [
      { id: "WIFI", hosts: 90, kind: "lan", iface: 1, device: "LAPTOP", os: "windows", what: "Wi-Fi clients" },
      { id: "STAFF", hosts: 58, kind: "lan", iface: 2, device: "PC-STAFF", os: "windows", what: "Desk PCs" },
      { id: "CAMS", hosts: 20, kind: "lan", iface: 3, device: "NVR", os: "linux", what: "Cameras + recorder" },
      { id: "PRINT", hosts: 9, kind: "lan", iface: 4, device: "PRN-SRV", os: "linux", what: "Printers" },
      { id: "MGMT", hosts: 5, kind: "lan", iface: 5, device: "JUMPBOX", os: "linux", what: "Management" },
      { id: "WAN", hosts: 2, kind: "link", iface: 0, device: "ISP", os: "router", what: "Link to the ISP" },
    ],
  },
  {
    id: "growth",
    title: "Two WAN links + growth",
    story: "Three LANs and two provider links in 172.16.9.0/24, then a new Guest LAN arrives. Will your free space hold it?",
    parent: { network: "172.16.9.0", prefix: 24 },
    needs: [
      { id: "OFFICE", hosts: 100, kind: "lan", iface: 2, device: "PC-OFFICE", os: "windows", what: "Office" },
      { id: "LAB", hosts: 25, kind: "lan", iface: 3, device: "LAB-PC", os: "linux", what: "Test lab" },
      { id: "VOICE", hosts: 25, kind: "lan", iface: 4, device: "PHONE-GW", os: "linux", what: "IP phones" },
      { id: "WAN-1", hosts: 2, kind: "link", iface: 0, device: "ISP-1", os: "router", what: "Provider 1" },
      { id: "WAN-2", hosts: 2, kind: "link", iface: 1, device: "ISP-2", os: "router", what: "Provider 2" },
    ],
    growth: { id: "GUEST", hosts: 26, kind: "lan", iface: 5, device: "GUEST-PC", os: "windows", what: "Guest Wi-Fi" },
  },
];
export const ssBrief = (id: string) => SS_BRIEFS.find((b) => b.id === id) ?? SS_BRIEFS[0];

// ---------------------------------------------------------------------------------------------------------------
// Small helpers (composition only)
// ---------------------------------------------------------------------------------------------------------------
export const SS_PREFIX_MIN = 22;
export const SS_PREFIX_MAX = 30;
export const SS_HOSTS_MAX = 1000;
export const ssPrefixOk = (p: number) => Number.isInteger(p) && p >= SS_PREFIX_MIN && p <= SS_PREFIX_MAX;
export const ssMinPrefix = (hosts: number) => prefixFor(hosts).prefix;
export const ssUsable = (p: number) => usableHosts(p);
export function ssParseIp(text: string): string | undefined {
  const t = text.trim();
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(t)) return undefined;
  const o = t.split(".").map(Number);
  return o.some((x) => x > 255) ? undefined : o.join(".");
}
export const ssNetOf = (ip: string, prefix: number) => containingNetwork(ip, prefix);
export const ssInside = (ip: string, network: string, prefix: number) => ssNetOf(ip, prefix) === network;
/** Last octet when inside the parent /24, the full address otherwise. */
export function ssShort(parent: SsBrief["parent"], n: number) {
  const p = rangeOf(parent.network, parent.prefix);
  return n >= p.first && n <= p.last ? `.${n - p.first}` : numToIp(n);
}
export const ssRangeText = (parent: SsBrief["parent"], r: Range) => `${ssShort(parent, r.first)}–${ssShort(parent, r.last)}`;
export const ssCiscoIf = (n: number) => `GigabitEthernet0/${n}`;
export const ssShortIf = (n: number) => `Gi0/${n}`;
export const ssJunosIf = (n: number) => `ge-0/0/${n}`;

// ---------------------------------------------------------------------------------------------------------------
// Rows and the all-violations validator
// ---------------------------------------------------------------------------------------------------------------
export interface SsRow {
  id: string;
  prefix?: number;
  /** As written (full dotted address) — never normalized. */
  network?: string;
}
export type SsCode = "TOO_SMALL" | "MISALIGNED" | "OUTSIDE_PARENT" | "OVERLAP";
export interface SsViolation {
  code: SsCode;
  text: string;
  with?: string;
  shared?: Range;
}
export interface SsCheck {
  id: string;
  hosts: number;
  prefix: number;
  written: string;
  real: string;
  realRange: Range;
  writtenRange: Range;
  block: number;
  usable: number;
  mask: string;
  /** Written start's distance from the previous boundary (0 = aligned). */
  rem: number;
  aligned: boolean;
  first: string;
  last: string;
  broadcast: string;
  minPrefix: number;
  /** Advisory: valid but bigger than the smallest fit — the extra addresses. */
  oversized?: number;
  /** Neighbors that touch this block without overlapping it (advice: adjacency is fine). */
  adjacent: string[];
  violations: SsViolation[];
  valid: boolean;
}
const placed = (r: SsRow): r is SsRow & { prefix: number; network: string } => r.prefix !== undefined && r.network !== undefined;
export const ssPlaced = placed;
const realRange = (r: SsRow & { prefix: number; network: string }) => rangeOf(containingNetwork(r.network, r.prefix), r.prefix);

export function ssCheck(parent: SsBrief["parent"], needs: SsNeed[], rows: SsRow[], id: string): SsCheck | undefined {
  const row = rows.find((r) => r.id === id);
  const need = needs.find((n) => n.id === id);
  if (!row || !need || !placed(row)) return undefined;
  const { prefix, network } = row;
  const block = blockSize(prefix);
  const real = containingNetwork(network, prefix);
  const rr = rangeOf(real, prefix);
  const ws = ipToNum(network);
  const pr = rangeOf(parent.network, parent.prefix);
  const usable = usableHosts(prefix);
  const v: SsViolation[] = [];
  const rem = ws - rr.first;
  const S = (n: number) => ssShort(parent, n);
  if (usable < need.hosts) v.push({ code: "TOO_SMALL", text: `/${prefix} = ${block} addresses, ${usable} usable; ${id} needs ${need.hosts}.` });
  if (rem !== 0) v.push({ code: "MISALIGNED", text: `${network} is ${rem} past a /${prefix} boundary (${S(ws)} − ${S(rr.first)} = ${rem}; boundaries every ${block}). Its real block is ${real}/${prefix} (${ssRangeText(parent, rr)}).` });
  if (rr.first < pr.first || rr.last > pr.last) v.push({ code: "OUTSIDE_PARENT", text: `${real}/${prefix} (${numToIp(rr.first)}–${numToIp(rr.last)}) is not inside ${parent.network}/${parent.prefix}.` });
  const adjacent: string[] = [];
  for (const o of rows) {
    if (o.id === id || !placed(o)) continue;
    const or = realRange(o);
    if (overlaps(rr, or)) {
      const shared = { first: Math.max(rr.first, or.first), last: Math.min(rr.last, or.last) };
      v.push({ code: "OVERLAP", with: o.id, shared, text: `${id}'s real block ${ssRangeText(parent, rr)} shares ${ssRangeText(parent, shared)} with ${o.id} (${ssRangeText(parent, or)}).` });
    } else if (or.last + 1 === rr.first || rr.last + 1 === or.first) adjacent.push(o.id);
  }
  const min = ssMinPrefix(need.hosts);
  return {
    id,
    hosts: need.hosts,
    prefix,
    written: network,
    real,
    realRange: rr,
    writtenRange: { first: ws, last: ws + block - 1 },
    block,
    usable,
    mask: maskOf(prefix),
    rem,
    aligned: isAligned(network, prefix),
    first: numToIp(rr.first + 1),
    last: numToIp(rr.last - 1),
    broadcast: numToIp(rr.last),
    minPrefix: min,
    oversized: usable >= need.hosts && prefix < min ? block - blockSize(min) : undefined,
    adjacent,
    violations: v,
    valid: v.length === 0,
  };
}

export interface SsFreeRange extends Range {
  blocks: { network: string; prefix: number }[];
}
/** Free address space in the parent around a set of real blocks: ranges, and the aligned blocks each one holds. */
export function ssFree(parent: SsBrief["parent"], used: Range[]) {
  const pr = rangeOf(parent.network, parent.prefix);
  const sorted = used.map((u) => ({ first: Math.max(u.first, pr.first), last: Math.min(u.last, pr.last) })).filter((u) => u.first <= u.last).sort((a, b) => a.first - b.first);
  const ranges: SsFreeRange[] = [];
  let cur = pr.first;
  for (const u of sorted) {
    if (u.first > cur) ranges.push({ first: cur, last: u.first - 1, blocks: [] });
    cur = Math.max(cur, u.last + 1);
  }
  if (cur <= pr.last) ranges.push({ first: cur, last: pr.last, blocks: [] });
  for (const r of ranges) r.blocks = alignedBlocks(r);
  const free = ranges.reduce((n, r) => n + r.last - r.first + 1, 0);
  const largest = ranges.flatMap((r) => r.blocks).reduce((m, b) => Math.min(m, b.prefix), 33);
  return { ranges, free, total: pr.last - pr.first + 1, allocated: pr.last - pr.first + 1 - free, largestPrefix: largest === 33 ? undefined : largest };
}

export interface SsFit {
  hosts: number;
  prefix: number;
  size: number;
  free: number;
  /** Enough addresses in total (ignoring alignment). */
  enough: boolean;
  /** Every aligned, free block of the right size. */
  candidates: string[];
  fits: boolean;
}
/** Can a new network of `hosts` still be placed? Numbers alone are not the answer: it needs a free ALIGNED block. */
export function ssCanFit(space: ReturnType<typeof ssFree>, hosts: number): SsFit {
  const prefix = ssMinPrefix(hosts);
  const size = blockSize(prefix);
  const candidates: string[] = [];
  for (const r of space.ranges) for (let s = Math.ceil(r.first / size) * size; s + size - 1 <= r.last; s += size) candidates.push(numToIp(s));
  return { hosts, prefix, size, free: space.free, enough: space.free >= size, candidates, fits: candidates.length > 0 };
}

export interface SsReport {
  checks: SsCheck[];
  unplaced: string[];
  allPlaced: boolean;
  capacity: boolean;
  aligned: boolean;
  inside: boolean;
  noOverlap: boolean;
  allValid: boolean;
  oversized: string[];
  overlaps: { a: string; b: string; shared: Range }[];
  adjacent: { a: string; b: string }[];
  space: ReturnType<typeof ssFree>;
}
export function ssReport(parent: SsBrief["parent"], needs: SsNeed[], rows: SsRow[]): SsReport {
  const checks = needs.map((n) => ssCheck(parent, needs, rows, n.id)).filter((c): c is SsCheck => !!c);
  const has = (code: SsCode) => checks.some((c) => c.violations.some((v) => v.code === code));
  const unplaced = needs.filter((n) => !rows.some((r) => r.id === n.id && placed(r))).map((n) => n.id);
  const pairs: SsReport["overlaps"] = [];
  const adj: SsReport["adjacent"] = [];
  checks.forEach((c, i) => {
    for (const v of c.violations) if (v.code === "OVERLAP" && checks.findIndex((x) => x.id === v.with) > i) pairs.push({ a: c.id, b: v.with!, shared: v.shared! });
    for (const a of c.adjacent) if (checks.findIndex((x) => x.id === a) > i) adj.push({ a: c.id, b: a });
  });
  return {
    checks,
    unplaced,
    allPlaced: unplaced.length === 0,
    capacity: !has("TOO_SMALL"),
    aligned: !has("MISALIGNED"),
    inside: !has("OUTSIDE_PARENT"),
    noOverlap: !has("OVERLAP"),
    allValid: unplaced.length === 0 && checks.every((c) => c.valid),
    oversized: checks.filter((c) => c.oversized).map((c) => c.id),
    overlaps: pairs,
    adjacent: adj,
    space: ssFree(parent, checks.map((c) => c.realRange)),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// One-address calculations (any prefix /8–/30) and the practice drill
// ---------------------------------------------------------------------------------------------------------------
export interface SsCalc {
  ip: string;
  prefix: number;
  mask: string;
  hostBits: number;
  block: number;
  usable: number;
  network: string;
  first: string;
  last: string;
  broadcast: string;
  next: string;
  /** The octet where the mask stops being 255 (0-based), its mask value and its block step. */
  octet: number;
  maskOctet: number;
  step: number;
}
export function ssCalc(ip: string, prefix: number): SsCalc {
  if (!Number.isInteger(prefix) || prefix < 8 || prefix > 30) throw new RangeError(`ssCalc: /${prefix} is outside /8–/30 (ordinary subnets)`);
  const network = containingNetwork(ip, prefix);
  const r = rangeOf(network, prefix);
  const octet = Math.min(3, Math.floor(prefix / 8) - (prefix % 8 === 0 ? 1 : 0));
  const maskOctet = Number(maskOf(prefix).split(".")[octet]);
  return { ip, prefix, mask: maskOf(prefix), hostBits: 32 - prefix, block: blockSize(prefix), usable: usableHosts(prefix), network, first: numToIp(r.first + 1), last: numToIp(r.last - 1), broadcast: numToIp(r.last), next: numToIp(r.last + 1), octet, maskOctet, step: 256 - maskOctet };
}
/** Deterministic practice problems: level 1 = last octet in 10.44.0.x, 2 = last octet anywhere, 3 = third octet (/17–/23). */
export function ssDrill(n: number, level: 1 | 2 | 3): { ip: string; prefix: number } {
  let x = (n + 1) * 2654435761 + level * 40503;
  const rnd = (m: number) => {
    x = (x * 1103515245 + 12345) % 2147483648;
    return x % m;
  };
  if (level === 1) return { ip: `10.44.0.${rnd(254) + 1}`, prefix: 25 + rnd(6) };
  if (level === 2) return { ip: `192.168.${rnd(256)}.${rnd(254) + 1}`, prefix: 25 + rnd(6) };
  return { ip: `172.${16 + rnd(16)}.${rnd(256)}.${rnd(256)}`, prefix: 17 + rnd(7) };
}

// ---------------------------------------------------------------------------------------------------------------
// Devices: the plan applied
// ---------------------------------------------------------------------------------------------------------------
export interface SsIf {
  ip?: string;
  prefix?: number;
}
export interface SsHostCfg {
  ip?: string;
  prefix?: number;
  gw?: string;
}
export interface SsNet {
  /** R1's interfaces, by network id. */
  r1: Record<string, SsIf>;
  /** Every end device (LAN hosts, far routers on links), by device id. */
  hosts: Record<string, SsHostCfg>;
}
export type SsDev = "r1" | string;
export interface SsDevice {
  id: string;
  name: string;
  os: "linux" | "windows" | "router";
  /** The network (wire) it is plugged into. */
  wire: string;
  /** Position on its wire (0 = first device). */
  k: number;
}
/** Every end device of the topology: a need's own devices, or one device named after it. */
export function ssDevices(needs: SsNeed[]): SsDevice[] {
  return needs.flatMap((n) => (n.devices?.length ? n.devices.map((d, k) => ({ ...d, wire: n.id, k })) : [{ id: n.id, name: n.device, os: n.os, wire: n.id, k: 0 }]));
}
export const ssDevice = (needs: SsNeed[], id: string) => ssDevices(needs).find((d) => d.id === id);
export const ssWireDevices = (needs: SsNeed[], wire: string) => ssDevices(needs).filter((d) => d.wire === wire);
export const ssDevName = (needs: SsNeed[], d: SsDev) => (d === "r1" ? "R1" : (ssDevice(needs, d)?.name ?? d));
export const SS_HOST_OFFSET = 10;
export const SS_R1_OFFSET = 1;

/** Would R1 accept ip/prefix on `id`'s interface? IOS and Junos both refuse a network that overlaps another interface. */
export function ssR1Accept(needs: SsNeed[], r1: Record<string, SsIf>, id: string, ip: string, prefix: number): { ok: true } | { ok: false; ios: string; junos: string; with?: string; code: "overlap" | "network" | "broadcast" | "prefix" } {
  if (!Number.isInteger(prefix) || prefix < 8 || prefix > 30) return { ok: false, code: "prefix", ios: "% Invalid input detected at '^' marker.", junos: `error: ${ip}/${prefix}: invalid prefix length` };
  const net = containingNetwork(ip, prefix);
  const r = rangeOf(net, prefix);
  if (ipToNum(ip) === r.first) return { ok: false, code: "network", ios: `% Bad mask /${prefix} for address ${ip}`, junos: `error: ${ip}/${prefix}: address is the subnet's network address` };
  if (ipToNum(ip) === r.last) return { ok: false, code: "broadcast", ios: `% Bad mask /${prefix} for address ${ip}`, junos: `error: ${ip}/${prefix}: address is the subnet's broadcast address` };
  for (const n of needs) {
    if (n.id === id) continue;
    const o = r1[n.id];
    if (!o?.ip || o.prefix === undefined) continue;
    if (overlaps(r, rangeOf(containingNetwork(o.ip, o.prefix), o.prefix))) return { ok: false, code: "overlap", with: n.id, ios: `% ${net} overlaps with ${ssCiscoIf(n.iface)}`, junos: `error: Overlapping subnet is configured under ${ssJunosIf(n.iface)}.0` };
  }
  return { ok: true };
}

/** The address a device would be given from a written start: start + 10 + k (start + 2 + k on links and tiny blocks). */
export const ssHostOffset = (n: SsNeed, prefix: number, k: number) => (n.kind === "link" || blockSize(prefix) <= SS_HOST_OFFSET + 3 ? 2 : SS_HOST_OFFSET) + k;
/** The plan as an admin hands it out: R1 = written start + 1, devices = start + 10, + 11 … mask = the row, gateway = R1. */
export function ssPlanConfig(needs: SsNeed[], rows: SsRow[]): { net: SsNet; refused: { id: string; ios: string; junos: string }[] } {
  const net: SsNet = { r1: {}, hosts: {} };
  const refused: { id: string; ios: string; junos: string }[] = [];
  for (const n of [...needs].sort((a, b) => a.iface - b.iface)) {
    const row = rows.find((r) => r.id === n.id);
    const devs = ssWireDevices(needs, n.id);
    if (!row || !placed(row)) {
      net.r1[n.id] = {};
      for (const d of devs) net.hosts[d.id] = {};
      continue;
    }
    const base = ipToNum(row.network);
    const gw = numToIp(base + SS_R1_OFFSET);
    const ok = ssR1Accept(needs, net.r1, n.id, gw, row.prefix);
    if (ok.ok) net.r1[n.id] = { ip: gw, prefix: row.prefix };
    else {
      net.r1[n.id] = {};
      refused.push({ id: n.id, ios: ok.ios, junos: ok.junos });
    }
    for (const d of devs) net.hosts[d.id] = { ip: numToIp(base + ssHostOffset(n, row.prefix, d.k)), prefix: row.prefix, gw };
  }
  return { net, refused };
}

// ---------------------------------------------------------------------------------------------------------------
// Ping: the own-mask decision, ARP on the right wire, R1's connected routes, and the way back — hops (the reasons)
// and frames (what crosses which link, for the topology animation), produced by the same walk.
// ---------------------------------------------------------------------------------------------------------------
export type SsFail = "no-ip" | "no-gw" | "gw-off-subnet" | "arp-gw" | "arp-local" | "not-router" | "no-route" | "arp-r1";
export interface SsDecision {
  who: string;
  ip: string;
  prefix: number;
  dst: string;
  srcNet: string;
  dstNet: string;
  local: boolean;
}
export interface SsHop {
  at: string;
  text: string;
  tone: "info" | "ok" | "bad";
  decision?: SsDecision;
}
/** One moment on the wire. Each path is a list of topology nodes (device ids, "sw:<wire>", "r1"); a broadcast has several. */
export interface SsFrame {
  kind: "arp-req" | "arp-rep" | "icmp" | "icmp-err" | "drop";
  paths: string[][];
  text: string;
  ok: boolean;
}
export interface SsLeg {
  from: SsDev;
  fromIp?: string;
  to: string;
  ok: boolean;
  arrived?: SsDev;
  fail?: SsFail;
  hops: SsHop[];
  frames: SsFrame[];
}
export interface SsPing {
  src: SsDev;
  dst: string;
  ok: boolean;
  there: SsLeg;
  back?: SsLeg;
  /** Every frame of the exchange, in order (request leg, then reply leg). */
  frames: SsFrame[];
}

const swOf = (needs: SsNeed[], wire: string) => (needs.find((n) => n.id === wire)?.kind === "lan" ? [`sw:${wire}`] : []);
/** Devices on a wire that own an address (several = a duplicate address). R1's interface counts when configured. */
function owners(needs: SsNeed[], net: SsNet, wire: string, ip: string): SsDev[] {
  const out: SsDev[] = ssWireDevices(needs, wire).filter((d) => net.hosts[d.id]?.ip === ip).map((d) => d.id);
  if (net.r1[wire]?.ip === ip) out.push("r1");
  return out;
}
function r1Routes(needs: SsNeed[], net: SsNet) {
  return needs.filter((n) => net.r1[n.id]?.ip && net.r1[n.id].prefix !== undefined).map((n) => ({ id: n.id, iface: n.iface, ip: net.r1[n.id].ip!, prefix: net.r1[n.id].prefix!, network: containingNetwork(net.r1[n.id].ip!, net.r1[n.id].prefix!) }));
}
export const ssR1Routes = r1Routes;

interface Walk {
  needs: SsNeed[];
  net: SsNet;
  hops: SsHop[];
  frames: SsFrame[];
  /** "who>ip": ARP entries learned during this exchange (the target of a request learns the sender). */
  known: Set<string>;
}
/** ARP on a wire, from `who` (a device or "r1") for `ip`. Returns the answering device, or undefined. */
function arp(w: Walk, who: SsDev, whoIp: string | undefined, wire: string, ip: string): SsDev | undefined {
  const { needs, net } = w;
  const name = ssDevName(needs, who);
  const os = owners(needs, net, wire, ip).filter((o) => o !== who);
  if (w.known.has(`${who}>${ip}`) && os.length) return os[os.length - 1];
  const sw = swOf(needs, wire);
  const everyone: SsDev[] = [...ssWireDevices(needs, wire).map((d) => d.id), "r1"].filter((d) => d !== who);
  w.frames.push({ kind: "arp-req", paths: everyone.map((d) => [who, ...sw, d]), ok: true, text: `${name}: ARP who-has ${ip}? (broadcast on ${wire})` });
  if (!os.length) {
    w.frames.push({ kind: "drop", paths: [[who]], ok: false, text: `Nobody on ${wire} owns ${ip}: no ARP reply` });
    return undefined;
  }
  const answer = os[os.length - 1];
  w.frames.push({ kind: "arp-rep", paths: os.map((o) => [o, ...sw, who]), ok: os.length === 1, text: os.length > 1 ? `${os.map((o) => ssDevName(needs, o)).join(" and ")} ${os.length === 2 ? "both" : "all"} answer for ${ip}: duplicate address — the last reply (${ssDevName(needs, answer)}) wins` : `${ssDevName(needs, answer)}: ${ip} is at my MAC` });
  if (os.length > 1) w.hops.push({ at: name, tone: "bad", text: `Two devices answer the ARP for ${ip} on ${wire} (${os.map((o) => ssDevName(needs, o)).join(", ")}): a DUPLICATE ADDRESS. ${name} keeps the last reply, so its frames go to ${ssDevName(needs, answer)}.` });
  if (whoIp) for (const o of os) w.known.add(`${o}>${whoIp}`);
  w.known.add(`${who}>${ip}`);
  return answer;
}

/** R1 delivering to `dst` (as forwarder, or as the source of its own ping). */
function r1Deliver(w: Walk, dst: string, back?: { to: SsDev; ip: string }): { arrived?: SsDev; fail?: SsFail; outIp?: string } {
  const { needs, net, hops, frames } = w;
  const routes = r1Routes(needs, net);
  if (routes.some((r) => r.ip === dst)) {
    hops.push({ at: "R1", tone: "ok", text: `${dst} is R1's own interface address.` });
    return { arrived: "r1", outIp: dst };
  }
  const match = routes.filter((r) => ssInside(dst, r.network, r.prefix)).sort((a, b) => b.prefix - a.prefix)[0];
  if (!match) {
    hops.push({ at: "R1", tone: "bad", text: `R1 looks up ${dst}: no connected route contains it (${routes.map((r) => `${r.network}/${r.prefix}`).join(", ") || "no interfaces configured"}). It drops the packet and answers "Destination net unreachable".` });
    frames.push({ kind: "drop", paths: [["r1"]], ok: false, text: `R1: no route to ${dst}` });
    if (back) frames.push({ kind: "icmp-err", paths: [["r1", ...swOf(needs, ssDevice(needs, back.to)?.wire ?? ""), back.to]], ok: false, text: `R1 → ${back.ip}: ICMP Destination net unreachable` });
    return { fail: "no-route" };
  }
  const need = needs.find((n) => n.id === match.id)!;
  hops.push({ at: "R1", tone: "info", text: `R1 looks up ${dst}: inside ${match.network}/${match.prefix}, connected on ${ssShortIf(need.iface)} (${need.id}).` });
  const owner = arp(w, "r1", match.ip, match.id, dst);
  if (!owner || owner === "r1") {
    hops.push({ at: "R1", tone: "bad", text: `R1 asks "who has ${dst}?" on the ${need.id} wire. Nobody there owns it: no ARP reply, the packet is dropped.` });
    return { fail: "arp-r1", outIp: match.ip };
  }
  hops.push({ at: "R1", tone: "ok", text: `${ssDevName(needs, owner)} answers on the ${need.id} wire; R1 delivers the packet.` });
  frames.push({ kind: "icmp", paths: [["r1", ...swOf(needs, match.id), owner]], ok: true, text: `R1 → ${dst} (new frame on ${ssShortIf(need.iface)})` });
  return { arrived: owner, outIp: match.ip };
}

function leg(w: Walk, from: SsDev, dst: string, kind: "request" | "reply"): SsLeg {
  const { needs, net, hops, frames } = w;
  const h0 = hops.length;
  const f0 = frames.length;
  const done = (r: Partial<SsLeg> & { fromIp?: string }): SsLeg => ({ from, to: dst, ok: false, ...r, hops: hops.slice(h0), frames: frames.slice(f0) });
  const msg = kind === "request" ? "echo request" : "echo reply";
  if (from === "r1") {
    const r = r1Deliver(w, dst);
    return done({ fromIp: r.outIp, ok: !!r.arrived, arrived: r.arrived, fail: r.fail });
  }
  const dev = ssDevice(needs, from)!;
  const name = dev.name;
  const c = net.hosts[from];
  if (!c?.ip || c.prefix === undefined) {
    hops.push({ at: name, tone: "bad", text: `${name} has no IPv4 address: it can't send.` });
    frames.push({ kind: "drop", paths: [[from]], ok: false, text: `${name}: no address` });
    return done({ fail: "no-ip" });
  }
  const srcNet = containingNetwork(c.ip, c.prefix);
  const dstNet = containingNetwork(dst, c.prefix);
  const local = srcNet === dstNet;
  const decision: SsDecision = { who: name, ip: c.ip, prefix: c.prefix, dst, srcNet, dstNet, local };
  hops.push({ at: name, tone: "info", decision, text: `${name} ANDs both addresses with its own mask /${c.prefix}: ${c.ip} → ${srcNet}, ${dst} → ${dstNet}. ${local ? "Same network: LOCAL, deliver directly." : "Different networks: REMOTE, send to the gateway."}` });
  const sw = swOf(needs, dev.wire);
  if (local) {
    const owner = arp(w, from, c.ip, dev.wire, dst);
    if (!owner) {
      hops.push({ at: name, tone: "bad", text: `${name} asks "who has ${dst}?" on its own wire (${dev.wire}). Nobody on that wire owns ${dst}: no ARP reply. "Destination host unreachable".` });
      return done({ fromIp: c.ip, fail: "arp-local" });
    }
    hops.push({ at: name, tone: "ok", text: `${ssDevName(needs, owner)} answers the ARP on the ${dev.wire} wire; the packet is delivered directly.` });
    frames.push({ kind: "icmp", paths: [[from, ...sw, owner]], ok: true, text: `${name} → ${dst}: ${msg} (delivered directly)` });
    return done({ fromIp: c.ip, ok: true, arrived: owner });
  }
  if (!c.gw) {
    hops.push({ at: name, tone: "bad", text: `${name} has no default gateway: a remote destination has nowhere to go ("Network is unreachable").` });
    frames.push({ kind: "drop", paths: [[from]], ok: false, text: `${name}: remote, but no gateway` });
    return done({ fromIp: c.ip, fail: "no-gw" });
  }
  if (containingNetwork(c.gw, c.prefix) !== srcNet) {
    hops.push({ at: name, tone: "bad", text: `${name}'s gateway ${c.gw} is not inside its own network ${srcNet}/${c.prefix} (${c.gw} AND /${c.prefix} = ${containingNetwork(c.gw, c.prefix)}). A gateway must be on the host's own subnet, so the packet never leaves.` });
    frames.push({ kind: "drop", paths: [[from]], ok: false, text: `${name}: gateway ${c.gw} is not on its subnet` });
    return done({ fromIp: c.ip, fail: "gw-off-subnet" });
  }
  const owner = arp(w, from, c.ip, dev.wire, c.gw);
  if (!owner) {
    hops.push({ at: name, tone: "bad", text: `${name} asks "who has ${c.gw}?" (its gateway) on the ${dev.wire} wire. Nobody answers: R1's ${dev.wire} interface does not have that address.` });
    return done({ fromIp: c.ip, fail: "arp-gw" });
  }
  if (owner !== "r1") {
    hops.push({ at: name, tone: "bad", text: `${c.gw} belongs to ${ssDevName(needs, owner)}, which is not a router: it drops the packet.` });
    frames.push({ kind: "icmp", paths: [[from, ...sw, owner]], ok: false, text: `${name} → ${ssDevName(needs, owner)} (not a router)` }, { kind: "drop", paths: [[owner]], ok: false, text: `${ssDevName(needs, owner)} drops it` });
    return done({ fromIp: c.ip, fail: "not-router" });
  }
  hops.push({ at: name, tone: "ok", text: `R1 answers for the gateway ${c.gw}; ${name} sends the packet to R1 (IP destination ${dst}, Ethernet destination R1).` });
  frames.push({ kind: "icmp", paths: [[from, ...sw, "r1"]], ok: true, text: `${name} → ${dst}: ${msg} via the gateway (frame to R1)` });
  const r = r1Deliver(w, dst, { to: from, ip: c.ip });
  return done({ fromIp: c.ip, ok: !!r.arrived, arrived: r.arrived, fail: r.fail });
}

export function ssPing(needs: SsNeed[], net: SsNet, src: SsDev, dst: string): SsPing {
  const w: Walk = { needs, net, hops: [], frames: [], known: new Set() };
  const there = leg(w, src, dst, "request");
  if (!there.ok || !there.arrived || !there.fromIp) return { src, dst, ok: false, there, frames: there.frames };
  const back = leg(w, there.arrived, there.fromIp, "reply");
  if (back.hops[0]) back.hops[0] = { ...back.hops[0], text: `Reply: ${back.hops[0].text}` };
  return { src, dst, ok: back.ok, there, back, frames: [...there.frames, ...back.frames] };
}
/** Every device to every other device's address. `ok` = a reply came back from the INTENDED device. */
export function ssTestAll(needs: SsNeed[], net: SsNet) {
  const devs = ssDevices(needs).filter((d) => net.hosts[d.id]?.ip);
  const out: { src: string; dst: string; dstDev: string; ping: SsPing; ok: boolean; wrong: boolean }[] = [];
  for (const s of devs)
    for (const d of devs) {
      if (s.id === d.id) continue;
      const ping = ssPing(needs, net, s.id, net.hosts[d.id].ip!);
      const wrong = ping.ok && ping.there.arrived !== d.id;
      out.push({ src: s.id, dst: net.hosts[d.id].ip!, dstDev: d.id, ping, ok: ping.ok && !wrong, wrong });
    }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Do the devices match the design?
// ---------------------------------------------------------------------------------------------------------------
export interface SsMatch {
  id: string;
  r1: string[];
  /** Problems per device on this network. */
  devices: { id: string; problems: string[] }[];
  /** All device problems, flattened (with the device name). */
  host: string[];
  ok: boolean;
}
export function ssMatch(parent: SsBrief["parent"], needs: SsNeed[], rows: SsRow[], net: SsNet): SsMatch[] {
  const all = ssDevices(needs);
  return needs.map((n) => {
    const c = ssCheck(parent, needs, rows, n.id);
    const i = net.r1[n.id] ?? {};
    const devs = all.filter((d) => d.wire === n.id);
    if (!c) return { id: n.id, r1: ["no subnet in the plan"], devices: devs.map((d) => ({ id: d.id, problems: ["no subnet in the plan"] })), host: ["no subnet in the plan"], ok: false };
    const usableIp = (ip: string) => ssInside(ip, c.real, c.prefix) && ip !== c.real && ip !== c.broadcast;
    const r1: string[] = [];
    if (!i.ip) r1.push(`R1 ${ssShortIf(n.iface)} has no address`);
    else {
      if (!usableIp(i.ip)) r1.push(`${i.ip} is not a usable address of ${c.real}/${c.prefix}`);
      if (i.prefix !== c.prefix) r1.push(`mask /${i.prefix} but the plan says /${c.prefix}`);
    }
    const devices = devs.map((d) => {
      const h = net.hosts[d.id] ?? {};
      const p: string[] = [];
      if (!h.ip) p.push(`${d.name} has no address`);
      else {
        if (!usableIp(h.ip)) p.push(`${h.ip} is not a usable address of ${c.real}/${c.prefix}`);
        if (h.prefix !== c.prefix) p.push(`mask /${h.prefix} but the plan says /${c.prefix}`);
        if (i.ip && h.ip === i.ip) p.push(`${h.ip} is also R1's address`);
        const dup = all.find((o) => o.id !== d.id && net.hosts[o.id]?.ip === h.ip);
        if (dup) p.push(`${h.ip} is also ${dup.name}'s address (duplicate)`);
        if (!h.gw) p.push("no default gateway");
        else if (h.gw !== i.ip) p.push(`gateway ${h.gw} is not R1's ${n.id} address${i.ip ? ` (${i.ip})` : ""}`);
      }
      return { id: d.id, problems: p };
    });
    const host = devices.flatMap((d) => d.problems.map((p) => (devs.length > 1 ? `${ssDevName(needs, d.id)}: ${p}` : p)));
    return { id: n.id, r1, devices, host, ok: !r1.length && !host.length };
  });
}

// ---------------------------------------------------------------------------------------------------------------
// State, tickets, actions
// ---------------------------------------------------------------------------------------------------------------
export type SsTicketId = "misaligned" | "mask" | "gateway" | "fragmented" | "too-small" | "duplicate" | "r1-mask";
export type SsCause = "boundary" | "overlap" | "too-small" | "outside" | "host-mask" | "gateway" | "host-outside" | "duplicate" | "r1-if" | "fragmented";
export const SS_CAUSES: { id: SsCause; label: string }[] = [
  { id: "boundary", label: "A network starts on an invalid boundary" },
  { id: "overlap", label: "Two subnets overlap" },
  { id: "too-small", label: "A block is too small for its hosts" },
  { id: "outside", label: "A block is outside the parent network" },
  { id: "host-mask", label: "A host's mask doesn't match the plan" },
  { id: "gateway", label: "A host's gateway is wrong" },
  { id: "host-outside", label: "A host's address is outside its subnet" },
  { id: "duplicate", label: "Two devices use the same address" },
  { id: "r1-if", label: "R1's interface is misconfigured" },
  { id: "fragmented", label: "Free space is fragmented" },
];
export interface SsTicket {
  id: SsTicketId;
  brief: string;
  title: string;
  report: string;
  src: string;
  dst: string;
  cause: SsCause;
}
export const SS_TICKETS: SsTicket[] = [
  { id: "too-small", brief: "lab", title: "LAB-2 is cut off", report: "The engineering lab grew to 50 devices. LAB-2 (device #40) was numbered after the others and now reaches nothing — not even LAB-1 on the same switch.", src: "LAB-2", dst: "LAB-1", cause: "too-small" },
  { id: "duplicate", brief: "lab", title: "The wrong server answers", report: "SRV-2 was rebuilt from SRV-1's disk image. Since then, pings from PC-S1 to SRV-1 get replies — but SRV-1 never sees them.", src: "PC-S1", dst: "SRV-1", cause: "duplicate" },
  { id: "r1-mask", brief: "lab", title: "Half of Staff is unreachable", report: "PC-S2 (moved to a desk in the upper half of the Staff range) can't reach the servers. PC-S1 can. Nothing changed on the hosts.", src: "PC-S2", dst: "SRV-1", cause: "r1-if" },
  { id: "misaligned", brief: "branch", title: "The spreadsheet plan", report: "A colleague's spreadsheet plan was deployed last night. HOST-B (LAN-B) can't reach the server HOST-C (LAN-C). The spreadsheet looks tidy.", src: "LAN-B", dst: "LAN-C", cause: "boundary" },
  { id: "mask", brief: "branch", title: "One host can't leave", report: "HOST-C was re-installed this morning. It can reach R1, but not HOST-A on LAN-A. Everyone else is fine.", src: "LAN-C", dst: "LAN-A", cause: "host-mask" },
  { id: "gateway", brief: "branch", title: "Nothing remote from HOST-B", report: "HOST-B was given its settings by hand. It can't reach any other network.", src: "LAN-B", dst: "LAN-A", cause: "gateway" },
  { id: "fragmented", brief: "growth", title: "No room for Guest?", report: "A Guest LAN for 26 devices (router included) must be added. There are 56 free addresses, yet nobody can find a place for it.", src: "GUEST", dst: "OFFICE", cause: "fragmented" },
];
export const ssTicket = (id: SsTicketId) => SS_TICKETS.find((t) => t.id === id)!;

export interface SsLog {
  seq: number;
  text: string;
  tone: "info" | "ok" | "warn";
}
export interface SsState {
  seq: number;
  brief: string;
  needs: SsNeed[];
  rows: SsRow[];
  net: SsNet;
  applied: boolean;
  /** Bumped whenever the plan or a device changes (proofs must come after it). */
  changeSeq: number;
  lastPing?: SsPing;
  test?: { seq: number; results: ReturnType<typeof ssTestAll> };
  ticket?: SsTicketId;
  log: readonly SsLog[];
  last?: SsLog;
}
export type SsAction =
  | { type: "brief"; id: string }
  | { type: "size"; id: string; prefix: number }
  | { type: "place"; id: string; network: string }
  | { type: "clear"; id: string }
  | { type: "clear-all" }
  | { type: "hosts"; id: string; hosts: number }
  | { type: "grow" }
  | { type: "apply" }
  | { type: "host-cfg"; id: string; cfg: SsHostCfg }
  | { type: "r1-if"; id: string; ip?: string; prefix?: number; by?: string }
  | { type: "r1-set"; r1: Record<string, SsIf>; by?: string }
  | { type: "ping"; src: SsDev; dst: string }
  | { type: "test-all" }
  | { type: "ticket"; id: SsTicketId };

const emptyNet = (needs: SsNeed[]): SsNet => ({ r1: Object.fromEntries(needs.map((n) => [n.id, {}])), hosts: Object.fromEntries(ssDevices(needs).map((d) => [d.id, {}])) });
export function createSsState(brief = "branch"): SsState {
  const b = ssBrief(brief);
  return { seq: 0, brief: b.id, needs: b.needs.map((n) => ({ ...n })), rows: b.needs.map((n) => ({ id: n.id })), net: emptyNet(b.needs), applied: false, changeSeq: 0, log: Object.freeze([]) };
}
export const ssParent = (s: SsState) => ssBrief(s.brief).parent;
export const ssStateReport = (s: SsState) => ssReport(ssParent(s), s.needs, s.rows);
function commit(s: SsState, patch: Partial<SsState>, text: string, tone: SsLog["tone"] = "info", changed = false): SsState {
  const seq = s.seq + 1;
  const rec: SsLog = Object.freeze({ seq, text, tone });
  return { ...s, ...patch, seq, changeSeq: changed ? seq : (patch.changeSeq ?? s.changeSeq), log: Object.freeze([...s.log, rec]), last: rec };
}
const rowsWith = (s: SsState, id: string, p: Partial<SsRow>) => s.rows.map((r) => (r.id === id ? { ...r, ...p } : r));

/** Valid largest-first plan from the current needs (used to set up tickets — never shown as "the answer"). */
function packLargestFirst(parent: SsBrief["parent"], needs: SsNeed[]): SsRow[] {
  const rows: SsRow[] = needs.map((n) => ({ id: n.id }));
  const pr = rangeOf(parent.network, parent.prefix);
  for (const n of [...needs].sort((a, b) => b.hosts - a.hosts || a.iface - b.iface)) {
    const p = ssMinPrefix(n.hosts);
    for (let x = pr.first; x + blockSize(p) - 1 <= pr.last; x += blockSize(p)) {
      const cand = rangeOf(numToIp(x), p);
      if (!rows.some((r) => placed(r) && overlaps(cand, realRange(r)))) {
        Object.assign(rows.find((r) => r.id === n.id)!, { prefix: p, network: numToIp(x) });
        break;
      }
    }
  }
  return rows;
}
export const ssPackLargestFirst = packLargestFirst;

function ticketState(id: SsTicketId): SsState {
  const t = ssTicket(id);
  const b = ssBrief(t.brief);
  let s = createSsState(b.id);
  const at = (o: number) => numToIp(ipToNum(b.parent.network) + o);
  let rows: SsRow[];
  if (id === "misaligned") rows = [{ id: "LAN-A", prefix: 25, network: at(0) }, { id: "LAN-B", prefix: 26, network: at(160) }, { id: "LAN-C", prefix: 27, network: at(128) }, { id: "TRANSIT", prefix: 30, network: at(224) }];
  else if (id === "fragmented") rows = [{ id: "OFFICE", prefix: 25, network: at(0) }, { id: "LAB", prefix: 27, network: at(128) }, { id: "VOICE", prefix: 27, network: at(192) }, { id: "WAN-1", prefix: 30, network: at(164) }, { id: "WAN-2", prefix: 30, network: at(232) }];
  else if (id === "too-small") rows = [{ id: "STAFF", prefix: 25, network: at(0) }, { id: "LAB", prefix: 27, network: at(128) }, { id: "SERVERS", prefix: 27, network: at(192) }, { id: "MGMT", prefix: 29, network: at(224) }, { id: "WAN", prefix: 30, network: at(232) }];
  else rows = packLargestFirst(b.parent, b.needs);
  const { net } = ssPlanConfig(s.needs, rows);
  if (id === "mask") net.hosts["LAN-C"] = { ...net.hosts["LAN-C"], prefix: 24 };
  if (id === "gateway") net.hosts["LAN-B"] = { ...net.hosts["LAN-B"], gw: net.r1["LAN-A"].ip };
  // Device #40 of the lab, numbered on from the others: its address lies past the end of the too-small /27.
  if (id === "too-small") net.hosts["LAB-2"] = { ...net.hosts["LAB-2"], ip: at(128 + 41) };
  if (id === "duplicate") net.hosts["SRV-2"] = { ...net.hosts["SRV-2"], ip: net.hosts["SRV-1"].ip };
  if (id === "r1-mask") {
    net.hosts["PC-S2"] = { ...net.hosts["PC-S2"], ip: at(100) };
    net.r1.STAFF = { ...net.r1.STAFF, prefix: 26 };
  }
  let needs = s.needs;
  if (id === "fragmented" && b.growth) {
    needs = [...needs, { ...b.growth }];
    rows = [...rows, { id: b.growth.id }];
    net.r1[b.growth.id] = {};
    for (const d of ssWireDevices(needs, b.growth.id)) net.hosts[d.id] = {};
  }
  s = { ...s, needs, rows, net, applied: true, ticket: id };
  return commit(s, {}, `Ticket: ${t.title}. ${t.report}`, "warn", true);
}

function apply(s: SsState, a: SsAction): SsState {
  const parent = ssParent(s);
  switch (a.type) {
    case "brief": {
      const b = ssBrief(a.id);
      return commit(createSsState(b.id), {}, `Brief: ${b.title} — ${b.parent.network}/${b.parent.prefix}; ${b.needs.map((n) => `${n.id} ${n.hosts}`).join(", ")} (counts include the router).`, "info", true);
    }
    case "size": {
      const n = s.needs.find((x) => x.id === a.id);
      if (!n || !ssPrefixOk(a.prefix)) return commit(s, {}, `/${a.prefix} is outside /${SS_PREFIX_MIN}–/${SS_PREFIX_MAX}.`, "warn");
      const u = usableHosts(a.prefix);
      return commit(s, { rows: rowsWith(s, a.id, { prefix: a.prefix }) }, `${a.id} sized /${a.prefix}: ${blockSize(a.prefix)} addresses, ${u} usable for ${n.hosts} → ${u < n.hosts ? "too small" : a.prefix < ssMinPrefix(n.hosts) ? "fits, bigger than needed" : "smallest fit"}.`, u < n.hosts ? "warn" : "ok", true);
    }
    case "place": {
      const ip = ssParseIp(a.network);
      const row = s.rows.find((r) => r.id === a.id);
      if (!row) return commit(s, {}, `${a.id} is not in this plan.`, "warn");
      if (row.prefix === undefined) return commit(s, {}, `Choose a size for ${a.id} first.`, "warn");
      if (!ip) return commit(s, {}, `"${a.network}" is not an IPv4 address.`, "warn");
      const rows = rowsWith(s, a.id, { network: ip });
      const c = ssCheck(parent, s.needs, rows, a.id)!;
      return commit(s, { rows }, `${a.id} written as ${ip}/${row.prefix}: ${c.valid ? "valid" : c.violations.map((v) => v.code.toLowerCase().replace("_", " ") + (v.with ? ` with ${v.with}` : "")).join(" + ")}.`, c.valid ? "ok" : "warn", true);
    }
    case "clear":
      return commit(s, { rows: rowsWith(s, a.id, { network: undefined }) }, `${a.id} removed from the board.`, "info", true);
    case "clear-all":
      return commit(s, { rows: s.needs.map((n) => ({ id: n.id })) }, "Plan cleared.", "info", true);
    case "hosts": {
      if (!Number.isInteger(a.hosts) || a.hosts < 1 || a.hosts > SS_HOSTS_MAX) return commit(s, {}, `Hosts must be 1–${SS_HOSTS_MAX}.`, "warn");
      return commit(s, { needs: s.needs.map((n) => (n.id === a.id ? { ...n, hosts: a.hosts } : n)) }, `${a.id} now needs ${a.hosts} (smallest fit /${ssMinPrefix(a.hosts)}).`, "info", true);
    }
    case "grow": {
      const g = ssBrief(s.brief).growth;
      if (!g || s.needs.some((n) => n.id === g.id)) return commit(s, {}, "No new requirement to add.", "warn");
      const needs = [...s.needs, { ...g }];
      return commit(s, { needs, rows: [...s.rows, { id: g.id }], net: { r1: { ...s.net.r1, [g.id]: {} }, hosts: { ...s.net.hosts, ...Object.fromEntries(ssWireDevices(needs, g.id).map((d) => [d.id, {}])) } } }, `New requirement: ${g.id}, ${g.hosts} addresses (router included).`, "info", true);
    }
    case "apply": {
      const { net, refused } = ssPlanConfig(s.needs, s.rows);
      const text = `Plan applied to the devices, from each written start: R1 = start + ${SS_R1_OFFSET}, devices = start + ${SS_HOST_OFFSET}, + ${SS_HOST_OFFSET + 1} … (+2 on links and tiny blocks), mask = the row's prefix, gateway = R1.${refused.length ? ` R1 refused: ${refused.map((r) => `${r.id} (${r.ios})`).join("; ")}.` : ""}`;
      return commit(s, { net, applied: true, test: undefined, lastPing: undefined }, text, refused.length ? "warn" : "ok", true);
    }
    case "host-cfg": {
      if (!ssDevice(s.needs, a.id)) return commit(s, {}, "No such device.", "warn");
      const name = ssDevName(s.needs, a.id);
      return commit(s, { net: { ...s.net, hosts: { ...s.net.hosts, [a.id]: { ...a.cfg } } } }, `${name} settings: ${a.cfg.ip ?? "no address"}${a.cfg.prefix !== undefined ? `/${a.cfg.prefix}` : ""}, gateway ${a.cfg.gw ?? "none"}.`, "info", true);
    }
    case "r1-if": {
      const n = s.needs.find((x) => x.id === a.id);
      if (!n) return commit(s, {}, "No such interface.", "warn");
      if (!a.ip) return commit(s, { net: { ...s.net, r1: { ...s.net.r1, [a.id]: {} } } }, `R1 ${ssShortIf(n.iface)} address removed${a.by ? ` (${a.by})` : ""}.`, "info", true);
      const ok = ssR1Accept(s.needs, s.net.r1, a.id, a.ip, a.prefix ?? 0);
      if (!ok.ok) return commit(s, {}, `R1 refused ${a.ip}/${a.prefix} on ${ssShortIf(n.iface)}: ${ok.ios}`, "warn");
      return commit(s, { net: { ...s.net, r1: { ...s.net.r1, [a.id]: { ip: a.ip, prefix: a.prefix } } } }, `R1 ${ssShortIf(n.iface)} is now ${a.ip}/${a.prefix}${a.by ? ` (${a.by})` : ""}.`, "info", true);
    }
    case "r1-set": {
      let r1: Record<string, SsIf> = Object.fromEntries(s.needs.map((n) => [n.id, {}]));
      for (const n of [...s.needs].sort((x, y) => x.iface - y.iface)) {
        const c = a.r1[n.id];
        if (!c?.ip || c.prefix === undefined) continue;
        const ok = ssR1Accept(s.needs, r1, n.id, c.ip, c.prefix);
        if (!ok.ok) return commit(s, {}, `R1 refused the commit: ${ok.junos}`, "warn");
        r1 = { ...r1, [n.id]: { ip: c.ip, prefix: c.prefix } };
      }
      return commit(s, { net: { ...s.net, r1 } }, `R1 configuration committed${a.by ? ` (${a.by})` : ""}.`, "info", true);
    }
    case "ping": {
      const p = ssPing(s.needs, s.net, a.src, a.dst);
      return commit(s, { lastPing: p }, `Ping ${ssDevName(s.needs, a.src)} → ${a.dst}: ${p.ok ? `reply from ${ssDevName(s.needs, p.there.arrived ?? "")}` : "FAILED — " + ([...p.there.hops, ...(p.back?.hops ?? [])].filter((h) => h.tone === "bad")[0]?.text ?? "no reply")}`, p.ok ? "ok" : "warn");
    }
    case "test-all": {
      const results = ssTestAll(s.needs, s.net);
      const bad = results.filter((r) => !r.ok).length;
      return commit(s, { test: { seq: s.seq + 1, results } }, `Test all: ${results.length - bad}/${results.length} pings answered by the right device.`, bad ? "warn" : "ok");
    }
    case "ticket":
      return ticketState(a.id);
  }
}
export const ssApply = (s: SsState, a: SsAction) => apply(s, a);
export const ssRun = (s: SsState, ...as: SsAction[]) => as.reduce(apply, s);

// ---------------------------------------------------------------------------------------------------------------
// Troubleshooting: evidence-based feedback and proofs
// ---------------------------------------------------------------------------------------------------------------
/** Feedback on a hypothesis, from the network as it is now. Only the ticket's root cause is confirmed. */
export function ssCauseFeedback(s: SsState, cause: SsCause): { right: boolean; consequence?: boolean; text: string } {
  const t = s.ticket ? ssTicket(s.ticket) : undefined;
  const parent = ssParent(s);
  const r = ssStateReport(s);
  const right = !!t && t.cause === cause;
  const R = (text: string) => ({ right: true, text: `Right. ${text}` });
  const W = (text: string, consequence = false) => ({ right: false, consequence, text });
  const devs = ssDevices(s.needs);
  const mis = r.checks.filter((c) => !c.aligned);
  const rowOf = (wire: string) => r.checks.find((c) => c.id === wire);
  const hostMasks = devs.map((d) => ({ d, h: s.net.hosts[d.id], c: rowOf(d.wire) })).filter((x) => x.h?.ip && x.c && x.h.prefix !== x.c.prefix);
  const badGw = devs.map((d) => ({ d, h: s.net.hosts[d.id], i: s.net.r1[d.wire] })).filter((x) => x.h?.ip && x.h.prefix !== undefined && (!x.h.gw || x.h.gw !== x.i?.ip || ssNetOf(x.h.gw, x.h.prefix) !== ssNetOf(x.h.ip, x.h.prefix)));
  const outside = devs.map((d) => ({ d, h: s.net.hosts[d.id], c: rowOf(d.wire) })).filter((x) => x.h?.ip && x.c && !ssInside(x.h.ip, x.c.real, x.c.prefix));
  const dups = devs.filter((d) => s.net.hosts[d.id]?.ip && devs.some((o) => o.id !== d.id && s.net.hosts[o.id]?.ip === s.net.hosts[d.id].ip));
  const r1bad = s.needs.filter((n) => s.net.r1[n.id]?.ip && rowOf(n.id) && (s.net.r1[n.id].prefix !== rowOf(n.id)!.prefix || !ssInside(s.net.r1[n.id].ip!, rowOf(n.id)!.real, rowOf(n.id)!.prefix)));
  const unplaced = r.unplaced;
  switch (cause) {
    case "boundary":
      if (right) return R(mis.map((c) => `${c.id} is written ${c.written}/${c.prefix}, but /${c.prefix} blocks start every ${c.block} — ${c.written} is ${c.rem} past the boundary. Every device computes the real block ${c.real}/${c.prefix} (${ssRangeText(parent, c.realRange)}). Invalid boundary is the root cause; everything else follows from it.`).join(" ") || "A network was written off its boundary.");
      return W(mis.length ? `${mis.map((c) => c.id).join(", ")} is off its boundary — but that's not what this ticket is about.` : `Every written start is a multiple of its block size (${r.checks.map((c) => `${c.id} rem ${c.rem}`).join(", ")}). No boundary problem.`);
    case "overlap":
      if (right) return R("Two subnets overlap.");
      if (r.overlaps.length) return W(`The overlap is real — ${r.overlaps.map((o) => `${o.a} and ${o.b} share ${ssRangeText(parent, o.shared)}`).join("; ")} — but it's a consequence. Ask WHY their real blocks overlap: look at where each block really starts.`, true);
      return W(`No two real blocks share an address${r.adjacent.length ? ` (${r.adjacent.map((x) => `${x.a}|${x.b}`).join(", ")} only touch — adjacent is fine)` : ""}.`);
    case "too-small": {
      const small = r.checks.filter((c) => c.usable < c.hosts);
      if (right) return R(small.map((c) => `${c.id} needs ${c.hosts} addresses but /${c.prefix} holds 2^${32 - c.prefix} − 2 = ${c.usable}. There is no room for the rest inside ${ssRangeText(parent, c.realRange)}, so device addresses spill past the block (${outside.map((x) => `${x.d.name} ${x.h.ip}`).join(", ") || "the later devices"}). The block must be /${c.minPrefix}.`).join(" ") || "A block is too small.");
      return W(small.length ? `${small.map((c) => c.id).join(", ")} is too small — but that isn't this symptom.` : `Every block holds its requirement: ${r.checks.map((c) => `${c.id} ${c.usable} ≥ ${c.hosts}`).join(", ")}.`);
    }
    case "outside":
      if (right) return R("A block is outside the parent.");
      return W(r.inside ? `Every real block is inside ${parent.network}/${parent.prefix}.` : "A block is outside the parent, but that's not this symptom.");
    case "host-mask":
      if (right) return R(hostMasks.map((x) => `${x.d.name} uses /${x.h.prefix}, the plan says /${x.c!.prefix}. With /${x.h.prefix} it computes its network as ${ssNetOf(x.h.ip!, x.h.prefix!)}/${x.h.prefix} — far wider than its real subnet — so it decides remote hosts are LOCAL and ARPs for them on its own wire. Nobody answers.`).join(" ") || "A host mask is wrong.");
      return W(hostMasks.length ? `${hostMasks.map((x) => x.d.name).join(", ")} has a mask that differs from the plan, but that's not this ticket.` : `Every device's mask matches its row in the plan (${devs.filter((d) => s.net.hosts[d.id]?.ip).map((d) => `${d.name} /${s.net.hosts[d.id].prefix}`).join(", ")}). If the plan itself is wrong, matching it doesn't help.`);
    case "gateway":
      if (right) return R(badGw.map((x) => `${x.d.name}'s gateway is ${x.h.gw ?? "missing"}; its own network is ${ssNetOf(x.h.ip!, x.h.prefix!)}/${x.h.prefix}${x.h.gw ? ` and ${x.h.gw} AND /${x.h.prefix} = ${ssNetOf(x.h.gw, x.h.prefix!)}: not on its subnet` : ""}. R1's address on that LAN is ${x.i?.ip ?? "unset"}.`).join(" ") || "A gateway is wrong.");
      if (badGw.length && (s.ticket === "misaligned" || s.ticket === "too-small")) return W(`${badGw.map((x) => x.d.name).join(", ")} has no working gateway — but look at why: ${s.ticket === "misaligned" ? "R1 refused the LAN-C interface, so HOST-C's gateway address belongs to nobody." : `its gateway ${badGw[0].h.gw} is right for the plan; it's the HOST's address that landed outside the block, so the gateway looks foreign to it.`} That's a consequence.`, true);
      return W(badGw.length ? `${badGw.map((x) => x.d.name).join(", ")} has no working gateway — but that's not this ticket.` : `Every device's gateway is R1's address on its own subnet (${devs.filter((d) => s.net.hosts[d.id]?.gw).map((d) => `${d.name} → ${s.net.hosts[d.id].gw}`).join(", ")}).`);
    case "host-outside":
      if (right) return R("A host's address is outside its subnet.");
      if (outside.length && s.ticket === "too-small") return W(`True: ${outside.map((x) => `${x.d.name} ${x.h.ip} is outside ${x.c!.id}'s block ${ssRangeText(parent, x.c!.realRange)}`).join("; ")}. But why was it numbered there? Count how many devices the LAN needs and how many addresses its block holds.`, true);
      return W(outside.length ? `${outside.map((x) => x.d.name).join(", ")} sits outside its block — but that's not this ticket.` : `Every device's address is inside its network's block (${devs.filter((d) => s.net.hosts[d.id]?.ip).map((d) => `${d.name} ${s.net.hosts[d.id].ip}`).join(", ")}).`);
    case "duplicate":
      if (right) return R(dups.length ? `${dups.map((d) => d.name).join(" and ")} both use ${s.net.hosts[dups[0].id].ip}. When PC-S1 traffic reaches the SERVERS wire, R1 ARPs for that address and BOTH answer; the last reply wins, so the packets go to ${dups[dups.length - 1].name}. One address, one device.` : "Two devices share an address.");
      return W(dups.length ? `${dups.map((d) => d.name).join(" and ")} share an address — but that isn't this ticket.` : "Every device address is unique.");
    case "r1-if":
      if (right) return R(r1bad.map((n) => `R1 ${ssShortIf(n.iface)} (${n.id}) is ${s.net.r1[n.id].ip}/${s.net.r1[n.id].prefix}: its connected route is ${ssNetOf(s.net.r1[n.id].ip!, s.net.r1[n.id].prefix!)}/${s.net.r1[n.id].prefix}, but the plan's block is ${rowOf(n.id)!.real}/${rowOf(n.id)!.prefix}. Hosts outside R1's narrower route can reach R1, but R1 has no route back to them.`).join(" ") || "R1's interface is misconfigured.");
      {
        const missing = s.needs.filter((n) => ssWireDevices(s.needs, n.id).some((d) => s.net.hosts[d.id]?.ip) && !s.net.r1[n.id]?.ip);
        if (missing.length && s.ticket === "misaligned") return W(`R1 did refuse ${missing.map((n) => ssShortIf(n.iface)).join(", ")} ("overlaps with" another interface) — R1 was right to. The refusal is a consequence of two subnets overlapping. Why do they?`, true);
        return W(missing.length || r1bad.length ? `${[...missing, ...r1bad].map((n) => ssShortIf(n.iface)).join(", ")} doesn't match the plan — but that isn't this ticket.` : `Every R1 interface holds a usable address of its block with the plan's mask (${s.needs.filter((n) => s.net.r1[n.id]?.ip).map((n) => `${ssShortIf(n.iface)} ${s.net.r1[n.id].ip}/${s.net.r1[n.id].prefix}`).join(", ")}).`);
      }
    case "fragmented": {
      if (right) {
        const g = s.needs.find((n) => unplaced.includes(n.id));
        const f = g ? ssCanFit(r.space, g.hosts) : undefined;
        return R(f ? `${g!.id} needs ${g!.hosts} → a /${f.prefix} (${f.size} addresses). ${f.free} addresses are free, but in pieces: ${r.space.ranges.map((x) => ssRangeText(parent, x)).join(", ")}. Every /${f.prefix} boundary in the free space is blocked by a small link sitting in the middle of it. Enough addresses ≠ a free aligned block.` : "Free space is fragmented.");
      }
      return W(`Free space isn't involved: ${r.space.free} addresses are free (${r.space.ranges.map((x) => ssRangeText(parent, x)).join(", ") || "none"}) and nothing new is waiting for a place.`);
    }
  }
}

export interface SsProof {
  label: string;
  ok: boolean;
  detail: string;
}
export function ssProofs(s: SsState): SsProof[] {
  const t = s.ticket ? ssTicket(s.ticket) : undefined;
  const parent = ssParent(s);
  const r = ssStateReport(s);
  const m = ssMatch(parent, s.needs, s.rows, s.net);
  const bad = m.filter((x) => !x.ok);
  const dstIp = t ? s.net.hosts[t.dst]?.ip : undefined;
  const sym = t && dstIp ? ssPing(s.needs, s.net, t.src, dstIp) : undefined;
  const symOk = !!sym?.ok && sym.there.arrived === t?.dst;
  const fresh = !!s.test && s.test.seq > s.changeSeq;
  const allOk = fresh && s.test!.results.every((x) => x.ok);
  return [
    { label: "The plan passes every rule", ok: r.allValid, detail: r.allValid ? "placed, big enough, aligned, inside the parent, no overlap" : [!r.allPlaced && `${r.unplaced.join(", ")} not placed`, !r.capacity && "too small", !r.aligned && "misaligned", !r.inside && "outside", !r.noOverlap && "overlap"].filter(Boolean).join(", ") },
    { label: "The devices match the plan", ok: !bad.length, detail: bad.length ? bad.map((x) => `${x.id}: ${[...x.r1, ...x.host][0]}`).join("; ") : "every interface, host address, mask and gateway agrees with the design" },
    { label: t ? `${ssDevName(s.needs, t.src)} reaches ${ssDevName(s.needs, t.dst)}` : "The reported path works", ok: symOk, detail: sym ? (symOk ? "request and reply both delivered, by the right device" : sym.ok ? `answered by ${ssDevName(s.needs, sym.there.arrived ?? "")} — the wrong device` : "still failing") : "the destination has no address yet" },
    { label: "Test all passes after your last change", ok: allOk, detail: !s.test ? "run Test all" : !fresh ? "something changed since the last Test all — run it again" : allOk ? `${s.test.results.length}/${s.test.results.length} answered by the right device` : `${s.test.results.filter((x) => !x.ok).length} still failing` },
  ];
}

/** The build mission on a brief (no ticket): where the learner stands, never the values to type. */
export function ssBuildSteps(s: SsState): { k: string; label: string; ok: boolean; detail: string }[] {
  const parent = ssParent(s);
  const r = ssStateReport(s);
  const m = ssMatch(parent, s.needs, s.rows, s.net);
  const r1ok = m.filter((x) => !x.r1.length).length;
  const devOk = m.flatMap((x) => x.devices).filter((d) => !d.problems.length).length;
  const devAll = m.flatMap((x) => x.devices).length;
  const fresh = !!s.test && s.test.seq > s.changeSeq;
  const allOk = fresh && s.test!.results.every((x) => x.ok);
  return [
    { k: "plan", label: "Design a valid plan for every network", ok: r.allValid, detail: r.allValid ? `${r.checks.length}/${s.needs.length} blocks, every rule passes` : `${r.checks.filter((c) => c.valid).length}/${s.needs.length} valid` },
    { k: "r1", label: "Give each R1 interface an address in its block", ok: r1ok === s.needs.length, detail: `${r1ok}/${s.needs.length} interfaces match the plan` },
    { k: "hosts", label: "Configure every device: address, mask, gateway", ok: devOk === devAll, detail: `${devOk}/${devAll} devices match the plan` },
    { k: "test", label: "Test every path (after your last change)", ok: allOk, detail: !s.test ? "not tested yet" : !fresh ? "changed since the last test" : `${s.test.results.filter((x) => x.ok).length}/${s.test.results.length} answered by the right device` },
  ];
}
