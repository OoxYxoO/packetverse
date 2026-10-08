import { Callout, ChecklistCard, CompareCards, DArrow, DIAGRAM as D, DiagramFrame, DiagramSvg, DLink, DNode, DPill, DRegion, FailureSignatures, FieldTable, FlowSteps, Glossary, GuideSection, Mono, PathDivider, ProtocolStory, TroubleshootingFlow } from "@/components/lesson/GuideBlocks";
import { PresentationBridge } from "@/components/presentation/LessonPresentation";
import { PracticeBridge } from "@/components/lesson/GuideInteractive";
import { usePracticeLabOpener } from "@/components/lesson/FundamentalsLessonShell";
import { DFieldRow } from "@/components/lesson/FundamentalsGuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { hex4, hex8 } from "@/lib/sim-engine/scenarios/fundamentalsPackets";
import { CLIENT_DNS_PORT, DH_ADDR, DNS_NAME, DNS_RECORD_TTL, LEASE_SECONDS, MASK, XID1 } from "@/lib/sim-engine/scenarios/dhcpDns";

export const DH_LESSON_SECTIONS: LessonGuideSectionLink[] = [
  { id: "dh-mission", label: "The mission" },
  { id: "dh-story", label: "The whole story" },
  { id: "dh-evidence", label: "From watching to proving" },
  { id: "dh-breaks", label: "When it breaks" },
  { id: "dh-build", label: "Building it" },
  { id: "dh-boundary", label: "The broadcast boundary" },
  { id: "dh-dora", label: "Discover → Ack" },
  { id: "dh-giaddr", label: "Relay & giaddr" },
  { id: "dh-lease", label: "What the lease sets" },
  { id: "dh-dns", label: "The DNS lookup" },
  { id: "dh-incident", label: "Option 6 incident" },
  { id: "dh-verify", label: "Verification" },
  { id: "dh-model", label: "Mental model" },
  { id: "dh-glossary", label: "Glossary" },
  { id: "dh-recap", label: "Recap" },
];
const DHCP = "#f59e0b";
const DNS = "#a78bfa";

function BoundaryDiagram() {
  return (
    <DiagramSvg h={210} label={`The client's broadcast 0.0.0.0 to 255.255.255.255 stays on 10.10.10.0/24; R1's relay agent re-sends it as unicast from ${DH_ADDR["R1:SERVER"]} to ${DH_ADDR["DHCP-SRV"]} with giaddr ${DH_ADDR["R1:CLIENT"]}`}>
      <DRegion x={10} y={20} w={290} h={170} label="10.10.10.0/24 (broadcast domain)" color={D.cyan} />
      <DRegion x={340} y={20} w={290} h={170} label="10.20.20.0/24" color={D.violet} />
      <DNode x={80} y={110} label="CLIENT" sub="no IPv4 yet" w={110} />
      <DNode x={320} y={110} label="R1" sub="relay agent" accent={D.ip} w={100} />
      <DNode x={560} y={110} label="DHCP-SRV" sub={DH_ADDR["DHCP-SRV"]} accent={D.violet} w={120} />
      <DArrow x1={136} y1={110} x2={268} y2={110} color={DHCP} label="broadcast" />
      <text x={150} y={140} fill={D.muted} fontSize={9.5}>
        0.0.0.0 → 255.255.255.255
      </text>
      <DArrow x1={372} y1={110} x2={498} y2={110} color={DHCP} label="unicast" />
      <text x={380} y={140} fill={D.muted} fontSize={9.5}>
        giaddr {DH_ADDR["R1:CLIENT"]}
      </text>
      <DPill x={320} y={170} text="the broadcast itself stops here" color={D.danger} w={220} />
    </DiagramSvg>
  );
}

