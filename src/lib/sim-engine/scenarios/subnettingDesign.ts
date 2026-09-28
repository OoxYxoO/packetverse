import type { PacketVisual, PVEvent, PVEventType, ScenarioStep } from "../types";
import type { ProcessingStage } from "@/components/network3d/types";
import type { FundHop } from "@/components/lesson/fundamentalsTrace";
import { fieldOf, icmpPacket, ipToNum, numToIp, packetStack, type IcmpEcho } from "./fundamentalsPackets";

/**
 * Subnetting Design Lab — design an address plan (VLSM) from real host requirements, then prove it with packets.
 * Deliberately distinct from IPv4 Addressing & Subnetting (which explains a single /26 boundary): here the learner
 * sizes four networks, places them largest-first on aligned CIDR boundaries inside 10.44.0.0/24, rejects an
 * overlapping proposal, and verifies the deployed plan with ICMP Echo traffic through R1's connected prefixes.
 * Classless (RFC 4632) arithmetic only — no classful reasoning. /30 is the conventional 2-host choice here; RFC 3021
 * /31 is Deep-Dive context only.
 */

export const PARENT = { network: "10.44.0.0", prefix: 24 } as const;
export type SegId = "LAN-A" | "LAN-B" | "LAN-C" | "TRANSIT";
export const SEGMENTS: { id: SegId; hosts: number; label: string }[] = [
  { id: "LAN-A", hosts: 100, label: "LAN-A (100 hosts)" },
  { id: "LAN-B", hosts: 50, label: "LAN-B (50 hosts)" },
  { id: "LAN-C", hosts: 25, label: "LAN-C (25 hosts)" },
  { id: "TRANSIT", hosts: 2, label: "R1 ↔ R2 transit (2 hosts)" },
];

// ---------------------------------------------------------------------------------------------------------------
// Pure CIDR / VLSM arithmetic
// ---------------------------------------------------------------------------------------------------------------
export const blockSize = (prefix: number) => 2 ** (32 - prefix);
export const maskOf = (prefix: number) => numToIp((0xffffffff - (blockSize(prefix) - 1)) >>> 0);
/** Ordinary usable hosts (network + broadcast reserved) — valid for /30 and shorter only. */
export const usableHosts = (prefix: number) => blockSize(prefix) - 2;
/** Smallest prefix (≤ /30) whose ordinary host capacity covers `hosts`. */
export function prefixFor(hosts: number): { prefix: number; hostBits: number } {
  let hostBits = 2;
  while (2 ** hostBits - 2 < hosts) hostBits++;
  return { prefix: 32 - hostBits, hostBits };
}
export const isAligned = (network: string, prefix: number) => ipToNum(network) % blockSize(prefix) === 0;
/** The real network that contains `address` for this prefix (address AND mask). */
export const containingNetwork = (address: string, prefix: number) => numToIp(ipToNum(address) - (ipToNum(address) % blockSize(prefix)));
export interface Range {
  first: number;
  last: number;
}
export const rangeOf = (network: string, prefix: number): Range => ({ first: ipToNum(network), last: ipToNum(network) + blockSize(prefix) - 1 });
export const overlaps = (a: Range, b: Range) => a.first <= b.last && b.first <= a.last;
export function describe(network: string, prefix: number) {
  const r = rangeOf(network, prefix);
  return { network, prefix, mask: maskOf(prefix), block: blockSize(prefix), usable: usableHosts(prefix), firstHost: numToIp(r.first + 1), lastHost: numToIp(r.last - 1), broadcast: numToIp(r.last) };
}

export interface Allocation {
  id: SegId;
  hosts: number;
  /** Set once sized. */
  prefix?: number;
  /** Set once placed. */
  network?: string;
}
export type CandidateVerdict = "ok" | "misaligned" | "too-small" | "overlap" | "outside-parent";
export interface CandidateCheck {
  network: string;
  prefix: number;
  verdict: CandidateVerdict;
  reason: string;
  /** For a misaligned address: the network it actually belongs to. */
  actualNetwork?: string;
  overlapsWith?: SegId;
}
/** Evaluate a proposed network for `seg` against the rest of the plan — never silently normalizes. */
export function checkCandidate(plan: Allocation[], seg: SegId, network: string, prefix: number): CandidateCheck {
  const need = plan.find((a) => a.id === seg)?.hosts ?? 0;
  const parent = rangeOf(PARENT.network, PARENT.prefix);
  if (!isAligned(network, prefix)) {
    const actual = containingNetwork(network, prefix);
    return { network, prefix, verdict: "misaligned", actualNetwork: actual, reason: `${network} is not on a /${prefix} boundary (blocks of ${blockSize(prefix)}); it is a host address inside ${actual}/${prefix}.` };
  }
  const r = rangeOf(network, prefix);
  if (r.first < parent.first || r.last > parent.last) return { network, prefix, verdict: "outside-parent", reason: `${network}/${prefix} is outside the parent ${PARENT.network}/${PARENT.prefix}.` };
  if (usableHosts(prefix) < need) return { network, prefix, verdict: "too-small", reason: `/${prefix} gives ${usableHosts(prefix)} ordinary hosts; ${seg} needs ${need}.` };
  const clash = plan.find((a) => a.id !== seg && a.network && a.prefix !== undefined && overlaps(r, rangeOf(a.network, a.prefix)));
  if (clash?.network && clash.prefix !== undefined) {
    const cr = rangeOf(clash.network, clash.prefix);
    return { network, prefix, verdict: "overlap", overlapsWith: clash.id, reason: `${network}/${prefix} (${numToIp(r.first)}–${numToIp(r.last)}) overlaps ${clash.id} ${clash.network}/${clash.prefix} (${numToIp(cr.first)}–${numToIp(cr.last)}).` };
  }
  return { network, prefix, verdict: "ok", reason: `${network}/${prefix} is aligned, inside the parent, large enough and overlaps nothing.` };
}
/** Largest-first VLSM: each network goes to the lowest free, aligned block. */
export function planLargestFirst(segs: { id: SegId; hosts: number }[]): Allocation[] {
  const sorted = [...segs].sort((a, b) => b.hosts - a.hosts);
  const out: Allocation[] = segs.map((s) => ({ ...s }));
  for (const s of sorted) {
    const { prefix } = prefixFor(s.hosts);
    const parent = rangeOf(PARENT.network, PARENT.prefix);
    for (let n = parent.first; n + blockSize(prefix) - 1 <= parent.last; n += blockSize(prefix)) {
      if (checkCandidate(out, s.id, numToIp(n), prefix).verdict === "ok") {
        const a = out.find((x) => x.id === s.id)!;
        a.prefix = prefix;
        a.network = numToIp(n);
        break;
      }
    }
  }
  return out;
}
/** Free address space left in the parent, as address ranges (not as fake prefixes). */
export function freeRanges(plan: Allocation[]): Range[] {
  const used = plan.filter((a) => a.network && a.prefix !== undefined).map((a) => rangeOf(a.network!, a.prefix!)).sort((a, b) => a.first - b.first);
  const parent = rangeOf(PARENT.network, PARENT.prefix);
  const free: Range[] = [];
  let cur = parent.first;
  for (const u of used) {
    if (u.first > cur) free.push({ first: cur, last: u.first - 1 });
    cur = Math.max(cur, u.last + 1);
  }
  if (cur <= parent.last) free.push({ first: cur, last: parent.last });
  return free;
}
/** Split a free range into the largest aligned CIDR blocks it contains (for "what could still be allocated"). */
export function alignedBlocks(r: Range): { network: string; prefix: number }[] {
  const out: { network: string; prefix: number }[] = [];
  let cur = r.first;
  while (cur <= r.last) {
    let size = 1;
    while (cur % (size * 2) === 0 && cur + size * 2 - 1 <= r.last) size *= 2;
    out.push({ network: numToIp(cur), prefix: 32 - Math.log2(size) });
    cur += size;
  }
  return out;
}

