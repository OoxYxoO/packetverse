import type { BriefingPhaseDef, BriefingStepNote } from "@/components/lesson/briefing";
import { Callout, CompareCards, FieldTable, Glossary, GuideSection, Misconceptions, Mono, ProtocolStory, TroubleshootingFlow } from "@/components/lesson/GuideBlocks";
import { CliPair } from "@/components/lesson/GuideCli";
import { ExplainIt, KnowledgeQuiz, type KnowledgeQuestion } from "@/components/lesson/GuideInteractive";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { HSRP_TIMERS, VIP, VMAC, VRRP_TIMERS, VRRP_VMAC } from "@/lib/sim-engine/scenarios/ccna/fhrp";

export const FHRP_BRIEFING_PHASES: BriefingPhaseDef[] = [
  { phase: { label: "The problem", tone: "cyan" }, objective: "See why hosts need a gateway that can't die.", steps: ["intro", "vip"] },
  { phase: { label: "HSRP", tone: "violet" }, objective: "Elect an active router and send traffic through it.", steps: ["hello", "predict-election", "election", "host-arp", "traffic"] },
  { phase: { label: "Failover", tone: "ip" }, objective: "Lose the active router, then get it back.", steps: ["predict-failover", "failover", "restore", "vrrp"] },
  { phase: { label: "Incident", tone: "danger" }, objective: "A WAN circuit fails on one router.", steps: ["fault-injected", "inc-down"] },
  { phase: { label: "Diagnose", tone: "danger" }, objective: "Diagnosis pending.", steps: ["trouble-question", "diagnostic-layers"] },
  { phase: { label: "Repair pending", tone: "warning" }, objective: "Choose the change that fixes the cause you identified.", steps: ["repair-challenge"] },
  { phase: { label: "Verify", tone: "success" }, objective: "Prove traffic moves to the healthy router.", steps: ["verify"] },
  { phase: { label: "Complete", tone: "success" }, objective: "Virtual gateways, priority, preempt and tracking.", steps: ["complete"] },
];
export const FHRP_BRIEFING_NOTES: Partial<Record<string, BriefingStepNote>> = {
  election: { takeaway: "One active router answers for the virtual IP; the standby waits." },
  "host-arp": { takeaway: "Hosts cache the virtual MAC — it never changes on failover." },
  failover: { takeaway: "Failover after the hold time; a gratuitous ARP moves the MAC." },
  restore: { takeaway: "Taking back the active role needs preempt." },
  vrrp: { takeaway: "VRRP: standard, master/backup, preempt on by default." },
  "fault-injected": { doingNow: "A tracked interface goes down." },
  "trouble-question": { doingNow: "Diagnosis pending." },
  "repair-challenge": { doingNow: "Choose the change that fixes the cause you identified." },
  verify: { takeaway: "Tracking lowers priority; only preempt turns that into a takeover." },
};

export const FHRP_LESSON_SECTIONS: LessonGuideSectionLink[] = [
  { id: "fhl-mission", label: "What this lesson teaches" },
  { id: "fhl-idea", label: "A virtual gateway" },
  { id: "fhl-compare", label: "HSRP, VRRP and GLBP" },
  { id: "fhl-failover", label: "Failover step by step" },
  { id: "fhl-preempt", label: "Preempt and tracking" },
  { id: "fhl-config", label: "Configure and verify" },
  { id: "fhl-incident", label: "The incident and the fix" },
  { id: "fhl-glossary", label: "Glossary" },
];
export const FHRP_DEEP_SECTIONS: LessonGuideSectionLink[] = [
  { id: "fhd-timers", label: "Timers and convergence" },
  { id: "fhd-design", label: "Design: align with spanning tree" },
  { id: "fhd-myths", label: "Misconceptions" },
  { id: "fhd-explain", label: "Explain it" },
  { id: "fhd-quiz", label: "Check yourself" },
];

