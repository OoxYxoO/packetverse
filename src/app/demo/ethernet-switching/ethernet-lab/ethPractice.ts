import type { CliVendor } from "@/lib/cli/types";
import { BROADCAST_MAC, ETH_MAC } from "@/lib/sim-engine/scenarios/ethernetSwitching";
import { hostLink, nicMacOf, portNeighbor, swTable, type EthCapture, type EthLabState, type EthTicketId } from "@/lib/sim-engine/scenarios/ethernetLab";
import { ethPortName } from "./ethLabCli";

/**
 * Troubleshooting and practice, judged only from the lab's evidence (tables, links, configuration, captures). A wrong
 * hypothesis gets the evidence that contradicts it, read from the network at that moment — never just "incorrect".
 */

const A = ETH_MAC["HOST-A"];
const B = ETH_MAC["HOST-B"];
const C = ETH_MAC["HOST-C"];
const entry = (s: EthLabState, mac: string) => swTable(s, "SW1").find((e) => e.mac === mac);
const after = (s: EthLabState, mark: number) => s.captures.filter((c) => c.no > mark);
const deliveredAB = (cs: EthCapture[]) => cs.some((c) => c.dev === "HOST-B" && c.dir === "in" && c.src === A && c.dst === B && /accepted/.test(c.note ?? ""));

// ---------------------------------------------------------------------------------------------------------------
// Tickets
// ---------------------------------------------------------------------------------------------------------------
export type EthCause = "cable" | "stale" | "static" | "dup" | "silent" | "nic" | "aging" | "desk";
export const ETH_CAUSES: { id: EthCause; label: string }[] = [
  { id: "cable", label: "HOST-B has no link: cable unplugged or port shut down" },
  { id: "stale", label: "SW1 learned HOST-B on a port where HOST-B no longer is (stale entry)" },
  { id: "static", label: "A configured (static) entry sends HOST-B's frames to the wrong port" },
  { id: "dup", label: "Two network cards use HOST-B's MAC address" },
  { id: "silent", label: "SW1 doesn't know HOST-B (it hasn't sent recently), so frames for it are flooded" },
  { id: "nic", label: "HOST-B's network card discards frames addressed to it" },
  { id: "aging", label: "SW1's aging time is too short" },
  { id: "desk", label: "DESK-SW is dropping the frames" },
];
export const TICKET_CAUSE: Record<EthTicketId, EthCause> = { cable: "cable", stale: "stale", static: "static", dupmac: "dup", flood: "silent" };

/** Why this hypothesis does or doesn't fit, from what the network shows right now. */
export function causeFeedback(s: EthLabState, cause: EthCause, vendor: CliVendor): string {
  const b = hostLink(s, "HOST-B");
  const e = entry(s, B);
  const pn = (p: string) => ethPortName(vendor, p);
  const where = b.sw === "SW1" ? `SW1 ${pn(b.port)}` : `DESK-SW ${b.port}`;
  const cloned = (Object.keys(s.nicMac) as (keyof typeof s.nicMac)[]).filter((h) => s.nicMac[h] === B);
  switch (cause) {
    case "cable":
      return b.up ? `HOST-B's link is up: its cable is in ${where}, and that port is ${b.sw === "SW1" ? "connected (show interfaces status)" : "lit"}.` : `Right: ${where} has no link (${b.plugged ? "the port is shut down" : "the cable is unplugged"}). SW1 flushed what it had learned there, and frames for HOST-B have nowhere to go.`;
    case "stale":
      if (!e) return "SW1 has no entry for HOST-B at all, so nothing can be stale: frames for HOST-B are flooded (look at its table).";
      if (e.type === "static") return `SW1's entry for HOST-B is STATIC (configured), not learned: it can't be stale in the learning sense, and HOST-B sending won't change it.`;
      if (b.sw === "SW1" ? e.port === b.port : e.port === "ge-0/0/4") return `SW1's entry for HOST-B points to ${pn(e.port)}, which is the right direction for ${where}.`;
      {
        const clone = cloned.find((h) => hostLink(s, h).sw === "SW1" && hostLink(s, h).port === e.port);
        if (clone) return `That entry isn't left over from the past: it is ${e.age} s old, so a frame with HOST-B's MAC really did arrive on ${pn(e.port)} just now — and ${pn(e.port)} is ${clone}'s port. Who is sending with HOST-B's address?`;
      }
      return `Right: SW1's table says HOST-B is behind ${pn(e.port)}, but HOST-B is plugged into ${where}. ${e.port === "ge-0/0/4" ? `${pn("ge-0/0/4")} never went down, so nothing flushed the old entry, and HOST-B hasn't sent from its new port yet.` : ""}`;
    case "static":
      return e?.type === "static" ? (e.port === (b.sw === "SW1" ? b.port : "ge-0/0/4") ? `There is a static entry for HOST-B, but it points to the right port (${pn(e.port)}).` : `Right: a static entry pins HOST-B to ${pn(e.port)} (show mac address-table static / show configuration). Static entries never age and are never relearned, so HOST-B sending can't correct it.`) : "SW1 has no static entry for HOST-B (show mac address-table static is empty for it): everything about HOST-B was learned.";
    case "dup":
      return cloned.length ? `Right: ${cloned.join(", ")} uses ${B}, HOST-B's MAC. SW1 learns that MAC wherever the last frame from it came in, so it keeps moving (${vendor === "cisco" ? "show logging: MAC flapping" : "show ethernet-switching mac-learning-log: moving back and forth"}) and frames for HOST-B go to whichever NIC spoke last.` : `Every NIC uses its own burned-in MAC (HOST-A ${nicMacOf(s, "HOST-A")}, HOST-B ${nicMacOf(s, "HOST-B")}, HOST-C ${nicMacOf(s, "HOST-C")}), and SW1's log shows no MAC moving back and forth.`;
    case "silent":
      if (!e && !b.up) return `SW1 has no entry for HOST-B, but not because HOST-B is quiet: ${where} has no link, so SW1 flushed it and nothing can come from there. Why is there no link?`;
      return !e ? "Right: SW1 has no entry for HOST-B, so every frame for it is unknown unicast and is flooded to every port, HOST-C's included. HOST-C's NIC discards them, but its capture sees them. HOST-B simply hasn't sent anything for longer than the aging time." : `SW1 knows HOST-B (behind ${pn(e.port)}${e.type === "static" ? ", static" : `, ${e.age} s old`}), so frames for it are not flooded: they go to exactly one port.`;
    case "nic":
      return `HOST-B's NIC accepts frames whose destination is ${nicMacOf(s, "HOST-B")} (its own MAC) and broadcasts. When a frame for it reaches HOST-B, its capture shows "accepted" — the question is whether the frame reaches HOST-B at all.`;
    case "aging":
      return `SW1's aging time is ${s.cfg.aging} s${s.cfg.aging === 300 ? " (the default)" : ""}. Aging only removes entries of hosts that stay silent; it can't send a frame to the wrong place.`;
    case "desk":
      return "DESK-SW is a learning switch like SW1: it floods what it doesn't know and forwards what it does. Look at what SW1 sent it, and why SW1 sent it there.";
  }
}

