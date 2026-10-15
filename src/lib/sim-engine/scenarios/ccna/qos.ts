import type { PacketVisual, ScenarioStep } from "../../types";
import type { ProcessingStage } from "@/components/network3d/types";
import { act, acted, hop, kitBase, layer, packet, q, repairStep, say, stackOf, withDetail, type KitBase } from "./kit";

/**
 * QoS Fundamentals (CCNA 4.7). A branch's 10 Mb/s WAN link carries voice, video and a nightly backup.
 *
 * Modeled (a fluid model, computed per flow):
 * - Offered load vs capacity: congestion exists only while offered > capacity.
 * - FIFO with tail drop: every flow loses the same fraction (1 − capacity/offered) and waits behind a full queue
 *   (64 × 1500-byte packets at 10 Mb/s ≈ 76.8 ms).
 * - LLQ + CBWFQ: DSCP EF goes to a strict-priority queue (policed to its limit); classes get their guaranteed bandwidth,
 *   and spare capacity is shared in proportion to unmet demand. Only the congested default class sees the full queue.
 * - Classification trusts the DSCP on arrival — or, if the access port doesn't trust it, rewrites it to 0.
 * - Shaping: a token bucket with CIR and Bc releases Bc bits every Tc = Bc / CIR.
 */

export interface Flow {
  name: string;
  dscp: number;
  mbps: number;
}
export interface FlowResult extends Flow {
  queue: string;
  sentMbps: number;
  lossPct: number;
  delayMs: number;
}
export const LINK_MBPS = 10;
export const FULL_QUEUE_MS = (64 * 1500 * 8) / (LINK_MBPS * 1e6) * 1000;
const SER_MS = (1500 * 8) / (LINK_MBPS * 1e6) * 1000;
export const DSCP_NAME: Record<number, string> = { 46: "EF", 34: "AF41", 8: "CS1", 0: "default (BE)" };
const r1 = (x: number) => Math.round(x * 10) / 10;

export function fifo(flows: Flow[]): FlowResult[] {
  const offered = flows.reduce((a, f) => a + f.mbps, 0);
  const share = offered > LINK_MBPS ? LINK_MBPS / offered : 1;
  const delay = offered > LINK_MBPS ? FULL_QUEUE_MS : SER_MS;
  return flows.map((f) => ({ ...f, queue: "FIFO", sentMbps: r1(f.mbps * share), lossPct: r1((1 - share) * 100), delayMs: r1(delay) }));
}
export interface Policy {
  priorityLimit: number;
  classes: { name: string; dscp: number[]; guarantee: number }[];
}
export const POLICY: Policy = { priorityLimit: 2, classes: [{ name: "VIDEO", dscp: [34], guarantee: 4 }, { name: "class-default", dscp: [], guarantee: 0 }] };
export function llq(flows: Flow[], p: Policy = POLICY): FlowResult[] {
  const prio = flows.filter((f) => f.dscp === 46);
  const prioDemand = prio.reduce((a, f) => a + f.mbps, 0);
  const prioSent = Math.min(prioDemand, p.priorityLimit);
  let rest = LINK_MBPS - prioSent;
  const classOf = (f: Flow) => p.classes.find((c) => c.dscp.includes(f.dscp)) ?? p.classes[p.classes.length - 1];
  const others = flows.filter((f) => f.dscp !== 46);
  const demand = new Map<string, number>();
  others.forEach((f) => demand.set(classOf(f).name, (demand.get(classOf(f).name) ?? 0) + f.mbps));
  const alloc = new Map<string, number>();
  for (const c of p.classes) {
    const d = demand.get(c.name) ?? 0;
    const g = Math.min(d, c.guarantee, rest);
    alloc.set(c.name, g);
    rest -= g;
  }
  // share the remaining capacity in proportion to unmet demand
  const unmet = p.classes.map((c) => ({ c, u: (demand.get(c.name) ?? 0) - (alloc.get(c.name) ?? 0) })).filter((x) => x.u > 0);
  const totalUnmet = unmet.reduce((a, x) => a + x.u, 0);
  for (const { c, u } of unmet) alloc.set(c.name, (alloc.get(c.name) ?? 0) + Math.min(u, (rest * u) / totalUnmet));
  const res: FlowResult[] = [];
  for (const f of prio) res.push({ ...f, queue: "PRIORITY (LLQ)", sentMbps: r1(f.mbps * (prioDemand ? prioSent / prioDemand : 1)), lossPct: r1((1 - (prioDemand ? prioSent / prioDemand : 1)) * 100), delayMs: r1(SER_MS) });
  for (const f of others) {
    const c = classOf(f);
    const d = demand.get(c.name)!;
    const share = Math.min(1, (alloc.get(c.name) ?? 0) / d);
    res.push({ ...f, queue: c.name, sentMbps: r1(f.mbps * share), lossPct: r1((1 - share) * 100), delayMs: r1(share < 1 ? FULL_QUEUE_MS : SER_MS * 3) });
  }
  return res;
}
export const tokenBucket = (cirMbps: number, bcBits: number) => ({ tcMs: (bcBits / (cirMbps * 1e6)) * 1000, perSecond: (cirMbps * 1e6) / bcBits });

