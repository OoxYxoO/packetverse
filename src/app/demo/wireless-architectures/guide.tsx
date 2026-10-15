import type { BriefingPhaseDef, BriefingStepNote } from "@/components/lesson/briefing";
import { Callout, CompareCards, FieldTable, Glossary, GuideSection, Misconceptions, Mono, ProtocolStory, TroubleshootingFlow } from "@/components/lesson/GuideBlocks";
import { CliPair } from "@/components/lesson/GuideCli";
import { ExplainIt, KnowledgeQuiz, type KnowledgeQuestion } from "@/components/lesson/GuideInteractive";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { ADDR } from "@/lib/sim-engine/scenarios/ccna/wirelessArch";

export const WARCH_BRIEFING_PHASES: BriefingPhaseDef[] = [
  { phase: { label: "Architectures", tone: "cyan" }, objective: "Choose between autonomous, controller-based and cloud-managed.", steps: ["intro", "architectures"] },
  { phase: { label: "AP join", tone: "violet" }, objective: "Watch a lightweight AP find and join its WLC.", steps: ["ap-dhcp", "capwap-join", "config"] },
  { phase: { label: "Data path", tone: "ip" }, objective: "Follow a client's frame in local mode and at the branch.", steps: ["predict-client", "client", "wlc-bridges", "flexconnect"] },
  { phase: { label: "Modes and management", tone: "tcp" }, objective: "The other AP modes, and how admins get in.", steps: ["ap-modes", "management"] },
  { phase: { label: "Incident", tone: "danger" }, objective: "A new guest WLAN. Guests can't get online.", steps: ["fault-injected", "inc-guest"] },
  { phase: { label: "Diagnose", tone: "danger" }, objective: "Diagnosis pending.", steps: ["trouble-question", "diagnostic-layers"] },
  { phase: { label: "Repair pending", tone: "warning" }, objective: "Choose the change that fixes the cause you identified.", steps: ["repair-challenge"] },
  { phase: { label: "Verify", tone: "success" }, objective: "Prove guests get an address.", steps: ["verify"] },
  { phase: { label: "Complete", tone: "success" }, objective: "Architectures, CAPWAP, modes and WLAN VLANs.", steps: ["complete"] },
];
export const WARCH_BRIEFING_NOTES: Partial<Record<string, BriefingStepNote>> = {
  "ap-dhcp": { takeaway: "Option 43 tells a lightweight AP where its controller is." },
  "capwap-join": { takeaway: "CAPWAP: control on UDP 5246 (DTLS), data on 5247." },
  config: { takeaway: "A WLAN = SSID + security + QoS profile + VLAN." },
  "wlc-bridges": { takeaway: "Local mode: client traffic enters its VLAN at the WLC." },
  "ap-modes": { takeaway: "Monitor, sniffer, bridge/mesh, SE-Connect — set on the controller." },
  "fault-injected": { doingNow: "A new WLAN and DHCP scope." },
  "trouble-question": { doingNow: "Diagnosis pending." },
  "repair-challenge": { doingNow: "Choose the change that fixes the cause you identified." },
  verify: { takeaway: "Every WLAN VLAN must be allowed on the controller's trunk." },
};

export const WARCH_LESSON_SECTIONS: LessonGuideSectionLink[] = [
  { id: "wal-mission", label: "What this lesson teaches" },
  { id: "wal-arch", label: "Three architectures" },
  { id: "wal-join", label: "How a lightweight AP joins" },
  { id: "wal-modes", label: "AP modes" },
  { id: "wal-physical", label: "Physical connections" },
  { id: "wal-wlan", label: "Configuring a WLAN" },
  { id: "wal-mgmt", label: "Management access" },
  { id: "wal-incident", label: "The incident and the fix" },
  { id: "wal-glossary", label: "Glossary" },
];
export const WARCH_DEEP_SECTIONS: LessonGuideSectionLink[] = [
  { id: "wad-roam", label: "Roaming between APs" },
  { id: "wad-vendors", label: "The same ideas, other vendors" },
  { id: "wad-myths", label: "Misconceptions" },
  { id: "wad-explain", label: "Explain it" },
  { id: "wad-quiz", label: "Check yourself" },
];

