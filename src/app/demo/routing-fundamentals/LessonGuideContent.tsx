import { Callout, ChecklistCard, CompareCards, DArrow, DIAGRAM as D, DiagramFrame, DiagramSvg, DNode, FlowSteps, Glossary, GuideSection, Mono, PathDivider, ProtocolStory, TroubleshootingFlow } from "@/components/lesson/GuideBlocks";
import { PresentationBridge } from "@/components/presentation/LessonPresentation";
import { PracticeBridge } from "@/components/lesson/GuideInteractive";
import { usePracticeLabOpener } from "@/components/lesson/FundamentalsLessonShell";
import { DFieldRow, DTable } from "@/components/lesson/FundamentalsGuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { OUTSIDE_DST, R1_HEALTHY, R2_TABLE, RT_ADDR, RT_MAC, ipBits, routeKey, type Route } from "@/lib/sim-engine/scenarios/routingFundamentals";

export const RT_LESSON_SECTIONS: LessonGuideSectionLink[] = [
  { id: "rtl-mission", label: "The mission" },
  { id: "rtl-story", label: "The whole story" },
  { id: "rtl-breaks", label: "When it breaks" },
  { id: "rtl-topology", label: "Topology" },
  { id: "rtl-tables", label: "The two tables" },
  { id: "rtl-nexthop", label: "Next hop" },
  { id: "rtl-lpm", label: "Longest prefix match" },
  { id: "rtl-hops", label: "Hop by hop" },
  { id: "rtl-usable", label: "Configured vs usable" },
  { id: "rtl-return", label: "The return path" },
  { id: "rtl-default", label: "Default route" },
  { id: "rtl-incident", label: "The /25 incident" },
  { id: "rtl-repair", label: "Repair & verify" },
  { id: "rtl-drops", label: "Four ways to drop" },
  { id: "rtl-l2l3", label: "Routing vs switching" },
  { id: "rtl-model", label: "Mental model" },
  { id: "rtl-glossary", label: "Glossary" },
  { id: "rtl-recap", label: "Recap" },
];

const SA = RT_ADDR["SERVER-A"];
const SB = RT_ADDR["SERVER-B"];
const HA = RT_ADDR["HOST-A"];
const NH = RT_ADDR["R2:TRANSIT"];
const ribRows = (rib: Route[]) => rib.map((r) => [routeKey(r), r.source, r.source === "connected" ? r.iface! : r.discard ? "discard" : `via ${r.nextHop}`]);
const RIB_COLS = [
  { label: "PREFIX", w: 124 },
  { label: "SOURCE", w: 76 },
  { label: "NEXT HOP / EXIT", w: 104 },
];

function TopologyDiagram() {
  return (
    <DiagramSvg h={210} label={`HOST-A ${HA} on 10.10.10.0/24 to R1; R1 and R2 on transit 10.0.12.0/30; R2 on server LAN 172.16.50.0/24 with SERVER-A ${SA} and SERVER-B ${SB}`}>
      <DArrow x1={112} y1={100} x2={196} y2={100} color={D.line} both width={1.6} />
      <DArrow x1={296} y1={100} x2={380} y2={100} color={D.line} both width={1.6} />
      <DArrow x1={478} y1={88} x2={524} y2={52} color={D.line} width={1.6} />
      <DArrow x1={478} y1={112} x2={524} y2={148} color={D.line} width={1.6} />
      <DNode x={60} y={100} label="HOST-A" sub={HA} accent={D.cyan} w={104} />
      <DNode x={246} y={100} label="R1" sub="ge-0/0/0 · ge-0/0/1" accent={D.ip} w={100} />
      <DNode x={430} y={100} label="R2" sub="ge-0/0/1 · ge-0/0/0" accent={D.ip} w={100} />
      <DNode x={580} y={40} label="SERVER-A" sub={SA} accent={D.success} w={108} />
      <DNode x={580} y={160} label="SERVER-B" sub={SB} accent={D.success} w={108} />
      <text x={154} y={84} textAnchor="middle" fill={D.muted} fontSize={9} fontFamily="monospace">
        10.10.10.0/24
      </text>
      <text x={338} y={84} textAnchor="middle" fill={D.muted} fontSize={9} fontFamily="monospace">
        10.0.12.0/30
      </text>
      <text x={500} y={104} fill={D.muted} fontSize={9} fontFamily="monospace">
        172.16.50.0/24
      </text>
      <text x={320} y={200} textAnchor="middle" fill={D.muted} fontSize={10}>
        {`.1 / .1 / .2 / .1 are the router interfaces · no routing protocol anywhere`}
      </text>
    </DiagramSvg>
  );
}

