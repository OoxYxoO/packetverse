import { Callout, ChecklistCard, CompareCards, DArrow, DIAGRAM as D, DiagramFrame, DiagramSvg, DLink, DNode, DPill, FlowSteps, Glossary, GuideSection, Mono } from "@/components/lesson/GuideBlocks";
import { DFieldRow } from "@/components/lesson/FundamentalsGuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { BIG_DATA, ECHO_IDENTIFIER, FAULT_MTU, FIXED_DATA, IC_ADDR, INITIAL_TTL, PING_DATA } from "@/lib/sim-engine/scenarios/icmpDiagnostics";

export const IC_LESSON_SECTIONS: LessonGuideSectionLink[] = [
  { id: "ic-mission", label: "The mission" },
  { id: "ic-position", label: "ICMP inside IPv4" },
  { id: "ic-ping", label: "Ping and TTL" },
  { id: "ic-echo", label: "Identifier & sequence" },
  { id: "ic-trace", label: "Traceroute" },
  { id: "ic-pmtu", label: "MTU, DF and 3/4" },
  { id: "ic-fix", label: "The repair math" },
  { id: "ic-verify", label: "Verification" },
  { id: "ic-model", label: "Mental model" },
  { id: "ic-glossary", label: "Glossary" },
  { id: "ic-recap", label: "Recap" },
];

const ICMP = "#f472b6";

function PositionDiagram() {
  return (
    <DiagramSvg h={170} label="Frame layout: Ethernet header, IPv4 header with Protocol 1, ICMP header with Type, Code, Checksum, Identifier and Sequence, then data, then FCS. There is no TCP or UDP header.">
      <DFieldRow
        x={20}
        y={30}
        h={44}
        fields={[
          { label: "Ethernet", sub: "14 B", w: 90 },
          { label: "IPv4", sub: "Protocol = 1", w: 120, color: D.ip, strong: true },
          { label: "Type·Code", sub: "8/0", w: 90, color: ICMP, strong: true },
          { label: "Checksum", w: 80, color: ICMP },
          { label: "Id · Seq", sub: `${ECHO_IDENTIFIER} · 1`, w: 90, color: ICMP },
          { label: "Data", sub: `${PING_DATA} B`, w: 70, color: D.faint },
          { label: "FCS", w: 50 },
        ]}
      />
      <text x={20} y={104} fill={D.danger} fontSize={11} fontWeight={700}>
        ✕ no TCP header · ✕ no UDP header · ✕ no ports
      </text>
      <text x={20} y={126} fill={D.muted} fontSize={10}>
        The IPv4 Protocol field (1) is what tells the receiver an ICMP message follows.
      </text>
      <text x={20} y={146} fill={D.muted} fontSize={10}>
        IPv4 total length = 20 + 8 + {PING_DATA} = {20 + 8 + PING_DATA} bytes.
      </text>
    </DiagramSvg>
  );
}

function PingDiagram() {
  const xs = [70, 240, 410, 580];
  const names = ["HOST-A", "R1", "R2", "HOST-B"];
  return (
    <DiagramSvg h={220} label={`Echo Request TTL ${INITIAL_TTL} from HOST-A, 63 after R1, 62 after R2, arriving at HOST-B with 62; Echo Reply starts again at ${INITIAL_TTL} and arrives at HOST-A with 62`}>
      {names.map((n, i) => (
        <DNode key={n} x={xs[i]} y={110} label={n} accent={i === 0 || i === 3 ? D.cyan : D.ip} w={100} />
      ))}
      {[0, 1, 2].map((i) => (
        <DArrow key={`rq-${i}`} x1={xs[i] + 52} y1={96} x2={xs[i + 1] - 52} y2={96} color={ICMP} label={`TTL ${INITIAL_TTL - i}`} />
      ))}
      {[2, 1, 0].map((i) => (
        <DArrow key={`rp-${i}`} x1={xs[i + 1] - 52} y1={124} x2={xs[i] + 52} y2={124} color={D.success} label={`TTL ${INITIAL_TTL - (2 - i)}`} labelDy={18} />
      ))}
      <text x={20} y={30} fill={ICMP} fontSize={11} fontWeight={700}>
        Echo Request 8/0 →
      </text>
      <text x={20} y={190} fill={D.success} fontSize={11} fontWeight={700}>
        ← Echo Reply 0/0 (a new packet, TTL {INITIAL_TTL} again)
      </text>
      <text x={330} y={30} fill={D.muted} fontSize={10}>
        Routers decrement. Destinations don&apos;t.
      </text>
    </DiagramSvg>
  );
}

