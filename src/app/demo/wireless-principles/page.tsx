"use client";

import { FundamentalsLessonShell, type FundamentalsLessonConfig } from "@/components/lesson/FundamentalsLessonShell";
import type { LessonGuideTab } from "@/components/lesson/LessonGuideDialog";
import { kitAdapters, kitCallout, type KitDevice } from "@/components/lesson/ccnaKit";
import { BSSID, LAPTOP_MAC, ST, WIFI_REPAIR_CORRECT, WIFI_REPAIR_OPTIONS, createWifiState, overlap, rssi, servingQuality, wirelessSteps, type WifiState } from "@/lib/sim-engine/scenarios/ccna/wireless";
import { WIFI_BRIEFING_NOTES, WIFI_BRIEFING_PHASES } from "./briefing";
import { RfPanel } from "./RfPanel";
import { WIFI_LESSON_SECTIONS, WifiLessonGuideContent } from "./LessonGuideContent";
import { WIFI_DEEP_DIVE_SECTIONS, WifiDeepDiveContent } from "./DeepDiveContent";

const GUIDE_TABS: LessonGuideTab[] = [
  { id: "lesson", label: "This Lesson", hint: "Signal and SINR · SSID and BSSID · joining · CSMA/CA · channels 1, 6, 11 · an overlapping AP", sections: WIFI_LESSON_SECTIONS, content: <WifiLessonGuideContent /> },
  { id: "deep", label: "Wireless Principles Deep Dive", hint: "802.11 generations · distance tables · channel width · encryption overview · failure signatures", sections: WIFI_DEEP_DIVE_SECTIONS, content: <WifiDeepDiveContent /> },
];

/** Floor metres → topology percent (the floor is 40 m × 20 m). */
const X = (x: number) => 8 + (x / 40) * 84;
const Y = (y: number) => 14 + (y / 20) * 62;

const apDevice = (id: string): KitDevice<WifiState> => ({
  id,
  deviceType: "Access point",
  role: "Beacons SSID CORP on its channel, associates clients, ACKs their frames and bridges them to Ethernet.",
  stages: ST.ap,
  ports: (s) => {
    const a = s.aps.find((x) => x.id === id);
    return [
      { id: "radio0", linkType: a ? `2.4 GHz · channel ${a.channel} · ${a.txDbm} dBm` : "—", extra: [["BSSID", BSSID[id]]] },
      { id: "Gi0", neighbor: "SW1", linkType: "Ethernet + PoE" },
    ];
  },
  knows: (s) => {
    const a = s.aps.find((x) => x.id === id);
    return a ? `Channel ${a.channel} · heard at the laptop at ${rssi(a, s.laptop)} dBm${s.associated === id ? " · laptop associated" : ""}` : "Not installed";
  },
  tables: (s) => {
    const a = s.aps.find((x) => x.id === id);
    if (!a) return [];
    return [{ title: `${id} neighbours (channel overlap)`, rows: s.aps.filter((o) => o.id !== id).map((o) => ({ label: `${o.id} ch ${o.channel}`, value: `${Math.round(overlap(a, o) * 100)}% overlap` })) }];
  },
});

const DEVICES: KitDevice<WifiState>[] = [
  {
    id: "LAPTOP",
    deviceType: "Wireless client",
    role: "Scans, picks the strongest BSS for its SSID, associates, contends for airtime.",
    stages: ST.client,
    ports: (s) => [{ id: "wlan0", neighbor: s.associated, linkType: s.associated ? `associated · ${s.associated}` : "not associated", extra: [["MAC", LAPTOP_MAC]] }],
    knows: (s) => {
      const qy = servingQuality(s);
      return qy ? `${qy.ap} · ${qy.signal} dBm · SINR ${qy.sinr} dB · ${qy.rateMbps} Mb/s` : s.scanned ? "Scanned — not yet associated" : "Not scanned yet";
    },
    tables: (s) => [{ title: "LAPTOP scan results (SSID CORP)", rows: s.scanned ? s.aps.map((a) => ({ label: `${a.id} · ${BSSID[a.id]}`, value: `ch ${a.channel} · ${rssi(a, s.laptop)} dBm` })) : [] }],
  },
  apDevice("AP1"),
  apDevice("AP2"),
  apDevice("AP3"),
  { id: "SW1", deviceType: "Access switch", role: "Wired side: powers the APs and carries their bridged traffic.", stages: ST.sw, ports: (s) => s.aps.map((a, i) => ({ id: `Gi1/0/${i + 1}`, neighbor: a.id, linkType: "access + PoE" })), knows: () => "Sees laptop frames as ordinary Ethernet from the AP's port" },
];
const adapters = kitAdapters(DEVICES, "radio pipeline");

