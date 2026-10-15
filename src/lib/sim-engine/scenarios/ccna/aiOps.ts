import type { PacketVisual, ScenarioStep } from "../../types";
import type { ProcessingStage } from "@/components/network3d/types";
import { act, acted, hop, kitBase, layer, packet, q, repairStep, say, stackOf, withDetail, type KitBase } from "./kit";
import { evaluate, aceText, wildcardOf, type Acl, type Flow } from "./acl";

/**
 * AI & Machine Learning in Network Operations (CCNA 6.4). An operations team's analytics platform watches telemetry;
 * an AI assistant drafts configuration.
 *
 * Modeled (computed):
 * - A learned baseline: mean and standard deviation of a day of 5-minute latency samples; z = (x − mean) / σ, and an
 *   anomaly when |z| > 3 — compared with a fixed threshold.
 * - A forecast: least-squares line through 12 weeks of peak utilization, and the weeks until it crosses 80%.
 * - Generative drafts are text: the drafted ACL is evaluated by the same first-match engine as the ACL lesson, against
 *   the flows it is meant to allow and block.
 */

/** 288 five-minute latency samples (ms): a daily rhythm around 20 ms. */
export const SAMPLES = Array.from({ length: 288 }, (_, i) => Math.round((20 + 1.6 * Math.sin((i / 288) * 2 * Math.PI) + 0.6 * Math.sin(i * 1.7)) * 10) / 10);
export const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
export const stdev = (xs: number[]) => {
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / xs.length);
};
export const BASE = { mean: Math.round(mean(SAMPLES) * 10) / 10, sd: Math.round(stdev(SAMPLES) * 100) / 100 };
export const STATIC_THRESHOLD_MS = 100;
export const SPIKE_MS = 31;
export const zOf = (x: number) => Math.round(((x - BASE.mean) / BASE.sd) * 10) / 10;

/** 12 weeks of peak utilization on the internet link (%). */
export const WEEKS = [41, 43, 44, 47, 48, 50, 53, 54, 56, 58, 61, 62];
export function linearFit(ys: number[]) {
  const xs = ys.map((_, i) => i + 1);
  const mx = mean(xs);
  const my = mean(ys);
  const slope = xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0) / xs.reduce((a, x) => a + (x - mx) ** 2, 0);
  return { slope: Math.round(slope * 100) / 100, intercept: Math.round((my - slope * mx) * 100) / 100 };
}
export const FIT = linearFit(WEEKS);
/** Weeks from now (week 12) until the fitted line reaches `pct`. */
export const weeksUntil = (pct: number) => Math.ceil((pct - FIT.intercept) / FIT.slope - WEEKS.length);

/** The assistant's draft (with a subnet mask where a wildcard belongs) and the corrected ACL. */
export const DRAFT: Acl = {
  name: "GUEST-IN",
  kind: "extended",
  aces: [
    { seq: 10, action: "permit", proto: "tcp", src: ["10.1.20.0", "255.255.255.0"], dst: ["10.1.50.10", "0.0.0.0"], port: 443 },
    { seq: 20, action: "deny", proto: "ip", src: ["10.1.20.0", "255.255.255.0"], dst: ["10.1.50.0", "0.0.0.255"] },
    { seq: 30, action: "permit", proto: "ip", src: ["10.1.20.0", "255.255.255.0"], dst: ["0.0.0.0", "255.255.255.255"] },
  ],
};
export const FIXED: Acl = { ...DRAFT, aces: DRAFT.aces.map((e) => ({ ...e, src: ["10.1.20.0", wildcardOf(24)] as [string, string] })) };
export const TESTS: { flow: Flow; expect: "permit" | "deny" }[] = [
  { flow: { id: "w", label: "Guest → WEB HTTPS", proto: "tcp", src: "10.1.20.33", dst: "10.1.50.10", port: 443 }, expect: "permit" },
  { flow: { id: "d", label: "Guest → DB SQL", proto: "tcp", src: "10.1.20.33", dst: "10.1.50.20", port: 1433 }, expect: "deny" },
  { flow: { id: "i", label: "Guest → internet", proto: "tcp", src: "10.1.20.33", dst: "142.250.80.46", port: 443 }, expect: "permit" },
];
export const runTests = (acl: Acl) => TESTS.map((t) => ({ ...t, got: evaluate(acl, t.flow).action, line: evaluate(acl, t.flow).seq }));