function DoraDiagram() {
  const xs = [80, 320, 560];
  const rows = [
    { t: "DHCPDISCOVER", dir: 1, c: DHCP, l1: "bcast 68→67", l2: "unicast 67→67 · giaddr" },
    { t: "DHCPOFFER", dir: -1, c: D.success, l1: "bcast 67→68", l2: "to relay 67→67" },
    { t: "DHCPREQUEST", dir: 1, c: DHCP, l1: "bcast · opt 50 + 54", l2: "unicast · giaddr" },
    { t: "DHCPACK", dir: -1, c: D.success, l1: "bcast 67→68", l2: "to relay 67→67" },
  ];
  return (
    <DiagramSvg h={250} label={`DHCP exchange with one xid ${hex8(XID1)}: DISCOVER client to relay to server, OFFER back, REQUEST out, ACK back; client side broadcast, relay to server unicast`}>
      {["CLIENT", "R1 (relay)", "DHCP-SRV"].map((n, i) => (
        <g key={n}>
          <text x={xs[i]} y={20} textAnchor="middle" fill={D.text} fontSize={11} fontWeight={700}>
            {n}
          </text>
          <line x1={xs[i]} y1={28} x2={xs[i]} y2={220} stroke={D.line} strokeDasharray="3 4" />
        </g>
      ))}
      {rows.map((r, i) => {
        const y = 52 + i * 44;
        return (
          <g key={r.t}>
            {r.dir === 1 ? <DArrow x1={xs[0]} y1={y} x2={xs[1] - 4} y2={y} color={r.c} label={r.l1} /> : <DArrow x1={xs[1] - 4} y1={y} x2={xs[0] + 4} y2={y} color={r.c} label={r.l1} />}
            {r.dir === 1 ? <DArrow x1={xs[1] + 4} y1={y} x2={xs[2] - 4} y2={y} color={r.c} label={r.l2} /> : <DArrow x1={xs[2] - 4} y1={y} x2={xs[1] + 4} y2={y} color={r.c} label={r.l2} />}
            <text x={xs[1]} y={y + 16} textAnchor="middle" fill={r.c} fontSize={10} fontWeight={700}>
              {r.t}
            </text>
          </g>
        );
      })}
      <text x={20} y={242} fill={D.muted} fontSize={10}>
        Same xid {hex8(XID1)} on all four. &quot;DORA&quot; is only the memory aid; these four are the real message types.
      </text>
    </DiagramSvg>
  );
}

function GiaddrDiagram() {
  return (
    <DiagramSvg h={180} label={`The relay changes the DHCP message: hops 0 becomes 1, giaddr 0.0.0.0 becomes ${DH_ADDR["R1:CLIENT"]}; xid, chaddr and options are unchanged`}>
      <text x={20} y={22} fill={D.muted} fontSize={10.5} fontWeight={700}>
        as the client sent it
      </text>
      <DFieldRow x={20} y={30} h={34} fields={[{ label: "op 1", w: 70 }, { label: "hops 0", w: 80 }, { label: `xid …${hex8(XID1).slice(-4)}`, w: 110 }, { label: "ciaddr 0.0.0.0", w: 120 }, { label: "giaddr 0.0.0.0", w: 130 }, { label: "opt 53", w: 70 }]} />
      <text x={20} y={96} fill={DHCP} fontSize={10.5} fontWeight={700}>
        as R1 relays it
      </text>
      <DFieldRow x={20} y={104} h={34} fields={[{ label: "op 1", w: 70 }, { label: "hops 1", w: 80, color: DHCP, strong: true }, { label: `xid …${hex8(XID1).slice(-4)}`, w: 110 }, { label: "ciaddr 0.0.0.0", w: 120 }, { label: `giaddr ${DH_ADDR["R1:CLIENT"]}`, w: 130, color: DHCP, strong: true }, { label: "opt 53", w: 70 }]} />
      <text x={20} y={168} fill={D.muted} fontSize={10}>
        The server reads giaddr ({DH_ADDR["R1:CLIENT"]} ∈ 10.10.10.0/24) to pick the scope, and replies to the relay.
      </text>
    </DiagramSvg>
  );
}

function LeaseDiagram() {
  const rows = [
    { o: "Option 1 — Subnet Mask", v: MASK, c: "mask" },
    { o: "Option 3 — Router", v: DH_ADDR["R1:CLIENT"], c: "default gateway" },
    { o: "Option 6 — DNS Server", v: DH_ADDR["DNS-SRV"], c: "resolver" },
    { o: "Option 51 — Lease Time", v: `${LEASE_SECONDS} s`, c: "renew at T1 = 50 %" },
    { o: "yiaddr", v: DH_ADDR.CLIENT, c: "own address" },
  ];
  return (
    <DiagramSvg h={220} label={`DHCPACK fields become client configuration: yiaddr ${DH_ADDR.CLIENT}, Option 1 ${MASK}, Option 3 ${DH_ADDR["R1:CLIENT"]}, Option 6 ${DH_ADDR["DNS-SRV"]}, Option 51 ${LEASE_SECONDS} seconds`}>
      {rows.map((r, i) => (
        <g key={r.o}>
          <rect x={20} y={14 + i * 38} width={250} height={28} rx={6} fill={D.box} stroke={DHCP} strokeOpacity={0.6} />
          <text x={30} y={32 + i * 38} fill={D.text} fontSize={10.5}>
            {r.o}
          </text>
          <DArrow x1={276} y1={28 + i * 38} x2={344} y2={28 + i * 38} color={D.muted} width={1.4} />
          <text x={352} y={32 + i * 38} fill={D.cyan} fontSize={10.5} fontFamily="monospace">
            {r.v}
          </text>
          <text x={500} y={32 + i * 38} fill={D.muted} fontSize={10}>
            {r.c}
          </text>
        </g>
      ))}
    </DiagramSvg>
  );
}

