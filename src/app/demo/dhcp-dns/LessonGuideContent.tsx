import { ChecklistCard, CompareCards, DArrow, DIAGRAM as D, DiagramFrame, DiagramSvg, DLink, DNode, DPill, DRegion, FieldTable, FlowSteps, Glossary, GuideSection, Mono, TroubleshootingFlow } from "@/components/lesson/GuideBlocks";
import { PresentationBridge } from "@/components/presentation/LessonPresentation";
import { PracticeBridge } from "@/components/lesson/GuideInteractive";
import { usePracticeLabOpener } from "@/components/lesson/FundamentalsLessonShell";
import { DFieldRow } from "@/components/lesson/FundamentalsGuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { CliPanel, pickLines, runGuideCli } from "@/components/lesson/GuideCli";
import type { CliVendor } from "@/lib/cli/types";
import { hex4, hex8 } from "@/lib/sim-engine/scenarios/fundamentalsPackets";
import { CLIENT_DNS_PORT, DH_ADDR, DNS_NAME, DNS_RECORD_TTL, LEASE_SECONDS, MASK, XID1 } from "@/lib/sim-engine/scenarios/dhcpDns";
import { createDlState, DL_LAB_MODEL, type DlAction, type DlNode, type DlState } from "@/lib/sim-engine/scenarios/dhcpDnsLab";
import { dlCliSets } from "./dhcp-lab/dhcpCli";
import { clientPromptSet } from "./dhcp-lab/dhcpBuildCli";

/**
 * DHCP & DNS LESSON GUIDE — the lesson's story on the DHCP & DNS Lab's network (CLIENT → R1 relay → DHCP-SRV and DNS-SRV):
 * the broadcast, the four DHCP messages, the relay and giaddr, the lease, the DNS lookup and its cache; then the incident
 * where DHCP hands out the wrong DNS server. Every output comes from the lab's own model and its device terminals.
 */
export const DH_LESSON_SECTIONS: LessonGuideSectionLink[] = [
  { id: "dh-mission", label: "What this lesson teaches" },
  { id: "dh-network", label: "The network of this lesson" },
  { id: "dh-ideas", label: "Three ideas you need" },
  { id: "dh-walk", label: "What you will watch" },
  { id: "dh-start", label: "A laptop that knows nothing" },
  { id: "dh-boundary", label: "The first message is a broadcast" },
  { id: "dh-dora", label: "Discover, Offer, Request, Ack" },
  { id: "dh-giaddr", label: "The relay and giaddr" },
  { id: "dh-lease", label: "What the lease sets" },
  { id: "dh-dns", label: "Then a name: DNS" },
  { id: "dh-cache", label: "Answers are cached" },
  { id: "dh-verify", label: "What working looks like" },
  { id: "dh-incident", label: "The incident" },
  { id: "dh-investigate", label: "Which DNS server was asked?" },
  { id: "dh-repair", label: "Repair and prove it" },
  { id: "dh-other", label: "Other ways it breaks" },
  { id: "dh-model", label: "Mental model" },
  { id: "dh-glossary", label: "Glossary" },
  { id: "dh-recap", label: "Recap" },
  { id: "dh-practice", label: "Practice it" },
];

/** The lab's own terminals: the laptop's command prompt ("PC") and the devices' consoles; actions run on a copy. */
function lessonCli(s: DlState, dev: DlNode | "PC", vendor: CliVendor, command: string) {
  return runGuideCli(dev === "PC" ? clientPromptSet(s, () => undefined) : dlCliSets(s, dev)[vendor], command);
}
const run = (s: DlState, ...as: DlAction[]) => as.reduce((x, a) => DL_LAB_MODEL.start(x, a), s);
const HEALTHY = run(createDlState(), { type: "dhcp-all" }, { type: "resolve", name: DNS_NAME });
const BROKEN = run(createDlState(), { type: "ticket", id: "dns-option" });
const FIXED = run(BROKEN, { type: "config", patch: { option6: DH_ADDR["DNS-SRV"] } }, { type: "renew" });

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

function LessonLabBridge() {
  const open = usePracticeLabOpener();
  return (
    <PracticeBridge label="Open the DHCP & DNS Lab" onPractice={open}>
      Same network, your own copy. Nothing you do there changes your lesson progress.
    </PracticeBridge>
  );
}

