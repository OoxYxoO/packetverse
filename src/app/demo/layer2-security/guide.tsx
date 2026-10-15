import type { BriefingPhaseDef, BriefingStepNote } from "@/components/lesson/briefing";
import { Callout, FieldTable, Glossary, GuideSection, Misconceptions, Mono, TroubleshootingFlow } from "@/components/lesson/GuideBlocks";
import { CliPair } from "@/components/lesson/GuideCli";
import { ExplainIt, KnowledgeQuiz, type KnowledgeQuestion } from "@/components/lesson/GuideInteractive";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { FLOOD, OFFERS, STORM, fillMs, stormDroppedPct } from "@/lib/sim-engine/scenarios/ccna/layer2Security";

export const L2_BRIEFING_PHASES: BriefingPhaseDef[] = [
  { phase: { label: "The inside edge", tone: "cyan" }, objective: "Why access ports need their own defences.", steps: ["intro"] },
  { phase: { label: "Port security", tone: "violet" }, objective: "MAC flooding, and a limit per port.", steps: ["predict-flood", "flood", "portsec-cfg", "predict-violation", "violation", "modes"] },
  { phase: { label: "DHCP & ARP", tone: "ip" }, objective: "Rogue servers and forged replies — snooping and DAI.", steps: ["predict-dhcp", "rogue-dhcp", "snooping", "predict-arp", "arp-spoof", "dai"] },
  { phase: { label: "RA Guard & storms", tone: "cyan" }, objective: "Rogue IPv6 routers and broadcast floods.", steps: ["ra-spoof", "ra-guard", "storm"] },
  { phase: { label: "Incident", tone: "danger" }, objective: "A printer goes silent.", steps: ["fault-injected", "inc-print"] },
  { phase: { label: "Diagnose", tone: "danger" }, objective: "Diagnosis pending.", steps: ["trouble-question", "diagnostic-layers"] },
  { phase: { label: "Repair pending", tone: "warning" }, objective: "Choose the change that fixes the cause you identified.", steps: ["repair-challenge"] },
  { phase: { label: "Verify", tone: "success" }, objective: "Prove the printer works and the protection stays.", steps: ["verify"] },
  { phase: { label: "Complete", tone: "success" }, objective: "Five controls, five attacks.", steps: ["complete"] },
];
export const L2_BRIEFING_NOTES: Partial<Record<string, BriefingStepNote>> = {
  flood: { takeaway: "A full MAC table turns the switch into a hub." },
  violation: { takeaway: "Port security caps MACs per port." },
  modes: { takeaway: "protect · restrict · shutdown." },
  "rogue-dhcp": { takeaway: "DHCP clients take the first offer." },
  snooping: { takeaway: "Only trusted ports may send DHCP offers." },
  "arp-spoof": { takeaway: "ARP believes whoever speaks." },
  dai: { takeaway: "DAI checks ARPs against snooping bindings." },
  "ra-guard": { takeaway: "RA Guard drops router advertisements on host ports." },
  storm: { takeaway: "Storm control caps floods per port." },
  "fault-injected": { doingNow: "A device stops working." },
  "trouble-question": { doingNow: "Diagnosis pending." },
  "repair-challenge": { doingNow: "Choose the change that fixes the cause you identified." },
  verify: { takeaway: "Static hosts need static DAI entries." },
};

export const L2_LESSON_SECTIONS: LessonGuideSectionLink[] = [
  { id: "l2l-mission", label: "What this lesson teaches" },
  { id: "l2l-map", label: "Attack → control map" },
  { id: "l2l-portsec", label: "Port security" },
  { id: "l2l-dhcp", label: "DHCP snooping and DAI" },
  { id: "l2l-ra", label: "RA Guard and storm control" },
  { id: "l2l-config", label: "Configure and verify" },
  { id: "l2l-incident", label: "The incident and the fix" },
  { id: "l2l-glossary", label: "Glossary" },
];
export const L2_DEEP_SECTIONS: LessonGuideSectionLink[] = [
  { id: "l2d-8021x", label: "Beyond these: 802.1X" },
  { id: "l2d-vendors", label: "Other vendors" },
  { id: "l2d-myths", label: "Misconceptions" },
  { id: "l2d-explain", label: "Explain it" },
  { id: "l2d-quiz", label: "Check yourself" },
];

