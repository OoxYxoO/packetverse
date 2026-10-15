import { Callout, CompareCards, FailureSignatures, FieldTable, GuideSection, Misconceptions, Mono } from "@/components/lesson/GuideBlocks";
import { ExplainIt, KnowledgeQuiz, type KnowledgeQuestion } from "@/components/lesson/GuideInteractive";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { ARCH, shortest, switchLinks, type ArchGraph } from "@/lib/sim-engine/scenarios/ccna/componentsArch";
import { ArchCards } from "./LessonGuideContent";

export const COMP_DEEP_DIVE_SECTIONS: LessonGuideSectionLink[] = [
  { id: "cad-firewalls", label: "Firewalls, NGFW and IPS" },
  { id: "cad-poe", label: "PoE standards and budgets" },
  { id: "cad-tiers", label: "Tiers and failure domains" },
  { id: "cad-fabric", label: "Growing a spine-leaf fabric" },
  { id: "cad-wan", label: "WAN topologies" },
  { id: "cad-signatures", label: "How component problems look" },
  { id: "cad-myths", label: "Misconceptions" },
  { id: "cad-explain", label: "Explain it" },
  { id: "cad-quiz", label: "Check yourself" },
];

/** A leaf-spine fabric of `leaves` × `spines`, with a server on the first and last leaf — measured, not stated. */
function fabric(leaves: number, spines: number): ArchGraph {
  const L = Array.from({ length: leaves }, (_, i) => `L${i + 1}`);
  const S = Array.from({ length: spines }, (_, i) => `S${i + 1}`);
  return { nodes: ["A", "B", ...L, ...S], links: [["A", L[0]], ["B", L[leaves - 1]], ...L.flatMap((l) => S.map((s) => [l, s] as [string, string]))], from: "A", to: "B" };
}

const QUIZ: KnowledgeQuestion[] = [
  {
    id: "cad-q1",
    prompt: "A user's traffic must go from VLAN 10 to VLAN 30 in the same building. Which component must be in the path?",
    options: [
      { id: "ap", label: "An access point" },
      { id: "l2", label: "A Layer 2 switch" },
      { id: "l3", label: "A Layer 3 switch or router" },
      { id: "wlc", label: "A wireless LAN controller" },
    ],
    correctId: "l3",
    explanation: "Different VLANs are different subnets; only a Layer 3 device can forward between them. A Layer 2 switch keeps each VLAN separate.",
  },
  {
    id: "cad-q2",
    prompt: "Which design gives every server the same number of hops to every other server on a different leaf?",
    options: [
      { id: "3t", label: "3-tier" },
      { id: "sl", label: "Spine-leaf" },
      { id: "soho", label: "SOHO" },
      { id: "2t", label: "2-tier" },
    ],
    correctId: "sl",
    explanation: "Leaf → spine → leaf is always the path between leaves, whichever spine is used.",
  },
  {
    id: "cad-q3",
    prompt: "A switch has a 370 W PoE budget. How many class 4 (30 W) access points can it power at full class reservation?",
    options: [
      { id: "10", label: "10" },
      { id: "12", label: "12" },
      { id: "24", label: "24" },
      { id: "48", label: "48" },
    ],
    correctId: "12",
    explanation: "12 × 30 W = 360 W fits; a 13th would need 390 W. Port count doesn't matter once the power budget is spent.",
  },
  {
    id: "cad-q4",
    prompt: "What does a lightweight AP's controller (WLC) do in this lesson's design?",
    options: [
      { id: "route", label: "Routes all wireless user traffic" },
      { id: "manage", label: "Pushes SSID, security and channel settings to APs and monitors them" },
      { id: "power", label: "Supplies power to the APs" },
      { id: "nat", label: "Translates client addresses" },
    ],
    correctId: "manage",
    explanation: "The WLC is the management and control point. In this design, AP1 bridges user traffic locally onto the access switch.",
  },
];