export function WarchLessonGuideContent() {
  return (
    <>
      <GuideSection id="wal-mission" eyebrow="Mission" title="What this lesson teaches">
        <p>Follow a lightweight AP from power-on to serving clients: find the controller, join it over CAPWAP, download its WLANs. Then follow a client frame through a tunnel at HQ and locally at a branch, and fix a guest network that authenticates everyone but gives no one an address.</p>
        <Callout tone="violet" title="CCNA 2.6 · 2.7 · 2.8 · 2.9">Wireless architectures and AP modes; physical connections of APs and WLCs; management access; configuring a WLAN (security, QoS profile, advanced settings).</Callout>
      </GuideSection>
      <GuideSection id="wal-arch" eyebrow="Architectures" title="Three architectures">
        <CompareCards
          items={[
            { title: "Autonomous", tone: "warning", tag: "each AP alone", points: ["Configured one by one", "Fine for a handful of APs", "No central RF or roaming control"] },
            { title: "Controller-based (lightweight)", tone: "violet", tag: "split-MAC", points: ["AP handles real-time radio work", "WLC handles config, security, RF, roaming", "CAPWAP between them"] },
            { title: "Cloud-managed", tone: "cyan", tag: "dashboard", points: ["Configured from the vendor cloud", "User traffic stays local", "Great for many small sites"] },
          ]}
        />
      </GuideSection>
      <GuideSection id="wal-join" eyebrow="Join" title="How a lightweight AP joins">
        <ProtocolStory
          steps={[
            { actor: "AP1", action: `DHCP in AP VLAN ${ADDR.apMgmtVlan}: ${ADDR.ap}, option 43 = WLC ${ADDR.wlc}.` },
            { actor: "AP1 → WLC", action: "CAPWAP Discovery and Join Request, UDP 5246, inside DTLS." },
            { actor: "WLC", action: "Validates the AP's certificate, sends Join Response.", changes: "AP1 joined." },
            { actor: "WLC → AP1", action: "Image check, configuration: WLANs, channels, power.", changes: "AP1 beacons CORP." },
          ]}
        />
      </GuideSection>
      <GuideSection id="wal-modes" eyebrow="Modes" title="AP modes">
        <FieldTable
          title="Modes set on the controller"
          columns={["Mode", "Serves clients?", "Use"]}
          rows={[
            ["Local", "Yes — traffic tunnelled to the WLC", "Campus default"],
            ["FlexConnect", "Yes — switched locally on the AP's port", "Branches across a WAN"],
            ["Monitor", "No", "Rogue and intrusion detection"],
            ["Sniffer", "No", "Packet capture to an analyzer"],
            ["Bridge / mesh", "Yes", "Wireless backhaul where cable can't go"],
            ["SE-Connect", "No", "Spectrum analysis"],
          ]}
        />
      </GuideSection>
      <GuideSection id="wal-physical" eyebrow="Cabling" title="Physical connections">
        <FieldTable
          title="Which switch port for which device"
          columns={["Device", "Switch port", "Why"]}
          rows={[
            ["AP in local mode", "Access port (AP VLAN), PoE", "Only CAPWAP leaves the AP"],
            ["AP in FlexConnect", "802.1Q trunk (AP VLAN native + WLAN VLANs), PoE", "Client VLANs leave the AP tagged"],
            ["WLC", "Trunk, usually a LAG (port-channel)", "Every WLAN VLAN plus management on one bundle"],
          ]}
        />
        <Callout tone="warning" title="LAG to a WLC">Cisco WLCs support LAG as a static bundle (mode on) — no LACP/PAgP negotiation on many models. Configure the switch side to match.</Callout>
      </GuideSection>
      <GuideSection id="wal-wlan" eyebrow="WLAN" title="Configuring a WLAN">
        <FieldTable
          title="The parts of a WLAN"
          columns={["Setting", "CORP", "GUEST"]}
          rows={[
            ["SSID", "CORP", "GUEST"],
            ["Security", "WPA2/WPA3-Enterprise (802.1X)", "WPA3-Personal (SAE)"],
            ["Interface / VLAN", "10", "50"],
            ["QoS profile", "Silver (best effort)", "Bronze (background)"],
            ["Advanced", "802.11r fast roaming", "Client isolation, session timeout"],
          ]}
        />
      </GuideSection>
      <GuideSection id="wal-mgmt" eyebrow="Management" title="Management access">
        <p>Console, SSH and HTTPS to the WLC and APs; Telnet and HTTP off. Authenticate admins with TACACS+ (per-command authorization) or RADIUS against a central server. Cloud-managed systems use the dashboard over HTTPS.</p>
      </GuideSection>
      <GuideSection id="wal-incident" eyebrow="Incident" title="The incident and the fix" tone="danger">
        <TroubleshootingFlow
          steps={[
            { question: "Do clients associate and authenticate?", look: "WLC client details." },
            { question: "Which VLAN does the WLC put them in?", look: "WLAN → interface mapping." },
            { question: "Does the WLC's trunk carry that VLAN?", look: <><Mono>show interfaces trunk</Mono> on the switch facing the WLC.</> },
            { question: "Does DHCP see the request?", look: "DHCP server logs / relay counters." },
          ]}
        />
        <CliPair
          cisco={{ prompt: "CORE(config)#", command: "interface port-channel 1", output: " switchport trunk allowed vlan add 50\n!\nCORE# show interfaces trunk | include Po1" }}
          junos={{ prompt: "admin@CORE# ", command: "set interfaces ae1 unit 0 family ethernet-switching vlan members GUEST", output: "set vlans GUEST vlan-id 50" }}
        />
      </GuideSection>
      <GuideSection id="wal-glossary" eyebrow="Words" title="Glossary">
        <Glossary
          items={[
            { term: "WLC", def: "Wireless LAN controller: central configuration, security and RF for lightweight APs." },
            { term: "CAPWAP", def: "Control and Provisioning of Wireless Access Points: UDP 5246 control (DTLS), 5247 data." },
            { term: "Option 43", def: "DHCP vendor option that hands an AP its controller's address." },
            { term: "FlexConnect", def: "AP mode that switches client traffic locally at the branch." },
            { term: "WLAN", def: "An SSID with its security, QoS profile and VLAN." },
          ]}
        />
      </GuideSection>
    </>
  );
}

