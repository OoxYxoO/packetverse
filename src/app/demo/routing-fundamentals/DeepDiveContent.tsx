import type { ReactNode } from "react";
import { Callout, ChecklistCard, CompareCards, DArrow, DIAGRAM as D, DiagramFrame, DiagramSvg, DNode, DPill, FailureSignatures, FieldTable, FlowSteps, GuideSection, Misconceptions, Mono, TroubleshootingFlow } from "@/components/lesson/GuideBlocks";
import { ExplainIt, KnowledgeQuiz, PracticeBridge, type KnowledgeQuestion } from "@/components/lesson/GuideInteractive";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { usePracticeLabOpener } from "@/components/lesson/FundamentalsLessonShell";
import { CliPanel, FailureWalk, pickLines, runGuideCli, type GuideCliRun } from "@/components/lesson/GuideCli";
import type { CliVendor } from "@/lib/cli/types";
import { createRouteNet, isRouter, RN_OUTSIDE, rnApply, rnConnectedOnly, rnHealthy, rnLookup, rnTicket, rnTicketState, routeKeyOf, type RnCfg, type RnDev, type RnRouter, type RnRun, type RnState, type RnTicketId } from "@/lib/sim-engine/scenarios/routeNet";
import { rnHostSet, rnRouterSets, type RnCliApi } from "./routing-lab/rnCli";

/**
 * ROUTING DEEP DIVE — the complete static-routing course, taught on the Routing Lab's network (HOST-A, R1, R2, R3,
 * SERVER-A/B/C). Every CLI sample is printed by the lab's own terminals (Cisco IOS / Junos routers, Linux hosts) run
 * against its model. OSPF and BGP stay out: they are their own lessons.
 * Progression: Foundation → The table → The decision → Forwarding → Operations → Troubleshooting → Beyond → Master it.
 */
const G = { foundation: "Foundation", table: "The routing table", decide: "The decision", forward: "Forwarding", ops: "Operations", trouble: "Troubleshooting", beyond: "Beyond this lesson", master: "Master it" };

export const RT_DEEP_DIVE_SECTIONS: LessonGuideSectionLink[] = [
  { id: "rtd-why", label: "Why routers need tables", group: G.foundation },
  { id: "rtd-rib", label: "RIB vs FIB", group: G.foundation },
  { id: "rtd-prereq", label: "What you already know", group: G.foundation },
  { id: "rtd-sources", label: "Connected, local, static", group: G.table },
  { id: "rtd-build", label: "Building R1's table", group: G.table },
  { id: "rtd-installed", label: "Configured vs installed", group: G.table },
  { id: "rtd-default", label: "Default routes", group: G.table },
  { id: "rtd-lpm", label: "Longest prefix match", group: G.decide },
  { id: "rtd-lpmtrace", label: "Watching R1 decide", group: G.decide },
  { id: "rtd-hostroute", label: "Host routes", group: G.decide },
  { id: "rtd-preference", label: "Preference, then LPM", group: G.decide },
  { id: "rtd-ecmp", label: "Equal prefixes and ECMP", group: G.decide },
  { id: "rtd-recursive", label: "Recursive next hops", group: G.forward },
  { id: "rtd-nexthoparp", label: "The next hop must answer ARP", group: G.forward },
  { id: "rtd-perhop", label: "What each hop changes", group: G.forward },
  { id: "rtd-trail", label: "One ping, every decision", group: G.forward },
  { id: "rtd-return", label: "The return path", group: G.forward },
  { id: "rtd-asym", label: "Asymmetric paths", group: G.forward },
  { id: "rtd-drops", label: "Four ways a router drops", group: G.forward },
  { id: "rtd-loop", label: "Inside a loop", group: G.forward },
  { id: "rtd-summary", label: "Summaries and discard", group: G.forward },
  { id: "rtd-ops", label: "Reading tables on both vendors", group: G.ops },
  { id: "rtd-evidence", label: "Evidence on every layer", group: G.ops },
  { id: "rtd-signatures", label: "Failure signatures", group: G.trouble },
  { id: "rtd-workflow", label: "Troubleshooting workflow", group: G.trouble },
  { id: "rtd-backward", label: "Working backward", group: G.trouble },
  { id: "rtd-faults", label: "The five tickets, step by step", group: G.trouble },
  { id: "rtd-prove", label: "Proving a repair", group: G.trouble },
  { id: "rtd-dynamic", label: "Where dynamic routing fits", group: G.beyond },
  { id: "rtd-myths", label: "Common misconceptions", group: G.master },
  { id: "rtd-quiz", label: "Knowledge check", group: G.master },
  { id: "rtd-explain", label: "Can you explain it?", group: G.master },
  { id: "rtd-practice", label: "Practice in the Routing Lab", group: G.master },
];

// ------------------------------------------------------------------ the Routing Lab's model and terminals

const SA = "172.16.50.50";
const SB = "172.16.50.200";
const SC = "172.16.60.10";
function cli(s: RnState, dev: RnDev, vendor: CliVendor, command: string): GuideCliRun {
  const api: RnCliApi = { view: s, act: (a) => rnApply(s, a), ios: { R1: { kind: "exec" }, R2: { kind: "exec" }, R3: { kind: "exec" } }, setIos: () => undefined, junosEdit: { R1: false, R2: false, R3: false }, setJunosEdit: () => undefined, cand: { R1: s.cfg.r.R1, R2: s.cfg.r.R2, R3: s.cfg.r.R3 }, setCand: () => undefined };
  return runGuideCli(isRouter(dev) ? rnRouterSets(api, dev)[vendor] : rnHostSet(api, dev), command);
}
const only = (r: GuideCliRun, match: RegExp): GuideCliRun => ({ ...r, output: pickLines(r.output, match) });
const PING = /PING|bytes from|From|transmitted/;
const HEALTHY = createRouteNet();
const T = (id: RnTicketId) => rnTicketState(id, 1);
// Model-built scenarios for topics the tickets don't cover (each is a real lab configuration).
const withCfg = (f: (c: RnCfg) => void) => {
  const c = rnHealthy();
  f(c);
  return createRouteNet(c);
};
const CONNECTED_ONLY = createRouteNet(rnConnectedOnly());
const HOST_ROUTE = withCfg((c) => c.r.R1.statics.push({ prefix: SB, len: 32, nh: "10.0.13.2" }));
const ASYM = withCfg((c) => (c.r.R3.statics = c.r.R3.statics.map((x) => (x.prefix === "10.10.10.0" ? { ...x, nh: "10.0.23.1" } : x))));
const NOT_CONNECTED = withCfg((c) => c.r.R1.statics.push({ prefix: "172.16.60.0", len: 24, nh: "10.0.23.2" }));
const pingRun = (st: RnState, from: RnDev, dst: string) => rnApply(st, { type: "ping", from, dst, count: 1 });
const HEALTHY_PING_A = pingRun(HEALTHY, "HOST-A", SA);
const T_TYPO_RUN = pingRun(T("typo"), "HOST-A", SB);
const TRAIL_COLS = ["#", "At", "Packet", "Decision"];
const decisionsOf = (run: RnRun | undefined) => (run ? run.moments.flatMap((m) => m.decisions).filter((d) => d.pkt.probe === run.probes[0]?.probe) : []);
const KIND: Record<string, string> = { echo: "Echo", reply: "Echo reply", "time-exceeded": "Time exceeded", "net-unreach": "Net unreachable", "host-unreach": "Host unreachable" };
const trailRow = (d: ReturnType<typeof decisionsOf>[number], i: number) => [String(i + 1), d.at, <span key="p" className="whitespace-nowrap">{`${KIND[d.pkt.kind] ?? d.pkt.kind} ${d.pkt.src} → ${d.pkt.dst} · TTL ${d.pkt.ttl}`}</span>, d.text];
const trailRows = (st: RnState) => decisionsOf(st.last).map(trailRow);
function loopRows() {
  const ds = decisionsOf(pingRun(T("loop"), "HOST-A", SA).last);
  const head = ds.slice(0, 6).map(trailRow);
  const from = Math.max(6, ds.findIndex((d) => d.outcome === "ttl") - 1);
  const tail = ds.slice(from).map((d, k) => trailRow(d, from + k));
  return [...head, ["…", "", "", `${from - 6} more decisions, R1 and R2 alternating, one TTL each`], ...tail];
}
/** R1's candidates for one destination: every installed route except its own /32 local addresses. */
function lookupRows(r: RnRouter, dst: string) {
  const l = rnLookup(HEALTHY.cfg, r, dst);
  return l.candidates
    .filter((c) => c.route.proto !== "local" && c.route.active)
    .sort((a, b) => b.route.len - a.route.len)
    .map((c) => {
      const win = l.winner && routeKeyOf(l.winner) === routeKeyOf(c.route);
      return [<Mono key="r">{routeKeyOf(c.route)}</Mono>, c.matches ? (win ? "yes · wins" : "yes") : "no", `/${c.route.len}`];
    });
}
function captureRows(st: RnState) {
  const run = st.last;
  if (!run) return [];
  return st.captures
    .filter((c) => c.n >= run.capFrom)
    .map((c) => [c.point, c.dir, c.arp ? `ARP ${c.arp.op}: who has ${c.arp.who}? tell ${c.arp.tell}${c.arp.mac ? ` → ${c.arp.mac}` : ""}` : `${KIND[c.pkt!.kind] ?? c.pkt!.kind} ${c.pkt!.src} → ${c.pkt!.dst} · TTL ${c.pkt!.ttl}`]);
}
const dropText = (st: RnState, outcome: string) => decisionsOf(st.last).find((d) => d.outcome === outcome)?.text ?? "";
const LEG: Record<string, string> = { request: "the request", reply: "the reply", error: "the error" };
const WHY: Record<string, string> = { discard: "discard route", "no-route": "no matching route", "arp-fail": "next hop didn't answer ARP", ttl: "TTL expired", "no-gateway": "no gateway" };
function stopRows() {
  return (["discard", "return", "typo", "ifdown", "loop"] as RnTicketId[]).map((id, i) => {
    const t = rnTicket(id).test;
    const p = pingRun(T(id), t.from, t.dst).last?.probes[0];
    return [`${i + 1} · ${rnTicket(id).title}`, p?.arrived ? "yes" : "no", p?.failedLeg ? LEG[p.failedLeg] : "—", p?.stopAt ?? "—", p?.stop ? (WHY[p.stop] ?? p.stop) : "—", p?.kind ? `${KIND[p.kind] ?? p.kind} from ${p.from}` : "none"];
  });
}

