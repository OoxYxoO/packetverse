import type { PacketVisual, ScenarioStep } from "../../types";
import type { ProcessingStage } from "@/components/network3d/types";
import { act, acted, hop, kitBase, layer, packet, q, repairStep, say, stackOf, withDetail, type KitBase } from "./kit";

/**
 * NTP, Syslog & SNMP (CCNA 4.2, 4.4, 4.5). The operations triad: one clock, one log, one monitoring system.
 * NTP-PUB (stratum 1) → CORE (stratum 2) → R1, FW1, SW1 (stratum 3); SYSLOG and NMS servers in the data center.
 *
 * Modeled (computed):
 * - NTP: from the four timestamps t1 (client send), t2 (server receive), t3 (server send), t4 (client receive),
 *   offset = ((t2 − t1) + (t3 − t4)) / 2 and delay = (t4 − t1) − (t3 − t2). Path asymmetry shows up as residual error.
 *   A device's stratum is its server's + 1; an unsynchronised device is stratum 16.
 * - Syslog: severity 0 (emergency) – 7 (debugging); logging trap N sends severities 0..N. Each message carries the
 *   device's own clock — so unsynchronised clocks scramble a multi-device timeline.
 * - SNMP: utilisation from two counter polls: Δoctets × 8 / (Δt × ifSpeed); traps are unsolicited (UDP 162).
 */

