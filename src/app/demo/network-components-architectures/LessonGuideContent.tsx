import { Callout, CompareCards, DArrow, DIAGRAM as D, DiagramFrame, DiagramSvg, DLink, DNode, DPill, DRegion, FieldTable, FlowSteps, Glossary, GuideSection, Mono, ProtocolStory, TroubleshootingFlow } from "@/components/lesson/GuideBlocks";
import { KnowledgeCheck } from "@/components/lesson/GuideInteractive";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { ARCH, COMP_IP, COMP_MAC, POE_BUDGET, POE_WATTS, createCompState, poeTable, shortest, switchLinks } from "@/lib/sim-engine/scenarios/ccna/componentsArch";

export const COMP_LESSON_SECTIONS: LessonGuideSectionLink[] = [
  { id: "cal-mission", label: "What this lesson teaches" },
  { id: "cal-network", label: "The network of this lesson" },
  { id: "cal-layers", label: "Read by layer" },
  { id: "cal-inside", label: "A request inside the building" },
  { id: "cal-outside", label: "A request to the cloud" },
  { id: "cal-roles", label: "Every component, one job" },
  { id: "cal-arch", label: "Architectures compared" },
  { id: "cal-spine", label: "Why data centers use spine-leaf" },
  { id: "cal-where", label: "On-premises, cloud and WAN" },
  { id: "cal-incident", label: "The incident" },
  { id: "cal-fix", label: "Repair and prove it" },
  { id: "cal-glossary", label: "Glossary" },
  { id: "cal-recap", label: "Recap" },
];

export function CampusDiagram() {
  return (
    <DiagramSvg h={250} label="The lesson's company: laptop, AP1, ACC-SW1, CORE with SERVER1 and the WLC, then FW1, EDGE-R, the ISP and a cloud application">
      <DRegion x={8} y={14} w={360} h={226} label="campus (on-premises)" color={D.cyan} />
      <DRegion x={380} y={14} w={252} h={226} label="edge → internet → cloud" color={D.warning} />
      <DNode x={40} y={150} label="LAPTOP" sub={COMP_IP.LAPTOP} w={78} />
      <DNode x={120} y={150} label="AP1" sub="802.11 ↔ 802.3" accent={D.violet} w={72} />
      <DNode x={204} y={150} label="ACC-SW1" sub="Layer 2 · PoE" accent={D.eth} w={78} />
      <DNode x={300} y={150} label="CORE" sub="Layer 3 switch" accent={D.ip} w={78} />
      <DNode x={300} y={60} label="SERVER1" sub={COMP_IP.SERVER1} accent={D.success} w={78} />
      <DNode x={204} y={215} label="WLC" sub="manages APs" accent={D.violet} w={72} h={34} />
      <DNode x={418} y={150} label="FW1" sub="policy · state" accent={D.danger} w={64} />
      <DNode x={500} y={150} label="EDGE-R" sub="router · PAT" accent={D.ip} w={70} />
      <DNode x={590} y={150} label="ISP" accent={D.warning} w={56} />
      <DNode x={590} y={60} label="APP" sub={COMP_IP.APP} accent={D.success} w={70} />
      <DLink x1={79} y1={150} x2={84} y2={150} dashed />
      <DLink x1={156} y1={150} x2={165} y2={150} label="PoE" />
      <DLink x1={243} y1={150} x2={261} y2={150} label="trunk" />
      <DLink x1={300} y1={128} x2={300} y2={82} />
      <DLink x1={300} y1={172} x2={240} y2={210} />
      <DLink x1={339} y1={150} x2={386} y2={150} />
      <DLink x1={450} y1={150} x2={465} y2={150} />
      <DLink x1={535} y1={150} x2={562} y2={150} />
      <DLink x1={590} y1={128} x2={590} y2={82} />
    </DiagramSvg>
  );
}

