import type { PacketVisual, ScenarioStep } from "../../types";
import type { ProcessingStage } from "@/components/network3d/types";
import { act, acted, hop, kitBase, layer, packet, q, repairStep, say, stackOf, withDetail, type KitBase } from "./kit";

/**
 * Layer 2 Security (CCNA 5.7, plus RA Guard and storm control). One access switch, ACC-SW, VLAN 10: two users, a
 * printer with a static address, an uplink to the gateway/DHCP relay — and a conference-room port an attacker uses.
 *
 * Modeled (computed):
 * - MAC flooding: time to fill the MAC table = table size / fake MACs per second; then unknown unicast is flooded.
 * - Port security: a MAC count limit per port, and what each violation mode does.
 * - DHCP: the client takes the first OFFER to arrive; snooping drops server messages on untrusted ports and records
 *   bindings (MAC, IP, VLAN, port).
 * - DAI: an ARP on an untrusted port must match a binding (or a static ARP ACL entry), or it is dropped.
 * - RA Guard: router advertisements are dropped on ports whose role is "host".
 * - Storm control: broadcast above the level (percent of link) is dropped.
 */

export const MAC = { pc1: "0050.56aa.0021", pc2: "0050.56aa.0022", prn: "0050.56aa.0200", gw: "0011.2233.0001", atk: "dead.beef.0666" };
export const IP = { pc1: "10.1.10.21", pc2: "10.1.10.22", prn: "10.1.10.200", gw: "10.1.10.1", atk: "10.1.10.66" };
export const FLOOD = { tableSize: 8192, fakePerSec: 16_000 };
export const fillMs = () => Math.round((FLOOD.tableSize / FLOOD.fakePerSec) * 1000);
export const OFFERS = { rogueMs: 1, legitMs: 14 };
export const STORM = { linkMbps: 1000, broadcastPct: 40, levelPct: 5 };
export const stormDroppedPct = () => Math.round(((STORM.broadcastPct - STORM.levelPct) / STORM.broadcastPct) * 1000) / 10;

export type ViolationMode = "protect" | "restrict" | "shutdown";
export interface Binding {
  mac: string;
  ip: string;
  vlan: number;
  port: string;
}
export interface L2State extends KitBase {
  macCount: number;
  flooding: boolean;
  portSec: { max: number; mode: ViolationMode } | null;
  errDisabled: string[];
  atkPort: string;
  snooping: boolean;
  trusted: string[];
  bindings: Binding[];
  pc2Gateway?: string;
  dai: boolean;
  /** Static IP-MAC entries DAI may also accept (an ARP ACL). */
  arpAcl: { ip: string; mac: string }[];
  pc1ArpGw: string;
  raGuard: boolean;
  pc1V6Router: string;
  storm: { level: number } | null;
  stormSeen: boolean;
  printerReachable: boolean;
  printer: boolean;
  violations: number;
}
export function createL2State(): L2State {
  return {
    ...kitBase(),
    macCount: 6,
    flooding: false,
    portSec: null,
    errDisabled: [],
    atkPort: "Gi1/0/5",
    snooping: false,
    trusted: [],
    bindings: [],
    dai: false,
    arpAcl: [],
    pc1ArpGw: MAC.gw,
    raGuard: false,
    pc1V6Router: "fe80::1 (R1)",
    storm: null,
    stormSeen: false,
    printerReachable: true,
    printer: false,
    violations: 0,
  };
}

