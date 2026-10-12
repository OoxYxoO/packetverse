import type { ReactNode } from "react";
import type { SpLevel } from "@/components/sp-lab/spKit";
import type { L1Action, L1State } from "@/lib/sim-engine/scenarios/l1Net";

/**
 * Layer 1 Lab · Learn — six levels on the lab network:
 *   1 Two kinds of down · 2 Light in both directions · 3 Counters are history, deltas are now · 4 UP but sick ·
 *   5 Negotiation · 6 When it breaks: the slow downloads
 */

const B = ({ children }: { children: ReactNode }) => <b className="text-pv-text">{children}</b>;
const M = ({ children }: { children: ReactNode }) => <span className="pv-mono text-pv-text">{children}</span>;
const set = (text: string, f: (s: L1State) => void): L1Action => ({ type: "set", text, f });
const ping4: L1Action = { type: "ping", count: 4 };
const ping100: L1Action = { type: "ping", count: 100 };
const snap: L1Action = { type: "snapshot" };
const wait30: L1Action = { type: "wait", secs: 30 };
const serverOff = set("DIST-SW: set interfaces ge-0/0/2 disable (committed)", (s) => void (s.sw["DIST-SW"].ifs["ge-0/0/2"] = { disable: true }));
const dirty = set("The uplink fiber's ACCESS-end connector is dirty (yesterday's patch-panel work)", (s) => void (s.phys.dirtyA = true));
const forced = set("ACCESS-SW: ge-0/0/1 speed 100m, link-mode full-duplex, ether-options no-auto-negotiation", (s) => void (s.sw["ACCESS-SW"].ifs["ge-0/0/1"] = { eth: { noAuto: true, speed: "100m", linkMode: "full-duplex" } }));
const crushed = set("CLIENT's patch cable has an open pair (4-5)", (s) => void (s.phys.clientPair = true));