function LayerDiagram() {
  const rows: [string, string, string, string][] = [
    ["Endpoint", "all layers", "originates / answers", D.success],
    ["Access point", "Layer 1–2", "radio ↔ Ethernet", D.violet],
    ["L2 switch", "Layer 2", "destination MAC", D.eth],
    ["L3 switch / router", "Layer 3", "destination IP", D.ip],
    ["Firewall", "Layer 3–7", "policy + session", D.danger],
  ].map((r) => r as [string, string, string, string]);
  return (
    <DiagramSvg h={200} label="Each component and the layer and field it decides on">
      {rows.map(([name, lay, key, c], i) => (
        <g key={name}>
          <DPill x={110} y={24 + i * 36} text={name} color={c} w={170} />
          <text x={250} y={28 + i * 36} fill={D.muted} fontSize={11}>
            {lay}
          </text>
          <text x={360} y={28 + i * 36} fill={D.text} fontSize={11}>
            decides on: {key}
          </text>
        </g>
      ))}
    </DiagramSvg>
  );
}

function RewriteDiagram() {
  return (
    <DiagramSvg h={170} label="Before and after CORE routes the packet: MACs change, TTL drops by one, IP addresses stay">
      <text x={160} y={20} textAnchor="middle" fill={D.muted} fontSize={11} fontWeight={700}>
        into CORE (VLAN 10)
      </text>
      <text x={480} y={20} textAnchor="middle" fill={D.muted} fontSize={11} fontWeight={700}>
        out of CORE (VLAN 20)
      </text>
      {[
        ["dst MAC", COMP_MAC.CORE_V10, COMP_MAC.SERVER1, true],
        ["src MAC", COMP_MAC.LAPTOP, COMP_MAC.CORE_V20, true],
        ["src IP", COMP_IP.LAPTOP, COMP_IP.LAPTOP, false],
        ["dst IP", COMP_IP.SERVER1, COMP_IP.SERVER1, false],
        ["TTL", "64", "63", true],
      ].map(([f, a, b, changed], i) => (
        <g key={String(f)}>
          <text x={30} y={46 + i * 24} fill={D.muted} fontSize={10.5}>
            {f}
          </text>
          <text x={100} y={46 + i * 24} fill={D.text} fontSize={10.5} fontFamily="monospace">
            {a}
          </text>
          <text x={420} y={46 + i * 24} fill={changed ? D.warning : D.text} fontSize={10.5} fontFamily="monospace">
            {b}
          </text>
        </g>
      ))}
      <DArrow x1={300} y1={92} x2={400} y2={92} color={D.ip} label="route" />
    </DiagramSvg>
  );
}

export function ArchCards() {
  const f = (v: keyof typeof ARCH) => ({ ...shortest(ARCH[v]), sl: switchLinks(ARCH[v]) });
  return (
    <FieldTable
      title="Measured on the lesson's drawings (breadth-first search over each design)"
      columns={["Design", "Where", "Shortest path", "Equal paths", "Switch links"]}
      rows={(
        [
          ["SOHO", "home / small office", "soho"],
          ["2-tier collapsed core", "small–medium campus", "two-tier"],
          ["3-tier", "large campus, many buildings", "three-tier"],
          ["Spine-leaf", "data center", "spine-leaf"],
        ] as const
      ).map(([n, w, v]) => {
        const r = f(v);
        return [n, w, <Mono key="l">{r.links} links</Mono>, <Mono key="p">{r.paths}</Mono>, <Mono key="s">{r.sl}</Mono>];
      })}
    />
  );
}

function PoeDiagram() {
  const s = createCompState();
  const before = poeTable(s, "ACC-SW1");
  const ask = POE_WATTS[4];
  const w = 520;
  const scale = w / POE_BUDGET["ACC-SW1"];
  return (
    <DiagramSvg h={150} label={`ACC-SW1 PoE budget: ${before.used} of ${before.budget} watts reserved; AP2 asks ${ask} more`}>
      <rect x={60} y={50} width={w} height={26} rx={6} fill={D.box} stroke={D.line} />
      <rect x={60} y={50} width={before.used * scale} height={26} rx={6} fill={D.success} opacity={0.6} />
      <rect x={60 + before.used * scale} y={50} width={ask * scale} height={26} fill={D.danger} opacity={0.55} />
      <line x1={60 + w} y1={40} x2={60 + w} y2={86} stroke={D.warning} strokeWidth={2} />
      <text x={60 + w} y={34} textAnchor="end" fill={D.warning} fontSize={10.5}>
        budget {before.budget} W
      </text>
      <text x={60} y={104} fill={D.success} fontSize={10.5}>
        AP1 + 4 phones = {before.used} W reserved
      </text>
      <text x={60} y={124} fill={D.danger} fontSize={10.5}>
        + AP2 {ask} W = {Math.round((before.used + ask) * 10) / 10} W — over budget, denied
      </text>
    </DiagramSvg>
  );
}

