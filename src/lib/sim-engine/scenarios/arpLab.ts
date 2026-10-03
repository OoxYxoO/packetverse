import type { PacketVisual } from "../types";
import type { LabModel } from "@/lib/practice-lab/types";
import { ADDR, SWITCH_PORTS, arpReplyPacket, arpRequestPacket, gatewayFramePacket, type SwitchPortId } from "./firstConnection";

/**
 * ARP LAB — an optional sandbox next to the guided First Connection
 * lesson. Pure data + pure functions, like every scenario file.
 *
 * It deliberately has its OWN state (ArpLabState) rather than reading
 * the guided lesson's ScenarioEngine: the learner drives events
 * explicitly, may reset at any time, and nothing here can touch lesson
 * progress, answers or the guided snapshot. Addresses, ports and
 * packets are imported from firstConnection.ts, so both surfaces share
 * one network truth even though they keep separate state.
 *
 * Topology: the SAME network as the guided lesson — Laptop, Access
 * Switch (SW1), Router (R1), Server. The Server is context only: it
 * lives on 10.20.20.0/24, outside the Laptop's broadcast domain, so it
 * never appears on any path below. The IP frame stops at R1 — the lab
 * does not pretend R1 already knows the Server's MAC.
 * Learning happens hop by hop, at the moment a frame arrives:
 *   request enters SW1 Fa0/1  → SW1 learns the Laptop's SOURCE MAC
 *   request reaches R1        → R1 caches the ARP sender's IP/MAC
 *   reply enters SW1 Fa0/2    → SW1 learns R1's SOURCE MAC
 *   reply reaches the Laptop  → Laptop caches 192.168.10.1 → R1's MAC
 */

/** Every device the lab draws. Only laptop/switch/router ever appear on a frame path. */
export type ArpLabNode = "laptop" | "switch" | "router" | "server";
export type ArpLabPhase = "baseline" | "request" | "reply" | "resolved";
/**
 * Extension point: a future "Continue: ARP on the next hop" would add
 * e.g. "r1-arp-request" / "server-arp-reply" on ["router", "server"],
 * plus a `serverArp` table and R1 learning the Server's MAC — with no
 * change to the Laptop-side flow below.
 */
export type ArpLabTransmissionKind = "arp-request" | "arp-reply" | "ip-frame";
export type ArpLabTable = "laptop-arp" | "router-arp" | "switch-mac";

export const ARP_LAB_PHASES: { id: ArpLabPhase; t: number; label: string }[] = [
  { id: "baseline", t: 0, label: "Baseline" },
  { id: "request", t: 1, label: "ARP Request" },
  { id: "reply", t: 2, label: "ARP Reply" },
  { id: "resolved", t: 3, label: "Resolved" },
];

export const ARP_LAB_PATHS: Record<ArpLabTransmissionKind, ArpLabNode[]> = {
  "arp-request": ["laptop", "switch", "router"],
  "arp-reply": ["router", "switch", "laptop"],
  "ip-frame": ["laptop", "switch", "router"],
};

export const ARP_LAB_REMOTE_DESTINATION = ADDR.server.ip;

export interface ArpLabEvent {
  id: number;
  /** Lab stage the event belongs to (T0–T3) — event ORDER, never a wall-clock time. */
  t: number;
  text: string;
  kind: "reset" | "send" | "learn" | "forward" | "receive";
}

export interface ArpLabLearned {
  table: ArpLabTable;
  /** IP for ARP tables, MAC for the switch table. */
  key: string;
}

/** SW1's forwarding decision for a frame — structured so each view can name the egress port in its own vendor syntax. */
export interface ArpLabSwitchDecision {
  action: "FLOOD" | "KNOWN UNICAST";
  /** Egress port(s): for a flood, every port except the ingress one. */
  ports: SwitchPortId[];
  reason: string;
}

export interface ArpLabTransit {
  /** Increments per transmission — lets the view restart animations. */
  id: number;
  kind: ArpLabTransmissionKind;
  /** Index into ARP_LAB_PATHS[kind] of the node the frame has reached. */
  hop: number;
  done: boolean;
  /** Forwarding decision SW1 made for this frame, once it got there. */
  switchDecision?: ArpLabSwitchDecision;
}

export interface ArpLabState {
  phase: ArpLabPhase;
  laptopArp: Record<string, string>;
  routerArp: Record<string, string>;
  switchMac: Record<string, SwitchPortId>;
  /** Current (or most recent) frame on the wire. */
  transit?: ArpLabTransit;
  /** Entries learned during the most recent transmission — drives the "+ learned" highlight. */
  learned: ArpLabLearned[];
  events: ArpLabEvent[];
  ipFrameDelivered: boolean;
  transmissions: number;
}

