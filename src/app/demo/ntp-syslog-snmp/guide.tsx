import type { BriefingPhaseDef, BriefingStepNote } from "@/components/lesson/briefing";
import { Callout, CompareCards, FieldTable, Glossary, GuideSection, Misconceptions, Mono, TroubleshootingFlow } from "@/components/lesson/GuideBlocks";
import { CliPair } from "@/components/lesson/GuideCli";
import { ExplainIt, KnowledgeQuiz, type KnowledgeQuestion } from "@/components/lesson/GuideInteractive";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { SEVERITY, ntpExchange } from "@/lib/sim-engine/scenarios/ccna/ntpSyslogSnmp";

export const OPS_BRIEFING_PHASES: BriefingPhaseDef[] = [
  { phase: { label: "NTP", tone: "cyan" }, objective: "Give every device the same time.", steps: ["intro", "stratum", "ntp-core", "ntp-clients"] },
  { phase: { label: "Syslog", tone: "violet" }, objective: "Send the right messages to one place.", steps: ["severity", "syslog"] },
  { phase: { label: "SNMP", tone: "ip" }, objective: "Measure the network, and hear when it breaks.", steps: ["snmp-poll", "snmp-trap", "snmp-versions"] },
  { phase: { label: "Incident", tone: "danger" }, objective: "An outage to reconstruct from the logs.", steps: ["fault-injected", "inc-timeline"] },
  { phase: { label: "Diagnose", tone: "danger" }, objective: "Diagnosis pending.", steps: ["trouble-question", "diagnostic-layers"] },
  { phase: { label: "Repair pending", tone: "warning" }, objective: "Choose the change that fixes the cause you identified.", steps: ["repair-challenge"] },
  { phase: { label: "Verify", tone: "success" }, objective: "Prove SW1's clock and logs line up.", steps: ["verify"] },
  { phase: { label: "Complete", tone: "success" }, objective: "One clock, one log, one monitor.", steps: ["complete"] },
];
export const OPS_BRIEFING_NOTES: Partial<Record<string, BriefingStepNote>> = {
  "ntp-core": { takeaway: "Offset and delay come from four timestamps." },
  "ntp-clients": { takeaway: "One internal NTP server for all devices." },
  syslog: { takeaway: "Messages are stamped by the sender's clock." },
  "snmp-poll": { takeaway: "Rates come from two counter readings." },
  "snmp-trap": { takeaway: "Traps are unsolicited (UDP 162); polls use UDP 161." },
  "fault-injected": { doingNow: "Reconstructing an outage." },
  "trouble-question": { doingNow: "Diagnosis pending." },
  "repair-challenge": { doingNow: "Choose the change that fixes the cause you identified." },
  verify: { takeaway: "Fix the clock source, not the clock." },
};

export const OPS_LESSON_SECTIONS: LessonGuideSectionLink[] = [
  { id: "opl-mission", label: "What this lesson teaches" },
  { id: "opl-ntp", label: "NTP: four timestamps" },
  { id: "opl-syslog", label: "Syslog severities" },
  { id: "opl-snmp", label: "SNMP: polls, traps, versions" },
  { id: "opl-config", label: "Configure and verify" },
  { id: "opl-incident", label: "The incident and the fix" },
  { id: "opl-glossary", label: "Glossary" },
];
export const OPS_DEEP_SECTIONS: LessonGuideSectionLink[] = [
  { id: "opd-telemetry", label: "Beyond SNMP: streaming telemetry" },
  { id: "opd-myths", label: "Misconceptions" },
  { id: "opd-explain", label: "Explain it" },
  { id: "opd-quiz", label: "Check yourself" },
];

