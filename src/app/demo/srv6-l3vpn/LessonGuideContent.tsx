import { Callout, ChecklistCard, CompareCards, DArrow, DIAGRAM as D, DNode, DPill, DiagramFrame, DiagramSvg, FailureSignatures, FieldTable, Glossary, GuideSection, Mono, TroubleshootingFlow } from "@/components/lesson/GuideBlocks";
import { DHeaderColumn, Srv6Topology, type Srv6Pos } from "@/components/lesson/Srv6GuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { PracticeBridge } from "@/components/lesson/GuideInteractive";
import { usePracticeLabOpener } from "@/components/lesson/FundamentalsLessonShell";
import { PresentationBridge } from "@/components/presentation/LessonPresentation";
import { CliPanel, pickLines, runGuideCli } from "@/components/lesson/GuideCli";
import { createSvNet, svApply, svTicket, svTicketState, type Src, type SvAction, type SvR, type SvRtr, type SvState, type SvTicketId } from "@/lib/sim-engine/scenarios/svNet";
import { svSets, svStaticApi } from "./sv-lab/svCli";

export const SRV6L_LESSON_SECTIONS: LessonGuideSectionLink[] = [
  { id: "vl-mission", label: "What this lesson teaches" },
  { id: "vl-network", label: "The network of this lesson" },
  { id: "vl-ideas", label: "Three ideas you need" },
  { id: "vl-watch", label: "What you will watch" },
  { id: "vl-vrf", label: "Two customers, one core" },
  { id: "vl-identities", label: "Two addresses per PE" },
  { id: "vl-route", label: "A customer route becomes a VPN route" },
  { id: "vl-sid", label: "The service SID" },
  { id: "vl-install", label: "PE1's three checks" },
  { id: "vl-packet", label: "One packet, CE1 to CE2" },
  { id: "vl-shared", label: "One SID, two sites" },
  { id: "vl-v6", label: "IPv6: its own family" },
  { id: "vl-policy", label: "With an SRv6 policy, briefly" },
  { id: "vl-working", label: "What working looks like" },
  { id: "vl-incident", label: "The broken-service incident" },
  { id: "vl-repair", label: "Repair and proof" },
  { id: "vl-other", label: "Other ways it breaks" },
  { id: "vl-model", label: "Mental model" },
  { id: "vl-glossary", label: "Glossary" },
  { id: "vl-recap", label: "Recap" },
  { id: "vl-practice", label: "Practice it" },
];

/** Real IOS XR output and ping results on this page come from the SRv6 L3VPN Lab. */
const NL = String.fromCharCode(10);
const V0: SvState = createSvNet(0);
const run = (s: SvState, ...a: SvAction[]) => a.reduce((acc, x) => svApply(acc, x), s);
const ping = (src: Src, to: string): SvAction => ({ type: "ping", src, to });
export const svSet = (text: string, dev: SvR, f: (c: SvRtr) => void): SvAction => ({ type: "set", text, changes: [{ dev, f }] });
export const svTicketRun = (id: SvTicketId) => svTicket(id).repro.reduce((acc, a) => svApply(acc, a), svTicketState(id, 1));
const CE1 = { ce: "CE1" } as const;
const P_A = run(V0, ping(CE1, "10.20.1.10"));
const P_B = run(V0, ping({ ce: "CE4" }, "10.20.1.10"));
const P_LEAK = run(V0, ping({ ce: "CE4" }, "10.20.2.10"));
const P_CE3 = run(V0, ping(CE1, "10.20.2.10"));
const P_V6 = run(V0, ping(CE1, "2001:db8:ca:20::a"));
const INC = svTicketRun("locator");
const INC_FIX = run(INC, svSet("restore locator", "PE2", (c) => void (c.isisLoc = true)), ping(CE1, "10.20.1.10"), ping(CE1, "2001:db8:ca:20::a"));
const INC_V6 = run(INC, ping(CE1, "2001:db8:ca:20::a"));
export function svCli(s: SvState, r: SvR, command: string) {
  return runGuideCli(svSets(svStaticApi(s, r), r).cisco, command);
}
export function svOnly(s: SvState, r: SvR, command: string, match: RegExp, keep = 0) {
  const x = svCli(s, r, command);
  return { ...x, output: pickLines(x.output, match, keep) };
}
/** Matching lines, each with the `after` lines that follow it (two-line IOS XR route entries). */
export function svWith(s: SvState, r: SvR, command: string, match: RegExp, after = 1) {
  const x = svCli(s, r, command);
  const lines = x.output.split(NL);
  const keep = new Set<number>();
  lines.forEach((l, i) => {
    if (match.test(l)) for (let k = 0; k <= after; k++) keep.add(i + k);
  });
  return { ...x, output: lines.filter((_l, i) => keep.has(i)).join(NL) };
}
/** Lines from the first match of `from` up to (not including) the first later match of `stop`. */
export function svBlock(s: SvState, r: SvR, command: string, from: RegExp, stop?: RegExp) {
  const x = svCli(s, r, command);
  const lines = x.output.split(NL);
  const i = lines.findIndex((l) => from.test(l));
  if (i < 0) return x;
  let j = stop ? lines.findIndex((l, k) => k > i && stop.test(l)) : -1;
  if (j < 0) j = lines.length;
  return { ...x, output: lines.slice(i, j).join(NL) };
}
/** One ping, as the lab reports it (the last one of the state). */
export function SvResult({ s, title, i }: { s: SvState; title: string; i?: number }) {
  const t = s.tests[i ?? s.tests.length - 1];
  return (
    <Callout tone={t.ok ? "success" : "danger"} title={title} icon={t.ok ? "✓" : "!"}>
      {t.src} → {t.to}: {t.ok ? `success, answered by ${t.deliveredTo}` : t.why}
      {t.fwd.sid ? ` · service SID ${t.fwd.sid} (${t.fwd.behavior})` : ""} · request {t.fwd.path.join(" → ")}
    </Callout>
  );
}

