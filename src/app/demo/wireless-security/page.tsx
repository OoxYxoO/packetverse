"use client";

import { FundamentalsLessonShell, type FundamentalsLessonConfig } from "@/components/lesson/FundamentalsLessonShell";
import type { LessonGuideTab } from "@/components/lesson/LessonGuideDialog";
import { kitAdapters, kitCallout, type KitDevice } from "@/components/lesson/ccnaKit";
import { ST, WS_REPAIR_CORRECT, WS_REPAIR_OPTIONS, createWsecState, wsecSteps, type WsecState } from "@/lib/sim-engine/scenarios/ccna/wirelessSecurity";
import { WlcGuiCard, WsecPanel } from "./WsecPanel";
import { WS_BRIEFING_NOTES, WS_BRIEFING_PHASES, WS_DEEP_SECTIONS, WS_LESSON_SECTIONS, WsDeepDiveContent, WsLessonGuideContent } from "./guide";

const GUIDE_TABS: LessonGuideTab[] = [
  { id: "lesson", label: "This Lesson", hint: "WEP → WPA3 · handshake · PSK vs 802.1X · GUI", sections: WS_LESSON_SECTIONS, content: <WsLessonGuideContent /> },
  { id: "deep", label: "Wireless Security Deep Dive", hint: "EAP methods · vendors · misconceptions", sections: WS_DEEP_SECTIONS, content: <WsDeepDiveContent /> },
];

const DEVICES: KitDevice<WsecState>[] = [
  { id: "LAPTOP", deviceType: "Laptop", role: "Supports every method up to WPA3.", stages: ST.host, ports: (s) => [{ id: "wlan0", neighbor: "AP1", linkType: typeof s.joined.LAPTOP === "string" ? s.joined.LAPTOP : "not joined" }], knows: (s) => `Joined with ${s.joined.LAPTOP ?? "—"}` },
  { id: "SCANNER", deviceType: "Barcode scanner", role: "Older firmware: WPA2-PSK only.", stages: ST.host, ports: (s) => [{ id: "wlan0", neighbor: "AP1", linkType: s.joined.SCANNER ?? "not joined", up: s.joined.SCANNER !== "refused" }], knows: (s) => `Joined with ${s.joined.SCANNER ?? "—"}` },
  { id: "LISTENER", deviceType: "Passive listener", role: "A capture running in the parking lot.", stages: ST.host, ports: () => [], knows: (s) => `Can read: ${s.listenerReads}` },
  { id: "AP1", deviceType: "Access point (local mode)", role: "Serves the WLANs pushed by the WLC.", stages: ST.ap, ports: () => [{ id: "radio0", linkType: "5 GHz" }, { id: "Gi0", neighbor: "WLC", linkType: "CAPWAP to WLC" }], knows: (s) => s.wlans.map((w) => w.ssid).join(", ") },
  { id: "WLC", deviceType: "Wireless LAN controller", role: "Holds every WLAN's security settings.", stages: ST.wlc, ports: () => [{ id: "Po1", neighbor: "RADIUS", linkType: "10.30.0.10" }], knows: (s) => `${s.wlans.length} WLANs`, tables: (s) => [{ title: "WLANs", rows: s.wlans.map((w) => ({ label: w.ssid, value: `VLAN ${w.vlan} · ${w.akms.join(" + ")} · PMF ${w.pmf}` })) }] },
  { id: "RADIUS", deviceType: "RADIUS server", role: "802.1X authentication server.", stages: ST.rad, ports: () => [{ id: "eth0", neighbor: "WLC", linkType: "10.99.0.20 · UDP 1812/1813" }], knows: (s) => (s.radius ? "Serving CORP-SECURE" : "Not used yet") },
];
const adapters = kitAdapters(DEVICES, "wireless security");

