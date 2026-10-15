"use client";

import { FundamentalsLessonShell, type FundamentalsLessonConfig, type ShellEdge } from "@/components/lesson/FundamentalsLessonShell";
import type { LessonGuideTab } from "@/components/lesson/LessonGuideDialog";
import type { GraphNode } from "@/components/network/GraphTopologyViewer";
import { kitAdapters, kitCallout, type KitDevice } from "@/components/lesson/ccnaKit";
import type { DeviceKind } from "@/lib/sim-engine/types";
import { ARCH, COMP_IP, COMP_REPAIR_CORRECT, COMP_REPAIR_OPTIONS, ST, componentsArchSteps, createCompState, isPowered, poeTable, type ArchView, type CompState, type PoeSwitch } from "@/lib/sim-engine/scenarios/ccna/componentsArch";
import { COMP_BRIEFING_NOTES, COMP_BRIEFING_PHASES } from "./briefing";
import { CompPanel } from "./CompPanel";
import { COMP_LESSON_SECTIONS, CompLessonGuideContent } from "./LessonGuideContent";
import { COMP_DEEP_DIVE_SECTIONS, CompDeepDiveContent } from "./DeepDiveContent";

const GUIDE_TABS: LessonGuideTab[] = [
  { id: "lesson", label: "This Lesson", hint: "Every component on two real requests · four architectures · a PoE incident", sections: COMP_LESSON_SECTIONS, content: <CompLessonGuideContent /> },
  { id: "deep", label: "Components & Architectures Deep Dive", hint: "NGFW and IPS · PoE standards · failure domains · fabric growth · WAN topologies", sections: COMP_DEEP_DIVE_SECTIONS, content: <CompDeepDiveContent /> },
];

// ---------------------------------------------------------------------------------------------------------------
// Drawing: the campus, or one of the four architectures (positions only — the graphs come from the model)
// ---------------------------------------------------------------------------------------------------------------
type P = [number, number, DeviceKind, string?];
const ARCH_POS: Record<Exclude<ArchView, "campus">, Record<string, P>> = {
  soho: { PC: [14, 30, "laptop"], PHONE: [14, 58, "laptop", "phone"], LAPTOP: [14, 84, "laptop", "Wi-Fi"], "HOME-RTR": [50, 58, "router", "router+switch+AP+firewall"], ISP: [86, 58, "cloud"] },
  "two-tier": { CORE1: [32, 18, "switch", "core/distribution"], CORE2: [68, 18, "switch", "core/distribution"], ACC1: [14, 56, "switch", "access"], ACC2: [50, 56, "switch", "access"], ACC3: [86, 56, "switch", "access"], H1: [14, 88, "laptop"], H3: [86, 88, "laptop"] },
  "three-tier": {
    CORE1: [36, 10, "switch", "core"],
    CORE2: [64, 10, "switch", "core"],
    DA1: [12, 40, "switch", "dist A"],
    DA2: [36, 40, "switch", "dist A"],
    DB1: [64, 40, "switch", "dist B"],
    DB2: [88, 40, "switch", "dist B"],
    ACC1: [12, 68, "switch", "access"],
    ACC2: [36, 68, "switch", "access"],
    ACC3: [64, 68, "switch", "access"],
    ACC4: [88, 68, "switch", "access"],
    H1: [12, 92, "laptop"],
    H4: [88, 92, "laptop"],
  },
  "spine-leaf": {
    SPINE1: [17, 16, "switch", "spine"],
    SPINE2: [39, 16, "switch", "spine"],
    SPINE3: [61, 16, "switch", "spine"],
    SPINE4: [83, 16, "switch", "spine"],
    LEAF1: [17, 58, "switch", "leaf"],
    LEAF2: [39, 58, "switch", "leaf"],
    LEAF3: [61, 58, "switch", "leaf"],
    LEAF4: [83, 58, "switch", "leaf"],
    "SRV-A": [17, 90, "server"],
    "SRV-B": [83, 90, "server"],
  },
};