/** The correct design, derived — never hand-typed. */
export const CORRECT_PLAN = planLargestFirst(SEGMENTS);
const netOf = (id: SegId) => CORRECT_PLAN.find((a) => a.id === id)!;

// ---------------------------------------------------------------------------------------------------------------
// Topology addressing (from the designed plan)
// ---------------------------------------------------------------------------------------------------------------
export type SdDevice = "HOST-A" | "HOST-B" | "HOST-C" | "R1" | "R2";
export const SD_DEVICES: SdDevice[] = ["HOST-A", "HOST-B", "HOST-C", "R1", "R2"];
const hostIp = (id: SegId, offset: number) => numToIp(ipToNum(netOf(id).network!) + offset);
export const SD_ADDR = {
  "R1:LAN-A": hostIp("LAN-A", 1),
  "HOST-A": hostIp("LAN-A", 10),
  "R1:LAN-B": hostIp("LAN-B", 1),
  "HOST-B": hostIp("LAN-B", 2),
  "R1:LAN-C": hostIp("LAN-C", 1),
  "HOST-C": hostIp("LAN-C", 2),
  "R1:TRANSIT": hostIp("TRANSIT", 1),
  "R2:TRANSIT": hostIp("TRANSIT", 2),
} as const;
export const SD_MAC = { "HOST-A": "00:00:5E:00:53:1A", "HOST-B": "00:00:5E:00:53:1B", "HOST-C": "00:00:5E:00:53:1C", "R1:LAN-A": "00:00:5E:00:53:11", "R1:LAN-B": "00:00:5E:00:53:12", "R1:LAN-C": "00:00:5E:00:53:13", "R1:TRANSIT": "00:00:5E:00:53:14", "R2:TRANSIT": "00:00:5E:00:53:21" } as const;
export const R1_IFACE: Record<SegId, string> = { "LAN-A": "ge-0/0/1", "LAN-B": "ge-0/0/2", "LAN-C": "ge-0/0/3", TRANSIT: "ge-0/0/0" };
export const HOST_SEG: Record<"HOST-A" | "HOST-B" | "HOST-C", SegId> = { "HOST-A": "LAN-A", "HOST-B": "LAN-B", "HOST-C": "LAN-C" };

// ---------------------------------------------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------------------------------------------
export interface SdState {
  hops: FundHop[];
  plan: Allocation[];
  /** Interfaces actually configured on R1 (segment → network/prefix). */
  deployed: Partial<Record<SegId, { network: string; prefix: number }>>;
  candidate?: CandidateCheck & { seg: SegId };
  packet?: PacketVisual;
  flood: { id: string; fromId: string; toId: string; packet: PacketVisual }[];
  note?: { device: SdDevice; text: string };
  faultActive: boolean;
  repairAttempt?: { choice: string; correct: boolean };
  repaired: boolean;
}
export const createSdState = (): SdState => ({ hops: [], plan: SEGMENTS.map((s) => ({ id: s.id, hosts: s.hosts })), deployed: {}, flood: [], faultActive: false, repaired: false });

const withPlan = (s: SdState, id: SegId, patch: Partial<Allocation>): Allocation[] => s.plan.map((a) => (a.id === id ? { ...a, ...patch } : a));
const ev = (type: PVEventType, stepId: string, message: string): PVEvent => ({ type, stepId, timestamp: Date.now(), message });
const push = (s: SdState, hop: FundHop, patch: Partial<SdState> = {}): SdState => ({ ...s, ...patch, hops: [...s.hops, hop] });
const idle = (s: SdState): SdState => ({ ...s, packet: undefined, flood: [], note: undefined });

