import { Callout, ChecklistCard, CompareCards, DiagramFrame, FlowSteps, Glossary, GuideSection, Mono, PathDivider, ProtocolStory, TroubleshootingFlow } from "@/components/lesson/GuideBlocks";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { Arrow, C, ConnectionTopologyDiagram, Device, HeaderField, Svg } from "@/components/connection-network/guideSvg";

/**
 * ARP LESSON GUIDE — the guided walkthrough's story: the Laptop needs a MAC before its first packet to the Server can
 * leave, resolves its gateway with ARP, and the switch and R1 carry that packet across. ARP only.
 */
export const ARP_LESSON_GUIDE_SECTIONS: LessonGuideSectionLink[] = [
  { id: "g-mission", label: "Your mission" },
  { id: "g-story", label: "The whole story" },
  { id: "g-breaks", label: "When it breaks" },
  { id: "g-mac-ip", label: "MAC vs IP" },
  { id: "g-local-remote", label: "Local or remote?" },
  { id: "g-arp", label: "ARP: the gateway's MAC" },
  { id: "g-switch", label: "What the switch does" },
  { id: "g-frame", label: "Frame to the gateway" },
  { id: "g-router", label: "What the router does" },
  { id: "g-flow", label: "Full packet flow" },
  { id: "g-mistakes", label: "Common mistakes" },
  { id: "g-memorize", label: "What to memorize" },
  { id: "g-glossary", label: "Glossary" },
  { id: "g-recap", label: "Quick recap" },
];

/** The three stages that get the first packet to the Server. */
function JourneyMap() {
  const stages: [string, string, string][] = [
    ["ARP", "learn the gateway’s MAC", C.arp],
    ["Switching", "deliver the frame across the LAN", C.eth],
    ["Routing", "move the packet to 10.20.20.0/24", C.ip],
  ];
  return (
    <ol className="grid gap-2 sm:grid-cols-3" aria-label="The three stages of the first packet">
      {stages.map(([name, what, color], i) => (
        <li key={name} className="rounded-xl border p-2.5" style={{ borderColor: `${color}66`, background: `${color}10` }}>
          <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color }}>
            {i + 1} · {name}
          </p>
          <p className="text-xs text-pv-text-muted">{what}</p>
        </li>
      ))}
    </ol>
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
        <span style={{ color: C.ip }}>Layer 3 addresses: unchanged end to end</span>
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

