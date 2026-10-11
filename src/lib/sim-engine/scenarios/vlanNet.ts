/**
 * VLAN Lab network — two IEEE 802.1Q switches and a router-on-a-stick, simulated frame by frame.
 *
 *   HOST-A ─ ge-0/0/1 (VLAN 10) ┐                              ┌ ge-0/0/1 (VLAN 10) ─ HOST-B
 *                               SW1 ══ ge-0/0/24 trunk ══ SW2
 *   HOST-C ─ ge-0/0/2 (VLAN 20) ┘                              └ ge-0/0/2 (VLAN 20) ─ HOST-D
 *            ge-0/0/3 (spare)                            ge-0/0/3 (spare)
 *                                                        ge-0/0/23 trunk ══ R1 ge-0/0/0 (.10 → VLAN 10, .20 → VLAN 20)
 *
 * The same hosts, MACs, VLANs and trunk as the guided lesson (vlanFundamentals.ts). The lab adds R1, a router with one
 * subinterface per VLAN, so a frame can be followed out of one VLAN and back into another.
 *
 * What is modeled (IEEE 802.1Q bridging; router-on-a-stick):
 * - Ingress classification. Access port: an untagged frame belongs to the port's access VLAN. A tagged frame arriving
 *   on an access port is dropped (platforms differ here; this lab drops it). Trunk port: a tagged frame belongs to the
 *   VLAN in its tag; an UNTAGGED frame belongs to the trunk's NATIVE VLAN. A VLAN not in the trunk's allowed list, or
 *   not defined on the switch, is dropped at ingress.
 * - Learning and lookup are per (VLAN, MAC): one table, separate for each VLAN.
 * - Flooding stays inside the frame's VLAN: access ports of that VLAN, trunks that carry it — never the ingress port.
 * - Egress: access ports send untagged. A trunk tags every VLAN with its VID except the native VLAN, which it sends
 *   untagged. So two ends of a trunk must agree on the native VLAN: an untagged frame is put into whatever the
 *   RECEIVING end calls native (a native-VLAN mismatch silently moves frames between VLANs).
 * - Hosts are ordinary IPv4 hosts (no VLAN knowledge): they ARP for an on-subnet destination or their gateway, and
 *   answer ARP requests for their address and pings to it. A host never sends or keeps tagged frames.
 * - R1: one physical port, one subinterface per VLAN (802.1Q VID, address). A tagged frame is handed to the
 *   subinterface with that VID — none, and R1 drops it. R1 answers ARP for the address of the subinterface the request
 *   arrived on, and routes between its connected subnets (TTL − 1, new source MAC, the egress subinterface's tag).
 * - Cisco switches detect a native-VLAN mismatch through CDP and log it; Junos has no such check (CDP is Cisco's).
 * - Time: frames move in "waves" (one link crossing each). The lab clock moves 1 s per action; MAC entries age after
 *   300 s. ARP entries do not age in the lab (they would after minutes on real hosts).
 */

export type VlSw = "SW1" | "SW2";
export type VlHost = "HOST-A" | "HOST-B" | "HOST-C" | "HOST-D";
export type VlDev = VlSw | VlHost | "R1";
export const VL_SWITCHES: VlSw[] = ["SW1", "SW2"];
export const VL_HOSTS: VlHost[] = ["HOST-A", "HOST-C", "HOST-B", "HOST-D"];
export const VL_PORTS = ["ge-0/0/1", "ge-0/0/2", "ge-0/0/3", "ge-0/0/23", "ge-0/0/24"] as const;
export type VlPort = (typeof VL_PORTS)[number];
export const TRUNK = "ge-0/0/24";
export const RTR_PORT = "ge-0/0/23";
export const BCAST = "FF:FF:FF:FF:FF:FF";
/** Documentation MAC range (RFC 7042: 00-00-5E-00-53-xx), the same MACs as the guided lesson. */
export const VL_MAC: Record<VlHost | "R1", string> = { "HOST-A": "00:00:5E:00:53:0A", "HOST-B": "00:00:5E:00:53:0B", "HOST-C": "00:00:5E:00:53:0C", "HOST-D": "00:00:5E:00:53:0D", R1: "00:00:5E:00:53:01" };
export const VL_AGING = 300;
export const VL_NAMES: Record<number, string> = { 1: "default", 10: "SALES", 20: "ENG", 30: "GUEST" };
export const vlanName = (v: number, cfg?: VlCfg, sw?: VlSw) => (cfg && sw ? cfg.sw[sw].names[v] : undefined) ?? VL_NAMES[v] ?? `VLAN${String(v).padStart(4, "0")}`;
export const isSw = (d: string): d is VlSw => d === "SW1" || d === "SW2";
export const isHost = (d: string): d is VlHost => d.startsWith("HOST-");
const other = (sw: VlSw): VlSw => (sw === "SW1" ? "SW2" : "SW1");

// ---------------------------------------------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------------------------------------------
export interface VlPortCfg {
  mode: "access" | "trunk";
  /** Access VLAN (used when mode = access). */
  access: number;
  /** VLANs a trunk carries (used when mode = trunk). */
  allowed: number[];
  /** The VLAN a trunk sends untagged and puts untagged frames into. */
  native: number;
  shut: boolean;
}
export interface VlSwCfg {
  /** VLANs defined on the switch (the VLAN database). */
  vlans: number[];
  /** VLAN names (Cisco `name`, Junos the VLAN's own name). */
  names: Record<number, string>;
  ports: Record<VlPort, VlPortCfg>;
}
export interface VlSub {
  /** Unit / subinterface number (ge-0/0/0.10). */
  unit: number;
  vid: number;
  ip: string;
  prefix: number;
  shut: boolean;
}
export interface VlHostCfg {
  mac: string;
  ip: string;
  prefix: number;
  gw: string;
  at?: { sw: VlSw; port: VlPort };
}
export interface VlCfg {
  sw: Record<VlSw, VlSwCfg>;
  r1: { shut: boolean; subs: VlSub[] };
  hosts: Record<VlHost, VlHostCfg>;
}
const acc = (v: number): VlPortCfg => ({ mode: "access", access: v, allowed: [], native: 1, shut: false });
const trunk = (allowed: number[]): VlPortCfg => ({ mode: "trunk", access: 1, allowed, native: 1, shut: false });
export function vlHealthy(): VlCfg {
  return {
    sw: {
      SW1: { vlans: [1, 10, 20], names: { 1: "default", 10: "SALES", 20: "ENG" }, ports: { "ge-0/0/1": acc(10), "ge-0/0/2": acc(20), "ge-0/0/3": acc(1), "ge-0/0/23": acc(1), "ge-0/0/24": trunk([1, 10, 20]) } },
      SW2: { vlans: [1, 10, 20], names: { 1: "default", 10: "SALES", 20: "ENG" }, ports: { "ge-0/0/1": acc(10), "ge-0/0/2": acc(20), "ge-0/0/3": acc(1), "ge-0/0/23": trunk([1, 10, 20]), "ge-0/0/24": trunk([1, 10, 20]) } },
    },
    r1: {
      shut: false,
      subs: [
        { unit: 10, vid: 10, ip: "192.168.10.1", prefix: 24, shut: false },
        { unit: 20, vid: 20, ip: "192.168.20.1", prefix: 24, shut: false },
      ],
    },
    hosts: {
      "HOST-A": { mac: VL_MAC["HOST-A"], ip: "192.168.10.11", prefix: 24, gw: "192.168.10.1", at: { sw: "SW1", port: "ge-0/0/1" } },
      "HOST-C": { mac: VL_MAC["HOST-C"], ip: "192.168.20.13", prefix: 24, gw: "192.168.20.1", at: { sw: "SW1", port: "ge-0/0/2" } },
      "HOST-B": { mac: VL_MAC["HOST-B"], ip: "192.168.10.12", prefix: 24, gw: "192.168.10.1", at: { sw: "SW2", port: "ge-0/0/1" } },
      "HOST-D": { mac: VL_MAC["HOST-D"], ip: "192.168.20.14", prefix: 24, gw: "192.168.20.1", at: { sw: "SW2", port: "ge-0/0/2" } },
    },
  };
}
export const vlClone = <T>(c: T): T => JSON.parse(JSON.stringify(c)) as T;