function DnsDiagram() {
  return (
    <DiagramSvg h={200} label={`DNS query from ${DH_ADDR.CLIENT} port ${CLIENT_DNS_PORT} to ${DH_ADDR["DNS-SRV"]} port 53 with Transaction ID ${hex4(0x6c2a)} asking A ${DNS_NAME}; response from port 53 back to ${CLIENT_DNS_PORT} with the same ID and answer ${DH_ADDR.WEB} TTL ${DNS_RECORD_TTL}`}>
      <DNode x={90} y={100} label="CLIENT" sub={`${DH_ADDR.CLIENT}:${CLIENT_DNS_PORT}`} w={150} />
      <DNode x={540} y={100} label="DNS-SRV" sub={`${DH_ADDR["DNS-SRV"]}:53`} accent={DNS} w={150} />
      <DArrow x1={167} y1={86} x2={463} y2={86} color={DNS} label={`query ${hex4(0x6c2a)} · A ${DNS_NAME} · RD 1`} />
      <DArrow x1={463} y1={116} x2={167} y2={116} color={D.success} label={`response ${hex4(0x6c2a)} · QR 1 · RA 1 · A ${DH_ADDR.WEB} · TTL ${DNS_RECORD_TTL}`} labelDy={18} />
      <text x={20} y={180} fill={D.muted} fontSize={10}>
        UDP {CLIENT_DNS_PORT} → 53 and 53 → {CLIENT_DNS_PORT}. The matching Transaction ID pairs the answer with the question.
      </text>
    </DiagramSvg>
  );
}

function IncidentDiagram() {
  return (
    <DiagramSvg h={220} label={`With Option 6 = ${DH_ADDR.WRONG_DNS}, the client's queries go to an address nobody owns and get no answer, while a direct query to ${DH_ADDR["DNS-SRV"]} succeeds; the fix is to correct Option 6 and renew the lease`}>
      <DNode x={80} y={110} label="CLIENT" sub={`DNS = ${DH_ADDR.WRONG_DNS}`} accent={D.danger} w={150} />
      <DNode x={320} y={110} label="R1" accent={D.ip} w={80} />
      <DNode x={560} y={50} label={DH_ADDR.WRONG_DNS} sub="no such host" accent={D.faint} w={130} />
      <DNode x={560} y={170} label="DNS-SRV" sub={DH_ADDR["DNS-SRV"]} accent={DNS} w={130} />
      <DLink x1={157} y1={110} x2={278} y2={110} color={D.line} />
      <DArrow x1={362} y1={100} x2={493} y2={58} color={D.danger} dashed label="query → no ARP reply" />
      <DArrow x1={362} y1={120} x2={493} y2={162} color={D.success} label="direct query → answered" labelDy={18} />
      <DPill x={200} y={200} text="IP works · names fail" color={D.warning} w={170} />
    </DiagramSvg>
  );
}


function StoryLabBridge() {
  const open = usePracticeLabOpener();
  return (
    <PracticeBridge label="Open the DHCP & DNS Lab" onPractice={open}>
      Seven levels, one skill at a time: watch the story, see what each device does, learn where you could look, read one capture, follow messages to find where they stop, troubleshoot real tickets with each device&apos;s tables, logs and command line, then build DHCP and DNS yourself from nothing and prove they work.
    </PracticeBridge>
  );
}