export interface AiState extends KitBase {
  baseline: boolean;
  anomaly?: { x: number; z: number; staticFired: boolean };
  forecast: boolean;
  draft?: Acl;
  applied?: Acl;
  tests?: ReturnType<typeof runTests>;
  validated: boolean;
}
export function createAiState(): AiState {
  return { ...kitBase(), baseline: false, forecast: false, validated: false };
}

const C = { tel: "#22d3ee", app: "#f472b6", txt: "#facc15" };
export const ST = {
  ana: [{ id: "ingest", label: "Ingest telemetry" }, { id: "learn", label: "Learn baseline / fit trend" }, { id: "score", label: "Score new data" }, { id: "alert", label: "Alert with evidence" }],
  gen: [{ id: "prompt", label: "Prompt" }, { id: "draft", label: "Generate text" }],
  r1: [{ id: "cfg", label: "Configuration" }, { id: "acl", label: "ACL GUEST-IN" }, { id: "fwd", label: "Forward / drop" }],
  eng: [{ id: "review", label: "Review + test" }],
} satisfies Record<string, ProcessingStage[]>;

export const AI_REPAIR_OPTIONS = [
  { id: "validate", label: "Correct the source to wildcard 0.0.0.255, and require every AI draft to pass review and the intended test flows before deployment" },
  { id: "regen", label: "Ask the assistant to regenerate the ACL and paste the new answer" },
  { id: "anyany", label: "Add 'permit ip any any' at the top" },
  { id: "noacl", label: "Remove GUEST-IN from Gi0/1" },
];
export const AI_REPAIR_CORRECT = "validate";

type Step = ScenarioStep<AiState>;
const telem = (id: string, summary: string, fields: [string, string][]): PacketVisual => packet(id, "IP", "WAN-R", "AIOPS", "Telemetry", summary, [layer("Streaming telemetry", C.tel, fields)]);