// ---------------------------------------------------------------------------------------------------------------
// Addresses
// ---------------------------------------------------------------------------------------------------------------
export const ipNum = (ip: string) => ip.split(".").reduce((a, o) => a * 256 + Number(o), 0);
export const netOf = (ip: string, prefix: number) => {
  const n = prefix === 0 ? 0 : Math.floor(ipNum(ip) / 2 ** (32 - prefix)) * 2 ** (32 - prefix);
  return [24, 16, 8, 0].map((s) => Math.floor(n / 2 ** s) % 256).join(".");
};
export const sameNet = (a: string, b: string, prefix: number) => netOf(a, prefix) === netOf(b, prefix);
export const isIp = (s: string) => /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(s) && s.split(".").every((o) => Number(o) <= 255);

// ---------------------------------------------------------------------------------------------------------------
// The physical layer and VLAN membership
// ---------------------------------------------------------------------------------------------------------------
/** What is plugged into a port. */
export function vlPeer(cfg: VlCfg, sw: VlSw, port: string): { dev: VlDev; port: string } | undefined {
  if (port === TRUNK) return { dev: other(sw), port: TRUNK };
  if (port === RTR_PORT) return sw === "SW2" ? { dev: "R1", port: "ge-0/0/0" } : undefined;
  const h = VL_HOSTS.find((x) => cfg.hosts[x].at?.sw === sw && cfg.hosts[x].at?.port === port);
  return h ? { dev: h, port: "eth0" } : undefined;
}
export const vlHostAt = (cfg: VlCfg, sw: VlSw, port: string) => VL_HOSTS.find((x) => cfg.hosts[x].at?.sw === sw && cfg.hosts[x].at?.port === port);
/** A port forwards only if it is enabled, something is plugged in, and the far end is enabled too. */
export function vlPortUp(cfg: VlCfg, sw: VlSw, port: string): boolean {
  const pc = cfg.sw[sw].ports[port as VlPort];
  if (!pc || pc.shut) return false;
  const p = vlPeer(cfg, sw, port);
  if (!p) return false;
  if (isSw(p.dev)) return !cfg.sw[p.dev].ports[TRUNK].shut;
  if (p.dev === "R1") return !cfg.r1.shut;
  return true;
}
export const vlPortStatus = (cfg: VlCfg, sw: VlSw, port: string): "connected" | "notconnect" | "disabled" => (cfg.sw[sw].ports[port as VlPort].shut ? "disabled" : vlPortUp(cfg, sw, port) ? "connected" : "notconnect");
export const vlHostLinkUp = (cfg: VlCfg, h: VlHost) => {
  const at = cfg.hosts[h].at;
  return !!at && vlPortUp(cfg, at.sw, at.port);
};
/** Is the port a member of this VLAN (would it carry a frame of this VLAN)? */
export function vlMember(cfg: VlCfg, sw: VlSw, port: string, vlan: number): boolean {
  const c = cfg.sw[sw];
  const pc = c.ports[port as VlPort];
  if (!pc || !c.vlans.includes(vlan)) return false;
  return pc.mode === "access" ? pc.access === vlan : pc.allowed.includes(vlan);
}
/** The VLANs a port actually carries right now (defined, allowed / its access VLAN). */
export function vlPortVlans(cfg: VlCfg, sw: VlSw, port: string): number[] {
  const c = cfg.sw[sw];
  const pc = c.ports[port as VlPort];
  return pc.mode === "access" ? (c.vlans.includes(pc.access) ? [pc.access] : []) : pc.allowed.filter((v) => c.vlans.includes(v));
}
/** An access port whose VLAN isn't defined on the switch is inactive (Cisco wording). */
export const vlInactive = (cfg: VlCfg, sw: VlSw, port: string) => cfg.sw[sw].ports[port as VlPort].mode === "access" && !cfg.sw[sw].vlans.includes(cfg.sw[sw].ports[port as VlPort].access);
/** What a port leads to, from this switch's point of view. */
export function vlPortRole(cfg: VlCfg, sw: VlSw, port: string): string {
  const p = vlPeer(cfg, sw, port);
  if (!p) return "nothing plugged in";
  if (p.dev === "R1") return "R1 (router)";
  return isSw(p.dev) ? `${p.dev} (switch)` : p.dev;
}
export const vlNativeMismatch = (cfg: VlCfg) => {
  const a = cfg.sw.SW1.ports[TRUNK];
  const b = cfg.sw.SW2.ports[TRUNK];
  return a.mode === "trunk" && b.mode === "trunk" && vlPortUp(cfg, "SW1", TRUNK) && a.native !== b.native;
};
/** Which host a MAC belongs to. */
export function vlMacName(cfg: VlCfg | undefined, mac: string): string {
  if (mac === BCAST) return "broadcast";
  if (mac === VL_MAC.R1) return "R1";
  const c = cfg ?? vlHealthy();
  return VL_HOSTS.find((h) => c.hosts[h].mac === mac) ?? mac;
}
export function vlIpOwner(cfg: VlCfg, ip: string): VlDev | undefined {
  if (cfg.r1.subs.some((s) => s.ip === ip)) return "R1";
  return VL_HOSTS.find((h) => cfg.hosts[h].ip === ip);
}
export const vlShortMac = (m: string) => (m === BCAST ? "FF:FF:FF:FF:FF:FF" : `…${m.slice(-5)}`);

// ---------------------------------------------------------------------------------------------------------------
// Frames, tables, counters, captures, runs
// ---------------------------------------------------------------------------------------------------------------
export type VlFrameKind = "arp-req" | "arp-rep" | "echo" | "echo-rep";
export interface VlFrame {
  id: number;
  src: string;
  dst: string;
  kind: VlFrameKind;
  /** IPv4 source / destination (ARP: sender / target protocol address). */
  sip: string;
  dip: string;
  ttl: number;
  bytes: number;
  /** The device that built this frame. */
  from: VlDev;
  /** The ping this frame belongs to (index into the run's results). */
  ping?: number;
}
export interface VlEntry {
  vlan: number;
  mac: string;
  port: VlPort;
  seen: number;
}
export interface VlCtr {
  inF: number;
  outF: number;
  inB: number;
  outB: number;
  tagIn: number;
  tagOut: number;
  drops: number;
}
const ZERO: VlCtr = { inF: 0, outF: 0, inB: 0, outB: 0, tagIn: 0, tagOut: 0, drops: 0 };
/** One frame crossing one link. `vid` is the 802.1Q tag on the wire (undefined = untagged). */
export interface VlHop {
  from: VlDev;
  fromPort: string;
  to: VlDev;
  toPort: string;
  frame: VlFrame;
  vid?: number;
  /** The VLAN the sending switch forwarded it in (switch egress only). */
  vlan?: number;
}
export type VlLearn = "learned" | "refreshed" | "moved";
export type VlKind = "broadcast" | "unknown" | "known" | "filter" | "drop";
export interface VlDecision {
  sw: VlSw;
  port: VlPort;
  frame: VlFrame;
  /** The tag the frame arrived with (undefined = untagged). */
  tagIn?: number;
  /** How the VLAN was chosen. */
  how?: "access" | "tag" | "native";
  vlan?: number;
  /** Dropped at ingress (why), before any learning. */
  drop?: string;
  learn?: VlLearn;
  movedFrom?: string;
  kind: VlKind;
  hit?: string;
  out: { port: VlPort; vid?: number }[];
  /** Up trunks that did NOT get a copy because they don't carry this VLAN. */
  pruned: VlPort[];
}
/** A host or R1 receiving a frame. */
export interface VlRx {
  dev: VlHost | "R1";
  frame: VlFrame;
  vid?: number;
  /** R1: the subinterface that took it. */
  unit?: number;
  accepted: boolean;
  why: string;
}
export interface VlSnap {
  fdb: Record<VlSw, VlEntry[]>;
  counters: Record<string, VlCtr>;
  arp: Record<string, Record<string, string>>;
}
export interface VlWave {
  k: number;
  hops: VlHop[];
  decisions: VlDecision[];
  rx: VlRx[];
  /** Lines a host or R1 said this wave (built a frame, routed, gave up). */
  notes: { dev: VlDev; text: string; tone: "info" | "ok" | "bad" | "learn" }[];
  snap: VlSnap;
}
export interface VlSend {
  from: VlHost | "R1";
  /** A destination IPv4 address. */
  to: string;
  /** "ping": a full ping (ARP first if needed). "arp": just broadcast an ARP request for `to`. */
  kind: "ping" | "arp";
}
export interface VlResult {
  send: VlSend;
  /** The echo request reached the device that owns the destination IP. */
  arrived: boolean;
  /** The echo reply came back to the sender. */
  replied: boolean;
  /** ARP request answered (for kind "arp"). */
  answered?: boolean;
  /** Why it failed, from the sender's point of view. */
  fail?: string;
  /** Where the echo request went: the devices it crossed, in order. */
  path: VlDev[];
}
export interface VlRun {
  id: number;
  cmd: string;
  clock: number;
  waves: VlWave[];
  capFrom: number;
  results: VlResult[];
  cfgSeq: number;
  before: Record<string, VlCtr>;
}
export interface VlCap {
  n: number;
  run: number;
  wave: number;
  /** "SW1 ge-0/0/24", "R1 ge-0/0/0" or a host name. */
  point: string;
  dir: "in" | "out";
  frame: VlFrame;
  vid?: number;
}
export interface VlSyslog {
  clock: number;
  sw: VlSw;
  ev: "up" | "down" | "admin-down" | "move" | "native";
  port?: string;
  mac?: string;
  vlan?: number;
  from?: string;
  to?: string;
  native?: number;
  peerNative?: number;
}
export interface VlLogLine {
  seq: number;
  text: string;
  tone: "info" | "ok" | "warn";
}
export type VlTicketId = "allowed" | "access" | "native" | "rtr-trunk" | "subif";
export interface VlState {
  cfg: VlCfg;
  fdb: Record<VlSw, VlEntry[]>;
  /** IPv4 → MAC, per device (hosts; R1 keyed "R1"). */
  arp: Record<string, Record<string, string>>;
  counters: Record<string, VlCtr>;
  clock: number;
  captures: VlCap[];
  capN: number;
  syslog: VlSyslog[];
  runs: VlRun[];
  last?: VlRun;
  seq: number;
  frameSeq: number;
  cfgSeq: number;
  log: VlLogLine[];
  ticket?: VlTicketId;
  /** Junos commit history per device, newest first: the device's configuration before each commit (rollback 1, 2…). */
  rb?: Partial<Record<VlSw | "R1", string[]>>;
}

