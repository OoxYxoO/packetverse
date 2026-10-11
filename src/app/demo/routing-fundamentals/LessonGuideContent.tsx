import { ChecklistCard, CompareCards, DArrow, DIAGRAM as D, DiagramFrame, DiagramSvg, DNode, FieldTable, FlowSteps, Glossary, GuideSection, Mono, TroubleshootingFlow } from "@/components/lesson/GuideBlocks";
import { PresentationBridge } from "@/components/presentation/LessonPresentation";
import { PracticeBridge } from "@/components/lesson/GuideInteractive";
import { usePracticeLabOpener } from "@/components/lesson/FundamentalsLessonShell";
import { DFieldRow } from "@/components/lesson/FundamentalsGuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { CliPanel, pickLines, runGuideCli } from "@/components/lesson/GuideCli";
import type { CliVendor } from "@/lib/cli/types";
import { RT_ADDR, RT_MAC, ipBits } from "@/lib/sim-engine/scenarios/routingFundamentals";
import { createRouteNet, isRouter, RN_OUTSIDE, rnApply, rnClone, rnTicketState, type RnDev, type RnState } from "@/lib/sim-engine/scenarios/routeNet";
import { rnHostSet, rnRouterSets, type RnCliApi } from "./routing-lab/rnCli";

/**
 * ROUTING LESSON GUIDE — the lesson's story on the Routing Lab's network (HOST-A, R1, R2, R3, the server LANs):
 * connected, static and default routes, longest-prefix match, next-hop resolution, hop-by-hop decisions, the return
 * path, then the /25 discard incident. Every output is printed by the lab's own terminals, run against its model.
 */
export const RT_LESSON_SECTIONS: LessonGuideSectionLink[] = [
  { id: "rtl-mission", label: "What this lesson teaches" },
  { id: "rtl-network", label: "The network of this lesson" },
  { id: "rtl-ideas", label: "Three ideas you need" },
  { id: "rtl-walk", label: "What you will watch" },
  { id: "rtl-connected", label: "Connected routes come free" },
  { id: "rtl-static", label: "Static and default routes" },
  { id: "rtl-lpm", label: "The longest match wins" },
  { id: "rtl-nexthop", label: "From next hop to neighbor" },
  { id: "rtl-hops", label: "Every router decides again" },
  { id: "rtl-return", label: "The way back" },
  { id: "rtl-default", label: "When only the default matches" },
  { id: "rtl-verify", label: "What working looks like" },
  { id: "rtl-incident", label: "The incident" },
  { id: "rtl-investigate", label: "Which route did R1 pick?" },
  { id: "rtl-repair", label: "Repair and prove it" },
  { id: "rtl-other", label: "Other ways routing breaks" },
  { id: "rtl-model", label: "Mental model" },
  { id: "rtl-glossary", label: "Glossary" },
  { id: "rtl-recap", label: "Recap" },
  { id: "rtl-practice", label: "Practice it" },
];

const SA = RT_ADDR["SERVER-A"];
const SB = RT_ADDR["SERVER-B"];
const HA = RT_ADDR["HOST-A"];
const NH = RT_ADDR["R2:TRANSIT"];
const SC = "172.16.60.10";

/** The Routing Lab's own terminals (R1–R3 in Cisco IOS or Junos, the Linux hosts), run against a lab state. */
function lessonCli(s: RnState, dev: RnDev, vendor: CliVendor, command: string) {
  const api: RnCliApi = { view: s, act: (a) => rnApply(s, a), ios: { R1: { kind: "exec" }, R2: { kind: "exec" }, R3: { kind: "exec" } }, setIos: () => undefined, junosEdit: { R1: false, R2: false, R3: false }, setJunosEdit: () => undefined, cand: { R1: s.cfg.r.R1, R2: s.cfg.r.R2, R3: s.cfg.r.R3 }, setCand: () => undefined };
  return runGuideCli(isRouter(dev) ? rnRouterSets(api, dev)[vendor] : rnHostSet(api, dev), command);
}
const HEALTHY = createRouteNet();
/** The lab's "discard" ticket: a /25 discard route left on R1. */
const BROKEN = rnTicketState("discard", 1);
const FIXED = (() => {
  const c = rnClone(BROKEN.cfg);
  c.r.R1.statics = c.r.R1.statics.filter((x) => !x.discard);
  return rnApply(BROKEN, { type: "cfg", cfg: c, text: "no ip route 172.16.50.0 255.255.255.128 Null0" });
})();

