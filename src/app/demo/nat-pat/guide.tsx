import type { BriefingPhaseDef, BriefingStepNote } from "@/components/lesson/briefing";
import { Callout, CompareCards, FieldTable, Glossary, GuideSection, Misconceptions, Mono, TroubleshootingFlow } from "@/components/lesson/GuideBlocks";
import { CliPair, CliPanel } from "@/components/lesson/GuideCli";
import { ExplainIt, KnowledgeQuiz, type KnowledgeQuestion } from "@/components/lesson/GuideInteractive";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { createNatState, natSteps, type NatState } from "@/lib/sim-engine/scenarios/ccna/natPat";
import { showNat } from "./NatPanel";

export const NAT_BRIEFING_PHASES: BriefingPhaseDef[] = [
  { phase: { label: "Vocabulary", tone: "cyan" }, objective: "Name every address NAT touches.", steps: ["intro", "terms"] },
  { phase: { label: "Static and dynamic", tone: "violet" }, objective: "Publish a server; share a small pool.", steps: ["static", "dynamic-cfg", "dyn-pc1", "predict-pool", "dyn-pc3"] },
  { phase: { label: "PAT", tone: "ip" }, objective: "Share one address by port — and bring replies home.", steps: ["pat-cfg", "pat-flows", "predict-return", "return"] },
  { phase: { label: "Incident", tone: "danger" }, objective: "A new floor joins. It can't reach the internet.", steps: ["fault-injected", "inc-noweb"] },
  { phase: { label: "Diagnose", tone: "danger" }, objective: "Diagnosis pending.", steps: ["trouble-question", "diagnostic-layers"] },
  { phase: { label: "Repair pending", tone: "warning" }, objective: "Choose the change that fixes the cause you identified.", steps: ["repair-challenge"] },
  { phase: { label: "Verify", tone: "success" }, objective: "Prove the new floor is translated.", steps: ["verify"] },
  { phase: { label: "Complete", tone: "success" }, objective: "Static, dynamic, PAT and the ACL that chooses.", steps: ["complete"] },
];
export const NAT_BRIEFING_NOTES: Partial<Record<string, BriefingStepNote>> = {
  static: { takeaway: "Static NAT is permanent and works inbound too." },
  "dyn-pc3": { takeaway: "Dynamic NAT is one host per pool address." },
  "pat-flows": { takeaway: "PAT tells flows apart by port — remapping when ports collide." },
  return: { takeaway: "Replies are reversed through the translation table." },
  "fault-injected": { doingNow: "A new inside subnet." },
  "trouble-question": { doingNow: "Diagnosis pending." },
  "repair-challenge": { doingNow: "Choose the change that fixes the cause you identified." },
  verify: { takeaway: "The NAT ACL decides who is translated." },
};

export const NAT_LESSON_SECTIONS: LessonGuideSectionLink[] = [
  { id: "ntl-mission", label: "What this lesson teaches" },
  { id: "ntl-terms", label: "Inside, outside, local, global" },
  { id: "ntl-kinds", label: "Static, dynamic, PAT" },
  { id: "ntl-table", label: "Reading the translation table" },
  { id: "ntl-config", label: "Configure and verify" },
  { id: "ntl-incident", label: "The incident and the fix" },
  { id: "ntl-glossary", label: "Glossary" },
];
export const NAT_DEEP_SECTIONS: LessonGuideSectionLink[] = [
  { id: "ntd-ports", label: "How many flows fit on one address" },
  { id: "ntd-limits", label: "What NAT breaks" },
  { id: "ntd-myths", label: "Misconceptions" },
  { id: "ntd-explain", label: "Explain it" },
  { id: "ntd-quiz", label: "Check yourself" },
];

function stateAt(stepId: string): NatState {
  let s = createNatState();
  for (const st of natSteps) {
    s = st.run?.(s).state ?? s;
    if (st.id === stepId) break;
  }
  return s;
}

