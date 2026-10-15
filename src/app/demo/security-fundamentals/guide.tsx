import type { BriefingPhaseDef, BriefingStepNote } from "@/components/lesson/briefing";
import { Callout, CompareCards, FieldTable, Glossary, GuideSection, Misconceptions, TroubleshootingFlow } from "@/components/lesson/GuideBlocks";
import { ExplainIt, KnowledgeQuiz, type KnowledgeQuestion } from "@/components/lesson/GuideInteractive";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { FLOOD, PHISH, SCAN, backlogFillMs, phishYield, scanRate } from "@/lib/sim-engine/scenarios/ccna/securityConcepts";

export const SEC_BRIEFING_PHASES: BriefingPhaseDef[] = [
  { phase: { label: "Vocabulary", tone: "cyan" }, objective: "Name the parts of every security problem.", steps: ["intro"] },
  { phase: { label: "Network attacks", tone: "danger" }, objective: "Reconnaissance, denial of service and interception.", steps: ["recon", "predict-dos", "dos", "mitm"] },
  { phase: { label: "People", tone: "violet" }, objective: "Phishing — and the control that stops a stolen password.", steps: ["phish", "vpn-stolen", "mfa", "program"] },
  { phase: { label: "Incident", tone: "danger" }, objective: "A visitor in a meeting room.", steps: ["fault-injected", "inc-scan"] },
  { phase: { label: "Diagnose", tone: "danger" }, objective: "Diagnosis pending.", steps: ["trouble-question", "diagnostic-layers"] },
  { phase: { label: "Repair pending", tone: "warning" }, objective: "Choose the change that fixes the cause you identified.", steps: ["repair-challenge"] },
  { phase: { label: "Verify", tone: "success" }, objective: "Prove the door is closed.", steps: ["verify"] },
  { phase: { label: "Complete", tone: "success" }, objective: "Threats, mitigations and a whole program.", steps: ["complete"] },
];
export const SEC_BRIEFING_NOTES: Partial<Record<string, BriefingStepNote>> = {
  recon: { takeaway: "Reconnaissance first: attackers map what's open." },
  dos: { takeaway: "DoS exhausts a resource; spoofing defeats address blocking." },
  phish: { takeaway: "Social engineering attacks people, not packets." },
  mfa: { takeaway: "MFA makes a stolen password useless on its own." },
  program: { takeaway: "Awareness, training and physical access are controls too." },
  "fault-injected": { doingNow: "Someone walks in." },
  "trouble-question": { doingNow: "Diagnosis pending." },
  "repair-challenge": { doingNow: "Choose the change that fixes the cause you identified." },
  verify: { takeaway: "Defence in depth: physical, port, admission, monitoring." },
};

export const SEC_LESSON_SECTIONS: LessonGuideSectionLink[] = [
  { id: "scl-mission", label: "What this lesson teaches" },
  { id: "scl-terms", label: "Vulnerability, threat, exploit, mitigation" },
  { id: "scl-attacks", label: "Common attacks, computed" },
  { id: "scl-program", label: "A security program" },
  { id: "scl-incident", label: "The incident and the fix" },
  { id: "scl-glossary", label: "Glossary" },
];
export const SEC_DEEP_SECTIONS: LessonGuideSectionLink[] = [
  { id: "scd-cia", label: "Confidentiality, integrity, availability" },
  { id: "scd-depth", label: "Defence in depth" },
  { id: "scd-myths", label: "Misconceptions" },
  { id: "scd-explain", label: "Explain it" },
  { id: "scd-quiz", label: "Check yourself" },
];

