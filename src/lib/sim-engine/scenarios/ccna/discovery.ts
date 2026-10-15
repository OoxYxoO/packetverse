import type { PacketVisual, ScenarioStep } from "../../types";
import type { ProcessingStage } from "@/components/network3d/types";
import { act, acted, hop, kitBase, layer, packet, q, repairStep, say, stackOf, withDetail, type KitBase } from "./kit";

/**
 * Discovery Protocols: CDP & LLDP (CCNA 2.3). SW1 is a Cisco access switch; SW2 and AP1 are Cisco; R1 is a Juniper
 * router; PHONE-1 is a standards-based SIP phone.
 *
 * Modeled:
 * - Who hears whom: a neighbour entry exists on a port only if the far end transmits a protocol and this end runs it.
 *   CDP is Cisco-proprietary (multicast 01:00:0c:cc:cc:cc); LLDP is IEEE 802.1AB (01:80:c2:00:00:0e), spoken by
 *   every vendor.
 * - Ageing: an entry lives for its holdtime after the last advertisement (CDP: sent every 60 s, holdtime 180 s;
 *   LLDP: every 30 s, TTL = 30 × hold multiplier 4 = 120 s). The lesson's clock advances in seconds; remaining holdtime
 *   is computed, and expired entries vanish.
 * - LLDP-MED network policy: the switch tells a phone its voice VLAN, CoS and DSCP; with no LLDP the phone falls
 *   back to sending untagged voice in the access (data) VLAN.
 */

export type Proto = "CDP" | "LLDP";
export const TIMERS: Record<Proto, { every: number; hold: number }> = { CDP: { every: 60, hold: 180 }, LLDP: { every: 30, hold: 30 * 4 } };
export const MCAST: Record<Proto, string> = { CDP: "01:00:0c:cc:cc:cc", LLDP: "01:80:c2:00:00:0e" };

export interface Peer {
  id: string;
  /** SW1's local port facing it. */
  local: string;
  /** Its own port ID. */
  port: string;
  platform: string;
  caps: string;
  mgmt: string;
  speaks: Proto[];
}
export const PEERS: Peer[] = [
  { id: "SW2", local: "Gi1/0/1", port: "Gi1/0/1", platform: "Cisco C9300-48P", caps: "Switch, IGMP", mgmt: "10.0.0.2", speaks: ["CDP", "LLDP"] },
  { id: "AP1", local: "Gi1/0/12", port: "Gig0", platform: "Cisco C9130AXI", caps: "Trans-Bridge", mgmt: "10.0.0.31", speaks: ["CDP", "LLDP"] },
  { id: "R1", local: "Gi1/0/48", port: "ge-0/0/0", platform: "Juniper MX204", caps: "Router", mgmt: "10.0.0.1", speaks: ["LLDP"] },
  { id: "PHONE-1", local: "Gi1/0/5", port: "eth0", platform: "SIP phone (LLDP-MED)", caps: "Telephone", mgmt: "—", speaks: ["LLDP"] },
];
export const VOICE = { vlan: 110, cos: 5, dscp: 46, dataVlan: 10 } as const;

export interface DiscState extends KitBase {
  /** The lesson clock, seconds. */
  now: number;
  /** SW1's global protocol state. */
  sw1: Record<Proto, boolean>;
  /** Last advertisement SW1 received per peer and protocol (seconds). */
  heard: Record<string, number>;
  /** Peers whose cable is unplugged. */
  unplugged: string[];
  /** PHONE-1's voice VLAN (learned by LLDP-MED) — undefined = untagged into the data VLAN. */
  phoneVoiceVlan?: number;
  phoneUp: boolean;
}
export function createDiscState(): DiscState {
  return { ...kitBase(), now: 0, sw1: { CDP: true, LLDP: false }, heard: {}, unplugged: [], phoneUp: false };
}
const key = (peer: string, p: Proto) => `${peer}|${p}`;
export const peerById = (id: string) => PEERS.find((p) => p.id === id)!;

