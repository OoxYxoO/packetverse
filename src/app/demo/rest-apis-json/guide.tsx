import type { BriefingPhaseDef, BriefingStepNote } from "@/components/lesson/briefing";
import { Callout, CompareCards, FieldTable, Glossary, GuideSection, Misconceptions, TroubleshootingFlow } from "@/components/lesson/GuideBlocks";
import { CliPair, CliPanel } from "@/components/lesson/GuideCli";
import { ExplainIt, KnowledgeQuiz, type KnowledgeQuestion } from "@/components/lesson/GuideInteractive";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { createApiState, handle, parseBody } from "@/lib/sim-engine/scenarios/ccna/restApi";

export const API_BRIEFING_PHASES: BriefingPhaseDef[] = [
  { phase: { label: "REST basics", tone: "cyan" }, objective: "Resources, verbs and a token.", steps: ["predict-crud", "token", "predict-401", "noauth"] },
  { phase: { label: "Read JSON", tone: "violet" }, objective: "GET a list and an object; read the types.", steps: ["get", "get-one", "json"] },
  { phase: { label: "Change things", tone: "ip" }, objective: "POST, a broken body, DELETE — and their status codes.", steps: ["post", "predict-400", "bad-json", "delete"] },
  { phase: { label: "Incident", tone: "danger" }, objective: "A one-field change goes wrong.", steps: ["fault-injected", "inc-get"] },
  { phase: { label: "Diagnose", tone: "danger" }, objective: "Diagnosis pending.", steps: ["trouble-question", "diagnostic-layers"] },
  { phase: { label: "Repair pending", tone: "warning" }, objective: "Choose the change that fixes the cause you identified.", steps: ["repair-challenge"] },
  { phase: { label: "Verify", tone: "success" }, objective: "Prove only the description changes.", steps: ["verify"] },
  { phase: { label: "Complete", tone: "success" }, objective: "REST, status codes and JSON.", steps: ["complete"] },
];
export const API_BRIEFING_NOTES: Partial<Record<string, BriefingStepNote>> = {
  token: { takeaway: "Authenticate once; send the token with every call." },
  noauth: { takeaway: "401: who are you? 403: you may not." },
  get: { takeaway: "A collection comes back as a JSON array." },
  "get-one": { takeaway: "One resource comes back as a JSON object." },
  post: { takeaway: "201 Created, with the new resource's URI." },
  "bad-json": { takeaway: "Double quotes, no trailing commas." },
  delete: { takeaway: "204 No Content; then 404 — it's gone." },
  "fault-injected": { doingNow: "A small change goes in." },
  "trouble-question": { doingNow: "Diagnosis pending." },
  "repair-challenge": { doingNow: "Choose the change that fixes the cause you identified." },
  verify: { takeaway: "PATCH changes what you send; PUT replaces everything." },
};

export const API_LESSON_SECTIONS: LessonGuideSectionLink[] = [
  { id: "apl-mission", label: "What this lesson teaches" },
  { id: "apl-crud", label: "Verbs and CRUD" },
  { id: "apl-status", label: "Status codes" },
  { id: "apl-auth", label: "Authentication" },
  { id: "apl-json", label: "JSON, rule by rule" },
  { id: "apl-code", label: "The same call in code" },
  { id: "apl-incident", label: "The incident and the fix" },
  { id: "apl-glossary", label: "Glossary" },
];
export const API_DEEP_SECTIONS: LessonGuideSectionLink[] = [
  { id: "apd-formats", label: "JSON, XML and YAML" },
  { id: "apd-devices", label: "APIs on the devices themselves" },
  { id: "apd-myths", label: "Misconceptions" },
  { id: "apd-explain", label: "Explain it" },
  { id: "apd-quiz", label: "Check yourself" },
];

/** The lesson's own GET of SW1, for the guide. */
function sw1Response() {
  let s = createApiState();
  s = handle(s, "POST", "/api/v1/auth/token", false).state;
  return handle(s, "GET", "/api/v1/devices/sw1", true).ex.response ?? "";
}

