import type { PacketVisual, ScenarioStep } from "../../types";
import type { ProcessingStage } from "@/components/network3d/types";
import { act, acted, hop, kitBase, layer, packet, q, repairStep, say, stackOf, withDetail, type KitBase } from "./kit";

/**
 * Wireless Principles (CCNA 1.11). One office floor, 40 m × 20 m, with 2.4 GHz access points and a laptop.
 *
 * Modeled (all computed from positions and channels):
 * - Received signal (RSSI) by log-distance path loss: PL(d) = FSPL(1 m, f) + 10·n·log10(d), n = 3 indoors.
 * - 2.4 GHz channel centres 2407 + 5·ch MHz with ~22 MHz occupied bandwidth: two channels overlap when their centres are
 *   < 22 MHz apart, by the fraction (22 − Δf) / 22 — so 1, 6 and 11 are the only three that never overlap.
 * - Interference at the laptop: each overlapping AP's RSSI scaled by its spectral overlap, added to the noise floor;
 *   SINR = signal − (noise + interference) in dB. A same-channel AP doesn't add noise: CSMA/CA makes the two share
 *   airtime instead (both hear each other above the −82 dBm clear-channel threshold).
 * - Data rate and retries from SINR (a simplified single-stream 802.11n table).
 */

export type Band = "2.4" | "5";
export interface Ap {
  id: string;
  /** Floor position in metres. */
  x: number;
  y: number;
  channel: number;
  band: Band;
  txDbm: number;
}
export interface Pos {
  x: number;
  y: number;
}
export const NOISE_DBM = -95;
export const CCA_DBM = -82;
export const PATH_N = 3;
const fsplAt1m = (mhz: number) => 20 * Math.log10(mhz) - 27.55;
export const centreMHz = (ch: number, band: Band) => (band === "2.4" ? 2407 + 5 * ch : 5000 + 5 * ch);
export const dist = (a: Pos, b: Pos) => Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
export const r1 = (x: number) => Math.round(x * 10) / 10;
export function rssi(ap: Ap, at: Pos): number {
  return r1(ap.txDbm - (fsplAt1m(centreMHz(ap.channel, ap.band)) + 10 * PATH_N * Math.log10(dist(ap, at))));
}
/** Fraction of spectrum two channels share (0 = clean, 1 = same channel). */
export function overlap(a: Ap, b: Ap): number {
  if (a.band !== b.band) return 0;
  const width = a.band === "2.4" ? 22 : 20;
  const df = Math.abs(centreMHz(a.channel, a.band) - centreMHz(b.channel, b.band));
  return df >= width ? 0 : (width - df) / width;
}
const dbmToMw = (d: number) => 10 ** (d / 10);
const mwToDbm = (m: number) => 10 * Math.log10(m);
export interface LinkQuality {
  ap: string;
  signal: number;
  /** Partial-overlap interferers: AP id, overlap fraction, contribution in dBm. */
  interferers: { ap: string; channel: number; fraction: number; dbm: number }[];
  /** Same-channel APs heard above the clear-channel threshold: airtime is shared with them. */
  sharing: string[];
  noisePlusI: number;
  sinr: number;
  rateMbps: number;
  retryPct: number;
  /** Effective throughput after airtime sharing and retries. */
  goodputMbps: number;
}
const RATE: [number, number, number][] = [
  // [min SINR dB, rate Mb/s, retry %]
  [25, 72, 2],
  [20, 58, 5],
  [15, 43, 12],
  [10, 29, 28],
  [5, 14, 45],
  [-99, 7, 60],
];
export function quality(aps: Ap[], serving: Ap, at: Pos): LinkQuality {
  const signal = rssi(serving, at);
  const others = aps.filter((a) => a.id !== serving.id);
  const interferers = others
    .map((a) => ({ a, f: overlap(serving, a) }))
    .filter(({ f }) => f > 0 && f < 1)
    .map(({ a, f }) => ({ ap: a.id, channel: a.channel, fraction: r1(f * 100) / 100, dbm: r1(rssi(a, at) + 10 * Math.log10(f)) }));
  const sharing = others.filter((a) => overlap(serving, a) === 1 && rssi(a, at) >= CCA_DBM).map((a) => a.id);
  const noisePlusI = r1(mwToDbm(dbmToMw(NOISE_DBM) + interferers.reduce((m, i) => m + dbmToMw(i.dbm), 0)));
  const sinr = r1(signal - noisePlusI);
  const [, rateMbps, retryPct] = RATE.find(([min]) => sinr >= min)!;
  const goodputMbps = r1((rateMbps * (1 - retryPct / 100) * 0.6) / (1 + sharing.length));
  return { ap: serving.id, signal, interferers, sharing, noisePlusI, sinr, rateMbps, retryPct, goodputMbps };
}
export const strongest = (aps: Ap[], at: Pos) => [...aps].sort((a, b) => rssi(b, at) - rssi(a, at))[0];

