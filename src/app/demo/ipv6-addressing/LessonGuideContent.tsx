import { Callout, DIAGRAM as D, DiagramFrame, DiagramSvg, DLink, DNode, FieldTable, Glossary, GuideSection, Mono, ProtocolStory, TroubleshootingFlow } from "@/components/lesson/GuideBlocks";
import { CliPair } from "@/components/lesson/GuideCli";
import { KnowledgeCheck } from "@/components/lesson/GuideInteractive";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { PC1_GUA, PC1_LLA, V6, classify, compress, eui64, expand, multicastMac, solicitedNode } from "@/lib/sim-engine/scenarios/ccna/ipv6Addr";

export const V6_LESSON_SECTIONS: LessonGuideSectionLink[] = [
  { id: "v6l-mission", label: "What this lesson teaches" },
  { id: "v6l-network", label: "The network of this lesson" },
  { id: "v6l-notation", label: "Writing addresses" },
  { id: "v6l-types", label: "Address types" },
  { id: "v6l-eui", label: "Modified EUI-64" },
  { id: "v6l-slaac", label: "How PC1 configures itself" },
  { id: "v6l-nd", label: "Neighbor discovery" },
  { id: "v6l-config", label: "Configure and verify" },
  { id: "v6l-incident", label: "The incident" },
  { id: "v6l-fix", label: "Repair and prove it" },
  { id: "v6l-glossary", label: "Glossary" },
  { id: "v6l-recap", label: "Recap" },
];

function TopoDiagram() {
  return (
    <DiagramSvg h={160} label={`PC1 on ${compress(V6.lan)}/64 via SW1 to R1, then the server on ${compress(V6.srvNet)}/64`}>
      <DNode x={70} y={80} label="PC1" sub="SLAAC" w={90} />
      <DNode x={220} y={80} label="SW1" accent={D.eth} w={70} />
      <DNode x={380} y={80} label="R1" sub="fe80::1" accent={D.ip} w={90} />
      <DNode x={560} y={80} label="SERVER" sub={V6.srv} accent={D.success} w={120} />
      <DLink x1={115} y1={80} x2={185} y2={80} />
      <DLink x1={255} y1={80} x2={335} y2={80} label={`Gi0/0 · ${compress(V6.r1Gua0)}/64`} />
      <DLink x1={425} y1={80} x2={500} y2={80} label={`Gi0/1 · ${compress(V6.r1Gua1)}/64`} labelDy={18} />
    </DiagramSvg>
  );
}

function EuiDiagram() {
  const mac = V6.pc1Mac.split(":");
  const iid = eui64(V6.pc1Mac);
  return (
    <DiagramSvg h={180} label={`EUI-64: MAC ${V6.pc1Mac} split in half, ff:fe inserted, 7th bit flipped: ${iid}`}>
      <text x={20} y={30} fill={D.muted} fontSize={11}>
        MAC
      </text>
      {mac.map((b, i) => (
        <text key={i} x={120 + i * 52 + (i >= 3 ? 104 : 0)} y={30} fill={i === 0 ? D.warning : D.text} fontSize={13} fontFamily="monospace">
          {b}
        </text>
      ))}
      <text x={20} y={80} fill={D.muted} fontSize={11}>
        insert ff:fe
      </text>
      {[mac[0], mac[1], mac[2], "ff", "fe", mac[3], mac[4], mac[5]].map((b, i) => (
        <text key={i} x={120 + i * 52} y={80} fill={i === 3 || i === 4 ? D.cyan : D.text} fontSize={13} fontFamily="monospace">
          {b}
        </text>
      ))}
      <text x={20} y={130} fill={D.muted} fontSize={11}>
        flip bit 7
      </text>
      <text x={120} y={130} fill={D.warning} fontSize={13} fontFamily="monospace">
        {mac[0]} → {(parseInt(mac[0], 16) ^ 2).toString(16).padStart(2, "0")}
      </text>
      <text x={20} y={166} fill={D.muted} fontSize={11}>
        interface ID
      </text>
      <text x={120} y={166} fill={D.success} fontSize={13} fontFamily="monospace">
        {iid}
      </text>
    </DiagramSvg>
  );
}

export function TypesTable() {
  const ex: [string, string, string][] = [
    [PC1_GUA, "2000::/3", "Routable on the internet"],
    ["fd12:3456:789a:1::10", "fc00::/7 (fd00::/8 in use)", "Internal only — like private IPv4"],
    [PC1_LLA, "fe80::/10", "This link only; never routed"],
    ["ff02::1", "ff00::/8", "All nodes on the link"],
    [solicitedNode(PC1_GUA), "ff02::1:ff00:0/104", "Solicited-node: neighbor discovery"],
    ["::1", "::1/128", "Loopback"],
    ["::", "::/128", "Unspecified (no address yet)"],
  ];
  return <FieldTable title="Classified by the lesson's model" columns={["Example", "Type", "Prefix", "Use"]} rows={ex.map(([a, p, u]) => [<Mono key="a">{a}</Mono>, classify(a), p, u])} />;
}

