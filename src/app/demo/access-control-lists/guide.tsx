import type { BriefingPhaseDef, BriefingStepNote } from "@/components/lesson/briefing";
import { Callout, CompareCards, FieldTable, Glossary, GuideSection, Misconceptions, Mono, TroubleshootingFlow } from "@/components/lesson/GuideBlocks";
import { CliPair, CliPanel } from "@/components/lesson/GuideCli";
import { ExplainIt, KnowledgeQuiz, type KnowledgeQuestion } from "@/components/lesson/GuideInteractive";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { FLOWS, GUEST_IN, aceText, aclSteps, createAclState, evaluate, wcMatch, wildcardOf, wildcardRows, type AclState } from "@/lib/sim-engine/scenarios/ccna/acl";
import { showAcl } from "./AclPanel";

export const ACL_BRIEFING_PHASES: BriefingPhaseDef[] = [
  { phase: { label: "Rules of the list", tone: "cyan" }, objective: "Top-down, first match, implicit deny — and wildcards.", steps: ["intro", "predict-wildcard", "wildcard"] },
  { phase: { label: "Standard", tone: "violet" }, objective: "Match by source only — and why that's too blunt here.", steps: ["policy", "standard", "std-web", "std-limit"] },
  { phase: { label: "Extended", tone: "ip" }, objective: "Source, destination and port — placed near the source.", steps: ["predict-placement", "extended", "ext-web", "ext-db", "ext-net", "ext-staff", "predict-order", "named"] },
  { phase: { label: "Incident", tone: "danger" }, objective: "A new service that guests can't reach.", steps: ["fault-injected", "inc-portal"] },
  { phase: { label: "Diagnose", tone: "danger" }, objective: "Diagnosis pending.", steps: ["trouble-question", "diagnostic-layers"] },
  { phase: { label: "Repair pending", tone: "warning" }, objective: "Choose the change that fixes the cause you identified.", steps: ["repair-challenge"] },
  { phase: { label: "Verify", tone: "success" }, objective: "Prove the portal works and the database is still protected.", steps: ["verify"] },
  { phase: { label: "Complete", tone: "success" }, objective: "Wildcards, order, placement and counters.", steps: ["complete"] },
];
export const ACL_BRIEFING_NOTES: Partial<Record<string, BriefingStepNote>> = {
  wildcard: { takeaway: "Wildcard = inverse mask: 0 checks a bit, 1 ignores it." },
  "std-limit": { takeaway: "Standard ACLs see only the source address." },
  extended: { takeaway: "Extended ACLs go close to the source." },
  "ext-db": { takeaway: "The first matching line decides." },
  "ext-staff": { takeaway: "An ACL only filters where it is applied." },
  named: { takeaway: "Sequence numbers let you insert a line exactly where it belongs." },
  "fault-injected": { doingNow: "A change goes in." },
  "trouble-question": { doingNow: "Diagnosis pending." },
  "repair-challenge": { doingNow: "Choose the change that fixes the cause you identified." },
  verify: { takeaway: "Specific permits above general denies; counters prove it." },
};

export const ACL_LESSON_SECTIONS: LessonGuideSectionLink[] = [
  { id: "acl-mission", label: "What this lesson teaches" },
  { id: "acl-rules", label: "The three rules" },
  { id: "acl-wildcards", label: "Wildcard masks" },
  { id: "acl-types", label: "Standard vs extended" },
  { id: "acl-guest", label: "GUEST-IN, line by line" },
  { id: "acl-config", label: "Configure and verify" },
  { id: "acl-incident", label: "The incident and the fix" },
  { id: "acl-glossary", label: "Glossary" },
];
export const ACL_DEEP_SECTIONS: LessonGuideSectionLink[] = [
  { id: "acld-where", label: "Where ACLs are used" },
  { id: "acld-vendors", label: "Other vendors" },
  { id: "acld-myths", label: "Misconceptions" },
  { id: "acld-explain", label: "Explain it" },
  { id: "acld-quiz", label: "Check yourself" },
];

function stateAt(stepId: string): AclState {
  let s = createAclState();
  for (const st of aclSteps) {
    s = st.run?.(s).state ?? s;
    if (st.id === stepId) break;
  }
  return s;
}