const Strong = ({ children }: { children: ReactNode }) => <b className="text-pv-text">{children}</b>;
function LabBridge({ label, children }: { label: string; children: ReactNode }) {
  const openLab = usePracticeLabOpener();
  return (
    <PracticeBridge label={label} onPractice={openLab}>
      {children}
    </PracticeBridge>
  );
}

// ------------------------------------------------------------------ diagrams
function RibFibDiagram() {
  const src = [
    { y: 40, t: "Connected", s: "interfaces up" },
    { y: 95, t: "Static", s: "operator" },
    { y: 150, t: "Dynamic", s: "OSPF, BGP …" },
  ];
  return (
    <DiagramSvg h={200} label="Route sources — connected, static and dynamic protocols — feed the RIB, which keeps the best route per prefix; the RIB programs the forwarding table (FIB), where each packet's destination is looked up by longest prefix match">
      {src.map((x) => (
        <g key={x.t}>
          <DNode x={80} y={x.y} label={x.t} sub={x.s} accent={D.cyan} w={120} />
          <DArrow x1={142} y1={x.y} x2={236} y2={95} color={D.muted} width={1.4} />
        </g>
      ))}
      <DNode x={300} y={95} label="RIB" sub="best route per prefix" accent={D.violet} w={120} h={52} />
      <DArrow x1={362} y1={95} x2={424} y2={95} color={D.violet} />
      <DNode x={490} y={95} label="FIB" sub="forwarding table" accent={D.ip} w={120} h={52} />
      <DPill x={490} y={160} text="packet: LPM lookup" color={D.success} />
      <text x={320} y={194} textAnchor="middle" fill={D.muted} fontSize={10}>
        Control plane builds the table; the data plane only looks things up in it.
      </text>
    </DiagramSvg>
  );
}

function PreferenceDiagram() {
  return (
    <DiagramSvg h={220} label="Two separate decisions: first, when several sources offer the SAME prefix, route preference picks which one is installed; second, per packet, longest prefix match chooses among DIFFERENT installed prefixes">
      <text x={20} y={24} fill={D.violet} fontSize={10.5} fontWeight={700}>
        1 · Same prefix, several sources → preference picks ONE to install
      </text>
      <DNode x={110} y={70} label="172.16.50.0/24" sub="static" accent={D.cyan} w={150} />
      <DNode x={290} y={70} label="172.16.50.0/24" sub="learned via OSPF" accent={D.faint} w={150} />
      <DArrow x1={370} y1={70} x2={440} y2={70} color={D.violet} />
      <DNode x={530} y={70} label="installed" sub="preferred source" accent={D.violet} w={140} />
      <text x={20} y={134} fill={D.success} fontSize={10.5} fontWeight={700}>
        2 · Different installed prefixes → per packet, the LONGEST match wins
      </text>
      <DNode x={110} y={180} label="/25" accent={D.success} w={80} />
      <DNode x={210} y={180} label="/24" accent={D.muted} w={80} />
      <DNode x={310} y={180} label="/16" accent={D.muted} w={80} />
      <DNode x={410} y={180} label="/0" accent={D.muted} w={80} />
      <text x={464} y={184} fill={D.muted} fontSize={10}>
        ← most specific first
      </text>
    </DiagramSvg>
  );
}

function RecursiveDiagram() {
  return (
    <DiagramSvg h={170} label="General recursive resolution: a route whose next hop is not directly connected is resolved through another route, repeatedly, until a connected route supplies the outgoing interface">
      <DNode x={90} y={60} label="198.51.100.0/24" sub="via 192.0.2.9" accent={D.ip} w={150} />
      <DArrow x1={166} y1={60} x2={226} y2={60} color={D.muted} />
      <DNode x={300} y={60} label="192.0.2.9 ∈ …/28" sub="via 10.0.12.2" accent={D.ip} w={146} />
      <DArrow x1={374} y1={60} x2={434} y2={60} color={D.muted} />
      <DNode x={530} y={60} label="10.0.12.0/30" sub="connected ge-0/0/1" accent={D.success} w={170} />
      <text x={20} y={120} fill={D.text} fontSize={10.5} fontWeight={700}>
        Resolution walks the table until it reaches a connected route (the exit interface).
      </text>
      <text x={20} y={140} fill={D.muted} fontSize={10}>
        This lesson needed one step: 10.0.12.2 is directly on connected 10.0.12.0/30.
      </text>
      <text x={20} y={158} fill={D.muted} fontSize={10}>
        (Example addresses; if any link in the chain disappears, the route stops being usable.)
      </text>
    </DiagramSvg>
  );
}

