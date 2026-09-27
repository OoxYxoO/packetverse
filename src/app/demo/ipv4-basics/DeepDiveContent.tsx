import { Callout, ChecklistCard, DArrow, DIAGRAM as D, DiagramFrame, DiagramSvg, DLink, DNode, DPill, FieldTable, FlowSteps, Glossary, GuideSection, Mono } from "@/components/lesson/GuideBlocks";
import { DFieldRow, DTable } from "@/components/lesson/FundamentalsGuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { blockSize, hostRange, maskOf, networkOf, sameSubnet, subnetsOf } from "@/lib/sim-engine/scenarios/ipv4Basics";

export const V4_DEEP_DIVE_SECTIONS: LessonGuideSectionLink[] = [
  { id: "v4d-header", label: "The IPv4 header" },
  { id: "v4d-prefixes", label: "Prefix sizes" },
  { id: "v4d-cidr", label: "CIDR aggregation" },
  { id: "v4d-lpm", label: "Longest-prefix match" },
  { id: "v4d-ttl", label: "TTL and loops" },
  { id: "v4d-special", label: "/31 and /32" },
  { id: "v4d-private", label: "Private ranges" },
  { id: "v4d-workflow", label: "Troubleshooting workflow" },
  { id: "v4d-glossary", label: "Glossary" },
];

function HeaderDiagram() {
  const row = (y: number, fields: { label: string; w: number; strong?: boolean; color?: string }[]) => <DFieldRow x={40} y={y} h={30} fields={fields.map((f) => ({ ...f, color: f.color ?? D.ip }))} />;
  const u = 560 / 32;
  return (
    <DiagramSvg h={220} label="IPv4 header, 20 bytes without options: Version, IHL, DSCP/ECN, Total Length; Identification, Flags, Fragment Offset; TTL, Protocol, Header Checksum; Source Address; Destination Address">
      <text x={40} y={20} fill={D.muted} fontSize={10}>
        0 ··· 32 bits per row ··· 31
      </text>
      {row(28, [
        { label: "Ver", w: 4 * u },
        { label: "IHL", w: 4 * u },
        { label: "DSCP/ECN", w: 8 * u },
        { label: "Total Length", w: 16 * u },
      ])}
      {row(58, [
        { label: "Identification", w: 16 * u },
        { label: "Flg", w: 3 * u },
        { label: "Fragment Offset", w: 13 * u },
      ])}
      {row(88, [
        { label: "TTL", w: 8 * u, strong: true, color: D.warning },
        { label: "Protocol", w: 8 * u },
        { label: "Header Checksum", w: 16 * u, strong: true, color: D.warning },
      ])}
      {row(118, [{ label: "Source Address", w: 32 * u, strong: true }])}
      {row(148, [{ label: "Destination Address", w: 32 * u, strong: true }])}
      <text x={40} y={200} fill={D.warning} fontSize={10.5} fontWeight={700}>
        Amber fields change at every router. The addresses change only with NAT (not in this lesson).
      </text>
    </DiagramSvg>
  );
}

function PrefixDiagram() {
  const prefixes = [24, 25, 26, 27, 28, 29, 30];
  return (
    <DiagramSvg h={230} label={`Prefix sizes: ${prefixes.map((p) => `/${p} mask ${maskOf(p)} block ${blockSize(p)}`).join(", ")}`}>
      {prefixes.map((p, i) => {
        const y = 26 + i * 28;
        const w = (blockSize(p) / 256) * 290;
        return (
          <g key={p}>
            <text x={20} y={y + 12} fill={D.text} fontSize={11} fontWeight={700} fontFamily="monospace">
              /{p}
            </text>
            <text x={60} y={y + 12} fill={D.muted} fontSize={10} fontFamily="monospace">
              {maskOf(p)}
            </text>
            <rect x={200} y={y} width={Math.max(3, w)} height={16} rx={3} fill={p === 26 ? D.violet : D.ip} fillOpacity={0.5} />
            <text x={200 + Math.max(3, w) + 8} y={y + 12} fill={D.muted} fontSize={10}>
              {blockSize(p)} addrs · {hostRange("10.0.0.0", p)?.count} hosts
            </text>
          </g>
        );
      })}
    </DiagramSvg>
  );
}

function CidrDiagram() {
  const subs = subnetsOf("192.168.10.0", 24, 26);
  return (
    <DiagramSvg h={170} label="Four contiguous /26 subnets 192.168.10.0, .64, .128 and .192 aggregate into one /24 route 192.168.10.0/24">
      {subs.map((s, i) => (
        <g key={s.network}>
          <DNode x={90 + i * 150} y={40} label={`${s.network}/26`} w={140} accent={D.violet} />
          <DArrow x1={90 + i * 150} y1={62} x2={320} y2={112} color={D.muted} width={1.5} />
        </g>
      ))}
      <DNode x={320} y={134} label="192.168.10.0/24" sub="one summary route" w={180} accent={D.success} />
    </DiagramSvg>
  );
}

