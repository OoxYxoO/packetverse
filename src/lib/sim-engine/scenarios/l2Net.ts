import { spClone, type SpBase, type SpLine, type SpMoment, type SpRun, type SpTok } from "@/components/sp-lab/spKit";
import { BRIDGE_PRIO, L2_IP, L2_MAC, MAC_AGE_S, MGMT, MGMT_VLAN, USER_VLAN } from "./troubleshootingLayer2";

/**
 * Layer 2 Troubleshooting lab — the guided lesson's triangle as a live model.
 *
 * HOST-A — SW1 ge-0/0/1 (access VLAN 10); SW1/SW2/SW3 in a triangle of trunks (ge-0/0/49, ge-0/0/50, ge-0/0/51) carrying
 * VLAN 10 (USERS) and VLAN 20 (MGMT, the switches' irb.20 addresses), native VLAN 1; HOST-B — SW3 ge-0/0/1 (access VLAN
 * 10). Truth is the switches' configuration (port mode, access VLAN, trunk members, native VLAN, disable, RSTP on/off and
 * bridge priority, defined VLANs). Everything else is derived: link state, the RSTP tree (roles and states per port),
 * how each frame is tagged on egress and classified on ingress, where it is flooded, which MACs each switch learns,
 * whether a forwarding loop exists (and storms), and every ping result. Values match the guided lesson: SW2 is root
 * (priority 4096), SW1 ge-0/0/50 is the Alternate port, MAC entries age after 300 s.
 */

export type L2D = "HOST-A" | "SW1" | "SW2" | "SW3" | "HOST-B";
export type L2Sw = "SW1" | "SW2" | "SW3";
export type L2H = "HOST-A" | "HOST-B";
export const L2_SWS: L2Sw[] = ["SW1", "SW2", "SW3"];
export const L2_DEVS: L2D[] = ["HOST-A", "SW1", "SW2", "SW3", "HOST-B"];
export const VLAN_NAME: Record<number, string> = { 1: "default", [USER_VLAN]: "USERS", [MGMT_VLAN]: "MGMT" };
export const VLAN_ID: Record<string, number> = { default: 1, USERS: USER_VLAN, MGMT: MGMT_VLAN };
export const SW_MAC: Record<L2Sw, string> = { SW1: MGMT.SW1.mac, SW2: MGMT.SW2.mac, SW3: MGMT.SW3.mac };
export const STP_COST = 20000;
/** Physical wiring: which port of which switch faces what. */
export const WIRES: { id: string; a: L2Sw; ap: string; b: L2D; bp: string }[] = [
  { id: "L-A", a: "SW1", ap: "ge-0/0/1", b: "HOST-A", bp: "eth0" },
  { id: "L-12", a: "SW1", ap: "ge-0/0/49", b: "SW2", bp: "ge-0/0/49" },
  { id: "L-13", a: "SW1", ap: "ge-0/0/50", b: "SW3", bp: "ge-0/0/50" },
  { id: "L-23", a: "SW2", ap: "ge-0/0/51", b: "SW3", bp: "ge-0/0/51" },
  { id: "L-B", a: "SW3", ap: "ge-0/0/1", b: "HOST-B", bp: "eth0" },
];
export const SW_PORTS: Record<L2Sw, string[]> = { SW1: ["ge-0/0/1", "ge-0/0/49", "ge-0/0/50"], SW2: ["ge-0/0/49", "ge-0/0/51"], SW3: ["ge-0/0/1", "ge-0/0/50", "ge-0/0/51"] };
export const peerOf = (sw: L2Sw, port: string): { dev: L2D; port: string; link: string } | undefined => {
  for (const w of WIRES) {
    if (w.a === sw && w.ap === port) return { dev: w.b, port: w.bp, link: w.id };
    if (w.b === sw && w.bp === port) return { dev: w.a, port: w.ap, link: w.id };
  }
  return undefined;
};
export const HOST_PORT: Record<L2H, { sw: L2Sw; port: string }> = { "HOST-A": { sw: "SW1", port: "ge-0/0/1" }, "HOST-B": { sw: "SW3", port: "ge-0/0/1" } };

