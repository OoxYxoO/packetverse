import type { BriefingPhaseDef, BriefingStepNote } from "@/components/lesson/briefing";
import { Callout, FieldTable, Glossary, GuideSection, Misconceptions, TroubleshootingFlow } from "@/components/lesson/GuideBlocks";
import { CliPair, CliPanel } from "@/components/lesson/GuideCli";
import { ExplainIt, KnowledgeQuiz, type KnowledgeQuestion } from "@/components/lesson/GuideInteractive";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";

export const CM_BRIEFING_PHASES: BriefingPhaseDef[] = [
  { phase: { label: "Source of truth", tone: "cyan" }, objective: "Describe once; let a tool make it so.", steps: ["intro", "check", "apply"] },
  { phase: { label: "Idempotent", tone: "violet" }, objective: "Why running twice is safe.", steps: ["predict-idem", "idem"] },
  { phase: { label: "Four tools", tone: "ip" }, objective: "Push or pull, agent or agentless — and Terraform's plan.", steps: ["predict-agent", "terraform"] },
  { phase: { label: "Incident", tone: "danger" }, objective: "A night-time fix and a nightly run.", steps: ["fault-injected", "inc-run"] },
  { phase: { label: "Diagnose", tone: "danger" }, objective: "Diagnosis pending.", steps: ["trouble-question", "diagnostic-layers"] },
  { phase: { label: "Repair pending", tone: "warning" }, objective: "Choose the change that fixes the cause you identified.", steps: ["repair-challenge"] },
  { phase: { label: "Verify", tone: "success" }, objective: "Prove the fix survives the next run.", steps: ["verify"] },
  { phase: { label: "Complete", tone: "success" }, objective: "Ansible, Terraform, Puppet, Chef.", steps: ["complete"] },
];
export const CM_BRIEFING_NOTES: Partial<Record<string, BriefingStepNote>> = {
  check: { takeaway: "Check mode previews; it changes nothing." },
  apply: { takeaway: "Only devices that differ are changed." },
  idem: { takeaway: "Idempotent: nothing to fix → nothing changes." },
  terraform: { takeaway: "Terraform: plan against state, then apply." },
  "fault-injected": { doingNow: "A change is made in a hurry." },
  "trouble-question": { doingNow: "Diagnosis pending." },
  "repair-challenge": { doingNow: "Choose the change that fixes the cause you identified." },
  verify: { takeaway: "Change the source of truth, not just the device." },
};

export const CM_LESSON_SECTIONS: LessonGuideSectionLink[] = [
  { id: "cml-mission", label: "What this lesson teaches" },
  { id: "cml-compare", label: "Ansible, Terraform, Puppet, Chef" },
  { id: "cml-playbook", label: "The playbook" },
  { id: "cml-terraform", label: "Terraform's plan and state" },
  { id: "cml-incident", label: "The incident and the fix" },
  { id: "cml-glossary", label: "Glossary" },
];
export const CM_DEEP_SECTIONS: LessonGuideSectionLink[] = [
  { id: "cmd-gitops", label: "Changes as code" },
  { id: "cmd-vendors", label: "Network modules for every vendor" },
  { id: "cmd-myths", label: "Misconceptions" },
  { id: "cmd-explain", label: "Explain it" },
  { id: "cmd-quiz", label: "Check yourself" },
];