function EchoMatchDiagram() {
  return (
    <DiagramSvg h={160} label={`The Echo Reply copies the Identifier ${ECHO_IDENTIFIER}, the Sequence Number and the data from the Echo Request; only Type, checksum, addresses and TTL differ`}>
      <text x={20} y={22} fill={ICMP} fontSize={10.5} fontWeight={700}>
        Echo Request (HOST-A → HOST-B)
      </text>
      <DFieldRow x={20} y={30} h={34} fields={[{ label: "Type 8", w: 80, color: ICMP, strong: true }, { label: "Code 0", w: 80 }, { label: `Id ${ECHO_IDENTIFIER}`, w: 110, color: D.warning, strong: true }, { label: "Seq 1", w: 90, color: D.warning, strong: true }, { label: `Data ${PING_DATA} B`, w: 110 }]} />
      <text x={20} y={94} fill={D.success} fontSize={10.5} fontWeight={700}>
        Echo Reply (HOST-B → HOST-A)
      </text>
      <DFieldRow x={20} y={102} h={34} fields={[{ label: "Type 0", w: 80, color: D.success, strong: true }, { label: "Code 0", w: 80 }, { label: `Id ${ECHO_IDENTIFIER}`, w: 110, color: D.warning, strong: true }, { label: "Seq 1", w: 90, color: D.warning, strong: true }, { label: "same data", w: 110 }]} />
      <text x={510} y={90} fill={D.warning} fontSize={10}>
        copied →
      </text>
      <text x={510} y={106} fill={D.warning} fontSize={10}>
        how ping
      </text>
      <text x={510} y={122} fill={D.warning} fontSize={10}>
        matches replies
      </text>
    </DiagramSvg>
  );
}

function TraceDiagram() {
  const xs = [70, 240, 410, 580];
  const rows = [
    { ttl: 1, stop: 1, reply: `Time Exceeded 11/0 from ${IC_ADDR["R1:LAN"]}`, color: D.warning },
    { ttl: 2, stop: 2, reply: `Time Exceeded 11/0 from ${IC_ADDR["R2:TRANSIT"]}`, color: D.warning },
    { ttl: 3, stop: 3, reply: `Echo Reply 0/0 from ${IC_ADDR["HOST-B"]}`, color: D.success },
  ];
  return (
    <DiagramSvg h={250} label={`ICMP Echo-based traceroute: TTL 1 expires at R1 which sends Time Exceeded from ${IC_ADDR["R1:LAN"]}; TTL 2 expires at R2 from ${IC_ADDR["R2:TRANSIT"]}; TTL 3 reaches HOST-B which sends an Echo Reply`}>
      {["HOST-A", "R1", "R2", "HOST-B"].map((n, i) => (
        <text key={n} x={xs[i]} y={24} textAnchor="middle" fill={D.text} fontSize={11} fontWeight={700}>
          {n}
        </text>
      ))}
      {xs.map((x) => (
        <line key={x} x1={x} y1={32} x2={x} y2={214} stroke={D.line} strokeDasharray="3 4" />
      ))}
      {rows.map((r, i) => {
        const y = 58 + i * 58;
        return (
          <g key={r.ttl}>
            <DArrow x1={xs[0]} y1={y} x2={xs[r.stop] - 6} y2={y} color={ICMP} label={`probe TTL ${r.ttl}`} />
            <DArrow x1={xs[r.stop] - 6} y1={y + 16} x2={xs[0] + 6} y2={y + 16} color={r.color} width={1.6} />
            <text x={xs[0] + 14} y={y + 30} fill={r.color} fontSize={9.5}>
              {r.reply}
            </text>
          </g>
        );
      })}
      <text x={20} y={238} fill={D.muted} fontSize={10}>
        This lesson models ICMP-Echo-based traceroute. Other tools use UDP or TCP probes (Deep Dive).
      </text>
    </DiagramSvg>
  );
}