const config: FundamentalsLessonConfig<WifiState> = {
  lessonId: "wireless-principles",
  xp: 150,
  steps: wirelessSteps,
  createState: createWifiState,
  badge: "CCNA · Network Fundamentals",
  title: "Wireless Principles",
  intro: "Watch a laptop discover an SSID from beacons, pick an access point by measured signal, associate and send a three-address 802.11 frame. Learn why Wi-Fi takes turns and why 2.4 GHz has only three usable channels — then find out why a new AP slowed a room it never served.",
  facts: [
    { q: "SSID vs BSSID?", a: "The network's name vs one AP radio's MAC address." },
    { q: "What sets the speed?", a: "SINR — how far the signal rises above noise and interference." },
    { q: "Why ACK every frame?", a: "Radios can't detect collisions; an ACK is the only proof of delivery." },
    { q: "What is a BSS?", a: "One access point radio and the clients associated to it." },
  ],
  terms: [
    { term: "SSID", expansion: "Service set identifier", meaning: "Network name" },
    { term: "BSSID", expansion: "Basic service set ID", meaning: "AP radio MAC" },
    { term: "RSSI", expansion: "Received signal strength", meaning: "dBm at the receiver" },
    { term: "SINR", expansion: "Signal to interference + noise", meaning: "Sets the data rate" },
    { term: "CSMA/CA", expansion: "Collision avoidance", meaning: "Listen, back off, ACK" },
  ],
  guide: { title: "Wireless Principles", subtitle: "AP1 ch 1 · AP2 ch 6 · LAPTOP · then AP3", tabs: GUIDE_TABS },
  briefing: { phases: WIFI_BRIEFING_PHASES, notes: WIFI_BRIEFING_NOTES },
  nodes: (s) => [
    ...s.aps.map((a) => ({ id: a.id, label: a.id, subLabel: `ch ${a.channel}`, x: X(a.x), y: Y(a.y), kind: "accessPoint" as const })),
    { id: "LAPTOP", label: "LAPTOP", subLabel: s.associated ? `on ${s.associated}` : "scanning", x: X(s.laptop.x), y: Y(s.laptop.y), kind: "laptop" },
    { id: "SW1", label: "SW1", subLabel: "wired LAN", x: 50, y: 92, kind: "switch" },
  ],
  edges: (s) => [...s.aps.map((a) => ({ id: `${a.id}-sw`, a: a.id, b: "SW1" })), ...(s.associated ? [{ id: "wifi", a: "LAPTOP", b: s.associated, label: "Wi-Fi" }] : [])],
  regions: [{ id: "floor", label: "office floor · 40 m × 20 m", x: 3, y: 4, width: 94, height: 80, tone: "cyan" }],
  enterable: ["LAPTOP", "AP2", "AP3"],
  primaryDevice: { beacons: "AP2", scan: "LAPTOP", associate: "AP2", data: "LAPTOP", "fault-injected": "AP3", slow: "LAPTOP", "diagnostic-layers": "LAPTOP", "repair-challenge": "AP3", verify: "LAPTOP" },
  ...adapters,
  callout: kitCallout,
  floodCopies: (s) => s.flood,
  sidePanel: (s) => <RfPanel s={s} />,
  repair: {
    stepId: "repair-challenge",
    prompt: "The laptop's signal is unchanged but its SINR and speed collapsed after AP3 arrived. Which change fixes the cause?",
    options: WIFI_REPAIR_OPTIONS,
    correctId: WIFI_REPAIR_CORRECT,
    success: "Channel 11 completes a 1-6-11 plan. Nothing overlaps; SINR and throughput return while the south wall keeps its coverage.",
    wrongFeedback: {
      ch2: "Channel 2 still overlaps channel 1 heavily and channel 6 partly — the interference just moves.",
      power: "More power means more of AP3's energy inside AP2's channel: worse, not better.",
      ssid: "The SSID is a name in a beacon. The interference is in the spectrum, whatever the name.",
    },
    attempt: (s) => s.repairAttempt,
  },
  diagnostics: {
    fromStepId: "diagnostic-layers",
    layers: (s) => {
      const qy = servingQuality(s);
      const bad = s.aps.filter((a) => s.aps.some((o) => o.id !== a.id && overlap(a, o) > 0 && overlap(a, o) < 1));
      return [
        { label: `Association — ${s.associated ?? "none"}`, status: s.associated ? "healthy" : "failing" },
        { label: `Signal — ${qy ? `${qy.signal} dBm from ${qy.ap}` : "—"}`, status: qy && qy.signal >= -67 ? "healthy" : "unknown" },
        { label: `Noise + interference — ${qy ? `${qy.noisePlusI} dBm (SINR ${qy.sinr} dB)` : "—"}`, status: qy && qy.sinr >= 25 ? "healthy" : "failing" },
        { label: `Channel plan — ${s.aps.map((a) => `${a.id} ${a.channel}`).join(", ")}`, status: bad.length ? "failing" : "healthy" },
        { label: `Throughput — ${qy ? `≈${qy.goodputMbps} Mb/s` : "—"}`, status: qy && qy.goodputMbps > 30 ? "healthy" : "failing" },
      ];
    },
  },
  complete: { badge: "Lesson Complete", title: "You can read the air", message: "Beacons and SSIDs, a client choosing by signal, three-address frames, CSMA/CA and ACKs, SINR setting the rate — and why a 2.4 GHz plan uses only channels 1, 6 and 11." },
};

export default function WirelessPrinciplesDemo() {
  return <FundamentalsLessonShell config={config} />;
}