export const ctrKey = (dev: VlDev, port?: string) => (isSw(dev) ? `${dev} ${port}` : dev);
function emptyCounters(): Record<string, VlCtr> {
  const c: Record<string, VlCtr> = {};
  for (const sw of VL_SWITCHES) for (const p of VL_PORTS) c[`${sw} ${p}`] = { ...ZERO };
  for (const h of VL_HOSTS) c[h] = { ...ZERO };
  c.R1 = { ...ZERO };
  return c;
}
const emptyArp = (): Record<string, Record<string, string>> => ({ "HOST-A": {}, "HOST-B": {}, "HOST-C": {}, "HOST-D": {}, R1: {} });
export function createVlanNet(cfg: VlCfg = vlHealthy()): VlState {
  return { cfg, fdb: { SW1: [], SW2: [] }, arp: emptyArp(), counters: emptyCounters(), clock: 0, captures: [], capN: 0, syslog: [], runs: [], seq: 0, frameSeq: 0, cfgSeq: 0, log: [{ seq: 0, text: "Lab ready: VLAN 10 (SALES) = HOST-A, HOST-B · VLAN 20 (ENG) = HOST-C, HOST-D · SW1↔SW2 trunk ge-0/0/24 carries 1 (native, untagged), 10, 20 · R1 on SW2 ge-0/0/23 routes between them · MAC and ARP tables empty", tone: "info" }] };
}
export function vlTable(fdb: Record<VlSw, VlEntry[]>, sw: VlSw, vlan?: number): VlEntry[] {
  return fdb[sw].filter((e) => vlan === undefined || e.vlan === vlan).sort((a, b) => a.vlan - b.vlan || a.mac.localeCompare(b.mac));
}
export const vlLookup = (fdb: Record<VlSw, VlEntry[]>, sw: VlSw, vlan: number, mac: string) => fdb[sw].find((e) => e.vlan === vlan && e.mac === mac);

export function vlFrameName(f: VlFrame): string {
  if (f.kind === "arp-req") return `ARP request (who has ${f.dip}?)`;
  if (f.kind === "arp-rep") return `ARP reply (${f.sip} is at ${vlShortMac(f.src)})`;
  if (f.kind === "echo-rep") return `ping reply ${f.sip} → ${f.dip}`;
  return `ping ${f.sip} → ${f.dip}`;
}

// ---------------------------------------------------------------------------------------------------------------
// The simulation
// ---------------------------------------------------------------------------------------------------------------
interface Pending {
  dev: VlHost | "R1";
  /** The next-hop IP being resolved. */
  nh: string;
  frame: VlFrame;
  unit?: number;
}
interface Work {
  s: VlState;
  fdb: Record<VlSw, VlEntry[]>;
  arp: Record<string, Record<string, string>>;
  counters: Record<string, VlCtr>;
  captures: VlCap[];
  capN: number;
  syslog: VlSyslog[];
  runId: number;
  ids: { id: number };
  pending: Pending[];
}
const cloneFdb = (f: Record<VlSw, VlEntry[]>) => ({ SW1: f.SW1.map((e) => ({ ...e })), SW2: f.SW2.map((e) => ({ ...e })) });
const cloneCtr = (c: Record<string, VlCtr>) => Object.fromEntries(Object.entries(c).map(([k, v]) => [k, { ...v }]));
const cloneArp = (a: Record<string, Record<string, string>>) => Object.fromEntries(Object.entries(a).map(([k, v]) => [k, { ...v }]));
const MAX_WAVES = 60;

function capPoint(dev: VlDev, port: string) {
  return isSw(dev) ? `${dev} ${port}` : dev === "R1" ? "R1 ge-0/0/0" : dev;
}
function count(w: Work, h: VlHop, wave: number) {
  const b = h.frame.dst === BCAST;
  const tx = w.counters[ctrKey(h.from, h.fromPort)];
  const rx = w.counters[ctrKey(h.to, h.toPort)];
  tx.outF++;
  if (b) tx.outB++;
  if (h.vid !== undefined) tx.tagOut++;
  rx.inF++;
  if (b) rx.inB++;
  if (h.vid !== undefined) rx.tagIn++;
  w.captures.push({ n: ++w.capN, run: w.runId, wave, point: capPoint(h.from, h.fromPort), dir: "out", frame: h.frame, vid: h.vid });
  w.captures.push({ n: ++w.capN, run: w.runId, wave, point: capPoint(h.to, h.toPort), dir: "in", frame: h.frame, vid: h.vid });
}

/** One switch, one frame arriving on one port. */
function bridge(w: Work, sw: VlSw, h: VlHop): { d: VlDecision; next: VlHop[] } {
  const cfg = w.s.cfg;
  const port = h.toPort as VlPort;
  const pc = cfg.sw[sw].ports[port];
  const f = h.frame;
  const base: VlDecision = { sw, port, frame: f, tagIn: h.vid, kind: "drop", out: [], pruned: [] };
  let vlan: number;
  let how: VlDecision["how"];
  if (pc.mode === "access") {
    if (h.vid !== undefined) return { d: { ...base, drop: `tagged (VID ${h.vid}) frame arrived on access port ${port}` }, next: [] };
    vlan = pc.access;
    how = "access";
  } else if (h.vid === undefined) {
    vlan = pc.native;
    how = "native";
  } else {
    vlan = h.vid;
    how = "tag";
  }
  if (!cfg.sw[sw].vlans.includes(vlan)) return { d: { ...base, vlan, how, drop: `VLAN ${vlan} is not defined on ${sw}` }, next: [] };
  if (pc.mode === "trunk" && !pc.allowed.includes(vlan)) return { d: { ...base, vlan, how, drop: `VLAN ${vlan} is not in ${port}'s allowed list (${pc.allowed.join(",") || "none"})` }, next: [] };
  // Learn (VLAN, source MAC) → port.
  let learn: VlLearn = "learned";
  let movedFrom: string | undefined;
  const prior = w.fdb[sw].find((e) => e.vlan === vlan && e.mac === f.src);
  if (prior && prior.port === port) {
    learn = "refreshed";
    prior.seen = w.s.clock;
  } else {
    if (prior) {
      learn = "moved";
      movedFrom = prior.port;
      w.syslog.push({ clock: w.s.clock, sw, ev: "move", mac: f.src, vlan, from: prior.port, to: port });
    }
    w.fdb[sw] = [...w.fdb[sw].filter((e) => !(e.vlan === vlan && e.mac === f.src)), { vlan, mac: f.src, port, seen: w.s.clock }];
  }
  const eligible = VL_PORTS.filter((p) => p !== port && vlPortUp(cfg, sw, p) && vlMember(cfg, sw, p, vlan));
  const pruned = VL_PORTS.filter((p) => p !== port && vlPortUp(cfg, sw, p) && cfg.sw[sw].ports[p].mode === "trunk" && !vlMember(cfg, sw, p, vlan));
  let kind: VlKind;
  let outs: VlPort[] = [];
  let hit: string | undefined;
  if (f.dst === BCAST) {
    kind = "broadcast";
    outs = eligible;
  } else {
    const e = vlLookup(w.fdb, sw, vlan, f.dst);
    if (!e) {
      kind = "unknown";
      outs = eligible;
    } else {
      hit = e.port;
      if (e.port === port) kind = "filter";
      else if (!eligible.includes(e.port)) kind = "drop";
      else {
        kind = "known";
        outs = [e.port];
      }
    }
  }
  const out = outs.map((p) => {
    const q = cfg.sw[sw].ports[p];
    return { port: p, vid: q.mode === "trunk" && vlan !== q.native ? vlan : undefined };
  });
  const next: VlHop[] = out.map((o) => {
    const peer = vlPeer(cfg, sw, o.port)!;
    return { from: sw, fromPort: o.port, to: peer.dev, toPort: peer.port, frame: f, vid: o.vid, vlan };
  });
  return { d: { ...base, vlan, how, learn, movedFrom, kind, hit, out, pruned: kind === "known" || kind === "filter" ? [] : pruned }, next };
}