export function OpsLessonGuideContent() {
  const ex = ntpExchange(0.734);
  return (
    <>
      <GuideSection id="opl-mission" eyebrow="Mission" title="What this lesson teaches">
        <p>Synchronise every clock with NTP, send the right syslog messages to one server, measure and monitor with SNMP — then rebuild an outage timeline that one unsynchronised switch scrambled.</p>
        <Callout tone="violet" title="CCNA 4.2 · 4.4 · 4.5">Configure and verify NTP in client and server mode; explain SNMP; describe syslog features including facilities and levels.</Callout>
      </GuideSection>
      <GuideSection id="opl-ntp" eyebrow="NTP" title="NTP: four timestamps">
        <FieldTable
          title="CORE's first exchange (from the lesson's model, CORE 0.734 s fast)"
          columns={["Timestamp", "Value", "Meaning"]}
          rows={[
            ["t1", String(ex.t1), "CORE sends (CORE's clock)"],
            ["t2", String(ex.t2), "Server receives (server's clock)"],
            ["t3", String(ex.t3), "Server replies"],
            ["t4", String(ex.t4), "CORE receives (CORE's clock)"],
            ["offset", `((t2−t1)+(t3−t4))/2 = ${ex.offset} s`, "How far to correct"],
            ["delay", `(t4−t1)−(t3−t2) = ${ex.delay} s`, "Round trip on the network"],
          ]}
        />
        <p>The residual error is half the path asymmetry (12 ms out, 18 ms back → 3 ms). Stratum: reference clock 0, attached server 1, each hop +1, unsynchronised 16.</p>
      </GuideSection>
      <GuideSection id="opl-syslog" eyebrow="Syslog" title="Syslog severities">
        <FieldTable title="Levels — logging trap N sends 0..N" columns={["Level", "Name"]} rows={SEVERITY.map((n, i) => [String(i), n])} />
        <p>A message looks like <Mono>*Oct 14 14:02:10.997: %LINK-3-UPDOWN: Interface Gi0/2, changed state to down</Mono> — facility LINK, severity 3, mnemonic UPDOWN. Syslog uses UDP 514 by default; facilities (local0–local7) let servers sort sources.</p>
      </GuideSection>
      <GuideSection id="opl-snmp" eyebrow="SNMP" title="SNMP: polls, traps, versions">
        <CompareCards
          items={[
            { title: "Get / poll", tone: "cyan", tag: "NMS → agent, UDP 161", points: ["Read MIB objects (OIDs)", "Counters → rates from two polls", "Set changes configuration (rarely used)"] },
            { title: "Trap / inform", tone: "warning", tag: "agent → NMS, UDP 162", points: ["Unsolicited events (linkDown)", "Informs are acknowledged traps"] },
            { title: "Versions", tone: "violet", tag: "security", points: ["v1/v2c: community strings in clear text", "v3: users, auth (HMAC), priv (AES)", "Use v3 authPriv"] },
          ]}
        />
      </GuideSection>
      <GuideSection id="opl-config" eyebrow="Configure" title="Configure and verify">
        <CliPair
          cisco={{ prompt: "SW1(config)#", command: "ntp server 10.0.0.1", output: "logging host 10.50.0.20\nlogging trap warnings\nservice timestamps log datetime msec\nsnmp-server group NMS v3 priv\nsnmp-server user nms NMS v3 auth sha <key> priv aes 128 <key>\nsnmp-server host 10.50.0.30 version 3 priv nms\n!\nSW1# show ntp status\nSW1# show ntp associations" }}
          junos={{ prompt: "admin@FW1# ", command: "set system ntp server 10.0.0.1", output: "set system syslog host 10.50.0.20 any warning\nset snmp v3 usm local-engine user nms authentication-sha ...\nadmin@FW1> show ntp status" }}
        />
      </GuideSection>
      <GuideSection id="opl-incident" eyebrow="Incident" title="The incident and the fix" tone="danger">
        <TroubleshootingFlow
          steps={[
            { question: "Which devices disagree with the rest?", look: "Compare timestamps for the same event." },
            { question: "Is the odd one synchronised?", look: <><Mono>show ntp status</Mono> — stratum 16 = unsynchronised</> },
            { question: "Can it reach its server?", look: <><Mono>show ntp associations</Mono>, ping the configured server</> },
          ]}
        />
        <p>SW1 pointed at a decommissioned server. Pointing it at CORE fixes the source; setting the clock by hand would drift again and prove nothing.</p>
      </GuideSection>
      <GuideSection id="opl-glossary" eyebrow="Words" title="Glossary">
        <Glossary
          items={[
            { term: "Stratum", def: "Hops from a reference clock; 16 = unsynchronised." },
            { term: "Offset / delay", def: "Clock error / network round-trip, from the four NTP timestamps." },
            { term: "Severity", def: "Syslog level 0 (emergency) – 7 (debug)." },
            { term: "MIB / OID", def: "SNMP's data model / one object's identifier." },
            { term: "Trap", def: "An unsolicited SNMP notification." },
          ]}
        />
      </GuideSection>
    </>
  );
}

const QUIZ: KnowledgeQuestion[] = [
  { id: "opd-q1", prompt: "logging trap notifications is configured. Which severities reach the server?", options: [{ id: "a", label: "0 through 5" }, { id: "b", label: "5 through 7" }, { id: "c", label: "Only 5" }], correctId: "a", explanation: "notifications = 5; the trap level and everything more severe (lower numbers) are sent." },
  { id: "opd-q2", prompt: "Which SNMP message is sent by the agent without being asked?", options: [{ id: "trap", label: "Trap" }, { id: "get", label: "GetRequest" }, { id: "set", label: "SetRequest" }], correctId: "trap", explanation: "Traps (and informs) are agent-initiated, to UDP 162." },
];

export function OpsDeepDiveContent() {
  return (
    <>
      <GuideSection id="opd-telemetry" eyebrow="Beyond" title="Beyond SNMP: streaming telemetry">
        <p>Modern platforms push data continuously (model-driven telemetry over gRPC/gNMI, NETCONF notifications) instead of being polled every few minutes — see Automation & Programmability.</p>
      </GuideSection>
      <GuideSection id="opd-myths" eyebrow="Misconceptions" title="Misconceptions">
        <Misconceptions items={[{ myth: "The syslog server timestamps messages.", correction: "Devices stamp their own messages; the server records what it receives." }, { myth: "Lower stratum is always more accurate.", correction: "Stratum is distance from the reference, not a quality guarantee." }]} />
      </GuideSection>
      <GuideSection id="opd-explain" eyebrow="Explain" title="Explain it">
        <ExplainIt items={[{ q: "Why did the timeline put SW1's failure three hours early?", a: "SW1's unsynchronised clock was 3 h 19 min behind, and it stamped its own messages." }]} />
      </GuideSection>
      <GuideSection id="opd-quiz" eyebrow="Quiz" title="Check yourself">
        <KnowledgeQuiz questions={QUIZ} />
      </GuideSection>
    </>
  );
}
