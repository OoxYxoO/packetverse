"use client";

import { FundamentalsLessonShell, type FundamentalsLessonConfig } from "@/components/lesson/FundamentalsLessonShell";
import type { LessonGuideTab } from "@/components/lesson/LessonGuideDialog";
import { kitAdapters, kitCallout, type KitDevice } from "@/components/lesson/ccnaKit";
import { CAB_MAC, CAB_REPAIR_CORRECT, CAB_REPAIR_OPTIONS, ST, cablingSteps, chooseMedium, createCablingState, linkText, mismatch, negotiate, printerLink, runById, type CablingState, type Counters } from "@/lib/sim-engine/scenarios/ccna/cabling";
import { CAB_BRIEFING_NOTES, CAB_BRIEFING_PHASES } from "./briefing";
import { CablingPanel } from "./CablingPanel";
import { CAB_LESSON_SECTIONS, CabLessonGuideContent } from "./LessonGuideContent";
import { CAB_DEEP_DIVE_SECTIONS, CabDeepDiveContent } from "./DeepDiveContent";

const GUIDE_TABS: LessonGuideTab[] = [
  { id: "lesson", label: "This Lesson", hint: "Copper, multimode and single-mode by reach · auto-negotiation · hubs vs switch ports · a duplex mismatch", sections: CAB_LESSON_SECTIONS, content: <CabLessonGuideContent /> },
  { id: "deep", label: "Cabling & Interfaces Deep Dive", hint: "Categories and fiber grades · optics and DACs · CSMA/CD · Cisco and Junos counters · error signatures", sections: CAB_DEEP_DIVE_SECTIONS, content: <CabDeepDiveContent /> },
];

const fmt = (m: number) => (m >= 1000 ? `${m / 1000} km` : `${m} m`);
const runLabel = (id: string, s: CablingState) => {
  const r = runById(id);
  return s.chosen.includes(id) ? `${chooseMedium(r).name.split(" ")[0]} · ${fmt(r.metres)}` : fmt(r.metres);
};
const counterRows = (c: Counters | undefined, keys: (keyof Counters)[]) => keys.map((k) => ({ label: k.replace("lateCollisions", "late collisions"), value: String(c ? c[k] : 0) }));
const HUB_LINK = negotiate({ speed: 100, duplex: "half", caps: [10, 100] }, { speed: "auto", duplex: "auto", caps: [10, 100, 1000] });