// ---------------------------------------------------------------------------------------------------------------
export interface QosState extends KitBase {
  trustPhones: boolean;
  policy: "fifo" | "llq";
  results?: FlowResult[];
  shaping?: { cir: number; bc: number };
}
export const FLOWS = (trust: boolean): Flow[] => [
  { name: "Voice (10 calls)", dscp: trust ? 46 : 0, mbps: 1 },
  { name: "Video conference", dscp: 34, mbps: 3 },
  { name: "Nightly backup", dscp: 0, mbps: 9 },
];
export function createQosState(): QosState {
  return { ...kitBase(), trustPhones: true, policy: "fifo" };
}
export const run = (s: QosState) => (s.policy === "fifo" ? fifo(FLOWS(s.trustPhones)) : llq(FLOWS(s.trustPhones)));

const C = { eth: "#94a3b8", tag: "#facc15", ip: "#60a5fa", rtp: "#34d399" };
const voicePkt = (id: string, dscp: number, from: string, to: string): PacketVisual =>
  packet(id, "IP", from, to, "RTP voice", `RTP voice · DSCP ${dscp} (${DSCP_NAME[dscp]})`, [layer("802.1Q", C.tag, [["VLAN", "110 (voice)"], ["CoS", dscp === 46 ? "5" : "0"]]), layer("IPv4 Header", C.ip, [["DSCP", `${dscp} (${DSCP_NAME[dscp]})`], ["Source IP", "10.110.0.21"], ["Destination IP", "10.200.0.10"]]), layer("UDP / RTP", C.rtp, [["Payload", "G.711, 20 ms per packet"], ["Size", "214 bytes"]])]);
export const ST = {
  acc: [{ id: "rx", label: "Receive from the phone" }, { id: "trust", label: "Trust or rewrite the DSCP/CoS (trust boundary)" }, { id: "fwd", label: "Forward to the router" }],
  r1: [{ id: "classify", label: "Classify (match DSCP)" }, { id: "queue", label: "Queue: priority / class / default" }, { id: "schedule", label: "Schedule onto the 10 Mb/s link" }, { id: "shape", label: "Shape to the contract rate" }],
} satisfies Record<string, ProcessingStage[]>;

export const QOS_REPAIR_OPTIONS = [
  { id: "trust", label: "Trust the phones' DSCP marking on ACC-SW's phone ports" },
  { id: "prio", label: "Raise the priority queue to 5 Mb/s" },
  { id: "nopolicy", label: "Remove the QoS policy from the WAN" },
  { id: "backup", label: "Mark the backup EF so it's protected too" },
];
export const QOS_REPAIR_CORRECT = "trust";