const config: FundamentalsLessonConfig<WsecState> = {
  lessonId: "wireless-security",
  xp: 125,
  steps: wsecSteps,
  createState: createWsecState,
  badge: "CCNA · Security Fundamentals",
  title: "Wireless Security: WPA2 & WPA3",
  intro: "Radio doesn't stop at the wall. See what a listener reads on open Wi-Fi, how WPA2's 4-way handshake builds keys without sending the password, why WPA3's SAE and 802.1X give every session a private key — then configure a WPA2-PSK WLAN and fix a hardening change that locked out older devices.",
  facts: [
    { q: "What is an SSID?", a: "The network name a WLAN broadcasts." },
    { q: "What is a WLAN profile?", a: "SSID + security + VLAN, defined on the WLC." },
    { q: "What does 802.1X need?", a: "A supplicant, an authenticator and a RADIUS server." },
    { q: "What is a PSK?", a: "One shared passphrase for the whole WLAN." },
  ],
  terms: [
    { term: "WPA2", expansion: "Wi-Fi Protected Access 2", meaning: "AES-CCMP" },
    { term: "WPA3", expansion: "Wi-Fi Protected Access 3", meaning: "SAE · PMF" },
    { term: "SAE", expansion: "Simultaneous Authentication of Equals", meaning: "Private keys" },
    { term: "PMF", expansion: "Protected management frames", meaning: "No forged deauth" },
    { term: "EAP", expansion: "Extensible Authentication Protocol", meaning: "802.1X methods" },
  ],
  guide: { title: "Wireless Security", subtitle: "LAPTOP · SCANNER · AP1 · WLC · RADIUS · listener", tabs: GUIDE_TABS },
  briefing: { phases: WS_BRIEFING_PHASES, notes: WS_BRIEFING_NOTES },
  nodes: (s) => [
    { id: "LAPTOP", label: "LAPTOP", subLabel: typeof s.joined.LAPTOP === "string" ? s.joined.LAPTOP : "", x: 8, y: 30, kind: "laptop" },
    ...(s.scanners ? [{ id: "SCANNER", label: "SCANNER", subLabel: s.joined.SCANNER ?? "", x: 8, y: 74, kind: "laptop" as const }] : []),
    { id: "LISTENER", label: "LISTENER", subLabel: "parking lot", x: 30, y: 90, kind: "laptop" },
    { id: "AP1", label: "AP1", subLabel: "local mode", x: 34, y: 46, kind: "accessPoint" },
    { id: "WLC", label: "WLC", subLabel: "10.30.0.10", x: 64, y: 46, kind: "server" },
    { id: "RADIUS", label: "RADIUS", subLabel: s.radius ? "802.1X" : "idle", x: 92, y: 22, kind: "server" },
  ],
  edges: (s) => [
    { id: "l", a: "LAPTOP", b: "AP1", label: "Wi-Fi" },
    ...(s.scanners ? [{ id: "sc", a: "SCANNER", b: "AP1", label: "Wi-Fi", down: s.joined.SCANNER === "refused" }] : []),
    { id: "cap", a: "AP1", b: "WLC", label: "CAPWAP" },
    { id: "rad", a: "WLC", b: "RADIUS", label: "UDP 1812" },
  ],
  enterable: ["AP1", "WLC", "RADIUS"],
  primaryDevice: { history: "WLC", "fault-injected": "WLC", "diagnostic-layers": "AP1", "repair-challenge": "WLC" },
  ...adapters,
  callout: kitCallout,
  sidePanel: (s) => <WsecPanel s={s} />,
  panels: (s, stepId) => {
    const w = s.wlans.find((x) => x.ssid === "WAREHOUSE");
    return w && (stepId === "gui" || stepId === "fault-injected" || stepId === "verify") ? <WlcGuiCard w={w} /> : null;
  },
  repair: {
    stepId: "repair-challenge",
    prompt: "WAREHOUSE was set to WPA3-SAE only and the WPA2-only scanners can't join. Which change fixes the cause?",
    options: WS_REPAIR_OPTIONS,
    correctId: WS_REPAIR_CORRECT,
    success: "Transition mode offers WPA2-PSK and WPA3-SAE together: scanners join with WPA2, laptops with WPA3.",
    wrongFeedback: {
      open: "Everyone joins — and every frame is readable from the parking lot.",
      tkip: "TKIP is deprecated and the scanners don't need it; they need WPA2-PSK offered.",
      reboot: "AP1 is fine. The WLAN simply offers no method the scanners support.",
    },
    attempt: (s) => s.repairAttempt,
  },
  diagnostics: {
    fromStepId: "diagnostic-layers",
    layers: (s) => {
      const w = s.wlans.find((x) => x.ssid === "WAREHOUSE");
      return [
        { label: "RF — scanners in range, association requests received", status: "healthy" },
        { label: `WLAN security — ${w?.akms.join(" + ")}; scanners support WPA2-PSK`, status: w?.akms.includes("WPA2-PSK") ? "healthy" : "failing" },
        { label: "VLAN 40 / DHCP — unchanged", status: "healthy" },
      ];
    },
  },
  complete: { badge: "Lesson Complete", title: "Your Wi-Fi is private", message: "WEP and TKIP retired, AES and the 4-way handshake, SAE for private Personal sessions, 802.1X with RADIUS for per-user keys, PMF — and a WPA2-PSK WLAN configured and kept compatible with transition mode." },
};

export default function WirelessSecurityDemo() {
  return <FundamentalsLessonShell config={config} />;
}