export function DhcpDnsLessonGuideContent() {
  return (
    <div className="space-y-12">
      <GuideSection id="dh-mission" eyebrow="This lesson" title="From nothing to a name" tone="warning">
        <p>The whole lesson is one short story:</p>
        <ol className="list-decimal space-y-0.5 pl-5">
          <li>My computer needs network settings.</li>
          <li>It asks for them.</li>
          <li>The request has to reach the DHCP server.</li>
          <li>The server answers.</li>
          <li>The computer receives an IP address, a router (default gateway) and a DNS server.</li>
          <li>Then it can use DNS to turn a name into an IP address.</li>
        </ol>
        <p>Everything else, from the relay to the captures, is detail about one of these lines. Learn the story first; the investigation skills come after, in the same order as the lab&apos;s levels.</p>
        <Callout tone="warning" title="Two services, two jobs">
          DHCP answers &quot;what are my settings?&quot;. DNS answers &quot;what address is this name?&quot;. A wrong DHCP option can break DNS while every IP test passes.
        </Callout>
      </GuideSection>
      <GuideSection id="dh-story" eyebrow="How it works" title="From plugging in to opening a website by name" tone="cyan">
        <ProtocolStory
          problem={<>A freshly connected CLIENT has no IP address, mask, gateway or DNS server, so it can&apos;t talk to anything. The DHCP server that could configure it sits on another subnet, behind a router that doesn&apos;t forward broadcasts. And even once configured, the user types names, not addresses.</>}
          steps={[
            { actor: "CLIENT", action: <>broadcasts <strong>DHCPDISCOVER</strong> from <Mono>0.0.0.0</Mono> to <Mono>255.255.255.255</Mono> (UDP 68 → 67) with a transaction ID (xid {`0x${XID1.toString(16)}`}).</>, why: "it knows neither its own address nor the server's", verify: `A capture on the client LAN: a DHCP Discover from 0.0.0.0 to 255.255.255.255, UDP 68 → 67.`, fails: { symptom: `The client ends up with 169.254.x.x.`, evidence: `No offer came back. Follow the next steps: relay, server, pool.` }, tone: "warning" },
            { actor: "R1 (relay)", action: <>receives the broadcast, sets <strong>giaddr = {DH_ADDR["R1:CLIENT"]}</strong>, and unicasts it to DHCP-SRV {DH_ADDR["DHCP-SRV"]}.</>, why: "routers stop broadcasts; giaddr tells the server which subnet to serve", verify: `A capture on the server LAN: the Discover arrives as a unicast from R1, with giaddr ${DH_ADDR["R1:CLIENT"]}.`, fails: { symptom: `The Discover is seen on the client LAN but never on the server LAN.`, evidence: `No relay (ip helper) on R1's client interface, or it points at the wrong server.` }, tone: "cyan" },
            { actor: "DHCP-SRV", action: <>picks the pool for giaddr&apos;s subnet and sends <strong>DHCPOFFER</strong> {DH_ADDR.CLIENT} back to the relay, which broadcasts it onto the client LAN.</>, verify: `The server's bindings show an offer from the pool for giaddr's subnet.`, fails: { symptom: `The Discover reaches the server and no offer comes back.`, evidence: `The server's log says why (“no free leases”: the pool is exhausted). If the host answers ICMP port unreachable instead, the DHCP service isn't running: the host is up, the service is down.` }, tone: "violet" },
            { actor: "CLIENT", action: <>broadcasts <strong>DHCPREQUEST</strong> with Option 50 (requested IP) and Option 54 (server ID): “I accept this offer from this server.”</>, why: "broadcast so any other server knows its offer was declined", verify: `The Request carries option 50 (the offered IP) and option 54 (this server).`, fails: { symptom: `The client keeps sending Discovers.`, evidence: `The offers are not reaching the client: check the relay's path back.` }, tone: "warning" },
            { actor: "DHCP-SRV", action: <>confirms with <strong>DHCPACK</strong>: {DH_ADDR.CLIENT} / {MASK}, router {DH_ADDR["R1:CLIENT"]}, DNS {DH_ADDR["DNS-SRV"]} (Option 6), lease {LEASE_SECONDS} s.</>, changes: "the client is BOUND and configured", verify: `ipconfig / ip addr shows the address, mask, gateway and DNS server from the ACK.`, fails: { symptom: `The client has an address, but the wrong gateway or DNS server.`, evidence: `The scope options (3 and 6) are wrong. The client uses exactly what it was given.` }, tone: "success" },
            { actor: "CLIENT", action: <>needs to send to another subnet for the first time, so it ARPs for its gateway {DH_ADDR["R1:CLIENT"]} (from Option 3) and stores R1&apos;s MAC address.</>, why: "a frame needs the next hop's MAC; the gateway's IP alone isn't enough", verify: `arp -a lists ${DH_ADDR["R1:CLIENT"]}. A capture on the client LAN shows the ARP request and R1's reply.`, fails: { symptom: `Nothing leaves the LAN, by name or by IP; the real gateway still answers a ping.`, evidence: `The gateway from Option 3 doesn't answer ARP: nobody owns that address. Only ARP requests appear on the wire; the DNS query is never sent.` }, tone: "arp" },
            { actor: "CLIENT", action: <>resolves <Mono>{DNS_NAME}</Mono>: a DNS query from UDP {CLIENT_DNS_PORT} to {DH_ADDR["DNS-SRV"]}:53 with a Transaction ID, routed via its gateway.</>, verify: `Capture: a DNS query to the server from option 6, port 53, with a Transaction ID.`, fails: { symptom: `The lookup fails while pinging IP addresses works.`, evidence: `Follow the query. It dies at R1 (R1 can't ARP for that address): Option 6 points at a server that doesn't exist. It reaches DNS-SRV and comes back “port unreachable”: the DNS service is down.` }, tone: "ip" },
            { actor: "DNS-SRV", action: <>answers with the same Transaction ID: A record {DH_ADDR.WEB}, record TTL {DNS_RECORD_TTL} s.</>, changes: "the client caches the answer and can now send to the web server's IP", verify: `A response with the same Transaction ID and an A record. The client cache shows it with its TTL.`, fails: { symptom: `NXDOMAIN, or an old address.`, evidence: `A wrong name or missing record, or a cached answer that has not expired yet (flush the cache to test).` }, tone: "success" },
            { actor: "CLIENT", action: "renews halfway through the lease with a unicast REQUEST straight to the server (no relay needed); the ACK carries the current options.", verify: `At T1: a unicast Request from the client's own IP, then an ACK. The lease timer restarts.`, fails: { symptom: `The renewal fails, and later the client loses its address.`, evidence: `The server is unreachable or down. The client keeps its address until the lease expires, then starts over.` }, tone: "cyan" },
          ]}
          outcome={<>DHCP turns “nothing” into a working configuration, across the router thanks to the relay; DNS turns names into addresses using the server DHCP supplied. If Option 6 is wrong ({DH_ADDR.WRONG_DNS}), names fail while IP addresses still work. Fix the scope option, then make the client <strong>renew</strong> (existing leases aren&apos;t rewritten), and verify with a real lookup.</>}
        />
        <PresentationBridge>Watch DORA cross the relay, the DNS lookup and the Option 6 incident in the DHCP & DNS presentation.</PresentationBridge>
        <StoryLabBridge />
      </GuideSection>





      <GuideSection id="dh-evidence" eyebrow="Investigating" title="From watching to proving" tone="violet">
        <p>
          An animation shows the DISCOVER moving. On a real network there is no animation: an engineer has to <strong>prove</strong> where a message went. That skill is built in four small steps, each one answering a question you already understand.
        </p>

        <h4 className="text-[15px] font-semibold text-pv-text">1 · Ask questions about places (checkpoints)</h4>
        <p>When a laptop gets no address, don&apos;t start with the cause. Ask, in order: did the laptop send its request? Did it reach the router? Did the router pass it on? Did it reach the server? Did an answer come back? Each question is about one place, a <strong>checkpoint</strong>.</p>
        <Callout tone="cyan" title="The last ✓ is where to dig">
          You don&apos;t need to know why something failed to find where. The last checkpoint that saw the message is where the problem is; everything before it works.
        </Callout>

        <h4 className="text-[15px] font-semibold text-pv-text">2 · Read one capture</h4>
        <p>A checkpoint is read with a <strong>capture</strong>: a recording of what crossed one cable. A few fields tell you almost everything:</p>
        <FieldTable
          title="What the fields of a DHCP or DNS capture mean"
          columns={["You see", "It means"]}
          accent="violet"
          rows={[
            ["From 0.0.0.0", "a client that has no address yet: it can only be asking for one"],
            ["To 255.255.255.255", "“everyone on this network”: a broadcast, which routers don't pass on"],
            ["UDP 68 → 67", "DHCP: servers listen on 67, clients on 68. Any message with these ports is DHCP, which is why a capture filter on them shows exactly the DHCP traffic"],
            [<>giaddr <Mono>{DH_ADDR["R1:CLIENT"]}</Mono></>, "a relay forwarded it, and the client is on that network"],
            ["Option 3 / Option 6", "the router and DNS server the client is being given"],
            ["UDP → 53", "DNS: a name question, or its answer"],
          ]}
        />
        <p>Seeing a message at a point proves it <strong>got there</strong>. An empty, filtered capture proves it <strong>never got there</strong>. Seeing it arrive at a server does <strong>not</strong> prove the server answered: look for the answer too.</p>

        <h4 className="text-[15px] font-semibold text-pv-text">3 · Follow one message</h4>
        <p>Put the checkpoints together and follow one message from the laptop to the server and back. On R1&apos;s laptop side the DISCOVER is the client&apos;s broadcast; on R1&apos;s server side it is a new message from the router itself, with giaddr filled in. For DNS there are two extra stops before anything is sent: the laptop&apos;s <strong>cache</strong> (a remembered answer sends nothing) and <strong>ARP</strong> (the laptop needs its router&apos;s hardware address, and the router needs the DNS server&apos;s).</p>
        <CompareCards
          items={[
            { title: "Traffic exists", tone: "cyan", tag: "network", points: ["The message is seen at a point", "Proves the path up to there", "Doesn't prove any service answered"] },
            { title: "The service answered", tone: "violet", tag: "service", points: ["An offer/ACK or DNS answer came back", "Proves the server's program works", "A ping to the server proves neither"] },
            { title: "The user's task works", tone: "success", tag: "end to end", points: ["The laptop has the right settings", "The name resolves, the address is reachable", "Each is a separate test"] },
          ]}
        />

        <h4 className="text-[15px] font-semibold text-pv-text">4 · Pick the tool that answers your question</h4>
        <p>Once you know where a message stopped, each device&apos;s own information tells you why. Start from the question, not from the tool:</p>
        <FieldTable
          title="Question → where to look"
          columns={["Your question", "Look at"]}
          accent="cyan"
          rows={[
            ["What settings did the laptop get?", "the laptop's configuration (ipconfig /all)"],
            ["Is the router set up to relay DHCP?", "R1's interface settings: the helper address"],
            ["Can the router reach that address at all?", "R1's ARP table: an incomplete entry means nobody answered"],
            ["Is the DHCP / DNS service running?", "the server's service status and listening ports"],
            ["Did the server hear this laptop, and what did it decide?", "the server's log (and its leases: any free?)"],
            ["Is the laptop answering from memory?", "the laptop's DNS cache"],
          ]}
        />
        <FailureSignatures
          items={[
            { tag: "1", title: "169.254, stops at R1", tone: "danger", points: ["Seen arriving at R1, never leaving its other side", "No helper address configured", "Cause: no relay"] },
            { tag: "2", title: "Reaches the server, no offer", tone: "danger", points: ["Server log: “no free leases” → pool exhausted", "Host answers port unreachable → service stopped", "The network works in both cases"] },
            { tag: "3", title: "Address OK, nothing leaves", tone: "warning", points: ["Only ARP questions for the router, no reply", "Cause: wrong Option 3"] },
            { tag: "4", title: "Names fail, stops at R1", tone: "warning", points: ["R1 can't find the DNS address (ARP incomplete)", "Cause: wrong Option 6"] },
            { tag: "5", title: "Names fail, reaches DNS-SRV", tone: "warning", points: ["Refused (port unreachable); ping still works", "Cause: DNS service stopped"] },
            { tag: "6", title: "Old address, nothing sent", tone: "cyan", points: ["The laptop's cache still holds the old answer", "Cause: stale cache until the TTL runs out"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="dh-breaks" eyebrow="When it breaks" title={`When a client can not get online: find which half failed`} tone="danger">
        <p className="text-sm text-pv-text-muted">{`Getting online is two stories: DHCP gives the client its identity, then DNS turns names into addresses. First find which story stopped, then which step.`}</p>
        <TroubleshootingFlow
          steps={[
            { question: `Does the client have a real address?`, look: `169.254.x.x or no address means DHCP failed: follow the DISCOVER (client → R1 → server) until the evidence stops. A real address means DHCP worked, so move on.` },
            { question: `Are its gateway and DNS server what they should be?`, look: `Compare them with the scope's options 3 and 6. Wrong values come from the server: fix the scope, then renew the client.` },
            { question: `Can it reach an IP address?`, look: `Ping the gateway, then a remote IP. If that fails, check the client's ARP entry for its gateway: the problem is the gateway or routing, not DNS.` },
            { question: `Can it resolve a name?`, look: `IPs work but names fail means DNS: which server did DHCP give, did the query reach it, and did the service answer, refuse or never hear of it?` },
            { question: `How do you prove the fix?`, look: `Renew, so the client picks up the corrected options. Then check its identity, resolve the name, and ping.` },
          ]}
        />
        <Callout tone="cyan" title="The habit to build" icon="✓">
          Walk the story in order and confirm each step with real evidence (a table, a capture, a command). The first step you cannot confirm is where the problem is. The boxes under each story step above say what to look at.
        </Callout>
      </GuideSection>

      <GuideSection id="dh-build" eyebrow="Configuration" title="Building it: what goes where, and how to prove it works" tone="success">
        <p>Three devices need configuration, each for a reason that follows from the story. The laptop needs none (it is set to obtain everything automatically), and the switches need none (they only carry messages). Each is configured where it really lives: the router from its command line (IOS or Junos), the DHCP server from its terminal (edit <Mono>/etc/dhcp/dhcpd.conf</Mono>, check it with <Mono>dhcpd -t</Mono>, restart the service), the DNS server through its zone file, <Mono>named-checkzone</Mono> and a reload. In the lab&apos;s Build station you do exactly that, device by device, and confirm each change: the device accepted it, it is active, you saw it on the device, traffic shows it, and the whole service works.</p>
        <FieldTable
          title="What to configure, on which device, and why"
          columns={["Device", "Configure", "Why it belongs there", "If it's wrong or missing"]}
          accent="success"
          rows={[
            ["DHCP server", "a scope: the clients' subnet, an address range, option 3 (router) and option 6 (DNS server)", "only the server decides addresses and settings; it picks the scope whose subnet contains giaddr", "no scope for that subnet: requests arrive and are ignored (“unknown network segment”). A range outside the subnet: the service fails to start"],
            ["Router (R1)", <>a DHCP relay: <Mono>ip helper-address</Mono> on the interface facing the clients</>, "routers don't pass broadcasts on; the relay turns the client's broadcast into a message to the server", "missing or on the wrong interface: requests stop at the router. Pointing at the wrong address: they go to the wrong place"],
            ["DNS server", "one A record per name in the zone", "a DNS server can only answer names it has records for", "missing: “no such name”. Wrong address: a confident wrong answer, which only a test of the address reveals"],
          ]}
        />
        <Callout tone="warning" title="Accepted is not the same as working">
          A configuration being saved proves nothing about the network. The DHCP service might not have started. The relay might sit on the wrong interface. A record might point at the wrong address. Only the network&apos;s behavior proves the service works.
        </Callout>
        <CompareCards
          items={[
            { title: "Testing DHCP", tone: "cyan", tag: "proves settings", points: ["A new laptop gets an address in the planned range", "It received the planned router and DNS server", "Its router answers a ping", "Doesn't prove names work"] },
            { title: "Testing DNS", tone: "violet", tag: "proves names", points: ["The cache is empty, so a real query is sent", "Each name resolves to its planned address", "ping by name reaches the server", "Depends on DHCP having given the right DNS server"] },
          ]}
        />
        <FieldTable
          title="A DHCP problem or a DNS problem?"
          columns={["What you see", "Whose configuration"]}
          accent="violet"
          rows={[
            ["169.254 address, or no settings", "DHCP: server or relay"],
            ["An address, but nothing beyond the LAN works (by name or IP)", "DHCP: option 3 (router)"],
            ["Names fail, the question never reaches a DNS server, or is refused by a host that isn't one", "DHCP: option 6 (the laptop was told the wrong server)"],
            ["The question reaches the DNS server: “no such name”", "DNS: the zone has no such record"],
            ["A name resolves, but to an address that doesn't answer", "DNS: the record points at the wrong address"],
            ["The DNS server refuses everything (port unreachable) but answers pings", "DNS: the service isn't running"],
          ]}
        />
      </GuideSection>

      <PathDivider title="Reference">Every part of the story in detail. Read the parts you need.</PathDivider>


      <GuideSection id="dh-boundary" eyebrow="Broadcast boundary" title="Why a relay is needed" tone="cyan">
        <DiagramFrame caption="255.255.255.255 never crosses a router. The relay agent re-sends the DHCP message as unicast.">
          <BoundaryDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="dh-dora" eyebrow="The exchange" title="DHCPDISCOVER → DHCPOFFER → DHCPREQUEST → DHCPACK" tone="violet">
        <DiagramFrame caption="Client side: UDP 68 ↔ 67 broadcasts (the client set the BROADCAST flag). Relay ↔ server: unicast on UDP 67.">
          <DoraDiagram />
        </DiagramFrame>
        <p>
          The REQUEST carries Option 50 (the requested address, <Mono>{DH_ADDR.CLIENT}</Mono>) and Option 54 (the chosen server, <Mono>{DH_ADDR["DHCP-SRV"]}</Mono>). ciaddr stays 0.0.0.0 because nothing is bound yet.
        </p>
      </GuideSection>

      <GuideSection id="dh-giaddr" eyebrow="Relay" title="giaddr picks the pool" tone="warning">
        <DiagramFrame caption="Only hops and giaddr change at the relay.">
          <GiaddrDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="dh-lease" eyebrow="Lease" title="What the ACK configures" tone="success">
        <DiagramFrame caption="Every part of the client's IPv4 setup comes from the ACK.">
          <LeaseDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="dh-dns" eyebrow="Name resolution" title="A DNS query and response" tone="violet">
        <DiagramFrame caption="The client asks the DNS server from Option 6.">
          <DnsDiagram />
        </DiagramFrame>
        <Callout tone="cyan" title="Two different TTLs">
          The answer&apos;s TTL ({DNS_RECORD_TTL}) is how many seconds the answer may be cached. The IPv4 TTL in the same packet (63 on arrival) is a router hop limit. Same name, unrelated meanings.
        </Callout>
      </GuideSection>

      <GuideSection id="dh-incident" eyebrow="Troubleshooting" title="IP works, names don't" tone="danger">
        <DiagramFrame caption="The client can only ask the DNS server its lease names.">
          <IncidentDiagram />
        </DiagramFrame>
        <CompareCards
          items={[
            { title: "Healthy", tone: "success", tag: "evidence", points: ["Address, mask and gateway", "Routing to 10.20.20.0/24", "DNS-SRV answers direct queries"] },
            { title: "Faulty", tone: "danger", tag: "cause", points: [`Option 6 = ${DH_ADDR.WRONG_DNS}`, "Nothing owns that address", "Changing the server doesn't change a lease the client already holds"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="dh-verify" eyebrow="Verification" title="Fix, renew, resolve" tone="success">
        <FlowSteps
          steps={[
            { title: "Correct the scope", body: <>Option 6 → <Mono>{DH_ADDR["DNS-SRV"]}</Mono>. The client still holds its old lease.</>, tone: "warning" },
            { title: "Renew the lease", body: "The client unicasts a DHCPREQUEST (ciaddr set) straight to the server. It's routed, not relayed.", tone: "cyan" },
            { title: "Receive the new option", body: `The unicast DHCPACK carries Option 6 = ${DH_ADDR["DNS-SRV"]}.`, tone: "violet" },
            { title: "Resolve again", body: `${DNS_NAME} → ${DH_ADDR.WEB}, with a matching Transaction ID.`, tone: "success" },
          ]}
        />
      </GuideSection>

      <GuideSection id="dh-model" eyebrow="Mental model" title="A welcome pack and a phone book" tone="cyan">
        <p>DHCP is the welcome pack handed out at the door: your address, the exit (gateway), and which phone book (DNS server) to use. DNS is the phone book. If the pack lists the wrong phone book, the building and exits work fine, but you can&apos;t look anyone up. A corrected pack only reaches you when you collect a new one: the renewal.</p>
      </GuideSection>

      <GuideSection id="dh-glossary" eyebrow="Glossary" title="Terms used in this lesson" tone="violet">
        <Glossary
          items={[
            { term: "DHCPDISCOVER / OFFER / REQUEST / ACK", def: "The four messages of a new lease (the 'DORA' mnemonic)." },
            { term: "xid", def: "Transaction ID shared by the messages of one exchange." },
            { term: "giaddr", def: "Relay (gateway) address. Tells the server which subnet to serve." },
            { term: "Option 6", def: "Domain Name Server list handed to the client." },
            { term: "Lease", def: "Time-limited use of an address and its options." },
            { term: "A record", def: "DNS record mapping a name to an IPv4 address." },
            { term: "Transaction ID (DNS)", def: "Pairs a DNS response with its query." },
            { term: "Observation point", def: "A place where you can see traffic or state: a host's capture, a switch mirror port, a router interface, a server log." },
            { term: "Mirror (SPAN) port", def: "A switch feature that copies one port's traffic to an analyser, because a switch can't capture by itself." },
            { term: "ICMP port unreachable", def: "The answer from a host that is up but has nothing listening on that UDP port: host up, service down." },
            { term: "Incomplete ARP entry", def: "The device asked “who has this IP?” and nobody answered, so it can't send anything there." },
          ]}
        />
      </GuideSection>

      <GuideSection id="dh-recap" eyebrow="Recap" title="What you can now explain" tone="success">
        <ChecklistCard tone="cyan" title="DHCP + DNS" mark="→" items={["A new client broadcasts from 0.0.0.0 on UDP 68 → 67", "A relay stamps giaddr and unicasts to the server", "Offer/Request/Ack share the xid; Request names the chosen server", "The lease sets address, mask, gateway and DNS", "DNS query UDP → 53, answer back with the same ID", "Fixing a DHCP option needs a lease renewal to reach clients", "Each observation point proves one step; follow a message until the evidence stops", "Traffic reaching a server doesn't prove its service works"]} />
      </GuideSection>
    </div>
  );
}