/** SW1's neighbour table for one protocol right now: remaining holdtime computed, expired entries dropped. */
export function neighbors(s: DiscState, p: Proto) {
  if (!s.sw1[p]) return [];
  return PEERS.flatMap((peer) => {
    const at = s.heard[key(peer.id, p)];
    if (at === undefined) return [];
    const left = TIMERS[p].hold - (s.now - at);
    return left > 0 ? [{ peer, holdLeft: left }] : [];
  });
}
/** Every peer still advertising sends again; SW1 records what it can hear. */
function advertise(s: DiscState, now: number): DiscState {
  const heard = { ...s.heard };
  for (const peer of PEERS) {
    if (s.unplugged.includes(peer.id) || (peer.id === "PHONE-1" && !s.phoneUp)) continue;
    for (const p of peer.speaks) {
      if (!s.sw1[p]) continue;
      // last periodic send at or before `now`
      heard[key(peer.id, p)] = Math.floor(now / TIMERS[p].every) * TIMERS[p].every;
    }
  }
  return { ...s, now, heard };
}

// ---------------------------------------------------------------------------------------------------------------
// Packets
// ---------------------------------------------------------------------------------------------------------------
const C = { eth: "#94a3b8", cdp: "#22d3ee", lldp: "#a78bfa", med: "#34d399" };
const cdpPkt = (peer: Peer): PacketVisual =>
  packet(`cdp-${peer.id}`, "ETHERNET", peer.id, "SW1", "CDP", `CDP · ${peer.id} → ${MCAST.CDP}`, [
    layer("Ethernet (802.3 + SNAP)", C.eth, [["Destination MAC", MCAST.CDP], ["SNAP PID", "0x2000 (CDP)"]]),
    layer("CDP TLVs", C.cdp, [["Device ID", peer.id], ["Port ID", peer.port], ["Platform", peer.platform], ["Capabilities", peer.caps], ["Management address", peer.mgmt], ["Native VLAN", "1"], ["Duplex", "full"], ["Holdtime", `${TIMERS.CDP.hold} s`]]),
  ]);
const lldpPkt = (peer: Peer, from = peer.id, to = "SW1", med = false): PacketVisual =>
  packet(`lldp-${peer.id}-${from}`, "ETHERNET", from, to, med ? "LLDP-MED" : "LLDP", `${med ? "LLDP-MED" : "LLDP"} · ${from} → ${MCAST.LLDP}`, [
    layer("Ethernet II", C.eth, [["Destination MAC", MCAST.LLDP], ["EtherType", "0x88CC (LLDP)"]]),
    layer("LLDP TLVs", C.lldp, med ? [["Chassis ID", "SW1"], ["Port ID", peer.local], ["TTL", `${TIMERS.LLDP.hold} s`], ["System capabilities", "Bridge"]] : [["Chassis ID", peer.id], ["Port ID", peer.port], ["TTL", `${TIMERS.LLDP.hold} s`], ["System name", peer.id], ["System description", peer.platform], ["System capabilities", peer.caps], ["Management address", peer.mgmt]]),
    ...(med ? [layer("LLDP-MED Network Policy", C.med, [["Application", "Voice"], ["VLAN ID", String(VOICE.vlan)], ["L2 priority (CoS)", String(VOICE.cos)], ["DSCP", `${VOICE.dscp} (EF)`]])] : []),
  ]);

export const ST = {
  sw: [{ id: "rx", label: "Receive CDP / LLDP multicast" }, { id: "run", label: "Protocol running here?" }, { id: "table", label: "Store neighbour + holdtime" }, { id: "age", label: "Age out when holdtime hits 0" }],
  peer: [{ id: "tx", label: "Advertise (CDP every 60 s / LLDP every 30 s)" }],
  phone: [{ id: "boot", label: "Boot, link up" }, { id: "med", label: "Learn voice VLAN from LLDP-MED" }, { id: "dhcp", label: "DHCP in the voice VLAN" }, { id: "call", label: "Register with the call server" }],
} satisfies Record<string, ProcessingStage[]>;