export function FhrpLessonGuideContent() {
  return (
    <>
      <GuideSection id="fhl-mission" eyebrow="Mission" title="What this lesson teaches">
        <p>Give a subnet a gateway that survives a router failure: elect an active router, watch traffic move when it dies and come back when it returns, and fix a WAN outage that tracking detected but nothing acted on.</p>
        <Callout tone="violet" title="CCNA 3.5">Describe the purpose, functions and concepts of first hop redundancy protocols.</Callout>
      </GuideSection>
      <GuideSection id="fhl-idea" eyebrow="Idea" title="A virtual gateway">
        <p>Hosts are configured with {VIP}. Neither router owns it outright: the active router answers ARP for it with the virtual MAC {VMAC} and forwards traffic sent to that MAC. Hosts never learn that two routers exist.</p>
      </GuideSection>
      <GuideSection id="fhl-compare" eyebrow="Compare" title="HSRP, VRRP and GLBP">
        <FieldTable
          title="Three first-hop redundancy protocols"
          columns={["", "HSRP", "VRRP", "GLBP"]}
          rows={[
            ["Standard", "Cisco", "IETF (RFC 5798)", "Cisco"],
            ["Roles", "Active / standby", "Master / backup", "AVG + AVFs"],
            ["Multicast", "224.0.0.2 (v1) / 224.0.0.102 (v2), UDP 1985", "224.0.0.18, IP protocol 112", "224.0.0.102, UDP 3222"],
            ["Virtual MAC", "0000.0c07.acXX (v1)", "0000.5e00.01XX", "0007.b400.XXYY"],
            ["Timers", `hello ${HSRP_TIMERS.hello} s / hold ${HSRP_TIMERS.hold} s`, `advert ${VRRP_TIMERS.advert} s / ~${VRRP_TIMERS.masterDown.toFixed(1)} s`, "3 s / 10 s"],
            ["Preempt default", "off", "on", "off"],
            ["Load sharing", "per group (several groups)", "per group", "built in, one group"],
          ]}
        />
      </GuideSection>
      <GuideSection id="fhl-failover" eyebrow="Failover" title="Failover step by step">
        <ProtocolStory
          steps={[
            { actor: "R1 (active)", action: "Stops sending hellos — it lost power." },
            { actor: "R2 (standby)", action: `Hears nothing for ${HSRP_TIMERS.hold} s (hold time).`, changes: "R2 becomes active." },
            { actor: "R2", action: `Sends gratuitous ARP: ${VIP} is at ${VMAC}.`, changes: "Switches move the virtual MAC to R2's port." },
            { actor: "PC1", action: "Keeps sending to the same gateway MAC.", changes: "No change on the host at all." },
          ]}
        />
      </GuideSection>
      <GuideSection id="fhl-preempt" eyebrow="Rules" title="Preempt and tracking">
        <CompareCards
          items={[
            { title: "Preempt", tone: "violet", tag: "may I take over?", points: ["Lets a higher-priority router replace a working active router", "HSRP: off by default · VRRP: on", "Without it, the first router up stays active"] },
            { title: "Tracking", tone: "warning", tag: "am I still useful?", points: ["Lowers priority when an uplink fails", "R1: 110 − 20 = 90", "Useless unless the other router can preempt"] },
          ]}
        />
      </GuideSection>
      <GuideSection id="fhl-config" eyebrow="Configure" title="Configure and verify">
        <CliPair
          cisco={{ prompt: "R1(config-if)#", command: "standby 10 ip 10.1.1.1", output: " standby 10 priority 110\n standby 10 preempt\n standby 10 track GigabitEthernet0/1 20\n!\nR1# show standby brief" }}
          junos={{ prompt: "admin@R1# ", command: "set interfaces ge-0/0/0 unit 0 family inet address 10.1.1.2/24 vrrp-group 10 virtual-address 10.1.1.1", output: "set ... vrrp-group 10 priority 110\nset ... vrrp-group 10 preempt\nset ... vrrp-group 10 track interface ge-0/0/1 priority-cost 20\nadmin@R1> show vrrp" }}
        />
        <p>Junos runs VRRP (no HSRP); the concepts — priority, preempt, tracking — carry over word for word.</p>
      </GuideSection>
      <GuideSection id="fhl-incident" eyebrow="Incident" title="The incident and the fix" tone="danger">
        <TroubleshootingFlow
          steps={[
            { question: "Which router is active?", look: <Mono>show standby brief</Mono> },
            { question: "What are both priorities now?", look: "Tracked decrements included." },
            { question: "Can the higher one preempt?", look: "The P flag in show standby brief." },
            { question: "Can the active router actually route out?", look: <Mono>show ip route 0.0.0.0</Mono> },
          ]}
        />
      </GuideSection>
      <GuideSection id="fhl-glossary" eyebrow="Words" title="Glossary">
        <Glossary
          items={[
            { term: "FHRP", def: "First hop redundancy protocol: a shared virtual gateway (HSRP, VRRP, GLBP)." },
            { term: "Virtual IP / MAC", def: "The gateway address and MAC owned by whichever router is active." },
            { term: "Preempt", def: "Permission to take over from a working active router with lower priority." },
            { term: "Object tracking", def: "Lowering priority when a monitored interface or route fails." },
            { term: "Gratuitous ARP", def: "An unsolicited ARP reply that updates switches' MAC tables." },
          ]}
        />
      </GuideSection>
    </>
  );
}