export function AclLessonGuideContent() {
  return (
    <>
      <GuideSection id="acl-mission" eyebrow="Mission" title="What this lesson teaches">
        <p>Turn a security rule into an ACL that does exactly what it says: choose the right type, write the lines in the right order with the right wildcards, apply it in the right place — and prove it with hit counters.</p>
        <Callout tone="violet" title="CCNA 5.6">Configure and verify access control lists.</Callout>
      </GuideSection>
      <GuideSection id="acl-rules" eyebrow="Rules" title="The three rules">
        <CompareCards
          items={[
            { title: "Top-down", tone: "cyan", tag: "order", points: ["Lines are checked in sequence order", "Put specific lines above general ones"] },
            { title: "First match", tone: "violet", tag: "decides", points: ["The first matching line permits or denies", "Later lines are never read for that packet"] },
            { title: "Implicit deny", tone: "danger", tag: "the end", points: ["Every ACL ends with an invisible deny any", "No match → dropped"] },
          ]}
        />
      </GuideSection>
      <GuideSection id="acl-wildcards" eyebrow="Wildcards" title="Wildcard masks">
        <FieldTable title="Wildcard = 255.255.255.255 − subnet mask (computed)" columns={["Prefix", "Wildcard"]} rows={wildcardRows().map((r) => [r.prefix, r.wildcard])} />
        <p>
          10.1.10.64 {wildcardOf(26)} matches 10.1.10.70 ({wcMatch("10.1.10.70", "10.1.10.64", wildcardOf(26)) ? "yes" : "no"}) but not 10.1.10.130 ({wcMatch("10.1.10.130", "10.1.10.64", wildcardOf(26)) ? "yes" : "no"}). Shorthands: <Mono>host 10.1.50.10</Mono> = wildcard 0.0.0.0; <Mono>any</Mono> = 0.0.0.0 255.255.255.255.
        </p>
      </GuideSection>
      <GuideSection id="acl-types" eyebrow="Types" title="Standard vs extended">
        <FieldTable
          title="Choosing and placing"
          columns={["", "Standard (1–99, 1300–1999)", "Extended (100–199, 2000–2699)"]}
          rows={[
            ["Matches", "Source address only", "Protocol, source, destination, ports"],
            ["Place it", "Near the destination", "Near the source"],
            ["Why", "Near the source it would block the host from everything", "Drops unwanted traffic before it crosses the network"],
          ]}
        />
      </GuideSection>
      <GuideSection id="acl-guest" eyebrow="Walkthrough" title="GUEST-IN, line by line">
        <FieldTable
          title="Each test flow, evaluated by the lesson's model"
          columns={["Flow", "First matching line", "Result"]}
          rows={(["guestWeb", "guestDb", "guestNet"] as const).map((k) => {
            const v = evaluate(GUEST_IN, FLOWS[k]);
            return [FLOWS[k].label, v.seq === "implicit" ? "implicit deny" : aceText(GUEST_IN.aces.find((e) => e.seq === v.seq)!), v.action];
          })}
        />
        <CliPanel run={showAcl(stateAt("ext-net"))} caption="R1 after the three guest flows (from the lesson's model)" />
      </GuideSection>
      <GuideSection id="acl-config" eyebrow="Configure" title="Configure and verify">
        <CliPair
          cisco={{ prompt: "R1(config)#", command: "ip access-list extended GUEST-IN", output: " 10 permit tcp 10.1.20.0 0.0.0.255 host 10.1.50.10 eq 443\n 20 deny ip 10.1.20.0 0.0.0.255 10.1.50.0 0.0.0.255\n 30 permit ip 10.1.20.0 0.0.0.255 any\ninterface Gi0/1\n ip access-group GUEST-IN in\n!\nR1# show access-lists GUEST-IN\nR1# show ip interface Gi0/1 | include access list" }}
          junos={{ prompt: "admin@R1# ", command: "edit firewall family inet filter GUEST-IN", output: "set term WEB from source-address 10.1.20.0/24\nset term WEB from destination-address 10.1.50.10/32\nset term WEB from protocol tcp destination-port 443\nset term WEB then accept\nset term SERVERS from destination-address 10.1.50.0/24\nset term SERVERS then discard\nset term REST then accept\nset interfaces ge-0/0/1 unit 0 family inet filter input GUEST-IN" }}
        />
      </GuideSection>
      <GuideSection id="acl-incident" eyebrow="Incident" title="The incident and the fix" tone="danger">
        <TroubleshootingFlow
          steps={[
            { question: "Is the ACL applied where you think?", look: <Mono>show ip interface Gi0/1</Mono> },
            { question: "Which line matches first?", look: <Mono>show access-lists GUEST-IN</Mono> },
            { question: "Do the counters agree?", look: "Line 20 rising, line 40 at zero: line 40 is shadowed." },
          ]}
        />
        <CliPanel run={showAcl(stateAt("inc-portal"))} caption="R1 during the incident" />
        <p>
          Fix: <Mono>ip access-list extended GUEST-IN</Mono> → <Mono>15 permit tcp 10.1.20.0 0.0.0.255 host 10.1.50.30 eq 443</Mono> → <Mono>no 40</Mono>.
        </p>
      </GuideSection>
      <GuideSection id="acl-glossary" eyebrow="Words" title="Glossary">
        <Glossary
          items={[
            { term: "ACE", def: "Access control entry — one line of an ACL." },
            { term: "Wildcard mask", def: "0 bits must match, 1 bits are ignored." },
            { term: "Implicit deny", def: "The unseen last line that drops anything unmatched." },
            { term: "Shadowed line", def: "A line that can never match because an earlier line always matches first." },
            { term: "access-group", def: "Applies an ACL to an interface in one direction." },
          ]}
        />
      </GuideSection>
    </>
  );
}

