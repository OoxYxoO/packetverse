import { Callout, CompareCards, DArrow, DIAGRAM as D, DiagramFrame, DiagramSvg, DNode, FlowSteps, Glossary, GuideSection } from "@/components/lesson/GuideBlocks";
import { DTable } from "@/components/lesson/FundamentalsGuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { LadderDiagram, SeqLanes } from "@/components/lesson/TroubleshootingGuideSvg";

export const L3_DEEP_DIVE_SECTIONS: LessonGuideSectionLink[] = [
  { id: "l3d-connected", label: "Connected routes" },
  { id: "l3d-local", label: "Local vs remote" },
  { id: "l3d-arp", label: "ARP" },
  { id: "l3d-l2l3", label: "Gateway MAC vs destination IP" },
  { id: "l3d-lpm", label: "Longest-prefix match" },
  { id: "l3d-mask", label: "Subnet-mask errors" },
  { id: "l3d-routes", label: "Static & dynamic routes" },
  { id: "l3d-ttl", label: "TTL" },
  { id: "l3d-icmp", label: "ICMP unreachable" },
  { id: "l3d-asym", label: "Asymmetric paths" },
  { id: "l3d-ladder", label: "Troubleshooting ladder" },
  { id: "l3d-glossary", label: "Glossary" },
];

function ConnectedDiagram() {
  return (
    <DiagramSvg h={140} label="Configuring an address with a prefix creates a connected route; configuring a gateway creates a default route">
      <DNode x={120} y={50} label="eth0 config" sub="10.10.10.10/24 · gw 10.10.10.1" accent={D.cyan} w={200} h={50} />
      <DArrow x1={222} y1={40} x2={380} y2={30} color={D.success} />
      <DArrow x1={222} y1={60} x2={380} y2={80} color={D.violet} />
      <text x={510} y={34} textAnchor="middle" fill={D.success} fontSize={10} fontFamily="monospace">
        10.10.10.0/24 connected eth0
      </text>
      <text x={510} y={84} textAnchor="middle" fill={D.violet} fontSize={10} fontFamily="monospace">
        0.0.0.0/0 via 10.10.10.1
      </text>
      <text x={320} y={124} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        The prefix length is not a detail: it becomes a route.
      </text>
    </DiagramSvg>
  );
}

function LocalRemoteDiagram() {
  return (
    <DiagramSvg h={170} label="Local vs remote examples for a /24 host at 10.10.10.10">
      <DTable
        x={60}
        y={8}
        title="Host 10.10.10.10/24 — where does each destination go?"
        cols={[
          { label: "DESTINATION", w: 160 },
          { label: "MATCHING ROUTE", w: 210 },
          { label: "ARP FOR", w: 150 },
        ]}
        rows={[
          ["10.10.10.50", "10.10.10.0/24 connected", "10.10.10.50"],
          ["10.10.20.20", "0.0.0.0/0", "10.10.10.1 (gateway)"],
          ["10.20.20.20", "0.0.0.0/0", "10.10.10.1 (gateway)"],
          ["10.10.10.255", "connected (broadcast)", "none — FF:FF:FF:FF:FF:FF"],
        ]}
      />
    </DiagramSvg>
  );
}

function ArpDiagram() {
  return (
    <DiagramSvg h={150} label="ARP exchange: broadcast request with an all-zero target hardware address, unicast reply, cached entry with a timeout">
      <SeqLanes
        lanes={[
          { x: 150, label: "Host", color: D.cyan },
          { x: 490, label: "Next hop", color: D.violet },
        ]}
        msgs={[
          { from: 0, to: 1, label: "who-has 10.10.10.1? · dst FF:…:FF · THA 00:…:00", color: D.warning },
          { from: 1, to: 0, label: "10.10.10.1 is-at 00:00:5E:00:53:01 · unicast", color: D.success },
          { from: 0, to: 1, label: "IPv4 frames to that MAC (cached for minutes)" },
        ]}
      />
    </DiagramSvg>
  );
}

function L2L3Diagram() {
  return (
    <DiagramSvg h={160} label="Per hop the Ethernet addresses change while the IP addresses stay end to end">
      <DTable
        x={30}
        y={8}
        title="One echo, three links"
        cols={[
          { label: "LINK", w: 130 },
          { label: "ETHERNET SRC → DST", w: 250 },
          { label: "IPv4 SRC → DST · TTL", w: 200 },
        ]}
        rows={[
          ["CLIENT → R1", "CLIENT → R1 ge-0/0/0", "10.10.10.10 → 10.10.20.20 · 64"],
          ["R1 → R2", "R1 ge-0/0/1 → R2 ge-0/0/0", "10.10.10.10 → 10.10.20.20 · 63"],
          ["R2 → server", "R2 ge-0/0/2 → REMOTE-SERVER", "10.10.10.10 → 10.10.20.20 · 62"],
        ]}
      />
    </DiagramSvg>
  );
}