export const DISC_REPAIR_OPTIONS = [
  { id: "lldp-scoped", label: "Run LLDP on SW1 again, and turn it off only on ports facing untrusted networks" },
  { id: "manual", label: "Set the voice VLAN by hand on every phone" },
  { id: "cdp", label: "Make sure CDP is enabled on the phone ports" },
  { id: "data", label: "Allow voice traffic in the data VLAN" },
];
export const DISC_REPAIR_CORRECT = "lldp-scoped";

type Step = ScenarioStep<DiscState>;
const tableText = (s: DiscState, p: Proto) => neighbors(s, p).map((n) => `${n.peer.id} ${n.peer.local} ${n.holdLeft}s`).join(" · ") || "empty";

function phoneBoot(id: string): (s: DiscState) => DiscState {
  return (s) => {
    const peer = peerById("PHONE-1");
    const lldpOn = s.sw1.LLDP;
    const next = advertise({ ...s, phoneUp: true, phoneVoiceVlan: lldpOn ? VOICE.vlan : undefined }, s.now);
    const p = lldpOn ? lldpPkt(peer, "SW1", "PHONE-1", true) : undefined;
    return acted(next, hop({ stepId: id, device: "PHONE-1", stages: withDetail(ST.phone, { med: lldpOn ? `voice VLAN ${VOICE.vlan} · CoS ${VOICE.cos} · DSCP ${VOICE.dscp}` : "no LLDP-MED received → untagged", dhcp: lldpOn ? `10.110.0.0/24 (voice)` : `10.10.10.0/24 (data VLAN ${VOICE.dataVlan})`, call: lldpOn ? "registered" : "call server unreachable from the data VLAN" }), activeStageId: lldpOn ? "call" : "dhcp", ingressInterfaceId: "eth0", lookupType: "LLDP-MED network policy", lookupKey: "voice", lookupResult: lldpOn ? `VLAN ${VOICE.vlan}` : "none", action: lldpOn ? `VOICE VLAN ${VOICE.vlan}` : "UNTAGGED → DATA VLAN", reason: lldpOn ? "The phone learns its voice VLAN and QoS markings from the switch, so it tags voice into VLAN 110 automatically." : "With no network policy from the switch, a phone sends untagged frames — which the access port puts in the data VLAN.", input: "link up", output: lldpOn ? "voice in VLAN 110" : "voice in VLAN 10", before: p ? stackOf(p) : undefined }), p, lldpOn ? `PHONE-1 → VLAN ${VOICE.vlan}` : "PHONE-1: no voice VLAN");
  };
}