/** What the switch does with the n-th new source MAC on a secured port. */
export function portSecurityAction(ps: L2State["portSec"], learned: number): "learn" | "drop" | "drop+log" | "err-disable" {
  if (!ps || learned < ps.max) return "learn";
  return ps.mode === "protect" ? "drop" : ps.mode === "restrict" ? "drop+log" : "err-disable";
}
/** DHCP: the client accepts the first OFFER to arrive that the switch delivered. */
export function dhcpWinner(s: L2State, atkPort: string): { server: "rogue" | "legit"; dropped: boolean } {
  const rogueDropped = s.snooping && !s.trusted.includes(atkPort);
  if (!rogueDropped && OFFERS.rogueMs < OFFERS.legitMs) return { server: "rogue", dropped: false };
  return { server: "legit", dropped: rogueDropped };
}
/** DAI: on an untrusted port, the ARP sender IP/MAC must match a binding on that port, or a static ARP ACL entry. */
export function daiCheck(s: L2State, port: string, senderIp: string, senderMac: string): { ok: boolean; why: string } {
  if (!s.dai) return { ok: true, why: "DAI off — every ARP is believed" };
  if (s.trusted.includes(port)) return { ok: true, why: `${port} is trusted` };
  if (s.bindings.some((b) => b.ip === senderIp && b.mac === senderMac && b.port === port)) return { ok: true, why: "matches a DHCP snooping binding" };
  if (s.arpAcl.some((a) => a.ip === senderIp && a.mac === senderMac)) return { ok: true, why: "matches the static ARP ACL" };
  return { ok: false, why: `no binding for ${senderIp} / ${senderMac} on ${port}` };
}

const C = { eth: "#94a3b8", arp: "#f59e0b", ip: "#60a5fa", app: "#f472b6" };
export const ST = {
  sw: [{ id: "rx", label: "Receive on port" }, { id: "sec", label: "Port security / storm control" }, { id: "inspect", label: "Snooping · DAI · RA Guard" }, { id: "mac", label: "MAC table" }, { id: "fwd", label: "Forward · flood · drop" }],
  host: [{ id: "rx", label: "Receive" }, { id: "use", label: "Believe and use" }],
} satisfies Record<string, ProcessingStage[]>;

export const L2_REPAIR_OPTIONS = [
  { id: "acl", label: "Add a static ARP ACL entry for the printer's IP and MAC, and apply it to DAI on VLAN 10" },
  { id: "trust", label: "Make the printer's port Gi1/0/20 a DAI trusted port" },
  { id: "off", label: "Disable DAI on VLAN 10" },
  { id: "dhcp", label: "Restart the DHCP server" },
];
export const L2_REPAIR_CORRECT = "acl";

type Step = ScenarioStep<L2State>;
const frame = (id: string, from: string, to: string, badge: string, summary: string, fields: [string, string][], color = C.eth, proto: PacketVisual["protocol"] = "ETHERNET"): PacketVisual => packet(id, proto, from, to, badge, summary, [layer("Ethernet", C.eth, [["Source MAC", fields[0]?.[1] ?? "—"], ["Destination MAC", fields[1]?.[1] ?? "—"]]), layer(badge, color, fields.slice(2))]);

const swHop = (id: string, port: string, stage: string, d: Partial<Record<string, string>>, key: string, result: string, action: string, reason: string, p: PacketVisual | undefined, output: string, next?: string) =>
  hop({ stepId: id, device: "ACC-SW", stages: withDetail(ST.sw, d), activeStageId: stage, ingressInterfaceId: port, lookupType: key.split(":")[0], lookupKey: key.split(":").slice(1).join(":").trim(), lookupResult: result, action, reason, input: p?.summary ?? "", output, nextHopId: next, before: p ? stackOf(p) : undefined });