function TablesDiagram() {
  return (
    <DiagramSvg h={210} label="R1 routing table: 0.0.0.0/0 static via 10.0.12.2, 10.0.12.0/30 connected, 10.10.10.0/24 connected, 172.16.0.0/16 static, 172.16.50.0/24 static; R2 routing table: 10.0.12.0/30 connected, 10.10.10.0/24 static via 10.0.12.1, 172.16.50.0/24 connected">
      <DTable x={6} y={8} title="R1 routing table" cols={RIB_COLS} rows={ribRows(R1_HEALTHY)} color={D.ip} rowH={20} />
      <DTable x={326} y={8} title="R2 routing table" cols={RIB_COLS} rows={ribRows(R2_TABLE)} color={D.violet} rowH={20} />
      <text x={326} y={148} fill={D.text} fontSize={10} fontWeight={700}>
        connected = a configured, up interface
      </text>
      <text x={326} y={166} fill={D.text} fontSize={10} fontWeight={700}>
        static = typed in by an operator
      </text>
      <text x={326} y={184} fill={D.muted} fontSize={10}>
        0.0.0.0/0 = the static default route
      </text>
    </DiagramSvg>
  );
}

function NextHopDiagram() {
  const box = [
    { x: 96, w: 180, t: "static route", s: `172.16.50.0/24 via ${NH}`, c: D.ip },
    { x: 290, w: 164, t: "next hop in?", s: "connected 10.0.12.0/30", c: D.cyan },
    { x: 440, w: 96, t: "egress", s: "ge-0/0/1", c: D.violet },
    { x: 568, w: 132, t: "ARP", s: `${NH} → …:53:21`, c: D.arp },
  ];
  return (
    <DiagramSvg h={150} label={`Recursive next-hop resolution: static route 172.16.50.0/24 via ${NH}; ${NH} lies inside connected 10.0.12.0/30 which gives egress ge-0/0/1; ARP gives the neighbor MAC ${RT_MAC["R2:TRANSIT"]}`}>
      {box.map((b, i) => (
        <g key={b.t}>
          <DNode x={b.x} y={56} label={b.t} sub={b.s} accent={b.c} w={b.w} h={48} />
          {i < box.length - 1 && <DArrow x1={b.x + b.w / 2 + 2} y1={56} x2={box[i + 1].x - box[i + 1].w / 2 - 2} y2={56} color={D.muted} width={1.6} />}
        </g>
      ))}
      <text x={320} y={118} textAnchor="middle" fill={D.text} fontSize={10.5} fontWeight={700}>
        {`The next hop picks the exit and the neighbor's MAC — the IPv4 destination stays ${SA}.`}
      </text>
      <text x={320} y={138} textAnchor="middle" fill={D.muted} fontSize={10}>
        If 10.0.12.0/30 went down, the static route would become unusable.
      </text>
    </DiagramSvg>
  );
}

/** Bit rows: destination vs prefixes; fixed bits colored by match, host bits faint. */
function BitRows({ dst, rows, y0 = 30 }: { dst: string; rows: { label: string; prefix: string; len: number; color?: string }[]; y0?: number }) {
  const d = ipBits(dst);
  const cx = (i: number) => 196 + i * 12 + Math.floor(i / 8) * 6;
  const row = (bits: string, len: number, y: number, isDst: boolean) =>
    bits.split("").map((b, i) => {
      const fixed = isDst || i < len;
      const ok = isDst || b === d[i];
      const color = isDst ? D.cyan : !fixed ? D.faint : ok ? D.success : D.danger;
      return (
        <g key={i}>
          <rect x={cx(i)} y={y - 11} width={11} height={15} rx={2} fill={color} fillOpacity={fixed ? 0.16 : 0.04} stroke={color} strokeOpacity={fixed ? 0.7 : 0.25} />
          <text x={cx(i) + 5.5} y={y} textAnchor="middle" fill={fixed ? D.text : D.faint} fontSize={8.5} fontFamily="monospace">
            {fixed ? b : "·"}
          </text>
        </g>
      );
    });
  return (
    <g>
      <text x={8} y={y0} fill={D.cyan} fontSize={10} fontWeight={700} fontFamily="monospace">
        {dst}
      </text>
      {row(d, 32, y0, true)}
      {rows.map((r, k) => {
        const y = y0 + 26 + k * 24;
        const p = ipBits(r.prefix);
        const firstBad = [...Array(r.len).keys()].find((i) => p[i] !== d[i]);
        return (
          <g key={r.label}>
            <text x={8} y={y} fill={r.color ?? (firstBad === undefined ? D.success : D.muted)} fontSize={10} fontWeight={700} fontFamily="monospace">
              {r.label}
            </text>
            {row(p, r.len, y, false)}
          </g>
        );
      })}
    </g>
  );
}