const QUIZ: KnowledgeQuestion[] = [
  { id: "wad-q1", prompt: "A FlexConnect AP's switch port is an access port in the AP VLAN only. Clients on a locally switched WLAN mapped to VLAN 20 get no address. Why?", options: [{ id: "trunk", label: "The port must be a trunk carrying VLAN 20" }, { id: "wlc", label: "The WLC must be rebooted" }, { id: "capwap", label: "CAPWAP is blocked" }], correctId: "trunk", explanation: "In FlexConnect, client frames leave the AP tagged with their WLAN VLAN; the access port drops them." },
  { id: "wad-q2", prompt: "Which UDP port carries CAPWAP client data?", options: [{ id: "5247", label: "5247" }, { id: "5246", label: "5246" }, { id: "443", label: "443" }], correctId: "5247", explanation: "5246 is the control channel; 5247 carries tunnelled client frames." },
];

export function WarchDeepDiveContent() {
  return (
    <>
      <GuideSection id="wad-roam" eyebrow="Roaming" title="Roaming between APs">
        <p>Clients decide when to roam. With a controller, a client moving between APs on the same WLC keeps its VLAN and address (intra-controller roaming); 802.11r fast transition avoids re-running the full 802.1X exchange.</p>
      </GuideSection>
      <GuideSection id="wad-vendors" eyebrow="Vendors" title="The same ideas, other vendors">
        <p>Juniper Mist, Aruba and others use the same split: APs doing radio work, a controller or cloud doing management. Mist and Meraki are cloud-managed; Aruba offers both controllers and cloud. CAPWAP is Cisco&apos;s (and an IETF standard); others use their own tunnels (for example Aruba&apos;s GRE/IPsec).</p>
      </GuideSection>
      <GuideSection id="wad-myths" eyebrow="Misconceptions" title="Misconceptions">
        <Misconceptions
          items={[
            { myth: "All Wi-Fi traffic passes through the controller.", correction: "Only in local mode. FlexConnect and most cloud-managed designs switch it at the AP." },
            { myth: "An AP needs a trunk port.", correction: "Local-mode APs need only an access port in their management VLAN." },
          ]}
        />
      </GuideSection>
      <GuideSection id="wad-explain" eyebrow="Explain" title="Explain it">
        <ExplainIt items={[{ q: "Why did CORP users keep working while guests failed?", a: "VLAN 10 was already allowed on Po1; only the new VLAN 50 was missing from the trunk." }]} />
      </GuideSection>
      <GuideSection id="wad-quiz" eyebrow="Quiz" title="Check yourself">
        <KnowledgeQuiz questions={QUIZ} />
      </GuideSection>
    </>
  );
}
