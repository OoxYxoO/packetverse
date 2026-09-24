import { Callout, ChecklistCard, CompareCards, DiagramFrame, FlowSteps, Glossary, GuideSection, Mono } from "@/components/lesson/GuideBlocks";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { Arrow, C, Device, HeaderField, Svg } from "./guideSvg";

export const ARP_DEEP_DIVE_SECTIONS: LessonGuideSectionLink[] = [
  { id: "d-what", label: "What is ARP?" },
  { id: "d-why", label: "Why ARP exists" },
  { id: "d-scope", label: "Where ARP works" },
  { id: "d-decision", label: "Who do I ARP for?" },
  { id: "d-same", label: "Same-subnet example" },
  { id: "d-remote", label: "Remote-subnet example" },
  { id: "d-exchange", label: "Request & reply" },
  { id: "d-packet", label: "Inside an ARP packet" },
  { id: "d-cache", label: "ARP cache & aging" },
  { id: "d-frame", label: "MAC vs IP destination" },
  { id: "d-special", label: "Gratuitous & proxy ARP" },
  { id: "d-security", label: "Security & operations" },
  { id: "d-not", label: "What ARP does NOT do" },
  { id: "d-tips", label: "Memory tips" },
  { id: "d-glossary", label: "Glossary" },
];

/** Two LANs joined by a router: an ARP broadcast floods LAN A but never crosses the router. */
function ScopeDiagram() {
  return (
    <Svg h={215} label="An ARP broadcast floods LAN A and stops at the router; LAN B never sees it">
      <rect x={12} y={30} width={360} height={172} rx={14} fill={C.arp} fillOpacity={0.05} stroke={C.arp} strokeOpacity={0.45} strokeDasharray="6 5" />
      <text x={26} y={50} fill={C.arp} fontSize={10} fontWeight={700}>
        LAN A · one broadcast domain
      </text>
      <rect x={430} y={30} width={196} height={172} rx={14} fill={C.line} fillOpacity={0.08} stroke={C.line} strokeDasharray="6 5" />
      <text x={444} y={50} fill={C.muted} fontSize={10} fontWeight={700}>
        LAN B · never sees it
      </text>
      <Device x={80} y={90} label="Host A" sub="asks" />
      <Device x={220} y={90} label="Switch" sub="floods" accent={C.eth} />
      <Device x={130} y={170} label="Host C" sub="hears it" accent={C.line} w={96} />
      <Device x={310} y={170} label="Host D" sub="hears it" accent={C.line} w={96} />
      <Device x={401} y={90} label="Router" sub="stops it" accent={C.ip} w={88} />
      <Device x={530} y={120} label="Host E" sub="unaffected" accent={C.line} w={96} />
      <Arrow id="dsc1" x1={134} y1={90} x2={166} y2={90} color={C.arp} />
      <Arrow id="dsc2" x1={274} y1={90} x2={354} y2={90} color={C.arp} />
      <Arrow id="dsc3" x1={205} y1={114} x2={145} y2={145} color={C.arp} dashed />
      <Arrow id="dsc4" x1={235} y1={114} x2={295} y2={145} color={C.arp} dashed />
      <line x1={447} y1={82} x2={463} y2={98} stroke={C.danger} strokeWidth={2.5} />
      <line x1={463} y1={82} x2={447} y2={98} stroke={C.danger} strokeWidth={2.5} />
    </Svg>
  );
}