function LpmDiagram() {
  const dst = "192.168.10.70";
  const routes = [
    { p: "0.0.0.0/0", nh: "ISP" },
    { p: "192.168.0.0/16", nh: "R-core" },
    { p: "192.168.10.0/24", nh: "R2" },
    { p: "192.168.10.64/26", nh: "ge-0/0/1" },
  ];
  const matches = routes.map((r) => sameSubnet(dst, r.p.split("/")[0], Number(r.p.split("/")[1])));
  const best = routes.reduce((bi, r, i) => (matches[i] && Number(r.p.split("/")[1]) > Number(routes[bi].p.split("/")[1]) ? i : bi), 0);
  return (
    <DiagramSvg h={190} label={`Longest-prefix match for ${dst}: every route matches, the /26 is the most specific and wins`}>
      <DTable
        x={30}
        y={20}
        title={`Lookup ${dst}`}
        cols={[
          { label: "PREFIX", w: 170 },
          { label: "NEXT HOP", w: 100 },
          { label: "MATCH?", w: 80 },
        ]}
        rows={routes.map((r, i) => [r.p, r.nh, matches[i] ? "yes" : "no"])}
        highlight={{ row: best, color: D.success }}
      />
      <text x={420} y={70} fill={D.success} fontSize={11} fontWeight={800}>
        Most specific wins
      </text>
      <text x={420} y={90} fill={D.muted} fontSize={10}>
        All four contain {dst};
      </text>
      <text x={420} y={106} fill={D.muted} fontSize={10}>
        the longest prefix (/26) is used.
      </text>
      <text x={420} y={130} fill={D.muted} fontSize={10}>
        (Illustrative table — R1 in the
      </text>
      <text x={420} y={146} fill={D.muted} fontSize={10}>
        lesson has only its two /26s.)
      </text>
    </DiagramSvg>
  );
}

function TtlDiagram() {
  return (
    <DiagramSvg h={180} label="A routing loop between RA and RB: each pass decrements TTL; at 0 the packet is discarded instead of circulating forever">
      <DNode x={160} y={80} label="RA" accent={D.ip} w={80} />
      <DNode x={420} y={80} label="RB" accent={D.ip} w={80} />
      <DArrow x1={202} y1={66} x2={378} y2={66} color={D.warning} label="TTL 3 → 2" />
      <DArrow x1={378} y1={96} x2={202} y2={96} color={D.warning} label="TTL 2 → 1" labelDy={18} />
      <DPill x={160} y={146} text="TTL 1 → 0: discard" color={D.danger} w={150} />
      <text x={320} y={160} fill={D.muted} fontSize={10}>
        (the router also reports it back — ICMP is its own lesson)
      </text>
    </DiagramSvg>
  );
}

function SpecialDiagram() {
  return (
    <DiagramSvg h={200} label="Special prefixes: a /31 point-to-point link uses both addresses as hosts (RFC 3021); a /32 identifies exactly one address such as a loopback or host route">
      <text x={20} y={24} fill={D.violet} fontSize={11} fontWeight={800}>
        /31 — point-to-point (RFC 3021)
      </text>
      <DNode x={110} y={70} label="R-X" sub="10.0.0.0/31" accent={D.ip} w={110} />
      <DNode x={330} y={70} label="R-Y" sub="10.0.0.1/31" accent={D.ip} w={110} />
      <DLink x1={165} y1={70} x2={275} y2={70} color={D.violet} />
      <text x={420} y={64} fill={D.muted} fontSize={10}>
        2 addresses, both usable;
      </text>
      <text x={420} y={80} fill={D.muted} fontSize={10}>
        no network/broadcast pair.
      </text>
      <text x={20} y={128} fill={D.cyan} fontSize={11} fontWeight={800}>
        /32 — exactly one address
      </text>
      <DNode x={110} y={168} label="Loopback" sub="192.0.2.1/32" accent={D.cyan} w={120} />
      <text x={200} y={164} fill={D.muted} fontSize={10}>
        Used for loopbacks and host routes. It is not a subnet with hosts in it.
      </text>
    </DiagramSvg>
  );
}