export function SecLessonGuideContent() {
  return (
    <>
      <GuideSection id="scl-mission" eyebrow="Mission" title="What this lesson teaches">
        <p>Speak the language of security, watch the attacks the CCNA expects you to recognise — computed, not narrated — and see why a security program is people and buildings as much as firewalls.</p>
        <Callout tone="violet" title="CCNA 5.1 · 5.2">Key security concepts (threats, vulnerabilities, exploits, mitigation techniques) and security program elements (user awareness, training, physical access control).</Callout>
      </GuideSection>
      <GuideSection id="scl-terms" eyebrow="Terms" title="Vulnerability, threat, exploit, mitigation">
        <FieldTable
          title="Using the lesson's VPN gateway"
          columns={["Term", "Example"]}
          rows={[
            ["Asset", "The VPN gateway and the network behind it"],
            ["Vulnerability", "An unpatched firmware flaw; a password-only login"],
            ["Threat", "Criminals scanning for that flaw; a phishing campaign"],
            ["Exploit", "The code or trick that uses the weakness"],
            ["Mitigation", "Patching; MFA; training"],
          ]}
        />
      </GuideSection>
      <GuideSection id="scl-attacks" eyebrow="Attacks" title="Common attacks, computed">
        <FieldTable
          title="From the lesson's model"
          columns={["Attack", "Numbers", "Mitigation"]}
          rows={[
            ["Port scan (reconnaissance)", `${SCAN.ports} ports / ${SCAN.seconds} s = ${scanRate()}/s > IPS threshold ${SCAN.ipsThreshold}/s`, "IPS rate detection, minimal open ports"],
            ["SYN flood (DoS/DDoS)", `${FLOOD.backlog} backlog / ${FLOOD.synPerSec.toLocaleString()} SYN/s = full in ${backlogFillMs()} ms`, "SYN cookies, rate limits, upstream scrubbing"],
            ["Spoofing", `${FLOOD.distinctSources.toLocaleString()} forged sources`, "Ingress filtering (uRPF), not per-address blocking"],
            ["Phishing", `${PHISH.users} × ${PHISH.clickBefore} × ${PHISH.submit} ≈ ${phishYield(PHISH.clickBefore)} passwords`, "Awareness training, MFA, mail filtering"],
            ["Man-in-the-middle", "rogue AP, ARP spoofing", "Encryption, DHCP snooping, DAI"],
            ["Malware / ransomware", "—", "Patching, endpoint protection, backups"],
          ]}
        />
      </GuideSection>
      <GuideSection id="scl-program" eyebrow="Program" title="A security program">
        <CompareCards
          items={[
            { title: "User awareness", tone: "cyan", tag: "everyone", points: ["Recognise phishing", "Report, don't click", `Drills: ${PHISH.clickBefore * 100}% → ${PHISH.clickAfter * 100}% click rate`] },
            { title: "Training", tone: "violet", tag: "staff with privileges", points: ["Admins: secure configuration", "Incident response roles"] },
            { title: "Physical access control", tone: "warning", tag: "buildings", points: ["Badges, mantraps, no tailgating", "Locked wiring closets", "Escorted visitors"] },
          ]}
        />
      </GuideSection>
      <GuideSection id="scl-incident" eyebrow="Incident" title="The incident and the fix" tone="danger">
        <TroubleshootingFlow
          steps={[
            { question: "Where did the traffic come from?", look: "Inside — the firewall never saw it." },
            { question: "Which port?", look: "Switch MAC table → ACC-SW Gi1/0/30." },
            { question: "Should that port be live?", look: "Unused meeting-room jack: no." },
          ]}
        />
      </GuideSection>
      <GuideSection id="scl-glossary" eyebrow="Words" title="Glossary">
        <Glossary
          items={[
            { term: "DoS / DDoS", def: "Denial of service from one / many sources." },
            { term: "Spoofing", def: "Forging an address or identity." },
            { term: "Phishing", def: "Deceptive messages that trick people into revealing credentials or running malware." },
            { term: "MFA", def: "Multi-factor authentication: two or more of know / have / are." },
            { term: "Tailgating", def: "Following someone through a controlled door." },
          ]}
        />
      </GuideSection>
    </>
  );
}

const QUIZ: KnowledgeQuestion[] = [
  { id: "scd-q1", prompt: "An attacker calls the help desk pretending to be a manager and asks for a password reset. What is this?", options: [{ id: "se", label: "Social engineering (vishing)" }, { id: "dos", label: "Denial of service" }, { id: "mitm", label: "Man-in-the-middle" }], correctId: "se", explanation: "Manipulating people by phone is social engineering. Mitigation: verification procedures and training." },
  { id: "scd-q2", prompt: "Which is a mitigation, not a vulnerability?", options: [{ id: "patch", label: "Applying the vendor's firmware patch" }, { id: "default", label: "A default admin password" }, { id: "open", label: "An open, unused switch port" }], correctId: "patch", explanation: "Patching removes the weakness; the other two are weaknesses." },
];

export function SecDeepDiveContent() {
  return (
    <>
      <GuideSection id="scd-cia" eyebrow="CIA" title="Confidentiality, integrity, availability">
        <p>Phishing and MITM attack confidentiality; tampering attacks integrity; DoS attacks availability. Every control protects one or more of the three.</p>
      </GuideSection>
      <GuideSection id="scd-depth" eyebrow="Depth" title="Defence in depth">
        <p>No single control is enough: the visitor bypassed the firewall entirely. Layers — physical, port, admission (802.1X), segmentation (VLANs, ACLs), monitoring, endpoint — mean one failure isn&apos;t a breach.</p>
      </GuideSection>
      <GuideSection id="scd-myths" eyebrow="Misconceptions" title="Misconceptions">
        <Misconceptions items={[{ myth: "The firewall protects the inside.", correction: "Only from what crosses it. Inside threats and plugged-in devices never do." }, { myth: "Strong passwords stop phishing.", correction: "A phished strong password works just as well for the attacker; MFA is what helps." }]} />
      </GuideSection>
      <GuideSection id="scd-explain" eyebrow="Explain" title="Explain it">
        <ExplainIt items={[{ q: "Why didn't blocking the scanner's address work against the SYN flood?", a: "The flood came from tens of thousands of forged source addresses; there was no single address to block." }]} />
      </GuideSection>
      <GuideSection id="scd-quiz" eyebrow="Quiz" title="Check yourself">
        <KnowledgeQuiz questions={QUIZ} />
      </GuideSection>
    </>
  );
}
