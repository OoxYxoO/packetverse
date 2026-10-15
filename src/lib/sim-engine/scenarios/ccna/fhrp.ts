import type { PacketVisual, ScenarioStep } from "../../types";
import type { ProcessingStage } from "@/components/network3d/types";
import { act, acted, hop, kitBase, layer, packet, q, repairStep, say, stackOf, withDetail, type KitBase } from "./kit";

/**
 * First Hop Redundancy: HSRP & VRRP (CCNA 3.5). Hosts on 10.1.1.0/24 use the virtual gateway 10.1.1.1, shared by R1
 * (10.1.1.2) and R2 (10.1.1.3); each router has its own WAN uplink.
 *
 * Modeled:
 * - HSRP version 1, group 10: virtual MAC 0000.0c07.ac0a, hellos every 3 s to 224.0.0.2 (UDP 1985), hold time 10 s.
 * - Election: highest effective priority (default 100), then highest interface IP. Effective priority = configured
 *   priority − the tracking decrement while the tracked interface is down.
 * - Preemption: a router takes over from a working active router only if its priority is higher AND it has preempt
 *   configured (off by default in HSRP, on by default in VRRP). If the active router disappears, the standby takes over
 *   after the hold time regardless.
 * - The active router answers ARP for the virtual IP with the virtual MAC, so hosts never change their ARP entry on
 *   failover; the new active router sends gratuitous ARP so switches relearn where the virtual MAC lives.
 */

export type Rid = "R1" | "R2";
export interface FhrpRouter {
  ip: string;
  priority: number;
  preempt: boolean;
  /** Tracking: interface and decrement. */
  track?: { iface: string; decrement: number };
  up: boolean;
  wanUp: boolean;
}
export interface FhrpState extends KitBase {
  r: Record<Rid, FhrpRouter>;
  active?: Rid;
  standby?: Rid;
  /** PC1's ARP cache entry for the virtual IP. */
  pcArp?: string;
  /** Where the switch has learned the virtual MAC. */
  vmacOn?: Rid;
  log: string[];
}
export const VIP = "10.1.1.1";
export const VMAC = "0000.0c07.ac0a";
export const VRRP_VMAC = "0000.5e00.010a";
export const HSRP_TIMERS = { hello: 3, hold: 10 };
export const VRRP_TIMERS = { advert: 1, masterDown: 3 * 1 + (256 - 100) / 256 };

export function createFhrpState(): FhrpState {
  return {
    ...kitBase(),
    r: {
      R1: { ip: "10.1.1.2", priority: 110, preempt: true, track: { iface: "Gi0/1", decrement: 20 }, up: true, wanUp: true },
      R2: { ip: "10.1.1.3", priority: 100, preempt: false, up: true, wanUp: true },
    },
    log: [],
  };
}
export const effPrio = (r: FhrpRouter) => r.priority - (r.track && !r.wanUp ? r.track.decrement : 0);
const ipN = (ip: string) => ip.split(".").reduce((a, o) => a * 256 + Number(o), 0);
const better = (a: FhrpRouter, b: FhrpRouter) => effPrio(a) > effPrio(b) || (effPrio(a) === effPrio(b) && ipN(a.ip) > ipN(b.ip));

/** Recompute active/standby from the current active (preemption rules applied). */
export function reconcile(s: FhrpState): FhrpState {
  const ids = (["R1", "R2"] as Rid[]).filter((id) => s.r[id].up);
  if (!ids.length) return { ...s, active: undefined, standby: undefined };
  let active = s.active && s.r[s.active].up ? s.active : undefined;
  const log = [...s.log];
  if (!active) {
    active = ids.reduce((a, b) => (better(s.r[b], s.r[a]) ? b : a));
    log.push(`${active} becomes active (${s.active ? "active lost — hold time expired" : "initial election"})`);
  } else {
    const challenger = ids.find((id) => id !== active && better(s.r[id], s.r[active!]));
    if (challenger && s.r[challenger].preempt) {
      log.push(`${challenger} preempts ${active} (priority ${effPrio(s.r[challenger])} > ${effPrio(s.r[active])})`);
      active = challenger;
    } else if (challenger) log.push(`${challenger} has higher priority (${effPrio(s.r[challenger])} > ${effPrio(s.r[active])}) but no preempt — stays standby`);
  }
  const standby = ids.find((id) => id !== active);
  return { ...s, active, standby, vmacOn: active, log };
}

