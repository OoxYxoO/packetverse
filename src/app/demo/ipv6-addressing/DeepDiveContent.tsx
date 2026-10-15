import { CompareCards, FailureSignatures, FieldTable, GuideSection, Misconceptions, Mono } from "@/components/lesson/GuideBlocks";
import { ExplainIt, KnowledgeQuiz, type KnowledgeQuestion } from "@/components/lesson/GuideInteractive";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { compress, inPrefix } from "@/lib/sim-engine/scenarios/ccna/ipv6Addr";
import { TypesTable } from "./LessonGuideContent";

export const V6_DEEP_DIVE_SECTIONS: LessonGuideSectionLink[] = [
  { id: "v6d-header", label: "IPv6 header vs IPv4" },
  { id: "v6d-plan", label: "Prefix sizes and planning" },
  { id: "v6d-dhcp", label: "SLAAC, stateless and stateful DHCPv6" },
  { id: "v6d-multicast", label: "Multicast groups you will meet" },
  { id: "v6d-types", label: "Every type again" },
  { id: "v6d-signatures", label: "How IPv6 problems look" },
  { id: "v6d-myths", label: "Misconceptions" },
  { id: "v6d-explain", label: "Explain it" },
  { id: "v6d-quiz", label: "Check yourself" },
];

/** A site /48 split into /64s: the first few subnet IDs, computed. */
function subnets(site: string, n: number) {
  return Array.from({ length: n }, (_, i) => compress(`${site.split("::")[0]}:${i.toString(16)}::`));
}

const QUIZ: KnowledgeQuestion[] = [
  {
    id: "v6d-q1",
    prompt: "How many /64 subnets fit in a /48 site prefix?",
    options: [
      { id: "256", label: "256" },
      { id: "65536", label: "65,536" },
      { id: "16", label: "16" },
    ],
    correctId: "65536",
    explanation: "64 − 48 = 16 bits of subnet ID: 2¹⁶ = 65,536 subnets, each with 2⁶⁴ interface IDs.",
  },
  {
    id: "v6d-q2",
    prompt: "Which address is NOT inside 2001:db8:acad:10::/64?",
    options: [
      { id: "a", label: "2001:db8:acad:10::99" },
      { id: "b", label: "2001:db8:acad:10:ffff::1" },
      { id: "c", label: "2001:db8:acad:11::1" },
    ],
    correctId: "c",
    explanation: `The fourth group is the subnet ID: 11 ≠ 10. (Model check: ${inPrefix("2001:db8:acad:11::1", "2001:db8:acad:10::", 64) ? "inside" : "outside"}.)`,
  },
  {
    id: "v6d-q3",
    prompt: "An RA arrives with the M flag set. What should hosts do?",
    options: [
      { id: "dhcp", label: "Get their address from a DHCPv6 server (stateful)" },
      { id: "slaac", label: "Use SLAAC only" },
      { id: "ignore", label: "Ignore the router" },
    ],
    correctId: "dhcp",
    explanation: "M = Managed address configuration: addresses come from DHCPv6. O = Other configuration: SLAAC for the address, DHCPv6 for DNS and other options.",
  },
];