export function DhcpDnsLessonGuideContent() {
  const renewOk = lessonCli(createDlState(), "PC", "cisco", "ipconfig /renew");
  const journal = lessonCli(HEALTHY, "DHCP-SRV", "cisco", "journalctl -u isc-dhcp-server");
  const helper = lessonCli(HEALTHY, "R1", "cisco", "show running-config interface GigabitEthernet0/0");
  const allOk = lessonCli(HEALTHY, "PC", "cisco", "ipconfig /all");
  const nsOk = lessonCli(HEALTHY, "PC", "cisco", `nslookup ${DNS_NAME}`);
  const cacheOk = lessonCli(HEALTHY, "PC", "cisco", "ipconfig /displaydns");
  const nsBad = lessonCli(BROKEN, "PC", "cisco", `nslookup ${DNS_NAME}`);
  const pingIp = lessonCli(BROKEN, "PC", "cisco", `ping ${DH_ADDR.WEB}`);
  const pingName = lessonCli(BROKEN, "PC", "cisco", `ping ${DNS_NAME}`);
  const allBad = lessonCli(BROKEN, "PC", "cisco", "ipconfig /all");
  const confBad = lessonCli(BROKEN, "DHCP-SRV", "cisco", "cat /etc/dhcp/dhcpd.conf");
  const allFixed = lessonCli(FIXED, "PC", "cisco", "ipconfig /all");
  const nsFixed = lessonCli(FIXED, "PC", "cisco", `nslookup ${DNS_NAME}`);
  return (
    <div className="space-y-12">
      <GuideSection id="dh-mission" eyebrow="This lesson" title="What this lesson teaches" tone="warning">
        <p>
          A new laptop is plugged into the office network. Before it can open a single website it needs an address, a mask, a gateway and a DNS server, and nobody types any of them in. Then the user types a name, and something has to turn that name into an address.
        </p>
        <p>
          This lesson shows how <strong>DHCP</strong> and <strong>DNS</strong> do that: you watch the laptop shout for help, a relay carry the shout to a server in another subnet, four messages hand out a lease, and a DNS query turn a name into an address that is then cached. Then websites open by IP but not by name, and you find out why, fix it, and prove it.
        </p>
        <ChecklistCard
          tone="warning"
          title="By the end of this lesson you can"
          mark="→"
          items={[
            "explain why the laptop's first message is a broadcast, and why a relay must carry it",
            "name the four DHCP messages and say what each one changes",
            "read a lease: address, mask, gateway (option 3), DNS server (option 6), lease time",
            "follow a DNS query and its answer, and say how long the answer is kept",
            "find and repair the incident of this lesson from the laptop and the servers, and prove it",
          ]}
        />
      </GuideSection>

      <GuideSection id="dh-network" eyebrow="This lesson" title="The network of this lesson" tone="cyan">
        <DiagramFrame caption="The laptop's subnet and the servers' subnet. R1 joins them and relays DHCP.">
          <BoundaryDiagram />
        </DiagramFrame>
        <FieldTable
          title="Who does what"
          columns={["Device", "Address", "Role"]}
          rows={[
            ["CLIENT (Windows laptop)", "none yet → 10.10.10.50", "Asks DHCP for its settings, then asks DNS for names"],
            ["R1", `${DH_ADDR["R1:CLIENT"]} · ${DH_ADDR["R1:SERVER"]}`, "The laptop's gateway; relays DHCP to the server (ip helper-address)"],
            ["DHCP-SRV (Linux, ISC dhcpd)", DH_ADDR["DHCP-SRV"], "Holds the scope 10.10.10.50–150 and the options"],
            ["DNS-SRV (Linux, BIND)", DH_ADDR["DNS-SRV"], "Authoritative for packetverse.test"],
            ["WEB", DH_ADDR.WEB, `What ${DNS_NAME} points to`],
          ]}
        />
      </GuideSection>

      <GuideSection id="dh-ideas" eyebrow="This lesson" title="Three ideas you need" tone="cyan">
        <FlowSteps
          steps={[
            { title: "DHCP gives a host its settings", body: "An address and mask, a gateway (option 3), a DNS server (option 6) and a lease time. The host uses them exactly as given.", tone: "warning" },
            { title: "A broadcast can't cross a router", body: "The laptop has no address yet, so it can only broadcast. A relay on the router forwards the request to a server in another subnet.", tone: "ip" },
            { title: "DNS turns names into addresses", body: "The laptop asks the DNS server DHCP named. The answer comes with a TTL, and the laptop keeps it that long.", tone: "violet" },
          ]}
        />
      </GuideSection>

      <GuideSection id="dh-walk" eyebrow="This lesson" title="What you will watch, step by step" tone="warning">
        <FlowSteps
          steps={[
            { title: "A shout for help", body: "The laptop broadcasts a DHCPDISCOVER from 0.0.0.0.", tone: "warning" },
            { title: "The relay", body: "R1 turns the broadcast into a unicast to DHCP-SRV and stamps giaddr.", tone: "ip" },
            { title: "Four messages", body: "Discover, Offer, Request, Ack: the lease is agreed.", tone: "success" },
            { title: "The lease", body: "Address, mask, gateway, DNS server and a 24-hour lease.", tone: "cyan" },
            { title: "A name", body: `${DNS_NAME} becomes ${DH_ADDR.WEB}, and is cached.`, tone: "violet" },
            { title: "The incident", body: "Websites open by IP, never by name. You find out why and fix it.", tone: "danger" },
          ]}
        />
        <p className="text-sm text-pv-text-muted">The sections below walk through each step on this network, in the same order.</p>
      </GuideSection>

      <GuideSection id="dh-start" eyebrow="The problem" title="A laptop that knows nothing" tone="warning">
        <p>
          Freshly plugged in, the laptop has no IPv4 address, no idea which subnet it is on, no gateway and no DNS server. It can&apos;t ARP for a gateway it doesn&apos;t know, and it can&apos;t send to a server it can&apos;t name. All it can do is ask the whole LAN for help, and that is how DHCP starts. In the laptop&apos;s command prompt, <Mono>ipconfig /renew</Mono> sets the whole exchange off:
        </p>
        <CliPanel run={renewOk} caption="CLIENT · Windows" />
      </GuideSection>

      <GuideSection id="dh-boundary" eyebrow="The broadcast" title="Its first message is a broadcast" tone="ip">
        <p>
          The DHCPDISCOVER goes from 0.0.0.0 (no address yet) to 255.255.255.255, UDP port 68 to 67, inside an Ethernet broadcast. SW1 floods it to everyone on 10.10.10.0/24. But DHCP-SRV is on another subnet, and a router never forwards a broadcast. Without help, the request dies at R1.
        </p>
        <p>
          The help is a <strong>relay agent</strong> on R1&apos;s LAN interface: <Mono>ip helper-address {DH_ADDR["DHCP-SRV"]}</Mono>. R1 picks up the broadcast and re-sends it as an ordinary unicast to the server:
        </p>
        <CliPanel run={helper} caption="R1 · Cisco IOS" />
      </GuideSection>

      <GuideSection id="dh-dora" eyebrow="DHCP" title="Discover, Offer, Request, Ack" tone="success">
        <p>Four messages, all with the same transaction ID (xid), so the laptop can tell its answers from anyone else&apos;s:</p>
        <DiagramFrame caption="The client's side is broadcast; between R1 and the server everything is unicast.">
          <DoraDiagram />
        </DiagramFrame>
        <FieldTable
          title="What each message does"
          columns={["Message", "From → to", "Means"]}
          rows={[
            ["DHCPDISCOVER", "client → everyone (via relay)", "Is there a DHCP server?"],
            ["DHCPOFFER", "server → client", "You can have 10.10.10.50, with these options"],
            ["DHCPREQUEST", "client → everyone (via relay)", "I take that offer from that server (options 50 and 54)"],
            ["DHCPACK", "server → client", "It's yours for 24 hours. Configure yourself"],
          ]}
        />
        <p>The server&apos;s log records the same four steps, each one &quot;via 10.10.10.1&quot;: the relay that brought it:</p>
        <CliPanel run={journal} caption="DHCP-SRV · Linux" />
      </GuideSection>

      <GuideSection id="dh-giaddr" eyebrow="The relay" title="The relay and giaddr: how the server picks the scope" tone="ip">
        <p>
          The server serves many subnets from one place. It knows which pool to use from the <strong>giaddr</strong> field the relay fills in: R1 writes its own LAN address, 10.10.10.1. The server looks for the scope that contains it and answers back to the relay, which delivers the reply to the laptop.
        </p>
        <DiagramFrame caption="The relay adds itself; the client's own fields and options are untouched.">
          <GiaddrDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="dh-lease" eyebrow="The lease" title="What the lease sets" tone="cyan">
        <p>When the DHCPACK arrives, the laptop configures itself from it, field by field:</p>
        <DiagramFrame caption="Every field of the Ack becomes a setting on the laptop.">
          <LeaseDiagram />
        </DiagramFrame>
        <CliPanel run={allOk} caption="CLIENT · Windows · after the Ack" />
        <p className="text-sm text-pv-text-muted">The lease runs {LEASE_SECONDS / 3600} hours. At half-time (T1) the laptop asks the same server directly to renew; only if that fails does it broadcast again near the end (T2). Give the address back with <Mono>ipconfig /release</Mono>.</p>
      </GuideSection>

      <GuideSection id="dh-dns" eyebrow="DNS" title="Then a name: the DNS lookup" tone="violet">
        <p>
          The user opens <Mono>{DNS_NAME}</Mono>. The laptop sends a DNS query (UDP to port 53) to the server its lease named in option 6, {DH_ADDR["DNS-SRV"]}. DNS-SRV is <strong>authoritative</strong> for packetverse.test: it holds the zone, so it answers from its own records.
        </p>
        <DiagramFrame caption="One query, one response, matched by the transaction ID.">
          <DnsDiagram />
        </DiagramFrame>
        <CliPanel run={nsOk} caption="CLIENT · Windows" />
        <p className="text-sm text-pv-text-muted">For names outside its own zones a DNS server works <strong>recursively</strong>: it asks the root, then the top-level domain, then the authoritative server, and returns the final answer. The Deep Dive follows that chain.</p>
      </GuideSection>

      <GuideSection id="dh-cache" eyebrow="Caching" title="Answers are cached for their TTL" tone="violet">
        <p>The answer carries a TTL ({DNS_RECORD_TTL} s here). The laptop keeps it that long and reuses it: the next lookup doesn&apos;t leave the laptop at all.</p>
        <CliPanel run={cacheOk} caption="CLIENT · the DNS cache" />
        <p>
          Notice what the laptop takes on trust in this whole story: it asks whatever DNS server the lease names, and it never checks that a DNS server actually answers there. Keep that in mind: it is the key to the incident.
        </p>
      </GuideSection>

      <GuideSection id="dh-verify" eyebrow="Verification" title="What working looks like" tone="success">
        <p>Each idea of this lesson has one place that proves it. The commands are only the way to ask; what matters is what each answer proves.</p>
        <FieldTable
          title="Read the lesson on the devices"
          columns={["Question", "Where", "Command", "What the answer proves"]}
          rows={[
            ["What did DHCP give the laptop?", "CLIENT", <Mono key="1">ipconfig /all</Mono>, "Address, gateway, DNS server, lease, and which server granted it"],
            ["Does the relay exist?", "R1", <Mono key="2">show running-config interface … · show configuration forwarding-options dhcp-relay</Mono>, "A helper address on the clients' interface"],
            ["What did the server hand out?", "DHCP-SRV", <Mono key="3">journalctl -u isc-dhcp-server · dhcp-lease-list · cat /etc/dhcp/dhcpd.conf</Mono>, "The exchange, the leases, and the options it sends"],
            ["Does DNS answer?", "CLIENT · DNS-SRV", <Mono key="4">nslookup · systemctl status named · cat /etc/bind/db.packetverse.test</Mono>, "The name resolves, from the server the lease named"],
          ]}
        />
        <p>Healthy: the lease names {DH_ADDR["DNS-SRV"]} and that server answers (both shown above).</p>
      </GuideSection>

      <GuideSection id="dh-incident" eyebrow="Incident" title="The incident: names fail, IPs work" tone="danger">
        <p>The user says: &quot;Websites don&apos;t open by name, but our IT person says pinging 203.0.113.80 works.&quot; The laptop has an address, and nothing reports an error except the lookups.</p>
        <DiagramFrame caption={`The lease names ${DH_ADDR.WRONG_DNS}, an address nobody has. Every query goes there and dies.`}>
          <IncidentDiagram />
        </DiagramFrame>
        <CompareCards
          items={[
            { title: "What should happen", tone: "success", tag: "normal", points: [`The lease names ${DH_ADDR["DNS-SRV"]} as DNS server`, "The query reaches DNS-SRV", "The answer comes back and is cached"] },
            { title: "What happens", tone: "danger", tag: "incident", points: [`The lease names ${DH_ADDR.WRONG_DNS}`, "Every query goes to an address nobody owns", "The laptop gets no answer and gives up"] },
          ]}
        />
        <CompareCards
          items={[
            { title: "Why it fails", tone: "danger", tag: "cause", points: [`The DHCP server's option 6 says ${DH_ADDR.WRONG_DNS}`, "Every client that takes a lease inherits the wrong DNS server", "DNS-SRV itself is fine: nobody asks it"] },
            { title: "What it can't be", tone: "warning", tag: "red herrings", points: ["Routing or the gateway: ping by IP works", "DHCP itself: the laptop has a valid lease", "The DNS zone: DNS-SRV would answer if asked"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="dh-investigate" eyebrow="Investigation" title="Which DNS server was asked?" tone="danger">
        <TroubleshootingFlow
          steps={[
            { question: "By IP, or by name?", look: "ping by IP answers; ping by name can't find the host. The path is fine: the problem is the lookup." },
            { question: "Which DNS server did the laptop ask?", look: `nslookup times out against ${DH_ADDR.WRONG_DNS}; ipconfig /all confirms that is the DNS server the lease gave.` },
            { question: "Who told it that?", look: "The DHCP server's configuration: option domain-name-servers is wrong." },
          ]}
        />
        <CliPanel run={pingIp} caption="CLIENT · by IP" />
        <CliPanel run={pingName} caption="CLIENT · by name" />
        <CliPanel run={nsBad} caption="CLIENT · the lookup itself" />
        <CliPanel run={{ ...allBad, output: pickLines(allBad.output, /IPv4|Gateway|DHCP Server|DNS Servers/) }} caption="CLIENT · what the lease said" />
        <CliPanel run={{ ...confBad, output: pickLines(confBad.output, /subnet 10\.10|range|option|lease|^\}/) }} caption="DHCP-SRV · the source of the wrong value" />
      </GuideSection>

      <GuideSection id="dh-repair" eyebrow="Repair" title="Repair at the source, then renew" tone="success">
        <p>
          Fixing the laptop by hand would leave every other client broken. Fix the scope on DHCP-SRV: <Mono>option domain-name-servers {DH_ADDR["DNS-SRV"]};</Mono> in <Mono>/etc/dhcp/dhcpd.conf</Mono>, then restart the service. Clients pick the new value up at their next renewal; on the laptop, <Mono>ipconfig /renew</Mono> does it now:
        </p>
        <CliPanel run={{ ...allFixed, output: pickLines(allFixed.output, /IPv4|Gateway|DHCP Server|DNS Servers/) }} caption="CLIENT · after the renewal" />
        <CliPanel run={nsFixed} caption="CLIENT · the lookup again" />
        <ChecklistCard
          tone="success"
          title="The proof"
          mark="✓"
          items={[
            `ipconfig /all shows DNS Servers ${DH_ADDR["DNS-SRV"]}`,
            `nslookup ${DNS_NAME} answers ${DH_ADDR.WEB}, from ${DH_ADDR["DNS-SRV"]}`,
            "The website opens by name",
            "Other clients get the right value at their next renewal",
          ]}
        />
      </GuideSection>

      <GuideSection id="dh-other" eyebrow="Troubleshooting" title="Other ways it breaks" tone="warning">
        <p>The wrong option 6 is one way to break the boot-to-name chain. The lab&apos;s tickets add five more, each with its own evidence; the Deep Dive walks through all six with real output from every device.</p>
        <CompareCards
          items={[
            { title: "No relay", tone: "danger", tag: "169.254.x.x", points: ["The laptop self-assigns a 169.254 address", "R1 has no helper address", "The server's log is empty: it never heard a thing"] },
            { title: "Pool exhausted", tone: "warning", tag: "new laptops only", points: ["Old leases keep working", "dhcp-lease-list: 0 addresses free", "The log says no free leases"] },
            { title: "Wrong gateway (option 3)", tone: "danger", tag: "an address, no internet", points: ["The lease names a gateway nobody has", "Nothing outside the subnet works, by name or IP", "The laptop's own address reports the failure"] },
            { title: "DNS service stopped", tone: "violet", tag: "refused at once", points: ["The DNS server answers ping, not DNS", "nslookup: connection refused", "named inactive, nothing on UDP 53"] },
          ]}
        />
        <p className="text-sm text-pv-text-muted">The sixth, a stale cache, is the subtle one: the record changed on the server, but the laptop still holds the old answer until its TTL runs out.</p>
      </GuideSection>

      <GuideSection id="dh-model" eyebrow="Mental model" title="The reception desk and the phone book" tone="cyan">
        <p>
          A newcomer walks into a building with no badge and shouts &quot;Can anyone help me?&quot;. The receptionist on this floor (the relay) phones the HR office upstairs (DHCP) and passes on the shout, saying which floor it came from. HR issues a temporary badge with everything printed on it: a desk number, the way out (gateway), and which phone book to use (DNS). The newcomer trusts that badge completely. Print the wrong phone book on it and they can walk anywhere they know the room number of, yet can&apos;t find anyone by name.
        </p>
      </GuideSection>

      <GuideSection id="dh-glossary" eyebrow="Glossary" title="Terms used in this lesson" tone="violet">
        <Glossary
          items={[
            { term: "DHCP", def: "Dynamic Host Configuration Protocol: leases a host its address and options. UDP 67 (server) and 68 (client)." },
            { term: "Lease", def: "An address and its options, granted for a limited time and renewed at T1." },
            { term: "Scope", def: "A server's pool of addresses for one subnet, with that subnet's options." },
            { term: "Relay agent", def: "A router feature (ip helper-address) that forwards DHCP broadcasts to a server as unicast." },
            { term: "giaddr", def: "The relay's address, written into the request; the server uses it to choose the scope." },
            { term: "Option 3 / Option 6", def: "The default gateway and the DNS server the client should use." },
            { term: "Authoritative server", def: "The DNS server that holds a zone's records and answers for it." },
            { term: "TTL", def: "How long a DNS answer may be cached before it must be asked again." },
          ]}
        />
      </GuideSection>

      <GuideSection id="dh-recap" eyebrow="Recap" title="What you can now explain" tone="success">
        <ChecklistCard
          tone="cyan"
          title="DHCP & DNS in this lesson"
          mark="→"
          items={[
            "The laptop starts with nothing and broadcasts a DHCPDISCOVER",
            "R1's relay forwards it as unicast, with giaddr naming the client subnet",
            "Discover, Offer, Request, Ack: one xid, one lease",
            "The lease sets the address, mask, gateway (option 3) and DNS server (option 6)",
            "A name is resolved by the DNS server in option 6, and cached for its TTL",
            "Names fail but IPs work: check which DNS server the lease named, and fix it at the DHCP server",
          ]}
        />
      </GuideSection>

      <GuideSection id="dh-practice" eyebrow="Practice" title="Practice it" tone="cyan">
        <p>You now know what each device should do between plug-in and the first page, and how to prove it. The DHCP & DNS Lab gives you this network with a Windows client, Linux servers and Cisco or Junos on R1:</p>
        <FlowSteps
          steps={[
            { title: "Learn (7 levels)", body: "See the story, who does what, where to look, read evidence, follow the traffic, troubleshoot, and build it yourself.", tone: "violet" },
            { title: "Build it", body: "Configure the scope on DHCP-SRV, the relay on R1 and the zone on DNS-SRV, then prove a new laptop gets everything.", tone: "warning" },
            { title: "Troubleshoot (6 tickets)", body: "This lesson's incident and the five other faults above, reported as users report them.", tone: "danger" },
          ]}
        />
        <PresentationBridge>Watch the broadcast, the relay, the four DHCP messages and the DNS lookup animated in the DHCP & DNS presentation.</PresentationBridge>
        <LessonLabBridge />
        <p className="text-sm text-pv-text-muted">For the full course (the client state machine, T1 and T2, multiple offers, recursion vs authority, the DNS message, real output for every ticket, a knowledge check), open the Deep Dive tab.</p>
      </GuideSection>
    </div>
  );
}
