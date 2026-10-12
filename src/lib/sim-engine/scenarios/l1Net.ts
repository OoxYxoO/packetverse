import { spClone, type SpBase, type SpMoment, type SpRun, type SpTok } from "@/components/sp-lab/spKit";
import { FAULT_RX, HEALTHY_OPTICS, HISTORIC_CRC, L1_IP, PV_THRESH, REPAIRED_RX, UPLINK, WINDOW_CRC_FAULT, WINDOW_PKTS, WINDOW_S, rxBand } from "./troubleshootingLayer1";

/**
 * Layer 1 Troubleshooting lab — the guided lesson's network as a live model.
 *
 * CLIENT —ge-0/0/1— ACCESS-SW —ge-0/0/47 (1000BASE-LX fiber)— DIST-SW —ge-0/0/2— SERVER, one subnet (10.30.30.0/24).
 * Truth lives in configuration (Junos ether-options / disable on the switches, ethtool settings on the hosts) and in
 * physical state (a dirty connector, a broken fiber strand, a damaged copper pair). Everything the student reads —
 * link state, negotiated speed and duplex, optical levels, counters, ping/iperf3 results, syslog — is derived from that
 * truth, so every view tells the same story. Values match the guided lesson (Rx −6.3 → −19.8 dBm, +127 CRC per 30 s,
 * 3,912 historic CRC errors, seq 37 lost of 100).
 */

export type L1D = "CLIENT" | "ACCESS-SW" | "DIST-SW" | "SERVER";
export type L1Sw = "ACCESS-SW" | "DIST-SW";
export type L1Host = "CLIENT" | "SERVER";
export const L1_DEVS: L1D[] = ["CLIENT", "ACCESS-SW", "DIST-SW", "SERVER"];
export const IF_HOST: Record<L1Sw, string> = { "ACCESS-SW": "ge-0/0/1", "DIST-SW": "ge-0/0/2" };
export const SW_IFS: Record<L1Sw, string[]> = { "ACCESS-SW": ["ge-0/0/1", UPLINK], "DIST-SW": ["ge-0/0/2", UPLINK] };
export const IFINDEX: Record<string, number> = { "ge-0/0/1": 515, "ge-0/0/2": 516, [UPLINK]: 560 };
export const SW_MAC: Record<L1Sw, string> = { "ACCESS-SW": "2c:6b:f5:3a:10:00", "DIST-SW": "2c:6b:f5:3a:20:00" };
/** Fiber loss of the healthy path (dB) and what a dirty end-face adds. */
export const PATH_LOSS = 1.2;
export const DIRT_DB = HEALTHY_OPTICS["DIST-SW"].tx - PATH_LOSS - FAULT_RX; // 13.5 dB
export const LOS_DBM = -40;
export const IPERF_GOOD = 900;

