"use client";

import { FundamentalsLessonShell, type FundamentalsLessonConfig } from "@/components/lesson/FundamentalsLessonShell";
import type { LessonGuideTab } from "@/components/lesson/LessonGuideDialog";
import { kitAdapters, kitCallout, type KitDevice } from "@/components/lesson/ccnaKit";
import { API_REPAIR_CORRECT, API_REPAIR_OPTIONS, ST, apiSteps, createApiState, type ApiState } from "@/lib/sim-engine/scenarios/ccna/restApi";
import { ApiPanel, JsonTypesPanel } from "./ApiPanel";
import { API_BRIEFING_NOTES, API_BRIEFING_PHASES, API_DEEP_SECTIONS, API_LESSON_SECTIONS, ApiDeepDiveContent, ApiLessonGuideContent } from "./guide";

const GUIDE_TABS: LessonGuideTab[] = [
  { id: "lesson", label: "This Lesson", hint: "Verbs · status codes · auth · JSON · PUT vs PATCH", sections: API_LESSON_SECTIONS, content: <ApiLessonGuideContent /> },
  { id: "deep", label: "REST & JSON Deep Dive", hint: "JSON/XML/YAML · device APIs · misconceptions", sections: API_DEEP_SECTIONS, content: <ApiDeepDiveContent /> },
];

const DEVICES: KitDevice<ApiState>[] = [
  { id: "SCRIPT", deviceType: "Python script", role: "Calls the controller's REST API.", stages: ST.script, ports: () => [], knows: (s) => (s.token ? "Holds a token" : "No token yet") },
  {
    id: "CTRL",
    deviceType: "Controller REST API",
    role: "https://ctrl/api/v1 — devices and VLANs as resources.",
    stages: ST.api,
    ports: () => [{ id: "443", neighbor: "SCRIPT", linkType: "HTTPS" }],
    knows: (s) => `${Object.keys(s.devices).length} device · ${s.vlans.length} VLANs`,
    tables: (s) => [
      { title: "VLANs", rows: s.vlans.map((v) => ({ label: String(v.id), value: v.name })) },
      { title: "Device sw1 (keys)", rows: Object.keys(s.devices.sw1 ?? {}).map((k) => ({ label: k, value: JSON.stringify(s.devices.sw1[k]).slice(0, 40) })) },
    ],
  },
  { id: "SW1", deviceType: "Access switch", role: "Managed by the controller.", stages: ST.mon, ports: () => [], knows: (s) => (s.devices.sw1?.managementIp ? `Managed at ${String(s.devices.sw1.managementIp)}` : "Record has no managementIp") },
  { id: "MON", deviceType: "Monitoring system", role: "Polls every device the controller lists with a managementIp.", stages: ST.mon, ports: () => [], knows: (s) => (s.monitoringLost ? "SW1: no address to poll" : "Polling SW1") },
];
const adapters = kitAdapters(DEVICES, "API");

const config: FundamentalsLessonConfig<ApiState> = {
  lessonId: "rest-apis-json",
  xp: 125,
  steps: apiSteps,
  createState: createApiState,
  badge: "CCNA · Automation & Programmability",
  title: "REST APIs & JSON",
  intro: "Drive a network controller the way scripts do. Authenticate, GET devices, POST a VLAN, break a request with invalid JSON and read the status codes that come back — then watch a one-field PUT erase a device record, and fix it with PATCH.",
  facts: [
    { q: "What is a REST API?", a: "Resources at URIs, acted on with HTTP verbs." },
    { q: "What is JSON?", a: "Text data: objects, arrays, strings, numbers, booleans, null." },
    { q: "What is a token?", a: "A credential returned at login, sent with later requests." },
    { q: "What is a status code?", a: "The three-digit result of an HTTP request." },
  ],
  terms: [
    { term: "CRUD", expansion: "Create, read, update, delete", meaning: "POST·GET·PUT/PATCH·DELETE" },
    { term: "URI", expansion: "Uniform resource identifier", meaning: "Resource address" },
    { term: "JSON", expansion: "JavaScript Object Notation", meaning: "Data format" },
    { term: "2xx / 4xx", expansion: "Status families", meaning: "OK / client error" },
    { term: "Token", expansion: "Auth credential", meaning: "Header per call" },
  ],
  guide: { title: "REST APIs & JSON", subtitle: "SCRIPT · controller API · SW1 · monitoring", tabs: GUIDE_TABS },
  briefing: { phases: API_BRIEFING_PHASES, notes: API_BRIEFING_NOTES },
  nodes: (s) => [
    { id: "SCRIPT", label: "SCRIPT", subLabel: "Python", x: 10, y: 40, kind: "laptop" },
    { id: "CTRL", label: "CTRL", subLabel: "/api/v1", x: 46, y: 40, kind: "server" },
    { id: "SW1", label: "SW1", subLabel: s.devices.sw1?.managementIp ? String(s.devices.sw1.managementIp) : "no mgmt IP", x: 84, y: 20, kind: "switch" },
    { id: "MON", label: "MON", subLabel: s.monitoringLost ? "SW1 lost" : "polling", x: 84, y: 70, kind: "server" },
  ],
  edges: (s) => [
    { id: "api", a: "SCRIPT", b: "CTRL", label: "HTTPS 443" },
    { id: "sb", a: "CTRL", b: "SW1" },
    { id: "mon", a: "MON", b: "SW1", label: "poll", down: s.monitoringLost },
  ],
  enterable: ["CTRL"],
  primaryDevice: { "diagnostic-layers": "CTRL", "repair-challenge": "CTRL" },
  ...adapters,
  callout: kitCallout,
  sidePanel: (s) => <ApiPanel s={s} />,
  panels: (s, stepId) => (stepId === "json" || stepId === "trouble-question" ? null : <JsonTypesPanel s={s} />),
  repair: {
    stepId: "repair-challenge",
    prompt: "A PUT with only a description replaced SW1's whole record. Which change fixes the cause?",
    options: API_REPAIR_OPTIONS,
    correctId: API_REPAIR_CORRECT,
    success: "SW1's full record is back, and the description now goes in with PATCH — only that field changes.",
    wrongFeedback: {
      post: "POST to the collection creates a new device; it doesn't update SW1.",
      token: "The token was fine — the call returned 200. Repeating the PUT repeats the damage.",
      delete: "Deleting the record loses its history and leaves SW1 unmanaged until rediscovered.",
    },
    attempt: (s) => s.repairAttempt,
  },
  diagnostics: {
    fromStepId: "diagnostic-layers",
    layers: (s) => {
      const keys = Object.keys(s.devices.sw1 ?? {});
      return [
        { label: "Authentication — token valid (200, not 401)", status: "healthy" },
        { label: "Body — valid JSON (200, not 400)", status: "healthy" },
        { label: "Verb — PUT replaces the whole resource", status: keys.length > 2 ? "healthy" : "failing" },
        { label: `Resource — sw1 has ${keys.length} keys`, status: keys.length > 2 ? "healthy" : "failing" },
      ];
    },
  },
  complete: { badge: "Lesson Complete", title: "You speak REST", message: "Token authentication, CRUD verbs, status codes by family, JSON objects and arrays with their types — and the difference between PUT and PATCH." },
};

export default function RestApisJsonDemo() {
  return <FundamentalsLessonShell config={config} />;
}
