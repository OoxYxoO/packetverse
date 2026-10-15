import type { BriefingPhaseDef, BriefingStepNote } from "@/components/lesson/briefing";
import { Callout, CompareCards, FieldTable, Glossary, GuideSection, Misconceptions, Mono, TroubleshootingFlow } from "@/components/lesson/GuideBlocks";
import { CliPair } from "@/components/lesson/GuideCli";
import { ExplainIt, KnowledgeQuiz, type KnowledgeQuestion } from "@/components/lesson/GuideInteractive";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { CANDIDATES, FLEET, STORAGE, entropyBits, localAccounts } from "@/lib/sim-engine/scenarios/ccna/deviceAccess";

export const AAA_BRIEFING_PHASES: BriefingPhaseDef[] = [
  { phase: { label: "Three questions", tone: "cyan" }, objective: "Authentication, authorization, accounting.", steps: ["intro"] },
  { phase: { label: "Passwords", tone: "violet" }, objective: "How they are stored and how strong they are.", steps: ["predict-storage", "storage", "predict-strength", "strength", "policy"] },
  { phase: { label: "Central AAA", tone: "ip" }, objective: "One server, a method list, and the rule that orders it.", steps: ["local", "aaa", "predict-reject", "reject", "predict-error", "error"] },
  { phase: { label: "Authorize & account", tone: "cyan" }, objective: "Per-command control, a record of everything, and RADIUS.", steps: ["authz", "accounting", "radius"] },
  { phase: { label: "Incident", tone: "danger" }, objective: "A login that shouldn't have worked.", steps: ["fault-injected", "inc-login"] },
  { phase: { label: "Diagnose", tone: "danger" }, objective: "Diagnosis pending.", steps: ["trouble-question", "diagnostic-layers"] },
  { phase: { label: "Repair pending", tone: "warning" }, objective: "Choose the change that fixes the cause you identified.", steps: ["repair-challenge"] },
  { phase: { label: "Verify", tone: "success" }, objective: "Prove the disabled account is refused.", steps: ["verify"] },
  { phase: { label: "Complete", tone: "success" }, objective: "Secrets, strength, method lists and AAA.", steps: ["complete"] },
];
export const AAA_BRIEFING_NOTES: Partial<Record<string, BriefingStepNote>> = {
  storage: { takeaway: "Only 'secret' stores a one-way hash; type 7 is reversible." },
  strength: { takeaway: "For random passwords, length beats complexity." },
  policy: { takeaway: "Policy plus alternatives: MFA, certificates, biometrics." },
  local: { takeaway: "Local accounts multiply with every device." },
  aaa: { takeaway: "Ask the server first; keep one local account for outages." },
  reject: { takeaway: "REJECT is final." },
  error: { takeaway: "Only ERROR (no answer) moves down the list." },
  authz: { takeaway: "TACACS+ authorises each command." },
  accounting: { takeaway: "Accounting records who did what, where, when." },
  "fault-injected": { doingNow: "Something was allowed that shouldn't have been." },
  "trouble-question": { doingNow: "Diagnosis pending." },
  "repair-challenge": { doingNow: "Choose the change that fixes the cause you identified." },
  verify: { takeaway: "Server first, one break-glass account, no stale local users." },
};

export const AAA_LESSON_SECTIONS: LessonGuideSectionLink[] = [
  { id: "aal-mission", label: "What this lesson teaches" },
  { id: "aal-storage", label: "How passwords are stored" },
  { id: "aal-strength", label: "Password strength and policy" },
  { id: "aal-lists", label: "Method lists: the one rule" },
  { id: "aal-protocols", label: "TACACS+ vs RADIUS" },
  { id: "aal-config", label: "Configure and verify" },
  { id: "aal-incident", label: "The incident and the fix" },
  { id: "aal-glossary", label: "Glossary" },
];
export const AAA_DEEP_SECTIONS: LessonGuideSectionLink[] = [
  { id: "aad-lines", label: "Console, VTY and privilege levels" },
  { id: "aad-vendors", label: "Other vendors" },
  { id: "aad-myths", label: "Misconceptions" },
  { id: "aad-explain", label: "Explain it" },
  { id: "aad-quiz", label: "Check yourself" },
];