/** A frame leaving a host or R1 onto its link (nothing happens if the link is down). */
function emit(w: Work, dev: VlHost | "R1", frame: VlFrame, vid?: number): VlHop | undefined {
  const cfg = w.s.cfg;
  if (dev === "R1") {
    if (cfg.r1.shut || !vlPortUp(cfg, "SW2", RTR_PORT)) return undefined;
    return { from: "R1", fromPort: "ge-0/0/0", to: "SW2", toPort: RTR_PORT, frame, vid };
  }
  const at = cfg.hosts[dev].at;
  if (!at || !vlPortUp(cfg, at.sw, at.port)) return undefined;
  return { from: dev, fromPort: "eth0", to: at.sw, toPort: at.port, frame };
}
const mk = (w: Work, f: Omit<VlFrame, "id">): VlFrame => ({ ...f, id: ++w.ids.id });

/** A device wants to send an IP packet to `nh` (the next hop): use its ARP cache, or ARP first and park the packet. */
function sendIp(w: Work, dev: VlHost | "R1", packet: Omit<VlFrame, "id" | "dst" | "src">, nh: string, src: string, unit: number | undefined, out: VlHop[], notes: VlWave["notes"]) {
  const mac = w.arp[dev][nh];
  const vid = dev === "R1" ? w.s.cfg.r1.subs.find((x) => x.unit === unit)?.vid : undefined;
  if (mac) {
    const hop = emit(w, dev, mk(w, { ...packet, src, dst: mac }), vid);
    if (hop) out.push(hop);
    else notes.push({ dev, text: `${dev} can't send: its link is down`, tone: "bad" });
    return;
  }
  const already = w.pending.some((p) => p.dev === dev && p.nh === nh);
  w.pending.push({ dev, nh, unit, frame: { ...packet, id: 0, src, dst: "" } });
  if (already) return;
  const myIp = dev === "R1" ? w.s.cfg.r1.subs.find((x) => x.unit === unit)!.ip : w.s.cfg.hosts[dev].ip;
  const req = mk(w, { src, dst: BCAST, kind: "arp-req", sip: myIp, dip: nh, ttl: 0, bytes: 64, from: dev, ping: packet.ping });
  notes.push({ dev, text: `${dev} doesn't know ${nh}'s MAC: it broadcasts an ARP request first${dev === "R1" ? ` (on .${unit}, tagged VID ${vid})` : ""}`, tone: "info" });
  const hop = emit(w, dev, req, vid);
  if (hop) out.push(hop);
  else notes.push({ dev, text: `${dev} can't send: its link is down`, tone: "bad" });
}