function EcmpDiagram() {
  return (
    <DiagramSvg h={206} label="Equal-cost multipath: two installed routes for the same prefix with equal preference; the router spreads flows across both next hops, typically by hashing header fields so each flow stays on one path">
      <DNode x={90} y={95} label="R1" sub="10.9.0.0/16 ×2" accent={D.ip} w={120} />
      <DArrow x1={152} y1={85} x2={290} y2={45} color={D.cyan} />
      <DArrow x1={152} y1={105} x2={290} y2={145} color={D.violet} />
      <DNode x={360} y={40} label="next hop A" accent={D.cyan} w={120} />
      <DNode x={360} y={150} label="next hop B" accent={D.violet} w={120} />
      <text x={440} y={86} fill={D.text} fontSize={10}>
        flow hash
      </text>
      <text x={440} y={102} fill={D.muted} fontSize={10}>
        (src/dst IP, ports…)
      </text>
      <text x={20} y={198} fill={D.muted} fontSize={10}>
        Equal prefixes never compete on length — preference decides, and exact ties can share the load.
      </text>
    </DiagramSvg>
  );
}

function SummaryDiagram() {
  return (
    <DiagramSvg h={200} label="Legitimate discard use: a router advertising the summary 172.16.0.0/16 installs 172.16.0.0/16 discard locally; traffic to a more-specific existing subnet follows the longer route, while traffic to an unused part of the summary is dropped instead of looping">
      <DNode x={110} y={50} label="172.16.50.0/24" sub="real subnet → forward" accent={D.success} w={160} />
      <DNode x={110} y={120} label="172.16.60.0/24" sub="real subnet → forward" accent={D.success} w={160} />
      <DNode x={400} y={85} label="172.16.0.0/16" sub="summary · discard" accent={D.warning} w={170} h={50} />
      <DArrow x1={192} y1={50} x2={312} y2={78} color={D.muted} width={1.4} />
      <DArrow x1={192} y1={120} x2={312} y2={92} color={D.muted} width={1.4} />
      <text x={20} y={170} fill={D.text} fontSize={10.5} fontWeight={700}>
        Longer routes still win for real subnets; the /16 discard catches only the unused space.
      </text>
      <text x={20} y={190} fill={D.muted} fontSize={10}>
        That prevents packets for non-existent subnets from bouncing along a default route. The lesson&apos;s /25 was the same tool, misapplied.
      </text>
    </DiagramSvg>
  );
}

function DefaultChainDiagram() {
  return (
    <DiagramSvg h={170} label="Default routes chain hop by hop: each router's default only moves the packet to the next router; somewhere a router must hold a specific route or the packet is dropped">
      {["BRANCH", "R1", "R2", "EDGE"].map((t, i) => (
        <g key={t}>
          <DNode x={80 + i * 160} y={60} label={t} sub={i < 3 ? "0/0 → next" : "specific routes"} accent={i < 3 ? D.warning : D.success} w={120} />
          {i < 3 && <DArrow x1={142 + i * 160} y1={60} x2={178 + i * 160} y2={60} color={D.warning} />}
        </g>
      ))}
      <text x={20} y={120} fill={D.text} fontSize={10.5} fontWeight={700}>
        Every default is just &quot;hand it to the next router&quot;.
      </text>
      <text x={20} y={140} fill={D.muted} fontSize={10}>
        Reachability exists only if some router on the way knows a specific route — and the reply path works too.
      </text>
      <text x={20} y={158} fill={D.muted} fontSize={10}>
        Two routers pointing their defaults at each other bounce a packet until its TTL runs out.
      </text>
    </DiagramSvg>
  );
}

function DynamicDiagram() {
  return (
    <DiagramSvg h={150} label="Dynamic routing: a routing protocol such as OSPF exchanges routes and installs them in the same routing table; the forwarding decision per packet is still longest prefix match">
      <DNode x={100} y={60} label="OSPF / BGP" sub="exchange routes" accent={D.ospf} w={140} />
      <DArrow x1={172} y1={60} x2={262} y2={60} color={D.ospf} />
      <DNode x={330} y={60} label="Routing table" sub="+ connected + static" accent={D.violet} w={130} />
      <DArrow x1={397} y1={60} x2={467} y2={60} color={D.ip} />
      <DNode x={540} y={60} label="Forwarding" sub="longest prefix" accent={D.ip} w={130} />
      <text x={320} y={120} textAnchor="middle" fill={D.muted} fontSize={10}>
        Protocols automate how routes get in. They don&apos;t change how a packet picks one.
      </text>
    </DiagramSvg>
  );
}

// ------------------------------------------------------------------ knowledge check

const QUIZ: KnowledgeQuestion[] = [
  { id: "q1", prompt: `R1 has 172.16.50.0/24 via R2, 172.16.0.0/16 via R3 and 0.0.0.0/0 via R3. Which route carries a packet to ${SC}?`, options: [{ id: "a", label: "172.16.0.0/16 via R3" }, { id: "b", label: "172.16.50.0/24 via R2" }, { id: "c", label: "0.0.0.0/0 via R3" }], correctId: "a", explanation: "The /24 doesn't contain 172.16.60.10 (60 ≠ 50). Of the routes that do, the /16 is longer than the /0." },
  { id: "q2", prompt: "A static /25 discard route is added next to an existing /24 for the same LAN. What happens to the upper half of the LAN?", options: [{ id: "a", label: "Nothing: the /25 only covers .0–.127; .128–.255 still match only the /24" }, { id: "b", label: "It is dropped too" }, { id: "c", label: "It is load-balanced" }], correctId: "a", explanation: "A /25 covers half of the /24. Longest match applies per destination: hosts in the lower half hit the /25, the others still use the /24." },
  { id: "q3", prompt: "HOST-A's ping to SERVER-A times out without any error. The server team sees the requests arrive. Where do you look?", options: [{ id: "a", label: "R2's route back to 10.10.10.0/24" }, { id: "b", label: "R1's route to the server LAN" }, { id: "c", label: "HOST-A's gateway" }], correctId: "a", explanation: "The requests arrived, so the forward path works. A silent loss after delivery is the way back: SERVER-A's gateway R2 needs a route to HOST-A's network." },
  { id: "q4", prompt: "R1's static route says 172.16.50.0/24 via 10.0.12.3. Nobody has that address. What does HOST-A see?", options: [{ id: "a", label: "Destination Host Unreachable from 10.10.10.1" }, { id: "b", label: "Destination Net Unreachable from R2" }, { id: "c", label: "A reply" }], correctId: "a", explanation: "The route is installed (10.0.12.3 is inside a connected network), but R1 can't ARP the next hop, so R1 itself reports Host Unreachable." },
  { id: "q5", prompt: "R1's link to R3 is down. R1's /16 and default point at R3's address. What happens to traffic for SERVER-C?", options: [{ id: "a", label: "R1 has no usable route: Net Unreachable from R1" }, { id: "b", label: "R1 sends it to R2 instead, automatically" }, { id: "c", label: "It is queued until the link returns" }], correctId: "a", explanation: "A static route whose next hop can't be resolved is not installed. Static routing doesn't find alternatives; a routing protocol would." },
  { id: "q6", prompt: "Ping prints Time to live exceeded, and traceroute alternates 10.0.12.2, 10.0.12.1, 10.0.12.2… What is wrong?", options: [{ id: "a", label: "R1 and R2 each route the destination to the other: a loop" }, { id: "b", label: "HOST-A's TTL is too low" }, { id: "c", label: "The server is overloaded" }], correctId: "a", explanation: "Each router's best route points at the other, so the packet bounces until its TTL runs out. Find the route that changed on one of them." },
  { id: "q7", prompt: "Traceroute from HOST-A to SERVER-C shows two routers, but the ping reply arrives with ttl=61. What does that tell you?", options: [{ id: "a", label: "The reply crossed three routers: the return path differs from the forward path" }, { id: "b", label: "The traceroute is wrong" }, { id: "c", label: "SERVER-C starts with a TTL of 63" }], correctId: "a", explanation: "Linux starts at 64, so 64 − 61 = 3 routers on the way back, while traceroute shows the forward path. Each direction follows the tables it meets: an asymmetric path." },
  { id: "q8", prompt: "R1 gets a static 172.16.50.200/32 via R3. Which destinations change path?", options: [{ id: "a", label: "Only 172.16.50.200; the rest of 172.16.50.0/24 still follows the /24" }, { id: "b", label: "The whole server LAN" }, { id: "c", label: "Nothing: the /24 was configured first" }], correctId: "a", explanation: "A /32 contains one address. Longest match picks it for that address only; every other address on the LAN still matches only the /24." },
  { id: "q9", prompt: "On R1 you type ip route 172.16.60.0 255.255.255.0 10.0.23.2, but R1 has no interface on 10.0.23.0/30. Where does traffic for 172.16.60.10 go?", options: [{ id: "a", label: "Still via the /16 to R3: the new route is never installed" }, { id: "b", label: "Via the new /24 to 10.0.23.2" }, { id: "c", label: "It is dropped" }], correctId: "a", explanation: "A next hop must resolve through an up, connected network. 10.0.23.2 doesn't, so the /24 stays hidden (Junos: Unusable) and the next-best match, the /16, keeps carrying the traffic." },
];