// ---------------------------------------------------------------------------------------------------------------
const C = { eth: "#94a3b8", ip: "#60a5fa", hsrp: "#f472b6", arp: "#f59e0b" };
const helloPkt = (s: FhrpState, id: Rid): PacketVisual =>
  packet(`hello-${id}`, "IP", id, "SW1", "HSRP Hello", `HSRP Hello · ${s.r[id].ip} → 224.0.0.2`, [
    layer("IPv4 Header", C.ip, [["Source IP", s.r[id].ip], ["Destination IP", "224.0.0.2"], ["TTL", "1"]]),
    layer("UDP", C.ip, [["Ports", "1985 → 1985"]]),
    layer("HSRP", C.hsrp, [["Version", "1"], ["Group", "10"], ["Priority", String(effPrio(s.r[id]))], ["State", s.active === id ? "Active" : s.standby === id ? "Standby" : "Speak"], ["Hello / Hold", `${HSRP_TIMERS.hello} s / ${HSRP_TIMERS.hold} s`], ["Virtual IP", VIP]]),
  ], true);
const dataPkt = (id: string, to: string): PacketVisual =>
  packet(id, "IP", "PC1", to, "IPv4", `IPv4 · 10.1.1.50 → 8.8.8.8 · to MAC ${VMAC}`, [layer("Ethernet II Header", C.eth, [["Destination MAC", VMAC], ["Source MAC", "0050.56aa.0150"]]), layer("IPv4 Header", C.ip, [["Source IP", "10.1.1.50"], ["Destination IP", "8.8.8.8"], ["TTL", "64"]])]);

export const ST = {
  rtr: [{ id: "hello", label: "HSRP hello every 3 s (224.0.0.2)" }, { id: "elect", label: "Active / standby by priority (+ preempt)" }, { id: "vmac", label: "Active answers for VIP + virtual MAC" }, { id: "fwd", label: "Route the hosts' traffic" }],
  pc: [{ id: "arp", label: `ARP for the gateway ${VIP}` }, { id: "send", label: "Send to the gateway MAC" }],
  sw: [{ id: "rx", label: "Receive" }, { id: "fwd", label: "Forward to the port where the virtual MAC was learned" }],
} satisfies Record<string, ProcessingStage[]>;

function sendInternet(id: string): (s: FhrpState) => FhrpState {
  return (s) => {
    const a = s.active!;
    const ok = s.r[a].wanUp;
    const p = dataPkt(`${id}-d`, a);
    return acted(s, hop({ stepId: id, device: a, stages: withDetail(ST.rtr, { vmac: `${a} owns ${VIP} / ${VMAC}`, fwd: ok ? `0.0.0.0/0 via WAN (${a} Gi0/1)` : "no route — WAN down" }), activeStageId: "fwd", ingressInterfaceId: "Gi0/0", egressInterfaceId: ok ? "Gi0/1" : undefined, lookupType: "Routing table", lookupKey: "8.8.8.8", lookupResult: ok ? "0.0.0.0/0 via WAN" : "no route", action: ok ? "FORWARD" : "DROP (no route)", reason: "Whichever router is active receives every frame sent to the virtual MAC — and must be able to deliver it.", input: p.summary, output: ok ? `→ WAN-${a === "R1" ? "A" : "B"}` : "dropped", nextHopId: ok ? `WAN-${a === "R1" ? "A" : "B"}` : undefined, before: stackOf(p) }), p, ok ? `${a} forwards` : `${a} drops — no WAN`);
  };
}

export const FHRP_REPAIR_OPTIONS = [
  { id: "preempt", label: "Configure preempt on R2 (standby 10 preempt)" },
  { id: "prio", label: "Raise R1's priority to 150" },
  { id: "notrack", label: "Remove tracking from R1" },
  { id: "hosts", label: "Change every host's gateway to 10.1.1.3" },
];
export const FHRP_REPAIR_CORRECT = "preempt";

