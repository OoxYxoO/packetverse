import type { BriefingPhaseDef, BriefingStepNote } from "@/components/lesson/briefing";
import { Callout, CompareCards, FieldTable, Glossary, GuideSection, Misconceptions, TroubleshootingFlow } from "@/components/lesson/GuideBlocks";
import { CliPair } from "@/components/lesson/GuideCli";
import { ExplainIt, KnowledgeQuiz, type KnowledgeQuestion } from "@/components/lesson/GuideInteractive";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { CLIENTS, GENERATIONS, negotiate, type Wlan } from "@/lib/sim-engine/scenarios/ccna/wirelessSecurity";
import { WlcGuiCard } from "./WsecPanel";

export const WS_BRIEFING_PHASES: BriefingPhaseDef[] = [
  { phase: { label: "Open air", tone: "danger" }, objective: "What anyone in range can read.", steps: ["predict-open", "open", "history"] },
  { phase: { label: "WPA2 & WPA3 Personal", tone: "violet" }, objective: "The 4-way handshake, its shared-key weakness, and SAE.", steps: ["predict-handshake", "handshake", "predict-shared", "sae"] },
  { phase: { label: "Enterprise", tone: "ip" }, objective: "A key per user through 802.1X and RADIUS — and PMF.", steps: ["enterprise", "pmf"] },
  { phase: { label: "Configure", tone: "cyan" }, objective: "A WPA2-PSK WLAN on the WLC GUI.", steps: ["predict-gui", "gui"] },
  { phase: { label: "Incident", tone: "danger" }, objective: "A hardening change at night.", steps: ["fault-injected", "inc-join"] },
  { phase: { label: "Diagnose", tone: "danger" }, objective: "Diagnosis pending.", steps: ["trouble-question", "diagnostic-layers"] },
  { phase: { label: "Repair pending", tone: "warning" }, objective: "Choose the change that fixes the cause you identified.", steps: ["repair-challenge"] },
  { phase: { label: "Verify", tone: "success" }, objective: "Prove old and new clients both join.", steps: ["verify"] },
  { phase: { label: "Complete", tone: "success" }, objective: "WEP to WPA3, PSK to 802.1X.", steps: ["complete"] },
];
export const WS_BRIEFING_NOTES: Partial<Record<string, BriefingStepNote>> = {
  open: { takeaway: "Open Wi-Fi is readable by anyone in range." },
  history: { takeaway: "WEP and TKIP are broken; AES is the baseline." },
  handshake: { takeaway: "The passphrase never crosses the air." },
  sae: { takeaway: "SAE gives every session a private key." },
  enterprise: { takeaway: "802.1X: supplicant → authenticator → RADIUS." },
  pmf: { takeaway: "PMF stops forged deauthentication." },
  gui: { takeaway: "WPA2 + AES + PSK + an 8–63 character passphrase." },
  "fault-injected": { doingNow: "A change goes in." },
  "trouble-question": { doingNow: "Diagnosis pending." },
  "repair-challenge": { doingNow: "Choose the change that fixes the cause you identified." },
  verify: { takeaway: "Transition mode: WPA3 for new clients, WPA2 for old." },
};

export const WS_LESSON_SECTIONS: LessonGuideSectionLink[] = [
  { id: "wsl-mission", label: "What this lesson teaches" },
  { id: "wsl-gens", label: "WEP, WPA, WPA2, WPA3" },
  { id: "wsl-personal", label: "Personal vs Enterprise" },
  { id: "wsl-handshake", label: "The 4-way handshake" },
  { id: "wsl-gui", label: "Configure WPA2-PSK in the GUI" },
  { id: "wsl-incident", label: "The incident and the fix" },
  { id: "wsl-glossary", label: "Glossary" },
];
export const WS_DEEP_SECTIONS: LessonGuideSectionLink[] = [
  { id: "wsd-eap", label: "EAP methods" },
  { id: "wsd-vendors", label: "Other vendors and cloud" },
  { id: "wsd-myths", label: "Misconceptions" },
  { id: "wsd-explain", label: "Explain it" },
  { id: "wsd-quiz", label: "Check yourself" },
];

const WAREHOUSE: Wlan = { ssid: "WAREHOUSE", vlan: 40, akms: ["WPA2-PSK"], pmf: "optional" };