function LessonLabBridge() {
  const openLab = usePracticeLabOpener();
  return (
    <PracticeBridge label="Open the SRv6 L3VPN Lab" onPractice={openLab}>
      The network of this lesson on IOS XR with a second customer: VRFs, VPNv4/VPNv6 routes and service SIDs on every PE, RR1 and the CEs in their own windows, pings between any sites — your own copy. Nothing you do there changes your lesson progress.
    </PracticeBridge>
  );
}

const POS: Srv6Pos = {
  CE1: [50, 140],
  PE1: [160, 140],
  P1: [280, 140],
  P2: [400, 140],
  PE2: [515, 140],
  CE2: [595, 85],
  CE3: [595, 195],
};

function TopologyDiagram() {
  return (
    <DiagramSvg h={250} label="CE1 behind PE1; PE1, P1, P2 and PE2 form a plain IPv6 core; CE2 and CE3 behind PE2; RR1 above reflects MP-BGP VPN routes between PE1 and PE2 and never carries customer traffic">
      <line x1={160} y1={123} x2={320} y2={50} stroke={D.bgp} strokeWidth={1.5} strokeDasharray="5 4" />
      <line x1={515} y1={123} x2={360} y2={50} stroke={D.bgp} strokeWidth={1.5} strokeDasharray="5 4" />
      <DNode x={340} y={36} label="RR1" sub="MP-BGP only" accent={D.bgp} w={110} h={38} />
      <Srv6Topology
        pos={POS}
        links={[
          { a: "CE1", b: "PE1" },
          { a: "PE1", b: "P1", label: "IPv6", color: D.ip },
          { a: "P1", b: "P2", label: "IPv6", color: D.ip },
          { a: "P2", b: "PE2", label: "IPv6", color: D.ip },
          { a: "PE2", b: "CE2" },
          { a: "PE2", b: "CE3" },
        ]}
        sub={{ CE1: "10.10.1/24", PE1: "CUST-A", P1: "transit", P2: "transit", PE2: "CUST-A", CE2: "10.20.1/24", CE3: "10.20.2/24" }}
        accent={{ PE1: D.violet, PE2: D.violet, P1: D.faint, P2: D.faint, CE1: D.success, CE2: D.success, CE3: D.success }}
        boxW={70}
      />
      <text x={320} y={242} textAnchor="middle" fill={D.muted} fontSize={10}>
        no MPLS anywhere · dashed = MP-BGP sessions via RR1 (control plane only)
      </text>
    </DiagramSvg>
  );
}

function IdentitiesDiagram() {
  return (
    <DiagramSvg h={190} label="PE2 has a BGP infrastructure loopback 2001:db8:ffff::2 used as BGP next hop, and a separate SRv6 locator 2001:db8:100:2::/64 from which its Service SIDs End.DT4 and End.DT6 are built">
      <DNode x={320} y={34} label="PE2" accent={D.violet} w={120} h={36} />
      <DArrow x1={280} y1={52} x2={170} y2={88} color={D.faint} width={1.4} />
      <DArrow x1={360} y1={52} x2={470} y2={88} color={D.faint} width={1.4} />
      <DNode x={160} y={112} label="infra loopback" sub="2001:db8:ffff::2" accent={D.bgp} w={200} />
      <DNode x={480} y={112} label="SRv6 locator" sub="2001:db8:100:2::/64" accent={D.ip} w={200} />
      <text x={160} y={160} textAnchor="middle" fill={D.muted} fontSize={10}>
        BGP session + BGP next hop
      </text>
      <DPill x={420} y={162} text=":2:13:: DT4" color={D.warning} w={104} />
      <DPill x={540} y={162} text=":2:12:: DT6" color={D.warning} w={104} />
    </DiagramSvg>
  );
}