// ---------------------------------------------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------------------------------------------
export const BSSID: Record<string, string> = { AP1: "f4:db:e6:11:00:01", AP2: "f4:db:e6:11:00:02", AP3: "f4:db:e6:11:00:03" };
export const LAPTOP_MAC = "a4:5e:60:1c:22:07";
export const GW_MAC = "00:1e:bd:0a:00:01";
export const LAPTOP_AT: Pos = { x: 28, y: 6 };
export interface WifiState extends KitBase {
  aps: Ap[];
  laptop: Pos;
  scanned: boolean;
  associated?: string;
  /** Throughput measurement after the latest test (the laptop's view). */
  test?: LinkQuality;
}
export function createWifiState(): WifiState {
  return {
    ...kitBase(),
    aps: [
      { id: "AP1", x: 5, y: 10, channel: 1, band: "2.4", txDbm: 17 },
      { id: "AP2", x: 35, y: 10, channel: 6, band: "2.4", txDbm: 17 },
    ],
    laptop: LAPTOP_AT,
    scanned: false,
  };
}
export const apById = (s: WifiState, id: string) => s.aps.find((a) => a.id === id);
export const servingQuality = (s: WifiState) => {
  const ap = s.associated ? apById(s, s.associated) : undefined;
  return ap ? quality(s.aps, ap, s.laptop) : undefined;
};

// ---------------------------------------------------------------------------------------------------------------
// Frames (802.11 header fields)
// ---------------------------------------------------------------------------------------------------------------
const C = { mac80211: "#a78bfa", ie: "#22d3ee", ip: "#60a5fa" };
const beacon = (ap: Ap): PacketVisual =>
  packet(`bcn-${ap.id}`, "ETHERNET", ap.id, "LAPTOP", "Beacon", `Beacon · SSID CORP · ${ap.id} channel ${ap.channel}`, [
    layer("802.11 Header", C.mac80211, [["Frame type", "Management · Beacon"], ["Address 1 (receiver)", "ff:ff:ff:ff:ff:ff"], ["Address 2 (transmitter)", BSSID[ap.id]], ["Address 3 (BSSID)", BSSID[ap.id]]]),
    layer("Information elements", C.ie, [["SSID", "CORP"], ["DS Parameter (channel)", String(ap.channel)], ["Supported rates", "6–54 Mb/s + HT (802.11n)"], ["RSN", "WPA2/WPA3 (see Wireless Security)"], ["Beacon interval", "102.4 ms"]]),
  ], true);
const mgmt = (id: string, from: string, to: string, kind: string, src: string, dst: string, bssid: string, extra: [string, string][]): PacketVisual =>
  packet(id, "ETHERNET", from, to, kind, `${kind} · ${src} → ${dst}`, [
    layer("802.11 Header", C.mac80211, [["Frame type", `Management · ${kind}`], ["Address 1 (receiver)", dst], ["Address 2 (transmitter)", src], ["Address 3 (BSSID)", bssid]]),
    layer("Information elements", C.ie, extra),
  ]);

export const ST = {
  client: [{ id: "scan", label: "Scan channels for beacons" }, { id: "choose", label: "Choose a BSS (SSID, signal)" }, { id: "join", label: "Authenticate + associate" }, { id: "tx", label: "Contend for the air (CSMA/CA)" }],
  ap: [{ id: "beacon", label: "Beacon SSID every 102.4 ms" }, { id: "assoc", label: "Accept association (AID)" }, { id: "bridge", label: "Bridge 802.11 ↔ 802.3" }, { id: "ack", label: "ACK every unicast frame" }],
  sw: [{ id: "rx", label: "Receive" }, { id: "fwd", label: "Forward on destination MAC" }],
} satisfies Record<string, ProcessingStage[]>;

