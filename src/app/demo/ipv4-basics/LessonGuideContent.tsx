import { Callout, ChecklistCard, CompareCards, DArrow, DIAGRAM as D, DiagramFrame, DiagramSvg, DLink, DNode, DPill, DRegion, FlowSteps, Glossary, GuideSection, Mono } from "@/components/lesson/GuideBlocks";
import { DFieldRow } from "@/components/lesson/FundamentalsGuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { GATEWAY, INITIAL_TTL, V4_FAULT_PREFIX, V4_IP, V4_MAC, V4_PREFIX, broadcastOf, ipv4Checksum, maskOf, networkOf, subnetsOf, toBinary } from "@/lib/sim-engine/scenarios/ipv4Basics";

export const V4_LESSON_SECTIONS: LessonGuideSectionLink[] = [
  { id: "v4-mission", label: "The mission" },
  { id: "v4-topology", label: "Two subnets" },
  { id: "v4-binary", label: "Binary boundary" },
  { id: "v4-blocks", label: "The four /26 blocks" },
  { id: "v4-decision", label: "Same-subnet test" },
  { id: "v4-hops", label: "L2 vs L3 per hop" },
  { id: "v4-router", label: "Inside R1" },
  { id: "v4-incident", label: "Wrong-mask incident" },
  { id: "v4-verify", label: "Verification" },
  { id: "v4-model", label: "Mental model" },
  { id: "v4-glossary", label: "Glossary" },
  { id: "v4-recap", label: "Recap" },
];

const A = V4_IP["HOST-A"];
const B = V4_IP["HOST-B"];
const MASK = maskOf(V4_PREFIX);
const cs = (ttl: number) => `0x${ipv4Checksum({ totalLength: 60, id: 0x1a2b, flagsFrag: 0x4000, ttl, protocol: 17, src: A, dst: B }).toString(16).toUpperCase().padStart(4, "0")}`;
const last = (ip: string) => `.${ip.split(".")[3]}`;

function TopologyDiagram() {
  return (
    <DiagramSvg h={210} label={`HOST-A ${A}/${V4_PREFIX} and R1 ge-0/0/0 ${V4_IP.R1L} in ${networkOf(A, V4_PREFIX)}/${V4_PREFIX}; R1 ge-0/0/1 ${V4_IP.R1R} and HOST-B ${B}/${V4_PREFIX} in ${networkOf(B, V4_PREFIX)}/${V4_PREFIX}`}>
      <DRegion x={10} y={20} w={300} h={170} label={`${networkOf(A, V4_PREFIX)}/${V4_PREFIX}`} color={D.cyan} />
      <DRegion x={330} y={20} w={300} h={170} label={`${networkOf(B, V4_PREFIX)}/${V4_PREFIX}`} color={D.violet} />
      <DNode x={70} y={110} label="HOST-A" sub={`${last(A)}/${V4_PREFIX}`} w={96} />
      <DNode x={185} y={110} label="SW-A" accent={D.eth} w={70} />
      <DNode x={320} y={110} label="R1" sub={`${last(V4_IP.R1L)} | ${last(V4_IP.R1R)}`} accent={D.ip} w={90} />
      <DNode x={455} y={110} label="SW-B" accent={D.eth} w={70} />
      <DNode x={570} y={110} label="HOST-B" sub={`${last(B)}/${V4_PREFIX}`} w={96} />
      <DLink x1={118} y1={110} x2={150} y2={110} />
      <DLink x1={220} y1={110} x2={275} y2={110} />
      <DLink x1={365} y1={110} x2={420} y2={110} />
      <DLink x1={490} y1={110} x2={522} y2={110} />
      <text x={70} y={160} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        gw {GATEWAY["HOST-A"]}
      </text>
      <text x={570} y={160} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        gw {GATEWAY["HOST-B"]}
      </text>
      <text x={320} y={160} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        connected routes only
      </text>
    </DiagramSvg>
  );
}