function LpmDiagram() {
  return (
    <DiagramSvg h={170} label={`Longest prefix match for ${SA}: 172.16.50.0/24 matches 24 leading bits, 172.16.0.0/16 matches 16, 0.0.0.0/0 matches with zero fixed bits; the /24 is the longest match and wins`}>
      <BitRows
        dst={SA}
        rows={[
          { label: "172.16.50.0/24 ✓", prefix: "172.16.50.0", len: 24, color: D.success },
          { label: "172.16.0.0/16 ✓", prefix: "172.16.0.0", len: 16 },
          { label: "0.0.0.0/0 ✓", prefix: "0.0.0.0", len: 0 },
        ]}
      />
      <text x={8} y={138} fill={D.text} fontSize={10.5} fontWeight={700}>
        All three match. The /24 fixes the most bits, so it is the most specific and it wins.
      </text>
      <text x={8} y={158} fill={D.muted} fontSize={10}>
        Not configuration order, not a metric: only the length of the matching prefix decides.
      </text>
    </DiagramSvg>
  );
}

function HopsDiagram() {
  const links = [
    { y: 30, t: "HOST-A → R1", eth: `${RT_MAC["HOST-A"].slice(-5)} → ${RT_MAC["R1:LAN"].slice(-5)}`, ttl: "64" },
    { y: 90, t: "R1 → R2", eth: `${RT_MAC["R1:TRANSIT"].slice(-5)} → ${RT_MAC["R2:TRANSIT"].slice(-5)}`, ttl: "63" },
    { y: 150, t: "R2 → SERVER-A", eth: `${RT_MAC["R2:SRV"].slice(-5)} → ${RT_MAC["SERVER-A"].slice(-5)}`, ttl: "62" },
  ];
  return (
    <DiagramSvg h={215} label={`The same IPv4 packet ${HA} to ${SA} on three links: a new Ethernet frame on each link, TTL 64 then 63 then 62, IPv4 source and destination unchanged`}>
      {links.map((l) => (
        <g key={l.t}>
          <text x={8} y={l.y + 25} fill={D.text} fontSize={10} fontWeight={700}>
            {l.t}
          </text>
          <DFieldRow
            x={120}
            y={l.y}
            h={40}
            fields={[
              { label: "Ethernet", sub: l.eth, w: 150, color: D.eth, strong: true },
              { label: "IPv4", sub: `${HA} → ${SA}`, w: 200, color: D.ip },
              { label: "TTL", sub: l.ttl, w: 60, color: D.warning, strong: true },
              { label: "ICMP", sub: "Echo", w: 80, color: D.mpls },
            ]}
          />
        </g>
      ))}
      <text x={8} y={208} fill={D.muted} fontSize={10}>
        Each router builds a NEW frame (bold) and decrements TTL; the IPv4 addresses never change (no NAT).
      </text>
    </DiagramSvg>
  );
}

function ReturnDiagram() {
  return (
    <DiagramSvg h={150} label={`Reply path: SERVER-A sends to its gateway R2; R2 matches its static return route 10.10.10.0/24 via 10.0.12.1; R1 matches connected 10.10.10.0/24 and delivers to HOST-A`}>
      <DArrow x1={528} y1={60} x2={482} y2={60} color={D.success} />
      <DArrow x1={378} y1={60} x2={298} y2={60} color={D.success} />
      <DArrow x1={194} y1={60} x2={114} y2={60} color={D.success} />
      <DNode x={580} y={60} label="SERVER-A" sub="gw .1" accent={D.success} w={100} />
      <DNode x={430} y={60} label="R2" sub="static return" accent={D.ip} w={100} />
      <DNode x={246} y={60} label="R1" sub="connected" accent={D.ip} w={100} />
      <DNode x={62} y={60} label="HOST-A" accent={D.cyan} w={100} />
      <text x={430} y={110} textAnchor="middle" fill={D.text} fontSize={10}>
        10.10.10.0/24 via 10.0.12.1
      </text>
      <text x={246} y={110} textAnchor="middle" fill={D.text} fontSize={10}>
        10.10.10.0/24 connected
      </text>
      <text x={320} y={140} textAnchor="middle" fill={D.muted} fontSize={10}>
        Without R2&apos;s return route the request would arrive but the reply could never leave.
      </text>
    </DiagramSvg>
  );
}

