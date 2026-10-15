import type { PacketVisual, ScenarioStep } from "../../types";
import type { ProcessingStage } from "@/components/network3d/types";
import { act, acted, hop, kitBase, layer, moved, packet, q, repairStep, say, stackOf, withDetail, type KitBase } from "./kit";

/**
 * Cabling & Interfaces (CCNA 1.3, 1.4). One office floor: PC1 on a Cat6 run, a printer, a legacy hub in the lab, an
 * access switch with a multimode uplink to the distribution switch in building B, and a single-mode link to the data
 * center across town.
 *
 * Modeled:
 * - Media selection: each run's distance and speed checked against every medium's reach; the cheapest that reaches is
 *   chosen (copper ≤ 100 m, OM3/OM4 multimode for hundreds of metres at 10G, single-mode for kilometres).
 * - Auto-negotiation: both sides auto → best common speed, full duplex. One side forced, the other auto → the auto
 *   side detects the speed from the signal (parallel detection) but cannot learn duplex, so at 10/100 it falls back to
 *   half duplex (IEEE 802.3 clause 28).
 * - Traffic over the printer link, simulated in byte-times from a seeded sequence: a full-duplex side transmits
 *   whenever it has a frame; a half-duplex side defers while it hears carrier and treats receiving-while-sending as a
 *   collision. A collision after the first 64 bytes is a late collision (frame dropped, no retry); the full-duplex
 *   receiver gets the truncated frame as a runt or a CRC error. Every counter the lesson shows comes from this run.
 */

// ---------------------------------------------------------------------------------------------------------------
// Media
// ---------------------------------------------------------------------------------------------------------------
export interface Medium {
  id: string;
  name: string;
  kind: "copper" | "multimode" | "single-mode";
  /** Maximum reach in metres at each speed (Gb/s) the medium supports. */
  reach: Partial<Record<1 | 10, number>>;
  connector: string;
  standard: Partial<Record<1 | 10, string>>;
  /** Still found in buildings, but not specified for new runs. */
  legacy?: boolean;
}
/** Cheapest first: the selection picks the first medium that reaches. */
export const MEDIA: Medium[] = [
  { id: "cat5e", name: "Cat5e UTP", kind: "copper", reach: { 1: 100 }, connector: "RJ-45", standard: { 1: "1000BASE-T" }, legacy: true },
  { id: "cat6", name: "Cat6 UTP", kind: "copper", reach: { 1: 100, 10: 55 }, connector: "RJ-45", standard: { 1: "1000BASE-T", 10: "10GBASE-T" } },
  { id: "cat6a", name: "Cat6A", kind: "copper", reach: { 1: 100, 10: 100 }, connector: "RJ-45", standard: { 1: "1000BASE-T", 10: "10GBASE-T" } },
  { id: "om3", name: "OM3 multimode fiber", kind: "multimode", reach: { 1: 550, 10: 300 }, connector: "LC duplex (SFP/SFP+)", standard: { 1: "1000BASE-SX", 10: "10GBASE-SR" } },
  { id: "om4", name: "OM4 multimode fiber", kind: "multimode", reach: { 1: 550, 10: 400 }, connector: "LC duplex (SFP/SFP+)", standard: { 1: "1000BASE-SX", 10: "10GBASE-SR" } },
  { id: "smf-lr", name: "Single-mode fiber (LR optics)", kind: "single-mode", reach: { 1: 10000, 10: 10000 }, connector: "LC duplex (SFP/SFP+)", standard: { 1: "1000BASE-LX", 10: "10GBASE-LR" } },
  { id: "smf-er", name: "Single-mode fiber (ER optics)", kind: "single-mode", reach: { 10: 40000 }, connector: "LC duplex (SFP+)", standard: { 10: "10GBASE-ER" } },
];
export interface Run {
  id: string;
  from: string;
  to: string;
  metres: number;
  gbps: 1 | 10;
}
export const RUNS: Run[] = [
  { id: "desk", from: "PC1", to: "ACC-SW1", metres: 72, gbps: 1 },
  { id: "printer", from: "PRINTER", to: "ACC-SW1", metres: 30, gbps: 1 },
  { id: "uplink", from: "ACC-SW1", to: "DIST-SW", metres: 350, gbps: 10 },
  { id: "dc", from: "DIST-SW", to: "DC-SW", metres: 8000, gbps: 10 },
];
export function mediaCheck(run: Run) {
  return MEDIA.map((m) => {
    const reach = m.reach[run.gbps];
    return { medium: m, reach, ok: reach !== undefined && run.metres <= reach };
  });
}
/** The cheapest medium that reaches, among those specified for new installations. */
export const chooseMedium = (run: Run) => mediaCheck(run).find((c) => c.ok && !c.medium.legacy)!.medium;
export const runById = (id: string) => RUNS.find((r) => r.id === id)!;