const portLabel = (id: SwitchPortId) => SWITCH_PORTS.find((p) => p.id === id)?.label ?? id;
const PHASE_T: Record<ArpLabPhase, number> = { baseline: 0, request: 1, reply: 2, resolved: 3 };

export function createArpLabState(): ArpLabState {
  return {
    phase: "baseline",
    laptopArp: {},
    routerArp: {},
    switchMac: {},
    learned: [],
    events: [{ id: 0, t: 0, text: "Lab reset — every table is empty", kind: "reset" }],
    ipFrameDelivered: false,
    transmissions: 0,
  };
}

export function arpLabPacket(kind: ArpLabTransmissionKind): PacketVisual {
  return kind === "arp-request" ? arpRequestPacket() : kind === "arp-reply" ? arpReplyPacket() : gatewayFramePacket();
}

export function isInFlight(state: ArpLabState): boolean {
  return !!state.transit && !state.transit.done;
}

/** The single next event the lab offers — the learner drives the exchange one frame at a time. */
export function nextTransmission(state: ArpLabState): ArpLabTransmissionKind | undefined {
  if (isInFlight(state)) return undefined;
  if (state.phase === "baseline") return "arp-request";
  if (state.phase === "request") return "arp-reply";
  if (state.phase === "resolved" && !state.ipFrameDelivered) return "ip-frame";
  return undefined;
}

function withEvents(state: ArpLabState, t: number, items: Omit<ArpLabEvent, "id" | "t">[]): ArpLabEvent[] {
  let id = state.events.length ? state.events[state.events.length - 1].id + 1 : 0;
  return [...state.events, ...items.map((e) => ({ ...e, t, id: id++ }))];
}

export function startTransmission(state: ArpLabState, kind: ArpLabTransmissionKind): ArpLabState {
  if (nextTransmission(state) !== kind) return state;
  const phase: ArpLabPhase = kind === "arp-request" ? "request" : kind === "arp-reply" ? "reply" : state.phase;
  const t = PHASE_T[phase];
  const text =
    kind === "arp-request"
      ? `Laptop broadcast an ARP Request: who has ${ADDR.gateway.ip}? (Ethernet dst FF:FF:FF:FF:FF:FF)`
      : kind === "arp-reply"
        ? `R1 sent a unicast ARP Reply: ${ADDR.gateway.ip} is at ${ADDR.gateway.mac}`
        : `Laptop sent an IP packet to ${ARP_LAB_REMOTE_DESTINATION}, framed to the gateway MAC ${ADDR.gateway.mac}`;
  return {
    ...state,
    phase,
    transmissions: state.transmissions + 1,
    transit: { id: state.transmissions + 1, kind, hop: 0, done: false },
    learned: [],
    events: withEvents(state, t, [{ text, kind: "send" }]),
  };
}