function PmtuDiagram() {
  return (
    <DiagramSvg h={200} label={`A 1500-byte DF Echo Request reaches R1, whose link to R2 has an IP MTU of ${FAULT_MTU}; R1 drops it and returns ICMP Destination Unreachable Type 3 Code 4 with Next-Hop MTU ${FAULT_MTU}`}>
      <DNode x={80} y={80} label="HOST-A" accent={D.cyan} w={100} />
      <DNode x={320} y={80} label="R1" accent={D.ip} w={90} />
      <DNode x={560} y={80} label="R2" accent={D.ip} w={90} />
      <DArrow x1={132} y1={70} x2={273} y2={70} color={ICMP} label="1500 B · DF" />
      <DLink x1={367} y1={80} x2={513} y2={80} color={D.danger} dashed label={`IP MTU ${FAULT_MTU}`} />
      <DArrow x1={273} y1={94} x2={132} y2={94} color={D.warning} label="ICMP 3/4 · MTU 1400" labelDy={18} />
      <DPill x={320} y={150} text="1500 > 1400 and DF set → can't fragment → drop" color={D.danger} w={330} />
      <text x={20} y={188} fill={D.muted} fontSize={10}>
        Small pings (84 B) still pass: routing is fine. Only packets bigger than the path MTU with DF fail.
      </text>
    </DiagramSvg>
  );
}

function RepairMathDiagram() {
  const scale = 0.3;
  const x0 = 170;
  const bar = (y: number, data: number, label: string, ok: boolean) => (
    <g>
      <text x={20} y={y + 10} fill={D.text} fontSize={10.5} fontWeight={700}>
        {label}
      </text>
      <text x={20} y={y + 24} fill={ok ? D.success : D.danger} fontSize={10} fontFamily="monospace">
        20+8+{data} = {28 + data}
      </text>
      <rect x={x0} y={y} width={20 * scale} height={24} fill={D.ip} fillOpacity={0.6} />
      <rect x={x0 + 20 * scale} y={y} width={8 * scale} height={24} fill={ICMP} fillOpacity={0.7} />
      <rect x={x0 + 28 * scale} y={y} width={data * scale} height={24} fill={ok ? D.success : D.danger} fillOpacity={0.35} stroke={ok ? D.success : D.danger} />
    </g>
  );
  return (
    <DiagramSvg h={170} label={`20 + 8 + ${BIG_DATA} = 1500 bytes exceeds the ${FAULT_MTU}-byte MTU; 20 + 8 + ${FIXED_DATA} = 1400 bytes fits exactly; 20 + 8 + 1400 = 1428 does not`}>
      {bar(20, BIG_DATA, "original", false)}
      {bar(60, 1400, "data 1400", false)}
      {bar(100, FIXED_DATA, "data 1372", true)}
      <line x1={x0 + FAULT_MTU * scale} y1={10} x2={x0 + FAULT_MTU * scale} y2={134} stroke={D.warning} strokeWidth={2} strokeDasharray="5 4" />
      <text x={x0 + FAULT_MTU * scale} y={152} textAnchor="middle" fill={D.warning} fontSize={10} fontWeight={700}>
        IP MTU {FAULT_MTU}
      </text>
    </DiagramSvg>
  );
}