// ---------------------------------------------------------------------------------------------------------------
// Auto-negotiation
// ---------------------------------------------------------------------------------------------------------------
export type Speed = 10 | 100 | 1000;
export type Duplex = "full" | "half";
export interface PortCfg {
  speed: Speed | "auto";
  duplex: Duplex | "auto";
  /** Speeds the hardware supports. */
  caps: Speed[];
}
export interface Negotiated {
  up: boolean;
  speed?: Speed;
  duplex?: Duplex;
  how: string;
}
/** IEEE 802.3 clause 28, as far as the CCNA needs it. Returns what each side ends up using. */
export function negotiate(a: PortCfg, b: PortCfg): { a: Negotiated; b: Negotiated } {
  const autoA = a.speed === "auto" && a.duplex === "auto";
  const autoB = b.speed === "auto" && b.duplex === "auto";
  if (autoA && autoB) {
    const speed = Math.max(...a.caps.filter((s) => b.caps.includes(s))) as Speed;
    const r: Negotiated = { up: true, speed, duplex: "full", how: "auto-negotiated (both sides advertise)" };
    return { a: r, b: r };
  }
  const fixed = (c: PortCfg): Negotiated => ({ up: true, speed: c.speed as Speed, duplex: c.duplex as Duplex, how: "manually set — auto-negotiation off" });
  const detect = (other: PortCfg, self: PortCfg): Negotiated => {
    const speed = other.speed as Speed;
    if (!self.caps.includes(speed)) return { up: false, how: "parallel detection: speed not supported" };
    // Parallel detection learns the speed from the line signal; duplex is unknown, so 10/100 falls back to half.
    return { up: true, speed, duplex: speed === 1000 ? "full" : "half", how: "parallel detection — speed sensed, duplex unknown → half" };
  };
  if (!autoA && autoB) return { a: fixed(a), b: detect(a, b) };
  if (autoA && !autoB) return { a: detect(b, a), b: fixed(b) };
  const fa = fixed(a);
  const fb = fixed(b);
  if (fa.speed !== fb.speed) return { a: { up: false, how: "speeds differ — no link" }, b: { up: false, how: "speeds differ — no link" } };
  return { a: fa, b: fb };
}

