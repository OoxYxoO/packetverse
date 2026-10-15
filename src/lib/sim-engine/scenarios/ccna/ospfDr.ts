import type { PacketVisual, ScenarioStep } from "../../types";
import type { ProcessingStage } from "@/components/network3d/types";
import { act, acted, hop, kitBase, layer, packet, q, repairStep, say, stackOf, withDetail, type KitBase } from "./kit";

/**
 * OSPF on Shared Networks: DR, BDR & Router ID (CCNA 3.4). Four routers share one Ethernet segment 10.0.0.0/24 in
 * area 0; each also has its own LAN.
 *
 * Modeled:
 * - Router ID: configured router-id, else the highest loopback address, else the highest address on an up interface.
 * - DR/BDR election on a broadcast segment: highest priority, then highest router ID; priority 0 is never elected.
 *   The election is non-preemptive: a better router that joins later waits until the DR fails.
 * - Neighbour states: FULL with the DR and BDR, 2-WAY between DROTHERs. Adjacency counts n(n−1)/2 (full mesh) vs
 *   2n − 3 (with a DR and BDR), computed.
 * - Duplicate router IDs: routers ignore hellos and LSAs carrying their own router ID, so a duplicate never reaches FULL
 *   and its LAN is missing from everyone's table.
 */

export interface OspfRouter {
  id: string;
  routerIdCfg?: string;
  loopback?: string;
  ifaces: string[];
  priority: number;
  lan: string;
  present: boolean;
}
export interface OdState extends KitBase {
  routers: OspfRouter[];
  dr?: string;
  bdr?: string;
  elected: boolean;
  /** Router IDs have been worked out (shown on the topology only from then on). */
  ridsKnown: boolean;
  /** Neighbour states have been formed (neighbour tables shown only from then on). */
  adjShown: boolean;
}
const n = (ip: string) => ip.split(".").reduce((a, o) => a * 256 + Number(o), 0) >>> 0;
const maxIp = (ips: string[]) => ips.reduce((a, b) => (n(b) > n(a) ? b : a));
export function routerId(r: OspfRouter): { rid: string; how: string } {
  if (r.routerIdCfg) return { rid: r.routerIdCfg, how: "configured router-id" };
  if (r.loopback) return { rid: r.loopback, how: "highest loopback" };
  return { rid: maxIp(r.ifaces), how: "highest active interface address" };
}
export function createOdState(): OdState {
  return {
    ...kitBase(),
    routers: [
      { id: "R1", routerIdCfg: "1.1.1.1", ifaces: ["10.0.0.1", "192.168.10.1"], priority: 100, lan: "192.168.10.0/24", present: true },
      { id: "R2", loopback: "2.2.2.2", ifaces: ["10.0.0.2", "192.168.20.1"], priority: 50, lan: "192.168.20.0/24", present: true },
      { id: "R3", ifaces: ["10.0.0.3", "192.168.30.1"], priority: 1, lan: "192.168.30.0/24", present: true },
      { id: "R4", loopback: "4.4.4.4", ifaces: ["10.0.0.4", "192.168.40.1"], priority: 0, lan: "192.168.40.0/24", present: true },
      { id: "R5", loopback: "5.5.5.5", ifaces: ["10.0.0.5", "192.168.50.1"], priority: 255, lan: "192.168.50.0/24", present: false },
    ],
    elected: false,
    ridsKnown: false,
    adjShown: false,
  };
}
export const present = (s: OdState) => s.routers.filter((r) => r.present);
const rOf = (s: OdState, id: string) => s.routers.find((r) => r.id === id)!;
/** Routers whose router ID is already used by an earlier router on the segment (the incumbent keeps working). */
export function duplicates(s: OdState): Set<string> {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const r of present(s)) {
    const rid = routerId(r).rid;
    if (seen.has(rid)) dup.add(r.id);
    seen.add(rid);
  }
  return dup;
}
/** Election among eligible routers (priority > 0, unique router ID): highest priority, then highest router ID. */
export function elect(s: OdState): { dr?: string; bdr?: string; ranked: { id: string; priority: number; rid: string }[] } {
  const dup = duplicates(s);
  const ranked = present(s)
    .filter((r) => r.priority > 0 && !dup.has(r.id))
    .map((r) => ({ id: r.id, priority: r.priority, rid: routerId(r).rid }))
    .sort((a, b) => b.priority - a.priority || n(b.rid) - n(a.rid));
  return { dr: ranked[0]?.id, bdr: ranked[1]?.id, ranked };
}
export type NState = "FULL" | "2-WAY" | "none (duplicate RID)";
export function neighborState(s: OdState, a: string, b: string): NState {
  const dup = duplicates(s);
  if (dup.has(a) || dup.has(b)) return "none (duplicate RID)";
  return [s.dr, s.bdr].includes(a) || [s.dr, s.bdr].includes(b) ? "FULL" : "2-WAY";
}
export const fullMesh = (k: number) => (k * (k - 1)) / 2;
export const withDr = (k: number) => Math.max(0, 2 * k - 3);
/** LANs a router has learned: its own, plus every router it shares the flooding domain with (via FULL to the DR/BDR). */
export function routesOn(s: OdState, id: string): string[] {
  const dup = duplicates(s);
  return present(s)
    .filter((r) => r.id === id || (!dup.has(r.id) && !dup.has(id)))
    .map((r) => (r.id === id ? `C ${r.lan}` : `O ${r.lan} via ${r.ifaces[0]}`));
}