// ---------------------------------------------------------------------------------------------------------------
// Repair
// ---------------------------------------------------------------------------------------------------------------
export const WIFI_REPAIR_OPTIONS = [
  { id: "ch11", label: "Move AP3 to channel 11" },
  { id: "ch2", label: "Move AP3 to channel 2" },
  { id: "power", label: "Raise AP3's transmit power" },
  { id: "ssid", label: "Give AP3 a different SSID" },
];
export const WIFI_REPAIR_CORRECT = "ch11";

type Step = ScenarioStep<WifiState>;
const AP3: Ap = { id: "AP3", x: 20, y: 17, channel: 3, band: "2.4", txDbm: 17 };
const setAp3 = (s: WifiState, ch: number): WifiState => ({ ...s, aps: s.aps.map((a) => (a.id === "AP3" ? { ...a, channel: ch } : a)) });

const S0 = createWifiState();
const best0 = strongest(S0.aps, LAPTOP_AT);
const q0 = quality(S0.aps, best0, LAPTOP_AT);
const fault = quality([...S0.aps, AP3], best0, LAPTOP_AT);
const fixed = quality([...S0.aps, { ...AP3, channel: 11 }], best0, LAPTOP_AT);
const at5 = { ...best0, band: "5" as const, channel: 36 };

function testStep(id: string): (s: WifiState) => WifiState {
  return (s) => {
    const qy = servingQuality(s)!;
    const p = packet(`${id}-data`, "ETHERNET", "LAPTOP", qy.ap, "802.11 data", `802.11 data · ${LAPTOP_MAC} → ${GW_MAC} via ${qy.ap}`, [
      layer("802.11 Header", C.mac80211, [["Frame type", "Data (To DS)"], ["Address 1 (receiver = AP)", BSSID[qy.ap]], ["Address 2 (transmitter)", LAPTOP_MAC], ["Address 3 (final destination)", GW_MAC], ["Retry bit", qy.retryPct > 10 ? "set on many frames" : "rarely set"]]),
      layer("Radio (per frame)", C.ie, [["Signal", `${qy.signal} dBm`], ["Noise + interference", `${qy.noisePlusI} dBm`], ["SINR", `${qy.sinr} dB`], ["Data rate", `${qy.rateMbps} Mb/s`]]),
    ]);
    return acted({ ...s, test: qy }, hop({ stepId: id, device: "LAPTOP", stages: withDetail(ST.client, { tx: `SINR ${qy.sinr} dB → ${qy.rateMbps} Mb/s · retries ${qy.retryPct}% · ≈${qy.goodputMbps} Mb/s` }), activeStageId: "tx", egressInterfaceId: "wlan0", lookupType: "Rate selection", lookupKey: `SINR ${qy.sinr} dB`, lookupResult: `${qy.rateMbps} Mb/s · ${qy.retryPct}% retries`, action: "SPEED TEST", reason: "Wi-Fi picks its data rate from signal quality. Interference lowers the SINR, the rate drops and failed frames are retried — all on shared airtime.", input: "file copy", output: `≈${qy.goodputMbps} Mb/s`, nextHopId: qy.ap, before: stackOf(p) }), p, `≈${qy.goodputMbps} Mb/s`);
  };
}