export function ArpLessonGuideContent() {
  return (
    <>
      <GuideSection id="g-mission" eyebrow="Introduction" title="Your mission: get the first packet to 10.20.20.20">
        <p>
          You are the <b className="text-pv-text">Laptop</b> at <Mono tone="cyan">192.168.10.10</Mono>. You want to send a packet to the <b className="text-pv-text">Server</b> at <Mono tone="tcp">10.20.20.20</Mono>. The Server lives on a{" "}
          <b className="text-pv-text">different subnet</b>, so the Laptop can&apos;t deliver to it directly. It has to hand every packet to its <b className="text-pv-text">default gateway</b>, the Router at{" "}
          <Mono tone="ip">192.168.10.1</Mono>.
        </p>
        <DiagramFrame caption="Two subnets joined by one router. The router has an interface (and an IP and MAC) on each side.">
          <ConnectionTopologyDiagram />
        </DiagramFrame>
        <JourneyMap />
        <Callout tone="cyan" title="The big question" icon="?">
          Before the first bit leaves the Laptop, it has to fill in an Ethernet header. Who goes in the <b>destination MAC</b> field? That&apos;s what ARP answers.
        </Callout>
      </GuideSection>

      <GuideSection id="g-story" eyebrow="How it works" title="From “send a packet” to a delivered frame, device by device" tone="cyan">
        <ProtocolStory
          problem={<>The Laptop (192.168.10.10) wants to send a packet to the Server (10.20.20.20), which is on another network behind R1. It knows the Server&apos;s IP, but Ethernet can only deliver to a MAC on its own LAN.</>}
          steps={[
            { actor: "Laptop", action: <>compares 10.20.20.20 with its own subnet 192.168.10.0/24: <strong>remote</strong>, so the next hop is its default gateway, R1 192.168.10.1.</>, why: "only local addresses can be reached directly on Ethernet", verify: `The Laptop's routing table shows default via 192.168.10.1, and 10.20.20.20 is outside 192.168.10.0/24.`, fails: { symptom: `The Laptop ARPs for 10.20.20.20 directly.`, evidence: `The Laptop's mask is wrong, so it thinks the server is local.` }, tone: "ip" },
            { actor: "Laptop", action: <>checks its ARP cache for 192.168.10.1, finds nothing, and broadcasts an <strong>ARP Request</strong> (“who has 192.168.10.1?”) to <Mono>FF:FF:FF:FF:FF:FF</Mono>.</>, verify: `Capture: an ARP Request to FF:FF:FF:FF:FF:FF asking for 192.168.10.1.`, fails: { symptom: `ARP Requests repeat with no reply.`, evidence: `The gateway is down, its address is mistyped on the Laptop, or Layer 2 is broken between them.` }, tone: "arp" },
            { actor: "SW1", action: "learns the Laptop's MAC on Fa0/1 and floods the broadcast; R1 recognizes its own IP.", changes: "SW1 MAC table: Laptop → Fa0/1; R1 ARP cache: Laptop's IP → MAC", verify: `SW1's MAC table: the Laptop on Fa0/1.`, fails: { symptom: `The broadcast never reaches R1.`, evidence: `Port or VLAN problem on SW1.` }, tone: "ethernet" },
            { actor: "R1", action: <>replies with a unicast <strong>ARP Reply</strong>: 192.168.10.1 is at <Mono>02:BB:00:00:00:01</Mono>.</>, changes: "Laptop ARP cache: 192.168.10.1 → R1's MAC; SW1 learns R1 on Fa0/2", verify: `arp -a on the Laptop: 192.168.10.1 → 02:BB:00:00:00:01.`, fails: { symptom: `The ARP entry stays incomplete.`, evidence: `R1 is not answering for that IP: check its interface address.` }, tone: "arp" },
            { actor: "Laptop", action: <>builds the first IP packet: Ethernet destination = <strong>R1&apos;s MAC</strong>, IP destination = <strong>10.20.20.20</strong>.</>, why: "the MAC names the next hop; the IP names the final destination", verify: `Capture: destination MAC = R1, destination IP = 10.20.20.20.`, fails: { symptom: `The packet leaves but nothing comes back.`, evidence: `The local part works. The problem is further on: routing at R1, or R1's own ARP for the Server.` }, tone: "ip" },
            { actor: "R1", action: "routes it toward 10.20.20.0/24, decrements TTL and builds a new frame for the Server segment.", verify: `R1 has a route for 10.20.20.0/24. On the server segment, the packet's TTL is one lower.`, fails: { symptom: `ICMP unreachable from R1, or silence.`, evidence: `R1 has no route, or the interface towards the server is down.` }, tone: "ip" },
          ]}
          outcome={<>ARP prepared Layer 2 for the first hop; IP carried the packet across the router, where R1 rebuilt the Ethernet header for the next link. If ARP gets no answer the frame can&apos;t be built; if the gateway is wrong, ARP asks for the wrong address. The ARP presentation and lab let you watch and break each part.</>}
        />
      </GuideSection>

      <GuideSection id="g-breaks" eyebrow="When it breaks" title={`When the packet does not arrive: walk the journey in order`} tone="danger">
        <p className="text-sm text-pv-text-muted">{`The packet only arrives if every step of the journey works, in order. Check each one with evidence; the first step you can not confirm is where the problem is.`}</p>
        <TroubleshootingFlow
          steps={[
            { question: `Did the Laptop decide local or remote correctly?`, look: `Check the Laptop's address, mask and default gateway.` },
            { question: `Is the gateway's MAC known?`, look: `Look for an ARP cache entry for 192.168.10.1. Incomplete means a Layer 2 problem or the gateway is down.` },
            { question: `Do packets leave towards the gateway?`, look: `Capture: destination MAC is R1, destination IP is the server.` },
            { question: `Does R1 route the packet?`, look: `R1 has a route for the server network, and on the server side the TTL is one lower.` },
            { question: `How do you prove the fix?`, look: `Send again: the ARP entry resolves, the frame leaves to R1's MAC and the reply comes back. Repeat the same test after every change.` },
          ]}
        />
        <Callout tone="cyan" title="The habit to build" icon="✓">
          Walk the story in order and confirm each step with real evidence (a table, a capture, a command). The first step you cannot confirm is where the problem is. The boxes under each story step above say what to look at.
        </Callout>
      </GuideSection>

      <PathDivider title="Reference">Every part of the story in detail. Read the parts you need.</PathDivider>

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

      <GuideSection id="g-arp" eyebrow="Step 1" title="ARP: learn the gateway’s MAC" tone="arp">
        <p>
          With no entry for <Mono>192.168.10.1</Mono> in its ARP cache, the Laptop broadcasts an ARP Request to <Mono tone="arp">FF:FF:FF:FF:FF:FF</Mono>. As the frame enters the Switch on Fa0/1, the Switch learns the Laptop’s source MAC, then floods the broadcast. The Router owns <Mono>192.168.10.1</Mono>: it caches the Laptop’s mapping from the request’s sender fields and answers.
        </p>
        <DiagramFrame caption="Everyone on the LAN hears the question (extra hosts shown for illustration). Only the owner of 192.168.10.1 answers.">
          <ArpRequestDiagram />
        </DiagramFrame>
        <p>
          The Router replies <b className="text-pv-text">unicast</b> with its LAN MAC <Mono tone="arp">02:BB:00:00:00:01</Mono>. On the way, the Switch learns the Router on Fa0/2; the Laptop caches <Mono>192.168.10.1 → 02:BB:00:00:00:01</Mono> and reuses it for later packets.
        </p>
        <DiagramFrame caption="The reply goes only to the Laptop. The Switch already knows which port the Laptop is on.">
          <ArpReplyDiagram />
        </DiagramFrame>
        <Callout tone="arp" title="Want the full ARP lesson?" icon="→">
          This tab follows ARP through the guided walkthrough. The <b>ARP Deep Dive</b> tab teaches ARP itself: packet anatomy, what every device learns, ARP vs MAC tables, CLI, troubleshooting and more.
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
          The switch never reads the IP header. It forwards purely on MAC addresses and its MAC (CAM) table, which maps <b>MAC → port</b>. That&apos;s a different table from the ARP table hosts and routers keep (<b>IPv4 → MAC</b>). A pure Layer-2 switch doesn&apos;t need an ARP entry to forward frames.
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
        <p className="text-xs text-pv-text-faint">
          In this lesson R1 already has the Server’s MAC in its ARP cache. If it didn’t, R1 would first run its own ARP exchange on <Mono>10.20.20.0/24</Mono> — ARP is always local to one link.
        </p>
      </GuideSection>

      <GuideSection id="g-flow" eyebrow="Put it together" title="The first packet, step by step" tone="violet">
        <FlowSteps
          steps={[
            { title: "Check the destination subnet", body: "10.20.20.20 is not in 192.168.10.0/24.", tone: "cyan" },
            { title: "Decide it's remote", body: "So the next hop is the default gateway 192.168.10.1.", tone: "cyan" },
            { title: "Look in the ARP cache", body: "No gateway MAC yet.", tone: "arp" },
            { title: "Broadcast an ARP request", body: "\"Who has 192.168.10.1?\" is sent to FF:FF:FF:FF:FF:FF.", tone: "arp" },
            { title: "Switch learns, then floods", body: "As the frame enters Fa0/1, the Switch learns its SOURCE MAC (the Laptop) on that port, then floods the broadcast.", tone: "ethernet" },
            { title: "Router caches the sender", body: "The request targets its own IP, so it caches 192.168.10.10 → 02:AA:00:00:00:01 from the sender fields.", tone: "arp" },
            { title: "Router replies unicast", body: "192.168.10.1 is at 02:BB:00:00:00:01. As the reply enters Fa0/2, the Switch learns the Router's source MAC there.", tone: "arp" },
            { title: "Laptop caches the answer", body: "The ARP table gains 192.168.10.1 → 02:BB:00:00:00:01.", tone: "success" },
            { title: "Frame sent to the router's MAC", body: "The destination IP stays 10.20.20.20.", tone: "ip" },
            { title: "Router routes toward 10.20.20.0/24", body: "It gives the packet a new Ethernet header on the server segment.", tone: "ip" },
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
          ]}
        />
      </GuideSection>

      <GuideSection id="g-recap" eyebrow="In one breath" title="Quick recap" tone="violet">
        <div className="rounded-2xl border border-pv-violet/30 bg-gradient-to-br from-pv-violet/10 to-pv-cyan/5 p-5 text-sm leading-relaxed text-pv-text">
          The Laptop sees that <Mono>10.20.20.20</Mono> is remote, so it needs its gateway. It broadcasts an <b>ARP request</b> for <Mono>192.168.10.1</Mono>, the switch floods it, and the Router answers with a <b>unicast ARP reply</b> containing its MAC. The Laptop caches that MAC, then sends the packet in a frame addressed to the <b>router&apos;s MAC</b> while the IP destination stays the <b>Server</b>. The Router routes it onto <Mono>10.20.20.0/24</Mono> with a fresh Ethernet header — after its own ARP for the Server on that link.
        </div>
      </GuideSection>
    </>
  );
}
