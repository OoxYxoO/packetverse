import type { ScenarioStep } from "../../types";
import type { ProcessingStage } from "@/components/network3d/types";
import type { PacketVisual } from "../../types";
import { act, acted, hop, kitBase, layer, packet, q, repairStep, say, stackOf, withDetail, type KitBase } from "./kit";

/**
 * REST APIs & JSON (CCNA 6.5, 6.7). A Python script talks to a network controller's REST API.
 *
 * Modeled — a small working API, not a description of one:
 * - Resources at URIs; verbs map to CRUD: POST create, GET read, PUT replace, PATCH update, DELETE delete.
 * - Token authentication: POST /auth/token returns a token; calls without it get 401.
 * - Request bodies are real JSON text, parsed with JSON.parse: malformed JSON gets 400 with the parser's message.
 * - Status codes by family: 2xx success (200, 201, 204), 4xx client error (400, 401, 404).
 * - PUT replaces the whole resource with the body; PATCH merges only the fields sent.
 */

export type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
export interface Exchange {
  method: Method;
  uri: string;
  auth: boolean;
  body?: string;
  status: number;
  reason: string;
  response?: string;
}
export const TOKEN = "eyJhbGciOi…3f9c";
const DEVICE_SW1: Record<string, Json> = { id: "sw1", hostname: "SW1", role: "access", managementIp: "10.9.10.11", platform: "C9300-48P", description: "Floor 2", monitored: true, interfaces: [{ name: "Gi1/0/1", vlan: 10 }, { name: "Gi1/0/2", vlan: 20 }] };

export interface ApiState extends KitBase {
  token?: string;
  devices: Record<string, Record<string, Json>>;
  vlans: { id: number; name: string }[];
  exchanges: Exchange[];
  /** What the monitoring system sees: devices with a managementIp it can poll. */
  monitoringLost: boolean;
}
export function createApiState(): ApiState {
  return { ...kitBase(), devices: { sw1: { ...DEVICE_SW1 } }, vlans: [{ id: 10, name: "USERS" }, { id: 20, name: "VOICE" }], exchanges: [], monitoringLost: false };
}

const REASON: Record<number, string> = { 200: "OK", 201: "Created", 204: "No Content", 400: "Bad Request", 401: "Unauthorized", 404: "Not Found" };
export const pretty = (j: Json) => JSON.stringify(j, null, 2);
/** Parse a JSON body the way a server would. */
export function parseBody(body: string): { ok: true; value: Json } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(body) as Json };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
/** The JSON type of a value, as the lesson names it. */
export const jsonType = (v: Json): string => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v === "object" ? "object" : typeof v);

/** Handle one request against the state. */
export function handle(s: ApiState, method: Method, uri: string, auth: boolean, body?: string): { state: ApiState; ex: Exchange } {
  const done = (status: number, response?: Json, next: ApiState = s): { state: ApiState; ex: Exchange } => {
    const ex: Exchange = { method, uri, auth, body, status, reason: REASON[status], response: response === undefined ? undefined : pretty(response) };
    return { state: { ...next, exchanges: [...next.exchanges, ex] }, ex };
  };
  if (uri === "/api/v1/auth/token" && method === "POST") return done(200, { token: TOKEN, expiresIn: 3600 }, { ...s, token: TOKEN });
  if (!auth || !s.token) return done(401, { error: "missing or invalid X-Auth-Token" });
  let parsed: Json | undefined;
  if (body !== undefined) {
    const r = parseBody(body);
    if (!r.ok) return done(400, { error: "invalid JSON", detail: r.error });
    parsed = r.value;
  }
  if (uri === "/api/v1/devices" && method === "GET") return done(200, Object.values(s.devices).map((d) => ({ id: d.id, hostname: d.hostname, managementIp: d.managementIp ?? null, monitored: d.monitored ?? false })));
  const dm = uri.match(/^\/api\/v1\/devices\/([a-z0-9]+)$/);
  if (dm) {
    const id = dm[1];
    const cur = s.devices[id];
    if (!cur) return done(404, { error: `device ${id} not found` });
    if (method === "GET") return done(200, cur);
    const obj = (parsed ?? {}) as Record<string, Json>;
    if (method === "PUT") {
      const next = { id, ...obj };
      return done(200, next, { ...s, devices: { ...s.devices, [id]: next } });
    }
    if (method === "PATCH") {
      const next = { ...cur, ...obj };
      return done(200, next, { ...s, devices: { ...s.devices, [id]: next } });
    }
  }
  if (uri === "/api/v1/vlans" && method === "POST") {
    const v = parsed as { id: number; name: string };
    return done(201, { id: v.id, name: v.name, href: `/api/v1/vlans/${v.id}` }, { ...s, vlans: [...s.vlans, { id: v.id, name: v.name }] });
  }
  const vm = uri.match(/^\/api\/v1\/vlans\/(\d+)$/);
  if (vm && method === "DELETE") {
    const id = Number(vm[1]);
    if (!s.vlans.some((v) => v.id === id)) return done(404, { error: `vlan ${id} not found` });
    return done(204, undefined, { ...s, vlans: s.vlans.filter((v) => v.id !== id) });
  }
  return done(404, { error: "no such resource" });
}

