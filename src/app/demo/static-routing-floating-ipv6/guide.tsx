import type { BriefingPhaseDef, BriefingStepNote } from "@/components/lesson/briefing";
import { Callout, CompareCards, FieldTable, Glossary, GuideSection, Misconceptions, Mono, TroubleshootingFlow } from "@/components/lesson/GuideBlocks";
import { CliPair, CliPanel } from "@/components/lesson/GuideCli";
import { ExplainIt, KnowledgeQuiz, type KnowledgeQuestion } from "@/components/lesson/GuideInteractive";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { createSrState, staticSteps, type SrState } from "@/lib/sim-engine/scenarios/ccna/staticRouting";
import { showIpRoute } from "./SrPanel";

export const SR_BRIEFING_PHASES: BriefingPhaseDef[] = [
  { phase: { label: "The table", tone: "cyan" }, objective: "Read every field of a route.", steps: ["intro", "table"] },
  { phase: { label: "Forwarding", tone: "ip" }, objective: "Default and host routes, decided by longest match.", steps: ["default", "host-route", "host-forward", "ad"] },
  { phase: { label: "Floating", tone: "violet" }, objective: "A backup that waits behind administrative distance.", steps: ["floating", "fail-a", "restore-a"] },
  { phase: { label: "IPv6", tone: "tcp" }, objective: "The same rules for IPv6.", steps: ["ipv6"] },
  { phase: { label: "Incident", tone: "danger" }, objective: "A backup route for the branch. Then complaints.", steps: ["fault-injected", "inc-traffic"] },
  { phase: { label: "Diagnose", tone: "danger" }, objective: "Diagnosis pending.", steps: ["trouble-question", "diagnostic-layers"] },
  { phase: { label: "Repair pending", tone: "warning" }, objective: "Choose the change that fixes the cause you identified.", steps: ["repair-challenge"] },
  { phase: { label: "Verify", tone: "success" }, objective: "Prove the primary path — and the backup.", steps: ["verify", "verify-failover"] },
  { phase: { label: "Complete", tone: "success" }, objective: "AD installs, LPM forwards.", steps: ["complete"] },
];
export const SR_BRIEFING_NOTES: Partial<Record<string, BriefingStepNote>> = {
  default: { takeaway: "The default route is the gateway of last resort." },
  floating: { takeaway: "A floating static is configured but not installed until it's needed." },
  "fail-a": { takeaway: "When the better route disappears, the floating route installs." },
  "restore-a": { takeaway: "Failback is automatic: lower AD wins again." },
  "fault-injected": { doingNow: "A new static route for the branch." },
  "trouble-question": { doingNow: "Diagnosis pending." },
  "repair-challenge": { doingNow: "Choose the change that fixes the cause you identified." },
  "verify-failover": { takeaway: "A backup's AD must be higher than the route it protects." },
};

export const SR_LESSON_SECTIONS: LessonGuideSectionLink[] = [
  { id: "srl-mission", label: "What this lesson teaches" },
  { id: "srl-table", label: "Every field of a route" },
  { id: "srl-two-rules", label: "Two rules, two jobs" },
  { id: "srl-kinds", label: "Default, network, host, floating" },
  { id: "srl-v6", label: "IPv6 static routes" },
  { id: "srl-config", label: "Configure and verify" },
  { id: "srl-incident", label: "The incident and the fix" },
  { id: "srl-glossary", label: "Glossary" },
];
export const SR_DEEP_SECTIONS: LessonGuideSectionLink[] = [
  { id: "srd-ad", label: "Administrative distances" },
  { id: "srd-nexthop", label: "Next hop, interface or both" },
  { id: "srd-track", label: "When the interface stays up" },
  { id: "srd-myths", label: "Misconceptions" },
  { id: "srd-explain", label: "Explain it" },
  { id: "srd-quiz", label: "Check yourself" },
];

function stateAt(stepId: string): SrState {
  let s = createSrState();
  for (const st of staticSteps) {
    s = st.run?.(s).state ?? s;
    if (st.id === stepId) break;
  }
  return s;
}

