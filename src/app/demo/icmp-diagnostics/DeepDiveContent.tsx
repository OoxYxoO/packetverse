import { Callout, ChecklistCard, DArrow, DIAGRAM as D, DiagramFrame, DiagramSvg, DNode, DPill, FieldTable, FlowSteps, Glossary, GuideSection } from "@/components/lesson/GuideBlocks";
import { DFieldRow, DTable } from "@/components/lesson/FundamentalsGuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";

export const IC_DEEP_DIVE_SECTIONS: LessonGuideSectionLink[] = [
  { id: "icd-types", label: "Message types" },
  { id: "icd-errors", label: "Error message layout" },
  { id: "icd-rules", label: "Error-message rules" },
  { id: "icd-who", label: "Who generates what" },
  { id: "icd-trace", label: "Traceroute variants" },
  { id: "icd-pmtud", label: "PMTUD loop" },
  { id: "icd-mtu", label: "IP MTU vs frame" },
  { id: "icd-workflow", label: "Workflow" },
  { id: "icd-glossary", label: "Glossary" },
];
const ICMP = "#f472b6";

function TypesDiagram() {
  return (
    <DiagramSvg h={200} label="Common ICMPv4 types: 0 Echo Reply, 3 Destination Unreachable with codes 0 net, 1 host, 3 port, 4 fragmentation needed, 8 Echo Request, 11 Time Exceeded with code 0 TTL in transit and 1 reassembly">
      <DTable
        x={20}
        y={10}
        title="Common ICMPv4 Type / Code"
        cols={[
          { label: "TYPE", w: 60 },
          { label: "CODE", w: 60 },
          { label: "MEANING", w: 300 },
          { label: "KIND", w: 90 },
        ]}
        rows={[
          ["0", "0", "Echo Reply", "query"],
          ["8", "0", "Echo Request", "query"],
          ["3", "0/1/3", "Net / Host / Port Unreachable", "error"],
          ["3", "4", "Fragmentation Needed and DF set", "error"],
          ["11", "0", "TTL exceeded in transit", "error"],
          ["11", "1", "Fragment reassembly time exceeded", "error"],
        ]}
        highlight={{ row: 3, color: D.warning }}
      />
    </DiagramSvg>
  );
}

function ErrorLayoutDiagram() {
  return (
    <DiagramSvg h={170} label="An ICMP error message: new IPv4 header, ICMP Type, Code, Checksum, 4 bytes unused or next-hop MTU, then the original datagram's IPv4 header and the first 8 bytes of its payload">
      <DFieldRow
        x={20}
        y={30}
        h={44}
        fields={[
          { label: "IPv4", sub: "router → source", w: 110, color: D.ip },
          { label: "Type·Code", sub: "11/0 or 3/4", w: 90, color: ICMP, strong: true },
          { label: "Checksum", w: 70, color: ICMP },
          { label: "unused / MTU", sub: "4 B", w: 90, color: ICMP },
          { label: "Original IPv4 hdr", sub: "20 B", w: 120, color: D.warning, strong: true },
          { label: "First 8 B", sub: "Echo id/seq", w: 100, color: D.warning },
        ]}
      />
      <text x={20} y={104} fill={D.text} fontSize={10.5}>
        The quoted original header + 8 bytes let the sender match the error to the packet that caused it.
      </text>
      <text x={20} y={124} fill={D.muted} fontSize={10}>
        For an Echo, the 8 bytes contain Type, Code, Checksum, Identifier and Sequence. For UDP or TCP, they include the ports.
      </text>
    </DiagramSvg>
  );
}

function WhoDiagram() {
  return (
    <DiagramSvg h={190} label="Hosts answer Echo Requests addressed to them; routers generate Time Exceeded, Fragmentation Needed and network or host unreachable while forwarding; a destination host generates port unreachable">
      <DNode x={140} y={50} label="Router (forwarding)" accent={D.ip} w={200} />
      <DNode x={480} y={50} label="Destination host" accent={D.cyan} w={200} />
      {["11/0 Time Exceeded", "3/4 Frag. Needed", "3/0, 3/1 Net/Host Unr."].map((t, i) => (
        <DPill key={t} x={140} y={100 + i * 30} text={t} color={D.warning} w={190} />
      ))}
      {["0/0 Echo Reply", "3/3 Port Unreachable"].map((t, i) => (
        <DPill key={t} x={480} y={100 + i * 30} text={t} color={D.success} w={190} />
      ))}
    </DiagramSvg>
  );
}

function TraceVariantsDiagram() {
  return (
    <DiagramSvg h={170} label="Traceroute variants: ICMP Echo probes end with an Echo Reply; UDP probes to high ports end with Port Unreachable; TCP SYN probes end with SYN-ACK or RST; all use rising TTL and Time Exceeded for intermediate hops">
      <DTable
        x={20}
        y={10}
        title="Same trick, different probes"
        cols={[
          { label: "PROBE", w: 140 },
          { label: "INTERMEDIATE HOP", w: 170 },
          { label: "DESTINATION REACHED", w: 250 },
        ]}
        rows={[
          ["ICMP Echo (this lesson)", "11/0 Time Exceeded", "0/0 Echo Reply"],
          ["UDP to high ports", "11/0 Time Exceeded", "3/3 Port Unreachable"],
          ["TCP SYN", "11/0 Time Exceeded", "SYN-ACK or RST"],
        ]}
        highlight={{ row: 0, color: ICMP }}
      />
    </DiagramSvg>
  );
}