export function AaaLessonGuideContent() {
  return (
    <>
      <GuideSection id="aal-mission" eyebrow="Mission" title="What this lesson teaches">
        <p>Protect the devices themselves: store passwords so a leaked configuration gives nothing away, choose passwords that resist guessing, and move logins to a central AAA server — with a method list ordered so that an outage doesn&apos;t lock you out and a departed employee can&apos;t get in.</p>
        <Callout tone="violet" title="CCNA 5.3 · 5.4 · 5.8">Device access control with local passwords; password policy elements (management, complexity, alternatives such as MFA, certificates and biometrics); authentication, authorization and accounting compared.</Callout>
      </GuideSection>
      <GuideSection id="aal-storage" eyebrow="Storage" title="How passwords are stored">
        <FieldTable title="What the configuration holds" columns={["Command", "Stored as", "Verdict"]} rows={STORAGE.map((f) => [f.command, f.type, `${f.safe ? "Use" : "Avoid"} — ${f.note}`])} />
        <Callout tone="warning" title="Type 7 is not encryption">service password-encryption only stops someone glancing at a screen. Treat any configuration containing type 0 or type 7 passwords as containing the passwords themselves.</Callout>
      </GuideSection>
      <GuideSection id="aal-strength" eyebrow="Strength" title="Password strength and policy">
        <FieldTable
          title="Bits of entropy = length × log2(alphabet) — random passwords only"
          columns={["Candidate", "Length × alphabet", "Strength"]}
          rows={CANDIDATES.map((c) => [c.label, c.random ? `${c.length} × log2(${c.alphabet.toLocaleString()})` : "pattern", c.random ? `${entropyBits(c)} bits` : "weak: guessing lists try patterns first"])}
        />
        <CompareCards
          items={[
            { title: "Policy", tone: "cyan", tag: "management", points: ["Minimum length (length beats complexity)", "No reuse; block known-breached passwords", "Lockout or delay after repeated failures"] },
            { title: "MFA", tone: "violet", tag: "alternative", points: ["Know + have (an app or token)", "A stolen password alone fails"] },
            { title: "Certificates & biometrics", tone: "success", tag: "alternative", points: ["Certificates: a private key proves identity (802.1X, SSH keys)", "Biometrics: something you are — usually unlocks a key locally"] },
          ]}
        />
      </GuideSection>
      <GuideSection id="aal-lists" eyebrow="Method lists" title="Method lists: the one rule">
        <p>A method list is tried top to bottom. <strong>Only an ERROR — no answer — moves to the next method.</strong> An ACCEPT or a REJECT from any method is final.</p>
        <FieldTable
          title="From the lesson's model"
          columns={["List", "Situation", "Result"]}
          rows={[
            ["group tacacs+ local", "server up, right password", "TACACS+ ACCEPT"],
            ["group tacacs+ local", "server up, wrong password", "TACACS+ REJECT — local never tried"],
            ["group tacacs+ local", "server unreachable", "TACACS+ ERROR → local ACCEPT (break-glass)"],
            ["local group tacacs+", "stale local account exists", "local ACCEPT — the server is never asked"],
          ]}
        />
        <p>
          With {FLEET.admins} admins and {FLEET.switches} switches, local accounts alone mean {localAccounts()} accounts to keep in step. Central AAA means one account per person, disabled once.
        </p>
      </GuideSection>
      <GuideSection id="aal-protocols" eyebrow="Protocols" title="TACACS+ vs RADIUS">
        <CompareCards
          items={[
            { title: "TACACS+", tone: "cyan", tag: "device administration", points: ["TCP 49", "Whole body encrypted", "Authentication, authorization and accounting separate", "Per-command authorization", "Cisco-originated, widely supported"] },
            { title: "RADIUS", tone: "violet", tag: "network access", points: ["UDP 1812 (auth) / 1813 (accounting)", "Only the password is hidden", "Authentication and authorization combined", "IETF standard: 802.1X, Wi-Fi, VPN users"] },
          ]}
        />
      </GuideSection>
      <GuideSection id="aal-config" eyebrow="Configure" title="Configure and verify">
        <CliPair
          cisco={{ prompt: "SW1(config)#", command: "aaa new-model", output: "username alice privilege 15 algorithm-type scrypt secret ********\ntacacs server ISE1\n address ipv4 10.9.0.5\n key ********\naaa authentication login default group tacacs+ local\naaa authorization commands 15 default group tacacs+ local\naaa accounting commands 15 default start-stop group tacacs+\nline vty 0 15\n transport input ssh\n!\nSW1# test aaa group tacacs+ alice ******** legacy" }}
          junos={{ prompt: "admin@SW1# ", command: "set system authentication-order [ tacplus password ]", output: "set system tacplus-server 10.9.0.5 secret \"********\"\nset system login user alice class super-user\nset system accounting events [ login interactive-commands ]\nset system accounting destination tacplus\nadmin@SW1> show system users" }}
        />
      </GuideSection>
      <GuideSection id="aal-incident" eyebrow="Incident" title="The incident and the fix" tone="danger">
        <TroubleshootingFlow
          steps={[
            { question: "Did the server see the request?", look: "Its logs: no request for mark from SW2." },
            { question: "What order does SW2 use?", look: <Mono>show running-config | include aaa authentication</Mono> },
            { question: "Which local users exist?", look: <Mono>show running-config | include username</Mono> },
          ]}
        />
        <p>Fix: server first (group tacacs+ local), and keep exactly one break-glass local account, stored as a secret and kept offline.</p>
      </GuideSection>
      <GuideSection id="aal-glossary" eyebrow="Words" title="Glossary">
        <Glossary
          items={[
            { term: "AAA", def: "Authentication, authorization, accounting." },
            { term: "Method list", def: "The ordered list of places a device asks; only an ERROR moves to the next." },
            { term: "Break-glass account", def: "One local account used only when the AAA server can't be reached." },
            { term: "Type 8 / type 9", def: "PBKDF2 / scrypt password hashes — slow by design." },
            { term: "TACACS+", def: "TCP 49 AAA protocol for device administration; encrypts the whole body." },
            { term: "RADIUS", def: "UDP 1812/1813 AAA protocol for network access (802.1X, VPN)." },
          ]}
        />
      </GuideSection>
    </>
  );
}

