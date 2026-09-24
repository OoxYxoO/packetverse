import { CompareCards, Callout, ChecklistCard, DiagramFrame, FlowSteps, Glossary, GuideSection, Mono } from "@/components/lesson/GuideBlocks";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { Arrow, C, Device, HeaderField, Svg } from "./guideSvg";

export const FIRST_CONNECTION_GUIDE_SECTIONS: LessonGuideSectionLink[] = [
  { id: "g-mission", label: "Your mission" },
  { id: "g-mac-ip", label: "MAC vs IP" },
  { id: "g-local-remote", label: "Local or remote?" },
  { id: "g-arp-request", label: "ARP request" },
  { id: "g-arp-reply", label: "ARP reply & cache" },
  { id: "g-switch", label: "What the switch does" },
  { id: "g-frame", label: "Frame to the gateway" },
  { id: "g-router", label: "What the router does" },
  { id: "g-tcp", label: "Then TCP & HTTPS" },
  { id: "g-flow", label: "Full packet flow" },
  { id: "g-mistakes", label: "Common mistakes" },
  { id: "g-memorize", label: "What to memorize" },
  { id: "g-glossary", label: "Glossary" },
  { id: "g-recap", label: "Quick recap" },
];

function TopologyDiagram() {
  return (
    <Svg h={190} label="Laptop, switch and router on the LAN 192.168.10.0/24; router and server on the server segment 10.20.20.0/24">
      <rect x={14} y={30} width={400} height={130} rx={14} fill={C.cyan} fillOpacity={0.05} stroke={C.cyan} strokeOpacity={0.35} strokeDasharray="6 5" />
      <text x={28} y={50} fill={C.cyan} fontSize={10} fontWeight={700}>
        LAN 192.168.10.0/24
      </text>
      <rect x={430} y={30} width={196} height={130} rx={14} fill={C.tcp} fillOpacity={0.05} stroke={C.tcp} strokeOpacity={0.35} strokeDasharray="6 5" />
      <text x={444} y={50} fill={C.tcp} fontSize={10} fontWeight={700}>
        SERVER SEGMENT 10.20.20.0/24
      </text>
      <line x1={120} y1={100} x2={210} y2={100} stroke={C.line} strokeWidth={2} />
      <line x1={310} y1={100} x2={380} y2={100} stroke={C.line} strokeWidth={2} />
      <line x1={470} y1={100} x2={520} y2={100} stroke={C.line} strokeWidth={2} />
      <Device x={70} y={100} label="Laptop" sub="192.168.10.10" />
      <Device x={260} y={100} label="Switch" sub="Layer 2" accent={C.eth} />
      <Device x={425} y={100} label="Router" sub="gateway" accent={C.ip} w={96} />
      <Device x={570} y={100} label="Server" sub="10.20.20.20" accent={C.tcp} w={96} />
      <text x={392} y={140} fill={C.muted} fontSize={9} fontFamily="monospace" textAnchor="end">
        .1 (LAN side)
      </text>
      <text x={458} y={140} fill={C.muted} fontSize={9} fontFamily="monospace">
        .1 (server side)
      </text>
    </Svg>
  );
}

function DecisionFlow() {
  const box = "rounded-lg border px-3 py-2 text-center text-xs";
  return (
    <div className="flex flex-col items-center gap-1.5 py-2">
      <div className={box} style={{ borderColor: C.ip, color: C.text }}>
        Destination IP = <span className="pv-mono">10.20.20.20</span>
      </div>
      <span className="text-pv-text-faint">↓</span>
      <div className={box} style={{ borderColor: C.cyan, color: C.text }}>
        Is it inside my subnet <span className="pv-mono">192.168.10.0/24</span>?
      </div>
      <div className="grid w-full max-w-lg grid-cols-2 gap-3 pt-1">
        <div className="flex flex-col items-center gap-1.5">
          <span className="text-[10px] font-bold uppercase text-pv-text-faint">Yes (local)</span>
          <div className={box + " opacity-60"} style={{ borderColor: C.line, color: C.muted }}>
            ARP for the destination itself and send directly
          </div>
        </div>
        <div className="flex flex-col items-center gap-1.5">
          <span className="text-[10px] font-bold uppercase" style={{ color: C.arp }}>
            No (remote) ← our case
          </span>
          <div className={box} style={{ borderColor: C.arp, color: C.text }}>
            Next hop = default gateway <span className="pv-mono">192.168.10.1</span>
          </div>
          <span className="text-pv-text-faint">↓</span>
          <div className={box} style={{ borderColor: C.arp, color: C.text }}>
            Gateway MAC in ARP cache? <b>No</b> → send an ARP request
          </div>
        </div>
      </div>
    </div>
  );
}

