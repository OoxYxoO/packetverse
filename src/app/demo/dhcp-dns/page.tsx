"use client";

import { FundamentalsLessonShell, type FundamentalsLessonConfig } from "@/components/lesson/FundamentalsLessonShell";
import { fundamentalsAppCallout } from "@/components/lesson/fundamentalsAppCallout";
import type { LessonGuideTab } from "@/components/lesson/LessonGuideDialog";
import { DH_ADDR, DH_REPAIR_CORRECT, DH_REPAIR_OPTIONS, DNS_NAME, createDhState, dhcpDnsSteps, type DhDevice, type DhState } from "@/lib/sim-engine/scenarios/dhcpDns";
import { DH_BRIEFING_NOTES, DH_BRIEFING_PHASES } from "./briefing";
import { dhInterfacesFor, dhTraceFor } from "./deviceTrace";
import { dhTables, explainDh } from "./explain";
import { dhNames } from "./addressNames";
import { DhcpLeasePanel } from "./DhcpLeasePanel";
import { DH_LESSON_SECTIONS, DhcpDnsLessonGuideContent } from "./LessonGuideContent";
import { DhcpDnsPresentation } from "./DhcpDnsPresentation";
import { DhcpDnsLabWorkspace } from "./dhcp-lab/DhcpDnsLabWorkspace";
import { DH_DEEP_DIVE_SECTIONS, DhcpDnsDeepDiveContent } from "./DeepDiveContent";

const GUIDE_TABS: LessonGuideTab[] = [
  { id: "lesson", label: "This Lesson", hint: "CLIENT → relay R1 → DHCP-SRV · DNS lookup · Option 6 incident", sections: DH_LESSON_SECTIONS, content: <DhcpDnsLessonGuideContent /> },
  { id: "deep", label: "DHCP + DNS Deep Dive", hint: "DHCP leases and DNS resolution in general", sections: DH_DEEP_DIVE_SECTIONS, content: <DhcpDnsDeepDiveContent /> },
];