function SameSubnetDiagram() {
  return (
    <Svg h={170} label="Host A ARPs directly for Host B on the same subnet">
      <rect x={12} y={20} width={616} height={140} rx={14} fill={C.cyan} fillOpacity={0.04} stroke={C.cyan} strokeOpacity={0.3} strokeDasharray="6 5" />
      <text x={26} y={40} fill={C.cyan} fontSize={10} fontWeight={700}>
        10.1.1.0/24
      </text>
      <Device x={100} y={95} label="Host A" sub="10.1.1.10" />
      <Device x={320} y={95} label="Switch" accent={C.eth} />
      <Device x={540} y={95} label="Host B" sub="10.1.1.20" accent={C.tcp} />
      <Arrow id="dss1" x1={154} y1={85} x2={266} y2={85} color={C.arp} label="Who has 10.1.1.20?" />
      <Arrow id="dss2" x1={374} y1={85} x2={486} y2={85} color={C.arp} label="broadcast" />
      <Arrow id="dss3" x1={486} y1={110} x2={374} y2={110} color={C.tcp} label="10.1.1.20 is at BB:…" labelDy={18} />
      <Arrow id="dss4" x1={266} y1={110} x2={154} y2={110} color={C.tcp} label="unicast" labelDy={18} />
    </Svg>
  );
}

function RemoteSubnetDiagram() {
  return (
    <Svg h={190} label="Host A ARPs for its default gateway, not for the remote host">
      <rect x={12} y={20} width={400} height={150} rx={14} fill={C.cyan} fillOpacity={0.04} stroke={C.cyan} strokeOpacity={0.3} strokeDasharray="6 5" />
      <text x={26} y={40} fill={C.cyan} fontSize={10} fontWeight={700}>
        10.1.1.0/24
      </text>
      <rect x={430} y={20} width={198} height={150} rx={14} fill={C.tcp} fillOpacity={0.04} stroke={C.tcp} strokeOpacity={0.3} strokeDasharray="6 5" />
      <text x={444} y={40} fill={C.tcp} fontSize={10} fontWeight={700}>
        172.16.5.0/24 (remote)
      </text>
      <Device x={90} y={95} label="Host A" sub="10.1.1.10" />
      <Device x={250} y={95} label="Switch" accent={C.eth} w={90} />
      <Device x={412} y={95} label="Gateway" sub="10.1.1.1" accent={C.ip} w={92} />
      <Device x={560} y={95} label="Server" sub="172.16.5.9" accent={C.tcp} w={96} />
      <Arrow id="drs1" x1={144} y1={85} x2={205} y2={85} color={C.arp} />
      <Arrow id="drs2" x1={295} y1={85} x2={366} y2={85} color={C.arp} label="Who has 10.1.1.1?" labelDy={-12} />
      <text x={529} y={145} textAnchor="middle" fill={C.danger} fontSize={9.5} fontWeight={700}>
        never ARPed for by Host A
      </text>
      <text x={250} y={150} textAnchor="middle" fill={C.muted} fontSize={10}>
        Host A needs the gateway&apos;s MAC; the router handles the far side.
      </text>
    </Svg>
  );
}

function SequenceDiagram() {
  return (
    <Svg h={230} label="ARP request broadcast, unicast reply, cache update, then data">
      <text x={120} y={22} textAnchor="middle" fill={C.text} fontSize={12} fontWeight={600}>
        Requester
      </text>
      <text x={520} y={22} textAnchor="middle" fill={C.text} fontSize={12} fontWeight={600}>
        Target (owner of the IP)
      </text>
      <line x1={120} y1={32} x2={120} y2={222} stroke={C.line} strokeDasharray="3 4" />
      <line x1={520} y1={32} x2={520} y2={222} stroke={C.line} strokeDasharray="3 4" />
      <Arrow id="dq1" x1={122} y1={52} x2={516} y2={78} color={C.arp} label="1 · ARP request (op 1) → FF:FF:FF:FF:FF:FF" labelDy={-13} />
      <Arrow id="dq2" x1={518} y1={104} x2={124} y2={130} color={C.arp} label="2 · ARP reply (op 2) → requester's MAC (unicast)" labelDy={-13} />
      <rect x={24} y={142} width={192} height={24} rx={12} fill={C.tcp} fillOpacity={0.14} stroke={C.tcp} strokeOpacity={0.6} />
      <text x={120} y={158} textAnchor="middle" fill={C.tcp} fontSize={10.5} fontWeight={700}>
        3 · cache IP → MAC
      </text>
      <Arrow id="dq3" x1={122} y1={186} x2={516} y2={212} color={C.ip} label="4 · normal data frames, addressed to the learned MAC" labelDy={-13} />
    </Svg>
  );
}