export function WsLessonGuideContent() {
  const transition: Wlan = { ...WAREHOUSE, akms: ["WPA2-PSK", "WPA3-SAE"] };
  return (
    <>
      <GuideSection id="wsl-mission" eyebrow="Mission" title="What this lesson teaches">
        <p>Why Wi-Fi needs link encryption, how WPA2 and WPA3 build keys without ever sending the password, when a shared passphrase is acceptable and when every user needs their own — and how to configure a WPA2-PSK WLAN.</p>
        <Callout tone="violet" title="CCNA 5.9 · 5.10">Describe wireless security protocols (WPA, WPA2, WPA3); configure and verify a WLAN within the GUI using WPA2 PSK.</Callout>
      </GuideSection>
      <GuideSection id="wsl-gens" eyebrow="History" title="WEP, WPA, WPA2, WPA3">
        <FieldTable title="Four generations" columns={["Name", "Year", "Cipher", "Keys", "Status"]} rows={GENERATIONS.map((g) => [g.name, String(g.year), g.cipher, g.keys, g.status])} />
      </GuideSection>
      <GuideSection id="wsl-personal" eyebrow="Modes" title="Personal vs Enterprise">
        <CompareCards
          items={[
            { title: "Personal (PSK / SAE)", tone: "violet", tag: "one passphrase", points: ["Homes, small sites, devices without 802.1X", "WPA2-PSK: anyone with the PSK can derive a captured session's key", "WPA3-SAE: private session keys, no offline guessing"] },
            { title: "Enterprise (802.1X)", tone: "cyan", tag: "per-user", points: ["Supplicant → authenticator (AP/WLC) → RADIUS", "Each user's own credentials or certificate", "Revoke one user without touching anyone else"] },
          ]}
        />
      </GuideSection>
      <GuideSection id="wsl-handshake" eyebrow="Handshake" title="The 4-way handshake">
        <FieldTable
          title="EAPOL-Key messages"
          columns={["Msg", "Direction", "Carries", "Purpose"]}
          rows={[
            ["M1", "AP → client", "ANonce", "Client can now compute the PTK"],
            ["M2", "client → AP", "SNonce + MIC", "AP computes the PTK; MIC proves the client holds the PMK"],
            ["M3", "AP → client", "MIC + GTK (encrypted)", "AP proves the same; delivers the group key"],
            ["M4", "client → AP", "ACK", "Both install keys"],
          ]}
        />
      </GuideSection>
      <GuideSection id="wsl-gui" eyebrow="Configure" title="Configure WPA2-PSK in the GUI">
        <p>On the WLC: WLANs → Create New → profile and SSID → General (enable, interface) → Security → Layer 2 → WPA+WPA2, WPA2 policy, AES, Auth Key Mgmt PSK, passphrase → Apply.</p>
        <WlcGuiCard w={WAREHOUSE} />
        <CliPair
          ciscoCaption="Cisco IOS XE (Catalyst 9800 WLC)"
          cisco={{ prompt: "WLC(config)#", command: "wlan WAREHOUSE 4 WAREHOUSE", output: " security wpa psk set-key ascii 0 ********\n no security wpa akm dot1x\n security wpa akm psk\n security wpa wpa2 ciphers aes\n no shutdown\n!\nWLC# show wlan name WAREHOUSE" }}
          junosCaption="Juniper Mist (cloud dashboard → WLAN template)"
          junos={{ prompt: "Mist › WLANs › ", command: "Add WLAN", output: "SSID: WAREHOUSE\nSecurity type: WPA2 · PSK\nPassphrase: ********\nVLAN: 40\n(pushed to APs from the cloud)" }}
        />
      </GuideSection>
      <GuideSection id="wsl-incident" eyebrow="Incident" title="The incident and the fix" tone="danger">
        <TroubleshootingFlow
          steps={[
            { question: "Do the clients reach the AP?", look: "Yes — association requests arrive." },
            { question: "Why are they refused?", look: `WLAN offers WPA3-SAE; scanners support ${CLIENTS.SCANNER.supports.filter((a) => a !== "OPEN").join(", ")}.` },
            { question: "What lets both join?", look: `Transition mode: the scanner negotiates ${negotiate(transition, CLIENTS.SCANNER)}, the laptop ${negotiate(transition, CLIENTS.LAPTOP)}.` },
          ]}
        />
        <WlcGuiCard w={transition} />
      </GuideSection>
      <GuideSection id="wsl-glossary" eyebrow="Words" title="Glossary">
        <Glossary
          items={[
            { term: "PSK", def: "Pre-shared key: one passphrase for the WLAN." },
            { term: "SAE", def: "Simultaneous Authentication of Equals — WPA3-Personal's key exchange." },
            { term: "PMK / PTK / GTK", def: "Pairwise master key; per-session pairwise transient key; group key for broadcast." },
            { term: "AKM", def: "Authentication and key management method (PSK, SAE, 802.1X)." },
            { term: "PMF", def: "Protected management frames (802.11w)." },
            { term: "Supplicant / authenticator", def: "The client / the AP or WLC in 802.1X." },
          ]}
        />
      </GuideSection>
    </>
  );
}