export const l2Steps: Step[] = [
  say("intro", "The inside edge", "Access ports are where anyone with a cable gets in. Attacks here never cross the firewall: they target the switch's tables and the trust hosts place in DHCP, ARP and router advertisements. Each control in this lesson stops one of them."),
  say("predict-flood", "Predict: a full MAC table", `An attacker's tool on Gi1/0/5 sends frames from ${FLOOD.fakePerSec.toLocaleString()} random source MACs per second. ACC-SW's MAC table holds ${FLOOD.tableSize.toLocaleString()} entries.`, {
    question: q("Once the table is full, PC1 sends a frame to the server, whose MAC has aged out. What does the switch do?", [["flood", "Floods it out every port in the VLAN — including the attacker's"], ["drop", "Drops it"], ["cpu", "Sends it to the switch CPU"], ["learn", "Replaces the oldest entry and forwards it to the right port"]], "flood", "A destination the switch can't find is unknown unicast, and unknown unicast is flooded. With the table full of fake entries, real destinations can't be learned — so the attacker receives a copy of traffic meant for others."),
  }),
  act("flood", "MAC flooding", `The table fills in ${FLOOD.tableSize.toLocaleString()} ÷ ${FLOOD.fakePerSec.toLocaleString()} per s = ${fillMs()} ms. PC1's frames to the server are now flooded — and land on the attacker's port too.`, (s) => {
    const p = frame("flood-p", "PC1", "ATK", "Unknown unicast", "PC1 → server · flooded (table full)", [["Source MAC", MAC.pc1], ["Destination MAC", "0050.56aa.0099 (aged out)"], ["Payload", "application traffic"]]);
    return { ...acted(s, swHop("flood", "Gi1/0/1", "mac", { sec: "no port security", mac: `${FLOOD.tableSize}/${FLOOD.tableSize} entries · full in ${fillMs()} ms`, fwd: "flood out all VLAN 10 ports" }, `MAC table: 0050.56aa.0099`, "not found · table full", "FLOOD", "With no room to learn, every unknown destination is flooded — the switch behaves like a hub.", p, "copy delivered to Gi1/0/5 (attacker)", "ATK"), p, `table full in ${fillMs()} ms`), macCount: FLOOD.tableSize, flooding: true };
  }, "PACKET_SENT"),
  say("portsec-cfg", "Port security", "Port security limits how many source MACs a port may use. The conference-room ports get: switchport port-security, maximum 2, violation shutdown (the default). The attacker reconnects and runs the tool again.", {
    run: (s) => ({ ...s, portSec: { max: 2, mode: "shutdown" }, macCount: 6, flooding: false }),
  }),
  say("predict-violation", "Predict: the third MAC", "The first two fake MACs are learned on Gi1/0/5. The third arrives.", {
    question: q("With violation mode shutdown, what happens?", [["err", "The port goes err-disabled — no traffic at all until an admin recovers it"], ["drop", "Only frames from the third MAC are dropped"], ["log", "A log message is sent, and the frame is forwarded"], ["age", "The oldest MAC is replaced"]], "err", "Shutdown (the default) err-disables the port. Restrict drops the excess frames and logs/counts them; protect drops them silently."),
  }),
  act("violation", "Violation: err-disabled", "MAC #3 triggers a violation. Gi1/0/5 goes err-disabled and the switch logs %PORT_SECURITY-2-PSECURE_VIOLATION. The MAC table never fills.", (s) => {
    const action = portSecurityAction(s.portSec, 2);
    const p = frame("viol-p", "ATK", "ACC-SW", "Flood frame", "Fake source MAC #3", [["Source MAC", "1a2b.3c4d.0003"], ["Destination MAC", "ffff.ffff.ffff"], ["Payload", "flood tool"]]);
    return { ...acted(s, swHop("violation", "Gi1/0/5", "sec", { sec: `MACs on port: 2/2 → #3 → ${action}`, fwd: "port err-disabled" }, "Port security: Gi1/0/5", `maximum 2 · violation ${s.portSec?.mode}`, action.toUpperCase(), "The limit caps a port at a sensible number of devices — enough for a phone and a PC, never thousands.", p, "%PM-4-ERR_DISABLE: psecure-violation on Gi1/0/5"), p, "Gi1/0/5 err-disabled"), errDisabled: [...s.errDisabled, "Gi1/0/5"], violations: s.violations + 1, atkPort: "Gi1/0/6" };
  }, "PACKET_DROPPED"),
  say("modes", "Three violation modes", "protect drops frames from extra MACs silently; restrict drops them and counts and logs each violation; shutdown err-disables the port (recover with shutdown / no shutdown, or errdisable recovery). Sticky learning saves the learned MACs into the configuration. The attacker moves to the next free jack, Gi1/0/6."),
  say("predict-dhcp", "Predict: two DHCP servers", `The attacker now runs a DHCP server on Gi1/0/6 that offers its own address (${IP.atk}) as the default gateway. PC2 boots and broadcasts a DISCOVER. The real server is reached through R1's relay.`, {
    question: q("Which OFFER does PC2 accept?", [["first", "The first one to arrive — the attacker's, on the same switch"], ["legit", "The real server's, because it is authoritative"], ["both", "Both, keeping two addresses"], ["none", "Neither, because two servers conflict"]], "first", `DHCP has no authentication: the client takes the first OFFER. The rogue answers in ${OFFERS.rogueMs} ms on the same switch; the relayed answer takes ${OFFERS.legitMs} ms.`),
  }),
  act("rogue-dhcp", "Rogue DHCP", `The attacker's OFFER arrives first (${OFFERS.rogueMs} ms vs ${OFFERS.legitMs} ms). PC2 takes it: its default gateway is now ${IP.atk} — every packet PC2 sends off the subnet goes through the attacker.`, (s) => {
    const w = dhcpWinner(s, s.atkPort);
    const p = frame("rogue-p", "ATK", "PC2", "DHCP OFFER", `DHCP OFFER from ${IP.atk} · router ${IP.atk}`, [["Source MAC", MAC.atk], ["Destination MAC", MAC.pc2], ["Your IP", IP.pc2], ["Router (option 3)", IP.atk]], C.app, "IP");
    return { ...acted(s, swHop("rogue-dhcp", s.atkPort, "inspect", { inspect: "DHCP snooping off — every OFFER forwarded", fwd: `OFFER from ${s.atkPort} → PC2` }, `DHCP: OFFER on ${s.atkPort}`, `${w.server} offer first`, "FORWARD", "Without snooping, the switch can't tell a server port from a user port.", p, `PC2 gateway = ${IP.atk}`, "PC2"), p, "PC2 took the rogue offer"), pc2Gateway: IP.atk };
  }, "PACKET_SENT"),
  act("snooping", "DHCP snooping", "ip dhcp snooping on VLAN 10, with the uplink Gi1/0/48 trusted. Every other port is untrusted: server messages (OFFER, ACK) arriving there are dropped. PC1 and PC2 renew their leases, and snooping records each binding.", (s) => {
    const n0: L2State = { ...s, snooping: true, trusted: ["Gi1/0/48"] };
    const w = dhcpWinner(n0, n0.atkPort);
    const bindings: Binding[] = [
      { mac: MAC.pc1, ip: IP.pc1, vlan: 10, port: "Gi1/0/1" },
      { mac: MAC.pc2, ip: IP.pc2, vlan: 10, port: "Gi1/0/2" },
    ];
    const p = frame("snoop-p", "ATK", "ACC-SW", "DHCP OFFER", `DHCP OFFER from ${IP.atk} on untrusted ${s.atkPort}`, [["Source MAC", MAC.atk], ["Destination MAC", MAC.pc2], ["Router (option 3)", IP.atk]], C.app, "IP");
    return { ...acted(n0, swHop("snooping", n0.atkPort, "inspect", { inspect: `OFFER on untrusted ${n0.atkPort} → drop; OFFER on trusted Gi1/0/48 → forward`, mac: `bindings: ${bindings.length}` }, `DHCP snooping: OFFER on ${n0.atkPort}`, w.dropped ? "untrusted port — dropped" : "forwarded", "DROP", "Only trusted ports — toward the real servers — may send OFFERs and ACKs.", p, `PC2 gateway = ${IP.gw} (real)`), p, "rogue OFFER dropped"), bindings, pc2Gateway: IP.gw };
  }, "PACKET_DROPPED"),
  say("predict-arp", "Predict: a forged ARP reply", `The attacker sends PC1 an unsolicited ARP reply: '${IP.gw} is at ${MAC.atk}'.`, {
    question: q("Without any protection, what does PC1 do?", [["update", "Updates its ARP cache and sends its gateway traffic to the attacker"], ["ignore", "Ignores it because it didn't ask"], ["verify", "Checks with the real gateway first"], ["alert", "Raises a duplicate-address alarm and stops"]], "update", "ARP has no authentication, and most hosts accept unsolicited replies (gratuitous ARP). That's the basis of ARP spoofing — a man-in-the-middle."),
  }),
  act("arp-spoof", "ARP spoofing", `PC1 believes the forged reply. Its cache now maps ${IP.gw} → ${MAC.atk}: traffic to the gateway goes to the attacker first.`, (s) => {
    const v = daiCheck(s, s.atkPort, IP.gw, MAC.atk);
    const p = frame("arp-p", "ATK", "PC1", "ARP reply", `ARP reply · ${IP.gw} is-at ${MAC.atk}`, [["Source MAC", MAC.atk], ["Destination MAC", MAC.pc1], ["Sender IP", IP.gw], ["Sender MAC", MAC.atk]], C.arp, "ARP");
    return { ...acted(s, swHop("arp-spoof", s.atkPort, "inspect", { inspect: v.why, fwd: "forward to PC1" }, `ARP: ${IP.gw} is-at ${MAC.atk}`, v.why, "FORWARD", "The switch forwards ARP like any frame unless it is told to inspect it.", p, `PC1: ${IP.gw} → ${MAC.atk}`, "PC1"), p, "PC1 poisoned"), pc1ArpGw: MAC.atk };
  }, "PACKET_SENT"),
  act("dai", "Dynamic ARP inspection", "ip arp inspection on VLAN 10. ARPs on untrusted ports are checked against the DHCP snooping bindings. The attacker sends the forged reply again: no binding says the gateway's address lives on Gi1/0/6 with that MAC, so it is dropped. PC1's entry ages out and is relearned from the real gateway.", (s) => {
    const n0 = { ...s, dai: true };
    const v = daiCheck(n0, n0.atkPort, IP.gw, MAC.atk);
    const p = frame("dai-p", "ATK", "ACC-SW", "ARP reply", `ARP reply · ${IP.gw} is-at ${MAC.atk}`, [["Source MAC", MAC.atk], ["Destination MAC", MAC.pc1], ["Sender IP", IP.gw], ["Sender MAC", MAC.atk]], C.arp, "ARP");
    return { ...acted(n0, swHop("dai", n0.atkPort, "inspect", { inspect: `DAI: ${v.why} → ${v.ok ? "permit" : "drop"}` }, `DAI: ${IP.gw} / ${MAC.atk} on ${n0.atkPort}`, v.why, v.ok ? "PERMIT" : "DROP", "DAI reuses the snooping table: an ARP may only claim the address that DHCP actually gave that port.", p, "%SW_DAI-4-DHCP_SNOOPING_DENY"), p, "forged ARP dropped"), pc1ArpGw: MAC.gw };
  }, "PACKET_DROPPED"),
  act("ra-spoof", "A rogue IPv6 router", "The attacker now sends IPv6 router advertisements announcing itself as a router. PC1's IPv6 stack, enabled by default, adopts fe80::bad as a default router — a man-in-the-middle for any IPv6 traffic.", (s) => {
    const p = frame("ra-p", "ATK", "PC1", "ICMPv6 RA", "Router Advertisement from fe80::bad · prefix 2001:db8:bad::/64", [["Source MAC", MAC.atk], ["Destination MAC", "3333.0000.0001 (all nodes)"], ["Router lifetime", "1800 s"], ["Prefix", "2001:db8:bad::/64"]], C.ip, "IPV6");
    return { ...acted(s, swHop("ra-spoof", s.atkPort, "inspect", { inspect: "no RA Guard — RA forwarded", fwd: "flood to all hosts" }, "ICMPv6: Router Advertisement", "forwarded", "FORWARD", "Hosts trust any RA on their link; IPv4-only defences don't see it.", p, "PC1 IPv6 router = fe80::bad", "PC1"), p, "PC1 adopted fe80::bad"), pc1V6Router: "fe80::bad (ATK)" };
  }, "PACKET_SENT"),
  act("ra-guard", "RA Guard", "An RA Guard policy with device-role host goes on every access port: router advertisements arriving there are dropped. Only the uplink, toward the real router, may carry them.", (s) => {
    const n0 = { ...s, raGuard: true };
    const p = frame("rag-p", "ATK", "ACC-SW", "ICMPv6 RA", "Router Advertisement from fe80::bad", [["Source MAC", MAC.atk], ["Destination MAC", "3333.0000.0001"], ["Router lifetime", "1800 s"]], C.ip, "IPV6");
    return { ...acted(n0, swHop("ra-guard", n0.atkPort, "inspect", { inspect: `RA Guard: ${n0.atkPort} role host → drop RA` }, `RA Guard: ${n0.atkPort}`, "host port — RA not allowed", "DROP", "RA Guard is to IPv6 router advertisements what DHCP snooping is to DHCP offers.", p, "RA dropped"), p, "rogue RA dropped"), pc1V6Router: "fe80::1 (R1)" };
  }, "PACKET_DROPPED"),
  act("storm", "A broadcast storm", `Someone plugs a small unmanaged switch into Gi1/0/2 and loops it with a spare cable. Broadcasts multiply to ${STORM.broadcastPct}% of the 1 Gb/s port. storm-control broadcast level ${STORM.levelPct} lets ${STORM.levelPct}% through and drops the rest — ${stormDroppedPct()}% of the storm — so the VLAN stays usable.`, (s) => {
    const n0 = { ...s, storm: { level: STORM.levelPct }, stormSeen: true };
    const p = frame("storm-p", "PC2", "ACC-SW", "Broadcast", `Broadcast storm · ${STORM.broadcastPct}% of 1 Gb/s on Gi1/0/2`, [["Source MAC", "(looped copies)"], ["Destination MAC", "ffff.ffff.ffff"], ["Rate", `${(STORM.linkMbps * STORM.broadcastPct) / 100} Mb/s`]]);
    return acted(n0, swHop("storm", "Gi1/0/2", "sec", { sec: `broadcast ${STORM.broadcastPct}% > level ${STORM.levelPct}% → drop ${stormDroppedPct()}%` }, "Storm control: Gi1/0/2", `${STORM.broadcastPct}% offered, ${STORM.levelPct}% allowed`, "RATE-LIMIT", "Storm control caps broadcast (or multicast/unknown unicast) per port; it can also shut the port or send a trap. STP (BPDU Guard) is what removes the loop itself.", p, `${STORM.levelPct}% forwarded · ${stormDroppedPct()}% dropped`), p, `${stormDroppedPct()}% dropped`);
  }, "PACKET_DROPPED"),
  // incident
  act("fault-injected", "Monday: nobody can print", `DAI went live on all of VLAN 10 over the weekend. The floor printer (${IP.prn}) has a static address. Since Monday, every print job times out.`, (s) => ({ ...s, printer: true, printerReachable: false, faultActive: true, packet: undefined, flood: [], decision: { device: "ACC-SW", text: "%SW_DAI-4-DHCP_SNOOPING_DENY on Gi1/0/20" } }), "STEP_ENTERED"),
  act("inc-print", "PC1 tries to print", `PC1 ARPs for ${IP.prn}; the printer answers from Gi1/0/20.`, (s) => {
    const v = daiCheck(s, "Gi1/0/20", IP.prn, MAC.prn);
    const p = frame("prn-p", "PRN", "ACC-SW", "ARP reply", `ARP reply · ${IP.prn} is-at ${MAC.prn}`, [["Source MAC", MAC.prn], ["Destination MAC", MAC.pc1], ["Sender IP", IP.prn], ["Sender MAC", MAC.prn]], C.arp, "ARP");
    return { ...acted(s, swHop("inc-print", "Gi1/0/20", "inspect", { inspect: `DAI: ${v.why} → ${v.ok ? "permit" : "drop"}` }, `DAI: ${IP.prn} / ${MAC.prn} on Gi1/0/20`, v.why, v.ok ? "PERMIT" : "DROP", "DAI checks every ARP on an untrusted port — honest ones included.", p, v.ok ? "PC1 learns the printer" : "PC1: ARP incomplete"), p, v.ok ? "printer reachable" : "printer's ARP dropped"), printerReachable: v.ok };
  }, "PACKET_DROPPED"),
  say("trouble-question", "Diagnose", "show ip arp inspection statistics vlan 10 shows the drop count rising; the log names Gi1/0/20. show ip dhcp snooping binding lists PC1 and PC2 only.", {
    question: q("Why are the printer's ARP replies dropped?", [["nobind", "It has a static address, so no DHCP snooping binding exists for it — DAI has nothing to validate it against"], ["spoof", "The printer is spoofing the gateway"], ["portsec", "Port security err-disabled Gi1/0/20"], ["storm", "Storm control is dropping its broadcasts"]], "nobind", "DAI's table comes from DHCP. A statically addressed host never did DHCP, so it has no binding, and every ARP it sends looks like a forgery.", ["Where does DAI get its IP-MAC pairs from?", "Did the printer ever send a DHCP request?", "Which hosts are in the binding table?"]),
  }),
  say("diagnostic-layers", "Troubleshooting layers", "Check from the port up: link and port security, storm control, then the DHCP snooping bindings that DAI depends on."),
  repairStep("repair-challenge", "Repair", "Choose the change that fixes the cause.", L2_REPAIR_CORRECT, (s) => ({ ...s, arpAcl: [{ ip: IP.prn, mac: MAC.prn }], decision: { device: "ACC-SW", text: "arp access-list STATIC · permit ip host 10.1.10.200 mac host 0050.56aa.0200 · ip arp inspection filter STATIC vlan 10" } })),
  act("verify", "Proof", "PC1 ARPs for the printer again. DAI finds the static entry and permits the reply; the attacker's forged gateway ARP is still dropped.", (s) => {
    const v = daiCheck(s, "Gi1/0/20", IP.prn, MAC.prn);
    const p = frame("ver-p", "PRN", "PC1", "ARP reply", `ARP reply · ${IP.prn} is-at ${MAC.prn}`, [["Source MAC", MAC.prn], ["Destination MAC", MAC.pc1], ["Sender IP", IP.prn], ["Sender MAC", MAC.prn]], C.arp, "ARP");
    return { ...acted(s, swHop("verify", "Gi1/0/20", "inspect", { inspect: `DAI: ${v.why} → permit` }, `DAI: ${IP.prn} / ${MAC.prn} on Gi1/0/20`, v.why, v.ok ? "PERMIT" : "DROP", "Exceptions belong in an exact IP-MAC entry, not in a trusted port that would accept anything.", p, "PC1 learns the printer", "PC1"), p, "printer reachable"), printerReachable: v.ok };
  }, "PACKET_SENT"),
  say("complete", "Layer 2 security", "Port security caps MACs per port; DHCP snooping trusts only server-facing ports and builds the binding table; DAI checks ARPs against it (with static entries for static hosts); RA Guard blocks rogue IPv6 routers; storm control caps broadcast floods."),
];
