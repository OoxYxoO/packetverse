import { Callout, CompareCards, FieldTable, Glossary, GuideSection, Misconceptions, Mono, TroubleshootingFlow } from "@/components/lesson/GuideBlocks";
import { CliPair, CliPanel } from "@/components/lesson/GuideCli";
import { ExplainIt, KnowledgeQuiz, type KnowledgeQuestion } from "@/components/lesson/GuideInteractive";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { MCAST, TIMERS, VOICE, createDiscState, discoverySteps } from "@/lib/sim-engine/scenarios/ccna/discovery";
import { junosLldp, showCdp, showLldp } from "./discoveryCli";

export const DISC_LESSON_SECTIONS: LessonGuideSectionLink[] = [
  { id: "dsl-mission", label: "What this lesson teaches" },
  { id: "dsl-compare", label: "CDP and LLDP side by side" },
  { id: "dsl-tables", label: "Reading the neighbour tables" },
  { id: "dsl-aging", label: "Holdtime and ageing" },
  { id: "dsl-med", label: "LLDP-MED and phones" },
  { id: "dsl-config", label: "Configure it" },
  { id: "dsl-security", label: "Where to turn it off" },
  { id: "dsl-incident", label: "The incident and the fix" },
  { id: "dsl-glossary", label: "Glossary" },
];
export const DISC_DEEP_SECTIONS: LessonGuideSectionLink[] = [
  { id: "dsd-tlvs", label: "What's inside an advertisement" },
  { id: "dsd-uses", label: "Beyond documentation" },
  { id: "dsd-myths", label: "Misconceptions" },
  { id: "dsd-explain", label: "Explain it" },
  { id: "dsd-quiz", label: "Check yourself" },
];

/** The lesson's network after LLDP has been enabled: run the model's own steps up to "lldp-enable". */
function stateAfter(stepId: string) {
  let s = createDiscState();
  for (const st of discoverySteps) {
    s = st.run?.(s).state ?? s;
    if (st.id === stepId) break;
  }
  return s;
}

export function DiscLessonGuideContent() {
  const s = stateAfter("lldp-enable");
  return (
    <>
      <GuideSection id="dsl-mission" eyebrow="Mission" title="What this lesson teaches">
        <p>Ask the cable who is on the other end. You will read Cisco&apos;s CDP and the standard LLDP from a real neighbour table, watch an entry age out, provision a phone with LLDP-MED — and undo a security change that took every third-party phone offline.</p>
        <Callout tone="violet" title="CCNA 2.3">Configure and verify Layer 2 discovery protocols (Cisco Discovery Protocol and LLDP).</Callout>
      </GuideSection>
      <GuideSection id="dsl-compare" eyebrow="Compare" title="CDP and LLDP side by side">
        <CompareCards
          items={[
            { title: "CDP", tone: "cyan", tag: "Cisco-proprietary", points: [`Multicast ${MCAST.CDP}`, `Every ${TIMERS.CDP.every} s, holdtime ${TIMERS.CDP.hold} s`, "On by default on Cisco devices", "Cisco phones learn the voice VLAN from it"] },
            { title: "LLDP", tone: "violet", tag: "IEEE 802.1AB", points: [`Multicast ${MCAST.LLDP}, EtherType 0x88CC`, `Every ${TIMERS.LLDP.every} s, TTL ${TIMERS.LLDP.every} × 4 = ${TIMERS.LLDP.hold} s`, "Every vendor; off by default on many Cisco switches", "LLDP-MED provisions any standards-based phone"] },
          ]}
        />
      </GuideSection>
      <GuideSection id="dsl-tables" eyebrow="Verify" title="Reading the neighbour tables">
        <p>Both outputs below come from the lesson&apos;s model, just after LLDP was enabled (t = {s.now} s). CDP can&apos;t see R1; LLDP sees everyone.</p>
        <CliPair cisco={showCdp(s)} junos={showLldp(s)} ciscoCaption="SW1 · CDP" junosCaption="SW1 · LLDP" />
        <CliPanel run={junosLldp(s)} caption="Junos · R1's view of SW1" />
        <p>
          Add <Mono>detail</Mono> (<Mono>show cdp neighbors detail</Mono>, <Mono>show lldp neighbors detail</Mono>) for management addresses and software versions — the fastest way to find the IP of the switch upstairs.
        </p>
      </GuideSection>
      <GuideSection id="dsl-aging" eyebrow="Timers" title="Holdtime and ageing">
        <p>A neighbour isn&apos;t removed when its cable is pulled; it&apos;s removed when its holdtime runs out. Holdtime counts down from each advertisement. R1&apos;s last LLDP frame arrived at t = 30 s, so its entry lasted until t = {30 + TIMERS.LLDP.hold} s.</p>
      </GuideSection>
      <GuideSection id="dsl-med" eyebrow="LLDP-MED" title="LLDP-MED and phones">
        <FieldTable
          title="What SW1 tells PHONE-1"
          columns={["TLV", "Value", "Effect"]}
          rows={[
            ["Network policy · voice VLAN", String(VOICE.vlan), "Phone tags voice frames into VLAN 110"],
            ["L2 priority", `CoS ${VOICE.cos}`, "Switches queue voice first"],
            ["DSCP", `${VOICE.dscp} (EF)`, "Routers queue voice first"],
            ["Power (optional)", "class / watts", "Fine-grained PoE negotiation"],
          ]}
        />
      </GuideSection>
      <GuideSection id="dsl-config" eyebrow="Configure" title="Configure it">
        <CliPair
          cisco={{ prompt: "SW1(config)#", command: "lldp run", output: "cdp run\ninterface GigabitEthernet1/0/5\n switchport access vlan 10\n switchport voice vlan 110\ninterface GigabitEthernet1/0/40\n no cdp enable\n no lldp transmit\n no lldp receive" }}
          junos={{ prompt: "admin@R1# ", command: "set protocols lldp interface all", output: "set protocols lldp interface ge-0/0/3 disable\nset protocols lldp-med interface all" }}
        />
      </GuideSection>
      <GuideSection id="dsl-security" eyebrow="Security" title="Where to turn it off">
        <p>Advertisements reveal model, software, port names and addresses. Turn discovery off per interface on internet edges, guest ports and anything facing a network you don&apos;t manage. Keep it on internal links and phone ports.</p>
      </GuideSection>
      <GuideSection id="dsl-incident" eyebrow="Incident" title="The incident and the fix" tone="danger">
        <p>A hardening script ran <Mono>no lldp run</Mono> globally. Third-party phones, which learn their voice VLAN only from LLDP-MED, came up untagged in data VLAN {VOICE.dataVlan} and couldn&apos;t reach the call server.</p>
        <TroubleshootingFlow
          steps={[
            { question: "Which subnet did the phone get?", look: "Data subnet → it isn't tagging voice." },
            { question: "Is the switch sending LLDP-MED?", look: <><Mono>show lldp</Mono> · <Mono>show lldp neighbors</Mono></> },
            { question: "What changed?", look: "Configuration archive / change log." },
          ]}
        />
        <p>Fix: <Mono>lldp run</Mono> again, with LLDP disabled only on the untrusted ports. Proof: the phone receives voice VLAN {VOICE.vlan} and registers.</p>
      </GuideSection>
      <GuideSection id="dsl-glossary" eyebrow="Words" title="Glossary">
        <Glossary
          items={[
            { term: "CDP", def: "Cisco Discovery Protocol — Cisco-only neighbour advertisements." },
            { term: "LLDP", def: "Link Layer Discovery Protocol, IEEE 802.1AB — the multi-vendor standard." },
            { term: "TLV", def: "Type-length-value: one field in an advertisement." },
            { term: "Holdtime / TTL", def: "How long a neighbour entry lives without a new advertisement." },
            { term: "LLDP-MED", def: "Media Endpoint Discovery extensions: network policy, power, inventory for phones." },
          ]}
        />
      </GuideSection>
    </>
  );
}