function BinaryDiagram() {
  const rows = [
    { k: "HOST-A", v: toBinary(A), d: A, c: D.text },
    { k: `mask /${V4_PREFIX}`, v: toBinary(MASK), d: MASK, c: D.violet },
    { k: "AND →", v: toBinary(networkOf(A, V4_PREFIX)), d: networkOf(A, V4_PREFIX), c: D.success },
  ];
  // Split each binary string at the prefix boundary (26 bits + 3 dots) so the line never depends on glyph widths.
  const cut = V4_PREFIX + Math.floor(V4_PREFIX / 8);
  const boundary = 400;
  const x0 = 130;
  return (
    <DiagramSvg h={190} label={`${A} AND ${MASK} = ${networkOf(A, V4_PREFIX)}: the first ${V4_PREFIX} bits are network bits, the last ${32 - V4_PREFIX} are host bits`}>
      {rows.map((r, i) => (
        <g key={r.k}>
          <text x={20} y={50 + i * 34} fill={D.muted} fontSize={11} fontWeight={700}>
            {r.k}
          </text>
          <text x={boundary - 5} y={50 + i * 34} textAnchor="end" fill={r.c} fontSize={13} fontFamily="monospace">
            {r.v.slice(0, cut)}
          </text>
          <text x={boundary + 5} y={50 + i * 34} fill={r.c} fontSize={13} fontFamily="monospace">
            {r.v.slice(cut)}
          </text>
          <text x={boundary + 80} y={50 + i * 34} fill={r.c} fontSize={11} fontFamily="monospace">
            {r.d}
          </text>
        </g>
      ))}
      <line x1={boundary} y1={26} x2={boundary} y2={128} stroke={D.warning} strokeWidth={2} strokeDasharray="4 3" />
      <text x={x0 + (boundary - x0) / 2} y={152} textAnchor="middle" fill={D.violet} fontSize={10.5} fontWeight={700}>
        {V4_PREFIX} network bits
      </text>
      <text x={boundary + 30} y={152} textAnchor="middle" fill={D.success} fontSize={10.5} fontWeight={700}>
        {32 - V4_PREFIX} host bits
      </text>
      <text x={20} y={178} fill={D.muted} fontSize={10}>
        A 1 in the mask keeps the address bit; a 0 clears it. The result is the network address.
      </text>
    </DiagramSvg>
  );
}

function BlocksDiagram() {
  const subs = subnetsOf("192.168.10.0", 24, V4_PREFIX);
  const x0 = 20;
  const w = 600;
  const px = (o: number) => x0 + (o / 256) * w;
  const oct = (ip: string) => Number(ip.split(".")[3]);
  return (
    <DiagramSvg h={200} label={`192.168.10.0/24 split into four /26 blocks: ${subs.map((s) => `${s.network} to ${s.broadcast}`).join(", ")}; HOST-A .10 in the first, HOST-B .70 in the second`}>
      {subs.map((s, i) => {
        const c = [D.cyan, D.violet, D.faint, D.faint][i];
        return (
          <g key={s.network}>
            <rect x={px(oct(s.network))} y={60} width={w / 4 - 2} height={44} rx={6} fill={c} fillOpacity={0.12} stroke={c} strokeOpacity={0.7} />
            <text x={px(oct(s.network)) + w / 8} y={78} textAnchor="middle" fill={D.text} fontSize={11} fontWeight={700}>
              {last(s.network)}/{V4_PREFIX}
            </text>
            <text x={px(oct(s.network)) + w / 8} y={95} textAnchor="middle" fill={D.muted} fontSize={9.5} fontFamily="monospace">
              {s.range ? `${last(s.range.first)}–${last(s.range.last)}` : ""} · bc {last(s.broadcast)}
            </text>
            <text x={px(oct(s.network)) + 2} y={122} fill={D.faint} fontSize={9} fontFamily="monospace">
              {oct(s.network)}
            </text>
          </g>
        );
      })}
      <text x={x0 + w - 2} y={122} textAnchor="end" fill={D.faint} fontSize={9} fontFamily="monospace">
        255
      </text>
      <DArrow x1={px(10)} y1={30} x2={px(10)} y2={58} color={D.cyan} />
      <text x={px(10) + 6} y={28} fill={D.cyan} fontSize={10} fontWeight={700}>
        HOST-A {last(A)}
      </text>
      <DArrow x1={px(70)} y1={30} x2={px(70)} y2={58} color={D.violet} />
      <text x={px(70) + 6} y={28} fill={D.violet} fontSize={10} fontWeight={700}>
        HOST-B {last(B)}
      </text>
      <text x={20} y={156} fill={D.text} fontSize={10.5}>
        Block size 2^{32 - V4_PREFIX} = 64 · network = first address · broadcast = last address · 62 ordinary hosts in between
      </text>
      <text x={20} y={176} fill={D.muted} fontSize={10}>
        Borrowing 2 bits from the /24 gives 2² = 4 equal /26 subnets.
      </text>
    </DiagramSvg>
  );
}