export function L2LessonGuideContent() {
  return (
    <>
      <GuideSection id="l2l-mission" eyebrow="Mission" title="What this lesson teaches">
        <p>For each access-layer attack: what it exploits, what the switch does when the control is on, and what you see on the switch when it fires.</p>
        <Callout tone="violet" title="CCNA 5.7">Configure and verify Layer 2 security features: DHCP snooping, dynamic ARP inspection and port security — plus RA Guard and storm control, which protect the same edge.</Callout>
      </GuideSection>
      <GuideSection id="l2l-map" eyebrow="Map" title="Attack → control map">
        <FieldTable
          title="What each control protects"
          columns={["Attack", "What it exploits", "Control", "What the switch does"]}
          rows={[
            ["MAC flooding", "A finite MAC table", "Port security", "Limits MACs per port; violation action"],
            ["Rogue DHCP server", "Clients take the first offer", "DHCP snooping", "Drops OFFER/ACK on untrusted ports"],
            ["ARP spoofing", "ARP has no authentication", "Dynamic ARP inspection", "Drops ARPs that don't match a binding"],
            ["Rogue IPv6 router", "Hosts trust any RA", "RA Guard", "Drops RAs on host-facing ports"],
            ["Broadcast storm", "Floods reach every port", "Storm control", "Drops traffic above a level"],
          ]}
        />
      </GuideSection>
      <GuideSection id="l2l-portsec" eyebrow="Port security" title="Port security">
        <p>
          The lesson&apos;s flood fills a {FLOOD.tableSize.toLocaleString()}-entry table in {fillMs()} ms. A maximum of 2 MACs per port stops it at the third.
        </p>
        <FieldTable
          title="Violation modes"
          columns={["Mode", "Drops excess frames", "Logs / counts", "Port"]}
          rows={[
            ["protect", "yes", "no", "stays up"],
            ["restrict", "yes", "yes", "stays up"],
            ["shutdown (default)", "yes", "yes", "err-disabled"],
          ]}
        />
      </GuideSection>
      <GuideSection id="l2l-dhcp" eyebrow="DHCP & ARP" title="DHCP snooping and DAI">
        <p>
          The rogue offer arrived in {OFFERS.rogueMs} ms, the real one in {OFFERS.legitMs} ms — so the rogue wins unless the switch drops it. Snooping marks the uplink trusted and every user port untrusted, and records a binding (MAC, IP, VLAN, port) for each lease. DAI then accepts an ARP on an untrusted port only if its sender IP and MAC match a binding on that port.
        </p>
        <Callout tone="warning" title="DAI depends on snooping">Hosts with static addresses have no binding. Give them a static ARP ACL entry, or DAI will drop them.</Callout>
      </GuideSection>
      <GuideSection id="l2l-ra" eyebrow="RA & storms" title="RA Guard and storm control">
        <p>
          RA Guard applies a policy with role host to access ports and router to the uplink. Storm control measured {STORM.broadcastPct}% broadcast against a level of {STORM.levelPct}%: {stormDroppedPct()}% of the storm was dropped. It limits damage; BPDU Guard and STP remove the loop.
        </p>
      </GuideSection>
      <GuideSection id="l2l-config" eyebrow="Configure" title="Configure and verify">
        <CliPair
          cisco={{ prompt: "ACC-SW(config)#", command: "ip dhcp snooping vlan 10", output: "ip dhcp snooping\nip arp inspection vlan 10\ninterface Gi1/0/48\n ip dhcp snooping trust\n ip arp inspection trust\ninterface range Gi1/0/1 - 24\n switchport port-security\n switchport port-security maximum 2\n ipv6 nd raguard attach-policy HOSTS\n storm-control broadcast level 5\n!\nACC-SW# show port-security interface Gi1/0/5\nACC-SW# show ip dhcp snooping binding\nACC-SW# show ip arp inspection statistics vlan 10" }}
          junos={{ prompt: "admin@ACC-SW# ", command: "set vlans V10 forwarding-options dhcp-security arp-inspection", output: "set vlans V10 forwarding-options dhcp-security group UP overrides trusted\nset vlans V10 forwarding-options dhcp-security group UP interface ge-0/0/47.0\nset switch-options interface ge-0/0/5.0 interface-mac-limit 2\nset forwarding-options storm-control-profiles SC all bandwidth-percentage 5\nset interfaces ge-0/0/2 unit 0 family ethernet-switching storm-control SC\nadmin@ACC-SW> show dhcp-security binding" }}
          junosCaption="Junos (EX, ELS) — trunk ports are trusted by default"
        />
      </GuideSection>
      <GuideSection id="l2l-incident" eyebrow="Incident" title="The incident and the fix" tone="danger">
        <TroubleshootingFlow
          steps={[
            { question: "Is DAI dropping it?", look: <Mono>show ip arp inspection statistics vlan 10</Mono> },
            { question: "Does a binding exist?", look: <Mono>show ip dhcp snooping binding</Mono> },
            { question: "Why not?", look: "The printer is statically addressed — it never used DHCP." },
          ]}
        />
        <p>
          Fix: <Mono>arp access-list STATIC</Mono> → <Mono>permit ip host 10.1.10.200 mac host 0050.56aa.0200</Mono> → <Mono>ip arp inspection filter STATIC vlan 10</Mono>.
        </p>
      </GuideSection>
      <GuideSection id="l2l-glossary" eyebrow="Words" title="Glossary">
        <Glossary
          items={[
            { term: "err-disabled", def: "A port shut down by the switch for a violation; needs recovery." },
            { term: "Trusted port", def: "A snooping/DAI port whose DHCP server messages and ARPs are not checked." },
            { term: "Binding", def: "A snooping record: MAC, IP, VLAN, port, lease." },
            { term: "Gratuitous ARP", def: "An unsolicited ARP reply — legitimate, and abused by spoofing." },
            { term: "RA", def: "IPv6 router advertisement: 'I am a router; here is a prefix'." },
          ]}
        />
      </GuideSection>
    </>
  );
}

