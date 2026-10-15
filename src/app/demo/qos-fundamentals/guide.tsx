import type { BriefingPhaseDef, BriefingStepNote } from "@/components/lesson/briefing";
import { Callout, CompareCards, FieldTable, Glossary, GuideSection, Misconceptions, Mono, TroubleshootingFlow } from "@/components/lesson/GuideBlocks";
import { CliPair } from "@/components/lesson/GuideCli";
import { ExplainIt, KnowledgeQuiz, type KnowledgeQuestion } from "@/components/lesson/GuideInteractive";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { FLOWS, FULL_QUEUE_MS, fifo, llq, tokenBucket } from "@/lib/sim-engine/scenarios/ccna/qos";

export const QOS_BRIEFING_PHASES: BriefingPhaseDef[] = [
  { phase: { label: "Marking", tone: "cyan" }, objective: "Decide what each packet is worth.", steps: ["intro", "marking"] },
  { phase: { label: "Queuing", tone: "violet" }, objective: "Compare FIFO with LLQ under congestion.", steps: ["fifo", "predict-llq", "llq"] },
  { phase: { label: "Rate limits", tone: "ip" }, objective: "Shape to the contract instead of being policed.", steps: ["shape-police", "shaper"] },
  { phase: { label: "Incident", tone: "danger" }, objective: "A hardware swap. Choppy calls at night.", steps: ["fault-injected", "inc-choppy"] },
  { phase: { label: "Diagnose", tone: "danger" }, objective: "Diagnosis pending.", steps: ["trouble-question", "diagnostic-layers"] },
  { phase: { label: "Repair pending", tone: "warning" }, objective: "Choose the change that fixes the cause you identified.", steps: ["repair-challenge"] },
  { phase: { label: "Verify", tone: "success" }, objective: "Prove voice is protected again.", steps: ["verify"] },
  { phase: { label: "Complete", tone: "success" }, objective: "Mark, queue, shape — and keep the trust boundary.", steps: ["complete"] },
];
export const QOS_BRIEFING_NOTES: Partial<Record<string, BriefingStepNote>> = {
  fifo: { takeaway: "FIFO under congestion: everyone loses the same share." },
  llq: { takeaway: "LLQ: voice first; the backup absorbs the congestion." },
  shaper: { takeaway: "Tc = Bc / CIR." },
  "fault-injected": { doingNow: "A replacement access switch." },
  "trouble-question": { doingNow: "Diagnosis pending." },
  "repair-challenge": { doingNow: "Choose the change that fixes the cause you identified." },
  verify: { takeaway: "A queue only protects what is marked to reach it." },
};

export const QOS_LESSON_SECTIONS: LessonGuideSectionLink[] = [
  { id: "qsl-mission", label: "What this lesson teaches" },
  { id: "qsl-marks", label: "Markings" },
  { id: "qsl-compare", label: "FIFO vs LLQ, computed" },
  { id: "qsl-tools", label: "The QoS toolbox" },
  { id: "qsl-config", label: "Configure and verify" },
  { id: "qsl-incident", label: "The incident and the fix" },
  { id: "qsl-glossary", label: "Glossary" },
];
export const QOS_DEEP_SECTIONS: LessonGuideSectionLink[] = [
  { id: "qsd-budget", label: "Voice budgets" },
  { id: "qsd-myths", label: "Misconceptions" },
  { id: "qsd-explain", label: "Explain it" },
  { id: "qsd-quiz", label: "Check yourself" },
];