function DecisionDiagram() {
  return (
    <DiagramSvg h={200} label={`HOST-A ANDs ${A} and ${B} with ${MASK}: ${networkOf(A, V4_PREFIX)} vs ${networkOf(B, V4_PREFIX)}, different, so the frame goes to gateway ${GATEWAY["HOST-A"]} while the IPv4 destination stays ${B}`}>
      <DNode x={132} y={40} label={`${A} AND ${MASK}`} w={240} accent={D.cyan} />
      <DNode x={132} y={100} label={`${B} AND ${MASK}`} w={240} accent={D.violet} />
      <DPill x={330} y={40} text={networkOf(A, V4_PREFIX)} color={D.cyan} />
      <DPill x={330} y={100} text={networkOf(B, V4_PREFIX)} color={D.violet} />
      <DArrow x1={254} y1={40} x2={285} y2={40} color={D.cyan} />
      <DArrow x1={254} y1={100} x2={285} y2={100} color={D.violet} />
      <text x={420} y={64} fill={D.warning} fontSize={12} fontWeight={800}>
        ≠ → REMOTE
      </text>
      <text x={420} y={84} fill={D.muted} fontSize={10}>
        use the default gateway
      </text>
      <rect x={20} y={138} width={600} height={50} rx={10} fill={D.box} stroke={D.line} />
      <text x={36} y={158} fill={D.eth} fontSize={10.5} fontWeight={700}>
        Ethernet dst: {V4_MAC.R1L} (R1, L2 next hop)
      </text>
      <text x={36} y={178} fill={D.ip} fontSize={10.5} fontWeight={700}>
        IPv4 dst: {B} (HOST-B, unchanged end to end)
      </text>
    </DiagramSvg>
  );
}

function HopsDiagram() {
  const seg = (y: number, title: string, eth: string, ttl: number) => (
    <g>
      <text x={20} y={y - 8} fill={D.muted} fontSize={10} fontWeight={700}>
        {title}
      </text>
      <DFieldRow
        x={20}
        y={y}
        h={40}
        fields={[
          { label: "Ethernet", sub: eth, w: 250, color: D.eth, strong: true },
          { label: "IPv4", sub: `${A} → ${B}`, w: 190, color: D.ip },
          { label: `TTL ${ttl}`, sub: `csum ${cs(ttl)}`, w: 110, color: D.warning, strong: true },
          { label: "UDP", w: 50, color: D.success },
        ]}
      />
    </g>
  );
  return (
    <DiagramSvg h={200} label={`Segment 1 frame ${V4_MAC["HOST-A"]} to ${V4_MAC.R1L} with TTL ${INITIAL_TTL}; segment 2 frame ${V4_MAC.R1R} to ${V4_MAC["HOST-B"]} with TTL ${INITIAL_TTL - 1}; IPv4 source and destination unchanged`}>
      {seg(40, "HOST-A → R1 (192.168.10.0/26 segment)", `${V4_MAC["HOST-A"].slice(-5)} → ${V4_MAC.R1L.slice(-5)} (R1)`, INITIAL_TTL)}
      {seg(146, "R1 → HOST-B (192.168.10.64/26 segment)", `${V4_MAC.R1R.slice(-5)} (R1) → ${V4_MAC["HOST-B"].slice(-5)}`, INITIAL_TTL - 1)}
      <text x={320} y={108} textAnchor="middle" fill={D.warning} fontSize={10.5} fontWeight={700}>
        ↓ R1: new Ethernet header · TTL −1 · checksum recomputed · IPv4 addresses untouched
      </text>
    </DiagramSvg>
  );
}