// ---------------------------------------------------------------------------------------------------------------
// Traffic over one link, in byte-times
// ---------------------------------------------------------------------------------------------------------------
export interface Counters {
  sent: number;
  delivered: number;
  collisions: number;
  lateCollisions: number;
  crc: number;
  runts: number;
}
const zero = (): Counters => ({ sent: 0, delivered: 0, collisions: 0, lateCollisions: 0, crc: 0, runts: 0 });
/** A small deterministic generator, so every run of the lesson shows the same counters. */
function lcg(seed: number) {
  let x = seed >>> 0;
  return () => ((x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}
function arrivals(seed: number, n: number, meanGap: number, sizes: number[]) {
  const r = lcg(seed);
  let t = 0;
  return Array.from({ length: n }, () => {
    t += Math.floor(r() * 2 * meanGap);
    return { t, len: sizes[Math.floor(r() * sizes.length)] };
  });
}
/**
 * The switch sends print jobs (large frames) while the multifunction printer sends scans to the file server (large
 * frames) and acknowledgements (small).
 * Returns counters as seen by each receiver/transmitter.
 */
export function simulateLink(sw: Duplex, pr: Duplex): { sw: Counters; pr: Counters } {
  const swFrames = arrivals(7, 400, 6000, [1518, 1518, 1518, 590]);
  const prFrames = arrivals(11, 200, 9000, [1518, 1518, 1518, 64]);
  const c = { sw: zero(), pr: zero() };
  type Tx = { start: number; end: number; len: number };
  // A full-duplex side transmits back to back regardless of the other side.
  const scheduleFull = (fr: { t: number; len: number }[]): Tx[] => {
    let busy = 0;
    return fr.map((f) => {
      const start = Math.max(f.t, busy);
      busy = start + f.len + 20; // + preamble and inter-frame gap
      return { start, end: start + f.len, len: f.len };
    });
  };
  const run = (fullFr: { t: number; len: number }[], halfFr: { t: number; len: number }[], full: Counters, half: Counters) => {
    const fullTx = scheduleFull(fullFr);
    const corrupt = new Set<number>();
    let busy = 0;
    for (const f of halfFr) {
      half.sent++;
      let t = Math.max(f.t, busy);
      for (let attempt = 1; attempt <= 16; attempt++) {
        const carrier = fullTx.find((x) => x.start <= t && t < x.end);
        if (carrier) t = carrier.end + 12; // carrier sense: defer
        const hit = fullTx.findIndex((x) => x.start > t && x.start < t + f.len);
        if (hit < 0) {
          full.delivered++;
          busy = t + f.len + 20;
          break;
        }
        const offset = fullTx[hit].start - t;
        corrupt.add(hit); // the half side was transmitting: it discards the frame it is receiving
        const cut = offset + 4; // truncated frame + jam reaches the full-duplex receiver
        if (cut < 64) full.runts++;
        else full.crc++;
        if (offset >= 64) {
          half.lateCollisions++;
          busy = t + offset + 4 + 20;
          break; // late collision: no retransmission
        }
        half.collisions++;
        t = t + offset + 4 + 512 * (attempt % 4); // back off a few slot times
        busy = t;
      }
    }
    full.sent += fullTx.length;
    half.delivered += fullTx.length - corrupt.size;
  };
  if (sw === "full" && pr === "full") {
    c.sw.sent = swFrames.length;
    c.pr.delivered = swFrames.length;
    c.pr.sent = prFrames.length;
    c.sw.delivered = prFrames.length;
    return c;
  }
  if (sw === "full" && pr === "half") run(swFrames, prFrames, c.sw, c.pr);
  else if (sw === "half" && pr === "full") run(prFrames, swFrames, c.pr, c.sw);
  else {
    // Both half: CSMA/CD works — no late collisions, nothing corrupted that isn't retried. Not used by the lesson.
    c.sw.sent = c.pr.delivered = swFrames.length;
    c.pr.sent = c.sw.delivered = prFrames.length;
  }
  return c;
}

// ---------------------------------------------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------------------------------------------
export interface CablingState extends KitBase {
  /** Switch side (ACC-SW1 Gi1/0/7) and printer side configuration. */
  swPort: PortCfg;
  printer: PortCfg;
  /** Counters after the latest traffic run on the printer link (undefined before any). */
  counters?: { sw: Counters; pr: Counters };
  /** Counters at the previous snapshot (for deltas after repair). */
  baseline?: { sw: Counters; pr: Counters };
  /** Which runs have had their medium chosen so far. */
  chosen: string[];
  /** MAC table learned so far on ACC-SW1 (port → MAC). */
  macs: Record<string, string>;
}
export const SW_DEFAULT: PortCfg = { speed: "auto", duplex: "auto", caps: [10, 100, 1000] };
export const PRINTER_CFG: PortCfg = { speed: "auto", duplex: "auto", caps: [10, 100] };
export function createCablingState(): CablingState {
  return { ...kitBase(), swPort: SW_DEFAULT, printer: PRINTER_CFG, chosen: [], macs: {} };
}
export const printerLink = (s: CablingState) => negotiate(s.swPort, s.printer);
export const mismatch = (s: CablingState) => {
  const n = printerLink(s);
  return n.a.up && n.b.up && n.a.duplex !== n.b.duplex;
};
export const linkText = (n: Negotiated) => (n.up ? `${n.speed} Mb/s ${n.duplex} duplex` : "down");

// ---------------------------------------------------------------------------------------------------------------
// Packets
// ---------------------------------------------------------------------------------------------------------------
export const CAB_MAC = { PC1: "3c:52:82:4a:10:01", PRINTER: "00:1b:a9:7e:22:07", LAB1: "00:0c:29:aa:01:01", LAB2: "00:0c:29:aa:02:02", SERVER: "00:50:56:0d:c0:10", GW: "00:1e:bd:0a:00:01" } as const;
const C = { phy: "#a78bfa", eth: "#94a3b8", ip: "#60a5fa" };
const flp = (id: string, from: string, to: string, adv: string): PacketVisual =>
  packet(id, "ETHERNET", from, to, "FLP", `Auto-negotiation · ${from} advertises ${adv}`, [layer("Fast Link Pulses (not a frame)", C.phy, [["Advertised", adv], ["Pause", "supported"], ["Pairs", "1-2, 3-6 (+4-5, 7-8 for 1000BASE-T)"]])]);
const frame = (id: string, from: string, to: string, src: string, dst: string, media: string, extra: [string, string][] = []): PacketVisual =>
  packet(id, "ETHERNET", from, to, "FRAME", `Ethernet · ${src} → ${dst} · ${media}`, [layer("Physical", C.phy, [["Medium", media], ...extra]), layer("Ethernet II Header", C.eth, [["Destination MAC", dst], ["Source MAC", src], ["EtherType", "0x0800 (IPv4)"]]), layer("IPv4 Header", C.ip, [["Source IP", "10.10.10.21"], ["Destination IP", "10.50.0.10"]])]);

export const ST = {
  nic: [{ id: "neg", label: "Negotiate speed and duplex" }, { id: "encode", label: "Encode bits for the medium" }, { id: "tx", label: "Transmit on the pairs / fiber" }],
  sw: [{ id: "phy", label: "PHY: receive signal (copper or optic)" }, { id: "fcs", label: "Check FCS (CRC)" }, { id: "learn", label: "Learn source MAC" }, { id: "fwd", label: "Forward on destination MAC" }],
  hub: [{ id: "rx", label: "Receive bits" }, { id: "repeat", label: "Repeat to every other port" }],
  optic: [{ id: "rx", label: "Receive electrical frame" }, { id: "optic", label: "SFP+: electrical → light" }, { id: "tx", label: "Transmit over fiber" }],
} satisfies Record<string, ProcessingStage[]>;

// ---------------------------------------------------------------------------------------------------------------
// Repair
// ---------------------------------------------------------------------------------------------------------------
export const CAB_REPAIR_OPTIONS = [
  { id: "auto", label: "Return ACC-SW1 Gi1/0/7 to speed auto / duplex auto so both sides negotiate" },
  { id: "cable", label: "Replace the printer's patch cable" },
  { id: "printer-half", label: "Set the printer to 100 Mb/s half duplex" },
  { id: "vlan", label: "Move the printer to a different VLAN" },
];
export const CAB_REPAIR_CORRECT = "auto";

type Step = ScenarioStep<CablingState>;
const choose = (id: string) => (s: CablingState): CablingState => ({ ...s, chosen: s.chosen.includes(id) ? s.chosen : [...s.chosen, id] });
const desk = runById("desk");
const uplink = runById("uplink");
const dc = runById("dc");

export const cablingSteps: Step[] = [
  say("intro", "Bits need a medium", "Every protocol you will learn rides on a cable or a radio. This office has four runs to build — a desk, a printer, an uplink to the next building and a link to the data center across town — and each needs the right medium. Then a well-meaning change makes printing crawl."),
  say("predict-desk", "Predict: the desk run", `PC1's desk is ${desk.metres} m of cable from the switch, and it needs 1 Gb/s.`, {
    question: q("Which medium is the right choice for this run?", [["cat6", "Cat6 UTP copper"], ["mmf", "Multimode fiber"], ["smf", "Single-mode fiber"], ["coax", "Coaxial cable"]], "cat6", `Twisted-pair copper reaches 100 m (90 m in the wall + 10 m of patch cords) at 1 Gb/s and plugs straight into the PC's RJ-45 port. Fiber would work but needs optics on both ends for no benefit at ${desk.metres} m; coax is not used for Ethernet anymore.`),
  }),
  act("desk-media", "Choose by distance and speed", `${desk.metres} m at 1 Gb/s: the cheapest medium that reaches is ${chooseMedium(desk).name} (${chooseMedium(desk).standard[1]}, ${chooseMedium(desk).connector}). Open the side panel to see every medium checked against this run.`, choose("desk"), "STEP_ENTERED"),
  act("autoneg", "Auto-negotiation", "Before any frame, PC1 and ACC-SW1 exchange fast link pulses advertising what they support. Both offer 1000 Mb/s full duplex, so that's what the link becomes.", (s) => {
    const n = negotiate(SW_DEFAULT, SW_DEFAULT).a;
    const p = flp("an-pc1", "PC1", "ACC-SW1", "10/100/1000 · half and full");
    return acted(s, hop({ stepId: "autoneg", device: "ACC-SW1", stages: withDetail(ST.sw, { phy: `FLPs from PC1 · result ${linkText(n)}` }), activeStageId: "phy", ingressInterfaceId: "Gi1/0/1", lookupType: "Auto-negotiation", lookupKey: "common abilities", lookupResult: linkText(n), action: "LINK UP", reason: "Auto-negotiation picks the highest speed and duplex both ends advertise. 1000BASE-T requires it.", input: p.summary, output: linkText(n), before: stackOf(p) }), p, `Gi1/0/1 up · ${linkText(n)}`);
  }, "PACKET_SENT"),
  act("desk-frame", "Full duplex on four pairs", "PC1 sends its first frame. 1000BASE-T transmits and receives on all four pairs at once — full duplex — so there's nothing to collide with. ACC-SW1 checks the FCS, learns PC1's MAC on Gi1/0/1 and forwards.", (s) => {
    const p = frame("pc1-f", "PC1", "ACC-SW1", CAB_MAC.PC1, CAB_MAC.GW, "Cat6 UTP · 1000BASE-T", [["Duplex", "full"]]);
    const n = acted(s, hop({ stepId: "desk-frame", device: "ACC-SW1", stages: withDetail(ST.sw, { phy: "1000BASE-T · full duplex", fcs: "CRC matches — frame good", learn: `${CAB_MAC.PC1} on Gi1/0/1`, fwd: "→ Te1/1/1 uplink" }), activeStageId: "learn", ingressInterfaceId: "Gi1/0/1", egressInterfaceId: "Te1/1/1", lookupType: "MAC table", lookupKey: CAB_MAC.GW, lookupResult: "Te1/1/1 (uplink)", action: "FORWARD", reason: "The PHY delivers bits; the switch checks the FCS before doing anything else. A bad CRC means the frame is discarded and counted.", input: p.summary, output: "→ uplink", before: stackOf(p) }), p, "FCS good · learned PC1");
    return { ...n, macs: { ...n.macs, "Gi1/0/1": CAB_MAC.PC1 } };
  }),
  say("mdix", "Straight-through, crossover and Auto-MDIX", "A NIC transmits on pins 1-2 and receives on 3-6; a switch port does the opposite. That is why the ordinary straight-through patch cord joins a PC to a switch: one side's transmit pins land on the other side's receive pins.", {
    question: q("Two old switches are joined with a straight-through cable and Auto-MDIX is disabled on both. What happens?", [["works", "The link comes up normally"], ["down", "No link: each side transmits on the pins the other also transmits on"], ["half", "The link comes up at half duplex"], ["slow", "The link comes up at 10 Mb/s"]], "down", "Both switches transmit on 3-6 and listen on 1-2. With a straight-through cable, transmitter faces transmitter and nobody hears anything, so the link stays down. A crossover cable fixes it — or Auto-MDIX, which lets a port swap its transmit and receive pairs by itself. Almost every modern port has it, which is why any cable seems to work today."),
  }),
  say("predict-uplink", "Predict: the next building", `The uplink to DIST-SW in building B is ${uplink.metres} m and must run at 10 Gb/s.`, {
    question: q("Which medium reaches?", [["cat6a", "Cat6A copper"], ["om4", "OM4 multimode fiber with 10GBASE-SR optics"], ["smf-er", "Single-mode fiber with 40 km ER optics"], ["wifi", "A Wi-Fi bridge"]], "om4", `Copper stops at 100 m. OM4 multimode reaches ${MEDIA.find((m) => m.id === "om4")!.reach[10]} m at 10G with inexpensive 850 nm SR optics; single-mode ER would work but costs far more for distance you don't need.`),
  }),
  act("uplink-fiber", "Light through multimode", `ACC-SW1's SFP+ converts the frame to 850 nm light on OM4 multimode fiber with LC connectors. ${chooseMedium(uplink).name} is the cheapest medium that reaches ${uplink.metres} m at 10G.`, (s) => {
    const p = frame("up-f", "ACC-SW1", "DIST-SW", CAB_MAC.PC1, CAB_MAC.GW, "OM4 MMF · 10GBASE-SR · 850 nm", [["Connector", "LC duplex"], ["Transceiver", "SFP+"]]);
    return choose("uplink")(acted(s, hop({ stepId: "uplink-fiber", device: "ACC-SW1", stages: withDetail(ST.optic, { optic: "10GBASE-SR · 850 nm VCSEL", tx: `OM4 · ${uplink.metres} m of ${MEDIA.find((m) => m.id === "om4")!.reach[10]} m` }), activeStageId: "optic", egressInterfaceId: "Te1/1/1", lookupType: "Transceiver", lookupKey: "Te1/1/1", lookupResult: "SFP-10G-SR", action: "TRANSMIT (optical)", reason: "Fiber carries light, immune to electrical interference, much further than copper. The transceiver decides the wavelength and reach.", input: "frame from Gi1/0/1", output: p.summary, before: stackOf(p) }), p, "SFP+ 10GBASE-SR → OM4"));
  }),
  say("predict-dc", "Predict: across town", `DIST-SW connects to the data center ${dc.metres / 1000} km away at 10 Gb/s.`, {
    question: q("Why can't multimode fiber do this run?", [["light", "Multimode can't carry light that far"], ["modal", "Its wide core lets light take many paths that arrive spread out in time — after a few hundred metres at 10G the bits blur together"], ["connector", "Multimode uses different connectors"], ["speed", "Multimode is limited to 1 Gb/s"]], "modal", `Multimode's 50 µm core carries many modes; they arrive at slightly different times (modal dispersion), which limits 10G to a few hundred metres. Single-mode's ~9 µm core carries one path, so ${chooseMedium(dc).standard[10]} reaches 10 km.`),
  }),
  act("dc-link", "Single-mode to the data center", `${chooseMedium(dc).name}: 1310 nm lasers, a 9 µm core, one path for the light. ${dc.metres / 1000} km is within its 10 km reach.`, (s) => {
    const p = moved(frame("dc-f", "DIST-SW", "DC-SW", CAB_MAC.PC1, CAB_MAC.SERVER, "SMF · 10GBASE-LR · 1310 nm", [["Connector", "LC duplex"], ["Reach", "10 km"]]), "dc-f", "DIST-SW", "DC-SW");
    return choose("dc")(acted(s, hop({ stepId: "dc-link", device: "DIST-SW", stages: withDetail(ST.optic, { optic: "10GBASE-LR · 1310 nm laser", tx: `single-mode · ${dc.metres / 1000} km of 10 km` }), activeStageId: "tx", egressInterfaceId: "Te1/0/2", lookupType: "Transceiver", lookupKey: "Te1/0/2", lookupResult: "SFP-10G-LR", action: "TRANSMIT (optical)", reason: "Single-mode fiber and laser optics cover campus-to-campus and metro distances.", input: "frame from building A", output: p.summary, before: stackOf(p) }), p, "SFP+ 10GBASE-LR → SMF"));
  }),
  act("shared-media", "Shared media: the old lab hub", "In the lab, LAB1 and LAB2 still hang off an old hub. A hub is a repeater: whatever arrives on one port goes out every other port, and only one device can talk at a time. LAB1 sends — every port hears it.", (s) => {
    const p = packet("hub-f", "ETHERNET", "LAB1", "HUB", "FRAME", `Ethernet · ${CAB_MAC.LAB1} → ${CAB_MAC.LAB2} · half duplex`, [layer("Physical", C.phy, [["Medium", "Cat5e · 100BASE-TX"], ["Duplex", "half (CSMA/CD)"]]), layer("Ethernet II Header", C.eth, [["Destination MAC", CAB_MAC.LAB2], ["Source MAC", CAB_MAC.LAB1]])]);
    const copies = ["LAB2", "ACC-SW1"].map((to) => ({ id: `hub-${to}`, fromId: "HUB", toId: to, packet: moved(p, `hub-${to}`, "HUB", to) }));
    return acted(s, hop({ stepId: "shared-media", device: "HUB", stages: withDetail(ST.hub, { repeat: "out ports 2 and 3 — every port but the one it came in" }), activeStageId: "repeat", ingressInterfaceId: "port1", egressInterfaceIds: ["port2", "port3"], lookupType: "None", lookupKey: "—", lookupResult: "a hub has no table", action: "REPEAT", reason: "A hub works at Layer 1. It can't read addresses, so every port is part of one shared segment.", input: p.summary, output: "repeated to all ports", before: stackOf(p) }), p, "repeated to every port", copies);
  }, "PACKET_SENT", q("How many collision domains does the lab's hub create for its three ports?", [["1", "1 — every port shares it"], ["3", "3 — one per port"], ["0", "0 — hubs prevent collisions"]], "1", "Everything connected to a hub shares one collision domain: if two devices transmit at once, the signals collide. Each switch port is its own collision domain — and in full duplex there are no collisions at all.")),
  say("point-to-point", "Point-to-point: every switch port", "A switch port is a point-to-point link between exactly two devices. With full duplex each direction has its own pairs, so collision detection (CSMA/CD) is switched off. Half duplex survives only on hubs and on links that fail to negotiate — remember that."),
  say("counters-healthy", "What healthy looks like", "On Cisco, show interfaces shows speed, duplex and error counters; on Junos, show interfaces extensive. On a healthy full-duplex link: collisions 0, late collisions 0, CRC 0, runts 0. Errors on a working link always mean something physical or a negotiation problem."),
  // incident
  act("fault-injected", "A change to “stabilise” the printer", "During a maintenance window a technician sets ACC-SW1 Gi1/0/7 — the printer's port — to speed 100 and duplex full, to stop it ever renegotiating. The printer is left on auto. The link comes back up.", (s) => {
    const sw: PortCfg = { ...s.swPort, speed: 100, duplex: "full" };
    const n = negotiate(sw, s.printer);
    return { ...s, swPort: sw, faultActive: true, packet: undefined, flood: [], decision: { device: "ACC-SW1", text: `Gi1/0/7 up · ${linkText(n.a)}` } };
  }, "STEP_ENTERED"),
  act("slow-printing", "Printing crawls", "Users send print jobs and scan documents to the file server. Both crawl: large jobs take minutes, some scans fail. The printer's link light is green and nobody else has a problem.", (s) => {
    const n = printerLink(s);
    const r = simulateLink(n.a.duplex!, n.b.duplex!);
    const p = frame("job", "ACC-SW1", "PRINTER", CAB_MAC.SERVER, CAB_MAC.PRINTER, "Cat6 UTP · 100BASE-TX");
    return acted({ ...s, counters: r }, hop({ stepId: "slow-printing", device: "ACC-SW1", stages: withDetail(ST.sw, { phy: `Gi1/0/7 · ${linkText(n.a)}`, fcs: `${r.sw.crc} CRC errors · ${r.sw.runts} runts received` }), activeStageId: "fcs", egressInterfaceId: "Gi1/0/7", lookupType: "Interface counters", lookupKey: "Gi1/0/7", lookupResult: `CRC ${r.sw.crc} · runts ${r.sw.runts}`, action: "ERRORS", reason: "Frames from the printer arrive damaged and are discarded at the FCS check.", input: "print job + printer replies", output: `${r.pr.delivered} of ${r.sw.sent} job frames reached the printer · ${r.sw.delivered} of ${r.pr.sent} scan frames reached the switch`, before: stackOf(p) }), p, `Gi1/0/7: ${r.sw.crc} CRC · ${r.sw.runts} runts`);
  }, "PACKET_DROPPED"),
  say("counters", "Read both ends", "Compare the counters on the two ends of the same cable. The switch port reports CRC errors and runts; the printer's status page reports collisions, most of them late collisions. Open ACC-SW1 or PRINTER to see the numbers."),
  say("trouble-question", "Diagnose", "Link up on both sides, same speed, errors on both ends of a 30 m cable that tested fine last week.", {
    question: q("What explains late collisions on one end and CRC errors and runts on the other?", [["cable", "A damaged cable"], ["duplex", "A duplex mismatch: one side is full duplex, the other half"], ["speed", "A speed mismatch"], ["storm", "A broadcast storm"]], "duplex", "The printer, still on auto, sensed 100 Mb/s but couldn't learn duplex, so it fell back to half. It stops and jams whenever it hears the switch transmitting while it sends — late collisions, because frames are long — and the switch, in full duplex, receives those cut-off frames as runts and CRC errors. A bad cable shows CRC errors without collisions; a speed mismatch brings the link down.", ["What is the printer configured to do?", "What can parallel detection learn — and what can't it?", "Which side can see a collision at all?"]),
  }),
  say("diagnostic-layers", "Troubleshooting layers", "Bottom-up: cable and signal, then link state, then speed and duplex on each end, then the error counters that prove it."),
  repairStep("repair-challenge", "Repair", "Choose the change that fixes the cause.", CAB_REPAIR_CORRECT, (s) => ({ ...s, swPort: SW_DEFAULT, baseline: s.counters })),
  act("verify-negotiate", "Both sides negotiate", "With Gi1/0/7 back on auto, both ends exchange link pulses again. The printer supports 10/100, so the link becomes 100 Mb/s full duplex on both ends.", (s) => {
    const n = printerLink(s);
    const p = flp("an-pr", "PRINTER", "ACC-SW1", "10/100 · half and full");
    return acted(s, hop({ stepId: "verify-negotiate", device: "ACC-SW1", stages: withDetail(ST.sw, { phy: `FLPs from PRINTER · result ${linkText(n.a)}` }), activeStageId: "phy", ingressInterfaceId: "Gi1/0/7", lookupType: "Auto-negotiation", lookupKey: "common abilities", lookupResult: linkText(n.a), action: "LINK UP", reason: "Same rule on both sides of the cable: auto on both, or the same fixed settings on both.", input: p.summary, output: linkText(n.a), before: stackOf(p) }), p, `Gi1/0/7 · ${linkText(n.a)}`);
  }, "PACKET_SENT"),
  act("verify-traffic", "Prove it with fresh counters", "Users print the same jobs again. The counters' deltas since the repair: zero CRC errors, zero runts, zero collisions. Every frame arrives.", (s) => {
    const n = printerLink(s);
    const r = simulateLink(n.a.duplex!, n.b.duplex!);
    const p = frame("job2", "ACC-SW1", "PRINTER", CAB_MAC.SERVER, CAB_MAC.PRINTER, "Cat6 UTP · 100BASE-TX", [["Duplex", "full"]]);
    return acted({ ...s, counters: r }, hop({ stepId: "verify-traffic", device: "PRINTER", stages: withDetail(ST.nic, { neg: linkText(n.b), tx: `${r.pr.delivered} of ${r.sw.sent} job frames received` }), activeStageId: "tx", ingressInterfaceId: "eth0", lookupType: "Counters (delta)", lookupKey: "since repair", lookupResult: `collisions ${r.pr.collisions + r.pr.lateCollisions} · CRC ${r.sw.crc}`, action: "HEALTHY", reason: "Fresh deltas after the fix, not a counter reset, prove the problem is gone.", input: p.summary, output: "printed", before: stackOf(p) }), p, "0 errors since the repair");
  }, "PACKET_RECEIVED"),
  say("complete", "Media and interfaces", "Copper to 100 m, multimode for hundreds of metres, single-mode for kilometres; auto-negotiation on both ends or the same fixed settings on both; full duplex on every switch port. And when one end reports late collisions while the other reports CRC errors and runts, look at duplex first."),
];