const QUIZ: KnowledgeQuestion[] = [
  { id: "l2d-q1", prompt: "After enabling DHCP snooping, no client gets an address. Which is the likely mistake?", options: [{ id: "trust", label: "The uplink toward the DHCP server wasn't trusted" }, { id: "max", label: "Port security maximum is too low" }, { id: "dai", label: "DAI is off" }], correctId: "trust", explanation: "All ports are untrusted by default, including the uplink — so the real server's OFFERs are dropped." },
  { id: "l2d-q2", prompt: "Which mode drops excess frames and logs them but keeps the port up?", options: [{ id: "restrict", label: "restrict" }, { id: "protect", label: "protect" }, { id: "shutdown", label: "shutdown" }], correctId: "restrict", explanation: "restrict drops and counts/logs; protect drops silently; shutdown err-disables." },
  { id: "l2d-q3", prompt: "DAI validates ARPs against what?", options: [{ id: "bind", label: "The DHCP snooping binding table (and static ARP ACLs)" }, { id: "mac", label: "The MAC address table" }, { id: "route", label: "The routing table" }], correctId: "bind", explanation: "DAI reuses snooping's IP-MAC-port bindings." },
];

export function L2DeepDiveContent() {
  return (
    <>
      <GuideSection id="l2d-8021x" eyebrow="Next step" title="Beyond these: 802.1X">
        <p>These controls limit what a connected device can do. 802.1X decides whether it may connect at all: the switch asks a RADIUS server to authenticate the user or device before the port forwards traffic — see Device Access &amp; AAA and Wireless Security.</p>
      </GuideSection>
      <GuideSection id="l2d-vendors" eyebrow="Vendors" title="Other vendors">
        <p>The features exist everywhere under similar names: Junos dhcp-security (snooping, ARP inspection, IP source guard) and MAC limiting; Aruba CX dhcpv4-snooping, ARP inspection and port-access security. The behaviour — trusted vs untrusted, bindings, per-port limits — is the same.</p>
      </GuideSection>
      <GuideSection id="l2d-myths" eyebrow="Misconceptions" title="Misconceptions">
        <Misconceptions
          items={[
            { myth: "DAI works on its own.", correction: "It needs DHCP snooping bindings (or static entries) to check against." },
            { myth: "Trusting a problem port is a fine fix.", correction: "A trusted port can send any ARP or DHCP offer — it removes the protection for that port." },
            { myth: "IPv4 controls protect IPv6.", correction: "IPv6 has its own: RA Guard, DHCPv6 Guard, ND inspection." },
          ]}
        />
      </GuideSection>
      <GuideSection id="l2d-explain" eyebrow="Explain" title="Explain it">
        <ExplainIt items={[{ q: "Why did the printer fail while PC1 and PC2 kept working?", a: "PC1 and PC2 got their addresses from DHCP, so snooping recorded bindings for them. The printer is static, so DAI found nothing to validate its ARPs against." }]} />
      </GuideSection>
      <GuideSection id="l2d-quiz" eyebrow="Quiz" title="Check yourself">
        <KnowledgeQuiz questions={QUIZ} />
      </GuideSection>
    </>
  );
}