export const discoverySteps: Step[] = [
  say("intro", "Who is on the other end?", "You inherit a wiring closet with no documentation. SW1 has cables on many ports. Instead of tracing each one by hand, ask the devices: discovery protocols let every neighbour announce its name, model, port and address once a minute or so."),
  act("cdp-adv", "SW2 announces itself with CDP", "SW2 sends a CDP advertisement out every port — a multicast to 01:00:0c:cc:cc:cc. It never crosses SW1: CDP is link-local, one hop only. SW1 stores SW2 in its CDP table with a 180 s holdtime.", (s) => {
    const n = advertise(s, 10);
    const p = cdpPkt(peerById("SW2"));
    return acted(n, hop({ stepId: "cdp-adv", device: "SW1", stages: withDetail(ST.sw, { rx: "CDP from Gi1/0/1", run: "CDP: on", table: `SW2 · Gi1/0/1 · holdtime ${TIMERS.CDP.hold} s` }), activeStageId: "table", ingressInterfaceId: "Gi1/0/1", lookupType: "CDP neighbour table", lookupKey: "SW2", lookupResult: `added · ${TIMERS.CDP.hold} s`, action: "LEARN NEIGHBOUR", reason: "Discovery frames are consumed by the neighbour, never forwarded — so each device only ever learns its directly connected neighbours.", input: p.summary, output: tableText(n, "CDP"), before: stackOf(p) }), p, "SW2 learned via CDP");
  }, "PACKET_SENT"),
  say("cdp-table", "show cdp neighbors", "SW1's CDP table lists SW2 on Gi1/0/1 and AP1 on Gi1/0/12, with model, capabilities and the far-end port. Open SW1. But R1, the router on Gi1/0/48, is missing — though its link is up and passing traffic.", {
    question: q("Why doesn't R1 appear in SW1's CDP table?", [["vendor", "R1 is a Juniper router; CDP is Cisco-proprietary and R1 doesn't speak it"], ["down", "R1's interface is down"], ["routers", "CDP only lists switches"], ["hop", "R1 is more than one hop away"]], "vendor", "CDP is a Cisco protocol. Juniper (and most other vendors) speak the standard LLDP instead. The link is fine — R1 is simply silent in a language SW1 is listening to."),
  }),
  act("lldp-enable", "Turn on LLDP", "On SW1: lldp run. Within 30 seconds R1's LLDP advertisement arrives: chassis ID, port ge-0/0/0, system name, capabilities Router, management address. SW2 and AP1 speak LLDP too, so they appear in both tables.", (s) => {
    const n = advertise({ ...s, sw1: { ...s.sw1, LLDP: true } }, 40);
    const p = lldpPkt(peerById("R1"));
    return acted(n, hop({ stepId: "lldp-enable", device: "SW1", stages: withDetail(ST.sw, { rx: "LLDP from Gi1/0/48", run: "LLDP: on (lldp run)", table: `R1 · ge-0/0/0 · TTL ${TIMERS.LLDP.hold} s` }), activeStageId: "table", ingressInterfaceId: "Gi1/0/48", lookupType: "LLDP neighbour table", lookupKey: "R1", lookupResult: `added · ${TIMERS.LLDP.hold} s`, action: "LEARN NEIGHBOUR", reason: "LLDP (IEEE 802.1AB) is the vendor-neutral equivalent of CDP. On many Cisco switches it's off by default; on Junos it's on.", input: p.summary, output: tableText(n, "LLDP"), before: stackOf(p) }), p, "R1 learned via LLDP");
  }, "PACKET_SENT"),
  act("aging", "The cable is pulled", "Someone unplugs R1's cable to move it. R1 can't send any more advertisements — but SW1 doesn't notice instantly. R1 is still in the LLDP table, its holdtime counting down.", (s) => ({ ...advertise({ ...s, unplugged: ["R1"] }, 45), packet: undefined, flood: [], decision: { device: "SW1", text: `t = 45 s · R1 still listed` } }), "STEP_ENTERED", q("R1's last LLDP advertisement reached SW1 at t = 30 s. When does R1 disappear from SW1's LLDP table?", [["60", "t = 60 s"], ["150", "t = 150 s"], ["210", "t = 210 s"], ["never", "Only when someone clears the table"]], "150", `LLDP TTL = transmit interval 30 s × hold multiplier 4 = ${TIMERS.LLDP.hold} s, counted from the last advertisement: 30 + ${TIMERS.LLDP.hold} = 150 s. (CDP would keep it 180 s.)`)),
  act("aged", "Holdtime runs out", "Two minutes later, at t = 160 s, R1's entry has aged out of SW1's LLDP table. SW2 and AP1, still advertising every 30 seconds, never come close to expiring.", (s) => ({ ...advertise(s, 160), packet: undefined, flood: [], decision: { device: "SW1", text: `t = 160 s · LLDP: ${tableText(advertise(s, 160), "LLDP")}` } }), "STEP_ENTERED"),
  act("lldp-med", "LLDP-MED tells the phone its VLAN", `PHONE-1, a standards-based SIP phone, is plugged into Gi1/0/5. SW1 sends it LLDP-MED: voice VLAN ${VOICE.vlan}, CoS ${VOICE.cos}, DSCP ${VOICE.dscp}. The phone tags its voice into VLAN ${VOICE.vlan} and leaves the PC behind it in data VLAN ${VOICE.dataVlan}.`, phoneBoot("lldp-med"), "PACKET_SENT"),
  say("security", "Discovery is also reconnaissance", "Every advertisement hands out a model, a software version, a port name and a management address — useful to you, and to an attacker plugged into the same port. Run discovery where you manage the neighbour; turn it off on ports facing networks you don't trust.", {
    question: q("Where should CDP and LLDP be disabled?", [["edge", "On the interface facing the ISP or other untrusted networks"], ["all", "Everywhere — they're always a risk"], ["uplinks", "On uplinks between your own switches"], ["phones", "On ports with IP phones"]], "edge", "Disable per interface where neighbours aren't yours: internet edges, guest and public ports. Keep it on internal links and phone ports, where it documents the network and provisions phones."),
  }),
  // incident
  act("fault-injected", "A hardening script", "A security review says 'disable LLDP — it leaks information'. A script applies no lldp run on SW1 overnight. Every link stays up; CDP is still on.", (s) => ({ ...s, sw1: { ...s.sw1, LLDP: false }, phoneUp: false, phoneVoiceVlan: undefined, faultActive: true, packet: undefined, flood: [], decision: { device: "SW1", text: "config change applied" } }), "STEP_ENTERED"),
  act("inc-phone", "Phones can't make calls", "In the morning PHONE-1 reboots after a firmware push. It comes up, gets an address and shows no service. Desk PCs work fine. The same is true for every third-party phone on SW1.", phoneBoot("inc-phone"), "PACKET_DROPPED"),
  say("trouble-question", "Diagnose", "PHONE-1 has a 10.10.10.x address — the data subnet — instead of 10.110.0.x. Its port, cable and PoE are fine.", {
    question: q("What is the most likely cause?", [["lldp", "With LLDP off, the phone no longer receives LLDP-MED, so it never learns the voice VLAN"], ["vlan", "Voice VLAN 110 was deleted"], ["poe", "The phone isn't getting enough PoE"], ["dhcp", "The voice DHCP scope is exhausted"]], "lldp", "The phone booted and got a DHCP address — so power, link and DHCP work. It got the data subnet because it sent untagged frames: a standards-based phone learns its voice VLAN from LLDP-MED, and SW1 stopped sending LLDP. CDP doesn't help a non-Cisco phone.", ["Which subnet did the phone get — and why that one?", "How does this phone usually learn its VLAN?", "What changed overnight?"]),
  }),
  say("diagnostic-layers", "Troubleshooting layers", "Bottom-up: power and link, the phone's address, which VLAN it landed in, whether SW1 sends LLDP-MED, and what the hardening changed."),
  repairStep("repair-challenge", "Repair", "Choose the change that fixes the cause.", DISC_REPAIR_CORRECT, (s) => ({ ...s, sw1: { ...s.sw1, LLDP: true }, decision: { device: "SW1", text: "lldp run · LLDP off only on guest and untrusted ports" } })),
  act("verify", "Phones register again", `With LLDP running, PHONE-1's next boot receives LLDP-MED: voice VLAN ${VOICE.vlan}, CoS ${VOICE.cos}, DSCP ${VOICE.dscp}. It gets a voice address and registers. The security goal is met where it matters — on the ports that face untrusted networks.`, phoneBoot("verify"), "PACKET_RECEIVED"),
  say("complete", "Discovery protocols", "CDP for Cisco neighbours, LLDP for everyone; entries that age out after their holdtime; LLDP-MED to provision phones — and discovery turned off only where the neighbour isn't yours."),
];