// ---------------------------------------------------------------------------------------------------------------
const C = { ip: "#60a5fa", ospf: "#22d3ee" };
const hello = (s: OdState, from: string): PacketVisual => {
  const r = rOf(s, from);
  return packet(`hello-${from}`, "OSPF", from, "LAN-SW", "Hello", `OSPF Hello · ${routerId(r).rid} → 224.0.0.5`, [
    layer("IPv4 Header", C.ip, [["Source IP", r.ifaces[0]], ["Destination IP", "224.0.0.5 (AllSPFRouters)"], ["TTL", "1"], ["Protocol", "89 (OSPF)"]]),
    layer("OSPF Hello", C.ospf, [["Router ID", routerId(r).rid], ["Area", "0.0.0.0"], ["Hello / Dead", "10 s / 40 s"], ["Priority", String(r.priority)], ["DR", s.dr ? s.dr === from ? r.ifaces[0] : rOf(s, s.dr).ifaces[0] : "0.0.0.0"], ["BDR", s.bdr ? rOf(s, s.bdr).ifaces[0] : "0.0.0.0"], ["Neighbors", present(s).filter((x) => x.id !== from).map((x) => routerId(x).rid).join(", ")]]),
  ], true);
};
export const ST = {
  rtr: [{ id: "rid", label: "Choose router ID" }, { id: "hello", label: "Hello on 224.0.0.5 every 10 s" }, { id: "elect", label: "Elect DR / BDR (priority, then RID)" }, { id: "adj", label: "FULL with DR/BDR · 2-WAY with others" }, { id: "spf", label: "Flood LSAs, run SPF, install routes" }],
  sw: [{ id: "rx", label: "Receive multicast" }, { id: "flood", label: "Flood to every port in the VLAN" }],
} satisfies Record<string, ProcessingStage[]>;

export const OD_REPAIR_OPTIONS = [
  { id: "rid", label: "Give R3 a unique router ID (3.3.3.3) and restart its OSPF process" },
  { id: "prio", label: "Raise R3's priority so it becomes DR" },
  { id: "area", label: "Put R3's LAN interface in area 1" },
  { id: "reload", label: "Reload R1" },
];
export const OD_REPAIR_CORRECT = "rid";

type Step = ScenarioStep<OdState>;
const electAndStore = (s: OdState): OdState => {
  const e = elect(s);
  return { ...s, dr: e.dr, bdr: e.bdr, elected: true };
};