function RouteDiagram() {
  return (
    <DiagramSvg h={220} label="PE2's MP-BGP VPN UPDATE for 10.20.1.0/24: NLRI RD 65000:2 plus prefix, RT 65000:100, next hop 2001:db8:ffff::2, Prefix-SID attribute with SRv6 L3 Service TLV carrying 2001:db8:100:2:13:: End.DT4">
      <DHeaderColumn
        x={360}
        y={20}
        w={340}
        rowH={22}
        rows={[
          { text: "NLRI = 65000:2 : 10.20.1.0/24", color: D.bgp, tag: "RD:prefix" },
          { text: "Extended Community RT 65000:100", color: D.bgp, tag: "RT" },
          { text: "NEXT_HOP = 2001:db8:ffff::2", color: D.bgp, tag: "next hop" },
          { text: "Prefix-SID → SRv6 L3 Service TLV", color: D.warning, tag: "Prefix-SID" },
          { text: "Service SID 2001:db8:100:2:13:: · End.DT4", color: D.warning, tag: "SID", strong: true },
        ]}
      />
      <text x={320} y={172} textAnchor="middle" fill={D.muted} fontSize={10}>
        one UPDATE carries both the next hop (reachability) and the Service SID (egress instruction)
      </text>
      <text x={320} y={190} textAnchor="middle" fill={D.muted} fontSize={10}>
        no MPLS VPN label field is used for the SID in this model (transposition is off)
      </text>
    </DiagramSvg>
  );
}

function InstallDiagram() {
  const steps = [
    { t: "RT import", c: D.bgp },
    { t: "next hop resolves", c: D.ospf },
    { t: "Service SID resolves", c: D.warning },
    { t: "installed in CUST-A", c: D.success },
  ];
  return (
    <DiagramSvg h={110} label="PE1 installs a received VPN route only after RT import, BGP next-hop resolution and Service SID resolution all pass">
      {steps.map((s, i) => (
        <g key={s.t}>
          <DPill x={82 + i * 158} y={40} text={s.t} color={s.c} w={148} />
          {i < steps.length - 1 && <DArrow x1={157 + i * 158} y1={40} x2={165 + i * 158} y2={40} color={D.faint} width={1.2} />}
        </g>
      ))}
      <text x={320} y={90} textAnchor="middle" fill={D.muted} fontSize={10}>
        each check is independent — passing one says nothing about the next
      </text>
    </DiagramSvg>
  );
}

function DataPlaneDiagram() {
  const cols = [
    { x: 68, w: 120, head: "CE1 → PE1", rows: [{ text: "IPv4 → 10.20.1.10", color: D.ip }] },
    { x: 248, w: 180, head: "PE1 → P1 → P2 → PE2", rows: [{ text: "DA = 2001:db8:100:2:13::", color: D.warning, strong: true }, { text: "no SRH", color: D.faint }, { text: "IPv4 → 10.20.1.10", color: D.ip }] },
    { x: 430, w: 140, head: "PE2 End.DT4", rows: [{ text: "decap · table CUST-A", color: D.violet }, { text: "10.20.1.0/24 → CE2", color: D.success }] },
    { x: 578, w: 116, head: "PE2 → CE2", rows: [{ text: "IPv4 → 10.20.1.10", color: D.ip }] },
  ];
  return (
    <DiagramSvg h={170} label="CE1 sends plain IPv4; PE1 looks it up in CUST-A and encapsulates with outer DA PE2's End.DT4 Service SID and no SRH; P1 and P2 forward by plain IPv6; PE2 decapsulates, looks up CUST-A and delivers to CE2">
      {cols.map((c, i) => (
        <g key={c.head}>
          <text x={c.x} y={20} textAnchor="middle" fill={D.text} fontSize={10.5} fontWeight={700}>
            {c.head}
          </text>
          <DHeaderColumn x={c.x} y={32} w={c.w} rows={c.rows} />
          {i < cols.length - 1 && <DArrow x1={c.x + c.w / 2 + 3} y1={43} x2={cols[i + 1].x - cols[i + 1].w / 2 - 3} y2={43} color={D.faint} width={1.2} />}
        </g>
      ))}
      <text x={320} y={140} textAnchor="middle" fill={D.muted} fontSize={10}>
        P1 and P2 see only an IPv6 DA inside PE2&apos;s locator — no CUST-A, RD, RT or End.DT4 state
      </text>
    </DiagramSvg>
  );
}