const C = { ip: "#60a5fa", http: "#f472b6", json: "#facc15" };
export const ST = {
  api: [{ id: "auth", label: "Check X-Auth-Token" }, { id: "parse", label: "Parse JSON body" }, { id: "route", label: "Route: verb + URI" }, { id: "resp", label: "Status + JSON response" }],
  script: [{ id: "req", label: "Build request" }, { id: "res", label: "Read status + JSON" }],
  mon: [{ id: "poll", label: "Poll devices with a managementIp" }],
} satisfies Record<string, ProcessingStage[]>;

export const API_REPAIR_OPTIONS = [
  { id: "patch", label: "Restore SW1's full record, and send description changes with PATCH (only the changed field)" },
  { id: "post", label: "POST the description to /api/v1/devices" },
  { id: "token", label: "Get a new token and repeat the PUT" },
  { id: "delete", label: "DELETE SW1 and let discovery find it again" },
];
export const API_REPAIR_CORRECT = "patch";

type Step = ScenarioStep<ApiState>;

const reqPacket = (id: string, ex: Exchange): PacketVisual =>
  packet(id, "HTTPS", "SCRIPT", "CTRL", ex.method, `${ex.method} ${ex.uri} → ${ex.status} ${ex.reason}`, [
    layer("HTTP request", C.http, [["Method", ex.method], ["URI", ex.uri], ["X-Auth-Token", ex.auth ? "present" : "missing"], ["Content-Type", ex.body ? "application/json" : "—"]]),
    ...(ex.body ? [layer("JSON body", C.json, [["Text", ex.body.replace(/\s+/g, " ").slice(0, 80)]])] : []),
    layer("HTTP response", C.http, [["Status", `${ex.status} ${ex.reason}`]]),
  ]);

/** One API call as a lesson transition. */
function call(id: string, method: Method, uri: string, auth: boolean, body?: string): (s: ApiState) => ApiState {
  return (s) => {
    const { state, ex } = handle(s, method, uri, auth, body);
    const p = reqPacket(`${id}-p`, ex);
    const stage = ex.status === 401 ? "auth" : ex.status === 400 ? "parse" : "resp";
    const monitoringLost = !state.devices.sw1?.managementIp;
    return {
      ...acted(state, hop({ stepId: id, device: "CTRL", stages: withDetail(ST.api, { auth: ex.auth ? "token valid" : uri.endsWith("/token") ? "credentials (Basic)" : "no token → 401", parse: ex.body ? (ex.status === 400 ? `JSON.parse failed` : "valid JSON") : "no body", route: `${method} ${uri}`, resp: `${ex.status} ${ex.reason}` }), activeStageId: stage, ingressInterfaceId: "443", lookupType: "REST API", lookupKey: `${method} ${uri}`, lookupResult: `${ex.status} ${ex.reason}`, action: `${ex.status}`, reason: ex.status >= 400 ? "4xx means the client's request was wrong; the server is fine." : "2xx means the request succeeded.", input: p.summary, output: ex.response ? ex.response.replace(/\s+/g, " ").slice(0, 120) : "(no body)", nextHopId: "SCRIPT", before: stackOf(p) }), p, `${ex.status} ${ex.reason}`),
      monitoringLost,
    };
  };
}