function simulate(s0: VlState, sends: VlSend[], cmd: string): VlState {
  const s: VlState = { ...s0, seq: s0.seq + 1 };
  const runId = s.seq;
  const cfg = s.cfg;
  const w: Work = { s, fdb: cloneFdb(s.fdb), arp: cloneArp(s.arp), counters: cloneCtr(s.counters), captures: [...s.captures], capN: s.capN, syslog: [...s.syslog], runId, ids: { id: s.frameSeq }, pending: [] };
  const results: VlResult[] = sends.map((x) => ({ send: x, arrived: false, replied: false, path: [x.from] }));
  const waves: VlWave[] = [];
  const queue = sends.map((x, i) => ({ x, i }));
  let hops: VlHop[] = [];
  let notes: VlWave["notes"] = [];
  let idle = 0;
  const start = (x: VlSend, i: number) => {
    const r = results[i];
    if (x.from === "R1") {
      if (cfg.r1.subs.some((u) => u.ip === x.to && !u.shut)) {
        r.arrived = r.replied = true;
        notes.push({ dev: "R1", text: `${x.to} is one of R1's own addresses: answered locally`, tone: "ok" });
        return;
      }
      const out = routeOut(cfg, x.to);
      if (!out) {
        r.fail = `R1 has no route to ${x.to}`;
        notes.push({ dev: "R1", text: r.fail, tone: "bad" });
        return;
      }
      if (cfg.r1.shut || !vlPortUp(cfg, "SW2", RTR_PORT)) {
        r.fail = "R1's port is down — nothing was sent";
        notes.push({ dev: "R1", text: r.fail, tone: "bad" });
        return;
      }
      notes.push({ dev: "R1", text: `R1: ${x.to} is in the connected subnet of .${out.unit} (${netOf(out.ip, out.prefix)}/${out.prefix}) — it sends out .${out.unit}, tagged VID ${out.vid}`, tone: "info" });
      sendIp(w, "R1", { kind: "echo", sip: out.ip, dip: x.to, ttl: 255, bytes: 98, from: "R1", ping: i }, x.to, VL_MAC.R1, out.unit, hops, notes);
      return;
    }
    const hc = cfg.hosts[x.from];
    if (!hc.ip) {
      r.fail = `${x.from} has no IPv4 address`;
      notes.push({ dev: x.from, text: r.fail, tone: "bad" });
      return;
    }
    if (!vlHostLinkUp(cfg, x.from)) {
      r.fail = `${x.from}'s link is down — nothing was sent`;
      notes.push({ dev: x.from, text: r.fail, tone: "bad" });
      return;
    }
    if (x.kind === "arp") {
      const req = mk(w, { src: hc.mac, dst: BCAST, kind: "arp-req", sip: hc.ip, dip: x.to, ttl: 0, bytes: 64, from: x.from, ping: i });
      notes.push({ dev: x.from, text: `${x.from} broadcasts an ARP request: who has ${x.to}?`, tone: "info" });
      const hop = emit(w, x.from, req);
      if (hop) hops.push(hop);
      return;
    }
    if (!hc.gw && !sameNet(x.to, hc.ip, hc.prefix)) {
      r.fail = `${x.to} is not on ${x.from}'s subnet and ${x.from} has no default gateway`;
      notes.push({ dev: x.from, text: r.fail, tone: "bad" });
      return;
    }
    if (x.to === hc.ip) {
      r.arrived = r.replied = true;
      notes.push({ dev: x.from, text: `${x.to} is ${x.from}'s own address: answered locally, nothing sent`, tone: "ok" });
      return;
    }
    const local = sameNet(x.to, hc.ip, hc.prefix);
    if (!local && !sameNet(hc.gw, hc.ip, hc.prefix)) {
      r.fail = `${x.to} is not on ${x.from}'s subnet and its gateway ${hc.gw} isn't either — no route`;
      notes.push({ dev: x.from, text: r.fail, tone: "bad" });
      return;
    }
    const nh = local ? x.to : hc.gw;
    notes.push({ dev: x.from, text: `${x.from}: ${x.to} AND /${hc.prefix} = ${netOf(x.to, hc.prefix)} — ${local ? "my own subnet: deliver directly" : `not my subnet (${netOf(hc.ip, hc.prefix)}): send to my gateway ${hc.gw}`}`, tone: "info" });
    sendIp(w, x.from, { kind: "echo", sip: hc.ip, dip: x.to, ttl: 64, bytes: 98, from: x.from, ping: i }, nh, hc.mac, undefined, hops, notes);
  };
  const first = queue.shift();
  if (first) start(first.x, first.i);
  for (let k = 0; k < MAX_WAVES; k++) {
    if (!hops.length) {
      if (!queue.length) {
        if (notes.length) waves.push({ k: waves.length, hops: [], decisions: [], rx: [], notes, snap: { fdb: cloneFdb(w.fdb), counters: cloneCtr(w.counters), arp: cloneArp(w.arp) } });
        break;
      }
      const nx = queue.shift()!;
      start(nx.x, nx.i);
      if (!hops.length) continue;
    }
    const wave: VlWave = { k: waves.length, hops, decisions: [], rx: [], notes, snap: { fdb: w.fdb, counters: w.counters, arp: w.arp } };
    notes = [];
    let next: VlHop[] = [];
    for (const h of hops) count(w, h, wave.k);
    for (const h of hops) {
      const track = h.frame.ping !== undefined ? results[h.frame.ping] : undefined;
      if (track && h.frame.kind === "echo" && track.path[track.path.length - 1] !== h.to) track.path.push(h.to);
      if (isSw(h.to)) {
        const b = bridge(w, h.to, h);
        wave.decisions.push(b.d);
        if (b.d.drop) w.counters[ctrKey(h.to, h.toPort)].drops++;
        next = next.concat(b.next);
        continue;
      }
      const dev = h.to as VlHost | "R1";
      const f = h.frame;
      if (dev === "R1") {
        const sub = h.vid === undefined ? undefined : cfg.r1.subs.find((x) => x.vid === h.vid && !x.shut);
        if (!sub) {
          w.counters.R1.drops++;
          wave.rx.push({ dev, frame: f, vid: h.vid, accepted: false, why: h.vid === undefined ? "untagged frame — R1 has no subinterface for untagged traffic" : `tagged VID ${h.vid} — R1 has no (enabled) subinterface with that VLAN ID: dropped` });
          continue;
        }
        const mine = f.dst === VL_MAC.R1 || f.dst === BCAST;
        if (!mine) {
          wave.rx.push({ dev, frame: f, vid: h.vid, unit: sub.unit, accepted: false, why: `destination ${vlShortMac(f.dst)} is not R1's MAC: ignored` });
          continue;
        }
        if (f.kind === "arp-req") {
          if (f.dip !== sub.ip) {
            wave.rx.push({ dev, frame: f, vid: h.vid, unit: sub.unit, accepted: true, why: `ARP for ${f.dip} — not .${sub.unit}'s address: no answer` });
            continue;
          }
          w.arp.R1[f.sip] = f.src;
          wave.rx.push({ dev, frame: f, vid: h.vid, unit: sub.unit, accepted: true, why: `ARP for ${f.dip}, the address of .${sub.unit}: R1 learns ${f.sip} → ${vlShortMac(f.src)} and answers` });
          const rep = mk(w, { src: VL_MAC.R1, dst: f.src, kind: "arp-rep", sip: sub.ip, dip: f.sip, ttl: 0, bytes: 64, from: "R1", ping: f.ping });
          const hop = emit(w, "R1", rep, sub.vid);
          if (hop) next.push(hop);
          continue;
        }
        if (f.kind === "arp-rep") {
          w.arp.R1[f.sip] = f.src;
          wave.rx.push({ dev, frame: f, vid: h.vid, unit: sub.unit, accepted: true, why: `ARP reply: R1 learns ${f.sip} → ${vlShortMac(f.src)}` });
          releasePending(w, "R1", f.sip, next, notes);
          continue;
        }
        // An IP packet for R1 or through R1.
        if (cfg.r1.subs.some((x) => x.ip === f.dip)) {
          wave.rx.push({ dev, frame: f, vid: h.vid, unit: sub.unit, accepted: true, why: `${f.kind === "echo" ? "ping" : "ping reply"} for ${f.dip}, one of R1's own addresses` });
          if (f.kind === "echo-rep") {
            const r = results[f.ping!];
            if (r && r.send.from === "R1") r.replied = true;
          }
          if (f.kind === "echo") {
            const r = results[f.ping!];
            if (r) r.arrived = true;
            const back = routeOut(cfg, f.sip);
            if (!back) {
              notes.push({ dev: "R1", text: `R1 has no route back to ${f.sip}: the reply is dropped`, tone: "bad" });
              continue;
            }
            sendIp(w, "R1", { kind: "echo-rep", sip: f.dip, dip: f.sip, ttl: 255, bytes: 98, from: "R1", ping: f.ping }, f.sip, VL_MAC.R1, back.unit, next, notes);
          }
          continue;
        }
        const out = routeOut(cfg, f.dip);
        if (!out) {
          wave.rx.push({ dev, frame: f, vid: h.vid, unit: sub.unit, accepted: true, why: `R1 has no route to ${f.dip}: dropped` });
          continue;
        }
        if (f.ttl <= 1) {
          wave.rx.push({ dev, frame: f, vid: h.vid, unit: sub.unit, accepted: true, why: "TTL expired: dropped" });
          continue;
        }
        wave.rx.push({ dev, frame: f, vid: h.vid, unit: sub.unit, accepted: true, why: `routes ${f.dip}: in on .${sub.unit} (VLAN ${sub.vid}), out .${out.unit} (VLAN ${out.vid}) — TTL ${f.ttl} → ${f.ttl - 1}, new source MAC R1` });
        sendIp(w, "R1", { kind: f.kind, sip: f.sip, dip: f.dip, ttl: f.ttl - 1, bytes: f.bytes, from: "R1", ping: f.ping }, f.dip, VL_MAC.R1, out.unit, next, notes);
        continue;
      }
      // A host
      const hc = cfg.hosts[dev];
      if (h.vid !== undefined) {
        wave.rx.push({ dev, frame: f, vid: h.vid, accepted: false, why: `a TAGGED frame (VID ${h.vid}) — ${dev} isn't configured for VLAN tags and discards it` });
        continue;
      }
      const mine = f.dst === hc.mac || f.dst === BCAST;
      if (!mine) {
        wave.rx.push({ dev, frame: f, accepted: false, why: `destination ${vlShortMac(f.dst)} is not ${dev}'s MAC: discarded` });
        continue;
      }
      if (f.kind === "arp-req") {
        if (f.dip !== hc.ip) {
          wave.rx.push({ dev, frame: f, accepted: true, why: `ARP for ${f.dip} — not ${dev}'s address: no answer` });
          continue;
        }
        w.arp[dev][f.sip] = f.src;
        wave.rx.push({ dev, frame: f, accepted: true, why: `ARP for ${f.dip}, its own address: ${dev} learns ${f.sip} → ${vlShortMac(f.src)} and answers` });
        const r = f.ping !== undefined ? results[f.ping] : undefined;
        if (r && r.send.kind === "arp") r.arrived = true;
        const rep = mk(w, { src: hc.mac, dst: f.src, kind: "arp-rep", sip: hc.ip, dip: f.sip, ttl: 0, bytes: 64, from: dev, ping: f.ping });
        const hop = emit(w, dev, rep);
        if (hop) next.push(hop);
        continue;
      }
      if (f.kind === "arp-rep") {
        if (f.dip !== hc.ip) {
          wave.rx.push({ dev, frame: f, accepted: false, why: "ARP reply for another address: ignored" });
          continue;
        }
        w.arp[dev][f.sip] = f.src;
        wave.rx.push({ dev, frame: f, accepted: true, why: `ARP reply: ${dev} learns ${f.sip} → ${vlShortMac(f.src)}` });
        const r = f.ping !== undefined ? results[f.ping] : undefined;
        if (r && r.send.kind === "arp" && r.send.from === dev) r.answered = true;
        releasePending(w, dev, f.sip, next, notes);
        continue;
      }
      if (f.dip !== hc.ip) {
        wave.rx.push({ dev, frame: f, accepted: false, why: `IP packet for ${f.dip}, not ${hc.ip}: dropped (a host doesn't route)` });
        continue;
      }
      if (f.kind === "echo") {
        const r = results[f.ping!];
        if (r) r.arrived = true;
        wave.rx.push({ dev, frame: f, accepted: true, why: `ping for ${hc.ip}, its own address (TTL ${f.ttl}): ${dev} answers` });
        const local = sameNet(f.sip, hc.ip, hc.prefix);
        const nh = local ? f.sip : hc.gw;
        if (!local && !sameNet(hc.gw, hc.ip, hc.prefix)) {
          notes.push({ dev, text: `${dev} can't answer: ${f.sip} is not on its subnet and its gateway ${hc.gw} isn't either`, tone: "bad" });
          continue;
        }
        sendIp(w, dev, { kind: "echo-rep", sip: hc.ip, dip: f.sip, ttl: 64, bytes: 98, from: dev, ping: f.ping }, nh, hc.mac, undefined, next, notes);
        continue;
      }
      const r = results[f.ping!];
      if (r && r.send.from === dev) r.replied = true;
      wave.rx.push({ dev, frame: f, accepted: true, why: `ping reply from ${f.sip} (TTL ${f.ttl}): ${f.ttl < 64 ? `${64 - f.ttl} router hop${64 - f.ttl > 1 ? "s" : ""} on the way back` : "same subnet, no router"}` });
    }
    wave.snap = { fdb: cloneFdb(w.fdb), counters: cloneCtr(w.counters), arp: cloneArp(w.arp) };
    waves.push(wave);
    hops = next;
    if (!hops.length) {
      idle++;
      if (idle > 0 && queue.length) {
        const nx = queue.shift()!;
        start(nx.x, nx.i);
      }
    } else idle = 0;
  }
  // What never happened: unanswered ARP, parked packets.
  for (const p of w.pending) {
    const r = p.frame.ping !== undefined ? results[p.frame.ping] : undefined;
    if (r && !r.fail && !r.replied) r.fail = `${p.dev} never got an answer to its ARP request for ${p.nh}${p.dev === "R1" ? " (R1 can't reach that host in its VLAN)" : ""}`;
  }
  for (const r of results) {
    if (r.send.kind === "arp") {
      if (!r.answered && !r.fail) r.fail = `nobody answered the ARP request for ${r.send.to}`;
      continue;
    }
    if (!r.replied && !r.fail) r.fail = r.arrived ? "the request arrived, but the reply never came back" : "the request never arrived";
  }
  const run: VlRun = { id: runId, cmd, clock: s.clock, waves, capFrom: s.capN + 1, results, cfgSeq: s.cfgSeq, before: s.counters };
  const captures = w.captures.length > 1500 ? w.captures.slice(-1500) : w.captures;
  const lines: VlLogLine[] = results.map((r) => ({ seq: runId, text: resultText(r), tone: r.send.kind === "arp" ? (r.answered ? "ok" : "warn") : r.replied ? "ok" : "warn" }));
  return { ...s, fdb: w.fdb, arp: w.arp, counters: w.counters, captures, capN: w.capN, syslog: w.syslog.slice(-400), runs: [...s.runs.slice(-30), run], last: run, frameSeq: w.ids.id, log: [...s.log, { seq: runId, text: cmd, tone: "info" }, ...lines] };
}
/** The connected subinterface that leads to an address (R1 only knows its connected subnets). */
function routeOut(cfg: VlCfg, ip: string): VlSub | undefined {
  return cfg.r1.subs.find((x) => !x.shut && sameNet(ip, x.ip, x.prefix));
}
function releasePending(w: Work, dev: VlHost | "R1", ip: string, out: VlHop[], notes: VlWave["notes"]) {
  const ready = w.pending.filter((p) => p.dev === dev && p.nh === ip);
  w.pending = w.pending.filter((p) => !ready.includes(p));
  const mac = w.arp[dev][ip];
  for (const p of ready) {
    const vid = dev === "R1" ? w.s.cfg.r1.subs.find((x) => x.unit === p.unit)?.vid : undefined;
    notes.push({ dev, text: `${dev} now knows ${ip} is at ${vlShortMac(mac)}: it sends the waiting ${p.frame.kind === "echo" ? "ping" : "ping reply"}`, tone: "info" });
    const hop = emit(w, dev, mk(w, { ...p.frame, dst: mac }), vid);
    if (hop) out.push(hop);
  }
}

