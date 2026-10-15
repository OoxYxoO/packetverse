import type { BriefingPhaseDef, BriefingStepNote } from "@/components/lesson/briefing";
import { Callout, CompareCards, FieldTable, Glossary, GuideSection, Misconceptions, Mono, TroubleshootingFlow } from "@/components/lesson/GuideBlocks";
import { CliPair, CliPanel } from "@/components/lesson/GuideCli";
import { ExplainIt, KnowledgeQuiz, type KnowledgeQuestion } from "@/components/lesson/GuideInteractive";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { sshStatus, tftpBlocks, type MgmtState } from "@/lib/sim-engine/scenarios/ccna/deviceMgmt";

export const MGMT_BRIEFING_PHASES: BriefingPhaseDef[] = [
  { phase: { label: "Telnet", tone: "danger" }, objective: "See what Telnet exposes.", steps: ["intro", "predict-telnet", "telnet"] },
  { phase: { label: "SSH", tone: "violet" }, objective: "Give the switch an identity and an encrypted door.", steps: ["ssh-prereq", "ssh-config", "ssh-login"] },
  { phase: { label: "Files", tone: "ip" }, objective: "Back up and move configurations.", steps: ["tftp", "ftp-scp"] },
  { phase: { label: "Incident", tone: "danger" }, objective: "A replacement switch. SSH won't connect.", steps: ["fault-injected", "inc-refused"] },
  { phase: { label: "Diagnose", tone: "danger" }, objective: "Diagnosis pending.", steps: ["trouble-question", "diagnostic-layers"] },
  { phase: { label: "Repair pending", tone: "warning" }, objective: "Choose the change that fixes the cause you identified.", steps: ["repair-challenge"] },
  { phase: { label: "Verify", tone: "success" }, objective: "SSH in, Telnet out.", steps: ["verify"] },
  { phase: { label: "Complete", tone: "success" }, objective: "Secure remote management and file transfer.", steps: ["complete"] },
];
export const MGMT_BRIEFING_NOTES: Partial<Record<string, BriefingStepNote>> = {
  telnet: { takeaway: "Telnet sends passwords in clear text." },
  "ssh-config": { takeaway: "Hostname + domain + RSA ≥ 768 bits + transport input ssh + login local." },
  "ssh-login": { takeaway: "SSH: device authenticated by key, session encrypted." },
  tftp: { takeaway: "TFTP: UDP 69, 512-byte blocks, no authentication." },
  "fault-injected": { doingNow: "A configuration template." },
  "trouble-question": { doingNow: "Diagnosis pending." },
  "repair-challenge": { doingNow: "Choose the change that fixes the cause you identified." },
  verify: { takeaway: "Refused instantly = transport/ACL; rejected at login = credentials." },
};

export const MGMT_LESSON_SECTIONS: LessonGuideSectionLink[] = [
  { id: "dml-mission", label: "What this lesson teaches" },
  { id: "dml-compare", label: "Telnet vs SSH" },
  { id: "dml-steps", label: "Enable SSH, step by step" },
  { id: "dml-files", label: "TFTP, FTP, SCP" },
  { id: "dml-incident", label: "The incident and the fix" },
  { id: "dml-glossary", label: "Glossary" },
];
export const MGMT_DEEP_SECTIONS: LessonGuideSectionLink[] = [
  { id: "dmd-harden", label: "Hardening the management plane" },
  { id: "dmd-myths", label: "Misconceptions" },
  { id: "dmd-explain", label: "Explain it" },
  { id: "dmd-quiz", label: "Check yourself" },
];