export function CmLessonGuideContent() {
  return (
    <>
      <GuideSection id="cml-mission" eyebrow="Mission" title="What this lesson teaches">
        <p>Why a network described in files and applied by a tool stays consistent — and how Ansible, Terraform, Puppet and Chef differ in how they reach the devices and describe the result.</p>
        <Callout tone="violet" title="CCNA 6.1 · 6.6">How automation impacts network management; capabilities of configuration management mechanisms such as Ansible, Terraform, Puppet and Chef.</Callout>
      </GuideSection>
      <GuideSection id="cml-compare" eyebrow="Compare" title="Ansible, Terraform, Puppet, Chef">
        <FieldTable
          title="How each tool works"
          columns={["", "Ansible", "Terraform", "Puppet", "Chef"]}
          rows={[
            ["Model", "Push", "Push (via APIs)", "Pull", "Pull"],
            ["Agent on node", "No (SSH / API)", "No (provider APIs)", "Yes", "Yes"],
            ["Language", "YAML playbooks", "HCL", "Puppet DSL manifests", "Ruby recipes / cookbooks"],
            ["Style", "Mostly declarative tasks", "Declarative + state file", "Declarative", "Procedural-leaning"],
            ["Typical network use", "Device config at scale", "Cloud and infrastructure provisioning", "Server + some device config", "Server config"],
          ]}
        />
      </GuideSection>
      <GuideSection id="cml-playbook" eyebrow="Ansible" title="The playbook">
        <CliPanel
          caption="access.yml (simplified)"
          run={{ prompt: "$ ", command: "cat access.yml", output: "- name: Access switch baseline\n  hosts: access\n  gather_facts: false\n  tasks:\n    - name: NTP server\n      cisco.ios.ios_ntp_global:\n        config:\n          servers:\n            - server: \"{{ ntp_server }}\"\n        state: merged\n    - name: Login banner\n      cisco.ios.ios_banner:\n        banner: login\n        text: \"{{ banner }}\"" }}
        />
        <CliPanel caption="Check mode, then apply" run={{ prompt: "$ ", command: "ansible-playbook access.yml --check --diff", output: "PLAY RECAP\nSW1 : ok=2 changed=0\nSW3 : ok=1 changed=1\nSW5 : ok=1 changed=1\n..." }} />
      </GuideSection>
      <GuideSection id="cml-terraform" eyebrow="Terraform" title="Terraform's plan and state">
        <CliPanel caption="main.tf → plan" run={{ prompt: "$ ", command: "terraform plan", output: "+ aws_vpc.campus    (cidr 10.200.0.0/16)\n+ aws_subnet.app    (cidr 10.200.1.0/24)\nPlan: 2 to add, 0 to change, 0 to destroy." }} />
        <p>The state file is Terraform&apos;s memory of what it built. Plan compares the configuration with it; anything changed outside Terraform shows up as drift on the next plan.</p>
      </GuideSection>
      <GuideSection id="cml-incident" eyebrow="Incident" title="The incident and the fix" tone="danger">
        <TroubleshootingFlow
          steps={[
            { question: "What did the run change?", look: "PLAY RECAP: changed=6 — every switch." },
            { question: "To what?", look: "ntp_server from group_vars: 10.9.0.123 — the dead server." },
            { question: "Why?", look: "The 2 a.m. fix was made only on the devices; Git never heard of it." },
          ]}
        />
        <p>Fix: commit ntp_server: 10.9.0.124 to group_vars, review it, run the playbook. Emergency changes on devices must be followed by the same change in the source of truth.</p>
      </GuideSection>
      <GuideSection id="cml-glossary" eyebrow="Words" title="Glossary">
        <Glossary
          items={[
            { term: "Source of truth", def: "The files (usually in Git) that define how the network should be." },
            { term: "Idempotent", def: "Applying it again changes nothing if nothing differs." },
            { term: "Drift", def: "A device that no longer matches its source of truth." },
            { term: "Inventory", def: "Ansible's list of hosts and groups." },
            { term: "State file", def: "Terraform's record of the resources it manages." },
          ]}
        />
      </GuideSection>
    </>
  );
}

const QUIZ: KnowledgeQuestion[] = [
  { id: "cmd-q1", prompt: "Which tool is agentless and pushes changes over SSH?", options: [{ id: "a", label: "Ansible" }, { id: "p", label: "Puppet" }, { id: "c", label: "Chef" }], correctId: "a", explanation: "Ansible connects from a control node; Puppet and Chef run agents that pull." },
  { id: "cmd-q2", prompt: "What does 'terraform plan' compare?", options: [{ id: "s", label: "The configuration files against the state file" }, { id: "g", label: "Two Git branches" }, { id: "d", label: "Two devices' running configs" }], correctId: "s", explanation: "Plan diffs the desired configuration against Terraform's recorded state (refreshed from the provider)." },
  { id: "cmd-q3", prompt: "Chef recipes are written in…", options: [{ id: "r", label: "Ruby" }, { id: "y", label: "YAML" }, { id: "h", label: "HCL" }], correctId: "r", explanation: "Chef uses a Ruby DSL; Ansible uses YAML; Terraform uses HCL; Puppet its own DSL." },
];

export function CmDeepDiveContent() {
  return (
    <>
      <GuideSection id="cmd-gitops" eyebrow="Process" title="Changes as code">
        <p>Once the network is described in Git, a change is a pull request: reviewed, tested (lint, check mode, a lab), merged, applied by a pipeline. The history shows who changed what and why; rollback is a revert.</p>
      </GuideSection>
      <GuideSection id="cmd-vendors" eyebrow="Vendors" title="Network modules for every vendor">
        <CliPair
          ciscoCaption="Ansible · Cisco IOS"
          cisco={{ prompt: "- ", command: "cisco.ios.ios_ntp_global:", output: "    config: { servers: [ { server: \"{{ ntp_server }}\" } ] }\n    state: merged" }}
          junosCaption="Ansible · Junos"
          junos={{ prompt: "- ", command: "junipernetworks.junos.junos_ntp_global:", output: "    config: { servers: [ { server: \"{{ ntp_server }}\" } ] }\n    state: merged" }}
        />
        <p>The same variable drives both vendors; only the module changes. Arista (arista.eos) and others follow the same pattern.</p>
      </GuideSection>
      <GuideSection id="cmd-myths" eyebrow="Misconceptions" title="Misconceptions">
        <Misconceptions
          items={[
            { myth: "Automation only matters for big networks.", correction: "Even six switches drifted twice in this lesson. Consistency and history help at any size." },
            { myth: "A hand fix in an emergency is fine on its own.", correction: "The next run reverts it unless the source of truth is updated too." },
            { myth: "Running a playbook twice doubles the changes.", correction: "Idempotent modules change only what differs." },
          ]}
        />
      </GuideSection>
      <GuideSection id="cmd-explain" eyebrow="Explain" title="Explain it">
        <ExplainIt items={[{ q: "Why is disabling the nightly run the wrong repair?", a: "It stops the revert but also stops drift correction everywhere — and Git still names a dead server, so the next intentional run breaks the clocks again." }]} />
      </GuideSection>
      <GuideSection id="cmd-quiz" eyebrow="Quiz" title="Check yourself">
        <KnowledgeQuiz questions={QUIZ} />
      </GuideSection>
    </>
  );
}