export function CompDeepDiveContent() {
  const sizes: [number, number][] = [
    [4, 2],
    [4, 4],
    [8, 4],
    [16, 4],
  ];
  return (
    <>
      <GuideSection id="cad-firewalls" eyebrow="Components" title="Firewalls, NGFW and IPS">
        <CompareCards
          items={[
            { title: "Stateful firewall", tone: "danger", tag: "Layer 3–4", points: ["Policy on zones, addresses, ports", "Session table admits replies", "Default deny for everything else"] },
            { title: "Next-generation firewall", tone: "violet", tag: "Layer 3–7", points: ["Adds application identification (not just port 443)", "User identity, URL filtering", "Usually includes IPS and malware inspection"] },
            { title: "IPS", tone: "warning", tag: "inline inspection", points: ["Matches traffic against attack signatures", "Drops malicious flows in-line", "Often a feature of the NGFW"] },
          ]}
        />
        <Callout tone="cyan" title="Cisco and others">
          Cisco Secure Firewall, Juniper SRX, Palo Alto and Fortinet are all next-generation firewalls. The concepts — zones, ordered policy, sessions, NAT — are identical; only the command syntax differs.
        </Callout>
      </GuideSection>

      <GuideSection id="cad-poe" eyebrow="Components" title="PoE standards and budgets">
        <FieldTable
          title="IEEE PoE — power reserved at the switch port (PSE)"
          columns={["Standard", "Name", "Class", "Per port at PSE", "Typical device"]}
          rows={[
            ["802.3af", "PoE", "0–3", <Mono key="a">15.4 W</Mono>, "IP phone, basic camera"],
            ["802.3at", "PoE+", "4", <Mono key="b">30 W</Mono>, "Wi-Fi 5/6 access point"],
            ["802.3bt", "PoE++ Type 3", "5–6", <Mono key="c">45–60 W</Mono>, "Wi-Fi 6E/7 AP, PTZ camera"],
            ["802.3bt", "PoE++ Type 4", "7–8", <Mono key="d">75–90 W</Mono>, "Thin clients, displays"],
          ]}
        />
        <p>
          The powered device (PD) reports its class during detection; the switch (PSE) reserves that much from its budget. Cisco <Mono>show power inline</Mono> and Junos <Mono>show poe interface</Mono> show granted power per port and what
          remains. Some switches can allocate by measured draw instead of class, which fits more devices but risks oversubscription when they all peak.
        </p>
      </GuideSection>

      <GuideSection id="cad-tiers" eyebrow="Design" title="Tiers and failure domains">
        <ArchCards />
        <p>
          Each tier is a boundary. In a 3-tier campus, Layer 2 usually stops at the distribution switches: a broadcast storm or a spanning-tree problem in building A stays in building A. The core carries only routed traffic between
          buildings, so it can be simple and fast. A collapsed core removes a tier — fewer boxes and cables — at the cost of a larger blast radius when a core switch misbehaves.
        </p>
      </GuideSection>

      <GuideSection id="cad-fabric" eyebrow="Design" title="Growing a spine-leaf fabric">
        <FieldTable
          title="Computed for each fabric size (server on the first leaf → server on the last leaf)"
          columns={["Leaves × spines", "Shortest path", "Equal paths", "Fabric links"]}
          rows={sizes.map(([l, sp]) => {
            const g = fabric(l, sp);
            const r = shortest(g);
            return [`${l} × ${sp}`, <Mono key="l">{r.links} links</Mono>, <Mono key="p">{r.paths}</Mono>, <Mono key="s">{switchLinks(g)}</Mono>];
          })}
        />
        <p>
          Adding leaves adds server ports without adding distance. Adding spines adds paths — and bandwidth — between every pair of leaves. The limit is the spine&apos;s port count: each spine needs one port per leaf. The lesson&apos;s fabric
          has {ARCH["spine-leaf"].nodes.filter((n) => n.startsWith("SPINE")).length} spines.
        </p>
      </GuideSection>

      <GuideSection id="cad-wan" eyebrow="Design" title="WAN topologies">
        <CompareCards
          items={[
            { title: "Point-to-point", tone: "cyan", tag: "two sites", points: ["One circuit, two ends", "Simple; no redundancy unless doubled"] },
            { title: "Hub-and-spoke", tone: "ip", tag: "branches → HQ", points: ["Every branch connects to the hub", "Branch-to-branch goes through the hub", "Cheapest for many sites"] },
            { title: "Full / partial mesh", tone: "violet", tag: "site ↔ site", points: ["Direct paths between sites", "n(n−1)/2 links for a full mesh", "Resilient but costly"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="cad-signatures" eyebrow="Troubleshooting" title="How component problems look">
        <FailureSignatures
          items={[
            { tag: "Power", title: "PoE budget exhausted", tone: "danger", points: ["New AP or phone stays dark", "Switch logs a power-denied message for the port", "Existing devices unaffected"] },
            { tag: "L3", title: "No gateway between VLANs", tone: "warning", points: ["Same-VLAN traffic works", "Cross-VLAN traffic fails", "Hosts can't ping their default gateway"] },
            { tag: "Policy", title: "Firewall denies", tone: "violet", points: ["Inside works, internet fails for one application", "Firewall log shows the deny rule", "Routing tables look fine"] },
            { tag: "Edge", title: "No NAT at the edge", tone: "cyan", points: ["Packets leave with private sources", "No replies come back", "The ISP drops RFC 1918 addresses"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="cad-myths" eyebrow="Misconceptions" title="Misconceptions">
        <Misconceptions
          items={[
            { myth: "An access point is a small router.", correction: "In an enterprise it is a bridge: it moves frames between radio and Ethernet. Your home router contains an AP plus a router, switch and firewall." },
            { myth: "A Layer 3 switch replaces the firewall.", correction: "It routes; it doesn't keep sessions or enforce zone policy. Access lists on it are stateless filters." },
            { myth: "More tiers is always better.", correction: "Tiers add scale and smaller failure domains, but also cost, cabling and latency. Small sites collapse the core." },
            { myth: "Spine switches connect to each other.", correction: "In a classic spine-leaf fabric they don't: every path is leaf → spine → leaf." },
          ]}
        />
      </GuideSection>

      <GuideSection id="cad-explain" eyebrow="Explain" title="Explain it">
        <ExplainIt
          items={[
            { q: "Why does the frame leaving CORE carry different MAC addresses but the same IP addresses?", a: "MAC addresses identify the next hop on one link; IP addresses identify the endpoints end to end. Each routed hop builds a new frame for its own link." },
            { q: "Why does the cloud application see 198.51.100.2 instead of the laptop's address?", a: "EDGE-R translated the private source to its public address (PAT) because private addresses are not routed on the internet." },
            { q: "Why can't a channel change fix the meeting-room outage?", a: "AP2 had no power. Every layer above power — link, controller join, radio — depends on it." },
          ]}
        />
      </GuideSection>

      <GuideSection id="cad-quiz" eyebrow="Quiz" title="Check yourself">
        <KnowledgeQuiz questions={QUIZ} />
      </GuideSection>
    </>
  );
}