/** Moves the frame to the next node on its path and applies whatever that node learns or decides on arrival. */
export function arriveNextHop(state: ArpLabState): ArpLabState {
  const transit = state.transit;
  if (!transit || transit.done) return state;
  const path = ARP_LAB_PATHS[transit.kind];
  const hop = transit.hop + 1;
  const node = path[hop];
  const done = hop === path.length - 1;
  const t = PHASE_T[state.phase];
  let next: ArpLabState = { ...state, transit: { ...transit, hop, done } };
  const log: Omit<ArpLabEvent, "id" | "t">[] = [];

  if (transit.kind === "arp-request") {
    if (node === "switch") {
      next = { ...next, switchMac: { ...next.switchMac, [ADDR.laptop.mac]: "port1" }, learned: [...next.learned, { table: "switch-mac", key: ADDR.laptop.mac }] };
      next.transit = { ...next.transit!, switchDecision: { action: "FLOOD", ports: ["port2"], reason: "broadcast destination" } };
      log.push({ text: `SW1 learned source MAC ${ADDR.laptop.mac} on Fa0/1`, kind: "learn" }, { text: "SW1 flooded the broadcast out every other port (Fa0/2)", kind: "forward" });
    } else if (node === "router") {
      next = { ...next, routerArp: { ...next.routerArp, [ADDR.laptop.ip]: ADDR.laptop.mac }, learned: [...next.learned, { table: "router-arp", key: ADDR.laptop.ip }] };
      log.push({ text: `R1 recognized ${ADDR.gateway.ip} as its own address and cached the sender: ${ADDR.laptop.ip} → ${ADDR.laptop.mac}`, kind: "learn" });
    }
  } else if (transit.kind === "arp-reply") {
    if (node === "switch") {
      const knownPort = next.switchMac[ADDR.laptop.mac];
      next = { ...next, switchMac: { ...next.switchMac, [ADDR.gateway.mac]: "port2" }, learned: [...next.learned, { table: "switch-mac", key: ADDR.gateway.mac }] };
      next.transit = { ...next.transit!, switchDecision: knownPort ? { action: "KNOWN UNICAST", ports: [knownPort], reason: "destination MAC already learned" } : { action: "FLOOD", ports: ["port1"], reason: "destination unknown" } };
      log.push(
        { text: `SW1 learned source MAC ${ADDR.gateway.mac} on Fa0/2`, kind: "learn" },
        knownPort ? { text: `SW1 already knew ${ADDR.laptop.mac} on ${portLabel(knownPort)} — forwarded known unicast, no flooding`, kind: "forward" } : { text: "SW1 flooded the reply (destination unknown)", kind: "forward" },
      );
    } else if (node === "laptop") {
      next = { ...next, laptopArp: { ...next.laptopArp, [ADDR.gateway.ip]: ADDR.gateway.mac }, learned: [...next.learned, { table: "laptop-arp", key: ADDR.gateway.ip }], phase: "resolved" };
      log.push({ text: `Laptop learned ${ADDR.gateway.ip} → ${ADDR.gateway.mac} — ARP resolved`, kind: "learn" });
    }
  } else if (node === "switch") {
    const port = next.switchMac[ADDR.gateway.mac];
    next.transit = { ...next.transit!, switchDecision: port ? { action: "KNOWN UNICAST", ports: [port], reason: "destination MAC already learned" } : { action: "FLOOD", ports: ["port2"], reason: "destination unknown" } };
    log.push(port ? { text: `SW1 looked up ${ADDR.gateway.mac}: known on ${portLabel(port)} — forwarded known unicast, no flooding`, kind: "forward" } : { text: `SW1 doesn't know ${ADDR.gateway.mac} — flooding`, kind: "forward" });
  } else if (node === "router") {
    next = { ...next, ipFrameDelivered: true };
    log.push({ text: `R1 accepted the frame (destination MAC is its own). Gateway ARP goal complete — R1 now owns the next forwarding decision on 10.20.20.0/24`, kind: "receive" });
  }

  return { ...next, events: withEvents(next, next.phase === "resolved" && transit.kind === "arp-reply" ? PHASE_T.reply : t, log) };
}

/** Instant (no-animation) delivery of a whole transmission. */
export function deliverTransmission(state: ArpLabState, kind: ArpLabTransmissionKind): ArpLabState {
  let s = startTransmission(state, kind);
  while (s.transit && !s.transit.done && s !== state) s = arriveNextHop(s);
  return s;
}

/**
 * ARP Lab model for the generic Practice Lab runner. All ARP truth stays
 * here: what a transmission does when it starts and at each arrival. The
 * revision changes exactly when an inspectable table changes, which drives
 * the CLI's "Network state changed" hint.
 */
export const ARP_LAB_MODEL: LabModel<ArpLabState, ArpLabTransmissionKind> = {
  initial: createArpLabState,
  hops: (_state, kind) => ARP_LAB_PATHS[kind].length - 1,
  start: startTransmission,
  arrive: arriveNextHop,
  revision: (s) => `${Object.keys(s.laptopArp).length}:${Object.keys(s.routerArp).length}:${Object.keys(s.switchMac).length}`,
};

/** Why a given table entry exists — the explanation behind "Why?". */
export function whyLearned(table: ArpLabTable, key: string): string {
  if (table === "switch-mac" && key === ADDR.laptop.mac) return `SW1 reads the SOURCE MAC of every frame entering a port. The ARP Request entered Fa0/1 with source MAC ${ADDR.laptop.mac}.`;
  if (table === "switch-mac") return `SW1 reads the SOURCE MAC of every frame entering a port. The ARP Reply entered Fa0/2 with source MAC ${ADDR.gateway.mac}.`;
  if (table === "router-arp") return "The ARP Request identifies its sender IP and sender MAC, so R1 can cache that neighbor.";
  return `The ARP Reply explicitly maps ${ADDR.gateway.ip} to the Router's MAC.`;
}