function PolicyPreviewDiagram() {
  return (
    <DiagramSvg h={160} label="Policy-steered preview: outer DA P1 End.X, SRH with Segment List 0 PE2 End.DT4 and 1 P1 End.X, SL 1; the Service SID stays the final segment">
      <DHeaderColumn
        x={200}
        y={24}
        w={250}
        rows={[
          { text: "DA = 2001:db8:100:11:2:: (P1 End.X)", color: D.warning, strong: true },
          { text: "SRH · SL 1 · LE 1", color: D.violet },
          { text: "[0] PE2 End.DT4 (Service SID)", color: D.violet },
          { text: "[1] P1 End.X", color: D.violet },
          { text: "inner customer packet", color: D.ip },
        ]}
      />
      <text x={440} y={50} fill={D.text} fontSize={11} fontWeight={700}>
        transport segment first,
      </text>
      <text x={440} y={66} fill={D.text} fontSize={11} fontWeight={700}>
        service SID last
      </text>
      <text x={440} y={92} fill={D.muted} fontSize={10}>
        read-only preview — the lesson&apos;s
      </text>
      <text x={440} y={106} fill={D.muted} fontSize={10}>
        real packets use one Service SID
      </text>
      <text x={440} y={120} fill={D.muted} fontSize={10}>
        and no SRH
      </text>
    </DiagramSvg>
  );
}