export function ApiLessonGuideContent() {
  const bad = parseBody("{'id': 40, 'name': 'PRINTERS',}");
  return (
    <>
      <GuideSection id="apl-mission" eyebrow="Mission" title="What this lesson teaches">
        <p>Talk to a network controller the way scripts do: authenticate, read and change resources with HTTP verbs, read the status code first, and read and write JSON correctly — including the difference between replacing a resource and updating it.</p>
        <Callout tone="violet" title="CCNA 6.5 · 6.7">Characteristics of REST-based APIs (authentication types, CRUD, HTTP verbs, data encoding); recognize components of JSON-encoded data.</Callout>
      </GuideSection>
      <GuideSection id="apl-crud" eyebrow="CRUD" title="Verbs and CRUD">
        <FieldTable
          title="HTTP verbs"
          columns={["CRUD", "Verb", "Example", "Typical success"]}
          rows={[
            ["Create", "POST", "POST /api/v1/vlans", "201 Created"],
            ["Read", "GET", "GET /api/v1/devices", "200 OK"],
            ["Update (replace)", "PUT", "PUT /api/v1/devices/sw1 — the whole object", "200 OK / 204"],
            ["Update (modify)", "PATCH", "PATCH /api/v1/devices/sw1 — only changed fields", "200 OK / 204"],
            ["Delete", "DELETE", "DELETE /api/v1/vlans/30", "204 No Content"],
          ]}
        />
      </GuideSection>
      <GuideSection id="apl-status" eyebrow="Status" title="Status codes">
        <FieldTable
          title="Read the first digit first"
          columns={["Code", "Meaning", "Seen in this lesson"]}
          rows={[
            ["2xx", "Success", "200 OK, 201 Created, 204 No Content"],
            ["3xx", "Redirection", "—"],
            ["4xx", "Client error — fix your request", "400 Bad Request, 401 Unauthorized, 404 Not Found (also 403 Forbidden)"],
            ["5xx", "Server error — not your request", "(500 Internal Server Error, 503 Unavailable)"],
          ]}
        />
      </GuideSection>
      <GuideSection id="apl-auth" eyebrow="Auth" title="Authentication">
        <CompareCards
          items={[
            { title: "HTTP Basic", tone: "warning", tag: "per request", points: ["Username:password, Base64-encoded (not encrypted)", "Only ever over HTTPS"] },
            { title: "Token", tone: "cyan", tag: "this lesson", points: ["Log in once, get a token", "Send it in a header (X-Auth-Token / Authorization: Bearer)", "Expires"] },
            { title: "API key / OAuth", tone: "violet", tag: "apps", points: ["A long-lived key per application", "OAuth: a token issued by an identity provider"] },
          ]}
        />
      </GuideSection>
      <GuideSection id="apl-json" eyebrow="JSON" title="JSON, rule by rule">
        <CliPanel run={{ prompt: "", command: "GET /api/v1/devices/sw1 → 200 OK", output: sw1Response() }} caption="From the lesson's API" />
        <FieldTable
          title="Read it"
          columns={["Piece", "Syntax", "In SW1's record"]}
          rows={[
            ["Object", "{ \"key\": value, … }", "the whole record; each interface"],
            ["Array", "[ value, value ]", "\"interfaces\""],
            ["String", "\"double quotes\"", "\"hostname\": \"SW1\""],
            ["Number", "no quotes", "\"vlan\": 10"],
            ["Boolean / null", "true · false · null", "\"monitored\": true"],
          ]}
        />
        <Callout tone="warning" title="Invalid JSON is rejected">
          {`{'id': 40, 'name': 'PRINTERS',} → ${bad.ok ? "parsed" : bad.error}`}. Keys and strings need double quotes; no trailing commas; no comments.
        </Callout>
      </GuideSection>
      <GuideSection id="apl-code" eyebrow="Code" title="The same call in code">
        <CliPair
          ciscoCaption="Python (requests)"
          cisco={{ prompt: ">>> ", command: "r = requests.post(f\"{BASE}/api/v1/vlans\", headers={\"X-Auth-Token\": token}, json={\"id\": 30, \"name\": \"CAMERAS\"})", output: ">>> r.status_code\n201\n>>> r.json()[\"href\"]\n'/api/v1/vlans/30'" }}
          junosCaption="curl"
          junos={{ prompt: "$ ", command: "curl -s -X POST https://ctrl/api/v1/vlans -H 'X-Auth-Token: …' -H 'Content-Type: application/json' -d '{\"id\": 30, \"name\": \"CAMERAS\"}'", output: "{\"id\": 30, \"name\": \"CAMERAS\", \"href\": \"/api/v1/vlans/30\"}" }}
        />
      </GuideSection>
      <GuideSection id="apl-incident" eyebrow="Incident" title="The incident and the fix" tone="danger">
        <TroubleshootingFlow
          steps={[
            { question: "Did the call succeed?", look: "200 OK — the server did exactly what was asked." },
            { question: "What was asked?", look: "PUT with only \"description\": replace SW1's record with that." },
            { question: "What should it have been?", look: "PATCH with the one field — or GET, modify, PUT the full object." },
          ]}
        />
      </GuideSection>
      <GuideSection id="apl-glossary" eyebrow="Words" title="Glossary">
        <Glossary
          items={[
            { term: "REST", def: "Representational state transfer: resources at URIs, acted on with HTTP verbs; stateless." },
            { term: "URI", def: "The resource's address, e.g. /api/v1/devices/sw1." },
            { term: "Idempotent", def: "Repeating the request has the same effect (GET, PUT, DELETE); POST is not." },
            { term: "Payload", def: "The body of a request or response — usually JSON." },
          ]}
        />
      </GuideSection>
    </>
  );
}