export function Ipv4DeepDiveContent() {
  return (
    <div className="space-y-12">
      <GuideSection id="v4d-header" eyebrow="RFC 791" title="The IPv4 header" tone="ip">
        <DiagramFrame caption="20 bytes without options (IHL = 5).">
          <HeaderDiagram />
        </DiagramFrame>
        <FieldTable
          title="Key fields"
          columns={["Field", "Meaning"]}
          rows={[
            ["Version / IHL", "4, and header length in 32-bit words (5 = 20 bytes)"],
            ["Total Length", "Header plus payload, in bytes"],
            ["Identification / Flags / Fragment Offset", "Fragmentation control; DF means don't fragment"],
            ["TTL", "Hop limit; decremented by every router (RFC 1812)"],
            ["Protocol", "Payload type: 1 ICMP, 6 TCP, 17 UDP"],
            ["Header Checksum", "Ones'-complement checksum of the header only, recomputed per hop"],
          ]}
        />
      </GuideSection>

      <GuideSection id="v4d-prefixes" eyebrow="CIDR" title="Prefix length vs block size" tone="violet">
        <DiagramFrame caption="Each extra prefix bit halves the block. The ordinary host count is the block size minus 2 (network and broadcast).">
          <PrefixDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="v4d-cidr" eyebrow="RFC 4632" title="Aggregation: many routes as one" tone="success">
        <DiagramFrame caption="Contiguous, aligned blocks can be summarised by a shorter prefix.">
          <CidrDiagram />
        </DiagramFrame>
        <p>CIDR replaced the old classful scheme. The first octet no longer implies a network size: <Mono>192.168.10.0/26</Mono> and <Mono>192.168.0.0/16</Mono> are both perfectly valid.</p>
      </GuideSection>

      <GuideSection id="v4d-lpm" eyebrow="Forwarding" title="Longest-prefix match" tone="cyan">
        <DiagramFrame caption="Routers choose the most specific matching route.">
          <LpmDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="v4d-ttl" eyebrow="Safety" title="Why TTL exists" tone="warning">
        <DiagramFrame caption="TTL guarantees a looping packet eventually dies.">
          <TtlDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="v4d-special" eyebrow="Advanced context" title="/31 and /32 are special cases" tone="violet">
        <DiagramFrame caption="The network/broadcast rule from the lesson applies to /30 and shorter. It does not apply to /31 or /32.">
          <SpecialDiagram />
        </DiagramFrame>
        <Callout tone="warning" title="Scope">
          These are scoped exceptions for point-to-point links and single addresses. The lesson&apos;s /26s follow the ordinary rule.
        </Callout>
      </GuideSection>

      <GuideSection id="v4d-private" eyebrow="RFC 1918" title="Private address ranges" tone="cyan">
        <FieldTable
          title="Private IPv4 blocks"
          columns={["Block", "Size"]}
          rows={[
            ["10.0.0.0/8", "16,777,216 addresses"],
            ["172.16.0.0/12", "1,048,576 addresses"],
            [`${networkOf("192.168.10.10", 16)}/16`, "65,536 addresses (this lesson lives here)"],
          ]}
        />
      </GuideSection>

      <GuideSection id="v4d-workflow" eyebrow="Workflow" title="Troubleshooting IPv4 reachability" tone="danger">
        <FlowSteps
          steps={[
            { title: "Host config", body: "Check the address, prefix/mask and gateway. Is the gateway inside the host's own subnet?", tone: "cyan" },
            { title: "On-link decision", body: "AND both addresses with the host's mask. Do you expect on-link or via the gateway?", tone: "violet" },
            { title: "Next-hop resolution", body: "Is there a complete ARP entry for the next hop (the gateway, or the host itself if on-link)?", tone: "warning" },
            { title: "Router", body: "Is there a route for the destination (connected or otherwise), and is TTL large enough?", tone: "ip" },
            { title: "Return path", body: "Does the destination have a correct mask and gateway to reply?", tone: "success" },
          ]}
        />
        <ChecklistCard tone="warning" title="Common traps" mark="!" items={["A mask that is too short makes remote hosts look on-link", "A mask that is too long makes local hosts look remote", "Proxy ARP can hide a wrong mask. It doesn't fix it"]} />
      </GuideSection>

      <GuideSection id="v4d-glossary" eyebrow="Glossary" title="Deep-dive terms" tone="violet">
        <Glossary
          items={[
            { term: "IHL", def: "Internet Header Length, in 32-bit words." },
            { term: "DF", def: "Don't Fragment flag." },
            { term: "Longest-prefix match", def: "The forwarding rule that picks the most specific route." },
            { term: "Aggregation / summarisation", def: "Advertising several aligned prefixes as one shorter prefix." },
            { term: "RFC 3021", def: "Allows /31 on point-to-point links." },
            { term: "Proxy ARP", def: "A router answering ARP on behalf of another host. It is off in this lesson." },
          ]}
        />
      </GuideSection>
    </div>
  );
}