export function SrLessonGuideContent() {
  return (
    <>
      <GuideSection id="srl-mission" eyebrow="Mission" title="What this lesson teaches">
        <p>Read a routing table field by field, see longest-prefix match choose between a default and a host route, and build a floating backup that waits behind administrative distance — then fix a &ldquo;backup&rdquo; that quietly stole all the branch traffic.</p>
        <Callout tone="violet" title="CCNA 3.1 · 3.3">Interpret the routing table (codes, prefix, mask, next hop, AD, metric, gateway of last resort); configure and verify IPv4 and IPv6 static routes — default, network, host and floating.</Callout>
      </GuideSection>
      <GuideSection id="srl-table" eyebrow="Table" title="Every field of a route">
        <CliPanel run={showIpRoute(stateAt("floating"))} caption="R1 after the floating default was configured (from the lesson's model)" />
        <p>The floating default via ISP-B doesn&apos;t appear: it&apos;s configured, but AD 250 loses to the primary&apos;s AD 1.</p>
      </GuideSection>
      <GuideSection id="srl-two-rules" eyebrow="Rules" title="Two rules, two jobs">
        <CompareCards
          items={[
            { title: "Installing: lowest AD", tone: "violet", tag: "per prefix + length", points: ["Several sources offer 10.50.0.0/16", "Lowest administrative distance wins the slot", "Metric only breaks ties within one source"] },
            { title: "Forwarding: longest match", tone: "ip", tag: "per packet", points: ["Several installed routes match 10.50.1.20", "The longest prefix wins", "AD plays no part here"] },
          ]}
        />
      </GuideSection>
      <GuideSection id="srl-kinds" eyebrow="Kinds" title="Default, network, host, floating">
        <FieldTable
          title="Four kinds of static route on R1"
          columns={["Kind", "Example", "Use"]}
          rows={[
            ["Default", <Mono key="1">ip route 0.0.0.0 0.0.0.0 198.51.100.1</Mono>, "Everything without a better match"],
            ["Network", <Mono key="2">ip route 10.60.0.0 255.255.0.0 10.0.12.2</Mono>, "A remote subnet"],
            ["Host", <Mono key="3">ip route 192.0.2.10 255.255.255.255 203.0.113.5</Mono>, "Force one destination onto a path"],
            ["Floating", <Mono key="4">ip route 0.0.0.0 0.0.0.0 203.0.113.5 250</Mono>, "Backup: AD above the route it protects"],
          ]}
        />
      </GuideSection>
      <GuideSection id="srl-v6" eyebrow="IPv6" title="IPv6 static routes">
        <p>
          Same algorithm, IPv6 syntax: <Mono>ipv6 route ::/0 2001:db8:a::1</Mono>, and a floating <Mono>ipv6 route ::/0 GigabitEthernet0/2 fe80::b 250</Mono>. A link-local next hop must name the interface — every link has its own fe80::/64. Remember{" "}
          <Mono>ipv6 unicast-routing</Mono>.
        </p>
      </GuideSection>
      <GuideSection id="srl-config" eyebrow="Configure" title="Configure and verify">
        <CliPair
          cisco={{ prompt: "R1(config)#", command: "ip route 0.0.0.0 0.0.0.0 203.0.113.5 250", output: "R1# show ip route static\nR1# show ip route 10.50.1.20" }}
          junos={{ prompt: "admin@R1# ", command: "set routing-options static route 0.0.0.0/0 qualified-next-hop 203.0.113.5 preference 250", output: "set routing-options static route 0.0.0.0/0 next-hop 198.51.100.1\nadmin@R1> show route 10.50.1.20" }}
        />
        <p>Junos calls administrative distance <em>preference</em> (static 5, OSPF internal 10) — the numbers differ, the rule doesn&apos;t.</p>
      </GuideSection>
      <GuideSection id="srl-incident" eyebrow="Incident" title="The incident and the fix" tone="danger">
        <TroubleshootingFlow
          steps={[
            { question: "Which route is installed for the prefix?", look: <Mono>show ip route 10.50.0.0</Mono> },
            { question: "Which other sources offer it?", look: <><Mono>show ip ospf database</Mono>, <Mono>show running-config | include ip route</Mono></> },
            { question: "Compare ADs — is the backup's higher?", look: "5 < 110: the 'backup' wins." },
          ]}
        />
        <p>Fix: AD 250. Prove both halves: OSPF installed with the WAN up, the static installed with the WAN down.</p>
      </GuideSection>
      <GuideSection id="srl-glossary" eyebrow="Words" title="Glossary">
        <Glossary
          items={[
            { term: "Administrative distance", def: "Trust in a route's source; lowest wins per prefix (Junos: preference)." },
            { term: "Metric", def: "A protocol's own cost; compares routes from the same source only." },
            { term: "Longest prefix match", def: "Per packet, the most specific installed route wins." },
            { term: "Floating static", def: "A static route with an AD higher than the route it backs up." },
            { term: "Gateway of last resort", def: "The default route's next hop." },
          ]}
        />
      </GuideSection>
    </>
  );
}