export function MgmtLessonGuideContent() {
  const b = tftpBlocks(6840);
  const showSsh = (st: ReturnType<typeof sshStatus>) => ({ prompt: "SW1#", command: "show ip ssh", output: st.enabled ? `SSH Enabled - version ${st.version}\nAuthentication timeout: 120 secs; Authentication retries: 3` : `SSH Disabled - version 1.99\n%Please create RSA keys to enable SSH (${st.why})` });
  const cfg = (c: Partial<MgmtState["dev"]["SW1"]>) => ({ hostname: "SW1", vtyTransport: ["ssh"] as ("ssh" | "telnet")[], loginLocal: true, users: {}, ...c });
  return (
    <>
      <GuideSection id="dml-mission" eyebrow="Mission" title="What this lesson teaches">
        <p>See a Telnet password in a capture, then replace Telnet with SSH step by step; back up a configuration over TFTP and choose safer transfers — and fix a replacement switch that refuses SSH.</p>
        <Callout tone="violet" title="CCNA 4.8 · 4.9">Configure network devices for remote access using SSH; describe the capabilities and functions of TFTP and FTP.</Callout>
      </GuideSection>
      <GuideSection id="dml-compare" eyebrow="Compare" title="Telnet vs SSH">
        <CompareCards
          items={[
            { title: "Telnet", tone: "danger", tag: "TCP 23", points: ["Clear text, including passwords", "No server authentication", "Disable it"] },
            { title: "SSH v2", tone: "success", tag: "TCP 22", points: ["Encrypted session", "Device proves itself with its key", "Users by password or key"] },
          ]}
        />
      </GuideSection>
      <GuideSection id="dml-steps" eyebrow="Configure" title="Enable SSH, step by step">
        <CliPair
          cisco={{ prompt: "SW1(config)#", command: "ip domain name corp.example", output: "crypto key generate rsa modulus 2048\nip ssh version 2\nusername netadmin secret S3cure!pass\nline vty 0 15\n transport input ssh\n login local\n exec-timeout 10 0" }}
          junos={{ prompt: "admin@SW2# ", command: "set system services ssh protocol-version v2", output: "set system login user netadmin class super-user authentication plain-text-password\ndelete system services telnet\nset system services ssh root-login deny" }}
        />
        <div className="mt-2 grid gap-2 lg:grid-cols-2">
          <CliPanel run={showSsh(sshStatus(cfg({})))} caption="Without a domain name (model)" />
          <CliPanel run={showSsh(sshStatus(cfg({ domain: "corp.example", rsaBits: 2048 })))} caption="With domain and a 2048-bit key (model)" />
        </div>
      </GuideSection>
      <GuideSection id="dml-files" eyebrow="Files" title="TFTP, FTP, SCP">
        <FieldTable
          title="Moving images and configurations"
          columns={["Protocol", "Transport", "Authentication", "Encryption"]}
          rows={[
            ["TFTP", "UDP 69, 512-byte blocks, lock-step ACKs", "none", "none"],
            ["FTP", "TCP 21 control + TCP 20 / passive data", "username + password (clear text)", "none"],
            ["SCP / SFTP", "inside SSH, TCP 22", "SSH user", "yes"],
          ]}
        />
        <p>
          The lesson&apos;s 6,840-byte backup took {b.blocks} TFTP blocks — {b.blocks - 1} full and one of {b.last} bytes, which ends the transfer. Commands: <Mono>copy running-config tftp:</Mono>, <Mono>copy ftp: flash:</Mono>,{" "}
          <Mono>copy running-config scp:</Mono>.
        </p>
      </GuideSection>
      <GuideSection id="dml-incident" eyebrow="Incident" title="The incident and the fix" tone="danger">
        <TroubleshootingFlow
          steps={[
            { question: "Can you reach the device?", look: "ping, then telnet to port 22 to see if it's open." },
            { question: "Is SSH enabled?", look: <Mono>show ip ssh</Mono> },
            { question: "Do the VTY lines allow ssh?", look: <Mono>show line vty 0 | include transport</Mono> },
            { question: "Is there an access-class?", look: <Mono>show running-config | section line vty</Mono> },
          ]}
        />
      </GuideSection>
      <GuideSection id="dml-glossary" eyebrow="Words" title="Glossary">
        <Glossary
          items={[
            { term: "VTY", def: "Virtual terminal lines: the device's remote-login sessions." },
            { term: "transport input", def: "Which protocols the VTY lines accept (ssh, telnet, all, none)." },
            { term: "login local", def: "Authenticate with the device's local usernames." },
            { term: "RSA key", def: "The device's identity for SSH; ≥ 768 bits for v2, 2048 recommended." },
            { term: "TFTP", def: "Trivial FTP: UDP, no authentication, 512-byte blocks." },
          ]}
        />
      </GuideSection>
    </>
  );
}

const QUIZ: KnowledgeQuestion[] = [
  { id: "dmd-q1", prompt: "crypto key generate rsa fails with 'Please define a domain-name first'. What's missing?", options: [{ id: "d", label: "ip domain name" }, { id: "u", label: "a local user" }, { id: "v", label: "line vty" }], correctId: "d", explanation: "The key pair is named hostname.domain; set ip domain name (and a non-default hostname) first." },
  { id: "dmd-q2", prompt: "Which line command restricts SSH logins to the management subnet?", options: [{ id: "ac", label: "access-class MGMT in" }, { id: "ag", label: "ip access-group MGMT in" }, { id: "ti", label: "transport input ssh" }], correctId: "ac", explanation: "access-class applies an ACL to VTY lines; ip access-group filters an interface." },
];

export function MgmtDeepDiveContent() {
  return (
    <>
      <GuideSection id="dmd-harden" eyebrow="Hardening" title="Hardening the management plane">
        <ul className="list-disc space-y-1 pl-5">
          <li>SSH v2 only; Telnet and HTTP off; HTTPS if a web UI is needed.</li>
          <li>access-class on VTY lines so only the management network can connect.</li>
          <li>exec-timeout, login block-for (brute-force protection), and central AAA (see Device Access & AAA).</li>
          <li>A dedicated management VLAN or out-of-band network.</li>
        </ul>
      </GuideSection>
      <GuideSection id="dmd-myths" eyebrow="Misconceptions" title="Misconceptions">
        <Misconceptions items={[{ myth: "Enabling SSH disables Telnet.", correction: "Only transport input decides; 'all' allows both." }, { myth: "TFTP is safe inside the LAN.", correction: "Anyone who can reach the server can read the configs on it — including password hashes." }]} />
      </GuideSection>
      <GuideSection id="dmd-explain" eyebrow="Explain" title="Explain it">
        <ExplainIt items={[{ q: "Why was SSH refused immediately rather than at the password prompt?", a: "The VTY lines didn't accept SSH at all, so the TCP connection was reset before any authentication." }]} />
      </GuideSection>
      <GuideSection id="dmd-quiz" eyebrow="Quiz" title="Check yourself">
        <KnowledgeQuiz questions={QUIZ} />
      </GuideSection>
    </>
  );
}