const QUIZ: KnowledgeQuestion[] = [
  { id: "acld-q1", prompt: "An ACL has one line: 'deny ip host 10.1.1.5 any'. It is applied inbound. What does it do to traffic from 10.1.1.6?", options: [{ id: "drop", label: "Drops it — the implicit deny" }, { id: "pass", label: "Permits it — it wasn't denied" }, { id: "log", label: "Logs it" }], correctId: "drop", explanation: "Nothing matches 10.1.1.6, so the implicit deny drops it. A deny-only ACL blocks everything." },
  { id: "acld-q2", prompt: "Which wildcard matches 172.16.0.0/20?", options: [{ id: "a", label: "0.0.15.255" }, { id: "b", label: "0.0.240.0" }, { id: "c", label: "255.255.240.0" }], correctId: "a", explanation: "A /20 mask is 255.255.240.0; its inverse is 0.0.15.255." },
  { id: "acld-q3", prompt: "How many ACLs can be applied inbound on one interface for IPv4?", options: [{ id: "one", label: "One" }, { id: "two", label: "Two" }, { id: "any", label: "As many as you like" }], correctId: "one", explanation: "One per interface, per direction, per protocol. Applying a second replaces the first." },
];

export function AclDeepDiveContent() {
  return (
    <>
      <GuideSection id="acld-where" eyebrow="Uses" title="Where ACLs are used">
        <p>Filtering traffic on interfaces is only one job. The same lists select traffic for NAT (which sources get translated), protect the device itself (access-class on the VTY lines), choose what QoS classifies, and what a route-map matches.</p>
      </GuideSection>
      <GuideSection id="acld-vendors" eyebrow="Vendors" title="Other vendors">
        <p>Junos calls them firewall filters: named terms with from/then, prefixes instead of wildcards, and an implicit discard at the end. Arista EOS and NX-OS use Cisco-like syntax with prefix notation. The rules — order, first match, default deny — are the same everywhere.</p>
      </GuideSection>
      <GuideSection id="acld-myths" eyebrow="Misconceptions" title="Misconceptions">
        <Misconceptions
          items={[
            { myth: "The most specific line wins.", correction: "The first matching line wins. Specificity matters only through order." },
            { myth: "Wildcard masks are subnet masks written differently.", correction: "They are inverses: 0 means 'must match'." },
            { myth: "Adding a line puts it where it is needed.", correction: "Without a sequence number it goes at the end — possibly below a deny that shadows it." },
          ]}
        />
      </GuideSection>
      <GuideSection id="acld-explain" eyebrow="Explain" title="Explain it">
        <ExplainIt items={[{ q: "Why did the staff PC reach the database while GUEST-IN denied the server LAN?", a: "GUEST-IN is applied inbound on Gi0/1, the guest interface. Staff traffic enters on Gi0/0, where no ACL is applied." }]} />
      </GuideSection>
      <GuideSection id="acld-quiz" eyebrow="Quiz" title="Check yourself">
        <KnowledgeQuiz questions={QUIZ} />
      </GuideSection>
    </>
  );
}