type Step = ScenarioStep<QosState>;
function measure(id: string, label: string): (s: QosState) => QosState {
  return (s) => {
    const res = run(s);
    const v = res[0];
    const p = voicePkt(`${id}-v`, v.dscp, "R1", "WAN");
    return acted({ ...s, results: res }, hop({ stepId: id, device: "R1", stages: withDetail(ST.r1, { classify: res.map((r) => `${r.name.split(" ")[0]} DSCP ${r.dscp}→${r.queue}`).join(" · "), schedule: res.map((r) => `${r.name.split(" ")[0]} ${r.sentMbps}/${r.mbps} Mb/s`).join(" · ") }), activeStageId: "schedule", egressInterfaceId: "Se0/1/0", lookupType: s.policy === "fifo" ? "FIFO" : "LLQ + CBWFQ", lookupKey: `${res.reduce((a, r) => a + r.mbps, 0)} Mb/s offered on ${LINK_MBPS} Mb/s`, lookupResult: `voice: ${v.lossPct}% loss, ${v.delayMs} ms queueing`, action: label, reason: s.policy === "fifo" ? "One queue: when it's full, every flow loses the same share and waits behind everything else." : "Voice is served first from the priority queue; other classes share the rest by guarantee.", input: "13 Mb/s offered", output: res.map((r) => `${r.name}: ${r.lossPct}% loss`).join(" · "), nextHopId: "WAN", before: stackOf(p) }), p, `voice ${v.lossPct}% loss · ${v.delayMs} ms`);
  };
}