const QUIZ: KnowledgeQuestion[] = [
  { id: "fhd-q1", prompt: "Two HSRP routers both have priority 100. Which becomes active?", options: [{ id: "ip", label: "The one with the higher interface IP" }, { id: "first", label: "Always the first configured" }, { id: "mac", label: "The lower MAC" }], correctId: "ip", explanation: "Equal priority → highest IP address on the HSRP interface." },
  { id: "fhd-q2", prompt: "Which virtual MAC belongs to VRRP group 5?", options: [{ id: "v", label: "0000.5e00.0105" }, { id: "h", label: "0000.0c07.ac05" }, { id: "g", label: "0007.b400.0501" }], correctId: "v", explanation: `VRRP virtual MACs are 0000.5e00.01XX (group 10 → ${VRRP_VMAC}).` },
];

export function FhrpDeepDiveContent() {
  return (
    <>
      <GuideSection id="fhd-timers" eyebrow="Timers" title="Timers and convergence">
        <p>Default HSRP failover takes up to the hold time ({HSRP_TIMERS.hold} s). Millisecond hello/hold timers or BFD bring it under a second — at the cost of more control traffic.</p>
      </GuideSection>
      <GuideSection id="fhd-design" eyebrow="Design" title="Design: align with spanning tree">
        <p>Make the HSRP active router for a VLAN the same switch as that VLAN&apos;s STP root, so host traffic takes the shortest path. With two VLANs, make each distribution switch active for one — load sharing by group.</p>
      </GuideSection>
      <GuideSection id="fhd-myths" eyebrow="Misconceptions" title="Misconceptions">
        <Misconceptions
          items={[
            { myth: "HSRP load-balances between the routers.", correction: "One group has one active router. Use several groups (or GLBP) to share load." },
            { myth: "Hosts re-ARP after a failover.", correction: "They don't need to — the virtual MAC moves; the gratuitous ARP updates switches." },
          ]}
        />
      </GuideSection>
      <GuideSection id="fhd-explain" eyebrow="Explain" title="Explain it">
        <ExplainIt items={[{ q: "Why didn't tracking alone fix the WAN outage?", a: "It lowered R1's priority to 90, but R1 was still alive. R2 could take over from a live active router only with preempt." }]} />
      </GuideSection>
      <GuideSection id="fhd-quiz" eyebrow="Quiz" title="Check yourself">
        <KnowledgeQuiz questions={QUIZ} />
      </GuideSection>
    </>
  );
}
