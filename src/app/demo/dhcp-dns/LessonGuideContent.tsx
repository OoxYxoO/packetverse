import { Callout, ChecklistCard, CompareCards, DArrow, DIAGRAM as D, DiagramFrame, DiagramSvg, DLink, DNode, DPill, DRegion, FlowSteps, Glossary, GuideSection, Mono } from "@/components/lesson/GuideBlocks";
import { DFieldRow } from "@/components/lesson/FundamentalsGuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { hex4, hex8 } from "@/lib/sim-engine/scenarios/fundamentalsPackets";
import { CLIENT_DNS_PORT, DH_ADDR, DNS_NAME, DNS_RECORD_TTL, LEASE_SECONDS, MASK, XID1 } from "@/lib/sim-engine/scenarios/dhcpDns";

export const DH_LESSON_SECTIONS: LessonGuideSectionLink[] = [
  { id: "dh-mission", label: "The mission" },
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

export function DhcpDnsLessonGuideContent() {
  return (
    <div className="space-y-12">
      <GuideSection id="dh-mission" eyebrow="This lesson" title="From nothing to a name" tone="warning">
        <p>A newly booted device knows only its MAC address. DHCP gives it an address, mask, gateway and DNS server. DNS then turns names into addresses. Both depend on the network already working, and each can fail on its own.</p>
        <Callout tone="warning" title="Two services, two jobs">
          DHCP answers &quot;what are my settings?&quot;. DNS answers &quot;what address is this name?&quot;. A wrong DHCP option can break DNS while every IP test passes.
        </Callout>
      </GuideSection>

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
          ]}
        />
      </GuideSection>

      <GuideSection id="dh-recap" eyebrow="Recap" title="What you can now explain" tone="success">
        <ChecklistCard tone="cyan" title="DHCP + DNS" mark="→" items={["A new client broadcasts from 0.0.0.0 on UDP 68 → 67", "A relay stamps giaddr and unicasts to the server", "Offer/Request/Ack share the xid; Request names the chosen server", "The lease sets address, mask, gateway and DNS", "DNS query UDP → 53, answer back with the same ID", "Fixing a DHCP option needs a lease renewal to reach clients"]} />
      </GuideSection>
    </div>
  );
}