function ArpRequestDiagram() {
  return (
    <Svg h={200} label="ARP request broadcast from the laptop, flooded by the switch">
      <Device x={80} y={70} label="Laptop" sub="asks" />
      <Device x={320} y={70} label="Switch" sub="floods" accent={C.eth} />
      <Device x={560} y={70} label="Router" sub="192.168.10.1" accent={C.ip} />
      <Device x={440} y={160} label="Other host" sub="ignores it" accent={C.line} w={110} />
      <Device x={200} y={160} label="Other host" sub="ignores it" accent={C.line} w={110} />
      <Arrow id="ar1" x1={134} y1={70} x2={266} y2={70} color={C.arp} label="BROADCAST" />
      <Arrow id="ar2" x1={374} y1={70} x2={506} y2={70} color={C.arp} label="flooded" />
      <Arrow id="ar3" x1={340} y1={94} x2={420} y2={136} color={C.arp} dashed />
      <Arrow id="ar4" x1={300} y1={94} x2={220} y2={136} color={C.arp} dashed />
      <text x={320} y={20} textAnchor="middle" fill={C.arp} fontSize={11} fontWeight={700}>
        &quot;Who has 192.168.10.1? Tell 192.168.10.10&quot;
      </text>
      <text x={320} y={36} textAnchor="middle" fill={C.muted} fontSize={9.5} fontFamily="monospace">
        Ethernet dst FF:FF:FF:FF:FF:FF · ARP op 1 (request) · target MAC 00:00:00:00:00:00
      </text>
    </Svg>
  );
}

function ArpReplyDiagram() {
  return (
    <Svg h={150} label="ARP reply sent unicast from the router to the laptop">
      <Device x={80} y={60} label="Laptop" sub="caches it" />
      <Device x={320} y={60} label="Switch" sub="forwards" accent={C.eth} />
      <Device x={560} y={60} label="Router" sub="answers" accent={C.ip} />
      <Arrow id="rp1" x1={506} y1={60} x2={374} y2={60} color={C.arp} label="UNICAST" />
      <Arrow id="rp2" x1={266} y1={60} x2={134} y2={60} color={C.arp} label="to Fa0/1 only" />
      <text x={320} y={118} textAnchor="middle" fill={C.arp} fontSize={11} fontWeight={700}>
        &quot;192.168.10.1 is at 02:BB:00:00:00:01&quot;
      </text>
      <text x={320} y={134} textAnchor="middle" fill={C.muted} fontSize={9.5} fontFamily="monospace">
        Ethernet dst 02:AA:00:00:00:01 (laptop) · ARP op 2 (reply)
      </text>
    </Svg>
  );
}

function FrameDiagram() {
  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="flex flex-1 flex-col gap-2 rounded-xl border border-white/10 p-2 sm:flex-row" style={{ background: "#94a3b80d" }}>
          <HeaderField label="Ethernet dst MAC" value="02:BB:00:00:00:01" note="the gateway (learned by ARP)" color={C.arp} strong />
          <HeaderField label="Ethernet src MAC" value="02:AA:00:00:00:01" note="the laptop" color={C.eth} />
        </div>
        <div className="flex flex-1 flex-col gap-2 rounded-xl border border-white/10 p-2 sm:flex-row" style={{ background: "#60a5fa0d" }}>
          <HeaderField label="IPv4 src" value="192.168.10.10" note="the laptop" color={C.ip} />
          <HeaderField label="IPv4 dst" value="10.20.20.20" note="still the server" color={C.ip} strong />
        </div>
      </div>
      <div className="flex justify-between px-1 text-[10px] font-semibold uppercase tracking-wide">
        <span style={{ color: C.arp }}>Layer 2: rewritten at every router hop</span>
        <span style={{ color: C.ip }}>Layer 3: unchanged end to end</span>
      </div>
    </div>
  );
}