function PacketFields() {
  const rows: [string, string, string][] = [
    ["Hardware type", "1", "Ethernet"],
    ["Protocol type", "0x0800", "IPv4"],
    ["Hardware / protocol length", "6 / 4", "MAC = 6 bytes, IPv4 = 4 bytes"],
    ["Operation", "1 or 2", "1 = request, 2 = reply"],
    ["Sender MAC / IP", "AA:… / 10.1.1.10", "who is asking (or answering)"],
    ["Target MAC / IP", "00:… / 10.1.1.20", "whose MAC is wanted (MAC unknown in a request)"],
  ];
  return (
    <div className="overflow-hidden rounded-xl border border-white/10">
      <div className="flex items-center justify-between border-b border-white/10 bg-white/[0.03] px-4 py-2 text-[10px] font-bold uppercase tracking-wide">
        <span className="text-pv-text-faint">ARP message fields</span>
        <span className="pv-mono" style={{ color: C.arp }}>
          carried directly in Ethernet · EtherType 0x0806
        </span>
      </div>
      <div className="divide-y divide-white/5">
        {rows.map(([f, v, n]) => (
          <div key={f} className="grid grid-cols-[1.2fr_1fr_1.6fr] gap-2 px-4 py-2 text-xs">
            <span className="text-pv-text">{f}</span>
            <span className="pv-mono" style={{ color: C.arp }}>
              {v}
            </span>
            <span className="text-pv-text-muted">{n}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function CacheTable() {
  const rows = [
    ["10.1.1.1", "02:BB:00:00:00:01", "dynamic", "learned by ARP, ages out"],
    ["10.1.1.20", "02:CC:00:00:00:14", "dynamic", "learned by ARP, ages out"],
    ["10.1.1.250", "02:DD:00:00:00:FA", "static", "configured by an admin, never ages"],
  ];
  return (
    <div className="overflow-hidden rounded-xl border border-white/10">
      <div className="border-b border-white/10 bg-white/[0.03] px-4 py-2 text-[10px] font-bold uppercase tracking-wide text-pv-text-faint">Example host ARP cache</div>
      <div className="grid grid-cols-[1fr_1.4fr_0.8fr_1.6fr] gap-x-3 gap-y-1.5 px-4 py-2.5 text-xs">
        {["IP address", "MAC address", "Type", "Meaning"].map((h) => (
          <span key={h} className="text-pv-text-faint">
            {h}
          </span>
        ))}
        {rows.flat().map((c, i) => (
          <span key={i} className={i % 4 < 2 ? "pv-mono text-pv-text" : "text-pv-text-muted"} style={i % 4 === 1 ? { color: C.arp } : undefined}>
            {c}
          </span>
        ))}
      </div>
    </div>
  );
}

function GeneralDecision() {
  const box = "rounded-lg border px-3 py-2 text-center text-xs";
  return (
    <div className="flex flex-col items-center gap-1.5 py-2">
      <div className={box} style={{ borderColor: C.ip, color: C.text }}>
        I have an IPv4 packet for <b>destination D</b>
      </div>
      <span className="text-pv-text-faint">↓</span>
      <div className={box} style={{ borderColor: C.cyan, color: C.text }}>
        Is D inside my own subnet (my IP + mask)?
      </div>
      <div className="grid w-full max-w-xl grid-cols-2 gap-3 pt-1">
        <div className="flex flex-col items-center gap-1.5">
          <span className="text-[10px] font-bold uppercase" style={{ color: C.tcp }}>
            Yes → local
          </span>
          <div className={box} style={{ borderColor: C.tcp, color: C.text }}>
            Next hop = <b>D itself</b>
          </div>
        </div>
        <div className="flex flex-col items-center gap-1.5">
          <span className="text-[10px] font-bold uppercase" style={{ color: C.arp }}>
            No → remote
          </span>
          <div className={box} style={{ borderColor: C.arp, color: C.text }}>
            Next hop = <b>default gateway</b>
          </div>
        </div>
      </div>
      <span className="text-pv-text-faint">↓</span>
      <div className={box} style={{ borderColor: C.arp, color: C.text }}>
        Next-hop MAC in the ARP cache? <b>Yes</b> → send now · <b>No</b> → ARP for the <b>next hop</b>, then send
      </div>
    </div>
  );
}

export function ArpDeepDiveContent() {
  return (
    <>
      <GuideSection id="d-what" eyebrow="Fundamentals" title="What is ARP?" tone="arp">
        <p>
          <b className="text-pv-text">ARP, the Address Resolution Protocol</b> (RFC 826), answers one question on a local network: <em>&quot;I know this IPv4 address. What MAC address should I put in the Ethernet frame to reach it?&quot;</em>
        </p>
        <Callout tone="arp" title="One-sentence definition" icon="★">
          ARP resolves a <b>next-hop IPv4 address</b> into the <b>MAC address</b> of the interface that owns it <b>on the same local link</b>.
        </Callout>
        <p>
          ARP is for <b className="text-pv-text">IPv4</b>. IPv6 does the same job with <b className="text-pv-text">Neighbor Discovery (NDP)</b>, which uses ICMPv6 messages instead of ARP.
        </p>
      </GuideSection>

      <GuideSection id="d-why" eyebrow="Fundamentals" title="Why ARP exists" tone="violet">
        <CompareCards
          items={[
            { title: "IP layer knows", tone: "ip", tag: "Layer 3", points: ["the destination IP", "its own IP and subnet mask", "which next hop to use (the host itself or the gateway)"] },
            { title: "Ethernet needs", tone: "arp", tag: "Layer 2", points: ["a destination MAC for the frame", "the NIC only accepts frames for its MAC (or broadcast/multicast)", "no MAC means no frame can be built"] },
          ]}
        />
        <p>
          IP addressing is logical and Ethernet delivery is physical. ARP is the glue at the <b className="text-pv-text">Layer 2 / Layer 3 boundary</b>: it fills in the one field IP can&apos;t, the next hop&apos;s MAC address.
        </p>
      </GuideSection>

      <GuideSection id="d-scope" eyebrow="Scope" title="Where ARP works: the local broadcast domain" tone="cyan">
        <p>ARP requests are Ethernet broadcasts, and routers do not forward broadcasts. So ARP only ever reaches devices on the same link or VLAN.</p>
        <DiagramFrame caption="The request floods every port in LAN A. The router doesn't forward it, so LAN B never sees it.">
          <ScopeDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="d-decision" eyebrow="The key decision" title="Who do I ARP for?" tone="cyan">
        <p>Before ARPing, a host picks the <b className="text-pv-text">next hop</b>. ARP always resolves the next hop, which is not necessarily the final destination.</p>
        <DiagramFrame caption="Local destination: ARP for the destination. Remote destination: ARP for the gateway.">
          <GeneralDecision />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="d-same" eyebrow="Example 1" title="Same subnet: ARP for the destination itself" tone="tcp">
        <p>
          Host A (<Mono>10.1.1.10/24</Mono>) sends to Host B (<Mono>10.1.1.20</Mono>). They share <Mono>10.1.1.0/24</Mono>, so Host B is the next hop and Host A ARPs for <Mono>10.1.1.20</Mono> directly.
        </p>
        <DiagramFrame caption="Broadcast question, unicast answer. Only Host B replies.">
          <SameSubnetDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="d-remote" eyebrow="Example 2" title="Different subnet: ARP for the gateway" tone="arp">
        <p>
          Host A sends to a server at <Mono>172.16.5.9</Mono>. That isn&apos;t in <Mono>10.1.1.0/24</Mono>, so the next hop is the default gateway <Mono>10.1.1.1</Mono>, and that&apos;s the address Host A ARPs for.
        </p>
        <DiagramFrame caption="The remote server's MAC is irrelevant to Host A. It isn't on Host A's link.">
          <RemoteSubnetDiagram />
        </DiagramFrame>
        <Callout tone="warning" title="Common confusion" icon="!">
          A host never ARPs for a remote host&apos;s IP. The ARP broadcast couldn&apos;t reach it, and the frame only needs to get as far as the gateway anyway.
        </Callout>
      </GuideSection>

      <GuideSection id="d-exchange" eyebrow="Mechanics" title="Request (broadcast) and reply (unicast)" tone="arp">
        <DiagramFrame caption="Every host on the link receives the request. Only the owner of the target IP answers.">
          <SequenceDiagram />
        </DiagramFrame>
        <FlowSteps
          steps={[
            { title: "Request is broadcast", body: <>Destination MAC <Mono tone="arp">FF:FF:FF:FF:FF:FF</Mono>, because the requester doesn&apos;t know the target&apos;s MAC yet. The switch floods it out every other port in the VLAN.</>, tone: "arp" },
            { title: "Non-owners ignore it", body: "Every host checks the target IP; if it isn't theirs, they drop the request.", tone: "ethernet" },
            { title: "The owner replies, normally unicast", body: "It already knows the requester's MAC (it's in the request), so it answers the requester directly.", tone: "tcp" },
            { title: "Both sides learn", body: "The requester caches the answer. The target typically also caches the requester's mapping from the request.", tone: "success" },
          ]}
        />
      </GuideSection>

      <GuideSection id="d-packet" eyebrow="On the wire" title="Inside an ARP packet" tone="violet">
        <p>ARP isn&apos;t carried inside IP. It rides directly in an Ethernet frame with its own EtherType.</p>
        <PacketFields />
      </GuideSection>

      <GuideSection id="d-cache" eyebrow="Efficiency" title="The ARP cache and aging" tone="success">
        <p>Broadcasting for every packet would be wasteful, so hosts and routers keep an <b className="text-pv-text">ARP cache</b> (ARP table) of recent IP → MAC answers.</p>
        <CacheTable />
        <FlowSteps
          steps={[
            { title: "Hit", body: "The mapping is cached, so the frame is sent immediately with no ARP.", tone: "success" },
            { title: "Miss", body: "The host sends an ARP request and holds or queues the packet until the reply arrives.", tone: "arp" },
            { title: "Aging", body: "Dynamic entries expire after a timeout. The value varies widely by platform, from under a minute on many hosts to hours on some routers. An expired entry is simply re-learned by ARP when next needed.", tone: "warning" },
          ]}
        />
        <Callout tone="cyan" title="Handy commands" icon=">">
          <Mono>arp -a</Mono> (Windows/macOS), <Mono>ip neigh</Mono> (Linux) and <Mono>show ip arp</Mono> (Cisco IOS) all show the cache.
        </Callout>
      </GuideSection>

      <GuideSection id="d-frame" eyebrow="The big idea" title="Destination MAC vs destination IP" tone="ip">
        <p>For a remote destination the two &quot;destination&quot; fields point at <b className="text-pv-text">different devices</b>:</p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <HeaderField label="Ethernet dst MAC" value="gateway's MAC" note="the next hop on this link (from ARP)" color={C.arp} strong />
          <HeaderField label="IPv4 dst" value="172.16.5.9" note="the final destination, unchanged end to end" color={C.ip} strong />
        </div>
        <Callout tone="ip" title="Hop by hop" icon="→">
          Each router strips the old Ethernet header and builds a new one for its next hop, using its own ARP cache. The MAC addresses change at every routed hop; the IP addresses don&apos;t.
        </Callout>
      </GuideSection>

      <GuideSection id="d-special" eyebrow="Variations" title="Gratuitous ARP and proxy ARP" tone="violet">
        <CompareCards
          items={[
            { title: "Gratuitous ARP", tone: "violet", tag: "announce", points: ["A host ARPs for its own IP, unprompted", "Detects duplicate IP addresses", "Refreshes neighbors' caches after a MAC change or failover (e.g. a first-hop redundancy virtual IP)"] },
            { title: "Proxy ARP", tone: "cyan", tag: "answer for others", points: ["A router replies with its own MAC for an IP that isn't on the local link", "Lets misconfigured hosts (no gateway set) still reach remote subnets", "Often disabled today, because it hides design mistakes"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="d-security" eyebrow="Real world" title="Security and operational notes" tone="danger">
        <Callout tone="danger" title="ARP spoofing / poisoning" icon="!">
          ARP has <b>no authentication</b>: hosts accept replies at face value. An attacker on the same LAN can send forged replies (&quot;the gateway is at <em>my</em> MAC&quot;) and place themselves in the middle of traffic. Mitigations include <b>Dynamic ARP Inspection</b> on switches (validated against DHCP snooping), static entries for critical hosts, and encryption such as TLS so intercepted traffic stays unreadable.
        </Callout>
        <ChecklistCard
          tone="warning"
          mark="•"
          title="Troubleshooting hints"
          items={[
            "An \"incomplete\" or FAILED entry means requests went out but nobody answered (wrong IP, host down, VLAN mismatch).",
            "A stale entry pointing to an old MAC can black-hole traffic until it ages out or is cleared.",
            "Duplicate-IP warnings usually come from gratuitous-ARP conflict detection.",
          ]}
        />
      </GuideSection>

      <GuideSection id="d-not" eyebrow="Clear the myths" title="What ARP does NOT do" tone="danger">
        <ChecklistCard
          tone="danger"
          mark="✕"
          title="Not ARP's job"
          items={[
            "It doesn't cross routers. It's link-local only.",
            "It doesn't find the MAC of a remote host on another subnet.",
            "It doesn't route packets or choose paths. That's IP routing.",
            "It doesn't translate names to IPs. That's DNS.",
            "It doesn't work for IPv6. IPv6 uses Neighbor Discovery.",
            "It doesn't change the IP destination of a packet.",
          ]}
        />
      </GuideSection>

      <GuideSection id="d-tips" eyebrow="Remember it" title="Memory tips" tone="success">
        <ChecklistCard
          tone="success"
          mark="✓"
          title="Say it out loud"
          items={[
            <>
              <b>&quot;IP says where, MAC says next.&quot;</b> The IP destination is the final target; the MAC destination is just the next stop.
            </>,
            <>
              <b>&quot;Local? Ask them. Remote? Ask the gateway.&quot;</b>
            </>,
            <>
              <b>&quot;Shout the question, whisper the answer.&quot;</b> Requests are broadcast; replies are unicast.
            </>,
            <>
              <b>&quot;Remember, then reuse.&quot;</b> Cache hits skip ARP entirely until the entry ages out.
            </>,
          ]}
        />
      </GuideSection>

      <GuideSection id="d-glossary" eyebrow="Reference" title="Glossary" tone="cyan">
        <Glossary
          items={[
            { term: "Next hop", def: "The device on the local link that should receive the frame: the destination itself (local) or the gateway (remote)." },
            { term: "Broadcast domain", def: "All devices that receive a Layer 2 broadcast, typically one VLAN or subnet." },
            { term: "EtherType 0x0806", def: "The Ethernet type value that marks a frame's payload as ARP." },
            { term: "ARP cache", def: "Table of recently resolved IPv4 → MAC mappings, with dynamic entries that age out." },
            { term: "Gratuitous ARP", def: "An unsolicited ARP about a host's own IP, used for announcements and duplicate detection." },
            { term: "Proxy ARP", def: "A router answering ARP on behalf of addresses that aren't on the local link." },
            { term: "Dynamic ARP Inspection", def: "A switch feature that drops ARP packets whose IP/MAC bindings don't match trusted records." },
            { term: "NDP", def: "IPv6 Neighbor Discovery, IPv6's replacement for ARP." },
          ]}
        />
      </GuideSection>
    </>
  );
}