export function QosLessonGuideContent() {
  const row = (r: ReturnType<typeof fifo>[number]) => [r.name, r.queue, `${r.sentMbps}/${r.mbps}`, `${r.lossPct}%`, `${r.delayMs} ms`];
  const tb = tokenBucket(10, 100_000);
  return (
    <>
      <GuideSection id="qsl-mission" eyebrow="Mission" title="What this lesson teaches">
        <p>Overload a 10 Mb/s WAN link and decide who suffers: mark at a trusted edge, compare FIFO with low-latency queuing, shape to a contract — and find why voice broke up after an access switch was replaced.</p>
        <Callout tone="violet" title="CCNA 4.7">Explain the forwarding per-hop behaviour for QoS: classification, marking, queuing, congestion, policing and shaping.</Callout>
      </GuideSection>
      <GuideSection id="qsl-marks" eyebrow="Marking" title="Markings">
        <FieldTable
          title="Common DSCP values"
          columns={["Traffic", "DSCP", "Decimal", "CoS"]}
          rows={[
            ["Voice", "EF", "46", "5"],
            ["Interactive video", "AF41", "34", "4"],
            ["Call signalling", "CS3", "24", "3"],
            ["Bulk / scavenger", "CS1", "8", "1"],
            ["Best effort", "default", "0", "0"],
          ]}
        />
      </GuideSection>
      <GuideSection id="qsl-compare" eyebrow="Computed" title="FIFO vs LLQ, computed">
        <FieldTable title={`13 Mb/s offered on 10 Mb/s (full queue ≈ ${FULL_QUEUE_MS} ms)`} columns={["Flow", "Queue", "Mb/s sent", "Loss", "Queuing"]} rows={[...fifo(FLOWS(true)).map(row), ...llq(FLOWS(true)).map(row)]} />
      </GuideSection>
      <GuideSection id="qsl-tools" eyebrow="Tools" title="The QoS toolbox">
        <CompareCards
          items={[
            { title: "Classify & mark", tone: "cyan", tag: "edge", points: ["Identify traffic (ACL, NBAR, DSCP)", "Set DSCP / CoS", "Trust boundary at the phone"] },
            { title: "Queue & schedule", tone: "violet", tag: "congestion", points: ["LLQ: strict priority for voice", "CBWFQ: guarantees per class", "WRED: drop early to avoid tail drop"] },
            { title: "Police & shape", tone: "warning", tag: "rate", points: ["Policing drops or re-marks above a rate", `Shaping buffers: Tc = Bc/CIR = ${tb.tcMs} ms here`, "Shape before an ISP's policer"] },
          ]}
        />
      </GuideSection>
      <GuideSection id="qsl-config" eyebrow="Configure" title="Configure and verify">
        <CliPair
          cisco={{ prompt: "R1(config)#", command: "policy-map WAN-OUT", output: " class VOICE\n  priority 2000\n class VIDEO\n  bandwidth 4000\n class class-default\n  fair-queue\ninterface Serial0/1/0\n service-policy output WAN-OUT\n!\nR1# show policy-map interface Serial0/1/0" }}
          junos={{ prompt: "admin@R1# ", command: "set class-of-service schedulers VOICE priority strict-high", output: "set class-of-service schedulers VIDEO transmit-rate percent 40\nset class-of-service interfaces ge-0/0/1 scheduler-map WAN" }}
        />
      </GuideSection>
      <GuideSection id="qsl-incident" eyebrow="Incident" title="The incident and the fix" tone="danger">
        <TroubleshootingFlow
          steps={[
            { question: "Does the priority class match anything?", look: <Mono>show policy-map interface</Mono> },
            { question: "What DSCP arrives at the router?", look: "A capture or classification counters." },
            { question: "Where was it changed?", look: "The access port's trust setting." },
          ]}
        />
        <p>Fix: trust DSCP on phone ports — conditionally, only when a phone is detected (CDP/LLDP) — so PCs can&apos;t claim EF.</p>
      </GuideSection>
      <GuideSection id="qsl-glossary" eyebrow="Words" title="Glossary">
        <Glossary
          items={[
            { term: "DSCP", def: "6-bit marking in the IP header (EF = 46)." },
            { term: "CoS", def: "3-bit 802.1p priority in the 802.1Q tag." },
            { term: "LLQ", def: "Low-latency queuing: a policed strict-priority queue inside CBWFQ." },
            { term: "Tail drop", def: "Dropping arrivals when the queue is full." },
            { term: "Trust boundary", def: "Where the network starts believing markings." },
          ]}
        />
      </GuideSection>
    </>
  );
}

const QUIZ: KnowledgeQuestion[] = [
  { id: "qsd-q1", prompt: "Why is the LLQ priority queue policed to a limit?", options: [{ id: "starve", label: "So voice can't starve every other class" }, { id: "fast", label: "To make voice faster" }, { id: "isp", label: "Because the ISP requires it" }], correctId: "starve", explanation: "Strict priority would otherwise take the whole link whenever it had traffic." },
  { id: "qsd-q2", prompt: "Voice targets end-to-end: about how much one-way delay?", options: [{ id: "150", label: "150 ms" }, { id: "1500", label: "1.5 s" }, { id: "15", label: "15 ms" }], correctId: "150", explanation: "≤ 150 ms delay, ≤ 30 ms jitter, ≤ 1% loss are the classic voice targets." },
];

export function QosDeepDiveContent() {
  return (
    <>
      <GuideSection id="qsd-budget" eyebrow="Budgets" title="Voice budgets">
        <p>Voice tolerates about 150 ms one-way delay, 30 ms jitter and 1% loss. A full 64-packet queue on 10 Mb/s alone adds {FULL_QUEUE_MS} ms — half the budget — before any WAN latency.</p>
      </GuideSection>
      <GuideSection id="qsd-myths" eyebrow="Misconceptions" title="Misconceptions">
        <Misconceptions items={[{ myth: "QoS adds bandwidth.", correction: "It only decides who gets the bandwidth that exists during congestion." }, { myth: "Mark everything important as EF.", correction: "Then nothing is prioritised; the priority queue overflows its limit and drops." }]} />
      </GuideSection>
      <GuideSection id="qsd-explain" eyebrow="Explain" title="Explain it">
        <ExplainIt items={[{ q: "Why were daytime calls fine?", a: "No backup, no congestion: with offered load below capacity, no queue builds and markings don't matter." }]} />
      </GuideSection>
      <GuideSection id="qsd-quiz" eyebrow="Quiz" title="Check yourself">
        <KnowledgeQuiz questions={QUIZ} />
      </GuideSection>
    </>
  );
}