type Step = ScenarioStep<FhrpState>;
export const fhrpSteps: Step[] = [
  say("intro", "One gateway, one point of failure", "Every host on 10.1.1.0/24 has one default gateway. If that router dies, the subnet is cut off — even though R2, with its own WAN link, sits right beside it. Hosts can't run a routing protocol to notice; they only know one address."),
  say("vip", "A gateway that isn't a box", `The fix: R1 and R2 share a virtual IP, ${VIP}, and a virtual MAC. Hosts use ${VIP} as their gateway. Whichever router is active answers for it.`, {
    question: q(`PC1 ARPs for its gateway ${VIP}. Which MAC address does it get?`, [["vmac", `The virtual MAC ${VMAC}`], ["r1", "R1's burned-in MAC"], ["r2", "R2's burned-in MAC"], ["bcast", "The broadcast MAC"]], "vmac", `The active router answers with the group's virtual MAC (HSRP v1: 0000.0c07.acXX, XX = group in hex — group 10 → 0a). Because hosts cache the virtual MAC, failover doesn't require them to re-ARP.`),
  }),
  act("hello", "HSRP hellos", `R1 and R2 send HSRP hellos every ${HSRP_TIMERS.hello} s to 224.0.0.2 (UDP 1985) with their priority and state. R1 is configured with priority 110 and preempt, and tracks its WAN interface; R2 keeps the default 100.`, (s) => acted(s, hop({ stepId: "hello", device: "R1", stages: withDetail(ST.rtr, { hello: "priority 110 · group 10 · VIP 10.1.1.1" }), activeStageId: "hello", egressInterfaceId: "Gi0/0", lookupType: "HSRP group", lookupKey: "10", lookupResult: `VIP ${VIP}`, action: "HELLO", reason: "Hellos carry priority and state; a router that stops hearing the active for the hold time assumes it is gone.", input: "every 3 s", output: helloPkt(s, "R1").summary, before: stackOf(helloPkt(s, "R1")) }), helloPkt(s, "R1"), "Hello · priority 110"), "PACKET_SENT"),
  say("predict-election", "Predict: active and standby", "R1 has priority 110, R2 priority 100.", {
    question: q("Which router becomes active?", [["r1", "R1 — highest priority"], ["r2", "R2 — highest IP address"], ["both", "Both, load-sharing"]], "r1", "Priority is compared first; the highest interface IP only breaks ties. R1 becomes active, R2 standby. (GLBP, not HSRP, load-shares one group across routers.)"),
  }),
  act("election", "R1 is active", "R1 becomes active and R2 standby. Only the active router answers for the virtual IP and forwards hosts' traffic; the standby listens to hellos, ready to take over.", (s) => {
    const n = reconcile(s);
    return acted(n, hop({ stepId: "election", device: "R1", stages: withDetail(ST.rtr, { elect: `R1 ${effPrio(n.r.R1)} vs R2 ${effPrio(n.r.R2)} → ${n.active} active` }), activeStageId: "elect", lookupType: "HSRP election", lookupKey: "priority, then IP", lookupResult: `active ${n.active} · standby ${n.standby}`, action: "ACTIVE", reason: "One active, one standby; any others listen.", input: "hellos", output: `active ${n.active}` }), undefined, `active ${n.active} · standby ${n.standby}`);
  }, "STEP_ENTERED"),
  act("host-arp", "PC1 resolves the gateway", `PC1 ARPs for ${VIP}. R1, the active router, replies with the virtual MAC ${VMAC}. The switch learns that MAC on R1's port.`, (s) => {
    const p = packet("arp-rep", "ARP", "R1", "PC1", "ARP reply", `ARP reply · ${VIP} is at ${VMAC}`, [layer("ARP", C.arp, [["Operation", "2 (reply)"], ["Sender IP", VIP], ["Sender MAC", VMAC], ["Target IP", "10.1.1.50"]])]);
    return acted({ ...s, pcArp: VMAC }, hop({ stepId: "host-arp", device: "R1", stages: withDetail(ST.rtr, { vmac: `ARP ${VIP} → ${VMAC}` }), activeStageId: "vmac", ingressInterfaceId: "Gi0/0", lookupType: "HSRP", lookupKey: VIP, lookupResult: `active → reply ${VMAC}`, action: "ARP REPLY (virtual MAC)", reason: "Only the active router answers ARP for the virtual IP.", input: `ARP who-has ${VIP}`, output: p.summary, nextHopId: "PC1", before: stackOf(p) }), p, `${VIP} = ${VMAC}`);
  }, "PACKET_SENT"),
  act("traffic", "Traffic through the active router", "PC1 sends to 8.8.8.8 with destination MAC = the virtual MAC. The switch delivers it to R1, which routes it out its WAN link.", sendInternet("traffic"), "PACKET_SENT"),
  say("predict-failover", "Predict: R1 crashes", "R1 loses power without warning.", {
    question: q("How long until R2 takes over, with default HSRP timers?", [["hold", "About 10 seconds — the hold time"], ["hello", "3 seconds — one hello"], ["instant", "Instantly"], ["never", "Never — R2 has no preempt"]], "hold", `R2 must miss hellos for the hold time (${HSRP_TIMERS.hold} s) before declaring R1 dead. Preempt doesn't matter here: there's no working active router to preempt. VRRP's defaults take about ${VRRP_TIMERS.masterDown.toFixed(1)} s; sub-second timers or BFD go faster.`),
  }),
  act("failover", "R2 takes over", "Ten seconds without hellos: R2 becomes active, starts answering for the virtual IP, and sends a gratuitous ARP so the switch moves the virtual MAC to R2's port. PC1's ARP entry hasn't changed at all — same IP, same MAC.", (s) => {
    const n = reconcile({ ...s, r: { ...s.r, R1: { ...s.r.R1, up: false } } });
    return sendInternet("failover")(n);
  }, "PACKET_SENT"),
  act("restore", "R1 returns — and takes back over", "R1 boots and hears R2's hellos. Its priority (110) is higher and it has preempt configured, so it takes the active role back. Without preempt it would have stayed standby.", (s) => {
    const n = reconcile({ ...s, r: { ...s.r, R1: { ...s.r.R1, up: true } } });
    return sendInternet("restore")(n);
  }, "PACKET_SENT"),
  say("vrrp", "VRRP: the open standard", `VRRP (RFC 5798) does the same job across vendors: a master and backups, adverts every ${VRRP_TIMERS.advert} s to 224.0.0.18 (IP protocol 112), virtual MAC 0000.5e00.01XX (group 10 → ${VRRP_VMAC}), and preemption on by default. The virtual IP can even be the master's own address. Cisco's GLBP adds load balancing across routers in one group.`),
  // incident
  act("fault-injected", "R1's WAN link fails", "A backhoe cuts R1's WAN circuit. Gi0/1 goes down, but R1's LAN interface is fine and it keeps sending hellos. R1 tracks Gi0/1, so its priority drops by 20, to 90.", (s) => ({ ...reconcile({ ...s, r: { ...s.r, R1: { ...s.r.R1, wanUp: false } } }), faultActive: true, packet: undefined, flood: [], decision: { device: "R1", text: "Gi0/1 down · track decrement 20" } }), "STEP_ENTERED"),
  act("inc-down", "The internet is down", "Every user on 10.1.1.0/24 loses the internet. R2's WAN link is perfectly healthy.", sendInternet("inc-down"), "PACKET_DROPPED"),
  say("trouble-question", "Diagnose", "show standby on R2: state Standby, priority 100. On R1: Active, priority 90 (configured 110, tracked object down).", {
    question: q("Why doesn't R2 take over?", [["preempt", "R2 has the higher priority now, but without preempt it won't take over from a working active router"], ["track", "Tracking isn't configured on R1"], ["vmac", "The virtual MAC is duplicated"], ["hello", "R2 can't hear R1's hellos"]], "preempt", "Tracking did its job: R1 dropped to 90. But R1 is still alive and sending hellos, so R2 only takes over if it may preempt — and HSRP preemption is off by default. R2 stays standby while R1 black-holes the traffic.", ["Is R1 still sending hellos?", "Which priority is higher now?", "What lets a router take over from a working active router?"]),
  }),
  say("diagnostic-layers", "Troubleshooting layers", "Bottom-up: hosts' gateway and ARP, HSRP state and priorities on both routers, tracking, preemption, then the active router's route out."),
  repairStep("repair-challenge", "Repair", "Choose the change that fixes the cause.", FHRP_REPAIR_CORRECT, (s) => reconcile({ ...s, r: { ...s.r, R2: { ...s.r.R2, preempt: true } } })),
  act("verify", "R2 takes over", "With preempt, R2 (100) takes over from R1 (90) at once, sends a gratuitous ARP, and forwards everyone's traffic out its healthy WAN link. When R1's circuit is repaired, R1 returns to 110 and preempts back.", sendInternet("verify"), "PACKET_SENT"),
  say("complete", "First hop redundancy", "A virtual IP and MAC as everyone's gateway; active and standby by priority; failover after the hold time; preemption to let a better router take over — and tracking that only helps if the other router may preempt."),
];
