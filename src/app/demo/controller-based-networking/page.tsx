"use client";

import { FundamentalsLessonShell, type FundamentalsLessonConfig } from "@/components/lesson/FundamentalsLessonShell";
import type { LessonGuideTab } from "@/components/lesson/LessonGuideDialog";
import { kitAdapters, kitCallout, type KitDevice } from "@/components/lesson/ccnaKit";
import { CTRL_REPAIR_CORRECT, CTRL_REPAIR_OPTIONS, ST, createCtrlState, ctrlSteps, fleetSize, withVlan, type CtrlState } from "@/lib/sim-engine/scenarios/ccna/controllerNetworking";
import { CtrlPanel } from "./CtrlPanel";
import { CTRL_BRIEFING_NOTES, CTRL_BRIEFING_PHASES, CTRL_DEEP_SECTIONS, CTRL_LESSON_SECTIONS, CtrlDeepDiveContent, CtrlLessonGuideContent } from "./guide";

const GUIDE_TABS: LessonGuideTab[] = [
  { id: "lesson", label: "This Lesson", hint: "Why automate · planes · APIs · fabric · cloud", sections: CTRL_LESSON_SECTIONS, content: <CtrlLessonGuideContent /> },
  { id: "deep", label: "Controllers Deep Dive", hint: "Products · NETCONF · misconceptions", sections: CTRL_DEEP_SECTIONS, content: <CtrlDeepDiveContent /> },
];

const swDev = (id: string, role: string): KitDevice<CtrlState> => ({
  id,
  deviceType: "Access switch group",
  role,
  stages: ST.sw,
  ports: (s) => [{ id: "mgmt", neighbor: "CTRL", linkType: s.switches.find((w) => w.id === id)?.managed ? "NETCONF 830 · managed" : "not managed" }],
  knows: (s) => {
    const w = s.switches.find((x) => x.id === id);
    return w ? `${w.count} switches · VLANs ${w.vlans.join(", ")}` : "";
  },
});
const DEVICES: KitDevice<CtrlState>[] = [
  { id: "ENG", deviceType: "Engineer's laptop", role: "Scripts and the controller's API.", stages: ST.eng, ports: () => [], knows: () => "REST client" },
  {
    id: "CTRL",
    deviceType: "Network controller",
    role: "Holds intent and inventory; configures switches southbound.",
    stages: ST.ctrl,
    ports: () => [{ id: "mgmt", linkType: "10.9.0.50" }],
    knows: (s) => `${s.switches.filter((w) => w.managed).reduce((n, w) => n + w.count, 0)} switches in inventory`,
    tables: (s) => [{ title: "Inventory (site HQ)", rows: s.switches.map((w) => ({ label: w.id, value: `${w.count} · ${w.managed ? "managed" : "unknown"}` })) }],
  },
  swDev("SW-B1", "Building 1, 15 access switches."),
  swDev("SW-B2", "Building 2, 15 access switches."),
  swDev("SW-B3", "Building 3, 15 access switches."),
  swDev("SW-F9", "Floor 9 — three new switches."),
  { id: "CLOUD", deviceType: "Cloud dashboard", role: "Management plane for the branch.", stages: ST.cloud, ports: () => [], knows: (s) => (s.cloudLink ? "Branch connected" : "Branch unreachable") },
  { id: "BR-SW", deviceType: "Cloud-managed branch switch", role: "Configured from the dashboard.", stages: ST.sw, ports: (s) => [{ id: "uplink", neighbor: "CLOUD", linkType: "HTTPS to dashboard", up: s.cloudLink }], knows: () => "Forwarding locally" },
];
const adapters = kitAdapters(DEVICES, "planes");