export function IcmpLessonGuideContent() {
  return (
    <div className="space-y-12">
      <GuideSection id="ic-mission" eyebrow="This lesson" title="Let the network tell you what's wrong" tone="ip">
        <p>ICMP is how IPv4 reports reachability, path and delivery problems. Every tool in this lesson (ping, traceroute and path-MTU testing) works by sending a packet and reading which ICMP Type and Code come back.</p>
        <Callout tone="ip" title="The core idea">
          The message type <em>is</em> the diagnosis. 0/0 means the destination answered. 11/0 means TTL ran out at this hop. 3/4 means the packet is too big and DF is set.
        </Callout>
      </GuideSection>

      <GuideSection id="ic-position" eyebrow="Encapsulation" title="ICMP rides directly in IPv4" tone="violet">
        <DiagramFrame caption="Protocol 1. No transport layer.">
          <PositionDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="ic-ping" eyebrow="Ping" title="Echo Request, Echo Reply and TTL" tone="cyan">
        <DiagramFrame caption="Each forwarding router subtracts one. The reply is a separate packet, routed on its own.">
          <PingDiagram />
        </DiagramFrame>
        <p>
          TTL is a hop limit, not a timer: <Mono>{INITIAL_TTL}</Mono> → 63 at R1 → 62 at R2. HOST-B receives it with 62 and doesn&apos;t decrement it further.
        </p>
      </GuideSection>

      <GuideSection id="ic-echo" eyebrow="Matching" title="Identifier and Sequence" tone="warning">
        <DiagramFrame caption="The reply copies the Identifier, Sequence and data.">
          <EchoMatchDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="ic-trace" eyebrow="Path discovery" title="ICMP-Echo-based traceroute" tone="violet">
        <DiagramFrame caption="Raising the TTL one step at a time makes each hop reveal itself.">
          <TraceDiagram />
        </DiagramFrame>
        <p>The router that discards the probe sends Time Exceeded from its own address. That source address is what traceroute prints for the hop.</p>
      </GuideSection>

      <GuideSection id="ic-pmtu" eyebrow="The incident" title="MTU, DF and Fragmentation Needed" tone="danger">
        <DiagramFrame caption="The router can't fragment a DF packet, so it tells the sender the MTU instead.">
          <PmtuDiagram />
        </DiagramFrame>
        <CompareCards
          items={[
            { title: "Evidence", tone: "danger", tag: "facts", points: ["Small pings work", "1500-byte DF pings fail", "R1 returns ICMP 3/4 with MTU 1400"] },
            { title: "Not the cause", tone: "success", tag: "ruled out", points: ["TTL (it's 64, and no 11/0 came back)", "Routing (small pings pass)", "DNS (no names involved)"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="ic-fix" eyebrow="Repair" title="Fit the DF packet to the path" tone="success">
        <DiagramFrame caption="IP MTU counts the whole IPv4 packet: IPv4 header + ICMP header + data.">
          <RepairMathDiagram />
        </DiagramFrame>
        <p>
          Keep DF and send <Mono>{FIXED_DATA}</Mono> bytes of data: 20 + 8 + {FIXED_DATA} = {FAULT_MTU}. The IP MTU doesn&apos;t include the Ethernet header or FCS; those are outside the 1400.
        </p>
      </GuideSection>

      <GuideSection id="ic-verify" eyebrow="Verification" title="Prove it both ways" tone="success">
        <FlowSteps
          steps={[
            { title: "Send the fitted probe", body: `DF set, ${FIXED_DATA} bytes of data → 1400-byte IPv4 packet.`, tone: "cyan" },
            { title: "Watch it cross", body: "R1 forwards it onto the 1400-byte link unfragmented.", tone: "ip" },
            { title: "Confirm the reply", body: "HOST-B's 1400-byte Echo Reply comes back with the same id and seq.", tone: "success" },
          ]}
        />
      </GuideSection>

      <GuideSection id="ic-model" eyebrow="Mental model" title="Postcards from the path" tone="cyan">
        <p>Every ICMP message is a postcard sent back to the source. &quot;Arrived&quot; (Echo Reply), &quot;I had to throw it away here, it ran out of hops&quot; (Time Exceeded) and &quot;too big for my next road, and you told me not to cut it&quot; (3/4). Diagnostics is reading the postcards.</p>
      </GuideSection>

      <GuideSection id="ic-glossary" eyebrow="Glossary" title="Terms used in this lesson" tone="violet">
        <Glossary
          items={[
            { term: "Echo Request / Reply", def: "ICMP 8/0 and 0/0, used by ping." },
            { term: "Identifier / Sequence", def: "Echo fields that pair replies with requests." },
            { term: "TTL", def: "IPv4 hop limit. Each forwarding router decrements it." },
            { term: "Time Exceeded (11/0)", def: "Sent by a router that discards a packet whose TTL ran out." },
            { term: "Dest. Unreachable 3/4", def: "Fragmentation Needed and DF set. Carries the next-hop MTU." },
            { term: "IP MTU", def: "Largest IPv4 packet a link carries (header + payload)." },
            { term: "DF", def: "Don't Fragment flag in the IPv4 header." },
          ]}
        />
      </GuideSection>

      <GuideSection id="ic-recap" eyebrow="Recap" title="What you can now read" tone="success">
        <ChecklistCard tone="cyan" title="ICMP & Network Diagnostics" mark="→" items={["ICMP = IPv4 Protocol 1, no ports", "Echo 8/0 → 0/0 with the same id and seq", "TTL −1 per router; 11/0 when it expires", "Traceroute (ICMP Echo) maps hops by rising TTL", "3/4 + next-hop MTU → shrink the DF packet to fit"]} />
      </GuideSection>
    </div>
  );
}