export const ospfDrSteps: Step[] = [
  say("intro", "Many routers, one wire", "Four routers — R1 to R4 — share one Ethernet segment, 10.0.0.0/24, through a switch. Each also owns a LAN. On a shared segment OSPF elects a designated router so that not everyone has to synchronise with everyone else."),
  say("predict-rid", "Predict: R3's router ID", "Each router picks a 32-bit router ID: a configured router-id first, else its highest loopback address, else its highest active interface address.", {
    question: q("R3 has interfaces 10.0.0.3 and 192.168.30.1, no loopback, no router-id. What is its router ID?", [["a", "192.168.30.1"], ["b", "10.0.0.3"], ["c", "0.0.0.0"], ["d", "3.3.3.3"]], "a", "With no configured router-id and no loopback, OSPF takes the highest IPv4 address on an up interface: 192.168.30.1 > 10.0.0.3."),
  }),
  act("router-id", "Every router needs an ID", "Before speaking, each router picks a 32-bit router ID: a configured router-id first, else its highest loopback address, else its highest active interface address. R1 has router-id 1.1.1.1, R2 loopback 2.2.2.2, R4 loopback 4.4.4.4. R3 has neither.", (s) => {
    const r3 = routerId(rOf(s, "R3"));
    return acted({ ...s, ridsKnown: true }, hop({ stepId: "router-id", device: "R3", stages: withDetail(ST.rtr, { rid: `${r3.rid} (${r3.how})` }), activeStageId: "rid", lookupType: "Router ID", lookupKey: "router-id / loopback / interfaces", lookupResult: `${r3.rid} — ${r3.how}`, action: "ROUTER ID", reason: "The router ID names the router in every hello and LSA. It must be unique in the OSPF domain.", input: "OSPF process start", output: r3.rid }), undefined, `R3 RID ${r3.rid}`);
  }, "STEP_ENTERED"),
  say("why-dr", "Why elect anyone?", `If every router on a segment formed a full adjacency with every other, 4 routers would need ${fullMesh(4)} adjacencies and 10 routers ${fullMesh(10)}, each exchanging the same LSAs. With a DR and a backup DR, everyone synchronises only with those two: ${withDr(4)} adjacencies for 4 routers, ${withDr(10)} for 10.`),
  act("hello", "Hellos on 224.0.0.5", "Every router sends a hello to 224.0.0.5 (all OSPF routers) every 10 seconds with its router ID, area, timers, priority, the DR and BDR it believes in, and the neighbours it has heard.", (s) => acted(s, hop({ stepId: "hello", device: "R1", stages: withDetail(ST.rtr, { hello: "224.0.0.5 · hello 10 / dead 40 · priority 100" }), activeStageId: "hello", egressInterfaceId: "Gi0/0", lookupType: "Hello parameters", lookupKey: "area, timers, mask", lookupResult: "must match to become neighbours", action: "HELLO", reason: "Neighbours must agree on area, hello and dead timers, subnet and authentication — or they never progress past INIT.", input: "every 10 s", output: "Hello → 224.0.0.5", before: stackOf(hello(s, "R1")) }), hello(s, "R1"), "Hello · priority 100"), "PACKET_SENT"),
  say("predict-election", "Predict: the election", "Each router will compare the others' hellos: highest priority wins DR, second becomes BDR, router ID breaks ties, and priority 0 means never.", {
    question: q("Priorities: R1 100, R2 50, R3 1, R4 0. Which routers become DR and BDR?", [["a", "DR R1, BDR R2"], ["b", "DR R4, BDR R3 — highest router IDs"], ["c", "DR R2, BDR R1"], ["d", "DR R1, BDR R4"]], "a", "Priority is compared first: R1 (100) then R2 (50). Router ID only breaks ties. R4's priority 0 makes it ineligible however high its router ID."),
  }),
  act("election", "The election", "After the wait timer, each router compares the hellos: highest priority wins DR, second becomes BDR, router ID breaks ties. Priority 0 means ‘never elect me’.", (s) => {
    const e = elect(s);
    const n2 = electAndStore(s);
    return acted(n2, hop({ stepId: "election", device: "R1", stages: withDetail(ST.rtr, { elect: e.ranked.map((r) => `${r.id} p${r.priority}/${r.rid}`).join(" > ") + ` · R4 p0 not eligible` }), activeStageId: "elect", lookupType: "DR election", lookupKey: "priority, then router ID", lookupResult: `DR ${e.dr} · BDR ${e.bdr}`, action: "ELECT", reason: "Deterministic rules: everyone reaches the same result from the same hellos.", input: "hellos from R2–R4", output: `DR ${e.dr} · BDR ${e.bdr}` }), undefined, `DR ${e.dr} · BDR ${e.bdr}`);
  }, "STEP_ENTERED"),
  say("predict-adjacencies", "Predict: who synchronises with whom", "With a DR and BDR elected, every router decides how far to take each neighbour relationship.", {
    question: q("What state should R3 and R4 (both DROTHERs) show for each other?", [["two", "2-WAY"], ["full", "FULL"], ["init", "INIT"], ["exstart", "EXSTART"]], "two", "DROTHERs only need bidirectional hellos with each other (2-WAY); they synchronise databases through the DR and BDR."),
  }),
  act("adjacencies", "Who becomes FULL with whom", "Each router forms a FULL adjacency with the DR and BDR and exchanges its database with them. The two DROTHERs, R3 and R4, see each other's hellos but stop at 2-WAY.", (s) => acted({ ...s, adjShown: true }, hop({ stepId: "adjacencies", device: "R3", stages: withDetail(ST.rtr, { adj: present(s).filter((r) => r.id !== "R3").map((r) => `${r.id}: ${neighborState(s, "R3", r.id)}`).join(" · ") }), activeStageId: "adj", lookupType: "Neighbour table", lookupKey: "R3", lookupResult: present(s).filter((r) => r.id !== "R3").map((r) => `${r.id} ${neighborState(s, "R3", r.id)}`).join(", "), action: "ADJACENCIES", reason: "2-WAY between DROTHERs is normal and healthy, not a fault.", input: "hellos", output: `${withDr(4)} full adjacencies on the segment` }), undefined, "R3: FULL to DR/BDR, 2-WAY to R4"), "STEP_ENTERED"),
  act("flood", "Updates go through the DR", "R3's LAN changes. R3 sends a Link State Update to 224.0.0.6 — only the DR and BDR listen there. The DR then refloods it to 224.0.0.5 so every router has it.", (s) => {
    const p = packet("lsu", "OSPF", "R3", "LAN-SW", "LSU", "OSPF LSU · 192.168.30.1 → 224.0.0.6", [layer("IPv4 Header", C.ip, [["Source IP", "10.0.0.3"], ["Destination IP", "224.0.0.6 (AllDRouters)"]]), layer("OSPF LSU", C.ospf, [["LSA", "Router LSA · 192.168.30.1"], ["Change", "LAN 192.168.30.0/24 cost"]])], true);
    return acted(s, hop({ stepId: "flood", device: "R1", stages: withDetail(ST.rtr, { spf: "LSU from R3 → reflood to 224.0.0.5 → SPF" }), activeStageId: "spf", ingressInterfaceId: "Gi0/0", lookupType: "Flooding", lookupKey: "224.0.0.6", lookupResult: "DR acknowledges and refloods", action: "REFLOOD (DR)", reason: "DROTHERs send to the DR/BDR group; the DR distributes to everyone. One sender, one fan-out.", input: p.summary, output: "LSU → 224.0.0.5", before: stackOf(p) }), p, "DR refloods");
  }, "PACKET_SENT"),
  say("predict-late", "Predict: a better router", "R5 is about to be added to the segment with priority 255 — higher than anyone, including the current DR.", {
    question: q("Does R5 take over as DR?", [["no", "No — the election isn't preemptive; R5 stays DROTHER until the DR (and then BDR) fails"], ["yes", "Yes, immediately — highest priority always wins"], ["bdr", "It replaces the BDR immediately"]], "no", "Once a DR and BDR exist, a newcomer accepts them. To move the DR deliberately you change priorities and then clear the OSPF process on the segment."),
  }),
  act("late-joiner", "A better router arrives", "R5 is added to the segment with priority 255 — higher than anyone.", (s) => {
    const n2 = { ...s, routers: s.routers.map((r) => (r.id === "R5" ? { ...r, present: true } : r)) };
    return acted(n2, hop({ stepId: "late-joiner", device: "R5", stages: withDetail(ST.rtr, { elect: `DR ${s.dr} already elected — not preempted` }), activeStageId: "elect", lookupType: "DR election", lookupKey: "existing DR in hellos", lookupResult: `keep DR ${s.dr}`, action: "DROTHER", reason: "OSPF elections are non-preemptive to avoid churn. R5 becomes DR only if the DR and BDR fail (or OSPF is restarted on the segment).", input: "join segment", output: `R5 = DROTHER · DR stays ${s.dr}` }), undefined, `R5 joins as DROTHER`);
  }, "STEP_ENTERED"),
  say("p2p", "No election on point-to-point", "Between exactly two routers there is nothing to save, so point-to-point links (and Ethernet links set to ip ospf network point-to-point) skip the election and form FULL directly, slightly faster. On Ethernet the default network type is broadcast."),
  // incident
  act("fault-injected", "R3 is replaced", "R3 fails and is replaced. To save time the engineer pastes R1's OSPF section into the new R3, router-id line included, then fixes the network statements.", (s) => ({ ...s, routers: s.routers.map((r) => (r.id === "R3" ? { ...r, routerIdCfg: "1.1.1.1" } : r)), faultActive: true, packet: undefined, flood: [], decision: { device: "R3", text: "OSPF process started" } }), "STEP_ENTERED"),
  act("inc-missing", "192.168.30.0/24 is unreachable", "Users on R3's LAN can't reach anything beyond it. R1's routing table has every LAN except 192.168.30.0/24, and R1's log shows a warning about a router ID.", (s) => acted(s, hop({ stepId: "inc-missing", device: "R1", stages: withDetail(ST.rtr, { adj: `R3: ${neighborState(s, "R1", "R3")}`, spf: routesOn(s, "R1").join(" · ") }), activeStageId: "adj", lookupType: "OSPF neighbours", lookupKey: "10.0.0.3", lookupResult: neighborState(s, "R1", "R3"), action: "IGNORE HELLOS", reason: "A router discards hellos and LSAs that carry its own router ID — it cannot tell them from its own.", input: "hellos from 10.0.0.3", output: "%OSPF-4-DUP_RTRID_NBR: duplicate router-id 1.1.1.1 from 10.0.0.3" }), undefined, "duplicate router-id 1.1.1.1"), "PACKET_DROPPED"),
  say("trouble-question", "Diagnose", "R3's interfaces are up, the segment is fine, area and timers match.", {
    question: q("Why is R3's LAN missing?", [["rid", "R3 uses the same router ID as R1, so its hellos and LSAs are rejected"], ["prio", "R3's priority is too low to become DR"], ["area", "R3's LAN is in the wrong area"], ["dead", "The dead timer expired"]], "rid", "The pasted router-id 1.1.1.1 makes R3 look like R1 itself. Neighbours ignore it and its LSAs are discarded, so its LAN never appears. Priority only affects the election — a DROTHER's LAN is still advertised.", ["What did the engineer paste?", "Which value must be unique in OSPF?", "What does R1's log say?"]),
  }),
  say("diagnostic-layers", "Troubleshooting layers", "Bottom-up: segment link, hello parameters, router IDs, neighbour states, the LSA database, then the routing table."),
  repairStep("repair-challenge", "Repair", "Choose the change that fixes the cause.", OD_REPAIR_CORRECT, (s) => ({ ...s, routers: s.routers.map((r) => (r.id === "R3" ? { ...r, routerIdCfg: "3.3.3.3" } : r)), decision: { device: "R3", text: "router-id 3.3.3.3 · clear ip ospf process" } })),
  act("verify", "R3 is back", "After clear ip ospf process, R3 hellos with 3.3.3.3. It reaches FULL with the DR and BDR, its LSA floods, and 192.168.30.0/24 appears on every router.", (s) => acted(s, hop({ stepId: "verify", device: "R1", stages: withDetail(ST.rtr, { adj: `R3: ${neighborState(s, "R1", "R3")}`, spf: routesOn(s, "R1").join(" · ") }), activeStageId: "spf", lookupType: "OSPF routes", lookupKey: "192.168.30.0/24", lookupResult: routesOn(s, "R1").find((x) => x.includes("192.168.30")) ?? "missing", action: "ROUTE INSTALLED", reason: "Unique router IDs: every LSA is accepted and SPF sees the whole segment.", input: "LSU from 3.3.3.3", output: routesOn(s, "R1").join(", ") }), undefined, "192.168.30.0/24 learned"), "PACKET_RECEIVED"),
  say("complete", "OSPF on shared networks", "Router IDs chosen by a fixed rule and unique per domain; DR and BDR elected by priority then router ID, never preempted; FULL to the DR/BDR, 2-WAY between the rest; 224.0.0.5 and 224.0.0.6 — and no election at all on point-to-point links."),
];