export function resultText(r: VlResult): string {
  const x = r.send;
  if (x.kind === "arp") return `${x.from} ARP for ${x.to}: ${r.answered ? "answered" : r.fail ?? "no answer"}`;
  if (r.replied) return `${x.from} → ping ${x.to}: reply came back`;
  return `${x.from} → ping ${x.to}: FAILED — ${r.fail ?? "no reply"}`;
}

// ---------------------------------------------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------------------------------------------
export type VlAction =
  | { type: "traffic"; sends: VlSend[]; cmd?: string }
  | { type: "wait"; seconds: number }
  | { type: "clear"; sw: VlSw; vlan?: number; text?: string }
  | { type: "clear-arp"; dev: VlHost | "R1" }
  | { type: "clear-counters"; sw?: VlSw }
  | { type: "cfg"; cfg: VlCfg; text: string; junosCommit?: VlSw | "R1" }
  | { type: "move"; host: VlHost; to?: { sw: VlSw; port: VlPort }; text?: string }
  | { type: "ticket"; id: VlTicketId }
  | { type: "fresh" };

export const sendText = (cfg: VlCfg, x: VlSend) => {
  const who = vlIpOwner(cfg, x.to);
  return x.kind === "arp" ? `${x.from} broadcasts an ARP request for ${x.to}${who ? ` (${who})` : ""}` : `${x.from} pings ${x.to}${who ? ` (${who})` : ""}`;
};
export const vlSendCmd = (cfg: VlCfg, sends: VlSend[]) => sends.map((x) => sendText(cfg, x)).join(", then ");

/** A configuration / cabling change: ports that went down flush what was learned on them; entries for VLANs a port no longer carries are flushed too. */
function applyCfg(s: VlState, cfg: VlCfg, text: string): VlState {
  const fdb = cloneFdb(s.fdb);
  const syslog = [...s.syslog];
  const notes: string[] = [];
  for (const sw of VL_SWITCHES)
    for (const p of VL_PORTS) {
      const was = vlPortUp(s.cfg, sw, p);
      const now = vlPortUp(cfg, sw, p);
      if (was && !now) {
        const gone = fdb[sw].filter((e) => e.port === p);
        fdb[sw] = fdb[sw].filter((e) => e.port !== p);
        syslog.push({ clock: s.clock, sw, ev: cfg.sw[sw].ports[p].shut ? "admin-down" : "down", port: p });
        notes.push(`${sw} ${p} went down${gone.length ? ` — flushed ${gone.map((e) => `${vlMacName(cfg, e.mac)} (VLAN ${e.vlan})`).join(", ")}` : ""}`);
      } else if (!was && now) {
        syslog.push({ clock: s.clock, sw, ev: "up", port: p });
        notes.push(`${sw} ${p} came up`);
      }
      if (now) {
        const keep = vlPortVlans(cfg, sw, p);
        const gone = fdb[sw].filter((e) => e.port === p && !keep.includes(e.vlan));
        if (gone.length) {
          fdb[sw] = fdb[sw].filter((e) => !gone.includes(e));
          notes.push(`${sw} ${p} no longer carries VLAN ${[...new Set(gone.map((e) => e.vlan))].join(", ")} — flushed ${gone.map((e) => vlMacName(cfg, e.mac)).join(", ")}`);
        }
      }
    }
  const seq = s.seq + 1;
  if (vlNativeMismatch(cfg) && !vlNativeMismatch(s.cfg)) {
    for (const sw of VL_SWITCHES) syslog.push({ clock: s.clock, sw, ev: "native", port: TRUNK, native: cfg.sw[sw].ports[TRUNK].native, peerNative: cfg.sw[other(sw)].ports[TRUNK].native });
    notes.push(`SW1 and SW2 disagree on ${TRUNK}'s native VLAN (${cfg.sw.SW1.ports[TRUNK].native} vs ${cfg.sw.SW2.ports[TRUNK].native})`);
  }
  return { ...s, cfg, fdb, syslog, seq, cfgSeq: s.cfgSeq + 1, log: [...s.log, { seq, text, tone: "info" }, ...notes.map((t) => ({ seq, text: t, tone: "warn" as const }))] };
}
function tick(s: VlState, seconds: number): VlState {
  const clock = s.clock + seconds;
  const fdb = cloneFdb(s.fdb);
  const notes: string[] = [];
  for (const sw of VL_SWITCHES) {
    const gone = fdb[sw].filter((e) => clock - e.seen >= VL_AGING);
    if (gone.length) notes.push(`${sw}: ${gone.map((e) => `${vlMacName(s.cfg, e.mac)} (VLAN ${e.vlan})`).join(", ")} aged out`);
    fdb[sw] = fdb[sw].filter((e) => clock - e.seen < VL_AGING);
  }
  return { ...s, clock, fdb, log: [...s.log, ...notes.map((t) => ({ seq: s.seq, text: t, tone: "warn" as const }))] };
}