export const qosSteps: Step[] = [
  say("intro", "When there's more traffic than link", "QoS does nothing until a link is congested — then it decides who waits and who is dropped. Tonight, at 22:00, the branch's 10 Mb/s WAN link carries 10 voice calls, a video conference and a 9 Mb/s backup: 13 Mb/s offered."),
  say("marking", "Classify and mark", "Packets are classified once and marked so every later device can act fast: DSCP in the IP header (EF 46 for voice, AF41 34 for video, CS1 8 or default 0 for bulk) and CoS in the 802.1Q tag. Marks are trusted only from devices you trust — the trust boundary.", {
    question: q("Where should voice packets be marked?", [["edge", "As close to the source as you can trust: the IP phone, trusted by the access switch"], ["wan", "On the WAN router only"], ["isp", "At the ISP"], ["pc", "On the PC behind the phone"]], "edge", "Mark at the edge so every hop can use it. Trust the phone (a known device), not the PC plugged into it, which could mark anything EF."),
  }),
  act("fifo", "No QoS: everyone suffers", "Without a policy, R1's WAN interface has one FIFO queue. 13 Mb/s arrive for 10 Mb/s: the queue fills and tail-drops. Voice gets the same loss as the backup — and waits behind a full queue.", measure("fifo", "FIFO TAIL DROP"), "PACKET_DROPPED"),
  say("predict-llq", "Predict: low-latency queuing", "R1 gets a policy: DSCP EF into a priority queue (up to 2 Mb/s), AF41 video guaranteed 4 Mb/s, everything else in class-default.", {
    question: q("What happens to voice now, during the backup?", [["clean", "No loss and almost no queuing delay — it's sent first"], ["same", "The same loss as before"], ["half", "Half the loss"], ["worse", "It gets worse, because video is guaranteed more"]], "clean", "The priority queue is served before anything else, so voice never waits behind backup packets. Its limit (2 Mb/s) protects the others from a voice flood. The backup absorbs the congestion."),
  }),
  act("llq", "LLQ + CBWFQ", "With the policy on Se0/1/0: voice is scheduled first, video gets its guarantee, and class-default takes what's left — the backup slows down instead of the calls.", (s) => measure("llq", "LLQ")({ ...s, policy: "llq" }), "PACKET_SENT"),
  say("shape-police", "Shaping vs policing", "The ISP's contract is 10 Mb/s, but suppose the access circuit were 100 Mb/s: the ISP would police at 10 Mb/s, dropping the excess. R1 should shape to 10 Mb/s instead.", {
    question: q("What's the difference?", [["buffer", "Shaping delays (buffers) the excess and sends it later; policing drops or re-marks it immediately"], ["same", "They are the same"], ["prio", "Policing gives priority to voice"], ["inbound", "Shaping only works inbound"]], "buffer", "A shaper smooths bursts into the contract rate (and lets your queues decide what waits); a policer just cuts what exceeds it. Shape on your side so the ISP's policer never drops your voice."),
  }),
  act("shaper", "A token bucket", "R1 shapes to CIR 10 Mb/s with Bc 100,000 bits: every Tc it may send Bc bits, then waits.", (s) => {
    const tb = tokenBucket(10, 100_000);
    return acted({ ...s, shaping: { cir: 10, bc: 100_000 } }, hop({ stepId: "shaper", device: "R1", stages: withDetail(ST.r1, { shape: `CIR 10 Mb/s · Bc 100,000 bits · Tc = Bc/CIR = ${tb.tcMs} ms (${tb.perSecond} intervals/s)` }), activeStageId: "shape", egressInterfaceId: "Se0/1/0", lookupType: "Token bucket", lookupKey: "CIR / Bc", lookupResult: `Tc ${tb.tcMs} ms`, action: "SHAPE", reason: "Tokens arrive at the contract rate; traffic beyond them waits in the shaper's queue, where LLQ still decides the order.", input: "bursts", output: "smoothed to 10 Mb/s" }), undefined, `Tc ${tb.tcMs} ms`);
  }, "STEP_ENTERED"),
  // incident
  act("fault-injected", "A new access switch", "The branch access switch ACC-SW is replaced. Phones, PCs and VLANs come up as before. Its ports use the platform default for QoS markings.", (s) => ({ ...s, trustPhones: false, faultActive: true, packet: undefined, flood: [], decision: { device: "ACC-SW", text: "replacement online" } }), "STEP_ENTERED"),
  act("inc-choppy", "Calls break up at 22:00", "At the next backup window the help desk gets calls — choppy audio, dropped words. Daytime calls are fine. The policy on R1 hasn't changed.", (s) => {
    const p = voicePkt("acc", 0, "PHONE", "ACC-SW");
    const n = acted(s, hop({ stepId: "inc-choppy", device: "ACC-SW", stages: withDetail(ST.acc, { trust: "port not trusted → DSCP 46 rewritten to 0, CoS 5 → 0" }), activeStageId: "trust", ingressInterfaceId: "Gi1/0/5", lookupType: "QoS trust", lookupKey: "Gi1/0/5", lookupResult: "untrusted → remark 0", action: "REMARK", reason: "An access port that doesn't trust the device re-marks to 0 — the trust boundary moved.", input: "RTP voice DSCP 46", output: p.summary, before: stackOf(voicePkt("ph", 46, "PHONE", "ACC-SW")), after: stackOf(p), mutations: [{ type: "ENCAPSULATE", detail: "DSCP 46 → 0" }] }), p, "DSCP 46 → 0");
    const m = measure("inc-choppy", "LLQ")(n);
    return { ...m, hops: [...n.hops, m.hops[m.hops.length - 1]] };
  }, "PACKET_DROPPED"),
  say("trouble-question", "Diagnose", "On R1, show policy-map interface Se0/1/0: the priority class (EF) matches 0 packets; class-default is dropping heavily. The phones are unchanged.", {
    question: q("What is the most likely cause?", [["trust", "Voice arrives at R1 marked DSCP 0, because the new access switch doesn't trust the phones' markings"], ["small", "The priority queue is too small"], ["link", "The WAN link is too slow"], ["phones", "The phones stopped marking EF"]], "trust", "The policy only works if voice is marked EF when it reaches R1. Zero matches in the priority class means no EF packets arrive; the phones are unchanged; the new switch's ports re-mark untrusted traffic to 0, so voice lands in class-default with the backup.", ["How many packets match the priority class?", "What changed between the phone and R1?", "Who decides whether a marking survives?"]),
  }),
  say("diagnostic-layers", "Troubleshooting layers", "Follow the marking: the phone sets EF, the access port trusts or rewrites it, the router classifies it, then queues and schedules it."),
  repairStep("repair-challenge", "Repair", "Choose the change that fixes the cause.", QOS_REPAIR_CORRECT, (s) => ({ ...s, trustPhones: true, decision: { device: "ACC-SW", text: "trust DSCP on phone ports (conditional on a detected phone)" } })),
  act("verify", "Calls are clear again", "The phone ports now trust DSCP from the detected phones. Voice reaches R1 as EF, matches the priority class, and loses nothing while the backup runs.", measure("verify", "LLQ"), "PACKET_SENT"),
  say("complete", "QoS", "Classify and mark at a trusted edge; LLQ for voice, CBWFQ guarantees for the rest; tail drop and delay only for the class that's over its share; shape to the contract instead of being policed — and a trust boundary that has to survive a hardware swap."),
];