function LpmDiagram() {
  return (
    <DiagramSvg h={170} label="Longest-prefix match: for 10.10.20.20 a router with /8, /16, /24 and default routes chooses the /24">
      <DTable
        x={60}
        y={8}
        title="A router's table — destination 10.10.20.20"
        cols={[
          { label: "ROUTE", w: 200 },
          { label: "MATCHES?", w: 110 },
          { label: "", w: 210 },
        ]}
        rows={[
          ["0.0.0.0/0", "yes", "least specific"],
          ["10.0.0.0/8", "yes", ""],
          ["10.10.0.0/16", "yes", ""],
          ["10.10.20.0/24", "yes", "← longest: chosen"],
          ["10.10.30.0/24", "no", ""],
        ]}
        highlight={{ row: 3, color: D.success }}
      />
    </DiagramSvg>
  );
}

function MaskErrorsDiagram() {
  return (
    <DiagramSvg h={170} label="Mask too short: remote hosts look local, direct ARP fails. Mask too long: local hosts look remote and go via the gateway">
      <DTable
        x={20}
        y={8}
        title="Mask errors and their fingerprints"
        cols={[
          { label: "ERROR", w: 150 },
          { label: "EFFECT", w: 250 },
          { label: "FINGERPRINT", w: 200 },
        ]}
        rows={[
          ["Too short (/16 for /24)", "some remote hosts look on-link", "ARP for a remote address"],
          ["Too long (/28 for /24)", "some local hosts look remote", "local peers sent via gateway"],
          ["Wrong gateway", "off-link traffic goes nowhere", "ARP for the gateway fails"],
          ["Right mask, wrong address", "duplicates or wrong subnet", "gratuitous-ARP conflicts"],
        ]}
      />
    </DiagramSvg>
  );
}

function RoutesDiagram() {
  return (
    <DiagramSvg h={150} label="Route sources: connected, static and dynamic routing protocols; the most specific route wins, administrative distance breaks ties between sources">
      <DNode x={110} y={45} label="connected" sub="from interfaces" accent={D.success} w={140} />
      <DNode x={320} y={45} label="static" sub="configured by hand" accent={D.cyan} w={140} />
      <DNode x={530} y={45} label="dynamic" sub="OSPF, IS-IS, BGP…" accent={D.violet} w={140} />
      <DArrow x1={110} y1={68} x2={290} y2={112} color={D.muted} width={1.3} />
      <DArrow x1={320} y1={68} x2={320} y2={108} color={D.muted} width={1.3} />
      <DArrow x1={530} y1={68} x2={350} y2={112} color={D.muted} width={1.3} />
      <text x={320} y={130} textAnchor="middle" fill={D.text} fontSize={10} fontWeight={700}>
        RIB → FIB: longest prefix first; administrative distance only between equal prefixes
      </text>
    </DiagramSvg>
  );
}

function TtlDiagram() {
  return (
    <DiagramSvg h={130} label="TTL decreases by one at each router; if it reaches zero the router discards the packet and returns ICMP Time Exceeded, which traceroute uses">
      {[64, 63, 62, 1, 0].map((t, i) => {
        const x = 70 + i * 125;
        const last = t === 0;
        return (
          <g key={t}>
            <DNode x={x} y={50} label={last ? "router" : i === 0 ? "sender" : "router"} sub={`TTL ${t}${last ? " → drop" : ""}`} accent={last ? D.danger : D.violet} w={110} />
            {i < 4 && <DArrow x1={x + 57} y1={50} x2={x + 68} y2={50} color={D.muted} width={1.2} />}
          </g>
        );
      })}
      <text x={320} y={110} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        TTL 0 → ICMP Time Exceeded (type 11) back to the source — the basis of traceroute and of loop protection.
      </text>
    </DiagramSvg>
  );
}

function IcmpDiagram() {
  return (
    <DiagramSvg h={170} label="ICMP destination unreachable codes and who generates them">
      <DTable
        x={20}
        y={8}
        title="Who says 'unreachable', and what it means"
        cols={[
          { label: "MESSAGE", w: 230 },
          { label: "SENT BY", w: 150 },
          { label: "MEANS", w: 220 },
        ]}
        rows={[
          ["Host unreachable (local)", "the sender's own stack", "ARP for the next hop failed"],
          ["Type 3 code 0/1 net/host unreachable", "a router", "no route / next hop failed there"],
          ["Type 3 code 3 port unreachable", "the destination host", "UDP port closed"],
          ["Type 3 code 13 admin prohibited", "a filter", "blocked by policy"],
        ]}
        highlight={{ row: 0, color: D.warning }}
      />
    </DiagramSvg>
  );
}

function AsymDiagram() {
  return (
    <DiagramSvg h={150} label="Asymmetric path: the request goes through R1 and R2 while the reply returns through a different router; troubleshoot both directions">
      <DNode x={80} y={75} label="A" accent={D.cyan} w={60} />
      <DNode x={320} y={30} label="R1" accent={D.violet} w={70} />
      <DNode x={320} y={120} label="R3" accent={D.violet} w={70} />
      <DNode x={560} y={75} label="B" accent={D.success} w={60} />
      <DArrow x1={112} y1={65} x2={283} y2={35} color={D.cyan} label="request" />
      <DArrow x1={357} y1={35} x2={528} y2={65} color={D.cyan} />
      <DArrow x1={528} y1={85} x2={357} y2={115} color={D.warning} label="reply" labelDy={16} />
      <DArrow x1={283} y1={115} x2={112} y2={85} color={D.warning} />
    </DiagramSvg>
  );
}