function DefaultDiagram() {
  return (
    <DiagramSvg h={190} label={`Destination ${OUTSIDE_DST}: at R1 the /24 and /16 do not match and the default 0.0.0.0/0 does, so R1 forwards to R2; R2 has no matching route and no default, so the packet is dropped`}>
      <BitRows
        dst={OUTSIDE_DST}
        rows={[
          { label: "172.16.50.0/24 ✕", prefix: "172.16.50.0", len: 24, color: D.danger },
          { label: "172.16.0.0/16 ✕", prefix: "172.16.0.0", len: 16, color: D.danger },
          { label: "0.0.0.0/0 ✓", prefix: "0.0.0.0", len: 0, color: D.success },
        ]}
      />
      <text x={8} y={140} fill={D.text} fontSize={10.5} fontWeight={700}>
        R1: only the default matches → forward to 10.0.12.2.
      </text>
      <text x={8} y={160} fill={D.danger} fontSize={10.5} fontWeight={700}>
        R2: no route and no default → dropped.
      </text>
      <text x={8} y={180} fill={D.muted} fontSize={10}>
        A default route moves a packet one hop. Every router on the way still needs its own route.
      </text>
    </DiagramSvg>
  );
}

function IncidentDiagram() {
  const x0 = 40;
  const w = 560;
  const at = (n: number) => x0 + (n / 256) * w;
  return (
    <DiagramSvg h={200} label={`172.16.50.0/24 split at .128: the /25 discard route covers .0 to .127, where SERVER-A ${SA} sits, so SERVER-A matches the /25 and is dropped; SERVER-B ${SB} is in .128 to .255, matches only the /24 and is forwarded`}>
      <rect x={x0} y={70} width={w / 2} height={34} rx={6} fill={D.danger} fillOpacity={0.16} stroke={D.danger} strokeOpacity={0.7} />
      <rect x={x0 + w / 2} y={70} width={w / 2} height={34} rx={6} fill={D.success} fillOpacity={0.08} stroke={D.success} strokeOpacity={0.5} />
      <text x={x0 + w / 4} y={92} textAnchor="middle" fill={D.danger} fontSize={10.5} fontWeight={700}>
        172.16.50.0/25 discard · .0 – .127
      </text>
      <text x={x0 + (3 * w) / 4} y={92} textAnchor="middle" fill={D.success} fontSize={10.5} fontWeight={700}>
        only the /24 matches · .128 – .255
      </text>
      <rect x={x0} y={40} width={w} height={20} rx={6} fill={D.ip} fillOpacity={0.1} stroke={D.ip} strokeOpacity={0.6} />
      <text x={x0 + w / 2} y={54} textAnchor="middle" fill={D.ip} fontSize={10} fontWeight={700}>
        172.16.50.0/24 via 10.0.12.2 — still installed, covers all 256
      </text>
      <line x1={at(50)} y1={104} x2={at(50)} y2={128} stroke={D.danger} strokeWidth={2} />
      <line x1={at(200)} y1={104} x2={at(200)} y2={128} stroke={D.success} strokeWidth={2} />
      <text x={at(50)} y={142} textAnchor="middle" fill={D.danger} fontSize={10} fontWeight={700}>
        SERVER-A .50 → /25 wins → dropped
      </text>
      <text x={at(200)} y={142} textAnchor="middle" fill={D.success} fontSize={10} fontWeight={700}>
        SERVER-B .200 → /24 wins
      </text>
      <text x={x0} y={172} fill={D.muted} fontSize={10}>
        .50 = 00110010 (top bit 0, inside the /25) · .200 = 11001000 (top bit 1, outside)
      </text>
      <text x={x0} y={190} fill={D.muted} fontSize={10}>
        Same /24, one half dead: the signature of a more-specific route.
      </text>
    </DiagramSvg>
  );
}


function StoryLabBridge() {
  const open = usePracticeLabOpener();
  return (
    <PracticeBridge label="Open the Routing Lab" onPractice={open}>
      Edit R1 and R2&apos;s routing tables, send traffic both ways and inspect every longest-prefix decision, bit by bit.
    </PracticeBridge>
  );
}