const config: FundamentalsLessonConfig<DhState> = {
  lessonId: "dhcp-dns",
  xp: 200,
  steps: dhcpDnsSteps,
  createState: createDhState,
  badge: "Fundamentals · Services",
  title: "DHCP + DNS: From Boot to Name Resolution",
  intro: `A client boots with nothing, leases an address, gateway and DNS server through a DHCP relay, then resolves ${DNS_NAME}. After that, a bad scope edit breaks names but not IP. Find out why.`,
  facts: [
    { q: "How does a new client ask?", a: "It broadcasts DHCPDISCOVER from 0.0.0.0 to 255.255.255.255, UDP 68 → 67." },
    { q: "How does it cross a router?", a: "A DHCP relay agent on R1 unicasts it to the server and stamps giaddr." },
    { q: "Where does the DNS server come from?", a: "DHCP Option 6 in the lease." },
    { q: "Which TTL is which?", a: "The DNS record TTL is cache time in seconds. The IPv4 TTL is a hop limit." },
  ],
  terms: [
    { term: "DHCP", expansion: "Dynamic Host Configuration Protocol", meaning: "Leases IPv4 settings" },
    { term: "giaddr", expansion: "Gateway (relay) IP address", meaning: "Tells the server the subnet" },
    { term: "xid", expansion: "Transaction ID", meaning: "Ties DORA messages together" },
    { term: "Option 6", expansion: "Domain Name Server", meaning: "DNS server for the client" },
    { term: "A record", expansion: "Address record", meaning: "Name → IPv4" },
  ],
  guide: { title: "DHCP + DNS", subtitle: `CLIENT ${DH_ADDR.CLIENT} · relay ${DH_ADDR["R1:CLIENT"]} · DHCP ${DH_ADDR["DHCP-SRV"]} · DNS ${DH_ADDR["DNS-SRV"]}`, tabs: GUIDE_TABS },
  briefing: { phases: DH_BRIEFING_PHASES, notes: DH_BRIEFING_NOTES },
  nodes: (s) => [
    { id: "CLIENT", label: "CLIENT", subLabel: s.client.ip ? `${s.client.ip}/24` : "no IPv4 yet", x: 8, y: 62, kind: "laptop" },
    { id: "SW1", label: "SW1", subLabel: "client LAN", x: 26, y: 32, kind: "switch" },
    { id: "R1", label: "R1", subLabel: "gw + DHCP relay", x: 48, y: 60, kind: "router" },
    { id: "SW2", label: "SW2", subLabel: "server LAN", x: 68, y: 30, kind: "switch" },
    { id: "DHCP-SRV", label: "DHCP-SRV", subLabel: DH_ADDR["DHCP-SRV"], x: 89, y: 24, kind: "server" },
    { id: "DNS-SRV", label: "DNS-SRV", subLabel: DH_ADDR["DNS-SRV"], x: 82, y: 86, kind: "server" },
  ],
  edges: () => [
    { id: "c-sw1", a: "CLIENT", b: "SW1", label: "p1" },
    { id: "sw1-r1", a: "SW1", b: "R1", label: "10.10.10.1" },
    { id: "r1-sw2", a: "R1", b: "SW2", label: "10.20.20.1" },
    { id: "sw2-dhcp", a: "SW2", b: "DHCP-SRV", label: "p2" },
    { id: "sw2-dns", a: "SW2", b: "DNS-SRV", label: "p3" },
  ],
  regions: [
    { id: "client-lan", label: "10.10.10.0/24", x: 2, y: 12, width: 40, height: 80, tone: "cyan" },
    { id: "server-lan", label: "10.20.20.0/24", x: 58, y: 6, width: 40, height: 92, tone: "violet" },
  ],
  enterable: ["R1", "SW1", "SW2"],
  primaryDevice: { "client-init": "CLIENT", "fault-lost": "R1", "repair-challenge": "DHCP-SRV" },
  traceFor: (d, s, stepId) => dhTraceFor(d as DhDevice, s, stepId),
  interfacesFor: (d, s, stepId) => dhInterfacesFor(d as DhDevice, s, stepId),
  pipelineTitle: (d) => (d === "R1" ? "R1 · Relay + routing pipeline" : `${d} · Bridge pipeline`),
  explainNode: explainDh,
  tablesFor: (d, s) => dhTables(d as DhDevice, s),
  callout: (p, s) => fundamentalsAppCallout(p, dhNames, { decision: s.note && (s.note.device === p.from || s.note.device === p.to) ? s.note.text : undefined }),
  nodeBadges: (id, s) => (id === "CLIENT" ? [s.client.phase] : undefined),
  repair: {
    stepId: "repair-challenge",
    prompt: "CLIENT's lease points at a DNS server that doesn't exist. Which change fixes it for CLIENT?",
    options: DH_REPAIR_OPTIONS.map((o) => ({ id: o.id, label: o.label })),
    correctId: DH_REPAIR_CORRECT,
    success: "The scope now hands out 10.20.20.53, and renewing makes CLIENT fetch a lease that carries it.",
    wrongFeedback: {
      "fix-only": "The server is correct now, but CLIENT still holds its current lease with 10.20.20.99. Nothing changes for CLIENT until it renews.",
      gateway: "The gateway works: the direct query to 10.20.20.53 crossed R1 fine.",
      "flush-fdb": "SW1 forwarded every frame correctly. The query was addressed to the wrong server.",
      "restart-dns": "DNS-SRV already answers correctly. The client isn't asking it.",
      "web-ip": "The web server's address is fine. The name was never resolved in the first place.",
    },
    attempt: (s) => s.repairAttempt,
  },
  diagnostics: {
    fromStepId: "diagnostic-layers",
    layers: (s) => [
      { label: `Address + mask — ${s.client.ip ?? "none"}/24`, status: "healthy" },
      { label: `Default gateway — ${s.client.gateway ?? "none"}`, status: "healthy" },
      { label: "Routing to 10.20.20.0/24 (a direct query to 10.20.20.53 is answered)", status: "healthy" },
      { label: `Lease DNS server (Option 6) — ${s.client.dns ?? "none"}`, status: s.client.dns === DH_ADDR["DNS-SRV"] ? "healthy" : "failing" },
    ],
  },
  sidePanel: (s) => <DhcpLeasePanel s={s} />,
  practiceLab: {
    entry: { title: "DHCP & DNS Lab", buttonLabel: "Practice DHCP & DNS", description: "Learn the story level by level, follow every message to where it stops, troubleshoot real tickets with each device's tables, logs and CLI, then build DHCP and DNS yourself from the devices' terminals and prove the service works." },
    contextNote: (stepId) => (stepId && /relay|giaddr|dora|bound|dns|fault|renew|verify/i.test(stepId) ? "Want to drive the client yourself?" : undefined),
    render: ({ open, onClose }) => <DhcpDnsLabWorkspace open={open} onClose={onClose} />,
  },
  presentation: { topic: "DHCP & DNS", render: (p) => <DhcpDnsPresentation {...p} /> },
  complete: { badge: "Lesson Complete", title: "Boot to name, understood", message: "DORA through a relay, a DNS lookup, and an Option 6 fault fixed with a lease renewal." },
};

export default function DhcpDnsDemo() {
  return <FundamentalsLessonShell config={config} />;
}