function campusNodes(s: CompState): GraphNode[] {
  const lap: [number, number] = s.laptopAt === "desk" ? [7.5, 34] : [7.5, 80];
  const ap2 = poeTable(s, s.ap2 ?? "ACC-SW1").grants.find((g) => g.device === "AP2");
  return [
    { id: "LAPTOP", label: "LAPTOP", subLabel: s.associated ? `${COMP_IP.LAPTOP} · ${s.associated}` : "no Wi-Fi", x: lap[0], y: lap[1], kind: "laptop" },
    { id: "AP1", label: "AP1", subLabel: "PoE 30 W", x: 20, y: 34, kind: "accessPoint" },
    ...(s.ap2 ? [{ id: "AP2", label: "AP2", subLabel: ap2?.powered ? "PoE 30 W" : "no power", x: 20, y: 80, kind: "accessPoint" as const }] : []),
    { id: "ACC-SW1", label: "ACC-SW1", subLabel: "access · L2", x: 34, y: 34, kind: "switch" },
    { id: "ACC-SW2", label: "ACC-SW2", subLabel: "access · L2", x: 34, y: 80, kind: "switch" },
    { id: "CORE", label: "CORE", subLabel: "L3 switch", x: 50, y: 57, kind: "switch" },
    { id: "SERVER1", label: "SERVER1", subLabel: COMP_IP.SERVER1, x: 50, y: 16, kind: "server" },
    { id: "WLC", label: "WLC", subLabel: "controller", x: 50, y: 88, kind: "server" },
    { id: "FW1", label: "FW1", subLabel: "NGFW", x: 65, y: 57, kind: "firewall" },
    { id: "EDGE-R", label: "EDGE-R", subLabel: COMP_IP.PUBLIC, x: 79, y: 57, kind: "router" },
    { id: "ISP", label: "ISP", x: 92, y: 80, kind: "cloud" },
    { id: "APP", label: "APP", subLabel: COMP_IP.APP, x: 92, y: 22, kind: "server" },
  ];
}
function campusEdges(s: CompState): ShellEdge[] {
  const ap2On = isPowered(s, "AP2");
  return [
    ...(s.associated ? [{ id: "wifi", a: "LAPTOP", b: s.associated, label: "Wi-Fi" }] : []),
    { id: "ap1-acc1", a: "AP1", b: "ACC-SW1", label: "PoE" },
    ...(s.ap2 ? [{ id: "ap2-acc", a: "AP2", b: s.ap2, label: ap2On ? "PoE" : "no power", down: !ap2On }] : []),
    { id: "acc1-core", a: "ACC-SW1", b: "CORE", label: "trunk" },
    { id: "acc2-core", a: "ACC-SW2", b: "CORE", label: "trunk" },
    { id: "core-srv", a: "CORE", b: "SERVER1", label: "VLAN 20" },
    { id: "core-wlc", a: "CORE", b: "WLC" },
    { id: "core-fw", a: "CORE", b: "FW1" },
    { id: "fw-edge", a: "FW1", b: "EDGE-R" },
    { id: "edge-isp", a: "EDGE-R", b: "ISP", label: "internet" },
    { id: "isp-app", a: "ISP", b: "APP" },
  ];
}
const VIEW_TITLE: Record<Exclude<ArchView, "campus">, string> = { soho: "SOHO — one device does every job", "two-tier": "2-tier — access + collapsed core", "three-tier": "3-tier — access · distribution · core", "spine-leaf": "Spine-leaf — data center fabric" };