export function NatLessonGuideContent() {
  return (
    <>
      <GuideSection id="ntl-mission" eyebrow="Mission" title="What this lesson teaches">
        <p>Translate private addresses at the border: publish a server with static NAT, run out of a dynamic pool, share one address among everyone with PAT, follow replies home — and fix a new subnet that leaves R1 untranslated.</p>
        <Callout tone="violet" title="CCNA 4.1">Configure and verify inside source NAT using static and pools (with PAT).</Callout>
      </GuideSection>
      <GuideSection id="ntl-terms" eyebrow="Terms" title="Inside, outside, local, global">
        <FieldTable
          title="PC1 browsing a website"
          columns={["Name", "Address", "Meaning"]}
          rows={[
            ["Inside local", "10.1.1.10", "PC1's real address"],
            ["Inside global", "203.0.113.2:51000", "PC1 as the internet sees it"],
            ["Outside local", "198.51.100.80", "The website as PC1 sees it"],
            ["Outside global", "198.51.100.80", "The website's real address"],
          ]}
        />
      </GuideSection>
      <GuideSection id="ntl-kinds" eyebrow="Kinds" title="Static, dynamic, PAT">
        <CompareCards
          items={[
            { title: "Static NAT", tone: "cyan", tag: "1 : 1 permanent", points: ["Publishes inside servers", "Works in both directions", "Costs one public address each"] },
            { title: "Dynamic NAT", tone: "violet", tag: "1 : 1 from a pool", points: ["Hosts borrow an address", "Pool runs out", "Rare today"] },
            { title: "PAT (overload)", tone: "success", tag: "many : 1 by port", points: ["Everyone shares one address", "Ports tell flows apart", "What every home router does"] },
          ]}
        />
      </GuideSection>
      <GuideSection id="ntl-table" eyebrow="Table" title="Reading the translation table">
        <CliPanel run={showNat(stateAt("pat-flows"))} caption="R1 after three hosts browse with PAT (from the lesson's model)" />
        <p>PC1 and PC2 both used source port 51000; R1 kept 51000 for PC1 and remapped PC2 to 51001.</p>
      </GuideSection>
      <GuideSection id="ntl-config" eyebrow="Configure" title="Configure and verify">
        <CliPair
          cisco={{ prompt: "R1(config)#", command: "ip nat inside source list 1 interface Gi0/1 overload", output: "access-list 1 permit 10.1.1.0 0.0.0.255\nip nat inside source static 10.1.1.100 203.0.113.5\ninterface Gi0/0\n ip nat inside\ninterface Gi0/1\n ip nat outside\n!\nR1# show ip nat statistics" }}
          junos={{ prompt: "admin@R1# ", command: "set security nat source rule-set OUT rule USERS then source-nat interface", output: "set security nat source rule-set OUT from zone trust to zone untrust\nset security nat source rule-set OUT rule USERS match source-address 10.1.0.0/16\nadmin@R1> show security nat source summary" }}
        />
      </GuideSection>
      <GuideSection id="ntl-incident" eyebrow="Incident" title="The incident and the fix" tone="danger">
        <TroubleshootingFlow
          steps={[
            { question: "Is there a translation for the host?", look: <Mono>show ip nat translations | include 10.1.2.20</Mono> },
            { question: "Are inside/outside roles right?", look: <Mono>show ip nat statistics</Mono> },
            { question: "Does the ACL permit the source?", look: <Mono>show access-lists 1</Mono> },
          ]}
        />
      </GuideSection>
      <GuideSection id="ntl-glossary" eyebrow="Words" title="Glossary">
        <Glossary
          items={[
            { term: "NAT", def: "Network address translation: rewriting IP addresses at a border." },
            { term: "PAT / overload", def: "Many inside hosts sharing one inside global address, told apart by port." },
            { term: "Inside local / global", def: "A host's real address / its translated address." },
            { term: "NAT ACL", def: "The access list that selects which sources are translated." },
          ]}
        />
      </GuideSection>
    </>
  );
}

const QUIZ: KnowledgeQuestion[] = [
  { id: "ntd-q1", prompt: "Which NAT type lets internet users start connections to an inside server?", options: [{ id: "st", label: "Static NAT (or a static port forward)" }, { id: "pat", label: "PAT overload" }, { id: "dyn", label: "Dynamic NAT" }], correctId: "st", explanation: "Only a permanent mapping exists before the first packet arrives from outside." },
  { id: "ntd-q2", prompt: "A host's packets leave R1 with source 10.1.2.20. What's the most likely cause?", options: [{ id: "acl", label: "The NAT ACL doesn't permit the host's subnet" }, { id: "dns", label: "DNS" }, { id: "mtu", label: "MTU" }], correctId: "acl", explanation: "Unpermitted sources are forwarded untranslated." },
];

export function NatDeepDiveContent() {
  return (
    <>
      <GuideSection id="ntd-ports" eyebrow="Scale" title="How many flows fit on one address">
        <p>About 64,000 ports per protocol per inside global address. Busy sites add addresses to a PAT pool; carriers run CGNAT with port blocks per customer.</p>
      </GuideSection>
      <GuideSection id="ntd-limits" eyebrow="Limits" title="What NAT breaks">
        <p>Protocols that embed addresses in the payload (FTP active mode, SIP) need helpers (ALGs); IPsec needs NAT traversal (UDP 4500); end-to-end reachability is lost — one reason IPv6 avoids NAT.</p>
      </GuideSection>
      <GuideSection id="ntd-myths" eyebrow="Misconceptions" title="Misconceptions">
        <Misconceptions items={[{ myth: "NAT is a firewall.", correction: "It hides addresses as a side effect; a stateful firewall enforces policy." }, { myth: "The ACL in NAT filters traffic.", correction: "It only selects what is translated; unpermitted traffic is forwarded untranslated." }]} />
      </GuideSection>
      <GuideSection id="ntd-explain" eyebrow="Explain" title="Explain it">
        <ExplainIt items={[{ q: "Why could PC3 get online with PAT but not with the pool?", a: "PAT multiplexes flows on ports of one address; the dynamic pool gives each host a whole address and had only two." }]} />
      </GuideSection>
      <GuideSection id="ntd-quiz" eyebrow="Quiz" title="Check yourself">
        <KnowledgeQuiz questions={QUIZ} />
      </GuideSection>
    </>
  );
}