export function L3DeepDiveContent() {
  return (
    <div className="space-y-12">
      <GuideSection id="l3d-connected" eyebrow="Host routing" title="Connected route creation" tone="ip">
        <DiagramFrame caption="Address + prefix → a route.">
          <ConnectedDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="l3d-local" eyebrow="Host routing" title="Local vs remote" tone="ip">
        <DiagramFrame caption="Every send starts with a table lookup on the host.">
          <LocalRemoteDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="l3d-arp" eyebrow="ARP" title="Address Resolution Protocol" tone="warning">
        <DiagramFrame caption="Only within one broadcast domain.">
          <ArpDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="l3d-l2l3" eyebrow="Addressing" title="Gateway MAC vs destination IP" tone="violet">
        <DiagramFrame caption="Layer 2 is per link; Layer 3 is end to end.">
          <L2L3Diagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="l3d-lpm" eyebrow="Forwarding" title="Longest-prefix match" tone="success">
        <DiagramFrame caption="The most specific matching route wins — on routers and hosts alike.">
          <LpmDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="l3d-mask" eyebrow="Faults" title="Subnet-mask errors" tone="danger">
        <DiagramFrame caption="Too short and too long fail in opposite ways.">
          <MaskErrorsDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="l3d-routes" eyebrow="Routing" title="Static and dynamic routes" tone="cyan">
        <DiagramFrame caption="Many sources, one forwarding table.">
          <RoutesDiagram />
        </DiagramFrame>
        <CompareCards
          items={[
            { title: "Static", tone: "cyan", tag: "configured", points: ["Predictable", "No reaction to failures unless tracked", "Easy to forget"] },
            { title: "Dynamic", tone: "violet", tag: "protocol", points: ["Adapts to failures", "Needs adjacency/session health", "Check the protocol's own state"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="l3d-ttl" eyebrow="IPv4" title="TTL" tone="violet">
        <DiagramFrame caption="A hop counter, a loop guard, and traceroute's engine.">
          <TtlDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="l3d-icmp" eyebrow="ICMP" title="Unreachable messages" tone="warning">
        <DiagramFrame caption="Always ask who generated the error.">
          <IcmpDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="l3d-asym" eyebrow="Paths" title="Asymmetric paths" tone="cyan">
        <DiagramFrame caption="A working request path says nothing about the reply path.">
          <AsymDiagram />
        </DiagramFrame>
        <Callout tone="cyan" title="Troubleshoot both directions">
          Check the route back as well as the route there. Stateful devices (firewalls, NAT) on only one of the two paths often break asymmetric flows.
        </Callout>
      </GuideSection>

      <GuideSection id="l3d-ladder" eyebrow="Ladder" title="A Layer-3 troubleshooting ladder" tone="cyan">
        <DiagramFrame caption="Start at the sender's own decision.">
          <DiagramSvg h={170} label="Layer 3 ladder">
            <LadderDiagram
              rows={[
                { rung: "Link / Ethernet", evidence: "up? frames forwarded?", status: "ok" },
                { rung: "ARP / neighbor", evidence: "next hop resolved? which next hop?", status: "suspect" },
                { rung: "Host addressing", evidence: "address, prefix, gateway vs plan", status: "suspect" },
                { rung: "Host route choice", evidence: "ip route get <dst>", status: "ok" },
                { rung: "Router forwarding", evidence: "LPM, next hop, TTL, both directions", status: "ok" },
                { rung: "Destination", evidence: "answers from its own segment?", status: "ok" },
              ]}
            />
          </DiagramSvg>
        </DiagramFrame>
        <FlowSteps
          steps={[
            { title: "Scope", body: "Which destinations fail, which work?", tone: "cyan" },
            { title: "Sender first", body: "Its table, its ARP, its choice of next hop.", tone: "violet" },
            { title: "Follow the packet", body: "Is it seen where it should be?", tone: "warning" },
            { title: "Fix where it breaks", body: "Not where it's convenient.", tone: "success" },
          ]}
        />
      </GuideSection>

      <GuideSection id="l3d-glossary" eyebrow="Glossary" title="Terms" tone="cyan">
        <Glossary
          items={[
            { term: "RIB / FIB", def: "Routing Information Base (all routes) / Forwarding Information Base (the chosen ones)." },
            { term: "Administrative distance", def: "Preference between route sources for the SAME prefix." },
            { term: "ICMP redirect", def: "A router telling a host there is a better first hop on the same segment." },
            { term: "Asymmetric routing", def: "Request and reply taking different paths." },
            { term: "INCOMPLETE", def: "An ARP entry still waiting for a reply." },
          ]}
        />
      </GuideSection>
    </div>
  );
}