// ---------------------------------------------------------------------------------------------------------------
// Devices: what each one is, its ports and what it knows — all from the model state
// ---------------------------------------------------------------------------------------------------------------
const poeRows = (s: CompState, sw: PoeSwitch) => {
  const t = poeTable(s, sw);
  return [{ title: `${sw} PoE (${t.used} / ${t.budget} W)`, rows: t.grants.map((g) => ({ label: `${g.port} ${g.device}`, value: g.powered ? `${g.watts} W granted` : `denied — needs ${g.watts} W` })) }];
};
const DEVICES: KitDevice<CompState>[] = [
  { id: "LAPTOP", deviceType: "Endpoint", role: "Originates traffic: decides local vs remote from its own IP/mask and sends remote traffic to its default gateway.", stages: ST.endpoint, ports: (s) => [{ id: "wlan0", neighbor: s.associated, linkType: "802.11 Wi-Fi", up: !!s.associated, ip: `${COMP_IP.LAPTOP}/24` }], knows: (s) => (s.associated ? `Associated to ${s.associated} · gateway 10.10.10.1` : "Not associated — no SSID heard") },
  { id: "AP1", deviceType: "Access point", role: "Bridges 802.11 clients onto Ethernet; powered by PoE; configured by the WLC.", stages: ST.ap, ports: () => [{ id: "radio0", linkType: "802.11 radio · SSID CORP" }, { id: "Gi0", neighbor: "ACC-SW1", neighborLabel: "ACC-SW1 Gi1/0/1", linkType: "Ethernet + PoE" }], knows: () => "Joined WLC · SSID CORP" },
  {
    id: "AP2",
    deviceType: "Access point",
    role: "Meeting-room AP: needs 30 W of PoE (class 4) before it can boot.",
    stages: ST.ap,
    ports: (s) => [{ id: "Gi0", neighbor: s.ap2, neighborLabel: s.ap2 ? `${s.ap2} Gi1/0/12` : undefined, linkType: "Ethernet + PoE", up: isPowered(s, "AP2") }],
    knows: (s) => (isPowered(s, "AP2") ? "Powered · joined WLC · beaconing CORP" : "Unpowered — no link, no beacons"),
  },
  { id: "ACC-SW1", deviceType: "Layer 2 access switch", role: "Connects users, phones and APs; forwards on MAC; supplies PoE from a 120 W budget.", stages: ST.l2, ports: (s) => [...poeTable(s, "ACC-SW1").grants.map((g) => ({ id: g.port, neighbor: g.device.startsWith("AP") ? g.device : undefined, neighborLabel: g.device, linkType: "access + PoE", up: g.powered })), { id: "Gi1/0/48", neighbor: "CORE", linkType: "802.1Q trunk" }], knows: (s) => { const t = poeTable(s, "ACC-SW1"); return `PoE ${t.used} / ${t.budget} W reserved`; }, tables: (s) => poeRows(s, "ACC-SW1") },
  { id: "ACC-SW2", deviceType: "Layer 2 access switch", role: "Second access switch with a 180 W PoE budget.", stages: ST.l2, ports: (s) => [...poeTable(s, "ACC-SW2").grants.map((g) => ({ id: g.port, neighbor: g.device.startsWith("AP") ? g.device : undefined, neighborLabel: g.device, linkType: "access + PoE", up: g.powered })), { id: "Gi1/0/48", neighbor: "CORE", linkType: "802.1Q trunk" }], knows: (s) => { const t = poeTable(s, "ACC-SW2"); return `PoE ${t.used} / ${t.budget} W reserved`; }, tables: (s) => poeRows(s, "ACC-SW2") },
  {
    id: "CORE",
    deviceType: "Layer 3 core switch",
    role: "The users' default gateway: routes between VLANs in hardware and sends everything else to FW1.",
    stages: ST.l3,
    ports: () => [
      { id: "Vlan10", linkType: "SVI · users", ip: "10.10.10.1/24" },
      { id: "Vlan20", neighbor: "SERVER1", linkType: "SVI · servers", ip: "10.20.20.1/24" },
      { id: "Gi1/0/24", neighbor: "FW1", linkType: "routed", ip: "10.0.0.1/30" },
    ],
    knows: () => "3 connected networks + default route via FW1",
    tables: () => [{ title: "CORE routing table", rows: [{ label: "10.10.10.0/24", value: "connected · Vlan10" }, { label: "10.20.20.0/24", value: "connected · Vlan20" }, { label: "10.0.0.0/30", value: "connected · Gi1/0/24" }, { label: "0.0.0.0/0", value: "via 10.0.0.2 (FW1)" }] }],
  },
  { id: "SERVER1", deviceType: "Server (on-premises)", role: "File server in the building's server VLAN.", stages: ST.server, ports: () => [{ id: "eth0", neighbor: "CORE", linkType: "Ethernet", ip: `${COMP_IP.SERVER1}/24` }], knows: () => "Listening on TCP 445" },
  { id: "WLC", deviceType: "Wireless LAN controller", role: "Manages lightweight APs: join, SSID and security, channel plan, client monitoring.", stages: ST.wlc, ports: () => [{ id: "Gi0/0", neighbor: "CORE", linkType: "Ethernet" }], knows: (s) => `APs joined: AP1${isPowered(s, "AP2") ? ", AP2" : ""}`, tables: (s) => [{ title: "WLC — access points", rows: [{ label: "AP1", value: "joined · CORP" }, ...(s.ap2 ? [{ label: "AP2", value: isPowered(s, "AP2") ? "joined · CORP" : "configured · not joined" }] : [])] }] },
  { id: "FW1", deviceType: "Next-generation firewall", role: "Enforces policy between inside and outside and remembers every permitted connection.", stages: ST.fw, ports: () => [{ id: "inside", neighbor: "CORE", linkType: "zone inside", ip: "10.0.0.2/30" }, { id: "outside", neighbor: "EDGE-R", linkType: "zone outside", ip: "10.0.1.1/30" }], knows: (s) => `${s.sessions.length} session(s)`, tables: (s) => [{ title: "FW1 sessions", rows: s.sessions.length ? s.sessions.map((x, i) => ({ label: `#${i + 1}`, value: x })) : [{ label: "—", value: "no sessions yet" }] }] },
  { id: "EDGE-R", deviceType: "Internet edge router", role: "Connects the company to the ISP and translates private addresses to its public one (PAT).", stages: ST.edge, ports: () => [{ id: "Gi0/0", neighbor: "FW1", linkType: "inside", ip: "10.0.1.2/30" }, { id: "Gi0/1", neighbor: "ISP", linkType: "outside · internet", ip: `${COMP_IP.PUBLIC}/30` }], knows: (s) => `${s.nat.length} translation(s)`, tables: (s) => [{ title: "EDGE-R NAT translations", rows: s.nat.length ? s.nat.map((x, i) => ({ label: `#${i + 1}`, value: x })) : [{ label: "—", value: "none yet" }] }] },
  { id: "ISP", deviceType: "Internet service provider", role: "Someone else's network carrying traffic between you and the cloud.", stages: ST.isp, ports: () => [{ id: "to-customer", neighbor: "EDGE-R", linkType: "access circuit" }], knows: () => "Routes the internet" },
  { id: "APP", deviceType: "Cloud application", role: "A server in a public cloud provider's data center.", stages: ST.server, ports: () => [{ id: "eth0", neighbor: "ISP", linkType: "provider network", ip: COMP_IP.APP }], knows: () => "Listening on TCP 443" },
];
const adapters = kitAdapters(DEVICES, "what it does");