export interface Proof {
  label: string;
  ok: boolean;
}
/** Is the ticket's fault gone, and has a frame proved it? Read from the network (mark = capture number when the fix started). */
export function ticketProofs(s: EthLabState, id: EthTicketId, mark: number, vendor: CliVendor): Proof[] {
  const cs = after(s, mark);
  const b = hostLink(s, "HOST-B");
  const e = entry(s, B);
  const pn = (p: string) => ethPortName(vendor, p);
  const right = b.sw === "SW1" ? b.port : "ge-0/0/4";
  const delivered: Proof = { label: "A frame from HOST-A was accepted by HOST-B (HOST-B's capture)", ok: deliveredAB(cs) };
  switch (id) {
    case "cable":
      return [{ label: `HOST-B has link again (SW1 ${pn("ge-0/0/2")} up)`, ok: b.up && !!portNeighbor(s, "SW1", "ge-0/0/2") }, delivered, { label: `SW1 knows HOST-B behind ${pn("ge-0/0/2")}`, ok: e?.port === "ge-0/0/2" }];
    case "stale":
      return [{ label: `SW1's entry for HOST-B is gone or points to ${pn(right)}`, ok: !e || e.port === right }, delivered, { label: `SW1 knows HOST-B behind ${pn(right)} again`, ok: e?.port === right }];
    case "dupmac":
      return [{ label: "Only HOST-B uses HOST-B's MAC", ok: !(["HOST-A", "HOST-C"] as const).some((h) => nicMacOf(s, h) === B) }, delivered, { label: "HOST-C did not accept that frame", ok: deliveredAB(cs) && !cs.some((c) => c.dev === "HOST-C" && c.dir === "in" && c.dst === B && /accepted/.test(c.note ?? "")) }, { label: `SW1 knows HOST-B behind ${pn("ge-0/0/2")}`, ok: e?.port === "ge-0/0/2" }];
    case "static":
      return [{ label: "No static entry sends HOST-B to the wrong port", ok: !(e?.type === "static" && e.port !== right) }, delivered];
    case "flood":
      return [{ label: `SW1 knows HOST-B behind ${pn(right)}`, ok: e?.port === right }, { label: "A frame from HOST-A reached HOST-B, and HOST-C's capture got no copy of it", ok: deliveredAB(cs) && !cs.some((c) => c.dev === "HOST-C" && c.dir === "in" && c.src === A && c.dst === B) }];
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Practice: make the network do something, then prove it
// ---------------------------------------------------------------------------------------------------------------
export interface Challenge {
  id: string;
  title: string;
  task: string;
  hint: string;
  /** Met, judged from state and the captures after the challenge started. */
  done: (s: EthLabState, mark: { cap: number; log: number }) => boolean;
  /** What proves it, once met. */
  proof: string;
}
const inSince = (s: EthLabState, m: number, f: (c: EthCapture) => boolean) => after(s, m).some(f);
export const ETH_CHALLENGES: Challenge[] = [
  {
    id: "teach",
    title: "Teach SW1 where everyone is",
    task: "Get SW1's table to hold all three hosts, each on its own port, without typing a configuration command.",
    hint: "A switch learns only from the SOURCE of frames that arrive. Who has to send?",
    done: (s) => ["ge-0/0/1", "ge-0/0/2", "ge-0/0/3"].every((p, i) => swTable(s, "SW1").some((e) => e.mac === [A, B, C][i] && e.port === p && e.type === "dynamic")),
    proof: "SW1's table (and show mac address-table) lists HOST-A, HOST-B and HOST-C on their own ports.",
  },
  {
    id: "leak",
    title: "Make HOST-C see a frame meant for HOST-B",
    task: "Send no frame to HOST-C, yet get HOST-C's network card to receive (and discard) a frame addressed to HOST-B.",
    hint: "When does a switch send a frame out of ports that don't lead to its destination?",
    done: (s, m) => inSince(s, m.cap, (c) => c.dev === "HOST-C" && c.dir === "in" && c.dst === B && /discarded/.test(c.note ?? "")),
    proof: "HOST-C's capture shows a frame for HOST-B, discarded by its NIC.",
  },
  {
    id: "private",
    title: "Deliver HOST-A → HOST-B on one port only",
    task: "Send a frame from HOST-A to HOST-B that leaves SW1 only on HOST-B's port.",
    hint: "What must SW1 already know for a frame to be forwarded instead of flooded?",
    done: (s, m) => inSince(s, m.cap, (c) => c.dev === "SW1" && c.dir === "in" && c.src === A && c.dst === B && /known → ge-0\/0\/2/.test(c.note ?? "")),
    proof: "SW1's capture on HOST-A's port shows the frame forwarded to HOST-B's port only; HOST-C's capture has no copy.",
  },
  {
    id: "stale",
    title: "Create a stale entry",
    task: "Without any configuration, make SW1 send a frame for HOST-B out of a port where HOST-B isn't.",
    hint: "A port that goes down flushes what was learned on it. A port that stays up doesn't. Where could HOST-B be learned that stays up?",
    done: (s, m) => inSince(s, m.cap, (c) => c.dev === "SW1" && c.dir === "in" && c.dst === B && /known → ge-0\/0\/4/.test(c.note ?? "")) && s.net.hostB === "SW1 ge-0/0/2",
    proof: "SW1 forwarded a frame for HOST-B out ge-0/0/4 while HOST-B is plugged into ge-0/0/2.",
  },
  {
    id: "forget",
    title: "Make SW1 forget a host, from the CLI",
    task: "Use SW1's command line to remove what it learned about HOST-B, then prove the next frame for HOST-B is flooded.",
    hint: "IOS: clear mac address-table dynamic … · Junos: clear ethernet-switching table …",
    done: (s, m) => inSince(s, m.cap, (c) => c.dev === "SW1" && c.dir === "in" && c.dst === B && /unknown → flood/.test(c.note ?? "")) && s.log.some((l) => l.id > m.log && /SW1 cleared .*HOST-B/.test(l.text)),
    proof: "SW1's log shows the entry cleared, and its capture shows the next frame for HOST-B flooded (unknown).",
  },
  {
    id: "age",
    title: "Make SW1 forget HOST-C without touching it",
    task: "Remove HOST-C from SW1's table without unplugging anything, shutting a port, or clearing the table.",
    hint: "What removes an entry when its host simply stays quiet? Can you change how long that takes?",
    done: (s, m) => !swTable(s, "SW1").some((e) => e.mac === C) && hostLink(s, "HOST-C").up && !s.log.some((l) => l.id > m.log && /cleared/.test(l.text)) && s.log.some((l) => l.id > m.log && /HOST-C on .* expired|removed .*HOST-C/.test(l.text)),
    proof: "SW1's table no longer has HOST-C: it aged out (the log shows it expired).",
  },
  {
    id: "pin",
    title: "Pin HOST-B, then see the price",
    task: "Configure SW1 so a frame for HOST-B is never flooded, even after HOST-B stays silent longer than the aging time. Prove it. Then move HOST-B to the hot desk and watch what that configuration does.",
    hint: "IOS: mac address-table static … · Junos: set vlans default switch-options interface … static-mac …, then commit.",
    done: (s, m) => s.cfg.statics.some((x) => x.mac === B && x.port === "ge-0/0/2") && s.log.some((l) => l.id > m.log && /pass \(lab clock/.test(l.text)) && inSince(s, m.cap, (c) => c.dev === "SW1" && c.dir === "in" && c.dst === B && /known → ge-0\/0\/2/.test(c.note ?? "")),
    proof: "A static entry for HOST-B, time passed, and the next frame for HOST-B still went out its port only.",
  },
];
export const isBroadcastFrame = (c: EthCapture) => c.dst === BROADCAST_MAC;