function RouterDiagram() {
  const row = (title: string, dst: string, src: string, color: string) => (
    <div className="rounded-lg border border-white/10 p-2.5">
      <p className="mb-1 text-[10px] font-bold uppercase tracking-wide" style={{ color }}>
        {title}
      </p>
      <p className="pv-mono text-[11px] text-pv-text">
        MAC {src} → {dst}
      </p>
      <p className="pv-mono text-[11px] text-pv-text-muted">IP 192.168.10.10 → 10.20.20.20</p>
    </div>
  );
  return (
    <div className="grid items-center gap-2 sm:grid-cols-[1fr_auto_1fr]">
      {row("Arrives on the LAN side", "02:BB:00:00:00:01", "02:AA:00:00:00:01", C.arp)}
      <div className="text-center text-xs text-pv-text-faint">
        <div className="rounded-lg border px-2 py-1.5" style={{ borderColor: C.ip, color: C.ip }}>
          route lookup
          <br />
          <span className="pv-mono">10.20.20.0/24</span>
        </div>
        <span>→ new L2 header →</span>
      </div>
      {row("Leaves on the server segment", "server MAC", "02:BB:00:00:00:02", C.tcp)}
    </div>
  );
}

function HandshakeDiagram() {
  return (
    <Svg h={220} label="TCP three-way handshake followed by TLS and HTTPS">
      <text x={110} y={22} textAnchor="middle" fill={C.text} fontSize={12} fontWeight={600}>
        Laptop
      </text>
      <text x={530} y={22} textAnchor="middle" fill={C.text} fontSize={12} fontWeight={600}>
        Server :443
      </text>
      <line x1={110} y1={32} x2={110} y2={210} stroke={C.line} strokeDasharray="3 4" />
      <line x1={530} y1={32} x2={530} y2={210} stroke={C.line} strokeDasharray="3 4" />
      <Arrow id="hs1" x1={112} y1={50} x2={526} y2={78} color={C.tcp} label="1 · SYN  seq=100" labelDy={-13} />
      <Arrow id="hs2" x1={528} y1={96} x2={114} y2={124} color={C.tcp} label="2 · SYN-ACK  seq=300 ack=101" labelDy={-13} />
      <Arrow id="hs3" x1={112} y1={142} x2={526} y2={170} color={C.tcp} label="3 · ACK  seq=101 ack=301" labelDy={-13} />
      <rect x={200} y={186} width={240} height={24} rx={12} fill={C.tls} fillOpacity={0.15} stroke={C.tls} strokeOpacity={0.6} />
      <text x={320} y={202} textAnchor="middle" fill={C.tls} fontSize={10.5} fontWeight={700}>
        then TLS handshake → HTTPS request
      </text>
    </Svg>
  );
}