// ---------------------------------------------------------------------------------------------------------------
// Stages + device steps
// ---------------------------------------------------------------------------------------------------------------
export const PLAN_STAGES: ProcessingStage[] = [
  { id: "need", label: "Hosts needed" },
  { id: "bits", label: "Host bits: 2^h − 2 ≥ hosts" },
  { id: "prefix", label: "Prefix = 32 − h" },
  { id: "place", label: "Lowest free aligned block" },
  { id: "verify", label: "No overlap · inside the parent" },
];
export const ROUTER_STAGES: ProcessingStage[] = [
  { id: "rx", label: "Receive · dst MAC is mine" },
  { id: "lookup", label: "Connected-prefix lookup" },
  { id: "ttl", label: "TTL − 1 · new header checksum" },
  { id: "tx", label: "New Ethernet frame out the egress interface" },
];
export const HOST_STAGES: ProcessingStage[] = [
  { id: "and", label: "Destination on my prefix?" },
  { id: "gw", label: "Off-link → default gateway" },
  { id: "tx", label: "Send ICMP Echo Request" },
];
export const HOST_RX_STAGES: ProcessingStage[] = [
  { id: "rx", label: "Receive · IPv4 destination is mine" },
  { id: "deliver", label: "Hand ICMP to the stack" },
];
const withDetail = (base: ProcessingStage[], d: Partial<Record<string, string>>): ProcessingStage[] => base.map((x) => (d[x.id] ? { ...x, detail: d[x.id] } : x));

function planHop(stepId: string, a: Allocation, active: string): FundHop {
  const { hostBits } = prefixFor(a.hosts);
  const d = a.network && a.prefix !== undefined ? describe(a.network, a.prefix) : undefined;
  return {
    stepId,
    device: "R1",
    stages: withDetail(PLAN_STAGES, {
      need: `${a.id}: ${a.hosts} hosts`,
      bits: `h = ${hostBits}: 2^${hostBits} − 2 = ${2 ** hostBits - 2}`,
      prefix: `/${32 - hostBits} (${maskOf(32 - hostBits)})`,
      ...(d ? { place: `${d.network}/${d.prefix}`, verify: `${d.firstHost}–${d.lastHost} · bc ${d.broadcast}` } : {}),
    }),
    activeStageId: active,
    lookupType: "Address plan",
    lookupKey: `${a.id} · ${a.hosts} hosts`,
    lookupResult: d ? `${d.network}/${d.prefix} · ${d.usable} usable` : `/${32 - hostBits} · ${2 ** hostBits - 2} usable`,
    action: d ? "PLACE" : "SIZE",
    reason: d ? `${a.id} takes ${d.network}/${d.prefix}: the lowest free block on a ${d.block}-address boundary.` : `${a.hosts} hosts need ${hostBits} host bits (2^${hostBits} − 2 = ${2 ** hostBits - 2}); the smaller /${33 - hostBits} would give only ${2 ** (hostBits - 1) - 2}.`,
    input: `${a.hosts} hosts`,
    output: d ? `${d.network}/${d.prefix}` : `/${32 - hostBits}`,
  };
}

const HOSTS = ["HOST-A", "HOST-B", "HOST-C"] as const;
type Host = (typeof HOSTS)[number];
const ECHO_ID = 0x5d10;

function echo(stepId: string, from: SdDevice, to: SdDevice, srcIp: string, dstIp: string, ethSrc: string, ethDst: string, ttl: number, seq: number, reply = false): PacketVisual {
  const icmp: IcmpEcho = { kind: reply ? "echo-reply" : "echo-request", identifier: ECHO_ID, sequence: seq, dataLength: 56 };
  return icmpPacket({ id: `${stepId}-${from}-${to}`, from, to, ethSrc, ethDst, ip: { src: srcIp, dst: dstIp, ttl, id: 0x2a00 + seq, df: false }, icmp });
}

function hostSend(s: SdState, stepId: string, host: Host, dstIp: string, seq: number): SdState {
  const seg = HOST_SEG[host];
  const gw = SD_ADDR[`R1:${seg}` as keyof typeof SD_ADDR];
  const own = describe(netOf(seg).network!, netOf(seg).prefix!);
  const pkt = echo(stepId, host, "R1", SD_ADDR[host], dstIp, SD_MAC[host], SD_MAC[`R1:${seg}` as keyof typeof SD_MAC], 64, seq);
  const hop: FundHop = {
    stepId,
    device: host,
    stages: withDetail(HOST_STAGES, { and: `${dstIp} not in ${own.network}/${own.prefix}`, gw: `gateway ${gw}`, tx: `Echo Request seq ${seq}` }),
    activeStageId: "tx",
    egressInterfaceId: "eth0",
    lookupType: "On-link test",
    lookupKey: `${dstIp} vs ${own.network}/${own.prefix}`,
    lookupResult: `off-link → gateway ${gw}`,
    action: "SEND ECHO",
    reason: `${dstIp} is outside ${host}'s ${own.network}/${own.prefix}, so the frame goes to R1 (${gw}); the IPv4 destination stays ${dstIp}.`,
    input: "(originated here)",
    output: `Echo Request → ${dstIp}`,
    nextHopId: "R1",
    after: packetStack(pkt),
  };
  return push(s, hop, { packet: pkt, flood: [], note: { device: host, text: `${host}: off-link → gateway ${gw}` } });
}