export type Dev = "CORE" | "R1" | "FW1" | "SW1";
export interface Clock {
  /** Device clock minus true time, in seconds. */
  offset: number;
  stratum: number;
  server?: string;
  synced: boolean;
}
export interface LogLine {
  dev: string;
  sev: number;
  mnemonic: string;
  text: string;
  /** The device's own timestamp (seconds after 14:00:00 true time + its offset). */
  stamp: number;
  /** True time it happened (for the lesson's explanations). */
  trueAt: number;
}
export interface OpsState extends KitBase {
  clocks: Record<Dev, Clock>;
  trapLevel: number;
  logs: LogLine[];
  snmp: { t: number; octets: number }[];
  ntpLast?: { t1: number; t2: number; t3: number; t4: number; offset: number; delay: number };
}
export const ADDR = { pub: "192.0.2.123", core: "10.0.0.1", oldNtp: "10.9.9.10", syslog: "10.50.0.20", nms: "10.50.0.30", sw1: "10.0.0.11" };
export const SEVERITY = ["emergencies", "alerts", "critical", "errors", "warnings", "notifications", "informational", "debugging"];
export function createOpsState(): OpsState {
  return {
    ...kitBase(),
    clocks: { CORE: { offset: 0.734, stratum: 16, server: ADDR.pub, synced: false }, R1: { offset: 2.1, stratum: 16, server: ADDR.core, synced: false }, FW1: { offset: -1.4, stratum: 16, server: ADDR.core, synced: false }, SW1: { offset: 0.9, stratum: 16, server: ADDR.core, synced: false } },
    trapLevel: 4,
    logs: [],
    snmp: [],
  };
}
const r3 = (x: number) => Math.round(x * 1000) / 1000;
/** One NTP exchange: client clock offset `off`, one-way delays out/back, server processing. */
export function ntpExchange(off: number, out = 0.012, back = 0.018, proc = 0.001, T0 = 100) {
  const t1 = T0 + off;
  const t2 = T0 + out;
  const t3 = t2 + proc;
  const t4 = T0 + out + proc + back + off;
  const offset = (t2 - t1 + (t3 - t4)) / 2;
  const delay = t4 - t1 - (t3 - t2);
  return { t1: r3(t1), t2: r3(t2), t3: r3(t3), t4: r3(t4), offset: r3(offset), delay: r3(delay) };
}
/** Sync a device to its server: residual error = path asymmetry / 2 (from the exchange). */
function sync(s: OpsState, d: Dev, serverStratum: number): OpsState {
  const c = s.clocks[d];
  const ex = ntpExchange(c.offset);
  return { ...s, ntpLast: ex, clocks: { ...s.clocks, [d]: { ...c, offset: r3(c.offset + ex.offset), stratum: serverStratum + 1, synced: true } } };
}
export const passes = (s: OpsState, sev: number) => sev <= s.trapLevel;
export const fmtTime = (secAfter14: number) => {
  const total = Math.round((14 * 3600 + secAfter14) * 1000) / 1000;
  const h = Math.floor(total / 3600) % 24;
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${sec.toFixed(3).padStart(6, "0")}`;
};
/** An event on a device: the messages it generates; those passing the trap level reach the syslog server. */
function event(s: OpsState, dev: Dev, trueAt: number, msgs: [number, string, string][]): OpsState {
  const sent = msgs.filter(([sev]) => passes(s, sev)).map(([sev, mnemonic, text]) => ({ dev, sev, mnemonic, text, stamp: r3(trueAt + s.clocks[dev].offset), trueAt }));
  return { ...s, logs: [...s.logs, ...sent] };
}
export const IF_SPEED = 1_000_000_000;
export const utilisation = (a: { t: number; octets: number }, b: { t: number; octets: number }) => ((b.octets - a.octets) * 8) / ((b.t - a.t) * IF_SPEED);

// ---------------------------------------------------------------------------------------------------------------
const C = { ip: "#60a5fa", udp: "#34d399", app: "#22d3ee" };
const udp = (id: string, from: string, to: string, badge: string, src: string, dst: string, port: string, fields: [string, string][]): PacketVisual =>
  packet(id, "IP", from, to, badge, `${badge} · ${src} → ${dst}:${port}`, [layer("IPv4 Header", C.ip, [["Source IP", src], ["Destination IP", dst]]), layer("UDP", C.udp, [["Destination Port", port]]), layer(badge, C.app, fields)]);
export const ST = {
  dev: [{ id: "ntp", label: "NTP: poll server, compute offset/delay, adjust clock" }, { id: "log", label: "Syslog: stamp with own clock, filter by severity" }, { id: "snmp", label: "SNMP agent: answer GETs, send traps" }],
  srv: [{ id: "rx", label: "Receive" }, { id: "store", label: "Store / answer" }],
} satisfies Record<string, ProcessingStage[]>;

export const OPS_REPAIR_OPTIONS = [
  { id: "ntp-core", label: "Point SW1's NTP at CORE (ntp server 10.0.0.1)" },
  { id: "clock-set", label: "Set SW1's clock by hand to the right time" },
  { id: "tz", label: "Change the syslog server's time zone" },
  { id: "buffer", label: "Increase SW1's logging buffer" },
];
export const OPS_REPAIR_CORRECT = "ntp-core";

type Step = ScenarioStep<OpsState>;
const flap = (s: OpsState, dev: Dev, trueAt: number, ifName: string) =>
  event(s, dev, trueAt, [
    [3, "LINK-3-UPDOWN", `Interface ${ifName}, changed state to down`],
    [5, "LINEPROTO-5-UPDOWN", `Line protocol on Interface ${ifName}, changed state to down`],
  ]);

export const opsSteps: Step[] = [
  say("intro", "When something breaks, you need three things", "A trustworthy clock on every device, every device's log in one place, and numbers about how the network is doing. NTP, syslog and SNMP provide them — and they depend on each other: a log line is only as good as the clock that stamped it."),
  say("stratum", "A hierarchy of clocks", "NTP servers are layered by stratum: stratum 0 is a reference clock (GPS, atomic), stratum 1 servers are attached to one, and every hop below adds 1. A device that isn't synchronised reports stratum 16.", {
    question: q("CORE synchronises to a public stratum 1 server; R1, FW1 and SW1 synchronise to CORE. What stratum are R1, FW1 and SW1?", [["3", "3"], ["2", "2"], ["1", "1"], ["16", "16"]], "3", "Each hop adds one: stratum 1 → CORE stratum 2 → its clients stratum 3. Stratum is distance from the reference, not quality."),
  }),
  act("ntp-core", "CORE asks the time", `CORE sends an NTP request (UDP 123) to ${ADDR.pub}. Four timestamps come back: t1 when CORE sent, t2 when the server received, t3 when the server replied, t4 when CORE received. From them CORE computes how far off its clock is — and how long the round trip took.`, (s) => {
    const n = sync(s, "CORE", 1);
    const ex = n.ntpLast!;
    const p = udp("ntp", "CORE", "NTP-PUB", "NTP", ADDR.core, ADDR.pub, "123", [["Mode", "3 (client) → 4 (server)"], ["t1 / t2", `${ex.t1} / ${ex.t2}`], ["t3 / t4", `${ex.t3} / ${ex.t4}`], ["Offset", `${ex.offset} s`], ["Delay", `${ex.delay} s`]]);
    return acted(n, hop({ stepId: "ntp-core", device: "CORE", stages: withDetail(ST.dev, { ntp: `offset ((t2−t1)+(t3−t4))/2 = ${ex.offset} s · delay ${ex.delay} s → stratum 2` }), activeStageId: "ntp", egressInterfaceId: "Gi0/0", lookupType: "NTP", lookupKey: ADDR.pub, lookupResult: `offset ${ex.offset} s · delay ${ex.delay} s`, action: "SYNC", reason: "Offset and delay come from four timestamps, so the clock can be corrected without knowing the one-way delays. Unequal outbound and return delays leave a small residual error.", input: "poll", output: `clock corrected, residual ${n.clocks.CORE.offset} s`, nextHopId: "NTP-PUB", before: stackOf(p) }), p, `offset ${ex.offset} s`);
  }, "PACKET_SENT"),
  act("ntp-clients", "Everyone follows CORE", "R1, FW1 and SW1 each poll CORE the same way. Within a few polls their clocks agree with CORE to a few milliseconds, and they report stratum 3.", (s) => {
    const n = (["R1", "FW1", "SW1"] as Dev[]).reduce((acc, d) => sync(acc, d, acc.clocks.CORE.stratum), s);
    return acted(n, hop({ stepId: "ntp-clients", device: "R1", stages: withDetail(ST.dev, { ntp: `server ${ADDR.core} · stratum ${n.clocks.R1.stratum} · residual ${n.clocks.R1.offset} s` }), activeStageId: "ntp", lookupType: "NTP", lookupKey: ADDR.core, lookupResult: "synchronised", action: "SYNC", reason: "One internal server distributes time to the rest — fewer queries outside, one source of truth inside.", input: "poll", output: "synchronised" }), undefined, "all devices synchronised");
  }, "STEP_ENTERED"),
  say("severity", "Syslog severity levels", "Every syslog message has a severity from 0 (emergencies) to 7 (debugging). logging trap warnings sends levels 0 through 4 to the server and keeps the rest local.", {
    question: q("With logging trap warnings, which of these reaches the syslog server?", [["link", "%LINK-3-UPDOWN (severity 3, errors) — but not %LINEPROTO-5-UPDOWN"], ["both", "Both messages"], ["proto", "Only %LINEPROTO-5-UPDOWN"], ["none", "Neither"]], "link", "warnings = 4, so severities 0–4 are sent. LINK-3 (errors) passes; LINEPROTO-5 (notifications) is filtered. The number in the mnemonic is the severity."),
  }),
  act("syslog", "R1 logs an interface flap", `R1's Gi0/2 goes down at 14:02:11. It generates two messages, stamps them with its own clock, and sends those passing its trap level to ${ADDR.syslog} on UDP 514.`, (s) => {
    const n = flap(s, "R1", 131, "GigabitEthernet0/2");
    const line = n.logs[n.logs.length - 1];
    const p = udp("syslog", "R1", "SYSLOG", "Syslog", "10.0.0.2", ADDR.syslog, "514", [["Facility", "local7"], ["Severity", `${line.sev} (${SEVERITY[line.sev]})`], ["Timestamp", fmtTime(line.stamp)], ["Message", `%${line.mnemonic}: ${line.text}`]]);
    return acted(n, hop({ stepId: "syslog", device: "R1", stages: withDetail(ST.dev, { log: `2 messages · trap level ${s.trapLevel} → ${n.logs.length - s.logs.length} sent` }), activeStageId: "log", egressInterfaceId: "Gi0/0", lookupType: "Logging", lookupKey: "severity ≤ trap level", lookupResult: `${n.logs.length - s.logs.length} of 2 sent`, action: "SYSLOG", reason: "The device decides what to send; the server just stores what arrives — with the device's timestamp.", input: "interface down", output: p.summary, nextHopId: "SYSLOG", before: stackOf(p) }), p, "%LINK-3-UPDOWN sent");
  }, "PACKET_SENT"),
  act("snmp-poll", "SNMP polls a counter", `The NMS polls SW1's uplink counter ifHCInOctets twice, 300 s apart (SNMP GET, UDP 161, SNMPv3 authPriv). From the difference it computes utilisation.`, (s) => {
    const a = { t: 0, octets: 812_345_678_901 };
    const b = { t: 300, octets: 812_345_678_901 + 13_125_000_000 };
    const u = utilisation(a, b);
    const p = udp("snmp", "NMS", "SW1", "SNMP GET", ADDR.nms, ADDR.sw1, "161", [["Version", "3 (authPriv)"], ["OID", "IF-MIB::ifHCInOctets.49"], ["Value (t=0)", String(a.octets)], ["Value (t=300)", String(b.octets)]]);
    return acted({ ...s, snmp: [a, b] }, hop({ stepId: "snmp-poll", device: "SW1", stages: withDetail(ST.dev, { snmp: `Δ ${b.octets - a.octets} octets × 8 / (300 s × 1 Gb/s) = ${(u * 100).toFixed(1)} %` }), activeStageId: "snmp", ingressInterfaceId: "Vlan99", lookupType: "MIB", lookupKey: "ifHCInOctets.49", lookupResult: `${(u * 100).toFixed(1)} % average`, action: "GET RESPONSE", reason: "Counters only grow; rates come from two readings. Polling every 5 minutes averages away short bursts.", input: p.summary, output: `${(u * 100).toFixed(1)} % utilisation`, nextHopId: "NMS", before: stackOf(p) }), p, `uplink ${(u * 100).toFixed(1)} %`);
  }, "PACKET_RECEIVED"),
  act("snmp-trap", "A trap: the device speaks first", "When SW1's port Gi1/0/10 goes down, SW1 doesn't wait to be polled: it sends a linkDown trap to the NMS on UDP 162.", (s) => {
    const p = udp("trap", "SW1", "NMS", "SNMP trap", ADDR.sw1, ADDR.nms, "162", [["Trap", "linkDown (IF-MIB)"], ["ifIndex", "10"], ["Version", "3"]]);
    return acted(s, hop({ stepId: "snmp-trap", device: "SW1", stages: withDetail(ST.dev, { snmp: "linkDown → trap to NMS" }), activeStageId: "snmp", egressInterfaceId: "Vlan99", lookupType: "Trap", lookupKey: "linkDown", lookupResult: `→ ${ADDR.nms}:162`, action: "TRAP", reason: "Polls give regular numbers; traps give immediate news.", input: "port down", output: p.summary, nextHopId: "NMS", before: stackOf(p) }), p, "linkDown trap");
  }, "PACKET_SENT"),
  say("snmp-versions", "SNMP versions", "SNMPv1 and v2c authenticate with a community string sent in clear text. SNMPv3 adds users with authentication (noAuthNoPriv, authNoPriv) and encryption (authPriv).", {
    question: q("Which configuration protects both the identity of the NMS and the contents of SNMP messages?", [["v3", "SNMPv3 with authPriv"], ["v2c", "SNMPv2c with a long community string"], ["v1", "SNMPv1 read-only"], ["v3noauth", "SNMPv3 noAuthNoPriv"]], "v3", "Only SNMPv3 authPriv both authenticates (HMAC) and encrypts (AES). Community strings travel in clear text, however long."),
  }),
  // incident
  act("fault-injected", "An outage to explain", "At 14:02:10 (true time) a power feed fails in rack B. Links drop across R1, FW1 and SW1. The post-incident review needs one timeline from the syslog server. SW1, replaced last month, was configured from an old template.", (s) => {
    const sw1: Clock = { offset: -11_947.2, stratum: 16, server: ADDR.oldNtp, synced: false };
    const n0 = { ...s, clocks: { ...s.clocks, SW1: sw1 }, logs: [], faultActive: true };
    const n1 = flap(flap(flap(n0, "R1", 131, "GigabitEthernet0/2"), "FW1", 131.4, "ethernet1/3"), "SW1", 130.6, "GigabitEthernet1/0/24");
    return { ...n1, packet: undefined, flood: [], decision: { device: "SYSLOG", text: `${n1.logs.length} messages received` } };
  }, "STEP_ENTERED"),
  act("inc-timeline", "The timeline doesn't make sense", "Sorted by timestamp, the syslog server shows SW1's uplink failing more than three hours before anything else — at a time when nothing happened. Nobody can tell what failed first.", (s) => {
    const sorted = [...s.logs].sort((a, b) => a.stamp - b.stamp);
    return acted(s, hop({ stepId: "inc-timeline", device: "SYSLOG", stages: withDetail(ST.srv, { store: sorted.map((l) => `${fmtTime(l.stamp)} ${l.dev}`).join(" · ") }), activeStageId: "store", lookupType: "Timeline", lookupKey: "sorted by device timestamp", lookupResult: sorted.map((l) => `${l.dev} ${fmtTime(l.stamp)}`).join(", "), action: "TIMELINE", reason: "The server orders events by the timestamps devices put in them.", input: `${s.logs.length} messages`, output: "inconsistent order" }), undefined, `SW1 at ${fmtTime(sorted[0].stamp)}`);
  }, "STEP_ENTERED"),
  say("trouble-question", "Diagnose", "R1 and FW1 report about 14:02:11, within half a second of each other. SW1's message says 10:43:03 — and SW1's show clock agrees with itself.", {
    question: q("What is the most likely cause?", [["ntp", "SW1 isn't synchronised: its NTP server is unreachable, so its clock is wrong"], ["tz", "The syslog server is in the wrong time zone"], ["late", "SW1 sent its logs three hours late"], ["r1", "R1's clock is wrong"]], "ntp", `Only SW1 is off, by about −3 h 19 min, so the server and the other devices are fine. show ntp status on SW1 says unsynchronised, stratum 16: its template points to ${ADDR.oldNtp}, a decommissioned server. Messages are stamped by the sender's clock, not the server's.`, ["Which devices agree with each other?", "Whose clock stamps a syslog message?", "What does show ntp status say on SW1?"]),
  }),
  say("diagnostic-layers", "Troubleshooting layers", "For time: the NTP server's reachability, association state, stratum and offset on each device — then the timestamps in the log."),
  repairStep("repair-challenge", "Repair", "Choose the change that fixes the cause.", OPS_REPAIR_CORRECT, (s) => ({ ...s, clocks: { ...s.clocks, SW1: { ...s.clocks.SW1, server: ADDR.core } }, decision: { device: "SW1", text: "ntp server 10.0.0.1" } })),
  act("verify", "SW1 is in step", "SW1 polls CORE, steps its clock by more than three hours, then fine-tunes to milliseconds; show ntp status: synchronised, stratum 3. A test shutdown of a spare port now logs at the same time on SW1 and on the syslog server.", (s) => {
    const n = sync(s, "SW1", s.clocks.CORE.stratum);
    const n2 = event(n, "SW1", 600, [[3, "LINK-3-UPDOWN", "Interface GigabitEthernet1/0/40, changed state to down"]]);
    const l = n2.logs[n2.logs.length - 1];
    return acted(n2, hop({ stepId: "verify", device: "SW1", stages: withDetail(ST.dev, { ntp: `server ${ADDR.core} · stratum ${n2.clocks.SW1.stratum} · residual ${n2.clocks.SW1.offset} s`, log: `test message stamped ${fmtTime(l.stamp)}` }), activeStageId: "ntp", lookupType: "NTP", lookupKey: ADDR.core, lookupResult: `synchronised · stratum ${n2.clocks.SW1.stratum}`, action: "SYNC", reason: "Fix the clock source, not the clock: a hand-set clock drifts again and isn't verifiable.", input: "poll", output: `stamped ${fmtTime(l.stamp)} for a 14:10:00 event` }), undefined, "SW1 synchronised");
  }, "PACKET_RECEIVED"),
  say("complete", "Operations basics", "NTP from four timestamps and a stratum hierarchy; syslog severities filtered by logging trap and stamped by the sender's clock; SNMP polls for counters and traps for events, with v3 for security — and one clock for everything, or the timeline lies."),
];