export function FirstConnectionGuideContent() {
  return (
    <>
      <GuideSection id="g-mission" eyebrow="Introduction" title="Your mission: reach 10.20.20.20 over HTTPS">
        <p>
          You are the <b className="text-pv-text">Laptop</b> at <Mono tone="cyan">192.168.10.10</Mono>. You want an HTTPS session with the <b className="text-pv-text">Server</b> at <Mono tone="tcp">10.20.20.20</Mono>. The Server lives on a{" "}
          <b className="text-pv-text">different subnet</b>, so the Laptop can&apos;t deliver to it directly. It has to hand every packet to its <b className="text-pv-text">default gateway</b>, the Router at{" "}
          <Mono tone="ip">192.168.10.1</Mono>.
        </p>
        <DiagramFrame caption="Two subnets joined by one router. The router has an interface (and an IP and MAC) on each side.">
          <TopologyDiagram />
        </DiagramFrame>
        <Callout tone="cyan" title="The big question" icon="?">
          Before the first bit leaves the Laptop, it has to fill in an Ethernet header. Who goes in the <b>destination MAC</b> field? That&apos;s what this lesson answers.
        </Callout>
      </GuideSection>

      <GuideSection id="g-mac-ip" eyebrow="Core concept" title="MAC addresses vs IP addresses" tone="violet">
        <p>Every frame on the wire carries both kinds of address. They do different jobs.</p>
        <CompareCards
          items={[
            {
              title: "MAC address",
              tone: "arp",
              tag: "Layer 2",
              points: ["Burned into the network interface (48 bits, e.g. 02:AA:00:00:00:01)", "Only meaningful on the local link or LAN", "Answers \"which device on this wire gets the frame next?\"", "Rewritten at every router hop"],
            },
            {
              title: "IP address",
              tone: "ip",
              tag: "Layer 3",
              points: ["Assigned logically (e.g. 192.168.10.10/24)", "Meaningful end to end, across many networks", "Answers \"where is the packet ultimately going?\"", "Stays the same from Laptop to Server"],
            },
          ]}
        />
        <Callout tone="arp" title="Why ARP exists" icon="!">
          The Laptop knows the <b>IP</b> of its next hop, the gateway <Mono>192.168.10.1</Mono>, but Ethernet can only deliver to a <b>MAC</b>. <b>ARP (Address Resolution Protocol)</b> turns a next-hop IPv4 address into the MAC address on the local network. It sits at the boundary between Layer 3 and Layer 2.
        </Callout>
      </GuideSection>

      <GuideSection id="g-local-remote" eyebrow="Decision" title="Local or remote? The Laptop decides first" tone="cyan">
        <p>
          The Laptop masks the destination with its own prefix. <Mono>10.20.20.20</Mono> is not inside <Mono>192.168.10.0/24</Mono>, so the destination is <b className="text-pv-text">remote</b>, and the next hop becomes the default gateway.
        </p>
        <DiagramFrame caption="The subnet check decides whose MAC the Laptop needs. For a remote destination, it's always the gateway's.">
          <DecisionFlow />
        </DiagramFrame>
        <Callout tone="warning" title="Beginner trap" icon="!">
          The Laptop does <b>not</b> ARP for <Mono>10.20.20.20</Mono>. ARP only works inside the local broadcast domain, and the Server isn&apos;t on it. The Laptop ARPs for the <b>gateway</b>.
        </Callout>
      </GuideSection>

      <GuideSection id="g-arp-request" eyebrow="Step 1" title="ARP request: a broadcast question" tone="arp">
        <p>
          With no entry for <Mono>192.168.10.1</Mono> in its ARP cache, the Laptop builds an ARP request and sends it to the Ethernet <b className="text-pv-text">broadcast</b> address <Mono tone="arp">FF:FF:FF:FF:FF:FF</Mono>. The Switch floods a broadcast out every other port in the same VLAN, so every host on the LAN receives it.
        </p>
        <DiagramFrame caption="Everyone on the LAN hears the question (extra hosts shown for illustration). Only the owner of 192.168.10.1 will answer.">
          <ArpRequestDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="g-arp-reply" eyebrow="Step 2" title="ARP reply: a unicast answer, then caching" tone="arp">
        <p>
          The other hosts see a target IP that isn&apos;t theirs and ignore it. The Router recognizes <Mono>192.168.10.1</Mono> as its own LAN interface and replies <b className="text-pv-text">unicast</b>, straight back to the Laptop&apos;s MAC, with that interface&apos;s MAC <Mono tone="arp">02:BB:00:00:00:01</Mono>.
        </p>
        <DiagramFrame caption="The reply goes only to the Laptop. The Switch already knows which port the Laptop is on.">
          <ArpReplyDiagram />
        </DiagramFrame>
        <div className="overflow-hidden rounded-xl border border-white/10">
          <div className="border-b border-white/10 bg-white/[0.03] px-4 py-2 text-[10px] font-bold uppercase tracking-wide text-pv-text-faint">Laptop ARP cache — after the reply</div>
          <div className="grid grid-cols-3 px-4 py-2 pv-mono text-xs">
            <span className="text-pv-text-faint">IP</span>
            <span className="text-pv-text-faint">MAC</span>
            <span className="text-pv-text-faint">Type</span>
            <span className="text-pv-text">192.168.10.1</span>
            <span style={{ color: C.arp }}>02:BB:00:00:00:01</span>
            <span className="text-pv-text-muted">dynamic</span>
          </div>
        </div>
        <Callout tone="success" title="Why caching matters" icon="✓">
          The entry is cached for a while, so the next packets to <em>any</em> remote destination reuse it with no new ARP. It&apos;s the same gateway MAC every time.
        </Callout>
      </GuideSection>

      <GuideSection id="g-switch" eyebrow="Layer 2 device" title="What the switch does" tone="ethernet">
        <FlowSteps
          steps={[
            { title: "Learns source MACs", body: "Every frame teaches it one fact: \"this source MAC lives behind this port.\" The ARP request teaches it the Laptop is on Fa0/1.", tone: "ethernet" },
            { title: "Floods broadcasts and unknown destinations", body: "A broadcast (or a MAC it hasn't learned yet) is sent out every other port in the VLAN.", tone: "arp" },
            { title: "Forwards known unicast to one port", body: "The Router's reply teaches it the Router is on Fa0/2. From then on, frames to 02:BB:00:00:00:01 go out Fa0/2 only.", tone: "success" },
          ]}
        />
        <Callout tone="cyan" title="Remember" icon="i">
          The switch never reads the IP header. It forwards purely on MAC addresses and its MAC (CAM) table.
        </Callout>
      </GuideSection>

      <GuideSection id="g-frame" eyebrow="Step 3" title="The frame to the gateway" tone="ip">
        <p>Now the Laptop can send the real packet. Look at which addresses point where:</p>
        <FrameDiagram />
        <Callout tone="arp" title="The key insight" icon="★">
          The <b>destination MAC</b> is the gateway, the next hop on this wire. The <b>destination IP</b> is still the Server, the final destination. Those two fields answer different questions.
        </Callout>
      </GuideSection>

      <GuideSection id="g-router" eyebrow="Layer 3 device" title="What the router does" tone="ip">
        <FlowSteps
          steps={[
            { title: "Accepts the frame", body: "The destination MAC is its own LAN interface, so it strips the Ethernet header.", tone: "arp" },
            { title: "Looks up the destination IP", body: <>Longest-prefix match: <Mono>10.20.20.20</Mono> matches the directly connected <Mono>10.20.20.0/24</Mono> on its server-side interface.</>, tone: "ip" },
            { title: "Resolves the next MAC", body: "The Server is directly connected on that segment, so the Router uses its own ARP cache for 10.20.20.20 (ARPing on that segment if needed).", tone: "arp" },
            { title: "Builds a new frame", body: "It writes a new Ethernet header (source = its server-side MAC, destination = the Server's MAC), decrements the TTL and forwards the packet.", tone: "tcp" },
          ]}
        />
        <DiagramFrame caption="Same IP packet on both sides. Only the Layer 2 envelope is replaced.">
          <RouterDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="g-tcp" eyebrow="After the path is ready" title="Then TCP and HTTPS begin" tone="tcp">
        <p>
          ARP, switching and routing only make the path <b className="text-pv-text">deliverable</b>. HTTPS runs over TCP port 443, so before any web data flows the Laptop and Server complete the <b className="text-pv-text">three-way handshake</b>. After that, TLS secures the channel and the HTTPS request can be sent.
        </p>
        <DiagramFrame caption="Each of these segments is itself carried in frames addressed hop by hop, exactly like the packet above.">
          <HandshakeDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="g-flow" eyebrow="Put it together" title="The full packet flow, step by step" tone="violet">
        <FlowSteps
          steps={[
            { title: "Check the destination subnet", body: "10.20.20.20 is not in 192.168.10.0/24.", tone: "cyan" },
            { title: "Decide it's remote", body: "So the next hop is the default gateway 192.168.10.1.", tone: "cyan" },
            { title: "Look in the ARP cache", body: "No gateway MAC yet.", tone: "arp" },
            { title: "Broadcast an ARP request", body: "\"Who has 192.168.10.1?\" is sent to FF:FF:FF:FF:FF:FF.", tone: "arp" },
            { title: "Switch floods it", body: "…and learns the Laptop's MAC on Fa0/1.", tone: "ethernet" },
            { title: "Router replies unicast", body: "192.168.10.1 is at 02:BB:00:00:00:01. The Switch learns the Router is on Fa0/2.", tone: "arp" },
            { title: "Laptop caches the answer", body: "The ARP table gains 192.168.10.1 → 02:BB:00:00:00:01.", tone: "success" },
            { title: "Frame sent to the router's MAC", body: "The destination IP stays 10.20.20.20.", tone: "ip" },
            { title: "Router routes toward 10.20.20.0/24", body: "It gives the packet a new Ethernet header on the server segment.", tone: "ip" },
            { title: "TCP handshake, then TLS/HTTPS", body: "SYN → SYN-ACK → ACK, and then the secure web session starts.", tone: "tcp" },
          ]}
        />
      </GuideSection>

      <GuideSection id="g-mistakes" eyebrow="Avoid these" title="Common mistakes" tone="danger">
        <ChecklistCard
          tone="danger"
          mark="✕"
          title="Not true"
          items={[
            "\"The Laptop ARPs for the Server's IP.\" It doesn't; the Server is off-subnet, so it ARPs for the gateway.",
            "\"The destination IP becomes the router's IP.\" It doesn't; only the destination MAC points at the router.",
            "\"The switch routes the packet.\" It doesn't; a Layer 2 switch forwards on MAC addresses only.",
            "\"The ARP reply is broadcast too.\" It isn't; the reply is unicast to the requester.",
            "\"The MAC addresses stay the same end to end.\" They don't; they're rewritten at every router hop.",
          ]}
        />
      </GuideSection>

      <GuideSection id="g-memorize" eyebrow="Exam-ready" title="What to memorize" tone="success">
        <ChecklistCard
          tone="success"
          mark="✓"
          title="Must know"
          items={[
            "ARP resolves a next-hop IPv4 address into a MAC address on the local network.",
            "Remote destination → ARP for the default gateway, never for the remote host.",
            "ARP request = broadcast (FF:FF:FF:FF:FF:FF); ARP reply = unicast.",
            "Switches learn source MACs, flood broadcasts or unknown destinations, and forward known unicast.",
            "Routers keep the IP header (apart from the TTL) and rewrite the Ethernet header at each hop.",
            "TCP (SYN, SYN-ACK, ACK) and then TLS/HTTPS only start once the path works.",
          ]}
        />
      </GuideSection>

      <GuideSection id="g-glossary" eyebrow="Reference" title="Glossary" tone="cyan">
        <Glossary
          items={[
            { term: "ARP", def: "Address Resolution Protocol. It maps an IPv4 address to a MAC address on the local network." },
            { term: "Default gateway", def: "The router interface a host sends to when the destination is outside its own subnet." },
            { term: "Broadcast", def: "A frame sent to FF:FF:FF:FF:FF:FF that every host in the broadcast domain (VLAN) receives." },
            { term: "Unicast", def: "A frame addressed to exactly one MAC address." },
            { term: "ARP cache", def: "The host's table of recently resolved IP → MAC mappings." },
            { term: "MAC (CAM) table", def: "The switch's table of which MAC address lives behind which port." },
            { term: "Subnet / prefix", def: "A range of IP addresses, e.g. 192.168.10.0/24, that are reachable directly on one link." },
            { term: "Three-way handshake", def: "SYN, SYN-ACK and ACK, which open a TCP connection before any data is sent." },
          ]}
        />
      </GuideSection>

      <GuideSection id="g-recap" eyebrow="In one breath" title="Quick recap" tone="violet">
        <div className="rounded-2xl border border-pv-violet/30 bg-gradient-to-br from-pv-violet/10 to-pv-cyan/5 p-5 text-sm leading-relaxed text-pv-text">
          The Laptop sees that <Mono>10.20.20.20</Mono> is remote, so it needs its gateway. It broadcasts an <b>ARP request</b> for <Mono>192.168.10.1</Mono>, the switch floods it, and the Router answers with a <b>unicast ARP reply</b> containing its MAC. The Laptop caches that MAC, then sends the packet in a frame addressed to the <b>router&apos;s MAC</b> while the IP destination stays the <b>Server</b>. The Router routes it onto <Mono>10.20.20.0/24</Mono> with a fresh Ethernet header, and then TCP&apos;s handshake opens the door for HTTPS.
        </div>
      </GuideSection>
    </>
  );
}