export function V6DeepDiveContent() {
  return (
    <>
      <GuideSection id="v6d-header" eyebrow="Header" title="IPv6 header vs IPv4">
        <FieldTable
          title="What changed"
          columns={["IPv4", "IPv6", "Why"]}
          rows={[
            ["Variable header with options", "Fixed 40-byte header + extension headers", "Faster forwarding"],
            ["TTL", "Hop Limit", "Same job, honest name"],
            ["Protocol", "Next Header", "Chains extension headers"],
            ["Header checksum", "none", "Layer 2 and 4 already check"],
            ["Fragmentation by routers", "Source only (Path MTU Discovery)", "Routers never fragment"],
            ["ARP (separate protocol)", "ICMPv6 neighbor discovery", "One protocol, multicast"],
          ]}
        />
      </GuideSection>

      <GuideSection id="v6d-plan" eyebrow="Planning" title="Prefix sizes and planning">
        <FieldTable
          title="Typical sizes"
          columns={["Prefix", "Given to", "Contains"]}
          rows={[
            ["/32", "An ISP or large organization (RIR allocation)", "65,536 /48s"],
            ["/48", "A site", "65,536 /64 subnets"],
            ["/56", "A home or small site", "256 /64s"],
            ["/64", "Every LAN", "SLAAC needs exactly 64 bits of interface ID"],
            ["/127", "Router-to-router links", "Two addresses, like an IPv4 /31"],
            ["/128", "Loopbacks", "One address"],
          ]}
        />
        <p>
          The first /64s of site <Mono>2001:db8:acad::/48</Mono>: {subnets("2001:db8:acad::", 4).map((p, i) => <Mono key={i}>{`${p}/64 `}</Mono>)}… The fourth group is the subnet ID — encode VLANs or buildings in it.
        </p>
      </GuideSection>

      <GuideSection id="v6d-dhcp" eyebrow="Configuration" title="SLAAC, stateless and stateful DHCPv6">
        <CompareCards
          items={[
            { title: "SLAAC", tone: "cyan", tag: "A flag", points: ["Address from prefix + own ID", "DNS from the RA (RDNSS) if offered", "No server state"] },
            { title: "Stateless DHCPv6", tone: "violet", tag: "A + O flags", points: ["Address by SLAAC", "DNS and options from DHCPv6", "Server keeps no leases"] },
            { title: "Stateful DHCPv6", tone: "warning", tag: "M flag", points: ["Address from the DHCPv6 server", "Default gateway still from the RA", "Server tracks leases"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="v6d-multicast" eyebrow="Multicast" title="Multicast groups you will meet">
        <FieldTable
          title="Well-known link-local groups (ff02::)"
          columns={["Group", "Members"]}
          rows={[
            ["ff02::1", "All nodes"],
            ["ff02::2", "All routers"],
            ["ff02::5 / ff02::6", "OSPFv3 routers / DRs"],
            ["ff02::a", "EIGRP routers"],
            ["ff02::1:2", "DHCPv6 servers and relays"],
            ["ff02::1:ffXX:XXXX", "Solicited-node, one per address"],
          ]}
        />
      </GuideSection>

      <GuideSection id="v6d-types" eyebrow="Types" title="Every type again">
        <TypesTable />
      </GuideSection>

      <GuideSection id="v6d-signatures" eyebrow="Troubleshooting" title="How IPv6 problems look">
        <FailureSignatures
          items={[
            { tag: "RA", title: "No Router Advertisements", tone: "danger", points: ["Hosts have only fe80::", "No default gateway", "Router not routing IPv6, or RAs suppressed"] },
            { tag: "DAD", title: "Duplicate address", tone: "warning", points: ["Address stays tentative / duplicate", "Logged on the host and router", "Static address typed twice"] },
            { tag: "Prefix", title: "Wrong prefix length on a LAN", tone: "violet", points: ["/56 or /48 on a LAN: SLAAC refuses", "Hosts keep only link-local", "Fix: /64"] },
            { tag: "Filter", title: "ICMPv6 blocked", tone: "cyan", points: ["NDP and PMTUD break", "Large transfers stall", "Never block ICMPv6 wholesale"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="v6d-myths" eyebrow="Misconceptions" title="Misconceptions">
        <Misconceptions
          items={[
            { myth: "IPv6 hosts need DHCP like IPv4.", correction: "SLAAC alone gives them an address and a gateway. DHCPv6 is optional." },
            { myth: "Link-local addresses are useless.", correction: "They are the next-hop addresses in IPv6 routing tables and what every NDP and routing protocol speaks." },
            { myth: "NAT is needed for security in IPv6.", correction: "IPv6 is designed for end-to-end addressing; a stateful firewall provides the protection NAT incidentally did." },
          ]}
        />
      </GuideSection>

      <GuideSection id="v6d-explain" eyebrow="Explain" title="Explain it">
        <ExplainIt
          items={[
            { q: "Why does DAD send from ::?", a: "The host doesn't own an address yet; using the tentative one would be wrong if it turned out to be a duplicate." },
            { q: "Why can't PC1 even try to send the ping during the incident?", a: "It knows no prefix (so nothing is on-link) and has no default router. With no next hop, the packet has nowhere to go." },
            { q: "Why do routers use link-local addresses as next hops?", a: "They never change when global prefixes are renumbered, and every router always has one." },
          ]}
        />
      </GuideSection>

      <GuideSection id="v6d-quiz" eyebrow="Quiz" title="Check yourself">
        <KnowledgeQuiz questions={QUIZ} />
      </GuideSection>
    </>
  );
}
