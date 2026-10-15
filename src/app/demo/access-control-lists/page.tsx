"use client";

import { FundamentalsLessonShell, type FundamentalsLessonConfig } from "@/components/lesson/FundamentalsLessonShell";
import type { LessonGuideTab } from "@/components/lesson/LessonGuideDialog";
import { kitAdapters, kitCallout, type KitDevice } from "@/components/lesson/ccnaKit";
import { ACL_REPAIR_CORRECT, ACL_REPAIR_OPTIONS, ST, aceText, aclSteps, createAclState, type AclState } from "@/lib/sim-engine/scenarios/ccna/acl";
import { AclPanel } from "./AclPanel";
import { ACL_BRIEFING_NOTES, ACL_BRIEFING_PHASES, ACL_DEEP_SECTIONS, ACL_LESSON_SECTIONS, AclDeepDiveContent, AclLessonGuideContent } from "./guide";

const GUIDE_TABS: LessonGuideTab[] = [
  { id: "lesson", label: "This Lesson", hint: "First match · wildcards · placement · a shadowed line", sections: ACL_LESSON_SECTIONS, content: <AclLessonGuideContent /> },
  { id: "deep", label: "ACL Deep Dive", hint: "Other uses · other vendors · misconceptions", sections: ACL_DEEP_SECTIONS, content: <AclDeepDiveContent /> },
];

const host = (id: string, deviceType: string, role: string, ip: string): KitDevice<AclState> => ({ id, deviceType, role, stages: ST.host, ports: () => [{ id: "eth0", neighbor: "R1", linkType: ip }], knows: () => ip });
const DEVICES: KitDevice<AclState>[] = [
  host("STAFF", "Staff PC", "Staff LAN — unrestricted.", "10.1.10.15/24"),
  host("GUEST", "Guest laptop", "Guest LAN — internet and WEB only.", "10.1.20.33/24"),
  host("WEB", "Web server", "HTTPS for staff and guests.", "10.1.50.10/24"),
  host("DB", "Database", "Staff only.", "10.1.50.20/24"),
  host("PORTAL", "Print portal", "New — guests should reach it over HTTPS.", "10.1.50.30/24"),
  host("NET", "Internet", "Any outside site.", "via Gi0/3"),
  {
    id: "R1",
    deviceType: "Router",
    role: "Routes between the staff, guest and server LANs and the internet.",
    stages: ST.r1,
    ports: (s) =>
      [
        ["Gi0/0", "STAFF", "10.1.10.1/24"],
        ["Gi0/1", "GUEST", "10.1.20.1/24"],
        ["Gi0/2", "WEB", "10.1.50.1/24"],
        ["Gi0/3", "NET", "internet"],
      ].map(([id, n, ipa]) => ({ id, neighbor: n, linkType: ipa, extra: s.applied?.iface === id ? ([["ACL", `${s.applied.acl.name} ${s.applied.dir}`]] as [string, string][]) : undefined })),
    knows: (s) => (s.applied ? `${s.applied.acl.name} ${s.applied.dir} on ${s.applied.iface}` : "No ACL applied"),
    tables: (s) => (s.applied ? [{ title: `ACL ${s.applied.acl.name}`, rows: [...s.applied.acl.aces].sort((a, b) => a.seq - b.seq).map((e) => ({ label: `${e.seq}`, value: `${aceText(e).replace(/^\d+ /, "")} · ${s.hits[`${s.applied!.acl.name}:${e.seq}`] ?? 0} matches` })) }] : []),
  },
];
const adapters = kitAdapters(DEVICES, "packet filter");