function IncidentDiagram() {
  return (
    <DiagramSvg h={230} label={`With /${V4_FAULT_PREFIX}, HOST-A computes the same network ${networkOf(A, V4_FAULT_PREFIX)} for itself and ${B}, so it ARPs for ${B} directly; the broadcast stops at R1, which has no Proxy ARP, and nothing answers`}>
      <DNode x={120} y={36} label={`/${V4_FAULT_PREFIX}: ${A} → ${networkOf(A, V4_FAULT_PREFIX)}`} w={220} accent={D.danger} />
      <DNode x={120} y={84} label={`/${V4_FAULT_PREFIX}: ${B} → ${networkOf(B, V4_FAULT_PREFIX)}`} w={220} accent={D.danger} />
      <text x={250} y={64} fill={D.danger} fontSize={11.5} fontWeight={800}>
        = → on-link (wrong)
      </text>
      <DNode x={60} y={170} label="HOST-A" sub={`${last(A)}/${V4_FAULT_PREFIX}`} w={96} accent={D.danger} />
      <DNode x={235} y={170} label="SW-A" accent={D.eth} w={70} />
      <DNode x={405} y={170} label="R1" sub="no Proxy ARP" accent={D.ip} w={100} />
      <DNode x={580} y={170} label="HOST-B" sub="never asked" w={100} accent={D.faint} />
      <DArrow x1={108} y1={170} x2={198} y2={170} color={D.arp} label="who-has .70" />
      <DArrow x1={272} y1={170} x2={353} y2={170} color={D.arp} label="flooded" />
      <DLink x1={457} y1={170} x2={528} y2={170} color={D.danger} dashed />
      <text x={20} y={218} fill={D.muted} fontSize={10}>
        The ARP broadcast stops at R1 (routers don&apos;t forward broadcasts). No reply → HOST-A can&apos;t frame the packet.
      </text>
    </DiagramSvg>
  );
}