const QUIZ: KnowledgeQuestion[] = [
  { id: "aad-q1", prompt: "A router's list is 'group radius local'. The RADIUS server answers 'Access-Reject'. What does a Cisco router do?", options: [{ id: "deny", label: "Denies the login" }, { id: "local", label: "Tries the local database" }, { id: "retry", label: "Retries RADIUS forever" }], correctId: "deny", explanation: "A reject is final on IOS; only an error (no answer) moves to local." },
  { id: "aad-q2", prompt: "Which protocol would you choose to authorise each command an administrator types?", options: [{ id: "tac", label: "TACACS+" }, { id: "rad", label: "RADIUS" }, { id: "snmp", label: "SNMP" }], correctId: "tac", explanation: "TACACS+ separates authorization and can check every command; RADIUS returns authorization once, with the accept." },
  { id: "aad-q3", prompt: "Which line protects the privileged-mode password best?", options: [{ id: "s9", label: "enable algorithm-type scrypt secret …" }, { id: "p7", label: "enable password … with service password-encryption" }, { id: "p0", label: "enable password …" }], correctId: "s9", explanation: "Type 9 is a slow one-way hash. Type 7 is reversible; type 0 is clear text." },
];

export function AaaDeepDiveContent() {
  return (
    <>
      <GuideSection id="aad-lines" eyebrow="Lines" title="Console, VTY and privilege levels">
        <FieldTable
          title="Where logins arrive on a Cisco device"
          columns={["Line", "What it is", "Harden with"]}
          rows={[
            ["line console 0", "The physical console port", "login local (or AAA), exec-timeout"],
            ["line vty 0 15", "Remote sessions", "transport input ssh, login local or AAA, an access-class ACL"],
            ["privilege 1 / 15", "User EXEC / full privileged EXEC", "Give each account the lowest level that does the job"],
          ]}
        />
      </GuideSection>
      <GuideSection id="aad-vendors" eyebrow="Vendors" title="Other vendors">
        <p>The concepts are the same everywhere; the fallback rule is not. On Junos, <Mono>authentication-order [ tacplus password ]</Mono> also consults local accounts when the server rejects a user, not only when it is unreachable — which makes removing stale local accounts even more important. Always read your platform&apos;s fallback behaviour before relying on it.</p>
        <p>The servers are vendor-neutral too: Cisco ISE, Aruba ClearPass and FreeRADIUS all speak RADIUS; ISE and several open-source servers speak TACACS+.</p>
      </GuideSection>
      <GuideSection id="aad-myths" eyebrow="Misconceptions" title="Misconceptions">
        <Misconceptions
          items={[
            { myth: "service password-encryption makes passwords safe.", correction: "Type 7 is reversible. Use secrets (type 8 or 9)." },
            { myth: "If the AAA server says no, the local account is the backup.", correction: "On IOS, only no answer moves on. A rejection is final." },
            { myth: "Complexity rules make passwords strong.", correction: "Length and randomness do. 'Cisco@2026' meets complexity rules and is weak." },
          ]}
        />
      </GuideSection>
      <GuideSection id="aad-explain" eyebrow="Explain" title="Explain it">
        <ExplainIt
          items={[
            { q: "Why does the method list end with 'local' rather than start with it?", a: "Server first means every login is checked against current accounts and recorded centrally. Local last is used only if the server can't answer, so an outage doesn't lock everyone out." },
            { q: "Why couldn't disabling mark's TACACS+ account stop his login on SW2?", a: "SW2 asked its local database first, and the local account answered ACCEPT. The server was never asked." },
          ]}
        />
      </GuideSection>
      <GuideSection id="aad-quiz" eyebrow="Quiz" title="Check yourself">
        <KnowledgeQuiz questions={QUIZ} />
      </GuideSection>
    </>
  );
}