export function Srv6L3vpnLessonGuideContent() {
  return (
    <div className="space-y-12">
      <GuideSection id="vl-mission" eyebrow="This lesson" title="What this lesson teaches" tone="ip">
        <p>
          The SRv6 lessons so far moved packets between routers. A provider sells something else: private networks for its customers, all sharing one core. This lesson builds that service — a Layer-3 VPN — on SRv6. The VPN itself (VRFs, route distinguishers, route targets, BGP) is the same one MPLS networks use. What changes is the instruction the egress PE gives the ingress PE: no VPN label, but an SRv6 <b className="text-pv-text">service SID</b>.
        </p>
        <p>You will follow one customer route from PE2 to PE1 through BGP, then one customer packet from CE1 to CE2 through the core, see how two customers with the same addresses stay apart, and end with the guided lesson&apos;s incident: everything in BGP looks healthy, and nothing gets through.</p>
        <ChecklistCard tone="violet" title="By the end of this lesson you can" mark="→" items={["explain what an SRv6 L3VPN is and what CE, PE and P routers do", "follow a customer route through the control plane: VRF → VPN route → RR → import", "follow a customer packet through the data plane: lookup → encapsulation → core → End.DT4 → CE", "say what a service SID causes at the egress PE", "tell transport and BGP-next-hop health apart from service health", "find, fix and prove a VPN fault with real evidence"]} />
      </GuideSection>

      <GuideSection id="vl-network" eyebrow="This lesson" title="The network of this lesson" tone="cyan">
        <DiagramFrame caption="The guided lesson's network: CE1 — PE1 — P1 — P2 — PE2 — CE2 / CE3.">
          <TopologyDiagram />
        </DiagramFrame>
        <p>
          Customer <b className="text-pv-text">CUST-A</b> has a head office behind CE1 (10.10.1.0/24, 2001:db8:ca:10::/64) and a second site behind PE2 with two routers: CE2 (10.20.1.0/24) and CE3 (10.20.2.0/24), dual-stack. P1 and P2 form an IPv6 core running IS-IS. Route reflector RR1 hangs off P1 and carries the BGP routes between the PEs.
        </p>
        <Callout tone="cyan" title="The lesson and the lab" icon="i">
          The guided lesson writes PE2&apos;s service SIDs by hand — End.DT4 <Mono>2001:db8:100:2:13::</Mono>, End.DT6 <Mono>…:2:12::</Mono> — and has one customer. The lab runs IOS XR, whose BGP allocates service SIDs dynamically after End and End.X: End.DT4 <Mono>…:2:41::</Mono>, End.DT6 <Mono>…:2:42::</Mono>. It also adds a second customer, <b className="text-pv-text">CUST-B</b> (CE4 at PE1, CE5 at PE2), with exactly the same IPv4 addresses as CUST-A&apos;s CE1 and CE2, and a spare CUST-A site, CE6. Same design, same decisions; the outputs below come from the lab.
        </Callout>
      </GuideSection>

      <GuideSection id="vl-ideas" eyebrow="This lesson" title="Three ideas you need" tone="violet">
        <CompareCards
          items={[
            { title: "VRF", tone: "violet", tag: "separation", points: ["one routing table per customer on each PE", "the ingress interface picks it"] },
            { title: "VPN route", tone: "bgp", tag: "control plane", points: ["RD · RT · next hop · service SID", "carried by BGP (VPNv4 / VPNv6)"] },
            { title: "Service SID", tone: "cyan", tag: "data plane", points: ["the packet's outer destination", "End.DT4/DT6: decapsulate, look up in the VRF"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="vl-watch" eyebrow="This lesson" title="What you will watch" tone="cyan">
        <TroubleshootingFlow
          steps={[
            { question: "PE2 learns 10.20.1.0/24 from CE2", look: "a static route in VRF CUST-A" },
            { question: "PE2 advertises it as a VPN route", look: "65000:2:10.20.1.0/24, RT 65000:100, next hop 2001:db8:ffff::2, SID …:2:41::" },
            { question: "RR1 reflects it; PE1 imports and installs it", look: "RT matches; next hop and SID reachable" },
            { question: "CE1 sends to 10.20.1.10", look: "PE1 looks it up in CUST-A and encapsulates to the SID" },
            { question: "P1 and P2 route the outer packet", look: "toward PE2's locator 2001:db8:100:2::/64" },
            { question: "PE2 executes End.DT4", look: "decapsulate, look up in CUST-A, deliver to CE2" },
          ]}
        />
      </GuideSection>

      <GuideSection id="vl-vrf" eyebrow="Separation" title="Two customers, one core" tone="violet">
        <p>
          Each PE keeps one table per customer — a <b className="text-pv-text">VRF</b>. A packet&apos;s VRF is decided by the interface it arrives on: CE1&apos;s port is in CUST-A, CE4&apos;s in CUST-B. Both customers use 10.10.1.0/24 and 10.20.1.0/24; in each VRF those prefixes point to that customer&apos;s own sites.
        </p>
        <CliPanel run={svCli(V0, "PE1", "show vrf all")} caption="IOS XR · PE1 — two VRFs, their RDs and route targets" />
        <SvResult s={P_A} title="The lab: CE1 (CUST-A) pings 10.20.1.10" />
        <SvResult s={P_B} title="The lab: CE4 (CUST-B) pings 10.20.1.10" />
        <SvResult s={P_LEAK} title="The lab: CE4 pings CUST-A's 10.20.2.10" />
        <p>Same destination, two different answers, and no way across. The P routers never see any of these addresses.</p>
      </GuideSection>

      <GuideSection id="vl-identities" eyebrow="Setup" title="Two addresses per PE" tone="ospf">
        <DiagramFrame caption="The BGP identity and the SRv6 locator are separate prefixes.">
          <IdentitiesDiagram />
        </DiagramFrame>
        <p>
          Every PE has a <b className="text-pv-text">loopback</b> (PE2: <Mono>2001:db8:ffff::2</Mono>) — its BGP identity and the next hop of its VPN routes — and an SRv6 <b className="text-pv-text">locator</b> (PE2: <Mono>2001:db8:100:2::/64</Mono>) from which all its SIDs are taken. IS-IS advertises both, but separately: the locator only with <Mono>segment-routing srv6 locator MAIN</Mono>. Keep that in mind for the incident.
        </p>
        <CliPanel run={svWith(V0, "PE1", "show route ipv6", /2001:db8:ffff::2\/128|2001:db8:100:2::\/64/)} caption="IOS XR · PE1 — PE2's loopback and PE2's locator, two routes" />
      </GuideSection>

      <GuideSection id="vl-route" eyebrow="Control plane" title="A customer route becomes a VPN route" tone="bgp">
        <DiagramFrame caption="The guided lesson builds the route field by field.">
          <RouteDiagram />
        </DiagramFrame>
        <p>
          PE2 has a static route in CUST-A toward CE2 and <Mono>redistribute static</Mono> in BGP. The route leaves as a VPNv4 route: <b className="text-pv-text">RD</b> <Mono>65000:2</Mono> makes it unique (CUST-B&apos;s 10.20.1.0/24 uses 65000:12), <b className="text-pv-text">RT</b> <Mono>65000:100</Mono> says which VRFs may import it, the <b className="text-pv-text">next hop</b> is PE2&apos;s loopback. RR1 reflects it to PE1.
        </p>
        <CliPanel run={svOnly(V0, "PE1", "show bgp vpnv4 unicast rd 65000:2 10.20.1.0/24", /entry for|2001:db8:ffff::2 \(metric|community|Originator|Sid:/)} caption="IOS XR · PE1 — the VPN route as received: RT, next hop via RR1, service SID" />
      </GuideSection>

      <GuideSection id="vl-sid" eyebrow="Control plane" title="The service SID" tone="cyan">
        <p>
          The Prefix-SID attribute carries the SRv6 service SID: <Mono>2001:db8:100:2:41::</Mono>, <b className="text-pv-text">End.DT4</b> bound to VRF CUST-A. In MPLS that slot was a VPN label. Here it is a real IPv6 address: routable through the core (it lives in PE2&apos;s locator), and executable at PE2 (decapsulate, look up in CUST-A).
        </p>
        <CliPanel run={svCli(V0, "PE2", "show segment-routing srv6 sid")} caption="IOS XR · PE2 — End and End.X from IS-IS, one End.DT4/End.DT6 per VRF and family from BGP" />
        <p>One SID per VRF and family (<Mono>alloc mode per-vrf</Mono>): CUST-A IPv4, CUST-A IPv6 and CUST-B IPv4 each have their own.</p>
      </GuideSection>

      <GuideSection id="vl-install" eyebrow="Control plane" title="PE1's three checks" tone="warning">
        <DiagramFrame caption="Received is not installed.">
          <InstallDiagram />
        </DiagramFrame>
        <p>
          Before PE1 puts 10.20.1.0/24 in CUST-A it checks three independent things: the <b className="text-pv-text">RT</b> matches one of CUST-A&apos;s import RTs; the <b className="text-pv-text">next hop</b> 2001:db8:ffff::2 is reachable; the <b className="text-pv-text">SID</b>&apos;s locator 2001:db8:100:2::/64 is reachable. All three pass, so the route is installed, pointing at the SID.
        </p>
        <CliPanel run={svOnly(V0, "PE1", "show route vrf CUST-A", /^[BS]\s/)} caption="IOS XR · PE1 — CUST-A: CE1's LAN (static) and site 2's prefixes (BGP via PE2's loopback)" />
      </GuideSection>

      <GuideSection id="vl-packet" eyebrow="Data plane" title="One packet, CE1 to CE2" tone="ip">
        <DiagramFrame caption="The guided lesson's packet: no SRH, the service SID is the outer destination.">
          <DataPlaneDiagram />
        </DiagramFrame>
        <p>
          A host behind CE1 pings 10.20.1.10. CE1 sends an ordinary IPv4 packet to PE1. PE1 looks it up in CUST-A, finds the SID, and encapsulates: a new IPv6 header with destination <Mono>2001:db8:100:2:41::</Mono> and source PE1&apos;s loopback (H.Encaps.Red — one SID needs no Segment Routing Header). P1 and P2 route on the destination like any IPv6 packet: it falls in PE2&apos;s locator. PE2 finds the SID in its table, removes the outer header and looks 10.20.1.10 up in CUST-A: CE2. The reply makes the same trip back to PE1&apos;s own End.DT4, <Mono>…:1:41::</Mono>.
        </p>
        <CliPanel run={svCli(V0, "PE1", "show cef vrf CUST-A 10.20.1.10")} caption="IOS XR · PE1 — what PE1 will push for 10.20.1.10" />
        <CliPanel run={svWith(V0, "P1", "show route ipv6", /2001:db8:100:2::\/64|2001:db8:ffff::2\/128/)} caption="IOS XR · P1 — all a P router needs: PE2's locator (and loopback)" />
        <SvResult s={P_A} title="The lab: CE1 → 10.20.1.10" />
      </GuideSection>

      <GuideSection id="vl-shared" eyebrow="Data plane" title="One SID, two sites" tone="success">
        <p>CE3&apos;s 10.20.2.0/24 is advertised with the same SID. Packets to CE2 and to CE3 arrive at PE2 with the same destination; the CUST-A lookup after decapsulation picks the CE. A per-VRF SID never names a CE — the table does.</p>
        <SvResult s={P_CE3} title="The lab: CE1 → 10.20.2.10" />
        <p className="text-sm text-pv-text-muted">The alternative, <Mono>alloc mode per-ce</Mono>, gives each CE its own End.DX4: decapsulate and send straight to that CE, no lookup. The lab lets you switch.</p>
      </GuideSection>

      <GuideSection id="vl-v6" eyebrow="Data plane" title="IPv6: its own family" tone="ip">
        <p>CUST-A&apos;s IPv6 routes travel as VPNv6 routes, negotiated separately on each BGP session, with PE2&apos;s <b className="text-pv-text">End.DT6</b> <Mono>…:2:42::</Mono>. The two families share the VRF and the core, and nothing else: each can work, or fail, on its own.</p>
        <CliPanel run={svOnly(V0, "PE1", "show bgp vpnv6 unicast rd 65000:2 2001:db8:ca:20::/64", /entry for|community|Sid:/)} caption="IOS XR · PE1 — the VPNv6 route and its End.DT6" />
        <SvResult s={P_V6} title="The lab: CE1 → 2001:db8:ca:20::a" />
      </GuideSection>

      <GuideSection id="vl-policy" eyebrow="Briefly" title="With an SRv6 policy, briefly" tone="violet">
        <DiagramFrame caption="The guided lesson's preview: transport segments first, the service SID last.">
          <PolicyPreviewDiagram />
        </DiagramFrame>
        <p>Everything here follows the IGP&apos;s shortest path, so one SID is enough. If PE2 colored the route and PE1 had a matching SR policy (the previous lesson), PE1 would push the policy&apos;s SIDs first and the service SID last — the transport changes, the service instruction doesn&apos;t. The lab keeps to the shortest path.</p>
      </GuideSection>

      <GuideSection id="vl-working" eyebrow="Evidence" title="What working looks like" tone="success">
        <FieldTable
          title="Healthy, in six questions (IOS XR)"
          accent="success"
          columns={["Question", "Command", "Healthy answer"]}
          rows={[
            ["Does the egress PE have the customer route?", <Mono key="1">show route vrf CUST-A (PE2)</Mono>, "S 10.20.1.0/24 via 192.168.22.2"],
            ["Is it a VPN route with a SID?", <Mono key="2">show bgp vpnv4 unicast rd 65000:2 10.20.1.0/24</Mono>, "RT 65000:100, Sid …:2:41::, End.DT4"],
            ["Do the sessions carry the family?", <Mono key="3">show bgp vpnv4 unicast summary</Mono>, "RR1 Established, prefixes received"],
            ["Is it installed at the ingress?", <Mono key="4">show route vrf CUST-A (PE1)</Mono>, "B 10.20.1.0/24 via 2001:db8:ffff::2"],
            ["Is the SID reachable?", <Mono key="5">show route ipv6 2001:db8:100:2:41::</Mono>, "via isis, 2001:db8:100:2::/64"],
            ["Does it work?", "ping from CE1", "answered by CE2 — both directions"],
          ]}
        />
      </GuideSection>

      <GuideSection id="vl-incident" eyebrow="Incident" title="The broken-service incident" tone="danger">
        <p>
          After an IS-IS change on PE2, CE1 can no longer reach site 2 — IPv4 or IPv6. The NOC says BGP to RR1 is Established, the VPN routes are there, and PE2&apos;s loopback answers pings. All true. In the guided lesson PE2&apos;s locator is withdrawn from the IGP; in the lab the cause is concrete: PE2&apos;s IS-IS lost <Mono>segment-routing srv6 locator MAIN</Mono>.
        </p>
        <SvResult s={INC} i={0} title="The lab: CE1 → 10.20.1.10 (the ticket)" />
        <SvResult s={INC_V6} title="The lab: CE1 → 2001:db8:ca:20::a" />
        <TroubleshootingFlow
          steps={[
            { question: "Is the VPN route at PE1, with its SID?", look: "Yes — RT 65000:100, next hop 2001:db8:ffff::2, Sid …:2:41::." },
            { question: "Is it in VRF CUST-A?", look: "No — only CE1's own routes are there." },
            { question: "Is the next hop reachable?", look: "Yes — PE2's loopback is in the IPv6 table and answers pings." },
            { question: "Is the SID reachable?", look: "No — there is no route to 2001:db8:100:2:41::: the locator is gone." },
            { question: "Why?", look: "PE2's IS-IS no longer advertises its locator." },
          ]}
        />
        <CliPanel run={svOnly(INC, "PE1", "show bgp vpnv4 unicast rd 65000:2 10.20.1.0/24", /entry for|2001:db8:ffff::2 \(metric|community|Sid:/)} caption="IOS XR · PE1 — the route is still received, with its SID" />
        <CliPanel run={svCli(INC, "PE1", "show route ipv6 2001:db8:100:2:41::")} caption="IOS XR · PE1 — no route to the SID" />
        <CliPanel run={svCli(INC, "PE1", "ping 2001:db8:ffff::2")} caption="IOS XR · PE1 — and yet PE2's loopback answers" />
        <CliPanel run={svCli(INC, "PE2", "show isis segment-routing srv6 locators")} caption="IOS XR · PE2 — IS-IS advertises no locator" />
      </GuideSection>

      <GuideSection id="vl-repair" eyebrow="Incident" title="Repair and proof" tone="success">
        <p>The repair is on PE2, not on PE1 and not in BGP: put the locator back into IS-IS.</p>
        <CliPanel run={{ prompt: "RP/0/RP0/CPU0:PE2(config)#", command: "router isis CORE address-family ipv6 unicast segment-routing srv6", output: "RP/0/RP0/CPU0:PE2(config-isis-srv6)#locator MAIN\nRP/0/RP0/CPU0:PE2(config-isis-srv6)#commit" }} caption="IOS XR · PE2 — the repair" />
        <CliPanel run={svOnly(INC_FIX, "PE1", "show route vrf CUST-A", /^B\s/)} caption="IOS XR · PE1 — the routes are installed again" />
        <SvResult s={INC_FIX} i={INC_FIX.tests.length - 2} title="The lab: a fresh CE1 → 10.20.1.10" />
        <SvResult s={INC_FIX} title="The lab: a fresh CE1 → 2001:db8:ca:20::a" />
        <ChecklistCard tone="success" title="Proved, not assumed" mark="✓" items={["2001:db8:100:2::/64 is back in PE1's IPv6 table", "PE1 installs site 2's routes in CUST-A", "fresh pings succeed in both directions, on IPv4 and IPv6", "the lesson: a VPN route needs a reachable SID, not just a reachable next hop"]} />
      </GuideSection>

      <GuideSection id="vl-other" eyebrow="Beyond this incident" title="Other ways it breaks" tone="warning">
        <FailureSignatures
          items={[
            { tag: "RT", title: "Wrong export RT", tone: "danger", points: ["routes on RR1 with the wrong RT", "PE1 keeps no copy"] },
            { tag: "SID", title: "No SRv6 for one family", tone: "danger", points: ["the route arrives without a SID", "IPv4 dead, IPv6 fine"] },
            { tag: "RED", title: "Route not redistributed", tone: "warning", points: ["the request arrives", "the reply has no way back"] },
            { tag: "AF", title: "Family not negotiated", tone: "violet", points: ["session up, VPNv6 missing", "only IPv6 broken"] },
          ]}
        />
        <p className="text-sm text-pv-text-muted">Each is a ticket in the SRv6 L3VPN Lab, together with this incident.</p>
      </GuideSection>

      <GuideSection id="vl-model" eyebrow="Mental model" title="Mental model" tone="cyan">
        <p>
          Think of the provider as a courier with many corporate clients. Each client has its own address book at every depot (the VRFs), and the same street address can mean different buildings for different clients. When a depot learns a client&apos;s new address, it tells the others through head office (BGP via RR1): which client book it belongs in (RT), which depot to send to (next hop), and the label to put on the outside of the parcel (the service SID) — a label that says both “to depot 2, desk CUST-A” and how the trucks find depot 2. The trucks (P routers) only read the depot part. If depot 2&apos;s address disappears from the road maps, head office still lists the client&apos;s address, and the phone line to depot 2 still works — but no truck can find it.
        </p>
        <Callout tone="cyan" title="When it breaks, ask in this order" icon="→">
          Does the egress PE have the customer route? Is it advertised as a VPN route, with RT and SID? Do the sessions carry that family? Does the ingress PE import it? Are the next hop and the SID reachable? Is there a way back?
        </Callout>
      </GuideSection>

      <GuideSection id="vl-glossary" eyebrow="Reference" title="Glossary" tone="cyan">
        <Glossary
          items={[
            { term: "CE / PE / P", def: "Customer edge; provider edge (VRFs, BGP, SIDs); provider core (IPv6 only)." },
            { term: "VRF", def: "A customer's routing table on a PE; chosen by the ingress interface." },
            { term: "RD", def: "Route distinguisher: makes a customer prefix unique in BGP." },
            { term: "RT", def: "Route target: decides which VRFs import a VPN route." },
            { term: "VPNv4 / VPNv6", def: "The BGP families carrying customers' IPv4 / IPv6 routes." },
            { term: "Service SID", def: "The SRv6 SID of a VPN route (End.DT4/DT6 per VRF, End.DX4/DX6 per CE)." },
            { term: "Locator", def: "The prefix all of a node's SIDs come from; it must be in the IGP." },
          ]}
        />
      </GuideSection>

      <GuideSection id="vl-recap" eyebrow="Reference" title="Recap" tone="success">
        <ChecklistCard tone="success" title="You can now" mark="✓" items={["explain VRFs, RD and RT, and why customers stay apart", "read a VPN route: RD, RT, next hop, service SID", "explain PE1's three install checks", "follow a packet: lookup, H.Encaps.Red, core, End.DT4, CE", "tell BGP and next-hop health apart from SID reachability", "find, fix and prove an L3VPN fault"]} />
      </GuideSection>

      <GuideSection id="vl-practice" eyebrow="Next" title="Practice it" tone="violet">
        <p>The Deep Dive tab covers SRv6 L3VPN in full: the service model and RFCs, VRFs, RD and RT, BGP signaling and the Prefix-SID attribute, SID allocation and transposition, the two resolutions, encapsulation, verification and every failure signature with real evidence. The lab lets you change the service yourself.</p>
        <LessonLabBridge />
        <PresentationBridge>Rewatch the SRv6 L3VPN presentation.</PresentationBridge>
      </GuideSection>
    </div>
  );
}