const config: FundamentalsLessonConfig<CompState> = {
  lessonId: "network-components-architectures",
  xp: 150,
  steps: componentsArchSteps,
  createState: createCompState,
  badge: "CCNA · Network Fundamentals",
  title: "Network Components & Architectures",
  intro: "Follow two real requests through every component of an enterprise network — access point, switches, core, firewall, edge router — and see what each one reads and changes. Then compare SOHO, 2-tier, 3-tier and spine-leaf by measured paths, and fix an access point that never comes up.",
  facts: [
    { q: "What does a Layer 2 switch change?", a: "Nothing in the frame. It forwards on the destination MAC." },
    { q: "What is a collapsed core?", a: "One pair of switches doing both the core and the distribution job." },
    { q: "Why spine-leaf?", a: "Equal, short paths for east-west server traffic, and growth by adding switches." },
    { q: "What is a PoE budget?", a: "The total power a switch can supply. When it runs out, new devices stay dark." },
  ],
  terms: [
    { term: "AP", expansion: "Access point", meaning: "Bridges Wi-Fi onto Ethernet" },
    { term: "WLC", expansion: "Wireless LAN controller", meaning: "Manages the APs" },
    { term: "L3 switch", expansion: "Multilayer switch", meaning: "Routes between VLANs" },
    { term: "NGFW", expansion: "Next-generation firewall", meaning: "Policy, state, apps" },
    { term: "PoE", expansion: "Power over Ethernet", meaning: "Power on the data cable" },
  ],
  guide: { title: "Network Components & Architectures", subtitle: "LAPTOP · AP1 · ACC-SW1 · CORE · FW1 · EDGE-R · ISP · APP", tabs: GUIDE_TABS },
  briefing: { phases: COMP_BRIEFING_PHASES, notes: COMP_BRIEFING_NOTES },
  nodes: (s) => {
    if (s.view === "campus") return campusNodes(s);
    const pos = ARCH_POS[s.view];
    return ARCH[s.view].nodes.map((id) => {
      const [x, y, kind, sub] = pos[id];
      return { id, label: id, subLabel: sub, x, y, kind };
    });
  },
  edges: (s) => (s.view === "campus" ? campusEdges(s) : ARCH[s.view].links.map(([a, b]) => ({ id: `${a}-${b}`, a, b }))),
  enterable: ["AP1", "ACC-SW1", "CORE", "FW1", "EDGE-R", "WLC"],
  primaryDevice: {
    "laptop-sends": "LAPTOP",
    "ap-bridges": "AP1",
    "acc-forwards": "ACC-SW1",
    "core-routes": "CORE",
    "server-receives": "SERVER1",
    "core-default": "CORE",
    "fw-policy": "FW1",
    "edge-nat": "EDGE-R",
    "isp-carries": "ISP",
    "app-receives": "APP",
    "fault-injected": "ACC-SW1",
    "no-wifi": "LAPTOP",
    "diagnostic-layers": "ACC-SW1",
    "repair-challenge": "ACC-SW1",
    "verify-power": "WLC",
    "verify-assoc": "LAPTOP",
  },
  ...adapters,
  callout: kitCallout,
  sidePanel: (s) => <CompPanel s={s} />,
  panels: (s) =>
    s.view === "campus" ? null : (
      <p className="rounded-lg border border-pv-ip/30 bg-pv-ip/5 px-3 py-2 text-sm text-pv-text" role="status">
        {VIEW_TITLE[s.view]}
      </p>
    ),
  repair: {
    stepId: "repair-challenge",
    prompt: "The meeting room has no Wi-Fi because AP2 never comes up. Which change fixes the cause?",
    options: COMP_REPAIR_OPTIONS,
    correctId: COMP_REPAIR_CORRECT,
    success: "On ACC-SW2, AP2's 30 W request fits easily in the 180 W budget. AP2 boots, joins the WLC, receives SSID CORP and starts beaconing.",
    wrongFeedback: {
      channel: "Channel overlap degrades a working AP. AP2 isn't transmitting at all — it has no power to transmit with.",
      "static-ip": "Addressing happens after the AP boots. AP2 never gets that far.",
      "reboot-wlc": "The controller is fine — AP1 is still joined. AP2 can't join anything without power.",
    },
    attempt: (s) => s.repairAttempt,
  },
  diagnostics: {
    fromStepId: "diagnostic-layers",
    layers: (s) => {
      const sw = s.ap2 ?? "ACC-SW1";
      const t = poeTable(s, sw);
      const on = isPowered(s, "AP2");
      const others = t.grants.filter((g) => g.device !== "AP2" && g.powered).reduce((a, g) => a + g.watts, 0);
      return [
        { label: `Power — ${sw} has ${Math.round((t.budget - others) * 10) / 10} W free; AP2 needs 30 W → ${on ? "granted" : "denied"}`, status: on ? "healthy" : "failing" },
        { label: `Link — ${sw} Gi1/0/12 ${on ? "up" : "down (the AP's port has no power)"}`, status: on ? "healthy" : "unknown" },
        { label: `Controller — AP2 ${on ? "joined the WLC" : "not joined"}`, status: on ? "healthy" : "unknown" },
        { label: `Radio — AP2 ${on ? "beaconing CORP" : "silent"}`, status: on ? "healthy" : "unknown" },
      ];
    },
  },
  complete: { badge: "Lesson Complete", title: "You can name every component's job", message: "Endpoints, APs, controllers, L2 and L3 switches, routers and firewalls — what each reads and changes — and how SOHO, 2-tier, 3-tier and spine-leaf arrange them. Plus the power budget that keeps the edge alive." },
};

export default function NetworkComponentsDemo() {
  return <FundamentalsLessonShell config={config} />;
}