export function RoutingLessonGuideContent() {
  return (
    <div className="space-y-12">
      <GuideSection id="rtl-mission" eyebrow="This lesson" title="How a router chooses" tone="ip">
        <p>
          IPv4 Basics showed that a router forwards between networks and decrements TTL. This lesson opens the routing table: where its entries come from, how the router picks <strong>one</strong> of several entries that all describe the same destination, and how a single extra route can quietly drop traffic.
        </p>
        <Callout tone="ip" title="The one rule to remember">
          Find every installed route that contains the destination. The one with the <strong>longest prefix</strong> wins.
        </Callout>
      </GuideSection>
      <GuideSection id="rtl-story" eyebrow="How it works" title="One packet, two routing decisions, and the way back" tone="cyan">
        <ProtocolStory
          problem={<>HOST-A ({RT_ADDR["HOST-A"]}) wants SERVER-A ({RT_ADDR["SERVER-A"]}), on another network two routers away. No router sees the whole path: each one only decides which neighbor gets the packet next — from its own routing table.</>}
          steps={[
            { actor: "Why routes", action: <>HOST-A sees {SA} is not on its own network and hands the packet to its gateway, R1. From here on, <strong>routers</strong> decide — and a router can only send a packet somewhere its table describes.</>, verify: `A capture on HOST-A's LAN: the frame goes to R1's MAC, IP destination ${SA}.`, fails: { symptom: `HOST-A never sends anything to R1.`, evidence: `Wrong gateway or mask on HOST-A — a host problem; routing hasn't started.` }, tone: "ip" },
            { actor: "Connected routes", action: <>R1&apos;s interfaces are configured and up, so it knows their networks by itself: 10.10.10.0/24 and 10.0.12.0/30. Nothing else.</>, verify: `show ip route connected (Cisco) / show route protocol direct (Junos): one C entry per interface that is up.`, fails: { symptom: `A network you expect as connected is missing.`, evidence: `Its interface is down (show ip interface brief) — the connected route disappears with it.` }, tone: "cyan" },
            { actor: "Static route", action: <>An operator adds <Mono>172.16.50.0/24 via {NH}</Mono> on R1 (plus a /16 and a default). A static route is a prefix and a neighbor to hand matching packets to.</>, verify: `The route shows as S in R1's table — installed, not just configured.`, fails: { symptom: `It's in the configuration but not in the table.`, evidence: `Its next hop isn't inside any up, connected network: configured, not installed (Junos: show route hidden).` }, tone: "violet" },
            { actor: "Destination lookup", action: <>A packet for {SA} arrives. R1 looks at the <strong>destination</strong> address — only — and checks it against every installed route.</>, verify: `show ip route ${SA} / show route ${SA}: the router's real answer for that address.`, fails: { symptom: `You read the table top to bottom and expect the first entry.`, evidence: `Order on screen is sorting, not the rule.` }, tone: "ip" },
            { actor: "Matching prefixes", action: <>172.16.50.0/24, 172.16.0.0/16 and 0.0.0.0/0 all contain {SA}; 10.10.10.0/24 and 10.0.12.0/30 don&apos;t. A route matches when the destination&apos;s first /len bits equal the route&apos;s.</>, verify: `Write both addresses in binary for /len bits — they agree.`, fails: { symptom: `A route you expected to match doesn't.`, evidence: `A bit inside its prefix length differs — the destination isn't in that network.` }, tone: "warning" },
            { actor: "Longest prefix match", action: <>Of the three matches, the <strong>/24</strong> is the most specific — it wins. The /16 and the /0 stay installed; they lose this lookup and win others.</>, why: "the most specific route describes the destination best", verify: `The /24 is the route shown for ${SA}; SERVER-C-style addresses outside it pick the /16.`, fails: { symptom: `Traffic for part of a network goes somewhere else.`, evidence: `A more specific route (a /25, a host /32) is winning for those addresses.` }, tone: "success" },
            { actor: "Next hop", action: <>The winner says “via {NH}”. R1 must reach that neighbor: {NH} is inside its connected 10.0.12.0/30 → out ge-0/0/1 → ARP for {NH} → R2&apos;s MAC (<Mono>{RT_MAC["R2:TRANSIT"]}</Mono>).</>, changes: "the next-hop address is never written into the packet", verify: `R1's ARP cache has ${NH} with a MAC; the frame on the R1–R2 link goes to that MAC.`, fails: { symptom: `The route wins, and packets still die at R1 (Host Unreachable).`, evidence: `Nobody owns the next hop (a typo): show ip arp shows it Incomplete.` }, tone: "arp" },
            { actor: "Forwarding", action: "R1 builds a new frame to R2, decrements TTL, recomputes the checksum. The IP source and destination are unchanged.", verify: `A capture on R1's ge-0/0/1: same IPs, TTL one lower, R2's MAC.`, fails: { symptom: `Nothing leaves R1 on the link you expected.`, evidence: `A different route won, or the interface is down.` }, tone: "ip" },
            { actor: "Next router's lookup", action: "R2 does its own lookup for the same destination: 172.16.50.0/24 is connected → it delivers to SERVER-A in a new frame. R1 chose nothing beyond R2.", verify: `R2's table: 172.16.50.0/24 connected, interface up.`, fails: { symptom: `R1 forwards correctly and R2 drops it.`, evidence: `R2 has no usable route (or its interface is down) — each router decides alone.` }, tone: "success" },
            { actor: "Return path", action: <>SERVER-A&apos;s reply is a <strong>new packet</strong> to {HA}. R2 must have its <strong>own</strong> route to 10.10.10.0/24 (via {RT_ADDR["R1:TRANSIT"]}), then R1 delivers on its connected LAN.</>, why: "routing is decided per packet, per router, per direction", verify: `show ip route ${HA} on R2; the reply visible on the R1–R2 link.`, fails: { symptom: `The server sees requests and answers; HOST-A never gets replies.`, evidence: `A missing or unusable return route on a router on the way back — the server gets Net Unreachable from it.` }, tone: "violet" },
            { actor: "Default route", action: <>For {OUTSIDE_DST}, only 0.0.0.0/0 matches on R1, so it goes to the default&apos;s next hop. The next router must know more — or it drops it.</>, why: "a default route means “if nothing better matches” — it moves a packet one router further", verify: `R1 uses 0.0.0.0/0 only for destinations nothing longer contains.`, fails: { symptom: `A default exists and packets still die.`, evidence: `The next router has no route: follow the lookup to the router that returns Net Unreachable.` }, tone: "warning" },
            { actor: "More-specific failure", action: <>A stray <Mono>172.16.50.0/25 discard</Mono> appears on R1. For {SA} (inside .0–.127) the /25 is longer than the /24 — it wins, and the packet is dropped silently. {SB} is outside the /25 and still works.</>, verify: `R1's answer for ${SA} is the /25 discard; for ${SB} it is the /24.`, fails: { symptom: `Half a subnet is unreachable; the other half works.`, evidence: `Same LAN, different winners: a more specific route covers the failing half.` }, tone: "danger" },
            { actor: "Verify", action: "Prove with traffic, in both directions, and check a neighboring destination too.", verify: `Ping succeeds (requests AND replies), the lookup on each router shows the expected winner, and ${SB} still works.`, fails: { symptom: `“The route is configured” — but the ping still fails.`, evidence: `Configured isn't installed, installed isn't winning, winning isn't resolvable. Test, don't assume.` }, tone: "success" },
            { actor: "Troubleshoot", action: "Do what the packet does: on each router, which installed routes contain the destination, which wins, is it usable, does the next hop answer ARP — then the same for the reply.", verify: `The first router whose answer is wrong (no route, a discard, a dead next hop, or pointing backwards) is the cause.`, fails: { symptom: `Time Exceeded, or traceroute alternating between two routers.`, evidence: `Two routers point at each other: a loop, until the TTL runs out.` }, tone: "cyan" },
          ]}
          outcome={<>Forwarding is the same small algorithm on every router: find every matching route, keep the longest, resolve the next hop, rebuild the frame. A more specific route always beats a broader one, which is exactly how the incident&apos;s 172.16.50.0/25 <strong>discard</strong> route silently steals SERVER-A&apos;s traffic while SERVER-B (outside the /25) keeps working. Check the lookup for each destination, remove the bad route, and verify both directions.</>}
        />
        <PresentationBridge>Try longest-prefix match yourself and watch the discard route steal SERVER-A&apos;s traffic in the Routing presentation.</PresentationBridge>
        <StoryLabBridge />
      </GuideSection>

      <GuideSection id="rtl-breaks" eyebrow="When it breaks" title={`When a packet does not arrive: follow the lookups`} tone="danger">
        <p className="text-sm text-pv-text-muted">{`No router sees the whole path. To troubleshoot, do what the packet does: the same lookup on each router, in each direction, until one of them goes wrong.`}</p>
        <TroubleshootingFlow
          steps={[
            { question: `Which route wins on the first router?`, look: `List every route that contains the destination. The longest prefix wins, whatever it does, a discard included.` },
            { question: `Is that route's next hop real and reachable?`, look: `The route is active, the next hop has an ARP entry, and the interface is up.` },
            { question: `Repeat on every router up to the destination`, look: `Each router decides alone. The first one with no route, a wrong winner or a dead next hop is the cause.` },
            { question: `Then do the same for the reply`, look: `From the destination back to the source, on each router. Return routes are separate configuration.` },
            { question: `Is the packet looping?`, look: `TTL expiring, or traceroute alternating between two routers, means two routers point at each other.` },
            { question: `How do you prove the fix?`, look: `Ping in both directions, check the lookup for the destination on every router, and check a neighboring destination (SERVER-B) still works.` },
          ]}
        />
        <Callout tone="cyan" title="The habit to build" icon="✓">
          Walk the story in order and confirm each step with real evidence (a table, a capture, a command). The first step you cannot confirm is where the problem is. The boxes under each story step above say what to look at.
        </Callout>
      </GuideSection>

      <PathDivider title="Reference">Every part of the story in detail. Read the parts you need.</PathDivider>


      <GuideSection id="rtl-topology" eyebrow="Topology" title="Three networks, two routers" tone="cyan">
        <DiagramFrame caption="Both servers share one /24 behind R2 (their access switch isn't drawn).">
          <TopologyDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="rtl-tables" eyebrow="Route sources" title="Connected, static and default" tone="violet">
        <DiagramFrame caption="R1 holds a /24, a /16 and a /0 that all cover the server LAN — on purpose.">
          <TablesDiagram />
        </DiagramFrame>
        <p>
          A <strong>connected</strong> route appears because an interface is configured and up. It is not something an operator types. A <strong>static</strong> route is typed in: a prefix and a next hop. The <strong>default</strong> route <Mono>0.0.0.0/0</Mono> is a static route with zero fixed bits, so it matches every address.
        </p>
      </GuideSection>

      <GuideSection id="rtl-nexthop" eyebrow="Next hop" title="A static route points at a neighbor" tone="arp">
        <DiagramFrame caption="Recursive resolution: route → connected network → interface → neighbor MAC.">
          <NextHopDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="rtl-lpm" eyebrow="Longest prefix match" title="/24 beats /16 beats /0" tone="success">
        <DiagramFrame caption="Green bits are fixed by the route and match the destination; · marks bits the route doesn't care about.">
          <LpmDiagram />
        </DiagramFrame>
        <p>The router doesn&apos;t delete the /16 or the /0 because a /24 exists. All three stay installed. The table answers &quot;which routes exist?&quot;, and each lookup answers &quot;which route wins for <em>this</em> destination?&quot;.</p>
      </GuideSection>

      <GuideSection id="rtl-hops" eyebrow="Per hop" title="New frame, same packet" tone="ip">
        <DiagramFrame caption="The Layer-2 next hop changes every link. The IPv4 destination never does.">
          <HopsDiagram />
        </DiagramFrame>
        <FlowSteps
          steps={[
            { title: "HOST-A", body: <>{SA} is off-link, so the frame goes to R1&apos;s MAC with IPv4 destination {SA}.</>, tone: "cyan" },
            { title: "R1", body: "Removes the frame, longest-prefix match on the IPv4 destination, resolves the next hop, TTL − 1, recomputes the checksum, builds a new frame to R2.", tone: "ip" },
            { title: "R2", body: "Connected /24: the destination itself is the next hop, so the new frame goes straight to SERVER-A's MAC.", tone: "success" },
          ]}
        />
      </GuideSection>

      <GuideSection id="rtl-usable" eyebrow="Route activity" title="Configured is not installed; installed is not delivered" tone="warning">
        <FlowSteps
          steps={[
            { title: "Configured", body: "The operator typed it: it is in the running configuration.", tone: "violet" },
            { title: "Installed (active)", body: "Its next hop lies inside an up, connected network. Only installed routes take part in lookups. An interface going down withdraws its connected route — and every static route reached through it.", tone: "cyan" },
            { title: "Winning", body: "Of the installed routes that contain this destination, it has the longest prefix.", tone: "success" },
            { title: "Delivered", body: "Its next hop answers ARP, a frame is built and the next router does its own lookup. A next hop nobody owns fails here.", tone: "warning" },
          ]}
        />
        <p>Each stage has its own evidence: running-config vs show ip route (or show route hidden), the router&apos;s answer for one address, its ARP cache, and a capture on the egress link.</p>
      </GuideSection>

      <GuideSection id="rtl-return" eyebrow="Both directions" title="The reply needs its own routes" tone="success">
        <DiagramFrame caption="Routing is per direction, per router.">
          <ReturnDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="rtl-default" eyebrow="Default route" title="Last resort, not a guarantee" tone="warning">
        <DiagramFrame caption={`Pinging ${OUTSIDE_DST}.`}>
          <DefaultDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="rtl-incident" eyebrow="Incident" title="A more-specific discard route" tone="danger">
        <DiagramFrame caption="The faulty /25 covers exactly the lower half of the server LAN.">
          <IncidentDiagram />
        </DiagramFrame>
        <p>
          A discard (blackhole) route is a real route whose action is &quot;drop&quot;. When it wins the lookup, the packet is dropped right there. That is not an interface, ARP, firewall or R2 failure. The /24 was never missing: for <Mono>{SA}</Mono> it simply lost to the longer <Mono>/25</Mono>, and for <Mono>{SB}</Mono> the /25 doesn&apos;t match at all.
        </p>
      </GuideSection>

      <GuideSection id="rtl-repair" eyebrow="Repair" title="Remove the stray /25, then verify" tone="success">
        <ChecklistCard tone="success" title="Verified after the repair" mark="✓" items={[`R1's longest match for ${SA} is 172.16.50.0/24 via ${NH} again`, "SERVER-A answers pings (round trip)", "SERVER-B still selects the /24 and still works", "R1's table has no 172.16.50.0/25 entry"]} />
        <p>A new default route or an extra /16 could never beat a /25: both are shorter. TTL and ARP are not involved, because the packet is dropped at route selection.</p>
      </GuideSection>

      <GuideSection id="rtl-drops" eyebrow="Failures" title="Four ways a packet stops at a router" tone="danger">
        <CompareCards
          items={[
            { title: "No route", tone: "warning", tag: "Net Unreachable", points: ["No installed route contains the destination", "The router returns ICMP 3/0 to the source", "traceroute: !N"] },
            { title: "Discard route", tone: "danger", tag: "silence", points: ["A route matched — its action is drop", "Nothing comes back: ping just times out", "It is in the table, winning"] },
            { title: "Next hop unresolved", tone: "arp", tag: "Host Unreachable", points: ["A route matched; ARP for its next hop gets no answer", "show ip arp: Incomplete", "traceroute: !H"] },
            { title: "Loop", tone: "violet", tag: "Time Exceeded", points: ["Every router forwarded it — back and forth", "TTL runs out, a router returns ICMP 11", "traceroute alternates between two addresses"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="rtl-l2l3" eyebrow="Layer 3 vs Layer 2" title="Routing is not switching" tone="ethernet">
        <CompareCards
          items={[
            { title: "Router (this lesson)", tone: "ip", tag: "Layer 3", points: ["Decides on the destination IPv4 address", "Forwards between IP networks", "Routes come from interfaces and configuration, never from source MACs", "Builds a new Ethernet frame for each link", "TTL − 1 per router"] },
            { title: "Switch (Switching Fundamentals)", tone: "ethernet", tag: "Layer 2", points: ["Decides on the destination MAC", "Forwards inside one broadcast domain", "Learns from source MACs", "Forwards the frame unchanged", "No TTL"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="rtl-model" eyebrow="Mental model" title="A sorting office with overlapping rules" tone="violet">
        <p>Picture a sorting office with rules like &quot;everything for 172.16.x.x → door 2&quot;, &quot;everything for 172.16.50.x → door 2&quot; and &quot;anything else → door 2&quot;. For each letter the clerk applies the most specific rule that fits. Add &quot;172.16.50.0–127 → shredder&quot;, and exactly those letters vanish, while the broader rules stay pinned on the wall.</p>
      </GuideSection>

      <GuideSection id="rtl-glossary" eyebrow="Glossary" title="Terms" tone="cyan">
        <Glossary
          items={[
            { term: "Connected route", def: "A network on a configured, up interface." },
            { term: "Static route", def: "An operator-configured prefix with a next hop (or discard)." },
            { term: "Default route", def: "0.0.0.0/0 — matches everything, chosen only when nothing longer matches." },
            { term: "Next hop", def: "The neighbor to hand the packet to; resolved via a connected route." },
            { term: "Longest prefix match", def: "Of all matching routes, pick the one with the most fixed bits." },
            { term: "Discard route", def: "A route whose action is to drop matching packets locally." },
          ]}
        />
      </GuideSection>

      <GuideSection id="rtl-recap" eyebrow="Recap" title="What you saw" tone="success">
        <ChecklistCard
          tone="cyan"
          title="Recap"
          mark="•"
          items={["Connected, static and default routes come from different places", "Several routes can match; the longest prefix wins — never the list order", "A static route is used only while its next hop is reachable on a connected network", "A next hop is resolved to an interface and a MAC, and never replaces the destination", "Each router decides alone, for the packet it has — the reply is routed separately", "A default route moves a packet one hop — no reachability promise", "A more-specific discard route drops exactly the addresses it covers", "No route, discard, unresolved next hop and loop each leave different evidence"]}
        />
      </GuideSection>
    </div>
  );
}