// ------------------------------------------------------------------ content

export function RoutingDeepDiveContent() {
  return (
    <div className="space-y-12">
      {/* ------------------------------------------------------------ Foundation */}
      <GuideSection id="rtd-why" eyebrow="Foundation" title="Why routers need tables" tone="ip">
        <p>
          A host only decides local or remote, and hands everything remote to its gateway. A router has to do more: for every destination it must know which neighbor is one step closer. It can&apos;t ask anyone at forwarding time, so it consults a table built in advance: the <Strong>routing table</Strong>. If a destination matches nothing in it, the packet is dropped.
        </p>
        <CompareCards
          items={[
            { title: "A host decides", tone: "cyan", tag: "two choices", points: ["Local: deliver directly", "Remote: hand it to the gateway", "One mask, one default"] },
            { title: "A router decides", tone: "ip", tag: "one of many", points: ["Every destination: which neighbor, which interface", "Many routes, possibly overlapping", "The longest match wins"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="rtd-rib" eyebrow="Foundation" title="RIB and forwarding table" tone="violet">
        <DiagramFrame caption="Where routes come from vs where packets are looked up.">
          <RibFibDiagram />
        </DiagramFrame>
        <p>Routers usually keep a Routing Information Base (every usable route, best per prefix) and program a forwarding table from it. <Mono>show ip route</Mono> and <Mono>show route</Mono> show the RIB, which is enough to reason about forwarding.</p>
      </GuideSection>

      <GuideSection id="rtd-prereq" eyebrow="Foundation" title="What you already know, used at every router" tone="cyan">
        <p>Routing adds one new idea, the routing table, on top of mechanisms earlier lessons already taught. Every forwarding step on this network reuses them:</p>
        <FieldTable
          title="Earlier lessons, inside one routed ping"
          columns={["Lesson", "What it supplies here", "Where you see it"]}
          rows={[
            ["IPv4", "The host's local-or-remote decision and its gateway", "HOST-A hands everything off 10.10.10.0/24 to 10.10.10.1"],
            ["Subnetting", "Prefixes and masks: what a /24, /25, /16 or /0 contains", "Which routes contain a destination"],
            ["ARP", "The next hop's MAC, needed before any frame can leave", "R1 ARPs for 10.0.12.2 before forwarding to R2"],
            ["Switching", "Delivery of each frame within one LAN", "Every link between two devices is its own Layer-2 segment"],
            ["ICMP", "The errors and TTL that report what a router decided", "Net/Host Unreachable, Time exceeded, traceroute"],
          ]}
        />
      </GuideSection>

      {/* ------------------------------------------------------------ The table */}
      <GuideSection id="rtd-sources" eyebrow="The table" title="Connected, local and static routes" tone="cyan">
        <FieldTable
          title="Where each route comes from"
          columns={["Code", "Source", "Comes from", "Goes away when"]}
          rows={[
            ["C / Direct", "Connected", "An interface with an address, up", "The interface goes down"],
            ["L / Local", "Local", "The router's own address on it, as a /32", "Same"],
            ["S / Static", "Static", "An operator's ip route / routing-options static", "Someone deletes it, or its next hop can't be resolved"],
            ["S* / 0.0.0.0/0", "Default", "A static route to 0.0.0.0/0", "Same as any static"],
          ]}
        />
        <div className="grid gap-3 lg:grid-cols-2">
          <CliPanel run={only(cli(HEALTHY, "R1", "cisco", "show ip route"), /last resort|^S|^C|^L/)} />
          <CliPanel run={cli(HEALTHY, "R1", "juniper", "show route protocol static")} />
        </div>
      </GuideSection>

      <GuideSection id="rtd-build" eyebrow="The table" title="Building R1's table, one source at a time" tone="cyan">
        <p>Start R1 with nothing but addressed, up interfaces (the lab&apos;s Build exercise starts here). It knows its three connected networks and nothing else, so HOST-A&apos;s packet for SERVER-A dies at R1 with an honest error:</p>
        <div className="grid gap-3 lg:grid-cols-2">
          <CliPanel run={only(cli(CONNECTED_ONLY, "R1", "cisco", "show ip route"), /last resort|^C|^L|^S/)} />
          <CliPanel run={only(cli(CONNECTED_ONLY, "HOST-A", "cisco", `ping -c 1 ${SA}`), PING)} />
        </div>
        <p>Each static route then adds exactly one fact: &quot;this prefix is behind that neighbor&quot;. With the three statics of the lesson, R1&apos;s table is complete for this network:</p>
        <FieldTable
          title="What each static route adds to R1"
          columns={["Route typed on R1", "Fact it adds", "Destinations it covers"]}
          rows={[
            ["ip route 172.16.50.0 255.255.255.0 10.0.12.2", "The server LAN is behind R2", "172.16.50.0 – 172.16.50.255"],
            ["ip route 172.16.0.0 255.255.0.0 10.0.13.2", "The rest of 172.16.x.x is behind R3", "172.16.0.0 – 172.16.255.255, except where the /24 is more specific"],
            ["ip route 0.0.0.0 0.0.0.0 10.0.13.2", "Anything else: ask R3", "Every address no other route contains"],
          ]}
        />
        <p className="text-sm text-pv-text-muted">R2 and R3 need their own routes, typed separately: R1&apos;s table says nothing about how they reach HOST-A.</p>
      </GuideSection>

      <GuideSection id="rtd-installed" eyebrow="The table" title="Configured is not installed" tone="warning">
        <p>
          A static route is only <Strong>installed</Strong> if its next hop resolves through a connected network that is up. When R1&apos;s link to R3 is down, its /16 and default routes (both via 10.0.13.2) stay in the configuration but vanish from the table. Cisco simply doesn&apos;t show them; Junos lists them as hidden and unusable:
        </p>
        <div className="grid gap-3 lg:grid-cols-2">
          <CliPanel run={only(cli(T("ifdown"), "R1", "cisco", "show ip route static"), /^S|^ +S/)} />
          <CliPanel run={cli(T("ifdown"), "R1", "juniper", "show route hidden")} />
        </div>
        <p>The other way to be unusable: a next hop that was never on a connected network. Type <Mono>ip route 172.16.60.0 255.255.255.0 10.0.23.2</Mono> on R1: 10.0.23.2 is on the R2–R3 link, which R1 isn&apos;t connected to. The route is accepted, never installed, and traffic for SERVER-C keeps following the next-best match, the /16:</p>
        <div className="grid gap-3 lg:grid-cols-2">
          <CliPanel run={cli(NOT_CONNECTED, "R1", "juniper", "show route hidden")} />
          <CliPanel run={cli(NOT_CONNECTED, "R1", "cisco", `show ip route ${SC}`)} />
        </div>
        <Callout tone="warning" title="Read both" icon="!">
          <Mono>show running-config</Mono> (or <Mono>show configuration routing-options</Mono>) shows what was typed; <Mono>show ip route</Mono> shows what is used. A route in the first and not the second is configured but unusable.
        </Callout>
      </GuideSection>

      <GuideSection id="rtd-default" eyebrow="The table" title="Default routes: the gateway of last resort" tone="warning">
        <DiagramFrame caption="Defaults chain; reachability needs a specific route somewhere.">
          <DefaultChainDiagram />
        </DiagramFrame>
        <p>On this network R1&apos;s default goes to R3, and R3 has no default of its own. A destination nobody routes therefore leaves R1 and dies at R3, which says so:</p>
        <CliPanel run={only(cli(HEALTHY, "HOST-A", "cisco", `ping -c 1 ${RN_OUTSIDE}`), PING)} />
      </GuideSection>

      {/* ------------------------------------------------------------ The decision */}
      <GuideSection id="rtd-lpm" eyebrow="The decision" title="Longest prefix match, step by step" tone="warning">
        <FlowSteps
          steps={[
            { title: "Collect", body: "Every installed route whose prefix contains the destination.", tone: "cyan" },
            { title: "Compare lengths", body: "The route with the most fixed bits (the longest prefix) wins. /32 beats /25 beats /24 beats /16 beats /0.", tone: "warning" },
            { title: "Act", body: "Forward to the winner's next hop or interface, or discard if the winner is a discard route.", tone: "success" },
          ]}
        />
        <FieldTable
          title="Lookups on R1 (from the lab)"
          columns={["Destination", "Matching routes", "Winner"]}
          rows={[
            [SA, "/24, /16, /0", "172.16.50.0/24 via 10.0.12.2 (R2)"],
            [SC, "/16, /0", "172.16.0.0/16 via 10.0.13.2 (R3)"],
            [RN_OUTSIDE, "/0", "0.0.0.0/0 via 10.0.13.2 (R3)"],
            [`${SA} (discard ticket)`, "/25, /24, /16, /0", "172.16.50.0/25 discard"],
          ]}
        />
        <div className="grid gap-3 lg:grid-cols-2">
          <CliPanel run={cli(HEALTHY, "R1", "cisco", `show ip route ${SC}`)} />
          <CliPanel run={cli(HEALTHY, "R1", "juniper", `show route ${SA}`)} />
        </div>
      </GuideSection>

      <GuideSection id="rtd-lpmtrace" eyebrow="The decision" title="Watching R1 decide" tone="warning">
        <p>For each destination, every installed route is tested against it. These are R1&apos;s own candidates, computed by the lab&apos;s lookup (its /32 local routes, which match only R1&apos;s own addresses, are left out):</p>
        <div className="grid gap-3 lg:grid-cols-3">
          <FieldTable title={`R1 → ${SA}`} columns={["Route", "Contains it?", "Length"]} rows={lookupRows("R1", SA)} />
          <FieldTable title={`R1 → ${SC}`} columns={["Route", "Contains it?", "Length"]} rows={lookupRows("R1", SC)} />
          <FieldTable title={`R1 → ${RN_OUTSIDE}`} columns={["Route", "Contains it?", "Length"]} rows={lookupRows("R1", RN_OUTSIDE)} />
        </div>
        <Callout tone="warning" title="Display order is not the decision" icon="!">
          <Mono>show ip route</Mono> lists routes by network number, so 0.0.0.0/0 comes first and the /16 before the /24. The router doesn&apos;t read top to bottom and stop: it tests every route and keeps the longest match, wherever it is printed.
        </Callout>
      </GuideSection>

      <GuideSection id="rtd-hostroute" eyebrow="The decision" title="A host route steals exactly one destination" tone="violet">
        <p>A /32 contains a single address, so it beats everything else for that address and nothing more. Add <Mono>ip route 172.16.50.200 255.255.255.255 10.0.13.2</Mono> on R1 (a real lab configuration, shown here from the model): SERVER-B is now reached through R3, which knows the server LAN via R2, while SERVER-A on the same LAN still goes straight to R2:</p>
        <CliPanel run={only(cli(HOST_ROUTE, "R1", "cisco", "show ip route static"), /^S|^ +S/)} />
        <div className="grid gap-3 lg:grid-cols-2">
          <CliPanel run={cli(HOST_ROUTE, "HOST-A", "cisco", `traceroute ${SB}`)} />
          <CliPanel run={cli(HOST_ROUTE, "HOST-A", "cisco", `traceroute ${SA}`)} />
        </div>
        <p className="text-sm text-pv-text-muted">Host routes are how engineers pin one destination to a path (a monitoring server, a test). They are also how a stray change breaks exactly one host, the same shape as fault 1&apos;s /25 discard.</p>
      </GuideSection>

      <GuideSection id="rtd-preference" eyebrow="Two decisions" title="Route preference first, longest prefix per packet" tone="cyan">
        <DiagramFrame caption="Preference compares routes for the SAME prefix. Prefix length compares DIFFERENT prefixes.">
          <PreferenceDiagram />
        </DiagramFrame>
        <p>Preference goes by different names: administrative distance (Cisco, static = 1), route preference (Junos, static = 5). It only decides between sources offering the <em>same</em> prefix. It never lets a /16 beat a /24 for a destination both contain.</p>
      </GuideSection>

      <GuideSection id="rtd-ecmp" eyebrow="Equal candidates" title="Equal prefixes and ECMP" tone="violet">
        <DiagramFrame caption="Same prefix, same preference: both paths can be used.">
          <EcmpDiagram />
        </DiagramFrame>
      </GuideSection>

      {/* ------------------------------------------------------------ Forwarding */}
      <GuideSection id="rtd-recursive" eyebrow="Recursion" title="Next hops that aren't directly connected" tone="arp">
        <DiagramFrame caption="Resolved route by route until a connected network gives the exit.">
          <RecursiveDiagram />
        </DiagramFrame>
        <p>On this network every next hop is one hop away (a /30 neighbor), so resolution is one step: next hop → connected /30 → interface → ARP for the neighbor&apos;s MAC. If the ARP gets no answer, the router reports Host Unreachable (fault 3 below).</p>
      </GuideSection>

      <GuideSection id="rtd-nexthoparp" eyebrow="Forwarding" title="The next hop must answer ARP" tone="arp">
        <p>An installed route only promises an exit interface. The frame still needs the next hop&apos;s MAC, and only ARP can supply it. In fault 3 the route via 10.0.12.3 is installed (that address is inside the connected /30), but nobody owns it. The lab&apos;s capture shows R1 asking, getting no answer, and reporting back:</p>
        <FieldTable title="Capture: HOST-A pings SERVER-B, route via 10.0.12.3" columns={["Point", "Dir", "Frame"]} rows={captureRows(T_TYPO_RUN)} />
        <p className="text-sm text-pv-text-muted">An ARP failure on the next hop turns into ICMP Host Unreachable, from the router that couldn&apos;t build the frame. That is the difference from a missing route (Net Unreachable) and from a discard route (nothing at all).</p>
      </GuideSection>

      <GuideSection id="rtd-perhop" eyebrow="Per hop" title="What each hop changes, and what it keeps" tone="ip">
        <CompareCards
          items={[
            { title: "Changes at every router", tone: "warning", tag: "per hop", points: ["A new Ethernet frame: source = this router, destination = next hop's MAC", "TTL − 1", "Header checksum, recomputed"] },
            { title: "Never changes", tone: "success", tag: "end to end", points: ["Source IPv4 address (no NAT here)", "Destination IPv4 address", "The payload"] },
          ]}
        />
        <CliPanel run={cli(HEALTHY, "HOST-A", "cisco", `traceroute ${SA}`)} />
        <p className="text-sm text-pv-text-muted">Each hop in a traceroute is the interface the probe <em>entered</em> that router on (R2&apos;s ge-0/0/1 here), which is why traceroute addresses are transit addresses.</p>
      </GuideSection>

      <GuideSection id="rtd-trail" eyebrow="Forwarding" title="One ping, every decision" tone="ip">
        <p>Every device on the path makes its own lookup with no knowledge of the others&apos; choices. The lab records each one; here is HOST-A&apos;s ping to SERVER-A, out and back:</p>
        <FieldTable title="Decision trail: HOST-A → SERVER-A and the reply" columns={TRAIL_COLS} rows={trailRows(HEALTHY_PING_A)} />
        <p className="text-sm text-pv-text-muted">Four lookups on the way out, four on the way back, made by four different tables. The reply&apos;s path is not the request&apos;s path reversed: it is whatever SERVER-A&apos;s gateway R2 and then R1 decide for 10.10.10.10.</p>
      </GuideSection>

      <GuideSection id="rtd-return" eyebrow="Both directions" title="The return path is a separate set of decisions" tone="success">
        <p>A reply is a new packet, from the server to HOST-A, and every router on its way looks up 10.10.10.10 in its own table. R2 needs a static route back; R1 delivers on its connected LAN:</p>
        <CliPanel run={cli(HEALTHY, "R2", "cisco", "show ip route 10.10.10.10")} />
        <Callout tone="cyan" title="Testing one direction at a time" icon="→">
          A router&apos;s own ping picks its exit interface&apos;s address as the source, which tests only routes back to that address. <Mono>ping … source &lt;LAN address&gt;</Mono> tests the way back to the LAN, exactly what users need.
        </Callout>
      </GuideSection>

      <GuideSection id="rtd-asym" eyebrow="Both directions" title="Asymmetric paths" tone="success">
        <p>Because each direction is decided separately, the two directions can take different routes. Change R3&apos;s route back to HOST-A&apos;s network to point at R2 instead of R1 (a real lab configuration): requests still go R1 → R3, replies now go R3 → R2 → R1.</p>
        <CliPanel run={cli(ASYM, "R3", "cisco", "show ip route 10.10.10.10")} />
        <div className="grid gap-3 lg:grid-cols-2">
          <CliPanel run={cli(ASYM, "HOST-A", "cisco", `traceroute ${SC}`)} />
          <CliPanel run={only(cli(ASYM, "HOST-A", "cisco", `ping -c 1 ${SC}`), PING)} />
        </div>
        <Callout tone="cyan" title="Read the TTL against the traceroute" icon="→">
          Traceroute shows the forward path: two routers. The reply arrives with ttl=61: 64 minus <em>three</em> routers. The extra router is on the way back. Asymmetry is not a fault by itself, but it means a filter or a broken link on the return path can break traffic the forward path looks perfect for.
        </Callout>
      </GuideSection>

      <GuideSection id="rtd-drops" eyebrow="Drops" title="Four ways a router drops a packet" tone="danger">
        <FieldTable
          title="Same symptom for the user, four different stories"
          columns={["Drop", "What the sender sees", "The router's decision, in the lab"]}
          rows={[
            ["No route", "Destination Net Unreachable, from that router", dropText(pingRun(HEALTHY, "HOST-A", RN_OUTSIDE), "no-route")],
            ["Discard route", "Nothing (silent), unless the platform uses 'reject'", dropText(pingRun(T("discard"), "HOST-A", SA), "discard")],
            ["Next hop unresolved", "Destination Host Unreachable, from that router", dropText(T_TYPO_RUN, "arp-fail")],
            ["TTL expired", "Time to live exceeded, from the router where it died", dropText(pingRun(T("loop"), "HOST-A", SA), "ttl")],
          ]}
        />
      </GuideSection>

      <GuideSection id="rtd-loop" eyebrow="Forwarding" title="Inside a loop: watching the TTL" tone="danger">
        <p>In fault 5, R1 sends the server LAN to R2 and R2&apos;s default sends it back. Each router decides correctly by its own table; together they bounce the packet, and every pass costs one TTL. The lab&apos;s trail of one echo (abridged in the middle):</p>
        <FieldTable title="Decision trail: one echo in the R1–R2 loop" columns={TRAIL_COLS} rows={loopRows()} />
        <p className="text-sm text-pv-text-muted">The TTL is the only thing that ends the loop. The router where it reaches zero reports Time exceeded from its own address; traceroute, which raises the TTL one probe at a time, makes the same bounce visible as alternating hops.</p>
      </GuideSection>

      <GuideSection id="rtd-summary" eyebrow="Summaries" title="Summary routes and legitimate discard routes" tone="warning">
        <DiagramFrame caption="A covering summary plus a local discard is a standard loop-avoidance pattern.">
          <SummaryDiagram />
        </DiagramFrame>
        <Callout tone="warning" title="Vendor names">
          The same idea appears as a &quot;discard&quot; or &quot;blackhole&quot; route, or a route to a null interface (for example <Mono>Null0</Mono>). Some platforms also offer &quot;reject&quot;, which drops the packet and sends ICMP unreachable. In every form the packet stops at this router when that route wins.
        </Callout>
      </GuideSection>

      {/* ------------------------------------------------------------ Operations */}
      <GuideSection id="rtd-ops" eyebrow="Operations" title="Reading routing tables on both vendors" tone="cyan">
        <FieldTable
          title="Same questions, two syntaxes"
          columns={["Question", "Cisco IOS", "Junos"]}
          rows={[
            ["The whole table", <Mono key="1">show ip route</Mono>, <Mono key="2">show route</Mono>],
            ["Only static / connected", <Mono key="3">show ip route static · connected</Mono>, <Mono key="4">show route protocol static · direct</Mono>],
            ["Which route for an address", <Mono key="5">show ip route &lt;ip&gt;</Mono>, <Mono key="6">show route &lt;ip&gt;</Mono>],
            ["Configured routes", <Mono key="7">show running-config | include ip route</Mono>, <Mono key="8">show configuration routing-options</Mono>],
            ["Unusable routes", "(not shown)", <Mono key="9">show route hidden</Mono>],
            ["Add / remove a static", <Mono key="10">ip route P M NH · no ip route P M</Mono>, <Mono key="11">set / delete routing-options static route P/L next-hop NH</Mono>],
          ]}
        />
        <CliPanel run={cli(HEALTHY, "R1", "juniper", "show configuration routing-options")} />
      </GuideSection>

      <GuideSection id="rtd-evidence" eyebrow="Operations" title="Evidence on every layer" tone="cyan">
        <p>A routing problem can hide in five places. Each has its own evidence, and each rules something in or out:</p>
        <FieldTable
          title="Where to look, and what it proves"
          columns={["Evidence", "Command or tool", "Proves"]}
          rows={[
            ["Route table", <Mono key="1">show ip route &lt;ip&gt; · show route &lt;ip&gt;</Mono>, "Which route wins, and its next hop or discard"],
            ["Interfaces", <Mono key="2">show ip interface brief · show interfaces terse</Mono>, "Whether the connected network a next hop depends on is up"],
            ["ARP", <Mono key="3">show ip arp · show arp</Mono>, "Whether the next hop (or final host) answered"],
            ["Capture", "the lab's capture points", "Which interface a packet reached, and what left it"],
            ["Traffic", <Mono key="4">ping · ping … source · traceroute</Mono>, "Both directions, the hops, and the TTL arithmetic"],
          ]}
        />
        <div className="grid gap-3 lg:grid-cols-2">
          <CliPanel run={cli(HEALTHY_PING_A, "R1", "cisco", "show ip arp")} />
          <CliPanel run={cli(HEALTHY, "R1", "juniper", "show interfaces terse")} />
        </div>
      </GuideSection>

      {/* ------------------------------------------------------------ Troubleshooting */}
      <GuideSection id="rtd-signatures" eyebrow="Troubleshooting" title="Failure signatures" tone="danger">
        <FailureSignatures
          items={[
            { tag: "silent", title: "One host on a LAN unreachable, its neighbor fine", tone: "danger", points: ["No error at all", "→ a more specific route (discard) covering that host"] },
            { tag: "return", title: "Requests arrive, replies never come", tone: "warning", points: ["Silent timeout", "→ a missing route back on the far router"] },
            { tag: "!H", title: "Host Unreachable from your own router", tone: "warning", points: ["The route is installed", "→ its next hop doesn't answer ARP (wrong next hop)"] },
            { tag: "!N", title: "Net Unreachable from your own router", tone: "violet", points: ["No usable route", "→ missing route, or a next hop on a down link"] },
            { tag: "TTL", title: "Time to live exceeded", tone: "danger", points: ["traceroute alternates between two routers", "→ a routing loop"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="rtd-workflow" eyebrow="Workflow" title="Troubleshooting a routing problem" tone="danger">
        <TroubleshootingFlow
          steps={[
            { question: "Which destinations fail, from where?", look: "One host, half a subnet, a whole network, everything off-net? The pattern points at a prefix." },
            { question: "Who reports the error, if anyone?", look: "Net Unreachable / Host Unreachable / TTL exceeded name a router; silence means a discard route or the way back." },
            { question: "Look up like the router", look: <>On each router along the path: <Mono>show ip route &lt;destination&gt;</Mono>. Which route wins, and what does it do?</> },
            { question: "Is the winner usable?", look: "Its next hop must be in an up connected network and answer ARP." },
            { question: "Check the way back", look: <>The same lookups for the source address, on every router back. <Mono>ping … source &lt;LAN&gt;</Mono> tests it from a router.</> },
            { question: "Fix the table, then re-test good and bad destinations", look: "Remove or correct the one route; confirm nothing that worked broke." },
          ]}
        />
      </GuideSection>

      <GuideSection id="rtd-backward" eyebrow="Troubleshooting" title="Working backward from a failed destination" tone="danger">
        <p>The first question is never &quot;which router is broken?&quot; but &quot;how far did the traffic get, and which direction failed?&quot;. The lab answers it for every ticket&apos;s own test:</p>
        <FieldTable title="Where each ticket's ping stops (from the lab's model)" columns={["Ticket", "Request arrived?", "Failed leg", "Stopped at", "Why", "ICMP to HOST-A"]} rows={stopRows()} />
        <FlowSteps
          steps={[
            { title: "Arrived, no reply", body: "Look at the destination's gateway and every router back: a missing return route (ticket 2). Its Net Unreachable goes to SERVER-A, the reply's sender, so HOST-A sees nothing.", tone: "warning" },
            { title: "Stopped with an error", body: "The error's source is the router that gave up; its table, interfaces or ARP say why (tickets 3, 4, 5).", tone: "danger" },
            { title: "Stopped in silence", body: "Look for a discard route on the last router that saw the packet (ticket 1).", tone: "violet" },
          ]}
        />
      </GuideSection>

      <GuideSection id="rtd-faults" eyebrow="Troubleshooting" title="The five tickets, step by step" tone="danger">
        <p>Each fault below is one of the Routing Lab&apos;s tickets, reproduced by the lab&apos;s own model; every output is what that device prints at that moment. The first is the lesson&apos;s incident, seen on Junos.</p>
        <FailureWalk
          title="1 · One server gone: a more specific discard route"
          normal={<>R1 reaches the whole server LAN with 172.16.50.0/24 via R2.</>}
          change={<>A static 172.16.50.0/25 discard was left on R1 after a change.</>}
          evidence={
            <>
              <p>SERVER-A (.50) is silent, SERVER-B (.200) answers. On R1 the /25 is the longest match for .50, and Junos says what it does:</p>
              <CliPanel run={cli(T("discard"), "R1", "juniper", `show route ${SA}`)} />
              <CliPanel run={only(cli(T("discard"), "R1", "cisco", "show running-config"), /ip route|Null0|unreachables/)} />
            </>
          }
          next={<>Same LAN, different result: look for a route more specific than the LAN&apos;s. A discard route says nothing: here R1&apos;s Null0 also carries <Mono>no ip unreachables</Mono>, so not even an ICMP error comes back.</>}
          fix={<>Cisco <Mono>no ip route 172.16.50.0 255.255.255.128 Null0</Mono> · Junos <Mono>delete routing-options static route 172.16.50.0/25</Mono>, <Mono>commit</Mono>.</>}
          proof={<>show ip route {SA} picks the /24 via 10.0.12.2, and SERVER-A answers with ttl=62.</>}
        />
        <FailureWalk
          tone="warning"
          title="2 · The server says it replies: no route back"
          normal={<>R2 has 10.10.10.0/24 via R1 (10.0.12.1).</>}
          change={<>R2&apos;s route back to HOST-A&apos;s network is removed.</>}
          evidence={
            <>
              <p>HOST-A&apos;s ping times out; SERVER-A&apos;s capture shows every request and every reply leaving. R2 can&apos;t route the replies. From R1 itself the difference is easy to see: R2 can answer R1&apos;s transit address, but not its LAN address:</p>
              <CliPanel run={only(cli(T("return"), "R2", "cisco", "show ip route static"), /^S|^ +S/)} />
              <CliPanel run={cli(T("return"), "R1", "cisco", `ping ${SA} source 10.10.10.1`)} />
              <CliPanel run={cli(T("return"), "R1", "cisco", `ping ${SA}`)} />
            </>
          }
          next={<>Requests arriving with replies lost points at the far router&apos;s routes to the <em>source</em>. A plain router ping can hide it, because it uses the transit address.</>}
          fix={<>On R2: Cisco <Mono>ip route 10.10.10.0 255.255.255.0 10.0.12.1</Mono> · Junos <Mono>set routing-options static route 10.10.10.0/24 next-hop 10.0.12.1</Mono>, <Mono>commit</Mono>.</>}
          proof={<>R1&apos;s ping sourced from 10.10.10.1 succeeds, and HOST-A&apos;s ping answers with ttl=62.</>}
        />
        <FailureWalk
          title="3 · Since this morning's change: a wrong next hop"
          normal={<>172.16.50.0/24 points at R2&apos;s transit address, 10.0.12.2.</>}
          change={<>The route was retyped with 10.0.12.3, an address in the same /30 that nobody owns.</>}
          evidence={
            <>
              <p>The route is installed (10.0.12.3 is inside a connected network), but R1 can&apos;t ARP it, so R1 reports the failure from its own LAN address:</p>
              <CliPanel run={only(cli(T("typo"), "HOST-A", "cisco", `ping -c 1 ${SB}`), PING)} />
              <CliPanel run={cli(T("typo"), "R1", "cisco", `show ip route ${SB}`)} />
            </>
          }
          next={<>Host Unreachable from your own router: check the winning route&apos;s next hop against the neighbor&apos;s real address (and R1&apos;s ARP table).</>}
          fix={<>Cisco <Mono>no ip route 172.16.50.0 255.255.255.0 10.0.12.3</Mono>, <Mono>ip route 172.16.50.0 255.255.255.0 10.0.12.2</Mono> · Junos: delete the route and set it with next-hop 10.0.12.2, <Mono>commit</Mono>.</>}
          proof={<>show ip route {SB} shows via 10.0.12.2, and SERVER-B answers.</>}
        />
        <FailureWalk
          title="4 · SERVER-C unreachable: routes on a dead link"
          normal={<>R1&apos;s /16 and default point at R3 (10.0.13.2) over the R1–R3 link.</>}
          change={<>R3&apos;s end of that link is shut down. R1&apos;s routes haven&apos;t been touched.</>}
          evidence={
            <>
              <p>HOST-A gets Net Unreachable from R1 straight away. R1&apos;s interface to R3 is down, so both routes via 10.0.13.2 are unusable and SERVER-C matches nothing:</p>
              <CliPanel run={only(cli(T("ifdown"), "R1", "cisco", "show ip interface brief"), /Interface|0\/2/)} />
              <CliPanel run={cli(T("ifdown"), "R1", "cisco", `show ip route ${SC}`)} />
              <CliPanel run={only(cli(T("ifdown"), "R3", "cisco", "show ip interface brief"), /Interface|0\/1/)} />
            </>
          }
          next={<>&quot;The route hasn&apos;t been touched&quot; is true and irrelevant: an untouched static route still depends on its next hop&apos;s link. Junos&apos;s <Mono>show route hidden</Mono> lists both as unusable.</>}
          fix={<>On R3: Cisco <Mono>interface GigabitEthernet0/1</Mono>, <Mono>no shutdown</Mono> · Junos <Mono>delete interfaces ge-0/0/1 disable</Mono>, <Mono>commit</Mono>.</>}
          proof={<>R1 installs the /16 and default again, and HOST-A reaches SERVER-C through R3.</>}
        />
        <FailureWalk
          title="5 · Pings die of old age: a routing loop"
          normal={<>R2 reaches the server LAN through its connected ge-0/0/0.</>}
          change={<>After maintenance, R2&apos;s ge-0/0/0 was left shut, and a default route to R1 was added. With the connected route gone, the default matches the server LAN, and R1 sends it straight back.</>}
          evidence={
            <>
              <p>Ping prints Time to live exceeded; traceroute alternates between R2 and R1 on their shared link:</p>
              <CliPanel run={only(cli(T("loop"), "HOST-A", "cisco", `ping -c 1 ${SA}`), PING)} />
              <CliPanel run={cli(T("loop"), "HOST-A", "cisco", `traceroute ${SA}`)} />
              <CliPanel run={only(cli(T("loop"), "R2", "cisco", "show ip route"), /last resort|^S|^C/)} />
            </>
          }
          next={<>Two routers alternating in a traceroute each think the other is the way. Look for a route that appeared or disappeared on one of them.</>}
          fix={<>Bring R2&apos;s LAN interface back (<Mono>no shutdown</Mono> on Gi0/0) and remove the stray default.</>}
          proof={<>R2 lists 172.16.50.0/24 as connected, and traceroute ends at SERVER-A in three hops.</>}
        />
        <LabBridge label="Troubleshoot them in the Routing Lab">The five tickets, reported as users report them. Look up like the routers, fix the one route, and prove it both ways.</LabBridge>
      </GuideSection>

      <GuideSection id="rtd-prove" eyebrow="Troubleshooting" title="Proving a routing repair" tone="success">
        <ChecklistCard
          tone="success"
          title="The proof"
          mark="✓"
          items={[
            "show ip route <destination> on each router picks the intended route and next hop",
            "The way back is proven too: the reply arrives, or a router ping sourced from the LAN succeeds",
            "The original test works, and destinations that already worked still do",
            "TTL in the reply matches the number of routers (62 from SERVER-A: two routers)",
          ]}
        />
      </GuideSection>

      {/* ------------------------------------------------------------ Beyond */}
      <GuideSection id="rtd-dynamic" eyebrow="Beyond static" title="Where dynamic routing fits" tone="ospf">
        <DiagramFrame caption="Same table, same lookup — protocols just fill it.">
          <DynamicDiagram />
        </DiagramFrame>
        <p>Static routes don&apos;t react to failures (fault 4) and don&apos;t scale. OSPF and BGP (their own lessons in the Enterprise path) learn routes and withdraw them when links fail. The forwarding decision you practiced here stays exactly the same.</p>
      </GuideSection>

      {/* ------------------------------------------------------------ Master it */}
      <GuideSection id="rtd-myths" eyebrow="Master it" title="Common misconceptions" tone="warning">
        <Misconceptions
          items={[
            { myth: "The router reads its table top to bottom and uses the first match.", correction: "It tests every installed route and keeps the longest match. show ip route even prints 0.0.0.0/0 first." },
            { myth: "The default route wins whenever it is configured.", correction: "It is the shortest possible prefix (/0): it only wins when nothing more specific contains the destination." },
            { myth: "Longest prefix means the biggest mask in the table.", correction: "Only among routes that contain the destination. R1's /24 is the longest route it has, yet it plays no part for 172.16.60.10, which it doesn't contain." },
            { myth: "The first router chooses the whole path.", correction: "Each router only picks the next hop. R2 and R3 decide again from their own tables, and nobody plans the way back." },
            { myth: "A configured static route is always used.", correction: "Only if its next hop resolves through an up connected network." },
            { myth: "The default route makes everything reachable.", correction: "It only moves the packet to another router, which needs a specific route of its own." },
            { myth: "If HOST-A can reach the server, the server can reach HOST-A.", correction: "The way back uses other routers' tables. Each direction must be routed." },
            { myth: "A /16 route beats a /24 because it covers more.", correction: "More specific (longer) wins. The /24 beats the /16 for any address both contain." },
            { myth: "A dropped packet always produces an error.", correction: "A discard route drops silently, and a lost reply produces nothing at all." },
            { myth: "Route preference (administrative distance) picks between a /24 and a /16.", correction: "Preference only compares sources for the same prefix; length decides between different prefixes." },
          ]}
        />
      </GuideSection>

      <GuideSection id="rtd-quiz" eyebrow="Master it" title="Knowledge check" tone="success">
        <KnowledgeQuiz questions={QUIZ} />
      </GuideSection>

      <GuideSection id="rtd-explain" eyebrow="Master it" title="Can you explain it?" tone="success">
        <ExplainIt
          items={[
            { q: "How does R1 decide where to send a packet for 172.16.60.10?", a: "It collects every route that contains the address (the /16 and the default), picks the longest (the /16), resolves its next hop 10.0.13.2 through the connected R1–R3 link, ARPs for R3 and forwards on ge-0/0/2." },
            { q: "Why can one server on a LAN be unreachable while its neighbor works?", a: "A route more specific than the LAN's route can cover just part of the LAN. Destinations inside it follow that route (here a discard); the rest follow the LAN route." },
            { q: "Why does HOST-A's ping need routes on routers it never sends to directly?", a: "Every router on the path, both ways, decides from its own table. The reply from SERVER-A depends on R2's route back to HOST-A's network." },
            { q: "Why can a route be in the table and forwarding still fail?", a: "The route only names an exit and a next hop. The frame still needs the next hop's MAC from ARP; if nobody answers (a mistyped next hop, a dead neighbor), the router can't build the frame and reports Host Unreachable." },
            { q: "How do you find where a failed ping stops?", a: "Ask how far it got and which direction failed: an error names the router that gave up; silence after delivery points at the way back; silence before delivery points at a discard route or a filter on the last router that saw it." },
            { q: "What's the difference between Net Unreachable and Host Unreachable from R1?", a: "Net: R1 has no usable route for the destination. Host: R1 has a route but can't reach its next hop (or the final host) with ARP." },
            { q: "Why does a static route stop working when an unrelated-looking interface goes down?", a: "Its next hop is only reachable through that interface's connected network. When the interface goes down, the next hop can't be resolved and the route is withdrawn from the table." },
          ]}
        />
      </GuideSection>

      <GuideSection id="rtd-practice" eyebrow="Master it" title="Practice in the Routing Lab" tone="cyan">
        <ChecklistCard
          tone="cyan"
          title="In the lab you will"
          mark="→"
          items={["Read R1, R2 and R3's tables in Cisco IOS or Junos", "Predict the longest match for any destination, then check it", "Build every static route from a connected-only start", "Trace packets hop by hop and both ways", "Solve the five tickets and prove each repair"]}
        />
        <LabBridge label="Open the Routing Lab">Same network, your own copy. Nothing you do there changes your lesson progress.</LabBridge>
      </GuideSection>
    </div>
  );
}