export function V6LessonGuideContent() {
  const sample = "2001:0db8:0000:0000:0000:ff00:0042:8329";
  return (
    <>
      <GuideSection id="v6l-mission" eyebrow="Mission" title="What this lesson teaches">
        <p>
          IPv6 isn&apos;t IPv4 with longer numbers. Hosts configure themselves, broadcast is gone, and every interface holds several addresses at once. You will follow PC1 from power-on to a ping across R1, name every address it
          holds, and then fix a router that has all its addresses but still leaves PC1 stranded.
        </p>
        <Callout tone="violet" title="CCNA 1.8 · 1.9">
          Configure and verify IPv6 addressing and prefix; describe IPv6 address types — unicast (global, unique local, link-local), anycast, multicast and modified EUI-64.
        </Callout>
      </GuideSection>

      <GuideSection id="v6l-network" eyebrow="Topology" title="The network of this lesson">
        <DiagramFrame caption="Two /64 subnets joined by R1.">
          <TopoDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="v6l-notation" eyebrow="Notation" title="Writing addresses">
        <p>
          128 bits as eight groups of four hex digits. Rule 1: drop leading zeros in any group. Rule 2: replace one run of consecutive all-zero groups with <Mono>::</Mono> — only once, and the longest run.
        </p>
        <FieldTable
          title="Computed by the lesson's model"
          columns={["Written", "Compressed", "Expanded"]}
          rows={[sample, "2001:db8:0:1:0:0:0:1", "fe80:0:0:0:0:0:0:1", "2001:db8:0:0:1:0:0:1"].map((a) => [<Mono key="a">{a}</Mono>, <Mono key="c">{compress(a)}</Mono>, <Mono key="e">{expand(a)}</Mono>])}
        />
        <Callout tone="cyan" title="Prefix length">Like CIDR: <Mono>/64</Mono> means the first 64 bits are the network. LANs are always /64, so SLAAC has exactly 64 bits for the interface ID.</Callout>
      </GuideSection>

      <GuideSection id="v6l-types" eyebrow="Types" title="Address types">
        <TypesTable />
        <p>
          <strong>Anycast</strong> is not a separate format: it is a unicast address configured on several devices, and routing delivers each packet to the nearest one (public DNS resolvers work this way). There is no broadcast;
          multicast groups do that job, for only the hosts that care.
        </p>
      </GuideSection>

      <GuideSection id="v6l-eui" eyebrow="EUI-64" title="Modified EUI-64">
        <EuiDiagram />
        <p>
          Prefix + interface ID: link-local <Mono>{PC1_LLA}</Mono>, global <Mono>{PC1_GUA}</Mono>. Many operating systems now generate a random interface ID instead (privacy), but routers commonly use EUI-64 — <Mono>ipv6 address {compress(V6.lan)}/64 eui-64</Mono> on Cisco.
        </p>
        <KnowledgeCheck
          label="Check"
          question={{
            id: "v6l-k1",
            prompt: "A MAC address begins 00:1e:bd. What do the first 16 bits of its EUI-64 interface ID become?",
            options: [
              { id: "a", label: "021e" },
              { id: "b", label: "001e" },
              { id: "c", label: "fffe" },
            ],
            correctId: "a",
            explanation: `Flip the 7th bit of the first byte: 00 → 02. The first group becomes 021e (${eui64("00:1e:bd:7a:10:00")} for R1's Gi0/0 MAC).`,
          }}
        />
      </GuideSection>

      <GuideSection id="v6l-slaac" eyebrow="SLAAC" title="How PC1 configures itself">
        <ProtocolStory
          problem="PC1 boots with no address and no configuration."
          steps={[
            { actor: "PC1", action: <>Forms <Mono>{PC1_LLA}</Mono> from fe80::/64 and its interface ID.</>, changes: "Tentative link-local address." },
            { actor: "PC1", action: <>DAD: Neighbor Solicitation from :: to <Mono>{solicitedNode(PC1_LLA)}</Mono>. No reply.</>, changes: "Address is unique — now in use." },
            { actor: "PC1", action: <>Router Solicitation to <Mono>ff02::2</Mono>.</> },
            { actor: "R1", action: <>Router Advertisement to <Mono>ff02::1</Mono>: prefix {compress(V6.lan)}/64, flag A, lifetime 1800 s, source fe80::1.</> },
            { actor: "PC1", action: <>Builds <Mono>{PC1_GUA}</Mono>, runs DAD for it, sets fe80::1 as default router.</>, changes: "Global address + default gateway." },
          ]}
        />
      </GuideSection>

      <GuideSection id="v6l-nd" eyebrow="NDP" title="Neighbor discovery">
        <FieldTable
          title="ICMPv6 neighbor discovery messages"
          columns={["Type", "Message", "Sent to", "Job"]}
          rows={[
            ["133", "Router Solicitation (RS)", "ff02::2", "Routers, speak now"],
            ["134", "Router Advertisement (RA)", "ff02::1 or the asker", "Prefix, flags, default router"],
            ["135", "Neighbor Solicitation (NS)", "solicited-node group", "Who has this address? (and DAD)"],
            ["136", "Neighbor Advertisement (NA)", "the asker", "Here is my MAC"],
          ]}
        />
        <p>
          For R1&apos;s <Mono>{V6.r1Lla}</Mono> the solicited-node group is <Mono>{solicitedNode(V6.r1Lla)}</Mono>, sent to MAC <Mono>{multicastMac(solicitedNode(V6.r1Lla))}</Mono> — only interfaces listening for that group even look at it.
        </p>
      </GuideSection>

      <GuideSection id="v6l-config" eyebrow="Configure" title="Configure and verify">
        <CliPair
          cisco={{ prompt: "R1(config)#", command: "ipv6 unicast-routing", output: `interface GigabitEthernet0/0\n ipv6 address ${compress(V6.r1Gua0)}/64\n ipv6 address fe80::1 link-local\ninterface GigabitEthernet0/1\n ipv6 address ${compress(V6.r1Gua1)}/64` }}
          junos={{ prompt: "admin@R1# ", command: `set interfaces ge-0/0/0 unit 0 family inet6 address ${compress(V6.r1Gua0)}/64`, output: `set interfaces ge-0/0/1 unit 0 family inet6 address ${compress(V6.r1Gua1)}/64\nset protocols router-advertisement interface ge-0/0/0.0 prefix ${compress(V6.lan)}/64` }}
        />
        <p>
          Verify with <Mono>show ipv6 interface brief</Mono> and <Mono>show ipv6 neighbors</Mono> (Cisco), <Mono>show interfaces terse</Mono> and <Mono>show ipv6 neighbors</Mono> (Junos). On a host: <Mono>ipconfig</Mono> or{" "}
          <Mono>ip -6 addr</Mono>. Junos routes IPv6 by default but advertises only where router-advertisement is configured; Cisco does neither until <Mono>ipv6 unicast-routing</Mono>.
        </p>
      </GuideSection>

      <GuideSection id="v6l-incident" eyebrow="Incident" title="The incident" tone="danger">
        <p>R1 is replaced; the engineer pastes the old interface configuration only. After a reboot, PC1 has a link-local address and nothing else, and every ping off the LAN fails without a single packet leaving PC1.</p>
        <TroubleshootingFlow
          steps={[
            { question: "What addresses does the host have?", look: "Only fe80:: → no RA was received." },
            { question: "Does the router send RAs?", look: <><Mono>show ipv6 interface Gi0/0</Mono> — look for &ldquo;ND advertised…&rdquo; and the all-routers group FF02::2.</> },
            { question: "Is the router routing IPv6?", look: <><Mono>show running-config | include unicast-routing</Mono></> },
          ]}
        />
      </GuideSection>

      <GuideSection id="v6l-fix" eyebrow="Repair" title="Repair and prove it" tone="success">
        <p>
          <Mono>ipv6 unicast-routing</Mono> turns R1 back into a router: it joins ff02::2, answers RS messages with RAs, and forwards. PC1 builds <Mono>{PC1_GUA}</Mono> again and the ping crosses R1. A static address on PC1 would
          still leave it without a gateway — and every other host on the LAN still broken.
        </p>
      </GuideSection>

      <GuideSection id="v6l-glossary" eyebrow="Words" title="Glossary">
        <Glossary
          items={[
            { term: "GUA", def: "Global unicast address, 2000::/3 — routable on the internet." },
            { term: "ULA", def: "Unique local address, fd00::/8 — internal only." },
            { term: "LLA", def: "Link-local address, fe80::/10 — this link only; every interface has one." },
            { term: "SLAAC", def: "Stateless address autoconfiguration: prefix from an RA, interface ID from the host." },
            { term: "DAD", def: "Duplicate Address Detection: an NS for your own tentative address." },
            { term: "Solicited-node multicast", def: "ff02::1:ffXX:XXXX from the low 24 bits of an address; replaces ARP broadcast." },
            { term: "Hop Limit", def: "IPv6's TTL." },
          ]}
        />
      </GuideSection>

      <GuideSection id="v6l-recap" eyebrow="Recap" title="Recap" tone="success">
        <ul className="list-disc space-y-1 pl-5">
          <li>Shorten: leading zeros go; one :: for the longest zero run.</li>
          <li>Every interface: a link-local address; hosts on a /64 LAN add a global (or unique local) address by SLAAC.</li>
          <li>RS/RA find routers and prefixes; NS/NA replace ARP over solicited-node multicast; no broadcast.</li>
          <li>A router advertises and forwards only when IPv6 routing is enabled.</li>
        </ul>
      </GuideSection>
    </>
  );
}
