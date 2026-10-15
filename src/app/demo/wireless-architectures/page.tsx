"use client";

import { FundamentalsLessonShell, type FundamentalsLessonConfig } from "@/components/lesson/FundamentalsLessonShell";
import type { LessonGuideTab } from "@/components/lesson/LessonGuideDialog";
import { kitAdapters, kitCallout, type KitDevice } from "@/components/lesson/ccnaKit";
import { ADDR, ST, WARCH_REPAIR_CORRECT, WARCH_REPAIR_OPTIONS, allowed, createWarchState, warchSteps, type WarchState } from "@/lib/sim-engine/scenarios/ccna/wirelessArch";
import { WARCH_BRIEFING_NOTES, WARCH_BRIEFING_PHASES, WARCH_DEEP_SECTIONS, WARCH_LESSON_SECTIONS, WarchDeepDiveContent, WarchLessonGuideContent } from "./guide";

const GUIDE_TABS: LessonGuideTab[] = [
  { id: "lesson", label: "This Lesson", hint: "Autonomous, controller and cloud · CAPWAP join · AP modes · ports and LAGs · WLANs · management", sections: WARCH_LESSON_SECTIONS, content: <WarchLessonGuideContent /> },
  { id: "deep", label: "Wireless Architectures Deep Dive", hint: "Roaming · other vendors · misconceptions", sections: WARCH_DEEP_SECTIONS, content: <WarchDeepDiveContent /> },
];

const DEVICES: KitDevice<WarchState>[] = [
  { id: "AP1", deviceType: "Lightweight AP (local mode)", role: "Does the radio work; tunnels client frames to the WLC.", stages: ST.ap, ports: (s) => [{ id: "Gi0", neighbor: "ACC", linkType: `access VLAN ${ADDR.apMgmtVlan} · PoE`, ip: s.apIp }, { id: "radio1", linkType: `5 GHz · ${s.wlans.map((w) => w.ssid).join(", ") || "no WLANs"}` }], knows: (s) => (s.apJoined ? `Joined ${ADDR.wlc} · WLANs ${s.wlans.map((w) => w.ssid).join(", ") || "—"}` : "Not joined") },
  {
    id: "WLC",
    deviceType: "Wireless LAN controller",
    role: "Configures APs, terminates CAPWAP, bridges each WLAN into its VLAN on Po1.",
    stages: ST.wlc,
    ports: () => [{ id: "Po1", neighbor: "CORE", linkType: "LAG trunk (2 × 10G)", ip: ADDR.wlc }],
    knows: (s) => `APs: ${s.apJoined ? "AP1, BR-AP" : "none"} · WLANs: ${s.wlans.map((w) => `${w.ssid}→${w.vlan}`).join(", ") || "—"}`,
    tables: (s) => [{ title: "WLC WLANs", rows: s.wlans.map((w) => ({ label: w.ssid, value: `VLAN ${w.vlan} · ${w.security} · QoS ${w.qos}` })) }],
  },
  { id: "ACC", deviceType: "Access switch", role: "PoE access ports for APs.", stages: ST.sw, ports: () => [{ id: "Gi1/0/10", neighbor: "AP1", linkType: `access ${ADDR.apMgmtVlan} · PoE` }, { id: "Gi1/0/48", neighbor: "CORE", linkType: "trunk" }], knows: () => "AP1's port carries only VLAN 30 (CAPWAP)" },
  {
    id: "CORE",
    deviceType: "Core switch",
    role: "Routes the VLANs, relays DHCP, trunks to the WLC over Po1.",
    stages: ST.sw,
    ports: (s) => [{ id: "Po1", neighbor: "WLC", linkType: `trunk · allowed ${s.po1Allowed.join(",")}` }, { id: "Gi1/0/1", neighbor: "ACC", linkType: "trunk" }, { id: "Gi1/0/2", neighbor: "DHCP", linkType: "routed" }, { id: "Gi1/0/3", neighbor: "WAN", linkType: "routed" }],
    knows: (s) => `Po1 allows VLANs ${s.po1Allowed.join(", ")}`,
    tables: (s) => [{ title: "CORE trunks", rows: [{ label: "Po1 (to WLC)", value: `allowed ${s.po1Allowed.join(",")}` }, { label: "Gi1/0/1 (to ACC)", value: "allowed 10,30" }] }],
  },
  { id: "DHCP", deviceType: "DHCP server", role: "Scopes for VLANs 10, 30 and 50.", stages: ST.client, ports: () => [{ id: "eth0", neighbor: "CORE", linkType: "Ethernet", ip: ADDR.dhcp }], knows: (s) => `Leases: ${Object.entries(s.clients).filter(([, v]) => !v.startsWith("169")).map(([k, v]) => `${k} ${v}`).join(", ") || "—"}` },
  { id: "LAPTOP", deviceType: "Wireless client (CORP)", role: "Employee laptop.", stages: ST.client, ports: (s) => [{ id: "wlan0", neighbor: "AP1", linkType: "CORP", ip: s.clients.LAPTOP }], knows: (s) => s.clients.LAPTOP ?? "not connected" },
  { id: "GUEST-PHONE", deviceType: "Wireless client (GUEST)", role: "A visitor's phone.", stages: ST.client, ports: (s) => [{ id: "wlan0", neighbor: "AP1", linkType: "GUEST", ip: s.clients["GUEST-PHONE"] }], knows: (s) => s.clients["GUEST-PHONE"] ?? "not connected" },
  { id: "WAN", deviceType: "WAN", role: "To the branch.", stages: ST.sw, ports: () => [], knows: () => "HQ ↔ branch" },
  { id: "BR-AP", deviceType: "Lightweight AP (FlexConnect)", role: "Joined to the HQ WLC; switches client traffic locally.", stages: ST.ap, ports: () => [{ id: "Gi0", neighbor: "BR-SW", linkType: "trunk (native 130 · WLAN VLAN 20)", ip: ADDR.brAp }], knows: () => "FlexConnect · locally switched CORP → VLAN 20" },
  { id: "BR-SW", deviceType: "Branch switch", role: "Trunk to BR-AP.", stages: ST.sw, ports: () => [{ id: "Gi1/0/1", neighbor: "BR-AP", linkType: "trunk 20,130" }, { id: "Gi1/0/48", neighbor: "WAN", linkType: "uplink" }], knows: () => "Branch VLANs 20 and 130" },
];
const adapters = kitAdapters(DEVICES, "wireless pipeline");