const QUIZ: KnowledgeQuestion[] = [
  { id: "srd-q1", prompt: "Installed: 10.0.0.0/8 via A, 10.1.0.0/16 via B, 10.1.1.0/24 via C, 0.0.0.0/0 via D. Where does 10.1.2.5 go?", options: [{ id: "b", label: "B" }, { id: "c", label: "C" }, { id: "a", label: "A" }, { id: "d", label: "D" }], correctId: "b", explanation: "10.1.1.0/24 doesn't contain 10.1.2.5. The longest match that does is 10.1.0.0/16 → B." },
  { id: "srd-q2", prompt: "A static route has the next hop's address but not the interface, and the next hop is on a LAN. Fine?", options: [{ id: "yes", label: "Yes — R1 resolves the exit interface recursively" }, { id: "no", label: "No — static routes must name an interface" }], correctId: "yes", explanation: "A next-hop-only route is resolved through the connected route for that next hop. Naming only an Ethernet interface (no next hop) would make R1 ARP for every destination." },
];

export function SrDeepDiveContent() {
  return (
    <>
      <GuideSection id="srd-ad" eyebrow="AD" title="Administrative distances">
        <FieldTable
          title="Cisco defaults (Junos preference in brackets)"
          columns={["Source", "AD"]}
          rows={[
            ["Connected", "0 [0]"],
            ["Static", "1 [5]"],
            ["eBGP", "20 [170]"],
            ["EIGRP (internal)", "90"],
            ["OSPF", "110 [10 internal / 150 external]"],
            ["IS-IS", "115 [15/18]"],
            ["RIP", "120 [100]"],
            ["iBGP", "200 [170]"],
            ["Unusable", "255"],
          ]}
        />
      </GuideSection>
      <GuideSection id="srd-nexthop" eyebrow="Syntax" title="Next hop, interface or both">
        <CompareCards
          items={[
            { title: "Next hop only", tone: "success", tag: "recursive", points: ["Resolved via the connected route", "The usual choice on Ethernet"] },
            { title: "Interface only", tone: "warning", tag: "directly attached", points: ["Fine on point-to-point links", "On Ethernet: ARP for every destination"] },
            { title: "Interface + next hop", tone: "cyan", tag: "fully specified", points: ["Required for IPv6 link-local next hops", "Avoids recursion entirely"] },
          ]}
        />
      </GuideSection>
      <GuideSection id="srd-track" eyebrow="Beyond" title="When the interface stays up">
        <p>A floating route takes over only when the primary disappears. If the primary&apos;s interface stays up while the ISP beyond it fails, the primary stays installed. IP SLA tracking (Cisco) or BFD solves this by removing the route when a probe fails.</p>
      </GuideSection>
      <GuideSection id="srd-myths" eyebrow="Misconceptions" title="Misconceptions">
        <Misconceptions
          items={[
            { myth: "A lower AD makes a good backup.", correction: "The opposite: a backup must have a higher AD than the route it protects." },
            { myth: "The route with the best metric wins.", correction: "Metrics only compare routes from the same protocol; between protocols AD decides, and per packet the longest prefix decides." },
          ]}
        />
      </GuideSection>
      <GuideSection id="srd-explain" eyebrow="Explain" title="Explain it">
        <ExplainIt items={[{ q: "Why did the host route win over the default route even though both are static with AD 1?", a: "They are different prefixes. AD never compared them; longest prefix match picked the /32 for that destination." }]} />
      </GuideSection>
      <GuideSection id="srd-quiz" eyebrow="Quiz" title="Check yourself">
        <KnowledgeQuiz questions={QUIZ} />
      </GuideSection>
    </>
  );
}