/** The Routing Lab's network: three routers on a triangle of /30 links. */
function TopologyDiagram() {
  return (
    <DiagramSvg h={250} label={`HOST-A ${HA} behind R1; SERVER-A ${SA} and SERVER-B ${SB} behind R2; SERVER-C ${SC} behind R3; R1, R2 and R3 joined by three /30 links`}>
      <DArrow x1={112} y1={125} x2={196} y2={125} color={D.line} both width={1.6} />
      <DArrow x1={290} y1={110} x2={398} y2={64} color={D.line} both width={1.6} />
      <DArrow x1={290} y1={140} x2={398} y2={186} color={D.line} both width={1.6} />
      <DArrow x1={440} y1={78} x2={440} y2={172} color={D.line} both width={1.6} />
      <DArrow x1={492} y1={52} x2={530} y2={36} color={D.line} width={1.4} />
      <DArrow x1={492} y1={68} x2={530} y2={92} color={D.line} width={1.4} />
      <DArrow x1={492} y1={196} x2={530} y2={196} color={D.line} width={1.4} />
      <DNode x={60} y={125} label="HOST-A" sub={HA} accent={D.cyan} w={104} />
      <DNode x={246} y={125} label="R1" sub="10.10.10.1" accent={D.ip} w={90} />
      <DNode x={440} y={60} label="R2" sub="172.16.50.1" accent={D.ip} w={100} />
      <DNode x={440} y={190} label="R3" sub="172.16.60.1" accent={D.ip} w={100} />
      <DNode x={584} y={30} label="SERVER-A" sub={SA} accent={D.success} w={104} />
      <DNode x={584} y={100} label="SERVER-B" sub={SB} accent={D.success} w={104} />
      <DNode x={584} y={196} label="SERVER-C" sub={SC} accent={D.success} w={104} />
      <text x={154} y={112} textAnchor="middle" fill={D.muted} fontSize={9} fontFamily="monospace">10.10.10.0/24</text>
      <text x={326} y={76} textAnchor="middle" fill={D.muted} fontSize={9} fontFamily="monospace">10.0.12.0/30</text>
      <text x={326} y={186} textAnchor="middle" fill={D.muted} fontSize={9} fontFamily="monospace">10.0.13.0/30</text>
      <text x={450} y={130} fill={D.muted} fontSize={9} fontFamily="monospace">10.0.23.0/30</text>
      <text x={584} y={140} textAnchor="middle" fill={D.muted} fontSize={9} fontFamily="monospace">172.16.50.0/24</text>
      <text x={584} y={232} textAnchor="middle" fill={D.muted} fontSize={9} fontFamily="monospace">172.16.60.0/24</text>
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

function LessonLabBridge() {
  const open = usePracticeLabOpener();
  return (
    <PracticeBridge label="Open the Routing Lab" onPractice={open}>
      Same network, your own copy. Nothing you do there changes your lesson progress.
    </PracticeBridge>
  );
}

export function RoutingLessonGuideContent() {
  const connected = lessonCli(HEALTHY, "R1", "cisco", "show ip route connected");
  const r1Table = lessonCli(HEALTHY, "R1", "cisco", "show ip route");
  const lookupA = lessonCli(HEALTHY, "R1", "cisco", `show ip route ${SA}`);
  const lookupC = lessonCli(HEALTHY, "R1", "cisco", `show ip route ${SC}`);
  const traceA = lessonCli(HEALTHY, "HOST-A", "cisco", `traceroute ${SA}`);
  const r2Static = lessonCli(HEALTHY, "R2", "cisco", "show ip route static");
  const outside = lessonCli(HEALTHY, "HOST-A", "cisco", `ping -c 1 ${RN_OUTSIDE}`);
  const pingOk = lessonCli(HEALTHY, "HOST-A", "cisco", `ping -c 2 ${SA}`);
  const pingBadA = lessonCli(BROKEN, "HOST-A", "cisco", `ping -c 2 ${SA}`);
  const pingBadB = lessonCli(BROKEN, "HOST-A", "cisco", `ping -c 2 ${SB}`);
  const lookupBad = lessonCli(BROKEN, "R1", "cisco", `show ip route ${SA}`);
  const staticBad = lessonCli(BROKEN, "R1", "cisco", "show ip route static");
  const traceBad = lessonCli(BROKEN, "HOST-A", "cisco", `traceroute ${SA}`);
  const junosBad = lessonCli(BROKEN, "R1", "juniper", "show configuration routing-options");
  const lookupFixed = lessonCli(FIXED, "R1", "cisco", `show ip route ${SA}`);
  const pingFixed = lessonCli(FIXED, "HOST-A", "cisco", `ping -c 2 ${SA}`);
  const pingLines = /PING|bytes from|From|transmitted/;
  return (
    <div className="space-y-12">
      <GuideSection id="rtl-mission" eyebrow="This lesson" title="What this lesson teaches" tone="ip">
        <p>
          HOST-A&apos;s packets for the servers cross one, two or more routers. In the IPv4 lesson R1 only had to know its two connected networks. Here the servers sit behind other routers, so R1 has to be told where they are, and every router on the way makes its own decision, from its own table.
        </p>
        <p>
          This lesson shows how a router decides: you watch R1 build a table from connected and static routes, pick the longest matching prefix, turn a next hop into a neighbor, and hand the packet to the next router, which decides again; you see the way back and the default route. Then one server becomes unreachable while its neighbor works, and you find out why, fix it, and prove it.
        </p>
        <ChecklistCard
          tone="ip"
          title="By the end of this lesson you can"
          mark="→"
          items={[
            "read a routing table: connected, static and default routes, and what each one says",
            "pick the route a router uses for any destination, by longest prefix match",
            "explain how a next hop becomes an exit interface and a neighbor's MAC",
            "explain why the return path is a separate set of decisions on other routers",
            "find and repair the incident of this lesson from the routers' tables, and prove it",
          ]}
        />
      </GuideSection>

      <GuideSection id="rtl-network" eyebrow="This lesson" title="The network of this lesson" tone="cyan">
        <DiagramFrame caption="Three routers on a triangle of links. Each server LAN sits behind its own router.">
          <TopologyDiagram />
        </DiagramFrame>
        <FieldTable
          title="Who is where"
          columns={["Device", "Address", "Behind"]}
          rows={[
            ["HOST-A", `${HA}/24`, "R1 ge-0/0/0 (10.10.10.1)"],
            ["SERVER-A", `${SA}/24`, "R2 ge-0/0/0 (172.16.50.1)"],
            ["SERVER-B", `${SB}/24`, "R2 ge-0/0/0 (172.16.50.1)"],
            ["SERVER-C", `${SC}/24`, "R3 ge-0/0/0 (172.16.60.1)"],
          ]}
        />
        <p className="text-sm text-pv-text-muted">
          R1–R2 is 10.0.12.0/30, R1–R3 10.0.13.0/30, R2–R3 10.0.23.0/30. There is no routing protocol: every remote network is a static route someone typed. The guided lesson follows HOST-A → R1 → R2; the Routing Lab adds R3 and SERVER-C, so R1&apos;s broader routes point to R3. On Cisco the ports are Gi0/0–Gi0/2.
        </p>
      </GuideSection>

      <GuideSection id="rtl-ideas" eyebrow="This lesson" title="Three ideas you need" tone="cyan">
        <FlowSteps
          steps={[
            { title: "A router knows only its table", body: "Connected networks come from its own interfaces; every other network must be added (static) or learned. No route, no forwarding.", tone: "ip" },
            { title: "The longest match wins", body: "If several routes contain the destination, the one with the longest prefix is used, even if it leads nowhere.", tone: "warning" },
            { title: "Every router decides again, both ways", body: "Each router on the path looks the destination up in its own table, and the reply makes its own trip back.", tone: "violet" },
          ]}
        />
      </GuideSection>

      <GuideSection id="rtl-walk" eyebrow="This lesson" title="What you will watch, step by step" tone="warning">
        <FlowSteps
          steps={[
            { title: "Connected", body: "R1 knows its three networks because its interfaces are up in them.", tone: "cyan" },
            { title: "Static and default", body: "Three routes typed on R1: a /24, a /16 and 0.0.0.0/0.", tone: "ip" },
            { title: "Longest match", body: "SERVER-A matches all three; the /24 wins.", tone: "warning" },
            { title: "Next hop and hops", body: "R1 resolves 10.0.12.2, hands the packet to R2, and R2 decides again.", tone: "violet" },
            { title: "The way back", body: "R2 needs its own route back to HOST-A's network.", tone: "success" },
            { title: "The incident", body: "SERVER-A is unreachable, SERVER-B fine. You find out why and fix it.", tone: "danger" },
          ]}
        />
        <p className="text-sm text-pv-text-muted">The sections below walk through each step on this network, in the same order.</p>
      </GuideSection>

      <GuideSection id="rtl-connected" eyebrow="Connected" title="Connected routes come free" tone="cyan">
        <p>Give an interface an address and bring it up, and the router installs a <strong>connected</strong> route for that network, plus a /32 local route for its own address. R1 knows these three networks without anyone telling it:</p>
        <CliPanel run={{ ...connected, output: pickLines(connected.output, /^[CL] /) }} caption="R1 · Cisco IOS" />
        <p>Nothing here says where 172.16.50.0/24 is. Without more, R1 would answer HOST-A&apos;s packets for the servers with Destination Net Unreachable.</p>
      </GuideSection>

      <GuideSection id="rtl-static" eyebrow="Static" title="Static routes, and the default route" tone="ip">
        <p>
          A <strong>static route</strong> is typed by an operator: &quot;to reach this network, hand packets to that next hop&quot;. R1 has three: the server LAN 172.16.50.0/24 via R2, the whole 172.16.0.0/16 via R3, and the <strong>default route</strong> 0.0.0.0/0 via R3, which matches any destination at all. Cisco calls the default the gateway of last resort:
        </p>
        <CliPanel run={{ ...r1Table, output: pickLines(r1Table.output, /last resort|^S|^C /) }} caption="R1 · Cisco IOS · the whole table" />
      </GuideSection>

      <GuideSection id="rtl-lpm" eyebrow="Longest prefix match" title="Several routes match: the longest wins" tone="warning">
        <p>
          For SERVER-A ({SA}) three routes match: the /24, the /16 and the /0. R1 picks the one with the most fixed bits: the /24, via R2. For SERVER-C ({SC}) the /24 doesn&apos;t match (60 ≠ 50), so the /16 wins, via R3:
        </p>
        <DiagramFrame caption="Compare the fixed bits of each route with the destination: the longest full match wins.">
          <LpmDiagram />
        </DiagramFrame>
        <div className="grid gap-3 lg:grid-cols-2">
          <CliPanel run={lookupA} caption="R1 · which route for SERVER-A?" />
          <CliPanel run={lookupC} caption="R1 · which route for SERVER-C?" />
        </div>
      </GuideSection>

      <GuideSection id="rtl-nexthop" eyebrow="Next hop" title="From next hop to neighbor" tone="arp">
        <p>The /24 says &quot;via {NH}&quot;. R1 still has to find out how to reach {NH}: it looks that address up too, finds it inside the connected 10.0.12.0/30 on ge-0/0/1, and ARPs for R2&apos;s MAC there. Only then can it build the frame:</p>
        <DiagramFrame caption="A static route's next hop must resolve through a connected network.">
          <NextHopDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="rtl-hops" eyebrow="Hop by hop" title="Every router decides again" tone="violet">
        <p>
          R2 receives the packet and knows nothing of R1&apos;s choice: it looks {SA} up in its own table, finds it connected on ge-0/0/0, and delivers it. Each router lowers the TTL and builds a new frame; the IPv4 addresses never change:
        </p>
        <DiagramFrame caption="One packet, three links, three frames: TTL 64, 63, 62.">
          <HopsDiagram />
        </DiagramFrame>
        <CliPanel run={traceA} caption="HOST-A · the path to SERVER-A" />
      </GuideSection>

      <GuideSection id="rtl-return" eyebrow="The way back" title="The way back is a different set of decisions" tone="success">
        <p>SERVER-A&apos;s reply goes to its gateway R2, and R2 needs a route to 10.10.10.0/24. That is a separate static route, on another router, typed by someone else. Without it, the request arrives and the reply has nowhere to go:</p>
        <DiagramFrame caption="The reply makes its own decisions: R2's static route back, then R1's connected network.">
          <ReturnDiagram />
        </DiagramFrame>
        <CliPanel run={{ ...r2Static, output: pickLines(r2Static.output, /^S /) }} caption="R2 · its static routes" />
      </GuideSection>

      <GuideSection id="rtl-default" eyebrow="The default route" title="When only the default matches" tone="warning">
        <p>
          For {RN_OUTSIDE}, nothing specific matches on R1, so the default route sends it to R3. R3 has no route for it and no default, so R3 drops it and says so, from its own address: Destination Net Unreachable. The default only moves the decision to another router.
        </p>
        <CliPanel run={{ ...outside, output: pickLines(outside.output, pingLines) }} caption="HOST-A · a destination nobody routes" />
        <p>
          Notice one more thing about the longest-match rule: R1 never asks whether the winning route actually works. A more specific route always beats a broader one, even if it leads nowhere. Keep that in mind: it is the key to the incident.
        </p>
      </GuideSection>

      <GuideSection id="rtl-verify" eyebrow="Verification" title="What working looks like" tone="success">
        <p>Each idea of this lesson has one place that proves it. The commands are only the way to ask; what matters is what each answer proves.</p>
        <FieldTable
          title="Read the lesson on the routers"
          columns={["Question", "Cisco IOS", "Junos", "What the answer proves"]}
          rows={[
            ["What does this router know?", <Mono key="1">show ip route</Mono>, <Mono key="2">show route</Mono>, "Connected, static and default routes that are installed"],
            ["Which route for this address?", <Mono key="3">show ip route &lt;ip&gt;</Mono>, <Mono key="4">show route &lt;ip&gt;</Mono>, "The longest match, and its next hop"],
            ["What was configured?", <Mono key="5">show running-config</Mono>, <Mono key="6">show configuration routing-options</Mono>, "Every static route typed, including unusable ones"],
            ["Does the path work both ways?", <Mono key="7">ping · traceroute</Mono>, <Mono key="8">ping · traceroute</Mono>, "TTL 62 from SERVER-A: two routers crossed"],
          ]}
        />
        <CliPanel run={{ ...pingOk, output: pickLines(pingOk.output, pingLines) }} caption="HOST-A · healthy" />
      </GuideSection>

      <GuideSection id="rtl-incident" eyebrow="Incident" title="The incident: one server gone" tone="danger">
        <p>The ticket says: &quot;After last night&apos;s change on R1, nobody can reach SERVER-A (172.16.50.50). SERVER-B, on the same LAN, works fine.&quot; Every interface is up, and nobody touched R2.</p>
        <DiagramFrame caption="A /25 discard route covers .0–.127 of the server LAN: SERVER-A is inside it, SERVER-B isn't.">
          <IncidentDiagram />
        </DiagramFrame>
        <CompareCards
          items={[
            { title: "What should happen", tone: "success", tag: "normal", points: [`R1 matches ${SA} with the /24 via R2`, "R2 delivers it on its LAN", "The reply comes back through R2 and R1"] },
            { title: "What happens", tone: "danger", tag: "incident", points: [`R1 matches ${SA} with a /25 discard route`, "R1 drops the packet, without a word", `${SB} still matches the /24 and works`] },
          ]}
        />
        <CompareCards
          items={[
            { title: "Why it fails", tone: "danger", tag: "cause", points: ["A static 172.16.50.0/25 to Null0 was left on R1", "/25 is longer than /24, so it wins for .0–.127", "A discard route drops silently: no ICMP"] },
            { title: "What it can't be", tone: "warning", tag: "red herrings", points: ["R2 or its LAN: SERVER-B on the same LAN works", "The return path: the request never leaves R1", "SERVER-A itself: nothing reaches it to answer"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="rtl-investigate" eyebrow="Investigation" title="Ask R1 which route it picked" tone="danger">
        <TroubleshootingFlow
          steps={[
            { question: "What works, what doesn't?", look: "SERVER-B (.200) answers; SERVER-A (.50), on the same LAN, is silent. Same LAN, different result: look at the routes, not the LAN." },
            { question: "Where does the trace stop?", look: "After R1: R1 receives the packet and nothing comes back." },
            { question: "Which route does R1 use for SERVER-A?", look: "show ip route 172.16.50.50: 172.16.50.0/25, via Null0. A discard route, longer than the /24." },
          ]}
        />
        <div className="grid gap-3 lg:grid-cols-2">
          <CliPanel run={{ ...pingBadA, output: pickLines(pingBadA.output, pingLines) }} caption="HOST-A · SERVER-A: silence" />
          <CliPanel run={{ ...pingBadB, output: pickLines(pingBadB.output, pingLines) }} caption="HOST-A · SERVER-B: fine" />
        </div>
        <CliPanel run={traceBad} caption="HOST-A · the trace stops after R1" />
        <CliPanel run={lookupBad} caption="R1 · the route it picks for SERVER-A" />
        <CliPanel run={{ ...staticBad, output: pickLines(staticBad.output, /^S|^ +S/) }} caption="R1 · its static routes" />
        <CliPanel run={junosBad} caption="R1 · Junos · the configuration" />
      </GuideSection>

      <GuideSection id="rtl-repair" eyebrow="Repair" title="Repair, and prove it with a fresh test" tone="success">
        <p>Remove the discard route. The /24 then becomes the longest match for SERVER-A again. Nothing on R2 or the servers changes.</p>
        <CompareCards
          items={[
            { title: "Cisco IOS · R1", tone: "cyan", tag: "configuration mode", points: ["no ip route 172.16.50.0 255.255.255.128 Null0"] },
            { title: "Junos · R1", tone: "violet", tag: "candidate → commit", points: ["delete routing-options static route 172.16.50.0/25", "commit"] },
          ]}
        />
        <CliPanel run={lookupFixed} caption="R1 · after the repair" />
        <CliPanel run={{ ...pingFixed, output: pickLines(pingFixed.output, pingLines) }} caption="HOST-A · SERVER-A again" />
        <ChecklistCard
          tone="success"
          title="The proof"
          mark="✓"
          items={[
            `show ip route ${SA} picks 172.16.50.0/24 via ${NH}`,
            "A fresh ping to SERVER-A answers with ttl=62",
            "SERVER-B was never affected",
            "No other static route on R1 changed",
          ]}
        />
      </GuideSection>

      <GuideSection id="rtl-other" eyebrow="Troubleshooting" title="Other ways routing breaks" tone="warning">
        <p>The discard route is one way a routing table can mislead. The lab&apos;s tickets add four more, each with its own evidence. The Deep Dive walks through all five with real output from all three routers.</p>
        <CompareCards
          items={[
            { title: "No route back", tone: "warning", tag: "silent timeout", points: ["The request reaches SERVER-A, the reply never returns", "R2 has no route to 10.10.10.0/24", "show ip route 10.10.10.10 on R2: not in table"] },
            { title: "A wrong next hop", tone: "danger", tag: "host unreachable from R1", points: ["The /24 points at 10.0.12.3, which nobody owns", "R1 can't ARP the next hop", "R1 reports Destination Host Unreachable"] },
            { title: "An interface down", tone: "violet", tag: "net unreachable from R1", points: ["R1's link to R3 is down", "Routes via 10.0.13.2 can't be used", "show ip route: network not in table"] },
            { title: "A routing loop", tone: "danger", tag: "TTL exceeded", points: ["R2 lost its server LAN and got a default to R1", "R1 and R2 pass packets back and forth", "traceroute alternates 10.0.12.2, 10.0.12.1"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="rtl-model" eyebrow="Mental model" title="Signposts at every crossroads" tone="cyan">
        <p>
          Each router is a crossroads with its own signposts. Connected roads are painted on the ground; static signs were put up by hand; the default sign says &quot;everything else: that way&quot;. A traveler (the packet) reads only the most precise sign that matches its address, takes that road, and at the next crossroads reads that town&apos;s signs, with no memory of the last. Nobody checks that a sign is right: a precise sign pointing into a ditch beats a vague sign pointing home. And the trip back reads a completely different set of signs.
        </p>
      </GuideSection>

      <GuideSection id="rtl-glossary" eyebrow="Glossary" title="Terms used in this lesson" tone="violet">
        <Glossary
          items={[
            { term: "Routing table", def: "The routes a router has installed: destination prefix → next hop or exit interface." },
            { term: "Connected route", def: "A network one of the router's up interfaces has an address in." },
            { term: "Static route", def: "A route typed by an operator: prefix, then next hop (or discard)." },
            { term: "Default route", def: "0.0.0.0/0: matches every destination, used when nothing more specific does." },
            { term: "Longest prefix match", def: "Of all routes containing the destination, the one with the most fixed bits wins." },
            { term: "Next hop", def: "The neighbor router a packet is handed to; it must resolve through a connected network." },
            { term: "Discard route", def: "A static route to Null0: matching packets are dropped silently." },
          ]}
        />
      </GuideSection>

      <GuideSection id="rtl-recap" eyebrow="Recap" title="What you can now explain" tone="success">
        <ChecklistCard
          tone="cyan"
          title="Routing in this lesson"
          mark="→"
          items={[
            "Connected routes come from up interfaces; remote networks need static routes (or a protocol)",
            "The default route catches everything else, and only moves the decision to the next router",
            "The longest matching prefix wins, whether or not it leads anywhere useful",
            "A next hop resolves through a connected network, then ARP",
            "Every router decides again, and the way back is a separate set of routes",
            "Same LAN, one host reachable and one not: look for a more specific route",
          ]}
        />
      </GuideSection>

      <GuideSection id="rtl-practice" eyebrow="Practice" title="Practice it" tone="cyan">
        <p>You now know how every router on the path should decide, and how to prove it. The Routing Lab gives you R1, R2 and R3 as Cisco IOS or Junos, and Linux hosts:</p>
        <FlowSteps
          steps={[
            { title: "Learn (6 levels)", body: "Connected networks, static route and next hop, longest prefix match, every router decides, the return path, when routes can't be used.", tone: "violet" },
            { title: "Build", body: "Start from connected routes only and add every static route the network needs, then prove each path both ways.", tone: "warning" },
            { title: "Troubleshoot (5 tickets)", body: "This lesson's incident and the four other faults above, reported as users report them.", tone: "danger" },
          ]}
        />
        <PresentationBridge>Watch R1 build its table, pick the longest match and pass the packet on, in the Routing presentation.</PresentationBridge>
        <LessonLabBridge />
        <p className="text-sm text-pv-text-muted">For the full course (RIB and forwarding table, route preference, recursive next hops, ECMP, summary and discard routes, real output for every ticket, a knowledge check), open the Deep Dive tab.</p>
      </GuideSection>
    </div>
  );
}