const config: FundamentalsLessonConfig<AclState> = {
  lessonId: "access-control-lists",
  xp: 125,
  steps: aclSteps,
  createState: createAclState,
  badge: "CCNA · Security Fundamentals",
  title: "Access Control Lists",
  intro: "Turn a security rule into an ACL that does exactly what it says. Compute wildcard masks, see why a standard ACL is too blunt, build an extended ACL near the source, and use hit counters to find a line that can never match.",
  facts: [
    { q: "What is an ACE?", a: "One permit or deny line in an ACL." },
    { q: "What does 'host' mean?", a: "A single address — wildcard 0.0.0.0." },
    { q: "What does 'any' mean?", a: "Every address — 0.0.0.0 255.255.255.255." },
    { q: "How is an ACL applied?", a: "ip access-group <name> in|out on an interface." },
  ],
  terms: [
    { term: "ACL", expansion: "Access control list", meaning: "Ordered permit/deny" },
    { term: "ACE", expansion: "Access control entry", meaning: "One line" },
    { term: "Wildcard", expansion: "Inverse mask", meaning: "0 = match" },
    { term: "Standard", expansion: "Source only", meaning: "Near destination" },
    { term: "Extended", expansion: "5-tuple match", meaning: "Near source" },
  ],
  guide: { title: "Access Control Lists", subtitle: "STAFF · GUEST · R1 · WEB · DB · PORTAL · internet", tabs: GUIDE_TABS },
  briefing: { phases: ACL_BRIEFING_PHASES, notes: ACL_BRIEFING_NOTES },
  nodes: (s) => [
    { id: "STAFF", label: "STAFF", subLabel: "10.1.10.0/24", x: 8, y: 22, kind: "laptop" },
    { id: "GUEST", label: "GUEST", subLabel: "10.1.20.0/24", x: 8, y: 74, kind: "laptop" },
    { id: "R1", label: "R1", subLabel: s.applied ? `${s.applied.acl.name} ${s.applied.dir} ${s.applied.iface}` : "no ACL", x: 40, y: 48, kind: "router" },
    { id: "NET", label: "NET", subLabel: "internet", x: 40, y: 8, kind: "cloud" },
    { id: "WEB", label: "WEB", subLabel: ".50.10", x: 80, y: 20, kind: "server" },
    { id: "DB", label: "DB", subLabel: ".50.20", x: 80, y: 50, kind: "server" },
    ...(s.portal ? [{ id: "PORTAL", label: "PORTAL", subLabel: ".50.30", x: 80, y: 80, kind: "server" as const }] : []),
  ],
  edges: (s) => [
    { id: "st", a: "STAFF", b: "R1", label: "Gi0/0" },
    { id: "gu", a: "GUEST", b: "R1", label: "Gi0/1" },
    { id: "net", a: "R1", b: "NET", label: "Gi0/3" },
    { id: "w", a: "R1", b: "WEB", label: "Gi0/2" },
    { id: "d", a: "R1", b: "DB" },
    ...(s.portal ? [{ id: "p", a: "R1", b: "PORTAL" }] : []),
  ],
  enterable: ["R1"],
  primaryDevice: { wildcard: "R1", standard: "R1", extended: "R1", named: "R1", "fault-injected": "R1", "diagnostic-layers": "R1", "repair-challenge": "R1" },
  ...adapters,
  callout: kitCallout,
  sidePanel: (s) => <AclPanel s={s} />,
  repair: {
    stepId: "repair-challenge",
    prompt: "Guests can't reach the new portal. Line 20 counts their attempts; line 40 has never matched. Which change fixes the cause?",
    options: ACL_REPAIR_OPTIONS,
    correctId: ACL_REPAIR_CORRECT,
    success: "The portal permit is now line 15, above the server-LAN deny. Guests reach the portal; the database stays blocked.",
    wrongFeedback: {
      anyany: "Line 20 still matches first and drops the portal traffic; a line at the end is never reached.",
      out: "Outbound on Gi0/1 would filter traffic going to the guests, not from them — the server LAN would be open to guests.",
      wc: "The host wildcard is right; widening it doesn't help a line that is never reached.",
    },
    attempt: (s) => s.repairAttempt,
  },
  diagnostics: {
    fromStepId: "diagnostic-layers",
    layers: (s) => {
      const portalSeq = s.applied?.acl.aces.find((e) => e.dst?.[0] === "10.1.50.30")?.seq ?? 0;
      return [
        { label: "Routing — R1 has a route to 10.1.50.30", status: "healthy" },
        { label: "Applied — GUEST-IN inbound on Gi0/1", status: "healthy" },
        { label: `Line order — portal permit is line ${portalSeq}, server-LAN deny is line 20`, status: portalSeq > 20 ? "failing" : "healthy" },
        { label: `Counters — line ${portalSeq}: ${s.hits[`GUEST-IN:${portalSeq}`] ?? 0} matches`, status: (s.hits[`GUEST-IN:${portalSeq}`] ?? 0) > 0 ? "healthy" : "failing" },
      ];
    },
  },
  complete: { badge: "Lesson Complete", title: "Your lists do what you mean", message: "Wildcards, top-down first match and the implicit deny; standard near the destination, extended near the source; sequence numbers to insert lines in the right place — and counters to prove it." },
};

export default function AccessControlListsDemo() {
  return <FundamentalsLessonShell config={config} />;
}
