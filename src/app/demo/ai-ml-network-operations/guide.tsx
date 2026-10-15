import type { BriefingPhaseDef, BriefingStepNote } from "@/components/lesson/briefing";
import { Callout, CompareCards, FieldTable, Glossary, GuideSection, Misconceptions, TroubleshootingFlow } from "@/components/lesson/GuideBlocks";
import { CliPanel } from "@/components/lesson/GuideCli";
import { ExplainIt, KnowledgeQuiz, type KnowledgeQuestion } from "@/components/lesson/GuideInteractive";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { BASE, DRAFT, FIT, FIXED, SPIKE_MS, STATIC_THRESHOLD_MS, WEEKS, runTests, weeksUntil, zOf } from "@/lib/sim-engine/scenarios/ccna/aiOps";
import { aceText } from "@/lib/sim-engine/scenarios/ccna/acl";

export const AI_BRIEFING_PHASES: BriefingPhaseDef[] = [
  { phase: { label: "Two kinds of AI", tone: "cyan" }, objective: "Predictive versus generative.", steps: ["intro"] },
  { phase: { label: "Predictive", tone: "violet" }, objective: "A learned baseline, an anomaly, a forecast.", steps: ["baseline", "predict-anomaly", "anomaly", "learning", "forecast"] },
  { phase: { label: "Generative", tone: "ip" }, objective: "A configuration drafted in seconds.", steps: ["genai"] },
  { phase: { label: "Incident", tone: "danger" }, objective: "An unreviewed draft goes live.", steps: ["fault-injected", "inc-test"] },
  { phase: { label: "Diagnose", tone: "danger" }, objective: "Diagnosis pending.", steps: ["trouble-question", "diagnostic-layers"] },
  { phase: { label: "Repair pending", tone: "warning" }, objective: "Choose the change that fixes the cause you identified.", steps: ["repair-challenge"] },
  { phase: { label: "Verify", tone: "success" }, objective: "Prove the corrected draft does what was asked.", steps: ["verify"] },
  { phase: { label: "Complete", tone: "success" }, objective: "AI assists; engineers verify.", steps: ["complete"] },
];
export const AI_BRIEFING_NOTES: Partial<Record<string, BriefingStepNote>> = {
  baseline: { takeaway: "Learn normal from the data." },
  anomaly: { takeaway: "Unusual for this link, not just above a number." },
  forecast: { takeaway: "History becomes a date for the upgrade." },
  genai: { takeaway: "Plausible text is not verified configuration." },
  "fault-injected": { doingNow: "A change goes in quickly." },
  "trouble-question": { doingNow: "Diagnosis pending." },
  "repair-challenge": { doingNow: "Choose the change that fixes the cause you identified." },
  verify: { takeaway: "Review and test every draft before it touches the network." },
};

export const AI_LESSON_SECTIONS: LessonGuideSectionLink[] = [
  { id: "ail-mission", label: "What this lesson teaches" },
  { id: "ail-kinds", label: "Predictive vs generative" },
  { id: "ail-baseline", label: "Baselines and anomalies" },
  { id: "ail-forecast", label: "Forecasting capacity" },
  { id: "ail-draft", label: "Reviewing a generated draft" },
  { id: "ail-incident", label: "The incident and the fix" },
  { id: "ail-glossary", label: "Glossary" },
];
export const AI_DEEP_SECTIONS: LessonGuideSectionLink[] = [
  { id: "aid-uses", label: "Where AI shows up in operations" },
  { id: "aid-risks", label: "Risks and guardrails" },
  { id: "aid-myths", label: "Misconceptions" },
  { id: "aid-explain", label: "Explain it" },
  { id: "aid-quiz", label: "Check yourself" },
];