const DEVICES: KitDevice<CablingState>[] = [
  { id: "PC1", deviceType: "Endpoint", role: "A desk PC with a 1 Gb/s copper NIC.", stages: ST.nic, ports: () => [{ id: "eth0", neighbor: "ACC-SW1", neighborLabel: "ACC-SW1 Gi1/0/1", linkType: "Cat6 UTP · 72 m · 1000/full", ip: "10.10.10.21/24" }], knows: () => `MAC ${CAB_MAC.PC1}` },
  {
    id: "PRINTER",
    deviceType: "Multifunction printer",
    role: "Prints and scans to the file server; 10/100 NIC left on auto.",
    stages: ST.nic,
    ports: (s) => [{ id: "eth0", neighbor: "ACC-SW1", neighborLabel: "ACC-SW1 Gi1/0/7", linkType: `Cat6 · 30 m · ${linkText(printerLink(s).b)}` }],
    knows: (s) => `Set: ${s.printer.speed}/${s.printer.duplex} → ${linkText(printerLink(s).b)} (${printerLink(s).b.how})`,
    tables: (s) => [{ title: "PRINTER network status", rows: [{ label: "link", value: linkText(printerLink(s).b) }, ...counterRows(s.counters?.pr, ["sent", "delivered", "collisions", "lateCollisions"])] }],
  },
  {
    id: "ACC-SW1",
    deviceType: "Layer 2 access switch",
    role: "Copper access ports, a 10G multimode uplink to building B.",
    stages: ST.sw,
    ports: (s) => [
      { id: "Gi1/0/1", neighbor: "PC1", linkType: "Cat6 · 1000/full" },
      { id: "Gi1/0/7", neighbor: "PRINTER", linkType: `Cat6 · ${linkText(printerLink(s).a)}`, extra: [["configured", `speed ${s.swPort.speed} · duplex ${s.swPort.duplex}`]] },
      { id: "Gi1/0/20", neighbor: "HUB", linkType: `Cat5e · ${linkText(HUB_LINK.b)}` },
      { id: "Te1/1/1", neighbor: "DIST-SW", linkType: s.chosen.includes("uplink") ? "SFP-10G-SR · OM4 · 350 m" : "10G uplink" },
    ],
    knows: (s) => `Gi1/0/7 ${linkText(printerLink(s).a)}${mismatch(s) ? " — far end differs" : ""}`,
    tables: (s) => [
      { title: "ACC-SW1 interfaces status", rows: [{ label: "Gi1/0/1", value: "connected · a-full · a-1000" }, { label: "Gi1/0/7", value: `connected · ${s.swPort.duplex === "auto" ? "a-" : ""}${printerLink(s).a.duplex} · ${s.swPort.speed === "auto" ? "a-" : ""}${printerLink(s).a.speed}` }, { label: "Gi1/0/20", value: "connected · a-half · a-100 (hub)" }, { label: "Te1/1/1", value: "connected · full · 10G · SFP-10G-SR" }] },
      { title: "Gi1/0/7 counters", rows: counterRows(s.counters?.sw, ["sent", "delivered", "crc", "runts"]) },
      { title: "MAC address table", rows: Object.entries(s.macs).map(([port, mac]) => ({ label: port, value: mac })) },
    ],
  },
  { id: "HUB", deviceType: "Hub (legacy)", role: "A Layer 1 repeater: one shared, half-duplex collision domain.", stages: ST.hub, ports: () => [{ id: "port1", neighbor: "LAB1", linkType: "100BASE-TX half" }, { id: "port2", neighbor: "LAB2", linkType: "100BASE-TX half" }, { id: "port3", neighbor: "ACC-SW1", linkType: "100BASE-TX half" }], knows: () => "No addresses, no table — repeats bits" },
  { id: "LAB1", deviceType: "Endpoint", role: "Lab PC on the hub.", stages: ST.nic, ports: () => [{ id: "eth0", neighbor: "HUB", linkType: "half duplex" }], knows: () => `MAC ${CAB_MAC.LAB1}` },
  { id: "LAB2", deviceType: "Endpoint", role: "Lab PC on the hub.", stages: ST.nic, ports: () => [{ id: "eth0", neighbor: "HUB", linkType: "half duplex" }], knows: () => `MAC ${CAB_MAC.LAB2}` },
  { id: "DIST-SW", deviceType: "Distribution switch", role: "Building B: multimode from building A, single-mode to the data center.", stages: ST.optic, ports: (s) => [{ id: "Te1/0/1", neighbor: "ACC-SW1", linkType: "SFP-10G-SR · OM4" }, { id: "Te1/0/2", neighbor: "DC-SW", linkType: s.chosen.includes("dc") ? "SFP-10G-LR · SMF · 8 km" : "10G" }], knows: () => "Two optics, two fiber types" },
  { id: "DC-SW", deviceType: "Data-center switch", role: "Across town, 8 km of single-mode fiber away.", stages: ST.optic, ports: () => [{ id: "Te1/0/1", neighbor: "DIST-SW", linkType: "SFP-10G-LR · SMF" }], knows: () => "10GBASE-LR" },
];
const adapters = kitAdapters(DEVICES, "physical and data link");