export const L1_LEVELS: SpLevel<L1Action>[] = [
  {
    n: 1,
    title: "Two kinds of down",
    idea: "Every interface has two states. Admin state is what the configuration asks for; operational (link) state is what the hardware achieved. Reading both tells you whether to look at the config or at the cable.",
    steps: [
      {
        title: "Healthy: up and up",
        body: <p>CLIENT and SERVER share <M>10.30.30.0/24</M>. CLIENT reaches ACCESS-SW on copper, the switches are joined by a 1000BASE-LX fiber uplink on <M>ge-0/0/47</M>, and SERVER hangs off DIST-SW. Every interface is <B>admin up, link up</B>. Ping SERVER.</p>,
        runs: [{ label: "ping SERVER ×4", actions: [ping4] }],
        show: ["links", "test"],
        check: { q: "An interface shows Admin up, Link down. What does that tell you?", options: [{ id: "a", label: "It is enabled in configuration but the hardware has no usable link — look at the cable, the optics or the far end" }, { id: "b", label: "Someone disabled it" }, { id: "c", label: "It is healthy but idle" }], answer: "a", why: "Admin = intent, link = achievement. Up/down means the intent is there but the physical layer didn't come up." },
      },
      {
        title: "Down on purpose",
        body: <p>Last night someone committed <M>set interfaces ge-0/0/2 disable</M> on DIST-SW. SERVER&apos;s cable is fine and its NIC is fine — but SERVER now reports no link at all.</p>,
        pre: [serverOff],
        runs: [{ label: "ping SERVER ×4", actions: [ping4] }],
        show: ["links", "test"],
        check: { q: "DIST-SW shows ge-0/0/2 Admin down, Link down; SERVER says Link detected: no. Where is the fault?", options: [{ id: "a", label: "In DIST-SW's configuration — the port is switched off" }, { id: "b", label: "SERVER's cable" }, { id: "c", label: "SERVER's NIC" }], answer: "a", why: "Admin down is a configuration fact. A disabled copper port drops its link, so the far end sees no link too — the cable is innocent." },
      },
    ],
  },
  {
    n: 2,
    title: "Light in both directions",
    idea: "A fiber link is two strands, one per direction. Each optic reports what it transmits (Tx) and what it receives (Rx). My Rx is the peer's Tx minus the loss of the strand in between.",
    steps: [
      {
        title: "Read both ends",
        body: <p>ACCESS-SW transmits <M>−5.00 dBm</M>, DIST-SW <M>−5.10 dBm</M>. Each end receives a little less — the fiber path costs about 1.2 dB. That is the baseline to compare against.</p>,
        show: ["optics", "links"],
        check: { q: "Which reading tells you about the light DIST-SW sends?", options: [{ id: "a", label: "ACCESS-SW's Rx — it measures what arrives from DIST-SW's transmitter" }, { id: "b", label: "ACCESS-SW's Tx" }, { id: "c", label: "DIST-SW's Rx" }], answer: "a", why: "Rx at one end is the other end's Tx after the strand. DIST-SW's Rx tells you about ACCESS-SW's light." },
      },
      {
        title: "One strand loses light",
        body: <p>A fingerprint on the ACCESS-end connector of the DIST → ACCESS strand. DIST-SW still transmits normally; ACCESS-SW now receives far less — and the link stays <B>UP</B>.</p>,
        pre: [dirty],
        show: ["optics", "links"],
        check: { q: "ACCESS Rx dropped from −6.3 to −19.8 dBm, DIST Tx is still −5.1 dBm, DIST Rx is normal. What is degraded?", options: [{ id: "a", label: "The DIST → ACCESS light path: the strand, a connector or the ACCESS receiver" }, { id: "b", label: "DIST-SW's laser" }, { id: "c", label: "Both directions" }], answer: "a", why: "The transmitter is fine and the other direction is fine; only the light arriving at ACCESS-SW is low." },
      },
    ],
  },
  {
    n: 3,
    title: "Counters are history, deltas are now",
    idea: "Interface counters accumulate since the last clear (or boot). A big number tells you something happened once; only the change over a known interval, with traffic flowing, tells you what is happening now.",
    steps: [
      {
        title: "3,912 CRC errors — today?",
        body: <p>ACCESS-SW <M>ge-0/0/47</M> shows <M>CRC/Align errors 3912</M> — from an event weeks ago, never cleared. Take a snapshot, let 30 s of traffic pass, take another.</p>,
        runs: [{ label: "snapshot · 30 s · snapshot", actions: [snap, wait30, snap] }],
        show: ["counters", "links"],
        check: { q: "Lifetime 3,912 CRC errors, delta +0 over 30 s with traffic. Is there an active fault?", options: [{ id: "a", label: "No — the errors are history; the delta proves none are happening now" }, { id: "b", label: "Yes — any non-zero CRC count is an active fault" }, { id: "c", label: "Can't tell without clearing first" }], answer: "a", why: "Compare two readings over a known interval. Zero change with traffic flowing means no errors now (clearing is optional — a snapshot pair does the same job)." },
      },
    ],
  },
  {
    n: 4,
    title: "UP but sick",
    idea: "A link can stay up while it corrupts frames. Marginal light makes the receiver misread bits; the frame's CRC-32 check then fails and the switch discards it — silently, in one direction only.",
    steps: [
      {
        title: "Downloads crawl, uploads don't",
        body: <p>The dirty connector is back. Ping 100 times, then measure both directions with iperf3: <M>-R</M> makes SERVER send (a download).</p>,
        pre: [dirty],
        runs: [{ label: "ping ×100 · download · upload", actions: [ping100, { type: "iperf", reverse: true }, { type: "iperf" }] }],
        show: ["test", "optics"],
        check: { q: "Why is only the download slow?", options: [{ id: "a", label: "Only the DIST → ACCESS strand is degraded: data toward CLIENT is corrupted and retransmitted; the upload's data travels the healthy strand" }, { id: "b", label: "SERVER's disk is slow" }, { id: "c", label: "iperf3 measures uploads wrongly" }], answer: "a", why: "Lost data segments force TCP to retransmit and back off. On the upload only small ACKs cross the bad strand, and TCP tolerates losing a few of those." },
      },
      {
        title: "Errors as a rate, on one side",
        body: <p>Now count. A snapshot pair 30 s apart on both ends of the uplink.</p>,
        pre: [dirty],
        runs: [{ label: "snapshot · 30 s · snapshot", actions: [snap, wait30, snap] }],
        show: ["counters", "optics"],
        check: { q: "ACCESS ge-0/0/47 CRC +127, DIST ge-0/0/47 CRC +0. What does the asymmetry tell you?", options: [{ id: "a", label: "Frames are corrupted only on their way into ACCESS-SW — the same direction as the low Rx" }, { id: "b", label: "DIST-SW's counters are broken" }, { id: "c", label: "The fault is in SERVER" }], answer: "a", why: "A receiver counts the frames it failed to read. The side with the low Rx is the side with the CRC errors." },
      },
    ],
  },
  {
    n: 5,
    title: "Negotiation",
    idea: "Copper links agree on speed and duplex by auto-negotiation. Force one end and the other has to guess — it can detect the speed but must assume half duplex. Damage a pair and gigabit can't train; the PHYs fall back to 100 Mb/s.",
    steps: [
      {
        title: "Forced on one side",
        body: <p>Someone set CLIENT&apos;s switch port to 100 Mb/s full duplex and turned auto-negotiation off. CLIENT still auto-negotiates.</p>,
        pre: [forced],
        runs: [{ label: "upload test", actions: [{ type: "iperf" }] }],
        show: ["links", "test"],
        check: { q: "The switch says 100/full, CLIENT says 100/half. What happens?", options: [{ id: "a", label: "A duplex mismatch: the half side sees late collisions, the full side CRC errors and runts; throughput collapses" }, { id: "b", label: "Nothing — 100 Mb/s is enough" }, { id: "c", label: "The link goes down" }], answer: "a", why: "The full-duplex side transmits whenever it likes; the half-duplex side treats that as collisions and aborts frames, which arrive as fragments with bad FCS." },
      },
      {
        title: "A crushed cable",
        body: <p>CLIENT&apos;s patch cable was crushed under a desk leg; pair 4-5 is open. Both ends still auto-negotiate.</p>,
        pre: [crushed],
        runs: [{ label: "download test", actions: [{ type: "iperf", reverse: true }] }],
        show: ["links", "test"],
        check: { q: "Link up at 100 Mb/s full duplex, no errors, 94 Mbit/s. Most likely?", options: [{ id: "a", label: "Gigabit needs all four pairs; with one open the PHYs downshift to 100BASE-TX — test the cable (TDR)" }, { id: "b", label: "A duplex mismatch" }, { id: "c", label: "The server is slow" }], answer: "a", why: "No errors and an exact 100 Mb/s ceiling is the downshift signature. A TDR test names the open pair and its distance." },
      },
    ],
  },
  {
    n: 6,
    title: "When it breaks: the slow downloads",
    idea: "The guided lesson's incident: downloads from SERVER crawl, ping mostly works, the uplink is UP. Measure, locate, repair — and prove it with fresh evidence.",
    steps: [
      {
        title: "Measure and locate",
        body: <p>Reproduce the symptom, then read the light and a fresh counter delta. Every piece points the same way.</p>,
        pre: [dirty],
        runs: [{ label: "ping ×100 · snapshot · 30 s · snapshot", actions: [ping100, snap, wait30, snap] }],
        show: ["test", "optics", "counters"],
        check: { q: "Rx −19.8 dBm at ACCESS, DIST Tx normal, CRC +127 on ACCESS only, 1% ping loss. Which repair?", options: [{ id: "a", label: "Clean and reseat the uplink fiber at the ACCESS end" }, { id: "b", label: "Clear the counters" }, { id: "c", label: "Replace DIST-SW's optic" }], answer: "a", why: "The light is lost on the DIST → ACCESS path at the ACCESS end. Clearing counters changes numbers, not light; DIST's transmitter is healthy." },
      },
      {
        title: "Repair, then prove",
        body: <p>Clean and reseat the ACCESS-end connector (the link flaps twice while you do). Then prove it: light, a fresh counter delta with traffic, and the same 100-ping test.</p>,
        pre: [dirty],
        runs: [{ label: "clean · snapshot · 30 s · snapshot · ping ×100", actions: [{ type: "phys", id: "clean-a" }, snap, wait30, snap, ping100] }],
        show: ["optics", "counters", "test"],
        check: { q: "Which evidence proves the repair?", options: [{ id: "a", label: "Rx back in the normal band, CRC +0 over a fresh interval with traffic, and 100/100 pings" }, { id: "b", label: "The interface is UP" }, { id: "c", label: "The CRC counter reads 0 after clearing" }], answer: "a", why: "The link was UP all along, and a cleared counter reads 0 even when errors continue. Fresh measurements with traffic are the proof." },
      },
    ],
  },
];