// ---------------------------------------------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------------------------------------------
export interface PortCfg {
  mode: "access" | "trunk";
  access?: number;
  members?: number[];
  native?: number;
  disable?: boolean;
}
export interface L2Cfg {
  ports: Record<string, PortCfg>;
  rstp: boolean;
  prio: number;
  vlans: number[];
}
const trunk = (): PortCfg => ({ mode: "trunk", members: [USER_VLAN, MGMT_VLAN], native: 1 });
export function l2Healthy(): Record<L2Sw, L2Cfg> {
  return {
    SW1: { ports: { "ge-0/0/1": { mode: "access", access: USER_VLAN }, "ge-0/0/49": trunk(), "ge-0/0/50": trunk() }, rstp: true, prio: BRIDGE_PRIO.SW1, vlans: [1, USER_VLAN, MGMT_VLAN] },
    SW2: { ports: { "ge-0/0/49": trunk(), "ge-0/0/51": trunk() }, rstp: true, prio: BRIDGE_PRIO.SW2, vlans: [1, USER_VLAN, MGMT_VLAN] },
    SW3: { ports: { "ge-0/0/1": { mode: "access", access: USER_VLAN }, "ge-0/0/50": trunk(), "ge-0/0/51": trunk() }, rstp: true, prio: BRIDGE_PRIO.SW3, vlans: [1, USER_VLAN, MGMT_VLAN] },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// RSTP
// ---------------------------------------------------------------------------------------------------------------
export type Role = "Root" | "Designated" | "Alternate" | "Edge" | "None";
export interface PortStp {
  role: Role;
  state: "Forwarding" | "Discarding";
  /** This port receives BPDUs from an RSTP neighbour. */
  bpdus: boolean;
}
export interface StpView {
  /** Per switch: the root it believes in, its cost to it, and its root port. */
  bridge: Record<L2Sw, { rstp: boolean; rootId?: string; rootSw?: L2Sw; cost: number; rootPort?: string; bid: string }>;
  ports: Record<string, PortStp>;
}
export const bidOf = (c: Record<L2Sw, L2Cfg>, sw: L2Sw) => `${c[sw].prio}.${SW_MAC[sw].toLowerCase()}`;
const bidLess = (c: Record<L2Sw, L2Cfg>, a: L2Sw, b: L2Sw) => c[a].prio < c[b].prio || (c[a].prio === c[b].prio && SW_MAC[a] < SW_MAC[b]);
export const linkUp = (c: Record<L2Sw, L2Cfg>, link: string) => {
  const w = WIRES.find((x) => x.id === link)!;
  const aOff = c[w.a].ports[w.ap]?.disable;
  const bOff = w.b.startsWith("SW") ? c[w.b as L2Sw].ports[w.bp]?.disable : false;
  return !aOff && !bOff;
};
export function stpOf(c: Record<L2Sw, L2Cfg>): StpView {
  const on = (sw: L2Sw) => c[sw].rstp;
  const swLinks = WIRES.filter((w) => w.b.startsWith("SW") && linkUp(c, w.id));
  // BPDUs only travel between two RSTP bridges (a bridge without STP consumes reserved 01:80:C2 frames).
  const stpLinks = swLinks.filter((w) => on(w.a) && on(w.b as L2Sw));
  const bridge = {} as StpView["bridge"];
  for (const sw of L2_SWS) bridge[sw] = { rstp: on(sw), cost: Infinity, bid: bidOf(c, sw) };
  // Components of RSTP bridges; each elects its own root.
  const comp: Record<string, L2Sw[]> = {};
  const seen = new Set<L2Sw>();
  for (const sw of L2_SWS.filter(on)) {
    if (seen.has(sw)) continue;
    const q = [sw];
    const members: L2Sw[] = [];
    while (q.length) {
      const x = q.shift()!;
      if (seen.has(x)) continue;
      seen.add(x);
      members.push(x);
      for (const w of stpLinks) {
        if (w.a === x) q.push(w.b as L2Sw);
        if (w.b === x) q.push(w.a);
      }
    }
    comp[sw] = members;
  }
  for (const members of Object.values(comp)) {
    const root = members.reduce((r, x) => (bidLess(c, x, r) ? x : r));
    for (const m of members) bridge[m] = { ...bridge[m], rootSw: root, rootId: bidOf(c, root), cost: m === root ? 0 : Infinity };
    // Bellman-Ford over the component.
    for (let i = 0; i < 3; i++)
      for (const w of stpLinks) {
        const a = w.a;
        const b = w.b as L2Sw;
        if (!members.includes(a)) continue;
        if (bridge[a].cost + STP_COST < bridge[b].cost) bridge[b].cost = bridge[a].cost + STP_COST;
        if (bridge[b].cost + STP_COST < bridge[a].cost) bridge[a].cost = bridge[b].cost + STP_COST;
      }
    // Root port: lowest (cost via the neighbour, neighbour BID, neighbour port).
    for (const m of members) {
      if (m === root) continue;
      let best: { port: string; cost: number; nb: L2Sw; np: string } | undefined;
      for (const w of stpLinks) {
        const [mine, nb, np] = w.a === m ? [w.ap, w.b as L2Sw, w.bp] : w.b === m ? [w.bp, w.a, w.ap] : [undefined, undefined, undefined];
        if (!mine || !nb || !np) continue;
        const cost = bridge[nb].cost + STP_COST;
        if (!best || cost < best.cost || (cost === best.cost && (bidLess(c, nb, best.nb) || (nb === best.nb && np < best.np)))) best = { port: mine, cost, nb, np };
      }
      bridge[m].rootPort = best?.port;
    }
  }
  const ports: Record<string, PortStp> = {};
  for (const sw of L2_SWS)
    for (const port of SW_PORTS[sw]) {
      const k = `${sw}:${port}`;
      const p = peerOf(sw, port)!;
      const up = linkUp(c, p.link);
      if (!up) {
        ports[k] = { role: "None", state: "Discarding", bpdus: false };
        continue;
      }
      if (!on(sw)) {
        ports[k] = { role: "None", state: "Forwarding", bpdus: false };
        continue;
      }
      if (!p.dev.startsWith("SW")) {
        ports[k] = { role: "Edge", state: "Forwarding", bpdus: false };
        continue;
      }
      const nb = p.dev as L2Sw;
      if (!on(nb)) {
        ports[k] = { role: "Designated", state: "Forwarding", bpdus: false };
        continue;
      }
      if (bridge[sw].rootPort === port) {
        ports[k] = { role: "Root", state: "Forwarding", bpdus: true };
        continue;
      }
      // Designated if my (cost, BID) is better than the neighbour's on this segment.
      const mine = bridge[sw].cost;
      const theirs = bridge[nb].cost;
      const iWin = mine < theirs || (mine === theirs && bidLess(c, sw, nb));
      ports[k] = iWin ? { role: "Designated", state: "Forwarding", bpdus: true } : { role: "Alternate", state: "Discarding", bpdus: true };
    }
  return { bridge, ports };
}

// ---------------------------------------------------------------------------------------------------------------
// Frames: egress tagging, ingress classification, flooding
// ---------------------------------------------------------------------------------------------------------------
/** How `sw` sends a frame of `vlan` out of `port`: tagged, untagged, or not at all. */
export function egress(c: L2Cfg, port: string, vlan: number): "tagged" | "untagged" | undefined {
  const p = c.ports[port];
  if (!p || p.disable || !c.vlans.includes(vlan)) return undefined;
  if (p.mode === "access") return p.access === vlan ? "untagged" : undefined;
  if (p.native === vlan) return "untagged";
  return p.members?.includes(vlan) ? "tagged" : undefined;
}
/** Which VLAN `sw` puts an arriving frame in (or why it drops it). */
export function ingress(c: L2Cfg, port: string, tag: number | undefined): { vlan?: number; drop?: string } {
  const p = c.ports[port];
  if (!p || p.disable) return { drop: "port disabled" };
  if (p.mode === "access") {
    if (tag !== undefined) return { drop: `tagged frame (VLAN ${tag}) arrived on an access port` };
    return p.access !== undefined && c.vlans.includes(p.access) ? { vlan: p.access } : { drop: `access VLAN ${p.access} not defined` };
  }
  if (tag === undefined) return p.native !== undefined ? { vlan: p.native } : { drop: "untagged frame on a trunk without a native VLAN" };
  if (!p.members?.includes(tag) && p.native !== tag) return { drop: `VLAN ${tag} not allowed on this trunk` };
  return c.vlans.includes(tag) ? { vlan: tag } : { drop: `VLAN ${tag} not defined` };
}
export interface Hop {
  from: L2D;
  to: L2D;
  fromPort: string;
  toPort: string;
  tag?: number;
  /** VLAN the receiver classified it into, or why it dropped it. */
  vlan?: number;
  drop?: string;
  /** Egress was refused at the sender (VLAN not carried / blocked) — no hop on the wire. */
  loop?: boolean;
}
export interface FloodResult {
  hops: Hop[];
  /** Where (and in which VLAN) the frame was delivered to a host or a switch's own IRB. */
  reached: { dev: L2D; vlan: number }[];
  loop: boolean;
  learned: { sw: L2Sw; vlan: number; mac: string; port: string }[];
}
/**
 * Flood a broadcast from `src` (a host port, or a switch's own IRB) in its VLAN. Follows every forwarding port that
 * carries the frame's VLAN, records each hop with its tag and how the receiver classified it, and stops at a switch it
 * has already reached in the same VLAN (if that happens, the topology has a forwarding loop).
 */
export function flood(cfg: Record<L2Sw, L2Cfg>, stp: StpView, src: { host: L2H } | { sw: L2Sw; vlan: number }, mac: string): FloodResult {
  const hops: Hop[] = [];
  const reached: FloodResult["reached"] = [];
  const learned: FloodResult["learned"] = [];
  let loop = false;
  const visited = new Set<string>();
  type Q = { sw: L2Sw; inPort?: string; vlan: number };
  const q: Q[] = [];
  if ("host" in src) {
    const hp = HOST_PORT[src.host];
    const r = ingress(cfg[hp.sw], hp.port, undefined);
    const fwd = stp.ports[`${hp.sw}:${hp.port}`].state === "Forwarding";
    hops.push({ from: src.host, to: hp.sw, fromPort: "eth0", toPort: hp.port, vlan: fwd ? r.vlan : undefined, drop: fwd ? r.drop : "port not forwarding" });
    if (fwd && r.vlan !== undefined) {
      q.push({ sw: hp.sw, inPort: hp.port, vlan: r.vlan });
      learned.push({ sw: hp.sw, vlan: r.vlan, mac, port: hp.port });
    }
  } else q.push({ sw: src.sw, vlan: src.vlan });
  let guard = 0;
  while (q.length && guard++ < 40) {
    const x = q.shift()!;
    const key = `${x.sw}:${x.vlan}`;
    if (visited.has(key)) {
      loop = true;
      continue;
    }
    visited.add(key);
    if (x.inPort !== undefined && x.vlan === MGMT_VLAN) reached.push({ dev: x.sw, vlan: x.vlan });
    for (const port of SW_PORTS[x.sw]) {
      if (port === x.inPort) continue;
      if (stp.ports[`${x.sw}:${port}`].state !== "Forwarding") continue;
      const tagging = egress(cfg[x.sw], port, x.vlan);
      if (!tagging) continue;
      const p = peerOf(x.sw, port)!;
      if (!linkUp(cfg, p.link)) continue;
      const tag = tagging === "tagged" ? x.vlan : undefined;
      if (!p.dev.startsWith("SW")) {
        // A host accepts untagged frames only (its NIC has no VLAN subinterface).
        const ok = tag === undefined;
        hops.push({ from: x.sw, to: p.dev, fromPort: port, toPort: "eth0", tag, vlan: ok ? x.vlan : undefined, drop: ok ? undefined : "host discards tagged frames" });
        if (ok) reached.push({ dev: p.dev, vlan: x.vlan });
        continue;
      }
      const nb = p.dev as L2Sw;
      const nbFwd = stp.ports[`${nb}:${p.port}`].state === "Forwarding";
      const r = nbFwd ? ingress(cfg[nb], p.port, tag) : { drop: "receiving port is Discarding (RSTP)" };
      const looped = r.vlan !== undefined && visited.has(`${nb}:${r.vlan}`);
      hops.push({ from: x.sw, to: nb, fromPort: port, toPort: p.port, tag, vlan: r.vlan, drop: r.drop, loop: looped });
      if (r.vlan !== undefined) {
        learned.push({ sw: nb, vlan: r.vlan, mac, port: p.port });
        if (looped) loop = true;
        else q.push({ sw: nb, inPort: p.port, vlan: r.vlan });
      }
    }
  }
  return { hops, reached, loop, learned };
}
/** VLANs whose broadcasts circulate forever (a forwarding loop in that VLAN). */
export function loopVlans(cfg: Record<L2Sw, L2Cfg>, stp: StpView): number[] {
  const out: number[] = [];
  for (const v of [USER_VLAN, MGMT_VLAN]) {
    const src = L2_SWS.find((sw) => cfg[sw].vlans.includes(v));
    if (src && flood(cfg, stp, { sw: src, vlan: v }, "loopcheck").loop) out.push(v);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------------------------------------------
export interface PortCtr {
  inPkts: number;
  outPkts: number;
  bcastIn: number;
  drops: number;
}
export interface FdbEntry {
  vlan: number;
  mac: string;
  port: string;
  seen: number;
}
export interface L2Test {
  id: number;
  kind: "ping";
  from: L2D;
  to: string;
  sent: number;
  recv: number;
  vlan: number;
  unreachable: boolean;
  storm: boolean;
  /** Faults present in the configuration when the test ran (for challenges). */
  faults: string[];
  t0: number;
  cfgSeq: number;
}
export interface L2Sys {
  t: number;
  dev: L2D;
  text: string;
}
export interface L2State extends SpBase {
  cfg: Record<L2Sw, L2Cfg>;
  hist: Record<L2Sw, L2Cfg[]>;
  fdb: Record<L2Sw, FdbEntry[]>;
  ctr: Record<string, PortCtr>;
  cleared: Record<string, PortCtr>;
  arp: Record<L2D, Record<string, { mac: string; state: "REACHABLE" | "STALE" | "FAILED" }>>;
  tests: L2Test[];
  sys: L2Sys[];
  /** Last change of RSTP topology (lab clock). */
  tcAt?: number;
  tcCount: number;
  stormSince?: number;
  clearedOnce: boolean;
  broke: Partial<Record<"loop", boolean>>;
  /** When each switch's MAC table was last cleared. */
  clearedMac: Partial<Record<L2Sw, number>>;
}
export type L2TicketId = "prune" | "access" | "native" | "loop" | "trunkmode";
export type L2Action =
  | { type: "cfg"; dev: L2Sw; cfg: L2Cfg; text: string }
  | { type: "set"; text: string; f: (s: L2State) => void }
  | { type: "ping"; from: L2D; to: string; count: number }
  | { type: "wait"; secs: number }
  | { type: "clear-mac"; dev: L2Sw }
  | { type: "clear-stats"; dev: L2Sw }
  | { type: "ticket"; id: L2TicketId };

const zc = (): PortCtr => ({ inPkts: 0, outPkts: 0, bcastIn: 0, drops: 0 });
export function createL2Net(seq = 0): L2State {
  const cfg = l2Healthy();
  const ctr: Record<string, PortCtr> = {};
  const cleared: Record<string, PortCtr> = {};
  let i = 0;
  for (const sw of L2_SWS)
    for (const port of SW_PORTS[sw]) {
      i++;
      ctr[`${sw}:${port}`] = { inPkts: 4_000_000 + i * 731_119, outPkts: 3_900_000 + i * 688_201, bcastIn: 12_000 + i * 977, drops: 0 };
      cleared[`${sw}:${port}`] = zc();
    }
  return {
    seq,
    cfgSeq: 0,
    clock: 0,
    runs: [],
    log: [{ seq, t: 0, text: "Healthy network: HOST-A and HOST-B share VLAN 10 across the SW1/SW2/SW3 triangle; RSTP root SW2, SW1 ge-0/0/50 Alternate.", tone: "info" }],
    cfg,
    hist: { SW1: [], SW2: [], SW3: [] },
    fdb: { SW1: [], SW2: [], SW3: [] },
    ctr,
    cleared,
    arp: { "HOST-A": {}, "HOST-B": {}, SW1: {}, SW2: {}, SW3: {} },
    tests: [],
    sys: [],
    tcCount: 4,
    clearedOnce: false,
    broke: {},
    clearedMac: {},
  };
}
export const l2Stp = (s: Pick<L2State, "cfg">) => stpOf(s.cfg);
export const liveFdb = (s: L2State, sw: L2Sw) => s.fdb[sw].filter((e) => s.clock - e.seen < MAC_AGE_S);
const learn = (s: L2State, xs: FloodResult["learned"]) => {
  for (const l of xs) {
    const t = s.fdb[l.sw];
    const old = t.find((e) => e.vlan === l.vlan && e.mac === l.mac);
    if (old && old.port !== l.port && s.clock - old.seen < MAC_AGE_S) s.sys.push({ t: s.clock, dev: l.sw, text: `l2ald[1872]: L2ALD_MAC_MOVE_NOTIFICATION: MAC ${l.mac.toLowerCase()} of vlan ${VLAN_NAME[l.vlan]} moved from ${old.port}.0 to ${l.port}.0` });
    s.fdb[l.sw] = [...t.filter((e) => !(e.vlan === l.vlan && e.mac === l.mac)), { vlan: l.vlan, mac: l.mac, port: l.port, seen: s.clock }];
  }
};
const countHops = (s: L2State, hops: Hop[], bcast: boolean) => {
  for (const h of hops) {
    if (h.from.startsWith("SW")) s.ctr[`${h.from}:${h.fromPort}`].outPkts += 1;
    if (h.to.startsWith("SW")) {
      const c = s.ctr[`${h.to}:${h.toPort}`];
      c.inPkts += 1;
      if (bcast) c.bcastIn += 1;
      if (h.drop && !h.drop.includes("Discarding")) c.drops += 1;
    }
  }
};
/** A storm multiplies traffic on every forwarding trunk of the looped VLANs. */
function stormTraffic(s: L2State, secs: number) {
  const lv = loopVlans(s.cfg, l2Stp(s));
  if (!lv.length) {
    s.stormSince = undefined;
    return;
  }
  s.stormSince ??= s.clock;
  const st = l2Stp(s);
  for (const sw of L2_SWS)
    for (const port of SW_PORTS[sw]) {
      const p = peerOf(sw, port)!;
      if (!p.dev.startsWith("SW") || st.ports[`${sw}:${port}`].state !== "Forwarding") continue;
      const n = Math.round(148_000 * secs * lv.length);
      const c = s.ctr[`${sw}:${port}`];
      c.inPkts += n;
      c.bcastIn += n;
      c.outPkts += n;
    }
  // MAC flapping: the hosts' MACs keep arriving from both directions.
  if (lv.includes(USER_VLAN))
    for (const sw of ["SW2", "SW3"] as L2Sw[]) {
      const e = s.fdb[sw].find((x) => x.mac === L2_MAC["HOST-A"] && x.vlan === USER_VLAN);
      if (e) {
        const other = SW_PORTS[sw].find((p) => p !== e.port && peerOf(sw, p)!.dev.startsWith("SW"))!;
        s.sys.push({ t: s.clock, dev: sw, text: `l2ald[1872]: L2ALD_MAC_MOVE_NOTIFICATION: MAC ${e.mac.toLowerCase()} of vlan USERS moved from ${e.port}.0 to ${other}.0` });
        e.port = other;
        e.seen = s.clock;
      }
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Topology changes → syslog
// ---------------------------------------------------------------------------------------------------------------
function topoEvents(s: L2State, before: StpView) {
  const after = l2Stp(s);
  let changed = false;
  for (const sw of L2_SWS)
    for (const port of SW_PORTS[sw]) {
      const k = `${sw}:${port}`;
      const b = before.ports[k];
      const a = after.ports[k];
      const linkWas = b.role !== "None" || b.state === "Forwarding";
      const linkIs = a.role !== "None" || a.state === "Forwarding";
      if (linkWas !== linkIs) s.sys.push({ t: s.clock, dev: sw, text: `mib2d[1650]: ${linkIs ? "SNMP_TRAP_LINK_UP" : "SNMP_TRAP_LINK_DOWN"}: ifIndex ${514 + SW_PORTS[sw].indexOf(port)}, ifAdminStatus ${s.cfg[sw].ports[port]?.disable ? "down(2)" : "up(1)"}, ifOperStatus ${linkIs ? "up(1)" : "down(2)"}, ifName ${port}` });
      if (b.role !== a.role && a.role !== "Edge") {
        changed = true;
        if (s.cfg[sw].rstp) s.sys.push({ t: s.clock, dev: sw, text: `eswd[1730]: ESWD_STP_STATE_CHANGE_INFO: STP state for interface ${port}.0 context id 0 changed from ${b.state.toUpperCase()} to ${a.state.toUpperCase()}` });
      }
    }
  for (const sw of L2_SWS) if (before.bridge[sw].rootSw !== after.bridge[sw].rootSw && after.bridge[sw].rstp) s.sys.push({ t: s.clock, dev: sw, text: `eswd[1730]: ESWD_STP_ROOT_CHANGE: Root bridge changed to ${after.bridge[sw].rootId}` });
  if (changed) {
    s.tcAt = s.clock;
    s.tcCount += 1;
    // A topology change flushes learned MACs (RSTP TC).
    for (const sw of L2_SWS) s.fdb[sw] = s.fdb[sw].filter((e) => !peerOf(sw, e.port)!.dev.startsWith("SW"));
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Pings
// ---------------------------------------------------------------------------------------------------------------
const ipOf = (d: L2D) => (d === "HOST-A" || d === "HOST-B" ? L2_IP[d] : MGMT[d].ip);
export const devOfIp = (ip: string): L2D | undefined => (L2_DEVS as L2D[]).find((d) => ipOf(d) === ip);
const macOf = (d: L2D) => (d === "HOST-A" || d === "HOST-B" ? L2_MAC[d] : SW_MAC[d]);
const vlanOfDev = (d: L2D) => (d === "HOST-A" || d === "HOST-B" ? USER_VLAN : MGMT_VLAN);
const srcOf = (s: L2State, d: L2D): { host: L2H } | { sw: L2Sw; vlan: number } => (d === "HOST-A" || d === "HOST-B" ? { host: d } : { sw: d, vlan: MGMT_VLAN });
const ARROW = "#fbbf24";
function floodMoment(fr: FloodResult, label: string, color: string, title: string): SpMoment {
  // A frame arriving on an Alternate (discarding) port is not a fault: that discard is what keeps the tree loop-free.
  const stpDrop = (h: Hop) => !!h.drop?.includes("Discarding");
  const toks: SpTok[] = fr.hops.map((h, i) => ({ from: h.from, to: h.to, label: stpDrop(h) ? `⊘ ${label}` : h.drop ? `✗ ${label}` : h.tag !== undefined ? `${label} ·${h.tag}` : label, color: stpDrop(h) ? "amber" : h.drop ? "red" : color, stay: !!h.drop, delay: i * 220 }));
  const lines: SpLine[] = [{ text: title, tone: "info" }];
  for (const h of fr.hops.filter((x) => x.drop)) lines.push(stpDrop(h) ? { text: `${h.to} ${h.toPort} discards it — an Alternate port (RSTP): this is what breaks the loop.`, tone: "info" } : { text: `${h.to} ${h.toPort} dropped it: ${h.drop}`, tone: "bad" });
  const bad = fr.hops.filter((h) => h.drop && !stpDrop(h)).map((h) => peerOf(h.from as L2Sw, h.fromPort)?.link ?? "").filter(Boolean);
  return { tokens: toks, lines, bad };
}
function runPing(s0: L2State, from: L2D, toIp: string, count: number): L2State {
  const s = cl(s0);
  const st = l2Stp(s);
  const to = devOfIp(toIp);
  const t0 = s.clock;
  const lv = loopVlans(s.cfg, st);
  const moments: SpMoment[] = [];
  let ok = false;
  const vlan = vlanOfDev(from);
  if (to && vlanOfDev(to) === vlan) {
    const req = flood(s.cfg, st, srcOf(s, from), macOf(from));
    learn(s, req.learned);
    countHops(s, req.hops, true);
    const got = req.reached.some((r) => r.dev === to && r.vlan === vlan);
    moments.push(floodMoment(req, "ARP who-has", ARROW, `${from} broadcasts “who has ${toIp}?” in VLAN ${vlan}${req.loop ? " — and it comes back around: a forwarding loop" : ""}.`));
    if (got) {
      const rep = flood(s.cfg, st, srcOf(s, to), macOf(to));
      learn(s, rep.learned);
      countHops(s, rep.hops, false);
      const back = rep.reached.some((r) => r.dev === from && r.vlan === vlan);
      moments.push(floodMoment(rep, "ARP reply", "#a78bfa", back ? `${to} answers; the reply reaches ${from}.` : `${to} answers, but the reply never reaches ${from}.`));
      ok = back;
      if (back) s.arp[from][toIp] = { mac: macOf(to), state: "REACHABLE" };
    }
    if (!ok) s.arp[from][toIp] = { mac: "", state: "FAILED" };
  } else {
    moments.push({ tokens: [], lines: [{ text: `${toIp} is not in ${from}'s subnet/VLAN in this lab.`, tone: "bad" }] });
  }
  const storm = ok && lv.includes(vlan);
  const recv = !ok ? 0 : storm ? Math.max(1, Math.round(count * 0.3)) : count;
  stormTraffic(s, count);
  s.clock += count;
  const test: L2Test = { id: s.tests.length + 1, kind: "ping", from, to: toIp, sent: count, recv, vlan, unreachable: !ok, storm, faults: faultsOf(s.cfg), t0, cfgSeq: s.cfgSeq };
  s.tests = [...s.tests, test].slice(-40);
  const sum = `${from} → ${toIp}: ${count} sent, ${recv} received${storm ? " — broadcast storm" : ""}`;
  moments.push({ tokens: [], lines: [{ text: sum, tone: recv === count ? "ok" : "bad" }] });
  const run: SpRun = { id: s.runs.length + 1 + s.seq * 1000, cmd: `ping ${toIp} from ${from}`, kind: "ping", moments, ok: recv === count };
  s.runs = [...s.runs, run];
  s.last = run;
  s.log = [...s.log, { seq: s.seq, t: s.clock, text: sum, tone: recv === count ? "ok" : "warn", dev: from }];
  return s;
}

// ---------------------------------------------------------------------------------------------------------------
// Tickets
// ---------------------------------------------------------------------------------------------------------------
export interface L2TicketDef {
  id: L2TicketId;
  title: string;
  report: string;
  reproLabel: string;
  repro: L2Action[];
  apply: (s: L2State) => void;
}
const pingAB: L2Action = { type: "ping", from: "HOST-A", to: L2_IP["HOST-B"], count: 4 };
const ping13: L2Action = { type: "ping", from: "SW1", to: MGMT.SW3.ip, count: 4 };
export const L2_TICKETS: L2TicketDef[] = [
  {
    id: "prune",
    title: "HOST-A can't reach HOST-B",
    report: "“Since last night's trunk clean-up HOST-A can't reach HOST-B at all. The switches all answer on their management addresses, every link light is on and spanning tree looks normal.”",
    reproLabel: "HOST-A → HOST-B + SW1 → SW3 management",
    repro: [pingAB, ping13],
    apply: (s) => void (s.cfg.SW2.ports["ge-0/0/51"].members = [MGMT_VLAN]),
  },
  {
    id: "access",
    title: "HOST-B moved desks and vanished",
    report: "“HOST-B was re-patched to a new desk port on SW3 this morning. Its link light is on, it has its usual address, but nobody can reach it.”",
    reproLabel: "HOST-A → HOST-B",
    repro: [pingAB],
    apply: (s) => void (s.cfg.SW3.ports["ge-0/0/1"] = { mode: "access", access: MGMT_VLAN }),
  },
  {
    id: "native",
    title: "Users can't reach each other since the template push",
    report: "“A configuration template was pushed to SW1 yesterday. HOST-A can't reach HOST-B any more; management access to all switches still works.”",
    reproLabel: "HOST-A → HOST-B + SW1 → SW3 management",
    repro: [pingAB, ping13],
    apply: (s) => void (s.cfg.SW1.ports["ge-0/0/49"].native = USER_VLAN),
  },
  {
    id: "loop",
    title: "The whole network is crawling",
    report: "“Everything on these three switches became extremely slow a few minutes ago — pings time out, the switches are sluggish on the console. Someone was ‘simplifying’ SW1's configuration.”",
    reproLabel: "HOST-A → HOST-B",
    repro: [pingAB],
    apply: (s) => void (s.cfg.SW1.rstp = false),
  },
  {
    id: "trunkmode",
    title: "SW3 and HOST-B both unreachable",
    report: "“After SW3's uplink port was re-configured, HOST-B is unreachable and so is SW3's management address. SW3 is up and its console works.”",
    reproLabel: "HOST-A → HOST-B + SW1 → SW3 management",
    repro: [pingAB, ping13],
    apply: (s) => void (s.cfg.SW3.ports["ge-0/0/51"] = { mode: "access", access: USER_VLAN }),
  },
];
export const l2Ticket = (id: string) => L2_TICKETS.find((t) => t.id === id)!;
export function l2TicketState(id: L2TicketId, seq = 0): L2State {
  const s = createL2Net(seq);
  const before = l2Stp(s);
  s.clock = 5;
  l2Ticket(id).apply(s);
  topoEvents(s, before);
  s.clock = 10;
  s.ticket = id;
  s.log = [...s.log, { seq, t: s.clock, text: `Ticket opened: ${l2Ticket(id).title}.`, tone: "warn" }];
  return s;
}

// ---------------------------------------------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------------------------------------------
const cl = (o: L2State): L2State => ({ ...spClone(o), runs: o.runs, last: o.last });
export function l2Apply(s0: L2State, a: L2Action): L2State {
  switch (a.type) {
    case "cfg": {
      const s = cl(s0);
      const before = l2Stp(s);
      s.hist[a.dev] = [spClone(s0.cfg[a.dev]), ...s.hist[a.dev]].slice(0, 20);
      s.cfg[a.dev] = spClone(a.cfg);
      s.cfgSeq += 1;
      s.clock += 1;
      s.sys.push({ t: s.clock, dev: a.dev, text: "mgd[2211]: UI_COMMIT: User 'admin' requested 'commit' operation" });
      topoEvents(s, before);
      if (L2_SWS.some((sw) => !s.cfg[sw].rstp) && loopVlans(s.cfg, l2Stp(s)).length) s.broke = { ...s.broke, loop: true };
      s.log = [...s.log, { seq: s.seq, t: s.clock, text: `${a.dev}: ${a.text}`, tone: "info", dev: a.dev }];
      return s;
    }
    case "set": {
      const s = cl(s0);
      const before = l2Stp(s);
      a.f(s);
      s.cfgSeq += 1;
      s.clock += 1;
      topoEvents(s, before);
      s.log = [...s.log, { seq: s.seq, t: s.clock, text: a.text, tone: "info" }];
      return s;
    }
    case "ping":
      return runPing(s0, a.from, a.to, a.count);
    case "wait": {
      const s = cl(s0);
      stormTraffic(s, a.secs);
      s.clock += a.secs;
      s.log = [...s.log, { seq: s.seq, t: s.clock, text: `${a.secs} s pass.`, tone: "info" }];
      return s;
    }
    case "clear-mac": {
      const s = cl(s0);
      s.fdb[a.dev] = [];
      s.clearedMac = { ...s.clearedMac, [a.dev]: s.clock };
      s.log = [...s.log, { seq: s.seq, t: s.clock, text: `${a.dev}: ethernet-switching table cleared.`, tone: "info", dev: a.dev }];
      return s;
    }
    case "clear-stats": {
      const s = cl(s0);
      for (const port of SW_PORTS[a.dev]) s.cleared[`${a.dev}:${port}`] = { ...s.ctr[`${a.dev}:${port}`] };
      s.clearedOnce = true;
      s.log = [...s.log, { seq: s.seq, t: s.clock, text: `${a.dev}: interface statistics cleared.`, tone: "info", dev: a.dev }];
      return s;
    }
    case "ticket":
      return l2TicketState(a.id, s0.seq + 1);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------------------------------------------
export const portCtr = (s: L2State, k: string): PortCtr => {
  const c = s.ctr[k];
  const b = s.cleared[k];
  return { inPkts: c.inPkts - b.inPkts, outPkts: c.outPkts - b.outPkts, bcastIn: c.bcastIn - b.bcastIn, drops: c.drops - b.drops };
};
export const lastTest = (s: L2State) => s.tests[s.tests.length - 1];
export const testText = (t: L2Test) => `ping ${t.from} → ${t.to}: ${t.unreachable ? "no ARP reply — unreachable (100% loss)" : `${t.recv}/${t.sent} replies${t.storm ? " — broadcast storm, huge latency" : ""}`}`;
export const vlanText = (v: number) => `${VLAN_NAME[v] ?? `vlan-${v}`} (${v})`;
export function portVlans(c: L2Cfg, port: string): string {
  const p = c.ports[port];
  if (!p) return "—";
  if (p.mode === "access") return `access ${vlanText(p.access ?? 0)}`;
  return `trunk ${(p.members ?? []).map((v) => VLAN_NAME[v] ?? v).join(" ")}${p.native !== undefined ? ` · native ${p.native}` : ""}`;
}

export const L2_CAUSES: { id: string; label: string }[] = [
  { id: "prune", label: "VLAN 10 is missing from the SW2 ↔ SW3 trunk" },
  { id: "access", label: "HOST-B's port is in the wrong access VLAN" },
  { id: "native", label: "Native VLAN mismatch on the SW1 ↔ SW2 trunk" },
  { id: "loop", label: "SW1 runs no spanning tree: a forwarding loop" },
  { id: "trunkmode", label: "SW3's uplink is an access port, SW2's side a trunk" },
  { id: "cable", label: "A broken cable between two switches" },
  { id: "ip", label: "HOST-B has a wrong IP address" },
  { id: "root", label: "The wrong switch became the RSTP root" },
];
export function l2CauseFeedback(s: L2State, cause: string): { right: boolean; text: string } {
  const t = s.ticket as L2TicketId | undefined;
  const yes: Record<L2TicketId, string> = {
    prune: "Yes. SW2 ge-0/0/51 is a trunk that carries only MGMT: VLAN 10 frames from SW1 are never sent toward SW3, so SW3 never learns HOST-A and HOST-B never hears the ARP. Links are up, RSTP is unchanged and VLAN 20 still crosses the same trunk — which is why management works.",
    access: "Yes. SW3 ge-0/0/1 is an access port in VLAN MGMT (20). HOST-B's frames enter VLAN 20, its MAC is learned in MGMT, and HOST-A's ARP in USERS never reaches that port. The link and the address are fine; the port's VLAN isn't.",
    native: "Yes. SW1 ge-0/0/49 now sends VLAN 10 untagged (native-vlan-id 10) while SW2 still treats untagged frames as native VLAN 1. HOST-A's frames land in VLAN default on SW2 — its MAC appears there on ge-0/0/49 — and never reach VLAN 10 beyond SW2. Tagged VLAN 20 is unaffected.",
    loop: "Yes. SW1 runs no spanning tree, so it forwards on both trunks and swallows BPDUs. SW2 and SW3 see no RSTP neighbour on those ports and forward too: the triangle has no blocked port. Every broadcast circulates forever — interface counters explode, MACs flap between ports, pings mostly die.",
    trunkmode: "Yes. SW3 ge-0/0/51 is an access port (VLAN USERS) while SW2's side is a trunk sending tagged frames. SW3 drops every tagged frame — VLAN 10 and VLAN 20 alike — so both HOST-B and SW3's management address are unreachable. Untagged BPDUs still pass, so RSTP looks normal.",
  };
  if (cause === t) return { right: true, text: yes[t] };
  const st = l2Stp(s);
  const alt = Object.entries(st.ports).filter(([, p]) => p.role === "Alternate").map(([k]) => k);
  const no: Record<string, string> = {
    prune: (s.cfg.SW2.ports["ge-0/0/51"].members ?? []).includes(USER_VLAN) ? "SW2 ge-0/0/51 carries USERS and MGMT." : "VLAN 10 is missing there — but is that what this ticket's evidence shows?",
    access: s.cfg.SW3.ports["ge-0/0/1"]?.access === USER_VLAN ? "SW3 ge-0/0/1 is an access port in USERS (10)." : "HOST-B's port VLAN is wrong — but look at this ticket's evidence.",
    native: s.cfg.SW1.ports["ge-0/0/49"].native === s.cfg.SW2.ports["ge-0/0/49"].native ? "Both ends of the SW1 ↔ SW2 trunk use native VLAN 1." : "The natives differ — but is that this ticket?",
    loop: L2_SWS.every((sw) => s.cfg[sw].rstp) ? `RSTP runs on all three switches and ${alt.join(", ") || "no port"} is Alternate/Discarding — no loop.` : "A switch runs no STP — but does this ticket's evidence point there?",
    trunkmode: s.cfg.SW3.ports["ge-0/0/51"]?.mode === "trunk" ? "SW3 ge-0/0/51 is a trunk, like SW2's side." : "SW3's uplink is an access port — but look at this ticket.",
    cable: `Every link is up at both ends (show interfaces terse)${L2_SWS.every((sw) => s.cfg[sw].rstp) ? " and BPDUs still cross every trunk" : ""}.`,
    ip: "HOST-B's address is 10.10.10.12/24, in the same subnet as HOST-A; an IP mistake wouldn't stop SW3 learning HOST-A's MAC.",
    root: `SW2 (priority ${s.cfg.SW2.prio}) is root, as designed; the tree is ${alt.length === 1 ? "unchanged" : "different"}.`,
  };
  return { right: false, text: no[cause] ?? "That doesn't match the evidence." };
}
export function l2Proofs(s: L2State): { label: string; ok: boolean; detail: string }[] {
  const t = s.ticket as L2TicketId | undefined;
  if (!t) return [];
  const fresh = s.tests.filter((x) => x.cfgSeq === s.cfgSeq);
  const pingAB = fresh.some((x) => x.from === "HOST-A" && x.to === L2_IP["HOST-B"] && x.recv === x.sent && !x.storm);
  const pingMg = fresh.some((x) => x.from.startsWith("SW") && x.recv === x.sent && !x.storm);
  const learned = (sw: L2Sw, mac: string, port: string) => liveFdb(s, sw).some((e) => e.mac === mac && e.vlan === USER_VLAN && e.port === port);
  switch (t) {
    case "prune":
      return [
        { label: "SW2 ge-0/0/51 carries VLAN 10", ok: !!s.cfg.SW2.ports["ge-0/0/51"].members?.includes(USER_VLAN), detail: "show ethernet-switching interface ge-0/0/51" },
        { label: "A fresh ping HOST-A → HOST-B: 4/4", ok: pingAB, detail: "ping after the fix" },
        { label: "SW3 has learned HOST-A in USERS on ge-0/0/51", ok: learned("SW3", L2_MAC["HOST-A"], "ge-0/0/51"), detail: "show ethernet-switching table on SW3" },
      ];
    case "access":
      return [
        { label: "SW3 ge-0/0/1 is an access port in USERS", ok: s.cfg.SW3.ports["ge-0/0/1"]?.mode === "access" && s.cfg.SW3.ports["ge-0/0/1"]?.access === USER_VLAN, detail: "show vlans" },
        { label: "A fresh ping HOST-A → HOST-B: 4/4", ok: pingAB, detail: "ping after the fix" },
      ];
    case "native":
      return [
        { label: "Both ends of SW1 ↔ SW2 agree on the native VLAN", ok: s.cfg.SW1.ports["ge-0/0/49"].native === s.cfg.SW2.ports["ge-0/0/49"].native, detail: "show ethernet-switching interface ge-0/0/49 on both" },
        { label: "A fresh ping HOST-A → HOST-B: 4/4", ok: pingAB, detail: "ping after the fix" },
        { label: "SW2 has learned HOST-A in USERS on ge-0/0/49", ok: learned("SW2", L2_MAC["HOST-A"], "ge-0/0/49"), detail: "show ethernet-switching table on SW2" },
      ];
    case "loop":
      return [
        { label: "RSTP runs on all three switches, exactly one port Alternate", ok: L2_SWS.every((sw) => s.cfg[sw].rstp) && Object.values(l2Stp(s).ports).filter((p) => p.role === "Alternate").length === 1, detail: "show spanning-tree interface" },
        { label: "No forwarding loop (no storm)", ok: !loopVlans(s.cfg, l2Stp(s)).length, detail: "interface counters calm down" },
        { label: "A fresh ping HOST-A → HOST-B: 4/4", ok: pingAB, detail: "ping after the fix" },
      ];
    case "trunkmode":
      return [
        { label: "SW3 ge-0/0/51 is a trunk carrying USERS and MGMT", ok: s.cfg.SW3.ports["ge-0/0/51"]?.mode === "trunk" && !!s.cfg.SW3.ports["ge-0/0/51"]?.members?.includes(USER_VLAN) && !!s.cfg.SW3.ports["ge-0/0/51"]?.members?.includes(MGMT_VLAN), detail: "show ethernet-switching interface ge-0/0/51" },
        { label: "A fresh ping HOST-A → HOST-B: 4/4", ok: pingAB, detail: "ping after the fix" },
        { label: "A fresh management ping to SW3", ok: pingMg && fresh.some((x) => x.to === MGMT.SW3.ip && x.recv === x.sent), detail: "ping 10.20.20.3 from SW1" },
      ];
  }
}
export function l2Ladder(s: L2State): { k: string; title: string; text: string }[] {
  const st = l2Stp(s);
  const t = lastTest(s);
  const lv = loopVlans(s.cfg, st);
  const down = WIRES.filter((w) => !linkUp(s.cfg, w.id)).map((w) => w.id);
  const alt = Object.entries(st.ports).filter(([, p]) => p.role === "Alternate").map(([k]) => k.replace(":", " "));
  const where = L2_SWS.map((sw) => `${sw}: ${liveFdb(s, sw).filter((e) => e.mac === L2_MAC["HOST-A"]).map((e) => `${VLAN_NAME[e.vlan]}@${e.port}`).join(", ") || "—"}`).join(" · ");
  return [
    { k: "symptom", title: "What fails — one VLAN, one host, everything?", text: t ? testText(t) : "Run a ping first." },
    { k: "links", title: "Are all links up?", text: down.length ? `down: ${down.join(", ")}` : "every link up" },
    { k: "stp", title: "Does spanning tree block exactly one port?", text: `${L2_SWS.filter((sw) => !s.cfg[sw].rstp).map((sw) => `${sw} has no RSTP · `).join("")}Alternate: ${alt.join(", ") || "none"}${lv.length ? ` — LOOP in VLAN ${lv.join(", ")}` : ""}` },
    { k: "mac", title: "Where has each switch learned HOST-A?", text: where },
    { k: "vlans", title: "Does every port on the path carry VLAN 10 the same way?", text: L2_SWS.map((sw) => SW_PORTS[sw].map((p) => `${sw} ${p}: ${portVlans(s.cfg[sw], p)}`).join(" · ")).join(" | ") },
    { k: "proof", title: "Fresh evidence after the change?", text: s.ticket ? `${l2Proofs(s).filter((p) => p.ok).length}/${l2Proofs(s).length} proofs met` : "open a ticket to prove a repair" },
  ];
}
/** Which kinds of fault the configuration contains right now. */
export function faultsOf(cfg: Record<L2Sw, L2Cfg>): string[] {
  const out: string[] = [];
  const swLinks = WIRES.filter((w) => w.b.startsWith("SW"));
  if (L2_SWS.some((sw) => SW_PORTS[sw].some((p) => peerOf(sw, p)!.dev.startsWith("SW") && cfg[sw].ports[p]?.mode === "trunk" && !cfg[sw].ports[p]?.members?.includes(USER_VLAN)))) out.push("prune");
  if ((["HOST-A", "HOST-B"] as L2H[]).some((h) => cfg[HOST_PORT[h].sw].ports[HOST_PORT[h].port]?.access !== USER_VLAN)) out.push("access");
  if (swLinks.some((w) => cfg[w.a].ports[w.ap]?.mode === "trunk" && cfg[w.b as L2Sw].ports[w.bp]?.mode === "trunk" && cfg[w.a].ports[w.ap]?.native !== cfg[w.b as L2Sw].ports[w.bp]?.native)) out.push("native");
  if (swLinks.some((w) => cfg[w.a].ports[w.ap]?.mode !== cfg[w.b as L2Sw].ports[w.bp]?.mode)) out.push("trunkmode");
  if (loopVlans(cfg, stpOf(cfg)).length) out.push("loop");
  if (stpOf(cfg).bridge.SW1.rootSw && stpOf(cfg).bridge.SW1.rootSw !== "SW2") out.push("root");
  return out;
}