const config: FundamentalsLessonConfig<CablingState> = {
  lessonId: "cabling-interfaces",
  xp: 150,
  steps: cablingSteps,
  createState: createCablingState,
  badge: "CCNA · Network Fundamentals",
  title: "Cabling & Interfaces",
  intro: "Cable an office: copper to the desks, multimode fiber to the next building, single-mode to the data center — each chosen from its reach. Watch links negotiate, compare a hub with a switch port, then find out why a printer crawls when its two ends disagree.",
  facts: [
    { q: "How far does copper go?", a: "100 m: 90 m in the wall plus 10 m of patch cords." },
    { q: "Multimode or single-mode?", a: "Multimode for hundreds of metres; single-mode for kilometres." },
    { q: "Auto or fixed?", a: "Auto on both ends, or identical fixed settings on both. Never one of each." },
    { q: "What is Auto-MDIX?", a: "A port that swaps its transmit and receive pairs by itself." },
  ],
  terms: [
    { term: "UTP", expansion: "Unshielded twisted pair", meaning: "Copper, RJ-45, 100 m" },
    { term: "MMF / SMF", expansion: "Multimode / single-mode fiber", meaning: "Short / long reach" },
    { term: "SFP+", expansion: "Small form-factor pluggable", meaning: "10G transceiver" },
    { term: "Auto-MDIX", expansion: "Automatic crossover", meaning: "Swaps TX/RX pairs" },
    { term: "CSMA/CD", expansion: "Carrier sense, collision detect", meaning: "Half duplex only" },
  ],
  guide: { title: "Cabling & Interfaces", subtitle: "PC1 · PRINTER · ACC-SW1 · DIST-SW · DC-SW · the lab hub", tabs: GUIDE_TABS },
  briefing: { phases: CAB_BRIEFING_PHASES, notes: CAB_BRIEFING_NOTES },
  nodes: () => [
    { id: "PC1", label: "PC1", subLabel: "1G copper", x: 8, y: 16, kind: "laptop" },
    { id: "PRINTER", label: "PRINTER", subLabel: "multifunction", x: 8, y: 46, kind: "server" },
    { id: "LAB1", label: "LAB1", x: 8, y: 76, kind: "laptop" },
    { id: "LAB2", label: "LAB2", x: 22, y: 92, kind: "laptop" },
    { id: "HUB", label: "HUB", subLabel: "legacy · shared", x: 24, y: 70, kind: "switch" },
    { id: "ACC-SW1", label: "ACC-SW1", subLabel: "access", x: 40, y: 40, kind: "switch" },
    { id: "DIST-SW", label: "DIST-SW", subLabel: "building B", x: 66, y: 40, kind: "switch" },
    { id: "DC-SW", label: "DC-SW", subLabel: "data center", x: 91, y: 40, kind: "switch" },
  ],
  edges: (s) => [
    { id: "pc1", a: "PC1", b: "ACC-SW1", label: runLabel("desk", s) },
    { id: "pr", a: "PRINTER", b: "ACC-SW1", label: "Cat6 · 30 m" },
    { id: "l1", a: "LAB1", b: "HUB" },
    { id: "l2", a: "LAB2", b: "HUB" },
    { id: "hub", a: "HUB", b: "ACC-SW1", label: "100 half" },
    { id: "up", a: "ACC-SW1", b: "DIST-SW", label: runLabel("uplink", s) },
    { id: "dc", a: "DIST-SW", b: "DC-SW", label: runLabel("dc", s) },
  ],
  enterable: ["ACC-SW1", "PRINTER", "HUB", "DIST-SW"],
  primaryDevice: {
    autoneg: "ACC-SW1",
    "desk-frame": "ACC-SW1",
    "uplink-fiber": "ACC-SW1",
    "dc-link": "DIST-SW",
    "shared-media": "HUB",
    "fault-injected": "ACC-SW1",
    "slow-printing": "ACC-SW1",
    counters: "PRINTER",
    "diagnostic-layers": "ACC-SW1",
    "repair-challenge": "ACC-SW1",
    "verify-negotiate": "ACC-SW1",
    "verify-traffic": "PRINTER",
  },
  ...adapters,
  callout: kitCallout,
  floodCopies: (s) => s.flood,
  sidePanel: (s) => <CablingPanel s={s} />,
  repair: {
    stepId: "repair-challenge",
    prompt: "Late collisions on the printer, CRC errors and runts on the switch port. Which change fixes the cause?",
    options: CAB_REPAIR_OPTIONS,
    correctId: CAB_REPAIR_CORRECT,
    success: "Gi1/0/7 advertises again. Both ends agree on 100 Mb/s full duplex, and the errors stop.",
    wrongFeedback: {
      cable: "The cable is fine — a bad cable gives CRC errors without collisions. Both ends are working exactly as configured.",
      "printer-half": "Then the printer stays half and the switch stays full: the same mismatch, made permanent.",
      vlan: "VLANs are Layer 2 membership; these errors happen below that, on the wire between two disagreeing ends.",
    },
    attempt: (s) => s.repairAttempt,
  },
  diagnostics: {
    fromStepId: "diagnostic-layers",
    layers: (s) => {
      const n = printerLink(s);
      const bad = mismatch(s);
      const c = s.counters;
      const errs = c ? c.sw.crc + c.sw.runts + c.pr.lateCollisions + c.pr.collisions : 0;
      return [
        { label: "Cable — Cat6, 30 m, tested good", status: "healthy" },
        { label: `Link — ${n.a.up && n.b.up ? "up on both ends" : "down"}`, status: n.a.up && n.b.up ? "healthy" : "failing" },
        { label: `Speed — switch ${n.a.speed} · printer ${n.b.speed}`, status: n.a.speed === n.b.speed ? "healthy" : "failing" },
        { label: `Duplex — switch ${n.a.duplex} · printer ${n.b.duplex}`, status: bad ? "failing" : "healthy" },
        { label: c ? `Counters — switch CRC ${c.sw.crc}, runts ${c.sw.runts} · printer collisions ${c.pr.collisions}, late ${c.pr.lateCollisions}` : "Counters — no traffic yet", status: errs > 0 ? "failing" : "healthy" },
      ];
    },
  },
  complete: { badge: "Lesson Complete", title: "You can cable it and read it", message: "Copper, multimode and single-mode chosen by reach; links that negotiate; hubs versus switch ports; and the two-ended signature of a duplex mismatch — fixed and proven with fresh counters." },
};

export default function CablingInterfacesDemo() {
  return <FundamentalsLessonShell config={config} />;
}