const config: FundamentalsLessonConfig<CtrlState> = {
  lessonId: "controller-based-networking",
  xp: 125,
  steps: ctrlSteps,
  createState: createCtrlState,
  badge: "CCNA · Automation & Programmability",
  title: "Controller-Based & Cloud-Managed Networking",
  intro: "One VLAN on 48 switches: compute what doing it by hand costs, then do it once through a controller. Learn the three planes, northbound and southbound APIs, underlay and overlay — and what a cloud-managed branch does when the cloud is out of reach.",
  facts: [
    { q: "What is a controller?", a: "Software that holds network-wide intent and configures devices." },
    { q: "What is intent?", a: "What you want, stated once — not per-device commands." },
    { q: "What is NETCONF?", a: "A device-configuration protocol over SSH, using YANG models." },
    { q: "What is cloud-managed?", a: "Devices managed from a vendor's online dashboard." },
  ],
  terms: [
    { term: "SDN", expansion: "Software-defined networking", meaning: "Central control" },
    { term: "NBI", expansion: "Northbound interface", meaning: "Apps → controller" },
    { term: "SBI", expansion: "Southbound interface", meaning: "Controller → devices" },
    { term: "YANG", expansion: "Data modeling language", meaning: "Config schema" },
    { term: "VXLAN", expansion: "Virtual extensible LAN", meaning: "Overlay tunnels" },
  ],
  guide: { title: "Controller-Based Networking", subtitle: "ENG · controller · 48 access switches · cloud-managed branch", tabs: GUIDE_TABS },
  briefing: { phases: CTRL_BRIEFING_PHASES, notes: CTRL_BRIEFING_NOTES },
  nodes: (s) => [
    { id: "ENG", label: "ENG", subLabel: "REST", x: 8, y: 22, kind: "laptop" },
    { id: "CTRL", label: "CTRL", subLabel: "controller", x: 36, y: 22, kind: "server" },
    { id: "SW-B1", label: "SW-B1", subLabel: "×15", x: 18, y: 60, kind: "switch" },
    { id: "SW-B2", label: "SW-B2", subLabel: "×15", x: 38, y: 60, kind: "switch" },
    { id: "SW-B3", label: "SW-B3", subLabel: "×15", x: 58, y: 60, kind: "switch" },
    ...(s.newFloor ? [{ id: "SW-F9", label: "SW-F9", subLabel: "×3 new", x: 38, y: 84, kind: "switch" as const }] : []),
    { id: "CLOUD", label: "CLOUD", subLabel: "dashboard", x: 82, y: 18, kind: "cloud" },
    { id: "BR-SW", label: "BR-SW", subLabel: "branch", x: 86, y: 66, kind: "switch" },
  ],
  edges: (s) => [
    { id: "nb", a: "ENG", b: "CTRL", label: "northbound" },
    { id: "s1", a: "CTRL", b: "SW-B1", label: "southbound" },
    { id: "s2", a: "CTRL", b: "SW-B2" },
    { id: "s3", a: "CTRL", b: "SW-B3" },
    ...(s.newFloor ? [{ id: "s9", a: "CTRL", b: "SW-F9", down: !s.switches.find((w) => w.id === "SW-F9")?.managed }] : []),
    { id: "cl", a: "CLOUD", b: "BR-SW", label: "HTTPS", down: !s.cloudLink },
  ],
  enterable: ["CTRL", "SW-B1", "BR-SW"],
  primaryDevice: { manual: "ENG", "fault-injected": "SW-F9", "diagnostic-layers": "CTRL", "repair-challenge": "CTRL" },
  ...adapters,
  callout: kitCallout,
  sidePanel: (s) => <CtrlPanel s={s} />,
  repair: {
    stepId: "repair-challenge",
    prompt: "The cameras intent reached 45 of 48 switches; floor 9's three are unknown to the controller. Which change fixes the cause?",
    options: CTRL_REPAIR_OPTIONS,
    correctId: CTRL_REPAIR_CORRECT,
    success: "The new switches are discovered and assigned to the site; the controller provisions VLAN 30 on all 48 — and will include them in every future intent.",
    wrongFeedback: {
      cli: "The cameras would work today — but the controller still doesn't know these switches. The next intent skips them again and their configs drift.",
      core: "The access switches need the VLAN on their camera ports and uplinks; the core alone can't deliver it.",
      restart: "The controller works fine. It just doesn't manage those switches.",
    },
    attempt: (s) => s.repairAttempt,
  },
  diagnostics: {
    fromStepId: "diagnostic-layers",
    layers: (s) => {
      const f9 = s.switches.find((w) => w.id === "SW-F9");
      return [
        { label: `Intent — VLAN 30 CAMERAS for all access switches at HQ`, status: "healthy" },
        { label: `Inventory — ${f9?.managed ? "48 of 48" : "45 of 48"} switches known`, status: f9?.managed ? "healthy" : "failing" },
        { label: "Southbound — NETCONF reachable on managed switches", status: "healthy" },
        { label: `Devices — VLAN 30 on ${s.intent ? withVlan(s, s.intent.vlan) : 0}/${fleetSize(s)}`, status: s.intent && withVlan(s, s.intent.vlan) === fleetSize(s) ? "healthy" : "failing" },
      ];
    },
  },
  complete: { badge: "Lesson Complete", title: "You can run a network as a system", message: "Compounding error computed, the three planes, northbound intent and southbound NETCONF, underlay and overlay, cloud management that never touches the data plane — and an inventory that defines what a controller can reach." },
};

export default function ControllerBasedNetworkingDemo() {
  return <FundamentalsLessonShell config={config} />;
}