export function vlApply(s0: VlState, a: VlAction): VlState {
  if (a.type === "fresh") return { ...createVlanNet(), seq: s0.seq + 1 };
  if (a.type === "ticket") return vlTicketState(a.id, s0.seq + 1);
  const s = tick(s0, a.type === "wait" ? a.seconds : 1);
  switch (a.type) {
    case "traffic":
      return simulate(s, a.sends, a.cmd ?? vlSendCmd(s.cfg, a.sends));
    case "wait":
      return { ...s, log: [...s.log, { seq: s.seq, text: `Waited ${a.seconds} s (lab clock ${s.clock} s)`, tone: "info" }] };
    case "clear": {
      const fdb = cloneFdb(s.fdb);
      const gone = fdb[a.sw].filter((e) => a.vlan === undefined || e.vlan === a.vlan);
      fdb[a.sw] = fdb[a.sw].filter((e) => !gone.includes(e));
      const seq = s.seq + 1;
      return { ...s, fdb, seq, cfgSeq: s.cfgSeq + 1, log: [...s.log, { seq, text: a.text ?? `${a.sw}: cleared ${gone.length} learned entr${gone.length === 1 ? "y" : "ies"}${a.vlan !== undefined ? ` in VLAN ${a.vlan}` : ""}`, tone: "warn" }] };
    }
    case "clear-arp": {
      const arp = cloneArp(s.arp);
      arp[a.dev] = {};
      const seq = s.seq + 1;
      return { ...s, arp, seq, cfgSeq: s.cfgSeq + 1, log: [...s.log, { seq, text: `${a.dev}: ARP cache cleared`, tone: "warn" }] };
    }
    case "clear-counters": {
      const counters = cloneCtr(s.counters);
      for (const k of Object.keys(counters)) if (!a.sw || k.startsWith(`${a.sw} `)) counters[k] = { ...ZERO };
      return { ...s, counters, log: [...s.log, { seq: s.seq, text: `Counters cleared${a.sw ? ` on ${a.sw}` : ""}`, tone: "info" }] };
    }
    case "cfg": {
      const next = applyCfg(s, a.cfg, a.text);
      if (!a.junosCommit) return next;
      const d = a.junosCommit;
      const prev = JSON.stringify(d === "R1" ? s.cfg.r1 : s.cfg.sw[d]);
      return { ...next, rb: { ...s.rb, [d]: [prev, ...(s.rb?.[d] ?? [])].slice(0, 49) } };
    }
    case "move": {
      const cfg = vlClone(s.cfg);
      cfg.hosts[a.host].at = a.to;
      return applyCfg(s, cfg, a.text ?? (a.to ? `${a.host} is now plugged into ${a.to.sw} ${a.to.port}` : `${a.host} unplugged`));
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Tickets — this network after a normal morning of traffic, with ONE real thing wrong
// ---------------------------------------------------------------------------------------------------------------
export type VlCause = "allowed" | "access" | "native" | "rtr-trunk" | "subif" | "trunk-down" | "host-tag" | "gateway";
export const VL_CAUSES: { id: VlCause; label: string }[] = [
  { id: "trunk-down", label: "The SW1↔SW2 trunk is down" },
  { id: "allowed", label: "The SW1↔SW2 trunk doesn't carry the VLAN (allowed list)" },
  { id: "access", label: "A host's switch port is in the wrong access VLAN" },
  { id: "native", label: "The two ends of a trunk disagree on the native VLAN" },
  { id: "rtr-trunk", label: "The trunk to R1 doesn't carry the VLAN" },
  { id: "subif", label: "R1's subinterface is tagged with the wrong VLAN ID" },
  { id: "host-tag", label: "The hosts must be configured to tag their own frames" },
  { id: "gateway", label: "The hosts have the wrong default gateway" },
];
export interface VlTicket {
  id: VlTicketId;
  title: string;
  report: string;
  repro: VlSend[];
  reproLabel: string;
  cause: VlCause;
}
export const VL_TICKETS: VlTicket[] = [
  { id: "allowed", title: "Sales can't reach Sales upstairs", report: "“Since last night's change on SW1, HOST-A (Sales, floor 1) can't reach HOST-B (Sales, floor 2). Engineering across the floors is fine.”", repro: [{ from: "HOST-A", to: "192.168.10.12", kind: "ping" }], reproLabel: "HOST-A pings HOST-B", cause: "allowed" },
  { id: "access", title: "The new Sales laptop is isolated", report: "“HOST-B's laptop was replaced this morning and plugged back into its usual port. Its IP settings are right (192.168.10.12, gateway 192.168.10.1) but it can't reach anyone — not even the gateway.”", repro: [{ from: "HOST-B", to: "192.168.10.1", kind: "ping" }], reproLabel: "HOST-B pings its gateway", cause: "access" },
  { id: "native", title: "Sales across floors works one way only", report: "“Someone ‘cleaned up’ the trunk configuration on SW1. Now HOST-A can't reach HOST-B. Engineering across the floors still works.”", repro: [{ from: "HOST-A", to: "192.168.10.12", kind: "ping" }], reproLabel: "HOST-A pings HOST-B", cause: "native" },
  { id: "rtr-trunk", title: "Engineering can't reach Sales", report: "“HOST-C and HOST-D (Engineering) can't reach anything in Sales, and can't ping their gateway 192.168.20.1. They can still talk to each other. Sales can reach its own gateway.”", repro: [{ from: "HOST-D", to: "192.168.10.12", kind: "ping" }], reproLabel: "HOST-D pings HOST-B (another VLAN)", cause: "rtr-trunk" },
  { id: "subif", title: "Engineering can't reach Sales (again)", report: "“Same symptom as last month: Engineering can't reach Sales or its gateway 192.168.20.1, Engineering hosts reach each other. This time the network team swears the switches weren't touched — only R1 was ‘tidied up’.”", repro: [{ from: "HOST-D", to: "192.168.10.12", kind: "ping" }], reproLabel: "HOST-D pings HOST-B (another VLAN)", cause: "subif" },
];
export const vlTicket = (id: VlTicketId) => VL_TICKETS.find((t) => t.id === id)!;

/** Normal traffic that teaches every switch, host and R1 what a working morning would. */
const WARMUP: VlSend[] = [
  { from: "HOST-A", to: "192.168.10.12", kind: "ping" },
  { from: "HOST-C", to: "192.168.20.14", kind: "ping" },
  { from: "HOST-A", to: "192.168.20.13", kind: "ping" },
  { from: "HOST-B", to: "192.168.20.14", kind: "ping" },
];
export function vlWarm(): VlState {
  return simulate(createVlanNet(), WARMUP, "Morning traffic");
}
const shift = (s: VlState, seq: number, ticket: VlTicketId, text: string): VlState => ({ ...s, seq, ticket, runs: [], last: undefined, captures: [], capN: 0, counters: emptyCounters(), clock: s.clock + 60, log: [{ seq, text, tone: "info" }] });

export function vlTicketState(id: VlTicketId, seq: number): VlState {
  let s = vlWarm();
  const cfg = vlClone(s.cfg);
  if (id === "allowed") cfg.sw.SW1.ports[TRUNK].allowed = [1, 20];
  else if (id === "access") cfg.sw.SW2.ports["ge-0/0/1"].access = 20;
  else if (id === "native") cfg.sw.SW1.ports[TRUNK].native = 10;
  else if (id === "rtr-trunk") cfg.sw.SW2.ports[RTR_PORT].allowed = [1, 10];
  else cfg.r1.subs = cfg.r1.subs.map((x) => (x.unit === 20 ? { ...x, vid: 30 } : x));
  s = applyCfg(s, cfg, "the change");
  // The hosts' and R1's ARP entries for the broken path would have timed out by the time a user calls.
  if (id === "access") s = { ...s, arp: { ...s.arp, "HOST-B": {}, R1: Object.fromEntries(Object.entries(s.arp.R1).filter(([ip]) => ip !== cfg.hosts["HOST-B"].ip)) } };
  if (id === "rtr-trunk" || id === "subif") s = { ...s, arp: { ...s.arp, "HOST-C": {}, "HOST-D": {}, R1: Object.fromEntries(Object.entries(s.arp.R1).filter(([ip]) => !ip.startsWith("192.168.20."))) } };
  return { ...shift(s, seq, id, `Ticket opened: ${vlTicket(id).title}`), cfgSeq: 0 };
}

export function vlLastRepro(s: VlState): VlRun | undefined {
  if (!s.ticket) return undefined;
  const t = vlTicket(s.ticket);
  return [...s.runs].reverse().find((r) => r.results.length === t.repro.length && r.results.every((x, i) => x.send.from === t.repro[i].from && x.send.to === t.repro[i].to && x.send.kind === t.repro[i].kind));
}
export interface VlProof {
  label: string;
  ok: boolean;
  detail: string;
}
export function vlProofs(s: VlState): VlProof[] {
  if (!s.ticket) return [];
  const run = vlLastRepro(s);
  const fresh = !!run && run.cfgSeq === s.cfgSeq;
  const c = s.cfg;
  const test = (label: string): VlProof => ({ label, ok: !!run && fresh && run.results.every((r) => r.replied), detail: !run ? "not run yet" : !fresh ? "the network changed since the last test — run it again" : run.results.map(resultText).join(" · ") });
  const t1 = c.sw.SW1.ports[TRUNK];
  const t2 = c.sw.SW2.ports[TRUNK];
  switch (s.ticket) {
    case "allowed":
      return [
        { label: "The SW1↔SW2 trunk carries VLAN 10 at both ends", ok: vlMember(c, "SW1", TRUNK, 10) && vlMember(c, "SW2", TRUNK, 10), detail: `SW1 allows ${t1.allowed.join(",") || "none"} · SW2 allows ${t2.allowed.join(",") || "none"}` },
        { label: "VLAN 20 is still carried", ok: vlMember(c, "SW1", TRUNK, 20) && vlMember(c, "SW2", TRUNK, 20), detail: "Engineering must keep working" },
        test("A fresh test: HOST-A pings HOST-B and the reply comes back"),
      ];
    case "access": {
      const p = c.sw.SW2.ports["ge-0/0/1"];
      return [
        { label: "HOST-B's port is in VLAN 10 (SALES)", ok: p.mode === "access" && p.access === 10, detail: `SW2 ge-0/0/1: ${p.mode === "access" ? `access VLAN ${p.access}` : "trunk"}` },
        test("A fresh test: HOST-B pings its gateway and the reply comes back"),
        { label: "SW2 learned HOST-B in VLAN 10", ok: !!vlLookup(s.fdb, "SW2", 10, c.hosts["HOST-B"].mac), detail: s.fdb.SW2.filter((e) => e.mac === c.hosts["HOST-B"].mac).map((e) => `VLAN ${e.vlan} → ${e.port}`).join(", ") || "no entry" },
      ];
    }
    case "native":
      return [
        { label: "Both ends of the trunk use the same native VLAN", ok: t1.native === t2.native, detail: `SW1 native ${t1.native} · SW2 native ${t2.native}` },
        test("A fresh test: HOST-A pings HOST-B and the reply comes back"),
      ];
    case "rtr-trunk":
    case "subif": {
      const sub = c.r1.subs.find((x) => x.unit === 20);
      return [
        { label: "VLAN 20 reaches R1's .20 subinterface", ok: vlMember(c, "SW2", RTR_PORT, 20) && sub?.vid === 20 && !sub.shut, detail: `SW2 ${RTR_PORT} allows ${c.sw.SW2.ports[RTR_PORT].allowed.join(",") || "none"} · R1 .20 tagged VID ${sub?.vid ?? "—"}` },
        { label: "VLAN 10 still reaches R1's .10 subinterface", ok: vlMember(c, "SW2", RTR_PORT, 10) && c.r1.subs.some((x) => x.unit === 10 && x.vid === 10 && !x.shut), detail: "Sales must keep its gateway" },
        test("A fresh test: HOST-D pings HOST-B and the reply comes back"),
      ];
    }
  }
}

/** Feedback on a diagnosis, from the evidence in this network. */
export function vlCauseFeedback(s: VlState, cause: VlCause): { right: boolean; consequence?: boolean; text: string } {
  const c = s.cfg;
  const t = s.ticket ? vlTicket(s.ticket) : undefined;
  const right = !!t && t.cause === cause;
  const t1 = c.sw.SW1.ports[TRUNK];
  const t2 = c.sw.SW2.ports[TRUNK];
  const r2 = c.sw.SW2.ports[RTR_PORT];
  const sub20 = c.r1.subs.find((x) => x.unit === 20);
  const hostPorts = VL_HOSTS.map((h) => `${h} → ${c.hosts[h].at ? `${c.hosts[h].at!.sw} ${c.hosts[h].at!.port} (VLAN ${c.sw[c.hosts[h].at!.sw].ports[c.hosts[h].at!.port].access})` : "unplugged"}`).join(", ");
  const text: Record<VlCause, string> = {
    "trunk-down": `The trunk is ${vlPortUp(c, "SW1", TRUNK) ? "up at both ends (connected)" : "down"}. ${vlPortUp(c, "SW1", TRUNK) ? "A physical failure would stop every VLAN on it — and some traffic still crosses it (check the trunk counters and captures)." : ""}`,
    allowed: right ? `Yes. SW1's ${TRUNK} allows only ${t1.allowed.join(",")} (show interfaces trunk / show vlans). VLAN 10 frames have no eligible egress on SW1: it floods them only to its own VLAN 10 access ports and never onto the trunk. The link is up and VLAN 20 crosses it — the trunk filters VLAN by VLAN.` : `Both ends of the SW1↔SW2 trunk allow ${t1.allowed.join(",")} (SW1) and ${t2.allowed.join(",")} (SW2): every VLAN in use is carried.`,
    access: right ? `Yes. SW2 ge-0/0/1 is an access port in VLAN ${c.sw.SW2.ports["ge-0/0/1"].access}, not 10. HOST-B sends untagged frames; SW2 puts them into VLAN 20, so its ARP for 192.168.10.1 floods only to VLAN 20 ports (HOST-D, and the trunks tagged VID 20) — R1 hears it on .20, whose address is 192.168.20.1, and doesn't answer. SW2's MAC table shows HOST-B's MAC in VLAN 20.` : `Every host's port matches its subnet: ${hostPorts}.`,
    native: right ? `Yes. SW1's ${TRUNK} uses native VLAN ${t1.native}, SW2's uses ${t2.native}. SW1 sends VLAN ${t1.native} frames UNTAGGED (native); SW2 puts untagged frames into ITS native VLAN ${t2.native}. HOST-A's frames land in the wrong VLAN on SW2 — its MAC table shows HOST-A in VLAN ${t2.native} — and are flooded in VLAN ${t2.native}, never reaching HOST-B. Frames from SW2 to SW1 are still tagged VID 10 and arrive: the break is one-way. On Cisco, CDP logs NATIVE_VLAN_MISMATCH; Junos has no such warning.` : `Both ends of the trunk agree: native VLAN ${t1.native} on SW1 and ${t2.native} on SW2.`,
    "rtr-trunk": right ? `Yes. SW2's ${RTR_PORT} (the trunk to R1) allows only ${r2.allowed.join(",")}. VLAN 20 frames, including HOST-D's ARP for its gateway 192.168.20.1, are never sent to R1: a capture on SW2 ${RTR_PORT} shows no VID 20 frames at all. Engineering hosts still reach each other (same VLAN, no router needed).` : `SW2's ${RTR_PORT} carries ${r2.allowed.join(",")} — ${r2.allowed.includes(20) ? "VLAN 20 frames do reach R1: a capture on that port shows them leaving tagged VID 20." : ""}`,
    subif: right ? `Yes. R1's .20 subinterface is tagged VID ${sub20?.vid} (show interfaces / show running-config: encapsulation dot1Q ${sub20?.vid}). SW2 sends VLAN 20 frames to R1 tagged VID 20 — a capture on SW2 ${RTR_PORT} shows them leave — but R1 has no subinterface for VID 20 and drops them, so HOST-D's ARP for 192.168.20.1 is never answered. The address is right; the tag isn't.` : `R1's subinterfaces: ${c.r1.subs.map((x) => `.${x.unit} tagged VID ${x.vid} (${x.ip})`).join(", ")} — each matches its VLAN.`,
    "host-tag": "Hosts never tag: they send ordinary untagged frames and the access port decides the VLAN. Tags exist only on trunks (between switches, and to R1). A host receiving a tagged frame would discard it.",
    gateway: `The hosts' gateways: ${VL_HOSTS.map((h) => `${h} ${c.hosts[h].gw}`).join(", ")} — each is R1's address in that host's own subnet. ${s.ticket === "rtr-trunk" || s.ticket === "subif" ? "The address is right — the question is whether the gateway can be REACHED in that VLAN." : ""}`,
  };
  const consequence = !right && cause === "gateway" && (s.ticket === "rtr-trunk" || s.ticket === "subif");
  return { right, consequence, text: text[cause] };
}