export function CompLessonGuideContent() {
  return (
    <>
      <GuideSection id="cal-mission" eyebrow="Mission" title="What this lesson teaches">
        <p>
          Before any protocol, you need the cast. This lesson follows two real requests — one to a server in the building, one to a cloud application — through every component of an enterprise network. You will see what each one
          reads, what it changes, and what it leaves alone. Then you will compare the designs that arrange those components, from a home router to a data-center fabric, and fix an outage caused by something as physical as electrical power.
        </p>
        <Callout tone="violet" title="CCNA 1.1 · 1.2">
          Network components (routers, L2 and L3 switches, next-generation firewalls, access points, controllers, endpoints, servers, PoE) and topology architectures (2-tier, 3-tier, spine-leaf, WAN, SOHO, on-premises and cloud).
        </Callout>
      </GuideSection>

      <GuideSection id="cal-network" eyebrow="Topology" title="The network of this lesson">
        <DiagramFrame caption="One company. Users on Wi-Fi, a server in the building, a firewall and router at the edge, an application in the cloud.">
          <CampusDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="cal-layers" eyebrow="Idea" title="Read every component by its layer">
        <p>
          The quickest way to understand a device is to ask which header it reads to make its decision. A switch that reads only the Ethernet header can never send traffic between subnets; a router that reads the IP header must rewrite the
          Ethernet header every time it forwards.
        </p>
        <LayerDiagram />
      </GuideSection>

      <GuideSection id="cal-inside" eyebrow="Walkthrough" title="A request inside the building">
        <ProtocolStory
          problem={<>The laptop ({COMP_IP.LAPTOP}, VLAN 10) opens a file share on SERVER1 ({COMP_IP.SERVER1}, VLAN 20).</>}
          steps={[
            { actor: "LAPTOP", action: "Sees the server is on another subnet, so it addresses the frame to its default gateway's MAC — CORE's VLAN 10 interface.", changes: "Frame on the air to AP1." },
            { actor: "AP1", action: "Receives the 802.11 frame on its radio and bridges it onto Ethernet. It doesn't read or change the IP header.", changes: "Same addresses, Ethernet framing." },
            { actor: "ACC-SW1", action: "Learns the laptop's MAC on Gi1/0/1, finds the gateway MAC on its uplink, forwards the frame unchanged.", changes: "MAC table entry; 802.1Q tag 10 on the trunk." },
            { actor: "CORE", action: "The frame is for CORE itself, so it routes: looks up the destination IP, finds VLAN 20 connected, builds a new frame.", changes: "New source/destination MAC, TTL 64 → 63." },
            { actor: "SERVER1", action: "The destination IP and port are its own; the file service accepts the connection.", changes: "Reply retraces the path." },
          ]}
        />
        <RewriteDiagram />
        <KnowledgeCheck
          label="Check"
          question={{
            id: "cal-k1",
            prompt: "Which device on this path changed the TTL?",
            options: [
              { id: "ap", label: "AP1" },
              { id: "sw", label: "ACC-SW1" },
              { id: "core", label: "CORE" },
            ],
            correctId: "core",
            explanation: "Only a Layer 3 hop decrements TTL. The AP bridges and the access switch forwards on MAC; neither touches the IP header.",
          }}
        />
      </GuideSection>

      <GuideSection id="cal-outside" eyebrow="Walkthrough" title="A request to the cloud">
        <FlowSteps
          steps={[
            { title: "CORE: default route", body: <>No specific route for {COMP_IP.APP}, so the gateway of last resort sends it to FW1.</>, tone: "ip" },
            { title: "FW1: policy, then a session", body: "Rule ALLOW-WEB permits inside → outside TCP 443. FW1 records the connection so the reply is admitted without an inbound rule.", tone: "danger" },
            { title: "EDGE-R: PAT", body: <>The private source {COMP_IP.LAPTOP}:52190 becomes {COMP_IP.PUBLIC}:40001 — the one public address the ISP assigned.</>, tone: "warning" },
            { title: "ISP: transit", body: "Someone else's routers carry it toward the cloud provider.", tone: "cyan" },
            { title: "APP: answers", body: <>To the application, the client is {COMP_IP.PUBLIC}. EDGE-R translates the reply back.</>, tone: "success" },
          ]}
        />
      </GuideSection>

      <GuideSection id="cal-roles" eyebrow="Summary" title="Every component, one job">
        <FieldTable
          title="What each component decides — and what it changes"
          columns={["Component", "Decides on", "Changes", "In this lesson"]}
          rows={[
            ["Endpoint", "its own IP, mask, gateway", "creates the packet", "LAPTOP, SERVER1, APP"],
            ["Access point", "802.11 association", "radio framing ↔ Ethernet", "AP1, AP2"],
            ["WLC (controller)", "AP join, WLAN settings", "configures APs, not packets", "WLC"],
            ["Layer 2 switch", "destination MAC", "nothing (adds/removes 802.1Q on trunks)", "ACC-SW1, ACC-SW2"],
            ["Layer 3 switch", "destination IP (between VLANs)", "MACs, TTL", "CORE"],
            ["Router", "destination IP (between networks, WAN)", "MACs, TTL; often NAT", "EDGE-R"],
            ["Next-generation firewall", "policy: zones, addresses, apps, users", "session table; may NAT", "FW1"],
            ["PoE (PSE)", "power class requested", "supplies DC power on the data cable", "ACC-SW1, ACC-SW2"],
          ]}
        />
        <Callout tone="cyan" title="L3 switch or router?">
          Both route. A Layer 3 switch routes between VLANs inside the campus at line rate with many Ethernet ports; a router connects to WANs and providers and usually adds services such as NAT, VPN and rich routing policy.
        </Callout>
      </GuideSection>

      <GuideSection id="cal-arch" eyebrow="Design" title="Architectures compared">
        <CompareCards
          items={[
            { title: "SOHO", tone: "cyan", tag: "one box", points: ["Router, switch, AP, firewall, DHCP in one device", "Cheap and simple", "Single point of failure"] },
            { title: "2-tier (collapsed core)", tone: "ip", tag: "access + core", points: ["Access switches dual-homed to two core switches", "Core also does the distribution job", "Fits one building or a small campus"] },
            { title: "3-tier", tone: "violet", tag: "access + distribution + core", points: ["Distribution aggregates each building and applies policy", "Core only moves traffic between buildings", "Scales to large campuses"] },
            { title: "Spine-leaf", tone: "success", tag: "data center", points: ["Every leaf connects to every spine", "Any server ↔ any server: leaf, spine, leaf", "Scale out by adding spines or leaves"] },
          ]}
        />
        <ArchCards />
      </GuideSection>

      <GuideSection id="cal-spine" eyebrow="Design" title="Why data centers use spine-leaf">
        <p>
          Campus traffic mostly flows north-south: users to servers and the internet. Data-center traffic is mostly east-west: server to server — a web tier calling an application tier calling a database. Spine-leaf gives every server
          the same distance to every other server ({shortest(ARCH["spine-leaf"]).links} links) and as many equal-cost paths as there are spines ({shortest(ARCH["spine-leaf"]).paths} here). Routing protocols spread flows across all of them (ECMP).
        </p>
      </GuideSection>

      <GuideSection id="cal-where" eyebrow="Design" title="On-premises, cloud and WAN">
        <CompareCards
          items={[
            { title: "On-premises", tone: "cyan", tag: "your racks", points: ["SERVER1: you buy, power, cool and patch it", "Full control, capital cost", "Reached across your LAN"] },
            { title: "Cloud", tone: "violet", tag: "their racks", points: ["APP: a provider runs the data center (spine-leaf inside)", "Pay for use, scale on demand", "Reached across the internet or a private WAN link"] },
            { title: "WAN", tone: "warning", tag: "between sites", points: ["Connects branches, HQ and data centers", "Provider circuits, internet VPNs or SD-WAN", "You control the edge, not the middle"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="cal-incident" eyebrow="Incident" title="The incident" tone="danger">
        <p>
          Facilities installs AP2 in the meeting room and patches it into ACC-SW1. The meeting room still has no Wi-Fi. The cable tests fine, AP2 is configured on the controller, and everyone else is fine. AP2 sends no beacons at all.
        </p>
        <TroubleshootingFlow
          steps={[
            { question: "Is the AP powered?", look: <>The switch&apos;s PoE table — <Mono>show power inline</Mono> on Cisco, <Mono>show poe interface</Mono> on Junos.</> },
            { question: "Is the link up?", look: "Interface status on the switch port." },
            { question: "Has the AP joined the controller?", look: "The WLC's AP list." },
            { question: "Is the radio beaconing the SSID?", look: "A Wi-Fi scan from a client in the room." },
          ]}
        />
        <PoeDiagram />
      </GuideSection>

      <GuideSection id="cal-fix" eyebrow="Repair" title="Repair and prove it" tone="success">
        <p>
          ACC-SW1 reserves power in port order. AP1 (class 4, {POE_WATTS[4]} W) and four phones (class 3, {POE_WATTS[3]} W each) already hold {poeTable(createCompState(), "ACC-SW1").used} W of {POE_BUDGET["ACC-SW1"]} W, so AP2&apos;s request is denied.
          Re-patching AP2 into ACC-SW2 ({POE_BUDGET["ACC-SW2"]} W budget) fixes the cause: AP2 powers on, joins the WLC, receives its SSID and starts beaconing. Changing channels, addresses or rebooting the controller can&apos;t help an AP that has no power.
        </p>
        <Callout tone="warning" title="In real networks">
          The other fixes are a switch with a bigger power supply, a second power supply, or a PoE injector. Budgets are planned per switch: add up every PoE device&apos;s class before you buy.
        </Callout>
      </GuideSection>

      <GuideSection id="cal-glossary" eyebrow="Words" title="Glossary">
        <Glossary
          items={[
            { term: "Endpoint", def: "A device where traffic begins or ends: laptop, phone, printer, server." },
            { term: "Access point (AP)", def: "Bridges wireless clients onto the wired LAN." },
            { term: "WLC", def: "Wireless LAN controller: configures and monitors lightweight APs from one place." },
            { term: "Layer 3 switch", def: "A switch that also routes between VLANs in hardware." },
            { term: "NGFW", def: "Next-generation firewall: stateful policy plus application, user and threat awareness." },
            { term: "PoE", def: "Power over Ethernet: the switch (PSE) supplies DC power to a device (PD) over the data cable." },
            { term: "Collapsed core", def: "A 2-tier design where the core switches also perform the distribution role." },
            { term: "Spine-leaf", def: "A data-center fabric: every leaf connects to every spine, servers attach to leaves." },
            { term: "East-west / north-south", def: "Server-to-server traffic / traffic in and out of the data center or campus." },
          ]}
        />
      </GuideSection>

      <GuideSection id="cal-recap" eyebrow="Recap" title="Recap" tone="success">
        <ul className="list-disc space-y-1 pl-5">
          <li>Endpoints originate; APs bridge radio to cable; L2 switches forward on MAC; L3 switches and routers forward on IP and rewrite the frame.</li>
          <li>Firewalls decide by policy and remember sessions; edge routers connect to providers and often translate addresses.</li>
          <li>SOHO: one box. 2-tier: access + collapsed core. 3-tier: access, distribution, core. Spine-leaf: equal paths for east-west traffic.</li>
          <li>PoE is a budget: when it runs out, the device simply stays dark.</li>
        </ul>
      </GuideSection>
    </>
  );
}