export const apiSteps: Step[] = [
  say("predict-crud", "Predict: verbs and CRUD", "A REST API exposes resources at URIs — /api/v1/devices, /api/v1/vlans — and you act on them with HTTP verbs. It is stateless: every request carries everything the server needs, including who you are.", {
    question: q("Which verb creates a new VLAN in a collection?", [["post", "POST"], ["get", "GET"], ["put", "PUT"], ["delete", "DELETE"]], "post", "CRUD maps to HTTP: Create = POST, Read = GET, Update = PUT (replace) or PATCH (modify), Delete = DELETE."),
  }),
  act("token", "Authenticate", "The script POSTs its username and password (HTTP Basic, over HTTPS) to /api/v1/auth/token. The controller returns a token, valid for an hour, to send in every later request.", call("token", "POST", "/api/v1/auth/token", false), "PACKET_SENT"),
  say("predict-401", "Predict: forgetting the token", "A colleague's script calls GET /api/v1/devices but never adds the X-Auth-Token header.", {
    question: q("What does the controller return?", [["401", "401 Unauthorized"], ["404", "404 Not Found"], ["200", "200 OK with an empty list"], ["500", "500 Internal Server Error"]], "401", "Without valid credentials the request is refused with 401. (403 Forbidden would mean: you're known, but not allowed.)"),
  }),
  act("noauth", "No token: 401", "The call without the header is refused.", call("noauth", "GET", "/api/v1/devices", false), "PACKET_DROPPED"),
  act("get", "GET the devices", "With the token, GET /api/v1/devices returns 200 and a JSON array — one object per device.", call("get", "GET", "/api/v1/devices", true), "PACKET_SENT"),
  act("get-one", "GET one device", "GET /api/v1/devices/sw1 returns SW1's full record as a JSON object.", call("get-one", "GET", "/api/v1/devices/sw1", true), "PACKET_SENT"),
  say("json", "Reading JSON", "JSON has objects { } of \"key\": value pairs, arrays [ ] of values, and four value types besides those: strings in double quotes, numbers, true/false, and null. Objects and arrays nest.", {
    question: q("In SW1's record, what is the value of \"interfaces\"?", [["arr", "An array of objects"], ["obj", "An object of arrays"], ["str", "A string"], ["num", "A number"]], "arr", "\"interfaces\": [ {…}, {…} ] — square brackets make an array; each element is an object with \"name\" and \"vlan\" keys."),
  }),
  act("post", "POST a VLAN", 'The script POSTs {"id": 30, "name": "CAMERAS"} to /api/v1/vlans. The controller answers 201 Created with the new resource\'s URI.', call("post", "POST", "/api/v1/vlans", true, '{"id": 30, "name": "CAMERAS"}'), "PACKET_SENT"),
  say("predict-400", "Predict: a hand-edited body", "Someone pastes a body from a chat message: {'id': 40, 'name': 'PRINTERS',} — single quotes and a trailing comma.", {
    question: q("What does the controller return?", [["400", "400 Bad Request — it isn't valid JSON"], ["201", "201 Created — servers accept both quote styles"], ["401", "401 Unauthorized"], ["404", "404 Not Found"]], "400", "JSON requires double quotes around keys and strings, and no trailing commas. The server can't parse the body, so it's a client error."),
  }),
  act("bad-json", "Invalid JSON: 400", "The controller's parser rejects the body and says where.", call("bad-json", "POST", "/api/v1/vlans", true, "{'id': 40, 'name': 'PRINTERS',}"), "PACKET_DROPPED"),
  act("delete", "DELETE a resource", "DELETE /api/v1/vlans/30 removes the test VLAN: 204 No Content. Deleting it a second time returns 404 — there's nothing there.", (s) => call("delete", "DELETE", "/api/v1/vlans/30", true)(call("delete-1", "DELETE", "/api/v1/vlans/30", true)(s)), "PACKET_DROPPED"),
  // incident
  act("fault-injected", "A small change", 'An engineer updates SW1\'s description with PUT /api/v1/devices/sw1 and the body {"description": "Floor 2 IDF-B"}. The controller answers 200 OK.', (s) => ({ ...call("fault-injected", "PUT", "/api/v1/devices/sw1", true, '{"description": "Floor 2 IDF-B"}')(s), faultActive: true }), "PACKET_SENT"),
  act("inc-get", "SW1 vanishes from monitoring", "Ten minutes later the monitoring system stops polling SW1. The engineer GETs the record.", call("inc-get", "GET", "/api/v1/devices/sw1", true), "PACKET_SENT"),
  say("trouble-question", "Diagnose", "The record now holds only \"id\" and \"description\". hostname, managementIp, role and interfaces are gone.", {
    question: q("Why did one description change erase the rest of the record?", [["put", "PUT replaces the whole resource with the body — fields not sent are removed"], ["bug", "The controller has a bug"], ["token", "The token expired halfway"], ["json", "The body was invalid JSON"]], "put", "PUT means 'make the resource exactly this'. To change one field, use PATCH, or GET the full object, change it, and PUT the whole thing back.", ["What does PUT mean?", "Which fields were in the body?", "Which verb changes only what you send?"]),
  }),
  say("diagnostic-layers", "Troubleshooting layers", "Read the exchange in order: authentication, the body's validity, the verb's meaning, then the resulting resource."),
  repairStep("repair-challenge", "Repair", "Choose the change that fixes the cause.", API_REPAIR_CORRECT, (s) => {
    const restored = { ...DEVICE_SW1 };
    return { ...s, devices: { ...s.devices, sw1: restored }, monitoringLost: false, decision: { device: "CTRL", text: "PUT full record restored · description via PATCH from now on" } };
  }),
  act("verify", "Proof", 'With the full record restored, PATCH /api/v1/devices/sw1 {"description": "Floor 2 IDF-B"} changes only the description; every other field stays and monitoring keeps polling.', call("verify", "PATCH", "/api/v1/devices/sw1", true, '{"description": "Floor 2 IDF-B"}'), "PACKET_SENT"),
  say("complete", "REST and JSON", "Resources at URIs, verbs for CRUD, tokens for authentication, status codes by family, JSON objects and arrays with double-quoted keys — and PUT replaces while PATCH modifies."),
];