/** R1 forwards a packet using only its connected prefixes. */
function r1Forward(s: SdState, stepId: string, inPkt: PacketVisual): SdState {
  const src = fieldOf(inPkt, /^IPv4/, "Source");
  const dst = fieldOf(inPkt, /^IPv4/, "Destination");
  const ttl = Number(fieldOf(inPkt, /^IPv4/, "TTL"));
  const seg = (Object.keys(s.deployed) as SegId[]).find((k) => { const d = s.deployed[k]!; const r = rangeOf(d.network, d.prefix); const n = ipToNum(dst); return n >= r.first && n <= r.last; });
  const inSeg = (Object.keys(s.deployed) as SegId[]).find((k) => { const d = s.deployed[k]!; const r = rangeOf(d.network, d.prefix); const n = ipToNum(src); return n >= r.first && n <= r.last; });
  const to = (seg === "TRANSIT" ? "R2" : HOSTS.find((h) => HOST_SEG[h] === seg)) as SdDevice;
  const dstMac = seg === "TRANSIT" ? SD_MAC["R2:TRANSIT"] : SD_MAC[to as Host];
  const d = seg ? s.deployed[seg]! : undefined;
  const seq = Number(fieldOf(inPkt, /^ICMP/, "Sequence Number"));
  const out = echo(stepId, "R1", to, src, dst, SD_MAC[`R1:${seg}` as keyof typeof SD_MAC], dstMac, ttl - 1, seq, fieldOf(inPkt, /^ICMP/, "Type").startsWith("0"));
  const hop: FundHop = {
    stepId,
    device: "R1",
    stages: withDetail(ROUTER_STAGES, { rx: `on ${inSeg ? R1_IFACE[inSeg] : "?"}`, lookup: d ? `${dst} ∈ ${d.network}/${d.prefix} (connected, ${R1_IFACE[seg!]})` : "no route", ttl: `TTL ${ttl} → ${ttl - 1}`, tx: `out ${seg ? R1_IFACE[seg] : "—"}` }),
    activeStageId: "tx",
    ingressInterfaceId: inSeg ? R1_IFACE[inSeg] : undefined,
    egressInterfaceId: seg ? R1_IFACE[seg] : undefined,
    lookupType: "Connected prefixes",
    lookupKey: dst,
    lookupResult: d ? `${d.network}/${d.prefix} via ${R1_IFACE[seg!]}` : "no route",
    action: "FORWARD",
    reason: `${dst} falls inside the designed ${seg} prefix ${d?.network}/${d?.prefix}, which is directly connected on ${seg ? R1_IFACE[seg] : "?"}. No routing protocol is needed.`,
    input: `${src} → ${dst} · TTL ${ttl}`,
    output: `${src} → ${dst} · TTL ${ttl - 1} out ${seg ? R1_IFACE[seg] : "?"}`,
    nextHopId: to,
    before: packetStack(inPkt),
    after: packetStack(out, ["eth", "ip"]),
    mutations: [{ type: "TTL_CHANGE", detail: `${ttl} → ${ttl - 1}` }, { type: "SA_CHANGE", detail: `→ R1 ${seg ? R1_IFACE[seg] : ""}` }, { type: "DA_CHANGE", detail: `→ ${to}` }],
  };
  return push(s, hop, { packet: out, flood: [], note: { device: "R1", text: `R1: ${dst} ∈ ${d?.network}/${d?.prefix} (connected)` } });
}