export function Ipv4LessonGuideContent() {
  return (
    <div className="space-y-12">
      <GuideSection id="v4-mission" eyebrow="This lesson" title="Where does this packet go next?" tone="ip">
        <p>Every IPv4 host answers the same question for every packet it sends: is the destination on my own network, or do I hand it to my gateway? The answer comes from the host&apos;s own address and mask. This lesson works through that arithmetic, then follows the packet through a router.</p>
        <Callout tone="ip" title="Two destinations in every frame">
          The <strong>IPv4 destination</strong> is the final host and never changes. The <strong>Ethernet destination</strong> is the next device on this one link, which is the gateway when the host is remote.
        </Callout>
      </GuideSection>

      <GuideSection id="v4-topology" eyebrow="Topology" title="Two /26 subnets and one router" tone="cyan">
        <DiagramFrame caption="Each LAN is its own subnet. R1 has one address in each.">
          <TopologyDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="v4-binary" eyebrow="Binary boundary" title="Prefix length, mask and AND" tone="violet">
        <DiagramFrame caption={`/${V4_PREFIX} = ${MASK}. The dashed line is the network/host boundary.`}>
          <BinaryDiagram />
        </DiagramFrame>
        <p>
          The prefix length is simply the number of leading 1s in the mask. <Mono>/{V4_PREFIX}</Mono> means 26 network bits and 6 host bits. ANDing any address with the mask clears the host bits and leaves the network address.
        </p>
      </GuideSection>

      <GuideSection id="v4-blocks" eyebrow="Subnetting" title="The four /26 subnets of 192.168.10.0/24" tone="violet">
        <DiagramFrame caption="Blocks start at multiples of 64. Where an address falls tells you its subnet.">
          <BlocksDiagram />
        </DiagramFrame>
        <p>
          HOST-A is in <Mono>{networkOf(A, V4_PREFIX)}/{V4_PREFIX}</Mono> (broadcast <Mono>{broadcastOf(A, V4_PREFIX)}</Mono>). HOST-B is in <Mono>{networkOf(B, V4_PREFIX)}/{V4_PREFIX}</Mono> (broadcast <Mono>{broadcastOf(B, V4_PREFIX)}</Mono>). The network and broadcast addresses are not ordinary host addresses on these /26s (the /31 and /32 exceptions are in the Deep Dive).
        </p>
      </GuideSection>

      <GuideSection id="v4-decision" eyebrow="The host's decision" title="The same-subnet test" tone="warning">
        <DiagramFrame caption="The host always uses its OWN mask, for both addresses.">
          <DecisionDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="v4-hops" eyebrow="Layers" title="Layer 2 changes per hop; Layer 3 doesn't" tone="ip">
        <DiagramFrame caption="The same IPv4 packet rides in two different Ethernet frames.">
          <HopsDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="v4-router" eyebrow="Inside R1" title="What a router does to a packet" tone="cyan">
        <FlowSteps
          steps={[
            { title: "Accept the frame", body: <>The destination MAC <Mono>{V4_MAC.R1L}</Mono> is R1&apos;s own, so R1 accepts the frame and removes the Ethernet header.</> },
            { title: "Look up the destination", body: <>R1 looks up <Mono>{B}</Mono> and finds the connected route <Mono>{networkOf(B, V4_PREFIX)}/{V4_PREFIX}</Mono> on ge-0/0/1. It needs no routing protocol for that.</> },
            { title: "TTL and checksum", body: <>TTL {INITIAL_TTL} → {INITIAL_TTL - 1}. Because a header field changed, R1 recomputes the header checksum: {cs(INITIAL_TTL)} → {cs(INITIAL_TTL - 1)}.</> },
            { title: "New frame", body: <>R1 wraps the packet in a new Ethernet frame, source <Mono>{V4_MAC.R1R}</Mono>, destination <Mono>{V4_MAC["HOST-B"]}</Mono>, and sends it out ge-0/0/1.</> },
          ]}
        />
      </GuideSection>

      <GuideSection id="v4-incident" eyebrow="Troubleshooting" title="One wrong number: the mask" tone="danger">
        <DiagramFrame caption={`With /${V4_FAULT_PREFIX}, HOST-A never uses its gateway to reach ${B}.`}>
          <IncidentDiagram />
        </DiagramFrame>
        <CompareCards
          items={[
            { title: "What is actually wrong", tone: "danger", tag: "cause", points: [`HOST-A has /${V4_FAULT_PREFIX} instead of /${V4_PREFIX}`, `So ${B} looks on-link`, "So HOST-A ARPs for HOST-B directly", "R1 doesn't do Proxy ARP, so no one answers"] },
            { title: "What is NOT wrong", tone: "success", tag: "healthy", points: ["R1's routes (both connected)", "Both switches", "HOST-B's address and gateway", "DNS (no names are involved)"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="v4-verify" eyebrow="Verification" title="Prove the fix" tone="success">
        <ChecklistCard
          tone="success"
          title={`After restoring /${V4_PREFIX}`}
          mark="✓"
          items={[`HOST-A's AND gives ${networkOf(A, V4_PREFIX)} vs ${networkOf(B, V4_PREFIX)}, so the destination is remote`, `The frame goes to ${V4_MAC.R1L} (the gateway); the IPv4 destination is ${B}`, `R1 forwards with TTL ${INITIAL_TTL - 1}`, "HOST-B receives the packet"]}
        />
      </GuideSection>

      <GuideSection id="v4-model" eyebrow="Mental model" title="Envelope and address label" tone="cyan">
        <p>The IPv4 packet is a letter with the final address written on it. The Ethernet frame is the courier bag for one leg of the trip. At each router the bag is swapped for a new one, and the letter gets one tick on its hop counter (TTL). The host&apos;s mask is its map of the neighbourhood. If the map is wrong, the host tries to hand-deliver letters to addresses that aren&apos;t on its street.</p>
      </GuideSection>

      <GuideSection id="v4-glossary" eyebrow="Glossary" title="Terms used in this lesson" tone="violet">
        <Glossary
          items={[
            { term: "Prefix length", def: "Number of network bits, e.g. /26." },
            { term: "Subnet mask", def: `The prefix written as an address, e.g. ${MASK}.` },
            { term: "Network address", def: "All host bits 0. Identifies the subnet." },
            { term: "Broadcast address", def: "All host bits 1. Reaches every host on the subnet." },
            { term: "Default gateway", def: "The on-link router a host sends off-link traffic to." },
            { term: "TTL", def: "Hop limit. Every router decrements it and discards the packet at 0." },
            { term: "Header checksum", def: "Error check on the IPv4 header. It changes when TTL changes." },
            { term: "CIDR", def: "Classless addressing: the prefix length defines the network, not the first octet." },
          ]}
        />
      </GuideSection>

      <GuideSection id="v4-recap" eyebrow="Recap" title="What you can now explain" tone="success">
        <ChecklistCard tone="cyan" title="IPv4 Addressing & Subnetting" mark="→" items={[`/${V4_PREFIX} = ${MASK}: blocks of 64, 62 ordinary hosts`, "The network address, broadcast address and host range for any address", "The same-subnet test is an AND with your own mask", "Remote → Ethernet to the gateway, IPv4 to the host", "A router decrements TTL, updates the checksum and builds a new frame", "A wrong mask breaks the on-link decision"]} />
      </GuideSection>
    </div>
  );
}