function PmtudLoopDiagram() {
  return (
    <DiagramSvg h={200} label="Path MTU Discovery: the sender sends with DF, receives 3/4 with a next-hop MTU, lowers its path MTU estimate, and retries until packets pass">
      <DNode x={110} y={40} label="Send with DF" accent={D.cyan} w={150} />
      <DNode x={320} y={40} label="Router: too big?" accent={D.ip} w={150} />
      <DNode x={530} y={40} label="Delivered" accent={D.success} w={130} />
      <DNode x={320} y={150} label="3/4 + next-hop MTU" accent={D.warning} w={180} />
      <DNode x={110} y={150} label="Lower path MTU" accent={D.violet} w={150} />
      <DArrow x1={186} y1={40} x2={244} y2={40} color={D.muted} />
      <DArrow x1={396} y1={40} x2={464} y2={40} color={D.success} label="fits" />
      <DArrow x1={320} y1={62} x2={320} y2={128} color={D.warning} />
      <text x={330} y={100} fill={D.warning} fontSize={10} fontWeight={700}>
        too big
      </text>
      <DArrow x1={229} y1={150} x2={186} y2={150} color={D.warning} />
      <DArrow x1={110} y1={128} x2={110} y2={62} color={D.violet} />
      <text x={20} y={194} fill={D.muted} fontSize={10}>
        If ICMP is filtered, this loop breaks: a &quot;PMTU black hole&quot;.
      </text>
    </DiagramSvg>
  );
}

function MtuVsFrameDiagram() {
  return (
    <DiagramSvg h={150} label="An Ethernet frame carrying a 1400-byte IPv4 packet: 14-byte Ethernet header, 1400-byte IPv4 packet counted by the IP MTU, 4-byte FCS outside it">
      <DFieldRow x={20} y={40} h={40} fields={[{ label: "Eth 14 B", w: 80 }, { label: "IPv4 packet 1400 B (the IP MTU counts this)", w: 440, color: D.ip, strong: true }, { label: "FCS 4", w: 60 }]} />
      <text x={20} y={110} fill={D.muted} fontSize={10}>
        IP MTU 1400 means 1400 bytes of IPv4 (header + ICMP + data). The Ethernet header and FCS are extra.
      </text>
    </DiagramSvg>
  );
}

export function IcmpDeepDiveContent() {
  return (
    <div className="space-y-12">
      <GuideSection id="icd-types" eyebrow="RFC 792" title="ICMP message types" tone="violet">
        <DiagramFrame caption="Queries (Echo) and errors (Unreachable, Time Exceeded).">
          <TypesDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="icd-errors" eyebrow="Anatomy" title="What an ICMP error carries" tone="warning">
        <DiagramFrame caption="Errors quote the original packet so the sender can tell which packet failed.">
          <ErrorLayoutDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="icd-rules" eyebrow="RFC 1122 / 1812" title="Error-message rules" tone="danger">
        <ChecklistCard
          tone="warning"
          title="An ICMP error is never sent about…"
          mark="✕"
          items={["Another ICMP error message (prevents error storms)", "A packet sent to a broadcast or multicast address", "A packet with a source address that isn't a single host", "Any fragment but the first"]}
        />
        <Callout tone="cyan" title="Rate limiting">
          Routers commonly rate-limit ICMP generation. A missing Time Exceeded (&quot;* * *&quot; in traceroute) does not prove the hop is down.
        </Callout>
      </GuideSection>

      <GuideSection id="icd-who" eyebrow="Origins" title="Router-generated vs host-generated ICMP" tone="ip">
        <DiagramFrame caption="Who sends a message tells you where the problem was seen.">
          <WhoDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="icd-trace" eyebrow="Tools" title="Traceroute variants" tone="violet">
        <DiagramFrame caption="Windows tracert uses ICMP Echo; classic Unix traceroute uses UDP; tcptraceroute uses TCP.">
          <TraceVariantsDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="icd-pmtud" eyebrow="RFC 1191" title="The Path MTU Discovery loop" tone="success">
        <DiagramFrame caption="DF + Fragmentation Needed = self-tuning packet size.">
          <PmtudLoopDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="icd-mtu" eyebrow="Sizes" title="IP MTU vs Ethernet frame" tone="cyan">
        <DiagramFrame caption="Keep the layers apart when doing MTU math.">
          <MtuVsFrameDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="icd-workflow" eyebrow="Workflow" title="Diagnosing with ICMP" tone="danger">
        <FlowSteps
          steps={[
            { title: "Reachability", body: "Ping the destination. Is there an Echo Reply?", tone: "cyan" },
            { title: "Path", body: "Traceroute. Where do the Time Exceeded messages stop?", tone: "violet" },
            { title: "Size", body: "Ping with DF and growing sizes. Does 3/4 appear, and with which MTU?", tone: "warning" },
            { title: "Fix at the right layer", body: "Adjust the sender's size (or the MSS / link MTU); don't disable DF blindly.", tone: "success" },
          ]}
        />
        <FieldTable
          title="Sizes used in this lesson"
          columns={["ICMP data", "IPv4 total", "vs MTU 1400"]}
          rows={[
            ["56", "84", "fits"],
            ["1372", "1400", "fits exactly"],
            ["1400", "1428", "too big"],
            ["1472", "1500", "too big"],
          ]}
        />
      </GuideSection>

      <GuideSection id="icd-glossary" eyebrow="Glossary" title="Deep-dive terms" tone="violet">
        <Glossary
          items={[
            { term: "PMTUD", def: "Path MTU Discovery (RFC 1191)." },
            { term: "PMTU black hole", def: "DF packets silently dropped because the ICMP 3/4 never arrives." },
            { term: "Quoted datagram", def: "Original IPv4 header + first 8 bytes inside an ICMP error." },
            { term: "Rate limiting", def: "Routers cap how many ICMP errors they generate per second." },
          ]}
        />
      </GuideSection>
    </div>
  );
}