export function AiLessonGuideContent() {
  const draftTests = runTests(DRAFT);
  return (
    <>
      <GuideSection id="ail-mission" eyebrow="Mission" title="What this lesson teaches">
        <p>What machine learning sees in network telemetry that fixed thresholds miss, how forecasting turns history into planning — and how to use generative AI for drafts without letting an unverified answer reach a router.</p>
        <Callout tone="violet" title="CCNA 6.4">Explain AI (generative and predictive) and machine learning in network operations.</Callout>
      </GuideSection>
      <GuideSection id="ail-kinds" eyebrow="Kinds" title="Predictive vs generative">
        <CompareCards
          items={[
            { title: "Predictive AI / ML", tone: "cyan", tag: "learn from data", points: ["Baselines and anomaly detection", "Traffic classification", "Capacity and failure forecasting"] },
            { title: "Generative AI", tone: "violet", tag: "produce content", points: ["Draft configs, scripts, documentation", "Summarize logs and incidents", "Answer questions in natural language"] },
          ]}
        />
        <FieldTable
          title="Machine learning styles"
          columns={["Style", "Learns from", "Network example"]}
          rows={[
            ["Supervised", "Labeled examples", "Classify flows as video / backup / malware"],
            ["Unsupervised", "Unlabeled data", "Latency baselines, device clustering, outliers"],
          ]}
        />
      </GuideSection>
      <GuideSection id="ail-baseline" eyebrow="Anomaly" title="Baselines and anomalies">
        <FieldTable
          title="From the lesson's model"
          columns={["", "Value"]}
          rows={[
            ["Learned baseline", `${BASE.mean} ms ± ${BASE.sd} ms (288 samples)`],
            ["New sample", `${SPIKE_MS} ms`],
            ["z-score", `(${SPIKE_MS} − ${BASE.mean}) / ${BASE.sd} = ${zOf(SPIKE_MS)} → anomaly (> 3)`],
            ["Fixed threshold", `${STATIC_THRESHOLD_MS} ms → silent`],
          ]}
        />
      </GuideSection>
      <GuideSection id="ail-forecast" eyebrow="Forecast" title="Forecasting capacity">
        <p>
          Weekly peaks {WEEKS.join(", ")}%. Least squares: utilization ≈ {FIT.intercept} + {FIT.slope} × week. 80% is reached in about {weeksUntil(80)} weeks; 100% in about {weeksUntil(100)}.
        </p>
      </GuideSection>
      <GuideSection id="ail-draft" eyebrow="Review" title="Reviewing a generated draft">
        <CliPanel caption="The assistant's draft" run={{ prompt: "", command: "ip access-list extended GUEST-IN", output: DRAFT.aces.map((e) => ` ${aceText(e)}`).join("\n") }} />
        <FieldTable title="Tested against the intended flows" columns={["Flow", "Expected", "Got"]} rows={draftTests.map((t) => [t.flow.label, t.expect, `${t.got} (${t.line === "implicit" ? "implicit deny" : `line ${t.line}`})`])} />
        <Callout tone="warning" title="Right for the wrong reason">The database test &lsquo;passes&rsquo; only because nothing matched at all. Test what should be allowed, not just what should be blocked.</Callout>
        <CliPanel caption="Corrected" run={{ prompt: "", command: "ip access-list extended GUEST-IN", output: FIXED.aces.map((e) => ` ${aceText(e)}`).join("\n") }} />
      </GuideSection>
      <GuideSection id="ail-incident" eyebrow="Incident" title="The incident and the fix" tone="danger">
        <TroubleshootingFlow
          steps={[
            { question: "Which line matches a guest?", look: "None — the implicit deny drops it." },
            { question: "Why?", look: "255.255.255.0 in a source wildcard means 'last octet must be 0'." },
            { question: "Why wasn't it caught?", look: "The draft went live without review or tests." },
          ]}
        />
      </GuideSection>
      <GuideSection id="ail-glossary" eyebrow="Words" title="Glossary">
        <Glossary
          items={[
            { term: "Baseline", def: "What normal looks like for this metric, learned from history." },
            { term: "z-score", def: "How many standard deviations a value is from the mean." },
            { term: "Telemetry", def: "Streamed operational data (counters, latency, logs) from devices." },
            { term: "Hallucination", def: "A generative model's confident but wrong output." },
            { term: "Human in the loop", def: "An engineer approves AI output before it acts." },
          ]}
        />
      </GuideSection>
    </>
  );
}

const QUIZ: KnowledgeQuestion[] = [
  { id: "aid-q1", prompt: "An analytics tool flags a switch whose CPU pattern differs from its peers, without labels. Which learning style?", options: [{ id: "u", label: "Unsupervised" }, { id: "s", label: "Supervised" }, { id: "g", label: "Generative" }], correctId: "u", explanation: "No labels, a learned notion of normal — unsupervised anomaly detection." },
  { id: "aid-q2", prompt: "Which task suits generative AI best?", options: [{ id: "d", label: "Drafting a change summary from a ticket's logs" }, { id: "f", label: "Forecasting link utilization" }, { id: "c", label: "Classifying flows by application" }], correctId: "d", explanation: "Producing text is generative; forecasting and classification are predictive." },
  { id: "aid-q3", prompt: "What must happen before an AI-drafted configuration is applied?", options: [{ id: "r", label: "Human review and testing against the intended behaviour" }, { id: "n", label: "Nothing, if the AI sounded confident" }, { id: "t", label: "Asking the AI whether it is sure" }], correctId: "r", explanation: "Confidence is not correctness. Review and test, as with any change." },
];

export function AiDeepDiveContent() {
  return (
    <>
      <GuideSection id="aid-uses" eyebrow="Uses" title="Where AI shows up in operations">
        <FieldTable
          title="Common uses"
          columns={["Use", "Kind"]}
          rows={[
            ["Wi-Fi assurance: 'why is this client's experience poor?'", "Predictive + natural-language answers"],
            ["Anomaly detection on latency, errors, traffic", "Predictive (unsupervised)"],
            ["Capacity and hardware-failure forecasts", "Predictive"],
            ["Chat assistants that summarize incidents or draft configs", "Generative"],
          ]}
        />
        <p>Vendors build these into their platforms — Juniper Mist&apos;s Marvis, Cisco&apos;s AI assistants in Catalyst Center and Meraki, and others — but the concepts are the same everywhere.</p>
      </GuideSection>
      <GuideSection id="aid-risks" eyebrow="Guardrails" title="Risks and guardrails">
        <Misconceptions
          items={[
            { myth: "Data can go anywhere.", correction: "Configs and logs contain addresses and secrets; know where a prompt is sent and stored." },
            { myth: "A model's output is deterministic.", correction: "Ask twice, get two answers. Version and review what you deploy." },
          ]}
        />
      </GuideSection>
      <GuideSection id="aid-myths" eyebrow="Misconceptions" title="Misconceptions">
        <Misconceptions
          items={[
            { myth: "AI will replace understanding.", correction: "You caught the wildcard error because you know what a wildcard is." },
            { myth: "A fixed threshold is good enough.", correction: "31 ms is fine for one link and alarming for another; baselines adapt." },
          ]}
        />
      </GuideSection>
      <GuideSection id="aid-explain" eyebrow="Explain" title="Explain it">
        <ExplainIt items={[{ q: "Why is 'ask the AI to regenerate' not a fix?", a: "It may produce a different answer, right or wrong. The fix is a verified configuration and a process that verifies every draft." }]} />
      </GuideSection>
      <GuideSection id="aid-quiz" eyebrow="Quiz" title="Check yourself">
        <KnowledgeQuiz questions={QUIZ} />
      </GuideSection>
    </>
  );
}