const config: FundamentalsLessonConfig<WarchState> = {
  lessonId: "wireless-architectures",
  xp: 150,
  steps: warchSteps,
  createState: createWarchState,
  badge: "CCNA · Network Access",
  title: "Wireless Architectures & WLCs",
  intro: "Follow a lightweight AP from power-on to serving clients: DHCP option 43, CAPWAP join, WLANs pushed from the controller. Trace a client frame through the tunnel at HQ and locally at a branch — then fix a guest network where everyone connects and nobody gets an address.",
  facts: [
    { q: "Autonomous, controller or cloud?", a: "One-by-one, centrally from a WLC, or from a vendor dashboard." },
    { q: "How does an AP find its WLC?", a: "DHCP option 43, DNS, or a local broadcast." },
    { q: "What is a WLAN?", a: "An SSID with its security, QoS profile and VLAN." },
    { q: "How do admins log in?", a: "SSH or HTTPS, authenticated by TACACS+ or RADIUS." },
  ],
  terms: [
    { term: "WLC", expansion: "Wireless LAN controller", meaning: "Central brain" },
    { term: "CAPWAP", expansion: "AP control and provisioning", meaning: "UDP 5246 / 5247" },
    { term: "FlexConnect", expansion: "Branch AP mode", meaning: "Local switching" },
    { term: "Option 43", expansion: "DHCP vendor option", meaning: "WLC address" },
    { term: "LAG", expansion: "Link aggregation", meaning: "WLC uplink bundle" },
  ],
  guide: { title: "Wireless Architectures & WLCs", subtitle: `AP1 · ACC · CORE · WLC ${ADDR.wlc} · branch BR-AP`, tabs: GUIDE_TABS },
  briefing: { phases: WARCH_BRIEFING_PHASES, notes: WARCH_BRIEFING_NOTES },
  nodes: (s) => [
    { id: "LAPTOP", label: "LAPTOP", subLabel: "CORP", x: 6, y: 30, kind: "laptop" },
    { id: "GUEST-PHONE", label: "GUEST-PHONE", subLabel: s.wlans.some((w) => w.ssid === "GUEST") ? "GUEST" : "—", x: 6, y: 66, kind: "laptop" },
    { id: "AP1", label: "AP1", subLabel: "local mode", x: 22, y: 48, kind: "accessPoint" },
    { id: "ACC", label: "ACC", x: 38, y: 48, kind: "switch" },
    { id: "CORE", label: "CORE", x: 56, y: 48, kind: "switch" },
    { id: "WLC", label: "WLC", subLabel: ADDR.wlc, x: 56, y: 14, kind: "server" },
    { id: "DHCP", label: "DHCP", x: 76, y: 22, kind: "server" },
    { id: "WAN", label: "WAN", x: 76, y: 60, kind: "cloud" },
    { id: "BR-SW", label: "BR-SW", subLabel: "branch", x: 92, y: 74, kind: "switch" },
    { id: "BR-AP", label: "BR-AP", subLabel: "FlexConnect", x: 76, y: 90, kind: "accessPoint" },
  ],
  edges: (s) => [
    { id: "lap", a: "LAPTOP", b: "AP1", label: "Wi-Fi" },
    { id: "gp", a: "GUEST-PHONE", b: "AP1", label: "Wi-Fi" },
    { id: "ap-acc", a: "AP1", b: "ACC", label: "access 30" },
    { id: "acc-core", a: "ACC", b: "CORE", label: "trunk" },
    { id: "po1", a: "CORE", b: "WLC", label: `Po1 · ${s.po1Allowed.join(",")}` },
    { id: "dhcp", a: "CORE", b: "DHCP" },
    { id: "wan", a: "CORE", b: "WAN" },
    { id: "brsw", a: "WAN", b: "BR-SW" },
    { id: "brap", a: "BR-SW", b: "BR-AP", label: "trunk" },
  ],
  enterable: ["AP1", "WLC", "CORE"],
  primaryDevice: { "ap-dhcp": "AP1", "capwap-join": "WLC", config: "WLC", client: "AP1", "wlc-bridges": "CORE", "fault-injected": "WLC", "inc-guest": "CORE", "diagnostic-layers": "CORE", "repair-challenge": "CORE", verify: "CORE" },
  ...adapters,
  callout: kitCallout,
  repair: {
    stepId: "repair-challenge",
    prompt: "GUEST clients authenticate but never get an address. Which change fixes the cause?",
    options: WARCH_REPAIR_OPTIONS,
    correctId: WARCH_REPAIR_CORRECT,
    success: "Po1 now carries VLAN 50. Guest frames tagged by the WLC reach CORE, the DHCP relay forwards them and guests get 10.50.0.0/24 addresses.",
    wrongFeedback: {
      flex: "Then guest frames would leave AP1 tagged VLAN 50 — onto an access port in VLAN 30, which drops them too. And you'd lose central control of guest traffic.",
      open: "Authentication already works. Removing it only makes the guest network insecure.",
      reboot: "The WLC is doing exactly what it's configured to do; the frames are dropped on the switch.",
    },
    attempt: (s) => s.repairAttempt,
  },
  diagnostics: {
    fromStepId: "diagnostic-layers",
    layers: (s) => [
      { label: "Radio — GUEST beaconed, client associated", status: "healthy" },
      { label: "Authentication — WPA3-SAE succeeded", status: "healthy" },
      { label: "CAPWAP — AP1 joined, data tunnel up", status: "healthy" },
      { label: "WLAN mapping — GUEST → VLAN 50 on the WLC", status: "healthy" },
      { label: `WLC trunk — CORE Po1 allows ${s.po1Allowed.join(",")}`, status: allowed(s, 50) ? "healthy" : "failing" },
      { label: `DHCP — ${allowed(s, 50) ? "Discover reaches the server" : "no Discover seen"}`, status: allowed(s, 50) ? "healthy" : "failing" },
    ],
  },
  complete: { badge: "Lesson Complete", title: "You can build wireless the enterprise way", message: "Controller, cloud or autonomous; APs that find their WLC and join over CAPWAP; WLANs with security, QoS and a VLAN; local mode versus FlexConnect — and every WLAN VLAN carried on the trunk that serves it." },
};

export default function WirelessArchitecturesDemo() {
  return <FundamentalsLessonShell config={config} />;
}