export const aiSteps: Step[] = [
  say("intro", "Two kinds of AI", "Predictive AI and machine learning learn patterns from past data and use them to classify, score or predict new data. Generative AI produces new content — text, summaries, code — from a prompt. Operations teams use both, for different jobs.", {
    question: q("One tool writes a change summary for a ticket; another flags a router whose memory use is creeping up unlike its peers. Which is which?", [["gp", "The summary is generative; the flagging is predictive"], ["pg", "The summary is predictive; the flagging is generative"], ["gg", "Both are generative"], ["pp", "Both are predictive"]], "gp", "Writing new text from a request is generative. Learning what normal looks like and scoring new data against it is predictive (machine learning)."),
  }),
  act("baseline", "Learn a baseline", `The analytics platform ingests a day of 5-minute latency samples from the WAN router (${SAMPLES.length} of them) and learns what normal looks like: mean ${BASE.mean} ms, standard deviation ${BASE.sd} ms.`, (s) => {
    const p = telem("base-p", `Telemetry · ${SAMPLES.length} latency samples`, [["Metric", "WAN latency (ms)"], ["Interval", "5 min"], ["Learned", `mean ${BASE.mean} · σ ${BASE.sd}`]]);
    return acted({ ...s, baseline: true }, hop({ stepId: "baseline", device: "AIOPS", stages: withDetail(ST.ana, { ingest: `${SAMPLES.length} samples`, learn: `mean ${BASE.mean} ms · σ ${BASE.sd} ms` }), activeStageId: "learn", ingressInterfaceId: "telemetry", lookupType: "Baseline", lookupKey: "WAN latency", lookupResult: `${BASE.mean} ± ${BASE.sd} ms`, action: "LEARN", reason: "The model learns normal from the data itself instead of a number someone guessed.", input: p.summary, output: "baseline stored", before: stackOf(p) }), p, `baseline ${BASE.mean} ± ${BASE.sd} ms`);
  }, "PACKET_SENT"),
  say("predict-anomaly", "Predict: 31 milliseconds", `At 14:05 the WAN latency reads ${SPIKE_MS} ms. The old monitoring alarm fires at a fixed ${STATIC_THRESHOLD_MS} ms.`, {
    question: q("Which system raises an alert?", [["ml", `Only the learned baseline — ${SPIKE_MS} ms is far outside normal but under ${STATIC_THRESHOLD_MS} ms`], ["static", "Only the fixed threshold"], ["both", "Both"], ["none", "Neither — 31 ms is fast"]], "ml", `z = (${SPIKE_MS} − ${BASE.mean}) / ${BASE.sd} ≈ ${zOf(SPIKE_MS)} standard deviations — a clear anomaly for this link — while ${SPIKE_MS} < ${STATIC_THRESHOLD_MS} keeps the fixed alarm silent.`),
  }),
  act("anomaly", "An anomaly, scored", `z = (${SPIKE_MS} − ${BASE.mean}) / ${BASE.sd} ≈ ${zOf(SPIKE_MS)}. Anything beyond 3σ is flagged. The alert arrives with evidence: the provider rerouted the circuit — users would only have noticed as slower video calls.`, (s) => {
    const z = zOf(SPIKE_MS);
    const p = telem("anom-p", `Telemetry · 14:05 latency ${SPIKE_MS} ms`, [["Value", `${SPIKE_MS} ms`], ["z-score", String(z)], ["Fixed threshold", `${STATIC_THRESHOLD_MS} ms — not crossed`]]);
    return acted({ ...s, anomaly: { x: SPIKE_MS, z, staticFired: SPIKE_MS > STATIC_THRESHOLD_MS } }, hop({ stepId: "anomaly", device: "AIOPS", stages: withDetail(ST.ana, { score: `z = ${z}`, alert: "anomaly: WAN latency +55% · path change detected" }), activeStageId: "score", ingressInterfaceId: "telemetry", lookupType: "Anomaly score", lookupKey: `${SPIKE_MS} ms`, lookupResult: `z ${z} > 3 → anomaly`, action: "ALERT", reason: "A learned baseline catches 'unusual for this link', which no single fixed threshold can do for every link.", input: p.summary, output: "ticket opened with evidence", before: stackOf(p) }), p, `anomaly z=${z}`);
  }, "PACKET_SENT"),
  say("learning", "How models learn", "Supervised learning trains on labeled examples (thousands of flows tagged 'video', 'backup', 'malware') and then classifies new ones. Unsupervised learning finds structure without labels — clusters, baselines, outliers — like the latency baseline you just saw.", {
    question: q("A model groups devices by behaviour without being told any categories. Which kind of learning?", [["un", "Unsupervised"], ["sup", "Supervised"], ["gen", "Generative"], ["rule", "Rule-based"]], "un", "No labels were given, so it is unsupervised: it discovers the groups itself."),
  }),
  act("forecast", "A forecast", `Twelve weeks of peak utilization on the internet link: ${WEEKS[0]}% → ${WEEKS[WEEKS.length - 1]}%. A least-squares line grows ${FIT.slope}% a week, crossing 80% in about ${weeksUntil(80)} weeks — time to order the upgrade before users feel it.`, (s) => {
    const p = telem("fc-p", "Telemetry · 12 weeks of peak utilization", [["Data", WEEKS.join(", ")], ["Fit", `${FIT.slope}%/week`], ["80% reached", `in ~${weeksUntil(80)} weeks`]]);
    return acted({ ...s, forecast: true }, hop({ stepId: "forecast", device: "AIOPS", stages: withDetail(ST.ana, { learn: `y = ${FIT.intercept} + ${FIT.slope}·week`, alert: `80% in ~${weeksUntil(80)} weeks` }), activeStageId: "learn", ingressInterfaceId: "telemetry", lookupType: "Trend", lookupKey: "internet link peak %", lookupResult: `+${FIT.slope}%/week · 80% in ~${weeksUntil(80)} weeks`, action: "PREDICT", reason: "Predictive analytics turns history into a date, so capacity is planned rather than discovered.", input: p.summary, output: "capacity ticket" }), p, `80% in ~${weeksUntil(80)} weeks`);
  }, "STEP_ENTERED"),
  act("genai", "Generative AI drafts a change", "An engineer asks the team's AI assistant: 'Write an IOS ACL for guests (10.1.20.0/24): HTTPS to 10.1.50.10 only in the server LAN, internet allowed.' It replies in seconds with three confident lines.", (s) => {
    const p = packet("gen-p", "HTTPS", "ENG", "GENAI", "Prompt", "Prompt → AI assistant · draft ACL GUEST-IN", [layer("Response (text)", C.txt, DRAFT.aces.map((e) => [`line ${e.seq}`, aceText(e).replace(/^\d+ /, "")] as [string, string]))]);
    return acted({ ...s, draft: DRAFT }, hop({ stepId: "genai", device: "GENAI", stages: withDetail(ST.gen, { draft: `${DRAFT.aces.length} lines` }), activeStageId: "draft", lookupType: "Generation", lookupKey: "prompt", lookupResult: "draft ACL (unverified)", action: "DRAFT", reason: "Generative models produce plausible text. Plausible is not the same as correct.", input: p.summary, output: "draft returned to engineer", nextHopId: "ENG", before: stackOf(p) }), p, "draft ready");
  }, "PACKET_SENT"),
  // incident
  act("fault-injected", "Straight to production", "It's late; the draft looks right. The engineer pastes it onto R1 and applies GUEST-IN inbound on Gi0/1.", (s) => ({ ...s, applied: s.draft, faultActive: true, packet: undefined, flood: [], decision: { device: "R1", text: "ip access-group GUEST-IN in (AI draft, unreviewed)" } }), "STEP_ENTERED"),
  act("inc-test", "Guests lose the web server", "The help desk fills with guests who can't reach the web server. The engineer runs the three intended flows against GUEST-IN.", (s) => {
    const tests = runTests(s.applied!);
    const w = tests[0];
    const p = packet("t-p", "TCP", "GUEST", "R1", "TCP 443", `${w.flow.label} · ${w.flow.src} → ${w.flow.dst}:443`, [layer("Flow", C.app, [["Source", w.flow.src], ["Destination", `${w.flow.dst}:443`], ["Result", `${w.got} (${w.line === "implicit" ? "implicit deny" : `line ${w.line}`})`]])]);
    return acted({ ...s, tests }, hop({ stepId: "inc-test", device: "R1", stages: withDetail(ST.r1, { acl: tests.map((t) => `${t.flow.label}: ${t.got} (expected ${t.expect})`).join(" · ") }), activeStageId: "acl", ingressInterfaceId: "Gi0/1", lookupType: "ACL GUEST-IN", lookupKey: `${w.flow.src} → ${w.flow.dst}:443`, lookupResult: `${w.got} via ${w.line === "implicit" ? "implicit deny" : `line ${w.line}`}`, action: w.got.toUpperCase(), reason: "No line matched the guest's address, so the implicit deny dropped it.", input: p.summary, output: w.got === "permit" ? "forwarded" : "dropped", before: stackOf(p) }), p, `${tests.filter((t) => t.got !== t.expect).length} of ${tests.length} tests fail`);
  }, "PACKET_DROPPED"),
  say("trouble-question", "Diagnose", "Every line's source is written '10.1.20.0 255.255.255.0'. A guest at 10.1.20.33 matches none of them.", {
    question: q("What is wrong with the draft?", [["mask", "It uses a subnet mask where IOS expects a wildcard — 255.255.255.0 means 'last octet must be 0', so only x.x.x.0 matches"], ["order", "The lines are in the wrong order"], ["dir", "It should be applied outbound"], ["port", "HTTPS is port 8443"]], "mask", "In a wildcard, 0 bits must match and 1 bits are ignored. 255.255.255.0 ignores the first three octets and requires the last to be 0. The guest subnet needs 0.0.0.255. The AI's text was plausible and wrong; only a test or a careful review catches it.", ["What does a 1 bit mean in a wildcard?", "Which addresses does 10.1.20.0 255.255.255.0 match?", "Was the draft tested before it was applied?"]),
  }),
  say("diagnostic-layers", "Troubleshooting layers", "Check the request, the draft, the review and test that should have happened, then the device's behaviour."),
  repairStep("repair-challenge", "Repair", "Choose the change that fixes the cause.", AI_REPAIR_CORRECT, (s) => ({ ...s, applied: FIXED, validated: true, decision: { device: "ENG", text: "wildcards fixed · draft must pass review + flow tests" } })),
  act("verify", "Proof", "The corrected ACL passes all three intended flows before it goes on R1: guests reach the web server and the internet; the database stays blocked.", (s) => {
    const tests = runTests(s.applied!);
    return acted({ ...s, tests }, hop({ stepId: "verify", device: "ENG", stages: withDetail(ST.eng, { review: tests.map((t) => `${t.flow.label}: ${t.got}`).join(" · ") }), activeStageId: "review", lookupType: "Validation", lookupKey: "3 intended flows", lookupResult: `${tests.filter((t) => t.got === t.expect).length}/${tests.length} pass`, action: "APPROVED", reason: "AI speeds up the draft; the engineer still owns the verification.", input: "corrected ACL", output: "deployed to R1" }), undefined, `${tests.filter((t) => t.got === t.expect).length}/${tests.length} tests pass`);
  }, "STEP_ENTERED"),
  say("complete", "AI in network operations", "Predictive AI and ML learn baselines, score anomalies, classify traffic and forecast capacity; generative AI drafts text and configuration quickly — and an engineer reviews and tests every draft before it touches the network."),
];