const QUIZ: KnowledgeQuestion[] = [
  { id: "apd-q1", prompt: "Which is valid JSON?", options: [{ id: "a", label: "{\"vlan\": 10, \"name\": \"USERS\"}" }, { id: "b", label: "{vlan: 10, name: 'USERS'}" }, { id: "c", label: "{\"vlan\": 10, \"name\": \"USERS\",}" }], correctId: "a", explanation: "Keys and strings need double quotes; trailing commas are not allowed." },
  { id: "apd-q2", prompt: "A call returns 403. What does that mean?", options: [{ id: "f", label: "You're authenticated but not allowed to do this" }, { id: "u", label: "You didn't authenticate" }, { id: "n", label: "The resource doesn't exist" }], correctId: "f", explanation: "401 = not authenticated; 403 = authenticated but forbidden; 404 = not found." },
  { id: "apd-q3", prompt: "Which verb is NOT idempotent?", options: [{ id: "post", label: "POST" }, { id: "put", label: "PUT" }, { id: "get", label: "GET" }], correctId: "post", explanation: "Two identical POSTs can create two resources; repeating a PUT or GET changes nothing further." },
];

export function ApiDeepDiveContent() {
  return (
    <>
      <GuideSection id="apd-formats" eyebrow="Formats" title="JSON, XML and YAML">
        <FieldTable
          title="The same VLAN three ways"
          columns={["Format", "Looks like", "Where you'll see it"]}
          rows={[
            ["JSON", "{\"vlan\": {\"id\": 30, \"name\": \"CAMERAS\"}}", "REST APIs, RESTCONF"],
            ["XML", "<vlan><id>30</id><name>CAMERAS</name></vlan>", "NETCONF, older APIs"],
            ["YAML", "vlan: ↵ id: 30 ↵ name: CAMERAS (indentation, no braces)", "Ansible playbooks, config files"],
          ]}
        />
      </GuideSection>
      <GuideSection id="apd-devices" eyebrow="Devices" title="APIs on the devices themselves">
        <CliPair
          ciscoCaption="Cisco IOS XE (RESTCONF)"
          cisco={{ prompt: "SW1(config)#", command: "restconf", output: "$ curl -k -u admin https://sw1/restconf/data/Cisco-IOS-XE-native:native/vlan\n(JSON or XML, from YANG models)" }}
          junosCaption="Junos (REST API)"
          junos={{ prompt: "admin@SW1# ", command: "set system services rest http", output: "$ curl -u admin http://sw1:3000/rpc/get-interface-information\n(Junos RPCs over HTTP)" }}
        />
      </GuideSection>
      <GuideSection id="apd-myths" eyebrow="Misconceptions" title="Misconceptions">
        <Misconceptions
          items={[
            { myth: "200 OK means the change was what you wanted.", correction: "It means the server did what you asked. Check the response body." },
            { myth: "PUT and PATCH are interchangeable.", correction: "PUT replaces the whole resource; PATCH modifies only what you send." },
            { myth: "Basic authentication is encrypted.", correction: "It is Base64-encoded only; HTTPS provides the encryption." },
          ]}
        />
      </GuideSection>
      <GuideSection id="apd-explain" eyebrow="Explain" title="Explain it">
        <ExplainIt items={[{ q: "Why did the second DELETE of VLAN 30 return 404 rather than 204?", a: "The first DELETE removed the resource. The second asked for something that no longer exists — a client error, 404 Not Found." }]} />
      </GuideSection>
      <GuideSection id="apd-quiz" eyebrow="Quiz" title="Check yourself">
        <KnowledgeQuiz questions={QUIZ} />
      </GuideSection>
    </>
  );
}