export const wirelessSteps: Step[] = [
  say("intro", "A shared, invisible medium", "Wi-Fi is Ethernet's idea carried by radio: frames, MAC addresses, an access point bridging to the wired LAN. But the medium is shared by everyone in range, it fades with distance, and neighbouring cells can trample each other. This floor has two access points and a laptop."),
  say("rf", "Radio in one minute", "Signal strength is measured in dBm: 0 dBm is 1 mW, every −10 dB is ten times weaker. Clients usually see −30 dBm (next to the AP) to −80 dBm (barely usable). What matters for speed is not the signal alone but how far it rises above noise and interference — the SINR.", {
    question: q("Which reading is the stronger signal?", [["a", "−52 dBm"], ["b", "−71 dBm"], ["same", "They're the same strength"]], "a", "Closer to zero is stronger. −52 dBm is 19 dB — almost 80 times — stronger than −71 dBm."),
  }),
  act("beacons", "Access points announce themselves", "Every 102.4 ms each AP broadcasts a beacon: its network name (SSID), its own radio MAC (the BSSID), its channel, supported rates and security. One SSID — CORP — is served by both APs; each AP's radio is its own BSS.", (s) => {
    const p = beacon(apById(s, "AP2")!);
    const copy = { id: "bcn-AP1-copy", fromId: "AP1", toId: "LAPTOP", packet: beacon(apById(s, "AP1")!) };
    return acted(s, hop({ stepId: "beacons", device: "AP2", stages: withDetail(ST.ap, { beacon: `SSID CORP · BSSID ${BSSID.AP2} · ch 6` }), activeStageId: "beacon", egressInterfaceId: "radio0", lookupType: "Beacon", lookupKey: "SSID", lookupResult: "CORP", action: "BEACON", reason: "Beacons let clients discover networks passively. Clients can also ask actively with a probe request.", input: "—", output: p.summary, before: stackOf(p) }), p, "beacon · CORP", [copy]);
  }, "PACKET_SENT"),
  act("scan", "The laptop measures every beacon", `The laptop hears CORP from both APs and measures each one: AP2 at ${rssi(S0.aps[1], LAPTOP_AT)} dBm (${r1(dist(S0.aps[1], LAPTOP_AT))} m away), AP1 at ${rssi(S0.aps[0], LAPTOP_AT)} dBm (${r1(dist(S0.aps[0], LAPTOP_AT))} m away).`, (s) => {
    const rows = s.aps.map((a) => `${a.id} ch ${a.channel}: ${rssi(a, s.laptop)} dBm`).join(" · ");
    return acted({ ...s, scanned: true }, hop({ stepId: "scan", device: "LAPTOP", stages: withDetail(ST.client, { scan: rows }), activeStageId: "scan", ingressInterfaceId: "wlan0", lookupType: "Scan results", lookupKey: "SSID CORP", lookupResult: rows, action: "SCAN", reason: "Signal falls with distance: indoors roughly 30 dB more loss every time distance grows tenfold (path-loss exponent 3).", input: "beacons", output: rows }), undefined, "scan complete");
  }, "STEP_ENTERED", q("Which AP will the laptop most likely join?", [["ap2", "AP2"], ["ap1", "AP1"], ["both", "Both at once"]], "ap2", `Clients choose the strongest BSS for the SSID they want — AP2's ${rssi(S0.aps[1], LAPTOP_AT)} dBm beats AP1's ${rssi(S0.aps[0], LAPTOP_AT)} dBm. A client is associated to one AP at a time.`)),
  act("associate", "Authenticate and associate", "The laptop sends an authentication frame (open system — real security comes next, in the WPA handshake) and an association request naming SSID CORP. AP2 answers with an association ID. The laptop is now a member of AP2's BSS.", (s) => {
    const p = mgmt("assoc", "LAPTOP", "AP2", "Association Request", LAPTOP_MAC, BSSID.AP2, BSSID.AP2, [["SSID", "CORP"], ["Capabilities", "802.11n, WPA2/WPA3"], ["Listen interval", "10"]]);
    return acted({ ...s, associated: "AP2" }, hop({ stepId: "associate", device: "AP2", stages: withDetail(ST.ap, { assoc: "AID 1 · LAPTOP" }), activeStageId: "assoc", ingressInterfaceId: "radio0", lookupType: "Association", lookupKey: LAPTOP_MAC, lookupResult: "AID 1", action: "ASSOCIATED", reason: "Association is the wireless equivalent of plugging in a cable. After it, the client's frames go to this AP's BSSID.", input: p.summary, output: "Association Response · status success", nextHopId: "LAPTOP", before: stackOf(p) }), p, "AID 1");
  }, "PACKET_SENT"),
  act("data", "Three addresses in one frame", `The laptop sends data to its gateway. An 802.11 frame carries three addresses: the receiver (AP2's BSSID), the transmitter (the laptop) and the final destination (the gateway, ${GW_MAC}). AP2 acknowledges it and bridges it onto Ethernet.`, testStep("data"), "PACKET_SENT"),
  say("csma-ca", "Taking turns: CSMA/CA", "A radio can't listen while it transmits, so Wi-Fi can't detect collisions. Instead it avoids them: listen, wait a random backoff, transmit, and expect an ACK for every unicast frame. No ACK means retry. Everyone on a channel in range shares this one half-duplex medium."),
  say("channels", "Channels in 2.4 GHz", "2.4 GHz channels are only 5 MHz apart, but each transmission is about 22 MHz wide, so neighbouring channels overlap.", {
    question: q("Three APs cover neighbouring areas in 2.4 GHz. Which channel plan avoids overlap?", [["1611", "1, 6 and 11"], ["123", "1, 2 and 3"], ["111", "1, 1 and 1"], ["147", "1, 4 and 7"]], "1611", "Centres must be at least 22 MHz apart: channel 1 is 2412 MHz, 6 is 2437, 11 is 2462 — 25 MHz between each. 1-4-7 are only 15 MHz apart and overlap; 1-2-3 overlap heavily; 1-1-1 don't overlap but share airtime."),
  }),
  say("bands", "2.4, 5 and 6 GHz", `5 GHz offers about 25 non-overlapping 20 MHz channels and 6 GHz many more, with less interference — but higher frequencies lose more signal: AP2 heard on 5 GHz channel 36 would arrive at ${rssi(at5, LAPTOP_AT)} dBm instead of ${rssi(best0, LAPTOP_AT)} dBm. Designs use 5/6 GHz for capacity and plan cells closer together.`),
  // incident
  act("fault-injected", "Filling a dead spot", "Users complain about weak Wi-Fi near the south wall, so a third AP is installed there. Its radio was left on a manually chosen channel: 3. Same SSID, same security.", (s) => ({ ...s, aps: [...s.aps, AP3], faultActive: true, packet: undefined, flood: [], decision: { device: "AP3", text: "beaconing CORP · channel 3" } }), "STEP_ENTERED"),
  act("slow", "Slower than before", `Near AP2, where coverage was never a problem, the same file copy now runs at about ${fault.goodputMbps} Mb/s instead of ${q0.goodputMbps} Mb/s. The laptop is still associated to AP2 with the same signal strength.`, testStep("slow"), "PACKET_DROPPED"),
  say("trouble-question", "Diagnose", `Signal from AP2 is unchanged at ${fault.signal} dBm. The radio now reports a much higher noise level.`, {
    question: q("What is the most likely cause?", [["overlap", "AP3's channel overlaps the channels around it, adding interference"], ["weak", "The laptop is too far from AP2"], ["ssid", "Two APs advertising the same SSID confuse the laptop"], ["dhcp", "AP3 is handing out addresses"]], "overlap", `Channel 3 (2422 MHz) sits between 1 (2412) and 6 (2437): 15 MHz from channel 6, so ${Math.round(fault.interferers[0]?.fraction * 100)}% of AP3's energy lands inside AP2's channel as interference. SINR falls from ${q0.sinr} dB to ${fault.sinr} dB, the rate drops and retries climb. One SSID on many APs is normal — that's how roaming works.`, ["Did the signal change?", "What changed in the band?", "Which channels do 1 and 6 sit next to?"]),
  }),
  say("diagnostic-layers", "Troubleshooting layers", "Bottom-up for Wi-Fi: association, signal strength, noise and interference (SINR), channel plan, then throughput."),
  repairStep("repair-challenge", "Repair", "Choose the change that fixes the cause.", WIFI_REPAIR_CORRECT, (s) => ({ ...setAp3(s, 11), decision: { device: "AP3", text: "channel 11" } })),
  act("verify", "Clean channels again", `With AP3 on channel 11, the plan is 1-6-11: no overlap anywhere. SINR at the laptop is back to ${fixed.sinr} dB and the copy runs at about ${fixed.goodputMbps} Mb/s — while the south wall keeps its new coverage.`, testStep("verify"), "PACKET_RECEIVED"),
  say("complete", "Wireless principles", "Beacons, SSIDs and BSSIDs; signal in dBm and the SINR that sets the rate; CSMA/CA on a shared half-duplex medium; and a 2.4 GHz plan built only from channels 1, 6 and 11."),
];
export const WIFI_FACTS = { q0, fault, fixed, best0 };