function deployHop(stepId: string, plan: Allocation[], rejected?: { seg: SegId; check: CandidateCheck }): FundHop {
  return {
    stepId,
    device: "R1",
    stages: [
      { id: "load", label: "Load interface addresses", detail: rejected ? `${rejected.seg}: ${rejected.check.network}/${rejected.check.prefix}` : "4 interfaces" },
      { id: "check", label: "Check for overlapping subnets", detail: rejected ? `overlaps ${rejected.check.overlapsWith}` : "no overlap" },
      { id: "commit", label: "Install connected prefixes", detail: rejected ? "REJECTED" : plan.map((a) => `${a.network}/${a.prefix}`).join(", ") },
    ],
    activeStageId: rejected ? "check" : "commit",
    lookupType: "Interface configuration",
    lookupKey: rejected ? `${rejected.seg} ${rejected.check.network}/${rejected.check.prefix}` : "address plan",
    lookupResult: rejected ? rejected.check.reason : "all prefixes unique",
    action: rejected ? "CONFIG REJECTED" : "CONFIGURE",
    reason: rejected ? "A router will not put two interfaces into overlapping subnets: an address in the shared range would belong to two links at once." : "Each segment's first usable address becomes R1's interface address and every prefix becomes a connected route.",
    input: rejected ? "revised plan" : "approved plan",
    output: rejected ? "configuration refused" : "connected routes installed",
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Repair
// ---------------------------------------------------------------------------------------------------------------
export const SD_FAULT_LAN_C = { network: "10.44.0.160", prefix: 27 };
export const SD_REPAIR_OPTIONS = [
  { id: "c-160-27", network: "10.44.0.160", prefix: 27, label: "10.44.0.160/27" },
  { id: "c-200-27", network: "10.44.0.200", prefix: 27, label: "10.44.0.200/27" },
  { id: "c-192-28", network: "10.44.0.192", prefix: 28, label: "10.44.0.192/28" },
  { id: "c-192-27", network: "10.44.0.192", prefix: 27, label: "10.44.0.192/27" },
] as const;
export const SD_REPAIR_CORRECT = "c-192-27";
export function applySdRepair(s: SdState, choice: string): SdState {
  const o = SD_REPAIR_OPTIONS.find((x) => x.id === choice);
  if (!o) return s;
  const check = checkCandidate(s.plan, "LAN-C", o.network, o.prefix);
  const correct = check.verdict === "ok";
  if (!correct) return { ...s, repairAttempt: { choice, correct }, candidate: { ...check, seg: "LAN-C" } };
  return { ...s, repairAttempt: { choice, correct }, repaired: true, faultActive: false, candidate: { ...check, seg: "LAN-C" }, plan: withPlan(s, "LAN-C", { network: o.network, prefix: o.prefix }), note: { device: "R1", text: `LAN-C → ${o.network}/${o.prefix}` } };
}

// ---------------------------------------------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------------------------------------------
const A = netOf("LAN-A");
const B = netOf("LAN-B");
const C = netOf("LAN-C");
const T = netOf("TRANSIT");
const dA = describe(A.network!, A.prefix!);
const dB = describe(B.network!, B.prefix!);
const dC = describe(C.network!, C.prefix!);
const dT = describe(T.network!, T.prefix!);

function sizeStep(id: string, seg: SegId, label: string, narrative: string): ScenarioStep<SdState> {
  return {
    id,
    label,
    narrative,
    run: (s) => {
      const a = s.plan.find((x) => x.id === seg)!;
      const { prefix } = prefixFor(a.hosts);
      const sized = { ...a, prefix };
      return { state: push({ ...idle(s), plan: withPlan(s, seg, { prefix }) }, planHop(id, sized, "prefix")), events: [ev("STEP_ENTERED", id, `${seg} sized /${prefix}`)] };
    },
    whatChanged: (_p, n) => {
      const a = n.plan.find((x) => x.id === seg)!;
      return [`${seg}: /${a.prefix} · ${blockSize(a.prefix!)} addresses · ${usableHosts(a.prefix!)} usable`];
    },
  };
}
function placeStep(id: string, seg: SegId, label: string, narrative: string): ScenarioStep<SdState> {
  return {
    id,
    label,
    narrative,
    run: (s) => {
      const target = netOf(seg);
      const check = checkCandidate(s.plan, seg, target.network!, target.prefix!);
      const placed = { ...s.plan.find((x) => x.id === seg)!, network: target.network, prefix: target.prefix };
      return { state: push({ ...idle(s), plan: withPlan(s, seg, { network: target.network, prefix: target.prefix }), candidate: { ...check, seg } }, planHop(id, placed, "verify")), events: [ev("STEP_ENTERED", id, `${seg} placed at ${target.network}/${target.prefix}`)] };
    },
    whatChanged: (_p, n) => {
      const a = n.plan.find((x) => x.id === seg)!;
      const d = describe(a.network!, a.prefix!);
      return [`${seg}: ${d.network}/${d.prefix}`, `hosts ${d.firstHost} – ${d.lastHost}`, `broadcast ${d.broadcast}`];
    },
  };
}

export const subnettingDesignSteps: ScenarioStep<SdState>[] = [
  {
    id: "intro",
    label: "One /24, four networks",
    narrative: `You own ${PARENT.network}/${PARENT.prefix} — 256 addresses. Three LANs and one router-to-router link need addresses. The job: carve the block so every network fits, nothing overlaps, and space is left for later.`,
  },
  {
    id: "requirements",
    label: "The requirements",
    narrative: `LAN-A needs 100 hosts, LAN-B 50, LAN-C 25, and the R1 ↔ R2 transit link 2. "Hosts" means addresses for devices — the network and broadcast addresses come on top.`,
  },
  {
    id: "powers-of-two",
    label: "Capacity comes in powers of two",
    narrative: "A subnet with h host bits has 2^h addresses. Two are reserved (all-zeros = network, all-ones = broadcast), so an ordinary subnet holds 2^h − 2 hosts: /30 → 2, /29 → 6, /28 → 14, /27 → 30, /26 → 62, /25 → 126.",
  },
  {
    id: "predict-order",
    label: "Predict: allocation order",
    narrative: "Before sizing anything, decide the order you will place the networks in.",
    question: {
      prompt: "In which order should you place the four networks?",
      options: [
        { id: "largest", label: "Largest first: LAN-A, LAN-B, LAN-C, transit" },
        { id: "smallest", label: "Smallest first: transit, LAN-C, LAN-B, LAN-A" },
        { id: "alpha", label: "Alphabetical — order doesn't matter" },
        { id: "random", label: "Whatever order the requests arrived in" },
      ],
      correctOptionId: "largest",
      explanation: "Big blocks need big boundaries (a /25 must start at .0 or .128). Placing them first keeps every later, smaller block aligned right after it and leaves the free space in one contiguous piece. Small-first scatters small blocks across the big boundaries.",
    },
  },
  {
    id: "largest-first",
    label: "Largest first",
    narrative: "VLSM (variable-length subnet masking) gives each network its own prefix length. Sorting largest-first is what lets the variable sizes pack together without gaps.",
  },
  sizeStep("size-lan-a", "LAN-A", "Size LAN-A", `100 hosts: 2^6 − 2 = 62 is too few, 2^7 − 2 = 126 is enough. 7 host bits → /25 (${maskOf(25)}), 128 addresses.`),
  {
    id: "predict-lan-b",
    label: "Predict: LAN-B's prefix",
    narrative: "LAN-B needs 50 hosts.",
    question: {
      prompt: "Which prefix is the smallest subnet that supports 50 ordinary hosts?",
      options: [
        { id: "26", label: "/26 — 64 addresses, 62 usable" },
        { id: "27", label: "/27 — 32 addresses, 30 usable" },
        { id: "25", label: "/25 — 128 addresses, 126 usable" },
        { id: "24", label: "/24 — the whole block" },
      ],
      correctOptionId: "26",
      explanation: "2^5 − 2 = 30 < 50, 2^6 − 2 = 62 ≥ 50 → 6 host bits → /26. A /25 would work but wastes 64 addresses that LAN-C and the transit link need.",
    },
  },
  sizeStep("size-lan-b", "LAN-B", "Size LAN-B", `50 hosts → 6 host bits (62 usable) → /26 (${maskOf(26)}), 64 addresses.`),
  sizeStep("size-lan-c", "LAN-C", "Size LAN-C", `25 hosts: 2^4 − 2 = 14 is too few, 2^5 − 2 = 30 fits → /27 (${maskOf(27)}), 32 addresses.`),
  sizeStep("size-transit", "TRANSIT", "Size the transit link", `Two router interfaces → 2^2 − 2 = 2 → /30 (${maskOf(30)}), 4 addresses — the conventional choice here. (A /31 point-to-point alternative is covered in the Deep Dive.)`),
  {
    id: "sizing-summary",
    label: "Does it fit?",
    narrative: `128 + 64 + 32 + 4 = 228 of 256 addresses. The design fits, with 28 addresses spare.`,
    run: (s) => ({ state: idle(s), events: [] }),
  },
  placeStep("place-lan-a", "LAN-A", "Place LAN-A", `The first block starts at the parent's first address: ${dA.network}/${dA.prefix} — hosts ${dA.firstHost}–${dA.lastHost}, broadcast ${dA.broadcast}.`),
  placeStep("place-lan-b", "LAN-B", "Place LAN-B", `The next free address is .128. A /26 must start on a multiple of 64 — .128 is one. ${dB.network}/${dB.prefix}: hosts ${dB.firstHost}–${dB.lastHost}, broadcast ${dB.broadcast}.`),
  {
    id: "boundaries-27",
    label: "Where can a /27 start?",
    narrative: "A /27 is 32 addresses, so its network address must be a multiple of 32 in the last octet: .0, .32, .64, .96, .128, .160, .192, .224. Any other value is a host address inside one of those blocks.",
  },
  {
    id: "predict-200",
    label: "Predict: 10.44.0.200/27",
    narrative: "Someone suggests writing LAN-C as 10.44.0.200/27.",
    question: {
      prompt: "Why is 10.44.0.200 not the network address of a /27?",
      options: [
        { id: "boundary", label: "200 is not a multiple of 32 — it's a host inside 10.44.0.192/27" },
        { id: "range", label: "It's fine; any address can start a subnet" },
        { id: "size", label: "A /27 is too small for LAN-C" },
        { id: "class", label: "Because 10.x is a Class A network" },
      ],
      correctOptionId: "boundary",
      explanation: "200 AND 224 (the /27 mask's last octet) = 192. So .200 lives inside 10.44.0.192/27 (.192–.223). A network address has all host bits zero; .200 has host bits 01000.",
    },
  },
  {
    id: "candidate-200",
    label: "The planner explains, never auto-fixes",
    narrative: "The planner flags 10.44.0.200/27 as misaligned and shows the network it actually belongs to. A good tool tells you why; it doesn't silently rewrite your input.",
    run: (s) => {
      const check = checkCandidate(s.plan, "LAN-C", "10.44.0.200", 27);
      return { state: { ...idle(s), candidate: { ...check, seg: "LAN-C" } }, events: [ev("STEP_ENTERED", "candidate-200", "10.44.0.200/27 rejected: misaligned")] };
    },
    whatChanged: (_p, n) => [n.candidate?.reason ?? ""],
  },
  placeStep("place-lan-c", "LAN-C", "Place LAN-C", `Next free address: .192, a valid /27 boundary. ${dC.network}/${dC.prefix}: hosts ${dC.firstHost}–${dC.lastHost}, broadcast ${dC.broadcast}.`),
  placeStep("place-transit", "TRANSIT", "Place the transit link", `Next free: .224, a multiple of 4. ${dT.network}/${dT.prefix}: R1 ${dT.firstHost}, R2 ${dT.lastHost}, broadcast ${dT.broadcast}.`),
  {
    id: "free-space",
    label: "What's left",
    narrative: "10.44.0.228 – 10.44.0.255 (28 addresses) remains. 28 isn't a power of two and .228 isn't on a large boundary, so this is free ADDRESS SPACE, not one subnet. It can still hold aligned blocks: .228/30, .232/29 and .240/28.",
    run: (s) => ({ state: { ...idle(s), candidate: undefined }, events: [] }),
    question: {
      prompt: "Can the remaining 10.44.0.228 – 10.44.0.255 be configured as a single subnet?",
      options: [
        { id: "no", label: "No — 28 addresses on a .228 start is not one aligned CIDR block" },
        { id: "27", label: "Yes, as 10.44.0.228/27" },
        { id: "28", label: "Yes, as 10.44.0.228/28" },
        { id: "any", label: "Yes, any range can be one subnet" },
      ],
      correctOptionId: "no",
      explanation: "A CIDR block has a power-of-two size and starts on a multiple of that size. .228/27 is really .224/27 (overlapping the transit link), and .228/28 is really .224/28. The range splits cleanly into .228/30 + .232/29 + .240/28.",
    },
  },
  {
    id: "plan-review",
    label: "Review the plan",
    narrative: `Final plan: LAN-A ${dA.network}/${dA.prefix}, LAN-B ${dB.network}/${dB.prefix}, LAN-C ${dC.network}/${dC.prefix}, transit ${dT.network}/${dT.prefix}. Every block is aligned, inside the /24, big enough, and none overlap.`,
  },
  {
    id: "deploy",
    label: "Deploy on R1",
    narrative: `R1 gets the first usable address of each segment: ge-0/0/1 ${SD_ADDR["R1:LAN-A"]}/${dA.prefix}, ge-0/0/2 ${SD_ADDR["R1:LAN-B"]}/${dB.prefix}, ge-0/0/3 ${SD_ADDR["R1:LAN-C"]}/${dC.prefix}, ge-0/0/0 ${SD_ADDR["R1:TRANSIT"]}/${dT.prefix}. Each prefix becomes a connected route. R2 takes ${SD_ADDR["R2:TRANSIT"]}/${dT.prefix}.`,
    run: (s) => {
      const deployed = Object.fromEntries(s.plan.map((a) => [a.id, { network: a.network!, prefix: a.prefix! }])) as SdState["deployed"];
      return { state: push({ ...idle(s), deployed }, deployHop("deploy", s.plan)), events: [ev("STEP_ENTERED", "deploy", "R1 configured")] };
    },
    whatChanged: () => ["4 connected prefixes installed on R1", "Hosts use R1's address on their segment as gateway"],
  },
  {
    id: "predict-gateway",
    label: "Predict: HOST-C's gateway",
    narrative: `HOST-C is ${SD_ADDR["HOST-C"]}/${dC.prefix}.`,
    question: {
      prompt: `Which default gateway can HOST-C (${SD_ADDR["HOST-C"]}/${dC.prefix}) use?`,
      options: [
        { id: "c", label: `${SD_ADDR["R1:LAN-C"]} — R1 on LAN-C, inside the same /27` },
        { id: "b", label: `${SD_ADDR["R1:LAN-B"]} — R1 on LAN-B` },
        { id: "t", label: `${SD_ADDR["R1:TRANSIT"]} — R1's transit address` },
        { id: "a", label: `${SD_ADDR["R1:LAN-A"]} — the first address in the /24` },
      ],
      correctOptionId: "c",
      explanation: `A gateway must be on-link: inside the host's own prefix. ${SD_ADDR["HOST-C"]}/${dC.prefix} covers ${dC.firstHost}–${dC.lastHost}, and only ${SD_ADDR["R1:LAN-C"]} of these options is in it.`,
    },
  },
  {
    id: "verify-a-b-send",
    label: "Verify: HOST-A → HOST-B",
    narrative: `HOST-A (${SD_ADDR["HOST-A"]}) pings HOST-B (${SD_ADDR["HOST-B"]}). Different prefixes, so the frame goes to R1.`,
    run: (s) => ({ state: hostSend(s, "verify-a-b-send", "HOST-A", SD_ADDR["HOST-B"], 1), events: [ev("PACKET_SENT", "verify-a-b-send", "HOST-A → HOST-B")] }),
    packet: (s) => s.packet,
  },
  {
    id: "verify-a-b-route",
    label: "R1 → LAN-B",
    narrative: `R1 finds ${SD_ADDR["HOST-B"]} inside ${dB.network}/${dB.prefix}, connected on ge-0/0/2, and forwards it with TTL 63.`,
    run: (s) => ({ state: r1Forward(s, "verify-a-b-route", s.packet!), events: [ev("PACKET_SENT", "verify-a-b-route", "R1 → HOST-B")] }),
    packet: (s) => s.packet,
  },
  {
    id: "verify-b-c-send",
    label: "Verify: HOST-B → HOST-C",
    narrative: `HOST-B pings HOST-C (${SD_ADDR["HOST-C"]}) via its gateway ${SD_ADDR["R1:LAN-B"]}.`,
    run: (s) => ({ state: hostSend(s, "verify-b-c-send", "HOST-B", SD_ADDR["HOST-C"], 2), events: [ev("PACKET_SENT", "verify-b-c-send", "HOST-B → HOST-C")] }),
    packet: (s) => s.packet,
  },
  {
    id: "verify-b-c-route",
    label: "R1 → LAN-C",
    narrative: `${SD_ADDR["HOST-C"]} is inside ${dC.network}/${dC.prefix} on ge-0/0/3.`,
    run: (s) => ({ state: r1Forward(s, "verify-b-c-route", s.packet!), events: [ev("PACKET_SENT", "verify-b-c-route", "R1 → HOST-C")] }),
    packet: (s) => s.packet,
  },
  {
    id: "verify-c-a-send",
    label: "Verify: HOST-C → HOST-A",
    narrative: `HOST-C pings HOST-A (${SD_ADDR["HOST-A"]}) via ${SD_ADDR["R1:LAN-C"]}.`,
    run: (s) => ({ state: hostSend(s, "verify-c-a-send", "HOST-C", SD_ADDR["HOST-A"], 3), events: [ev("PACKET_SENT", "verify-c-a-send", "HOST-C → HOST-A")] }),
    packet: (s) => s.packet,
  },
  {
    id: "verify-c-a-route",
    label: "R1 → LAN-A",
    narrative: `${SD_ADDR["HOST-A"]} is inside ${dA.network}/${dA.prefix} on ge-0/0/1. All three LANs reach each other.`,
    run: (s) => ({ state: r1Forward(s, "verify-c-a-route", s.packet!), events: [ev("PACKET_SENT", "verify-c-a-route", "R1 → HOST-A")] }),
    packet: (s) => s.packet,
  },
  {
    id: "verify-transit",
    label: "Verify: R1 ↔ R2",
    narrative: `R1 (${SD_ADDR["R1:TRANSIT"]}) pings R2 (${SD_ADDR["R2:TRANSIT"]}) across the /30 — the two usable addresses of ${dT.network}/${dT.prefix}.`,
    run: (s) => {
      const pkt = echo("verify-transit", "R1", "R2", SD_ADDR["R1:TRANSIT"], SD_ADDR["R2:TRANSIT"], SD_MAC["R1:TRANSIT"], SD_MAC["R2:TRANSIT"], 64, 4);
      const hop: FundHop = { stepId: "verify-transit", device: "R1", stages: withDetail(HOST_STAGES, { and: `${SD_ADDR["R2:TRANSIT"]} ∈ ${dT.network}/${dT.prefix}`, gw: "on-link — no gateway", tx: "Echo Request seq 4" }), activeStageId: "tx", egressInterfaceId: "ge-0/0/0", lookupType: "Connected prefixes", lookupKey: SD_ADDR["R2:TRANSIT"], lookupResult: `${dT.network}/${dT.prefix} on ge-0/0/0 (on-link)`, action: "SEND ECHO", reason: "R2's address is on R1's own transit prefix, so R1 sends straight to R2's MAC.", input: "(originated here)", output: `Echo Request → ${SD_ADDR["R2:TRANSIT"]}`, nextHopId: "R2", after: packetStack(pkt) };
      return { state: push(s, hop, { packet: pkt, flood: [], note: { device: "R1", text: `R1: ${dT.network}/${dT.prefix} on-link` } }), events: [ev("PACKET_SENT", "verify-transit", "R1 → R2")] };
    },
    packet: (s) => s.packet,
  },
  {
    id: "verify-transit-reply",
    label: "R2 replies",
    narrative: `R2 answers with an Echo Reply from ${SD_ADDR["R2:TRANSIT"]}. The transit /30 works. The plan is verified.`,
    run: (s) => {
      const pkt = echo("verify-transit-reply", "R2", "R1", SD_ADDR["R2:TRANSIT"], SD_ADDR["R1:TRANSIT"], SD_MAC["R2:TRANSIT"], SD_MAC["R1:TRANSIT"], 64, 4, true);
      const hop: FundHop = { stepId: "verify-transit-reply", device: "R2", stages: withDetail(HOST_RX_STAGES, { rx: `to ${SD_ADDR["R2:TRANSIT"]}`, deliver: "Echo Reply sent" }), activeStageId: "deliver", ingressInterfaceId: "ge-0/0/0", egressInterfaceId: "ge-0/0/0", lookupType: "Local delivery", lookupKey: SD_ADDR["R2:TRANSIT"], lookupResult: "local address", action: "ECHO REPLY", reason: "The Echo Request is addressed to R2 itself, so R2 answers with the same identifier and sequence.", input: `Echo Request from ${SD_ADDR["R1:TRANSIT"]}`, output: `Echo Reply → ${SD_ADDR["R1:TRANSIT"]}`, nextHopId: "R1", after: packetStack(pkt) };
      return { state: push(s, hop, { packet: pkt, flood: [], note: { device: "R2", text: "R2: Echo Reply" } }), events: [ev("PACKET_SENT", "verify-transit-reply", "R2 → R1")] };
    },
    packet: (s) => s.packet,
  },
  {
    id: "break-intro",
    label: "Incident: a revised plan",
    narrative: "A month later, a colleague redraws the plan from scratch for a documentation update and sends it for review. LAN-A and LAN-B are unchanged; LAN-C has a new network.",
    run: (s) => ({ state: idle(s), events: [] }),
  },
  {
    id: "fault-proposed",
    label: "The revised LAN-C",
    narrative: `The revised plan lists LAN-C as ${SD_FAULT_LAN_C.network}/${SD_FAULT_LAN_C.prefix}. Check it the same way you checked your own plan.`,
    run: (s) => ({ state: { ...idle(s), faultActive: true, plan: withPlan(s, "LAN-C", { ...SD_FAULT_LAN_C }), candidate: undefined }, events: [ev("STEP_ENTERED", "fault-proposed", "revised plan loaded")] }),
    whatChanged: () => [`LAN-C proposed: ${SD_FAULT_LAN_C.network}/${SD_FAULT_LAN_C.prefix}`],
  },
  {
    id: "fault-apply",
    label: "R1 refuses the change",
    narrative: `Applying the revision on a lab copy of R1: setting ge-0/0/3 to ${numToIp(ipToNum(SD_FAULT_LAN_C.network) + 1)}/${SD_FAULT_LAN_C.prefix} is refused with an overlapping-subnet error.`,
    run: (s) => {
      const check = checkCandidate(s.plan, "LAN-C", SD_FAULT_LAN_C.network, SD_FAULT_LAN_C.prefix);
      return { state: push({ ...idle(s), candidate: { ...check, seg: "LAN-C" }, note: { device: "R1", text: "R1: overlapping subnet — refused" } }, deployHop("fault-apply", s.plan, { seg: "LAN-C", check })), events: [ev("PACKET_DROPPED", "fault-apply", "configuration refused")] };
    },
    whatChanged: (_p, n) => [n.candidate?.reason ?? ""],
  },
  {
    id: "trouble-question",
    label: "Diagnose the plan",
    narrative: "LAN-A and LAN-B match the approved design. Only LAN-C changed.",
    question: {
      prompt: "What is wrong with 10.44.0.160/27 for LAN-C?",
      options: [
        { id: "overlap", label: "It overlaps LAN-B's 10.44.0.128/26 (.128–.191)" },
        { id: "align", label: ".160 is not a valid /27 boundary" },
        { id: "small", label: "A /27 cannot hold 25 hosts" },
        { id: "transit", label: "It overlaps the transit /30" },
      ],
      correctOptionId: "overlap",
      explanation: ".160 IS a /27 boundary (5 × 32) and /27 holds 30 hosts — but .160–.191 lies entirely inside LAN-B's .128–.191. Two networks can't share addresses.",
    },
  },
  {
    id: "diagnostic-layers",
    label: "Check every rule",
    narrative: "Run each design rule against the revised LAN-C: alignment, capacity, inside the parent, and no overlap.",
  },
  {
    id: "repair-challenge",
    label: "Choose LAN-C's network",
    narrative: "Pick the network that satisfies every rule.",
    action: (s, payload) => ({ state: applySdRepair(s, (payload as { choice: string }).choice), events: [ev("STEP_ENTERED", "repair-challenge", `LAN-C candidate ${(payload as { choice: string }).choice}`)] }),
    requiresState: (s) => s.repaired,
  },
  {
    id: "verify-replan",
    label: "Apply the corrected plan",
    narrative: `With LAN-C back at ${dC.network}/${dC.prefix}, R1 accepts the configuration: four unique connected prefixes.`,
    run: (s) => {
      const deployed = Object.fromEntries(s.plan.map((a) => [a.id, { network: a.network!, prefix: a.prefix! }])) as SdState["deployed"];
      return { state: push({ ...idle(s), deployed, candidate: undefined }, deployHop("verify-replan", s.plan)), events: [ev("STEP_ENTERED", "verify-replan", "plan applied")] };
    },
    whatChanged: () => ["All four prefixes accepted"],
  },
  {
    id: "verify-a-c-send",
    label: "Verify: HOST-A → HOST-C",
    narrative: `A final ping from HOST-A to HOST-C (${SD_ADDR["HOST-C"]}).`,
    run: (s) => ({ state: hostSend(s, "verify-a-c-send", "HOST-A", SD_ADDR["HOST-C"], 5), events: [ev("PACKET_SENT", "verify-a-c-send", "HOST-A → HOST-C")] }),
    packet: (s) => s.packet,
  },
  {
    id: "verify-a-c-route",
    label: "Delivered on LAN-C",
    narrative: `R1 matches ${dC.network}/${dC.prefix} and delivers to HOST-C. The design holds.`,
    run: (s) => ({ state: r1Forward(s, "verify-a-c-route", s.packet!), events: [ev("PACKET_SENT", "verify-a-c-route", "R1 → HOST-C")] }),
    packet: (s) => s.packet,
  },
  {
    id: "complete",
    label: "Lesson complete",
    narrative: "Requirements → host bits → prefix → largest-first placement on aligned boundaries → overlap check → deploy → verify with packets.",
  },
];

export const sdAllocationRows = (plan: Allocation[]) =>
  plan.map((a) => {
    if (a.network && a.prefix !== undefined) {
      const d = describe(a.network, a.prefix);
      return { id: a.id, hosts: a.hosts, text: `${d.network}/${d.prefix}`, detail: `${d.firstHost}–${d.lastHost} · bc ${d.broadcast} · ${d.usable} usable` };
    }
    if (a.prefix !== undefined) return { id: a.id, hosts: a.hosts, text: `/${a.prefix} (not placed)`, detail: `${blockSize(a.prefix)} addresses · ${usableHosts(a.prefix)} usable` };
    return { id: a.id, hosts: a.hosts, text: "not sized", detail: `${a.hosts} hosts needed` };
  });
export { dA, dB, dC, dT };