const QUIZ: KnowledgeQuestion[] = [
  { id: "wsd-q1", prompt: "Which encryption does WPA2 require?", options: [{ id: "aes", label: "AES-CCMP" }, { id: "tkip", label: "TKIP" }, { id: "rc4", label: "RC4" }], correctId: "aes", explanation: "WPA2 mandates AES-CCMP. TKIP belongs to WPA; RC4 to WEP." },
  { id: "wsd-q2", prompt: "Which WPA3 feature replaces the PSK-derived PMK?", options: [{ id: "sae", label: "SAE" }, { id: "pmf", label: "PMF" }, { id: "gcmp", label: "GCMP-256" }], correctId: "sae", explanation: "SAE produces a private PMK per session. PMF protects management frames; GCMP-256 is a cipher." },
  { id: "wsd-q3", prompt: "In 802.1X, what is the AP (or WLC)?", options: [{ id: "auth", label: "The authenticator" }, { id: "supp", label: "The supplicant" }, { id: "as", label: "The authentication server" }], correctId: "auth", explanation: "The client is the supplicant, the AP/WLC the authenticator, RADIUS the authentication server." },
];

export function WsDeepDiveContent() {
  return (
    <>
      <GuideSection id="wsd-eap" eyebrow="EAP" title="EAP methods">
        <FieldTable
          title="Common 802.1X methods"
          columns={["Method", "Client proves identity with", "Notes"]}
          rows={[
            ["EAP-TLS", "A client certificate", "Strongest; needs a PKI"],
            ["PEAP (MSCHAPv2)", "Username + password inside TLS", "Common with Active Directory"],
            ["EAP-FAST", "A protected access credential", "Cisco-developed"],
          ]}
        />
      </GuideSection>
      <GuideSection id="wsd-vendors" eyebrow="Vendors" title="Other vendors and cloud">
        <p>WPA2/WPA3 and 802.1X are IEEE and Wi-Fi Alliance standards, so every vendor offers the same choices: Cisco WLCs, Aruba controllers, and cloud-managed systems such as Juniper Mist and Cisco Meraki, where the WLAN is defined once in the dashboard and pushed to every AP.</p>
      </GuideSection>
      <GuideSection id="wsd-myths" eyebrow="Misconceptions" title="Misconceptions">
        <Misconceptions
          items={[
            { myth: "Hiding the SSID secures the network.", correction: "Clients still send it in probes; it's visible to any capture." },
            { myth: "MAC filtering keeps attackers out.", correction: "MAC addresses are sent in the clear and are easy to copy." },
            { myth: "WPA2-PSK gives each user privacy from the others.", correction: "Anyone with the PSK who captures a handshake can derive that session's key. Use SAE or 802.1X." },
          ]}
        />
      </GuideSection>
      <GuideSection id="wsd-explain" eyebrow="Explain" title="Explain it">
        <ExplainIt items={[{ q: "Why didn't the 'WPA3 only' change break the laptops?", a: "Laptops support WPA3-SAE, so negotiation still found a common method. The scanners support only WPA2-PSK, which the WLAN stopped offering." }]} />
      </GuideSection>
      <GuideSection id="wsd-quiz" eyebrow="Quiz" title="Check yourself">
        <KnowledgeQuiz questions={QUIZ} />
      </GuideSection>
    </>
  );
}