// ---------------------------------------------------------------------------------------------------------------
// Configuration and physical truth
// ---------------------------------------------------------------------------------------------------------------
export interface EthOpts {
  noAuto?: boolean;
  speed?: "10m" | "100m" | "1g";
  linkMode?: "full-duplex" | "half-duplex";
}
export interface IfCfg {
  disable?: boolean;
  eth?: EthOpts;
}
/** A Junos switch's configuration: per interface. */
export interface L1JCfg {
  ifs: Record<string, IfCfg>;
}
export interface HostEth {
  autoneg: boolean;
  speed?: 10 | 100;
  duplex?: "half" | "full";
}
export interface Phys {
  /** Dirty end-face on the ACCESS end of the DIST → ACCESS strand. */
  dirtyA: boolean;
  /** The DIST → ACCESS strand of the patch cord is broken (no light at ACCESS). */
  strandBroken: boolean;
  /** CLIENT's patch cable has an open pair (4-5): gigabit can't train. */
  clientPair: boolean;
  /** The ACCESS end was cleaned (a cleaned connector reads 0.1 dB lower than a new cord). */
  cleaned: boolean;
}
export function l1Healthy(): { sw: Record<L1Sw, L1JCfg>; host: Record<L1Host, HostEth>; phys: Phys } {
  return {
    sw: { "ACCESS-SW": { ifs: { "ge-0/0/1": {}, [UPLINK]: {} } }, "DIST-SW": { ifs: { "ge-0/0/2": {}, [UPLINK]: {} } } },
    host: { CLIENT: { autoneg: true }, SERVER: { autoneg: true } },
    phys: { dirtyA: false, strandBroken: false, clientPair: false, cleaned: false },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Derived link state
// ---------------------------------------------------------------------------------------------------------------
export interface CopperLink {
  up: boolean;
  /** Why it is down (or degraded), in words. */
  why?: string;
  adminDown: boolean;
  speed: 10 | 100 | 1000;
  swDuplex: "full" | "half";
  hostDuplex: "full" | "half";
  swAuto: boolean;
  hostAuto: boolean;
  mismatch: boolean;
  downshift: boolean;
}
export interface FiberLink {
  up: boolean;
  why?: string;
  txA: number;
  txD: number;
  /** Receive levels (dBm); LOS_DBM when there is no light. */
  rxA: number;
  rxD: number;
  adminA: boolean;
  adminD: boolean;
  remoteFault: "A" | "D" | undefined;
}
export interface L1View {
  client: CopperLink;
  uplink: FiberLink;
  server: CopperLink;
  reach: boolean;
}
const sp = (s?: string): 10 | 100 | 1000 => (s === "10m" ? 10 : s === "100m" ? 100 : 1000);
function copper(c: IfCfg, h: HostEth, pairBroken: boolean): CopperLink {
  const e = c.eth ?? {};
  const swAuto = !e.noAuto;
  const hostAuto = h.autoneg;
  const base = { adminDown: !!c.disable, swAuto, hostAuto, mismatch: false, downshift: false };
  if (c.disable) return { ...base, up: false, why: "administratively disabled on the switch", speed: 1000, swDuplex: "full", hostDuplex: "full" };
  if (swAuto && hostAuto) {
    const limit = sp(e.speed);
    const duplex = e.linkMode === "half-duplex" ? "half" : "full";
    if (pairBroken && limit === 1000 && e.speed === "1g") return { ...base, up: false, why: "gigabit can't train over a cable with an open pair (speed 1g only advertised)", speed: 1000, swDuplex: duplex, hostDuplex: duplex };
    const speed = pairBroken && limit === 1000 ? 100 : limit;
    return { ...base, up: true, speed, swDuplex: duplex, hostDuplex: duplex, downshift: pairBroken && limit === 1000 };
  }
  if (swAuto && !hostAuto) {
    // The switch parallel-detects the host's speed and must assume half duplex.
    const speed = h.speed ?? 100;
    const hostDuplex = h.duplex ?? "full";
    return { ...base, up: true, speed, swDuplex: "half", hostDuplex, mismatch: hostDuplex !== "half" };
  }
  const speed = sp(e.speed ?? "100m");
  const swDuplex = e.linkMode === "half-duplex" ? "half" : "full";
  if (hostAuto) {
    // The host parallel-detects the forced speed and falls back to half duplex.
    return { ...base, up: true, speed, swDuplex, hostDuplex: "half", mismatch: swDuplex !== "half" };
  }
  if ((h.speed ?? 100) !== speed) return { ...base, up: false, why: `both ends forced, to different speeds (${speed} vs ${h.speed} Mb/s)`, speed, swDuplex, hostDuplex: h.duplex ?? "full" };
  const hostDuplex = h.duplex ?? "full";
  return { ...base, up: true, speed, swDuplex, hostDuplex, mismatch: swDuplex !== hostDuplex };
}
export function l1View(s: Pick<L1State, "sw" | "host" | "phys">): L1View {
  const client = copper(s.sw["ACCESS-SW"].ifs["ge-0/0/1"] ?? {}, s.host.CLIENT, s.phys.clientPair);
  const server = copper(s.sw["DIST-SW"].ifs["ge-0/0/2"] ?? {}, s.host.SERVER, false);
  const adminA = !s.sw["ACCESS-SW"].ifs[UPLINK]?.disable;
  const adminD = !s.sw["DIST-SW"].ifs[UPLINK]?.disable;
  const txA = HEALTHY_OPTICS["ACCESS-SW"].tx;
  const txD = HEALTHY_OPTICS["DIST-SW"].tx;
  // A disabled 1000BASE-X port turns its laser off.
  const rxA = !adminD || s.phys.strandBroken ? LOS_DBM : s.phys.dirtyA ? FAULT_RX : s.phys.cleaned ? REPAIRED_RX : HEALTHY_OPTICS["ACCESS-SW"].rx;
  const rxD = !adminA ? LOS_DBM : HEALTHY_OPTICS["DIST-SW"].rx;
  const losA = rxA < PV_THRESH.marginalMin;
  const losD = rxD < PV_THRESH.marginalMin;
  // 1000BASE-X auto-negotiation: a port that loses its receive signal signals remote fault, so both ends go down.
  const up = adminA && adminD && !losA && !losD;
  const why = !adminA ? "ACCESS-SW ge-0/0/47 is disabled" : !adminD ? "DIST-SW ge-0/0/47 is disabled" : losA ? "no light arriving at ACCESS-SW (loss of signal)" : losD ? "no light arriving at DIST-SW (loss of signal)" : rxBand(rxA) === "marginal" ? "ACCESS-SW receive level marginal: bits misread" : undefined;
  const uplink: FiberLink = { up, why, txA: adminA ? txA : LOS_DBM, txD: adminD ? txD : LOS_DBM, rxA, rxD, adminA, adminD, remoteFault: adminA && adminD ? (losA ? "D" : losD ? "A" : undefined) : undefined };
  return { client, uplink, server, reach: client.up && uplink.up && server.up };
}
export const linkUp = (v: L1View, sw: L1Sw, ifn: string) => (ifn === UPLINK ? v.uplink.up : sw === "ACCESS-SW" ? v.client.up : v.server.up);

// ---------------------------------------------------------------------------------------------------------------
// Counters
// ---------------------------------------------------------------------------------------------------------------
export interface SwCounters {
  inPkts: number;
  outPkts: number;
  crc: number;
  runts: number;
  carrier: number;
}
export interface HostCounters {
  rxPkts: number;
  txPkts: number;
  rxCrc: number;
  collisions: number;
  lateColl: number;
  carrier: number;
}
export const SW_KEYS = ["ACCESS-SW:ge-0/0/1", `ACCESS-SW:${UPLINK}`, `DIST-SW:${UPLINK}`, "DIST-SW:ge-0/0/2"] as const;
export type SwKey = (typeof SW_KEYS)[number];
export interface L1Snapshot {
  t: number;
  cfgSeq: number;
  label: string;
  c: Record<string, SwCounters>;
}

// ---------------------------------------------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------------------------------------------
export interface L1Test {
  id: number;
  kind: "ping" | "iperf" | "wait";
  /** iperf: reverse (SERVER sends — a download). */
  reverse?: boolean;
  t0: number;
  secs: number;
  sent?: number;
  recv?: number;
  lost?: number[];
  unreachable?: boolean;
  mbps?: number;
  retr?: number;
  cfgSeq: number;
}
export interface L1Sys {
  t: number;
  dev: L1D;
  text: string;
}
export interface L1State extends SpBase {
  sw: Record<L1Sw, L1JCfg>;
  hist: Record<L1Sw, L1JCfg[]>;
  host: Record<L1Host, HostEth>;
  phys: Phys;
  swc: Record<string, SwCounters>;
  /** Baselines taken by `clear interfaces statistics` (what show interfaces subtracts) and when. */
  cleared: Record<string, SwCounters & { at?: number }>;
  hc: Record<L1Host, HostCounters>;
  /** When each link last changed state (lab clock); undefined = 41 days ago. */
  flap: { client?: number; uplink?: number; server?: number };
  tests: L1Test[];
  snaps: L1Snapshot[];
  sys: L1Sys[];
  physLog: { t: number; id: string; cfgSeq: number }[];
  clearedOnce: boolean;
  tdr: Partial<Record<L1Sw, { t: number; open: boolean }>>;
  /** Field-kit breakages the student caused (for challenges). */
  broke: Partial<Record<"smudge" | "pair", boolean>>;
}
export type L1TicketId = "dirty" | "duplex" | "admin" | "los" | "copper";
export type PhysId = "clean-a" | "clean-d" | "cord" | "sfp-a" | "sfp-d" | "cable-c" | "cable-s";
export type BreakId = "smudge" | "pair";
export type L1Action =
  | { type: "cfg"; dev: L1Sw; cfg: L1JCfg; text: string }
  | { type: "host"; dev: L1Host; eth: HostEth; text: string }
  | { type: "set"; text: string; f: (s: L1State) => void }
  | { type: "phys"; id: PhysId }
  | { type: "break"; id: BreakId }
  | { type: "ping"; count: number }
  | { type: "iperf"; reverse?: boolean }
  | { type: "wait"; secs: number }
  | { type: "snapshot"; label?: string }
  | { type: "clear-stats"; dev: L1Sw; ifn?: string }
  | { type: "tdr"; dev: L1Sw }
  | { type: "ticket"; id: L1TicketId };

export const PHYS: { id: PhysId; dev: L1D; label: string; link: "uplink" | "client" | "server" }[] = [
  { id: "clean-a", dev: "ACCESS-SW", label: "Clean and reseat the uplink fiber at ACCESS-SW ge-0/0/47", link: "uplink" },
  { id: "sfp-a", dev: "ACCESS-SW", label: "Replace ACCESS-SW's ge-0/0/47 optic (SFP-LX10)", link: "uplink" },
  { id: "cord", dev: "ACCESS-SW", label: "Replace the uplink fiber patch cord", link: "uplink" },
  { id: "clean-d", dev: "DIST-SW", label: "Clean and reseat the uplink fiber at DIST-SW ge-0/0/47", link: "uplink" },
  { id: "sfp-d", dev: "DIST-SW", label: "Replace DIST-SW's ge-0/0/47 optic (SFP-LX10)", link: "uplink" },
  { id: "cable-c", dev: "CLIENT", label: "Replace CLIENT's patch cable", link: "client" },
  { id: "cable-s", dev: "SERVER", label: "Replace SERVER's patch cable", link: "server" },
];
export const BREAKS: { id: BreakId; label: string; text: string }[] = [
  { id: "smudge", label: "Smudge the uplink connector at ACCESS-SW", text: "Field kit: a fingerprint on the ACCESS-end connector of the uplink fiber." },
  { id: "pair", label: "Damage CLIENT's patch cable", text: "Field kit: CLIENT's patch cable is crushed under a desk leg — pair 4-5 is open." },
];

const zeroSw = (): SwCounters => ({ inPkts: 0, outPkts: 0, crc: 0, runts: 0, carrier: 0 });
export function createL1Net(seq = 0): L1State {
  const h = l1Healthy();
  const swc: Record<string, SwCounters> = {
    "ACCESS-SW:ge-0/0/1": { inPkts: 61_204_557, outPkts: 64_118_902, crc: 0, runts: 0, carrier: 2 },
    [`ACCESS-SW:${UPLINK}`]: { inPkts: 918_402_117, outPkts: 871_550_904, crc: HISTORIC_CRC, runts: 0, carrier: 2 },
    [`DIST-SW:${UPLINK}`]: { inPkts: 871_550_311, outPkts: 918_402_730, crc: 0, runts: 0, carrier: 2 },
    "DIST-SW:ge-0/0/2": { inPkts: 70_331_208, outPkts: 66_903_417, crc: 0, runts: 0, carrier: 2 },
  };
  const cleared: Record<string, SwCounters & { at?: number }> = {};
  for (const k of SW_KEYS) cleared[k] = zeroSw();
  return {
    seq,
    cfgSeq: 0,
    clock: 0,
    runs: [],
    log: [{ seq, t: 0, text: "Healthy network: CLIENT and SERVER share 10.30.30.0/24 across ACCESS-SW and DIST-SW; the uplink is 1000BASE-LX fiber.", tone: "info" }],
    sw: h.sw,
    hist: { "ACCESS-SW": [], "DIST-SW": [] },
    host: h.host,
    phys: h.phys,
    swc,
    cleared,
    hc: { CLIENT: { rxPkts: 64_118_377, txPkts: 61_204_590, rxCrc: 0, collisions: 0, lateColl: 0, carrier: 2 }, SERVER: { rxPkts: 66_903_290, txPkts: 70_331_255, rxCrc: 0, collisions: 0, lateColl: 0, carrier: 2 } },
    flap: {},
    tests: [],
    snaps: [],
    sys: [],
    physLog: [],
    clearedOnce: false,
    tdr: {},
    broke: {},
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Time passing: background traffic, errors, test traffic
// ---------------------------------------------------------------------------------------------------------------
const BG = { client: 1_840, server: 2_110 }; // frames per 30 s each way on the host ports
/** Frames per second of a full-rate iperf3 stream at `mbps`. */
const fps = (mbps: number) => Math.round((mbps * 1e6) / (1514 * 8));
function traffic(s: L1State, secs: number, extra?: { up?: number; down?: number }) {
  const v = l1View(s);
  const k = secs / WINDOW_S;
  const A = s.swc[`ACCESS-SW:${UPLINK}`];
  const Dd = s.swc[`DIST-SW:${UPLINK}`];
  const C = s.swc["ACCESS-SW:ge-0/0/1"];
  const Sv = s.swc["DIST-SW:ge-0/0/2"];
  const up = extra?.up ?? 0; // frames CLIENT → SERVER
  const down = extra?.down ?? 0; // frames SERVER → CLIENT
  if (v.uplink.up) {
    const inA = Math.round(WINDOW_PKTS * k) + down;
    const crcA = rxBand(v.uplink.rxA) === "marginal" ? Math.round(WINDOW_CRC_FAULT * k) + Math.round(down * 0.00263) : 0;
    A.inPkts += inA - crcA;
    A.crc += crcA;
    const inD = Math.round(WINDOW_PKTS * k * 0.94) + up;
    Dd.inPkts += inD;
    A.outPkts += inD;
    Dd.outPkts += inA;
  }
  if (v.client.up) {
    const fromHost = Math.round(BG.client * k) + up;
    const toHost = Math.round(BG.client * k * 1.04) + (v.reach ? down : 0);
    if (v.client.mismatch) {
      // The full-duplex end sees fragments and bad FCS from the half-duplex end's aborted transmissions; the
      // half-duplex end counts late collisions.
      const fullIsSwitch = v.client.swDuplex === "full";
      const bad = Math.round(41 * k) + Math.round((up + down) * 0.0049);
      const runts = Math.round(58 * k) + Math.round((up + down) * 0.0066);
      const late = Math.round(33 * k) + Math.round((up + down) * 0.0052);
      if (fullIsSwitch) {
        C.crc += bad;
        C.runts += runts;
        s.hc.CLIENT.lateColl += late;
        s.hc.CLIENT.collisions += late * 3;
      } else {
        s.hc.CLIENT.rxCrc += bad;
        C.runts += 0;
      }
    }
    C.inPkts += fromHost;
    C.outPkts += toHost;
    s.hc.CLIENT.txPkts += fromHost;
    s.hc.CLIENT.rxPkts += toHost;
  }
  if (v.server.up) {
    const fromHost = Math.round(BG.server * k) + (v.reach ? down : 0);
    const toHost = Math.round(BG.server * k * 0.97) + (v.reach ? up : 0);
    Sv.inPkts += fromHost;
    Sv.outPkts += toHost;
    s.hc.SERVER.txPkts += fromHost;
    s.hc.SERVER.rxPkts += toHost;
  }
  s.clock += secs;
}

// ---------------------------------------------------------------------------------------------------------------
// Link changes: carrier transitions, syslog, dmesg
// ---------------------------------------------------------------------------------------------------------------
const sysLink = (s: L1State, dev: L1Sw, ifn: string, up: boolean, admin: boolean) =>
  s.sys.push({ t: s.clock, dev, text: `mib2d[1650]: ${up ? "SNMP_TRAP_LINK_UP" : "SNMP_TRAP_LINK_DOWN"}: ifIndex ${IFINDEX[ifn]}, ifAdminStatus ${admin ? "up(1)" : "down(2)"}, ifOperStatus ${up ? "up(1)" : "down(2)"}, ifName ${ifn}` });
const dmesgLink = (s: L1State, dev: L1Host, l: CopperLink) => {
  s.sys.push({ t: s.clock, dev, text: l.up ? `e1000e 0000:00:1f.6 eth0: NIC Link is Up ${l.speed} Mbps ${l.hostDuplex === "full" ? "Full" : "Half"} Duplex, Flow Control: ${l.hostDuplex === "full" ? "Rx/Tx" : "None"}` : "e1000e 0000:00:1f.6 eth0: NIC Link is Down" });
  if (l.up && l.downshift) s.sys.push({ t: s.clock, dev, text: "e1000e 0000:00:1f.6 eth0: Link Speed was downgraded by SmartSpeed" });
};
function linkEvents(s: L1State, before: L1View, flapUplink = false, flapCopper?: "client" | "server") {
  const after = l1View(s);
  const bump = (keys: string[]) => keys.forEach((k) => (s.swc[k].carrier += 1));
  const copperChange = (which: "client" | "server", b: CopperLink, a: CopperLink, flap: boolean) => {
    const sw: L1Sw = which === "client" ? "ACCESS-SW" : "DIST-SW";
    const host: L1Host = which === "client" ? "CLIENT" : "SERVER";
    const ifn = IF_HOST[sw];
    const changed = b.up !== a.up || (a.up && (b.speed !== a.speed || b.hostDuplex !== a.hostDuplex || b.swDuplex !== a.swDuplex));
    if (!changed && !(flap && b.up)) return;
    const downUp = (b.up && a.up) || (flap && b.up && a.up);
    const n = downUp ? 2 : 1;
    s.swc[`${sw}:${ifn}`].carrier += n;
    s.hc[host].carrier += n;
    if (b.up) {
      sysLink(s, sw, ifn, false, !a.adminDown);
      dmesgLink(s, host, { ...b, up: false });
    }
    if (a.up) {
      sysLink(s, sw, ifn, true, true);
      dmesgLink(s, host, a);
    }
    s.flap[which] = s.clock;
  };
  copperChange("client", before.client, after.client, flapCopper === "client");
  copperChange("server", before.server, after.server, flapCopper === "server");
  const b = before.uplink;
  const a = after.uplink;
  if (b.up !== a.up || (flapUplink && b.up)) {
    const n = b.up && a.up ? 2 : 1;
    for (let i = 0; i < n; i++) bump([`ACCESS-SW:${UPLINK}`, `DIST-SW:${UPLINK}`]);
    if (b.up) {
      sysLink(s, "ACCESS-SW", UPLINK, false, a.adminA);
      sysLink(s, "DIST-SW", UPLINK, false, a.adminD);
    }
    if (a.up) {
      sysLink(s, "ACCESS-SW", UPLINK, true, true);
      sysLink(s, "DIST-SW", UPLINK, true, true);
    }
    s.flap.uplink = s.clock;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Runs (what the topology animates)
// ---------------------------------------------------------------------------------------------------------------
const PATH_C2S: [L1D, L1D][] = [
  ["CLIENT", "ACCESS-SW"],
  ["ACCESS-SW", "DIST-SW"],
  ["DIST-SW", "SERVER"],
];
const PATH_S2C: [L1D, L1D][] = PATH_C2S.map(([a, b]) => [b, a] as [L1D, L1D]).reverse();
const LINK_ID: Record<string, string> = { "CLIENT|ACCESS-SW": "L-C-A", "ACCESS-SW|DIST-SW": "L-UP", "DIST-SW|SERVER": "L-D-S" };
export const linkIdOf = (a: L1D, b: L1D) => LINK_ID[`${a}|${b}`] ?? LINK_ID[`${b}|${a}`];
const toks = (path: [L1D, L1D][], label: string, color: string): SpTok[] => path.map(([from, to], i) => ({ from, to, label, color, delay: i * 350 }));
/** Where a frame stops when a link is down (the first down link on its path). */
function cut(v: L1View, path: [L1D, L1D][]): number {
  return path.findIndex(([a, b]) => {
    const id = linkIdOf(a, b);
    return id === "L-C-A" ? !v.client.up : id === "L-UP" ? !v.uplink.up : !v.server.up;
  });
}
function badLinks(v: L1View): string[] {
  const out: string[] = [];
  if (!v.client.up || v.client.mismatch || v.client.downshift) out.push("L-C-A");
  if (!v.uplink.up || rxBand(v.uplink.rxA) === "marginal") out.push("L-UP");
  if (!v.server.up || v.server.mismatch) out.push("L-D-S");
  return out;
}
function pushRun(s: L1State, cmd: string, kind: string, moments: SpMoment[], ok: boolean) {
  const run: SpRun = { id: s.runs.length + 1 + s.seq * 1000, cmd, kind, moments, ok };
  s.runs = [...s.runs, run];
  s.last = run;
}

// ---------------------------------------------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------------------------------------------
/** Which echo replies of a ping series are lost, and why (truth → evidence). */
export function lossOf(v: L1View, seq: number): string | undefined {
  if (rxBand(v.uplink.rxA) === "marginal" && seq % 100 === 37) return `reply seq ${seq} failed the FCS check at ACCESS-SW ${UPLINK}`;
  if (v.client.mismatch && seq % 50 === 13) return `reply seq ${seq} destroyed by a late collision on CLIENT's port (duplex mismatch)`;
  if (v.server.mismatch && seq % 50 === 29) return `request seq ${seq} destroyed by a late collision on SERVER's port (duplex mismatch)`;
  return undefined;
}
function runPing(s0: L1State, count: number): L1State {
  const s = cl(s0);
  const v = l1View(s);
  const t0 = s.clock;
  const lost: number[] = [];
  const why: string[] = [];
  for (let q = 1; q <= count; q++) {
    if (!v.reach) {
      lost.push(q);
      continue;
    }
    const w = lossOf(v, q);
    if (w) {
      lost.push(q);
      why.push(w);
    }
  }
  traffic(s, count, { up: v.reach ? count : 0, down: v.reach ? count - lost.length : 0 });
  const test: L1Test = { id: s.tests.length + 1, kind: "ping", t0, secs: count, sent: count, recv: count - lost.length, lost, unreachable: !v.reach, cfgSeq: s.cfgSeq };
  s.tests = [...s.tests, test].slice(-40);
  const moments: SpMoment[] = [];
  const bad = badLinks(v);
  if (!v.reach) {
    const k = cut(v, PATH_C2S);
    const stop = PATH_C2S.slice(0, Math.max(0, k));
    moments.push({ tokens: [...toks(stop, "ARP who-has .20", "#fbbf24"), ...(k >= 0 ? [{ from: PATH_C2S[k][0], to: PATH_C2S[k][1], label: "✗ link down", color: "red", stay: true, delay: stop.length * 350 }] : [])], lines: [{ text: `CLIENT ARPs for ${L1_IP.SERVER}: no reply — ${k === 0 ? "CLIENT's own link is down" : k === 1 ? "the uplink is down" : "SERVER's link is down"}.`, tone: "bad" }], bad });
  } else {
    moments.push({ tokens: toks(PATH_C2S, "echo req 1", "#22d3ee"), lines: [{ text: `seq 1: echo request CLIENT → SERVER across ${UPLINK}.`, tone: "info" }], bad, hot: ["L-C-A", "L-UP", "L-D-S"] });
    moments.push({ tokens: toks(PATH_S2C, "echo reply 1", "#a78bfa"), lines: [{ text: "seq 1: echo reply arrives — FCS good at every receiver.", tone: "ok" }], bad, hot: ["L-C-A", "L-UP", "L-D-S"] });
    if (lost.length) {
      const q = lost[0];
      const w = lossOf(v, q) ?? "";
      const atAccess = w.includes(UPLINK) || w.includes("CLIENT's port");
      const path = w.includes("request") ? PATH_C2S : PATH_S2C;
      const stopAt = w.includes("request") ? 2 : atAccess && w.includes(UPLINK) ? 1 : 2;
      moments.push({ tokens: [...toks(path.slice(0, stopAt), `reply ${q}`, "#a78bfa"), { from: path[stopAt][0], to: path[stopAt][1], label: "✗ FCS", color: "red", stay: true, delay: stopAt * 350 }], lines: [{ text: `seq ${q}: ${w} — discarded, never delivered.`, tone: "bad" }], bad });
    }
  }
  const sum = `ping -c ${count} ${L1_IP.SERVER}: ${count} sent, ${count - lost.length} received, ${Math.round((100 * lost.length) / count)}% loss`;
  moments.push({ tokens: [], lines: [{ text: sum, tone: lost.length ? "bad" : "ok" }], bad });
  pushRun(s, `ping -c ${count} ${L1_IP.SERVER}`, "ping", moments, !lost.length);
  s.log = [...s.log, { seq: s.seq, t: s.clock, text: sum, tone: lost.length ? "warn" : "ok", dev: "CLIENT" }];
  return s;
}
export function iperfRate(v: L1View, reverse: boolean): { mbps: number; retr: number } | undefined {
  if (!v.reach) return undefined;
  if (v.client.mismatch || v.server.mismatch) return { mbps: reverse ? 2.41 : 3.12, retr: reverse ? 538 : 412 };
  const line = Math.min(v.client.speed, v.server.speed);
  if (reverse && rxBand(v.uplink.rxA) === "marginal") return { mbps: 186, retr: 1874 };
  if (!reverse && rxBand(v.uplink.rxA) === "marginal") return { mbps: line >= 1000 ? 936 : 94.0, retr: 3 };
  return { mbps: line >= 1000 ? 941 : line >= 100 ? 94.1 : 9.41, retr: 0 };
}
function runIperf(s0: L1State, reverse: boolean): L1State {
  const s = cl(s0);
  const v = l1View(s);
  const t0 = s.clock;
  const r = iperfRate(v, reverse);
  const frames = r ? fps(r.mbps) * 10 : 0;
  traffic(s, 10, reverse ? { down: frames, up: Math.round(frames / 2) } : { up: frames, down: Math.round(frames / 2) });
  const test: L1Test = { id: s.tests.length + 1, kind: "iperf", reverse, t0, secs: 10, mbps: r?.mbps, retr: r?.retr, unreachable: !r, cfgSeq: s.cfgSeq };
  s.tests = [...s.tests, test].slice(-40);
  const bad = badLinks(v);
  const path = reverse ? PATH_S2C : PATH_C2S;
  const sum = r ? `iperf3 ${reverse ? "download (SERVER → CLIENT)" : "upload (CLIENT → SERVER)"}: ${r.mbps} Mbits/sec, ${r.retr} retransmissions` : "iperf3: unable to connect to SERVER";
  const moments: SpMoment[] = r ? [{ tokens: toks(path, `${r.mbps} Mb/s`, reverse ? "#a78bfa" : "#22d3ee"), lines: [{ text: sum, tone: r.mbps >= IPERF_GOOD ? "ok" : "bad" }], bad, hot: ["L-C-A", "L-UP", "L-D-S"] }] : [{ tokens: [], lines: [{ text: sum, tone: "bad" }], bad }];
  pushRun(s, `iperf3 -c ${L1_IP.SERVER}${reverse ? " -R" : ""}`, "iperf", moments, !!r && r.mbps >= IPERF_GOOD);
  s.log = [...s.log, { seq: s.seq, t: s.clock, text: sum, tone: r && r.mbps >= IPERF_GOOD ? "ok" : "warn", dev: "CLIENT" }];
  return s;
}

// ---------------------------------------------------------------------------------------------------------------
// Tickets
// ---------------------------------------------------------------------------------------------------------------
export interface L1TicketDef {
  id: L1TicketId;
  title: string;
  report: string;
  reproLabel: string;
  repro: L1Action[];
  apply: (s: L1State) => void;
}
export const L1_TICKETS: L1TicketDef[] = [
  {
    id: "dirty",
    title: "Downloads from SERVER crawl",
    report: "“Copying files from SERVER has been painfully slow since yesterday. Ping works — mostly. The uplink between the switches shows UP and nobody touched the configuration.”",
    reproLabel: "100 pings + a download test",
    repro: [{ type: "ping", count: 100 }, { type: "iperf", reverse: true }],
    apply: (s) => void (s.phys.dirtyA = true),
  },
  {
    id: "duplex",
    title: "CLIENT's port was “tuned”",
    report: "“Someone ‘optimised’ the port settings for CLIENT yesterday. Since then everything CLIENT does over the network crawls, in both directions. The link light is on.”",
    reproLabel: "upload test + 100 pings",
    repro: [{ type: "iperf" }, { type: "ping", count: 100 }],
    apply: (s) => void (s.sw["ACCESS-SW"].ifs["ge-0/0/1"] = { eth: { noAuto: true, speed: "100m", linkMode: "full-duplex" } }),
  },
  {
    id: "admin",
    title: "SERVER vanished after the maintenance window",
    report: "“After last night's maintenance SERVER doesn't answer anything. The server team says the box is up and its cable is plugged in.”",
    reproLabel: "4 pings",
    repro: [{ type: "ping", count: 4 }],
    apply: (s) => void (s.sw["DIST-SW"].ifs["ge-0/0/2"] = { disable: true }),
  },
  {
    id: "los",
    title: "Everything behind DIST-SW is gone",
    report: "“Since the cabling crew worked in the riser, CLIENT can't reach SERVER at all. Both switches are powered and their configurations haven't changed.”",
    reproLabel: "4 pings",
    repro: [{ type: "ping", count: 4 }],
    apply: (s) => void (s.phys.strandBroken = true),
  },
  {
    id: "copper",
    title: "Capped at 94 Mbit/s after the desk move",
    report: "“Since CLIENT's desk was moved, downloads never go above about 94 Mbit/s. Before, they ran at gigabit speed. No errors anywhere, nothing in the configuration changed.”",
    reproLabel: "download test",
    repro: [{ type: "iperf", reverse: true }],
    apply: (s) => void (s.phys.clientPair = true),
  },
];
export const l1Ticket = (id: string) => L1_TICKETS.find((t) => t.id === id)!;
export function l1TicketState(id: L1TicketId, seq = 0): L1State {
  const s = createL1Net(seq);
  const before = l1View(s);
  s.clock = 5;
  l1Ticket(id).apply(s);
  linkEvents(s, before);
  s.clock = 10;
  s.ticket = id;
  s.log = [...s.log, { seq, t: s.clock, text: `Ticket opened: ${l1Ticket(id).title}.`, tone: "warn" }];
  return s;
}

// ---------------------------------------------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------------------------------------------
const cl = (o: L1State): L1State => ({ ...spClone(o), runs: o.runs, last: o.last });
export function l1Apply(s0: L1State, a: L1Action): L1State {
  switch (a.type) {
    case "cfg": {
      const s = cl(s0);
      const before = l1View(s);
      s.hist[a.dev] = [spClone(s0.sw[a.dev]), ...s.hist[a.dev]].slice(0, 20);
      s.sw[a.dev] = spClone(a.cfg);
      s.cfgSeq += 1;
      s.clock += 1;
      s.sys.push({ t: s.clock, dev: a.dev, text: "mgd[2211]: UI_COMMIT: User 'admin' requested 'commit' operation" });
      linkEvents(s, before);
      s.log = [...s.log, { seq: s.seq, t: s.clock, text: `${a.dev}: ${a.text}`, tone: "info", dev: a.dev }];
      return s;
    }
    case "host": {
      const s = cl(s0);
      const before = l1View(s);
      s.host[a.dev] = { ...a.eth };
      s.cfgSeq += 1;
      s.clock += 1;
      linkEvents(s, before);
      s.log = [...s.log, { seq: s.seq, t: s.clock, text: `${a.dev}: ${a.text}`, tone: "info", dev: a.dev }];
      return s;
    }
    case "set": {
      const s = cl(s0);
      const before = l1View(s);
      a.f(s);
      s.cfgSeq += 1;
      s.clock += 1;
      linkEvents(s, before);
      s.log = [...s.log, { seq: s.seq, t: s.clock, text: a.text, tone: "info" }];
      return s;
    }
    case "phys": {
      const s = cl(s0);
      const before = l1View(s);
      const p = PHYS.find((x) => x.id === a.id)!;
      s.clock += 20; // walking there, cleaning, reseating
      if (a.id === "clean-a") {
        if (s.phys.dirtyA) s.phys.cleaned = true;
        s.phys.dirtyA = false;
      }
      if (a.id === "cord") {
        s.phys.dirtyA = false;
        s.phys.strandBroken = false;
        s.phys.cleaned = false;
      }
      if (a.id === "cable-c") s.phys.clientPair = false;
      s.cfgSeq += 1;
      s.physLog = [...s.physLog, { t: s.clock, id: a.id, cfgSeq: s.cfgSeq }];
      linkEvents(s, before, p.link === "uplink", p.link === "uplink" ? undefined : p.link);
      s.log = [...s.log, { seq: s.seq, t: s.clock, text: `Field work: ${p.label}.`, tone: "info", dev: p.dev }];
      return s;
    }
    case "break": {
      const s = cl(s0);
      const before = l1View(s);
      if (a.id === "smudge") s.phys.dirtyA = true;
      if (a.id === "pair") s.phys.clientPair = true;
      s.broke = { ...s.broke, [a.id]: true };
      s.cfgSeq += 1;
      s.clock += 5;
      linkEvents(s, before, a.id === "smudge", a.id === "pair" ? "client" : undefined);
      s.log = [...s.log, { seq: s.seq, t: s.clock, text: BREAKS.find((x) => x.id === a.id)!.text, tone: "warn" }];
      return s;
    }
    case "ping":
      return runPing(s0, a.count);
    case "iperf":
      return runIperf(s0, !!a.reverse);
    case "wait": {
      const s = cl(s0);
      const v = l1View(s);
      traffic(s, a.secs);
      s.tests = [...s.tests, { id: s.tests.length + 1, kind: "wait" as const, t0: s0.clock, secs: a.secs, cfgSeq: s.cfgSeq }].slice(-40);
      pushRun(s, `${a.secs} s of production traffic`, "wait", [{ tokens: v.uplink.up ? [{ from: "ACCESS-SW", to: "DIST-SW", label: "traffic", color: "#22d3ee" }, { from: "DIST-SW", to: "ACCESS-SW", label: "traffic", color: "#a78bfa", lane: 1 }] : [], lines: [{ text: `${a.secs} s of production traffic crossed the network.`, tone: "info" }], bad: badLinks(v) }], true);
      s.log = [...s.log, { seq: s.seq, t: s.clock, text: `${a.secs} s of traffic.`, tone: "info" }];
      return s;
    }
    case "snapshot": {
      const s = cl(s0);
      s.snaps = [...s.snaps, { t: s.clock, cfgSeq: s.cfgSeq, label: a.label ?? `#${s.snaps.length + 1}`, c: spClone(s.swc) }].slice(-20);
      s.log = [...s.log, { seq: s.seq, t: s.clock, text: `Counter snapshot ${a.label ?? `#${s.snaps.length}`} taken.`, tone: "info" }];
      return s;
    }
    case "clear-stats": {
      const s = cl(s0);
      for (const ifn of a.ifn ? [a.ifn] : SW_IFS[a.dev]) s.cleared[`${a.dev}:${ifn}`] = { ...s.swc[`${a.dev}:${ifn}`], at: s.clock };
      s.clearedOnce = true;
      s.log = [...s.log, { seq: s.seq, t: s.clock, text: `${a.dev}: interface statistics cleared${a.ifn ? ` on ${a.ifn}` : ""}.`, tone: "info", dev: a.dev }];
      return s;
    }
    case "tdr": {
      const s = cl(s0);
      const before = l1View(s);
      s.clock += 3;
      s.tdr = { ...s.tdr, [a.dev]: { t: s.clock, open: a.dev === "ACCESS-SW" && s.phys.clientPair } };
      // A TDR test interrupts the link for a moment.
      linkEvents(s, before, false, a.dev === "ACCESS-SW" ? "client" : "server");
      s.log = [...s.log, { seq: s.seq, t: s.clock, text: `${a.dev}: TDR cable test on ${IF_HOST[a.dev]} (the link drops for a moment).`, tone: "info", dev: a.dev }];
      return s;
    }
    case "ticket":
      return l1TicketState(a.id, s0.seq + 1);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Reading the evidence
// ---------------------------------------------------------------------------------------------------------------
export const swCtr = (s: L1State, key: string): SwCounters => {
  const c = s.swc[key];
  const b = s.cleared[key];
  return { inPkts: c.inPkts - b.inPkts, outPkts: c.outPkts - b.outPkts, crc: c.crc - b.crc, runts: c.runts - b.runts, carrier: c.carrier - b.carrier };
};
export const lastTest = (s: L1State, kind?: L1Test["kind"]) => [...s.tests].reverse().find((t) => !kind || t.kind === kind);
/** The last two snapshots and their difference. */
export function snapDelta(s: L1State): { a: L1Snapshot; b: L1Snapshot; secs: number; d: Record<string, SwCounters> } | undefined {
  if (s.snaps.length < 2) return undefined;
  const [a, b] = s.snaps.slice(-2);
  const d: Record<string, SwCounters> = {};
  for (const k of SW_KEYS) d[k] = { inPkts: b.c[k].inPkts - a.c[k].inPkts, outPkts: b.c[k].outPkts - a.c[k].outPkts, crc: b.c[k].crc - a.c[k].crc, runts: b.c[k].runts - a.c[k].runts, carrier: b.c[k].carrier - a.c[k].carrier };
  return { a, b, secs: b.t - a.t, d };
}
export function testText(t: L1Test): string {
  if (t.kind === "wait") return `${t.secs} s of traffic`;
  if (t.kind === "ping") return t.unreachable ? `ping ×${t.sent}: Destination Host Unreachable (100% loss)` : `ping ×${t.sent}: ${t.recv}/${t.sent} replies, ${Math.round((100 * (t.sent! - t.recv!)) / t.sent!)}% loss${t.lost?.length ? ` (lost seq ${t.lost.slice(0, 4).join(", ")})` : ""}`;
  return t.unreachable ? `iperf3 ${t.reverse ? "download" : "upload"}: unable to connect` : `iperf3 ${t.reverse ? "download" : "upload"}: ${t.mbps} Mbits/sec, ${t.retr} retransmissions`;
}
export const dbmText = (x: number) => (x <= LOS_DBM ? "no light" : `${x.toFixed(2)} dBm`);

export const L1_CAUSES: { id: string; label: string }[] = [
  { id: "dirty", label: "Attenuation on the DIST → ACCESS fiber path (dirty connector)" },
  { id: "duplex", label: "Speed/duplex mismatch on CLIENT's port" },
  { id: "admin", label: "SERVER's switch port is administratively disabled" },
  { id: "los", label: "No light reaches ACCESS-SW: the DIST → ACCESS strand is broken" },
  { id: "copper", label: "CLIENT's copper cable is damaged: the link downshifted to 100 Mb/s" },
  { id: "disttx", label: "DIST-SW's transmitter (laser) is failing" },
  { id: "vlan", label: "A VLAN is missing on the uplink" },
  { id: "nic", label: "SERVER's NIC driver is faulty" },
];
export function l1CauseFeedback(s: L1State, cause: string): { right: boolean; text: string } {
  const t = s.ticket as L1TicketId | undefined;
  const v = l1View(s);
  const yes: Record<L1TicketId, string> = {
    dirty: `Yes. ${UPLINK} is UP, yet ACCESS-SW receives ${dbmText(v.uplink.rxA)} where its baseline was -6.30 dBm, while DIST-SW still transmits a normal ${dbmText(v.uplink.txD)} — the light is lost on the DIST → ACCESS path. Marginal light makes the receiver misread bits: CRC errors rise only on ACCESS-SW ${UPLINK} (+${WINDOW_CRC_FAULT} per ${WINDOW_S} s), DIST-SW's side stays at +0, and only traffic toward CLIENT suffers (downloads crawl, uploads don't).`,
    duplex: "Yes. ACCESS-SW ge-0/0/1 is forced to 100 Mb/s full duplex with auto-negotiation off. CLIENT still auto-negotiates, hears no negotiation, parallel-detects 100 Mb/s — and must assume half duplex. The full-duplex side counts CRC/align errors and runts, the half-duplex side late collisions; throughput collapses in both directions.",
    admin: "Yes. DIST-SW ge-0/0/2 is configured with `disable`: Junos shows it Administratively down / Physical link is Down, and SERVER reports Link detected: no. The cable is fine — the switch port is switched off in configuration.",
    los: `Yes. ACCESS-SW ${UPLINK} receives no light at all (Rx loss-of-signal alarm) while DIST-SW keeps transmitting ${dbmText(v.uplink.txD)} — the DIST → ACCESS strand is broken. DIST-SW sees remote fault and takes the link down too, so both ends show Down although both are enabled.`,
    copper: "Yes. CLIENT's link came up at 100 Mb/s full duplex although both ends advertise 1000BASE-T: gigabit needs all four pairs, and the TDR test on ACCESS-SW ge-0/0/1 shows pair 4-5 open. The PHYs downshift to 100BASE-TX (two pairs) — no errors, just a 94 Mbit/s ceiling.",
  };
  if (cause === t) return { right: true, text: yes[t] };
  const no: Record<string, string> = {
    dirty: rxBand(v.uplink.rxA) === "normal" ? `ACCESS-SW receives ${dbmText(v.uplink.rxA)}, a normal level, and its CRC counter isn't moving.` : "The uplink light is degraded — but does that explain this ticket's evidence?",
    duplex: v.client.mismatch ? "There is a duplex mismatch — but is it this ticket's cause?" : `CLIENT's link is ${v.client.up ? `${v.client.speed} Mb/s ${v.client.hostDuplex} duplex at both ends` : "down"} — no duplex mismatch.`,
    admin: v.server.adminDown ? "DIST-SW ge-0/0/2 is disabled — but look at what this ticket shows." : "DIST-SW ge-0/0/2 is enabled (no `disable` in its configuration).",
    los: v.uplink.rxA <= LOS_DBM ? "There is no light at ACCESS-SW — but is that this ticket?" : `ACCESS-SW receives ${dbmText(v.uplink.rxA)}: light is arriving.`,
    copper: v.client.downshift ? "CLIENT's link downshifted — but is that this ticket's evidence?" : `CLIENT's link runs at ${v.client.speed} Mb/s and a TDR shows all pairs normal.`,
    disttx: `DIST-SW's own transmit level is ${dbmText(v.uplink.txD)} — normal. A failing laser shows low Tx at its own end.`,
    vlan: "Frames that arrive with a good FCS are switched normally, and Layer 1 evidence already explains the symptom; a VLAN problem drops every frame of that VLAN cleanly, without CRC errors or link changes.",
    nic: "SERVER's counters show no receive errors and its link is clean; the evidence points at the network side of the link.",
  };
  return { right: false, text: no[cause] ?? "That doesn't match the evidence." };
}
export function l1Proofs(s: L1State): { label: string; ok: boolean; detail: string }[] {
  const t = s.ticket as L1TicketId | undefined;
  if (!t) return [];
  const v = l1View(s);
  const fresh = s.tests.filter((x) => x.cfgSeq === s.cfgSeq);
  const pingOk = fresh.some((x) => x.kind === "ping" && !x.unreachable && x.recv === x.sent && (x.sent ?? 0) >= 4);
  const ping100 = fresh.some((x) => x.kind === "ping" && x.sent! >= 100 && x.recv === x.sent);
  const iperfOk = fresh.some((x) => x.kind === "iperf" && (x.mbps ?? 0) >= IPERF_GOOD);
  const fs = s.snaps.filter((x) => x.cfgSeq === s.cfgSeq);
  const cleanDelta = (key: string) => fs.length >= 2 && fs[fs.length - 1].t - fs[fs.length - 2].t >= WINDOW_S && fs[fs.length - 1].c[key].crc === fs[fs.length - 2].c[key].crc && fs[fs.length - 1].c[key].inPkts > fs[fs.length - 2].c[key].inPkts;
  switch (t) {
    case "dirty":
      return [
        { label: `ACCESS-SW ${UPLINK} receive level back in the normal band`, ok: rxBand(v.uplink.rxA) === "normal", detail: `show interfaces diagnostics optics ${UPLINK}` },
        { label: `Two fresh snapshots ≥ ${WINDOW_S} s apart: CRC +0 with traffic flowing`, ok: cleanDelta(`ACCESS-SW:${UPLINK}`), detail: "snapshot · wait 30 s · snapshot" },
        { label: "A fresh 100-ping test: 0% loss", ok: ping100, detail: "ping -c 100 -q after the fix" },
      ];
    case "duplex":
      return [
        { label: "CLIENT's link: 1000 Mb/s full duplex at both ends, auto-negotiated", ok: v.client.up && v.client.speed === 1000 && !v.client.mismatch && v.client.swAuto, detail: "ethtool eth0 · show interfaces ge-0/0/1" },
        { label: `A fresh iperf3 test ≥ ${IPERF_GOOD} Mbits/sec`, ok: iperfOk, detail: "iperf3 after the fix" },
      ];
    case "admin":
      return [
        { label: "DIST-SW ge-0/0/2 enabled and up", ok: !v.server.adminDown && v.server.up, detail: "show interfaces terse" },
        { label: "A fresh ping: every reply received", ok: pingOk, detail: "ping after the fix" },
      ];
    case "los":
      return [
        { label: `${UPLINK} up at both ends, ACCESS-SW receive level normal`, ok: v.uplink.up && rxBand(v.uplink.rxA) === "normal", detail: "show interfaces diagnostics optics" },
        { label: "A fresh ping: every reply received", ok: pingOk, detail: "ping after the fix" },
      ];
    case "copper":
      return [
        { label: "CLIENT's link at 1000 Mb/s (no downshift)", ok: v.client.up && v.client.speed === 1000 && !v.client.downshift, detail: "ethtool eth0" },
        { label: `A fresh iperf3 test ≥ ${IPERF_GOOD} Mbits/sec`, ok: iperfOk, detail: "iperf3 after the fix" },
      ];
  }
}
export function l1Ladder(s: L1State): { k: string; title: string; text: string }[] {
  const v = l1View(s);
  const t = [...s.tests].reverse().find((x) => x.kind !== "wait");
  const d = snapDelta(s);
  const cu = (n: string, l: CopperLink) => (l.up ? `${n} up, ${l.speed} Mb/s, switch ${l.swDuplex} / host ${l.hostDuplex}${l.mismatch ? " — MISMATCH" : ""}${l.downshift ? " — downshifted" : ""}` : `${n} DOWN (${l.why})`);
  return [
    { k: "symptom", title: "What does the user see?", text: t ? testText(t) : "Run a ping or an iperf3 test first." },
    { k: "state", title: "Admin and operational state of every link?", text: [cu("CLIENT link", v.client), v.uplink.up ? `uplink up` : `uplink DOWN (${v.uplink.why})`, cu("SERVER link", v.server)].join(" · ") },
    { k: "optics", title: "Light in both directions?", text: `ACCESS Rx ${dbmText(v.uplink.rxA)} (${rxBand(v.uplink.rxA)}) · DIST Tx ${dbmText(v.uplink.txD)} · DIST Rx ${dbmText(v.uplink.rxD)} (${rxBand(v.uplink.rxD)})` },
    { k: "counters", title: "Are errors rising now (deltas)?", text: d ? `last ${d.secs} s: ACCESS ${UPLINK} CRC +${d.d[`ACCESS-SW:${UPLINK}`].crc}, DIST ${UPLINK} CRC +${d.d[`DIST-SW:${UPLINK}`].crc}, ACCESS ge-0/0/1 CRC +${d.d["ACCESS-SW:ge-0/0/1"].crc} / runts +${d.d["ACCESS-SW:ge-0/0/1"].runts}` : "take two snapshots with traffic in between" },
    { k: "negotiation", title: "Speed and duplex agree at both ends?", text: v.client.mismatch || v.server.mismatch ? "no — a duplex mismatch" : v.client.downshift ? "agree, but CLIENT's link downshifted to 100 Mb/s" : "yes" },
    { k: "proof", title: "Fresh evidence after the change?", text: s.ticket ? `${l1Proofs(s).filter((p) => p.ok).length}/${l1Proofs(s).length} proofs met` : "open a ticket to prove a repair" },
  ];
}