const QUIZ: KnowledgeQuestion[] = [
  { id: "dsd-q1", prompt: "SW1 lists SW3 as a CDP neighbour, but SW3 is two switches away. Possible?", options: [{ id: "no", label: "No — CDP is consumed by the directly connected neighbour" }, { id: "yes", label: "Yes — CDP floods through the network" }], correctId: "no", explanation: "Discovery frames are never forwarded. If SW3 appears, it's directly connected — perhaps through a hub or an unmanaged switch that passes the frames through." },
  { id: "dsd-q2", prompt: "Which command shows a neighbour's management IP on a Cisco switch?", options: [{ id: "detail", label: "show cdp neighbors detail" }, { id: "brief", label: "show ip interface brief" }, { id: "mac", label: "show mac address-table" }], correctId: "detail", explanation: "The detail view adds management addresses, software version and native VLAN." },
];

export function DiscDeepDiveContent() {
  return (
    <>
      <GuideSection id="dsd-tlvs" eyebrow="TLVs" title="What's inside an advertisement">
        <FieldTable
          title="Common TLVs"
          columns={["CDP", "LLDP", "Use"]}
          rows={[
            ["Device ID", "Chassis ID / System name", "Who is it"],
            ["Port ID", "Port ID", "Which port on their side"],
            ["Platform / Version", "System description", "Model and software"],
            ["Capabilities", "System capabilities", "Router, switch, phone, AP"],
            ["Address", "Management address", "Where to SSH"],
            ["Native VLAN, Duplex", "802.1 / 802.3 org TLVs", "Spot mismatches (CDP logs them)"],
          ]}
        />
      </GuideSection>
      <GuideSection id="dsd-uses" eyebrow="Uses" title="Beyond documentation">
        <p>Network management systems build topology maps from LLDP. CDP warns of native VLAN and duplex mismatches in the log. Phones, APs and cameras use LLDP-MED or CDP to negotiate VLANs and PoE.</p>
      </GuideSection>
      <GuideSection id="dsd-myths" eyebrow="Misconceptions" title="Misconceptions">
        <Misconceptions
          items={[
            { myth: "Disabling discovery globally is best practice.", correction: "Disable it per interface where neighbours are untrusted. Globally, you lose phone provisioning and your own visibility." },
            { myth: "An entry disappears when the cable is unplugged.", correction: "It stays until the holdtime expires (LLDP 120 s, CDP 180 s by default)." },
          ]}
        />
      </GuideSection>
      <GuideSection id="dsd-explain" eyebrow="Explain" title="Explain it">
        <ExplainIt items={[{ q: "Why did desk PCs keep working when the phones failed?", a: "PCs never relied on discovery: they send untagged into the data VLAN as always. Only phones needed LLDP-MED to learn their voice VLAN." }]} />
      </GuideSection>
      <GuideSection id="dsd-quiz" eyebrow="Quiz" title="Check yourself">
        <KnowledgeQuiz questions={QUIZ} />
      </GuideSection>
    </>
  );
}
